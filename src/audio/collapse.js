/**
 * AUDIO / A BUILDING FAILING — 「大聖堂破壊はもっと音大きく激しくして」
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THESE ARE NOT THE AIRSTRIKE VOICES WITH THE GAIN TURNED UP
 * ────────────────────────────────────────────────────────────────────────────
 * The cathedral is 30 x 45 m and it is the centre of the map. It was being
 * scored through the same voices as a corner shop losing a storey, and the
 * agent rebuilding the collapse had already pushed those as far as they go:
 * `strike_tail` at level 1.8 / gain 4.2 / 640 m, three of them walked down the
 * nave, plus `strike_rubble` held across a nine second settle. Asking a voice
 * for four times its level is the sound of a small event played loudly, which is
 * exactly what it sounds like. Three things were missing and no amount of gain
 * produces any of them:
 *
 *   1. THE FAILURE ITSELF. `strikeRubble` is masonry ARRIVING — hundreds of
 *      bright grains at once — and `rubbleCollapse` is a pile FINISHING. Neither
 *      is the sound of a structure losing its ability to stand up, which is a
 *      sustained, pitched, DESCENDING tear that lasts for seconds and is the
 *      only cue that says "this building is coming down" rather than "something
 *      heavy landed".
 *   2. ANYTHING UNDER 40 Hz. `strikeTail` is mid-heavy by design (it is a roll
 *      heard from a distance) and the whole event had no floor. The weight of a
 *      thousand tonnes arriving is not loudness, it is bandwidth.
 *   3. THE BELL. There is one modelled hanging in the campanile and the
 *      campanile goes down with everything else.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE BUDGET, BECAUSE THIS LANDS ON A POOL THAT IS ALREADY FULL
 * ────────────────────────────────────────────────────────────────────────────
 * The cathedral salvo holds sixteen of the field's emitters at the moment these
 * play, and the render governor may have the pool down at twenty-four. So this
 * is THREE voices, not thirty: one bed, one thump, one bell. They are long
 * (5-10 s) and they are expensive to build (~60-90 nodes each), and that is the
 * trade being made deliberately — a handful of big voices rather than a swarm of
 * small ones, because a swarm is what the pool cannot survive. They are given a
 * priority above every other sound in the game so that they cannot be evicted by
 * the dust and rubble they are playing over; @see `AudioSystem._build`.
 *
 * Measured through a real cathedral collapse: `tools/audiotest.mjs --collapse`.
 */

import {
  ad, biquad, clamp, gain, hit, lerp, osc, saturationCurve, series, shaper,
  struckResonator, sweep,
} from './dsp.js';

/**
 * THE STRUCTURE FAILING — a sustained masonry tear, not a gravel roll.
 *
 * Five layers, and the first one is the whole idea:
 *
 *  1. THE LOAD SHED. Three high-Q resonances whose centre frequencies FALL
 *     across the whole event. This is not a stylistic sweep: a structure's
 *     resonant frequency goes as sqrt(stiffness/mass), the cracking is the
 *     stiffness leaving, and so the pitch of a building's own ring drops as it
 *     fails. It is the difference between "a building is coming down" and "a lot
 *     of stone is moving", and nothing else in this directory does it.
 *  2. THE TEAR. Dense grains (the `crackle` bank) through a wide band, gated by
 *     a SECOND noise source used as an amplitude multiplier — so the rip is
 *     ragged and irregular rather than a smooth hiss. A continuous even noise
 *     bed reads as wind; masonry parting does not.
 *  3. SLABS. Vault ribs and floor plates hitting each other, biased to the
 *     MIDDLE of the event — the mirror of `rubbleCollapse`, whose grains bias
 *     late because a pile settles after it lands. Each one is a struck low
 *     resonator plus its own saturated thump.
 *  4. THE MASS ROAR. Broad low-mid noise swelling over the first third and
 *     falling away over the rest: several thousand tonnes in motion.
 *  5. THE GROAN AFTER. One long, low, bending tone as what is left takes the
 *     load — the sound of the ruin deciding it is going to stand.
 *
 * @param {object} o { when, dur, level, distance, size }
 */
