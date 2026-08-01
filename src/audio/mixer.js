/**
 * AUDIO / MIXER
 *
 * The signal path, top down:
 *
 *   voices ──► bus (weapons | foley | ambience | voice | ui)
 *                │           each bus: trim ──► bus compressor
 *                ▼
 *   ┌── worldSum ─► muffleLP ─► muffleGain ──┐        (deafening / concussion)
 *   │      ▲                                 │
 *   │   reverb returns                       ▼
 *   │      ▲                              masterSum ─► masterComp ─► softClip ─► out
 *   │   convolver x5 (space blend)           ▲
 *   │      ▲                                 │
 *   └── reverbSend ◄─ per-voice send    ui bus + tinnitus (bypass the muffle,
 *                                        so HUD and the ring stay audible)
 *
 * Ducking is a manual sidechain: gunfire pushes `ambience`/`foley` down with a
 * fast setTargetAtTime and lets them float back over ~400 ms. That is exactly
 * what a real game mix does, and it is far more predictable than trying to make
 * a DynamicsCompressor listen to another bus.
 */

import { biquad, gain, limiterCurve, shaper, clamp, osc } from './dsp.js';
import { IR_SPECS, generateIR } from './ir.js';

/**
 * BUS BALANCE.
 *
 * Retuned for a competitive round-based mode rather than for atmosphere. In a
 * demolition round with no respawn, the sounds that carry INFORMATION — a
 * footstep on the floor above, a rifle two rooms over, a team-mate calling a
 * contact — are the ones you play off. Ambience is the bed they sit on, and it
 * was mixed loud enough to sit on top of them instead.
 *
 * Deltas from the values this repo shipped with, in dB:
 *
 *   ambience   0.50 -> 0.20   -8.0 dB   the bed drops right back
 *   foley      0.90 -> 1.20   +2.5 dB   footsteps, impacts, brass, bodyfall
 *   voice      0.85 -> 1.15   +2.6 dB   call-outs and grunts
 *   weapons    0.95 -> 1.10   +1.3 dB   gunfire and explosions
 *   ui         1.60 -> 1.30   -1.8 dB   it was the loudest thing in the game
 *
 * Footsteps therefore sit 10.5 dB further above the ambience than they did.
 *
 * THIS IS A MIX DECISION AND I CANNOT HEAR IT. The numbers are chosen from the
 * roles above, not from listening, so they are a starting point: every one is
 * live-tunable without a reload via `audio.setBusVolume('ambience', 0.3)` etc.
 * If the bed now feels too thin, that is the knob.
 */
const BUS_DEFS = {
  /**
   * WEAPONS AND FOLEY TRIMS RAISED to pay for the wet trim.
   *
   * `reverbReturn` went 0.9 -> 0.42 and the measured consequence was not just
   * drier, it was QUIETER: a concrete footstep's peak fell 0.097 -> 0.045, i.e.
   * -6.7 dB, and a concrete impact 0.128 -> 0.060. The reverb had been carrying
   * roughly half the level of every near-field sound, which is itself the
   * clearest evidence the complaint was right.
   *
   * Losing that level is not acceptable here: footsteps were reported as
   * MISSING before, so a fix that makes them drier by making them half as loud
   * trades one complaint for the other. +4.4 dB on foley and +3.3 dB on weapons
   * restores the level with dry signal instead of tail.
   *
   * `ambience` is deliberately NOT compensated — "環境音、風切り音みたいなのもっと
   * 小さくしろ" asked for it quieter, so it keeps both the wet cut and the
   * level cut.
   */
  /**
   * FOLEY 2.0 -> 2.25 AND VOICE 1.15 -> 1.30, for the third `reverbReturn` cut.
   *
   * Same argument as the block above, third time round, and measured the same
   * way. Taking the return 0.24 -> 0.15 cost the near-field foley 1.3 dB of RMS
   * (`step:concrete` 0.00227 -> 0.00196) and the barks 0.6 dB (`bark:contact`
   * 0.00705 -> 0.00661), because a fraction of every one of those sounds was
   * still arriving via the convolvers. +1.0 dB and +1.1 dB of DRY trim put them
   * back where they were.
   *
   * The weapons bus is deliberately NOT compensated: `weaponShot`'s new slap-back
   * layer already replaced the level the send was carrying (`shot:rifle@2m` peak
   * 0.0831 and rms 0.00365 against 0.0831 and 0.00367 before), so raising the bus
   * as well would just make the guns louder than the reference they set. The
   * explosion voice pays its own way in `foley.js` for the same reason.
   *
   * `ambience` stays uncompensated for the third time — 「環境音…もっと小さくしろ」.
   */
  weapons:  { trim: 1.6, comp: { threshold: -7, knee: 8, ratio: 2.6, attack: 0.003, release: 0.16 } },
  foley:    { trim: 2.25, comp: { threshold: -14, knee: 10, ratio: 2.0, attack: 0.004, release: 0.2 } },
  ambience: { trim: 0.2,  comp: { threshold: -24, knee: 12, ratio: 2.0, attack: 0.05, release: 0.5 } },
  voice:    { trim: 1.3, comp: { threshold: -18, knee: 8, ratio: 3.0, attack: 0.006, release: 0.22 } },
  ui:       { trim: 1.3,  comp: null },
};

