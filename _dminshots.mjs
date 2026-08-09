/**
 * FOUR PICTURES THE FEATURE IS ONLY TRUE IF THEY SHOW:
 *
 *   20-mine-2m       an armed mine at 2 m — what it is
 *   21-mine-20m      the same mine at 20 m — CAN YOU SEE IT BEFORE YOU ARE ON
 *                    IT? The whole "nothing kills from nowhere" question, and
 *                    the only honest way to answer it is to look
 *   22-mine-40m      at 40 m, i.e. past the range a hull can stop in
 *   23-tank-up       a hull going up on one
 *   24-tank-v-tank   two hulls with their guns on each other
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY FRAME IS AIMED AND THEN CHECKED, and the first version of this file is
 * why. It solved a camera position, slept, and pressed the shutter — and TWO OF
 * THE FIVE FRAMES DID NOT CONTAIN THEIR SUBJECT. The mine shots were pitched
 * over the top of a 97 mm object, and the duel frame photographed a silo
 * because both hulls had driven away: `_drive` retargets in the `hold` state,
 * so pinning `state = 'hold'` does not pin a tank. A screenshot gate that can
 * photograph the wrong thing and report success is worse than no gate.
 *
 * So `aim()` projects the subject through the real camera and REPORTS its
 * normalised screen position, and every shot below prints it. Off-screen is
 * visible in the log rather than only in the picture.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const BASE = process.env.BASE ?? 'http://127.0.0.1:4638/';
const MAP = process.env.MAP ?? 'plains';
const SHOTS = args.shots ?? './shots/atmine';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message)));
await page.goto(`${BASE}?capture=1&map=${MAP}&seed=7`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('map', await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));
const sleep = (ms) => page.waitForTimeout(ms);
/**
 * ADVANCE THE SIM BY FRAMES, NOT BY WALL SECONDS. `?capture=1` pins the step to
 * a fixed 1/60 PER FRAME and the engine keeps its own rAF loop, so a
 * `waitForTimeout(7200)` buys 7.2 s of game only if the page is holding 60 fps
 * — and NACHTFELD at 1280x720 with eighty bots on it is not. Measured: the
 * first reshoot slept 7.2 s for a 6 s arming delay and photographed an UNARMED
 * mine (`[shots] armed: null`, no marker ring). Frames are the unit the clock
 * is actually in.
 */
const pump = (n) => page.evaluate((n) => new Promise((r) => {
  let i = 0;
  const t = () => (++i >= n ? r(i) : requestAnimationFrame(t));
  requestAnimationFrame(t);
}), n);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });

/* The plain is a NIGHT map. The two "can you see it" frames are lit to daylight
 * so the answer is about the OBJECT rather than about the dark; the night
 * answer is in the report and it is worse. */
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ui = e.ctx.peek('ui');
  if (m.phase !== 'live') m._setPhase('live', 0);
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  m._updateRespawns = () => {};
  for (const a of m.air) a.enabled = false;
  ui.setHudVisible(false);
  ui.hudVisible = 0;
  e.ctx.viewScene.visible = false;
  e.ctx.peek('sky')?.setTimeOfDay?.(10.5);
});
await pump(30);

/**
 * Put the eye `dist` from `p` on bearing `bear`, `eyeUp` metres above the
 * ground there, looking at `p` + `lookY`. Returns where every point in
 * `checks` landed in normalised device coordinates: |x|<1 and |y|<1 is
 * on screen, and `z` in (0,1) is in front of the camera.
 */
const aim = (p, dist, bear, eyeUp = 0.05, lookY = 0.1, checks = []) =>
  page.evaluate(({ p, dist, bear, eyeUp, lookY, checks }) => {
    const e = window.__ENGINE__;
    const ph = e.ctx.peek('physics');
    const player = e.ctx.peek('player');
    const m = e.ctx.peek('match');
    const x = p.x + Math.sin(bear) * dist;
    const z = p.z + Math.cos(bear) * dist;
    const g = ph.groundHeight(x, z, 120);
    const y = (Number.isFinite(g) ? g : p.y) + eyeUp;
    const scratch = m.sites[0].position.clone();
    scratch.set(x, y, z);
    const dx = p.x - x;
    const dz = p.z - z;
    const eyeH = player.eyeHeight ?? 1.62;
    const dy = p.y + lookY - (y + eyeH);
    const len = Math.hypot(dx, dy, dz);
    player.respawnAt(scratch, Math.atan2(-dx, -dz));
    player.movement.pitch = Math.asin(dy / len);
    return { camera: [+x.toFixed(1), +y.toFixed(1), +z.toFixed(1)], d: +Math.hypot(dx, dz).toFixed(1), checks };
  }, { p, dist, bear, eyeUp, lookY, checks });

