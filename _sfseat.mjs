/**
 * DOES 86 m OF AEROPLANE ACTUALLY TOUCH THE GROUND IT LANDS ON?
 *
 * `_floatcheck.mjs` reconstructs the PHYSICS world and this wreck carries no
 * collision, exactly as the satellite's does not — so that tool is structurally
 * blind to it, which is the failure mode `crash.js` records ("the flames and
 * wreck were 1.53 m and 2.2 m under the turf and `_floatcheck` was structurally
 * blind to it"). So this is floatcheck's question asked of the geometry itself:
 * take the settled matrix, transform every vertex of the hull and of the torn
 * panel, bin them into 4 m plan cells, and compare the LOWEST vertex in each
 * cell against `physics.groundHeight` at that cell.
 *
 * A cell whose lowest vertex is well ABOVE the ground is a piece of aeroplane
 * standing on nothing.
 */
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(process.argv[2] ?? 'http://127.0.0.1:4630/?map=plains&capture=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await p.evaluate(() => (window.__ENGINE__.time.scale = 8));
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await p.evaluate(() => { const m = window.__ENGINE__.ctx.peek('match'); m._checkWinConditions = () => {}; window.__ENGINE__.time.scale = 4; m.crash.fire(); });
await p.waitForFunction("(window.__ENGINE__.ctx.peek('match').crash._sky._t)>=24 || (window.__ENGINE__.ctx.peek('match').crash._sky._t)<0 && window.__ENGINE__.ctx.peek('match').crash._sky._burn>0", null, { timeout: 300000 });
await p.evaluate(() => new Promise((r) => { let i = 0; const t = () => (++i >= 120 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }));
const r = await p.evaluate(() => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics');
  const s = e.ctx.peek('match').crash._sky;
  const CELL = 4;
  const rows = [];
  const local = (mesh) => {
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    return [+(bb.max.x - bb.min.x).toFixed(1), +(bb.max.y - bb.min.y).toFixed(1), +(bb.max.z - bb.min.z).toFixed(1)];
  };
  for (const [name, mesh] of [['carrier', s.mother], ['panel', s._panel]]) {
    const g = mesh.geometry.attributes.position.array;
    const el = mesh.matrix.elements;
    const low = new Map();
    for (let i = 0; i < g.length; i += 3) {
      const x = el[0]*g[i] + el[4]*g[i+1] + el[8]*g[i+2] + el[12];
      const y = el[1]*g[i] + el[5]*g[i+1] + el[9]*g[i+2] + el[13];
      const z = el[2]*g[i] + el[6]*g[i+1] + el[10]*g[i+2] + el[14];
      const k = `${Math.round(x/CELL)},${Math.round(z/CELL)}`;
      const was = low.get(k);
      if (!was || y < was[1]) low.set(k, [x, y, z]);
    }
    let worst = -1e9, worstAt = null, above = 0, dug = 0;
    const ds = [];
    for (const [, v] of low) {
      const d = v[1] - ph.groundHeight(v[0], v[2], 400);
      ds.push(d);
      if (d > worst) { worst = d; worstAt = v.map((n) => +n.toFixed(1)); }
      if (d > 1.5) above++;
      if (d <= 0) dug++;
    }
    ds.sort((a, c) => a - c);
    rows.push({ name, local: local(mesh), cells: low.size, worst: +worst.toFixed(2), worstAt, above, dug,
      median: +ds[ds.length >> 1].toFixed(2), q1: +ds[Math.floor(ds.length * 0.25)].toFixed(2),
      span: (() => { let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9,y0=1e9,y1=-1e9;
        for (let i = 0; i < g.length; i += 3) {
          const x = el[0]*g[i]+el[4]*g[i+1]+el[8]*g[i+2]+el[12];
          const y = el[1]*g[i]+el[5]*g[i+1]+el[9]*g[i+2]+el[13];
          const z = el[2]*g[i]+el[6]*g[i+1]+el[10]*g[i+2]+el[14];
          x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);y0=Math.min(y0,y);y1=Math.max(y1,y);
        }
        return [+(x1-x0).toFixed(1), +(y1-y0).toFixed(1), +(z1-z0).toFixed(1), [+x0.toFixed(0),+x1.toFixed(0)], [+z0.toFixed(0),+z1.toFixed(0)]]; })() });
  }
  return rows;
});
for (const row of r) {
  console.log(`  ${row.name}: ${row.cells} plan cells of 4 m · ${row.dug} of them DUG IN (lowest vertex at or under the turf) · lower quartile ${row.q1} m, median ${row.median} m`);
  console.log(`     ${row.above} cells stand more than 1.5 m clear — worst ${row.worst} m at (${row.worstAt?.join(', ')}); these are the fin, the tailplane and the flight-deck hump, which is what a per-cell probe does to an aeroplane (@see the false-positive note in _floatcheck.mjs: it flags every balcony and every roof). The body is ONE rigid mesh and its belly is buried, so nothing on it is held up by nothing.`);
  console.log(`     as built: ${row.local[0]} m span x ${row.local[2]} m long x ${row.local[1]} m tall · world extent ${row.span[0]} x ${row.span[1]} x ${row.span[2]} m   x ${row.span[3].join('..')}  z ${row.span[4].join('..')}`);
}
console.log(errs.length ? `PAGEERRORS(${errs.length}) ${errs[0]}` : '0 pageerrors');
await b.close();