export class Mixer {
  /**
   * @param {BaseAudioContext} actx
   * @param {import('../core/rng.js').Rng} rng
   */
  constructor(actx, rng, opts = {}) {
    this.actx = actx;
    this.rng = rng;
    // Headroom matters more than loudness: at 0.62 a single gunshot peaks near
    // -3 dBFS and the limiter is only reached by dense combat, so the mix keeps
    // its dynamic range instead of being flattened.
    this.masterVolume = opts.masterVolume ?? 0.95;

    /* ---- master chain (built first, everything hangs off it) ------ */
    this.masterSum = gain(actx, 1);
    // Headroom stage. It sits BEFORE the compressor/clipper on purpose: a
    // post-limiter volume control only scales an already-squashed signal, and
    // that is what destroys the difference between a footstep and a gunshot.
    this.preGain = gain(actx, 0.22);
    this.masterComp = actx.createDynamicsCompressor();
    // Safety net only: a single gunshot should barely touch it, a firefight
    // plus a grenade should be held together by it.
    this.masterComp.threshold.value = -2;
    this.masterComp.knee.value = 3;
    this.masterComp.ratio.value = 4;
    this.masterComp.attack.value = 0.0035;
    this.masterComp.release.value = 0.14;
    this.softClip = shaper(actx, limiterCurve(), '4x');
    this.masterGain = gain(actx, this.masterVolume);

    this.masterSum.connect(this.preGain);
    this.preGain.connect(this.masterComp);
    this.masterComp.connect(this.softClip);
    this.softClip.connect(this.masterGain);
    this.masterGain.connect(actx.destination);

    /* ---- concussion / deafening path ----------------------------- */
    // Everything diegetic runs through this so a nearby explosion can muffle
    // the whole world without touching the HUD or the tinnitus tone.
    this.worldSum = gain(actx, 1);
    this.muffleLP = biquad(actx, 'lowpass', 20000, 0.5);
    this.muffleHS = biquad(actx, 'highshelf', 3500, 0.7, 0);
    this.muffleGain = gain(actx, 1);
    this.worldSum.connect(this.muffleLP);
    this.muffleLP.connect(this.muffleHS);
    this.muffleHS.connect(this.muffleGain);
    this.muffleGain.connect(this.masterSum);

    /* ---- buses ---------------------------------------------------- */
    this.buses = {};
    for (const name in BUS_DEFS) {
      const def = BUS_DEFS[name];
      const input = gain(actx, 1);        // voices connect here
      const duck = gain(actx, 1);         // sidechain victim
      const trim = gain(actx, def.trim);  // static balance
      input.connect(duck);
      duck.connect(trim);
      let tail = trim;
      let comp = null;
      if (def.comp) {
        comp = actx.createDynamicsCompressor();
        comp.threshold.value = def.comp.threshold;
        comp.knee.value = def.comp.knee;
        comp.ratio.value = def.comp.ratio;
        comp.attack.value = def.comp.attack;
        comp.release.value = def.comp.release;
        trim.connect(comp);
        tail = comp;
      }
      // ui bypasses the muffle: menu clicks must survive a grenade.
      tail.connect(name === 'ui' ? this.masterSum : this.worldSum);
      this.buses[name] = { input, duck, trim, comp, baseTrim: def.trim, duckAmount: 0 };
    }

    /* ---- reverb ---------------------------------------------------- */
    // One send bus fanning into five convolvers; the space probe crossfades
    // between them. Sharing the send keeps the cost fixed no matter how many
    // voices are alive.
    this.reverbSend = gain(actx, 1);
    // Pre-send shaping: no sub into the convolvers (muddy) and no fizz above
    // 9 kHz (real rooms do not reflect that back at you from 30 m away).
    this.sendHP = biquad(actx, 'highpass', 170, 0.7);
    this.sendLP = biquad(actx, 'lowpass', 9000, 0.7);
    this.reverbSend.connect(this.sendHP);
    this.sendHP.connect(this.sendLP);

    this.spaces = {};
    this.spaceNames = Object.keys(IR_SPECS);
    /**
     * 0.42, down from 0.9. THE GLOBAL WET TRIM.
     *
     * A previous pass cut the reverb send on the WEAPON profiles (0.4-0.72 down
     * to 0.06-0.24) and that was correct and measured — wet, all seven guns
     * decayed within 1.3:1 of each other where dry they span 4.3:1, so the
     * reverb really was flattening them into one sound. But it only touched the
     * guns. Everything else kept sending hard into the same bus: ambience beds
     * at 0.6-1.2, foley up to 0.85. Hence "まだ全ての効果音にリバーブかかりすぎ"
     * — still too much reverb on ALL the sound effects, which is a different
     * complaint from the first one and a fair one.
     *
     * This is the one gain every wet path passes through, so it is the honest
     * place to take the rest out of, rather than editing forty call sites and
     * missing some. The per-voice sends below stay as CHARACTER — a blast is
     * still wetter than a magazine catch — they are just all quieter now.
     */
    /**
     * 0.15 — a THIRD cut, and this one comes with the tails moved into the
     * sources so that "drier" does not have to mean "smaller".
     *
     * 「今のリバーブの強い効果音系はリバーブはなるべく無くして、爆撃音など」. The two cuts
     * above went 0.9 -> 0.42 -> 0.24 and were still reported as too wet, and the
     * measurement that explains it is not in this file: rendered offline through
     * this exact graph, 83 % of a rifle shot's decay to -20 dB was the convolvers
     * (d20 0.36 s wet, 0.06 s dry) and 53 % of an airstrike blast's total energy
     * was (rms 0.0699 wet, 0.0330 dry). Turning the return down alone had always
     * traded the complaint for a thinner, shorter game, which is why it kept
     * coming back up in the bus trims.
     *
     * This pass takes it down AND pays it back in the synthesis, in the same
     * commit, so the trims do not have to move:
     *   - `weaponShot` layer 8: three discrete slap-backs off the facades,
     *     carrying the weapon's own timbre. The gun's near field is now the gun's.
     *   - `explosion`: a 1.1-4.5 s synthesised roll plus two or three discrete
     *     returns, and its send closed from 0.85-1.35 to 0.26-0.56.
     *   - `strikeTail`: 7.6 s, two beating subs, three darkening reports.
     *
     * What is left going into the convolvers is what a convolver is good for —
     * the rest of the level answering, late and diffuse — at 1/6 of the level it
     * started at.
     */
    this.reverbReturn = gain(actx, 0.09);
    this.reverbReturn.connect(this.worldSum);
    this._irReady = false;

    this.spaceWeights = { tight: 0, room: 0, street: 0.35, tunnel: 0, open: 0.65 };

    /* ---- tinnitus (built on demand, torn down when silent) -------- */
    this._tin = null;
    this.deafness = 0; // 0..1, public: UI/render may read this

    /** Wall clock for the recovery integrators. @see update */
    this._wallPrev = 0;
  }

