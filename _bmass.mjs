/**
 * ZONE COVER MASS, SITECHECK'S OWN SWEEP, IN EVERY DEMOLITION STATE.
 *
 *   node _bmass.mjs [--url=…] [--map]
 *
 * `tools/sitecheck.mjs` boots, measures and exits, so it only ever sees the
 * INTACT town — but four of the six blocks round zones A and B are on
 * `world.demolitions` and are levelled during a match (the `DISTRICT-A` /
 * `DISTRICT-B` salvos). This is sitecheck's `coverArea` verbatim — same 0.5 m
 * lattice ON THE LEVEL'S OWN AXES, same downward ray from `centre.y + 6`, same
 * 0.9-2.8 m band, same 0.25 m² per cell — run intact, with the zone's own row
 * block down, and with all six down.
 *
 * It also DECOMPOSES the counted mass: how much of it stands inside a
 * demolishable footprint, which is the mass that is not there after the salvo.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4256/';
const MAP = !!args.map;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const phys = e.ctx.peek('physics');
  const world = e.ctx.peek('world');
  const V3 = m.allZones[0].position.constructor;
  const WORLD = phys.MASK.WORLD;
  const S = world.layout.SCALE;
  const L2W = (lx, lz) => world.levelToWorld(lx, 0, lz, new V3());
  const W2L = (p) => world.worldToLevel(p.x, p.y, p.z, new V3());
  const topAt = (wx, wz, top) => {
    const h = phys.raycast(wx, top, wz, 0, -1, 0, top + 8, WORLD);
    return h.hit ? h.point.y : -Infinity;
  };
  /** The demolishable footprints, in AUTHORED units, with the apron. */
  const demoRects = (world.demolitions ?? []).map((d) => {
    const b = world.layout.BUILDINGS.find((x) => x.id === d.id) ?? {};
    return {
      id: d.id,
      x0: (b.x - b.w / 2) / S - 1.1,
      x1: (b.x + b.w / 2) / S + 1.1,
      z0: (b.z - b.d / 2) / S - 1.1,
      z1: (b.z + b.d / 2) / S + 1.1,
    };
  });
  window.__M = () => {
    const out = [];
    for (const z of m.allZones) {
      const C = z.position;
      const lc = W2L(C);
      const rad = z.radius;
      let hit = 0;
      let tot = 0;
      let onDemo = 0;
      const cells = [];
      for (let dz = -rad; dz <= rad + 1e-6; dz += 0.5) {
        for (let dx = -rad; dx <= rad + 1e-6; dx += 0.5) {
          const d = Math.hypot(dx, dz);
          if (d > rad) continue;
          const w = L2W(lc.x + dx, lc.z + dz);
          const y = topAt(w.x, w.z, C.y + 6);
          if (!Number.isFinite(y)) continue;
          tot++;
          const rise = y - C.y;
          if (rise < 0.9 || rise > 2.8) continue;
          hit++;
          const ax = (lc.x + dx) / S;
          const az = (lc.z + dz) / S;
          const on = demoRects.find((r) => ax >= r.x0 && ax <= r.x1 && az >= r.z0 && az <= r.z1);
          if (on) onDemo++;
          cells.push([+ax.toFixed(1), +az.toFixed(1), +rise.toFixed(2), on ? on.id : '']);
        }
      }
      out.push({
        id: z.id,
        authored: [+(lc.x / S).toFixed(2), +(lc.z / S).toFixed(2)],
        m2: +(hit * 0.25).toFixed(1),
        frac: tot ? +(hit / tot).toFixed(3) : 0,
        onDemoM2: +(onDemo * 0.25).toFixed(1),
        stand: z.stand.length,
        cells,
      });
    }
    return out;
  };
  window.__PLAN = (id) => {
    const z = m.allZones.find((q) => q.id === id);
    const C = z.position;
    const lc = W2L(C);
    const ac = { x: lc.x / S, z: lc.z / S };
    const R = 8;
    const lines = [];
    for (let az = ac.z + R; az >= ac.z - R - 1e-6; az -= 0.5) {
      let row = '';
      for (let ax = ac.x - R; ax <= ac.x + R + 1e-6; ax += 0.5) {
        const w = L2W(ax * S, az * S);
        const y = topAt(w.x, w.z, C.y + 6);
        const rise = Number.isFinite(y) ? y - C.y : null;
        const inCircle = Math.hypot((ax - ac.x) * S, (az - ac.z) * S) <= z.radius;
        row +=
          rise === null ? ' '
          : rise > 4.2 ? 'B'
          : rise > 2.8 ? '#'
          : rise >= 0.9 ? (inCircle ? 'C' : 'c')
          : rise >= 0.35 ? 'l'
          : inCircle ? '.' : ' ';
      }
      lines.push(`${az.toFixed(1).padStart(7)} ${row}`);
    }
    return { x0: +(ac.x - R).toFixed(1), lines };
  };
});

const measure = () => page.evaluate(() => window.__M());
const plan = (id) => page.evaluate((i) => window.__PLAN(i), id);

const show = async (label) => {
  const rows = await measure();
  console.log(`\n─── ${label} ───`);
  console.log('  zone   authored           mass in zone   of floor   of which on a demo footprint   stand');
  for (const x of rows) {
    console.log(
      `   ${x.id.padEnd(4)} (${String(x.authored[0]).padStart(7)},${String(x.authored[1]).padStart(7)}) ` +
        `${String(x.m2).padStart(9)} m² ${String((x.frac * 100).toFixed(1)).padStart(8)}% ` +
        `${String(x.onDemoM2).padStart(22)} m² ${String(x.stand).padStart(9)}` +
        (x.m2 < 12 ? '   <-- BELOW 12' : '')
    );
  }
  if (MAP) {
    for (const id of ['A', 'B']) {
      const p = await plan(id);
      console.log(`\n  ZONE ${id} plan — authored units, x from ${p.x0} step 0.5, z descending`);
      console.log(`  'C' counted cover in circle  'c' cover outside circle  '.' circle floor  l<0.9  # 2.8-4.2  B building`);
      for (const l of p.lines) console.log('  ' + l);
    }
  }
  return rows;
};

await show('INTACT (what sitecheck sees)');
await page.evaluate(() => {
  const w = window.__ENGINE__.ctx.peek('world');
  w.demolish('NW1', true);
  w.demolish('SE1', true);
});
await show("ROW BLOCKS DOWN (NW1 + SE1 — the two the zones sit against)");
await page.evaluate(() => window.__ENGINE__.ctx.peek('world').demolishAll(true));
await show('ALL SIX DOWN (the full DISTRICT-A + DISTRICT-B salvos)');

console.log('\n  pageErrors', errs.length ? errs.slice(0, 4) : 'none');
await browser.close();
