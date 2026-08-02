/**
 * AUDIO / THE BATTLE AROUND YOU
 *
 * Three requests, one file, because all three are the same problem — sounds made
 * by OTHER PEOPLE, in numbers, competing for a pool of 72 spatial emitters:
 *
 *   「また敵味方の銃声があんまり聞こえないのでそれを追加すること 臨場感出して」
 *   「敵味方の足音もかすかに聞こえるようにして」
 *   「戦車の動く音とか砲撃の音も追加して」
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT WAS MEASURED FIRST
 * ────────────────────────────────────────────────────────────────────────────
 * A 20v20 match, real time, sampled at 4 Hz for two minutes of fighting
 * (`node tools/audiotest.mjs --battle`):
 *
 *   weapon:fire events offered   1982 at >70 m, 14 at 30-70 m, 0 inside 30 m
 *   remote shots actually played ~14, because `_onFire` culls past 60 m
 *   live emitters                mean 26.7 of 72   (foley 19.9, weapons 5.3)
 *
 * So the answer to 「銃声があんまり聞こえない」 is not a mixing opinion. Two thousand
 * shots were fired at the player over two minutes and the audio system was
 * shown 14 of them: the map is 114x141 m, the fight is at the capture points,
 * and a 60 m gate is a gate around one street. Meanwhile the WEAPONS bus — the
 * one that should be carrying a war — was using 5 of the 32 slots it is
 * entitled to, while foley used 20 of 28.
 *
 * The footsteps needed no measurement at all: `player:footstep` is emitted by
 * `src/player` and by nothing else, so every footstep sound in the game was the
 * local player's own boot. There has never been a friendly or enemy footfall in
 * this project — `ai` LISTENS to that event and does not emit it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE IS BUILT ON: DENSITY YIELDS
 * ────────────────────────────────────────────────────────────────────────────
 * The pool is shared, and its history is two failed passes at deciding who gets
 * it — one that blamed gunfire when foley held 50 of 72 slots, one that capped
 * foley and made WEAPONS take 42-50 and start DROPPING voices, which is strictly
 * worse than stealing them. Moving a shortage around is not fixing it.
 *
 * So nothing in here ever competes. Every layer asks `field.busLoad()` against
 * `field.busCap()` BEFORE it asks for a voice, and stands down when its bus is
 * already carrying its share — and stands down entirely while the render
 * governor has the pool below full strength (`field.capacity`), which is to say
 * the new content is the FIRST thing to go when the audio thread is in trouble
 * and the last thing to come back. That ordering is deliberate: a distant
 * firefight you cannot hear for two seconds is not a bug, and the dropout it
 * would otherwise cause is.
 *
 * `audio.battle.enabled = false` turns all of it off at runtime, which is how
 * `tools/audiotest.mjs --battle --off` measures the before and after of one
 * build on one machine.
 */

import { clamp } from './dsp.js';
import { WEAPON_PROFILES } from './weapons.js';
import { tankEngine } from './vehicle.js';

/* ---------------------------------------------------------------- */
/* Distant gunfire                                                   */
/* ---------------------------------------------------------------- */

/**
 * Bearing bins. A firefight is a DIRECTION before it is a position — at 120 m
 * nobody can place a rifle to the metre, and eight men shooting from the same
 * quarter of the map are one event to the ear. Coalescing by bearing is what
 * turns 16 shots a second into 4 voices a second without thinning the battle:
 * the rounds are all still there, scheduled inside the voice.
 */
const BINS = 8;
/** How long a bin may collect before it has to be heard. Longer = laggy. */
const BIN_WINDOW = 0.34;
/** Rounds one voice will carry. Past this the bin flushes early. */
const BIN_ROUNDS = 6;
/** Voices a second, all bins together. */
const FAR_RATE = 5;
/** Nothing past this is worth a slot; `ambience` carries the rest of the war. */
const FAR_MAX = 230;
/**
 * Where the near path stops. `_onFire` plays a full `weaponShot` inside this and
 * this file takes everything outside it — the two ranges MUST agree or a band of
 * the map goes silent again. @see AudioSystem._onFire
 */
const FAR_MIN = 60;

/* ---------------------------------------------------------------- */
/* Footsteps of other men                                            */
/* ---------------------------------------------------------------- */

