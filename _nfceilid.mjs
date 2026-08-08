/**
 * NAME THE THING OVER HIS HEAD.
 *
 *   node _nfceilid.mjs [--url=…] [--x=-14] [--z=-2] [--pitch=70] [--out=shots/ceilid]
 *
 * Poses the camera the way `_nfblackwall.mjs` does — through the player, control
 * left ON so the rig actually writes the camera — then fires a grid of rays out
 * through the FRUSTUM and reports, per ray, the nearest scene triangle that a
 * front-face cull would not have thrown away. So the answer is the name of the
 * mesh that owns the pixel, not an argument about what is nearby.
 *
 * Ray direction is built by hand because the page has no THREE global: in camera
 * space a pixel is (ndcX·tan(fov/2)·aspect, ndcY·tan(fov/2), −1), and the world
 * basis is columns 0/1/2 of `camera.matrixWorld`.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4616/?map=plains&capture=1';
const OUT = args.out ?? 'shots/ceilid';
const PITCH = Number(args.pitch ?? 70) * Math.PI / 180;
const YAW = Number(args.yaw ?? 0);
const SPOTS = (args.spots ?? '-14,-2').split(';').map((s) => s.split(',').map(Number));
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const lvl = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
console.log('level.id =', lvl);
if (lvl !== 'plains') { console.error('WRONG MAP'); await b.close(); process.exit(2); }

await p.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
});
const frames = (n) => p.evaluate((k) => new Promise((d) => {
  let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

/** The picker, installed once. */
await p.evaluate(() => {
  const e = window.__ENGINE__;
  const chain = (o) => { const s = []; let c = o; while (c && c.parent) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };

  window.__PICK__ = (rays) => {
    const cam = e.camera;
    cam.updateMatrixWorld(true);
    const m = cam.matrixWorld.elements;
    const ox = m[12], oy = m[13], oz = m[14];
    const tan = Math.tan((cam.fov * Math.PI / 180) / 2);
    const asp = cam.aspect;
    const dirs = rays.map(([nx, ny]) => {
      const cx = nx * tan * asp, cy = ny * tan, cz = -1;
      const dx = m[0] * cx + m[4] * cy + m[8] * cz;
      const dy = m[1] * cx + m[5] * cy + m[9] * cz;
      const dz = m[2] * cx + m[6] * cy + m[10] * cz;
      const L = Math.hypot(dx, dy, dz);
      return [dx / L, dy / L, dz / L];
    });
    const best = dirs.map(() => ({ t: Infinity, name: null, mat: null }));

    const P = { x: 0, y: 0, z: 0 };
    const xf = (el, x, y, z) => {
      P.x = el[0] * x + el[4] * y + el[8] * z + el[12];
      P.y = el[1] * x + el[5] * y + el[9] * z + el[13];
      P.z = el[2] * x + el[6] * y + el[10] * z + el[14];
    };
    const mul = (a, bm, out) => { // out = a * bm (column-major 16)
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * bm[c * 4 + k];
        out[c * 4 + r] = s;
      }
      return out;
    };

    /** Möller–Trumbore, with the front-face cull the GPU would apply. */
    const tri = (ax, ay, az, bx, by, bz, cx, cy, cz, ri, cull) => {
      const d = dirs[ri];
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (cull && det < 1e-9) return -1;          // back face -> culled
      if (Math.abs(det) < 1e-12) return -1;
      const inv = 1 / det;
      const tx = ox - ax, ty = oy - ay, tz = oz - az;
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < -1e-6 || u > 1 + 1e-6) return -1;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
      if (v < -1e-6 || u + v > 1 + 1e-6) return -1;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      return t > 0.05 ? t : -1;
    };

    const scratch = new Array(16);
    const test = (obj, el, geo, label) => {
      const pa = geo.getAttribute('position'); if (!pa) return;
      const idx = geo.getIndex(); const n = idx ? idx.count : pa.count;
      const mm = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      const cull = (mm?.side ?? 0) === 0;
      // cheap reject: sphere around the transformed bounding sphere
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const bs = geo.boundingSphere;
      xf(el, bs.center.x, bs.center.y, bs.center.z);
      const sc = Math.max(
        Math.hypot(el[0], el[1], el[2]), Math.hypot(el[4], el[5], el[6]), Math.hypot(el[8], el[9], el[10])
      );
      const R = bs.radius * sc;
      const cxv = P.x - ox, cyv = P.y - oy, czv = P.z - oz;
      let any = false;
      for (let r = 0; r < dirs.length; r++) {
        const d = dirs[r];
        const proj = cxv * d[0] + cyv * d[1] + czv * d[2];
        const d2 = cxv * cxv + cyv * cyv + czv * czv - proj * proj;
        if (d2 <= R * R && proj > -R && proj - R < best[r].t) { any = true; break; }
      }
      if (!any) return;
      for (let i = 0; i < n; i += 3) {
        const a = idx ? idx.getX(i) : i, b2 = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
        xf(el, pa.getX(a), pa.getY(a), pa.getZ(a)); const ax = P.x, ay = P.y, az = P.z;
        xf(el, pa.getX(b2), pa.getY(b2), pa.getZ(b2)); const bx = P.x, by = P.y, bz = P.z;
        xf(el, pa.getX(c), pa.getY(c), pa.getZ(c)); const cx = P.x, cy = P.y, cz = P.z;
        for (let r = 0; r < dirs.length; r++) {
          const t = tri(ax, ay, az, bx, by, bz, cx, cy, cz, r, cull);
          if (t > 0 && t < best[r].t) {
            best[r].t = t;
            best[r].name = label;
            best[r].mat = {
              type: mm?.type, side: mm?.side, depthWrite: mm?.depthWrite, depthTest: mm?.depthTest,
              transparent: mm?.transparent, opacity: mm?.opacity, ro: obj.renderOrder,
              color: mm?.color ? '#' + mm.color.getHexString() : null,
              emissive: mm?.emissive ? '#' + mm.emissive.getHexString() : null,
              rough: mm?.roughness, metal: mm?.metalness,
              hasMap: !!mm?.map, hasNormal: !!mm?.normalMap, vcol: !!mm?.vertexColors,
              flat: !!mm?.flatShading, fog: mm?.fog,
            };
            best[r].hit = [+(ox + d_(r, 0) * t).toFixed(2), +(oy + d_(r, 1) * t).toFixed(2), +(oz + d_(r, 2) * t).toFixed(2)];
          }
        }
      }
    };
    const d_ = (r, k) => dirs[r][k];

    e.scene.updateMatrixWorld(true);
    e.scene.traverse((o) => {
      if (!o.visible) return;
      if (o.isInstancedMesh) {
        const el = new Array(16);
        const im = o.instanceMatrix.array;
        for (let i = 0; i < o.count; i++) {
          const sub = im.slice(i * 16, i * 16 + 16);
          mul(o.matrixWorld.elements, sub, el);
          test(o, el, o.geometry, `${chain(o)}#${i}`);
        }
      } else if (o.isMesh) {
        test(o, o.matrixWorld.elements, o.geometry, chain(o));
      }
    });
    return best.map((r, i) => ({
      ndc: rays[i], t: r.t === Infinity ? null : +r.t.toFixed(2), name: r.name, mat: r.mat, hit: r.hit,
    }));
  };
});

