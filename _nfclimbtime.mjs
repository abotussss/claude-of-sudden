/**
 * DO THE BOTS ACTUALLY CLIMB IT? — the measurement `tools/floorcheck.mjs`
 * cannot make on this map, and the one the stair rebuild lives or dies by.
 *
 *   node _nfclimbtime.mjs [--url=…] [--secs=…] [--scale=…]
 *
 * `floorcheck` walks `world.layout.BUILDINGS` and the plain has none — it
 * publishes no `buildings` at all, so the gate exits with "world does not
 * expose layout/buildings" and tells you nothing. That is exactly the blind
 * spot this pass had to not ship into: `plains-works.js` chose ramps over
 * stairs because "a stair tread does not connect" (`maxStep` 0.45 across an
 * 0.8 m cell), and a stair the bots cannot climb recreates the town's 36 820
 * walkable-but-unreachable cells in 2 113 components with 0 joined to the
 * ground. A reachability proof on the GRID is necessary and it is not
 * sufficient; men have to be up there.
 *
 * So this samples every alive bot against the named tiers of both structures
 * for a real stretch of live match and reports, per tier, the share of
 * bot-samples spent on it and HOW MANY DISTINCT BOTS ever set foot on it.
 * The second number is the one that matters: 4 % of bot-time that is one man
 * standing on a route is the failure `caches.js` documents on the town.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4607/?map=plains&capture=1';
const SECS = Number(args.secs ?? 150);
const SCALE = Number(args.scale ?? 6);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const id = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
if (id !== 'plains') { console.error(`NOT THE PLAIN (${id}) — aborting.`); await b.close(); process.exit(2); }
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await p.evaluate((s) => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._checkWinConditions = () => {};
  window.__ENGINE__.ctx.time.scale = s;
}, SCALE);

await p.evaluate(() => {
  const E = window.__ENGINE__;
  const w = E.ctx.peek('world');
  const Y0 = w.groundHeight(0, -32);
  const YF = w.groundHeight(0, 48);
  /**
   * A tier is a plan region plus a height window. The windows are ±0.8 m, i.e.
   * one nav cell either way, so a man on a crate on the deck still counts as
   * being on the deck and a man on the ground under it does not.
   */
  window.__T = {
    tiers: [
      ['tower P1 deck (3.2 m)', (x, z, y) => Math.hypot(x, z + 32) < 22 && Math.abs(y - (Y0 + 3.2)) < 0.9],
      ['tower stair I (0-3.2)', (x, z, y) => Math.abs(Math.abs(x) - 22.95) < 2.4 && Math.abs(z + 32) < 6.2 && y > Y0 + 0.5 && y < Y0 + 3.1],
      ['tower stair II (3.2-6.6)', (x, z, y) => Math.abs(x) > 10 && Math.abs(x) < 21.6 && Math.abs(Math.abs(z + 32) - 4.21) < 2.6 && y > Y0 + 3.5 && y < Y0 + 6.5],
      ['tower P2 gallery (6.6 m)', (x, z, y) => Math.hypot(x, z + 32) < 12.8 && Math.abs(y - (Y0 + 6.6)) < 0.9],
      ['tower control room (6.74)', (x, z, y) => Math.hypot(x, z + 32) < 6.6 && Math.abs(y - (Y0 + 6.74)) < 0.9],
      ['fort courtyard (0 m)', (x, z, y) => Math.max(Math.abs(x), Math.abs(z - 48)) < 24 && Math.abs(y - YF) < 1.1],
      ['fort magazine (0.14)', (x, z, y) => Math.abs(x) < 8.4 && Math.abs(z - 45) < 6.4 && Math.abs(y - (YF + 0.14)) < 0.9],
      ['fort barrack shed', (x, z, y) => Math.hypot(x + 13, z - 60) < 5.2 && Math.abs(y - (YF + 0.04)) < 0.9],
      ['fort rampart walk (4.4)', (x, z, y) => Math.max(Math.abs(x), Math.abs(z - 48)) < 37 && Math.abs(y - (YF + 4.4)) < 0.9],
    ],
    hit: [], seen: [], samples: 0, botSamples: 0,
  };
  window.__T.hit = window.__T.tiers.map(() => 0);
  window.__T.seen = window.__T.tiers.map(() => new Set());
});

const step = () => p.evaluate(() => {
  const E = window.__ENGINE__;
  const ai = E.ctx.peek('ai');
  const T = window.__T;
  T.samples++;
  for (const a of ai.agents ?? []) {
    if (!a || a.dead || a.health <= 0) continue;
    const { x, y, z } = a.position;
    T.botSamples++;
    for (let i = 0; i < T.tiers.length; i++) {
      if (T.tiers[i][1](x, z, y)) { T.hit[i]++; T.seen[i].add(a.name ?? a.id ?? String(i)); }
    }
  }
});

const t0 = Date.now();
while ((Date.now() - t0) / 1000 < SECS) { await step(); await new Promise((r) => setTimeout(r, 220)); }

const out = await p.evaluate(() => {
  const T = window.__T;
  return {
    samples: T.samples, botSamples: T.botSamples,
    rows: T.tiers.map((t, i) => ({ name: t[0], hits: T.hit[i], men: T.seen[i].size })),
    live: (window.__ENGINE__.ctx.peek('ai').agents ?? []).length,
  };
});

console.log(`\n  ${out.samples} sweeps, ${out.botSamples} bot-samples, ${out.live} agents\n`);
console.log('  tier                            bot-samples     share     distinct men');
for (const r of out.rows) {
  console.log(`  ${r.name.padEnd(30)} ${String(r.hits).padStart(9)}   ${((r.hits / out.botSamples) * 100).toFixed(2).padStart(6)} %   ${String(r.men).padStart(6)}`);
}
console.log(`\n${errs.length} pageerrors`);
if (errs.length) console.log('  first:', errs[0]);
await b.close();
