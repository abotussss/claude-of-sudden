/**
 * AUDIO / FOLEY
 *
 * Impacts, footsteps, shell casings, reload mechanics, explosions, body falls
 * and UI. Everything is keyed off the twelve surface names in ARCHITECTURE.md
 * so physics, FX, decals and audio always agree about what was hit.
 *
 * The recurring recipe for a physical impact is:
 *   transient (contact)  +  body (mass)  +  texture (material)  +  debris
 * Which of those four dominates is what makes concrete sound like concrete and
 * flesh sound like flesh; the envelope shapes matter far more than the exact
 * filter frequencies.
 */

import {
  ad, biquad, clamp, gain, hit, lerp, osc, saturationCurve, semis, series, shaper,
  struckResonator, sweep,
} from './dsp.js';

/**
 * Per-surface impact recipe.
 *  bodyF/bodyDecay  the mass thump
 *  ring             high-Q partials (metal, glass, wood) or null
 *  tex              { kind, f, q, decay, level } the material texture burst
 *  grains           number of debris grains
 *  bright           transient level 0..1
 *  wet              reverb send
 */
const IMPACT = {
  concrete: {
    bright: 0.85, bodyF: 180, bodyDecay: 0.05, ring: null,
    tex: { kind: 'white', f: 2600, q: 0.9, decay: 0.075, level: 0.75 },
    dust: { f: 1200, decay: 0.3, level: 0.16 }, grains: 5, wet: 0.4,
  },
  plaster: {
    bright: 0.7, bodyF: 220, bodyDecay: 0.035, ring: null,
    tex: { kind: 'white', f: 1900, q: 0.8, decay: 0.05, level: 0.6 },
    dust: { f: 900, decay: 0.42, level: 0.26 }, grains: 6, wet: 0.42,
  },
  metal: {
    bright: 1.0, bodyF: 150, bodyDecay: 0.035,
    ring: [{ f: 1750, q: 34, g: 0.42, decay: 0.28 }, { f: 3120, q: 26, g: 0.3, decay: 0.17 },
      { f: 5400, q: 18, g: 0.18, decay: 0.09 }, { f: 8100, q: 12, g: 0.09, decay: 0.05 }],
    tex: { kind: 'white', f: 5200, q: 1.2, decay: 0.03, level: 0.5 },
    dust: null, grains: 3, wet: 0.5,
  },
  wood: {
    bright: 0.6, bodyF: 320, bodyDecay: 0.055,
    ring: [{ f: 420, q: 14, g: 0.35, decay: 0.11 }, { f: 780, q: 11, g: 0.2, decay: 0.07 },
      { f: 1520, q: 8, g: 0.1, decay: 0.04 }],
    tex: { kind: 'white', f: 1500, q: 1.0, decay: 0.045, level: 0.45 },
    dust: null, grains: 5, wet: 0.32,
  },
  dirt: {
    bright: 0.25, bodyF: 120, bodyDecay: 0.07, ring: null,
    tex: { kind: 'brown', f: 700, q: 0.7, decay: 0.09, level: 0.7 },
    dust: { f: 600, decay: 0.34, level: 0.2 }, grains: 4, wet: 0.2,
  },
  sand: {
    bright: 0.18, bodyF: 105, bodyDecay: 0.055, ring: null,
    tex: { kind: 'white', f: 1500, q: 0.5, decay: 0.13, level: 0.5 },
    dust: { f: 1000, decay: 0.4, level: 0.24 }, grains: 3, wet: 0.16,
  },
  glass: {
    bright: 1.0, bodyF: 500, bodyDecay: 0.02,
    ring: [{ f: 3400, q: 40, g: 0.34, decay: 0.13 }, { f: 5300, q: 34, g: 0.26, decay: 0.1 },
      { f: 7900, q: 26, g: 0.2, decay: 0.07 }, { f: 11200, q: 18, g: 0.12, decay: 0.05 }],
    tex: { kind: 'crackle', f: 6000, q: 0.9, decay: 0.28, level: 0.6 },
    dust: null, grains: 11, wet: 0.46,
  },
  water: {
    bright: 0.3, bodyF: 260, bodyDecay: 0.03, ring: null,
    tex: { kind: 'white', f: 1800, q: 0.8, decay: 0.14, level: 0.75, rise: true },
    dust: null, grains: 4, wet: 0.3, bubbles: true,
  },
  foliage: {
    bright: 0.25, bodyF: 380, bodyDecay: 0.02, ring: null,
    tex: { kind: 'crackle', f: 2600, q: 0.8, decay: 0.16, level: 0.6 },
    dust: null, grains: 7, wet: 0.22,
  },
  fabric: {
    bright: 0.2, bodyF: 150, bodyDecay: 0.045, ring: null,
    tex: { kind: 'white', f: 900, q: 0.6, decay: 0.06, level: 0.4 },
    dust: { f: 700, decay: 0.2, level: 0.1 }, grains: 2, wet: 0.18,
  },
  flesh: {
    bright: 0.35, bodyF: 128, bodyDecay: 0.06, ring: null,
    tex: { kind: 'white', f: 620, q: 1.4, decay: 0.055, level: 0.62 },
    dust: null, grains: 3, wet: 0.24, wet_squelch: true,
  },
  rubber: {
    bright: 0.3, bodyF: 190, bodyDecay: 0.04,
    ring: [{ f: 260, q: 9, g: 0.2, decay: 0.06 }],
    tex: { kind: 'white', f: 1100, q: 0.9, decay: 0.03, level: 0.3 },
    dust: null, grains: 1, wet: 0.2,
  },
};

/* ------------------------------------------------------------------ */
/* Bullet impacts                                                     */
/* ------------------------------------------------------------------ */

/**
 * @param {object} o { when, surface, energy (0..1.5), distance }
 */
