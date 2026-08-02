/**
 * AI — navigation and cover.
 *
 * NAVIGATION is a dense walkability grid sampled straight out of the physics
 * BVH at boot: one downward ray per cell finds the floor, one upward ray checks
 * standing clearance, and the floor normal gives the slope. That is a navmesh's
 * worth of information for a fraction of the code, and it stays correct for a
 * level the `world` system generated procedurally without any authoring pass.
 *
 *   • A* over the 8-connected grid with a heap, slope and step penalties
 *   • string pulling against a line-of-walk test, so paths hug corners instead
 *     of zig-zagging cell to cell
 *   • per-agent local avoidance so a squad flows around itself
 *
 * COVER is derived from the same grid. Every walkable cell next to a blocker
 * becomes a cover point with a direction and a height class (full / crouch),
 * plus a peek offset that has line of sight past the edge. At runtime cover is
 * scored against the live threat direction, the agent's distance, and what the
 * rest of the squad has already claimed.
 */

import * as THREE from 'three';

const SQRT2 = Math.SQRT2;

/**
 * How far outside an interior volume the ground-floor probe reaches, in metres.
 * It is the DOORSTEP: a balcony or a setback terrace overhangs the pavement by
 * up to 1.35 m and the open-air sweep lands on it, so without this the strip in
 * front of a door is an island at roof height and the storey behind it is
 * sealed. @see `NavGrid._carveInteriors`.
 */
const APRON = 1.6;

/* ------------------------------------------------------------------ */
/* Binary heap for A*                                                  */
/* ------------------------------------------------------------------ */

/**
 * ────────────────────────────────────────────────────────────────────────────
 * IT GROWS, AND THAT IS THE WHOLE FIX
 * ────────────────────────────────────────────────────────────────────────────
 * This heap used to be FIXED at `min(n, 1 << 18)` entries and `push` returned
 * silently when it was full, so an overflow reported "no route" rather than
 * failing. Sizing it to the cell count looked like the answer and is not, and
 * the reason is one line of A*: THERE IS NO DECREASE-KEY HERE. `findPath`
 * re-pushes a cell every time it finds a cheaper `g` for it, so the open list
 * holds EDGES RELAXED, not cells — up to 8 entries per cell on an 8-connected
 * grid, not one. `n` is a floor on the requirement, never a bound on it.
 *
 * MEASURED on the 453 x 453 grid (n = 205209, so the old cap was n itself):
 * routes up to ~185 m solved and everything past that returned 0 waypoints
 * while a 4-neighbour flood proved the two ends were in the same connected
 * component. Raising `maxNodes` could not fix it because `maxNodes` was never
 * the thing that ran out. From the outside it read as the LEVEL being broken:
 * `src/match/sites.js` would report a zone "walkable but NOT reachable" and
 * `ensureReachable` would drag it tens of metres back toward the middle of the
 * map, which is exactly how the two corner districts got abandoned.
 *
 * So it doubles instead. Growth is amortised and bounded by the search — it
 * settles after the first few long queries of a session and never allocates
 * again, so `update()` stays allocation-free once warm. `peakN` is kept so the
 * cost is visible rather than assumed.
 */
class Heap {
  constructor(cap) {
    this.idx = new Int32Array(cap);
    this.key = new Float32Array(cap);
    this.n = 0;
    /** High-water mark across the whole session, for reporting. */
    this.peakN = 0;
    /** How many times the arrays have been reallocated. */
    this.grows = 0;
  }

  clear() {
    this.n = 0;
  }

  /** Double the backing arrays. Called only from `push`, only when full. */
  _grow() {
    const cap = this.idx.length * 2;
    const idx = new Int32Array(cap);
    const key = new Float32Array(cap);
    idx.set(this.idx);
    key.set(this.key);
    this.idx = idx;
    this.key = key;
    this.grows++;
  }

  push(i, k) {
    if (this.n >= this.idx.length) this._grow();
    let c = this.n++;
    if (this.n > this.peakN) this.peakN = this.n;
    this.idx[c] = i;
    this.key[c] = k;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.key[p] <= this.key[c]) break;
      const ti = this.idx[p], tk = this.key[p];
      this.idx[p] = this.idx[c]; this.key[p] = this.key[c];
      this.idx[c] = ti; this.key[c] = tk;
      c = p;
    }
  }

  pop() {
    const top = this.idx[0];
    this.n--;
    if (this.n > 0) {
      this.idx[0] = this.idx[this.n];
      this.key[0] = this.key[this.n];
      let c = 0;
      for (;;) {
        const l = c * 2 + 1, r = l + 1;
        let m = c;
        if (l < this.n && this.key[l] < this.key[m]) m = l;
        if (r < this.n && this.key[r] < this.key[m]) m = r;
        if (m === c) break;
        const ti = this.idx[m], tk = this.key[m];
        this.idx[m] = this.idx[c]; this.key[m] = this.key[c];
        this.idx[c] = ti; this.key[c] = tk;
        c = m;
      }
    }
    return top;
  }
}

/* ------------------------------------------------------------------ */
/* Nav grid                                                            */
/* ------------------------------------------------------------------ */

export class NavGrid {
  constructor(physics, opts = {}) {
    this.physics = physics;
    this.cell = opts.cell ?? 0.8;
    this.radius = opts.radius ?? 0.36;
    this.height = opts.height ?? 1.78;
    this.crouchHeight = opts.crouchHeight ?? 1.15;
    this.maxStep = opts.maxStep ?? 0.45;
    this.maxSlope = Math.cos((opts.maxSlopeDeg ?? 46) * Math.PI / 180);

    const b = opts.bounds;
    this.minX = Math.floor(b.min.x / this.cell) * this.cell;
    this.minZ = Math.floor(b.min.z / this.cell) * this.cell;
    this.nx = Math.max(1, Math.ceil((b.max.x - this.minX) / this.cell));
    this.nz = Math.max(1, Math.ceil((b.max.z - this.minZ) / this.cell));
    this.topY = b.max.y + 4;

    const n = this.nx * this.nz;
    /** 0 = blocked, 1 = walkable standing, 2 = walkable crouched only */
    this.flags = new Uint8Array(n);
    /**
     * ONE HEIGHT PER CELL. This is a 2.5D height field, not a multi-level
     * navmesh, and that is a hard limit on what the AI can use — worth knowing
     * before you build a map around interiors.
     *
     * A two-storey building occupies the same (x, z) cells on both floors, so
     * the grid can only ever store ONE of them, and A* can therefore never path
     * up a staircase. MEASURED across every enterable building in the level:
     * ground-to-upper is 0 waypoints in all four, including the two the repo
     * shipped with. W2 resolves to 68 upper cells and 4 ground ones; E1 and E2
     * cannot even be entered from the street.
     *
     * WHICH FLOOR IT KEEPS IS NOW A CHOICE, AND INSIDE A BUILDING IT IS THE
     * GROUND ONE. @see `_carveInteriors`. The single ray this grid is built from
     * comes down from above the level, so inside a footprint it could only ever
     * find the ROOF: swept before the interior pass existed, all 3353 walkable
     * cells inside the eight enterable buildings were at 3.2 / 6.5 / 9.6 m and
     * ZERO were at ground level, which is why no bot on this map had ever been
     * indoors. The interior pass re-samples those cells from under the roof, so
     * the storey with the doors in it is the one that survives. Upper floors and
     * roofs stay a PLAYER feature — a stair is still 0 waypoints — and that is
     * the honest half of a height field: bots hold the ground, indoors and out.
     */
    this.floor = new Float32Array(n);
    this.floor.fill(-Infinity);
    /** how enclosed a cell is: 0 open, 1 hemmed in — used for cover scoring */
    this.enclosure = new Uint8Array(n);
    /**
     * ────────────────────────────────────────────────────────────────────────
     * IS THIS CELL A ROOM? 1 = strictly inside an interior volume.
     * ────────────────────────────────────────────────────────────────────────
     * `_carveInteriors` already knows the answer — it computes `inside` for
     * every cell it touches and throws it away after incrementing a counter.
     * Keeping it costs one byte per cell and one store, and it is the only way
     * anything downstream can say "this spot is INDOORS" without re-deriving
     * the level's footprint rectangles in a different space and getting it
     * wrong (@see the LEVEL-vs-WORLD note in tools/indoorcheck.mjs, which is
     * exactly that mistake made twice).
     *
     * It is deliberately the STRICT test — the apron cells outside the wall,
     * which the same pass promotes, are NOT marked. A doorstep is not a room.
     *
     * Read by `CoverMap.build`, which stamps it onto every cover point, so
     * "prefer a firing position inside a building" is a flag compare and not a
     * per-frame geometry query. Nothing else in this file behaves differently
     * because of it.
     */
    this.indoor = new Uint8Array(n);
    /**
     * DIAGONAL STEPS THE CORNER RULE WOULD REFUSE AND A SWEPT CAPSULE ALLOWS.
     * Bit d (4..7) set means "this diagonal was MEASURED passable". Written only
     * for the interior pass, so the open-air grid behaves exactly as it always
     * has. @see `_carveInteriors` — without it a 1.12 m doorway that happens to
     * fall diagonally across a 0.8 m lattice is a locked door.
     */
    this.diag = new Uint8Array(n);
    /**
     * ────────────────────────────────────────────────────────────────────────
     * STEPS A WALL STANDS IN THAT THE HEIGHT FIELD CANNOT SEE. Bit d (0..7) set
     * means "this step was MEASURED blocked". @see `_sealCrossings`.
     * ────────────────────────────────────────────────────────────────────────
     * `diag` above is the relaxation; this is its opposite number, and it exists
     * because this grid is built from ONE DOWNWARD RAY PER CELL and a wall
     * thinner than a cell is therefore invisible to it. The ray is dropped at
     * the cell centre on an 0.8 m lattice; a 0.45 m slab standing between two
     * centres is hit by neither, so the cells under it keep the floor of the
     * ground beside it, come back walkable, and A* routes straight through the
     * masonry. Nothing downstream can tell: `Agent._advance` is handed a route
     * over open cells, walks it, and the capsule stops dead against collision
     * that no longer exists as far as navigation is concerned.
     *
     * IT HAS NOW HAPPENED THREE TIMES ON THIS MAP, always with the same wall and
     * always reported as the AI being stupid rather than as the level being
     * wrong — `buildPerimeter` in src/world/dressing.js has the measurements for
     * all three. Every fix before this one moved that wall. This one measures
     * the step instead, so the next piece of dressing collision to stand across
     * a route shuts the cells under itself without anybody having to notice.
     */
    this.edge = new Uint8Array(n);
    /**
     * ────────────────────────────────────────────────────────────────────────
     * THE TWO EDGES THAT GET A MAN OFF A ROOF. Bit d set on the cell the step
     * LEAVES FROM.
     * ────────────────────────────────────────────────────────────────────────
     * "屋上にリスポーンさせるとAIがどこにもいけなくなってる ちゃんと屋上だとかに
     *  リスポーンしても階段降りるなり、飛び降りるなりして戦闘に参加しに行って"
     *
     * A height field with one floor per cell has exactly two ways to say
     * "these two storeys are joined", and this file had neither:
     *
     *   `climb` — A STAIR, and it is a MEASUREMENT (@see `_measureClimbs`).
     *     BIDIRECTIONAL, so it goes into `_label` with every other step and a
     *     component that includes it still means "he can get back". A flight at
     *     32° rises 0.50 m across an 0.8 m cell and 0.71 m across the diagonal —
     *     both are over `maxStep` 0.45 and both were refused, which is the whole
     *     reason "a stair is 0 waypoints" has been written down in this file
     *     three times. The capsule's own `stepHeight` is 0.42 and the treads are
     *     0.18, so the man could always WALK it; only A* could not see it.
     *
     *   `drop` — A FALL, and it is ONE-WAY. It is deliberately NOT in `_label`:
     *     a component means "reachable both ways" and half this file depends on
     *     that (cover scoring filters by it precisely so a marksman is never
     *     aimed at a roof he cannot get back off). Directed reachability is
     *     `escape` below instead.
     */
    this.climb = new Uint8Array(n);
    this.drop = new Uint8Array(n);
    /**
     * …and of those, the ones with a PARAPET on the lip. MEASURED, and it is the
     * whole of task two: swept over every roof on this map, the number of drop
     * edges refused by a full-height wall is ZERO and the number refused by a
     * lip under 1.1 m is 71, 80, 237 and 254 on the four biggest roofs. Not one
     * roof is walled in. Every one of them is KERBED, and a kerb is a thing a
     * soldier puts a hand on. @see `Agent._stepOff`, which is the other half:
     * the grid may say the edge exists, but the capsule still has to get over
     * the lip, and that is a mantle and not a walk.
     */
    this.dropLip = new Uint8Array(n);
    /**
     * Which cells can reach which, as one label per cell. Filled by `_label` at
     * the end of `build()`; -1 until then and for every blocked cell.
     */
    this.comp = new Int32Array(n).fill(-1);
    /**
     * PER COMPONENT: the component a man can reach by FALLING, transitively, or
     * -1. @see `_labelEscapes`. This is the directed half of reachability and it
     * is the only thing `findPath` needs it for — "I am on a roof and the fight
     * is down there" — so it is one label per component and not a closure.
     */
    this.escape = new Int32Array(0);
    /**
     * How big a component has to be before `_labelEscapes` treats it as THE
     * FLOOR — somewhere a man who lands on it is in the match rather than on a
     * second shelf. Published because `nearestGroundBelow` has to ask the same
     * question about a landing that is not a drop edge. @see `_labelEscapes`.
     */
    this.escapeFloor = DROP_LAND_MIN;
    /** Cell count per label, indexed by label. */
    this.compSize = [];
    this.components = 0;
    this.biggestComponent = 0;

    // A* working set
    this.gScore = new Float32Array(n);
    this.came = new Int32Array(n);
    this.visitStamp = new Int32Array(n);
    /**
     * THE CLOSED SET, and its absence was the most expensive bug in this file.
     *
     * This A* has no decrease-key: when a cheaper `g` is found for a cell it is
     * PUSHED AGAIN, leaving the stale entry in the heap. Without a closed set
     * that stale entry is popped later and the cell is EXPANDED A SECOND TIME,
     * with all eight neighbours relaxed again — and each of those re-pushes its
     * own neighbours. On open ground with a near-tie heuristic that compounds:
     * MEASURED on the 453 x 453 grid, north base to south base (196 m) over a
     * connected component of 121 871 cells needed TWO MILLION expansions and
     * 175 ms, and stopped dead against a 143 646 ceiling long before that.
     *
     * That single missing test is what made every symptom this file has notes
     * about: the open list overflowing (a heap holding sixteen entries per cell
     * is not a heap sized to the grid), the node ceiling looking too small, and
     * long routes "silently failing" while a flood fill proved the two ends were
     * in the same component. Closing on pop bounds expansions by the number of
     * REACHABLE CELLS, which is what an A* expansion count is supposed to mean.
     *
     * Stamped, not cleared, exactly like `visitStamp` — a search costs no memset.
     */
    this.closedStamp = new Int32Array(n);
    this.stamp = 0;
    /**
     * The open list. Capped at 65536 it was comfortably larger than the whole
     * 221 x 221 grid; the level is 1.5x and the grid is 109k cells, so the cap
     * became a SILENT one — `Heap.push` returned without pushing when it was
     * full, and a search that overflowed quietly reported "no route" instead of
     * failing loudly.
     *
     * SIZING IT TO THE GRID DID NOT FIX THAT, it only moved the wall out to
     * ~185 m. A* here has no decrease-key, so the open list counts EDGES
     * RELAXED and not cells, and no multiple of `n` is a correct bound. This is
     * a STARTING size for a heap that grows — see the note over `Heap`. An
     * eighth of the grid is comfortably past every route this map has, so the
     * doubling path is dead code on a normal boot and is there for the next map
     * change rather than for this one.
     */
    this.open = new Heap(Math.max(4096, Math.min(n, 1 << 18) >> 3));
    /**
     * A*'s expansion ceiling, derived from the grid for the same reason the open
     * list is. @see `findPath`, which has the measurements: a fixed 24000 became
     * a silent "no route" for every long query the moment the map grew.
     *
     * IT IS THE CELL COUNT NOW, not 70 % of it. With the closed set above, an
     * expansion means a cell SETTLED ONCE, so a search cannot expand more than
     * the cells reachable from its start and the ceiling can be the only number
     * that is guaranteed to be enough. 70 % was already under the 152 716
     * walkable cells this grid has — the largest component is 122 242 so nothing
     * hit it today, but "the ceiling happens to exceed the biggest component" is
     * the same accident that broke this file twice already, and it is the one
     * remaining way a search can report "no route" for a route that exists.
     * Costs nothing: a hopeless query terminates when its component is swept,
     * which is what the 33 ms full sweep below actually measures.
     */
    this.maxNodes = n;

    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._p0 = new THREE.Vector3();
    this._p1 = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this.buildMs = 0;
    this.walkableCount = 0;
    /** How many of them are a ground storey. @see `_carveInteriors`. */
    this.interiorCells = 0;
    /** …how many overhung pavement cells came back. @see the APRON note. */
    this.apronCells = 0;
    /** …and how many diagonals the sweep re-opened. @see `_measureDiagonals`. */
    this.diagCells = 0;
    /** …and how many steps the thin-blocker sweep shut. @see `_sealCrossings`. */
    this.sealedEdges = 0;
    this.sealMs = 0;
    /** …how many stair steps the tread sweep re-opened. @see `_measureClimbs`. */
    this.climbEdges = 0;
    this.climbMs = 0;
    /** …and how many one-way falls it found. @see `_measureDrops`. */
    this.dropEdges = 0;
    /** …and how many components can now get down to a big one. */
    this.escapeComps = 0;
  }

