/**
 * "Do the bots actually fight?" — the smallest question the AI has to answer.
 *
 * Boots the game headless, runs the match on a time scale, and counts the three
 * numbers that separate a live firefight from a parade: shots fired, men killed,
 * and how the roster is distributed across the AI states. A build where every
 * agent sits in ADVANCE forever with `fires: 0` is broken even though nothing
 * throws and the build passes — that failure is silent, so it needs a probe that
 * looks at behaviour rather than at exceptions.
 *
 *   node tools/fightcheck.mjs [--url=…] [--frames=400] [--scale=12] [--json]
 *
 * WHY FRAMES AND NOT SECONDS. The wall clock says nothing about how much game
 * happened: a slow frame on a cold GPU costs the same second as a fast one. The
 * probe waits for `time.frame` to advance by `--frames` and reports rates
 * normalised to game minutes, so the same run on a loaded machine and an idle
 * one produce comparable numbers. Bisecting needs that — otherwise "0 shots"
 * cannot be told apart from "the run was too short".
 *
 * Exit code is 0 when shots were fired, 1 when the roster never engaged, 2 when
 * the page never booted. That makes it usable directly as `git bisect run`.
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
const URL = args.url ?? 'http://127.0.0.1:4225/';
const FRAMES = Number(args.frames ?? 400);
const SCALE = Number(args.scale ?? 12);
const QUIET = args.json === true;

const say = (...a) => { if (!QUIET) console.log(...a); };

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

say(`[fightcheck] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
} catch (err) {
  console.error('[fightcheck] boot did not finish:', err.message);
  console.error('[fightcheck] errors:', errors.slice(0, 8));
  await browser.close();
  process.exit(2);
}
say('[fightcheck] ready');

// Counters live in the page and are driven by the game's own events, so a shot
// is counted the moment the weapon says it happened rather than being inferred
// between two polls.
await page.evaluate((scale) => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const c = { fires: 0, deaths: 0, damage: 0, samples: 0, states: {}, objectives: {}, targets: 0 };
  window.__FIGHT__ = c;
  c.frame0 = e.time.frame;
  c.elapsed0 = e.time.elapsed;
  e.events.on('weapon:fire', () => { c.fires++; });
  e.events.on('actor:death', () => { c.deaths++; });
  e.events.on('damage:dealt', () => { c.damage++; });
  // The histogram is an occupancy average, not a snapshot: sampled once per
  // engine frame it says what share of the match each state actually held. The
  // sampler wraps `step` rather than listening for an event, because the engine
  // does not broadcast one and a wall-clock interval would sample unevenly once
  // the time scale is up.
  const step = e.step.bind(e);
  e.step = (now) => {
    step(now);
    c.samples++;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      c.states[a.state] = (c.states[a.state] ?? 0) + 1;
      const o = a.objective ? a.objective.mode : 'none';
      c.objectives[o] = (c.objectives[o] ?? 0) + 1;
      if (a.targetActor) c.targets++;
    }
  };
  e.time.scale = scale;
}, SCALE);

const read = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const ai = e.ctx.peek('ai');
    const c = window.__FIGHT__;
    const alive = ai.agents.filter((a) => a.alive).length;
    return {
      frames: e.time.frame - c.frame0,
      gameSeconds: +(e.time.elapsed - c.elapsed0).toFixed(2),
      fires: c.fires,
      deaths: c.deaths,
      damage: c.damage,
      alive,
      score: m ? [...m.score] : null,
      phase: m ? m.phase : null,
      states: { ...c.states },
      objectives: { ...c.objectives },
      samples: c.samples,
      targetShare: c.samples ? +(c.targets / c.samples).toFixed(2) : 0,
    };
  });

const deadline = Date.now() + 180000;
let cur = await read();
while (cur.frames < FRAMES && Date.now() < deadline) {
  await page.waitForTimeout(500);
  cur = await read();
}

const gm = cur.gameSeconds / 60 || 1e-9;
const pct = (h) => {
  const tot = Object.values(h).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(
    Object.entries(h)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, +((v / tot) * 100).toFixed(1)])
  );
};

const out = {
  url: URL,
  scale: SCALE,
  frames: cur.frames,
  gameSeconds: cur.gameSeconds,
  alive: cur.alive,
  score: cur.score,
  fires: cur.fires,
  deaths: cur.deaths,
  damage: cur.damage,
  shotsPerMin: +(cur.fires / gm).toFixed(1),
  deathsPerMin: +(cur.deaths / gm).toFixed(1),
  stateShare: pct(cur.states),
  objectiveShare: pct(cur.objectives),
  // Mean number of live agents holding a target — the leading indicator: it
  // moves before the first trigger is pulled, so a build that acquires but
  // cannot shoot looks different from one that never sees anyone.
  meanWithTarget: cur.targetShare,
  errors: errors.slice(0, 8),
};

if (QUIET) console.log(JSON.stringify(out));
else {
  console.log('');
  console.log(`[fightcheck] ${cur.frames} frames / ${cur.gameSeconds}s of game at ${SCALE}x`);
  console.log(`  shots ${cur.fires}  (${out.shotsPerMin}/min)`);
  console.log(`  deaths ${cur.deaths}  (${out.deathsPerMin}/min)`);
  console.log(`  damage events ${cur.damage}   score ${JSON.stringify(cur.score)}   alive ${cur.alive}`);
  console.log(`  states     ${JSON.stringify(out.stateShare)}`);
  console.log(`  objectives ${JSON.stringify(out.objectiveShare)}`);
  console.log(`  mean agents holding a target ${out.meanWithTarget}`);
  if (errors.length) console.log(`  errors ${JSON.stringify(errors.slice(0, 4))}`);
  console.log(cur.fires > 0 ? '[fightcheck] PASS — the roster engages' : '[fightcheck] FAIL — nobody fired');
}

await browser.close();
process.exit(cur.fires > 0 ? 0 : 1);
