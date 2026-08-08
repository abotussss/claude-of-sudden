/**
 * THE BELT — every standable surface in the annulus against the rim, all the way
 * round, so "which zones have the same fault" is measured instead of assumed.
 *
 * For each of NB bearings it reports the outermost BUILT surface (a material the
 * terrain is not, or terrain-tagged mass standing clear of the analytic ground),
 * its height, and the rim crest height beside it. A built top within
 * `MOVE.mantle.maxHeight` of the crest is a way out of the map.
 *
 *   node _nfbelt.mjs http://127.0.0.1:4617/?map=plains
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4617/?map=plains';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 480 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const out = await p.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world'), phys = c.peek('physics');
  const V = c.camera.position.constructor;
  const MASK = phys.MASK.CHARACTER;
  const R = 0.32, H = 1.78, STEP = 0.42, MANTLE = 1.85;
  const _a = new V(), _b = new V(), _wp = new V();
  const gY = (x, z) => w.level.groundY(x, z);

  const column = (lx, lz) => {
    const list = [];
    w.levelToWorld(lx, 0, lz, _wp);
    const top = gY(lx, lz) + 34, floor = gY(lx, lz) - 9;
    let from = top;
    for (let s = 0; s < 4; s++) {
      const hit = phys.raycast(_wp.x, from, _wp.z, 0, -1, 0, from - floor + 1.8, MASK);
      if (!hit.hit) break;
      const fy = hit.point.y;
      if (fy < floor) break;
      from = fy - 0.06;
      if (hit.normal && hit.normal.y < 0.5) continue;
      _a.set(_wp.x, fy + STEP + R, _wp.z);
      _b.set(_wp.x, fy + H - R + 0.02, _wp.z);
      if (!phys.checkCapsule(_a, _b, R - 0.005, MASK)) continue;
      list.push({ y: fy, s: hit.surface });
      if (from < floor) break;
    }
    return list;
  };

  /** The rim's own reckoning: `plains-rim.js` takes RISE 5.6 over the HIGHEST
   *  ground in a nine-sample window at r 175 / 176.8 / 178.4. */
  const crestAt = (a) => {
    let base = -Infinity;
    const STEPA = 3.62 / 178.31;
    for (let u = -1; u <= 1; u++) {
      const aa = a + u * STEPA * 0.5;
      for (const rr of [175.0, 176.8, 178.4]) {
        const y = gY(Math.cos(aa) * rr, Math.sin(aa) * rr);
        if (y > base) base = y;
      }
    }
    return base + 5.6;
  };

  const NB = 720;
  const rows = [];
  for (let i = 0; i < NB; i++) {
    const a = (i / NB) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const crest = crestAt(a);
    let outer = null, best = null;
    for (let r = 168; r <= 184.4; r += 0.8) {
      const x = ca * r, z = sa * r;
      const g = gY(x, z);
      for (const n of column(x, z)) {
        // BUILT = standing clear of the analytic terrain. The whole plain is one
        // `dirt` mesh, so material cannot separate them; height over `groundY`
        // can, and the rim's own clip crest is caught by the same test.
        if (n.y - g < 0.5) continue;
        /** The rim's OWN clip crest is built mass by this test and is not the
         *  question; it lives in the 0.62 m band at r 178.0-178.6 at exactly
         *  `crest`. Everything else in the belt is somebody's structure. */
        if (r > 177.5 && r < 179.1 && Math.abs(n.y - crest) < 0.6) continue;
        if (r > 179.1 && (!outer || r > outer.r)) outer = { r: +r.toFixed(1), y: +n.y.toFixed(2), s: n.s, g: +g.toFixed(2) };
        const gap = crest - n.y;
        if (r > 172 && r < 177.5 && gap > -0.5 && (!best || gap < best.gap)) {
          best = { r: +r.toFixed(1), y: +n.y.toFixed(2), s: n.s, gap: +gap.toFixed(2) };
        }
      }
    }
    rows.push({ deg: +(a * 180 / Math.PI).toFixed(1), crest: +crest.toFixed(2), outer, best });
  }
  const risky = rows.filter((q) => q.best && q.best.gap <= MANTLE + 0.4 && q.best.y - 0 > -99);
  const past = rows.filter((q) => q.outer);
  return { rows, risky, past: past.map((q) => ({ deg: q.deg, ...q.outer })) };
});

console.log(`\n  BUILT MASS OUTSIDE THE RIM WALL (r > 179.1) — ${out.past.length}/720 bearings`);
console.log('    deg      r       y   groundY   surface');
let last = null;
for (const q of out.past) {
  if (last !== null && q.deg - last < 2.0) { last = q.deg; continue; }
  last = q.deg;
  console.log(`  ${String(q.deg).padStart(6)} ${String(q.r).padStart(6)} ${String(q.y).padStart(7)} ${String(q.g).padStart(8)}   ${q.s}`);
}

console.log(`\n  WITHIN MANTLE OF THE RIM CREST — ${out.risky.length}/720 bearings (gap <= 2.25 m)`);
console.log('    deg    crest      r       y     gap   surface');
last = null;
for (const q of out.risky) {
  if (last !== null && q.deg - last < 1.0) { last = q.deg; continue; }
  last = q.deg;
  console.log(`  ${String(q.deg).padStart(6)} ${String(q.crest).padStart(8)} ${String(q.best.r).padStart(6)} ${String(q.best.y).padStart(7)} ${String(q.best.gap).padStart(7)}   ${q.best.s}`);
}
console.log('\npageerrors', errs.length, errs[0] ?? '');
await b.close();
