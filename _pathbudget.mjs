/**
 * WHO IS SPENDING THE A* RATION, AND WHAT DO THEY GET FOR IT.
 *
 *   node _pathbudget.mjs --url=http://127.0.0.1:4535/ --seed=7 [--window=45]
 *
 * `AiSystem.requestPath` is a PER-FRAME RATION (`pathMsBudget`) and it answers
 * three different ways: -1 "the frame is spent, ask again", 0 "there is no route
 * at all" (which costs the whole node ceiling to find out — the most expensive
 * answer on the board), and n>0. `Agent` reads the first as `pathPending` and
 * the second as `objectiveBlocked`, and a change that makes men re-ask more
 * often can turn one into the other for EVERYBODY without touching a behaviour.
 * This counts the three, per frame, so the question "did the retry rate eat the
 * budget" has an answer instead of an argument.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4535/';
const SEED = +(args.seed ?? 7);
const WARM = +(args.warm ?? 110);
const WINDOW = +(args.window ?? 45);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(async ({ WARM, WINDOW }) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  e.time.scale = 12;
  while (m.phase !== 'live') await frame();
  const t0 = m.roundClock; const t = () => t0 - m.roundClock;
  while (t() < WARM && m.phase === 'live') await frame();
  e.time.scale = 1;
  await frame(); await frame();

  const S = { calls: 0, rationed: 0, noRoute: 0, ok: 0, frames: 0,
    perFrame: {}, noMoveTarget: 0, alive: 0, blocked: 0, pending: 0 };
  const rp = ai.requestPath.bind(ai);
  let thisFrame = 0;
  ai.requestPath = (a, b, c) => {
    const n = rp(a, b, c);
    S.calls++;
    if (n < 0) S.rationed++; else if (n === 0) S.noRoute++; else S.ok++;
    thisFrame++;
    return n;
  };
  const tS = t();
  while (t() - tS < WINDOW && m.phase === 'live' && m.roundClock > 0) {
    thisFrame = 0;
    await frame();
    S.frames++;
    S.perFrame[thisFrame] = (S.perFrame[thisFrame] ?? 0) + 1;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      S.alive++;
      if (!a.hasMoveTarget) S.noMoveTarget++;
      if (a.objectiveBlocked) S.blocked++;
      if (a.pathPending) S.pending++;
    }
  }
  S.pathsPerFrame = ai.pathsPerFrame;
  S.pathCostMs = ai._pathCostMs;
  S.pathMsBudget = ai.pathMsBudget;
  return S;
}, { WARM, WINDOW });
await browser.close();

const p = (n, d) => +(100 * n / Math.max(1, d)).toFixed(1);
console.log(JSON.stringify({
  seed: SEED, pageerrors: errs,
  frames: out.frames,
  callsPerFrame: +(out.calls / Math.max(1, out.frames)).toFixed(2),
  rationedPct: p(out.rationed, out.calls),
  noRoutePct: p(out.noRoute, out.calls),
  okPct: p(out.ok, out.calls),
  solveBudget: { pathsPerFrame: out.pathsPerFrame, costMs: out.pathCostMs, budgetMs: out.pathMsBudget },
  perFrameCallHist: out.perFrame,
  agents: {
    noMoveTargetPct: p(out.noMoveTarget, out.alive),
    objectiveBlockedPct: p(out.blocked, out.alive),
    pathPendingPct: p(out.pending, out.alive),
  },
}, null, 2));
