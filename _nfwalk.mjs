/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE WALK. The real character controller, from the plain to the button.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   BASE=http://127.0.0.1:4631/ node _nfwalk.mjs [--shots=shots/nfwalk] [--bot]
 *
 * 「管制塔の上いけないじゃん なんで？ 爆撃機を呼ぶのできないじゃんこれじゃ」
 *
 * FOURTH time of asking on this staircase. The three passes before this one all
 * measured a PROXY — head clearance, tread/cell arithmetic, how many bots used
 * the outside flights — and all three passed while the man could not get up.
 * So this measures the only thing that decides it: `PlayerSystem` with
 * `controlEnabled` TRUE, `KeyW` held in `Input.down`, the same `movement.js`
 * the user has under his hands, walked from the apron to the console.
 *
 * WHAT IS PRINTED EVERY SAMPLE: world position, y, the state the controller is
 * in, whether it is still gaining height, and WHAT IS OVER THE HEAD — a
 * MASK.CHARACTER ray straight up from the eye, with the distance to it. Where
 * the y stops climbing and the ceiling distance collapses, that is the defect.
 *
 * A PASS IS THE WALK ARRIVING WITH `_cachePrompt` NAMING `NF-TOWER-SATCALL`
 * AND `_satCall()` RETURNING NO DENIAL. Nothing else is a pass.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = process.env.BASE ?? 'http://127.0.0.1:4631/';
const OUT = args.shots ?? 'shots/nfwalk';
/**
 * `--tol` is how near a waypoint counts as reached, and it is a real knob, not
 * a tuning one: at the default 0.75 m the driver can call the foot of the stair
 * "reached" while standing 0.75 m short of it and half a metre off its lane,
 * which is how the first run of the stop-and-restart test walked round the very
 * crate it was aimed at. `--from` starts the walk at a named waypoint instead of
 * the apron, so that test is twenty seconds instead of ten minutes.
 */
const TOL = Number(args.tol ?? 0.75);
const FROM = args.from ? String(args.from) : null;
const TO = args.to ? String(args.to) : null;
/** extra waypoint tags to come to a dead stop on — @see `SHOOT`. */
const PAUSE = args.pause ? String(args.pause).split(',').map((t) => `|${t}`).join('') : '';
mkdirSync(OUT, { recursive: true });

/* ---- the tower's own numbers, copied from plains-tower.js ---------------- */
const T = { x: 0, z: -32 };
const P1_R = 21, P1_TOP = 3.2, P2_R = 12, P2_TOP = 6.6;
const ROOM_Y = P2_TOP + 0.14;
const FLOORS = [ROOM_Y, 11.6, 16.4, 21.2];
const ROOF_Y = 25.8, CAB_F = 26.0;
const RAMP_GRADE = 0.38, FLIGHT_W = 3.6;
const RUN1 = P1_TOP / RAMP_GRADE;              // 8.421
const RUN2 = (P2_TOP - P1_TOP) / RAMP_GRADE;   // 8.947
const OUT1 = P1_R + FLIGHT_W / 2 + 0.15;       // 22.95
const WELL_X = 2.6, WELL_Z0 = -2.6, WELL_Z1 = 3.5, LAND_Z = 2.0, FLIGHT_XO = 1.28;

/** East climb frame: n = (1,0), t = (0,1). */
const E = (u, v) => [T.x + u, T.z + v];

/**
 * THE ROUTE, as waypoints a man would walk. Each is [x, z, tag]; the driver
 * steers `movement.yaw` at the next one and holds KeyW, which is the whole of
 * "hold forward". Nothing here teleports after the start.
 */
const WP = [];
/**
 * `h` is the LEVEL height of the floor that waypoint stands on, and it exists
 * for `--from` alone. `physics.groundHeight` answers with the highest solid in
 * the column, and inside this tower that is the CAB FLOOR at 26 m — a probe that
 * used it to spawn "in the control room" spawned on the roof and reported a
 * four-second climb. The spawn ray is dropped from `h + 1.5` instead.
 */
