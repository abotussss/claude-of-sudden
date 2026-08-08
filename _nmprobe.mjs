/**
 * WHAT THE TWO INCOMING-FIRE FEEDS ACTUALLY CARRY, measured in a live firefight.
 *
 *   node _nmprobe.mjs [--url=…] [--secs=90] [--scale=1]
 *
 * Feed A  `player.onNearMiss(miss)` — called by `src/ai/index.js:2698` and
 *         `src/match/tank.js:5624` with the CLOSEST APPROACH of an enemy round
 *         to the player's chest, only when 0.42 < miss < 1.6 m.
 * Feed B  `bullet:impact` → `Player._onBulletImpact` — gated on where the round
 *         STOPPED being within 3.2 m of the eye, and on that point not being in
 *         the forward cone (dot > 0.55 is assumed to be our own round).
 *
 * The probe replicates feed B's gates instead of trusting them, and separately
 * reconstructs each impact's true trajectory closest approach from `incident`,
 * so "the round passed near me" and "the round stopped near me" are counted as
 * the two different samples they are.
 *
 * The player is walked to the closest cross-team contact every second and kept
 * alive, because a probe standing at spawn on the plain takes nothing at all.
 * Nothing here decides anything: it only reports.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4622/?map=plains';
const SECS = Number(args.secs ?? 90);
const SCALE = Number(args.scale ?? 1);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message)));

console.log(`[nm] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('[nm] level.id =', await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));
await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await page.waitForFunction(
  () => window.__ENGINE__.ctx.peek('match')?.phase === 'live',
  null,
  { timeout: 240000 }
);
console.log('[nm] phase = live');

await page.evaluate((scale) => {
  const e = window.__ENGINE__;
  e.ctx.time.scale = scale;
  const ctx = e.ctx;
  const player = ctx.peek('player');
  const ai = ctx.peek('ai');
  const R = 3.2; // HEALTH.suppression.radius

  const S = {
    t0: ctx.time.elapsed,
    t1: ctx.time.elapsed,
    // feed A
    nm: 0, nmMiss: [], nmDefined: typeof player.onNearMiss === 'function',
    // feed B, gate by gate
    imp: 0, impNear: 0, impPass: 0, impSupp: 0,
    // the same impacts, judged by TRAJECTORY instead of stopping point
    trajPast: 0,      // came past us at all, within 40 m backtrack
    traj16: 0,        // passed within 1.6 m of the eye
    traj32: 0,        // passed within 3.2 m of the eye
    traj16FarStop: 0, // passed within 1.6 m but STOPPED further than 3.2 m away
    traj16Fwd: 0,     // passed within 1.6 m but the stopping point is forward-gated out
    // felt state
    supMax: 0, supSum: 0, supN: 0, supAbove: 0,
    hits: 0, damage: 0, deaths: 0,
    frames: 0,
    dist: 0, // distance from the player to the nearest live enemy, sampled
    distN: 0,
  };
  window.__S__ = S;

  // ---- feed A: wrap if defined, install a counter if not -------------------
  const prev = typeof player.onNearMiss === 'function' ? player.onNearMiss.bind(player) : null;
  player.onNearMiss = (m) => {
    S.nm++;
    if (S.nmMiss.length < 4000) S.nmMiss.push(+m.toFixed(3));
    if (prev) prev(m);
  };

  // ---- the POPULATION feed A is drawn from --------------------------------
  /**
   * `AiSystem._testPlayerHit` runs the closest-approach solve for every round
   * an ENEMY bot fires (`RULES.friendlyFire` is false, so team-mates' rounds
   * return before the solve). Wrapping it is the only way to see the misses
   * that fall OUTSIDE the 1.6 m gate — the rounds feed A throws away.
   */
  S.tph = 0; S.tphSolved = 0;
  S.hist = { hit: 0, b16: 0, b30: 0, b50: 0, b100: 0, far: 0 };
  const tph = ai._testPlayerHit.bind(ai);
  ai._testPlayerHit = (agent, origin, dir, end) => {
    S.tph++;
    const p = ai.playerPosition(new (origin.constructor)());
    const maxT = end ? origin.distanceTo(end) : 200;
    const px = p.x - origin.x, py = p.y - origin.y, pz = p.z - origin.z;
    const t = px * dir.x + py * dir.y + pz * dir.z;
    if (t >= 0.5 && t <= maxT && ai.teamOf(agent) !== ai.teamOf(player)) {
      S.tphSolved++;
      const miss = Math.hypot(px - dir.x * t, py - dir.y * t, pz - dir.z * t);
      if (miss <= 0.42) S.hist.hit++;
      else if (miss < 1.6) S.hist.b16++;
      else if (miss < 3.0) S.hist.b30++;
      else if (miss < 5.0) S.hist.b50++;
      else if (miss < 10.0) S.hist.b100++;
      else S.hist.far++;
    }
    return tph(agent, origin, dir, end);
  };

  // ---- feed B: replicate the gates rather than trust them ------------------
  ctx.events.on('bullet:impact', (ev) => {
    if (!ev?.point) return;
    S.imp++;
    const eye = ctx.camera.position;
    const dx = ev.point.x - eye.x, dy = ev.point.y - eye.y, dz = ev.point.z - eye.z;
    const d = Math.hypot(dx, dy, dz) || 1e-4;
    const f = player.rig.forward;
    const fwd = (dx * f.x + dy * f.y + dz * f.z) / d;
    const nearStop = d <= R;
    if (nearStop) {
      S.impNear++;
      if (fwd <= 0.55) { S.impPass++; S.impSupp += 0.28 * (1 - d / R); }
    }
    const inc = ev.incident;
    if (inc && (inc.x || inc.y || inc.z)) {
      const s = dx * inc.x + dy * inc.y + dz * inc.z;
      if (s > 0 && s < 40) {
        S.trajPast++;
        const cx = dx - inc.x * s, cy = dy - inc.y * s, cz = dz - inc.z * s;
        const miss = Math.hypot(cx, cy, cz);
        if (miss < 3.2) S.traj32++;
        if (miss < 1.6) {
          S.traj16++;
          if (!nearStop) S.traj16FarStop++;
          else if (fwd > 0.55) S.traj16Fwd++;
        }
      }
    }
  });

  ctx.events.on('damage:dealt', (ev) => {
    const t = ev?.target;
    if (t !== player && t !== 'player' && t?.isPlayer !== true) return;
    S.hits++; S.damage += ev.amount ?? 0;
  });

  // ---- keep him in the fight, and alive -----------------------------------
  const phys = ctx.peek('physics');
  const match = ctx.peek('match');
  const myTeam = match?.playerTeam ?? 0;

  window.__WALK__ = () => {
    // the closest live cross-team pair = where the shooting actually is
    let best = null, bd = Infinity;
    const friends = ai.agents.filter((a) => a.alive && a.team === myTeam);
    const foes = ai.agents.filter((a) => a.alive && a.team !== myTeam);
    for (const fr of friends) {
      for (const fo of foes) {
        const d = fr.position.distanceTo(fo.position);
        if (d < bd) { bd = d; best = { fr, fo }; }
      }
    }
    if (!best) return null;
    // Stand ON the friendly's shoulder, facing the enemy: that is the line the
    // enemy's rounds are already flying down.
    const fr = best.fr.position, fo = best.fo.position;
    const ux = fo.x - fr.x, uz = fo.z - fr.z;
    const ul = Math.hypot(ux, uz) || 1;
    const x = fr.x + (ux / ul) * 1.6;
    const z = fr.z + (uz / ul) * 1.6;
    const gy = phys.groundHeight(x, z, fr.y + 8);
    const feetY = Number.isFinite(gy) ? gy + 0.03 : fr.y;
    player.health.reset(true);
    player.setControlEnabled(true);
    player.movement.yaw = Math.atan2(-ux, -uz);
    player.movement.pitch = 0;
    player.movement.velocity.set(0, 0, 0);
    player.movement.teleport(x, feetY, z);
    return { pairDist: +bd.toFixed(1), x: +x.toFixed(0), z: +z.toFixed(0) };
  };

  // ---- felt state, sampled every frame ------------------------------------
  const tick = () => {
    S.frames++;
    const s = player.health.suppression;
    S.supSum += s; S.supN++;
    if (s > S.supMax) S.supMax = s;
    if (s > 0.05) S.supAbove++;
    if (player.health.dead) { S.deaths++; player.health.reset(true); }
    else if (player.health.value < 90) player.health.value = 100; // keep the sample running
    // nearest live enemy
    let nd = Infinity;
    for (const a of ai.agents) {
      if (!a.alive || a.team === myTeam) continue;
      const d = a.position.distanceTo(player.position);
      if (d < nd) nd = d;
    }
    if (Number.isFinite(nd)) { S.dist += nd; S.distN++; }
    S.t1 = ctx.time.elapsed;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, SCALE);

