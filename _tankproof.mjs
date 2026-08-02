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
console.log('  1a/1b plough');

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
  // side-on: 9 m off the hull's own right flank, eye height
  const camC = await page.evaluate(({ x, z, yaw }) => {
    const e = window.__ENGINE__;
    const ph = e.ctx.peek('physics');
    for (const d of [9, 11, 13, 7]) {
      for (const side of [1, -1]) {
        const cx = x + Math.sin(yaw + side * Math.PI / 2) * d;
        const cz = z + Math.cos(yaw + side * Math.PI / 2) * d;
        const g = ph.groundHeight(cx, cz, 80);
        if (Number.isFinite(g) && Math.abs(g - ph.groundHeight(x, z, 80)) < 3) {
          return { from: [cx, g + 0.1, cz], at: [x, 1.6, z] };
        }
      }
    }
    return { from: [x + 9, 1, z], at: [x, 1.6, z] };
  }, climb);
  await look(camC.from, [camC.at[0], camC.at[1], camC.at[2]]);
  await shot('2-climb');
  console.log('  2 climb');
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
  // camera behind and above the hull, looking past it at the point
  const dx = z.position.x - t.position.x;
  const dz = z.position.z - t.position.z;
  const l = Math.hypot(dx, dz) || 1;
  const cx = t.position.x - (dx / l) * 13 + (dz / l) * 5;
  const cz = t.position.z - (dz / l) * 13 - (dx / l) * 5;
  const g = ph.groundHeight(cx, cz, 80);
  return {
    zone: p.zone, standoff: +l.toFixed(1),
    from: [cx, (Number.isFinite(g) ? g : t.position.y) + 0.1, cz],
    at: [t.position.x, t.position.y + 1.6, t.position.z],
  };
});
console.log(`  3 zone ${zoneShot.zone}, hull standing ${zoneShot.standoff} m off it`);
await look(zoneShot.from, zoneShot.at);
await shot('3-standoff');

console.log(errs.length ? `ERRORS: ${errs.join(' | ')}` : 'no page errors');
await browser.close();
