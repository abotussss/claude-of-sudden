/**
 * THE ZONE-PLACEMENT PROBE.
 *
 *   node _cityprobe.mjs [--url=http://127.0.0.1:4250/]
 *
 * Three questions no existing gate asks, all of them about WHERE the two
 * outer capture points ended up rather than whether they resolve:
 *
 *   1. the LONGEST spawn -> zone A* route on the map, which is the number the
 *      distance between A and B is actually bounded by;
 *   2. whether the CATHEDRAL IS VISIBLE from either zone — real raycasts from
 *      eye height, reporting the hit distance and the surface that stopped each
 *      one rather than an opinion. Two passes: five named points up the section
 *      from the zone CENTRE, and then 1 600 rays per zone from sixteen stances
 *      round the capture circle to a lattice over the whole building, because
 *      five rays from one square metre is not "you cannot see it";
 *   3. that B is still the exact 180-degree rotation image of A about the
 *      cathedral centre, which is the only thing that keeps a mode that never
 *      swaps ends fair.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4250/';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errs = [];
const logs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => {
  const t = m.text();
  if (/\[match\]|\[ai\] nav|\[world\]/.test(t)) logs.push(t);
});
const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const bootMs = Date.now() - t0;

const r = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const world = e.ctx.peek('world');
  const ai = e.ctx.peek('ai');
  const phys = e.ctx.peek('physics');
  const V3 = m.sites[0].position.constructor;
  const W2L = (p) => world.worldToLevel(p.x, p.y, p.z, new V3());

  /* ---- routes ---------------------------------------------------------- */
  const g = ai.grid;
  const path = [];
  /**
   * `findPath` writes into `out` and returns a COUNT — it never truncates the
   * array, so anything past `n` is a stale waypoint from an earlier query.
   * Reading `out.length` instead of `n` inflates every route on the map. The
   * walk starts at the spawn, so the first leg is spawn -> waypoint 0.
   */
  const len = (p, n, from) => {
    let d = 0;
    let a = from;
    for (let i = 0; i < n; i++) {
      d += Math.hypot(p[i].x - a.x, p[i].z - a.z);
      a = p[i];
    }
    return d;
  };
  const routes = [];
  let fails = 0;
  for (const kind of ['attack', 'defend']) {
    for (let i = 0; i < m.spawns[kind].length; i++) {
      const sp = m.spawns[kind][i].position;
      for (const s of m.sites) {
        const n = g.findPath(sp, s.position, path);
        if (n <= 0) { fails++; routes.push({ kind, i, zone: s.id, m: -1 }); continue; }
        routes.push({ kind, i, zone: s.id, m: +len(path, n, sp).toFixed(1) });
      }
    }
  }
  const ok = routes.filter((x) => x.m > 0);
  ok.sort((a, b) => b.m - a.m);

  /* ---- cathedral visibility -------------------------------------------- */
  /**
   * The cathedral's plan and section are read off `world.layout`, not retyped,
   * so this cannot go stale when the building moves. `CATHEDRAL.w/d/x/z` are
   * already scaled; the heights in it are metres and never scale.
   */
  const C = world.layout.CATHEDRAL;
  const cath = world.levelToWorld(C.x, 0, C.z, new V3());
  const TARGETS = [
    ['campanile', C.towerY],
    ['dome crown', C.domeY],
    ['dome haunch', (C.domeY + C.naveY) / 2],
    ['nave ridge', C.naveY],
    ['aisle roof', C.aisleY],
  ];
  const EYE = 1.62;
  const MASK = phys.MASK.WORLD;
  const vis = [];
  const dir = new V3();
  const shoot = (from, to) => {
    dir.copy(to).sub(from);
    const dist = dir.length();
    dir.multiplyScalar(1 / dist);
    const h = phys.raycast(from, dir, dist, MASK);
    return { dist, hit: h.hit, d: h.hit ? h.distance : null, tag: h.hit ? String(h.tag ?? h.surface ?? '?') : null };
  };
  for (const s of m.sites) {
    for (const [label, y] of TARGETS) {
      const from = new V3(s.position.x, s.position.y + EYE, s.position.z);
      const r = shoot(from, new V3(cath.x, cath.y + y, cath.z));
      vis.push({
        zone: s.id, target: label, rangeM: +r.dist.toFixed(1), clear: !r.hit,
        hitM: r.hit ? +r.d.toFixed(1) : null, hitTag: r.tag,
      });
    }
  }
  /**
   * …AND THE SAME QUESTION ASKED OF THE WHOLE BUILDING FROM THE WHOLE CIRCLE.
   * A capture point is 16 m across and the cathedral is 30 x 45 m of masonry
   * 23 m tall; five rays from one square metre is not "you cannot see it".
   * 16 stances around the capture radius x a 5 x 5 x 4 lattice over the
   * building's bounding box = 1600 rays per zone, every one of them from eye
   * height, and the answer is how many arrived.
   */
  const sweep = [];
  for (const s of m.sites) {
    let clear = 0, total = 0, nearest = Infinity, nearestAt = null;
    for (let a = 0; a < 16; a++) {
      const th = (a / 16) * Math.PI * 2;
      const px = s.position.x + Math.cos(th) * s.radius;
      const pz = s.position.z + Math.sin(th) * s.radius;
      const gy = ai.groundAt?.(px, pz, 4);
      const from = new V3(px, (Number.isFinite(gy) ? gy : s.position.y) + EYE, pz);
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          for (let k = 0; k < 4; k++) {
            const to = new V3(
              cath.x + (i / 4 - 0.5) * C.w,
              cath.y + C.floorY + (k / 3) * C.domeY,
              cath.z + (j / 4 - 0.5) * C.d
            );
            const r = shoot(from, to);
            total++;
            if (!r.hit) { clear++; if (r.dist < nearest) { nearest = r.dist; nearestAt = [i, j, k]; } }
          }
        }
      }
    }
    sweep.push({ zone: s.id, clear, total, nearest: clear ? +nearest.toFixed(1) : null, nearestAt });
  }

  return {
    walkable: ai.stats.walkable,
    grid: [ai.grid.nx, ai.grid.nz],
    zones: m.sites.map((s) => {
      const l = W2L(s.position);
      return {
        id: s.id,
        name: s.name,
        level: [+l.x.toFixed(2), +l.z.toFixed(2)],
        authored: [+(l.x / 1.5).toFixed(2), +(l.z / 1.5).toFixed(2)],
        world: [+s.position.x.toFixed(1), +s.position.y.toFixed(2), +s.position.z.toFixed(1)],
        stand: s.stand.length,
        r: s.radius,
      };
    }),
    routeFails: fails,
    longest: ok.slice(0, 8),
    perZone: m.sites.map((s) => {
      const mine = ok.filter((x) => x.zone === s.id);
      return {
        zone: s.id,
        maxM: mine.length ? mine[0].m : -1,
        attackMinM: Math.min(...mine.filter((x) => x.kind === 'attack').map((x) => x.m)),
        defendMinM: Math.min(...mine.filter((x) => x.kind === 'defend').map((x) => x.m)),
      };
    }),
    vis,
    sweep,
    cathWorld: [+cath.x.toFixed(1), +cath.y.toFixed(2), +cath.z.toFixed(1)],
  };
});

