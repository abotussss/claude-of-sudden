import * as THREE from 'three';
import { RULES } from './rules.js';
// From `caches.js` rather than `airstrike.js`: same subsystem, same pass, and
// @see the note over the function for why it is not shared with that file.
import { mergeGeometries } from './caches.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * MATCH — THE REINFORCEMENT DROP. The helicopter, the canopies, and nothing else.
 * ════════════════════════════════════════════════════════════════════════════
 * "ゲリライベントとして増援イベントで 大幅に負けている（１００ポイント差とか、残り
 *  １００ポイントに相手チームがなったら）チームはたまに増援として１０人追加されるように
 *  してAI その場合、その１０人はリスポーンしない 形勢逆転要素なだけで、リスポーンなし
 *  増援は占領されているサイト付近からヘリでパラシュート降下して登場するようにして"
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS, AND WHAT IT DELIBERATELY IS NOT
 * ────────────────────────────────────────────────────────────────────────────
 * It is the AIRCRAFT AND THE FALL. It flies a straight run over a point, puts
 * `RULES.reinforceCount` canopies out of the door `RULES.reinforceDropGap`
 * apart, steers each one to a landing point it was handed, and calls
 * `onLand(index, position, yaw)` on the frame a man's feet touch.
 *
 * It creates no soldier, knows no team's score, and decides nothing about when
 * a drop happens. `MatchSystem` owns all three, because `match` is "the ONLY
 * subsystem allowed to decide who is on which side … and where a man respawns"
 * — @see `MatchSystem._updateReinforcements` for the trigger and
 * `_landReinforcement` for the man.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY A MAN DOES NOT EXIST UNTIL HE LANDS
 * ────────────────────────────────────────────────────────────────────────────
 * The obvious build spawns ten Agents at 46 m and lets them fall. That is wrong
 * in this engine and it would have been expensive to find out: `Agent` drives a
 * `CharacterController`, takes its height off the nav grid every step and picks
 * cover from a `CoverMap` baked at ground level, so a man at 46 m is a man
 * whose every per-frame query is meaningless — and for seven seconds, ten at a
 * time, on top of a roster of forty. He would also be a TARGET while he fell,
 * which is a firing squad rather than an insertion.
 *
 * So the descent is PURE VISUAL — two InstancedMeshes and a float per man —
 * and the Agent is created by `match` at touchdown, on the same
 * `ai.spawn` + `ai.protect` path every other arrival in the game uses. What
 * falls out of the sky is a picture; what lands is a soldier.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TEN MEN ON ONE SQUARE IS THE FAILURE THIS FILE HAS TO NOT CAUSE
 * ────────────────────────────────────────────────────────────────────────────
 * `tools/stuckcheck.mjs` reports 0 stuck of 39 at 20 v 20 and it is a blocking
 * gate; the epidemic it gates once wedged 22 of 29 men on nav islands, and
 * every one of those was a crowding event at a doorway. Ten men arriving
 * together is that, by construction. Three things are done about it and all
 * three are here or in the caller:
 *
 *   1. THEY LEAVE THE DOOR IN SEQUENCE. `RULES.reinforceDropGap` at
 *      `RULES.reinforceSpeed` is ~20 m of separation along the run before the
 *      first canopy is even open.
 *   2. THEY LAND ON DIFFERENT PROVED CELLS. The caller hands over one landing
 *      point per man, cut from the zone's own `stand` ring — points `standRing`
 *      has already snapped to a nav cell and A*-proved from a spawn of BOTH
 *      sides. This file never invents a position.
 *   3. THEY LAND SEQUENTIALLY IN TIME. A canopy's descent is a constant rate
 *      from a staggered release, so touchdowns inherit the 0.62 s gap: the
 *      first man is walking before the last man's feet are down.
 *
 * NOTHING HERE ALLOCATES PER FRAME. The airframe and the canopies are built
 * once, the ten troop records are preallocated whole, and `update` writes into
 * reused matrices.
 */

/** Parked below the map, like `Bomber.PARKED_Y`: built at boot, never in shot. */
const PARKED_Y = -400;

