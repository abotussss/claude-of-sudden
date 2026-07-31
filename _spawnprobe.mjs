/**
 * RESPAWN PROBE — "ビーコン／占領地点からのリスポーンの修正".
 *
 *   node _spawnprobe.mjs [--url=…]
 *
 * "It doesn't work" is not a diagnosis, so this asks the three questions
 * separately and prints an answer to each:
 *
 *   1. Does the beacon get PLANTED?  (`Caches.plantBeacon`, `beacon.active`)
 *   2. Does it, and does a held zone, appear as a CANDIDATE in `_safeSpawn`'s
 *      auction at all — i.e. does it survive `forwardSpawnBlockRadius`?
 *   3. Is it CHOSEN? The auction is a single `max` over one score, so a
 *      candidate that is never the max is invisible no matter how correct the
 *      rest of the plumbing is.
 *
 * (3) is the one nothing in the codebase measures. `_safeSpawn` scores a BASE
 * point as `distanceToNearestEnemy + rand(0,6)` and a FORWARD point as
 * `distanceToNearestEnemy + forwardSpawnBias + rand(0,6)`. Those are the same
 * units, so the comparison is literally "is the contested capture point further
 * from the enemy than my own back line, plus 34 m of thumb". It is not, ever, on
 * a map this size — so the probe prints the raw score of the winning base point
 * next to the best forward point and the beacon, which is the whole bug in three
 * numbers.
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
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const sleep = (ms) => page.waitForTimeout(ms);

await page.evaluate(() => (window.__ENGINE__.time.scale = 12));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 180000 });
// Let both sides actually take ground, so "a zone you own" is a real case.
await sleep(9000);

const r = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  // `RULES` is a module constant and not on the instance; these two are
  // transcribed from src/match/rules.js and the 200-respawn tally below is the
  // measurement that does not depend on them.
  const RULES = { forwardSpawnBias: 34, forwardSpawnBlockRadius: 8 };
  const out = { zones: [], teams: [], beacon: {}, rules: {} };

  // The two knobs the auction turns on, read off the running match rather than
  // out of the source.
  const bias = m._forwardSpawnBiasProbe ?? null;
  out.rules.forwardSpawnBias = RULES?.forwardSpawnBias ?? '(RULES not on match)';
  out.rules.forwardSpawnBlockRadius = RULES?.forwardSpawnBlockRadius ?? '?';

  out.zones = m.sites.map((z) => ({
    id: z.id,
    owner: z.owner < 0 ? 'neutral' : ['RED', 'BLUE'][z.owner],
    standPoints: z.stand.length,
    spawnForRed: z.spawnFor[0].length,
    spawnForBlue: z.spawnFor[1].length,
  }));

  /** Re-run the auction's SCORING, without the rng, for one team. */
  const audit = (team) => {
    const role = m.playerTeam === team ? m.playerRole : 1 - m.playerRole;
    const attack = m.spawns.attack;
    const defend = m.spawns.defend;
    // Score BOTH clusters; `_safeSpawn` picks one by role, and which one it is
    // does not change the shape of the answer.
    const nd = (p) => m._nearestFoeDist(team, p);
    const scoreSet = (list) => list.map((sp) => nd(sp.position));
    const a = scoreSet(attack);
    const d = scoreSet(defend);
    const baseUsed = role === 0 ? a : d;
    const bestBase = Math.max(...baseUsed);

    const fwd = [];
    for (const z of m.sites) {
      if (z.owner !== team) continue;
      for (const sp of z.spawnFor[team]) fwd.push({ z: z.id, d: nd(sp.position) });
    }
    fwd.sort((x, y) => y.d - x.d);
    const blocked = fwd.filter((f) => f.d < (RULES?.forwardSpawnBlockRadius ?? 8)).length;
    const bestFwd = fwd.length ? fwd[0].d : null;
    const B = RULES?.forwardSpawnBias ?? 34;
    return {
      team: ['RED', 'BLUE'][team],
      ownedZones: m.sites.filter((z) => z.owner === team).map((z) => z.id).join(',') || '(none)',
      forwardCandidates: fwd.length,
      blockedByEnemyProximity: blocked,
      bestBaseScore: +bestBase.toFixed(1),
      bestForwardRawDist: bestFwd === null ? null : +bestFwd.toFixed(1),
      bestForwardScore: bestFwd === null ? null : +(bestFwd + B).toFixed(1),
      forwardCanEverWin: bestFwd === null ? false : bestFwd + B + 6 > bestBase,
      // How many of the owned forward points beat the best base point at all.
      forwardPointsThatBeatBase: fwd.filter((f) => f.d + B > bestBase).length,
    };
  };
  out.teams = [audit(0), audit(1)];

  // 1. does the beacon get planted?
  const c = m.caches?.list?.[0];
  const now = e.ctx.time.elapsed;
  const planted = c ? m.caches.plantBeacon(c, m.playerTeam, 0, now) : false;
  const b = m.caches?.beacon;
  out.beacon = {
    cacheCount: m.caches?.list?.length ?? 0,
    planted,
    active: b?.active,
    team: b?.team,
    secondsLeft: b ? +(b.until - now).toFixed(1) : null,
    at: b?.at,
    position: b ? [+b.position.x.toFixed(1), +b.position.y.toFixed(1), +b.position.z.toFixed(1)] : null,
    hasYaw: b ? typeof b.yaw === 'number' : null,
    distToNearestFoe: b ? +m._nearestFoeDist(b.team, b.position).toFixed(1) : null,
  };
  // 2/3. with the beacon live, does it win the auction? Run _safeSpawn 200 times
  // for the beacon's own side and count what it actually returns.
  const tally = { base: 0, zone: 0, beacon: 0 };
  const yaw = { yaw: 0, zone: '', beacon: false };
  const team = b.team;
  const role = m.playerTeam === team ? m.playerRole : 1 - m.playerRole;
  for (let i = 0; i < 200; i++) {
    m._safeSpawn(team, role, yaw);
    if (yaw.beacon) tally.beacon++;
    else if (yaw.zone) tally.zone++;
    else tally.base++;
  }
  out.auction200 = tally;
  out.beaconScore = +(m._nearestFoeDist(team, b.position) + (RULES?.forwardSpawnBias ?? 34)).toFixed(1);
  out.liveTallies = { forward: [...m._forwardSpawns], base: [...m._baseSpawns], beaconSpawns: m.caches.stats.beaconSpawns };
  return out;
});

