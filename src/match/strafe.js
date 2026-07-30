/**
 * MATCH — fighter support fire.
 *
 * "戦闘機からの援護射撃とかもイベント起きないね？" — a fast mover coming down a
 * lane with its gun open. This is the THIRD shape of air in the game and it is
 * deliberately not a smaller bomb:
 *
 *                     airstrike            bomber run            STRAFING RUN
 *   shape             one point            5-8 craters, 22-68 m  an unbroken line
 *                                                                of 11-31 cannon
 *                                                                impacts
 *   telegraph         4.4 s: jet, then     the aeroplane, 2.4 s   the aeroplane and
 *                     a falling whistle    before the first bomb   its GUN, ~2.5 s
 *   how long it       one instant          4 s, walking            1.0-1.4 s,
 *   takes                                                          walking fast
 *   what it leaves    a rubble mound,      craters                 scorch and grit
 *                     permanent cover
 *   the answer        get off that street  get out of the lane     get out of the
 *                                                                  lane, NOW
 *   per hit           15 m / 260           9 m / 165               5.5 m / 74
 *
 * The character is the RATE. A stick of bombs gives you four seconds to work out
 * that the line is walking toward you; a cannon covers sixty metres in a second,
 * so what you get instead is a warning, a direction, and about as long as it
 * takes to take two steps. That is why the gun is audible from the aircraft
 * BEFORE the first shell lands (`strafe_cannon` on the airframe, `strafe_walk`
 * where they arrive) and why the HUD warning is the whole of the reaction time.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EVERYTHING IS BAKED AT BOOT. NOTHING IS SOLVED WHEN IT FIRES.
 * ────────────────────────────────────────────────────────────────────────────
 * The same rule as its two siblings, and the same machinery — `fracture` is not
 * needed here but `chunkGeometry`, `mergeGeometries` and above all
 * `makeChunkMaterial` are imported from `airstrike.js`, so the grit thrown out of
 * each strike moves on the identical closed-form vertex program. At `build()`,
 * per run:
 *
 *   - the IMPACT POINTS. A line in level space, one ground probe per point, here
 *     and never again. In the frame a shell lands there is no raycast.
 *
 *   - the TIMELINE, closed form and solved backwards from the geometry rather
 *     than authored. A round leaves the aircraft `AHEAD` metres short of where it
 *     lands (`ALT / tan(DEPRESSION)`) and takes `slant / SHELL` seconds to get
 *     there, so impact `i`'s fire time is `(s_i - AHEAD) / SPEED` and its impact
 *     time is that plus the flight. Every one of those is a constant on a
 *     baked array.
 *
 *   - the FIRE POSITION per impact, so the tracer is drawn from where the round
 *     actually left rather than from wherever the aeroplane has got to by the
 *     time it arrives.
 *
 *   - the GRIT, as ONE InstancedMesh for the whole run: 8 chunks per impact, each
 *     with its delay set to ITS OWN impact time, so 250 chunks across a
 *     second-and-a-bit of walking line run off ONE uniform write per frame.
 *
 *   - the SETTLED POSE, pre-filled, memcpy'd in when the dust is down.
 *
 * WHAT IT DELIBERATELY DOES NOT BAKE, exactly like the bomber, is collision and
 * navigation: cannon shells leave scorch and grit, not a mound. Nothing here can
 * regress `tools/navcheck.mjs`, which is what lets it be scheduled three times a
 * round on the attackers' route.
 *
 * DAMAGE IS SAMPLED, and that is the one honest compromise in the file. Thirty
 * `explosion` events in a second and a half would each spawn a full fx fireball
 * and a full audio voice — the voice pool is 48 with a ~2 s hold, so the run
 * would eat two thirds of it and the rest of the firefight would go silent. So
 * every `DAMAGE_EVERY`-th impact carries the blast, at `cannonRadius` 5.5 m
 * against a `DAMAGE_EVERY * SPACING` = 8.8 m sample spacing: 5.5 > 4.4, so the
 * lethal band along the line is CONTINUOUS and nobody can stand between two
 * shells. The other impacts are visual and audible only.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLIC API   const s = ctx.get('match').strafe
 * ────────────────────────────────────────────────────────────────────────────
 *   s.runs                   [{ id, name, impacts, ... }]  world space
 *   s.fire(indexOrId)        launch a run now
 *   s.flown(index)           has this one already been flown this round?
 *   s.reset()                round reset: grit back under, no aeroplane
 *   s.enabled                false stops the scheduler
 *   s.busy                   true while an aircraft is in the air
 *   s.setFocus(v)            where the fight is; biases which lane is strafed
 *   s.onAnnounce/onImpact    the HUD warning hooks `match` installs
 *
 * Emits `match:strafe { phase, run, position }` with phase
 * 'inbound' | 'impact' | 'settled'.
 */

