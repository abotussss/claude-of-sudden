/**
 * DOES BOMBED GROUND KEEP SMOKING, AND WHAT DOES IT COST?
 *
 *   node _craterprobe.mjs [--port=4637] [--map=plains]
 *
 * Numbers only — no screenshots. Fires a ten-bomb stick through the real
 * `explosion` event (which is the seam `fx/craters.js` hangs off, so this
 * proves the routing and not just the class) and then reports, on a clock:
 * live craters, the field's demand against its ceiling, the split it settled
 * on, and `fx.lit`'s own occupancy so the displacement is visible.
 *
 * Waits past the 11.5 s `Ambience._scan` trap before it starts, so the plain's
 * six permanent banks are already holding their 48 % of the ring when the
 * bombs land — which is the only state worth measuring the craters in.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const map = args.map ?? 'plains';
const URL = `http://127.0.0.1:${args.port ?? '4637'}/?map=${map}&capture=1`;

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 960, height: 540 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log(`level=${await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id)}  ${URL}`);

const sample = () => page.evaluate(() => {
  const fx = window.__ENGINE__.ctx.peek('fx');
  const cf = fx.craters;
  const amb = fx.ambience;
  let ambActive = 0;
  for (const e of amb.emitters) if (e.active) ambActive++;
  let ambSprites = 0;
  for (const e of amb.emitters) if (e.active) ambSprites += e.rate * e.life;
  return {
    live: cf.stats.live, demand: +cf.stats.demand.toFixed(0), scale: +cf.stats.scale.toFixed(3),
    sprites: cf.stats.sprites, cap: cf.cap,
    litCap: fx.lit.capacity, litHigh: fx.lit.highWater,
    ambActive, ambSprites: Math.round(ambSprites),
    phase: window.__ENGINE__.ctx.peek('match')?.phase ?? '?',
  };
});

// settle past the scan trap so the world banks are live and paid for
await page.waitForTimeout(14000);
const before = await sample();
console.log(`before  phase=${before.phase}  fx.lit cap ${before.litCap} highWater ${before.litHigh}` +
  `  ambience ${before.ambActive} emitters ~${before.ambSprites} sprites  crater cap ${before.cap}`);

// A ten-bomb stick, 14 m apart, on open ground — through the real event.
const line = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const x = -70 + i * 14, z = 40;
    const h = ph.groundHeight(x, z, 300);
    pts.push([x, Number.isFinite(h) ? h : 0, z]);
  }
  window.__STICK__ = pts;
  return pts.map((p) => p.map((v) => +v.toFixed(1)));
});
console.log(`stick: ${line.length} bombs from ${line[0]} to ${line[line.length - 1]}`);

await page.evaluate(() => {
  const e = window.__ENGINE__;
  const V3 = e.camera.position.constructor;
  let i = 0;
  const drop = () => {
    const p = window.__STICK__[i++];
    if (!p) return;
    e.ctx.events.emit('explosion', {
      position: new V3(p[0], p[1] + 1.7, p[2]), radius: 15, damage: 0, source: 'bomber',
    });
    setTimeout(drop, 420);
  };
  drop();
});

const t0 = Date.now();
for (const t of [1, 5, 10, 20, 30, 45, 60, 78, 92]) {
  while ((Date.now() - t0) / 1000 < t) await page.waitForTimeout(150);
  const s = await sample();
  console.log(`  t+${String(t).padStart(3)}s  craters ${String(s.live).padStart(2)}` +
    `  demand ${String(s.demand).padStart(5)}/${s.cap}  scale ${s.scale.toFixed(3)}` +
    `  field ${String(s.sprites).padStart(4)} sprites  · lit ${s.litCap} · ambience ${s.ambActive}/${s.ambSprites}`);
}
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs[0]}` : '0 pageerrors');
await b.close();
