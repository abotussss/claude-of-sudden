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
    /**
     * SPLIT ON THE FIRST `=` ONLY. `split('=')` destructured to `[k, v]` threw
     * away everything after the second one, so `--url=…/?seed=12` reached the
     * page as `…/?seed`, `Number('')` became 0, and this gate measured seed 0
     * while reporting the seed it was asked for. It "passed" on the seed a
     * sweep failed 8 boots out of 8. A tool that silently measures something
     * other than what it was pointed at is worse than a tool that crashes.
     */
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
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
    /**
     * `--mute-audio` MUTES THE OUTPUT DEVICE, NOT THE GRAPH. The context still
     * renders, `actx.currentTime` still advances at the rate the thread manages,
     * the analysers still see signal and every counter here still means what it
     * says — which is the whole point, because nobody running this can hear it
     * anyway. What it stops is a headless run playing a firefight out loud on the
     * machine it is measured on.
     */
    '--mute-audio',
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
    /**
     * WHICH BUILD IS ACTUALLY ON THE WIRE. `vite preview` maps the output
     * directory ONCE at startup and serves that snapshot for its whole life, so
     * a server left running across a rebuild will happily serve the previous
     * build to a probe that has just been told to measure the new one — silently,
     * with a live page and a green boot. That cost a whole before/after run
     * here: the "after" numbers were the "before" build measured twice.
     *
     * `battle` being false on a build that has `src/audio/battle.js` in it means
     * the server is stale. Restart it (or point `--url` at a fresh one).
     */
    battle: !!a?.battle,
    script: document.querySelector('script[src*="assets/"]')?.getAttribute('src') ?? null,
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

/* ==================================================================== */
/* --occwhy: WHAT THE OCCLUSION RAYS ARE ACTUALLY HITTING               */
/* ==================================================================== */
/**
 * `--ear`'s census found 90 % of every spatialised voice in a live match sitting
 * at occlusion >= 0.9 — a 420 Hz low-pass, a -26 dB shelf and a 0.38 gain on
 * nine sounds out of ten. That is either the map (in which case the model is too
 * harsh) or a bug in the two rays. A percentage cannot tell those apart, so this
 * records the rays themselves: where they started, where they were aimed, how
 * far they got, and what they hit.
 *
 *   node tools/audiotest.mjs --occwhy [--url=…] [--seconds=45]
 */
if (args.occwhy) {
  const OSEC = Number(args.seconds ?? 45);
  await page.evaluate(() => {
    const e = window.__ENGINE__;
    const a = e.ctx.peek('audio');
    const f = a.field;
    const phys = e.ctx.peek('physics');
    const rows = [];
    window.__OCC__ = rows;
    const orig = f.occlusionAt.bind(f);
    f.occlusionAt = (x, y, z) => {
      const occ = orig(x, y, z);
      if (rows.length < 4000 && phys?.raycast) {
        const l = f.listenerPos;
        const d = Math.hypot(x - l.x, y - l.y, z - l.z);
        const r = { occ: +occ.toFixed(2), d: +d.toFixed(1), ly: +l.y.toFixed(2), sy: +y.toFixed(2), rays: [] };
        for (let i = 0; i < 2; i++) {
          const lift = i === 0 ? 0 : 0.55;
          const ox = l.x, oy = l.y + lift, oz = l.z;
          const dx = x - ox, dy = y + lift * 0.5 - oy, dz = z - oz;
          const len = Math.hypot(dx, dy, dz);
          const h = phys.raycast({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz }, len - 0.25, phys.MASK?.SIGHT);
          r.rays.push(h?.hit
            ? {
              t: +(h.distance / len).toFixed(3), dist: +h.distance.toFixed(2),
              surf: h.surface ?? '?', ny: +(h.normal?.y ?? 0).toFixed(2),
              obj: h.object?.name || h.object?.userData?.kind || (h.actor ? 'ACTOR' : (h.collider ? 'COLLIDER' : 'static')),
            }
            : null);
        }
        rows.push(r);
      }
      return occ;
    };
    e.time.scale = 3;
  });
  console.log(`[audiotest] occwhy: ${OSEC}s …`);
  await page.waitForTimeout(OSEC * 1000);
  const rows = await page.evaluate(() => window.__OCC__);
  console.log(`\n[occwhy] ${rows.length} occlusion queries sampled`);
  const buckets = new Map();
  let grazeNear = 0, blocked = 0, clear = 0;
  for (const r of rows) {
    if (r.occ >= 0.9) blocked++; else if (r.occ === 0) clear++;
    for (const ray of r.rays) {
      if (!ray) continue;
      const key = `${ray.surf}/${ray.obj}`;
      const b = buckets.get(key) ?? { n: 0, sumT: 0, sumNy: 0 };
      b.n++; b.sumT += ray.t; b.sumNy += ray.ny;
      buckets.set(key, b);
      if (ray.t > 0.85) grazeNear++;
    }
  }
  console.log(`  occ>=0.9 ${blocked}   occ=0 ${clear}   rays landing past 85% of the way ${grazeNear}`);
  console.log('\n  what the rays hit          n     mean t (0=at the ear, 1=at the source)  mean normal.y');
  const sorted = [...buckets.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 14);
  for (const [k, v] of sorted) {
    console.log(`  ${k.padEnd(28)} ${String(v.n).padStart(5)}   ${(v.sumT / v.n).toFixed(3)}                        ${(v.sumNy / v.n).toFixed(2)}`);
  }
  console.log('\n  first 15 queries in full:');
  for (const r of rows.slice(0, 15)) console.log('   ', JSON.stringify(r));
  console.log('[occwhy] page errors', pageErrors.slice(0, 8));
  await browser.close();
  process.exit(0);
}

/* ==================================================================== */
/* --ear: WHAT ACTUALLY ARRIVES AT THE OUTPUT, ON THE LIVE PATH         */
/* ==================================================================== */
/**
 * 「銃声が全然聞こえない」「爆風の音が小さい」「音がこもっている時が多い」
 *
 * Two passes have now answered these with numbers out of `src/audio/selftest.js`,
 * and the player has twice said the numbers did not reach him. So this mode does
 * not measure the synthesis. It measures the OUTPUT of a running game, one event
 * at a time, and it exists because of one structural difference between the two:
 *
 *   selftest's `atDist()` is airLP -> distGain -> bus. The live path is
 *   airLP -> occLP -> occHS -> distGain -> **PannerNode(HRTF)** -> bus, and the
 *   two stages it leaves out are the two that only ever apply to somebody ELSE's
 *   sound. The player's own weapon is `_playDry`, head-locked, and passes through
 *   neither. Any loss in them is therefore invisible to the bench and lands
 *   entirely on the ratio the complaint is about.
 *
 * What is measured here:
 *   1. an analyser on `masterGain` — the real ear — sampled at 100 Hz across a
 *      window, one event at a time, with the simulation frozen so nothing else
 *      is playing. Own rifle, remote rifle at 40 m, the far layer at 90 and
 *      150 m, and an airstrike blast.
 *   2. the same, with `occlusionEnabled = false`, so the geometry's share of the
 *      loss is a difference and not an opinion.
 *   3. the HRTF panner's own insertion loss, rendered offline in the page
 *      through a node configured exactly as `Emitter` configures it.
 *   4. `muffleGain` / `muffleLP` / `deafness` sampled at 10 Hz through a live
 *      match, because 「こもっている」 is a claim about a value over time.
 *
 *   node tools/audiotest.mjs --ear [--url=…] [--matchsecs=120]
 */
