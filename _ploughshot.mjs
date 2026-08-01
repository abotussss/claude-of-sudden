/**
 * THE TANK, PHOTOGRAPHED — driving, ploughing, and knocked out.
 *
 *   node _ploughshot.mjs [--url=…] [--shots=DIR] [--seed=7]
 *
 * "まだ戦車が登場したの一回も見ていないです" is the complaint this answers, so the
 * important frame is not the portrait — it is the SAME CAMERA on the SAME pile
 * before and after the hull goes through it. A number saying 33 instances were
 * zeroed is not evidence that a wall stopped existing; two photographs are.
 *
 * BLUE is the hull that gets the pictures: `_ploughscan.mjs` measures 9
 * ploughable masses on its corridor and 0 on RED's, which is itself the feature
 * working — RED's street is cathedral piers and building shells all the way.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4291/';
const SEED = args.seed ?? '7';
const SHOTS = args.shots ?? './shots/plough';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 200)); });

await page.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const sleep = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });

/* ---- hold the match open, hide the HUD, stand the air weapons down ------ */
const setup = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ui = e.ctx.peek('ui');
  if (m.phase !== 'live') m._setPhase('live', 0);
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  /**
   * WITHOUT THIS THE CAMERA WALKS OFF. `respawnAt` puts the player where the
   * photograph wants him, and the match's own respawn pass then puts him back
   * at a base spawn between two shots — which is why the first run's "before"
   * and "after" of one pile were two different streets.
   */
  m._updateRespawns = () => {};
  const ai = e.ctx.peek('ai');
  if (ai) ai.combatEnabled = false;
  /**
   * AND THE TANK ITSELF MUST NOT SHOOT THE TRIPOD. `ai.combatEnabled` stops the
   * infantry, but the hull acquires through `armour.enemies`, the hook `match`
   * installs — so it kept putting main gun and coax onto the camera. The red
   * vignette and the desaturated frame in the second run were the photographer
   * being killed, not a rendering fault. An `enemies` that fills nothing is the
   * documented way to say "acquire no one".
   */
  m.tank.enemies = (_team, out) => out;
  for (const a of m.air ?? []) a.enabled = false;
  ui.setHudVisible?.(false);
  ui.hudVisible = 0;
  e.ctx.viewScene.visible = false;
  const t = m.tank.tanks.find((x) => x.id === 'BLUE');
  return {
    seed: e.levelSeed,
    piles: (t.plough ?? []).map((q) => ({ s: +q.s.toFixed(1), x: +q.x.toFixed(1), z: +q.z.toFixed(1), top: +q.top.toFixed(2), inst: q.inst.length })),
  };
});
console.log(`[ploughshot] levelSeed ${setup.seed} — BLUE piles:`, JSON.stringify(setup.piles));

/**
 * A PORTRAIT OF THE HULL, on `_tankshot.mjs`'s own orbit formula rather than my
 * look-at. Mine points the camera at a POINT and it framed the piles correctly,
 * but both tank frames came back as empty street: its yaw convention is 180°
 * off `respawnAt`'s, and a target on the route happened to survive that while a
 * target beside the camera did not. `_tankshot` has produced readable hulls for
 * several rounds; copy it exactly rather than debug a second one.
 */
async function portrait(id, rel, dist, look = 1.7) {
  const r = await page.evaluate(({ id, rel, dist, look }) => {
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
    const dy = t.position.y + look - (y + 1.62);
    const len = Math.hypot(dx, dy, dz);
    player.respawnAt(scratch, Math.atan2(-dx, -dz));
    player.movement.pitch = Math.asin(dy / len);
    return { d: +Math.hypot(dx, dz).toFixed(1), s: +t.s.toFixed(1), state: t.state };
  }, { id, rel, dist, look });
  await sleep(450);
  return r;
}

/** Put the camera at (from) looking at (at). Uses the player capsule, as _tankshot does. */
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

/**
 * Pick the biggest pile that is NOT at the cathedral end of the run. BLUE's
 * last pile has the most instances (52) and is the worst photograph on the
 * route: it sits among the cathedral's piers and plinths, so every camera on
 * the route has 1.9 m of sitework between it and the pile.
 */
const open = setup.piles.filter((q) => q.s <= 45);
const target = (open.length ? open : setup.piles).reduce((a, b) => (b.inst > a.inst ? b : a));
console.log('[ploughshot] photographing pile', JSON.stringify(target));

