/**
 * ════════════════════════════════════════════════════════════════════════════
 * MATCH — THE WAR THE PLAYER IS NOT IN
 * ════════════════════════════════════════════════════════════════════════════
 * 「もっと実際の戦争の現場みたいな感じにして そこらじゅうに銃撃や銃弾が飛び交い、
 *  爆撃もあり」
 *
 * NACHTFELD is a 350 m night plain that reads as a quiet field forty men
 * occasionally meet in. Its air war is six bomber runs and six gun runs on a
 * 1200 s clock — 0.6 aircraft a minute against the town's 0.8 on a map a third
 * the size — and between them there is nothing at all. Everything a player can
 * see past 60 m is scenery.
 *
 * This file puts fighting in the gaps: small-arms exchanges across the open
 * ground between the objectives, the same on the mountain that walls the bowl
 * in, and artillery working over ground on the far side of it. None of it is
 * within a hundred metres of an objective, none of it is anybody's men, and —
 * the part that matters most — NONE OF IT CAN HURT ANYONE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE HARD CONSTRAINT, AND WHY EVERY DECISION BELOW FALLS OUT OF IT
 * ────────────────────────────────────────────────────────────────────────────
 * Two things of this exact shape have already been rejected here: regions that
 * take your kit with no way of seeing them coming, and activity that happens
 * 「意味もなく」. Ambient war that kills you from nowhere is strictly worse than a
 * quiet map, and ambient war you cannot tell from being shot at makes the
 * complaint this repo is currently answering — 「全然撃ってない」, the bots do not
 * shoot enough — WORSE, because it puts fire on screen that answers nothing.
 *
 * So there are three rules and they are structural rather than tuned:
 *
 *   1. NOTHING HERE EMITS DAMAGE. Not an `explosion` event, not a
 *      `damage:dealt`, not a `world.damageAt`, not a physics ray. The whole
 *      file's output is four `fx.far*` calls and one `audio.play`. There is no
 *      code path from this module to anybody's health, which is a stronger
 *      statement than "the numbers are safe" — @see `_fire` and `_shell`.
 *
 *   2. AMBIENT FIRE IS ALWAYS BROADSIDE AND ALWAYS ARCING. Every engagement is
 *      a fixed pair of positions and rounds only ever travel BETWEEN them, so
 *      no tracer is ever on a line to the camera; and `fx.farTracer` gives the
 *      round real droop over its 70-100 m flight, so what the eye gets is a
 *      curve crossing the field rather than a flat streak growing towards him.
 *      Fire that is coming at you is flat, because it is coming at you.
 *      @see `FIELD_FIGHTS` for the clearances and `src/fx/warfx.js` for the arc.
 *
 *   3. IT IS A MIDDLE-DISTANCE PHENOMENON AND IT KNOWS IT. Walk towards an
 *      engagement and it fades out and stays out (`_audible`). This is not
 *      shyness, it is honesty: the positions are not men, so a player who
 *      reaches one has to find nothing there, and a firefight that keeps
 *      flashing at 20 m with nobody in it is a lie the map tells him once and
 *      then he never trusts a muzzle flash again. Everything the ramp costs is
 *      recovered the moment he turns round — the fight he walked out of is
 *      still going on behind him.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY *NOT* HERE
 * ────────────────────────────────────────────────────────────────────────────
 * A SECOND ARTILLERY SYSTEM THAT LANDS ON THE PLAYER. `match` already has one
 * — `MatchSystem._callZoneBombard` walks five 16 m shells across whichever
 * capture point has been sat on longest, behind ten seconds of `ui.airAlert`
 * and a world reticle per impact. It is the one damaging area weapon on the map
 * the player has already been taught to read, and the right way to add shelling
 * that can kill is to let THAT fire more often (@see `MAP_RULES.plains` in
 * rules.js), not to introduce a second one with its own telegraph vocabulary.
 * The shelling in this file is on the mountain, where the answer to "how does
 * he see it coming" is that he does not have to.
 *
 * NEW STRIKE SITES. `PLAINS_STRIKE_SITES` is empty for a measured reason
 * (`_findRoof` accepts any plane at 3 m and the plain's swell crosses it — the
 * town's table once built 2 682 chunks of masonry hanging in a field), and
 * wanting more explosions is not a reason to re-open it.
 *
 * A LIGHT. `LightPool` is four lights for the whole game and the burning ridge
 * has already lost a fight for one of them. Nothing in this file or in
 * `src/fx/warfx.js` calls `lights.flash`.
 *
 * THE TOWN. AL-MARIYA is 114x141 m with a building every 20 m: there is no
 * middle distance to put a fight in, the request was about the plain, and an
 * empty town table is one fewer thing that can regress on a map nobody asked to
 * change. `MAP_FIELD.town` is `[]` and the system disables itself and says so.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLIC API   const w = ctx.get('match').warfield
 * ────────────────────────────────────────────────────────────────────────────
 *   w.fights          [{ id, kind, ax, az, bx, bz, … }] world space
 *   w.enabled         false stops everything on the next frame
 *   w.stats           { rounds, shells, muted } since the last reset
 *   w.reset()         round reset: every engagement idle, the guns silent
 */

