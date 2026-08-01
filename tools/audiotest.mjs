/**
 * Headless audio watchdog.
 *
 * The report was "the sound bugs out and then disappears". `src/audio/index.js`
 * has exactly that failure mode wired in on purpose — `_error()` counts throws
 * and calls `_teardown()` on the fortieth, permanently — so the question is not
 * whether audio can die but WHICH voice is throwing, and whether the voice pool
 * starves before that.
 *
 * This runs a real match with a real AudioContext and samples the audio stats
 * every second, printing the first errors verbatim and flagging the moment
 * `failed` flips or the emitter pool saturates.
 *
 *   node tools/audiotest.mjs [--url=…] [--seconds=180] [--scale=6]
 */

import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4173/';
const SECONDS = Number(args.seconds ?? 180);
const SCALE = Number(args.scale ?? 6);

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-frame-rate-limit',
    // A real graph, not a muted stub, and no gesture requirement — otherwise the
    // context stays suspended and update() returns before it can fail.
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[audio]')) console.log('  console:', t.slice(0, 300));
});

console.log(`[audiotest] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

// Capture what _error() logs, including the stack, which the subsystem itself
// only prints for the first five.
const boot = await page.evaluate(async (scale) => {
  const e = window.__ENGINE__;
  const a = e.ctx.peek('audio');
  window.__AUDIO_ERRS__ = [];
  if (a) {
    const orig = a._error.bind(a);
    a._error = (err) => {
      window.__AUDIO_ERRS__.push({
        msg: String(err?.message ?? err),
        stack: String(err?.stack ?? '').split('\n').slice(0, 4).join(' | '),
      });
      return orig(err);
    };
    try { await a.start?.(); } catch { /* reported below */ }
  }
  e.time.scale = scale;
  return {
    present: !!a,
    running: a?.running ?? null,
    state: a?.actx?.state ?? 'none',
    emitters: a?.field?.emitters?.length ?? a?.field?.stats?.capacity ?? null,
  };
}, SCALE);
console.log('[audiotest] audio at boot:', JSON.stringify(boot));

/* ==================================================================== */
/* --burst: measure the graph through a dense fight and a near-miss     */
/* ==================================================================== */
/**
 * The counters above answer "did a voice throw" and "is the pool pinned". They
 * cannot answer the report 「色々な音が集中すると音が全て消える」, because a mix that
 * has been driven to zero throws nothing and drops nothing — every voice still
 * plays, into a gain of 0.
 *
 * So this mode taps ANALYSERS onto the four points the signal can die at
 * (`worldSum` pre-muffle, `muffleGain` post-muffle, `masterGain` out, plus the
 * per-bus duck gains) and samples them at 20 Hz alongside `deafness`,
 * `actx.state`, the duck/muffle gain VALUES and the pool counters. Silence with
 * a live `worldSum` and a dead `masterGain` is a mix fault; silence at both is a
 * voice fault; a plateau rather than a decay says the recovery term is dead.
 *
 * It then does the one thing the player found that works — open the pause menu
 * and close it — so the before/after of that transition is on the same trace.
 *
 *   node tools/audiotest.mjs --burst [--url=…] [--scale=1]
 */
if (args.burst) {
  await page.evaluate(() => {
    const e = window.__ENGINE__;
    const a = e.ctx.peek('audio');
    const m = a.mixer;
    const actx = a.actx;
    const N = 2048;
    const mkTap = (node) => {
      const an = actx.createAnalyser();
      an.fftSize = N;
      an.smoothingTimeConstant = 0;
      node.connect(an);
      return an;
    };
    const taps = {
      world: mkTap(m.worldSum),
      muffled: mkTap(m.muffleGain),
      out: mkTap(m.masterGain),
      weapons: mkTap(m.buses.weapons.comp ?? m.buses.weapons.trim),
      foley: mkTap(m.buses.foley.comp ?? m.buses.foley.trim),
    };
    const buf = new Float32Array(N);
    const lvl = (an) => {
      an.getFloatTimeDomainData(buf);
      let peak = 0, sum = 0;
      for (let i = 0; i < N; i++) {
        const v = buf[i];
        const av = v < 0 ? -v : v;
        if (av > peak) peak = av;
        sum += v * v;
      }
      return { peak, rms: Math.sqrt(sum / N) };
    };
    const rec = [];
    window.__TRACE__ = rec;
    window.__MARK__ = (name) => rec.push({ mark: name, t: +actx.currentTime.toFixed(2) });
    window.__SAMPLER__ = setInterval(() => {
      const o = lvl(taps.out), w = lvl(taps.world), mu = lvl(taps.muffled);
      rec.push({
        t: +actx.currentTime.toFixed(2),
        // Wall clock beside the audio clock: if the two diverge the render
        // thread is not keeping up (or the context has stopped advancing at
        // all), which is silence for a reason no gain value can show.
        w: +(performance.now() / 1000).toFixed(2),
        state: actx.state,
        outRms: +o.rms.toFixed(6), outPeak: +o.peak.toFixed(5),
        worldRms: +w.rms.toFixed(6), muffRms: +mu.rms.toFixed(6),
        wpnRms: +lvl(taps.weapons).rms.toFixed(6),
        folRms: +lvl(taps.foley).rms.toFixed(6),
        master: +m.masterGain.gain.value.toFixed(4),
        pre: +m.preGain.gain.value.toFixed(4),
        muffG: +m.muffleGain.gain.value.toFixed(4),
        lp: Math.round(m.muffleLP.frequency.value),
        hs: +m.muffleHS.gain.value.toFixed(2),
        deaf: +m.deafness.toFixed(4),
        red: +(m.masterComp.reduction ?? 0).toFixed(2),
        duckW: +m.buses.weapons.duck.gain.value.toFixed(4),
        duckF: +m.buses.foley.duck.gain.value.toFixed(4),
        duckA: +m.buses.ambience.duck.gain.value.toFixed(4),
        duckV: +m.buses.voice.duck.gain.value.toFixed(4),
        dAmtF: +(m.buses.foley.duckAmount ?? 0).toFixed(3),
        dAmtA: +(m.buses.ambience.duckAmount ?? 0).toFixed(3),
        active: a.field.stats.active,
        // The render thread's own books: how much of real time it is losing,
        // how many audio-seconds it owes, and how many slots the field is
        // filling because of it. @see SpatialField._trackRender
        cap: a.field.stats.cap,
        behind: a.field.stats.behind,
        dropped: a.field.stats.dropped,
        stolen: a.field.stats.stolen,
        errors: a.stats.errors,
        dt: +e.time.dt.toFixed(4),
      });
    }, 50);
  });

  /**
   * `--legacy` is the A/B CONTROL, not a feature: it puts the two defences back
   * the way they were at runtime — emitter and dry-voice lifetimes expiring on
   * the audio clock ALONE, and no render governor on the pool — so the before
   * and after can be measured minutes apart on the same machine under the same
   * load instead of being compared across builds. (It cannot undo the third
   * change, claiming the emitter before synthesising the voice; that one is
   * structural. @see AudioSystem._playAt)
   */
  if (args.legacy) {
    await page.evaluate(() => {
      const a = window.__ENGINE__.ctx.peek('audio');
      const f = a.field;
      f._trackRender = () => {};
      f.cap = f.emitters.length;
      const up = f.update.bind(f);
      f.update = (dt) => {
        for (const e of f.emitters) e.wallEnd = Infinity;
        for (const d of a._dry) d.wallEnd = Infinity;
        return up(dt);
      };
    });
    console.log('[audiotest] LEGACY control: wall-clock backstop and render governor disabled');
  }

  const mark = (n) => page.evaluate((x) => window.__MARK__(x), n);
  const wait = (ms) => page.waitForTimeout(ms);

  /** Dense firefight: many remote shooters, impacts, casings, steps, barks. */
  const storm = (seconds, hz = 22) =>
    page.evaluate(({ seconds, hz }) => new Promise((done) => {
      const e = window.__ENGINE__;
      const a = e.ctx.peek('audio');
      const ev = e.ctx.events;
      let n = 0;
      const total = Math.round(seconds * hz);
      const id = setInterval(() => {
        const lp = a.field.listenerPos;
        const at = (dx, dy, dz) => ({ x: lp.x + dx, y: lp.y + dy, z: lp.z + dz });
        const ang = (n * 0.7) % 6.283;
        const d = 6 + (n % 9) * 5;
        const p = at(Math.cos(ang) * d, 0, Math.sin(ang) * d);
        ev.emit('weapon:fire', { weapon: ['rifle', 'ak', 'lmg', 'sniper'][n % 4], origin: p, dir: { x: 0, y: 0, z: -1 } });
        ev.emit('weapon:fire', { weapon: 'rifle', origin: at(0.2, -0.1, -0.3), firstPerson: true, dir: { x: 0, y: 0, z: -1 } });
        ev.emit('bullet:impact', {
          point: at(Math.cos(ang) * 3, 1, Math.sin(ang) * 3), normal: { x: 0, y: 1, z: 0 },
          surface: ['concrete', 'metal', 'wood', 'sand'][n % 4], damage: 34, exit: false,
        });
        ev.emit('player:footstep', { position: at(0, -1.6, 0), surface: 'concrete', speed: 6.5 });
        ev.emit('weapon:shell', { position: at(0.3, -0.2, -0.2) });
        if (n % 3 === 0) ev.emit('bullet:tracer', { from: at(-20, 0, -20), to: at(2, 0, 2), speed: 880 });
        if (n % 7 === 0) ev.emit('actor:death', { actor: { id: n }, point: at(4, -1.2, -9) });
        if (n % 5 === 0) a.bark('spot', p, { force: true, voice: n % 9 });
        if (++n >= total) { clearInterval(id); done(n); }
      }, 1000 / hz);
    }), { seconds, hz });

  /** The reported trigger: an airstrike bomb landing next to the player. */
  const nearMiss = () =>
    page.evaluate(() => {
      const e = window.__ENGINE__;
      const a = e.ctx.peek('audio');
      const lp = a.field.listenerPos;
      const pos = { x: lp.x + 3, y: lp.y - 1.2, z: lp.z + 2 };
      e.ctx.events.emit('match:airstrike', { phase: 'inbound', site: 'MID', position: pos });
      e.ctx.events.emit('explosion', { position: pos, radius: 15, damage: 260 });
      e.ctx.events.emit('match:airstrike', { phase: 'impact', site: 'MID', position: pos });
      return { pos, deaf: a.mixer.deafness };
    });

  await page.evaluate((s) => { window.__ENGINE__.time.scale = s; }, Number(args.scale ?? 1));
  await mark('baseline');           await wait(3000);
  await mark('firefight');          await storm(8);
  await mark('firefight-quiet');    await wait(2000);
  await mark('nearmiss');
  console.log('[audiotest] near miss at', JSON.stringify(await nearMiss()));
  await mark('nearmiss-fight');     await storm(6);
  await mark('recover');            await wait(16000);
  await mark('pause');
  await page.evaluate(() => window.__ENGINE__.ctx.peek('ui')?.menu?.show?.());
  await wait(2500);
  await mark('unpause');
  await page.evaluate(() => window.__ENGINE__.ctx.peek('ui')?.menu?.close?.());
  await wait(6000);
  await mark('end');

  const trace = await page.evaluate(() => {
    clearInterval(window.__SAMPLER__);
    return window.__TRACE__;
  });
  const t0 = trace.find((r) => !r.mark)?.t ?? 0;
  const w0 = trace.find((r) => !r.mark)?.w ?? 0;
  const hdr = '   t   wall  state     phase        outRms  outPk  worldR  muffR  wpnR   folR   mast  muffG    lp   deaf  duckA duckF  act cap behind drop stol err';
  console.log('\n[audiotest] BURST TRACE (levels are analyser RMS/peak; lp is the muffle low-pass Hz)');
  console.log(hdr);
  let phase = 'boot';
  let bucket = null, bt = -1;
  const flush = () => {
    if (!bucket) return;
    const b = bucket;
    console.log(
      `${String(b.t.toFixed(1)).padStart(5)} ${String(b.w.toFixed(1)).padStart(6)}  ${String(b.state).padEnd(9)} ${b.phase.padEnd(11)} ` +
      `${b.outRms.toExponential(2)} ${b.outPeak.toFixed(4)} ${b.worldRms.toExponential(2)} ${b.muffRms.toExponential(2)} ` +
      `${b.wpnRms.toExponential(1)} ${b.folRms.toExponential(1)} ` +
      `${b.master.toFixed(3)} ${b.muffG.toFixed(4)} ${String(b.lp).padStart(5)} ${b.deaf.toFixed(3)} ` +
      `${b.duckA.toFixed(3)} ${b.duckF.toFixed(3)} ${String(b.active).padStart(4)} ${String(b.cap).padStart(3)} ${String(b.behind.toFixed(2)).padStart(6)} ${String(b.dropped).padStart(4)} ${String(b.stolen).padStart(5)} ${b.errors}`
    );
    bucket = null;
  };
  for (const r of trace) {
    if (r.mark) { flush(); phase = r.mark; continue; }
    const t = +(r.t - t0).toFixed(2);
    const w = +(r.w - w0).toFixed(2);
    const slot = Math.floor(w * 2); // 0.5 s WALL buckets — the audio clock may stall
    if (slot !== bt) { flush(); bt = slot; }
    if (!bucket) bucket = { ...r, t, w, phase, n: 1 };
    else {
      bucket.outRms = Math.max(bucket.outRms, r.outRms);
      bucket.outPeak = Math.max(bucket.outPeak, r.outPeak);
      bucket.worldRms = Math.max(bucket.worldRms, r.worldRms);
      bucket.muffRms = Math.max(bucket.muffRms, r.muffRms);
      bucket.wpnRms = Math.max(bucket.wpnRms, r.wpnRms);
      bucket.folRms = Math.max(bucket.folRms, r.folRms);
      bucket.deaf = Math.max(bucket.deaf, r.deaf);
      bucket.master = r.master; bucket.muffG = r.muffG; bucket.lp = r.lp;
      bucket.duckA = Math.min(bucket.duckA, r.duckA);
      bucket.duckF = Math.min(bucket.duckF, r.duckF);
      bucket.active = Math.max(bucket.active, r.active);
      bucket.dropped = r.dropped; bucket.stolen = r.stolen; bucket.errors = r.errors;
      bucket.t = t; bucket.w = w; bucket.state = r.state;
      bucket.cap = Math.min(bucket.cap, r.cap);
      bucket.behind = Math.max(bucket.behind, r.behind);
    }
  }
  flush();

  const final = await sampleOrNull(page);
  console.log('\n[audiotest] final', JSON.stringify(final));
  console.log('[audiotest] page errors', pageErrors.slice(0, 8));
  await browser.close();
  process.exit(0);
}

async function sampleOrNull(p) {
  return p.evaluate(() => {
    const a = window.__ENGINE__.ctx.peek('audio');
    return a ? a.report() : null;
  });
}

const sample = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const a = e.ctx.peek('audio');
    const m = e.ctx.peek('match');
    if (!a) return null;
    return {
      t: +e.time.elapsed.toFixed(0),
      state: a.actx?.state ?? 'none',
      running: a.running,
      failed: !!a.failed,
      errors: a.stats.errors,
      events: a.stats.events,
      voices: a.stats.voices,
      dropped: a.stats.dropped,
      stolen: a.stats.stolen,
      phase: m?.phase,
      bomb: m?.bomb?.state,
      newErrs: window.__AUDIO_ERRS__.splice(0),
    };
  });

let announced = false;
const t0 = Date.now();
let prev = null;
while ((Date.now() - t0) / 1000 < SECONDS) {
  const s = await sample();
  if (!s) break;
  for (const err of s.newErrs) console.log('  !! audio error:', err.msg, '\n     at', err.stack);
  if (!prev || s.failed !== prev.failed || s.errors !== prev.errors ||
      Math.abs(s.voices - prev.voices) > 3 || s.phase !== prev.phase || s.bomb !== prev.bomb) {
    console.log(
      `t=${String(s.t).padStart(4)}s ${s.phase ?? '-'} bomb=${s.bomb ?? '-'} | ` +
      `ctx=${s.state} running=${s.running} failed=${s.failed} | ` +
      `errors=${s.errors} voices=${s.voices} dropped=${s.dropped} stolen=${s.stolen} events=${s.events}`
    );
  }
  if (s.failed && !announced) {
    announced = true;
    console.log('\n*** AUDIO DISABLED ITSELF at t=' + s.t + 's ***\n');
  }
  prev = s;
  await page.waitForTimeout(1000);
}

const final = await sample();
console.log('\n[audiotest] final', JSON.stringify(final, null, 2));
console.log('[audiotest] page errors', pageErrors.slice(0, 8));
await browser.close();
process.exit(final?.failed ? 1 : 0);