export function collapseTear(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const dur = clamp(o.dur ?? 5.5, 1.2, 12);
  const lvl = o.level ?? 1;
  /** 1 = a cathedral. Smaller buildings ask for less of everything. */
  const size = clamp(o.size ?? 1, 0.25, 1.5);
  const near = clamp(1 - (o.distance ?? 0) / 220, 0.1, 1);
  const out = gain(actx, 0.5); // VOICE TRIM
  let end = t0 + dur;

  /* ---- 1. the load shed ------------------------------------------ */
  {
    // Three modes of a masonry box: the whole-building sway, the nave's
    // cross-section, and the ring of the walls. All three fall together.
    const modes = [
      { f0: 41 * rng.range(0.94, 1.07), f1: 17, q: 7, g: 0.5, k: 1 },
      { f0: 96 * rng.range(0.94, 1.07), f1: 38, q: 9, g: 0.34, k: 0.8 },
      { f0: 232 * rng.range(0.94, 1.07), f1: 92, q: 11, g: 0.19, k: 0.55 },
    ];
    for (const m of modes) {
      const src = bank.source('brown', rng, rng.range(0.7, 1.1));
      const bp = biquad(actx, 'bandpass', m.f0, m.q);
      const g = gain(actx, 0);
      series(src, bp, g).connect(out);
      // The fall is slow at first and then runs away, which is how a structure
      // actually goes: it holds, it yields, it lets go.
      sweep(bp.frequency, t0, m.f0, m.f1, dur * 0.78);
      ad(g.gain, t0, m.g * lvl * near * size, dur * 0.1, dur * 0.9);
      src.start(t0, src._offset, dur * 1.25);
    }
  }

  /* ---- 2. the tear ------------------------------------------------ */
  {
    const src = bank.source('crackle', rng, rng.range(0.75, 1.15));
    const bp = biquad(actx, 'bandpass', 900, 0.5);
    const hp = biquad(actx, 'highpass', 160, 0.7);
    const g = gain(actx, 0);
    // The ragged gate. A gain node whose `gain` param is DRIVEN by another noise
    // source is a multiplier, not a sum — the trap `ambientOneShot`'s rotor
    // layer documents — so the rip genuinely tears rather than fading.
    const am = gain(actx, 0.55);
    series(src, hp, bp, g, am).connect(out);
    const mod = bank.source('brown', rng, rng.range(0.25, 0.5));
    const modG = gain(actx, 0.5);
    mod.connect(modG); modG.connect(am.gain);
    sweep(bp.frequency, t0, 1500, 380, dur * 0.85);
    ad(g.gain, t0, 0.52 * lvl * near * size, dur * 0.13, dur * 0.95);
    src.start(t0, src._offset, dur * 1.3);
    mod.start(t0, mod._offset, dur * 1.3);
  }

  /* ---- 3. slabs, biased to the middle ----------------------------- */
  {
    const n = Math.round(lerp(4, 9, clamp(size, 0, 1.2)) * near);
    for (let i = 0; i < n; i++) {
      // Two uniforms averaged: a triangular distribution centred on the event.
      const u = (rng.float() + rng.float()) * 0.5;
      const st = t0 + u * dur * 0.92;
      const w = rng.range(0.55, 1) * lvl * near;
      struckResonator(actx, bank, rng, st, [
        { f: rng.range(29, 52), q: rng.range(1.4, 2.8), g: 0.4 * w, decay: rng.range(0.35, 0.9) },
        { f: rng.range(78, 165), q: rng.range(2.5, 6), g: 0.2 * w, decay: rng.range(0.14, 0.4) },
        { f: rng.range(260, 640), q: rng.range(5, 13), g: 0.075 * w, decay: rng.range(0.04, 0.13) },
      ], 0.016).connect(out);
      // …and the punch under each one, saturated so it survives a small speaker.
      const s = osc(actx, 'sine', 60);
      const sg = gain(actx, 0);
      const drv = shaper(actx, saturationCurve(3, 0.45), '2x');
      series(s, sg, drv).connect(out);
      sweep(s.frequency, st, rng.range(62, 88), rng.range(26, 36), 0.28);
      ad(sg.gain, st, 0.42 * w, 0.006, rng.range(0.22, 0.42));
      s.start(st); s.stop(st + 0.8);
      end = Math.max(end, st + 1);
    }
  }

  /* ---- 4. the mass roar ------------------------------------------- */
  {
    const src = bank.source('brown', rng, rng.range(0.55, 0.95));
    const lp = biquad(actx, 'lowpass', 520, 0.8);
    const hp = biquad(actx, 'highpass', 34, 0.7);
    const g = gain(actx, 0);
    series(src, hp, lp, g).connect(out);
    sweep(lp.frequency, t0, 620, 150, dur);
    ad(g.gain, t0, 0.62 * lvl * near * size, dur * 0.3, dur * 0.95);
    src.start(t0, src._offset, dur * 1.3);
  }

  /* ---- 5. the groan of what is left ------------------------------- */
  {
    const gt = t0 + dur * rng.range(0.72, 0.9);
    const s = osc(actx, 'sine', 38);
    const g = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(2.2, 0.4), '2x');
    series(s, g, drv).connect(out);
    sweep(s.frequency, gt, 44, 21, 1.6);
    ad(g.gain, gt, 0.34 * lvl * near, 0.14, 1.7);
    s.start(gt); s.stop(gt + 2.4);
    end = Math.max(end, gt + 2.4);
  }

  // Dry on purpose. The length is in the envelopes; four reverb paths were cut
  // out of this project because 「リバーブが強いです、まだ」 and a nine second bed
  // fed into the convolvers is the fastest way to earn that complaint back.
  return { node: out, end: end + 0.2, send: 0.09 };
}