if (args.ear) {
  const MATCHSECS = Number(args.matchsecs ?? 120);

  await page.evaluate((old) => { window.__OLDOCC__ = old; }, !!args.oldocc);
  if (args.oldocc) console.log('[ear] OLDOCC control: 420 Hz / -26 dB occlusion response restored at runtime');
  await page.evaluate(() => {
    const e = window.__ENGINE__;
    const a = e.ctx.peek('audio');
    const actx = a.actx;
    const N = 2048;
    const mk = (node) => {
      const an = actx.createAnalyser();
      an.fftSize = N;
      an.smoothingTimeConstant = 0;
      node.connect(an);
      return an;
    };
    void mk;
    /**
     * EVERY SAMPLE, NOT EVERY POLL. An AnalyserNode holds the last 2048 samples
     * and nothing else, so reading it from a `setInterval` measures whatever
     * happened to be in the window at that instant. Under a null sink the render
     * thread works in bursts — it produced half a second of audio between two
     * 10 ms polls here — and a peak that falls in the gap is simply never seen.
     * MEASURED consequence on the first audio-clock-gated run of this mode: the
     * player's own rifle, an event `occlusionEnabled` cannot touch, came out at
     * 0.0316 in one block and 0.0729 in the next.
     *
     * A ScriptProcessorNode is handed every block the graph renders. It is
     * deprecated and it is the wrong tool for making sound; for counting it, it
     * is the only one in a page that cannot skip.
     */
    const mkRec = (node) => {
      // 16384 and not 2048: a ScriptProcessorNode is serviced on the MAIN thread
      // and its buffers are dropped when that thread is busy. At 2048 (43 ms) a
      // frame that overruns loses blocks, and the loss is invisible — it reads as
      // a quieter event. Measured cost of that: the player's own rifle, which
      // nothing in this mode can legitimately change, came out 8 dB apart in two
      // consecutive blocks of one run. 16384 is 341 ms of slack per callback.
      const sp = actx.createScriptProcessor(16384, 2, 1);
      const acc = { peak: 0, sumSq: 0, n: 0, on: false };
      sp.onaudioprocess = (ev) => {
        if (!acc.on) return;
        const inp = ev.inputBuffer;
        for (let ch = 0; ch < inp.numberOfChannels; ch++) {
          const d = inp.getChannelData(ch);
          for (let i = 0; i < d.length; i++) {
            const v = d[i];
            const av = v < 0 ? -v : v;
            if (av > acc.peak) acc.peak = av;
            acc.sumSq += v * v;
            acc.n++;
          }
        }
      };
      node.connect(sp);
      // It has to reach the destination to be pulled, and it must not be heard.
      const sink = actx.createGain();
      sink.gain.value = 0;
      sp.connect(sink);
      sink.connect(actx.destination);
      return acc;
    };
    /**
     * BRIGHTNESS, because 「音がこもっている時が多い」 is a claim about a spectrum and
     * a peak cannot answer it. `bright` is the same output run through a 2 kHz
     * high-pass first; `bright.rms / out.rms` is the share of the event that
     * survived above 2 kHz. A 420 Hz low-pass leaves almost nothing there.
     */
    const hp = actx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2000;
    hp.Q.value = 0.7;
    a.mixer.masterGain.connect(hp);
    const rec = {
      out: mkRec(a.mixer.masterGain), world: mkRec(a.mixer.worldSum), bright: mkRec(hp),
    };

    // Every emitter the field hands out during a capture, with the two numbers
    // the bench cannot see: the occlusion the raycasts found, and the gain that
    // occlusion and the distance curve together put on the voice.
    //
    // The gain is RECOMPUTED rather than read off the node. `acquire` schedules
    // it with `setValueAtTime(atten, when)` at a future time, so `gain.value`
    // read immediately afterwards is still the PREVIOUS tenant's value — which
    // is how the first run of this tool reported a 40 m shot at the gain of a
    // 10 m one. The arithmetic below is `attenuationAt` and `acquire`'s occlusion
    // term, verbatim.
    const atten = (d) => {
      const near = 2 / (2 + 0.85 * Math.max(0, d - 2));
      const far = 0.055 * Math.pow(60 / Math.max(d, 60), 0.55);
      return Math.max(near, d > 45 ? far : 0);
    };
    /**
     * `--oldocc` IS THE A/B CONTROL for the occlusion softening, in the spirit of
     * `--legacy` and `--off` above: it writes the OLD response — a 420 Hz
     * low-pass and a -26 dB shelf at a full block — back onto each emitter the
     * instant it is handed out, so before and after are two runs of one build on
     * one machine rather than a comparison across checkouts. It restores only
     * the two filter parameters that changed; the level term never moved.
     */
    const OLDOCC = /[?&]oldocc=1/.test(location.search) || window.__OLDOCC__ === true;
    const grabs = [];
    /**
     * THE OCCLUSION CENSUS — 「音がこもっている時が多い」 as a percentage.
     *
     * `Mixer`'s muffle is one candidate for a dull mix and it is easy to read.
     * The other one is per-voice and there are 72 of them: `acquire` puts every
     * spatialised sound through `occLP` at `20000 * 0.021^occ`, so occ 1.0 is a
     * 420 Hz low-pass, a -26 dB shelf and a 0.38 gain — and unlike the mixer's
     * muffle nothing reports it. This counts how often it is on, and how hard.
     */
    const census = { n: 0, sumOcc: 0, hi: 0, mid: 0, lo: 0, zero: 0, refused: 0, byBus: {} };
    window.__CENSUS__ = census;
    const f = a.field;
    const origAcquire = f.acquire.bind(f);
    f.acquire = (opts) => {
      const em = origAcquire(opts);
      if (em) {
        if (OLDOCC) {
          const t = em.startAt ?? actx.currentTime;
          em.occLP.frequency.cancelScheduledValues(t);
          em.occLP.frequency.setValueAtTime(
            Math.min(20000, Math.max(300, 20000 * Math.pow(0.021, em.occ))), t);
          em.occHS.gain.cancelScheduledValues(t);
          em.occHS.gain.setValueAtTime(-26 * em.occ, t);
        }
        const g = atten(em.dist) * (1 - 0.62 * em.occ) * (em.userGain ?? 1);
        grabs.push({
          tag: em.kindTag ?? opts.tag ?? null, bus: em.busName,
          dist: +em.dist.toFixed(1), occ: +em.occ.toFixed(2),
          ug: +(em.userGain ?? 1).toFixed(2), g: +g.toFixed(5),
        });
        census.n++;
        census.sumOcc += em.occ;
        if (em.occ >= 0.9) census.hi++;
        else if (em.occ >= 0.4) census.mid++;
        else if (em.occ > 0) census.lo++;
        else census.zero++;
        const b = (census.byBus[em.busName] ??= { n: 0, sumOcc: 0, hi: 0 });
        b.n++; b.sumOcc += em.occ; if (em.occ >= 0.9) b.hi++;
      } else {
        grabs.push({ tag: opts.tag ?? null, bus: opts.bus, refused: true });
        census.refused++;
      }
      return em;
    };

    window.__EAR__ = {
      start() {
        grabs.length = 0;
        for (const k in rec) {
          const r = rec[k];
          r.peak = 0; r.sumSq = 0; r.n = 0; r.on = true;
        }
      },
      stop() {
        for (const k in rec) rec[k].on = false;
        const o = rec.out, w = rec.world, b = rec.bright;
        const orms = Math.sqrt(o.sumSq / Math.max(1, o.n));
        const brms = Math.sqrt(b.sumSq / Math.max(1, b.n));
        return {
          peak: +o.peak.toFixed(5),
          rms: +orms.toFixed(6),
          hf: +(brms / Math.max(orms, 1e-9)).toFixed(3),
          worldPeak: +w.peak.toFixed(5),
          samples: o.n,
          grabs: grabs.slice(0, 12),
          muffle: +a.mixer.muffleGain.gain.value.toFixed(4),
          lp: Math.round(a.mixer.muffleLP.frequency.value),
        };
      },
      /** Somewhere `dist` metres from the ear on bearing `b` of eight. */
      at(dist, b) {
        const lp = a.field.listenerPos;
        const ang = (b / 8) * Math.PI * 2;
        return { x: lp.x + Math.cos(ang) * dist, y: lp.y, z: lp.z + Math.sin(ang) * dist };
      },
      fireOwn() {
        const lp = a.field.listenerPos;
        e.ctx.events.emit('weapon:fire', {
          weapon: 'rifle', firstPerson: true,
          origin: { x: lp.x + 0.2, y: lp.y - 0.1, z: lp.z - 0.3 }, dir: { x: 0, y: 0, z: -1 },
        });
      },
      fireAt(dist, b, rounds = 1) {
        const p = this.at(dist, b);
        for (let i = 0; i < rounds; i++) {
          e.ctx.events.emit('weapon:fire', { weapon: 'rifle', origin: p, dir: { x: 0, y: 0, z: -1 } });
        }
        return p;
      },
      /**
       * A shot with the occlusion FORCED, so the wall's own contribution is a
       * controlled difference rather than whatever the bearing happened to have
       * a building on. Same voice, same gain, same distance — only `occ` moves.
       */
      forced(dist, b, occ) {
        const p = this.at(dist, b);
        return a._playAt('shot', p.x, p.y, p.z, {
          firstPerson: false, echoBoost: 0.12, occlusion: occ, gain: 2,
        }, 'weapons', 0.9);
      },
      /**
       * ANOTHER MAN'S BOOT, at the trim `BattleLayer` gives it. It is here as a
       * REGRESSION CONTROL and not as a target: footsteps were made quieter on
       * request (「敵味方の足音はもう少し小さくしてください」) and a pass aimed at making
       * gunfire louder is exactly the kind that quietly hands that back.
       */
      step(dist, b, occ) {
        const p = this.at(dist, b);
        p.y = a.field.listenerPos.y - 1.6;
        const lvl = 0.45 + 0.35 * Math.max(0, Math.min(1, dist / 40));
        return a._playAt('step', p.x, p.y, p.z, {
          surface: 'concrete', gait: 'walk', level: lvl, gear: 0.22, occlusion: occ,
        }, 'foley', 0.28);
      },
      blast(dist, radius) {
        const p = this.at(dist, 0);
        p.y = a.field.listenerPos.y - 1.2;
        e.ctx.events.emit('explosion', { position: p, radius, damage: 260 });
        return p;
      },
      occlusion(on) { a.setOcclusionEnabled(on); },
      clearGates() { a.clearRateGates(); },
      resetMix() { a.mixer.resetDynamics(); },
      /**
       * WAIT ON THE AUDIO CLOCK, NOT THE WALL CLOCK, AND IT IS NOT A DETAIL.
       *
       * Headless Chrome renders into a null sink and does not hold real time:
       * measured here, `actx.currentTime` ran at 30 % of `performance.now()` for
       * stretches and finished a 90 s probe 48 s in arrears. A voice scheduled at
       * `currentTime` is rendered when the thread GETS there, so a capture window
       * counted in wall milliseconds can close before the event has been rendered
       * at all — which is exactly what happened on the first run of this mode:
       * the player's own rifle measured 0.0079 in one block and 0.0598 in the
       * next, same event, same build.
       */
      waitAudio(sec) {
        const target = actx.currentTime + sec;
        return new Promise((done) => {
          const id = setInterval(() => {
            if (actx.currentTime >= target) { clearInterval(id); done(+actx.currentTime.toFixed(2)); }
          }, 15);
        });
      },
      /** Block until the audio thread is keeping up, so a window means something. */
      levelUp(timeoutMs = 30000) {
        return new Promise((done) => {
          const t0 = performance.now();
          const tick = () => {
            const a0 = actx.currentTime, w0 = performance.now();
            setTimeout(() => {
              const ratio = (actx.currentTime - a0) / ((performance.now() - w0) / 1000);
              if (ratio > 0.92 || performance.now() - t0 > timeoutMs) {
                done({ ratio: +ratio.toFixed(3), waited: Math.round(performance.now() - t0) });
              } else tick();
            }, 600);
          };
          tick();
        });
      },
      state() {
        return {
          deaf: +a.mixer.deafness.toFixed(3),
          muffle: +a.mixer.muffleGain.gain.value.toFixed(4),
          lp: Math.round(a.mixer.muffleLP.frequency.value),
          voices: a.field.stats.active, cap: a.field.stats.cap,
        };
      },
    };
  });

  /* ---- 3. the panner's own insertion loss ------------------------- */
  const panner = await page.evaluate(async () => {
    // One noise burst, rendered twice: straight to the destination, and through
    // a PannerNode built exactly as src/audio/spatial.js builds one, at 10 m
    // dead ahead of a default listener. Nothing else in the graph.
    const run = async (usePanner) => {
      const SR = 48000;
      const ctx = new OfflineAudioContext(2, SR, SR);
      const b = ctx.createBuffer(1, SR * 0.2, SR);
      const d = b.getChannelData(0);
      let s = 12345;
      for (let i = 0; i < d.length; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        d[i] = ((s / 4294967296) * 2 - 1) * 0.5;
      }
      const src = ctx.createBufferSource();
      src.buffer = b;
      if (usePanner) {
        const p = ctx.createPanner();
        p.panningModel = 'HRTF';
        p.distanceModel = 'inverse';
        p.refDistance = 1;
        p.rolloffFactor = 0;
        p.maxDistance = 10000;
        p.coneInnerAngle = 360;
        p.positionX ? (p.positionX.value = 0, p.positionY.value = 0, p.positionZ.value = -10)
          : p.setPosition(0, 0, -10);
        src.connect(p);
        p.connect(ctx.destination);
      } else {
        src.connect(ctx.destination);
      }
      src.start(0);
      const out = await ctx.startRendering();
      let peak = 0, sum = 0, n = 0;
      for (let ch = 0; ch < out.numberOfChannels; ch++) {
        const c = out.getChannelData(ch);
        for (let i = 0; i < c.length; i++) {
          const v = c[i];
          const av = v < 0 ? -v : v;
          if (av > peak) peak = av;
          sum += v * v; n++;
        }
      }
      return { peak, rms: Math.sqrt(sum / n) };
    };
    const dry = await run(false);
    const wet = await run(true);
    return {
      dryPeak: +dry.peak.toFixed(4), dryRms: +dry.rms.toFixed(5),
      panPeak: +wet.peak.toFixed(4), panRms: +wet.rms.toFixed(5),
      dbPeak: +(20 * Math.log10(wet.peak / dry.peak)).toFixed(2),
      dbRms: +(20 * Math.log10(wet.rms / dry.rms)).toFixed(2),
    };
  });
  console.log('\n[ear] HRTF PANNER INSERTION LOSS (offline, one noise burst, 10 m ahead)');
  console.log(`  bypass  peak ${panner.dryPeak}  rms ${panner.dryRms}`);
  console.log(`  panner  peak ${panner.panPeak}  rms ${panner.panRms}   => ${panner.dbPeak} dB peak, ${panner.dbRms} dB rms`);
  console.log('  (the live path has this on EVERY remote sound; the player\'s own weapon has none of it)');

  /* ---- 1 & 2. single events at the output, sim frozen ------------- */
  const cases = [];
  /**
   * One event, three bearings, and the LOUDEST of the three is the answer.
   *
   * Not to flatter the number: a single trial can silently measure nothing at
   * all (the rate gate closed, the bin had not filled, the window slipped), and
   * a zero from a missed event is indistinguishable from a zero from a broken
   * mix. Three bearings also spread the event across three pieces of geometry,
   * so the occlusion-on figure is a best case rather than a lottery — which is
   * the honest way round, because the claim under test is "even the best case is
   * too quiet".
   */
  let block = 0;
  const runCase = async (label, fire, sec, trials = 3) => {
    let best = null;
    const all = [];
    for (let b = 0; b < trials; b++) {
      await page.evaluate(() => { window.__EAR__.resetMix(); window.__EAR__.clearGates(); });
      await page.evaluate((s) => window.__EAR__.waitAudio(s), 0.6);
      await page.evaluate(() => window.__EAR__.start());
      await page.evaluate((s) => window.__EAR__.waitAudio(s), 0.05);
      await fire(b * 3 + 1);
      await page.evaluate((s) => window.__EAR__.waitAudio(s), sec);
      const r = await page.evaluate(() => window.__EAR__.stop());
      all.push(r.peak);
      if (!best || r.peak > best.peak) best = r;
    }
    cases.push({ label, block, spread: all, ...best });
    return best;
  };

  for (const occOn of [true, false]) {
    block = occOn ? 0 : 1;
    await page.evaluate((on) => {
      window.__ENGINE__.time.scale = 0;
      window.__EAR__.occlusion(on);
    }, occOn);
    const lvl = await page.evaluate(() => window.__EAR__.levelUp());
    console.log(`\n[ear] audio clock level (occ ${occOn ? 'on' : 'off'}):`, JSON.stringify(lvl));
    const sfx = occOn ? '' : ' [occ off]';

    await runCase(`silence${sfx}`, async () => {}, 1.2, 1);
    await runCase(`own rifle${sfx}`, () => page.evaluate(() => window.__EAR__.fireOwn()), 1.4);
    for (const d of [10, 40, 55]) {
      await runCase(`remote rifle @${d}m${sfx}`,
        (b) => page.evaluate(([dd, bb]) => window.__EAR__.fireAt(dd, bb), [d, b]), 1.6);
    }
    // Past 60 m the near path culls and `BattleLayer` coalesces: six rounds flush
    // the bin at once, which is the voice the player would actually be given.
    for (const d of [90, 150]) {
      await runCase(`far layer @${d}m${sfx}`,
        (b) => page.evaluate(([dd, bb]) => window.__EAR__.fireAt(dd, bb, 6), [d, b]), 2.4);
    }
    await runCase(`blast r15 @12m${sfx}`,
      () => page.evaluate(() => window.__EAR__.blast(12, 15)), 3.0);
    await runCase(`blast r15 @35m${sfx}`,
      () => page.evaluate(() => window.__EAR__.blast(35, 15)), 3.0);
    await runCase(`grenade r6 @10m${sfx}`,
      () => page.evaluate(() => window.__EAR__.blast(10, 6)), 2.5);
    // The wall, isolated: identical voice and gain, occlusion 0 against 1.
    for (const occ of [0, 1]) {
      await runCase(`shot @40m occ=${occ}${sfx}`,
        (b) => page.evaluate(([dd, bb, oo]) => window.__EAR__.forced(dd, bb, oo), [40, b, occ]), 1.6);
    }
    for (const [d, occ] of [[8, 0], [20, 0], [20, 1], [40, 0]]) {
      await runCase(`step @${d}m occ=${occ}${sfx}`,
        (b) => page.evaluate(([dd, bb, oo]) => window.__EAR__.step(dd, bb, oo), [d, b, occ]), 1.2);
    }
  }

  console.log('\n[ear] AT THE OUTPUT — one event at a time, simulation frozen');
  console.log('  label                        outPeak    vs own     hf>2k   emitter dist/occ/gain');
  // The reference is THIS BLOCK's own rifle, not the run's. Both blocks fire the
  // same head-locked shot and `occlusionEnabled` cannot touch it, so any gap
  // between the two is measurement error — and it belongs to the block it was
  // measured in rather than being spread across the other one's ratios.
  const ownOf = (b) => cases.find((c) => c.block === b && c.label.startsWith('own rifle'))?.peak ?? 0;
  for (const c of cases) {
    const own = ownOf(c.block);
    const rel = own > 0 && c.peak > 0 ? `${(20 * Math.log10(c.peak / own)).toFixed(1)} dB` : '   -  ';
    const g = c.grabs.filter((x) => x.bus === 'weapons').slice(0, 2)
      .map((x) => (x.refused ? 'REFUSED' : `${x.dist}m occ${x.occ} x${x.ug} g${x.g}`)).join(' ; ');
    console.log(
      `  ${c.label.padEnd(26)} ${c.peak.toFixed(5)}  ${rel.padStart(8)}   ${String(c.hf).padStart(5)}   ${g}`
    );
  }
  // The control's own scatter, so the table can be read with the right number of
  // significant figures. Both blocks fire the identical head-locked shot.
  for (const b of [0, 1]) {
    const c = cases.find((x) => x.block === b && x.label.startsWith('own rifle'));
    if (c) console.log(`  [own rifle control, block ${b}] trials ${c.spread.map((v) => v.toFixed(4)).join(' ')}`);
  }

  /* ---- 4. the muffle through a real match ------------------------- */
  await page.evaluate((secs) => {
    const e = window.__ENGINE__;
    const a = e.ctx.peek('audio');
    a.setOcclusionEnabled(true);
    const c = window.__CENSUS__;
    c.n = 0; c.sumOcc = 0; c.hi = 0; c.mid = 0; c.lo = 0; c.zero = 0; c.refused = 0; c.byBus = {};
    e.time.scale = 3;
    const rec = [];
    window.__MUF__ = rec;
    window.__MUFID__ = setInterval(() => {
      rec.push({
        t: +a.actx.currentTime.toFixed(2),
        m: +a.mixer.muffleGain.gain.value.toFixed(4),
        lp: Math.round(a.mixer.muffleLP.frequency.value),
        hs: +a.mixer.muffleHS.gain.value.toFixed(2),
        d: +a.mixer.deafness.toFixed(3),
        dA: +a.mixer.buses.ambience.duck.gain.value.toFixed(3),
        dF: +a.mixer.buses.foley.duck.gain.value.toFixed(3),
        red: +(a.mixer.reduction ?? 0).toFixed(2),
      });
    }, 100);
    void secs;
  }, MATCHSECS);
  console.log(`\n[ear] muffle trace: ${MATCHSECS}s of a live match at 3x …`);
  await page.waitForTimeout(MATCHSECS * 1000);
  const { muf, census } = await page.evaluate(() => {
    clearInterval(window.__MUFID__);
    return { muf: window.__MUF__, census: window.__CENSUS__ };
  });
  const cn = census.n || 1;
  console.log('\n[ear] THE OCCLUSION CENSUS — every spatial voice the match handed out');
  console.log(`  voices ${census.n} (refused ${census.refused})   mean occlusion ${(census.sumOcc / cn).toFixed(3)}`);
  console.log(`  occ >= 0.9 (420 Hz LP, -26 dB shelf, x0.38 gain)  ${(100 * census.hi / cn).toFixed(1)}%`);
  console.log(`  occ 0.4-0.9                                       ${(100 * census.mid / cn).toFixed(1)}%`);
  console.log(`  occ 0-0.4                                         ${(100 * census.lo / cn).toFixed(1)}%`);
  console.log(`  occ exactly 0 (clear line, or the layer forced it) ${(100 * census.zero / cn).toFixed(1)}%`);
  for (const b in census.byBus) {
    const v = census.byBus[b];
    console.log(`    ${b.padEnd(9)} n ${String(v.n).padStart(5)}  mean occ ${(v.sumOcc / v.n).toFixed(3)}  fully blocked ${(100 * v.hi / v.n).toFixed(1)}%`);
  }
  const n = muf.length || 1;
  const partOn = muf.filter((r) => r.m < 0.999).length;
  const deep = muf.filter((r) => r.m < 0.85).length;
  const lpDown = muf.filter((r) => r.lp < 19000).length;
  const lp5k = muf.filter((r) => r.lp < 5000).length;
  const worstM = muf.reduce((m, r) => Math.min(m, r.m), 1);
  const worstLp = muf.reduce((m, r) => Math.min(m, r.lp), 20000);
  const duckedA = muf.filter((r) => r.dA < 0.9).length;
  console.log('\n[ear] THE MUFFLE THROUGH A MATCH (10 Hz)');
  console.log(`  samples ${n} over ${(n / 10).toFixed(0)}s of wall time`);
  console.log(`  muffleGain  < 0.999 for ${(100 * partOn / n).toFixed(1)}%   < 0.85 for ${(100 * deep / n).toFixed(1)}%   worst ${worstM}`);
  console.log(`  muffleLP    < 19 kHz for ${(100 * lpDown / n).toFixed(1)}%   < 5 kHz for ${(100 * lp5k / n).toFixed(1)}%   worst ${worstLp} Hz`);
  console.log(`  ambience duck < 0.9 for ${(100 * duckedA / n).toFixed(1)}%`);
  const stride = Math.max(1, Math.floor(n / 30));
  console.log('     t   muffle    lp    hs   deaf  duckA duckF   comp');
  for (let i = 0; i < muf.length; i += stride) {
    const r = muf[i];
    console.log(
      `  ${String(r.t.toFixed(1)).padStart(6)} ${r.m.toFixed(4)} ${String(r.lp).padStart(6)} ${String(r.hs).padStart(6)} ` +
      `${r.d.toFixed(3)} ${r.dA.toFixed(3)} ${r.dF.toFixed(3)} ${String(r.red).padStart(6)}`
    );
  }

  console.log('\n[ear] final', JSON.stringify(await sampleOrNull(page)));
  console.log('[ear] page errors', pageErrors.slice(0, 8));
  await browser.close();
  process.exit(0);
}

