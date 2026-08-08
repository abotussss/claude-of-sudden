/**
 * BAKE A CANDIDATE SPOKE WITH THE ENGINE'S OWN BAKER — no replication.
 *
 *   BASE=http://127.0.0.1:4628/ MAP=plains node _ptankleg.mjs \
 *     '[{"id":"BLUE-C","zone":"E","points":[[-48,32],[-44,-6],[-30,-60],[30,-88],[96,-84]]}]'
 *
 * `_tankroute.mjs` re-implements `Armour._bakePath` and hard-codes the TOWN's
 * 1.5 scale and the town's `?capture=1` append; on the plain both are wrong and
 * a re-implementation drifts from the thing it is testing the day either moves.
 * This calls the LIVE `Armour` instance's own `_bakePath`, `_trimToStandoff`
 * and `_trimAtBlockers` in the order `_bakeLegs` calls them, with the same
 * prop index and the same hub — the hub being `legs[0]`'s baked end, exactly
 * what a spoke's first point is replaced by — so a PASS here is the boot bake.
 *
 * It also prints every `[tank]` line the boot emitted, which is where the
 * SPOKE DROPPED warnings live.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4628/';
const MAP = process.env.MAP ?? 'plains';
const CANDIDATES = JSON.parse(process.argv[2] ?? '[]');

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
const logs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { const t = m.text(); if (/\[tank\]/.test(t)) logs.push(t); });
await page.goto(`${BASE}?capture=1&map=${MAP}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('level.id =', await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

console.log('\n=== BOOT [tank] LINES ===');
for (const l of logs) console.log('  ' + l);

const out = await page.evaluate((CANDIDATES) => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const m = ctx.peek('match');
  const world = ctx.peek('world');
  const physics = ctx.peek('physics');
  const A = m.tank;
  const V3 = ctx.camera.position.constructor;
  const props = A._buildPropIndex ? A._buildPropIndex() : null;
  const zones = A._zoneCentres();
  const rows = [];
  for (const c of CANDIDATES) {
    const tank = (A.tanks ?? []).find((t) => t.id === c.id);
    if (!tank) { rows.push({ id: c.id, zone: c.zone, error: 'no such tank' }); continue; }
    const a = tank.legs[0];
    const hub = new V3(a.X[a.n - 1], a.Y[a.n - 1], a.Z[a.n - 1]);
    const target = zones.find((z) => z.id === c.zone);
    const wp = c.points.map((p, i) =>
      i === 0 ? hub.clone() : world.levelToWorld(p[0], 0, p[1], new V3()));
    // `_bakeLegs` appends the zone centre when the authored end is outside
    // ZONE_ENTER; mirror it rather than guess at the constant.
    const lastP = wp[wp.length - 1];
    // `Math.max(3.5, RULES.captureRadius - STEP*2 - 0.5)` — read off the rules
    // the match is actually running rather than typed.
    const ZONE_ENTER = Math.max(3.5, (m.rules?.captureRadius ?? 8) - 1.25 * 2 - 0.5);
    if (Math.hypot(lastP.x - target.x, lastP.z - target.z) > ZONE_ENTER) {
      wp.push(new V3(target.x, lastP.y, target.z));
    }
    const path = A._bakePath(wp, world, physics, props);
    if (!path) {
      rows.push({ id: c.id, zone: c.zone, ok: false, why: A._lastStop ?? '?' });
      continue;
    }
    path.X[0] = hub.x; path.Z[0] = hub.z; path.Y[0] = hub.y;
    path.hub0 = hub.y;
    path.ROAD[0] = Math.min(path.ROAD[0], hub.y);
    A._trimToStandoff(path, zones, target);
    A._trimAtBlockers(path, physics, props);
    const d = path.n
      ? Math.hypot(path.X[path.n - 1] - target.x, path.Z[path.n - 1] - target.z)
      : Infinity;
    rows.push({
      id: c.id, zone: c.zone,
      ok: !(path.n < 4 || path.length < 16 || d > 34),
      len: +path.length.toFixed(1), n: path.n,
      endsOff: +d.toFixed(1), narrowest: +path.narrowest.toFixed(1),
      end: [+path.X[path.n - 1].toFixed(1), +path.Z[path.n - 1].toFixed(1)],
      hub: [+hub.x.toFixed(1), +hub.z.toFixed(1)],
      why: path.stop,
    });
  }
  return rows;
}, CANDIDATES);

console.log('\n=== CANDIDATES ===');
for (const r of out) console.log('  ' + JSON.stringify(r));
console.log('\npageerrors', errs.length, errs[0] ?? '');
await b.close();
