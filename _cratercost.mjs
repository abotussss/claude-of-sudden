/**
 * WHAT THE CRATER FIELD COSTS A FRAME, ATTRIBUTED.
 *
 *   node _cratercost.mjs [--port=4637] [--res=1280x720]
 *
 * `tools/perf.mjs` measures the town at a fixed hero pose and cannot see this
 * at all. This is the same idea aimed at the thing that is actually at risk:
 * a ten-bomb stick 30 m from the eye is the worst case the design permits —
 * the field at its `SHARE` ceiling, every sprite metres across, filling the
 * screen — and the answer has to be the DIFFERENCE against the identical pose
 * with the field switched off, not an absolute fps that the plain's own six
 * banks and the terrain already dominate.
 *
 * A/B/A/B four times, alternating, so drift in the scene (fires, bots, the
 * world's own bombardment) lands on both arms equally. `fx.craters.enabled`
 * gates spawning only — the sprites already in `fx.lit` are left to expire on
 * their own, so the OFF arm is measured after a full sprite life has passed.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const [W, H] = (args.res ?? '1280x720').split('x').map(Number);
const URL = `http://127.0.0.1:${args.port ?? '4637'}/?map=${args.map ?? 'plains'}&capture=1`;

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: W, height: H } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log(`level=${await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id)}  ${W}x${H}`);
await page.waitForTimeout(14000);

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('ui')?.debugState?.('clean');
  const m = e.ctx.peek('match');
  if (m) { m.roundClock = 1e6; m._checkWinConditions = () => {}; }
  const pl = e.ctx.peek('player'); if (pl) pl.applyDamage = () => {};
});

const SITE = [110, 90];
const pose = await page.evaluate(([cx, cz]) => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const x = cx + Math.cos(2.2) * 30, z = cz + Math.sin(2.2) * 30;
  const g = ph.groundHeight(x, z, 400);
  const cy = (Number.isFinite(g) ? g : 0) + 1.62;
  const gt = ph.groundHeight(cx, cz, 400);
  e.camera.position.set(x, cy, z);
  e.camera.lookAt(new V3(cx, (Number.isFinite(gt) ? gt : 0) + 5, cz));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  return { x: +x.toFixed(1), y: +cy.toFixed(2), z: +z.toFixed(1) };
}, SITE);
console.log(`pose ${JSON.stringify(pose)}  stick centre ${SITE}`);

const drop = () => page.evaluate(([cx, cz]) => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const fx = e.ctx.peek('fx');
  // Straight into the field, not through `explode()`: the fireball, the debris
  // and the shockwave are NOT what is being measured and would swamp it.
  for (let i = 0; i < 10; i++) {
    const x = cx + (i - 4.5) * 14, z = cz + (i % 2 ? 3 : -3);
    const h = ph.groundHeight(x, z, 400);
    fx.craterSmoke(x, Number.isFinite(h) ? h : 0, z, 15);
  }
}, SITE);

const measure = () => page.evaluate(() => new Promise((done) => {
  const N = 400, ts = []; let last = performance.now(), i = 0;
  const t = () => {
    const n = performance.now(); ts.push(n - last); last = n;
    if (++i >= N) { ts.sort((a, b) => a - b); done({ med: ts[N >> 1], p95: ts[Math.floor(N * 0.95)] }); }
    else requestAnimationFrame(t);
  };
  requestAnimationFrame(t);
}));

const set = (on) => page.evaluate((v) => {
  const cf = window.__ENGINE__.ctx.peek('fx').craters;
  cf.enabled = v;
  if (!v) cf.clear();
}, on);

const stat = () => page.evaluate(() => {
  const fx = window.__ENGINE__.ctx.peek('fx');
  return { live: fx.craters.stats.live, sprites: fx.craters.stats.sprites, calls: window.__RENDER_INFO__?.calls ?? -1 };
});

const on = [], off = [];
const rounds = Number(args.rounds ?? 6);
for (let round = 0; round < rounds; round++) {
  // OFF — clear the field, wait a whole sprite life for the ring to drain
  await set(false);
  await page.waitForTimeout(11000);
  const o = await measure();
  off.push(o.med);
  console.log(`  round ${round}  OFF  med ${o.med.toFixed(2)} ms  p95 ${o.p95.toFixed(2)}  ${JSON.stringify(await stat())}`);

  // ON — a fresh stick 30 m away, given a full sprite life to reach the cap
  await set(true);
  await drop();
  await page.waitForTimeout(11000);
  const n = await measure();
  on.push(n.med);
  console.log(`  round ${round}  ON   med ${n.med.toFixed(2)} ms  p95 ${n.p95.toFixed(2)}  ${JSON.stringify(await stat())}`);
}

/**
 * PAIRED, and the median of the pairs rather than the difference of the means.
 * This box runs several headless GPU browsers at once and the OFF arm alone
 * moved 68->130 ms between rounds; a difference of means over that is noise
 * with a sign. Each pair is measured 11 s apart against the same scene, so the
 * pair-wise delta is the only figure with any attribution in it.
 */
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const pairs = on.map((v, i) => v - off[i]);
const mo = mean(off), mn = mean(on);
console.log(`\nOFF med-of-rounds ${med(off).toFixed(1)} ms   ON med-of-rounds ${med(on).toFixed(1)} ms   (means ${mo.toFixed(1)} / ${mn.toFixed(1)})`);
console.log(`paired deltas ms: ${pairs.map((v) => v.toFixed(1)).join(', ')}`);
console.log(`MEDIAN PAIRED DELTA ${med(pairs).toFixed(2)} ms  — 393 sprites, 10 craters, nearest 30 m, ${W}x${H}`);
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs[0]}` : '0 pageerrors');
await b.close();