const place = (x, z, pitch, yaw, stance = 'stand') => p.evaluate(([x, z, pitch, yaw, stance]) => {
  const e = window.__ENGINE__; const ph = e.ctx.peek('physics'); const pl = e.ctx.peek('player');
  const gy = ph.groundHeight(x, z);
  pl.teleport({ x, y: gy + 1.66, z }, { x: pitch, y: yaw });
  pl.movement.stanceWant = stance;
  return +gy.toFixed(2);
}, [x, z, pitch, yaw, stance]);

/* Dense enough that a 100 px slab cannot fall between two rows: at 1280x720 a
 * 65 x 37 lattice is one ray per 20 px. The 17 x 9 first cut missed the very
 * object this probe was written for. */
const GX = Number(args.gx ?? 65), GY = Number(args.gy ?? 37);
const RAYS = [];
for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) RAYS.push([-1 + (2 * i) / (GX - 1), 1 - (2 * j) / (GY - 1)]);

for (const [x, z] of SPOTS) {
  const gy = await place(x, z, PITCH, YAW);
  await frames(30);
  const f = `${OUT}/pick_${x}_${z}.png`;
  await p.screenshot({ path: f });
  const t0 = Date.now();
  const picks = await p.evaluate((r) => window.__PICK__(r), RAYS);
  console.log(`\n=== (${x}, ${z}) floor ${gy}  pitch ${(PITCH * 180 / Math.PI).toFixed(0)}°  (pick ${Date.now() - t0} ms)`);
  const by = new Map();
  for (const q of picks) {
    if (!q.name) continue;
    const k = q.name.replace(/#\d+$/, '');
    let r = by.get(k); if (!r) by.set(k, (r = { n: 0, near: Infinity, mat: q.mat, hit: q.hit, ndc: q.ndc }));
    r.n++; if (q.t < r.near) { r.near = q.t; r.hit = q.hit; r.ndc = q.ndc; }
  }
  const miss = picks.filter((q) => !q.name).length;
  console.log(`  sky ${miss}/${picks.length} rays`);
  for (const [k, r] of [...by.entries()].sort((a, c) => c[1].n - a[1].n)) {
    console.log(`  ${String(r.n).padStart(3)}/${picks.length}  ${k}`);
    console.log(`        nearest ${r.near.toFixed(1)} m at ${JSON.stringify(r.hit)} ndc ${JSON.stringify(r.ndc)}`);
    console.log(`        ${JSON.stringify(r.mat)}`);
  }
  writeFileSync(`${OUT}/pick_${x}_${z}.json`, JSON.stringify(picks, null, 1));
}
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '\n0 pageerrors');
await b.close();
