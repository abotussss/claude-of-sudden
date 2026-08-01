/**
 * ROOF PROBE — why is a man on a roof stranded, and what would connect him?
 *
 * Counts, over the whole height field:
 *   the distribution of floor deltas between ADJACENT WALKABLE cells that the
 *   grid currently refuses (delta > maxStep), split by direction of travel, so
 *   "a stair is one step too tall" and "a roof is a four metre drop" can be told
 *   apart; and how many high cells would join the ground component if each class
 *   of edge were allowed.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4355/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', (e) => console.log('  PAGEERROR', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const r = await p.evaluate(() => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  const g = ai.grid;
  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
  const nx = g.nx, nz = g.nz;
  const bins = {};
  const B = (d) => {
    const k = d < 0.6 ? '0.45-0.60' : d < 0.8 ? '0.60-0.80' : d < 1.2 ? '0.80-1.20'
      : d < 2 ? '1.2-2' : d < 4 ? '2-4' : d < 7 ? '4-7' : '7+';
    bins[k] = (bins[k] ?? 0) + 1;
  };
  let refused = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      if (!g.walkable(ix, iz)) continue;
      const i = g.index(ix, iz);
      for (let d = 0; d < 8; d++) {
        const jx = ix + DX[d], jz = iz + DZ[d];
        if (!g.walkable(jx, jz)) continue;
        const j = g.index(jx, jz);
        if (!g._canStep(i, ix, iz, d)) continue;
        const dy = g.floor[j] - g.floor[i];
        if (Math.abs(dy) <= g.maxStep) continue;
        refused++;
        if (dy < 0) B(-dy);
      }
    }
  }
  // spawn/agent components
  const groundComps = new Set();
  for (const a of ai.agents) {
    if (!a.alive) continue;
    const i = g.nearest(a.position.x, a.position.z, a.position.y, 4, 2.0);
    if (i >= 0 && g.comp[i] >= 0) groundComps.add(g.comp[i]);
  }
  // component sizes histogram of the big ones
  const sizes = [...g.compSize].map((v, i) => [i, v]).sort((a, c) => c[1] - a[1]).slice(0, 8);
  // how much of the map is above 2.5 m and in what components
  const highByComp = new Map();
  let high = 0;
  for (let i = 0; i < g.flags.length; i++) {
    if (!g.flags[i] || !(g.floor[i] > 2.5)) continue;
    high++;
    highByComp.set(g.comp[i], (highByComp.get(g.comp[i]) ?? 0) + 1);
  }
  const topHigh = [...highByComp.entries()].sort((a, c) => c[1] - a[1]).slice(0, 8);
  return {
    maxStep: g.maxStep, cell: g.cell,
    refusedSteps: refused, dropBins: bins,
    components: g.components, biggest: g.biggestComponent,
    groundComps: [...groundComps], groundCompSizes: [...groundComps].map((c) => g.compSize[c]),
    topComponents: sizes, highCells: high, topHighComponents: topHigh,
  };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
