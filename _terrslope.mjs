/**
 * HOW STEEP IS THE GROUND, MEASURED — the budget every terrain edit is written
 * inside, taken off the analytic height field rather than off arithmetic.
 *
 *   node _terrslope.mjs [--url=http://127.0.0.1:4611/] [--cell=0.8]
 *
 * `plains.js` states that every term in `swell` was chosen against its own
 * gradient and that they sum, worst case, to 0.37 — "a 20° hillside at the very
 * worst point on the map". That is a WORST-CASE SUM of amplitudes times angular
 * frequencies. It is an upper bound on a bound, it was computed by hand, and the
 * moment a term is added to the height field it stops being either.
 *
 * The two limits it has to clear are not the same number and both are in
 * `src/ai/nav.js`:
 *
 *   maxStep   0.45 m between neighbouring cells, and the cell is 0.8 m. This is
 *             the BINDING one — it is a gradient of 0.5625, or 29.4°, and it
 *             bites long before the slope test does.
 *   maxSlope  46°, tan 1.036.
 *
 * The player's own limit is 48° (`movement.js:155`), so anything the bots can
 * cross he can too.
 *
 * Sampled on the nav grid's own 0.8 m lattice, reported per RING, because the
 * plain and the mountain are under completely different constraints: the plain
 * has to stay under 0.45 m of step everywhere or the AI loses ground, and the
 * mountain has to stay OVER it or the boundary opens.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4611/';
const CELL = Number(args.cell ?? 0.8);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${BASE}?capture=1&map=plains`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

const out = await p.evaluate(({ CELL }) => {
  const w = window.__ENGINE__.ctx.peek('world');
  const gy = w.level.groundY;
  const HB = 200;
  const N = Math.floor((HB * 2) / CELL);
  const bands = [
    { id: 'plain r<170', lo: 0, hi: 170 },
    { id: 'apron 170-176', lo: 170, hi: 176 },
    { id: 'rim 176-186', lo: 176, hi: 186 },
    { id: 'face 186-214', lo: 186, hi: 214 },
    { id: 'past crest >214', lo: 214, hi: 1e9 },
  ].map((x) => ({ ...x, n: 0, over45: 0, maxStep: 0, maxAt: null, sumStep: 0, minY: 1e9, maxY: -1e9 }));

  // one row of heights at a time; two rows live at once
  let prev = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) prev[i] = gy(-HB + i * CELL, -HB);
  let cur = new Float32Array(N + 1);
  for (let j = 1; j <= N; j++) {
    const z = -HB + j * CELL;
    for (let i = 0; i <= N; i++) cur[i] = gy(-HB + i * CELL, z);
    for (let i = 1; i <= N; i++) {
      const x = -HB + i * CELL;
      const r = Math.hypot(x, z);
      const band = bands.find((bb) => r >= bb.lo && r < bb.hi);
      if (!band) continue;
      const d = Math.max(Math.abs(cur[i] - cur[i - 1]), Math.abs(cur[i] - prev[i]));
      band.n++;
      band.sumStep += d;
      if (d > 0.45) band.over45++;
      if (d > band.maxStep) { band.maxStep = d; band.maxAt = [+x.toFixed(1), +z.toFixed(1)]; }
      if (cur[i] < band.minY) band.minY = cur[i];
      if (cur[i] > band.maxY) band.maxY = cur[i];
    }
    const t = prev; prev = cur; cur = t;
  }
  return bands.map((bb) => ({
    id: bb.id, cells: bb.n,
    maxStep: +bb.maxStep.toFixed(3),
    maxDeg: +(Math.atan(bb.maxStep / CELL) * 180 / Math.PI).toFixed(1),
    meanStep: +(bb.sumStep / Math.max(1, bb.n)).toFixed(3),
    over45: bb.over45,
    pctOver: +(100 * bb.over45 / Math.max(1, bb.n)).toFixed(2),
    at: bb.maxAt,
    yRange: [+bb.minY.toFixed(1), +bb.maxY.toFixed(1)],
  }));
}, { CELL });

console.log(`\n  step measured over ${CELL} m — nav maxStep is 0.45 m (29.4°), nav maxSlope 46°\n`);
console.log('  band                cells    maxStep   maxDeg   meanStep   cells>0.45   %      worst point        y range');
for (const r of out) {
  console.log(`  ${r.id.padEnd(18)} ${String(r.cells).padStart(7)}   ${String(r.maxStep).padStart(6)}   ${String(r.maxDeg).padStart(5)}°   ${String(r.meanStep).padStart(6)}   ${String(r.over45).padStart(9)}   ${String(r.pctOver).padStart(5)}  ${String(r.at).padEnd(16)}  ${JSON.stringify(r.yRange)}`);
}
const plain = out[0];
console.log(`\n  ${plain.over45 === 0 ? 'PASS' : 'FAIL'} — open plain (r<170) worst step ${plain.maxStep} m vs the 0.45 m limit`);
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
process.exit(plain.over45 === 0 ? 0 : 1);
