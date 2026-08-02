/**
 * AUDIO / WEAPON FIRE
 *
 * A gunshot is not one sound. Every layer below exists in real recordings and
 * removing any one of them is immediately audible:
 *
 *   1. TRANSIENT  sub-millisecond click — the pressure step. Gives the shot its
 *                 "instant" feel; without it the gun sounds like a firework.
 *   2. BODY       a fast downward-swept sine/triangle pair, saturated. This is
 *                 the chest thump, the layer people describe as "punch".
 *   3. CRACK      resonant band-passed noise around 1.5–3.5 kHz driven into
 *                 saturation. Calibre character lives here.
 *   4. MID        a short 500–900 Hz noise body that glues 2 and 3 together.
 *   5. TAIL       a broadband burst under a falling lowpass, fed hard into the
 *                 reverb send — this is what the *room* hears.
 *   6. MECH       the bolt/action: a separate, drier, later metallic layer. It
 *                 is what makes a weapon feel mechanical rather than sampled.
 *   7. BOOM       (distance only) a slow, dark, rolling low-frequency swell
 *                 plus a ground-bounce repeat.
 *
 * Variation: each profile owns a round-robin table of 6 timbre variants, and on
 * top of that every shot gets fresh pitch/level/decay jitter from ctx.rng. Two
 * consecutive rounds are never the same waveform, which is the single biggest
 * difference between "synthesized game audio" and "a looping sample".
 */

import {
  ad, biquad, clamp, gain, hit, lerp, osc, saturationCurve, semis, series, shaper,
  struckResonator, sweep,
} from './dsp.js';
// The range law lives beside the curve it multiplies. `spatial.js` imports only
// `dsp.js`, so this cannot close a cycle.
import { gunRangeGain } from './spatial.js';

/**
 * Per-weapon character. Frequencies in Hz, times in seconds.
 * `level` is a linear trim; the mix expects ~1.0 for a 5.56 rifle.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * TWO FIELDS ON EVERY PROFILE CHANGED MEANING. Read this before retuning.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `send` IS NO LONGER AN ABSOLUTE WET LEVEL. It is the weapon's share of
 * whatever wetness the SPACE grants — a character trim, not a room. The room is
 * `o.echoBoost`, which `src/audio/index.js` computes from where the shooter is
 * standing (0.12 in the open street, 0.97 inside). The old values were 0.40 to
 * 0.72 and were multiplied by a space term as well as by a second space term in
 * the caller, so a shot in the open street went out at a send of 0.19 and one
 * indoors at 0.29: barely a distinction, and both far too wet.
 *
 * MEASURED, offline, seven profiles rendered through the real mixer in the
 * outdoor blend (street 0.35 / open 0.65), reporting the time for the RMS
 * envelope to fall 20 and 40 dB below its peak:
 *
 *              send x1 (shipped)      send x0 (no reverb at all)
 *   pistol      -20 0.425  -40 0.785    -20 0.020  -40 0.075
 *   smg         -20 0.425  -40 0.780    -20 0.025  -40 0.075
 *   rifle       -20 0.350* -40 0.725*   -20 0.045  -40 0.110
 *   ak          -20 0.385  -40 0.790    -20 0.060  -40 0.175
 *   lmg         -20 0.410  -40 0.780    -20 0.060  -40 0.205
 *   shotgun     -20 0.430  -40 0.780    -20 0.070  -40 0.200
 *   sniper      -20 0.450  -40 0.810    -20 0.085  -40 0.370
 *
 * Dry, the set spans 4.3:1 at -20 dB and 4.9:1 at -40 dB — the profiles below
 * ARE differentiated. Wet, the same set spans 1.3:1 and 1.12:1: every weapon
 * decayed within 4% of every other. The reverb was not colouring the shots, it
 * was REPLACING them, and 68% of the total energy of a shot (rms 0.0083 wet vs
 * 0.0027 dry, AK) was the room rather than the gun. That is one cause for both
 * "銃声がなんでこんなリバーブかかってるの" and "銃声が全部一緒だけど".
 *
 * `transF`/`transPk`/`transLevel`/`clickF` ARE NEW, and they are the other
 * cause. Layer 1 — the transient, the loudest and first thing in the shot — was
 * a white burst through a highpass at a hard-coded 2600 Hz, a peaking filter at
 * a hard-coded 6200 Hz and a triangle click at a hard-coded 1750 Hz, at a
 * hard-coded level of 0.9, for every weapon in the game. Measured spectral
 * centroid over the first 60 ms, DRY, before this change: pistol 2523, sniper
 * 2584, ak 2578, shotgun 2629, smg 2701, lmg 2728, rifle 2747 Hz — a 9% spread
 * across a 9 mm and a .338. The profiles differed everywhere except in the one
 * layer that arrives first and loudest.
 */
