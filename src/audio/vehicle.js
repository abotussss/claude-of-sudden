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

/* ==================================================================== */
/* SUICIDE DRONES — the other thing in this game with a motor            */
/* ==================================================================== */
/**
 * 「ドローンの音も明確に出して」. `src/match/drone.js` flies thirty of these a
 * match, two aloft at a time, and until now it had to build the sound out of
 * voices that already existed: `strike_jet` re-struck about once a second
 * inside 58 m. That is a TURBINE, played as a series of one-shots, for four
 * small propellers — and its own author wrote down that it was a placeholder.
 *
 * A rotor cannot be made of one-shots for the same reason a tank engine cannot:
 * it is not an event, it is a PRESENCE. What follows is the same contract
 * `tankEngine` publishes — `{ node, drive, stop, freeAt, free }` — driven off
 * `match.drones.list` by the same loop in `battle.js`, because `match` publishes
 * that array for exactly this purpose and says so.
 *
 * WHY IT SOUNDS LIKE A QUADCOPTER AND NOT LIKE A WASP:
 *
 *   1. FOUR PROPS, NOT ONE. Each is a two-blade prop, so its fundamental is the
 *      BLADE-PASS rate — twice the shaft rate — and the four are deliberately
 *      detuned by up to 2.4 %. Four motors are never in sync (they are being
 *      trimmed continuously to hold attitude), and the beat frequencies that
 *      fall out of that mistuning, 2-9 Hz here, ARE the sound of a multirotor.
 *      One oscillator at the same pitch is a doorbell.
 *   2. THE CHOP IS AMPLITUDE, NOT PITCH. Air noise amplitude-modulated at the
 *      blade rate, as a multiplier stage rather than an LFO summed into a gain
 *      — the same trap `tankEngine`'s combustion layer documents.
 *   3. LOAD IS PITCH *AND* GRIT. A quad holding station is a hum; a quad
 *      committing to a 17 m/s dive has its motors saturated and reads as a
 *      SCREAM. Both the blade rate and the noise's share rise with load, and
 *      the low-pass opens, so the dive gets brighter as well as louder. That is
 *      the whole warning: the player cannot outrun it, so what the sound has to
 *      tell him is that it has stopped hunting and started arriving.
 *
 * @returns {{node: GainNode, drive: Function, stop: Function, free: Function}}
 */
