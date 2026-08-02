/**
 * REPRODUCE WHAT THE PLAYER SEES — 「戦車が障害物を乗り越えないし破壊していない
 * スタックしてる」, his THIRD report, so the aggregates are not to be trusted.
 *
 * A real match, the armour armed by its own cathedral beat (nothing fired by
 * hand), fast-forwarded only until the hulls ROLL and then watched at 1x with a
 * chase camera on one hull: a screenshot every ~2.5 game seconds and a
 * kinematics sample every 0.5, so a stall is a visible run of frames AND a
 * window in the log with a position on it to feed `_whatbox.mjs`.
 *
 * Usage: node _stallwatch.mjs [url] [seed] [follow=RED|BLUE] [watchSecs]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://127.0.0.1:4423/';
const SEED = process.argv[3] ?? '7';
const FOLLOW = process.argv[4] ?? 'RED';
const WATCH = Number(process.argv[5] ?? 150);
const SHOTS = `./shots/stall/${SEED}-${FOLLOW}`;
mkdirSync(SHOTS, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 1024, height: 640 } });
const errs = [];
const tanklog = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[tank]')) tanklog.push(t.slice(0, 300));
});
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

/* fast-forward the match until the armour rolls (its own beat sheet) */
const rolled = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  const player = e.ctx.peek('player');
  e.input.frozen = true;
  e.input.enabled = false;
  player?.setControlEnabled?.(false);
  ai?.protect?.(player, 1e9);
  e.ctx.peek('ui')?.setHudVisible?.(false);
  e.ctx.viewScene.visible = false;
  e.time.scale = 10;
  const t0 = performance.now();
  const phases = [];
  let lastPhase = '';
  while (performance.now() - t0 < 600000) {
    await new Promise((r) => requestAnimationFrame(r));
    const a = m.tank;
    if (a && a.tanks.some((t) => t.state !== 'parked')) break;
    if (m.phase !== lastPhase) {
      lastPhase = m.phase;
      phases.push(`${m.phase}@${m.roundClock?.toFixed?.(0)}`);
    }
  }
  e.time.scale = 1;
  /**
   * THE ROUND STOPS COUNTING ONCE THE ARMOUR IS OUT. The cathedral event that
   * arms the sortie lands at ~57 % of a 600 s match, so watching from there to
   * the end at 1x is about 35 real seconds of hull — which is not long enough
   * to see whether a hull that stops STAYS stopped, and "it stops and never
   * moves again" is precisely the complaint. Nothing else is touched: the bots
   * fight, the zones flip, the guns fire; only the clock and the win check are
   * held, exactly as `_tankshot.mjs` and `_razestuck.mjs` already do.
   */
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  const a = m.tank;
  return {
    phase: m.phase, clock: +m.roundClock.toFixed(1), phases,
    states: a ? a.tanks.map((t) => `${t.id}:${t.state}`) : [],
  };
});
console.log('[stallwatch] armour rolled at', JSON.stringify(rolled));
if (!rolled.states.some((s) => !s.endsWith(':parked'))) {
  console.log('[stallwatch] NO SORTIE — match ended first. tanklog:');
  for (const l of tanklog) console.log('   ', l);
  await b.close();
  process.exit(1);
}

