import * as THREE from 'three';

/**
 * THROWN GRENADES — the flight, the fuze and the blast.
 *
 * A grenade in the air is not a projectile in the `ballistics.js` sense: that
 * sim is for rounds, which travel in a straight line at 400-900 m/s and are
 * retired on their first contact. A frag leaves the hand at 17 m/s, tumbles,
 * bounces off the wall you meant to throw it past and rolls back to your feet,
 * and every one of those is a rigid-body behaviour. So it is a real body:
 * `physics.spawnDebris` with a sphere shape, the grenade's own mass and
 * restitution, and the viewmodel's own meshes driven by the solver.
 *
 * THE BLAST reuses the C4's model exactly (see `src/match/bomb.js`): the
 * canonical `explosion` event, which `fx` turns into a fireball, `audio` into
 * the blast voice, `physics` into a radial impulse on debris and ragdolls, and
 * `player` into camera trauma and suppression. What it does NOT reuse is the
 * team-blind damage in `ai`'s own `explosion` listener — see `_damageActors`.
 */

const MAX_LIVE = 6;

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE MINEFIELD — 「敵味方が対戦車地雷を設置できるようにして ５人ずつ 一人につき2つ」
 * ══════════════════════════════════════════════════════════════════════════
 * FIVE MEN A SIDE AT TWO EACH IS TWENTY LIVE MINES, and `MAX_LIVE` is SIX.
 * That is the whole reason there is a second pool in this file rather than four
 * more slots in the first one: `this.pool` is the THROW pool — a rigid body, a
 * bounce, a fuze, a viewmodel proxy per slot — and it is sized for what can be
 * in the air at once. A mine that has finished arming is not in the air; it is
 * a sensor on the ground that lives until something drives over it or the round
 * ends, and twenty of those would wedge the throw pool shut for everybody.
 *
 * So an anti-tank mine EMPLACES: at the end of its arming delay it leaves the
 * throw slot (`_emplace`), the rigid body goes, the canister proxy is handed
 * back, and it takes a `field` slot with the laid mesh. The throw slot is free
 * again on the same frame. THE PM-1 DOES NOT DO THIS and nothing about it
 * moves — it has `count: 1`, it is a tripwire rather than a plate, and it stays
 * in the throw slot it has always lived in. @see `_updateMine`.
 *
 * 32 rather than 20: `layMine` is a public entry point and the ration is
 * `src/ai`'s to spend, so the pool is sized for the ask plus the slack a
 * resupply or a second wave would want. Preallocated at construction; nothing
 * below allocates once the first mine has been laid.
 */
const MINE_MAX = 32;
/** The laid mine, in metres — @see `_atMesh`. Under `NavGrid`'s 0.42 m
 *  trip-hazard floor by a factor of four, and it carries no collider at all. */
const AT_R = 0.165;
const AT_H = 0.075;
/** The marker ring on the ground round an ARMED mine. @see `_drawRing`. */
const AT_RING_IN = 0.30;
const AT_RING_OUT = 0.345;

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE SCREEN IS ABOUT EIGHT METRES — 「スモークの煙の範囲を広げて ８メートルくらい」
 * ══════════════════════════════════════════════════════════════════════════
 * The FALLBACK only: `weapons/defs.js:smoke.smokeRadius` is the authority and
 * carries the same 8. Both are here because a def that ever loses the field
 * must not quietly hand back the old 6.5 m can.
 *
 * IT IS NOT A DRAWING NUMBER, and that is the whole of why widening it is a
 * change to the game rather than to the picture: the figure rides out on
 * `weapon:smoke`, and `AiSystem`'s listener takes its volume straight off the
 * event (`e.radius`, then `× SMOKE_CORE`) and refuses every sightline through
 * the core of it. Eight metres published is therefore eight metres of cover
 * from a bot's eye as well as from yours — symmetrically, since `_smokeBlocks`
 * runs inside `_sightTo` for both directions. Nothing in `src/ai` had to be
 * edited to make that true, and nothing there carries a competing radius: the
 * `?? 6.5` on that listener is a fallback for an event with no radius on it,
 * which this one always has.
 *
 * THE ONE THING STILL AT 6.5 IS A BOT'S OWN CAN — `AiSystem._detonateThrown`
 * writes `ev.radius = 6.5` from a literal rather than from `defs.js`. That is
 * that file's number to move and it is left alone here; until it does, a bot's
 * screen is a fifth narrower than the player's.
 */
const SMOKE_R = 10;
/**
 * THE FOOTPRINT, as a fraction of the can's radius.
 *
 * `Ambience._puff` spends its `radius` on EVERY dimension of a puff at once:
 * the puff is born inside `±0.6 * radius`, it is `radius * (0.7..1.2)` across
 * when it is born, it wanders on `radius * 0.5` of turbulence. So this one
 * number is the cloud, and the old `0.22` was emitting the whole 10 m screen
 * inside a 2.6 m disc — 「実質３mくらいしかスモークでてない」, exactly.
 *
 * 0.62 puts the spawn disc at ±3.7 m and the newborn puff at ~5.9 m across, so
 * the drawn edge lands near the 10 m the def publishes. @see `_smoke`.
 *
 * A BOT'S OWN CAN IS STILL DRAWN THE OLD WAY. `AiSystem._detonateThrown` does
 * not call this method — it has its own `addSmokeSource` call with its own
 * `rate: 26` and `radius * 0.22` — so a bot's screen covers the same 10 m of
 * sightline as the player's and still draws the 3 m of it. That file is not
 * this one's to edit; the numbers to copy across are the three here.
 */
const SMOKE_FOOT = 0.62;
/**
 * `Ambience._puff` sizes a puff at `radius * growth`, so this is a RATIO and
 * not a distance. @see the note in `_smoke`, which is where it is spent.
 */
const SMOKE_GROWTH = 1.8;
/**
 * PUFFS PER SECOND, and `SMOKE_RATE * SMOKE_LIFE` is the live sprite count:
 * 585, up from the 195 that a 2.6 m footprint could get away with. @see the
 * cap in `_smoke`, which is what keeps that off a low-tier particle ring.
 */
const SMOKE_RATE = 78;
const SMOKE_LIFE = 7.5;

class Thrown {
  constructor() {
    this.live = false;
    this.fuse = 0;
    this.body = null;
    this.group = null;
    this.pos = new THREE.Vector3();
    /**
     * MINE STATE. Every throwable rides this same record — a mine is not a
     * different class, it is a can whose fuze arms a sensor instead of a
     * detonator — so the four extra fields live here rather than in a parallel
     * pool that `clear()`, `_retire()` and the stats would all have to know
     * about. @see `ThrownGrenades._updateMine`.
     */
    this.kind = 'frag';
    this.armed = false;
    this.tripped = false;
    this.trig = 0;
    this.beep = 0;
    this.len = 1;
    this.dir = new THREE.Vector3(0, 0, 1);
    this.beam = null;
    /**
     * ANTI-TANK STATE. Three more fields on the same record, for the same
     * reason the four above are here: an AT mine is not a different class, it
     * is a mine whose ARMED state runs a pressure plate instead of a laser.
     *
     *   team   who laid it. A plate does not go off under the hull of the side
     *          that buried it — @see `armourFootprint`.
     *   owner  the man, for kill credit on `damage:dealt` and on the tank's own
     *          `lastHitBy`. Null means the environment.
     *   mesh   the LAID object, which is not the canister that was thrown.
     *   ring   its marker on the ground. @see `_drawRing`.
     */
    this.team = -1;
    this.owner = null;
    this.mesh = null;
    this.ring = null;
    /** True on a record that lives in `field` rather than in `pool`. */
    this.laid = false;
  }
}

