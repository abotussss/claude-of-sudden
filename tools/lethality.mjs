/**
 * How long does a standing player survive?
 *
 * The complaint was "the enemy AI is too good, I die immediately". That is a
 * measurable claim, so this measures it: at the start of every round the player
 * is parked in the open on the enemy's approach and left there, and the time
 * from the round going live to `player:death` is recorded. Repeat over rounds,
 * report the distribution.
 *
 *   node tools/lethality.mjs [--url=…] [--rounds=6] [--legacy]
 *
 * `--legacy` overwrites each bot's combat parameters with the pre-skill-model
 * values as it spawns (flat 0.032 rad cone, instant settle, fast tracking, the
 * old burst pattern) so the two builds can be compared without rebuilding.
 * It is an approximation of the old behaviour, not the old code — the bloom
 * term still exists, scaled by skill — so treat it as directional.
 */

import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4173/';
const ROUNDS = Number(args.rounds ?? 6);
const LEGACY = !!args.legacy;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));

console.log(`[lethality] booting ${URL}${LEGACY ? ' (legacy AI)' : ''} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

await page.evaluate(({ legacy }) => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const m = e.ctx.peek('match');
  window.__RESULTS__ = [];
  window.__SKILLS__ = [];

  if (legacy) {
    const orig = ai.spawn.bind(ai);
    ai.spawn = (...a) => {
      const g = orig(...a);
      g.skill = 0.62;
      g.spread = 0.032;
      g.settleTime = 0.0001;
      g.aimSettle = 1;
      g.trackRate = 6;
      g.aimWobble = 0.012;
      g.weaponRange = 60;
      g.fireRate = g.variantName === 'irregular' ? 8.2 : 10.5;
      return g;
    };
  }

  let liveAt = null;
  let firstHitAt = null;
  let parked = false;
  window.__TTK__ = [];
  e.events.on('match:round', () => { liveAt = null; firstHitAt = null; parked = false; });
  e.events.on('damage:taken', () => {
    if (firstHitAt === null && liveAt !== null) firstHitAt = e.time.elapsed;
  });
  e.events.on('player:death', () => {
    if (liveAt !== null) {
      window.__RESULTS__.push(+(e.time.elapsed - liveAt).toFixed(2));
      // The number that answers the complaint: once they are actually shooting
      // at you, how long do you have? Approach time is not difficulty.
      if (firstHitAt !== null) window.__TTK__.push(+(e.time.elapsed - firstHitAt).toFixed(2));
      liveAt = null;
      firstHitAt = null;
    }
  });

  // Park the player in the open the moment the round goes live, and hold them
  // there: no dodging, no cover, no shooting back. This is a lethality probe,
  // not a fight.
  const tick = () => {
    if (m.phase === 'live' && !parked && !m.player.dead) {
      parked = true;
      liveAt = e.time.elapsed;
      const site = m.sites[0].position;
      m.player.respawnAt(site, 0);
      m.player.movementLocked = true;
      for (const g of ai.agents) window.__SKILLS__.push(+g.skill.toFixed(2));
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  e.time.scale = 4;
}, { legacy: LEGACY });

const t0 = Date.now();
while (Date.now() - t0 < 420000) {
  const n = await page.evaluate(() => window.__RESULTS__.length);
  if (n >= ROUNDS) break;
  await page.waitForTimeout(2000);
}

const out = await page.evaluate(() => ({
  survival: window.__RESULTS__,
  ttk: window.__TTK__,
  skills: window.__SKILLS__,
}));
const ttk = out.ttk.slice().sort((a, b) => a - b);
const s = out.survival.slice().sort((a, b) => a - b);
const med = s.length ? s[s.length >> 1] : NaN;
const sk = out.skills.slice().sort((a, b) => a - b);

console.log(JSON.stringify({
  mode: LEGACY ? 'legacy' : 'current',
  survivalSeconds: out.survival,
  median: med,
  min: s[0],
  max: s[s.length - 1],
  /** First bullet that connects -> dead. This is the difficulty number. */
  timeToKillSeconds: out.ttk,
  ttkMedian: ttk.length ? ttk[ttk.length >> 1] : NaN,
  ttkMin: ttk[0],
  botSkills: { n: sk.length, min: sk[0], median: sk[sk.length >> 1], max: sk[sk.length - 1] },
  errors: errors.slice(0, 5),
}, null, 2));
await browser.close();
