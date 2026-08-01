/**
 * THE BLOB, MEASURED — "AI全員が行動経路が一緒で同じ動きだとゲーム性が悪い".
 *
 * ONE AGREED STATISTIC, and it is a WORST CASE, because the player judges by
 * looking at a pack and not by reading a mean: for every live man, how many of
 * HIS OWN SIDE's live men are inside an 8 m circle centred on him (himself
 * included). `worst` is the largest such count anywhere in the run; `p95` and
 * `mean` are the same population's tail and centre, reported beside it so a
 * change that moves the middle and not the tail cannot be sold as a fix.
 *
 * MEN INSIDE 30 m OF A BASE SPAWN POINT ARE EXCLUDED. Both sides' base pockets
 * are 21 authored points in a small area and men are SUPPOSED to be shoulder to
 * shoulder there; counting it measures the spawn, not the behaviour. Forward
 * spawns are NOT excluded — a pack that forms on a captured point is exactly
 * what the complaint is about.
 *
 * What the first version of this file got wrong, all three of them fixed here:
 *   1. `e.timeScale = 8` DID NOTHING. There is no `timeScale` on the engine —
 *      the clock is `ctx.time.scale` — so the run was real time and covered
 *      about a fifth of the match it claimed to.
 *   2. It reported a maximum ONLY, over one boot, on an unpinned level seed, so
 *      before/after were two different maps as well as two different builds.
 *      `--seed=` pins the level and `--seeds=1,2,3` runs several and pools them.
 *   3. It had no guard on the men being anywhere useful, so "less clumped"
 *      could have meant "scattered off the objective". `onPoint` is the share
 *      of live men standing inside a capture circle and it has to hold up.
 *
 * Usage: node _clump.mjs --url=http://127.0.0.1:4365/ --seeds=1,2,3 [--samples=90]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4365/';
const SEEDS = String(args.seeds ?? '1').split(',').map(Number);
const SAMPLES = +(args.samples ?? 90);
const EVERY = +(args.every ?? 12);
const SCALE = +(args.scale ?? 8);
const RADIUS = +(args.radius ?? 8);
const BASE = +(args.base ?? 30);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const pooled = [[], []];
const perSeed = [];

for (const seed of SEEDS) {
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${URL}?seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

  const wait = (n) => page.evaluate((k) => new Promise((r) => {
    let i = 0; const t = () => (++i >= k ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
  }), n);

  await page.evaluate((sc) => {
    const e = window.__ENGINE__;
    e.ctx.time.scale = sc;      // the real clock handle; `e.timeScale` does not exist
  }, SCALE);
  // let the round actually start before anything is counted
  await page.waitForFunction(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    return m && (m.phase === 'live' || m.phase === 'LIVE');
  }, null, { timeout: 120000 }).catch(() => {});
  await wait(60);

  await page.evaluate(({ R, B }) => {
    const e = window.__ENGINE__, ai = e.ctx.peek('ai'), m = e.ctx.peek('match');
    const bases = [...m.spawns.attack, ...m.spawns.defend].map((s) => s.position);
    const zones = m.capture ? m.capture.zones : [];
    window.__C__ = { counts: [[], []], onPoint: [], routes: [[], []], alive: [[], []] };
    window.__TICK__ = () => {
      const S = window.__C__;
      const live = [[], []];
      let onPoint = 0, total = 0;
      for (const a of ai.agents) {
        if (!a.alive) continue;
        total++;
        for (const z of zones) {
          const dx = z.position.x - a.position.x, dz = z.position.z - a.position.z;
          if (dx * dx + dz * dz <= z.radius * z.radius) { onPoint++; break; }
        }
        let inBase = false;
        for (const b of bases) {
          if (Math.hypot(b.x - a.position.x, b.z - a.position.z) < B) { inBase = true; break; }
        }
        if (!inBase) (live[a.team] ?? live[0]).push(a);
      }
      if (total) S.onPoint.push(onPoint / total);
      for (let t = 0; t < 2; t++) {
        const L = live[t];
        S.alive[t].push(L.length);
        const routes = new Set();
        for (const c of L) {
          let n = 0;
          for (const o of L) {
            const dx = o.position.x - c.position.x, dz = o.position.z - c.position.z;
            if (dx * dx + dz * dz <= R * R) n++;
          }
          S.counts[t].push(n);
          if (c.hasMoveTarget) routes.add(`${Math.round(c.moveTarget.x / 8)},${Math.round(c.moveTarget.z / 8)}`);
        }
        S.routes[t].push(routes.size);
      }
    };
  }, { R: RADIUS, B: BASE });

  for (let i = 0; i < SAMPLES; i++) { await wait(EVERY); await page.evaluate(() => window.__TICK__()); }

  const r = await page.evaluate(() => {
    const S = window.__C__;
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const stat = (a) => {
      if (!a.length) return { worst: 0, p95: 0, mean: 0, n: 0 };
      const s = [...a].sort((x, y) => x - y);
      return {
        worst: s[s.length - 1],
        p95: s[Math.floor(s.length * 0.95)],
        mean: +avg(s).toFixed(2),
        n: s.length,
      };
    };
    return {
      side: [stat(S.counts[0]), stat(S.counts[1])],
      raw: S.counts,
      onPoint: +avg(S.onPoint).toFixed(3),
      routes: [+avg(S.routes[0]).toFixed(1), +avg(S.routes[1]).toFixed(1)],
      alive: [+avg(S.alive[0]).toFixed(1), +avg(S.alive[1]).toFixed(1)],
      levelSeed: window.__ENGINE__.levelSeed,
      squads: (window.__ENGINE__.ctx.peek('ai').squads ?? []).map((s) => ({
        members: s.members.length, fireteams: s.fireteams ? s.fireteams.length : -1,
      })),
    };
  });
  pooled[0].push(...r.raw[0]);
  pooled[1].push(...r.raw[1]);
  delete r.raw;
  r.seed = seed;
  if (errs.length) r.pageerrors = errs.slice(0, 4);
  perSeed.push(r);
  await page.close();
}

const stat = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return {
    worst: s[s.length - 1],
    p99: s[Math.floor(s.length * 0.99)],
    p95: s[Math.floor(s.length * 0.95)],
    mean: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(2),
    n: s.length,
  };
};
console.log(JSON.stringify({
  radius: RADIUS, baseExclusion: BASE, seeds: SEEDS, samples: SAMPLES, scale: SCALE,
  perSeed,
  pooled: { side0: stat(pooled[0]), side1: stat(pooled[1]), both: stat([...pooled[0], ...pooled[1]]) },
}, null, 1));
await browser.close();
