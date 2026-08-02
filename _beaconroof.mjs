/**
 * THE ROOF-SPAWN GATE. 「屋上にリスポーンしたAIが屋上から降りてない」
 *
 * WHY THIS EXISTS AND WHY `tools/stuckcheck.mjs` COULD NOT CATCH IT. stuckcheck's
 * own definition — wants to move, went nowhere — does catch a stranded roof bot:
 * the men measured here read `desiredSpeed` 4.3 with `speed` 0.0 for minutes at a
 * time. What it cannot do is MEET one. Over six real matches on seeds 1-5,
 * 0 of 424 bot spawns and 0 of ~57 000 live man-samples were above 2.5 m: nothing
 * a bot does on this map puts it on a roof, so the gate's sample never contains
 * the case and the whole mechanism can rot silently.
 *
 * A HUMAN puts them there. All eight vantage nests are `floor:'roof'`, a nest is
 * a cache like any other, and `MatchSystem._cacheUse` plants the beacon at
 * whatever `caches.nearest(player.position)` returns — so a player who taps F in
 * a nest makes the ROOF his side's spawn for thirty seconds. This drives exactly
 * that and measures how long the men stay up there.
 *
 *   node _beaconroof.mjs --seeds=1,2,3 [--ticks=180]
 *
 * FAILS when a man is above 2.5 m for more than MAX_ALOFT seconds, or when fewer
 * than DOWN_FRAC of them are down inside GRACE.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const SEEDS = String(args.seeds ?? '1,2,3').split(',');
const TICKS = +(args.ticks ?? 180);
const URL = args.url ?? 'http://127.0.0.1:4384/';
/**
 * MEASURED, seeds 1-3, 35 men put on W1's roof by a beacon: all 35 came down,
 * the worst took 35.2 s and 91 % were off inside 30. Before the fix two men on
 * the same roof lasted 413 s and 298 s of a 400 s match.
 */
const MAX_ALOFT = 60;
const GRACE = 30;
const DOWN_FRAC = 0.8;

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const rows = [];
for (const seed of SEEDS) {
  const p = await b.newPage({ viewport: { width: 900, height: 520 } });
  p.on('pageerror', (e) => console.log('  PAGEERROR', e.message));
  await p.goto(`${URL}?seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
  const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
  await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 6; });
  await wait(240);
  const head = await p.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    const ai = ctx.peek('ai'), match = ctx.peek('match');
    const list = match.caches.list ?? match.caches.all;
    const nest = list.filter((c) => c.kind === 'vantage')[0];
    const team = 0;
    match.caches.beacon.active = false;
    match.caches.beacon.readyAt = -1e9;
    const ok = match.caches.plantBeacon(nest, team, 0, ctx.time.elapsed);
    for (const a of ai.agents.filter((a) => a.alive && ai.teamOf(a) === team).slice(0, 6)) {
      a.applyDamage(500, 'torso', a.position, { x: 0, y: 0, z: 1 });
    }
    window.__W__ = { team, seen: new Map() };
    /**
     * KEYED ON `id`, NOT ON THE CALLSIGN. A respawn is a NEW Agent with the SAME
     * NAME and the corpse stays in `ai.agents` for `corpseLimit` — so the first
     * version had the body closing the episode of the man who had just spawned
     * on the roof to replace it, and reported all twenty-six of them dead within
     * 3.8 s of arriving.
     */
    window.__TICK__ = () => {
      const W = window.__W__, t = ctx.time.elapsed;
      for (const a of ai.agents) {
        if (ai.teamOf(a) !== W.team) continue;
        let e = W.seen.get(a.id);
        if (!a.alive) { if (e && e.end == null) { e.end = t; e.how = 'died'; } continue; }
        if (a.position.y < 2.5) { if (e && e.end == null) { e.end = t; e.how = 'down'; } continue; }
        if (!e) W.seen.set(a.id, (e = { name: a.name, start: t, y0: +a.position.y.toFixed(1), end: null, how: null, obs: [] }));
        if (e.obs.length < 120) {
          const g = ai.grid;
          e.obs.push(`t${(t - e.start).toFixed(0)} y${a.position.y.toFixed(1)} ${g.nearest(a.position.x, a.position.z, a.position.y, 3, 1.5) < 0 ? 'OFF' : 'on '} ds${a.desiredSpeed.toFixed(1)} sp${a.speed.toFixed(1)} ${a.state} p${a.hasMoveTarget ? a.pathLen : 0} r${a.stuckRung} ${a.objective ? a.objective.mode : '-'}`);
        }
      }
    };
    return `${nest.id} y ${nest.position.y.toFixed(2)} planted=${ok}`;
  });
  for (let i = 0; i < TICKS; i++) { await wait(6); await p.evaluate(() => window.__TICK__()); }
  const r = await p.evaluate(() => {
    const W = window.__W__, t = window.__ENGINE__.ctx.time.elapsed;
    return [...W.seen.values()].map((e) => ({
      name: e.name, y0: e.y0, how: e.how ?? 'STILL UP', dur: +((e.end ?? t) - e.start).toFixed(1), obs: e.obs,
    })).sort((a, c) => c.dur - a.dur);
  });
  const down = r.filter((e) => e.how === 'down');
  const inGrace = down.filter((e) => e.dur <= GRACE).length;
  const worst = r.length ? r[0] : null;
  rows.push({ seed, head, n: r.length, down: down.length, inGrace, worst, r });
  console.log(`\n  seed ${seed} — beacon ${head}`);
  console.log(`    ${r.length} men aloft: down ${down.length}, died up there ${r.filter((e) => e.how === 'died').length}, still up ${r.filter((e) => e.how === 'STILL UP').length}`);
  console.log(`    seconds aloft: ${r.map((e) => `${e.name}:${e.dur}${e.how === 'STILL UP' ? '!' : ''}`).join('  ')}`);
  if (args.trace) {
    for (const e of r.slice(0, 2)) {
      console.log(`    --- ${e.name} ${e.dur}s ${e.how}`);
      for (const o of e.obs) console.log('      ', o);
    }
  }
  await p.close();
}
await b.close();
let fail = 0;
const all = rows.flatMap((x) => x.r);
const worst = all.sort((a, c) => c.dur - a.dur)[0];
const down = all.filter((e) => e.how === 'down');
const frac = down.filter((e) => e.dur <= GRACE).length / Math.max(1, all.length);
console.log(`\n  ${all.length} men aloft over ${rows.length} seeds`);
console.log(`  worst: ${worst ? `${worst.name} ${worst.dur}s (${worst.how})` : 'none'}   limit ${MAX_ALOFT}s`);
console.log(`  down inside ${GRACE}s: ${(frac * 100).toFixed(0)}%   floor ${(DOWN_FRAC * 100).toFixed(0)}%`);
if (worst && worst.dur > MAX_ALOFT) { console.log('[beaconroof] FAIL — a man is living on the roof'); fail = 1; }
else if (all.length && frac < DOWN_FRAC) { console.log('[beaconroof] FAIL — too few get down in time'); fail = 1; }
else console.log('[beaconroof] PASS — a man who respawns on a roof comes off it');
process.exit(fail);
