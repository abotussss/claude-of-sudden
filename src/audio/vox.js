/**
 * AUDIO / RADIO SIGNALS — what the squad net sounds like.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THERE IS NO VOICE HERE ANY MORE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * This file used to synthesise SPEECH: a glottal pulse train through three
 * parallel formant band-passes, ramped between vowels, with consonant bursts
 * mixed on top, composed into thirty phrases from a syllable-level word table.
 * It was built to sound like "a human shouting a word you cannot quite make
 * out". Played, it sounds like a machine imitating a person, and the player
 * said so:
 *
 *   「AIが発生する無線音声が機械音声なので不気味すぎるからやめて、
 *     YouTubeとかでまともな音声拾ってきて、ないなら変な機械音声やめて」
 *
 * There is no real speech to fetch. This project ships no assets at all — every
 * texture, mesh, animation and sound is generated at load time, `three` is the
 * only dependency, and the game must run offline; pulling somebody's voice off a
 * video site is neither available here nor ours to use. The player named the
 * fallback himself, so this is the fallback: THE MACHINE VOICE IS GONE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT REPLACES IT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The net itself was never the problem. `src/ai/radio.js` is a measured system —
 * two rate-limited nets, seventeen kinds in use, ~30 transmissions a minute in
 * contact, answered about half the time, and it never evicts gunfire. All of
 * that is untouched. What changed is what a transmission SOUNDS like, and the
 * answer is the language a real radio uses when nobody is talking:
 *
 *   SQUELCH BREAK   the carrier opening — a short burst of band-limited noise
 *                   with a click on the front. This is the "somebody keyed a
 *                   handset" that makes the rest read as a radio at all.
 *   SIGNAL          one to three filtered tones whose SHAPE is the message
 *                   class: rising for a contact, three fast highs for a threat,
 *                   falling for a status call, low doubles for stores, a run up
 *                   for a point taken and the same run down for a point lost.
 *   CLICK-ACK       an acknowledgement is not a tone at all, it is two clicks of
 *                   the squelch. That is what "roger" sounds like on a net where
 *                   nobody wants to say anything, and it reads instantly as
 *                   "somebody answered" without pretending to be a word.
 *   TAIL            the carrier closing.
 *
 * All of it runs through the same radio band the old voice path used for its
 * `radio: true` case (420 Hz .. 3.2 kHz, saturated), because it is coming out of
 * a handset either way — in the player's ear, or across the street on somebody's
 * chest.
 *
 * WHAT IS HONESTLY LOST: the bearing. `contact_north` and `contact_east` are now
 * the same signal, because there is no non-verbal way to say "north" that a
 * player could learn without a manual, and the syllables that used to carry it
 * were never intelligible either. The information still exists — the man is on
 * the minimap the moment somebody sees him (`ai.getHudActors`), he is bracketed
 * in the world if the player has line of sight, and the killfeed carries the
 * rest. A radio tone says "there is traffic and this is what kind"; the HUD says
 * where.
 *
 * WHAT IS NOT A RADIO. Being hit, being hurt and dying are not transmissions —
 * they are a man's own body, and a beep for them would be worse than the voice
 * was. Those three are NOISE ONLY: a filtered breath burst with an envelope and
 * no pitched source anywhere in the chain, so there is nothing in them that can
 * read as a synthesised vowel. They skip the radio band entirely and keep the
 * reverb send the old vocal path had.
 *
 * WHAT THIS COSTS. One transmission is 1-3 short oscillators and 2-3 noise
 * bursts, against the old path's oscillator + three band-passes + a noise source
 * per syllable (up to nine syllables in a composed phrase) — strictly cheaper.
 * The emitter count per bark is unchanged at ONE, which is what the voice bus
 * budget is written against.
 *
 * The public surface is unchanged: `BARKS` (every name `src/ai/radio.js` asks
 * for), `bark(actx, bank, rng, o)` returning `{ node, end, send }`, and
 * `barkFor(kind, rng)`.
 */

import { ad, biquad, clamp, gain, hit, saturationCurve, series, shaper, sweep } from './dsp.js';

