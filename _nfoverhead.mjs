/**
 * EVERY SURFACE A STANDING MAN SEES OVER HIS HEAD, ANYWHERE ON THE PLAIN.
 *
 *   node _nfoverhead.mjs [--port=4612] [--step=3]
 *
 * The bar is that a player at a standing eye anywhere on this map does not see a
 * surface whose presence he cannot explain, so this is the gate for it. Three
 * things it does that a naive sweep does not:
 *
 *  · THE FLOOR IS THE PHYSICS FLOOR, not `plainsY`. A man in a trench is 1.65 m
 *    below the analytic plain, and every ceiling this map has had was only a
 *    ceiling from down there.
 *  · THE POINT MUST BE STANDABLE. `physics.checkCapsule` at the controller's own
 *    radius and height, so a sample inside a wall does not report the wall's top
 *    as a ceiling.
 *  · ONLY WHAT RASTERISES. At `side: FrontSide` a surface whose front face points
 *    up is a back face from below and is culled; counting it is how a census
 *    misses a fix or invents a bug.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4612'}/?map=plains&capture=1`;
const STEP = Number(args.step ?? 3);
const EYE = Number(args.eye ?? 1.62);

const br = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await br.newPage({ viewport: { width: 900, height: 520 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const lvl = await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
console.log('level =', lvl);
if (lvl !== 'plains') { console.error('WRONG MAP'); await br.close(); process.exit(2); }

const out = await page.evaluate(({ STEP, EYE }) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const plainsY = e.ctx.peek('world').level.groundY;
  const chain = (o) => { const s = []; let c = o; while (c && c.parent) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };

  const R = 182;
  const tris = []; const owner = []; const names = []; const nameId = new Map();
  const idOf = (n) => { let i = nameId.get(n); if (i === undefined) { i = names.length; names.push(n); nameId.set(n, i); } return i; };
  const boxes = [];
  const v = { x: 0, y: 0, z: 0 };
  e.scene.traverse((o) => {
    if (!o.visible) return;
    if (o.isInstancedMesh) {
      const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox; const m = new o.matrixWorld.constructor();
      const cs = []; for (let c = 0; c < 8; c++) cs.push({ x: c & 1 ? bb.max.x : bb.min.x, y: c & 2 ? bb.max.y : bb.min.y, z: c & 4 ? bb.max.z : bb.min.z });
      const nm = chain(o);
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); const el = m.elements;
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, z0 = 1e9, z1 = -1e9;
        for (const c of cs) {
          const X = el[0] * c.x + el[4] * c.y + el[8] * c.z + el[12];
          const Y = el[1] * c.x + el[5] * c.y + el[9] * c.z + el[13];
          const Z = el[2] * c.x + el[6] * c.y + el[10] * c.z + el[14];
          if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y;
          if (Z < z0) z0 = Z; if (Z > z1) z1 = Z;
        }
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        if (cx * cx + cz * cz > R * R) continue;
        if (y0 < plainsY(cx, cz) + EYE + 0.35) continue;
        boxes.push({ n: nm, x0, x1, y0, z0, z1 });
      }
      return;
    }
    if (!o.isMesh) return;
    const g = o.geometry; const pa = g.getAttribute('position'); if (!pa) return;
    const idx = g.getIndex(); const n = idx ? idx.count : pa.count;
    const el = o.matrixWorld.elements; const id = idOf(chain(o));
    const mm = Array.isArray(o.material) ? o.material[0] : o.material;
    const front = (mm?.side ?? 0) === 0;
    const gx = (i) => { const X = pa.getX(i), Y = pa.getY(i), Z = pa.getZ(i);
      v.x = el[0] * X + el[4] * Y + el[8] * Z + el[12];
      v.y = el[1] * X + el[5] * Y + el[9] * Z + el[13];
      v.z = el[2] * X + el[6] * Y + el[10] * Z + el[14]; };
    for (let i = 0; i < n; i += 3) {
      const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      gx(a); const ax = v.x, ay = v.y, az = v.z;
      gx(b); const bx = v.x, by = v.y, bz = v.z;
      gx(c); const cx2 = v.x, cy = v.y, cz2 = v.z;
      const mx = (ax + bx + cx2) / 3, mz = (az + bz + cz2) / 3;
      if (mx * mx + mz * mz > R * R) continue;
      if (Math.max(ay, by, cy) < plainsY(mx, mz) - 3.4) continue;
      if (front && (bz - az) * (cx2 - ax) - (bx - ax) * (cz2 - az) > 0) continue; // culled from below
      tris.push(ax, ay, az, bx, by, bz, cx2, cy, cz2); owner.push(id);
    }
  });

  const CELL = 5;
  const NX = Math.ceil((R * 2) / CELL) + 1;
  const bucket = new Map();
  for (let t = 0; t < owner.length; t++) {
    const o = t * 9;
    const i0 = Math.max(0, Math.floor((Math.min(tris[o], tris[o + 3], tris[o + 6]) + R) / CELL));
    const i1 = Math.min(NX - 1, Math.floor((Math.max(tris[o], tris[o + 3], tris[o + 6]) + R) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(tris[o + 2], tris[o + 5], tris[o + 8]) + R) / CELL));
    const j1 = Math.min(NX - 1, Math.floor((Math.max(tris[o + 2], tris[o + 5], tris[o + 8]) + R) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * NX + i; let arr = bucket.get(k); if (!arr) bucket.set(k, (arr = [])); arr.push(t);
    }
  }
  const shoot = (x, z, y0) => {
    const i = Math.floor((x + R) / CELL), j = Math.floor((z + R) / CELL);
    const arr = bucket.get(j * NX + i);
    let best = Infinity, bt = -1;
    if (arr) for (const t of arr) {
      const o = t * 9;
      const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
      const bx = tris[o + 3], by = tris[o + 4], bz = tris[o + 5];
      const cx = tris[o + 6], cy = tris[o + 7], cz = tris[o + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const y = l1 * ay + l2 * by + l3 * cy;
      if (y <= y0 + 0.05 || y >= best) continue;
      best = y; bt = t;
    }
    let bn = null;
    for (const bx of boxes) {
      if (x < bx.x0 || x > bx.x1 || z < bx.z0 || z > bx.z1) continue;
      if (bx.y0 <= y0 + 0.05 || bx.y0 >= best) continue;
      best = bx.y0; bt = -1; bn = bx.n;
    }
    return bt >= 0 ? { y: best, n: names[owner[bt]] } : bn ? { y: best, n: bn } : null;
  };

  const RAD = 0.35, HGT = 1.75;
  const hits = new Map();
  let samples = 0, covered = 0, blocked = 0;
  for (let x = -176; x <= 176; x += STEP) {
    for (let z = -176; z <= 176; z += STEP) {
      if (x * x + z * z > 176 * 176) continue;
      const gy = ph.groundHeight(x, z);
      if (!isFinite(gy) || gy > plainsY(x, z) + 1.2) { blocked++; continue; }
      if (!ph.checkCapsule({ x, y: gy + RAD + 0.05, z }, { x, y: gy + HGT - RAD, z }, RAD)) { blocked++; continue; }
      samples++;
      const h = shoot(x, z, gy + EYE);
      if (!h) continue;
      covered++;
      let r = hits.get(h.n);
      if (!r) hits.set(h.n, (r = { n: 0, lo: 1e9, hi: -1e9, pts: [] }));
      r.n++;
      const a = h.y - gy;
      if (a < r.lo) r.lo = a; if (a > r.hi) r.hi = a;
      if (r.pts.length < 8) r.pts.push([x, z, +a.toFixed(2)]);
    }
  }
  return {
    samples, covered, blocked, triangles: owner.length, boxes: boxes.length,
    list: [...hits.entries()].map(([n, r]) => ({ name: n, m2: r.n * STEP * STEP, lo: +r.lo.toFixed(2), hi: +r.hi.toFixed(2), pts: r.pts })).sort((a, b) => b.m2 - a.m2),
  };
}, { STEP, EYE });

console.log(`\n${out.triangles} triangles that can rasterise over a head, ${out.boxes} prop instances`);
console.log(`${out.covered} of ${out.samples} standable points at ${STEP} m see a surface overhead — ${(100 * out.covered / out.samples).toFixed(2)} % of the plain\n`);
for (const r of out.list) {
  console.log(`  ${String(r.m2).padStart(6)} m²  ${r.name.padEnd(42)} ${String(r.lo).padStart(6)}–${String(r.hi).padEnd(6)} m up   e.g. ${r.pts.slice(0, 3).map((q) => `[${q[0]},${q[1]}]`).join(' ')}`);
}
writeFileSync('shots/nfoverhead.json', JSON.stringify(out, null, 1));
console.log(errs.length ? `\nPAGEERRORS: ${errs[0]}` : '\n0 pageerrors');
await br.close();