import * as THREE from 'three';
import { RULES } from './rules.js';
import { chunkGeometry, clamp, makeChunkMaterial, mergeGeometries } from './airstrike.js';

/** Same 1.5x as sites.js, airstrike.js and bomber.js. IF ONE MOVES, MOVE THE OTHERS. */
const SCALE = 1.5;
const L = (x, z) => [x * SCALE, z * SCALE];

/**
 * THE LINES, authored as the line the SHELLS land on.
 *
 * These are on the same four open corridors `src/match/bomber.js` documents and
 * proves at boot, for the same reason: a straight line that leaves the corridor
 * puts its impacts on a roof, where they do nothing to anybody. From the 3 m
 * roof-height sweep quoted in that file,
 *
 *      west lane   x -45..-30      running in z
 *      mid street  x  -6..+12      running in z
 *      east lane   x +36..+45      running in z
 *      cross st.   z +15..+21      running in x, the full width of the map
 *
 * so every line below shares an axis value with a bomber run that has already
 * been measured onto the deck. `_buildRun` re-checks anyway and prints every
 * impact more than 3 m up.
 *
 * THEY RUN THE OTHER WAY. Each is its corridor traversed opposite to the bomber
 * line on it, which costs nothing and means the two weapons are not the same
 * aeroplane on the same heading twice — a fighter that always comes from the
 * north is a fighter you only have to watch one horizon for.
 *
 * WHERE THEY ARE is the same geometric argument as `STRIKE_SITES` and `RUNS`:
 * every impact point is at level z between +2.67 and +27.5, i.e. inside the half
 * of the map the ATTACK must cross (attack routes run level z +66.7 down to
 * -5.8, defence routes -67.1 up to -5.0), and clear of the attack's nearest
 * spawn at z = +51.2. Support fire is paid for by the side that is pushing.
 */
const LINES = [
  // mid street, south to north — the trunk both branches walk out of spawn
  { id: 'MAIN', name: 'MAIN STREET', from: L(-4.0, 11.0), to: L(-4.0, 27.5) },
  // the full width of the cross street, east to west. The long one.
  { id: 'CROSS', name: 'CROSS STREET', from: L(22.67, 12.0), to: L(-22.67, 12.0) },
  // west lane, south to north — the last open stretch before site A
  { id: 'ALANE', name: 'A LANE', from: L(-24.0, 2.67), to: L(-24.0, 20.0) },
  // east lane, the same for site B
  { id: 'BLANE', name: 'B LANE', from: L(27.33, 2.67), to: L(27.33, 18.67) },
];

/** Metres between cannon impacts along the line. */
const SPACING = 2.2;
/** Impacts per run, clamped — a 68 m line would otherwise be fifty of them. */
const MIN_IMPACTS = 10;
const MAX_IMPACTS = 34;
/**
 * Every Nth impact carries the blast. See the DAMAGE IS SAMPLED note in the
 * header: 4 * 2.2 = 8.8 m sample spacing against a 5.5 m radius keeps the lethal
 * band continuous while cutting the event count by four.
 */
const DAMAGE_EVERY = 4;
/** Chunks of tarmac thrown out of each strike. */
const CHUNKS_PER_IMPACT = 8;
/** Seconds after the last impact before the grit is baked down. */
const GRIT_SETTLE = 3.2;

/**
 * Flight profile. A fighter is faster than the bomber (38 m/s) and that is the
 * point — but it is still nothing like a real one, for the same reason: at
 * 200 m/s the aircraft crosses this map in half a second and cannot be a
 * telegraph. 68 m/s is a fast mover you can still turn and look at.
 */
