/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GIVEN A CONTACT, WHAT DOES THE MAGAZINE DO? — the per-engagement census
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node _engage.mjs --url=http://127.0.0.1:4535/ --seeds=7,11 [--warm=120]
 *                    [--window=150]
 *
 * EVERY PREVIOUS REPORT ANSWERED WITH ROUNDS PER MAN-MINUTE AVERAGED OVER A
 * MATCH — 12.3 → 32.7 → 61.6 → 97.2 → 44 — and that number is dominated by how
 * often men MEET. It can stay flat while the thing the player watches gets
 * better or worse, and it has repeatedly been used to argue "we are at the
 * ceiling". 「試合の平均ではない、遭遇して撃っている時の球の減り方の分布」.
 *
 * So the unit here is ONE ENGAGEMENT: from the frame a man acquires a contact
 * (`hasTarget` rising) to the frame he loses it for `LOST` continuous seconds.
 * What is reported is the DISTRIBUTION of rounds sent inside it — median, p10,
 * p90 — and THE SHARE THAT ENDS UNDER TEN ROUNDS, which is the bug being
 * described: 「敵を視認して数発だけ撃っている」.
 *
 * Rounds are counted at `AiSystem.onAgentFire`, which is one call per round
 * leaving a barrel, and each round is tagged with the shooter's own speed at
 * that instant — so "does he fire while moving" is answered by the same pass.
 *
 * THE CLOCK. `Agent._shoot` drains its cooldown in a loop now, but `Engine.step`
 * still clamps a raw frame, so the window is scale 1 and only the WARM-UP runs
 * fast. @see the header of `_encounter.mjs`, which learned this the hard way.
 *
 * The second half is TRAVEL, against the standard the player set: 「プレイヤーの
 * 最高速度と同じスピードで移動する時間がないとおかしい…基本は走って移動するやろ」. A mean
 * cannot answer that, so what is reported is the SPEED HISTOGRAM of travelling
 * men (in ADVANCE, intending to move, with a leg in front of them) and the
 * share of that time at or near the player's own 6.45 m/s. Plus the refusal
 * census in `_sprintGate`'s own order, with `unstick` split three ways because
 * `noPath` is a different bug from a detour.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4535/';
