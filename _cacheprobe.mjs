/**
 * IS `botReachable` TRUE? Probe every cache against the real nav grid and A*.
 *   node _cacheprobe.mjs [--url=…]
 */
import { chromium } from 'playwright';
const URL = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://127.0.0.1:4214/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const r = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const m = e.ctx.peek('match');
  const world = e.ctx.peek('world');
  const g = ai.grid;
  const V3 = m.sites[0].position.constructor;
  const path = [];
  const out = [];
  for (const f of world.features) {
    const p = f.position;
    // nearest nav cell within 3 rings and 1.2 m of height, exactly as sites.js
    const ci = g.nearest(p.x, p.z, p.y, 3, 1.2);
    let cellDy = null;
    let snapped = null;
    if (ci >= 0) {
      snapped = new V3(g.worldX(ci % g.nx), g.floor[ci], g.worldZ((ci / g.nx) | 0));
      cellDy = +(snapped.y - p.y).toFixed(2);
    }
    let routes = 0;
    let tot = 0;
    if (snapped) {
      for (const k of ['attack', 'defend']) {
        for (const sp of m.spawns[k]) { tot++; if (g.findPath(sp.position, snapped, path) > 0) routes++; }
      }
    }
    // wide probe: is there ANY cell near it at all, whatever the height?
    const wide = g.nearest(p.x, p.z, p.y, 4, 99);
    const wideDy = wide >= 0 ? +(g.floor[wide] - p.y).toFixed(2) : null;
    out.push({
      id: f.id, kind: f.kind, floor: f.floor, botReachable: f.botReachable,
      cell: ci >= 0, cellDy, wideDy, routes, tot,
      dist: snapped ? +snapped.distanceTo(p).toFixed(2) : null,
    });
  }
  return out;
});
console.log('id                        kind     fl  flag  cell   dy   snapDist  routes');
for (const f of r) {
  console.log(
    f.id.padEnd(26) + String(f.kind).padEnd(9) + String(f.floor).padEnd(4) +
    (f.botReachable ? 'YES ' : 'no  ').padEnd(6) +
    (f.cell ? 'yes ' : 'NO  ').padEnd(7) +
    String(f.cellDy ?? '-').padStart(6) + String(f.dist ?? '-').padStart(10) +
    `   ${f.routes}/${f.tot}` + (f.cell ? '' : `   (nearest cell at any height dy=${f.wideDy})`)
  );
}
const flagged = r.filter((f) => f.botReachable);
console.log(`\nflagged botReachable: ${flagged.length}`);
console.log(`  …with a nav cell:            ${flagged.filter((f) => f.cell).length}`);
console.log(`  …with a route from EVERY spawn: ${flagged.filter((f) => f.routes === f.tot && f.tot).length}`);
console.log(`  …with a route from ANY spawn:   ${flagged.filter((f) => f.routes > 0).length}`);
await browser.close();
