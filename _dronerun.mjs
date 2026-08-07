/**
 * A SUICIDE DRONE'S RUN AT THE MAN BEHIND THE CAMERA, PHOTOGRAPHED, AND THE
 * THREE WAYS OUT OF IT MEASURED.
 *
 * Nothing numeric tests "he can read this coming", so the four frames are the
 * gate: the halo out at cruise, the lock with its converging ring and its HUD
 * strip, the last second of the dive, and the blast. Then the counter-play,
 * which has to be true or the whole feature is an ambush:
 *
 *   SHOOT IT     rounds to kill through the canonical `phys.fireBullet` path
 *   BREAK SIGHT  one second out of its eye (`droneLockBreak`) drops the lock
 *   RUN          which must FAIL — @see the header of `src/match/drone.js`
 *
 * DO NOT `ai.protect()` THE PLAYER TO SURVIVE THE HARNESS. The first cut did,
 * and got a drone that flew straight past him: `AiSystem.hostilesOf` gates the
 * player on `targetable()`, `match` wires `drones.enemies` to that same list
 * (`match/index.js`, `this.drones.enemies = ... this._tankEnemies`), so a
 * protected player is INVISIBLE to a drone's `_scan`. `ai.combatEnabled = false`
 * is the setting that stops the bots shooting without hiding him.
 *
 * The URL is assembled here rather than taken as a prefix: `${URL}?capture=1`
 * on a `?map=plains` argument yields `?map=plains?capture=1` and silently runs
 * the town. The map id is echoed below as the proof.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('shots', { recursive: true });
const MAP = process.argv[2] ?? 'plains';
const SHOT = MAP === 'plains' ? 'nf' : 'town';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:4579/?capture=1&seed=7&map=${MAP}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
await page.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 240000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.time.scale = 1;
  e.input.frozen = true;
  e.ctx.peek('ai').combatEnabled = false;
});
await page.mouse.click(800, 450);
await page.waitForTimeout(400);
console.log('map', await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id));

await page.evaluate(() => {
  const E = () => window.__ENGINE__;
  const D = () => window.__DRONES__;
  const P = () => E().ctx.peek('player');

  /** Stand in the open, well away from the bot mass, with no roof. */
  window.__STAND__ = (x, z) => {
    const p = P();
    const w = E().ctx.peek('world');
    p.movement.velocity.set(0, 0, 0);
    p.movement.teleport(x, w.groundHeight(x, z) + 0.05, z);
    return { x, z, y: +w.groundHeight(x, z).toFixed(1) };
  };

  /** One HOSTILE drone, hand-fired, parked off his shoulder at cruise height. */
  window.__SEND__ = (range = 44) => {
    const dr = D();
    const p = P();
    for (const s of dr.list) if (s.alive) dr._retire(s, 'probe');
    const d = dr.fire(dr.playerTeam === 0 ? 1 : 0);
    if (!d) return null;
    d.position.set(p.position.x + range, p.position.y + 22, p.position.z + 10);
    d.vel.set(-8, 0, -2);
    d.state = 'hunt';
    d.groundY = p.position.y;
    d.group.position.copy(d.position);
    return { id: d.id, name: d.name, team: d.team, hostile: d.hostile };
  };

  /** Hold the camera on the live drone until it reaches `untilState`. */
  window.__RUN__ = async (untilState, minLockT, maxMs) => {
    const dr = D();
    const p = P();
    const d = dr.list.find((x) => x.alive) ?? null;
    if (!d) return { ok: false, why: 'none aloft' };
    const t0 = performance.now();
    while (performance.now() - t0 < maxMs) {
      await new Promise((r) => requestAnimationFrame(r));
      if (!d.alive) return { ok: false, why: 'died', state: d.state };
      const ex = p.position.x, ey = p.position.y + 1.6, ez = p.position.z;
      const dx = d.position.x - ex, dy = d.position.y - ey, dz = d.position.z - ez;
      // `movement._fwd` is (-sin yaw, 0, -cos yaw) — @see src/player/movement.js
      p.movement.yaw = Math.atan2(-dx, -dz);
      p.movement.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      if (d.state === untilState && d.lockT >= minLockT) break;
    }
    return {
      ok: d.state === untilState, state: d.state, lockT: +d.lockT.toFixed(2),
      range: +Math.hypot(d.position.x - p.position.x, d.position.y - p.position.y - 1.15, d.position.z - p.position.z).toFixed(1),
      onPlayer: d.target?.isPlayer === true, atPlayer: d.atPlayer,
      aimRing: d.aim.visible, hudWarning: d.warning, hostilePaint: d.hostile,
    };
  };
});