export class ThrownGrenades {
  constructor(ctx) {
    this.ctx = ctx;
    this.pool = [];
    for (let i = 0; i < MAX_LIVE; i++) this.pool.push(new Thrown());
    /** The LAID mines — @see `MINE_MAX`. Preallocated; never grows. */
    this.field = [];
    for (let i = 0; i < MINE_MAX; i++) {
      const f = new Thrown();
      f.laid = true;
      this.field.push(f);
    }
    /** How many field slots are ARMED. The whole detection short-circuits on
     *  it, so a match with no mines in it pays one integer compare a frame. */
    this._armedN = 0;
    this._proxies = [];
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._seg = new THREE.Vector3();
    this._pt = new THREE.Vector3();
    this._pt2 = new THREE.Vector3();
    /** Where a mine went off, held across `_retire` — that call clears the
     *  record and `_detonate` still has to be told where it was. */
    this._det = new THREE.Vector3();
    this._blast = {
      position: new THREE.Vector3(),
      radius: 7.5,
      /**
       * ZERO, and it is not a placeholder.
       *
       * `ai`'s `explosion` listener damages every agent inside the radius with
       * no team test at all — the C4 kills your own side and always has. A
       * weapon the PLAYER throws cannot do that with `RULES.friendlyFire` off,
       * and `src/ai` is not this subsystem's to edit. So the event carries the
       * blast without the wound: fx, audio, the physics impulse, the camera
       * trauma and the suppression all key off `radius`, and the damage is
       * dealt from `_damageActors` through `damage:dealt`, which is the path
       * `ai` DOES gate on `friendlyFire` (index.js, the `damage:dealt`
       * listener) and the only one that carries `source`, i.e. kill credit,
       * the killfeed and a hitmarker.
       *
       * `impulse` is passed explicitly because `physics.explode` derives its
       * strength from `damage` when it is absent, and the debris still has to
       * fly.
       */
      damage: 0,
      impulse: 0,
      source: 'grenade',
      /** WHAT ordnance it is, for anything that has to tell one blast from
       *  another — `Armour._takeBlast` does. Rewritten on every detonation.
       *  @see `_explode`. */
      kind: null,
    };
    this._dmg = {
      target: null, amount: 0, headshot: false, part: 'torso',
      killed: false, point: new THREE.Vector3(), source: null,
    };
    /** Beam meshes, one per mine slot, built lazily and reused. @see _drawBeam. */
    this._beams = [];
    this._beamGeo = null;
    this._beamMat = null;
    /**
     * THE LAID ANTI-TANK MINE — geometry and materials built ONCE on the first
     * emplacement and shared by every mine on the map, meshes reused per field
     * slot. Same pattern, same reason and the same `dispose` as the beam above.
     */
    this._atGeo = null;
    this._atPlateGeo = null;
    this._atMat = null;
    this._atPlateMat = null;
    this._ringGeo = null;
    this._ringMat = null;
    /** Preallocated for `_layFlat` — a mine is emplaced flat, not at the
     *  tumble the canister happened to come to rest at. */
    this._flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    /** Distinct actors found inside one blast. Preallocated; never grows. */
    this._hits = [];
    for (let i = 0; i < 24; i++) {
      this._hits.push({ owner: null, d: 0, x: 0, y: 0, z: 0, mx: 0, my: 0, mz: 0 });
    }
    this.stats = {
      thrown: 0, detonated: 0, live: 0,
      /** Mines: laid, currently armed, and how many a hull has driven onto. */
      laid: 0, armed: 0, tripped: 0, refused: 0,
      /**
       * THE COST OF THE DETECTION, as a count rather than a claim. One tick
       * per (hull, armed mine) pair tested this frame — @see
       * `armourFootprint`, and `_dtankmine.mjs` divides it by the frames.
       */
      probes: 0,
    };
    /**
     * The bounce is audible: the `impact` voice with a metal surface is the
     * same one a round makes on sheet steel, which is what a 400 g steel ball
     * hitting concrete is. Bound once — `RigidBody.onImpact` is called from the
     * solver, so a closure per throw would be a closure per throw forever.
     */
    this._onBounce = (b, x, y, z, nx, ny, nz, speed) => {
      this._v2.set(x, y, z);
      this.ctx.peek('audio')?.play?.('impact', this._v2, {
        surface: 'metal',
        energy: Math.min(1, speed / 9),
        level: 0.6,
      });
    };
  }

  get physics() {
    if (!this._phys) this._phys = this.ctx.peek('physics');
    return this._phys;
  }

  /**
   * Put one in the air.
   *
   * @param {THREE.Vector3} pos    release point, world space
   * @param {THREE.Vector3} vel    release velocity, world space
   * @param {number} fuse          seconds LEFT on the fuze, not the full fuze
   * @param {object} def           the weapon def (radius, damage, bounce)
   * @param {THREE.Object3D[]} meshes  viewmodel meshes to clone the prop from
   */
  spawn(pos, vel, fuse, def, meshes, opts = {}) {
    let g = null;
    for (const p of this.pool) if (!p.live) { g = p; break; }
    if (!g) return null;
    const phys = this.physics;
    g.live = true;
    g.fuse = Math.max(0.05, fuse);
    g.def = def;
    g.kind = def?.throwKind ?? 'frag';
    g.armed = false;
    g.tripped = false;
    g.trig = 0;
    /** Whose it is, so a mine that emplaces off this throw carries the side
     *  that laid it and the man who gets paid for what it kills. */
    g.team = opts.team ?? -1;
    g.owner = opts.owner ?? null;
    g.len = 1;
    g.dir.set(0, 0, 1);
    g.pos.copy(pos);
    g.group = this._proxy(meshes, g.kind);
    if (g.group) {
      g.group.position.copy(pos);
      g.group.visible = true;
    }
    if (phys?.spawnDebris) {
      g.body = phys.spawnDebris(pos, vel, {
        shape: 'sphere',
        size: 0.0285,
        surface: 'metal',
        mass: 0.4,
        // A steel ball on concrete keeps about a third of its speed and stops
        // quickly: high friction, low restitution, heavy angular damping.
        restitution: def.bounce ?? 0.34,
        friction: 0.72,
        lifetime: 30,
        object3D: g.group,
        onImpact: this._onBounce,
      });
    }
    this.stats.thrown++;
    return g;
  }

  /** Detonate at a point with no body — a cook-off in the shooter's own hand. */
  blastAt(position, def) {
    this._detonate(position, def);
  }

