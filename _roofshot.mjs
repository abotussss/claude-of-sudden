/**
 * PHOTOGRAPH THE MAN LEAVING THE ROOF. A beacon in a vantage nest is a thing a
 * player can plant — `_cacheUse` takes whatever `caches.nearest` returns and all
 * eight nests are `floor:'roof'` — and for thirty seconds after it his whole
 * side respawns up there. This plants one, kills eight men so they come back at
 * it, parks a camera across the street at roof height and shoots the descent:
 * on the parapet, in the air, on the ground, and back in the fight.
 *
 *   node _roofshot.mjs [url] [seed]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = process.argv[2] ?? 'http://127.0.0.1:4384/';
const SEED = process.argv[3] ?? '1';
const OUT = 'shots/roof';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1024, height: 576 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const frames = (n) => page.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.time.scale = 8;
  // the story is the man, not the HUD or the gun in the way of him
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  if (e.ctx.viewScene) e.ctx.viewScene.visible = false;
});
await page.evaluate(() => new Promise((done) => {
  const m = window.__ENGINE__.ctx.peek('match');
  const t = () => (m.phase === 'live' ? done() : requestAnimationFrame(t));
  t();
}));
await frames(360);

console.log(await page.evaluate(() => {
  const e = window.__ENGINE__, ctx = e.ctx;
  const ai = ctx.peek('ai'), match = ctx.peek('match'), phys = ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const list = match.caches.list ?? match.caches.all;
  const nest = list.filter((c) => c.kind === 'vantage')[0];
  const team = 0;
  match.caches.beacon.active = false;
  match.caches.beacon.readyAt = -1e9;
  match.caches.plantBeacon(nest, team, 0, ctx.time.elapsed);
  for (const a of ai.agents.filter((a) => a.alive && ai.teamOf(a) === team).slice(0, 8)) {
    a.applyDamage(500, 'torso', a.position, { x: 0, y: 0, z: 1 });
  }
  const c = nest.position;
  let from = null;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7]]) {
    const px = c.x + dx * 11, pz = c.z + dz * 11;
    const eye = new V3(px, c.y + 1.6, pz);
    const d = new V3(c.x - eye.x, c.y - eye.y, c.z - eye.z);
    const len = d.length(); d.multiplyScalar(1 / len);
    if (phys.raycastAny(eye.x, eye.y, eye.z, d.x, d.y, d.z, len - 1.2, phys.MASK.WORLD)) continue;
    from = eye; break;
  }
  if (!from) from = new V3(c.x + 11, c.y + 1.6, c.z);
  window.__CAM__ = from;
  window.__NEST__ = nest;
  window.__TEAM__ = team;
  e.time.scale = 4;
  return `nest ${nest.id} y ${c.y.toFixed(2)} · camera [${from.x.toFixed(1)}, ${from.y.toFixed(1)}, ${from.z.toFixed(1)}]`;
}));

const aim = (id) => page.evaluate((id) => {
  const e = window.__ENGINE__, ctx = e.ctx;
  const ai = ctx.peek('ai');
  const V3 = e.camera.position.constructor;
  const nest = window.__NEST__;
  let man = id != null ? ai.agents.find((a) => a.id === id && a.alive) : null;
  let airborne = null;
  if (!man) {
    let best = null;
    for (const a of ai.agents) {
      if (!a.alive || ai.teamOf(a) !== window.__TEAM__) continue;
      const d = Math.hypot(a.position.x - nest.position.x, a.position.z - nest.position.z);
      if (d > 16) continue;
      if (!a.grounded && a.velocity.y < -2 && a.position.y > 1.5) airborne = a;
      if (a.position.y < 2.5) continue;
      if (!best || a.position.y > best.position.y) best = a;
    }
    man = airborne ?? best;
  }
  const look = man ? man.position : nest.position;
  e.camera.position.copy(window.__CAM__);
  e.camera.lookAt(new V3(look.x, look.y + 0.9, look.z));
  ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  if (!man) return null;
  return {
    id: man.id, name: man.name, y: +man.position.y.toFixed(2),
    grounded: man.grounded, vy: +man.velocity.y.toFixed(1), state: man.state,
    sp: +man.speed.toFixed(1), path: man.hasMoveTarget ? man.pathLen : 0,
    d: +Math.hypot(man.position.x - nest.position.x, man.position.z - nest.position.z).toFixed(1),
    falling: !man.grounded && man.velocity.y < -2 && man.position.y > 1.5,
  };
}, id);

let tracked = null;
const shots = [];
let got1 = false, got2 = false, got3 = false;
for (let i = 0; i < 460; i++) {
  await frames(2);
  const m = await aim(tracked);
  if (!m) continue;
  if (!got1 && m.y > 4) {
    await page.screenshot({ path: `${OUT}/1-on-the-roof.png` }); shots.push(['1-on-the-roof', m]); got1 = true;
  }
  if (!got2 && m.falling) {
    await page.screenshot({ path: `${OUT}/2-stepping-off.png` }); shots.push(['2-stepping-off', m]);
    got2 = true; tracked = m.id;
  }
  if (got2 && !got3 && m.grounded && m.y < 3) {
    await page.screenshot({ path: `${OUT}/3-on-the-ground.png` }); shots.push(['3-on-the-ground', m]); got3 = true;
  }
  if (got3 && m.d > 14 && m.sp > 1) {
    await page.screenshot({ path: `${OUT}/4-back-in-the-fight.png` }); shots.push(['4-back-in-the-fight', m]);
    break;
  }
}
for (const [n, m] of shots) console.log(' ', n.padEnd(22), JSON.stringify(m));
console.log('pageerrors:', errs.length, errs.slice(0, 3).join(' | '));
await b.close();
