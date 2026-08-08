/**
 * ════════════════════════════════════════════════════════════════════════════
 * 「たまに穴があって次元のはざまに落とされる」 — the hole a MAN falls through
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfvoid.mjs [--url=http://127.0.0.1:4624/?map=plains] [--step=0.4]
 *                    [--run=0] [--scale=8]
 *
 * `_nfhole.mjs` already sweeps this map and reports zero, and it is not wrong —
 * it is answering a slightly different question, in three ways that each let a
 * hole through:
 *
 *  1. IT SAMPLES AT 1 m. A gap 0.7 m across passes clean between two of its
 *     rays and is still wider than the 0.64 m player capsule. So this sweeps at
 *     `--step` 0.4 by default.
 *  2. IT ASKS `physics.raycast`, WHICH CONSULTS THE COLLIDER LIST. The character
 *     controller does not: `CharacterController` holds `physics.staticWorld` and
 *     calls `sweepCapsule`/`overlapCapsule` on the triangle BVH alone. A patch of
 *     ground that exists only as a dynamic collider is floor to that probe and
 *     air to the player. So this asks `staticWorld.raycast` DIRECTLY, under
 *     `MASK.CHARACTER` — the controller's own mask, which is what it collides
 *     with and nothing else.
 *  3. IT RUNS AT t = 0. 「たまに」 is a word about time. Demolition takes blocks
 *     down and the armour ploughs prop cells during the match, and both call
 *     `StaticWorld.removeObject`, so a hole that opens at t = 300 is invisible to
 *     every boot-time gate on this tree. `--run=N` plays N match seconds at
 *     `--scale` and sweeps AGAIN, reporting only what is newly missing.
 *
 * A pass is zero cells in both sweeps. Anything else is printed with its
 * coordinates, its cluster, its extent and what the WORLD ray says about it —
 * because "the BVH has nothing there but a collider does" and "there is genuinely
 * nothing there" are different bugs with different owners.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4624/?map=plains';
const STEP = Number(args.step ?? 0.4);
const RUN = Number(args.run ?? 0);
const SCALE = Number(args.scale ?? 8);
const R = Number(args.r ?? 176);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level.id=${level}  step=${STEP} m  radius=${R} m`);

const SWEEP = ({ STEP, R }) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const sw = ph.staticWorld;
  const MASK = ph.MASK.CHARACTER;
  const raw = {};
  const holes = [];
  let n = 0;
  for (let z = -R; z <= R; z += STEP) {
    for (let x = -R; x <= R; x += STEP) {
      if (x * x + z * z > R * R) continue;
      n++;
      if (!sw.raycast(x, 140, z, 0, -1, 0, 260, MASK, raw)) holes.push([+x.toFixed(2), +z.toFixed(2)]);
    }
  }
  return { holes, n };
};

const a0 = await p.evaluate(SWEEP, { STEP, R });
report('AT BOOT', a0, STEP);

let a1 = null;
if (RUN > 0) {
  await p.evaluate((s) => { window.__ENGINE__.ctx.time.scale = s; }, SCALE);
  const wall = Math.ceil((RUN / SCALE) * 1000);
  console.log(`\n  …playing ${RUN} match seconds at x${SCALE} (${(wall / 1000).toFixed(0)} s of wall clock)`);
  await p.waitForTimeout(wall);
  const phase = await p.evaluate(() => window.__ENGINE__.ctx.peek('match')?.phase ?? '?');
  a1 = await p.evaluate(SWEEP, { STEP, R });
  console.log(`  match phase=${phase}`);
  const was = new Set(a0.holes.map((h) => h.join(',')));
  const fresh = { holes: a1.holes.filter((h) => !was.has(h.join(','))), n: a1.n };
  report(`AFTER ${RUN} s — NEWLY missing`, fresh, STEP);
}

/** Is it a hole in the BVH only, or in everything? — different owners. */
const all = [...a0.holes, ...(a1?.holes ?? [])];
if (all.length) {
  const probe = await p.evaluate((pts) => {
    const ph = window.__ENGINE__.ctx.peek('physics');
    return pts.slice(0, 20).map(([x, z]) => {
      const w = ph.raycast(x, 140, z, 0, -1, 0, 260, ph.MASK.WORLD);
      return { x, z, world: w.hit ? +w.point.y.toFixed(2) : null };
    });
  }, all);
  console.log('\n  the same points under physics.raycast (colliders included):');
  for (const q of probe) console.log(`    (${q.x}, ${q.z})  ${q.world === null ? 'ALSO NOTHING' : `collider floor at y=${q.world}`}`);
}

function report(what, res, step) {
  const seen = new Set(res.holes.map(([x, z]) => `${x},${z}`));
  const key = (x, z) => `${+x.toFixed(2)},${+z.toFixed(2)}`;
  const clusters = [];
  for (const [x, z] of res.holes) {
    if (!seen.has(key(x, z))) continue;
    const q = [[x, z]]; seen.delete(key(x, z));
    const cells = [];
    while (q.length) {
      const [cx, cz] = q.pop(); cells.push([cx, cz]);
      for (let dz = -step; dz <= step * 1.5; dz += step) {
        for (let dx = -step; dx <= step * 1.5; dx += step) {
          const k = key(cx + dx, cz + dz);
          if (seen.has(k)) { seen.delete(k); q.push([+(cx + dx).toFixed(2), +(cz + dz).toFixed(2)]); }
        }
      }
    }
    const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]);
    clusters.push({
      n: cells.length,
      x: +(xs.reduce((a, v) => a + v, 0) / cells.length).toFixed(1),
      z: +(zs.reduce((a, v) => a + v, 0) / cells.length).toFixed(1),
      w: +(Math.max(...xs) - Math.min(...xs) + step).toFixed(1),
      d: +(Math.max(...zs) - Math.min(...zs) + step).toFixed(1),
    });
  }
  clusters.sort((a, c) => c.n - a.n);
  console.log(`\n  ${what}: ${res.holes.length} of ${res.n} sampled points have NO BVH TRIANGLE under them, in ${clusters.length} clusters`);
  for (const c of clusters.slice(0, 30)) {
    const through = c.w > 0.64 && c.d > 0.64;
    console.log(`    ${String(c.n).padStart(6)} pts at (${c.x}, ${c.z})  ${c.w} x ${c.d} m  r=${Math.hypot(c.x, c.z).toFixed(0)}${through ? '   <-- WIDER THAN THE 0.64 m CAPSULE' : ''}`);
  }
  if (clusters.length > 30) console.log(`    …and ${clusters.length - 30} more`);
}

console.log(errs.length ? `\n[pageerror] ${errs.length}: ${errs[0]}` : '\n[pageerror] none');
await b.close();
