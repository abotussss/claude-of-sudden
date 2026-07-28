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
    g.pos.copy(pos);
    g.group = this._proxy(meshes);
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
    this._explode(position, def);
  }

  update(dt) {
    let live = 0;
    for (const g of this.pool) {
      if (!g.live) continue;
      live++;
      g.fuse -= dt;
      if (g.body) g.pos.copy(g.body.position);
      if (g.fuse > 0) continue;
      this._retire(g);
      this._explode(g.pos, g.def);
    }
    this.stats.live = live;
  }

  _retire(g) {
    g.live = false;
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
  _proxy(meshes) {
    for (const p of this._proxies) if (p.userData.free) { p.userData.free = false; return p; }
    if (!meshes || this._proxies.length >= MAX_LIVE) return null;
    const group = new THREE.Object3D();
    group.name = `thrown-grenade-${this._proxies.length}`;
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
  }
}
