/**
 * AUDIO / AIRSTRIKE
 *
 * Six voices for the air events in `src/match/airstrike.js`,
 * `src/match/bomber.js` and `src/match/strafe.js`, built the
 * same way everything else in this directory is: oscillators, the shared
 * NoiseBank, biquads and envelopes. No samples.
 *
 * The event is four sounds in a row and they are separate voices on purpose —
 * the whole point of a telegraphed strike is that the player hears each stage
 * and has time to act on it:
 *
 *   strike_jet       4 s out. A turbofan crossing overhead, well above the
 *                    rooftops. Says "something is coming", not where.
 *   strike_incoming  2.6 s out. The falling whistle, placed AT the target, so
 *                    the spatial field pans it to the place that is about to
 *                    stop existing. Pitch falls and level rises — that pairing
 *                    is what makes a descending sound read as approaching.
 *   strike_rubble    on impact + 0.35 s. Masonry arriving on tarmac: a few
 *                    hundred struck grains scattered over three seconds, with
 *                    the density falling off as the pile finishes settling.
 *   strike_tail      on impact. The long one: sub rumble, a dust wash and a
 *                    slow decay over six seconds.
 *   strafe_cannon    the fighter's gun, placed ON THE AIRCRAFT. A rip rather
 *                    than a shot: twenty-odd cracks a second under a broadband
 *                    roar, which is the only thing that makes an aircraft
 *                    firing read as different from an aircraft dropping.
 *   strafe_walk      the same rip arriving on the GROUND, placed at the middle
 *                    of the impact line and delayed by the shells' flight. Two
 *                    voices for one event on purpose: a strafing run is the one
 *                    weapon where the firing and the arriving are in different
 *                    places at the same time, and hearing both is how you work
 *                    out that the line is walking toward you.
 *
 * REVERB. There is live work in this directory reducing the send across the
 * board, and a blast is the easiest thing in the game to drown in room. So the
 * SIZE COMES FROM THE SOURCE, not from the room: the tail voice is a real
 * six-second decay synthesised here, and every voice returns a send between
 * 0.08 and 0.22 (a gunshot returns 0.85-1.35). If these need to feel bigger,
 * lengthen the envelopes, do not open the send.
 */

import {
  ad, biquad, clamp, gain, hit, lerp, osc, saturationCurve, series, shaper,
  struckResonator, sweep,
} from './dsp.js';

/**
 * Turbofan crossing overhead. Brown noise through a pair of resonant bandpasses
 * that sweep upward as the aircraft closes and back down as it goes away, plus
 * the compressor whine an octave up so it is a jet and not wind.
 */
export function strikeJet(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const lvl = o.level ?? 1;
  const dur = o.dur ?? 3.4;
  const out = gain(actx, 0.5); // VOICE TRIM

  /* the airframe: broadband roar, loudest as it passes */
  {
    const src = bank.source('brown', rng, rng.range(0.55, 0.8));
    const bp = biquad(actx, 'bandpass', 240, 0.8);
    const lp = biquad(actx, 'lowpass', 2600, 0.7);
    const g = gain(actx, 0);
    series(src, bp, lp, g).connect(out);
    // Doppler, faked with the filter rather than with playbackRate so the noise
    // buffer keeps its own spectrum: bright on approach, dull on departure.
    sweep(bp.frequency, t0, 190, 520, dur * 0.45);
    sweep(bp.frequency, t0 + dur * 0.45, 520, 150, dur * 0.55);
    sweep(lp.frequency, t0, 1800, 3400, dur * 0.45);
    sweep(lp.frequency, t0 + dur * 0.45, 3400, 900, dur * 0.55);
    ad(g.gain, t0, 0.95 * lvl, dur * 0.42, dur * 0.7);
    src.start(t0, src._offset, dur * 1.25);
  }

  /* compressor whine — two partials, quiet, and the only tonal content */
  for (let i = 0; i < 2; i++) {
    const f = 780 + i * 430;
    const s = osc(actx, 'sawtooth', f);
    const bp = biquad(actx, 'bandpass', f, 9);
    const g = gain(actx, 0);
    series(s, bp, g).connect(out);
    sweep(s.frequency, t0, f * 0.88, f * 1.14, dur * 0.45);
    sweep(s.frequency, t0 + dur * 0.45, f * 1.14, f * 0.7, dur * 0.55);
    ad(g.gain, t0, 0.05 * lvl, dur * 0.42, dur * 0.6);
    s.start(t0);
    s.stop(t0 + dur * 1.2);
  }

  return { node: out, end: t0 + dur * 1.3, send: 0.12 };
}

