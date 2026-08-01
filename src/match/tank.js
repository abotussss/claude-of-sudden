/**
 * MATCH — THE TANK. One per side, AI-crewed, driving a street.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * "そんで戦車イベントを早く追加しろ 総力上げて"
 * ────────────────────────────────────────────────────────────────────────────
 * A sortie is: a telegraph, an armoured vehicle that drives out of its own
 * side's end of the mid street under its own crew, acquires men on the other
 * side, shells them with a main gun and rakes them with a coaxial machine gun,
 * holds the ground it reached for `HOLD_TIME`, and reverses back out. It can be
 * killed the whole time, and killing it is worth `RULES.tankKillScore` to the
 * side that did it — which is 12 % of a domination win, so it is a play rather
 * than a trophy.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW IT NAVIGATES, AND WHY IT IS NOT `src/ai/nav.js`
 * ────────────────────────────────────────────────────────────────────────────
 * THE NAV GRID IS THE WRONG SHAPE FOR THIS AND CANNOT BE MADE THE RIGHT ONE.
 * `src/ai/nav.js` is a 2.5D height field on a 0.8 m lattice whose walkability
 * test is a 0.36 m infantry capsule with shoulder rays — it says whether a MAN
 * fits. This hull is 3.3 m wide and 6.9 m long. Every corner rule, every
 * doorway diagonal and every "one cell of pavement between a kerb and a wall"
 * in that grid is a lie to a vehicle, and the grid is `ai`'s to own: widening
 * it, adding a second capsule radius or carving a vehicle layer would be edits
 * to a subsystem this change may not touch and would change every bot's
 * pathfinding to move one tank.
 *
 * So the route is AUTHORED — a polyline down the middle of the mid street, in
 * the level's own plan coordinates, exactly the way `STRIKE_SITES` and `RUNS`
 * are authored in `airstrike.js` and `bomber.js`. It is then PROVED against the
 * built map at boot rather than trusted:
 *
 *   1. every 1.25 m along the polyline, the ground is probed with the same
 *      downward ray `physics.groundHeight` gives everything else. No ground ⇒
 *      the route is trimmed there.
 *   2. the STREET IS MEASURED at every sample — one ray left and one right,
 *      perpendicular to travel, at hull height — and the sample is SLID to the
 *      middle of the free span it found (up to `LATERAL_MAX`). The authored
 *      line is the intent; the measured centreline is where the tank drives.
 *   3. a sample whose free span is narrower than `HULL_W + CLEARANCE` TRIMS the
 *      route. The tank stops short of a pinch instead of driving through a
 *      building, and if the trim leaves less than `MIN_ROUTE` metres the whole
 *      sortie is dropped with an error naming the coordinates to fix.
 *
 * The result is baked into five flat arrays (x, y, z, yaw, pitch) plus arc
 * length, so driving is a lerp between two samples and costs no raycast at all.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IT CANNOT BLOCK A CAPTURE ZONE AND IT CANNOT BREAK `navcheck`
 * ────────────────────────────────────────────────────────────────────────────
 * Two independent guarantees, both structural rather than tuned:
 *
 *   • IT ADDS NO STATIC COLLISION AND NO NAV CHANGE. The hull is three moving
 *     `physics.addCollider` boxes on `LAYER.SHOOT_ONLY` — the layer that is in
 *     `MASK.BULLET` and in neither `MASK.CHARACTER` nor `MASK.SIGHT`. Rounds
 *     hit it, characters walk through it, A* never hears about it and the BVH
 *     is never rebuilt. `tools/navcheck.mjs`, `lanecheck` and `fightcheck` all
 *     measure a map this feature is invisible to. That IS the trade: you cannot
 *     take cover behind the hull. A 3.3 m solid moving down a lane that thirty
 *     men are pathing through, on a grid baked at boot, is how you get thirty
 *     men stuck against it — and a wreck that stops where a capture point is is
 *     the "blocks a zone permanently" failure by another name.
 *   • ITS ROUTE NEVER ENTERS A ZONE. Measured at boot and printed: the closest
 *     approach of either route to any capture circle is reported in the boot
 *     log, and both routes now stop 24 m off D — sixteen metres outside the 8 m
 *     circle they are shelling, and 58 m or further from every other point. A
 *     sortie is finite anyway — it advances, holds, and reverses back out — so
 *     nothing of it is standing anywhere when it is over. The number in this
 *     paragraph was 27 m for six commits after the map had moved it to 55-77;
 *     believe the boot log, not this comment. @see `ROUTES`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NOTHING IS COMPUTED IN THE FRAME IT DIES
 * ────────────────────────────────────────────────────────────────────────────
 * The same rule `airstrike.js` is built on, and it uses that file's own
 * helpers. At boot each tank's turret, gun, stowage and track runs are cut by
 * `fracture()` into ~250 chunks with their whole trajectory solved into four
 * instanced attributes, and the debris mesh is parented to the tank's own root
 * — so the fracture is baked in the HULL'S LOCAL FRAME and needs no rebuild
 * wherever on the route the tank happens to be when it brews up. The death
 * frame is: two booleans per mesh, one uniform write, one `explosion` event and
 * the `fx` calls that all write into preallocated rings.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLIC API   const a = ctx.get('match').armour
 * ────────────────────────────────────────────────────────────────────────────
 *   a.tanks                  [{ id, team, name, alive, health, position }]
 *   a.call()                 launch the sortie (both sides) with its telegraph
 *   a.fire()                 launch it now, no telegraph
 *   a.enemies = (team, out)  installed by `match`: fill `out` with live hostiles
 *   a.onAnnounce/onImpact    the same reused-record hooks the air systems use
 *   a.onKill = (tank, by)    a tank was destroyed. `match` scores it.
 *   a.busy                   something of ours is on the map
 *
 * Emits `match:tank { phase, id, team, position }`, phase
 * 'inbound' | 'rolling' | 'kill' | 'dead' | 'clear'.
 */

import * as THREE from 'three';
import { RULES, TEAM_COLOR } from './rules.js';
import { fracture, chunkGeometry, makeChunkMaterial, mergeGeometries, clamp } from './airstrike.js';

/**
 * THE MAP IS 1.5x. Same note as `src/match/sites.js` and `src/match/airstrike.js`
 * — `match` may not import `world`, so the factor is repeated. IF ONE MOVES,
 * MOVE THE OTHERS.
 *
 * These are authored in the WIDENED plan (the space `SPAWNS` and `ZONES` use in
 * sites.js), because the mid street is the one place on this map wide enough to
 * drive a tank down and `widenX` is the identity on its centreline.
 */
const SCALE = 1.5;
const L = (x, z) => [x * SCALE, z * SCALE];

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE TWO ROUTES, RE-AIMED AT THE CATHEDRAL — "まだ戦車が登場したの一回も見て
 * いないです"
 * ────────────────────────────────────────────────────────────────────────────
 * THE OLD ROUTES WORKED PERFECTLY AND THAT WAS THE PROBLEM. Measured over three
 * matches by `_tankdiag.mjs`: both hulls baked, both rolled at t = 91 s, both
 * drove their whole 57 m route, both reversed out ~60 s later — and the hull was
 * ON SCREEN for 0 of 4058 frames, finished on 2600/2600 health with not one
 * round from either side on it, and its closest approach to any capture circle
 * was 55 m (BLUE) and 77 m (RED). The header of this file still claimed "~27 m,
 * measured and printed at boot"; the map had grown out from under the authored
 * polyline (`SPAWNS` went out to level z ∓90, `widenX` prised the mid street
 * open to x ∓23, A and B moved to the flank districts) and nobody re-measured.
 *
 * So the polyline is authored against the map that exists, and it is aimed at
 * the one place the match is guaranteed to be: the CATHEDRAL. Each route leaves
 * its own side's spawn street six metres in front of the front rank — so the
 * first thing you see on foot is your own armour pulling out ahead of you —
 * converges on the mid street's centreline and stops in the square at the
 * cathedral's end wall. Both hulls arrive as D opens in the wreckage, which is
 * what makes them the collapse's consequence rather than a timer.
 * @see `RULES.tankAfterCathedral`.
 *
 * MEASURED WITH `_tankroute.mjs`, which re-runs `_bakePath` against the built
 * map without a rebuild, and re-printed at boot by `_logZones`:
 *
 *     RED    67.0 m of route, narrowest street 5.7 m, ends 24.1 m off D
 *     BLUE   75.7 m of route, narrowest street 10.0 m, ends 23.8 m off D
 *
 * ITS ROUTE STILL NEVER ENTERS A ZONE. 24 m against an 8 m circle, so the hull
 * stops sixteen metres outside the point it is shelling — close enough that the
 * gun and the coax cover the ruin, far enough that a wreck is never standing on
 * the capture circle. Every other capture point is 58 m or further from either
 * route; the boot log prints the true closest approach and the zone it is to,
 * so this claim is a measurement and stays one when the map moves again.
 *
 * The two converge on the centreline from opposite ends rather than staying in
 * echelon, because the thing that keeps them from being nose to nose down a
 * firing line is now the RUIN between them — 3.1 m of rubble against a muzzle
 * 2.6 m off the road, which `MASK.SIGHT` stops dead in `_acquire`.
 */