console.log('\n═══ RESPAWN PROBE ═══');
console.log('  RULES.forwardSpawnBias        ', r.rules.forwardSpawnBias);
console.log('  RULES.forwardSpawnBlockRadius ', r.rules.forwardSpawnBlockRadius);
console.log('\n  zones');
for (const z of r.zones) console.log(`    ${z.id}  owner ${z.owner.padEnd(8)} stand ${z.standPoints}  spawnFor red/blue ${z.spawnForRed}/${z.spawnForBlue}`);
console.log('\n  Q2/Q3 — the OLD single-auction formula, audited statically.');
console.log('  (kept as the before/after: what _safeSpawn now does is the 200-respawn tally below)');
for (const t of r.teams) {
  console.log(`    ${t.team}  owns ${t.ownedZones}`);
  console.log(`       forward candidates ${t.forwardCandidates}, vetoed by an enemy within block radius: ${t.blockedByEnemyProximity}`);
  console.log(`       best BASE point score    ${t.bestBaseScore} m  (distance to nearest enemy)`);
  console.log(`       best FORWARD point       ${t.bestForwardRawDist} m raw  ->  ${t.bestForwardScore} with the bias`);
  console.log(`       forward points that beat the base at all: ${t.forwardPointsThatBeatBase} / ${t.forwardCandidates}`);
  console.log(`       under the OLD formula, could a forward point win?  ${t.forwardCanEverWin ? 'yes' : 'NO — the base cluster outscored every one of them'}`);
}
console.log('\n  Q1 — the beacon');
console.log('   ', JSON.stringify(r.beacon, null, 0));
console.log(`    beacon auction score ${r.beaconScore}`);
console.log('\n  200 respawns for the beacon owner resolved to:', JSON.stringify(r.auction200));
console.log('  live match tallies so far:', JSON.stringify(r.liveTallies));
console.log('\n  pageErrors', pageErrors.length ? pageErrors.slice(0, 4) : 'none');
await browser.close();

/* ────────────────────────────────────────────────────────────────────────────
 * PHASE 2 — a CLEAN match, no probe calls in the tally.
 *
 * Phase 1 calls `_safeSpawn` 200 times by hand, which writes `_forwardSpawns`,
 * so its live tallies are polluted by definition. This runs a fresh match to its
 * natural end and reads the counters the match itself kept, which is the only
 * honest "how often does a man actually come back on a point his side holds".
 *
 * The beacon cannot appear here at all and that is not a failure of the probe:
 * planting one is a PLAYER input (`_updateCacheUse`), no bot ever plants one, and
 * the headless player never presses F. So a match's `beaconSpawns` is 0 whatever
 * the auction does, and phase 1 is the only place the beacon can be measured.
 * ──────────────────────────────────────────────────────────────────────────── */
const b2 = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const p2 = await b2.newPage({ viewport: { width: 900, height: 520 } });
await p2.goto(URL, { waitUntil: 'domcontentloaded' });
await p2.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await p2.evaluate(() => (window.__ENGINE__.time.scale = 12));
await p2.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 180000 });
await p2.waitForFunction("window.__ENGINE__.ctx.peek('match').phase!=='live'", null, { timeout: 240000 });
const m2 = await p2.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const f = m._forwardSpawns, b = m._baseSpawns;
  return {
    forward: [...f], base: [...b],
    pct: [0, 1].map((t) => +((100 * f[t]) / Math.max(1, f[t] + b[t])).toFixed(1)),
    beaconSpawns: m.caches.stats.beaconSpawns,
  };
});
console.log('\n═══ PHASE 2 — one clean match, respawns by kind ═══');
console.log(`  RED   forward ${m2.forward[0]}  base ${m2.base[0]}   -> ${m2.pct[0]}% forward`);
console.log(`  BLUE  forward ${m2.forward[1]}  base ${m2.base[1]}   -> ${m2.pct[1]}% forward`);
console.log(`  beacon respawns ${m2.beaconSpawns} (player-only feature; 0 is expected headless)`);
await b2.close();
