/**
 * THE RESIDUE. `_nfvoid.mjs` comes back with a handful of cells after a long
 * match instead of none; this says which triangle used to be under each of
 * them, which BVH object it belonged to, and which eraser took it — so the
 * remainder is explained rather than tolerated.
 *   node _zzresid.mjs [--url=…] [--run=420] [--scale=8]
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4627/?map=plains';
const RUN = Number(args.run ?? 420);
const SCALE = Number(args.scale ?? 8);
const STEP = Number(args.step ?? 0.4);
const R = Number(args.r ?? 176);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id=' + await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id));
await p.evaluate(() => {
  const sw = window.__ENGINE__.ctx.peek('physics').staticWorld;
  window.__MASK0__ = sw.mask.slice();
});
await p.evaluate((s) => { window.__ENGINE__.ctx.time.scale = s; }, SCALE);
await p.waitForTimeout(Math.ceil((RUN / SCALE) * 1000));
const out = await p.evaluate(({ STEP, R }) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics'); const sw = ph.staticWorld; const CH = ph.MASK.CHARACTER;
  const raw = {};
  const holes = [];
  for (let z = -R; z <= R; z += STEP) for (let x = -R; x <= R; x += STEP) {
    if (x * x + z * z > R * R) continue;
    if (!sw.raycast(x, 140, z, 0, -1, 0, 260, CH, raw)) holes.push([x, z]);
  }
  // Put the map back the way it was and ask what used to be there.
  const now = sw.mask.slice();
  sw.mask.set(window.__MASK0__);
  const byId = new Map(sw.objects.filter((o) => o).map((o) => [o.id, o.mesh?.name ?? '?']));
  const tank = e.ctx.peek('match')?.tank;
  const who = new Map();
  for (const t of tank?.tanks ?? []) for (const q of t.plough ?? []) if (q.fired) for (const tt of q.tris ?? []) who.set(tt, `${t.id} plough`);
  for (const r of tank?._atlas?.fired ?? []) for (const tt of r.tris ?? []) if (!who.has(tt)) who.set(tt, 'raze');
  for (const bx of tank?._blocks?.list ?? []) if (bx.fired) for (const tt of bx.tris ?? []) if (!who.has(tt)) who.set(tt, 'block');
  const tally = new Map();
  const sample = [];
  for (const [x, z] of holes) {
    const hit = sw.raycast(x, 140, z, 0, -1, 0, 260, CH, raw);
    const t = hit ? raw.tri : -1;
    const k = t < 0 ? 'nothing at boot either' : `${who.get(t) ?? '(not erased by tank)'} / ${byId.get(sw.object[t]) ?? '?'}`;
    tally.set(k, (tally.get(k) ?? 0) + 1);
    if (sample.length < 14 && t >= 0) sample.push({ x: +x.toFixed(1), z: +z.toFixed(1), y: +raw.py.toFixed(2), k });
  }
  sw.mask.set(now);
  return { holes: holes.length, tally: [...tally].sort((a, c) => c[1] - a[1]), sample, phase: e.ctx.peek('match')?.phase ?? '?' };
}, { STEP, R });
console.log(`\n  phase=${out.phase}   ${out.holes} sample points with no triangle under them`);
for (const [k, n] of out.tally) console.log(`    ${String(n).padStart(6)}  ${k}`);
console.log('\n  sample (position, and the height of the triangle that used to be there):');
for (const s of out.sample) console.log(`    (${s.x}, ${s.z}) y=${s.y}   ${s.k}`);
console.log(errs.length ? `\n[pageerror] ${errs.length}: ${errs[0]}` : '\n[pageerror] none');
await b.close();
