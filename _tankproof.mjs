/**
 * THE THREE PHOTOGRAPHS THE FIX HAS TO SURVIVE.
 *
 *   1. A hull PLOUGHING something — the same camera on the same pile before and
 *      after the glacis goes through it. A number saying 296 instances were
 *      zeroed is not evidence that a sandbag line stopped existing; two frames
 *      are.
 *   2. A hull CLIMBING something — the nose up on the step, from the side, so
 *      the pitch is visible against the road.
 *   3. A hull STANDING OFF A CONTESTED ZONE — the hull and the capture point it
 *      is shelling in one frame, which is the whole 16 m stand-off guarantee.
 *
 * The camera rig is `_ploughshot.mjs`'s, verbatim and for its own reasons: it
 * stands ON the tank's baked path, which is the one line on this map PROVED to
 * be open street for a 3.3 m hull.
 *
 *   node _tankproof.mjs [--url=…] [--seed=7] [--shots=./shots/tankproof]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4383/';
const SEED = args.seed ?? '7';
const SHOTS = args.shots ?? './shots/tankproof';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message)));
await page.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const sleep = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });

const setup = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ui = e.ctx.peek('ui');
  if (m.phase !== 'live') m._setPhase('live', 0);
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  m._updateRespawns = () => {};
  const ai = e.ctx.peek('ai');
  if (ai) ai.combatEnabled = false;
  m.tank.enemies = (_team, out) => out; // it must not shoot the tripod
  for (const a of m.air ?? []) a.enabled = false;
  ui.setHudVisible?.(false);
  ui.hudVisible = 0;
  e.ctx.viewScene.visible = false;
  const t = m.tank.tanks.find((x) => x.id === 'BLUE');
  return {
    seed: e.levelSeed,
    piles: (t.plough ?? []).map((q, i) => ({ ix: i, leg: q.leg, s: +q.s.toFixed(1), x: +q.x.toFixed(1), z: +q.z.toFixed(1), top: +q.top.toFixed(2), inst: q.inst.length })),
    // The biggest STEP on the approach, which is what the ride climbs.
    steps: (() => {
      const p = t.legs[0];
      const out = [];
      for (let i = 1; i < p.n; i++) if (p.STEP[i] > 0.35 && p.PILE[i] < 0) out.push({ i, s: +p.S[i].toFixed(1), step: +p.STEP[i].toFixed(2) });
      return out.sort((a, b) => b.step - a.step).slice(0, 6);
    })(),
    zones: (m.allZones ?? []).map((z) => ({ id: z.id, owner: z.owner, x: +z.position.x.toFixed(1), z: +z.position.z.toFixed(1) })),
    legs: t.legs.map((p, i) => ({ i, zone: p.zone ?? 'HUB', len: +p.length.toFixed(1) })),
  };
});
console.log(`[tankproof] levelSeed ${setup.seed}`);
console.log('  legs   ', JSON.stringify(setup.legs));
console.log('  steps  ', JSON.stringify(setup.steps));
console.log('  zones  ', JSON.stringify(setup.zones));

/**
 * A PORTRAIT OF THE HULL, on `_tankshot.mjs`'s orbit formula, which is the one
 * rig in this repo that has ever produced a readable tank. `look()` below aims
 * at a POINT and is right for a pile in the road; it is 180 degrees off
 * `respawnAt`'s yaw convention for a target beside the camera, and a first pass
 * of this file photographed two empty streets because of it.
 */
