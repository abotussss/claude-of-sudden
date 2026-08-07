/**
 * AUDIO / A SATELLITE PLOUGHING A FIELD — the five seconds that were silent.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT `collapse_tear` WITH A DIFFERENT ENVELOPE
 * ────────────────────────────────────────────────────────────────────────────
 * The agent that wired the collapse voices into the match reached this beat,
 * saw that it was five seconds of an airframe coming apart, and deliberately
 * did NOT play `collapse_tear` over it. Its reasoning is in `Crash._impact` and
 * it is right: that voice is masonry to its bones — three load-shed modes of a
 * MASONRY BOX, vault ribs, floor plates — and its whole idea is that a
 * structure's resonance falls as `sqrt(stiffness/mass)` while the cracking
 * takes the stiffness away. A building's own ring drops in pitch as it fails.
 *
 * NONE OF THAT IS HAPPENING HERE. Nothing about the wreck is failing under its
 * own weight; it is being DRAGGED. A hundred tonnes of airframe is grinding
 * 157 m through turf in five seconds, and every sound it makes is a sound the
 * ground is making it make. Playing the cathedral over it would have been the
 * wrong voice played correctly, which is worse than silence because it is
 * plausible.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE PITCH FALLS, AND IT IS NOT A SWEEP — IT IS THE DECELERATION
 * ────────────────────────────────────────────────────────────────────────────
 * A scrape is STICK-SLIP: the sliding face grabs, loads, releases and grabs
 * again, and it does it once per asperity it passes over. That makes the
 * fundamental of a scrape a RATE — `speed / asperity spacing` — and it is why
 * dragging a chair fast across a floor squeals and dragging it slowly growls.
 * It is the same insight `tankEngine` is built on (「キャタピラ音がなっているのが
 * 理想」: speed changes how OFTEN a track link is thrown down, not what pitch it
 * lands at) with one difference that changes everything about how it sounds.
 *
 * A tank's link rate spans about one decade. This spans three. `Crash._poseAt`
 * skids the wreck on `1 - (1-u)^2`, so it touches down at about 63 m/s and is
 * stationary five seconds later, and at 0.12 m of asperity that is 520 Hz
 * falling to nothing. What the player hears is a scream that descends into a
 * roar, into a growl, into individual slaps, and then stops — and every bit of
 * that descent is the deceleration curve the wreck is ALREADY following on
 * screen. Nothing here authors a downward sweep; `drive()` is handed the speed
 * and the pitch is a consequence. That is also why it cannot drift out of sync
 * with the picture.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIX LAYERS
 * ────────────────────────────────────────────────────────────────────────────
 *   1. SOIL          the bow wave of earth being displaced. Broad, dull, wet.
 *                    The MASS of the event, and the only layer that is loud.
 *   2. STICK-SLIP    THE VOICE. Two skewed pulse trains at the asperity rate,
 *                    gating band-limited noise. Percussive at a crawl, a
 *                    continuous tearing rasp at speed. @see pulseCurve
 *   3. THE AIRFRAME  fixed high-Q inharmonic shell resonances, struck by the
 *                    same gate — and progressively DAMPED as the wreck digs
 *                    itself in, which is the exact opposite of a masonry load
 *                    shed: it does not fall in pitch, it stops being able to
 *                    ring at all.
 *   4. FURROW SUB    a hundred tonnes moving earth, under 60 Hz, with a gait on
 *                    it at the rate the hull bucks over the ground.
 *   5. CLODS         earth and torn plating thrown clear, landing behind.
 *   6. THE SETTLE    built in `stop()`, because a thing that ENDS is not a
 *                    thing that fades. @see stop.
 *
 * Everything loops or oscillates and nothing is allocated after construction
 * except the settle — `drive()` is a dozen `setTargetAtTime` calls, which is
 * what a voice held across five seconds of a live frame loop is allowed to
 * cost. Same contract as `tankEngine` and `droneRotor`:
 * `{ node, drive, stop, freeAt, free }`.
 *
 * @see src/audio/index.js `startPlough` for the slot, the lease and the gains.
 */