/* ------------------------------------------------------------------ */
/* The signal vocabulary                                               */
/* ------------------------------------------------------------------ */

/**
 * A CLASS is a shape, not a word. Seven of them plus the click, and they are
 * told apart in one hearing because they differ in the two things a listener
 * reads first: how many tones there are, and which way they go.
 *
 * `tones` is `[frequencyHz, seconds]` pairs, `gap` the silence between them,
 * `wave` the oscillator, `level` the class's own loudness — a threat is louder
 * than a stores call, which is most of the point of having classes at all.
 */
const SIGNALS = {
  /* enemy seen — two tones, up, quick. The most common call on the net. */
  contact: { tones: [[880, 0.070], [1330, 0.095]], gap: 0.028, wave: 'square', level: 1.00 },
  /* grenade / pinned / man down / frag out — three fast highs, unmistakable */
  threat: { tones: [[1560, 0.052], [1560, 0.052], [1560, 0.070]], gap: 0.034, wave: 'square', level: 1.12 },
  /* moving, holding, reloading, suppressing — two tones, down, unhurried */
  status: { tones: [[1180, 0.080], [790, 0.105]], gap: 0.030, wave: 'triangle', level: 0.80 },
  /* ammunition and grenades — two low tones at the same pitch */
  stores: { tones: [[620, 0.075], [620, 0.095]], gap: 0.045, wave: 'triangle', level: 0.78 },
  /* one of theirs is down — a single mid confirm */
  confirm: { tones: [[1040, 0.115]], gap: 0, wave: 'triangle', level: 0.84 },
  /* a capture point taken — a run up */
  objective: { tones: [[740, 0.070], [990, 0.070], [1245, 0.120]], gap: 0.026, wave: 'square', level: 1.02 },
  /* a capture point lost — the same run, down */
  lost: { tones: [[1245, 0.070], [990, 0.070], [740, 0.130]], gap: 0.026, wave: 'square', level: 1.02 },
  /* "roger" — two clicks of the squelch and nothing else */
  ack: { tones: [], gap: 0, clicks: 2, level: 0.72 },
};

/**
 * NOT A RADIO — the three vocalisations that are a body rather than a handset.
 * `band` is the noise band-pass, swept from `band[0]` to `band[1]`; `dur` the
 * envelope; `tail` an optional second, longer exhale.
 */
const EFFORTS = {
  hit: { band: [780, 700], dur: 0.10, attack: 0.006, level: 0.62, q: 0.75, makeup: 11 },
  pain: { band: [820, 540], dur: 0.30, attack: 0.014, level: 0.58, q: 0.62, wobble: 13, makeup: 3.4 },
  death: {
    band: [760, 380], dur: 0.30, attack: 0.012, level: 0.66, q: 0.6, wobble: 9, makeup: 3.8,
    tail: { band: [520, 240], dur: 0.70, level: 0.30, q: 0.5, makeup: 4.6 },
  },
};

/**
 * MAKEUP IS NOT DECORATION. A band-pass has unity gain only at its centre, so a
 * short white burst through a Q of 0.75 comes out ~26 dB down and a longer one
 * through 0.62 comes out ~17 dB down — MEASURED, by rendering these through the
 * real mixer offline and reading the peak: the first cut of this file peaked at
 * 0.0076 for `hit` against 0.19 for a radio signal, i.e. inaudible next to
 * everything else on the voice bus. `makeup` is per spec because the loss is a
 * function of the band and the envelope, not a constant.
 */

/**
 * EVERY NAME `src/ai/radio.js` AND `src/audio/index.js` CAN ASK FOR, mapped to a
 * class. The names are the net's vocabulary and are deliberately not renamed:
 * `radio.js` composes them from what a man knows (a bearing, a zone letter,
 * whether he is indoors) and nothing there had to change to make this file stop
 * talking. Several names collapse onto one signal — that is exactly where the
 * bearing is dropped, and it is stated in the header.
 *
 * `src/audio/selftest.js` renders every key in here through the real mixer and
 * the offline probe checks each for silence, NaN, DC and clipping, so a name
 * without a class would be caught as a silent case rather than shipped.
 */
