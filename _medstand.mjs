/**
 * THE MEDICAL ZONE FROM WHERE A MAN ACTUALLY STANDS.
 *
 * Every earlier photograph was taken from above and showed bare concrete, and
 * the reason was not that the dressing is missing — it is that the west post
 * stands UNDER a 3.3 m slab. Measured (`_medy.mjs`): the published feature is at
 * y = 0.03, a ray dropped from above hits concrete at 3.30, and the nav cell a
 * bot is proved to stand on is at 0.045. So the camera was on the roof of the
 * thing the post is under, looking at its top.
 *
 * `stand` is the cell `Caches.prove` A*-proved, i.e. the square a soldier walks
 * to. Stand there, at eye height, and look at the crate.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('shots/verify', { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto('http://127.0.0.1:4294/?capture=1&seed=11', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const frames = (n) => page.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await page.evaluate(() => { const e = window.__ENGINE__; e.input.frozen = true; e.input.enabled = false; e.ctx.peek('player')?.setControlEnabled?.(false); });
for (const [idx, dist] of [[0, 7], [0, 2.4], [1, 7], [1, 2.4]]) {
  const info = await page.evaluate(([i, d]) => {
    const e = window.__ENGINE__, m = e.ctx.peek('match'), phys = e.ctx.peek('physics');
    const V3 = e.camera.position.constructor;
    const c = m.caches.list.filter((x) => x.kind === 'medic')[i];
    const p = c.position;
    const base = c.stand ?? p;
    const target = new V3(p.x, base.y + 1.1, p.z);
    const eye = new V3(); let best = null;
    for (let k = 0; k < 24 && !best; k++) {
      const th = (k / 24) * Math.PI * 2 + 0.3;
      eye.set(p.x + Math.cos(th) * d, base.y + 1.62, p.z + Math.sin(th) * d);
      if (phys.lineOfSight(eye, target, phys.MASK.SIGHT)) best = eye.clone();
    }
    if (!best) best = new V3(p.x, base.y + 1.62, p.z + d);
    e.camera.position.copy(best);
    e.camera.lookAt(target);
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    return { id: c.id, standY: +base.y.toFixed(2), cam: [+best.x.toFixed(1), +best.y.toFixed(2), +best.z.toFixed(1)] };
  }, [idx, dist]);
  await frames(30);
  const name = `shots/verify/medstand-${idx}-${dist === 7 ? 'lane' : 'close'}.png`;
  await page.screenshot({ path: name });
  console.log(name, JSON.stringify(info));
}
console.log(errs.length ? `[pageerror] ${errs[0]}` : '[pageerror] none');
await b.close();