export const WEAPON_PROFILES = {
  rifle: {
    level: 1.0, bodyF: 148, bodyF2: 56, bodyDecay: 0.085, subF: 62, subDecay: 0.12,
    crackF: 2450, crackQ: 0.95, crackDecay: 0.055, drive: 6, asym: 0.35,
    midF: 780, midDecay: 0.05, tailDecay: 0.3, tailF: 5200, tailEndF: 700,
    mechDelay: 0.028, mechLevel: 0.42, mechPartials: [1880, 3260, 5400], send: 0.16,
    transF: 2600, transPk: 6200, transTop: 9500, transLevel: 0.9, clickF: 1750,
  },
  ak: {
    level: 1.1, bodyF: 124, bodyF2: 46, bodyDecay: 0.105, subF: 52, subDecay: 0.15,
    crackF: 1680, crackQ: 0.9, crackDecay: 0.07, drive: 7.5, asym: 0.5,
    midF: 640, midDecay: 0.06, tailDecay: 0.42, tailF: 4200, tailEndF: 560,
    mechDelay: 0.034, mechLevel: 0.55, mechPartials: [1420, 2650, 4300], send: 0.18,
    transF: 1780, transPk: 4200, transTop: 6500, transLevel: 0.96, clickF: 1150,
  },
  smg: {
    level: 0.84, bodyF: 172, bodyF2: 72, bodyDecay: 0.06, subF: 78, subDecay: 0.08,
    crackF: 3350, crackQ: 1.05, crackDecay: 0.04, drive: 5, asym: 0.3,
    midF: 900, midDecay: 0.035, tailDecay: 0.19, tailF: 6200, tailEndF: 900,
    mechDelay: 0.021, mechLevel: 0.5, mechPartials: [2200, 3900, 6300], send: 0.13,
    transF: 4400, transPk: 9800, transTop: 17000, transLevel: 0.8, clickF: 2600,
  },
  pistol: {
    level: 0.74, bodyF: 186, bodyF2: 84, bodyDecay: 0.05, subF: 92, subDecay: 0.07,
    crackF: 2750, crackQ: 1.15, crackDecay: 0.035, drive: 4.5, asym: 0.28,
    midF: 950, midDecay: 0.03, tailDecay: 0.16, tailF: 6800, tailEndF: 1000,
    mechDelay: 0.038, mechLevel: 0.46, mechPartials: [2450, 4200, 6900], send: 0.12,
    transF: 3400, transPk: 7800, transTop: 12000, transLevel: 0.7, clickF: 2250,
  },
  shotgun: {
    level: 1.18, bodyF: 108, bodyF2: 40, bodyDecay: 0.13, subF: 44, subDecay: 0.19,
    crackF: 1450, crackQ: 0.7, crackDecay: 0.09, drive: 9, asym: 0.6,
    midF: 520, midDecay: 0.08, tailDecay: 0.5, tailF: 3600, tailEndF: 460,
    mechDelay: 0.16, mechLevel: 0.7, mechPartials: [980, 1760, 3050], send: 0.2,
    transF: 1450, transPk: 3400, transTop: 5800, transLevel: 1.0, clickF: 900,
    pellets: 6,
  },
  sniper: {
    level: 1.3, bodyF: 96, bodyF2: 34, bodyDecay: 0.16, subF: 38, subDecay: 0.24,
    crackF: 1320, crackQ: 0.8, crackDecay: 0.11, drive: 10, asym: 0.55,
    midF: 470, midDecay: 0.1, tailDecay: 0.95, tailF: 3300, tailEndF: 380,
    mechDelay: 0.19, mechLevel: 0.65, mechPartials: [1150, 2050, 3400], send: 0.24,
    transF: 1250, transPk: 2900, transTop: 5200, transLevel: 1.05, clickF: 780,
  },
  lmg: {
    level: 1.22, bodyF: 118, bodyF2: 44, bodyDecay: 0.135, subF: 44, subDecay: 0.22,
    crackF: 2250, crackQ: 0.85, crackDecay: 0.085, drive: 8, asym: 0.45,
    midF: 610, midDecay: 0.065, tailDecay: 0.72, tailF: 4000, tailEndF: 520,
    mechDelay: 0.03, mechLevel: 0.6, mechPartials: [1330, 2480, 4100], send: 0.19,
    transF: 2500, transPk: 5900, transTop: 9200, transLevel: 0.99, clickF: 1680,
  },
  /**
   * ADDITIVE ONLY — two sidearm profiles for the weapons roster's new
   * handguns. Selected by the def's `audio` key ('magnum' / 'machinepistol'),
   * which `_onFire` reads before the id, so no resolver regex changes.
   *
   * magnum: a .44 out of a 6" barrel is a shotgun-family BOOM, not a 9 mm
   * snap — low corner (1.5 kHz), heavy drive, a real tail, and almost no mech
   * layer because a revolver has no cycling action to hear.
   */
  magnum: {
    level: 1.05, bodyF: 112, bodyF2: 42, bodyDecay: 0.11, subF: 46, subDecay: 0.16,
    crackF: 1550, crackQ: 0.75, crackDecay: 0.08, drive: 8.5, asym: 0.55,
    midF: 560, midDecay: 0.07, tailDecay: 0.45, tailF: 3800, tailEndF: 500,
    mechDelay: 0.05, mechLevel: 0.25, mechPartials: [1200, 2300, 3800], send: 0.2,
    transF: 1550, transPk: 3600, transTop: 6200, transLevel: 1.0, clickF: 950,
  },
  /**
   * machinepistol: the opposite pole — the smallest, brightest report in the
   * set (a 108 mm barrel, corner at 4.8 kHz) with a LOUD mech layer arriving
   * 16 ms in: at 1050 rpm what you mostly hear is the tiny slide hammering.
   */
  machinepistol: {
    level: 0.7, bodyF: 195, bodyF2: 90, bodyDecay: 0.042, subF: 100, subDecay: 0.06,
    crackF: 3600, crackQ: 1.2, crackDecay: 0.03, drive: 4.2, asym: 0.26,
    midF: 1050, midDecay: 0.028, tailDecay: 0.13, tailF: 7400, tailEndF: 1100,
    mechDelay: 0.016, mechLevel: 0.6, mechPartials: [2700, 4600, 7400], send: 0.11,
    transF: 4800, transPk: 10500, transTop: 17500, transLevel: 0.75, clickF: 2900,
  },
  suppressed: {
    level: 0.5, bodyF: 132, bodyF2: 64, bodyDecay: 0.055, subF: 70, subDecay: 0.07,
    crackF: 900, crackQ: 0.6, crackDecay: 0.03, drive: 2.5, asym: 0.2,
    midF: 430, midDecay: 0.05, tailDecay: 0.1, tailF: 1800, tailEndF: 400,
    mechDelay: 0.019, mechLevel: 0.85, mechPartials: [2100, 3700, 5900], send: 0.06,
    transF: 1100, transPk: 2600, transTop: 4200, transLevel: 0.32, clickF: 700,
    suppressed: true,
  },
};

/** Map whatever the weapons subsystem calls its guns onto a profile. */
export function resolveProfile(name) {
  if (!name) return WEAPON_PROFILES.rifle;
  const k = String(name).toLowerCase();
  if (WEAPON_PROFILES[k]) return WEAPON_PROFILES[k];
  if (/suppress|silenc/.test(k)) return WEAPON_PROFILES.suppressed;
  if (/ak|7\.?62|akm|scar/.test(k)) return WEAPON_PROFILES.ak;
  if (/mp5|mp7|smg|ump|vector|uzi/.test(k)) return WEAPON_PROFILES.smg;
  if (/pistol|glock|m19|deagle|handgun|sidearm/.test(k)) return WEAPON_PROFILES.pistol;
  if (/shot|pump|12g|benelli|spas/.test(k)) return WEAPON_PROFILES.shotgun;
  if (/snip|dmr|awp|barrett|338|intervention|marksman/.test(k)) return WEAPON_PROFILES.sniper;
  if (/lmg|mg4|m249|pkm|saw|minigun/.test(k)) return WEAPON_PROFILES.lmg;
  return WEAPON_PROFILES.rifle;
}