const SPEED = 68;
/** Height of the gun run above the highest ground under it, metres. */
const ALT = 26;
/** Radians below the horizon the gun is pointed. A shallow strafing pass. */
const DEPRESSION = 0.38; // ~22 degrees
/** Shell speed, m/s. */
const SHELL = 300;
/** How far back the aircraft enters before the first ROUND IS FIRED. */
const APPROACH = 210;
/** How far past the last shot it keeps flying before it is put away. */
const EXIT = 150;
/** Rounds a second the gun is cycling — the audio's rate, and the tracer's. */
const FIRE_RATE = 22;

const UP = new THREE.Vector3(0, 1, 0);
/** Same trick as the bomber's PARKED_Y: drawn from boot, 600 m under the map. */
const PARKED_Y = -600;

/* -------------------------------------------------------------------------- */

export class Strafe {
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

    /** Runs in the air. At most one — the scheduler enforces it. */
    this._live = [];
    /** Seconds until the scheduler may launch. Set by `armRound`. */
    this._next = Infinity;
    /** Runs flown this round, against `RULES.strafeMaxPerRound`. */
    this._flown = 0;
    /** The other air systems, so no two share the sky. Set by `match`. */
    this.coBusy = null;

    /** Where the fight is. @see `Airstrike.focus` for why this exists. */
    this.focus = new THREE.Vector3();
    this.focusValid = false;
    this.focusScale = 30;

    /** Announce hooks, installed by `match`. */
    this.onAnnounce = null;
    this.onImpact = null;

    this.group = new THREE.Group();
    this.group.name = 'match-strafe';
    this.group.matrixAutoUpdate = false;

