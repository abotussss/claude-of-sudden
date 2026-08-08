/** Same frame with the world's smoke banks emitting and suppressed. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = 'shots/nf-smoke-ab';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto('http://127.0.0.1:4604/?map=plains&capture=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await p.evaluate(() => { const e = window.__ENGINE__; e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  const pl = e.ctx.peek('player'); if (pl) { pl.applyDamage = () => {}; setInterval(() => pl.heal?.(100), 250); }
  e.ctx.peek('ui')?.debugState?.('clean'); });
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await p.evaluate(() => { window.__ENGINE__.ctx.peek('match')._checkWinConditions = () => {}; window.__ENGINE__.ctx.peek('ui')?.debugState?.('clean'); });
await p.waitForTimeout(26000);
const frames = (n) => p.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
const bank = JSON.parse(process.argv[2] ?? '[-116,-43]');
const from = JSON.parse(process.argv[3] ?? '[-104,-43]');
const aim = async () => p.evaluate(([c, a]) => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const gh = (x, z) => { const h = ph.raycast(x, 300, z, 0, -1, 0, 400, ph.MASK.WORLD); return h.hit ? h.point.y : 0; };
  e.camera.position.set(c[0], gh(c[0], c[1]) + 1.62, c[1]);
  e.camera.lookAt(new V3(a[0], gh(a[0], a[1]) + 4, a[1]));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
}, [from, bank]);
await aim(); await frames(30);
console.log(JSON.stringify(await p.evaluate(() => {
  const fx = window.__ENGINE__.ctx.peek('fx');
  const cam = window.__ENGINE__.camera;
  return { litInst: fx?.lit?.geometry?.instanceCount, visible: fx?.lit?.mesh?.visible,
    inFrustumMat: !!fx?.lit?.mesh?.material, cam: [Math.round(cam.position.x), Math.round(cam.position.z)] };
})));
await p.screenshot({ path: `${OUT}/on.png` });
await p.evaluate(() => { const am = window.__ENGINE__.ctx.peek('fx').ambience; for (const e of am.emitters) e.active = false; });
await p.waitForTimeout(12000);
await aim(); await frames(30);
await p.screenshot({ path: `${OUT}/off.png` });
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
