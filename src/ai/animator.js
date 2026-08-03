/**
 * AI — the animation runtime: a small layered blend tree plus the three IK
 * solvers that make an armed character believable.
 *
 * LAYERS, in evaluation order
 *   1  locomotion base      idle / walk / run / crouch-walk / crouch-idle,
 *                           crossfaded, phase driven by real ground speed so
 *                           the feet never skate
 *   2  additive             aim, suppression flinch, reload body language,
 *                           firing recoil, per-region hit reactions
 *   3  one-shots            turn-in-place, vault (override weight ramps)
 *
 * IK, after the pose is written to the bones
 *   A  aim      — the spine chain is rotated until the weapon's bore points at
 *                 the aim target; the residual is spread over Spine1/Spine2 and
 *                 clamped, so the AI has to physically turn to cover a wide arc
 *   B  look-at  — neck and head lead the aim, clamped to human limits
 *   C  arm      — two-bone solve puts the support hand back on the handguard
 *                 (or on the magazine during a reload) after the spine moved
 *   D  foot     — ground probe per foot, pelvis drops to keep both feet
 *                 planted, two-bone solve per leg, sole aligned to the normal
 *
 * Everything is preallocated: `update()` does not allocate.
 */

import * as THREE from 'three';
import * as C from './clips.js';
import { BORE_DIR } from './rig.js';

const DEG = Math.PI / 180;

/** Pose accumulator handed to clip functions. */
class Poser {
  constructor(rig) {
    this.rig = rig;
    this.d3 = new Float32Array(rig.count * 3);
    this.hipOff = new THREE.Vector3();
    this.w = 1;
    /**
     * Locomotion clips do not pose the legs with euler deltas — they write the
     * ankle's PATH, in the actor's own frame, and the leg IK reaches for it (see
     * the header of clips.js). Accumulated weighted, exactly like `d3`, so a
     * walk/run crossfade blends two foot paths rather than snapping between
     * them. `w[k] == 0` means no clip claimed that foot this frame and the FK
     * pose owns it, which is what idle, crouch-idle and the hurt stance want.
     */
    this.footT = new Float32Array(6); // R xyz, L xyz — actor-local metres
    this.footW = new Float32Array(2); // how much of the foot the path owns
    this.footPlant = new Float32Array(2); // 1 = down this frame
    this.footPitch = new Float32Array(2); // sole pitch, degrees, toe-down +
    // name -> index cache for the clip helpers
    this._idx = new Map();
    for (let i = 0; i < rig.count; i++) this._idx.set(rig.names[i], i);
  }

  reset() {
    this.d3.fill(0);
    this.hipOff.set(0, 0, 0);
    this.footT.fill(0);
    this.footW.fill(0);
    this.footPlant.fill(0);
    this.footPitch.fill(0);
    this.w = 1;
  }

  /** @param k 0 = right, 1 = left. `y` is height above the ground, not above 0. */
  footPath(k, x, y, z, plant, pitch) {
    const w = this.w;
    this.footT[k * 3] += x * w;
    this.footT[k * 3 + 1] += y * w;
    this.footT[k * 3 + 2] += z * w;
    this.footW[k] += w;
    this.footPlant[k] += plant * w;
    this.footPitch[k] += pitch * w;
  }

  /** additive euler delta in degrees */
  d(name, x, y, z) {
    const i = this._idx.get(name);
    if (i === undefined) return;
    const w = this.w;
    this.d3[i * 3] += x * w;
    this.d3[i * 3 + 1] += y * w;
    this.d3[i * 3 + 2] += z * w;
  }

  hip(dx, dy, dz) {
    const w = this.w;
    this.hipOff.x += dx * w;
    this.hipOff.y += dy * w;
    this.hipOff.z += dz * w;
  }
}

