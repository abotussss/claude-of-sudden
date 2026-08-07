/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THREE COMPLAINTS, ONE INSTRUMENT — volume, the lean, and standing about
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node src/ai/volleycheck.mjs --url=http://127.0.0.1:4598/ --seeds=7,11 \
 *        --map=town|plains [--warm=120] [--window=150]
 *
 * 「あと全然撃ってない 相手が / 相手のAIなんで撃ってこないの？距離あっても」
 * 「個性を作ってもいいけど撃つ量はみんな増やせ」
 * 「あと前傾姿勢はあるけど移動速度がなんでMAXでは知らないの？」
 * 「あと何で移動せずに撃つの？？？滞留させるな 意味もなく」
 *
 * `_aimed.mjs` already answers "rounds, and were they at a man". It cannot
 * answer the other two, and it has no `--map`, so on a two-map build it has
 * only ever measured the town. This is that tool plus the three columns the
 * complaints actually name, on either map.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE FOUR READINGS
 * ───────────────────────────────────────────────────────────────────────────
 * VOLUME + AIM, unchanged from `_aimed.mjs` and deliberately identical so the
 *   three-build table in `c01b7bd` stays comparable: every round is split at
 *   the barrel into AIMED (`targetVisible && hasTarget`), BLIND (a `lastKnown`
 *   inside `SUPPRESS_WINDOW`), STALE or armour. 「弾を消費すればいいわけではない」
 *   has not been withdrawn, so neither number is ever reported without the
 *   other.
 *
 * MOVING FIRE — the trap-detector for this pass. Raising volume by making men
 *   STOP is the cheap way to satisfy 「撃つ量はみんな増やせ」 and it makes
 *   「滞留させるな」 worse. So every round is also tagged with whether the
 *   shooter was above `WALKING` at the instant it left the barrel, and the
 *   share is reported next to the volume. A build whose rounds go up and whose
 *   moving share goes down has not passed.
 *
 * THE LEAN — 「前傾姿勢はあるけど移動速度がMAXじゃない」. `Agent._drive` picks
 *   the sprint clip on `this.sprinting && this.speed > 4.4`, and 4.4 is a
 *   LITERAL on a ceiling that is per-weapon (`_sprintCeiling` = 6.4492 ×
 *   moveScale-ish, i.e. 5.74 for the belt gun and 6.97 for the machine
 *   pistol). So this counts, for every frame the sprint clip is actually
 *   playing, what fraction of that man's OWN ceiling he is at — and the share
 *   of lean-frames below 95 % of it, which is precisely the thing the player
 *   says he is looking at. Measured against each man's own ceiling, never a
 *   constant: a literal has produced a wrong answer here twice already.
 *
 * 滞留 — a man in COMBAT asking for zero speed with no move target and no
 *   reason. Split into AT COVER (he arrived and is working an angle, which is
 *   a real thing a soldier does) and NO COVER AT ALL (he is standing in the
 *   open because `_combat`'s else-branch sets `desiredSpeed = 0` for anybody
 *   who is not walking to a cover point — 「意味もなく」).
 *
 * AND THE RANGE GATE — 「距離あっても」. `_combat` refuses the trigger on
 *   `dist < this.weaponRange`, and `weaponRange` is `reach × (0.8 + skill ×
 *   0.33)`: 25.6-36.2 m for the machine pistol against a plain whose capture
 *   points are 154-314 m apart. So contact time is bucketed by distance and
 *   the share REFUSED PURELY BY RANGE — he can see a live enemy, he is not
 *   reloading, and the only thing between him and the trigger is the metres —
 *   is reported on its own.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE CLOCK, and it is `_engage.mjs`'s lesson
 * ───────────────────────────────────────────────────────────────────────────
 * Only the WARM-UP runs fast. The measured window is `time.scale = 1`, because
 * `Engine.step` clamps a raw frame and a scaled `dt` changes how often a burst
 * is re-decided. And the sim is NOT reproducible at a given seed — `rawDt`
 * comes from `performance.now()`, so machine load feeds the integration. Run
 * the same seeds on both builds, compare totals, never one seed.
 */
import { chromium } from 'playwright';

