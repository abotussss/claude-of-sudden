/**
 * IS `fx.lit` DRAWING AT ALL IN THIS BUILD?
 *
 *   node _litcheck.mjs [--port=4637] [--map=plains]
 *
 * `_craterwhy.mjs` photographed a frame containing a crater at 22 m AND one of
 * `plains-cover.js`'s permanent banks at 46 m, with `ambience` measured at
 * 158 sprites/s, and neither was in the picture. That is a claim about the
 * whole LIT layer, not about `craters.js`, so this asks the layer directly:
 * is the mesh visible, is anything in its ring, and does a deliberately absurd
 * white sprite five metres in front of the eye reach the screen?
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4637'}/?map=${args.map ?? 'plains'}&capture=1`;
mkdirSync('shots/craterwhy', { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1024, height: 576 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await page.waitForFunction(() => (window.__ENGINE__.ctx.peek('match')?.phase ?? '') === 'live', null, { timeout: 300000 });
await page.waitForTimeout(4000);
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('ui')?.setHudVisible?.(false);
  if (e.ctx.viewScene) e.ctx.viewScene.visible = false;
  const pl = e.ctx.peek('player'); if (pl) pl.applyDamage = () => {};
});

console.log(JSON.stringify(await page.evaluate(() => {
  const fx = window.__ENGINE__.ctx.peek('fx');
  const l = fx.lit;
  return {
    visible: l.mesh.visible, capacity: l.capacity, highWater: l.highWater, spawned: l.spawned,
    expireAt: +l.expireAt.toFixed(1), now: +fx.now.toFixed(1),
    renderOrder: l.mesh.renderOrder, frustumCulled: l.mesh.frustumCulled,
    inScene: !!l.mesh.parent, matVisible: l.mesh.material.visible, depthWrite: l.mesh.material.depthWrite,
    count: l.mesh.geometry.instanceCount, drawRange: JSON.stringify(l.mesh.geometry.drawRange),
    ambVisible: fx.ambience.emitters.filter((e) => e.active).length,
  };
}), null, 1));

// A row of absurd white lit sprites 6 m in front of the eye, on the eye line.
await page.evaluate(() => {
  const e = window.__ENGINE__, fx = e.ctx.peek('fx');
  const c = e.camera;
  const d = new (c.position.constructor)();
  c.getWorldDirection(d);
  fx.now = e.ctx.time.elapsed;
  for (let i = 0; i < 40; i++) {
    const s = fx.constructor ? null : null;
    const sp = window.__SP__ ?? null;
    void s; void sp;
  }
  // use the public recipe rather than reaching for resetSpawn: a smoke column
  // parked 6 m in front of the camera, huge, and impossible to miss.
  fx.addSmokeColumn(c.position.x + d.x * 8, c.position.y + d.y * 8 - 1, c.position.z + d.z * 8, {
    radius: 2.5, duration: 40, rate: 40, rise: 1.2, dark: 4.0, life: 6, growth: 1.4,
  });
  window.__D__ = [d.x, d.y, d.z];
});
await page.waitForTimeout(9000);
await page.screenshot({ path: 'shots/craterwhy/lit-8m-white.png' });
console.log(`lit-8m-white.png written; look dir ${JSON.stringify(await page.evaluate(() => window.__D__))}`);
console.log(JSON.stringify(await page.evaluate(() => {
  const l = window.__ENGINE__.ctx.peek('fx').lit;
  return { visible: l.mesh.visible, highWater: l.highWater, spawned: l.spawned, count: l.mesh.geometry.instanceCount };
})));
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs[0]}` : '0 pageerrors');
await b.close();
