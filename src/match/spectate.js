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
 * behind whatever it was, LOOKING AT IT — then hands over to the squad follow,
 * unchanged, for the rest of the wait.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 「キルカメラもちゃんと相手を表示して」 — AND IT DID NOT
 * ────────────────────────────────────────────────────────────────────────────
 * The strip read `KILLED BY THRESHER — 192M` over a frame with no THRESHER in
 * it, and `_kcframe.mjs` says why in one line: on all nine frames of a bot kill
 * cam the killer was 179° OFF THE CAMERA AXIS — DIRECTLY BEHIND IT — 112 m
 * away. Two faults, and the first is the whole of it:
 *
 *   1. `_avoidWall` WAS ANCHORED ON THE BODY. It sphere-casts from the point
 *      being looked at toward the camera and pulls the camera in to the first
 *      wall, which is right for the follow and the orbit (the subject IS the
 *      look point) and catastrophic here: the camera stood BEYOND the killer,
 *      so the cast ran the entire length of the shot he took. Any masonry in
 *      between — i.e. exactly the geometry that made the fight a fight —
 *      stopped the camera at the wall, tens of metres short of him, still
 *      looking back at the corpse. The killer was then behind the lens by
 *      construction. Measured 9/9 frames on a 192 m rifle kill and, at the
 *      other extreme, 1.2 m from the crater on an airstrike.
 *      It is now anchored on the KILLER, so the pull-in can only ever move the
 *      camera toward him.
 *   2. THE EYE WAS ON THE BODY, which can be 200 m down the street, and the
 *      camera sat 2.9 m above the killer 3.4 m behind him — 25° of down-angle
 *      that the look point did not share. Even with nothing in the way he was
 *      pinned to the bottom edge of the frame with his feet cut off (chest at
 *      ndc y −0.56, feet at −1.02 against a vertical FOV of 80°). The eye is
 *      now on HIS CHEST and the camera is a head-height above him, which puts
 *      him at ndc y +0.13..−0.35 — centred, whole, and with the line he shot
 *      down running away up-frame toward the body.
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
/**
 * How far behind the killer the camera stands, and how high ABOVE HIS EYE.
 *
 * 0.55 rather than 1.35: the camera looks at his chest from 3.4 m, so every
 * centimetre of height is down-angle he is pushed toward the bottom edge by.
 * At 0.55 he stands from ndc y +0.13 (head) to −0.35 (feet) — the whole man,
 * centred, with the street he shot down still in frame above him.
 */
const CAM_BACK = 3.4;
const CAM_UP = 0.55;
/** A blast has no shoulder to look over, so the camera stands off further. */
const CAM_BACK_BLAST = 6.2;
const CAM_UP_BLAST = 3.2;
/**
 * …and a HULL is seven metres of it, measured from its own centre. At a man's
 * 3.4 m the camera stands inside the tank and the tank is what occludes the
 * tank: 7 of 7 frames of a crush death, before this.
 */
const CAM_BACK_HULL = 9.0;
const CAM_UP_HULL = 4.2;
const HULL_LOOK_UP = 1.5;
/** What the camera frames on a man: chest, as a fraction of his eye height. */
const CHEST = 0.75;
/** …and on a blast, which has no body — a little above the crater. */
const BLAST_LOOK_UP = 0.6;
/**
 * Closer than this behind him and the camera is inside his head, so the shot
 * goes OVER him instead. A wall 0.6 m off a man's back is a real place to be
 * standing when you shoot somebody.
 */