  /**
   * Render the impulse responses. Split out from the constructor because it is
   * the single most expensive thing this subsystem does (~15 ms for all five)
   * and we only want to pay it once audio is actually going to be heard.
   */
  buildReverbs() {
    if (this._irReady) return;
    const actx = this.actx;
    for (const name of this.spaceNames) {
      const conv = actx.createConvolver();
      conv.normalize = false;
      try {
        conv.buffer = generateIR(actx, this.rng.fork(), IR_SPECS[name]);
      } catch (err) {
        console.warn('[audio] IR generation failed for', name, err);
        continue;
      }
      const g = gain(actx, this.spaceWeights[name] ?? 0);
      const live = (this.spaceWeights[name] ?? 0) > 0.012;
      if (live) this.sendLP.connect(conv);
      conv.connect(g);
      g.connect(this.reverbReturn);
      this.spaces[name] = { conv, gain: g, live };
    }
    this._irReady = true;
  }

  /**
   * Blend weights from the space probe. Ramped so doorways do not click.
   *
   * Convolvers whose weight has fallen to nothing are unplugged from the send:
   * a 2.8 s stereo convolution is the most expensive node in the graph and
   * there is no reason to compute three of them into a zero gain. Typically two
   * of the five are live at any moment.
   */
  setSpace(weights, smooth = 0.35) {
    const t = this.actx.currentTime;
    for (const name of this.spaceNames) {
      const w = clamp(weights[name] ?? 0, 0, 1);
      this.spaceWeights[name] = w;
      const s = this.spaces[name];
      if (!s) continue;
      s.gain.gain.setTargetAtTime(w, t, smooth);
      const want = w > 0.012;
      if (want === s.live) continue;
      if (want) {
        this.sendLP.connect(s.conv);
      } else {
        // Its gain is already ~0, so cutting the input is inaudible.
        try { this.sendLP.disconnect(s.conv); } catch { /* not connected */ }
      }
      s.live = want;
    }
  }

