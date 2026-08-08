/**
 * WHAT IS THE PALE FLAT PLANE ABOVE THE RIM?
 *
 *   node _terrpale.mjs [--url=http://127.0.0.1:4611/] [--bearing=115] [--r=168]
 *
 * It was reported at ~115° and BELIEVED to be the coarse `far` range mesh
 * (37.5 m quads chording over a 46 m ridge), and "suspected, not proven" is not
 * a thing to build on. This proves it or refutes it: stand where it was seen,
 * fire a grid of rays through the frame, and for every hit report the mesh
 * NAME, the hit radius from the middle of the map, and THE SIDE LENGTHS OF THE
 * TRIANGLE THAT WAS HIT.
 *
 * The triangle is the discriminator and it is unambiguous. Everything on this
 * map is small: the walked field is 3.18 m quads, a rim boulder is metres, a
 * prop is centimetres. The far range is ONE mesh at 1 500 m / 40 segments —
 * 37.5 m quads, 53 m on the diagonal. Nothing else on the plain is that size,
 * so a hit on a >20 m triangle in the `world_mountain_rock` batch is the far
 * range and cannot be anything else.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4611/';
const BEARING = Number(args.bearing ?? 115);
const R = Number(args.r ?? 168);
const PITCH = Number(args.pitch ?? 0.10);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${BASE}?capture=1&map=plains`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

const out = await p.evaluate(({ BEARING, R, PITCH }) => {
  const c = window.__ENGINE__.ctx, w = c.peek('world'), pl = c.peek('player');
  const a = BEARING * Math.PI / 180;
  const x = Math.cos(a) * R, z = Math.sin(a) * R;
  const y = w.level.groundY(x, z) + 1.65;
  const yaw = Math.atan2(-Math.cos(a), -Math.sin(a));
  pl.teleport({ x, y, z }, yaw);
  c.camera.rotation.order = 'YXZ';
  c.camera.rotation.y = yaw;
  c.camera.rotation.x = PITCH;
  c.camera.updateMatrixWorld(true);
  return { stand: [+x.toFixed(1), +y.toFixed(1), +z.toFixed(1)], yaw: +yaw.toFixed(3), pitch: PITCH };
}, { BEARING, R, PITCH });
console.log('stand', JSON.stringify(out));

/**
 * Three is bundled, not global, so the ray is walked BY HAND against the merged
 * geometry rather than through `THREE.Raycaster`. Same arithmetic, no import:
 * Möller-Trumbore over every triangle of every `world_*` mesh in the scene.
 */
const hits = await p.evaluate(({ BEARING, R, PITCH, NX, NY }) => {
  const c = window.__ENGINE__.ctx;
  const cam = c.camera;
  cam.updateMatrixWorld(true);
  const e = cam.matrixWorld.elements;
  const ox = e[12], oy = e[13], oz = e[14];
  // camera basis
  const rx = e[0], ry = e[1], rz = e[2];
  const ux = e[4], uy = e[5], uz = e[6];
  const fx = -e[8], fy = -e[9], fz = -e[10];
  const fov = cam.fov * Math.PI / 180;
  const th = Math.tan(fov / 2);
  const asp = cam.aspect;

  const meshes = [];
  c.scene.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && o.geometry?.getAttribute?.('position') && /^world_/.test(o.name)) meshes.push(o);
  });

  const rows = [];
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const sx = (i + 0.5) / NX * 2 - 1;
      const sy = 1 - (j + 0.5) / NY * 2;
      let dx = fx + rx * sx * th * asp + ux * sy * th;
      let dy = fy + ry * sx * th * asp + uy * sy * th;
      let dz = fz + rz * sx * th * asp + uz * sy * th;
      const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;

      let best = Infinity, bestMesh = null, bestTri = null;
      for (const m of meshes) {
        const g = m.geometry;
        const pa = g.getAttribute('position');
        const idx = g.getIndex();
        const n = idx ? idx.count : pa.count;
        const bs = g.boundingSphere;
        if (bs) {
          // ray-sphere reject in world space (mesh matrices are identity here)
          const cxx = bs.center.x - ox, cyy = bs.center.y - oy, czz = bs.center.z - oz;
          const tca = cxx * dx + cyy * dy + czz * dz;
          const d2 = cxx * cxx + cyy * cyy + czz * czz - tca * tca;
          if (d2 > bs.radius * bs.radius) continue;
        }
        for (let k = 0; k < n; k += 3) {
          const i0 = idx ? idx.getX(k) : k, i1 = idx ? idx.getX(k + 1) : k + 1, i2 = idx ? idx.getX(k + 2) : k + 2;
          const ax = pa.getX(i0), ay = pa.getY(i0), az = pa.getZ(i0);
          const bx = pa.getX(i1), by = pa.getY(i1), bz = pa.getZ(i1);
          const cx2 = pa.getX(i2), cy2 = pa.getY(i2), cz2 = pa.getZ(i2);
          const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
          const e2x = cx2 - ax, e2y = cy2 - ay, e2z = cz2 - az;
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-9) continue;
          const inv = 1 / det;
          const tx = ox - ax, ty = oy - ay, tz = oz - az;
          const u = (tx * px + ty * py + tz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * inv;
          if (v < 0 || u + v > 1) continue;
          const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (t <= 0.05 || t >= best) continue;
          best = t; bestMesh = m.name;
          bestTri = {
            side: Math.max(Math.hypot(e1x, e1y, e1z), Math.hypot(e2x, e2y, e2z),
              Math.hypot(cx2 - bx, cy2 - by, cz2 - bz)),
            hx: ox + dx * t, hy: oy + dy * t, hz: oz + dz * t,
          };
        }
      }
      if (bestMesh) rows.push({
        px: i, py: j, dist: +best.toFixed(1), mesh: bestMesh,
        triSide: +bestTri.side.toFixed(1),
        r: +Math.hypot(bestTri.hx, bestTri.hz).toFixed(1),
        y: +bestTri.hy.toFixed(1),
      });
    }
  }
  return rows;
}, { BEARING, R, PITCH, NX: 9, NY: 5 });

console.log('\n  screen  dist    mesh                     tri-side   hit r    hit y');
for (const h of hits) {
  console.log(`  ${h.px},${h.py}   ${String(h.dist).padStart(6)}  ${h.mesh.padEnd(24)} ${String(h.triSide).padStart(7)}  ${String(h.r).padStart(6)}  ${String(h.y).padStart(6)}`);
}
const big = hits.filter((h) => h.triSide > 20);
console.log(`\n  hits on triangles wider than 20 m: ${big.length}/${hits.length}` +
  (big.length ? ` — all in ${[...new Set(big.map((h) => h.mesh))].join(', ')}` : ''));
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
