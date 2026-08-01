/** Per high-component: does it escape, and if not what stops its perimeter? */
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
  const S2 = Math.SQRT2;
  const per = new Map();
  for (let iz = 0; iz < g.nz; iz++) {
    for (let ix = 0; ix < g.nx; ix++) {
      const i = g.index(ix, iz);
      if (!g.flags[i] || !(g.floor[i] > 2.5)) continue;
      const c = g.comp[i];
      let e = per.get(c);
      if (!e) per.set(c, (e = { comp: c, cells: 0, size: g.compSize[c], esc: g.escape[c], edges: 0, tooFar: 0, parapet: 0, lowLip: 0, island: 0, corner: 0, ok: 0, maxY: 0 }));
      e.cells++;
      if (g.floor[i] > e.maxY) e.maxY = +g.floor[i].toFixed(1);
      for (let d = 0; d < 8; d++) {
        const jx = ix + DX[d], jz = iz + DZ[d];
        if (!g.walkable(jx, jz)) continue;
        const j = g.index(jx, jz);
        const fall = g.floor[i] - g.floor[j];
        if (fall <= g.maxStep || g.comp[j] === c) continue;
        e.edges++;
        if (fall > 7.0) { e.tooFar++; continue; }
        if (!g._canStep(i, ix, iz, d)) { e.corner++; continue; }
        if (g.componentSize(j) < 24) { e.island++; continue; }
        const dx = DX[d], dz = DZ[d], diag = dx && dz;
        const inv = diag ? 1 / S2 : 1, dist = g.cell * (diag ? S2 : 1);
        const x = g.worldX(ix), z = g.worldZ(iz), y = g.floor[i];
        if (phys.raycastAny(x, y + 0.35, z, dx * inv, 0, dz * inv, dist, MASK)) {
          // is the blocker a low lip a man could get over, or a wall?
          if (!phys.raycastAny(x, y + 1.25, z, dx * inv, 0, dz * inv, dist, MASK)) e.lowLip++;
          else e.parapet++;
          continue;
        }
        e.ok++;
      }
    }
  }
  const rows = [...per.values()].sort((a, c) => c.cells - a.cells).slice(0, 16);
  let escCells = 0, allCells = 0;
  for (const e of per.values()) { allCells += e.cells; if (e.esc >= 0 || e.ok > 0) escCells += e.cells; }
  return { highComponents: per.size, allCells, escCells, rows };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
