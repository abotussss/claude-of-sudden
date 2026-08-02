/**
 * THE FOUR ORDERS A SITE AND ITS HOST CAN HAPPEN IN.
 *
 * A strike site whose rubble comes to rest on a building somebody else takes
 * down has four states worth proving, and the interesting two are the ORDERS:
 *
 *   A  host intact, site struck            — the rubble is on the roof
 *   B  site struck, THEN the host falls    — the rubble was already on the ground
 *   C  host falls, THEN the site is struck — the roof was never there
 *   D  booted with the host already down   — ?cath=down
 *
 * Measured the way `_floatcheck.mjs`'s drawn-mass pass measures: decompose each
 * settled instance matrix, take the LARGEST half extent so a rotated chunk's
 * underside is never over-estimated, and drop a ray from just above it.
 *
 *   node _hostproof.mjs --url=http://127.0.0.1:4390/ --seed=7 [--site=MID]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
  })
);
const BASE = args.url ?? 'http://127.0.0.1:4390/';
const SEED = args.seed ?? '7';
const SITE = args.site ?? 'MID';
const CAIR = Number(args.cair ?? 1.5);
const CMIN = Number(args.cmin ?? 3);

const url = (extra) => {
  const q = [`seed=${SEED}`, ...(extra ?? [])].join('&');
  return `${BASE}${BASE.includes('?') ? '&' : '?'}${q}`;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MEASURE = `(id, cair) => {
  const eng = window.__ENGINE__;
  const ctx = eng.ctx;
  const ph = ctx.peek('physics');
  const air = ctx.peek('match').airstrike;
  const s = air.sites.find((x) => x.id === id);
  if (!s) return { err: 'no site ' + id };
  const M = eng.camera.matrixWorld.constructor;
  const V = eng.camera.position.constructor;
  const Q = eng.camera.quaternion.constructor;
  const m = new M(); const p = new V(); const q = new Q(); const sc = new V();
  let n = 0, worst = 0, worstAt = null, checked = 0, lowest = 1e9, highest = -1e9;
  for (const mesh of s.meshes) {
    const arr = mesh.userData.settled;
    const cnt = arr.length / 16;
    for (let i = 0; i < cnt; i++) {
      m.fromArray(arr, i * 16);
      m.decompose(p, q, sc);
      const under = p.y - Math.max(sc.x, sc.y, sc.z) * 0.5;
      checked++;
      if (p.y < lowest) lowest = p.y;
      if (p.y > highest) highest = p.y;
      if (under < 0.6) continue;
      const h = ph.raycast(p.x, p.y + 0.15, p.z, 0, -1, 0, 80, ph.MASK.WORLD);
      const gap = h.hit ? under - h.point.y : under;
      if (gap <= cair) continue;
      n++;
      if (gap > worst) { worst = gap; worstAt = [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]; }
    }
  }
  return {
    id, checked, inSky: n, worst: +worst.toFixed(2), worstAt,
    struck: s.struck, baked: s.baked,
    razed: !!ctx.peek('world').cathedral?.razed,
    lowest: +lowest.toFixed(2), highest: +highest.toFixed(2),
    variants: (s.hostVariants ?? []).map((v) => v.host.id + (v.applied ? ':DOWN' : ':up')),
  };
}`;

async function boot(browser, extra) {
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(url(extra), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
  /**
   * LET THE ROUND START ON ITS OWN FIRST, then take the wheel. `_beginRound`
   * clears `_cathedralCalled`, resets `roundClock` and calls `airstrike.reset()`
   * — so flags set before it are flags the match throws away, and the first
   * version of this probe measured the match's own beat sheet in three of its
   * four cases without noticing.
   */
  await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
  await page.waitForFunction(
    () => window.__ENGINE__.ctx.peek('match')?.phase === 'live',
    null,
    { timeout: 180000 }
  );
  await sleep(400);
  await page.evaluate(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    // Hold the round open and keep every scheduler out of the way: this probe
    // drives the two events by hand and nothing else may fire them.
    m.airstrike.enabled = false;
    m.roundClock = 1e6;
    m._checkWinConditions = () => {};
    m._cathedralCalled = true;
    m._finalCalled = true;
    window.__ENGINE__.time.scale = 6;
  });
  return { page, errs };
}

