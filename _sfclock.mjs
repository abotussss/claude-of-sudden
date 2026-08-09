/**
 * WHEN DOES THIS ACTUALLY FIRE ON THE 1000-POINT CLOCK — at the threshold the
 * OTHER agent is moving Act III to (0.80), not the 0.54 in the tree today.
 *
 *   node _sfclock.mjs [--url=…] [--seed=N] [--p=0.80] [--scale=24]
 *
 * `match._acts[i].spec` is the act object by reference, so the threshold is set
 * here, in the page, and nothing in `src/match/nachtfeld.js` is touched. It then
 * plays a real round and stamps the whole event against the live round clock.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4630/?map=plains';
const P = Number(args.p ?? 0.80);
const SCALE = Number(args.scale ?? 24);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await page.evaluate(([P, SCALE]) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  e.time.scale = SCALE;
  window.__STAMP__ = [];
  const info = console.info.bind(console);
  console.info = (...a) => {
    const line = a.join(' ');
    if (/ACT |skyfall\]|crash\]|SITE D OPEN/.test(line)) {
      window.__STAMP__.push({
        t: +(1200 - m.roundClock).toFixed(1),
        p: +(Math.max(m.score[0], m.score[1]) / 1000).toFixed(3),
        score: `${m.score[0]}-${m.score[1]}`,
        line: line.slice(0, 150),
      });
    }
    info(...a);
  };
  const arm = () => {
    const acts = m._acts;
    if (!acts?.length) return false;
    for (const a of acts) if (a.spec.id === 'NF-CRASH') a.spec.progress = P;
    return true;
  };
  if (!arm()) { const iv = setInterval(() => { if (arm()) clearInterval(iv); }, 200); }
}, [P, SCALE]);
const wait = (n) => page.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
const deadline = Date.now() + 420000;
for (;;) {
  await wait(120);
  const st = await page.evaluate(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    const s = m.crash?._sky;
    return { done: !!s && (s._burn > 0), over: m.phase === 'matchover' || m.phase === 'over' };
  });
  if (st.done || st.over || Date.now() > deadline) break;
}
await wait(400);
const out = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const s = m.crash._sky;
  return { stamps: window.__STAMP__, phase: m.phase, denied: s._denied,
    zones: m.sites.map((z) => z.id).join('/'), clock: +m.roundClock.toFixed(0) };
});
console.log(`\n   t(s)     p    score      event`);
for (const st of out.stamps) console.log(`  ${String(st.t).padStart(6)} ${String(st.p).padStart(6)}  ${st.score.padStart(9)}  ${st.line}`);
console.log(`\n  phase=${out.phase} clock=${out.clock} zones=${out.zones} denied=${out.denied}`);
console.log(errs.length ? `PAGEERRORS(${errs.length}) ${errs[0]}` : '0 pageerrors');
await b.close();
