/**
 * ════════════════════════════════════════════════════════════════════════════
 * DO THE BOTS BEHAVE WITH 8 546 m² OF THE MAP TAKEN OFF THE GRID?
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _sfbots.mjs [--url=…] [--secs=170] [--scale=6] [--seed=N] [--nodeny]
 *
 * `tools/stuckcheck.mjs` is the gate for this question and it boots, measures
 * and exits — it only ever sees the INTACT map, which is exactly the hole
 * `Airstrike._verifyRoutes` was written about. The nav denial happens 18 s into
 * an act that fires four hundred seconds into a match, so no boot gate in this
 * repo can see it.
 *
 * So this plays a live round, fires the crash the moment it goes live, and then
 * asks the three questions the user's own standing complaints are about —
 * 「もっと動き回れ」「占領しにいけ」:
 *
 *   1. IS ANYBODY STUCK? Same rule as `stuckcheck`: a man who moves under 0.6 m
 *      between samples 1.5 s apart, five samples running.
 *   2. ARE THEY STILL PLAYING THE OBJECTIVE? How many live men are inside a
 *      capture circle, sampled throughout, and how far the fireteams travel.
 *   3. IS ANYBODY IN THE FIRE? A man standing in a region that has been taken
 *      off the grid is a man A* put there, and there should be none of them
 *      once the ones caught inside have died.
 *
 * `--nodeny` runs the identical round with `Skyfall._deny` stubbed out, so
 * every number above has an A/B against the same event WITHOUT the hole. That
 * is the only way to say whether the hole costs movement or buys it.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4630/?map=plains';
const SECS = Number(args.secs ?? 170);
const SCALE = Number(args.scale ?? 6);
const NODENY = !!args.nodeny;

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
const notes = []; p.on('console', (m) => { const t = m.text(); if (/skyfall\]/.test(t)) notes.push(t.slice(0, 200)); });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const lvl = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
console.log(`level.id=${lvl}  deny=${!NODENY}  ${SECS} match seconds at x${SCALE}`);

await p.evaluate(() => (window.__ENGINE__.time.scale = 8));
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });

await p.evaluate(([SCALE, NODENY]) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  m._checkWinConditions = () => {};
  e.time.scale = SCALE;
  const s = m.crash._sky;
  if (NODENY) s._deny = () => {};
  m.crash.fire();
  /** One sample every 1.5 MATCH seconds, on the match clock, not the wall. */
  window.__S__ = [];
  window.__LAST__ = new Map();
  window.__STREAK__ = new Map();
  window.__STUCK__ = new Set();
  window.__INFIRE__ = 0;
  window.__DIST__ = new Map();
  let acc = 0;
  const ai = e.ctx.peek('ai');
  const orig = e.step.bind(e);
  e.step = (t) => {
    const r = orig(t);
    acc += e.time.dt;
    if (acc < 1.5) return r;
    acc = 0;
    let live = 0; let onPoint = 0; let inFire = 0;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      live++;
      const prev = window.__LAST__.get(a.id);
      const d = prev ? Math.hypot(a.position.x - prev[0], a.position.z - prev[1]) : 99;
      window.__LAST__.set(a.id, [a.position.x, a.position.z]);
      window.__DIST__.set(a.id, (window.__DIST__.get(a.id) ?? 0) + (prev ? d : 0));
      const st = d < 0.6 ? (window.__STREAK__.get(a.id) ?? 0) + 1 : 0;
      window.__STREAK__.set(a.id, st);
      if (st >= 5) window.__STUCK__.add(a.id);
      for (const site of m.sites) {
        if (a.position.distanceTo(site.position) <= (site.radius ?? 14)) { onPoint++; break; }
      }
      if (s._live && s._inside(a.position.x, a.position.z)) inFire++;
    }
    window.__INFIRE__ = Math.max(window.__INFIRE__, inFire);
    window.__S__.push({ t: +(1200 - m.roundClock).toFixed(0), live, onPoint, inFire, denied: !!s._denied });
    return r;
  };
}, [SCALE, NODENY]);

const t0 = Date.now();
for (;;) {
  await p.evaluate(() => new Promise((r) => { let i = 0; const t = () => (++i >= 90 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }));
  const n = await p.evaluate(() => window.__S__.length);
  if (n * 1.5 >= SECS || Date.now() - t0 > 900000) break;
}

const out = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  const s = m.crash._sky;
  const g = ai.grid;
  const path = [];
  const V3 = e.camera.position.constructor;
  const ph = e.ctx.peek('physics');
  const snap = (x, z) => {
    const i = g.nearest(x, z, ph.groundHeight(x, z, 400), 14, 6);
    return i < 0 ? null : new V3(g.worldX(i % g.nx), g.floor[i], g.worldZ((i / g.nx) | 0));
  };
  let solved = 0; let total = 0;
  for (const kind of ['attack', 'defend']) {
    for (const sp of m.spawns[kind]) {
      for (const site of m.sites) { total++; if (g.findPath(sp.position, site.position, path) > 0) solved++; }
    }
  }
  const dists = [...window.__DIST__.values()].sort((a, b) => a - b);
  const S = window.__S__;
  const half = S.slice(Math.floor(S.length / 2));
  const mean = (a, k) => (a.length ? a.reduce((x, y) => x + y[k], 0) / a.length : 0);
  return {
    samples: S.length, denied: s._denied, live: s._live,
    stuck: window.__STUCK__.size, agents: ai.agents.length,
    maxInFire: window.__INFIRE__,
    lastInFire: S.length ? S[S.length - 1].inFire : -1,
    onPointMean: +mean(half, 'onPoint').toFixed(2),
    liveMean: +mean(half, 'live').toFixed(1),
    travelMedian: +(dists[dists.length >> 1] ?? 0).toFixed(0),
    travelMin: +(dists[0] ?? 0).toFixed(0),
    barelyMoved: dists.filter((d) => d < 15).length,
    routes: `${solved}/${total}`,
    walkable: (() => { let n = 0; for (let i = 0; i < g.flags.length; i++) if (g.flags[i]) n++; return n; })(),
  };
});

for (const n of notes) console.log(' ', n);
console.log(`\n  samples ${out.samples} · region denied=${out.denied} live=${out.live} · ${out.walkable} walkable cells`);
console.log(`  bots stuck >=5 consecutive samples: ${out.stuck} / ${out.agents}`);
console.log(`  bots that barely moved (<15 m): ${out.barelyMoved} / ${out.agents} · median travel ${out.travelMedian} m, min ${out.travelMin} m`);
console.log(`  men standing ON a capture circle, mean over the second half: ${out.onPointMean} of ${out.liveMean} alive`);
console.log(`  men inside the fire: worst sample ${out.maxInFire}, last sample ${out.lastInFire}`);
console.log(`  spawn->site routes at the end: ${out.routes}`);
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '0 pageerrors');
await b.close();
