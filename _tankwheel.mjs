/**
 * THE THREE PICTURES THE THREE REQUESTS ASK FOR.
 *
 *   node _tankwheel.mjs [--url=…] [--shots=DIR] [--seed=N]
 *
 *   climb_*   the hull with its nose up on a step it is driving over
 *   shell_*   a street before and after a round from the main gun lands in it
 *   zone_*    the hull standing off a capture point the enemy holds
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4291/';
const SHOTS = args.shots ?? './shots/tankwheel';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 200)));
await page.goto(`${URL}${args.seed ? `?seed=${args.seed}` : ''}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const sleep = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });

/**
 * THE CAMERA IS THE PLAYER'S. Writing `e.camera.position` does nothing that
 * survives a frame — `player` drives the camera every update, so the first run
 * of this probe photographed the hull as a speck sixty metres away from
 * wherever the player happened to be standing. `player.respawnAt` is how the
 * other shot probes in this repo move the eye, and it is the only thing that
 * sticks. @see `_tankshot.mjs`.
 */
async function eyeAt(x, y, z, tx, ty, tz) {
  await page.evaluate(({ x, y, z, tx, ty, tz }) => {
    const e = window.__ENGINE__;
    const ph = e.ctx.peek('physics');
    const player = e.ctx.peek('player');
    const m = e.ctx.peek('match');
    /**
     * PROBE FROM JUST OVER THE SUBJECT, NOT FROM 90 m. A ground ray dropped
     * from the sky finds the ROOF of whatever the camera is standing beside,
     * and the first run of this put the eye on a three-storey roof looking at
     * an empty parapet while the tank was in the street below.
     */
    const g = ph.groundHeight(x, z, ty + 4);
    const ey = Number.isFinite(g) ? g + 0.05 : y;
    const at = m.sites[0].position.clone();
    at.set(x, ey, z);
    const dx = tx - x, dz = tz - z;
    const dy = ty - (ey + 1.62);
    // `atan2(-dx, -dz)`, NOT `atan2(dx, dz)`: this engine's yaw runs the other
    // way, and the sign error pointed the camera 180 degrees off the subject
    // for four runs of this probe. @see `_tankshot.mjs`'s `orbit`.
    player.respawnAt(at, Math.atan2(-dx, -dz));
    player.movement.pitch = Math.asin(dy / (Math.hypot(dx, dy, dz) || 1));
  }, { x, y, z, tx, ty, tz });
  await sleep(420);
  /**
   * AND AIM IT AGAIN AFTER THE FRAMES HAVE RUN. `respawnAt` takes a yaw, and
   * the movement state machine has spent 420 ms since deciding what the yaw
   * actually is — the first frames of a respawn settle the camera. Re-writing
   * both angles after the settle is what puts the subject in the middle of the
   * frame instead of somewhere off to the left.
   */
  await page.evaluate(({ tx, ty, tz }) => {
    const player = window.__ENGINE__.ctx.peek('player');
    const p = player.position;
    const dx = tx - p.x, dz = tz - p.z, dy = ty - (p.y + 1.62);
    player.movement.yaw = Math.atan2(-dx, -dz);
    player.movement.pitch = Math.asin(dy / (Math.hypot(dx, dy, dz) || 1));
  }, { tx, ty, tz });
  await sleep(220);
}

/**
 * STAND THE EYE ON THE ROUTE. Any point a bearing-and-distance away from the
 * hull can be inside a building — twice now this probe photographed a rooftop
 * parapet from three storeys above the tank. The baked leg is the one line on
 * this map that has been PROVED to be street the whole way, so an arc position
 * on it, nudged sideways by less than half the measured span, is always
 * somewhere a camera can stand.
 */
