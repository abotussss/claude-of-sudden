/**
 * HOW BURIED IS D? — 「大聖堂のDサイトが瓦礫に埋まりすぎ」
 *
 *   node _dbury.mjs [--url=…] [--seed=N]
 *
 * `_dmass.mjs` answers "is there ENOUGH cover at D" (sitecheck's floor). This
 * answers the opposite question, which is the one the player asked: how much of
 * the capture point is FLOOR a man can stand and move on, against the four
 * zones that are not in a ruin. Three numbers per zone, all on the same map
 * after the cathedral has come down on the real path:
 *
 *   - walkable  the nav grid's own cells inside the circle. The honest measure
 *               of "a point people can fight in": a cell nobody can stand on is
 *               not contested ground however good it looks.
 *   - blocked   the m² of the circle whose surface is over 0.42 m — the
 *               controller's step. Rubble you have to go round.
 *   - cover     sitecheck's 0.9-2.8 m band, which is what `_dmass` gates on and
 *               what has overshot.
 *
 * …and then an ASCII plan of D's own circle, so the answer to "where is it
 * buried" is a picture rather than an average.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4382/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL + (args.seed ? `?seed=${args.seed}` : ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

await page.evaluate(() => (window.__ENGINE__.time.scale = 10));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._checkWinConditions = () => {};
  m.roundClock = 1e6;
  m.score[0] = 999;
});
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').sites.some((z)=>z.id==='D')", null, { timeout: 300000 });
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await page.waitForTimeout(1500);

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  const ph = e.ctx.peek('physics');
  const MASK = ph.MASK.WORLD;
  const g = ai.grid;
  const top = (x, z, from) => {
    const h = ph.raycast(x, from, z, 0, -1, 0, from + 10, MASK);
    return h.hit ? h.point.y : null;
  };
  const rows = [];
  for (const z of m.allZones) {
    const C = z.position;
    const R = z.radius;
    let cells = 0;
    let walk = 0;
    for (let iz = 0; iz < g.nz; iz++) {
      for (let ix = 0; ix < g.nx; ix++) {
        const x = g.worldX(ix);
        const zz = g.worldZ(iz);
        if (Math.hypot(x - C.x, zz - C.z) > R) continue;
        cells++;
        if (g.flags[g.index(ix, iz)]) walk++;
      }
    }
    let tot = 0;
    let over = 0;
    let cover = 0;
    for (let dz = -R; dz <= R + 1e-6; dz += 0.5) {
      for (let dx = -R; dx <= R + 1e-6; dx += 0.5) {
        if (Math.hypot(dx, dz) > R) continue;
        const y = top(C.x + dx, C.z + dz, C.y + 6);
        if (y == null) continue;
        tot++;
        const rise = y - C.y;
        if (rise > 0.42) over++;
        if (rise >= 0.9 && rise <= 2.8) cover++;
      }
    }
    let high = 0;
    for (const p of ai.cover?.points ?? []) {
      if (Math.abs(p.y - C.y) > 3) continue;
      if (Math.hypot(p.x - C.x, p.z - C.z) > R) continue;
      if (p.high) high++;
    }
    rows.push({
      id: z.id,
      live: m.sites.includes(z),
      r: +R.toFixed(1),
      walkPct: +((100 * walk) / Math.max(1, cells)).toFixed(1),
      walk,
      cells,
      overPct: +((100 * over) / Math.max(1, tot)).toFixed(1),
      blockedM2: +(over * 0.25).toFixed(1),
      coverM2: +(cover * 0.25).toFixed(1),
      high,
    });
  }

  /* ---- the picture of D ------------------------------------------------ */
  const d = m.allZones.find((z) => z.id === 'D');
  const R = d.radius;
  const S = 0.8;
  const map = [];
  for (let dz = -R; dz <= R + 1e-6; dz += S) {
    let line = '';
    for (let dx = -R; dx <= R + 1e-6; dx += S) {
      if (Math.hypot(dx, dz) > R) { line += ' '; continue; }
      const y = top(d.position.x + dx, d.position.z + dz, d.position.y + 6);
      if (y == null) { line += '?'; continue; }
      const r = y - d.position.y;
      line += r > 2.8 ? '#' : r > 1.8 ? 'X' : r > 0.9 ? 'x' : r > 0.42 ? '+' : r > 0.15 ? '.' : '_';
    }
    map.push(line);
  }
  /* ---- and the nav grid's own opinion of the same circle, cell by cell -- */
  const g2 = g;
  const nav = [];
  const why = { high: 0, capsule: 0, shellStale: 0, noHit: 0, slope: 0, ok: 0 };
  const iz0 = g2.cellZ(d.position.z - R);
  const iz1 = g2.cellZ(d.position.z + R);
  const ix0 = g2.cellX(d.position.x - R);
  const ix1 = g2.cellX(d.position.x + R);
  const V3 = e.camera.position.constructor;
  const p0 = new V3();
  const p1 = new V3();
  for (let iz = iz0; iz <= iz1; iz++) {
    let line = '';
    for (let ix = ix0; ix <= ix1; ix++) {
      const x = g2.worldX(ix);
      const z = g2.worldZ(iz);
      if (Math.hypot(x - d.position.x, z - d.position.z) > R) { line += ' '; continue; }
      const f = g2.flags[g2.index(ix, iz)];
      if (f) { line += f === 2 ? 'c' : '.'; why.ok++; continue; }
      // why not? re-run the two tests `_carveInteriors` applies, here and now.
      const down = ph.raycast(x, d.position.y + 14, z, 0, -1, 0, 24, MASK);
      if (!down.hit) { line += '?'; why.noHit++; continue; }
      const fy = down.point.y;
      if (fy > d.position.y + 0.9) { line += 'H'; why.high++; continue; }
      if (down.normal.y < g2.maxSlope) { line += 'S'; why.slope++; continue; }
      // `checkCapsule` TRUE means the capsule FITS. A cell that fits NOW but is
      // flagged 0 was refused at boot, when the SHELL was solid too — and
      // `_reprobeZoneNav` may only ever close a cell, so it is dead ground the
      // ruin is not responsible for.
      p0.set(x, fy + g2.radius + 0.06, z);
      p1.set(x, fy + g2.height - g2.radius, z);
      if (ph.checkCapsule(p0, p1, g2.radius, MASK)) { line += 'F'; why.shellStale++; continue; }
      p1.set(x, fy + g2.crouchHeight - g2.radius, z);
      if (ph.checkCapsule(p0, p1, g2.radius, MASK)) { line += 'f'; why.shellStale++; continue; }
      line += '!';
      why.capsule++;
    }
    nav.push(line);
  }
  return { rows, map, nav, why, dR: +R.toFixed(1), cell: +g2.cell.toFixed(2), radius: +g2.radius.toFixed(2) };
});

