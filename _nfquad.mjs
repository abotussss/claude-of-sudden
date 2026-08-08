/**
 * THE ONE NUMBER A BISECT CAN BE RUN AGAINST: how much of NACHTFELD is in the
 * SAME nav component as the ground, measured at boot and nothing else.
 *
 *   node _nfquad.mjs [--url=…] [--top=6]
 *
 * `_nfcomp.mjs` waits for the match to go live and prints the demolition table
 * with it; that is the right probe for a destroyed state and the wrong one for
 * `git bisect run`, where every second of boot is paid ~10 times and the answer
 * wanted is a single integer on stdout. This reads `NavGrid` the moment
 * `__READY__` flips — the grid is built in `AISystem._buildNav` during boot, so
 * the labels are already final — and prints:
 *
 *   QUAD walkable=… comps=… biggest=… stranded=…
 *
 * plus the `--top` largest components that are NOT the ground one, with extent
 * and floor range, because "52 k stranded" and "four 13 k arcs of mountain at
 * 15..64 m" are different bug reports and only the second one can be fixed.
 *
 * It also echoes `world.level.id`: several probes in this tree carried a
 * `split('=')` that truncated `?map=plains&…` and silently measured the town.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4615/?map=plains';
const TOP = Number(args.top ?? 6);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const r = await p.evaluate((top) => {
  const g = window.__ENGINE__.ctx.peek('ai').grid;
  g._label();
  const big = g.compSize.indexOf(g.biggestComponent);
  const by = new Map();
  let walk = 0, high = 0;
  for (let i = 0; i < g.flags.length; i++) {
    if (!g.flags[i]) continue;
    walk++;
    if (g.floor[i] > 2.5) high++;
    const c = g.comp[i];
    if (c === big) continue;
    const x = g.minX + (i % g.nx) * g.cell;
    const z = g.minZ + ((i / g.nx) | 0) * g.cell;
    const y = g.floor[i];
    let e = by.get(c);
    if (!e) by.set(c, (e = { n: 0, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, y0: 1e9, y1: -1e9 }));
    e.n++;
    if (x < e.x0) e.x0 = x; if (x > e.x1) e.x1 = x;
    if (z < e.z0) e.z0 = z; if (z > e.z1) e.z1 = z;
    if (y < e.y0) e.y0 = y; if (y > e.y1) e.y1 = y;
    if (Math.hypot(x, z) < 176) e.inside = (e.inside ?? 0) + 1;
  }
  /**
   * …AND WHERE THE STRANDED CELLS ARE RADIALLY, which is the whole question on
   * this map. `plainsOpen` refuses everything past r 176 (`RIDGE_R0 - margin`)
   * and the rim rock stands from 174.6 to ~183, so a stranded cell at r 190 is
   * mountain nobody may stand on and a stranded cell at r 120 is a hole in the
   * middle of the battle. Counting them together is what let "a quarter of the
   * plain is unreachable" and "the back of the mountain is not ground" be the
   * same sentence.
   */
  const rings = { in176: 0, r176_186: 0, out186: 0 };
  const bigC = big;
  for (let i = 0; i < g.flags.length; i++) {
    if (!g.flags[i] || g.comp[i] === bigC) continue;
    const x = g.minX + (i % g.nx) * g.cell;
    const z = g.minZ + ((i / g.nx) | 0) * g.cell;
    const rr = Math.hypot(x, z);
    if (rr < 176) rings.in176++;
    else if (rr < 186) rings.r176_186++;
    else rings.out186++;
  }
  return {
    id: window.__ENGINE__.ctx.peek('world').level?.id ?? '?',
    walk, high, comps: g.components, big: g.biggestComponent, stranded: walk - g.biggestComponent,
    rings,
    out: [...by.values()].sort((a, b) => b.n - a.n).slice(0, top),
    inside: [...by.values()].filter((e) => (e.inside ?? 0) > 0)
      .sort((a, b) => (b.inside ?? 0) - (a.inside ?? 0)).slice(0, 14),
  };
}, TOP);

console.log(`  level=${r.id}  ${URL}`);
console.log(`QUAD walkable=${r.walk} comps=${r.comps} biggest=${r.big} stranded=${r.stranded} above2.5=${r.high}`);
console.log(`RING stranded inside r176 (playable) = ${r.rings.in176}   r176..186 (rim rock) = ${r.rings.r176_186}   past r186 (mountain) = ${r.rings.out186}`);
for (const e of r.out) {
  console.log(
    `    ${String(e.n).padStart(7)}   x ${e.x0.toFixed(0).padStart(5)}..${e.x1.toFixed(0).padEnd(5)}` +
      `   z ${e.z0.toFixed(0).padStart(5)}..${e.z1.toFixed(0).padEnd(5)}   y ${e.y0.toFixed(1)}..${e.y1.toFixed(1)}`
  );
}
console.log('  stranded components with cells INSIDE the playable disc:');
for (const e of r.inside) {
  console.log(
    `    ${String(e.inside).padStart(5)}/${String(e.n).padEnd(6)} x ${e.x0.toFixed(0).padStart(5)}..${e.x1.toFixed(0).padEnd(5)}` +
      `   z ${e.z0.toFixed(0).padStart(5)}..${e.z1.toFixed(0).padEnd(5)}   y ${e.y0.toFixed(1)}..${e.y1.toFixed(1)}`
  );
}
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '0 pageerrors');
await b.close();
process.exit(r.stranded > 20000 ? 1 : 0);
