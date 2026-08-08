/**
 * 「壁が透過されるバグもあるぞ？」 — WHICH WALL, AND WHY.
 *
 *   node _nftowersee.mjs [--port=4623]
 *
 * From a standing eye inside the tower, one ray per screen cell, and for each
 * ray THREE answers rather than one:
 *
 *   DRAWN     the nearest visible triangle in the scene, by mesh name, with the
 *             material's `side` and whether the hit was on a BACK face.
 *   SOLID     the nearest `MASK.WORLD` hit — what a bullet and the nav ray meet.
 *   SKY       no triangle at all.
 *
 * A ray that is SOLID but SKY is a wall you can see through and cannot walk
 * through: either it carries no inside face (the winding fault that made every
 * ground sheet invisible from above) or its material culls the face you are on.
 * A ray that is SKY and NOT solid is a real hole. A ray that is drawn and NOT
 * solid is one of this map's deliberate no-proxy layers.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const PORT = args.port ?? '4623';
const OUT = args.out ?? 'shots/towersee';
mkdirSync(OUT, { recursive: true });

/* eye positions inside the tower, as heights over the tower's own ground */
const POSES = [
  // OFF THE STAIR. The well runs down the shaft's centreline, so an eye at
  // (0, -32) is inside the flight and every ray reports the concrete it is
  // buried in — the first run of this probe did exactly that.
  { tag: 'room-outE', x: 3.6, h: 6.74, z: -32, yaw: -Math.PI / 2 },
  { tag: 'room-outN', x: 3.6, h: 6.74, z: -32, yaw: Math.PI },
  { tag: 'storey1-outE', x: 3.6, h: 11.6, z: -32, yaw: -Math.PI / 2 },
  { tag: 'storey3-outE', x: 3.6, h: 21.2, z: -32, yaw: -Math.PI / 2 },
  { tag: 'p1deck-atwall', x: 16, h: 3.2, z: -32, yaw: -Math.PI / 2 },
  { tag: 'p2deck-atwall', x: 9, h: 6.6, z: -32, yaw: -Math.PI / 2 },
  { tag: 'p1deck-out', x: 16, h: 3.2, z: -32, yaw: Math.PI / 2 },
];

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`http://127.0.0.1:${PORT}/?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));
await p.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
});
const frames = (n) => p.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

for (const pose of POSES) {
  const res = await p.evaluate((pose) => {
    const e = window.__ENGINE__, ph = e.ctx.peek('physics');
    const g = e.ctx.peek('world').level.groundY(0, -32);
    const cy = g + pose.h + 1.62;
    e.camera.rotation.order = 'YXZ';
    e.camera.position.set(pose.x, cy, pose.z);
    e.camera.rotation.set(0, pose.yaw, 0);
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    e.camera.position.set(pose.x, cy, pose.z);
    e.camera.rotation.set(0, pose.yaw, 0);
    e.camera.updateMatrixWorld(true);

    const chain = (o) => { const s = []; let c = o; while (c && c.parent) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };
    const tris = []; const owner = []; const names = []; const sides = []; const nameId = new Map();
    const idOf = (n, sd) => { let i = nameId.get(n); if (i === undefined) { i = names.length; names.push(n); sides.push(sd); nameId.set(n, i); } return i; };
    const v = { x: 0, y: 0, z: 0 };
    e.scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.visible) return;
      const gm = o.geometry; const pa = gm.getAttribute('position'); if (!pa) return;
      const idx = gm.getIndex(); const n = idx ? idx.count : pa.count;
      const el = o.matrixWorld.elements;
      const mm = Array.isArray(o.material) ? o.material[0] : o.material;
      const id = idOf(chain(o), mm?.side ?? 0);
      const gx = (i) => { const X = pa.getX(i), Y = pa.getY(i), Z = pa.getZ(i);
        v.x = el[0] * X + el[4] * Y + el[8] * Z + el[12];
        v.y = el[1] * X + el[5] * Y + el[9] * Z + el[13];
        v.z = el[2] * X + el[6] * Y + el[10] * Z + el[14]; };
      for (let i = 0; i < n; i += 3) {
        const A = idx ? idx.getX(i) : i, B = idx ? idx.getX(i + 1) : i + 1, C = idx ? idx.getX(i + 2) : i + 2;
        gx(A); const ax = v.x, ay = v.y, az = v.z;
        if (Math.hypot(ax - pose.x, az - pose.z) > 90) continue;
        gx(B); const bx = v.x, by = v.y, bz = v.z;
        gx(C); const cx2 = v.x, cy2 = v.y, cz2 = v.z;
        tris.push(ax, ay, az, bx, by, bz, cx2, cy2, cz2); owner.push(id);
      }
    });

    const NX = 64, NY = 36;
    const cam = e.camera, inv = cam.matrixWorld.elements;
    const th = Math.tan((cam.fov * Math.PI / 180) / 2);
    const hits = new Map();
    let sky = 0, seeThrough = 0, noProxy = 0;
    const holes = [];
    for (let py = 0; py < NY; py++) for (let px = 0; px < NX; px++) {
      const lx = (((px + 0.5) / NX) * 2 - 1) * th * cam.aspect;
      const ly = (1 - ((py + 0.5) / NY) * 2) * th;
      const dx = inv[0] * lx + inv[4] * ly + inv[8] * -1;
      const dy = inv[1] * lx + inv[5] * ly + inv[9] * -1;
      const dz = inv[2] * lx + inv[6] * ly + inv[10] * -1;
      const L = Math.hypot(dx, dy, dz); const ux = dx / L, uy = dy / L, uz = dz / L;
      let best = Infinity, bi = -1, backface = false;
      for (let t = 0; t < owner.length; t++) {
        const o = t * 9;
        const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
        const e1x = tris[o + 3] - ax, e1y = tris[o + 4] - ay, e1z = tris[o + 5] - az;
        const e2x = tris[o + 6] - ax, e2y = tris[o + 7] - ay, e2z = tris[o + 8] - az;
        const hx = uy * e2z - uz * e2y, hy = uz * e2x - ux * e2z, hz = ux * e2y - uy * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-9) continue;
        const f = 1 / det;
        const sx = cam.position.x - ax, sy = cam.position.y - ay, sz2 = cam.position.z - az;
        const u = f * (sx * hx + sy * hy + sz2 * hz);
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz2 * e1y, qy = sz2 * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const vv = f * (ux * qx + uy * qy + uz * qz);
        if (vv < 0 || u + vv > 1) continue;
        const tt = f * (e2x * qx + e2y * qy + e2z * qz);
        if (tt > 0.05 && tt < best) { best = tt; bi = t; backface = det > 0; }
      }
      // …and what a bullet meets on the same ray
      const sh = ph.raycast(cam.position.x, cam.position.y, cam.position.z, ux, uy, uz, 90, ph.MASK.WORLD);
      const sd = sh?.hit ? sh.distance ?? Math.hypot(sh.point.x - cam.position.x, sh.point.y - cam.position.y, sh.point.z - cam.position.z) : Infinity;
      if (bi < 0) {
        sky++;
        if (isFinite(sd)) { seeThrough++; if (holes.length < 12) holes.push({ px, py, solidAt: +sd.toFixed(1), tag: sh.tag ?? '?' }); }
        continue;
      }
      const nm = names[owner[bi]];
      let r = hits.get(nm); if (!r) hits.set(nm, (r = { n: 0, near: 1e9, back: 0, side: sides[owner[bi]], noProxy: 0 }));
      r.n++; if (best < r.near) r.near = best; if (backface) r.back++;
      if (!isFinite(sd) || sd > best + 0.6) { r.noProxy++; noProxy++; }
    }
    const total = NX * NY;
    return {
      cam: [+cam.position.x.toFixed(1), +cam.position.y.toFixed(2), +cam.position.z.toFixed(1)],
      yaw: +cam.rotation.y.toFixed(3), pitch: +cam.rotation.x.toFixed(3),
      skyPct: +(100 * sky / total).toFixed(1),
      seeThroughPct: +(100 * seeThrough / total).toFixed(1),
      noProxyPct: +(100 * noProxy / total).toFixed(1),
      holes,
      list: [...hits.entries()].map(([n, r]) => ({ name: n, pct: +(100 * r.n / total).toFixed(1), near: +r.near.toFixed(1), backPct: +(100 * r.back / r.n).toFixed(0), side: r.side, noProxyPct: +(100 * r.noProxy / r.n).toFixed(0) })).sort((a, c) => c.pct - a.pct).slice(0, 10),
    };
  }, pose);
  await frames(20);
  await p.screenshot({ path: `${OUT}/${pose.tag}.png` });
  console.log(`\n${pose.tag}  eye ${res.cam} yaw ${res.yaw}   sky ${res.skyPct} %   SEE-THROUGH (sky but solid) ${res.seeThroughPct} %   drawn-but-no-proxy ${res.noProxyPct} %`);
  for (const r of res.list) console.log(`    ${String(r.pct).padStart(5)} %  ${r.name.padEnd(34)} near ${r.near} m  side ${r.side}  back ${r.backPct} %  noproxy ${r.noProxyPct} %`);
  if (res.holes.length) console.log(`    holes e.g. ${res.holes.slice(0, 6).map((h) => `[${h.px},${h.py}] solid at ${h.solidAt} m`).join('  ')}`);
}
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '\n0 pageerrors');
await b.close();
