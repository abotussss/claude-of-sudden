/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VOLUME OF FIRE, AND WHY THERE IS NOT MORE OF IT — one window, two questions
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node _encounter.mjs --url=… --seeds=7,11,19 [--warm=140] [--window=150]
 *
 * The brief has two items and they are one measurement:
 *
 *   1  「敵を見つけたときに撃て」 — WHICH GATE still holds the trigger up. The
 *      census is charged against the FIRST condition that refuses, in the order
 *      `Agent._combat` asks them, and it is reported twice: as a share of
 *      CONTACT samples (the classic reading, "of the men who have somebody,
 *      what stops them") and as a share of ALL live man-samples, because a
 *      census normalised to contact cannot see the gate that turns out to
 *      matter most — having nobody to shoot at.
 *
 *   2  「占領したエリアがあったら次の占領エリアへ行けよ そうすれば戦闘起きる」 — the
 *      ENCOUNTER DENSITY the first item's ceiling is made of. Man-samples
 *      standing inside a circle their side ALREADY OWNS and quiet (no enemy in
 *      it) are men generating no contact by construction; man-samples inside or
 *      walking at a circle their side does NOT own are the ones that produce a
 *      fight. Both are counted, per side, alongside contested-zone time and the
 *      zone flip rate.
 *
 * THE CLOCK. `Engine.step` clamps a raw frame and multiplies by `time.scale`,
 * and `Agent._shoot` fires at most one round per frame — so any scale above 1
 * caps every weapon on the map below its own rate and the rounds-per-man-minute
 * reading becomes an artefact of the harness. @see the header of `_sixaudit.mjs`,
 * which learned this the expensive way. The WARM-UP is run at scale 12 because
 * nothing is counted during it; the window itself is scale 1, always.
 *
 * The window starts at `--warm` seconds on purpose: the first minute of a match
 * is thirty men walking out of two spawns, which is 85 % ADVANCE whatever the
 * zone policy says, and measuring the policy during the walk-out measures the
 * walk-out.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4495/';
const SEEDS = String(args.seeds ?? args.seed ?? '7').split(',');
const WARM = +(args.warm ?? 140);
const WINDOW = +(args.window ?? 150);
const EVERY = +(args.every ?? 12);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const rows = [];
for (const seed of SEEDS) {
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(`${URL}?capture=1&seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

  const out = await page.evaluate(async ({ WARM, WINDOW, EVERY }) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const ai = e.ctx.peek('ai');
    e.input.frozen = true;
    e.input.enabled = false;
    e.ctx.peek('player')?.setControlEnabled?.(false);
    const frame = () => new Promise((r) => requestAnimationFrame(r));

    e.time.scale = 12;
    while (m.phase !== 'live') await frame();
    const t0 = m.roundClock;
    const t = () => t0 - m.roundClock;
    while (t() < WARM && m.phase === 'live') await frame();
    /* THE WINDOW IS SCALE 1. @see the header. */
    e.time.scale = 1;
    await frame(); await frame(); await frame();

    const S = {
      fires: 0, deaths: 0, hits: 0,
      alive: 0, withTarget: 0, visible: 0, firing: 0,
      gate: Object.create(null),
      gateContact: Object.create(null),
      state: Object.create(null),
      /* encounter density */
      inOwnedQuiet: 0, inOwnedContested: 0, inNotOurs: 0, outsideAll: 0,
      nearNotOurs: 0,
      zoneOwnersOverTime: [],
      flips: 0,
      ticks: 0,
      objMode: Object.create(null),
    };
    const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

    const fire0 = ai.onAgentFire.bind(ai);
    ai.onAgentFire = (a, o, d) => { S.fires++; return fire0(a, o, d); };
    const onDeath = () => S.deaths++;
    const onHit = () => S.hits++;
    e.ctx.events.on('actor:death', onDeath);
    e.ctx.events.on('damage:dealt', onHit);

    const zones = m.capture?.zones ?? [];
    let lastOwner = zones.map((z) => z.owner);
    const tStart = t();
    const gStart = e.time.elapsed;
    let i = 0;
    while (t() - tStart < WINDOW && m.phase === 'live' && m.roundClock > 0) {
      await frame();
      /* flips are watched every frame; the census is sampled. */
      for (let k = 0; k < zones.length; k++) {
        if (zones[k].owner !== lastOwner[k]) { S.flips++; lastOwner[k] = zones[k].owner; }
      }
      if (++i % EVERY) continue;
      S.ticks++;
      for (const a of ai.agents) {
        if (!a.alive) continue;
        S.alive++;
        bump(S.state, a.state);
        bump(S.objMode, a.objective?.mode ?? 'none');
        if (a.wantFire) S.firing++;

        /* ---- encounter density ------------------------------------- */
        let placed = false, nearNot = false;
        for (const z of zones) {
          const d = Math.hypot(a.position.x - z.position.x, a.position.z - z.position.z);
          const R = z.radius ?? 9;
          if (z.owner !== a.team && d < R * 3) nearNot = true;
          if (d >= R) continue;
          placed = true;
          if (z.owner !== a.team) S.inNotOurs++;
          else if (z.counts?.[1 - a.team] > 0) S.inOwnedContested++;
          else S.inOwnedQuiet++;
          break;
        }
        if (!placed) S.outsideAll++;
        if (nearNot) S.nearNotOurs++;

        /* ---- the trigger ladder, first refusal wins ----------------- */
        let why;
        if (!a.hasTarget) why = 'no target at all';
        else {
          S.withTarget++;
          if (a.targetVisible) S.visible++;
          const d = Math.hypot(a.position.x - a.lastKnown.x, a.position.y - a.lastKnown.y,
            a.position.z - a.lastKnown.z);
          if (a.wantFire) why = 'FIRING';
          else if (a.post) why = 'posted (going upstairs)';
          else if (a.working) why = 'working (cache / objective)';
          else if (a.state !== 'combat' && a.state !== 'suppressed') why = `not in combat (state=${a.state})`;
          else if (a.animator?.reloading) why = 'reloading';
          else if (a.dry) why = 'pouch empty';
          else if (a.ammo <= 0) why = 'magazine empty';
          else if (a.blindT > 0) why = 'flashed';
          else if (a.targetActor?.isVehicle === true) why = 'target is armour';
          else if (a.cover && a.position.distanceTo(a.coverPos) >= 0.85) why = 'walking to cover';
          else if (!a.peeking) why = 'ducked (peek duty cycle)';
          else if (!a.targetVisible) why = 'no line of sight';
          else if (d >= a.weaponRange) why = 'out of weapon range';
          else why = 'unexplained';
          bump(S.gateContact, why);
        }
        bump(S.gate, why);
      }
      if (S.zoneOwnersOverTime.length < 400)
        S.zoneOwnersOverTime.push(zones.map((z) => z.owner).join(''));
    }
    const gameSeconds = e.time.elapsed - gStart;
    ai.onAgentFire = fire0;
    e.ctx.events.off?.('actor:death', onDeath);
    e.ctx.events.off?.('damage:dealt', onHit);

    const meanAlive = S.alive / Math.max(1, S.ticks);
    return {
      seed: e.levelSeed, tStart: +tStart.toFixed(1), tEnd: +t().toFixed(1),
      gameSeconds: +gameSeconds.toFixed(1), phase: m.phase, score: m.score.slice(),
      fires: S.fires, deaths: S.deaths, hits: S.hits,
      meanAlive: +meanAlive.toFixed(1),
      roundsPerManMinute: +(S.fires / (gameSeconds / 60) / Math.max(1, meanAlive)).toFixed(1),
      deathsPerMinute: +(S.deaths / (gameSeconds / 60)).toFixed(1),
      withTargetShare: +(S.withTarget / Math.max(1, S.alive)).toFixed(3),
      visibleOfContact: +(S.visible / Math.max(1, S.withTarget)).toFixed(3),
      firingShare: +(S.firing / Math.max(1, S.alive)).toFixed(3),
      manSamples: S.alive, contactSamples: S.withTarget,
      gate: S.gate, gateContact: S.gateContact, state: S.state, objMode: S.objMode,
      density: {
        inNotOurs: S.inNotOurs, inOwnedContested: S.inOwnedContested,
        inOwnedQuiet: S.inOwnedQuiet, outsideAll: S.outsideAll, nearNotOurs: S.nearNotOurs,
      },
      flips: S.flips,
      owners: S.zoneOwnersOverTime[S.zoneOwnersOverTime.length - 1] ?? '',
    };
  }, { WARM, WINDOW, EVERY });

  out.pageerrors = errs.slice(0, 4);
  rows.push(out);
  await page.close();
  console.error(`  … seed ${seed} done (${out.roundsPerManMinute} rounds/man-min)`);
}
await browser.close();

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1).padStart(5) + '%' : '    —');
const show = (o, total) => Object.entries(o).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `      ${String(v).padStart(7)} ${pct(v, total)}  ${k}`).join('\n');

for (const r of rows) {
  console.log(`\n════ seed ${r.seed} · window ${r.tStart}s→${r.tEnd}s (${r.gameSeconds}s of game) · phase ${r.phase} · score ${r.score.join('-')} · zones ${r.owners}`);
  console.log(`  ROUNDS/MAN-MINUTE ${r.roundsPerManMinute}   (fires ${r.fires}, mean alive ${r.meanAlive})`);
  console.log(`  deaths/min ${r.deathsPerMinute} · hits ${r.hits} · zone flips ${r.flips}`);
  console.log(`  with a target ${(r.withTargetShare * 100).toFixed(1)}% of man-samples · of those, a clear line ${(r.visibleOfContact * 100).toFixed(1)}% · trigger up ${(r.firingShare * 100).toFixed(1)}%`);
  console.log(`  STATE: ${Object.entries(r.state).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, r.manSamples).trim()}`).join(' · ')}`);
  console.log(`  ORDERS: ${Object.entries(r.objMode).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, r.manSamples).trim()}`).join(' · ')}`);
  console.log(`  ── WHY NOT SHOOTING, of ALL ${r.manSamples} live man-samples`);
  console.log(show(r.gate, r.manSamples));
  console.log(`  ── …and of the ${r.contactSamples} CONTACT samples only`);
  console.log(show(r.gateContact, r.contactSamples));
  const d = r.density;
  console.log(`  ── ENCOUNTER DENSITY (man-samples)`);
  console.log(`      inside a circle we do NOT own   ${String(d.inNotOurs).padStart(7)} ${pct(d.inNotOurs, r.manSamples)}`);
  console.log(`      inside OUR circle, enemy in it  ${String(d.inOwnedContested).padStart(7)} ${pct(d.inOwnedContested, r.manSamples)}`);
  console.log(`      inside OUR circle, QUIET        ${String(d.inOwnedQuiet).padStart(7)} ${pct(d.inOwnedQuiet, r.manSamples)}   <- generating nothing`);
  console.log(`      outside every circle            ${String(d.outsideAll).padStart(7)} ${pct(d.outsideAll, r.manSamples)}`);
  console.log(`      within 3R of a circle not ours  ${String(d.nearNotOurs).padStart(7)} ${pct(d.nearNotOurs, r.manSamples)}`);
  if (r.pageerrors.length) console.log(`  [pageerror] ${r.pageerrors.join(' | ')}`);
}
const mean = (k) => (rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(1);
const meanD = (k) => (rows.reduce((a, r) => a + r.density[k] / r.manSamples, 0) / rows.length * 100).toFixed(1);
console.log(`\n════ MEAN over ${rows.length} seeds`);
console.log(`  ROUNDS/MAN-MINUTE ${mean('roundsPerManMinute')} · deaths/min ${mean('deathsPerMinute')} · flips ${mean('flips')}`);
console.log(`  with a target ${(rows.reduce((a, r) => a + r.withTargetShare, 0) / rows.length * 100).toFixed(1)}%` +
  ` · quiet-owned-circle time ${meanD('inOwnedQuiet')}% · in a circle not ours ${meanD('inNotOurs')}%`);
