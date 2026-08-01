/**
 * AUDIO / ARMOUR — the tank you can hear coming, and the gun that answers.
 *
 * 「戦車の動く音とか砲撃の音も追加して」. Both were missing, and they were missing
 * for different reasons:
 *
 *  - THE MOVEMENT had no sound AT ALL. `src/match/tank.js` drives two 50-tonne
 *    hulls down the mid street for a minute at a time and the street stayed as
 *    quiet as it was before they arrived. A tank is the loudest object in this
 *    game by a wide margin and the only one whose sound is CONTINUOUS: it is not
 *    an event, it is a presence, which is why it cannot be built out of the
 *    one-shot machinery every other voice here uses.
 *  - THE GUN had a sound, but only its second half: `tank.js` plays
 *    `strike_tail` at the muzzle, which is the airstrike's ROLL — the part that
 *    arrives after the event. There was no report. A 120 mm firing 30 m away is
 *    a pressure step first and a roll afterwards, and the step is the part you
 *    flinch at.
 *
 * Nothing in this file is allowed to reach into `src/match`. `tank.js` publishes
 * `match:tank { phase, id, team, position }` and `match.armour.tanks`, and that
 * is all this uses; speed is DIFFERENTIATED FROM POSITION rather than read off
 * the hull, so the engine note is right whatever `tank.js` does internally.
 *
 * @see src/audio/battle.js for the frame loop that drives these.
 */

import {
  ad, biquad, clamp, gain, lerp, osc, saturationCurve, series, shaper,
  struckResonator, sweep,
} from './dsp.js';

/**
 * THE ENGINE, AS A CONTINUOUS VOICE.
 *
 * A multi-fuel V12 in a hull, heard from outside. Five layers, and the reason
 * for each is the same reason `weapons.js` gives for a gunshot's seven: take any
 * one away and it stops being a tank.
 *
 *   1. FIRING ORDER   a saturated saw at the cylinder-firing rate. A V12 at
 *                     1100 rpm fires 110 times a second; that rate IS the engine
 *                     note, and sweeping it is what makes the vehicle sound like
 *                     it is working rather than idling.
 *   2. CRANK LOPE     the same event at 1/6 of the rate — the slow uneven beat
 *                     you hear before you can hear anything else. This is the
 *                     layer that carries down a street.
 *   3. COMBUSTION     brown noise amplitude-modulated at the firing rate: the
 *                     chuff. Without it the saw reads as a synthesiser.
 *   4. TRACKS         a grain train (the `crackle` bank) whose PLAYBACK RATE
 *                     scales with road speed, so the link slap follows the
 *                     vehicle instead of being a loop underneath it. This is the
 *                     layer that says "it is moving" while the engine says "it
 *                     is running", and they are separately true: a tank halted
 *                     at a firing position still idles.
 *   5. ROAD RUMBLE    sub-120 Hz weight, also speed-scaled.
 *
 * Everything loops or oscillates, so the per-frame cost is a handful of
 * `setTargetAtTime` calls and nothing is allocated after construction.
 *
 * @returns {{node: GainNode, drive: Function, stop: Function}}
 */
