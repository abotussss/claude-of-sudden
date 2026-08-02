/**
 * AUDIO — synthesized weapon/foley audio, spatialisation, reverb, occlusion, mix
 *
 * Everything is generated with the Web Audio API. There is not a single audio
 * file in the project.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * PUBLIC API   const audio = ctx.get('audio')
 * ───────────────────────────────────────────────────────────────────────────
 *   audio.running                      graph is live (needs a user gesture)
 *   audio.start()                      force-start (returns Promise<boolean>)
 *   audio.deafness                     0..1 concussion; UI/post may read this
 *   audio.play(kind, position, opts)   one-shot; position null = head-locked
 *   audio.bark(kind, position, opts)   enemy voice: 'spot' | 'reload' |
 *                                      'grenade' | 'flank' | 'suppress' |
 *                                      'advance' | 'hurt' | 'death' | 'copy'
 *   audio.ui(kind)                     'hitmarker'|'headshot'|'kill'|'damage'
 *   audio.setMasterVolume(v)  audio.setBusVolume(bus, v)
 *   audio.setAmbienceIntensity(v)      scales the distant-battle scheduler
 *   audio.battle                       the BattleLayer: distant gunfire, other
 *                                      men's footsteps, armour. `.enabled=false`
 *                                      turns all three off at runtime (A/B).
 *   audio.report()                     diagnostics snapshot
 *   audio.diagnose()                   THE DROPOUT PANEL, as an object. The same
 *                                      numbers are on screen with `?audiodbg=1`
 *                                      or the F9 key. @see src/audio/watchdog.js
 *   audio.watchdog                     resume / reset / drain / rebuild ladder
 *
 * All of it is a no-op — never a throw — before the graph exists, so callers
 * never have to check whether audio started.
 *
 * Driven off the canonical events in ARCHITECTURE.md: weapon:fire,
 * weapon:reload, weapon:bolt, weapon:melee, weapon:shell, bullet:impact,
 * bullet:tracer, damage:dealt, damage:taken, actor:death, player:land,
 * player:footstep, player:state, explosion. If `ai` emits the optional
 * `ai:bark {kind, position, voice}` it is picked up as well.
 */

import { NoiseBank, SPEED_OF_SOUND, clamp, lerp, gain as mkGain } from './dsp.js';
import { Mixer } from './mixer.js';
import { SpatialField, gunRangeGain, blastRangeGain } from './spatial.js';
import { Ambience, ambientOneShot, ONE_SHOTS } from './ambience.js';
import {
  WEAPON_PROFILES, resolveProfile, weaponShot, bulletWhizz, dryFire, boltCycle,
  distantFire, farGain,
} from './weapons.js';
import { tankGun } from './vehicle.js';
import { collapseTear, collapseSub, collapseBell } from './collapse.js';
import { BattleLayer } from './battle.js';
import { AudioWatchdog } from './watchdog.js';
import {
  surfaceImpact, footstep, shellCasing, reloadPhase, explosion, bodyFall, uiSound,
  heartbeat, cloth, meleeSwing, meleeHit,
} from './foley.js';
import {
  strikeJet, strikeIncoming, strikeRubble, strikeTail, strafeCannon, rubbleCollapse,
} from './airstrike.js';
import { bark as voxBark, barkFor } from './vox.js';
import { classifySpace } from './ir.js';

const PROBE_RAYS = 9;
const PROBE_DIST = 40;
const DRY_SLOTS = 48;

/**
 * Level trim for the LOCAL player's own footfalls and landings.
 *
 * It was 0.72 — quieter than every other actor in the level. Your own steps are
 * the metronome you move to and the thing that tells you you have stopped being
 * quiet, so they are staged above a remote step rather than below it.
 *
 * MEASURED at this value, against a first-person rifle shot and the ambience
 * bed rendered through the same mixer (peaks, and the bed as RMS):
 *
 *   rifle shot  0.0608     walk 0.0238   run 0.0353   sprint 0.0416
 *   land 0.0415   crouch-walk 0.0169     ambience bed rms 0.00362
 *
 * So a walking step lands 8.1 dB under the shot's peak and 16.4 dB over the
 * bed, and crouch-walking is 11.1 dB under the shot — quiet, but still 13.4 dB
 * clear of the bed, which is the point of crouching rather than of silence.
 */
const OWN_STEP_LEVEL = 1.05;

/** Upward ray length for the remote-shooter enclosure test, metres. */
const ROOF_PROBE = 12;
/** Wetness a shot gets with open sky over the muzzle, and with a low ceiling. */
const WET_OUTDOOR = 0.12;
const WET_INDOOR = 0.95;
const GESTURES = ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'wheel'];

/** Names other subsystems already use, mapped onto our voices. */
const UI_ALIAS = {
  hit_flesh: 'hitmarker', hit: 'hitmarker', hit_head: 'headshot', headshot: 'headshot',
  hit_kill: 'kill', hit_armour: 'armour', player_hurt: 'damage', hurt: 'damage',
  weapon_fire_dry: 'dryfire', dry: 'dryfire', low_health: 'lowhealth',
};

/** Default bus per voice kind, so callers do not have to know the mix layout. */
const BUS_FOR = {
  shot: 'weapons', explosion: 'weapons', dryfire: 'weapons',
  hitmarker: 'ui', headshot: 'ui', kill: 'ui', armour: 'ui', damage: 'ui',
  grenade_warn: 'ui', regen: 'ui', lowhealth: 'ui',
  bark: 'voice', ambient: 'ambience',
  strike_jet: 'ambience', strike_incoming: 'weapons',
  strike_rubble: 'weapons', strike_tail: 'weapons',
  strike_settle: 'weapons',
  strafe_cannon: 'weapons', strafe_walk: 'weapons',
  /** A building failing. @see src/audio/collapse.js */
  collapse_tear: 'weapons', collapse_sub: 'weapons', collapse_bell: 'weapons',
};

/**
 * VOICES THAT MAY NOT BE EVICTED, and what they are worth against each other.
 *
 * `SpatialField.acquire` will only steal a voice whose priority is at most
 * `pri + 0.25`, so a number here is a statement about what this sound is allowed
 * to interrupt AND about what may interrupt it. The cathedral is the loudest
 * event in a match and it plays into a field that the salvo has already filled —
 * measured, sixteen of twenty-four emitters — so all three of its voices sit
 * above everything, including a first-person gunshot. There are three of them,
 * once a match, and if they lose their slots the event is silent.
 */
const COLLAPSE_PRIORITY = 0.995;

/**
 * Kinds that go through `_playCollapse`, and what each is worth when the caller
 * does not say — MEASURED, not chosen.
 *
 * The first cut of these shipped at a flat 3.4 and was wrong in the one way that
 * matters for 「大聖堂破壊はもっと音大きく激しくして」: rendered through the real mixer
 * at 40 m, all three together peaked at 0.0666 against 0.1075 for the SINGLE
 * `strike_tail` the event was already playing at level 1.8 / gain 4.2. Three new
 * voices that between them are 4 dB under the voice they are supposed to be
 * adding weight to is a quieter collapse, not a bigger one.
 *
 * At these gains, same render: tear 0.061, sub 0.121, bell 0.044, all three
 * together 0.14 — against the player's own rifle at 0.0831 and the tank's main
 * gun at 0.0502. The SUB is deliberately the largest of the three, because the
 * missing thing was never loudness, it was the bottom two octaves.
 */
const COLLAPSE_KINDS = { collapse_tear: 6.2, collapse_sub: 6.6, collapse_bell: 4.6 };