    /* scratch — nothing in update() or fire() allocates */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._sc = new THREE.Vector3();
    this._blast = { position: null, radius: 0, damage: 0, source: 'strafe' };
    this._ev = { phase: '', run: '', position: null };
    /**
     * The per-round impact payload handed to `fx.onImpact`. REUSED: `point` is
     * re-pointed at the baked impact vector, and `normal`/`incident` are fixed —
     * the ground is flat where these land and the shells all arrive on the same
     * bearing at the same depression, which is the whole character of the weapon.
     * `incident` is filled in per run because it depends on the line's heading.
     */
    this._impact = {
      point: null,
      normal: new THREE.Vector3(0, 1, 0),
      incident: new THREE.Vector3(0, -1, 0),
      surface: 'concrete',
      damage: 70,
    };
    this._ann = {
      kind: 'STRAFE',
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

  /* ====================================================================== */
  /* BOOT                                                                   */
  /* ====================================================================== */

  build() {
    const t0 = performance.now();
    const ctx = this.ctx;
    const world = ctx.peek('world');
    const physics = ctx.peek('physics');
    if (!world || !physics) {
      console.warn('[strafe] no world/physics — disabled');
      return this;
    }
    this.physics = physics;
    this._lib = ctx.peek('materials');

    this._buildAircraft();
    this._park();
    for (let i = 0; i < LINES.length; i++) {
      const run = this._buildRun(LINES[i], i, world, physics);
      if (run) this.runs.push(run);
    }

    ctx.scene.add(this.group);
    this.ready = this.runs.length > 0;
    this.buildMs = performance.now() - t0;
    let chunks = 0;
    for (const r of this.runs) chunks += r.chunkCount;
    console.info(
      `[strafe] ${this.runs.length}/${LINES.length} runs baked in ${this.buildMs.toFixed(0)}ms — ` +
        `${chunks} grit chunks, ` +
        this.runs
          .map((r) => `${r.id}:${r.impacts.length}x${SPACING}m/${(r.lastImpact - r.firstImpact).toFixed(2)}s`)
          .join(' ')
    );
    return this;
  }

  /**
   * The fighter. One mesh, boxes merged at boot, +Z forward.
   *
   * A DIFFERENT SILHOUETTE FROM THE BOMBER, which is the whole job: the bomber
   * is a long fuselage on a straight high-aspect wing with two underslung
   * nacelles, and if this were the same shape the player would learn one
   * telegraph and get the wrong answer half the time. So this is short, cranked
   * and swept — a stubby fuselage, a low swept wing with a pronounced leading
   * edge extension, twin canted fins and a chin intake. Out of the shadow
   * cascades for the same reason the bomber is: a 12 m span at 26 m casts a
   * shadow nobody looks at and costs a cascade draw to do it.
   */
  _buildAircraft() {
    const box = (w, h, d, x, y, z, ry = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (ry) g.rotateY(ry);
      g.translate(x, y, z);
      return g;
    };
    const geo = mergeGeometries([
      box(1.7, 1.7, 8.4, 0, 0, 0), // fuselage
      box(1.05, 1.0, 2.6, 0, -0.2, 5.4), // nose
      box(1.15, 0.8, 2.2, 0, 0.95, 2.1), // canopy
      box(1.5, 0.75, 1.9, 0, -1.0, 2.4), // chin intake
      // swept wing, in two panels either side so the sweep reads in plan
      box(5.0, 0.36, 2.5, 3.0, -0.3, -0.9, 0.36),
      box(5.0, 0.36, 2.5, -3.0, -0.3, -0.9, -0.36),
      // leading edge extensions
      box(2.0, 0.3, 2.2, 1.3, -0.28, 1.5, 0.5),
      box(2.0, 0.3, 2.2, -1.3, -0.28, 1.5, -0.5),
      // twin canted fins
      box(0.3, 2.3, 1.9, 1.0, 1.2, -3.4, 0.22),
      box(0.3, 2.3, 1.9, -1.0, 1.2, -3.4, -0.22),
      box(4.2, 0.3, 1.5, 0, 0.2, -3.7), // tailplane
      box(1.2, 1.2, 2.6, 0, -0.1, -4.4), // exhaust
    ]);
    const mat = this._hullMaterial('metal_painted', 0x3f4a52);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'match_strafe_aircraft';
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.userData.owNoShadow = true;
    this.group.add(mesh);
    this.aircraft = mesh;
    this.aircraftMat = mat;
  }

  /** Same reasoning as `Bomber._hullMaterial`: our own tint on the library bake. */
  _hullMaterial(name, tint) {
    const set = this._lib?.getTextureSet?.(name) ?? null;
    const mat = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.55,
      metalness: 0.3,
      dithering: true,
    });
    mat.name = `strafe_${name}`;
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
    if (!(span > 8)) {
      console.error(`[strafe] ${spec.id}: line is ${span.toFixed(1)} m long — DROPPED`);
      return null;
    }
    dir.multiplyScalar(1 / span);
    const n = clamp(Math.round(span / SPACING), MIN_IMPACTS, MAX_IMPACTS) | 0;
    const step = span / (n - 1);