export function surfaceImpact(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const s = IMPACT[o.surface] ?? IMPACT.concrete;
  const e = clamp(o.energy ?? 1, 0.15, 1.6);
  const jit = semis(rng.range(-2.5, 2.5));
  /**
   * VOICE TRIM, AND IT IS NOW PER-SURFACE — 0.22 becomes 0.22..0.30.
   *
   * `send` here is `s.wet`, and it spans 0.16 (sand) to 0.50 (metal): the widest
   * range of any voice in the game, because a round on sheet metal really does
   * ring the building and a round in sand really does not. That made the impacts
   * the biggest losers of the third `reverbReturn` cut, and it did it UNEVENLY —
   * MEASURED, rms: metal -3.4 dB, plaster -3.1, glass -2.9, wood -2.6, concrete
   * -2.5, while sand came out at 0.0 and dirt at -0.6. A flat trim, or a bus
   * raise, would have pushed sand and dirt up by three decibels they never lost.
   *
   * So the compensation is proportional to what each surface had in the send: the
   * wettest surfaces get the most dry level back, the dry ones get almost none,
   * and the ranking between the twelve surfaces — which is the whole point of the
   * table — is preserved.
   */
  const out = gain(actx, 0.22 * (1 + (s.wet ?? 0.3) * 0.36));  // VOICE TRIM
  let end = t0 + 0.2;

  /* transient */
  if (s.bright > 0.05) {
    const src = bank.source('white', rng, rng.range(0.9, 1.35));
    const hp = biquad(actx, 'highpass', 3000 * jit, 0.7);
    const g = gain(actx, 0);
    series(src, hp, g).connect(out);
    hit(g.gain, t0, 0.55 * s.bright * e, rng.range(0.003, 0.008));
    src.start(t0, src._offset, 0.04);
  }

  /* body */
  {
    const b = osc(actx, 'sine', s.bodyF * jit);
    const g = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(2.5, 0.4), '2x');
    b.connect(g); series(g, drv).connect(out);
    sweep(b.frequency, t0, s.bodyF * jit * 1.6, s.bodyF * jit * 0.7, s.bodyDecay * 1.5);
    ad(g.gain, t0, 0.5 * e, 0.0015, s.bodyDecay * rng.range(0.85, 1.2));
    b.start(t0); b.stop(t0 + s.bodyDecay * 2.2 + 0.02);
    end = Math.max(end, t0 + s.bodyDecay * 2.2);
  }

  /* material texture */
  {
    const tx = s.tex;
    const src = bank.source(tx.kind, rng, rng.range(0.8, 1.3));
    const bp = biquad(actx, 'bandpass', tx.f * jit, tx.q);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    if (tx.rise) sweep(bp.frequency, t0, tx.f * 0.4, tx.f * 2.2, tx.decay);
    else sweep(bp.frequency, t0, tx.f * 1.5 * jit, tx.f * 0.6 * jit, tx.decay * 1.6);
    ad(g.gain, t0, tx.level * e, tx.rise ? 0.008 : 0.0015, tx.decay * rng.range(0.85, 1.25));
    src.start(t0, src._offset, tx.decay * 3 + 0.05);
    end = Math.max(end, t0 + tx.decay * 3);
  }

  /* resonant ring (metal / glass / wood) */
  if (s.ring) {
    const parts = [];
    for (const p of s.ring) {
      parts.push({
        f: p.f * semis(rng.range(-3, 3)),
        q: p.q * rng.range(0.8, 1.25),
        g: p.g * e,
        decay: p.decay * rng.range(0.75, 1.3),
      });
    }
    const r = struckResonator(actx, bank, rng, t0, parts, 0.0035);
    r.connect(out);
    end = Math.max(end, t0 + 0.4);
  }

  /* dust / powder cloud */
  if (s.dust) {
    const src = bank.source('white', rng, rng.range(0.7, 1.1));
    const lp = biquad(actx, 'lowpass', s.dust.f, 0.8);
    const g = gain(actx, 0);
    series(src, lp, g).connect(out);
    sweep(lp.frequency, t0, s.dust.f * 1.4, s.dust.f * 0.5, s.dust.decay);
    ad(g.gain, t0, s.dust.level * e, 0.02, s.dust.decay * rng.range(0.8, 1.3));
    src.start(t0, src._offset, s.dust.decay * 2 + 0.05);
    end = Math.max(end, t0 + s.dust.decay * 2);
  }

  /* debris grains — chips, splinters, glass shards landing */
  const grains = Math.round(s.grains * clamp(e, 0.3, 1.4));
  for (let i = 0; i < grains; i++) {
    const gt = t0 + rng.range(0.015, 0.06) + i * rng.range(0.01, 0.055);
    const r = struckResonator(actx, bank, rng, gt, [
      { f: rng.range(1800, 9000), q: rng.range(12, 30), g: rng.range(0.02, 0.05) * e, decay: rng.range(0.01, 0.05) },
    ], 0.0018);
    r.connect(out);
    end = Math.max(end, gt + 0.08);
  }

  /* water bubbles */
  if (s.bubbles) {
    for (let i = 0; i < 4; i++) {
      const bt = t0 + rng.range(0.02, 0.18);
      const b = osc(actx, 'sine', rng.range(400, 1400));
      const g = gain(actx, 0);
      b.connect(g); g.connect(out);
      sweep(b.frequency, bt, rng.range(350, 700), rng.range(900, 2200), 0.05);
      hit(g.gain, bt, rng.range(0.04, 0.1) * e, 0.05);
      b.start(bt); b.stop(bt + 0.12);
      end = Math.max(end, bt + 0.14);
    }
  }

  /* flesh squelch */
  if (s.wet_squelch) {
    const src = bank.source('pink', rng, rng.range(0.7, 1.1));
    const bp = biquad(actx, 'bandpass', 380, 2.2);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    sweep(bp.frequency, t0, 260, 900, 0.09);
    ad(g.gain, t0 + 0.004, 0.4 * e, 0.006, 0.1);
    src.start(t0, src._offset, 0.25);
  }

  return { node: out, end: end + 0.05, send: s.wet };
}

/* ------------------------------------------------------------------ */
/* Footsteps                                                          */
/* ------------------------------------------------------------------ */

/** Per-surface footstep character. */
const STEP = {
  concrete: { bodyF: 92, bodyDecay: 0.055, texKind: 'white', texF: 2100, texQ: 0.7, texDecay: 0.045, texLevel: 0.5, scuff: 0.35, grit: 4 },
  plaster:  { bodyF: 100, bodyDecay: 0.05, texKind: 'white', texF: 1800, texQ: 0.7, texDecay: 0.05, texLevel: 0.45, scuff: 0.3, grit: 4 },
  metal:    { bodyF: 120, bodyDecay: 0.05, texKind: 'white', texF: 3200, texQ: 1.0, texDecay: 0.04, texLevel: 0.5, scuff: 0.3, grit: 2,
    ring: [{ f: 620, q: 16, g: 0.24, decay: 0.16 }, { f: 1480, q: 20, g: 0.16, decay: 0.11 }, { f: 2900, q: 14, g: 0.08, decay: 0.06 }] },
  wood:     { bodyF: 110, bodyDecay: 0.06, texKind: 'white', texF: 1300, texQ: 0.8, texDecay: 0.04, texLevel: 0.4, scuff: 0.28, grit: 2,
    ring: [{ f: 260, q: 12, g: 0.26, decay: 0.09 }, { f: 540, q: 9, g: 0.14, decay: 0.05 }] },
  dirt:     { bodyF: 78, bodyDecay: 0.07, texKind: 'brown', texF: 620, texQ: 0.6, texDecay: 0.075, texLevel: 0.62, scuff: 0.45, grit: 6 },
  sand:     { bodyF: 70, bodyDecay: 0.06, texKind: 'white', texF: 1500, texQ: 0.45, texDecay: 0.14, texLevel: 0.6, scuff: 0.7, grit: 3 },
  glass:    { bodyF: 96, bodyDecay: 0.04, texKind: 'crackle', texF: 5200, texQ: 0.8, texDecay: 0.2, texLevel: 0.6, scuff: 0.3, grit: 9 },
  water:    { bodyF: 88, bodyDecay: 0.045, texKind: 'white', texF: 1600, texQ: 0.7, texDecay: 0.17, texLevel: 0.8, scuff: 0.5, grit: 3, splash: true },
  foliage:  { bodyF: 84, bodyDecay: 0.05, texKind: 'crackle', texF: 2400, texQ: 0.7, texDecay: 0.18, texLevel: 0.7, scuff: 0.5, grit: 6 },
  fabric:   { bodyF: 82, bodyDecay: 0.05, texKind: 'white', texF: 800, texQ: 0.6, texDecay: 0.05, texLevel: 0.3, scuff: 0.35, grit: 0 },
  flesh:    { bodyF: 86, bodyDecay: 0.055, texKind: 'white', texF: 520, texQ: 1.2, texDecay: 0.05, texLevel: 0.35, scuff: 0.2, grit: 0 },
  rubber:   { bodyF: 96, bodyDecay: 0.04, texKind: 'white', texF: 1000, texQ: 0.8, texDecay: 0.03, texLevel: 0.28, scuff: 0.2, grit: 0 },
};

/**
 * @param {object} o { when, surface, gait: 'walk'|'run'|'sprint'|'crouch'|'land',
 *                     level, gear (0..1), distance }
 */
