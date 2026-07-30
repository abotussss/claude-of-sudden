/**
 * AUDIO / SELF TEST
 *
 * Renders every voice through the real mixer graph in an OfflineAudioContext
 * and measures what came out. This is how the audio subsystem is verified:
 * screenshots prove nothing about sound, and OfflineAudioContext needs no user
 * gesture, so the whole synthesis path can be exercised headlessly.
 *
 * For each case we report:
 *   peak     absolute sample peak — >= 1.0 means the limiter failed
 *   rms      loudness; 0 means the voice is silent (a bug)
 *   dc       mean sample value; a large offset means an envelope never closed
 *   nan      any non-finite samples (bad exponentialRamp targets, /0, ...)
 *   centroid rough spectral centre of mass in Hz (via zero-crossing rate),
 *            enough to prove a "distant" shot is darker than a near one
 *   d20/d40  ENVELOPE. Seconds from the loudest 10 ms block until the RMS
 *            envelope has fallen 20 dB and 40 dB below it. This is the only
 *            number that can tell "the blast has a long tail" apart from "the
 *            blast is loud", and it is the one that says whether that tail is
 *            coming out of the synthesis or out of the convolvers: render the
 *            same voice with the send scaled to 0 and compare.
 *
 * Usage from a page (see probe.mjs):
 *   const { runAudioSelfTest } = await import('/src/audio/selftest.js');
 *   const report = await runAudioSelfTest();
 */

import { Rng } from '../core/rng.js';
import { NoiseBank } from './dsp.js';
import { Mixer } from './mixer.js';
import { WEAPON_PROFILES, weaponShot, bulletWhizz, dryFire, boltCycle } from './weapons.js';
import {
  surfaceImpact, footstep, shellCasing, reloadPhase, explosion, bodyFall, uiSound,
  heartbeat, cloth, meleeSwing, meleeHit,
} from './foley.js';
import {
  strikeJet, strikeIncoming, strikeRubble, strikeTail, strafeCannon, rubbleCollapse,
} from './airstrike.js';
import { bark, BARKS } from './vox.js';
import { ambientOneShot, ONE_SHOTS } from './ambience.js';
import { IR_SPECS, generateIR, classifySpace } from './ir.js';

const SR = 48000;

function measure(buf) {
  const n = buf.length;
  let peak = 0, sum = 0, sumSq = 0, nan = 0, crossings = 0;
  let prev = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { nan++; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v;
      sumSq += v * v;
      if (ch === 0) {
        if ((v > 0 && prev <= 0) || (v < 0 && prev >= 0)) crossings++;
        prev = v;
      }
    }
  }
  const total = n * buf.numberOfChannels;
  const rms = Math.sqrt(sumSq / total);
  // Zero crossing rate -> a crude but stable spectral centre indicator.
  const centroid = (crossings / (n / SR)) * 0.5;
  const env = decay(buf);
  return {
    peak: +peak.toFixed(4),
    rms: +rms.toFixed(5),
    dc: +(sum / total).toFixed(5),
    nan,
    centroid: Math.round(centroid),
    d20: env.d20,
    d40: env.d40,
  };
}

/** 10 ms RMS envelope, in blocks. Coarse on purpose: it has to be stable. */
const ENV_BLOCK = Math.round(SR * 0.01);

/**
 * Seconds from the loudest envelope block until the envelope has fallen 20 dB
 * and 40 dB below it. `-1` means it never got that far inside the render, which
 * is itself information — a six second tail in a six second render will say -1
 * for d40 and that is not a failure.
 */
function decay(buf) {
  const d = buf.getChannelData(0);
  const blocks = Math.floor(d.length / ENV_BLOCK);
  if (blocks < 3) return { d20: -1, d40: -1 };
  const env = new Float64Array(blocks);
  let peakAt = 0;
  for (let b = 0; b < blocks; b++) {
    let s = 0;
    const o = b * ENV_BLOCK;
    for (let i = 0; i < ENV_BLOCK; i++) { const v = d[o + i]; s += v * v; }
    env[b] = Math.sqrt(s / ENV_BLOCK);
    if (env[b] > env[peakAt]) peakAt = b;
  }
  const pk = env[peakAt];
  if (pk <= 0) return { d20: -1, d40: -1 };
  const after = (frac) => {
    const target = pk * frac;
    // First block at or below the target that STAYS there — a single quiet block
    // between two loud ones is a gap in the grain, not the end of the sound.
    for (let b = peakAt + 1; b < blocks; b++) {
      if (env[b] > target) continue;
      let held = true;
      for (let k = b; k < Math.min(blocks, b + 5); k++) if (env[k] > target) { held = false; break; }
      if (held) return +(((b - peakAt) * ENV_BLOCK) / SR).toFixed(3);
    }
    return -1;
  };
  return { d20: after(0.1), d40: after(0.01) };
}