/**
 * THE SUB — the floor of the event, and the layer the collapse had none of.
 *
 * A thousand tonnes arriving is not a loud sound, it is a LOW one, and low is
 * the one thing `strikeTail` does not do: it is a rolling report built to carry
 * across a map, so its energy sits in the mids by construction.
 *
 * SATURATION IS NOT DECORATION HERE. A pure sine sweeping to 19 Hz is inaudible
 * on a laptop, a phone or any speaker without a real driver in it — it is felt,
 * not heard, and most people will never feel it. Driving it produces the
 * harmonic series above it (38, 57, 76 Hz…), and THAT is what a small speaker
 * reproduces; the ear reconstructs the missing fundamental from them. So the
 * thump is audible everywhere and genuinely enormous where there is a subwoofer,
 * from one oscillator.
 *
 * @param {object} o { when, dur, level, distance }
 */
export function collapseSub(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const dur = clamp(o.dur ?? 1.7, 0.5, 6);
  const lvl = o.level ?? 1;
  const near = clamp(1 - (o.distance ?? 0) / 260, 0.12, 1);
  const out = gain(actx, 0.72); // VOICE TRIM

  /* ---- the pressure front ---------------------------------------- */
  {
    const src = bank.source('brown', rng, rng.range(0.8, 1.15));
    const lp = biquad(actx, 'lowpass', 170, 0.9);
    const g = gain(actx, 0);
    series(src, lp, g).connect(out);
    hit(g.gain, t0, 0.85 * lvl * near, 0.07);
    src.start(t0, src._offset, 0.3);
  }

  /* ---- the sub itself -------------------------------------------- */
  {
    const s = osc(actx, 'sine', 52);
    const g = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(3.6, 0.5), '4x');
    // The shaper goes AFTER the envelope so the drive falls with the level
    // rather than squaring the tail into a buzz.
    series(s, g, drv).connect(out);
    sweep(s.frequency, t0, 54, 19, dur * 0.72);
    ad(g.gain, t0, 1.0 * lvl * near, 0.012, dur * 0.85);
    s.start(t0); s.stop(t0 + dur * 1.3);
  }

  /* ---- the growl an octave up, so it has a pitch at all ----------- */
  {
    const s = osc(actx, 'triangle', 104);
    const g = gain(actx, 0);
    const lp = biquad(actx, 'lowpass', 240, 1.1);
    series(s, g, lp).connect(out);
    sweep(s.frequency, t0, 108, 41, dur * 0.6);
    ad(g.gain, t0, 0.4 * lvl * near, 0.01, dur * 0.5);
    s.start(t0); s.stop(t0 + dur);
  }

  /* ---- the ground wave: a second, later, softer swell ------------- */
  {
    const gt = t0 + 0.16;
    const s = osc(actx, 'sine', 30);
    const g = gain(actx, 0);
    s.connect(g); g.connect(out);
    sweep(s.frequency, gt, 33, 16, dur);
    ad(g.gain, gt, 0.5 * lvl * near, dur * 0.22, dur * 0.9);
    s.start(gt); s.stop(gt + dur * 1.4);
  }

  return { node: out, end: t0 + dur * 1.45 + 0.1, send: 0.05 };
}

