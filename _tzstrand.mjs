/**
 * WHICH CELLS DOES THE RAZE STRAND, AND WHERE ARE THEY?
 *
 *   BASE=http://127.0.0.1:4626/ node _tzstrand.mjs
 *
 * `_tzsite.mjs` says the plain's stranded count inside r 176 goes 1 899 -> 2 023
 * when NF-TOWER comes down. A count is not a diagnosis: this lists the cells
 * that CHANGE from joined-to-the-ground to not, with their world position, their
 * floor and how far that floor stands over the plain, clustered.
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4626/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${BASE}?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const ai = e.ctx.peek('ai');
  const m = e.ctx.peek('match');
  const air = m.airstrike;
  const rec = w.demolitions.find((r) => r.id === 'NF-TOWER');
  const site = air.sites.find((s) => s.id === 'NF-TOWER');
  const g = ai.grid;

  /**
   * `NavGrid`'s OWN labeller, not a re-implementation of it. `_label` is a pure
   * flood over `flags`/`floor`/`climb` and re-running it after `_applyNav` is
   * exactly what the grid would look like if it had been built in that state —
   * which is the only way these numbers are comparable with `_nfr176.mjs`'s.
   */
  const label = () => {
    g._label();
    // `biggestComponent` is the SIZE, not the id — the id is where that size is.
    let main = 0;
    for (let k = 1; k < g.compSize.length; k++) if (g.compSize[k] > g.compSize[main]) main = k;
    return { comp: g.comp, main };
  };

  const totals = [];
  const snap = (tag) => {
    const { comp, main } = label();
    const s = new Uint8Array(g.flags.length);
    let inW = 0, inS = 0, outW = 0, outS = 0;
    for (let iz = 0; iz < g.nz; iz++) {
      for (let ix = 0; ix < g.nx; ix++) {
        const i = g.index(ix, iz);
        if (!g.flags[i]) continue;
        const st = comp[i] !== main;
        s[i] = st ? 1 : 0;
        const inside = Math.hypot(g.worldX(ix), g.worldZ(iz)) <= 176;
        if (inside) { inW++; if (st) inS++; } else { outW++; if (st) outS++; }
      }
    }
    totals.push({ state: tag, walkableInsideR176: inW, strandedInsideR176: inS, walkableOutside: outW, strandedOutside: outS });
    return s;
  };

  const before = snap('intact');
  air._applyNav(site, true);
  rec.setDown(true);
  const after = snap('razed');

  const gained = [];
  for (let iz = 0; iz < g.nz; iz++) {
    for (let ix = 0; ix < g.nx; ix++) {
      const i = g.index(ix, iz);
      if (after[i] && !before[i]) {
        const x = g.worldX(ix), z = g.worldZ(iz);
        gained.push({ x: +x.toFixed(1), z: +z.toFixed(1), floor: +g.floor[i].toFixed(2), over: +(g.floor[i] - w.groundHeight(x, z)).toFixed(2) });
      }
    }
  }
  rec.setDown(false);
  air._applyNav(site, false);
  // …and put the grid's own labels back the way the boot left them.
  g._label();
  g._labelEscapes?.();

  // cluster by 6 m
  const clusters = [];
  for (const c of gained) {
    let hit = null;
    for (const k of clusters) if (Math.hypot(k.x - c.x, k.z - c.z) < 8) { hit = k; break; }
    if (hit) { hit.n++; hit.x = (hit.x * (hit.n - 1) + c.x) / hit.n; hit.z = (hit.z * (hit.n - 1) + c.z) / hit.n; hit.over = Math.max(hit.over, c.over); hit.floor = Math.max(hit.floor, c.floor); }
    else clusters.push({ x: c.x, z: c.z, n: 1, over: c.over, floor: c.floor });
  }
  clusters.sort((a, c) => c.n - a.n);
  return {
    totals,
    gained: gained.length,
    clusters: clusters.slice(0, 12).map((c) => ({ at: [+c.x.toFixed(1), +c.z.toFixed(1)], cells: c.n, maxFloor: c.floor, maxOverPlain: c.over })),
  };
});
console.log(JSON.stringify(out, null, 1));
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
