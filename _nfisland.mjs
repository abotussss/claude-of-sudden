/**
 * WHICH PIECES ARE MAKING NAV ISLANDS, AND HOW MANY CELLS EACH?
 *
 *   node _nfisland.mjs [--url=…] [--list=N]
 *
 * NACHTFELD's design rule is that every AI-walkable surface stays in ONE
 * component with the ground — the plain was built as the reaction to the town's
 * 36 820 walkable-but-unreachable roof cells in 2 113 components. `_nfcomp.mjs`
 * says whether that rule is holding; it does not say WHAT broke it, and "17
 * berms and 33 wrecks" is a guess, not an attribution.
 *
 * So this labels the grid, takes every walkable cell that is NOT in the biggest
 * component, and buckets it by the nearest cover station out of `?covertag` —
 * which is the only statement of where the solver actually put things. Each
 * bucket also reports the height over the analytic plain, because that is what
 * says whether a bucket is a wall top, a vehicle deck or a pocket of ground.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4604/?map=plains';
const LIST = Number(args.list ?? 14);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
const sites = [];
p.on('console', (m) => {
  const t = m.text();
  const i = t.indexOf('nachtfeld cover sites:');
  if (i < 0) return;
  for (const tok of t.slice(i + 22).trim().split(/\s+/)) {
    const mm = /^(\w+)@(-?\d+),(-?\d+)$/.exec(tok);
    if (mm) sites.push({ kind: mm[1], x: +mm[2], z: +mm[3] });
  }
});
await p.goto(URL.includes('covertag') ? URL : `${URL}&covertag`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log(`sites=${sites.length}`);

const out = await p.evaluate((sites) => {
  const e = window.__ENGINE__;
  const g = e.ctx.peek('ai').grid;
  const w = e.ctx.peek('world');
  g._label();
  const big = g.compSize.indexOf(g.biggestComponent);
  const by = new Map();
  let total = 0, far = 0;
  const hist = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < g.flags.length; i++) {
    if (!g.flags[i] || g.comp[i] === big) continue;
    total++;
    const ix = i % g.nx, iz = (i - ix) / g.nx;
    const x = g.worldX(ix), z = g.worldZ(iz);
    const over = g.floor[i] - (w.groundHeight ? w.groundHeight(x, z) : 0);
    hist[Math.max(0, Math.min(5, Math.floor(over)))]++;
    let best = null, bd = Infinity;
    for (const s of sites) {
      const d = (x - s.x) ** 2 + (z - s.z) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    // 14 m is wider than any single piece; past it the cell is nobody's
    if (!best || bd > 14 * 14) { far++; continue; }
    const k = best.kind;
    const r = by.get(k) ?? { kind: k, cells: 0, sumOver: 0, maxOver: 0, spots: new Map() };
    r.cells++; r.sumOver += over; r.maxOver = Math.max(r.maxOver, over);
    const key = `${best.x},${best.z}`;
    r.spots.set(key, (r.spots.get(key) ?? 0) + 1);
    by.set(k, r);
  }
  return {
    walkable: g.flags.reduce((a, v) => a + (v ? 1 : 0), 0),
    comps: g.components, biggest: g.biggestComponent, stranded: total, far,
    hist,
    rows: [...by.values()].sort((a, c) => c.cells - a.cells).map((r) => ({
      kind: r.kind, cells: r.cells, avgOver: +(r.sumOver / r.cells).toFixed(2),
      maxOver: +r.maxOver.toFixed(2), pieces: r.spots.size,
      worst: [...r.spots.entries()].sort((a, c) => c[1] - a[1]).slice(0, 4)
        .map(([k, v]) => `${k}(${v})`).join(' '),
    })),
  };
}, sites);

console.log(`\n walkable ${out.walkable}  comps ${out.comps}  biggest ${out.biggest}  STRANDED ${out.stranded}  (${out.far} not near any station)`);
console.log('\n height of stranded cells over the analytic plain:');
out.hist.forEach((n, i) => console.log(`   ${i}-${i + 1} m${i === 5 ? '+' : ' '}  ${String(n).padStart(5)}`));
console.log('\n kind        cells  pieces   avg over   max over   worst pieces');
for (const r of out.rows) {
  console.log(`  ${r.kind.padEnd(10)}${String(r.cells).padStart(6)}${String(r.pieces).padStart(8)}` +
    `${String(r.avgOver).padStart(11)}${String(r.maxOver).padStart(11)}   ${r.worst}`);
}
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs[0]}` : '[pageerror] none');
await b.close();
