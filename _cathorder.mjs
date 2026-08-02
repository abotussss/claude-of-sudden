/**
 * WHAT TAKES THE CATHEDRAL DOWN, OVER WHOLE MATCHES — 「大聖堂破壊イベントの時に
 * 破壊演出して欲しいのに、その前に破壊されてしまう場合がある」
 *
 *   node _cathorder.mjs [--url=…] [--matches=3] [--scale=16]
 *
 * One claim, checked the only way it can be: play matches to their natural end
 * and record, in order, every moment the shell stops being drawn, every airstrike
 * that lands on a `CATH*` site, and every beat of `_updateCathedralEvent`. If
 * anything at all takes the building down before the event's own `raze` beat, it
 * is in this list with a timestamp beside it.
 *
 * Nothing is forced: no `roundClock`, no `_checkWinConditions`, no
 * `_cathedralCalled`. `time.scale` is the only thing touched, because a 600 s
 * match times three is not a wall-clock budget any gate can have.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4382/';
const MATCHES = Number(args.matches ?? 3);
const SCALE = Number(args.scale ?? 16);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL + (args.seed ? `?seed=${args.seed}` : ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const levelSeed = await page.evaluate(() => window.__ENGINE__?.levelSeed ?? null);

await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const w = e.ctx.peek('world');
  const T = () => +e.ctx.time.elapsed.toFixed(1);
  const rec = (window.__CO__ = { log: [], round: 0 });

  const beat = m._cathBeat.bind(m);
  m._cathBeat = (kind) => {
    rec.log.push({ t: T(), r: rec.round, what: `beat:${kind}` });
    return beat(kind);
  };
  const begin = m._beginCathedralEvent.bind(m);
  m._beginCathedralEvent = (t, p) => {
    rec.log.push({ t: T(), r: rec.round, what: `EVENT BEGINS  p=${p.toFixed(3)}` });
    return begin(t, p);
  };
  const round = m._beginRound.bind(m);
  m._beginRound = (...a) => {
    rec.round++;
    rec.log.push({ t: T(), r: rec.round, what: '── round begins ──' });
    return round(...a);
  };
  const k = w.cathedral;
  const sv = k.setVisual.bind(k);
  k.setVisual = (down) => {
    if (down) rec.log.push({ t: T(), r: rec.round, what: 'SHELL STOPS BEING DRAWN' });
    return sv(down);
  };
  e.ctx.events.on('match:airstrike', (ev) => {
    if (ev.phase !== 'impact' || !/CATH/.test(ev.site)) return;
    rec.log.push({ t: T(), r: rec.round, what: `airstrike impact ${ev.site}` });
  });
});

await page.evaluate((s) => (window.__ENGINE__.time.scale = s), SCALE);
await page.waitForFunction(
  (n) => window.__CO__.round > n,
  MATCHES,
  { timeout: 1800000, polling: 2000 }
);
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
const rec = await page.evaluate(() => window.__CO__);
await browser.close();

console.log(`\nCATHORDER  levelSeed=${levelSeed}  ${MATCHES} match(es) at ${SCALE}x\n`);
let bad = 0;
const seen = new Set();
for (const l of rec.log) {
  console.log(`  r${l.r}  t=${String(l.t).padStart(7)}  ${l.what}`);
  /**
   * The three `CATH-*` BAYS are supposed to land before the raze — that is what
   * `cathedralRazeDelay` is: 2.2 s of the salvo's own dust for the swap to
   * happen inside. What may not happen first is the BUILDING: the `CATHEDRAL`
   * demolition site, or the shell leaving the picture by any other route.
   */
  if (l.what === 'SHELL STOPS BEING DRAWN' || l.what === 'airstrike impact CATHEDRAL') {
    if (!seen.has(`raze${l.r}`)) {
      bad++;
      console.log('        ^^^ THE BUILDING WENT BEFORE ITS OWN RAZE BEAT');
    }
  }
  if (l.what === 'beat:raze') seen.add(`raze${l.r}`);
}
console.log(
  bad
    ? `\n  ${bad} thing(s) took the cathedral down (or hit it) before its own raze beat.`
    : '\n  OK — in every round the raze beat is the first thing that touches the building.'
);
console.log('  pageErrors', errs.length ? errs.slice(0, 4) : 'none');
process.exit(bad ? 1 : 0);
