/**
 * ZONE SPOT — is there anywhere to PUT a capture zone at a given world point?
 *
 * Written because I moved the zones by guessing an authored coordinate four
 * times and three of those builds would not boot: `ensureReachable` searches
 * forever when the point has no walkable ground near it, so the failure mode is
 * a 240 s timeout with no message. Guessing is not a method.
 *
 * This asks the question directly, on a build that DOES boot, without moving
 * anything: for each candidate world (x, z) it reports the walkable nav cells
 * inside the capture radius, how many of those are far enough from a wall to
 * stand a man on, and whether the point is enclosed (a ray in eight directions
 * that never hits anything is open ground outside the map, not a courtyard).
 *
 *   node tools/zonespot.mjs --at=-56,80.4 --at=56,-80.4
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const ats = args.filter((a) => a.startsWith('--at=')).map((a) => a.slice(5).split(',').map(Number));
const URL = (args.find((a) => a.startsWith('--url=')) ?? '--url=http://127.0.0.1:4188/').slice(6);
if (!ats.length) { console.log('usage: --at=x,z [--at=x,z …]'); process.exit(2); }

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const rows = await page.evaluate((ats) => {
  const e = window.__ENGINE__, ai = e.ctx.peek('ai'), ph = e.ctx.peek('physics');
  const g = ai.grid;
  const V = e.ctx.camera.position.constructor;
  const out = [];
  for (const [wx, wz] of ats) {
    /**
     * Read `flags` directly. My first version called `grid.nearest(vec3)` and
     * got 0 walkable cells at EVERY point including the zone that demonstrably
     * works — the signature is `nearest(x, z, y, maxRings, yTol)`, separate
     * scalars, so passing a Vector3 made `z` undefined and every lookup missed.
     * A measurement that reports zero everywhere is not a measurement.
     */
    const R = 8, step = g.cell;
    let walkable = 0, total = 0;
    for (let dx = -R; dx <= R; dx += step) {
      for (let dz = -R; dz <= R; dz += step) {
        if (dx * dx + dz * dz > R * R) continue;
        total++;
        const ix = Math.round((wx + dx - g.minX) / g.cell);
        const iz = Math.round((wz + dz - g.minZ) / g.cell);
        if (ix < 0 || iz < 0 || ix >= g.nx || iz >= g.nz) continue;
        if (g.flags[iz * g.nx + ix]) walkable++;
      }
    }
    /**
     * REACHABLE FROM A SPAWN — the check whose absence wasted four attempts.
     *
     * I moved a zone to a point this tool called "ok": 100% walkable cells, all
     * eight bearings enclosed by wall at 5 m. navcheck then failed 90 of 90
     * pairs. The point was a SEALED COURTYARD — walkable and enclosed and not
     * connected to anything. Walkable is not reachable, and neither is enclosed.
     */
    let reachable = null;
    try {
      const m = e.ctx.peek('match');
      const sp = (m.spawns?.attack ?? [])[0]?.position;
      if (sp) {
        const path = [];
        const n = ai.grid.findPath(sp, new V(wx, 0, wz), path);
        reachable = n > 0;
      }
    } catch { reachable = null; }

    // enclosed? eight rays at chest height; a ray that reaches 120 m unobstructed
    // is looking out of the map, not across a street
    const from = new V(wx, 1.4, wz);
    let open = 0; const hits = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const d = new V(Math.cos(a), 0, Math.sin(a));
      let h = null;
      try { h = ph.raycast?.(from, d, 120); } catch { h = null; }
      if (!h) open++;
      hits.push(h ? +(h.distance ?? h.t ?? -1).toFixed(0) : null);
    }
    out.push({ at: [wx, wz], walkableCells: walkable, ofCells: total,
               walkablePct: +(100 * walkable / total).toFixed(0), openBearings: open,
               wallDist: hits, reachable });
  }
  return out;
}, ats);

console.log('\n  world point     walkable  reachable  minWall   distance to wall per bearing');
for (const r of rows) {
  const minWall = Math.min(...r.wallDist.map((x) => (x === null ? 999 : x)));
  const bad = !r.reachable ? '   <-- NOT REACHABLE from a spawn'
    : r.walkablePct < 60 ? '   <-- not enough ground'
    : r.openBearings >= 4 ? '   <-- open, probably outside the walls'
    : minWall < 3 ? '   <-- too tight to stand in'
    : '   ok';
  console.log(`  ${String(r.at).padEnd(15)} ${String(r.walkablePct + '%').padStart(6)}  ${String(r.reachable).padStart(9)}  ${String(minWall).padStart(7)}   [${r.wallDist.join(', ')}]${bad}`);
}
await browser.close();
