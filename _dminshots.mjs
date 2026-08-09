/**
 * FOUR PICTURES THE FEATURE IS ONLY TRUE IF THEY SHOW:
 *
 *   20-mine-2m       an armed mine at 2 m — what it is
 *   21-mine-20m      the same mine at 20 m — CAN YOU SEE IT BEFORE YOU ARE ON
 *                    IT? The whole "nothing kills from nowhere" question, and
 *                    the only honest way to answer it is to look
 *   22-mine-ring-40m at 40 m, i.e. past the range a hull can stop in
 *   23-tank-up       a hull going up on one
 *   24-tank-v-tank   two hulls with their guns on each other
 *
 * `player.respawnAt` + `movement.pitch` is the camera pattern `_tankshot.mjs`
 * uses (`teleport` reads a pitch only when `rot` is an object; this is the
 * same solve without the ambiguity).
 *
 *   BASE=http://127.0.0.1:4638/ node _dminshots.mjs [--shots=DIR]
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
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });

/* The plain is a NIGHT map. These are lit to daylight for the two "can you see
 * it" frames so the answer is about the object rather than about the dark; the
 * night answer is in the report and it is worse. */
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
await sleep(900);

/** Camera at `dist` from `p`, on bearing `bear`, looking at `lookY` above it. */
const look = (p, dist, bear, eye = 1.62, lookY = 0.1) =>
  page.evaluate(({ p, dist, bear, eye, lookY }) => {
    const e = window.__ENGINE__;
    const ph = e.ctx.peek('physics');
    const player = e.ctx.peek('player');
    const m = e.ctx.peek('match');
    const x = p.x + Math.sin(bear) * dist;
    const z = p.z + Math.cos(bear) * dist;
    const g = ph.groundHeight(x, z, 80);
    const y = (Number.isFinite(g) ? g : p.y) + 0.05;
    const scratch = m.sites[0].position.clone();
    scratch.set(x, y, z);
    const dx = p.x - x;
    const dz = p.z - z;
    const dy = p.y + lookY - (y + eye);
    const len = Math.hypot(dx, dy, dz);
    player.respawnAt(scratch, Math.atan2(-dx, -dz));
    player.movement.pitch = Math.asin(dy / len);
    return { d: +Math.hypot(dx, dz).toFixed(1) };
  }, { p, dist, bear, eye, lookY });

/* ---- 1-3: a mine on the ground, at 2 m, 20 m and 40 m -------------------- */
const mine = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const w = e.ctx.peek('weapons');
  const ph = e.ctx.peek('physics');
  // On a real lane, so the frame is ground armour actually drives over.
  const ln = m.tank.laneNear(-60, -120, 200, -1);
  const y = ph.groundHeight(ln.x, ln.z, 60);
  w.layMine({ x: ln.x, y: y + 0.2, z: ln.z }, { team: 1, owner: null });
  return { x: ln.x, y, z: ln.z, yaw: ln.yaw };
});
console.log('[shots] mine laid at', JSON.stringify(mine));
// Arming delay is 6 s; the ring lights when it arms.
await sleep(7000);
for (const [name, d, lookY] of [['20-mine-2m', 2.4, 0.05], ['21-mine-20m', 20, 0.05], ['22-mine-40m', 40, 0.05]]) {
  await look(mine, d, mine.yaw + Math.PI * 0.5, 1.62, lookY);
  await sleep(500);
  await shot(name);
  console.log('  ' + name);
}

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
  // 40 m down its own leg, so it arms with a long way to go.
  const leg = t.legs[t.legIx];
  const s = Math.min(leg.length - 1, t.s + 44);
  let i = 0;
  while (i < leg.n - 1 && leg.S[i + 1] < s) i++;
  const p = { x: leg.X[i], y: leg.Y[i], z: leg.Z[i] };
  const y = ph.groundHeight(p.x, p.z, p.y + 4);
  w.layMine({ x: p.x, y: y + 0.2, z: p.z }, { team: t.team === 0 ? 1 : 0, owner: null });
  return { id: t.id, x: p.x, y, z: p.z, yaw: t.yaw };
});
console.log('[shots] mine on', up.id, "'s leg at", JSON.stringify([up.x.toFixed(1), up.z.toFixed(1)]));
// Stand off the lane, square to it, and wait for the hull to reach it.
await look(up, 26, up.yaw + Math.PI * 0.5, 1.62, 1.6);
const hit = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('weapons');
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const t0 = w.mineStats.tripped;
  for (let i = 0; i < 3000; i++) {
    await frame();
    if (w.mineStats.tripped > t0) {
      // 0.25 s of trigger delay, then catch the fireball.
      for (let k = 0; k < 22; k++) await frame();
      return true;
    }
  }
  return false;
});
await shot('23-tank-up');
console.log('  23-tank-up  tripped=' + hit);

