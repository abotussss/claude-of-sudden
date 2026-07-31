/**
 * THE DEMOLITION PROBE — does bringing a building down actually open a way in?
 *
 *   node _demoprobe.mjs [--url=http://127.0.0.1:4252/] [--shot] [--sites]
 *
 * The claim this measures is the one the whole feature is for: "今まで到達でき
 * なかった方向にある建物を物理的に壊し、到達できるようにして". A collapse that
 * only looks good is cosmetic, so this counts APPROACH BEARINGS.
 *
 * An approach bearing is a 10° sector of a 34 m ring round a capture point from
 * which a bot can A* to the point over a path no longer than `DETOUR` times the
 * straight-line distance. Every bearing on this map can reach every point
 * eventually — the map is one connected component and `navcheck` proves it — so
 * "can you get there" measures nothing. What the buildings round A and B do is
 * force you to walk to one of two mouths whatever bearing you arrive on, and
 * that shows up as a path two or three times the straight line. Bringing the row
 * down turns those into straight walks, and THAT is the number.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4252/';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
const logs = [];
page.on('console', (m) => {
  const t = m.text();
  if (/\[world\]|\[airstrike\]|\[ai\] nav|\[match\] zone/.test(t)) logs.push(t.slice(0, 260));
});

console.log(`[demoprobe] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const measure = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const world = e.ctx.peek('world');
  const match = e.ctx.peek('match');
  const grid = ai.grid;
  const RING = 34;
  const SECTORS = 36;
  const DETOUR = 1.30;
  const path = [];

  const zones = (match.sites?.all ?? match.sites ?? []).filter((z) => z.id === 'A' || z.id === 'B');
  const RTOL = 6;      // how far the probe may be slid to find real ground
  const DY = 3.0;      // …and how far off the point's own floor it may be

  /**
   * A START CELL ON THE BEARING, NOT WHEREVER `nearest` LANDS.
   *
   * `grid.nearest` searches outward in rings and will happily hand back a cell
   * on the far side of the wall — or eight metres closer to the point than the
   * ring — which turns the ratio below into a measurement of nothing. So the
   * search is bounded (`RTOL`) and filtered by floor height (`DY`), because a
   * 2.5D height field puts the cell inside a building footprint on its ROOF and
   * a roof cell is not an approach.
   */
  const startCell = (px, pz, y0) => {
    let best = -1;
    let bestD = Infinity;
    const ix0 = grid.cellX(px - RTOL);
    const ix1 = grid.cellX(px + RTOL);
    const iz0 = grid.cellZ(pz - RTOL);
    const iz1 = grid.cellZ(pz + RTOL);
    for (let iz = Math.max(0, iz0); iz <= Math.min(grid.nz - 1, iz1); iz++) {
      for (let ix = Math.max(0, ix0); ix <= Math.min(grid.nx - 1, ix1); ix++) {
        if (!grid.walkable(ix, iz)) continue;
        const i = grid.index(ix, iz);
        if (Math.abs(grid.floor[i] - y0) > DY) continue;
        const d = Math.hypot(grid.worldX(ix) - px, grid.worldZ(iz) - pz);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    if (best < 0 || bestD > RTOL) return null;
    return { x: grid.worldX(best % grid.nx), y: grid.floor[best], z: grid.worldZ((best / grid.nx) | 0) };
  };

  const bearings = () => {
    const out = {};
    for (const z of zones) {
      const c = z.position;
      const hit = [];
      let sum = 0;
      let n = 0;
      const ratios = [];
      for (let s = 0; s < SECTORS; s++) {
        const a = (s / SECTORS) * Math.PI * 2;
        const from = startCell(c.x + Math.cos(a) * RING, c.z + Math.sin(a) * RING, c.y);
        if (!from) { ratios.push(null); continue; }
        const np = grid.findPath(from, c, path);
        if (np <= 0) { ratios.push(null); continue; }
        // `findPath` returns the waypoints AFTER the start, so the first leg
        // has to be added by hand or every ratio comes out under 1.
        let len = Math.hypot(path[0].x - from.x, path[0].z - from.z);
        for (let i = 1; i < np; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
        const straight = Math.hypot(from.x - c.x, from.z - c.z);
        const ratio = len / Math.max(1, straight);
        ratios.push(+ratio.toFixed(2));
        sum += ratio;
        n++;
        if (ratio <= DETOUR) hit.push(Math.round((a * 180) / Math.PI));
      }
      out[z.id] = { hit, ratios, mean: n ? +(sum / n).toFixed(3) : null, probes: n };
    }
    return out;
  };

  const before = bearings();
  // `forceDemoNav` is the whole settled state — the ruin drawn, the ruin solid
  // AND the nav patch in. `world.demolishAll` alone changes collision without
  // touching the height field, which is exactly the thing A* reads.
  const strike = match.airstrike;
  const n = strike.forceDemoNav(true);
  const after = bearings();
  strike.forceDemoNav(false);
  const again = bearings();

  return {
    demolished: n,
    list: (world.demolitions ?? []).map((d) => ({ id: d.id, zone: d.zone, opens: d.opens })),
    before, after, again,
    walkable: grid.walkableCount,
  };
});

const fmt = (o) =>
  Object.entries(o)
    .map(([k, v]) => `${k}: ${v.hit.length}/${v.probes} direct, mean detour ${v.mean}x  [${v.hit.join(' ')}]`)
    .join('\n    ');

console.log(`\n[demoprobe] ${measure.demolished} buildings brought down: ` +
  measure.list.map((d) => `${d.id}${d.opens ? '*' : ''}`).join(' '));
console.log(
  `\n  APPROACH BEARINGS (34 m ring, 36 sectors). A bearing counts when there is ground` +
  ` on it at the point's own level AND the path in is <= 1.30x the straight line.`
);
console.log(`  BEFORE\n    ${fmt(measure.before)}`);
console.log(`  AFTER\n    ${fmt(measure.after)}`);
console.log(`  RESTORED\n    ${fmt(measure.again)}`);
for (const id of Object.keys(measure.before)) {
  const b = measure.before[id];
  const a = measure.after[id];
  console.log(
    `  zone ${id}: approach bearings ${b.hit.length} -> ${a.hit.length} ` +
      `(${a.hit.length - b.hit.length >= 0 ? '+' : ''}${a.hit.length - b.hit.length}), ` +
      `mean detour ${b.mean}x -> ${a.mean}x, sectors with ground on them ` +
      `${b.probes} -> ${a.probes}`
  );
  const gained = a.hit.filter((x) => !b.hit.includes(x));
  const lost = b.hit.filter((x) => !a.hit.includes(x));
  console.log(`      opened: [${gained.join(' ')}]   lost: [${lost.join(' ')}]`);
}
console.log(`  walkable cells: ${measure.walkable}`);

if (args.shot) {
  fs.mkdirSync('shots', { recursive: true });
  await page.screenshot({ path: 'shots/demoprobe.png' });
}

console.log('\n[demoprobe] boot log:');
for (const l of logs) console.log('   ', l);
if (errors.length) {
  console.log('\n[demoprobe] PAGE ERRORS:');
  for (const e of errors) console.log('   ', e);
}
await browser.close();
process.exit(errors.length ? 1 : 0);