  index(ix, iz) {
    return iz * this.nx + ix;
  }

  cellX(x) {
    return Math.round((x - this.minX) / this.cell);
  }

  cellZ(z) {
    return Math.round((z - this.minZ) / this.cell);
  }

  worldX(ix) {
    return this.minX + ix * this.cell;
  }

  worldZ(iz) {
    return this.minZ + iz * this.cell;
  }

  inside(ix, iz) {
    return ix >= 0 && iz >= 0 && ix < this.nx && iz < this.nz;
  }

  /**
   * Sample the physics world. ~2 rays per cell; logged so the cost is visible.
   *
   * `volumes` is `world.interiorVolumes` or nothing. @see `_carveInteriors`.
   */
  build(volumes = null) {
    const t0 = performance.now();
    const phys = this.physics;
    const MASK = phys.MASK.WORLD;
    const r = this.radius;
    let walk = 0;
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const i = this.index(ix, iz);
        const x = this.worldX(ix), z = this.worldZ(iz);
        const down = phys.raycast(x, this.topY, z, 0, -1, 0, this.topY + 30, MASK);
        if (!down.hit) continue;
        this.floor[i] = down.point.y;
        if (down.normal.y < this.maxSlope) continue;
        const fy = down.point.y;
        // standing clearance straight up
        const up = phys.raycast(x, fy + 0.25, z, 0, 1, 0, this.height - 0.2, MASK);
        if (!up.hit) this.flags[i] = 1;
        else if (up.distance > this.crouchHeight - 0.25) this.flags[i] = 2;
        else continue;
        // shoulder clearance: four short lateral probes at chest height
        let blocked = 0;
        for (let d = 0; d < 4; d++) {
          const dx = d === 0 ? 1 : d === 1 ? -1 : 0;
          const dz = d === 2 ? 1 : d === 3 ? -1 : 0;
          if (phys.raycastAny(x, fy + 0.95, z, dx, 0, dz, r + 0.06, MASK)) blocked++;
        }
        if (blocked >= 3) {
          this.flags[i] = 0;
          continue;
        }
        this.enclosure[i] = blocked;
        walk++;
      }
    }
    // …and then the ground storeys, which the sweep above can only see the roof
    // of, and which are the only cells in the grid it does not own.
    this.walkableCount = volumes && volumes.length ? this._carveInteriors(volumes) : walk;
    // …and then the walls the two rays above are the wrong shape to find.
    this._sealCrossings();
    // …and then the stairs, which are a step one tread too tall and nothing
    // else. This has to be BEFORE `_label`: a stair is a two-way step and the
    // component it joins is a real one.
    this._measureClimbs();
    // …and then which cells can actually reach which, which is a different
    // question from which cells are walkable and the one A* is really asked.
    this._label();
    // …and then the falls, which are one-way and therefore come AFTER the
    // labels (they must not join a component) and need them (a fall onto a
    // one-cell island is a man stranded twice).
    this._measureDrops();
    this._labelEscapes();
    this.buildMs = performance.now() - t0;
    return this;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────────
   * A STAIR IS A STEP ONE TREAD TOO TALL. Measure it rather than guess it.
   * ────────────────────────────────────────────────────────────────────────────
   * "屋上にリスポーンさせるとAIがどこにもいけなくなってる"
   *
   * `maxStep` is 0.45 and it is the right number for a KERB. A staircase at 30-37°
   * climbs 0.46-0.60 m across one 0.8 m cell and 0.65-0.85 m across the diagonal,
   * so every stair on this map is refused by one or two tenths of a metre — which
   * is why `_carveInteriors`' own header had to write down "a stair is still 0
   * waypoints" as a permanent property of the grid. It is not one. Measured over
   * the whole field there are 2858 refused steps in the 0.45-0.80 band alone.
   *
   * RAISING `maxStep` WOULD BE THE BUG, not the fix: 9073 more sit in 0.80-1.20
   * and most of them are a jersey barrier, a plinth, a rubble mound or a window
   * sill, and A* routing men up a 0.7 m wall they cannot walk up is the doorway
   * epidemic again with a new cause. So each candidate step is asked of the
   * collision directly: THREE rays down the segment between the two cell centres,
   * from just above the higher floor — under any ceiling, so this works indoors
   * where the sweep in `build()` can only see the roof — and the step is opened
   * only if the surface climbs in treads the capsule's own 0.42 m `stepHeight`
   * can take. A ramp passes. A stair passes. A 0.6 m ledge does not: its samples
   * land on the ground beside it or on the ledge itself, so one gap in the ladder
   * is the whole 0.6 m and the step stays shut.
   *
   * Cost: ~2000 candidate edges on this map, six rays each, once, at boot —
   * against the ~1.4 M the passes above already spend.
   */
  _measureClimbs() {
    const t0 = performance.now();
    let found = 0;
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const i = this.index(ix, iz);
        if (!this.flags[i]) continue;
        for (let k = 0; k < 4; k++) {
          const d = FWD[k];
          const jx = ix + DX[d], jz = iz + DZ[d];
          if (!this.walkable(jx, jz)) continue;
          const j = this.index(jx, jz);
          const rise = Math.abs(this.floor[j] - this.floor[i]);
          if (rise <= this.maxStep || rise > CLIMB_MAX) continue;
          // the corner rule and the measured walls still stand: a stair that
          // needs a diagonal through a jamb is not a stair a capsule walks.
          if (!this._canStep(i, ix, iz, d)) continue;
          if (!this._treadLadder(ix, iz, jx, jz, this.floor[i], this.floor[j])) continue;
          this.climb[i] |= 1 << d;
          this.climb[j] |= 1 << OPP[d];
          found++;
        }
      }
    }
    this.climbEdges = found;
    this.climbMs = performance.now() - t0;
  }

  /**
   * Does the surface between these two cell centres climb in treads a capsule
   * with a 0.42 m step offset can take? @see `_measureClimbs`.
   */
  _treadLadder(ix, iz, jx, jz, fi, fj) {
    const phys = this.physics;
    const MASK = phys.MASK.WORLD;
    const x0 = this.worldX(ix), z0 = this.worldZ(iz);
    const x1 = this.worldX(jx), z1 = this.worldZ(jz);
    const lo = fi < fj ? fi : fj;
    const hi = fi < fj ? fj : fi;
    const top = hi + 0.75;
    const len = (hi - lo) + 1.3;
    let prev = fi;
    for (let s = 1; s <= 3; s++) {
      const t = s * 0.25;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      const down = phys.raycast(x, top, z, 0, -1, 0, len, MASK);
      if (!down.hit) return false;
      const y = down.point.y;
      // it has to be the ramp between the two floors, not the roof over it and
      // not the ground under a bridge
      if (y < lo - 0.08 || y > hi + 0.08) return false;
      if (Math.abs(y - prev) > CLIMB_TREAD) return false;
      // …and a man has to fit on it
      if (phys.raycastAny(x, y + 0.22, z, 0, 1, 0, this.crouchHeight, MASK)) return false;
      prev = y;
    }
    return Math.abs(fj - prev) <= CLIMB_TREAD;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────────
   * THE ONE-WAY FALL. "飛び降りるなりして戦闘に参加しに行って"
   * ────────────────────────────────────────────────────────────────────────────
   * A man on a roof with no stair is not stuck because the map is wrong; he is
   * stuck because the only edge he needs is one this graph could not express. A
   * drop is a legal move for a soldier and an illegal one for an undirected
   * component label, so it lives here and NOT in `_label`.
   *
   * THREE THINGS ARE REQUIRED, and each one is a way this could have gone wrong:
   *
   *   IT MUST NOT ALREADY BE WALKABLE. `comp[i] === comp[j]` means he can get
   *     there on his feet, and opening a fall beside it would let A* jump off
   *     every kerb and berm on the map for a shortcut. Open ground therefore
   *     behaves EXACTLY as it did — the only new edges in this grid are ones
   *     that join two pieces which had no connection at all.
   *
   *   HE MUST BE ABLE TO GET TO THE LIP. `_sealCrossings` never measured these
   *     pairs (it skips anything over `maxStep`), so a parapet between the roof
   *     and the void is invisible to everything above. One ray at 0.35 m over
   *     the roof surface asks the only question that matters: is there a wall in
   *     the way? A parapet is, and a parapet has no drop edge.
   *
   *   HE MUST SURVIVE IT AND HE MUST NOT LAND SOMEWHERE WORSE. `DROP_MAX` is
   *     the fall, and the landing has to be a real piece of ground rather than
   *     another island — a man who jumps off a roof onto the top of a shipping
   *     container has been stranded twice.
   */
  _measureDrops() {
    const phys = this.physics;
    const MASK = phys.MASK.WORLD;
    let found = 0;
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const i = this.index(ix, iz);
        if (!this.flags[i]) continue;
        for (let d = 0; d < 8; d++) {
          const jx = ix + DX[d], jz = iz + DZ[d];
          if (!this.walkable(jx, jz)) continue;
          const j = this.index(jx, jz);
          const fall = this.floor[i] - this.floor[j];
          if (fall <= this.maxStep || fall > DROP_MAX) continue;
          if (this.comp[i] === this.comp[j]) continue;
          if (!this._canStep(i, ix, iz, d)) continue;
          if (this.componentSize(j) < DROP_LAND_MIN) continue;
          const dx = DX[d], dz = DZ[d];
          const diagonal = dx !== 0 && dz !== 0;
          const inv = diagonal ? 1 / SQRT2 : 1;
          const dist = this.cell * (diagonal ? SQRT2 : 1);
          const x = this.worldX(ix), z = this.worldZ(iz), fy = this.floor[i];
          if (phys.raycastAny(x, fy + 0.35, z, dx * inv, 0, dz * inv, dist, MASK)) {
            // A WALL IS A REFUSAL, A PARAPET IS NOT. If the same line is clear
            // at chest height the blocker is under ~1.1 m, which is the shape
            // `Agent._stepOff` mantles. @see `dropLip`.
            if (phys.raycastAny(x, fy + 1.25, z, dx * inv, 0, dz * inv, dist, MASK)) continue;
            this.dropLip[i] |= 1 << d;
          }
          this.drop[i] |= 1 << d;
          found++;
        }
      }
    }
    this.dropEdges = found;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────────
   * WHICH SHELF CAN GET DOWN TO THE FLOOR: `escape`, one label per component.
   * ────────────────────────────────────────────────────────────────────────────
   * `comp` cannot answer this because a fall is one-way, and a full directed
   * closure over 2618 components is a lot of machinery for a question with one
   * shape: A MAN IS UP SOMEWHERE AND THE FIGHT IS DOWN THERE. So the graph is
   * walked BACKWARDS from the components big enough to be the fight, biggest
   * first, and every component that can drop its way into one is stamped with
   * it. Multi-hop is free — roof to gallery to street is two edges of the same
   * reverse walk — and the first (biggest) target to reach a component wins, so
   * a roof over the middle of the map escapes to the main ground rather than
   * onto whatever ledge happens to be nearest.
   */
  _labelEscapes() {
    const C = this.components;
    if (this.escape.length !== C) this.escape = new Int32Array(C);
    this.escape.fill(-1);
    this.escapeComps = 0;
    this.escapeFloor = Math.max(DROP_LAND_MIN, this.biggestComponent * 0.01);
    if (!C) return;
    /** to-component -> the components that can fall into it. Built once. */
    const rev = new Map();
    for (let i = 0; i < this.drop.length; i++) {
      const bits = this.drop[i];
      if (!bits) continue;
      const ix = i % this.nx, iz = (i / this.nx) | 0;
      for (let d = 0; d < 8; d++) {
        if (!(bits & (1 << d))) continue;
        const from = this.comp[i];
        const to = this.comp[this.index(ix + DX[d], iz + DZ[d])];
        if (from < 0 || to < 0 || from === to) continue;
        let list = rev.get(to);
        if (!list) rev.set(to, (list = []));
        if (!list.includes(from)) list.push(from);
      }
    }
    if (!rev.size) return;
    const order = [];
    for (let c = 0; c < C; c++) order.push(c);
    order.sort((a, b) => this.compSize[b] - this.compSize[a]);
    const floorSize = this.escapeFloor;
    const stack = [];
    for (const target of order) {
      if (this.compSize[target] < floorSize) break;
      stack.length = 0;
      stack.push(target);
      while (stack.length) {
        const c = stack.pop();
        const from = rev.get(c);
        if (!from) continue;
        for (const f of from) {
          if (f === target || this.escape[f] >= 0) continue;
          this.escape[f] = target;
          this.escapeComps++;
          stack.push(f);
        }
      }
    }
  }

  /**
   * ────────────────────────────────────────────────────────────────────────────
   * WHICH CELLS CAN REACH WHICH: connected components, once, at boot.
   * ────────────────────────────────────────────────────────────────────────────
   * "AIがとにかく頭悪い、スタックしているのに移動方法変えないし … 実質６人くらいしか
   * 動いていない".
   *
   * WALKABLE IS NOT REACHABLE — `tools/navcheck.mjs` has said so at the top of
   * its own file since the first time this map sealed a bomb site — and this
   * grid has never known the difference. It has 2800 connected components: the
   * play area, the dune ring outside the boundary, every roof, every parapet
   * crown, and ~2700 islands of one to a few hundred cells, which are the top of
   * a market stall, a jersey barrier, a rubble mound, a kerbed traffic island —
   * anywhere the height field found standable ground with a step round all of it
   * bigger than `maxStep`.
   *
   * That was harmless while nothing ever STOOD on one, and men stand on them all
   * the time: a squad crowds through a mouth, local avoidance pushes one man up
   * onto the kerb of a stall, and from that moment `nearest()` snaps him to the
   * island he is standing on, `findPath` returns 0 waypoints from a component of
   * six cells, `Agent._goTo` reads that as "no route", clears `hasMoveTarget`,
   * and he stands there wanting to move at 4.7 m/s for the rest of the round
   * with a full ADVANCE state and a valid objective. MEASURED with the roster
   * instrumented: 17 of 29 men reported `sameComp: false` with `route: 0`,
   * standing on components of 1, 2, 3, 6, 9, 20, 29, 142 and 797 cells — and
   * every existing gate calls that healthy, because `navcheck` asks A* about
   * SPAWN POINTS, which are authored on ground that is fine.
   *
   * So the labels are computed once, with EXACTLY the rules A* steps by (the
   * step height, the corner rule, `diag`'s measured relaxation and `edge`'s
   * measured refusals), and `findPath` uses them to answer a question it could
   * not ask before: is the cell I am about to search from one that can reach the
   * goal at all, and if it is not, is there one within a few metres that can?
   *
   * It is a label and not a policy — nothing is made walkable or unwalkable
   * here, no route is invented, and A* still has to find it.
   */
  _label() {
    const n = this.flags.length;
    if (!this.comp || this.comp.length !== n) this.comp = new Int32Array(n);
    this.comp.fill(-1);
    const stack = this._labelStack ?? (this._labelStack = []);
    const sizes = this.compSize ?? (this.compSize = []);
    sizes.length = 0;
    for (let i0 = 0; i0 < n; i0++) {
      if (!this.flags[i0] || this.comp[i0] >= 0) continue;
      const id = sizes.length;
      let count = 0;
      stack.length = 0;
      stack.push(i0);
      this.comp[i0] = id;
      while (stack.length) {
        const c = stack.pop();
        count++;
        const cx = c % this.nx, cz = (c / this.nx) | 0;
        for (let d = 0; d < 8; d++) {
          const ix = cx + DX[d], iz = cz + DZ[d];
          if (!this.walkable(ix, iz)) continue;
          const j = this.index(ix, iz);
          if (this.comp[j] >= 0) continue;
          // a stair is a step like any other once it has been measured, and it
          // is two-way, so it belongs in a label that means "and back"
          if (Math.abs(this.floor[j] - this.floor[c]) > this.maxStep
            && !(this.climb[c] & (1 << d))) continue;
          if (!this._canStep(c, cx, cz, d)) continue;
          this.comp[j] = id;
          stack.push(j);
        }
      }
      sizes.push(count);
    }
    stack.length = 0;
    this.components = sizes.length;
    this.biggestComponent = sizes.length ? Math.max(...sizes) : 0;
  }

  /** How many cells can reach the cell at index `i`, itself included. */
  componentSize(i) {
    return i >= 0 && this.comp && this.comp[i] >= 0 ? this.compSize[this.comp[i]] : 0;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────────
   * THE THIN-BLOCKER SWEEP: ask the collision whether a STEP is possible, not
   * whether a CELL is.
   * ────────────────────────────────────────────────────────────────────────────
   * Everything above this samples POINTS — a ray down the cell centre for the
   * floor, a ray up it for headroom, four short ones for shoulders. A point
   * sample cannot see a wall that passes BETWEEN two points, and 0.8 m apart on
   * a lattice there is a lot of room to pass between: measured on this map, a
   * 0.45 m compound wall 3.0-3.8 m tall ran 174 m across the grid and left the
   * cells under it walkable on both sides, so A* solved routes through it and
   * two thirds of the roster walked into it and stayed there. @see the third
   * note over `RX` in `buildPerimeter` (src/world/dressing.js) for the numbers,
   * and note that the FIX for that wall does not fix the next one — dressing
   * carries collision, dressing moves, and nothing else in this file would
   * notice.
   *
   * So every step the grid is willing to take is asked of the physics directly:
   * one ray from cell centre to cell centre, at `maxStep + 0.12` over the higher
   * of the two floors. That height is the whole design. Below it is ground a bot
   * steps onto and the grid has already ruled on it with `maxStep`; above it is
   * mass the capsule cannot pass, whether it is a 0.9 m jersey barrier, a 1.45 m
   * revetted sitework wall or a 3.8 m compound wall. It is deliberately NOT a
   * swept capsule: a capsule sweep between two cells 0.8 m apart with 0.36 m of
   * radius refuses doorways the level authored to be walked (`_carveInteriors`
   * has the note on why a 1.12 m door on this lattice is already marginal), and
   * this pass may only ever remove a step that a straight walk would actually
   * collide with. It can only take steps away, never add one, so nothing that
   * was already proved reachable becomes reachable by a different route here.
   *
   * COST. Four steps per walkable cell rather than eight — every edge is the
   * +X, +Z, +X+Z or +X-Z one of exactly one of its two ends — and the two
   * diagonals are skipped where the corner rule already refuses them, so a
   * diagonal is only measured next to an interior where `diag` re-opened it or
   * where both orthogonals are clear. Roughly 0.4 M short `raycastAny` calls
   * against the ~1.0 M the passes above already spend, once, at boot.
   */
  _sealCrossings() {
    const t0 = performance.now();
    const phys = this.physics;
    const MASK = phys.MASK.WORLD;
    /** Just over the step a bot takes for free, so a kerb is never a wall. */
    const probeY = this.maxStep + 0.12;
    let sealed = 0;
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const i = this.index(ix, iz);
        if (!this.flags[i]) continue;
        const x = this.worldX(ix), z = this.worldZ(iz);
        for (let k = 0; k < 4; k++) {
          const d = FWD[k];
          const dx = DX[d], dz = DZ[d];
          const jx = ix + dx, jz = iz + dz;
          if (!this.walkable(jx, jz)) continue;
          const j = this.index(jx, jz);
          const fi = this.floor[i], fj = this.floor[j];
          if (Math.abs(fi - fj) > this.maxStep) continue;
          const diagonal = dx !== 0 && dz !== 0;
          // a diagonal A* would refuse anyway costs nothing to leave unmeasured
          if (diagonal && !(this.diag[i] & (1 << d))
            && !(this.walkable(ix + dx, iz) && this.walkable(ix, iz + dz))) continue;
          const inv = diagonal ? 1 / SQRT2 : 1;
          const dist = this.cell * (diagonal ? SQRT2 : 1);
          const y = (fi > fj ? fi : fj) + probeY;
          if (!phys.raycastAny(x, y, z, dx * inv, 0, dz * inv, dist, MASK)) continue;
          this.edge[i] |= 1 << d;
          this.edge[j] |= 1 << OPP[d];
          sealed++;
        }
      }
    }
    this.sealedEdges = sealed;
    this.sealMs = performance.now() - t0;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────────
   * THE GROUND FLOORS. The one place this grid does NOT take the first thing it
   * finds from above.
   * ────────────────────────────────────────────────────────────────────────────
   * "もっと屋内戦闘をさせたいので屋内のエリアを作ってそこにもAIがいく利点やメリットを与えて
   *  でないとAIが屋内戦闘しない"
   *
   * `build()` drops one ray per cell from `topY` and keeps the first hit, so
   * inside a building it finds the ROOF. Measured over the whole 328x329 grid
   * before this existed: 3353 walkable cells inside the eight enterable
   * footprints, every one of them at 3.2 / 6.5 / 9.6 m, ZERO at ground level,
   * and 0 of 30 spawn points able to A* to any of them. There was no indoors for
   * a bot to go to — `tools/indoorcheck.mjs` passed 16/16 the whole time because
   * it drives the PLAYER capsule against real collision, which never asks this
   * grid anything.
   *
   * So for the cells `world` says are a ground storey (`world.interiorVolumes`),
   * the probe starts INSIDE the building instead — under the roof, under every
   * upper slab, and under the head of the doorway — and the storey with the
   * doors in it is the floor this cell keeps. Nothing else in the level changes:
   * no geometry moves, no collision moves to `LAYER.CLIP`, an upper floor still
   * stops a bullet and a roof is still a roof to everything except A*.
   *
   * WALKABILITY IS DECIDED BY THE CAPSULE, not by the two rays the open-air pass
   * uses, and that is what keeps a bot out of the walls. A cell is kept only if
   * the actual 0.36 m x 1.78 m bot capsule fits standing (or 1.15 m crouched) at
   * the floor the probe found — so a cell inside a wall, inside a partition, or
   * under a shelf is blocked, and the ~50 cells per building that sit on the
   * wall line survive only where there is a real opening. The open-air pass's
   * "three of four shoulder probes blocked ⇒ not a cell" rule is NOT applied
   * here: it is a cheap stand-in for the capsule, and indoors it throws away the
   * doorways and the gaps between partitions, which are the only cells that
   * connect anything (measured: it sealed six of the eight buildings).
   *
   * AND THAT IS ALSO WHY A* CANNOT THEN WALK THROUGH A WALL. Two cells are 0.8 m
   * apart; a facade is 0.34 m thick and a partition 0.16 m, and every walkable
   * cell centre has 0.36 m of clearance around it, so a wall between two
   * ORTHOGONAL neighbours would need 0.36 + 0.16 + 0.36 = 0.88 m and cannot fit.
   * A DIAGONAL pair is 1.13 m apart and a wall does fit between them — which is
   * why the corner rule (a diagonal needs both orthogonal cells beside it) has
   * to stand, and why the relaxation below is a MEASUREMENT and not a guess.
   *
   * THE DOORWAY THAT FALLS DIAGONALLY. A 1.12 m door on a 0.8 m lattice rotated
   * 33.7° off the level axes frequently leaves exactly one usable cell in the
   * opening, reachable from the street only by a diagonal step whose two corner
   * cells are the jambs. The corner rule refuses it and the whole storey is an
   * island — measured, that was W3, K2 and half of E2. So every diagonal the
   * corner rule refuses inside a footprint is re-asked as a swept 0.36 m capsule
   * along the actual line the bot would walk, and `diag` remembers the answer.
   * That is strictly more honest than the heuristic it overrides, and it is
   * scoped to the ~600 diagonals near an interior, so open ground is untouched.
   *
   * COST: one ray, one or two capsule overlaps and four short rays for the
   * ~4600 cells the eight footprints cover, plus ~600 capsule sweeps, on top of
   * the 108k-cell open-air sweep.
   */
  _carveInteriors(volumes) {
    const phys = this.physics;
    const MASK = phys.MASK.WORLD;
    const r = this.radius;
    const p0 = this._p0, p1 = this._p1;
    this.interiorCells = 0;
    this.apronCells = 0;
    // Cleared here rather than in the constructor: `build()` re-fills `flags`
    // and `floor` for every cell but this pass only ever WRITES ones, so a
    // second build would otherwise keep the first one's rooms.
    this.indoor.fill(0);
    for (const v of volumes) {
      // world-space AABB of the rect, which is on the LEVEL axes, not these
      const ex = Math.abs(v.hw * v.c) + Math.abs(v.hd * v.s) + APRON;
      const ez = Math.abs(v.hw * v.s) + Math.abs(v.hd * v.c) + APRON;
      const ix0 = Math.max(0, this.cellX(v.cx - ex) - 1);
      const ix1 = Math.min(this.nx - 1, this.cellX(v.cx + ex) + 1);
      const iz0 = Math.max(0, this.cellZ(v.cz - ez) - 1);
      const iz1 = Math.min(this.nz - 1, this.cellZ(v.cz + ez) + 1);
      const reach = v.probeY - v.floorY + 0.8;
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = this.worldX(ix), z = this.worldZ(iz);
          const dx = x - v.cx, dz = z - v.cz;
          // back onto the building's own axes
          const lx = dx * v.c - dz * v.s;
          const lz = dx * v.s + dz * v.c;
          const inside = Math.abs(lx) <= v.hw && Math.abs(lz) <= v.hd;
          if (!inside && (Math.abs(lx) > v.hw + APRON || Math.abs(lz) > v.hd + APRON)) continue;
          const i = this.index(ix, iz);
          /**
           * THE APRON, and it is a doorstep problem, not a tidiness one. Outside
           * the wall this pass may only ever PROMOTE a cell that the open-air
           * sweep left reading an OVERHANG — a first-floor balcony hangs 1.0-1.35
           * m over the pavement and a setback terrace more, and the one ray from
           * above lands on it, so the 1.2 m strip of pavement in front of a door
           * is an island at 3.6 / 4.1 / 6.7 m. Measured: that alone sealed W1, W3
           * and E1 with their ground floors fully walkable on the other side of
           * the threshold. A cell the open-air pass already put on the ground is
           * left exactly as it was — this can add pavement, never take it.
           */
          if (!inside && this.flags[i] !== 0 && this.floor[i] < v.floorY + 0.9) continue;
          /**
           * Inside, whatever this cell used to be — a roof, a parapet, an upper
           * floor seen through a stairwell — it is a ground storey now or it is
           * nothing. Leaving the roof reading behind would leave the interior an
           * island at 6.5 m for A* to snap a destination onto.
           */
          const wasFlag = this.flags[i];
          const wasFloor = this.floor[i];
          this.flags[i] = 0;
          const down = phys.raycast(x, v.probeY, z, 0, -1, 0, reach, MASK);
          if (!down.hit) {
            if (!inside) { this.flags[i] = wasFlag; this.floor[i] = wasFloor; }
            continue;
          }
          const fy = down.point.y;
          this.floor[i] = fy;
          if (fy > v.floorY + 0.9 || fy < v.floorY - 0.7 || down.normal.y < this.maxSlope) {
            if (!inside) { this.flags[i] = wasFlag; this.floor[i] = wasFloor; }
            continue;
          }
          // the real capsule, standing then crouched
          p0.set(x, fy + r + 0.06, z);
          p1.set(x, fy + this.height - r, z);
          let flag = phys.checkCapsule(p0, p1, r, MASK) ? 1 : 0;
          if (!flag) {
            p1.set(x, fy + this.crouchHeight - r, z);
            if (phys.checkCapsule(p0, p1, r, MASK)) flag = 2;
          }
          if (!flag) {
            if (!inside) { this.flags[i] = wasFlag; this.floor[i] = wasFloor; }
            continue;
          }
          // enclosure feeds cover scoring and the A* wall-scrape penalty; it is
          // recorded, never a rejection — the capsule already ruled on fit.
          let blocked = 0;
          for (let d = 0; d < 4; d++) {
            const sx = d === 0 ? 1 : d === 1 ? -1 : 0;
            const sz = d === 2 ? 1 : d === 3 ? -1 : 0;
            if (phys.raycastAny(x, fy + 0.95, z, sx, 0, sz, r + 0.06, MASK)) blocked++;
          }
          this.flags[i] = flag;
          this.enclosure[i] = blocked;
          // The one fact this pass has and nothing downstream can recover.
          // @see the `indoor` field. Strict: the apron is a doorstep, not a room.
          if (inside) this.indoor[i] = 1;
          if (inside) this.interiorCells++;
          else this.apronCells++;
        }
      }
    }
    this.diagCells = 0;
    for (const v of volumes) this._measureDiagonals(v);
    let walk = 0;
    for (let i = 0; i < this.flags.length; i++) if (this.flags[i]) walk++;
    return walk;
  }

  /**
   * Re-ask every diagonal the corner rule refuses around one interior, with the
   * capsule the bot actually is. @see `_carveInteriors` — this is what makes a
   * doorway that fell diagonally across the lattice into a way in.
   *
   * Only the two +X diagonals are tested from each cell: every diagonal edge is
   * the +X one of exactly one of its two ends, and both bits are written, so one
   * pass over the footprint plus a ring covers each edge once.
   */
  _measureDiagonals(v) {
    const phys = this.physics;
    const MASK = phys.MASK.WORLD;
    const r = this.radius;
    const p0 = this._p0, p1 = this._p1, dir = this._dir;
    const ex = Math.abs(v.hw * v.c) + Math.abs(v.hd * v.s) + APRON + this.cell;
    const ez = Math.abs(v.hw * v.s) + Math.abs(v.hd * v.c) + APRON + this.cell;
    const ix0 = Math.max(1, this.cellX(v.cx - ex));
    const ix1 = Math.min(this.nx - 2, this.cellX(v.cx + ex));
    const iz0 = Math.max(1, this.cellZ(v.cz - ez));
    const iz1 = Math.min(this.nz - 2, this.cellZ(v.cz + ez));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        if (!this.walkable(ix, iz)) continue;
        const i = this.index(ix, iz);
        for (let d = 4; d <= 5; d++) {
          const dx = DX[d], dz = DZ[d];
          const jx = ix + dx, jz = iz + dz;
          if (!this.walkable(jx, jz)) continue;
          // only the ones the corner rule refuses; the rest are already legal
          if (this.walkable(ix + dx, iz) && this.walkable(ix, iz + dz)) continue;
          const j = this.index(jx, jz);
          const fy = Math.max(this.floor[i], this.floor[j]);
          if (Math.abs(this.floor[i] - this.floor[j]) > this.maxStep) continue;
          const x = this.worldX(ix), z = this.worldZ(iz);
          const tx = this.worldX(jx), tz = this.worldZ(jz);
          const dist = Math.hypot(tx - x, tz - z);
          dir.set((tx - x) / dist, 0, (tz - z) / dist);
          const top = this.flags[i] === 2 || this.flags[j] === 2 ? this.crouchHeight : this.height;
          p0.set(x, fy + r + 0.06, z);
          p1.set(x, fy + top - r, z);
          const hit = phys.capsuleCast(p0, p1, r, dir, dist, MASK);
          if (hit.hit && hit.distance < dist) continue;
          this.diag[i] |= 1 << d;
          this.diag[j] |= 1 << OPP[d];
          this.diagCells++;
        }
      }
    }
  }

  /**
   * May a step from `cur` in direction `d` be taken at all? The corner rule,
   * plus the measured relaxation the interior pass leaves behind.
   */
  _canStep(cur, cxi, czi, d) {
    // measured collision beats every heuristic below it. @see `_sealCrossings`.
    if (this.edge[cur] & (1 << d)) return false;
    const dx = DX[d], dz = DZ[d];
    if (!dx || !dz) return true;
    if (this.walkable(cxi + dx, czi) && this.walkable(cxi, czi + dz)) return true;
    return (this.diag[cur] & (1 << d)) !== 0;
  }

  walkable(ix, iz, crouch = true) {
    if (!this.inside(ix, iz)) return false;
    const f = this.flags[this.index(ix, iz)];
    return crouch ? f !== 0 : f === 1;
  }

  floorAt(ix, iz) {
    return this.floor[this.index(ix, iz)];
  }

  /**
   * Nearest walkable cell to a world point, searched in rings. Pass `y` plus a
   * `yTol` to reject cells on a different storey — otherwise a spawn point in a
   * street happily snaps onto a market stall's table top.
   */
  nearest(x, z, y = null, maxRings = 8, yTol = Infinity, wantComp = -1) {
    const cx = this.cellX(x), cz = this.cellZ(z);
    const okY = (i) => y === null || Math.abs(this.floor[i] - y) <= yTol;
    const okC = (i) => wantComp < 0 || this.comp[i] === wantComp;
    if (this.walkable(cx, cz) && okY(this.index(cx, cz)) && okC(this.index(cx, cz))) {
      return this.index(cx, cz);
    }
    for (let ring = 1; ring <= maxRings; ring++) {
      let best = -1, bestD = Infinity;
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const ix = cx + dx, iz = cz + dz;
          if (!this.walkable(ix, iz)) continue;
          const i = this.index(ix, iz);
          if (!okY(i) || !okC(i)) continue;
          let d = dx * dx + dz * dz;
          if (y !== null && Number.isFinite(this.floor[i])) d += (this.floor[i] - y) ** 2 * 4;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────────
   * THE GROUND UNDER A MAN WHO IS NOT ON IT. Returns a cell index or -1.
   * ────────────────────────────────────────────────────────────────────────────
   * `drop` and `escape` are the graph's answer to "I am up here and the fight is
   * down there", and they only exist BETWEEN TWO CELLS OF THIS GRID. There is a
   * whole class of high ground where that is not enough, and it is not an
   * accident: `_carveInteriors` overwrites every cell inside an enterable
   * footprint with its GROUND STOREY, deliberately and for good reasons, which
   * means the roofs of those eight buildings — the roofs with the vantage nests
   * on them, the only roofs anything in this game puts a man on — are not in the
   * height field AS ROOFS AT ALL. Measured on seed 1: all six vantage nests read
   * `nearest(x, z, y=6.5, 3 rings, 1.5 m) === -1`, and four of the six are still
   * -1 at TEN rings. A man standing in one is off the grid, `Agent._goTo`
   * refuses to plan for him, `_regainGrid` has nowhere level to send him, and no
   * drop edge can help because he is not on a cell that has any.
   *
   * So this asks the only question left, and it asks it of geometry rather than
   * of the graph: IS THERE REAL GROUND BELOW HIM. Nearest first, and a landing
   * has to be somewhere he is better off — `escapeFloor` cells of it, or a
   * component that can fall its own way down — because a rescue that puts a man
   * on a market stall's table top has moved the problem two metres.
   *
   * `minFall` keeps a kerb out of it and `maxFall` is the caller's judgement,
   * NOT `DROP_MAX`: that constant is what a route may plan through, and this is
   * a man who has no route. The AI takes no fall damage (@see `DROP_MAX`'s
   * note), so the only cost of the tallest roof on this map is how it looks.
   */
  nearestGroundBelow(x, z, y, maxRings = 10, minFall = 1.6, maxFall = 12) {
    const cx = this.cellX(x), cz = this.cellZ(z);
    const phys = this.physics;
    const MASK = phys.MASK.WORLD;
    for (let ring = 0; ring <= maxRings; ring++) {
      let best = -1, bestD = Infinity;
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const ix = cx + dx, iz = cz + dz;
          if (!this.walkable(ix, iz)) continue;
          const i = this.index(ix, iz);
          const fall = y - this.floor[i];
          if (!(fall >= minFall && fall <= maxFall)) continue;
          const c = this.comp[i];
          if (c < 0) continue;
          if (this.compSize[c] < this.escapeFloor && !(this.escape.length && this.escape[c] >= 0)) continue;
          /**
           * THERE HAS TO BE SKY BETWEEN THEM, AND THAT IS THE WHOLE TEST.
           *
           * The first version of this searched from ring ZERO and the first
           * thing it found was THE CELL DIRECTLY UNDER HIS BOOTS — the shop
           * floor 6.4 m below a carved roof is walkable, is on the ground's own
           * component and is 0 m away. `Agent._move` clears a detour inside
           * 0.6 m, so the rescue was cancelled on the frame it was ordered, and
           * the trace showed exactly that: `ds4.8 sp0.0` at stuck rung 2 for
           * forty seconds together.
           *
           * One ray up from the landing to his feet answers it honestly and
           * cheaply: everything under the slab he is standing on is refused,
           * everything out past the parapet is not. The horizontal floor is the
           * detour's own arrival radius, so the point he is sent to is always a
           * point he has to walk to.
           */
          const wx = this.worldX(ix), wz = this.worldZ(iz);
          const hx = wx - x, hz = wz - z;
          if (hx * hx + hz * hz < 1.4 * 1.4) continue;
          if (phys.raycastAny(wx, this.floor[i] + 0.25, wz, 0, 1, 0, fall - 0.4, MASK)) continue;
          // Nearest, then shallowest: the roof next door beats the street when
          // both are under him, and a man who can take one storey takes one.
          const d = dx * dx + dz * dz + fall * 0.35;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /**
   * A* between two world points. Writes world-space waypoints into `out`
   * (an array of THREE.Vector3, reused) and returns the count.
   */
  findPath(from, to, out, opts = {}) {
    let start = this.nearest(from.x, from.z, from.y);
    let goal = this.nearest(to.x, to.z, to.y);
    if (start < 0 || goal < 0) return 0;
    /**
     * ────────────────────────────────────────────────────────────────────────
     * NEITHER END MAY BE AN ISLAND. @see `_label` for what these are and for the
     * measurement that says two thirds of the roster was standing on one.
     * ────────────────────────────────────────────────────────────────────────
     * `nearest` answers "the closest cell", which is the right answer to the
     * wrong question when the closest cell is the top of the market stall the
     * man has just been shoved onto: the search then runs inside a component of
     * six cells and correctly reports that the objective is not in it. What A*
     * is actually being asked is "get this man to that place", and a man
     * standing on a stall is one step from ground that can.
     *
     * So each end is re-asked with the other end's component required, over
     * `ISLAND_RINGS` rather than eight — a 142-cell island is 90 m² and its
     * middle is further than 6.4 m from the kerb. The FIRST answer is kept if
     * the re-ask finds nothing, so this can only ever turn a route that did not
     * exist into one that does. The start is re-asked first because it is the
     * end that gets shoved; the goal is only re-asked if that did not settle it,
     * which is the case where a destination has been authored or scored onto a
     * kerbed island (`world.features` on a plinth, a cover point on a berm).
     *
     * The waypoint that comes back may be a metre behind or below him, and that
     * is the point: `Agent._move` steers at it, he walks off the stall, and the
     * next repath is an ordinary one. This is deliberately NOT a nudge inside
     * `nearest` — cover scoring, spawn validation and `src/match`'s reachability
     * proofs all call it and all want the closest cell, honestly.
     *
     * THE SMALLER END MOVES, and getting that backwards is worse than not doing
     * it at all: a cache standing on a kerbed plinth is a goal on a ONE-CELL
     * component, and re-anchoring the START onto it walks the whole search into
     * the island — `start === goal`, one waypoint, and a man ordered to a pickup
     * he can see and cannot path to. Measured exactly that way before the sizes
     * were compared. So whichever end has fewer cells behind it is the end that
     * gives way, and the other is only tried if that finds nothing.
     */
    /**
     * …UNLESS HE CAN GET THERE BY FALLING. @see `_labelEscapes`.
     *
     * The re-anchor below is the right answer for a man shoved onto a kerb and
     * exactly the wrong one for a man ON A ROOF: `nearest` with the ground's
     * component happily returns a square of street 9 m below him, A* then solves
     * a route that starts where he is not, and he walks into the parapet for the
     * rest of the round. That is the stranded bot, and it is why this test comes
     * first — if the drop graph says his component can get down to the goal's,
     * BOTH ENDS ARE LEFT ALONE and A* is allowed to find the edge itself.
     */
    const descends = this.escape.length > 0 && this.comp
      && this.comp[start] >= 0 && this.comp[goal] >= 0
      && this.escape[this.comp[start]] === this.comp[goal];
    if (this.comp && this.comp[start] !== this.comp[goal] && !descends) {
      const reStart = () => {
        const s2 = this.nearest(from.x, from.z, from.y, ISLAND_RINGS, Infinity, this.comp[goal]);
        if (s2 >= 0) start = s2;
        return s2 >= 0;
      };
      const reGoal = () => {
        const g2 = this.nearest(to.x, to.z, to.y, ISLAND_RINGS, Infinity, this.comp[start]);
        if (g2 >= 0) goal = g2;
        return g2 >= 0;
      };
      if (this.componentSize(start) <= this.componentSize(goal)) reStart() || reGoal();
      else reGoal() || reStart();
    }
    if (start === goal) {
      this._emit(out, 0, to);
      return 1;
    }
    const nx = this.nx;
    const gx = goal % nx, gz = (goal / nx) | 0;
    const cell = this.cell;
    /**
     * The A* expansion budget, and it is a function of the MAP, not a taste.
     *
     * 6000 was right for a 221 x 221 grid with 38k walkable cells and a 63 m
     * longest route. The level is 1.5x now — 331 x 331, 86k walkable, 104 m —
     * and the search frontier grows with the AREA it has to sweep past cover,
     * not with the length of the answer. `navcheck` caught the difference
     * precisely: every spawn still reached both SITES, and three defenders lost
     * their route to hold A, which reads from the outside as three bots going
     * brain-dead in the corner of a courtyard nine metres from where the rest
     * of the squad is standing.
     *
     * Scaled with the grid (2.25x the cells) and rounded up. This is a CEILING,
     * not a cost: a search that succeeds still stops the moment it pops the
     * goal, and the routes on this map settle in a few hundred expansions. It
     * only ever spends the budget on a query that was going to fail.
     *
     * ────────────────────────────────────────────────────────────────────────
     * AND THEN IT WENT STALE AGAIN, SO IT IS DERIVED FROM THE GRID NOW
     * ────────────────────────────────────────────────────────────────────────
     * The map grew a base district at each end and a cathedral in the middle
     * (see `THE MAP GROWS` in src/world/layout.js): the grid went 328x329 to
     * 453x453 and the longest route on it went from 118 m to 197 m. 24000 was
     * not enough for either end of that, and BECAUSE THE FAILURE IS SILENT it
     * did not look like a pathfinding problem. Measured, same build, same grid:
     *
     *   attack spawn -> the cathedral crossing (98 m)   24000: NO ROUTE
     *                                                   60000: NO ROUTE
     *                                                  400000: 9 waypoints
     *   attack spawn -> defence spawn        (196 m)    24000: NO ROUTE
     *                                                   60000: 11 waypoints
     *
     * What that looked like from the outside was the LEVEL being broken:
     * `src/match/sites.js` reported "site C: walkable but NOT reachable from
     * every spawn — moved 11.0 m", then relocated 24 of 30 spawn points by up to
     * 24 m trying to find ground that could reach it, and `src/match/caches.js`
     * dropped five interior caches as unreachable. Every one of those is a
     * correct response to `findPath` returning 0, and every one of them was a
     * lie about the geometry: the crossing has 1331 walkable cells around it and
     * the route exists.
     *
     * A CEILING THAT DOES NOT SCALE WITH THE GRID IS A BUG WAITING FOR THE NEXT
     * MAP CHANGE, and this is the second time it has fired. So it is derived,
     * exactly like the open list two hundred lines up (`Math.min(n, 1 << 18)`):
     * 70 % of the cells is far more than any successful search on a map this
     * shape needs (the longest one measured expands well under a tenth of it),
     * and it still bounds a hopeless query to less than one full sweep.
     */
    const maxNodes = opts.maxNodes ?? this.maxNodes;

    this.stamp++;
    const stamp = this.stamp;
    this.open.clear();
    this.gScore[start] = 0;
    this.came[start] = -1;
    this.visitStamp[start] = stamp;
    this.open.push(start, 0);

    let expanded = 0;
    let found = false;
    while (this.open.n > 0 && expanded < maxNodes) {
      const cur = this.open.pop();
      // A stale duplicate of a cell already settled. @see `closedStamp`.
      if (this.closedStamp[cur] === stamp) continue;
      this.closedStamp[cur] = stamp;
      if (cur === goal) {
        found = true;
        break;
      }
      expanded++;
      const cxi = cur % nx, czi = (cur / nx) | 0;
      const cg = this.gScore[cur];
      const cy = this.floor[cur];
      for (let d = 0; d < 8; d++) {
        const dx = DX[d], dz = DZ[d];
        const ix = cxi + dx, iz = czi + dz;
        if (!this.walkable(ix, iz)) continue;
        // no corner cutting, unless the interior pass measured this diagonal —
        // and no step through a wall the thin-blocker sweep measured, either
        if (!this._canStep(cur, cxi, czi, d)) continue;
        const ni = this.index(ix, iz);
        // Already settled: its g is final and cannot be improved from here.
        if (this.closedStamp[ni] === stamp) continue;
        const dy = this.floor[ni] - cy;
        /**
         * A STEP, A STAIR OR A FALL — and the extra cost is what keeps the last
         * one honest. A drop already pays `|dy| * 2.2` for its height, so a five
         * metre jump costs eleven metres of walking; the flat addition on top is
         * the commitment, because a fall he cannot climb back up is worth more
         * than a corner he can turn round.
         */
        let extra = 0;
        if (Math.abs(dy) > this.maxStep) {
          if (this.climb[cur] & (1 << d)) extra = 0.8;
          else if (dy < 0 && (this.drop[cur] & (1 << d))) extra = 1.6;
          else continue;
        }
        let cost = (dx && dz ? SQRT2 : 1) * cell + extra;
        cost += Math.abs(dy) * 2.2; // prefer flat ground
        if (this.flags[ni] === 2) cost += cell * 1.6; // crouch-only squeeze
        cost += this.enclosure[ni] * cell * 0.25; // avoid scraping walls
        const g = cg + cost;
        if (this.visitStamp[ni] === stamp && g >= this.gScore[ni]) continue;
        this.visitStamp[ni] = stamp;
        this.gScore[ni] = g;
        this.came[ni] = cur;
        const hx = Math.abs(ix - gx), hz = Math.abs(iz - gz);
        const h = (Math.max(hx, hz) + (SQRT2 - 1) * Math.min(hx, hz)) * cell;
        this.open.push(ni, g + h * 1.06);
      }
    }
    if (!found) return 0;

    // walk the parents back, then string-pull
    const raw = this._raw ?? (this._raw = []);
    raw.length = 0;
    let n = goal;
    while (n >= 0) {
      raw.push(n);
      n = this.came[n];
    }
    raw.reverse();
    return this._stringPull(raw, from, to, out);
  }

  _emit(out, i, v) {
    if (!out[i]) out[i] = new THREE.Vector3();
    out[i].copy(v);
  }

  /**
   * Greedy string pull: keep the furthest waypoint still reachable in a
   * straight walkable line from the anchor. Turns a staircase into a corner.
   */
  _stringPull(raw, from, to, out) {
    let count = 0;
    const anchor = this._v.copy(from);
    let i = 0;
    const nx = this.nx;
    const pos = this._v2;
    while (i < raw.length - 1) {
      let best = i + 1;
      for (let j = raw.length - 1; j > i; j--) {
        const c = raw[j];
        pos.set(this.worldX(c % nx), this.floor[c], this.worldZ((c / nx) | 0));
        if (this.lineOfWalk(anchor, pos)) {
          best = j;
          break;
        }
      }
      const c = raw[best];
      pos.set(this.worldX(c % nx), this.floor[c], this.worldZ((c / nx) | 0));
      this._emit(out, count++, pos);
      anchor.copy(pos);
      i = best;
      if (count >= 32) break;
    }
    // finish on the exact goal if we can see it
    if (this.lineOfWalk(anchor, to) && count < 32) this._emit(out, count++, to);
    else if (count === 0) this._emit(out, count++, to);
    return count;
  }

  /**
   * Is the straight segment walkable end to end?
   *
   * The samples are 0.52 m apart on a 0.8 m grid, so consecutive ones land on
   * the same cell or on an 8-adjacent one — and a DIAGONAL pair gets the same
   * no-corner-cutting test A* uses. That is not tidiness: it is the only thing
   * that stops a string-pulled shortcut from cutting the corner of a doorjamb
   * and walking a bot through 0.34 m of wall, now that the ground floors are in
   * the grid (@see `_carveInteriors` for why a wall can only ever sit between a
   * diagonal pair). Outdoors it can only ever reject a line the grid was already
   * ambivalent about; the route itself is A*'s answer, not this one's.
   */
  lineOfWalk(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / (this.cell * 0.65)));
    let prevY = a.y;
    let px = this.cellX(a.x), pz = this.cellZ(a.z);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + dx * t, z = a.z + dz * t;
      const ix = this.cellX(x), iz = this.cellZ(z);
      if (!this.walkable(ix, iz)) return false;
      /**
       * EVERY transition, not just the diagonal ones. It was diagonals only
       * while the only thing `_canStep` knew was the corner rule, which is a
       * statement about diagonals; it now also carries the thin-blocker sweep,
       * which is a statement about a step of any shape. A string pull that
       * skipped the orthogonal ones would hand back the shortcut straight
       * through the wall that A* had just been made to refuse.
       */
      let climbing = false;
      if (ix !== px || iz !== pz) {
        const ddx = ix - px, ddz = iz - pz;
        let d = -1;
        if (Math.abs(ddx) <= 1 && Math.abs(ddz) <= 1) {
          if (ddx && ddz) d = 4 + (ddx < 0 ? 2 : 0) + (ddz < 0 ? 1 : 0);
          else if (ddx) d = ddx > 0 ? 0 : 1;
          else d = ddz > 0 ? 2 : 3;
        }
        const pi = this.index(px, pz);
        if (d < 0 || !this._canStep(pi, px, pz, d)) return false;
        // A measured stair is walkable in a straight line by definition — that
        // is what the tread sweep proved. A FALL is not: a drop edge stays a
        // waypoint so the man walks to the lip and steps off it, rather than
        // being string-pulled along the face of the building.
        climbing = (this.climb[pi] & (1 << d)) !== 0;
      }
      px = ix;
      pz = iz;
      const y = this.floor[this.index(ix, iz)];
      if (!climbing && Math.abs(y - prevY) > this.maxStep) return false;
      if (climbing && Math.abs(y - prevY) > CLIMB_MAX) return false;
      prevY = y;
    }
    return true;
  }
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
/** The index of the opposite direction, so a measured edge writes both ends. */
const OPP = [1, 0, 3, 2, 7, 6, 5, 4];
/**
 * Half the compass, and it covers the whole of it exactly once per edge: every
 * step on an 8-connected lattice is the +X, +Z, +X+Z or +X-Z one of exactly one
 * of its two ends. @see `_sealCrossings`, which writes both ends of what it
 * measures and therefore only has to walk these four.
 */
const FWD = [0, 2, 4, 5];
/**
 * How far `findPath` will look for a cell on the other end's component before it
 * gives up and searches from where the man is standing. 14 rings is 11.2 m — the
 * biggest island a man was measured stranded on is 797 cells and everything a
 * squad actually gets shoved onto is a kerb, a stall or a berm a metre wide.
 * @see `findPath`.
 */
const ISLAND_RINGS = 14;
/**
 * THE THREE NUMBERS THE ROOFS COST. @see `_measureClimbs` / `_measureDrops`.
 *
 * `CLIMB_MAX` is the tallest step the tread sweep will even look at: 0.95 m is a
 * 37° flight taken diagonally (0.85 m across 1.13 m) with a little room, and it
 * is deliberately under the 1.2 m band where the plinths and the window sills
 * live. `CLIMB_TREAD` is the gap between two consecutive samples the capsule can
 * take for free — its own `stepHeight` is 0.42 (@see `Agent`'s controller), so
 * 0.40 leaves the margin on the right side.
 *
 * `DROP_MAX` is the fall, and it is MEASURED off this map rather than chosen.
 * The AI takes no fall damage (nothing in `Agent._move` applies any), so the
 * only question is what looks like a soldier and what looks like a bot walking
 * off a building. Five metres was the first answer and it was the wrong one:
 * swept over every stranded high cell, 3726 of the refused edges are a fall of
 * 6-7 m, which is this level's standard two-storey roof — the exact surface the
 * complaint is about. Seven metres takes them and still refuses the 9.6 m
 * roofs, which get down the way the map intends, one storey at a time, because
 * `escape` is transitive.
 */
const CLIMB_MAX = 0.95;
const CLIMB_TREAD = 0.40;
const DROP_MAX = 7.0;
/** A fall may not end on another island. 24 cells is 15 m² of real ground. */
const DROP_LAND_MIN = 24;

/* ------------------------------------------------------------------ */
/* Cover                                                               */
/* ------------------------------------------------------------------ */

/**
 * A cover point: a spot to stand plus the direction the protection comes from.
 * `high` means the blocker stops a standing shot; otherwise it is crouch cover.
 * `peek` is a lateral offset that clears the edge for shooting.
 */
export class CoverMap {
  constructor(grid, physics) {
    this.grid = grid;
    this.physics = physics;
    /**
     * EVERY point this table ever baked, in cell order, including the ones that
     * only exist while some block is standing and the ones that only exist once
     * it has fallen. Claims live here. @see `bakeBlockDeps`.
     */
    this.all = [];
    /**
     * The points that describe REAL MASS RIGHT NOW — what `pick` searches and
     * what a probe measures. Until `bakeBlockDeps` finds a point whose cover
     * belongs to a destructible block, this IS `all`, same array, no second
     * pass and no second allocation anywhere.
     */
    this.points = this.all;
    /** Which destructible blocks are down, one bit each. @see `applyBlocks`. */
    this.blockMask = 0;
    /** Which were down WHEN THIS TABLE WAS BAKED. @see `bakeBlockDeps`. */
    this.bakeMask = 0;
    this._appliedMask = -1;
    /** Does any point in here depend on a block at all? */
    this.dynamic = false;
    this.depMs = 0;
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this.buildMs = 0;
  }

  build(opts = {}) {
    const t0 = performance.now();
    const g = this.grid;
    const phys = this.physics;
    const MASK = phys.MASK.WORLD;
    const step = opts.step ?? 1; // sample every Nth cell
    const reach = opts.reach ?? 1.25;
    this.all.length = 0;
    this.points = this.all;
    this.dynamic = false;
    this.blockMask = 0;
    this.bakeMask = 0;
    this._appliedMask = -1;
    for (let iz = 1; iz < g.nz - 1; iz += step) {
      for (let ix = 1; ix < g.nx - 1; ix += step) {
        if (!g.walkable(ix, iz)) continue;
        const i = g.index(ix, iz);
        if (g.enclosure[i] === 0) {
          // still allow cover next to a blocked cell (thin props, sandbags)
          let adj = false;
          for (let d = 0; d < 4 && !adj; d++) {
            if (!g.walkable(ix + DX[d], iz + DZ[d])) adj = true;
          }
          if (!adj) continue;
        }
        const x = g.worldX(ix), z = g.worldZ(iz), y = g.floor[i];
        // find the strongest blocking direction at chest and knee height
        for (let d = 0; d < 8; d++) {
          const dx = DX[d] / (d < 4 ? 1 : SQRT2);
          const dz = DZ[d] / (d < 4 ? 1 : SQRT2);
          const low = phys.raycast(x, y + 0.55, z, dx, 0, dz, reach, MASK);
          if (!low.hit) continue;
          const high = phys.raycastAny(x, y + 1.32, z, dx, 0, dz, reach, MASK);
          // must be able to shoot over/around: check a peek to both sides
          this.all.push({
            x, y, z,
            dx, dz, // direction the cover faces (toward the blocker)
            high,
            dist: low.distance,
            claimed: -1,
            score: 0,
            /** In the live set? Only `applyBlocks` ever clears it. */
            live: true,
            /**
             * Is this firing position INSIDE a building? Copied off the grid's
             * own interior mask (@see `NavGrid.indoor`), once, at bake time.
             * `pick` reads it for the men whose whole game is a window.
             */
            indoor: g.indoor ? g.indoor[i] === 1 : false,
            /** cell, so `bakeBlockDeps` can find this point again */
            cell: i,
            /** per-block facings, or null for a point no block can change */
            variants: null,
          });
          break;
        }
      }
    }
    this.buildMs = performance.now() - t0;
    return this;
  }

  /**
   * ════════════════════════════════════════════════════════════════════════
   * WHICH BLOCK IS THIS COVER POINT'S MASS PART OF? — asked once per point,
   * not once per combination.
   * ════════════════════════════════════════════════════════════════════════
   * `world.demolitions` are six blocks that fire INDEPENDENTLY, so the
   * cathedral's answer — bake the whole table twice and move a reference —
   * would need sixty-four tables here. It does not have to: a cover point is
   * one cell and one 1.3 m ray, and that ray hits ONE piece of mass. So the
   * question "is this point still true" is per point and per block, and the
   * table it needs is O(points × blocks), which is this one.
   *
   * For every walkable cell inside a block's rect (plus a margin, so nothing
   * within `reach` of the block's own mass is missed) this fires all eight
   * directions in the state the level ships in, then fires them again with ONE
   * block's collision swapped for its ruin, one block at a time. That gives
   * each (cell, direction) two bitmasks:
   *
   *   die   blocks whose STANDING mass is what this facing describes. The
   *         facing is real until any one of them comes down, and false after.
   *   need  blocks whose RUBBLE is what this facing describes. There is
   *         nothing there while the building stands, and cover once it falls —
   *         the corner stubs and pancaked slabs `demolition.js` builds are
   *         mass like any other and a man should be allowed to use them.
   *
   * A point keeps its variants IN DIRECTION ORDER, so with no block down the
   * facing chosen is the first direction that hits, byte for byte what `build`
   * chose. `applyBlocks` then walks that list and takes the first facing that
   * is true in the state the town is actually in — which is how a cell whose
   * north wall fell but whose east wall is a permanent one stays a cover point
   * instead of being dropped, and how a cell that gains rubble becomes one.
   *
   * A point whose FIRST facing is permanent is left alone entirely (no variant
   * array, never re-examined): nothing that happens to a block can change it.
   *
   * COST IS AT BOOT AND IT IS BOUNDED BY THE BLOCKS, NOT BY THE MAP: only
   * cells inside the six rects are probed, and each is asked about the blocks
   * whose rect it is in. Nothing here runs again.
   *
   * ────────────────────────────────────────────────────────────────────────
   * IT IS ALL RELATIVE TO THE STATE THE LEVEL BOOTED IN, NOT TO "STANDING".
   * ────────────────────────────────────────────────────────────────────────
   * `?demo=down` boots the six blocks AS RUINS inside `world` itself, before
   * `ai.init` — so `NavGrid` drops its rays on the debris field and the
   * footprints are walkable ground. Baking the tables in the standing state
   * there puts the whole candidate set at odds with the grid it came from, and
   * it was measured doing exactly that: 151 of the 477 points on those blocks
   * described air on the frame the level finished booting.
   *
   * So nothing is forced. `bakeMask` is which blocks were down WHEN THIS TABLE
   * WAS BAKED, each block is probed by flipping it AWAY from that, and `die` /
   * `need` are read against `mask ^ bakeMask` — how the town differs from the
   * one the rays were fired in. With a normal boot `bakeMask` is 0 and this is
   * the plain reading of it.
   *
   * @param {Array<{x0:number,x1:number,z0:number,z1:number}>} rects one world
   *        AABB per block; the index in this array IS the bit.
   * @param {(k:number, down:boolean)=>void} setDown flips ONE block's
   *        COLLISION (not its picture) and nothing else.
   * @param {number} opts.bakeMask which blocks are DOWN right now, one bit each.
   */
  bakeBlockDeps(rects, setDown, opts = {}) {
    const t0 = performance.now();
    const g = this.grid;
    const phys = this.physics;
    const MASK = phys.MASK.WORLD;
    const reach = opts.reach ?? 1.25;
    this.bakeMask = opts.bakeMask ?? 0;
    // A cell this far outside a block's rect cannot have that block's mass
    // inside `reach`, so it cannot depend on it.
    const pad = reach + g.cell;
    const nb = Math.min(rects.length, 30); // one bit each, kept inside int32
    if (nb === 0) return this;

    /** cell index -> { x, y, z, near, up[8], down[8][k] } */
    const cells = new Map();
    const byCell = new Map();
    for (const p of this.all) byCell.set(p.cell, p);

    /**
     * A CELL IN THE MIDDLE OF THE AVENUE CANNOT GAIN COVER FROM A COLLAPSE, and
     * a block's rect is mostly avenue. Sweeping all of it at eight rays a cell
     * measured 389 ms per table at boot; this is the same reasoning `build`
     * already applies with its blocked-neighbour test, widened to `reach`.
     *
     * A block's rubble stands where the block does, and the block's footprint
     * is NOT WALKABLE while it stands — so a cell that could be given cover by
     * a collapse is within `reach` PLUS THE APRON of a blocked cell today —
     * `demolition.js` runs its pile 1.6 m past the footprint on every side, so
     * the reach is 2.9 m and five cells is 4.0 m. Measured: at three cells
     * (2.4 m) six of the twelve points the rubble makes were being cut.
     * Cells that are ALREADY cover points are kept whatever their surroundings:
     * they are the ones whose facing might be about to go away.
     */
    const RING = 5;
    const exposed = (ix, iz) => {
      for (let dz = -RING; dz <= RING; dz++) {
        const jz = iz + dz;
        if (jz < 0 || jz >= g.nz) return true;
        for (let dx = -RING; dx <= RING; dx++) {
          const jx = ix + dx;
          if (jx < 0 || jx >= g.nx) return true;
          if (!g.walkable(jx, jz)) return true;
        }
      }
      return false;
    };

    for (let k = 0; k < nb; k++) {
      const r = rects[k];
      if (!r) continue;
      const ix0 = Math.max(1, g.cellX(r.x0 - pad));
      const ix1 = Math.min(g.nx - 2, g.cellX(r.x1 + pad));
      const iz0 = Math.max(1, g.cellZ(r.z0 - pad));
      const iz1 = Math.min(g.nz - 2, g.cellZ(r.z1 + pad));
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          if (!g.walkable(ix, iz)) continue;
          const i = g.index(ix, iz);
          let c = cells.get(i);
          if (!c && !byCell.has(i) && !exposed(ix, iz)) continue;
          if (!c) {
            c = {
              i,
              x: g.worldX(ix),
              y: g.floor[i],
              z: g.worldZ(iz),
              near: 0,
              up: new Array(8).fill(null),
              alt: new Array(8 * nb).fill(null),
            };
            cells.set(i, c);
          }
          c.near |= 1 << k;
        }
      }
    }

    /** One direction's answer in one state, or null for "no mass there". */
    const fire = (c, d) => {
      const dx = DX[d] / (d < 4 ? 1 : SQRT2);
      const dz = DZ[d] / (d < 4 ? 1 : SQRT2);
      const low = phys.raycast(c.x, c.y + 0.55, c.z, dx, 0, dz, reach, MASK);
      if (!low.hit) return null;
      return {
        dx,
        dz,
        high: phys.raycastAny(c.x, c.y + 1.32, c.z, dx, 0, dz, reach, MASK),
        dist: low.distance,
      };
    };

    // THE TOWN AS IT STANDS. Every candidate cell, every direction.
    for (const c of cells.values()) for (let d = 0; d < 8; d++) c.up[d] = fire(c, d);

    // ONE BLOCK FLIPPED AT A TIME, away from however it booted. Only the cells
    // that block could possibly reach.
    for (let k = 0; k < nb; k++) {
      const bit = 1 << k;
      const baked = (this.bakeMask & bit) !== 0;
      let touched = false;
      for (const c of cells.values()) {
        if (!(c.near & bit)) continue;
        if (!touched) {
          setDown(k, !baked);
          touched = true;
        }
        for (let d = 0; d < 8; d++) c.alt[d * nb + k] = fire(c, d);
      }
      if (touched) setDown(k, baked);
    }

    // Fold the two states into per-facing bitmasks, and hand each cell the
    // facings that are worth keeping.
    let dependent = 0;
    let created = 0;
    const fresh = [];
    for (const c of cells.values()) {
      const variants = [];
      for (let d = 0; d < 8; d++) {
        const up = c.up[d];
        let die = 0;
        let need = 0;
        for (let k = 0; k < nb; k++) {
          if (!(c.near & (1 << k))) continue;
          const alt = c.alt[d * nb + k];
          if (up && !alt) die |= 1 << k;
          else if (!up && alt) need |= 1 << k;
        }
        if (up) {
          variants.push({ dx: up.dx, dz: up.dz, high: up.high, dist: up.dist, die, need: 0 });
        } else if (need) {
          // The rubble's own facing: measured in the state that has it.
          let src = null;
          for (let k = 0; k < nb && !src; k++) if (need & (1 << k)) src = c.alt[d * nb + k];
          variants.push({ dx: src.dx, dz: src.dz, high: src.high, dist: src.dist, die: 0, need });
        }
      }
      if (!variants.length) continue;
      const p = byCell.get(c.i);
      if (p) {
        /**
         * Already a cover point, and the facing it is using is the FIRST
         * standing one — `build` walks the same eight directions in the same
         * order and stops at the same ray. If the mass behind that facing is
         * nobody's to take away, nothing that happens to a block can touch this
         * point and it is left without a variant list at all.
         */
        const primary = variants.find((v) => v.need === 0);
        if (!primary || primary.die === 0) continue;
        p.variants = variants;
        dependent++;
      } else {
        /**
         * NOT A COVER POINT TODAY, AND `build`'S OWN FILTER IS WHY: this pass
         * sweeps every walkable cell in the rect, while `build` skips the ones
         * standing in the open with no blocked neighbour. So the STANDING
         * facings found here are ones the design already refused, and letting
         * them in through this door would put cover on the intact map that was
         * never there — measured at +10 points before this line existed.
         *
         * The rubble is the exception, and the only one. A cell in the open
         * that a collapse fills with corner stub and slab is cover by the same
         * ray test everything else passes, so it is baked DEAD with its
         * standing facings dropped: with no block down it has nothing usable
         * and the table is exactly what `build` produced.
         */
        // …and only where the change ADDS mass to open ground: a block that
        // booted as a ruin gains a WALL when it is put back, and the cell it
        // appears on stops being walkable, so there is no point to invent.
        const rubble = variants.filter((v) => (v.need & ~this.bakeMask) !== 0);
        if (!rubble.length) continue;
        fresh.push({
          x: c.x, y: c.y, z: c.z,
          dx: rubble[0].dx, dz: rubble[0].dz,
          high: rubble[0].high,
          dist: rubble[0].dist,
          claimed: -1,
          score: 0,
          live: false,
          cell: c.i,
          variants: rubble,
        });
        created++;
      }
    }
    for (const p of fresh) this.all.push(p);

    this.dynamic = dependent > 0 || created > 0;
    if (this.dynamic) {
      // The live set stops being the whole table, so it needs its own array —
      // sized once, here, and never grown again. `applyBlocks` writes into it
      // by index and moves `length`; it allocates nothing.
      this.points = new Array(this.all.length);
      this._appliedMask = -1;
      // The state it was baked in, which is the one every ray in it agrees with.
      this.applyBlocks(this.bakeMask);
    }
    this.depMs = performance.now() - t0;
    this.depStats = { cells: cells.size, dependent, created };
    return this;
  }

  /**
   * THE SWAP, FOR SIX THINGS THAT MOVE INDEPENDENTLY. One pass over the table,
   * choosing each dependent point's first facing that describes real mass with
   * these blocks down, and dropping the points that have none.
   *
   * A point that leaves the live set gives up its claim on the way out: a claim
   * is a man's id, `release(id)` only ever reaches the points it can see, and a
   * point that came back later still carrying the id of a man who died two
   * rounds ago would be reserved for ever.
   *
   * O(points), allocation-free, and it is not on the per-frame path — see
   * `AiSystem.syncCoverBlocks`, which only calls it when a bit actually moved.
   */
  applyBlocks(mask) {
    if (!this.dynamic) return false;
    if (this._appliedMask === mask) return false;
    this.blockMask = mask;
    this._appliedMask = mask;
    // HOW THIS TOWN DIFFERS FROM THE ONE THE RAYS WERE FIRED IN. @see
    // `bakeBlockDeps`: `?demo=down` bakes with the blocks already ruins.
    const delta = mask ^ this.bakeMask;
    const live = this.points;
    let n = 0;
    for (let i = 0; i < this.all.length; i++) {
      const p = this.all[i];
      let ok = true;
      const vs = p.variants;
      if (vs !== null) {
        ok = false;
        for (let j = 0; j < vs.length; j++) {
          const v = vs[j];
          if (v.need !== 0 ? (v.need & delta) !== 0 : (v.die & delta) === 0) {
            p.dx = v.dx;
            p.dz = v.dz;
            p.high = v.high;
            p.dist = v.dist;
            ok = true;
            break;
          }
        }
      }
      if (ok) {
        p.live = true;
        live[n++] = p;
      } else if (p.live) {
        p.live = false;
        p.claimed = -1;
      }
    }
    live.length = n;
    return true;
  }

  /**
   * Best cover for an agent at `pos` against a threat at `threat`.
   * Scoring, in order of weight: does the blocker actually sit between us and
   * the threat, is the spot a sensible distance from both, is it free, and does
   * a peek from it have line of sight (a hole to shoot through).
   */
  pick(pos, threat, opts = {}) {
    const wantMin = opts.minRange ?? 6;
    const wantMax = opts.maxRange ?? 26;
    const claimId = opts.id ?? -1;
    const squad = opts.squad ?? null;
    const maxTravel = opts.maxTravel ?? 22;
    const yRef = opts.yRef ?? null;
    const yTol = opts.yTol ?? Infinity;
    /**
     * OBJECTIVE PULL. Cover chosen purely for protection is cover that never
     * moves, and in a 7v7 demolition round that produced a static firefight on
     * the spawn line for the whole two minutes: eleven of thirteen actors sat in
     * COMBAT eight seconds after the round went live and none of them ever
     * played the objective again.
     *
     * `toward` biases the score by how much closer a cover point is to where
     * this actor is supposed to end up, so an attacker under fire advances from
     * cover to cover instead of holding the line. Defenders pass no `toward` and
     * behave exactly as before — holding IS their objective.
     */
    const toward = opts.toward ?? null;
    const towardW = opts.towardWeight ?? 0.55;
    /**
     * A point this search may NOT return, and the reason cover rotation works
     * at all. A man standing in a cover point scores it better than anywhere
     * else — zero travel, already claimed to him, still protecting him — so a
     * re-pick without this returns where he already is and he never moves. See
     * `coverDwell` in agent.js.
     */
    const avoid = opts.avoid ?? null;
    /**
     * ════════════════════════════════════════════════════════════════════════
     * THE MARKSMAN'S THREE OPTIONS. All default to the behaviour this method
     * has always had, so a man who does not ask for them is scored by exactly
     * the same arithmetic as before.
     * ════════════════════════════════════════════════════════════════════════
     * `maxThreat` was a hard-coded 40 m ceiling, and it is a ceiling on the
     * FIGHT and not on the cover: a man whose `traits.range` is 48 m could
     * never be offered a single position, because every point that far from the
     * contact was skipped before it was scored. He therefore fought at the same
     * distance as everybody else — which is most of the reason "a sniper" was
     * indistinguishable from "a bot with a tighter cone".
     *
     * `heightBias` is metres-of-rise turned into score. It is the "高台を優先"
     * half of the request and it is deliberately measured against THE MAN'S OWN
     * FEET rather than against sea level, so it means "somewhere higher than
     * here" on a map whose ground is not flat.
     *
     * `comp` is the thing that makes the height preference safe, and it is not
     * optional decoration. MEASURED on this level: of 6095 baked cover points,
     * 1293 sit above 2.5 m and NOT ONE of them shares a nav component with any
     * square a bot ever stands on. They are roofs, parapets and upper floors —
     * the height field samples from above, so a roof is a perfectly walkable
     * cell 6.5 m up, and a 6.4 m step off the pavement is not a step. Scoring
     * height without this filter aims every marksman at a roof he cannot reach,
     * `_goTo` gets 0 waypoints back, and that is precisely the doorway-stuck
     * epidemic in a new costume. A component label is symmetric — the step test
     * that built it is — so "same component" is also the proof he can get back
     * DOWN from whatever he climbs.
     */
    const maxThreat = opts.maxThreat ?? 40;
    const heightBias = opts.heightBias ?? 0;
    const indoorBonus = opts.indoorBonus ?? 0;
    /**
     * ════════════════════════════════════════════════════════════════════════
     * FIGHT FROM THE POINT — "行くけど、もっと占領するために敵を倒すというのがない"
     * ════════════════════════════════════════════════════════════════════════
     * `toward` is a GRADIENT and that is exactly why it could not do this job.
     * It pays a man for every metre he gets nearer the objective, so it walks
     * him at the circle and then keeps paying him for standing at its edge —
     * and the range window fights it the whole way, because `traits.range` is 21
     * to 44 m for most of this roster and a capture point is where the contacts
     * are. MEASURED on the build before this: 16.9 % of live men were inside a
     * capture circle at any moment and the mean fireteam had 0.35 of its four
     * men on the paint. They arrive and then drift off to fight at the distance
     * they like.
     *
     * A STEP FUNCTION IS THE HONEST SHAPE. Standing on the point is worth
     * something and standing 2 m outside it is worth nothing: that is what a
     * capture circle IS. So `holdBonus` is a flat award for a point inside
     * `holdRadius` of `holdAt`, big enough to buy off the range penalty (0.55 a
     * metre) over the ~10 m a man would otherwise back off, and it is bounded by
     * `maxTravel` exactly as everything else here is — nobody is dragged across
     * the map by it.
     *
     * The squad-spacing term below still applies inside the circle, which is
     * what keeps this from re-making the ten-man blob: four men on one point are
     * four men on four different sandbags of it.
     */
    const holdAt = opts.holdAt ?? null;
    const holdR2 = (opts.holdRadius ?? 0) ** 2;
    const holdBonus = opts.holdBonus ?? 0;
    const comp = opts.comp ?? -1;
    const compArr = comp >= 0 ? this.grid?.comp ?? null : null;
    const dTowardNow = toward ? Math.hypot(toward.x - pos.x, toward.z - pos.z) : 0;
    let best = null;
    let bestScore = -Infinity;
    const tx = threat.x, tz = threat.z;
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      if (p === avoid) continue;
      if (p.claimed >= 0 && p.claimed !== claimId) continue;
      if (compArr !== null && compArr[p.cell] !== comp) continue;
      const toThreatX = tx - p.x, toThreatZ = tz - p.z;
      const dT = Math.hypot(toThreatX, toThreatZ);
      if (dT < 2.5 || dT > maxThreat) continue;
      const travel = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (travel > maxTravel) continue;
      if (yRef !== null && Math.abs(p.y - yRef) > yTol) continue;
      // protection: the blocker must be on the threat side
      const prot = (toThreatX / dT) * p.dx + (toThreatZ / dT) * p.dz;
      if (prot < 0.25) continue;
      let score = prot * 5 + (p.high ? 2.2 : 1.0);
      // range preference
      if (dT < wantMin) score -= (wantMin - dT) * 0.55;
      else if (dT > wantMax) score -= (dT - wantMax) * 0.28;
      score -= travel * 0.16;
      /**
       * HEIGHT AND A ROOM. Both are opt-in and both are bounded: the rise is
       * clamped at 6 m so one freak cell cannot outscore protection itself,
       * and it is one-sided — a position BELOW him is not punished, it simply
       * earns nothing, because a marksman driven off every dip in the road is
       * a marksman who spends the round walking.
       */
      if (heightBias !== 0) score += Math.min(6, Math.max(0, p.y - pos.y)) * heightBias;
      if (indoorBonus !== 0 && p.indoor) score += indoorBonus;
      // ON THE PAINT. A step, not a gradient. @see the `holdAt` note above.
      if (holdBonus !== 0 && holdAt !== null) {
        const hx = holdAt.x - p.x, hz = holdAt.z - p.z;
        if (hx * hx + hz * hz <= holdR2) score += holdBonus;
      }
      // Progress toward the objective, in metres gained, scaled.
      if (toward) {
        const gain = dTowardNow - Math.hypot(toward.x - p.x, toward.z - p.z);
        score += gain * towardW;
      }
      // do not bunch up
      if (squad) {
        for (const other of squad) {
          if (!other || other.id === claimId || !other.alive) continue;
          const d = Math.hypot(other.position.x - p.x, other.position.z - p.z);
          if (d < 3.2) score -= (3.2 - d) * 1.4;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best && claimId >= 0) {
      for (const p of this.all) if (p.claimed === claimId) p.claimed = -1;
      best.claimed = claimId;
    }
    return best;
  }

  release(claimId) {
    // `all`, not `points`: a man can be holding a point that a block came down
    // on since he took it, and that claim has to come off too.
    for (const p of this.all) if (p.claimed === claimId) p.claimed = -1;
  }

  /**
   * Drop EVERY claim on this table.
   *
   * A claim is a man's id written into a point, and it is the only thing that
   * stops two soldiers being sent to the same doorway. When `ai` swaps one
   * table out for another (@see `AiSystem.setCoverRazed`) the table leaving
   * play keeps whatever ids were on it, and nothing will ever come back to
   * clear them — `release(id)` is called on the LIVE table when a man dies or
   * repaths. So a table swapped back in later would start with a set of points
   * permanently reserved for men who no longer exist.
   *
   * One pass over an array that already exists, on an event frame. It allocates
   * nothing and it is not on the per-frame path.
   */
  releaseAll() {
    for (const p of this.all) p.claimed = -1;
    return this;
  }

  /**
   * Where to lean out from a cover point to shoot: try both sides and pick the
   * one with line of sight from the eye to the threat.
   */
  peekOffset(cover, threat, eyeH, out) {
    const phys = this.physics;
    // lateral axis = perpendicular to the cover facing
    const lx = -cover.dz, lz = cover.dx;
    const from = this._v;
    const to = this._v2.set(threat.x, threat.y, threat.z);
    for (const s of [1, -1, 0]) {
      const px = cover.x + lx * 0.62 * s;
      const pz = cover.z + lz * 0.62 * s;
      from.set(px, cover.y + eyeH, pz);
      if (phys.lineOfSight(from, to, phys.MASK.SIGHT)) {
        out.set(px, cover.y, pz);
        return s;
      }
    }
    out.set(cover.x, cover.y, cover.z);
    return 0;
  }
}

