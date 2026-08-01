/** Where each hull's approach actually ends, in authored (widened) units. */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4291/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 500 } });
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log(await page.evaluate(() => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), w = e.ctx.peek('world'), a = m.tank;
  const V3 = e.camera.position.constructor; const S = 1.5; const o = new V3();
  return a.tanks.map((t) => {
    const p = t.legs[0]; const j = p.n - 1;
    w.worldToLevel(p.X[j], p.Y[j], p.Z[j], o);
    return `${t.id} hub world(${p.X[j].toFixed(1)},${p.Z[j].toFixed(1)}) authored(${(o.x / S).toFixed(1)},${(o.z / S).toFixed(1)})`;
  }).join('\n');
}));
await b.close();
