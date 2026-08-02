/**
 * MATCH — what you look at once you are dead.
 *
 * Death is followed by `RULES.respawnDelay` seconds of watching (and, in the
 * demolition ruleset with respawns closed, by up to two minutes of it). That
 * has to be worth watching: the camera rides over a living teammate's shoulder,
 * pulls in when a wall is behind them, and can be cycled through the squad.
 * With nobody left alive it settles into a slow orbit over the body, which is
 * also the shot the round-end scoreboard is read against.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * AND IT OPENS ON A KILL CAM — 「今は敵にやられたときに味方の誰かを一時的に観戦に
 * なっていますが、誰が自分をキルしたのか、キルカメラにしてください」
 * ════════════════════════════════════════════════════════════════════════════
 * The complaint is exact: a death cut straight to A RANDOM LIVING TEAM-MATE,
 * who by definition had nothing to do with it, while the one row in the
 * killfeed that answered "what just happened" scrolled away behind the
 * ELIMINATED banner. The question a player asks at the moment of death is not
 * "how is FLINT doing", it is "what killed me", and nothing on screen answered
 * it.
 *
 * So `start()` now takes a KILLER, and for `KILLCAM_TIME` the camera stands
 * behind whatever it was, looking down its line at the place the player fell —
 * then hands over to the squad follow, unchanged, for the rest of the wait.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE KILLER IS OFTEN NOT A PERSON, AND `describeKiller` IS WHERE THAT LIVES
 * ────────────────────────────────────────────────────────────────────────────
 * On this map more than half the ways to die are not a man with a rifle: an
 * airstrike, a bomber run, a strafing run, a tank shell, a suicide drone, a
 * frag (yours or theirs), the C4, the cathedral coming down, the ground. The
 * killer may also be DEAD or GONE by the time the camera gets there — a drone
 * destroys itself doing it, and a bot who traded with you is a ragdoll.
 *
 * Both are handled by keeping the two halves separate. A killer is a POINT and
 * optionally an ACTOR: the point is always framed, the actor is only tracked
 * while it is still alive, and a killer with no point at all (a fall) falls
 * back to the orbit over the body that this file has always had. The caption is
 * `ui.killCam`'s; this decides what the camera does.
 *
 * The camera transform is written in `update()`, i.e. during the engine's update
 * phase and therefore before `ui` and `render` read it. `player` only drives the
 * camera while `controlEnabled` is true, so the two never fight.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IT TAKES ONE BUTTON AND THAT BUTTON CANNOT REACH THE WEAPON
 * ────────────────────────────────────────────────────────────────────────────
 * Skipping the kill cam is the same `input.firePressed` the squad cycle below
 * has always read, and it is safe for the reason the cycle is now safe rather
 * than by luck: `WeaponSystem.update` refuses the mouse, the wheel and the
 * number keys outright while `player.dead` (commit 32b2a25 — "a dead man does
 * not work his weapon", after every click aimed at cycling a spectator target
 * fired the corpse's rifle and changed which weapon it came back holding). This
 * file adds NO new input path and no new coupling; it reads the same flag in a
 * mode where the cycle would do nothing anyway.
 */

import * as THREE from 'three';

const FOLLOW_DIST = 2.9;
const FOLLOW_HEIGHT = 0.55;
const ORBIT_DIST = 4.2;

/**
 * Seconds the kill cam holds before the squad follow takes over.
 *
 * 3.2 against a `RULES.respawnDelay` of 6: long enough to read a name, find the
 * line it came down and understand the mistake, and short enough that the
 * remaining 2.8 s of the wait is still the living match rather than a slideshow
 * of the man who beat you. It is capped at the respawn wait itself in `start`,
 * so a shorter delay shortens the cam rather than eating all of it.
 */
export const KILLCAM_TIME = 3.2;
/** How far behind the killer the camera stands, and how high. */
const CAM_BACK = 3.4;
const CAM_UP = 1.35;
/** A blast has no shoulder to look over, so the camera stands off further. */
const CAM_BACK_BLAST = 6.2;
const CAM_UP_BLAST = 3.2;

