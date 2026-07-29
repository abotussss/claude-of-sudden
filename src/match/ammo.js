/**
 * MATCH — ammunition left on the bodies.
 *
 * "弾は補充できるようにして、つまり倒した敵からスカベンジャーで球を補充できる
 * 仕組みにして" — a five minute round with respawns is long enough to run a
 * rifle dry twice over, and the mode had exactly one source of ammunition:
 * `weapons.resetAmmo()` at the top of the round. So a man who goes down leaves
 * his pouches where he fell and anyone can take them.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE DECISIONS, AND WHY THEY WENT THIS WAY
 * ────────────────────────────────────────────────────────────────────────────
 * PROXIMITY, NOT A KEY. Call of Duty's Scavenger perk — the thing the request
 * names — is walk-over-it, and this is too: 1.7 m, no prompt, no button. The
 * alternative was the `use` key, and `use` is already HELD for the two things
 * that decide the round (plant, defuse) and TAPPED for a third (picking the
 * charge back up). Overloading it a fourth time means the player who taps F on
 * a body next to the C4 finds out which one the code preferred; and a firefight
 * is not a moment anybody has a spare finger. The pickup is silent about
 * itself except when it actually gives you something.
 *
 * IT ONLY TRIGGERS WHEN IT IS WORTH SOMETHING. `weapons.needsAmmo` gates it, so
 * walking over a body with full pouches leaves the pouch on the floor for the
 * team-mate who does need it, rather than deleting it for nothing.
 *
 * EVERY BODY, NOT JUST ENEMIES. A dead man's magazines are a dead man's
 * magazines. Restricting it to men the player personally killed would make it
 * useless in a 15v15 — the overwhelming majority of the thirty bodies a round
 * produces are killed by somebody else — and would put a rule on the floor that
 * nothing in the world tells the player about.
 *
 * BOTS DO NOT USE IT, AND THAT IS A FACT ABOUT `src/ai`, NOT A SHORTCUT.
 * `Agent._fire` reloads with `this.ammo = this.magSize` and keeps no reserve at
 * all (src/ai/agent.js) — a bot has infinite magazines by construction, so
 * there is nothing a pouch could give it. Giving bots a reserve is an `src/ai`
 * change and `src/ai` is not this subsystem's to write. If it ever grows one,
 * this file already carries the pickup radius and the pool: `takeBy()` is
 * written to take any actor with a `position`.
 *
 * COST. One geometry, two materials, `POOL` meshes built at boot and reused for
 * ever. Nothing is allocated after `init`, and a drop that nobody takes is
 * recycled after `LIFE` seconds so a five minute round cannot bury the street.
 */

import * as THREE from 'three';
import { mergeAll } from './bomb.js';

/** Live drops on the map at once. The oldest is recycled when this is hit. */
const POOL = 16;
/** Seconds a pouch stays takeable. Long enough to fight over, short enough to clear. */
const LIFE = 45;
/** Metres. Generous — you are running, and a pouch you have to stop on is a pouch you miss. */
const RADIUS = 1.7;
/** Magazines per weapon per pouch. @see WeaponSystem.scavenge */
const MAGS = 1;

export class AmmoDrops {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'match-ammo-drops';
    this._build();
    ctx.scene.add(this.group);

