/**
 * Headless round test for the demolition mode.
 *
 * Boots the game in GPU-backed headless Chromium, runs the match on a time
 * scale, and prints every round transition it observes. This is the smoke test
 * for `src/match`: it answers "does a round actually play end to end" without a
 * human sitting through 2 minutes per round.
 *
 *   node tools/matchtest.mjs [--url=…] [--seconds=120] [--scale=6] [--botcarrier]
 *
 * `--botcarrier` hands the C4 to a bot every round instead of to the human. The
 * human does not move in a headless run, so without it the attacking rounds
 * where the player's side attacks always time out — which says nothing about the
 * mode and everything about nobody being at the keyboard.
 *
 * WHY A TIME SCALE AND NOT A FRAME PUMP. The engine's own rAF loop is what the
 * game ships with, and driving `engine.step()` by hand would test a code path
 * nobody plays. `time.scale` multiplies the frame delta instead, so every
 * subsystem sees the same sequence it would in a real match, only faster. The
 * physics substep cap (MAX_SUBSTEPS = 8) sheds time above roughly 5x, which
 * makes the *player* capsule lag — irrelevant here, because the player stands
 * still and the thing under test is the AI and the round machine, both of which
 * run off the variable `update(dt)`.
 */

import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    /**
     * SPLIT ON THE FIRST `=` ONLY. `split('=')` destructured to `[k, v]` threw
     * away everything after the second one, so `--url=…/?seed=12` reached the
     * page as `…/?seed`, `Number('')` became 0, and this gate measured seed 0
     * while reporting the seed it was asked for. It "passed" on the seed a
     * sweep failed 8 boots out of 8. A tool that silently measures something
     * other than what it was pointed at is worse than a tool that crashes.
     */
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
  })
);
const URL = args.url ?? 'http://127.0.0.1:5173/';
const SECONDS = Number(args.seconds ?? 120);
const SCALE = Number(args.scale ?? 6);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

console.log(`[matchtest] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
} catch (err) {
  console.error('[matchtest] boot did not finish:', err.message);
  console.error('[matchtest] page errors:', errors.slice(0, 12));
  console.error('[matchtest] state:', await page.evaluate(() =>
    JSON.stringify({ engine: !!window.__ENGINE__, prewarm: window.__PREWARM__ ?? null })));
  await browser.close();
  process.exit(2);
}
console.log('[matchtest] ready');

// Subscribe to the match's own events, so what we report is what the game says
// happened rather than what a poller inferred between samples.
await page.evaluate((scale) => {
  const e = window.__ENGINE__;
  window.__LOG__ = [];
  const at = () => +e.time.elapsed.toFixed(1);
  e.events.on('match:round', (p) =>
    window.__LOG__.push({ t: at(), ev: 'round', round: p.round, attackers: p.attackers })
  );
  e.events.on('match:bomb', (p) =>
    window.__LOG__.push({ t: at(), ev: 'bomb', state: p.state, site: p.site, carrier: p.carrier })
  );
  e.events.on('match:result', (p) =>
    window.__LOG__.push({
      t: at(),
      ev: 'result',
      winner: p.winner,
      reason: p.reason,
      score: [...p.score],
      matchOver: p.matchOver,
    })
  );
  e.events.on('player:death', () => window.__LOG__.push({ t: at(), ev: 'player-death' }));
  e.time.scale = scale;
}, SCALE);

if (args.botcarrier) {
  await page.evaluate(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    window.__ENGINE__.events.on('match:round', () => {
      if (m.bomb.carrier !== m.player) return;
      const bots = m._botsByTeam[m.attackers].filter((a) => a.alive);
      if (bots.length) {
        m.bomb.giveTo(bots[0]);
        m._assignObjectives();
      }
    });
  });
  console.log('[matchtest] --botcarrier: the C4 goes to a bot every round');
}

const sample = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const ai = e.ctx.peek('ai');
    const states = {};
    const objectives = {};
    for (const a of ai.agents) {
      if (!a.alive) continue;
      states[a.state] = (states[a.state] ?? 0) + 1;
      const o = a.objective ? a.objective.mode : 'none';
      objectives[o] = (objectives[o] ?? 0) + 1;
    }
    return {
      elapsed: +e.time.elapsed.toFixed(1),
      frame: e.time.frame,
      phase: m.phase,
      round: m.round,
      clock: +m.roundClock.toFixed(1),
      score: [...m.score],
      aliveUs: m.aliveCount(m.playerTeam),
      aliveThem: m.aliveCount(1 - m.playerTeam),
      bomb: m.bomb.state,
      fuse: +m.bomb.fuse.toFixed(1),
      states,
      objectives,
      playerDead: m.player.dead,
      pathsDeferred: ai.stats.pathsDeferred,
      log: window.__LOG__.splice(0),
    };
  });

const t0 = Date.now();
let last = '';
while ((Date.now() - t0) / 1000 < SECONDS) {
  const s = await sample();
  for (const l of s.log) console.log('  ·', JSON.stringify(l));
  const line =
    `t=${String(s.elapsed).padStart(6)}s ${s.phase.padEnd(9)} r${s.round} ` +
    `${s.aliveUs}v${s.aliveThem} clock=${String(s.clock).padStart(5)} ` +
    `bomb=${s.bomb}${s.bomb === 'planted' ? `(${s.fuse}s)` : ''} ` +
    `score=${s.score.join('-')} ${JSON.stringify(s.states)} ${JSON.stringify(s.objectives)}`;
  if (line !== last) {
    console.log(line);
    last = line;
  }
  await page.waitForTimeout(1000);
}

const final = await sample();
for (const l of final.log) console.log('  ·', JSON.stringify(l));
console.log('\n[matchtest] final', JSON.stringify(final, null, 2));
console.log('[matchtest] errors', errors.slice(0, 12));
await browser.close();
process.exit(errors.length ? 1 : 0);
