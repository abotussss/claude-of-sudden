/**
 * IS THE PROBE TARGET ACTUALLY IN THE LINE OF FIRE?
 *
 * `_diebug.mjs` counts rounds that leave the barrel and asks whether one of them
 * WOUNDED somebody. When the wound count is zero the question is which half is
 * wrong, so this raycasts the muzzle line and names what it hits.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4350/?seed=7';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR ' + e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
await page.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 180000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.time.scale = 1;
  e.ctx.peek('ai').combatEnabled = false;
  e.ctx.peek('ai').protect(e.ctx.peek('player'), 9999);
  window.__W__ = e.ctx.peek('weapons');
  window.__M__ = e.ctx.peek('match');
});
await page.mouse.click(640, 360);
await page.waitForTimeout(400);

console.log(JSON.stringify(await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const m = window.__M__;
  const p = e.ctx.peek('player');
  const foe = 1 - m.playerTeam;
  /**
   * A TARGET YOU CAN ACTUALLY SHOOT. The first version dropped him nine metres
   * along the player's facing and the first raycast came back "concrete at
   * 5.5 m" — the man was behind a wall, so a wound count of zero measured the
   * wall, not the weapon. Sample the compass and take the clearest lane.
   */
  const phys = e.ctx.peek('physics');
  const cam = e.ctx.camera;
  cam.updateMatrixWorld();
  const dirv = p.position.clone();
  let yaw = p.movement.yaw;
  let d = 0;
  for (let i = 0; i < 32; i++) {
    const t = (i / 32) * Math.PI * 2;
    dirv.set(-Math.sin(t), 0, -Math.cos(t));
    const h = phys.raycast(cam.position, dirv, 24, phys.MASK.BULLET);
    const free = h.hit ? h.distance - 1.5 : 24;
    if (free > d) { d = free; yaw = t; }
  }
  d = Math.min(d, 14);
  const x = p.position.x - Math.sin(yaw) * d;
  const z = p.position.z - Math.cos(yaw) * d;
  const y = ai.groundAt(x, z, p.position.y + 3);
  const at = p.position.clone().set(x, y, z);
  const variant = m._botsByTeam?.[foe]?.[0]?.variantName;
  const a = ai.spawn(variant, at, yaw + Math.PI, { team: foe, name: 'PROBE-TGT' });
  window.__TGT__ = a;
  return {
    playerTeam: m.playerTeam, aiPlayerTeam: ai.playerTeam, tgtTeam: a.team,
    teamOfPlayer: ai.teamOf(p), teamOfTgt: ai.teamOf(a),
    targetable: ai.targetable?.(a), alive: a.alive, health: a.health, variant,
    ground: +y.toFixed(2), playerY: +p.position.y.toFixed(2),
  };
})));

await page.waitForTimeout(1200);
console.log(JSON.stringify(await page.evaluate(() => {
  const e = window.__ENGINE__;
  const p = e.ctx.peek('player');
  const a = window.__TGT__;
  const cam = e.ctx.camera;
  const dx = a.position.x - cam.position.x;
  const dz = a.position.z - cam.position.z;
  const dy = a.position.y + 1.25 - cam.position.y;
  p.movement.yaw = Math.atan2(-dx, -dz);
  p.movement.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return { aimYaw: +p.movement.yaw.toFixed(3), aimPitch: +p.movement.pitch.toFixed(3),
    tgtPos: [+a.position.x.toFixed(1), +a.position.y.toFixed(1), +a.position.z.toFixed(1)],
    camPos: [+cam.position.x.toFixed(1), +cam.position.y.toFixed(1), +cam.position.z.toFixed(1)] };
})));

await page.waitForTimeout(600);
console.log(JSON.stringify(await page.evaluate(() => {
  const e = window.__ENGINE__;
  const phys = e.ctx.peek('physics');
  const cam = e.ctx.camera;
  cam.updateMatrixWorld();
  const o = cam.position.clone();
  const dir = new (o.constructor)(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
  const h = phys.raycast(o, dir, 60, phys.MASK.BULLET);
  return { hit: h.hit, dist: h.hit ? +h.distance.toFixed(2) : null,
    actor: h.actor ? (h.actor.name ?? 'unnamed') : null, part: h.part ?? null,
    surface: h.surface ?? null };
})));

// …and now shoot at it for real.
await page.evaluate(() => { window.__HP0__ = window.__TGT__.health; });
await page.mouse.down(); await page.waitForTimeout(900); await page.mouse.up();
await page.waitForTimeout(500);
console.log(JSON.stringify(await page.evaluate(() => ({
  hp0: window.__HP0__, hp: window.__TGT__.health, alive: window.__TGT__.alive,
  fired: window.__W__.stats.fired,
}))));
await browser.close();
