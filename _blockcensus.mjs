/**
 * FREE-STANDING MASS ON THIS MAP — the census behind `_blockAtlas` in
 * `src/match/tank.js`.
 *
 *   node _blockcensus.mjs [--seed=7] [--cell=1.0] [--plan=5] [--top=3.6] [--all]
 *
 * The plough can only erase mass with a `prop_*` instance behind it, so every
 * piece of merged masonry on this map is permanent whatever it looks like —
 * including the 3.4 m gate pier standing on the cathedral's own parvis. This
 * measures the alternative discriminator, which is not a name list and not a
 * ceiling: a 2.5D height field over the whole map, flood-filled into ISLANDS of
 * mass, where an island small enough in plan, short enough, and surrounded on
 * every side by open road is a free-standing block rather than a building.
 *
 * Prints every island the rule takes and every one it just misses, so the two
 * caps can be set from the map instead of from a guess.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true];
}));
const URL = args.url ?? 'http://127.0.0.1:4498/';
const SEED = args.seed ?? '7';

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('  pageerror', String(e.message).slice(0, 200)));
await page.goto(`${URL}?seed=${SEED}&boxtag`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const out = await page.evaluate(({ cell, plan, top, min, thin, fill }) => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const w = ctx.peek('world');
  const phys = ctx.peek('physics');
  const sw = phys.staticWorld;
  const tag = w.A?.constructor?.TAG;

  /* ---- bounds, from the packed collision itself ----------------------- */
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let t = 0; t < sw.triCount; t++) {
    const o = t * 9;
    for (let v = 0; v < 3; v++) {
      const x = sw.pos[o + v * 3], z = sw.pos[o + v * 3 + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
  }
  x0 = Math.max(x0, -150); x1 = Math.min(x1, 150);
  z0 = Math.max(z0, -150); z1 = Math.min(z1, 150);

  const nx = Math.ceil((x1 - x0) / cell);
  const nz = Math.ceil((z1 - z0) / cell);
  const t0 = performance.now();
  /** Height of the mass over the road, per cell. */
  const H = new Float32Array(nx * nz);
  for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) * cell;
    for (let j = 0; j < nz; j++) {
      const z = z0 + (j + 0.5) * cell;
      const road = w.groundHeight(x, z);
      const g = phys.groundHeight(x, z, 40);
      H[i * nz + j] = Number.isFinite(g) && Number.isFinite(road) ? g - road : 0;
    }
  }
  const fieldMs = performance.now() - t0;

  /* ---- flood the cells that hold mass into islands --------------------- */
  const t1 = performance.now();
  const owner = new Int32Array(nx * nz).fill(-1);
  const stack = [];
  const isles = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const k = i * nz + j;
      if (owner[k] >= 0 || H[k] <= min) continue;
      const id = isles.length;
      const isle = { id, i0: i, i1: i, j0: j, j1: j, cells: 0, hi: 0 };
      isles.push(isle);
      owner[k] = id;
      stack.length = 0;
      stack.push(k);
      while (stack.length) {
        const c = stack.pop();
        const ci = (c / nz) | 0, cj = c % nz;
        isle.cells++;
        if (ci < isle.i0) isle.i0 = ci; if (ci > isle.i1) isle.i1 = ci;
        if (cj < isle.j0) isle.j0 = cj; if (cj > isle.j1) isle.j1 = cj;
        if (H[c] > isle.hi) isle.hi = H[c];
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
          const nk = ni * nz + nj;
          if (owner[nk] >= 0 || H[nk] <= min) continue;
          owner[nk] = id;
          stack.push(nk);
        }
      }
    }
  }
  const floodMs = performance.now() - t1;

  /* ---- classify -------------------------------------------------------- */
  const vols = w.interiorVolumes ?? [];
  const inInterior = (x, z) => {
    for (const v of vols) {
      const dx = x - v.cx, dz = z - v.cz;
      const u = dx * v.c + dz * v.s, t = -dx * v.s + dz * v.c;
      if (Math.abs(u) < v.hw + 1.6 && Math.abs(t) < v.hd + 1.6) return v.building;
    }
    return null;
  };
  const rows = [];
  for (const s of isles) {
    const wpl = (s.i1 - s.i0 + 1) * cell;
    const dpl = (s.j1 - s.j0 + 1) * cell;
    const cx = x0 + (s.i0 + s.i1 + 1) / 2 * cell;
    const cz = z0 + (s.j0 + s.j1 + 1) / 2 * cell;
    if (wpl > plan + 4 && dpl > plan + 4 && s.cells > 60) continue; // a building: not worth printing
    // the free-standing ring: one cell of clear road all the way round
    let ringMax = 0;
    for (let i = s.i0 - 1; i <= s.i1 + 1; i++) {
      for (let j = s.j0 - 1; j <= s.j1 + 1; j++) {
        if (i > s.i0 - 1 && i < s.i1 + 1 && j > s.j0 - 1 && j < s.j1 + 1) continue;
        if (i < 0 || j < 0 || i >= nx || j >= nz) { ringMax = 99; continue; }
        const h = H[i * nz + j];
        if (h > ringMax) ringMax = h;
      }
    }
    const bldg = inInterior(cx, cz);
    const solid = s.cells / ((s.i1 - s.i0 + 1) * (s.j1 - s.j0 + 1));
    const take = wpl <= plan && dpl <= plan && wpl >= thin && dpl >= thin &&
      solid >= fill && s.hi <= top && ringMax <= min && !bldg;
    const names = [];
    if (take && tag) {
      for (const b of tag) {
        if (b.wx === undefined) continue;
        if (b.wx < cx - wpl / 2 - 0.6 || b.wx > cx + wpl / 2 + 0.6) continue;
        if (b.wz < cz - dpl / 2 - 0.6 || b.wz > cz + dpl / 2 + 0.6) continue;
        if (b.wy - b.sy / 2 > s.hi + 1) continue;
        if (b.sy < 0.35) continue;
        const line = String(b.at).split('\n').slice(1).map((q) => q.trim())
          .find((q) => !/builder\.js/.test(q)) ?? '?';
        names.push(line.replace(/^at\s+/, '').replace(/https?:\/\/[^/]+\//, ''));
      }
    }
    rows.push({
      cx: +cx.toFixed(1), cz: +cz.toFixed(1),
      w: +wpl.toFixed(1), d: +dpl.toFixed(1), hi: +s.hi.toFixed(2),
      cells: s.cells, ring: +ringMax.toFixed(2), bldg, take,
      solid: +solid.toFixed(2),
      names: [...new Set(names)].slice(0, 3),
      why: take ? '' : (wpl > plan || dpl > plan ? 'plan ' : '') +
        (wpl < thin || dpl < thin ? 'thin ' : '') + (solid < fill ? 'ragged ' : '') +
        (s.hi > top ? 'tall ' : '') + (ringMax > min ? 'joined ' : '') + (bldg ? `in:${bldg}` : ''),
    });
  }
  rows.sort((a, b) => b.hi - a.hi);
  return { nx, nz, cell, isles: isles.length, fieldMs: +fieldMs.toFixed(0), floodMs: +floodMs.toFixed(0), rows,
    bounds: [+x0.toFixed(0), +z0.toFixed(0), +x1.toFixed(0), +z1.toFixed(0)] };
}, {
  cell: Number(args.cell ?? 1.0), plan: Number(args.plan ?? 5),
  top: Number(args.top ?? 3.6), min: Number(args.min ?? 0.35),
  thin: Number(args.thin ?? 2.0), fill: Number(args.fill ?? 0.6),
});

console.log(`\n  field ${out.nx} x ${out.nz} at ${out.cell} m over [${out.bounds}] — ${out.fieldMs} ms of rays, ${out.floodMs} ms of flood`);
console.log(`  ${out.isles} islands of mass\n`);
const take = out.rows.filter((r) => r.take);
console.log(`  TAKEN: ${take.length}\n`);
for (const r of (args.all ? out.rows : take).slice(0, Number(args.max ?? 80))) {
  console.log(`  ${r.take ? 'TAKE' : '    '} [${String(r.cx).padStart(7)},${String(r.cz).padStart(7)}] ` +
    `${String(r.w).padStart(5)} x ${String(r.d).padStart(5)} plan, ${String(r.hi).padStart(5)} tall, ` +
    `${String(r.cells).padStart(4)} cells ${String(r.solid).padStart(4)} solid, ring ${String(r.ring).padStart(5)}  ${r.why}${(r.names ?? []).join(' | ')}`);
}
await browser.close();
