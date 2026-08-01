/**
 * ONE PROBE FOR THE WHOLE ASK — "もっとAIが屋内に入って物資など回収したりビーコン
 * 起動したりするようにして" and "敵味方にスナイパーを…".
 *
 *   node _indoorplus.mjs --url=http://127.0.0.1:4293/?seed=7 --label=before
 *
 * Everything here is a number the two requests are actually judged on, sampled
 * on the SAME run so a before/after pair cannot be an artefact of two different
 * matches:
 *
 *   INDOOR      share of live-bot samples inside an enterable footprint, the
 *               strict (inset 0.6) variant, how many distinct men ever got in,
 *               and how many distinct BUILDINGS were entered at all.
 *   CACHES      `caches.stats.botTakes` — crates a BOT actually opened, which
 *               is not the same as footfall — plus the leg split by reason.
 *   BEACON      `stats.beacons` planted and `stats.beaconSpawns` used, and the
 *               forward-spawn share, because a planted beacon is a real respawn
 *               tier and moves where the whole side comes back in.
 *   SNIPER      per-archetype kills, shots, and THE HEIGHT the shot was fired
 *               from — measured as the muzzle's world Y minus the median bot Y,
 *               so "he shot from up there" is a number and not a screenshot.
 *   PRESSURE    A* solves per frame, deferrals per frame, ai ms and frame ms
 *               with the full 40-actor roster live.
 *
 * `objectives` is read straight off the agents once a frame, the same split
 * `tools/fightcheck.mjs` reports, so the two agree.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4293/';
const SCALE = Number(args.scale ?? 6);
const SAMPLES = Number(args.samples ?? 150);
const EVERY = Number(args.every ?? 250);
const LABEL = args.label ?? 'run';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

await page.evaluate((s) => { window.__ENGINE__.time.scale = s; }, SCALE);
await page.waitForFunction(
  () => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 180000 });

/* ---- in-page accumulators driven by the engine's own events + step ------- */
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const m = e.ctx.peek('match');
  const A = {
    frames: 0, aiMs: [], frameMs: [], deferred0: ai.stats.pathsDeferred ?? 0,
    budget: 0, deferred: 0, pathCost: 0,
    kills: {}, shots: {}, shotY: {}, medianY: [],
    objectives: {}, states: {},
    // muzzle height above the ground under the shooter, per archetype
    rise: {},
  };
  window.__A__ = A;

  const arch = (a) => a?.archetype ?? 'unknown';
  const origFire = ai.onAgentFire.bind(ai);
  ai.onAgentFire = (a, o, d) => {
    const k = arch(a);
    A.shots[k] = (A.shots[k] ?? 0) + 1;
    (A.shotY[k] ??= []).push(+o.y.toFixed(2));
    return origFire(a, o, d);
  };
  // Kill credit is `by` — @see `Agent.die`, which is the only emitter that
  // carries one. `source`/`killer` do not exist on this payload and reading
  // them scored every archetype zero.
  e.events.on('actor:death', (ev) => {
    const k = ev?.by?.archetype ?? null;
    if (k) A.kills[k] = (A.kills[k] ?? 0) + 1;
  });

  let acc = 0;
  for (const key of ['update', 'lateUpdate']) {
    const orig = ai[key].bind(ai);
    ai[key] = (...z) => { const t = performance.now(); orig(...z); acc += performance.now() - t; };
  }
  let lastRaw = performance.now();
  const step = e.step.bind(e);
  e.step = (now) => {
    step(now);
    const raw = performance.now();
    if (m.phase === 'live') {
      A.frames++;
      A.aiMs.push(acc);
      A.frameMs.push(raw - lastRaw);
      A.budget += ai.stats.pathBudget ?? 0;
      A.pathCost += ai.stats.pathCostMs ?? 0;
      for (const a of ai.agents) {
        if (!a.alive) continue;
        A.states[a.state] = (A.states[a.state] ?? 0) + 1;
        const o = a.objective ? a.objective.mode : 'none';
        A.objectives[o] = (A.objectives[o] ?? 0) + 1;
      }
    }
    acc = 0;
    lastRaw = raw;
  };
});

/* ---- per-tick sampling of position-derived facts ------------------------ */
const acc = {
  bots: 0, foot: 0, strict: 0, onLeg: 0, ticks: 0,
  perBuilding: {}, everIn: new Set(), seen: new Set(),
  // archetype -> [samples, samples-indoors, sum of (y - groundMedian)]
  archIn: {},
};