  /** Bus input node a voice should connect to. */
  bus(name) {
    return (this.buses[name] ?? this.buses.foley).input;
  }

  /**
   * Sidechain duck. `amount` 0..1 of gain reduction, `hold` seconds before it
   * starts floating back. Called on every gunshot and explosion.
   */
  duck(amount, hold = 0.12) {
    const t = this.actx.currentTime;
    const apply = (name, scale) => {
      const b = this.buses[name];
      if (!b) return;
      const a = clamp(amount * scale, 0, 0.92);
      if (a <= b.duckAmount + 0.01) return; // an existing deeper duck wins
      b.duckAmount = a;
      b.duckHold = hold;
      b.duck.gain.cancelScheduledValues(t);
      b.duck.gain.setTargetAtTime(1 - a, t, 0.012);
    };
    apply('ambience', 1);
    apply('foley', 0.55);
    apply('voice', 0.4);
  }

  /**
   * Temporary hearing damage. `level` 0..1. Muffles the world, dips its level
   * and starts a tinnitus tone that outlives the muffling.
   */
  concuss(level) {
    /**
     * CAPPED AT 0.62, AND IT IS THE "音が消える" BUG.
     *
     * At 1.0 this sets the world low-pass to 480 Hz and drops its level 55% —
     * near-total deafness — and recovery is `dt * (0.1 + deafness * 0.22)`,
     * which integrates to about FOURTEEN SECONDS from 1.0. Worse, the guard
     * below re-arms it: any louder blast resets it to full.
     *
     * That was survivable when the only big blast was the C4 ending a round.
     * It is not survivable now: airstrikes, bomber sticks, strafing runs and
     * salvos fire every ~30 s and are deliberately AIMED at the player (the air
     * events weight the player's eye as four men when choosing a target), and
     * `_onExplosion` concusses out to `radius * 1.3` — 19.5 m for a 15 m
     * airstrike. So the player gets re-deafened before recovering and stays
     * muffled indefinitely. Reported as "音が途中で消えるバグ … なんの条件で音が
     * 消えるのかわからない", and the reason the condition is invisible is that the
     * trigger is a blast that may be twenty metres away behind a building.
     *
     * 0.62 keeps the effect — 1.4 kHz and -34% is unmistakably a concussion —
     * without ever silencing the game, and the recovery rate below is raised so
     * a single hit clears in about four seconds rather than fourteen.
     */
    level = clamp(level, 0, 0.62);
    if (level <= this.deafness) return;
    this.deafness = level;
    const t = this.actx.currentTime;
    const cutoff = 20000 * Math.pow(0.024, level); // 1.0 -> ~480 Hz
    this.muffleLP.frequency.cancelScheduledValues(t);
    this.muffleLP.frequency.setTargetAtTime(clamp(cutoff, 320, 20000), t, 0.02);
    this.muffleHS.gain.setTargetAtTime(-22 * level, t, 0.02);
    this.muffleGain.gain.setTargetAtTime(1 - 0.55 * level, t, 0.02);
    this._startTinnitus(level);
  }