const first = await page.evaluate(() => window.__WALK__());
console.log('[nm] walked to contact:', JSON.stringify(first));

const ticks = Math.max(1, Math.round(SECS / 2));
for (let i = 0; i < ticks; i++) {
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__WALK__());
}

const S = await page.evaluate(() => {
  const s = window.__S__;
  const m = s.nmMiss;
  const band = (lo, hi) => m.filter((v) => v >= lo && v < hi).length;
  return {
    ...s,
    nmMiss: undefined,
    dur: +(s.t1 - s.t0).toFixed(1),
    nmMin: m.length ? Math.min(...m) : null,
    nmMax: m.length ? Math.max(...m) : null,
    nmMean: m.length ? +(m.reduce((a, b) => a + b, 0) / m.length).toFixed(3) : null,
    bands: [band(0.42, 0.7), band(0.7, 1.0), band(1.0, 1.3), band(1.3, 1.6)],
    meanDist: s.distN ? +(s.dist / s.distN).toFixed(1) : null,
    // END TO END: this counter lives INSIDE PlayerSystem.onNearMiss, so a
    // non-zero value is proof the call site reached the real method and spent
    // the flinch — not just that the probe's wrapper ran.
    statsNearMisses: window.__ENGINE__.ctx.peek('player').stats.nearMisses,
  };
});

