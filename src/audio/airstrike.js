/**
 * AUDIO / AIRSTRIKE
 *
 * Four voices for the airstrike event in `src/match/airstrike.js`, built the
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
 * The long tail. Six seconds of sub and rumble under everything else, so the
 * strike has a size the reverb bus is not being asked to invent.
 */
export function strikeTail(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const dur = o.dur ?? 6.0;
  const lvl = o.level ?? 1;
  const out = gain(actx, 0.45); // VOICE TRIM

  /* concussion: a sub sine that outlives the blast body in foley.js */
  {
    const s = osc(actx, 'sine', 44);
    const g = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(3, 0.5), '2x');
    series(s, drv, g).connect(out);
    sweep(s.frequency, t0, 58, 19, dur * 0.7);
    ad(g.gain, t0, 0.9 * lvl, 0.02, dur * 0.75);
    s.start(t0);
    s.stop(t0 + dur);
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

  /* one late crack, so the tail is not a smooth fade */
  {
    const gt = t0 + rng.range(0.8, 1.9);
    const g = gain(actx, 0);
    const src = bank.source('white', rng, rng.range(0.8, 1.2));
    const bp = biquad(actx, 'bandpass', rng.range(320, 900), 2.2);
    series(src, bp, g).connect(out);
    hit(g.gain, gt, 0.3 * lvl, 0.5);
    src.start(gt, src._offset, 0.7);
  }

  return { node: out, end: t0 + dur * 1.15, send: 0.2 };
}