/** One offline render: build a fresh mixer, run `fn`, measure the master out. */
async function renderCase(seconds, seed, fn, opts = {}) {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const rng = new Rng(seed);
  const bank = new NoiseBank(ctx, rng.fork(), 1.2);
  const mixer = new Mixer(ctx, rng.fork(), {});
  if (opts.reverb !== false) mixer.buildReverbs();
  if (opts.space) mixer.setSpace(opts.space, 0.001);
  fn({ ctx, rng, bank, mixer, t: 0.02 });
  const buf = await ctx.startRendering();
  return measure(buf);
}

/** Connect a voice to a bus and its reverb send, the way the live system does. */
function route(mixer, voice, busName = 'weapons', sendScale = 1) {
  voice.node.connect(mixer.bus(busName));
  if ((voice.send ?? 0) > 0) {
    const g = mixer.actx.createGain();
    g.gain.value = voice.send * sendScale;
    voice.node.connect(g);
    g.connect(mixer.reverbSend);
  }
  return voice;
}

export async function runAudioSelfTest(opts = {}) {
  const results = [];
  const push = async (name, seconds, fn, o) => {
    const t0 = performance.now();
    try {
      const m = await renderCase(seconds, 0xA0D10 + results.length * 7919, fn, o);
      results.push({ name, ms: Math.round(performance.now() - t0), ...m });
    } catch (err) {
      results.push({ name, error: String(err?.message ?? err) });
    }
  };

  /* ---- impulse responses ---------------------------------------- */
  for (const key of Object.keys(IR_SPECS)) {
    const t0 = performance.now();
    try {
      const ctx = new OfflineAudioContext(2, SR * 0.05, SR);
      const buf = generateIR(ctx, new Rng(0x1234 + key.length), IR_SPECS[key]);
      const m = measure(buf);
      results.push({ name: `ir:${key}`, ms: Math.round(performance.now() - t0), seconds: +buf.duration.toFixed(2), ...m });
    } catch (err) {
      results.push({ name: `ir:${key}`, error: String(err?.message ?? err) });
    }
  }

  /* ---- weapons, near and far ------------------------------------ */
  for (const key of Object.keys(WEAPON_PROFILES)) {
    await push(`shot:${key}@2m`, 3.5, ({ bank, rng, mixer, t }) => {
      route(mixer, weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES[key], { when: t, distance: 2, firstPerson: true }));
    });
  }
  /* The gun with no room at all — the slapback in layer 8 has to carry it. */
  for (const key of ['rifle', 'ak', 'sniper']) {
    await push(`shot:${key}@2m:dry`, 3.5, ({ bank, rng, mixer, t }) => {
      route(mixer, weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES[key], {
        when: t, distance: 2, firstPerson: true,
      }), 'weapons', 0);
    });
  }
  await push('shot:rifle@120m', 4.5, ({ bank, rng, mixer, t }) => {
    route(mixer, weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES.rifle, { when: t, distance: 120 }));
  });
  await push('shot:rifle@300m', 5.5, ({ bank, rng, mixer, t }) => {
    route(mixer, weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES.rifle, { when: t, distance: 300 }));
  });

  /* round-robin variation: 8 rounds of automatic fire must not be identical */
  await push('auto:8rounds', 2.5, ({ bank, rng, mixer, t }) => {
    for (let i = 0; i < 8; i++) {
      route(mixer, weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES.rifle, {
        when: t + i * 0.085, distance: 2, firstPerson: true,
      }));
    }
  });

  /* ---- foley ----------------------------------------------------- */
  const surfaces = ['concrete', 'metal', 'wood', 'dirt', 'sand', 'glass', 'water', 'foliage', 'fabric', 'flesh', 'rubber', 'plaster'];
  for (const s of surfaces) {
    await push(`impact:${s}`, 2.2, ({ bank, rng, mixer, t }) => {
      route(mixer, surfaceImpact(mixer.actx, bank, rng, { when: t, surface: s, energy: 1 }), 'foley');
    });
    await push(`step:${s}`, 2.2, ({ bank, rng, mixer, t }) => {
      route(mixer, footstep(mixer.actx, bank, rng, { when: t, surface: s, gait: 'run' }), 'foley');
    });
  }
  for (const gait of ['walk', 'run', 'sprint', 'crouch', 'land']) {
    await push(`step:concrete:${gait}`, 2.2, ({ bank, rng, mixer, t }) => {
      route(mixer, footstep(mixer.actx, bank, rng, { when: t, surface: 'concrete', gait }), 'foley');
    });
  }
  await push('shell:concrete', 3, ({ bank, rng, mixer, t }) => {
    route(mixer, shellCasing(mixer.actx, bank, rng, { when: t, surface: 'concrete' }), 'foley');
  });
  await push('shell:dirt', 3, ({ bank, rng, mixer, t }) => {
    route(mixer, shellCasing(mixer.actx, bank, rng, { when: t, surface: 'dirt' }), 'foley');
  });
  // Every phase of every ACTION type, not just the AR's: an AK rocks a steel
  // magazine and charges off the handle, a bolt gun charges nothing at all.
  for (const action of ['ar', 'ak', 'bolt', 'heavy']) {
    for (const phase of ['start', 'magout', 'magin', 'end']) {
      await push(`reload:${action}:${phase}`, 2.5, ({ bank, rng, mixer, t }) => {
        route(mixer, reloadPhase(mixer.actx, bank, rng, phase, { when: t, action }), 'foley');
      });
    }
  }
  for (const fp of [true, false]) {
    await push(`bolt:${fp ? 'fp' : '12m'}`, 2.5, ({ bank, rng, mixer, t }) => {
      route(mixer, boltCycle(mixer.actx, bank, rng, {
        when: t, dur: 0.78, firstPerson: fp, distance: fp ? 0 : 12,
      }), 'foley');
    });
  }
  for (const kind of ['slash', 'stab']) {
    await push(`melee:swing:${kind}`, 1.5, ({ bank, rng, mixer, t }) => {
      route(mixer, meleeSwing(mixer.actx, bank, rng, { when: t, kind }), 'foley');
    });
  }
  for (const surface of ['flesh', 'concrete', 'metal', 'wood', 'glass', 'plaster', 'sand', 'rubber']) {
    await push(`melee:hit:${surface}`, 2, ({ bank, rng, mixer, t }) => {
      route(mixer, meleeHit(mixer.actx, bank, rng, { when: t, surface }), 'foley');
    });
  }
  await push('explosion@5m', 6, ({ bank, rng, mixer, t }) => {
    route(mixer, explosion(mixer.actx, bank, rng, { when: t, distance: 5, radius: 8 }));
  });
  await push('explosion@180m', 7, ({ bank, rng, mixer, t }) => {
    route(mixer, explosion(mixer.actx, bank, rng, { when: t, distance: 180, radius: 12 }));
  });
  /* The airstrike's own numbers: RULES.airstrikeRadius 15. And the same voice
   * with no reverb at all, which is where its size has to survive. */
  await push('explosion:airstrike', 9, ({ bank, rng, mixer, t }) => {
    route(mixer, explosion(mixer.actx, bank, rng, { when: t, distance: 12, radius: 15, level: 1.43 }));
  });
  await push('explosion:airstrike:dry', 9, ({ bank, rng, mixer, t }) => {
    route(mixer, explosion(mixer.actx, bank, rng, { when: t, distance: 12, radius: 15, level: 1.43 }), 'weapons', 0);
  });
  await push('explosion@5m:dry', 6, ({ bank, rng, mixer, t }) => {
    route(mixer, explosion(mixer.actx, bank, rng, { when: t, distance: 5, radius: 8 }), 'weapons', 0);
  });
  /**
   * THE AIR EVENTS HAD NO COVERAGE AT ALL. Six voices in src/audio/airstrike.js
   * — the jet, the whistle, the rubble, the tail and both halves of the strafe —
   * were never rendered by this suite, which is why nothing noticed that the
   * `settled` phase of every air event was silent.
   *
   * The `:dry` pairs are the ones that matter for the brief "a blast's size must
   * come from the synthesis and not from the room": the same voice with its
   * reverb send scaled to zero. If d20/d40 hold up dry, the tail is real.
   */
  await push('air:jet', 6, ({ bank, rng, mixer, t }) => {
    route(mixer, strikeJet(mixer.actx, bank, rng, { when: t, dur: 3.4 }), 'ambience');
  });
  await push('air:incoming', 4, ({ bank, rng, mixer, t }) => {
    route(mixer, strikeIncoming(mixer.actx, bank, rng, { when: t, dur: 2.4 }));
  });
  await push('air:rubble', 6, ({ bank, rng, mixer, t }) => {
    route(mixer, strikeRubble(mixer.actx, bank, rng, { when: t, dur: 3.4, distance: 20 }));
  });
  await push('air:tail', 9, ({ bank, rng, mixer, t }) => {
    route(mixer, strikeTail(mixer.actx, bank, rng, { when: t }));
  });
  await push('air:tail:dry', 9, ({ bank, rng, mixer, t }) => {
    route(mixer, strikeTail(mixer.actx, bank, rng, { when: t }), 'weapons', 0);
  });
  await push('air:settle', 8, ({ bank, rng, mixer, t }) => {
    route(mixer, rubbleCollapse(mixer.actx, bank, rng, { when: t, distance: 18, size: 1 }));
  });
  await push('air:settle:small', 6, ({ bank, rng, mixer, t }) => {
    route(mixer, rubbleCollapse(mixer.actx, bank, rng, { when: t, distance: 40, size: 0.35 }));
  });
  await push('strafe:air', 4, ({ bank, rng, mixer, t }) => {
    route(mixer, strafeCannon(mixer.actx, bank, rng, { when: t, dur: 1.2, rate: 22 }));
  });
  await push('strafe:ground', 4, ({ bank, rng, mixer, t }) => {
    route(mixer, strafeCannon(mixer.actx, bank, rng, { when: t, dur: 1.2, rate: 22, ground: true }));
  });

  await push('bodyfall', 2, ({ bank, rng, mixer, t }) => {
    route(mixer, bodyFall(mixer.actx, bank, rng, { when: t }), 'foley');
  });
  await push('cloth', 1.5, ({ bank, rng, mixer, t }) => {
    route(mixer, cloth(mixer.actx, bank, rng, { when: t }), 'foley');
  });
  await push('whizz', 1.2, ({ bank, rng, mixer, t }) => {
    route(mixer, bulletWhizz(mixer.actx, bank, rng, { when: t, miss: 1.2 }), 'foley');
  });
  await push('dryfire', 1, ({ bank, rng, mixer, t }) => {
    route(mixer, dryFire(mixer.actx, bank, rng, { when: t }), 'weapons');
  });
  await push('heartbeat', 1.5, ({ bank, rng, mixer, t }) => {
    route(mixer, heartbeat(mixer.actx, bank, rng, { when: t }), 'foley');
  });
  for (const k of ['hitmarker', 'headshot', 'kill', 'damage', 'lowhealth']) {
    await push(`ui:${k}`, 1.5, ({ bank, rng, mixer, t }) => {
      route(mixer, uiSound(mixer.actx, bank, rng, k, { when: t }), 'ui');
    }, { reverb: false });
  }

  /* ---- voice ----------------------------------------------------- */
  for (const key of Object.keys(BARKS)) {
    await push(`bark:${key}`, 3, ({ bank, rng, mixer, t }) => {
      route(mixer, bark(mixer.actx, bank, rng, { when: t, bark: key }), 'voice');
    });
  }
  await push('bark:radio', 3, ({ bank, rng, mixer, t }) => {
    route(mixer, bark(mixer.actx, bank, rng, { when: t, bark: 'contact', radio: true }), 'voice');
  });

  /* ---- ambient one-shots ---------------------------------------- */
  for (const k of ONE_SHOTS) {
    await push(`ambient:${k}`, 14, ({ bank, rng, mixer, t }) => {
      route(mixer, ambientOneShot(mixer.actx, bank, rng, k, { when: t }), 'ambience');
    });
  }

  /* ---- reverb space comparison ---------------------------------- */
  for (const space of ['tight', 'street', 'open', 'tunnel']) {
    const w = { tight: 0, room: 0, street: 0, tunnel: 0, open: 0 };
    w[space] = 1;
    await push(`tail:${space}`, 5, ({ bank, rng, mixer, t }) => {
      route(mixer, weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES.rifle, {
        when: t, distance: 2, firstPerson: true, echoBoost: 2,
      }), 'weapons', 1.4);
    }, { space: w });
  }

  /* ---- limiter stress: everything at once ----------------------- */
  await push('stress:limiter', 4, ({ bank, rng, mixer, t }) => {
    for (let i = 0; i < 14; i++) {
      route(mixer, weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES.sniper, {
        when: t + i * 0.004, distance: 1, firstPerson: true,
      }));
    }
    for (let i = 0; i < 6; i++) {
      route(mixer, explosion(mixer.actx, bank, rng, { when: t + i * 0.01, distance: 1, radius: 14 }));
    }
  });

  /* ---- space classifier (pure function, no audio) ---------------- */
  const spaces = {};
  const box = new Array(9).fill(3.5); box[8] = 2.6;
  spaces.smallRoom = classifySpace(box, 40, null);
  const street = [4, 30, 40, 30, 4, 30, 40, 30, 40];
  spaces.street = classifySpace(street, 40, null);
  const field = new Array(9).fill(40);
  spaces.open = classifySpace(field, 40, null);
  const corridor = [1.8, 12, 38, 12, 1.8, 12, 38, 12, 2.4];
  spaces.corridor = classifySpace(corridor, 40, null);

  const failures = results.filter((r) =>
    r.error || r.nan > 0 || r.peak >= 1.0 || (r.rms ?? 0) <= 0.00002 || Math.abs(r.dc ?? 0) > 0.02
  );

  return {
    ok: failures.length === 0,
    cases: results.length,
    failures,
    results: opts.verbose === false ? undefined : results,
    spaces,
  };
}

if (typeof window !== 'undefined') window.__AUDIO_SELFTEST__ = runAudioSelfTest;
