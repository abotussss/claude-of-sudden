/**
 * HOW BIG IS THE RUBBLE? — 「瓦礫がデカすぎる、小さくしろ」
 *
 *   BASE=http://127.0.0.1:4626/ node _tzchunks.mjs
 *
 * The chunk a player sees is the drawn instance, so this measures the drawn
 * instance: the SETTLED matrix of every chunk of every demolition site, decomposed
 * to its scale, reported as the longest edge. Not the `cut` table — the thing on
 * the ground.
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4626/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${BASE}?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const air = e.ctx.peek('match')?.airstrike;
  const sites = air?.sites ?? [];
  const rows = [];
  for (const s of sites) {
    const edges = [];
    let n = 0;
    for (const mesh of s.meshes) {
      const m = mesh.instanceMatrix.array;
      const cnt = mesh.count;
      n += cnt;
      for (let i = 0; i < cnt; i++) {
        // column lengths of the 3x3 are the world-space edge lengths
        const o = i * 16;
        const sx = Math.hypot(m[o], m[o + 1], m[o + 2]);
        const sy = Math.hypot(m[o + 4], m[o + 5], m[o + 6]);
        const sz = Math.hypot(m[o + 8], m[o + 9], m[o + 10]);
        edges.push(Math.max(sx, sy, sz));
      }
    }
    edges.sort((a, c) => a - c);
    const q = (p) => +edges[Math.min(edges.length - 1, Math.floor(edges.length * p))].toFixed(2);
    rows.push({
      id: s.id, chunks: n,
      moundR: +(s.moundR ?? 0).toFixed(2),
      longestEdge: { min: q(0), p25: q(0.25), median: q(0.5), p75: q(0.75), p95: q(0.95), max: q(0.999) },
      over1_5: edges.filter((x) => x > 1.5).length,
      over2_0: edges.filter((x) => x > 2.0).length,
    });
  }
  return { level: e.ctx.peek('world').level.id, rows };
});
console.log(JSON.stringify(out, null, 1));
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
