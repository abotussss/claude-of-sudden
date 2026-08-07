/**
 * WHAT AN EMP FIELD LOOKS LIKE FROM OUTSIDE IT, FROM INSIDE IT, AND AT THE
 * MOMENT IT TAKES A DRONE.
 *
 * Nothing numeric tests "the player can read this", so these are the gate.
 * NACHTFELD only — @see `src/match/empzone.js` for why the town has none.
 *
 * The URL is assembled here rather than taken as a prefix: several probes in
 * this tree do `${URL}?capture=1`, which turns a `?map=plains` argument into
 * `?map=plains?capture=1` and silently runs the town.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('shots', { recursive: true });
const BASE = 'http://127.0.0.1:4579/';
const url = `${BASE}?capture=1&seed=7&map=plains`;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
const warn = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || /EMP|shader|GLSL|program/i.test(t)) warn.push(`${m.type()}: ${t}`);
});
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
await page.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 240000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.time.scale = 1;
  e.input.frozen = true;
  const ai = e.ctx.peek('ai');
  ai.combatEnabled = false;
  ai.protect(e.ctx.peek('player'), 9999);
});
await page.mouse.click(800, 450);
await page.waitForTimeout(500);

const info = await page.evaluate(() => {
  const d = window.__DRONES__;
  return {
    map: window.__ENGINE__.ctx.peek('world')?.level?.id,
    zones: (d?.emp?.zones ?? []).map((z) => ({
      id: z.id, r: +z.r.toFixed(1),
      at: [+z.position.x.toFixed(1), +z.position.y.toFixed(1), +z.position.z.toFixed(1)],
    })),
  };
});
console.log('map', info.map, 'EMP fields', JSON.stringify(info.zones));

/** Stand at (x,z) on the ground and look at a world point. */
const stand = (sx, sz, look) => page.evaluate(([sx, sz, look]) => {
  const e = window.__ENGINE__;
  const p = e.ctx.peek('player');
  const w = e.ctx.peek('world');
  const y = w.groundHeight(sx, sz);
  p.movement.velocity.set(0, 0, 0);
  p.movement.teleport(sx, y + 0.05, sz);
  const ex = sx, ey = y + 1.6, ez = sz;
  const dx = look[0] - ex, dy = look[1] - ey, dz = look[2] - ez;
  // `movement._fwd` is (-sin yaw, 0, -cos yaw) — @see src/player/movement.js.
  p.movement.yaw = Math.atan2(-dx, -dz);
  p.movement.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return null;
}, [sx, sz, look]);

const A = info.zones.find((z) => z.id === 'A') ?? info.zones[0];
if (!A) { console.log('NO EMP FIELDS — nothing to shoot'); await browser.close(); process.exit(1); }

/* ---- 1. from outside, at 95 m, with the whole dome in frame -------------- */
await stand(A.at[0] + 95, A.at[2] + 34, [A.at[0], A.at[1] + 14, A.at[2]]);
await page.waitForTimeout(1400);
await page.screenshot({ path: 'shots/emp-A-outside.png' });
console.log('shot shots/emp-A-outside.png');

/* ---- 2. at the boundary, 3 m out, reading the posts ---------------------- */
await stand(A.at[0] + A.r + 4, A.at[2], [A.at[0] + A.r - 2, A.at[1] + 6, A.at[2] + 2]);
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/emp-A-boundary.png' });
console.log('shot shots/emp-A-boundary.png');

/* ---- 3. from inside, standing on the point ------------------------------ */
await stand(A.at[0], A.at[2], [A.at[0] + A.r, A.at[1] + 12, A.at[2]]);
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/emp-A-inside.png' });
console.log('shot shots/emp-A-inside.png');

/* ---- 4. a drone flown into it: the fall and the discharge ---------------- */
const kill = await page.evaluate(async (A) => {
  const e = window.__ENGINE__;
  const dr = window.__DRONES__;
  const p = e.ctx.peek('player');
  const w = e.ctx.peek('world');
  // Stand off the rim so both the drone and the dome are in frame.
  const sx = A.at[0] + 62, sz = A.at[2] + 8;
  p.movement.velocity.set(0, 0, 0);
  p.movement.teleport(sx, w.groundHeight(sx, sz) + 0.05, sz);

  const d = dr.fire(0);
  if (!d) return { ok: false, why: 'no drone' };
  // Put it just outside the rim at cruise height and aim it at the centre. This
  // is the same geometry a committed dive gives; hand-placed so the shot is on
  // a known frame rather than on a lucky lock.
  const y = A.at[1] + 20;
  d.position.set(A.at[0] + A.r + 12, y, A.at[2] + 4);
  d.state = 'hunt';
  d.vel.set(-12, 0, 0);
  d.want.set(A.at[0], y, A.at[2]);
  const t0 = performance.now();
  while (performance.now() - t0 < 8000) {
    await new Promise((r) => requestAnimationFrame(r));
    // Hold the waypoint on the centre: `hunt` deflection would steer it round,
    // which is the correct behaviour and is exactly what this shot has to defeat
    // to photograph the kill. A real one arrives here in a dive.
    if (d.state === 'hunt') { d.want.set(A.at[0], y, A.at[2]); d.state = 'dive'; d.target = { position: { x: A.at[0], y: A.at[1], z: A.at[2] }, isPlayer: false }; }
    // Keep the camera on it.
    const ex = sx, ey = w.groundHeight(sx, sz) + 1.6, ez = sz;
    const dx = d.position.x - ex, dy = d.position.y - ey, dz = d.position.z - ez;
    // `movement._fwd` is (-sin yaw, 0, -cos yaw) — @see src/player/movement.js.
  p.movement.yaw = Math.atan2(-dx, -dz);
    p.movement.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    if (d.state === 'fall' && d.fallT > 0.45) break;
  }
  return {
    ok: d.state === 'fall', state: d.state, fallT: +(d.fallT ?? 0).toFixed(2),
    empKilled: dr.stats.empKilled, crashed: dr.stats.crashed,
    detonated: dr.stats.detonated,
    flash: +(dr.emp.zones[0].flash ?? 0).toFixed(2),
    y: +d.position.y.toFixed(1),
  };
}, A);
console.log('emp kill', JSON.stringify(kill));
await page.screenshot({ path: 'shots/emp-A-kill.png' });
console.log('shot shots/emp-A-kill.png');

console.log(errs.length ? `PAGEERRORS: ${errs.slice(0, 4).join(' | ')}` : 'pageerrors: none');
if (warn.length) for (const w of warn.slice(0, 8)) console.log('  ' + w);
await browser.close();