/* ==================================================================== */
/* --collapse: THE CATHEDRAL, AND WHAT IT DOES TO THE POOL              */
/* ==================================================================== */
/**
 * 「大聖堂破壊はもっと音大きく激しくして」
 *
 * The collapse is the one moment in a match where the emitter pool is already
 * spoken for: measured, the salvo holds sixteen of the field's slots when it
 * fires, and the render governor may have the field down to twenty-four. Adding
 * three long voices to that is exactly the kind of change that has silenced this
 * game before, so it gets its own probe rather than being inferred from a
 * firefight average.
 *
 * It forces the event through `match._beginCathedralEvent` — the same door the
 * visual probes use — and samples the pool at 20 Hz across the whole 22 second
 * beat sheet, printing the salvo, the collapse and the settle as one trace with
 * the three new voices marked. What has to be true afterwards: the collapse
 * voices played, nothing was dropped, and the governor came back to full.
 *
 *   node tools/audiotest.mjs --collapse [--url=…] [--scale=1]
 */
if (args.collapse) {
  const CSCALE = Number(args.scale ?? 1);
  await page.evaluate(({ scale, bare }) => {
    const e = window.__ENGINE__;
    const a = e.ctx.peek('audio');
    const rec = [];
    // `--bare` is the CONTROL: the same event, the same match, without the three
    // new voices, so what they cost the pool is a difference rather than a claim.
    window.__CBARE__ = !!bare;
    window.__CT__ = rec;
    const played = { tear: 0, sub: 0, bell: 0, tail: 0, rubble: 0, settle: 0 };
    window.__CPLAY__ = played;
    // Count what `match` actually asks for, at the moment it asks — the only way
    // to tell "the voice was refused" from "the event never called for it".
    const orig = a.play.bind(a);
    /**
     * INJECT THE THREE NEW VOICES WHERE THE COLLAPSE WILL PLAY THEM.
     *
     * `src/match` does not call them yet — it asked for them to exist and is
     * wiring its side separately — so measuring the pool without them would
     * measure the old event and prove nothing about the new one. The first
     * `strike_tail` of the raze is the collapse frame (the caller sends it at
     * level 1.8, far above the 1.25 an ordinary site uses), so the three are
     * fired at that instant, at that position, exactly as the caller intends:
     * the bed and the sub together, the bell a beat later as the tower goes.
     */
    let injected = false;
    a.play = (kind, pos, opts) => {
      if (kind === 'collapse_tear') played.tear++;
      else if (kind === 'collapse_sub') played.sub++;
      else if (kind === 'collapse_bell') played.bell++;
      else if (kind === 'strike_tail') played.tail++;
      else if (kind === 'strike_rubble') played.rubble++;
      else if (kind === 'strike_settle') played.settle++;
      const r = orig(kind, pos, opts);
      if (!window.__CBARE__ && !injected && kind === 'strike_tail' && (opts?.level ?? 0) >= 1.5 && pos) {
        injected = true;
        const at = { x: pos.x, y: pos.y, z: pos.z };
        orig('collapse_tear', at, { dur: 7, size: 1 });
        orig('collapse_sub', at, { dur: 2.0 });
        orig('collapse_bell', at, { strikes: 3, extraDelay: 0.9 });
      }
      return r;
    };
    window.__CSAMP__ = setInterval(() => {
      const f = a.field;
      if (!f) return;
      const bus = { weapons: 0, foley: 0, voice: 0, ambience: 0 };
      let coll = 0;
      for (const em of f.emitters) {
        if (em.free) continue;
        bus[em.busName] = (bus[em.busName] ?? 0) + 1;
        if (em.kindTag === 'collapse') coll++;
      }
      const w = a.watchdog;
      rec.push({
        t: +e.time.elapsed.toFixed(2),
        act: f.stats.active, cap: f.stats.cap, coll,
        wpn: bus.weapons, fol: bus.foley, voi: bus.voice, amb: bus.ambience,
        dropped: f.stats.dropped, stolen: f.stats.stolen,
        behind: +f.stats.behind.toFixed(2), deficit: +f.stats.deficit.toFixed(2),
        outRms: +(w?.out.rms ?? 0).toFixed(6), outPeak: +(w?.out.peak ?? 0).toFixed(4),
        deaf: +(a.mixer?.deafness ?? 0).toFixed(3),
        duckA: +(a.mixer?.buses.ambience.duck.gain.value ?? 1).toFixed(3),
        red: +(a.mixer?.reduction ?? 0).toFixed(1),
        soft: w?.softRecoveries ?? -1, hard: w?.hardRecoveries ?? -1, pool: w?.poolDrains ?? -1,
        errors: a.stats.errors,
      });
    }, 50);
    e.time.scale = scale;
  }, { scale: CSCALE, bare: !!args.bare });

  // Let the match settle into `live` before dropping a cathedral on it, so the
  // pool is carrying a real firefight rather than a freeze-time idle.
  console.log('[audiotest] collapse: warming the match up …');
  await page.waitForTimeout(45000);
  const pre = await page.evaluate(() => {
    const a = window.__ENGINE__.ctx.peek('audio');
    return { voices: a.field.stats.active, cap: a.field.stats.cap, stolen: a.field.stats.stolen };
  });
  console.log('[audiotest] pool before the event:', JSON.stringify(pre));

  const fired = await page.evaluate(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    if (!m?._beginCathedralEvent) return false;
    m._beginCathedralEvent(m.ctx.time.elapsed, 0.99);
    return true;
  });
  console.log(`[audiotest] cathedral event opened: ${fired}`);
  const t0 = await page.evaluate(() => window.__ENGINE__.time.elapsed);
  await page.waitForTimeout(40000);

  const rec = await page.evaluate(() => {
    clearInterval(window.__CSAMP__);
    return { rows: window.__CT__, played: window.__CPLAY__ };
  });
  const rows = rec.rows.filter((r) => r.t >= t0 - 3);
  console.log('\n[audiotest] THE COLLAPSE — pool at 20 Hz, event-relative seconds');
  console.log('    t   act  cap coll  wpn  fol  voi  amb   drop  stol  behind  outRms   outPk   deaf duckA  comp');
  let prev = null;
  for (const r of rows) {
    const et = r.t - t0;
    // Print every 0.5 s, and EVERY row where something changed in the pool —
    // the whole event is four seconds wide and a fixed stride would miss it.
    const interesting = !prev || r.coll !== prev.coll || r.dropped !== prev.dropped ||
      Math.abs(r.act - prev.act) > 6 || r.cap !== prev.cap;
    if (!interesting && prev && r.t - prev.t < 0.5) continue;
    prev = r;
    console.log(
      `${String(et.toFixed(2)).padStart(6)} ${String(r.act).padStart(4)} ${String(r.cap).padStart(4)} ` +
      `${String(r.coll).padStart(4)} ${String(r.wpn).padStart(4)} ${String(r.fol).padStart(4)} ` +
      `${String(r.voi).padStart(4)} ${String(r.amb).padStart(4)} ${String(r.dropped).padStart(6)} ` +
      `${String(r.stolen).padStart(5)} ${String(r.behind).padStart(7)} ${r.outRms.toExponential(2)} ` +
      `${r.outPeak.toFixed(4)} ${r.deaf.toFixed(2)} ${r.duckA.toFixed(3)} ${String(r.red).padStart(6)}`
    );
  }
  const peak = rows.reduce((m, r) => Math.max(m, r.outPeak), 0);
  const maxColl = rows.reduce((m, r) => Math.max(m, r.coll), 0);
  const maxAct = rows.reduce((m, r) => Math.max(m, r.act), 0);
  const minCap = rows.reduce((m, r) => Math.min(m, r.cap), 999);
  const endCap = rows[rows.length - 1]?.cap ?? 0;
  const dropped = (rows[rows.length - 1]?.dropped ?? 0) - (rows[0]?.dropped ?? 0);
  console.log(`\n  voices `+ JSON.stringify(rec.played));
  console.log(`  collapse emitters held, peak ${maxColl}   field peak ${maxAct}   pool floor ${minCap}   pool at end ${endCap}`);
  console.log(`  voices dropped across the event ${dropped}   output peak ${peak.toFixed(4)}`);
  console.log(`  watchdog soft/hard/pool ${rows[rows.length - 1]?.soft}/${rows[rows.length - 1]?.hard}/${rows[rows.length - 1]?.pool}`);
  console.log('\n[audiotest] final', JSON.stringify(await sampleOrNull(page)));
  console.log('[audiotest] page errors', pageErrors.slice(0, 8));
  await browser.close();
  process.exit(0);
}

