/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY CAN'T THIS MAN FIND A ROUTE? — the census behind `unstick:noPath`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node _noroute.mjs --url=http://127.0.0.1:4577/ --seeds=7,11 [--map=town]
 *                     [--warm=120] [--window=150]
 *
 * `_engage.mjs` says `unstick:noPath` is 8-10 % of every travel refusal and that
 * 68 % of it is `objectiveBlocked` — a man who came out of the bottom of
 * `Agent._advanceFallback` with `desiredSpeed = 0`. It does not say WHY A* found
 * nothing, and the two possible answers want opposite fixes:
 *
 *   STRUCTURALLY UNREACHABLE  the destination is on an upper storey, a roof, or
 *     the far side of a carve — a place `NavGrid` labels into a component that
 *     no walk from the ground can enter. No route can ever exist. That is a BAD
 *     REQUEST and it should be refused before A* is asked, not fallen back from.
 *   TEMPORARILY BLOCKED  start and goal are joined (or joined by a fall), and
 *     the solve still failed — a spent frame ration, a re-anchor that missed,
 *     the cross-component node cap, a man briefly off the height field. That is
 *     a real navigation problem and the man should keep walking.
 *
 * HOW THE SPLIT IS DECIDED, and it is decided by the grid rather than by a
 * guess: at the instant `_advanceFallback` gives up, the same two `nearest`
 * calls `findPath` makes are repeated, the component labels of both ends are
 * read, and then the query is RE-RUN WITH NO BUDGET (`maxNodes` 4e6). A route
 * that appears when the ceiling is lifted was never structural — it was the cap.
 * A run that still returns 0 with the whole grid available is geometry.
 *
 * The unbudgeted solve is expensive (a full sweep, ~40 ms) so it is rationed to
 * one per agent per `RECHECK` seconds and it runs on a SCRATCH array — the
 * agent's own `path` is never touched, so measuring cannot change what is
 * measured.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4577/';
