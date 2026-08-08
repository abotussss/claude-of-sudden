/**
 * THE BLACK CEILING IN THE TRENCH — reproduce it, then name the mesh.
 *
 *   node _nftrenchceil.mjs [--url=…] [--out=shots/trenchceil]
 *
 * 「塹壕に入ると天井みたいな黒い壁が出てくる そう言うのが至る所にある」
 *
 * Three things in one run, because a photograph without a name is a complaint
 * and a name without a photograph is a guess:
 *
 *  1. FIND THE HOLES. Every point on the plain where the PHYSICS floor stands
 *     more than 0.8 m below the analytic `plainsY` is somewhere the camera drops
 *     below the surrounding ground — trench floors, ramps, sally mouths, the
 *     fortress ditch, the crash's ploughed swathe.
 *  2. CENSUS. From `floor + 1.62` fire one ray straight UP and intersect real
 *     scene triangles. The prefilter is the FLOOR, not `plainsY`, which is the
 *     reason the map-wide sweep could not see this: a soil sheet lying at
 *     `plainsY + 0.015` is under a standing man's eye out on the plain and two
 *     metres over his head once he is in a cut.
 *  3. PHOTOGRAPH, then BISECT. Look straight up in the worst cuts; then hide the
 *     named meshes one at a time and re-shoot, so the surface is identified by
 *     its disappearance rather than by argument.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4612/?map=plains&capture=1';
const OUT = args.out ?? 'shots/trenchceil';
const EYE = Number(args.eye ?? 1.62);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const lvl = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
console.log('level.id =', lvl);
if (lvl !== 'plains') { console.error('WRONG MAP'); await b.close(); process.exit(2); }

// ── 1 & 2: find the cuts and census what is over them ──────────────────────
const census = await p.evaluate((EYE) => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const ph = e.ctx.peek('physics');
  const groundY = w.level.groundY;
  const chain = (o) => { const s = []; let c = o; while (c && c.parent) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };

  // ---- the cuts
  const cuts = [];
  const STEP = 1.0;
  for (let x = -176; x <= 176; x += STEP) {
    for (let z = -176; z <= 176; z += STEP) {
      if (x * x + z * z > 176 * 176) continue;
      const gy = ph.groundHeight(x, z);
      if (!isFinite(gy)) continue;
      const drop = groundY(x, z) - gy;
      if (drop < 0.8) continue;
      // a man must fit
      if (!ph.checkCapsule({ x, y: gy + 0.4, z }, { x, y: gy + 1.4, z }, 0.35)) continue;
      cuts.push([x, z, +gy.toFixed(2), +drop.toFixed(2)]);
    }
  }

  // ---- triangles that could be over a man standing in ANY of them
  let floorMin = 1e9;
  for (const c of cuts) if (c[2] < floorMin) floorMin = c[2];
  const R = 182;
  const tris = []; const owner = []; const names = []; const nameId = new Map();
  const idOf = (n) => { let i = nameId.get(n); if (i === undefined) { i = names.length; names.push(n); nameId.set(n, i); } return i; };
  // a cut floor is at most ~4 m below plainsY; a triangle can be a ceiling if it
  // stands above (plainsY - 4 + eye) anywhere near it
  const v = { x: 0, y: 0, z: 0 };
  e.scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.visible) return;
    const g = o.geometry; const pa = g.getAttribute('position'); if (!pa) return;
    const idx = g.getIndex(); const n = idx ? idx.count : pa.count;
    const el = o.matrixWorld.elements; const id = idOf(chain(o));
    const gx = (i) => { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      v.x = el[0] * x + el[4] * y + el[8] * z + el[12];
      v.y = el[1] * x + el[5] * y + el[9] * z + el[13];
      v.z = el[2] * x + el[6] * y + el[10] * z + el[14]; };
    for (let i = 0; i < n; i += 3) {
      const a = idx ? idx.getX(i) : i, bI = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      gx(a); const ax = v.x, ay = v.y, az = v.z;
      gx(bI); const bx = v.x, by = v.y, bz = v.z;
      gx(c); const cx2 = v.x, cy = v.y, cz2 = v.z;
      const mx = (ax + bx + cx2) / 3, mz = (az + bz + cz2) / 3;
      if (mx * mx + mz * mz > R * R) continue;
      // anything at or above the surrounding plain can be a trench ceiling
      if (Math.max(ay, by, cy) < groundY(mx, mz) - 3.2) continue;
      /**
       * ONLY WHAT ACTUALLY RASTERISES WHEN YOU LOOK UP AT IT. A triangle over
       * the eye is not a ceiling if the GPU throws it away: at `side:FrontSide`
       * a surface whose front face points UP is a BACK face from below and is
       * culled. That distinction is the whole of the fix in `util.js`, so a
       * census that ignores it cannot measure the fix.
       */
      const mm = Array.isArray(o.material) ? o.material[0] : o.material;
      if ((mm?.side ?? 0) === 0) {
        const ux = bx - ax, uz = bz - az;
        const wx = cx2 - ax, wz = cz2 - az;
        if (uz * wx - ux * wz > 0) continue; // front face UP -> culled from below
      }
      tris.push(ax, ay, az, bx, by, bz, cx2, cy, cz2); owner.push(id);
    }
  });

  const CELL = 4;
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
  const key = (x, z) => {
    const i = Math.floor((x + R) / CELL), j = Math.floor((z + R) / CELL);
    return i < 0 || j < 0 || i >= NX || j >= NX ? -1 : j * NX + i;
  };
  const shoot = (x, z, y0) => {
    const arr = bucket.get(key(x, z)); let best = Infinity, bestT = -1;
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
      if (y <= y0 + 0.05) continue;
      if (y < best) { best = y; bestT = t; }
    }
    if (bestT < 0) return null;
    const o = bestT * 9;
    const ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2];
    const wx = tris[o + 6] - tris[o], wy = tris[o + 7] - tris[o + 1], wz = tris[o + 8] - tris[o + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const L = Math.hypot(nx, ny, nz) || 1;
    return { y: best, n: names[owner[bestT]], ny: ny / L };
  };

  const hits = new Map();
  let covered = 0;
  for (const [x, z, gy] of cuts) {
    const h = shoot(x, z, gy + EYE);
    if (!h) continue;
    covered++;
    let r = hits.get(h.n);
    if (!r) hits.set(h.n, (r = { n: 0, pts: [], minA: 1e9, maxA: -1e9 }));
    r.n++;
    const above = h.y - gy;
    if (above < r.minA) r.minA = above;
    if (above > r.maxA) r.maxA = above;
    if (r.pts.length < 60) r.pts.push([x, z, +gy.toFixed(2), +above.toFixed(2)]);
  }
  const list = [...hits.entries()].map(([n, r]) => ({
    name: n, cells: r.n, m2: r.n, minA: +r.minA.toFixed(2), maxA: +r.maxA.toFixed(2), pts: r.pts,
  })).sort((a, b2) => b2.cells - a.cells);
  return { cuts: cuts.length, covered, triangles: owner.length, list, sample: cuts.filter((_, i) => i % Math.max(1, Math.floor(cuts.length / 400)) === 0).slice(0, 400) };
}, EYE);