  /**
   * WHAT HAPPENS WHEN THE FUZE RUNS OUT, and it is the ONLY place the four
   * throwables differ. Everything upstream — the cook, the release beat, the
   * rigid body, the bounce, the fuze — is shared, because physically it is the
   * same act.
   */
  _detonate(position, def, owner = null) {
    switch (def?.throwKind) {
      case 'flash': return this._flash(position, def);
      case 'smoke': return this._smoke(position, def);
      // A mine is a frag with a longer story; when it finally goes off it goes
      // off exactly like one.
      default: return this._explode(position, def, owner);
    }
  }

  /**
   * THE FLASHBANG — 「閃光弾」.
   *
   * Three things happen and only one of them is damage, which is zero:
   *
   *   THE BANG   the canonical `explosion` event with the def's own small
   *              radius, so fx draws a burst, audio plays the blast voice and
   *              physics throws the loose debris. `damage: 0` on the payload
   *              is what it always is here (see `_blast`), and `_damageActors`
   *              is simply not called.
   *   THE LIGHT  `fx.viewFlash` at the eye, at the top of its strength range,
   *              which is the brightest thing this engine can put in front of
   *              the player without owning `ui`. It is scaled by how much of
   *              the flash the player could actually SEE: full in the open at
   *              3 m, nothing at all through a wall, because the same
   *              `MASK.EXPLOSION` line of sight that gates blast damage gates
   *              this. Turning your back is not modelled — the flash is a
   *              radius, not a cone — and that is the honest limit of it.
   *   THE STATE  trauma and suppression on the player, which is the engine's
   *              existing "you have been rocked" channel: the camera shakes,
   *              the reticle blooms and the audio ducks.
   *
   * `weapon:flash` carries { position, radius, duration } for anything that
   * wants to draw a real white-out later — that belongs to `ui`, which this
   * subsystem does not own.
   */
  _flash(position, def) {
    const b = this._blast;
    b.position.copy(position);
    b.position.y += 0.14;
    b.radius = def.blastRadius ?? 4.5;
    b.damage = 0;
    b.impulse = 60;
    // `_blast` is shared; both fields are re-stated rather than left over from
    // whatever went off last. @see the same two lines in `_explode`.
    b.kind = null;
    b.source = 'grenade';
    this.ctx.events.emit('explosion', b);

    const radius = def.flashRadius ?? 16;
    const dur = def.flashDuration ?? 4.2;
    this.ctx.events.emit('weapon:flash', { position: b.position, radius, duration: dur });

    const phys = this.physics;
    const cam = this.ctx.camera;
    const player = this.ctx.peek('player');
    const eye = cam.position;
    const d = this._v.copy(b.position).distanceTo(eye);
    let see = d < radius ? 1 - d / radius : 0;
    if (see > 0 && phys?.lineOfSight && !phys.lineOfSight(b.position, eye, phys.MASK.EXPLOSION)) {
      see = 0;
    }
    if (see > 0) {
      const fx = this.ctx.peek('fx');
      // At the eye, not at the grenade: this is the light IN the player's face.
      // 2.2 is the top of viewFlash's own clamp, so a bang at your feet is as
      // bright as this engine goes.
      fx?.viewFlash?.(eye.x, eye.y, eye.z - 0.35, 1, 0.98, 0.92, 0.4 + see * 1.8);
      player?.addTrauma?.(Math.min(0.85, 0.25 + see * 0.7));
      player?.addSuppression?.(Math.min(1, 0.4 + see * 0.9));
    }
    this.stats.detonated++;
  }

  /**
   * THE SMOKE CAN — 「スモーク」.
   *
   * NO explosion event at all, and that is the point: a smoke grenade that
   * fires the blast voice sounds like a frag that did nothing. It lights, and
   * then it makes smoke for `smokeDuration` seconds through `fx`'s own
   * persistent smoke source — the same emitter a burning vehicle uses, at a
   * rate and radius that fill a street rather than trail off a wreck.
   *
   * `removeSmokeSource` is not called: the source is created with a finite
   * `duration` and `fx.ambience` retires it itself, which is the documented
   * way to have a column that ends.
   */
  _smoke(position, def) {
    const fx = this.ctx.peek('fx');
    const dur = def.smokeDuration ?? 14;
    const rad = def.smokeRadius ?? SMOKE_R;
    this._v.copy(position);
    this._v.y += 0.1;
    /**
     * THE RATE IS CAPPED BY THE RING IT SPAWNS INTO, not by taste alone.
     *
     * `rate x life` IS the live sprite count — 78 x 7.5 is 585 — and they all
     * come out of `fx.lit`, whose capacity is a share of `q.particleBudget`:
     * 2805 slots on the default tier but 935 on `low`. At 585 a single can
     * would be two thirds of a low-tier ring and two cans would wrap it inside
     * a puff's own lifetime, which does not just truncate the cloud's tail — it
     * evicts the blood, the dust and the impact puffs that share the layer.
     *
     * A quarter of the ring is the most one can may take. It binds on `low`
     * alone (31/s there, near the 26 this always was) and leaves medium, high
     * and ultra at the photographed 78.
     */
    const slots = fx?.lit?.capacity ?? 0;
    const rate = slots > 0 ? Math.min(SMOKE_RATE, (slots * 0.25) / SMOKE_LIFE) : SMOKE_RATE;
    fx?.addSmokeSource?.(this._v, {
      duration: dur,
      // A smoke can is a firehose, not a chimney: many puffs a second, wide,
      // rising slowly, pale rather than sooty, and living long enough that the
      // cloud is a wall instead of a plume.
      rate,
      radius: rad * SMOKE_FOOT,
      rise: 0.85,
      dark: 0.04,
      life: SMOKE_LIFE,
      /**
       * A MULTIPLIER, NOT A SIZE — `Ambience._puff` grows a puff to
       * `radius * growth`, so this and `SMOKE_FOOT` above are the two halves of
       * one number and they were pulling against each other.
       *
       * `0.22 x 5.85` drew a 12.9 m sprite from a 2.2 m footprint: a handful of
       * enormous puffs born inside a tiny disc. It reads as 3 m because a puff
       * is only that big at the END of its life, by which time `alphaCurve` 1.7
       * has all but erased it — what you actually SEE is the young puff, and
       * the young puff is the footprint. That is the whole of the bug, and it
       * is also why 40 m came apart: 8.8 x 5.85 is a 51 m sprite.
       *
       * The product is nearly what it was (1.29 -> 1.12 of `rad`), so a sprite
       * has not grown; the footprint it is born in has, by 2.8x. What that
       * costs is density: the same 195 sprites spread over 2.8x the ground
       * photographed as a haze you could read a wall through, so `rate` pays
       * for it. @see the note on the cap above.
       */
      growth: SMOKE_GROWTH,
      ember: 0,
      haze: 0.85,
    });
    // The pop and the hiss: the same surface voice the can makes when it lands,
    // at a scale that says something opened rather than something exploded.
    this.ctx.peek('audio')?.play?.('impact', this._v, { surface: 'metal', energy: 1, level: 0.9 });
    this.ctx.events.emit('weapon:smoke', { position: this._v, radius: rad, duration: dur });
    this.stats.detonated++;
  }

