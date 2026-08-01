/**
 * THE MID STREET, MEASURED — how wide is it at every authored z, on each of a
 * few candidate x lines, and how far is that point from every capture circle?
 * This is what the tank's authored polyline has to be aimed with, because the
 * map grew (spawns went to level z ∓90..∓103, the mid lane's kerbs to x ∓23)
 * and `ROUTES` in src/match/tank.js was authored against the old one.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4272/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const r = await page.evaluate(() => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), w = e.ctx.peek('world'), phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const f = (n) => +n.toFixed(1);
  const cath = w.cathedral;
  const zones = (m.allZones ?? []).map((z) => ({ id: z.id, x: z.position.x, z: z.position.z }));
  const out = { cath: cath ? { cx: cath.cx, cz: cath.cz, hw: cath.hw, hd: cath.hd, intactTopY: f(cath.intactTopY ?? 0), ruinTopY: f(cath.ruinTopY ?? 0) } : null, zones: zones.map((z) => ({ id: z.id, w: [f(z.x), f(z.z)] })), lines: [] };
  const dir = new V3(), probe = new V3(), side = new V3();
  // travel direction along +/- level z, expressed in world
  const a0 = w.levelToWorld(0, 0, 0, new V3());
  const a1 = w.levelToWorld(0, 0, 10, new V3());
  dir.set(a1.x - a0.x, 0, a1.z - a0.z).normalize();
  side.set(dir.z, 0, -dir.x);
  for (const lx of [-14, -10, -8, -5, 0, 5, 8, 10, 14]) {
    const row = [];
    for (let lz = -90; lz <= 90; lz += 5) {
      const p = w.levelToWorld(lx * 1.5, 0, lz * 1.5, new V3());
      const y = phys.groundHeight(p.x, p.z, 30);
      if (!Number.isFinite(y)) { row.push([lz, null, null, null]); continue; }
      probe.set(p.x, y + 1.0, p.z);
      const R = phys.raycast(probe, side, 20, phys.MASK.WORLD);
      side.multiplyScalar(-1);
      const Lh = phys.raycast(probe, side, 20, phys.MASK.WORLD);
      side.multiplyScalar(-1);
      const dR = R?.hit ? R.distance : 20, dL = Lh?.hit ? Lh.distance : 20;
      let best = 1e9, id = '';
      for (const z of zones) { const d = Math.hypot(p.x - z.x, p.z - z.z); if (d < best) { best = d; id = z.id; } }
      row.push([lz, f(dL + dR), f(best), id, f(p.x), f(p.z)]);
    }
    out.lines.push({ lx, row });
  }
  return out;
});
console.log('CATHEDRAL', JSON.stringify(r.cath));
console.log('ZONES', JSON.stringify(r.zones));
for (const l of r.lines) {
  console.log(`\n--- authored x=${l.lx} (level x=${l.lx * 1.5}) ---`);
  console.log('   lz    span   nearestZone      world');
  for (const [lz, span, d, id, wx, wz] of l.row) {
    console.log(`  ${String(lz).padStart(4)}  ${span === null ? ' NOGND' : String(span).padStart(6)}  ${d === undefined ? '' : String(d).padStart(6) + ' ' + id}   ${wx !== undefined ? `(${wx},${wz})` : ''}`);
  }
}
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