export function footstep(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const s = STEP[o.surface] ?? STEP.concrete;
  const gait = o.gait ?? 'walk';
  const weight = gait === 'sprint' ? 1.25 : gait === 'run' ? 1.0 : gait === 'land' ? 1.7 : gait === 'crouch' ? 0.42 : 0.62;
  const lvl = (o.level ?? 1) * weight;
  const jit = semis(rng.range(-3, 3));
  const out = gain(actx, 0.32);  // VOICE TRIM
  let end = t0 + 0.3;

  /* heel/toe transient — two contacts, milliseconds apart, is what reads as a
     foot rather than a hammer. */
  const contacts = gait === 'land' ? 1 : 2;
  for (let c = 0; c < contacts; c++) {
    const ct = t0 + (c === 0 ? 0 : rng.range(0.012, 0.032));
    const cl = c === 0 ? 1 : rng.range(0.35, 0.6);

    const b = osc(actx, 'sine', s.bodyF * jit);
    const bg = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(1.8, 0.5), '2x');
    b.connect(bg); series(bg, drv).connect(out);
    sweep(b.frequency, ct, s.bodyF * jit * 1.7, s.bodyF * jit * 0.75, s.bodyDecay * 1.4);
    ad(bg.gain, ct, 0.42 * lvl * cl, 0.0025, s.bodyDecay * rng.range(0.85, 1.2));
    b.start(ct); b.stop(ct + s.bodyDecay * 2.4 + 0.02);

    const src = bank.source(s.texKind, rng, rng.range(0.8, 1.25));
    const bp = biquad(actx, 'bandpass', s.texF * jit, s.texQ);
    const tg = gain(actx, 0);
    series(src, bp, tg).connect(out);
    sweep(bp.frequency, ct, s.texF * 1.4 * jit, s.texF * 0.55 * jit, s.texDecay * 2);
    ad(tg.gain, ct, s.texLevel * lvl * cl, 0.002, s.texDecay * rng.range(0.8, 1.3));
    src.start(ct, src._offset, s.texDecay * 3 + 0.05);
    end = Math.max(end, ct + s.texDecay * 3);

    if (s.ring && c === 0) {
      const parts = s.ring.map((p) => ({
        f: p.f * semis(rng.range(-2, 2)), q: p.q * rng.range(0.85, 1.2),
        g: p.g * lvl, decay: p.decay * rng.range(0.8, 1.25),
      }));
      struckResonator(actx, bank, rng, ct, parts, 0.003).connect(out);
      end = Math.max(end, ct + 0.3);
    }
  }

  /* scuff — the slide of the sole, longer when running */
  if (s.scuff > 0.05) {
    const st = t0 + rng.range(0.01, 0.04);
    const dur = (gait === 'sprint' ? 0.13 : gait === 'run' ? 0.1 : 0.07) * rng.range(0.8, 1.3);
    const src = bank.source('white', rng, rng.range(0.85, 1.2));
    const bp = biquad(actx, 'bandpass', rng.range(2200, 4200), 0.8);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    sweep(bp.frequency, st, rng.range(2800, 4600), rng.range(1200, 2000), dur);
    ad(g.gain, st, s.scuff * lvl * 0.5, 0.012, dur);
    src.start(st, src._offset, dur * 2);
    end = Math.max(end, st + dur * 2);
  }

  /* grit grains */
  for (let i = 0; i < s.grit; i++) {
    if (rng.float() > 0.55) continue;
    const gt = t0 + rng.range(0.004, 0.09);
    struckResonator(actx, bank, rng, gt, [
      { f: rng.range(2400, 9000), q: rng.range(10, 26), g: rng.range(0.015, 0.05) * lvl, decay: rng.range(0.008, 0.03) },
    ], 0.0015).connect(out);
  }

  /* water splash */
  if (s.splash) {
    const src = bank.source('white', rng, rng.range(0.9, 1.2));
    const bp = biquad(actx, 'bandpass', 900, 0.7);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    sweep(bp.frequency, t0, 700, 3400, 0.16);
    ad(g.gain, t0 + 0.006, 0.45 * lvl, 0.01, 0.2);
    src.start(t0, src._offset, 0.4);
    end = Math.max(end, t0 + 0.42);
  }

  /* gear: sling swivels, mag pouches, buckles — only when moving fast */
  const gear = (o.gear ?? (gait === 'sprint' ? 1 : gait === 'run' ? 0.7 : gait === 'land' ? 0.9 : 0.25));
  if (gear > 0.05) {
    const n = 1 + ((rng.u32() % 3) | 0);
    for (let i = 0; i < n; i++) {
      const gt = t0 + rng.range(0.005, 0.11);
      struckResonator(actx, bank, rng, gt, [
        { f: rng.range(1600, 4200), q: rng.range(18, 40), g: rng.range(0.03, 0.1) * gear * lvl, decay: rng.range(0.03, 0.12) },
        { f: rng.range(4200, 8000), q: rng.range(12, 26), g: rng.range(0.01, 0.04) * gear * lvl, decay: rng.range(0.01, 0.05) },
      ], 0.002).connect(out);
      end = Math.max(end, gt + 0.18);
    }
    // Cloth/webbing rustle.
    const src = bank.source('white', rng, rng.range(0.7, 1.1));
    const bp = biquad(actx, 'bandpass', rng.range(1400, 2600), 0.6);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    ad(g.gain, t0, 0.09 * gear * lvl, 0.02, 0.13);
    src.start(t0, src._offset, 0.3);
  }

  return { node: out, end: end + 0.05, send: 0.3 };
}

/** Cloth movement, used for stance changes and ADS. */
export function cloth(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const lvl = o.level ?? 1;
  const out = gain(actx, 1);
  const dur = rng.range(0.13, 0.26);
  const src = bank.source('white', rng, rng.range(0.7, 1.15));
  const bp = biquad(actx, 'bandpass', rng.range(1300, 2400), 0.55);
  const g = gain(actx, 0);
  series(src, bp, g).connect(out);
  sweep(bp.frequency, t0, rng.range(1000, 1600), rng.range(2200, 3400), dur);
  ad(g.gain, t0, 0.3 * lvl, 0.03, dur);
  src.start(t0, src._offset, dur * 2);
  if (rng.float() < 0.6) {
    struckResonator(actx, bank, rng, t0 + rng.range(0.02, 0.1), [
      { f: rng.range(2200, 5200), q: 26, g: 0.05 * lvl, decay: rng.range(0.03, 0.09) },
    ], 0.002).connect(out);
  }
  return { node: out, end: t0 + dur * 2 + 0.15, send: 0.2 };
}

/* ------------------------------------------------------------------ */
/* Melee                                                              */
/* ------------------------------------------------------------------ */

/**
 * KNIFE SWING — the whoosh, which is not one sound either.
 *
 * A blade moving past the ear is a narrow band of turbulence whose centre
 * frequency tracks the tip's speed, so the band RISES into the fastest part of
 * the arc and falls out of it. That Doppler-ish sweep is the entire cue; a flat
 * noise burst reads as a bag of sand, not as an edge. Under it goes the sleeve
 * and the sling, which is what tells you a body did this rather than a machine.
 *
 * `kind` — 'slash' is fast, wide, bright; 'stab' is slower, shorter travel,
 * darker, and much quieter, because a thrust barely moves any air.
 *
 * @param {object} o { when, kind, level }
 */
export function meleeSwing(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const stab = o.kind === 'stab';
  const lvl = (o.level ?? 1) * (stab ? 0.62 : 1);
  const out = gain(actx, 1.4); // VOICE TRIM
  const dur = (stab ? 0.15 : 0.2) * rng.range(0.9, 1.12);

  // The blade. Bandpass up and back down over the arc; Q is high enough that it
  // is a *tone* rather than a hiss, which is what makes it read as steel.
  const src = bank.source('white', rng, rng.range(0.85, 1.25));
  const bp = biquad(actx, 'bandpass', 900, 2.6);
  const g = gain(actx, 0);
  series(src, bp, g).connect(out);
  const peak = (stab ? rng.range(1900, 2600) : rng.range(3100, 4400));
  bp.frequency.setValueAtTime(peak * 0.4, t0);
  bp.frequency.exponentialRampToValueAtTime(peak, t0 + dur * 0.55);
  bp.frequency.exponentialRampToValueAtTime(peak * 0.45, t0 + dur);
  // Asymmetric envelope: air builds slowly and stops the instant the arm does.
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.85 * lvl, t0 + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur * 1.15);
  src.start(t0, src._offset, dur * 1.4 + 0.05);

  // Sleeve/harness. Broader, lower, and it starts BEFORE the blade because the
  // shoulder moves before the tip does.
  const cs = bank.source('pink', rng, rng.range(0.7, 1.1));
  const cbp = biquad(actx, 'bandpass', rng.range(700, 1250), 0.7);
  const cg = gain(actx, 0);
  series(cs, cbp, cg).connect(out);
  ad(cg.gain, t0, 0.22 * lvl, 0.03, dur * 0.9);
  cs.start(t0, cs._offset, dur * 2);

  return { node: out, end: t0 + dur * 1.5 + 0.05, send: 0.14 };
}

/**
 * KNIFE IMPACT. Two completely different events sharing one entry point,
 * because what the blade hits is the only thing that decides what it sounds
 * like — and getting a wall to sound like a torso is the classic melee bug.
 *
 *  FLESH  — a damped low thump (the body absorbing the arm behind the blade),
 *           a wet mid burst that dies fast because tissue has no ring at all,
 *           and a short high "shhk" of the edge parting fabric on the way in.
 *           NOTHING resonates.
 *  HARD   — the opposite: almost no body, a violent bright transient, a ringing
 *           high partial as the blade rebounds, and a scrape as it skates off.
 *           Concrete grits, metal rings, wood knocks.
 *
 * @param {object} o { when, surface, level, kind }
 */