/**
 * 40 m. NOT a fresh guess: this range was cut from 45 to 26 once as a fix for
 * the voice pool, movement went inaudible, and it had to be put back — the whole
 * of 「敵味方の足音もかすかに聞こえるようにして」 is a request for the thing that cut
 * removed. It is far enough to hear a man crossing the courtyard you are
 * watching, the level falls with distance anyway (so it is faint, which is what
 * was asked for), and the pool is protected by the budget gate rather than by
 * making the game quieter.
 */
const STEP_RANGE = 40;
/** Footfalls a second, everybody on the map together. */
const STEP_RATE = 9;
/** …and the most that may be started in any one frame, however many are due. */
const STEP_PER_FRAME = 2;
/**
 * Stride length per gait, metres. A step is emitted per stride of GROUND
 * COVERED rather than on a timer, so the cadence is automatically right at every
 * speed and a man who stops mid-stride does not get a phantom footfall. Same
 * principle `src/ai/animator.js` uses to keep the visible feet stuck to the
 * ground, so the two stay in step without either subsystem knowing the other.
 */
const STRIDE = { crouch: 1.1, walk: 1.62, run: 1.92, sprint: 2.12 };
/** Below this a man is standing still, whatever the animation is doing. */
const STEP_MIN_SPEED = 0.35;

/**
 * HOW LOUD ANOTHER MAN'S BOOT IS, per metre — 「敵味方の足音はもう少し小さくして
 * ください」.
 *
 * The first version played every remote step at the same trim as the local
 * player's own (1.0, the argument being "another man's boot is the same boot").
 * That was reported as too loud, and the shape of the complaint matters more
 * than the amount: the steps that are too loud are the NEAR ones. The distance
 * curve is steep in the first ten metres and nearly flat after thirty, so a flat
 * trim is loudest exactly where the player is most likely to be standing next to
 * somebody, and a flat CUT would take the same decibels off a man at 38 m — who
 * is already at the edge of audibility.
 *
 * TAKING THE RANGE DOWN INSTEAD IS THE ONE THING THAT MUST NOT HAPPEN. It was
 * done once (45 m -> 26 m, to save emitters), it made movement inaudible, and it
 * had to be put back to 40 m; 「足音もかすかに聞こえるようにして」 is a request for
 * precisely the thing that cut removed. So the range is untouched and the trim
 * is tilted: -5.7 dB at 8 m, -2.0 dB at 40 m.
 *
 * MEASURED through the real mixer and the real distance chain (selftest.js),
 * against the player's own step at peak 0.0378 and the ambience bed at rms
 * 0.00362:
 *
 *              was (flat 1.0)      now
 *    8 m       0.0098              0.0051    -17.4 dB under his own boot
 *   20 m       0.0040              0.0025    -23.6 dB
 *   40 m       0.0019              0.0015    -28.0 dB, still above the bed
 */
export function remoteStepLevel(dist) {
  return 0.45 + 0.35 * clamp(dist / STEP_RANGE, 0, 1);
}
/** How often a man's ground surface is re-checked, seconds. One ray each. */
const SURFACE_TTL = 2.5;

/* ---------------------------------------------------------------- */
/* Armour                                                            */
/* ---------------------------------------------------------------- */

/** A tank is audible a long way off; this is where it stops being worth a slot. */
const ENGINE_RANGE = 190;
/** Advance speed in `src/match/tank.js` is 4.6 m/s; this normalises the throttle. */
const TANK_TOP_SPEED = 4.6;

export class BattleLayer {
  /** @param {import('./index.js').AudioSystem} audio */
  constructor(audio) {
    this.audio = audio;
    this.enabled = true;

    /* ---- distant fire: preallocated bins, nothing per frame ------ */
    this._binN = new Int32Array(BINS);
    this._binX = new Float64Array(BINS);
    this._binY = new Float64Array(BINS);
    this._binZ = new Float64Array(BINS);
    this._binT = new Float64Array(BINS);
    this._binP = new Array(BINS).fill(null);
    this._binCursor = 0;
    this._farNext = 0;

    /* ---- footsteps ---------------------------------------------- */
    // Keyed on the Agent itself: `match` replaces a respawned bot with a NEW
    // Agent, so anything keyed on an id would resurrect a dead man's stride
    // phase. A WeakMap also needs no pruning pass.
    this._walkers = new WeakMap();
    this._stepNext = 0;
    this._probeOrigin = { x: 0, y: 0, z: 0 };
    this._down = { x: 0, y: -1, z: 0 };

    /* ---- armour -------------------------------------------------- */
    this._tanks = [];
    this._dying = [];

    this.stats = {
      farVoices: 0, farRounds: 0, farHeld: 0,
      steps: 0, stepsHeld: 0,
      engines: 0, tankShots: 0,
    };
  }

