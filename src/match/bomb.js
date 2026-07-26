/**
 * MATCH — the C4.
 *
 * One object, five states, and the whole mode hangs off it:
 *
 *   carried    an attacker has it. Invisible; the carrier's own HUD says so.
 *   dropped    the carrier died. Lying on the floor, pickup-able by attackers.
 *   planted    armed on a site. The round clock stops mattering; this fuse is
 *              the only clock left.
 *   defused    a defender got to it in time.
 *   detonated  it did not.
 *
 * The charge itself is built here from boxes and a lathe, like everything else
 * in this repo — no models, no textures loaded from disk. The blink rate is
 * driven from the fuse so the LED reads as "nearly out of time" without the
 * player having to look at the HUD, and the beep rides the same schedule.
 */

import * as THREE from 'three';
import { RULES } from './rules.js';

export const BOMB = {
  CARRIED: 'carried',
  DROPPED: 'dropped',
  PLANTED: 'planted',
  DEFUSED: 'defused',
  DETONATED: 'detonated',
};

export class Bomb {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = BOMB.CARRIED;
    /** The player system or an Agent. Null once planted or dropped. */
    this.carrier = null;
    this.site = null;
    this.position = new THREE.Vector3();
    this.fuse = RULES.bombTime;
    /** 0..1 while somebody is working on it, for the HUD ring. */
    this.progress = 0;
    /** The actor currently planting/defusing, so two people cannot share a bar. */
    this.worker = null;
    this.workKind = null;

    this._blink = 0;
    this._beepAt = 0;
    /**
     * A round can be decided while the charge is still armed — everyone
     * defending dies, the attack wins, and the fuse is now irrelevant. Freezing
     * it stops a blast going off over the scoreboard.
     */
    this.frozen = false;
    this._v = new THREE.Vector3();