/* ------------------------------------------------------------------ */
/* Round robin                                                        */
/* ------------------------------------------------------------------ */

const RR_SLOTS = 6;

/** Build (once, lazily) the round-robin timbre table for a profile. */
function roundRobin(profile, rng) {
  if (profile._rr) return profile._rr;
  const rr = [];
  for (let i = 0; i < RR_SLOTS; i++) {
    rr.push({
      body: semis(rng.range(-1.1, 1.1)),
      crack: semis(rng.range(-1.7, 1.7)),
      crackQ: rng.range(0.85, 1.2),
      tail: rng.range(0.86, 1.18),
      drive: rng.range(0.85, 1.2),
      mid: semis(rng.range(-2, 2)),
      level: rng.range(0.93, 1.07),
      mech: rng.range(0.8, 1.25),
      // Slight per-slot spectral tilt: microphone/room position variance.
      tilt: rng.range(-2.5, 2.5),
    });
  }
  profile._rr = rr;
  profile._rrIndex = (rng.u32() % RR_SLOTS) | 0;
  return rr;
}

/**
 * Synthesize one shot.
 *
 * @param {BaseAudioContext} actx
 * @param {import('./dsp.js').NoiseBank} bank
 * @param {import('../core/rng.js').Rng} rng
 * @param {object} profile from WEAPON_PROFILES
 * @param {object} o { when, distance, indoor, firstPerson, echo }
 * @returns {{node: GainNode, end: number, send: number}}
 */