export function tankEngine(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const out = gain(actx, 0.55); // VOICE TRIM
  const nodes = [];
  const sources = [];
  const keep = (n) => { nodes.push(n); return n; };

  /** Idle firing rate, Hz. Per hull jitter so two tanks are never in phase. */
  const idleF = 74 * rng.range(0.94, 1.07);
  /** …and flat out. The ratio is a diesel's, not a car's: it does not rev. */
  const maxF = idleF * 2.05;

  /* ---- 1. firing order ------------------------------------------- */
  const fire = keep(osc(actx, 'sawtooth', idleF));
  const fireG = keep(gain(actx, 0.5));
  const fireLP = keep(biquad(actx, 'lowpass', 420, 1.1));
  const fireDrv = keep(shaper(actx, saturationCurve(3.2, 0.4), '2x'));
  series(fire, fireG, fireLP, fireDrv).connect(out);
  fire.start(t0);
  sources.push(fire);

  /* ---- 2. crank lope --------------------------------------------- */
  const lope = keep(osc(actx, 'triangle', idleF / 6));
  const lopeG = keep(gain(actx, 0.42));
  const lopeLP = keep(biquad(actx, 'lowpass', 150, 0.9));
  series(lope, lopeG, lopeLP).connect(out);
  lope.start(t0);
  sources.push(lope);

  /* ---- 3. combustion chuff --------------------------------------- */
  const comb = keep(bank.source('brown', rng, rng.range(0.85, 1.15), true));
  const combLP = keep(biquad(actx, 'lowpass', 900, 0.7));
  const combHP = keep(biquad(actx, 'highpass', 90, 0.7));
  const combG = keep(gain(actx, 0.5));
  // The AM is a MULTIPLIER stage, not an LFO summed into the envelope gain —
  // same trap `ambientOneShot`'s heli layer documents.
  const combAM = keep(gain(actx, 0.55));
  series(comb, combHP, combLP, combG, combAM).connect(out);
  const am = keep(osc(actx, 'sawtooth', idleF));
  const amG = keep(gain(actx, 0.45));
  am.connect(amG); amG.connect(combAM.gain);
  comb.start(t0, comb._offset);
  am.start(t0);
  sources.push(comb, am);

  /* ---- 4. track links -------------------------------------------- */
  const trk = keep(bank.source('crackle', rng, 0.35, true));
  const trkBP = keep(biquad(actx, 'bandpass', 1500, 0.75));
  const trkHP = keep(biquad(actx, 'highpass', 380, 0.7));
  const trkG = keep(gain(actx, 0));
  series(trk, trkHP, trkBP, trkG).connect(out);
  trk.start(t0, trk._offset);
  sources.push(trk);

  /* ---- 5. road rumble -------------------------------------------- */
  const road = keep(bank.source('brown', rng, rng.range(0.7, 1.0), true));
  const roadLP = keep(biquad(actx, 'lowpass', 120, 0.9));
  const roadG = keep(gain(actx, 0));
  series(road, roadLP, roadG).connect(out);
  road.start(t0, road._offset);
  sources.push(road);

  // Fade in rather than switching on: a hull that becomes audible in one frame
  // reads as a bug, and `match` may hand us a tank that is already rolling.
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.setTargetAtTime(0.55, t0, 0.35);

  let stopped = false;

  return {
    node: out,
    /**
     * @param {number} throttle 0 (idling in place) .. 1 (advancing hard)
     * @param {number} speed    metres/second over the ground
     */
    drive(throttle, speed, when) {
      if (stopped) return;
      const t = when ?? actx.currentTime;
      const th = clamp(throttle, 0, 1);
      const sp = clamp(speed, 0, 8);
      const f = lerp(idleF, maxF, th);
      // 0.25 s is a 50-tonne powerpack answering the governor, not a throttle
      // body: it should audibly LAG the hull's acceleration.
      fire.frequency.setTargetAtTime(f, t, 0.25);
      lope.frequency.setTargetAtTime(f / 6, t, 0.25);
      am.frequency.setTargetAtTime(f, t, 0.25);
      fireLP.frequency.setTargetAtTime(lerp(360, 700, th), t, 0.3);
      /**
       * IDLE IS 8 dB UNDER LOAD, and it had to be measured to get there. With
       * the first set of numbers (0.40 -> 0.62 firing, 0.34 -> 0.70 combustion,
       * a fixed lope) an idling hull rendered at rms 0.0251 and a hull at full
       * advance at 0.0316 — TWO decibels apart, so the tank sounded exactly the
       * same whether it was parked in the square or driving at you. A diesel
       * under load is not 2 dB louder than one turning over; the whole point of
       * the sound is that you can hear it working.
       */
      fireG.gain.setTargetAtTime(lerp(0.2, 0.62, th), t, 0.3);
      combG.gain.setTargetAtTime(lerp(0.17, 0.7, th), t, 0.3);
      lopeG.gain.setTargetAtTime(lerp(0.18, 0.46, th), t, 0.3);
      // Track noise is about GROUND SPEED and nothing else — a tank revving on
      // the spot rattles far less than one rolling at a walking pace.
      trk.playbackRate.setTargetAtTime(clamp(0.28 + sp * 0.19, 0.28, 1.6), t, 0.2);
      trkG.gain.setTargetAtTime(clamp(sp * 0.085, 0, 0.5), t, 0.2);
      trkBP.frequency.setTargetAtTime(clamp(1150 + sp * 190, 1000, 2600), t, 0.25);
      roadG.gain.setTargetAtTime(clamp(sp * 0.055, 0, 0.34), t, 0.25);
    },
    /**
     * Fade out and schedule the sources to stop. Idempotent. Returns the audio
     * time after which `free()` may safely disconnect — the caller's frame loop
     * owns that, NOT a `setTimeout`: a timer outlives `dispose()` and would fire
     * into a closed context.
     */
    stop(when) {
      const t = when ?? actx.currentTime;
      if (stopped) return this.freeAt;
      stopped = true;
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(0.0001, t, 0.22);
      const at = t + 1.2;
      for (const s of sources) { try { s.stop(at); } catch { /* already stopped */ } }
      this.freeAt = at + 0.1;
      return this.freeAt;
    },
    freeAt: Infinity,
    /** Disconnect everything. Safe to call twice, and safe to call early. */
    free() {
      stopped = true;
      for (const s of sources) { try { s.stop(); } catch { /* already stopped */ } }
      for (const n of nodes) { try { n.disconnect(); } catch { /* gone */ } }
      try { out.disconnect(); } catch { /* gone */ }
    },
  };
}

