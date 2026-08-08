/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THE TOWER'S SITE IS, INTACT AND RAZED
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   BASE=http://127.0.0.1:4626/ node _tzsite.mjs
 *
 * Four questions, on one boot, so the two states are measured against the same
 * map rather than against two:
 *
 *   1. HOW HIGH does the site stand over the plain, everywhere inside `TOWER_R`?
 *      A 0.25 m grid of downward rays against `world.groundHeight`. 更地 means
 *      this number is small; the crouch eye is 1.02 m and that is the bar.
 *   2. IS ANYTHING IN THE 0.42-0.68 m PROUD BAND as an isolated step? Cells in
 *      that band whose FOUR NEIGHBOURS are all more than 0.3 m below them — a
 *      graded slope passes, a kerb does not.
 *   3. THE NAV COUNTS, split inside and outside r 176, in both states. The
 *      plain's design rule is that every AI-walkable surface inside r 176 is in
 *      one component with the ground; the ~50 823 outside are the back of the
 *      mountain and are correct.
 *   4. EVERY CACHE ON THE TOWER: does it die when the record goes down?
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
  const ph = e.ctx.peek('physics');
  const ai = e.ctx.peek('ai');
  const m = e.ctx.peek('match');
  const air = m?.airstrike;
  const rec = (w.demolitions ?? []).find((r) => r.id === 'NF-TOWER');
  const site = (air?.sites ?? []).find((s) => s.id === 'NF-TOWER');
  const T = { x: rec.position.x, z: rec.position.z };
  const R = 25.4;

  /** The site's profile: height over the plain on a 0.25 m grid inside `R`. */
  const profile = () => {
    const S = 0.25;
    const nn = Math.round((R * 2) / S) + 1;
    const h = new Float32Array(nn * nn).fill(NaN);
    let max = -Infinity, sum = 0, cnt = 0, over102 = 0;
    for (let iz = 0; iz < nn; iz++) {
      for (let ix = 0; ix < nn; ix++) {
        const x = T.x - R + ix * S, z = T.z - R + iz * S;
        if (Math.hypot(x - T.x, z - T.z) > R) continue;
        const f = ph.groundHeight(x, z, 60);
        if (!Number.isFinite(f)) continue;
        const d = f - w.groundHeight(x, z);
        h[iz * nn + ix] = d;
        if (d > max) max = d;
        if (d > 1.02) over102++;
        sum += d; cnt++;
      }
    }
    // isolated steps in the 0.42..0.68 band
    let kerbs = 0;
    for (let iz = 1; iz < nn - 1; iz++) {
      for (let ix = 1; ix < nn - 1; ix++) {
        const d = h[iz * nn + ix];
        if (!(d >= 0.42 && d <= 0.68)) continue;
        let below = 0;
        for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
          const q = h[(iz + dz) * nn + (ix + dx)];
          if (Number.isFinite(q) && d - q > 0.3) below++;
        }
        if (below === 4) kerbs++;
      }
    }
    return { samples: cnt, max: +max.toFixed(2), mean: +(sum / cnt).toFixed(2), over_crouch_eye: over102, isolated_kerbs: kerbs };
  };

  /** Nav counts, split by the r 176 rim. */
  const nav = () => {
    const g = ai.grid;
    let inW = 0, inStranded = 0, outW = 0, outStranded = 0;
    // the biggest component is "the ground"
    const tally = new Map();
    for (let i = 0; i < g.flags.length; i++) {
      if (!g.flags[i]) continue;
      const c = g.comp ? g.comp[i] : 0;
      tally.set(c, (tally.get(c) ?? 0) + 1);
    }
    let main = 0, best = -1;
    for (const [c, n] of tally) if (n > best) { best = n; main = c; }
    for (let iz = 0; iz < g.nz; iz++) {
      for (let ix = 0; ix < g.nx; ix++) {
        const i = g.index(ix, iz);
        if (!g.flags[i]) continue;
        const x = g.worldX ? g.worldX(ix) : (ix + 0.5) * g.cell + g.x0;
        const z = g.worldZ ? g.worldZ(iz) : (iz + 0.5) * g.cell + g.z0;
        const inside = Math.hypot(x, z) <= 176;
        const stranded = g.comp ? g.comp[i] !== main : false;
        if (inside) { inW++; if (stranded) inStranded++; }
        else { outW++; if (stranded) outStranded++; }
      }
    }
    return { mainComp: main, insideR176: inW, strandedInside: inStranded, outsideR176: outW, strandedOutside: outStranded };
  };

  const caches = () => (m.caches?.list ?? [])
    .filter((c) => String(c.id).startsWith('NF-TOWER'))
    .map((c) => ({ id: c.id, kind: c.kind, y: +c.position.y.toFixed(2), bot: !!c.botReachable, beacon: c.beacon !== false, disabled: !!c.disabled }));

  const res = { level: w.level.id, intact: {}, razed: {} };
  res.intact.profile = profile();
  res.intact.nav = nav();
  res.intact.caches = caches();

  // …and now the real thing: the site's nav patch AND the record, as `fire` does
  if (site?.nav) air._applyNav(site, true);
  rec.setDown(true);
  m.caches?.update?.(0.016);
  res.razed.profile = profile();
  res.razed.nav = nav();
  res.razed.caches = caches();
  rec.setDown(false);
  if (site?.nav) air._applyNav(site, false);
  res.dropped = !!site?.dropped;
  res.blocking = !!site?.blocking;
  return res;
});

console.log(JSON.stringify(out, null, 1));
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
