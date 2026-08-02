/**
 * THE SIX THINGS, MEASURED IN ONE RUN.
 *
 * Every number the six-item brief asks for, from one boot, so a before and an
 * after are the same map, the same dice and the same clock:
 *
 *   1  rounds per trigger-pull, per magazine and per man-minute, and WHAT ENDS
 *      A BURST (burst counter ran out / target lost / no line of sight / gate).
 *   2  share of live men inside a capture circle, captures per match, and how
 *      many of a fireteam are on the same point at once.
 *   3  contact: share of actor-time with a target, share firing.
 *   4  men above 2.5 m, and man-seconds spent up there.
 *   5  weapon distribution across the roster.
 *   6  sniper engagement range distribution and firing height.
 *
 * Plus the static nav facts item 4 turns on: cells and cover points above
 * 2.5 m, how many of them share a component with the ground, climb/drop edges.
 *
 * Usage: node _sixaudit.mjs --url=http://127.0.0.1:4450/ --seed=7 [--samples=110]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4450/';
const SEEDS = String(args.seeds ?? args.seed ?? '7').split(',').map(Number);
/**
 * SCALE 1 IS NOT A MISTAKE AND IT IS THE WHOLE REASON THIS FILE EXISTS.
 *
 * `Engine.step` clamps a raw frame at 0.1 s and multiplies by `time.scale`, and
 * headless renders one frame every 80 ms — so `--scale=10` simulates in 0.8 s
 * steps. `Agent._shoot` fires AT MOST ONE ROUND PER FRAME (`fireCooldown` is
 * tested, not drained in a loop), so at that step size every weapon on the map
 * is capped at 1.25 rounds a second whatever its fire rate says. The first run
 * of this probe reported 1.7 rounds per man-minute and that number was an
 * artefact of its own clock. At scale 1 the step is 0.080 s against the
 * carbine's 0.095 s cycle, so the cap is above the rate and the reading is real.
 *
 * `roundTime` is 300 s, so the window is deliberately under one round: the
 * round reset zeroes `capture.stats` and every zone owner, and the first run
 * measured 944 s and reported "0 captures, all zones neutral" for that reason.
 */
