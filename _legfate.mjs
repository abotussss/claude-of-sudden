/**
 * WHY DOES A CACHE LEG NOT END IN A CRATE BEING OPENED?
 *
 * `_indoorplus.mjs` measured 79 legs handed out on one seed and `botTakes: 1`.
 * Either the men never arrive, or they arrive and the crate has nothing for
 * them. Those are opposite bugs, so this separates them before anything is
 * changed: every leg is followed from the frame it is handed out to the frame
 * it ends, and the END is classified —
 *
 *   arrived   `_matchCacheHeld` went true (this is what calls `takeForBot`)
 *   timeout   `_matchCacheUntil` passed with the man still walking
 *   died      he was killed on the way
 *   dropped   the tag disappeared some other way (re-plan, respawn)
 *
 * plus, for the ones that did not arrive, HOW CLOSE HE EVER GOT and how far he
 * had to go when he was given it. Read-only: nothing in the page is modified
 * except a sampler.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4293/';
const SCALE = Number(args.scale ?? 6);
const SECONDS = Number(args.seconds ?? 45);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit'] });
const p = await b.newPage({ viewport: { width: 1000, height: 600 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await p.evaluate((s) => { window.__ENGINE__.time.scale = s; }, SCALE);
await p.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 180000 });

await p.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const m = e.ctx.peek('match');
  const L = { open: new Map(), done: [], objModes: {} };
  window.__L__ = L;
  const step = e.step.bind(e);
  e.step = (now) => {
    step(now);
    const t = e.ctx.time.elapsed;
    const seen = new Set();
    for (const a of ai.agents) {
      if (!a.alive || !a._matchCache) continue;
      seen.add(a);
      const d = a.position.distanceTo(a._matchCache.stand);
      let r = L.open.get(a);
      if (!r || r.cache !== a._matchCache) {
        r = { cache: a._matchCache, id: a._matchCache.id, kind: a._matchCache.kind, t0: t, d0: d, best: d, held: false, obj: {} };
        L.open.set(a, r);
      }
      if (d < r.best) r.best = d;
      if (a._matchCacheHeld) r.held = true;
      const mo = a.objective ? a.objective.mode : 'none';
      r.obj[mo] = (r.obj[mo] ?? 0) + 1;
      r.state = a.state;
    }
    for (const [a, r] of L.open) {
      if (seen.has(a)) continue;
      r.end = r.held ? 'arrived' : !a.alive ? 'died' : e.ctx.time.elapsed > (a._matchCacheUntil ?? 0) ? 'timeout' : 'dropped';
      r.secs = +(t - r.t0).toFixed(1);
      L.done.push(r);
      L.open.delete(a);
    }
  };
});

const t0 = Date.now();
while ((Date.now() - t0) / 1000 < SECONDS) await p.waitForTimeout(2000);

const out = await p.evaluate(() => {
  const L = window.__L__;
  const m = window.__ENGINE__.ctx.peek('match');
  const rows = L.done.concat([...L.open.values()].map((r) => ({ ...r, end: 'open' })));
  const by = {};
  for (const r of rows) by[r.end] = (by[r.end] ?? 0) + 1;
  const miss = rows.filter((r) => r.end !== 'arrived');
  const q = (v, f) => (v.length ? +v.slice().sort((a, c) => a - c)[Math.floor(v.length * f)].toFixed(1) : NaN);
  return {
    legs: rows.length, ends: by,
    startDist: { p50: q(rows.map((r) => r.d0), 0.5), p90: q(rows.map((r) => r.d0), 0.9) },
    closestApproachOfFailures: { p10: q(miss.map((r) => r.best), 0.1), p50: q(miss.map((r) => r.best), 0.5), p90: q(miss.map((r) => r.best), 0.9) },
    secondsHeld: { p50: q(rows.map((r) => r.secs ?? 0), 0.5), p90: q(rows.map((r) => r.secs ?? 0), 0.9) },
    // What objective was actually on the man WHILE he was on a leg. If this is
    // mostly not 'pickup', something is overwriting the order.
    objectiveWhileOnLeg: rows.reduce((acc, r) => { for (const k in r.obj) acc[k] = (acc[k] ?? 0) + r.obj[k]; return acc; }, {}),
    caches: { taken: m.caches.stats.taken, botTakes: m.caches.stats.botTakes, botList: m.caches.botList.length },
    sample: rows.slice(0, 8).map((r) => ({ id: r.id, kind: r.kind, end: r.end, d0: +r.d0.toFixed(1), best: +r.best.toFixed(1), secs: r.secs })),
  };
});
console.log(JSON.stringify(out, null, 1));
if (errs.length) console.log('errors', errs.slice(0, 4));
await b.close();