  /* ================================================================ */
  /* budget                                                           */
  /* ================================================================ */

  /**
   * May a BACKGROUND voice take a slot on `bus` right now?
   *
   * Two questions, and both have to be yes:
   *   1. how much of the field is the render governor still willing to fill?
   *      When the audio thread is losing real time the correct amount of extra
   *      content is less, and at the floor it is none. @see _trackRender
   *   2. is this bus under `share` of its own quota? Not of the pool — of its
   *      quota, so a busy foley bus stops the footsteps without touching the
   *      gunfire and vice versa.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * (1) WAS A CLIFF AND THE CLIFF WAS THE BUG.
   * ──────────────────────────────────────────────────────────────────────────
   * It read `if (f.capacity < f.emitters.length * 0.66) return false`, so 47 of
   * 72 slots and 24 of 72 were the same state: nothing. MEASURED by pinning the
   * governor (`tools/audiotest.mjs --battle --clamp=N`) through a live 20v20:
   *
   *   pool 60/72   26 far voices, 35 remote footfalls   (390 remote shots offered)
   *   pool 48/72   26 far voices, 42 remote footfalls   (592 offered)
   *   pool 40/72    0 far voices,  0 remote footfalls   (1003 offered)
   *
   * A thousand shots were fired at the player over eighty-nine seconds of game
   * and he was played none of them, because the pool was seven slots under an
   * arbitrary line. That is 「敵味方の銃声があんまり聞こえない」 arriving as a switch
   * rather than as a mix, and it is invisible from inside a match: the counters
   * stay healthy, nothing is dropped, nothing is stolen, there is simply no war.
   *
   * The ORDERING is deliberate and is kept — this content is still the first
   * thing to go when the thread is in trouble and the last to come back. What
   * changes is that the last stretch of that is a FADE instead of a switch, and
   * the fade is placed so that this is never LESS permissive than the code it
   * replaces: `head` is 1 everywhere above the old 66 % line, so a healthy match
   * behaves bit for bit as it did, and it falls to 0 at the pool's floor, where
   * the layer stood down before and still does. Everything it changes lies
   * strictly inside the band that used to be silent.
   *
   * The layer still cannot grow the pool — that is the bus quota's job, and the
   * quota is a share of the CURRENT cap, so it has already shrunk too.
   */
  _room(bus, share) {
    const f = this.audio.field;
    if (!f) return false;
    const full = f.emitters.length;
    if (!full) return false;
    // 0 at the governor's floor (0.34 of full), 1 at the old cliff (0.66).
    const head = clamp((f.capacity - full * 0.34) / (full * 0.32), 0, 1);
    if (head <= 0.02) return false;
    return f.busLoad(bus) < f.busCap(bus) * share * head;
  }

  /* ================================================================ */
  /* distant gunfire                                                  */
  /* ================================================================ */

  /**
   * A remote shot too far away for the full voice. Returns true when it was
   * taken into a bin — the caller has then done its job and must not also play
   * it, which is the invariant that keeps one shot from being heard twice.
   */
  offerFar(x, y, z, dist, profile) {
    if (!this.enabled) return false;
    if (dist < FAR_MIN || dist > FAR_MAX) return false;
    const lp = this.audio.field.listenerPos;
    // Bearing in the horizontal plane, listener-relative. atan2 returns
    // (-pi, pi]; the +pi shifts it into [0, 2pi) so the bin index is a floor.
    const a = Math.atan2(z - lp.z, x - lp.x) + Math.PI;
    const b = Math.min(BINS - 1, ((a / (Math.PI * 2)) * BINS) | 0);
    if (this._binN[b] === 0) {
      this._binT[b] = this.audio.actx.currentTime;
      this._binX[b] = 0; this._binY[b] = 0; this._binZ[b] = 0;
    }
    this._binN[b]++;
    this._binX[b] += x; this._binY[b] += y; this._binZ[b] += z;
    this._binP[b] = profile ?? WEAPON_PROFILES.rifle;
    return true;
  }