/**
 * WHERE THE RUN STARTS AND ENDS, in metres along the approach bearing, measured
 * from the drop zone. The aircraft is on screen for the whole of the second
 * half of the inbound and keeps flying after the last man is out, because an
 * aeroplane that stops existing over the target is the thing that makes an air
 * event read as a spawn effect.
 */
const RUN_IN = 150;
/**
 * 130 -> 170, AND IT IS AN ANTI-CROWDING NUMBER RATHER THAN A CINEMATIC ONE.
 *
 * `_runPoint` CLAMPS at the end of the run, so a man released after the
 * aircraft has finished crossing steps out of a helicopter parked at `run.end`
 * — and the men after him step out of the same square, which is exactly the
 * "ten men landing in one place" this file exists to avoid, reintroduced at the
 * tail of the stick. The arithmetic, worked rather than eyeballed:
 *
 *   start behind the zone  = max(RUN_IN, speed*lead + DROP_LEAD) = 182.5 m
 *   first man out          = (182.5 - 34) / 33            =  4.50 s
 *   last man out           = 4.50 + 9 * 0.62              = 10.08 s
 *   run duration at 130    = (182.5 + 130) / 33           =  9.47 s   <- SHORT
 *   run duration at 170    = (182.5 + 170) / 33           = 10.68 s
 *
 * At 130 the last man overshot by 0.61 s, i.e. 20 m of run that never happened,
 * and he and the man before him shared a release point. 170 leaves 0.6 s of
 * margin, so every one of the ten leaves the door somewhere different.
 *
 * IT IS DERIVED, SO IT MUST BE RE-DERIVED. Anything that changes
 * `reinforceSpeed`, `reinforceLead`, `reinforceDropGap` or `reinforceCount`
 * changes `last man out`; this has to stay above it.
 */
const RUN_OUT = 170;
/** Metres before the zone the first man steps out. @see `_release`. */
const DROP_LEAD = 34;

export class Reinforcements {
  /**
   * @param {object} ctx  engine context
   * @param {object} opts { rng }
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.rng = opts.rng ?? ctx.rng.fork();
    this.ready = false;
    this.buildMs = 0;

    /** The sortie in the air, or null. At most one — @see `busy`. */
    this.run = null;
    /** Installed by `match`. `(index, position, yaw) => void` at touchdown. */
    this.onLand = null;
    /** Installed by `match`. `(info) => void` when a drop is called. */
    this.onAnnounce = null;

    this.group = new THREE.Group();
    this.group.name = 'match-reinforce';
    this.group.matrixAutoUpdate = false;

    /**
     * ONE RECORD PER MAN, PREALLOCATED WHOLE. `RULES.reinforceCount` of them,
     * and they are reused sortie to sortie — a drop must not allocate ten
     * objects on the frame it is called any more than a strike may fracture a
     * building on the frame it lands.
     */
    this.troops = [];
    for (let i = 0; i < RULES.reinforceCount; i++) {
      this.troops.push({
        state: 'idle', // 'idle' | 'fall' | 'canopy' | 'down'
        t: 0,
        /** Where he left the door, and where he is steered to. */
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        at: new THREE.Vector3(),
        yaw: 0,
        /** Seconds the canopy phase takes, from the release height. */
        fallTime: 0,
        /** His own sway phase, so ten canopies do not swing in lockstep. */
        phase: 0,
      });
    }

