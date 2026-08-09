/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHERE IS THE PLAIN STILL EMPTY? — the openness field, not the route and not
 * the point
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfopenfield.mjs [--url=…] [--cell=12] [--r=168] [--json=path]
 *
 * `_plaincross.mjs` measures TWELVE LINES. `_nfobj360.mjs` measures SEVEN
 * POINTS. Between them is 90 000 m² of ground that neither looks at, and
 * 「障害物が少ない」 said three times is a statement about the ground, not about
 * the routes on it — the last pass moved the mean route lane from 115.4 m to
 * 62.4 m and he still said it.
 *
 * So this stands a man on a lattice over the whole walkable disc and turns him
 * round: 36 rays at 10° from a standing eye at each cell that `world.isOpen`
 * accepts, and the same vocabulary `_nfobj360.mjs` uses —
 *
 *   mean      metres to the first occluder, averaged over the 36
 *   naked     share of bearings with nothing inside 120 m
 *   worstArc  widest contiguous naked wedge, in degrees
 *
 * The output that matters is not the headline mean; it is the QUARTER TABLE and
 * the worst cells, because the failure this is looking for is regional. A map
 * whose mean is 60 m and whose north-west quadrant is 140 m is a map with a
 * hole in it, and averaging hides exactly that.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4635/?map=plains';
const CELL = Number(args.cell ?? 12);
const R = Number(args.r ?? 168);

const b = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level.id=${level}  cell=${CELL} m  r=${R} m`);
if (level !== 'plains') { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

const res = await page.evaluate(([CELL, R]) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const w = e.ctx.peek('world');
  const MASK = ph.MASK.WORLD;
  const EYE = 1.62, N = 36, FAR = 400, NAKED = 120, NEAR = 12;
  const cells = [];
  for (let z = -R; z <= R; z += CELL) {
    for (let x = -R; x <= R; x += CELL) {
      if (Math.hypot(x, z) > R) continue;
      if (!w.isOpen(x, z, 0.6)) continue;
      const y = w.groundHeight(x, z) + EYE;
      const open = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const h = ph.raycast(x, y, z, Math.sin(a), 0, Math.cos(a), FAR, MASK);
        open.push(h.hit ? h.distance : FAR);
      }
      const naked = open.map((v) => v >= NAKED);
      let worst = 0;
      if (naked.every(Boolean)) worst = N;
      else { let run = 0; for (let i = 0; i < N * 2; i++) { if (naked[i % N]) { run++; if (run > worst) worst = run; } else run = 0; } }
      cells.push({
        x, z,
        mean: +(open.reduce((p, q) => p + q, 0) / N).toFixed(1),
        naked: +(naked.filter(Boolean).length / N).toFixed(3),
        near: open.some((v) => v < NEAR) ? 1 : 0,
        arc: Math.min(worst, N) * (360 / N),
      });
    }
  }
  return cells;
}, [CELL, R]);

const n = res.length;
const avg = (k) => +(res.reduce((p, c) => p + c[k], 0) / n).toFixed(1);
console.log(`\ncells ${n}`);
console.log(`mean sightline   ${avg('mean')} m`);
console.log(`naked bearings   ${(avg('naked') * 100).toFixed(1)} %   (nothing inside 120 m)`);
console.log(`cover within 12m ${(res.filter((c) => c.near).length / n * 100).toFixed(1)} % of cells`);
console.log(`mean worst arc   ${avg('arc')}°`);
console.log(`cells with a naked arc >= 180°  ${(res.filter((c) => c.arc >= 180).length / n * 100).toFixed(1)} %`);
console.log(`cells with mean sightline > 120 m ${(res.filter((c) => c.mean > 120).length / n * 100).toFixed(1)} %`);

/** THE QUARTERS. The failure this is written for is regional, not average. */
const Q = { NW: [], NE: [], SW: [], SE: [] };
for (const c of res) Q[(c.z < 0 ? 'N' : 'S') + (c.x < 0 ? 'W' : 'E')].push(c);
console.log('\nquarter  cells   mean    naked%   arc°');
for (const k of ['NW', 'NE', 'SW', 'SE']) {
  const q = Q[k]; if (!q.length) continue;
  const m = (f) => +(q.reduce((p, c) => p + f(c), 0) / q.length).toFixed(1);
  console.log(`${k.padEnd(8)} ${String(q.length).padStart(5)} ${String(m((c) => c.mean)).padStart(6)} ` +
    `${String((m((c) => c.naked) * 100).toFixed(1)).padStart(8)} ${String(m((c) => c.arc)).padStart(6)}`);
}

console.log('\nthe twelve worst cells (by mean sightline):');
for (const c of res.slice().sort((a, d) => d.mean - a.mean).slice(0, 12)) {
  console.log(`  ${String(c.x).padStart(5)},${String(c.z).padStart(5)}   mean ${String(c.mean).padStart(6)} m  naked ${(c.naked * 100).toFixed(0)}%  arc ${c.arc}°`);
}
if (args.json) writeFileSync(args.json, JSON.stringify(res));
if (errs.length) console.log('PAGE ERRORS', errs.length, errs.slice(0, 3));
await b.close();
