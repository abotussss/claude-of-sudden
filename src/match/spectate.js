/**
 * MATCH — what you look at once you are dead.
 *
 * There is no respawn inside a Sudden Attack round, so death is followed by
 * anywhere up to two minutes of watching. That has to be worth watching: the
 * camera rides over a living teammate's shoulder, pulls in when a wall is
 * behind them, and can be cycled through the squad. With nobody left alive it
 * settles into a slow orbit over the body, which is also the shot the round-end
 * scoreboard is read against.
 *
 * The camera transform is written in `update()`, i.e. during the engine's update
 * phase and therefore before `ui` and `render` read it. `player` only drives the
 * camera while `controlEnabled` is true, so the two never fight.
 */

import * as THREE from 'three';

const FOLLOW_DIST = 2.9;
const FOLLOW_HEIGHT = 0.55;
const ORBIT_DIST = 4.2;

export class Spectator {
  constructor(ctx) {
    this.ctx = ctx;
    this.active = false;
    this.target = null;
    this.targetName = '';
    this.mode = 'orbit';

    this._anchor = new THREE.Vector3();
    this._want = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._m = new THREE.Matrix4();
    this._orbit = 0;
    this._index = 0;
  }

  /** Called the moment the player dies. `at` is the eye position they died with. */
  start(at) {
    this.active = true;
    this.target = null;
    this.mode = 'orbit';
    this._orbit = 0;
    this._anchor.copy(at);
    this._pos.copy(at);
    this._index = 0;
  }

  stop() {
    this.active = false;
    this.target = null;
  }

  /**
   * @param {number} dt
   * @param {Array} squad living friendly actors, each with `.position`, `.yaw`,
   *                     `.eyeHeight` and `.name`
   */
  update(dt, squad) {
    if (!this.active) return;
    const ctx = this.ctx;

    // ---- pick / cycle a target ------------------------------------------
    const live = squad.filter((a) => a && a.alive !== false);
    if (live.length) {
      if (!this.target || !live.includes(this.target)) {
        this._index = Math.min(this._index, live.length - 1);
        this.target = live[this._index];
      }
      if (ctx.input.enabled && !ctx.input.frozen) {
        if (ctx.input.firePressed || ctx.input.pressed('ArrowRight')) this._cycle(live, 1);
        else if (ctx.input.pressed('Mouse2') || ctx.input.pressed('ArrowLeft')) this._cycle(live, -1);
      }
      this.mode = 'follow';
      this.targetName = this.target.name ?? 'SQUAD';
    } else {
      this.target = null;
      this.mode = 'orbit';
      this.targetName = '';
    }

    if (this.mode === 'follow') this._follow(dt);
    else this._orbitBody(dt);

    ctx.camera.position.copy(this._pos);
    this._m.lookAt(this._pos, this._look, this._up);
    ctx.camera.quaternion.setFromRotationMatrix(this._m);
    ctx.camera.updateMatrixWorld(true);
  }

  _cycle(live, step) {
    const i = live.indexOf(this.target);
    this._index = (((i < 0 ? 0 : i) + step) % live.length + live.length) % live.length;
    this.target = live[this._index];
  }

  _follow(dt) {
    const t = this.target;
    const eye = t.eyeHeight ?? 1.6;
    this._look.set(t.position.x, t.position.y + eye, t.position.z);
    // Behind them, along their own facing, so you see what they are walking into.
    const yaw = t.yaw ?? 0;
    this._dir.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this._want
      .copy(this._look)
      .addScaledVector(this._dir, FOLLOW_DIST)
      .setY(this._look.y + FOLLOW_HEIGHT);
    this._avoidWall(this._look, this._want);
    // Critically damped-ish chase; snapping to a running man is unwatchable.
    this._pos.lerp(this._want, 1 - Math.exp(-8 * dt));
  }

  _orbitBody(dt) {
    this._orbit += dt * 0.28;
    this._look.copy(this._anchor);
    this._want.set(
      this._anchor.x + Math.cos(this._orbit) * ORBIT_DIST,
      this._anchor.y + 2.1,
      this._anchor.z + Math.sin(this._orbit) * ORBIT_DIST
    );
    this._avoidWall(this._look, this._want);
    this._pos.lerp(this._want, 1 - Math.exp(-5 * dt));
  }

  /** Pull `want` in toward `from` if the level is in the way. Mutates `want`. */
  _avoidWall(from, want) {
    const phys = this._phys ?? (this._phys = this.ctx.peek('physics'));
    if (!phys) return;
    this._dir.copy(want).sub(from);
    const d = this._dir.length();
    if (d < 1e-3) return;
    this._dir.divideScalar(d);
    const hit = phys.sphereCast(from, this._dir, 0.22, d, phys.MASK.WORLD);
    if (hit?.hit) want.copy(from).addScaledVector(this._dir, Math.max(0.5, hit.distance - 0.1));
  }
}