console.log(`boot ${(bootMs / 1000).toFixed(1)} s · walkable ${r.walkable} · grid ${r.grid}`);
console.log('ZONES');
for (const z of r.zones)
  console.log(
    `  ${z.id} ${z.name.padEnd(22)} authored (${z.authored[0]}, ${z.authored[1]}) ` +
      `world (${z.world[0]}, ${z.world[2]}) · ${z.stand} stand · r${z.r}`
  );
const zs = Object.fromEntries(r.zones.map((z) => [z.id, z]));
if (zs.A && zs.B) {
  const d = Math.hypot(zs.A.world[0] - zs.B.world[0], zs.A.world[2] - zs.B.world[2]);
  const rhoX = -zs.A.authored[0], rhoZ = -2 - zs.A.authored[1];
  console.log(
    `  A-B ${d.toFixed(1)} m · rho(A) = (${rhoX.toFixed(2)}, ${rhoZ.toFixed(2)}) ` +
      `vs B (${zs.B.authored[0]}, ${zs.B.authored[1]}) ` +
      `· mirror err ${Math.hypot(rhoX - zs.B.authored[0], rhoZ - zs.B.authored[1]).toFixed(3)} units`
  );
}
console.log(`ROUTES  fails ${r.routeFails}`);
for (const p of r.perZone)
  console.log(`  ${p.zone}: longest ${p.maxM} m · nearest attack ${p.attackMinM} m · nearest defend ${p.defendMinM} m`);
console.log('  top:', r.longest.map((x) => `${x.kind}${x.i}->${x.zone} ${x.m}`).join('  '));
console.log(`CATHEDRAL VISIBILITY  (crossing at world ${r.cathWorld})`);
for (const v of r.vis)
  console.log(
    `  ${v.zone} -> ${v.target.padEnd(12)} ${String(v.rangeM).padStart(6)} m  ` +
      (v.clear ? '*** CLEAR — VISIBLE ***' : `blocked at ${String(v.hitM).padStart(6)} m by ${v.hitTag} [${v.surface}]`)
  );
console.log('  SWEEP — 16 stances round each circle x a 5x5x4 lattice over the whole building');
for (const s of r.sweep)
  console.log(`  ${s.zone}: ${s.clear} of ${s.total} rays arrived` + (s.clear ? ` — NEAREST CLEAR ${s.nearest} m at ${s.nearestAt}` : ' — none'));
if (errs.length) { console.log('PAGE ERRORS'); for (const e of errs) console.log('  !', e); }
for (const l of logs) console.log('  |', l);
await browser.close();
process.exit(errs.length ? 1 : 0);
