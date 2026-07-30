/**
 * HOW MUCH OF THE MATCH DO THE BOTS SPEND INDOORS?
 *
 *   node _indoortime.mjs [--url=…] [--scale=6] [--samples=160] [--every=250]
 *
 * The complaint this exists to measure is "でないとAIが屋内戦闘しない". A bot is
 * INDOORS when its (x, z) is inside the footprint of an `enterable` building,
 * read out of `world.layout.BUILDINGS` in level space — the same footprints
 * `tools/indoorcheck.mjs` walks the player capsule into.
 *
 * Reported as BOT-SAMPLE FRACTION: every alive bot contributes one sample per
 * tick, so 0.05 means "one bot in twenty is inside a building at any moment".
 * Also reported: how many bots are within 4 m of a bot-reachable cache
 * (`world.features`, `botReachable`), and the per-building split.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4214/';
const SCALE = Number(args.scale ?? 6);
const SAMPLES = Number(args.samples ?? 160);
const EVERY = Number(args.every ?? 250);
const LABEL = args.label ?? 'run';
/** Neuter the cache legs at runtime — a controlled A/B on ONE build. */
const NOLEGS = !!args.nolegs;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

console.log(`[indoor] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

await page.evaluate((s) => { window.__ENGINE__.time.scale = s; }, SCALE);
if (NOLEGS) {
  await page.evaluate(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    m._assignCacheLegs = () => {};
    window.__NOLEGS__ = true;
  });
}
await page.waitForFunction(
  () => window.__ENGINE__.ctx.peek('match').phase === 'live',
  null,
  { timeout: 180000 }
);

const setup = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const world = e.ctx.peek('world');
  const feats = world.features ?? [];
  return {
    buildings: world.layout.BUILDINGS.filter((b) => b.enterable).map((b) => b.id),
    features: feats.length,
    botReachable: feats.filter((f) => f.botReachable).length,
  };
});
console.log(`[indoor] ${setup.buildings.length} enterable buildings: ${setup.buildings.join(', ')}`);
console.log(`[indoor] ${setup.features} features, ${setup.botReachable} bot-reachable`);

const acc = {
  botSamples: 0,
  indoorSamples: 0,
  strictSamples: 0,
  atBuildSamples: 0,
  nearCacheSamples: 0,
  cacheObjSamples: 0,
  ticks: 0,
  perBuilding: {},
  everIndoor: new Set(),
  botsSeen: new Set(),
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
    const stands = (m.caches?.botList ?? []).map((c) => c.stand);
    let bots = 0;
    let inside = 0;   // strictly inside the walls: inset past the wall thickness
    let foot = 0;     // inside the footprint rect, walls and doorways included
    let atBuild = 0;  // within 3.5 level units of a footprint — the threshold
    let near = 0;     // within 4 m of a cache stand point
    let onLeg = 0;
    const per = {};
    const insideNames = [];
    const names = [];
    for (const a of ai.agents) {
      if (!a.alive) continue;
      bots++;
      names.push(a.name);
      if (a._matchCache) onLeg++;
      const l = world.worldToLevel(a.position.x, a.position.y, a.position.z, scratch);
      let hitFoot = null;
      let hitIn = null;
      let hitNear = false;
      for (const b of B) {
        const hx = b.w / 2;
        const hz = b.d / 2;
        const dx = Math.abs(l.x - b.x) - hx;
        const dz = Math.abs(l.z - b.z) - hz;
        if (dx < 0 && dz < 0) {
          hitFoot = hitFoot ?? b.id;
          if (dx < -0.6 && dz < -0.6) hitIn = hitIn ?? b.id;
        }
        if (Math.max(dx, 0) < 3.5 && Math.max(dz, 0) < 3.5) hitNear = true;
      }
      if (hitFoot) { foot++; per[hitFoot] = (per[hitFoot] ?? 0) + 1; }
      if (hitIn) { inside++; insideNames.push(a.name); }
      if (hitNear) atBuild++;
      for (const q of stands) if (a.position.distanceToSquared(q) < 16) { near++; break; }
    }
    return { bots, inside, foot, atBuild, near, onLeg, per, insideNames, names };
  });
  acc.botSamples += s.bots;
  acc.indoorSamples += s.foot;
  acc.strictSamples += s.inside;
  acc.atBuildSamples += s.atBuild;
  acc.nearCacheSamples += s.near;
  acc.cacheObjSamples += s.onLeg;
  acc.ticks++;
  for (const k of Object.keys(s.per)) acc.perBuilding[k] = (acc.perBuilding[k] ?? 0) + s.per[k];
  for (const n of s.insideNames) acc.everIndoor.add(n);

  for (const n of s.names) acc.botsSeen.add(n);
  await page.waitForTimeout(EVERY);
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(2) + '%' : 'n/a');
console.log(`\n[indoor] ${LABEL} — ${acc.ticks} ticks, ${acc.botSamples} bot-samples ` +
  `(match seconds sampled ≈ ${((acc.ticks * EVERY) / 1000 * SCALE).toFixed(0)})`);
console.log(`  INSIDE THE WALLS (inset 0.6)       ${pct(acc.strictSamples, acc.botSamples)}  (${acc.strictSamples})`);
console.log(`  INSIDE THE FOOTPRINT (incl. doors) ${pct(acc.indoorSamples, acc.botSamples)}  (${acc.indoorSamples} / ${acc.botSamples})`);
console.log(`  AT A BUILDING (within 3.5 of one)  ${pct(acc.atBuildSamples, acc.botSamples)}`);
console.log(`  within 4 m of a PROVED cache stand ${pct(acc.nearCacheSamples, acc.botSamples)}`);
console.log(`  bots on a cache leg (mean)         ${(acc.cacheObjSamples / acc.ticks).toFixed(2)}`);
console.log(`  distinct bots inside the walls at least once: ${acc.everIndoor.size} of ${acc.botsSeen.size}`);
console.log(`  per building: ${Object.entries(acc.perBuilding).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${pct(v, acc.botSamples)}`).join('  ') || '(none)'}`);
if (errors.length) console.log('\n[indoor] errors', errors.slice(0, 6));
await browser.close();
process.exit(errors.length ? 1 : 0);
