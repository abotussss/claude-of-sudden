/**
 * DOES THE COVER TABLE SURVIVE THE MAP CHANGING? — measured, not argued.
 *
 *   node _coverstale.mjs [--url=…]
 *
 * `ai.cover` is baked once in `AiSystem._buildNav`, at boot, against the INTACT
 * town. Every destruction in this project then changes collision under it:
 * `world.cathedral.setRazed` swaps a 29 m shell for a 2.8 m ruin, and
 * `Airstrike.forceDemoNav` swaps six whole blocks for their collapsed form.
 *
 * A cover point is a position plus the DIRECTION of the mass it hides behind
 * (`p.dx`,`p.dz`), found in `CoverMap.build` by `raycast(x, y+0.55, z, dx,0,dz,
 * reach)`. So the staleness test is that exact ray, re-fired: a point whose own
 * ray no longer hits is a man crouching behind nothing.
 *
 * Three numbers per state, because "stale" has two useful meanings:
 *   dead      — the stored facing has no mass left AND none of the other seven
 *               do either. There is no cover at that cell at all.
 *   misfaced  — the stored facing is empty but some other direction is solid.
 *               `pick()` still scores it on the old normal, so the man puts his
 *               back to open ground.
 *   gained    — a cell with no cover at boot that has mass now (the ruin's own
 *               mounds). Cover the AI cannot see because the table never grew.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
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

/** Fire every cover point's own ray against the town in whatever state it is in. */
const probe = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const ai = e.ctx.peek('ai');
    const phys = e.ctx.peek('physics');
    const MASK = phys.MASK.WORLD;
    const REACH = 1.3;
    const DX = [1, -1, 0, 0, 1, 1, -1, -1];
    const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
    const S2 = Math.SQRT2;
    const pts = ai.cover?.points ?? [];
    const own = new Uint8Array(pts.length);
    const any = new Uint8Array(pts.length);
    const high = new Uint8Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const h = phys.raycast(p.x, p.y + 0.55, p.z, p.dx, 0, p.dz, REACH, MASK);
      own[i] = h.hit ? 1 : 0;
      if (h.hit) {
        any[i] = 1;
        high[i] = phys.raycastAny(p.x, p.y + 1.32, p.z, p.dx, 0, p.dz, REACH, MASK) ? 1 : 0;
      } else {
        for (let d = 0; d < 8; d++) {
          const dx = DX[d] / (d < 4 ? 1 : S2);
          const dz = DZ[d] / (d < 4 ? 1 : S2);
          if (phys.raycast(p.x, p.y + 0.55, p.z, dx, 0, dz, REACH, MASK).hit) {
            any[i] = 1;
            break;
          }
        }
      }
    }
    return { own: Array.from(own), any: Array.from(any), high: Array.from(high) };
  });

/** Every cover point's position, plus the regions we want the answer split by. */
const layout = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const ai = e.ctx.peek('ai');
    const m = e.ctx.peek('match');
    const w = e.ctx.peek('world');
    const pts = (ai.cover?.points ?? []).map((p) => ({
      x: +p.x.toFixed(2),
      y: +p.y.toFixed(2),
      z: +p.z.toFixed(2),
      high: !!p.high,
    }));
    const zones = (m?.allZones ?? []).map((z) => ({
      id: z.id,
      locked: !!z.locked,
      x: z.position.x,
      y: z.position.y,
      z: z.position.z,
      r: z.radius,
    }));
    const c = w?.cathedral ?? null;
    const cath = c
      ? {
          cx: c.cx,
          cz: c.cz,
          hw: c.hw,
          hd: c.hd,
          intactTopY: c.intactTopY,
          ruinTopY: c.ruinTopY,
        }
      : null;
    const demos = (w?.demolitions ?? []).map((d) => ({
      id: d.id,
      x: d.position.x,
      z: d.position.z,
      r: d.radius,
    }));
    return { pts, zones, cath, demos, total: pts.length };
  });

const L = await layout();
console.log(`[coverstale] ${L.total} cover points at boot · ${L.zones.length} zones · ${L.demos.length} demolitions`);

