/**
 * THE COLUMN CENSUS AT THE TOWER'S OWN AXIS.
 *
 *   node _tzcolumn.mjs
 *
 * `physics.groundHeight(0,-32)` is reported at 26.9 against a plain at 3.20.
 * `groundHeight` casts ONE ray down from y=200 under MASK.WORLD and keeps the
 * FIRST hit, so the answer is whatever solid is highest in that column — this
 * walks the WHOLE column, hit by hit, and names the layer/mask of each so the
 * mass in the air can be identified rather than guessed at.
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4626/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${BASE}?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const ph = e.ctx.peek('physics');
  const ai = e.ctx.peek('ai');
  const MASK = ph.MASK;
  const pts = [[0, -32], [-12, -34], [0, -20], [0, -44], [12, -32], [-12, -32], [-3, -32], [3, -32], [0, -29], [0, -35]];
  const rows = [];
  for (const [x, z] of pts) {
    const col = [];
    let y = 200;
    for (let k = 0; k < 40; k++) {
      const h = ph.raycast(x, y, z, 0, -1, 0, 1000, MASK.WORLD);
      if (!h.hit) break;
      col.push(+h.point.y.toFixed(2));
      y = h.point.y - 0.02;
      if (y < -5) break;
    }
    rows.push({
      at: [x, z],
      plainsY: +(w.level.groundY ? w.level.groundY(x, z) : NaN).toFixed(2),
      worldGround: +(w.groundHeight ? w.groundHeight(x, z) : NaN).toFixed(2),
      groundHeight: +ph.groundHeight(x, z).toFixed(2),
      world: col,
    });
  }
  // nav floor at the tower cell
  const g = ai.grid;
  const cellOf = (x, z) => {
    const ix = g.cellX(x), iz = g.cellZ(z);
    return { ix, iz, walkable: g.walkable(ix, iz), floor: +(g.floorAt ? g.floorAt(ix, iz) : g.floor[iz * g.nx + ix]).toFixed(2) };
  };
  return {
    level: w.level.id,
    towerCell: cellOf(0, -32),
    cellM12: cellOf(-12, -34),
    rows,
    demolitions: (w.demolitions ?? []).map((r) => ({
      id: r.id, pos: [+r.position.x.toFixed(1), +r.position.y.toFixed(2), +r.position.z.toFixed(1)],
      top: +r.top.toFixed(2), radius: r.radius,
      navRect: r.navRect ? [+r.navRect.x0.toFixed(1), +r.navRect.x1.toFixed(1), +r.navRect.z0.toFixed(1), +r.navRect.z1.toFixed(1)] : null,
      caches: (r.caches ?? []).map((c) => c.id),
    })),
  };
});
console.log(JSON.stringify(out, null, 1));
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
