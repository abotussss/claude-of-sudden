/**
 * IS THERE AN INDOORS IN THE HEIGHT FIELD, AND CAN A BOT GET TO IT?
 *
 *   node _indoornav.mjs [--url=…] [--boots=1]
 *
 * `_navin.mjs` asked the first half of this and answered "every walkable cell
 * inside an enterable footprint is at 3.2 / 6.5 / 9.6 m and ZERO are at ground
 * level". This asks both halves, per building, per boot:
 *
 *   cells      walkable cells inside the footprint, and how many are GROUND
 *   flood      how many of those a flood fill from an attacker spawn reaches,
 *              using the grid's own step rule (`NavGrid._canStep`)
 *   A*         whether `findPath` from each of the thirty spawn points lands a
 *              route on the cell nearest the building's own centre
 *
 * …and then it WALKS the routes: every leg of every path it solved is swept with
 * the bot's own 0.36 m capsule, and any leg the capsule cannot make is reported.
 * A grid that has just been told the inside of a building is walkable has to be
 * asked whether it thinks a wall is too, and the string pull is where that would
 * show up — a shortcut across a doorjamb is a leg no capsule can walk.
 *
 * THE DRESSING DICE ARE RE-ROLLED EVERY BOOT (`config.deterministic` is false
 * outside `?capture=1`), and a wardrobe can land across a doorway, so `--boots`
 * runs the whole thing N times in N fresh pages and prints every one. A single
 * boot is an anecdote.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4216/';
const BOOTS = Number(args.boots ?? 1);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const errors = [];

for (let boot = 1; boot <= BOOTS; boot++) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message)));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
  const out = await page.evaluate(() => {
    const e = window.__ENGINE__;
    const world = e.ctx.peek('world');
    const ai = e.ctx.peek('ai');
    const m = e.ctx.peek('match');
    const g = ai.grid;
    const V3 = e.ctx.camera.position.constructor;
    const s = new V3();
    const DX = [1, -1, 0, 0, 1, 1, -1, -1];
    const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
    const n = g.nx * g.nz;
    const B = world.layout.BUILDINGS.filter((b) => b.enterable);
    const own = new Int8Array(n).fill(-1);
    for (let iz = 0; iz < g.nz; iz++) {
      for (let ix = 0; ix < g.nx; ix++) {
        world.worldToLevel(g.worldX(ix), 0, g.worldZ(iz), s);
        for (let k = 0; k < B.length; k++) {
          const b = B[k];
          if (Math.abs(s.x - b.x) < b.w / 2 - 0.6 && Math.abs(s.z - b.z) < b.d / 2 - 0.6) {
            own[iz * g.nx + ix] = k;
            break;
          }
        }
      }
    }
    // flood the whole grid from one attacker spawn, with the grid's own rules
    const seen = new Uint8Array(n);
    const q = [];
    const sp = m.spawns.attack[0].position;
    const start = g.nearest(sp.x, sp.z, sp.y);
    if (start >= 0) { seen[start] = 1; q.push(start); }
    for (let h = 0; h < q.length; h++) {
      const cur = q[h];
      const cxi = cur % g.nx, czi = (cur / g.nx) | 0;
      const cy = g.floor[cur];
      for (let d = 0; d < 8; d++) {
        const ix = cxi + DX[d], iz = czi + DZ[d];
        if (!g.walkable(ix, iz)) continue;
        // `_canStep` is the grid's own rule; a build without the interior pass
        // only has the corner rule, so fall back to it and stay comparable.
        if (g._canStep
          ? !g._canStep(cur, cxi, czi, d)
          : (DX[d] && DZ[d] && (!g.walkable(cxi + DX[d], czi) || !g.walkable(cxi, czi + DZ[d])))) continue;
        const ni = g.index(ix, iz);
        if (seen[ni] || Math.abs(g.floor[ni] - cy) > g.maxStep) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    const path = [];
    const rows = [];
    /**
     * WALK every leg of a solved path with the capsule the bot actually is.
     *
     * NOT a single long capsule sweep: the ground is not flat, and a 20 m sweep
     * at one height reports every kerb, ramp and rubble mound on the map as a
     * blockage (measured: 802 of 1393 legs, all of them outdoors and all of them
     * nonsense). A man walks by re-grounding every step, so this samples the leg
     * every 0.4 m, drops onto the floor under that point and asks whether he
     * fits standing there. What survives is the real question — does a route go
     * through a wall — and the answer is reported separately for the legs that
     * are inside a footprint, which are the new ones.
     */
    const phys = e.ctx.peek('physics');
    const R = 0.36;
    const mk = () => ({ total: 0, blocked: 0, samples: 0, brushed: 0, deep: 0,
                        indoorSamples: 0, indoorBlocked: 0, indoorDeep: 0, worst: [] });
    const legs = mk();
    /** The same walk on the routes every build has: spawn -> capture zone. */
    const zlegs = mk();
    const a0 = new V3(), a1 = new V3(), lv = new V3();
    const indoorAt = (x, z) => {
      world.worldToLevel(x, 0, z, lv);
      for (const b of B) {
        if (Math.abs(lv.x - b.x) < b.w / 2 && Math.abs(lv.z - b.z) < b.d / 2) return true;
      }
      return false;
    };
    let acc = legs;
    const walkLegs = (from, pts, count, tag) => {
      let px = from.x, py = from.y, pz = from.z;
      for (let i = 0; i < count; i++) {
        const w = pts[i];
        const dx = w.x - px, dz = w.z - pz;
        const dist = Math.hypot(dx, dz);
        const steps = Math.ceil(dist / 0.4);
        let bad = 0;
        let y = py;
        for (let t = 1; t <= steps; t++) {
          const x = px + (dx * t) / steps;
          const z = pz + (dz * t) / steps;
          const gy = phys.groundHeight(x, z, y + 1.4, phys.MASK.WORLD);
          if (Number.isFinite(gy) && Math.abs(gy - y) < 1.2) y = gy;
          a0.set(x, y + R + 0.06, z);
          a1.set(x, y + 1.78 - R, z);
          const inside = indoorAt(x, z);
          acc.samples++;
          if (inside) acc.indoorSamples++;
          if (!phys.checkCapsule(a0, a1, R, phys.MASK.WORLD)) {
            bad++;
            acc.brushed++;
            if (inside) acc.indoorBlocked++;
            /**
             * A 0.36 m capsule that does not fit is a man brushing a jamb, a
             * crate or a kerb — the grid has never promised 0.36 m of clearance
             * along the line BETWEEN two cells, only at each cell. A 0.08 m one
             * that does not fit is a point INSIDE the geometry, i.e. a route
             * through a wall, which is the only failure that matters here.
             */
            a0.set(x, y + 0.9, z);
            a1.set(x, y + 1.4, z);
            if (!phys.checkCapsule(a0, a1, 0.08, phys.MASK.WORLD)) {
              acc.deep++;
              if (inside) acc.indoorDeep++;
            }
          }
        }
        if (steps > 0) acc.total++;
        if (bad > 0) {
          acc.blocked++;
          if (acc.worst.length < 6) {
            acc.worst.push(`${tag} leg ${i}: ${bad}/${steps} samples`);
          }
        }
        px = w.x; py = w.y; pz = w.z;
      }
    };
    let totalGround = 0, totalReach = 0;
    for (let k = 0; k < B.length; k++) {
      const b = B[k];
      let cells = 0, ground = 0, reached = 0;
      let best = -1, bestD = Infinity;
      const mid = world.levelToWorld(b.x, 0, b.z, new V3());
      for (let i = 0; i < n; i++) {
        if (own[i] !== k || !g.flags[i]) continue;
        cells++;
        if (g.floor[i] > 2.5) continue;
        ground++;
        if (seen[i]) reached++;
        const d = (g.worldX(i % g.nx) - mid.x) ** 2 + (g.worldZ((i / g.nx) | 0) - mid.z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      let routes = 0;
      if (best >= 0) {
        const q2 = new V3(g.worldX(best % g.nx), g.floor[best], g.worldZ((best / g.nx) | 0));
        for (const kind of ['attack', 'defend']) {
          for (const spn of m.spawns[kind]) {
            const np = g.findPath(spn.position, q2, path);
            if (np <= 0) continue;
            routes++;
            walkLegs(spn.position, path, np, b.id);
          }
        }
      }
      totalGround += ground;
      totalReach += reached;
      rows.push(`  ${b.id.padEnd(3)} inside=${String(cells).padStart(4)} ground=${String(ground).padStart(4)}` +
        ` (${(ground * 0.64).toFixed(0).padStart(3)} m2)  flood=${String(reached).padStart(4)}` +
        `  A* to the middle ${routes}/30`);
      }
    acc = zlegs;
    for (const site of m.sites) {
      for (const kind of ['attack', 'defend']) {
        for (const spn of m.spawns[kind]) {
          const np = g.findPath(spn.position, site.position, path);
          if (np > 0) walkLegs(spn.position, path, np, site.id);
        }
      }
    }
    return {
      zlegs,
      head: `grid ${g.nx}x${g.nz} · walkable ${g.walkableCount} · indoor ${g.interiorCells}` +
        ` · apron ${g.apronCells} · diagonals re-opened ${g.diagCells} · build ${g.buildMs.toFixed(0)}ms`,
      rows, totalGround, totalReach,
      legs,
      caches: `${m.caches.botList.length} of ${m.caches.list.filter((c) => c.botReachable).length} ` +
        `ground-floor caches proved: ${m.caches.botList.map((c) => c.id).join(' ')}`,
    };
  });
  console.log(`\n[indoornav] boot ${boot} — ${out.head}`);
  for (const r of out.rows) console.log(r);
  console.log(`  TOTAL ground cells ${out.totalGround} (${(out.totalGround * 0.64).toFixed(0)} m2), ` +
    `${out.totalReach} of them reachable from a spawn by flood`);
  console.log(`  ${out.caches}`);
  console.log(`  path legs walked with the 0.36 m capsule: ${out.legs.total}, ` +
    `${out.legs.blocked} with a sample the capsule does not fit` +
    `${out.legs.worst.length ? ' — ' + out.legs.worst.join('; ') : ''}`);
  console.log(`  ${out.legs.samples} samples: ${out.legs.brushed} where the 0.36 m capsule grazes something, ` +
    `${out.legs.deep} INSIDE geometry (a route through a wall)`);
  console.log(`  of the ${out.legs.indoorSamples} samples inside a footprint: ${out.legs.indoorBlocked} graze, ` +
    `${out.legs.indoorDeep} inside geometry`);
  console.log(`  CONTROL, the spawn->zone routes every build has: ${out.zlegs.samples} samples, ` +
    `${out.zlegs.brushed} graze, ${out.zlegs.deep} inside geometry ` +
    `(${out.zlegs.indoorSamples} of the samples are inside a footprint)`);
  await page.close();
}
if (errors.length) console.log('\n[indoornav] errors', errors.slice(0, 4));
await browser.close();
process.exit(errors.length ? 1 : 0);
