/**
 * ════════════════════════════════════════════════════════════════════════════
 * DOES THE INFANTRY FIGHT THE TANK, AND DOES THE TANK SURVIVE IT
 * ════════════════════════════════════════════════════════════════════════════
 * The defect this measures was measured before it was fixed: `hostilesOf` built
 * its list from `ai.agents` plus the local player, a tank is not an `Agent`, and
 * `Agent.target` only ever comes from that list — so a tank appeared in a
 * hostile list 0 times, a bot aimed at one 0 times across 273-321 man-samples
 * inside `RULES.tankRange`, the `deck` damage column was 0 in every row of every
 * match, and in 3 of 4 matches NEITHER HULL WAS EVER DESTROYED while scoring
 * 12-27 kills each.
 *
 * So this run answers, per hull, exactly the questions that report could not:
 *
 *   life        seconds from `rolling` to `dead`, or to the end of the match
 *   fate        what actually killed it, by name
 *   aimed       man-samples with this hull as `targetActor`, and how many of
 *               those were cleared to FIRE (`armourWorth === 1`) rather than
 *               only to throw — the two halves of the engagement policy
 *   rounds      damage events by PART, as counts and as damage
 *   frags       grenades that went off on it, and what they were worth
 *   kills       its own, because "dangerous and killable" is two numbers
 *
 * `?onewound=1` flips `Armour.oneWoundPerRound`, which is the diagnosed
 * triple-count fix. It is OFF in the shipped build and this is how both columns
 * of the report are produced.
 *
 *   node _tankfight.mjs [url] [seed] [scale] [onewound]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4335/';
const SEED = process.argv[3] ?? '12';
const SCALE = Number(process.argv[4] ?? 8);
const ONEWOUND = process.argv[5] === '1';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}${ONEWOUND ? '&onewound=1' : ''}`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const res = await page.evaluate(async (SCALE) => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const m = ctx.peek('match');
  const ai = ctx.peek('ai');
  const w = ctx.peek('world');
  const a = m.tank;
  e.input.frozen = true;
  e.input.enabled = false;
  ctx.peek('player')?.setControlEnabled?.(false);
  e.time.scale = SCALE;

  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  const t0 = ctx.time.elapsed;

  const rec = new Map(); // tank id -> row
  const row = (t) => {
    let r = rec.get(t.id);
    if (!r) {
      r = {
        id: t.id, team: t.team, sorties: 0, rolledAt: null, diedAt: null,
        life: 0, fate: null, health: t.health,
        aimed: 0, aimedFire: 0, aimedFrag: 0, listed: 0,
        menInRange: 0, samples: 0,
        // WHY the men who did not engage did not: the policy gate and the
        // perception gate are different failures and have different fixes.
        worth1: 0, worth2: 0, worthLos: 0, near26: 0, astern: 0,
        in40: 0, los40: 0, losAll: 0, inView: 0,
        nHull: 0, nTurret: 0, nDeck: 0, dHull: 0, dTurret: 0, dDeck: 0,
        rounds: 0, roundDmg: 0, dupes: 0,
        frags: 0, fragDmg: 0, blasts: 0, blastDmg: 0,
        kills: 0, razed: 0, breaches: 0,
      };
      rec.set(t.id, r);
    }
    return r;
  };
  // Carry the stats off a hull the frame BEFORE they are reset by the next
  // sortie, and off a dead one before the wreck is put away.
  const snap = (t) => {
    const r = row(t);
    const s = t.stats;
    r.nHull = s.nHull; r.nTurret = s.nTurret; r.nDeck = s.nDeck;
    r.dHull = s.hull; r.dTurret = s.turret; r.dDeck = s.deck;
    r.rounds = s.rounds; r.roundDmg = s.roundDmg; r.dupes = s.dupes;
    r.frags = s.frags; r.fragDmg = s.fragDmg;
    r.blasts = s.blasts; r.blastDmg = s.blastDmg;
    r.kills = s.kills; r.razed = s.razed; r.breaches = s.breaches ?? 0;
    r.health = t.health;
    r.life = s.liveT;
  };

  const offKill = ctx.events.on('match:tank', (ev) => {
    const t = a.tanks.find((x) => x.id === ev.id);
    if (!t) return;
    const r = row(t);
    if (ev.phase === 'rolling') { r.sorties++; r.rolledAt = ctx.time.elapsed - t0; }
    if (ev.phase === 'dead') {
      r.diedAt = ctx.time.elapsed - t0;
      r.fate = t.lastHitBy?.name ?? (t.lastHitBy ? 'an actor' : 'the environment');
      snap(t);
    }
  });

  const breaches0 = (w.breaches ?? []).length;
  let breachedEver = 0;

  /* ---- the run -------------------------------------------------------- */
  let guard = 0;
  while (m.phase !== 'over' && guard < 60000) {
    await new Promise((r) => requestAnimationFrame(r));
    guard++;
    for (const t of a.tanks) {
      if (!t.alive) continue;
      const r = row(t);
      snap(t);
      r.samples++;
      // WHO CAN SEE IT, and what they are cleared to do about it. `hostilesOf`
      // is rebuilt at most once a frame, so reading it here is free.
      const foe = t.team === 1 ? 0 : 1;
      const list = ai.hostilesOf(foe);
      if (list.includes(t)) r.listed++;
      for (const g of ai.agents) {
        if (!g.alive || g.team === t.team) continue;
        const d = Math.hypot(g.position.x - t.position.x, g.position.z - t.position.z);
        if (d < 85) r.menInRange++;
        if (d < 85) {
          const wv = ai.armourWorth(g, t);
          if (wv === 1) r.worth1++;
          else if (wv === 2) r.worth2++;
          if (d > 7.5 && d < 26) r.near26++;
          const s = Math.sin(t.yaw), c = Math.cos(t.yaw);
          const fz = (g.position.x - t.position.x) * s + (g.position.z - t.position.z) * c;
          if (fz < -3.4) r.astern++;
          const phys = ctx.peek('physics');
          const eye = { x: g.position.x, y: g.position.y + g.eyeHeight, z: g.position.z };
          const los = phys.lineOfSight(eye, t.aimPoint, phys.MASK.SIGHT);
          if (los) r.losAll++;
          if (los && d < g.viewRange) r.inView++;
          if (d < 40) { r.in40++; if (los) r.los40++; }
          if (wv > 0 && los) r.worthLos++;
        }
        if (g.targetActor === t) {
          r.aimed++;
          if (g.armourWorth === 1) r.aimedFire++;
          else if (g.armourWorth === 2) r.aimedFrag++;
        }
      }
    }
    for (const br of w.breaches ?? []) if (br.down) breachedEver = 1;
  }
  offKill?.();

  for (const t of a.tanks) if (!rec.has(t.id)) row(t);
  for (const t of a.tanks) if (t.state !== 'dead') snap(t);

  return {
    length: ctx.time.elapsed - t0,
    score: m.capture?.score ?? null,
    rows: [...rec.values()],
    breaches0,
    breachedEver,
    breachOpenAtEnd: (w.breaches ?? []).filter((x) => x.down).length,
    oneWound: a.oneWoundPerRound,
  };
}, SCALE);

