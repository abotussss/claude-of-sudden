/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SHAPE OF THE FIRE, NOT THE AMOUNT OF IT — rounds per trigger pull
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node src/ai/burstcheck.mjs --url=http://127.0.0.1:4598/ --map=plains \
 *        --seeds=7,11 [--warm=120] [--window=150]
 *
 * 「敵が撃たない / なんで１、２発だけ撃つのを数回するの？？ / なぜ敵に向かって連射
 *  しないの？？？意味わからん」
 *
 * THIS IS NOT A COMPLAINT ABOUT VOLUME AND FIVE PASSES HAVE MISREAD IT AS ONE.
 * `rounds/man-min`, `aimed share` and `aimed rounds/man-min` are all RATES, and
 * a rate cannot tell these two men apart:
 *
 *   forty-five 2-round taps a minute   =  90 aimed rounds/man-min
 *   nine 10-round bursts a minute      =  90 aimed rounds/man-min
 *
 * They score identically on every number this repo has ever reported and they
 * look nothing like each other. We have been measuring the integral; he is
 * describing the WAVEFORM. So this file measures the waveform.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT A PULL IS, AND WHY IT IS MEASURED BY THE CLOCK
 * ───────────────────────────────────────────────────────────────────────────
 * A pull is a run of rounds from ONE man with no gap longer than `GAP`. It is
 * deliberately not `burstLeft`'s own bookkeeping: `_shoot` CHAINS pulls when the
 * man can still see his target (`burstFired` is inherited, not reset), so the
 * engine's idea of "a pull" and the continuous noise the player hears are two
 * different things — and it is the second one he is complaining about. 0.30 s
 * is comfortably longer than the slowest automatic's round interval (600 rpm =
 * 0.10 s) and comfortably shorter than the burst gap, so it cuts where the ear
 * cuts.
 *
 * EYES-ON ONLY, for the headline. He says 「敵に向かって」 — a tap at a last-known
 * doorway is a different behaviour with its own ration (`BLIND_BURST`), and
 * folding the two together is what would hide the answer. Both are reported.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * AND WHY EACH PULL ENDED, WHICH IS THE WHOLE DIAGNOSIS
 * ───────────────────────────────────────────────────────────────────────────
 * `_shoot` draws `burstLeft` from `rng.int(lo, hi)` with `lo = (8 + (1-trigger)
 * * 12) * holdFactor` — so the INTENDED pull is eight to twenty-plus rounds.
 * If the observed pull is two, the pull is being CHOPPED, and the tell is
 * exact: `burstLeft` still greater than zero when the firing stopped. A pull
 * that ran to `burstLeft === 0` spent what it was given. A pull abandoned with
 * rounds still owed was interrupted, and the frame after the last round says by
 * what — the same ladder `_shoot` returns on, in its own order.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4598/';
