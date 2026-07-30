/** Look at each zone from its own attack approach, and read the works back. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('shots', { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs=[]; page.on('pageerror', e=>errs.push(String(e.message)));
await page.goto('http://127.0.0.1:4214/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
await page.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 180000 });
await page.evaluate(() => { const e=window.__ENGINE__; e.time.scale=1;
  const ai=e.ctx.peek('ai'); ai.combatEnabled=false; ai.protect(e.ctx.peek('player'),9999); });
await page.mouse.click(800,450); await page.waitForTimeout(400);
for (const id of ['A','C','B']) {
  const info = await page.evaluate((zid) => {
    const e=window.__ENGINE__; const m=e.ctx.peek('match'); const p=e.ctx.peek('player');
    const w=e.ctx.peek('world'); const ai=e.ctx.peek('ai'); const g=ai.grid;
    const z=m.sites.find(s=>s.id===zid); const V3=z.position.constructor;
    // Walk up the ATTACK's approach (level +Z) until the nav grid stops having
    // ground at the zone's height — the last such cell is the mouth you come in
    // through, and that is where the works have to read from.
    const unit=w.levelToWorld(0,0,1,new V3()).sub(w.levelToWorld(0,0,0,new V3()));
    // Stand ON the point and look up the attack's approach: that is the angle
    // the works exist to change.
    const ci=g.nearest(z.position.x,z.position.z,z.position.y,3,1.2);
    const eye=ci>=0 ? new V3(g.worldX(ci%g.nx), g.floor[ci], g.worldZ((ci/g.nx)|0))
                    : z.position.clone();
    const look=z.position.clone().addScaledVector(unit,14);
    p.movement.yaw=Math.atan2(look.x-eye.x, -(look.z-eye.z));
    p.movement.pitch=0.0; p.movement.velocity.set(0,0,0);
    p.movement.teleport(eye.x, eye.y+0.05, eye.z);
    return { id: zid, from:[+eye.x.toFixed(1),+eye.z.toFixed(1)],
             to:[+z.position.x.toFixed(1),+z.position.z.toFixed(1)],
             range:+eye.distanceTo(z.position).toFixed(1) };
  }, id);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `shots/zone-${id}-works.png` });
  console.log('shot', JSON.stringify(info));
}
if (errs.length) console.log('ERRORS', errs.slice(0,4));
await browser.close();
