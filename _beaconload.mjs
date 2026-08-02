/**
 * WHAT A LONGER BEACON IS WORTH, PER MATCH — 「ビーコンは1分維持して」.
 *
 *   node _beaconload.mjs [--url=…] [--seed=N] [--secs=600] [--label=60s]
 *
 * `RULES.beaconTime` 30 -> 60 doubles how long a forward spawn stands, and the
 * only honest way to say what that costs is to run a match and count. One
 * match, real schedule, nothing forced except the clock scale, then the four
 * numbers that matter:
 *
 *   beacons       how many were PLANTED (unchanged by the tuning — the plant
 *                 gate is `beaconCooldown`, which did not move)
 *   beaconSpawns  how many men actually came back at one. THE number.
 *   forward       forward spawns of any kind (beacon + a held zone), per side
 *   base          spawns that fell all the way through to the base cluster
 *
 * `RULES` is not reachable from the page, so the before/after is TWO BUILDS of
 * the same tree with the one constant changed, run with the same `--seed`.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4421/';
const SECS = Number(args.secs ?? 600);
const LABEL = args.label ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL + (args.seed ? `?seed=${args.seed}` : ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const levelSeed = await page.evaluate(() => window.__ENGINE__?.levelSeed ?? null);

await page.evaluate(() => (window.__ENGINE__.time.scale = 10));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
/** Hold the win check open so the match runs its whole clock either way. */
const life = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._checkWinConditions = () => {};
  m.roundClock = 1e6;
  return { beaconLife: m._hud.beaconLife ?? null };
});
const t0 = await page.evaluate(() => window.__ENGINE__.ctx.time.elapsed);
await page.waitForFunction(
  (want) => window.__ENGINE__.ctx.time.elapsed >= want,
  t0 + SECS,
  { timeout: 900000, polling: 500 }
);
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await sleep(500);

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const s = m.caches.stats;
  return {
    elapsed: +e.ctx.time.elapsed.toFixed(0),
    beacons: s.beacons,
    beaconSpawns: s.beaconSpawns,
    forward: [...m._forwardSpawns],
    base: [...m._baseSpawns],
    beaconLife: m._hud.beaconLife,
    beaconUsedNow: m.caches.beacon.used,
    taken: s.taken,
    botTakes: s.botTakes,
  };
});
await browser.close();

const fwd = out.forward[0] + out.forward[1];
const base = out.base[0] + out.base[1];
const total = fwd + base;
console.log(`\nBEACONLOAD ${LABEL}  levelSeed=${levelSeed}  beaconTime=${out.beaconLife}s  match ${out.elapsed}s`);
console.log(`  beacons planted        : ${out.beacons}`);
console.log(`  respawns AT a beacon   : ${out.beaconSpawns}`);
console.log(`  forward spawns (R/B)   : ${out.forward.join(' / ')} = ${fwd}`);
console.log(`  base spawns    (R/B)   : ${out.base.join(' / ')} = ${base}`);
console.log(`  respawns total         : ${total}`);
console.log(
  `  beacon share of respawns: ${total ? ((100 * out.beaconSpawns) / total).toFixed(1) : '0.0'}%` +
    `   · per beacon planted: ${out.beacons ? (out.beaconSpawns / out.beacons).toFixed(2) : '0.00'}`
);
console.log(`  caches taken ${out.taken} (${out.botTakes} by bots)`);
if (errs.length) console.log('  PAGE ERRORS', errs.slice(0, 3));
