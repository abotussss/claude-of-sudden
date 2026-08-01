/**
 * WHAT ACTUALLY STOPS THE TANK, AND WHAT IS THE MASS IT MEETS.
 *
 * Re-runs `Armour._bakePath`'s probe loop along the FULL authored polyline (it
 * does not stop at the first pinch), and at every sample characterises the mass
 * on each side and dead ahead:
 *
 *   - span      the free width at hull height, the number the baker trims on
 *   - depth     how far the solid mass ahead extends along the travel direction
 *               (marched with `raycast` until it finds open air on the far side)
 *   - top       how high that mass goes, found by a downward ray from above
 *
 * Those three are what a "small enough to plough" rule has to be derived from.
 *
 * Usage: node _ploughprobe.mjs [url] [seed]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4290/';
const SEED = process.argv[3] ?? '';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
const q = `?capture=1${SEED ? `&seed=${SEED}` : ''}`;
await page.goto(`${URL}${q}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const SCALE = 1.5;
  const L = (x, z) => [x * SCALE, z * SCALE];
  const ROUTES = [
    { id: 'RED', points: [L(8, 56), L(7, 46), L(5, 36), L(2.5, 28), L(1, 20), L(0.5, 15)] },
    { id: 'BLUE', points: [L(-8, -56), L(-7, -46), L(-5, -36), L(-2.5, -28), L(-1, -22), L(-0.5, -17)] },
  ];
  const HULL_W = 3.3, CLEARANCE = 1.1, LATERAL_MAX = 3.0, STEP = 1.25;
  const need = HULL_W + CLEARANCE;
  const MASK = phys.MASK.WORLD;
  const clamp = (v, a, c) => (v < a ? a : v > c ? c : v);

  /** March forward through solid mass; return how deep it goes (metres). */
  const solidDepth = (x, y, z, dx, dz, limit) => {
    const o = new V3(), d = new V3(dx, 0, dz).normalize();
    let travelled = 0, depth = 0, guard = 0;
    // walk to the first hit, then keep stepping while we are still inside mass
    while (travelled < limit && guard++ < 60) {
      o.set(x + d.x * travelled, y, z + d.z * travelled);
      const h = phys.raycast(o, d, limit - travelled, MASK);
      if (!h?.hit) break;
      const enter = travelled + h.distance;
      // step 0.25 m past the entry face and ask whether we are still in mass:
      // fire BACKWARD from a point ahead to find the exit face.
      let exit = enter;
      let probe = enter + 0.25;
      let g2 = 0;
      while (probe < limit && g2++ < 60) {
        o.set(x + d.x * probe, y, z + d.z * probe);
        const back = phys.raycast(o, new V3(-d.x, 0, -d.z), probe - enter + 0.05, MASK);
        if (back?.hit) { exit = probe - back.distance; break; }
        probe += 0.25;
      }
      if (exit <= enter) exit = enter + 0.05;
      depth = exit - enter;
      return { enter, depth };
    }
    return null;
  };

  const res = [];
  for (const spec of ROUTES) {
    const pts = spec.points.map((p) => w.levelToWorld(p[0], 0, p[1], new V3()));
    const rx = [], rz = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const seg = Math.hypot(c.x - a.x, c.z - a.z);
      const n = Math.max(1, Math.round(seg / STEP));
      for (let k = 0; k < n; k++) { const t = k / n; rx.push(a.x + (c.x - a.x) * t); rz.push(a.z + (c.z - a.z) * t); }
    }
    rx.push(pts[pts.length - 1].x); rz.push(pts[pts.length - 1].z);

    const samples = [];
    let trimmedAt = -1;
    const probe = new V3(), side = new V3();
    for (let i = 0; i < rx.length; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(rx.length - 1, i + 1);
      let dx = rx[i1] - rx[i0], dz = rz[i1] - rz[i0];
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      side.set(dz, 0, -dx);
      let x = rx[i], z = rz[i];
      const y0 = phys.groundHeight(x, z, 30);
      if (!Number.isFinite(y0)) { samples.push({ i, noGround: true }); if (trimmedAt < 0) trimmedAt = i; break; }
      probe.set(x, y0 + 1.0, z);
      const R = phys.raycast(probe, side, 9, MASK); side.multiplyScalar(-1);
      const Lh = phys.raycast(probe, side, 9, MASK); side.multiplyScalar(-1);
      const dR = R?.hit ? R.distance : 9, dL = Lh?.hit ? Lh.distance : 9;
      const shift = clamp((dR - dL) * 0.5, -LATERAL_MAX, LATERAL_MAX);
      x += side.x * shift; z += side.z * shift;
      const span = dR + dL;
      const y = Number.isFinite(phys.groundHeight(x, z, 30)) ? phys.groundHeight(x, z, 30) : y0;

      const s = { i, x: +x.toFixed(1), z: +z.toFixed(1), span: +span.toFixed(2) };
      if (span < need) {
        if (trimmedAt < 0) trimmedAt = i;
        // characterise BOTH walls of the pinch and what is dead ahead
        const sides = [];
        for (const sgn of [1, -1]) {
          side.set(dz * sgn, 0, -dx * sgn);
          const o = new V3(x, y + 1.0, z);
          const h = phys.raycast(o, side, 9, MASK);
          if (!h?.hit) { sides.push(null); continue; }
          const hx = o.x + side.x * h.distance, hz = o.z + side.z * h.distance;
          // how high does this mass go? downward ray from 40 m over the hit
          const topH = phys.raycast(new V3(hx + side.x * 0.3, y + 40, hz + side.z * 0.3), new V3(0, -1, 0), 60, MASK);
          const top = topH?.hit ? y + 40 - topH.distance - y : null;
          const dep = solidDepth(x, y + 1.0, z, side.x, side.z, 40);
          sides.push({
            dist: +h.distance.toFixed(2),
            surface: h.surface ?? h.surfaceType ?? null,
            top: top == null ? null : +top.toFixed(2),
            depth: dep ? +dep.depth.toFixed(2) : null,
          });
        }
        // dead ahead
        const ah = solidDepth(x, y + 1.0, z, dx, dz, 60);
        let aheadTop = null;
        if (ah) {
          const ax = x + dx * (ah.enter + 0.2), az = z + dz * (ah.enter + 0.2);
          const th = phys.raycast(new V3(ax, y + 40, az), new V3(0, -1, 0), 60, MASK);
          if (th?.hit) aheadTop = +(y + 40 - th.distance - y).toFixed(2);
        }
        s.pinch = { right: sides[0], left: sides[1], ahead: ah ? { enter: +ah.enter.toFixed(2), depth: +ah.depth.toFixed(2), top: aheadTop } : null };
      }
      samples.push(s);
    }
    res.push({ id: spec.id, n: rx.length, trimmedAt, samples });
  }

  /* ---- how are the props represented in the scene? ---- */
  const meshes = [];
  e.ctx.scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const g = o.geometry;
    meshes.push({
      name: o.name, instanced: !!o.isInstancedMesh, count: o.count ?? 1,
      tris: g?.index ? g.index.count / 3 : (g?.attributes?.position?.count ?? 0) / 3,
      visible: o.visible,
    });
  });
  meshes.sort((a, c) => c.tris - a.tris);
  return {
    routes: res,
    levelSeed: e.levelSeed ?? e.ctx?.config?.levelSeed ?? null,
    meshTop: meshes.slice(0, 28),
    meshCount: meshes.length,
    hasSetPieces: !!w.layout?.SET_PIECES,
    setPieceKeys: w.layout?.SET_PIECES ? Object.keys(w.layout.SET_PIECES) : [],
    demolitions: (w.demolitions ?? []).map((d) => d.id),
  };
});