export const BARKS = {};

const CLASS_OF = {
  contact: 'contact', spotted: 'contact',
  contact_north: 'contact', contact_south: 'contact',
  contact_east: 'contact', contact_west: 'contact',
  contact_northeast: 'contact', contact_northwest: 'contact',
  contact_southeast: 'contact', contact_southwest: 'contact',
  contact_inside: 'contact', contact_rooftop: 'contact',

  grenade: 'threat', fragout: 'threat', pinned: 'threat',
  coverme: 'threat', mandown: 'threat',

  reloading: 'status', flanking: 'status', suppressing: 'status',
  moveup: 'status', movingup: 'status', pushing: 'status',
  holding: 'status', inposition: 'status',

  ammolow: 'stores', ammodry: 'stores', ammoup: 'stores',

  enemydown: 'confirm',

  secured_alpha: 'objective', secured_bravo: 'objective', secured_charlie: 'objective',
  lost_alpha: 'lost', lost_bravo: 'lost', lost_charlie: 'lost',

  roger: 'ack', copy: 'ack', setpos: 'ack',

  hit: 'effort', pain: 'effort', death: 'effort',
};

for (const name of Object.keys(CLASS_OF)) {
  const cls = CLASS_OF[name];
  BARKS[name] = cls === 'effort'
    ? { cls, effort: EFFORTS[name] ?? EFFORTS.hit }
    : { cls, signal: SIGNALS[cls] };
}

/* ------------------------------------------------------------------ */
/* Synthesis                                                           */
/* ------------------------------------------------------------------ */

/**
 * A squelch burst: the carrier opening or closing. Noise through a narrow band,
 * 30-42 ms, straight into a decay so the front of it is a click. Two of these
 * back to back IS the acknowledgement, so this is the most reused piece here.
 */
function squelch(actx, bank, rng, out, t, level, bright) {
  const src = bank.source('white', rng, rng.range(0.95, 1.2));
  const hp = biquad(actx, 'highpass', 520, 0.7);
  const bp = biquad(actx, 'bandpass', bright ? 2100 : 1500, 0.85);
  const g = gain(actx, 0);
  series(src, hp, bp, g).connect(out);
  const dur = bright ? 0.030 : 0.042;
  hit(g.gain, t, level, dur);
  src.start(t, src._offset, dur + 0.02);
  return t + dur;
}

/** One filtered tone of the signal. */
function beep(actx, out, t, freq, dur, wave, level) {
  const o = actx.createOscillator();
  o.type = wave;
  o.frequency.setValueAtTime(freq, t);
  // A hair of drift across the tone: a perfectly steady square is the thing that
  // sounds like a test bench rather than a handset.
  o.frequency.linearRampToValueAtTime(freq * 0.995, t + dur);
  const bp = biquad(actx, 'bandpass', freq, 1.1);
  const g = gain(actx, 0);
  series(o, bp, g).connect(out);
  // 5 ms in, then decayed out over the tone — the shortest edges a small speaker
  // can make without adding a click of its own.
  ad(g.gain, t, level, 0.005, dur);
  o.start(t);
  o.stop(t + dur + 0.05);
  return t + dur;
}

/** The body-noise vocalisations. No oscillator anywhere in this signal path. */
function effort(actx, bank, rng, out, t, spec, level) {
  const src = bank.source('white', rng, rng.range(0.75, 1.05));
  const bp = biquad(actx, 'bandpass', spec.band[0], spec.q);
  const lp = biquad(actx, 'lowpass', 2600, 0.7);
  const g = gain(actx, 0);
  const mk = gain(actx, spec.makeup ?? 1);
  series(src, bp, lp, g, mk).connect(out);
  sweep(bp.frequency, t, spec.band[0], spec.band[1], spec.dur);
  const attack = spec.attack ?? 0.01;
  ad(g.gain, t, spec.level * level, attack, spec.dur);
  src.start(t, src._offset, spec.dur + attack + 0.1);
  let end = t + attack + spec.dur;
  if (spec.wobble) {
    // amplitude waver, not pitch: a wavering NOISE band is a man breathing hard,
    // a wavering tone is a siren.
    const lfo = actx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = spec.wobble * rng.range(0.85, 1.15);
    const lg = gain(actx, 0.3);
    lfo.connect(lg);
    lg.connect(g.gain);
    lfo.start(t);
    lfo.stop(end + 0.05);
  }
  if (spec.tail) {
    end = effort(actx, bank, rng, out, end + 0.04,
      { ...spec.tail, attack: 0.05, wobble: 0 }, level);
  }
  return end;
}