const w = (p, tag, h) => WP.push({ x: p[0], z: p[1], tag, h });
w(E(OUT1, -RUN1 / 2 - 5.0), 'apron', 0);
w(E(OUT1, -RUN1 / 2 + 0.4), 'flightI-foot', 0);
w(E(OUT1, RUN1 / 2 + 0.6), 'flightI-head', P1_TOP);
w(E(P1_R - 0.4, RUN1 / 2), 'parapet-gate', P1_TOP);
w(E(P2_R + RUN2 - 0.3, RUN1 / 2), 'flightII-foot', P1_TOP);
w(E(P2_R - 0.9, RUN1 / 2), 'flightII-head', P2_TOP);
w(E(8.2, 0.0), 'gallery', P2_TOP);
w(E(4.2, 0.0), 'room-door', ROOM_Y);                  // through the +X doorway
w([T.x - FLIGHT_XO, T.z + WELL_Z0 - 1.5], 'room-floor', ROOM_Y);
/**
 * ON THE BOTTOM STEP'S OWN LINE, 0.7 m short of the first tread. `--pause` here
 * is the case the momentum of a continuous walk hides: the 0.49 m carton stood
 * at z -2.89 and the 0.95 m barrel at z -2.45, i.e. BETWEEN this point and the
 * stair, and 0.49 m is over `maxStep` 0.45 and over the 0.42 m stance step. A
 * man who stops here and pushes forward either climbs or he does not. Run it
 * with `--tol=0.4`, or the driver calls the foot "reached" from 0.75 m short of
 * it and half a metre off its lane and walks round the very crate it is aimed at.
 */
w([T.x - FLIGHT_XO, T.z + WELL_Z0 - 0.7], 'stair-foot', ROOM_Y);
/* the dog-leg: four storeys of the same four corners */
for (let f = 1; f < FLOORS.length + 1; f++) {
  const fy = f < FLOORS.length ? FLOORS[f] : ROOF_Y;
  const mid = (FLOORS[f - 1] + fy) / 2;
  w([T.x - FLIGHT_XO, T.z + LAND_Z + 0.75], `s${f}-halflanding`, mid);
  w([T.x + FLIGHT_XO, T.z + LAND_Z + 0.75], `s${f}-turn`, mid);
  w([T.x + FLIGHT_XO, T.z + WELL_Z0 - 1.5], `s${f}-arrival`, f < FLOORS.length ? fy : CAB_F);
  if (f < FLOORS.length) w([T.x - FLIGHT_XO, T.z + WELL_Z0 - 1.5], `s${f + 1}-foot`, fy);
}
/* out of the stair opening onto the cab floor, then west to the console */
w([T.x + 1.28, T.z - 5.2], 'cab-floor', CAB_F);
w([T.x - 4.3, T.z - 3.4], 'the-button', CAB_F);   // a metre off the desk's near face
/**
 * …AND BACK DOWN, on the same waypoints in reverse. A weapon at the top of a
 * tower that razes at 500 points is only a weapon if a man can get up it, call,
 * and be off it again, so the descent is timed with the climb and not assumed
 * from it. Nothing is teleported: he turns round and walks.
 */
