/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TEN MEN NOBODY HAS EVER WATCHED — what the elite half actually does
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node _elitewatch.mjs <url> <seed> [maxSeconds]
 *
 * `_reinaudit.mjs` already proved the DROP: it fires, for the trailing side,
 * ten men land, `noRespawn` is true on all of them, and the life guard refuses
 * a sortie the match cannot outlive. None of that is re-litigated here. What is
 * unproven is everything that happens AFTER the boots are down, and each of the
 * five claims gets its own number:
 *
 *   HEALTH 200        `maxHealth` and `health` off every one of the ten at the
 *                     instant of landing, against a control sample of the
 *                     ordinary men on the same side at the same instant.
 *   A SHUFFLED DECK   the ten `weapon` ids. A DEAL gives ten distinct-ish guns
 *                     in the composition `eliteArms()` describes; ten
 *                     independent draws give duplicates and holes. Reported as
 *                     the multiset, so "six AKs and no sniper" is visible.
 *   A UNIT WITH ITS   the fireteams the ten are cut into, once a second: are
 *   OWN LANE          they pure (no conscript in an elite team), do they have
 *                     `laneIndex >= 1`, and how tight is the stick — mean
 *                     distance to their own fireteam centroid, against the same
 *                     figure for the ordinary fireteams of the same side.
 *   TANK AVOIDANCE    two halves, because the refusal and the walk are two
 *                     mechanisms. `armourWorth` is called for real and its
 *                     return recorded per elite/tank pair in range; and
 *                     `_tankDodge` is wrapped so every via point it plans (and
 *                     every time it declines to) is counted. Plus the ground
 *                     truth: how close an elite ever gets to a live hull,
 *                     against how close the ordinary men get.
 *   DRONES            how many samples an elite's chosen target IS a drone,
 *                     and how many drone kills the ten take.
 *
 * The wrappers are installed on the prototype BEFORE the drop and removed at
 * the end. Nothing is written back into the sim.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4495/';