/**
 * The incoming whistle.
 *
 * Three detuned tones falling roughly two and a half octaves over `dur`, band
 * limited so it stays a whistle rather than a siren, with a noise shell that
 * grows into a rush at the end. The pitch curve is exponential (`sweep` uses
 * exponentialRampToValueAtTime) which is what a real falling body does and is
 * why a linear sweep sounds like a synthesiser instead.
 */
export function strikeIncoming(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const dur = Math.max(0.6, o.dur ?? 2.4);
  const lvl = o.level ?? 1;
  const out = gain(actx, 0.5); // VOICE TRIM

  const f0 = 1350 * rng.range(0.94, 1.07);
  const f1 = f0 * 0.16;

  for (let i = 0; i < 3; i++) {
    const det = [0, -7, 11][i];
    const s = osc(actx, i === 1 ? 'triangle' : 'sine', f0, det);
    const bp = biquad(actx, 'bandpass', f0, 2.4);
    const g = gain(actx, 0);
    series(s, bp, g).connect(out);
    sweep(s.frequency, t0, f0 * (1 + i * 0.005), f1, dur);
    sweep(bp.frequency, t0, f0, f1 * 1.3, dur);
    // Level RISES as the pitch falls. Attack over most of the fall, then hold.
    ad(g.gain, t0, (i === 0 ? 0.5 : 0.22) * lvl, dur * 0.86, 0.26);
    s.start(t0);
    s.stop(t0 + dur + 0.3);
  }

  /* the air around it — a rush that only really arrives in the last second */
  {
    const src = bank.source('pink', rng, rng.range(0.7, 1.0));
    const bp = biquad(actx, 'bandpass', 700, 1.1);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    sweep(bp.frequency, t0, 1900, 380, dur);
    ad(g.gain, t0 + dur * 0.35, 0.55 * lvl, dur * 0.6, 0.2);
    src.start(t0 + dur * 0.3, src._offset, dur * 0.9);
  }

  return { node: out, end: t0 + dur + 0.35, send: 0.18 };
}

/**
 * Masonry arriving. A few hundred struck grains whose density falls off over
 * `dur`, over a filtered wash for the powder. This is the sound that tells the
 * player a building came down rather than a grenade going off, so it is long
 * and it is dense at the start.
 */
export function strikeRubble(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const dur = o.dur ?? 3.2;
  const lvl = o.level ?? 1;
  const near = clamp(1 - (o.distance ?? 0) / 90, 0.08, 1);
  const out = gain(actx, 0.4); // VOICE TRIM

  /* the grains: concrete on tarmac, a few big slabs among a lot of gravel */
  const n = Math.round(lerp(34, 128, near));
  for (let i = 0; i < n; i++) {
    // Density falls as the pile settles: u^2 biases the draw toward t0.
    const u = rng.float() * rng.float();
    const gt = t0 + u * dur;
    const big = rng.float() < 0.16;
    struckResonator(
      actx,
      bank,
      rng,
      gt,
      big
        ? [
            { f: rng.range(70, 150), q: rng.range(3, 7), g: rng.range(0.09, 0.2) * near * lvl, decay: rng.range(0.09, 0.26) },
            { f: rng.range(230, 520), q: rng.range(5, 12), g: rng.range(0.03, 0.08) * near * lvl, decay: rng.range(0.04, 0.1) },
          ]
        : [
            { f: rng.range(500, 5200), q: rng.range(6, 26), g: rng.range(0.012, 0.05) * near * lvl, decay: rng.range(0.008, 0.06) },
          ],
      big ? 0.006 : 0.002
    ).connect(out);
  }

  /* powder: the dust cloud rolling out from under it */
  {
    const src = bank.source('pink', rng, rng.range(0.5, 0.9));
    const lp = biquad(actx, 'lowpass', 1500, 0.7);
    const g = gain(actx, 0);
    series(src, lp, g).connect(out);
    sweep(lp.frequency, t0, 2200, 260, dur * 1.1);
    ad(g.gain, t0 + 0.04, 0.34 * lvl * near, 0.22, dur * 1.05);
    src.start(t0 + 0.04, src._offset, dur * 1.3);
  }

  return { node: out, end: t0 + dur * 1.25 + 0.2, send: 0.22 };
}

