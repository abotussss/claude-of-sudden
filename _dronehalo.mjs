/**
 * THE DRONE HIGHLIGHT, PHOTOGRAPHED.
 *
 * Four pictures, and each one is a thing the player asked to be able to SEE:
 *
 *   1. a hostile drone in the sky with its halo on it, from the ground
 *   2. the same frame with a FRIENDLY drone beside it — the colour split
 *   3. one coming at him: the converging ring and the beat, mid-lock
 *   4. the HUD drone marks, hostile and friendly, with the range and the bar
 *
 * Usage: node _dronehalo.mjs [url] [seed]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://127.0.0.1:4483/';
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

const live = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  return {
    phase: m.phase,
    playerTeam: m.playerTeam,
    dronePlayerTeam: m.drones.playerTeam,
    budgetLeft: m.drones.left,
    zones: m.sites.map((z) => `${z.id}:${z.owner}`),
  };
});
console.log('live:', JSON.stringify(live));

/**
 * Park a drone at a known range from the eye and look straight at it.
 *
 * THE DIRECTION IS FOUND, NOT ASSUMED. A fixed offset put both drones inside a
 * building on this seed and photographed a wall; the sweep below takes the
 * first bearing whose `MASK.SIGHT` ray gets the whole way out, which is open
 * sky and is where a drone actually lives.
 */
const stage = `
  (async (hostileOnly, dist) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const p = e.ctx.peek('player');
    const phys = e.ctx.peek('physics');
    const d = m.drones;
    for (const x of d.list) if (x.alive) d._retire(x, 'probe');
    const z = m.sites[1] ?? m.sites[0];
    p.respawnAt(z.position, 0);
    await new Promise((r) => requestAnimationFrame(r));
    const foe = m.playerTeam === 0 ? 1 : 0;
    const out = [];
    const foeD = d.fire(foe);
    out.push(foeD);
    if (!hostileOnly) out.push(d.fire(m.playerTeam));
    await new Promise((r) => requestAnimationFrame(r));
    const eye = e.ctx.camera.position;
    let bx = 1, by = 0.34, bz = 0;
    for (let a = 0; a < 24; a++) {
      const th = (a / 24) * Math.PI * 2;
      const el = 0.34;
      const dx = Math.cos(th) * Math.cos(el);
      const dy = Math.sin(el);
      const dz = Math.sin(th) * Math.cos(el);
      const h = phys.raycast(eye.x, eye.y, eye.z, dx, dy, dz, dist + 8, phys.MASK.WORLD);
      if (!h?.hit) { bx = dx; by = dy; bz = dz; break; }
    }
    // Perpendicular in the horizontal plane, so the pair sits side by side.
    const px = -bz, pz = bx;
    for (let i = 0; i < out.length; i++) {
      const one = out[i];
      if (!one) continue;
      one.state = 'recover';
      one.recoverT = 60;
      one.vel.set(0, 0, 0);
      const off = i === 0 ? -2.6 : 2.6;
      one.position.set(
        eye.x + bx * dist + px * off,
        eye.y + by * dist,
        eye.z + bz * dist + pz * off
      );
      one.groundY = 0;
    }
    // Two frames so _pose/_mark run on the parked positions.
    await new Promise((r) => requestAnimationFrame(r));
    const cam = e.ctx.camera;
    const t = out[0];
    const dx = t.position.x - cam.position.x;
    const dy = t.position.y - cam.position.y;
    const dz = t.position.z - cam.position.z;
    p.movement.yaw = Math.atan2(-dx, -dz);
    p.movement.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    p.rig.update(1 / 60, p.movement, p.health);
    p.rig.applyTo(cam);
    cam.updateMatrixWorld();
    await new Promise((r) => requestAnimationFrame(r));
    return out.filter(Boolean).map((one) => ({
      name: one.name, team: one.team, hostile: one.hostile,
      halo: one.halo.material.color.getHexString(),
      haloOpacity: one.halo.material.opacity,
      strobe: one.strobe.material.color.getHexString(),
      markVisible: one.mark.visible,
      markScale: +one.mark.scale.x.toFixed(3),
      aimVisible: one.aim.visible,
      range: +one.position.distanceTo(cam.position).toFixed(1),
    }));
  })
`;

/** The middle of the frame, 3x, so the ring can be read rather than guessed. */
const ZOOM = { x: 440, y: 190, width: 400, height: 340 };

/* ═══ 1. a hostile drone, halo on ════════════════════════════════════════ */
const one = await page.evaluate(`${stage}(true, 26)`);
await page.screenshot({ path: `${SHOTS}/halo-hostile.png` });
await page.screenshot({ path: `${SHOTS}/halo-hostile-zoom.png`, clip: ZOOM });
console.log('1. hostile:', JSON.stringify(one));

/* ═══ 2. hostile and friendly side by side ═══════════════════════════════ */
const two = await page.evaluate(`${stage}(false, 26)`);
await page.screenshot({ path: `${SHOTS}/halo-both.png` });
await page.screenshot({ path: `${SHOTS}/halo-both-zoom.png`, clip: ZOOM });
console.log('2. both:', JSON.stringify(two));

/* ═══ 2c. close enough to read the ring itself ═══════════════════════════ */
const close = await page.evaluate(`${stage}(false, 12)`);
await page.screenshot({ path: `${SHOTS}/halo-close.png` });
console.log('2c. close:', JSON.stringify(close));