const per = (n) => (n / S.dur).toFixed(2);
console.log(`\n[nm] ${S.dur}s of game time, ${S.frames} frames, mean nearest enemy ${S.meanDist} m`);
console.log(`\n  FEED A  player.onNearMiss   defined before probe: ${S.nmDefined}`);
console.log(`     ${S.nm} calls  (${per(S.nm)}/s)  miss ${S.nmMin}…${S.nmMax} m, mean ${S.nmMean}`);
console.log(`     PlayerSystem.onNearMiss ran ${S.statsNearMisses} time(s) — the counter inside the method itself`);
console.log(`     bands  0.42-0.7: ${S.bands[0]}   0.7-1.0: ${S.bands[1]}   1.0-1.3: ${S.bands[2]}   1.3-1.6: ${S.bands[3]}`);
console.log(`     population it is drawn from: ${S.tph} rounds ran the solve, ${S.tphSolved} were enemy rounds that came past`);
console.log(`     enemy-round closest approach to the chest:  <=0.42 (a hit): ${S.hist.hit}   0.42-1.6: ${S.hist.b16}   ` +
  `1.6-3: ${S.hist.b30}   3-5: ${S.hist.b50}   5-10: ${S.hist.b100}   >10: ${S.hist.far}`);
console.log(`\n  FEED B  bullet:impact -> _onBulletImpact`);
console.log(`     ${S.imp} impacts on the bus (${per(S.imp)}/s)`);
console.log(`     ${S.impNear} stopped within 3.2 m of the eye (${per(S.impNear)}/s)`);
console.log(`     ${S.impPass} survived the forward-cone gate -> suppression (${per(S.impPass)}/s), total +${S.impSupp.toFixed(2)}`);
console.log(`\n  THE SAME IMPACTS, JUDGED BY TRAJECTORY`);
console.log(`     ${S.trajPast} came past us at all`);
console.log(`     ${S.traj32} passed within 3.2 m,  ${S.traj16} within 1.6 m (${per(S.traj16)}/s)`);
console.log(`     of those inside 1.6 m: ${S.traj16FarStop} stopped further than 3.2 m away (feed B never sees them)`);
console.log(`                            ${S.traj16Fwd} stopped near but forward-gated out`);
console.log(`\n  FELT`);
console.log(`     suppression max ${S.supMax.toFixed(3)}  mean ${(S.supSum / Math.max(1, S.supN)).toFixed(4)}  ` +
  `above 0.05 for ${((S.supAbove / Math.max(1, S.supN)) * 100).toFixed(1)}% of frames`);
console.log(`     ${S.hits} rounds wounded him for ${S.damage.toFixed(0)}, ${S.deaths} death(s) (healed through)`);
console.log(`\n[nm] pageerrors: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log('   ' + e);
await browser.close();