export function droneRotor(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  /**
   * VOICE TRIM. Under `tankEngine`'s 0.55 on purpose: a 50-tonne diesel is the
   * loudest thing on the street and a 2 kg airframe is not. It is still a
   * CONTINUOUS voice, and continuous sounds dominate a mix far more than their
   * level suggests — `_startEngine`'s note on the tank measuring seven times
   * the player's own rifle is the cautionary tale.
   */
  const out = gain(actx, 0.34);
  const nodes = [];
  const sources = [];
  const keep = (n) => { nodes.push(n); return n; };

  /** Blade-pass rate holding station, Hz, jittered so two drones never phase. */
  const idleF = 196 * rng.range(0.93, 1.08);
  /** …and at full load. A small motor DOES rev, unlike the tank's diesel. */
  const maxF = idleF * 1.72;

  /* ---- 1-4. the four props --------------------------------------- */
  // Detune per prop, in cents of the blade rate. Fixed offsets rather than four
  // rng draws so the beat pattern is stable for this airframe's whole life.
  const DET = [1, 1.008, 0.987, 1.0235];
  const props = [];
  const propSum = keep(gain(actx, 1));
  for (let i = 0; i < 4; i++) {
    const p = keep(osc(actx, 'sawtooth', idleF * DET[i] * rng.range(0.997, 1.003)));
    const g = keep(gain(actx, 0.26));
    p.connect(g);
    g.connect(propSum);
    p.start(t0);
    sources.push(p);
    props.push({ osc: p, det: DET[i] });
  }
  // One shaper for all four: the intermodulation between the props is the point,
  // and a saturator is where it comes from. Four separate shapers would give
  // four clean buzzes that never interact.
  const propLP = keep(biquad(actx, 'lowpass', 1500, 0.9));
  const propDrv = keep(shaper(actx, saturationCurve(2.4, 0.35), '2x'));
  const propG = keep(gain(actx, 0.5));
  series(propSum, propLP, propDrv, propG).connect(out);

  /* ---- 5. blade chop: air noise, AM'd at the blade rate ----------- */
  const air = keep(bank.source('white', rng, rng.range(0.9, 1.2), true));
  const airBP = keep(biquad(actx, 'bandpass', 2100, 0.55));
  const airG = keep(gain(actx, 0.12));
  const airAM = keep(gain(actx, 0.6));
  series(air, airBP, airG, airAM).connect(out);
  const am = keep(osc(actx, 'sawtooth', idleF));
  const amG = keep(gain(actx, 0.5));
  am.connect(amG);
  amG.connect(airAM.gain);
  air.start(t0, air._offset);
  am.start(t0);
  sources.push(air, am);

  /* ---- 6. motor whine: the part that carries -------------------- */
  // Two octaves over the blade rate and narrow. This is what you hear first
  // across a courtyard, before the chop resolves.
  const whine = keep(osc(actx, 'triangle', idleF * 4));
  const whineBP = keep(biquad(actx, 'bandpass', idleF * 4, 3.5));
  const whineG = keep(gain(actx, 0.07));
  series(whine, whineBP, whineG).connect(out);
  whine.start(t0);
  sources.push(whine);

  // Fade in: `match` may hand us a drone that is already in the air.
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.setTargetAtTime(0.34, t0, 0.3);

  let stopped = false;

  return {
    node: out,
    /**
     * @param {number} load  0 (holding station) .. 1 (committed dive)
     * @param {number} speed metres/second through the air
     */
    drive(load, speed, when) {
      if (stopped) return;
      const t = when ?? actx.currentTime;
      const ld = clamp(load, 0, 1);
      const sp = clamp(speed, 0, 20);
      const f = lerp(idleF, maxF, ld);
      // 0.09 s, an order of magnitude quicker than the tank's 0.25: these are
      // 2-inch props on brushless motors and they answer the mixer instantly.
      // A drone whose note lags its dive is a drone that arrives before it is
      // heard, which is the one thing this sound exists to prevent.
      for (const p of props) p.osc.frequency.setTargetAtTime(f * p.det, t, 0.09);
      am.frequency.setTargetAtTime(f, t, 0.09);
      whine.frequency.setTargetAtTime(f * 4, t, 0.09);
      whineBP.frequency.setTargetAtTime(f * 4, t, 0.09);
      propLP.frequency.setTargetAtTime(lerp(1250, 3400, ld), t, 0.12);
      propG.gain.setTargetAtTime(lerp(0.38, 0.72, ld), t, 0.12);
      // Grit: the share of the voice that is turbulence rather than tone. A
      // dive is not just a higher hum, it is a rougher one.
      airG.gain.setTargetAtTime(lerp(0.09, 0.34, ld), t, 0.12);
      airBP.frequency.setTargetAtTime(lerp(1800, 3600, ld), t, 0.15);
      whineG.gain.setTargetAtTime(lerp(0.05, 0.14, ld), t, 0.15);
      // Airspeed rush, separate from load: a drone crossing at cruise is moving
      // air even while its motors are steady.
      airAM.gain.setTargetAtTime(clamp(0.45 + sp * 0.02, 0.45, 0.85), t, 0.2);
    },
    stop(when) {
      const t = when ?? actx.currentTime;
      if (stopped) return this.freeAt;
      stopped = true;
      out.gain.cancelScheduledValues(t);
      // Quicker than the tank's 0.22: a drone that stops existing (it detonated)
      // should not leave a rotor fading over a crater.
      out.gain.setTargetAtTime(0.0001, t, 0.09);
      const at = t + 0.5;
      for (const s of sources) { try { s.stop(at); } catch { /* already stopped */ } }
      this.freeAt = at + 0.1;
      return this.freeAt;
    },
    freeAt: Infinity,
    free() {
      stopped = true;
      for (const s of sources) { try { s.stop(); } catch { /* already stopped */ } }
      for (const n of nodes) { try { n.disconnect(); } catch { /* gone */ } }
      try { out.disconnect(); } catch { /* gone */ }
    },
  };
}

/**
 * DRONE LOCK — the warble the TARGET hears, head-locked.
 *
 * `src/match/drone.js` gives a man 2.2 seconds between the lock closing and the
 * dive, and puts DRONE LOCK / BREAK LINE OF SIGHT on his HUD. A caption is not
 * a threat; this is what makes it one, and it is deliberately not a sound
 * anything else in this game makes — the mix is full of gunfire, impacts and
 * boots, all of them broadband and all of them transient. A pitched, PERIODIC,
 * artificial warble occupies a hole in that spectrum, which is why every
 * missile warner ever built sounds roughly like this.
 *
 * Two tones a fifth apart, swapped at 13 Hz by a square LFO on the frequency
 * (a warble, not two beeps: a continuous tone that will not sit still is much
 * harder to ignore than a pulse train), with a second detuned voice under it so
 * it beats, and a hard-edged pulse envelope on top.
 */
