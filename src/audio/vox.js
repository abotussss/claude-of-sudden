/**
 * AUDIO / VOICE — formant synthesis for enemy barks
 *
 * No speech samples, so barks are built the way a vocal tract works:
 *
 *   glottal pulse train (PeriodicWave, 1/n^1.15 harmonics)
 *     + aspiration noise
 *     ─► three parallel band-passes at the formant frequencies F1..F3
 *     ─► chest/throat shaping, presence peak, mild saturation (shouting)
 *     + separately mixed consonant bursts (plosives and fricatives)
 *
 * The formant centres are ramped between vowels, the f0 follows a per-syllable
 * pitch contour, and both are jittered every ~25 ms. That jitter is the single
 * most important ingredient: without it the result is a Speak&Spell, with it a
 * player reads it as a human shouting a word they cannot quite make out — which
 * is exactly the goal for enemy chatter at 30 m.
 */

import { ad, adsr, biquad, clamp, gain, hit, saturationCurve, series, shaper, sweep } from './dsp.js';

/** F1, F2, F3 (Hz) and their bandwidths, adult male, shouted register. */
const VOWELS = {
  a: [730, 1090, 2440, 110, 130, 180],  // "father"
  e: [530, 1840, 2480, 90, 120, 170],   // "bed"
  i: [300, 2290, 3010, 70, 130, 190],   // "see"
  o: [570, 840, 2410, 90, 110, 170],    // "law"
  u: [325, 700, 2530, 70, 100, 170],    // "boot"
  ah: [640, 1200, 2500, 110, 140, 190],
  ehr: [490, 1350, 1690, 100, 130, 180], // "her"
  ohh: [450, 900, 2300, 95, 115, 175],
};

/**
 * Bark scripts. Each syllable: v vowel, d duration, a amplitude, p pitch
 * multiplier, on onset consonant ('p' plosive, 'f' fricative, 'n' nasal),
 * g gap after the syllable.
 */
