/**
 * THE TWO THINGS A HEADLESS MATCH CANNOT SHOW ON ITS OWN.
 *
 *   node _civflee.mjs --port=4485
 *
 * The player in `?capture=1` stands still and looks at nothing, so neither of
 * the two rules that depend on HIM ever fires. Both are staged here:
 *
 *   1. 「民間人は見つけられた場合は逃走します」 — put the camera 12 m from an
 *      unarmed civilian, in line of sight, and watch him run. It also asserts
 *      he never once wants to fire while doing it.
 *   2. 「武装していない民間人の場合は占領ポイントを下げて」 — then shoot him, with
 *      the local player as the source, and read the capture score before and
 *      after. And shoot an ARMED one, and read it again: it must not move.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const PORT = Number(args.port ?? 4485);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 6; });

const pump = (n) => page.evaluate((k) => new Promise((done) => {
  let i = 0;
  const t = () => (++i >= k ? done() : requestAnimationFrame(t));
  requestAnimationFrame(t);
}), n);

/** Run until at least one unarmed and one armed civilian are on their feet. */
for (let i = 0; i < 14; i++) {
  const n = await page.evaluate(() => {
    const c = window.__ENGINE__.ctx.peek('match')?.civilians;
    if (!c) return [0, 0];
    let a = 0, u = 0;
    for (const r of c.list) if (r.agent.alive) { if (r.unarmed) u++; else a++; }
    return [a, u];
  });
  if (n[0] > 0 && n[1] > 0) { console.log(`have ${n[0]} armed / ${n[1]} unarmed`); break; }
  await pump(200);
}

/* ── 1. FLEE ───────────────────────────────────────────────────────────── */
const flee = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const m = ctx.peek('match');
  const player = ctx.peek('player');
  const c = m.civilians;
  const rec = c.list.find((r) => r.unarmed && r.agent.alive);
  if (!rec) return { err: 'no unarmed civilian alive' };
  const a = rec.agent;
  const V3 = ctx.camera.position.constructor;
  // 12 m away on a clear bearing, looking straight at him.
  const phys = ctx.peek('physics');
  const ai = ctx.peek('ai');
  let eye = null;
  for (let d = 0; d < 24 && !eye; d++) {
    const th = (d / 24) * Math.PI * 2;
    const px = a.position.x + Math.sin(th) * 12;
    const pz = a.position.z + Math.cos(th) * 12;
    const gy = phys.groundHeight(px, pz);
    if (!Number.isFinite(gy)) continue;
    const p = new V3(px, gy + 1.62, pz);
    const q = new V3(a.position.x, a.position.y + 1.35, a.position.z);
    if (phys.lineOfSight(p, q, phys.MASK.SIGHT)) eye = { p, q };
  }
  if (!eye) return { err: 'no clear sightline to him' };
  ctx.camera.position.copy(eye.p);
  ctx.camera.lookAt(eye.q);
  ctx.camera.updateMatrixWorld(true);
  player.teleport?.(ctx.camera.position, ctx.camera.rotation);

  const start = a.position.clone();
  let firedWanted = 0;
  let hadTarget = 0;
  await new Promise((done) => {
    let i = 0;
    const t = () => {
      if (a.wantFire) firedWanted++;
      if (a.hasTarget) hadTarget++;
      // keep looking at where he was, so he stays "seen" while he sets off
      if (i < 90) {
        ctx.camera.position.copy(eye.p);
        ctx.camera.lookAt(a.position.x, a.position.y + 1.35, a.position.z);
        ctx.camera.updateMatrixWorld(true);
        player.teleport?.(ctx.camera.position, ctx.camera.rotation);
      }
      return ++i >= 260 ? done() : requestAnimationFrame(t);
    };
    requestAnimationFrame(t);
  });
  return {
    moved: +a.position.distanceTo(start).toFixed(1),
    fleeing: rec.fleeing,
    objective: a.objective?.mode ?? null,
    speed: +(a.desiredSpeed ?? 0).toFixed(1),
    firedWanted, hadTarget,
    fled: c.stats.fled,
    pacifist: a.aiPacifist === true,
    protectedFromBots: !ai.targetable(a),
    maxHealth: a.maxHealth,
  };
});
console.log('\nFLEE  ', JSON.stringify(flee));

