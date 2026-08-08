/**
 * EVERY MASS ON THIS MAP THAT NOTHING HOLDS UP.
 *
 *   node _nffloating.mjs [--gap=6] [--url=…]
 *
 * 「天井みたいな意味のわからないグラフィックは平原の至る所ね」
 *
 * The slab a man in the trench at (-14, -2) sees over his head is a 7.5 x 6 m
 * concrete deck at y 43.5 with oil drums standing on it and, between y 4 and
 * y 40, NOTHING. From the floor of a cut it is a black rectangle in the sky with
 * no building under it — which is exactly a ceiling that cannot be explained.
 *
 * So the question is not "what is that one" but "how many". This bins every
 * world triangle into 2 m plan cells and 1 m height bins, walks each column down
 * from the top, and reports every mass whose underside stands more than `--gap`
 * metres clear of the next thing below it — the ground included.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4616/?map=plains&capture=1';
const GAP = Number(args.gap ?? 6);
const R = Number(args.r ?? 178);
const OUT = args.out ?? 'shots/floating';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const lvl = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
console.log('level.id =', lvl);
if (lvl !== 'plains') { console.error('WRONG MAP'); await b.close(); process.exit(2); }

const res = await p.evaluate(([GAP, R]) => {
  const e = window.__ENGINE__;
  const chain = (o) => { const s = []; let c = o; while (c) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };
  const world = e.scene.children.find((c) => c.name === 'world');
  const groundY = e.ctx.peek('world').level.groundY;
  world.updateMatrixWorld(true);

  const CELL = 2, YMAX = 90;
  const NX = Math.ceil((R * 2) / CELL);
  const col = new Map();            // cell -> { bins:Uint8Array, labels:Map }
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
  const cellOf = (x, z) => {
    const i = Math.floor((x + R) / CELL), j = Math.floor((z + R) / CELL);
    return i < 0 || j < 0 || i >= NX || j >= NX ? -1 : j * NX + i;
  };
  const collect = (obj, el, label) => {
    const g = obj.geometry; const pa = g?.getAttribute('position'); if (!pa) return;
    const idx = g.getIndex(); const n = idx ? idx.count : pa.count;
    for (let i = 0; i < n; i += 3) {
      const a = idx ? idx.getX(i) : i, b2 = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      xf(el, pa.getX(a), pa.getY(a), pa.getZ(a)); const ax = P.x, ay = P.y, az = P.z;
      xf(el, pa.getX(b2), pa.getY(b2), pa.getZ(b2)); const bx = P.x, by = P.y, bz = P.z;
      xf(el, pa.getX(c), pa.getY(c), pa.getZ(c)); const cx = P.x, cy = P.y, cz = P.z;
      const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
      if (mx * mx + mz * mz > R * R) continue;
      const k = cellOf(mx, mz); if (k < 0) continue;
      let r = col.get(k);
      if (!r) col.set(k, (r = { bins: new Uint8Array(YMAX), lab: new Map(), area: new Float32Array(YMAX) }));
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const wx = cx - ax, wy = cy - ay, wz = cz - az;
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const A = 0.5 * Math.hypot(nx, ny, nz);
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const y1 = Math.min(YMAX - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) { r.bins[y] = 1; r.area[y] += A / (y1 - y0 + 1); }
      const lb = Math.floor((ay + by + cy) / 3);
      if (lb >= 0 && lb < YMAX) {
        const key = `${label}@${lb}`;
        r.lab.set(key, (r.lab.get(key) ?? 0) + A);
      }
    }
  };
  world.traverse((o) => {
    if (!o.visible) return;
    if (o.isInstancedMesh) {
      const el = new Array(16); const im = o.instanceMatrix.array;
      for (let i = 0; i < o.count; i++) collect(o, mul(o.matrixWorld.elements, im.slice(i * 16, i * 16 + 16), el), chain(o));
    } else if (o.isMesh) collect(o, o.matrixWorld.elements, chain(o));
  });

  // walk each column: any occupied run whose bottom clears everything below it
  const flags = [];
  for (const [k, r] of col) {
    const i = k % NX, j = Math.floor(k / NX);
    const x = -R + i * CELL + CELL / 2, z = -R + j * CELL + CELL / 2;
    const gy = groundY(x, z);
    let y = YMAX - 1;
    while (y >= 0) {
      if (!r.bins[y]) { y--; continue; }
      let top = y;
      while (y >= 0 && r.bins[y]) y--;
      const bot = y + 1;                       // run is [bot..top]
      let below = y;
      while (below >= 0 && !r.bins[below]) below--;
      const under = below >= 0 ? below : Math.floor(gy);
      const gap = bot - Math.max(under, Math.floor(gy));
      if (gap >= GAP && bot > gy + GAP) {
        let area = 0; const labs = [];
        for (let q = bot; q <= top; q++) area += r.area[q];
        for (const [lk, la] of r.lab) {
          const yy = Number(lk.split('@').pop());
          if (yy >= bot && yy <= top) labs.push([lk.split('/').pop().split('@')[0], +la.toFixed(1)]);
        }
        flags.push({ x, z, bot, top, gap, gy: +gy.toFixed(1), m2: +area.toFixed(1), labs });
      }
    }
  }

  // cluster flagged cells that touch
  const byKey = new Map();
  for (const f of flags) byKey.set(`${f.x},${f.z},${f.bot}`, f);
  const seen = new Set(); const islands = [];
  for (const f of flags) {
    const k0 = `${f.x},${f.z},${f.bot}`;
    if (seen.has(k0)) continue;
    const q = [f]; seen.add(k0);
    const isl = { cells: 0, m2: 0, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, bot: 1e9, top: -1e9, gap: 1e9, gy: f.gy, labs: new Map() };
    while (q.length) {
      const c = q.pop();
      isl.cells++; isl.m2 += c.m2;
      isl.x0 = Math.min(isl.x0, c.x); isl.x1 = Math.max(isl.x1, c.x);
      isl.z0 = Math.min(isl.z0, c.z); isl.z1 = Math.max(isl.z1, c.z);
      isl.bot = Math.min(isl.bot, c.bot); isl.top = Math.max(isl.top, c.top);
      isl.gap = Math.min(isl.gap, c.gap);
      for (const [n, a] of c.labs) isl.labs.set(n, (isl.labs.get(n) ?? 0) + a);
      for (let dx = -2; dx <= 2; dx += 2) for (let dz = -2; dz <= 2; dz += 2) {
        for (let db = -3; db <= 3; db++) {
          const kk = `${c.x + dx},${c.z + dz},${c.bot + db}`;
          if (byKey.has(kk) && !seen.has(kk)) { seen.add(kk); q.push(byKey.get(kk)); }
        }
      }
    }
    isl.labs = [...isl.labs.entries()].sort((a, c) => c[1] - a[1]).slice(0, 6);
    islands.push(isl);
  }
  islands.sort((a, c) => c.m2 - a.m2);
  return { cells: col.size, flagged: flags.length, islands };
}, [GAP, R]);

console.log(`\n${res.cells} occupied plan cells inside r ${R}; ${res.flagged} of them carry a mass with ≥${GAP} m of clear air under it`);
console.log(`${res.islands.length} floating islands\n`);
for (const i of res.islands.slice(0, 40)) {
  console.log(`  ${String(i.m2.toFixed(0)).padStart(7)} m²  ${String(i.cells).padStart(4)} cells  y ${i.bot}–${i.top} (ground ${i.gy}, clear ${i.gap} m)  x ${i.x0}..${i.x1}  z ${i.z0}..${i.z1}`);
  console.log(`            ${i.labs.map(([n, a]) => `${n} ${a}`).join('  ')}`);
}
writeFileSync(`${OUT}/floating_gap${GAP}.json`, JSON.stringify(res, null, 1));
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '\n0 pageerrors');
await b.close();