console.log('levelSeed', out.levelSeed, '| meshes', out.meshCount);
console.log('SET_PIECES keys:', out.setPieceKeys.join(', '));
console.log('demolitions:', out.demolitions.join(', '));
for (const r of out.routes) {
  console.log(`\n=== ${r.id} — ${r.n} samples along the authored polyline, baker trims at ${r.trimmedAt < 0 ? 'nothing (full route)' : r.trimmedAt}`);
  for (const s of r.samples) {
    if (s.noGround) { console.log(`  ${s.i}: NO GROUND`); continue; }
    const flag = s.pinch ? '  <== PINCH' : '';
    console.log(`  ${String(s.i).padStart(3)} (${String(s.x).padStart(7)},${String(s.z).padStart(7)}) span ${String(s.span).padStart(6)}${flag}`);
    if (s.pinch) {
      const f = (o, n) => o ? `${n}: d=${o.dist} top=${o.top} depth=${o.depth} surf=${o.surface}` : `${n}: open`;
      console.log(`        ${f(s.pinch.right, 'R')}`);
      console.log(`        ${f(s.pinch.left, 'L')}`);
      console.log(`        ahead: ${s.pinch.ahead ? `enter=${s.pinch.ahead.enter} depth=${s.pinch.ahead.depth} top=${s.pinch.ahead.top}` : 'open'}`);
    }
  }
}
console.log('\n--- biggest meshes in the scene ---');
for (const m of out.meshTop) console.log(`  ${String(Math.round(m.tris)).padStart(7)} tris  ${m.instanced ? `INST x${m.count}` : 'mesh'}  ${m.name}`);
if (errs.length) console.log('\nPAGEERRORS:', errs);
await b.close();
