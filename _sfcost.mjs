/**
 * WHAT DOES THE EVENT COST ON THE FRAME, AGAINST THE SATELLITE ALONE?
 *
 *   node _sfcost.mjs [--url=…] [--nosky] [--secs=30]
 *
 * `?capture=1` runs a fake fixed clock so `time.dt` is a constant and useless;
 * the cost is the wall clock between successive rAF callbacks (which is what
 * "465 ms on the frame" means for the tower's raze) plus a wrap of
 * `engine.step` for the synchronous half. `--nosky` fires the identical act
 * with the two later waves stubbed out, which is the A/B: everything else in
 * the frame — the satellite, the fight, the smoke — is the same.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4630/?map=plains&capture=1';
const NOSKY = !!args.nosky;
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await p.evaluate(() => { const e = window.__ENGINE__; e.input.frozen = true; e.ctx.peek('player')?.setControlEnabled?.(false); e.time.scale = 8; });
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await p.evaluate((NOSKY) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  m._checkWinConditions = () => {};
  e.time.scale = 1;
  const c = m.crash;
  const ph = e.ctx.peek('physics');
  /** Stand on open plain 68 m off the region so the whole event is on screen. */
  const V3 = e.camera.position.constructor;
  const h = ph.raycast(-40, 300, -40, 0, -1, 0, 400, ph.MASK.WORLD);
  e.camera.position.set(-40, (h.hit ? h.point.y : 0) + 1.7, -40);
  e.camera.lookAt(new V3(-100, 20, -8));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  if (NOSKY) c._sky = null;
  window.__F__ = [];
  let last = performance.now(); let t0 = null;
  const tick = () => {
    const now = performance.now();
    if (t0 === null && c._t >= 0) t0 = now;
    if (t0 !== null) window.__F__.push([+((now - t0) / 1000).toFixed(2), +(now - last).toFixed(1)]);
    last = now; requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const orig = e.step.bind(e);
  window.__ST__ = [];
  e.step = (t) => { const a = performance.now(); const r = orig(t); window.__ST__.push(+(performance.now() - a).toFixed(2)); return r; };
  c.fire();
}, NOSKY);
await p.evaluate(() => new Promise((r) => { let i = 0; const t = () => (++i >= 2200 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }));
const out = await p.evaluate(() => {
  const F = window.__F__.filter((f) => f[0] <= 30);
  const ms = F.map((f) => f[1]).sort((a, b) => a - b);
  const st = window.__ST__.slice().sort((a, b) => a - b);
  const q = (a, k) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * k))] : 0);
  const top = F.slice().sort((a, b) => b[1] - a[1]).slice(0, 6);
  return { n: F.length, median: q(ms, 0.5), p95: q(ms, 0.95), p99: q(ms, 0.99), max: q(ms, 1),
    stepMedian: q(st, 0.5), stepMax: q(st, 1), top,
    total: +(ms.reduce((a, x) => a + x, 0) / 1000).toFixed(1) };
});
console.log(`${NOSKY ? 'SATELLITE ALONE' : 'ALL THREE WAVES'} — ${out.n} frames over the 30 s after Crash.fire()`);
console.log(`  presented frame: median ${out.median} ms · p95 ${out.p95} · p99 ${out.p99} · max ${out.max}`);
console.log(`  engine.step:     median ${out.stepMedian} ms · max ${out.stepMax}`);
console.log(`  worst frames: ${out.top.map((f) => `${f[1]}ms@t=${f[0]}`).join('  ')}`);
console.log(`  30 s of event took ${out.total} s of wall clock`);
console.log(errs.length ? `PAGEERRORS(${errs.length}) ${errs[0]}` : '0 pageerrors');
await b.close();
