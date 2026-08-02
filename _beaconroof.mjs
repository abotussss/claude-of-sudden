/**
 * THE PLAYER'S CASE. 「屋上にリスポーンしたAIが屋上から降りてない」
 *
 * A vantage nest is a cache like any other and `MatchSystem._cacheUse` plants
 * the beacon at whatever `caches.nearest(player.position)` returns — so a human
 * standing in a roof nest and tapping F makes the ROOF his side's spawn for
 * thirty seconds. Nothing in the game stops him and nothing else on this map
 * puts a bot up there. This drives exactly that and watches what the men do.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const SEED = args.seed ?? 1;
const TICKS = +(args.ticks ?? 200);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', (e) => console.log('  PAGEERROR', e.message));
await p.goto(`http://127.0.0.1:4384/?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 6; });
await wait(240); // let the match get going
console.log(await p.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const ai = ctx.peek('ai'), match = ctx.peek('match');
  const now = ctx.time.elapsed;
  const list = match.caches.list ?? match.caches.all;
  const v = list.filter((c) => c.kind === 'vantage');
  const team = 0;
  const c = v[0];
  match.caches.beacon.active = false;
  match.caches.beacon.readyAt = -1e9;
  const ok = match.caches.plantBeacon(c, team, 0, now);
  // and kill six of that side so they come back at it
  const live = ai.agents.filter((a) => a.alive && ai.teamOf(a) === team).slice(0, 6);
  for (const a of live) a.applyDamage(500, 'torso', a.position, { x: 0, y: 0, z: 1 });
  window.__W__ = { team, at: c.id, y: c.position.y, killed: live.map((a) => a.name), seen: new Map(), log: [] };
  window.__TICK__ = () => {
    const W = window.__W__, g = ai.grid, t = ctx.time.elapsed;
    for (const a of ai.agents) {
      if (!a.alive || ai.teamOf(a) !== W.team) continue;
      if (a.position.y < 2.5) { const e = W.seen.get(a.name); if (e && !e.end) { e.end = t; e.how = 'down'; } continue; }
      let e = W.seen.get(a.name);
      if (!e) W.seen.set(a.name, (e = { name: a.name, start: t, y0: +a.position.y.toFixed(1), obs: [] }));
      if (e.end) continue;
      const off = g.nearest(a.position.x, a.position.z, a.position.y, 3, 1.5) < 0;
      const off10 = g.nearest(a.position.x, a.position.z, a.position.y, 10, 1.5) < 0;
      if (e.obs.length < 200) e.obs.push(`t${(t - e.start).toFixed(1)} y${a.position.y.toFixed(1)} ${off ? 'OFFGRID' : 'ongrid'}${off10 ? '/NOREGAIN' : ''} ds${a.desiredSpeed.toFixed(1)} sp${a.speed.toFixed(1)} ${a.state} path${a.hasMoveTarget ? a.pathLen : 0} rung${a.stuckRung} ob${a.objectiveBlocked ? 'Y' : '.'} ${a.objective ? a.objective.mode : 'none'}`);
    }
  };
  return `beacon at ${c.id} y ${c.position.y.toFixed(2)} planted=${ok}; killed ${live.length} of team ${team}: ${live.map((a) => a.name).join(',')}`;
}));
for (let i = 0; i < TICKS; i++) { await wait(6); await p.evaluate(() => window.__TICK__()); }
const r = await p.evaluate(() => {
  const W = window.__W__, t = window.__ENGINE__.ctx.time.elapsed;
  return [...W.seen.values()].map((e) => ({ name: e.name, y0: e.y0, dur: +((e.end ?? t) - e.start).toFixed(1), how: e.how ?? 'STILL UP THERE', n: e.obs.length, first: e.obs[0], mid: e.obs[(e.obs.length / 2) | 0], last: e.obs[e.obs.length - 1] }));
});
console.log(`\n  ${r.length} men of that side were above 2.5 m after the beacon went down:`);
for (const e of r) {
  console.log(`\n  ${e.name}  y0 ${e.y0}  ${e.dur}s  ${e.how}`);
  console.log(`     first ${e.first}`);
  console.log(`     mid   ${e.mid}`);
  console.log(`     last  ${e.last}`);
}
await b.close();
