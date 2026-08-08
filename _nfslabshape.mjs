/**
 * THE SHAPE OF THE THING OVERHEAD — flood the merged batch and measure it.
 *
 *   node _nfslabshape.mjs [--port=4612]
 *
 * `_nfslab.mjs` says the ceiling in six bays is a horizontal triangle with a
 * 4.8-12.9 m edge, both normals pointing straight DOWN, in `world_steppe*`.
 * A merged batch has no object boundaries, so this recovers them: from the hit
 * triangle it floods the shared-vertex graph and reports the connected island —
 * its triangle count, its world box, its height above `plainsY` and whether
 * EVERY normal in it points down. A `domeGeometry` sheet is one island of a few
 * hundred triangles; the walked terrain is one island of two hundred thousand.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4612'}/?map=plains&capture=1`;

const { trenchBays } = await import('./src/world/levels/plains-trench.js');
const byLine = new Map();
for (const b of trenchBays()) {
  const cur = byLine.get(b.name);
  if (!cur || (b.s1 - b.s0) > (cur.s1 - cur.s0)) byLine.set(b.name, b);
}
const picks = [...byLine.values()].map((b) => { const m = b.pts[b.pts.length >> 1]; return [b.name, +m[0].toFixed(2), +m[1].toFixed(2)]; });

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
  const meshes = [];
  e.scene.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.visible && o.name.startsWith('world_')) meshes.push(o); });

  const findTri = (x, z, y0) => {
    let best = Infinity, hit = null;
    for (const o of meshes) {
      const pa = o.geometry.getAttribute('position'); const idx = o.geometry.getIndex();
      const n = idx ? idx.count : pa.count;
      for (let i = 0; i < n; i += 3) {
        const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
        const ax = pa.getX(a), ay = pa.getY(a), az = pa.getZ(a);
        const bx = pa.getX(b), by = pa.getY(b), bz = pa.getZ(b);
        const cx = pa.getX(c), cy = pa.getY(c), cz = pa.getZ(c);
        if (Math.min(ax, bx, cx) > x || Math.max(ax, bx, cx) < x) continue;
        if (Math.min(az, bz, cz) > z || Math.max(az, bz, cz) < z) continue;
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const y = l1 * ay + l2 * by + l3 * cy;
        if (y <= y0 + 0.05 || y >= best) continue;
        best = y; hit = { mesh: o, tri: i / 3 };
      }
    }
    return hit;
  };

  const island = (o, t0) => {
    const pa = o.geometry.getAttribute('position');
    const na = o.geometry.getAttribute('normal');
    const idx = o.geometry.getIndex();
    const nt = idx.count / 3;
    // vertex -> triangles
    const byV = new Map();
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const v = idx.getX(t * 3 + k); let a = byV.get(v); if (!a) byV.set(v, (a = [])); a.push(t);
    }
    const seen = new Uint8Array(nt); const q = [t0]; seen[t0] = 1;
    let count = 0, up = 0, down = 0;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    while (q.length && count < 400000) {
      const t = q.pop(); count++;
      for (let k = 0; k < 3; k++) {
        const v = idx.getX(t * 3 + k);
        const X = pa.getX(v), Y = pa.getY(v), Z = pa.getZ(v);
        if (X < x0) x0 = X; if (X > x1) x1 = X;
        if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
        if (Z < z0) z0 = Z; if (Z > z1) z1 = Z;
        if (na && na.getY(v) > 0.2) up++; else if (na && na.getY(v) < -0.2) down++;
        for (const u of byV.get(v)) if (!seen[u]) { seen[u] = 1; q.push(u); }
      }
    }
    return { tris: count, up, down, box: [x0, y0, z0, x1, y1, z1].map((n) => +n.toFixed(2)) };
  };

  return pts.map(([name, x, z]) => {
    const h = ph.raycast(x, 300, z, 0, -1, 0, 400, ph.MASK.WORLD);
    const floor = h.hit ? h.point.y : 0;
    const eye = floor + 1.62;
    const t = findTri(x, z, eye);
    if (!t) return { name, x, z, none: true };
    const isl = island(t.mesh, t.tri);
    return {
      name, x, z, mesh: t.mesh.name, floor: +floor.toFixed(2), plain: +plainsY(x, z).toFixed(2),
      ...isl,
      w: +(isl.box[3] - isl.box[0]).toFixed(2), d: +(isl.box[5] - isl.box[2]).toFixed(2), h: +(isl.box[4] - isl.box[1]).toFixed(2),
      abovePlain: +(isl.box[1] - plainsY((isl.box[0] + isl.box[3]) / 2, (isl.box[2] + isl.box[5]) / 2)).toFixed(2),
    };
  });
}, picks);

for (const r of out) {
  if (r.none) { console.log(`${r.name.padEnd(13)} nothing overhead`); continue; }
  console.log(`${r.name.padEnd(13)} ${r.mesh.padEnd(20)} island ${String(r.tris).padStart(7)} tris  ${r.w}x${r.d} m footprint, ${r.h} m tall  box y ${r.box[1]}..${r.box[4]}  base ${r.abovePlain >= 0 ? '+' : ''}${r.abovePlain} vs plainsY   normals up ${r.up} / down ${r.down}`);
}
console.log(errs.length ? `\nPAGEERRORS: ${errs[0]}` : '\n0 pageerrors');
await br.close();