const SEEDS = String(args.seeds ?? args.seed ?? '7').split(',');
const MAP = args.map ?? 'town';
const WARM = +(args.warm ?? 120);
const WINDOW = +(args.window ?? 150);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const rows = [];
for (const seed of SEEDS) {
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(`${URL}?capture=1&map=${MAP}&seed=${seed}`, { waitUntil: 'domcontentloaded' });
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

    const RECHECK = 4;      // s between unbudgeted re-solves for one man
    const g = ai.grid;
    const S = {
      grid: g ? { nx: g.nx, nz: g.nz, cell: g.cell, comps: g.components,
        maxNodes: g.maxNodes } : null,
      giveUps: 0, fallbackCalls: 0, fallbackRescued: 0, fallbackPending: 0,
      why: Object.create(null),           // the split, at the give-up
      whyMode: Object.create(null),       // ...crossed with the objective's verb
      goalFloor: [],                      // height of the goal cell, per give-up
      goalDist: [],
      /* per-frame census of ADVANCE men with no route */
      advSamples: 0, noRoute: 0, noRouteBlocked: 0, blockedFrames: 0,
      blockedButWalking: 0, blockedButMoving: 0,
      noRouteWhy: Object.create(null),
      stillFrames: 0, stillBlocked: 0,
      men: Object.create(null),
      ticks: 0,
      /**
       * ══════════════════════════════════════════════════════════════════════
       * AND THE OTHER HALF OF THE QUESTION: WHY IS A THIRD OF TRAVEL UNDER 5 m/s
       * ══════════════════════════════════════════════════════════════════════
       * The ease fix moved travel at a man's own ceiling 47.3 -> 60.7 % and left
       * the sub-5 tail at 32.2 %, which was attributed to nav failure and cover
       * work rather than to acceleration. Nobody measured it. So every travel
       * sample under 5 m/s is charged, first-true-wins, to one of:
       *
       *   asked:stand   `desiredSpeed <= 0.1` — a statue. NOT a leg problem.
       *   asked:walk    `desiredSpeed < 5` — he was never asked to go faster:
       *                 `inSector` work, a `hold` verb, a man on his own ground.
       *                 This is the "cover work" hypothesis, and it is not a bug.
       *   ramping       asked for >= 5, sprinting, and STILL SPEEDING UP. This
       *                 is the acceleration hypothesis, and `SPEED_RISE` owns it.
       *   noWaypoint    asked for a run, nothing to walk at. The nav hypothesis.
       *   turning/crowd/other  the remainder, in `_move`'s own terms.
       */
      slowWhy: Object.create(null), slowSamples: 0, fastSamples: 0,
      slowSpeedSum: 0,
    };
    const prevSpeed = new Map();
    const scratch = [];
    const lastCheck = new Map();
    const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

    /**
     * THE CLASSIFIER. Everything it asks, `NavGrid.findPath` asks first — the
     * two `nearest` calls, the component compare, the island re-anchor and the
     * `escape` (one-way fall) test — so a verdict here is the verdict the
     * planner reached, with one extra question the planner is not allowed to
     * ask: what happens with no node ceiling at all.
     */
    const classify = (a, dest) => {
      if (!g) return 'noGrid';
      const here = g.nearest(a.position.x, a.position.z, a.position.y, 3, 1.5);
      if (here < 0) return 'offGrid';
      let start = g.nearest(a.position.x, a.position.z, a.position.y);
      let goal = g.nearest(dest.x, dest.z, dest.y);
      if (start < 0) return 'offGrid';
      if (goal < 0) return 'goalOffGrid';
      const cs = g.comp[start], cg = g.comp[goal];
      const descends = g.escape?.length > 0 && cs >= 0 && cg >= 0 && g.escape[cs] === cg;
      let reanchored = false;
      if (cs !== cg && !descends) {
        // the same re-anchor `findPath` performs, smaller end first
        const sz = g.componentSize(start), gz = g.componentSize(goal);
        const reS = () => { const s2 = g.nearest(a.position.x, a.position.z, a.position.y, 14, Infinity, cg); if (s2 >= 0) { start = s2; return true; } return false; };
        const reG = () => { const g2 = g.nearest(dest.x, dest.z, dest.y, 14, Infinity, cs); if (g2 >= 0) { goal = g2; return true; } return false; };
        reanchored = sz <= gz ? (reS() || reG()) : (reG() || reS());
      }
      const joined = g.comp[start] === g.comp[goal];
      /* THE DECIDING QUESTION: does a route exist with the ceiling lifted? */
      const n = g.findPath(a.position, dest, scratch, { maxNodes: 4000000 });
      if (n > 0) {
        // A route DOES exist. So the refusal was the budget or the cap.
        return joined ? 'blocked:capOrRation' : 'blocked:crossCompCap';
      }
      /* No route with the whole grid available: geometry. Say which geometry. */
      const gy = g.floor[goal], ay = g.floor[start];
      if (gy - ay > 2.0) return 'structural:above';        // upper storey or roof
      if (g.componentSize(goal) <= 4) return 'structural:goalIsland';
      if (g.componentSize(start) <= 4) return 'structural:manIsland';
      return reanchored ? 'structural:severed' : 'structural:otherComponent';
    };

    /* ---- wrap `_advanceFallback` on the prototype ------------------- */
    const proto = Object.getPrototypeOf(ai.agents[0]);
    const orig = proto._advanceFallback;
    proto._advanceFallback = function (obj) {
      S.fallbackCalls++;
      orig.call(this, obj);
      if (this.pathPending) { S.fallbackPending++; return; }
      if (this.hasMoveTarget) { S.fallbackRescued++; return; }
      S.giveUps++;
      const k = this.name ?? String(this.id);
      const now = e.time.elapsed;
      const w = (lastCheck.get(k + ':t') ?? -1e9) + RECHECK > now
        ? (lastCheck.get(k + ':w') ?? 'repeat')
        : classify(this, obj.position);
      lastCheck.set(k + ':t', now);
      lastCheck.set(k + ':w', w);
      bump(S.why, w);
      bump(S.whyMode, `${obj.mode}:${w.split(':')[0]}`);
      S.men[k] = (S.men[k] ?? 0) + 1;
      const gi = g ? g.nearest(obj.position.x, obj.position.z, obj.position.y) : -1;
      if (gi >= 0) S.goalFloor.push(+(g.floor[gi]).toFixed(2));
      S.goalDist.push(+this.position.distanceTo(obj.position).toFixed(1));
    };

    const tStart = t();
    while (t() - tStart < WINDOW && m.phase === 'live' && m.roundClock > 0) {
      await frame();
      S.ticks++;
      for (const a of ai.agents) {
        if (!a.alive) continue;
        /**
         * IS THE FLAG STALE. `objectiveBlocked` is cleared only by a genuinely
         * DIFFERENT order arriving (`setObjective`), so a man who was blocked
         * once and is walking happily now still carries it — and `_unstick`
         * reads it as "pin this man on rung 5", which switches off rungs 1-4
         * for the rest of that objective.
         */
        if (a.objectiveBlocked) {
          S.blockedFrames++;
          if (a.hasMoveTarget) S.blockedButWalking++;
          if (a.speed > 1.0) S.blockedButMoving++;
        }
        if ((a.desiredSpeed ?? 0) <= 0.1) {
          S.stillFrames++;
          if (a.objectiveBlocked) S.stillBlocked++;
        }
        const o = a.objective;
        if (!o || a.state !== 'advance') continue;
        const dist = Math.hypot(o.position.x - a.position.x, o.position.z - a.position.z);
        if (dist < 16) continue;
        S.advSamples++;
        /* ---- the sub-5 tail, charged. @see `slowWhy`. ---------------- */
        const k = a.name ?? String(a.id);
        const prev = prevSpeed.get(k) ?? 0;
        prevSpeed.set(k, a.speed);
        if (a.speed < 5) {
          S.slowSamples++;
          S.slowSpeedSum += a.speed;
          const ms = a.moveScale ?? 1;
          const ceil = a._sprintCeiling ?? (6.4492 * (ms >= 1 ? ms : 0.5 + ms * 0.5));
          const dot = Math.sin(a.yaw) * (a._steer?.x ?? 0) + Math.cos(a.yaw) * (a._steer?.z ?? 0);
          /**
           * AND IF HE WAS NEVER ASKED FOR MORE THAN A WALK, WHY NOT — which is
           * `_sprintGate`'s own refusal, in the gate's own order, because a
           * refused sprint IS a `desiredSpeed` of 4.3 x haste and that is what
           * a sub-5 sample is. This is the join between the two boards.
           */
          const thr = a._sprintThreatR ?? 10;
          const gate = a.hasTarget || a.suppression > 0.15 ? 'contact'
            : a.working || a.post || a.postClimbing || a.crouch ? 'busy'
              : !a.hasMoveTarget ? (a.pathPending ? 'pending' : 'noPath')
                : a._detourTimer > 0 ? 'detour'
                  : a.stuckRung !== 0 ? 'rung'
                    : a.lastKnownAge < 4
                      && a.position.distanceToSquared(a.lastKnown) < thr * thr ? 'threatcall'
                      : !a._sprintArmed ? 'winded'
                        : a._ahead > 1 ? 'crowd' : 'turningOrPassed';
          bump(S.slowWhy,
            (a.desiredSpeed ?? 0) <= 0.1 ? 'asked:stand'
              : (a.desiredSpeed ?? 0) < 5 ? `asked:walk:${gate}`
                : a.sprinting && a.speed > prev + 0.02 && a.speed < ceil * 0.98 ? 'ramping'
                  : !a.hasMoveTarget ? 'noWaypoint'
                    : (a._ahead ?? 0) > 0 ? 'crowd'
                      : dot < 0.55 ? 'turning'
                        : a.sprinting ? 'grantedButSlow' : 'refused');
        } else S.fastSamples++;
        if (a.hasMoveTarget || a.pathPending) continue;
        S.noRoute++;
        if (a.objectiveBlocked) S.noRouteBlocked++;
        bump(S.noRouteWhy, a.objectiveBlocked ? 'objectiveBlocked'
          : a._offGrid?.() ? 'offGrid'
            : a.repathTimer > 0 ? 'waitingOnRepathTimer'
              : a._detourTimer > 0 ? 'detour'
                : a.stuckRung !== 0 ? `rung${a.stuckRung}` : 'other');
      }
    }
    proto._advanceFallback = orig;
    return S;
  }, { WARM, WINDOW });

  await page.close();
  const pct = (n, d) => +(100 * n / Math.max(1, d)).toFixed(1);
  const struct = Object.entries(out.why).filter(([k]) => k.startsWith('structural'))
    .reduce((s, [, v]) => s + v, 0);
  const blocked = Object.entries(out.why).filter(([k]) => k.startsWith('blocked'))
    .reduce((s, [, v]) => s + v, 0);
  const repeat = out.why.repeat ?? 0;
  const classified = struct + blocked;
  rows.push({
    seed, map: args.map ?? 'town', pageerrors: errs, grid: out.grid, ticks: out.ticks,
    fallback: {
      calls: out.fallbackCalls, rescued: out.fallbackRescued,
      pending: out.fallbackPending, gaveUp: out.giveUps,
      gaveUpPct: pct(out.giveUps, out.fallbackCalls),
    },
    /* THE SPLIT */
    split: {
      structural: struct, temporarilyBlocked: blocked, cachedRepeat: repeat,
      structuralPct: pct(struct, classified), blockedPct: pct(blocked, classified),
    },
    why: out.why,
    whyMode: out.whyMode,
    goalFloorMedian: (() => { const s = [...out.goalFloor].sort((a, b) => a - b); return s[(s.length / 2) | 0] ?? null; })(),
    goalDistMedian: (() => { const s = [...out.goalDist].sort((a, b) => a - b); return s[(s.length / 2) | 0] ?? null; })(),
    menWhoGaveUp: Object.keys(out.men).length,
    advance: {
      samples: out.advSamples, noRoute: out.noRoute,
      noRoutePct: pct(out.noRoute, out.advSamples),
      blockedShareOfNoRoute: pct(out.noRouteBlocked, out.noRoute),
      why: out.noRouteWhy,
    },
    flag: {
      frames: out.blockedFrames,
      staleWalkingPct: pct(out.blockedButWalking, out.blockedFrames),
      staleMovingPct: pct(out.blockedButMoving, out.blockedFrames),
    },
    still: { frames: out.stillFrames, blockedPct: pct(out.stillBlocked, out.stillFrames) },
    /* THE SUB-5 TAIL. @see `slowWhy`. */
    slow: {
      samples: out.slowSamples,
      shareOfTravelPct: pct(out.slowSamples, out.slowSamples + out.fastSamples),
      meanSpeed: +(out.slowSpeedSum / Math.max(1, out.slowSamples)).toFixed(2),
      why: Object.fromEntries(Object.entries(out.slowWhy)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, pct(v, out.slowSamples)])),
    },
  });
  console.log(JSON.stringify(rows[rows.length - 1], null, 2));
}
await browser.close();
console.log('\n=== SUMMARY ===');
for (const r of rows) {
  console.log(`${r.map} seed ${r.seed}: give-ups ${r.fallback.gaveUp}/${r.fallback.calls} ` +
    `(${r.fallback.gaveUpPct} %) · structural ${r.split.structuralPct} % · ` +
    `blocked ${r.split.blockedPct} % · noPath ${r.advance.noRoutePct} % of advance ` +
    `· flag stale-while-walking ${r.flag.staleWalkingPct} %`);
  console.log(`   under 5 m/s ${r.slow.shareOfTravelPct} % of travel · ` +
    Object.entries(r.slow.why).map(([k, v]) => `${k} ${v}`).join(' · '));
}