async function eyeOnLeg(id, ahead, side, lookAtY = 1.6) {
  const r = await page.evaluate(({ id, ahead, side }) => {
    const e = window.__ENGINE__;
    const phys = e.ctx.peek('physics');
    const a = e.ctx.peek('match').tank;
    const t = a.tanks.find((x) => x.id === id);
    const p = t.legs[t.legIx];
    const V3 = e.camera.position.constructor;
    const o = new V3(), d = new V3();
    /**
     * AND THE SPOT HAS TO SEE THE TANK. An arc position on the leg is street,
     * but the SIDEWAYS nudge off it is not: at 3 m off a narrow leg the eye
     * ended up inside a building, and three separate runs of this probe came
     * back as a photograph of a wall. So the candidates are searched and the
     * first one with a clear sight line to the hull wins.
     */
    const cands = [];
    for (const da of [0, -2.5, 2.5, -5, 5]) {
      for (const ds of [side, side * 0.5, 0, -side * 0.5, -side]) {
        cands.push([ahead + da, ds]);
      }
    }
    for (const [av, sv] of cands) {
      const q = Math.max(0, Math.min(p.length, t.s + av));
      let i = 0;
      while (i < p.n - 1 && p.S[i + 1] < q) i++;
      const yaw = p.YAW[i];
      const ex = p.X[i] + Math.cos(yaw) * sv;
      const ez = p.Z[i] - Math.sin(yaw) * sv;
      const g = phys.groundHeight(ex, ez, t.position.y + 4);
      if (!Number.isFinite(g)) continue;
      const ey = g + 1.65;
      d.set(t.position.x - ex, t.position.y + 1.4 - ey, t.position.z - ez);
      const len = d.length();
      if (len < 5) continue;
      d.multiplyScalar(1 / len);
      o.set(ex, ey, ez);
      const blocked = phys.raycastAny(ex, ey, ez, d.x, d.y, d.z, len - 3.2, phys.MASK.SIGHT);
      if (blocked) continue;
      return {
        ex, ey: g, ez, tx: t.position.x, ty: t.position.y, tz: t.position.z,
        used: [+av.toFixed(1), +sv.toFixed(1)], d: +len.toFixed(1),
      };
    }
    return { ex: t.position.x, ey: t.position.y, ez: t.position.z, tx: t.position.x, ty: t.position.y, tz: t.position.z, used: null, d: 0 };
  }, { id, ahead, side });
  await eyeAt(r.ex, r.ey, r.ez, r.tx, r.ty + lookAtY, r.tz);
  console.log('    cam', JSON.stringify({ used: r.used, d: r.d }));
  return r;
}

/** Camera at a bearing relative to the hull's own heading. */
async function look(id, rel, dist, height, at = 1.7) {
  const r = await page.evaluate(({ id, rel, dist, height, at }) => {
    const t = window.__ENGINE__.ctx.peek('match').tank.tanks.find((x) => x.id === id);
    const a = t.yaw + rel;
    return {
      ex: t.position.x + Math.sin(a) * dist, ey: t.position.y + height, ez: t.position.z + Math.cos(a) * dist,
      tx: t.position.x, ty: t.position.y + at, tz: t.position.z,
      s: +t.s.toFixed(1), leg: t.legIx, dir: t.legDir, state: t.state,
      pitch: +(t._pitch * 180 / Math.PI).toFixed(1), y: +t.position.y.toFixed(2), zone: t.targetZone,
    };
  }, { id, rel, dist, height, at });
  await eyeAt(r.ex, r.ey, r.ez, r.tx, r.ty, r.tz);
  return r;
}

await page.evaluate(() => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), ui = e.ctx.peek('ui');
  if (m.phase !== 'live') m._setPhase('live', 0);
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  for (const a of m.air) a.enabled = false;
  ui.setHudVisible(false); ui.hudVisible = 0;
  e.ctx.viewScene.visible = false;
  m.tank.enabled = true;
  m.tank.fire();
  /**
   * FREEZE THE ARMOUR. Every shot below sets `tank.s` by hand and then waits
   * ~600 ms of real frames for the camera to settle — during which `update`
   * drove the hull off down its route and the picture came back as an empty
   * street. The wheel is measured elsewhere; here the hull has to hold still.
   */
  m.tank.update = () => {};
});

/* ── 1. CLIMBING ───────────────────────────────────────────────────────────
 * Find the sample on RED's approach with the biggest baked STEP that is NOT a
 * plough pile (a pile is erased before the hull reaches it), park the hull with
 * its front support on it and photograph the pitch.                          */