import * as THREE from 'three';
import { forMap } from './geography.js';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE ENGAGEMENTS ON THE FIELD ITSELF
 * ────────────────────────────────────────────────────────────────────────────
 * Six pairs of positions in LEVEL space, which on NACHTFELD is world space
 * (@see `geography.js` — the plain is authored at yaw 0, scale 1, origin 0).
 * Fire runs between the two ends of a pair and nowhere else.
 *
 * WHERE THEY ARE IS THE SAFETY ARGUMENT, so it is stated per-pair rather than
 * asserted. Every endpoint is
 *
 *   · inside the walkable disc (`PLAINS.RIDGE_R0` = 176) — this is fire ON the
 *     field, not decoration hung on the wall, and the whole point of it is that
 *     it happens on ground the player recognises;
 *   · at least 37 m from the nearest zone centre, i.e. clear of the 14 m
 *     capture circle by more than the circle again. An exchange INSIDE a circle
 *     would be indistinguishable from the fight for the point, which is the one
 *     confusion that would make the AI complaint worse;
 *   · at least 55 m from either base pad, so nobody spawns looking at one;
 *   · in a quarter of the map with no objective in it, which is why they are
 *     mostly out on the perimeter — that is where NACHTFELD's empty ground is.
 *
 * The zones for the arithmetic: A(-118,-104) C(-128,86) B(118,104) E(128,-86)
 * D(0,0), pads at (-14,-150) and (14,150). @see `PLAINS.ZONES`.
 */
const PLAINS_FIGHTS = [
  /** The west edge, between A and C. 100 m of front, 62 m off A, 53 m off C. */
  { id: 'WESTGAP', a: [-160, -58], b: [-158, 42] },
  /** Its mirror on the east, between E and B. */
  { id: 'EASTGAP', a: [158, -42], b: [160, 58] },
  /**
   * The north-east quarter — the empty ground between the north base's fan and
   * zone E. 69 m of front, 60 m off the pad, 47 m off E.
   */
  { id: 'NORTHEAST', a: [46, -150], b: [112, -130] },
  /** Its mirror: the south-west quarter, between the south pad and C. */
  { id: 'SOUTHWEST', a: [-46, 150], b: [-112, 130] },
  /**
   * Mid-west, and the one that matters most: this is the pair D can SEE. 90 m
   * of front at 110-120 m from the centre of the map, which is exactly the
   * band a man standing on the contested point can read as a fight without
   * being able to reach it. 59 m off C, 67 m off nothing else.
   */
  { id: 'WESTCENTRE', a: [-118, 20], b: [-70, 96] },
  /** Its mirror, and the same argument from the other side of D. */
  { id: 'EASTCENTRE', a: [118, -20], b: [70, -96] },
];

/** @see the note at the head of the file. AL-MARIYA has no middle distance. */
const TOWN_FIGHTS = [];
const MAP_FIGHTS = { town: TOWN_FIGHTS, plains: PLAINS_FIGHTS };