/** Finite Vector3-ish check — one NaN from any subsystem must not throw. */
function isVec(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

export class AudioSystem {
  static id = 'audio';
  static deps = [];

  constructor() {
    this.running = false;
    this.failed = false;
    this.actx = null;
    this.mixer = null;
    this.field = null;
    this.ambience = null;
    this.bank = null;
    this.deafness = 0;

    /* preallocated scratch — update() allocates nothing */
    this._probeDirs = [];
    for (let i = 0; i < PROBE_RAYS - 1; i++) {
      const a = (i / (PROBE_RAYS - 1)) * Math.PI * 2;
      this._probeDirs.push({ x: Math.cos(a), y: 0.06, z: Math.sin(a) });
    }
    this._probeDirs.push({ x: 0, y: 1, z: 0 });
    this._probeHits = new Float64Array(PROBE_RAYS);
    this._space = {
      tight: 0, room: 0, street: 0.35, tunnel: 0, open: 0.65,
      enclosure: 0, meanFree: PROBE_DIST, ceiling: PROBE_DIST,
    };
    this._probeTimer = 0;
    this._lastProbe = { x: 1e9, y: 0, z: 0 };
    this._origin = { x: 0, y: 0, z: 0 };

    /* dry (head-locked) voice bookkeeping */
    this._dry = [];
    for (let i = 0; i < DRY_SLOTS; i++) this._dry.push({ node: null, send: null, end: 0, wallEnd: 0 });
    this._dryCursor = 0;

    /* per-frame rate limits */
    /**
     * VOICE RATE LIMITS, events per SECOND, per category.
     *
     * These replaced per-FRAME budgets, and the difference is the whole bug.
     * A budget of "4 impacts per frame" is 240 impacts a second at 60 fps and
     * 480 at 120 — the limit scaled with the frame rate, which is exactly
     * backwards. Summed across categories the old budgets admitted ~840 voices
     * a second into a pool of 48 that holds each voice for roughly half a
     * second: an order of magnitude oversubscribed, permanently.
     *
     * MEASURED before the fix, one 7v7 round in: the field sat at 100% capacity
     * from t=24s and never recovered, with 10023 voices dropped and 5053 stolen
     * against 7490 played. From the player's seat that is audio glitching and
     * then vanishing — the reported bug.
     *
     * THE RATES ARE SET FROM MEASURED VOICE LIFETIME, not from taste. Dumping
     * the live pool mid-firefight showed the held emitters carrying 0.1 to 8.4
     * SECONDS of remaining life, median around two: a gunshot holds its emitter
     * for the whole dry tail, not for the 200 ms of transient you actually hear.
     * With a 48-voice pool and a ~2 s mean life the sustainable admission rate is
     * about 24 voices a second — so 38 was still 1.6x oversubscribed and the
     * pool still never had a free slot.
     *
     * These sum to 24 a second, i.e. well under the pool, which leaves slack for
     * the things that must never be dropped: explosions, deaths, barks, reloads,
     * and the ambience beds (which are `tracked` and therefore unstealable).
     * Density is carried by the shared reverb bus, not by voice count — eight
     * distinct spatialised cracks a second already reads as a firefight.
     *
     * The exact values are a mix I could not verify by ear, only by counters, so
     * they are deliberately a plain mutable object: `audio._rate.impact = 10` at
     * the console re-tunes it live without a reload.
     * Nobody can hear the difference between fourteen impacts a second and two
     * hundred; everybody can hear the difference between working audio and none.
     *
     * The player's OWN weapon is not in this table on purpose — it goes through
     * `_playDry`, head-locked, outside the spatial pool entirely.
     */
    /**
     * RE-BUDGETED FOR FIFTEEN A SIDE.
     *
     * The comment under `_onFire` describes this exact failure being fixed once
     * already, for 7v7: the spatial field pinned at capacity, thousands of
     * voices stolen, and from the player's seat "the audio glitches and then
     * goes away". It came back the moment the roster went to 15v15 — MEASURED in
     * a live match, the 48-emitter field sat at 48/48 with 818 voices stolen
     * inside two minutes, against 0 stolen at 7v7.
     *
     * Of course it did: the three rules that fixed it were sized against
     * THIRTEEN actors on a 76x94 m map. There are thirty now, on 114x141 m.
     * Eight remote shots a second was one every 1.6 shooters; it is now one
     * every 3.75, so the same wall of noise costs 2.3x the slots.
     */
    /** Debounce state for `_onAirPhase`. Preallocated: nothing per frame. */
    this._settle = { at: 0, x: 0, y: 0, z: 0 };
    this._lastBomberRun = null;
    /**
     * `shot` 5 -> 10 A SECOND, and it is affordable because of the line above it
     * in `_onFire`: the rate limit now only ever sees shots INSIDE 60 m, which
     * over two measured minutes of 20v20 was 14 events rather than 1996. Five a
     * second was not rationing a wall of near gunfire — there was never a wall
     * of near gunfire — it was rationing the whole map through one gate.
     *
     * MEASURED against the pool it spends: the weapons bus is entitled to 45 %
     * of the field (32 slots of 72) and was using 5.3 of them on average through
     * a whole match. Ten shots a second against a ~0.9 s mean voice life is nine
     * slots, so the near path fits inside its own quota with room left for the
     * distant layer, the tank and every explosion in the game.
     */
    this._rate = { shot: 10, impact: 5, step: 4, shell: 2, whizz: 2, reload: 4, bodyfall: 2 };
    this._rateNext = { shot: 0, impact: 0, step: 0, shell: 0, whizz: 0, reload: 0, bodyfall: 0 };
    this._lastBarkTime = -99;
    this._lastEnemyFire = -99;

    this._health = 100;
    this._heartTimer = 0;
    this._stance = null;
    this._ads = false;

    this.stats = {
      voices: 0, dropped: 0, stolen: 0, rays: 0, deafness: 0,
      space: 'open', started: false, contextState: 'none', events: 0, errors: 0,
    };

    this.battle = null;
    this.watchdog = null;
    /** Preallocated option bag for the collapse voices. @see _playCollapse */
    this._collapseBag = {
      dur: undefined, size: undefined, f0: undefined, strikes: undefined,
      level: 1, gain: 5, maxDist: 640, occlusion: 0.12, send: undefined,
      extraDelay: undefined, tag: 'collapse',
    };
    /** How many times the graph has been rebuilt under it. @see _restartGraph */
    this.restarts = 0;
    this._offs = [];
    this._gestureHandler = null;
    this._ambienceApi = null;
  }

  /* ================================================================ */
  /* lifecycle                                                        */
  /* ================================================================ */

  async init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    this._wireEvents(ctx);

    // Web Audio needs a user gesture. Arm every plausible one; the first to
    // land builds the graph. Capture mode never gestures, so shots render in
    // silence and stay byte-identical.
    this._armGesture();
    if (typeof window !== 'undefined') window.__AUDIO__ = this;
  }

  /**
   * Arm every plausible user gesture. Re-armable, because a browser can take the
   * context away again long after boot — an autoplay policy suspend, an audio
   * focus change, a device that disappeared — and a `resume()` it keeps refusing
   * is a browser asking for a gesture it will never get if the listeners were
   * removed on the first click of the match. @see AudioWatchdog GUARD 1.
   */
  _armGesture() {
    if (this._gestureHandler || typeof addEventListener !== 'function') return;
    const kick = () => {
      this._disarmGesture();
      if (this.running) { this.actx?.resume?.().catch(() => {}); return; }
      this.start().catch(() => {});
    };
    this._gestureHandler = kick;
    for (const ev of GESTURES) addEventListener(ev, kick, { passive: true });
  }

  _disarmGesture() {
    if (!this._gestureHandler) return;
    for (const ev of GESTURES) removeEventListener(ev, this._gestureHandler);
    this._gestureHandler = null;
  }

  /**
   * Build the graph. Safe to call repeatedly; resolves false when audio is
   * unavailable (no AudioContext, blocked autoplay, headless renderer, ...).
   */
  async start() {
    if (this.running) return true;
    if (this.failed) return false;
    try {
      const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!AC) throw new Error('no AudioContext');
      const actx = new AC({ latencyHint: 'interactive' });
      this.actx = actx;

      this.bank = new NoiseBank(actx, this.rng.fork(), 2.4);
      this.mixer = new Mixer(actx, this.rng.fork(), {});
      this.mixer.buildReverbs();
      this.field = new SpatialField(actx, this.mixer, this.ctx);
      this.ambience = new Ambience(actx, this.bank, this.mixer, this.field, this.rng.fork());
      this.ambience.start();
      this.battle = new BattleLayer(this);
      this.watchdog = new AudioWatchdog(this);
      this.watchdog.start();
      this.mixer.setSpace(this._space, 0.001);

      if (actx.state === 'suspended') await actx.resume();
      this.running = true;
      this.stats.started = true;
      this.stats.contextState = actx.state;
      console.info(`[audio] online @ ${actx.sampleRate} Hz`);
      return true;
    } catch (err) {
      console.warn('[audio] disabled:', err?.message ?? err);
      this.failed = true;
      this._teardown();
      return false;
    }
  }

  _teardown() {
    try {
      // Before the field: it holds tracked emitters (tank engines) and loop
      // sources that have to be stopped while the context still exists.
      this.watchdog?.dispose();
      this.battle?.dispose();
      this.ambience?.dispose();
      this.field?.dispose();
      this.mixer?.dispose();
      this.bank?.dispose();
      if (this.actx && this.actx.state !== 'closed') this.actx.close();
    } catch { /* nothing useful to do */ }
    this.ambience = this.field = this.mixer = this.bank = null;
    this.battle = null;
    this.watchdog = null;
    this.actx = null;
    this.running = false;
  }

  dispose() {
    this._disarmGesture();
    for (const off of this._offs) off();
    this._offs.length = 0;
    this._teardown();
    if (typeof window !== 'undefined' && window.__AUDIO__ === this) delete window.__AUDIO__;
  }

  /* ================================================================ */
  /* frame                                                            */
  /* ================================================================ */

  update(dt, ctx) {
    if (!this.running) return;
    try {
      const actx = this.actx;
      /**
       * A CONTEXT THAT IS NOT RUNNING IS THE WATCHDOG'S PROBLEM, NOT A REASON TO
       * GIVE UP. This line used to be `if (actx.state === 'suspended') return;`
       * and nothing in the subsystem ever called `resume()` after boot — so any
       * suspend, from any cause, was permanent silence with every duck and the
       * muffle frozen at whatever value the last blast left them. The watchdog
       * runs FIRST and unconditionally for exactly that reason.
       */
      this.watchdog?.update();
      if (actx.state !== 'running') return;

      /* ---- listener from the render camera ----------------------- */
      const cam = ctx.camera;
      cam.updateMatrixWorld();
      const e = cam.matrixWorld.elements;
      this.field.setListener(
        e[12], e[13], e[14],
        -e[8], -e[9], -e[10],
        e[4], e[5], e[6]
      );

      /* ---- space probe ------------------------------------------- */
      this._probeTimer -= dt;
      const moved = Math.abs(e[12] - this._lastProbe.x) + Math.abs(e[13] - this._lastProbe.y) +
        Math.abs(e[14] - this._lastProbe.z);
      if (this._probeTimer <= 0 || moved > 1.6) {
        this._probeTimer = 0.45;
        this._lastProbe.x = e[12]; this._lastProbe.y = e[13]; this._lastProbe.z = e[14];
        this._probeSpace(ctx, e[12], e[13], e[14]);
      }

      /* ---- subsystems -------------------------------------------- */
      this.mixer.update(dt);
      this.field.update(dt);
      this.deafness = this.mixer.deafness;
      if (!this._ambienceApi) {
        this._ambienceApi = {
          distantVolley: () => this._distantVolley(),
          distantBoom: () => this._distantBoom(),
          oneShot: () => this._ambientOneShot(),
          distantChatter: () => this._distantChatter(),
        };
      }
      this.ambience.update(dt, this._ambienceApi);
      /**
       * The battle layer runs AFTER the field and the ambience, on purpose: it
       * decides what it may play from `field.busLoad()`, and that number is only
       * true once this frame's expiries have been processed.
       */
      this.battle.update(dt, actx.currentTime);

      /* ---- head-locked voice teardown ---------------------------- */
      /**
       * TWO DEADLINES HERE TOO. Forty-eight of these — your own weapon, your
       * own boots, every UI tick and grunt — and they were torn down against
       * `actx.currentTime` alone, so when the render thread falls behind they
       * all stay connected for as long as the clock is stalled. Same latch as
       * the spatial field's (see SpatialField.update), same backstop: the wall
       * clock, which cannot stall, with the same grace on it.
       */
      const now = actx.currentTime;
      const wall = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      for (let i = 0; i < this._dry.length; i++) {
        const d = this._dry[i];
        if (!d.node || (now < d.end && wall < d.wallEnd)) continue;
        try { d.node.disconnect(); } catch { /* already gone */ }
        try { d.send?.disconnect(); } catch { /* already gone */ }
        d.node = null; d.send = null;
      }

      /* ---- low-health heartbeat ---------------------------------- */
      if (this._health < 34) {
        this._heartTimer -= dt;
        if (this._heartTimer <= 0) {
          this._heartTimer = 0.62 + (this._health / 34) * 0.45;
          this._playDry('heartbeat', { level: clamp(1 - this._health / 34, 0.2, 1) }, 'foley', 0.1);
        }
      }

      /* ---- reset per-frame budgets ------------------------------- */
      /* (voice rate limiting is time-based now — nothing to reset per frame) */

      const s = this.stats;
      s.voices = this.field.stats.active;
      s.dropped = this.field.stats.dropped;
      s.stolen = this.field.stats.stolen;
      s.rays = this.field.stats.occlusionRays;
      s.deafness = this.deafness;
      s.contextState = actx.state;
    } catch (err) {
      this._error(err);
    }
  }

  /**
   * Rate limit one category of spatialised one-shot. Frame-rate independent:
   * the gate is a minimum interval on the audio clock, not a count per frame.
   * @returns {boolean} true if this event may claim a voice
   */
  _allow(kind) {
    const now = this.actx.currentTime;
    if (now < this._rateNext[kind]) return false;
    this._rateNext[kind] = now + 1 / this._rate[kind];
    return true;
  }

  /**
   * ERRORS DECAY, AND FORTY OF THEM NO LONGER END THE MATCH.
   *
   * The old rule was a running total with no clock on it: the fortieth throw of
   * a whole session tore the graph down permanently, whether those forty came
   * inside one bad second or were spread over twenty minutes of play. That is a
   * second, quieter way for the game to go silent for good — and one that a
   * pause cannot fix, which is how it can be told apart from the reported bug.
   *
   * Now the counter is a RATE. It bleeds off at one per two seconds of wall
   * time, so only a genuine storm of failures reaches the threshold, and the
   * response is to rebuild the graph rather than to switch it off. Two rebuilds
   * that both fail is a real, permanent fault and it is still fatal — a third
   * would be a loop.
   */
  _error(err) {
    const wall = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    if (this._errPrev) {
      const bleed = (wall - this._errPrev) * 0.5;
      this.stats.errors = Math.max(0, this.stats.errors - bleed);
    }
    this._errPrev = wall;
    this.stats.errors++;
    this.stats.errorsTotal = (this.stats.errorsTotal ?? 0) + 1;
    if (this.stats.errorsTotal < 6) console.error('[audio]', err);
    if (this.stats.errors < 40) return;
    this.stats.errors = 0;
    if (this.restarts >= 2) {
      console.error('[audio] too many errors after two rebuilds — disabling audio');
      this.failed = true;
      this._teardown();
      return;
    }
    console.error('[audio] error storm — rebuilding the graph');
    this._restartGraph();
  }

  /**
   * REBUILD EVERYTHING. The last rung of the watchdog's ladder, and the only
   * answer to a fault that lives in a node's internal state — a NaN through the
   * master compressor or the soft clipper poisons it permanently, and no gain
   * change, pool drain or context resume will ever bring it back.
   *
   * Everything the player has chosen survives it: master volume, ambience
   * intensity, and the diagnostic panel's own state and history, so a rebuild
   * that happens while he is reading the numbers does not wipe them.
   */
  _restartGraph() {
    const keepVolume = this.mixer?.masterVolume ?? 0.95;
    const keepAmb = this.ambience?.intensity ?? 1;
    const w = this.watchdog;
    const keepDbg = w
      ? { log: w.log.slice(0), visible: w.visible, soft: w.softRecoveries, hard: w.hardRecoveries }
      : null;
    this.restarts++;
    this._teardown();
    this.failed = false;
    this.start().then((ok) => {
      if (!ok) return;
      this.mixer.setMasterVolume(keepVolume);
      if (this.ambience) this.ambience.intensity = keepAmb;
      if (keepDbg && this.watchdog) {
        this.watchdog.log = keepDbg.log;
        this.watchdog.softRecoveries = keepDbg.soft;
        this.watchdog.hardRecoveries = keepDbg.hard;
        this.watchdog.setVisible(keepDbg.visible);
      }
      console.info(`[audio] graph rebuilt (#${this.restarts})`);
    }).catch(() => {});
  }

  /** Free every head-locked slot. The dry half of a watchdog drain. */
  drainDry() {
    let n = 0;
    for (const d of this._dry) {
      if (!d.node) continue;
      try { d.node.disconnect(); } catch { /* already gone */ }
      try { d.send?.disconnect(); } catch { /* already gone */ }
      d.node = null; d.send = null;
      n++;
    }
    return n;
  }

  /**
   * Open every rate gate immediately. The gates are absolute times on the AUDIO
   * clock, so a clock that stalled while a gate was set holds that gate closed
   * for as long as the stall lasted — a category that is rate limited to five a
   * second can be silent for twenty seconds on a clock that only advanced one.
   */
  clearRateGates() {
    for (const k in this._rateNext) this._rateNext[k] = 0;
    this._lastBarkTime = -99;
    this._lastEnemyFire = -99;
  }

  /** The diagnostic snapshot, for the console: `__AUDIO__.diagnose()`. */
  diagnose() {
    const snap = this.watchdog?.snapshot() ?? { error: 'audio not running' };
    console.info('[audio] diagnostics', snap);
    return snap;
  }

  /* ================================================================ */
  /* environment probe                                                */
  /* ================================================================ */

  _probeSpace(ctx, x, y, z) {
    const phys = ctx.peek('physics');
    const hits = this._probeHits;
    if (phys?.raycast) {
      const mask = phys.MASK?.WORLD;
      const o = this._origin;
      o.x = x; o.y = y; o.z = z;
      for (let i = 0; i < PROBE_RAYS; i++) {
        const h = phys.raycast(o, this._probeDirs[i], PROBE_DIST, mask);
        hits[i] = h?.hit ? h.distance : PROBE_DIST;
      }
    } else {
      for (let i = 0; i < PROBE_RAYS; i++) hits[i] = PROBE_DIST;
    }
    classifySpace(hits, PROBE_DIST, this._space);
    this.mixer.setSpace(this._space, 0.4);
    this.ambience.setEnclosure(this._space.enclosure);

    let best = 'open', bv = -1;
    for (const k of ['tight', 'room', 'street', 'tunnel', 'open']) {
      if (this._space[k] > bv) { bv = this._space[k]; best = k; }
    }
    this.stats.space = best;
  }

  /* ================================================================ */
  /* where the shooter is standing                                    */
  /* ================================================================ */

  /**
   * Wetness of a classified space, 0..1.3. This is the ONLY space term in the
   * gunshot send chain; `weaponShot` multiplies it by the weapon's character
   * trim and by distance and that is the whole product.
   *
   * The weights sum against a normalised blend (classifySpace divides by the
   * total), so the value is a weighted average bounded by its extremes: 0.10
   * standing in the middle of open ground, 0.12 in the outdoor blend the level
   * actually produces (street 0.35 / open 0.65), 0.97 in a small hard room,
   * 1.25 in a corridor. That is 8:1 between the street and a stairwell, where
   * the shipped code managed 1.5:1 — and the absolute value outdoors is a tenth
   * of what it was, which is the "why is there so much reverb on the gunshots"
   * complaint.
   *
   * OPEN GROUND IS NOT ZERO ON PURPOSE. A rifle fired in a field still returns
   * something off the ground and the treeline half a second later, and the
   * `open` IR (50 ms predelay, dark, sparse) is what that sounds like. Zero
   * here would make outdoor fire sound like a headphone test tone.
   */
  _wetness(space) {
    return space.open * 0.10 + space.street * 0.22 + space.room * 0.90 +
      space.tight * 0.97 + space.tunnel * 1.25;
  }

  /**
   * How enclosed a point in the world is, 0 (sky above) .. 1 (low ceiling),
   * from ONE raycast straight up. Returns null when physics is unavailable.
   *
   * The listener's own space costs nine rays every 0.45 s and is worth it; a
   * remote shot cannot pay that, and it does not have to. Per `classifySpace`
   * in ir.js, a ceiling within a few metres is the single most reliable indoor
   * signal there is — outdoors that ray goes to the sky — so this reuses the
   * same `roofed` curve on its own. It is one ray per remote shot, behind the
   * 8-shots-a-second rate limit, i.e. at most 8 rays a second.
   *
   * This is why `audio` needs no knowledge of `src/world`'s `enterable` flag
   * and imports nothing: geometry answers the question directly, through the
   * `physics` handle audio already holds via ctx.peek().
   */
  _roofedAt(x, y, z) {
    const phys = this.ctx.peek('physics');
    if (!phys?.raycast) return null;
    const o = this._origin;
    o.x = x; o.y = y; o.z = z;
    const h = phys.raycast(o, this._probeDirs[PROBE_RAYS - 1], ROOF_PROBE, phys.MASK?.WORLD);
    if (!h?.hit) return 0;
    return clamp(1 - (h.distance - 2.8) / 7, 0, 1);
  }

  /**
   * Wetness for a shot fired at (x,y,z) by somebody who is not the listener.
   *
   * The tail is made where the muzzle is, so the shooter's own enclosure leads.
   * The listener's room still answers a shot fired outside it, though — that is
   * what you hear standing in a stairwell while somebody fires in the street —
   * so the listener's space sets a floor at 60%.
   */
  _wetnessAt(x, y, z) {
    const here = this._wetness(this._space);
    const roofed = this._roofedAt(x, y, z);
    if (roofed === null) return here;
    return Math.max(lerp(WET_OUTDOOR, WET_INDOOR, roofed), here * 0.6);
  }

  /* ================================================================ */
  /* voice plumbing                                                   */
  /* ================================================================ */

  /**
   * Build a voice by name. `when` is absolute context time, `dist` is metres
   * from the listener — voices use it to rebalance their own layers.
   */
  _build(kind, when, dist, o) {
    const { actx, bank } = this;
    const rng = this.rng;
    switch (kind) {
      case 'shot':
        return weaponShot(actx, bank, rng, o.profile ?? WEAPON_PROFILES.rifle, {
          when, distance: dist, firstPerson: o.firstPerson,
          echoBoost: o.echoBoost ?? this._wetness(this._space),
        });
      /**
       * The war being fought somewhere else — several rounds on ONE emitter,
       * shaped for what survives a hundred metres of air rather than for what
       * leaves a muzzle. @see distantFire, and `src/audio/battle.js` for who
       * decides a shot belongs here rather than in `shot`.
       */
      case 'far':
        return distantFire(actx, bank, rng, {
          when, distance: dist, profile: o.profile, rounds: o.rounds,
          spacing: o.spacing, level: o.level,
        });
      case 'tankgun': return tankGun(actx, bank, rng, { when, distance: dist, level: o.level });
      /**
       * THE CATHEDRAL — three voices `src/match` asked for by name and could not
       * make out of anything that existed. @see src/audio/collapse.js
       *   collapse_tear  { dur, level, size }   the structure failing
       *   collapse_sub   { dur, level }         the floor under the event
       *   collapse_bell  { f0, level, strikes } the campanile's bell
       */
      case 'collapse_tear':
        return collapseTear(actx, bank, rng, {
          when, dur: o.dur, level: o.level, distance: dist, size: o.size,
        });
      case 'collapse_sub':
        return collapseSub(actx, bank, rng, { when, dur: o.dur, level: o.level, distance: dist });
      case 'collapse_bell':
        return collapseBell(actx, bank, rng, {
          when, f0: o.f0, level: o.level, distance: dist, strikes: o.strikes,
        });
      case 'whizz': return bulletWhizz(actx, bank, rng, { when, miss: o.miss, gain: o.gain });
      case 'dryfire': return dryFire(actx, bank, rng, { when });
      case 'impact': return surfaceImpact(actx, bank, rng, { when, surface: o.surface, energy: o.energy });
      case 'step': return footstep(actx, bank, rng, { when, surface: o.surface, gait: o.gait, level: o.level, gear: o.gear });
      case 'shell': return shellCasing(actx, bank, rng, { when, surface: o.surface, level: o.level, flight: o.flight });
      case 'reload':
        return reloadPhase(actx, bank, rng, o.phase, { when, heavy: o.heavy, action: o.action });
      case 'bolt':
        return boltCycle(actx, bank, rng, { when, dur: o.dur, distance: dist, firstPerson: o.firstPerson });
      case 'swing': return meleeSwing(actx, bank, rng, { when, kind: o.kind, level: o.level });
      case 'melee': return meleeHit(actx, bank, rng, { when, surface: o.surface, level: o.level });
      case 'explosion': return explosion(actx, bank, rng, { when, distance: dist, radius: o.radius, level: o.level });
      /* the four stages of an airstrike — see src/audio/airstrike.js */
      case 'strike_jet': return strikeJet(actx, bank, rng, { when, dur: o.dur, level: o.level });
      case 'strike_incoming': return strikeIncoming(actx, bank, rng, { when, dur: o.dur, level: o.level });
      case 'strike_rubble': return strikeRubble(actx, bank, rng, { when, dur: o.dur, level: o.level, distance: dist });
      case 'strike_tail': return strikeTail(actx, bank, rng, { when, dur: o.dur, level: o.level });
      /* the fifth stage nobody could hear: the pile finishing. @see _onAirPhase */
      case 'strike_settle':
        return rubbleCollapse(actx, bank, rng, {
          when, dur: o.dur, level: o.level, size: o.size, distance: dist,
        });
      /* the fighter's gun: at the aircraft, and again where it lands */
      case 'strafe_cannon':
        return strafeCannon(actx, bank, rng, { when, dur: o.dur, level: o.level, rate: o.rate });
      case 'strafe_walk':
        return strafeCannon(actx, bank, rng, { when, dur: o.dur, level: o.level, rate: o.rate, ground: true });
      case 'bodyfall': return bodyFall(actx, bank, rng, { when, level: o.level });
      case 'cloth': return cloth(actx, bank, rng, { when, level: o.level });
      case 'heartbeat': return heartbeat(actx, bank, rng, { when, level: o.level });
      case 'bark': return voxBark(actx, bank, rng, { when, bark: o.bark, f0: o.f0, tract: o.tract, level: o.level, radio: o.radio });
      case 'ambient': return ambientOneShot(actx, bank, rng, o.which, { when, level: o.level });
      default: return uiSound(actx, bank, rng, kind, { when, level: o.level });
    }
  }

  /**
   * Spatialised one-shot: propagation delay, occlusion, air absorption and the
   * reverb send. Returns false when the voice budget refused it.
   */
  _playAt(kind, x, y, z, o = {}, bus = 'foley', priority = 0.5) {
    if (!this.running || this.actx.state === 'suspended') return false;
    if (!Number.isFinite(x + y + z)) return this._playDry(kind, o, bus, o.send ?? 0.15);
    try {
      const field = this.field;
      const dist = field.distanceTo(x, y, z);
      if (dist > (o.maxDist ?? 320)) return false;
      const delay = o.noDelay ? 0 : dist / SPEED_OF_SOUND;
      const when = this.actx.currentTime + delay + (o.extraDelay ?? 0);
      /**
       * CLAIM THE SLOT BEFORE BUILDING THE VOICE.
       *
       * This used to synthesise first and ask second, and throw the whole voice
       * away when the field said no — `voice.node.disconnect()` and out. A voice
       * is not cheap to throw away: a 15 m explosion is around three hundred
       * Web Audio nodes, sixty of them started buffer sources, and every one of
       * them is created on the main thread and mutates the graph the render
       * thread is trying to read. MEASURED in a live match, 550 voices were
       * built and discarded like that inside two minutes — and they were
       * discarded precisely BECAUSE the field was full, i.e. the graph paid its
       * heaviest construction bill exactly when it was already failing to
       * render what it had. That is the loop that turns a busy moment into
       * silence.
       *
       * Asking first costs nothing: `acquire` needs a provisional `endTime`
       * (`hold` sets the real one) and the voice's own send character is applied
       * by `hold` through the same arithmetic as before.
       */
      const em = field.acquire({
        x, y, z, when, dist, bus, priority,
        send: o.send ?? 0.3,
        gain: o.gain ?? 1,
        endTime: when + 0.6,
        occlusion: o.occlusion,
        tracked: o.tracked,
        tag: o.tag,
      });
      if (!em) return false;
      let voice = null;
      try {
        voice = this._build(kind, when, dist, o);
      } catch (err) {
        em.detach();          // never leak the slot on a voice that failed
        throw err;
      }
      field.hold(em, voice.node, voice.end, o.send ?? voice.send ?? 0.3);
      this.stats.events++;
      return true;
    } catch (err) {
      this._error(err);
      return false;
    }
  }

  /** Head-locked one-shot: own weapon, UI, player grunts, heartbeat. */
  _playDry(kind, o = {}, bus = 'foley', send = 0.15) {
    if (!this.running || this.actx.state === 'suspended') return false;
    try {
      const when = this.actx.currentTime + (o.extraDelay ?? 0);
      const voice = this._build(kind, when, o.dist ?? 0, o);
      const g = mkGain(this.actx, o.gain ?? 1);
      voice.node.connect(g);
      g.connect(this.mixer.bus(bus));
      let sendNode = null;
      const sendLevel = (o.send ?? send) * (voice.send ?? 1);
      if (sendLevel > 0.001) {
        sendNode = mkGain(this.actx, sendLevel);
        g.connect(sendNode);
        sendNode.connect(this.mixer.reverbSend);
      }
      // Claim a bookkeeping slot; steal the oldest if all are busy.
      let slot = null;
      for (let i = 0; i < this._dry.length; i++) {
        const idx = (this._dryCursor + i) % this._dry.length;
        if (!this._dry[idx].node) {
          slot = this._dry[idx];
          this._dryCursor = (idx + 1) % this._dry.length;
          break;
        }
      }
      if (!slot) {
        slot = this._dry[this._dryCursor];
        try { slot.node.disconnect(); slot.send?.disconnect(); } catch { /* noop */ }
        this._dryCursor = (this._dryCursor + 1) % this._dry.length;
      }
      slot.node = g;
      slot.send = sendNode;
      slot.end = voice.end + 0.05;
      slot.wallEnd = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000) +
        (slot.end - this.actx.currentTime) + 0.3;
      this.stats.events++;
      return true;
    } catch (err) {
      this._error(err);
      return false;
    }
  }

  /* ================================================================ */
  /* public helpers                                                   */
  /* ================================================================ */

  /**
   * Fire a one-shot. Tolerant on purpose: other subsystems call this with
   * several different conventions and audio must never be the thing that throws.
   *   play('impact', vec3, { surface })   play('hit_flesh', { gain: 0.7 })
   *   play('shell', vec3, 0.8)
   */
  play(kind, position, opts) {
    if (typeof opts === 'number') opts = { gain: opts };
    if (typeof position === 'number') { opts = { gain: position }; position = null; }
    // A caller may have passed an options bag where a position goes.
    if (position && !isVec(position)) {
      opts = opts ?? position;
      position = null;
    }
    opts = opts ?? {};
    const k = UI_ALIAS[kind] ?? kind;
    if (COLLAPSE_KINDS[k] && position) return this._playCollapse(k, position, opts);
    if (position) {
      return this._playAt(k, position.x, position.y, position.z, opts,
        opts.bus ?? BUS_FOR[k] ?? 'foley', opts.priority ?? 0.5);
    }
    return this._playDry(k, opts, opts.bus ?? BUS_FOR[k] ?? 'foley', opts.send ?? 0.15);
  }

  ui(kind, level = 1) {
    const k = UI_ALIAS[kind] ?? kind;
    return this._playDry(k, { level }, BUS_FOR[k] ?? 'ui', k === 'heartbeat' ? 0.1 : 0);
  }

  /** Adapter the `ui` subsystem probes for: playUi(id, gain). */
  playUi(id, gain = 1) {
    return this.ui(id, gain);
  }

  /** Adapter the `fx` subsystem probes for: playShell(position, gain). */
  playShell(position, gain = 1) {
    if (!isVec(position)) return false;
    return this._playAt('shell', position.x, position.y, position.z,
      { level: gain, surface: 'concrete', flight: 0.02 }, 'foley', 0.25);
  }

  /** Adapter for impact FX that would rather call directly than emit. */
  playImpact(position, surface = 'concrete', energy = 1) {
    if (!isVec(position)) return false;
    return this._playAt('impact', position.x, position.y, position.z, { surface, energy }, 'foley', 0.55);
  }

  /**
   * THE CATHEDRAL, WITH ITS OWN DEFAULTS — because getting them wrong is silent.
   *
   * `src/match` calls `audio.play('collapse_sub', pos, …)` and should not have to
   * know that this pool has a priority order, that the attenuation curve is flat
   * past 60 m so a distant event needs a gain of three rather than of one, or
   * that a collapse must not be occluded by the building it IS. Those are mix
   * facts and they live here; a caller that passes nothing gets the event the
   * player asked for, and anything it does pass still wins.
   *
   * THE DUCK AND THE CONCUSSION ARE THE OTHER HALF OF 「もっと音大きく激しくして」.
   * Loudness alone cannot make an event dominate a mix that is already at the
   * limiter — a firefight, a salvo and seven dust columns are all playing. What
   * makes it enormous is everything ELSE getting out of its way for a moment,
   * which is what `_onExplosion` already does for a grenade and what nothing was
   * doing for the biggest event in the match. It is applied on the SUB only, so
   * it fires once, on the impact, and not three times across the walk down the
   * nave.
   *
   * The concussion is deliberately modest and distance-scaled: the muffle is
   * capped at 0.62 in the mixer and clears in ~4 s, and a player who has just
   * had a cathedral land on him being briefly deafened is the effect working —
   * but 「音が消える」 is a live complaint, so this asks for 0.34 at the very most
   * and the watchdog is now watching the muffle anyway.
   */
  _playCollapse(kind, position, o) {
    const dist = this.field.distanceTo(position.x, position.y, position.z);
    const near = clamp(1 - dist / 140, 0, 1);
    const bag = this._collapseBag;
    bag.dur = o.dur; bag.size = o.size; bag.f0 = o.f0; bag.strikes = o.strikes;
    bag.level = o.level ?? 1;
    bag.gain = o.gain ?? COLLAPSE_KINDS[kind] ?? 5;
    bag.maxDist = o.maxDist ?? 640;
    bag.occlusion = o.occlusion ?? 0.12;
    bag.send = o.send;
    bag.extraDelay = o.extraDelay;
    bag.tag = 'collapse';
    const ok = this._playAt(kind, position.x, position.y, position.z, bag,
      o.bus ?? BUS_FOR[kind] ?? 'weapons', o.priority ?? COLLAPSE_PRIORITY);
    if (ok && kind === 'collapse_sub') {
      this.mixer.duck(clamp(0.55 + near * 0.35, 0.55, 0.9), 0.5);
      if (near > 0.08) this.mixer.concuss(Math.pow(near, 1.3) * 0.34);
    }
    return ok;
  }

  /**
   * One coalesced burst of distant fire. Called only by `BattleLayer`, which
   * owns the rate and the budget; this is the plumbing half.
   *
   * `occlusion: 0` and a fixed OUTDOOR wetness, both for the same reason
   * `_distantVolley` uses them: fire from 90 m away comes over the rooftops
   * rather than through them, and it is outdoors by definition whatever room the
   * listener is standing in. It also spends no raycast, which matters at five
   * voices a second.
   */
  playFar(x, y, z, o) {
    return this._playAt('far', x, y, z, {
      profile: o.profile, rounds: o.rounds, spacing: o.spacing,
      level: o.level ?? 1,
      // A far voice is cheap to steal and can steal almost nothing: at 0.3 it
      // reaches nothing above 0.55, i.e. no near shot, no blast, no bark.
      maxDist: 260, occlusion: 0, echoBoost: WET_OUTDOOR,
      // The level is a function of the range, because the attenuation curve is
      // nearly flat out here and a fixed gain would make 200 m as loud as 70.
      gain: farGain(this.field.distanceTo(x, y, z)),
      tag: 'far',
    }, 'weapons', 0.3);
  }

  /** Enemy vocalisation. `kind` is semantic — see barkFor() in vox.js. */
  bark(kind, position, opts = {}) {
    if (!this.running) return false;
    const now = this.actx.currentTime;
    if (now - this._lastBarkTime < 0.42 && !opts.force) return false; // no mush
    this._lastBarkTime = now;
    const seed = (opts.voice ?? 0) | 0;
    const o = {
      bark: barkFor(kind, this.rng),
      f0: 96 + ((seed * 37) % 41),
      tract: 0.95 + ((seed * 13) % 11) / 100,
      level: opts.level ?? 1,
      radio: opts.radio ?? false,
      send: opts.send,
    };
    if (position) return this._playAt('bark', position.x, position.y, position.z, o, 'voice', 0.85);
    return this._playDry('bark', o, 'voice', 0.25);
  }

  setMasterVolume(v) { this.mixer?.setMasterVolume(v); }
  setBusVolume(bus, v) { this.mixer?.setBusVolume(bus, v); }
  setAmbienceIntensity(v) { if (this.ambience) this.ambience.intensity = clamp(v, 0, 3); }
  setOcclusionEnabled(v) { if (this.field) this.field.occlusionEnabled = !!v; }

  /* ================================================================ */
  /* events                                                           */
  /* ================================================================ */

  _wireEvents(ctx) {
    const ev = ctx.events;
    const on = (name, fn) => this._offs.push(ev.on(name, fn));

    on('weapon:fire', (p) => this._onFire(p));
    on('weapon:reload', (p) => this._onReload(p));
    on('weapon:bolt', (p) => this._onBolt(p));
    on('weapon:melee', (p) => this._onMelee(p));
    on('weapon:shell', (p) => this._onShell(p));
    on('bullet:impact', (p) => this._onImpact(p));
    on('bullet:tracer', (p) => this._onTracer(p));
    on('explosion', (p) => this._onExplosion(p));
    on('player:footstep', (p) => this._onFootstep(p));
    on('player:land', (p) => this._onLand(p));
    on('player:state', (p) => this._onPlayerState(p));
    on('damage:dealt', (p) => this._onDamageDealt(p));
    on('damage:taken', (p) => this._onDamageTaken(p));
    on('actor:death', (p) => this._onDeath(p));
    // THE AIR EVENTS. `src/match` plays the jet, the whistle, the blast and the
    // airstrike's tail itself; what it never plays is the SETTLE, and it never
    // plays a tail for the bomber. Both are ours because `src/match` is not.
    on('match:airstrike', (p) => this._onAirPhase(p, 'airstrike'));
    on('match:bomber', (p) => this._onAirPhase(p, 'bomber'));
    on('match:strafe', (p) => this._onAirPhase(p, 'strafe'));
    /**
     * ARMOUR. `src/match/tank.js` publishes `match:tank { phase, id, team,
     * position }` with phases inbound / rolling / fire / kill / dead / clear,
     * and plays two sounds of its own at the muzzle: the airstrike's ROLL for
     * the main gun and the strafe cannon for the coax. What it has never had is
     * the REPORT — the pressure step that arrives before the roll — and it has
     * never had an engine at all. Both are ours because `src/match` is not.
     *
     * The engine is not driven from here: it is a continuous sound and it is
     * built off `match.armour.tanks` in the frame loop, so a hull that is
     * already rolling when the graph starts still gets one. @see battle.js
     */
    on('match:tank', (p) => {
      if (p?.phase !== 'fire' || !isVec(p.position)) return;
      this.battle?.onTankFire(p.position.x, p.position.y, p.position.z);
    });
    // Optional: emitted by `ai` if it wants scripted chatter.
    on('ai:bark', (p) => this.bark(p?.kind ?? 'spot', p?.position, { voice: p?.voice ?? 0 }));
  }

  /**
   * The two things the air events do not carry their own sound for.
   *
   * 1. `settled` — 「瓦礫の崩れる音も追加してリアルにして」. `src/match/airstrike.js`
   *    settles its chunks at impact + 6.5 s and emits this phase when the rubble
   *    becomes collision; the bomber and the strafe emit it for their debris. It
   *    was SILENT, all three of them. `rubbleCollapse` is sized per source,
   *    because the events are not the same size: an airstrike takes a storey off
   *    a building, a bomb leaves a crater, a cannon pass leaves grit.
   *
   * 2. `impact` on a BOMBER RUN — the bomber plays the jet and then relies on the
   *    `explosion` event for everything else, so a stick of 5-8 bombs walking a
   *    line had no rolling report at all. One tail for the run, on the first bomb,
   *    at stick length: a stick reads as one continuous roll, not as eight tails.
   *
   * THE VOICE BUDGET IS WHY THIS IS DEBOUNCED. The weapons bus is capped at 45 %
   * of the 40-emitter field (18 slots) and a bigger explosion must not evict the
   * firefight. A salvo settles three sites and a stick settles 5-8 bombs, all
   * within a second or two, so `_settleAt` collapses anything inside 1.2 s and
   * 40 m into ONE voice and grows its `size` instead. Worst case is therefore two
   * or three settle voices for a salvo, not eleven.
   */
  _onAirPhase(p, source) {
    if (!this.running || !p) return;
    const pos = p.position;
    if (!isVec(pos)) return;
    const now = this.actx.currentTime;

    if (p.phase === 'impact') {
      if (source !== 'bomber') return;
      // One roll per run, keyed on the run object the payload carries.
      const run = p.run ?? null;
      if (run && run === this._lastBomberRun) return;
      this._lastBomberRun = run;
      this._playAt('strike_tail', pos.x, pos.y, pos.z, {
        level: 1.35, dur: 7.0, maxDist: 400, gain: 2.3, occlusion: 0,
      }, 'weapons', 0.98);
      return;
    }
    if (p.phase !== 'settled') return;

    /** How much came down, per source. See `rubbleCollapse`'s `size`. */
    const size = source === 'airstrike' ? 1 : source === 'bomber' ? 0.6 : 0.28;
    const s = this._settle;
    if (
      s.at > 0 && now - s.at < 1.2 &&
      Math.hypot(s.x - pos.x, s.y - pos.y, s.z - pos.z) < 40
    ) {
      // Same collapse, arriving as several events. Nothing new to play.
      return;
    }
    s.at = now; s.x = pos.x; s.y = pos.y; s.z = pos.z;
    this._playAt('strike_settle', pos.x, pos.y, pos.z, {
      size, level: 1.1, maxDist: 200, gain: 1.9,
      // The pile does not stop all at once, and a settle that starts on the exact
      // frame the collision appears reads as a switch being thrown.
      extraDelay: 0.12,
    }, 'weapons',
    /**
     * 0.35, AND THE NUMBER IS ARITHMETIC RATHER THAN TASTE.
     *
     * `SpatialField.acquire` will only steal a voice whose priority is at most
     * `pri + 0.25`, and a remote shot's priority is `clamp(0.95 - dist*0.006,
     * 0.4, 0.95)`. At 0.35 the settle can evict nothing above 0.60, i.e. nothing
     * closer than 58 m — and `_onFire` already refuses remote shots past 60 m, so
     * there is no shot in the field that this can take a slot from. That is the
     * guarantee "a bigger explosion must not evict the firefight" needs, and 0.55
     * did not give it: 0.55 + 0.25 = 0.80 reaches a shot at 25 m.
     *
     * The price is that the settle is itself cheap to steal, which is the correct
     * way round for scenery: you hear the block finish coming down when there is
     * not a firefight in your ear, and you do not when there is.
     */
    0.35);
  }

  _onFire(p) {
    if (!this.running || !p) return;
    const w = p.weapon;
    const name = typeof w === 'string' ? w : (w?.audio ?? w?.id ?? w?.name ?? w?.kind);
    let profile = resolveProfile(name);
    if (w && typeof w === 'object' && w.suppressed) profile = WEAPON_PROFILES.suppressed;

    if (p.empty) {
      this._playDry('dryfire', {}, 'weapons', 0.15);
      return;
    }

    const o = p.origin;
    const lp = this.field.listenerPos;
    const x = o?.x ?? lp.x, y = o?.y ?? lp.y, z = o?.z ?? lp.z;
    const dist = this.field.distanceTo(x, y, z);
    const firstPerson = p.firstPerson ?? dist < 2.6;

    if (firstPerson) {
      /**
       * Own weapon: no propagation delay, and the wet level is decided by the
       * space the SHOOTER is standing in — which for the local player is the
       * nine-ray probe already running every 0.45 s at the listener.
       *
       * This used to compute a second space term of its own
       *   echo = 0.35 + tight*0.5 + street*0.9 + tunnel*1.0 + room*0.75
       * and pass `echo * 0.6` as the send, which `_playDry` then multiplied by
       * `voice.send` — and `voice.send` had ALREADY been multiplied by a space
       * term inside `weaponShot`. Two space multipliers on the same signal, and
       * a floor of 0.35 that never went away, is how a rifle in an open street
       * ended up as wet as one in a room. There is one term now and it is
       * `_wetness()`; the send argument here is a pass-through.
       */
      const wet = this._wetness(this._space);
      this._playDry('shot', { profile, firstPerson: true, echoBoost: wet }, 'weapons', 1);
      this.mixer.duck(0.55, 0.1);
    } else {
      /**
       * REMOTE GUNFIRE IS BUDGETED, and this is the one event type that was not.
       *
       * MEASURED with a live 7v7 round: thirteen actors firing at ~10 rounds a
       * second put the 40-emitter spatial field at 100% capacity twenty-four
       * seconds into the first round and it never came back down — 10023 voices
       * DROPPED and 5053 STOLEN against 7490 actually played. Every remote shot
       * asked for priority 0.95, the highest in the system, so shots evicted
       * each other and everything else: footsteps, impacts, your own reload.
       * What that sounds like from the player's seat is the audio glitching and
       * then going away, which is exactly what was reported.
       *
       * Upstream had six enemies and never hit the ceiling. Every other event
       * here already had a budget; gunfire simply never got one, and the ones
       * that existed were per-frame rather than per-second (see `_rate`).
       *
       * Three rules, in the order they matter:
       *   1. a rate limit — eight remote shots a second is already a wall of noise
       *   2. nothing past 80 m, because `ambience` carries distant volleys and a
       *      single 5.56 crack from across the map is not information
       *   3. priority falls off with distance, so a firefight at 60 m can no
       *      longer steal the slot from a footstep at 3 m
       */
      /**
       * ───────────────────────────────────────────────────────────────────────
       * THE CULL COMES FIRST, AND THE ORDER WAS THE BUG.
       * ───────────────────────────────────────────────────────────────────────
       * `_allow('shot')` used to run BEFORE the 60 m test, so a shot that was
       * about to be thrown away still spent the rate token. MEASURED over two
       * minutes of a live 20v20 (`tools/audiotest.mjs --battle`): 1982 remote
       * shots were offered from beyond 70 m and 14 from inside it. At five
       * tokens a second, essentially every token in the match was spent by a
       * shot that was then discarded, and the fourteen that mattered had to win
       * a lottery against two thousand that did not. That is a large part of
       * 「敵味方の銃声があんまり聞こえない」 — not the range, the ORDER.
       *
       * 60 m itself is unchanged and stays unchanged: it is where the FULL voice
       * stops being worth an emitter, not where the war stops being audible.
       * What is past it is no longer thrown away — it goes to the distant-battle
       * layer, which coalesces a whole bearing's worth of fire into one voice.
       * @see src/audio/battle.js
       */
      if (dist > 60) {
        this.battle?.offerFar(x, y, z, dist, profile);
        return;
      }
      if (!this._allow('shot')) return;
      const shotPriority = clamp(0.95 - dist * 0.006, 0.4, 0.95);
      // One upward ray from the muzzle decides whether this shot is a rifle in
      // a room or a rifle in the street. See `_wetnessAt`.
      /**
       * `gain: gunRangeGain(dist)` — the near half of 「距離離れていてももっと
       * 聞こえていい」. It is a GUNFIRE trim and not a change to the shared
       * attenuation curve, so the footsteps that ride the same curve keep the
       * level they were explicitly asked to have. It is 1.0 inside 12 m, so a
       * man shooting at you across a room is untouched. @see gunRangeGain
       */
      this._playAt('shot', x, y, z, {
        profile, firstPerson: false, echoBoost: this._wetnessAt(x, y, z),
        gain: gunRangeGain(dist),
      }, 'weapons', shotPriority);
      this.mixer.duck(clamp(0.5 - dist * 0.004, 0.12, 0.5), 0.08);
      // Enemies opening fire get occasional chatter, so firefights feel alive
      // even before `ai` grows its own bark logic.
      const now = this.actx.currentTime;
      if (now - this._lastEnemyFire > 4.5 && this.rng.float() < 0.45) {
        this._lastEnemyFire = now;
        this.bark(this.rng.float() < 0.6 ? 'spot' : 'suppress', p.origin, { level: 0.9 });
      }
    }
  }

  /**
   * Which reload MECHANISM a weapon has. `reloadPhase` needs this, not a volume
   * scalar: an AK rocks a steel magazine in and charges off the handle, a bolt
   * gun seats a 5-round steel box and charges nothing at all. See RELOAD_ACTION.
   */
  _reloadAction(name) {
    const k = String(name ?? '').toLowerCase();
    if (/ak|akm|7\.?62x39|rpk|galil|vz58/.test(k)) return 'ak';
    if (/snip|bolt|awp|m91|kar|mosin|marksman/.test(k)) return 'bolt';
    if (/lmg|shot|m249|pkm|saw|pump|12g/.test(k)) return 'heavy';
    return 'ar';
  }

  _onReload(p) {
    if (!this.running) return;
    const w = p?.weapon;
    const name = typeof w === 'string' ? w : (w?.audio ?? w?.id ?? w?.name);
    const action = this._reloadAction(name);
    const heavy = action === 'heavy' ? 1.35 : 1;
    const phase = p?.phase ?? 'end';
    if (p?.position) {
      if (!this._allow('reload')) return;
      this._playAt('reload', p.position.x, p.position.y, p.position.z,
        { phase, heavy, action }, 'foley', 0.6);
    } else {
      this._playDry('reload', { phase, heavy, action }, 'foley', 0.22);
    }
  }

  /**
   * `weapon:bolt` — a manually cycled action. Never rate-limited and never
   * dropped for the local player: this is the sound that tells you the rifle is
   * not ready, and a bolt gun with a silent bolt is a semi-auto that happens to
   * be slow.
   */
  _onBolt(p) {
    if (!this.running) return;
    const pos = p?.position;
    const dur = p?.duration ?? 0.78;
    if (isVec(pos)) {
      const dist = this.field.distanceTo(pos.x, pos.y, pos.z);
      /**
     * 40 m, back up from 26. I cut it to 26 to stop foley flooding the voice
     * pool, and that was the wrong lever — the flood was fixed properly by the
     * per-bus quotas in spatial.js, and cutting the range as well made enemy
     * and friendly movement inaudible. "敵味方の足音もかすかに聞こえるように
     * して" is asking for exactly what I removed. 40 m is far enough to hear
     * someone crossing the courtyard you are watching, and the level falls with
     * distance anyway, so it is faint rather than loud.
     */
    if (dist > 40) return;
      this._playAt('bolt', pos.x, pos.y, pos.z, { dur, firstPerson: false }, 'foley', 0.62);
    } else {
      this._playDry('bolt', { dur, firstPerson: true }, 'foley', 0.2);
    }
  }

  /**
   * `weapon:melee` — the knife. `phase: 'swing'` on every attack, `'hit'` only
   * when the blade reached something, with the surface it reached: `flesh` for a
   * body, whatever `physics` tagged the collider for a wall. A whiff is a swing
   * with no hit, which is exactly what it should sound like.
   */
  _onMelee(p) {
    if (!this.running || !p) return;
    const pos = p.position;
    const remote = isVec(pos) && this.field.distanceTo(pos.x, pos.y, pos.z) > 2.6;
    if (p.phase === 'swing') {
      const o = { kind: p.kind ?? 'slash', level: remote ? 0.7 : 1 };
      if (remote) this._playAt('swing', pos.x, pos.y, pos.z, o, 'foley', 0.45);
      else this._playDry('swing', o, 'foley', 0.12);
      return;
    }
    const o = { surface: p.surface ?? 'flesh', level: 1 };
    // The hit is placed in the world even for the local player — a knife lands
    // 1.5 m in front of your face, not inside your head, and the reverb send is
    // what sells a blade hitting a wall in a stairwell.
    if (isVec(pos)) this._playAt('melee', pos.x, pos.y, pos.z, o, 'foley', 0.8);
    else this._playDry('melee', o, 'foley', 0.3);
  }

  _onShell(p) {
    if (!this.running || !p) return;
    if (!this._allow('shell')) return;
    const pos = p.position;
    const lp = this.field.listenerPos;
    const x = pos?.x ?? lp.x, y = pos?.y ?? lp.y, z = pos?.z ?? lp.z;
    const dist = this.field.distanceTo(x, y, z);
    if (dist > 22) return;
    // Find what it will land on, so brass on sand does not ring like concrete.
    let surface = 'concrete';
    const phys = this.ctx.peek('physics');
    if (phys?.raycast) {
      const h = phys.raycast(x, y + 0.2, z, 0, -1, 0, 6, phys.MASK?.WORLD);
      if (h?.hit) surface = h.surface;
    }
    this._playAt('shell', x, y - 0.6, z, {
      surface,
      level: clamp(1 - dist * 0.02, 0.3, 1),
      flight: 0.25 + this.rng.range(0, 0.3),
    }, 'foley', 0.25);
  }

  _onImpact(p) {
    if (!this.running || !p) return;
    if (p.exit) return;                       // only the entry side gets a sound
    if (!this._allow('impact')) return;
    const pt = p.point;
    if (!pt) return;
    const dist = this.field.distanceTo(pt.x, pt.y, pt.z);
    if (dist > 90) return;
    this._playAt('impact', pt.x, pt.y, pt.z, {
      surface: p.surface ?? 'concrete',
      energy: clamp((p.damage ?? 30) / 34, 0.35, 1.5),
    }, 'foley', 0.55);
    // The round cracking past you is a separate sound from the impact itself.
    if (dist < 6) {
      this._playAt('whizz', pt.x, pt.y, pt.z, { miss: dist, noDelay: true }, 'foley', 0.7);
    }
  }

  _onTracer(p) {
    if (!this.running || !p?.from || !p?.to) return;
    if (!this._allow('whizz')) return;
    // Closest approach of the trajectory to the listener.
    const lp = this.field.listenerPos;
    const ax = p.from.x, ay = p.from.y, az = p.from.z;
    const dx = p.to.x - ax, dy = p.to.y - ay, dz = p.to.z - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-6) return;
    const t = clamp(((lp.x - ax) * dx + (lp.y - ay) * dy + (lp.z - az) * dz) / len2, 0, 1);
    const cx = ax + dx * t, cy = ay + dy * t, cz = az + dz * t;
    const miss = Math.hypot(lp.x - cx, lp.y - cy, lp.z - cz);
    if (miss > 5) return;
    if (Math.hypot(lp.x - ax, lp.y - ay, lp.z - az) < 3) return; // our own muzzle
    const flight = (Math.sqrt(len2) * t) / (p.speed ?? 850);
    this._playAt('whizz', cx, cy, cz, { miss, noDelay: true, extraDelay: flight }, 'foley', 0.75);
  }

  _onExplosion(p) {
    if (!this.running || !p?.position) return;
    const pos = p.position;
    const dist = this.field.distanceTo(pos.x, pos.y, pos.z);
    const radius = p.radius ?? 6;
    /**
     * A BLAST'S WEIGHT SCALES WITH ITS BLAST. `level` was a flat 1, so a 6 m
     * grenade and the 22 m C4 detonation that ends a round sounded the same
     * size. They are not the same event: one is a frag going off down the
     * street, the other is the round ending three metres from your face.
     */
    const level = clamp(0.85 + radius / 26, 0.85, 1.8);
    /**
     * `gain: blastRangeGain(...)` — 「爆風の音が小さい」, and it was not a synthesis
     * problem. MEASURED at the output of a running game, a 15 m airstrike
     * detonating 12 m away peaked 2.7 dB above the player's own rifle and at
     * 35 m it was 9.2 dB BELOW it, because the shared near-field 1/r curve was
     * scaling a charge whose fireball is wider than the distance to the ear.
     * @see blastRangeGain
     */
    /**
     * A PRESSURE WAVE GOES ROUND THE CORNER; A FOOTSTEP DOES NOT.
     *
     * MEASURED: the same 15 m blast at 35 m was 7 dB quieter with a building in
     * the line than without, because `acquire` was giving it the same treatment
     * as a boot — 8.4 dB of level and a low-pass. That is wrong for the one
     * source in the game whose energy is almost all below 200 Hz, where a wall
     * is a diffraction edge rather than a barrier, and it is the same argument
     * `_playCollapse` already makes when it passes `occlusion: 0.12`.
     *
     * The geometry is still READ — a grenade in the next room must not be as
     * loud as one in the street — it just counts for much less, and less again
     * the bigger the charge.
     */
    const occ = this.field.occlusionAt(pos.x, pos.y, pos.z) *
      clamp(0.55 - radius / 34, 0.12, 0.5);
    /**
     * NO `send` OVERRIDE — the explosion's own send must be the one that plays.
     *
     * This used to pass `send: 1.0`, and `hold()` prefers the caller's send over
     * the voice's (`o.send ?? voice.send`), so the third reverb pass — which
     * moved the blast's tail INTO the synthesis precisely so its send could be
     * closed from 0.85–1.35 to 0.26–0.56 — never actually applied on the live
     * path. Every blast in the game sent at 1.0 into the convolvers, and then
     * `_applySend` multiplied that by its distance and occlusion terms: a 90 m
     * detonation was sending at ~2.5. The loudest events in the match being the
     * wettest is 「またリバーブが強いので」 in one number. With the override gone
     * the voice's authored 0.26–0.56 carries, exactly as the airstrike voices
     * already do; the blast's LENGTH is unchanged because the roll is
     * synthesised, not convolved.
     */
    this._playAt('explosion', pos.x, pos.y, pos.z, {
      radius, level, gain: blastRangeGain(dist, radius), occlusion: occ,
    }, 'weapons', 1);
    this.mixer.duck(clamp(0.8 + radius / 90, 0.8, 0.95), 0.35);
    // Concussion reaches as far as the blast does, rather than a fixed 22 m.
    const near = clamp(1 - dist / Math.max(12, radius * 1.3), 0, 1);
    if (near > 0.1) this.mixer.concuss(Math.pow(near, 1.4));
  }

  /**
   * Classify a step from what `player` actually puts on the payload.
   *
   * The old line was
   *   `p.gait ?? (p.running ? 'run' : p.crouched ? 'crouch' : 'walk')`
   * and `player:footstep` has never carried `gait` or `crouched` — the payload
   * is `{ position, surface, running, left, speed, stance }` (src/player/index.js).
   * So `crouch` and `sprint` were unreachable: every step in the game was
   * either `walk` or `run`, and `footstep()` in foley.js has had four distinct
   * gait weights (crouch 0.42, walk 0.62, run 1.0, sprint 1.25) the whole time
   * with half of them dead.
   *
   * Thresholds come from src/player/tuning.js so the audio changes on the same
   * frame the movement machine does: STANCE.stand.speed 4.57, MOVE.sprintSpeed
   * 7.01, MOVE.tacSprintSpeed 8.38, and FOOTSTEP.runSpeed 5.4 (which is what
   * sets the payload's `running`).
   */
  _gaitOf(p) {
    if (p?.gait) return p.gait;
    const st = p?.stance;
    if (st === 'crouch' || st === 'prone') return 'crouch';
    const sp = typeof p?.speed === 'number' ? p.speed : (p?.running ? 5.6 : 3);
    if (sp >= 6.2) return 'sprint';
    if (sp >= 5.4 || p?.running) return 'run';
    return 'walk';
  }

  /**
   * `player:footstep`. Nothing else in the engine emits it — `ai` only listens
   * — so every one of these is the LOCAL player's own boot, and it is treated
   * as such: never rate-limited, never occluded, and mixed as the closest
   * diegetic sound in the game.
   *
   * MEASURED, why it was reported as missing entirely. Rendering one walking
   * step and ten seconds of the ambience bed through the same mixer offline:
   * the step peaked at 0.017 while the bed's RMS was 0.044, i.e. the bed was
   * 28 dB louder than the sound it was burying. That is the ambience fix (see
   * ambience.js); the three defects on this side were:
   *
   *  1. `_allow('step')` capped ALL steps at 4/s. Tactical sprint is 8.38 m/s
   *     over a 1.894 m stride = 4.42 footfalls a second, so the player's own
   *     cadence outran the limiter exactly when he was moving fastest.
   *  2. Occlusion. `field.acquire` defaults to `occlusionAt()`, which casts
   *     from the eye to the emitter — and the emitter is a point ON the floor
   *     1.6 m below the eye. Any hit there costs up to 62% of the level and
   *     lowpasses to 420 Hz. Your own feet cannot be occluded from your own
   *     ears, so this passes `occlusion: 0`.
   *  3. Level. Own steps were attenuated to 0.72 while every other actor's got
   *     1.0 — backwards. Yours are the ones you play off.
   */
  _onFootstep(p) {
    if (!this.running) return;
    const pos = p?.position;
    const lp = this.field.listenerPos;
    const x = pos?.x ?? lp.x, y = pos?.y ?? lp.y - 1.6, z = pos?.z ?? lp.z;
    const dist = this.field.distanceTo(x, y, z);
    /**
     * 26 m, down from 45. A boot on gravel is not audible at 45 m across a
     * firefight, and on a 114x141 m map with thirty men walking it was 45 m of
     * radius admitting most of the roster at once — measured as 50 of 72
     * emitters held by foley. What you actually need to hear is the man about to
     * come round your corner.
     */
    if (dist > 26) return;
    // Within arm's reach of the listener it is the local player's own foot.
    const own = dist < 2.6;
    if (!own && !this._allow('step')) return;
    const gait = this._gaitOf(p);
    this._playAt('step', x, y, z, {
      surface: p?.surface ?? 'concrete', gait,
      level: p?.level ?? (own ? OWN_STEP_LEVEL : 1),
      occlusion: own ? 0 : undefined,
      // Your own webbing and sling are on your chest, not across the street.
      gear: own ? (gait === 'crouch' ? 0.3 : gait === 'walk' ? 0.45 : 0.9) : undefined,
      /**
       * YOUR OWN FOOTSTEPS OUTRANK EVERYTHING. At 0.85 they lost to any remote
       * shot inside ~20 m (0.95 falling at 0.006/m), and with thirty shooters
       * that is continuous — which is precisely why the reported symptom was
       * "the sound effects are gone" rather than "the sound is muddy". A sound
       * made by your own body, 0 m from the listener, is the one thing in the
       * mix that must never be evicted.
       */
    }, 'foley', own ? 0.99 : 0.4);
  }

  /**
   * `player:land`. The payload carries `position` (src/player/index.js sets it
   * from the movement machine); it was being ignored in favour of "wherever the
   * camera is, minus 1.6 m", which put the thump inside the listener's head
   * during a mantle and anywhere but the feet on a slope.
   */
  _onLand(p) {
    if (!this.running) return;
    const lp = this.field.listenerPos;
    const pos = isVec(p?.position) ? p.position : null;
    const x = pos?.x ?? lp.x, y = pos?.y ?? (lp.y - 1.6), z = pos?.z ?? lp.z;
    const v = Math.abs(typeof p?.velocity === 'number' ? p.velocity : (p?.velocity?.y ?? 4));
    this._playAt('step', x, y, z, {
      surface: p?.surface ?? 'concrete', gait: 'land',
      level: clamp(v / 7, 0.35, 1.7) * OWN_STEP_LEVEL, gear: 1, occlusion: 0,
    }, 'foley', 0.9);
    if (v > 8.5) this._playDry('cloth', { level: 0.8 }, 'foley', 0.15);
  }

  _onPlayerState(p) {
    if (!this.running || !p) return;
    if (p.stance !== undefined && p.stance !== this._stance) {
      this._stance = p.stance;
      this._playDry('cloth', { level: 0.9 }, 'foley', 0.12);
    }
    if (p.ads !== undefined && p.ads !== this._ads) {
      this._ads = p.ads;
      this._playDry('cloth', { level: 0.45 }, 'foley', 0.1);
    }
  }

  _onDamageDealt(p) {
    if (!this.running || !p) return;
    // "Damage dealt TO p.target" — `ai` also uses this for rounds that hit the
    // player, and a hitmarker tick for being shot at is backwards. Incoming
    // damage is handled by _onDamageTaken.
    const t = p.target;
    if (t === 'player' || t?.isPlayer === true || t === this.ctx.peek('player')) return;
    this.ui(p.headshot ? 'headshot' : 'hitmarker', 1);
    if (p.killed) this.ui('kill', 1);
    else if (p.point && p.target && this.rng.float() < 0.3) {
      this.bark('hurt', p.point, { level: 0.85 });
    }
  }

  _onDamageTaken(p) {
    if (!this.running || !p) return;
    if (typeof p.health === 'number') this._health = p.health;
    this.ui('damage', clamp((p.amount ?? 20) / 25, 0.4, 1.4));
    if ((p.amount ?? 0) > 12 && this.rng.float() < 0.5) {
      this._playDry('bark', { bark: 'hit', level: 0.5, f0: 108 }, 'voice', 0.1);
    }
  }

  _onDeath(p) {
    if (!this.running) return;
    const pt = p?.point;
    if (!pt) return;
    this.bark('death', pt, { level: 1, force: true, voice: (p?.actor?.id ?? 0) | 0 });
    if (!this._allow('bodyfall')) return;
    this._playAt('bodyfall', pt.x, pt.y, pt.z, {
      level: 1, extraDelay: 0.45 + this.rng.range(0, 0.4),
    }, 'foley', 0.6);
  }

  /* ================================================================ */
  /* ambience callbacks                                               */
  /* ================================================================ */

  /** A burst of gunfire a long way off, with correct propagation delay. */
  _distantVolley() {
    if (!this.running) return;
    const rng = this.rng;
    const lp = this.field.listenerPos;
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(70, 240);
    const x = lp.x + Math.cos(a) * d;
    const z = lp.z + Math.sin(a) * d;
    const y = lp.y + rng.range(-2, 6);
    const profile = rng.pick([WEAPON_PROFILES.ak, WEAPON_PROFILES.rifle, WEAPON_PROFILES.lmg, WEAPON_PROFILES.sniper]);
    const rounds = 1 + ((rng.u32() % 6) | 0);
    const rate = rng.range(0.075, 0.13);
    for (let i = 0; i < rounds; i++) {
      this._playAt('shot', x, y, z, {
        profile, extraDelay: i * rate * rng.range(0.9, 1.1), maxDist: 400,
        gain: 4.5,
        occlusion: 0, // it is over the rooftops, not through them
        // ...and so is its tail: a volley 200 m away is outdoors by definition,
        // whatever room the listener happens to be standing in.
        echoBoost: WET_OUTDOOR,
      }, 'weapons', 0.2);
    }
  }

  _distantBoom() {
    if (!this.running) return;
    const rng = this.rng;
    const lp = this.field.listenerPos;
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(120, 330);
    this._playAt('explosion', lp.x + Math.cos(a) * d, lp.y + rng.range(0, 8), lp.z + Math.sin(a) * d, {
      radius: rng.range(6, 16), level: 1, maxDist: 400, occlusion: 0, gain: 6,
    }, 'weapons', 0.25);
  }

  _ambientOneShot() {
    if (!this.running) return;
    const rng = this.rng;
    const lp = this.field.listenerPos;
    const which = rng.pick(ONE_SHOTS);
    const far = which === 'heli' || which === 'siren';
    const d = far ? rng.range(90, 260) : rng.range(14, 90);
    const a = rng.range(0, Math.PI * 2);
    this._playAt('ambient',
      lp.x + Math.cos(a) * d,
      lp.y + rng.range(-1, which === 'heli' ? 28 : 5),
      lp.z + Math.sin(a) * d,
      {
        which, level: rng.range(0.55, 1), maxDist: 400,
        occlusion: far ? 0 : undefined,
        gain: far ? 14 : 2.5,
      }, 'ambience', 0.15);
  }

  _distantChatter() {
    if (!this.running) return;
    const rng = this.rng;
    const lp = this.field.listenerPos;
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(25, 75);
    this.bark(rng.pick(['advance', 'flank', 'copy', 'spot']), {
      x: lp.x + Math.cos(a) * d, y: lp.y, z: lp.z + Math.sin(a) * d,
    }, { level: 0.85, voice: rng.int(0, 9) });
  }

  /* ================================================================ */
  /* debug                                                            */
  /* ================================================================ */

  /**
   * Fire one of everything, through the real event bus. Used by
   * src/audio/probe.mjs to prove the live graph runs without throwing; also
   * handy from the browser console.
   */
  debugStorm() {
    if (!this.running) return { error: 'audio not running' };
    const lp = this.field.listenerPos;
    const at = (dx, dy, dz) => ({ x: lp.x + dx, y: lp.y + dy, z: lp.z + dz });
    const ev = this.ctx.events;
    ev.emit('weapon:fire', { weapon: 'rifle', origin: at(0.2, -0.1, -0.3), dir: { x: 0, y: 0, z: -1 }, seed: 1 });
    ev.emit('weapon:fire', { weapon: 'ak', origin: at(14, 0, -22), dir: { x: 0, y: 0, z: 1 }, seed: 2 });
    ev.emit('weapon:fire', { weapon: 'sniper', origin: at(-70, 3, 90), dir: { x: 1, y: 0, z: 0 }, seed: 3 });
    ev.emit('weapon:fire', { weapon: 'shotgun', origin: at(3, 0, -4), dir: { x: 0, y: 0, z: -1 }, seed: 4 });
    ev.emit('weapon:fire', { weapon: { id: 'mp5', suppressed: true }, origin: at(-2, 0, -3), dir: { x: 0, y: 0, z: -1 }, seed: 5 });
    ev.emit('weapon:fire', { weapon: 'rifle', origin: at(0.2, -0.1, -0.3), empty: true });
    const surfaces = ['concrete', 'metal', 'wood', 'dirt', 'sand', 'glass', 'water', 'foliage', 'fabric', 'flesh', 'rubber', 'plaster'];
    for (const s of surfaces) {
      ev.emit('bullet:impact', {
        point: at(this.rng.range(-6, 6), this.rng.range(0, 2), this.rng.range(-8, -2)),
        normal: { x: 0, y: 1, z: 0 }, incident: { x: 0, y: 0, z: -1 },
        surface: s, damage: 32, exit: false,
      });
      ev.emit('player:footstep', { position: at(0, -1.6, 0), surface: s, running: true });
    }
    ev.emit('weapon:shell', { position: at(0.3, -0.2, -0.2), velocity: { x: 1, y: 1, z: 0 } });
    // Every action type, because they were one sound with a volume knob until
    // an AKM and a bolt gun joined the loadout.
    for (const w of ['rifle', 'ak', 'sniper', 'shotgun']) {
      for (const ph of ['start', 'magout', 'magin', 'end']) ev.emit('weapon:reload', { weapon: w, phase: ph });
    }
    ev.emit('weapon:bolt', { weapon: 'sniper', duration: 0.78 });
    ev.emit('weapon:bolt', { weapon: 'sniper', duration: 0.78, position: at(11, 0, -6) });
    ev.emit('weapon:melee', { weapon: 'knife', phase: 'swing', kind: 'slash' });
    ev.emit('weapon:melee', { weapon: 'knife', phase: 'swing', kind: 'stab' });
    ev.emit('weapon:melee', { weapon: 'knife', phase: 'hit', surface: 'flesh', position: at(0.4, 0, -1.4) });
    for (const s of ['concrete', 'metal', 'wood', 'glass', 'sand']) {
      ev.emit('weapon:melee', { weapon: 'knife', phase: 'hit', surface: s, position: at(0.4, 0, -1.5) });
    }
    ev.emit('bullet:tracer', { from: at(-30, 0, -30), to: at(2, 0, 2), speed: 880 });
    ev.emit('player:land', { velocity: 9, surface: 'concrete' });
    ev.emit('player:state', { stance: 'crouch', sprinting: false, sliding: false, ads: true });
    ev.emit('damage:dealt', { target: { id: 3 }, amount: 34, headshot: true, killed: false, point: at(4, 0, -9) });
    ev.emit('damage:taken', { amount: 28, from: at(4, 0, -9), health: 24 });
    ev.emit('actor:death', { actor: { id: 3 }, point: at(4, -1.2, -9), impulse: { x: 0, y: 0, z: 0 } });
    for (const k of ['spot', 'reload', 'grenade', 'flank', 'suppress', 'advance', 'hurt', 'copy']) {
      this.bark(k, at(this.rng.range(-9, 9), 0, this.rng.range(-9, 9)), { force: true, voice: this.rng.int(0, 9) });
    }
    for (const w of ONE_SHOTS) {
      this._playAt('ambient', lp.x + 20, lp.y + 2, lp.z - 20, { which: w, level: 0.6 }, 'ambience', 0.1);
    }
    this._distantVolley();
    this._distantBoom();
    this._distantChatter();
    ev.emit('explosion', { position: at(6, 0, -7), radius: 8, damage: 120 });
    /**
     * THE AIR EVENTS, ALL THREE, EVERY PHASE. They were missing from the storm,
     * which is part of why the silent `settled` phase went unnoticed for as long
     * as it did: the live gate fired one of every event through the real bus and
     * these were not in the set.
     *
     * `salvo` and `stick` are the debounce cases — three sites and six bombs
     * arriving within a frame of each other. They must come out as two or three
     * voices, not nine. @see _onAirPhase
     */
    ev.emit('explosion', { position: at(9, 1, -14), radius: 15, damage: 260 });
    for (const src of ['match:airstrike', 'match:bomber', 'match:strafe']) {
      for (const phase of ['inbound', 'impact', 'settled']) {
        ev.emit(src, { phase, site: 'MID', run: { id: 1 }, position: at(11, 0, -18) });
      }
    }
    for (let i = 0; i < 3; i++) {
      ev.emit('match:airstrike', { phase: 'settled', site: `S${i}`, position: at(12 + i * 4, 0, -19) });
    }
    for (let i = 0; i < 6; i++) {
      ev.emit('match:bomber', { phase: 'settled', run: { id: 2 }, position: at(-14 - i * 3, 0, 22) });
    }
    /**
     * THE BATTLE LAYER, THROUGH ITS OWN FRONT DOORS. The `settled` phase of
     * every air event was silent for weeks because the storm did not contain it;
     * the same trap is waiting for anything added here that the storm skips.
     *
     * `offerFar` is fed a burst from one bearing so the coalescer has something
     * to flush on the next frame, and the tank is fired through the real event.
     * The ENGINE cannot be stormed — it is polled off `match.armour.tanks` — so
     * it is exercised in a live match instead, and measured by
     * `tools/audiotest.mjs --battle` rather than here.
     */
    for (let i = 0; i < 5; i++) {
      const p = at(-70 + i, 1, 82);
      this.battle?.offerFar(p.x, p.y, p.z, this.field.distanceTo(p.x, p.y, p.z), WEAPON_PROFILES.ak);
    }
    this.playFar(lp.x + 96, lp.y + 2, lp.z - 74, {
      profile: WEAPON_PROFILES.lmg, rounds: 5, spacing: 0.09,
    });
    ev.emit('match:tank', { phase: 'fire', id: 'T1', team: 0, position: at(26, 0, -34) });
    /**
     * THE CATHEDRAL. In the storm because the `settled` phase of every air event
     * was silent for weeks precisely because it was NOT in the storm: this gate
     * fires one of everything through the real front door, and anything left out
     * of it is a voice nobody proves runs until a player reports it missing.
     */
    const cath = at(-38, 2, 44);
    this.play('collapse_tear', cath, { dur: 6, size: 1 });
    this.play('collapse_sub', cath, { dur: 1.8 });
    this.play('collapse_bell', cath, { strikes: 3 });
    return { ok: true, voices: this.field.stats.active, errors: this.stats.errors };
  }

  /** Snapshot for the dev overlay and the probe script. */
  report() {
    return {
      running: this.running,
      failed: this.failed,
      state: this.actx?.state ?? 'none',
      sampleRate: this.actx?.sampleRate ?? 0,
      voices: this.field?.stats.active ?? 0,
      dropped: this.field?.stats.dropped ?? 0,
      stolen: this.field?.stats.stolen ?? 0,
      // How much of real time the audio thread is losing, and how many slots
      // the field is filling because of it. @see SpatialField._trackRender
      renderDeficit: this.field?.stats.deficit ?? 0,
      renderBehind: this.field?.stats.behind ?? 0,
      capacity: this.field?.stats.cap ?? 0,
      expired: this.field?.stats.expired ?? 0,
      occlusionRays: this.field?.stats.occlusionRays ?? 0,
      space: this.stats.space,
      spaceWeights: this.mixer ? { ...this.mixer.spaceWeights } : null,
      enclosure: this._space.enclosure,
      meanFree: this._space.meanFree,
      deafness: this.deafness,
      limiterReduction: this.mixer?.reduction ?? 0,
      events: this.stats.events,
      errors: this.stats.errors,
      // What the three new layers have actually played, and how much of the pool
      // they are holding right now. @see src/audio/battle.js
      battle: this.battle ? { ...this.battle.stats, enabled: this.battle.enabled } : null,
    };
  }
}