/** Where `pts` land on screen, read AFTER the frame has been rendered. */
const ndc = (pts) =>
  page.evaluate((pts) => {
    const e = window.__ENGINE__;
    const cam = e.camera;
    cam.updateMatrixWorld(true);
    const v = e.ctx.peek('match').sites[0].position.clone();
    return pts.map((q) => {
      v.set(q.x, q.y, q.z);
      v.project(cam);
      return { on: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z > 0 && v.z < 1, x: +v.x.toFixed(2), y: +v.y.toFixed(2) };
    });
  }, pts);

/* ---- 1-3: a mine on the ground, at 2 m, 20 m and 40 m -------------------- */
const mine = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const w = e.ctx.peek('weapons');
  const ph = e.ctx.peek('physics');
  // On a real lane, so the frame is ground armour actually drives over.
  // The RED-W hub at (-88,-24) — 100 m of open plain, no trench, no works.
  const ln = m.tank.laneNear(-88, -24, 200, -1);
  // Eight metres down the lane from the sample: the nearest point happened to
  // sit under an anti-tank hedgehog, and a photograph of a mine behind a girder
  // answers nothing about whether a mine is visible.
  const x = ln.x + Math.sin(ln.yaw) * 8;
  const z = ln.z + Math.cos(ln.yaw) * 8;
  const y = ph.groundHeight(x, z, 60);
  w.layMine({ x, y: y + 0.2, z }, { team: 1, owner: null });
  return { x, y, z, yaw: ln.yaw };
});
console.log('[shots] mine laid at', JSON.stringify(mine));
await pump(430);                         // 6 s of arming at 1/60 a frame, then the ring lights
const armedAt = await page.evaluate(() => {
  const w = window.__ENGINE__.ctx.peek('weapons');
  const g = w.thrown.field.find((f) => f.live && f.armed);
  return g ? { x: g.pos.x, y: g.pos.y, z: g.pos.z, ring: !!g.ring?.visible, mesh: !!g.mesh?.visible } : null;
});
console.log('[shots] armed:', JSON.stringify(armedAt));

/**
 * THE TWO RANGE FRAMES ARE SHOT FROM A TANK COMMANDER'S EYE, BACK ALONG THE
 * LANE, and both halves of that are the question rather than a preference.
 *
 *   ALONG THE LANE, because "can you see it before you drive onto it" is asked
 *   from the driving line. Square to it, at 20 m, the first attempt put a
 *   CREST between the camera and the mine and photographed a hillside — a true
 *   picture of the plain and no answer at all about the object.
 *   AT 2.4 m, because that is the height of this hull's turret roof
 *   (`_buildColliders`: the turret box tops out at y 2.55, the hull roof at
 *   2.15). A man on foot sees it from 1.66 m and sees less.
 *
 * `los` is `physics.lineOfSight` on `MASK.SIGHT` from the eye to the mine, so
 * the log distinguishes "too small to see" from "behind a rise" — they are
 * different answers and only one of them is about the mine.
 */
for (const [name, d, up] of [['20-mine-2m', 2.4, 1.7], ['21-mine-20m', 20, 2.4], ['22-mine-40m', 40, 2.4]]) {
  const bear = name === '20-mine-2m' ? mine.yaw + Math.PI * 0.5 : mine.yaw + Math.PI;
  const r = await aim(mine, d, bear, up, 0.05);
  await pump(20);
  const [where] = await ndc([{ x: mine.x, y: mine.y + 0.05, z: mine.z }]);
  const los = await page.evaluate((m) => {
    const e = window.__ENGINE__;
    const ph = e.ctx.peek('physics');
    const a = e.camera.position.clone();
    const b = a.clone().set(m.x, m.y + 0.06, m.z);
    return ph.lineOfSight ? ph.lineOfSight(a, b, ph.MASK.SIGHT) : null;
  }, mine);
  await shot(name);
  /**
   * …AND A 240 px CROP CENTRED ON THE MINE'S OWN PIXEL. At 20 m a 345 mm ring
   * subtends about a degree — twelve pixels of a 1280-wide frame — and "is it
   * visible" cannot be answered by looking at a picture in which it is twelve
   * pixels. The crop is where the projection says it is, so it is the object
   * and not a search.
   */
  const px = Math.round((where.x * 0.5 + 0.5) * 1280);
  const py = Math.round((-where.y * 0.5 + 0.5) * 720);
  await page.screenshot({
    path: `${SHOTS}/${name}-crop.png`,
    clip: { x: Math.max(0, px - 120), y: Math.max(0, py - 120), width: 240, height: 240 },
  });
  console.log(`  ${name}  camera ${JSON.stringify(r.camera)} at ${r.d} m — on screen: ${where.on} (${where.x}, ${where.y}) = pixel ${px},${py}, line of sight: ${los}`);
}

