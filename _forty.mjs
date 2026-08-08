/**
 * THE ROSTER'S BILL — frame cost and the A* budget, on whichever map is asked
 * for, sampled once the match is actually LIVE.
 *
 *   node _forty.mjs [plains|town] [port]
 *
 * `tools/perf.mjs` hardcodes `http://127.0.0.1:8080/?capture=1` and takes a
 * static `hero` shot with the match frozen, so it cannot see what a roster
 * costs. This walks 400 real frames of a live match and reports the same three
 * numbers the `teamSize` note in rules.js is argued from: wall-clock frame time,
 * the A* ration (`ai.stats.pathBudget`, which IS `pathMsBudget / pathCostMs`)
 * and deferred solves per frame.
 *
 * It echoes `world.level.id` from inside the page, because several probes in
 * this repo carried a truncating `split('=')` and silently ran the town.
 */
import { chromium } from 'playwright';
const MAP = process.argv[2] ?? 'plains';
const PORT = process.argv[3] ?? '4614';
const URL = MAP === 'town'
  ? `http://127.0.0.1:${PORT}/?capture=1`
  : `http://127.0.0.1:${PORT}/?map=${MAP}&capture=1`;

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const id = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
// Run the match up to `live` at speed, then measure at scale 1 so the frame
// times are the ones a player would see rather than eight seconds of one.
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await p.waitForFunction(() => window.__ENGINE__.ctx.peek('match')?.phase === 'live', null, { timeout: 240000 });
await p.evaluate(() => new Promise((r) => setTimeout(r, 6000)));   // let the men get off the pad
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });
await p.evaluate(() => new Promise((r) => setTimeout(r, 2000)));

/**
 * THREE BLOCKS IN ONE BOOT, and the reason is that a single block is not a
 * measurement on this machine: repeated runs of the same build came back with
 * `pathCostMs` between 0.30 and 1.92 ms, which is the difference between a
 * ration of 8.9 solves a frame and the hard floor of 3. Several agents are
 * building and driving headless Chromium on this box at once, so the timer is
 * measuring the machine as much as the roster. Reported as the MEDIAN of three
 * with the spread stated.
 */
const block = () => p.evaluate(() => new Promise((done) => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  const N = 400, ts = [];
  const bud = [], cost = [], defer = [];
  let last = performance.now(), i = 0, lastDef = ai.stats.pathsDeferred ?? 0;
  const tick = () => {
    const n = performance.now();
    ts.push(n - last); last = n;
    bud.push(ai.stats.pathBudget ?? 0);
    cost.push(ai.stats.pathCostMs ?? 0);
    const d = ai.stats.pathsDeferred ?? 0; defer.push(d - lastDef); lastDef = d;
    if (++i >= N) {
      ts.sort((a, b) => a - b);
      const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
      done({
        agents: ai.agents.length, alive: ai.stats.alive,
        frameMean: +mean(ts).toFixed(2),
        frameMed: +ts[N >> 1].toFixed(2),
        frameP95: +ts[Math.floor(N * 0.95)].toFixed(2),
        pathBudget: +mean(bud).toFixed(1),
        pathCostMs: +mean(cost).toFixed(3),
        deferredPerFrame: +mean(defer).toFixed(2),
      });
    } else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));
const runs = [];
for (let k = 0; k < 3; k++) {
  runs.push(await block());
  await p.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
}
const med = (key) => {
  const v = runs.map((r) => r[key]).sort((a, b) => a - b);
  return v[1];
};
const span = (key) => {
  const v = runs.map((r) => r[key]).sort((a, b) => a - b);
  return `${v[0]}..${v[2]}`;
};
const r = {
  agents: med('agents'),
  frameMean: med('frameMean'), frameMeanSpan: span('frameMean'),
  frameP95: med('frameP95'), frameP95Span: span('frameP95'),
  pathBudget: med('pathBudget'), pathBudgetSpan: span('pathBudget'),
  pathCostMs: med('pathCostMs'), pathCostSpan: span('pathCostMs'),
  deferredPerFrame: med('deferredPerFrame'), deferredSpan: span('deferredPerFrame'),
};
const roster = await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const by = {}; for (const q of (m.roster ?? [])) by[q.team] = (by[q.team] ?? 0) + 1;
  return { rosterLen: m.roster?.length ?? 0, byTeam: by };
});
console.log(`level.id=${id} roster=${roster.rosterLen} ${JSON.stringify(roster.byTeam)} ${JSON.stringify(r)} pageerrors=${errs.length}`);
if (errs.length) console.log('  first:', errs[0]);
await b.close();
