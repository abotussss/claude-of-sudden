/**
 * AUDIO / SPATIALISATION
 *
 * A pool of reusable 3D emitter chains. Each chain is:
 *
 *   input ─► occlusionLP ─► airLP ─► distanceGain ─┬─► panner (HRTF) ─► bus
 *                                                  └─► sendGain ─► reverb send
 *
 * Notes on the design decisions, because they are not the obvious ones:
 *
 *  - The PannerNode's own distance model is switched OFF (rolloffFactor 0) and
 *    attenuation is applied by `distanceGain` instead. That is what lets the
 *    reverb send be *post* distance attenuation but *pre* panning, which is how
 *    a far source correctly ends up wetter than a near one.
 *  - `airLP` is air absorption, `occlusionLP` is geometry. They are separate so
 *    a distant *and* occluded source stacks both losses, as it should.
 *  - The whole chain is built once and only the panner→bus edge is connected
 *    while the emitter is in use; a free emitter is detached from the graph so
 *    the (expensive) HRTF convolution is not evaluated for silence.
 *  - Propagation delay is not a DelayNode: every voice is *scheduled* at
 *    `now + dist/343`, which is sample-accurate and free.
 */

import { airCutoff, clamp, gain, biquad } from './dsp.js';

/**
 * Concurrent spatialised voices. Raised from 40 for the 7v7 mode: thirteen
 * actors is twice upstream's garrison, and 40 was measured to sit at 100%
 * capacity for a whole round. The budget in `_onFire` is the real fix — this is
 * headroom so a genuine four-way firefight is not fighting the pool as well.
 * Each emitter is a panner plus three filters and a gain, built once at boot.
 */
/**
 * 72, up from 48, which was up from 40.
 *
 * Sized against the ROSTER each time, and the roster is now fifteen a side.
 * MEASURED in a live 15v15 match: with the budgets retuned (see `_rate` and the
 * 60 m shot cull in index.js) the field still sat at 48/48 with 429 voices
 * stolen in two minutes — better than the 818 before the retune, but pinned is
 * pinned, and a pinned field is what the player hears as the effects
 * disappearing. Thirty actors need more slots than thirteen; no amount of
 * budgeting turns 48 into enough when the map is 114x141 m and half of it is
 * shooting.
 *
 * Emitters are Web Audio node chains, built once and recycled. They cost graph
 * nodes on the audio thread, not frame time on the main one, which is why this
 * is the cheap half of the fix and the budgets above are the important half —
 * raising this alone would just buy a slightly later collapse.
 */
const MAX_EMITTERS = 72;

/**
 * THE FLOOR THE POOL MAY SHRINK TO WHEN THE RENDER THREAD CANNOT KEEP UP.
 *
 * 72 is a budget in SLOTS, and a slot is free. What is not free is rendering
 * what is in it, and that bill is paid on the audio thread, which has a hard
 * real-time deadline: a render quantum that takes longer than 2.67 ms at 48 kHz
 * is a quantum the output does not get. MEASURED in a live match (see
 * `renderDeficit`), the moment the field pinned at 72/72 the context rendered
 * 0.6 %-30 % of real time for twenty seconds — the audio clock fell 18 s behind
 * the wall clock — and that is the reported bug: 「色々な音が集中すると音が全て
 * 消える」. Not one gain reached zero; there simply was no output to gain.
 *
 * 24 is the largest pool that measured comfortably inside real time on the
 * machine this was traced on. It is a FLOOR, not a target: the field runs at 72
 * and only walks down toward this while the thread is actually behind.
 */
const MIN_EMITTERS = 24;

/** How much of real time the renderer may lose before the pool starts shrinking. */
const DEFICIT_SHRINK = 0.12;
/** …and how close to even it must be before slots are handed back. */
const DEFICIT_RELEASE = 0.03;
/** Window the deficit is integrated over, seconds of WALL time. */
const DEFICIT_WINDOW = 0.25;
/** Audio seconds owed before the pool shrinks whatever the window says. */
const BEHIND_SHRINK = 0.2;
/** …and how nearly level the clocks must be before slots are handed back. */
const BEHIND_LEVEL = 0.06;
/**
 * Grace on the wall-clock backstop, seconds. Normal jitter between the two
 * clocks is microseconds; this only ever expires a voice that the audio clock
 * has stopped being able to expire.
 */