/**
 * …AND THE SAME TWO RANGES AT THE MAP'S OWN TIME OF DAY.
 *
 * NACHTFELD is a NIGHT map and the frames above are lit to 10:30 so that "can
 * you see it" is a question about the OBJECT rather than about the dark. But
 * the marker ring is ADDITIVE (`_drawRing`), so daylight is the condition it
 * reads WORST in and night is the condition it is actually played in. Both are
 * photographed rather than argued about.
 */
await page.evaluate(() => window.__ENGINE__.ctx.peek('sky')?.setTimeOfDay?.(1.2));
await pump(60);
for (const [name, d] of [['21-mine-20m-night', 20], ['22-mine-40m-night', 40]]) {
  const r = await aim(mine, d, mine.yaw + Math.PI, 2.4, 0.05);
  await pump(20);
  const [where] = await ndc([{ x: mine.x, y: mine.y + 0.05, z: mine.z }]);
  await shot(name);
  const px = Math.round((where.x * 0.5 + 0.5) * 1280);
  const py = Math.round((-where.y * 0.5 + 0.5) * 720);
  await page.screenshot({
    path: `${SHOTS}/${name}-crop.png`,
    clip: { x: Math.max(0, px - 120), y: Math.max(0, py - 120), width: 240, height: 240 },
  });
  console.log(`  ${name}  at ${r.d} m — pixel ${px},${py}`);
}
await page.evaluate(() => window.__ENGINE__.ctx.peek('sky')?.setTimeOfDay?.(10.5));
await pump(40);

/* ---- 4: a hull goes up on one ------------------------------------------- */
const up = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const w = e.ctx.peek('weapons');
  const ph = e.ctx.peek('physics');
  const armour = m.tank;
  armour.fire();
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  for (let i = 0; i < 30; i++) await frame();
  const t = armour.tanks.find((x) => x.alive && x.state === 'advance');
  const leg = t.legs[t.legIx];
  const s = Math.min(leg.length - 1, t.s + 44);
  let i = 0;
  while (i < leg.n - 1 && leg.S[i + 1] < s) i++;
  const p = { x: leg.X[i], y: leg.Y[i], z: leg.Z[i] };
  const y = ph.groundHeight(p.x, p.z, p.y + 4);
  w.layMine({ x: p.x, y: y + 0.2, z: p.z }, { team: t.team === 0 ? 1 : 0, owner: null });
  return { id: t.id, x: p.x, y, z: p.z, yaw: t.yaw };
});
console.log('[shots] mine on', up.id, 'leg at', JSON.stringify([up.x.toFixed(1), up.z.toFixed(1)]));
await aim(up, 24, up.yaw + Math.PI * 0.5, 1.6, 1.8);
const hit = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('weapons');
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const t0 = w.mineStats.tripped;
  for (let i = 0; i < 3000; i++) {
    await frame();
    if (w.mineStats.tripped > t0) { for (let k = 0; k < 20; k++) await frame(); return true; }
  }
  return false;
});
await shot('23-tank-up');
console.log('  23-tank-up  tripped=' + hit);

/* ---- 5: two hulls with their guns on each other -------------------------- */
/**
 * PINNING A HULL IS NOT `state = 'hold'`. `_drive` runs its `retarget` block in
 * BOTH `advance` and `hold`, so a hull parked for a photograph re-lays a course
 * two seconds later and drives out of frame — which is exactly what the first
 * version of this file photographed. `retarget` is pushed out of reach instead.
 */