console.log('\n  zone live   r     nav walkable        surface over 0.42 m      cover 0.9-2.8 m   standing pts');
for (const r of out.rows) {
  console.log(
    `   ${r.id.padEnd(4)} ${String(r.live).padEnd(6)} ${String(r.r).padStart(4)}  ` +
      `${String(r.walk).padStart(4)}/${String(r.cells).padEnd(4)} ${String(r.walkPct).padStart(5)}%   ` +
      `${String(r.blockedM2).padStart(6)} m² ${String(r.overPct).padStart(5)}%   ` +
      `${String(r.coverM2).padStart(6)} m²        ${String(r.high).padStart(4)}`
  );
}
console.log(`\n  D, plan of the circle (r=${out.dR} m, 0.8 m cells) — _ under 0.15  . 0.15  + 0.42  x 0.9  X 1.8  # 2.8+`);
for (const l of out.map) console.log(`   ${l}`);
console.log(
  `\n  D, the NAV GRID's plan (cell ${out.cell} m, bot radius ${out.radius} m)` +
    ` — . walkable  c crouch  H floor over 0.9 m  ! the capsule does not fit  ? no floor`
);
for (const l of out.nav) console.log(`   ${l}`);
console.log(`   why: ${JSON.stringify(out.why)}`);
console.log('\n  pageErrors', errs.length ? errs.slice(0, 4) : 'none');
await browser.close();
