/** Collision height over the analytic plain, on a grid around a point. */
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto('http://127.0.0.1:4613/?map=plains', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
for (const spot of JSON.parse(process.argv[2])) {
  const [label, cx, cz] = spot;
  const out = await p.evaluate(([cx, cz]) => {
    const e = window.__ENGINE__, ph = e.ctx.peek('physics'), w = e.ctx.peek('world');
    const rows = [];
    for (let dz = -8; dz <= 8; dz += 1) {
      let s = '';
      for (let dx = -8; dx <= 8; dx += 1) {
        const x = cx + dx, z = cz + dz;
        const h = ph.raycast(x, 300, z, 0, -1, 0, 400, ph.MASK.WORLD);
        const over = h.hit ? h.point.y - (w.groundHeight ? w.groundHeight(x, z) : 0) : -9;
        s += over > 1.8 ? '#' : over > 1.0 ? '+' : over > 0.45 ? ':' : over > 0.15 ? '.' : ' ';
      }
      rows.push(s);
    }
    return rows;
  }, [cx, cz]);
  console.log(`\n${label}  (1 m grid, 17x17;  # >1.8m  + >1.0  : >0.45  . >0.15 over the plain)`);
  for (const r of out) console.log('   ' + r);
}
await b.close();
