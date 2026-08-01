/**
 * AUDIO / WATCHDOG — 「音が消えるバグ起きますね 何度でも 音バグは必ず直して」
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A WATCHDOG AND NOT ANOTHER FIX
 * ────────────────────────────────────────────────────────────────────────────
 * The audio going away has now been diagnosed twice and fixed twice, and the
 * player still has it. The last pass found a real fault and measured a real
 * improvement (69.0 s of wall time producing 19.2 s of audio, against 63.7 s
 * producing 63.7 s afterwards) — and wrote down its own blind spot, which is
 * the important part: it was measured in headless Chrome, where the audio
 * context is driven by a NULL SINK and therefore `currentTime` stops advancing
 * the moment the renderer cannot keep up. On real hardware the context is driven
 * by the DEVICE clock, which keeps advancing whether or not the renderer filled
 * the buffer. So the trigger that fix depends on — the audio clock falling
 * behind the wall clock — may simply never fire on the player's machine while he
 * is hearing the fault. A fix that can only be verified in an environment that
 * cannot reproduce the failure is a guess, and this is the third guess.
 *
 * So this file does not add a fourth theory. It does two things:
 *
 *   1. MAKES THE FAULT OBSERVABLE ON HIS MACHINE. `?audiodbg=1` or F9 puts a
 *      live panel on screen with every number that can distinguish the possible
 *      causes from each other — including an ANALYSER ON THE OUTPUT, which is
 *      the one measurement nobody has taken. "Is there signal at the master
 *      gain" splits the whole problem in half: signal present and inaudible is
 *      a device/underrun fault, no signal is a graph fault, and the panel says
 *      which. He reproduces it, reads us the numbers, and the next change is
 *      aimed at a fact.
 *
 *   2. RECOVERS WITHOUT CARING WHY. Pausing and coming back always fixes it —
 *      that is the strongest clue in the report, because a pause is not a
 *      repair, it is a period during which nothing is emitted, every integrator
 *      keeps running and the context gets a resume. Everything in the ladder
 *      below is one of those three things, applied on a timer instead of on the
 *      player's patience.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT REMAINS UNVERIFIABLE HERE
 * ────────────────────────────────────────────────────────────────────────────
 * If the true fault is that the audio thread misses its deadlines while the
 * device clock and the graph both look healthy, the output analyser will read
 * NORMAL while the player hears crackle and dropouts, and NOTHING in this file
 * will fire. That case is real and is not fixed here — it is made visible, which
 * is the honest thing this pass can do. Nobody working on it can hear it.
 */

/** Output RMS under which the master bus is considered to be producing nothing. */
const SILENT_RMS = 2e-6;
/** Seconds of continuous silence before the soft recovery runs. */
const SOFT_AFTER = 1.5;
/** …and before the graph is rebuilt outright. */
const HARD_AFTER = 4.5;
/** Never rebuild more often than this, seconds of wall time. */
const HARD_COOLDOWN = 25;
/** How often the taps are read, seconds of wall time. */
const SAMPLE_EVERY = 0.12;
/** A moveable gain sitting wrong for longer than this is stuck, not ramping. */
const STUCK_AFTER = 1.6;
/** Absolute cap on a sidechain duck, however much gunfire keeps re-arming it. */
const DUCK_MAX_HOLD = 3.0;

