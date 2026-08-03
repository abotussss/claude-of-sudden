/**
 * DOES IT STILL READ AS A CATHEDRAL FROM OUTSIDE? — 「大聖堂そのものを無くすのは
 * 禁止 破壊後のDサイトの見栄えを変えればいい」
 *
 *   node _dout.mjs http://127.0.0.1:4496/
 *
 * `_dlook.mjs` photographs D from the inside, which is the half of the brief
 * that says "you must be able to see out". This is the other half, and it is an
 * acceptance criterion in its own right: the ruin has to go on being the
 * remains of a cathedral. Eight standing eyes on a 42 m ring round the crossing
 * and two raised three-quarter views, all with the church already down.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = process.argv[2] ?? 'http://127.0.0.1:4496/';
const OUT = 'shots/dout';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&cath=down`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
});
await page.evaluate(() => {
  /* the round was restarting mid-shoot and respawning the camera into the
   * warm-up pen: three of the first pass's frames were a boundary wall in the
   * sand. Nail the clock down the way `_dsight.mjs` does before framing. */
  const m = window.__ENGINE__.ctx.peek('match');
  m._checkWinConditions = () => {};
  m.roundClock = 1e6;
  if (m.score) m.score[0] = 999;
});
const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

/**
 * Stand at (u, v) in the CATHEDRAL's own plan, at `rise` over the surface.
 * `levelToWorld` is (x, y, z) — the first cut of this passed (0, u, v) and put
 * every camera on the same line, which is how a "ring" of eight came back as a
 * row. @see `w.cathedral.level`, the crossing's own place in the level.
 */
const place = (u, v, rise, aimY) => page.evaluate(([u, v, rise, aimY]) => {
  const e = window.__ENGINE__, w = e.ctx.peek('world'), phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const from = w.levelToWorld(u, 0, v + w.cathedral.level.z, new V3());
  const at = w.levelToWorld(0, 0, w.cathedral.level.z, new V3());
  const h = phys.raycast(from.x, 90, from.z, 0, -1, 0, 140, phys.MASK.WORLD);
  const y = (h.hit ? h.point.y : 0) + rise;
  e.camera.position.set(from.x, y, from.z);
  e.camera.lookAt(new V3(at.x, aimY, at.z));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  return { y: +y.toFixed(2) };
}, [u, v, rise, aimY]);

const R = 42;
const shots = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  shots.push([`ring-${String(Math.round((a * 180) / Math.PI)).padStart(3, '0')}`,
    Math.sin(a) * R, Math.cos(a) * R, 1.62, 9]);
}
shots.push(['air-sw', -34, -34, 26, 4]);
shots.push(['air-ne', 34, 34, 26, 4]);
for (const [tag, u, v, rise, aimY] of shots) {
  const p = await place(u, v, rise, aimY);
  await frames(35);
  await page.screenshot({ path: `${OUT}/${tag}.png` });
  console.log(`  ${tag.padEnd(10)} eye ${p.y} m`);
}
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