const ROUTES = [
  {
    id: 'RED',
    team: 0,
    name: 'RED ARMOUR',
    points: [L(8, 56), L(7, 46), L(5, 36), L(2.5, 28), L(1, 20), L(0.5, 15)],
  },
  {
    id: 'BLUE',
    team: 1,
    name: 'BLUE ARMOUR',
    points: [L(-8, -56), L(-7, -46), L(-5, -36), L(-2.5, -28), L(-1, -22), L(-0.5, -17)],
  },
];

/* ---- the hull, in metres, in the tank's own frame ------------------------ */
/** +Z forward, +X right, +Y up, origin on the ground between the tracks. */
const HULL_W = 3.3;
const HULL_L = 6.9;
/** Metres of street the hull needs on top of its own width to drive somewhere. */
const CLEARANCE = 1.1;
/** How far a sample may be slid sideways onto the measured centreline. */
const LATERAL_MAX = 3.0;
/** Spacing of the baked path samples. */
const STEP = 1.25;
/** A route shorter than this is not a sortie. */
const MIN_ROUTE = 16;

/** Metres/second. A tracked vehicle in a street, not a car. */
const SPEED_ADVANCE = 4.6;
/** It slows down to shoot — a hull-down halt is what makes the gun readable. */
const SPEED_FIGHT = 1.5;
const SPEED_REVERSE = 3.4;
/** Seconds it sits at the end of its run before reversing out. */
const HOLD_TIME = 30;
/** Seconds of telegraph before the engine note becomes a tank in the street. */
const TANK_LEAD = 6.0;

/** Turret traverse and gun elevation, radians/second. */
const TRAVERSE = 0.62;
const ELEVATE = 0.5;
/** Gun elevation limits. */
const GUN_UP = 0.30;
const GUN_DOWN = -0.16;
/** How far off the target the gun has to be before the crew will fire. */
const AIM_TOL = 0.035;
/** Seconds between target re-selections. Cheap, but not every frame. */
const ACQUIRE_EVERY = 0.4;

/** Coaxial burst shape: rounds, and the gap between them. */
const COAX_ROUNDS = 9;
const COAX_GAP = 0.085;
const COAX_REST = 1.5;

/**
 * WHERE THE ARMOUR IS, as a damage multiplier per box.
 *
 * A tank that dies to a magazine is a jeep and a tank that never dies is
 * scenery, so the answer is that it dies to the RIGHT rounds: the glacis eats
 * rifle fire (0.22), the turret is a little softer (0.4), and the engine deck
 * over the back is the shot that works (1.7). A grenade or an airstrike is
 * `EXPLOSION_MUL` of its own blast — two frags on the deck, or one strike
 * landing on it, kills it. Measured against `RULES.tankHealth`: ~28 rifle
 * rounds into the deck, ~110 into the front.
 */
const PART_MUL = { hull: 0.22, turret: 0.4, deck: 1.7 };
const EXPLOSION_MUL = 1.35;

/** Where the fracture ends up: the debris settles inside this radius, locally. */
const WRECK_R = 4.2;

const UP = new THREE.Vector3(0, 1, 0);

/* ========================================================================== */

export class Armour {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.rng = opts.rng ?? ctx.rng.fork();
    this.enabled = true;
    this.ready = false;
    this.tanks = [];
    this.buildMs = 0;

    /** Installed by `match`: fill `out` with the live hostiles of `team`. */
    this.enemies = null;
    /** Installed by `match`: a tank died and somebody gets paid for it. */
    this.onKill = null;
    this.onAnnounce = null;
    this.onImpact = null;
    /** The air systems, so a sortie does not open under an inbound salvo. */
    this.coBusy = null;

    this._next = Infinity;
    this._sorties = 0;
    this._liveT = 0;
    /** Pending telegraphed launch: seconds left. */
    this._pending = -1;
    /** The cathedral's own sortie rolls through the dust. @see `armAfter`. */
    this._ignoreCoBusy = false;

    this.group = new THREE.Group();
    this.group.name = 'match-armour';
    this.group.matrixAutoUpdate = false;

    /* scratch — nothing below allocates */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    /** The hull's pitch quaternion, composed with its yaw every frame. */
    this._qp = new THREE.Quaternion();
    /** Where the route ends — what the HUD arrow points at. */
    this._end = new THREE.Vector3();
    /** `_destroy`'s own position, because a death can happen INSIDE a shell's
     *  own `explosion` emit (the other tank's) and would otherwise clobber the
     *  vector that emit is still using. Same reason `_deathBlast` is separate. */
    this._v4 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._sc = new THREE.Vector3(1, 1, 1);
    this._targets = [];
    this._blast = { position: this._v2, radius: 0, damage: 0, source: null };
    this._deathBlast = { position: this._v4, radius: 0, damage: 0, source: null };
    this._ev = { phase: '', id: '', team: 0, position: this._v2 };
    this._ann = {
      kind: 'TANK',
      id: '',
      name: '',
      lead: TANK_LEAD,
      position: null,
      points: [null, null],
      count: 0,
    };

