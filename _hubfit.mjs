/** What the hull can see from each hull's hub: `_freeSide` in 16 directions,
 *  and the span it would measure driving each way. */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4291/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 500 } });
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log(await page.evaluate(() => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), w = e.ctx.peek('world'), phys = e.ctx.peek('physics');
  const a = m.tank; const V3 = e.camera.position.constructor; const S = 1.5; const o = new V3();
  const rows = [];
  for (const t of a.tanks) {
    const h = t.legs[0]; const j = h.n - 1;
    // walk back down the approach and, at each of the last 12 samples, ask what
    // the span would be driving off at each level bearing.
    for (let back = 0; back < 14; back += 2) {
      const i = Math.max(0, j - back);
      const x = h.X[i], z = h.Z[i];
      const y = phys.groundHeight(x, z, 30);
      w.worldToLevel(x, y, z, o);
      const cells = [];
      for (let k = 0; k < 8; k++) {
        const th = (k / 8) * Math.PI * 2;
        // level bearing -> world direction
        const p0 = w.levelToWorld(o.x, 0, o.z, new V3());
        const p1 = w.levelToWorld(o.x + Math.sin(th) * S, 0, o.z + Math.cos(th) * S, new V3());
        let dx = p1.x - p0.x, dz = p1.z - p0.z;
        const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        const sR = a._freeSide(phys, x, y + 1.0, z, dz, -dx, 9);
        const sL = a._freeSide(phys, x, y + 1.0, z, -dz, dx, 9);
        cells.push(`${(th * 180 / Math.PI).toFixed(0)}deg:${(sR + sL).toFixed(1)}`);
      }
      rows.push(`${t.id} approach[-${back}] authored(${(o.x / S).toFixed(1)},${(o.z / S).toFixed(1)}) ${cells.join(' ')}`);
    }
  }
  return rows.join('\n');
}));
await b.close();