/* ================================================================== */
/* THE UPPER POST                                                     */
/* ================================================================== */

/**
 * ────────────────────────────────────────────────────────────────────────────
 * STAIRS, FOR TWO OR THREE MEN — "屋内にAI入るけど2階とか屋上には来ないね ちゃんと
 * 行動させて、そこにも 上から打つのは強いから 全員がそういう行動取るんじゃなくて２人や
 * ３人くらい"
 * ────────────────────────────────────────────────────────────────────────────
 *
 * WHAT IS ACTUALLY WRONG, MEASURED FIRST. `NavGrid` is a 2.5D height field: one
 * floor per cell. Inside a building `_carveInteriors` keeps the GROUND storey
 * and throws away everything above `floorY + 0.9`, so an upper floor is not in
 * the graph at all and a staircase is truncated at knee height. Swept on this
 * map (`_sixaudit.mjs`, seed 7): 36 820 walkable cells sit above 2.5 m, in
 * 2113 separate components, and 865 of the baked cover points are up there —
 * NONE of them joined to the ground. `_measureClimbs` finds 24 climb edges in
 * the whole level. Men above 2.5 m over a 192 s round: ZERO, for zero seconds.
 *
 * MAKING THE UPPER STOREYS PROPERLY NAVIGABLE IS A MULTI-LEVEL NAVMESH and it
 * is out of scope by a wide margin: every cell index in this file, every
 * component label, every cover point, `escape`, `drop`, `_carveInteriors` and
 * A* itself are single-valued in (x, z). The honest smallest thing is this
 * class, and it rests on ONE FACT THE FILE ALREADY WRITES DOWN TWICE: the
 * capsule can walk a staircase. `STANCE.stand.stepHeight` is 0.42 and the
 * treads are 0.19. Only A* cannot see them.
 *
 * So this does not extend the grid. It measures, at boot, ONE ROUTE UP AND
 * BACK per enterable building, as a list of world points, and `Agent._runPost`
 * walks it with the same `_commitDetour` machinery `_descend` already uses to
 * get a man OFF a roof. Two men a side may hold one at a time
 * (`Squad.postTokens`), which is the "２人や３人くらい" the request asks for.
 *
 * THE METHOD IS `tools/floorcheck.mjs`'S, IN THE BOT'S OWN CAPSULE. Cast down
 * each column of the footprint repeatedly, keep every horizontal surface with
 * standing room, link surfaces 4-ways when they are within one `maxStep` of
 * each other, and flood from the ground floor. A stair links ITSELF into that
 * graph without being special-cased — which is the whole reason it is done this
 * way rather than by pattern-matching a flight. What comes back is a BFS tree,
 * and the route is a walk up its parents.
 *
 * MEASURED before it was written (`_sixstairs.mjs` / `_sixfoot.mjs`, seed 7):
 * all ten interior volumes have a real flight (49-101 tread cells with standing
 * room, rising 1.9-2.4 m), every first floor has 542-1040 standing cells on it,
 * and A* can already deliver a man to the foot of every one of them from
 * 42 of 42 spawn points. Nothing about the level had to change.
 */

