/**
 * MY OWN event timeline. Run the match at speed to its natural end and stamp
 * every big event against the live clock — the player's question was literally
 * "いつ起きるの？", so the answer has to be measured, not read off the rules.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT THIS PRINTS NOW, AND WHY EACH COLUMN HAD TO BE ADDED
 * ──────────────────────────────────────────────────────────────────────────
 * The ask this run was re-tuned against is "後半3〜5分に寄せる" — a window
 * defined by the END of the match, not by its start. A percentage cannot answer
 * it: 62 % of a 240 s match is 91 s from the end and 62 % of a 560 s match is
 * 213 s, and only one of those is inside the window. So every event is stamped
 * three ways:
 *
 *   t(s)      seconds since the match went live
 *   %         t / (match length) — the figure the old probe printed alone
 *   T-(s)     SECONDS BEFORE THE END — the column the brief is actually about
 *
 * `T-` can only be filled in once the match has ended, so it is back-filled
 * after the loop rather than sampled. That is the whole reason a run must go to
 * a NATURAL end and never be cut off at a fixed wall-clock budget.
 *
 * THE (t, p) CURVE IS SAMPLED TOO. `MatchSystem._matchProgress()` is
 * `max(elapsed/matchTime, leader/scoreTarget)` and WHICH of the two terms is on
 * top decides how a threshold behaves: while the CLOCK term binds, progress is
 * linear in time and a threshold IS a time; while the SCORE term binds it is
 * convex and a threshold lands much later in elapsed time than it reads. The
 * `bind` column says which one was larger at every sample, so a re-tune never
 * has to guess.
 *
 * THE COST OF THE ROSTER IS MEASURED IN THE SAME RUN, because a schedule change
 * and a roster change landing together must not hide each other: frame time
 * (mean and p95 of the REAL inter-frame delta, which `time.scale` does not
 * touch), the A* ration against `pathMsBudget` with the deferred count, the
 * live actor count, and the spatial audio field's emitter pressure.
 *
 *   node _events.mjs [url] [seed]
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4277/';
const SEED = process.argv[3] ?? null;
/**
 * TIME SCALE, AND IT IS NOT A FREE PARAMETER. At 12x a headless frame is ~34 ms,
 * so `dt` is 0.4 s and every bot moves in one metre and a half steps: the fight
 * is coarse, capture flips are slow, and the SCORE RATE — which is what every
 * threshold in `rules.js` is really measured against, since `_matchProgress` is
 * score-dominated — comes out lower than a real match's. A schedule tuned at
 * one scale and read at another will disagree about seconds, which is exactly
 * the disagreement this argument exists to test. Default unchanged.
 */