/**
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT KILLED YOU, IN WORDS AND AS A PLACE
 * ══════════════════════════════════════════════════════════════════════════
 * Turns `player.lastDamage` into the record the kill cam and `ui.killCam` both
 * read. Pure, allocation-free (it fills the caller's record) and it never
 * throws: an unknown killer is a real answer and is drawn as one.
 *
 * WHAT EACH DEATH SHOWS, exhaustively, because the awkward cases are the point:
 *
 *   a bot's round      his name, his team's colour, the range. The camera
 *                      stands behind HIM if he is alive, and behind the spot he
 *                      shot from if he is not.
 *   your own team      the same, in friendly blue, and the caption says so.
 *   a bot's grenade    his name, cause 'GRENADE' — `ai` puts the thrower on the
 *                      explosion payload, so this is a named kill.
 *   YOUR OWN grenade   'YOUR OWN GRENADE', no name. `weapons` publishes the
 *                      string 'grenade' rather than an actor precisely because
 *                      a player's frag must not carry team damage, so a string
 *                      source on a frag IS the player's own — exactly, not
 *                      heuristically.
 *   a suicide drone    'SUICIDE DRONE' and whose it was, from the additive
 *                      `label`/`team` fields on the blast. The drone itself no
 *                      longer exists, so the camera frames the burst.
 *   an airstrike       'AIRSTRIKE' — no name, amber, camera on the crater.
 *   a bomber / strafe  'BOMBER RUN' / 'STRAFING RUN', the same treatment.
 *   a tank             the hull's own name (it has one and a team, which is
 *                      everything the killfeed asks of an attacker) plus
 *                      'MAIN GUN' or 'COAXIAL MG' depending on how it reached
 *                      you. A destroyed hull is still framed where it stood.
 *   the C4             'THE CHARGE'.
 *   the cathedral, a
 *   zone bombardment,
 *   a hull brewing up  'BOMBARDMENT' — all three publish `source: null` and are
 *                      deliberately indistinguishable from each other (see the
 *                      note in `src/match/tank.js`). The camera frames the
 *                      blast, which is the honest answer: something went off
 *                      THERE.
 *   a fall             'THE FALL', no point, so the camera orbits the body —
 *                      which is the correct shot for a death nobody caused.
 *   nothing at all     'UNKNOWN'. Reachable only if a wound arrives before the
 *                      first frame; it is still drawn.
 *
 * @param {object} out       the caller's reused record
 * @param {object} last      `player.lastDamage`
 * @param {number} playerTeam
 * @param {THREE.Vector3|null} deathAt  where the player fell, for the range
 * @returns {object} out
 */