async function portrait(id, rel, dist, lookY = 1.7) {
  const r = await page.evaluate(({ id, rel, dist, lookY }) => {
    const e = window.__ENGINE__;
    const ph = e.ctx.peek('physics');
    const player = e.ctx.peek('player');
    const m = e.ctx.peek('match');
    const t = m.tank.tanks.find((x) => x.id === id);
    const a = t._yaw + rel;
    const x = t.position.x + Math.sin(a) * dist;
    const z = t.position.z + Math.cos(a) * dist;
    const g = ph.groundHeight(x, z, 60);
    const y = (Number.isFinite(g) ? g : t.position.y) + 0.1;
    const scratch = m.sites[0].position.clone();
    scratch.set(x, y, z);
    const dx = t.position.x - x;
    const dz = t.position.z - z;
    const dy = t.position.y + lookY - (y + 1.62);
    const len = Math.hypot(dx, dy, dz);
    player.respawnAt(scratch, Math.atan2(-dx, -dz));
    player.movement.pitch = Math.asin(dy / len);
    return { d: +Math.hypot(dx, dz).toFixed(1), s: +t.s.toFixed(1), state: t.state, pitch: +(t._pitch * 180 / Math.PI).toFixed(1) };
  }, { id, rel, dist, lookY });
  await sleep(450);
  return r;
}

async function look(from, at) {
  await page.evaluate(({ from, at }) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const player = e.ctx.peek('player');
    const scratch = m.sites[0].position.clone();
    scratch.set(from[0], from[1], from[2]);
    const dx = at[0] - from[0];
    const dy = at[1] - (from[1] + 1.62);
    const dz = at[2] - from[2];
    const len = Math.hypot(dx, dy, dz);
    player.respawnAt(scratch, Math.atan2(dx, dz));
    player.movement.pitch = Math.asin(dy / len);
  }, { from, at });
  await sleep(420);
}

/** A camera standing on leg `leg`, `back` metres short of arc `s`, aimed at a point. */
const camOnLeg = (leg, s, back, at) => page.evaluate(({ leg, s, back, at }) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ph = e.ctx.peek('physics');
  const p = m.tank.tanks.find((x) => x.id === 'BLUE').legs[leg];
  let cam = 0;
  for (let i = 0; i < p.n; i++) { if (s - p.S[i] >= back) cam = i; }
  const cx = p.X[cam], cz = p.Z[cam];
  const g = ph.groundHeight(cx, cz, 80);
  const ga = ph.groundHeight(at[0], at[1], 80);
  return {
    from: [cx, (Number.isFinite(g) ? g : p.Y[cam]) + 0.1, cz],
    at: [at[0], (Number.isFinite(ga) ? ga : p.Y[cam]) + (at[2] ?? 0.9), at[1]],
  };
}, { leg, s, back, at });

/* ====================================================================== */
/* 1. PLOUGH — before and after, same camera                              */
/* ====================================================================== */
const onApproach = setup.piles.filter((q) => q.leg === 0 && q.s > 12 && q.s < 55);
const pile = (onApproach.length ? onApproach : setup.piles).reduce((a, b) => (b.inst > a.inst ? b : a));
console.log('[tankproof] ploughing', JSON.stringify(pile));
const camP = await camOnLeg(pile.leg, pile.s, 7, [pile.x, pile.z, 0.9]);
await look(camP.from, camP.at);
await shot('1a-plough-before');

await page.evaluate(() => window.__ENGINE__.ctx.peek('match').tank.fire());
// wait until the glacis has passed that pile
await page.waitForFunction(
  (ix) => window.__ENGINE__.ctx.peek('match').tank.tanks.find((x) => x.id === 'BLUE').plough[ix].fired,
  pile.ix, { timeout: 120000 }
);
await sleep(900);
await look(camP.from, camP.at);
await shot('1b-plough-after');
// …and again once the pieces have finished falling, because "it must not float"
// is a statement about the SETTLED pose and not about the frame it goes off.
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  for (const t of m.tank.tanks) for (const q of t.plough) if (q.fired && q.uniforms) q.uniforms.uT.value = 20;
});
await sleep(300);
await shot('1c-plough-settled');
console.log('  1a/1b/1c plough');