  update(dt) {
    let live = 0;
    for (const g of this.pool) {
      if (!g.live) continue;
      live++;
      if (g.body) g.pos.copy(g.body.position);
      /**
       * A MINE DOES NOT COUNT DOWN TO A BANG. Its `fuse` is the arming delay:
       * when it runs out the thing stops being a grenade in the air and starts
       * being a sensor on the floor, and from then on the only clocks that
       * matter are the beam and — once something breaks it — `trigDelay`.
       */
      if (g.kind === 'mine') {
        this._updateMine(g, dt);
        continue;
      }
      g.fuse -= dt;
      if (g.fuse > 0) continue;
      // Read before the retire: `_retire` clears the record.
      const def = g.def;
      const owner = g.owner;
      const pos = this._det.copy(g.pos);
      this._retire(g);
      this._detonate(pos, def, owner);
    }
    this.stats.live = live;

    /**
     * …AND THE MINEFIELD, which is a SECOND list rather than more slots in the
     * first — @see `MINE_MAX`. A laid mine has no body and no fuze; the only
     * clocks on it are its arming delay and, once a hull is on the plate,
     * `trigDelay`. `_updateMine` is the SAME method the throw pool runs, so
     * there is exactly one mine state machine in this subsystem.
     */
    let armed = 0;
    for (const g of this.field) {
      if (!g.live) continue;
      this._updateMine(g, dt);
      if (g.armed && g.live) armed++;
    }
    this._armedN = armed;
    this.stats.armed = armed;
  }

  /* ----------------------------------------------------------------- mine -- */

  /**
   * THE LASER TRIPWIRE — 「レーザーが出ていて人が触れると1秒後に爆発するもの
   * これは感知したときに音を知らせるようにして」.
   *
   * Three states and they are all in this one method, because they are one
   * object's life and splitting them across a state machine would hide it:
   *
   *   ARMING   `fuse` counting down, no beam, nothing can set it off.
   *   ARMED    the beam is drawn and CAST every frame. The cast is a real
   *            `physics.sphereCast` down the mine's own facing with the def's
   *            `beamRadius`, so the beam stops at the first wall — which is
   *            what gives it its visible length — and anything with an `actor`
   *            on the hit is a man standing in it. The player is tested
   *            separately, by distance to the segment, because the local
   *            player is not in the collider list as an actor.
   *   TRIPPED   `trigDelay` counting down, beam blinking. Nothing can stop it.
   *
   * The AUDIBLE WARNING is fired once, on the transition into TRIPPED, at the
   * mine's own position so it is positional for everyone: the man who walked
   * into it hears it at his feet and the man across the street hears which
   * doorway it came from.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * …AND THE ANTI-TANK MINE IS THE SAME THREE STATES WITH A DIFFERENT SENSOR
   * ──────────────────────────────────────────────────────────────────────────
   * `def.trackWidth` is what says which — @see the block over `atmine` in
   * defs.js. The ARMING and TRIPPED states are shared verbatim; the ARMED state
   * is where they part, and the part is that an AT mine DOES NOTHING HERE. Its
   * plate is polled by `armourFootprint`, which the hull calls once a frame
   * with its own footprint, so an armed minefield costs this loop one boolean
   * per mine and no cast at all. The tripwire's two queries below are the
   * PM-1's and are unchanged.
   */
  _updateMine(g, dt) {
    const phys = this.physics;
    /** A plate, not a tripwire. One field read; no branch on an id. */
    const plate = (g.def?.trackWidth ?? 0) > 0;
    if (!g.armed) {
      g.fuse -= dt;
      if (g.fuse > 0) return;
      /**
       * IT EMPLACES. A thrown AT mine that has finished arming leaves the
       * THROW pool for a field slot and this record is done — @see `_emplace`
       * and the `MINE_MAX` block. `g.laid` is true on a record that is already
       * in the field (a bot's, or one that got here the frame before), and
       * that record arms in place.
       */
      if (plate && !g.laid) {
        this._emplace(g);
        return;
      }
      g.armed = true;
      if (plate) {
        // Flat on the ground with its marker ring lit. A mine that came to
        // rest at whatever tumble the canister happened to end on is a mine
        // standing on its rim.
        this._layFlat(g);
        this._drawRing(g);
      } else {
        // Settle the beam along whatever direction the mine came to rest facing.
        if (g.body?.quaternion) g.dir.set(0, 0, 1).applyQuaternion(g.body.quaternion);
        else g.dir.set(0, 0, 1);
        g.dir.y = 0;
        if (g.dir.lengthSq() < 1e-6) g.dir.set(0, 0, 1);
        g.dir.normalize();
      }
      // A click as it arms — the same mechanical voice a dry trigger makes.
      this.ctx.peek('audio')?.play?.('dryfire', g.pos, { level: 0.5 });
      return;
    }

    if (g.tripped) {
      g.trig -= dt;
      if (plate) this._drawRing(g);
      else this._drawBeam(g, true);
      if (g.trig > 0) return;
      const def = g.def;
      const pos = this._det.copy(g.pos);
      const owner = g.owner;
      this._retire(g);
      this._detonate(pos, def, owner);
      return;
    }

    /**
     * ARMED AND ANTI-TANK: nothing. The plate is not a query this file makes —
     * it is one the HULL makes, once a frame, through `armourFootprint`. There
     * is no cast, no allocation and no draw here; the ring was placed when it
     * armed and does not move.
     */
    if (plate) return;

    /* ---- cast the beam and look down it ---------------------------------
     * TWO DIFFERENT QUERIES, because they answer two different questions and
     * one primitive cannot do both:
     *
     *   HOW LONG IS IT   a plain `raycast` against MASK.WORLD. A swept SPHERE
     *                    was tried first and is wrong by construction: the
     *                    emitter is 30 mm off the deck — it is a TRIPwire, it
     *                    is supposed to be at ankle height — so a 220 mm
     *                    sphere starts already intersecting the floor and the
     *                    cast returns a hit at distance 0. Measured: every
     *                    mine drew a 0.2 m stub and nothing could ever cross
     *                    it. A ray has no radius and no such problem.
     *   IS SOMEBODY IN IT  the actor hitboxes, by distance from each capsule
     *                    to the beam SEGMENT — the same `_nearest` the blast
     *                    uses, so the mine and the explosion agree about where
     *                    a man is. Actors are not on MASK.WORLD, so they can
     *                    never shorten the beam; only geometry does.
     */
    const def = g.def;
    const r = def.beamRadius ?? 0.22;
    let len = def.beamRange ?? 9;
    this._v.copy(g.pos);
    this._v.y += 0.03;
    if (phys?.raycast) {
      const hit = phys.raycast(this._v, g.dir, len, phys.MASK.WORLD);
      if (hit?.hit) len = Math.max(0.3, hit.distance - 0.02);
    }
    g.len = len;
    this._drawBeam(g, false);
    let broken = this._actorInBeam(this._v, g.dir, len, r);
    if (!broken) broken = this._playerInBeam(this._v, g.dir, len, r);
    if (!broken) return;

    g.tripped = true;
    g.trig = def.trigDelay ?? 1.0;
    this._trip(g);
  }

