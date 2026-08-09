/** The carrier's wreck ALONE — the fire hidden, so what is orange is the hull. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = 'shots/skyfall'; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto('http://127.0.0.1:4630/?map=plains&capture=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  for (const el of Array.from(document.body.children)) if (el.tagName !== 'CANVAS') el.style.display = 'none';
  e.ctx.viewScene.visible = false;
  const pl = e.ctx.peek('player'); if (pl) { pl.applyDamage = () => {}; setInterval(() => pl.heal?.(100), 250); }
});
await page.evaluate(() => (window.__ENGINE__.time.scale = 8));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await page.evaluate(() => { window.__ENGINE__.ctx.peek('match')._checkWinConditions = () => {}; window.__ENGINE__.time.scale = 1; });
await page.evaluate(() => window.__ENGINE__.ctx.peek('match').crash.fire());
await page.waitForFunction("(window.__ENGINE__.ctx.peek('match').crash._sky._t)>=24", null, { timeout: 180000 });
const frames = (n) => page.evaluate((k) => new Promise((d) => { let i=0; const t=()=>(++i>=k?d():requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await frames(120);
const place = (f, a, eye, fov) => page.evaluate(([f,a,eye,fov]) => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const h = ph.raycast(f[0], 300, f[1], 0, -1, 0, 400, ph.MASK.WORLD);
  e.camera.position.set(f[0], (h.hit?h.point.y:0)+eye, f[1]);
  e.camera.lookAt(new V3(a[0],a[1],a[2]));
  e.camera.fov = fov; e.camera.updateProjectionMatrix();
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
}, [f,a,eye,fov]);
const hide = (on) => page.evaluate((on) => {
  const c = window.__ENGINE__.ctx.peek('match').crash;
  c._sky.flames.visible = !on; c.flames.visible = !on;
}, on);
for (const [tag, f, a, eye, fov] of [
  ['A-side', [-150, 10], [-105, 8, -5], 12, 60],
  ['B-nose', [-140, 45], [-120, 8, 18], 4, 60],
  ['C-above', [-60, 30], [-100, 2, -8], 60, 60],
]) {
  await hide(true); await place(f, a, eye, fov); await frames(4);
  await page.screenshot({ path: `${OUT}/WRECK-${tag}-nofire.png` });
  await hide(false); await frames(4);
  await page.screenshot({ path: `${OUT}/WRECK-${tag}.png` });
  console.log(' ·', tag);
}
console.log(errs.length ? `PAGEERRORS ${errs.length}: ${errs[0]}` : '0 pageerrors');
await b.close();
