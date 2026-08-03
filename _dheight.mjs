/**
 * THE SKYLINE ROUND D, IN METRES — a polar height map of the crossing.
 *
 *   node _dheight.mjs --url=http://127.0.0.1:4496/ [--rmax=18]
 *
 * `_dblock.mjs` says which rays die and at what radius. This says WHAT IS
 * THERE: at every 5° of azimuth and every 0.5 m of radius out from D's centre,
 * a ray dropped from 8 m finds the top solid surface, and the number printed is
 * that surface's height above D's own eye datum (the walkable floor at the
 * centre + 1.62 m). Positive means a man standing in the middle of the capture
 * point cannot see over it; negative means he can.
 *
 * Printed as a ring-by-ring table — the tallest thing on each 1 m ring, and the
 * bearings on which the ring breaks the eye.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4496/';
const RMAX = Number(args.rmax ?? 18);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL + (args.seed ? `?seed=${args.seed}` : ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => (window.__ENGINE__.time.scale = 10));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._checkWinConditions = () => {};
  m.roundClock = 1e6;
  m.score[0] = 999;
});
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').sites.some((z)=>z.id==='D')", null, { timeout: 300000 });
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await page.waitForTimeout(1200);

const out = await page.evaluate((RMAX) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ph = e.ctx.peek('physics');
  const g = e.ctx.peek('ai').grid;
  const MASK = ph.MASK.WORLD;
  const z = m.allZones.find((q) => q.id === 'D');
  const C = z.position;
  const ci = g.index(g.cellX(C.x), g.cellZ(C.z));
  const cf = g.flags[ci] ? g.floor[ci] : 0;
  const EYEY = cf + 1.62;
  const rings = [];
  for (let r = 2; r <= RMAX; r += 0.5) {
    let top = -99;
    let topA = 0;
    const over = [];
    for (let a = 0; a < 72; a++) {
      const th = (a / 72) * 6.283185;
      const x = C.x + Math.cos(th) * r;
      const zz = C.z + Math.sin(th) * r;
      const h = ph.raycast(x, cf + 8, zz, 0, -1, 0, 12, MASK);
      const y = h.hit ? h.point.y : cf;
      if (y > top) { top = y; topA = Math.round((th * 180) / Math.PI); }
      if (y > EYEY) over.push(Math.round((th * 180) / Math.PI));
    }
    rings.push({ r, top: +(top - EYEY).toFixed(2), topA, over: over.length, overA: over });
  }
  return { cf: +cf.toFixed(2), EYEY: +EYEY.toFixed(2), rings };
}, RMAX);

console.log(`\n  D centre floor ${out.cf} m, standing eye ${out.EYEY} m`);
console.log('  radius   tallest-over-eye   at°   bearings over the eye (of 72)');
for (const r of out.rings) {
  const bar = r.top > 0 ? '#'.repeat(Math.min(30, Math.round(r.top * 20))) : '';
  console.log(
    `   ${String(r.r).padStart(5)}m  ${String(r.top).padStart(7)}m  ${String(r.topA).padStart(4)}°  ` +
      `${String(r.over).padStart(3)}  ${bar}`
  );
}
console.log('\n  pageErrors', errs.length ? errs.slice(0, 4) : 'none');
await browser.close();