export function weaponShot(actx, bank, rng, profile, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const dist = Math.max(0, o.distance ?? 0);
  const fp = !!o.firstPerson;

  const rr = roundRobin(profile, rng);
  profile._rrIndex = (profile._rrIndex + 1) % RR_SLOTS;
  const v = rr[profile._rrIndex];

  // Per-shot jitter on top of the round-robin slot — the fine grain.
  const jB = v.body * semis(rng.range(-0.45, 0.45));
  const jC = v.crack * semis(rng.range(-0.8, 0.8));
  const jT = v.tail * rng.range(0.94, 1.07);
  const jL = v.level * rng.range(0.95, 1.05);

  // Distance mixing. Near = all crack and click; far = all boom and tail.
  const near = clamp(1 - dist / 42, 0, 1);
  const nearP = Math.pow(near, 0.7);
  const far = 1 - near;

  // VOICE TRIM — the gunshot is the loudest thing in the game and defines the
  // reference the rest of the mix is staged against.
  const out = gain(actx, 0.46);
  let end = t0 + 0.2;

  /* ---- 1. transient --------------------------------------------- */
  /**
   * THIS LAYER WAS IDENTICAL ON EVERY WEAPON — see the block comment on
   * WEAPON_PROFILES. The highpass corner, the peak it emphasises, its level and
   * the click frequency now all come off the profile, because this is the layer
   * that arrives first and loudest and therefore the one that decides what the
   * gun sounds like before any other layer has started.
   *
   * The physical claim behind the numbers: a muzzle blast's pressure step is
   * band-limited by the bore, so the transient's corner scales with calibre, not
   * with taste. A 9 mm cracks at 3.4 kHz and up; a .338 at 1.25 kHz and is much
   * heavier under it. The decay is left alone — a pressure step is a pressure
   * step and lengthening it just makes the gun sound like a firework.
   */
  if (nearP > 0.05) {
    const transF = profile.transF ?? 2600;
    const tg = gain(actx, 0);
    const src = bank.source('white', rng, rng.range(0.9, 1.3));
    const hp = biquad(actx, 'highpass', transF, 0.6);
    /**
     * THE CEILING MATTERS MORE THAN THE CORNER, and this is the part I got
     * wrong on the first attempt. Moving only the highpass from 1250 Hz to
     * 3900 Hz across the weapon set changed the measured spectral centroid of
     * the first 5 ms by 5% (4583 -> 4792 Hz), because white noise through a
     * 12 dB/oct highpass still runs all the way to Nyquist and the centroid of
     * that is set by the top of the band, not by where it starts. The band has
     * to be closed at BOTH ends before the transient can carry a calibre.
     *
     * Physically that ceiling is real: the bore is a short tube and it rolls
     * off the pressure step, so a .338's blast has nothing like a 9 mm's 12 kHz
     * content. `transTop` is that roll-off, 5.2 kHz on the sniper up to 14 kHz
     * on the SMG.
     */
    const lp = biquad(actx, 'lowpass', profile.transTop ?? 9500, 0.7);
    const pk = biquad(actx, 'peaking', (profile.transPk ?? 6200) * jC, 1.1, 8 + v.tilt);
    series(src, hp, lp, pk, tg).connect(out);
    // Big-bore blasts hold their step longer than a pistol's: 5 ms at 1.25 kHz,
    // 9 ms at 3.9 kHz, interpolated on the transient corner itself.
    const transDecay = clamp(0.0125 - transF * 1.9e-6, 0.005, 0.0095);
    hit(tg.gain, t0, (profile.transLevel ?? 0.9) * nearP * jL, transDecay);
    src.start(t0, src._offset, 0.05);
    // A single-cycle sine at the top of the click adds the "snap" that pure
    // noise cannot produce.
    const clk = osc(actx, 'triangle', (profile.clickF ?? 1750) * jC);
    const cg = gain(actx, 0);
    clk.connect(cg); cg.connect(out);
    hit(cg.gain, t0, 0.35 * nearP * jL * (profile.suppressed ? 0.4 : 1), 0.004);
    clk.start(t0); clk.stop(t0 + 0.02);
  }

  /* ---- 2. body + sub -------------------------------------------- */
  {
    const bodyLevel = (0.85 + far * 0.5) * jL * profile.level;
    const b1 = osc(actx, 'sine', profile.bodyF * jB);
    const b2 = osc(actx, 'triangle', profile.bodyF * jB * 0.5);
    const bg = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(profile.drive * v.drive * 0.5, profile.asym), '2x');
    const bodyLP = biquad(actx, 'lowpass', lerp(2200, 700, far), 0.9);
    b1.connect(bg); b2.connect(bg);
    series(bg, drv, bodyLP).connect(out);
    sweep(b1.frequency, t0, profile.bodyF * jB, profile.bodyF2 * jB, profile.bodyDecay * 1.4);
    sweep(b2.frequency, t0, profile.bodyF * jB * 0.5, profile.bodyF2 * jB * 0.55, profile.bodyDecay * 1.6);
    ad(bg.gain, t0, bodyLevel, 0.0012, profile.bodyDecay * rng.range(0.9, 1.15));
    b1.start(t0); b2.start(t0);
    const bEnd = t0 + profile.bodyDecay * 1.8 + 0.02;
    b1.stop(bEnd); b2.stop(bEnd);
    end = Math.max(end, bEnd);

    // Sub thump — this is the one that moves air; keep it out of the reverb.
    const s = osc(actx, 'sine', profile.subF * jB);
    const sg = gain(actx, 0);
    s.connect(sg); sg.connect(out);
    sweep(s.frequency, t0, profile.subF * jB * 1.5, profile.subF * jB * 0.8, profile.subDecay);
    ad(sg.gain, t0, (0.5 + far * 0.55) * profile.level, 0.004, profile.subDecay * 1.3);
    s.start(t0); s.stop(t0 + profile.subDecay * 2 + 0.05);
    end = Math.max(end, t0 + profile.subDecay * 2 + 0.05);
  }

  /* ---- 3. crack -------------------------------------------------- */
  /**
   * THE SATURATOR IS WHY EVERY GUN SOUNDED THE SAME, and it is not obvious from
   * reading the profiles.
   *
   * The chain is bandpass -> resonance -> WAVESHAPER -> envelope, and note the
   * order: the envelope is applied AFTER the shaper, so the shaper always sees
   * bandpassed noise at full scale. `saturationCurve(drive)` is tanh with
   * k = 1 + drive, and drive is 4.5 to 10 here, so a signal that spends most of
   * its time past |0.3| comes out very nearly square. Squaring a 1.3 kHz band
   * and squaring a 3.1 kHz band both produce harmonics all the way to Nyquist,
   * and the result is that the loudest, most identifying layer of the shot had
   * essentially the same bandwidth on a .338 and on a 9 mm.
   *
   * MEASURED. Raw voice, onset-aligned, spectral centroid of the first 5 ms
   * across seven profiles: 4583 .. 4792 Hz, a 1.05:1 spread — while `crackF`
   * itself spans 2.3:1. Band-limiting the transient alone did not move it
   * (1.06:1), which is what proved the crack rather than the transient was
   * setting it.
   *
   * The fix is one filter AFTER the shaper, at 3.4x the crack's own band. That
   * is a bore roll-off, not a taste decision: the harmonics the muzzle actually
   * radiates are bounded by the calibre, so a big slow gun stays dark under
   * heavy drive instead of turning into the same wall of fizz as a fast small
   * one. It keeps every bit of the drive's density and throws away only the
   * part that was making all seven weapons identical.
   */
  if (nearP > 0.03) {
    const src = bank.source('white', rng, rng.range(0.85, 1.25));
    const bp = biquad(actx, 'bandpass', profile.crackF * jC, profile.crackQ * v.crackQ);
    const res = biquad(actx, 'peaking', profile.crackF * jC * 1.9, 1.6, 6 + v.tilt);
    const drv = shaper(actx, saturationCurve(profile.drive * v.drive, profile.asym * 0.6), '2x');
    const top = biquad(actx, 'lowpass', clamp(profile.crackF * jC * 3.4, 2500, 15000), 0.7);
    const cg = gain(actx, 0);
    series(src, bp, res, drv, top, cg).connect(out);
    // The crack's own band sweeps down a little: the shock front decays.
    sweep(bp.frequency, t0, profile.crackF * jC * 1.35, profile.crackF * jC * 0.8, profile.crackDecay * 2);
    ad(cg.gain, t0, 1.05 * nearP * jL * profile.level, 0.0015, profile.crackDecay * rng.range(0.85, 1.2));
    src.start(t0, src._offset, profile.crackDecay * 3 + 0.05);
    end = Math.max(end, t0 + profile.crackDecay * 3);
  }

  /* ---- 4. mid body ---------------------------------------------- */
  {
    const src = bank.source('pink', rng, rng.range(0.8, 1.25));
    const bp = biquad(actx, 'bandpass', profile.midF * v.mid, 1.1);
    const mg = gain(actx, 0);
    series(src, bp, mg).connect(out);
    ad(mg.gain, t0, (0.5 + far * 0.35) * jL * profile.level, 0.002, profile.midDecay * 1.4);
    src.start(t0, src._offset, profile.midDecay * 4 + 0.05);
  }

  /* ---- 5. tail --------------------------------------------------- */
  {
    const tailDur = profile.tailDecay * jT * (1 + far * 1.6);
    const src = bank.source('pink', rng, rng.range(0.7, 1.15));
    const lp = biquad(actx, 'lowpass', profile.tailF, 0.6);
    const hp = biquad(actx, 'highpass', lerp(160, 70, far), 0.7);
    const tg = gain(actx, 0);
    series(src, hp, lp, tg).connect(out);
    sweep(lp.frequency, t0, profile.tailF * lerp(1, 0.35, far), profile.tailEndF * lerp(1, 0.6, far), tailDur);
    ad(tg.gain, t0, (0.42 + far * 0.5) * jL * profile.level, 0.006, tailDur);
    src.start(t0, src._offset, tailDur * 1.3 + 0.05);
    end = Math.max(end, t0 + tailDur * 1.3);
  }

  /* ---- 6. mechanical / bolt ------------------------------------- */
  // Only audible close up — a rifle 40 m away has no audible action noise, and
  // spending nodes on it would be waste.
  if (dist < 14 && profile.mechLevel > 0) {
    const md = profile.mechDelay * rng.range(0.85, 1.2);
    const lvl = profile.mechLevel * v.mech * (fp ? 1 : 0.6) * clamp(1 - dist / 14, 0.15, 1);
    const partials = profile.mechPartials;
    const bolt = struckResonator(actx, bank, rng, t0 + md, [
      { f: partials[0] * rng.range(0.96, 1.05), q: 26, g: 0.5 * lvl, decay: 0.055 },
      { f: partials[1] * rng.range(0.96, 1.05), q: 20, g: 0.34 * lvl, decay: 0.035 },
      { f: partials[2] * rng.range(0.96, 1.05), q: 14, g: 0.2 * lvl, decay: 0.02 },
    ], 0.0035);
    bolt.connect(out);
    // Return-to-battery: a second, softer clack a few ms later.
    const back = struckResonator(actx, bank, rng, t0 + md * 2.1, [
      { f: partials[0] * 0.88, q: 18, g: 0.3 * lvl, decay: 0.04 },
      { f: partials[1] * 1.12, q: 12, g: 0.16 * lvl, decay: 0.022 },
    ], 0.003);
    back.connect(out);
    // Spring/gas hiss.
    const hs = bank.source('white', rng, rng.range(1, 1.4));
    const hbp = biquad(actx, 'bandpass', 4200 * rng.range(0.9, 1.1), 1.4);
    const hg = gain(actx, 0);
    series(hs, hbp, hg).connect(out);
    ad(hg.gain, t0 + md * 0.6, 0.12 * lvl, 0.006, 0.05);
    hs.start(t0 + md * 0.6, hs._offset, 0.12);
    end = Math.max(end, t0 + md * 2.1 + 0.1);
  }

  /* ---- 7. distant rolling boom ---------------------------------- */
  if (far > 0.12) {
    const boomDur = 0.28 + dist * 0.0055;
    const src = bank.source('brown', rng, rng.range(0.6, 1.0));
    const lp = biquad(actx, 'lowpass', 420, 0.8);
    const bg = gain(actx, 0);
    series(src, lp, bg).connect(out);
    sweep(lp.frequency, t0, 620, 190, boomDur);
    ad(bg.gain, t0, 0.95 * far * far * profile.level, 0.012 + dist * 0.0004, boomDur);
    src.start(t0, src._offset, boomDur * 1.4 + 0.05);
    end = Math.max(end, t0 + boomDur * 1.4);

    // Ground/terrain bounce: one discrete slap after the direct sound. This is
    // the detail that makes long-range fire read as *outdoors*.
    const bounceT = t0 + clamp(dist * 0.0022, 0.012, 0.12);
    const b2 = bank.source('pink', rng, rng.range(0.6, 0.9));
    const blp = biquad(actx, 'lowpass', 900, 0.7);
    const b2g = gain(actx, 0);
    series(b2, blp, b2g).connect(out);
    ad(b2g.gain, bounceT, 0.3 * far, 0.004, 0.12 + dist * 0.001);
    b2.start(bounceT, b2._offset, 0.4);
  }

  /* ---- shotgun pellet spatter ----------------------------------- */
  if (profile.pellets && nearP > 0.2) {
    for (let i = 0; i < profile.pellets; i++) {
      const pt = t0 + rng.range(0.0004, 0.006);
      const src = bank.source('white', rng, rng.range(0.9, 1.4));
      const bp = biquad(actx, 'bandpass', rng.range(2600, 6200), 1.8);
      const g = gain(actx, 0);
      series(src, bp, g).connect(out);
      hit(g.gain, pt, 0.1 * nearP, rng.range(0.004, 0.014));
      src.start(pt, src._offset, 0.05);
    }
  }

  /* ---- 8. slap-back, the gun's own room -------------------------- */
  /**
   * 「もっと銃声をリアルに」 and 「リバーブはなるべく無くして」 pull in opposite
   * directions until you look at what a rifle in a street actually sounds like.
   * It is not a smooth exponential decay. It is the report and then two or three
   * DISCRETE returns off the facades — a wall 12 m away answers 70 ms later, one
   * across the street at 30 m answers 175 ms later, and each return has lost its
   * top end. That is the sound of a gun outdoors, and a convolver cannot make it:
   * the IRs here are dense stochastic tails, so asking them for it gives a wash
   * that arrives immediately and never resolves into separate events.
   *
   * MEASURED, `shot:rifle@2m` rendered dry (send scaled to 0) through the real
   * mixer: d20 0.06 s, d40 0.11 s. Wet, with the send open: 0.36 and 0.78. So
   * 83 % of the decay of every shot in the game was the reverb bus, which is the
   * measurement behind 「銃声がなんでこんなリバーブかかってるの」.
   *
   * These taps are real delays on the shot's own signal, so they carry the
   * weapon's own timbre — an AK's returns are an AK's, which is the thing a
   * shared convolver flattens. Three of them, jittered per shot, each one 8 dB
   * down and an octave darker. `echoBoost` (0.12 outdoors, 0.97 indoors, from
   * `_wetnessAt`) scales the whole set and shortens the spacing indoors, because
   * a room's first reflection arrives in 8 ms and a street's in 70.
   *
   * Cost: three DelayNodes, three biquads and three gains per shot, on a voice
   * that already builds ~40 nodes, and only when the shot is close enough for
   * them to be audible at all.
   */
  const room = clamp(o.echoBoost ?? 0.2, 0, 1.4);
  let node = out;
  if (nearP > 0.06 && room > 0.02) {
    const sum = gain(actx, 1);
    out.connect(sum);
    // Indoors the walls are close: 9-40 ms. Outdoors they are the far side of
    // the street: 55-260 ms. Interpolate on the room term itself.
    const inside = clamp(room / 0.9, 0, 1);
    let t = lerp(0.062, 0.011, inside) * rng.range(0.8, 1.3);
    // The first return is well down on the direct sound even in a small room.
    let lvl = clamp(0.3 + room * 0.34, 0.1, 0.62) * nearP;
    let top = lerp(2600, 4200, inside);
    for (let i = 0; i < 3; i++) {
      const dl = actx.createDelay(0.6);
      dl.delayTime.value = Math.min(0.55, t);
      const lp = biquad(actx, 'lowpass', top, 0.7);
      const hp = biquad(actx, 'highpass', lerp(200, 130, inside), 0.7);
      const g = gain(actx, lvl);
      series(out, dl, hp, lp, g).connect(sum);
      t += lerp(0.075, 0.014, inside) * rng.range(0.75, 1.4);
      lvl *= 0.4;
      top *= 0.55;
    }
    node = sum;
    // `t` is a delay time, not an instant: the last tap is still arriving that
    // long after the direct sound has finished.
    end += t + 0.05;
  }

  // WET = character x room x distance. `profile.send` is the weapon's share,
  // `o.echoBoost` is the room the SHOOTER is standing in (see `_wetnessAt` in
  // index.js) and `far` is the fact that a distant shot reaches you as tail.
  // There is exactly one space term in this product now; there used to be two,
  // one here and one in the caller, and they multiplied.
  //
  // 0.62, because layer 8 above now carries the near field: the send is what the
  // rest of the level does with the shot, not what the street directly in front
  // of the muzzle does with it.
  const send = profile.send * 0.62 * (1 + far * 1.4) * (o.echoBoost ?? 1);
  return { node, end: end + 0.05, send };
}