/**
 * THE PILE FINISHING — 「瓦礫の崩れる音も追加してリアルにして」.
 *
 * `src/match/airstrike.js` has a settling stage: the chunks it threw stop moving
 * at impact + 6.5 s and become collision, and it emits `match:airstrike
 * { phase: 'settled' }` when they do. NOTHING WAS AUDIBLE ON IT. A storey of a
 * building came down, six and a half seconds of silence went by, and then the
 * rubble was simply solid — the one moment in the event that tells the player the
 * map has changed shape had no sound at all. Same for the bomber's debris and the
 * strafe's grit. `src/audio/index.js` now listens for the phase itself, because
 * `src/match` is not ours to edit.
 *
 * This is NOT `strikeRubble`, which is masonry ARRIVING at impact + 0.35 s: dense,
 * bright, hundreds of grains at once. A pile finishing is the opposite shape —
 * sparse, low, and it gets sparser. Four layers, and they are what a collapse
 * actually is:
 *
 *   1. SLABS     a handful of big low resonators with long decays, sliding and
 *                dropping. Only when `size` is big enough to have had slabs.
 *   2. SLIDE     a gravel run: bandpassed noise gated by its own falling
 *                envelope, which is what makes scree read as MOVING rather than
 *                as a wash.
 *   3. GRAINS    individual stones, arriving at a rate that decays over `dur`.
 *                `1 - u` biases them LATE, the mirror of strikeRubble's `u*u`.
 *   4. DUST      the powder rolling out, closing down to nothing.
 *
 * Deliberately dry (send 0.1): the length is in the envelopes, not in the room.
 */
export function rubbleCollapse(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  /** 0..1 — how much came down. An airstrike storey is 1, strafe grit is ~0.25. */
  const size = clamp(o.size ?? 1, 0.12, 1.4);
  const dur = (o.dur ?? lerp(1.6, 4.4, clamp(size, 0, 1))) ;
  const lvl = (o.level ?? 1) * lerp(0.45, 1, clamp(size, 0, 1));
  const near = clamp(1 - (o.distance ?? 0) / 110, 0.06, 1);
  const out = gain(actx, 0.42); // VOICE TRIM

  /* 1. slabs — the mass of it. Low, slow, and they land one at a time. */
  const slabs = Math.round(lerp(0, 5, clamp(size, 0, 1)) * near);
  for (let i = 0; i < slabs; i++) {
    const gt = t0 + rng.range(0.02, 0.75) * dur;
    struckResonator(actx, bank, rng, gt, [
      { f: rng.range(38, 74), q: rng.range(1.6, 3.4), g: rng.range(0.16, 0.3) * near * lvl, decay: rng.range(0.22, 0.55) },
      { f: rng.range(96, 190), q: rng.range(3, 7), g: rng.range(0.07, 0.15) * near * lvl, decay: rng.range(0.1, 0.28) },
      { f: rng.range(300, 720), q: rng.range(6, 14), g: rng.range(0.02, 0.055) * near * lvl, decay: rng.range(0.03, 0.09) },
    ], 0.012).connect(out);
  }

  /* 2. the slide — scree running off the pile, in two or three separate runs */
  const runs = Math.max(1, Math.round(lerp(1, 3, clamp(size, 0, 1))));
  for (let i = 0; i < runs; i++) {
    const st = t0 + (i / runs) * dur * 0.7 + rng.range(0, 0.18);
    const rd = rng.range(0.4, 1.0) * lerp(0.6, 1.35, clamp(size, 0, 1));
    const src = bank.source('white', rng, rng.range(0.8, 1.3));
    const bp = biquad(actx, 'bandpass', 1300, 0.55);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    // Falling band: the run starts as sharp gravel and ends as dry sand.
    sweep(bp.frequency, st, rng.range(1800, 3200), rng.range(420, 760), rd);
    // Slow attack, long release: material accelerating and then running out.
    ad(g.gain, st, rng.range(0.1, 0.2) * near * lvl, rd * 0.35, rd * 1.1);
    src.start(st, src._offset, rd * 1.5);
  }

  /* 3. individual stones, biased LATE — the pile is still finding its rest */
  const n = Math.round(lerp(14, 90, clamp(size, 0, 1)) * near);
  for (let i = 0; i < n; i++) {
    const u = 1 - rng.float() * rng.float();
    const gt = t0 + u * dur;
    struckResonator(actx, bank, rng, gt, [
      { f: rng.range(420, 4200), q: rng.range(5, 22), g: rng.range(0.008, 0.038) * near * lvl, decay: rng.range(0.006, 0.05) },
    ], 0.0018).connect(out);
  }

  /* 4. dust rolling out and closing down */
  {
    const src = bank.source('pink', rng, rng.range(0.5, 0.9));
    const lp = biquad(actx, 'lowpass', 1100, 0.7);
    const hp = biquad(actx, 'highpass', 90, 0.7);
    const g = gain(actx, 0);
    series(src, hp, lp, g).connect(out);
    sweep(lp.frequency, t0, 1300, 190, dur * 1.15);
    ad(g.gain, t0 + 0.03, 0.16 * lvl * near, dur * 0.25, dur * 1.05);
    src.start(t0 + 0.03, src._offset, dur * 1.35);
  }

  /* 5. the last of it: one low groan of the pile taking its own weight */
  if (size > 0.5) {
    const gt = t0 + dur * rng.range(0.62, 0.92);
    const s = osc(actx, 'sine', 46);
    const g = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(2, 0.4), '2x');
    series(s, drv, g).connect(out);
    sweep(s.frequency, gt, 58, 30, 0.9);
    ad(g.gain, gt, 0.3 * lvl * near, 0.09, 0.95);
    s.start(gt);
    s.stop(gt + 1.5);
  }

  return { node: out, end: t0 + dur * 1.4 + 0.3, send: 0.1 };
}