export function meleeHit(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const surface = o.surface ?? 'flesh';
  const lvl = o.level ?? 1;
  // VOICE TRIM. Flesh is all sub and hard surfaces are all top, so one trim
  // cannot serve both: measured through the offline render, a single 1.5 put a
  // knife into a torso at peak 0.70 — LOUDER than a rifle at two metres (0.45)
  // — while the same trim left concrete at 0.14.
  const out = gain(actx, surface === 'flesh' ? 1.0 : 2.4);
  let end = t0 + 0.25;

  if (surface === 'flesh') {
    // 1 — the thump. A body is a bag of water: it takes the energy and gives
    // nothing back, so this is a fast sine drop with no tail.
    const b = osc(actx, 'sine', 168);
    const bg = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(3.5, 0.45), '2x');
    b.connect(bg);
    series(bg, drv).connect(out);
    sweep(b.frequency, t0, 210 * semis(rng.range(-2, 2)), 74, 0.07);
    ad(bg.gain, t0, 0.62 * lvl, 0.0015, 0.075);
    b.start(t0); b.stop(t0 + 0.2);

    // 2 — the wet mid. Lowpassed noise falling hard; the sweep is what makes it
    // sound saturated with fluid rather than dusty.
    const s = bank.source('pink', rng, rng.range(0.8, 1.2));
    const lp = biquad(actx, 'lowpass', 1500, 1.1);
    const g = gain(actx, 0);
    series(s, lp, g).connect(out);
    sweep(lp.frequency, t0, rng.range(1500, 2100), 340, 0.09);
    ad(g.gain, t0, 0.55 * lvl, 0.0018, 0.085);
    s.start(t0, s._offset, 0.28);

    // 3 — the edge through cloth and skin. Brief, bright, and slightly late.
    const et = t0 + rng.range(0.004, 0.014);
    const es = bank.source('white', rng, rng.range(0.9, 1.35));
    const ebp = biquad(actx, 'bandpass', rng.range(3400, 5200), 1.5);
    const eg = gain(actx, 0);
    series(es, ebp, eg).connect(out);
    sweep(ebp.frequency, et, rng.range(4600, 6200), rng.range(2200, 3000), 0.055);
    ad(eg.gain, et, 0.3 * lvl, 0.003, 0.05);
    es.start(et, es._offset, 0.16);
    end = t0 + 0.32;
    return { node: out, end, send: 0.22 };
  }

  // ---- hard surfaces ------------------------------------------------------
  // Per-surface partials for the rebound ring, and how much of it survives.
  const RING = {
    metal: { f: [2900, 5400, 8300], q: 40, decay: 0.34, ring: 1.0, grit: 0.45, thump: 0.28 },
    concrete: { f: [1900, 3600, 6100], q: 12, decay: 0.055, ring: 0.5, grit: 1.0, thump: 0.5 },
    plaster: { f: [1500, 2800, 4600], q: 8, decay: 0.04, ring: 0.32, grit: 0.85, thump: 0.55 },
    glass: { f: [3600, 6400, 9200], q: 34, decay: 0.2, ring: 0.9, grit: 0.5, thump: 0.2 },
    wood: { f: [900, 1750, 3100], q: 11, decay: 0.075, ring: 0.6, grit: 0.5, thump: 0.7 },
    rubber: { f: [520, 1100, 1900], q: 6, decay: 0.03, ring: 0.16, grit: 0.3, thump: 0.85 },
    fabric: { f: [700, 1400, 2400], q: 5, decay: 0.025, ring: 0.1, grit: 0.35, thump: 0.7 },
    dirt: { f: [600, 1200, 2100], q: 5, decay: 0.03, ring: 0.08, grit: 0.9, thump: 0.75 },
    sand: { f: [700, 1300, 2200], q: 4, decay: 0.025, ring: 0.06, grit: 1.0, thump: 0.6 },
    foliage: { f: [1800, 3200, 5400], q: 6, decay: 0.04, ring: 0.12, grit: 1.1, thump: 0.25 },
    water: { f: [500, 1000, 1800], q: 5, decay: 0.03, ring: 0.1, grit: 0.8, thump: 0.45 },
  };
  const R = RING[surface] ?? RING.concrete;

  // 1 — the strike itself: a hard transient with the blade's own pitch in it.
  const s = bank.source('white', rng, rng.range(0.9, 1.4));
  const hp = biquad(actx, 'highpass', 1400, 0.7);
  const g = gain(actx, 0);
  series(s, hp, g).connect(out);
  hit(g.gain, t0, 0.95 * lvl, 0.009);
  s.start(t0, s._offset, 0.06);

  // 2 — the rebound ring. This is the whole difference between surfaces.
  const jitter = semis(rng.range(-1.5, 1.5));
  struckResonator(actx, bank, rng, t0, [
    { f: R.f[0] * jitter, q: R.q, g: 0.55 * lvl * R.ring, decay: R.decay },
    { f: R.f[1] * jitter, q: R.q * 0.8, g: 0.3 * lvl * R.ring, decay: R.decay * 0.6 },
    { f: R.f[2] * jitter, q: R.q * 0.55, g: 0.14 * lvl * R.ring, decay: R.decay * 0.35 },
  ], 0.0025).connect(out);

  // 3 — body: the mass behind the arm arriving. Small, but its absence is what
  // makes a knife on a wall sound like a coin on a table.
  const b = osc(actx, 'sine', 210 * jitter);
  const bg = gain(actx, 0);
  b.connect(bg); bg.connect(out);
  sweep(b.frequency, t0, 260 * jitter, 110, 0.05);
  ad(bg.gain, t0, 0.42 * lvl * R.thump, 0.0015, 0.05);
  b.start(t0); b.stop(t0 + 0.14);

  // 4 — the skate. The edge does not stop where it lands; it slides, and the
  // band falls as it loses speed.
  const gt = t0 + rng.range(0.006, 0.018);
  const gs = bank.source('white', rng, rng.range(0.8, 1.3));
  const gbp = biquad(actx, 'bandpass', 4200, 1.2);
  const gg = gain(actx, 0);
  series(gs, gbp, gg).connect(out);
  const gd = rng.range(0.05, 0.11);
  sweep(gbp.frequency, gt, rng.range(4800, 7000), rng.range(1600, 2600), gd);
  ad(gg.gain, gt, 0.26 * lvl * R.grit, 0.004, gd);
  gs.start(gt, gs._offset, gd * 2 + 0.05);

  return { node: out, end: t0 + Math.max(0.3, R.decay * 3), send: 0.18 };
}

/* ------------------------------------------------------------------ */
/* Shell casings                                                      */
/* ------------------------------------------------------------------ */

/**
 * A casing bounces 2–4 times with shortening intervals and then rolls. Brass on
 * concrete is one of the most recognisable sounds in a shooter; the trick is
 * that each bounce is a *different* set of partials because the shell lands on a
 * different part of itself.
 */
export function shellCasing(actx, bank, rng, o = {}) {
  const t0 = (o.when ?? actx.currentTime) + (o.flight ?? rng.range(0.28, 0.52));
  const surface = o.surface ?? 'concrete';
  const hard = surface === 'metal' || surface === 'concrete' || surface === 'glass' || surface === 'plaster';
  const soft = surface === 'dirt' || surface === 'sand' || surface === 'foliage' || surface === 'fabric';
  const out = gain(actx, 1);
  const base = rng.range(2650, 4200);
  let t = t0;
  let amp = (o.level ?? 1) * (soft ? 0.35 : 1) * rng.range(0.8, 1.1);
  const bounces = soft ? 1 : 2 + ((rng.u32() % 3) | 0);
  let end = t0;
  for (let i = 0; i < bounces; i++) {
    const detune = semis(rng.range(-4, 4));
    struckResonator(actx, bank, rng, t, [
      { f: base * detune, q: rng.range(30, 60), g: 0.95 * amp, decay: rng.range(0.05, 0.13) * (hard ? 1 : 0.5) },
      { f: base * detune * 1.87, q: rng.range(24, 44), g: 0.58 * amp, decay: rng.range(0.03, 0.08) },
      { f: base * detune * 3.1, q: rng.range(16, 30), g: 0.3 * amp, decay: rng.range(0.015, 0.04) },
      { f: base * detune * 0.42, q: 12, g: 0.2 * amp, decay: 0.03 },
    ], 0.0015).connect(out);
    end = t + 0.2;
    t += rng.range(0.045, 0.13) * (i === 0 ? 1 : 0.6);
    amp *= rng.range(0.38, 0.62);
    if (amp < 0.03) break;
  }
  // Roll: a stream of very quiet, very short pings.
  if (hard && rng.float() < 0.55) {
    const rolls = 3 + ((rng.u32() % 5) | 0);
    for (let i = 0; i < rolls; i++) {
      const rt = t + i * rng.range(0.018, 0.05);
      struckResonator(actx, bank, rng, rt, [
        { f: base * semis(rng.range(-5, 5)), q: rng.range(20, 44), g: rng.range(0.03, 0.09) * (o.level ?? 1), decay: rng.range(0.01, 0.03) },
      ], 0.0012).connect(out);
      end = Math.max(end, rt + 0.06);
    }
  }
  return { node: out, end: end + 0.05, send: 0.189 };
}

