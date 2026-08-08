/**
 * ═══════════════════════════════════════════════════════════════════════════
 * IS HE SHOOTING AT A MAN, OR IS HE SPENDING AMMUNITION? — 「もっと敵に対して撃つこと、
 * 弾を消費すればいいわけではない」
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node _aimed.mjs --url=http://127.0.0.1:4574/ --seeds=7,11 [--warm=120]
 *                   [--window=150]
 *
 * EVERY REPORT SO FAR HAS ANSWERED WITH ROUNDS. 12.3 → 32.7 → 61.6 → 97.2 → 44
 * per man-minute, then 9.7k → 14.1k per 150 s, and the sentence above is the
 * correction: the volume went up 45 % and the thing he asked for did not
 * happen. ROUNDS SENT IS NOT THE NUMBER. A man hosing a doorway he last saw
 * somebody behind four seconds ago moves it exactly as far as a man shooting
 * somebody in the chest, and only one of those is 「敵に対して撃つ」.
 *
 * So this splits every round the roster fires into the three things it can be,
 * at the instant the barrel goes off, read off the shooter himself:
 *
 *   AIMED        `targetVisible && hasTarget` and the target is A MAN. He can
 *                see him right now. This is the number that has to go up.
 *   BLIND        no line, but a last-known inside `SUPPRESS_WINDOW` — the
 *                covering-fire branches in `_combat`. Rounds into a place.
 *   ARMOUR/DRONE not a man at all, and reported apart so a tank-heavy seed
 *                cannot flatter or spoil either of the two above.
 *
 * …and every alive man-frame into what he HAD, which is the other half of the
 * complaint, because a roster that never meets anybody cannot shoot at anybody:
 *
 *   CONTACT      the share of alive man-time with a live enemy IN SIGHT. This
 *                is 「遭遇」 and it is what movement is supposed to buy.
 *   PROSECUTION  of that time, the share on which a round actually left the
 *                barrel. This is 「撃つこと」 given the contact.
 *
 * THE GROUND TRUTH UNDER BOTH IS `damage:dealt`. A round that hits a man is a
 * round that was at a man by any definition, so hits and kills are counted off
 * the canonical event (`shooter`/`source` is the agent — @see
 * `AiSystem.onAgentFire` and `_testPlayerHit`) and reported per man-minute
 * beside the rounds. A build that raises rounds and not hits has spent
 * ammunition; a build that raises hits has done what was asked.
 *
 * The clock, the warm-up and the freeze are `_engage.mjs`'s and are copied
 * deliberately so the two reports are about the same 150 seconds of the same
 * match: scale 12 to the warm mark, scale 1 for the window, because
 * `Engine.step` clamps a raw frame and a fast window measures a different game.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4574/';
const SEEDS = String(args.seeds ?? args.seed ?? '7').split(',');
const WARM = +(args.warm ?? 120);
const WINDOW = +(args.window ?? 150);
/**
 * WHICH LEVEL — `_engage.mjs`'s flag, copied for the same reason it exists
 * there. This file was written when there was one map and it pinned itself to
 * `DEFAULTS.map` by omission, so "run it on both maps" silently measured the
 * same one twice. Absent, it still resolves to `DEFAULTS.map`, so a command
 * line written before this flag existed measures exactly what it used to.
 */