/**
 * FROM HERE THE HULL IS PLACED BY HAND, SO IT MUST STOP DRIVING. The first run
 * of this file photographed two empty streets: `_drive` runs every frame, the
 * `hold` branch asks `_wantZone` twice a second, every point was neutral, and
 * the hull laid in a course and left while `look()` was still settling the
 * camera. Stubbing `_drive` leaves `_pose` and `_fight` alone, so the hull is
 * still a live, posed, shootable tank — it just stays where it is put.
 */
await page.evaluate(() => { window.__ENGINE__.ctx.peek('match').tank._drive = () => {}; });

/* ====================================================================== */
/* 2. CLIMB — the nose up on a step, from the side                        */
/* ====================================================================== */
const step = setup.steps[0];
if (step) {
  const climb = await page.evaluate(async ({ s }) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const t = m.tank.tanks.find((x) => x.id === 'BLUE');
    // Put the hull on the step and freeze it there.
    t.legIx = 0; t.legDir = 1; t.state = 'advance'; t.planN = 0;
    t.s = s; t.yaw = t.legs[0].YAW[0];
    m.tank._pose(t);
    // walk it up in small steps so the two supports settle
    let best = null;
    for (let k = -3; k <= 3; k += 0.25) {
      t.s = s + k;
      m.tank._pose(t);
      const pitch = t._pitch;
      if (!best || pitch > best.pitch) best = { s: t.s, pitch, y: t.position.y, x: t.position.x, z: t.position.z, yaw: t.yaw };
    }
    t.s = best.s;
    m.tank._pose(t);
    t.state = 'hold';
    return { s: +best.s.toFixed(2), pitchDeg: +(best.pitch * 180 / Math.PI).toFixed(1), y: +best.y.toFixed(2), x: best.x, z: best.z, yaw: best.yaw };
  }, { s: step.s });
  console.log('  climb at s=' + climb.s + ' pitch ' + climb.pitchDeg + ' deg, hull y ' + climb.y);
  // Side-on, so the nose-up against the road is the whole photograph.
  const c1 = await portrait('BLUE', Math.PI * 0.5, 9.5, 1.5);
  await shot('2-climb');
  const c2 = await portrait('BLUE', Math.PI * 0.34, 10.5, 1.6);
  await shot('2b-climb-quarter');
  console.log('  2 climb', JSON.stringify(c1), JSON.stringify(c2));
}

/* ====================================================================== */
/* 3. STANDING OFF A CONTESTED ZONE                                       */
/* ====================================================================== */
const zoneShot = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ph = e.ctx.peek('physics');
  const t = m.tank.tanks.find((x) => x.id === 'BLUE');
  // Put it at the end of a spoke — the stand-off — and make that point contested.
  const li = t.legs.findIndex((p, i) => i > 0 && p.zone);
  const p = t.legs[li];
  t.legIx = li; t.legDir = 1; t.s = p.length; t.state = 'hold'; t.planN = 0;
  t.yaw = p.YAW[p.n - 1];
  t.targetZone = p.zone;
  m.tank._pose(t);
  const z = (m.allZones ?? []).find((q) => q.id === p.zone);
  if (z) z.owner = t.team === 0 ? 1 : 0; // the enemy holds it: it is the fight
  void ph;
  const l = Math.hypot(z.position.x - t.position.x, z.position.z - t.position.z);
  return { zone: p.zone, standoff: +l.toFixed(1) };
});
console.log(`  3 zone ${zoneShot.zone}, hull standing ${zoneShot.standoff} m off it`);
// Astern of the hull, looking past it up the street at the point it is shelling.
const s3 = await portrait('BLUE', Math.PI, 13, 2.0);
await shot('3-standoff');
const s4 = await portrait('BLUE', Math.PI * 0.78, 12, 1.9);
await shot('3b-standoff-quarter');
console.log('  3', JSON.stringify(s3), JSON.stringify(s4));

console.log(errs.length ? `ERRORS: ${errs.join(' | ')}` : 'no page errors');
await browser.close();
