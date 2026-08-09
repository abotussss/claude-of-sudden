/**
 * WHAT ONE BIN DOES WITH WHAT IS IN IT — deterministic, no war, no load
 *
 * The live A/B on the bin-overflow fix was worthless and it is worth saying why:
 * `--drive` teleports the probe player between men who happen to be in contact,
 * so the offered rate swung 380-714 rounds a second between runs and the CONTROL
 * alone spread 22.7 % to 33.9 % carried. At that noise a 40 % effect is invisible.
 *
 * So this tests the flush itself. One bearing, a known number of rounds, a known
 * bin age, `_updateFar` called by hand with the rate gate and the room test
 * stubbed open — the only thing left varying is the arithmetic under test. It
 * reports what the shipped code did (`--bin6`) and what this pass does, on the
 * same build, in the same page, microseconds apart.
 *
 * The three things that have to hold together:
 *   rounds   must go up — that is the complaint
 *   span     must NOT go up — a longer voice holds a slot longer, and at the
 *            pool floor `FAR_FLOOR_SLOTS` rations three of them, so slot time
 *            spent here is voice count taken from 「方方でなっている」
 *   spacing  must stay inside `distantFire`'s own 0.045-0.5 clamp or the voice
 *            silently disagrees with the caller
 *
 *   node _binflush.mjs --map=plains
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const MAP = args.map ?? 'plains';
const PORT = args.port ?? '4633';
const WARM = Number(args.warm ?? 30);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:${PORT}/?map=${MAP}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await page.evaluate(async () => {
  const a = window.__ENGINE__.ctx.peek('audio');
  try { await a?.start?.(); } catch { /* reported below */ }
  window.__ENGINE__.ctx.time.scale = 6;
});
await page.waitForTimeout(WARM * 1000);

const out = await page.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const a = ctx.peek('audio'), b = a.battle, f = a.field;
  ctx.time.scale = 1;

  // Stub the two gates that are about the POOL rather than about the bin, so
  // the arithmetic under test is the only thing left moving. Both are restored.
  const room0 = b._farRoom.bind(b);
  b._farRoom = () => true;
  const pf0 = a.playFar.bind(a);

  const rows = [];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  /**
   * The shipped formula, verbatim, computed rather than intercepted.
   *
   * Clamping the ROUNDS at the `playFar` boundary is not the shipped behaviour
   * and the first version of this probe got it wrong: `spacing` is derived FROM
   * the round count inside `_updateFar`, so capping the count afterwards leaves
   * the new spacing in place and reports a burst the old code would never have
   * produced. The old code is two lines; they are restated here in full.
   */
  const shipped = (n, age) => {
    const rounds = Math.min(6, n);                                   // BIN_ROUNDS
    const spacing = clamp(age / Math.max(1, rounds - 1), 0.05, 0.22);
    return { rounds, spacing: +spacing.toFixed(4) };
  };
  /**
   * @param n     rounds sitting in the bin
   * @param age   how long they have been sitting there
   */
  const trial = (n, age) => {
    let got = null;
    a.playFar = (x, y, z, o) => {
      got = { rounds: o.rounds ?? 1, spacing: +(o.spacing ?? 0).toFixed(4) };
      return true;  // never actually build a voice; this is about the numbers
    };
    for (let i = 0; i < b._binN.length; i++) b._binN[i] = 0;
    b._farNext = 0;
    const now = a.actx.currentTime;
    const lp = f.listenerPos;
    // One bearing, due +X, so every round lands in the same bin.
    for (let i = 0; i < n; i++) b.offerFar(lp.x + 200, lp.y, lp.z, 200, null);
    b._binT[b._binN.findIndex((v) => v > 0)] = now - age;
    b._updateFar(now);
    if (!got) return null;
    return got;
  };
  const fmt = (v) => v && ({
    carried: v.rounds, spacingMs: Math.round(v.spacing * 1000),
    spanMs: Math.round(v.spacing * (v.rounds - 1) * 1000),
    // distantFire clamps spacing to 0.045-0.5 and rounds to 18; outside either
    // the caller and the voice disagree and the difference is silently lost.
    ok: v.spacing >= 0.045 && v.spacing <= 0.5 && v.rounds <= 18,
  });

  // The two cases that matter: a bin flushed on its 0.34 s window under heavy
  // fire, and a bin that waited out BIN_STALE 1.4 s of refusals — which is what
  // a busy plain at the pool floor actually produces.
  for (const [n, age] of [[6, 0.34], [12, 0.34], [26, 0.34], [26, 0.9], [40, 1.4], [60, 1.4]]) {
    rows.push({ case: `n=${n} age=${age}s`, now: fmt(trial(n, age)), shipped: fmt(shipped(n, age)) });
  }

  b._farRoom = room0;
  a.playFar = pf0;
  return { level: ctx.peek('world').level.id, rows, errors: a.stats.errors };
});
for (const r of out.rows) {
  const f = (v) => v ? `carried ${String(v.carried).padStart(2)}  spacing ${String(v.spacingMs).padStart(3)}ms  span ${String(v.spanMs).padStart(4)}ms  agrees-with-voice=${v.ok}` : 'no flush';
  console.log(`${r.case.padEnd(16)}  NOW  ${f(r.now)}\n${''.padEnd(16)}  WAS  ${f(r.shipped)}`);
}
console.log('level=' + out.level + ' errors=' + out.errors + ' pageerrors=' + errs.length);
if (errs.length) console.log(' first:', errs[0]);
await browser.close();
