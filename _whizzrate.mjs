/**
 * NEAR-MISS AUDIBILITY PROBE.
 *
 * Counts, in a live match, how many rounds pass close to the player and how
 * many of those produce a whizz voice — and what the whizz costs the pool.
 *
 *   node _whizzrate.mjs [--map=town] [--seconds=60] [--scale=6]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const MAP = args.map ?? 'town';
const SECONDS = Number(args.seconds ?? 60);
const SCALE = Number(args.scale ?? 6);
const URL = `http://127.0.0.1:4594/?map=${MAP}`;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-frame-rate-limit',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const boot = await page.evaluate(async (scale) => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const audio = ctx.peek('audio');
  try { await audio?.start?.(); } catch { /* reported below */ }
  const ai = ctx.peek('ai');
  const M = { misses: [], whizz: 0, whizzFromTracer: 0, whizzFromImpact: 0,
    tracerEvents: 0, impactEvents: 0, aiShots: 0, denied: 0,
    peakVoices: 0, stolenAtStart: 0, samples: [] };
  window.__M__ = M;

  // Ground truth: every bot round, its true miss distance at closest approach
  // to the player. Wrap the AI's own per-round test so we measure exactly what
  // the game already computes rather than re-deriving it.
  if (ai && ai._testPlayerHit) {
    const orig = ai._testPlayerHit.bind(ai);
    ai._testPlayerHit = function (agent, origin, dir, end) {
      M.aiShots++;
      try {
        const player = ctx.peek('player');
        const p = ai.playerPosition(ai._v);
        if (p && !player?.dead) {
          const maxT = end ? origin.distanceTo(end) : 200;
          const px = p.x - origin.x, py = p.y - origin.y, pz = p.z - origin.z;
          const t = px * dir.x + py * dir.y + pz * dir.z;
          if (t >= 0.5 && t <= maxT) {
            const miss = Math.hypot(px - dir.x * t, py - dir.y * t, pz - dir.z * t);
            if (miss <= 6) M.misses.push({ m: miss, t: ctx.time.elapsed });
          }
        }
      } catch { /* measurement must never break the match */ }
      return orig(agent, origin, dir, end);
    };
  }

  if (audio) {
    M.stolenAtStart = audio.stats.stolen;
    const oi = audio._onImpact.bind(audio);
    audio._onImpact = (p) => { M.impactEvents++; const b = M.whizz; oi(p);
      if (M.whizz > b) M.whizzFromImpact += M.whizz - b; };
    const ot = audio._onTracer.bind(audio);
    audio._onTracer = (p) => { M.tracerEvents++; const b = M.whizz; ot(p);
      if (M.whizz > b) M.whizzFromTracer += M.whizz - b; };
    // Count whizz voices at the single point they are all created.
    const pa = audio._playAt.bind(audio);
    audio._playAt = (kind, x, y, z, o, bus, pri) => {
      if (kind === 'whizz') M.whizz++;
      return pa(kind, x, y, z, o, bus, pri);
    };
    const al = audio._allow.bind(audio);
    audio._allow = (k) => { const r = al(k); if (!r && k === 'whizz') M.denied++; return r; };
  }

  setInterval(() => {
    const a = ctx.peek('audio');
    if (!a) return;
    const v = a.stats.voices ?? 0;
    if (v > M.peakVoices) M.peakVoices = v;
    M.samples.push({ t: ctx.time.elapsed, v, stolen: a.stats.stolen, drop: a.stats.dropped });
  }, 250);

  ctx.time.scale = scale;
  return { running: audio?.running ?? null, state: audio?.actx?.state ?? 'none',
    battle: !!audio?.battle, script: document.querySelector('script[src*="assets/"]')?.getAttribute('src') ?? null };
}, SCALE);
console.log('[whizzrate] audio at boot:', JSON.stringify(boot));

await page.waitForTimeout(SECONDS * 1000);

const out = await page.evaluate(() => {
  const e = window.__ENGINE__, M = window.__M__;
  const a = e.ctx.peek('audio');
  const el = e.ctx.time.elapsed;
  const band = (lo, hi) => M.misses.filter((x) => x.m >= lo && x.m < hi).length;
  return {
    level: e.ctx.peek('world').level.id,
    phase: e.ctx.peek('match')?.phase ?? '?',
    gameSeconds: el,
    aiShots: M.aiShots,
    misses_all6m: M.misses.length,
    band_0_1_6: band(0, 1.6), band_1_6_3: band(1.6, 3),
    band_3_5: band(3, 5), band_5_6: band(5, 6),
    whizzVoices: M.whizz,
    whizzFromTracer: M.whizzFromTracer,
    whizzFromImpact: M.whizzFromImpact,
    tracerEvents: M.tracerEvents,
    impactEvents: M.impactEvents,
    whizzDeniedByRate: M.denied,
    peakVoices: M.peakVoices,
    stolen: (a?.stats.stolen ?? 0) - M.stolenAtStart,
    dropped: a?.stats.dropped ?? 0,
    audioErrors: a?.stats.errors ?? 0,
    audioFailed: !!a?.failed,
  };
});

const perMin = (n) => (n / (out.gameSeconds / 60)).toFixed(1);
console.log(`\n=== ${MAP} — ${out.gameSeconds.toFixed(0)}s game time, phase=${out.phase} ===`);
console.log(JSON.stringify(out, null, 2));
console.log(`\nnear misses <6m : ${perMin(out.misses_all6m)}/min   <1.6m: ${perMin(out.band_0_1_6)}/min`);
console.log(`whizz voices    : ${perMin(out.whizzVoices)}/min`);
console.log(`AUDIBLE FRACTION of <6m misses: ${(100 * out.whizzVoices / Math.max(1, out.misses_all6m)).toFixed(1)}%`);
console.log(`pageerrors=${errs.length}`);
if (errs.length) console.log('  first:', errs[0]);
await browser.close();