  /**
   * Is any AI actor standing in the beam? Nearest point on each hitbox capsule
   * to the beam segment, against the beam's own radius plus nothing — the
   * capsule already carries the man's width.
   */
  _actorInBeam(from, dir, len, r) {
    const phys = this.physics;
    if (!phys?.colliders) return false;
    const ACTOR = phys.LAYER?.ACTOR ?? 0;
    for (let i = 0; i < phys.colliders.length; i++) {
      const c = phys.colliders[i];
      if (!c.owner || (ACTOR && !(c.layer & ACTOR))) continue;
      if (c.owner.alive === false) continue;
      // Cheap reject first: the hitbox's own centre against the beam's length.
      this._mid(c, this._pt2);
      this._v2.copy(this._pt2).sub(from);
      const along = this._v2.dot(dir);
      if (along < -1 || along > len + 1) continue;
      // Nearest point on the beam to this capsule, then the capsule to it.
      const t = Math.max(0, Math.min(len, along));
      this._v2.copy(from).addScaledVector(dir, t);
      this._nearest(c, this._v2, this._pt);
      if (this._pt.distanceTo(this._v2) <= r) return true;
    }
    return false;
  }

  /** Is the local player standing in the beam? Distance to the segment. */
  _playerInBeam(from, dir, len, r) {
    const cam = this.ctx.camera;
    if (!cam) return false;
    const player = this.ctx.peek('player');
    if (!player || player.dead) return false;
    // The player's capsule, not his eye: a man crouching under a beam at head
    // height has not broken it, and a man standing has.
    this._pt.setFromMatrixPosition(cam.matrixWorld);
    const feetY = this._pt.y - (player.eyeHeight ?? 1.66);
    // The test point is the player's own column at the BEAM'S height: a man
    // whose feet are below the beam and whose head is above it is standing in
    // it, and a man crouched under it is not.
    this._pt2.copy(this._pt);
    this._pt2.y = Math.min(this._pt.y, Math.max(feetY, from.y));
    this._v2.copy(this._pt2).sub(from);
    const along = Math.max(0, Math.min(len, this._v2.dot(dir)));
    this._v2.copy(from).addScaledVector(dir, along);
    // Player capsule radius ~0.36 m; the beam is `r` thick.
    return this._v2.distanceTo(this._pt2) <= r + 0.36;
  }

  /**
   * THE WARNING NOISE, and it is the requested feature rather than dressing:
   * one second of it is the entire difference between a mine and a trap you
   * cannot answer.
   *
   * `mine_trip` is that voice, and it is now a real one: two pips, each
   * SWEEPING UP, the second starting above where the first ended. The
   * placeholder was `dryfire` — a hard mechanical click, played twice — which
   * cut through a firefight but said the wrong thing. A click is an EVENT; a
   * rising pitch is a STATE, and the state is that a clock is running.
   *
   * The voice carries both pips itself, so the 180 ms re-strike this used to
   * queue is gone. Leaving it would have played four.
   */
  _trip(g) {
    const audio = this.ctx.peek('audio');
    audio?.play?.('mine_trip', g.pos, { level: 1.0 });
    // Everyone near it should FLINCH, which is what says "that was for you".
    const player = this.ctx.peek('player');
    if (player?.addSuppression) {
      const d = this._v.copy(g.pos).distanceTo(this.ctx.camera.position);
      if (d < (g.def.blastRadius ?? 8.5)) player.addSuppression(0.5);
    }
    this.ctx.events.emit('weapon:mine', { phase: 'trip', position: g.pos, delay: g.trig });
  }

