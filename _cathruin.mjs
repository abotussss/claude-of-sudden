/**
 * WHAT IS ACTUALLY LEFT WHERE THE CATHEDRAL STOOD.
 *
 *   node _cathruin.mjs [--url=…]
 *
 * "大聖堂の破壊なのに跡地がしょぼい". That is a judgement about a silhouette, and
 * a silhouette is measurable: this sweeps a 0.5 m lattice over the cathedral's
 * own footprint with the church STANDING and again with it RAZED and reports the
 * surface it presents — highest solid, mean height, and the fraction of the plan
 * standing over knee, chest and head height. Then D's two `sitecheck` numbers,
 * and the nav grid's own opinion of the footprint in both states, because the
 * grid is baked ONCE at boot with BOTH scopes solid and that is the constraint
 * every extra tonne of rubble has to live inside.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4270/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 480000 });

const measure = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const w = e.ctx.peek('world');
    const m = e.ctx.peek('match');
    const ai = e.ctx.peek('ai');
    const ph = e.ctx.peek('physics');
    const MASK = ph.MASK.WORLD;
    const k = w.cathedral;
    const vol = w.interiorVolumes.find((v) => v.building === k.id);
    const c = vol.c, s = vol.s;
    const FL = k.floorY;

    /** highest solid at a level-space (u,v), searching down from 40 m. */
    const topAt = (u, v) => {
      const wx = vol.cx + u * c + v * s;
      const wz = vol.cz - u * s + v * c;
      const h = ph.raycast(wx, 40, wz, 0, -1, 0, 46, MASK);
      return h.hit ? h.point.y : null;
    };

    const S = 0.5;
    let n = 0, sum = 0, hi = -Infinity, hiAt = null;
    const bands = { over04: 0, over09: 0, over18: 0, over28: 0, over50: 0, over90: 0 };
    for (let v = -k.hd + 0.25; v <= k.hd; v += S) {
      for (let u = -k.hw + 0.25; u <= k.hw; u += S) {
        const y = topAt(u, v);
        if (y == null) continue;
        const r = y - FL;
        n++;
        sum += r;
        if (y > hi) { hi = y; hiAt = [+u.toFixed(1), +v.toFixed(1)]; }
        if (r > 0.4) bands.over04++;
        if (r > 0.9) bands.over09++;
        if (r > 1.8) bands.over18++;
        if (r > 2.8) bands.over28++;
        if (r > 5.0) bands.over50++;
        if (r > 9.0) bands.over90++;
      }
    }

    /* ---- sitecheck's two assertions, for D ------------------------------ */
    const topWorld = (wx, wz, top) => {
      const h = ph.raycast(wx, top, wz, 0, -1, 0, top + 8, MASK);
      return h.hit ? h.point.y : -Infinity;
    };
    const coverArea = (C, r0, r1) => {
      let hit = 0, tot = 0;
      for (let dz = -r1; dz <= r1 + 1e-6; dz += 0.5) {
        for (let dx = -r1; dx <= r1 + 1e-6; dx += 0.5) {
          const d = Math.hypot(dx, dz);
          if (d < r0 || d > r1) continue;
          const y = topWorld(C.x + dx, C.z + dz, C.y + 6);
          if (!Number.isFinite(y)) continue;
          tot++;
          const rise = y - C.y;
          if (rise >= 0.9 && rise <= 2.8) hit++;
        }
      }
      return { m2: +(hit * 0.25).toFixed(1), frac: tot ? +(hit / tot).toFixed(3) : 0 };
    };
    const d = m.allZones.find((z) => z.id === 'D');
    const pts = ai.cover?.points ?? [];
    let dHigh = 0, dLow = 0;
    for (const p of pts) {
      if (Math.abs(p.y - d.position.y) > 3) continue;
      if (Math.hypot(p.x - d.position.x, p.z - d.position.z) > d.radius) continue;
      p.high ? dHigh++ : dLow++;
    }
    const dMass = coverArea(d.position, 0, d.radius);

    /* ---- the grid's opinion of the footprint ---------------------------- */
    const g = ai.grid;
    let cells = 0, walk = 0, dCells = 0, dWalk = 0;
    for (let iz = 0; iz < g.nz; iz++) {
      for (let ix = 0; ix < g.nx; ix++) {
        const x = g.worldX(ix), z = g.worldZ(iz);
        const dx = x - vol.cx, dz = z - vol.cz;
        const lu = dx * c - dz * s;
        const lv = dx * s + dz * c;
        if (Math.abs(lu) > k.hw || Math.abs(lv) > k.hd) continue;
        cells++;
        if (g.flags[g.index(ix, iz)]) walk++;
        if (Math.hypot(x - d.position.x, z - d.position.z) <= d.radius) {
          dCells++;
          if (g.flags[g.index(ix, iz)]) dWalk++;
        }
      }
    }

    return {
      razed: k.razed,
      dLive: m.sites.includes(d),
      samples: n,
      highestSolid: +hi.toFixed(2),
      highestAt: hiAt,
      meanRise: +(sum / n).toFixed(2),
      pctOver: Object.fromEntries(Object.entries(bands).map(([kk, vv]) => [kk, +((100 * vv) / n).toFixed(1)])),
      dMass: dMass.m2,
      dMassFrac: dMass.frac,
      dHigh,
      dLow,
      dStand: d.stand.length,
      gridCells: cells,
      gridWalkable: walk,
      dGridCells: dCells,
      dGridWalkable: dWalk,
      navWalkableTotal: g.walkableCount,
      navInterior: g.interiorCells,
    };
  });

const show = (label, r) => {
  console.log(`\n─── ${label} ───`);
  console.log(`  razed ${r.razed}   D live ${r.dLive}`);
  console.log(`  highest solid over the footprint : ${r.highestSolid} m  at (u,v)=${JSON.stringify(r.highestAt)}`);
  console.log(`  mean surface height above floor  : ${r.meanRise} m   (${r.samples} samples)`);
  console.log(`  % of plan standing over  0.4 m ${r.pctOver.over04}   0.9 m ${r.pctOver.over09}   1.8 m ${r.pctOver.over18}` +
              `   2.8 m ${r.pctOver.over28}   5 m ${r.pctOver.over50}   9 m ${r.pctOver.over90}`);
  console.log(`  D: cover mass ${r.dMass} m² (${(r.dMassFrac * 100).toFixed(1)}% of floor) · standing cover ${r.dHigh} · low ${r.dLow} · stand pts ${r.dStand}`);
  console.log(`  nav: footprint ${r.gridWalkable}/${r.gridCells} walkable · D circle ${r.dGridWalkable}/${r.dGridCells}` +
              ` · map ${r.navWalkableTotal} (${r.navInterior} indoor)`);
};

show('CATHEDRAL STANDING', await measure());

// Take it down on the real path so D goes live and the nav re-probe runs.
await page.evaluate(() => (window.__ENGINE__.time.scale = 10));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._checkWinConditions = () => {};
  m.roundClock = 1e6;
  m.score[0] = 999;
});
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').sites.some((z)=>z.id==='D')", null, { timeout: 240000 });
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await page.waitForTimeout(1200);
show('CATHEDRAL RAZED', await measure());
console.log('\n  pageErrors', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
process.exit(errs.length ? 1 : 0);