const SCALE = Number(process.argv[4] ?? 12);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
const q = `?capture=1${SEED != null ? `&seed=${SEED}` : ''}`;
await page.goto(`${URL}${q}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const res = await page.evaluate(async (SCALE) => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), w = e.ctx.peek('world');
  const ai = e.ctx.peek('ai'), au = e.ctx.peek('audio');
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.time.scale = SCALE; // NOT `e.timeScale`/`e.speed` — neither exists, so the old
  // line was a no-op and every "12x" run in this file was real time.

  // Wait for the warm-up to hand over; my first run broke out of the loop on
  // frame one because "not live" was already true before the match had begun.
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  const RULES_matchTime = m.roundClock;
  const wasLive = true;
  const seen = {}, log = [];
  const t = () => +(RULES_matchTime - m.roundClock).toFixed(1);
  const mark = (k) => { if (!seen[k]) { seen[k] = true; log.push([k, t(), m.score ? m.score.slice() : null]); } };

  /* ---- perf accumulators ---- */
  const frames = [];   // real ms between frames; time.scale does not touch these
  const curve = [];    // [t, byClock, byScore, emitters]
  const deferred0 = ai?.stats?.pathsDeferred ?? 0;
  const dropped0 = au?.field?.stats?.dropped ?? 0;
  let budgetSum = 0, budgetN = 0, costSum = 0;
  let emitPeak = 0, emitSum = 0, emitN = 0;
  let aliveSum = 0, aliveN = 0, agentsMax = 0;
  let nextCurve = 0, lastRaw = performance.now();
  // The score target is not exported to the probe, so it is inferred from the
  // score at which the match actually ends — see `byScore` back-fill below.

  const start = performance.now();
  while (performance.now() - start < 900000) {
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    frames.push(now - lastRaw); lastRaw = now;

    if (ai?.stats) {
      budgetSum += ai.stats.pathBudget ?? 0; budgetN++;
      costSum += ai.stats.pathCostMs ?? 0;
      aliveSum += ai.stats.alive ?? 0; aliveN++;
      if ((ai.stats.agents ?? 0) > agentsMax) agentsMax = ai.stats.agents;
    }
    const act = au?.field?.stats?.active ?? 0;
    if (act > emitPeak) emitPeak = act;
    emitSum += act; emitN++;

    const tt = t();
    if (tt >= nextCurve) {
      curve.push([tt, +(1 - Math.max(0, m.roundClock) / RULES_matchTime).toFixed(3),
        Math.max(m.score[0], m.score[1]), act]);
      nextCurve = tt + 20;
    }

    if (wasLive && m.phase !== 'live') { log.push(['MATCH END (' + m.phase + ')', tt, m.score ? m.score.slice() : null]); break; }
    const cath = w?.cathedral;
    if (cath?.razed) mark('CATHEDRAL RAZED');
    if (m._cathedralCalled || m.cathedralCalled) mark('cathedral salvo called');
    if (m._districtsFired >= 1) mark('district salvo 1');
    if (m._districtsFired >= 2) mark('district salvo 2');
    for (const d of w.demolitions ?? []) if (d.down) mark('block down: ' + d.id);
    if (m.sites?.some?.((s) => s.id === 'D')) mark('SITE D live');
    if (m._finalCalled) mark('FINAL COLLAPSE');
    /**
     * `m.tank` IS THE `Armour` INSTANCE AND IT IS TRUTHY FROM BOOT, so the old
     * test stamped "tank" at t=0 in every run and said nothing at all about a
     * sortie. What a sortie is, is a hull whose `state` has left 'parked'.
     */
    for (const tk of m.tank?.tanks ?? []) {
      if (tk.state !== 'parked') mark('TANK ' + tk.id + ' rolling');
      if (tk.state === 'dead') mark('TANK ' + tk.id + ' destroyed');
    }
    if (m.roundClock <= 0) { log.push(['CLOCK EXPIRED', tt, m.score]); break; }
  }
  frames.sort((a, c) => a - c);
  const pct = (f) => (frames.length ? +frames[Math.min(frames.length - 1, Math.floor(frames.length * f))].toFixed(2) : 0);
  return {
    log, finalScore: m.score, phase: m.phase, clockLeft: +m.roundClock.toFixed(1), matchTime: RULES_matchTime,
    seed: e.levelSeed,
    roster: { agentsMax, aliveMean: aliveN ? +(aliveSum / aliveN).toFixed(1) : 0 },
    perf: {
      frames: frames.length,
      meanMs: frames.length ? +(frames.reduce((a, c) => a + c, 0) / frames.length).toFixed(2) : 0,
      p50Ms: pct(0.5), p95Ms: pct(0.95), p99Ms: pct(0.99),
    },
    path: {
      budgetMean: budgetN ? +(budgetSum / budgetN).toFixed(2) : 0,
      costMsMean: budgetN ? +(costSum / budgetN).toFixed(3) : 0,
      pathsPerFrame: ai?.pathsPerFrame ?? null,
      pathMsBudget: ai?.pathMsBudget ?? null,
      deferred: (ai?.stats?.pathsDeferred ?? 0) - deferred0,
      deferredPerFrame: budgetN ? +(((ai?.stats?.pathsDeferred ?? 0) - deferred0) / budgetN).toFixed(2) : 0,
    },
    audio: {
      pool: au?.field?.emitters?.length ?? null,
      peakActive: emitPeak,
      meanActive: emitN ? +(emitSum / emitN).toFixed(1) : 0,
      dropped: (au?.field?.stats?.dropped ?? 0) - dropped0,
      stolen: au?.field?.stats?.stolen ?? 0,
    },
    curve,
  };
}, SCALE);

const END = res.log.length ? res.log[res.log.length - 1][1] : 0;
const TARGET = Math.max(res.finalScore?.[0] ?? 0, res.finalScore?.[1] ?? 0);
console.log(`\n  seed ${res.seed} · match clock ${res.matchTime}s, ended in phase "${res.phase}" with ${res.clockLeft}s left, score ${JSON.stringify(res.finalScore)}`);
console.log(`  MATCH LENGTH ${END}s`);
console.log('  event                          t(s)      %     T-(s)   score');
for (const [k, tt, s] of res.log) {
  const pctOf = END > 0 ? ((tt / END) * 100).toFixed(0) : '--';
  console.log(`  ${String(k).padEnd(28)} ${String(tt).padStart(6)} ${String(pctOf).padStart(5)}% ${(END - tt).toFixed(1).padStart(8)}   ${JSON.stringify(s)}`);
}
console.log(`\n  PERF   frames ${res.perf.frames} · mean ${res.perf.meanMs}ms · p50 ${res.perf.p50Ms} · p95 ${res.perf.p95Ms} · p99 ${res.perf.p99Ms}`);
console.log(`  ROSTER agentsMax ${res.roster.agentsMax} · alive mean ${res.roster.aliveMean}`);
console.log(`  A*     ration mean ${res.path.budgetMean}/frame (cap ${res.path.pathsPerFrame}, budget ${res.path.pathMsBudget}ms, solve ${res.path.costMsMean}ms) · deferred ${res.path.deferred} (${res.path.deferredPerFrame}/frame)`);
console.log(`  AUDIO  pool ${res.audio.pool} · peak ${res.audio.peakActive} · mean ${res.audio.meanActive} · dropped ${res.audio.dropped} · stolen ${res.audio.stolen}`);
console.log(`\n  (t, p) curve — which term of max(byClock, byScore) binds (target inferred ${TARGET})`);
console.log('    t(s)   byClock  lead  byScore  bind    emitters');
for (const [tt, bc, lead, em] of res.curve) {
  const bs = TARGET > 0 ? +(lead / TARGET).toFixed(3) : 0;
  console.log(`    ${String(tt).padStart(5)}   ${String(bc).padStart(7)}  ${String(lead).padStart(4)}  ${String(bs).padStart(7)}  ${(bs > bc ? 'SCORE' : 'clock').padEnd(6)}  ${em}`);
}
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
