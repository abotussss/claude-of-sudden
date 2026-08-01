/**
 * E-SITE TIMELINE — what adding a fifth capture point does to the SHAPE of a
 * match, measured before and after rather than argued.
 *
 * A DOMINATION match ends on `RULES.scoreTarget`, not on the clock, and every
 * zone held pays every `scoreInterval`. So a fifth zone is not a fifth of the
 * map, it is a change to the SCORE CURVE — and the two big map events are
 * scheduled on `_matchProgress()` = max(elapsed/matchTime, leader/scoreTarget),
 * which means every one of them moves when the curve does.
 *
 * This runs the match at speed to its NATURAL end and stamps each event in
 * seconds AND as a percentage of the match that actually happened, which is the
 * only figure the two builds can be compared on.
 *
 *   node _esite.mjs [url] [runs]
 *
 * It measures. It fixes nothing: `rules.js` and the schedule belong to another
 * agent, and the numbers are for it.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4271/';
const RUNS = Number(process.argv[3] ?? 3);
const QS = process.argv[4] ?? ''; // e.g. '?capture=1'

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const all = [];
for (let run = 0; run < RUNS; run++) {
  const page = await b.newPage({ viewport: { width: 900, height: 600 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(`${URL}${QS}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

  const res = await page.evaluate(async () => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const w = e.ctx.peek('world');
    e.input.frozen = true;
    e.input.enabled = false;
    e.ctx.peek('player')?.setControlEnabled?.(false);
    if ('timeScale' in e) e.timeScale = 12;
    else e.speed = 12;
    while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
    const matchTime = m.roundClock;
    const zones = (m.sites ?? []).map((z) => z.id);
    const allZones = (m.allZones ?? m.sites ?? []).map((z) => z.id);
    const seen = {};
    const log = [];
    const t = () => +(matchTime - m.roundClock).toFixed(1);
    const mark = (k) => {
      if (!seen[k]) {
        seen[k] = true;
        log.push([k, t(), m.score ? m.score.slice() : null]);
      }
    };
    const start = performance.now();
    let end = 'RUNNING';
    while (performance.now() - start < 560000) {
      await new Promise((r) => requestAnimationFrame(r));
      if (m.phase !== 'live') { end = 'phase:' + m.phase; break; }
      if (w?.cathedral?.razed) mark('CATHEDRAL RAZED');
      for (const d of w?.demolitions ?? []) if (d.down) mark('block down: ' + d.id);
      if (m.sites?.some?.((s) => s.id === 'D')) mark('SITE D live');
      if (m.roundClock <= 0) { end = 'CLOCK EXPIRED'; break; }
    }
    return {
      log, end, matchTime, zones, allZones,
      elapsed: +(matchTime - Math.max(0, m.roundClock)).toFixed(1),
      score: m.score ? m.score.slice() : null,
    };
  });
  res.errs = errs;
  all.push(res);
  console.log(
    `\n  run ${run + 1}  live zones [${res.zones}] of [${res.allZones}]  ` +
      `ended ${res.end} at ${res.elapsed}s  score ${JSON.stringify(res.score)}` +
      (errs.length ? `  PAGEERROR ${errs[0]}` : '')
  );
  console.log('    event                             t(s)     % of match   score');
  for (const [k, tt, s] of res.log) {
    const pct = res.elapsed > 0 ? ((100 * tt) / res.elapsed).toFixed(1) : '—';
    console.log(
      `    ${String(k).padEnd(30)} ${String(tt).padStart(6)}   ${String(pct).padStart(8)} %   ${JSON.stringify(s)}`
    );
  }
  await page.close();
}

/* ---- the summary, which is the row the two builds are compared on ---- */
const lens = all.map((r) => r.elapsed);
console.log(`\n  MATCH LENGTH  ${lens.join(' / ')} s   mean ${(lens.reduce((a, c) => a + c, 0) / lens.length).toFixed(1)} s`);
const keys = [...new Set(all.flatMap((r) => r.log.map((l) => l[0])))];
console.log('  event                            t(s) per run              % per run');
for (const k of keys) {
  const ts = all.map((r) => r.log.find((l) => l[0] === k)?.[1] ?? null);
  const ps = ts.map((tt, i) => (tt == null ? '—' : ((100 * tt) / all[i].elapsed).toFixed(0) + '%'));
  console.log(`  ${k.padEnd(30)} ${ts.map((x) => String(x ?? '—').padStart(6)).join(' ')}   ${ps.map((x) => String(x).padStart(5)).join(' ')}`);
}
console.log(all.some((r) => r.errs.length) ? '  [pageerror] SOME' : '  [pageerror] none');
await b.close();