/** Metres between column samples. The nav grid's own cell, so the step test
 *  between two neighbours is the step test the controller will actually make. */
const POST_CELL = 0.8;
/** How far above a volume's floor a storey has to be to count as UPSTAIRS. */
const POST_UP_MIN = 2.4;
/** …and the ceiling on the scan, so this never walks a man onto a roof it has
 *  not proved a way down from. One storey. */
const POST_UP_MAX = 4.4;
/** Surfaces per column. Ground, mid-flight, first floor — three is enough for
 *  one storey and it bounds the working set at nx*nz*3 nodes per volume. */
const POST_SURF = 5;
/** Route waypoints are thinned to this spacing; the detour's own arrival
 *  radius is 0.6 m, so anything tighter is a waypoint he is already standing on. */
const POST_WP_GAP = 1.6;
/** How many firing positions to keep per building, and how far apart. */
const POST_STANDS = 3;
const POST_STAND_GAP = 3.0;

export class StairMap {
  constructor(physics, grid) {
    this.physics = physics;
    this.grid = grid;
    /**
     * One per enterable building that has a walkable way up:
     *   { building, route: Vector3[], stand: Vector3[], top, foot: Vector3 }
     * `route` starts on the nav grid (so `_goTo` can deliver a man to
     * `route[0]`) and ends on the first floor. Walked forwards to go up and
     * backwards to come down — a step graph is symmetric, so the way up IS the
     * way down and no second measurement is needed.
     */
    this.posts = [];
    this.ms = 0;
    this.columns = 0;
    /** Per volume: why it did or did not yield a post. Report-time only. */
    this.diag = [];
  }

