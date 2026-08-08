/**
 * THE SLAB OVER THE TRENCH — every drawn layer over the eye, with its geometry.
 *
 *   node _nfslab.mjs [--port=4612]
 *
 * `_nftrenchup.mjs` photographs a dark cracked-soil surface 0.1-2.3 m over a
 * standing man's eye in six of the thirteen bays and names the BATCH. A batch is
 * not a diagnosis: `world_steppe` holds the walked terrain AND every soil sheet
 * `plains-ground.js` and `plains-cover.js` merge into the same key.
 *
 * So this prints, for every cut on the plain, the WHOLE STACK over the eye — not
 * just the nearest — and for each layer the owning mesh, the triangle's longest
 * edge (the terrain is 1.59 m quads; a soil sheet is 4-17 m across), its height
 * over the ANALYTIC plain (a sheet lies at `plainsY + 0.015`; a berm does not),
 * and the geometric and shading normals, which is what decides whether the thing
 * renders black.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const PORT = args.port ?? '4612';
const URL = `http://127.0.0.1:${PORT}/?map=plains&capture=1`;

const { trenchBays } = await import('./src/world/levels/plains-trench.js');
const byLine = new Map();
for (const b of trenchBays()) {
  const cur = byLine.get(b.name);
  if (!cur || (b.s1 - b.s0) > (cur.s1 - cur.s0)) byLine.set(b.name, b);
}
const picks = [...byLine.values()].map((b) => {
  const mid = b.pts[b.pts.length >> 1];
  return [b.name, +mid[0].toFixed(2), +mid[1].toFixed(2)];
});

const br = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await br.newPage({ viewport: { width: 900, height: 520 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level =', await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

const out = await page.evaluate((pts) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const plainsY = e.ctx.peek('world').level.groundY;
  const chain = (o) => { const s = []; let c = o; while (c && c.parent) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };

  const stack = (x, z, y0) => {
    const res = [];
    const v = { x: 0, y: 0, z: 0 }, nv = { x: 0, y: 0, z: 0 };
    e.scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.visible) return;
      const g = o.geometry; const pa = g.getAttribute('position'); if (!pa) return;
      const na = g.getAttribute('normal');
      const idx = g.getIndex(); const n = idx ? idx.count : pa.count;
      const el = o.matrixWorld.elements;
      const nm = chain(o);
      const gx = (i) => { const X = pa.getX(i), Y = pa.getY(i), Z = pa.getZ(i);
        v.x = el[0] * X + el[4] * Y + el[8] * Z + el[12];
        v.y = el[1] * X + el[5] * Y + el[9] * Z + el[13];
        v.z = el[2] * X + el[6] * Y + el[10] * Z + el[14]; };
      for (let i = 0; i < n; i += 3) {
        const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
        gx(a); const ax = v.x, ay = v.y, az = v.z;
        gx(b); const bx = v.x, by = v.y, bz = v.z;
        gx(c); const cx = v.x, cy = v.y, cz = v.z;
        if (Math.min(ax, bx, cx) > x || Math.max(ax, bx, cx) < x) continue;
        if (Math.min(az, bz, cz) > z || Math.max(az, bz, cz) < z) continue;
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const y = l1 * ay + l2 * by + l3 * cy;
        if (y <= y0 + 0.05) continue;
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const wx = cx - ax, wy = cy - ay, wz = cz - az;
        const gnx = uy * wz - uz * wy, gny = uz * wx - ux * wz, gnz = ux * wy - uy * wx;
        const L = Math.hypot(gnx, gny, gnz) || 1;
        let sny = null;
        if (na) {
          nv.y = l1 * na.getY(a) + l2 * na.getY(b) + l3 * na.getY(c);
          sny = +nv.y.toFixed(2);
        }
        const mm = Array.isArray(o.material) ? o.material[0] : o.material;
        res.push({
          y: +y.toFixed(2), name: nm,
          edge: +Math.max(Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz), Math.hypot(cx - bx, cy - by, cz - bz)).toFixed(2),
          gny: +(gny / L).toFixed(2), sny,
          side: mm?.side ?? 0, order: o.renderOrder,
        });
      }
    });
    return res.sort((p, q) => p.y - q.y);
  };

  return pts.map(([name, x, z]) => {
    const h = ph.raycast(x, 300, z, 0, -1, 0, 400, ph.MASK.WORLD);
    const floor = h.hit ? h.point.y : 0;
    const eye = floor + 1.62;
    return { name, x, z, floor: +floor.toFixed(2), plain: +plainsY(x, z).toFixed(2), eye: +eye.toFixed(2), layers: stack(x, z, eye) };
  });
}, picks);

for (const r of out) {
  console.log(`\n${r.name}  (${r.x}, ${r.z})   floor ${r.floor}   plainsY ${r.plain}   eye ${r.eye}   cut depth ${(r.plain - r.floor).toFixed(2)} m`);
  if (!r.layers.length) { console.log('   (nothing drawn over the eye)'); continue; }
  for (const l of r.layers.slice(0, 6)) {
    console.log(`   +${(l.y - r.eye).toFixed(2).padStart(6)} m over eye   ${(l.y - r.plain >= 0 ? '+' : '') + (l.y - r.plain).toFixed(2).padStart(6)} vs plainsY   ${l.name.padEnd(28)} edge ${String(l.edge).padStart(6)} m   geoNy ${String(l.gny).padStart(6)}  shadeNy ${String(l.sny).padStart(6)}  side ${l.side} ord ${l.order}`);
  }
}
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs[0]}` : '\n0 pageerrors');
await br.close();