    /* ---- impact points, probed once ---------------------------------- */
    const impacts = [];
    let topY = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3().copy(a).addScaledVector(dir, step * i);
      const h = physics.groundHeight(p.x, p.z, 60);
      p.y = Number.isFinite(h) ? h : world.groundHeight(p.x, p.z);
      topY = Math.max(topY, p.y);
      impacts.push({ at: p, from: new THREE.Vector3(), tFire: 0, tImpact: 0, damage: i % DAMAGE_EVERY === 0 });
    }
    /**
     * A shell that lands on a ROOF did nothing, and a badly authored line hides
     * exactly this way — so say so at boot, as the bomber does. But at 2.2 m
     * spacing this probe is fine enough to also find things a bomber's 9 m
     * spacing steps straight over, and those are not all errors: CROSS passes
     * under the canopy at the mid-street junction (measured 3.2-3.9 m across
     * level x -2.7..+2.7 at every z from 10.5 to 13.5), and rounds striking that
     * canopy while the man underneath is untouched is the correct behaviour and a
     * real piece of overhead cover. So the threshold is a SHARE of the line:
     * a handful of sheltered impacts is a lane feature, a third of them is an
     * authoring mistake.
     */
    const high = impacts.filter((p) => p.at.y > 3);
    if (high.length / n > 0.3) {
      console.warn(
        `[strafe] ${spec.id}: ${high.length}/${n} impacts land above 3 m ` +
          `(${high.map((p) => p.at.y.toFixed(1)).join(', ')} m) — the line is over rooftops, ` +
          'not over a street. Re-author it.'
      );
    } else if (high.length) {
      console.info(
        `[strafe] ${spec.id}: ${high.length}/${n} impacts are sheltered by structure at ` +
          `${high.map((p) => p.at.y.toFixed(1)).join('/')} m — overhead cover, not a roof.`
      );
    }

    /* ---- the timeline, closed form ----------------------------------- */
    const alt = topY + ALT;
    // How far short of the impact the round leaves the aircraft, and how long it
    // is in the air. Both constants of the profile, not of the individual shot.
    const ahead = alt / Math.tan(DEPRESSION);
    const travel = Math.hypot(ahead, alt) / SHELL;
    // The aircraft enters APPROACH metres before the point it opens fire from.
    const start = new THREE.Vector3()
      .copy(impacts[0].at)
      .addScaledVector(dir, -(ahead + APPROACH));
    start.y = alt;
    for (const p of impacts) {
      // Ground distance from `start` to where the aircraft is when it fires.
      const s = start.distanceTo(this._v.set(p.at.x, alt, p.at.z)) - ahead;
      p.tFire = Math.max(0, s / SPEED);
      p.tImpact = p.tFire + travel;
      p.from.copy(p.at).addScaledVector(dir, -ahead);
      p.from.y = alt;
    }
    const firstImpact = impacts[0].tImpact;
    const lastImpact = impacts[impacts.length - 1].tImpact;
    const planeTime = (start.distanceTo(impacts[impacts.length - 1].from) + EXIT) / SPEED;

    const run = {
      id: spec.id,
      name: spec.name,
      index,
      impacts,
      dir,
      start,
      alt,
      span,
      /** For the HUD and the event payload: the middle of the line. */
      position: new THREE.Vector3().copy(a).addScaledVector(dir, span * 0.5),
      firstImpact,
      lastImpact,
      planeTime,
      settleAt: lastImpact + GRIT_SETTLE,
      duration: Math.max(planeTime, lastImpact + GRIT_SETTLE) + 0.2,
      yaw: Math.atan2(dir.x, dir.z),
      flown: false,
      active: false,
      baked: false,
      /** Next impact to detonate, and next round to draw a tracer for. */
      next: 0,
      tracer: 0,
      t: -1,
      chunkCount: n * CHUNKS_PER_IMPACT,
      uniforms: {
        uT: { value: -1 },
        uAnim: { value: 1 },
      },
    };
    run.material = makeChunkMaterial(this.ctx, this._lib, 'asphalt', run.uniforms);
    run.grit = this._buildGrit(run, rng, physics);
    return run;
  }

  /**
   * One InstancedMesh for the whole line's grit.
   *
   * Identical trick to `Bomber._buildDebris`: the only thing that distinguishes
   * impact 20's chunks from impact 0's is the DELAY baked into `aMot.x`, so a
   * line of thirty bursts spread over a second and a half is driven by one
   * uniform. The rest pose is under the tarmac, which is why the burst reads as
   * road being thrown up rather than as cubes appearing.
   */
  _buildGrit(run, rng, physics) {
    const n = run.chunkCount;
    const geo = chunkGeometry();
    const mesh = new THREE.InstancedMesh(geo, run.material, n);
    mesh.name = `strafe_${run.id}_grit`;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
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
    /** Broken tarmac and the pale sub-base under it, as in bomber.js. */
    const palette = [0x6f6a62, 0x847d73, 0x9c9488, 0xb2a897];

    let k = 0;
    for (const p of run.impacts) {
      for (let i = 0; i < CHUNKS_PER_IMPACT; i++, k++) {
        /* ---- rest pose: under the road ------------------------------- */
        const ra = rng.float() * Math.PI * 2;
        const rr = Math.sqrt(rng.float()) * 0.5;
        pos.set(
          p.at.x + Math.cos(ra) * rr,
          p.at.y - rng.range(0.5, 1.2),
          p.at.z + Math.sin(ra) * rr
        );
        // Smaller than a bomb's spoil: a 30 mm shell breaks the surface course,
        // it does not excavate.
        const size = rng.range(0.1, 0.3);
        scale.set(size, size * rng.range(0.4, 0.9), size * rng.range(0.6, 1.2));
        q.setFromAxisAngle(
          ax.set(rng.signed(), rng.signed(), rng.signed()).normalize(),
          rng.range(-Math.PI, Math.PI)
        );
        m4.compose(pos, q, scale);
        m4.toArray(mesh.instanceMatrix.array, k * 16);

        /* ---- where it lands ------------------------------------------ */
        // Thrown DOWN THE LINE as well as out: the round arrives at 22 degrees
        // with 300 m/s of it going forwards, so the spray is a fan, not a ring.
        const sa = rng.float() * Math.PI * 2;
        const sr = 0.7 + Math.sqrt(rng.float()) * 2.6;
        settlePos.set(
          p.at.x + Math.cos(sa) * sr + run.dir.x * rng.range(0.2, 1.6),
          0,
          p.at.z + Math.sin(sa) * sr + run.dir.z * rng.range(0.2, 1.6)
        );
        const floor = physics.groundHeight(settlePos.x, settlePos.z, p.at.y + 5);
        settlePos.y = (Number.isFinite(floor) ? floor : p.at.y) + size * 0.36;

        /* ---- the curve, solved here and never again ------------------- */
        mot[k * 4] = p.tImpact + rng.range(0, 0.03);
        mot[k * 4 + 1] = clamp(Math.sqrt((2 * (sr * 0.5 + 0.7)) / 9.81) * rng.range(1.1, 1.9), 0.35, 1.5);
        mot[k * 4 + 2] = rng.range(0.5, 0.9) * (0.7 + sr * 0.3);
        mot[k * 4 + 3] = rng.range(2.5, 11) * (rng.float() < 0.5 ? -1 : 1);

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
   * Launch `which` now. The aircraft and its gun ARE the telegraph: it is on
   * screen and audible for `impacts[0].tFire` seconds before the first round is
   * away and `firstImpact` before the first one lands.
   */
  fire(which = 0) {
    const run = this._runOf(which);
    if (!run || run.flown) return false;
    const ctx = this.ctx;

    run.flown = true;
    run.active = true;
    run.baked = false;
    run.next = 0;
    run.tracer = 0;
    run.t = 0;
    this._live.push(run);

    run.uniforms.uT.value = 0;
    run.uniforms.uAnim.value = 1;
    run.grit.userData.owNoShadow = true;
    run.grit.userData.owNoPrepass = true;
    this._poseAircraft(run, 0);
    // The rounds all arrive on this line's heading at the gun's depression, so
    // the impact incident is a per-RUN constant rather than a per-round one.
    this._impact.incident
      .set(run.dir.x, 0, run.dir.z)
      .multiplyScalar(Math.cos(DEPRESSION));
    this._impact.incident.y = -Math.sin(DEPRESSION);
    this._impact.incident.normalize();

    const audio = this._audio ?? (this._audio = ctx.peek('audio'));
    if (audio?.play) {
      // The airframe, on the aeroplane, where you can turn and find it.
      this._v.copy(run.start);
      audio.play('strike_jet', this._v, {
        level: 1.05, dur: 3.4, maxDist: 460, gain: 3.2, occlusion: 0,
      });
      // The gun, also on the aeroplane, and it starts when the gun does.
      const dur = Math.max(0.3, run.impacts[run.impacts.length - 1].tFire - run.impacts[0].tFire);
      this._v.copy(run.impacts[0].from);
      audio.play('strafe_cannon', this._v, {
        level: 1.15, dur, rate: FIRE_RATE, maxDist: 420, gain: 2.4, occlusion: 0,
        extraDelay: run.impacts[0].tFire,
      });
      // And the same rip arriving on the ground, at the middle of the line.
      audio.play('strafe_walk', run.position, {
        level: 1.1, dur, rate: FIRE_RATE, maxDist: 300, gain: 2.2,
        extraDelay: run.firstImpact,
      });
    }

    console.info(
      `[strafe] RUN ${run.id} at t=${ctx.time.elapsed.toFixed(1)}s — ` +
        `${run.impacts.length} rounds ${SPACING} m apart over ${run.span.toFixed(1)} m, ` +
        `first away +${run.impacts[0].tFire.toFixed(2)}s, first down +${run.firstImpact.toFixed(2)}s, ` +
        `last down +${run.lastImpact.toFixed(2)}s ` +
        `(${((run.lastImpact - run.firstImpact) || 1).toFixed(2)}s of walking line)`
    );
    this._announce(this.onAnnounce, run, run.firstImpact);
    this._emit('inbound', run, run.position);
    return true;
  }

  flown(which = 0) {
    return !!this._runOf(which)?.flown;
  }

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

      /* ---- rounds leaving the gun ------------------------------------- */
      // Drawn from the baked fire position rather than from wherever the
      // aeroplane has got to, so the tracer and the impact agree.
      while (run.tracer < run.impacts.length && run.impacts[run.tracer].tFire <= run.t) {
        this._tracer(run, run.impacts[run.tracer]);
        run.tracer++;
      }

      /* ---- rounds arriving -------------------------------------------- */
      while (run.next < run.impacts.length && run.impacts[run.next].tImpact <= run.t) {
        if (run.next === 0) this._announce(this.onImpact, run, 0.3);
        this._strike(run, run.impacts[run.next]);
        run.next++;
      }

      if (run.t <= run.planeTime) {
        this._poseAircraft(run, run.t);
        flying = run;
      }

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

  /** Aircraft out of sight under the map. See PARKED_Y. */
  _park() {
    this._v.set(0, PARKED_Y, 0);
    this._q.identity();
    this._sc.set(1, 1, 1);
    this.aircraft.matrix.compose(this._v, this._q, this._sc);
    this.aircraft.matrixWorldNeedsUpdate = true;
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
   * One round leaving the gun: a tracer down the slant and a muzzle flash on the
   * aircraft. `fx.tracer` copies its endpoints, so the baked vectors are safe to
   * hand over.
   */
  _tracer(run, p) {
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (!fx) return;
    fx.tracer(p.from, p.at, SHELL);
    // Every third round gets the light, at a low priority so the gun can never
    // steal a flash from an explosion.
    if (fx.lights && run.tracer % 3 === 0) {
      fx.lights.flash(p.from.x, p.from.y, p.from.z, 1, 0.82, 0.5, 320, 0.05, 6, 60, 0.2);
    }
  }

  /**
   * One round arriving. The whole frame cost of a cannon impact is here: a dust
   * puff always, and on every `DAMAGE_EVERY`-th one the blast, a shock ring and
   * a scorch. Nothing builds, solves or allocates — the grit's delay was baked.
   */
  _strike(run, p) {
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (fx) {
      /**
       * `fx.onImpact` FOR EVERY ROUND, and this is the thing that makes the line
       * read at all.
       *
       * The first pass used `fx.haze` for the non-blast impacts, which was
       * invisible: haze is a REFRACTION sprite, so thirty of them over a second
       * and a half produced a barely-perceptible shimmer and the frames showed a
       * strafing run as a scatter of grit appearing out of nowhere. `onImpact` is
       * the engine's own "a round struck this surface" recipe — a spall burst,
       * a dust puff and a mark, sized by energy — which is exactly what a cannon
       * shell arriving in a road is, and it writes into the same preallocated
       * rings a rifle round does. It is ONE call and it is what a player sees
       * walking toward them.
       */
      const im = this._impact;
      im.point = p.at;
      im.damage = p.damage ? 95 : 70;
      fx.onImpact(im);
      /**
       * AND A DUST PLUME ON EVERY BLAST ROUND, which is what makes the line
       * legible a second after it has passed.
       *
       * `onImpact`'s spall is the right size for one shell and lasts a few
       * hundred milliseconds — read back from the frames, a whole gun run was
       * over before it registered as anything more than a flicker. A short column
       * on each `DAMAGE_EVERY`-th impact puts one plume every 8.8 m and leaves
       * them standing along the axis for three seconds, so the answer to "where
       * did that just go" is still on screen. Three plumes on a short line and
       * eight on CROSS, against `fx`'s 24 emitters, and only while a run is on.
       */
      if (p.damage) {
        fx.addSmokeColumn(p.at.x, p.at.y + 0.2, p.at.z, {
          radius: 1.6,
          duration: 0.7,
          rate: 16,
          dark: 0.2,
          rise: 2.4,
          life: 3.4,
          growth: 4.2,
        });
      }
    }
    if (!p.damage) return;
    const b = this._blast;
    b.position = p.at;
    b.radius = RULES.cannonRadius;
    b.damage = RULES.cannonDamage;
    this.ctx.events.emit('explosion', b);
    if (fx) {
      fx.hazeRing(p.at.x, p.at.y + 0.35, p.at.z, 1.1, 12, 0.34, 1.5);
      fx.scorch(p.at.x, p.at.y + 0.12, p.at.z, 2.1);
    }
    this._emit('impact', run, p.at);
  }

  /** The dust is down: hand the settled pose back and switch the curve off. */
  _bakeSettled(run) {
    run.baked = true;
    const mesh = run.grit;
    mesh.instanceMatrix.array.set(mesh.userData.settled);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.owNoShadow = false;
    mesh.userData.owNoPrepass = false;
    run.uniforms.uAnim.value = 0;
    this._emit('settled', run, run.position);
  }

  /* ====================================================================== */
  /* scheduling                                                             */
  /* ====================================================================== */

  _scheduleNext() {
    // Never in the sky at the same time as a strike or a bomber run.
    if (this.busy || this._coBusy) {
      this._next = 5;
      return;
    }
    if (this._flown >= RULES.strafeMaxPerRound) {
      this._next = Infinity;
      return;
    }
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
    const [lo, hi] = RULES.strafeInterval;
    this._next = this.rng.range(lo, hi);
  }

  /** Distance from the fight to the nearest point on the impact LINE. */
  _focusWeight(run) {
    if (!this.focusValid) return 1;
    const a0 = run.impacts[0].at;
    const a1 = run.impacts[run.impacts.length - 1].at;
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

  get _coBusy() {
    const c = this.coBusy;
    if (!c) return false;
    if (Array.isArray(c)) {
      for (const o of c) if (o?.busy) return true;
      return false;
    }
    return !!c.busy;
  }

  setFocus(v) {
    if (!v) {
      this.focusValid = false;
      return;
    }
    this.focus.copy(v);
    this.focusValid = true;
  }

  /** Called by `match` when a round goes live. */
  armRound() {
    const [lo, hi] = RULES.strafeInterval;
    this._next = RULES.strafeFirstDelay + this.rng.range(0, (hi - lo) * 0.5);
    this._flown = 0;
  }

  disarm() {
    this._next = Infinity;
  }

  /** Round reset: no grit, no scorch of ours, no aeroplane. */
  reset() {
    this.disarm();
    this._live.length = 0;
    this._park();
    for (const run of this.runs) {
      run.flown = false;
      run.active = false;
      run.baked = false;
      run.next = 0;
      run.tracer = 0;
        run.t = -1;
      run.uniforms.uT.value = -1;
      run.uniforms.uAnim.value = 1;
      const mesh = run.grit;
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

  /** Fill the reused announce record. The LINE is marked, not its midpoint. */
  _announce(hook, run, lead) {
    if (!hook) return;
    const a = this._ann;
    const n = run.impacts.length;
    a.kind = 'STRAFE';
    a.id = run.id;
    a.name = run.name;
    a.lead = Math.max(0.3, lead);
    a.position = run.position;
    a.count = 0;
    a.points[a.count++] = run.impacts[0].at;
    if (n > 2) a.points[a.count++] = run.impacts[(n / 2) | 0].at;
    if (n > 1) a.points[a.count++] = run.impacts[n - 1].at;
    hook(a);
  }

  _emit(phase, run, position) {
    const e = this._ev;
    e.phase = phase;
    e.run = run.id;
    e.position = position ?? run.position;
    this.ctx.events.emit('match:strafe', e);
  }

  dispose() {
    for (const run of this.runs) {
      run.grit?.geometry?.dispose();
      run.material?.dispose();
    }
    this.aircraft?.geometry?.dispose();
    this.aircraftMat?.dispose();
    this.group.parent?.remove(this.group);
    this.runs.length = 0;
    this._live.length = 0;
  }
}