/* ---- 5: two hulls with their guns on each other -------------------------- */
const duel = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ph = e.ctx.peek('physics');
  const armour = m.tank;
  armour.fire();
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  /**
   * PUT TWO ENEMY HULLS IN EACH OTHER'S LINE. On the real map the six wheels
   * are 100-200 m apart and converge on the points, so a duel is a thing that
   * HAPPENS rather than a thing a 40-second probe can wait for. Both hulls are
   * driven along their own baked legs to the arc length where they are nearest
   * one another — no teleport, no invented pose: this is a position each hull
   * genuinely reaches on its own route.
   */
  const A = armour.tanks.find((t) => t.team === 0 && t.alive);
  const B = armour.tanks.find((t) => t.team === 1 && t.alive);
  if (!A || !B) return null;
  let best = 1e9, bi = 0, bj = 0, bli = 0, blj = 0;
  for (let li = 0; li < A.legs.length; li++) {
    for (let lj = 0; lj < B.legs.length; lj++) {
      const la = A.legs[li], lb = B.legs[lj];
      for (let i = 0; i < la.n; i += 3) {
        for (let j = 0; j < lb.n; j += 3) {
          const d = Math.hypot(la.X[i] - lb.X[j], la.Z[i] - lb.Z[j]);
          if (d > 34 && d < best) { best = d; bi = i; bj = j; bli = li; blj = lj; }
        }
      }
    }
  }
  A.legIx = bli; A.s = A.legs[bli].S[bi]; A.state = 'hold'; A.hold = 1e6; A.holdT = 0;
  B.legIx = blj; B.s = B.legs[blj].S[bj]; B.state = 'hold'; B.hold = 1e6; B.holdT = 0;
  A.yaw = A.legs[bli].YAW[bi]; B.yaw = B.legs[blj].YAW[bj];
  // Everybody else out of the frame and out of the target list.
  for (const t of armour.tanks) if (t !== A && t !== B) { t.alive = false; t.state = 'parked'; t.root.visible = false; }
  for (let i = 0; i < 200; i++) await frame();
  const mid = { x: (A.position.x + B.position.x) / 2, y: (A.position.y + B.position.y) / 2, z: (A.position.z + B.position.z) / 2 };
  const bear = Math.atan2(A.position.x - B.position.x, A.position.z - B.position.z) + Math.PI / 2;
  return {
    A: A.id, B: B.id, apart: +best.toFixed(1),
    aTarget: A.target?.id ?? A.target?.name ?? null,
    bTarget: B.target?.id ?? B.target?.name ?? null,
    aHealth: Math.round(A.health), bHealth: Math.round(B.health),
    mid, bear, g: ph.groundHeight(mid.x, mid.z, 80),
  };
});
console.log('[shots] duel', JSON.stringify(duel));
if (duel) {
  await look({ x: duel.mid.x, y: duel.mid.y, z: duel.mid.z }, Math.max(28, duel.apart * 0.62), duel.bear, 1.62, 2.0);
  await sleep(700);
  await shot('24-tank-v-tank');
  // …and let the duel run, to say whether it RESOLVES.
  const end = await page.evaluate(async () => {
    const e = window.__ENGINE__;
    const armour = e.ctx.peek('match').tank;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const live = armour.tanks.filter((t) => t.alive);
    const t0 = e.ctx.time.elapsed;
    for (let i = 0; i < 9000; i++) {
      await frame();
      if (live.some((t) => !t.alive)) break;
    }
    return {
      secs: +(e.ctx.time.elapsed - t0).toFixed(1),
      rows: live.map((t) => ({ id: t.id, alive: t.alive, h: Math.round(t.health), shells: t.stats.shells, dmg: Math.round(t.stats.shellDmg), ord: t.lastOrd })),
    };
  });
  console.log('  DUEL RESOLVED in ' + end.secs + 's — ' + JSON.stringify(end.rows));
  await shot('25-tank-v-tank-after');
}

console.log('[shots] pageErrors', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
