/**
 * SITECHECK'S COVER-MASS ASSERTION, FOR SITE D, ON THE RAZED MAP.
 *
 *   node _dmass.mjs [--url=…]
 *
 * `tools/sitecheck.mjs` boots, measures and exits, so it only ever sees the
 * INTACT town — and D does not exist there. It is authored `locked` and joins
 * `MatchSystem.sites` only when the cathedral comes down, so the one zone that
 * this change ADDS is the one zone sitecheck structurally cannot report on.
 *
 * So its two mass assertions are re-run here with the cathedral levelled and D
 * live: `coverAreaIn` (m² of 0.9-2.8 m mass standing inside the circle, want 12)
 * and `highCoverIn` (the engine's own standing cover points inside it, want 6).
 * Both are copied from sitecheck rather than reinvented — same 0.5 m lattice,
 * same downward ray from `centre.y + 6`, same 0.9-2.8 m band, same 0.25 m² per
 * cell. A and B are printed alongside on the SAME map so the known-failing
 * baseline can be compared against rather than argued about.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4253/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 480000 });

/** The same sweep, run over whatever zones are live right now. */
const measure = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const ai = e.ctx.peek('ai');
    const phys = e.ctx.peek('physics');
    const WORLD = phys.MASK.WORLD;
    const topAt = (wx, wz, top) => {
      const h = phys.raycast(wx, top, wz, 0, -1, 0, top + 8, WORLD);
      return h.hit ? h.point.y : -Infinity;
    };
    /** sitecheck's `coverArea`, in world space — a circle is rotation-invariant. */
    const coverArea = (C, r0, r1) => {
      const S = 0.5;
      let hit = 0;
      let tot = 0;
      for (let dz = -r1; dz <= r1 + 1e-6; dz += S) {
        for (let dx = -r1; dx <= r1 + 1e-6; dx += S) {
          const d = Math.hypot(dx, dz);
          if (d < r0 || d > r1) continue;
          const y = topAt(C.x + dx, C.z + dz, C.y + 6);
          if (!Number.isFinite(y)) continue;
          tot++;
          const rise = y - C.y;
          if (rise >= 0.9 && rise <= 2.8) hit++;
        }
      }
      return { m2: +(hit * 0.25).toFixed(1), frac: tot ? +(hit / tot).toFixed(3) : 0 };
    };
    const pts = ai.cover?.points ?? [];
    const rows = [];
    for (const z of m.allZones) {
      const C = z.position;
      const rad = z.radius;
      const cin = coverArea(C, 0, rad);
      const ring = coverArea(C, rad, rad + 8);
      let inHigh = 0;
      let inLow = 0;
      for (const p of pts) {
        if (Math.abs(p.y - C.y) > 3) continue;
        if (Math.hypot(p.x - C.x, p.z - C.z) > rad) continue;
        p.high ? inHigh++ : inLow++;
      }
      rows.push({
        id: z.id,
        live: m.sites.includes(z),
        coverAreaIn: cin.m2,
        coverFrac: cin.frac,
        coverAreaRing: ring.m2,
        highCoverIn: inHigh,
        lowCoverIn: inLow,
        standPoints: z.stand.length,
      });
    }
    return { rows, razed: e.ctx.peek('world').cathedral?.razed ?? null, live: m.sites.map((z) => z.id).join('/') };
  });

const MIN = { coverAreaIn: 12, highCoverIn: 6 };
const show = (label, r) => {
  console.log(`\n─── ${label} — live zones ${r.live}, cathedral razed: ${r.razed} ───`);
  console.log('  zone  live   mass in zone   of floor   mass in ring   standing cover   low cover   stand pts');
  for (const x of r.rows) {
    console.log(
      `   ${x.id.padEnd(4)} ${String(x.live).padEnd(6)} ${String(x.coverAreaIn).padStart(9)} m² ` +
        `${String((x.coverFrac * 100).toFixed(1)).padStart(9)}% ${String(x.coverAreaRing).padStart(12)} m² ` +
        `${String(x.highCoverIn).padStart(14)} ${String(x.lowCoverIn).padStart(11)} ${String(x.standPoints).padStart(11)}`
    );
  }
};

show('INTACT (what sitecheck sees)', await measure());

/* ---- bring the cathedral down on the real path, then re-measure ---------- */
await page.evaluate(() => (window.__ENGINE__.time.scale = 10));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._checkWinConditions = () => {};
  m.roundClock = 1e6;
  m.score[0] = 999;
});
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').sites.some((z)=>z.id==='D')", null, { timeout: 180000 });
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await page.waitForTimeout(1200);
const after = await measure();
show('AFTER THE CATHEDRAL IS DOWN', after);

const d = after.rows.find((x) => x.id === 'D');
const verdict = [];
if (d.coverAreaIn < MIN.coverAreaIn) verdict.push(`${d.coverAreaIn} m² of mass in the zone (want ${MIN.coverAreaIn})`);
if (d.highCoverIn < MIN.highCoverIn) verdict.push(`${d.highCoverIn} standing cover points (want ${MIN.highCoverIn})`);
console.log(
  verdict.length
    ? `\n  SITE D BARE:\n` + verdict.map((v) => `    - ${v}`).join('\n')
    : `\n  SITE D OK — ${d.coverAreaIn} m² of mass (want ${MIN.coverAreaIn}), ` +
        `${d.highCoverIn} standing cover points (want ${MIN.highCoverIn})`
);
console.log('  pageErrors', errs.length ? errs.slice(0, 4) : 'none');
await browser.close();
process.exit(verdict.length ? 1 : 0);
