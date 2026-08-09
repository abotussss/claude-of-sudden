/**
 * WHERE IS THE SMOKE IN THE FRAME, IN NDC?
 *
 *   node _craterwhere.mjs [--port=4637]
 *
 * Every tune frame put the plume small and on the horizon when the arithmetic
 * said it was nineteen metres away and a third of the screen wide. Rather than
 * argue with the picture, this prints the camera, each live crater, its range
 * and its normalised device coordinates, and then the same for a sample of the
 * particles actually sitting in `fx.lit`'s ring — so "the smoke is not where I
 * put it" and "the smoke is where I put it and does not read" become different
 * answers instead of the same photograph.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4637'}/?map=plains&capture=1`;
mkdirSync('shots/craterwhere', { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1024, height: 576 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await page.waitForFunction(() => (window.__ENGINE__.ctx.peek('match')?.phase ?? '') === 'live', null, { timeout: 300000 });
await page.waitForTimeout(3000);

console.log(JSON.stringify(await page.evaluate(() => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics'), fx = e.ctx.peek('fx');
  const V3 = e.camera.position.constructor;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('ui')?.setHudVisible?.(false);
  if (e.ctx.viewScene) e.ctx.viewScene.visible = false;
  const run = window.__BOMBER__.runs.find((r) => r.id === 'OPEN-7') ?? window.__BOMBER__.runs[0];
  const a = run.bombs[0].impact, z2 = run.bombs[run.bombs.length - 1].impact;
  const tx = (a.x + z2.x) / 2, tz = (a.z + z2.z) / 2;
  const gt = ph.groundHeight(tx, tz, 400);
  const cx = 133.9, cz = 60.9;
  const gc = ph.groundHeight(cx, cz, 400);
  e.camera.position.set(cx, gc + 1.62, cz);
  e.camera.lookAt(new V3(tx, gt + 5, tz));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  fx.craters.clear();
  fx.craters.dark = 6;
  for (let i = -2; i <= 2; i++) {
    const x = tx + i * 12, z = tz + (i % 2 ? 4 : -4);
    const h = ph.groundHeight(x, z, 400);
    fx.craterSmoke(x, Number.isFinite(h) ? h : 0, z, 15);
  }
  window.__SITE__ = [tx, tz];
  return { target: [+tx.toFixed(1), +tz.toFixed(1)], targetGround: +gt.toFixed(2), camGround: +gc.toFixed(2) };
}), null, 1));

await page.waitForTimeout(12000);

const r = await page.evaluate(() => {
  const e = window.__ENGINE__, fx = e.ctx.peek('fx');
  const cam = e.camera;
  const V3 = cam.position.constructor;
  const v = new V3();
  const out = { cam: [+cam.position.x.toFixed(1), +cam.position.y.toFixed(2), +cam.position.z.toFixed(1)],
    rot: [+(cam.rotation.x * 180 / Math.PI).toFixed(1), +(cam.rotation.y * 180 / Math.PI).toFixed(1)],
    fov: cam.fov, craters: [], ring: [] };
  for (const c of fx.craters.craters) {
    if (!c.active) continue;
    v.set(c.x, c.y + 4, c.z);
    const d = v.distanceTo(cam.position);
    const p = v.clone().project(cam);
    out.craters.push({ p: [+c.x.toFixed(1), +c.y.toFixed(1), +c.z.toFixed(1)], d: +d.toFixed(1),
      ndc: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(3)], age: +c.age.toFixed(1), rate: +c.rate.toFixed(1), foot: c.foot });
  }
  const l = fx.lit, A = l.array, S = 32, now = fx.now;
  const [tx, tz] = window.__SITE__;
  let near = 0;
  for (let i = 0; i < l.capacity; i++) {
    const b = i * S, birth = A[b + 8], inv = A[b + 9];
    if (!inv) continue;
    const n = (now - birth) * inv;
    if (n < 0 || n >= 1) continue;
    if (Math.hypot(A[b] - tx, A[b + 2] - tz) > 45) continue;
    near++;
    if (out.ring.length < 6) {
      v.set(A[b], A[b + 1], A[b + 2]);
      const p = v.clone().project(cam);
      out.ring.push({ p: [+A[b].toFixed(1), +A[b + 1].toFixed(1), +A[b + 2].toFixed(1)],
        d: +v.distanceTo(cam.position).toFixed(1), size0: +A[b + 3].toFixed(1), size1: +A[b + 7].toFixed(1),
        ndc: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(3)], n: +n.toFixed(2), alpha: +A[b + 26].toFixed(2), r0: +A[b + 16].toFixed(2) });
    }
  }
  out.nearLive = near;
  return out;
});
console.log(JSON.stringify(r, null, 1));
await page.screenshot({ path: 'shots/craterwhere/where.png' });
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs[0]}` : '0 pageerrors');
await b.close();