    /* scratch — nothing in update() allocates */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._sc = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
    /** The announce record. REUSED; `points` holds references, never copies. */
    this._ann = {
      kind: 'REINFORCE',
      id: '',
      name: '',
      lead: RULES.reinforceLead,
      position: null,
      points: [null],
      count: 1,
    };
  }

  /** True while a sortie is in the air or still putting men on the ground. */
  get busy() {
    return !!this.run;
  }

  /* ====================================================================== */
  /* BOOT                                                                   */
  /* ====================================================================== */

  build() {
    const t0 = performance.now();
    this._lib = this.ctx.peek('materials');
    this._buildHelicopter();
    this._buildCanopies();
    this._park();
    this.ctx.scene.add(this.group);
    this.ready = true;
    this.buildMs = performance.now() - t0;
    console.info(
      `[reinforce] baked in ${this.buildMs.toFixed(0)}ms — ${RULES.reinforceCount} canopies, ` +
        `drop at ${RULES.reinforceDeficit} behind or enemy within ${RULES.reinforceEndgame}, ` +
        `${(RULES.reinforceChance * 100).toFixed(0)}% per ${RULES.reinforcePoll}s poll, ` +
        `${RULES.reinforceMaxPerTeam} per side, NO RESPAWN`
    );
    return this;
  }

  /**
   * THE AIRCRAFT. One merged mesh, +Z forward, and it has to read as a
   * HELICOPTER at 46 m against the sky in four and a half seconds — which is a
   * different silhouette problem from the bomber's and is solved the same way:
   * by the outline. A deep slab fuselage, a long thin tail boom that is the
   * single most helicopter-shaped thing there is, a tall fin with a tail rotor
   * on it, two skids under it, and a rotor mast standing proud of the roof.
   *
   * The two rotor DISCS are separate meshes because they spin — @see
   * `_poseAircraft`. They are thin cylinders rather than blades on purpose: a
   * four-blade rotor at 6 rad/s strobes horribly against a 60 Hz frame and a
   * disc is what the eye reads anyway.
   */
  _buildHelicopter() {
    const box = (w, h, d, x, y, z) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      return g;
    };
    const hull = mergeGeometries([
      box(2.9, 2.5, 6.6, 0, 0, 0.6), // cabin
      box(2.3, 1.9, 2.2, 0, -0.15, 4.6), // nose
      box(2.5, 1.5, 1.2, 0, 0.55, 3.9), // canopy glass block
      box(1.0, 1.0, 7.4, 0, 0.35, -6.0), // tail boom
      box(0.22, 2.6, 1.5, 0, 1.4, -9.2), // fin
      box(2.0, 0.34, 1.5, 0, -0.1, -9.3), // tailplane
      box(0.9, 0.55, 0.9, 0, 1.45, 0.4), // mast fairing
      box(0.16, 0.9, 0.16, -1.15, -1.65, 1.4), // skid legs
      box(0.16, 0.9, 0.16, 1.15, -1.65, 1.4),
      box(0.16, 0.9, 0.16, -1.15, -1.65, -1.6),
      box(0.16, 0.9, 0.16, 1.15, -1.65, -1.6),
      box(0.22, 0.22, 6.4, -1.15, -2.1, 0.2), // skids
      box(0.22, 0.22, 6.4, 1.15, -2.1, 0.2),
    ]);
    const mat = this._surface('metal_painted', 0x3f4a42);
    const mesh = new THREE.Mesh(hull, mat);
    mesh.name = 'match_reinforce_heli';
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    // A 12 m airframe at 46 m sits outside the near cascades and only ever costs
    // a cascade draw for a shadow nobody sees. Same call `Bomber` makes.
    mesh.userData.owNoShadow = true;
    this.group.add(mesh);
    this.heli = mesh;

    const discMat = this._surface('metal_rust', 0x24282a);
    discMat.transparent = true;
    discMat.opacity = 0.42;
    discMat.depthWrite = false;
    const main = new THREE.CylinderGeometry(6.4, 6.4, 0.06, 24, 1);
    const mainMesh = new THREE.Mesh(main, discMat);
    mainMesh.name = 'match_reinforce_rotor_main';
    mainMesh.matrixAutoUpdate = false;
    mainMesh.frustumCulled = false;
    mainMesh.userData.owNoShadow = true;
    this.group.add(mainMesh);
    this.rotorMain = mainMesh;

    const tail = new THREE.CylinderGeometry(1.25, 1.25, 0.05, 16, 1);
    tail.rotateZ(Math.PI / 2);
    const tailMesh = new THREE.Mesh(tail, discMat);
    tailMesh.name = 'match_reinforce_rotor_tail';
    tailMesh.matrixAutoUpdate = false;
    tailMesh.frustumCulled = false;
    tailMesh.userData.owNoShadow = true;
    this.group.add(tailMesh);
    this.rotorTail = tailMesh;
    this.rotorMat = discMat;
    this.hullMat = mat;
    this._spin = 0;
  }

  /**
   * THE CANOPIES AND THE MEN UNDER THEM — two InstancedMeshes, one slot per
   * `RULES.reinforceCount`, so ten parachutes are two draw calls.
   *
   * The canopy is a hemisphere with its pole at the origin and its skirt at
   * -2.0, so scaling the instance scales the whole parachute about the point it
   * is hanging from and the deployment is one uniform write. The rigging is
   * folded into the same geometry as a thin cone: separate lines would be ten
   * more draw calls for something two pixels wide.
   */
  _buildCanopies() {
    const dome = new THREE.SphereGeometry(2.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.78, 1);
    const rig = new THREE.ConeGeometry(2.3, 2.1, 12, 1, true);
    // Point-down cone from the skirt to the man's shoulders: the risers.
    rig.rotateX(Math.PI);
    rig.translate(0, -1.05, 0);
    const canopy = mergeGeometries([dome, rig]);
    const cMat = this._surface('fabric', 0x9aa08c);
    cMat.side = THREE.DoubleSide;
    const cMesh = new THREE.InstancedMesh(canopy, cMat, RULES.reinforceCount);
    cMesh.name = 'match_reinforce_canopies';
    cMesh.matrixAutoUpdate = false;
    cMesh.frustumCulled = false;
    cMesh.userData.owNoShadow = true;
    // One instance parked below the map so the program compiles at boot rather
    // than on the frame the door opens. Same move `Bomber._buildBombs` makes.
    cMesh.count = 1;
    this.group.add(cMesh);
    this.canopies = cMesh;
    this.canopyMat = cMat;

    /**
     * The man on the end of the lines. He is a stand-in for an `Agent` that
     * does not exist yet, so he is deliberately crude — at 40 m all that is
     * readable is a dark vertical mass under a pale dome, and anything more
     * would be a second character rig to keep in step with `src/ai`'s.
     */
    const body = mergeGeometries([
      (() => { const g = new THREE.BoxGeometry(0.58, 1.0, 0.34); g.translate(0, -2.6, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.3, 0.3, 0.3); g.translate(0, -2.0, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.2, 0.72, 0.2); g.translate(-0.19, -3.4, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.2, 0.72, 0.2); g.translate(0.19, -3.4, 0); return g; })(),
    ]);
    const bMat = this._surface('fabric', 0x3b3f33);
    const bMesh = new THREE.InstancedMesh(body, bMat, RULES.reinforceCount);
    bMesh.name = 'match_reinforce_troops';
    bMesh.matrixAutoUpdate = false;
    bMesh.frustumCulled = false;
    bMesh.userData.owNoShadow = true;
    bMesh.count = 1;
    this.group.add(bMesh);
    this.bodies = bMesh;
    this.bodyMat = bMat;
  }

  /**
   * A private instance of a library surface. Same reasoning as
   * `Bomber._hullMaterial`: `materials.get()` hands back a SHARED material and
   * these want their own tints, so they are built on top of the library's baked
   * texture set instead — which is what keeps them off the quality bar's "no
   * flat/untextured surfaces".
   */
  _surface(name, tint) {
    const set = this._lib?.getTextureSet?.(name) ?? null;
    const mat = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.68,
      metalness: 0.18,
      dithering: true,
    });
    mat.name = `reinforce_${name}`;
    if (set) {
      mat.map = set.albedo;
      mat.normalMap = set.normal;
      mat.normalScale.set(0.8, 0.8);
      mat.roughnessMap = set.orm;
    }
    this.ctx.peek('render')?.patcher?.patch(mat);
    return mat;
  }

  /** Everything below the map and out of every draw call between sorties. */
  _park() {
    this._m.makeTranslation(0, PARKED_Y, 0);
    this.heli.matrix.copy(this._m);
    this.rotorMain.matrix.copy(this._m);
    this.rotorTail.matrix.copy(this._m);
    this.heli.visible = false;
    this.rotorMain.visible = false;
    this.rotorTail.visible = false;
    for (let i = 0; i < RULES.reinforceCount; i++) {
      this.canopies.setMatrixAt(i, this._m);
      this.bodies.setMatrixAt(i, this._m);
    }
    this.canopies.count = 1;
    this.bodies.count = 1;
    this.canopies.instanceMatrix.needsUpdate = true;
    this.bodies.instanceMatrix.needsUpdate = true;
  }

  /* ====================================================================== */
  /* FIRE                                                                   */
  /* ====================================================================== */

  /**
   * Fly a drop on to `landings`.
   *
   * @param {object} o
   *  - `team`      whose side it is. Carried, never interpreted.
   *  - `label`     the zone's name, for the announcement.
   *  - `centre`    THREE.Vector3, the drop zone. The run is aimed through it.
   *  - `approach`  THREE.Vector3, a point the aircraft should come FROM —
   *                `match` passes the side's own base, so the helicopter always
   *                crosses friendly ground before it crosses the objective.
   *  - `landings`  one THREE.Vector3 per man, already snapped to a nav cell and
   *                proved. THIS FILE NEVER INVENTS ONE: a paratrooper landing on
   *                a roof or in a sealed courtyard is `ensureReachable` silently
   *                relocating a man, or hunting for 240 s and saying nothing.
   * @returns {boolean} false when the drop could not be flown.
   */
  fire(o) {
    if (!this.ready || this.run) return false;
    const landings = o?.landings ?? null;
    if (!landings || !landings.length || !o.centre) return false;

    /**
     * THE BEARING. From the approach point to the zone, flattened — a
     * helicopter that ran along the map's y would be aimed at the ground. If
     * the two points coincide (a side whose base IS the drop zone, which cannot
     * happen but must not crash), fall back to the level's +z.
     */
    const dir = this._v.subVectors(o.centre, o.approach ?? o.centre);
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    dir.normalize();

    const y = o.centre.y + RULES.reinforceAltitude;
    const run = {
      team: o.team,
      label: o.label ?? '',
      t: 0,
      /** Seconds of telegraph before the first man is out. */
      lead: RULES.reinforceLead,
      dir: dir.clone(),
      start: this._v2.copy(o.centre).addScaledVector(dir, -RUN_IN).setY(y).clone(),
      end: o.centre.clone().addScaledVector(dir, RUN_OUT).setY(y).clone(),
      centre: o.centre.clone(),
      landings,
      /** How many have left the door. */
      out: 0,
      /** How many have their feet on the ground. */
      landed: 0,
      done: false,
      yaw: Math.atan2(dir.x, dir.z),
    };
    /**
     * THE FLIGHT IS TIMED SO THE FIRST MAN LEAVES AS THE AIRCRAFT REACHES
     * `DROP_LEAD` SHORT OF THE ZONE, and that is solved backwards from the run
     * rather than tuned: the telegraph is `RULES.reinforceLead` of aircraft
     * BEFORE that instant, so the start of the run is placed at
     * `speed * lead + DROP_LEAD` behind the zone and `RUN_IN` is only a floor
     * under it. Nobody has to keep two numbers in step.
     */
    const need = RULES.reinforceSpeed * run.lead + DROP_LEAD;
    if (need > RUN_IN) run.start.copy(o.centre).addScaledVector(dir, -need).setY(y);
    run.length = run.start.distanceTo(run.end);
    run.duration = run.length / RULES.reinforceSpeed;
    /** Seconds into the run at which man 0 steps out. */
    run.dropAt = (run.start.distanceTo(o.centre) - DROP_LEAD) / RULES.reinforceSpeed;

    for (let i = 0; i < RULES.reinforceCount; i++) {
      const t = this.troops[i];
      t.state = 'idle';
      t.t = 0;
      t.phase = this.rng.range(0, Math.PI * 2);
    }
    this.run = run;
    this.heli.visible = true;
    this.rotorMain.visible = true;
    this.rotorTail.visible = true;
    this.canopies.count = RULES.reinforceCount;
    this.bodies.count = RULES.reinforceCount;
    this._poseAircraft(0);

    const a = this._ann;
    a.id = `DROP-${run.label}`;
    a.name = run.label;
    a.lead = run.lead;
    a.position = run.centre;
    a.points[0] = run.centre;
    a.count = 1;
    this.onAnnounce?.(a);
    return true;
  }

  /* ====================================================================== */
  /* FRAME                                                                  */
  /* ====================================================================== */

  /**
   * @param {number} dt
   * @param {boolean} live whether the match is in its LIVE phase. A sortie in
   *        the air still finishes when a match ends — an aeroplane halfway
   *        across the map still has to finish crossing it, exactly as `Bomber`
   *        and `Airstrike` do — but the men stop being created. @see `_land`.
   */
  update(dt, live) {
    const run = this.run;
    if (!run) return;
    run.t += dt;
    this._spin += dt;

    this._poseAircraft(run.t);

    /* ---- the door ------------------------------------------------------ */
    while (
      run.out < run.landings.length &&
      run.t >= run.dropAt + run.out * RULES.reinforceDropGap
    ) {
      this._release(run, run.out);
      run.out++;
    }

    /* ---- the fall ------------------------------------------------------ */
    let flying = 0;
    for (let i = 0; i < RULES.reinforceCount; i++) {
      const t = this.troops[i];
      if (t.state === 'idle' || t.state === 'down') continue;
      flying++;
      t.t += dt;
      /**
       * TWO PHASES. `fall` is the second and a bit between stepping out and the
       * canopy taking — a man drops, the dome inflates over him, and the scale
       * of the instance IS the deployment. `canopy` is the steady descent at
       * `RULES.reinforceDescent`, which is what sets the whole timing: the
       * horizontal lerp from the release point to the landing point is driven
       * off the SAME fraction, so a man cannot reach the ground anywhere except
       * the cell he was handed.
       */
      const openAt = 0.85;
      const frac = t.state === 'fall' ? 0 : Math.min(1, (t.t - openAt) / t.fallTime);
      if (t.state === 'fall') {
        if (t.t >= openAt) {
          t.state = 'canopy';
        } else {
          // Freefall: straight down off the door, accelerating.
          t.at.copy(t.from);
          t.at.y -= 9.0 * t.t * t.t;
        }
      }
      if (t.state === 'canopy') {
        t.at.lerpVectors(t.from, t.to, frac);
        /**
         * THE SWAY. A canopy that fell down a ruler would read as an elevator.
         * Two metres of lateral swing on the man's own phase, damped to zero as
         * he arrives so the last second is a clean landing on the cell rather
         * than a slide on to it.
         */
        const sway = (1 - frac) * 1.9;
        t.at.x += Math.sin(this._spin * 1.15 + t.phase) * sway;
        t.at.z += Math.cos(this._spin * 0.93 + t.phase) * sway;
        if (frac >= 1) {
          this._land(run, i, live);
          continue;
        }
      }
      this._poseTroop(i, t, frac);
    }

    /* ---- the aircraft leaves ------------------------------------------- */
    if (run.t > run.duration && !flying) {
      this.run = null;
      this._park();
    }
  }

  /** One man steps out. Nothing is created; a record starts moving. */
  _release(run, i) {
    const t = this.troops[i];
    const at = this._runPoint(run, run.t, this._v);
    t.from.copy(at);
    t.to.copy(run.landings[Math.min(i, run.landings.length - 1)]);
    t.at.copy(at);
    t.yaw = run.yaw;
    t.state = 'fall';
    t.t = 0;
    /**
     * The canopy phase's own duration, from the height it actually has to fall
     * rather than from `reinforceAltitude`: the drop zones are not all at y = 0
     * and a man over the cathedral ruin has less air under him than one over the
     * west avenue. Floored so a freak short fall cannot divide by zero.
     */
    t.fallTime = Math.max(1.2, (t.from.y - t.to.y) / RULES.reinforceDescent);
  }

  /**
   * His feet are down. This is the ONE call that leaves this file, and it is a
   * position and an index — `match` turns it into a soldier.
   *
   * `live` false means the match ended under the canopy. The man is still put
   * away tidily and `onLand` is NOT called: creating an Agent into a match that
   * is over is the kind of thing that leaves an actor alive across a round
   * reset. He simply does not arrive.
   */
  _land(run, i, live) {
    const t = this.troops[i];
    t.state = 'down';
    t.at.copy(t.to);
    this._m.makeTranslation(0, PARKED_Y, 0);
    this.canopies.setMatrixAt(i, this._m);
    this.bodies.setMatrixAt(i, this._m);
    this.canopies.instanceMatrix.needsUpdate = true;
    this.bodies.instanceMatrix.needsUpdate = true;
    run.landed++;
    if (live) this.onLand?.(i, t.to, t.yaw);
  }

  /** Where the aircraft is `t` seconds into the run. Writes into `out`. */
  _runPoint(run, t, out) {
    const s = Math.min(1, Math.max(0, (t * RULES.reinforceSpeed) / run.length));
    return out.lerpVectors(run.start, run.end, s);
  }

  /**
   * Fly it. The nose is on the run bearing with a few degrees of nose-down —
   * a helicopter in forward flight is pitched into it, and a level one reads as
   * a model on a stick.
   */
  _poseAircraft(t) {
    const run = this.run;
    const at = this._runPoint(run, t, this._v);
    this._q.setFromAxisAngle(this._up, run.yaw);
    this._m.compose(at, this._q, this._sc);
    // Nose-down about the aircraft's own X, applied after the yaw.
    this._m.multiply(this._pitch ?? (this._pitch = new THREE.Matrix4().makeRotationX(-0.14)));
    this.heli.matrix.copy(this._m);

    // Main rotor: on the mast, spinning about the airframe's own up.
    this._v2.set(0, 1.75, 0.4).applyMatrix4(this._m);
    this._q.setFromAxisAngle(this._up, this._spin * 9.4);
    this._m.compose(this._v2, this._q, this._sc);
    this.rotorMain.matrix.copy(this._m);

    // Tail rotor: on the fin, spinning about the airframe's own X.
    const m = this.heli.matrix;
    this._v2.set(0.62, 1.3, -9.2).applyMatrix4(m);
    this._q.setFromAxisAngle(this._up, run.yaw);
    this._m.compose(this._v2, this._q, this._sc);
    this._m.multiply(
      (this._tailSpin ?? (this._tailSpin = new THREE.Matrix4())).makeRotationX(this._spin * 16)
    );
    this.rotorTail.matrix.copy(this._m);
  }

  /**
   * One canopy and one man. `frac` drives the deployment: the dome grows from
   * a streamer to full over the first fifth of the descent, which is the
   * picture of a parachute opening and costs one scalar.
   */
  _poseTroop(i, t, frac) {
    const open = t.state === 'fall'
      ? 0.16
      : 0.16 + 0.84 * Math.min(1, (t.t - 0.85) / 0.55);
    this._q.setFromAxisAngle(this._up, t.yaw);
    this._sc.set(open, open, open);
    this._m.compose(t.at, this._q, this._sc);
    this.canopies.setMatrixAt(i, this._m);
    // The man himself does not inflate — only the canopy does — so he is posed
    // at unit scale hanging the rig's own length below the dome.
    this._sc.set(1, 1, 1);
    this._v2.copy(t.at).setY(t.at.y - (1 - open) * 2.4);
    this._m.compose(this._v2, this._q, this._sc);
    this.bodies.setMatrixAt(i, this._m);
    this.canopies.instanceMatrix.needsUpdate = true;
    this.bodies.instanceMatrix.needsUpdate = true;
  }

  /** A match ended or restarted: everything below the map, nothing in the air. */
  reset() {
    this.run = null;
    for (const t of this.troops) t.state = 'idle';
    if (this.ready) this._park();
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => o.geometry?.dispose?.());
    this.hullMat?.dispose();
    this.rotorMat?.dispose();
    this.canopyMat?.dispose();
    this.bodyMat?.dispose();
  }
}