export function describeKiller(out, last, playerTeam = -1, deathAt = null) {
  out.actor = null;
  out.name = '';
  out.cause = '';
  out.dist = 0;
  out.friendly = false;
  out.environmental = true;
  out.hasPoint = false;
  out.x = out.y = out.z = 0;
  if (!last || last.at < 0) {
    out.cause = 'UNKNOWN';
    return out;
  }

  const src = last.source;
  const blast = last.type === 'explosion';

  if (src && typeof src === 'object') {
    // A MAN, OR A HULL. Both have a name and a team, which is all that is
    // needed; only a live one is worth tracking with the camera.
    out.actor = src.alive === false || src.dead === true ? null : src;
    out.name = src.name ?? (src.isTank ? 'ARMOUR' : 'ENEMY');
    out.environmental = false;
    const team = src.team ?? -1;
    out.friendly = playerTeam >= 0 && team === playerTeam;
    if (src.isTank) out.cause = blast ? 'MAIN GUN' : 'COAXIAL MG';
    else if (blast) out.cause = last.kind === 'grenade' ? 'GRENADE' : 'EXPLOSION';
    const p = src.position;
    if (p) {
      out.hasPoint = true;
      out.x = p.x; out.y = p.y; out.z = p.z;
    }
  } else if (typeof src === 'string') {
    out.environmental = true;
    switch (src) {
      case 'drone':
        // The only environmental killer that belongs to a SIDE, and it says so.
        out.name = last.label ?? 'SUICIDE DRONE';
        out.cause = last.team >= 0
          ? `${last.team === playerTeam ? 'FRIENDLY' : 'ENEMY'} DRONE STRIKE`
          : 'DRONE STRIKE';
        break;
      case 'airstrike': out.name = 'AIRSTRIKE'; out.cause = 'AIR SUPPORT'; break;
      case 'bomber': out.name = 'BOMBER RUN'; out.cause = 'AIR SUPPORT'; break;
      case 'strafe': out.name = 'STRAFING RUN'; out.cause = 'AIR SUPPORT'; break;
      case 'c4': out.name = 'THE CHARGE'; out.cause = 'C4'; break;
      case 'grenade': out.name = 'YOUR OWN GRENADE'; out.cause = 'FRAG'; break;
      default: out.name = src.toUpperCase(); break;
    }
  } else if (last.type === 'fall') {
    out.name = 'THE FALL';
    out.cause = '';
    return out; // no point: the orbit over the body is the right shot
  } else if (blast) {
    out.name = 'BOMBARDMENT';
    out.cause = 'INDIRECT FIRE';
  } else {
    out.cause = 'UNKNOWN';
  }

  // A blast names the place it went off, and that is what gets framed.
  if (!out.hasPoint && last.hasFrom) {
    out.hasPoint = true;
    out.x = last.from.x; out.y = last.from.y; out.z = last.from.z;
  }
  // HOW FAR AWAY IT HAPPENED, which for a round is the range he beat you at and
  // for a blast is how close it landed. Both are worth knowing and neither is
  // guessable from the shot.
  if (out.hasPoint && deathAt) {
    out.dist = Math.hypot(out.x - deathAt.x, out.y - deathAt.y, out.z - deathAt.z);
  }
  return out;
}

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

    /** The kill cam's own state. `kill` is `describeKiller`'s record, or null. */
    this.kill = null;
    this.killT = 0;
    this.killFor = 0;
    /** Where the killer is, tracked if it is alive and frozen if it is not. */
    this._killAt = new THREE.Vector3();
  }

  /** True while the kill cam is running. `ui` and the HUD read it. */
  get killCam() {
    return !!this.kill && this.killT < this.killFor;
  }

  /**
   * Called the moment the player dies.
   *
   * @param {THREE.Vector3} at   the eye position they died with
   * @param {object|null} kill   `describeKiller`'s record, or null for the
   *                             behaviour this file has always had
   * @param {number} wait        seconds until the respawn, for capping the cam
   */
  start(at, kill = null, wait = KILLCAM_TIME) {
    this.active = true;
    this.target = null;
    this._orbit = 0;
    this._anchor.copy(at);
    this._pos.copy(at);
    this._index = 0;
    // A killer with nowhere to be is not a kill cam — a fall, or a wound that
    // arrived before anything had a position. The orbit over the body says
    // "nobody did this to you" better than a cut to a stranger does.
    this.kill = kill?.hasPoint ? kill : null;
    this.killT = 0;
    // Never the whole wait: the last of it belongs to the live match.
    this.killFor = this.kill ? Math.max(0.8, Math.min(KILLCAM_TIME, wait - 1.2)) : 0;
    if (this.kill) {
      this._killAt.set(kill.x, kill.y, kill.z);
      this.mode = 'kill';
      // Start wide and settle in, so the cut reads as a move rather than a jump.
      this._pos.lerp(this._killAt, 0.35);
    } else {
      this.mode = 'orbit';
    }
  }

  stop() {
    this.active = false;
    this.target = null;
    this.kill = null;
    this.killT = 0;
  }

  /**
   * @param {number} dt
   * @param {Array} squad living friendly actors, each with `.position`, `.yaw`,
   *                     `.eyeHeight` and `.name`
   */
  update(dt, squad) {
    if (!this.active) return;
    const ctx = this.ctx;

    // ---- the kill cam ----------------------------------------------------
    if (this.kill) {
      this.killT += dt;
      /**
       * SKIPPABLE, on the same button the cycle below uses. It cannot reach the
       * weapon: `WeaponSystem.update` refuses every input while `player.dead`.
       * @see the header.
       */
      if (ctx.input.enabled && !ctx.input.frozen && this.killT > 0.35 && ctx.input.firePressed) {
        this.killT = this.killFor;
      }
      if (this.killT < this.killFor) {
        this._killShot(dt);
        this.mode = 'kill';
        this.targetName = this.kill.name;
        this._apply();
        return;
      }
      this.kill = null;
    }

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

    this._apply();
  }

  _apply() {
    const ctx = this.ctx;
    ctx.camera.position.copy(this._pos);
    this._m.lookAt(this._pos, this._look, this._up);
    ctx.camera.quaternion.setFromRotationMatrix(this._m);
    ctx.camera.updateMatrixWorld(true);
  }

  /**
   * THE SHOT: stand behind the killer, look down its line at the body. It is
   * the same framing whether the killer is a man, a hull or a crater, because
   * the information wanted is the same — where it came from, and what was
   * between the two of you.
   *
   * A live actor is TRACKED (a man who shot you and ran keeps the camera on
   * him); a dead or vanished one is frozen where it was, which is the whole
   * reason `describeKiller` separates the actor from the point.
   */
  _killShot(dt) {
    const k = this.kill;
    const p = k.actor?.position;
    if (p && k.actor.alive !== false && k.actor.dead !== true) this._killAt.copy(p);
    const blast = k.environmental;
    const eye = blast ? 0 : (k.actor?.eyeHeight ?? 1.55);
    this._look.copy(this._anchor);
    // The line from the body to the killer — the camera sits beyond the killer
    // on that same line, so what is drawn is the shot he actually had.
    this._dir.set(
      this._killAt.x - this._anchor.x,
      0,
      this._killAt.z - this._anchor.z
    );
    const flat = this._dir.length();
    if (flat < 0.5) {
      // He was on top of you. Back off along the view instead of dividing by
      // nothing, and look down at the two of you.
      this._dir.set(0, 0, 1);
    } else {
      this._dir.divideScalar(flat);
    }
    this._want
      .set(this._killAt.x, this._killAt.y + eye, this._killAt.z)
      .addScaledVector(this._dir, blast ? CAM_BACK_BLAST : CAM_BACK);
    this._want.y += blast ? CAM_UP_BLAST : CAM_UP;
    this._avoidWall(this._look, this._want);
    // Ease in hard at the cut and settle: 1 - exp(-6 dt) is ~0.1 on a 60 Hz
    // frame, so the move is legible rather than a snap.
    // The eye stays on the BODY and not on the killer: you are watching your
    // own death from the other end of it.
    this._pos.lerp(this._want, 1 - Math.exp(-6 * dt));
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