import {
  ad, biquad, clamp, gain, lerp, osc, pulseCurve, saturationCurve, series,
  shaper, struckResonator, sweep,
} from './dsp.js';

/**
 * Metres between one grab and the next. This is the single number the whole
 * voice's pitch comes out of, and it is a property of TURF UNDER STEEL rather
 * than a tuning: coarse ground and a torn metal face part company every ten
 * centimetres or so. Jittered per event so two rounds are not identical.
 */
const ASPERITY = 0.12;
/**
 * …and the ceiling on the rate, in Hz.
 *
 * At touchdown the wreck is doing 63 m/s, which is 520 grabs a second, and a
 * gate train that periodic at that rate is not a scrape — it is a 520 Hz
 * whistle, because a perfectly regular impulse train IS a pitch. Real asperity
 * spacing has enormous variance, so above a few hundred a second the events
 * stop being resolvable and the train decorrelates into noise. Clamping here
 * and letting the soil layer carry the top of the event is the honest model as
 * well as the one that does not whistle.
 */
const RATE_MAX = 300;
/** …and the floor, so a stopped oscillator cannot latch a gate open. */
const RATE_MIN = 9;

/**
 * @param {BaseAudioContext} actx
 * @param {object} bank  NoiseBank
 * @param {object} rng
 * @param {object} o { when }
 * @returns {{node: GainNode, drive: Function, stop: Function, freeAt: number, free: Function}}
 */