/* Camera beside the pile, looking back up the route at the oncoming hull. */
const camFor = await page.evaluate(({ px, pz }) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ph = e.ctx.peek('physics');
  const t = m.tank.tanks.find((x) => x.id === 'BLUE');
  // direction the hull travels at this pile
  let best = 0, bd = 1e9;
  for (let i = 0; i < t.path.n; i++) {
    const d = Math.hypot(t.path.X[i] - px, t.path.Z[i] - pz);
    if (d < bd) { bd = d; best = i; }
  }
  /**
   * STAND ON THE ROUTE ITSELF. Two rigs failed before this one and both failed
   * for the same reason: any offset picked in open space is a guess about where
   * the buildings are. At eye height 5 m to the side the camera was inside a
   * parapet and photographed a wall; raised 6 m and swung 9 m out, the offset
   * cleared the kerb and `groundHeight` returned a ROOF, so the tripod stood on
   * a building and photographed the cathedral dome.
   *
   * The tank's own baked path is the one line on this map that is PROVED to be
   * open street for a 3.3 m hull — that is what `_bakePath` measures. So the
   * camera stands on it, 12 m beyond the pile, at eye height like `_tankshot`
   * (elevate it and the player capsule simply falls between two shots), looking
   * back at the pile the hull is about to come through.
   */
  const p = t.path;
  const sPile = p.S[best];
  /**
   * SEVEN METRES SHORT OF IT, not twelve past it. At 12 m the pile is 40 px of
   * a 1280 px frame and "did that heap of sandbags go" is not answerable from
   * the photograph — which is the only thing these photographs are for. Stood
   * just short of it on the route, a 3.6 m pile fills the lower third and the
   * hull comes through the shot from behind the camera. The hull is
   * `LAYER.SHOOT_ONLY`, so it drives straight through the tripod.
   */
  let cam = best;
  for (let i = best; i >= 0; i--) { if (sPile - p.S[i] >= 7) { cam = i; break; } cam = i; }
  const cx = p.X[cam], cz = p.Z[cam];
  const g = ph.groundHeight(cx, cz, 80);
  const gp = ph.groundHeight(px, pz, 80);
  return {
    from: [cx, (Number.isFinite(g) ? g : p.Y[cam]) + 0.1, cz],
    at: [px, (Number.isFinite(gp) ? gp : p.Y[best]) + 0.9, pz],
    d: +(p.S[cam] - sPile).toFixed(1),
  };
}, { px: target.x, pz: target.z });

await look(camFor.from, camFor.at);
await shot('20-pile-before');
console.log('  20-pile-before');

/* ---- roll the sortie ---------------------------------------------------- */
await page.evaluate(() => window.__ENGINE__.ctx.peek('match').tank.fire());
await sleep(1400);

/* driving: three-quarter front on the moving hull */
const drive = await portrait('BLUE', Math.PI * 0.30, 10.5, 1.8);
await shot('21-driving');
console.log('  21-driving', JSON.stringify(drive));

/* ---- wait for THAT pile to go, then photograph it from the fixed camera -- */
await look(camFor.from, camFor.at);
let fired = false;
for (let i = 0; i < 400; i++) {
  const st = await page.evaluate(({ px, pz }) => {
    const m = window.__ENGINE__.ctx.peek('match');
    const t = m.tank.tanks.find((x) => x.id === 'BLUE');
    const q = (t.plough ?? []).find((p) => Math.abs(p.x - px) < 0.2 && Math.abs(p.z - pz) < 0.2);
    return { fired: !!q?.fired, s: +t.s.toFixed(1), state: t.state };
  }, { px: target.x, pz: target.z });
  if (st.fired) { fired = true; break; }
  if (st.state === 'parked' || st.state === 'dead') break;
  await sleep(60);
}
console.log('  pile fired:', fired);
await sleep(160);
await shot('22-ploughing');
console.log('  22-ploughing');
await sleep(2200);
await shot('23-pile-after');
console.log('  23-pile-after');

/* ---- kill it with frags, through the path this change fixed ------------- */
const killed = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const m = ctx.peek('match');
  const t = m.tank.tanks.find((x) => x.id === 'BLUE');
  const V3 = e.camera.position.constructor;
  let n = 0;
  while (t.alive && n < 30) {
    ctx.events.emit('explosion', {
      position: new V3(t.position.x, t.position.y + 1.4, t.position.z),
      radius: 7.5, damage: 0, impulse: 165 * 0.9, source: 'grenade',
    });
    n++;
  }
  return { frags: n, alive: t.alive, x: t.position.x, y: t.position.y, z: t.position.z, yaw: t._yaw };
});
console.log(`  killed with ${killed.frags} frags, alive=${killed.alive}`);
await sleep(400);
const dead = await portrait('BLUE', Math.PI * 0.34, 12, 1.8);
await shot('24-destroyed');
console.log('  24-destroyed', JSON.stringify(dead));
await sleep(2600);
await portrait('BLUE', Math.PI * 0.62, 13.5, 2.0);
await shot('25-burning');
console.log('  25-burning');

console.log('[ploughshot] pageErrors:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
