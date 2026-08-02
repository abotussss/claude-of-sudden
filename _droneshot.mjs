/**
 * THE THREE PICTURES, AND THE TWO THINGS THEY PROVE.
 *
 *   1. a drone in flight, from the ground, with the airframe on screen
 *   2. the lock-on warning, with the player actually locked
 *   3. the kill cam, after the drone has killed him
 *
 * It also measures the two things the whole-match probe cannot, because in it
 * the player stands in his spawn with the controls off: how long a lock lasts
 * from acquisition to detonation, and whether a drone can be shot down.
 *
 * Usage: node _droneshot.mjs [url] [seed]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://127.0.0.1:4451/';
const SEED = process.argv[3] ?? '7';
const SHOTS = 'shots';
mkdirSync(SHOTS, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

/** Put the match live with the player standing in the open, still in control. */
const live = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  return { phase: m.phase, playerTeam: m.playerTeam, zones: m.sites.map((z) => z.id) };
});
console.log('live:', JSON.stringify(live));

/* ═══ 1. a drone in flight ═══════════════════════════════════════════════ */
const flight = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const p = e.ctx.peek('player');
  const d = m.drones;
  // Stand the player on the middle zone, in the open, looking at the enemy base.
  const z = m.sites[1] ?? m.sites[0];
  p.respawnAt(z.position, 0);
  await new Promise((r) => requestAnimationFrame(r));
  /**
   * THE PLAYER IS THE ONLY THING ITS SIDE CAN SEE, for the rest of this probe.
   * A drone picks the nearest hostile, and on a live 20v20 the nearest hostile
   * to an enemy drone is essentially never the one man with a camera — the
   * first pass photographed a drone 85 m away doing its job somewhere else.
   * This is a HUD and camera test, not a target-selection test; selection is
   * measured over whole matches in `_dronematch.mjs`.
   */
  window.__REAL_ENEMIES__ = d.enemies;
  d.enemies = (team, out) => { if (m.playerTeam !== team) out.push(p); return out; };
  const foe = m.playerTeam === 0 ? 1 : 0;
  const one = d.fire(foe);
  // Fly on until it is close enough to photograph, then point the camera at it.
  const start = performance.now();
  while (performance.now() - start < 90000) {
    await new Promise((r) => requestAnimationFrame(r));
    if (!one.alive) break;
    if (one.position.distanceTo(p.position) < 30) break;
  }
  const cam = e.ctx.camera;
  const dx = one.position.x - cam.position.x;
  const dy = one.position.y - cam.position.y;
  const dz = one.position.z - cam.position.z;
  p.movement.yaw = Math.atan2(-dx, -dz);
  p.movement.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  p.rig.update(1 / 60, p.movement, p.health);
  p.rig.applyTo(cam);
  cam.updateMatrixWorld();
  await new Promise((r) => requestAnimationFrame(r));
  return {
    alive: one.alive, state: one.state, id: one.id, team: one.team, name: one.name,
    range: +one.position.distanceTo(p.position).toFixed(1),
    altitude: +one.position.y.toFixed(1),
    visible: one.group.visible,
    speed: +Math.hypot(one.vel.x, one.vel.y, one.vel.z).toFixed(1),
  };
});
await page.screenshot({ path: `${SHOTS}/drone-flight.png` });
console.log('1. flight:', JSON.stringify(flight));

/* ═══ 2. the lock-on warning ═════════════════════════════════════════════ */
const lock = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const p = e.ctx.peek('player');
  const d = m.drones;
  const ui = e.ctx.peek('ui');
  const realEnemies = window.__REAL_ENEMIES__;
  // A FRESH ONE. Step 1 left its drone already committed, so the strip caught
  // was the dive and then the break — a true read of a state this picture is
  // not about. Clear the sky, stand him somewhere new and start the clock at
  // the launch.
  for (const x of d.list) if (x.alive) d._retire(x, 'probe');
  const z = m.sites[0];
  p.respawnAt(z.position, 0);
  await new Promise((r) => requestAnimationFrame(r));
  d.fire(m.playerTeam === 0 ? 1 : 0);
  const t0 = e.ctx.time.elapsed;
  let acquired = -1;
  let dived = -1;
  const start = performance.now();
  while (performance.now() - start < 90000) {
    await new Promise((r) => requestAnimationFrame(r));
    const s = ui.droneLockStrip;
    if (s.active && acquired < 0) acquired = e.ctx.time.elapsed - t0;
    if (s.active && s.diving && dived < 0) dived = e.ctx.time.elapsed - t0;
    // Photograph it MID-LOCK: the warning has appeared, the bar is part spent
    // and the dive has not committed, which is the whole two seconds the
    // feature exists to give the player.
    if (s.active && s.progress > 0.35 && s.progress < 0.8 && !s.diving) break;
    if (p.dead) break;
  }
  const s = ui.droneLockStrip;
  return {
    restore: !!realEnemies,
    active: s.active, text: s.text, visible: s.visible,
    progress: +s.progress.toFixed(2), remain: +s.remain.toFixed(2),
    range: +s.range.toFixed(1), diving: s.diving,
    acquiredAfter: +acquired.toFixed(2), divedAfter: +dived.toFixed(2),
    edgeShown: getComputedStyle(s.edge).display !== 'none',
  };
});
await page.screenshot({ path: `${SHOTS}/drone-lock.png` });
console.log('2. lock:', JSON.stringify(lock));