export function ploughScrape(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  /**
   * VOICE TRIM. Over `tankEngine`'s 0.55 on purpose and by a long way: this is
   * the loudest continuous thing either map ever makes and it exists for five
   * seconds once a match, against a 34 m blast that has just gone off and 27
   * fire cells detonating behind it. @see `startPlough` for the measured
   * emitter gain — the trim is the voice's own balance, that one is the mix's.
   */
  const out = gain(actx, 0.9);
  const nodes = [];
  const sources = [];
  const keep = (n) => { nodes.push(n); return n; };

  const asperity = ASPERITY * rng.range(0.88, 1.14);
  /** Grabs per second at `sp` m/s. The fundamental of the whole voice. */
  const rate = (sp) => clamp(sp / asperity, RATE_MIN, RATE_MAX);
  /**
   * The hull bucking over the ground, revolutions per second. A 157 m furrow in
   * a rolling plain is not smooth and a scrape at a constant level is a hiss.
   */
  const buck = (sp) => clamp(sp * 0.085, 0.5, 5.5);

  /* ---- 1. the soil: the bow wave of earth ------------------------- */
  /**
   * Two noises rather than one, and the second is the reason it reads as EARTH.
   * Brown alone is a rumble; the pink layer through a mid band is the hiss of
   * a million grains of soil shearing past each other, and without it the layer
   * is a lorry going past rather than a furrow being cut.
   */
  const soil = keep(bank.source('brown', rng, rng.range(0.7, 1.05), true));
  const soilHP = keep(biquad(actx, 'highpass', 44, 0.7));
  const soilLP = keep(biquad(actx, 'lowpass', 260, 0.8));
  const soilG = keep(gain(actx, 0));
  series(soil, soilHP, soilLP, soilG).connect(out);
  soil.start(t0, soil._offset);
  sources.push(soil);

  const grit = keep(bank.source('pink', rng, rng.range(0.85, 1.2), true));
  const gritBP = keep(biquad(actx, 'bandpass', 700, 0.55));
  const gritAM = keep(gain(actx, 0.78));
  const gritG = keep(gain(actx, 0));
  series(grit, gritBP, gritAM, gritG).connect(out);
  grit.start(t0, grit._offset);
  sources.push(grit);

  /* ---- 2. STICK-SLIP: the voice ----------------------------------- */
  /**
   * The excitation, held shut by `slipGate` (intrinsic 0) and opened only by
   * the pulse trains below. Band-limited BEFORE the gate so the resonators are
   * fed the same material at 500 grabs a second as at nine.
   */
  const slipN = keep(bank.source('white', rng, rng.range(0.9, 1.15), true));
  const slipHP = keep(biquad(actx, 'highpass', 180, 0.7));
  const slipLP = keep(biquad(actx, 'lowpass', 3200, 0.7));
  const slipGate = keep(gain(actx, 0));
  series(slipN, slipHP, slipLP).connect(slipGate);
  slipN.start(t0, slipN._offset);
  sources.push(slipN);

  /**
   * A DARK EXCITER THROUGH THE SAME GATE, and it is the lesson `tankEngine`'s
   * clatter layer had to learn twice: white noise is flat per Hz, so four
   * fifths of its energy is above 600 Hz and a bank of LOW resonances fed from
   * it is being fed almost nothing. Steel dragged through soil has its weight
   * low down. One grab, two colours — deliberately not its own train.
   */
  const slipLowN = keep(bank.source('brown', rng, rng.range(0.8, 1.1), true));
  const slipLowLP = keep(biquad(actx, 'lowpass', 620, 0.8));
  const slipLowG = keep(gain(actx, 4.2));
  series(slipLowN, slipLowLP, slipLowG).connect(slipGate);
  slipLowN.start(t0, slipLowN._offset);
  sources.push(slipLowN);

  /**
   * 34 % DUTY, which is very wide next to the tank's 14 %, and it has to be.
   * A track link is THROWN DOWN — a discrete crack with silence either side. A
   * scrape is the opposite: the face is in contact the whole time and the gate
   * is describing how hard it is loaded, not whether it is touching. At 34 %
   * the slips overlap into a continuous tearing rasp the moment the rate is
   * over about eighty a second, and separate into individual grabs only as the
   * wreck comes to rest — which is exactly the transition this event needs and
   * a narrow gate could not make.
   */
  const GATE = pulseCurve(0.34, 0.10, 1.25);
  /**
   * TWO TRAINS, 4 % APART. One perfectly periodic train of 300 transients a
   * second is a 300 Hz buzz, i.e. a pitch, which is what this must not be.
   * Two that drift through each other bunch and thin continuously and the ear
   * never finds the period. Same argument as the tank's two tracks — and here
   * it is not even a licence: the wreck is dragging on a torn port wing and a
   * bare belly, which are two different faces on two different soils.
   */
  const SKEW = 1.041 * rng.range(0.995, 1.006);
  const slipA = keep(osc(actx, 'sawtooth', rate(0)));
  const slipAS = keep(shaper(actx, GATE, 'none'));
  const slipAG = keep(gain(actx, 1));
  series(slipA, slipAS, slipAG).connect(slipGate.gain);
  slipA.start(t0);
  sources.push(slipA);

  const slipB = keep(osc(actx, 'sawtooth', rate(0) * SKEW));
  const slipBS = keep(shaper(actx, GATE, 'none'));
  const slipBG = keep(gain(actx, 0.88));
  series(slipB, slipBS, slipBG).connect(slipGate.gain);
  // Started late for the reason `tankEngine` documents: an OscillatorNode's
  // phase cannot be set, and two saws started together grab in step until the
  // skew pulls them apart.
  slipB.start(t0 + 0.011);
  sources.push(slipB);

  /**
   * THE BODY OF THE GRAB. A high-Q bandpass passes only `f/Q` of what it is
   * fed, so a bank made only of resonances throws away almost all of a burst —
   * which is how the tank's first clatter ended up inaudible. This wide, low-Q
   * path is the broadband tear itself; the shell resonances below sit on it.
   */
  const slipBus = keep(gain(actx, 1));
  const slipBody = keep(biquad(actx, 'bandpass', 430, 0.5));
  const slipBodyG = keep(gain(actx, 3.2));
  slipGate.connect(slipBody);
  slipBody.connect(slipBodyG);
  slipBodyG.connect(slipBus);

  /* ---- 3. the airframe, ringing and being buried ------------------ */
  /**
   * A MONOCOQUE IS A THIN SHELL AND A SHELL IS INHARMONIC. These four are not a
   * harmonic series and must not be: a stressed-skin airframe rings on its
   * panel and frame modes, which are set by panel geometry and have no common
   * factor. Stack harmonics instead and it is a church organ — the same
   * argument `collapseBell` makes for a bell, made for a fuselage.
   *
   * NOT ONE OF THESE MOVES. `collapse_tear` sweeps its modes DOWN because a
   * masonry box is losing stiffness; this hull is losing nothing, it is being
   * excited by the ground and then progressively silenced by it. What `drive()`
   * moves is `shellLP` and `shellG` — how bright the ring is and how much there
   * is of it — and both close as the wreck digs itself in.
   */
  const SHELL = [
    { f: 87, q: 6.5, g: 0.72 },   // the fuselage as a whole, end to end
    { f: 214, q: 11, g: 0.50 },   // frames and formers
    { f: 533, q: 15, g: 0.28 },   // skin panels drumming
    { f: 1290, q: 19, g: 0.12 },  // the torn edge itself: the part that carries
  ];
  for (const p of SHELL) {
    const bp = keep(biquad(actx, 'bandpass', p.f * rng.range(0.96, 1.045), p.q));
    const g = keep(gain(actx, p.g * Math.sqrt(p.q) * 1.15));
    slipGate.connect(bp);
    bp.connect(g);
    g.connect(slipBus);
  }
  const shellLP = keep(biquad(actx, 'lowpass', 3200, 0.8));
  // The gait on the rasp, and the speed trim. `slipAM` is a multiplier stage
  // driven by the buck LFO; `slipG` is the only thing `drive()` moves here.
  const slipAM = keep(gain(actx, 0.82));
  const slipG = keep(gain(actx, 0));
  series(slipBus, shellLP, slipAM, slipG).connect(out);

  /* ---- 4. the furrow sub ------------------------------------------ */
  /**
   * SATURATED, FOR THE REASON `collapseSub` SPELLS OUT AT LENGTH: a pure tone
   * at 28 Hz is inaudible on a laptop or a phone — it is felt, and most people
   * will never feel it. Driving it produces the harmonic series above it and
   * the ear reconstructs the missing fundamental from those, so the weight is
   * audible everywhere and genuinely enormous where there is a real driver.
   *
   * It is a SUSTAINED bed with a gait on it, which is what makes it a different
   * voice from `collapse_sub` rather than a quieter copy: that one is a
   * pressure front and a falling sweep — one arrival — and this one is five
   * seconds of a furrow being cut and never sweeps at all.
   */
  const sub = keep(osc(actx, 'sine', 31));
  const subG = keep(gain(actx, 0));
  const subAM = keep(gain(actx, 0.7));
  const subDrv = keep(shaper(actx, saturationCurve(3.4, 0.45), '4x'));
  series(sub, subG, subAM, subDrv).connect(out);
  sub.start(t0);
  sources.push(sub);

  const rumble = keep(bank.source('brown', rng, rng.range(0.5, 0.8), true));
  const rumbleLP = keep(biquad(actx, 'lowpass', 96, 0.9));
  const rumbleG = keep(gain(actx, 0));
  series(rumble, rumbleLP, rumbleG).connect(subAM);
  rumble.start(t0, rumble._offset);
  sources.push(rumble);

  /* ---- 5. clods thrown clear -------------------------------------- */
  const clod = keep(bank.source('crackle', rng, 0.5, true));
  const clodHP = keep(biquad(actx, 'highpass', 260, 0.7));
  const clodBP = keep(biquad(actx, 'bandpass', 1150, 1.0));
  const clodG = keep(gain(actx, 0));
  series(clod, clodHP, clodBP, clodG).connect(out);
  clod.start(t0, clod._offset);
  sources.push(clod);

  /**
   * ONE LFO AT THE BUCK RATE, driving three multiplier stages, exactly as
   * `tankEngine`'s wheel LFO does — and for the same arithmetic reason each
   * stage's intrinsic gain is chosen so the sum can never cross zero: an
   * AudioParam that goes negative inverts the signal it is multiplying.
   */
  const rock = keep(osc(actx, 'sine', buck(0)));
  const rockToGrit = keep(gain(actx, 0.20));  // 0.58 .. 0.98
  const rockToSlip = keep(gain(actx, 0.16));  // 0.66 .. 0.98
  const rockToSub = keep(gain(actx, 0.24));   // 0.46 .. 0.94
  rock.connect(rockToGrit); rockToGrit.connect(gritAM.gain);
  rock.connect(rockToSlip); rockToSlip.connect(slipAM.gain);
  rock.connect(rockToSub); rockToSub.connect(subAM.gain);
  rock.start(t0);
  sources.push(rock);

  /**
   * NO FADE IN. `tankEngine` and `droneRotor` both ramp up over a third of a
   * second because `match` may hand either of them a vehicle that is already
   * moving and becoming audible in one frame would read as a bug. The opposite
   * is true here: this voice starts on the frame a satellite hits the ground,
   * one line after a 34 m explosion, and the ground contact is an EVENT. A
   * scrape that eases in has already missed the thing it is describing.
   */
  out.gain.setValueAtTime(0.9, t0);

  let stopped = false;

  return {
    node: out,
    /**
     * @param {number} speed metres/second over the ground, 0 .. 70
     * @param {number} dug   0 (just touched down) .. 1 (buried, at rest)
     * @param {number} when  absolute context time
     */
    drive(speed, dug, when) {
      if (stopped) return;
      const t = when ?? actx.currentTime;
      const sp = clamp(speed, 0, 70);
      const dg = clamp(dug, 0, 1);
      /** How hard it is working. Concave, so the tail is not silent early. */
      const work = Math.pow(clamp(sp / 55, 0, 1), 0.6);

      /**
       * THE RATE, AND IT IS THE ONLY PLACE SPEED BECOMES A FREQUENCY. What it
       * becomes is a COUNT OF GRABS PER SECOND. Nothing downstream is retuned —
       * the shell modes are the same lump of aluminium at 60 m/s and at 3 — so
       * the wreck slowing down grinds SLOWER rather than merely lower, and the
       * pitch that falls out of it is the real one.
       *
       * 0.06 s: fast. This is a body losing energy to the ground, not a
       * powerplant answering a governor, and the tank's 0.12-0.25 s smoothing
       * here would audibly lag a five-second event.
       */
      slipA.frequency.setTargetAtTime(rate(sp), t, 0.06);
      slipB.frequency.setTargetAtTime(rate(sp) * SKEW, t, 0.06);
      rock.frequency.setTargetAtTime(buck(sp), t, 0.12);

      /* the soil it is moving */
      soilG.gain.setTargetAtTime(lerp(0.10, 1.05, work), t, 0.09);
      soilLP.frequency.setTargetAtTime(lerp(170, 620, work), t, 0.12);
      gritG.gain.setTargetAtTime(lerp(0.05, 0.62, work), t, 0.09);
      gritBP.frequency.setTargetAtTime(lerp(430, 1500, work), t, 0.14);

      /* the tear */
      slipG.gain.setTargetAtTime(lerp(0.16, 1.15, work), t, 0.08);
      slipLP.frequency.setTargetAtTime(lerp(1500, 4200, work), t, 0.12);
      /**
       * IT IS BURYING ITSELF, AND THAT IS WHY IT GOES DARK.
       *
       * A masonry box FALLS in pitch as it fails because it is shedding
       * stiffness. An airframe ploughing a furrow sheds nothing — but half of
       * it is under the turf by the end of 157 m, and a panel packed with soil
       * cannot drum. So the shell's brightness and its share of the voice both
       * close with `dug` and neither of them moves in frequency, which is the
       * measurable difference between this event and a collapse.
       */
      shellLP.frequency.setTargetAtTime(lerp(3400, 640, dg), t, 0.2);

      /* the ground shock */
      subG.gain.setTargetAtTime(lerp(0.05, 0.78, work), t, 0.1);
      sub.frequency.setTargetAtTime(lerp(24, 34, work), t, 0.2);
      rumbleG.gain.setTargetAtTime(lerp(0.04, 0.34, work), t, 0.12);

      /* what it is throwing behind it */
      clodG.gain.setTargetAtTime(lerp(0.0, 0.30, work), t, 0.1);
      clod.playbackRate.setTargetAtTime(clamp(0.22 + sp * 0.02, 0.22, 1.5), t, 0.15);
    },

    /**
     * IT ENDS, AND ENDING IS NOT FADING.
     *
     * The brief for this voice is "a sustained, moving, pitched-down tearing
     * scrape THAT ENDS". A gain ramp to zero is a scrape that goes away, which
     * is a different thing and sounds like one — the mix simply loses a layer
     * and nothing in the world accounts for it. What actually happens is that a
     * hundred tonnes stops moving and drops onto its belly, so the last event
     * in this voice is a SETTLE: the shell's own modes struck once with the Q
     * pulled down (soil-packed panels cannot ring, which is the same contrast
     * `collapseBell` gets from its bell hitting the ground) plus one saturated
     * thump of the mass arriving.
     *
     * It is the one thing in this file allocated outside the constructor. That
     * is once a match, on a frame where the event is already over, and the
     * nodes go into the same two lists so `free()` still takes everything.
     */
    stop(when) {
      const t = when ?? actx.currentTime;
      if (stopped) return this.freeAt;
      stopped = true;

      // The tear and the clods go first and go fast: contact is what has
      // stopped, and it stops in a fraction of a second.
      for (const [g, tau] of [[slipG, 0.07], [clodG, 0.05], [gritG, 0.10]]) {
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0.0001, t, tau);
      }
      // The soil it has piled up in front of itself keeps moving a moment
      // longer than the wreck does.
      soilG.gain.cancelScheduledValues(t);
      soilG.gain.setTargetAtTime(0.0001, t, 0.22);
      subG.gain.cancelScheduledValues(t);
      subG.gain.setTargetAtTime(0.0001, t, 0.26);
      rumbleG.gain.cancelScheduledValues(t);
      rumbleG.gain.setTargetAtTime(0.0001, t, 0.3);

      /* ---- the settle -------------------------------------------- */
      const st = t + 0.04;
      const dead = struckResonator(actx, bank, rng, st, SHELL.map((p) => ({
        // Q pulled right down from the ringing bank above: this is the same
        // airframe with soil packed into every panel of it.
        f: p.f * rng.range(0.94, 1.05),
        q: clamp(p.q * 0.28, 2, 6),
        g: p.g * 0.62,
        decay: rng.range(0.10, 0.34),
      })), 0.014);
      nodes.push(dead);
      dead.connect(out);

      const mass = osc(actx, 'sine', 46);
      const massG = gain(actx, 0);
      const massDrv = shaper(actx, saturationCurve(2.8, 0.45), '2x');
      series(mass, massG, massDrv).connect(out);
      sweep(mass.frequency, st, 52, 23, 0.5);
      ad(massG.gain, st, 0.62, 0.008, 0.55);
      mass.start(st); mass.stop(st + 1.3);
      nodes.push(mass, massG, massDrv);
      sources.push(mass);

      // …and one last shear of earth as the furrow closes behind it.
      const last = bank.source('brown', rng, rng.range(0.5, 0.8));
      const lastLP = biquad(actx, 'lowpass', 300, 0.8);
      const lastG = gain(actx, 0);
      series(last, lastLP, lastG).connect(out);
      ad(lastG.gain, st, 0.34, 0.05, 0.8);
      last.start(st, last._offset, 1.1);
      nodes.push(last, lastLP, lastG);
      sources.push(last);

      // The voice bus itself is NOT ramped: every layer above has its own
      // ending and the settle has to be able to ring through the top of it.
      const at = st + 1.6;
      for (const s of sources) {
        if (s === mass || s === last) continue;   // these have their own stops
        try { s.stop(at); } catch { /* already stopped */ }
      }
      this.freeAt = at + 0.2;
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
