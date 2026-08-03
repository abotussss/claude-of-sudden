/**
 * WILL A HULL EVER ACTUALLY MEET ONE? Closest approach of every baked leg to
 * every free-standing block's own box, against `CONTACT_RAZE_R` — the radius
 * the glacis knocks with. A block no route passes is one only the gun can take.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4498/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`${URL}?seed=${process.argv[3] ?? 7}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const out = await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const A = m.tank;
  const R = 1.9 + 3.3; // CONTACT_RAZE_R + PLOUGH_NOSE: the glacis reaches ahead
  const rows = [];
  for (const bl of A._blocks.list) {
    let best = Infinity; let which = '';
    for (const t of A.tanks) for (const p of t.legs) for (let i = 0; i < p.n; i++) {
      const dx = p.X[i] < bl.minX ? bl.minX - p.X[i] : p.X[i] > bl.maxX ? p.X[i] - bl.maxX : 0;
      const dz = p.Z[i] < bl.minZ ? bl.minZ - p.Z[i] : p.Z[i] > bl.maxZ ? p.Z[i] - bl.maxZ : 0;
      const d = Math.hypot(dx, dz);
      if (d < best) { best = d; which = `${t.id}/${p.zone ?? 'HUB'}`; }
    }
    rows.push({ x: +bl.x.toFixed(1), z: +bl.z.toFixed(1), top: +bl.top.toFixed(2), d: +best.toFixed(2), which, hit: best <= R });
  }
  return { rows, R };
});
out.rows.sort((a, x) => a.d - x.d);
console.log(`\n  glacis reach ${out.R} m\n`);
for (const r of out.rows) console.log(`  ${r.hit ? 'DRIVEN' : '      '} [${String(r.x).padStart(7)},${String(r.z).padStart(7)}] ${String(r.top).padStart(5)} m tall — nearest leg ${String(r.d).padStart(6)} m (${r.which})`);
console.log(`\n  ${out.rows.filter((r) => r.hit).length} of ${out.rows.length} blocks are on a hull's own driving line`);
await b.close();
