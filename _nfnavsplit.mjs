/**
 * THE NAV COUNT, SPLIT AT THE BOUNDARY.
 *
 *   node _nfnavsplit.mjs [--url=…] [--r=176]
 *
 * `NavGrid` is built over the whole world AABB, which on NACHTFELD includes a
 * 350 m mountain the player is stopped 176 m short of. So one walkable-cell
 * total is two numbers stuck together, and only the first of them is a
 * statement about the map anybody plays: the several tens of thousands outside
 * r 176 are the back of the ridge and are supposed to be there.
 *
 * Prints walkable cells inside and outside the boundary, the connected
 * components of each, and the largest component inside — which is the number
 * that says the playable ground is ONE piece.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4625/?map=plains';
const R = Number(args.r ?? 176);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 480 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const r = await p.evaluate((R) => {
  const c = window.__ENGINE__.ctx;
  const ai = c.peek('ai'), w = c.peek('world');
  const g = ai.nav ?? ai.grid ?? ai._nav;
  if (!g?.flags) return { level: w.level.id, error: 'no nav grid' };
  const F = g.flags, nx = g.nx, nz = g.nz, cell = g.cell;
  const wx = (ix) => g.minX + ix * cell;
  const wz = (iz) => g.minZ + iz * cell;
  const inside = (i) => {
    const x = wx(i % nx), z = wz((i / nx) | 0);
    return x * x + z * z <= R * R;
  };
  let win = 0, wout = 0;
  for (let i = 0; i < F.length; i++) {
    if (!(F[i] & 1)) continue;
    if (inside(i)) win++; else wout++;
  }
  // components, restricted to cells inside the boundary
  const seen = new Uint8Array(F.length);
  const sizes = [];
  for (let s = 0; s < F.length; s++) {
    if (seen[s] || !(F[s] & 1) || !inside(s)) continue;
    let n = 0; const q = [s]; seen[s] = 1;
    while (q.length) {
      const i = q.pop(); n++;
      const ix = i % nx, iz = (i / nx) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        const j = jz * nx + jx;
        if (seen[j] || !(F[j] & 1) || !inside(j)) continue;
        seen[j] = 1; q.push(j);
      }
    }
    sizes.push(n);
  }
  sizes.sort((a, c2) => c2 - a);
  return {
    level: w.level.id, cell, grid: `${nx}x${nz}`, cells: F.length,
    walkableInside: win, walkableOutside: wout,
    componentsInside: sizes.length, biggestInside: sizes[0] ?? 0,
    strandedInside: win - (sizes[0] ?? 0),
    islands: sizes.slice(1, 12),
  };
}, R);

console.log(JSON.stringify(r, null, 1));
console.log(errs.length ? `PAGEERRORS: ${errs[0]}` : '0 pageerrors');
await b.close();