export function droneLock(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const lvl = clamp(o.level ?? 1, 0, 2);
  const dur = clamp(o.dur ?? 0.62, 0.2, 2);
  const out = gain(actx, 0.5); // VOICE TRIM
  const f0 = 940 * rng.range(0.99, 1.01);

  for (let i = 0; i < 2; i++) {
    const car = osc(actx, i === 0 ? 'square' : 'sawtooth', f0 * (i === 0 ? 1 : 1.006));
    const bp = biquad(actx, 'bandpass', f0 * 1.6, 1.1);
    const g = gain(actx, 0);
    series(car, bp, g).connect(out);
    // The warble: a square LFO of +-a fifth on the carrier. `square` and not
    // `sine` on purpose — a smooth sweep reads as a siren, an instant swap
    // reads as a machine telling you something.
    const lfo = osc(actx, 'square', 13);
    const lfoG = gain(actx, f0 * 0.24);
    lfo.connect(lfoG);
    lfoG.connect(car.frequency);
    /**
     * Pulsed under the warble, so it is a pattern rather than a tone.
     *
     * The pulse is an AUDIO-RATE INPUT to the gain's own parameter, and an
     * AudioParam sums its connected inputs WITH its intrinsic value — so the
     * intrinsic value is the floor and the LFO swings around it. That is the
     * whole envelope: no DC source, no scheduled ramps per pip, and it stays
     * correct if the duration changes.
     */
    const amp = 0.32 * lvl * (i === 0 ? 1 : 0.5);
    const pulse = osc(actx, 'square', 6.5);
    const pulseG = gain(actx, amp * 0.85);
    pulse.connect(pulseG);
    pulseG.connect(g.gain);
    g.gain.setValueAtTime(amp, t0);
    g.gain.setTargetAtTime(0, t0 + dur, 0.04);
    car.start(t0); lfo.start(t0); pulse.start(t0);
    const off = t0 + dur + 0.2;
    car.stop(off); lfo.stop(off); pulse.stop(off);
  }

  /**
   * DRY. A warning that arrives with a room on it is a warning that arrives
   * late, and 「リバーブが強い」 is a standing complaint — this is head-locked
   * anyway, so the reverb would be describing a space the sound is not in.
   */
  return { node: out, end: t0 + dur + 0.3, send: 0 };
}

/**
 * DRONE DIVE — the terminal run, at the airframe.
 *
 * It commits at 17 m/s from about 22 m up and the player cannot outrun it: the
 * only answer is to break line of sight, so this sound IS the warning and it has
 * about a second and a half to deliver it. Three things happen at once, and all
 * three are what a real one does rather than dressing:
 *
 *   the blade rate CLIMBS as the motors saturate — a rising pitch is the single
 *   most legible "this is getting closer" cue there is, and it is also true;
 *   the air over the airframe becomes a rush that rises with it;
 *   and the whole thing gets brighter, because at that speed the props are
 *   past their efficient angle of attack and are tearing rather than pulling.
 *
 * It ENDS ABRUPTLY. There is no tail: what follows is the `explosion` event,
 * which `audio` already voices correctly, and a scream that decays politely
 * under a detonation would be a mix error.
 */
export function droneDive(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const lvl = clamp(o.level ?? 1, 0, 2);
  const dur = clamp(o.dur ?? 1.35, 0.4, 3);
  const out = gain(actx, 0.62); // VOICE TRIM
  const f0 = 300 * rng.range(0.95, 1.06);
  const f1 = f0 * 4.4;

  /* the props, tearing */
  for (let i = 0; i < 3; i++) {
    const det = [1, 1.013, 0.984][i];
    const p = osc(actx, 'sawtooth', f0 * det);
    const g = gain(actx, 0);
    const lp = biquad(actx, 'lowpass', 1400, 1.0);
    const drv = shaper(actx, saturationCurve(3.4, 0.4), '2x');
    series(p, lp, drv, g).connect(out);
    sweep(p.frequency, t0, f0 * det, f1 * det, dur * 0.92);
    lp.frequency.setValueAtTime(1400, t0);
    lp.frequency.exponentialRampToValueAtTime(5200, t0 + dur * 0.92);
    g.gain.setValueAtTime(0.001, t0);
    g.gain.linearRampToValueAtTime(0.3 * lvl, t0 + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.34 * lvl, t0 + dur);
    // No release: the blast is the release.
    g.gain.setValueAtTime(0.0001, t0 + dur + 0.005);
    p.start(t0); p.stop(t0 + dur + 0.05);
  }

  /* the air over the airframe */
  const air = bank.source('white', rng, rng.range(0.9, 1.15));
  const bp = biquad(actx, 'bandpass', 900, 0.6);
  const ag = gain(actx, 0);
  series(air, bp, ag).connect(out);
  sweep(bp.frequency, t0, 900, 4200, dur);
  ag.gain.setValueAtTime(0.001, t0);
  ag.gain.linearRampToValueAtTime(0.26 * lvl, t0 + dur);
  ag.gain.setValueAtTime(0.0001, t0 + dur + 0.005);
  air.start(t0, air._offset, dur + 0.1);

  return { node: out, end: t0 + dur + 0.1, send: 0.08 };
}