/* ------------------------------------------------------------------ */
/* Reload foley                                                       */
/* ------------------------------------------------------------------ */

/**
 * Reload mechanics, one call per `weapon:reload` phase. Keeping the phases as
 * separate one-shots (instead of one long sound) is what lets the audio stay
 * locked to the animation whatever its length.
 */
/** The four phases are wildly different in energy; level them per phase. */
const RELOAD_TRIM = { start: 3.2, magout: 3.0, magin: 1.0, end: 1.5 };

/**
 * ACTION TYPE, and the reason it exists: every gun in the game reloaded with
 * one recipe scaled by a `heavy` multiplier, so an AKM and an M4A1 were the
 * same sound played 0% louder.
 *
 * They are not the same mechanism. An AR magazine goes STRAIGHT UP into the
 * well and the bolt catch drops the carrier with a paddle. An AK magazine
 * ROCKS: the front lug goes in first, then the body swings back until the catch
 * behind it snaps over — two distinct clacks with a gap, not one — the body is
 * stamped steel rather than polymer so it RINGS, and there is no bolt catch at
 * all, so an empty reload ends with the charging handle dragged all the way to
 * the rear and let go. A bolt gun's 5-round steel box is a fraction of the
 * mass, seats with a small click, and needs no charging handle whatsoever
 * because the bolt was closed the whole time.
 *
 *   mag   0 = polymer (thunk, dead), 1 = stamped steel (ring)
 *   rock  seconds between the front lug and the rear catch; 0 = straight insert
 *   charge  what the 'end' phase is: 'paddle' | 'handle' | 'none'
 *   mass  scales the low end of every seat/stop, the old `heavy`
 */
const RELOAD_ACTION = {
  ar: { mag: 0.15, rock: 0, charge: 'paddle', mass: 1 },
  ak: { mag: 0.9, rock: 0.115, charge: 'handle', mass: 1.12 },
  bolt: { mag: 0.75, rock: 0, charge: 'none', mass: 0.6 },
  heavy: { mag: 0.4, rock: 0, charge: 'paddle', mass: 1.35 },
};

export function reloadPhase(actx, bank, rng, phase, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const A = RELOAD_ACTION[o.action] ?? RELOAD_ACTION.ar;
  const heavy = (o.heavy ?? 1) * A.mass; // LMG/shotgun = heavier hardware
  const out = gain(actx, 0.42 * (RELOAD_TRIM[phase] ?? 1.5)); // VOICE TRIM
  let end = t0 + 0.3;
  const metal = (t, parts, exc = 0.0025) => {
    struckResonator(actx, bank, rng, t, parts, exc).connect(out);
    end = Math.max(end, t + 0.35);
  };
  const rustle = (t, dur, level, f) => {
    const src = bank.source('white', rng, rng.range(0.8, 1.2));
    const bp = biquad(actx, 'bandpass', f, 0.6);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    ad(g.gain, t, level, 0.02, dur);
    src.start(t, src._offset, dur * 2 + 0.05);
    end = Math.max(end, t + dur * 2);
  };

  switch (phase) {
    case 'start':
      // Hand leaves the grip, palm slaps the magwell, mag catch is pressed.
      rustle(t0, 0.18, 0.2, rng.range(1400, 2200));
      metal(t0 + rng.range(0.04, 0.08), [
        { f: 2450 * semis(rng.range(-2, 2)), q: 30, g: 0.55 * heavy, decay: 0.03 },
        { f: 5100, q: 18, g: 0.25, decay: 0.016 },
        { f: 780, q: 10, g: 0.3 * heavy, decay: 0.045 },
      ]);
      break;

    case 'magout': {
      // Spring release, mag scrapes out of the well, then plastic hits the deck.
      metal(t0, [
        { f: 1650 * semis(rng.range(-2, 2)), q: 24, g: 0.65 * heavy, decay: 0.05 },
        { f: 3400, q: 16, g: 0.35, decay: 0.025 },
      ]);
      const st = t0 + 0.03;
      const src = bank.source('white', rng, rng.range(0.9, 1.3));
      const bp = biquad(actx, 'bandpass', 3200, 1.1);
      const g = gain(actx, 0);
      series(src, bp, g).connect(out);
      sweep(bp.frequency, st, 4200, 1600, 0.12);
      ad(g.gain, st, 0.2, 0.01, 0.12);
      src.start(st, src._offset, 0.3);
      // An AK magazine does not drop free: the catch is behind it, so the body
      // is rocked FORWARD off the lug first. That is an extra clack before the
      // mag ever leaves the well, and it is the most recognisable part.
      if (A.rock > 0) {
        metal(t0 + A.rock * 0.45, [
          { f: 1980 * semis(rng.range(-2, 2)), q: 18, g: 0.4 * heavy, decay: 0.035 },
          { f: 4200, q: 12, g: 0.16, decay: 0.018 },
        ], 0.003);
      }
      // Empty magazine hitting the deck. Polymer is a dead thunk; stamped steel
      // rings for a fifth of a second and is the AK's signature.
      const dt = t0 + rng.range(0.16, 0.3);
      const ring = A.mag;
      metal(dt, [
        { f: 480 * semis(rng.range(-3, 3)), q: 9 + ring * 16, g: 0.2, decay: 0.05 + ring * 0.06 },
        { f: 1180, q: 7 + ring * 20, g: 0.11 + ring * 0.1, decay: 0.03 + ring * 0.1 },
        { f: 2600, q: 5 + ring * 34, g: 0.05 + ring * 0.11, decay: 0.015 + ring * 0.16 },
      ], 0.004);
      if (ring > 0.4) {
        // the sheet-steel body itself, high and long — pure AK
        metal(dt + 0.006, [
          { f: 4900 * semis(rng.range(-3, 3)), q: 54, g: 0.09 * ring, decay: 0.26 * ring },
          { f: 7300, q: 40, g: 0.05 * ring, decay: 0.17 * ring },
        ], 0.002);
        end = Math.max(end, dt + 0.45);
      }
      end = Math.max(end, dt + 0.3);
      break;
    }

    case 'magin': {
      // Fresh mag guided in, seated with a palm strike: a low thunk plus a sharp
      // latch click. The thunk needs real low end or it feels weightless.
      rustle(t0, 0.12, 0.16, rng.range(1200, 2000));
      const it = t0 + rng.range(0.05, 0.1);
      const b = osc(actx, 'sine', 190 * heavy);
      const bg = gain(actx, 0);
      const drv = shaper(actx, saturationCurve(3, 0.5), '2x');
      b.connect(bg); series(bg, drv).connect(out);
      sweep(b.frequency, it, 230 * heavy, 110 * heavy, 0.06);
      ad(bg.gain, it, 0.4 * heavy, 0.002, 0.055);
      b.start(it); b.stop(it + 0.16);
      metal(it, [
        { f: 1250 * semis(rng.range(-2, 2)), q: 20, g: 0.3 * heavy, decay: 0.06 },
        { f: 2800, q: 26, g: 0.18, decay: 0.03 },
        { f: 6200, q: 14, g: 0.07, decay: 0.012 },
      ], 0.003);
      metal(it + rng.range(0.02, 0.05), [
        { f: 3600, q: 34, g: 0.16, decay: 0.02 },
        { f: 7400, q: 20, g: 0.07, decay: 0.01 },
      ], 0.0015);
      // THE ROCK. On an AK the front lug goes in, the body swings back, and the
      // catch snaps over it — a second, harder, LOWER clack `A.rock` later. On
      // an AR there is nothing here at all, and that gap is the whole tell.
      if (A.rock > 0) {
        const rt = it + A.rock * rng.range(0.9, 1.15);
        metal(rt, [
          { f: 960 * semis(rng.range(-1.5, 1.5)), q: 15, g: 0.5 * heavy, decay: 0.07 },
          { f: 2150, q: 22, g: 0.28 * heavy, decay: 0.035 },
          { f: 5200, q: 30, g: 0.09, decay: 0.02 },
        ], 0.004);
        const rb = osc(actx, 'sine', 150);
        const rg = gain(actx, 0);
        rb.connect(rg); rg.connect(out);
        sweep(rb.frequency, rt, 185, 92, 0.05);
        ad(rg.gain, rt, 0.3 * heavy, 0.0015, 0.05);
        rb.start(rt); rb.stop(rt + 0.14);
        end = Math.max(end, rt + 0.35);
      }
      break;
    }

    case 'end':
    default: {
      /**
       * What ENDS a reload is a property of the action, not a volume knob.
       *
       *  paddle  AR: thumb hits the bolt release and the carrier is thrown
       *          forward by the spring. One short scrape, one slam.
       *  handle  AK: no bolt catch exists, so the handle is dragged the full
       *          length of the receiver and released — a LONG scrape, a hard
       *          rearward stop, then the slam. Twice the sound of a paddle.
       *  none    bolt gun: the bolt was closed the whole time. There is nothing
       *          to charge, so this is a hand settling back onto the grip.
       */
      if (A.charge === 'none') {
        rustle(t0, 0.16, 0.15, rng.range(900, 1600));
        metal(t0 + rng.range(0.05, 0.09), [
          { f: 1350 * semis(rng.range(-2, 2)), q: 14, g: 0.16 * heavy, decay: 0.035 },
          { f: 3050, q: 10, g: 0.07, decay: 0.018 },
        ], 0.0025);
        break;
      }
      const st = t0;
      if (A.charge === 'handle') {
        // the full rearward drag, and the bolt hitting the back of the receiver
        const hs = bank.source('white', rng, rng.range(0.85, 1.2));
        const hbp = biquad(actx, 'bandpass', 2000, 2.0);
        const hg = gain(actx, 0);
        series(hs, hbp, hg).connect(out);
        sweep(hbp.frequency, st, 3000, 1500, 0.13);
        ad(hg.gain, st, 0.3, 0.012, 0.13);
        hs.start(st, hs._offset, 0.35);
        metal(st + 0.13, [
          { f: 1520 * semis(rng.range(-2, 2)), q: 20, g: 0.5 * heavy, decay: 0.05 },
          { f: 3400, q: 14, g: 0.2, decay: 0.022 },
          { f: 690, q: 8, g: 0.26 * heavy, decay: 0.06 },
        ], 0.004);
      }
      const src = bank.source('white', rng, rng.range(0.9, 1.25));
      const bp = biquad(actx, 'bandpass', 2600, 1.6);
      const g = gain(actx, 0);
      series(src, bp, g).connect(out);
      sweep(bp.frequency, st, 1800, 4200, 0.07);
      ad(g.gain, st, 0.24, 0.008, 0.07);
      src.start(st, src._offset, 0.2);
      metal(st + 0.06, [
        { f: 1450 * semis(rng.range(-2, 2)), q: 22, g: 0.3 * heavy, decay: 0.05 },
        { f: 3100, q: 18, g: 0.16, decay: 0.022 },
      ]);
      // Spring ring — the metallic "zing" behind the clack.
      metal(st + 0.065, [
        { f: 4900 * semis(rng.range(-3, 3)), q: 46, g: 0.09, decay: 0.16 },
        { f: 7200, q: 38, g: 0.05, decay: 0.1 },
      ], 0.002);
      const bt = st + (A.charge === 'handle' ? 0.17 : 0) + rng.range(0.1, 0.15);
      const b = osc(actx, 'sine', 150 * heavy);
      const bg = gain(actx, 0);
      b.connect(bg); bg.connect(out);
      sweep(b.frequency, bt, 200 * heavy, 90 * heavy, 0.05);
      ad(bg.gain, bt, 0.38 * heavy, 0.0015, 0.05);
      b.start(bt); b.stop(bt + 0.14);
      metal(bt, [
        { f: 1750, q: 20, g: 0.34 * heavy, decay: 0.05 },
        { f: 3900, q: 15, g: 0.15, decay: 0.02 },
        { f: 8200, q: 10, g: 0.05, decay: 0.008 },
      ], 0.0035);
      break;
    }
  }
  return { node: out, end: end + 0.05, send: 0.3 };
}

