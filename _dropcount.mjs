/**
 * DOES THE COMEBACK ACTUALLY HAPPEN? Run a match to its NATURAL end and report
 * when the reinforcement drop fired, for which side, at what score, and what the
 * result was.
 *
 * WRITTEN AGAINST THE COMEBACK TRIGGER, WHICH NO LONGER EXISTS. The drop is now
 * armed by the cathedral collapse and always goes to the player's enemy — @see
 * `_cathdrop.mjs`, which times that — so the question this file was built to
 * answer ("does the comeback fire often enough, and does it rubber-band?") has
 * no subject. What still holds up is the second half: THE COST OF TWENTY EXTRA
 * ACTORS, measured below in the same run.
 *
 * THE COST OF TWENTY EXTRA ACTORS IS MEASURED IN THE SAME RUN, because a
 * feature that adds half a roster and a perf regression must not be able to hide
 * one inside the other: frame time (mean and p95 of the REAL inter-frame delta,
 * which `time.scale` does not touch), the A* ration and the deferred count, and
 * the peak live actor count. Sampled continuously, and again as a WINDOW around
 * the drop so "with reinforcements live" is a real column rather than a match
 * average that the other eight minutes dilute.
 *
 *   node _dropcount.mjs [url] [seed]
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4294/';
const SEED = process.argv[3] ?? '11';
const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const res = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.time.scale = 12;
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  const matchTime = m.roundClock;
  const t = () => +(matchTime - m.roundClock).toFixed(1);

  const frames = [];
  const deferred0 = ai?.stats?.pathsDeferred ?? 0;
  let budgetSum = 0, budgetN = 0, agentsMax = 0, lastRaw = performance.now();
  /** The same four, but only while a drop's men are on the map. */
  const w = { frames: [], deferred0: 0, budgetSum: 0, budgetN: 0, agentsMax: 0, on: false };
  let firstDrop = -1;

  const start = performance.now();
  while (performance.now() - start < 900000) {
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    const d = now - lastRaw;
    lastRaw = now;
    frames.push(d);
    if (ai?.stats) {
      budgetSum += ai.stats.pathBudget ?? 0;
      budgetN++;
      if ((ai.stats.agents ?? 0) > agentsMax) agentsMax = ai.stats.agents;
    }
    /**
     * THE WINDOW OPENS ON THE FIRST CALL AND NEVER CLOSES, because the men do
     * not respawn: "reinforcements live" is the rest of the match, thinning as
     * they are killed. That is the honest window — a fixed sixty seconds would
     * measure the drop and not its consequence.
     */
    if (m.reinforceStats.calls > 0) {
      if (!w.on) {
        w.on = true;
        w.deferred0 = ai?.stats?.pathsDeferred ?? 0;
        firstDrop = t();
      }
      w.frames.push(d);
      if (ai?.stats) {
        w.budgetSum += ai.stats.pathBudget ?? 0;
        w.budgetN++;
        if ((ai.stats.agents ?? 0) > w.agentsMax) w.agentsMax = ai.stats.agents;
      }
    }
    if (m.phase !== 'live' || m.roundClock <= 0) break;
  }
  const pct = (arr, f) => {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, c) => a - c);
    return +s[Math.min(s.length - 1, Math.floor(s.length * f))].toFixed(2);
  };
  const mean = (arr) =>
    arr.length ? +(arr.reduce((a, c) => a + c, 0) / arr.length).toFixed(2) : 0;
  const rein = m.roster.filter((r) => r.reinforcement);
  return {
    seed: e.levelSeed,
    end: t(),
    phase: m.phase,
    score: m.score.slice(),
    winner: m.score[0] === m.score[1] ? -1 : m.score[0] > m.score[1] ? 0 : 1,
    stats: JSON.parse(JSON.stringify(m.reinforceStats)),
    firstDrop,
    reinforcements: rein.length,
    reinAlive: rein.filter((r) => r.alive).length,
    reinKills: rein.reduce((a, r) => a + r.kills, 0),
    allNoRespawn: rein.every((r) => r.noRespawn === true),
    rosterSize: [m._rosterSize(0), m._rosterSize(1)],
    perf: {
      all: { n: frames.length, mean: mean(frames), p95: pct(frames, 0.95), agentsMax },
      withDrop: {
        n: w.frames.length,
        mean: mean(w.frames),
        p95: pct(w.frames, 0.95),
        agentsMax: w.agentsMax,
        deferred: (ai?.stats?.pathsDeferred ?? 0) - w.deferred0,
        deferredPerFrame: w.budgetN
          ? +(((ai?.stats?.pathsDeferred ?? 0) - w.deferred0) / w.budgetN).toFixed(2)
          : 0,
        rationMean: w.budgetN ? +(w.budgetSum / w.budgetN).toFixed(2) : 0,
      },
    },
    path: {
      deferred: (ai?.stats?.pathsDeferred ?? 0) - deferred0,
      deferredPerFrame: budgetN
        ? +(((ai?.stats?.pathsDeferred ?? 0) - deferred0) / budgetN).toFixed(2)
        : 0,
      rationMean: budgetN ? +(budgetSum / budgetN).toFixed(2) : 0,
      pathMsBudget: ai?.pathMsBudget ?? null,
    },
    caches: { medkits: m.caches.stats.medkits, healed: m.caches.stats.healed },
  };
});

const TEAM = ['RED', 'BLUE'];
console.log(`\n  seed ${res.seed} · match ${res.end}s · phase "${res.phase}" · score ${JSON.stringify(res.score)} · winner ${res.winner < 0 ? 'DRAW' : TEAM[res.winner]}`);
console.log(
  // `stats.windows` was deleted with the score-gap trigger. @see _cathdrop.mjs.
  `  DROPS ${res.stats.calls} · ` +
    `landed R/B ${res.stats.landed[0]}/${res.stats.landed[1]} · killed-for-good R/B ${res.stats.lost[0]}/${res.stats.lost[1]}`
);
for (const a of res.stats.at) {
  console.log(
    `    -> ${TEAM[a.team]} at t=${a.t}s score ${a.score[0]}-${a.score[1]} on ${a.zone} (${a.reason})` +
      `  ${a.team === res.winner ? 'AND WENT ON TO WIN' : 'and still lost'}`
  );
}
console.log(
  `  roster ${JSON.stringify(res.rosterSize)} · reinforcements ${res.reinforcements} ` +
    `(alive at end ${res.reinAlive}, kills ${res.reinKills}, noRespawn all=${res.allNoRespawn})`
);
console.log(
  `  PERF whole match: mean ${res.perf.all.mean}ms p95 ${res.perf.all.p95}ms over ${res.perf.all.n} frames, peak actors ${res.perf.all.agentsMax}`
);
console.log(
  `  PERF with drop live: mean ${res.perf.withDrop.mean}ms p95 ${res.perf.withDrop.p95}ms over ${res.perf.withDrop.n} frames, ` +
    `peak actors ${res.perf.withDrop.agentsMax}, A* deferred ${res.perf.withDrop.deferredPerFrame}/frame (ration ${res.perf.withDrop.rationMean})`
);
console.log(
  `  A* whole match: deferred ${res.path.deferredPerFrame}/frame, ration ${res.path.rationMean}, budget ${res.path.pathMsBudget}ms`
);
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
