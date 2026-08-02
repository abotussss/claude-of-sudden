/**
 * TWO THINGS A BUILD LOG CANNOT SAY.
 *
 *   1. what the airframe actually looks like — one drone parked 5 m in front of
 *      the camera, photographed. `_droneshot.mjs` caught one at 44 m, where a
 *      0.62 m object is a speck, which proves it exists and nothing else.
 *   2. what the kill cam READS for each way of dying, driven through the real
 *      damage paths rather than by poking the record: a bot's round, a bot's
 *      frag, the player's own frag, a drone, an airstrike, a tank shell and the
 *      cathedral barrage.
 *
 * Usage: node _dronelook.mjs [url] [seed]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://127.0.0.1:4451/';
const SEED = process.argv[3] ?? '7';
mkdirSync('shots', { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

/* ═══ the airframe, close ════════════════════════════════════════════════ */
const look = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const p = e.ctx.peek('player');
  const d = m.drones;
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  const z = m.sites[1] ?? m.sites[0];
  p.respawnAt(z.position, 0);
  await new Promise((r) => requestAnimationFrame(r));
  const one = d.fire(m.playerTeam === 0 ? 1 : 0);
  const cam = e.ctx.camera;
  // Park it 5 m out at eye height and hold it there while the camera settles.
  for (let i = 0; i < 8; i++) {
    const f = { x: -Math.sin(p.movement.yaw), z: -Math.cos(p.movement.yaw) };
    one.position.set(cam.position.x + f.x * 5, cam.position.y + 0.2, cam.position.z + f.z * 5);
    one.vel.set(f.x * 3, 0, f.z * 3);
    one.state = 'recover';
    one.recoverT = 30;
    one.life = 60;
    await new Promise((r) => requestAnimationFrame(r));
  }
  return {
    alive: one.alive, visible: one.group.visible, name: one.name, team: one.team,
    children: one.group.children.length,
    at: [+one.position.x.toFixed(1), +one.position.y.toFixed(1), +one.position.z.toFixed(1)],
    range: +one.position.distanceTo(cam.position).toFixed(1),
  };
});
await page.screenshot({ path: 'shots/drone-closeup.png' });
console.log('airframe:', JSON.stringify(look));

/* ═══ the kill cam, one row per cause ════════════════════════════════════ */
const cases = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const p = e.ctx.peek('player');
  const ui = e.ctx.peek('ui');
  const ev = e.ctx.events;
  const rows = [];

  const revive = async () => {
    const z = m.sites[1] ?? m.sites[0];
    const r = m.roster.find((x) => x.isPlayer);
    if (r) r.alive = true;
    m._respawnQueue.length = 0;
    p.health.reset(true);
    p.setControlEnabled(true);
    p.respawnAt(z.position, 0);
    m.spectator.stop();
    ui.clearKillCam();
    await new Promise((rr) => requestAnimationFrame(rr));
  };

  const run = async (label, fn) => {
    await revive();
    p.health.value = 40;
    fn();
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
    const k = m.spectator.kill;
    rows.push({
      death: label,
      dead: p.dead,
      strip: ui.killCamStrip.text,
      camera: m.spectator.killCam ? m.spectator.mode : `no cam (${m.spectator.mode})`,
      framed: k ? [+k.x.toFixed(0), +k.y.toFixed(0), +k.z.toFixed(0)] : null,
      tracksActor: !!k?.actor,
      env: k?.environmental,
    });
  };

  const at = (dx, dy, dz) => {
    const c = e.ctx.camera.position;
    return { x: c.x + dx, y: c.y + dy, z: c.z + dz };
  };
  const bot = m.ai.agents.find((a) => a.alive && a.team !== m.playerTeam);

  // 1. a bot's round — the canonical damage:dealt with a shooter attached
  await run("a bot's round", () => {
    ev.emit('damage:dealt', {
      target: p, amount: 200, headshot: false, part: 'torso',
      point: at(0, 0, 0), from: bot?.position, source: bot,
    });
  });
  // 2. a bot's frag — ai puts the thrower on the explosion payload
  await run("a bot's grenade", () => {
    ev.emit('explosion', {
      position: at(2, -1, 2), radius: 6.5, damage: 300, source: bot, kind: 'grenade',
    });
  });
  // 3. the player's own frag — weapons publishes the STRING, not an actor
  await run('your own grenade', () => {
    ev.emit('explosion', {
      position: at(1, -1.4, 1), radius: 7.5, damage: 0, impulse: 148, source: 'grenade',
    });
    p.applyDamage(200, at(1, -1.4, 1), { type: 'explosion' });
  });
  // 4. a suicide drone — the real one, through Drones._detonate
  await run('a suicide drone', () => {
    const d = m.drones;
    const one = d.fire(m.playerTeam === 0 ? 1 : 0) ?? d.list.find((x) => x.alive);
    const c = e.ctx.camera.position;
    one.position.set(c.x + 0.5, c.y - 0.8, c.z + 0.8);
    d._detonate(one);
  });
  // 5. an airstrike. Close in and only 1 m down: a first pass put it at
  // (3,-1.5,3) and the player SURVIVED — `PlayerSystem._onExplosion` refuses to
  // wound through a blocked `MASK.EXPLOSION` ray, and that point is inside the
  // deck at zone C. A probe artefact, and a correct one.
  await run('an airstrike', () => {
    ev.emit('explosion', { position: at(2, -1, 2), radius: 14, damage: 400, source: 'airstrike' });
  });
  // 5b. a bomber run and a strafing run take the same branch and the same words
  await run('a bomber run', () => {
    ev.emit('explosion', { position: at(2, -1, 2), radius: 11, damage: 400, source: 'bomber' });
  });
  await run('a strafing run', () => {
    ev.emit('explosion', { position: at(2, -1, 2), radius: 5, damage: 400, source: 'strafe' });
  });
  await run('the C4', () => {
    ev.emit('explosion', { position: at(2, -1, 2), radius: 12, damage: 400, source: 'c4' });
  });
  // 6. a tank shell — the hull is an object with a name and a team
  await run('a tank shell', () => {
    const t = m.tank?.tanks?.[0];
    if (t) { t.position.set(...at(20, 0, 20) ? [at(20,0,20).x, 0, at(20,0,20).z] : [0,0,0]); }
    ev.emit('explosion', { position: at(1, -1, 1), radius: 9, damage: 400, source: t ?? null });
  });
  // 7. the cathedral / a zone barrage — source null, by design
  await run('the bombardment', () => {
    ev.emit('explosion', { position: at(2, -1, 2), radius: 16, damage: 400, source: null });
  });
  // 8. the fall — no killer and nowhere to stand
  await run('a fall', () => {
    p.applyDamage(200, null, { type: 'fall' });
  });
  return rows;
});
console.table(cases);
await page.screenshot({ path: 'shots/killcam-last.png' });
console.log('pageerrors', errs.length, errs.slice(0, 4));
await b.close();