const SEED = process.argv[3] ?? '11';
const MAXS = Number(process.argv[4] ?? 900);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const res = await page.evaluate(async (MAXS) => {
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

  const R = m.reinforce;
  const proto = Object.getPrototypeOf(ai.agents[0]);

  /* ---- 1. TANK DODGE, counted at the point of decision ----------------- */
  const dodge = { called: 0, planned: 0, declined: 0, byId: Object.create(null) };
  const td0 = proto._tankDodge;
  proto._tankDodge = function (dest) {
    const out = td0.call(this, dest);
    if (this.elite === true) {
      dodge.called++;
      if (out) { dodge.planned++; dodge.byId[this.id] = (dodge.byId[this.id] ?? 0) + 1; }
      else dodge.declined++;
    }
    return out;
  };

  /* ---- 2. armourWorth, on the real calls ------------------------------- */
  const worth = { elite: Object.create(null), other: Object.create(null) };
  const aw0 = ai.armourWorth.bind(ai);
  ai.armourWorth = (agent, v) => {
    const out = aw0(agent, v);
    const bucket = agent?.elite === true ? worth.elite : worth.other;
    bucket[out] = (bucket[out] ?? 0) + 1;
    return out;
  };

  /* ---- 3. the drop ----------------------------------------------------- */
  const elites = [];
  let dropT = -1, dropTeam = -1;
  const landSnap = [];
  const controlSnap = [];
  const land0 = R.onLand;
  R.onLand = (i, p, yaw) => {
    const n0 = m.roster.length;
    land0(i, p, yaw);
    if (m.roster.length <= n0) return;
    const rec = m.roster[m.roster.length - 1];
    const a = rec.actor;
    if (!a) return;
    if (dropT < 0) {
      dropT = t();
      dropTeam = rec.team;
      /** THE CONTROL: the ordinary men of the same side, at this same instant. */
      for (const o of ai.agents) {
        if (!o.alive || o.team !== rec.team || o.elite === true) continue;
        controlSnap.push({ hp: o.health, max: o.maxHealth, weapon: o.weaponId ?? o.persona?.weapon ?? '?', skill: +(o.skill ?? 0).toFixed(2) });
      }
    }
    elites.push(a);
    a.__k0 = a.kills ?? 0;
    landSnap.push({
      i,
      id: a.id,
      name: rec.name,
      team: rec.team,
      elite: a.elite === true,
      archetype: a.archetype ?? a.persona?.archetype ?? '?',
      weapon: a.weaponId ?? a.persona?.weapon ?? '?',
      skill: +(a.skill ?? 0).toFixed(3),
      hp: a.health,
      max: a.maxHealth,
      spread: +(a.spread ?? 0).toFixed(4),
      viewRange: +(a.viewRange ?? 0).toFixed(1),
      weaponRange: +(a.weaponRange ?? 0).toFixed(1),
      reserve: a.reserve,
      noRespawn: rec.noRespawn,
    });
  };

  /* ---- 4. the watch ---------------------------------------------------- */
  const S = {
    samples: 0,
    ftPure: 0, ftMixed: 0, ftSeen: 0,
    laneHist: Object.create(null),
    eliteFtSpread: [], otherFtSpread: [],
    eliteTankMin: Infinity, otherTankMin: Infinity,
    eliteInTankR: 0, eliteTankSamples: 0,
    otherInTankR: 0, otherTankSamples: 0,
    droneTargetSamples: 0, eliteAliveSamples: 0,
    tanksLiveSamples: 0,
    objHist: Object.create(null),
    /** distance of each elite to the centroid of ALL living elites */
    stickSpread: [],
    aliveOverTime: [],
  };
  const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  const ELITE_TANK_R = 34;

  let nextSample = 0;
  const start = performance.now();
  while (performance.now() - start < 1500000) {
    await new Promise((r) => requestAnimationFrame(r));
    if (m.phase !== 'live' || m.roundClock <= 0) break;
    if (t() > MAXS) break;
    if (dropT < 0) continue;
    if (e.time.elapsed < nextSample) continue;
    nextSample = e.time.elapsed + 1;
    S.samples++;

    const live = elites.filter((a) => a.alive && !a.dead);
    S.aliveOverTime.push([t(), live.length]);
    if (!live.length) continue;

    /* fireteam purity / lane / tightness */
    const sq = m._squads?.[dropTeam];
    if (sq) {
      for (const ft of sq.fireteams) {
        if (!ft.members.length) continue;
        S.ftSeen++;
        const nE = ft.members.filter((x) => x.elite === true).length;
        let d = 0;
        for (const x of ft.members) d += Math.hypot(x.position.x - ft.centre.x, x.position.z - ft.centre.z);
        d /= ft.members.length;
        if (nE === ft.members.length) {
          S.ftPure++;
          S.eliteFtSpread.push(+d.toFixed(1));
          bump(S.laneHist, `elite lane ${ft.laneIndex}`);
        } else if (nE > 0) {
          S.ftMixed++;
          bump(S.laneHist, `MIXED lane ${ft.laneIndex}`);
        } else {
          S.otherFtSpread.push(+d.toFixed(1));
        }
      }
    }

    /* the stick: mean distance to the centroid of the ten */
    let cx = 0, cz = 0;
    for (const a of live) { cx += a.position.x; cz += a.position.z; }
    cx /= live.length; cz /= live.length;
    let sp = 0;
    for (const a of live) sp += Math.hypot(a.position.x - cx, a.position.z - cz);
    S.stickSpread.push(+(sp / live.length).toFixed(1));

    /* tanks */
    const veh = (ai.vehicles ?? []).filter((v) => v && v.alive === true);
    if (veh.length) {
      S.tanksLiveSamples++;
      for (const a of live) {
        let mn = Infinity;
        for (const v of veh) {
          if (v.team === a.team) continue;
          mn = Math.min(mn, Math.hypot(v.position.x - a.position.x, v.position.z - a.position.z));
        }
        if (mn < Infinity) {
          S.eliteTankSamples++;
          if (mn < S.eliteTankMin) S.eliteTankMin = mn;
          if (mn < ELITE_TANK_R) S.eliteInTankR++;
        }
      }
      for (const a of ai.agents) {
        if (!a.alive || a.elite === true || a.team !== dropTeam) continue;
        let mn = Infinity;
        for (const v of veh) {
          if (v.team === a.team) continue;
          mn = Math.min(mn, Math.hypot(v.position.x - a.position.x, v.position.z - a.position.z));
        }
        if (mn < Infinity) {
          S.otherTankSamples++;
          if (mn < S.otherTankMin) S.otherTankMin = mn;
          if (mn < ELITE_TANK_R) S.otherInTankR++;
        }
      }
    }

    /* drones + objectives */
    for (const a of live) {
      S.eliteAliveSamples++;
      if (a.targetActor && ai.isDrone?.(a.targetActor)) S.droneTargetSamples++;
      else if (a.targetActor && ai._droneSet?.has?.(a.targetActor)) S.droneTargetSamples++;
      bump(S.objHist, a.objective?.mode ?? 'none');
    }
  }

  proto._tankDodge = td0;
  ai.armourWorth = aw0;

  const finals = elites.map((a) => ({
    id: a.id, alive: !!a.alive, hp: +(a.health ?? 0).toFixed(0), max: a.maxHealth,
    kills: (a.kills ?? 0) - (a.__k0 ?? 0),
  }));
  const rein = m.roster.filter((r) => r.reinforcement);
  return {
    seed: e.levelSeed, end: t(), phase: m.phase, score: m.score.slice(),
    stats: JSON.parse(JSON.stringify(m.reinforceStats)),
    dropT, dropTeam,
    landSnap, controlSnap: controlSnap.slice(0, 40),
    S: {
      ...S,
      eliteTankMin: S.eliteTankMin === Infinity ? -1 : +S.eliteTankMin.toFixed(1),
      otherTankMin: S.otherTankMin === Infinity ? -1 : +S.otherTankMin.toFixed(1),
      stickSpread: S.stickSpread.slice(0, 2000),
      eliteFtSpread: S.eliteFtSpread.slice(0, 4000),
      otherFtSpread: S.otherFtSpread.slice(0, 4000),
      aliveOverTime: S.aliveOverTime.filter((_, i) => i % 5 === 0),
    },
    dodge, worth, finals,
    reinKills: rein.reduce((a, r) => a + r.kills, 0),
    reinDeaths: rein.reduce((a, r) => a + r.deaths, 0),
    reinAlive: rein.filter((r) => r.alive).length,
    reinN: rein.length,
  };
}, MAXS);

