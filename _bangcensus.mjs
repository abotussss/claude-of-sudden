/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DO BOTS THROW FLASHBANGS AND SMOKE? — and if not, WHICH GATE REFUSED IT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node _bangcensus.mjs <url> <seed> [seconds]
 *
 * Two numbers, not one opinion:
 *
 *   THE THROWS. Every `AiSystem.throwGrenade` in the match, by kind, by team,
 *   with the thrower's reason (assault verb / contested / pinned / crossing),
 *   the range and the clock. If this comes back "12 flashes a match" we are
 *   done and the feature is confirmed.
 *
 *   THE REFUSALS. `_maybeFlash` and `_maybeSmoke` are a ladder of early
 *   returns and every one of them is silent. This re-evaluates the SAME ladder
 *   on the SAME arguments immediately before the real call, in order, and
 *   charges the sample to the FIRST condition that would refuse it — which is
 *   the same census that found "46.8 % of contact time is a man walking to
 *   cover with his weapon down" for the shooting gate. Percentages are of
 *   candidate-samples, i.e. of every frame a man was in `_combat` far enough
 *   in to be asked the question at all.
 *
 * The constants are duplicated here on purpose — they are module-private in
 * agent.js and this must not import across a subsystem boundary. They are
 * asserted against observed behaviour by the `THROWN` rows: a throw the census
 * predicted would be refused, or vice versa, shows up as a mismatch count.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4495/';
const SEED = process.argv[3] ?? '11';
const SECS = Number(process.argv[4] ?? 420);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const res = await page.evaluate(async (SECS) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.time.scale = 12;
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  const t0 = m.roundClock;
  const t = () => +(t0 - m.roundClock).toFixed(1);

  /* Constants copied from agent.js (module-private there). */
  const FLASH_LO = 6, FLASH_HI = 22, SMOKE_MIN = 22, SITE_HOLD_R = 9;

  const proto = Object.getPrototypeOf(ai.agents[0]);

  const mk = () => Object.create(null);
  const flashGates = mk(), smokeGates = mk();
  const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

  let flashCalls = 0, smokeCalls = 0;
  /** men who were asked at least once, and men who ever passed everything */
  const askedFlash = new Set(), passFlash = new Set();
  const askedSmoke = new Set(), passSmoke = new Set();
  /** distance histogram for the samples that died ON the range gate */
  const flashDistBad = [], smokeDistBad = [];
  /** how close the near-misses got: samples that passed all but the last gate */
  let flashSquadRefused = 0, smokeSquadRefused = 0;

  const f0 = proto._maybeFlash, s0 = proto._maybeSmoke;

  proto._maybeFlash = function (target, dist, armour, sq) {
    flashCalls++;
    askedFlash.add(this.id);
    let why = null;
    if (!this.hasFlash) why = 'stock spent (hasFlash false)';
    else if (armour) why = 'target is armour';
    else if (this.flashCooldown > 0) why = 'own cooldown';
    else if (dist < FLASH_LO) why = 'too close (<6 m)';
    else if (dist > FLASH_HI) why = 'too far (>22 m)';
    else if (this.lastKnownAge > 1.5) why = 'contact stale (>1.5 s)';
    else if (this.traits.aggression < 0.5) why = 'aggression < 0.5';
    else {
      const mode = this.objective?.mode;
      const assaulting = mode === 'push' || mode === 'defuse' || mode === 'retake' || mode === 'plant';
      const contested = this.objective?.site != null
        && this.position.distanceTo(this.objective.position) < SITE_HOLD_R;
      if (!assaulting && !contested) why = 'no reason: not assaulting, not contested';
      else if (sq && sq.flashCooldown > 0) { why = 'squad ration'; flashSquadRefused++; }
    }
    if (why) {
      bump(flashGates, why);
      if (why.startsWith('too ')) flashDistBad.push(Math.round(dist));
    } else { passFlash.add(this.id); bump(flashGates, 'PASSED'); }
    return f0.call(this, target, dist, armour, sq);
  };

  proto._maybeSmoke = function (target, dist, armour, sq) {
    smokeCalls++;
    askedSmoke.add(this.id);
    let why = null;
    if (!this.hasSmoke) why = 'stock spent (hasSmoke false)';
    else if (this.smokeCooldown > 0) why = 'own cooldown';
    else if (dist < SMOKE_MIN) why = 'too close (<22 m)';
    else if (this.lastKnownAge > 2.5) why = 'contact stale (>2.5 s)';
    else {
      const pinned = this.suppression > 0.75;
      const obj = this.objective?.position;
      const crossing = obj != null && this.position.distanceTo(obj) > dist * 0.8;
      if (!pinned && !crossing) why = 'not pinned, not crossing';
      else if (sq && sq.screenCooldown > 0) { why = 'squad ration'; smokeSquadRefused++; }
    }
    if (why) {
      bump(smokeGates, why);
      if (why.startsWith('too ')) smokeDistBad.push(Math.round(dist));
    } else { passSmoke.add(this.id); bump(smokeGates, 'PASSED'); }
    return s0.call(this, target, dist, armour, sq);
  };

  /* ---- the throws themselves ------------------------------------------ */
  const throws = [];
  const tg0 = ai.throwGrenade.bind(ai);
  ai.throwGrenade = (agent, from, target, kind = 'frag') => {
    const mode = agent.objective?.mode ?? null;
    throws.push({
      t: t(), kind, team: agent.team, id: agent.id,
      role: agent.role ?? agent.archetype ?? '?',
      dist: +agent.position.distanceTo(target).toFixed(1),
      mode,
      supp: +(agent.suppression ?? 0).toFixed(2),
      squad: !!agent.squad,
      elite: !!agent.elite,
    });
    return tg0(agent, from, target, kind);
  };

  /* ---- the detonations, off the shared events -------------------------- */
  const det = { flash: 0, smoke: 0 };
  e.ctx.events.on('weapon:flash', () => det.flash++);
  e.ctx.events.on('weapon:smoke', () => det.smoke++);

  /* ---- population facts ------------------------------------------------ */
  const snapshot = () => {
    let n = 0, sq = 0, withFlash = 0, withSmoke = 0, withFrag = 0, aggr = 0, aggrHi = 0;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      n++;
      if (a.squad) sq++;
      if (a.hasFlash) withFlash++;
      if (a.hasSmoke) withSmoke++;
      if (a.hasGrenade) withFrag++;
      aggr += a.traits?.aggression ?? 0;
      if ((a.traits?.aggression ?? 0) >= 0.5) aggrHi++;
    }
    return { n, sq, withFlash, withSmoke, withFrag, aggrMean: n ? +(aggr / n).toFixed(3) : 0, aggrHi };
  };
  const popStart = snapshot();

  /* objective mode histogram over the same samples, because "no reason" is
   * the gate most likely to hold everything up and the verbs are the reason. */
  const modeHist = mk();
  let modeSamples = 0;

  const start = performance.now();
  while (performance.now() - start < 900000) {
    await new Promise((r) => requestAnimationFrame(r));
    if (t() > SECS) break;
    if (m.phase !== 'live' || m.roundClock <= 0) break;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      modeSamples++;
      bump(modeHist, a.objective?.mode ?? 'none');
    }
  }

  proto._maybeFlash = f0;
  proto._maybeSmoke = s0;

  return {
    seed: e.levelSeed, end: t(), phase: m.phase, score: m.score.slice(),
    popStart, popEnd: snapshot(),
    flashCalls, smokeCalls,
    flashGates, smokeGates,
    askedFlash: askedFlash.size, passFlash: passFlash.size,
    askedSmoke: askedSmoke.size, passSmoke: passSmoke.size,
    flashSquadRefused, smokeSquadRefused,
    flashDistBad: flashDistBad.slice(0, 4000), smokeDistBad: smokeDistBad.slice(0, 4000),
    throws, det, modeHist, modeSamples,
    agentsTotal: ai.agents.length,
  };
}, SECS);

