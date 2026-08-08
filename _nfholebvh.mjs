/**
 * ════════════════════════════════════════════════════════════════════════════
 * IS THERE GROUND EVERYWHERE — ASKED OF THE WORLD THE PLAYER ACTUALLY FALLS
 * THROUGH, WHICH IS THE TRIANGLE BVH AND NOTHING ELSE.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfholebvh.mjs [--url=…] [--step=1] [--r=170]
 *
 * 「あとたまに穴があって次元のはざまに落とされるぞ」
 *
 * `_nfhole.mjs` fires `physics.raycast(…, MASK.WORLD)` and reports 0 holes on
 * this build. That is a true statement about a DIFFERENT WORLD from the one the
 * character moves in, and the difference is the whole reason "たまに" —
 * sometimes:
 *
 *   `Physics.raycast` tries the BVH, then `_raycastColliders`, then
 *   `_raycastBodies` (src/physics/index.js:497-511). It hits proxy boxes.
 *   `CharacterController` is constructed on `this.staticWorld` alone
 *   (src/physics/index.js:744) and moves with `sweepCapsule` / `overlapCapsule`,
 *   which consult NO COLLIDER LIST.
 *
 * So an `A.box(...)` proxy over a gap in the terrain mesh answers the ray and
 * holds up NOBODY. A hole in the BVH is a hole in the world even where a proxy
 * exists, and a probe built on `physics.raycast` cannot see it. This fires the
 * same lattice against `physics.staticWorld.raycast` directly.
 *
 * It also reports, separately, cells where the two DISAGREE — BVH says nothing,
 * the full raycast says something. Those are the dangerous ones: they look
 * solid to every other tool on the map and to the nav grid's ray, and they are
 * air to a man's feet. A pass is zero of both.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4625/?map=plains';
const STEP = Number(args.step ?? 1);
const R = Number(args.r ?? 170);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level.id=${level}   url=${URL}`);

const out = await p.evaluate(([STEP, R]) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const sw = ph.staticWorld;
  const MASK = ph.MASK.WORLD;
  const gy = e.ctx.peek('world').level?.groundY ?? (() => 0);
  const holes = [];        // nothing in the BVH at all
  const proxyOnly = [];    // nothing in the BVH, but the full raycast finds mass
  const o = {};
  let cells = 0;
  for (let z = -R; z <= R; z += STEP) {
    for (let x = -R; x <= R; x += STEP) {
      if (x * x + z * z > R * R) continue;
      cells++;
      // from over the tallest thing on the plain, down past the deepest cut
      if (sw.raycast(x, 120, z, 0, -1, 0, 200, MASK, o)) continue;
      const full = ph.raycast(x, 120, z, 0, -1, 0, 200, MASK);
      (full.hit ? proxyOnly : holes).push([x, z, +gy(x, z).toFixed(1), full.hit ? +full.point.y.toFixed(1) : null]);
    }
  }
  return { cells, holes, proxyOnly };
}, [STEP, R]);

/** Cluster the misses, so sixty-six trench mouths read as sixty-six lines. */
const cluster = (list) => {
  const seen = new Set(list.map(([x, z]) => `${x},${z}`));
  const by = new Map(list.map((c) => [`${c[0]},${c[1]}`, c]));
  const cl = [];
  for (const [x, z] of list) {
    const k = `${x},${z}`;
    if (!seen.has(k)) continue;
    const q = [[x, z]]; seen.delete(k);
    const cells = [];
    while (q.length) {
      const [cx, cz] = q.pop(); cells.push(by.get(`${cx},${cz}`));
      for (let dz = -STEP; dz <= STEP; dz += STEP) for (let dx = -STEP; dx <= STEP; dx += STEP) {
        const kk = `${cx + dx},${cz + dz}`;
        if (seen.has(kk)) { seen.delete(kk); q.push([cx + dx, cz + dz]); }
      }
    }
    const mx = cells.reduce((a, c) => a + c[0], 0) / cells.length;
    const mz = cells.reduce((a, c) => a + c[1], 0) / cells.length;
    const x0 = Math.min(...cells.map((c) => c[0])), x1 = Math.max(...cells.map((c) => c[0]));
    const z0 = Math.min(...cells.map((c) => c[1])), z1 = Math.max(...cells.map((c) => c[1]));
    cl.push({ n: cells.length, x: +mx.toFixed(0), z: +mz.toFixed(0), x0, x1, z0, z1, sample: cells[0] });
  }
  cl.sort((a, c) => c.n - a.n);
  return cl;
};

const hc = cluster(out.holes);
const pc = cluster(out.proxyOnly);
console.log(`\n  ${out.cells} lattice cells swept inside r ${R} at ${STEP} m`);
console.log(`\n  NO TRIANGLE UNDER THEM AT ALL — a man walking here falls out of the map:`);
console.log(`  ${out.holes.length} cells in ${hc.length} clusters`);
for (const c of hc.slice(0, 30)) {
  console.log(`    ${String(c.n).padStart(5)} cells around (${c.x}, ${c.z})   x ${c.x0}..${c.x1}  z ${c.z0}..${c.z1}   plain ${c.sample[2]}`);
}
if (hc.length > 30) console.log(`    …and ${hc.length - 30} more`);
console.log(`\n  BVH EMPTY BUT A PROXY ANSWERS — solid to every ray on the map, air to his feet:`);
console.log(`  ${out.proxyOnly.length} cells in ${pc.length} clusters`);
for (const c of pc.slice(0, 30)) {
  console.log(`    ${String(c.n).padStart(5)} cells around (${c.x}, ${c.z})   x ${c.x0}..${c.x1}  z ${c.z0}..${c.z1}   plain ${c.sample[2]}, proxy top ${c.sample[3]}`);
}
if (pc.length > 30) console.log(`    …and ${pc.length - 30} more`);
console.log(errs.length ? `\n[pageerror] ${errs.length}: ${errs[0]}` : '\n[pageerror] none');
await b.close();
process.exit(out.holes.length || out.proxyOnly.length ? 1 : 0);