export class Animator {
  /**
   * @param rig    the shared Rig
   * @param bones  this instance's THREE.Bone array (same order as the rig)
   * @param opts   { weapon, rng, probe, scale }
   */
  constructor(rig, bones, opts = {}) {
    this.rig = rig;
    this.bones = bones;
    this.weapon = opts.weapon ?? null;
    this.rng = opts.rng ?? null;
    this.probe = opts.probe ?? null;
    this.scale = opts.scale ?? 1;
    this.enabled = true;

    this.P = new Poser(rig);

    this.state = {
      clip: 'idle',
      speed: 0,
      crouch: false,
      aimTarget: null,
      lookTarget: null,
      aimWeight: 1,
      suppress: 0,
      hurt: 0,
    };

    this.phase = 0;
    this.prevClip = 'idle';
    this.blend = 1; // weight of the current clip vs the previous one
    this.time = 0;

    // one-shot timers (negative = inactive)
    this.recoilT = -1;
    this.recoilK = 1;
    this.hitT = -1;
    this.hitRegion = 'torso';
    this.hitSide = 1;
    this.hitK = 1;
    this.reloadT = -1;
    this.reloadDur = 2.4;
    this.vaultT = -1;
    this.vaultDur = 0.85;
    this.turnT = -1;
    this.turnDir = 1;
    this.footIk = true;

    /* ---- indices we touch often ---- */
    this.iHips = rig.index('Hips');
    this.iSpine = rig.index('Spine');
    this.iSpine1 = rig.index('Spine1');
    this.iSpine2 = rig.index('Spine2');
    this.iNeck = rig.index('Neck');
    this.iHead = rig.index('Head');
    this.iHandR = rig.index('HandR');
    this.armL = [rig.index('UpperArmL'), rig.index('ForearmL'), rig.index('HandL')];
    this.armR = [rig.index('UpperArmR'), rig.index('ForearmR'), rig.index('HandR')];
    this.legs = [
      [rig.index('UpLegR'), rig.index('LegR'), rig.index('FootR')],
      [rig.index('UpLegL'), rig.index('LegL'), rig.index('FootL')],
    ];

    /* ---- weapon anchors, expressed in HandR bind-local space ---- */
    const qInv = rig.bindQuat[this.iHandR].clone().invert();
    const handPos = rig.bindPos[this.iHandR];
    const toLocal = (p) =>
      new THREE.Vector3(p[0] - handPos.x, p[1] - handPos.y, p[2] - handPos.z).applyQuaternion(qInv);
    this.boreLocal = new THREE.Vector3(...BORE_DIR).applyQuaternion(qInv).normalize();
    this.muzzleLocal = this.weapon ? toLocal(this.weapon.muzzle) : new THREE.Vector3(0, 0, 0.4);
    this.foregripLocal = this.weapon ? toLocal(this.weapon.foregrip) : new THREE.Vector3(0, 0, 0.2);
    this.magLocal = this.weapon ? toLocal(this.weapon.magBottom) : new THREE.Vector3(0, -0.2, 0);
    this.ejectLocal = this.weapon ? toLocal(this.weapon.ejection) : new THREE.Vector3(0, 0, 0);

    /* ---- scratch ---- */
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._q3 = new THREE.Quaternion();
    this._qa = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
    this._qc = new THREE.Quaternion();
    this._qd = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._v4 = new THREE.Vector3();
    this._v5 = new THREE.Vector3();
    this._pole = new THREE.Vector3();
    this._elbow = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._probeOut = { y: 0, nx: 0, ny: 1, nz: 0, hit: false };
    this._footY = [0, 0];
    this._footN = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)];
    this._clipCtx = { stride: 0, cycle: 1, speed: 0 };
    this._footWorld = [new THREE.Vector3(), new THREE.Vector3()];
    this._footPathW = [0, 0];
    this._footPlant = [0, 0];
    this._footPitch = [0, 0];
    this._v6 = new THREE.Vector3();
    this._v7 = new THREE.Vector3();
    this._qe = new THREE.Quaternion();
    /** Hip -> ankle at full extension: the reach the pelvis has to respect. */
    this._legReach =
      rig.bindPos[rig.index('UpLegR')].distanceTo(rig.bindPos[rig.index('LegR')]) +
      rig.bindPos[rig.index('LegR')].distanceTo(rig.bindPos[rig.index('FootR')]);
    this._aimApplied = 0;
    this.muzzleWorld = new THREE.Vector3();
    this.muzzleDir = new THREE.Vector3(0, 0, 1);
    this.ejectWorld = new THREE.Vector3();
  }

  setState(s) {
    const st = this.state;
    if (s.clip !== undefined && s.clip !== st.clip) {
      this.prevClip = st.clip;
      this.blend = 0;
      st.clip = s.clip;
    }
    if (s.speed !== undefined) st.speed = s.speed;
    if (s.crouch !== undefined) st.crouch = s.crouch;
    if (s.aimTarget !== undefined) st.aimTarget = s.aimTarget;
    if (s.lookTarget !== undefined) st.lookTarget = s.lookTarget;
    if (s.aimWeight !== undefined) st.aimWeight = s.aimWeight;
    if (s.suppress !== undefined) st.suppress = s.suppress;
    if (s.hurt !== undefined) st.hurt = s.hurt;
  }

  /* ---------------- one-shot triggers ---------------- */

  fire(strength = 1) {
    this.recoilT = 0;
    this.recoilK = strength;
  }

  hit(region = 'torso', side = 1, strength = 1) {
    this.hitT = 0;
    this.hitRegion = region;
    this.hitSide = side;
    this.hitK = strength;
  }

  reload(duration = 2.4) {
    this.reloadT = 0;
    this.reloadDur = duration;
  }

  get reloading() {
    return this.reloadT >= 0;
  }

  /**
   * THE MAGAZINE GOES BACK IN. A man who started a top-up in a lull and had
   * somebody walk into his sights brings the old magazine back up rather than
   * finishing the change — @see `Agent._shoot`, which is the only caller and
   * which only calls it when there are rounds in the gun to bring back up.
   *
   * It is a hard cut and not a rewind on purpose: `reloadAdd` is a pose offset
   * with no state of its own, so clearing the clock puts the arms back on the
   * aim additive on the next frame, which is what "he snaps the rifle up" is.
   */
  cancelReload() {
    this.reloadT = -1;
  }

  /** 0..1 through the magazine change, or 0 when he is not in one. */
  get reloadProgress() {
    return this.reloadT >= 0 ? this.reloadT / Math.max(1e-3, this.reloadDur) : 0;
  }

  vault(duration = 0.85) {
    this.vaultT = 0;
    this.vaultDur = duration;
  }

  get vaulting() {
    return this.vaultT >= 0;
  }

  turn(dir) {
    if (this.turnT >= 0) return;
    this.turnT = 0;
    this.turnDir = dir >= 0 ? 1 : -1;
  }

  /* ---------------- main ---------------- */

  update(dt, now) {
    if (!this.enabled) return;
    this.time = now;
    const st = this.state;
    const P = this.P;

    /* --- phase advance ---------------------------------------------------
     * The rate alone never planted anything (see clips.js): what plants a foot
     * is the clip knowing how far the actor travels in one cycle, so that is
     * what gets handed down. `stride` is metres per full cycle — speed divided
     * by this same rate — which means the foot path stays stride-locked even at
     * the low-speed clamp, where the cycle no longer covers the nominal stride.
     */
    const clip = st.clip;
    // A sprinter's stride is LONGER than a runner's, so at the same ground speed
    // his cadence is lower — which is what makes the two read differently at a
    // distance. @see `SPRINT` in clips.js.
    const strideHz =
      clip === 'sprint' ? Math.max(1.3, st.speed / 2.55)
        : clip === 'run' ? Math.max(1.1, st.speed / 2.05)
          : clip === 'walk' ? Math.max(0.55, st.speed / 1.42)
            : clip === 'crouchWalk' ? Math.max(0.4, st.speed / 0.95)
              : 0.19; // idle breathing rate
    this.phase = (this.phase + dt * strideHz) % 1;
    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / 0.18);
    const ctx = this._clipCtx;
    ctx.stride = st.speed / strideHz;
    ctx.cycle = 1 / strideHz;
    ctx.speed = st.speed;

    /* --- layer 1: locomotion, crossfaded --- */
    P.reset();
    const fn = C.CLIPS[clip] ?? C.idle;
    const prev = C.CLIPS[this.prevClip] ?? C.idle;
    if (this.blend < 1) {
      P.w = 1 - this.blend;
      prev(P, this.phase, ctx);
      P.w = this.blend;
      fn(P, this.phase, ctx);
    } else {
      P.w = 1;
      fn(P, this.phase, ctx);
    }

    /* --- layer 2: additives --- */
    P.w = 1;
    if (st.aimWeight > 0 && !this.vaulting) C.aimAdd(P, st.aimWeight * (1 - (this.reloadT >= 0 ? 0.6 : 0)));
    if (st.suppress > 0) C.suppressAdd(P, Math.min(1, st.suppress));
    if (this.recoilT >= 0) {
      C.recoilAdd(P, this.recoilT, this.recoilK);
      this.recoilT += dt;
      if (this.recoilT > 0.3) this.recoilT = -1;
    }
    if (this.hitT >= 0) {
      C.hitAdd(P, this.hitRegion, this.hitT, this.hitSide, this.hitK);
      this.hitT += dt;
      if (this.hitT > 0.55) this.hitT = -1;
    }
    if (this.reloadT >= 0) {
      C.reloadAdd(P, this.reloadT / this.reloadDur);
      this.reloadT += dt;
      if (this.reloadT > this.reloadDur) this.reloadT = -1;
    }
    if (this.turnT >= 0) {
      C.turnStep(P, this.turnT / 0.42, this.turnDir);
      this.turnT += dt;
      if (this.turnT > 0.42) this.turnT = -1;
    }
    if (this.vaultT >= 0) {
      const t = this.vaultT / this.vaultDur;
      P.w = 1;
      C.vault(P, t);
      this.vaultT += dt;
      if (this.vaultT > this.vaultDur) this.vaultT = -1;
    }

    /* --- write the pose --- */
    this._writePose();

    /* --- IK --- */
    const root = this.bones[0];
    root.updateMatrixWorld(true);

    if (this.footIk && !this.vaulting) this._footIk();
    if (st.aimTarget && st.aimWeight > 0.01 && !this.vaulting) this._aimIk(st.aimTarget, st.aimWeight);
    if (st.lookTarget) this._lookAt(st.lookTarget, Math.max(0.35, st.aimWeight));
    this._supportHandIk();
    this._updateMuzzle();
  }

  _writePose() {
    const rig = this.rig;
    const bones = this.bones;
    const d3 = this.P.d3;
    const e = this._e;
    const q = this._q;
    for (let i = 0; i < rig.count; i++) {
      const x = d3[i * 3], y = d3[i * 3 + 1], z = d3[i * 3 + 2];
      const b = bones[i];
      if (x || y || z) {
        e.set(x * DEG, y * DEG, z * DEG, 'XYZ');
        q.setFromEuler(e);
        b.quaternion.copy(rig.localQuat[i]).multiply(q);
      } else {
        b.quaternion.copy(rig.localQuat[i]);
      }
      if (i === 0) {
        b.position.copy(rig.localPos[i]).add(this.P.hipOff);
      } else {
        b.position.copy(rig.localPos[i]);
      }
      b.updateMatrix();
    }
  }

  /* ---------------- helpers on world transforms ---------------- */

  _wp(i, out) {
    const m = this.bones[i].matrixWorld.elements;
    return out.set(m[12], m[13], m[14]);
  }

  _wq(i, out) {
    return this.bones[i].getWorldQuaternion(out);
  }

  /** Rotate bone `i` in world space by quaternion `dq`, keeping its position. */
  _applyWorld(i, dq) {
    const b = this.bones[i];
    const parent = b.parent;
    // NOTE: private scratch — callers pass their own quaternions in as `dq`,
    // so this must never reuse the shared _q/_q2/_q3 slots.
    const q = this._qa;
    if (parent) parent.getWorldQuaternion(q);
    else q.identity();
    const cur = this._qb.copy(q).multiply(b.quaternion); // current world
    cur.premultiply(dq);
    b.quaternion.copy(q.invert()).multiply(cur);
    b.updateMatrix();
    b.updateMatrixWorld(true);
  }

  /** Point bone `i`'s +Y axis along `dir` (world, unit), preserving twist. */
  _aimBone(i, dir) {
    const b = this.bones[i];
    const wq = this._wq(i, this._qc);
    const cur = this._v5.set(0, 1, 0).applyQuaternion(wq);
    const dq = this._qd.setFromUnitVectors(cur, dir);
    this._applyWorld(i, dq);
    return b;
  }

  /* ---------------- A: aim ---------------- */

  _aimIk(target, weight) {
    const spread = [
      [this.iSpine, 0.12],
      [this.iSpine1, 0.34],
      [this.iSpine2, 0.54],
    ];
    for (let iter = 0; iter < 2; iter++) {
      const hand = this.bones[this.iHandR];
      const bore = this._v.copy(this.boreLocal).applyQuaternion(this._wq(this.iHandR, this._q2)).normalize();
      const muzzle = this._v2.copy(this.muzzleLocal).applyMatrix4(hand.matrixWorld);
      const want = this._v3.copy(target).sub(muzzle);
      if (want.lengthSq() < 1e-6) return;
      want.normalize();
      const dot = Math.min(1, Math.max(-1, bore.dot(want)));
      let ang = Math.acos(dot) * weight;
      if (ang < 0.0015) return;
      // clamp how far the spine will twist before the body has to turn
      const maxThisIter = iter === 0 ? 0.9 : 0.35;
      if (ang > maxThisIter) ang = maxThisIter;
      const axis = this._v4.crossVectors(bore, want);
      if (axis.lengthSq() < 1e-10) return;
      axis.normalize();
      for (const [bi, f] of spread) {
        this._q3.setFromAxisAngle(axis, ang * f);
        this._applyWorld(bi, this._q3);
      }
    }
  }

  /* ---------------- B: look-at ---------------- */

  _lookAt(target, weight) {
    // the head's forward is its local +Z
    const chain = [
      [this.iNeck, 0.4],
      [this.iHead, 0.6],
    ];
    for (const [bi, f] of chain) {
      const wq = this._wq(bi, this._q2);
      const fwd = this._v.set(0, 0, 1).applyQuaternion(wq);
      const want = this._v2.copy(target).sub(this._wp(bi, this._v3));
      if (want.lengthSq() < 1e-6) return;
      want.normalize();
      const dot = Math.min(1, Math.max(-1, fwd.dot(want)));
      let ang = Math.acos(dot) * weight * f;
      if (ang < 0.002) continue;
      if (ang > 0.5) ang = 0.5; // ~29 deg per bone per frame cap
      const axis = this._v4.crossVectors(fwd, want);
      if (axis.lengthSq() < 1e-10) continue;
      axis.normalize();
      this._q3.setFromAxisAngle(axis, ang);
      this._applyWorld(bi, this._q3);
    }
  }

  /* ---------------- C: support hand ---------------- */

  _supportHandIk() {
    const hand = this.bones[this.iHandR];
    const t = this._target;
    if (this.vaulting) return;
    if (this.reloadT >= 0) {
      const p = this.reloadT / this.reloadDur;
      // magwell -> chest pouch -> magwell -> slap -> back to the handguard
      const mag = this._v.copy(this.magLocal).applyMatrix4(hand.matrixWorld);
      const grip = this._v2.copy(this.foregripLocal).applyMatrix4(hand.matrixWorld);
      // chest pouch in world space, from the actor root
      const chest = this._v3.set(0.02, 1.19, 0.17).applyMatrix4(this.bones[0].parent.matrixWorld);
      if (p < 0.18) t.copy(grip).lerp(mag, p / 0.18);
      else if (p < 0.42) t.copy(mag).lerp(chest, (p - 0.18) / 0.24);
      else if (p < 0.62) t.copy(chest).lerp(mag, (p - 0.42) / 0.20);
      else if (p < 0.78) t.copy(mag);
      else t.copy(mag).lerp(grip, (p - 0.78) / 0.22);
    } else {
      t.copy(this.foregripLocal).applyMatrix4(hand.matrixWorld);
    }
    // pole: elbow down and out to the character's left
    this._pole.set(0.6, -1, -0.25).applyQuaternion(this.bones[0].parent.getWorldQuaternion(this._q2));
    this._twoBone(this.armL, t, this._pole);
  }

  /* ---------------- D: feet ---------------- */

  /**
   * D: feet.
   *
   * Two jobs, and they used to be tangled into one.
   *
   * PLACEMENT. When a locomotion clip has written a foot path, the path IS the
   * answer: it is the actor-frame position of an ankle whose sole is a fixed
   * point of the world, so the leg simply reaches for it. When no clip claims
   * the foot — idle, crouch-idle, hurt, a turn-in-place — the FK pose owns its
   * x/z as before and only its height is adapted.
   *
   * GROUND ADAPTATION. The pelvis drops so a PLANTED foot can reach ground that
   * is below it. That word is the whole fix: the old rule took the largest drop
   * either foot asked for, and a foot in mid-swing 0.3 m above flat ground asks
   * for 0.3 m. So every time a leg lifted, the pelvis was yanked down to meet
   * it and the other foot was clamped back onto the floor — measured on the run
   * at 4.2 m/s, both feet had a duty factor of 1.00, the pelvis sat between
   * 0.574 and 0.793 m against a 0.98 m bind height, and the whole figure
   * skated along in a squat at 4.4 m/s of foot slide. A swing foot is not
   * evidence about where the ground is. Only a planted one is.
   */
  _footIk() {
    if (!this.probe) return;
    const s = this.scale;
    const ankleH = 0.088 * s;
    const P = this.P;
    const rootM = this.bones[0].parent.matrixWorld;

    for (let k = 0; k < 2; k++) {
      const pw = Math.min(1, P.footW[k]);
      this._footPathW[k] = pw;
      const leg = this.legs[k];
      const ankle = this._wp(leg[2], this._v);
      let wx = ankle.x;
      let wz = ankle.z;
      let lift = 0; // authored height above the ground, in actor-local metres
      if (pw > 0.001) {
        const inv = 1 / P.footW[k];
        this._footPlant[k] = P.footPlant[k] * inv;
        this._footPitch[k] = P.footPitch[k] * inv;
        this._v2
          .set(P.footT[k * 3] * inv, P.footT[k * 3 + 1] * inv, P.footT[k * 3 + 2] * inv)
          .applyMatrix4(rootM);
        wx = ankle.x + (this._v2.x - ankle.x) * pw;
        wz = ankle.z + (this._v2.z - ankle.z) * pw;
        lift = (P.footT[k * 3 + 1] * inv) * s - ankleH;
      } else {
        this._footPlant[k] = 1;
        this._footPitch[k] = 0;
      }
      const ok = this.probe(wx, wz, ankle.y + 0.75 * s, this._probeOut);
      const gy = ok ? this._probeOut.y : ankle.y - ankleH;
      this._footN[k].set(
        ok ? this._probeOut.nx : 0,
        ok ? this._probeOut.ny : 1,
        ok ? this._probeOut.nz : 0
      );
      // path mode knows the height it wants; FK mode only knows "not below".
      // Crossfading between them has to interpolate the two ANSWERS, not fade
      // the path's lift toward the floor, or an idle -> run transition slams the
      // swing foot down for the first few frames of the blend.
      const fkY = Math.max(gy + ankleH, ankle.y - 0.001);
      const wy = fkY + (gy + ankleH + lift - fkY) * pw;
      this._footWorld[k].set(wx, wy, wz);
      this._footY[k] = gy + ankleH;
    }

    /* ---- pelvis: only a foot that is DOWN says anything about the ground --- */
    let drop = 0;
    const maxReach = this._legReach * s * 0.985;
    const lowest = Math.min(this._footWorld[0].y, this._footWorld[1].y);
    for (let k = 0; k < 2; k++) {
      // "planted" = the clip says so, or (FK mode) this is the low foot
      const planted = this._footPathW[k] > 0.001
        ? this._footPlant[k] > 0.5
        : this._footWorld[k].y <= lowest + 0.04 * s;
      if (!planted) continue;
      const hip = this._wp(this.legs[k][0], this._v6);
      const need = hip.distanceTo(this._footWorld[k]);
      if (need <= maxReach) continue;
      const d = -(need - maxReach);
      if (d < drop) drop = d;
    }
    drop = Math.max(-0.32 * s, drop);
    if (drop < -0.002) {
      const b = this.bones[0];
      b.position.y += drop / s; // hips offset is in the actor's local space
      b.updateMatrix();
      b.updateMatrixWorld(true);
    }

    for (let k = 0; k < 2; k++) {
      const leg = this.legs[k];
      // knee pole: forward, in the actor's facing
      this._pole
        .set(k === 0 ? -0.12 : 0.12, 0.05, 1)
        .applyQuaternion(this.bones[0].parent.getWorldQuaternion(this._q2));
      this._twoBone(leg, this._footWorld[k], this._pole);
      this._soleTo(leg[2], k);
    }
  }

  /**
   * Put the sole where the clip says it is. The sole normal is the foot bone's
   * local +Z; `footPitch` tips it back about the actor's lateral axis, which is
   * a heel-strike when it is negative and a toe-off when it is positive. In FK
   * mode this degrades to the old behaviour — roll the sole onto the ground
   * normal, and do nothing at all on flat ground.
   */
  _soleTo(foot, k) {
    const n = this._v7.copy(this._footN[k]);
    const pw = this._footPathW[k];
    if (pw > 0.001 && Math.abs(this._footPitch[k]) > 0.01) {
      // Lateral axis = the actor's own +X (his LEFT), so the tip stays in the
      // sagittal plane. Toe-down tips the sole normal FORWARD about that axis,
      // which is +pitch: measured with the sign the other way the foot toed UP
      // through the whole push-off and the sole slid 12 cm per contact.
      const axis = this._v2.set(1, 0, 0).applyQuaternion(
        this.bones[0].parent.getWorldQuaternion(this._q2)
      );
      n.applyQuaternion(this._qe.setFromAxisAngle(axis, this._footPitch[k] * DEG));
    } else if (pw <= 0.001 && n.y > 0.999) {
      return;
    }
    n.normalize();
    const up = this._v2.set(0, 0, 1).applyQuaternion(this._wq(foot, this._q2));
    const dot = Math.min(1, Math.max(-1, up.dot(n)));
    let ang = Math.acos(dot) * (pw > 0.001 ? pw : 1);
    if (ang < 1e-4) return;
    if (ang > 1.2) ang = 1.2;
    const axis2 = this._v4.crossVectors(up, n);
    if (axis2.lengthSq() < 1e-10) return;
    axis2.normalize();
    this._q3.setFromAxisAngle(axis2, ang);
    this._applyWorld(foot, this._q3);
  }

  /* ---------------- two-bone solver ---------------- */

  /**
   * Classic analytic two-bone IK. `chain` = [upper, lower, end] bone indices.
   * Preserves the bones' twist and never over-extends.
   */
  _twoBone(chain, target, pole) {
    const [iu, il, ie] = chain;
    const A = this._wp(iu, this._v);
    const B = this._wp(il, this._v2);
    const Cp = this._wp(ie, this._v3);
    const l1 = A.distanceTo(B);
    const l2 = B.distanceTo(Cp);
    if (l1 < 1e-5 || l2 < 1e-5) return;
    const dir = this._v4.copy(target).sub(A);
    let d = dir.length();
    if (d < 1e-5) return;
    dir.multiplyScalar(1 / d);
    const min = Math.abs(l1 - l2) + 1e-4;
    const max = l1 + l2 - 1e-4;
    d = Math.min(max, Math.max(min, d));
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    // pole component perpendicular to the limb axis
    const perp = this._elbow.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (perp.lengthSq() < 1e-8) perp.set(0, 1, 0).addScaledVector(dir, -dir.y);
    perp.normalize();
    // elbow/knee position
    const ex = A.x + dir.x * a + perp.x * h;
    const ey = A.y + dir.y * a + perp.y * h;
    const ez = A.z + dir.z * a + perp.z * h;
    // upper segment
    const toE = this._elbow.set(ex - A.x, ey - A.y, ez - A.z);
    if (toE.lengthSq() < 1e-10) return;
    this._aimBone(iu, toE.normalize());
    // lower segment (world matrices refreshed by _aimBone)
    const B2 = this._wp(il, this._v2);
    const toT = this._elbow.set(target.x - B2.x, target.y - B2.y, target.z - B2.z);
    if (toT.lengthSq() < 1e-10) return;
    this._aimBone(il, toT.normalize());
  }

  /* ---------------- outputs for FX / ballistics ---------------- */

  _updateMuzzle() {
    const hand = this.bones[this.iHandR];
    this.muzzleWorld.copy(this.muzzleLocal).applyMatrix4(hand.matrixWorld);
    this.ejectWorld.copy(this.ejectLocal).applyMatrix4(hand.matrixWorld);
    this.muzzleDir
      .copy(this.boreLocal)
      .applyQuaternion(hand.getWorldQuaternion(this._q2))
      .normalize();
  }

  /** World position of a bone, for hitboxes and FX. */
  bonePos(name, out) {
    return this._wp(this.rig.index(name), out);
  }
}