  build(volumes) {
    const t0 = performance.now();
    this.posts.length = 0;
    this.columns = 0;
    this.diag.length = 0;
    if (!volumes || !volumes.length) return this;
    for (const v of volumes) this._one(v);
    this.ms = performance.now() - t0;
    return this;
  }

  /** Nearest post to a world point that this man's component can reach, or null. */
  nearest(x, z, maxDist = Infinity) {
    let best = null, bestD = maxDist * maxDist;
    for (const p of this.posts) {
      const dx = p.route[0].x - x, dz = p.route[0].z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  /**
   * `NavGrid._treadLadder` in world coordinates: does the surface between two
   * samples climb in treads a 0.42 m step offset can take, with room over each
   * one? Same five sample points, same two constants, same three refusals —
   * kept as its own copy only because that one takes cell indices and this is a
   * lattice of its own. @see the call site in `_one`'s flood.
   */
  _treads(x0, z0, y0, x1, z1, y1) {
    const phys = this.physics;
    const MASK = phys.MASK.WORLD;
    const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
    const top = hi + 0.75;
    const len = (hi - lo) + 1.3;
    let prev = y0;
    for (let s = 1; s <= 3; s++) {
      const t = s * 0.25;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      const down = phys.raycast(x, top, z, 0, -1, 0, len, MASK);
      if (!down.hit) return false;
      const y = down.point.y;
      if (y < lo - 0.08 || y > hi + 0.08) return false;
      if (Math.abs(y - prev) > CLIMB_TREAD) return false;
      if (phys.raycastAny(x, y + 0.22, z, 0, 1, 0, this.grid.crouchHeight, MASK)) return false;
      prev = y;
    }
    return Math.abs(y1 - prev) <= CLIMB_TREAD;
  }

  _one(v) {
    const d = { b: v.building, surfaces: 0, seeds: 0, reached: 0, maxRel: 0, why: 'ok' };
    this.diag.push(d);
    const phys = this.physics;
    const MASK = phys.MASK.WORLD;
    const g = this.grid;
    const R = g.radius, H = g.height, STEP = g.maxStep;
    const nx = Math.ceil((v.hw * 2) / POST_CELL) + 1;
    const nz = Math.ceil((v.hd * 2) / POST_CELL) + 1;
    const N = nx * nz;
    // Node k = cell * POST_SURF + s. `-Infinity` marks an empty slot.
    const sy = new Float32Array(N * POST_SURF).fill(-Infinity);
    const wx = new Float32Array(N);
    const wz = new Float32Array(N);
    const p0 = this._p0 ?? (this._p0 = new THREE.Vector3());
    const p1 = this._p1 ?? (this._p1 = new THREE.Vector3());

    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const lx = -v.hw + ix * POST_CELL;
        const lz = -v.hd + iz * POST_CELL;
        const cell = iz * nx + ix;
        if (Math.abs(lx) > v.hw || Math.abs(lz) > v.hd) continue;
        // Back onto world axes. `c`/`s` are the volume's own rotation, exactly
        // as `_carveInteriors` uses them — but INVERTED, because that pass goes
        // world -> local and this one goes local -> world.
        const x = v.cx + lx * v.c + lz * v.s;
        const z = v.cz - lx * v.s + lz * v.c;
        wx[cell] = x; wz[cell] = z;
        let y = v.floorY + POST_UP_MAX + 1.2;
        let found = 0;
        this.columns++;
        for (let k = 0; k < 8 && found < POST_SURF; k++) {
          const hit = phys.raycast(x, y, z, 0, -1, 0, POST_UP_MAX + 2.4, MASK);
          if (!hit.hit) break;
          const h = hit.point.y;
          if (h < v.floorY - 0.5) break;
          if (hit.normal.y >= g.maxSlope) {
            p0.set(x, h + R + 0.06, z);
            p1.set(x, h + H - R, z);
            if (!phys.checkCapsule(p0, p1, R, MASK)) {
              sy[cell * POST_SURF + found] = h;
              found++; d.surfaces++;
            }
          }
          y = h - 0.08;
        }
        // Lowest first, so slot 0 is the ground storey wherever there is one.
        for (let a = 0; a < found - 1; a++) {
          for (let b = a + 1; b < found; b++) {
            const ka = cell * POST_SURF + a, kb = cell * POST_SURF + b;
            if (sy[kb] < sy[ka]) { const t = sy[ka]; sy[ka] = sy[kb]; sy[kb] = t; }
          }
        }
      }
    }

    /* ---- flood from the ground floor, one step at a time ---- */
    const M = N * POST_SURF;
    const parent = new Int32Array(M).fill(-2);   // -2 unvisited, -1 a seed
    const queue = new Int32Array(M);
    let head = 0, tail = 0;
    for (let cell = 0; cell < N; cell++) {
      const k = cell * POST_SURF;
      if (sy[k] === -Infinity) continue;
      if (sy[k] - v.floorY > 0.6) continue;      // not the ground storey
      parent[k] = -1;
      queue[tail++] = k;
    }
    d.seeds = tail;
    if (tail === 0) { d.why = 'no ground-floor seed'; return; }
    const DXS = [1, -1, 0, 0];
    const DZS = [0, 0, 1, -1];
    while (head < tail) {
      const k = queue[head++];
      const cell = (k / POST_SURF) | 0;
      const ix = cell % nx, iz = (cell / nx) | 0;
      const y = sy[k];
      for (let d = 0; d < 4; d++) {
        const jx = ix + DXS[d], jz = iz + DZS[d];
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        const jc = jz * nx + jx;
        for (let s = 0; s < POST_SURF; s++) {
          const j = jc * POST_SURF + s;
          if (sy[j] === -Infinity) continue;
          if (parent[j] !== -2) continue;
          if (sy[j] - v.floorY > POST_UP_MAX) continue;
          /**
           * A FLIGHT IS STEEPER THAN THE LATTICE, and this is the line that
           * decides whether this class finds anything at all. A 32° stair rises
           * 0.19 m per 0.275 m tread, i.e. 0.55 m across one 0.8 m sample —
           * over `maxStep` 0.42, so a plain step test refuses every flight on
           * the map. Measured on the first run: three of ten buildings yielded
           * a post and the other seven flooded to 0.28-0.91 m and stopped, one
           * tread up, exactly as `NavGrid._measureClimbs`' own header says they
           * would.
           *
           * `_treads` is that method's `_treadLadder` in world coordinates: it
           * re-asks the question the capsule actually asks — does the surface
           * between these two samples climb in steps of 0.4 m or less, with
           * head clearance over each one. A stair passes, a 0.6 m ledge does
           * not, and a roof over a void does not.
           */
          const dy = Math.abs(sy[j] - y);
          if (dy > STEP && (dy > CLIMB_MAX * 2
            || !this._treads(wx[cell], wz[cell], y, wx[jc], wz[jc], sy[j]))) continue;
          parent[j] = k;
          queue[tail++] = j;
        }
      }
    }

    /* ---- the firing positions: upstairs, and against an outside wall ---- */
    let bestUp = -1, bestScore = -Infinity;
    const cand = [];
    for (let k = 0; k < M; k++) {
      if (parent[k] === -2 || sy[k] === -Infinity) continue;
      const rel = sy[k] - v.floorY;
      d.reached++;
      if (rel > d.maxRel) d.maxRel = +rel.toFixed(2);
      if (rel < POST_UP_MIN) continue;
      const cell = (k / POST_SURF) | 0;
      const ix = cell % nx, iz = (cell / nx) | 0;
      // How close to the edge of the footprint: a man who is going to shoot out
      // of a window has to be standing at one.
      const edge = Math.min(ix, nx - 1 - ix, iz, nz - 1 - iz);
      const score = rel * 2 - edge;
      cand.push(k);
      if (score > bestScore) { bestScore = score; bestUp = k; }
    }
    if (bestUp < 0) { d.why = 'flood never reached an upper storey'; return; }

    /* ---- walk the parents back down to the ground seed ---- */
    const raw = [];
    for (let k = bestUp; k !== -1; k = parent[k]) {
      const cell = (k / POST_SURF) | 0;
      raw.push(new THREE.Vector3(wx[cell], sy[k], wz[cell]));
      if (raw.length > 4096) return;             // cannot happen; not trusted to
    }
    raw.reverse();
    // Thin it. The first and last are always kept: the first is the handover
    // from A*, the last is the position itself.
    const route = [raw[0]];
    for (let i = 1; i < raw.length - 1; i++) {
      const p = route[route.length - 1];
      if (raw[i].distanceToSquared(p) >= POST_WP_GAP * POST_WP_GAP) route.push(raw[i]);
    }
    route.push(raw[raw.length - 1]);

    /**
     * THE HANDOVER HAS TO BE ON THE HEIGHT FIELD or `_goTo` cannot deliver
     * anybody to it. The seed is a ground-floor cell inside a carved interior,
     * so it normally IS on the grid; snapping makes that a fact rather than an
     * assumption, and a building whose foot does not snap is dropped instead of
     * becoming an order nobody can fill.
     */
    const foot = route[0];
    const ci = g.nearest(foot.x, foot.z, foot.y, 4, 1.6);
    if (ci < 0) { d.why = 'foot of the flight is not on the height field'; return; }
    foot.set(g.worldX(ci % g.nx), g.floor[ci], g.worldZ((ci / g.nx) | 0));

    /* ---- two or three places to stand once he is up ---- */
    cand.sort((a, b) => {
      const ca = (a / POST_SURF) | 0, cb = (b / POST_SURF) | 0;
      const ea = Math.min(ca % nx, nx - 1 - (ca % nx), ((ca / nx) | 0), nz - 1 - ((ca / nx) | 0));
      const eb = Math.min(cb % nx, nx - 1 - (cb % nx), ((cb / nx) | 0), nz - 1 - ((cb / nx) | 0));
      return ea - eb;
    });
    const stand = [];
    for (const k of cand) {
      if (stand.length >= POST_STANDS) break;
      const cell = (k / POST_SURF) | 0;
      const p = new THREE.Vector3(wx[cell], sy[k], wz[cell]);
      let ok = true;
      for (const q of stand) if (q.distanceToSquared(p) < POST_STAND_GAP * POST_STAND_GAP) { ok = false; break; }
      if (ok) stand.push(p);
    }
    if (!stand.length) stand.push(route[route.length - 1].clone());

    this.posts.push({
      building: v.building,
      route,
      stand,
      foot,
      top: route[route.length - 1].y,
      /** Who is on it, or -1. One man per building — @see `Squad.claimPost`. */
      held: -1,
    });
  }
}