const where = await page.evaluate((m) => window.__STAND__(...(m === 'plains' ? [-150, 40] : [6, 4])), MAP);
console.log('standing', JSON.stringify(where), 'sent', JSON.stringify(await page.evaluate(() => window.__SEND__())));

/* ---- 1. CRUISE — the halo, before it has chosen anybody ------------------ */
console.log('1 cruise ', JSON.stringify(await page.evaluate(() => window.__RUN__('hunt', 0, 1200))));
await page.screenshot({ path: `shots/drone-${SHOT}-1-cruise.png` });

/* ---- 2. LOCK — the converging ring and the HUD strip --------------------- */
console.log('2 lock   ', JSON.stringify(await page.evaluate(() => window.__RUN__('lock', 1.4, 90000))));
await page.screenshot({ path: `shots/drone-${SHOT}-2-lock.png` });

/* ---- 3. DIVE — committed, and the last second is his -------------------- */
console.log('3 dive   ', JSON.stringify(await page.evaluate(() => window.__RUN__('dive', 0, 90000))));
await page.waitForTimeout(240);
await page.screenshot({ path: `shots/drone-${SHOT}-3-dive.png` });

/* ---- 4. IT CONNECTS ----------------------------------------------------- */
const hit = await page.evaluate(async () => {
  const dr = window.__DRONES__;
  const p = window.__ENGINE__.ctx.peek('player');
  const before = dr.stats.detonated;
  // `p.health` is a `Health` OBJECT, not a number — @see src/player/index.js.
  const hp0 = p.health?.value ?? null;
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    if (dr.stats.detonated > before) break;
  }
  await new Promise((r) => requestAnimationFrame(r));
  return {
    detonated: dr.stats.detonated - before, hpBefore: hp0,
    hpAfter: p.health?.value ?? null, dead: p.health?.dead === true,
  };
});
await page.screenshot({ path: `shots/drone-${SHOT}-4-blast.png` });
console.log('4 blast  ', JSON.stringify(hit));

/* ====================================================================== */
/* THE COUNTER-PLAY                                                        */
/* ====================================================================== */

const rtk = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const dr = window.__DRONES__;
  const phys = e.ctx.peek('physics');
  const w = e.ctx.peek('weapons');
  const shooter = e.ctx.peek('player');
  /**
   * THE LIVE DEFS, off `weapons.states` — the same place `Drones._fragDef`
   * reads the frag's numbers from. `WEAPON_DEFS` is a module export and is not
   * on the system instance, so this is what a probe can actually see: the guns
   * the player is carrying this match.
   */
  const defs = {};
  if (w?.states?.values) for (const s of w.states.values()) if (s?.def?.damage > 0) defs[s.def.id ?? s.def.name ?? Object.keys(defs).length] = s.def;
  if (!Object.keys(defs).length || !phys?.fireBullet) {
    return { skipped: true, guns: Object.keys(defs).length, hasFire: !!phys?.fireBullet };
  }
  const out = {};
  for (const key of Object.keys(defs)) {
    const def = defs[key];
    if (!def || !(def.damage > 0) || def.class === 'grenade' || def.class === 'launcher') continue;
    dr.reset();
    const d = dr.fire(0);
    if (!d) break;
    // 18 m dead ahead of the muzzle, held still — the same bench the header quotes.
    d.position.set(0, 40, 0);
    d.group.position.copy(d.position);
    d.collider?.setSphere(0, 40, 0, 0.31);
    let n = 0;
    while (d.alive && n < 40) {
      n++;
      phys.fireBullet({
        origin: { x: 0, y: 40, z: -18 }, dir: { x: 0, y: 0, z: 1 },
        damage: def.damage, penetration: def.penetration ?? 1,
        maxDist: 60, mask: phys.MASK.BULLET, shooter,
      });
    }
    out[key] = d.alive ? `>${n}` : n;
    if (d.alive) dr._retire(d, 'probe');
  }
  dr.reset();
  return out;
});
console.log('rounds to kill @18 m', JSON.stringify(rtk));