const MAP = args.map ?? null;
const Q = MAP ? `&map=${MAP}` : '';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const runs = [];
for (const seed of SEEDS) {
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(`${URL}?capture=1&seed=${seed}${Q}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

  const out = await page.evaluate(async ({ WARM, WINDOW }) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const ai = e.ctx.peek('ai');
    const pl = e.ctx.peek('player');
    e.input.frozen = true;
    e.input.enabled = false;
    pl?.setControlEnabled?.(false);
    const frame = () => new Promise((r) => requestAnimationFrame(r));

    e.time.scale = 12;
    while (m.phase !== 'live') await frame();
    const t0 = m.roundClock;
    const t = () => t0 - m.roundClock;
    while (t() < WARM && m.phase === 'live') await frame();
    e.time.scale = 1;
    await frame(); await frame(); await frame();

    const S = {
      /* WHICH MAP ACTUALLY RAN — read from inside the page, not from the flag
         that asked for it. A query string that does not take is otherwise a
         silent duplicate run. */
      level: e.ctx.peek('world')?.level?.id ?? '?',
      /* rounds, split by what he was pointing at */
      rounds: 0, aimed: 0, blind: 0, stale: 0, atArmour: 0, atDrone: 0,
      /* the same, for the ELITE ten only. @see `Agent.elite`. */
      eRounds: 0, eAimed: 0,
      /* man-frames */
      alive: 0, contact: 0, memory: 0, contactFiring: 0,
      eAlive: 0, eContact: 0,
      /* what landed */
      hits: 0, hitDamage: 0, kills: 0, hitsOnPlayer: 0,
      /* seconds of window at scale 1 */
      secs: 0, ticks: 0,
      /* movement, so one run answers both halves of the sentence */
      travel: 0, travelCeil: 0, travelSlow: 0,
      eTravel: 0, eTravelCeil: 0,
      metres: 0, manSecs: 0, eMetres: 0, eManSecs: 0,
      errs: [],
    };

    /**
     * WHAT A ROUND WAS AIMED AT, decided on the frame it leaves the barrel and
     * off the shooter's own fields rather than off a geometric test — these are
     * the exact two flags `Agent._combat` reads to decide to pull the trigger
     * (`targetVisible` for the aimed branches, `lastKnownAge < SUPPRESS_WINDOW`
     * for the two covering-fire ones), so the split here IS the split the
     * behaviour makes.
     */
    const fire0 = ai.onAgentFire.bind(ai);
    ai.onAgentFire = (a, o, d) => {
      const tgt = a.targetActor;
      const isV = tgt?.isVehicle === true;
      const isD = tgt ? ai.isDrone?.(tgt) === true : false;
      S.rounds++;
      if (a.elite === true) S.eRounds++;
      if (isV) S.atArmour++;
      else if (isD) S.atDrone++;
      else if (a.targetVisible && a.hasTarget) {
        S.aimed++;
        if (a.elite === true) S.eAimed++;
      } else if (a.lastKnownAge < 6) S.blind++;
      else S.stale++;
      a.__firedFrame = e.time.frame;
      return fire0(a, o, d);
    };

    /**
     * AND WHAT LANDED. `damage:dealt` is the one event both halves of the
     * damage path go through — `physics.emitImpact` carries the `shooter`
     * `fireBullet` was told about, and `AiSystem._testPlayerHit` emits it
     * directly for the human — so a single listener counts every bot round
     * that touched a man.
     *
     * BOTH ENDS ARE FILTERED THROUGH `MEN`, and that is not fussiness. The
     * same event carries a player's round, a tank's coaxial burst and every
     * face of the hull's own damage proxies (@see `src/match/tank.js`), and a
     * hit count that includes those is a measure of how much armour is on the
     * seed rather than of this roster's marksmanship.
     *
     * `killed` IS NOT READ. `physics` emits it hard-coded false — the kill is
     * decided downstream by whoever owns the actor — so deaths are counted in
     * the frame loop off `alive` falling instead, which cannot disagree with
     * itself.
     */
    const MEN = new WeakSet();
    for (const a of ai.agents) MEN.add(a);
    const onDmg = (ev) => {
      if (!ev) return;
      const src = ev.source;
      if (!src || !MEN.has(src)) return;
      const onMan = MEN.has(ev.target);
      const onPlayer = ev.target === pl || ev.target === 'player';
      if (!onMan && !onPlayer) return;
      S.hits++;
      S.hitDamage += ev.amount ?? 0;
      if (onPlayer) S.hitsOnPlayer++;
    };
    e.ctx.events.on('damage:dealt', onDmg);

    const lastX = new Map(), lastZ = new Map();
    const wasAlive = new WeakSet();
    const tStart = t();
    const wall0 = e.time.elapsed;
    while (t() - tStart < WINDOW && m.phase === 'live' && m.roundClock > 0) {
      const dt = e.time.dt;
      await frame();
      S.ticks++;
      for (const a of ai.agents) {
        MEN.add(a);
        if (!a.alive) {
          // A man who was alive on the previous tick and is not now was killed
          // inside the window. @see the `killed` note on the listener above.
          if (wasAlive.has(a)) { S.kills++; wasAlive.delete(a); }
          lastX.delete(a);
          continue;
        }
        wasAlive.add(a);
        const el = a.elite === true;
        S.alive++;
        if (el) S.eAlive++;
        S.manSecs += dt;
        if (el) S.eManSecs += dt;
        const px = lastX.get(a), pz = lastZ.get(a);
        if (px !== undefined) {
          const d = Math.hypot(a.position.x - px, a.position.z - pz);
          // A teleport is a respawn, not a run.
          if (d < 3) { S.metres += d; if (el) S.eMetres += d; }
        }
        lastX.set(a, a.position.x); lastZ.set(a, a.position.z);

        const tgt = a.targetActor;
        const man = tgt && tgt.isVehicle !== true && ai.isDrone?.(tgt) !== true;
        if (a.hasTarget && a.targetVisible && man) {
          S.contact++;
          if (el) S.eContact++;
          if (a.__firedFrame === e.time.frame) S.contactFiring++;
        } else if (a.hasTarget) S.memory++;

        /* travel, on `_engage.mjs`'s own definition so the two agree */
        const o = a.objective;
        if (!o || a.state !== 'advance') continue;
        const dist = Math.hypot(o.position.x - a.position.x, o.position.z - a.position.z);
        if (dist < 16) continue;
        S.travel++;
        if (el) S.eTravel++;
        const ms = a.moveScale ?? 1;
        const ceil = a._sprintCeiling ?? (6.4492 * (ms >= 1 ? ms : 0.5 + ms * 0.5));
        if (a.speed >= ceil * 0.98) { S.travelCeil++; if (el) S.eTravelCeil++; }
        if (a.speed < 5) S.travelSlow++;
      }
    }
    S.secs = e.time.elapsed - wall0;
    e.ctx.events.off?.('damage:dealt', onDmg);
    ai.onAgentFire = fire0;
    S.score = m.score ? { ...m.score } : null;
    return S;
  }, { WARM, WINDOW });

  out.seed = seed;
  out.pageErrors = errs.slice(0, 5);
  runs.push(out);
  await page.close();

  const pc = (a, b) => (b ? ((a / b) * 100).toFixed(1) + ' %' : '-');
  const perMin = (a) => (out.manSecs ? (a / (out.manSecs / 60)).toFixed(1) : '-');
  console.log(`\n═══ ${out.level} · seed ${seed} — ${out.secs.toFixed(0)} s of live round, ` +
    `${(out.manSecs / 60).toFixed(1)} man-minutes ═══`);
  console.log(`ROUNDS      ${out.rounds}   ${perMin(out.rounds)}/man-min`);
  console.log(`  AIMED     ${out.aimed}  (${pc(out.aimed, out.rounds)} of all)   ` +
    `${perMin(out.aimed)}/man-min   <- 敵に対して撃つ`);
  console.log(`  BLIND     ${out.blind}  (${pc(out.blind, out.rounds)})  into a last-known`);
  console.log(`  STALE     ${out.stale}  (${pc(out.stale, out.rounds)})  neither`);
  console.log(`  ARMOUR    ${out.atArmour}   DRONE ${out.atDrone}`);
  console.log(`CONTACT     ${pc(out.contact, out.alive)} of alive man-time has a man IN SIGHT` +
    `   (memory-only ${pc(out.memory, out.alive)})`);
  console.log(`PROSECUTION ${pc(out.contactFiring, out.contact)} of that time sends a round`);
  console.log(`HITS        ${out.hits}  (${pc(out.hits, out.rounds)} of rounds, ` +
    `${pc(out.hits, out.aimed)} of aimed)   ${perMin(out.hits)}/man-min` +
    `   dmg ${out.hitDamage.toFixed(0)}   kills ${out.kills}   on player ${out.hitsOnPlayer}`);
  console.log(`TRAVEL      ${pc(out.travelCeil, out.travel)} at >=98 % of own ceiling, ` +
    `${pc(out.travelSlow, out.travel)} under 5 m/s   ` +
    `${(out.manSecs ? out.metres / (out.manSecs / 60) : 0).toFixed(1)} m per man-minute`);
  if (out.eAlive) {
    console.log(`ELITE       ${out.eRounds} rounds (${pc(out.eAimed, out.eRounds)} aimed), ` +
      `contact ${pc(out.eContact, out.eAlive)}, ` +
      `${pc(out.eTravelCeil, out.eTravel)} at ceiling, ` +
      `${(out.eManSecs ? out.eMetres / (out.eManSecs / 60) : 0).toFixed(1)} m per man-minute`);
  } else {
    console.log('ELITE       no elite ever landed in this window');
  }
  if (errs.length) console.log('PAGEERROR', errs.slice(0, 3));
}

/* the two seeds side by side, which is the only form worth quoting */
const sum = (k) => runs.reduce((a, r) => a + r[k], 0);
const pc = (a, b) => (b ? ((a / b) * 100).toFixed(1) + ' %' : '-');
const mm = sum('manSecs') / 60;
console.log(`\n═══ ALL SEEDS (${runs.map((r) => r.seed).join(',')}) — ${mm.toFixed(1)} man-minutes ═══`);
console.log(`rounds ${sum('rounds')} (${(sum('rounds') / mm).toFixed(1)}/man-min) · ` +
  `AIMED ${sum('aimed')} (${pc(sum('aimed'), sum('rounds'))}, ${(sum('aimed') / mm).toFixed(1)}/man-min) · ` +
  `blind ${sum('blind')} · hits ${sum('hits')} (${(sum('hits') / mm).toFixed(2)}/man-min) · ` +
  `kills ${sum('kills')}`);
console.log(`contact ${pc(sum('contact'), sum('alive'))} · ` +
  `prosecution ${pc(sum('contactFiring'), sum('contact'))} · ` +
  `travel at ceiling ${pc(sum('travelCeil'), sum('travel'))} · ` +
  `under 5 m/s ${pc(sum('travelSlow'), sum('travel'))} · ` +
  `${(sum('metres') / mm).toFixed(1)} m per man-minute`);
if (sum('eAlive')) {
  console.log(`elite: ${pc(sum('eAimed'), sum('eRounds'))} aimed · ` +
    `contact ${pc(sum('eContact'), sum('eAlive'))} · ` +
    `at ceiling ${pc(sum('eTravelCeil'), sum('eTravel'))} · ` +
    `${(sum('eMetres') / (sum('eManSecs') / 60)).toFixed(1)} m per man-minute`);
}
await browser.close();