    /** Preallocated slots. `t` < 0 means free. */
    this.slots = new Array(POOL);
    for (let i = 0; i < POOL; i++) {
      const mesh = new THREE.Mesh(this.geo, this.mat);
      const tag = new THREE.Mesh(this.tagGeo, this.tagMat);
      mesh.add(tag);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      tag.castShadow = false;
      mesh.visible = false;
      this.group.add(mesh);
      this.slots[i] = { mesh, t: -1, spin: 0, y: 0 };
    }
    this._next = 0;
    this._v = new THREE.Vector3();
    this.taken = 0;
    this.dropped = 0;
  }

  /* ------------------------------------------------------------ geometry -- */

  /**
   * A canvas chest rig: three magazine pouches side by side under a flap, with
   * a strip of tape across the flap so it reads as *kit* at ten metres rather
   * than as a crate. 26 cm across — the same "placed object, not a prop" scale
   * the C4 is built at.
   */
  _build() {
    const geos = [];
    const push = (g, x, y, z, rz = 0) => {
      if (rz) g.rotateZ(rz);
      g.translate(x, y, z);
      geos.push(g);
    };
    for (let i = 0; i < 3; i++) {
      push(new THREE.BoxGeometry(0.062, 0.098, 0.13), -0.075 + i * 0.075, 0.05, 0, (i - 1) * 0.05);
    }
    // the flap over the tops, sagging forward
    push(new THREE.BoxGeometry(0.235, 0.014, 0.088), 0, 0.104, 0.026);
    // the webbing the whole rig hangs off
    push(new THREE.BoxGeometry(0.255, 0.02, 0.03), 0, 0.03, -0.052);
    this.geo = mergeAll(geos);

    this.tagGeo = new THREE.BoxGeometry(0.086, 0.004, 0.02);
    this.tagGeo.translate(0.055, 0.113, 0.03);

    this.mat = new THREE.MeshStandardMaterial({
      color: 0x5d5a44,
      roughness: 0.92,
      metalness: 0.02,
    });
    /**
     * The only bright thing on it. A pouch on dirt at dusk is the same value as
     * the dirt (the ground bakes at roughly 0.09 albedo — see the camo note in
     * src/match/index.js), so without one deliberately readable strip the drop
     * is invisible exactly when the player needs it. It is a strip of marker
     * tape, not a glowing pickup: `emissiveIntensity` is low enough that it
     * reads as lit tape in daylight and as a glint in shadow.
     */
    this.tagMat = new THREE.MeshStandardMaterial({
      color: 0xd8b038,
      roughness: 0.55,
      metalness: 0,
      emissive: 0xffb02a,
      emissiveIntensity: 0.85,
    });
  }

  /** Materials, so `match` can hand them to the render patcher like the C4's. */
  get materials() {
    return [this.mat, this.tagMat];
  }

  /* ----------------------------------------------------------- lifecycle -- */

  /**
   * Leave a pouch where somebody fell.
   *
   * @param {THREE.Vector3} position where the body is
   * @param {number} groundY floor height under it, from `ai.groundAt`
   */
  drop(position, groundY) {
    if (!position) return null;
    let slot = null;
    for (let i = 0; i < POOL; i++) {
      const s = this.slots[(this._next + i) % POOL];
      if (s.t < 0) {
        slot = s;
        this._next = (this._next + i + 1) % POOL;
        break;
      }
    }
    if (!slot) {
      // Everything is in use: recycle the one that has been lying there longest.
      let oldest = this.slots[0];
      for (const s of this.slots) if (s.t > oldest.t) oldest = s;
      slot = oldest;
    }
    slot.t = 0;
    slot.spin = 0;
    slot.y = Number.isFinite(groundY) ? groundY : position.y;
    slot.mesh.position.set(position.x, slot.y + 0.02, position.z);
    slot.mesh.rotation.set(0, 0, 0);
    slot.mesh.scale.setScalar(1);
    slot.mesh.visible = true;
    this.dropped++;
    return slot;
  }

  /** Everything off the map — a new round starts with a clean street. */
  clear() {
    for (const s of this.slots) {
      s.t = -1;
      s.mesh.visible = false;
    }
    this._next = 0;
  }

  /* --------------------------------------------------------------- frame -- */

  /**
   * Age the drops and let `taker` walk into one.
   *
   * @param {number} dt
   * @param {object|null} taker anything with `.position` — the local player
   * @param {object|null} weapons the weapon system that owns the reserve
   * @returns {number} rounds handed over this frame, 0 for nothing
   */
  update(dt, taker, weapons) {
    let added = 0;
    const canTake = !!taker && !!weapons && weapons.needsAmmo === true;
    const p = taker?.position ?? null;
    for (const s of this.slots) {
      if (s.t < 0) continue;
      s.t += dt;
      if (s.t >= LIFE) {
        s.t = -1;
        s.mesh.visible = false;
        continue;
      }
      // A slow turn so a pouch catches the light at some point in its life, and
      // a shrink over the last moment so it leaves rather than blinking out.
      s.spin += dt * 0.55;
      s.mesh.rotation.y = s.spin;
      const fade = LIFE - s.t;
      s.mesh.scale.setScalar(fade < 0.7 ? Math.max(0.001, fade / 0.7) : 1);

      if (!canTake || added > 0) continue;
      const dx = p.x - s.mesh.position.x;
      const dz = p.z - s.mesh.position.z;
      const dy = p.y - s.y;
      if (dx * dx + dz * dz > RADIUS * RADIUS || dy < -1.2 || dy > 2.4) continue;
      const got = weapons.scavenge(MAGS);
      if (got <= 0) continue;
      added = got;
      s.t = -1;
      s.mesh.visible = false;
      this.taken++;
    }
    return added;
  }

  /** How many drops are on the map right now — for the harnesses. */
  get liveCount() {
    let n = 0;
    for (const s of this.slots) if (s.t >= 0) n++;
    return n;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.geo?.dispose();
    this.tagGeo?.dispose();
    this.mat?.dispose();
    this.tagMat?.dispose();
  }
}