/* ═══ 2b. break the lock by going indoors ════════════════════════════════ */
const broke = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ui = e.ctx.peek('ui');
  const p = e.ctx.peek('player');
  const d = m.drones;
  const vol = e.ctx.peek('world')?.interiorVolumes?.[0];
  if (!vol) return { skipped: 'no interior volume published' };
  /**
   * A FRESH LOCK, BROKEN EARLY. The first pass moved to cover with 0.98 s of
   * the 2.2 s left and the drone committed anyway, at 0.75 s of blindness
   * against a `droneLockBreak` of 1.0 — which is the design working, not
   * failing: a dive cannot be un-flown. So this reacts the way the warning
   * tells you to, as soon as it appears.
   */
  for (const x of d.list) if (x.alive) d._retire(x, 'probe');
  const zz = m.sites[0];
  p.respawnAt(zz.position, 0);
  await new Promise((r) => requestAnimationFrame(r));
  d.fire(m.playerTeam === 0 ? 1 : 0);
  const start0 = performance.now();
  while (performance.now() - start0 < 90000 && !ui.droneLockStrip.active) {
    await new Promise((r) => requestAnimationFrame(r));
    if (p.dead) break;
  }
  const at = +ui.droneLockStrip.progress.toFixed(2);
  // A roof over his head: the interior of an enterable building, which is the
  // cover the whole design says breaks a lock.
  const t0 = e.ctx.time.elapsed;
  p.respawnAt({ x: vol.cx, y: vol.floorY + 0.1, z: vol.cz }, 0);
  let cleared = -1;
  const start = performance.now();
  while (performance.now() - start < 30000) {
    await new Promise((r) => requestAnimationFrame(r));
    if (!ui.droneLockStrip.active && cleared < 0) { cleared = e.ctx.time.elapsed - t0; break; }
    if (p.dead) break;
  }
  const live = d.list.filter((x) => x.alive).map((x) => ({ st: x.state, blind: +x.blindT.toFixed(2) }));
  return { movedAtProgress: at, clearedAfter: +cleared.toFixed(2), dead: p.dead, live };
});
console.log('2b. break by cover:', JSON.stringify(broke));

/* ═══ 3. shoot one down ══════════════════════════════════════════════════ */
const shot = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const p = e.ctx.peek('player');
  const phys = e.ctx.peek('physics');
  const d = m.drones;
  const before = d.stats.shotDown;
  // BACK IN THE OPEN. 2b left him standing inside a building, and a first pass
  // measured 12 rounds and 0 hits because every one of them hit the wall.
  const z = m.sites[1] ?? m.sites[0];
  p.respawnAt(z.position, 0);
  await new Promise((r) => requestAnimationFrame(r));
  // Put one in the air at a known place in front of him and trace real rounds
  // at it through the canonical bullet path — the same MASK.BULLET every rifle
  // in the game uses, so this measures the proxy and not a special case.
  const foe = m.playerTeam === 0 ? 1 : 0;
  const one = d.fire(foe);
  if (!one) return { skipped: 'no free slot' };
  const eye = e.ctx.camera.position;
  one.position.set(eye.x + 18, eye.y + 6, eye.z);
  one.vel.set(0, 0, 0);
  one.state = 'recover';
  one.recoverT = 30;
  await new Promise((r) => requestAnimationFrame(r));
  const dir = { x: 0, y: 0, z: 0 };
  let rounds = 0;
  let hits = 0;
  let events = 0;
  const off = e.ctx.events.on('damage:dealt', (ev) => { if (ev.target === one) events++; });
  const hp0 = one.health;
  while (rounds < 12 && one.alive) {
    dir.x = one.position.x - eye.x;
    dir.y = one.position.y - eye.y;
    dir.z = one.position.z - eye.z;
    const l = Math.hypot(dir.x, dir.y, dir.z);
    dir.x /= l; dir.y /= l; dir.z /= l;
    const before2 = one.health;
    phys.fireBullet({
      origin: eye, dir, damage: 21, penetration: 1.2, maxDist: 60,
      mask: phys.MASK.BULLET, shooter: p,
    });
    rounds++;
    if (one.health < before2) hits++;
    await new Promise((r) => requestAnimationFrame(r));
  }
  off();
  return {
    rounds, hits, events, hp0, hpLeft: +one.health.toFixed(1), alive: one.alive,
    perRound: hits ? +((hp0 - Math.max(0, one.health)) / hits).toFixed(1) : 0,
    shotDown: d.stats.shotDown - before,
    detonatedOnDeath: d.stats.detonated,
  };
});
console.log('3. shoot-down:', JSON.stringify(shot));

/* ═══ 4. the kill cam, drone ═════════════════════════════════════════════ */
const cam = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const p = e.ctx.peek('player');
  const ui = e.ctx.peek('ui');
  const d = m.drones;
  // Kill him with a REAL drone detonation at his feet, through the real
  // explosion path — no fabricated payload.
  const one = d.fire(m.playerTeam === 0 ? 1 : 0) ?? d.list.find((x) => x.alive);
  const eye = e.ctx.camera.position;
  one.position.set(eye.x, eye.y - 0.8, eye.z + 1.0);
  p.health.value = 60;
  await new Promise((r) => requestAnimationFrame(r));
  d._detonate(one);
  for (let i = 0; i < 40; i++) await new Promise((r) => requestAnimationFrame(r));
  const k = m.spectator.kill;
  return {
    dead: p.dead,
    killCamActive: !!m.spectator.killCam,
    mode: m.spectator.mode,
    name: k?.name, cause: k?.cause, dist: k ? +k.dist.toFixed(1) : null,
    environmental: k?.environmental,
    strip: ui.killCamStrip.text,
    stripVisible: ui.killCamStrip.visible,
    lastSource: p.lastDamage.source,
    lastKind: p.lastDamage.kind,
    lastLabel: p.lastDamage.label,
  };
});
await page.screenshot({ path: `${SHOTS}/drone-killcam.png` });
console.log('4. kill cam (drone):', JSON.stringify(cam));

console.log('pageerrors', errs.length, errs.slice(0, 4));
await b.close();