export const BARKS = {
  /* "CONTACT!" */
  contact: {
    f0: 1.18, drive: 1.25, syl: [
      { v: 'o', d: 0.13, a: 1.0, p: 1.06, on: 'p', g: 0.012 },
      { v: 'a', d: 0.19, a: 1.0, p: 1.16, on: 'p', g: 0 },
    ],
  },
  /* "ENEMY SPOTTED" */
  spotted: {
    f0: 1.1, drive: 1.1, syl: [
      { v: 'e', d: 0.1, a: 0.9, p: 1.05, g: 0.01 },
      { v: 'a', d: 0.08, a: 0.7, p: 1.0, on: 'n', g: 0.01 },
      { v: 'i', d: 0.1, a: 0.8, p: 0.95, g: 0.06 },
      { v: 'a', d: 0.12, a: 1.0, p: 1.1, on: 'f', g: 0.02 },
      { v: 'e', d: 0.13, a: 0.75, p: 0.9, on: 'p', g: 0 },
    ],
  },
  /* "RELOADING!" */
  reloading: {
    f0: 1.05, drive: 1.0, syl: [
      { v: 'i', d: 0.09, a: 0.8, p: 1.0, g: 0.01 },
      { v: 'ohh', d: 0.16, a: 1.0, p: 1.12, g: 0.015 },
      { v: 'i', d: 0.13, a: 0.7, p: 0.9, on: 'p', g: 0 },
    ],
  },
  /* "GRENADE!" — panicked, pitch climbs hard */
  grenade: {
    f0: 1.3, drive: 1.5, syl: [
      { v: 'e', d: 0.1, a: 0.9, p: 1.0, on: 'p', g: 0.012 },
      { v: 'a', d: 0.26, a: 1.15, p: 1.35, on: 'n', g: 0 },
    ],
  },
  /* "FLANKING!" */
  flanking: {
    f0: 1.12, drive: 1.2, syl: [
      { v: 'a', d: 0.16, a: 1.0, p: 1.1, on: 'f', g: 0.015 },
      { v: 'i', d: 0.13, a: 0.8, p: 0.95, on: 'n', g: 0 },
    ],
  },
  /* "SUPPRESSING FIRE!" */
  suppressing: {
    f0: 1.08, drive: 1.15, syl: [
      { v: 'u', d: 0.09, a: 0.75, p: 0.98, on: 'f', g: 0.01 },
      { v: 'e', d: 0.14, a: 1.0, p: 1.12, on: 'p', g: 0.02 },
      { v: 'i', d: 0.1, a: 0.7, p: 0.9, g: 0.05 },
      { v: 'a', d: 0.18, a: 0.95, p: 1.05, on: 'f', g: 0 },
    ],
  },
  /* "MOVE UP!" */
  moveup: {
    f0: 1.1, drive: 1.2, syl: [
      { v: 'u', d: 0.16, a: 1.0, p: 1.08, on: 'n', g: 0.03 },
      { v: 'a', d: 0.14, a: 0.9, p: 1.0, g: 0 },
    ],
  },
  /* wordless taking-fire grunt */
  hit: {
    f0: 1.25, drive: 1.6, breath: 0.5, syl: [
      { v: 'ah', d: 0.16, a: 1.1, p: 1.2, on: 'p', g: 0 },
    ],
  },
  /* pain, longer, wavering */
  pain: {
    f0: 1.15, drive: 1.3, breath: 0.65, tremolo: 14, syl: [
      { v: 'ah', d: 0.34, a: 0.95, p: 1.0, g: 0 },
    ],
  },
  /* death: pitch collapses, breath takes over, ends in an exhale */
  death: {
    f0: 1.05, drive: 1.4, breath: 1.0, tremolo: 22, dying: true, syl: [
      { v: 'ah', d: 0.3, a: 1.0, p: 1.15, g: 0.02 },
      { v: 'ehr', d: 0.42, a: 0.6, p: 0.62, g: 0 },
    ],
  },
  /* short affirmative, for squad chatter */
  copy: {
    f0: 1.0, drive: 0.9, syl: [
      { v: 'a', d: 0.1, a: 0.85, p: 1.0, on: 'p', g: 0.02 },
      { v: 'i', d: 0.12, a: 0.7, p: 0.88, on: 'p', g: 0 },
    ],
  },
};

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE RADIO VOCABULARY — "RogerとかEnemy Spottedとか"
 * ════════════════════════════════════════════════════════════════════════════
 * The nine barks above are EXCLAMATIONS: one man shouting one thing at nobody
 * in particular. A radio net is not that. It is a small number of PHRASES that
 * carry information — a bearing, a landmark, a zone letter — and an even
 * smaller number that carry none at all and exist purely so the net sounds like
 * two people ("ROGER", "COPY", "SET"). You cannot build the first kind by
 * adding nine more one-word specs, because "CONTACT" times eight bearings times
 * three zones is thirty-three specs written by hand and thirty-three chances to
 * get a formant wrong.
 *
 * So the unit here is the WORD, and a phrase is words concatenated with a
 * word gap. `compose()` runs once at module load and writes finished specs into
 * `BARKS` under names `src/ai/radio.js` asks for directly (`barkFor` passes any
 * name it recognises straight through). One phrase is still ONE emitter and one
 * oscillator — a two-word callout costs exactly what "CONTACT!" always cost,
 * which matters because the voice bus is 12 % of the field.
 *
 * The words are not intelligible English and are not trying to be; the note at
 * the top of this file applies unchanged. What a phrase carries is a SHAPE —
 * syllable count, stress placement, the pitch fall at the end of a statement
 * against the flat two-beat of an acknowledgement — and that is what a player
 * reads at 30 m through gunfire.
 */

/** A sibilant coda. English "-st"/"-ce" endings; no amplitude of its own. */
const SIB = { v: 'i', d: 0.035, a: 0.10, p: 0.90, on: 'f' };

