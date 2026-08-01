/**
 * THE CATHEDRAL EVENT, PLAYED AS THE MATCH PLAYS IT, AND PHOTOGRAPHED DENSELY.
 *
 * `callCathedralCollapse()` is NOT the collapse — it is `callSalvo('CATHEDRAL')`,
 * three bays of AISLE ROOF, and that is why a probe that calls it directly reads
 * "THE CATHEDRAL DOWN" over an intact church. The building coming down is
 * `MatchSystem._razeCathedral()`, the `raze` beat of `_updateCathedralEvent`.
 *
 * So this drives the REAL entry point — `_beginCathedralEvent` — and lets the
 * beat sheet play on its own clock, which is the same code the schedule runs at
 * `cathedralOpenProgress`. It polls `world.cathedral.razed` every frame so the
 * transition is timestamped rather than guessed at, and it photographs from the
 * parvis, from inside the nave, and UP at the sky over the ruin.
 *
 *   node _cathdown.mjs [url] [outdir] [--speed=N] [--eye=parvis|nave|up]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const URL = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4305/';
const OUT = args.find((a) => !a.startsWith('-') && !a.startsWith('http')) ?? 'shots/cathdown';
const SPEED = +(args.find((a) => a.startsWith('--speed='))?.slice(8) ?? 1);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
const logs = [];
page.on('console', (m) => {
  const t = m.text();
  if (/cathedral|CATHEDRAL|airstrike|IMPACT|razed/i.test(t)) logs.push(t);
});

await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => new Promise((d) => {
  const m = window.__ENGINE__.ctx.peek('match');
  const t = () => (m.phase === 'live' ? d() : requestAnimationFrame(t));
  t();
}));
await page.evaluate((sp) => {
  const e = window.__ENGINE__;
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
  if (sp !== 1) { if ('timeScale' in e) e.timeScale = sp; else e.speed = sp; }
}, SPEED);

/** Stand at level z = `lz` on the cathedral's own axis, looking at height `lookY`. */
const place = (lz, lookY, lift = 1.62) => page.evaluate(([lz, lookY, lift]) => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const from = w.levelToWorld(0, 0, lz, new V3());
  const at = w.levelToWorld(0, 0, -1, new V3());
  const h = phys.raycast(from.x, 80, from.z, 0, -1, 0, 120, phys.MASK.WORLD);
  e.camera.position.set(from.x, (h.hit ? h.point.y : 0) + lift, from.z);
  e.camera.lookAt(new V3(at.x, lookY, at.z));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
}, [lz, lookY, lift]);

const frames = (n) => page.evaluate((k) => new Promise((d) => {
  let i = 0;
  const t = () => (++i >= k ? d() : requestAnimationFrame(t));
  requestAnimationFrame(t);
}), n);

const state = () => page.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const m = e.ctx.peek('match');
  const c = w.cathedral;
  return {
    razed: !!c?.razed,
    t: +(m._cath?.t ?? -1).toFixed(2),
    beat: m._cath?.beat ?? -1,
    fps: +(1 / Math.max(1e-3, e.ctx.time.dt)).toFixed(0),
    ms: +(e.ctx.time.dt * 1000).toFixed(1),
  };
});

await place(58, 14);
await frames(40);
await page.screenshot({ path: `${OUT}/00-standing.png` });

const t0 = Date.now();
console.log('[probe] firing the REAL event (_beginCathedralEvent)…');
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._beginCathedralEvent(m.ctx.time.elapsed, 0.99);
});

/**
 * Every frame's dt, so "the fire frame cost N ms against a neighbourhood median
 * of M" is a measurement and not a claim. Sampled in the page and drained after.
 */
await page.evaluate(() => {
  window.__DT__ = [];
  const e = window.__ENGINE__;
  const tick = () => {
    window.__DT__.push(+(e.ctx.time.dt * 1000).toFixed(2));
    if (window.__DT__.length < 2400) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

let shot = 0;
let razedAt = -1;
const rows = [];
for (let i = 0; i < 260 && shot < 60; i++) {
  await frames(3);
  const s = await state();
  rows.push(s);
  if (razedAt < 0 && s.razed) {
    razedAt = s.t;
    console.log(`[probe] RAZED at event t=${s.t}s (beat ${s.beat})`);
  }
  await place(58, 14);
  await page.screenshot({ path: `${OUT}/p${String(shot++).padStart(2, '0')}.png` });
  if (razedAt >= 0 && s.t > razedAt + 9) break;
  if (s.t < 0 && razedAt >= 0) break;
}
console.log(`[probe] ${shot} parvis frames over ${((Date.now() - t0) / 1000).toFixed(0)}s wall`);

const dt = await page.evaluate(() => window.__DT__ ?? []);
if (dt.length) {
  const sorted = [...dt].sort((a, c) => a - c);
  const med = sorted[sorted.length >> 1];
  const worst = sorted.slice(-6);
  console.log(`[cost] ${dt.length} frames · median ${med} ms · worst six ${worst.join(', ')} ms`);
}

// The nave, and the angle every floating-mass bug has hidden at.
await place(6, 26, 1.62);
await frames(20);
await page.screenshot({ path: `${OUT}/up-nave.png` });
await place(40, 34, 1.62);
await frames(20);
await page.screenshot({ path: `${OUT}/up-parvis.png` });
await place(-34, 30, 1.62);
await frames(20);
await page.screenshot({ path: `${OUT}/up-north.png` });
await place(58, 6, 1.62);
await frames(20);
await page.screenshot({ path: `${OUT}/99-ruin.png` });

const fin = await state();
console.log(`[probe] final: razed=${fin.razed}`);
console.log(logs.slice(0, 40).map((l) => '  ' + l).join('\n'));
console.log(errs.length ? `[pageerror] ${errs.slice(0, 5).join(' | ')}` : '[pageerror] none');
await b.close();