/* ------------------------------------------------------------------ */
/* Explosions                                                         */
/* ------------------------------------------------------------------ */

/**
 * @param {object} o { when, distance, radius, level }
 * Near: a violent transient, a huge sub sweep and a bright shrapnel spatter.
 * Far: almost no transient, a long rolling low rumble, and a big wet tail.
 */
export function explosion(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const dist = Math.max(0, o.distance ?? 0);
  const size = clamp((o.radius ?? 6) / 6, 0.5, 2.4);
  const near = clamp(1 - dist / 70, 0, 1);
  const far = 1 - near;
  const lvl = (o.level ?? 1) * size;
  /**
   * VOICE TRIM 0.42 -> 0.88.
   *
   * Closing the reverb send from 0.85 to 0.26 took level with it — MEASURED on
   * `explosion:airstrike`, peak 0.846 -> 0.620 and rms 0.0699 -> 0.0491, i.e. the
   * blast got 3.1 dB SMALLER, which is the opposite of what was asked for. The
   * send was carrying half the level, exactly as the mixer's own note says it was
   * for footsteps. Paying it back with dry signal instead of tail is the whole
   * point, and there is room to do it: nothing in the suite peaked above 0.86 and
   * the send cut alone bought 0.23 of headroom.
   */
  const out = gain(actx, 0.88); // VOICE TRIM
  let end = t0 + 1;

  /* detonation transient */
  if (near > 0.05) {
    const src = bank.source('white', rng, rng.range(0.9, 1.2));
    const hp = biquad(actx, 'highpass', 1800, 0.6);
    const drv = shaper(actx, saturationCurve(14, 0.7), '4x');
    const g = gain(actx, 0);
    series(src, hp, drv, g).connect(out);
    hit(g.gain, t0, 0.85 * near * lvl, 0.02);
    src.start(t0, src._offset, 0.1);
  }

  /* sub-bass impact: the thing you feel in your chest */
  {
    const s = osc(actx, 'sine', 110);
    const s2 = osc(actx, 'triangle', 62);
    const g = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(4, 0.6), '2x');
    const lp = biquad(actx, 'lowpass', 220, 0.9);
    s.connect(g); s2.connect(g);
    series(g, drv, lp).connect(out);
    const subDur = (0.55 + size * 0.35) * rng.range(0.9, 1.15);
    sweep(s.frequency, t0, 130 * size, 26, subDur);
    sweep(s2.frequency, t0, 74 * size, 21, subDur * 1.2);
    ad(g.gain, t0, 1.0 * lvl * (0.55 + near * 0.6), 0.008 + far * 0.05, subDur);
    s.start(t0); s2.start(t0);
    s.stop(t0 + subDur * 1.6); s2.stop(t0 + subDur * 1.6);
    end = Math.max(end, t0 + subDur * 1.6);

    /**
     * SECOND SUB STAGE — the one that outlives the crack.
     *
     * 「空爆の音をちゃんとリアルに大きく表現すること」. The stage above is a 0.9-1.4 s
     * chest thump, and for a 6 m frag that is the whole event; for the 15 m
     * airstrike it is not, because what makes a big charge big is not a louder
     * transient, it is that the low end is STILL THERE seconds later. So the
     * bigger the charge, the longer a second, much deeper sine runs underneath
     * it, sweeping from just under the first stage's floor down to 14 Hz.
     *
     * It shares the saturator's job with nothing: it is fed through its own soft
     * clip, and because both stages are tanh-limited, adding it costs far less
     * peak than it adds duration. MEASURED on `explosion:airstrike`, dry:
     * d20 0.72 -> 1.66 s, d40 1.06 -> 2.53 s, peak 0.283 -> 0.309.
     *
     * It is gated on `size > 0.9` (radius > ~5.4 m) so a grenade is unchanged.
     */
    if (size > 0.9) {
      const big = clamp((size - 0.9) / 1.5, 0, 1);
      const rollDur = (1.5 + big * 2.6) * rng.range(0.92, 1.1);
      const s3 = osc(actx, 'sine', 40);
      const g3 = gain(actx, 0);
      const drv3 = shaper(actx, saturationCurve(2.2, 0.45), '2x');
      const lp3 = biquad(actx, 'lowpass', 120, 0.8);
      series(s3, drv3, g3, lp3).connect(out);
      sweep(s3.frequency, t0, 46 * rng.range(0.9, 1.1), 14, rollDur * 0.85);
      // Slow attack: the overpressure arrives after the crack, not with it.
      ad(g3.gain, t0 + 0.02, (0.42 + big * 0.5) * lvl * (0.5 + near * 0.55), 0.07, rollDur);
      s3.start(t0);
      s3.stop(t0 + rollDur * 1.5);
      end = Math.max(end, t0 + rollDur * 1.5);
    }
  }

  /* blast body: broadband noise under a fast-falling lowpass */
  {
    const dur = (0.45 + size * 0.5) * (1 + far * 1.8);
    const src = bank.source('brown', rng, rng.range(0.6, 1.1));
    const lp = biquad(actx, 'lowpass', 6000, 0.8);
    const drv = shaper(actx, saturationCurve(6, 0.5), '2x');
    const g = gain(actx, 0);
    series(src, lp, drv, g).connect(out);
    sweep(lp.frequency, t0, lerp(7000, 700, far), lerp(260, 130, far), dur);
    ad(g.gain, t0, 0.8 * lvl, 0.01 + far * 0.06, dur);
    src.start(t0, src._offset, dur * 1.4 + 0.1);
    end = Math.max(end, t0 + dur * 1.4);
  }

  /* debris / shrapnel: grains scattered over the following second */
  const grains = Math.round(lerp(26, 4, far) * size);
  for (let i = 0; i < grains; i++) {
    const gt = t0 + rng.range(0.02, 0.9) * rng.range(0.3, 1);
    struckResonator(actx, bank, rng, gt, [
      { f: rng.range(700, 7000), q: rng.range(8, 32), g: rng.range(0.02, 0.09) * near * lvl, decay: rng.range(0.01, 0.09) },
    ], 0.002).connect(out);
    end = Math.max(end, gt + 0.15);
  }

  /* dust and settling */
  {
    const dur = 1.0 + size * 0.8;
    const src = bank.source('pink', rng, rng.range(0.5, 0.9));
    const lp = biquad(actx, 'lowpass', 1400, 0.7);
    const g = gain(actx, 0);
    series(src, lp, g).connect(out);
    sweep(lp.frequency, t0, 1600, 320, dur);
    ad(g.gain, t0 + 0.05, 0.2 * lvl * (0.4 + near * 0.6), 0.12, dur);
    src.start(t0 + 0.05, src._offset, dur * 1.3);
    end = Math.max(end, t0 + dur * 1.3);
  }

  /**
   * THE ROLL — a synthesised tail, so the send can be closed.
   *
   * 「爆撃音など…リバーブはなるべく無くして」 and "the size has to come from the
   * source" are the same instruction, and the send below is where the size used
   * to come from: `explosion` returned 0.85-1.35, four to eleven times any other
   * voice in the game, and MEASURED it was carrying 53 % of the whole event's
   * energy (rms 0.0699 wet vs 0.0330 dry on `explosion:airstrike`). That is not
   * a blast with a room around it, that is a room doing the blast's job.
   *
   * What a real one actually has after the crack is the report rolling back off
   * whatever is standing nearby — discrete, arriving late, and progressively
   * darker each time round. Two things replace the send:
   *
   *   ROLL   brown noise under a lowpass that closes from 700 Hz to 60 Hz over
   *          1.5-4.5 s depending on size. Continuous, quiet, and long.
   *   SLAPS  two or three DISCRETE returns at 90-420 ms, each one darker and
   *          quieter than the last, jittered per blast. These are the ones the
   *          ear reads as "there are buildings here" — a convolver's smooth
   *          exponential cannot say that, which is why it just sounds wet.
   *
   * Both scale with `size`, so a grenade gets a short bark and the airstrike gets
   * the four-second roll the player asked for.
   */
  {
    const big = clamp(size / 2.4, 0.12, 1);
    const rollDur = (1.1 + big * 3.4) * rng.range(0.9, 1.12);
    const src = bank.source('brown', rng, rng.range(0.4, 0.75));
    const hp = biquad(actx, 'highpass', 34, 0.7);
    const lp = biquad(actx, 'lowpass', 700, 0.9);
    const g = gain(actx, 0);
    series(src, hp, lp, g).connect(out);
    sweep(lp.frequency, t0, lerp(520, 900, big), 60, rollDur);
    ad(g.gain, t0 + 0.02, (0.2 + big * 0.34) * lvl * (0.45 + near * 0.5), 0.09, rollDur);
    src.start(t0 + 0.02, src._offset, rollDur * 1.25);
    end = Math.max(end, t0 + rollDur * 1.25);

    /* the discrete returns */
    const slaps = 2 + (big > 0.6 ? 1 : 0);
    let st = t0 + 0.09 * rng.range(0.85, 1.3);
    let slvl = (0.3 + big * 0.28) * lvl * near;
    let top = lerp(1400, 2400, big);
    for (let i = 0; i < slaps; i++) {
      const s = bank.source('brown', rng, rng.range(0.8, 1.25));
      const bp = biquad(actx, 'highpass', 90, 0.7);
      const slp = biquad(actx, 'lowpass', top, 0.8);
      const sg = gain(actx, 0);
      series(s, bp, slp, sg).connect(out);
      const sd = 0.1 + big * 0.22;
      ad(sg.gain, st, slvl, 0.012, sd);
      s.start(st, s._offset, sd * 2);
      end = Math.max(end, st + sd * 2);
      st += (0.11 + big * 0.14) * rng.range(0.8, 1.35);
      slvl *= 0.52;
      top *= 0.6;
    }
  }

  /**
   * 0.26, down from 0.85 (and 0.56 down from 1.35 at full distance). The two
   * layers above are what that 0.6 of send used to be doing, except that they are
   * this blast's own tail rather than the same convolver every other sound in the
   * game is running through.
   */
  return { node: out, end: end + 0.1, send: 0.26 + far * 0.3 };
}