/* ------------------------------------------------------------------ */
/* The battle you are not standing in                                  */
/* ------------------------------------------------------------------ */

/**
 * WHAT A DISTANT BURST IS PLAYED AT, per metre.
 *
 * It is a separate function because it is a MIX DECISION and it had to be
 * measured rather than picked. `SpatialField.attenuation` is deliberately
 * gentler than 1/r past 40 m — a real firefight at 150 m is audible and a pure
 * inverse-distance level makes a level feel dead — but "gentler" out there is
 * nearly FLAT: 0.0435 at 90 m and 0.0275 at 200 m, four decibels across a
 * hundred and ten metres. A constant gain on top of that would make the whole
 * map one loudness.
 *
 * MEASURED (`src/audio/selftest.js`, rendered through the real mixer and the
 * real distance chain), against the reference the mix is staged on — the
 * player's own rifle in his own hands at peak 0.0831, and the ambience bed at
 * rms 0.00362:
 *
 *   own rifle, first person              peak 0.0831
 *   THIS, 4 rounds of AK at 90 m         peak 0.0197   -12.5 dB under the rifle
 *   THIS, 4 rounds of AK at 150 m        peak 0.0172   -13.7 dB
 *   THIS, 6 rounds of LMG at 200 m       peak 0.0135   -15.8 dB
 *   `ambience`'s scheduled volley        peak ~0.050   -4.4 dB   (SHIPPED)
 *
 * That last line is the calibration that matters: this layer is THREE TIMES
 * QUIETER than the distant volleys the game already fires off every seven
 * seconds from `_distantVolley`. What it adds is not loudness, it is presence —
 * it happens continuously, in the direction the actual fight is in, at the rate
 * the actual fight is firing.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND IT WAS STILL INAUDIBLE, BECAUSE THOSE NUMBERS ARE NOT WHAT ARRIVES.
 * ────────────────────────────────────────────────────────────────────────────
 * The peaks above come from `src/audio/selftest.js`, which renders a voice
 * through the mixer and a REBUILT distance chain: `airLP -> distGain -> bus`.
 * The live chain is `airLP -> occLP -> occHS -> distGain -> PannerNode(HRTF)`,
 * and the player's own rifle — the reference every one of those ratios is
 * against — is head-locked and goes through none of it. So the bench was
 * comparing a remote shot missing two filters and a panner against a local one
 * that never had them, and it flattered the remote shot in exactly the way
 * nobody would notice until the player said he could not hear it.
 *
 * MEASURED AT THE OUTPUT OF A RUNNING GAME instead (`--ear`), same reference:
 * 90 m was -25.8 dB under his rifle, not -12.5, and 150 m was -26.8 dB against
 * an ambience bed at -35. Thirteen decibels of the shortfall were never in the
 * bench at all.
 *
 * The range law is now one function for both halves of the gunfire path — this
 * one and the full `weaponShot` inside 60 m — so the two cannot disagree at the
 * seam. @see gunRangeGain in src/audio/spatial.js
 */
