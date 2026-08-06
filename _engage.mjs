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
/**
 * WHICH LEVEL. There are two now (`?map=town|plains`) and the plain's zones are
 * 154-314 m apart against the town's 60-100, so every travel figure below is a
 * different number on it. The default is what `DEFAULTS.map` is, so a command
 * line written before this flag existed still measures what it used to.
 */
const MAP = args.map ?? 'town';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const all = [];
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
    const PLAYER_TOP = 6.45; // the old edge, kept only for comparability
    const FULL_SPRINT = 6.4; // 6.4492 is what a rifleman's flat-out run IS
    const NEAR_TOP = 5.8;    // "at or near" it

    /**
     * THE NEAR FIELD IS ITS OWN READING — 「プレイヤーの最高速度と同じスピードで
     * 移動する時間がないとおかしい」 is a sentence about what the player CAN SEE.
     *
     * The whole-map histogram has been reported four times and it has never
     * answered the complaint, because a man running 130 m away is a man the
     * player never watched. `NEAR` is the radius inside which travel is his
     * problem: 60 m is about the far edge of a readable silhouette on this map
     * and it is wider than the 45 m the sprint-start census used, on purpose —
     * a start at 50 m is still a run he watches unfold.
     */
    const NEAR = 60;
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
      /* the same, for men the player could actually watch. @see NEAR. */
      travelNear: 0, whyNear: Object.create(null),
      nearAlive: 0, nearMoving: 0, nearSprint: 0,
      /**
       * THE GATE SAYS RUN AND THE LEGS DO SOMETHING ELSE. Charged only on
       * travel samples where `_sprintGate` actually set `sprinting`, so this
       * separates "he was refused" from "he was granted a run and then had it
       * multiplied away". @see `Agent._brakeCut`.
       */
      sprintGranted: 0, sprintBraked: 0, sprintBrakeSum: 0,
      sprintSlowUnbraked: 0, sprintSlowBraked: 0,
      /**
       * …AND THE SAME INSIDE `NEAR`, because the man the player can see is by
       * construction the man furthest forward — he reached this side of the map
       * first — which is exactly the man the fireteam brake is pointed at.
       */
      nearGranted: 0, nearBraked: 0,
      /**
       * ══════════════════════════════════════════════════════════════════════
       * AND THE HONEST FORM OF THE QUESTION: IS HE AT *HIS OWN* TOP SPEED?
       * ══════════════════════════════════════════════════════════════════════
       * A fixed edge has now been wrong twice for the same reason. 6.45 excluded
       * the carbine man at a dead run (`SPRINT_SPEED` is 6.4492); 6.4 excludes
       * the AK man, whose ceiling is 6.3847 — and the AK is the irregulars'
       * standard rifle. `Agent._sprintCeiling` publishes what a flat-out run IS
       * for the weapon a given man is carrying, so this counts a man against
       * himself: at 98 % of his own ceiling he is running as hard as the weapon
       * lets him, and 「武器減速は大丈夫」 means that is the correct answer.
       *
       * Both readings are kept. The fixed-edge one stays comparable with five
       * previous passes; this one is the one that answers 「基本は走って移動するやろ」.
       */
      travelAtOwnCeiling: 0, nearAtOwnCeiling: 0,
      grantedAtOwnCeiling: 0, nearGrantedAtOwnCeiling: 0,
      /**
       * WHAT WAS IN THE GUN WHEN HE SAW SOMEBODY. The refusal census says the
       * dead time inside a short sighting is `reloading` and `dry`; this says
       * whether that state was already true at the moment the contact opened,
       * which is the difference between "the reload is slow" and "he walked
       * into the fight with an empty gun".
       */
      /**
       * ══════════════════════════════════════════════════════════════════════
       * IS ANYBODY TAKING THE GROUND? — the guard on 「敵を倒すのをメインにしてもいい」
       * ══════════════════════════════════════════════════════════════════════
       * Several restraints came off at once — the fireteam brake, the burst gap
       * with eyes on, the reload discipline, the range gate, and the dwell that
       * pulled a man out of a firefight toward a circle. The failure mode of
       * the last one is a roster that fights beautifully and never captures
       * anything, and DOMINATION scores on the circles. So: the share of alive
       * bot samples standing INSIDE a capture zone, and the share within 20 m
       * of one, read off `match.capture.zones` — the same `position`/`radius`
       * `CaptureZones._inside` uses.
       */
      inZone: 0, nearZone: 0, zoneSamples: 0,
      score: null,
      openReloading: 0, openDry: 0, openLow: 0, openFull: 0, opens: 0,
      ticks: 0,
      maxSpeed: 0,
      /* was there anything to shoot at besides men, and was it ever a target */
      vehiclesAlive: 0, dronesAlive: 0,
      armourWorth: Object.create(null),
      armourInRange: 0,
    };
    /**
     * 6.4 IS A NEW EDGE AND IT IS THERE BECAUSE 6.45 WAS A TRAP.
     *
     * `SPRINT_SPEED` is `7.01 * 0.92 = 6.4492` and a carbine's `moveScale` is
     * exactly 1, so a bot running flat out with the commonest gun on the map
     * asymptotes to 6.4492 — EIGHT TEN-THOUSANDTHS BELOW the `>= 6.45` test.
     * He can never enter the top bucket, and neither can the player, whose own
     * `sprintSpeed` is the same 6.4492 (`src/player/tuning.js`). So the
     * headline "9.5 % at or above the player's own 6.45" was counting only the
     * SMG and machine-pistol men, whose `moveScale` is over 1, and reporting
     * every rifleman at a dead run as if he were not running.
     *
     * The old edges are all kept so the number stays comparable with the four
     * passes that came before it; 6.4 is inserted, and `atFullSprintPct` below
     * is the honest form of the same question.
     */
    const BUCKETS = [0, 1, 2, 3, 4, 5, 5.5, 6, 6.4, 6.45, 7, 99];
    const hist = new Array(BUCKETS.length - 1).fill(0);
    const histNear = new Array(BUCKETS.length - 1).fill(0);
    const bump = (k, near) => {
      S.why[k] = (S.why[k] ?? 0) + 1;
      if (near) S.whyNear[k] = (S.whyNear[k] ?? 0) + 1;
    };

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
    /**
     * ══════════════════════════════════════════════════════════════════════
     * DID THE SIGHTING END BECAUSE HE WON IT?
     * ══════════════════════════════════════════════════════════════════════
     * "the share of sightings ending under ten rounds" has been the headline
     * for five passes and it has never distinguished the two things that can
     * make a sighting short: a man who REFUSED to shoot, and a man who saw
     * somebody, opened up and KILLED him in eight rounds. The first is the
     * complaint; the second is the request being granted. As the roster's
     * marksmanship goes up the second one grows, and it grows the metric in
     * the direction that reads as failure.
     *
     * `killed` is the target this sighting was opened on being dead when the
     * line closes. It is not kill CREDIT — somebody else may have shot him —
     * but as a share of the under-ten column it is the difference between
     * "he did nothing" and "there was nothing left to shoot at".
     */
    const closeSight = (g) => {
      const t = g.tgt;
      const killed = !!t && (t.alive === false || t.dead === true);
      S.sight.push({ rounds: g.rounds, moving: g.moving,
        dur: +(e.time.elapsed - g.t0).toFixed(2),
        mag0: g.mag0, frac0: g.frac0, reloading0: g.reloading0, dry0: g.dry0, killed });
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

    /**
     * The capture circles, resolved once. `match.capture` only exists in
     * DOMINATION; in the demolition ruleset the list is empty and every zone
     * figure below reports zero samples rather than a wrong number.
     */
    const ZONES = (m.capture?.zones ?? []).filter((z) => z?.position && z.radius > 0);
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
          if (!sg) {
            /* WHAT WAS IN THE GUN AT THE INSTANT HIS EYES LANDED ON HIM. */
            const reloading0 = a.animator?.reloading === true;
            const dry0 = a.dry === true;
            const frac0 = a.magSize > 0 ? a.ammo / a.magSize : 0;
            sg = { rounds: 0, moving: 0, t0: e.time.elapsed, lost: 0,
              mag0: a.ammo, frac0: +frac0.toFixed(3), reloading0, dry0,
              /* who he was looking at, for the `killed` column. @see closeSight. */
              tgt: a.targetActor ?? null };
            sight.set(a, sg);
            S.opens++;
            if (reloading0) S.openReloading++;
            if (dry0) S.openDry++;
            if (!reloading0 && !dry0 && frac0 < 0.34) S.openLow++;
            if (!reloading0 && !dry0 && frac0 > 0.95) S.openFull++;
          }
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
        /* IS HE TAKING THE GROUND. @see the `inZone` field block. */
        if (ZONES.length) {
          S.zoneSamples++;
          let best = Infinity;
          for (const z of ZONES) {
            const d = Math.hypot(a.position.x - z.position.x, a.position.z - z.position.z);
            if (d - z.radius < best) best = d - z.radius;
          }
          if (best <= 0) S.inZone++;
          if (best <= 20) S.nearZone++;
        }
        S.aliveSamples++;
        if (a.speed > S.maxSpeed) S.maxSpeed = a.speed;
        if (a.speed > 0.4) S.movingSamples++;
        if (a.sprinting) S.sprintSamples++;
        /* how far from the eye that is complaining. @see NEAR. */
        const cam = e.ctx.camera;
        const dPlayer = Math.hypot(a.position.x - cam.position.x, a.position.z - cam.position.z);
        const near = dPlayer < NEAR;
        if (near) {
          S.nearAlive++;
          if (a.speed > 0.4) S.nearMoving++;
          if (a.sprinting) S.nearSprint++;
        }

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
        if (near) S.travelNear++;
        for (let b = 0; b < hist.length; b++) {
          if (a.speed < BUCKETS[b + 1]) { hist[b]++; if (near) histNear[b]++; break; }
        }
        /**
         * IS HE AT HIS OWN CEILING. @see the field block. `_sprintCeiling` is
         * the agent's own expression, read off the prototype rather than
         * retyped — the two fixed edges above are the reason that matters. The
         * fallback is the same expression off `moveScale`, so this reading also
         * works against a build from before the getter existed.
         */
        const ms = a.moveScale ?? 1;
        const ceil = a._sprintCeiling
          ?? (6.4492 * (ms >= 1 ? ms : 0.5 + ms * 0.5));
        const atCeiling = a.speed >= ceil * 0.98;
        if (atCeiling) {
          S.travelAtOwnCeiling++;
          if (near) S.nearAtOwnCeiling++;
        }
        /* what happened to a man the gate DID pass. @see `_brakeCut`. */
        if (a.sprinting === true) {
          if (atCeiling) {
            S.grantedAtOwnCeiling++;
            if (near) S.nearGrantedAtOwnCeiling++;
          }
          S.sprintGranted++;
          const cut = a._brakeCut ?? 1;
          const slow = a.speed < FULL_SPRINT;
          if (near) { S.nearGranted++; if (cut < 0.999) S.nearBraked++; }
          if (cut < 0.999) {
            S.sprintBraked++;
            S.sprintBrakeSum += cut;
            if (slow) S.sprintSlowBraked++;
          } else if (slow) S.sprintSlowUnbraked++;
        }
        /* the gate's own order, first refusal wins */
        if (a.hasTarget || a.suppression > 0.15) { bump('contact', near); continue; }
        if (a.working || a.post || a.postClimbing || a.crouch) { bump('busy', near); continue; }
        if (!a.hasMoveTarget) {
          if (a.pathPending) { bump('unstick:pending', near); continue; }
          bump('unstick:noPath', near);
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
        if (a._detourTimer > 0) { bump('unstick:detour', near); continue; }
        if (a.stuckRung !== 0) { bump('unstick:rung', near); continue; }
        /**
         * The gate's OWN radius, read off the agent rather than retyped — the
         * literal 26 here was stale by two passes (it is 10 in `agent.js`) and a
         * probe that reports a refusal the gate does not make is worse than no
         * probe. `_sprintThreatR` is exported for exactly this.
         */
        const thr = a._sprintThreatR ?? 10;
        if (a.lastKnownAge < 4
          && a.position.distanceToSquared(a.lastKnown) < thr * thr) { bump('threatcall', near); continue; }
        if (!a._sprintArmed) { bump('winded', near); continue; }
        if (a._ahead > 1) { bump('crowd', near); continue; }
        if (Math.sin(a.yaw) * a._steer.x + Math.cos(a.yaw) * a._steer.z < 0.55) {
          bump('turning', near); continue;
        }
        bump(a.sprinting ? 'RUNNING' : 'passed-but-not-running', near);
      }
    }
    for (const [, g] of live) { S.openAtEnd++; }
    S.speedHist = Object.fromEntries(hist.map((v, i) =>
      [`${BUCKETS[i]}-${BUCKETS[i + 1]}`, v]));
    S.speedHistNear = Object.fromEntries(histNear.map((v, i) =>
      [`${BUCKETS[i]}-${BUCKETS[i + 1]}`, v]));
    S.travelNearTop = 0;
    S.travelAtTop = 0;
    S.travelAtFull = 0;
    S.nearTravelNearTop = 0;
    S.nearTravelAtTop = 0;
    S.nearTravelAtFull = 0;
    for (let b = 0; b < hist.length; b++) {
      if (BUCKETS[b] >= NEAR_TOP) { S.travelNearTop += hist[b]; S.nearTravelNearTop += histNear[b]; }
      if (BUCKETS[b] >= PLAYER_TOP) { S.travelAtTop += hist[b]; S.nearTravelAtTop += histNear[b]; }
      if (BUCKETS[b] >= FULL_SPRINT) { S.travelAtFull += hist[b]; S.nearTravelAtFull += histNear[b]; }
    }
    S.NEAR = NEAR;
    S.zoneCount = ZONES.length;
    /* who is actually winning it, so "they fight and never capture" is visible */
    S.score = Array.isArray(m.score) ? m.score.slice() : null;
    S.zoneOwners = ZONES.map((z) => z.owner);
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
        /**
         * THE UNDER-TEN COLUMN, SPLIT BY WHETHER THERE WAS ANYTHING LEFT TO
         * SHOOT AT. @see `closeSight`. `underTenKilledPct` is the share of the
         * WHOLE population that is a short sighting ending on a dead man, and
         * `underTenLivePct` is the honest form of the complaint.
         */
        underTenKilledPct: pct(out.sight.filter((x) => x.rounds < 10 && x.killed).length, r.length),
        underTenLivePct: pct(out.sight.filter((x) => x.rounds < 10 && !x.killed).length, r.length),
        killedPct: pct(out.sight.filter((x) => x.killed).length, r.length),
        medianDur: q(out.sight.map((x) => x.dur), 0.5),
        movingPct: pct(out.sight.reduce((a, b) => a + b.moving, 0),
          out.sight.reduce((a, b) => a + b.rounds, 0)),
      };
    })(),
    /**
     * THE SAME, MINUS THE GLIMPSES. A sighting that lasted a third of a second
     * is a man crossing a gap, and counting it as "he saw him and did not
     * shoot" flatters the zero column in both directions. One second is longer
     * than any reaction time in the file.
     */
    perSightingOverOneSecond: (() => {
      const r = out.sight.filter((x) => x.dur >= 1).map((x) => x.rounds);
      return {
        n: r.length,
        median: q(r, 0.5), p10: q(r, 0.1), p90: q(r, 0.9),
        underTenPct: pct(r.filter((x) => x < 10).length, r.length),
        zeroPct: pct(r.filter((x) => x === 0).length, r.length),
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
      /* the honest one. @see the note on BUCKETS. */
      atFullSprintPct: pct(out.travelAtFull, out.travelSamples),
      /* …and the honest one against a fixed edge is still a fixed edge. */
      atOwnCeilingPct: pct(out.travelAtOwnCeiling, out.travelSamples),
      grantedAtOwnCeilingPct: pct(out.grantedAtOwnCeiling, out.sprintGranted),
      nearTopPct: pct(out.travelNearTop, out.travelSamples),
      /**
       * THE GATE'S VERDICT AGAINST THE LEGS'. `granted` is `_sprintGate` saying
       * yes; `slowAnyway` is that man measured below a flat-out run.
       */
      sprintGrantedPct: pct(out.sprintGranted, out.travelSamples),
      grantedButSlowPct: pct(out.sprintSlowBraked + out.sprintSlowUnbraked, out.sprintGranted),
      grantedAndBrakedPct: pct(out.sprintBraked, out.sprintGranted),
      meanBrakeCut: +(out.sprintBrakeSum / Math.max(1, out.sprintBraked)).toFixed(3),
      slowBecauseBrakedPct: pct(out.sprintSlowBraked, out.sprintGranted),
      slowWithoutBrakePct: pct(out.sprintSlowUnbraked, out.sprintGranted),
      sprintOfMovingPct: pct(out.sprintSamples, out.movingSamples),
      maxSpeed: +out.maxSpeed.toFixed(2),
      sprintStarts: out.sprintStarts,
      sprintStartsWithin45mOfPlayerPct: pct(out.sprintStartNearPlayer, out.sprintStarts),
      medianSprintStartDist: q(out.sprintStartDist, 0.5),
    },
    /**
     * THE GUARD ON "KILLING MAY BE THE POINT". @see the field block in the page.
     * If a pass that loosens the pull toward objectives has gone too far, this
     * is where it shows: nobody standing in a circle, and a score that does not
     * move.
     */
    objective: {
      zones: out.zoneCount,
      inZonePct: pct(out.inZone, out.zoneSamples),
      within20mPct: pct(out.nearZone, out.zoneSamples),
      zoneOwners: out.zoneOwners,
      score: out.score,
    },
    refusals: Object.fromEntries(Object.entries(out.why)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, pct(v, out.travelSamples)])),
    /**
     * ══════════════════════════════════════════════════════════════════════
     * THE SAME QUESTION, ASKED ONLY OF THE MEN THE PLAYER CAN SEE
     * ══════════════════════════════════════════════════════════════════════
     * @see `NEAR` in the page. This is the deliverable reading: the whole-map
     * histogram has never been the thing complained about.
     */
    nearField: {
      radius: out.NEAR,
      aliveSamples: out.nearAlive,
      shareOfAllAlive: pct(out.nearAlive, out.aliveSamples),
      travelSamples: out.travelNear,
      speedHist: out.speedHistNear,
      atPlayerTopPct: pct(out.nearTravelAtTop, out.travelNear),
      atFullSprintPct: pct(out.nearTravelAtFull, out.travelNear),
      atOwnCeilingPct: pct(out.nearAtOwnCeiling, out.travelNear),
      grantedAtOwnCeilingPct: pct(out.nearGrantedAtOwnCeiling, out.nearGranted),
      nearTopPct: pct(out.nearTravelNearTop, out.travelNear),
      sprintOfMovingPct: pct(out.nearSprint, out.nearMoving),
      sprintGrantedPct: pct(out.nearGranted, out.travelNear),
      /* of the men granted a run inside NEAR, how many the brake then took it off */
      grantedAndBrakedPct: pct(out.nearBraked, out.nearGranted),
      refusals: Object.fromEntries(Object.entries(out.whyNear)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, pct(v, out.travelNear)])),
    },
    /**
     * ══════════════════════════════════════════════════════════════════════
     * WHAT WAS IN THE GUN WHEN THE CONTACT OPENED
     * ══════════════════════════════════════════════════════════════════════
     * The refusal census says the dead time inside a short sighting is
     * `reloading` and `dry`. This says whether that was ALREADY TRUE when his
     * eyes landed, which is the difference between a slow reload and a man who
     * walked into the fight with an empty gun — and it splits the under-ten
     * share by it, so the two can no longer be confused.
     */
    magazineAtContact: (() => {
      const n = Math.max(1, out.opens);
      const split = (f) => {
        const r = out.sight.filter(f);
        return {
          n: r.length,
          underTenPct: pct(r.filter((x) => x.rounds < 10).length, r.length),
          medianRounds: q(r.map((x) => x.rounds), 0.5),
        };
      };
      return {
        opens: out.opens,
        reloadingAtOpenPct: pct(out.openReloading, n),
        dryAtOpenPct: pct(out.openDry, n),
        underThirdOfAMagPct: pct(out.openLow, n),
        fullMagPct: pct(out.openFull, n),
        medianMagFracAtOpen: q(out.sight.map((x) => x.frac0 ?? 0), 0.5),
        wasReloading: split((x) => x.reloading0),
        wasDry: split((x) => x.dry0),
        wasReady: split((x) => !x.reloading0 && !x.dry0),
      };
    })(),
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
      + `travel@full=${r.travel.atFullSprintPct}% near@full=${r.nearField.atFullSprintPct}% `
      + `travel@ceil=${r.travel.atOwnCeilingPct}% near@ceil=${r.nearField.atOwnCeilingPct}% `
      + `sight<10=${r.perSighting.underTenPct}% noPath=${r.refusals['unstick:noPath'] ?? 0}% `
      + `inZone=${r.objective.inZonePct}% near20=${r.objective.within20mPct}% `
      + `score=${JSON.stringify(r.objective.score)}`);
  }
}