/**
 * THE BELL IN THE CAMPANILE, GOING DOWN WITH IT.
 *
 * A bell is the one instrument whose partials are deliberately INHARMONIC, and
 * that is the whole sound: a tuned bell is voiced so that the hum sits an octave
 * below the strike note, the tierce a MINOR third above it (which is why every
 * bell sounds faintly mournful whatever key it is in), then the quint and the
 * nominal an octave up. Stack harmonics instead and you get a church organ.
 * The ratios below are the standard ones; the small detunes are what make it
 * beat, and a bell that does not beat sounds like a sine bank.
 *
 * IT IS ALSO FALLING. This is not a bell being rung — it is a two tonne casting
 * coming out of a tower with the tower. So it is struck two or three times as it
 * goes, harder and more damply each time, and the last event is not a strike at
 * all: it is the bell hitting the ground, which is the same partials with the Q
 * pulled out of them — a dead, cracked clank with no ring left. That contrast is
 * the storytelling in it, and it costs one extra resonator bank.
 *
 * @param {object} o { when, f0, level, distance, strikes }
 */
export function collapseBell(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const lvl = o.level ?? 1;
  const near = clamp(1 - (o.distance ?? 0) / 260, 0.1, 1);
  /** Strike note. ~150 Hz is a big tower bell — a tonne and a half of bronze. */
  const f0 = clamp(o.f0 ?? 152 * rng.range(0.96, 1.05), 70, 400);
  const strikes = clamp(Math.round(o.strikes ?? 3), 1, 4);
  const out = gain(actx, 0.44); // VOICE TRIM

  /** hum, prime, tierce (minor 3rd), quint, nominal, deciem, undecime, 2x oct. */
  const RATIO = [0.5, 1.0, 1.19, 1.5, 2.0, 2.5, 3.0, 4.0];
  const WEIGHT = [0.62, 0.5, 0.42, 0.26, 0.34, 0.14, 0.1, 0.06];
  /** The low partials ring for many seconds; the top ones are gone in one. */
  const DECAY = [7.5, 5.5, 4.2, 2.6, 2.2, 1.1, 0.8, 0.45];

  let end = t0 + 1;
  let t = t0;
  for (let s = 0; s < strikes; s++) {
    // Falling apart as it falls: each strike is quieter and rings shorter,
    // because the casting is being struck by masonry rather than by a clapper.
    const damp = Math.pow(0.62, s);
    const parts = [];
    for (let i = 0; i < RATIO.length; i++) {
      parts.push({
        // A real casting is never exactly on ratio, and the error is what beats.
        f: f0 * RATIO[i] * rng.range(0.993, 1.007),
        q: lerp(46, 26, i / RATIO.length) * rng.range(0.85, 1.15),
        g: WEIGHT[i] * lvl * near * damp * 0.34,
        decay: DECAY[i] * damp * rng.range(0.85, 1.15),
      });
    }
    struckResonator(actx, bank, rng, t, parts, 0.0045).connect(out);
    // The strike transient: bronze being hit is a bright, short, metallic slap
    // that arrives before any of the partials have built.
    const src = bank.source('white', rng, rng.range(0.9, 1.3));
    const bp = biquad(actx, 'bandpass', f0 * 8 * rng.range(0.85, 1.2), 1.4);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    hit(g.gain, t, 0.3 * lvl * near * damp, 0.02);
    src.start(t, src._offset, 0.1);
    end = Math.max(end, t + DECAY[0] * damp);
    t += rng.range(0.55, 1.15);
  }

  /* ---- and then it lands ----------------------------------------- */
  {
    const lt = t + rng.range(0.25, 0.6);
    const parts = [];
    for (let i = 0; i < 5; i++) {
      parts.push({
        f: f0 * RATIO[i] * rng.range(0.96, 1.04),
        // Q pulled right down: the bronze is against the ground and cannot ring.
        q: rng.range(3, 7),
        g: WEIGHT[i] * lvl * near * 0.5,
        decay: rng.range(0.09, 0.26),
      });
    }
    struckResonator(actx, bank, rng, lt, parts, 0.01).connect(out);
    // The mass of it arriving, under the clank.
    const s = osc(actx, 'sine', 58);
    const g = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(2.6, 0.45), '2x');
    series(s, g, drv).connect(out);
    sweep(s.frequency, lt, 64, 27, 0.4);
    ad(g.gain, lt, 0.5 * lvl * near, 0.005, 0.45);
    s.start(lt); s.stop(lt + 1.1);
    end = Math.max(end, lt + 1.2);
  }

  // A bell is the one thing here that WANTS the room — it is a tuned metal
  // object in a stone tower — but the send stays modest for the same reason
  // everything else in this directory is dry, and the ring is in the decays.
  return { node: out, end: end + 0.2, send: 0.16 };
}
