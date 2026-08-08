/**
 * THE CROSSING, STEP BY STEP — boundcheck's flood, seeded at one point, run
 * until it first reaches r > RSTOP, then the BFS chain that got it there printed
 * cell by cell with radius, floor height and material.
 *
 *   node _nfpath.mjs http://127.0.0.1:4617/?map=plains [seedX] [seedZ] [rstop]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4617/?map=plains';
const SX = Number(process.argv[3] ?? -118);
const SZ = Number(process.argv[4] ?? -104);
const RSTOP = Number(process.argv[5] ?? 182);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 480 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await p.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const m = c.peek('match'), ai = c.peek('ai');
  if (m) m.update = () => {};
  if (ai) { ai.combatEnabled = false; try { ai.clearAgents(); } catch { /* ok */ } }
});

const out = await p.evaluate(({ SX, SZ, RSTOP }) => { // eslint-disable-line
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world'), phys = c.peek('physics');
  const V = c.camera.position.constructor;
  const MASK = phys.MASK.CHARACTER;
  const R = 0.32, H = 1.78, STEP = 0.42, MANTLE_UP = 1.85, DROP_MAX = 6.0, MREACH = 1.05;
  const CELL = 0.8, EXT = 240;
  const _a = new V(), _b = new V(), _wp = new V();
  const nx = Math.ceil((EXT * 2) / CELL) + 1, nz = nx;
  const idx = (ix, iz) => iz * nx + ix;
  const lxOf = (ix) => -EXT + ix * CELL, lzOf = (iz) => -EXT + iz * CELL;
  const cellNodes = new Array(nx * nz);
  const nodeY = [], nodeCell = [], nodeSurf = [];
  const column = (ci) => {
    let list = cellNodes[ci];
    if (list !== undefined) return list;
    list = [];
    const ix = ci % nx, iz = (ci / nx) | 0;
    const lx = lxOf(ix), lz = lzOf(iz);
    w.levelToWorld(lx, 0, lz, _wp);
    const top = w.level.groundY(lx, lz) + 34, floor = w.level.groundY(lx, lz) - 9;
    let from = top;
    for (let s = 0; s < 4; s++) {
      const hit = phys.raycast(_wp.x, from, _wp.z, 0, -1, 0, from - floor + 1.8, MASK);
      if (!hit.hit) break;
      const fy = hit.point.y;
      if (fy < floor) break;
      from = fy - 0.06;
      if (hit.normal && hit.normal.y < 0.5) continue;
      _a.set(_wp.x, fy + STEP + R, _wp.z);
      _b.set(_wp.x, fy + H - R + 0.02, _wp.z);
      if (!phys.checkCapsule(_a, _b, R - 0.005, MASK)) continue;
      list.push(nodeY.length);
      nodeY.push(fy); nodeCell.push(ci); nodeSurf.push(hit.surface);
      if (from < floor) break;
    }
    cellNodes[ci] = list;
    return list;
  };
  const clearBetween = (lo, hi) => {
    const lc = nodeCell[lo], hc = nodeCell[hi];
    w.levelToWorld(lxOf(lc % nx), 0, lzOf((lc / nx) | 0), _a);
    w.levelToWorld(lxOf(hc % nx), 0, lzOf((hc / nx) | 0), _b);
    const dx = _b.x - _a.x, dz = _b.z - _a.z, d = Math.hypot(dx, dz);
    if (d < 1e-4) return true;
    return !phys.raycast(_a.x, nodeY[hi] + 0.3, _a.z, dx / d, 0, dz / d, d, MASK).hit;
  };

  const rOf = (k) => {
    const ci = nodeCell[k];
    return Math.hypot(lxOf(ci % nx), lzOf((ci / nx) | 0));
  };

  // seed
  const six = Math.round((SX + EXT) / CELL), siz = Math.round((SZ + EXT) / CELL);
  let seed = -1;
  for (const k of column(idx(six, siz))) { seed = k; break; }
  if (seed < 0) return { err: 'no standable surface at seed' };

  const pred = new Map();
  const seen = new Set([seed]);
  const queue = [seed];
  pred.set(seed, -1);
  let head = 0, hit = -1;
  const RING = Math.ceil(MREACH / CELL);
  while (head < queue.length && hit < 0) {
    const cur = queue[head++];
    const ci = nodeCell[cur], y = nodeY[cur];
    const ix = ci % nx, iz = (ci / nx) | 0;
    for (let dz = -RING; dz <= RING && hit < 0; dz++) {
      for (let dx = -RING; dx <= RING; dx++) {
        if (dx === 0 && dz === 0) continue;
        const step1 = Math.abs(dx) + Math.abs(dz) === 1;
        if (!step1 && Math.hypot(dx, dz) * CELL > MREACH) continue;
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        for (const k of column(idx(jx, jz))) {
          if (seen.has(k)) continue;
          const dy = nodeY[k] - y, ady = Math.abs(dy);
          let ok = false;
          if (ady <= STEP) ok = step1;
          else if (dy > 0) ok = dy <= MANTLE_UP && (step1 || clearBetween(cur, k));
          else ok = ady <= DROP_MAX && (step1 || clearBetween(k, cur));
          if (!ok) continue;
          seen.add(k); queue.push(k); pred.set(k, cur);
          if (rOf(k) > RSTOP) { hit = k; break; }
        }
        if (hit >= 0) break;
      }
    }
  }
  if (hit < 0) return { err: `flood never reached r>${RSTOP}`, visited: seen.size };
  const chain = [];
  let cur = hit;
  while (cur !== undefined && cur >= 0) {
    const ci = nodeCell[cur];
    const lx = lxOf(ci % nx), lz = lzOf((ci / nx) | 0);
    chain.push({ lx: +lx.toFixed(1), lz: +lz.toFixed(1), r: +Math.hypot(lx, lz).toFixed(1), y: +nodeY[cur].toFixed(2), s: nodeSurf[cur] });
    cur = pred.get(cur);
  }
  chain.reverse();
  return { visited: seen.size, chain };
}, { SX, SZ, RSTOP });

if (out.err) console.log('[nfpath]', out.err, out.visited ?? '');
else {
  console.log(`[nfpath] flood visited ${out.visited} nodes; the walk that got out (${out.chain.length} steps):`);
  console.log('     lx      lz      r      y     surface');
  const c = out.chain;
  const from = Math.max(0, c.length - 60);
  for (let i = from; i < c.length; i++) {
    const k = c[i];
    console.log(`  ${String(k.lx).padStart(7)} ${String(k.lz).padStart(7)} ${String(k.r).padStart(6)} ${String(k.y).padStart(6)}   ${k.s}`);
  }
}
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