/**
 * ────────────────────────────────────────────────────────────────────────────
 * AND THE WAR ON THE MOUNTAIN
 * ────────────────────────────────────────────────────────────────────────────
 * The bowl's face, past `RIDGE_R0`, pitches over at 50-64° — `NavGrid` refuses
 * it, the character controller cannot climb it, and NOTHING IS AUTHORED THERE
 * BY ANYBODY. That makes it the one piece of this map where "there are men
 * fighting over there" costs nothing at all to say: he cannot walk to it, so it
 * can never fail to be there when he arrives, and it can never be mistaken for
 * a fight he could join.
 *
 * BEARINGS ARE CHOSEN BETWEEN THE FIVE BURNING RIDGE SITES rather than on them.
 * `plains.js` puts fires at bearings -139°, -66°, +14°, +78° and +150°, each
 * with a 600 cd light and a real fire on it; a muzzle flash on top of one is a
 * spark in a bonfire. Halfway between two fires is unlit ground with a lit
 * horizon behind it, which is where a flash reads — and it also spaces the five
 * engagements evenly round the rim, so whichever way the player is facing there
 * is one within about 70° of his eye.
 *
 * The pair straddles the bearing and straddles the SLOPE (192 m and 216 m out),
 * so the rounds run across the face and up it. A tracer climbing a mountain at
 * 200 m is the most unambiguous "not at you" in the game.
 */
const RIM_BEARINGS = [-102, -26, 46, 114, -174];
/** Inner and outer radius of a rim pair, metres. Both well past `RIDGE_R0`. */
const RIM_R = [192, 216];
/** Half the angular separation of a rim pair, degrees. 7° at 200 m is ~49 m. */
const RIM_SPREAD = 7;

/* ───────────────────────────────────────────────────── small-arms pacing ── */
/**
 * HOW MANY MAY BE FIRING AT ONCE. Three is the number that makes the map feel
 * occupied without turning the night into a light show — measured by eye at 1,
 * 3 and 6: one reads as an incident, six reads as a screensaver, three reads as
 * a front. It is a hard cap taken in draw order, so a fourth engagement whose
 * timer comes up simply waits rather than queueing.
 */
const MAX_ACTIVE = 3;
/** Seconds an engagement is quiet, before and after a burst. */
const FIELD_GAP = [10, 26];
const RIM_GAP = [7, 19];
/** Seconds an exchange lasts once it starts. */
const FIELD_BURST = [3.5, 9.0];
const RIM_BURST = [3.0, 8.0];
/**
 * Rounds a second, per engagement, while it is firing.
 *
 * A rifle is ~10 and this is meant to read as six to ten men, so the field's 20
 * is deliberately a SECTION rather than a man. The rim's is lower because it is
 * further away and reads at half the density anyway.
 */
const FIELD_RATE = 20;
const RIM_RATE = 12;
/** Seconds before the exchange swaps ends. Both sides shoot; neither wins. */
const SWAP = [0.45, 1.25];
/** Fraction of rounds that carry a tracer. Belts are 1:4; 1:2 reads better. */
const TRACER_FRAC = 0.55;
/** Fraction of rounds that show where they landed. @see `farImpact`. */
const IMPACT_FRAC = 0.5;
/** Metres of frontage the flashes are spread over — a section, not a man. */
const FRONTAGE = 7.0;
/** Metres of scatter on the beaten zone at the far end. */
const BEATEN = 5.0;
/** Metres over the local ground a man's muzzle sits. */
const MUZZLE_Y = 1.35;

/* ─────────────────────────────────────────────────────── the honesty ramp ── */
/**
 * The proximity fade. Below `MUTE_NEAR` metres from the nearer END of an
 * engagement it is silent; it comes back linearly and is at full strength by
 * `MUTE_FAR`. The second pair is the same test against the LINE, for a player
 * standing beside the middle of one rather than at an end of it.
 *
 * WHY IT IS A RAMP AND NOT A SWITCH: a firefight that stops dead as you cross a
 * line is a more obvious lie than one that was never there. Fading the rate
 * (which is what `_audible` returns — a multiplier, not a boolean) makes the
 * approach read as the fight moving off, which is the one thing a fight in a
 * war is actually likely to do.
 */
