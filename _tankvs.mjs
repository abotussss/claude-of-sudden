/**
 * PICTURES OF THE THING THE NUMBERS CLAIM — infantry fighting armour.
 *
 * Two shots, both out of a REAL match with the real rules running:
 *
 *   20-engaging   a bot whose `targetActor` IS the hull and whose trigger is
 *                 down, framed over his shoulder with the tank in front of him.
 *   21-brewing-up the frame a hull is destroyed, with the man who landed the
 *                 last round named in the log. The camera does not move to it
 *                 until the health is already low, so nothing about the fight
 *                 is arranged.
 *
 * The camera is the player capsule (there is no free camera in this build), so
 * it is given permanent spawn protection first — `ai.targetable` is false for
 * him, nobody chooses to shoot at him, and the fight goes on without him.
 *
 *   node _tankvs.mjs [url] [seed]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://127.0.0.1:4335/';
const SEED = process.argv[3] ?? '12';
/**
 * `engage` moves the camera the moment a bot targets a hull, which perturbs the
 * match — the camera IS the player capsule. `kill` leaves the camera where it
 * spawned and touches nothing until the hull dies, so the fight that produced
 * the wreck is the same fight `_tankfight.mjs` measures.
 */
const MODE = process.argv[4] ?? 'engage';
const SHOTS = './shots/tankvs';
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
const sleep = (ms) => page.waitForTimeout(ms);

await page.evaluate((MODE) => {
  window.__MODE__ = MODE;
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const m = ctx.peek('match');
  const ai = ctx.peek('ai');
  const player = ctx.peek('player');
  e.input.frozen = true;
  e.input.enabled = false;
  player?.setControlEnabled?.(false);
  ctx.peek('ui')?.setHudVisible?.(false);
  ctx.viewScene.visible = false;
  // The camera is not a combatant. Renewed every frame below.
  /**
   * IN `kill` MODE THE CAMERA IS NOT PROTECTED EITHER, and that turned out to
   * matter: `ai.protect` takes the player out of `hostilesOf`, which is forty
   * men's target list, and seed 7 went from "RED destroyed by LANTERN, twelve
   * frags" to "RED flattened by the final salvo" purely because of it. A
   * picture of a fight has to be a picture of the fight that was measured, so
   * `kill` mode leaves the sim exactly as `_tankfight.mjs` runs it and only
   * moves the camera once the wreck exists.
   */
  window.__PROT__ = MODE === 'kill' ? () => {} : () => ai.protect(player, 30);
  window.__PROT__();
  e.time.scale = window.__MODE__ === 'kill' ? 8 : 6;
  /**
   * THE DEATH FRAME IS ONE FRAME. Polling for it from node at 6x game speed
   * misses it — seed 7's RED went from over 700 hp to a wreck between two
   * samples. So the engine tells us, and stops the clock where it happened.
   */
  window.__DEAD__ = null;
  for (const t of m.tank.tanks) t.health0 = t.health;
  ctx.events.on('match:tank', (ev) => {
    if (ev.phase !== 'dead' || window.__DEAD__) return;
    const t = m.tank.tanks.find((x) => x.id === ev.id);
    /**
     * ONLY A HULL THE INFANTRY ACTUALLY KILLED. A tank flattened by the final
     * cathedral salvo is the failure this whole change is about — it is what
     * killed the only two hulls that ever died before it, and the kill credit
     * went to a man who had landed one stray round. So `kill` mode waits for a
     * wreck whose damage is MOSTLY grenades and rifle rounds; anything else is
     * logged and skipped, and the probe goes on watching the other hull.
     */
    const men = t.stats.fragDmg + t.stats.roundDmg;
    if (window.__MODE__ === 'kill' && men < 0.6 * t.health0) {
      (window.__SKIPPED__ ??= []).push(
        `${ev.id}: men ${Math.round(men)} of ${Math.round(men + t.stats.blastDmg - t.stats.fragDmg)} — environment`
      );
      return;
    }
    window.__DEAD__ = {
      id: ev.id, x: t.position.x, y: t.position.y, z: t.position.z,
      by: t.lastHitBy?.name ?? null,
      byAgent: !!(t.lastHitBy && t.lastHitBy.isTank !== true && t.lastHitBy.isPlayer !== true),
      rounds: t.stats.rounds, deck: t.stats.nDeck, hull: t.stats.nHull,
      frags: t.stats.frags, fragDmg: Math.round(t.stats.fragDmg),
      blasts: t.stats.blasts, blastDmg: Math.round(t.stats.blastDmg),
      kills: t.stats.kills, live: Math.round(t.stats.liveT),
    };
    e.time.scale = 0.06;
  });
}, MODE);