const SAMPLES = +(args.samples ?? 120);
const EVERY = +(args.every ?? 20);
const SCALE = +(args.scale ?? 1);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const out = [];
for (const seed of SEEDS) {
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(`${URL}?seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

  const wait = (n) => page.evaluate((k) => new Promise((r) => {
    let i = 0; const t = () => (++i >= k ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
  }), n);

  /* ---------------- static nav facts ---------------- */
  const nav = await page.evaluate(() => {
    const ai = window.__ENGINE__.ctx.peek('ai');
    const g = ai.grid, cm = ai.cover;
    const r = {
      cells: g.nx * g.nz, walkable: g.walkableCount, interiorCells: g.interiorCells,
      components: g.components, biggest: g.biggestComponent,
      climbEdges: g.climbEdges, dropEdges: g.dropEdges,
    };
    // the component every man actually stands on = the biggest
    let bigComp = -1, bigN = -1;
    for (let c = 0; c < g.compSize.length; c++) if (g.compSize[c] > bigN) { bigN = g.compSize[c]; bigComp = c; }
    r.groundComp = bigComp; r.groundCells = bigN;
    // walkable cells above 2.5 m, and how many are on the ground component
    let high = 0, highOnGround = 0, highComps = new Set();
    const ground = g.floor[0];
    for (let i = 0; i < g.flags.length; i++) {
      if (!g.flags[i]) continue;
      if (!(g.floor[i] > 2.5)) continue;
      high++;
      if (g.comp[i] === bigComp) highOnGround++;
      highComps.add(g.comp[i]);
    }
    r.highCells = high; r.highCellsOnGroundComp = highOnGround; r.highComponents = highComps.size;
    // cover points
    const pts = cm.points ?? cm.list ?? [];
    let cHigh = 0, cHighReach = 0, cIndoor = 0;
    for (const p of pts) {
      if (p.y > 2.5) {
        cHigh++;
        const ix = g.cellX(p.x), iz = g.cellZ(p.z);
        if (g.inside(ix, iz) && g.comp[g.index(ix, iz)] === bigComp) cHighReach++;
      }
      if (p.indoor) cIndoor++;
    }
    r.coverPoints = pts.length; r.coverAbove25 = cHigh;
    r.coverAbove25OnGroundComp = cHighReach; r.coverIndoor = cIndoor;
    return r;
  });

  /* ---------------- live counters ---------------- */
  await page.evaluate((sc) => { window.__ENGINE__.ctx.time.scale = sc; }, SCALE);
  await page.waitForFunction(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    return m && String(m.phase).toLowerCase() === 'live';
  }, null, { timeout: 120000 }).catch(() => {});
  await wait(40);

  await page.evaluate(() => {
    const e = window.__ENGINE__, ai = e.ctx.peek('ai');
    const S = {
      t0: e.time.elapsed, f0: e.time.frame,
      bursts: [],           // rounds per trigger pull
      burstEnd: {},         // why a burst ended
      mags: [],             // rounds fired between reloads
      fires: 0,
      perMan: new Map(),    // id -> { fired, weapon, archetype, seconds }
      sniperRange: [], sniperY: [], fireY: [], engagements: [],
      onPoint: [], aliveN: [], highMen: [], ftOnPoint: [],
      withTarget: 0, firing: 0, actorSamples: 0,
      manSecondsHigh: 0, manSeconds: 0,
      states: {}, flips: 0, flipsBy: [0, 0], lastOwner: [],
      highNames: {},
    };
    window.__S__ = S;

    // per-agent live instrumentation, installed by wrapping the AI step.
    const track = new Map();  // agent -> { burst, sinceReload, lastAmmo }
    const origFire = ai.onAgentFire.bind(ai);
    ai.onAgentFire = (agent, origin, dir) => {
      S.fires++;
      let t = track.get(agent);
      if (!t) { t = { burst: 0, sinceReload: 0, eng: 0 }; track.set(agent, t); }
      t.burst++; t.sinceReload++; t.eng++;
      const pm = S.perMan.get(agent.name ?? agent.id) ?? { fired: 0, weapon: agent.weaponId ?? 'carbine', archetype: agent.archetype, team: agent.team };
      pm.fired++; S.perMan.set(agent.name ?? agent.id, pm);
      S.fireY.push(+origin.y.toFixed(2));
      if (agent.sniper) {
        S.sniperY.push(+agent.position.y.toFixed(2));
        if (agent.hasTarget) S.sniperRange.push(+agent.position.distanceTo(agent.lastKnown).toFixed(1));
      }
      origFire(agent, origin, dir);
    };
    const origReload = ai.emitReload.bind(ai);
    ai.emitReload = (agent) => {
      const t = track.get(agent);
      if (t && t.sinceReload > 0) { S.mags.push(t.sinceReload); t.sinceReload = 0; }
      origReload(agent);
    };
    window.__TRACK__ = track;

    // burst-end reasons, sampled off the agents themselves each engine frame
    const step = e.step.bind(e);
    const m = e.ctx.peek('match');
    const zones = m && m.capture ? m.capture.zones : [];
    let lastT = e.time.elapsed;
    e.step = (now) => {
      step(now);
      const dt = e.time.elapsed - lastT; lastT = e.time.elapsed;
      for (const a of ai.agents) {
        if (!a.alive) continue;
        const t = track.get(a);
        if (t && t.burst > 0) {
          // the trigger pull is over the moment the man stops wanting to fire
          // or the burst counter empties.
          if (!a.wantFire || a.burstLeft <= 0) {
            S.bursts.push(t.burst);
            const why = !a.wantFire
              ? (a.ammo <= 0 ? 'dry/reload'
                : !a.hasTarget ? 'target-lost'
                  : !a.targetVisible ? 'no-LOS'
                    : !a.peeking ? 'ducked'
                      : 'gate')
              : 'burst-count';
            S.burstEnd[why] = (S.burstEnd[why] ?? 0) + 1;
            t.burst = 0;
          }
        }
        // ONE ENGAGEMENT = one continuous spell in COMBAT.
        if (t && t.eng > 0 && a.state !== 'combat') { S.engagements.push(t.eng); t.eng = 0; }
        S.manSeconds += dt;
        if (a.position.y > 2.5) {
          S.manSecondsHigh += dt;
          S.highNames[a.name ?? a.id] = +((S.highNames[a.name ?? a.id] ?? 0) + dt).toFixed(1);
        }
      }
    };

    window.__TICK__ = () => {
      // A CAPTURE IS A ZONE CHANGING HANDS, counted here rather than read off
      // `capture.stats`, which the round reset zeroes.
      for (let i = 0; i < zones.length; i++) {
        const o = zones[i].owner;
        if (S.lastOwner[i] === undefined) { S.lastOwner[i] = o; continue; }
        if (o !== S.lastOwner[i] && o >= 0) { S.flips++; S.flipsBy[o] = (S.flipsBy[o] ?? 0) + 1; }
        S.lastOwner[i] = o;
      }
      let alive = 0, on = 0, high = 0;
      for (const a of ai.agents) {
        if (!a.alive) continue;
        alive++;
        S.actorSamples++;
        S.states[a.state] = (S.states[a.state] ?? 0) + 1;
        if (a.targetActor) S.withTarget++;
        if (a.wantFire) S.firing++;
        if (a.position.y > 2.5) high++;
        for (const z of zones) {
          const dx = z.position.x - a.position.x, dz = z.position.z - a.position.z;
          if (dx * dx + dz * dz <= z.radius * z.radius) { on++; break; }
        }
      }
      if (alive) { S.onPoint.push(on / alive); S.aliveN.push(alive); S.highMen.push(high); }
      // how many of a fireteam are on the same capture point
      for (const sq of (ai.squads ?? [])) {
        for (const ft of (sq.fireteams ?? [])) {
          let n = 0;
          for (const mm of ft.members) {
            if (!mm.alive) continue;
            for (const z of zones) {
              const dx = z.position.x - mm.position.x, dz = z.position.z - mm.position.z;
              if (dx * dx + dz * dz <= z.radius * z.radius) { n++; break; }
            }
          }
          S.ftOnPoint.push(n);
        }
      }
    };
  });

  for (let i = 0; i < SAMPLES; i++) { await wait(EVERY); await page.evaluate(() => window.__TICK__()); }

  const live = await page.evaluate(() => {
    const e = window.__ENGINE__, ai = e.ctx.peek('ai'), m = e.ctx.peek('match');
    const S = window.__S__;
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const stat = (a) => {
      if (!a.length) return null;
      const s = [...a].sort((x, y) => x - y);
      return {
        n: s.length, min: s[0], p25: s[(s.length * 0.25) | 0], med: s[(s.length * 0.5) | 0],
        p75: s[(s.length * 0.75) | 0], p95: s[(s.length * 0.95) | 0], max: s[s.length - 1],
        mean: +avg(s).toFixed(2),
      };
    };
    const gm = (e.time.elapsed - S.t0) / 60 || 1e-9;
    // roster loadout: read live agents' declared weapon
    const wep = {}, wepByArch = {};
    for (const a of ai.agents) {
      const w = a.weaponId ?? (a.sniper ? 'sniper' : 'carbine');
      wep[w] = (wep[w] ?? 0) + 1;
      const k = a.archetype + ':' + w;
      wepByArch[k] = (wepByArch[k] ?? 0) + 1;
    }
    const cs = m && m.capture ? m.capture.stats : null;
    return {
      gameSeconds: +(e.time.elapsed - S.t0).toFixed(1),
      frames: e.time.frame - S.f0,
      fires: S.fires,
      roundsPerMinPerMan: +(S.fires / gm / Math.max(1, avg(S.aliveN))).toFixed(1),
      roundsPerTriggerPull: stat(S.bursts),
      burstEndReasons: S.burstEnd,
      roundsPerMagazine: stat(S.mags),
      shotsPerEngagement: stat(S.engagements),
      onPointShare: +avg(S.onPoint).toFixed(3),
      fireteamMenOnPoint: stat(S.ftOnPoint),
      zoneFlips: S.flips,
      zoneFlipsBySide: S.flipsBy,
      captures: cs ? cs.captures : null,
      score: m ? [...m.score] : null,
      zoneOwners: m && m.capture ? m.capture.zones.map((z) => `${z.name}:${z.owner}`) : null,
      meanAlive: +avg(S.aliveN).toFixed(1),
      menAbove25: stat(S.highMen),
      manSecondsAbove25: +S.manSecondsHigh.toFixed(1),
      menWhoWentAbove25: S.highNames,
      shareTimeAbove25: +(S.manSecondsHigh / Math.max(1e-9, S.manSeconds) * 100).toFixed(2),
      withTargetShare: +(S.withTarget / Math.max(1, S.actorSamples)).toFixed(3),
      firingShare: +(S.firing / Math.max(1, S.actorSamples)).toFixed(3),
      stateShare: Object.fromEntries(Object.entries(S.states)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, +((v / Math.max(1, S.actorSamples)) * 100).toFixed(1)])),
      weapons: wep,
      weaponsByArchetype: wepByArch,
      sniperRange: stat(S.sniperRange),
      sniperFiringY: stat(S.sniperY),
      allFiringY: stat(S.fireY),
      levelSeed: e.levelSeed,
    };
  });

  out.push({ seed, nav, ...live, pageerrors: errs.slice(0, 6) });
  await page.close();
}

console.log(JSON.stringify(out, null, 1));
await browser.close();