for (let i = WP.length - 2; i >= 0; i--) w([WP[i].x, WP[i].z], `down-${WP[i].tag}`, WP[i].h);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => {
  errs.push(String(e.message));
  if (errs.length <= 3) console.log('  PAGEERROR:', String(e.message).slice(0, 200));
});
await p.goto(`${BASE}?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

/* the prompt only exists in PHASE.LIVE — @see _nfsat.mjs */
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await p.waitForFunction(() => window.__ENGINE__.ctx.peek('match')?.phase === 'live', null, { timeout: 180000 });
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });
console.log('phase   =', await p.evaluate(() => window.__ENGINE__.ctx.peek('match').phase));

/**
 * INSTALL THE DRIVER. `movement.yaw` is a plain field the look input writes; the
 * harness writes it instead (input.frozen kills the mouse) and holds KeyW in
 * `Input.down`, which `beginFrame` never clears. Everything downstream of that —
 * latchInput, the capsule sweep, the step-up, the mantle — is untouched.
 */
await p.evaluate(({ route: fullRoute, extra, tol, from, to }) => {
  let route = fullRoute;
  const e = window.__ENGINE__;
  const pl = e.ctx.peek('player');
  const mv = pl.movement;
  const ph = e.ctx.peek('physics') ?? pl.physics;
  const MASK = ph.MASK;
  const ui = e.ctx.peek('ui');

  // A man walking a staircase is not the subject of the fight. Bots keep
  // playing; they just cannot end the experiment.
  pl.health.damage = () => 0;

  const start = from ? Math.max(0, route.findIndex((q) => q.tag === from)) : 0;
  if (to) {
    const end = route.findIndex((q, i) => i > start && q.tag === to);
    if (end > 0) route = route.slice(0, end + 1);
  }
  const W = window.__WALK__ = {
    i: start, route, frames: 0, log: [], done: false, stopped: null, tol,
    maxY: -1e9, sinceGain: 0, sinceWp: 0, arrived: [], shot: null,
  };
  /**
   * The landings the shutter fires on. Every stop is also a FULL STOP — the
   * driver lets go of KeyW and the capsule comes to rest — so a stop is not
   * only a photograph, it is the "can he start again from here" test.
   *
   * `--pause=room-floor` is that test aimed at the one place it used to fail.
   * The control room's loose-stores scatter tested the doors, the four piers and
   * the two supply posts and never the stair, and it had put a 0.49 m carton and
   * a 0.95 m barrel on the bottom of half-flight A. 0.49 m is over `maxStep`
   * 0.45 AND over the 0.42 m standing stance step, so a man who STOPPED at the
   * foot could not start again on that line. Walking through with momentum hid
   * it; standing still is what finds it.
   */
  const SHOOT = new RegExp(`^(?!down-).*(head$|arrival$|halflanding$|room-door|cab-floor|the-button${extra})`);

  const up = { x: 0, y: 1, z: 0 };
  const sample = () => {
    const pos = mv.position;                     // FEET
    const eye = pl.eyePosition;
    const hit = ph.raycast(pos.x, pos.y + 1.55, pos.z, 0, 1, 0, 30, MASK.CHARACTER);
    return {
      f: W.frames,
      t: +(W.frames / 60).toFixed(2),
      wp: W.route[W.i]?.tag ?? 'end',
      x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2),
      eyeY: +eye.y.toFixed(2),
      st: mv.state, gr: mv.grounded ? 1 : 0,
      up: hit.hit ? +hit.distance.toFixed(2) : null,
      upS: hit.hit ? hit.surface : null,
      gain: +(pos.y - W.maxY).toFixed(3),
    };
  };

  const steer = () => {
    if (W.done) return;
    /**
     * THE SHOT PAUSE. When a landing is reached the driver lets go of KeyW and
     * waits for the harness to press the shutter, so every frame in `shots/` is
     * a frame of THIS walk seen down the player's own camera at a standing eye
     * — not a posed `__APPLY_SHOT__` camera with control off, which is how two
     * earlier passes photographed level frames they believed were overhead.
     */
    if (W.shot) { e.input.down.delete('KeyW'); return; }
    const pos = mv.position;
    const tgt = W.route[W.i];
    if (!tgt) { W.done = true; return; }
    const dx = tgt.x - pos.x, dz = tgt.z - pos.z;
    const d = Math.hypot(dx, dz);
    // forward on this engine is (-sin yaw, -cos yaw) — measured, @see _nfsat.mjs 3
    mv.yaw = Math.atan2(-dx, -dz);
    if (d < W.tol) {
      W.arrived.push({ tag: tgt.tag, f: W.frames, t: +(W.frames / 60).toFixed(2),
        y: +pos.y.toFixed(2) });
      W.i++; W.sinceWp = 0;
      if (SHOOT.test(tgt.tag)) W.shot = tgt.tag;
    } else if (++W.sinceWp > 60 * 25) {
      W.stopped = `no waypoint reached in 25 s (target ${tgt.tag}, ${d.toFixed(2)} m away)`;
      W.done = true;
    }
    if (pos.y > W.maxY + 0.02) { W.maxY = pos.y; W.sinceGain = 0; } else W.sinceGain++;
  };

  const prev = e.step;
  e.step = function () {
    if (!W.done) {
      steer();
      W.frames++;
      if (W.frames % 6 === 0 || W.frames < 4) W.log.push(sample());
    }
    return prev.apply(this, arguments);
  };

  e.input.frozen = true;          // no mouse look; the driver owns the yaw
  e.input.down.add('KeyW');       // …and forward is held, exactly as a key is
  if (ui?.root) ui.root.style.opacity = '1';

  // START ON THE PLAIN, at the foot of the east climb, facing up it — or at the
  // named waypoint when `--from` asks for one leg rather than the whole walk.
  const s = route[start];
  const datum = e.ctx.peek('world').level.groundY(s.x, s.z);
  let g = datum;
  if (from) {
    // …dropped from just over the floor that waypoint stands on, NOT from the
    // sky and NOT via `groundHeight`. @see the note on `w`.
    const hit = ph.raycast(s.x, datum + s.h + 1.5, s.z, 0, -1, 0, 4, ph.MASK.CHARACTER);
    g = hit.hit ? hit.point.y : datum + s.h;
  }
  pl.respawnAt({ x: s.x, y: g + 0.2, z: s.z }, Math.atan2(0, -1));
  /**
   * …AND THEN PUT HIM THERE FOR REAL. `respawnAt` re-resolves the floor with
   * `physics.groundHeight(x, z, y + 6)`, which drops a ray from SIX METRES UP:
   * asked for the control room at 6.74 it returns storey 1's slab at 11.6 and
   * the walk starts a storey too high. `teleport` takes an EYE and does not
   * argue. The third trap of this shape in this file — @see the note on `w`.
   */
  if (from) pl.teleport({ x: s.x, y: g + 0.05 + 1.66, z: s.z }, { x: 0, y: Math.atan2(0, -1) });
  pl.setControlEnabled(true);
  mv.velocity.set(0, 0, 0);
}, { route: WP, extra: PAUSE, tol: TOL, from: FROM, to: TO });

const startedAt = Date.now();
const shots = [];
let atButton = null;
for (let k = 0; k < 3000; k++) {
  const st = await p.evaluate(() => ({ f: window.__WALK__.frames, d: window.__WALK__.done,
    i: window.__WALK__.i, shot: window.__WALK__.shot }));
  if (st.d || st.f > 60 * 240) break;
  if (st.shot) {
    const pose = await p.evaluate(() => {
      const c = window.__ENGINE__.camera; c.updateMatrixWorld(true);
      return { x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2),
        pitch: +c.rotation.x.toFixed(3), yaw: +c.rotation.y.toFixed(3) };
    });
    await p.screenshot({ path: `${OUT}/${st.shot}.png` });
    shots.push({ tag: st.shot, ...pose });
    /**
     * THE ONE FRAME THIS WHOLE FILE IS FOR. He is at the desk: turn him to it
     * with `controlEnabled` still TRUE (`Player.update` writes the camera from
     * the rig every frame, so a pose set any other way is a pose that did not
     * happen), read the prompt off `match._cachePrompt`, and photograph it.
     */
    if (st.shot === 'the-button') {
      atButton = await p.evaluate(() => {
        const e = window.__ENGINE__;
        const m = e.ctx.peek('match');
        const pl = e.ctx.peek('player');
        const k = m.caches.list.find((q) => q.id === 'NF-TOWER-SATCALL');
        const d = pl.position;
        if (k) pl.movement.yaw = Math.atan2(-(k.position.x - d.x), -(k.position.z - d.z));
        return { post: k ? [+k.position.x.toFixed(2), +k.position.y.toFixed(2), +k.position.z.toFixed(2)] : null };
      });
      await p.waitForTimeout(900);
      Object.assign(atButton, await p.evaluate(() => {
        const e = window.__ENGINE__;
        const m = e.ctx.peek('match');
        const pl = e.ctx.peek('player');
        const c = e.camera; c.updateMatrixWorld(true);
        return {
          nearest: m.caches.nearest(pl.position)?.id ?? null,
          prompt: { ...m._cachePrompt, alt: m._cachePrompt.alt ? 'SET' : null },
          eye: [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)],
          pitch: +c.rotation.x.toFixed(3), yaw: +c.rotation.y.toFixed(3),
        };
      }));
      await p.screenshot({ path: `${OUT}/the-button-faced.png` });
    }
    await p.evaluate(() => {
      window.__WALK__.shot = null; window.__WALK__.sinceWp = 0;
      window.__ENGINE__.input.down.add('KeyW');
    });
    continue;
  }
  if (k % 30 === 0) console.log(`  …driving: frame ${st.f} (sim ${(st.f / 60).toFixed(1)} s), waypoint ${st.i}/${WP.length}`);
  await p.waitForTimeout(500);
}
const r = await p.evaluate(() => {
  const W = window.__WALK__;
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const pl = e.ctx.peek('player');
  const n = m.caches.nearest(pl.position);
  return {
    stopped: W.stopped, frames: W.frames, i: W.i, n: W.route.length,
    arrived: W.arrived, log: W.log, maxY: +W.maxY.toFixed(2),
    at: [+pl.position.x.toFixed(2), +pl.position.y.toFixed(2), +pl.position.z.toFixed(2)],
    nearest: n?.id ?? null,
    prompt: { ...m._cachePrompt, alt: m._cachePrompt.alt ? 'SET' : null },
  };
});

console.log('\n── THE WALK ────────────────────────────────────────────────────');
console.log('  f      t     waypoint          x       y       z    state  gr  overhead');
for (const s of r.log) {
  console.log(`  ${String(s.f).padStart(5)} ${String(s.t).padStart(6)} ${s.wp.padEnd(16)} ` +
    `${String(s.x).padStart(7)} ${String(s.y).padStart(7)} ${String(s.z).padStart(7)}  ` +
    `${String(s.st).padEnd(6)} ${s.gr}  ${s.up === null ? 'open sky' : s.up + ' m ' + s.upS}`);
}
console.log('\n── WAYPOINTS REACHED ───────────────────────────────────────────');
for (const a of r.arrived) console.log(`  ${a.tag.padEnd(18)} t=${String(a.t).padStart(6)} s   y=${a.y}`);
console.log(`\n  reached ${r.i}/${r.n} waypoints, highest feet y = ${r.maxY}, ended at ${JSON.stringify(r.at)}`);
if (r.stopped) console.log(`  *** STOPPED: ${r.stopped}`);

/**
 * THE TIMINGS. `capture=1` pins every frame at exactly 1/60 s of simulated
 * time, so frame counts ARE seconds — which is the only reason a number here
 * means anything about what the tower costs a player. The tower razes at 500
 * points and takes the button with it, so up-and-back is the figure that says
 * whether the weapon is usable, not the climb on its own.
 */
const leg = (tag) => r.arrived.find((a) => a.tag === tag)?.t ?? null;
const tUp = leg('the-button');
const tDown = leg('down-apron') ?? leg('down-flightI-foot');
console.log('\n── TIMINGS, IN SIMULATED SECONDS (capture=1 pins dt at 1/60) ───');
console.log(`  apron -> the button      ${tUp} s`);
console.log(`  the button -> the apron  ${tDown !== null && tUp !== null ? (tDown - tUp).toFixed(2) : '—'} s`);
console.log(`  up and back              ${tDown ?? '—'} s   (walking, no sprint, with the shutter pauses in it)`);

console.log('\n── THE BUTTON, AS HE STOOD AT IT ───────────────────────────────');
if (!atButton) console.log('  NEVER REACHED');
else {
  console.log(`  post at ${JSON.stringify(atButton.post)} · eye ${JSON.stringify(atButton.eye)} ` +
    `pitch ${atButton.pitch} yaw ${atButton.yaw}`);
  console.log('  nearest cache =', atButton.nearest);
  console.log('  prompt        =', JSON.stringify(atButton.prompt));
}
const callable = await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const c = window.__ENGINE__.ctx;
  for (const z of m.sites) { z.owner = 1 - m.playerTeam; z.ownedSince = c.time.elapsed; }
  m._sat.readyAt = 0;
  const denied = m._satCall();
  return { denied: denied ?? null, zone: m._sat?.zone?.id ?? null };
});
console.log('  _satCall()    =', JSON.stringify(callable));

await p.screenshot({ path: `${OUT}/end.png` });
console.log('\n── FRAMES, WITH THE POSE READ BACK OFF THE CAMERA ──────────────');
for (const s of shots) {
  console.log(`  ${s.tag.padEnd(18)} eye (${s.x}, ${s.y}, ${s.z}) pitch ${s.pitch} yaw ${s.yaw}  → ${OUT}/${s.tag}.png`);
}
/**
 * A pass is the walk COMPLETING — every waypoint of whatever route was asked
 * for, no stall — and, whenever that route actually contains the console, the
 * prompt and a strike that is not refused. A truncated `--to` leg is a pass on
 * the first clause alone, and says so.
 */
const wantsButton = WP.some((q) => q.tag === 'the-button') && !TO;
const PASS = !r.stopped && r.i >= r.n && errs.length === 0 &&
  (!wantsButton || (atButton?.nearest === 'NF-TOWER-SATCALL' &&
    /ORBITAL STRIKE/.test(atButton?.prompt?.text ?? '') && !callable.denied));
console.log(`\n  WALK ${PASS ? 'PASS' : 'FAIL'} · wall clock ${((Date.now() - startedAt) / 1000).toFixed(1)} s · ` +
  `sim ${(r.frames / 60).toFixed(1)} s · pageerrors ${errs.length}${errs.length ? ' :: ' + errs[0] : ''}`);
await b.close();
process.exit(PASS ? 0 : 1);