const fire = (page, id) =>
  page.evaluate((i) => window.__ENGINE__.ctx.peek('match').airstrike.fire(i), id);
const raze = (page) =>
  page.evaluate(() => window.__ENGINE__.ctx.peek('match')._razeCathedral());
const measure = (page) => page.evaluate(`(${MEASURE})(${JSON.stringify(SITE)}, ${CAIR})`);
const settled = (page, id) =>
  page.waitForFunction(
    (i) => {
      const s = window.__ENGINE__.ctx.peek('match').airstrike.sites.find((x) => x.id === i);
      return !!s && s.struck && s.baked;
    },
    id,
    { timeout: 120000 }
  );

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const results = [];
const allErrs = [];

/* ---- A: host intact, site struck ---------------------------------------- */
{
  const { page, errs } = await boot(browser, []);
  await fire(page, SITE);
  await settled(page, SITE);
  await sleep(600);
  results.push(['A  host intact, site struck', await measure(page)]);
  allErrs.push(...errs);
  await page.close();
}

/* ---- B: site struck, THEN the host falls --------------------------------- */
{
  const { page, errs } = await boot(browser, []);
  await fire(page, SITE);
  await settled(page, SITE);
  await sleep(600);
  const before = await measure(page);
  await raze(page);
  await sleep(1500);
  const after = await measure(page);
  results.push(['B1 site struck, host still up', before]);
  results.push(['B2 ...then the host falls', after]);
  allErrs.push(...errs);
  await page.close();
}

/* ---- C: host falls, THEN the site is struck ------------------------------ */
{
  const { page, errs } = await boot(browser, []);
  await raze(page);
  await sleep(2000);
  await fire(page, SITE);
  await settled(page, SITE);
  await sleep(600);
  results.push(['C  host down, then struck', await measure(page)]);
  allErrs.push(...errs);
  await page.close();
}

/* ---- D: booted with the host already down -------------------------------- */
{
  const { page, errs } = await boot(browser, ['cath=down']);
  await fire(page, SITE);
  await settled(page, SITE);
  await sleep(600);
  results.push(['D  ?cath=down, then struck', await measure(page)]);
  allErrs.push(...errs);
  await page.close();
}

await browser.close();

console.log(`\nHOSTPROOF  site=${SITE}  seed=${SEED}  air>${CAIR}m counts, a site FAILS at ${CMIN}\n`);
console.log(
  '  case                            chunks  in the sky  worst air  highest chunk  razed  variant'
);
let fails = 0;
for (const [name, r] of results) {
  if (r.err) {
    console.log(`  ${name.padEnd(30)}  ${r.err}`);
    fails++;
    continue;
  }
  const bad = r.inSky >= CMIN;
  if (bad) fails++;
  console.log(
    `  ${name.padEnd(30)}  ${String(r.checked).padStart(6)}  ${String(r.inSky).padStart(10)}  ` +
      `${r.worst.toFixed(2).padStart(9)}  ${r.highest.toFixed(2).padStart(13)}  ` +
      `${String(r.razed).padStart(5)}  ${(r.variants.join(',') || '-').padEnd(16)}` +
      (bad ? `  <-- FAIL ${JSON.stringify(r.worstAt)}` : '')
  );
}
if (allErrs.length) console.log('\n  page errors:', allErrs.slice(0, 6));
console.log(
  fails
    ? `\n[hostproof] FAIL — ${fails} case(s) leave ${SITE}'s rubble in the sky`
    : `\n[hostproof] PASS — ${SITE}'s rubble is on the ground in every order`
);
process.exit(fails || allErrs.length ? 1 : 0);
