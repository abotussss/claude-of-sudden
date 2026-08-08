/**
 * WHAT IS THE `world_mountain_lit` BATCH, AND CAN IT BE OVER A TRENCH FLOOR?
 *
 *   node _nfmtnlit.mjs [--url=…] [--key=mountain_lit] [--at=82,-100]
 *
 * A second agent bisected the black surface still left over OSTKEHLE's trench
 * floor by hiding one `world_*` batch at a time and reported that hiding
 * `world_mountain_lit` removes the whole frame's worth of it. That batch is
 * authored in ONE place — `plains.js:buildFires`, the burning face, boulders of
 * `rockGeometry` scattered along the rim between r 176 and r 214 — and rim
 * boulders cannot be a ceiling over a trench 130 m inside them. So either the
 * attribution is wrong or the batch contains something that is not a boulder.
 *
 * Hiding a mesh is a weak instrument: it proves the black pixels belong to that
 * draw call and says nothing about which triangle. This measures the geometry:
 *
 *   · the batch's bounding box and its triangle count
 *   · any non-finite vertex — one NaN in a merged batch is a triangle that can
 *     rasterise anywhere, which is exactly what "it covered everything" looks
 *     like
 *   · the largest triangles by area, with their three world vertices, because a
 *     boulder's triangles are centimetres and a lid is tens of metres
 *   · a real upward THREE.Raycaster ray from the trench floor eye against that
 *     batch alone, both faces, which names the triangle actually overhead
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4615/?map=plains&capture=1';
const KEY = `world_${args.key ?? 'mountain_lit'}`;
const AT = String(args.at ?? '82,-100').split(',').map(Number);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('  level =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

const r = await p.evaluate(([KEY, ax, az]) => {
  const e = window.__ENGINE__;
  const out = { meshes: [], ray: null };
  const targets = [];
  e.scene.traverse((o) => { if (o.isMesh && o.name === KEY) targets.push(o); });
  for (const o of targets) {
    const g = o.geometry;
    const pa = g.getAttribute('position');
    const idx = g.getIndex();
    let bad = 0;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < pa.count; i++) {
      const X = pa.getX(i), Y = pa.getY(i), Z = pa.getZ(i);
      if (!isFinite(X) || !isFinite(Y) || !isFinite(Z)) { bad++; continue; }
      if (X < minX) minX = X; if (X > maxX) maxX = X;
      if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
      if (Z < minZ) minZ = Z; if (Z > maxZ) maxZ = Z;
    }
    // the largest triangles by area — a boulder's are centimetres
    const nt = idx ? idx.count / 3 : pa.count / 3;
    const big = [];
    for (let t = 0; t < nt; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const ax0 = pa.getX(i0), ay0 = pa.getY(i0), az0 = pa.getZ(i0);
      const bx = pa.getX(i1) - ax0, by = pa.getY(i1) - ay0, bz = pa.getZ(i1) - az0;
      const cx = pa.getX(i2) - ax0, cy = pa.getY(i2) - ay0, cz = pa.getZ(i2) - az0;
      const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
      const area = 0.5 * Math.hypot(nx, ny, nz);
      if (!isFinite(area)) continue;
      big.push({ area, at: [ax0, ay0, az0], up: ny / (2 * area) });
    }
    big.sort((a, b) => b.area - a.area);
    out.meshes.push({
      name: o.name, visible: o.visible, tris: nt, verts: pa.count, nonFinite: bad,
      bbox: [minX, minY, minZ, maxX, maxY, maxZ].map((v) => +v.toFixed(1)),
      biggest: big.slice(0, 6).map((t) => ({
        area: +t.area.toFixed(2), at: t.at.map((v) => +v.toFixed(1)), upness: +t.up.toFixed(2),
      })),
      matSide: o.material?.side, depthWrite: o.material?.depthWrite, transparent: o.material?.transparent,
    });
  }
  /**
   * …AND THE FLOOR UNDER THE EYE, plus the nearest vertex of the batch to it.
   * Distance is the whole argument: a lid is overhead, and a batch whose closest
   * vertex is sixty metres away horizontally is not overhead whatever a hidden
   * draw call does to the frame. @see `_nfmtnhide.mjs`, which photographs it.
   */
  const ph = e.ctx.peek('physics');
  const h = ph.raycast(ax, 300, az, 0, -1, 0, 400, ph.MASK.WORLD);
  let nearest = 1e9;
  for (const o of targets) {
    const pa = o.geometry.getAttribute('position');
    for (let i = 0; i < pa.count; i++) {
      const d = Math.hypot(pa.getX(i) - ax, pa.getZ(i) - az);
      if (d < nearest) nearest = d;
    }
  }
  out.ray = {
    floorY: h.hit ? +h.point.y.toFixed(2) : null, at: [ax, az],
    nearest: isFinite(nearest) ? +nearest.toFixed(1) : null,
  };
  return out;
}, [KEY, AT[0], AT[1]]);

for (const m of r.meshes) {
  console.log(`\n  ${m.name}  visible=${m.visible}  ${m.tris} tris / ${m.verts} verts  nonFinite=${m.nonFinite}`);
  console.log(`    bbox  x ${m.bbox[0]}..${m.bbox[3]}   y ${m.bbox[1]}..${m.bbox[4]}   z ${m.bbox[2]}..${m.bbox[5]}`);
  console.log(`    material side=${m.matSide} depthWrite=${m.depthWrite} transparent=${m.transparent}`);
  for (const t of m.biggest) console.log(`      ${String(t.area).padStart(9)} m2   first vertex [${t.at}]   upness ${t.upness}`);
}
console.log(`\n  trench floor at [${r.ray.at}] is y ${r.ray.floorY}; nearest vertex of the batch is ${r.ray.nearest} m away horizontally`);
console.log(errs.length ? `PAGEERRORS: ${errs[0]}` : '0 pageerrors');
await b.close();
