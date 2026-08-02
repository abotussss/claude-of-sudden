/**
 * ROOF CENSUS — over a real match, how many live bots are above 2.5 m, for how
 * long, how did they get there, and how many got down?
 *
 * Nothing here teleports anybody. It watches a match the match runs itself.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const SEEDS = String(args.seeds ?? '1,2,3').split(',');
const TICKS = +(args.ticks ?? 320);
const SCALE = +(args.scale ?? 8);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const all = [];
for (const seed of SEEDS) {
  const p = await b.newPage({ viewport: { width: 900, height: 520 } });
  p.on('pageerror', (e) => console.log('  PAGEERROR', e.message));
  await p.goto(`http://127.0.0.1:4384/?seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
  await p.evaluate((SCALE) => {
    const ctx = window.__ENGINE__.ctx;
    ctx.time.scale = SCALE;
    const ai = ctx.peek('ai');
    const match = ctx.peek('match');
    const S = {
      spawnAloft: 0, spawns: 0, beaconPlants: [], episodes: [], open: new Map(),
      t0: ctx.time.elapsed, samples: 0, aloftSamples: 0, liveSamples: 0,
    };
    window.__S__ = S;
    const realSpawn = ai.spawn.bind(ai);
    ai.spawn = (v, pos, yaw, opts) => {
      const a = realSpawn(v, pos, yaw, opts);
      S.spawns++;
      if (pos && pos.y > 2.5) {
        S.spawnAloft++;
        if (a) S.spawnedAloft = (S.spawnedAloft ?? new Set()).add(a.id);
      }
      return a;
    };
    const caches = match?.caches;
    if (caches?.plantBeacon) {
      const rp = caches.plantBeacon.bind(caches);
      caches.plantBeacon = (c, team, yaw, now) => {
        const ok = rp(c, team, yaw, now);
        if (ok) S.beaconPlants.push({ id: c.id, kind: c.kind, y: +c.position.y.toFixed(2), floor: c.floor ?? '?' });
        return ok;
      };
    }
    window.__TICK__ = () => {
      const now = ctx.time.elapsed;
      S.samples++;
      const g = ai.grid;
      for (const a of ai.agents) {
        if (!a.alive) { const e = S.open.get(a.id); if (e) { e.end = now; e.how = 'died'; S.episodes.push(e); S.open.delete(a.id); } continue; }
        S.liveSamples++;
        const y = a.position.y;
        let e = S.open.get(a.id);
        if (y > 2.5) {
          S.aloftSamples++;
          if (!e) {
            const spawnedUp = S.spawnedAloft?.has(a.id);
            e = { id: a.id, name: a.name, start: now, y0: +y.toFixed(1), how: spawnedUp ? '?' : '?', spawned: !!spawnedUp, obs: [] };
            S.open.set(a.id, e);
          }
          e.yMax = Math.max(e.yMax ?? 0, +y.toFixed(1));
          if (e.obs.length < 400) {
            const ix = g.cellX(a.position.x), iz = g.cellZ(a.position.z);
            const ci = g.inside(ix, iz) ? g.index(ix, iz) : -1;
            const comp = ci >= 0 ? g.comp[ci] : -1;
            e.obs.push({
              t: +(now - e.start).toFixed(1), y: +y.toFixed(1),
              ds: +(a.desiredSpeed ?? -1).toFixed(1), sp: +a.speed.toFixed(1),
              st: a.state, mt: a.hasMoveTarget ? a.pathLen : 0, ob: !!a.objectiveBlocked,
              rung: a.stuckRung ?? -1, off: g.nearest(a.position.x, a.position.z, a.position.y, 3, 1.5) < 0,
              gy: ci >= 0 ? +g.floor[ci].toFixed(1) : -99,
              comp, esc: comp >= 0 && g.escape ? g.escape[comp] : -2,
              csz: comp >= 0 ? g.componentSize(comp) : -1,
              obj: a.objective ? a.objective.mode : 'none',
            });
          }
        } else if (e) {
          e.end = now; e.how = 'down'; S.episodes.push(e); S.open.delete(a.id);
        }
      }
    };
  }, SCALE);
  const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
  for (let i = 0; i < TICKS; i++) { await wait(4); await p.evaluate(() => window.__TICK__()); }
  const r = await p.evaluate(() => {
    const S = window.__S__, now = window.__ENGINE__.ctx.time.elapsed;
    for (const e of S.open.values()) { e.end = now; e.how = 'still-up'; S.episodes.push(e); }
    return {
      seed: window.__ENGINE__.levelSeed, dur: +(now - S.t0).toFixed(0),
      spawns: S.spawns, spawnAloft: S.spawnAloft, beaconPlants: S.beaconPlants,
      samples: S.samples, aloftSamples: S.aloftSamples, liveSamples: S.liveSamples,
      episodes: S.episodes.map((e) => ({ ...e, dur: +(e.end - e.start).toFixed(1) })),
    };
  });
  all.push(r);
  console.log(`\n=== seed ${seed} (levelSeed ${r.seed}) — ${r.dur}s of match, ${r.samples} samples`);
  console.log(`  spawns ${r.spawns}, of which ABOVE 2.5 m: ${r.spawnAloft}`);
  console.log(`  beacon plants: ${JSON.stringify(r.beaconPlants)}`);
  console.log(`  aloft man-samples ${r.aloftSamples} / ${r.liveSamples} live (${(100 * r.aloftSamples / Math.max(1, r.liveSamples)).toFixed(1)}%)`);
  const eps = r.episodes.sort((a, c) => c.dur - a.dur);
  console.log(`  ${eps.length} aloft episodes: down ${eps.filter((e) => e.how === 'down').length}, died ${eps.filter((e) => e.how === 'died').length}, still up at end ${eps.filter((e) => e.how === 'still-up').length}`);
  for (const e of eps.slice(0, 10)) {
    console.log(`   ${e.name.padEnd(10)} y0 ${String(e.y0).padStart(5)} max ${String(e.yMax).padStart(5)} ${String(e.dur).padStart(6)}s ${e.how.padEnd(9)} spawnedUp=${e.spawned}`);
    const o = e.obs;
    for (const k of [0, 1, 2, (o.length / 2) | 0, o.length - 1]) {
      const q = o[k]; if (!q) continue;
      console.log(`      t${String(q.t).padStart(5)} y${String(q.y).padStart(5)} gy${String(q.gy).padStart(5)} off:${q.off ? 'Y' : '.'} ds${q.ds} sp${q.sp} ${q.st} path${q.mt} ob:${q.ob ? 'Y' : '.'} rung${q.rung} comp${q.comp}/${q.csz} esc${q.esc} ${q.obj}`);
    }
  }
  await p.close();
}
console.log('\n--- TOTALS ---');
const eps = all.flatMap((r) => r.episodes);
console.log(`  seeds ${all.length}, spawns ${all.reduce((s, r) => s + r.spawns, 0)}, spawned aloft ${all.reduce((s, r) => s + r.spawnAloft, 0)}`);
console.log(`  aloft% of live man-samples ${(100 * all.reduce((s, r) => s + r.aloftSamples, 0) / Math.max(1, all.reduce((s, r) => s + r.liveSamples, 0))).toFixed(2)}`);
console.log(`  episodes ${eps.length}: down ${eps.filter((e) => e.how === 'down').length} died ${eps.filter((e) => e.how === 'died').length} still-up ${eps.filter((e) => e.how === 'still-up').length}`);
const d = eps.filter((e) => e.how === 'down').map((e) => e.dur).sort((a, c) => a - c);
if (d.length) console.log(`  time to get down: median ${d[(d.length / 2) | 0]}s p90 ${d[Math.min(d.length - 1, (d.length * 0.9) | 0)]}s max ${d[d.length - 1]}s`);
await b.close();
