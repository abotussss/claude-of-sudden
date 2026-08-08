/**
 * HOW MUCH FLAT GROUND IS STILL DRAWN ON THIS MAP, AND WHO DRAWS IT.
 *
 *   node _nfflatcensus.mjs [--url=…]
 *
 * 「この地面テクスチャーが浮いてます 至る所で 消して」
 *
 * "The sheets are gone" is an impression until it is a number. A flat ground
 * sheet has one signature that nothing else on the plain has: a triangle whose
 * normal is within a few degrees of straight UP and whose centroid is within
 * half a metre of `plainsY`. The terrain itself matches that too, so the
 * terrain mesh is named and subtracted — everything left is a sheet somebody
 * laid ON the ground, reported per drawn batch with its area in m².
 *
 * The boot console lines from the three passes that own them are echoed under
 * it, because those are the authored counts and this is the measured one.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4625/?map=plains&capture=1';
const R = Number(args.r ?? 176);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
const logs = [];
p.on('console', (m) => { const t = m.text(); if (t.includes('[world] nachtfeld')) logs.push(t); });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

const out = await p.evaluate((R) => {
  const e = window.__ENGINE__;
  const gy = e.ctx.peek('world').level.groundY;
  const world = e.scene.children.find((c) => c.name === 'world');
  world.updateMatrixWorld(true);
  const rows = new Map();
  let terrainTris = 0, worldTris = 0;
  const P = { x: 0, y: 0, z: 0 };
  const xf = (el, x, y, z) => {
    P.x = el[0] * x + el[4] * y + el[8] * z + el[12];
    P.y = el[1] * x + el[5] * y + el[9] * z + el[13];
    P.z = el[2] * x + el[6] * y + el[10] * z + el[14];
  };
  world.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.visible) return;
    const g = o.geometry; const pa = g?.getAttribute('position'); if (!pa) return;
    const idx = g.getIndex(); const n = idx ? idx.count : pa.count;
    const el = o.matrixWorld.elements;
    let flat = 0, area = 0;
    for (let i = 0; i < n; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      xf(el, pa.getX(ia), pa.getY(ia), pa.getZ(ia)); const ax = P.x, ay = P.y, az = P.z;
      xf(el, pa.getX(ib), pa.getY(ib), pa.getZ(ib)); const bx = P.x, by = P.y, bz = P.z;
      xf(el, pa.getX(ic), pa.getY(ic), pa.getZ(ic)); const cx = P.x, cy = P.y, cz = P.z;
      const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
      worldTris++;
      if (mx * mx + mz * mz > R * R) continue;
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const wx = cx - ax, wy = cy - ay, wz = cz - az;
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) continue;
      // within ~10 degrees of straight up, and lying on the ground
      if (Math.abs(ny) / len < 0.985) continue;
      const d = my - gy(mx, mz);
      if (d < -0.4 || d > 0.6) continue;
      flat++; area += len * 0.5;
    }
    if (!flat) return;
    rows.set(o.name || '(unnamed)', { tris: flat, m2: +area.toFixed(0) });
  });
  return { rows: [...rows.entries()].sort((a, c) => c[1].m2 - a[1].m2), worldTris };
}, R);

console.log(`\n  ${out.worldTris} triangles drawn in the world root; inside r ${R}, up-facing and within 0.6 m of the ground:\n`);
console.log('    batch                    triangles      m²');
for (const [name, v] of out.rows) {
  console.log(`    ${name.padEnd(24)} ${String(v.tris).padStart(9)}  ${String(v.m2).padStart(7)}`);
}
console.log('\n  boot console:');
for (const l of logs) console.log('    ' + l);
console.log(errs.length ? `\n  PAGEERRORS(${errs.length}): ${errs[0]}` : '\n  0 pageerrors');
await b.close();
