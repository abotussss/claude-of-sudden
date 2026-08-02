/**
 * WHAT DID `StairMap` ACTUALLY FIND? — one boot, no match.
 * Usage: node _sixpost.mjs --seed=7
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4450/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${URL}?seed=${+(args.seed ?? 7)}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const r = await p.evaluate(() => {
  const ai = window.__ENGINE__.ctx.peek('ai'), g = ai.grid, s = ai.stairs;
  const path = [];
  const V = ai.root.position.constructor;
  const from = new V(), to = new V();
  const m = window.__ENGINE__.ctx.peek('match');
  const spawns = [...(m.spawns?.attack ?? []), ...(m.spawns?.defend ?? [])];
  return {
    ms: +s.ms.toFixed(1), columns: s.columns, posts: s.posts.length, diag: s.diag,
    detail: s.posts.map((q) => {
      let ok = 0;
      to.copy(q.route[0]);
      for (const sp of spawns) { from.copy(sp.position); if (g.findPath(from, to, path) > 0) ok++; }
      return {
        b: q.building, top: +q.top.toFixed(2), waypoints: q.route.length,
        rise: +(q.top - q.route[0].y).toFixed(2),
        foot: q.route.map((w) => [+w.x.toFixed(1), +w.y.toFixed(2), +w.z.toFixed(1)]),
        stands: q.stand.map((w) => [+w.x.toFixed(1), +w.y.toFixed(2), +w.z.toFixed(1)]),
        spawnsThatCanRouteToFoot: `${ok}/${spawns.length}`,
      };
    }),
  };
});
console.log(JSON.stringify(r, null, 1));
if (errs.length) console.log('pageerrors', errs.slice(0, 5));
await b.close();
