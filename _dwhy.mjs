/**
 * WHICH MASS OWNS EACH DEAD CELL IN D — the cell list `_dbury.mjs`'s plan
 * cannot name. Boots `?cath=down`, maps every non-walkable cell of D's circle
 * back into the cathedral's own level frame, and buckets it by the nearest
 * authored thing (chest squares, the field, the rim ring), with the collision
 * top over the cell so "why" is a height and a place rather than a glyph.
 *
 *   node _dwhy.mjs [--url=…] [--seed=N]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4421/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
const q = ['cath=down'];
if (args.seed) q.push(`seed=${args.seed}`);
await page.goto(`${URL}?${q.join('&')}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  const ph = e.ctx.peek('physics');
  const w = e.ctx.peek('world');
  const g = ai.grid;
  const MASK = ph.MASK.WORLD;
  const k = w.cathedral;
  const vol = w.interiorVolumes.find((v) => v.building === k.id);
  const d = m.allZones.find((z) => z.id === 'D');
  const rows = [];
  const iz0 = g.cellZ(d.position.z - d.radius);
  const iz1 = g.cellZ(d.position.z + d.radius);
  const ix0 = g.cellX(d.position.x - d.radius);
  const ix1 = g.cellX(d.position.x + d.radius);
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const x = g.worldX(ix);
      const z = g.worldZ(iz);
      if (Math.hypot(x - d.position.x, z - d.position.z) > d.radius) continue;
      if (g.flags[g.index(ix, iz)]) continue;
      const dx = x - vol.cx;
      const dz = z - vol.cz;
      const lu = dx * vol.c - dz * vol.s;
      const lv = dx * vol.s + dz * vol.c;
      const hit = ph.raycast(x, 30, z, 0, -1, 0, 40, MASK);
      // Re-ask the two carve tests here and now, with the ruin solid: a cell
      // that FITS now was killed at boot by the shell, not by the ruin.
      const V3 = e.camera.position.constructor;
      const fy = hit.hit ? hit.point.y : 0;
      const p0 = new V3(x, fy + g.radius + 0.06, z);
      const p1 = new V3(x, fy + g.height - g.radius, z);
      const fits = ph.checkCapsule(p0, p1, g.radius, MASK);
      // …and the nearest lateral blocker: 8 chest-height rays, shortest wins.
      let blocker = null;
      let bd = 9;
      for (let a = 0; a < 8; a++) {
        const h2 = ph.raycast(x, fy + 0.9, z, Math.cos(a * 0.785), 0, Math.sin(a * 0.785), 3.2, MASK);
        if (h2.hit && h2.distance < bd) { bd = h2.distance; blocker = h2.object?.name || '(batch)'; }
      }
      rows.push({
        u: +lu.toFixed(1), v: +lv.toFixed(1),
        top: hit.hit ? +(fy - k.floorY).toFixed(2) : null,
        owner: hit.hit ? (hit.object?.name || '(batch)') : '-',
        fits,
        near: blocker ? `${blocker}@${bd.toFixed(1)}` : '-',
      });
    }
  }
  return { rows, n: rows.length };
});
console.log(`dead cells in D (boot bake, ?cath=down): ${out.n}`);
console.log('   (u, v) level-frame, collision top over the floor:');
for (const r of out.rows) console.log(`   ${String(r.u).padStart(6)}, ${String(r.v).padStart(6)}   top ${r.top}  fits ${r.fits}  on ${r.owner}  near ${r.near}`);
if (errs.length) console.log('PAGE ERRORS', errs.slice(0, 3));
await browser.close();
