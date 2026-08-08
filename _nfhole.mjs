/**
 * ════════════════════════════════════════════════════════════════════════════
 * IS THERE GROUND EVERYWHERE THERE IS SUPPOSED TO BE GROUND?
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfhole.mjs [--url=http://127.0.0.1:4608/?map=plains] [--step=1]
 *
 * `plains.js` DELETES terrain triangles wherever `plains-trench.inCorridor`
 * says a trench is, and `plains-trench.stripMesh` is supposed to lay the cut
 * back in over the hole that leaves. If those two disagree by so much as a
 * metre, the result is a piece of the world with NOTHING UNDER IT — and
 * nothing in the boot log says so, because an absent triangle throws no error.
 *
 * WHAT IT COST THE FIRST TIME. The network's `inCorridor` became a CAPSULE
 * around the sampled bay axis, which reaches `CUT_R` past each bay's last
 * sample, while the strip mesh still stopped dead at that sample. Sixty-six
 * bay mouths, sixty-six 5.6 m holes — and the armour found them before any
 * human did: eleven tank spokes dropped with `no ground at sample N`, RED-C
 * losing its whole wheel because its hub at (-32,-88) stood in one.
 * `Armour._bakePath` ends a leg the instant `physics.groundHeight` comes back
 * non-finite, which is exactly the right behaviour and is completely silent.
 *
 * So this fires one downward ray per lattice cell over the walkable disc and
 * reports every cell with no ground under it, clustered, with the nearest
 * trench named. A pass is ZERO cells.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4608/?map=plains';
const STEP = Number(args.step ?? 1);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level.id=${level}`);
if (level !== 'plains') { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

const out = await p.evaluate((STEP) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const MASK = ph.MASK.WORLD;
  const R = 170;
  const holes = [];
  for (let z = -R; z <= R; z += STEP) {
    for (let x = -R; x <= R; x += STEP) {
      if (x * x + z * z > R * R) continue;
      // from well over the tallest thing on the plain, down past the deepest cut
      const h = ph.raycast(x, 120, z, 0, -1, 0, 200, MASK);
      if (!h.hit) holes.push([x, z]);
    }
  }
  return { holes, n: holes.length };
}, STEP);

/** Cluster the misses, so sixty-six mouths read as sixty-six lines. */
const seen = new Set(out.holes.map(([x, z]) => `${x},${z}`));
const clusters = [];
for (const [x, z] of out.holes) {
  const k = `${x},${z}`;
  if (!seen.has(k)) continue;
  const q = [[x, z]]; seen.delete(k);
  const cells = [];
  while (q.length) {
    const [cx, cz] = q.pop(); cells.push([cx, cz]);
    for (let dz = -STEP; dz <= STEP; dz += STEP) for (let dx = -STEP; dx <= STEP; dx += STEP) {
      const kk = `${cx + dx},${cz + dz}`;
      if (seen.has(kk)) { seen.delete(kk); q.push([cx + dx, cz + dz]); }
    }
  }
  const mx = cells.reduce((a, c) => a + c[0], 0) / cells.length;
  const mz = cells.reduce((a, c) => a + c[1], 0) / cells.length;
  clusters.push({ n: cells.length, x: +mx.toFixed(0), z: +mz.toFixed(0) });
}
clusters.sort((a, c) => c.n - a.n);
console.log(`\n  ${out.n} lattice cells with NO GROUND UNDER THEM, in ${clusters.length} clusters (step ${STEP} m)`);
for (const c of clusters.slice(0, 25)) console.log(`    ${String(c.n).padStart(5)} cells around (${c.x}, ${c.z})`);
if (clusters.length > 25) console.log(`    …and ${clusters.length - 25} more`);
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs[0]}` : '[pageerror] none');
await b.close();
process.exit(out.n ? 1 : 0);
