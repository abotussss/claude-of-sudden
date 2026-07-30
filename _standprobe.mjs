import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
await page.goto('http://127.0.0.1:4214/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log(await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match'); const world = e.ctx.peek('world');
  const V3 = m.sites[0].position.constructor; const s = new V3();
  const B = world.layout.BUILDINGS.filter(b=>b.enterable);
  const inB = (p) => { const l = world.worldToLevel(p.x,p.y,p.z,s);
    for (const b of B) if (l.x>b.x-b.w/2&&l.x<b.x+b.w/2&&l.z>b.z-b.d/2&&l.z<b.z+b.d/2) return `${b.id} (${l.x.toFixed(1)},${l.z.toFixed(1)})`;
    return `OUTSIDE (${l.x.toFixed(1)},${l.z.toFixed(1)})`; };
  const rows = m.caches.botList.map(c => `${c.id.padEnd(20)} crate=${inB(c.position).padEnd(28)} stand=${inB(c.stand).padEnd(28)} gap=${c.stand.distanceTo(c.position).toFixed(2)}`);
  const zd = m.caches.botList.map(c => c.id+': '+m.sites.map(z=>`${z.id}=${c.stand.distanceTo(z.position).toFixed(0)}`).join(' '));
  return rows.join('\n')+'\n\nDIST TO ZONES\n'+zd.join('\n');
}));
await browser.close();
