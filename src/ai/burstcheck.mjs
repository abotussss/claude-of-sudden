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
/**
 * ───────────────────────────────────────────────────────────────────────────
 * `--nocap` — RUN WITHOUT `capture=1`, BECAUSE THE HARNESS IS ALSO A SUSPECT
 * ───────────────────────────────────────────────────────────────────────────
 * `capture=1` forces `rawDt` to exactly 1/60 every frame (@see the `fake` clock
 * in `src/dev/shots.js`), so a headless page rendering at ~9 fps advances the
 * simulation at 0.147x wall clock. The audio pass found that every gate in
 * `src/audio` is carried on `actx.currentTime` — REAL time — and was therefore
 * under-stressed sevenfold by exactly this.
 *
 * THIS FILE IS NOT EXPOSED TO THAT, and the argument is short enough to check:
 * `Engine.step` runs `update(t.dt)` once a frame (only `fixedUpdate` substeps),
 * `t.dt = rawDt * scale` and `t.elapsed += t.dt` — so `src/ai` is driven by
 * scaled simulation time and every clock in this file (`gapFor`, `dur`,
 * `manSecs`) is that same simulation time. Under `capture=1` it is a clean 60 Hz,
 * which is the rate the player's own game runs the AI at; WITHOUT it, headless
 * dt clamps to 0.1 s and the AI is stepped as a ten-frame-per-second game, which
 * is not a condition any player is ever in.
 *
 * The flag exists so that stays a measurement rather than an assertion. It is
 * opt-in and changes nothing when absent.
 */
