/**
 * WHAT IS STANDING HERE? — every surface a downward ray finds at a list of
 * points, with its material, plus the nearest drawn instance groups.
 *
 *   node _nfwhat.mjs [url] x,z x,z …
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4617/?map=plains';
const PTS = process.argv.slice(3).map((s) => s.split(',').map(Number));
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 480 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const out = await p.evaluate((PTS) => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world'), phys = c.peek('physics');
  const V = c.camera.position.constructor;
  const _wp = new V();
  const res = [];
  for (const [lx, lz] of PTS) {
    w.levelToWorld(lx, 0, lz, _wp);
    const g = w.level.groundY(lx, lz);
    let from = g + 28;
    const hits = [];
    for (let s = 0; s < 8; s++) {
      const h = phys.raycast(_wp.x, from, _wp.z, 0, -1, 0, from - (g - 9), phys.MASK.CHARACTER);
      if (!h.hit) break;
      hits.push({ y: +h.point.y.toFixed(2), ny: +(h.normal?.y ?? 0).toFixed(2), s: h.surface });
      from = h.point.y - 0.03;
    }
    res.push({ lx, lz, g: +g.toFixed(2), hits });
  }
  return res;
}, PTS);

for (const r of out) {
  console.log(`\n  [${r.lx}, ${r.lz}]  groundY ${r.g}`);
  for (const h of r.hits) console.log(`      y ${String(h.y).padStart(7)}   n.y ${String(h.ny).padStart(6)}   ${h.s}`);
}
console.log('\npageerrors', errs.length, errs[0] ?? '');
await b.close();
