/**
 * THE CLOCK THE MOUNTAIN BATTERY HAS TO FIT IN.
 *
 *   node _battclock.mjs --url='http://127.0.0.1:4634/?map=plains' [--seeds=7,11,13]
 *                       [--scale=10] [--wall=240]
 *
 * The battery is armed by the SAME crossing the hidden squad is (@see
 * `MatchSystem._updateHiddenSquad`), so the only two numbers that decide whether
 * thirty rounds can be delivered are WHEN that crossing happens on the 1000
 * point clock and HOW MUCH MATCH IS LEFT AFTER IT. Both are measured here rather
 * than reasoned about, over more than one seed, because `_timeline.mjs` already
 * caught this project pacing events against `matchTime` on a map where every
 * match ended on points.
 *
 * It reports, per seed: the match second the squad armed, the score at that
 * instant, the match second the battery stood down, the match second the match
 * ended and by which ending, and the battery's own report line.
 */
import { chromium } from 'playwright';

const arg = (k, d) => {
  const a = process.argv.find((s) => s.startsWith(`--${k}=`));
  return a ? a.slice(a.indexOf('=') + 1) : d;
};
const URL = arg('url', 'http://127.0.0.1:4634/?map=plains');
const SEEDS = arg('seeds', '7,11,13').split(',');
const SCALE = +arg('scale', 10);
const WALL = +arg('wall', 240);
/**
 * `--off` DISABLES THE BATTERY AFTER BOOT AND BEFORE THE TRIGGER, so the same
 * seed can be run with and without it. That A/B is the only honest way to ask
 * "does it balance the hidden squad" — the score at the crossing and the score
 * at the whistle, on one seed, with one thing moved.
 */
const OFF = process.argv.includes('--off');

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
for (const seed of SEEDS) {
  const p = await b.newPage({ viewport: { width: 900, height: 600 } });
  const errs = [];
  const lines = [];
  p.on('pageerror', (e) => errs.push(String(e.message)));
  p.on('console', (m) => {
    const t = m.text();
    if (/\[batt|\[hidden|\[match\].*(past|hidden)/.test(t)) lines.push(t);
  });
  const url = `${URL}${URL.includes('?') ? '&' : '?'}seed=${seed}`;
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
  if (OFF) await p.evaluate(() => {
    const b = window.__ENGINE__.ctx.peek('match').battery;
    if (b) b.enabled = false;
  });
  await p.evaluate((s) => { window.__ENGINE__.ctx.time.scale = s; }, SCALE);
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < WALL * 1000) {
    await p.waitForTimeout(1500);
    last = await p.evaluate(() => {
      const e = window.__ENGINE__;
      const m = e.ctx.peek('match');
      if (!m) return null;
      return {
        id: e.ctx.peek('world')?.level?.id,
        phase: m.phase,
        score: [m.score[0], m.score[1]],
        /** `roundClock` counts DOWN from `RULES.matchTime`. */
        clock: +(m.roundClock ?? 0).toFixed(1),
        armed: !!m._hiddenArmed,
        stood: !!m._hiddenStoodDown,
        batt: m.battery ? {
          ready: m.battery.ready,
          armed: m.battery.armed,
          rounds: m.battery.stats.rounds,
          atSite: m.battery.stats.atSite,
          atBodies: m.battery.stats.atBodies,
          liveWorst: +m.battery.stats.liveWorst.toFixed(3),
          liveOut: m.battery.stats.liveOut,
          armedAt: m.battery.stats.armedAt,
          homeAt: m.battery.stats.homeAt,
        } : null,
      };
    });
    if (last && (last.phase === 'over' || last.phase === 'matchover')) break;
  }
  console.log(`##### seed ${seed} #####`);
  console.log(JSON.stringify(last));
  for (const l of lines) console.log('  ' + l);
  console.log(`  [pageerror] ${errs.length ? errs[0] : 'none'}`);
  await p.close();
}
await b.close();
