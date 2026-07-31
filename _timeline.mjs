/**
 * EVENT TIMELINE — when does each big event ACTUALLY fire, against match time?
 *
 *   node _timeline.mjs [--url=…] [--runs=1]
 *
 * The player's complaint is "いつ起きるの？" — he has never seen the cathedral come
 * down or the city level itself. That is either bad timing or an event that never
 * fires at all, and those are different bugs. So this measures rather than reads
 * the schedule out of rules.js: it lets the match start on its own (WARMUP ->
 * FREEZE -> LIVE, which is what spawns the thirty men), runs it at a time scale to
 * its NATURAL end, and stamps every air/armour/map event with `t`, the seconds
 * elapsed in the LIVE match — the same clock `_updateMapEvents` schedules on.
 *
 * The one thing it must not do is extend the match, because whether the clock
 * gets that far is exactly the question. `scoreTarget` ending a match at t=280
 * means `finalCollapseAt: 470` is dead code, and no amount of reading rules.js
 * says so.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4253/';
const RUNS = +(args.runs ?? 1);
const SCALE = +(args.scale ?? 12);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const all = [];
for (let run = 0; run < RUNS; run++) {
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + String(e.message)));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

  // Let the match reach LIVE on its own. Forcing the phase skips `_beginRound`
  // and leaves an empty map.
  await page.evaluate((s) => (window.__ENGINE__.time.scale = s), SCALE);
  await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 180000 });

  await page.evaluate(() => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const RULESmatchTime = m.roundClock; // == RULES.matchTime at the top of LIVE
    const T = { matchTime: RULESmatchTime, rows: [], end: null, scoreAt: [] };
    window.__TL__ = T;
    const t = () => +(RULESmatchTime - m.roundClock).toFixed(1);
    const add = (kind, detail) => T.rows.push({ t: t(), kind, detail });

    const ev = e.ctx.events;
    // One row per EVENT, not per impact: an airstrike salvo emits three
    // `inbound`s and a bomber stick emits one `impact` per bomb.
    ev.on('match:airstrike', (p) => { if (p.phase === 'inbound') add('airstrike', p.site ?? ''); });
    ev.on('match:bomber', (p) => { if (p.phase === 'inbound') add('bomber', String(p.run ?? '')); });
    ev.on('match:strafe', (p) => { if (p.phase === 'inbound') add('strafe', String(p.run ?? '')); });
    ev.on('match:capture', (p) => add('capture', `${p.zone} -> ${p.owner < 0 ? 'neutral' : ['RED', 'BLUE'][p.owner]}`));
    ev.on('match:result', (p) => { T.end = { t: t(), winner: p.winner, reason: p.reason, score: [p.score[0], p.score[1]] }; });

    // The scheduled map events have no event of their own; latch their flags.
    const seen = {};
    const latch = (key, test, kind, detail) => {
      if (seen[key]) return;
      if (!test()) return;
      seen[key] = true;
      add(kind, typeof detail === 'function' ? detail() : detail);
    };
    let sorties = 0;
    const step = e.step.bind(e);
    e.step = (now) => {
      step(now);
      if (m.phase !== 'live') return;
      latch('cathCall', () => m._cathedralCalled, 'CATHEDRAL CALLED', 'salvo + bomber run');
      latch('dOpen', () => m.sites.some((z) => z.id === 'D'), 'SITE D OPEN', 'the ruin is contestable');
      latch('final', () => m._finalCalled, 'FINAL COLLAPSE', () => `${m._finalLeft} sites still standing`);
      if (m.tank && m.tank._sorties > sorties) { sorties = m.tank._sorties; add('tank sortie', `#${sorties}`); }
      if (T.rows.length && T.scoreAt.length < 400) {
        const last = T.scoreAt[T.scoreAt.length - 1];
        const tt = RULESmatchTime - m.roundClock;
        if (!last || tt - last.t >= 30) T.scoreAt.push({ t: +tt.toFixed(0), s: [m.score[0], m.score[1]] });
      }
    };
  });

  // Run to the natural end of the match, whatever that is.
  await page.waitForFunction(
    () => window.__TL__.end !== null || window.__ENGINE__.ctx.peek('match').phase !== 'live',
    null,
    { timeout: 240000 }
  );
  const r = await page.evaluate(() => {
    const T = window.__TL__;
    const m = window.__ENGINE__.ctx.peek('match');
    return {
      matchTime: T.matchTime,
      rows: T.rows,
      end: T.end ?? { t: +(T.matchTime - m.roundClock).toFixed(1), winner: -2, reason: 'phase left live', score: [m.score[0], m.score[1]] },
      scoreAt: T.scoreAt,
      dLive: m.sites.some((z) => z.id === 'D'),
      liveZones: m.sites.map((z) => z.id).join('/'),
    };
  });
  r.pageErrors = pageErrors;
  all.push(r);
  await page.close();
}
await browser.close();

/* ---- report -------------------------------------------------------------- */
const KINDS = ['CATHEDRAL CALLED', 'SITE D OPEN', 'FINAL COLLAPSE', 'tank sortie', 'airstrike', 'bomber', 'strafe'];
for (let i = 0; i < all.length; i++) {
  const r = all[i];
  console.log(`\n═══ RUN ${i + 1} — match clock ${r.matchTime}s ═══`);
  console.log(`  ended at t=${r.end.t}s  winner=${r.end.winner}  reason=${r.end.reason}  score=${r.end.score.join('-')}`);
  console.log(`  live zones at the end: ${r.liveZones}   D ever opened: ${r.dLive ? 'YES' : 'NO'}`);
  console.log('\n  t (s)   event              detail');
  for (const x of r.rows) {
    if (x.kind === 'capture') continue;
    console.log(`  ${String(x.t).padStart(6)}   ${x.kind.padEnd(18)} ${x.detail}`);
  }
  console.log('\n  score progression (t: red-blue)');
  console.log('   ' + r.scoreAt.map((s) => `${s.t}:${s.s[0]}-${s.s[1]}`).join('  '));
  if (r.pageErrors.length) console.log('  pageErrors', r.pageErrors.slice(0, 4));
}

console.log('\n═══ SUMMARY over ' + all.length + ' run(s) ═══');
const ends = all.map((r) => r.end.t);
console.log(`  match length: ${Math.min(...ends).toFixed(0)} .. ${Math.max(...ends).toFixed(0)} s (clock allows ${all[0].matchTime})`);
for (const k of KINDS) {
  const times = all.map((r) => r.rows.filter((x) => x.kind === k).map((x) => x.t));
  const fired = times.filter((t) => t.length).length;
  const flat = times.flat();
  const label = k.padEnd(18);
  if (!flat.length) { console.log(`  ${label} NEVER FIRED in any run`); continue; }
  console.log(
    `  ${label} fired in ${fired}/${all.length} runs, ${(flat.length / all.length).toFixed(1)} times/match, ` +
      `t = ${Math.min(...flat).toFixed(0)} .. ${Math.max(...flat).toFixed(0)} s`
  );
}
