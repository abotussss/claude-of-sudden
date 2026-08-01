/** From a roof cell, does A* actually return a route to the ground? */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', (e) => console.log('  PAGEERROR', e.message));
await p.goto(args.url ?? 'http://127.0.0.1:4355/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const r = await p.evaluate(() => {
  const T = window.__ENGINE__.ctx.peek('ai');
  const g = T.grid;
  const THREE = window.__ENGINE__.THREE ?? null;
  const mk = (x, y, z) => ({ x, y, z });
  const per = new Map();
  for (let i = 0; i < g.flags.length; i++) {
    if (!g.flags[i] || !(g.floor[i] > 4.0)) continue;
    const c = g.comp[i];
    if (g.escape[c] < 0) continue;
    let e = per.get(c);
    if (!e) per.set(c, (e = { c, cells: [] }));
    e.cells.push(i);
  }
  const roofs = [...per.values()].sort((a, c) => c.cells.length - a.cells.length).slice(0, 6);
  const out = [];
  const path = [];
  for (const r of roofs) {
    const i = r.cells[(r.cells.length / 2) | 0];
    const from = mk(g.worldX(i % g.nx), g.floor[i], g.worldZ((i / g.nx) | 0));
    // a destination on the ground: the biggest component's centroid-ish cell
    let goalCell = -1;
    for (let k = 0; k < g.flags.length; k += 37) {
      if (g.flags[k] && g.comp[k] === g.escape[r.c] && g.floor[k] < 2.0) { goalCell = k; break; }
    }
    const to = mk(g.worldX(goalCell % g.nx), g.floor[goalCell], g.worldZ((goalCell / g.nx) | 0));
    const n = g.findPath(from, to, path, {});
    // how many drop bits does his own component actually carry
    let dropCells = 0;
    for (const c of r.cells) if (g.drop[c]) dropCells++;
    out.push({
      comp: r.c, cells: r.cells.length, roofY: +from.y.toFixed(1), escape: g.escape[r.c],
      dropCells, waypoints: n,
      firstWps: path.slice(0, Math.min(n, 5)).map((v) => `${v.x.toFixed(0)},${v.y.toFixed(1)},${v.z.toFixed(0)}`),
      dist: +Math.hypot(to.x - from.x, to.z - from.z).toFixed(0),
    });
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await b.close();
