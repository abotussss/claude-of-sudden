/**
 * WHAT THE MOUNTAIN BATTERY COSTS A FRAME.
 *
 * NOT a frame-time A/B. This box builds and drives headless Chromium for
 * several agents at once and `rules.js`'s own `_forty.mjs` note is explicit
 * about what that does to a frame column: "single blocks of the SAME build came
 * back 68.3 and 53.1 ms". A 2 ms feature cannot be measured against that.
 *
 * So the feature's OWN work is timed instead, by wrapping `battery.update` from
 * the driver: every timer, every target choice, every matrix compose and both
 * `instanceMatrix` uploads, in milliseconds, over a real engagement. That number
 * is immune to what the rest of the box is doing.
 */
import { chromium } from 'playwright';
const URL = process.argv[2];
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', e => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await p.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 180000 });
await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const bt = m.battery;
  const orig = bt.update.bind(bt);
  window.__BC__ = { idle: [], live: [] };
  bt.update = (...a) => {
    const t = performance.now();
    orig(...a);
    const d = performance.now() - t;
    (bt.armed ? window.__BC__.live : window.__BC__.idle).push(d);
  };
});
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 2; });
await p.waitForTimeout(6000);
await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m.battery.arm(m.playerTeam, m._batteryPads());
});
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 4; });
await p.waitForTimeout(90000);
const out = await p.evaluate(() => {
  const s = (a) => {
    if (!a.length) return null;
    const c = a.slice().sort((x, y) => x - y);
    return {
      n: c.length,
      mean: +(c.reduce((x, y) => x + y, 0) / c.length).toFixed(4),
      p50: +c[c.length >> 1].toFixed(4),
      p95: +c[Math.floor(c.length * 0.95)].toFixed(4),
      max: +c[c.length - 1].toFixed(4),
    };
  };
  const bt = window.__ENGINE__.ctx.peek('match').battery;
  return { idle: s(window.__BC__.idle), live: s(window.__BC__.live), rounds: bt.stats.rounds };
});
console.log(JSON.stringify(out, null, 1));
console.log('[pageerror]', errs.length ? errs[0] : 'none');
await b.close();
