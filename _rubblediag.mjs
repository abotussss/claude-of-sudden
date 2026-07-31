/**
 * WHERE ARE THE COVER POINTS THE RUBBLE MAKES? — the unfiltered sweep, run in
 * the page against the live level, so the candidate filter in
 * `CoverMap.bakeBlockDeps` can be checked against what it is throwing away.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4257/?capture=1';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const rows = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const ai = e.ctx.peek('ai');
  const ph = e.ctx.peek('physics');
  const g = ai.grid;
  const MASK = ph.MASK.WORLD;
  const REACH = 1.3;
  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
  const S2 = Math.SQRT2;
  const recs = w.demolitions ?? [];
  const have = new Set();
  for (const p of ai.coverIntact.all) have.add(p.cell);

  const hit = (x, y, z, d) =>
    ph.raycast(x, y + 0.55, z, DX[d] / (d < 4 ? 1 : S2), 0, DZ[d] / (d < 4 ? 1 : S2), REACH, MASK).hit;

  /** how far, in cells, to the nearest non-walkable cell (capped) */
  const ringTo = (ix, iz, cap) => {
    for (let r = 1; r <= cap; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= g.nx || jz >= g.nz) return r;
          if (!g.walkable(jx, jz)) return r;
        }
      }
    }
    return cap + 1;
  };

  const out = [];
  for (let k = 0; k < recs.length; k++) {
    const r = recs[k].navRect;
    const pad = REACH + g.cell;
    const ix0 = Math.max(1, g.cellX(r.x0 - pad));
    const ix1 = Math.min(g.nx - 2, g.cellX(r.x1 + pad));
    const iz0 = Math.max(1, g.cellZ(r.z0 - pad));
    const iz1 = Math.min(g.nz - 2, g.cellZ(r.z1 + pad));
    const cand = [];
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        if (!g.walkable(ix, iz)) continue;
        const i = g.index(ix, iz);
        if (have.has(i)) continue; // already a cover point: not a "created" one
        const x = g.worldX(ix), z = g.worldZ(iz), y = g.floor[i];
        let up = 0;
        for (let d = 0; d < 8; d++) if (hit(x, y, z, d)) up |= 1 << d;
        cand.push({ ix, iz, i, x, y, z, up });
      }
    }
    recs[k].setCollision(true);
    for (const c of cand) {
      let dn = 0;
      for (let d = 0; d < 8; d++) if (hit(c.x, c.y, c.z, d)) dn |= 1 << d;
      const gained = dn & ~c.up;
      if (!gained) continue;
      out.push({
        block: recs[k].id,
        x: +c.x.toFixed(1),
        y: +c.y.toFixed(2),
        z: +c.z.toFixed(1),
        anyUp: c.up !== 0,
        ring: ringTo(c.ix, c.iz, 12),
        dCentre: +Math.hypot(c.x - recs[k].position.x, c.z - recs[k].position.z).toFixed(1),
        dY: +(c.y - recs[k].position.y).toFixed(2),
      });
    }
    recs[k].setCollision(false);
  }
  return out;
});

console.log(`[rubblediag] cells that GAIN a facing when their block falls: ${rows.length}`);
for (const r of rows) {
  console.log(
    `  ${r.block} at (${r.x}, ${r.y}, ${r.z}) · ${r.dCentre} m from centre · dY ${r.dY}` +
      ` · nearest blocked cell ${r.ring > 12 ? '>12' : r.ring} cells` +
      ` · had standing cover: ${r.anyUp}`
  );
}
const kept = rows.filter((r) => r.ring <= 5).length;
console.log(`[rubblediag] within RING=5 of a blocked cell: ${kept} · beyond it: ${rows.length - kept}`);
await browser.close();
