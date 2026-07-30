/**
 * MATCH — the bomber run.
 *
 * "敵の戦闘機の爆弾投下も適宜行なって。守る側有利にして" — the other half of
 * the air brief. Where `src/match/airstrike.js` drops ONE bomb on ONE building
 * and rearranges it, this is an aircraft that crosses the map and WALKS a stick
 * of bombs along a line. The two are deliberately different weapons:
 *
 *                     airstrike                  bomber run
 *   shape             one point                  a 22-68 m line of 5-8 craters
 *   telegraph         jet, then a whistle        the aeroplane itself, visible
 *                                                for 2.4 s before the first
 *                                                bomb is even released
 *   what it does      takes a storey down and    cuts a lane in half for four
 *                     leaves permanent cover     seconds and leaves craters
 *   the answer        get off that street        get OUT of the lane, and there
 *                                                is no cover inside it that
 *                                                helps, because the stick walks
 *   per bomb          15 m / 260 (or 11 / 190)   9 m / 165
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EVERYTHING IS BAKED AT BOOT. NOTHING IS SOLVED WHEN IT FIRES.
 * ────────────────────────────────────────────────────────────────────────────
 * The same rule as airstrike.js, and the same machinery — this file imports
 * that one's `fracture`, `chunkGeometry`, `mergeGeometries` and, above all,
 * `makeChunkMaterial`, so the debris moves on the identical closed-form vertex
 * program. At `build()`, per run:
 *
 *   - the IMPACT POINTS. Authored as a line in level space; each bomb's ground
 *     height is probed once, here, with the same downward ray the airstrike
 *     uses for its roofs. In the frame a bomb lands there is no raycast.
 *
 *   - the TIMELINE, closed form. Fall time from the release altitude is solved
 *     per bomb (it depends on the ground under that bomb), the aircraft's lead
 *     is `speed * fall`, and from those two the release time and the impact
 *     time of every bomb in the stick are constants. The aeroplane's position
 *     is `start + dir * speed * t`, evaluated into a scratch vector; a bomb's
 *     is `release + dir * speed * dt + (0, -v0*dt - g*dt²/2, 0)`. No
 *     integrator, and nothing that can drift.
 *
 *   - the CRATER DEBRIS, as ONE InstancedMesh for the whole stick: 40 chunks
 *     per bomb, each with its delay set to ITS OWN bomb's impact time. So the
 *     entire run — seven separate bursts, spread over four seconds — is driven
 *     by ONE uniform write per frame, and the frame a bomb lands does no work
 *     for the debris at all. The chunks rest BELOW the tarmac and are lifted
 *     out along their baked arc, which is why the burst reads as ground being
 *     thrown up rather than as boxes appearing.
 *
 *   - the SETTLED POSE, pre-filled, memcpy'd into `instanceMatrix` when the
 *     dust is down exactly as the airstrike does it.
 *
 * WHAT IT DELIBERATELY DOES NOT BAKE is collision and navigation. A crater is
 * a hole and a scatter of grit, not a mound: there is nothing here for a man to
 * climb or to be blocked by, so the BVH and `ai.grid` are never touched. That
 * is not a shortcut, it is the reason a bomber run can be scheduled three times
 * a round on the attackers' route without `tools/navcheck.mjs` ever being able
 * to regress.
 *
 * The frame a bomb lands does: one `explosion` event, one uniform write that
 * was going to happen anyway, and three `fx` calls that write into preallocated
 * rings.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLIC API   const b = ctx.get('match').bomber
 * ────────────────────────────────────────────────────────────────────────────
 *   b.runs                   [{ id, name, bombs, ... }]  world space
 *   b.fire(indexOrId)        launch a run now
 *   b.flown(index)           has this one already been flown this round?
 *   b.reset()                round reset: craters gone, debris back under
 *   b.enabled                false stops the scheduler
 *   b.busy                   true while an aircraft is in the air
 *   b.setFocus(v)            where the fight is; biases which line is flown
 *   b.onAnnounce = (a) => {} the moment a run is launched, with the reused
 *                            announce record. `match` turns it into the HUD
 *                            warning — see src/ui/airalert.js for why a weapon
 *                            nobody is told about did not happen.
 *   b.onImpact = (a) => {}   the first bomb of the stick going off
 *
 * Emits `match:bomber { phase, run, position }` with phase
 * 'inbound' | 'impact' | 'settled'.
 */

import * as THREE from 'three';
import { RULES } from './rules.js';
import { chunkGeometry, clamp, makeChunkMaterial, mergeGeometries } from './airstrike.js';

/** Same 1.5x as sites.js and airstrike.js. IF ONE MOVES, MOVE THE OTHERS. */
const SCALE = 1.5;
const L = (x, z) => [x * SCALE, z * SCALE];

