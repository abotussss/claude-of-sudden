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

class Heap {
  constructor(cap) {
    this.idx = new Int32Array(cap);
    this.key = new Float32Array(cap);
    this.n = 0;
  }

  clear() {
    this.n = 0;
  }

  push(i, k) {
    if (this.n >= this.idx.length) return;
    let c = this.n++;
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
     * DIAGONAL STEPS THE CORNER RULE WOULD REFUSE AND A SWEPT CAPSULE ALLOWS.
     * Bit d (4..7) set means "this diagonal was MEASURED passable". Written only
     * for the interior pass, so the open-air grid behaves exactly as it always
     * has. @see `_carveInteriors` — without it a 1.12 m doorway that happens to
     * fall diagonally across a 0.8 m lattice is a locked door.
     */
    this.diag = new Uint8Array(n);

    // A* working set
    this.gScore = new Float32Array(n);
    this.came = new Int32Array(n);
    this.visitStamp = new Int32Array(n);
    this.stamp = 0;
    /**
     * The open list. Capped at 65536 it was comfortably larger than the whole
     * 221 x 221 grid; the level is 1.5x and the grid is 109k cells, so the cap
     * became a SILENT one — `Heap.push` returns without pushing when it is
     * full, and a search that overflows quietly reports "no route" instead of
     * failing loudly. Sized to the grid.
     */
    this.open = new Heap(Math.min(n, 1 << 18));

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
    this.buildMs = performance.now() - t0;
    return this;
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
  nearest(x, z, y = null, maxRings = 8, yTol = Infinity) {
    const cx = this.cellX(x), cz = this.cellZ(z);
    const okY = (i) => y === null || Math.abs(this.floor[i] - y) <= yTol;
    if (this.walkable(cx, cz) && okY(this.index(cx, cz))) return this.index(cx, cz);
    for (let ring = 1; ring <= maxRings; ring++) {
      let best = -1, bestD = Infinity;
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const ix = cx + dx, iz = cz + dz;
          if (!this.walkable(ix, iz)) continue;
          const i = this.index(ix, iz);
          if (!okY(i)) continue;
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
   * A* between two world points. Writes world-space waypoints into `out`
   * (an array of THREE.Vector3, reused) and returns the count.
   */
  findPath(from, to, out, opts = {}) {
    const start = this.nearest(from.x, from.z, from.y);
    const goal = this.nearest(to.x, to.z, to.y);
    if (start < 0 || goal < 0) return 0;
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
     */
    const maxNodes = opts.maxNodes ?? 24000;

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
        // no corner cutting, unless the interior pass measured this diagonal
        if (dx && dz && !this._canStep(cur, cxi, czi, d)) continue;
        const ni = this.index(ix, iz);
        const dy = this.floor[ni] - cy;
        if (Math.abs(dy) > this.maxStep) continue;
        let cost = (dx && dz ? SQRT2 : 1) * cell;
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
      if (ix !== px && iz !== pz) {
        const ddx = ix - px, ddz = iz - pz;
        const d = Math.abs(ddx) === 1 && Math.abs(ddz) === 1 ? 4 + (ddx < 0 ? 2 : 0) + (ddz < 0 ? 1 : 0) : -1;
        if (d < 0 || !this._canStep(this.index(px, pz), px, pz, d)) return false;
      }
      px = ix;
      pz = iz;
      const y = this.floor[this.index(ix, iz)];
      if (Math.abs(y - prevY) > this.maxStep) return false;
      prevY = y;
    }
    return true;
  }
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
/** The index of the opposite direction, so a measured edge writes both ends. */
const OPP = [1, 0, 3, 2, 7, 6, 5, 4];

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
    this.points = [];
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
    this.points.length = 0;
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
          this.points.push({
            x, y, z,
            dx, dz, // direction the cover faces (toward the blocker)
            high,
            dist: low.distance,
            claimed: -1,
            score: 0,
          });
          break;
        }
      }
    }
    this.buildMs = performance.now() - t0;
    return this;
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
    const dTowardNow = toward ? Math.hypot(toward.x - pos.x, toward.z - pos.z) : 0;
    let best = null;
    let bestScore = -Infinity;
    const tx = threat.x, tz = threat.z;
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      if (p === avoid) continue;
      if (p.claimed >= 0 && p.claimed !== claimId) continue;
      const toThreatX = tx - p.x, toThreatZ = tz - p.z;
      const dT = Math.hypot(toThreatX, toThreatZ);
      if (dT < 2.5 || dT > 40) continue;
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
      for (const p of this.points) if (p.claimed === claimId) p.claimed = -1;
      best.claimed = claimId;
    }
    return best;
  }

  release(claimId) {
    for (const p of this.points) if (p.claimed === claimId) p.claimed = -1;
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