/**
 * THE MAIN GUN, at the muzzle.
 *
 * This is the REPORT — the part `tank.js`'s `strike_tail` does not have. A
 * 120 mm is not a big rifle: the pressure step is an order of magnitude larger,
 * the useful energy is an octave lower, and the muzzle brake throws a second
 * blast sideways a few milliseconds after the first. What it is NOT is long —
 * the roll that follows is the town's, and the town's is already playing (see
 * `_mainGun` in tank.js). Overlapping two rolls is how you get mud, so this one
 * ends where that one starts.
 */
export function tankGun(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const lvl = o.level ?? 1;
  const dist = Math.max(0, o.distance ?? 0);
  const near = clamp(1 - dist / 90, 0, 1);
  const out = gain(actx, 0.5); // VOICE TRIM
  let end = t0 + 0.6;

  /* ---- pressure step --------------------------------------------- */
  {
    const src = bank.source('white', rng, rng.range(0.8, 1.1));
    const hp = biquad(actx, 'highpass', 700, 0.6);
    const lp = biquad(actx, 'lowpass', 3800, 0.7);
    const g = gain(actx, 0);
    series(src, hp, lp, g).connect(out);
    ad(g.gain, t0, 1.15 * lvl * (0.35 + near * 0.65), 0.0009, 0.02);
    src.start(t0, src._offset, 0.08);
  }

  /* ---- the crack, driven hard ------------------------------------ */
  {
    const src = bank.source('white', rng, rng.range(0.75, 1.05));
    const bp = biquad(actx, 'bandpass', 620 * (0.9 + near * 0.35), 0.75);
    const drv = shaper(actx, saturationCurve(11, 0.55), '2x');
    const top = biquad(actx, 'lowpass', 2400, 0.7);
    const g = gain(actx, 0);
    series(src, bp, drv, top, g).connect(out);
    sweep(bp.frequency, t0, 880, 420, 0.18);
    ad(g.gain, t0, 1.0 * lvl, 0.0018, 0.1);
    src.start(t0, src._offset, 0.4);
    end = Math.max(end, t0 + 0.4);
  }

  /* ---- body and sub: the part that moves the ground --------------- */
  {
    const b = osc(actx, 'sine', 96);
    const bg = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(4.5, 0.5), '2x');
    b.connect(bg); series(bg, drv).connect(out);
    sweep(b.frequency, t0, 104, 42, 0.26);
    ad(bg.gain, t0, 0.9 * lvl, 0.0035, 0.24);
    b.start(t0); b.stop(t0 + 0.8);

    const s = osc(actx, 'sine', 34);
    const sg = gain(actx, 0);
    s.connect(sg); sg.connect(out);
    sweep(s.frequency, t0, 52, 28, 0.4);
    ad(sg.gain, t0, 0.75 * lvl, 0.008, 0.42);
    s.start(t0); s.stop(t0 + 1.2);
    end = Math.max(end, t0 + 1.2);
  }

  /**
   * ---- the brake's second blast ----------------------------------
   * A muzzle brake vents sideways: to anything standing beside the tank the
   * shot is two events 4-8 ms apart, and that doubling is most of why a tank gun
   * sounds like a tank gun rather than like a very large rifle.
   */
  {
    const bt = t0 + rng.range(0.004, 0.009);
    const src = bank.source('white', rng, rng.range(0.7, 1.1));
    const bp = biquad(actx, 'bandpass', 1250, 0.9);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    sweep(bp.frequency, bt, 1500, 700, 0.09);
    ad(g.gain, bt, 0.5 * lvl * (0.3 + near * 0.7), 0.0015, 0.06);
    src.start(bt, src._offset, 0.2);
  }

  /* ---- breech and recoil: steel moving inside a steel box --------- */
  if (near > 0.25) {
    struckResonator(actx, bank, rng, t0 + rng.range(0.055, 0.085), [
      { f: 430 * rng.range(0.95, 1.06), q: 16, g: 0.22 * lvl * near, decay: 0.11 },
      { f: 980, q: 12, g: 0.12 * lvl * near, decay: 0.06 },
      { f: 2100, q: 9, g: 0.06 * lvl * near, decay: 0.03 },
    ], 0.004).connect(out);
    end = Math.max(end, t0 + 0.5);
  }

  /* ---- short tail, and then it gets out of the way ---------------- */
  {
    const dur = 0.55 + dist * 0.0022;
    const src = bank.source('brown', rng, rng.range(0.6, 0.95));
    const lp = biquad(actx, 'lowpass', 700, 0.8);
    const g = gain(actx, 0);
    series(src, lp, g).connect(out);
    sweep(lp.frequency, t0, 760, 170, dur);
    ad(g.gain, t0, 0.5 * lvl, 0.012, dur);
    src.start(t0, src._offset, dur * 1.3 + 0.05);
    end = Math.max(end, t0 + dur * 1.3);
  }

  return { node: out, end: end + 0.05, send: 0.22 };
}