/* ── 1b. THE OTHER HALF: 「武装している人は攻撃してきます」 ─────────────────── */
const engage = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const ai = ctx.peek('ai');
  const phys = ctx.peek('physics');
  const m = ctx.peek('match');
  const V3 = ctx.camera.position.constructor;
  const rec = m.civilians.list.find((r) => !r.unarmed && r.agent.alive);
  if (!rec) return { err: 'no armed civilian alive' };
  const a = rec.agent;
  /**
   * A soldier of the PLAYER's side, in the SAME ROOM, 4-8 m away. The first cut
   * of this searched a ring on `physics.groundHeight` and found nothing at all
   * — which is itself the indoor rule working: every spot on an 8 m ring around
   * a militiaman is on the other side of his wall. So the candidates come off
   * the nav grid's own `indoor` cells, exactly as `civilians.js` places them.
   */
  const g = ai.grid;
  let spot = null;
  for (const reach of [6, 8, 4.5, 10]) {
    for (let d = 0; d < 48 && !spot; d++) {
      const th = (d / 48) * Math.PI * 2;
      const ci = g.nearest(a.position.x + Math.sin(th) * reach,
        a.position.z + Math.cos(th) * reach, a.position.y, 1, 1.0);
      if (ci < 0) continue;
      const p = new V3(g.worldX(ci % g.nx), g.floor[ci] + 0.02, g.worldZ((ci / g.nx) | 0));
      if (p.distanceTo(a.position) < 3) continue;
      const eye = new V3(p.x, p.y + 1.5, p.z);
      const q = new V3(a.position.x, a.position.y + 1.35, a.position.z);
      if (phys.lineOfSight(eye, q, phys.MASK.SIGHT)) spot = p;
    }
    if (spot) break;
  }
  if (!spot) return { err: 'no clear line to an armed civilian' };
  const bait = ai.spawn('vanguard', spot,
    Math.atan2(a.position.x - spot.x, a.position.z - spot.z),
    { team: ai.playerTeam, name: 'BAIT', role: 'field' });
  let wantFire = 0, hasTarget = 0, aimedAtBait = 0;
  await new Promise((done) => {
    let i = 0;
    const t = () => {
      if (a.wantFire) wantFire++;
      if (a.hasTarget) hasTarget++;
      if (a.targetActor === bait) aimedAtBait++;
      return ++i >= 200 ? done() : requestAnimationFrame(t);
    };
    requestAnimationFrame(t);
  });
  const out = {
    wantFireFrames: wantFire, hasTargetFrames: hasTarget, aimedAtBaitFrames: aimedAtBait,
    baitHealth: bait.health, weapon: a.weaponId, skill: +a.skill.toFixed(2),
    archetype: a.archetype, wantsFightAt: +a.traits.range.toFixed(1),
    hasFlash: a.hasFlash, hasSmoke: a.hasSmoke, hasGrenade: a.hasGrenade,
  };
  bait.applyDamage(999, 'torso', bait.position.clone(), null, null);
  return out;
});
console.log('ENGAGE', JSON.stringify(engage));

/* ── 2. THE PRICE ──────────────────────────────────────────────────────── */
const price = await page.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const m = ctx.peek('match');
  const player = ctx.peek('player');
  const c = m.civilians;
  const out = {};
  const shoot = (rec) => {
    const a = rec.agent;
    const before = m.capture.score[m.playerTeam];
    a.applyDamage(400, 'torso', a.position.clone(), null, player);
    return { before, after: m.capture.score[m.playerTeam], dead: !a.alive };
  };
  const armed = c.list.find((r) => !r.unarmed && r.agent.alive);
  const unarmed = c.list.find((r) => r.unarmed && r.agent.alive);
  // Give the score something to come off, or a floored penalty proves nothing.
  if (m.capture.score[m.playerTeam] < 40) m.capture.score[m.playerTeam] = 40;
  if (armed) out.armed = shoot(armed);
  if (unarmed) out.unarmed = shoot(unarmed);
  out.banner = ctx.peek('ui')?.banner?.text ?? null;
  out.rosterRows = m.roster.length;
  out.killfeed = (ctx.peek('ui')?.killfeed?.items ?? ctx.peek('ui')?.killfeed?.list ?? []).length;
  return out;
});
console.log('PRICE ', JSON.stringify(price));

const hud = await page.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const ai = ctx.peek('ai');
  const blips = ai.getHudActors();
  let civBlips = 0;
  for (const b of blips) if (b.name === 'MILITIA' || b.name === 'CIVILIAN') civBlips++;
  return { blips: blips.length, civBlips };
});
console.log('HUD   ', JSON.stringify(hud));

console.log(errs.length ? `ERRORS: ${errs.slice(0, 4).join(' | ')}` : 'no pageerrors');
await browser.close();