  /** Flush whichever bins are ready, inside the voice budget. */
  _updateFar(now) {
    // Round-robin the start of the scan so one bearing cannot monopolise the
    // rate limit just because it is first in the array.
    for (let k = 0; k < BINS; k++) {
      const b = (this._binCursor + k) % BINS;
      const n = this._binN[b];
      if (n === 0) continue;
      const age = now - this._binT[b];
      if (age < BIN_WINDOW && n < BIN_ROUNDS) continue;
      if (now < this._farNext) return;                 // over rate; keep collecting
      if (!this._room('weapons', 0.7)) { this._binN[b] = 0; continue; }
      this._binCursor = (b + 1) % BINS;
      this._farNext = now + 1 / FAR_RATE;
      const rounds = Math.min(BIN_ROUNDS, n);
      const x = this._binX[b] / n, y = this._binY[b] / n, z = this._binZ[b] / n;
      this._binN[b] = 0;
      // Spacing is the cadence that actually happened: the rounds arrived over
      // `age` seconds, so play them over `age` seconds. A bin that filled in
      // 40 ms was a burst and sounds like one.
      const spacing = clamp(age / Math.max(1, rounds - 1), 0.05, 0.22);
      // The voice takes its distance from the emitter's own position, which is
      // the mean of the bin — so the band it is shaped for and the attenuation
      // it is played at are the same number by construction.
      const ok = this.audio.playFar(x, y, z, { profile: this._binP[b], rounds, spacing });
      if (ok) { this.stats.farVoices++; this.stats.farRounds += rounds; }
    }
  }

  /* ================================================================ */
  /* footsteps                                                        */
  /* ================================================================ */