const climb = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const a = m.tank;
  let best = null;
  for (const t of a.tanks) {
    for (let li = 0; li < t.legs.length; li++) {
      const p = t.legs[li];
      for (let i = 2; i < p.n - 2; i++) {
        // A pile is ERASED before the front support reaches it, so it is not
        // what the climb looks like. Photograph mass the hull cannot erase.
        if (p.PILE[i] >= 0) continue;
        if (!(p.STEP[i] > 0.18)) continue;
        if (!best || p.STEP[i] > best.step) best = { id: t.id, leg: li, i, step: +p.STEP[i].toFixed(2), s: p.S[i], pile: p.PILE[i] };
      }
    }
  }
  if (!best) return null;
  const t = a.tanks.find((x) => x.id === best.id);
  t.legIx = best.leg; t.legDir = 1; t.state = 'hold'; t.planN = 0;
  t.s = Math.max(0, best.s - 2.6);
  t.yaw = t.legs[best.leg].YAW[Math.max(0, best.i - 2)];
  a._pose(t);
  return best;
});
console.log('[climb] biggest baked step:', JSON.stringify(climb));
if (climb) {
  // ABSOLUTE arc positions around the step, not deltas off wherever we were.
  for (const [nm, ds] of [['a_before', -5.0], ['b_nose_up', -2.2], ['c_on_top', 0.2], ['d_over', 3.4]]) {
    const info = await page.evaluate(({ id, leg, at }) => {
      const a = window.__ENGINE__.ctx.peek('match').tank;
      const t = a.tanks.find((x) => x.id === id);
      t.legIx = leg; t.legDir = 1; t.state = 'hold'; t.planN = 0;
      t.s = Math.max(0, Math.min(t.legs[leg].length, at));
      t.yaw = t.legs[leg].YAW[Math.max(0, Math.round(at / 1.25))];
      a._pose(t);
      return { s: +t.s.toFixed(1), pitchDeg: +(t._pitch * 180 / Math.PI).toFixed(1), y: +t.position.y.toFixed(2) };
    }, { id: climb.id, leg: climb.leg, at: climb.s + ds });
    await eyeOnLeg(climb.id, 13.5, 4.0, 1.3);
    await shot(`climb_${nm}`);
    console.log(`  climb_${nm}`, JSON.stringify(info));
  }
}

/* ── 2. THE GUN TAKES THE TOWN DOWN ───────────────────────────────────────
 * Put the hull where its own route dressed the street, aim the gun down it and
 * fire a real `_mainGun` round. Before and after, from the same camera.      */