/** Words. Each is a syllable run; gaps BETWEEN words are added by `compose`. */
const WORDS = {
  /* — bearings ------------------------------------------------------ */
  north: [{ v: 'o', d: 0.20, a: 1.00, p: 1.10, on: 'n' }],
  south: [{ v: 'a', d: 0.12, a: 0.95, p: 1.06, on: 'f' }, { v: 'u', d: 0.13, a: 0.85, p: 0.94 }, SIB],
  east: [{ v: 'i', d: 0.19, a: 1.00, p: 1.05 }, SIB],
  west: [{ v: 'e', d: 0.18, a: 1.00, p: 1.06, on: 'n' }, SIB],

  /* — landmarks ----------------------------------------------------- */
  inside: [{ v: 'i', d: 0.09, a: 0.70, p: 0.96, on: 'n' },
    { v: 'a', d: 0.15, a: 1.00, p: 1.12, on: 'f' }, { v: 'i', d: 0.07, a: 0.50, p: 0.94 }],
  rooftop: [{ v: 'u', d: 0.14, a: 1.00, p: 1.08 }, { v: 'o', d: 0.12, a: 0.70, p: 0.92, on: 'p' }],
  /* — zone letters (DOMINATION calls them A / C / B) ----------------- */
  alpha: [{ v: 'a', d: 0.14, a: 1.00, p: 1.08 }, { v: 'a', d: 0.12, a: 0.70, p: 0.90, on: 'f' }],
  bravo: [{ v: 'a', d: 0.13, a: 1.00, p: 1.10, on: 'p' }, { v: 'ohh', d: 0.14, a: 0.75, p: 0.90, on: 'f' }],
  charlie: [{ v: 'a', d: 0.14, a: 1.00, p: 1.08, on: 'f' }, { v: 'i', d: 0.13, a: 0.70, p: 0.90 }],

  /* — acknowledgements ---------------------------------------------- */
  roger: [{ v: 'ohh', d: 0.14, a: 1.00, p: 1.06 }, { v: 'ehr', d: 0.15, a: 0.72, p: 0.90, on: 'f' }],
  set: [{ v: 'e', d: 0.17, a: 1.00, p: 1.06, on: 'f' }],

  /* — movement ------------------------------------------------------ */
  moving: [{ v: 'u', d: 0.13, a: 1.00, p: 1.08, on: 'n' }, { v: 'i', d: 0.12, a: 0.72, p: 0.94, on: 'n' }],
  up: [{ v: 'a', d: 0.14, a: 0.95, p: 1.04, on: 'p' }],
  pushing: [{ v: 'u', d: 0.14, a: 1.00, p: 1.10, on: 'p' }, { v: 'i', d: 0.12, a: 0.70, p: 0.92, on: 'f' }],
  holding: [{ v: 'ohh', d: 0.15, a: 1.00, p: 1.08 }, { v: 'i', d: 0.12, a: 0.70, p: 0.90, on: 'p' }],
  in: [{ v: 'i', d: 0.09, a: 0.72, p: 0.98, on: 'n' }],
  position: [{ v: 'o', d: 0.10, a: 0.78, p: 1.00, on: 'p' },
    { v: 'i', d: 0.13, a: 1.00, p: 1.10, on: 'f' }, { v: 'a', d: 0.11, a: 0.58, p: 0.88, on: 'f' }],

  /* — trouble ------------------------------------------------------- */
  cover: [{ v: 'a', d: 0.14, a: 1.00, p: 1.08, on: 'p' }, { v: 'ehr', d: 0.13, a: 0.74, p: 0.92, on: 'f' }],
  me: [{ v: 'i', d: 0.16, a: 0.92, p: 1.00, on: 'n' }],
  pinned: [{ v: 'i', d: 0.20, a: 1.05, p: 1.14, on: 'p' }, { v: 'e', d: 0.08, a: 0.50, p: 0.88, on: 'n' }],
  man: [{ v: 'a', d: 0.16, a: 1.00, p: 1.06, on: 'n' }],
  down: [{ v: 'a', d: 0.16, a: 1.00, p: 1.04, on: 'p' }, { v: 'u', d: 0.10, a: 0.68, p: 0.86, on: 'n' }],
  enemy: [{ v: 'e', d: 0.10, a: 0.90, p: 1.05 }, { v: 'a', d: 0.08, a: 0.70, p: 1.00, on: 'n' },
    { v: 'i', d: 0.10, a: 0.80, p: 0.95 }],

  /* — ordnance and stores ------------------------------------------- */
  frag: [{ v: 'a', d: 0.17, a: 1.05, p: 1.12, on: 'f' }],
  out: [{ v: 'a', d: 0.13, a: 0.95, p: 1.02 }, { v: 'u', d: 0.09, a: 0.60, p: 0.86, on: 'p' }],
  ammo: [{ v: 'a', d: 0.13, a: 1.00, p: 1.06 }, { v: 'ohh', d: 0.13, a: 0.74, p: 0.90, on: 'n' }],
  low: [{ v: 'ohh', d: 0.19, a: 1.00, p: 1.04, on: 'n' }],
  dry: [{ v: 'a', d: 0.20, a: 1.05, p: 1.14, on: 'p' }, { v: 'i', d: 0.08, a: 0.55, p: 0.92 }],

  /* — objective ----------------------------------------------------- */
  secured: [{ v: 'i', d: 0.10, a: 0.70, p: 0.98, on: 'f' },
    { v: 'u', d: 0.17, a: 1.00, p: 1.10, on: 'p' }, { v: 'ehr', d: 0.09, a: 0.50, p: 0.86 }],
  lost: [{ v: 'o', d: 0.19, a: 1.00, p: 1.06, on: 'n' }, SIB],
  we: [{ v: 'i', d: 0.10, a: 0.70, p: 0.98, on: 'n' }],
  contact: BARKS.contact.syl,
};

