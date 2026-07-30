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
    const feats = (world.features ?? []).filter((f) => f.botReachable);
    let bots = 0;
    let indoor = 0;
    let near = 0;
    const per = {};
    const names = [];
    const inside = [];
    for (const a of ai.agents) {
      if (!a.alive || a === e.ctx.peek('player')) continue;
      bots++;
      names.push(a.name);
      const l = world.worldToLevel(a.position.x, a.position.y, a.position.z, scratch);
      let hit = null;
      for (const b of B) {
        if (l.x > b.x - b.w / 2 && l.x < b.x + b.w / 2 && l.z > b.z - b.d / 2 && l.z < b.z + b.d / 2) {
          hit = b.id;
          break;
        }
      }
      if (hit) {
        indoor++;
        per[hit] = (per[hit] ?? 0) + 1;
        inside.push(a.name);
      }
      for (const f of feats) {
        if (a.position.distanceToSquared(f.position) < 16) { near++; break; }
      }
    }
    // How many bots have been ORDERED to a cache, if match publishes that.
    let cacheObj = 0;
    for (const a of ai.agents) if (a.alive && a.objective && a.objective.cache) cacheObj++;
    return { bots, indoor, near, per, inside, names, cacheObj };
  });
  acc.botSamples += s.bots;
  acc.indoorSamples += s.indoor;
  acc.nearCacheSamples += s.near;
  acc.cacheObjSamples += s.cacheObj;
  acc.ticks++;
  for (const k of Object.keys(s.per)) acc.perBuilding[k] = (acc.perBuilding[k] ?? 0) + s.per[k];
  for (const n of s.inside) acc.everIndoor.add(n);
  for (const n of s.names) acc.botsSeen.add(n);
  await page.waitForTimeout(EVERY);
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(2) + '%' : 'n/a');
console.log(`\n[indoor] ${LABEL} — ${acc.ticks} ticks, ${acc.botSamples} bot-samples ` +
  `(match seconds sampled ≈ ${((acc.ticks * EVERY) / 1000 * SCALE).toFixed(0)})`);
console.log(`  BOT TIME INDOORS       ${pct(acc.indoorSamples, acc.botSamples)}  ` +
  `(${acc.indoorSamples} / ${acc.botSamples})`);
console.log(`  bot time within 4 m of a bot-reachable cache  ${pct(acc.nearCacheSamples, acc.botSamples)}`);
console.log(`  bots ordered to a cache (mean)  ${(acc.cacheObjSamples / acc.ticks).toFixed(2)}`);
console.log(`  distinct bots that went inside at least once: ${acc.everIndoor.size} of ${acc.botsSeen.size}`);
console.log(`  per building: ${Object.entries(acc.perBuilding).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${pct(v, acc.botSamples)}`).join('  ') || '(none)'}`);
if (errors.length) console.log('\n[indoor] errors', errors.slice(0, 6));
await browser.close();
process.exit(errors.length ? 1 : 0);