const shell = await page.evaluate(() => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), a = m.tank;
  /**
   * DRESSING THE HULL ACTUALLY DRIVES PAST, not the densest heap on the map.
   * Picking by density alone chose a courtyard behind a wall and the camera
   * ended up with its nose against three storeys of plaster.
   */
  let best = null;
  for (const t of a.tanks) {
    for (const p of t.legs) {
      for (let i = 6; i < p.n - 6; i++) {
        let n = 0, cx = 0, cz = 0, cy = 0;
        for (const r of a._atlas.recs) {
          const d = Math.hypot(r.x - p.X[i], r.z - p.Z[i]);
          if (d > 7) continue;
          n++; cx += r.x; cz += r.z; cy += r.y;
        }
        if (n > 6 && (!best || n > best.n)) {
          best = { id: t.id, legIx: t.legs.indexOf(p), i, n, x: cx / n, y: cy / n, z: cz / n };
        }
      }
    }
  }
  if (!best) return null;
  const t = a.tanks.find((q) => q.id === best.id);
  const leg = t.legs[best.legIx];
  t.legIx = best.legIx; t.legDir = 1; t.state = 'hold'; t.planN = 0;
  // stand the hull back down its own leg so the dressing is in front of it
  t.s = Math.max(0, leg.S[best.i] - 16);
  t.yaw = leg.YAW[Math.max(0, best.i - 12)];
  a._pose(t);
  return { id: best.id, x: +best.x.toFixed(1), y: +best.y.toFixed(1), z: +best.z.toFixed(1), props: best.n };
});
console.log('[shell] target:', JSON.stringify(shell));
if (shell) {
  /**
   * DRY-FIRE FIRST, THEN PUT THE TOWN BACK. A shell lands where the BARREL is
   * pointing plus a dispersion draw, not on the record the crew were shooting
   * at — measured, the first framing of this photographed a street 20 m from
   * where the 81 props actually came off. So the gun is fired once to find out
   * where the round goes, `_restoreRaze` undoes it (which is the same call the
   * round reset makes), the camera is placed at the real impact, and the gun
   * fires again for the picture.
   */
  const impact = await page.evaluate(({ x, y, z, id }) => {
    const a = window.__ENGINE__.ctx.peek('match').tank;
    const t = a.tanks.find((q) => q.id === id);
    const dx = x - t.position.x, dz = z - t.position.z;
    const dy = (y + 0.6) - (t.position.y + 2.0);
    t.turretYaw = Math.atan2(dx, dz) - t.yaw;
    t.gunPitch = Math.atan2(dy, Math.hypot(dx, dz));
    a._pose(t);
    a._mainGun(t, { position: { x, y: y + 0.5, z } });
    const p = a._blast.position;
    const hit = { x: p.x, y: p.y, z: p.z, razed: a._atlas.fired.length };
    a._restoreRaze();
    t.stats.razed = 0;
    return hit;
  }, shell);
  console.log('[shell] dry run landed at', JSON.stringify(impact));

  // stand on the leg, in sight of where the round actually goes
  const cam = await page.evaluate(({ id, x, y, z }) => {
    const e = window.__ENGINE__, phys = e.ctx.peek('physics');
    const a = e.ctx.peek('match').tank;
    const t = a.tanks.find((q) => q.id === id);
    const p = t.legs[t.legIx];
    let best = null;
    for (let i = 0; i < p.n; i++) {
      const dd = Math.hypot(p.X[i] - x, p.Z[i] - z);
      if (dd < 7 || dd > 16) continue;
      const g = phys.groundHeight(p.X[i], p.Z[i], y + 6);
      if (!Number.isFinite(g)) continue;
      const ey = g + 1.65;
      const dx = x - p.X[i], dy = y + 0.8 - ey, dz = z - p.Z[i];
      const len = Math.hypot(dx, dy, dz);
      if (phys.raycastAny(p.X[i], ey, p.Z[i], dx / len, dy / len, dz / len, len - 1.5, phys.MASK.SIGHT)) continue;
      if (!best || dd < best.dd) best = { ex: p.X[i], ey: g, ez: p.Z[i], dd: +dd.toFixed(1) };
    }
    return best;
  }, { id: shell.id, x: impact.x, y: impact.y, z: impact.z });
  console.log('[shell] camera', JSON.stringify(cam));
  if (cam) await eyeAt(cam.ex, cam.ey, cam.ez, impact.x, impact.y + 0.8, impact.z);
  await shot('shell_a_before');

  const fired = await page.evaluate(({ x, y, z, id }) => {
    const a = window.__ENGINE__.ctx.peek('match').tank;
    const t = a.tanks.find((q) => q.id === id);
    const p0 = a._atlas.fired.length;
    a._mainGun(t, { position: { x, y: y + 0.5, z } });
    const eye = window.__ENGINE__.ctx.peek('player').position;
    let near = 0;
    for (const r of a._atlas.fired) if (Math.hypot(r.x - eye.x, r.z - eye.z) < 16) near++;
    return { razedByShot: a._atlas.fired.length - p0, statsRazed: t.stats.razed, nearCamera: near };
  }, shell);
  console.log('[shell] razed:', JSON.stringify(fired));
  await sleep(1100);
  await shot('shell_b_after');
}

/* ── 3. STANDING OFF A POINT THE ENEMY HOLDS ──────────────────────────────*/
const zone = await page.evaluate(() => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), a = m.tank;
  const t = a.tanks.find((x) => x.id === 'RED');
  // hand the spoke's zone to the enemy so the hull has somewhere to be
  const leg = t.legs[1];
  const z = m.allZones.find((q) => q.id === leg.zone);
  if (z) { z.owner = t.team === 0 ? 1 : 0; z.locked = false; }
  // put the hull at that spoke's station and let the fight find it
  t.legIx = 1; t.legDir = 1; t.planN = 0; t.state = 'hold';
  t.s = leg.length; t.targetZone = leg.zone;
  t.yaw = leg.YAW[leg.n - 1];
  a._pose(t);
  return {
    zone: leg.zone, owner: z?.owner,
    off: +Math.hypot(t.position.x - z.position.x, t.position.z - z.position.z).toFixed(1),
    radius: z.radius,
  };
});
console.log('[zone] standing off:', JSON.stringify(zone));
await eyeOnLeg('RED', -17, 3.0, 1.5);
await shot('zone_a_standoff');
await page.evaluate(() => { const e = window.__ENGINE__; const ui = e.ctx.peek('ui'); ui.setHudVisible(true); ui.hudVisible = 1; });
await sleep(300);
await shot('zone_b_hud');
await eyeOnLeg('RED', -11, -3.4, 1.4);
await shot('zone_c_quarter');

console.log(errs.length ? `[pageerror] ${errs.slice(0, 4).join(' | ')}` : '[pageerror] none');
await browser.close();
