/**
 * WHAT WAS HOLDING THE RESIDUE UP? For the handful of cells `_nfvoid.mjs` still
 * finds after a long match, this reports the triangle that used to be there,
 * the triangle the FLOOR TEST found underneath it (which is why it was bindable
 * at all), how far below that support was, and whether the support was itself
 * erased. That distinguishes "the support was another layer of the same sheet"
 * from "the support was a second erasable thing", which are different fixes.
 *   node _zzsupport.mjs [--url=…] [--run=420]
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
  const pos = sw.pos; const raw = {};
  const holes = [];
  for (let z = -R; z <= R; z += STEP) for (let x = -R; x <= R; x += STEP) {
    if (x * x + z * z > R * R) continue;
    if (!sw.raycast(x, 140, z, 0, -1, 0, 260, CH, raw)) holes.push([x, z]);
  }
  const now = sw.mask.slice();
  sw.mask.set(window.__MASK0__);
  const byId = new Map(sw.objects.filter((o) => o).map((o) => [o.id, o.mesh?.name ?? '?']));
  const tank = e.ctx.peek('match')?.tank;
  const who = new Map();
  for (const t of tank?.tanks ?? []) for (const q of t.plough ?? []) if (q.fired) for (const tt of q.tris ?? []) who.set(tt, `${t.id} plough`);
  for (const r of tank?._atlas?.fired ?? []) for (const tt of r.tris ?? []) if (!who.has(tt)) who.set(tt, 'raze');
  for (const bx of tank?._blocks?.list ?? []) if (bx.fired) for (const tt of bx.tris ?? []) if (!who.has(tt)) who.set(tt, 'block');
  const rows = new Map();
  for (const [x, z] of holes) {
    if (!sw.raycast(x, 140, z, 0, -1, 0, 260, CH, raw)) continue;
    const t = raw.tri;
    const o = t * 9;
    const lo = Math.min(pos[o + 1], pos[o + 4], pos[o + 7]);
    const cx = (pos[o] + pos[o + 3] + pos[o + 6]) / 3;
    const cz = (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3;
    let sup = 'NOTHING', gap = null, supWho = '-';
    if (sw.raycast(cx, lo - 0.05, cz, 0, -1, 0, 300, CH, raw)) {
      sup = byId.get(sw.object[raw.tri]) ?? '?';
      gap = +(lo - raw.py).toFixed(2);
      supWho = who.get(raw.tri) ?? '(kept)';
    }
    const k = `${who.get(t) ?? '(not erased)'} / ${byId.get(sw.object[t]) ?? '?'}  ->  support ${sup} ${gap} m below, ${supWho}`;
    rows.set(k, (rows.get(k) ?? 0) + 1);
  }
  sw.mask.set(now);
  return { holes: holes.length, rows: [...rows].sort((a, c) => c[1] - a[1]) };
}, { STEP, R });
console.log(`\n  ${out.holes} points with nothing under them; the triangle that was there, and what held IT up:`);
for (const [k, n] of out.rows) console.log(`    ${String(n).padStart(5)}  ${k}`);
console.log(errs.length ? `\n[pageerror] ${errs.length}: ${errs[0]}` : '\n[pageerror] none');
await b.close();