/* Split on the FIRST `=` only. @see `tools/navcheck.mjs` — a destructured
 * `split('=')` turned `--url=…/?map=plains` into `…/?map` and ran the town. */
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4598/';
const SEEDS = String(args.seeds ?? args.seed ?? '7').split(',');
const MAP = args.map ?? 'town';
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

    /** Above this a man counts as MOVING while he shoots. A walk, not a jog. */
    const WALKING = 2.0;
    /** Contact-distance buckets, metres. */
    const BUCKETS = [10, 20, 30, 40, 55, 70, 90, 120, 1e9];

    const S = {
      level,
      rounds: 0, aimed: 0, blind: 0, stale: 0, atArmour: 0, atDrone: 0,
      roundsMoving: 0, aimedMoving: 0,
      /* man-frames */
      alive: 0, contact: 0, contactFiring: 0,
      /* the lean */
      leanFrames: 0, leanBelow: 0, leanFracSum: 0,
      sprintGranted: 0, travel: 0, travelCeil: 0, travelSlow: 0,
      /* 滞留 */
      combatFrames: 0, loiterCover: 0, loiterOpen: 0,
      /* the range gate */
      rangeRefused: 0, contactDist: new Array(BUCKETS.length).fill(0),
      refusedDist: new Array(BUCKETS.length).fill(0),
      hits: 0, kills: 0,
      secs: 0,
    };

    /* ---- rounds, at the barrel ------------------------------------------ */
    const fire0 = ai.onAgentFire.bind(ai);
    ai.onAgentFire = (a, o, d) => {
      const tgt = a.targetActor;
      const isV = tgt?.isVehicle === true;
      const isD = tgt ? ai.isDrone?.(tgt) === true : false;
      const moving = a.speed > WALKING;
      S.rounds++;
      if (moving) S.roundsMoving++;
      if (isV) S.atArmour++;
      else if (isD) S.atDrone++;
      else if (a.targetVisible && a.hasTarget) {
        S.aimed++;
        if (moving) S.aimedMoving++;
      } else if (a.lastKnownAge < 6) S.blind++;
      else S.stale++;
      a.__firedFrame = e.time.frame;
      return fire0(a, o, d);
    };

    const bucket = (d) => {
      for (let i = 0; i < BUCKETS.length; i++) if (d < BUCKETS[i]) return i;
      return BUCKETS.length - 1;
    };

    /** `STATE` is a table of STRINGS in `agent.js`, not an enum of numbers. */
    const STATE_COMBAT = 'combat';
    const tEnd = WINDOW;
    while (t() < WARM + tEnd && m.phase === 'live') {
      await frame();
      const dt = e.time.dt;
      S.secs += dt;
      for (let i = 0; i < ai.agents.length; i++) {
        const a = ai.agents[i];
        if (!a.alive) continue;
        S.alive++;

        /* ---- the lean, against HIS OWN ceiling --------------------------- */
        const ceil = a._sprintCeiling;
        if (a.clip === 'sprint') {
          S.leanFrames++;
          const f = ceil > 0 ? a.speed / ceil : 0;
          S.leanFracSum += f;
          if (f < 0.95) S.leanBelow++;
        }
        if (a.sprinting) S.sprintGranted++;
        if (a.hasMoveTarget && a.desiredSpeed > 0.1) {
          S.travel++;
          if (a.speed >= ceil * 0.98) S.travelCeil++;
          if (a.speed < 5) S.travelSlow++;
        }

        /* ---- contact, the range gate, and standing about ----------------- */
        const inCombat = a.state === STATE_COMBAT || a.hasTarget === true;
        if (inCombat) {
          S.combatFrames++;
          const still = a.desiredSpeed <= 0.1 && !a.hasMoveTarget;
          if (still) {
            if (a.cover) S.loiterCover++;
            else S.loiterOpen++;
          }
        }
        if (a.hasTarget && a.targetActor) {
          S.contact++;
          const d = a.position.distanceTo(a.targetActor.position);
          const b = bucket(d);
          S.contactDist[b]++;
          if (a.__firedFrame === e.time.frame) S.contactFiring++;
          /**
           * REFUSED PURELY BY RANGE. He can SEE him, the gun is loaded and
           * assembled, and the one thing left is the metres. This is the
           * sentence 「距離あっても」 makes, isolated from every other refusal.
           */
          if (a.targetVisible && d >= a.weaponRange
            && a.ammo > 0 && a.animator?.reloading !== true) {
            S.rangeRefused++;
            S.refusedDist[b]++;
          }
        }
      }
    }
    ai.onAgentFire = fire0;
    S.buckets = BUCKETS;
    return S;
  }, { WARM, WINDOW });

  out.seed = seed;
  out.pageerrors = errs.length;
  runs.push(out);
  await page.close();
}
await browser.close();