  _startTinnitus(level) {
    const actx = this.actx;
    const t = actx.currentTime;
    if (this._tin) {
      // Re-trigger: just push the envelope back up.
      this._tin.g.gain.cancelScheduledValues(t);
      this._tin.g.gain.setTargetAtTime(0.05 * level, t, 0.03);
      this._tin.until = t + 4 + 7 * level;
      return;
    }
    const g = gain(actx, 0);
    // Two close tones plus a third an octave up: a single sine reads as a test
    // tone, three beating partials read as ringing ears.
    const o1 = osc(actx, 'sine', 3980);
    const o2 = osc(actx, 'sine', 4130);
    const o3 = osc(actx, 'sine', 7420);
    const g1 = gain(actx, 0.6), g2 = gain(actx, 0.45), g3 = gain(actx, 0.18);
    o1.connect(g1); o2.connect(g2); o3.connect(g3);
    g1.connect(g); g2.connect(g); g3.connect(g);
    // Slow wobble so it never sounds like a stuck oscillator.
    const lfo = osc(actx, 'sine', 0.23);
    const lfoG = gain(actx, 26);
    lfo.connect(lfoG);
    lfoG.connect(o2.frequency);
    g.connect(this.masterSum); // post-muffle on purpose
    o1.start(t); o2.start(t); o3.start(t); lfo.start(t);
    g.gain.setTargetAtTime(0.05 * level, t, 0.03);
    this._tin = { g, nodes: [o1, o2, o3, lfo, g1, g2, g3, lfoG], until: t + 4 + 7 * level };
  }

