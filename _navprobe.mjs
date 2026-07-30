import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:4220/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log(JSON.stringify(await page.evaluate(() => {
  const c = window.__ENGINE__.ctx, ai = c.peek('ai'), w = c.peek('world');
  const g = ai.grid, out = [], V = c.camera.position.constructor;
  const L2W = (x, z) => w.levelToWorld(x * 1.5, 0, z * 1.5, new V());
  const snap = (p) => { const i = g.nearest(p.x, p.z, p.y, 4, 2.0); return i < 0 ? null
    : { i, x: g.worldX(i % g.nx), y: g.floor[i], z: g.worldZ((i / g.nx) | 0) }; };
  const rows = [];
  const crossing = L2W(0, -1); crossing.y = 0.16;
  const atk = L2W(0, 64.5); atk.y = 0.1;
  const def = L2W(0, -66.5); def.y = 0.1;
  const cs = snap(crossing), as = snap(atk), ds = snap(def);
  rows.push(`crossing snap ${JSON.stringify(cs)}`);
  rows.push(`attack snap ${JSON.stringify(as)}   defend snap ${JSON.stringify(ds)}`);
  for (const [name, a, b] of [['atk->crossing', as, cs], ['def->crossing', ds, cs], ['atk->def', as, ds]]) {
    if (!a || !b) { rows.push(`${name}: no cell`); continue; }
    const pa = new V(a.x, a.y, a.z), pb = new V(b.x, b.y, b.z);
    const r = [];
    for (const mn of [24000, 60000, 400000]) r.push(`${mn}:${g.findPath(pa, pb, out, { maxNodes: mn })}`);
    rows.push(`${name} (${Math.hypot(a.x-b.x, a.z-b.z).toFixed(0)} m) -> ${r.join('  ')}`);
  }
  // how many cells inside the cathedral footprint got carved
  let inside = 0, walk = 0;
  for (let iz = 0; iz < g.nz; iz++) for (let ix = 0; ix < g.nx; ix++) {
    const p = w.worldToLevel(g.worldX(ix), 0, g.worldZ(iz), new V());
    if (Math.abs(p.x) > 14 || p.z < -22.5 || p.z > 19.5) continue;
    inside++; if (g.flags[g.index(ix, iz)]) walk++;
  }
  rows.push(`cathedral footprint cells ${inside}, walkable ${walk}`);
  return rows;
}), null, 1));
await browser.close();