const MUTE_NEAR = 50;
const MUTE_FAR = 96;
const LINE_NEAR = 28;
const LINE_FAR = 62;
/** Past this the engagement is not drawn at all — nothing on this map is. */
const CULL = 460;

/* ────────────────────────────────────────────────────────────── the guns ── */
/**
 * THE SHELLING, AND WHY IT IS ALL ON THE FAR SIDE OF THE RIDGE.
 *
 * Every impact is placed at a radius of at least `SHELL_R[0]`, which is 20 m
 * past `PLAINS.RIDGE_R0` and therefore on the pitched face nobody can stand on.
 * That is the geometric argument; the STRUCTURAL one is that `_shell` emits no
 * `explosion` event and calls nothing that takes damage, so a bug in the
 * geometry is a shell in the wrong place rather than a shell in somebody.
 *
 * `SHELL_DEEP` is the same weapon aimed over the crest, at 300-420 m, where the
 * far range stands 40-110 m tall (`farH` in `plains.js`, drawn out to r 700).
 * Nothing of it is visible except the flash and the column standing up over the
 * skyline a second later — which is what "the far end of the map is getting
 * hit" actually looks like, and it is the cheapest thing in the file.
 */
const SHELL_R = [196, 262];
const SHELL_DEEP = [300, 420];
/** Chance a barrage is a deep one, over the crest rather than on the face. */
const DEEP_CHANCE = 0.34;
/** Seconds between barrages. */
const SHELL_GAP = [9, 26];
/** Shells in one walk, and seconds between them. */
const SHELL_COUNT = [4, 8];
const SHELL_STEP_T = [0.55, 1.30];
/** Metres the fall of shot walks between rounds. */
const SHELL_STEP = [15, 27];
/** Speed of sound, m/s — the flash arrives first and that is most of the read. */
const MACH1 = 343;
/** Longest sound lag we will hold, seconds. Past this it stops reading as one event. */
const LAG_CAP = 1.9;

/**
 * Pending events — impacts waiting out a round's time of flight, and shell
 * reports waiting out the speed of sound.
 *
 * A RING, PREALLOCATED, because the alternative is an object per round at
 * sixty rounds a second and the engine contract forbids allocating in a frame.
 * Overflow overwrites the oldest, which at this size cannot happen: the longest
 * flight is 100 m / 230 m/s = 0.43 s and the peak rate is 3 x 20 = 60 a second,
 * so 26 slots would do and this is 64.
 */
const PENDING = 64;

const DEG = Math.PI / 180;

export class Warfield {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.rng = opts.rng ?? ctx.rng.fork();
    this.enabled = true;
    this.ready = false;
    this.fights = [];
    this.stats = { rounds: 0, shells: 0, bursts: 0 };

    this._fx = null;
    this._audio = null;
    this._world = null;
    /** The foot of the mountain, off `world.level.ridge`. @see `_shell`. */
    this._ridgeR0 = 0;
    this._guns = false;
    this._active = 0;
    this._cam = new THREE.Vector3();
    this._sp = new THREE.Vector3();

    /** The barrage state machine. One walk at a time, ever. */
    this._gun = { t: 0, left: 0, step: 0, x: 0, y: 0, z: 0, dx: 0, dz: 0, scale: 1, stepT: 1 };

