/**
 * IS THERE ANYTHING OUT THERE FOR THE SOUND TO COME BACK OFF?
 *
 * 「銃声が鳴り響く」 on NACHTFELD is supposed to be the return off the rock wall
 * around the bowl, and the graph has nothing at the time it would arrive. Before
 * building a late tap on that premise, the premise has to be true: the wall has
 * to be a COLLIDER the audio system can find with the raycast handle it already
 * holds, at a distance that puts the return where an ear expects it.
 *
 * This casts the same eight horizontal directions `_probeSpace` uses, but out to
 * 500 m instead of 40, from a spread of standing positions on both maps. It
 * reports the hit distances, the median (the characteristic radius of the space)
 * and the round-trip delay that radius implies at 343 m/s.
 *
 * The town is the CONTROL and it matters as much as the plain: whatever is built
 * on this must be silent on AL-MARIYA, so the town's median has to come out far
 * enough below the plain's that one threshold separates them cleanly.
 *
 *   node _horizon.mjs --map=plains
 *   node _horizon.mjs --map=town
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const MAP = args.map ?? 'plains';
const PORT = args.port ?? '4633';
const WARM = Number(args.warm ?? 30);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:${PORT}/?map=${MAP}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await page.evaluate(async () => {
  const a = window.__ENGINE__.ctx.peek('audio');
  try { await a?.start?.(); } catch { /* reported below */ }
  window.__ENGINE__.ctx.time.scale = 6;
});
await page.waitForTimeout(WARM * 1000);

const out = await page.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const a = ctx.peek('audio'), phys = ctx.peek('physics'), world = ctx.peek('world');
  ctx.time.scale = 1;
  const MASK = phys?.MASK?.WORLD;
  const RAYS = 8, MAX = 500;
  const dirs = [];
  for (let i = 0; i < RAYS; i++) {
    const t = (i / RAYS) * Math.PI * 2;
    // The same +0.06 rise `_probeDirs` uses: a dead-flat ray skims the ground.
    dirs.push({ x: Math.cos(t), y: 0.06, z: Math.sin(t) });
  }
  const med = (x) => { const s = [...x].sort((p, q) => p - q); return +s[s.length >> 1].toFixed(1); };

  const probe = (o) => {
    const hits = [];
    for (const d of dirs) {
      const h = phys.raycast(o, d, MAX, MASK);
      hits.push(h?.hit ? +h.distance.toFixed(1) : MAX);
    }
    const m = med(hits);
    return {
      at: { x: +o.x.toFixed(0), z: +o.z.toFixed(0) },
      hits, median: m, min: Math.min(...hits), max: Math.max(...hits),
      /** Round trip at 343 m/s — where the return would land after the direct. */
      returnMs: +((2 * m / 343) * 1000).toFixed(0),
    };
  };

  const lp = a.field.listenerPos;
  const samples = [probe({ x: lp.x, y: lp.y + 1.6, z: lp.z })];
  // A spread of standing positions, so one lucky spot cannot carry the answer.
  const R = [0, 40, 80, 120];
  for (const r of R) {
    for (const t of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      if (r === 0 && t !== 0) continue;
      const o = { x: lp.x + Math.cos(t) * r, y: lp.y + 1.6, z: lp.z + Math.sin(t) * r };
      samples.push(probe(o));
    }
  }
  const meds = samples.map((s) => s.median);
  return {
    level: world.level.id,
    bounds: world.level.bounds ?? world.level.size ?? null,
    listener: { x: +lp.x.toFixed(0), y: +lp.y.toFixed(1), z: +lp.z.toFixed(0) },
    space: a.stats.space,
    openWeight: +(+a._space.open).toFixed(3),
    samples,
    medianOfMedians: med(meds),
    returnMsAtMedian: +((2 * med(meds) / 343) * 1000).toFixed(0),
  };
});
console.log(JSON.stringify(out, null, 1));
console.log(`pageerrors=${errs.length}`);
if (errs.length) console.log(' first:', errs[0]);
await browser.close();
