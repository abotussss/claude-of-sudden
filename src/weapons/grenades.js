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
  }
}

export class ThrownGrenades {
  constructor(ctx) {
    this.ctx = ctx;
    this.pool = [];
    for (let i = 0; i < MAX_LIVE; i++) this.pool.push(new Thrown());
    this._proxies = [];
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._seg = new THREE.Vector3();
    this._pt = new THREE.Vector3();
    this._pt2 = new THREE.Vector3();
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
    };
    this._dmg = {
      target: null, amount: 0, headshot: false, part: 'torso',
      killed: false, point: new THREE.Vector3(), source: null,
    };
    /** Beam meshes, one per mine slot, built lazily and reused. @see _drawBeam. */
    this._beams = [];
    this._beamGeo = null;
    this._beamMat = null;
    /** Distinct actors found inside one blast. Preallocated; never grows. */
    this._hits = [];
    for (let i = 0; i < 24; i++) {
      this._hits.push({ owner: null, d: 0, x: 0, y: 0, z: 0, mx: 0, my: 0, mz: 0 });
    }
    this.stats = { thrown: 0, detonated: 0, live: 0 };
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
  spawn(pos, vel, fuse, def, meshes) {
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
    g.beep = 0;
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
  _detonate(position, def) {
    switch (def?.throwKind) {
      case 'flash': return this._flash(position, def);
      case 'smoke': return this._smoke(position, def);
      // A mine is a frag with a longer story; when it finally goes off it goes
      // off exactly like one.
      default: return this._explode(position, def);
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
    const rad = def.smokeRadius ?? 6.5;
    this._v.copy(position);
    this._v.y += 0.1;
    fx?.addSmokeSource?.(this._v, {
      duration: dur,
      // A smoke can is a firehose, not a chimney: many puffs a second, wide,
      // rising slowly, pale rather than sooty, and living long enough that the
      // cloud is a wall instead of a plume.
      rate: 26,
      radius: rad * 0.22,
      rise: 0.85,
      dark: 0.04,
      life: 7.5,
      growth: rad * 0.9,
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
      this._retire(g);
      this._detonate(g.pos, g.def);
    }
    this.stats.live = live;
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
   */
  _updateMine(g, dt) {
    const phys = this.physics;
    if (!g.armed) {
      g.fuse -= dt;
      if (g.fuse > 0) return;
      g.armed = true;
      // Settle the beam along whatever direction the mine came to rest facing.
      if (g.body?.quaternion) g.dir.set(0, 0, 1).applyQuaternion(g.body.quaternion);
      else g.dir.set(0, 0, 1);
      g.dir.y = 0;
      if (g.dir.lengthSq() < 1e-6) g.dir.set(0, 0, 1);
      g.dir.normalize();
      // A click as it arms — the same mechanical voice a dry trigger makes.
      this.ctx.peek('audio')?.play?.('dryfire', g.pos, { level: 0.5 });
      return;
    }

    if (g.tripped) {
      g.trig -= dt;
      this._drawBeam(g, true);
      if (g.trig > 0) return;
      this._retire(g);
      this._detonate(g.pos, g.def);
      return;
    }

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
   * `audio` has no dedicated alarm voice — the bank is gunfire, impacts,
   * footsteps and explosions — so this uses `dryfire`, which is a hard
   * mechanical CLICK, played loud and twice: a striker falling is exactly what
   * a mine tripping sounds like, and it is unmistakable against a firefight.
   * A dedicated rising `beep` would be better and is named in the report.
   */
  _trip(g) {
    const audio = this.ctx.peek('audio');
    audio?.play?.('dryfire', g.pos, { level: 1.0 });
    // A second click 180 ms later: one click is a reload somewhere, two is a
    // signal. Queued on the mine rather than scheduled, so nothing allocates.
    g.beep = 0.18;
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
      if (g.beep > 0) {
        g.beep -= this.ctx.time.delta ?? 0.016;
        if (g.beep <= 0) this.ctx.peek('audio')?.play?.('dryfire', g.pos, { level: 1.0 });
      }
    }
  }

  _retire(g) {
    g.live = false;
    g.armed = false;
    g.tripped = false;
    if (g.beam) {
      g.beam.visible = false;
      g.beam = null;
    }
    if (g.body && this.physics?.removeRigidBody) this.physics.removeRigidBody(g.body);
    g.body = null;
    if (g.group) {
      g.group.visible = false;
      g.group.userData.free = true;
    }
    g.group = null;
  }

  /* ---------------------------------------------------------------- blast -- */

  _explode(position, def) {
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
    this.ctx.events.emit('explosion', b);
    this._damageActors(position, radius, damage);
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
  _damageActors(position, radius, damage) {
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
    const player = this.ctx.peek('player') ?? 'player';
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

  clear() {
    for (const g of this.pool) if (g.live) this._retire(g);
  }

  dispose() {
    this.clear();
    for (const p of this._proxies) p.removeFromParent();
    this._proxies.length = 0;
    for (const b of this._beams) b.removeFromParent();
    this._beams.length = 0;
    this._beamGeo?.dispose();
    this._beamMat?.dispose();
    this._beamGeo = null;
    this._beamMat = null;
  }
}