const duel = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const armour = m.tank;
  armour.fire();
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const A = armour.tanks.find((t) => t.team === 0 && t.alive);
  const B = armour.tanks.find((t) => t.team === 1 && t.alive);
  if (!A || !B) return null;
  /**
   * THE TWO WHEELS WERE AUTHORED WITHOUT REFERENCE TO ONE ANOTHER, so where
   * they come closest is a fact about the table rather than a pose: every pair
   * of samples on every pair of legs, and the closest one over 30 m (inside
   * that they are on top of each other and there is no frame in it). Neither
   * hull is moved anywhere it does not genuinely drive.
   */
  let best = 1e9, bi = 0, bj = 0, bli = 0, blj = 0;
  for (let li = 0; li < A.legs.length; li++) {
    for (let lj = 0; lj < B.legs.length; lj++) {
      const la = A.legs[li], lb = B.legs[lj];
      for (let i = 0; i < la.n; i += 2) {
        for (let j = 0; j < lb.n; j += 2) {
          const d = Math.hypot(la.X[i] - lb.X[j], la.Z[i] - lb.Z[j]);
          if (d > 30 && d < best) { best = d; bi = i; bj = j; bli = li; blj = lj; }
        }
      }
    }
  }
  const put = (t, li, i) => {
    t.legIx = li; t.s = t.legs[li].S[i]; t.legDir = 1;
    t.state = 'hold'; t.hold = 1e9; t.holdT = 0; t.planN = 0; t.planI = 0;
    t.retarget = 1e9;                       // @see the note above
    t.yaw = t.legs[li].YAW[i];
  };
  put(A, bli, bi);
  put(B, blj, bj);
  for (const t of armour.tanks) if (t !== A && t !== B) { t.alive = false; t.state = 'parked'; t.root.visible = false; }
  for (let i = 0; i < 240; i++) await frame();
  return {
    A: A.id, B: B.id, apart: +best.toFixed(1),
    aTarget: A.target?.id ?? null, bTarget: B.target?.id ?? null,
    aHealth: Math.round(A.health), bHealth: Math.round(B.health),
    ap: { x: A.position.x, y: A.position.y, z: A.position.z },
    bp: { x: B.position.x, y: B.position.y, z: B.position.z },
  };
});
console.log('[shots] duel', JSON.stringify(duel));
if (duel) {
  const mid = { x: (duel.ap.x + duel.bp.x) / 2, y: (duel.ap.y + duel.bp.y) / 2, z: (duel.ap.z + duel.bp.z) / 2 };
  const bear = Math.atan2(duel.ap.x - duel.bp.x, duel.ap.z - duel.bp.z) + Math.PI / 2;
  // Far enough back that a 34 m baseline fits a 75-degree frame, and high
  // enough that neither hull is behind the crest between them.
  let placed = null;
  for (const dist of [duel.apart * 1.0, duel.apart * 1.4, duel.apart * 1.9]) {
    await aim(mid, dist, bear, 6.0, 1.6);
    await pump(20);
    const seen = await ndc([
      { x: duel.ap.x, y: duel.ap.y + 1.4, z: duel.ap.z },
      { x: duel.bp.x, y: duel.bp.y + 1.4, z: duel.bp.z },
    ]);
    console.log(`   trying ${dist.toFixed(0)} m: ${JSON.stringify(seen)}`);
    if (seen[0].on && seen[1].on) { placed = dist; break; }
  }
  await shot('24-tank-v-tank');
  console.log(`  24-tank-v-tank  both hulls framed at ${placed ?? 'NONE — see the log'} m`);

  const end = await page.evaluate(async () => {
    const e = window.__ENGINE__;
    const armour = e.ctx.peek('match').tank;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const live = armour.tanks.filter((t) => t.alive);
    const t0 = e.ctx.time.elapsed;
    for (let i = 0; i < 12000; i++) {
      await frame();
      if (live.some((t) => !t.alive)) break;
    }
    return {
      secs: +(e.ctx.time.elapsed - t0).toFixed(1),
      rows: live.map((t) => ({ id: t.id, alive: t.alive, h: Math.round(t.health), shellsTaken: t.stats.shells, dmgTaken: Math.round(t.stats.shellDmg), ord: t.lastOrd })),
    };
  });
  console.log('  DUEL RESOLVED in ' + end.secs + 's — ' + JSON.stringify(end.rows));
  await shot('25-tank-v-tank-after');
}

console.log('[shots] pageErrors', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
