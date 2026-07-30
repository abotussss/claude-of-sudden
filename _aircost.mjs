/**
 * AIR COST — what each air event costs on the frame it fires, and what it costs
 * FOR EVER AFTER.
 *
 *   node _aircost.mjs [--url=…] [--hold=14]
 *
 * The fire frame is the number the air work has always reported. This adds the
 * second one, which a 170 s round turned up and no per-event measurement would
 * have: settled rubble goes back into the shadow cascades and the depth prepass,
 * and a round with three strikes, two sticks and two gun runs in it is carrying
 * every one of those for the rest of the round. So each event is fired alone,
 * against a measured baseline, and the frame time is sampled again once its dust
 * has settled.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4206/';
const HOLD = Number(args.hold ?? 14) * 1000;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 200));
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('[aircost] ready');

await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  e.time.scale = 1;
  if (m.phase !== 'live') m._setPhase('live', 0);
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  for (const a of m.air) a.enabled = false;
  const cost = [];
  let last = performance.now();
  const spy = () => {
    const now = performance.now();
    cost.push(now - last);
    last = now;
    requestAnimationFrame(spy);
  };
  requestAnimationFrame(spy);
  window.__COST__ = cost;
  window.__FIRE__ = [];
  // The frame an event lands on, against the twelve before it.
  const mark = (tag) => {
    const n = cost.length;
    if (!n) return; // the sampler just drained the ring
    const near = cost.slice(Math.max(0, n - 13), n - 1).sort((a, b) => a - b);
    window.__FIRE__.push({
      tag,
      ms: +cost[n - 1].toFixed(1),
      median: +(near[near.length >> 1] ?? 0).toFixed(1),
      max: +(near[near.length - 1] ?? 0).toFixed(1),
    });
  };
  window.__MARK__ = mark;
  e.events.on('match:airstrike', (p) => p.phase === 'impact' && mark('strike-impact:' + p.site));
  e.events.on('match:bomber', (p) => p.phase === 'impact' && mark('bomb-impact:' + p.run));
  e.events.on('match:strafe', (p) => p.phase === 'impact' && mark('cannon-impact:' + p.run));
});

const sample = () =>
  page.evaluate(() => {
    const c = window.__COST__.slice().sort((a, b) => a - b);
    window.__COST__.length = 0;
    return {
      n: c.length,
      median: +(c[c.length >> 1] ?? 0).toFixed(1),
      p95: +(c[Math.floor(c.length * 0.95)] ?? 0).toFixed(1),
    };
  });

const wait = (ms) => page.waitForTimeout(ms);

await wait(HOLD);
let base = await sample();
console.log(`baseline                    median ${base.median}ms p95 ${base.p95}ms  (${base.n} frames)`);

const steps = [
  ['single route strike (292 chunks, mound becomes collision + nav)', () => page.evaluate(() => window.__STRIKE__.fire('R3'))],
  ['bomber stick (200 debris chunks, no collision)', () => page.evaluate(() => window.__BOMBER__.fire('BLANE'))],
  ['strafing run (88-248 grit chunks, no collision)', () => page.evaluate(() => window.__STRAFE__.fire('BLANE'))],
  ['BLOCK SALVO (3 sites, 1507-2138 chunks, 3 mounds)', () => page.evaluate(() => window.__STRIKE__.callSalvo(0))],
];
for (const [label, run] of steps) {
  await run();
  await wait(HOLD);
  const s = await sample();
  console.log(
    `after ${label.padEnd(58)} median ${String(s.median).padStart(6)}ms ` +
      `p95 ${String(s.p95).padStart(6)}ms  (+${(s.median - base.median).toFixed(1)}ms vs baseline)`
  );
}

const fire = await page.evaluate(() => window.__FIRE__);
console.log('\nFIRE FRAMES (the frame the event lands on, vs its 12 neighbours):');
for (const f of fire) {
  console.log(`   ${f.tag.padEnd(26)} ${String(f.ms).padStart(6)}ms   neighbours median ${f.median}ms max ${f.max}ms`);
}
console.log('[aircost] errors:', errs.length ? errs.slice(0, 4) : 'none');
await browser.close();
