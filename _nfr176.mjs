/**
 * THE NAV GRID, SPLIT AT THE BOUNDARY — stranded cells and components inside the
 * play disc (r <= RIDGE.r0) against outside it.
 *
 * The plain's 50 000-odd stranded cells are the BACK OF THE MOUNTAIN: outside
 * r 176, no objective, no spawn, nobody ever there. Quoting one total hides the
 * only number that means anything, which is the residue INSIDE the boundary.
 * Run either side of a change and the difference is what the change did.
 *
 *   node _nfr176.mjs [--url=…] [--min=8]
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4617/?map=plains';
const MIN = Number(args.min ?? 8);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const r = await p.evaluate((MIN) => {
  const c = window.__ENGINE__.ctx;
  const g = c.peek('ai').grid, w = c.peek('world');
  const R0 = w.layout.RIDGE?.r0 ?? 176;
  g._label();
  const big = g.compSize.indexOf(g.biggestComponent);
  const by = new Map();
  let walkIn = 0, walkOut = 0, strIn = 0, strOut = 0;
  for (let i = 0; i < g.flags.length; i++) {
    if (!g.flags[i]) continue;
    const cx = i % g.nx, cz = (i / g.nx) | 0;
    const x = g.minX + cx * g.cell, z = g.minZ + cz * g.cell;
    const inside = Math.hypot(x, z) <= R0;
    if (inside) walkIn++; else walkOut++;
    const comp = g.comp[i];
    if (comp === big) continue;
    if (inside) strIn++; else strOut++;
    if (!inside) continue;
    let e = by.get(comp);
    if (!e) by.set(comp, (e = { n: 0, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, y0: 1e9, y1: -1e9 }));
    e.n++;
    if (x < e.x0) e.x0 = x; if (x > e.x1) e.x1 = x;
    if (z < e.z0) e.z0 = z; if (z > e.z1) e.z1 = z;
    const y = g.floor[i];
    if (y < e.y0) e.y0 = y; if (y > e.y1) e.y1 = y;
  }
  const islands = [...by.values()];
  return {
    R0, cell: g.cell, components: g.components, biggest: g.biggestComponent,
    walkIn, walkOut, strIn, strOut,
    insideComponents: islands.length,
    biggestIsland: islands.reduce((a, e) => Math.max(a, e.n), 0),
    out: islands.filter((e) => e.n >= MIN).sort((a, b) => b.n - a.n).slice(0, 16),
  };
}, MIN);

console.log(`\n  NAV GRID at ${r.cell} m — ${r.components} components, biggest ${r.biggest}`);
console.log(`  walkable  inside r${r.R0}: ${r.walkIn}    outside: ${r.walkOut}`);
console.log(`  STRANDED  inside r${r.R0}: ${r.strIn}    outside: ${r.strOut}`);
console.log(`  islands inside the boundary: ${r.insideComponents}, biggest ${r.biggestIsland} cells`);
console.log(`\n  the inside-r${r.R0} islands over ${MIN} cells`);
console.log('      cells      x range          z range          floor y');
for (const e of r.out) {
  console.log(`    ${String(e.n).padStart(7)}   ${e.x0.toFixed(0).padStart(5)}..${e.x1.toFixed(0).padEnd(5)}   ` +
    `${e.z0.toFixed(0).padStart(5)}..${e.z1.toFixed(0).padEnd(5)}   ${e.y0.toFixed(1)}..${e.y1.toFixed(1)}`);
}
if (!r.out.length) console.log(`    (nothing over ${MIN} cells)`);
console.log('\npageerrors', errs.length, errs[0] ?? '');
await b.close();