/** The gap between two words of one transmission. Shorter than a breath. */
const WORD_GAP = 0.075;

/**
 * Write `BARKS[name]` as the concatenation of `words`.
 *
 * The last syllable of every word but the last gets `WORD_GAP`; the phrase's
 * final syllable keeps `g: 0` so `bark()`'s "last syllable decays longer" rule
 * still fires on the right one. Nothing is mutated: the run is rebuilt with
 * spread, so `WORDS.down` is safe to use in six phrases.
 */
function compose(name, f0, drive, words) {
  const syl = [];
  for (let w = 0; w < words.length; w++) {
    const run = WORDS[words[w]];
    for (let i = 0; i < run.length; i++) {
      const last = i === run.length - 1;
      syl.push({ ...run[i], g: last ? (w === words.length - 1 ? 0 : WORD_GAP) : (run[i].g ?? 0.012) });
    }
  }
  BARKS[name] = { f0, drive, syl };
}

/**
 * CONTACT REPORTS. A bearing or a landmark, which is the whole difference
 * between "there is a man" and "there is a man to the north-east": `src/ai`
 * knows the direction from the speaker to what he saw and picks the name.
 * Urgent register — f0 1.16, drive 1.25, same as the bare "CONTACT!".
 */
for (const dir of ['north', 'south', 'east', 'west']) {
  compose(`contact_${dir}`, 1.16, 1.25, ['contact', dir]);
}
compose('contact_northeast', 1.16, 1.25, ['contact', 'north', 'east']);
compose('contact_northwest', 1.16, 1.25, ['contact', 'north', 'west']);
compose('contact_southeast', 1.16, 1.25, ['contact', 'south', 'east']);
compose('contact_southwest', 1.16, 1.25, ['contact', 'south', 'west']);
compose('contact_inside', 1.16, 1.25, ['contact', 'inside']);
compose('contact_rooftop', 1.16, 1.25, ['contact', 'rooftop']);

/**
 * ANSWERS. Flat, unhurried, and SHORT — an acknowledgement that sounds as
 * urgent as the contact report it answers reads as two men panicking rather
 * than as one man being told something. f0 1.0 and drive 0.9 is the "copy"
 * register that already existed.
 */
compose('roger', 1.00, 0.90, ['roger']);
compose('setpos', 1.00, 0.95, ['set']);
compose('inposition', 1.00, 0.95, ['in', 'position']);

/* — status, trouble, ordnance, objective ---------------------------- */
compose('movingup', 1.08, 1.10, ['moving', 'up']);
compose('pushing', 1.12, 1.20, ['pushing']);
compose('holding', 1.02, 1.00, ['holding']);
compose('coverme', 1.22, 1.35, ['cover', 'me']);
compose('pinned', 1.26, 1.45, ['pinned', 'down']);
compose('mandown', 1.18, 1.30, ['man', 'down']);
compose('enemydown', 1.06, 1.05, ['enemy', 'down']);
compose('fragout', 1.28, 1.40, ['frag', 'out']);
compose('ammolow', 1.08, 1.05, ['ammo', 'low']);
compose('ammodry', 1.24, 1.35, ['ammo', 'dry']);
compose('ammoup', 1.02, 0.95, ['ammo', 'up']);
for (const z of ['alpha', 'bravo', 'charlie']) {
  compose(`secured_${z}`, 1.06, 1.05, [z, 'secured']);
  compose(`lost_${z}`, 1.16, 1.25, ['we', 'lost', z]);
}

const WAVE_CACHE = new WeakMap();

/** Glottal-ish pulse: strong fundamental, 1/n^1.15 rolloff, alternating phase. */
function glottalWave(actx) {
  let w = WAVE_CACHE.get(actx);
  if (w) return w;
  const N = 40;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  for (let n = 1; n < N; n++) {
    imag[n] = (1 / Math.pow(n, 1.15)) * (n % 2 === 0 ? -0.75 : 1);
  }
  w = actx.createPeriodicWave(real, imag, { disableNormalization: false });
  WAVE_CACHE.set(actx, w);
  return w;
}

/**
 * Synthesize a bark.
 *
 * @param {object} o { when, bark, f0 (base Hz), tract (0.9..1.1), level,
 *                     radio (bool), distance }
 */