export function farGain(dist) {
  return gunRangeGain(dist);
}

/**
 * A BURST OF FIRE FROM SOMEWHERE ELSE ON THE MAP — several rounds, ONE voice.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT `weaponShot` WITH A SMALLER GAIN
 * ────────────────────────────────────────────────────────────────────────────
 * A rifle at 120 m is not a rifle at 12 m turned down. Three things have already
 * happened to it by the time it reaches you and none of them are level:
 *
 *  1. THE AIR HAS EATEN THE TOP. Absorption is strongly frequency dependent, so
 *     the 6-12 kHz that makes a near shot *snap* is simply gone; what is left is
 *     a band roughly 300 Hz - 3 kHz. (`SpatialField` already lowpasses per
 *     distance with `airCutoff`; the bands here are shaped for what survives it,
 *     rather than synthesising content the filter then has to remove.)
 *  2. THE TOWN HAS ANSWERED. Between you and the muzzle are facades, and each
 *     one returns the report tens to hundreds of milliseconds later, darker each
 *     time. That is *discrete* and *delayed* — the thing a convolution reverb
 *     cannot produce, and the reason this uses delay taps instead of the send.
 *     THE SEND IS DELIBERATELY NEAR ZERO: 「リバーブが強いです、まだ」 is a
 *     standing complaint and four reverb paths were cut for it. Distance is
 *     solved with time here, not with wetness.
 *  3. IT ARRIVED AS A GROUP. Nobody fires one round: the ear reads a firefight
 *     as CADENCE — bursts, gaps, several weapons overlapping. That is what makes
 *     a battle sound like a battle rather than like a metronome, and it is also
 *     what makes this affordable.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ONE VOICE, N ROUNDS — AND THAT IS THE BUDGET ARGUMENT
 * ────────────────────────────────────────────────────────────────────────────
 * A spatial emitter is the scarce resource in this subsystem (72 of them, shared
 * with per-bus quotas, and a governor that walks the pool down to 24 when the
 * render thread falls behind — see spatial.js). One `weaponShot` is ~40 Web
 * Audio nodes and holds an emitter for its whole tail. Four rounds of it is four
 * emitters and ~160 nodes.
 *
 * This is ~7 nodes per round on ONE emitter: four rounds cost about 22 nodes and
 * one slot, i.e. roughly a seventh of the graph and a quarter of the pool
 * pressure, for the sound the player actually asked for
 * (「また敵味方の銃声があんまり聞こえないのでそれを追加すること 臨場感出して」).
 * The rounds are scheduled INSIDE the voice, so the cadence is sample-accurate
 * and costs no main-thread work at all.
 *
 * @param {object} o { when, rounds, spacing, distance, profile, level }
 */