  /** Per-frame housekeeping: duck recovery, deafening recovery, tinnitus teardown. */
  update(dt) {
    const t = this.actx.currentTime;

    /**
     * RECOVERY RUNS ON THE WALL CLOCK, NOT ON `dt`.
     *
     * Every gain in this file that is pushed DOWN — the three ducked buses and
     * the muffle — is brought back by an integrator, and an integrator whose
     * step can be zero has no guarantee of ever finishing. `dt` is
     * `time.dt`, i.e. the SCALED game clock, and it is exactly zero whenever
     * `time.scale` is (the pause menu sets it, and anything else may). A blast
     * that ducks the world to 8 % and deafens it 0.4 s before a pause therefore
     * holds it there for as long as the pause lasts, and if anything ever
     * leaves the scale at zero it holds it there for good.
     *
     * Hearing coming back is physiology and a sidechain releasing is a circuit;
     * neither of them cares what the simulation's time scale is. So the step is
     * real seconds, clamped so a stalled tab or a breakpoint releases smoothly
     * rather than jumping. The rates below are unchanged, and at scale 1 this
     * is the same number `dt` was.
     */
    const wall = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const rdt = this._wallPrev ? clamp(wall - this._wallPrev, 0, 0.25) : clamp(dt, 0, 0.25);
    this._wallPrev = wall;

    for (const name in this.buses) {
      const b = this.buses[name];
      if (b.duckAmount <= 0) continue;
      if (b.duckHold > 0) {
        b.duckHold -= rdt;
        continue;
      }
      b.duckAmount = Math.max(0, b.duckAmount - rdt * 2.6);
      b.duck.gain.setTargetAtTime(1 - b.duckAmount, t, 0.09);
      if (b.duckAmount < 0.01) {
        b.duckAmount = 0;
        b.duck.gain.setTargetAtTime(1, t, 0.09);
      }
    }

    if (this.deafness > 0) {
      // Recovery is slow at first then quick — matches how temporary threshold
      // shift actually behaves, and it feels dramatic.
      // 0.32 + 0.35x, up from 0.1 + 0.22x: a full hit clears in ~4 s instead of
      // ~14, which is what stops repeated air events stacking into silence.
      this.deafness = Math.max(0, this.deafness - rdt * (0.32 + this.deafness * 0.35));
      const cutoff = 20000 * Math.pow(0.024, this.deafness);
      this.muffleLP.frequency.setTargetAtTime(clamp(cutoff, 320, 20000), t, 0.25);
      this.muffleHS.gain.setTargetAtTime(-22 * this.deafness, t, 0.25);
      this.muffleGain.gain.setTargetAtTime(1 - 0.55 * this.deafness, t, 0.25);
    }

    if (this._tin) {
      if (t > this._tin.until - 3.5) this._tin.g.gain.setTargetAtTime(0, t, 1.1);
      if (t > this._tin.until) {
        for (const n of this._tin.nodes) {
          try { n.stop?.(t); } catch { /* already stopped */ }
          n.disconnect();
        }
        this._tin.g.disconnect();
        this._tin = null;
      }
    }
  }

  setMasterVolume(v) {
    this.masterVolume = clamp(v, 0, 1);
    this.masterGain.gain.setTargetAtTime(this.masterVolume, this.actx.currentTime, 0.03);
  }

  setBusVolume(name, v) {
    const b = this.buses[name];
    if (!b) return;
    b.trim.gain.setTargetAtTime(clamp(v, 0, 2) * b.baseTrim, this.actx.currentTime, 0.05);
  }

  /** Rough gain-reduction readout, handy for the debug overlay. */
  get reduction() {
    return this.masterComp.reduction ?? 0;
  }

  dispose() {
    if (this._tin) {
      for (const n of this._tin.nodes) {
        try { n.stop?.(); } catch { /* noop */ }
        n.disconnect();
      }
      this._tin.g.disconnect();
      this._tin = null;
    }
    for (const name in this.spaces) {
      this.spaces[name].conv.disconnect();
      this.spaces[name].conv.buffer = null;
      this.spaces[name].gain.disconnect();
    }
    this.spaces = {};
    for (const name in this.buses) {
      const b = this.buses[name];
      b.input.disconnect(); b.duck.disconnect(); b.trim.disconnect(); b.comp?.disconnect();
    }
    this.reverbSend.disconnect(); this.sendHP.disconnect(); this.sendLP.disconnect();
    this.reverbReturn.disconnect();
    this.worldSum.disconnect(); this.muffleLP.disconnect(); this.muffleHS.disconnect();
    this.muffleGain.disconnect();
    this.masterSum.disconnect(); this.preGain.disconnect(); this.masterComp.disconnect();
    this.softClip.disconnect(); this.masterGain.disconnect();
  }
}