const SEEDS = String(args.seeds ?? args.seed ?? '7').split(',');
const MAP = args.map ?? 'plains';
const WARM = +(args.warm ?? 120);
const WINDOW = +(args.window ?? 150);
const TAG = args.tag ?? '';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const runs = [];
for (const seed of SEEDS) {
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(`${URL}?capture=1&map=${MAP}&seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 600000 });

  const out = await page.evaluate(async ({ WARM, WINDOW }) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const ai = e.ctx.peek('ai');
    const pl = e.ctx.peek('player');
    const level = e.ctx.peek('world')?.level?.id ?? '?';
    e.input.frozen = true;
    e.input.enabled = false;
    pl?.setControlEnabled?.(false);
    const frame = () => new Promise((r) => requestAnimationFrame(r));

    e.time.scale = 12;
    while (m.phase !== 'live' || ai.agents.length === 0) await frame();
    const t0 = m.roundClock;
    const t = () => t0 - m.roundClock;
    while (t() < WARM && m.phase === 'live') await frame();
    e.time.scale = 1;
    await frame(); await frame(); await frame();

    /**
     * SECONDS OF SILENCE THAT END A PULL — AND IT IS PER MAN, NOT A CONSTANT.
     *
     * A flat 0.30 s was wrong and wrong in the one direction that invents the
     * bug being hunted. The magnum fires every 60/170 = 0.353 s and the bolt gun
     * every ~1.05 s, both LONGER than the cut, so a revolver firing perfectly
     * normally scored one round per "pull" and reported a median of 1 — the
     * probe manufacturing 「１、２発だけ」 out of a weapon behaving exactly as
     * authored. The question is "did he keep firing AT HIS OWN RATE", so the
     * threshold has to be his own rate: 2.2 intervals, floored at 0.30 s so a
     * fast weapon still gets a human-audible gap.
     */
    const gapFor = (a) => Math.max(0.30, 2.2 / Math.max(0.5, a.fireRate ?? 10));

    const S = {
      level,
      pulls: [],        // { n, eyesOn, weapon, dur, chopped, why }
      rounds: 0, eyesOnRounds: 0,
      manSecs: 0, alive: 0,
      moving: 0,        // rounds sent above walking speed
    };
    /** Open pull per agent id. */
    const open = new Map();

    const closeOut = (id, st) => {
      if (!st || st.n === 0) return;
      S.pulls.push({
        n: st.n, eyesOn: st.eyesOn, weapon: st.weapon,
        dur: st.last - st.first, chopped: st.burstLeft > 0, why: st.why ?? '?',
      });
      open.delete(id);
    };

    const fire0 = ai.onAgentFire.bind(ai);
    ai.onAgentFire = (a, o, d) => {
      const now = e.time.elapsed;
      const eyes = a.targetVisible === true && a.hasTarget === true;
      S.rounds++;
      if (eyes) S.eyesOnRounds++;
      if (a.speed > 2.0) S.moving++;
      let st = open.get(a.id);
      if (st && now - st.last > gapFor(a)) { closeOut(a.id, st); st = undefined; }
      if (!st) {
        st = { n: 0, eyesOn: eyes, weapon: a.weaponId, first: now, last: now, burstLeft: 0, why: '?' };
        open.set(a.id, st);
      }
      st.n++;
      st.last = now;
      // `burstLeft` AFTER this round: >0 at the end of the pull means chopped.
      st.burstLeft = a.burstLeft;
      // a pull that ever had eyes on counts as an eyes-on pull
      if (eyes) st.eyesOn = true;
      a.__firedFrame = e.time.frame;
      return fire0(a, o, d);
    };

    while (t() < WARM + WINDOW && m.phase === 'live') {
      await frame();
      const dt = e.time.dt;
      const now = e.time.elapsed;
      for (let i = 0; i < ai.agents.length; i++) {
        const a = ai.agents[i];
        if (!a.alive) { closeOut(a.id, open.get(a.id)); continue; }
        S.alive++;
        S.manSecs += dt;
        const st = open.get(a.id);
        if (!st) continue;
        if (a.__firedFrame === e.time.frame) continue;
        /**
         * HE OWES ROUNDS AND DID NOT SEND ONE THIS FRAME. Why not — asked in
         * `_shoot`'s own order so the answer names the branch that returned.
         */
        if (st.why === '?' && a.burstLeft > 0) {
          st.why = a.animator?.reloading === true ? 'reloading'
            : a.ammo <= 0 ? 'magazine empty'
              : a.state === 'suppressed' ? 'SUPPRESSED'
                : a.hasTarget !== true ? 'contact lost'
                  : a.state === 'dead' ? 'dead'
                    : !a.wantFire ? 'wantFire false'
                      : 'cooldown/other';
        }
        if (now - st.last > gapFor(a)) closeOut(a.id, st);
      }
    }
    for (const [id, st] of [...open]) closeOut(id, st);
    ai.onAgentFire = fire0;
    return S;
  }, { WARM, WINDOW });

  out.seed = seed;
  out.pageerrors = errs.length;
  runs.push(out);
  await page.close();
}
await browser.close();

/* ---------------- report ---------------- */
const all = runs.flatMap((r) => r.pulls);
const eyes = all.filter((p) => p.eyesOn);
const blind = all.filter((p) => !p.eyesOn);
const manMin = runs.reduce((s, r) => s + r.manSecs / 60, 0);
const rounds = runs.reduce((s, r) => s + r.rounds, 0);
const eyesRounds = runs.reduce((s, r) => s + r.eyesOnRounds, 0);
const moving = runs.reduce((s, r) => s + r.moving, 0);
const pc = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)} %` : '—');
const med = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};
const dist = (ps) => {
  const b = { 1: 0, 2: 0, '3-5': 0, '6-10': 0, '11+': 0 };
  for (const p of ps) {
    if (p.n === 1) b['1']++;
    else if (p.n === 2) b['2']++;
    else if (p.n <= 5) b['3-5']++;
    else if (p.n <= 10) b['6-10']++;
    else b['11+']++;
  }
  return b;
};

console.log(`\n═══ BURST SHAPE${TAG ? ` [${TAG}]` : ''} — ${runs[0].level}, seeds ${runs.map((r) => r.seed).join(',')} ═══`);
console.log(`${manMin.toFixed(1)} man-minutes · ${rounds} rounds (${(rounds / manMin).toFixed(1)}/man-min) · ` +
  `AIMED ${pc(eyesRounds, rounds)} (${(eyesRounds / manMin).toFixed(1)}/man-min) · ` +
  `MOVING ${moving} abs (${(moving / manMin).toFixed(1)}/man-min, ${pc(moving, rounds)})`);

for (const [label, ps] of [['EYES-ON a visible enemy', eyes], ['blind / last-known', blind]]) {
  if (!ps.length) continue;
  const d = dist(ps);
  const n = ps.length;
  console.log(`\n${label}: ${n} pulls, median ${med(ps.map((p) => p.n))} rounds, ` +
    `mean ${(ps.reduce((s, p) => s + p.n, 0) / n).toFixed(1)}, ` +
    `mean duration ${(ps.reduce((s, p) => s + p.dur, 0) / n * 1000).toFixed(0)} ms`);
  console.log('  rounds per pull:  ' + Object.entries(d)
    .map(([k, v]) => `${k}:${pc(v, n)}`).join('   '));
  console.log(`  ONE OR TWO ROUNDS: ${pc(d['1'] + d['2'], n)} of pulls  ◄── 「１、２発だけ撃つ」`);
  const chop = ps.filter((p) => p.chopped);
  console.log(`  CHOPPED (burstLeft still owed): ${pc(chop.length, n)}`);
  const why = Object.create(null);
  for (const p of chop) why[p.why] = (why[p.why] ?? 0) + 1;
  for (const [k, v] of Object.entries(why).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(18)} ${pc(v, chop.length).padStart(7)}`);
  }
}

console.log('\nper weapon (EYES-ON pulls):');
const byW = Object.create(null);
for (const p of eyes) (byW[p.weapon] ??= []).push(p.n);
for (const [w, ns] of Object.entries(byW).sort((a, b) => b[1].length - a[1].length)) {
  const d = dist(ns.map((n) => ({ n })));
  console.log(`  ${w.padEnd(9)} ${String(ns.length).padStart(5)} pulls  median ${String(med(ns)).padStart(3)}  ` +
    `mean ${(ns.reduce((s, x) => s + x, 0) / ns.length).toFixed(1).padStart(5)}  ` +
    `1-2 rounds ${pc(d['1'] + d['2'], ns.length)}`);
}
console.log(`\npageerrors ${runs.reduce((s, r) => s + r.pageerrors, 0)}`);