const NOCAP = args.nocap === true || args.nocap === 'true';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const runs = [];
for (const seed of SEEDS) {
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(`${URL}?${NOCAP ? '' : 'capture=1&'}map=${MAP}&seed=${seed}`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 900000 });

  const out = await page.evaluate(async ({ WARM, WINDOW, NOCAP }) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const ai = e.ctx.peek('ai');
    const pl = e.ctx.peek('player');
    const level = e.ctx.peek('world')?.level?.id ?? '?';
    e.input.frozen = true;
    e.input.enabled = false;
    pl?.setControlEnabled?.(false);
    const frame = () => new Promise((r) => requestAnimationFrame(r));

    /* scale 12 on a clamped 0.1 s headless frame would be a 1.2 s AI step */
    e.time.scale = NOCAP ? 1 : 12;
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

    /**
     * ────────────────────────────────────────────────────────────────────────
     * WHAT COUNTS AS MOVING, AND WHY IT IS 2.0 AND NOT A FRACTION OF THE SPRINT
     * ────────────────────────────────────────────────────────────────────────
     * The shooting walk this file is trying to account for is authored as
     * `2.6 + aggression * 1.2` — 2.6 to 3.8 m/s — and the ordinary travel walk
     * is 4.3, so 2.0 separates "on his feet crossing ground" from "planted".
     * It is deliberately NOT a share of `_sprintCeiling`: a man firing is never
     * sprinting (the gate refuses it), so a sprint-relative threshold would
     * classify every shooting walk on the map as standing still.
     */
    const MOVING = 2.0;

    const S = {
      level,
      pulls: [],        // { n, eyesOn, weapon, dur, chopped, why, movingShare }
      contacts: [],     // { dur, rounds, movingShare, sawFire }
      rounds: 0, eyesOnRounds: 0,
      manSecs: 0, alive: 0,
      moving: 0,        // rounds sent above walking speed
      /** Man-seconds with a live contact, split by whether he was on his feet. */
      contactSecs: 0, contactMovingSecs: 0,
      /**
       * ──────────────────────────────────────────────────────────────────────
       * AND WHAT LANDED, SPLIT THE SAME WAY
       * ──────────────────────────────────────────────────────────────────────
       * "Moving rounds are back to 38 a man-minute" is satisfiable by a build
       * that sprays while walking and hits nothing, and that is the thing the
       * standing 「弾を消費すればいいわけではない」 forbids. So `damage:dealt` is
       * counted against the shooter's OWN SPEED AT THE INSTANT OF THE HIT —
       * the same 2 m/s cut the rounds use — and the two hit rates are reported
       * beside the two round counts. A plant that hits and a press that does
       * not is a real answer; so is the reverse; a single total is neither.
       *
       * Both ends are filtered through the agent set for `_aimed.mjs`'s reason:
       * the same event carries a hull's coaxial gun and the faces of its own
       * damage proxies, and counting those measures how much armour is on the
       * seed rather than this roster's marksmanship.
       */
      hitsMoving: 0, hitsStill: 0,
      /** The harness condition itself — @see the `--nocap` note at the top. */
      simSecs: 0, wallSecs: 0, frames: 0, dtMax: 0,
    };
    const raw0 = e.time.raw;
    /** Open pull per agent id. */
    const open = new Map();
    /**
     * ────────────────────────────────────────────────────────────────────────
     * AND THE CONTACT EPISODE, WHICH IS THE THING A PULL LENGTH CANNOT SEE
     * ────────────────────────────────────────────────────────────────────────
     * 「移動しながら打てるでしょ」 is not answered by a rate and it is not answered
     * by a pull length either. A moving man's problem was named exactly: his
     * CONTACTS ARE BRIEF. So this opens an episode when `hasTarget` rises and
     * closes it when it falls, and records how long it lasted, how many rounds
     * went down it, and what share of it he spent on his feet. A change that
     * "gives moving men longer contacts" has to move `dur` on the episodes
     * whose `movingShare` is high, and nothing else is proof of it.
     */
    const contact = new Map();

    const closeContact = (id, c, now) => {
      if (!c) return;
      contact.delete(id);
      if (c.secs <= 0) return;
      S.contacts.push({
        dur: now - c.first, rounds: c.rounds,
        movingShare: c.movingSecs / c.secs, sawFire: c.rounds > 0,
      });
    };

    const closeOut = (id, st) => {
      if (!st || st.n === 0) return;
      S.pulls.push({
        n: st.n, eyesOn: st.eyesOn, weapon: st.weapon,
        dur: st.last - st.first, chopped: st.burstLeft > 0, why: st.why ?? '?',
        movingShare: st.movingRounds / st.n,
      });
      open.delete(id);
    };

    const MEN = new WeakSet();
    for (const a of ai.agents) MEN.add(a);
    const onDmg = (ev) => {
      if (!ev) return;
      const src = ev.source;
      if (!src || !MEN.has(src)) return;
      if (!MEN.has(ev.target) && ev.target !== pl && ev.target !== 'player') return;
      if ((src.speed ?? 0) > MOVING) S.hitsMoving++; else S.hitsStill++;
    };
    e.ctx.events.on('damage:dealt', onDmg);

    const fire0 = ai.onAgentFire.bind(ai);
    ai.onAgentFire = (a, o, d) => {
      const now = e.time.elapsed;
      const eyes = a.targetVisible === true && a.hasTarget === true;
      const onFeet = a.speed > MOVING;
      S.rounds++;
      if (eyes) S.eyesOnRounds++;
      if (onFeet) S.moving++;
      const c = contact.get(a.id);
      if (c) c.rounds++;
      let st = open.get(a.id);
      if (st && now - st.last > gapFor(a)) { closeOut(a.id, st); st = undefined; }
      if (!st) {
        st = {
          n: 0, eyesOn: eyes, weapon: a.weaponId, first: now, last: now,
          burstLeft: 0, why: '?', movingRounds: 0,
        };
        open.set(a.id, st);
      }
      if (onFeet) st.movingRounds++;
      st.n++;
      st.last = now;
      // `burstLeft` AFTER this round: >0 at the end of the pull means chopped.
      st.burstLeft = a.burstLeft;
      /**
       * AND THE REASON IS RE-ARMED BY EVERY ROUND, WHICH IS THE WHOLE POINT.
       *
       * This file's own header says "the frame after the LAST round says by
       * what", and until this line it recorded the frame after the FIRST one.
       * A carbine at 800 rpm sends a round every 0.075 s and a frame is 0.017 s,
       * so three frames in four INSIDE a perfectly healthy burst are "he owes
       * rounds and did not send one" — the latch fired on the first of them and
       * then held that answer for the rest of the pull.
       *
       * IT BIT `SUPPRESSED` HARDEST, because the ladder asks the state before it
       * asks the trigger and SUPPRESSED IS NO LONGER A REFUSAL: a pinned man
       * returns fire (@see the SUPPRESSED case in `agent.js`). So every pull
       * fired FROM cover-under-fire was labelled "chopped by SUPPRESSED" on its
       * second frame while the man went on shooting normally for another twenty
       * rounds. The 35.0 % bar is partly that.
       *
       * Re-arming on each round makes the recorded answer the state in the gap
       * that actually ended the pull, and nothing else.
       */
      st.why = '?';
      // a pull that ever had eyes on counts as an eyes-on pull
      if (eyes) st.eyesOn = true;
      a.__firedFrame = e.time.frame;
      return fire0(a, o, d);
    };

    while (t() < WARM + WINDOW && m.phase === 'live') {
      await frame();
      const dt = e.time.dt;
      const now = e.time.elapsed;
      S.simSecs += dt;
      S.frames++;
      if (dt > S.dtMax) S.dtMax = dt;
      for (let i = 0; i < ai.agents.length; i++) {
        const a = ai.agents[i];
        MEN.add(a);
        if (!a.alive) {
          /**
           * THE BIGGEST BAR ON THE CHOPPED BOARD WAS AN UNNAMED ONE, AND IT IS
           * THE ONE ANSWER NO TUNING CAN IMPROVE. A pull that stops because the
           * man firing it was shot never reaches the ladder below — he is gone
           * from `alive` before any frame can ask him why he is not shooting —
           * so it closed as `?` and read as a mystery. It is 42 % of the town's
           * chopped eyes-on pulls, and a burst ended by a bullet is a burst
           * that worked.
           */
          const dst = open.get(a.id);
          if (dst && dst.why === '?') dst.why = 'shooter killed';
          closeOut(a.id, dst);
          closeContact(a.id, contact.get(a.id), now);
          continue;
        }
        S.alive++;
        S.manSecs += dt;
        /* the contact episode — @see `contact` above */
        if (a.hasTarget === true) {
          let c = contact.get(a.id);
          if (!c) { c = { first: now, secs: 0, movingSecs: 0, rounds: 0 }; contact.set(a.id, c); }
          c.secs += dt;
          S.contactSecs += dt;
          if (a.speed > MOVING) { c.movingSecs += dt; S.contactMovingSecs += dt; }
        } else {
          closeContact(a.id, contact.get(a.id), now);
        }
        const st = open.get(a.id);
        if (!st) continue;
        if (a.__firedFrame === e.time.frame) continue;
        /**
         * HE OWES ROUNDS AND DID NOT SEND ONE THIS FRAME. Why not — asked in
         * `_shoot`'s own order so the answer names the branch that returned.
         */
        /**
         * `cooldown/other` IS NOT AN ANSWER, IT IS THE ABSENCE OF ONE — it is
         * what every ordinary inter-round frame reads. So it never displaces a
         * named reason, and a named reason arriving later in the same gap
         * displaces IT. Between two named reasons the earlier wins: the first
         * thing that stopped him is what stopped him.
         */
        if (a.burstLeft > 0 && (st.why === '?' || st.why === 'cooldown/other')) {
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
    for (const [id, c] of [...contact]) closeContact(id, c, e.time.elapsed);
    ai.onAgentFire = fire0;
    e.ctx.events.off?.('damage:dealt', onDmg);
    S.wallSecs = e.time.raw - raw0;
    return S;
  }, { WARM, WINDOW, NOCAP });

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

console.log(`\n═══ BURST SHAPE${TAG ? ` [${TAG}]` : ''} — ${runs[0].level}, ` +
  `seeds ${runs.map((r) => r.seed).join(',')}, ${NOCAP ? 'NO capture=1' : 'capture=1'} ═══`);
{
  const w = runs.reduce((s, r) => s + (r.wallSecs ?? 0), 0);
  const simS = runs.reduce((s, r) => s + (r.simSecs ?? 0), 0);
  const fr = runs.reduce((s, r) => s + (r.frames ?? 0), 0);
  if (simS > 0) {
    console.log(`HARNESS: ${simS.toFixed(0)} s simulated in ${w.toFixed(0)} s wall ` +
      `(simSpeed ${(simS / Math.max(1e-9, w)).toFixed(3)}x) · ` +
      `${(fr / simS).toFixed(1)} AI frames per simulated second · ` +
      `worst step ${(Math.max(...runs.map((r) => r.dtMax ?? 0)) * 1000).toFixed(0)} ms.  ` +
      'All times below are SIMULATION time.');
  }
}
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ON HIS FEET vs PLANTED — 「移動しながら打てるでしょ それもやっていない」
 * ═══════════════════════════════════════════════════════════════════════════
 * The absolute moving count in the headline says HOW MANY rounds a walking man
 * sent and cannot say why there are not more of them. These two blocks can:
 * a pull is MOVING if more than half its rounds left the barrel above 2 m/s,
 * and a contact episode is a MOVING one if he spent more than half of it on his
 * feet. If moving rounds are down because moving CONTACTS ARE SHORT, it shows
 * here as a short `dur` on the moving episodes and nowhere else — and a fix
 * that lengthens them has to move that number, not the headline rate.
 */
const eyesMoving = eyes.filter((p) => p.movingShare > 0.5);
const eyesStill = eyes.filter((p) => p.movingShare <= 0.5);
const hitsMov = runs.reduce((s, r) => s + (r.hitsMoving ?? 0), 0);
const hitsStl = runs.reduce((s, r) => s + (r.hitsStill ?? 0), 0);
console.log(`\nHIT RATE by the shooter's own feet: ` +
  `ON FEET ${hitsMov}/${moving} = ${pc(hitsMov, moving)}   ` +
  `PLANTED ${hitsStl}/${rounds - moving} = ${pc(hitsStl, rounds - moving)}`);
console.log('\nEYES-ON pulls by whether he was on his feet:');
for (const [label, ps] of [['ON HIS FEET (>2 m/s)', eyesMoving], ['planted', eyesStill]]) {
  if (!ps.length) { console.log(`  ${label.padEnd(21)} —`); continue; }
  const n = ps.length;
  const chop = ps.filter((p) => p.chopped);
  console.log(`  ${label.padEnd(21)} ${String(n).padStart(5)} pulls (${pc(n, eyes.length)})  ` +
    `median ${String(med(ps.map((p) => p.n))).padStart(3)} rounds  ` +
    `mean dur ${(ps.reduce((s, p) => s + p.dur, 0) / n * 1000).toFixed(0).padStart(5)} ms  ` +
    `chopped ${pc(chop.length, n)}`);
  const why = Object.create(null);
  for (const p of chop) why[p.why] = (why[p.why] ?? 0) + 1;
  const top = Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 4);
  console.log('      chop reasons: ' + (top.map(([k, v]) => `${k} ${pc(v, chop.length)}`).join('   ') || '—'));
}

const contacts = runs.flatMap((r) => r.contacts);
const cMoving = contacts.filter((c) => c.movingShare > 0.5);
const cStill = contacts.filter((c) => c.movingShare <= 0.5);
const cSecs = runs.reduce((s, r) => s + r.contactSecs, 0);
const cMovSecs = runs.reduce((s, r) => s + r.contactMovingSecs, 0);
console.log(`\nCONTACT EPISODES (hasTarget up → down): ${contacts.length}, ` +
  `${(cSecs / 60).toFixed(1)} man-min of contact, ` +
  `${pc(cMovSecs, cSecs)} of it on his feet`);
for (const [label, cs] of [['MOSTLY MOVING', cMoving], ['mostly planted', cStill]]) {
  if (!cs.length) { console.log(`  ${label.padEnd(15)} —`); continue; }
  const n = cs.length;
  console.log(`  ${label.padEnd(15)} ${String(n).padStart(5)} (${pc(n, contacts.length)})  ` +
    `median dur ${med(cs.map((c) => c.dur)).toFixed(2)} s  ` +
    `mean dur ${(cs.reduce((s, c) => s + c.dur, 0) / n).toFixed(2)} s  ` +
    `median rounds ${med(cs.map((c) => c.rounds))}  ` +
    `silent ${pc(cs.filter((c) => !c.sawFire).length, n)}`);
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
