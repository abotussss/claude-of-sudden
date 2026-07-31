/**
 * DOES THE COVER TABLE SURVIVE THE MAP CHANGING? — measured, not argued.
 *
 *   node _coverstale.mjs [--url=…]
 *
 * `ai.cover` is baked in `AiSystem._buildNav`, at boot. Every destruction in
 * this project then changes collision under it: `world.cathedral.setRazed`
 * swaps a 29 m shell for a 2.76 m ruin, and `Airstrike.forceDemoNav` swaps six
 * whole blocks for their collapsed form.
 *
 * A cover point is a position plus the DIRECTION of the mass it hides behind
 * (`p.dx`,`p.dz`), found in `CoverMap.build` by `raycast(x, y+0.55, z, dx,0,dz,
 * reach)`. So the test is that exact ray, re-fired against the town in the state
 * it is actually in: a point whose own ray misses is a man crouching behind
 * nothing.
 *
 * The measure is ABSOLUTE per state — "of the points the AI is using right now,
 * how many describe air" — rather than a diff against boot, so it reads the same
 * whether the table is swapped on the event or not.
 *
 *   dead      no mass on the stored facing and none on any of the other seven.
 *             There is no cover at that cell at all.
 *   misfaced  the stored facing is empty but another direction is solid.
 *             `pick()` still scores it on the old normal, so the man puts his
 *             back to open ground.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    // FIRST `=` only. `--url=…/?demo=down` has two, and splitting on both threw
    // the flag away silently — the URL became `…/?demo`, which `src/main.js`
    // does not act on, so the run measured the intact map and said so.
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4255/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
console.log(`[coverstale] booting ${URL}`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

/**
 * Fire every LIVE cover point's own ray against the town as it stands, and
 * carry back enough of each point to say where it is.
 */
const probe = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const ai = e.ctx.peek('ai');
    const w = e.ctx.peek('world');
    const phys = e.ctx.peek('physics');
    const MASK = phys.MASK.WORLD;
    const REACH = 1.3;
    const DX = [1, -1, 0, 0, 1, 1, -1, -1];
    const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
    const S2 = Math.SQRT2;
    const c = w?.cathedral ?? null;
    const pts = ai.cover?.points ?? [];
    const rows = [];
    for (const p of pts) {
      const h = phys.raycast(p.x, p.y + 0.55, p.z, p.dx, 0, p.dz, REACH, MASK);
      let any = h.hit;
      if (!any) {
        for (let d = 0; d < 8 && !any; d++) {
          const dx = DX[d] / (d < 4 ? 1 : S2);
          const dz = DZ[d] / (d < 4 ? 1 : S2);
          any = phys.raycast(p.x, p.y + 0.55, p.z, dx, 0, dz, REACH, MASK).hit;
        }
      }
      let cath = 0;
      if (c && typeof w.worldToLevel === 'function') {
        const L = w.worldToLevel(p.x, p.y, p.z);
        cath = Math.abs(L.x - c.cx) <= c.hw + 1.5 && Math.abs(L.z - c.cz) <= c.hd + 1.5 ? 1 : 0;
      }
      rows.push({ x: p.x, y: p.y, z: p.z, own: h.hit ? 1 : 0, any: any ? 1 : 0, cath });
    }
    return rows;
  });

const L = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const w = e.ctx.peek('world');
  const ai = e.ctx.peek('ai');
  const D = (m?.allZones ?? []).find((z) => z.locked) ?? null;
  return {
    D: D ? { x: D.position.x, y: D.position.y, z: D.position.z, r: D.radius } : null,
    demos: (w?.demolitions ?? []).map((d) => ({ x: d.position.x, z: d.position.z, r: d.radius })),
    tables: {
      intact: ai.coverIntact?.points.length ?? null,
      ruin: ai.coverRuin?.points.length ?? null,
      live: ai.cover?.points.length ?? 0,
    },
  };
});
console.log(
  `[coverstale] tables: intact ${L.tables.intact} · ruin ${L.tables.ruin} · live ${L.tables.live}` +
    (L.tables.ruin === null ? '  (NO ruin table — single-bake build)' : '')
);

const inD = (p) => (L.D ? Math.hypot(p.x - L.D.x, p.z - L.D.z) <= L.D.r && Math.abs(p.y - L.D.y) <= 3 : false);
const inDemo = (p) => L.demos.some((d) => Math.hypot(p.x - d.x, p.z - d.z) <= d.r);

const report = (label, rows) => {
  const buckets = [
    ['SITE D circle', inD],
    ['cathedral footprint', (p) => p.cath === 1],
    ['demolition blocks', inDemo],
    ['WHOLE MAP', () => true],
  ];
  console.log(`\n=== ${label} ===`);
  for (const [name, pred] of buckets) {
    let n = 0;
    let dead = 0;
    let misfaced = 0;
    for (const p of rows) {
      if (!pred(p)) continue;
      n++;
      if (!p.own) (p.any ? (misfaced += 1) : (dead += 1));
    }
    const stale = dead + misfaced;
    const pct = n ? ((stale / n) * 100).toFixed(1) : '0.0';
    console.log(
      `  ${name.padEnd(22)} points ${String(n).padStart(5)} · describing AIR ${String(stale).padStart(4)}` +
        ` (${pct}%) = dead ${dead} + misfaced ${misfaced}`
    );
  }
};

report('CATHEDRAL STANDING (as booted)', await probe());

const razed = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const w = e.ctx.peek('world');
  const ph = e.ctx.peek('physics');
  const ok =
    typeof m?._setCathedralRazed === 'function'
      ? m._setCathedralRazed(true)
      : w?.cathedral?.setRazed?.(true, ph) === true;
  const cells = m?._reprobeZoneNav ? m._reprobeZoneNav(m.lockedZone) : -1;
  const live = e.ctx.peek('ai').cover?.points.length ?? 0;
  return { ok, cells, live };
});
console.log(
  `\n[coverstale] cathedral razed · ${razed.cells} nav cells re-probed · live table now ${razed.live} points`
);
report('CATHEDRAL RAZED', await probe());

const demoN = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  return m?.airstrike?.forceDemoNav ? m.airstrike.forceDemoNav(true) : -1;
});
console.log(`\n[coverstale] demolitions brought down: ${demoN}`);
report('CATHEDRAL RAZED + ALL SIX BLOCKS DOWN', await probe());

/**
 * THE OTHER WAY A RUIN COVER POINT COULD BE WRONG: standing INSIDE the new
 * mass. The ruin table is probed on the boot grid, and `_reprobeZoneNav` only
 * shuts cells afterwards, so a point on a cell the rubble closed would be one
 * A* cannot deliver a man to. Counted rather than assumed.
 */
const unreachable = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const g = ai.grid;
  let bad = 0;
  for (const p of ai.cover?.points ?? []) {
    if (!g.walkable(g.cellX(p.x), g.cellZ(p.z))) bad++;
  }
  return bad;
});
console.log(`[coverstale] live cover points standing on a NON-WALKABLE cell: ${unreachable}`);

await browser.close();
if (errs.length) console.log('\npageerrors:', errs.slice(0, 5));
