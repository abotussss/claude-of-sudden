/**
 * DOES THE FIGHT ACTUALLY GO INDOORS?
 *
 *   node _indoorfight.mjs [--url=…] [--scale=6] [--samples=160] [--every=250]
 *                         [--nolegs] [--label=…]
 *
 * `_indoortime.mjs` answers "how much of the match do the bots spend indoors".
 * This answers the other half of "でないとAIが屋内戦闘しない" — whether anybody is
 * SHOOTING in there. It samples the same footprints out of `world.layout` and
 * additionally latches every `actor:death` in the page, recording whether the
 * man who died and the man who killed him were inside a building at the time.
 *
 * A kill is INDOOR when the body fell inside an enterable footprint; it is a
 * ROOM FIGHT when the shooter was inside one too. Both are reported as counts
 * and as a share of all bot kills, beside the frame time over the same window.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4216/';
const SCALE = Number(args.scale ?? 6);
const SAMPLES = Number(args.samples ?? 160);
const EVERY = Number(args.every ?? 250);
const LABEL = args.label ?? 'run';
const NOLEGS = !!args.nolegs;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

console.log(`[fight] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const nav = await page.evaluate(() => {
  const g = window.__ENGINE__.ctx.peek('ai').grid;
  return { walkable: g.walkableCount, indoor: g.interiorCells, apron: g.apronCells, diag: g.diagCells, ms: Math.round(g.buildMs) };
});
console.log(`[fight] nav walkable=${nav.walkable} indoorCells=${nav.indoor} apron=${nav.apron} diag=${nav.diag} build=${nav.ms}ms`);

await page.evaluate((s) => { window.__ENGINE__.time.scale = s; }, SCALE);
if (NOLEGS) {
  await page.evaluate(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    m._assignCacheLegs = () => {};
    for (const a of window.__ENGINE__.ctx.peek('ai').agents) a._matchCache = null;
  });
}

/** Latch the deaths in the page: the event fires far faster than we can poll. */
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const world = e.ctx.peek('world');
  const ai = e.ctx.peek('ai');
  const V3 = e.ctx.camera.position.constructor;
  const scratch = new V3();
  const B = world.layout.BUILDINGS.filter((b) => b.enterable);
  const inFoot = (p) => {
    if (!p) return null;
    const l = world.worldToLevel(p.x, p.y, p.z, scratch);
    for (const b of B) {
      if (Math.abs(l.x - b.x) < b.w / 2 - 0.4 && Math.abs(l.z - b.z) < b.d / 2 - 0.4) return b.id;
    }
    return null;
  };
  const rec = { kills: 0, indoorDeath: 0, roomFight: 0, byBuilding: {}, frames: [] };
  window.__FIGHT__ = rec;
  e.ctx.events.on('actor:death', (ev) => {
    const victim = ev?.actor;
    if (!victim || victim.isPlayer) return;
    rec.kills++;
    const vb = inFoot(victim.position);
    const kb = inFoot(ev.by?.position ?? null);
    if (vb) {
      rec.indoorDeath++;
      rec.byBuilding[vb] = (rec.byBuilding[vb] ?? 0) + 1;
      if (kb) rec.roomFight++;
    } else if (kb) {
      // the shooter was inside and the body fell outside: still a room fight
      rec.roomFight++;
      rec.byBuilding[kb] = (rec.byBuilding[kb] ?? 0) + 1;
    }
  });
  void ai;
});

await page.waitForFunction(
  () => window.__ENGINE__.ctx.peek('match').phase === 'live',
  null,
  { timeout: 180000 }
);

const acc = {
  botSamples: 0, indoorSamples: 0, strictSamples: 0, atBuildSamples: 0,
  nearCacheSamples: 0, legSamples: 0, ticks: 0, perBuilding: {},
  everIndoor: new Set(), botsSeen: new Set(), frameMs: [], actors: [],
};