/**
 * Synthesize one transmission.
 *
 * @param {object} o { when, bark, f0 (per-set tuning), tract (accepted and
 *                     unused), level, radio (bool) }
 * @returns {{node: AudioNode, end: number, send: number}}
 */
export function bark(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const spec = BARKS[o.bark] ?? BARKS.contact;
  const level = o.level ?? 1;
  /**
   * VOICE TRIM, set against the OLD path rather than by ear. The formant voice
   * this replaced rendered at peak 0.065-0.11 through the real mixer (offline
   * self test, `bark:*` rows); the first cut of the signals came out at
   * 0.15-0.21, i.e. twice as loud as the thing it replaced, which would have
   * quietly rebalanced the whole voice bus. The per-element levels below are
   * halved to land in the same band.
   */
  const out = gain(actx, 0.32); // VOICE TRIM

  /* ---- a body, not a handset -------------------------------------- */
  if (spec.effort) {
    const end = effort(actx, bank, rng, out, t0, spec.effort, level);
    return { node: out, end: end + 0.25, send: 0.45 };
  }

  /**
   * PER-SET TUNING. `o.f0` used to be the speaker's vocal pitch (96..136 Hz) and
   * is still handed over per speaker id by `audio.bark`; here it detunes his
   * handset by ±12 %, so two men on the same net are still two men and the
   * existing per-speaker seeding did not have to change.
   */
  const tune = clamp(0.92 + (((o.f0 ?? 112) - 96) / 40) * 0.16, 0.88, 1.12);
  const sig = spec.signal ?? SIGNALS.contact;
  const lvl = (sig.level ?? 1) * level;

  let t = squelch(actx, bank, rng, out, t0, 0.24 * lvl, false) + 0.022;

  /* an acknowledgement is clicks, not tones */
  for (let i = 1; i < (sig.clicks ?? 0); i++) {
    t = squelch(actx, bank, rng, out, t + 0.055, 0.28 * lvl, true);
  }

  for (let i = 0; i < sig.tones.length; i++) {
    const [f, d] = sig.tones[i];
    t = beep(actx, out, t, f * tune, d, sig.wave ?? 'square', 0.34 * lvl);
    if (i < sig.tones.length - 1) t += sig.gap;
  }

  /* carrier closing */
  const end = squelch(actx, bank, rng, out, t + 0.030, 0.17 * lvl, false);

  /**
   * THE RADIO BAND — the same chain the old voice path used for `radio: true`,
   * now on every transmission, because it is a handset either way: in the
   * player's ear (`o.radio`, dry and head-locked) or on the chest of a man across
   * the street (spatialised, with the room on it).
   */
  const hp = biquad(actx, 'highpass', 420, 0.8);
  const lp = biquad(actx, 'lowpass', 3200, 0.9);
  const drv = shaper(actx, saturationCurve(o.radio ? 7 : 4.5, 0.3), '2x');
  const trim = gain(actx, o.radio ? 1.1 : 0.95);
  const radioOut = gain(actx, 1);
  series(out, hp, lp, drv, trim).connect(radioOut);
  return { node: radioOut, end: end + 0.10, send: o.radio ? 0.05 : 0.4 };
}

/**
 * Pick a signal for an AI event without the caller knowing our list.
 *
 * A CALLER MAY NAME A SIGNAL EXACTLY. `src/ai/radio.js` composes a transmission
 * from what the man actually knows and passes the finished name; anything
 * already in `BARKS` goes through untouched. The semantic kinds below are the
 * older, coarser callers in `src/audio/index.js`.
 */
export function barkFor(kind, rng) {
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