export function distantFire(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const dist = clamp(o.distance ?? 90, 20, 400);
  const rounds = Math.max(1, Math.min(8, (o.rounds ?? 1) | 0));
  const spacing = clamp(o.spacing ?? 0.09, 0.045, 0.5);
  const p = o.profile ?? WEAPON_PROFILES.rifle;
  const lvl = (o.level ?? 1) * (p.level ?? 1);

  /**
   * VOICE TRIM 0.62 -> 0.95, and this one is deliberately TOO MUCH.
   *
   * It was staged against `weaponShot`'s 0.46 with the difference left to the
   * distance curve — correct in principle, and it has now failed to reach the
   * player three times. 「銃声が方方でなっている感じが戦争です」 is the third telling,
   * and the last measurement before this pass stopped measuring had a coalesced
   * six-round burst arriving 1.6 dB over the ambience bed at 200 m. Two passes
   * of "measured correct" have already been wrong about what reaches him, so
   * this is aimed at being audibly excessive rather than defensibly right: it is
   * the layer that has to sound like a war happening somewhere else, and it is
   * the cheapest thing in the graph to turn back down if it is now too loud
   * (one number, here).
   *
   * It touches THIS LAYER ONLY — the coalesced far burst past 60 m. The full
   * `weaponShot` a man fires at you inside 60 m goes through none of it, so the
   * near mix, which nobody has complained about, does not move.
   */
  const out = gain(actx, 0.95);
  // Everything past the last round's own decay is the town answering.
  const sum = gain(actx, 1);
  out.connect(sum);

  /**
   * THE REPORT BAND, PER CALIBRE AND PER DISTANCE. `crackF` is the weapon's own
   * band close up (1.3 kHz on a .338, 3.3 kHz on a 9 mm); at range the whole
   * thing slides down and narrows, because what survives 150 m of air is the
   * bottom of it. The floor is the reason an AK and an M4 still differ at 90 m
   * and stop differing at 250 — which is true, and is why a far firefight reads
   * as "a firefight" rather than as any particular gun.
   */
  const fall = clamp(1 - (dist - 40) / 260, 0.28, 1);
  const bandF = clamp((p.crackF ?? 2450) * (0.42 + fall * 0.38), 320, 2600);
  const thumpF = clamp((p.bodyF ?? 148) * (0.8 + fall * 0.3), 70, 210);

  let end = t0 + 0.3;
  let lastT = t0;

  for (let i = 0; i < rounds; i++) {
    // Real automatic fire is not a click track: the cyclic rate wanders by a few
    // percent and the shooter's grip changes the spacing over a burst.
    const rt = t0 + i * spacing * rng.range(0.86, 1.16);
    lastT = rt;
    const jl = rng.range(0.82, 1.18) * lvl;

    /* the crack — what is left of the muzzle blast after the atmosphere */
    const src = bank.source('white', rng, rng.range(0.75, 1.15));
    const bp = biquad(actx, 'bandpass', bandF * semis(rng.range(-2, 2)), 1.05);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    // The band falls through the report: the shock front loses its top first.
    sweep(bp.frequency, rt, bandF * 1.3, bandF * 0.72, 0.07);
    ad(g.gain, rt, 0.5 * jl, 0.0016, 0.038 + dist * 0.00012);
    src.start(rt, src._offset, 0.16);

    /* the thump — the low half of the report, which travels much further */
    const th = osc(actx, 'sine', thumpF);
    const tg = gain(actx, 0);
    th.connect(tg); tg.connect(out);
    sweep(th.frequency, rt, thumpF * 1.5, thumpF * 0.72, 0.06);
    ad(tg.gain, rt, 0.34 * jl * (0.5 + fall * 0.5), 0.004, 0.055);
    th.start(rt); th.stop(rt + 0.2);

    end = Math.max(end, rt + 0.2);
  }

  /**
   * THE TOWN'S ANSWER — two discrete returns, not a wash.
   *
   * Same technique as `weaponShot`'s slap-back (layer 8) and for the same
   * measured reason: the convolvers arrive immediately and never resolve into
   * events, so they read as "everything is in a cathedral" rather than as
   * distance. A facade 40 m off the line of fire answers ~230 ms later and has
   * lost its top end; the second one is later, quieter and darker again.
   *
   * The taps are fed from the WHOLE burst, so a six-round burst comes back as a
   * six-round burst — which is the part that reads as a street with buildings in
   * it rather than as one gun in a field.
   */
  let dt = clamp(0.055 + dist * 0.0016, 0.06, 0.34) * rng.range(0.8, 1.25);
  let dl = 0.5;
  let top = clamp(1500 * fall + 260, 300, 1800);
  for (let i = 0; i < 2; i++) {
    const d = actx.createDelay(0.8);
    d.delayTime.value = Math.min(0.75, dt);
    const lp = biquad(actx, 'lowpass', top, 0.7);
    const hp = biquad(actx, 'highpass', 150, 0.7);
    const g = gain(actx, dl);
    series(out, d, hp, lp, g).connect(sum);
    dt += clamp(0.09 + dist * 0.0019, 0.1, 0.42) * rng.range(0.75, 1.35);
    dl *= 0.45;
    top *= 0.6;
  }
  end += dt + 0.1;

  /**
   * THE ROLL. Below about 400 Hz the ground and the air stop taking energy out
   * of the signal, so what a battle a hundred metres away actually sends you is
   * a low rolling swell with the individual reports riding on it. One source for
   * the whole burst, envelope scaled by how many rounds were in it.
   */
  {
    const dur = clamp(0.34 + dist * 0.0026, 0.34, 1.3) * (1 + rounds * 0.09);
    const src = bank.source('brown', rng, rng.range(0.55, 0.95));
    const lp = biquad(actx, 'lowpass', 300, 0.8);
    const g = gain(actx, 0);
    series(src, lp, g).connect(sum);
    sweep(lp.frequency, t0, 430, 150, dur);
    ad(g.gain, t0, 0.6 * lvl * Math.min(1.6, 0.6 + rounds * 0.16), 0.02 + dist * 0.0006, dur);
    src.start(t0, src._offset, dur * 1.3 + 0.05);
    end = Math.max(end, lastT + dur * 1.3);
  }

  // Send stays LOW on purpose. See the head of this function: the room a distant
  // shot lives in is made of the taps above, and the shared convolvers are what
  // the player has already complained about twice.
  return { node: sum, end: end + 0.05, send: 0.06 };
}

/**
 * Supersonic round passing near the listener. Tiny, cheap, and enormously
 * effective at making incoming fire feel dangerous.
 */
export function bulletWhizz(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const miss = clamp(o.miss ?? 1.5, 0.15, 6); // metres from the ear
  const level = clamp(1.1 - miss / 6, 0.1, 1) * (o.gain ?? 1);
  const out = gain(actx, 3.2); // VOICE TRIM
  const src = bank.source('white', rng, rng.range(0.9, 1.2));
  const bp = biquad(actx, 'bandpass', 2400, 3.2);
  const g = gain(actx, 0);
  series(src, bp, g).connect(out);
  // The N-wave's apparent pitch drops sharply as the round passes — Doppler on
  // a Mach 2.5 projectile is violent.
  const dur = 0.055 + miss * 0.012;
  sweep(bp.frequency, t0, rng.range(3600, 5200), rng.range(900, 1500), dur);
  ad(g.gain, t0, 1.5 * level, 0.004, dur);
  src.start(t0, src._offset, dur * 2);
  // Snap of the shock front.
  const s2 = bank.source('white', rng, 1.2);
  const hp = biquad(actx, 'highpass', 4000, 0.7);
  const g2 = gain(actx, 0);
  series(s2, hp, g2).connect(out);
  hit(g2.gain, t0, 0.85 * level, 0.006);
  s2.start(t0, s2._offset, 0.03);
  return { node: out, end: t0 + dur * 2 + 0.05, send: 0.25 };
}

