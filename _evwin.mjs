/**
 * EVENT WINDOW PROBE — `_events.mjs` with the two things the shape question
 * needs: every event stamped as a PERCENTAGE of the match that actually
 * happened (the length varies by ~90 s, so seconds alone do not compare across
 * runs), and how much match was LEFT when each district opened — which is the
 * number that decides whether a new approach is a route or a decoration.
 *
 * It also samples `_matchProgress()` against the live clock every five seconds,
 * because the thresholds in `RULES` are fractions of PROGRESS and the question
 * asked of them is always "at what SECOND does that land" — and the score curve
 * is convex, so the answer cannot be read off the fraction.
 *
 *   node _evwin.mjs [url] [--free]
 *
 * `--free` drops `?capture=1`, which is what makes the run VARY: capture mode
 * seeds the engine rng at 0x5eed1234 and every run of it is the same match to
 * the tenth of a second. Three identical runs are one run.
 */
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const FREE = args.includes('--free');
const URL = args.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:4261/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
const notes = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => {
  const t = m.text();
  if (/\[match\] (cathedral|FINAL|district)|\[airstrike\] (salvo|FINAL|district)/.test(t)) notes.push(t.slice(0, 200));
});
await page.goto(FREE ? URL : `${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const res = await page.evaluate(async () => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), w = e.ctx.peek('world');
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  if ('timeScale' in e) e.timeScale = 12; else e.speed = 12;
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  const matchTime = m.roundClock;
  const seen = {}, log = [], curve = [];
  const t = () => +(matchTime - m.roundClock).toFixed(1);
  let nextSample = 0;
  const mark = (k) => { if (!seen[k]) { seen[k] = true; log.push([k, t(), m.score ? m.score.slice() : null]); } };
  const start = performance.now();
  // Wall-clock budget, not match time. Three of these in parallel share one GPU
  // and a `timeScale = 12` match that runs 6 minutes solo can take 15; 560 s cut
  // a run off at t = 171 and the percentages it printed were of a match that had
  // not ended. If this is ever hit, the run is not evidence — the header says
  // phase "live" and there is no MATCH END row.
  while (performance.now() - start < 1500000) {
    await new Promise((r) => requestAnimationFrame(r));
    if (m.phase !== 'live') { log.push(['MATCH END (' + m.phase + ')', t(), m.score ? m.score.slice() : null]); break; }
    if (t() >= nextSample) { curve.push([t(), +m._matchProgress().toFixed(3), m.score.slice()]); nextSample = t() + 5; }
    const cath = w?.cathedral;
    if (cath?.razed) mark('CATHEDRAL RAZED');
    if (m._cathedralCalled || m.cathedralCalled) mark('cathedral salvo called');
    for (const d of w.demolitions ?? []) if (d.down) mark('block down: ' + d.id + ' [' + (d.zone ?? '?') + ']');
    if (m.sites?.some?.((s) => s.id === 'D')) mark('SITE D live');
    if (m.tank || m.tanks?.length) mark('tank');
    if (m.roundClock <= 0) { log.push(['CLOCK EXPIRED', t(), m.score]); break; }
  }
  return { log, curve, phase: m.phase, clockLeft: +m.roundClock.toFixed(1), matchTime };
});

const end = res.log.length ? res.log[res.log.length - 1][1] : 0;
console.log(`  match clock ${res.matchTime}s, ended phase "${res.phase}" with ${res.clockLeft}s left — LENGTH ${end}s`);
console.log('  event                             t(s)     %len   left(s)  score');
for (const [k, tt, s] of res.log) {
  const pct = end > 0 ? ((tt / end) * 100).toFixed(0) : '--';
  console.log(`  ${String(k).padEnd(32)} ${String(tt).padStart(6)} ${String(pct).padStart(6)}% ${String(+(end - tt).toFixed(1)).padStart(8)}  ${JSON.stringify(s)}`);
}
for (const n of notes) console.log('  | ' + n);
console.log('  progress curve (t=p):  ' + res.curve.map(([tt, p]) => `${tt}=${p}`).join('  '));
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