for (let i = 0; i < SAMPLES; i++) {
  const s = await page.evaluate(() => {
    const e = window.__ENGINE__;
    const ai = e.ctx.peek('ai');
    const world = e.ctx.peek('world');
    const m = e.ctx.peek('match');
    const V3 = e.ctx.camera.position.constructor;
    const scratch = new V3();
    const B = world.layout.BUILDINGS.filter((b) => b.enterable);
    const stands = (m.caches?.botList ?? []).map((c) => c.stand);
    let bots = 0, inside = 0, foot = 0, atBuild = 0, near = 0, onLeg = 0;
    const per = {};
    const insideNames = [];
    const names = [];
    for (const a of ai.agents) {
      if (!a.alive) continue;
      bots++;
      names.push(a.name);
      if (a._matchCache) onLeg++;
      const l = world.worldToLevel(a.position.x, a.position.y, a.position.z, scratch);
      let hitFoot = null, hitIn = null, hitNear = false;
      for (const b of B) {
        const dx = Math.abs(l.x - b.x) - b.w / 2;
        const dz = Math.abs(l.z - b.z) - b.d / 2;
        if (dx < 0 && dz < 0) {
          hitFoot = hitFoot ?? b.id;
          if (dx < -0.6 && dz < -0.6) hitIn = hitIn ?? b.id;
        }
        if (Math.max(dx, 0) < 3.5 && Math.max(dz, 0) < 3.5) hitNear = true;
      }
      if (hitFoot) { foot++; per[hitFoot] = (per[hitFoot] ?? 0) + 1; }
      if (hitIn) { inside++; insideNames.push(a.name); }
      if (hitNear) atBuild++;
      for (const q of stands) if (q && a.position.distanceToSquared(q) < 16) { near++; break; }
    }
    return {
      bots, inside, foot, atBuild, near, onLeg, per, insideNames, names,
      actors: ai.agents.filter((a) => a.alive).length,
    };
  });
  acc.botSamples += s.bots;
  acc.indoorSamples += s.foot;
  acc.strictSamples += s.inside;
  acc.atBuildSamples += s.atBuild;
  acc.nearCacheSamples += s.near;
  acc.legSamples += s.onLeg;
  acc.ticks++;
  acc.actors.push(s.actors);
  for (const k of Object.keys(s.per)) acc.perBuilding[k] = (acc.perBuilding[k] ?? 0) + s.per[k];
  for (const n of s.insideNames) acc.everIndoor.add(n);
  for (const n of s.names) acc.botsSeen.add(n);
  await page.waitForTimeout(EVERY);
}

/**
 * FRAME TIME, measured where it matters: a live match with every actor up, not
 * a still camera on an empty street. 300 rAF deltas at the end of the window,
 * with the clock put back to 1x first — the sampling above runs the match at 6x
 * and a frame there is carrying six times the fixed-step work.
 */
await page.evaluate(() => { window.__ENGINE__.time.scale = 1; });
await page.waitForTimeout(1500);
const frame = await page.evaluate(() => new Promise((done) => {
  const N = 300, ts = [];
  let last = performance.now(), i = 0;
  const tick = () => {
    const n = performance.now();
    ts.push(n - last);
    last = n;
    if (++i >= N) {
      ts.sort((a, b) => a - b);
      done({
        p50: +ts[Math.floor(N * 0.5)].toFixed(2),
        p95: +ts[Math.floor(N * 0.95)].toFixed(2),
        actors: window.__ENGINE__.ctx.peek('ai').agents.filter((a) => a.alive).length,
      });
    } else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));

const fight = await page.evaluate(() => window.__FIGHT__);
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(2) + '%' : 'n/a');
const q = (arr, p) => {
  const a = arr.slice().sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(1) : 'n/a';
};
console.log(`\n[fight] ${LABEL}${NOLEGS ? ' (legs OFF)' : ''} — ${acc.ticks} ticks, ${acc.botSamples} bot-samples ` +
  `(match seconds ≈ ${((acc.ticks * EVERY) / 1000 * SCALE).toFixed(0)})`);
console.log(`  INSIDE THE WALLS (inset 0.6)       ${pct(acc.strictSamples, acc.botSamples)}  (${acc.strictSamples})`);
console.log(`  INSIDE THE FOOTPRINT (incl. doors) ${pct(acc.indoorSamples, acc.botSamples)}  (${acc.indoorSamples} / ${acc.botSamples})`);
console.log(`  AT A BUILDING (within 3.5 of one)  ${pct(acc.atBuildSamples, acc.botSamples)}`);
console.log(`  within 4 m of a PROVED cache stand ${pct(acc.nearCacheSamples, acc.botSamples)}`);
console.log(`  bots on a cache leg (mean)         ${(acc.legSamples / acc.ticks).toFixed(2)}`);
console.log(`  distinct bots inside the walls at least once: ${acc.everIndoor.size} of ${acc.botsSeen.size}`);
console.log(`  per building: ${Object.entries(acc.perBuilding).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${pct(v, acc.botSamples)}`).join('  ') || '(none)'}`);
console.log(`  BOT KILLS ${fight.kills} · indoors ${fight.indoorDeath} (${pct(fight.indoorDeath, fight.kills)}) ` +
  `· room fights ${fight.roomFight} (${pct(fight.roomFight, fight.kills)})`);
console.log(`  kills by building: ${Object.entries(fight.byBuilding).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${v}`).join('  ') || '(none)'}`);
console.log(`  frame ms p50 ${frame.p50} p95 ${frame.p95} at ${frame.actors} live actors ` +
  `(alive bots over the window: mean ${(acc.botSamples / acc.ticks).toFixed(1)}, max ${Math.max(...acc.actors)})`);
if (errors.length) console.log('\n[fight] errors', errors.slice(0, 6));
await browser.close();
process.exit(errors.length ? 1 : 0);