/* watch at 1x: sample every 0.5 s, screenshot every 2.5 s, chase camera */
await page.evaluate(({ FOLLOW }) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  window.__W = {
    samples: [], last: 0, t0: e.time.elapsed, FOLLOW,
    events: [],
  };
  e.ctx.events.on('match:tank', (ev) => {
    window.__W.events.push(`${(e.time.elapsed - window.__W.t0).toFixed(1)}s ${ev.id}:${ev.phase}`);
  });
  window.__CAM = () => {
    const t = m.tank.tanks.find((x) => x.id === FOLLOW) ?? m.tank.tanks[0];
    const player = e.ctx.peek('player');
    const ph = e.ctx.peek('physics');
    if (!t || t.state === 'parked') return false;
    /**
     * ELEVATED, AND THAT IS NOT A TASTE DECISION. A chase camera at hull height
     * behind the tank spends half the sortie INSIDE something — the cathedral's
     * own rubble field, a plough pile, a kerb — and a photograph of the inside
     * of a rock is not evidence about a tank. The eye goes up and looks down,
     * which is also the angle that shows what the hull has driven through.
     */
    const a = t.yaw + Math.PI * 0.86; // behind-left
    const d = 15;
    const x = t.position.x + Math.sin(a) * d;
    const z = t.position.z + Math.cos(a) * d;
    const g = ph.groundHeight(x, z, 60);
    const base = Number.isFinite(g) ? g : t.position.y;
    const y = Math.max(base, t.position.y) + 6.5;
    const v = m.sites[0].position.clone().set(x, y, z);
    const dx = t.position.x - x;
    const dz = t.position.z - z;
    const dy = t.position.y + 1.4 - (y + 1.62);
    player.respawnAt(v, Math.atan2(dx, dz));
    player.movement.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    return true;
  };
  /**
   * WHEN SOMEBODY IS ACTUALLY SHOOTING AT IT. `stats.rounds` is incremented by
   * `_takeRound` for every round that lands on a collider, so a jump in it is
   * the frame the infantry is hitting the hull — which is the thing the player
   * says he never sees. The camera goes BEHIND the hull looking back down the
   * bearing the last round came from, so the shooters are in frame rather than
   * the tank's own backplate.
   */
  window.__HITCAM = () => {
    const t = m.tank.tanks.find((x) => x.id === FOLLOW) ?? m.tank.tanks[0];
    if (!t || !t.alive) return null;
    const by = t.lastHitBy;
    const p = by?.position;
    if (!p) return null;
    const player = e.ctx.peek('player');
    const ph = e.ctx.peek('physics');
    // stand off to the side of the line between shooter and hull, elevated
    let dx = t.position.x - p.x;
    let dz = t.position.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const mx = (t.position.x + p.x) * 0.5;
    const mz = (t.position.z + p.z) * 0.5;
    const ox = mx - dz * 12;
    const oz = mz + dx * 12;
    const g = ph.groundHeight(ox, oz, 60);
    const y = (Number.isFinite(g) ? g : t.position.y) + 7.0;
    const v = m.sites[0].position.clone().set(ox, y, oz);
    const ax = mx - ox;
    const az = mz - oz;
    const ay = t.position.y + 1.2 - (y + 1.62);
    player.respawnAt(v, Math.atan2(ax, az));
    player.movement.pitch = Math.asin(ay / Math.hypot(ax, ay, az));
    return { by: by?.name ?? '?', dist: +len.toFixed(1) };
  };
  window.__ROUNDS = () => m.tank.tanks.reduce((a, t) => a + t.stats.rounds, 0);
  window.__DEAD = () => m.tank.tanks.filter((t) => t.state === 'dead').map((t) => t.id);
  window.__SAMPLE = () => {
    const W = window.__W;
    const now = e.time.elapsed - W.t0;
    for (const t of m.tank.tanks) {
      W.samples.push({
        t: +now.toFixed(1), id: t.id, st: t.state, leg: t.legIx, dir: t.legDir,
        s: +t.s.toFixed(1), x: +t.position.x.toFixed(1), z: +t.position.z.toFixed(1),
        y: +t.position.y.toFixed(2),
        tz: t.targetZone, hp: Math.round(t.health),
        tgt: t.target ? 1 : 0, drag: +(t.ploughDrag ?? 0).toFixed(2),
      });
    }
    return now;
  };
}, { FOLLOW });

