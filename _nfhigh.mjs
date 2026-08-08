/**
 * WHAT IS UP THERE — every world triangle above a height, clustered.
 *
 *   node _nfhigh.mjs [--y=34] [--url=…]
 *
 * The slab the trench sees is a horizontal face of `world_concrete_dark` at
 * y = 43.5, 52 m down a ray from a man standing at (-14, -2). This walks every
 * drawable under `/world`, keeps the triangles above `--y`, and clusters them in
 * plan so the answer is "this many square metres of this batch, here, at this
 * height", per island — which is what tells a roof that belongs to a building
 * from a slab floating over nothing.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4616/?map=plains&capture=1';
const YMIN = Number(args.y ?? 34);
const OUT = args.out ?? 'shots/high';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const lvl = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
console.log('level.id =', lvl);
if (lvl !== 'plains') { console.error('WRONG MAP'); await b.close(); process.exit(2); }

const res = await p.evaluate((YMIN) => {
  const e = window.__ENGINE__;
  const chain = (o) => { const s = []; let c = o; while (c) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };
  const world = e.scene.children.find((c) => c.name === 'world');
  world.updateMatrixWorld(true);

  const items = [];   // one per contiguous plan cluster
  const P = { x: 0, y: 0, z: 0 };
  const xf = (el, x, y, z) => {
    P.x = el[0] * x + el[4] * y + el[8] * z + el[12];
    P.y = el[1] * x + el[5] * y + el[9] * z + el[13];
    P.z = el[2] * x + el[6] * y + el[10] * z + el[14];
  };
  const mul = (a, bm, out) => {
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * bm[c * 4 + k];
      out[c * 4 + r] = s;
    } return out;
  };

  const collect = (obj, el, label, sink) => {
    const g = obj.geometry; const pa = g?.getAttribute('position'); if (!pa) return;
    const idx = g.getIndex(); const n = idx ? idx.count : pa.count;
    for (let i = 0; i < n; i += 3) {
      const a = idx ? idx.getX(i) : i, b2 = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      xf(el, pa.getX(a), pa.getY(a), pa.getZ(a)); const ax = P.x, ay = P.y, az = P.z;
      if (ay < YMIN) {
        xf(el, pa.getX(b2), pa.getY(b2), pa.getZ(b2));
        if (P.y < YMIN) { xf(el, pa.getX(c), pa.getY(c), pa.getZ(c)); if (P.y < YMIN) continue; }
      }
      xf(el, pa.getX(b2), pa.getY(b2), pa.getZ(b2)); const bx = P.x, by = P.y, bz = P.z;
      xf(el, pa.getX(c), pa.getY(c), pa.getZ(c)); const cx = P.x, cy = P.y, cz = P.z;
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const wx = cx - ax, wy = cy - ay, wz = cz - az;
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const A = 0.5 * Math.hypot(nx, ny, nz);
      sink.push({ label, ax, ay, az, bx, by, bz, cx, cy, cz, A, ny: ny / (2 * A || 1) });
    }
  };

  const tris = [];
  world.traverse((o) => {
    if (!o.visible) return;
    if (o.isInstancedMesh) {
      const el = new Array(16); const im = o.instanceMatrix.array;
      for (let i = 0; i < o.count; i++) collect(o, mul(o.matrixWorld.elements, im.slice(i * 16, i * 16 + 16), el), chain(o), tris);
    } else if (o.isMesh) collect(o, o.matrixWorld.elements, chain(o), tris);
  });

  // cluster in plan, per label, at 6 m
  const CELL = 6;
  const key = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const groups = new Map();
  for (const t of tris) {
    const mx = (t.ax + t.bx + t.cx) / 3, mz = (t.az + t.bz + t.cz) / 3;
    const k = `${t.label}|${key(mx, mz)}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { label: t.label, n: 0, A: 0, downA: 0, minY: 1e9, maxY: -1e9, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 }));
    g.n++; g.A += t.A;
    if (t.ny < -0.5) g.downA += t.A;                       // face pointing DOWN
    g.minY = Math.min(g.minY, t.ay, t.by, t.cy);
    g.maxY = Math.max(g.maxY, t.ay, t.by, t.cy);
    g.x0 = Math.min(g.x0, t.ax, t.bx, t.cx); g.x1 = Math.max(g.x1, t.ax, t.bx, t.cx);
    g.z0 = Math.min(g.z0, t.az, t.bz, t.cz); g.z1 = Math.max(g.z1, t.az, t.bz, t.cz);
  }
  const out = [...groups.values()].map((g) => ({
    label: g.label, tris: g.n, m2: +g.A.toFixed(1), downM2: +g.downA.toFixed(1),
    y: [+g.minY.toFixed(2), +g.maxY.toFixed(2)],
    x: [+g.x0.toFixed(1), +g.x1.toFixed(1)], z: [+g.z0.toFixed(1), +g.z1.toFixed(1)],
  })).sort((a, c) => c.m2 - a.m2);
  return { total: tris.length, groups: out };
}, YMIN);

console.log(`\n${res.total} world triangles reach above y=${YMIN}; ${res.groups.length} plan clusters\n`);
for (const g of res.groups.slice(0, 40)) {
  console.log(`  ${String(g.m2).padStart(8)} m²  (${String(g.downM2).padStart(7)} facing down)  y ${g.y[0]}–${g.y[1]}  x ${g.x[0]}..${g.x[1]}  z ${g.z[0]}..${g.z[1]}  ${g.label}`);
}
writeFileSync(`${OUT}/high_${YMIN}.json`, JSON.stringify(res, null, 1));
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '\n0 pageerrors');
await b.close();