const T = ['RED', 'BLUE'];
const mean = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : -1);
const tally = (arr, k) => {
  const o = {};
  for (const x of arr) o[x[k]] = (o[x[k]] ?? 0) + 1;
  return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a}x${n}`).join(' ');
};

console.log(`\n=== seed ${res.seed} · ran ${res.end}s · phase "${res.phase}" · score ${res.score.join('-')}`);
console.log(`    reinforceStats: calls ${res.stats.calls} · windows R/B ${res.stats.windows.join('/')} · landed ${res.stats.landed.join('/')} · refused-late ${res.stats.late}`);
if (res.dropT < 0) {
  console.log('    NO DROP IN THIS MATCH — nothing below is measurable.');
} else {
  console.log(`    DROP at t=${res.dropT}s for ${T[res.dropTeam]} · ${res.landSnap.length} men landed · watched ${res.S.samples} one-second samples`);

  console.log(`\n=== 1. HEALTH 200 · SKILL · CONE`);
  console.log(`    elite  maxHealth: ${tally(res.landSnap, 'max')}   health at landing: ${tally(res.landSnap, 'hp')}`);
  console.log(`    elite  skill ${mean(res.landSnap.map((x) => x.skill))} (${Math.min(...res.landSnap.map((x) => x.skill))}..${Math.max(...res.landSnap.map((x) => x.skill))}) · archetype ${tally(res.landSnap, 'archetype')}`);
  console.log(`    elite  spread ${mean(res.landSnap.map((x) => x.spread))} · viewRange ${mean(res.landSnap.map((x) => x.viewRange))} m · weaponRange ${mean(res.landSnap.map((x) => x.weaponRange))} m · reserve ${mean(res.landSnap.map((x) => x.reserve))}`);
  console.log(`    CONTROL (${res.controlSnap.length} ordinary men, same side, same instant)`);
  console.log(`           maxHealth: ${tally(res.controlSnap, 'max')}   skill ${mean(res.controlSnap.map((x) => x.skill))}`);
  console.log(`    noRespawn all=${res.landSnap.every((x) => x.noRespawn === true)} · elite flag all=${res.landSnap.every((x) => x.elite)}`);

  console.log(`\n=== 2. THE DEALT DECK — ten guns, from a shuffle not ten draws`);
  console.log(`    elite   ${tally(res.landSnap, 'weapon')}   (${new Set(res.landSnap.map((x) => x.weapon)).size} distinct of ${res.landSnap.length})`);
  console.log(`    control ${tally(res.controlSnap, 'weapon')}`);

  console.log(`\n=== 3. A UNIT WITH ITS OWN LANE`);
  console.log(`    fireteams seen ${res.S.ftSeen} team-samples · PURE elite ${res.S.ftPure} · MIXED (an elite with conscripts) ${res.S.ftMixed}`);
  console.log(`    lanes: ${Object.entries(res.S.laneHist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ') || '(none)'}`);
  console.log(`    tightness (mean m to own fireteam centroid): elite ${mean(res.S.eliteFtSpread)} m vs ordinary ${mean(res.S.otherFtSpread)} m`);
  console.log(`    the whole stick: mean ${mean(res.S.stickSpread)} m to the centroid of all living elites`);

  console.log(`\n=== 4. TANK AVOIDANCE`);
  const wE = res.worth.elite, wO = res.worth.other;
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  console.log(`    armourWorth returns — elite: ${JSON.stringify(wE)} (${sum(wE)} calls) · everybody else: ${JSON.stringify(wO)} (${sum(wO)} calls)`);
  console.log(`    _tankDodge: asked ${res.dodge.called} · planned a via point ${res.dodge.planned} · declined (no hull in 34 m, or already past) ${res.dodge.declined} · distinct men who detoured ${Object.keys(res.dodge.byId).length}`);
  console.log(`    samples with a live hull: ${res.S.tanksLiveSamples}`);
  console.log(`    closest an elite ever got to an enemy hull: ${res.S.eliteTankMin} m · ordinary men same side: ${res.S.otherTankMin} m`);
  console.log(`    inside the 34 m circle: elite ${res.S.eliteInTankR}/${res.S.eliteTankSamples} man-samples · ordinary ${res.S.otherInTankR}/${res.S.otherTankSamples}`);

  console.log(`\n=== 5. DRONES AS A STANDING ORDER`);
  console.log(`    elite man-samples with a DRONE as the chosen target: ${res.S.droneTargetSamples} / ${res.S.eliteAliveSamples}`);

  console.log(`\n=== 6. WHAT THE TEN DID`);
  console.log(`    objective verbs: ${Object.entries(res.S.objHist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ')}`);
  console.log(`    alive over time (t,n): ${res.S.aliveOverTime.map((x) => `${x[0]}:${x[1]}`).join(' ')}`);
  console.log(`    reinforcements ${res.reinN} · alive at end ${res.reinAlive} · kills ${res.reinKills} · deaths ${res.reinDeaths} · kills/man ${(res.reinKills / Math.max(1, res.reinN)).toFixed(2)}`);
}
console.log(errs.length ? `\n[pageerror] ${errs.slice(0, 3).join(' | ')}` : '\n[pageerror] none');
await b.close();