    this.group = new THREE.Group();
    this.group.name = 'match-c4';
    this.group.visible = false;
    this._build();
    ctx.scene.add(this.group);
  }

  /* ------------------------------------------------------------ geometry -- */

  /**
   * A satchel charge: four wrapped blocks under a strap, a moulded fascia with a
   * keypad, and one red status LED. Small — 24 cm across — because it has to
   * read as a *placed object* on a market street, not as a prop.
   */
  _build() {
    const geos = [];
    const push = (g, x, y, z, rx = 0, ry = 0, rz = 0) => {
      g.rotateX(rx);
      g.rotateY(ry);
      g.rotateZ(rz);
      g.translate(x, y, z);
      geos.push(g);
      return g;
    };

    // four demolition blocks, side by side, slightly uneven
    for (let i = 0; i < 4; i++) {
      const w = 0.052 + (i % 2) * 0.004;
      push(new THREE.BoxGeometry(w, 0.062, 0.185), -0.084 + i * 0.056, 0.031, 0, 0, (i - 1.5) * 0.012);
    }
    // the strap over the top, and the buckle
    push(new THREE.BoxGeometry(0.235, 0.008, 0.036), 0, 0.066, 0.03);
    push(new THREE.BoxGeometry(0.235, 0.008, 0.036), 0, 0.066, -0.03);
    this.bodyGeo = mergeAll(geos);

    const faceGeos = [];
    // the fascia and its keypad
    faceGeos.push(withTransform(new THREE.BoxGeometry(0.086, 0.03, 0.062), 0.052, 0.078, 0));
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        faceGeos.push(
          withTransform(new THREE.BoxGeometry(0.016, 0.004, 0.013), 0.028 + c * 0.024, 0.094, -0.016 + r * 0.03)
        );
      }
    }
    // the detonator wire, sagging back to the blocks
    const wire = new THREE.TorusGeometry(0.05, 0.0035, 5, 14, Math.PI * 1.1);
    wire.rotateY(Math.PI * 0.5);
    wire.translate(-0.02, 0.072, 0.0);
    faceGeos.push(wire);
    this.faceGeo = mergeAll(faceGeos);

    this.ledGeo = new THREE.SphereGeometry(0.0085, 10, 8);
    this.ledGeo.translate(0.052, 0.096, 0.032);

    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0x4a4b3c,
      roughness: 0.84,
      metalness: 0.02,
    });
    this.faceMat = new THREE.MeshStandardMaterial({
      color: 0x1b1d1e,
      roughness: 0.46,
      metalness: 0.15,
    });
    this.ledMat = new THREE.MeshStandardMaterial({
      color: 0x2a0604,
      roughness: 0.3,
      metalness: 0,
      emissive: 0xff2a18,
      emissiveIntensity: 0,
    });

    this.body = new THREE.Mesh(this.bodyGeo, this.bodyMat);
    this.face = new THREE.Mesh(this.faceGeo, this.faceMat);
    this.led = new THREE.Mesh(this.ledGeo, this.ledMat);
    for (const m of [this.body, this.face, this.led]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    this.led.castShadow = false;
  }

  /** Materials, for `MatchSystem.prewarmMaterials()`. */
  get materials() {
    return [this.bodyMat, this.faceMat, this.ledMat];
  }

  /* ------------------------------------------------------------ lifecycle -- */

  /** Back to the top of a round: nobody has it, nothing is armed. */
  reset() {
    this.state = BOMB.CARRIED;
    this.carrier = null;
    this.site = null;
    this.fuse = RULES.bombTime;
    this.progress = 0;
    this.worker = null;
    this.workKind = null;
    this.frozen = false;
    this._blink = 0;
    this._beepAt = 0;
    this.group.visible = false;
  }

  giveTo(actor) {
    this.state = BOMB.CARRIED;
    this.carrier = actor;
    this.group.visible = false;
    this.progress = 0;
    this.worker = null;
  }

  /** The carrier went down. The charge lands where they fell. */
  drop(position) {
    this.state = BOMB.DROPPED;
    this.carrier = null;
    this.progress = 0;
    this.worker = null;
    if (position) this.position.copy(position);
    this.group.position.copy(this.position);
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
  }

  /** Armed on `site`, at `position`, with a full fuse. */
  plant(site, position, yaw = 0) {
    this.state = BOMB.PLANTED;
    this.carrier = null;
    this.site = site;
    this.fuse = RULES.bombTime;
    this.progress = 0;
    this.worker = null;
    this.position.copy(position);
    this.group.position.copy(this.position);
    this.group.rotation.set(0, yaw, 0);
    this.group.visible = true;
  }

  defused() {
    this.state = BOMB.DEFUSED;
    this.progress = 0;
    this.worker = null;
    this.ledMat.emissiveIntensity = 0;
  }

  /** Fires the blast through the canonical `explosion` event and goes dark. */
  detonate() {
    if (this.state !== BOMB.PLANTED) return;
    this.state = BOMB.DETONATED;
    this.progress = 0;
    this.worker = null;
    this.ledMat.emissiveIntensity = 0;
    this.group.visible = false;
    this.ctx.events.emit('explosion', {
      position: this._v.copy(this.position).setY(this.position.y + 0.2),
      radius: RULES.blastRadius,
      damage: RULES.blastDamage,
      source: 'c4',
    });
  }

  get armed() {
    return this.state === BOMB.PLANTED;
  }

  get loose() {
    return this.state === BOMB.DROPPED;
  }

  /** Where the charge is right now, whoever has it. Writes into `out`. */
  worldPosition(out) {
    if (this.state === BOMB.CARRIED && this.carrier) {
      const p = this.carrier.position;
      if (p) return out.set(p.x, p.y + 0.9, p.z);
    }
    return out.copy(this.position);
  }

  /* ---------------------------------------------------------------- frame -- */

  /**
   * @returns {'detonate'|null} 'detonate' on the frame the fuse runs out, so the
   *   caller owns the round transition rather than this object guessing at it.
   */
  update(dt, audio) {
    if (this.state !== BOMB.PLANTED) {
      if (this.state === BOMB.DROPPED) {
        // A slow pulse so a dropped charge is findable in a dark alley.
        this._blink += dt * 1.1;
        this.ledMat.emissiveIntensity = 0.4 + 0.6 * Math.max(0, Math.sin(this._blink * Math.PI * 2));
      }
      return null;
    }

    if (this.frozen) return null;

    this.fuse -= dt;
    if (this.fuse <= 0) {
      this.fuse = 0;
      this.detonate();
      return 'detonate';
    }

    // Blink and beep accelerate as the fuse burns: 1 Hz at 40 s, ~7 Hz at the end.
    const t = 1 - this.fuse / RULES.bombTime;
    const hz = 1 + t * t * 6.2;
    this._blink += dt * hz;
    const phase = this._blink % 1;
    this.ledMat.emissiveIntensity = phase < 0.42 ? 5.5 + 5 * (1 - t) : 0.12;

    if (this._blink >= this._beepAt) {
      this._beepAt = Math.floor(this._blink) + 1;
      // 'hit_armour' is the bank's short metallic tick — the closest thing the
      // synth has to a detonator beep, and it costs no new audio code.
      try {
        audio?.play?.('hit_armour', this.position, { level: 0.5 + 0.5 * t });
      } catch {
        /* audio is optional feedback */
      }
    }
    return null;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.bodyGeo?.dispose();
    this.faceGeo?.dispose();
    this.ledGeo?.dispose();
    for (const m of this.materials) m?.dispose();
  }
}

/* ------------------------------------------------------------------------- */

function withTransform(g, x, y, z) {
  g.translate(x, y, z);
  return g;
}

/**
 * Merge a list of BufferGeometries that all carry position/normal/uv. Written
 * here rather than imported from `world` because a subsystem never imports
 * another subsystem's module (ARCHITECTURE.md rule 2), and BufferGeometryUtils
 * would be a second entry point into three's addons.
 */
function mergeAll(list) {
  let vtx = 0;
  let idx = 0;
  for (const g of list) {
    vtx += g.attributes.position.count;
    idx += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vtx * 3);
  const nrm = new Float32Array(vtx * 3);
  const uv = new Float32Array(vtx * 2);
  const ind = new Uint32Array(idx);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const t = g.attributes.uv;
    pos.set(p.array, vo * 3);
    if (n) nrm.set(n.array, vo * 3);
    if (t) uv.set(t.array, vo * 2);
    if (g.index) {
      const a = g.index.array;
      for (let i = 0; i < a.length; i++) ind[io++] = a[i] + vo;
    } else {
      for (let i = 0; i < p.count; i++) ind[io++] = i + vo;
    }
    vo += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(ind, 1));
  out.computeBoundingSphere();
  return out;
}