/**
 * FIND A CAMERA THAT CAN ACTUALLY SEE IT. A fixed offset in a town puts the
 * lens inside a shop: twelve bearings at three ranges, first one with a clear
 * line to the subject wins, and the widest one is the fallback.
 */
const findView = (at, lift, dists) =>
  page.evaluate(
    ({ at, lift, dists }) => {
      const e = window.__ENGINE__;
      const ph = e.ctx.peek('physics');
      const V3 = e.camera.position.constructor;
      const to = new V3(at.x, at.y, at.z);
      let fallback = null;
      for (const d of dists) {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const x = at.x + Math.sin(a) * d;
          const z = at.z + Math.cos(a) * d;
          // `groundHeight`'s third argument is where the probe STARTS, not how
          // far it reaches: 60 finds the ROOF of every building it is fired
          // over, which is why the first cut of this stood the camera on a
          // parapet and then failed every line-of-sight test from up there.
          const g = ph.groundHeight(x, z, at.y + 6);
          if (!Number.isFinite(g)) continue;
          const from = new V3(x, g + 1.62 + lift, z);
          if (!fallback) fallback = { x, y: g, z, d };
          if (ph.lineOfSight(from, to, ph.MASK.SIGHT)) return { x, y: g, z, d };
        }
      }
      return fallback;
    },
    { at, lift, dists }
  );

/**
 * Put the camera at a world point looking at another. `lift` raises it off the
 * ground the physics snapped it to — a wreck reads better from above the smoke.
 */
const look = (from, at, lift = 0) =>
  page.evaluate(
    ({ from, at, lift }) => {
      const e = window.__ENGINE__;
      const player = e.ctx.peek('player');
      const ph = e.ctx.peek('physics');
      const g = ph.groundHeight(from.x, from.z, at.y + 6);
      const y = (Number.isFinite(g) ? g : from.y) + lift;
      const p = e.camera.position.clone().set(from.x, y, from.z);
      const dx = at.x - from.x;
      const dz = at.z - from.z;
      // `player`'s yaw convention is the NEGATIVE of `ai`'s (`_tankshot.mjs`
      // has used this form since the hull portraits): forward is (-sin, -cos).
      player.respawnAt(p, Math.atan2(-dx, -dz));
      if (lift > 0) player.movement.teleport(from.x, y, from.z);
      const eye = player.position.y + 1.62;
      const dy = at.y - eye;
      player.movement.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
      window.__PROT__();
      return { x: +p.x.toFixed(1), y: +player.position.y.toFixed(1), z: +p.z.toFixed(1) };
    },
    { from, at, lift }
  );