export function bark(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const spec = BARKS[o.bark] ?? BARKS.contact;
  const tract = o.tract ?? rng.range(0.94, 1.07);
  const f0 = (o.f0 ?? rng.range(96, 132)) * spec.f0;
  const level = o.level ?? 1;
  const out = gain(actx, 0.2); // VOICE TRIM

  const total = spec.syl.reduce((s, x) => s + x.d + (x.g ?? 0), 0);

  /* ---- source ---------------------------------------------------- */
  const src = actx.createOscillator();
  src.setPeriodicWave(glottalWave(actx));
  const srcGain = gain(actx, 0);
  src.connect(srcGain);

  // Aspiration: always a little, a lot when hurt or dying.
  const breathLevel = (spec.breath ?? 0.16) * rng.range(0.8, 1.25);
  const noise = bank.source('white', rng, rng.range(0.9, 1.2));
  const noiseBP = biquad(actx, 'bandpass', 1400, 0.6);
  const noiseGain = gain(actx, 0);
  series(noise, noiseBP, noiseGain);

  const excite = gain(actx, 1);
  srcGain.connect(excite);
  noiseGain.connect(excite);

  /* ---- formant bank ---------------------------------------------- */
  const first = VOWELS[spec.syl[0].v] ?? VOWELS.a;
  const fs = [];
  for (let i = 0; i < 3; i++) {
    const f = first[i] * tract;
    const bw = first[i + 3];
    const bp = biquad(actx, 'bandpass', f, clamp(f / bw, 1.5, 14));
    const g = gain(actx, [1.0, 0.55, 0.24][i]);
    excite.connect(bp);
    bp.connect(g);
    fs.push({ bp, g });
  }

  /* ---- vocal tract output shaping -------------------------------- */
  const throat = biquad(actx, 'peaking', 480, 1.1, 4);      // chest resonance
  const presence = biquad(actx, 'peaking', 2600, 1.4, 5);   // shout presence
  const hp = biquad(actx, 'highpass', 150, 0.7);
  const lp = biquad(actx, 'lowpass', 5200, 0.7);
  const drv = shaper(actx, saturationCurve(1.6 * (spec.drive ?? 1), 0.35), '2x');
  const bodyGain = gain(actx, 1.5 * level);
  for (const f of fs) f.g.connect(throat);
  series(throat, presence, hp, lp, drv, bodyGain).connect(out);

  /* ---- tremolo (pain / death gargle) ----------------------------- */
  let trem = null;
  if (spec.tremolo) {
    trem = actx.createOscillator();
    trem.type = 'sine';
    trem.frequency.value = spec.tremolo * rng.range(0.85, 1.15);
    const tg = gain(actx, 0.35);
    trem.connect(tg);
    tg.connect(bodyGain.gain);
    trem.start(t0);
    trem.stop(t0 + total + 0.4);
  }

  /* ---- per-syllable automation ----------------------------------- */
  let t = t0;
  src.frequency.setValueAtTime(f0 * spec.syl[0].p, t0);
  for (let i = 0; i < spec.syl.length; i++) {
    const s = spec.syl[i];
    const v = VOWELS[s.v] ?? VOWELS.a;
    const amp = s.a * 0.5;

    /* onset consonant, mixed straight to the output */
    if (s.on) {
      // Onsets lead the vowel; never let that run off the start of the timeline.
      const ct = Math.max(t - (s.on === 'f' ? 0.055 : 0.018), 0);
      const cs = bank.source('white', rng, rng.range(0.9, 1.3));
      const cbp = biquad(actx, s.on === 'f' ? 'bandpass' : 'highpass',
        s.on === 'f' ? rng.range(3800, 6500) : rng.range(1400, 2600),
        s.on === 'f' ? 1.1 : 0.7);
      const cg = gain(actx, 0);
      series(cs, cbp, cg).connect(out);
      if (s.on === 'f') {
        ad(cg.gain, ct, 0.1 * level, 0.012, 0.05);
        cs.start(ct, cs._offset, 0.12);
      } else if (s.on === 'n') {
        // Nasal: hum through a low formant instead of a burst.
        ad(cg.gain, ct, 0.02 * level, 0.01, 0.04);
        cs.start(ct, cs._offset, 0.08);
        fs[0].bp.frequency.setValueAtTime(260 * tract, ct);
      } else {
        hit(cg.gain, ct, 0.16 * level, 0.014);
        cs.start(ct, cs._offset, 0.05);
      }
    }

    /* formant glide into this vowel — 35 ms transition reads as articulation */
    for (let k = 0; k < 3; k++) {
      const f = v[k] * tract * (1 + rng.range(-0.02, 0.02));
      const bw = v[k + 3];
      fs[k].bp.frequency.setTargetAtTime(f, Math.max(t - 0.03, t0), 0.014);
      fs[k].bp.Q.setTargetAtTime(clamp(f / bw, 1.5, 14), Math.max(t - 0.03, t0), 0.02);
    }

    /* pitch contour: rise into the stressed syllable, sag at the end */
    const pTarget = f0 * s.p;
    src.frequency.setTargetAtTime(pTarget, t, 0.03);
    if (spec.dying && i === spec.syl.length - 1) {
      sweep(src.frequency, t + 0.05, pTarget, pTarget * 0.45, s.d);
    } else {
      src.frequency.setTargetAtTime(pTarget * 0.94, t + s.d * 0.6, 0.06);
    }

    /* amplitude: fast onset, held, quick release; last syllable decays longer */
    const last = i === spec.syl.length - 1;
    const rel = last ? (spec.dying ? s.d * 0.9 : 0.055) : 0.028;
    adsr(srcGain.gain, t, amp * level, 0.014, s.d * 0.22, s.d * 0.5, 0.72, rel);
    ad(noiseGain.gain, t, amp * breathLevel * level, 0.02, s.d + rel);

    t += s.d + (s.g ?? 0);
  }

  /* ---- dying exhale ---------------------------------------------- */
  if (spec.dying) {
    const et = t + 0.05;
    const es = bank.source('white', rng, rng.range(0.6, 0.9));
    const ebp = biquad(actx, 'bandpass', 700, 0.55);
    const eg = gain(actx, 0);
    series(es, ebp, eg).connect(out);
    sweep(ebp.frequency, et, 900, 380, 0.6);
    ad(eg.gain, et, 0.16 * level, 0.08, 0.6);
    es.start(et, es._offset, 0.9);
    t = et + 0.7;
  }

  const end = t + 0.35;
  const srcStart = Math.max(t0 - 0.01, 0);
  src.start(srcStart);
  src.stop(end);
  noise.start(srcStart, noise._offset, end - srcStart + 0.05);

  /* ---- radio treatment (squad comms) ----------------------------- */
  if (o.radio) {
    const rbp1 = biquad(actx, 'highpass', 420, 0.8);
    const rbp2 = biquad(actx, 'lowpass', 3200, 0.9);
    const rdrv = shaper(actx, saturationCurve(7, 0.3), '2x');
    const rg = gain(actx, 1.1);
    const radioOut = gain(actx, 1);
    series(out, rbp1, rbp2, rdrv, rg).connect(radioOut);
    // Squelch click at both ends of the transmission.
    for (const st of [Math.max(t0 - 0.05, 0), end - 0.2]) {
      const cs = bank.source('white', rng, 1.1);
      const cbp = biquad(actx, 'bandpass', 2600, 1.6);
      const cg = gain(actx, 0);
      series(cs, cbp, cg).connect(radioOut);
      hit(cg.gain, st, 0.09, 0.03);
      cs.start(st, cs._offset, 0.06);
    }
    return { node: radioOut, end: end + 0.1, send: 0.05 };
  }

  return { node: out, end: end + 0.1, send: 0.45 };
}

/** Pick a plausible bark for an AI event without the ai agent knowing our list. */
export function barkFor(kind, rng) {
  /**
   * A CALLER MAY NAME A VOICE EXACTLY. `src/ai/radio.js` composes a transmission
   * from what the man actually knows — a bearing, a zone letter, whether he is
   * indoors — and there is no way to express that through the nine semantic
   * kinds below. Anything already in `BARKS` passes through untouched.
   *
   * This changes nothing for the existing callers: of their kinds only
   * `grenade`, `copy` and `death` are `BARKS` keys, and each already mapped to
   * the spec of the same name.
   */
  if (BARKS[kind]) return kind;
  switch (kind) {
    case 'spot': return rng.float() < 0.5 ? 'contact' : 'spotted';
    case 'reload': return 'reloading';
    case 'grenade': return 'grenade';
    case 'flank': return 'flanking';
    case 'suppress': return 'suppressing';
    case 'advance': return 'moveup';
    case 'hurt': return rng.float() < 0.5 ? 'hit' : 'pain';
    case 'death': return 'death';
    case 'copy': return 'copy';
    default: return 'contact';
  }
}