/* ==================================================================== */
/* --dropout: BREAK THE GRAPH ON PURPOSE, AND TIME THE RECOVERY         */
/* ==================================================================== */
/**
 * 「音が消えるバグ起きますね 何度でも 音バグは必ず直して」
 *
 * The dropout has been diagnosed twice, fixed twice, and reported again. What
 * has never been done is the thing this mode does: put the graph into each
 * silent state ON PURPOSE and measure whether it comes back on its own, without
 * a pause and without a reload.
 *
 * Six faults, one per known way the sound can stop. For each: read the output
 * analyser, inject, wait, and report how long the master bus was actually silent
 * and which rung of the watchdog's ladder answered it. A guard that cannot be
 * shown recovering from the condition it was written for is not a guard, it is a
 * comment.
 *
 *   node tools/audiotest.mjs --dropout [--url=…]
 *
 * WHAT THIS CANNOT TEST — and it is the important sentence in this file. If the
 * real fault on the player's machine is the audio thread missing its deadlines
 * while the graph and the device clock both look healthy, the output analyser
 * reads NORMAL throughout, none of these guards fire, and this mode passes while
 * he still cannot hear anything. Headless Chrome renders through a null sink, so
 * that failure mode cannot be produced here at all. @see src/audio/watchdog.js
 */