/**
 * THE BOLT THROW — a manually cycled action, which the shot layer cannot carry.
 *
 * `weaponShot`'s MECH layer is a self-loading action: two clacks 30-40 ms apart,
 * done before the muzzle has stopped moving. A bolt gun is nothing like that.
 * It is a second, separate, unhurried EVENT — the shooter lifts the handle,
 * drags the bolt back against the extractor, the case tumbles out, he shoves it
 * forward stripping a round off the stack and rotates the handle down onto the
 * lug. M91-SR's is 1.25 s end to end (defs.js: 48 rpm), and the whole feel of
 * the weapon is that you hear it happen and cannot shoot while it does.
 *
 * Six beats, in the order the hand makes them. Times are FRACTIONS of `dur` so
 * a different bolt gun scales without retuning.
 *
 * @param {object} o { when, dur, distance, firstPerson, level }
 */
export function boltCycle(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const dur = o.dur ?? 0.78;
  const dist = Math.max(0, o.distance ?? 0);
  const fp = !!o.firstPerson;
  // Action noise is a metre from your face in first person and a rumour at 30.
  const lvl = (o.level ?? 1) * (fp ? 1 : 0.55) * clamp(1 - dist / 26, 0, 1);
  const out = gain(actx, 1.15); // VOICE TRIM
  if (lvl < 0.02) return { node: out, end: t0 + 0.05, send: 0.2 };

  const metal = (t, partials, exc = 0.003) =>
    struckResonator(actx, bank, rng, t, partials, exc).connect(out);
  /** Steel dragging in a steel raceway: filtered noise with a moving band. */
  const scrape = (t, len, f0, f1, g0) => {
    const src = bank.source('white', rng, rng.range(0.8, 1.25));
    const bp = biquad(actx, 'bandpass', f0, 2.4);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    sweep(bp.frequency, t, f0, f1, len);
    ad(g.gain, t, g0 * lvl, len * 0.25, len);
    src.start(t, src._offset, len * 2 + 0.05);
  };

  // 1 — handle lifted off the lug: a short, hard, high tick as the cam unseats.
  metal(t0, [
    { f: 3050 * semis(rng.range(-2, 2)), q: 30, g: 0.5 * lvl, decay: 0.022 },
    { f: 5600, q: 20, g: 0.2 * lvl, decay: 0.012 },
    { f: 1180, q: 12, g: 0.28 * lvl, decay: 0.035 },
  ], 0.002);

  // 2 — rearward stroke. The primary extraction is stiff at the start and then
  // the bolt runs free, so the band falls as the drag comes off.
  const backT = t0 + dur * 0.09;
  const backLen = dur * 0.3;
  scrape(backT, backLen, 3400, 1500, 0.34);

  // 3 — the case clears the port. Brass on steel, then brass in the air: bright,
  // short, and slightly late so it reads as a separate object leaving.
  const caseT = backT + backLen * 0.72;
  metal(caseT, [
    { f: 5200 * semis(rng.range(-3, 3)), q: 26, g: 0.24 * lvl, decay: 0.03 },
    { f: 8100, q: 18, g: 0.12 * lvl, decay: 0.014 },
  ], 0.0015);

  // 4 — bolt hits the rear stop. This is the loudest beat and the one that says
  // "the action is open".
  const stopT = backT + backLen;
  metal(stopT, [
    { f: 1620 * semis(rng.range(-1.5, 1.5)), q: 22, g: 0.72 * lvl, decay: 0.055 },
    { f: 3350, q: 16, g: 0.3 * lvl, decay: 0.026 },
    { f: 720, q: 9, g: 0.34 * lvl, decay: 0.07 },
  ], 0.004);

  // 5 — forward stroke, stripping a round off the stack. The band RISES: the
  // round noses into the chamber and the fit tightens.
  const fwdT = t0 + dur * 0.52;
  const fwdLen = dur * 0.26;
  scrape(fwdT, fwdLen, 1700, 3600, 0.28);
  // the cartridge rim snapping under the extractor claw, mid-stroke
  metal(fwdT + fwdLen * 0.6, [
    { f: 4300 * semis(rng.range(-2, 2)), q: 24, g: 0.16 * lvl, decay: 0.018 },
  ], 0.0015);

  // 6 — bolt into battery, then the handle rotating down onto the lug: two
  // clacks a beat apart, the second lower and deader because it is steel wedged
  // into steel rather than steel hitting steel.
  const inT = fwdT + fwdLen;
  metal(inT, [
    { f: 1980 * semis(rng.range(-1.5, 1.5)), q: 20, g: 0.6 * lvl, decay: 0.05 },
    { f: 4100, q: 15, g: 0.24 * lvl, decay: 0.02 },
    { f: 860, q: 8, g: 0.3 * lvl, decay: 0.06 },
  ], 0.0035);
  const lockT = inT + dur * 0.1;
  metal(lockT, [
    { f: 1180 * semis(rng.range(-1.5, 1.5)), q: 13, g: 0.55 * lvl, decay: 0.07 },
    { f: 2450, q: 10, g: 0.2 * lvl, decay: 0.03 },
    { f: 470, q: 6, g: 0.32 * lvl, decay: 0.09 },
  ], 0.005);
  // A 7.62 receiver rings for a moment after that: high, quiet, long.
  metal(lockT + 0.004, [
    { f: 6300 * semis(rng.range(-2, 2)), q: 52, g: 0.06 * lvl, decay: 0.2 },
  ], 0.0015);

  return { node: out, end: lockT + 0.3, send: 0.34 };
}

/** Dry-fire click when the magazine is empty. */
export function dryFire(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const out = gain(actx, 1);
  const r = struckResonator(actx, bank, rng, t0, [
    { f: 2600 * rng.range(0.95, 1.05), q: 24, g: 1.2, decay: 0.035 },
    { f: 4700, q: 16, g: 0.66, decay: 0.02 },
    { f: 860, q: 10, g: 0.5, decay: 0.05 },
  ], 0.0025);
  r.connect(out);
  return { node: out, end: t0 + 0.14, send: 0.2 };
}
