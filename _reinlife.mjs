/**
 * HOW LONG HAS THIS MATCH GOT LEFT, AND HOW WRONG IS THE ANSWER?
 *
 * The reinforcement drop takes ~18.4 s from the call to the last man's boots,
 * and a drop called with less than that left delivers an empty helicopter. The
 * guard therefore needs to predict the END OF THE MATCH — which arrives on
 * POINTS, not on the clock — and the only honest way to pick the margin on that
 * prediction is to measure how badly it misses.
 *
 * So: sample the score at 1 Hz of game time for whole matches, then, OFFLINE,
 * ask at every instant what each candidate estimator would have said and
 * compare it with the remaining life the match actually had. Two estimators:
 *
 *   RATE(W)  the leader's points per second over the last W seconds, which is
 *            what a windowed guard would use.
 *   ZONE     `ownedBy(team) * scorePerZone / scoreInterval` — the income a side
 *            is on RIGHT NOW, exact for the zone component and blind to
 *            everything else (a tank kill is +30 with no warning).
 *
 * What matters is not the mean error over a whole match. It is the behaviour in
 * the last minute, where the guard fires: a prediction that is too LONG lets an
 * empty helicopter through, and one that is too SHORT eats a drop that would
 * have landed. Both are counted, at the thresholds a guard would actually use.
 *
 *   node _reinlife.mjs [url] [seed]
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4386/';
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
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.time.scale = 12;
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  const matchTime = m.roundClock;
  const t = () => +(matchTime - m.roundClock).toFixed(2);

  const S = [];
  let next = 0;
  const start = performance.now();
  while (performance.now() - start < 900000) {
    await new Promise((r) => requestAnimationFrame(r));
    if (t() >= next) {
      next = t() + 1;
      S.push([
        t(),
        m.score[0],
        m.score[1],
        m.capture?.ownedBy?.(0) ?? 0,
        m.capture?.ownedBy?.(1) ?? 0,
        +m.roundClock.toFixed(1),
      ]);
    }
    if (m.phase !== 'live' || m.roundClock <= 0) break;
  }
  return {
    seed: e.levelSeed,
    end: t(),
    score: m.score.slice(),
    target: m.constructor?.RULES?.scoreTarget ?? 500,
    S,
  };
});
await b.close();

const TARGET = 500;
const PER = 2 / 4; // scorePerZone / scoreInterval — points per second per zone
const S = res.S;
const END = res.end;
/** Actual life left at sample i, in seconds. */
const actual = (i) => END - S[i][0];

/**
 * The estimate. `rate` is per team over the window; the match ends when EITHER
 * side reaches the target, so the life is the shorter of the two — and the
 * clock is a third bound, because a match can simply run out.
 */
function predict(i, W) {
  let j = i;
  while (j > 0 && S[i][0] - S[j][0] < W) j--;
  const span = S[i][0] - S[j][0];
  if (span < 1) return Infinity;
  let life = S[i][5]; // roundClock
  for (const k of [0, 1]) {
    const r = (S[i][1 + k] - S[j][1 + k]) / span;
    const need = TARGET - S[i][1 + k];
    const l = r > 0.01 ? need / r : Infinity;
    if (l < life) life = l;
  }
  return life;
}
function predictZone(i) {
  let life = S[i][5];
  for (const k of [0, 1]) {
    const r = S[i][3 + k] * PER;
    const l = r > 0.01 ? (TARGET - S[i][1 + k]) / r : Infinity;
    if (l < life) life = l;
  }
  return life;
}

const rows = [];
for (const W of [16, 24, 40, 56, 80]) rows.push([`RATE(${W}s)`, (i) => predict(i, W)]);
rows.push(['ZONE-NOW', predictZone]);
/** The two bounds together, most conservative wins. @see the guard. */
rows.push(['MIN(24,ZONE)', (i) => Math.min(predict(i, 24), predictZone(i))]);

const INSERT = 18.4;
const MARGIN = 7;
console.log(`\n=== seed ${res.seed} · ${END}s · ${res.score[0]}-${res.score[1]} · ${S.length} samples`);
console.log(
  '  estimator      med.err   p10     p90 | DANGER ZONE (<18.4s really left)   | COST'
);
console.log(
  '                (pred-actual, s)       | worst over-predict   slips>25.4s   | good instants eaten'
);
for (const [name, f] of rows) {
  const errsAll = [];
  let danger = 0, slip = 0, eaten = 0, keptGood = 0, worstOver = -Infinity, marg = 0, margEat = 0;
  for (let i = 30; i < S.length; i++) {
    const a = actual(i);
    const p = f(i);
    if (Number.isFinite(p) && a > 0) errsAll.push(p - a);
    if (a < INSERT) {
      danger++;
      /**
       * THE NUMBER THAT SIZES THE MARGIN. In the danger zone the guard must
       * refuse, so what matters is the LARGEST life this estimator ever claims
       * when the match is really about to end: the margin has to cover it.
       */
      if (p > worstOver) worstOver = p;
      if (p > INSERT + MARGIN) slip++;
    } else if (a > 40) {
      if (p < INSERT + MARGIN) eaten++;
      else keptGood++;
    } else {
      marg++;
      if (p < INSERT + MARGIN) margEat++;
    }
  }
  errsAll.sort((x, y) => x - y);
  const q = (f2) => (errsAll.length ? errsAll[Math.floor(errsAll.length * f2)].toFixed(1) : 'n/a');
  console.log(
    `  ${name.padEnd(12)} ${q(0.5).padStart(7)} ${q(0.1).padStart(7)} ${q(0.9).padStart(7)} | ` +
      `${(Number.isFinite(worstOver) ? worstOver.toFixed(1) : 'n/a').padStart(12)}s ${String(slip + '/' + danger).padStart(13)} | ` +
      `${eaten}/${eaten + keptGood} clear, ${margEat}/${marg} marginal`
  );
}
console.log(errs.length ? `  [pageerror] ${errs.slice(0, 2).join(' | ')}` : '  [pageerror] none');
