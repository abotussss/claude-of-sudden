import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
await p.goto('http://127.0.0.1:4613/?map=plains', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const r = await p.evaluate(() => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics'), w = e.ctx.peek('world');
  const out = [];
  for (let z = 20; z >= -60; z -= 4) {
    const h = ph.raycast(0, 300, z, 0, -1, 0, 400, ph.MASK.WORLD);
    out.push([z, h.hit ? +h.point.y.toFixed(2) : null, +(w.groundHeight ? w.groundHeight(0, z) : 0).toFixed(2)]);
  }
  return { out, level: w.level.id, fortR: w.demolitions?.map(d=>({id:d.id,x:d.x,z:d.z,r:d.radius})) };
});
console.log(r.level, JSON.stringify(r.fortR));
for (const [z, top, g] of r.out) console.log(`z=${String(z).padStart(4)}  world top ${String(top).padStart(7)}  ground ${String(g).padStart(7)}`);
await b.close();