/* ---- 1. a bot engaging ------------------------------------------------- */
let engaging = null;
for (let i = 0; i < (MODE === 'engage' ? 4000 : 0) && !engaging; i++) {
  engaging = await page.evaluate(() => {
    const e = window.__ENGINE__;
    const ai = e.ctx.peek('ai');
    const m = e.ctx.peek('match');
    window.__PROT__();
    for (const t of m.tank.tanks) {
      if (!t.alive) continue;
      for (const g of ai.agents) {
        if (!g.alive || g.targetActor !== t) continue;
        // A man with his trigger down on a hull is the picture; a man cleared
        // only to throw is the fallback once the budget is half gone.
        if (!g.wantFire && !(window.__LATE__ && g.armourWorth === 2)) continue;
        return {
          bot: g.name, worth: g.armourWorth, fire: !!g.wantFire,
          frag: !!g.hasGrenade, yaw: g.yaw,
          d: +Math.hypot(g.position.x - t.position.x, g.position.z - t.position.z).toFixed(1),
          bx: g.position.x, by: g.position.y, bz: g.position.z,
          tank: t.id, tx: t.position.x, ty: t.position.y, tz: t.position.z,
        };
      }
    }
    return null;
  });
  if (!engaging) await sleep(60);
  if (i === 2000) await page.evaluate(() => { window.__LATE__ = true; });
}
if (engaging) {
  console.log('[tankvs] engaging:', JSON.stringify(engaging));
  // Hold the frame still while the camera is placed, so what is photographed is
  // the sample that was measured.
  await page.evaluate(() => { window.__ENGINE__.time.scale = 0.06; });
  /**
   * OVER HIS SHOULDER, which needs no search: `ai`'s yaw convention is
   * forward = (sin, cos), so stepping back along it and up a metre puts the man
   * in the near frame and whatever he is shooting at down the middle of it.
   */
  const fx = Math.sin(engaging.yaw);
  const fz = Math.cos(engaging.yaw);
  const aimHull = { x: engaging.tx, y: engaging.ty + 1.9, z: engaging.tz };
  await look(
    { x: engaging.bx - fx * 4.2, y: engaging.by, z: engaging.bz - fz * 4.2 },
    aimHull, 0.9
  );
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}/20-over-the-shoulder.png` });

  // …and the hull he is looking at, from a camera that can see it.
  const v = await findView(aimHull, 0, [11, 15, 20]);
  if (v) {
    const at = await look({ x: v.x, y: v.y, z: v.z }, aimHull, 0);
    console.log(`   20b-the-hull camera ${JSON.stringify(at)} at ${v.d.toFixed(1)} m`);
    await sleep(600);
    await page.screenshot({ path: `${SHOTS}/20b-the-hull.png` });
  }
  // …and the man, from in front of the hull's own gun.
  const aimMan = { x: engaging.bx, y: engaging.by + 1.2, z: engaging.bz };
  const w = await findView(aimMan, 0, [6, 9, 13]);
  if (w) {
    const at = await look({ x: w.x, y: w.y, z: w.z }, aimMan, 0);
    console.log(`   20c-the-man camera ${JSON.stringify(at)} at ${w.d.toFixed(1)} m`);
    await sleep(600);
    await page.screenshot({ path: `${SHOTS}/20c-the-man.png` });
  }
  await page.evaluate(() => { window.__ENGINE__.time.scale = 6; });
} else {
  console.log('[tankvs] no bot ever engaged a hull');
}

/* ---- 2. a hull brewing up ---------------------------------------------- */
let dead = null;
for (let i = 0; i < 6000 && !dead; i++) {
  const st = await page.evaluate(() => {
    window.__PROT__();
    return { dead: window.__DEAD__, skipped: window.__SKIPPED__ ?? [],
      phase: window.__ENGINE__.ctx.peek('match').phase };
  });
  dead = st.dead;
  if (!dead && st.phase === 'over') { console.log('[tankvs] skipped:', st.skipped); break; }
  if (!dead) await sleep(60);
}
if (dead) {
  console.log('[tankvs] destroyed:', JSON.stringify(dead));
  // The clock is already down to 0.06x, stopped by the listener on the death
  // frame, so the fireball is still going up while the camera walks round it.
  const aim = { x: dead.x, y: dead.y + 1.8, z: dead.z };
  const views = [
    ['21-brewing-up', 0, [13, 17, 22]],
    ['22-brewing-up-low', 0, [9, 12, 16]],
    ['23-wreck', 3.5, [14, 19, 25]],
  ];
  for (const [name, lift, dists] of views) {
    const v = await findView(aim, lift, dists);
    if (!v) { console.log(`   ${name} — no clear camera`); continue; }
    const at = await look({ x: v.x, y: v.y, z: v.z }, aim, lift);
    console.log(`   ${name} camera ${JSON.stringify(at)} at ${v.d} m`);
    await sleep(500);
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  }
} else {
  console.log('[tankvs] no hull was destroyed in this match');
}
console.log('[tankvs] pageerrors', errs.length ? errs : 'none');
await b.close();
