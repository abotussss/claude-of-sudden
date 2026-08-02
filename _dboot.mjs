/** Boot check: the page comes up clean and the drones read the live frag def. */
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));
await page.goto('http://127.0.0.1:4451/?capture=1&seed=7', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const r = await page.evaluate(async () => {
  const e = window.__ENGINE__; const m = e.ctx.peek('match'); const d = m.drones;
  while (m.phase !== 'live') await new Promise(r => requestAnimationFrame(r));
  const one = d.fire(1);
  const def = d._fragDef();
  for (let i = 0; i < 60; i++) await new Promise(r => requestAnimationFrame(r));
  return {
    ready: !!window.__READY__,
    fragRadius: def.radius, fragDamage: def.damage,
    launched: d.stats.launched, aloft: d.aloft, alive: one.alive, state: one.state,
    lockStrip: !!e.ctx.peek('ui').droneLockStrip, killCamStrip: !!e.ctx.peek('ui').killCamStrip,
  };
});
console.log(JSON.stringify(r));
console.log('pageerrors', errs.length, errs.slice(0, 4));
await b.close();