if (args.dropout) {
  const probe = () => page.evaluate(() => {
    const a = window.__ENGINE__.ctx.peek('audio');
    const w = a?.watchdog;
    return {
      ok: !!w,
      state: a?.actx?.state ?? 'none',
      outRms: w?.out.rms ?? -1,
      worldRms: w?.world.rms ?? -1,
      silentFor: w?.silentFor ?? -1,
      soft: w?.softRecoveries ?? -1,
      hard: w?.hardRecoveries ?? -1,
      resumes: w?.resumeTries ?? -1,
      restarts: a?.restarts ?? -1,
      muffle: +(a?.mixer?.muffleGain.gain.value ?? -1).toFixed(4),
      master: +(a?.mixer?.masterGain.gain.value ?? -1).toFixed(4),
      duckAmb: +(a?.mixer?.buses.ambience.duck.gain.value ?? -1).toFixed(4),
      voices: a?.field?.stats.active ?? -1,
      errors: a?.stats.errors ?? -1,
      log: w?.log.slice(0, 2) ?? [],
    };
  });

  const settle = async (ms) => { await page.waitForTimeout(ms); return probe(); };
  const before = await settle(2500);
  console.log('\n[audiotest] DROPOUT — the graph is broken on purpose, six ways');
  console.log('  healthy baseline:', JSON.stringify(before));
  if (!before.ok) {
    console.log('  !! this build has no watchdog — nothing to test');
    await browser.close();
    process.exit(1);
  }

  const faults = [
    {
      name: 'context suspended',
      why: 'device change / audio focus / policy. update() used to return for ever',
      break: () => page.evaluate(async () => {
        await window.__ENGINE__.ctx.peek('audio').actx.suspend();
      }),
      wait: 3000,
    },
    {
      name: 'muffle gain stuck at 0',
      why: 'a concussion whose recovery integrator stopped being stepped',
      break: () => page.evaluate(() => {
        const m = window.__ENGINE__.ctx.peek('audio').mixer;
        m.deafness = 0;
        m.muffleGain.gain.cancelScheduledValues(m.actx.currentTime);
        m.muffleGain.gain.setValueAtTime(0, m.actx.currentTime);
      }),
      wait: 3500,
    },
    {
      name: 'sidechain held open',
      why: 'continuous gunfire re-arming duck() faster than it releases',
      break: () => page.evaluate(() => {
        const m = window.__ENGINE__.ctx.peek('audio').mixer;
        for (let i = 0; i < 6; i++) m.duck(0.92, 60);
      }),
      wait: 5000,
    },
    {
      name: 'master gain at 0',
      why: 'a stray write, or a ramp that never completed',
      break: () => page.evaluate(() => {
        const m = window.__ENGINE__.ctx.peek('audio').mixer;
        m.masterGain.gain.cancelScheduledValues(m.actx.currentTime);
        m.masterGain.gain.setValueAtTime(0, m.actx.currentTime);
      }),
      wait: 3500,
    },
    {
      name: 'voice pool pinned',
      why: 'the reported latch: every slot held, nothing can play',
      break: () => page.evaluate(() => {
        const f = window.__ENGINE__.ctx.peek('audio').field;
        const now = f.actx.currentTime;
        for (const e of f.emitters) {
          e.free = false;
          e.tracked = true;          // exempt from the expiry loop, as a bed is
          e.lease = Infinity;        // …and pretend its owner still wants it
          e.endTime = now + 1e6;
          e.wallEnd = Infinity;
        }
      }),
      // Nine seconds against a four second threshold: the clock only starts on
      // the first sample where all three pin conditions hold together.
      wait: 9000,
      // The pool being full is not silence — the beds still play — so this one
      // is judged on whether the SLOTS came back, not on the analyser. The bar
      // is "the field is recycling again", not any particular occupancy: a real
      // match refills it within a frame or two of the drain, and it did (72 ->
      // 8 -> 26 across three samples on the run this was written against).
      check: (p) => p.voices < 60,
    },
    {
      name: 'master chain severed',
      why: 'a poisoned node: NaN through the compressor, or a lost edge',
      break: () => page.evaluate(() => {
        const m = window.__ENGINE__.ctx.peek('audio').mixer;
        m.masterSum.disconnect();
      }),
      wait: 9000,
    },
  ];

  let failures = 0;
  for (const f of faults) {
    await f.break();
    const during = await settle(400);
    const after = await settle(f.wait);
    const healed = f.check ? f.check(after) : after.outRms > 2e-6;
    if (!healed) failures++;
    console.log(
      `\n  ${healed ? 'RECOVERED' : 'STILL BROKEN'}  ${f.name}\n` +
      `    (${f.why})\n` +
      `    during  state=${during.state} outRms=${during.outRms.toExponential(2)} voices=${during.voices}\n` +
      `    after   state=${after.state} outRms=${after.outRms.toExponential(2)} voices=${after.voices} ` +
      `silentFor=${after.silentFor}\n` +
      `    ladder  resumes=${after.resumes} soft=${after.soft} hard=${after.hard} restarts=${after.restarts}` +
      `  master=${after.master} muffle=${after.muffle} duckAmb=${after.duckAmb}\n` +
      (after.log.length ? `    log     ${after.log.join(' | ')}\n` : '')
    );
    // Let the hard-recovery cooldown lapse so the next fault is judged on its
    // own rung of the ladder rather than on the previous one's cooldown.
    await page.waitForTimeout(1200);
  }

  const final = await probe();
  console.log('\n[audiotest] final', JSON.stringify(final));
  console.log('[audiotest] page errors', pageErrors.slice(0, 8));
  console.log(failures === 0
    ? '[audiotest] DROPOUT: PASS — every injected fault healed itself'
    : `[audiotest] DROPOUT: FAIL — ${failures} fault(s) did not heal`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

/* ==================================================================== */
/* --battle: emitter pressure through a real 20 v 20, per BUS           */
/* ==================================================================== */
/**
 * `--burst` answers "can a synthetic storm kill the graph". It cannot answer
 * "what does the pool actually hold while forty men fight", and that is the
 * question every change to the battle mix has to answer, because the pool is
 * shared and the roster went 15v15 -> 20v20.
 *
 * Two things get sampled that nothing else looks at:
 *
 *  1. THE PER-BUS SPLIT of the live emitters. The last two passes over this
 *     area were both wrong about which bus was eating the field — one blamed
 *     gunfire when 50 of 72 slots were foley, the next capped foley and watched
 *     weapons take 42-50 and start DROPPING voices. A single `active` count
 *     cannot tell those apart; the split can.
 *  2. WHAT WAS OFFERED vs WHAT WAS PLAYED. Every `weapon:fire` is classified by
 *     its distance from the listener at the moment it is emitted, so "the battle
 *     is inaudible" can be measured as a ratio rather than asserted: how many
 *     remote shots happened, and how many of them the audio system admitted.
 *
 *   node tools/audiotest.mjs --battle [--seconds=90] [--scale=3] [--off]
 *
 * `--off` is the A/B CONTROL, in the spirit of `--legacy` above: it turns the
 * new battle layers off at runtime (`audio.battle.enabled = false`), so before
 * and after are measured minutes apart on ONE build and ONE machine rather than
 * across two checkouts. On a build that predates them it simply does nothing.
 */
if (args.battle) {
  const BSEC = Number(args.seconds ?? 90);
  const BSCALE = Number(args.scale ?? 3);
  if (args.off) {
    const did = await page.evaluate(() => {
      const a = window.__ENGINE__.ctx.peek('audio');
      if (!a?.battle) return false;
      a.battle.enabled = false;
      return true;
    });
    console.log(`[audiotest] battle layers ${did ? 'DISABLED (control run)' : 'not present in this build'}`);
  }

  await page.evaluate((scale) => {
    const e = window.__ENGINE__;
    const a = e.ctx.peek('audio');
    const rec = [];
    const fires = { own: 0, near: 0, mid: 0, far: 0, beyond: 0 };
    window.__BAT__ = { rec, fires };
    e.ctx.events.on('weapon:fire', (p) => {
      if (p?.empty) return;
      const o = p?.origin;
      if (!o || !a?.field) { fires.own++; return; }
      const d = a.field.distanceTo(o.x, o.y, o.z);
      if (p.firstPerson || d < 2.6) fires.own++;
      else if (d < 30) fires.near++;
      else if (d < 70) fires.mid++;
      else if (d < 200) fires.far++;
      else fires.beyond++;
    });
    window.__BSAMP__ = setInterval(() => {
      const f = a.field;
      if (!f) return;
      const bus = { weapons: 0, foley: 0, voice: 0, ambience: 0, ui: 0 };
      let tracked = 0;
      for (const em of f.emitters) {
        if (em.free) continue;
        bus[em.busName] = (bus[em.busName] ?? 0) + 1;
        if (em.tracked) tracked++;
      }
      const m = e.ctx.peek('match');
      const ai = e.ctx.peek('ai');
      rec.push({
        t: +e.time.elapsed.toFixed(1),
        w: +(performance.now() / 1000).toFixed(2),
        state: a.actx?.state ?? 'none',
        act: f.stats.active, cap: f.stats.cap,
        wpn: bus.weapons, fol: bus.foley, voi: bus.voice, amb: bus.ambience, trk: tracked,
        deficit: +f.stats.deficit.toFixed(3),
        behind: +f.stats.behind.toFixed(3),
        dropped: f.stats.dropped, stolen: f.stats.stolen, expired: f.stats.expired,
        errors: a.stats.errors,
        alive: ai ? ai.agents.reduce((n, x) => n + (x.alive ? 1 : 0), 0) : 0,
        phase: m?.phase ?? '-',
        // Present only on a build that has the battle layers. @see AudioSystem.battle
        bat: a.battle ? { ...a.battle.stats } : null,
        /**
         * THE WATCHDOG'S OWN COUNTERS, sampled through a match that is NOT
         * broken. Every one of them should stay at zero: a recovery that fires
         * during ordinary play is a false positive, and a false positive here
         * means draining the pool or rebuilding the graph in the middle of a
         * firefight — worse than the fault it is guarding against.
         */
        wd: a.watchdog ? {
          soft: a.watchdog.softRecoveries,
          hard: a.watchdog.hardRecoveries,
          pool: a.watchdog.poolDrains,
          resumes: a.watchdog.resumeTries,
          outRms: +a.watchdog.out.rms.toExponential(2),
          silentFor: +a.watchdog.silentFor.toFixed(2),
          queued: +a.watchdog.queued.toFixed(4),
        } : null,
        fires: { ...fires },
        dt: +e.time.dt.toFixed(4),
      });
    }, 250);
    e.time.scale = scale;
  }, BSCALE);

  console.log(`[audiotest] battle: ${BSEC}s wall at ${BSCALE}x …`);
  /**
   * `--tank` FORCES THE SORTIE. Armour arrives late by design — `match` sends it
   * when the cathedral comes down — so a three minute probe never sees one, and
   * the engine and the main gun would go unmeasured in every run that matters.
   * `armour.fire()` is the published hook for exactly this.
   */
  if (args.tank) {
    await page.waitForTimeout(Math.min(20000, BSEC * 300));
    const rolled = await page.evaluate(() => {
      const m = window.__ENGINE__.ctx.peek('match');
      const a = m?.tank ?? m?.armour;
      return a ? { fired: a.fire(), tanks: a.tanks.map((t) => ({ id: t.id, alive: t.alive })) } : null;
    });
    console.log('[audiotest] tank sortie forced:', JSON.stringify(rolled));
  }
  await page.waitForTimeout(BSEC * 1000);

  const rec = await page.evaluate(() => {
    clearInterval(window.__BSAMP__);
    return window.__BAT__.rec;
  });

  const num = (v) => (Number.isFinite(v) ? v : 0);
  const rows = rec.filter((r) => r.state === 'running');
  const warm = rows.slice(Math.floor(rows.length * 0.25)); // drop the spawn-in
  const stat = (key) => {
    const vals = warm.map((r) => num(r[key])).sort((a, b) => a - b);
    if (!vals.length) return { mean: 0, p50: 0, p95: 0, max: 0 };
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return {
      mean: +mean.toFixed(1),
      p50: vals[Math.floor(vals.length * 0.5)],
      p95: vals[Math.floor(vals.length * 0.95)],
      max: vals[vals.length - 1],
    };
  };

  console.log('\n[audiotest] BATTLE — emitter pressure, sampled at 4 Hz');
  console.log('   t   alive  act  cap  wpn  fol  voi  amb  trk  deficit behind  drop  stol  err  phase');
  const step = Math.max(1, Math.floor(rows.length / 40));
  for (let i = 0; i < rows.length; i += step) {
    const r = rows[i];
    console.log(
      `${String(r.t).padStart(5)} ${String(r.alive).padStart(5)} ${String(r.act).padStart(4)} ${String(r.cap).padStart(4)} ` +
      `${String(r.wpn).padStart(4)} ${String(r.fol).padStart(4)} ${String(r.voi).padStart(4)} ${String(r.amb).padStart(4)} ${String(r.trk).padStart(4)} ` +
      `${String(r.deficit.toFixed(3)).padStart(7)} ${String(r.behind.toFixed(2)).padStart(6)} ` +
      `${String(r.dropped).padStart(5)} ${String(r.stolen).padStart(5)} ${String(r.errors).padStart(4)}  ${r.phase}`
    );
  }

  const last = rows[rows.length - 1] ?? {};
  const first = warm[0] ?? {};
  const secs = Math.max(0.001, num(last.t) - num(first.t));
  console.log('\n[audiotest] steady state (last 75% of the run)');
  for (const k of ['act', 'cap', 'wpn', 'fol', 'voi', 'amb', 'trk', 'behind', 'deficit']) {
    const s = stat(k);
    console.log(`  ${k.padEnd(8)} mean ${String(s.mean).padStart(7)}  p50 ${String(s.p50).padStart(6)}  p95 ${String(s.p95).padStart(6)}  max ${String(s.max).padStart(6)}`);
  }
  console.log(`\n  voices stolen ${num(last.stolen)}   dropped ${num(last.dropped)}   expired-early ${num(last.expired)}   errors ${num(last.errors)}`);
  console.log(`  weapon:fire offered over ${secs.toFixed(0)}s of game — ${JSON.stringify(last.fires)}`);
  if (last.bat) console.log(`  battle layers played — ${JSON.stringify(last.bat)}`);
  if (last.wd) console.log(`  watchdog (all should be 0 in a healthy match) — ${JSON.stringify(last.wd)}`);
  console.log('\n[audiotest] final', JSON.stringify(await sampleOrNull(page)));
  console.log('[audiotest] page errors', pageErrors.slice(0, 8));
  await browser.close();
  process.exit(0);
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