  /**
   * THE BEAM ITSELF — a thin emissive tube from the emitter down the sightline,
   * one mesh per mine slot, scaled rather than rebuilt so nothing allocates
   * after the first throw. Red, additive, and it BLINKS once tripped, because
   * the second the beam changes is the second the player has to move.
   */
  _drawBeam(g, tripped) {
    let m = g.beam;
    if (!m) {
      if (!this._beamGeo) {
        // Unit tube along +Z, 1 m long, so `scale.z` is the beam's length.
        this._beamGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 6, 1, true);
        this._beamGeo.rotateX(Math.PI / 2);
        this._beamGeo.translate(0, 0, 0.5);
        this._beamMat = new THREE.MeshBasicMaterial({
          color: 0xff2a10,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
      }
      m = new THREE.Mesh(this._beamGeo, this._beamMat);
      m.frustumCulled = false;
      m.userData.owNoShadow = true;
      m.userData.owNoPrepass = true;
      this.ctx.scene.add(m);
      this._beams.push(m);
      g.beam = m;
    }
    m.visible = true;
    m.position.copy(g.pos);
    m.position.y += 0.02;
    this._v2.copy(g.pos).addScaledVector(g.dir, Math.max(0.2, g.len ?? 1));
    this._v2.y += 0.02;
    m.lookAt(this._v2);
    m.scale.set(1, 1, Math.max(0.2, g.len ?? 1));
    if (tripped) {
      // 8 Hz blink off the game clock: no per-mine timer to keep.
      const on = Math.sin(this.ctx.time.elapsed * 50) > 0;
      m.material.opacity = on ? 0.95 : 0.15;
    }
  }

  /* ------------------------------------------------------------ the field -- */

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * LAY ONE. THIS IS THE PUBLIC ENTRY POINT AND THERE IS ONLY THIS ONE.
   * ══════════════════════════════════════════════════════════════════════════
   * 「敵味方が対戦車地雷を設置できるようにして」 — BOTH sides, which means the bots
   * lay them, which means there must be exactly one implementation for a bot's
   * mine and the player's. The smoke can is the cautionary tale this file
   * already carries at length: two independent throwables drifted twice, first
   * on radius and then on drawing, and the fix both times was to make one of
   * them read the other's numbers. A mine is not going to be allowed to start
   * down that road, so `src/ai` does not get a mine of its own to keep in step
   * — it gets this call, and what comes out is the same record, in the same
   * pool, with the same sensor, the same trip voice, the same arming delay and
   * the same blast as the one the player emplaces.
   *
   * `WeaponSystem.layMine` is the wrapper `ai` actually reaches (`weapons` is
   * the subsystem id; this class is not published); it fills `def` in from
   * `WEAPON_DEFS.atmine` so a caller cannot lay a mine with numbers of its own.
   *
   * @param {THREE.Vector3|{x,y,z}} position  where. Y is snapped to the ground.
   * @param {object} def   the weapon def — `atmine`, supplied by the wrapper.
   * @param {object} opts  { team, owner }. `team` is the side that laid it and
   *                       is what keeps a plate from going off under its own
   *                       armour; `owner` is the man, for kill credit.
   * @returns {boolean} false when the field is full, which is the only failure.
   */
  lay(position, def, opts = {}) {
    let g = null;
    for (const f of this.field) if (!f.live) { g = f; break; }
    if (!g) {
      this.stats.refused++;
      if (!this._fullWarned) {
        this._fullWarned = true;
        console.warn(`[weapons] minefield full at ${MINE_MAX}; further mines refused`);
      }
      return false;
    }
    g.live = true;
    g.def = def;
    g.kind = 'mine';
    g.armed = false;
    g.tripped = false;
    g.trig = 0;
    g.fuse = Math.max(0.05, def?.fuse ?? 6);
    g.team = opts.team ?? -1;
    g.owner = opts.owner ?? null;
    g.pos.set(position.x, position.y, position.z);
    this._ground(g.pos);
    this._layFlat(g);
    this.stats.laid++;
    return true;
  }

  /**
   * A THROWN mine has finished its arming delay: hand it from the THROW pool to
   * the FIELD. @see the `MINE_MAX` block for why this is not one pool.
   *
   * The canister's rigid body and viewmodel proxy are given back here rather
   * than kept alive under the laid mesh — the thing on the ground from this
   * frame on is the emplaced mine, not the object that was in the air.
   */
  _emplace(g) {
    const ok = this.lay(g.pos, g.def, { team: g.team, owner: g.owner });
    this._retire(g);
    // A refused mine is a mine that never armed; the player is out a store and
    // there is nothing on the ground. `stats.refused` is the count.
    return ok;
  }

  /** Drop `p.y` onto the ground under it. One raycast, at emplacement only. */
  _ground(p) {
    const phys = this.physics;
    if (!phys?.groundHeight) return p;
    const y = phys.groundHeight(p.x, p.z, p.y + 2.0);
    if (Number.isFinite(y)) p.y = y;
    return p;
  }

  /**
   * THE LAID MINE, FLAT ON THE GROUND — 「設置」.
   *
   * The mesh is NOT the canister the player threw (@see `buildAtMine` in
   * models/throwables.js for why the carried object and the emplaced object are
   * two different things), and it is not posed off a rigid body: a mine lies
   * flat, and a mine that came to rest at whatever tumble a sphere ended on is
   * a mine standing on its rim. One quaternion, set at construction.
   *
   * 97 mm proud of the ground, all in — `AT_R`/`AT_H` plus the plate. `NavGrid`
   * refuses nothing under `maxStep` 0.45 and the trip-hazard band starts at
   * 0.42 (「石ころオブジェが移動の妨げです」), so this is a quarter of the way to
   * being a problem. IT ALSO CARRIES NO COLLIDER AT ALL: nothing walks into it,
   * nothing paths round it, and `physics` never sees it.
   */
  _layFlat(g) {
    let m = g.mesh;
    if (!m) {
      m = this._atMesh();
      this.ctx.scene.add(m);
      g.mesh = m;
    }
    m.visible = true;
    m.position.copy(g.pos);
    m.quaternion.copy(this._flat);
    m.updateMatrix();
    m.updateMatrixWorld(true);
  }

  /**
   * Geometry and materials for the laid mine, built ONCE and shared by every
   * mine on the map. One `Group` per field slot, reused for the life of the
   * match; nothing here allocates after the first emplacement.
   */
  _atMesh() {
    if (!this._atGeo) {
      // Body: a shallow truncated cone, flat top, laid on its face. Built
      // along +Z (the model convention) and turned by `_flat`.
      this._atGeo = new THREE.CylinderGeometry(AT_R, AT_R + 0.012, AT_H, 20, 1);
      this._atGeo.rotateX(Math.PI / 2);
      this._atGeo.translate(0, 0, AT_H * 0.5);
      this._atPlateGeo = new THREE.CylinderGeometry(AT_R * 0.62, AT_R * 0.66, 0.022, 16, 1);
      this._atPlateGeo.rotateX(Math.PI / 2);
      this._atPlateGeo.translate(0, 0, AT_H + 0.011);
      this._atMat = new THREE.MeshStandardMaterial({
        color: 0x3e4432, roughness: 0.86, metalness: 0.22,
      });
      this._atPlateMat = new THREE.MeshStandardMaterial({
        color: 0x1a1c18, roughness: 0.7, metalness: 0.5,
      });
    }
    const grp = new THREE.Group();
    grp.name = 'atmine-laid';
    grp.matrixAutoUpdate = false;
    const body = new THREE.Mesh(this._atGeo, this._atMat);
    body.castShadow = true;
    body.receiveShadow = true;
    const plate = new THREE.Mesh(this._atPlateGeo, this._atPlateMat);
    plate.castShadow = true;
    grp.add(body, plate);
    return grp;
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * WHAT A MAN CAN SEE OF ONE — 「弾がどこからともなく飛んでくる」 is the failure this
   * engine is built not to have, and a buried mine is the closest thing to it
   * ══════════════════════════════════════════════════════════════════════════
   * A 330 mm disc lying on the ground of a night map is, honestly, invisible at
   * any range a tank matters at. So an ARMED mine carries a marker ring on the
   * ground round it — 300-345 mm, additive amber, flat, drawn once when it arms
   * and never touched again until it trips, when it blinks at the same 8 Hz off
   * the same game clock the tripwire's beam already uses.
   *
   * THE RING IS NOT TEAM-COLOURED, DELIBERATELY. Every threat colour in this
   * game is relative to `RULES.playerTeam` and painting one by raw team index
   * has shipped the wrong colour twice; the way not to ship it a third time is
   * not to paint by team at all. There is also nothing to express: an AT mine
   * cannot be set off by a man of EITHER side, so "whose is it" changes nothing
   * a man on foot can do about it. One colour, no index, no bug.
   *
   * AND IT DOES NOT BLINK, which the tripwire's beam does. Two reasons and the
   * second is the real one: `trigDelay` here is 0.25 s, which is one and a bit
   * blinks at the beam's 8 Hz and communicates nothing (the `mine_trip` voice
   * is the signal, and it is positional); and the material is SHARED by every
   * ring on the map — exactly as `_beamMat` is by every beam — so writing
   * `material.opacity` for one tripped mine would blink the whole minefield.
   * With one mine live that never showed. With twenty it would.
   */
  _drawRing(g) {
    let m = g.ring;
    if (!m) {
      if (!this._ringGeo) {
        this._ringGeo = new THREE.RingGeometry(AT_RING_IN, AT_RING_OUT, 30, 1);
        this._ringGeo.rotateX(-Math.PI / 2);
        this._ringMat = new THREE.MeshBasicMaterial({
          color: 0xffa02a,
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
      }
      m = new THREE.Mesh(this._ringGeo, this._ringMat);
      m.frustumCulled = false;
      m.userData.owNoShadow = true;
      m.userData.owNoPrepass = true;
      this.ctx.scene.add(m);
      g.ring = m;
    }
    m.visible = true;
    m.position.set(g.pos.x, g.pos.y + 0.03, g.pos.z);
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * THE PLATE — how a mine is found by a hull, and what it costs
   * ══════════════════════════════════════════════════════════════════════════
   * 「戦車が通ったら爆発」. The hard part of this feature was never the bang; it
   * is that a 330 mm object on the ground has to be found by a 6.9 m hull that
   * is posed along a baked centreline and is not simulated against anything.
   *
   * WHO ASKS WHOM. The hull asks. `Armour` calls this ONCE PER LIVE HULL PER
   * FRAME with its own footprint — the same rectangle `_shovePlayer` already
   * carries — and this file answers. The other direction (the mine looking for
   * tanks) would have had `weapons` reaching into `match`'s tank roster every
   * frame, which is a subsystem boundary this file does not cross for anything
   * else. The hull publishes its own geometry and nothing more.
   *
   * WHAT IT COSTS, and this is a count rather than an estimate.
   *   - `_armedN === 0` is one integer compare, and that is the whole cost for
   *     every match that has no mines in it and every second before the first
   *     one is laid.
   *   - Otherwise: one pass over `field` (32 slots, fixed), skipping any slot
   *     that is not live-and-armed on one boolean. For each ARMED mine: one
   *     team compare, two subtractions, four multiply-adds to put the mine in
   *     the hull's frame, and two absolute compares. About a dozen flops.
   *   - Six hulls x 20 armed mines is 120 of those a frame — roughly 1.4 k
   *     flops, no allocation, no raycast, no Map lookup and no broad phase.
   *     `stats.probes` counts the pairs so the figure is measured.
   * A grid or a hash was considered and rejected on arithmetic: at these counts
   * six hulls x nine cells of Map lookups is more work than 120 float compares,
   * and it would add an index to keep in step with a pool that already moves.
   *
   * NO TEAM KILLS ITS OWN ARMOUR. A plate laid by team 0 does not fire under a
   * team 0 hull. That is a game rule rather than physics and it is the same one
   * `RULES.friendlyFire` states everywhere else: without it, every hub on this
   * map is on the mining side's own half and three of a side's own hulls would
   * drive out over their own minefield in the first thirty seconds.
   *
   * @param {number} team  the hull's side.
   * @param {number} x,z   hull centre.
   * @param {number} sin,cos  sin/cos of the hull's yaw.
   * @param {number} halfW,halfL  the hull's plan rectangle.
   * @returns {number} mines tripped by this call — 0 on all but a few frames.
   */
  armourFootprint(team, x, z, sin, cos, halfW, halfL) {
    if (this._armedN === 0) return 0;
    let n = 0;
    for (let i = 0; i < this.field.length; i++) {
      const g = this.field[i];
      if (!g.live || !g.armed || g.tripped) continue;
      if (g.team === team) continue;
      this.stats.probes++;
      const pad = g.def?.trackWidth ?? 0;
      if (pad <= 0) continue;
      const ox = g.pos.x - x;
      const oz = g.pos.z - z;
      // Into the hull's own frame: +Z forward is (sin, cos), +X right is
      // (cos, -sin). The same transform `Armour._shovePlayer` makes.
      const along = ox * sin + oz * cos;
      if (along > halfL + pad || along < -halfL - pad) continue;
      const across = ox * cos - oz * sin;
      if (across > halfW + pad || across < -halfW - pad) continue;
      g.tripped = true;
      g.trig = g.def?.trigDelay ?? 0.25;
      this.stats.tripped++;
      this._trip(g);
      n++;
    }
    return n;
  }

  _retire(g) {
    g.live = false;
    g.armed = false;
    g.tripped = false;
    g.owner = null;
    g.team = -1;
    if (g.beam) {
      g.beam.visible = false;
      g.beam = null;
    }
    // The laid mesh and its ring STAY BOUND to the field slot — they are
    // reused by whatever is emplaced there next, exactly as the throw pool
    // reuses its proxies. Hidden, not discarded.
    if (g.mesh) g.mesh.visible = false;
    if (g.ring) g.ring.visible = false;
    if (g.body && this.physics?.removeRigidBody) this.physics.removeRigidBody(g.body);
    g.body = null;
    if (g.group) {
      g.group.visible = false;
      g.group.userData.free = true;
    }
    g.group = null;
  }

  /* ---------------------------------------------------------------- blast -- */

  _explode(position, def, owner = null) {
    const radius = def?.blastRadius ?? 7.5;
    const damage = def?.blastDamage ?? 165;
    const b = this._blast;
    /**
     * LIFTED OFF THE DECK, exactly as the C4 lifts its own charge (bomb.js:
     * `position.y + 0.2`). A grenade at rest has its centre 28 mm above the
     * floor, and a blast fired from there is a fireball half buried in the
     * ground AND — the part that actually broke — an occlusion ray that grazes
     * the floor triangle it is sitting on. Measured: the player 2.4 m away took
     * 85 damage and a bot at the same distance took none, because every ray to
     * a standing man's feet started inside the floor.
     */
    b.position.copy(position);
    b.position.y += 0.14;
    position = b.position;
    b.radius = radius;
    b.damage = 0;
    b.impulse = damage * 0.9;
    /**
     * WHAT ORDNANCE THIS IS, on the payload — `def.ordnance`, which only the
     * anti-tank mine carries. `Armour._takeBlast` already reads `kind` (a bot's
     * frag added the field for exactly this reason: to be recognised without
     * taking `source` and therefore the kill off the event) and it is the
     * channel the mine's armour multiplier is picked on. ASSIGNED EVERY TIME,
     * including to `null`: `_blast` is one reused object and a `kind` left over
     * from the last mine would make the next frag an anti-tank round.
     */
    b.kind = def?.ordnance ?? null;
    /**
     * …AND WHO LAID IT. A mine emplaced by a bot has to pay that bot for the
     * hull it kills — `Armour._takeBlast` hands a non-string `source` straight
     * to `_wound`, which is `lastHitBy` and therefore the killfeed and the 30
     * points. The player's own mines fall back to the string this event has
     * always carried, and `_takeBlast` credits him through `lastHitBy` the same
     * way the frag already does. `damage` is still 0 on this payload, so
     * carrying an actor here cannot wound anybody team-blind through `ai`'s own
     * listener — @see the note on `_blast.damage`.
     */
    b.source = owner ?? def?.ordnance ?? 'grenade';
    this.ctx.events.emit('explosion', b);
    this._damageActors(position, radius, damage, owner);
    this._damagePlayer(position, radius, damage);
    this.stats.detonated++;
  }

  /**
   * ACTORS, through `damage:dealt` rather than through the blast event.
   *
   * The actor set comes from `physics.colliders` — the AI's own per-part
   * hitboxes, each tagged with its `owner` — rather than from any list in
   * `ai`, so this reaches across exactly one documented boundary
   * (`addCollider({owner, part})`) and holds no opinion about how `ai` stores
   * its agents. Distance is measured to the nearest point on the hitbox
   * capsule, not to a root position, so a man behind a low wall with his head
   * over it is hit and a man lying at the same distance is not.
   *
   * Falloff is the C4's: quadratic on the normalised distance, occlusion by
   * `MASK.EXPLOSION` (the same mask `ai` and `player` test the C4 with, so a
   * wall stops a frag exactly as it stops the round-ending charge).
   */
  _damageActors(position, radius, damage, owner = null) {
    const phys = this.physics;
    if (!phys?.colliders) return;
    const ACTOR = phys.LAYER?.ACTOR ?? 0;
    const hits = this._hits;
    let n = 0;
    for (let i = 0; i < phys.colliders.length; i++) {
      const c = phys.colliders[i];
      if (!c.owner || (ACTOR && !(c.layer & ACTOR))) continue;
      if (c.owner.alive === false) continue;
      // Nearest point on this hitbox to the blast.
      this._nearest(c, position, this._pt);
      const d = this._pt.distanceTo(position);
      if (d > radius) continue;
      // The point the OCCLUSION ray aims at is the hitbox's own middle, not
      // its nearest surface: `ai` tests the blast against `a.eye` for the same
      // reason, and a ray aimed at a boot travels along the floor.
      this._mid(c, this._pt2);
      // One entry per ACTOR, keeping whichever hitbox is closest.
      let slot = -1;
      for (let k = 0; k < n; k++) if (hits[k].owner === c.owner) { slot = k; break; }
      if (slot < 0) {
        if (n >= hits.length) continue;
        slot = n++;
        hits[slot].owner = c.owner;
        hits[slot].d = Infinity;
      }
      if (d < hits[slot].d) {
        hits[slot].d = d;
        hits[slot].x = this._pt.x;
        hits[slot].y = this._pt.y;
        hits[slot].z = this._pt.z;
        hits[slot].mx = this._pt2.x;
        hits[slot].my = this._pt2.y;
        hits[slot].mz = this._pt2.z;
      }
    }
    /**
     * WHO DEALT IT. The player, unless a mine names its own man — `ai` gates
     * `damage:dealt` on `RULES.friendlyFire` using exactly this field, so a
     * bot's mine that goes off among his own side wounds nobody and the same
     * mine kills the other side's men.
     */
    const player = owner ?? this.ctx.peek('player') ?? 'player';
    for (let k = 0; k < n; k++) {
      const h = hits[k];
      this._pt.set(h.x, h.y, h.z);
      this._pt2.set(h.mx, h.my, h.mz);
      if (phys.lineOfSight && !phys.lineOfSight(position, this._pt2, phys.MASK.EXPLOSION)) continue;
      const f = 1 - h.d / radius;
      const p = this._dmg;
      p.target = h.owner;
      p.amount = damage * f * f;
      p.headshot = false;
      p.part = 'torso';
      p.killed = false;
      p.point.copy(this._pt);
      p.source = player;
      this.ctx.events.emit('damage:dealt', p);
    }
    for (let k = 0; k < n; k++) hits[k].owner = null;
  }

  /** Middle of a collider — the point an occlusion ray should aim at. */
  _mid(c, out) {
    if (c.shape === 'capsule') {
      return out.set((c.ax + c.bx) * 0.5, (c.ay + c.by) * 0.5, (c.az + c.bz) * 0.5);
    }
    return out.set(c.ax, c.ay, c.az);
  }

  /** Nearest point on a collider (capsule segment, sphere or box centre). */
  _nearest(c, from, out) {
    if (c.shape === 'capsule') {
      this._seg.set(c.bx - c.ax, c.by - c.ay, c.bz - c.az);
      const len2 = this._seg.lengthSq();
      let t = 0;
      if (len2 > 1e-9) {
        t = ((from.x - c.ax) * this._seg.x +
          (from.y - c.ay) * this._seg.y +
          (from.z - c.az) * this._seg.z) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
      }
      return out.set(c.ax + this._seg.x * t, c.ay + this._seg.y * t, c.az + this._seg.z * t);
    }
    return out.set(c.ax, c.ay, c.az);
  }

  /**
   * THE THROWER, through the player's own public damage entry point.
   *
   * The falloff is `player._onExplosion`'s (pow(1 - d/r, 1.6), gated on line of
   * sight) rather than the actors' quadratic, because that is what the C4 does
   * to the player and a frag must not be measured differently from the charge
   * it is standing next to. There is no friendly-fire test here: you are always
   * on your own side, and a grenade at your feet is your own fault.
   */
  _damagePlayer(position, radius, damage) {
    const player = this.ctx.peek('player');
    const phys = this.physics;
    if (!player?.applyDamage || player.dead) return;
    const eye = this.ctx.camera.position;
    const d = this._v.copy(position).distanceTo(eye);
    if (d > radius) return;
    if (phys?.lineOfSight && !phys.lineOfSight(position, eye, phys.MASK.EXPLOSION)) return;
    const f = Math.pow(Math.max(0, 1 - d / radius), 1.6);
    if (f <= 0.02) return;
    player.applyDamage(damage * f, position, { type: 'explosion' });
  }

  /* --------------------------------------------------------------- props -- */

  /**
   * A world-space copy of the viewmodel grenade, sharing its geometry and
   * materials — the same trick `_dropMagazine` uses for a discarded magazine.
   * The pool is built on the first throw and reused for the rest of the match;
   * nothing here allocates once it is warm.
   */
  _proxy(meshes, kind = 'frag') {
    /**
     * KEYED BY KIND, and it has to be: the pool was built from whichever
     * weapon threw first and handed back regardless, so a smoke can thrown
     * after a frag was a FRAG flying through the air. There are four things in
     * the pouch now and they are four different objects.
     */
    for (const p of this._proxies) {
      if (p.userData.free && p.userData.kind === kind) { p.userData.free = false; return p; }
    }
    if (!meshes || this._proxies.length >= MAX_LIVE * 2) return null;
    const group = new THREE.Object3D();
    group.userData.kind = kind;
    group.name = `thrown-${kind}-${this._proxies.length}`;
    group.visible = false;
    group.userData.free = false;
    for (const o of meshes) {
      if (!o.isMesh) continue;
      const m = new THREE.Mesh(o.geometry, o.material);
      m.position.copy(o.position);
      m.quaternion.copy(o.quaternion);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    this.ctx.scene.add(group);
    this._proxies.push(group);
    return group;
  }

  /**
   * EVERYTHING IN THE AIR — and NOT the minefield, which is the whole point of
   * the two methods.
   *
   * `WeaponSystem.resetAmmo` calls this, and `match` calls THAT ON EVERY
   * PLAYER RESPAWN as well as at the round boundary ("as if you had just
   * walked out of spawn"). That was right when this pool held nothing but the
   * six things the player could have in the air; it is catastrophically wrong
   * for a minefield, because the field is mostly OTHER PEOPLE'S mines and the
   * player dying would sweep both sides' anti-armour off the map. Caught by
   * reading the call sites rather than by a probe, which would have shown it
   * as "the mines are gone" long after the cause.
   */
  clear() {
    for (const g of this.pool) if (g.live) this._retire(g);
  }

  /**
   * …AND THE GROUND. A ROUND boundary only: a minefield that survived one
   * would be the last round's mines under this round's armour. `Armour.reset`
   * is the caller, because that is the method `match` already runs exactly
   * once per round to put the hulls back in their pockets.
   */
  clearMines() {
    for (const g of this.field) if (g.live) this._retire(g);
    this._armedN = 0;
    this.stats.armed = 0;
  }

  dispose() {
    this.clear();
    this.clearMines();
    for (const p of this._proxies) p.removeFromParent();
    this._proxies.length = 0;
    for (const b of this._beams) b.removeFromParent();
    this._beams.length = 0;
    for (const f of this.field) {
      f.mesh?.removeFromParent();
      f.ring?.removeFromParent();
      f.mesh = null;
      f.ring = null;
    }
    this._atGeo?.dispose();
    this._atPlateGeo?.dispose();
    this._atMat?.dispose();
    this._atPlateMat?.dispose();
    this._ringGeo?.dispose();
    this._ringMat?.dispose();
    this._atGeo = null;
    this._atPlateGeo = null;
    this._atMat = null;
    this._atPlateMat = null;
    this._ringGeo = null;
    this._ringMat = null;
    this._beamGeo?.dispose();
    this._beamMat?.dispose();
    this._beamGeo = null;
    this._beamMat = null;
  }
}