const pc = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)} %` : '—');
const sum = (k) => runs.reduce((s, r) => s + (r[k] ?? 0), 0);
const sumA = (k) => runs.reduce((s, r) => r[k].map((v, i) => (s[i] ?? 0) + v), []);
const manMin = runs.reduce((s, r) => s + (r.alive / Math.max(1, r.secs)) * (r.secs / 60), 0);

for (const r of runs) {
  const mmr = (r.alive / Math.max(1, r.secs)) * (r.secs / 60);
  console.log(`\n═══ seed ${r.seed} [${r.level}] — ${r.secs.toFixed(0)} s, ${mmr.toFixed(1)} man-min, err ${r.pageerrors}`);
  console.log(`ROUNDS  ${r.rounds}  (${(r.rounds / mmr).toFixed(1)}/man-min)   AIMED ${pc(r.aimed, r.rounds)}   ` +
    `MOVING ${pc(r.roundsMoving, r.rounds)}`);
  console.log(`LEAN    ${r.leanFrames} sprint-clip frames, mean ${(r.leanFracSum / Math.max(1, r.leanFrames) * 100).toFixed(1)} % of own ceiling, ` +
    `${pc(r.leanBelow, r.leanFrames)} below 95 %`);
  console.log(`LOITER  of COMBAT man-time: at cover ${pc(r.loiterCover, r.combatFrames)}, in the OPEN ${pc(r.loiterOpen, r.combatFrames)}`);
  console.log(`RANGE   ${pc(r.rangeRefused, r.contact)} of contact refused PURELY by distance`);
}

console.log(`\n═══ ALL SEEDS${TAG ? ` [${TAG}]` : ''} (${runs.map((r) => r.seed).join(',')}) — ${manMin.toFixed(1)} man-minutes ═══`);
console.log(`rounds       ${sum('rounds')}  (${(sum('rounds') / manMin).toFixed(1)}/man-min)`);
console.log(`  AIMED      ${pc(sum('aimed'), sum('rounds'))}   (${(sum('aimed') / manMin).toFixed(1)}/man-min)`);
console.log(`  MOVING     ${pc(sum('roundsMoving'), sum('rounds'))}  of all rounds; aimed+moving ${pc(sum('aimedMoving'), sum('rounds'))}`);
console.log(`contact      ${pc(sum('contact'), sum('alive'))} of alive man-time; prosecuted ${pc(sum('contactFiring'), sum('contact'))}`);
console.log(`LEAN         mean ${(sum('leanFracSum') / Math.max(1, sum('leanFrames')) * 100).toFixed(1)} % of own ceiling over ${sum('leanFrames')} frames; ` +
  `${pc(sum('leanBelow'), sum('leanFrames'))} of the lean is below 95 %`);
console.log(`travel       ${pc(sum('travelCeil'), sum('travel'))} at >=98 % of own ceiling; under 5 m/s ${pc(sum('travelSlow'), sum('travel'))}`);
console.log(`LOITER       cover ${pc(sum('loiterCover'), sum('combatFrames'))}  open ${pc(sum('loiterOpen'), sum('combatFrames'))}  of combat man-time`);
console.log(`RANGE GATE   ${pc(sum('rangeRefused'), sum('contact'))} of contact time refused purely by distance`);
const b = runs[0].buckets;
const cd = sumA('contactDist'); const rd = sumA('refusedDist');
console.log('  contact by distance (share, and share of THAT refused by range):');
for (let i = 0; i < b.length; i++) {
  if (!cd[i]) continue;
  const lo = i === 0 ? 0 : b[i - 1];
  const hi = b[i] > 1e8 ? '∞' : b[i];
  console.log(`    ${String(lo).padStart(4)}-${String(hi).padStart(4)} m  ${pc(cd[i], sum('contact')).padStart(7)}   refused ${pc(rd[i], cd[i])}`);
}
console.log(`pageerrors   ${sum('pageerrors')}`);