const nowWall = () =>
  (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

export class AudioWatchdog {
  /** @param {import('./index.js').AudioSystem} audio */
  constructor(audio) {
    this.audio = audio;
    this.enabled = true;
    this.visible = false;

    this._taps = null;
    this._buf = null;
    this._next = 0;
    this._paint = 0;

    /* ---- what the last sample saw ------------------------------- */
    this.out = { rms: 0, peak: 0 };
    this.world = { rms: 0, peak: 0 };
    this.nonFinite = 0;
    this.silentSince = 0;
    this.silentFor = 0;
    /** currentTime minus the frontier the device is actually playing. */
    this.queued = 0;
    this.drift = 0;
    this._driftMin = Infinity;

    /* ---- stuck-gain timers -------------------------------------- */
    this._muffleLowSince = 0;
    this._duckLowSince = 0;
    this._masterLowSince = 0;

    /* ---- the ladder --------------------------------------------- */
    this.resumeTries = 0;
    this._resumeNext = 0;
    this.softRecoveries = 0;
    this._softNext = 0;
    this.hardRecoveries = 0;
    this._hardNext = 0;
    /** Human-readable, newest first, capped. Shown on the panel and dumped. */
    this.log = [];

    this._el = null;
    this._body = null;
    this._key = null;
  }

  /* ================================================================ */
  /* setup                                                            */
  /* ================================================================ */

  /** Tap the two points that split a graph fault from a mix fault. */
  start() {
    const { actx, mixer } = this.audio;
    if (!actx || !mixer || this._taps) return;
    const mk = (node) => {
      const an = actx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0;
      node.connect(an);
      return an;
    };
    this._taps = {
      // POST everything — the last node before the device. If this is silent the
      // player is hearing nothing, full stop.
      out: mk(mixer.masterGain),
      // PRE the muffle and the master chain. Signal here and silence above means
      // the fault is in the six gains that gameplay is allowed to move.
      world: mk(mixer.worldSum),
    };
    this._buf = new Float32Array(1024);

    if (typeof addEventListener === 'function' && !this._key) {
      this._key = (e) => {
        if (e.code === 'F9') { this.setVisible(!this.visible); e.preventDefault(); }
      };
      addEventListener('keydown', this._key);
    }
    // `?audiodbg=1` so it can be turned on before the fault rather than after.
    try {
      const q = typeof location !== 'undefined' ? location.search : '';
      if (/[?&]audiodbg=1/.test(q)) this.setVisible(true);
    } catch { /* no location in a worker/test host */ }
  }

  /* ================================================================ */
  /* per frame                                                        */
  /* ================================================================ */

  update() {
    const audio = this.audio;
    const actx = audio.actx;
    if (!actx) return;
    const wall = nowWall();

    /**
     * GUARD 1 — A CONTEXT THAT IS NOT RUNNING IS RESUMED.
     *
     * `AudioSystem.update` used to `return` on a suspended context and NOTHING
     * anywhere called `resume()` after boot. That is a state the game could
     * never leave: every recovery integrator in the mixer is stepped from that
     * same update, so a context suspended for any reason (an audio device
     * changing, headphones unplugged, the OS taking audio focus, a policy
     * suspend after a hidden tab) left the game permanently silent AND left
     * every duck and the muffle frozen wherever they were. It costs one
     * comparison a frame to make that survivable.
     */
    if (actx.state !== 'running') {
      if (wall >= this._resumeNext) {
        this._resumeNext = wall + 0.5;
        this.resumeTries++;
        this._say(`context ${actx.state} — resume()`);
        actx.resume?.().catch(() => {});
        // A resume that keeps being refused means the browser wants a gesture.
        // Put the listeners back rather than waiting for one that never comes.
        if (this.resumeTries === 4) audio._armGesture?.();
      }
      return;
    }

    if (wall < this._next) return;
    this._next = wall + SAMPLE_EVERY;
    this._sample(wall);
    this._sanity(wall);
    this._ladder(wall);
    if (this.visible && wall >= this._paint) {
      this._paint = wall + 0.25;
      this._render();
    }
  }

  _sample(wall) {
    const { actx, mixer } = this.audio;
    const buf = this._buf;
    const read = (an, into) => {
      an.getFloatTimeDomainData(buf);
      let peak = 0, sum = 0, bad = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i];
        if (!Number.isFinite(v)) { bad++; continue; }
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
        sum += v * v;
      }
      into.rms = Math.sqrt(sum / buf.length);
      into.peak = peak;
      return bad;
    };
    this.nonFinite = read(this._taps.out, this.out);
    read(this._taps.world, this.world);

    /**
     * THE OUTPUT IS NEVER LEGITIMATELY SILENT. Three ambience beds run
     * continuously from the moment the graph starts and are not routed through
     * the voice pool, so digital silence at the master gain means something
     * upstream of the device has failed — not that nothing is happening.
     */
    const quiet = this.out.rms < SILENT_RMS && mixer.masterVolume > 0.001;
    if (quiet) {
      if (!this.silentSince) this.silentSince = wall;
      this.silentFor = wall - this.silentSince;
    } else {
      this.silentSince = 0;
      this.silentFor = 0;
    }

    /**
     * WHAT THE DEVICE HAS ACTUALLY PLAYED, against what the graph has rendered.
     * `getOutputTimestamp().contextTime` is the frontier the hardware is
     * sounding; `currentTime` is the frontier the renderer has reached. The gap
     * IS the buffer the renderer is ahead by, and it is the one starvation
     * signal that does not depend on a null sink — on real hardware it collapses
     * toward zero when the thread stops keeping up, while the clock-drift
     * measure the pool governor uses stays flat and healthy.
     *
     * It is READ AND REPORTED, not acted on: implementations differ in what they
     * put in `contextTime`, and a governor wired to a number this pass cannot
     * verify on the machine that has the fault is exactly the mistake being
     * unwound here. It is on the panel so the player's own numbers can settle it.
     */
    const ts = actx.getOutputTimestamp?.();
    if (ts && Number.isFinite(ts.contextTime)) {
      this.queued = actx.currentTime - ts.contextTime;
    }
    const lag = wall - actx.currentTime;
    if (lag < this._driftMin) this._driftMin = lag;
    this.drift = lag - this._driftMin;
  }

  /* ================================================================ */
  /* the stuck-gain guards                                            */
  /* ================================================================ */

  /**
   * GUARD 2 — EVERY GAIN GAMEPLAY CAN PUSH DOWN IS CHECKED AGAINST ITS NOMINAL.
   *
   * Six of them move: three bus ducks, the muffle level, its low-pass and its
   * shelf. All six are restored by integrators that live in `Mixer.update`, i.e.
   * on the main thread, i.e. exactly where a stall or an early return can stop
   * them. The check is deliberately dumb — it compares the LIVE parameter value
   * against what the mixer believes the state is, and if a gain has been low for
   * longer than any legitimate ramp while the state says it should be up, it is
   * set (not ramped) back.
   *
   * This is the guard for "a gain that can reach zero must have a recovery that
   * cannot be multiplied by zero". Nothing here reasons about what pushed it
   * down; it only asserts that a mixer which believes it is at rest IS at rest.
   */
  _sanity(wall) {
    const m = this.audio.mixer;
    const t = this.audio.actx.currentTime;

    // The muffle, when the concussion is over.
    if (m.deafness <= 0.001 && m.muffleGain.gain.value < 0.9) {
      if (!this._muffleLowSince) this._muffleLowSince = wall;
      if (wall - this._muffleLowSince > STUCK_AFTER) {
        this._muffleLowSince = 0;
        this._say(`muffle stuck at ${m.muffleGain.gain.value.toFixed(3)} — reset`);
        m.muffleGain.gain.cancelScheduledValues(t);
        m.muffleGain.gain.setValueAtTime(1, t);
        m.muffleLP.frequency.cancelScheduledValues(t);
        m.muffleLP.frequency.setValueAtTime(20000, t);
        m.muffleHS.gain.cancelScheduledValues(t);
        m.muffleHS.gain.setValueAtTime(0, t);
      }
    } else {
      this._muffleLowSince = 0;
    }

    /**
     * The ducks. `Mixer.duck` re-arms the hold on EVERY louder shot, so
     * continuous fire can hold `ambience`, `foley` and `voice` down at up to
     * -92 % indefinitely — which is not silence but is three of the five buses
     * gone, and it is indistinguishable from the reported fault if it happens
     * during a firefight. Nothing may hold a sidechain open for three seconds.
     */
    let ducked = false;
    for (const name in m.buses) {
      const b = m.buses[name];
      if (b.duckAmount > 0.02 || b.duck.gain.value < 0.9) ducked = true;
    }
    if (ducked) {
      if (!this._duckLowSince) this._duckLowSince = wall;
      if (wall - this._duckLowSince > DUCK_MAX_HOLD) {
        this._duckLowSince = 0;
        this._say('sidechain held open too long — releasing');
        for (const name in m.buses) {
          const b = m.buses[name];
          b.duckAmount = 0; b.duckHold = 0;
          b.duck.gain.cancelScheduledValues(t);
          b.duck.gain.setValueAtTime(1, t);
        }
      }
    } else {
      this._duckLowSince = 0;
    }

    // The master and pre gains. Nothing in gameplay writes these at all, so a
    // wrong value here is a bug or a stray write, and either way it is silence.
    const wantMaster = m.masterVolume;
    if (wantMaster > 0.001 && m.masterGain.gain.value < wantMaster * 0.5) {
      if (!this._masterLowSince) this._masterLowSince = wall;
      if (wall - this._masterLowSince > STUCK_AFTER) {
        this._masterLowSince = 0;
        this._say(`master gain ${m.masterGain.gain.value.toFixed(3)} — reset`);
        m.masterGain.gain.cancelScheduledValues(t);
        m.masterGain.gain.setValueAtTime(wantMaster, t);
        m.preGain.gain.cancelScheduledValues(t);
        m.preGain.gain.setValueAtTime(m.basePreGain, t);
      }
    } else {
      this._masterLowSince = 0;
    }
  }

  /* ================================================================ */
  /* the recovery ladder                                              */
  /* ================================================================ */

  _ladder(wall) {
    if (!this.enabled) return;

    /**
     * GUARD 3 — NON-FINITE SAMPLES ARE UNRECOVERABLE IN PLACE.
     *
     * One NaN entering a DynamicsCompressor or a WaveShaper poisons that node's
     * internal state for good: every sample after it is NaN, the device plays
     * silence, and no gain change anywhere will bring it back. It is the classic
     * shape of "all the sound died at once and stayed dead", it cannot be
     * cleared by draining the pool, and — unlike every other cause — the browser
     * reports nothing at all. Rebuilding the graph is the only cure, so this
     * skips straight to it.
     */
    if (this.nonFinite > 0) {
      this._hard(wall, `non-finite samples at the output (${this.nonFinite})`);
      return;
    }

    if (this.silentFor >= HARD_AFTER) {
      this._hard(wall, `output silent for ${this.silentFor.toFixed(1)}s`);
      return;
    }
    if (this.silentFor >= SOFT_AFTER) this._soft(wall);
  }

  /**
   * GUARD 4 — THE SOFT RECOVERY IS "WHAT PAUSING DOES", WITHOUT THE PAUSE.
   *
   * Three things happen while the player sits in the menu and they are the three
   * things that make the sound come back:
   *   - the context gets to be running,
   *   - nothing new is emitted, so the voice pool drains,
   *   - the recovery integrators keep stepping, so ducks and the muffle release.
   * So: resume, drain, reset. It is a dozen parameter writes and a walk of 72
   * emitters, it is inaudible when nothing is wrong (the pool refills from the
   * next frame's events), and it does not need to know what went wrong.
   */
  _soft(wall) {
    if (wall < this._softNext) return;
    this._softNext = wall + 2;
    this.softRecoveries++;
    const audio = this.audio;
    this._say(`soft recovery #${this.softRecoveries} (silent ${this.silentFor.toFixed(1)}s)`);
    try { audio.actx.resume?.().catch(() => {}); } catch { /* not resumable */ }
    audio.mixer.resetDynamics();
    audio.field.drain();
    audio.drainDry();
    audio.clearRateGates();
  }

  /**
   * GUARD 5 — THE HARD RECOVERY REBUILDS THE GRAPH.
   *
   * The last resort, and the only answer to a poisoned node, a context the
   * browser will not resume, or a fault nobody has identified yet. It costs the
   * IR render (~15 ms) and a few hundred milliseconds of the beds fading back
   * in — against a game that is currently making no sound at all, which is the
   * only situation it runs in.
   */
  _hard(wall, why) {
    if (wall < this._hardNext) { this._soft(wall); return; }
    this._hardNext = wall + HARD_COOLDOWN;
    this.hardRecoveries++;
    this._say(`HARD recovery #${this.hardRecoveries}: ${why}`);
    this.silentSince = 0;
    this.silentFor = 0;
    this.nonFinite = 0;
    this.audio._restartGraph();
  }

  _say(msg) {
    const line = `${new Date().toLocaleTimeString()} ${msg}`;
    this.log.unshift(line);
    if (this.log.length > 12) this.log.length = 12;
    console.warn('[audio/watchdog]', msg);
  }

  /* ================================================================ */
  /* the numbers                                                      */
  /* ================================================================ */

  /**
   * Everything needed to tell the possible causes apart, in one object. This is
   * what the player is asked to read out — `__AUDIO__.diagnose()` in the console
   * copies the same thing the panel is showing.
   */
  snapshot() {
    const a = this.audio;
    const m = a.mixer;
    const f = a.field;
    const bus = {};
    let tracked = 0;
    if (f) {
      for (const em of f.emitters) {
        if (em.free) continue;
        bus[em.busName] = (bus[em.busName] ?? 0) + 1;
        if (em.tracked) tracked++;
      }
    }
    return {
      state: a.actx?.state ?? 'none',
      sampleRate: a.actx?.sampleRate ?? 0,
      baseLatency: +(a.actx?.baseLatency ?? 0).toFixed(4),
      outputLatency: +(a.actx?.outputLatency ?? 0).toFixed(4),
      currentTime: +(a.actx?.currentTime ?? 0).toFixed(2),
      wall: +nowWall().toFixed(2),
      clockDrift: +this.drift.toFixed(3),
      queuedAhead: +this.queued.toFixed(4),
      outRms: +this.out.rms.toFixed(7),
      outPeak: +this.out.peak.toFixed(5),
      worldRms: +this.world.rms.toFixed(7),
      nonFinite: this.nonFinite,
      silentFor: +this.silentFor.toFixed(2),
      voices: f?.stats.active ?? 0,
      cap: f?.stats.cap ?? 0,
      bus,
      tracked,
      stolen: f?.stats.stolen ?? 0,
      dropped: f?.stats.dropped ?? 0,
      expired: f?.stats.expired ?? 0,
      leaked: f?.stats.leaked ?? 0,
      drained: f?.stats.drained ?? 0,
      renderDeficit: +(f?.stats.deficit ?? 0).toFixed(3),
      renderBehind: +(f?.stats.behind ?? 0).toFixed(3),
      master: +(m?.masterGain.gain.value ?? 0).toFixed(4),
      pre: +(m?.preGain.gain.value ?? 0).toFixed(4),
      muffle: +(m?.muffleGain.gain.value ?? 0).toFixed(4),
      muffleHz: Math.round(m?.muffleLP.frequency.value ?? 0),
      deafness: +(m?.deafness ?? 0).toFixed(3),
      duck: m
        ? Object.fromEntries(Object.keys(m.buses).map((k) => [k, +m.buses[k].duck.gain.value.toFixed(3)]))
        : {},
      reduction: +(m?.reduction ?? 0).toFixed(2),
      dryHeld: a._dry ? a._dry.reduce((n, d) => n + (d.node ? 1 : 0), 0) : 0,
      events: a.stats.events,
      errors: a.stats.errors,
      resumeTries: this.resumeTries,
      soft: this.softRecoveries,
      hard: this.hardRecoveries,
      log: this.log.slice(0, 5),
    };
  }

  /* ================================================================ */
  /* the panel                                                        */
  /* ================================================================ */

  setVisible(v) {
    this.visible = !!v;
    if (!this.visible) {
      if (this._el) this._el.style.display = 'none';
      return;
    }
    this._build();
    if (this._el) this._el.style.display = 'block';
    this._paint = 0;
  }

  _build() {
    if (this._el || typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.id = 'ow-audiodbg';
    // Inline styles only: `src/ui` owns the stylesheet and this must not need a
    // line in it. Pointer events off so it can never eat a click.
    el.style.cssText = [
      'position:fixed', 'top:8px', 'right:8px', 'z-index:2147483000',
      'font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#cfe8ff', 'background:rgba(6,10,16,0.82)', 'border:1px solid rgba(90,140,190,0.5)',
      'border-radius:5px', 'padding:7px 9px', 'white-space:pre', 'pointer-events:none',
      'max-width:44ch', 'text-shadow:0 1px 2px #000',
    ].join(';');
    const body = document.createElement('div');
    el.appendChild(body);
    document.body.appendChild(el);
    this._el = el;
    this._body = body;
  }

  _render() {
    if (!this._body) return;
    const s = this.snapshot();
    const bad = (c, v) => (c ? `` : '') + v; // placeholder, colour below
    void bad;
    const pad = (v, n) => String(v).padStart(n);
    const busLine = ['weapons', 'foley', 'voice', 'ambience']
      .map((b) => `${b[0]}${pad(s.bus[b] ?? 0, 2)}`).join(' ');
    const alarm = s.silentFor > 0.5 || s.nonFinite > 0 || s.state !== 'running';
    this._el.style.borderColor = alarm ? 'rgba(255,90,90,0.9)' : 'rgba(90,140,190,0.5)';
    this._body.textContent =
      `AUDIO  ${s.state}  ${(s.sampleRate / 1000).toFixed(1)}kHz  F9 to hide\n` +
      `out  rms ${s.outRms.toExponential(2)}  pk ${s.outPeak.toFixed(4)}${s.nonFinite ? `  NaN ${s.nonFinite}` : ''}\n` +
      `world rms ${s.worldRms.toExponential(2)}   silent ${s.silentFor.toFixed(1)}s\n` +
      `clock drift ${s.clockDrift.toFixed(3)}s  queued ${s.queuedAhead.toFixed(3)}s\n` +
      `        latency base ${s.baseLatency} out ${s.outputLatency}\n` +
      `voices ${pad(s.voices, 2)}/${s.cap}  ${busLine}  trk ${s.tracked}\n` +
      `stolen ${s.stolen}  dropped ${s.dropped}  expired ${s.expired}\n` +
      `leased-out ${s.leaked}  drained ${s.drained}  dry ${s.dryHeld}\n` +
      `master ${s.master}  pre ${s.pre}  muffle ${s.muffle} @${s.muffleHz}Hz\n` +
      `deaf ${s.deafness}  comp ${s.reduction}dB  duck a${s.duck.ambience} f${s.duck.foley} w${s.duck.weapons}\n` +
      `events ${s.events}  errors ${s.errors}  resume ${s.resumeTries}  soft ${s.soft}  hard ${s.hard}\n` +
      (s.log.length ? `\n${s.log.join('\n')}` : '');
  }

  dispose() {
    if (this._key && typeof removeEventListener === 'function') {
      removeEventListener('keydown', this._key);
    }
    this._key = null;
    if (this._el?.parentNode) this._el.parentNode.removeChild(this._el);
    this._el = null;
    this._body = null;
    if (this._taps) {
      for (const k in this._taps) { try { this._taps[k].disconnect(); } catch { /* gone */ } }
      this._taps = null;
    }
  }
}
