/** Where do the roof cells lose their way down? Count the drop rejections. */
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
  const ai = window.__ENGINE__.ctx.peek('ai');
  const g = ai.grid;
  const phys = g.physics, MASK = phys.MASK.WORLD;
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1];
  const SQRT2 = Math.SQRT2;
  // Only cells that MATTER: high ones whose component cannot already escape.
  const stranded = new Set();
  for (let c = 0; c < g.components; c++) stranded.add(c);
  const R = { highCells: 0, strandedHigh: 0, edgeCandidates: 0, sameComp: 0, tooFar: {}, parapet: 0, island: 0, corner: 0, ok: 0 };
  const bin = (f) => (f < 6 ? '5-6' : f < 7 ? '6-7' : f < 9 ? '7-9' : f < 12 ? '9-12' : '12+');
  const big = new Set();
  for (let c = 0; c < g.components; c++) if (g.compSize[c] >= g.biggestComponent * 0.05) big.add(c);
  for (let iz = 0; iz < g.nz; iz++) {
    for (let ix = 0; ix < g.nx; ix++) {
      const i = g.index(ix, iz);
      if (!g.flags[i] || !(g.floor[i] > 2.5)) continue;
      R.highCells++;
      const c = g.comp[i];
      const esc = g.escape.length ? g.escape[c] : -1;
      const escaped = big.has(c) || esc >= 0;
      if (esc >= 0) {
        R.escTargets = R.escTargets ?? {};
        const k = big.has(esc) ? 'BIG' : `sz${g.compSize[esc]}`;
        R.escTargets[k] = (R.escTargets[k] ?? 0) + 1;
      }
      if (escaped) continue;
      R.noLowerNeighbour = R.noLowerNeighbour ?? 0;
      let anyLower = false;
      R.strandedHigh++;
      for (let d = 0; d < 8; d++) {
        const jx = ix + DX[d], jz = iz + DZ[d];
        if (!g.walkable(jx, jz)) continue;
        const j = g.index(jx, jz);
        const fall = g.floor[i] - g.floor[j];
        if (fall <= g.maxStep) continue;
        anyLower = true;
        R.edgeCandidates++;
        if (g.comp[i] === g.comp[j]) { R.sameComp++; continue; }
        if (fall > 7.0) { R.tooFar[bin(fall)] = (R.tooFar[bin(fall)] ?? 0) + 1; continue; }
        if (!g._canStep(i, ix, iz, d)) { R.corner++; continue; }
        if (g.componentSize(j) < 24) { R.island++; continue; }
        const dx = DX[d], dz = DZ[d];
        const diagonal = dx !== 0 && dz !== 0;
        const inv = diagonal ? 1 / SQRT2 : 1;
        const dist = g.cell * (diagonal ? SQRT2 : 1);
        if (phys.raycastAny(g.worldX(ix), g.floor[i] + 0.35, g.worldZ(iz), dx * inv, 0, dz * inv, dist, MASK)) { R.parapet++; continue; }
        R.ok++;
      }
      if (!anyLower) R.noLowerNeighbour++;
    }
  }
  // …and how many stranded high cells have NO lower walkable neighbour at all
  return R;
});
console.log(JSON.stringify(r, null, 1));
await b.close();