for (let i = 0; i < SAMPLES; i++) {
  const s = await page.evaluate(() => {
    const e = window.__ENGINE__;
    const ai = e.ctx.peek('ai');
    const world = e.ctx.peek('world');
    const m = e.ctx.peek('match');
    const V3 = m.sites[0].position.constructor;
    const scratch = new V3();
    const B = world.layout.BUILDINGS.filter((b) => b.enterable);
    let bots = 0, foot = 0, strict = 0, onLeg = 0;
    const per = {};
    const insideNames = [];
    const names = [];
    const arch = {};
    const ys = [];
    for (const a of ai.agents) {
      if (!a.alive) continue;
      bots++;
      names.push(a.name);
      ys.push(a.position.y);
      if (a._matchCache) onLeg++;
      const k = a.archetype ?? 'unknown';
      const r = (arch[k] ??= { n: 0, in: 0, y: 0 });
      r.n++;
      r.y += a.position.y;
      const l = world.worldToLevel(a.position.x, a.position.y, a.position.z, scratch);
      let hitFoot = null, hitIn = null;
      for (const b of B) {
        const dx = Math.abs(l.x - b.x) - b.w / 2;
        const dz = Math.abs(l.z - b.z) - b.d / 2;
        if (dx < 0 && dz < 0) {
          hitFoot = hitFoot ?? b.id;
          if (dx < -0.6 && dz < -0.6) hitIn = hitIn ?? b.id;
        }
      }
      if (hitFoot) { foot++; per[hitFoot] = (per[hitFoot] ?? 0) + 1; }
      if (hitIn) { strict++; insideNames.push(a.name); r.in++; }
    }
    ys.sort((p, q) => p - q);
    return {
      bots, foot, strict, onLeg, per, insideNames, names, arch,
      medianY: ys.length ? ys[ys.length >> 1] : 0,
    };
  });
  acc.bots += s.bots; acc.foot += s.foot; acc.strict += s.strict; acc.onLeg += s.onLeg;
  acc.ticks++;
  for (const k of Object.keys(s.per)) acc.perBuilding[k] = (acc.perBuilding[k] ?? 0) + s.per[k];
  for (const n of s.insideNames) acc.everIn.add(n);
  for (const n of s.names) acc.seen.add(n);
  for (const k of Object.keys(s.arch)) {
    const r = (acc.archIn[k] ??= { n: 0, in: 0, rise: 0 });
    r.n += s.arch[k].n; r.in += s.arch[k].in;
    r.rise += s.arch[k].y - s.arch[k].n * s.medianY;
  }
  await page.waitForTimeout(EVERY);
}

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const m = e.ctx.peek('match');
  const A = window.__A__;
  const st = m.caches?.stats ?? {};
  const q = (v, p) => (v.length ? +v.slice().sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * p))].toFixed(2) : NaN);
  const shotY = {};
  for (const k in A.shotY) {
    const v = A.shotY[k];
    shotY[k] = { n: v.length, p50: q(v, 0.5), p90: q(v, 0.9), max: +Math.max(...v).toFixed(2) };
  }
  return {
    frames: A.frames,
    aiMs: { mean: +(A.aiMs.reduce((a, b) => a + b, 0) / (A.aiMs.length || 1)).toFixed(2), p95: q(A.aiMs, 0.95) },
    frameMs: { mean: +(A.frameMs.reduce((a, b) => a + b, 0) / (A.frameMs.length || 1)).toFixed(2), p95: q(A.frameMs, 0.95) },
    pathBudgetPerFrame: +(A.budget / (A.frames || 1)).toFixed(2),
    pathCostMs: +(A.pathCost / (A.frames || 1)).toFixed(3),
    deferredTotal: (ai.stats.pathsDeferred ?? 0) - A.deferred0,
    deferredPerFrame: +(((ai.stats.pathsDeferred ?? 0) - A.deferred0) / (A.frames || 1)).toFixed(2),
    unstickRungs: [...(ai.stats.unstickRungs ?? [])],
    caches: {
      taken: st.taken ?? 0, botTakes: st.botTakes ?? 0, ammo: st.ammo ?? 0, frags: st.frags ?? 0,
      legsAmmo: st.legsAmmo ?? 0, legsGrenade: st.legsGrenade ?? 0,
      legsContest: st.legsContest ?? 0, legsVeteran: st.legsVeteran ?? 0, legsVantage: st.legsVantage ?? 0,
      botList: m.caches?.botList?.length ?? 0,
    },
    beacons: st.beacons ?? 0,
    beaconSpawns: st.beaconSpawns ?? 0,
    forwardSpawns: m._forwardSpawns ? [...m._forwardSpawns] : null,
    baseSpawns: m._baseSpawns ? [...m._baseSpawns] : null,
    kills: A.kills, shots: A.shots, shotY,
    objectives: A.objectives, states: A.states,
    score: m.score ? [...m.score] : null,
  };
});

const pct = (a, b) => (b ? +((a / b) * 100).toFixed(2) : 0);
const share = (h) => {
  const t = Object.values(h).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(h).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, pct(v, t)]));
};
console.log(JSON.stringify({
  label: LABEL, url: URL, ticks: acc.ticks, botSamples: acc.bots,
  indoor: {
    strictPct: pct(acc.strict, acc.bots),
    footprintPct: pct(acc.foot, acc.bots),
    distinctBotsEverInside: acc.everIn.size,
    botsSeen: acc.seen.size,
    distinctBuildingsEntered: Object.keys(acc.perBuilding).length,
    perBuildingPct: Object.fromEntries(Object.entries(acc.perBuilding)
      .sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, pct(v, acc.bots)])),
    meanBotsOnCacheLeg: +(acc.onLeg / acc.ticks).toFixed(2),
  },
  perArchetype: Object.fromEntries(Object.entries(acc.archIn).map(([k, r]) => [k, {
    samples: r.n, indoorPct: pct(r.in, r.n), meanYaboveMedian: +(r.rise / (r.n || 1)).toFixed(2),
  }])),
  ...out,
  objectives: share(out.objectives), states: share(out.states),
  errors: errors.slice(0, 6),
}, null, 1));

await browser.close();
process.exit(errors.length ? 1 : 0);
