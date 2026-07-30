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
 *   2. whether the CATHEDRAL IS VISIBLE from either zone — a real raycast from
 *      eye height at the zone centre to five points up the dome, reporting the
 *      hit distance and the collider that stopped it, not an opinion;
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
  // The cathedral's own centre and section, read off the level rather than
  // retyped: crossing at level (0, -1) * 1.5, dome crown and tower in metres.
  const cathL = { x: 0 * 1.5, z: -1 * 1.5 };
  const cath = world.levelToWorld(cathL.x, 0, cathL.z, new V3());
  const TARGETS = [
    ['dome crown', 23.5],
    ['dome haunch', 19.0],
    ['nave ridge', 15.0],
    ['tower', 29.0],
    ['aisle roof', 7.4],
  ];
  const EYE = 1.62;
  const vis = [];
  const dir = new V3();
  for (const s of m.sites) {
    for (const [label, y] of TARGETS) {
      const from = new V3(s.position.x, s.position.y + EYE, s.position.z);
      const to = new V3(cath.x, cath.y + y, cath.z);
      dir.copy(to).sub(from);
      const dist = dir.length();
      dir.multiplyScalar(1 / dist);
      const h = phys.raycast(from, dir, dist, phys.MASK ? phys.MASK.WORLD : undefined);
      vis.push({
        zone: s.id,
        target: label,
        rangeM: +dist.toFixed(1),
        clear: !h.hit,
        hitM: h.hit ? +h.distance.toFixed(1) : null,
        hitTag: h.hit ? String(h.tag ?? h.name ?? h.surface ?? '?') : null,
        surface: h.hit ? String(h.surface ?? '?') : null,
      });
    }
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
if (errs.length) { console.log('PAGE ERRORS'); for (const e of errs) console.log('  !', e); }
for (const l of logs) console.log('  |', l);
await browser.close();
process.exit(errs.length ? 1 : 0);