  /**
   * Every live actor's boots. There is no event for this — `ai` does not emit
   * one — so the stride is integrated from the actor's own POSITION, which is
   * published (`ai.agents`) and cannot disagree with what is drawn.
   */
  _updateSteps(dt, now) {
    const audio = this.audio;
    const ai = audio.ctx.peek('ai');
    const agents = ai?.agents;
    if (!agents || !agents.length) return;
    const lp = audio.field.listenerPos;
    const rate = 1 / STEP_RATE;
    let started = 0;

    for (let pass = 0; pass < STEP_PER_FRAME; pass++) {
      let best = null, bestD = Infinity;

      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        const p = a?.position;
        if (!p) continue;
        let w = this._walkers.get(a);
        if (!w) {
          // Allocated once per ACTOR, not per frame. A 5 minute match with
          // respawns makes a few hundred of these and no more.
          w = { x: p.x, y: p.y, z: p.z, acc: 0, surface: 'concrete', surfAt: -99, due: false };
          this._walkers.set(a, w);
          continue;
        }
        // The integration runs on the FIRST pass only; the second pass is just
        // picking the next-nearest man who was already found to be due.
        if (pass === 0) {
          const dx = p.x - w.x, dz = p.z - w.z;
          w.x = p.x; w.y = p.y; w.z = p.z;
          if (!a.alive) { w.acc = 0; w.due = false; continue; }
          const moved = Math.sqrt(dx * dx + dz * dz);
          const speed = dt > 1e-4 ? moved / dt : 0;
          if (speed < STEP_MIN_SPEED) { w.due = false; continue; }
          w.speed = speed;
          w.acc += moved;
          const gait = a.crouch ? 'crouch' : speed >= 5.4 ? 'sprint' : speed >= 3.4 ? 'run' : 'walk';
          w.gait = gait;
          if (w.acc < STRIDE[gait]) { w.due = false; continue; }
          w.due = true;
        }
        if (!w.due) continue;
        const d = Math.hypot(p.x - lp.x, p.y - lp.y, p.z - lp.z);
        if (d > STEP_RANGE) { w.acc = 0; w.due = false; continue; }
        if (d < bestD) { bestD = d; best = w; }
      }

      if (!best) return;
      // Budget and rate are checked AFTER the nearest due man is found, so a
      // refusal costs the near one his footfall rather than whoever happened to
      // be first in the roster.
      if (now < this._stepNext) return;
      if (!this._room('foley', 0.72)) { best.acc = 0; best.due = false; return; }
      this._stepNext = now + rate;
      best.acc -= STRIDE[best.gait];
      best.due = false;
      this._step(best, bestD, now);
      if (++started >= STEP_PER_FRAME) return;
    }
  }

  _step(w, dist, now) {
    const audio = this.audio;
    if (now - w.surfAt > SURFACE_TTL) {
      w.surfAt = now;
      const phys = audio.ctx.peek('physics');
      if (phys?.raycast) {
        const o = this._probeOrigin;
        o.x = w.x; o.y = w.y + 0.9; o.z = w.z;
        const h = phys.raycast(o, this._down, 2.4, phys.MASK?.WORLD);
        if (h?.hit && h.surface) w.surface = h.surface;
      }
    }
    /**
     * FAINT IS THE DISTANCE, AND NOW ALSO THE TRIM. @see remoteStepLevel for the
     * measurements and for why the RANGE is not the lever that moved.
     */
    const ok = audio._playAt('step', w.x, w.y, w.z, {
      surface: w.surface,
      gait: w.gait,
      level: remoteStepLevel(dist),
      // Kit is the bright, carrying part of a footfall and the part that reads
      // as "loud" across a street, so it comes down further than the boot does.
      gear: w.gait === 'crouch' ? 0.12 : w.gait === 'walk' ? 0.22 : 0.45,
      tag: 'step',
      /**
       * 0.28. A remote footfall must not be able to evict anything that matters:
       * `acquire` will only steal a voice whose priority is at most `pri + 0.25`,
       * so at 0.28 this reaches nothing above 0.53 — no shot (0.4 floor, 0.95 at
       * the muzzle), no explosion, no bark, not your own boots at 0.99. It can
       * take a slot from another remote footstep, which is exactly the intent:
       * the nearest man wins, and the pool never grows because of this layer.
       */
    }, 'foley', 0.28);
    if (ok) this.stats.steps++;
  }

  /* ================================================================ */
  /* armour                                                           */
  /* ================================================================ */

  /**
   * One tracked emitter per hull that is on the map. `match.armour.tanks` is the
   * published record — `[{ id, team, name, alive, health, position }]` — and
   * SPEED IS DIFFERENTIATED FROM POSITION rather than read out of `tank.js`,
   * which publishes no velocity and is not ours to change.
   */
  _updateTanks(dt, now) {
    const audio = this.audio;
    /**
     * `tank` AND `armour`, BECAUSE THE PUBLISHED NAME AND THE FIELD DISAGREE.
     * `src/match/tank.js` documents its own handle as `ctx.get('match').armour`
     * and `src/match/index.js` assigns it to `this.tank`. Reading only the
     * documented one found `undefined` on every frame of every match and the
     * engine never started — measured, silently, with no error: a null-safe
     * chain on a name that does not exist is indistinguishable from "no tanks in
     * this match". Both names are read, and whichever `match` actually has wins.
     */
    const m = audio.ctx.peek('match');
    const armour = m?.tank ?? m?.armour;
    const list = armour?.tanks;
    if (!list) { if (this._tanks.length) this._stopAllEngines(now); return; }

    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const p = t?.position;
      if (!p) continue;
      let rec = this._tanks[i];
      if (!rec) {
        rec = { x: p.x, y: p.y, z: p.z, speed: 0, engine: null, em: null };
        this._tanks[i] = rec;
      }
      const dx = p.x - rec.x, dy = p.y - rec.y, dz = p.z - rec.z;
      rec.x = p.x; rec.y = p.y; rec.z = p.z;
      const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // A tracked vehicle does not change speed in a frame; smoothing it keeps
      // one long frame from making the engine bark.
      const inst = dt > 1e-4 ? moved / dt : 0;
      rec.speed += (Math.min(inst, 12) - rec.speed) * Math.min(1, dt * 6);

      const dist = audio.field.distanceTo(p.x, p.y, p.z);
      const want = this.enabled && !!t.alive && dist < ENGINE_RANGE;
      if (want && !rec.engine) this._startEngine(rec, p, dist, now);
      if (!want && rec.engine) this._stopEngine(rec, now);
      if (rec.engine) {
        rec.em.moveTo(p.x, p.y + 1.1, p.z, 0.08);
        rec.engine.drive(clamp(rec.speed / TANK_TOP_SPEED, 0, 1), rec.speed, now);
        /**
         * RENEW THE LEASE. A `tracked` emitter is exempt from the expiry loop,
         * so it is held for as long as its owner keeps saying so — and if THIS
         * loop ever stops running (a throw upstream, a torn-down match, a tank
         * record that goes away) the slot would be pinned for the rest of the
         * game with an engine playing into it. The field takes it back three
         * seconds after the last renewal. @see Emitter.lease
         */
        rec.em.lease = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000 + 3;
      }
    }

    // Anything faded out is disconnected here, on the frame loop, so no timer
    // outlives dispose().
    for (let i = this._dying.length - 1; i >= 0; i--) {
      const d = this._dying[i];
      if (now < d.at) continue;
      d.engine.free();
      d.em?.detach();
      this._dying.splice(i, 1);
    }
  }

  _startEngine(rec, p, dist, now) {
    const audio = this.audio;
    const f = audio.field;
    // Do not START one while the governor has the pool clamped — but an engine
    // that is already running keeps running: a tank that goes silent halfway
    // down the street is a worse artefact than a tank that arrives late.
    if (f.capacity < f.emitters.length * 0.66) return;
    const em = f.acquire({
      x: p.x, y: p.y + 1.1, z: p.z,
      when: now, dist, bus: 'weapons',
      priority: 0.92,
      send: 0.1,
      /**
       * 0.9, MEASURED. At 2.4 a hull rolling 25 m away rendered at rms 0.0316
       * through the real mixer — seven times the rms of the player's own rifle
       * (0.00356) and nearly nine times the whole ambience bed (0.00362), for a
       * sound that is CONTINUOUS. It would have buried the game. At 0.9 the same
       * hull is rms 0.0119: still the loudest thing on the street by a wide
       * margin, which a 50-tonne diesel should be, and still under a gunshot.
       */
      gain: 0.9,
      endTime: now + 3600,
      tracked: true,
    });
    if (!em) return;
    const engine = tankEngine(audio.actx, audio.bank, audio.rng, { when: now });
    f.hold(em, engine.node, now + 3600, 0.1);
    rec.engine = engine;
    rec.em = em;
    this.stats.engines++;
  }

  _stopEngine(rec, now) {
    if (!rec.engine) return;
    const at = rec.engine.stop(now);
    this._dying.push({ engine: rec.engine, em: rec.em, at });
    rec.engine = null;
    rec.em = null;
  }

  _stopAllEngines(now) {
    for (const rec of this._tanks) if (rec?.engine) this._stopEngine(rec, now);
  }

  /** `match:tank { phase: 'fire' }` — the report the roll was missing. */
  onTankFire(x, y, z) {
    if (!this.enabled) return;
    const ok = this.audio._playAt('tankgun', x, y + 1.6, z, {
      /**
       * 3.0, and it is the one sound in this file that is allowed to be LOUDER
       * than the player's own weapon: measured at 30 m it peaks at 0.050 against
       * his rifle's 0.0831 in his own hands, and `tank.js` plays its roll on top
       * of this. A 120 mm going off down the street from you is the loudest
       * thing in the match and the mix should say so.
       */
      level: 1, maxDist: 400, gain: 3.0, occlusion: 0.25, send: 0.22,
    }, 'weapons', 0.99);
    if (ok) this.stats.tankShots++;
  }

  /* ================================================================ */
  /* frame                                                            */
  /* ================================================================ */

  update(dt, now) {
    // The armour loop runs even when the layer is disabled, so that turning it
    // off mid-match (the A/B control) shuts the engines down instead of
    // stranding two tracked emitters in the pool for ever.
    this._updateTanks(dt, now);
    if (!this.enabled) return;
    this._updateFar(now);
    this._updateSteps(dt, now);
    const f = this.audio.field;
    let far = 0, steps = 0;
    for (const em of f.emitters) {
      if (em.free) continue;
      if (em.kindTag === 'far') far++;
      else if (em.kindTag === 'step') steps++;
    }
    this.stats.farHeld = far;
    this.stats.stepsHeld = steps;
  }

  dispose() {
    for (const rec of this._tanks) {
      if (!rec?.engine) continue;
      rec.engine.free();
      rec.em?.detach();
      rec.engine = null;
      rec.em = null;
    }
    for (const d of this._dying) { d.engine.free(); d.em?.detach(); }
    this._dying.length = 0;
    this._tanks.length = 0;
  }
}
