/**
 * WHEN DOES A MATCH ON THE PLAIN ACTUALLY END, AND WHAT IS `p` WORTH IN SECONDS?
 *
 *   node _nftime.mjs [--url=…] [--seed=N] [--scale=8]
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE RUN FROM `_nfact.mjs`
 * ────────────────────────────────────────────────────────────────────────────
 * `_nfact.mjs` suppresses `_checkWinConditions` so that every act gets to play;
 * that makes it useless for the one question 「大イベントの発火時刻を実測し、
 * 後半3〜5分に寄せる」 actually asks, which is not "at what t" but "how many
 * seconds BEFORE THE END", and the end is the thing the suppression removes.
 *
 * `rules.js` settled this ask for the town by measuring the natural end and
 * quoting each event as seconds-remaining (「170-251 s」 at `scoreTarget` 500).
 * This is the same measurement, on the plain's own pair — `matchTime` 1200,
 * `scoreTarget` 1000.
 *
 * The acts are DISARMED (`_acts` emptied after bake) rather than left to run,
 * because an act opens D and a fifth zone changes the scoring rate — so a curve
 * measured with the acts firing is a curve that cannot be used to place them.
 * This is the BASELINE curve. `--acts` keeps them.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
  })
);
const BASE = args.url ?? 'http://127.0.0.1:4578/?map=plains';
const SCALE = Number(args.scale ?? 8);
const KEEP = args.acts === true || args.acts === 'keep';
const SEED = args.seed;
const url = SEED === undefined ? BASE : `${BASE}${BASE.includes('?') ? '&' : '?'}seed=${SEED}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
if (level !== 'plains') {
  console.error(`NOT THE PLAIN (level=${level}) — the url did not select ?map=plains.`);
  await browser.close();
  process.exit(2);
}

await page.evaluate((s) => (window.__ENGINE__.time.scale = s), SCALE);
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await page.evaluate((keep) => {
  const m = window.__ENGINE__.ctx.peek('match');
  if (!keep) m._acts = [];
  window.__S__ = [];
}, KEEP);

const T0 = Date.now();
let end = null;
while (Date.now() - T0 < 420000) {
  const st = await page.evaluate(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    const s = {
      t: +(1200 - m.roundClock).toFixed(1),
      p: +m._matchProgress().toFixed(3),
      score: [...m.score],
      phase: m.phase,
      zones: m.sites.length,
    };
    window.__S__.push(s);
    return s;
  });
  if (st.phase === 'matchover' || st.phase === 'over') { end = st; break; }
  await sleep(400);
}

const samples = await page.evaluate(() => window.__S__);
console.log(`seed=${SEED ?? 'random'} acts=${KEEP ? 'kept' : 'disarmed'}`);
console.log(`NATURAL END: t=${end ? end.t : 'DID NOT END'} s of 1200  score=${end ? end.score : '-'}  phase=${end?.phase}`);

/** What each candidate threshold is worth, in seconds and in seconds-remaining. */
const T = end ? Number(end.t) : Number(samples.at(-1).t);
console.log('\n  p      first t   % of match   T-minus');
for (const p of [0.30, 0.40, 0.46, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90]) {
  const s = samples.find((x) => x.p >= p);
  if (!s) { console.log(`  ${p.toFixed(2)}   never`); continue; }
  console.log(
    `  ${p.toFixed(2)}   ${String(s.t).padStart(6)}s   ${String(((s.t / T) * 100) | 0).padStart(3)}%      T-${(T - s.t).toFixed(0)}s`
  );
}
console.log(`\npageerrors: ${errs.length}`);
await browser.close();
