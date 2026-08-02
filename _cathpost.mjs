/**
 * THE CATHEDRAL CENTRE'S TWO POSTS, PROVED IN BOTH BUILDING STATES.
 *
 *   node _cathpost.mjs [--url=…] [--seed=N]
 *
 * `tools/floorcheck.mjs` proves standing room at every cache — by iterating
 * `world.features`, which the two cathedral posts are deliberately not in
 * (they are `match`'s records at a place `world` did not publish; @see the
 * constructor note in src/match/caches.js). `tools/` is the lead's and does
 * not know about them, so this re-runs floorcheck's OWN feature test — the
 * 8-point ring at 1.25 m, the real standing capsule from step height, the
 * head clearance measured where a man stands — at both posts:
 *
 *   1. with the cathedral STANDING (boot state), then
 *   2. after a REAL scheduled collapse (the `_dmass.mjs` recipe: hold the
 *      clock open, let progress carry the match to the event, wait for D).
 *
 * …and checks the LIFECYCLE both ways: records enabled and dressing visible
 * while it stands; records `disabled`, dressing hidden, and any beacon at one
 * dead once it is razed.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4421/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL + (args.seed ? `?seed=${args.seed}` : ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 480000 });

const measure = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const ph = e.ctx.peek('physics');
    const MASK = ph.MASK.CHARACTER;
    const V3 = e.camera.position.constructor;
    const R = 0.32;
    const H = 1.78;
    const STEP = 0.42;
    const a = new V3();
    const b = new V3();
    /** floorcheck's `stands`, in world space (a ring is rotation-invariant). */
    const stands = (x, y, z, up = 0) => {
      a.set(x, y + up + R, z);
      b.set(x, y + H - R + 0.02, z);
      return ph.checkCapsule(a, b, R - 0.02, MASK);
    };
    const headroom = (x, y, z) => {
      const hit = ph.raycast(x, y + 0.12, z, 0, 1, 0, 6, MASK);
      return hit.hit ? hit.distance + 0.12 : Infinity;
    };
    const posts = m.caches.list.filter((c) => c.cathedral);
    const rows = [];
    for (const c of posts) {
      const { x, y, z } = c.position;
      // The floor NOW, from a metre and a half up — the razed field may stand
      // a little proud of the tile the position was authored on.
      const f = ph.raycast(x, y + 1.5, z, 0, -1, 0, 4, ph.MASK.WORLD);
      const fy = f.hit ? f.point.y : y;
      let around = 0;
      let head = 0;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const px = x + Math.cos(ang) * 1.25;
        const pz = z + Math.sin(ang) * 1.25;
        const pf = ph.raycast(px, y + 1.5, pz, 0, -1, 0, 4, ph.MASK.WORLD);
        const py = pf.hit ? pf.point.y : fy;
        if (!stands(px, py, pz, STEP)) continue;
        around++;
        const hr = headroom(px, py, pz);
        if (hr > head) head = hr;
      }
      rows.push({
        id: c.id,
        kind: c.kind,
        disabled: !!c.disabled,
        proved: !!c.stand,
        around,
        head: head === Infinity ? 99 : +head.toFixed(2),
        floorRise: +(fy - y).toFixed(2),
      });
    }
    const w = e.ctx.peek('world');
    return {
      rows,
      razed: !!w.cathedral?.razed,
      groupVisible: m.caches.cathGroup ? m.caches.cathGroup.visible : null,
      beacon: { active: m.caches.beacon.active, at: m.caches.beacon.at },
    };
  });

const judge = (label, r, wantDisabled) => {
  console.log(`\n─── ${label} — razed ${r.razed}, dressing visible ${r.groupVisible} ───`);
  console.log('  post                       kind    disabled  bot-proved  standable ring  head');
  let bad = 0;
  for (const x of r.rows) {
    const fail = x.around < 3 || x.head < 1.9 || x.disabled !== wantDisabled;
    if (fail) bad++;
    console.log(
      `  ${x.id.padEnd(26)} ${x.kind.padEnd(7)} ${String(x.disabled).padEnd(9)} ${String(x.proved).padEnd(11)} ` +
        `${String(x.around).padStart(8)}/8      ${String(x.head).padStart(5)}` +
        `  (floor ${x.floorRise >= 0 ? '+' : ''}${x.floorRise} m)` +
        (fail ? '   <-- ' + [
          x.around < 3 ? 'BURIED' : null,
          x.head < 1.9 ? 'NO HEADROOM' : null,
          x.disabled !== wantDisabled ? `disabled should be ${wantDisabled}` : null,
        ].filter(Boolean).join(', ') : '')
    );
  }
  if (r.groupVisible !== null && r.groupVisible === wantDisabled) {
    bad++;
    console.log(`  <-- dressing visibility is ${r.groupVisible}, want ${!wantDisabled}`);
  }
  return bad;
};

const before = await measure();
let fails = 0;
if (before.rows.length !== 2) {
  console.log(`FAIL: expected 2 cathedral posts, found ${before.rows.length}`);
  fails++;
}
fails += judge('CATHEDRAL STANDING', before, false);

/* ---- plant the beacon at the supply post, then raze on the real path ----- */
await page.evaluate(() => (window.__ENGINE__.time.scale = 10));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  m._checkWinConditions = () => {};
  m.roundClock = 1e6;
  m.score[0] = 999;
  // Plant the beacon at the supply post so the raze has one to kill.
  const c = m.caches.list.find((x) => x.id === 'CATH-CENTRE-supply');
  if (c) m.caches.plantBeacon(c, 0, 0, e.ctx.time.elapsed);
  // …and hold it lit until the raze: the clock is the thing under test.
  m.caches.beacon.until = e.ctx.time.elapsed + 1e6;
});
const planted = await page.evaluate(() => window.__ENGINE__.ctx.peek('match').caches.beacon.active);
console.log(`\n  beacon planted at CATH-CENTRE-supply: ${planted}`);
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').sites.some((z)=>z.id==='D')", null, { timeout: 300000 });
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await page.waitForTimeout(1500);

const after = await measure();
fails += judge('CATHEDRAL RAZED (real schedule)', after, true);
const beaconDead = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  return { active: m.caches.beacon.active, at: m.caches.beacon.at };
});
console.log(`\n  beacon after the raze: active ${beaconDead.active} (was at ${beaconDead.at || '-'})`);
if (beaconDead.active) {
  fails++;
  console.log('  <-- a beacon at the cathedral post survived the building');
}
console.log(
  fails
    ? `\n[cathpost] FAIL — ${fails} check(s)`
    : '\n[cathpost] PASS — standing room at both posts in both states; records, dressing and the beacon follow the building'
);
console.log('  pageErrors', errs.length ? errs.slice(0, 4) : 'none');
await browser.close();
process.exit(fails || errs.length ? 1 : 0);