/** Level-space test for the cathedral footprint, via `world.worldToLevel`. */
const inCath = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const ai = e.ctx.peek('ai');
  const c = w?.cathedral;
  if (!c || typeof w.worldToLevel !== 'function') return null;
  return (ai.cover?.points ?? []).map((p) => {
    const L = w.worldToLevel(p.x, p.y, p.z);
    return Math.abs(L.x - c.cx) <= c.hw + 1.5 && Math.abs(L.z - c.cz) <= c.hd + 1.5 ? 1 : 0;
  });
});

const A = await probe();

/* ---- state 1: the cathedral razed ----------------------------------- */
const razed = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const w = e.ctx.peek('world');
  const ph = e.ctx.peek('physics');
  const ok = w?.cathedral?.setRazed?.(true, ph) === true;
  const cells = m?._reprobeZoneNav ? m._reprobeZoneNav(m.lockedZone) : -1;
  return { ok, cells, top: w?.cathedral?.ruinTopY ?? null };
});
console.log(`[coverstale] cathedral razed=${razed.ok} · ${razed.cells} nav cells re-probed`);
const B = await probe();

/* ---- state 2: every demolition down as well -------------------------- */
const demoN = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  return m?.airstrike?.forceDemoNav ? m.airstrike.forceDemoNav(true) : -1;
});
console.log(`[coverstale] demolitions brought down: ${demoN}`);
const C = await probe();

await browser.close();

/* ---- the report ------------------------------------------------------ */
const D = L.zones.find((z) => z.locked) ?? null;
const inD = (p) => (D ? Math.hypot(p.x - D.x, p.z - D.z) <= D.r && Math.abs(p.y - D.y) <= 3 : false);
const inDemo = (p) => L.demos.some((d) => Math.hypot(p.x - d.x, p.z - d.z) <= d.r);

const bucket = (pred, before, after) => {
  let n = 0;
  let dead = 0;
  let misfaced = 0;
  let lostHigh = 0;
  for (let i = 0; i < L.pts.length; i++) {
    const p = L.pts[i];
    if (!pred(p, i)) continue;
    n++;
    if (before.own[i] && !after.own[i]) {
      if (after.any[i]) misfaced++;
      else dead++;
    } else if (before.own[i] && after.own[i] && before.high[i] && !after.high[i]) lostHigh++;
  }
  return { n, dead, misfaced, stale: dead + misfaced, lostHigh };
};

const show = (label, after) => {
  const rows = [
    ['SITE D circle', (p) => inD(p)],
    ['cathedral footprint', (_p, i) => inCath?.[i] === 1],
    ['demolition blocks', (p) => inDemo(p)],
    ['WHOLE MAP', () => true],
  ];
  console.log(`\n=== ${label} ===`);
  for (const [name, pred] of rows) {
    const r = bucket(pred, A, after);
    const pct = r.n ? ((r.stale / r.n) * 100).toFixed(1) : '0.0';
    console.log(
      `  ${name.padEnd(22)} points ${String(r.n).padStart(5)} · STALE ${String(r.stale).padStart(4)} (${pct}%)` +
        ` = dead ${r.dead} + misfaced ${r.misfaced} · lost high-cover ${r.lostHigh}`
    );
  }
};

const selfCheck = A.own.reduce((s, v) => s + (v ? 0 : 1), 0);
console.log(`\n[coverstale] sanity: ${selfCheck} of ${L.total} points fail their OWN ray on the intact map (want 0)`);
{
  // WHERE those already-invalid points are. If they cluster in the cathedral,
  // the boot bake ran while the RUIN scope was still solid — a scope is created
  // solid and only `match`'s first `setRazed(false)` puts it away.
  const rows = [
    ['SITE D circle', (p) => inD(p)],
    ['cathedral footprint', (_p, i) => inCath?.[i] === 1],
    ['demolition blocks', (p) => inDemo(p)],
    ['elsewhere', (p, i) => !inD(p) && inCath?.[i] !== 1 && !inDemo(p)],
  ];
  for (const [name, pred] of rows) {
    let bad = 0;
    for (let i = 0; i < L.pts.length; i++) if (pred(L.pts[i], i) && !A.own[i]) bad++;
    console.log(`    boot-invalid in ${name.padEnd(22)} ${bad}`);
  }
}
show('CATHEDRAL RAZED', B);
show('CATHEDRAL RAZED + ALL SIX BLOCKS DOWN', C);
if (errs.length) console.log('\npageerrors:', errs.slice(0, 5));