/**
 * THE FIGHTER'S GUN.
 *
 * A cannon at 20-25 rounds a second is not a sequence of shots, it is one
 * continuous tone with a pitch — the "brrrt" — and the two ways of getting there
 * sound completely different. A single sawtooth at the fire rate is a synth
 * buzzer; a TRAIN of individually struck cracks at that rate is a gun, because
 * each crack has its own attack, its own decay and its own detune, and the ear
 * hears both the rate and the grain. So it is the train, with the roar of the
 * barrel underneath and nothing tonal in it.
 *
 * `ground` swaps the resonances from breech-and-barrel to tarmac-and-grit and
 * drops the top end, which is the same event heard where it lands rather than
 * where it left.
 */
export function strafeCannon(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const dur = Math.max(0.25, o.dur ?? 1.2);
  const lvl = o.level ?? 1;
  const ground = !!o.ground;
  /** Rounds a second. Under 15 reads as a machine gun, over 30 as a saw. */
  const rate = o.rate ?? 22;
  const out = gain(actx, ground ? 0.4 : 0.46); // VOICE TRIM

  const n = clamp(Math.round(dur * rate), 4, 40);
  for (let i = 0; i < n; i++) {
    // Jittered spacing: a perfectly even train beats against itself and the
    // beating is audible as a metallic ring that no cannon has.
    const gt = t0 + (i / rate) * rng.range(0.93, 1.07);
    struckResonator(
      actx,
      bank,
      rng,
      gt,
      ground
        ? [
            { f: rng.range(80, 170), q: rng.range(2, 5), g: rng.range(0.05, 0.11) * lvl, decay: rng.range(0.03, 0.08) },
            { f: rng.range(380, 1400), q: rng.range(4, 11), g: rng.range(0.015, 0.04) * lvl, decay: rng.range(0.01, 0.03) },
          ]
        : [
            { f: rng.range(140, 230), q: rng.range(2, 4), g: rng.range(0.06, 0.12) * lvl, decay: rng.range(0.02, 0.05) },
            { f: rng.range(900, 2900), q: rng.range(3, 9), g: rng.range(0.02, 0.05) * lvl, decay: rng.range(0.006, 0.018) },
          ],
      ground ? 0.004 : 0.0025
    ).connect(out);
  }

  /* the barrel's roar under the rip — brown noise, band limited, no pitch */
  {
    const src = bank.source('brown', rng, rng.range(0.6, 0.95));
    const bp = biquad(actx, 'bandpass', ground ? 220 : 340, 0.75);
    const lp = biquad(actx, 'lowpass', ground ? 1400 : 3000, 0.8);
    const g = gain(actx, 0);
    series(src, bp, lp, g).connect(out);
    ad(g.gain, t0, (ground ? 0.4 : 0.5) * lvl, 0.05, dur * 1.05);
    src.start(t0, src._offset, dur * 1.25);
  }

  return { node: out, end: t0 + dur * 1.2 + 0.35, send: ground ? 0.2 : 0.14 };
}