/**
 * THE RUNS, as the line the BOMBS land on — not the line the aeroplane flies.
 *
 * Authoring the impact line is the only way to place this weapon honestly: the
 * aircraft's track is that line pushed back by `speed * fall`, which is 67 m,
 * and no one can author 67 m of lead in their head and be right about where the
 * craters end up.
 *
 * WHERE THEY ARE — the same geometric argument as `STRIKE_SITES`, measured off
 * the map's own A*:
 *
 *     attack spawn -> either site   level z from +66.7 down to  -5.8
 *     defend spawn -> either site   level z from -67.1 up   to  -5.0
 *
 * Every one of the 23 impact points below is at level z between +4.0 and +40.0.
 * All four runs are therefore entirely inside the half of the map the attack
 * must cross and outside the half the defence walks, so a bomber run can only
 * ever be paid for by the side that is pushing. They are also kept clear of
 * both spawn clusters — the attack's nearest spawn point is at z = +51.2 and
 * the northernmost impact is at z = +40.0, which is 11.2 m, more than the 9 m
 * blast. A stick of bombs in a spawn is not a hazard, it is a coin flip.
 *
 * A BOMBER FLIES STRAIGHT, and that is a real constraint on where these can go.
 * The first pass at this file authored the lines as "spawn to site", which on
 * paper follows the attack — and a straight line from the east connector to the
 * B lane goes clean over a block of buildings, so four of seven bombs in that
 * stick landed on ROOFTOPS (probed at 9.6 m) and did nothing to anybody in the
 * lane below. The four lines below are each along ONE open corridor of the map,
 * checked at boot: `_buildRun` prints every impact that is more than 3 m off
 * the deck, and all 23 currently come in at or under 1.1 m.
 *
 * The map's open ground, from a 3 m roof-height sweep of the level:
 *
 *      west lane   x -45..-30      running in z
 *      mid street  x  -6..+12      running in z
 *      east lane   x +36..+45      running in z
 *      cross st.   z +15..+21      running in x, the full width of the map
 *      north st.   z +39..+45      running in x
 *
 *   MAIN   down the mid street both branches walk out of spawn.
 *   CROSS  the full width of the cross street — 68 m, the longest run on the
 *          map, and the band where BOTH branches turn out of the trunk toward
 *          their lane. One aircraft prices both routes at once.
 *   ALANE  down the west lane, the last open stretch before site A.
 *   BLANE  down the east lane, the same for site B.
 */
const RUNS = [
  { id: 'MAIN', name: 'MAIN STREET', from: L(-4.0, 26.67), to: L(-4.0, 12.0), bombs: 5 },
  { id: 'CROSS', name: 'CROSS STREET', from: L(-22.67, 12.0), to: L(22.67, 12.0), bombs: 8 },
  { id: 'ALANE', name: 'A LANE', from: L(-24.0, 20.0), to: L(-24.0, 2.67), bombs: 5 },
  { id: 'BLANE', name: 'B LANE', from: L(27.33, 18.67), to: L(27.33, 2.67), bombs: 5 },
];

/** Release altitude above the highest ground on the run, metres. */
const ALT = 42;
/** Aircraft ground speed, m/s. Slow for an aeroplane, readable for a player. */
const SPEED = 38;
/** Downward speed a bomb leaves the bay with — a shallow dive, not a level drop. */
const DROP_V = 14;
const G = 9.81;
/** How far back the aircraft enters before the first release point. */
const APPROACH = 90;
/** How far past the last release it keeps flying before it is put away. */
const EXIT = 120;
/** Chunks of tarmac and grit thrown out of each crater. */
const CHUNKS_PER_BOMB = 40;
/** Seconds after the last impact before the debris is baked down. */
const DEBRIS_SETTLE = 4.5;

const UP = new THREE.Vector3(0, 1, 0);
/**
 * Where the aircraft and the bombs sit when there is no run on.
 *
 * NOT `visible = false`, which is what this did first and what cost 174 ms ON
 * THE FIRE FRAME: three.js compiles a material's program the first time it is
 * actually drawn, so hiding the hardware until the run starts moves three
 * shader compiles onto the one frame the whole feature exists to keep cheap.
 * Parked 600 m under the map they are drawn from the first boot frame — inside
 * the loading state, where every other program in the game is also compiled —
 * and cost one culled draw call each thereafter. The crater debris does not
 * need this trick: its rest pose is already buried, so it is on screen from
 * boot and simply not visible.
 */
const PARKED_Y = -600;

/* -------------------------------------------------------------------------- */

export class Bomber {
  /**
   * @param {object} ctx   engine context
   * @param {object} opts  { rng }
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.rng = opts.rng ?? ctx.rng.fork();
    this.enabled = true;
    this.runs = [];
    this.ready = false;
    this.buildMs = 0;

    /** Runs currently in the air. At most one — the scheduler enforces it. */
    this._live = [];
    /** Seconds until the scheduler may launch. Set by `armRound`. */
    this._next = Infinity;
    /** Runs flown this round, against `RULES.bomberMaxPerRound`. */
    this._flown = 0;
    /**
     * The other air systems, so no two ever share the sky. Set by `match`;
     * accepts one object or an array. @see `_coBusy`
     */
    this.coBusy = null;