/** A body hitting the ground: mass, gear, and a wet slap. */
export function bodyFall(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const lvl = o.level ?? 1;
  const out = gain(actx, 0.4); // VOICE TRIM
  const b = osc(actx, 'sine', 74);
  const bg = gain(actx, 0);
  const drv = shaper(actx, saturationCurve(2.2, 0.55), '2x');
  b.connect(bg); series(bg, drv).connect(out);
  sweep(b.frequency, t0, 96, 44, 0.12);
  ad(bg.gain, t0, 0.6 * lvl, 0.004, 0.13);
  b.start(t0); b.stop(t0 + 0.35);

  const src = bank.source('white', rng, rng.range(0.7, 1.1));
  const lp = biquad(actx, 'lowpass', 900, 0.8);
  const g = gain(actx, 0);
  series(src, lp, g).connect(out);
  ad(g.gain, t0, 0.35 * lvl, 0.006, 0.16);
  src.start(t0, src._offset, 0.4);

  for (let i = 0; i < 5; i++) {
    const gt = t0 + rng.range(0.005, 0.26);
    struckResonator(actx, bank, rng, gt, [
      { f: rng.range(1500, 5200), q: rng.range(16, 40), g: rng.range(0.03, 0.09) * lvl, decay: rng.range(0.02, 0.1) },
    ], 0.002).connect(out);
  }
  return { node: out, end: t0 + 0.6, send: 0.18 };
}

/* ------------------------------------------------------------------ */
/* UI                                                                 */
/* ------------------------------------------------------------------ */