const counter = await page.evaluate(async (m) => {
  const e = window.__ENGINE__;
  const dr = window.__DRONES__;
  const p = e.ctx.peek('player');
  const frame = () => new Promise((r) => requestAnimationFrame(r));

  /**
   * RUN — and it is measured FROM THE MOMENT IT COMMITS, which is the only
   * honest form of the claim. Measured from the LOCK it is contaminated: the
   * plain has forty other men on it, `_hunt` flies at the nearest hostile at
   * any range, so a man who sprints away simply stops being the nearest and
   * the drone goes somewhere else — which is a lock broken by distance
   * (`droneBreakRange`, 70 m) and not a dive outrun. From the dive there is
   * nothing to confound: 17 m/s against 8.38, straight away, in the open.
   */
  window.__STAND__(...(m === 'plains' ? [-150, 40] : [6, 4]));
  window.__SEND__();
  let d = dr.list.find((x) => x.alive) ?? null;
  let ran = null;
  if (d) {
    for (let i = 0; i < 5400 && d.alive && d.state !== 'dive'; i++) await frame();
    const dived = d.state === 'dive';
    const r0 = Math.hypot(d.position.x - p.position.x, d.position.z - p.position.z);
    const before = dr.stats.detonated;
    let t = 0;
    for (let i = 0; i < 900 && d.alive; i++) {
      await frame();
      const dt = e.time.dt || 0.016;
      t += dt;
      const dx = p.position.x - d.position.x, dz = p.position.z - d.position.z;
      const l = Math.hypot(dx, dz) || 1;
      // 8.38 m/s is tactical sprint — @see src/player/tuning.js.
      p.movement.teleport(p.position.x + (dx / l) * 8.38 * dt, p.position.y, p.position.z + (dz / l) * 8.38 * dt);
    }
    ran = {
      dived, rangeAtCommit: +r0.toFixed(1), secondsToImpact: +t.toFixed(2),
      detonated: dr.stats.detonated - before, escaped: dr.stats.detonated === before,
    };
    for (const s of dr.list) if (s.alive) dr._retire(s, 'probe');
  }

  /* BREAK SIGHT — one second out of its eye, through the world's own occlusion. */
  window.__STAND__(...(m === 'plains' ? [-150, 40] : [6, 4]));
  window.__SEND__();
  d = dr.list.find((x) => x.alive) ?? null;
  let broke = null;
  if (d) {
    for (let i = 0; i < 1200 && d.alive && d.state !== 'lock'; i++) await frame();
    const locked = d.state === 'lock' && d.target?.isPlayer === true;
    const y0 = p.position.y;
    /**
     * EIGHT METRES DOWN, NOT FORTY. The first cut dropped him 40 m and the lock
     * broke in 0.02 s with `blindT` still 0 — which is not the sight break at
     * all, it is `_holdLock`'s FIRST test, `range > droneBreakRange` (70 m):
     * 40 m of depth under a drone already 22 m up is 62 m of vertical on its
     * own. Eight metres keeps the whole thing inside 45 m, so the only thing
     * that can drop this lock is the terrain in the `MASK.SIGHT` ray, and
     * `blindT` climbing to `droneLockBreak` is the proof it was.
     */
    p.movement.teleport(p.position.x, y0 - 8, p.position.z);
    const r0 = Math.hypot(d.position.x - p.position.x, d.position.y - p.position.y, d.position.z - p.position.z);
    let t = 0;
    let peak = 0;
    for (let i = 0; i < 400 && d.alive && d.state === 'lock'; i++) {
      await frame();
      t += e.time.dt || 0.016;
      peak = Math.max(peak, d.blindT);
    }
    broke = {
      locked, after: d.state, secondsToBreak: +t.toFixed(2),
      peakBlindT: +peak.toFixed(2), rangeWhenHidden: +r0.toFixed(1),
      brokeOnSightNotRange: r0 < 70,
    };
    p.movement.teleport(p.position.x, y0, p.position.z);
    for (const s of dr.list) if (s.alive) dr._retire(s, 'probe');
  }
  dr.reset();
  return { ran, broke };
}, MAP);
console.log('counter-play', JSON.stringify(counter));

console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs.slice(0, 4).join(' | ')}` : 'pageerrors: none');
await browser.close();
