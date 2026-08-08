/**
 * A COLUMN OF THE WORLD — every drawable triangle in a plan box, by height band.
 *
 *   node _nfcolumn.mjs --box=10,-4,26,11 [--band=2]
 *
 * Written to answer one question about the slab the trench sees: the deck at
 * y 43.5 over (17, 3) has barrels standing on it, so something built it — but is
 * there anything UNDER it, or is it a platform hung in the air?
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4616/?map=plains&capture=1';
const BOX = (args.box ?? '10,-4,26,11').split(',').map(Number);
const BAND = Number(args.band ?? 2);
const OUT = args.out ?? 'shots/column';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const lvl = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
console.log('level.id =', lvl);
if (lvl !== 'plains') { console.error('WRONG MAP'); await b.close(); process.exit(2); }

const res = await p.evaluate(([BOX, BAND]) => {
  const e = window.__ENGINE__;
  const chain = (o) => { const s = []; let c = o; while (c) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };
  const world = e.scene.children.find((c) => c.name === 'world');
  world.updateMatrixWorld(true);
  const [X0, Z0, X1, Z1] = BOX;
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
  const bands = new Map();
  const collect = (obj, el, label) => {
    const g = obj.geometry; const pa = g?.getAttribute('position'); if (!pa) return;
    if (!g.boundingBox) g.computeBoundingBox();
    const idx = g.getIndex(); const n = idx ? idx.count : pa.count;
    for (let i = 0; i < n; i += 3) {
      const a = idx ? idx.getX(i) : i, b2 = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      xf(el, pa.getX(a), pa.getY(a), pa.getZ(a)); const ax = P.x, ay = P.y, az = P.z;
      xf(el, pa.getX(b2), pa.getY(b2), pa.getZ(b2)); const bx = P.x, by = P.y, bz = P.z;
      xf(el, pa.getX(c), pa.getY(c), pa.getZ(c)); const cx = P.x, cy = P.y, cz = P.z;
      const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3, my = (ay + by + cy) / 3;
      if (mx < X0 || mx > X1 || mz < Z0 || mz > Z1) continue;
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const wx = cx - ax, wy = cy - ay, wz = cz - az;
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const A = 0.5 * Math.hypot(nx, ny, nz);
      const k = `${label}|${Math.floor(my / BAND)}`;
      let r = bands.get(k);
      if (!r) bands.set(k, (r = { label, band: Math.floor(my / BAND) * BAND, n: 0, A: 0, down: 0, up: 0, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 }));
      r.n++; r.A += A;
      const nyn = ny / (2 * A || 1);
      if (nyn < -0.5) r.down += A; else if (nyn > 0.5) r.up += A;
      r.x0 = Math.min(r.x0, ax, bx, cx); r.x1 = Math.max(r.x1, ax, bx, cx);
      r.z0 = Math.min(r.z0, az, bz, cz); r.z1 = Math.max(r.z1, az, bz, cz);
    }
  };
  world.traverse((o) => {
    if (!o.visible) return;
    if (o.isInstancedMesh) {
      const el = new Array(16); const im = o.instanceMatrix.array;
      for (let i = 0; i < o.count; i++) collect(o, mul(o.matrixWorld.elements, im.slice(i * 16, i * 16 + 16), el), chain(o));
    } else if (o.isMesh) collect(o, o.matrixWorld.elements, chain(o));
  });
  return [...bands.values()].sort((a, c) => c.band - a.band || c.A - a.A).map((r) => ({
    y: r.band, label: r.label.split('/').pop(), tris: r.n, m2: +r.A.toFixed(1),
    down: +r.down.toFixed(1), up: +r.up.toFixed(1),
    x: [+r.x0.toFixed(1), +r.x1.toFixed(1)], z: [+r.z0.toFixed(1), +r.z1.toFixed(1)],
  }));
}, [BOX, BAND]);

console.log(`\nbox x ${BOX[0]}..${BOX[2]}  z ${BOX[1]}..${BOX[3]}  band ${BAND} m\n`);
let last = null;
for (const r of res) {
  if (r.y !== last) { console.log(`  ── y ${r.y}..${r.y + BAND}`); last = r.y; }
  console.log(`       ${String(r.m2).padStart(8)} m² (down ${String(r.down).padStart(6)} up ${String(r.up).padStart(6)})  ${String(r.tris).padStart(6)} tri  x ${r.x[0]}..${r.x[1]} z ${r.z[0]}..${r.z[1]}  ${r.label}`);
}
writeFileSync(`${OUT}/column_${BOX.join('_')}.json`, JSON.stringify(res, null, 1));
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '\n0 pageerrors');
await b.close();