let shotN = 0;
let hitN = 0;
let deadN = 0;
let lastShot = -99;
let lastHitShot = -99;
let lastSample = -99;
let rounds = 0;
const seenDead = new Set();
let now = 0;
const wall0 = Date.now();
while (now < WATCH && Date.now() - wall0 < WATCH * 1400 + 180000) {
  await page.waitForTimeout(120);
  now = await page.evaluate(() => {
    const e = window.__ENGINE__;
    return e.time.elapsed - window.__W.t0;
  });
  if (now - lastSample >= 0.5) {
    lastSample = now;
    await page.evaluate(() => window.__SAMPLE());
  }

  /* ---- somebody is hitting a hull: photograph the engagement ---------- */
  const r = await page.evaluate(() => window.__ROUNDS());
  if (r > rounds && now - lastHitShot >= 4) {
    lastHitShot = now;
    const info = await page.evaluate(() => window.__HITCAM());
    if (info) {
      await page.waitForTimeout(90);
      await page.screenshot({ path: `${SHOTS}/HIT-${String(hitN).padStart(2, '0')}-t${now.toFixed(0)}-${info.by}.png` });
      console.log(`  [hit] t=${now.toFixed(0)}s rounds ${rounds}->${r}, last by ${info.by} at ${info.dist} m`);
      hitN++;
    }
  }
  rounds = r;

  /* ---- a hull brewed up: photograph the wreck ------------------------- */
  const dead = await page.evaluate(() => window.__DEAD());
  for (const id of dead) {
    if (seenDead.has(id)) continue;
    seenDead.add(id);
    await page.evaluate((id) => {
      const e = window.__ENGINE__;
      const m = e.ctx.peek('match');
      const ph = e.ctx.peek('physics');
      const player = e.ctx.peek('player');
      const t = m.tank.tanks.find((x) => x.id === id);
      const a = t.yaw + Math.PI * 0.7;
      const x = t.position.x + Math.sin(a) * 16;
      const z = t.position.z + Math.cos(a) * 16;
      const g = ph.groundHeight(x, z, 60);
      const y = (Number.isFinite(g) ? g : t.position.y) + 7;
      const v = m.sites[0].position.clone().set(x, y, z);
      const dx = t.position.x - x;
      const dz = t.position.z - z;
      const dy = t.position.y + 1.5 - (y + 1.62);
      player.respawnAt(v, Math.atan2(dx, dz));
      player.movement.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    }, id);
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${SHOTS}/DEAD-${String(deadN).padStart(2, '0')}-t${now.toFixed(0)}-${id}.png` });
    console.log(`  [dead] t=${now.toFixed(0)}s ${id} destroyed`);
    deadN++;
  }

  if (now - lastShot >= 2.5) {
    lastShot = now;
    const ok = await page.evaluate(() => window.__CAM());
    if (ok) {
      await page.waitForTimeout(80);
      await page.screenshot({ path: `${SHOTS}/${String(shotN).padStart(3, '0')}-t${now.toFixed(0)}.png` });
      shotN++;
    }
  }
  const done = await page.evaluate(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    return m.phase !== 'live' || m.tank.tanks.every((t) => t.state === 'parked' || t.state === 'dead');
  });
  if (done && now > 30) break;
}

const out = await page.evaluate(() => window.__W);
await b.close();

/* ---- stall analysis ------------------------------------------------------ */
const byId = {};
for (const s of out.samples) (byId[s.id] ?? (byId[s.id] = [])).push(s);
for (const id of Object.keys(byId)) {
  const rows = byId[id];
  console.log(`\n===== ${id} — ${rows.length} samples =====`);
  let stallStart = null;
  let advanceT = 0;
  let slowT = 0;
  const stalls = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const c = rows[i];
    const dt = c.t - a.t;
    if (dt <= 0) continue;
    const v = Math.hypot(c.x - a.x, c.z - a.z) / dt;
    if (c.st === 'advance') {
      advanceT += dt;
      if (v < 0.35) {
        slowT += dt;
        if (stallStart === null) stallStart = { t: a.t, x: c.x, z: c.z, leg: c.leg, tz: c.tz };
      } else if (stallStart !== null) {
        const len = a.t - stallStart.t;
        if (len >= 3) stalls.push({ ...stallStart, len: +len.toFixed(1) });
        stallStart = null;
      }
    } else if (stallStart !== null) {
      const len = a.t - stallStart.t;
      if (len >= 3) stalls.push({ ...stallStart, len: +len.toFixed(1) });
      stallStart = null;
    }
  }
  if (stallStart !== null) {
    const len = rows[rows.length - 1].t - stallStart.t;
    if (len >= 3) stalls.push({ ...stallStart, len: +len.toFixed(1) });
  }
  console.log(`  advance time ${advanceT.toFixed(0)}s, under-0.35m/s inside it ${slowT.toFixed(0)}s (${advanceT ? ((slowT / advanceT) * 100).toFixed(0) : 0}%)`);
  /**
   * THE NUMBER THE AVERAGE HIDES. "5 % under walking pace while advancing" is
   * a fine figure and it is not what the player is looking at: a hull that
   * reaches `hold` is TERMINAL there by design and simply stands, so the way
   * this reads as 「スタックしてる」 is one unbroken motionless stretch, whatever
   * the state machine calls it. So the longest run of samples in which the hull
   * did not move 0.35 m/s is reported REGARDLESS of state, with where it was.
   */
  let frozeStart = null;
  let longest = null;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const c = rows[i];
    const dt = c.t - a.t;
    if (dt <= 0) continue;
    const v = Math.hypot(c.x - a.x, c.z - a.z) / dt;
    if (v < 0.35) {
      if (frozeStart === null) frozeStart = a;
    } else if (frozeStart !== null) {
      const len = a.t - frozeStart.t;
      if (!longest || len > longest.len) longest = { ...frozeStart, len: +len.toFixed(1) };
      frozeStart = null;
    }
  }
  if (frozeStart !== null) {
    const len = rows[rows.length - 1].t - frozeStart.t;
    if (!longest || len > longest.len) longest = { ...frozeStart, len: +len.toFixed(1) };
  }
  if (longest) {
    console.log(
      `  LONGEST MOTIONLESS STRETCH (any state): ${longest.len}s from t=${longest.t}s ` +
        `at (${longest.x}, ${longest.z}), state=${longest.st}, standing off ${longest.tz}`
    );
  } else console.log('  never motionless for a whole sample gap');
  if (stalls.length) {
    console.log('  STALLS >= 3s while ordered to MOVE:');
    for (const st of stalls) console.log(`    t=${st.t}s for ${st.len}s at (${st.x}, ${st.z}) leg=${st.leg} target=${st.tz}`);
  } else console.log('  no >=3s stall while ordered to move');
  const states = {};
  for (const r of rows) states[r.st] = (states[r.st] ?? 0) + 1;
  console.log('  state census:', JSON.stringify(states));
  console.log('  last:', JSON.stringify(rows[rows.length - 1]));
}
console.log('\nevents:', out.events.join('  '));
console.log('\ntank console lines:');
for (const l of tanklog) console.log('   ', l);
if (errs.length) console.log('PAGEERRORS:', errs);
console.log(`\n${shotN} chase shots, ${hitN} engagement shots, ${deadN} wreck shots in ${SHOTS}`);