    /** @see `PENDING`. `kind` 0 = a round landing, 1 = a shell being heard. */
    this._pend = new Array(PENDING);
    for (let i = 0; i < PENDING; i++) this._pend[i] = { t: -1, kind: 0, x: 0, y: 0, z: 0, s: 1 };
    this._pi = 0;
  }

  /**
   * Resolve the tables against the map and probe the ground under every
   * position ONCE. Nothing here is recomputed at fire time — the same rule the
   * rest of `src/match` is built on, for the same reason.
   */
  build() {
    const ctx = this.ctx;
    const world = this._world = ctx.peek('world');
    if (!world) {
      console.warn('[warfield] no world — disabled');
      return this;
    }
    const specs = forMap(MAP_FIGHTS, world, 'ambient engagements');
    const id = world.level?.id;
    if (!specs.length) {
      console.info(`[warfield] no ambient engagements authored for "${id}" — disabled`);
      return this;
    }

    const gy = (x, z) => {
      const h = world.groundHeight?.(x, z);
      return Number.isFinite(h) ? h : 0;
    };
    const p = new THREE.Vector3();
    const push = (fid, kind, ax, az, bx, bz) => {
      world.levelToWorld(ax, 0, az, p);
      const wax = p.x, waz = p.z;
      world.levelToWorld(bx, 0, bz, p);
      const wbx = p.x, wbz = p.z;
      const ay = gy(wax, waz) + MUZZLE_Y;
      const by = gy(wbx, wbz) + MUZZLE_Y;
      const dx = wbx - wax;
      const dz = wbz - waz;
      const span = Math.hypot(dx, dz);
      if (!(span > 20)) {
        console.error(`[warfield] ${fid}: ${span.toFixed(1)} m of front — DROPPED`);
        return;
      }
      this.fights.push({
        id: fid,
        kind,
        ax: wax, ay, az: waz,
        bx: wbx, by, bz: wbz,
        /** Unit vector along the front, for the frontage jitter. */
        ux: dx / span, uz: dz / span,
        span,
        rate: kind === 'rim' ? RIM_RATE : FIELD_RATE,
        gap: kind === 'rim' ? RIM_GAP : FIELD_GAP,
        burst: kind === 'rim' ? RIM_BURST : FIELD_BURST,
        /** > 0 while firing; otherwise this is the countdown to the next burst. */
        t: this.rng.range(1.5, 14),
        on: false,
        acc: 0,
        side: 0,
        swap: 0,
        /** Audio throttle: one coalesced far voice per engagement per window. */
        voice: 0,
      });
    };

    for (const s of specs) push(s.id, 'field', s.a[0], s.a[1], s.b[0], s.b[1]);

    /**
     * THE RIM IS PLAINS-ONLY AND IT IS GATED ON THE RIDGE EXISTING, not on the
     * level id: a map with no `RIDGE_R0` has no unreachable face to put this
     * on, and putting it on reachable ground would break rule 3 at the top of
     * this file. `world.level.ridge` is what `plains.js` publishes.
     */
    const ridge = world.level?.ridge;
    this._ridgeR0 = ridge?.r0 ?? 0;
    if (ridge && ridge.r0 >= 100) {
      for (const bearing of RIM_BEARINGS) {
        const a = (bearing - RIM_SPREAD) * DEG;
        const b = (bearing + RIM_SPREAD) * DEG;
        push(
          `RIM${bearing < 0 ? 'M' : ''}${Math.abs(bearing)}`,
          'rim',
          Math.cos(a) * RIM_R[0], Math.sin(a) * RIM_R[0],
          Math.cos(b) * RIM_R[1], Math.sin(b) * RIM_R[1]
        );
      }
      this._guns = true;
    } else {
      this._guns = false;
      console.info('[warfield] no ridge on this map — the shelling is disabled');
    }
    this._gun.t = this.rng.range(6, 18);

    this.ready = this.fights.length > 0;
    const far = this.fights.filter((f) => f.kind === 'rim').length;
    console.info(
      `[warfield] ${this.fights.length} ambient engagements on "${id}" — ` +
        `${this.fights.length - far} on the field, ${far} on the rim, ` +
        `${this._guns ? 'shelling past r' + SHELL_R[0] : 'no shelling'}; ` +
        'none of it carries damage'
    );
    return this;
  }

  /** Round reset: everybody quiet, the guns re-timed, the ring drained. */
  reset() {
    for (const f of this.fights) {
      f.on = false;
      f.acc = 0;
      f.t = this.rng.range(1.5, 14);
      f.voice = 0;
    }
    this._gun.left = 0;
    this._gun.t = this.rng.range(6, 18);
    for (const e of this._pend) e.t = -1;
    this._active = 0;
    this.stats.rounds = 0;
    this.stats.shells = 0;
    this.stats.bursts = 0;
  }

  /**
   * @param {number} dt
   * @param {boolean} live  only the SCHEDULER is gated on this — a burst that
   *   is running when the whistle goes finishes, exactly as the aircraft do.
   */
  update(dt, live) {
    if (!this.ready || !this.enabled) return;
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (!fx) return;
    this._cam.setFromMatrixPosition(this.ctx.camera.matrixWorld);

    this._drain(dt, fx);

    let active = 0;
    for (let i = 0; i < this.fights.length; i++) {
      const f = this.fights[i];
      if (f.on) active++;
    }
    this._active = active;

    for (let i = 0; i < this.fights.length; i++) {
      this._step(this.fights[i], dt, live, fx);
    }
    if (this._guns) this._stepGun(dt, live, fx);
  }

  /* ------------------------------------------------------------ the men -- */

  /**
   * One engagement's clock.
   *
   * `gain` is the honesty ramp and it multiplies the RATE rather than gating
   * the burst, so an engagement the player has walked into does not stop
   * existing — it thins out, and thickens again behind him.
   */
  _step(f, dt, live, fx) {
    f.t -= dt;
    if (!f.on) {
      if (f.t > 0) return;
      // The cap is taken here, at the moment of starting, so a fourth
      // engagement waits a beat rather than joining and being thinned.
      if (!live || this._active >= MAX_ACTIVE) {
        f.t = this.rng.range(1.4, 3.6);
        return;
      }
      f.on = true;
      f.t = this.rng.range(f.burst[0], f.burst[1]);
      f.acc = 0;
      f.side = this.rng.int(0, 1);
      f.swap = this.rng.range(SWAP[0], SWAP[1]);
      this._active++;
      this.stats.bursts++;
      return;
    }
    if (f.t <= 0) {
      f.on = false;
      f.t = this.rng.range(f.gap[0], f.gap[1]);
      this._active--;
      return;
    }

    f.swap -= dt;
    if (f.swap <= 0) {
      f.side ^= 1;
      f.swap = this.rng.range(SWAP[0], SWAP[1]);
    }

    const gain = this._audible(f);
    if (gain <= 0) {
      f.acc = 0;
      f.voice -= dt;
      return;
    }

    f.acc += dt * f.rate * gain;
    // Cap the catch-up: a frame spike must not fire a second's worth of rounds
    // into one frame, which is the difference between a firefight and a strobe.
    let n = f.acc | 0;
    if (n > 6) n = 6;
    f.acc -= n;
    for (let k = 0; k < n; k++) this._fire(f, fx);

    f.voice -= dt;
    if (n > 0 && f.voice <= 0) this._say(f, gain);
  }

  /**
   * ONE ROUND. Reads: a flash at the firing end, a tracer between the two ends
   * about half the time, and an impact at the far end about half the time,
   * DELAYED BY ITS OWN TIME OF FLIGHT so the streak arrives before the strike.
   *
   * THIS METHOD IS THE WHOLE OUTPUT OF THIS FILE'S SMALL ARMS AND IT TOUCHES
   * NOTHING BUT `fx`. There is no ray, no `explosion`, no `damage:dealt`, no
   * actor and no team. It cannot hurt anybody because there is nothing here
   * that could.
   */
  _fire(f, fx) {
    const rng = this.rng;
    const from = f.side === 0;
    const sx = from ? f.ax : f.bx;
    const sy = from ? f.ay : f.by;
    const sz = from ? f.az : f.bz;
    const tx = from ? f.bx : f.ax;
    const ty = from ? f.by : f.ay;
    const tz = from ? f.bz : f.az;

    // Spread the muzzles across a section's frontage, perpendicular to the
    // front: a line of flashes all from one point is one man with a very fast
    // rifle. (-uz, ux) is the perpendicular; no allocation, no normalise.
    const o = rng.range(-FRONTAGE * 0.5, FRONTAGE * 0.5);
    const mx = sx - f.uz * o;
    const mz = sz + f.ux * o;
    const my = sy + rng.range(-0.35, 0.45);

    fx.farFlash(mx, my, mz, f.kind === 'rim' ? 1.25 : 1.0);

    const bo = rng.range(-BEATEN, BEATEN);
    const ix = tx - f.uz * bo + rng.range(-2.2, 2.2);
    const iz = tz + f.ux * bo + rng.range(-2.2, 2.2);
    /**
     * THE BEATEN ZONE IS RE-PROBED, and on the rim it has to be.
     *
     * `world.groundHeight` is the level's own ANALYTIC floor — an expression,
     * not a raycast and not a BVH query — so this is a handful of sines per
     * round at a peak of thirty rounds a second, which is nothing. Taking the
     * far end's own height instead would be fine on the field (the swell moves
     * centimetres over 7 m) and wrong on the mountain, where the face pitches
     * at 50-64° and a 5 m offset is four metres of altitude: half the strikes
     * would hang in the air and the other half would be buried.
     */
    const gh = this._world?.groundHeight?.(ix, iz);
    const iy = (Number.isFinite(gh) ? gh : ty - MUZZLE_Y) + 0.08 + rng.range(0, 1.0);

    if (rng.float() < TRACER_FRAC) fx.farTracer(mx, my, mz, ix, iy, iz);
    if (rng.float() < IMPACT_FRAC) {
      // Time of flight, so the strike lands after the streak gets there rather
      // than with it. `farTracer`'s own speed, stated once in `warfx.js`.
      this._later(Math.hypot(ix - mx, iy - my, iz - mz) / 230, 0, ix, iy, iz, f.kind === 'rim' ? 1.3 : 1.0);
    }
    this.stats.rounds++;
  }

  /**
   * THE SOUND, THROUGH THE ONE VOICE THAT ALREADY EXISTS FOR IT.
   *
   * `audio.play('far', …)` is `distantFire` — the coalesced several-rounds-on-
   * one-emitter shape `src/audio/battle.js` built for exactly this, gunfire
   * that has crossed a hundred metres of air. This file authors NO audio: it
   * offers a position, a distance and a burst length to the existing one, at a
   * rate throttled well under what the bots' own fire already puts through the
   * same voice (`battle.js` measured ~1.6 far voices a second for the whole
   * war; this adds at most ~1.2 with all three engagements audible).
   */
  _say(f, gain) {
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    f.voice = this.rng.range(0.75, 1.5);
    if (!audio || !audio.play) return;
    const from = f.side === 0;
    this._sp.set(from ? f.ax : f.bx, from ? f.ay : f.by, from ? f.az : f.bz);
    audio.play('far', this._sp, {
      rounds: 3 + this.rng.int(0, 3),
      spacing: this.rng.range(0.07, 0.13),
      level: 0.55 * gain,
      maxDist: 520,
    });
  }

  /**
   * THE RAMP. 0 when the player is on top of an engagement, 1 when he is far
   * enough away for it to be honest. Two tests — the nearer END, for somebody
   * walking at a muzzle flash, and the LINE, for somebody standing beside the
   * middle of one — and the smaller wins.
   */
  _audible(f) {
    const c = this._cam;
    const da = Math.hypot(c.x - f.ax, c.z - f.az);
    const db = Math.hypot(c.x - f.bx, c.z - f.bz);
    const near = da < db ? da : db;
    if (near > CULL) return 0;
    let g = (near - MUTE_NEAR) / (MUTE_FAR - MUTE_NEAR);
    if (g > 1) g = 1;
    if (g <= 0) return 0;

    // Distance to the segment, in the ground plane.
    let t = ((c.x - f.ax) * f.ux + (c.z - f.az) * f.uz) / f.span;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = f.ax + f.ux * f.span * t;
    const pz = f.az + f.uz * f.span * t;
    const dl = Math.hypot(c.x - px, c.z - pz);
    let gl = (dl - LINE_NEAR) / (LINE_FAR - LINE_NEAR);
    if (gl > 1) gl = 1;
    if (gl <= 0) return 0;
    return g < gl ? g : gl;
  }

  /* ----------------------------------------------------------- the guns -- */

  /**
   * A WALKING BARRAGE ON THE OTHER SIDE OF THE MOUNTAIN.
   *
   * The walk is what makes it artillery rather than a firework: a battery
   * ranges, corrects and walks the fall of shot along a bearing, so consecutive
   * flashes step in one direction at one interval and the player's eye finishes
   * the sentence. A random scatter of flashes on a hillside reads as nothing.
   */
  _stepGun(dt, live, fx) {
    const g = this._gun;
    if (g.left > 0) {
      g.t -= dt;
      if (g.t > 0) return;
      g.t += g.stepT;
      g.left--;
      this._shell(g.x, g.z, g.scale, fx);
      g.x += g.dx;
      g.z += g.dz;
      return;
    }
    g.t -= dt;
    if (g.t > 0 || !live) return;

    const rng = this.rng;
    const deep = rng.float() < DEEP_CHANCE;
    const band = deep ? SHELL_DEEP : SHELL_R;
    const a = rng.float() * Math.PI * 2;
    const r = rng.range(band[0], band[1]);
    g.x = Math.cos(a) * r;
    g.z = Math.sin(a) * r;
    // Walk tangentially: along the face rather than up or down it, so the whole
    // barrage stays in the band its radius was chosen from and cannot creep in
    // over the ridge line.
    const step = rng.range(SHELL_STEP[0], SHELL_STEP[1]) * (rng.float() < 0.5 ? -1 : 1);
    g.dx = -Math.sin(a) * step;
    g.dz = Math.cos(a) * step;
    g.left = rng.int(SHELL_COUNT[0], SHELL_COUNT[1]);
    g.stepT = rng.range(SHELL_STEP_T[0], SHELL_STEP_T[1]);
    g.scale = deep ? rng.range(1.5, 2.1) : rng.range(0.95, 1.5);
    g.t = 0;
  }

  /**
   * ONE SHELL. Like `_fire` this emits NOTHING but pixels and one existing
   * sound — no `explosion` event, no radius, no damage, no `world.damageAt`.
   *
   * THE RADIUS IS CLAMPED HERE AND NOT ONLY IN THE CALLER. `world.level.ridge.r0` is
   * the edge of the ground a man can stand on, and a shell inside it would be
   * an unannounced flash among the players even though it could not hurt one.
   * The clamp is two lines and it makes the guarantee independent of every
   * number in the walk above.
   */
  _shell(x, z, scale, fx) {
    const r = Math.hypot(x, z);
    const min = this._ridgeR0 + 14;
    if (r < min) {
      const k = min / (r || 1);
      x *= k;
      z *= k;
    }
    const h = this._world?.groundHeight?.(x, z);
    const y = Number.isFinite(h) ? h : 0;
    fx.farShell(x, y + 0.4, z, scale);
    this.stats.shells++;

    // The report, held for the flight of the SOUND. A flash on a mountain and
    // a bang three-quarters of a second later is the single cheapest thing in
    // this file and the one that most makes it read as distance.
    const d = Math.hypot(this._cam.x - x, this._cam.y - y, this._cam.z - z);
    this._later(Math.min(LAG_CAP, d / MACH1), 1, x, y, z, scale);
  }

  /* --------------------------------------------------------- the deferrals */

  /** Put an event in the ring. @see `PENDING` — never allocates, never grows. */
  _later(t, kind, x, y, z, s) {
    const e = this._pend[this._pi];
    this._pi = (this._pi + 1) % PENDING;
    e.t = t;
    e.kind = kind;
    e.x = x; e.y = y; e.z = z;
    e.s = s;
  }

  /** Retire everything whose clock has run out. One pass, no allocation. */
  _drain(dt, fx) {
    const pend = this._pend;
    for (let i = 0; i < PENDING; i++) {
      const e = pend[i];
      if (e.t < 0) continue;
      e.t -= dt;
      if (e.t > 0) continue;
      e.t = -1;
      if (e.kind === 0) {
        fx.farImpact(e.x, e.y, e.z, e.s);
      } else {
        const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
        if (audio?.play) {
          this._sp.set(e.x, e.y, e.z);
          audio.play('strike_tail', this._sp, {
            level: 0.42 * e.s,
            dur: 2.6 + e.s,
            maxDist: 800,
            gain: 1.5,
            occlusion: 0,
          });
        }
      }
    }
  }

  /** Nothing is owned: no geometry, no material, no texture, no pooled slot. */
  dispose() {
    this.enabled = false;
    this.ready = false;
    this.fights.length = 0;
    this._fx = null;
    this._audio = null;
    this._world = null;
  }
}