const MIN_BACK = 1.6;
/** The push-in: where the camera starts, relative to the settled shot. */
const LEAD_BACK = 2.0;
const LEAD_UP = 1.2;

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
 *                      'MAIN GUN', 'COAXIAL MG' or 'CRUSHED' depending on how
 *                      it reached you — and being run over used to read as
 *                      'BOMBARDMENT', because it is the one wound in the game
 *                      that arrives with no event behind it at all (@see
 *                      `PlayerSystem._recordDamage`). A destroyed hull is still
 *                      framed where it stood.
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
  /**
   * IS THE KILLER THE SIZE OF A VEHICLE. A hull is seven metres long and the
   * `position` on it is its CENTRE, so the shoulder standoff a man gets puts
   * the camera inside the tank — measured occluded on 7/7 frames of a crush,
   * by the tank itself. It is on the record rather than read off `actor`
   * because a destroyed hull is still framed and `actor` is null for one.
   */
  out.big = false;
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
    out.big = src.isTank === true;
    const team = src.team ?? -1;
    out.friendly = playerTeam >= 0 && team === playerTeam;
    // 'crush' is the hull itself rather than either of its weapons, and it is
    // the only wound that arrives with no event behind it. @see src/match/tank.js.
    if (src.isTank) {
      out.cause = last.kind === 'crush' ? 'CRUSHED' : blast ? 'MAIN GUN' : 'COAXIAL MG';
    }
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
    /**
     * The body→killer direction, FLATTENED, kept apart from `_dir` because
     * `_avoidWall` uses that one as scratch and the second candidate in
     * `_solveKillShot` still needs the first one's bearing.
     */
    this._flat = new THREE.Vector3();
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
      /**
       * SOLVE THE SHOT ON THE FRAME OF THE CUT, then start the camera a couple
       * of metres behind it and ease forward. Starting AT THE BODY and easing
       * (what this did) is a second's worth of empty street when the man who
       * killed you is 190 m away, and the ease never arrives inside the 3.2 s.
       * A fixed push-in reads the same at every range, and it is wall-checked
       * against the settled shot so it cannot start inside masonry.
       */
      this._solveKillShot();
      this._pos.copy(this._want).addScaledVector(this._dir, LEAD_BACK);
      this._pos.y += LEAD_UP;
      this._avoidWall(this._want, this._pos);
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
   * THE SHOT, SOLVED: stand behind the killer, along the line he shot down, and
   * LOOK AT HIM. It is the same framing whether the killer is a man, a hull or
   * a crater, because the information wanted is the same — who it was, where he
   * was standing, and what he could see of you from there.
   *
   * A live actor is TRACKED (a man who shot you and ran keeps the camera on
   * him); a dead or vanished one is frozen where it was, which is the whole
   * reason `describeKiller` separates the actor from the point.
   *
   * Writes `_look` and `_want` and nothing else, so `start()` can place the
   * camera from the same solution the frame loop eases toward.
   */
  _solveKillShot() {
    const k = this.kill;
    const p = k.actor?.position;
    if (p && k.actor.alive !== false && k.actor.dead !== true) this._killAt.copy(p);
    const blast = k.environmental;
    const eye = blast ? 0 : (k.actor?.eyeHeight ?? 1.55);
    // A HULL IS NOT A SHOULDER. `position` on a tank is the centre of seven
    // metres of steel, so a man's standoff stands the camera inside it.
    const back = k.big ? CAM_BACK_HULL : blast ? CAM_BACK_BLAST : CAM_BACK;
    const up = k.big ? CAM_UP_HULL : blast ? CAM_UP_BLAST : eye + CAM_UP;
    // THE SUBJECT IS THE KILLER. Framing the body instead is what put him off
    // the bottom of the screen — @see the header.
    this._look.set(
      this._killAt.x,
      this._killAt.y + (k.big ? HULL_LOOK_UP : blast ? BLAST_LOOK_UP : eye * CHEST),
      this._killAt.z
    );
    // The line from the body to the killer — the camera sits beyond the killer
    // on that same line, so what is drawn is the shot he actually had.
    this._flat.set(
      this._killAt.x - this._anchor.x,
      0,
      this._killAt.z - this._anchor.z
    );
    const flat = this._flat.length();
    if (flat < 0.5) {
      // He was on top of you. Back off along the view instead of dividing by
      // nothing, and look down at the two of you.
      this._flat.set(0, 0, 1);
    } else {
      this._flat.divideScalar(flat);
    }
    this._want.copy(this._look).addScaledVector(this._flat, back);
    this._want.y = this._killAt.y + up;
    /**
     * FROM THE KILLER, NOT FROM THE BODY. The camera stands beyond him, so a
     * cast anchored on the corpse runs the whole length of his shot and parks
     * the camera at the first wall in it — with him behind the lens. @see the
     * header; it is the entire reported bug.
     */
    if (this._avoidWall(this._look, this._want) >= MIN_BACK) return;
    // A wall right off his back. Go over the top rather than into his head.
    this._want.copy(this._look).addScaledVector(this._flat, 1.1);
    this._want.y = this._killAt.y + Math.max(up, eye + 2.0);
    this._avoidWall(this._look, this._want);
  }

  _killShot(dt) {
    this._solveKillShot();
    // Ease in hard at the cut and settle: 1 - exp(-6 dt) is ~0.1 on a 60 Hz
    // frame, so the move is legible rather than a snap.
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

  /**
   * Pull `want` in toward `from` if the level is in the way. Mutates `want`,
   * leaves `_dir` holding the unit vector from `from` to it, and returns how
   * far apart the two ended up — which is how `_solveKillShot` knows its first
   * candidate was squashed against a wall.
   */
  _avoidWall(from, want) {
    const phys = this._phys ?? (this._phys = this.ctx.peek('physics'));
    this._dir.copy(want).sub(from);
    const d = this._dir.length();
    if (!phys || d < 1e-3) return d;
    this._dir.divideScalar(d);
    const hit = phys.sphereCast(from, this._dir, 0.22, d, phys.MASK.WORLD);
    if (!hit?.hit) return d;
    const cut = Math.max(0.5, hit.distance - 0.1);
    want.copy(from).addScaledVector(this._dir, cut);
    return cut;
  }
}