/**
 * The long tail. Seven and a half seconds of sub and rumble under everything
 * else, so the strike has a size the reverb bus is not being asked to invent.
 *
 * 「空爆の音をちゃんとリアルに大きく表現すること」 — three things were added for that,
 * all of them length rather than gain, because the level is already set by
 * `src/match/airstrike.js` (level 1.25-1.55, emitter gain 2.2-2.6) and the
 * limiter is what a louder one would run into:
 *
 *   - 6.0 -> 7.6 s, and the sub sweeps to 13 Hz instead of 19: the last part of a
 *     big charge is felt more than heard, and it goes on after the rumble has
 *     gone.
 *   - a SECOND sub an octave under the first, arriving 0.3 s late. Two sweeps at
 *     different rates beat slowly against each other, which is what stops a long
 *     sine from reading as a test tone.
 *   - THREE discrete reports rather than one, at 0.4 / 1.1 / 2.2 s and getting
 *     darker: the report coming back off three different blocks. This is the
 *     layer that makes it a city rather than a field, and it is the one a
 *     convolver's smooth exponential cannot produce.
 *
 * MEASURED on `air:tail`, level 1, offline through the real mixer:
 * d20 1.17 -> 1.94 s, d40 2.33 -> 3.86 s, peak 0.188 -> 0.213, and DRY (send 0)
 * d20 1.24 -> 2.02 s, so the extra length is in the synthesis.
 */
export function strikeTail(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const dur = o.dur ?? 7.6;
  const lvl = o.level ?? 1;
  const out = gain(actx, 0.45); // VOICE TRIM

  /* concussion: a sub sine that outlives the blast body in foley.js */
  {
    const s = osc(actx, 'sine', 44);
    const g = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(3, 0.5), '2x');
    series(s, drv, g).connect(out);
    sweep(s.frequency, t0, 58, 13, dur * 0.72);
    ad(g.gain, t0, 0.9 * lvl, 0.02, dur * 0.8);
    s.start(t0);
    s.stop(t0 + dur);
  }

  /* …and one an octave under it, late and slower, so the two beat */
  {
    const st = t0 + 0.3;
    const s = osc(actx, 'sine', 26);
    const g = gain(actx, 0);
    const lp = biquad(actx, 'lowpass', 90, 0.7);
    series(s, g, lp).connect(out);
    sweep(s.frequency, st, 31, 11, dur * 0.85);
    ad(g.gain, st, 0.5 * lvl, 0.22, dur * 0.9);
    s.start(st);
    s.stop(st + dur);
  }

  /* rolling rumble off the buildings — brown noise under a closing lowpass */
  {
    const src = bank.source('brown', rng, rng.range(0.4, 0.7));
    const lp = biquad(actx, 'lowpass', 900, 0.9);
    const hp = biquad(actx, 'highpass', 32, 0.7);
    const g = gain(actx, 0);
    series(src, hp, lp, g).connect(out);
    sweep(lp.frequency, t0, 1100, 110, dur);
    ad(g.gain, t0, 0.55 * lvl, 0.06, dur);
    src.start(t0, src._offset, dur * 1.2);
  }

  /* three late reports off three different blocks, each darker than the last */
  {
    let gt = t0 + 0.4 * rng.range(0.8, 1.25);
    let l = 0.34 * lvl;
    let top = 1600;
    for (let i = 0; i < 3; i++) {
      const g = gain(actx, 0);
      const src = bank.source('brown', rng, rng.range(0.8, 1.2));
      const hp = biquad(actx, 'highpass', 70, 0.7);
      const lp = biquad(actx, 'lowpass', top, 0.8);
      series(src, hp, lp, g).connect(out);
      const d = 0.32 + i * 0.26;
      ad(g.gain, gt, l, 0.02, d);
      src.start(gt, src._offset, d * 2);
      gt += (0.7 + i * 1.1) * rng.range(0.85, 1.2);
      l *= 0.55;
      top *= 0.55;
    }
  }

  return { node: out, end: t0 + dur * 1.15, send: 0.2 };
}
