/**
 * CAN ANYBODY GET UP? — the measurement item 4 turns on.
 *
 * `NavGrid._measureDrops` publishes 25 934 ONE-WAY edges that get a man DOWN.
 * This asks the same graph the other way round: for every drop edge, how far is
 * the RISE, how big is the shelf it leaves, and is the cell it lands on part of
 * the ground the fight is on. A mantle is a bounded move — a soldier puts a hand
 * on a lip and pulls himself up, he does not levitate three metres — so the only
 * question that matters is how much of this map's high ground is within one, two
 * or three bounded mantles of the street.
 *
 * Usage: node _sixclimb.mjs --url=http://127.0.0.1:4450/ --seed=7
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4450/';
const SEED = +(args.seed ?? 7);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
await page.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const r = await page.evaluate(() => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  const g = ai.grid;
  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

  let ground = 0, gn = -1;
  for (let c = 0; c < g.compSize.length; c++) if (g.compSize[c] > gn) { gn = g.compSize[c]; ground = c; }

  // Reverse the drop graph: low component -> { high component -> min rise }
  const up = new Map();          // "lo>hi" -> { rise, count, exampleLo, exampleHi }
  const riseHist = {};
  let edges = 0;
  for (let i = 0; i < g.drop.length; i++) {
    const bits = g.drop[i];
    if (!bits) continue;
    const ix = i % g.nx, iz = (i / g.nx) | 0;
    for (let d = 0; d < 8; d++) {
      if (!(bits & (1 << d))) continue;
      const jx = ix + DX[d], jz = iz + DZ[d];
      if (!g.inside(jx, jz)) continue;
      const j = g.index(jx, jz);
      const rise = g.floor[i] - g.floor[j];
      edges++;
      const b = Math.min(8, Math.floor(rise / 0.5) * 0.5);
      riseHist[b.toFixed(1)] = (riseHist[b.toFixed(1)] ?? 0) + 1;
      const k = g.comp[j] + '>' + g.comp[i];
      const e = up.get(k);
      if (!e || rise < e.rise) up.set(k, { rise: +rise.toFixed(2), lo: j, hi: i, loComp: g.comp[j], hiComp: g.comp[i], n: (e?.n ?? 0) + 1 });
      else e.n++;
    }
  }

  // Which components are worth being on: big enough to walk and fight, and high.
  const compTop = new Float32Array(g.components).fill(-Infinity);
  for (let i = 0; i < g.flags.length; i++) {
    if (!g.flags[i]) continue;
    const c = g.comp[i];
    if (c >= 0 && g.floor[i] > compTop[c]) compTop[c] = g.floor[i];
  }

  const out = { groundComp: ground, groundCells: gn, dropEdgesWalked: edges, riseHistogram: riseHist };

  // BFS over the mantle graph from the ground component, at several ceilings.
  const byLo = new Map();
  for (const e of up.values()) {
    let row = byLo.get(e.loComp);
    if (!row) { row = []; byLo.set(e.loComp, row); }
    row.push(e);
  }
  out.ceilings = {};
  for (const MAX of [1.3, 1.8, 2.2, 2.6, 3.2]) {
    const seen = new Set([ground]);
    const q = [ground];
    const hops = new Map([[ground, 0]]);
    while (q.length) {
      const c = q.shift();
      for (const e of (byLo.get(c) ?? [])) {
        if (e.rise > MAX) continue;
        if (seen.has(e.hiComp)) continue;
        seen.add(e.hiComp); hops.set(e.hiComp, hops.get(c) + 1); q.push(e.hiComp);
      }
    }
    // what did that buy: cells, and cells above 2.5 m, on components of >= 8 cells
    let cells = 0, high = 0, shelves = 0, bigShelves = 0, maxHop = 0;
    for (const c of seen) {
      if (c === ground) continue;
      const n = g.compSize[c];
      cells += n;
      shelves++;
      if (n >= 8 && compTop[c] > 2.5) { bigShelves++; high += n; }
      maxHop = Math.max(maxHop, hops.get(c));
    }
    out.ceilings[MAX] = {
      componentsReached: shelves, cellsReached: cells,
      shelvesOver8CellsAnd2p5m: bigShelves, cellsOnThose: high, maxHops: maxHop,
    };
  }

  // The best individual shelves at a 2.2 m ceiling, described.
  const MAX = 2.2;
  const seen = new Map([[ground, { hops: 0, via: null }]]);
  const q = [ground];
  while (q.length) {
    const c = q.shift();
    for (const e of (byLo.get(c) ?? [])) {
      if (e.rise > MAX || seen.has(e.hiComp)) continue;
      seen.set(e.hiComp, { hops: seen.get(c).hops + 1, via: e });
      q.push(e.hiComp);
    }
  }
  const shelves = [];
  for (const [c, info] of seen) {
    if (c === ground) continue;
    if (g.compSize[c] < 8 || compTop[c] <= 2.5) continue;
    const e = info.via;
    shelves.push({
      comp: c, cells: g.compSize[c], top: +compTop[c].toFixed(2), hops: info.hops,
      rise: e.rise,
      from: [+g.worldX(e.lo % g.nx).toFixed(1), +g.floor[e.lo].toFixed(2), +g.worldZ((e.lo / g.nx) | 0).toFixed(1)],
      to: [+g.worldX(e.hi % g.nx).toFixed(1), +g.floor[e.hi].toFixed(2), +g.worldZ((e.hi / g.nx) | 0).toFixed(1)],
    });
  }
  shelves.sort((a, b) => b.cells - a.cells);
  out.topShelvesAt2p2 = shelves.slice(0, 25);
  out.shelfCount = shelves.length;

  // How many baked cover points stand on those shelves.
  const reach = new Set(seen.keys());
  let cov = 0, covHigh = 0;
  for (const p of (ai.cover.points ?? [])) {
    const ix = g.cellX(p.x), iz = g.cellZ(p.z);
    if (!g.inside(ix, iz)) continue;
    const c = g.comp[g.index(ix, iz)];
    if (c === ground || !reach.has(c)) continue;
    cov++;
    if (p.y > 2.5) covHigh++;
  }
  out.coverPointsOnReachableShelves = cov;
  out.coverPointsOnReachableShelvesAbove2p5 = covHigh;
  return out;
});

console.log(JSON.stringify(r, null, 1));
await browser.close();
