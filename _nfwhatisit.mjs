/**
 * NAME EVERY SURFACE IN A FRAME, BY SCREEN AREA.
 *
 *   node _nfwhatisit.mjs --at=-25.7,130.7 [--dist=9] [--eye=1.62] [--port=4612]
 *
 * A photograph of a black slab is a complaint; the mesh, the material and the
 * distance are a diagnosis. This puts the camera where the photograph was taken
 * and fires one ray per screen cell through the real scene triangles, then
 * reports what each name covers as a PERCENTAGE OF THE FRAME, with the nearest
 * and furthest hit and the surface's facing. Whatever is filling half the screen
 * comes out at the top of the list with its name on it.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4612'}/?map=plains&capture=1`;
const AT = String(args.at ?? '-25.7,130.7').split(',').map(Number);
const DIST = Number(args.dist ?? 9);
const OUT = args.out ?? 'shots/whatisit';
mkdirSync(OUT, { recursive: true });

const br = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await br.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level =', await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
});
const frames = (n) => page.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

const res = await page.evaluate(([tx, tz, dist]) => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics');
  const a = Math.atan2(tz, tx);
  const cx = tx - Math.cos(a) * dist, cz = tz - Math.sin(a) * dist;
  const h = ph.raycast(cx, 300, cz, 0, -1, 0, 400, ph.MASK.WORLD);
  const cy = (h.hit ? h.point.y : 0) + 1.62;
  const V = e.camera.position.constructor;
  e.camera.position.set(cx, cy, cz);
  e.camera.lookAt(new V(tx, cy - 0.1, tz));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  e.camera.position.set(cx, cy, cz);
  e.camera.lookAt(new V(tx, cy - 0.1, tz));
  e.camera.updateMatrixWorld(true);

  const chain = (o) => { const s = []; let c = o; while (c && c.parent) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };
  // gather triangles within 260 m of the camera
  const tris = []; const owner = []; const names = []; const nameId = new Map();
  const idOf = (n) => { let i = nameId.get(n); if (i === undefined) { i = names.length; names.push(n); nameId.set(n, i); } return i; };
  const v = { x: 0, y: 0, z: 0 };
  e.scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.visible) return;
    const g = o.geometry; const pa = g.getAttribute('position'); if (!pa) return;
    const idx = g.getIndex(); const n = idx ? idx.count : pa.count;
    const el = o.matrixWorld.elements; const id = idOf(chain(o));
    const gx = (i) => { const X = pa.getX(i), Y = pa.getY(i), Z = pa.getZ(i);
      v.x = el[0] * X + el[4] * Y + el[8] * Z + el[12];
      v.y = el[1] * X + el[5] * Y + el[9] * Z + el[13];
      v.z = el[2] * X + el[6] * Y + el[10] * Z + el[14]; };
    for (let i = 0; i < n; i += 3) {
      const A = idx ? idx.getX(i) : i, B = idx ? idx.getX(i + 1) : i + 1, C = idx ? idx.getX(i + 2) : i + 2;
      gx(A); const ax = v.x, ay = v.y, az = v.z;
      if (Math.hypot(ax - cx, az - cz) > 300) continue;
      gx(B); const bx = v.x, by = v.y, bz = v.z;
      gx(C); const cx2 = v.x, cy2 = v.y, cz2 = v.z;
      tris.push(ax, ay, az, bx, by, bz, cx2, cy2, cz2); owner.push(id);
    }
  });

  const NX = 96, NY = 54;
  const cam = e.camera;
  const org = cam.position;
  const hits = new Map();
  let sky = 0;
  const inv = cam.matrixWorld.elements;
  const fovY = cam.fov * Math.PI / 180;
  const th = Math.tan(fovY / 2);
  for (let py = 0; py < NY; py++) {
    for (let px = 0; px < NX; px++) {
      const ndcx = ((px + 0.5) / NX) * 2 - 1;
      const ndcy = 1 - ((py + 0.5) / NY) * 2;
      const lx = ndcx * th * cam.aspect, ly = ndcy * th, lz = -1;
      const dx = inv[0] * lx + inv[4] * ly + inv[8] * lz;
      const dy = inv[1] * lx + inv[5] * ly + inv[9] * lz;
      const dz = inv[2] * lx + inv[6] * ly + inv[10] * lz;
      const L = Math.hypot(dx, dy, dz);
      const ux = dx / L, uy = dy / L, uz = dz / L;
      let best = Infinity, bi = -1;
      for (let t = 0; t < owner.length; t++) {
        const o = t * 9;
        const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
        const e1x = tris[o + 3] - ax, e1y = tris[o + 4] - ay, e1z = tris[o + 5] - az;
        const e2x = tris[o + 6] - ax, e2y = tris[o + 7] - ay, e2z = tris[o + 8] - az;
        const hx = uy * e2z - uz * e2y, hy = uz * e2x - ux * e2z, hz = ux * e2y - uy * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-9) continue;
        const f = 1 / det;
        const sx = org.x - ax, sy = org.y - ay, sz = org.z - az;
        const u = f * (sx * hx + sy * hy + sz * hz);
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const vv = f * (ux * qx + uy * qy + uz * qz);
        if (vv < 0 || u + vv > 1) continue;
        const tt = f * (e2x * qx + e2y * qy + e2z * qz);
        if (tt > 0.05 && tt < best) { best = tt; bi = t; }
      }
      if (bi < 0) { sky++; continue; }
      const nm = names[owner[bi]];
      let r = hits.get(nm); if (!r) hits.set(nm, (r = { n: 0, near: 1e9, far: 0 }));
      r.n++; if (best < r.near) r.near = best; if (best > r.far) r.far = best;
    }
  }
  const total = NX * NY;
  const list = [...hits.entries()].map(([n, r]) => ({ name: n, pct: +(100 * r.n / total).toFixed(1), near: +r.near.toFixed(1), far: +r.far.toFixed(1) })).sort((a, b) => b.pct - a.pct);
  return { cam: [+cx.toFixed(1), +cy.toFixed(2), +cz.toFixed(1)], skyPct: +(100 * sky / total).toFixed(1), list, tris: owner.length };
}, [AT[0], AT[1], DIST]);

await frames(30);
await page.screenshot({ path: `${OUT}/at_${AT[0]}_${AT[1]}_${DIST}m.png` });
console.log(`\ncamera ${res.cam}   ${res.tris} triangles considered   sky ${res.skyPct} %`);
for (const r of res.list) console.log(`  ${String(r.pct).padStart(5)} %  ${r.name.padEnd(34)} ${r.near}–${r.far} m`);
console.log(errs.length ? `\nPAGEERRORS: ${errs[0]}` : '\n0 pageerrors');
await br.close();
