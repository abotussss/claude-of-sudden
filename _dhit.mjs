import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://127.0.0.1:4451/?capture=1&seed=7', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const r = await page.evaluate(async () => {
  const e = window.__ENGINE__; const m = e.ctx.peek('match'); const phys = e.ctx.peek('physics');
  const p = e.ctx.peek('player'); const d = m.drones;
  while (m.phase !== 'live') await new Promise(r => requestAnimationFrame(r));
  const one = d.fire(1);
  const eye = e.ctx.camera.position;
  one.position.set(eye.x + 12, eye.y + 3, eye.z);
  one.state = 'recover'; one.recoverT = 60; one.vel.set(0,0,0);
  await new Promise(r => requestAnimationFrame(r));
  const c = one.collider;
  const dir = { x: one.position.x - eye.x, y: one.position.y - eye.y, z: one.position.z - eye.z };
  const l = Math.hypot(dir.x, dir.y, dir.z); dir.x/=l; dir.y/=l; dir.z/=l;
  const hit = phys.raycast(eye, dir, 60, phys.MASK.BULLET);
  let dmgSeen = 0;
  const off = e.ctx.events.on('damage:dealt', (ev) => { if (ev.target === one) dmgSeen++; });
  phys.fireBullet({ origin: eye, dir, damage: 21, penetration: 1.2, maxDist: 60, mask: phys.MASK.BULLET, shooter: p });
  off();
  return {
    colliderExists: !!c, enabled: c?.enabled, layer: c?.layer, shape: c?.shape, radius: c?.radius,
    cpos: c ? [ +c.ax.toFixed(2), +c.ay.toFixed(2), +c.az.toFixed(2) ] : null,
    dpos: [ +one.position.x.toFixed(2), +one.position.y.toFixed(2), +one.position.z.toFixed(2) ],
    SHOOT_ONLY: phys.LAYER.SHOOT_ONLY, maskHasIt: (phys.MASK.BULLET & phys.LAYER.SHOOT_ONLY) !== 0,
    rayHit: hit.hit, rayActor: hit.actor === one ? 'THE DRONE' : (hit.actor?.name ?? hit.surface),
    rayDist: hit.hit ? +hit.distance.toFixed(2) : null, dist: +l.toFixed(2),
    dmgSeen, hpLeft: one.health,
    inColliders: phys.colliders.includes(c),
  };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