const f = (n, d = 0) => (n === null || n === undefined ? '—' : n.toFixed(d));
console.log(`\n=== seed ${SEED} @${SCALE}x  oneWoundPerRound=${res.oneWound} ===`);
console.log(`match ${f(res.length, 1)} s · score ${res.score?.join('-') ?? '?'}`);
for (const r of res.rows) {
  const seen = r.samples ? ((r.listed / r.samples) * 100).toFixed(0) : '0';
  console.log(
    `\n  ${r.id} (team ${r.team})  ${r.sorties} sortie(s), alive ${f(r.life, 0)} s, ` +
      `${r.diedAt !== null ? `DESTROYED at T+${f(r.diedAt, 0)} by ${r.fate}` : `SURVIVED on ${f(r.health, 0)} hp`}`
  );
  console.log(
    `      listed as a hostile in ${seen}% of its live frames · ` +
      `${r.menInRange} man-samples inside 85 m`
  );
  console.log(
    `      of those: ${r.astern} astern of it, ${r.near26} in frag range, ` +
      `${r.worth1} with a DECK shot, ${r.worth2} frag-only, ${r.worthLos} of those with LOS`
  );
  console.log(
    `      LOS to the deck: ${r.losAll}/${r.menInRange} in range, ${r.los40}/${r.in40} inside 40 m, ` +
      `${r.inView} of them inside their own viewRange`
  );
  console.log(
    `      AIMED AT by ${r.aimed} man-samples — ${r.aimedFire} cleared to fire (deck), ` +
      `${r.aimedFrag} to frag only`
  );
  console.log(
    `      rounds ${r.rounds} for ${f(r.roundDmg)}  ·  ` +
      `hull ${r.nHull}r/${f(r.dHull)}  turret ${r.nTurret}r/${f(r.dTurret)}  ` +
      `deck ${r.nDeck}r/${f(r.dDeck)}` + (r.dupes ? `  (+${r.dupes} dupes dropped)` : '')
  );
  console.log(
    `      frags ${r.frags} for ${f(r.fragDmg)}  ·  blasts ${r.blasts} for ${f(r.blastDmg)}  ·  ` +
      `ITS OWN KILLS ${r.kills}  ·  ${r.razed} props, ${r.breaches} walls`
  );
}
console.log(
  `\n  breachable walls ${res.breaches0} · any opened this match: ${res.breachedEver ? 'YES' : 'no'} · ` +
    `open at the end: ${res.breachOpenAtEnd}`
);
if (errs.length) console.log('\nPAGEERRORS:', errs);
else console.log('\npageerror: none');
await b.close();