console.log(`\n${census.cuts} m² of the plain is a CUT the camera drops into (floor ≥0.8 m under plainsY)`);
console.log(`${census.covered} of them (${(100 * census.covered / census.cuts).toFixed(1)} %) have a drawn surface over a standing man's eye\n`);
for (const r of census.list) {
  console.log(`  ${String(r.m2).padStart(6)} m²  ${r.name.padEnd(46)} ${String(r.minA).padStart(6)}–${String(r.maxA).padEnd(6)} m over the floor   e.g. ${r.pts.slice(0, 3).map((q) => `[${q[0]},${q[1]}]`).join(' ')}`);
}
writeFileSync(`${OUT}/census.json`, JSON.stringify(census, null, 1));

// ── 3: photograph, then bisect ─────────────────────────────────────────────
await p.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
});
const frames = (n) => p.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
const place = (x, z, pitch, yaw) => p.evaluate(([x, z, pitch, yaw, EYE]) => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics');
  const gy = ph.groundHeight(x, z);
  e.camera.rotation.order = 'YXZ';
  e.camera.position.set(x, gy + EYE, z);
  e.camera.rotation.set(pitch, yaw, 0);
  e.ctx.peek('player')?.teleport?.(e.camera.position, yaw);
  e.camera.position.set(x, gy + EYE, z);
  e.camera.rotation.set(pitch, yaw, 0);
  return +(gy + EYE).toFixed(2);
}, [x, z, pitch, yaw, EYE]);

// pick the worst few points from the biggest offender, plus the deepest cuts
const spots = [];
for (const r of census.list.slice(0, 3)) for (const q of r.pts.slice(0, 2)) spots.push([q[0], q[1], r.name]);
const seen = new Set();
const SHOTS = [];
for (const [x, z, n] of spots) { const k = `${x},${z}`; if (seen.has(k)) continue; seen.add(k); SHOTS.push([`cut_${x}_${z}`, x, z, n]); }

for (const [id, x, z] of SHOTS) {
  for (const [tag, pitch] of [['up', 1.35], ['fwd', 0.12]]) {
    const y = await place(x, z, pitch, 0.6);
    await frames(40);
    await p.screenshot({ path: `${OUT}/${id}_${tag}.png` });
    console.log(`  · ${id}_${tag}.png  eye y ${y}`);
  }
}

// bisect: hide each named world batch in turn at the worst spot
if (SHOTS.length) {
  const [, bx, bz] = SHOTS[0];
  const cands = census.list.map((r) => r.name);
  for (const nm of cands) {
    await p.evaluate((nm) => {
      const e = window.__ENGINE__; const chain = (o) => { const s = []; let c = o; while (c && c.parent) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };
      e.scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && chain(o) === nm) { o.userData.__wasVis = o.visible; o.visible = false; } });
    }, nm);
    await place(bx, bz, 1.35, 0.6);
    await frames(20);
    await p.screenshot({ path: `${OUT}/bisect_hide_${nm.replace(/[^\w]/g, '_')}.png` });
    await p.evaluate((nm) => {
      const e = window.__ENGINE__; const chain = (o) => { const s = []; let c = o; while (c && c.parent) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };
      e.scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && chain(o) === nm && o.userData.__wasVis !== undefined) { o.visible = o.userData.__wasVis; } });
    }, nm);
    console.log(`  · bisect_hide_${nm.replace(/[^\w]/g, '_')}.png`);
  }
}
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '\n0 pageerrors');
await b.close();