/* ═══ 2b. the same pair at range, where the mark has to hold size ════════ */
const far = await page.evaluate(`${stage}(false, 85)`);
await page.screenshot({ path: `${SHOTS}/halo-both-far.png` });
console.log('2b. both at range:', JSON.stringify(far));

/* ═══ 3. one coming at him ═══════════════════════════════════════════════ */
const inbound = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const p = e.ctx.peek('player');
  const ui = e.ctx.peek('ui');
  const d = m.drones;
  for (const x of d.list) if (x.alive) d._retire(x, 'probe');
  const z = m.sites[0];
  p.respawnAt(z.position, 0);
  await new Promise((r) => requestAnimationFrame(r));
  // The player is the only thing its side can see, exactly as `_droneshot.mjs`
  // does it: this is a camera and HUD test, not a target-selection test.
  window.__REAL_ENEMIES__ = window.__REAL_ENEMIES__ ?? d.enemies;
  d.enemies = (team, out) => { if (m.playerTeam !== team) out.push(p); return out; };
  const it = d.fire(m.playerTeam === 0 ? 1 : 0);
  /**
   * PUT IT WHERE IT CAN SEE HIM. Flying in from a launch pad took longer than
   * the timeout on one run and photographed a drone still hunting at 103 m —
   * the lock is what this picture is about, not the transit. `_scan` still has
   * to see him, hold the sight for the full 2.2 s and commit on its own.
   */
  const phys = e.ctx.peek('physics');
  if (it) {
    const eye0 = e.ctx.camera.position;
    for (let a = 0; a < 24; a++) {
      const th = (a / 24) * Math.PI * 2;
      const el = 0.42;
      const dx = Math.cos(th) * Math.cos(el), dy = Math.sin(el), dz = Math.sin(th) * Math.cos(el);
      const h = phys.raycast(eye0.x, eye0.y, eye0.z, dx, dy, dz, 40, phys.MASK.SIGHT);
      if (!h?.hit) {
        it.position.set(eye0.x + dx * 32, eye0.y + dy * 32, eye0.z + dz * 32);
        it.state = 'hunt';
        it.vel.set(0, 0, 0);
        break;
      }
    }
  }
  const start = performance.now();
  while (performance.now() - start < 90000) {
    await new Promise((r) => requestAnimationFrame(r));
    const s = ui.droneLockStrip;
    if (s.active && s.progress > 0.3 && s.progress < 0.85 && !s.diving) break;
    if (p.dead) break;
  }
  const one = d.list.find((x) => x.alive && x.atPlayer) ?? d.list.find((x) => x.alive);
  const cam = e.ctx.camera;
  if (one) {
    const dx = one.position.x - cam.position.x;
    const dy = one.position.y - cam.position.y;
    const dz = one.position.z - cam.position.z;
    p.movement.yaw = Math.atan2(-dx, -dz);
    p.movement.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    p.rig.update(1 / 60, p.movement, p.health);
    p.rig.applyTo(cam);
    cam.updateMatrixWorld();
  }
  await new Promise((r) => requestAnimationFrame(r));
  const s = ui.droneLockStrip;
  // Was the airframe actually in view? The world halo is depth-tested on
  // purpose, so a mark with no ring under it means the drone was behind
  // something — which is a true picture but not the one this step wants.
  const losPhys = e.ctx.peek('physics');
  const eyeNow = cam.position;
  const seen = one
    ? losPhys.lineOfSight(eyeNow, one.position, losPhys.MASK.SIGHT)
    : false;
  return {
    losClear: !!seen,
    strip: s.text, progress: +s.progress.toFixed(2),
    atPlayer: !!one?.atPlayer, state: one?.state,
    aimVisible: !!one?.aim.visible,
    aimScale: one ? +one.aim.scale.x.toFixed(2) : null,
    markScale: one ? +one.mark.scale.x.toFixed(2) : null,
    range: one ? +one.position.distanceTo(cam.position).toFixed(1) : null,
    hudDrones: ui._drones ? ui._drones.length : -1,
    hudMarks: ui.markers.droneCount ?? -1,
  };
});
await page.screenshot({ path: `${SHOTS}/halo-inbound.png` });
await page.screenshot({ path: `${SHOTS}/halo-inbound-zoom.png`, clip: ZOOM });
console.log('3. inbound:', JSON.stringify(inbound));

/* ═══ 4. the HUD marks, both sides in frame ══════════════════════════════ */
const hud = await page.evaluate(`${stage}(false, 40)`);
const hudState = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const ui = e.ctx.peek('ui');
  await new Promise((r) => requestAnimationFrame(r));
  const list = ui._drones ?? [];
  return {
    published: list.map((v) => ({
      name: v.name, hostile: v.hostile, health: v.health, maxHealth: v.maxHealth,
      locked: v.locked, diving: v.diving,
    })),
    drawn: ui.markers.droneCount,
    nodes: [...document.querySelectorAll('.ow-drn')]
      .filter((n) => n.style.display !== 'none')
      .map((n) => ({
        cls: n.className,
        label: n.querySelector('.ow-drn-l')?.textContent,
        sub: n.querySelector('.ow-drn-d')?.textContent,
        colour: getComputedStyle(n).color,
      })),
  };
});
await page.screenshot({ path: `${SHOTS}/halo-hud.png` });
console.log('4. hud:', JSON.stringify(hud), JSON.stringify(hudState));

console.log('pageerrors', errs.length, errs.slice(0, 4));
await b.close();