    this._onExplosion = (e) => this._takeBlast(e);
    this._onDamage = (e) => this._takeRound(e);
  }

  get busy() {
    if (this._pending >= 0) return true;
    for (const t of this.tanks) if (t.state !== 'parked') return true;
    return false;
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

  /* ====================================================================== */
  /* BOOT                                                                   */
  /* ====================================================================== */

  build() {
    const t0 = performance.now();
    const ctx = this.ctx;
    const world = ctx.peek('world');
    const physics = ctx.peek('physics');
    if (!world || !physics) {
      console.warn('[tank] no world/physics — disabled');
      return this;
    }
    this.physics = physics;
    this._lib = ctx.peek('materials');

    for (const spec of ROUTES) {
      const tank = this._buildTank(spec, world, physics);
      if (tank) this.tanks.push(tank);
    }
    if (this.tanks.length) ctx.scene.add(this.group);

    ctx.events.on('explosion', this._onExplosion);
    ctx.events.on('damage:dealt', this._onDamage);

    this.ready = this.tanks.length > 0;
    this.buildMs = performance.now() - t0;
    console.info(
      `[tank] ${this.tanks.length}/${ROUTES.length} tanks baked in ${this.buildMs.toFixed(0)}ms — ` +
        this.tanks
          .map(
            (t) =>
              `${t.id} route ${t.path.length.toFixed(0)}m/${t.path.n} samples, ` +
              `${t.chunkCount} wreck chunks, narrowest street ${t.path.narrowest.toFixed(1)}m`
          )
          .join(' · ')
    );
    if (this.tanks.length < ROUTES.length) {
      console.error(
        `[tank] ${ROUTES.length - this.tanks.length} SORTIE(S) DROPPED — the route ` +
          'coordinates in src/match/tank.js no longer match the map.'
      );
    }
    return this;
  }

  /* --------------------------------------------------------------- route -- */

  /**
   * Author -> measure -> bake. See the long note at the top of the file for why
   * this exists at all instead of `ai.grid.findPath`.
   */
  _bakePath(spec, world, physics) {
    const pts = [];
    for (const p of spec.points) pts.push(world.levelToWorld(p[0], 0, p[1], new THREE.Vector3()));

    /* ---- resample the polyline at a fixed step ------------------------- */
    const rx = [];
    const rz = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.round(seg / STEP));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        rx.push(a.x + (b.x - a.x) * t);
        rz.push(a.z + (b.z - a.z) * t);
      }
    }
    rx.push(pts[pts.length - 1].x);
    rz.push(pts[pts.length - 1].z);

    /* ---- measure the street and slide onto its middle ------------------ */
    const MASK = physics.MASK.WORLD;
    const need = HULL_W + CLEARANCE;
    const probe = new THREE.Vector3();
    const side = new THREE.Vector3();
    let narrowest = Infinity;
    let kept = 0;
    const px = [];
    const py = [];
    const pz = [];
    for (let i = 0; i < rx.length; i++) {
      // direction of travel, from the neighbours so the ends are not special
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(rx.length - 1, i + 1);
      let dx = rx[i1] - rx[i0];
      let dz = rz[i1] - rz[i0];
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl;
      dz /= dl;
      side.set(dz, 0, -dx);

      let x = rx[i];
      let z = rz[i];
      let y = physics.groundHeight(x, z, 30);
      if (!Number.isFinite(y)) break;

      probe.set(x, y + 1.0, z);
      const right = physics.raycast(probe, side, 9, MASK);
      side.multiplyScalar(-1);
      const left = physics.raycast(probe, side, 9, MASK);
      side.multiplyScalar(-1);
      const dR = right?.hit ? right.distance : 9;
      const dL = left?.hit ? left.distance : 9;
      // Slide to the middle of what was found, then re-probe the ground there.
      const shift = clamp((dR - dL) * 0.5, -LATERAL_MAX, LATERAL_MAX);
      x += side.x * shift;
      z += side.z * shift;
      const y2 = physics.groundHeight(x, z, 30);
      if (Number.isFinite(y2)) y = y2;
      const span = dR + dL;
      if (span < need) break; // a pinch: the route ends here
      narrowest = Math.min(narrowest, span);

      px.push(x);
      py.push(y);
      pz.push(z);
      kept++;
    }
    if (kept < 4) return null;

    /* ---- bake yaw, pitch and arc length -------------------------------- */
    const n = kept;
    const X = new Float32Array(n);
    const Y = new Float32Array(n);
    const Z = new Float32Array(n);
    const YAW = new Float32Array(n);
    const PITCH = new Float32Array(n);
    const S = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      X[i] = px[i];
      Y[i] = py[i];
      Z[i] = pz[i];
      if (i > 0) S[i] = S[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
    }
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      const dx = X[i1] - X[i0];
      const dz = Z[i1] - Z[i0];
      const dy = Y[i1] - Y[i0];
      YAW[i] = Math.atan2(dx, dz);
      const run = Math.hypot(dx, dz) || 1;
      // Clamped: a kerb the ground ray caught must not stand the tank on end.
      PITCH[i] = clamp(Math.atan2(dy, run), -0.16, 0.16);
    }
    const length = S[n - 1];
    if (length < MIN_ROUTE) return null;
    return { n, X, Y, Z, YAW, PITCH, S, length, narrowest: narrowest === Infinity ? 0 : narrowest };
  }

  /* ---------------------------------------------------------- one tank --- */

  _buildTank(spec, world, physics) {
    const rng = this.rng.fork();
    const path = this._bakePath(spec, world, physics);
    if (!path) {
      console.error(
        `[tank] ${spec.id}: no drivable route from the authored polyline — SORTIE DROPPED. ` +
          'The street is narrower than the hull or the anchor is not on the ground; ' +
          'fix `ROUTES` in src/match/tank.js.'
      );
      return null;
    }

    const root = new THREE.Group();
    root.name = `match_tank_${spec.id}`;
    root.matrixAutoUpdate = false;
    root.visible = false;
    this.group.add(root);

    const turret = new THREE.Group();
    turret.name = `match_tank_${spec.id}_turret`;
    turret.matrixAutoUpdate = false;
    turret.position.set(0, 1.52, -0.15);
    root.add(turret);

    const gun = new THREE.Group();
    gun.name = `match_tank_${spec.id}_gun`;
    gun.matrixAutoUpdate = false;
    gun.position.set(0, 0.42, 0.95);
    turret.add(gun);

    const tank = {
      id: spec.id,
      team: spec.team,
      name: spec.name,
      /** So `ai.teamOf()` and `ui.isFriendlyTarget` answer correctly when a
       *  round lands on us — see the `damage:dealt` note in `_takeRound`. */
      isTank: true,
      path,
      root,
      turret,
      gun,
      rng,
      meshes: [],
      materials: [],
      colliders: [],
      state: 'parked',
      /** Metres travelled along the baked path. */
      s: 0,
      hold: 0,
      health: RULES.tankHealth,
      alive: false,
      /** World position of the hull centre, kept in step every frame. */
      position: new THREE.Vector3(),
      /** Where the gun is pointing, in the hull's frame. */
      turretYaw: 0,
      gunPitch: 0,
      target: null,
      acquireIn: 0,
      reload: 0,
      coax: 0,
      coaxLeft: 0,
      lastHitBy: null,
      chunkCount: 0,
      wheelSpin: 0,
      uniforms: { uT: { value: -1 }, uAnim: { value: 1 } },
    };

    this._buildBody(tank);
    this._buildWreck(tank);
    this._buildColliders(tank, physics);
    this._logZones(tank);
    return tank;
  }

  /**
   * Closest the baked route ever gets to a capture circle, printed so the
   * "it must not block a capture zone" claim is a measurement.
   */
  _logZones(tank) {
    const m = this.ctx.peek('match');
    /**
     * `allZones`, NOT `sites`, AND THAT IS THE WHOLE VALUE OF THE LINE. D is
     * `locked` at boot and therefore not in `sites`, so the old measurement
     * silently omitted the one capture point the route now drives at: it
     * reported 55 m and 77 m to zone C while the true closest approach was
     * 35 m to D. A guarantee that skips a point does not guarantee anything.
     */
    const zones = m?.allZones ?? m?.sites;
    if (!zones?.length) return;
    let best = Infinity;
    let which = '';
    for (const z of zones) {
      for (let i = 0; i < tank.path.n; i++) {
        const d = Math.hypot(tank.path.X[i] - z.position.x, tank.path.Z[i] - z.position.z);
        if (d < best) {
          best = d;
          which = z.id;
        }
      }
    }
    console.info(
      `[tank] ${tank.id}: closest approach to a capture circle is ${best.toFixed(1)} m ` +
        `(zone ${which}, r${RULES.captureRadius})`
    );
  }

  /* ====================================================================== */
  /* THE MODEL                                                              */
  /* ====================================================================== */

  /**
   * A private instance of a library surface, for exactly the reason
   * `Airstrike._makeMaterial` documents: `materials.get()` hands back a SHARED
   * material and this one wants its own tint. The level's own albedo, normal and
   * ORM bakes come through, which is what keeps the hull off the quality bar's
   * "no flat/untextured surfaces".
   */
  _hullMaterial(tank, name, tint, opts = {}) {
    const set = this._lib?.getTextureSet?.(name) ?? null;
    const mat = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: opts.roughness ?? 0.68,
      metalness: opts.metalness ?? 0.35,
      dithering: true,
    });
    mat.name = `tank_${tank.id}_${name}`;
    if (set) {
      mat.map = set.albedo;
      mat.normalMap = set.normal;
      mat.normalScale.set(opts.normalScale ?? 1.0, opts.normalScale ?? 1.0);
      /**
       * `orm` is the LIBRARY's roughness for that surface, and three MULTIPLIES
       * it into `roughness`. For the road wheels that was the whole bug behind
       * "six cream circles a side": the rubber bake's ORM is glossy in the
       * crowns, so a 0.05-albedo tyre picked up a sky reflection and read as
       * pale concrete. `flat: true` is "this surface has no gloss variation" —
       * the scalar stands alone.
       */
      if (!opts.flat) mat.roughnessMap = set.orm;
    }
    this.ctx.peek('render')?.patcher?.patch(mat);
    tank.materials.push(mat);
    return mat;
  }

  /**
   * THE HULL, THE TURRET, THE GUN AND EVERYTHING BOLTED TO THEM.
   *
   * Built out of boxes and cylinders merged per material at boot; none of it is
   * a flat slab: the glacis and the rear plate are sloped plates, the turret is
   * six faceted panels rather than a cube, the track run is thirty-odd
   * individual shoes laid round the road wheels so it has real relief in a
   * grazing light, and the stowage — bins, drums, a tarp roll, spare track links
   * on the nose, a tow cable down each side — is what stops the silhouette
   * reading as a shipping container with a pipe on it.
   *
   * ────────────────────────────────────────────────────────────────────────
   * ELEVEN LISTS, NOT FOUR, AND THE BUG THAT SAYS WHY
   * ────────────────────────────────────────────────────────────────────────
   * The merge key is (MATERIAL × PARENT), never material alone. The parts below
   * are authored in three different frames — hull-local, TURRET-local and
   * GUN-local — and a geometry merged into the wrong parent keeps its numbers
   * and loses its frame.
   *
   * That is not hypothetical. With one `gear` list the gun TUBE, the muzzle
   * brake and the coaxial MG — all authored at gun-local (0, 0, 0.4..4.9) —
   * were merged into the hull's running-gear mesh and therefore drawn at
   * hull-local y = 0: the barrel lay on the road beside the tracks, and the
   * turret was a bare box with no cupola, no dischargers and no aerial, because
   * every one of those had gone the same way. Photographed and fixed.
   *
   * So: `paint`/`gear`/`canvas`/`team` are hull-local, `tPaint`/`tGear`/
   * `tCanvas`/`tTeam` are turret-local, `gPaint`/`gGear` are gun-local, and the
   * road wheels are their own InstancedMesh. Eleven draw calls for a vehicle
   * that is on screen twice a match; a merge that crosses a moving joint is not
   * a saving, it is a different model.
   */
  _buildBody(tank) {
    const rng = tank.rng;
    /* hull-local */
    const paint = [];
    const gear = [];
    const canvas = [];
    const team = [];
    /* turret-local */
    const tPaint = [];
    const tGear = [];
    const tCanvas = [];
    const tTeam = [];
    /* gun-local */
    const gPaint = [];
    const gGear = [];

    const box = (list, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (rx || ry || rz) g.rotateX(rx), g.rotateY(ry), g.rotateZ(rz);
      g.translate(x, y, z);
      list.push(g);
      return g;
    };
    const cyl = (list, r0, r1, h, seg, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const g = new THREE.CylinderGeometry(r0, r1, h, seg);
      if (rx || ry || rz) g.rotateX(rx), g.rotateY(ry), g.rotateZ(rz);
      g.translate(x, y, z);
      list.push(g);
      return g;
    };

    const hw = HULL_W * 0.5; // 1.65
    const trackW = 0.52;
    const trackX = hw - trackW * 0.5; // centre of each track run
    const hullW = HULL_W - trackW * 2 + 0.12; // between the tracks, with sponsons over

    /* ---- lower hull and sponsons -------------------------------------- */
    box(paint, hullW, 0.95, 6.1, 0, 0.92, -0.1);
    box(paint, HULL_W - 0.06, 0.46, 5.5, 0, 1.55, -0.2); // sponsons over the tracks
    /**
     * THE GLACIS, AND THE SIGN THAT WAS WRONG.
     *
     * `rotateX(θ)` sends a point at +Z to `y = -z sinθ`, so a NEGATIVE θ lifts
     * the FRONT of a plate. At -0.62 this plate stood up in front of the turret
     * like a dozer blade — photographed. A glacis slopes the other way: nose
     * low, top edge back at the hull roof. Positive θ, and the two things
     * bolted to it (the spare links and the team plate) carry the same sign.
     *
     * The numbers are the two edges rather than a guess: top edge at the roof
     * line (y 1.78, z 2.05), bottom edge at the nose (y 0.62, z 3.34) — a
     * 1.74 m plate at 0.73 rad from horizontal, which is a 42 degree glacis.
     */
    box(paint, HULL_W - 0.1, 0.2, 1.74, 0, 1.2, 2.7, 0.73);
    box(paint, hullW, 0.2, 1.0, 0, 0.62, 3.3, 0.55);
    // rear plate, sloped the other way, and the engine deck over the back
    box(paint, HULL_W - 0.12, 0.2, 1.5, 0, 1.28, -3.05, -0.5);
    box(paint, HULL_W - 0.24, 0.14, 2.3, 0, 1.79, -1.95);
    // deck louvres — six ribs across the engine deck
    for (let i = 0; i < 6; i++) {
      box(gear, HULL_W - 0.5, 0.09, 0.13, 0, 1.87, -2.75 + i * 0.32);
    }
    // driver's hatch and periscopes
    cyl(paint, 0.29, 0.29, 0.1, 12, -0.62, 1.85, 1.55);
    box(gear, 0.22, 0.09, 0.1, -0.62, 1.92, 1.82);
    box(gear, 0.18, 0.08, 0.09, -0.28, 1.9, 1.86);
    // headlamp cluster and its guard
    cyl(gear, 0.13, 0.13, 0.1, 10, -1.12, 1.62, 3.32, 0, 0, Math.PI / 2);
    box(gear, 0.05, 0.3, 0.05, -1.12, 1.62, 3.38);
    cyl(gear, 0.11, 0.11, 0.09, 10, 1.12, 1.6, 3.3, 0, 0, Math.PI / 2);

    /* ---- running gear: tracks, wheels, sprockets ----------------------- */
    // The track PATH: two straight runs joined by two arcs, laid as shoes.
    const wheelY = 0.62;
    const wheelR = 0.44;
    const sprocketZ = -2.62;
    const idlerZ = 2.62;
    const shoes = 34;
    for (const sx of [-1, 1]) {
      for (let i = 0; i < shoes; i++) {
        const u = i / shoes;
        // parametric loop: bottom run, front arc, top run, rear arc
        let x = 0;
        let y = 0;
        let z = 0;
        if (u < 0.36) {
          const t = u / 0.36;
          z = sprocketZ + (idlerZ - sprocketZ) * t;
          y = wheelY - wheelR;
        } else if (u < 0.5) {
          const a = ((u - 0.36) / 0.14) * Math.PI;
          z = idlerZ + Math.sin(a) * wheelR;
          y = wheelY - Math.cos(a) * wheelR;
        } else if (u < 0.86) {
          const t = (u - 0.5) / 0.36;
          z = idlerZ + (sprocketZ - idlerZ) * t;
          y = wheelY + wheelR + 0.06; // the top run sags over the rollers
        } else {
          const a = ((u - 0.86) / 0.14) * Math.PI;
          z = sprocketZ - Math.sin(a) * wheelR;
          y = wheelY + Math.cos(a) * wheelR;
        }
        x = sx * trackX;
        const tilt = u < 0.36 || (u >= 0.5 && u < 0.86) ? 0 : rng.range(-0.35, 0.35);
        box(gear, trackW, 0.13, 0.42, x, y, z, tilt);
        // the guide horn on the inner edge of every other shoe
        if (i % 2 === 0) box(gear, 0.1, 0.12, 0.16, x - sx * 0.14, y + 0.1, z, tilt);
      }
      // drive sprocket and idler
      cyl(gear, 0.4, 0.4, 0.3, 14, sx * trackX, wheelY, sprocketZ, 0, 0, Math.PI / 2);
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2;
        box(gear, 0.16, 0.12, 0.12, sx * trackX, wheelY + Math.cos(a) * 0.42, sprocketZ + Math.sin(a) * 0.42, 0, 0, -a);
      }
      cyl(gear, 0.36, 0.36, 0.3, 14, sx * trackX, wheelY, idlerZ, 0, 0, Math.PI / 2);
      // return rollers under the top run
      for (let i = 0; i < 3; i++) {
        cyl(gear, 0.13, 0.13, 0.2, 10, sx * trackX, wheelY + 0.44, -1.5 + i * 1.5, 0, 0, Math.PI / 2);
      }
      // side skirt plates, one per bogie, each hanging slightly differently
      for (let i = 0; i < 5; i++) {
        box(paint, 0.07, 0.5, 0.92, sx * (trackX + 0.24), 1.28, -2.0 + i * 1.0, 0, 0, rng.range(-0.05, 0.05));
      }
    }

    /* ---- road wheels, their own instanced mesh so they can turn -------- */
    this._buildWheels(tank, trackX, wheelY, wheelR);

    /* ---- stowage: what makes it look used ------------------------------ */
    // spare track links bolted across the glacis (same slope as the plate)
    for (let i = 0; i < 5; i++) {
      box(gear, 0.42, 0.12, 0.14, -0.9 + i * 0.45, 1.28, 2.78, 0.73, 0, rng.range(-0.03, 0.03));
    }
    // tool bins down the right sponson, fuel drums across the back
    box(paint, 0.34, 0.36, 1.25, hw - 0.16, 1.94, 0.55);
    box(paint, 0.34, 0.3, 0.85, hw - 0.16, 1.9, -0.85);
    cyl(gear, 0.27, 0.27, 0.82, 12, 0.72, 2.06, -3.35, 0, 0, Math.PI / 2);
    cyl(gear, 0.27, 0.27, 0.82, 12, -0.72, 2.06, -3.35, 0, 0, Math.PI / 2);
    // A tarpaulin roll and a folded net on the left sponson. The roll lies
    // FORE-AFT: across the hull it hung 0.55 m outside the tracks at head
    // height, and the narrowest street the route survives is 9.6 m.
    cyl(canvas, 0.21, 0.19, 1.5, 10, -(hw - 0.2), 1.92, 0.9, Math.PI / 2, 0, 0);
    box(canvas, 0.4, 0.26, 0.85, -(hw - 0.22), 1.9, -0.8, 0, rng.range(-0.1, 0.1), 0);
    // tow cable: four short runs down each side, so it drapes
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        box(gear, 0.06, 0.06, 1.15, sx * (hw - 0.05), 1.72 + (i % 2) * 0.05, -1.9 + i * 1.25, 0, 0, 0);
      }
    }
    // towing eyes
    box(gear, 0.16, 0.16, 0.24, -0.85, 0.85, 3.35);
    box(gear, 0.16, 0.16, 0.24, 0.85, 0.85, 3.35);

    /* ---- the turret ---------------------------------------------------- */
    // six faceted panels instead of a box: cheeks, sides, rear bustle, roof
    box(tPaint, 2.24, 0.78, 1.9, 0, 0, -0.1);
    box(tPaint, 1.5, 0.72, 0.95, 0, -0.02, 1.0, 0, 0, 0); // front, narrower
    box(tPaint, 1.05, 0.7, 0.8, 0.62, -0.02, 0.72, 0, -0.5, 0); // right cheek
    box(tPaint, 1.05, 0.7, 0.8, -0.62, -0.02, 0.72, 0, 0.5, 0); // left cheek
    box(tPaint, 2.05, 0.5, 1.05, 0, 0.05, -1.42); // rear bustle
    box(tPaint, 2.1, 0.1, 2.6, 0, 0.4, -0.2); // roof
    // commander's cupola, hatch, and the pintle MG on its ring
    cyl(tPaint, 0.42, 0.42, 0.3, 14, 0.5, 0.56, -0.5);
    cyl(tGear, 0.44, 0.44, 0.07, 14, 0.5, 0.73, -0.5);
    box(tGear, 0.1, 0.1, 0.66, 0.5, 0.86, -0.16);
    box(tGear, 0.13, 0.16, 0.2, 0.5, 0.84, -0.52);
    cyl(tPaint, 0.3, 0.3, 0.26, 12, -0.62, 0.54, -0.55); // loader's hatch
    // vision blocks around the cupola
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      box(tGear, 0.16, 0.1, 0.06, 0.5 + Math.sin(a) * 0.42, 0.6, -0.5 + Math.cos(a) * 0.42, 0, a, 0);
    }
    // smoke dischargers, three a side, splayed
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        cyl(tGear, 0.09, 0.09, 0.32, 8, sx * 0.95, 0.16, 0.35 - i * 0.26, -0.35, sx * 0.25, 0);
      }
    }
    // stowage basket around the bustle: a frame plus a canvas roll in it
    for (let i = 0; i < 5; i++) {
      box(tGear, 0.05, 0.34, 0.05, -0.95 + i * 0.48, 0.44, -1.95);
    }
    box(tGear, 2.0, 0.05, 0.05, 0, 0.6, -1.95);
    box(tCanvas, 1.55, 0.3, 0.42, 0, 0.42, -1.86, rng.range(-0.06, 0.06));
    // antenna bases and one bent whip
    cyl(tGear, 0.07, 0.07, 0.14, 8, -0.9, 0.5, -1.3);
    box(tGear, 0.035, 1.5, 0.035, -0.9, 1.28, -1.3, 0.12, 0, 0.07);
    // spare links on the turret side, the classic bit of extra armour
    for (let i = 0; i < 4; i++) {
      box(tGear, 0.1, 0.13, 0.4, -1.12, 0.12, 0.55 - i * 0.42);
    }

    /* ---- team markings ------------------------------------------------- */
    // A band round the bustle and a plate on each cheek, in the side's own HUD
    // colour: at 60 m in a shadowed street the silhouette is identical, so the
    // only thing that says whose tank it is has to be paint.
    box(tTeam, 2.12, 0.16, 0.06, 0, 0.12, -1.97);
    box(tTeam, 0.06, 0.34, 0.5, 1.13, 0.06, -0.3);
    box(tTeam, 0.06, 0.34, 0.5, -1.13, 0.06, -0.3);
    box(team, 0.5, 0.06, 0.34, 0, 1.02, 3.02, 0.73);

    /* ---- the gun ------------------------------------------------------- */
    // mantlet, barrel with a thermal sleeve over the breech end, muzzle brake
    box(gPaint, 1.15, 0.66, 0.5, 0, 0, 0.1);
    cyl(gPaint, 0.24, 0.2, 0.36, 14, 0, 0, 0.42, Math.PI / 2);
    cyl(gPaint, 0.155, 0.145, 2.1, 14, 0, 0, 1.55, Math.PI / 2); // sleeve
    cyl(gGear, 0.105, 0.098, 4.4, 14, 0, 0, 2.6, Math.PI / 2); // tube
    cyl(gGear, 0.17, 0.17, 0.5, 12, 0, 0, 4.6, Math.PI / 2); // muzzle brake
    box(gGear, 0.42, 0.1, 0.16, 0, 0, 4.55); // brake ports
    box(gGear, 0.42, 0.1, 0.16, 0, 0, 4.72);
    // coaxial machine gun beside the mantlet
    cyl(gGear, 0.055, 0.05, 1.1, 8, 0.42, -0.12, 0.95, Math.PI / 2);

    /* ---- merge, one mesh per material ---------------------------------- */
    const tint = tank.team === 0 ? 0x6b6450 : 0x4a5652;
    const mPaint = this._hullMaterial(tank, 'metal_painted', tint, { roughness: 0.72, metalness: 0.3 });
    const mGear = this._hullMaterial(tank, 'metal_rust', 0x55514a, { roughness: 0.9, metalness: 0.55, normalScale: 1.2 });
    const mCanvas = this._hullMaterial(tank, 'burlap', 0x6d6552, { roughness: 0.95, metalness: 0 });
    const mTeam = this._hullMaterial(tank, 'metal_painted', new THREE.Color(TEAM_COLOR[tank.team]).multiplyScalar(0.72).getHex(), {
      roughness: 0.6,
      metalness: 0.2,
    });

    const add = (parent, list, mat, name) => {
      if (!list.length) return;
      const mesh = new THREE.Mesh(mergeGeometries(list), mat);
      mesh.name = `match_tank_${tank.id}_${name}`;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.updateMatrix();
      parent.add(mesh);
      tank.meshes.push(mesh);
    };
    add(tank.root, paint, mPaint, 'hull');
    add(tank.root, gear, mGear, 'gear');
    add(tank.root, canvas, mCanvas, 'canvas');
    add(tank.root, team, mTeam, 'markings');
    add(tank.turret, tPaint, mPaint, 'turret');
    add(tank.turret, tGear, mGear, 'turret_gear');
    add(tank.turret, tCanvas, mCanvas, 'turret_canvas');
    add(tank.turret, tTeam, mTeam, 'turret_markings');
    add(tank.gun, gPaint, mPaint, 'gun');
    add(tank.gun, gGear, mGear, 'gun_barrel');
    tank.gearMat = mGear;
  }

  /**
   * The road wheels. Their own InstancedMesh because they TURN — twelve matrix
   * composes a frame off one preallocated quaternion, which is what a tracked
   * vehicle that is obviously moving costs.
   */
  _buildWheels(tank, trackX, wheelY, wheelR) {
    const rim = new THREE.CylinderGeometry(wheelR, wheelR, 0.3, 16);
    rim.rotateZ(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(0.17, 0.17, 0.34, 10);
    hub.rotateZ(Math.PI / 2);
    // Six lightening holes, so a wheel is not a disc.
    const holes = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const g = new THREE.BoxGeometry(0.33, 0.15, 0.15);
      g.translate(0, Math.cos(a) * 0.28, Math.sin(a) * 0.28);
      holes.push(g);
    }
    const geo = mergeGeometries([rim, hub, ...holes]);
    /**
     * A ROAD WHEEL IS THE DARKEST THING ON THE VEHICLE. `getTextureSet` hands
     * back the RAW bake — none of the library's `mat` tint/weather params are
     * applied, they belong to `materials.get()` — and the rubber bake alone
     * renders as a pale disc in direct sun, which is what six cream circles a
     * side looked like. 0x17_1614 against that map lands at roughly 0.05
     * albedo, which is what rubber is.
     */
    const mat = this._hullMaterial(tank, 'rubber', 0x171614, { roughness: 1.0, metalness: 0.0, flat: true });
    const n = 12;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.name = `match_tank_${tank.id}_wheels`;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.updateMatrix();
    tank.root.add(mesh);
    tank.wheels = mesh;
    tank.wheelPos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const sx = i < 6 ? -1 : 1;
      const k = i % 6;
      tank.wheelPos[i * 3] = sx * trackX;
      tank.wheelPos[i * 3 + 1] = wheelY;
      tank.wheelPos[i * 3 + 2] = -2.05 + k * 0.82;
    }
    this._poseWheels(tank);
    tank.meshes.push(mesh);
  }

  _poseWheels(tank) {
    const m = this._m;
    const q = this._q;
    const v = this._v;
    q.setFromAxisAngle(RIGHT, tank.wheelSpin);
    for (let i = 0; i < 12; i++) {
      v.set(tank.wheelPos[i * 3], tank.wheelPos[i * 3 + 1], tank.wheelPos[i * 3 + 2]);
      m.compose(v, q, this._sc);
      m.toArray(tank.wheels.instanceMatrix.array, i * 16);
    }
    tank.wheels.instanceMatrix.needsUpdate = true;
  }

  /* ====================================================================== */
  /* THE WRECK, BAKED AT BOOT                                               */
  /* ====================================================================== */

  /**
   * What comes off when it brews up, cut and solved at boot exactly the way
   * `airstrike.js` cuts a building — and PARENTED TO THE HULL, so the fracture
   * lives in the tank's own frame and stays correct wherever on the route it
   * dies. The death frame writes one uniform.
   */
  _buildWreck(tank) {
    const rng = tank.rng.fork();
    const parts = [
      // the turret, which is the thing that comes off a tank
      { id: 'turret', size: [2.3, 0.85, 2.7], at: [0, 1.95, -0.25], cut: [5, 3, 6] },
      { id: 'bustle', size: [2.1, 0.55, 1.1], at: [0, 2.0, -1.6], cut: [4, 2, 3] },
      // engine deck and the plates over it
      { id: 'deck', size: [2.9, 0.3, 2.4], at: [0, 1.78, -1.95], cut: [5, 1, 5] },
      // the sponson tops and the skirts
      { id: 'sponsonL', size: [0.55, 0.4, 5.2], at: [-1.3, 1.55, -0.2], cut: [1, 1, 8] },
      { id: 'sponsonR', size: [0.55, 0.4, 5.2], at: [1.3, 1.55, -0.2], cut: [1, 1, 8] },
      // a run of track off each side
      { id: 'trackL', size: [0.5, 0.2, 5.0], at: [-1.4, 0.25, 0], cut: [1, 1, 10] },
      { id: 'trackR', size: [0.5, 0.2, 5.0], at: [1.4, 0.25, 0], cut: [1, 1, 10] },
      // stowage and the drums
      { id: 'stow', size: [1.9, 0.5, 0.6], at: [0, 2.05, -3.3], cut: [4, 1, 1] },
    ];
    const chunks = [];
    for (const p of parts) fracture(p, 0, rng, (c) => chunks.push(c));
    const n = chunks.length;
    tank.chunkCount = n;

    const geo = chunkGeometry();
    const mat = makeChunkMaterial(this.ctx, this._lib, 'metal_rust', tank.uniforms);
    mat.color.setHex(0x4a453e);
    tank.materials.push(mat);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.name = `match_tank_${tank.id}_wreck`;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.updateMatrix();
    tank.root.add(mesh);

    const mot = new Float32Array(n * 4);
    const off = new Float32Array(n * 3);
    const axis = new Float32Array(n * 3);
    const uv = new Float32Array(n * 3);
    const colour = new Float32Array(n * 3);
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const m4 = new THREE.Matrix4();
    const ax = new THREE.Vector3();
    const settle = new THREE.Vector3();
    const dir = new THREE.Vector3();
    // The blast is in the fighting compartment, under the turret ring.
    const blast = new THREE.Vector3(0, 1.6, -0.2);

    for (let i = 0; i < n; i++) {
      const c = chunks[i];
      pos.set(c.cx, c.cy, c.cz);
      q.setFromAxisAngle(ax.set(rng.signed(), rng.signed(), rng.signed()).normalize(), rng.range(-0.03, 0.03));
      scale.set(c.hx * 2, c.hy * 2, c.hz * 2);
      m4.compose(pos, q, scale);
      m4.toArray(mesh.instanceMatrix.array, i * 16);

      dir.copy(pos).sub(blast);
      const d = Math.max(0.5, dir.length());
      dir.y = 0;
      if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
      dir.normalize();
      const r = WRECK_R * Math.sqrt(rng.float()) * (pos.y > 1.7 ? 1.0 : 0.45);
      settle.copy(dir).multiplyScalar(r);
      settle.y = Math.max(c.hy, 0.12) + rng.range(0, 0.25);

      const delay = Math.min(0.3, (d - 0.5) * 0.05) + rng.range(0, 0.06);
      const drop = Math.max(0.4, pos.y - settle.y);
      const flight = clamp(Math.sqrt((2 * drop) / 9.81) * rng.range(1.1, 1.7), 0.5, 2.4);
      // The turret goes UP. That is the shot everybody knows.
      const arc = (pos.y > 1.7 ? rng.range(1.6, 3.4) : rng.range(0.2, 1.0)) * clamp(3.0 / d, 0.4, 2.2);
      const spin = rng.range(2.0, 9.0) * (rng.float() < 0.5 ? -1 : 1);
      mot[i * 4] = delay;
      mot[i * 4 + 1] = flight;
      mot[i * 4 + 2] = arc;
      mot[i * 4 + 3] = spin;
      off[i * 3] = settle.x - pos.x;
      off[i * 3 + 1] = settle.y - pos.y;
      off[i * 3 + 2] = settle.z - pos.z;
      ax.set(rng.signed(), rng.signed() * 0.5, rng.signed()).normalize();
      axis[i * 3] = ax.x;
      axis[i * 3 + 1] = ax.y;
      axis[i * 3 + 2] = ax.z;
      uv[i * 3] = rng.float();
      uv[i * 3 + 1] = rng.float();
      uv[i * 3 + 2] = rng.range(0.6, 1.4);
      const k = rng.range(0.55, 1.0);
      colour[i * 3] = 0.34 * k;
      colour[i * 3 + 1] = 0.32 * k;
      colour[i * 3 + 2] = 0.3 * k;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colour, 3);
    mesh.instanceColor.needsUpdate = true;
    geo.setAttribute('aMot', new THREE.InstancedBufferAttribute(mot, 4));
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
    geo.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 3));
    geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 3));
    tank.wreck = mesh;
    tank.meshes.push(mesh);
  }

  /**
   * Three moving boxes on `LAYER.SHOOT_ONLY`. See the header: that layer is in
   * `MASK.BULLET` and in neither `MASK.CHARACTER` nor `MASK.SIGHT`, which is
   * what makes a moving 3.3 m obstacle safe on a nav grid baked at boot.
   *
   * `owner` is the tank, so a round that lands on it comes back through the
   * canonical `damage:dealt` path with the shooter attached — which is where
   * kill credit, the friend/foe hitmarker filter and the score come from.
   */
  _buildColliders(tank, physics) {
    const mk = (part, hx, hy, hz, scale) =>
      physics.addCollider({
        shape: 'box',
        layer: physics.LAYER.SHOOT_ONLY,
        surface: 'metal',
        owner: tank,
        part,
        damageScale: scale,
        enabled: false,
        hx,
        hy,
        hz,
      });
    tank.colliders.push(
      { c: mk('hull', HULL_W * 0.5, 0.9, 3.3, PART_MUL.hull), at: [0, 1.25, 0.1], turret: false },
      { c: mk('deck', 1.45, 0.4, 1.3, PART_MUL.deck), at: [0, 1.85, -2.0], turret: false },
      { c: mk('turret', 1.2, 0.55, 1.7, PART_MUL.turret), at: [0, 2.0, -0.3], turret: true }
    );
  }

  /* ====================================================================== */
  /* THE SORTIE                                                             */
  /* ====================================================================== */

  /** The telegraphed launch. */
  call() {
    if (!this.ready || this.busy) return false;
    this._pending = TANK_LEAD;
    const first = this.tanks[0];
    this._announce(this.onAnnounce, first);
    if (this._audio ?? (this._audio = this.ctx.peek('audio'))) {
      for (const t of this.tanks) {
        this._v.copy(t.position.set(t.path.X[0], t.path.Y[0] + 1.2, t.path.Z[0]));
        this._audio.play?.('strike_jet', this._v, {
          level: 0.5, dur: TANK_LEAD, maxDist: 200, gain: 1.5, occlusion: 0.4,
        });
      }
    }
    this._emit('inbound', this.tanks[0]);
    return true;
  }

  /** Roll now, no telegraph. Every tank that is not already out. */
  fire() {
    if (!this.ready) return false;
    let any = false;
    for (const t of this.tanks) any = this._roll(t) || any;
    if (any) console.info(`[tank] SORTIE at t=${this.ctx.time.elapsed.toFixed(1)}s — ${this.tanks.map((t) => t.id).join(' + ')}`);
    return any;
  }

  _roll(tank) {
    if (tank.state !== 'parked') return false;
    tank.state = 'advance';
    tank.s = 0;
    tank.health = RULES.tankHealth;
    tank.alive = true;
    tank.hold = HOLD_TIME;
    tank.target = null;
    tank.acquireIn = 0;
    tank.reload = 2.5;
    tank.coax = 0;
    tank.coaxLeft = 0;
    tank.turretYaw = 0;
    tank.gunPitch = 0;
    tank.lastHitBy = null;
    tank.root.visible = true;
    tank.wreck.visible = false;
    tank.uniforms.uT.value = -1;
    tank.uniforms.uAnim.value = 1;
    for (const c of tank.colliders) c.c.enabled = true;
    this._pose(tank);
    this._emit('rolling', tank);
    return true;
  }

  /* ====================================================================== */
  /* frame                                                                  */
  /* ====================================================================== */

  update(dt, live) {
    if (!this.ready) return;

    if (this._pending >= 0) {
      this._pending -= dt;
      if (this._pending < 0) this.fire();
    }

    for (const tank of this.tanks) {
      if (tank.state === 'parked') continue;
      if (tank.state === 'dead') {
        tank.uniforms.uT.value += dt;
        if (tank.uniforms.uT.value > 30) {
          // The wreck stays; the clock stops so the shader's clamp is settled.
          tank.uniforms.uT.value = 30;
        }
        continue;
      }
      this._drive(tank, dt);
      this._fight(tank, dt);
      this._pose(tank);
    }

    if (!live || !this.enabled) return;
    this._liveT += dt;
    this._next -= dt;
    if (this._next > 0) return;
    this._scheduleNext();
  }

  _scheduleNext() {
    // `_ignoreCoBusy` is the cathedral's own sortie coming in through the dust.
    // @see `armAfter`.
    if (this.busy || (this._coBusy && !this._ignoreCoBusy)) {
      this._next = 6;
      return;
    }
    if (this._sorties >= RULES.tankMaxPerMatch) {
      this._next = Infinity;
      return;
    }
    // A tank that is still a wreck in the street does not get a twin; the
    // sortie is only re-run once both hulls are back in their pockets.
    for (const t of this.tanks) if (t.state !== 'parked') return;
    this.call();
    this._sorties++;
    // Spent: every sortie after the first is the ordinary interval draw and
    // stands down for the sky like the other three air weapons.
    this._ignoreCoBusy = false;
    const [lo, hi] = RULES.tankInterval;
    this._next = this.rng.range(lo, hi);
  }

  /** Advance / hold / reverse along the baked path. No raycast, no allocation. */
  _drive(tank, dt) {
    const p = tank.path;
    if (tank.state === 'advance') {
      const speed = tank.target ? SPEED_FIGHT : SPEED_ADVANCE;
      tank.s += speed * dt;
      tank.wheelSpin -= (speed * dt) / 0.44;
      if (tank.s >= p.length) {
        tank.s = p.length;
        tank.state = 'hold';
      }
    } else if (tank.state === 'hold') {
      tank.hold -= dt;
      if (tank.hold <= 0) tank.state = 'withdraw';
    } else if (tank.state === 'withdraw') {
      tank.s -= SPEED_REVERSE * dt;
      tank.wheelSpin += (SPEED_REVERSE * dt) / 0.44;
      if (tank.s <= 0) {
        tank.s = 0;
        this._park(tank);
      }
    }
  }

  _park(tank) {
    tank.state = 'parked';
    tank.alive = false;
    tank.root.visible = false;
    for (const c of tank.colliders) c.c.enabled = false;
    this._emit('clear', tank);
  }

  /** Where on the path are we? Lerped from the baked samples. */
  _sample(tank) {
    const p = tank.path;
    const s = clamp(tank.s, 0, p.length);
    // The samples are evenly spaced by construction, so the index is arithmetic.
    let i = Math.min(p.n - 2, Math.max(0, Math.floor((s / p.length) * (p.n - 1))));
    while (i > 0 && p.S[i] > s) i--;
    while (i < p.n - 2 && p.S[i + 1] < s) i++;
    const span = Math.max(1e-4, p.S[i + 1] - p.S[i]);
    const t = clamp((s - p.S[i]) / span, 0, 1);
    const out = this._v3;
    out.set(
      p.X[i] + (p.X[i + 1] - p.X[i]) * t,
      p.Y[i] + (p.Y[i + 1] - p.Y[i]) * t,
      p.Z[i] + (p.Z[i + 1] - p.Z[i]) * t
    );
    // yaw is not lerped through the wrap; the samples are 1.25 m apart and the
    // route is nearly straight, so the nearest one is the right answer.
    tank._yaw = p.YAW[t < 0.5 ? i : i + 1];
    tank._pitch = p.PITCH[t < 0.5 ? i : i + 1];
    return out;
  }

  /** Write the hull, turret, gun, wheels and colliders for this frame. */
  _pose(tank) {
    const at = this._sample(tank);
    tank.position.copy(at);
    // A tank reversing still faces the way it drove in; that is the whole point
    // of reversing out of a street.
    const q = this._q;
    q.setFromAxisAngle(UP, tank._yaw);
    this._qp.setFromAxisAngle(RIGHT, -tank._pitch);
    q.multiply(this._qp);
    tank.root.position.copy(at);
    tank.root.quaternion.copy(q);
    tank.root.updateMatrix();
    tank.root.updateMatrixWorld(true);

    tank.turret.quaternion.setFromAxisAngle(UP, tank.turretYaw);
    tank.turret.updateMatrix();
    tank.gun.quaternion.setFromAxisAngle(RIGHT, -tank.gunPitch);
    tank.gun.updateMatrix();
    tank.turret.updateMatrixWorld(true);

    if (tank.state !== 'dead') this._poseWheels(tank);

    // Colliders follow. Three `Matrix4.copy` + an invert each, once a frame.
    for (const c of tank.colliders) {
      const parent = c.turret ? tank.turret : tank.root;
      this._v.set(c.at[0], c.at[1] - (c.turret ? 1.52 : 0), c.at[2] + (c.turret ? 0.15 : 0));
      this._m.compose(this._v, ZERO_Q, this._sc);
      this._m.premultiply(parent.matrixWorld);
      c.c.setMatrix(this._m);
    }
  }

  /* -------------------------------------------------------------- combat -- */

  _fight(tank, dt) {
    tank.acquireIn -= dt;
    if (tank.acquireIn <= 0) {
      tank.acquireIn = ACQUIRE_EVERY;
      this._acquire(tank);
    }
    const target = tank.target;

    /* ---- lay the gun ------------------------------------------------- */
    let wantYaw = 0;
    let wantPitch = 0;
    let onTarget = false;
    if (target) {
      const p = this._v;
      p.copy(target.position);
      p.y += 1.0;
      const dx = p.x - tank.position.x;
      const dz = p.z - tank.position.z;
      const dy = p.y - (tank.position.y + 2.0);
      const world = Math.atan2(dx, dz);
      wantYaw = wrapPi(world - tank._yaw);
      wantPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), GUN_DOWN, GUN_UP);
      const dyaw = wrapPi(wantYaw - tank.turretYaw);
      const dpitch = wantPitch - tank.gunPitch;
      tank.turretYaw += clamp(dyaw, -TRAVERSE * dt, TRAVERSE * dt);
      tank.gunPitch += clamp(dpitch, -ELEVATE * dt, ELEVATE * dt);
      onTarget = Math.abs(dyaw) < AIM_TOL && Math.abs(dpitch) < AIM_TOL;
    } else {
      // Nothing to shoot: the turret returns to the way it is driving.
      const dyaw = wrapPi(-tank.turretYaw);
      tank.turretYaw += clamp(dyaw, -TRAVERSE * 0.5 * dt, TRAVERSE * 0.5 * dt);
      tank.gunPitch += clamp(-tank.gunPitch, -ELEVATE * dt, ELEVATE * dt);
    }

    /* ---- the main gun -------------------------------------------------- */
    tank.reload -= dt;
    if (target && onTarget && tank.reload <= 0) {
      this._mainGun(tank, target);
      tank.reload = RULES.tankMainReload;
      // and the coax opens up behind it
      tank.coaxLeft = COAX_ROUNDS;
      tank.coax = 0.35;
    }

    /* ---- the coax ------------------------------------------------------ */
    if (target) {
      tank.coax -= dt;
      if (tank.coax <= 0) {
        if (tank.coaxLeft > 0) {
          this._coax(tank, target);
          tank.coaxLeft--;
          tank.coax = COAX_GAP;
        } else if (onTarget || Math.abs(wrapPi(wantYaw - tank.turretYaw)) < 0.2) {
          tank.coaxLeft = COAX_ROUNDS;
          tank.coax = COAX_REST;
        }
      }
    }
  }

  /**
   * Pick a man to shoot at: the nearest live hostile inside `RULES.tankRange`
   * with a clear line from the muzzle. `match` fills the list — `match` owns the
   * roster, and this file never reads `ai`.
   */
  _acquire(tank) {
    const out = this._targets;
    out.length = 0;
    this.enemies?.(tank.team, out);
    if (!out.length) {
      tank.target = null;
      return;
    }
    const phys = this.physics;
    const muzzle = this._muzzle(tank, this._v2);
    let best = null;
    let bestD = RULES.tankRange;
    for (let i = 0; i < out.length; i++) {
      const e = out[i];
      const p = e.position;
      if (!p) continue;
      const d = Math.hypot(p.x - tank.position.x, p.z - tank.position.z);
      if (d >= bestD) continue;
      // one ray, and only for a candidate that is already the closest so far
      this._v.set(p.x - muzzle.x, p.y + 1.0 - muzzle.y, p.z - muzzle.z);
      const len = this._v.length();
      if (len < 0.5) continue;
      this._v.multiplyScalar(1 / len);
      if (phys.raycastAny(muzzle.x, muzzle.y, muzzle.z, this._v.x, this._v.y, this._v.z, len - 0.6, phys.MASK.SIGHT)) {
        continue;
      }
      best = e;
      bestD = d;
    }
    tank.target = best;
  }

  /** World position of the muzzle. Written into `out`; allocates nothing. */
  _muzzle(tank, out) {
    out.set(0, 0, 4.9);
    out.applyMatrix4(tank.gun.matrixWorld);
    return out;
  }

  /**
   * THE MAIN GUN. A traced shell with a real fall of shot: the round goes where
   * the barrel is pointing plus a dispersion draw, so a tank misses a moving man
   * and does not miss a wall.
   */
  _mainGun(tank, target) {
    const phys = this.physics;
    const from = this._muzzle(tank, this._v2);
    const dir = this._v;
    dir.set(0, 0, 1).transformDirection(tank.gun.matrixWorld);
    // dispersion, in radians, drawn per shot
    dir.x += tank.rng.range(-0.012, 0.012);
    dir.y += tank.rng.range(-0.009, 0.009);
    dir.z += tank.rng.range(-0.012, 0.012);
    dir.normalize();
    const hit = phys.raycast(from, dir, 220, phys.MASK.WORLD);
    const dist = hit?.hit ? hit.distance : 220;
    const at = this._v3;
    at.copy(from).addScaledVector(dir, dist);

    // The blast. The canonical event, so `player`, `ai`, `fx` and `audio` all do
    // what they already do for a grenade or an airstrike.
    const b = this._blast;
    b.position = at;
    b.radius = RULES.tankMainRadius;
    b.damage = RULES.tankMainDamage;
    b.source = tank;
    this.ctx.events.emit('explosion', b);

    // Muzzle blast, the tracer down range and the dust it kicks off the street.
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (fx) {
      fx.explosion?.({ position: from, radius: 1.5 });
      fx.tracer?.(from, at, 900);
      fx.hazeRing?.(from.x, from.y, from.z, 1.6, 12, 0.4, 1.6);
      if (fx.lights) fx.lights.flash(from.x, from.y, from.z, 1, 0.76, 0.42, 900, 0.5, 6, 40, 4);
    }
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    audio?.play?.('strike_tail', from, { level: 1.0, dur: 2.2, maxDist: 320, gain: 2.0, occlusion: 0.2 });
    this._emit('fire', tank);
  }

  /** The coaxial machine gun: one real round through `physics`, per shot. */
  _coax(tank, target) {
    const phys = this.physics;
    const from = this._muzzle(tank, this._v2);
    from.y -= 0.12;
    const p = target.position;
    const dir = this._v;
    dir.set(p.x - from.x, p.y + 1.0 - from.y, p.z - from.z).normalize();
    dir.x += tank.rng.range(-0.018, 0.018);
    dir.y += tank.rng.range(-0.014, 0.014);
    dir.z += tank.rng.range(-0.018, 0.018);
    dir.normalize();
    // Bots and every solid surface are handled by the canonical trace; the
    // player capsule is not in the ray world (see `AiSystem._testPlayerHit`), so
    // it is tested separately below.
    const impacts = phys.fireBullet({
      origin: from,
      dir,
      damage: RULES.tankCoaxDamage,
      penetration: 1.4,
      maxDist: RULES.tankRange + 30,
      mask: phys.MASK.BULLET,
      shooter: tank,
    });
    const end = impacts.length ? impacts[0].point : null;
    this._testPlayerHit(tank, from, dir, end);
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (fx && (tank.coaxLeft & 1) === 0) fx.tracer?.(from, end ?? this._v3.copy(from).addScaledVector(dir, 90), 780);
    if (tank.coaxLeft === COAX_ROUNDS - 1) {
      const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
      audio?.play?.('strafe_cannon', from, {
        level: 0.7, dur: COAX_ROUNDS * COAX_GAP, rate: 1 / COAX_GAP, maxDist: 220, gain: 1.3,
      });
    }
  }

  /**
   * The player capsule is not a physics collider, so a round aimed at them is
   * tested here — the same solve `src/ai/index.js` does for every bot round, for
   * the same reason. Damage is applied ONLY through the event.
   */
  _testPlayerHit(tank, origin, dir, end) {
    const player = this._player ?? (this._player = this.ctx.peek('player'));
    if (!player || player.dead) return;
    const m = this.ctx.peek('match');
    if ((m?.playerTeam ?? -1) === tank.team) return;
    const p = player.position;
    if (!p) return;
    const maxT = end ? origin.distanceTo(end) : 200;
    const px = p.x - origin.x;
    const py = p.y + 1.0 - origin.y;
    const pz = p.z - origin.z;
    const t = px * dir.x + py * dir.y + pz * dir.z;
    if (t < 0.5 || t > maxT) return;
    const miss = Math.hypot(px - dir.x * t, py - dir.y * t, pz - dir.z * t);
    if (miss > 0.42) {
      if (miss < 1.6) player.onNearMiss?.(miss);
      return;
    }
    this.ctx.events.emit('damage:dealt', {
      target: player,
      amount: RULES.tankCoaxDamage,
      headshot: false,
      killed: false,
      point: p,
      from: tank.position,
      source: tank,
    });
  }

  /* --------------------------------------------------------- taking it --- */

  /**
   * A round landed on one of our boxes. It arrives as `damage:dealt` because
   * the colliders carry `owner: tank` — which is the canonical path and is also
   * what gives the player a hitmarker and `e.source` the kill credit.
   */
  _takeRound(e) {
    const tank = e?.target;
    if (!tank?.isTank || !tank.alive) return;
    if (e.source && e.source.team === tank.team && !RULES.friendlyFire) return;
    tank.lastHitBy = e.source ?? tank.lastHitBy;
    this._wound(tank, e.amount ?? 0, e.source ?? null);
  }

  /** Blast damage: a grenade, an airstrike, or the other tank's shell. */
  _takeBlast(e) {
    if (!e?.position) return;
    for (const tank of this.tanks) {
      if (!tank.alive) continue;
      if (e.source === tank) continue; // our own shell going off down the street
      const d = Math.hypot(
        e.position.x - tank.position.x,
        e.position.y - (tank.position.y + 1.4),
        e.position.z - tank.position.z
      );
      const r = e.radius ?? 5;
      if (d > r) continue;
      const amount = (e.damage ?? 90) * (1 - d / r) * EXPLOSION_MUL;
      this._wound(tank, amount, e.source ?? null);
    }
  }

  _wound(tank, amount, by) {
    if (!(amount > 0)) return;
    tank.health -= amount;
    if (by) tank.lastHitBy = by;
    if (tank.health > 0) return;
    this._destroy(tank, tank.lastHitBy);
  }

  /**
   * IT BREWS UP. Two booleans per mesh, one uniform write, one `explosion`, and
   * the `fx` calls that all write into preallocated rings — the fracture, its
   * trajectories and its settled pose were solved at boot.
   */
  _destroy(tank, by) {
    if (!tank.alive) return;
    tank.alive = false;
    tank.state = 'dead';
    tank.health = 0;
    tank.target = null;
    for (const c of tank.colliders) c.c.enabled = false;
    // The hull's own meshes go; the baked wreck takes over in the same frame.
    for (const mesh of tank.meshes) mesh.visible = mesh === tank.wreck;
    tank.wreck.visible = true;
    tank.wreck.userData.owNoShadow = true;
    tank.wreck.userData.owNoPrepass = true;
    tank.uniforms.uT.value = 0;
    tank.uniforms.uAnim.value = 1;

    const b = this._deathBlast;
    this._v4.copy(tank.position);
    this._v4.y += 1.5;
    b.position = this._v4;
    b.radius = RULES.tankDeathRadius;
    b.damage = RULES.tankDeathDamage;
    b.source = tank;
    this.ctx.events.emit('explosion', b);

    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (fx) {
      fx.explosion?.({ position: this._v4, radius: 5.5 });
      fx.hazeRing?.(this._v4.x, this._v4.y, this._v4.z, 3.0, 20, 0.5, 2.4);
      fx.scorch?.(tank.position.x, tank.position.y + 0.15, tank.position.z, 6.0);
      // A knocked-out tank burns for the rest of the round. One emitter.
      fx.addSmokeColumn?.(tank.position.x, tank.position.y + 1.2, tank.position.z, {
        radius: 2.4, duration: 26, rate: 9, rise: 2.6, dark: 0.5, life: 8, growth: 4.2,
      });
      if (fx.lights) fx.lights.flash(this._v4.x, this._v4.y, this._v4.z, 1, 0.6, 0.3, 1400, 0.7, 8, 60, 5);
    }
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    if (audio?.play) {
      audio.play('strike_tail', tank.position, { level: 1.3, dur: 3.4, maxDist: 380, gain: 2.4, occlusion: 0.1 });
      audio.play('strike_rubble', tank.position, { level: 0.9, dur: 2.6, extraDelay: 0.3, maxDist: 200 });
    }
    console.info(
      `[tank] DESTROYED ${tank.id} at t=${this.ctx.time.elapsed.toFixed(1)}s — ` +
        `${tank.chunkCount} chunks, killed by ${by?.name ?? (by === undefined ? 'unknown' : 'the environment')}`
    );
    this._announce(this.onImpact, tank);
    this.onKill?.(tank, by ?? null);
    this._emit('dead', tank);
  }

  /* ------------------------------------------------------------- plumbing -- */

  _announce(hook, tank) {
    if (!hook) return;
    const a = this._ann;
    a.kind = 'TANK';
    a.id = tank.id;
    a.name = tank.name;
    a.lead = TANK_LEAD;
    a.count = 0;
    // Where it is going, so the HUD arrow points at the street it will be in.
    this._end.set(tank.path.X[tank.path.n - 1], tank.path.Y[tank.path.n - 1] + 1, tank.path.Z[tank.path.n - 1]);
    a.position = tank.state === 'dead' ? tank.position : this._end;
    a.points[a.count++] = a.position;
    hook(a);
  }

  _emit(phase, tank) {
    const e = this._ev;
    e.phase = phase;
    e.id = tank.id;
    e.team = tank.team;
    e.position = tank.position;
    this.ctx.events.emit('match:tank', e);
  }

  setFocus() {
    /* The routes are fixed and both fire, so there is nothing to bias. */
  }

  /**
   * A round has gone live. NOTHING IS SCHEDULED YET, and that is the change.
   *
   * There is no first-sortie timer any more: armour is the cathedral's
   * consequence, so `match` calls `armAfter` when the bombardment stops.
   * @see `RULES.tankAfterCathedral` and `MatchSystem._updateCathedralEvent`.
   */
  armRound() {
    this._next = Infinity;
    this._sorties = 0;
    this._liveT = 0;
    this._ignoreCoBusy = false;
  }

  /**
   * ARM THE FIRST SORTIE, `seconds` from now. One line, called by `match` from
   * the cathedral event's beat sheet; everything after it is the interval
   * scheduler this class already had (`RULES.tankInterval`, both hulls parked
   * first, never under an inbound salvo). Idempotent — a second call while the
   * armour is already armed or out does nothing.
   */
  armAfter(seconds) {
    if (!this.ready || this.busy) return false;
    if (this._next !== Infinity) return false;
    if (this._sorties >= RULES.tankMaxPerMatch) return false;
    this._next = Math.max(0, seconds);
    /**
     * AND THIS ONE SORTIE DOES NOT STAND DOWN FOR THE SKY.
     *
     * `_scheduleNext` waits out `_coBusy` because rolling a tank out under an
     * INBOUND salvo is two telegraphs at once — which is right for the ordinary
     * interval draw and exactly wrong here. `busy` on `Airstrike` is also true
     * while a mass is still FALLING and settling (`SETTLE_AT` = 6.5 s after the
     * last of a staggered group), so a sortie armed on the aftermath of the
     * cathedral spent its first three retries watching the church's own debris
     * come to rest: measured, the hull rolled 27 s after D opened rather than
     * with it, at 77-85 % of the match instead of 66-73 %, and the sortie was
     * still out when the clock ran down. Its own `busy` is still respected, so a
     * hull already in the street never gets a twin.
     */
    this._ignoreCoBusy = true;
    console.info(`[tank] armed — first sortie in ${this._next.toFixed(1)}s`);
    return true;
  }

  disarm() {
    this._next = Infinity;
    this._pending = -1;
    this._ignoreCoBusy = false;
  }

  reset() {
    this.disarm();
    for (const tank of this.tanks) {
      tank.state = 'parked';
      tank.alive = false;
      tank.s = 0;
      tank.health = RULES.tankHealth;
      tank.root.visible = false;
      tank.uniforms.uT.value = -1;
      tank.uniforms.uAnim.value = 1;
      tank.wreck.visible = false;
      tank.wreck.userData.owNoShadow = false;
      tank.wreck.userData.owNoPrepass = false;
      for (const mesh of tank.meshes) mesh.visible = mesh !== tank.wreck;
      for (const c of tank.colliders) c.c.enabled = false;
    }
  }

  dispose() {
    this.ctx.events.off?.('explosion', this._onExplosion);
    this.ctx.events.off?.('damage:dealt', this._onDamage);
    for (const tank of this.tanks) {
      for (const c of tank.colliders) this.physics?.removeCollider(c.c);
      for (const mesh of tank.meshes) mesh.geometry?.dispose();
      for (const m of tank.materials) m.dispose();
    }
    this.group.parent?.remove(this.group);
    this.tanks.length = 0;
  }
}

/* -------------------------------------------------------------------------- */

const RIGHT = new THREE.Vector3(1, 0, 0);
const ZERO_Q = new THREE.Quaternion();

function wrapPi(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