const SEEDS = String(args.seeds ?? args.seed ?? '7').split(',');
const WARM = +(args.warm ?? 120);
const WINDOW = +(args.window ?? 150);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const all = [];
for (const seed of SEEDS) {
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(`${URL}?capture=1&seed=${seed}`, { waitUntil: 'domcontentloaded' });
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

    /* ---- constants of the reading ---------------------------------- */
    const LOST = 1.2;        // seconds without a contact that ends an engagement
    const MOVING = 1.2;      // m/s at which a man counts as firing on the move
    const PLAYER_TOP = 6.45; // the player's own sprint. @see SPRINT_SPEED.
    const NEAR_TOP = 5.8;    // "at or near" it

    const S = {
      eng: [],              // completed engagements
      sight: [],            // completed SIGHTINGS — eyes actually on him
      openAtEnd: 0,
      noPathWhy: Object.create(null),
      sightGate: Object.create(null),
      sightFrames: 0,
      rounds: 0, roundsMoving: 0,
      roundsAtArmour: 0, roundsAtDrone: 0,
      roundsAtArmourMoving: 0, roundsAtDroneMoving: 0,
      /* travel */
      travelSamples: 0, travelSpeed: [],  // histogram buckets
      sprintSamples: 0, movingSamples: 0, aliveSamples: 0,
      sprintStarts: 0, sprintStartNearPlayer: 0, sprintStartDist: [],
      why: Object.create(null),
      ticks: 0,
      maxSpeed: 0,
      /* was there anything to shoot at besides men, and was it ever a target */
      vehiclesAlive: 0, dronesAlive: 0,
      armourWorth: Object.create(null),
      armourInRange: 0,
    };
    const BUCKETS = [0, 1, 2, 3, 4, 5, 5.5, 6, 6.45, 7, 99];
    const hist = new Array(BUCKETS.length - 1).fill(0);
    const bump = (k) => { S.why[k] = (S.why[k] ?? 0) + 1; };

    /* per-agent engagement bookkeeping, keyed on the actor object */
    const live = new Map();
    const openEng = (a) => ({
      rounds: 0, moving: 0, t0: e.time.elapsed, lost: 0,
      armour: 0, drone: 0, man: 0, sawArmour: false, sawDrone: false,
      movedM: 0, lastX: a.position.x, lastZ: a.position.z,
    });
    const closeEng = (g) => {
      S.eng.push({
        rounds: g.rounds, moving: g.moving,
        dur: +(e.time.elapsed - g.t0).toFixed(2),
        armour: g.sawArmour, drone: g.sawDrone,
        movedM: +g.movedM.toFixed(1),
      });
    };

    /**
     * THE SIGHTING IS THE SMALLER UNIT AND IT IS THE ONE THE SENTENCE NAMES —
     * 「敵を視認して数発だけ撃っている」. `hasTarget` is a 6.5 s memory and in a
     * 15v15 it is very nearly continuous once a fight starts, so an engagement
     * keyed on it is "this man's whole afternoon". A sighting is EYES ON:
     * `targetVisible` rising, closed when the line has been broken for `LOST`.
     */
    const sight = new Map();
    const closeSight = (g) => {
      S.sight.push({ rounds: g.rounds, moving: g.moving,
        dur: +(e.time.elapsed - g.t0).toFixed(2) });
    };

    const fire0 = ai.onAgentFire.bind(ai);
    ai.onAgentFire = (a, o, d) => {
      const g = live.get(a);
      const sg = sight.get(a);
      const moving = a.speed > MOVING;
      S.rounds++;
      if (moving) S.roundsMoving++;
      const tgt = a.targetActor;
      const isV = tgt?.isVehicle === true;
      const isD = tgt ? ai.isDrone?.(tgt) === true : false;
      if (isV) { S.roundsAtArmour++; if (moving) S.roundsAtArmourMoving++; }
      if (isD) { S.roundsAtDrone++; if (moving) S.roundsAtDroneMoving++; }
      a.__firedFrame = e.time.frame;
      if (sg) { sg.rounds++; if (moving) sg.moving++; }
      if (g) {
        g.rounds++;
        if (moving) g.moving++;
        if (isV) { g.armour++; g.sawArmour = true; }
        else if (isD) { g.drone++; g.sawDrone = true; }
        else g.man++;
      }
      return fire0(a, o, d);
    };

    const wasSprinting = new Map();
    const tStart = t();
    while (t() - tStart < WINDOW && m.phase === 'live' && m.roundClock > 0) {
      const dt = e.time.dt;
      await frame();
      S.ticks++;
      /**
       * IS THERE ARMOUR ON THE MAP AT ALL, and does `armourWorth` say yes to a
       * man who is MOVING. The verdict is asked of the system exactly as
       * `_combat` asks it, so a zero here is "no hull was ever in range" and
       * not "the gate refused" — the two were indistinguishable in the report.
       */
      const vs = ai.vehicles ?? [];
      for (const v of vs) {
        if (v?.alive !== true) continue;
        S.vehiclesAlive++;
        for (const a of ai.agents) {
          if (!a.alive) continue;
          const d = Math.hypot(a.position.x - v.position.x, a.position.z - v.position.z);
          if (d >= a.weaponRange) continue;
          S.armourInRange++;
          const w = ai.armourWorth(a, v);
          const k = `${w}${a.speed > 1.2 ? ':moving' : ':still'}`;
          S.armourWorth[k] = (S.armourWorth[k] ?? 0) + 1;
        }
      }
      for (const d of ai.drones ?? []) if (d?.alive === true) S.dronesAlive++;
      for (const a of ai.agents) {
        if (!a.alive) {
          const g = live.get(a);
          if (g) { closeEng(g); live.delete(a); }
          const s2 = sight.get(a);
          if (s2) { closeSight(s2); sight.delete(a); }
          continue;
        }
        /* ---- sightings --------------------------------------------- */
        let sg = sight.get(a);
        if (a.targetVisible && a.hasTarget) {
          if (!sg) { sg = { rounds: 0, moving: 0, t0: e.time.elapsed, lost: 0 }; sight.set(a, sg); }
          sg.lost = 0;
        } else if (sg) {
          sg.lost += dt;
          if (sg.lost > LOST) { closeSight(sg); sight.delete(a); }
        }
        /**
         * WHAT STOPS THE TRIGGER WHILE HIS EYES ARE ON HIM. Charged on every
         * frame of a live sighting on which no round left the barrel, against
         * the FIRST refusal in the order `Agent._combat` / `_shoot` ask them.
         */
        if (sg && sg.lost === 0 && a.__firedFrame !== e.time.frame) {
          S.sightFrames++;
          const tgt = a.targetActor;
          const dist = tgt ? a.position.distanceTo(tgt.position) : Infinity;
          const armour = tgt?.isVehicle === true;
          /**
           * THE ORDER MATTERS AND THE FIRST VERSION HAD IT WRONG. Charging the
           * STATE before the trigger reads every rate-of-fire gap and every
           * reload of a man who happens to be in SUPPRESSED as "SUPPRESSED
           * stopped him" — which is exactly the reading that has to be honest
           * here. So the mechanical refusals are asked first, then whether he
           * WANTS to fire (and only then which state is the reason he does
           * not), and the two gaps that are simply the weapon's own rhythm are
           * charged last and separately.
           */
          const k = ai.combatEnabled === false ? 'roundNotLive'
            : a.blindT > 0 ? 'flashed'
              : a.dry ? 'dry'
                : a.animator?.reloading ? 'reloading'
                  : a.ammo <= 0 ? 'magEmpty'
                    : a.working ? 'working'
                      : dist >= a.weaponRange ? 'outOfRange'
                        : armour && a.armourWorth !== 1 && a.armourWorth !== 3
                          ? 'armourGate'
                          : !a.wantFire
                            ? (a.state === 'suppressed' ? 'noFire:suppressed'
                              : a.state === 'flank' ? 'noFire:flank'
                                : a.state === 'retreat' ? 'noFire:retreat'
                                  : a.post ? 'noFire:post'
                                    : a.state === 'combat' && a.cover
                                      && a.position.distanceTo(a.coverPos) < 0.85 && !a.peeking
                                      ? 'noFire:ducked' : `noFire:${a.state}`)
                            : a.burstCooldown > 0 ? 'burstGap'
                              : a.fireCooldown > 0 ? 'rateOfFire' : 'other';
          S.sightGate[k] = (S.sightGate[k] ?? 0) + 1;
        }
        S.aliveSamples++;
        if (a.speed > S.maxSpeed) S.maxSpeed = a.speed;
        if (a.speed > 0.4) S.movingSamples++;
        if (a.sprinting) S.sprintSamples++;

        /* ---- engagements ------------------------------------------- */
        let g = live.get(a);
        if (a.hasTarget) {
          if (!g) { g = openEng(a); live.set(a, g); }
          g.lost = 0;
          const tgt = a.targetActor;
          if (tgt?.isVehicle === true) g.sawArmour = true;
          else if (tgt && ai.isDrone?.(tgt) === true) g.sawDrone = true;
        } else if (g) {
          g.lost += dt;
          if (g.lost > LOST) { closeEng(g); live.delete(a); g = null; }
        }
        if (g) {
          const dx = a.position.x - g.lastX, dz = a.position.z - g.lastZ;
          g.movedM += Math.hypot(dx, dz);
          g.lastX = a.position.x; g.lastZ = a.position.z;
        }

        /* ---- sprint starts, and where the player was ---------------- */
        const sp = a.sprinting === true;
        if (sp && !wasSprinting.get(a)) {
          S.sprintStarts++;
          const c = e.ctx.camera;
          const d = Math.hypot(a.position.x - c.position.x, a.position.z - c.position.z);
          S.sprintStartDist.push(+d.toFixed(1));
          if (d < 45) S.sprintStartNearPlayer++;
        }
        wasSprinting.set(a, sp);

        /* ---- travel: the speed of a man crossing ground -------------- */
        const o = a.objective;
        if (!o || a.state !== 'advance') continue;
        const dist = Math.hypot(o.position.x - a.position.x, o.position.z - a.position.z);
        if (dist < 16) continue;
        S.travelSamples++;
        for (let b = 0; b < hist.length; b++) {
          if (a.speed < BUCKETS[b + 1]) { hist[b]++; break; }
        }
        /* the gate's own order, first refusal wins */
        if (a.hasTarget || a.suppression > 0.15) { bump('contact'); continue; }
        if (a.working || a.post || a.postClimbing || a.crouch) { bump('busy'); continue; }
        if (!a.hasMoveTarget) {
          if (a.pathPending) { bump('unstick:pending'); continue; }
          bump('unstick:noPath');
          /**
           * AND WHY HE HAS NO ROUTE, which is the question nobody has asked.
           * Charged against the first that is true, in the order `_advance`
           * would hit them.
           */
          const w = a.objectiveBlocked ? 'objectiveBlocked'
            : a._offGrid?.() ? 'offGrid'
              : a.repathTimer > 0 ? 'waitingOnRepathTimer'
                : a._detourTimer > 0 ? 'detour'
                  : a.stuckRung !== 0 ? `rung${a.stuckRung}`
                    : 'other';
          S.noPathWhy[w] = (S.noPathWhy[w] ?? 0) + 1;
          continue;
        }
        if (a._detourTimer > 0) { bump('unstick:detour'); continue; }
        if (a.stuckRung !== 0) { bump('unstick:rung'); continue; }
        if (a.lastKnownAge < 4
          && a.position.distanceToSquared(a.lastKnown) < 26 * 26) { bump('threatcall'); continue; }
        if (!a._sprintArmed) { bump('winded'); continue; }
        if (a._ahead > 1) { bump('crowd'); continue; }
        if (Math.sin(a.yaw) * a._steer.x + Math.cos(a.yaw) * a._steer.z < 0.55) {
          bump('turning'); continue;
        }
        bump(a.sprinting ? 'RUNNING' : 'passed-but-not-running');
      }
    }
    for (const [, g] of live) { S.openAtEnd++; }
    S.speedHist = Object.fromEntries(hist.map((v, i) =>
      [`${BUCKETS[i]}-${BUCKETS[i + 1]}`, v]));
    S.travelNearTop = 0;
    S.travelAtTop = 0;
    for (let b = 0; b < hist.length; b++) {
      if (BUCKETS[b] >= NEAR_TOP) S.travelNearTop += hist[b];
      if (BUCKETS[b] >= PLAYER_TOP) S.travelAtTop += hist[b];
    }
    return S;
  }, { WARM, WINDOW });

  await page.close();

  /* ---- the distribution, computed here ----------------------------- */
  const q = (arr, p) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  const rounds = out.eng.map((x) => x.rounds);
  const fought = out.eng.filter((x) => x.rounds > 0).map((x) => x.rounds);
  const pct = (n, d) => +(100 * n / Math.max(1, d)).toFixed(1);
  const row = {
    seed, pageerrors: errs,
    engagements: out.eng.length,
    openAtEnd: out.openAtEnd,
    /* THE HEADLINE — rounds sent per engagement */
    perEngagement: {
      median: q(rounds, 0.5), p10: q(rounds, 0.1), p90: q(rounds, 0.9),
      mean: +(rounds.reduce((a, b) => a + b, 0) / Math.max(1, rounds.length)).toFixed(1),
      underTenPct: pct(rounds.filter((r) => r < 10).length, rounds.length),
      zeroPct: pct(rounds.filter((r) => r === 0).length, rounds.length),
    },
    /* THE SMALLER UNIT — one sighting, eyes on. @see the note in the page. */
    perSighting: (() => {
      const r = out.sight.map((x) => x.rounds);
      return {
        n: r.length,
        median: q(r, 0.5), p10: q(r, 0.1), p90: q(r, 0.9),
        mean: +(r.reduce((a, b) => a + b, 0) / Math.max(1, r.length)).toFixed(1),
        underTenPct: pct(r.filter((x) => x < 10).length, r.length),
        zeroPct: pct(r.filter((x) => x === 0).length, r.length),
        medianDur: q(out.sight.map((x) => x.dur), 0.5),
        movingPct: pct(out.sight.reduce((a, b) => a + b.moving, 0),
          out.sight.reduce((a, b) => a + b.rounds, 0)),
      };
    })(),
    medianEngagementDur: q(out.eng.map((x) => x.dur), 0.5),
    noPathWhy: out.noPathWhy,
    sightGate: Object.fromEntries(Object.entries(out.sightGate)
      .sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, pct(v, out.sightFrames)])),
    /* the same, over engagements in which he fired at all */
    perFiredEngagement: {
      n: fought.length,
      median: q(fought, 0.5), p10: q(fought, 0.1), p90: q(fought, 0.9),
      underTenPct: pct(fought.filter((r) => r < 10).length, fought.length),
    },
    fireOnMove: {
      rounds: out.rounds,
      movingPct: pct(out.roundsMoving, out.rounds),
      engagementsWithMovingFire: out.eng.filter((x) => x.moving > 0).length,
    },
    armour: {
      engagements: out.eng.filter((x) => x.armour).length,
      rounds: out.roundsAtArmour, movingPct: pct(out.roundsAtArmourMoving, out.roundsAtArmour),
      hullSamplesAlive: out.vehiclesAlive,
      manHullPairsInRange: out.armourInRange,
      /* `armourWorth`'s own verdict, split by whether the man was moving */
      worthByMotion: out.armourWorth,
    },
    drone: {
      engagements: out.eng.filter((x) => x.drone).length,
      rounds: out.roundsAtDrone, movingPct: pct(out.roundsAtDroneMoving, out.roundsAtDrone),
    },
    travel: {
      samples: out.travelSamples,
      speedHist: out.speedHist,
      atPlayerTopPct: pct(out.travelAtTop, out.travelSamples),
      nearTopPct: pct(out.travelNearTop, out.travelSamples),
      sprintOfMovingPct: pct(out.sprintSamples, out.movingSamples),
      maxSpeed: +out.maxSpeed.toFixed(2),
      sprintStarts: out.sprintStarts,
      sprintStartsWithin45mOfPlayerPct: pct(out.sprintStartNearPlayer, out.sprintStarts),
      medianSprintStartDist: q(out.sprintStartDist, 0.5),
    },
    refusals: Object.fromEntries(Object.entries(out.why)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, pct(v, out.travelSamples)])),
  };
  all.push(row);
  console.log(JSON.stringify(row, null, 2));
}
await browser.close();
if (all.length > 1) {
  console.log('\n=== summary ===');
  for (const r of all) {
    console.log(`seed ${r.seed}: n=${r.engagements} median=${r.perEngagement.median} `
      + `p10=${r.perEngagement.p10} p90=${r.perEngagement.p90} `
      + `<10=${r.perEngagement.underTenPct}% moveFire=${r.fireOnMove.movingPct}% `
      + `travel@top=${r.travel.atPlayerTopPct}% noPath=${r.refusals['unstick:noPath'] ?? 0}%`);
  }
}