/** Non-diegetic feedback. Short, dry, and deliberately synthetic. */
export function uiSound(actx, bank, rng, kind, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const out = gain(actx, 1);
  const lvl = o.level ?? 1;
  switch (kind) {
    case 'hitmarker': {
      const o1 = osc(actx, 'square', 2400);
      const g = gain(actx, 0);
      const lp = biquad(actx, 'lowpass', 5200, 0.7);
      o1.connect(g); series(g, lp).connect(out);
      hit(g.gain, t0, 0.55 * lvl, 0.022);
      o1.start(t0); o1.stop(t0 + 0.06);
      break;
    }
    case 'headshot': {
      const o1 = osc(actx, 'square', 3200);
      const o2 = osc(actx, 'square', 4800);
      const g = gain(actx, 0);
      o1.connect(g); o2.connect(g); g.connect(out);
      hit(g.gain, t0, 0.34 * lvl, 0.05);
      o1.start(t0); o2.start(t0 + 0.03);
      o1.stop(t0 + 0.12); o2.stop(t0 + 0.14);
      break;
    }
    case 'kill': {
      for (let i = 0; i < 3; i++) {
        const o1 = osc(actx, 'triangle', 900 * Math.pow(1.5, i));
        const g = gain(actx, 0);
        o1.connect(g); g.connect(out);
        ad(g.gain, t0 + i * 0.055, 0.3 * lvl, 0.004, 0.09);
        o1.start(t0 + i * 0.055); o1.stop(t0 + i * 0.055 + 0.2);
      }
      break;
    }
    case 'damage': {
      // Directional pain sting: a dissonant low pair, no melody.
      const o1 = osc(actx, 'sawtooth', 180);
      const o2 = osc(actx, 'sawtooth', 191);
      const g = gain(actx, 0);
      const lp = biquad(actx, 'lowpass', 1400, 1.4);
      o1.connect(g); o2.connect(g); series(g, lp).connect(out);
      ad(g.gain, t0, 0.42 * lvl, 0.004, 0.22);
      o1.start(t0); o2.start(t0);
      o1.stop(t0 + 0.4); o2.stop(t0 + 0.4);
      break;
    }
    case 'armour': {
      // Ceramic plate strike: brighter and harder than a flesh hitmarker.
      const r = struckResonator(actx, bank, rng, t0, [
        { f: 3900, q: 30, g: 0.09 * lvl, decay: 0.045 },
        { f: 6400, q: 22, g: 0.05 * lvl, decay: 0.025 },
      ], 0.0015);
      r.connect(out);
      break;
    }
    case 'grenade_warn': {
      // Three rising beeps — reads as "danger", not as a notification.
      for (let i = 0; i < 3; i++) {
        const bt = t0 + i * 0.14;
        const o1 = osc(actx, 'square', 1150 * Math.pow(1.19, i));
        const lp = biquad(actx, 'lowpass', 4200, 0.8);
        const g = gain(actx, 0);
        o1.connect(g); series(g, lp).connect(out);
        ad(g.gain, bt, 0.3 * lvl, 0.004, 0.07);
        o1.start(bt); o1.stop(bt + 0.16);
      }
      break;
    }
    case 'regen': {
      // Soft filtered swell: the "you are OK now" cue. Deliberately unpitched.
      const src = bank.source('pink', rng, 0.9);
      const bp = biquad(actx, 'bandpass', 700, 1.1);
      const g = gain(actx, 0);
      series(src, bp, g).connect(out);
      sweep(bp.frequency, t0, 500, 1900, 0.5);
      ad(g.gain, t0, 0.3 * lvl, 0.15, 0.45);
      src.start(t0, src._offset, 0.9);
      const o1 = osc(actx, 'sine', 420);
      const og = gain(actx, 0);
      o1.connect(og); og.connect(out);
      sweep(o1.frequency, t0, 380, 640, 0.45);
      ad(og.gain, t0, 0.12 * lvl, 0.14, 0.4);
      o1.start(t0); o1.stop(t0 + 0.8);
      break;
    }
    case 'lowhealth': {
      const o1 = osc(actx, 'sine', 92);
      const g = gain(actx, 0);
      o1.connect(g); g.connect(out);
      ad(g.gain, t0, 0.45 * lvl, 0.05, 0.55);
      o1.start(t0); o1.stop(t0 + 0.9);
      break;
    }
    default: {
      const o1 = osc(actx, 'sine', 1200);
      const g = gain(actx, 0);
      o1.connect(g); g.connect(out);
      hit(g.gain, t0, 0.26 * lvl, 0.03);
      o1.start(t0); o1.stop(t0 + 0.08);
    }
  }
  return { node: out, end: t0 + 0.9, send: 0 };
}

/**
 * Heartbeat + laboured breathing for low health. Returned so the caller can
 * schedule it repeatedly rather than looping a node.
 */
export function heartbeat(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const lvl = o.level ?? 1;
  const out = gain(actx, 0.5); // VOICE TRIM
  for (let i = 0; i < 2; i++) {
    const bt = t0 + i * 0.19;
    const b = osc(actx, 'sine', 58);
    const g = gain(actx, 0);
    b.connect(g); g.connect(out);
    sweep(b.frequency, bt, 72, 42, 0.1);
    ad(g.gain, bt, (i === 0 ? 0.5 : 0.33) * lvl, 0.008, 0.11);
    b.start(bt); b.stop(bt + 0.3);
  }
  return { node: out, end: t0 + 0.6, send: 0.1 };
}

/**
 * THE MINE'S TRIP WARNING — a RISING beep, and the rise is the whole point.
 *
 * `src/weapons/grenades.js` arms a laser tripwire 0.9 s after it lands and
 * detonates 1.0 s after the beam breaks. That one second is the entire feature:
 * it is the difference between a mine and a trap you cannot answer, and its
 * author had to build the warning out of `dryfire` — a striker falling — played
 * twice, because nothing in this bank was an alarm. It cuts through a firefight,
 * which is why it works at all, but a CLICK cannot say what this has to say.
 *
 * A click is an event: something happened. A rising pitch is a STATE: something
 * is happening and it is not finished. Every countdown ever built rises for that
 * reason, and it is the reason the request was right.
 *
 * Two pips, each sweeping up, the second starting above where the first ended,
 * so the pair reads as one gesture that is going somewhere rather than as two
 * sounds. Square through a bandpass: odd harmonics survive being heard across a
 * street through gunfire in a way a sine does not, and the bandpass keeps it
 * from being shrill in the ear of the man standing on it.
 *
 * @param {object} o { when, level }
 */
export function mineTrip(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const lvl = clamp(o.level ?? 1, 0, 2);
  const out = gain(actx, 0.42); // VOICE TRIM
  const jit = rng.range(0.98, 1.02);

  /* the mechanism: the striker/relay under the beep, because it IS a device */
  struckResonator(actx, bank, rng, t0, [
    { f: 2400 * jit, q: 22, g: 0.1 * lvl, decay: 0.02 },
    { f: 5200 * jit, q: 14, g: 0.05 * lvl, decay: 0.012 },
  ], 0.0015).connect(out);

  /* two rising pips */
  const PIPS = [
    { at: 0.0, f0: 980, f1: 1480, dur: 0.11 },
    { at: 0.16, f0: 1560, f1: 2320, dur: 0.13 },
  ];
  for (const p of PIPS) {
    const st = t0 + p.at;
    const o1 = osc(actx, 'square', p.f0 * jit);
    const bp = biquad(actx, 'bandpass', p.f0 * 1.5 * jit, 1.4);
    const g = gain(actx, 0);
    series(o1, bp, g).connect(out);
    sweep(o1.frequency, st, p.f0 * jit, p.f1 * jit, p.dur);
    sweep(bp.frequency, st, p.f0 * 1.5 * jit, p.f1 * 1.6 * jit, p.dur);
    // Hard on, hard off: a pip with a soft attack sounds like a synthesiser
    // warming up, and this has one second to be understood.
    ad(g.gain, st, 0.5 * lvl, 0.0015, p.dur);
    o1.start(st);
    o1.stop(st + p.dur * 1.4 + 0.02);
  }

  /**
   * Nearly dry. A room on an alarm smears the two pips into one and the rise —
   * the only information in the sound — goes with it. 「リバーブが強い」 is a
   * standing complaint and this is the wrong voice to spend any of it on.
   */
  return { node: out, end: t0 + 0.34, send: 0.05 };
}