const T = ['RED', 'BLUE'];
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + '%' : '—');
const table = (o, total) =>
  Object.entries(o).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `      ${String(v).padStart(7)}  ${pct(v, total).padStart(6)}  ${k}`)
    .join('\n');

console.log(`\n=== seed ${res.seed} · ${res.end}s of match · phase "${res.phase}" · score ${res.score.join('-')}`);
console.log(`    agents ${res.agentsTotal} · alive at start ${res.popStart.n} (in a squad ${res.popStart.sq}) · at end ${res.popEnd.n} (squad ${res.popEnd.sq})`);
console.log(`    aggression >= 0.5 (the flash's trait gate): ${res.popStart.aggrHi}/${res.popStart.n} men, mean ${res.popStart.aggrMean}`);
console.log(`    pouches at end: flash ${res.popEnd.withFlash}/${res.popEnd.n} unspent · smoke ${res.popEnd.withSmoke}/${res.popEnd.n} · frag ${res.popEnd.withFrag}/${res.popEnd.n}`);

const byKind = { frag: 0, flash: 0, smoke: 0 };
const byKindTeam = { frag: [0, 0], flash: [0, 0], smoke: [0, 0] };
for (const x of res.throws) { byKind[x.kind]++; byKindTeam[x.kind][x.team]++; }
console.log(`\n=== THROWS (${res.throws.length} total in ${res.end}s)`);
for (const k of ['frag', 'flash', 'smoke'])
  console.log(`    ${k.padEnd(6)} ${String(byKind[k]).padStart(4)}   RED ${byKindTeam[k][0]} / BLUE ${byKindTeam[k][1]}   detonations seen: ${k === 'frag' ? '(explosion)' : res.det[k]}`);
for (const x of res.throws.filter((y) => y.kind !== 'frag').slice(0, 40))
  console.log(`      ${x.kind.padEnd(5)} t=${String(x.t).padStart(6)}s ${T[x.team]} #${x.id} ${String(x.role).padEnd(9)} d=${String(x.dist).padStart(5)}m mode=${x.mode ?? 'none'} supp=${x.supp}${x.squad ? '' : ' NO-SQUAD'}${x.elite ? ' ELITE' : ''}`);

console.log(`\n=== FLASH GATE CENSUS — ${res.flashCalls} candidate-samples, ${res.askedFlash} distinct men asked, ${res.passFlash} ever passed`);
console.log(table(res.flashGates, res.flashCalls));
if (res.flashDistBad.length) {
  const s = res.flashDistBad.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  console.log(`      range-refused distances: p10 ${q(0.1)} m · median ${q(0.5)} m · p90 ${q(0.9)} m`);
}
console.log(`\n=== SMOKE GATE CENSUS — ${res.smokeCalls} candidate-samples, ${res.askedSmoke} distinct men asked, ${res.passSmoke} ever passed`);
console.log(table(res.smokeGates, res.smokeCalls));
if (res.smokeDistBad.length) {
  const s = res.smokeDistBad.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  console.log(`      range-refused distances: p10 ${q(0.1)} m · median ${q(0.5)} m · p90 ${q(0.9)} m`);
}

console.log(`\n=== OBJECTIVE VERBS over ${res.modeSamples} alive-man-samples (the flash's "reason" gate reads these)`);
console.log(table(res.modeHist, res.modeSamples));
console.log(errs.length ? `\n[pageerror] ${errs.slice(0, 3).join(' | ')}` : '\n[pageerror] none');
await b.close();