const WALL_SLACK = 0.3;

/** Reference distance for the attenuation curve, in metres. */
const REF = 2.0;

/**
 * The attenuation curve as a free function, so it can be measured without a
 * live field. `SpatialField.attenuation` is this and nothing else.
 *
 * It exists because "how loud is a remote rifle against your own" is a question
 * about the curve, not about the graph: `src/audio/selftest.js` renders voices
 * through the real mixer in an OfflineAudioContext where no field exists, and
 * without this it could only compare voices at 0 m — which is exactly the
 * comparison that does not matter.
 */
export function attenuationAt(dist) {
  const near = REF / (REF + 0.85 * Math.max(0, dist - REF));
  const far = 0.055 * Math.pow(60 / Math.max(dist, 60), 0.55);
  return clamp(Math.max(near, dist > 45 ? far : 0), 0.0, 1);
}

const nowWall = () =>
  (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

class Emitter {
  constructor(actx, mixer) {
    this.actx = actx;
    this.mixer = mixer;
    this.input = gain(actx, 1);
    this.occLP = biquad(actx, 'lowpass', 20000, 0.4);
    this.occHS = biquad(actx, 'highshelf', 2200, 0.7, 0);
    this.airLP = biquad(actx, 'lowpass', 20000, 0.5);
    this.distGain = gain(actx, 1);
    this.sendGain = gain(actx, 0);

    const p = actx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1;
    p.rolloffFactor = 0; // attenuation handled by distGain
    p.maxDistance = 10000;
    p.coneInnerAngle = 360;
    this.panner = p;

    this.input.connect(this.occLP);
    this.occLP.connect(this.occHS);
    this.occHS.connect(this.airLP);
    this.airLP.connect(this.distGain);
    this.distGain.connect(this.panner);
    this.distGain.connect(this.sendGain);

    this.free = true;
    this.endTime = 0;
    /** Same deadline on the WALL clock. @see SpatialField.update */
    this.wallEnd = 0;
    this.priority = 0;
    this.busName = 'foley';
    this.attached = null;
    this.tracked = false;
    /**
     * WALL TIME A TRACKED EMITTER IS HELD UNTIL WITHOUT BEING RENEWED.
     *
     * `tracked` means "the expiry loop must not touch this" — beds and engines
     * end when their owner says so, not on a timer. That is an IMMORTAL SLOT,
     * and an immortal slot whose owner has stopped running (an exception in a
     * frame loop, a subsystem torn down, a tank record dropped) pins a share of
     * the pool for the rest of the match with nothing playing through it.
     *
     * So a tracked emitter holds a LEASE instead: its owner renews it every
     * frame, and if the owner stops for a couple of seconds the field takes the
     * slot back. Nothing in this subsystem is allowed to hold a voice for ever
     * on the strength of somebody else's loop still working.
     */
    this.lease = Infinity;
    /** What KIND of sound is in this slot. @see SpatialField.acquire */
    this.kindTag = null;
    this.pos = { x: 0, y: 0, z: 0 };
    this._connected = false;
    this._sendConnected = false;
  }

  _setPos(x, y, z, when) {
    const p = this.panner;
    if (p.positionX) {
      p.positionX.setValueAtTime(x, when);
      p.positionY.setValueAtTime(y, when);
      p.positionZ.setValueAtTime(z, when);
    } else {
      p.setPosition(x, y, z);
    }
    this.pos.x = x; this.pos.y = y; this.pos.z = z;
  }

  /** Smoothly move a long-lived emitter (ambience beds, voices, loops). */
  moveTo(x, y, z, smooth = 0.06) {
    const p = this.panner;
    const t = this.actx.currentTime;
    if (p.positionX) {
      p.positionX.setTargetAtTime(x, t, smooth);
      p.positionY.setTargetAtTime(y, t, smooth);
      p.positionZ.setTargetAtTime(z, t, smooth);
    } else {
      p.setPosition(x, y, z);
    }
    this.pos.x = x; this.pos.y = y; this.pos.z = z;
  }

  connectOut(busNode, sendNode) {
    if (!this._connected) {
      this.panner.connect(busNode);
      this._connected = busNode;
    }
    if (!this._sendConnected && sendNode) {
      this.sendGain.connect(sendNode);
      this._sendConnected = sendNode;
    }
  }

  detach() {
    if (this._connected) {
      try { this.panner.disconnect(this._connected); } catch { /* noop */ }
      this._connected = false;
    }
    if (this._sendConnected) {
      try { this.sendGain.disconnect(this._sendConnected); } catch { /* noop */ }
      this._sendConnected = false;
    }
    if (this.attached) {
      try { this.attached.disconnect(); } catch { /* noop */ }
      this.attached = null;
    }
    this.tracked = false;
    this.free = true;
  }

  dispose() {
    this.detach();
    this.input.disconnect();
    this.occLP.disconnect();
    this.occHS.disconnect();
    this.airLP.disconnect();
    this.distGain.disconnect();
    this.sendGain.disconnect();
    this.panner.disconnect();
  }
}

export class SpatialField {
  /**
   * @param {BaseAudioContext} actx
   * @param {import('./mixer.js').Mixer} mixer
   * @param {object} ctx engine context (for physics raycasts); may be null
   */
  constructor(actx, mixer, ctx) {
    this.actx = actx;
    this.mixer = mixer;
    this.ctx = ctx;
    this.emitters = [];
    for (let i = 0; i < MAX_EMITTERS; i++) this.emitters.push(new Emitter(actx, mixer));

    // Preallocated scratch — update() must never allocate.
    this._lp = { x: 0, y: 1.6, z: 0 };
    this._occOrigin = { x: 0, y: 0, z: 0 };
    this._occDir = { x: 0, y: 0, z: 0 };
    this._trackCursor = 0;
    this.stats = {
      active: 0, stolen: 0, dropped: 0, occlusionRays: 0,
      // How far behind real time the audio thread is running, 0..1, and how
      // many slots the field is willing to fill because of it.
      deficit: 0, behind: 0, cap: MAX_EMITTERS, expired: 0,
      /** Tracked slots reclaimed because nobody renewed them. @see Emitter.lease */
      leaked: 0,
      /** Emitters freed by a watchdog drain. @see SpatialField.drain */
      drained: 0,
    };
    this.occlusionEnabled = true;

    /**
     * RENDER HEADROOM. `actx.currentTime` advances with what the audio thread
     * has actually rendered; `performance.now()` advances regardless. The gap
     * between them per unit of wall time IS the fraction of the output that
     * never got made, and it is the only honest measure of whether the graph
     * fits — voice counts, gains and error counters all look perfectly healthy
     * while the player hears nothing.
     */
    this.cap = MAX_EMITTERS;
    this._accWall = 0;
    this._accAudio = 0;
    this._wallPrev = 0;
    this._audioPrev = 0;
    /**
     * The smallest gap ever seen between the two clocks — their epochs are
     * unrelated, so only the CHANGE in the gap means anything. `behind` is that
     * change: seconds of audio the thread owes and has not made. It is the
     * honest "how much silence is queued" number, and unlike the per-window
     * deficit it does not read healthy while the context is catching up.
     */
    this._lagMin = Infinity;
    this.behind = 0;
  }

  /** Slots the field will fill right now. Falls with the render deficit. */
  get capacity() {
    return this.cap | 0;
  }

  /** Emitters currently held, i.e. connected to a bus and being rendered. */
  _load() {
    let n = 0;
    for (let i = 0; i < this.emitters.length; i++) if (!this.emitters[i].free) n++;
    return n;
  }

  /**
   * Integrate the render deficit over `DEFICIT_WINDOW` of wall time and move
   * the cap. Down fast (the thread is already missing deadlines), back up in
   * steps of six a window — about two seconds from the floor to full — so a
   * single heavy blast does not cost the rest of the round its density.
   */
  _trackRender(audioNow) {
    const wall = nowWall();
    const lag = wall - audioNow;
    if (lag < this._lagMin) this._lagMin = lag;
    this.behind = lag - this._lagMin;
    if (this._wallPrev) {
      this._accWall += Math.min(0.5, wall - this._wallPrev);
      this._accAudio += Math.max(0, audioNow - this._audioPrev);
    }
    this._wallPrev = wall;
    this._audioPrev = audioNow;
    if (this._accWall < DEFICIT_WINDOW) return;
    const deficit = clamp(1 - this._accAudio / this._accWall, 0, 1);
    this._accWall = 0;
    this._accAudio = 0;
    this.stats.deficit = deficit;
    this.stats.behind = +this.behind.toFixed(3);
    /**
     * The baseline is allowed to walk BACK UP by 2 ms a window while the thread
     * is level. Two clocks from two sources drift against each other — a few
     * hundred parts per million is ordinary — and a running minimum with no
     * forgiveness would read that drift as debt and eventually hold the pool
     * down in a match that is running perfectly. 8 ms a second forgives any
     * plausible drift by three orders of magnitude and cannot hide a real
     * stall, which loses tenths of a second per second.
     */
    if (deficit < DEFICIT_RELEASE) this._lagMin = Math.min(lag, this._lagMin + 0.002);
    if (deficit > DEFICIT_SHRINK || this.behind > BEHIND_SHRINK) {
      this.cap = Math.max(MIN_EMITTERS, Math.floor(this.cap * 0.55));
    } else if (deficit < DEFICIT_RELEASE && this.behind < BEHIND_LEVEL && this.cap < MAX_EMITTERS) {
      // Slots come back only once the thread is LEVEL, not merely once it has
      // stopped losing ground — a context that is catching up reads a deficit
      // of zero while it still owes seconds of output, and handing the pool
      // back then is what makes the failure oscillate instead of clear.
      this.cap = Math.min(MAX_EMITTERS, this.cap + 4);
    }
    this.stats.cap = this.cap;
  }

  /** Feed the AudioListener from the render camera. Called once per frame. */
  setListener(px, py, pz, fx, fy, fz, ux, uy, uz) {
    const l = this.actx.listener;
    const t = this.actx.currentTime;
    this._lp.x = px; this._lp.y = py; this._lp.z = pz;
    if (l.positionX) {
      // setTargetAtTime rather than a hard set: the doppler-free smoothing kills
      // the zipper noise you otherwise get from a 60 Hz position update.
      l.positionX.setTargetAtTime(px, t, 0.02);
      l.positionY.setTargetAtTime(py, t, 0.02);
      l.positionZ.setTargetAtTime(pz, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.setTargetAtTime(ux, t, 0.05);
      l.upY.setTargetAtTime(uy, t, 0.05);
      l.upZ.setTargetAtTime(uz, t, 0.05);
    } else {
      l.setPosition(px, py, pz);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  get listenerPos() {
    return this._lp;
  }

  distanceTo(x, y, z) {
    const l = this._lp;
    return Math.hypot(x - l.x, y - l.y, z - l.z);
  }

  /**
   * Attenuation curve. Deliberately gentler than 1/r beyond ~40 m: real
   * gunfire at 150 m is still clearly audible, and pure inverse-distance makes
   * a level feel dead. Below 40 m it is very close to physical.
   */
  attenuation(dist) {
    return attenuationAt(dist);
  }

  /**
   * Occlusion test: how much geometry is between the listener and a point.
   * Returns 0 (clear) .. 1 (thick wall). Two rays — ear height and a raised
   * one — so a low crate does not fully mute a source behind it.
   */
  occlusionAt(x, y, z) {
    if (!this.occlusionEnabled) return 0;
    const phys = this.ctx?.peek?.('physics');
    if (!phys?.raycast) return 0;
    const l = this._lp;
    const dx = x - l.x, dy = y - l.y, dz = z - l.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.8) return 0;
    const mask = phys.MASK?.SIGHT ?? undefined;
    let blocked = 0;
    const o = this._occOrigin, dir = this._occDir;
    for (let i = 0; i < 2; i++) {
      const lift = i === 0 ? 0 : 0.55;
      o.x = l.x; o.y = l.y + lift; o.z = l.z;
      dir.x = x - o.x; dir.y = y + lift * 0.5 - o.y; dir.z = z - o.z;
      const len = Math.hypot(dir.x, dir.y, dir.z);
      if (len < 1e-4) continue;
      this.stats.occlusionRays++;
      const hit = phys.raycast(o, dir, len - 0.25, mask);
      if (hit?.hit) {
        // A thin partition muffles less than a bunker wall: use how far past the
        // first hit the ray continued as a crude thickness proxy.
        blocked += hit.distance < len * 0.9 ? 1 : 0.5;
      }
    }
    return clamp(blocked / 2, 0, 1);
  }

  /**
   * Grab an emitter. Returns null when the budget is full and the new sound is
   * less important than everything already playing.
   *
   * opts: { x,y,z, bus, send, priority, endTime, occlusion, dist, atten }
   */
  /**
   * PER-BUS QUOTA. No one bus may hold more than its share of the field.
   *
   * MEASURED in a live 15v15: of 72 emitters, **50 were foley** and only 14 were
   * weapons. The flood is not gunfire — it is footsteps, impacts, casings and
   * bodyfalls from thirty men, and I spent a pass tightening the gunfire budget
   * on the assumption that shots were the problem. They were not.
   *
   * A global pool with a global steal rule cannot express "a firefight must
   * always be audible over the boots", because the boots outnumber the shots
   * three to one and win on sheer arrival rate. A quota can: foley may hold 60%
   * of the field and no more, so 29 slots are always there for weapons, voice
   * and ambience however many people are walking.
   */
  _busCap(bus) {
    /**
     * EVERY bus has a share, not just foley.
     *
     * Capping foley alone was measured and is wrong: it freed the slots and
     * WEAPONS immediately took 42 to 50 of 72 while foley collapsed to 1, so the
     * footsteps went inaudible again and 145 voices started being DROPPED rather
     * than stolen — a dropped voice never plays at all, which is strictly worse.
     * Moving the shortage around is not fixing it.
     *
     * The pool is simply smaller than thirty men need, so the only honest answer
     * is to decide what each category is worth and guarantee it. A firefight
     * needs to be heard over the boots (weapons 45%), the boots need to be heard
     * at all because they are how you find someone (foley 40%), callouts are how
     * you read the fight (voice 12%), and ambience is mostly `tracked` beds that
     * the steal loop already refuses to touch (8%).
     *
     * They sum over 100% on purpose: a bus only cannibalises itself once it is
     * over ITS cap, so an idle category's slots stay available to the others.
     */
    // Shares of the CURRENT cap, not of the pool: when the render thread has
    // taken the field down to its floor, every bus gives up its share of the
    // slots rather than weapons keeping eighteen of twenty-four.
    const n = this.capacity;
    switch (bus) {
      case 'weapons': return Math.floor(n * 0.45);
      case 'foley': return Math.floor(n * 0.4);
      case 'voice': return Math.max(4, Math.floor(n * 0.12));
      case 'ambience': return Math.max(4, Math.floor(n * 0.08));
      default: return n;
    }
  }

  _busLoad(bus) {
    let n = 0;
    for (let i = 0; i < this.emitters.length; i++) {
      const e = this.emitters[i];
      if (!e.free && e.busName === bus) n++;
    }
    return n;
  }

  /**
   * WHAT A BUS IS HOLDING, AND WHAT IT IS ALLOWED TO HOLD.
   *
   * Public because a sound that is BACKGROUND has to be able to ask before it
   * takes a slot. Every quota fight in this file's history came from a layer
   * that asked for a voice unconditionally and let `acquire` sort it out: the
   * pool is finite, so "sort it out" always means somebody else's sound stops.
   * The distant-battle and remote-footstep layers (see `src/audio/battle.js`)
   * check these two numbers first and simply do not play when their bus is
   * already carrying its share — they are density, and density is the one thing
   * that must yield to the fight in front of you.
   */
  busLoad(bus) {
    return this._busLoad(bus);
  }

  busCap(bus) {
    return this._busCap(bus);
  }

  acquire(opts) {
    const now = this.actx.currentTime;
    let em = null;
    /**
     * Over quota, this bus steals from ITSELF rather than from the field. The
     * `em` search below is skipped so the steal path runs, and the steal is
     * restricted to the same bus — a footstep can evict a quieter footstep, but
     * it can no longer evict the shot that is about to kill you.
     */
    const bus = opts.bus ?? 'foley';
    /**
     * OVER THE RENDER CAP, a free emitter is not free — filling it is what put
     * the thread behind in the first place. Take the steal path instead, so the
     * field keeps playing the most important `cap` voices and no more.
     */
    const overCap = this._load() >= this.capacity;
    const overQuota = this._busLoad(bus) >= this._busCap(bus);
    if (!overCap && !overQuota) {
      for (let i = 0; i < this.emitters.length; i++) {
        const e = this.emitters[i];
        if (e.free) { em = e; break; }
      }
    }
    if (!em) {
      // Steal the least important voice that is closest to finishing.
      let worst = null, worstScore = Infinity;
      const pri = opts.priority ?? 0.5;
      for (let i = 0; i < this.emitters.length; i++) {
        const e = this.emitters[i];
        if (e.tracked) continue; // never steal a bed/loop
        /**
         * A FREE EMITTER IS A VALID VICTIM ONLY IF THE FIELD IS ALLOWED TO GROW.
         *
         * This loop has always scanned free emitters too, and under the bus
         * quota that is correct — "cannibalise your own bus" is happy to reuse
         * an idle slot of that bus. Under the RENDER cap it is not: taking a
         * free slot is exactly the growth the cap exists to refuse, and it
         * silently made the cap do nothing at all (MEASURED: 73 acquires in two
         * seconds, 52 of them taking a free emitter, load 21 over a cap of 24).
         */
        if (overCap && e.free) continue;
        // Over quota: only cannibalise your own bus. @see _busCap
        if (overQuota && e.busName !== bus) continue;
        const score = e.priority * 4 + Math.max(0, e.endTime - now);
        if (score < worstScore) { worstScore = score; worst = e; }
      }
      if (!worst || worst.priority > pri + 0.25) {
        this.stats.dropped++;
        return null;
      }
      worst.detach();
      this.stats.stolen++;
      em = worst;
    }

    const t = opts.when ?? now;
    const dist = opts.dist ?? this.distanceTo(opts.x, opts.y, opts.z);
    const occ = opts.occlusion !== undefined ? opts.occlusion : this.occlusionAt(opts.x, opts.y, opts.z);
    const atten = (opts.atten ?? this.attenuation(dist)) * (1 - 0.62 * occ);

    em.free = false;
    em.priority = opts.priority ?? 0.5;
    em.endTime = opts.endTime ?? now + 1;
    em.busName = opts.bus ?? 'foley';
    em.tracked = !!opts.tracked;
    // A tracked slot is leased, not granted. @see Emitter.lease
    em.lease = em.tracked ? nowWall() + (opts.lease ?? 3) : Infinity;
    em.userGain = opts.gain ?? 1;
    /**
     * A LABEL, PURELY SO THE POOL CAN BE AUDITED. `busName` says which quota a
     * slot came out of; it cannot say whether the twelve weapons slots are one
     * man's rifle or the distant-battle layer. Every wrong diagnosis in this
     * file's history ("it must be the gunfire" when 50 of 72 were foley) came
     * from not being able to ask that question of a live match.
     */
    em.kindTag = opts.tag ?? null;
    em.occ = occ;
    em.dist = dist;
    em.startAt = t;
    em.wallEnd = nowWall() + (em.endTime - now) + WALL_SLACK;
    em._setPos(opts.x, opts.y, opts.z, t);

    // Air absorption + occlusion filtering.
    em.airLP.frequency.setValueAtTime(airCutoff(dist), t);
    const occCut = 20000 * Math.pow(0.021, occ); // 1.0 -> ~420 Hz
    em.occLP.frequency.setValueAtTime(clamp(occCut, 300, 20000), t);
    em.occHS.gain.setValueAtTime(-26 * occ, t);
    em.distGain.gain.setValueAtTime(clamp(atten * (opts.gain ?? 1), 0, 4), t);

    this._applySend(em, opts.send ?? 0.25);

    em.connectOut(this.mixer.bus(em.busName), this.mixer.reverbSend);
    return em;
  }

  /**
   * Farther and more occluded => proportionally wetter. Split out of `acquire`
   * because the slot is now claimed BEFORE the voice is synthesised (see
   * `AudioSystem._playAt`), so the voice's own send character arrives one step
   * later, in `hold`. The arithmetic and the schedule time are unchanged.
   */
  _applySend(em, send) {
    const v = send * (0.5 + Math.min(em.dist ?? 0, 90) * 0.022) * (1 + (em.occ ?? 0) * 0.7);
    em.sendGain.gain.setValueAtTime(clamp(v, 0, 3), em.startAt ?? this.actx.currentTime);
  }

  /** Update an in-flight tracked emitter's occlusion/distance (beds, voices). */
  refresh(em) {
    if (em.free) return;
    const t = this.actx.currentTime;
    const p = em.pos;
    const dist = this.distanceTo(p.x, p.y, p.z);
    const occ = this.occlusionAt(p.x, p.y, p.z);
    const atten = this.attenuation(dist) * (1 - 0.62 * occ);
    em.occ = occ;
    em.dist = dist;
    em.airLP.frequency.setTargetAtTime(airCutoff(dist), t, 0.12);
    em.occLP.frequency.setTargetAtTime(clamp(20000 * Math.pow(0.021, occ), 300, 20000), t, 0.12);
    em.occHS.gain.setTargetAtTime(-26 * occ, t, 0.12);
    em.distGain.gain.setTargetAtTime(clamp(atten * (em.userGain ?? 1), 0, 4), t, 0.1);
  }

  /**
   * Hand a voice's top node to an emitter and set its teardown time. `send` is
   * the voice's own send character, applied here because the emitter is claimed
   * before the voice exists.
   */
  hold(em, node, endTime, send) {
    node.connect(em.input);
    em.attached = node;
    em.endTime = endTime;
    em.wallEnd = nowWall() + (endTime - this.actx.currentTime) + WALL_SLACK;
    if (send !== undefined) this._applySend(em, send);
  }

  update(dt) {
    const now = this.actx.currentTime;
    this._trackRender(now);
    const wall = nowWall();
    let active = 0;
    for (let i = 0; i < this.emitters.length; i++) {
      const e = this.emitters[i];
      if (e.free) continue;
      /**
       * TWO DEADLINES, AND THE WALL ONE IS THE BACKSTOP.
       *
       * `endTime` is on the audio clock, which is the correct clock: it is the
       * clock the voice was scheduled against. But it is also the clock that
       * STOPS ADVANCING when the render thread cannot keep up, and that turns
       * an overload into a latch — a 1.2 s voice holds its slot for twelve real
       * seconds at 10 % render speed, the pool stays pinned, every new event
       * steals rather than plays, and the graph never gets smaller. That is why
       * the reported failure never recovered on its own and why going to the
       * pause menu (where nothing new is emitted) fixed it.
       *
       * The wall deadline is the same duration measured on a clock that cannot
       * stall. It never fires while the thread is healthy — the two clocks
       * differ by microseconds — and when the thread is not, it is what lets
       * the field drain and the audio come back.
       */
      if (!e.tracked && (now > e.endTime || wall > e.wallEnd)) {
        if (now <= e.endTime) this.stats.expired++;
        e.detach();
        continue;
      }
      /**
       * AN UNRENEWED LEASE IS A DEAD OWNER. This is the only way a `tracked`
       * emitter can ever be reclaimed, and it runs on the WALL clock for the
       * same reason the deadline above does: the audio clock is the one that
       * stops advancing when the graph is in trouble, and a rule that only fires
       * on a healthy clock is not a rule.
       */
      if (e.tracked && wall > e.lease) {
        this.stats.leaked++;
        e.detach();
        continue;
      }
      active++;
    }
    this.stats.active = active;

    // Re-evaluate one tracked emitter per frame: 40 emitters at 60 fps is a
    // 1.5 Hz refresh worst case, which is plenty for beds and walking NPCs and
    // costs at most two raycasts a frame.
    if (this.emitters.length) {
      for (let n = 0; n < this.emitters.length; n++) {
        this._trackCursor = (this._trackCursor + 1) % this.emitters.length;
        const e = this.emitters[this._trackCursor];
        if (!e.free && e.tracked) {
          this.refresh(e);
          break;
        }
      }
    }
  }

  /**
   * FREE EVERYTHING, NOW. The pool half of "do what the pause menu does".
   *
   * A pause fixes the reported dropout, and one of the things a pause does is
   * stop every subsystem emitting for a few seconds so the field empties on its
   * own. This is that, without the pause and without waiting: it is the only
   * response that is correct whatever pinned the pool — a stalled clock, a
   * governor that never fired, a lifetime that was mis-scheduled, or a bug not
   * yet found.
   *
   * `tracked` slots go too. Their owners re-acquire on their next frame (the
   * tank engine does, see battle.js), and a slot nobody re-acquires was one
   * nobody was using.
   */
  drain() {
    let n = 0;
    for (const e of this.emitters) {
      if (e.free) continue;
      e.detach();
      n++;
    }
    this.stats.drained += n;
    this.stats.active = 0;
    return n;
  }

  dispose() {
    for (const e of this.emitters) e.dispose();
    this.emitters.length = 0;
  }
}
