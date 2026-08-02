/**
 * EVERY SAMPLE OF EVERY BAKED LEG — x, z, the ground ray, the road envelope,
 * the rise between them and the ambiguous-band SOLID flag. This is how a
 * "blocked by 3.2m of unremovable mass at (19,25)" line stops being one
 * coordinate and becomes the run of samples it really is.
 *
 *   node _legdump.mjs [url] [seed] [tank] [leg]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4423/';
const SEED = process.argv[3] ?? '7';
const WHICH = process.argv[4] ?? '';
const LEG = process.argv[5] ?? '';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await p.evaluate(({ WHICH, LEG }) => {
  const a = window.__ENGINE__.ctx.peek('match').tank;
  const res = [];
  for (const t of a.tanks) {
    if (WHICH && t.id !== WHICH) continue;
    for (const leg of t.legs) {
      const id = leg.zone ?? 'HUB';
      if (LEG && id !== LEG) continue;
      const rows = [];
      for (let i = 0; i < leg.n; i++) {
        rows.push({
          i,
          s: +leg.S[i].toFixed(1),
          x: +leg.X[i].toFixed(1),
          z: +leg.Z[i].toFixed(1),
          y: +leg.Y[i].toFixed(2),
          road: +leg.ROAD[i].toFixed(2),
          rise: +(leg.Y[i] - leg.ROAD[i]).toFixed(2),
          step: +leg.STEP[i].toFixed(2),
          solid: leg.SOLID ? leg.SOLID[i] : '-',
        });
      }
      res.push({ tank: t.id, leg: id, n: leg.n, len: +leg.length.toFixed(1), stop: leg.stop, rows });
    }
  }
  return res;
}, { WHICH, LEG });

for (const r of out) {
  console.log(`\n===== ${r.tank} / ${r.leg} — ${r.n} samples, ${r.len} m — ${r.stop} =====`);
  const bad = r.rows.filter((q) => q.rise > 0.4);
  console.log(`  samples with rise > 0.4 m: ${bad.length}`);
  for (const q of bad) {
    console.log(`   i=${q.i} s=${q.s} at (${q.x}, ${q.z}) y=${q.y} road=${q.road} RISE=${q.rise} step=${q.step} solid=${q.solid}`);
  }
  const tall = r.rows.reduce((m, q) => Math.max(m, q.rise), 0);
  console.log(`  tallest rise on this leg: ${tall.toFixed(2)} m`);
}
await b.close();