    /**
     * WHERE THE FIGHT IS. Four fixed lines on a 114x141 m map means three runs
     * out of four are somewhere the player is not — the same "空爆が全然発生し
     * ない" problem the airstrike has, for the same reason. `match` writes the
     * centre of the fight here and the draw is weighted by the distance from it
     * to the NEAREST POINT ON THE LINE, which is the right measure for a weapon
     * that is 68 m long.
     */
    this.focus = new THREE.Vector3();
    this.focusValid = false;
    this.focusScale = 30;

    /** Announce hooks, installed by `match`. */
    this.onAnnounce = null;
    this.onImpact = null;

    this.group = new THREE.Group();
    this.group.name = 'match-bomber';
    this.group.matrixAutoUpdate = false;

    /* scratch — nothing in update() or fire() allocates */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._sc = new THREE.Vector3();
    this._blast = { position: this._v2, radius: 0, damage: 0, source: 'bomber' };
    this._ev = { phase: '', run: '', position: this._v2 };
    /** The announce record. REUSED; `points` holds references, never copies. */
    this._ann = {
      kind: 'BOMBER',
      id: '',
      name: '',
      lead: 0,
      position: null,
      points: [null, null, null, null],
      count: 0,
    };
    this._cand = [];
    this._wt = [];
  }

  /** True while any co-system (airstrike, strafe) has something in the air. */
  get _coBusy() {
    const c = this.coBusy;
    if (!c) return false;
    if (Array.isArray(c)) {
      for (const o of c) if (o?.busy) return true;
      return false;
    }
    return !!c.busy;
  }

  /** Where the fight is. Copied; the caller's vector is not retained. */
  setFocus(v) {
    if (!v) {
      this.focusValid = false;
      return;
    }
    this.focus.copy(v);
    this.focusValid = true;
  }

  /* ====================================================================== */
  /* BOOT                                                                   */
  /* ====================================================================== */

  build() {
    const t0 = performance.now();
    const ctx = this.ctx;
    const world = ctx.peek('world');
    const physics = ctx.peek('physics');
    if (!world || !physics) {
      console.warn('[bomber] no world/physics — disabled');
      return this;
    }
    this.physics = physics;
    this._lib = ctx.peek('materials');

    this._buildAircraft();
    this._buildBombs();
    // Both parked under the map from the first frame — see PARKED_Y.
    this._park();
    for (let i = 0; i < RUNS.length; i++) {
      const run = this._buildRun(RUNS[i], i, world, physics);
      if (run) this.runs.push(run);
    }

    ctx.scene.add(this.group);
    this.ready = this.runs.length > 0;
    this.buildMs = performance.now() - t0;
    let chunks = 0;
    for (const r of this.runs) chunks += r.chunkCount;
    console.info(
      `[bomber] ${this.runs.length}/${RUNS.length} runs baked in ${this.buildMs.toFixed(0)}ms — ` +
        `${chunks} debris chunks, ` +
        this.runs
          .map((r) => `${r.id}:${r.bombs.length}x${r.spacing.toFixed(1)}m/${r.duration.toFixed(1)}s`)
          .join(' ')
    );
    return this;
  }

  /**
   * The aeroplane. One mesh, boxes merged at boot, +Z forward.
   *
   * It exists to be READ at 40 m against the sky in the two and a half seconds
   * before the first bomb is released, which is the only telegraph this weapon
   * has — so the silhouette carries it: a long fuselage, a straight high-aspect
   * wing, two underslung nacelles and a tall fin. It is kept out of the shadow
   * cascades (`owNoShadow`): a 17 m wingspan at 42 m sits outside the near
   * cascades and only ever costs a cascade draw for a shadow nobody sees.
   */
  _buildAircraft() {
    const box = (w, h, d, x, y, z) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      return g;
    };
    const geo = mergeGeometries([
      box(2.0, 2.0, 12.0, 0, 0, 0), // fuselage
      box(1.3, 1.3, 2.8, 0, -0.15, 7.0), // nose
      box(1.35, 0.85, 2.6, 0, 1.1, 3.0), // canopy
      box(17.0, 0.5, 3.6, 0, -0.35, -0.6), // wing
      box(6.4, 0.42, 2.0, 0, 0.45, -5.6), // tailplane
      box(0.42, 3.2, 2.4, 0, 1.9, -5.4), // fin
      box(1.55, 1.55, 4.4, 4.2, -1.05, 0.6), // port nacelle
      box(1.55, 1.55, 4.4, -4.2, -1.05, 0.6), // starboard nacelle
      box(0.45, 0.9, 1.2, 4.2, -0.5, 0.6), // pylons
      box(0.45, 0.9, 1.2, -4.2, -0.5, 0.6),
    ]);
    const mat = this._hullMaterial('metal_painted', 0x4a5048);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'match_bomber_aircraft';
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.userData.owNoShadow = true;
    this.group.add(mesh);
    this.aircraft = mesh;
    this.aircraftMat = mat;
  }

  /**
   * The bombs themselves, one InstancedMesh sized to the longest stick.
   *
   * `count` is set to how many are in the air, and because releases are evenly
   * spaced and every fall in a stick takes very nearly the same time, the bombs
   * in flight are always a contiguous run — so the live ones can be packed into
   * slots 0..k-1 and the draw call shrinks to nothing between runs.
   */
  _buildBombs() {
    let most = 0;
    for (const r of RUNS) most = Math.max(most, r.bombs);
    const body = new THREE.CylinderGeometry(0.19, 0.15, 1.35, 8, 1);
    const nose = new THREE.ConeGeometry(0.19, 0.5, 8);
    nose.translate(0, 0.92, 0);
    const finA = new THREE.BoxGeometry(0.5, 0.42, 0.05);
    finA.translate(0, -0.78, 0);
    const finB = new THREE.BoxGeometry(0.05, 0.42, 0.5);
    finB.translate(0, -0.78, 0);
    const geo = mergeGeometries([body, nose, finA, finB]);
    const mat = this._hullMaterial('metal_rust', 0x6d6a62);
    const mesh = new THREE.InstancedMesh(geo, mat, most);
    mesh.name = 'match_bomber_bombs';
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    // One instance, parked, so the program is compiled at boot rather than on
    // the frame the bay doors open. See PARKED_Y.
    mesh.count = 1;
    mesh.userData.owNoShadow = true;
    this.group.add(mesh);
    this.bombMesh = mesh;
    this.bombMat = mat;
  }

  /**
   * A private instance of a library surface for the hardware.
   *
   * Same reasoning as `Airstrike._makeMaterial`: `materials.get()` hands back a
   * SHARED material and this one wants its own tint, so it is built on top of
   * the library's baked texture set instead. The level's own albedo, normal and
   * ORM bakes come through, which is what keeps the airframe off the quality
   * bar's "no flat/untextured surfaces".
   */
  _hullMaterial(name, tint) {
    const set = this._lib?.getTextureSet?.(name) ?? null;
    const mat = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.62,
      metalness: 0.25,
      dithering: true,
    });
    mat.name = `bomber_${name}`;
    if (set) {
      mat.map = set.albedo;
      mat.normalMap = set.normal;
      mat.normalScale.set(0.8, 0.8);
      mat.roughnessMap = set.orm;
    }
    this.ctx.peek('render')?.patcher?.patch(mat);
    return mat;
  }

  /* ----------------------------------------------------------- one run --- */

  _buildRun(spec, index, world, physics) {
    const rng = this.rng.fork();
    const a = world.levelToWorld(spec.from[0], 0, spec.from[1], new THREE.Vector3());
    const b = world.levelToWorld(spec.to[0], 0, spec.to[1], new THREE.Vector3());
    const dir = new THREE.Vector3().subVectors(b, a);
    const span = dir.length();
    if (!(span > 4)) {
      console.error(`[bomber] ${spec.id}: run is ${span.toFixed(1)} m long — DROPPED`);
      return null;
    }
    dir.multiplyScalar(1 / span);
    const n = spec.bombs;
    const spacing = span / Math.max(1, n - 1);

    /* ---- impact points, probed once ---------------------------------- */
    const bombs = [];
    let topY = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3().copy(a).addScaledVector(dir, spacing * i);
      const h = physics.groundHeight(p.x, p.z, 60);
      p.y = Number.isFinite(h) ? h : world.groundHeight(p.x, p.z);
      topY = Math.max(topY, p.y);
      bombs.push({ impact: p, tRelease: 0, tImpact: 0, fall: 0, release: new THREE.Vector3() });
    }
    /**
     * A bomb that lands on a roof is a bomb that did nothing.
     *
     * The impact point is wherever the first surface under the flight path is,
     * which is physically right and is exactly how a badly authored line hides:
     * the stick still fires, the craters still appear, and every one of them is
     * twelve metres above the lane the run was supposed to price. So say so.
     */
    const high = bombs.filter((b) => b.impact.y > 3);
    if (high.length) {
      console.warn(
        `[bomber] ${spec.id}: ${high.length}/${n} bombs land above 3 m ` +
          `(${high.map((b) => b.impact.y.toFixed(1)).join(', ')} m) — the run is over rooftops, ` +
          'not over a street. Re-author the line.'
      );
    }

    /* ---- the timeline, closed form ----------------------------------- */
    // Release altitude is above the HIGHEST ground on the run, so the aircraft
    // clears the tallest roof under it by the same margin everywhere.
    const alt = topY + ALT;
    let lastImpact = 0;
    for (const bomb of bombs) {
      // v0 down, constant g: t = (-v0 + sqrt(v0² + 2g·h)) / g.
      const drop = alt - bomb.impact.y;
      bomb.fall = (-DROP_V + Math.sqrt(DROP_V * DROP_V + 2 * G * drop)) / G;
      bomb.release.copy(bomb.impact).addScaledVector(dir, -SPEED * bomb.fall);
      bomb.release.y = alt;
    }
    const start = new THREE.Vector3().copy(bombs[0].release).addScaledVector(dir, -APPROACH);
    for (const bomb of bombs) {
      bomb.tRelease = start.distanceTo(bomb.release) / SPEED;
      bomb.tImpact = bomb.tRelease + bomb.fall;
      lastImpact = Math.max(lastImpact, bomb.tImpact);
    }
    const planeTime = (start.distanceTo(bombs[n - 1].release) + EXIT) / SPEED;

    const run = {
      id: spec.id,
      name: spec.name,
      index,
      bombs,
      spacing,
      dir,
      start,
      alt,
      /** For the HUD / the event payload: the middle of the stick. */
      position: new THREE.Vector3().copy(a).addScaledVector(dir, span * 0.5),
      planeTime,
      lastImpact,
      settleAt: lastImpact + DEBRIS_SETTLE,
      duration: Math.max(planeTime, lastImpact + DEBRIS_SETTLE) + 0.2,
      yaw: Math.atan2(dir.x, dir.z),
      flown: false,
      active: false,
      baked: false,
      next: 0,
      t: -1,
      chunkCount: n * CHUNKS_PER_BOMB,
      uniforms: {
        /** Seconds since this run started; negative before it. */
        uT: { value: -1 },
        /** 1 while the baked curve drives the debris, 0 once it is baked in. */
        uAnim: { value: 1 },
      },
    };
    run.material = makeChunkMaterial(this.ctx, this._lib, 'asphalt', run.uniforms);
    run.debris = this._buildDebris(run, rng, physics);
    return run;
  }

  /**
   * One InstancedMesh for the whole stick's craters.
   *
   * The only thing that distinguishes bomb 3's debris from bomb 0's is the
   * DELAY baked into `aMot.x` — bomb i's chunks simply do not start until
   * `tImpact[i]`. That is what lets seven bursts spread over four seconds run
   * off a single uniform, and it is the same trick the airstrike uses to make
   * the break run through a mass instead of the whole thing moving at once.
   */
  _buildDebris(run, rng, physics) {
    const n = run.chunkCount;
    const geo = chunkGeometry();
    const mesh = new THREE.InstancedMesh(geo, run.material, n);
    mesh.name = `bomber_${run.id}_debris`;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Drawn from the first boot frame, and invisible because the rest pose is
    // under the tarmac. Out of the cascades and the prepass until it settles:
    // both draw through an override material that does not carry our vertex
    // program, so they would put the buried pose in the depth buffer.
    mesh.userData.owNoShadow = true;
    mesh.userData.owNoPrepass = true;

    const mot = new Float32Array(n * 4);
    const off = new Float32Array(n * 3);
    const axis = new Float32Array(n * 3);
    const uv = new Float32Array(n * 3);
    const settled = new Float32Array(n * 16);
    const colour = new Float32Array(n * 3);

    const pos = new THREE.Vector3();
    const settlePos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const q2 = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const m4 = new THREE.Matrix4();
    const ax = new THREE.Vector3();
    const tint = new THREE.Color();
    /**
     * Tarmac, the sub-base under it, and the dust the two make together.
     *
     * LIGHTENED after reading the frames back: the first pass ran 0x4a4844 to
     * 0x8c8378, which is the right hue for asphalt and the wrong VALUE for
     * asphalt lying broken on a pale street in direct sun. It read as a scatter
     * of black cubes rather than as broken road. The bottom of the range is now
     * about where the airstrike's concrete palette sits, and the top is the
     * pulverised sub-base, which is the light one in every real crater photo.
     */
    const palette = [0x6f6a62, 0x847d73, 0x9c9488, 0xb2a897];

    let k = 0;
    for (const bomb of run.bombs) {
      for (let i = 0; i < CHUNKS_PER_BOMB; i++, k++) {
        /* ---- rest pose: UNDER the road ------------------------------- */
        // Buried, so nothing is visible until the bomb that owns this chunk
        // lands and the baked arc lifts it out of its own crater.
        const ra = rng.float() * Math.PI * 2;
        const rr = Math.sqrt(rng.float()) * 1.1;
        pos.set(
          bomb.impact.x + Math.cos(ra) * rr,
          bomb.impact.y - rng.range(0.8, 2.0),
          bomb.impact.z + Math.sin(ra) * rr
        );
        const size = rng.range(0.16, 0.52);
        scale.set(size, size * rng.range(0.4, 0.95), size * rng.range(0.6, 1.25));
        q.setFromAxisAngle(
          ax.set(rng.signed(), rng.signed(), rng.signed()).normalize(),
          rng.range(-Math.PI, Math.PI)
        );
        m4.compose(pos, q, scale);
        m4.toArray(mesh.instanceMatrix.array, k * 16);

        /* ---- where it lands ------------------------------------------ */
        // Thrown out of the crater, biased flat: a bomb in a road throws a
        // shallow fan, not a fountain.
        const sa = rng.float() * Math.PI * 2;
        const sr = 1.4 + Math.sqrt(rng.float()) * 6.2;
        settlePos.set(
          bomb.impact.x + Math.cos(sa) * sr,
          0,
          bomb.impact.z + Math.sin(sa) * sr
        );
        const floor = physics.groundHeight(settlePos.x, settlePos.z, bomb.impact.y + 6);
        settlePos.y = (Number.isFinite(floor) ? floor : bomb.impact.y) + size * 0.36;

        /* ---- the curve, solved here and never again ------------------- */
        // The delay is this bomb's impact time. Six hundredths of a second of
        // jitter on top, so a crater does not empty itself on one frame.
        mot[k * 4] = bomb.tImpact + rng.range(0, 0.06);
        mot[k * 4 + 1] = clamp(Math.sqrt((2 * (sr * 0.55 + 1.2)) / G) * rng.range(1.1, 2.0), 0.5, 2.2);
        mot[k * 4 + 2] = rng.range(0.7, 1.0) * (1.1 + sr * 0.24);
        mot[k * 4 + 3] = rng.range(2.2, 9.5) * (rng.float() < 0.5 ? -1 : 1);

        off[k * 3] = settlePos.x - pos.x;
        off[k * 3 + 1] = settlePos.y - pos.y;
        off[k * 3 + 2] = settlePos.z - pos.z;

        ax.set(rng.signed(), rng.signed() * 0.5, rng.signed()).normalize();
        axis[k * 3] = ax.x;
        axis[k * 3 + 1] = ax.y;
        axis[k * 3 + 2] = ax.z;

        uv[k * 3] = rng.float();
        uv[k * 3 + 1] = rng.float();
        uv[k * 3 + 2] = rng.range(0.5, 1.3);

        q2.setFromAxisAngle(ax, mot[k * 4 + 3]);
        q2.multiply(q);
        m4.compose(settlePos, q2, scale);
        m4.toArray(settled, k * 16);

        tint.setHex(palette[(rng.u32() >>> 3) % palette.length]);
        const g = rng.range(0.78, 1.16);
        colour[k * 3] = tint.r * g;
        colour[k * 3 + 1] = tint.g * g;
        colour[k * 3 + 2] = tint.b * g;
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.rest = new Float32Array(mesh.instanceMatrix.array);
    mesh.userData.settled = settled;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colour, 3);
    mesh.instanceColor.needsUpdate = true;
    geo.setAttribute('aMot', new THREE.InstancedBufferAttribute(mot, 4));
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
    geo.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 3));
    geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 3));
    mesh.updateMatrix();
    this.group.add(mesh);
    return mesh;
  }

  /* ====================================================================== */
  /* THE RUN                                                                */
  /* ====================================================================== */

  /**
   * Launch `which` now. There is no separate telegraph call because the
   * aircraft IS the telegraph: it is on screen and audible for
   * `bombs[0].tRelease` seconds (2.4 s) before the first bomb even leaves it,
   * and another 1.7 s of fall after that.
   */
  fire(which = 0) {
    const run = this._runOf(which);
    if (!run || run.flown) return false;
    const ctx = this.ctx;

    run.flown = true;
    run.active = true;
    run.baked = false;
    run.next = 0;
    run.t = 0;
    this._live.push(run);

    run.uniforms.uT.value = 0;
    run.uniforms.uAnim.value = 1;
    run.debris.userData.owNoShadow = true;
    run.debris.userData.owNoPrepass = true;
    this._poseAircraft(run, 0);

    const audio = this._audio ?? (this._audio = ctx.peek('audio'));
    if (audio?.play) {
      // Placed on the AEROPLANE, not on the target: the point of this telegraph
      // is that you look up and find out which lane it is about to be.
      this._v.copy(run.start);
      audio.play('strike_jet', this._v, {
        level: 1.1, dur: 4.6, maxDist: 460, gain: 3.4, occlusion: 0,
      });
    }

    console.info(
      `[bomber] RUN ${run.id} at t=${ctx.time.elapsed.toFixed(1)}s — ` +
        `${run.bombs.length} bombs ${run.spacing.toFixed(1)} m apart, ` +
        `first away +${run.bombs[0].tRelease.toFixed(2)}s, first down ` +
        `+${run.bombs[0].tImpact.toFixed(2)}s, last down +${run.lastImpact.toFixed(2)}s`
    );
    // THE STICK IS A LINE, so the warning marks the line: the first crater, the
    // middle and the last. One marker in the middle of a 68 m run would tell the
    // player to stand exactly where the fourth bomb lands. Announced before the
    // event goes out, so a listener sees the HUD already warned.
    this._announce(this.onAnnounce, run, run.bombs[0].tImpact);
    this._emit('inbound', run);
    return true;
  }

  /** Fill the reused announce record and hand it to a hook. No allocation. */
  _announce(hook, run, lead) {
    if (!hook) return;
    const a = this._ann;
    const n = run.bombs.length;
    a.kind = 'BOMBER';
    a.id = run.id;
    a.name = run.name;
    a.lead = Math.max(0.3, lead);
    a.position = run.position;
    a.count = 0;
    a.points[a.count++] = run.bombs[0].impact;
    if (n > 2) a.points[a.count++] = run.bombs[(n / 2) | 0].impact;
    if (n > 1) a.points[a.count++] = run.bombs[n - 1].impact;
    hook(a);
  }

  flown(which = 0) {
    return !!this._runOf(which)?.flown;
  }

  /** True while an aircraft is in the air. */
  get busy() {
    return this._live.length > 0;
  }

  /* ====================================================================== */
  /* frame                                                                  */
  /* ====================================================================== */

  /**
   * @param {number} dt
   * @param {boolean} live  true only while the round is being played
   */
  update(dt, live) {
    if (!this.ready) return;

    let flying = null;
    for (let i = this._live.length - 1; i >= 0; i--) {
      const run = this._live[i];
      run.t += dt;
      run.uniforms.uT.value = run.t;

      /* ---- the bombs that have arrived ------------------------------- */
      while (run.next < run.bombs.length && run.bombs[run.next].tImpact <= run.t) {
        // The HUD's warning switches to its impact read on the FIRST crater; the
        // rest of the stick is the same event still arriving.
        if (run.next === 0) this._announce(this.onImpact, run, 0.3);
        this._detonate(run, run.bombs[run.next]);
        run.next++;
      }

      /* ---- the aeroplane and whatever is still falling ---------------- */
      if (run.t <= run.planeTime) {
        this._poseAircraft(run, run.t);
        flying = run;
      } else {
        this._park();
      }
      this._poseBombs(run);

      if (!run.baked && run.t >= run.settleAt) this._bakeSettled(run);
      if (run.t >= run.duration) {
        run.active = false;
        this._live.splice(i, 1);
      }
    }
    if (!flying) this._park();

    /* ---- scheduler --------------------------------------------------- */
    if (!live || !this.enabled) return;
    this._next -= dt;
    if (this._next > 0) return;
    this._scheduleNext();
  }

  /** Aircraft and bombs out of sight under the map. See PARKED_Y. */
  _park() {
    this._v.set(0, PARKED_Y, 0);
    this._q.identity();
    this._sc.set(1, 1, 1);
    this.aircraft.matrix.compose(this._v, this._q, this._sc);
    this.aircraft.matrixWorldNeedsUpdate = true;
    const mesh = this.bombMesh;
    if (mesh.count !== 1 || mesh.instanceMatrix.array[13] !== PARKED_Y) {
      mesh.count = 1;
      this._m.compose(this._v, this._q, this._sc);
      this._m.toArray(mesh.instanceMatrix.array, 0);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** `start + dir * SPEED * t`, into the mesh matrix. No allocation. */
  _poseAircraft(run, t) {
    this._v.copy(run.start).addScaledVector(run.dir, SPEED * t);
    this._q.setFromAxisAngle(UP, run.yaw);
    this._sc.set(1, 1, 1);
    this.aircraft.matrix.compose(this._v, this._q, this._sc);
    this.aircraft.matrixWorldNeedsUpdate = true;
  }

  /**
   * Every bomb still in the air, on its own closed-form curve.
   *
   * `k` bombs at most — five to seven — so this is a handful of matrix composes
   * a frame while a run is on and literally nothing between runs, which is why
   * the bomb bodies are CPU-posed while the debris is not: forty chunks a
   * crater is a GPU job, seven falling objects is not.
   */
  _poseBombs(run) {
    const mesh = this.bombMesh;
    let k = 0;
    for (let i = run.next; i < run.bombs.length; i++) {
      const bomb = run.bombs[i];
      const dt = run.t - bomb.tRelease;
      if (dt < 0) break; // releases are ordered; nothing after this is away yet
      this._v.copy(bomb.release).addScaledVector(run.dir, SPEED * dt);
      this._v.y = bomb.release.y - DROP_V * dt - 0.5 * G * dt * dt;
      // Nose along the velocity: horizontal SPEED, vertical -(v0 + g·dt).
      this._v2.copy(run.dir).multiplyScalar(SPEED);
      this._v2.y = -(DROP_V + G * dt);
      this._v2.normalize();
      this._q.setFromUnitVectors(UP, this._v2);
      this._sc.set(1, 1, 1);
      this._m.compose(this._v, this._q, this._sc);
      this._m.toArray(mesh.instanceMatrix.array, k * 16);
      k++;
    }
    // Never zero: one parked instance keeps the draw call — and therefore the
    // compiled program — alive between runs.
    if (k) {
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
    } else {
      this._park();
    }
  }

  /**
   * One bomb arrives. The whole frame cost of a crater is here.
   *
   * Nothing in this method builds, solves or allocates: the `explosion` event
   * is the canonical one `physics`, `player`, `ai`, `fx` and `audio` already
   * handle for the C4, and the three `fx` calls write into preallocated rings.
   * The debris needs no work at all — its delay was baked at boot.
   */
  _detonate(run, bomb) {
    const b = this._blast;
    b.position = bomb.impact;
    b.radius = RULES.bombRadius;
    b.damage = RULES.bombDamage;
    this.ctx.events.emit('explosion', b);

    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (fx) {
      fx.hazeRing(bomb.impact.x, bomb.impact.y + 0.5, bomb.impact.z, 2.0, 17, 0.42, 2.2);
      fx.scorch(bomb.impact.x, bomb.impact.y + 0.15, bomb.impact.z, 4.4);
      fx.addSmokeColumn(bomb.impact.x, bomb.impact.y + 0.25, bomb.impact.z, {
        radius: 2.2,
        duration: 2.2,
        rate: 9,
        rise: 2.1,
        dark: 0.22,
        life: 6,
        growth: 4.6,
      });
    }
    this._emit('impact', run, bomb.impact);
  }

  /** The dust is down: hand the settled pose back and switch the curve off. */
  _bakeSettled(run) {
    run.baked = true;
    const mesh = run.debris;
    mesh.instanceMatrix.array.set(mesh.userData.settled);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.owNoShadow = false;
    mesh.userData.owNoPrepass = false;
    run.uniforms.uAnim.value = 0;
    this._emit('settled', run);
  }

  /* ====================================================================== */
  /* scheduling                                                             */
  /* ====================================================================== */

  _scheduleNext() {
    // Never in the sky at the same time as an airstrike or a strafing run: two
    // telegraphs at once is noise, and the player has to be able to tell which
    // one is theirs.
    if (this.busy || this._coBusy) {
      this._next = 5;
      return;
    }
    if (this._flown >= RULES.bomberMaxPerRound) {
      this._next = Infinity;
      return;
    }
    /**
     * Weighted by how close the LINE comes to the fight, not how close its
     * midpoint does — a run whose far end is on top of the fight is a run the
     * player sees, and by midpoint it would score the same as one aimed at an
     * empty lane. Nothing is excluded; the lines do not move.
     */
    const cand = this._cand;
    const wt = this._wt;
    cand.length = 0;
    wt.length = 0;
    let total = 0;
    for (const r of this.runs) {
      if (r.flown) continue;
      total += this._focusWeight(r);
      cand.push(r);
      wt.push(total);
    }
    if (!cand.length) {
      this._next = Infinity;
      return;
    }
    const draw = this.rng.float() * total;
    let pick = cand.length - 1;
    for (let i = 0; i < wt.length; i++) {
      if (draw < wt[i]) {
        pick = i;
        break;
      }
    }
    this.fire(cand[pick].index);
    this._flown++;
    const [lo, hi] = RULES.bomberInterval;
    this._next = this.rng.range(lo, hi);
  }

  /** 1 with no focus, up to 3.4 with the fight standing in the impact line. */
  _focusWeight(run) {
    if (!this.focusValid) return 1;
    const b = run.bombs;
    const a0 = b[0].impact;
    const a1 = b[b.length - 1].impact;
    const dx = a1.x - a0.x;
    const dz = a1.z - a0.z;
    const len2 = dx * dx + dz * dz;
    let t = 0;
    if (len2 > 1e-6) {
      t = ((this.focus.x - a0.x) * dx + (this.focus.z - a0.z) * dz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    const d = Math.hypot(this.focus.x - (a0.x + dx * t), this.focus.z - (a0.z + dz * t));
    return 1 + 2.4 / (1 + (d / this.focusScale) ** 2);
  }

  /** Called by `match` when a round goes live. */
  armRound() {
    const [lo, hi] = RULES.bomberInterval;
    this._next = RULES.bomberFirstDelay + this.rng.range(0, (hi - lo) * 0.5);
    this._flown = 0;
  }

  disarm() {
    this._next = Infinity;
  }

  /** Round reset: no craters, no debris, no aeroplane. */
  reset() {
    this.disarm();
    this._live.length = 0;
    this._park();
    for (const run of this.runs) {
      run.flown = false;
      run.active = false;
      run.baked = false;
      run.next = 0;
      run.t = -1;
      run.uniforms.uT.value = -1;
      run.uniforms.uAnim.value = 1;
      const mesh = run.debris;
      mesh.instanceMatrix.array.set(mesh.userData.rest);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.owNoShadow = true;
      mesh.userData.owNoPrepass = true;
    }
  }

  _runOf(which) {
    if (typeof which === 'number') return this.runs[which] ?? null;
    if (typeof which === 'string') return this.runs.find((r) => r.id === which) ?? null;
    return which ?? null;
  }

  _emit(phase, run, position) {
    const e = this._ev;
    e.phase = phase;
    e.run = run.id;
    e.position = position ?? run.position;
    this.ctx.events.emit('match:bomber', e);
  }

  dispose() {
    for (const run of this.runs) {
      run.debris?.geometry?.dispose();
      run.material?.dispose();
    }
    this.aircraft?.geometry?.dispose();
    this.aircraftMat?.dispose();
    this.bombMesh?.geometry?.dispose();
    this.bombMat?.dispose();
    this.group.parent?.remove(this.group);
    this.runs.length = 0;
    this._live.length = 0;
  }
}
