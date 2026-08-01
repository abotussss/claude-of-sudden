/**
 * IS THE ρ PAIR REALLY A PAIR — what is over each flank beacon, and how high.
 *
 *   node _beacon.mjs --url=http://127.0.0.1:4310/?seed=1
 *
 * `BEACON_SPOTS` authors FLANK-W and FLANK-E as a ρ image of one another under
 * (x, z) -> (-x, -2 - z). If one of them has a slab over it and the other has
 * sky, the asymmetry is in the MAP, not in the pair — so this reports the
 * headroom and the object found over every published feature, and the same two
 * numbers taken at each one's exact ρ image, which is where the pair says the
 * other one should be.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4310/';

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('  pageerror', String(e.message).slice(0, 160)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world'), phys = c.peek('physics');
  const V = c.camera.position.constructor;
  const MASK = phys.MASK.CHARACTER;
  const _p = new V();
  /** `rho` in LEVEL space: BEACON_SPOTS is authored pre-scale, so scale the -2. */
  const S = 1.5;
  /** The lowest thing over the spot ABOVE head height, sampled on a 1.2 m ring
   *  as well as at the centre, so the cache's own 0.95 m crate is not the answer. */
  const over = (lx, lz, ly) => {
    let best = 99, obj = 'sky';
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rr = i === 8 ? 0 : 1.2;
      w.levelToWorld(lx + Math.cos(a) * rr, ly + 2.0, lz + Math.sin(a) * rr, _p);
      const h = phys.raycast(_p.x, _p.y, _p.z, 0, 1, 0, 40, MASK);
      if (!h.hit) continue;
      const head = h.distance + 2.0;
      if (head < best) { best = +head.toFixed(2); obj = h.object?.name ?? '?'; }
    }
    return { head: best, obj };
  };
  const rows = [];
  for (const f of w.features ?? []) {
    if (f.indoor || String(f.floor) === 'roof') continue;
    const me = over(f.level.x, f.level.z, f.level.y);
    const mx = -f.level.x, mz = -2 * S - f.level.z;
    const mirror = over(mx, mz, f.level.y);
    rows.push({ id: f.id, x: +f.level.x.toFixed(2), y: +f.level.y.toFixed(2), z: +f.level.z.toFixed(2),
      me, mirror, mx: +mx.toFixed(2), mz: +mz.toFixed(2) });
  }
  return rows;
});

for (const r of out) {
  console.log(
    `  ${r.id.padEnd(20)} at ${String(r.x).padStart(8)},${String(r.y).padStart(6)},${String(r.z).padStart(8)}  ` +
    `over it: ${String(r.me.head).padStart(6)} m (${r.me.obj})` +
    `   |  rho image ${String(r.mx).padStart(8)},${String(r.mz).padStart(8)}: ${String(r.mirror.head).padStart(6)} m (${r.mirror.obj})`
  );
}
await browser.close();
