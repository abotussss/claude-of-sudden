/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE TOWER, INTACT AND RAZED, LOOKED AT
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   BASE=http://127.0.0.1:4626/ node _tzshots.mjs
 *
 * NACHTFELD is authored at hour 21.65 — it is genuinely a night map, lit by the
 * moon, five fires, the tower's own practicals and its emissive marks. Nothing
 * here changes the lighting; every frame is the map as it is played.
 *
 * THE POSE IS READ BACK OFF THE CAMERA AND PRINTED FOR EVERY FRAME. Setting
 * `camera.position` alone does not hold, and `player.teleport(eye, rot)` reads a
 * pitch ONLY when `rot` is an object (`src/player/index.js:891`) — which is why
 * two earlier passes' "look up" screenshots came out level. So `rot` is
 * `{ x: pitch, y: yaw }` and the answer is verified rather than assumed.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4626/';
const DIR = 'shots/tzraze';
mkdirSync(DIR, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${BASE}?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id),
  ' hour =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.hour));

/**
 * FREEZE THE MATCH AND THE PLAYER FIRST, and this is not cosmetic. The first run
 * of this file left the match live: shot 03 poses the camera on zone D, the man
 * is shot by the bots holding it, and shot 04 came back from (-25.6, -160) — a
 * SPAWN, 130 m away, with the note still claiming it was D's north edge. A
 * screenshot harness that does not stop the game photographs a different game.
 * AND `setControlEnabled(false)` IS NOT PART OF IT. The second run of this file
 * added it and every one of the seventeen frames came back from (-14, 1.91,
 * -150) — the spawn — because with control off nothing pushes the movement
 * state into the camera and `teleport` has nowhere to land.
 *
 * …AND `match.update` GOES BACK ON BEFORE THE ACT IS FIRED, which is the third
 * thing this file got wrong. `Airstrike.update` is called by `MatchSystem`, so
 * a stubbed `m.update` means `site.t` never advances: `callDemolition` swaps the
 * shell out and then the collapse never runs, and the run deadlocked waiting for
 * a clock that was switched off. The 'during' frames therefore run with the
 * match LIVE, and every one of them re-poses immediately before the shutter so
 * that a man who is shot and respawned is put back where he belongs.
 */
const freeze = (on) => p.evaluate((on) => {
  const c = window.__ENGINE__.ctx;
  const m = c.peek('match');
  if (!m) return;
  if (on) { m.__realUpdate = m.__realUpdate ?? m.update; m.update = () => {}; }
  else if (m.__realUpdate) m.update = m.__realUpdate;
}, on);
await p.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  c.peek('ui')?.banner?.hide?.();
  const ui = c.peek('ui');
  if (ui?.root) ui.root.style.display = 'none';
});
await freeze(true);
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

/**
 * WAIT ON THE SITE'S OWN CLOCK, NOT ON A FRAME COUNT. The first version of this
 * file counted frames and labelled them in seconds at 60 Hz — headless this
 * renderer runs at about 13 Hz, so "2.0 s into the collapse" was 8.9 s and
 * every 'during' frame photographed the SETTLED site with the caption of a
 * collapse. `site.t` is the seconds since `fire()` and is what the shader's own
 * `uT` uniform is driven from, so it is the collapse's real clock.
 */
const until = (secs) => p.evaluate((secs) => new Promise((r) => {
  const s = window.__ENGINE__.ctx.peek('match').airstrike.sites.find((k) => k.id === 'NF-TOWER');
  const t = () => (s.t >= secs || s.t < 0 ? r(+s.t.toFixed(2)) : requestAnimationFrame(t));
  requestAnimationFrame(t);
}), secs);

/**
 * …AND WAITING FOR THE SETTLE IS A DIFFERENT QUESTION FROM WAITING FOR A TIME.
 * `site.t` STOPS at `SETTLE_AT` 6.5 — `_bakeSettled` freezes it — so `until(9)`
 * never resolves and the run hangs forever with nine razed frames still to
 * take. The settle has its own flag and that is what to wait on.
 */
const settled = () => p.evaluate(() => new Promise((r) => {
  const s = window.__ENGINE__.ctx.peek('match').airstrike.sites.find((k) => k.id === 'NF-TOWER');
  let n = 0;
  const t = () => (s.baked || ++n > 4000 ? r(!!s.baked) : requestAnimationFrame(t));
  requestAnimationFrame(t);
}));

/**
 * Stand at (x,z) with the eye `eye` m over whatever is under it, looking at `at`.
 *
 * `from` is where the floor ray STARTS, and it has to be an argument. Inside the
 * shaft a ray dropped from 80 m finds the top storey's own slab at 29.0 and the
 * first run of this file photographed "standing in the control room" from 30.86
 * m with the camera pitched a radian into the floor. The room's ceiling is the
 * slab at 14.8, so 12.5 is inside it.
 */
const pose = (x, z, at, eye = 1.62, from = 80) => p.evaluate(({ x, z, at, eye, from }) => {
  const c = window.__ENGINE__.ctx;
  const ph = c.peek('physics');
  const pl = c.peek('player');
  let f = ph.groundHeight(x, z, from);
  if (!Number.isFinite(f)) f = c.peek('world').groundHeight(x, z);
  const ey = f + eye;
  const dx = at[0] - x, dy = at[1] - ey, dz = at[2] - z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  // `rot` MUST be an object for the pitch to be read. @see the header.
  pl.teleport({ x, y: ey, z }, { x: pitch, y: yaw });
  return { want: { x, y: +ey.toFixed(2), z, yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3) } };
}, { x, z, at, eye, from });

const readback = () => p.evaluate(() => {
  const c = window.__ENGINE__.ctx.camera;
  c.rotation.order = 'YXZ';
  return { x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2), yaw: +c.rotation.y.toFixed(3), pitch: +c.rotation.x.toFixed(3) };
});

/**
 * `frames` is how long the renderer is given to settle before the shutter, and
 * it has to be an argument. 90 frames is 1.5 s at 60 Hz and SIX AND A HALF
 * SECONDS headless — fine for a static frame, and for a 'during' frame it is
 * the difference between photographing a collapse and photographing its
 * aftermath. During the act the pose is set first, the site's own clock is
 * waited on, and the shutter is two frames later.
 */
const shot = async (name, note, frames = 90) => {
  await wait(frames);
  const got = await readback();
  await p.screenshot({ path: `${DIR}/${name}.png` });
  console.log(`  ${DIR}/${name}.png  camera ${JSON.stringify(got)}  — ${note}`);
};

const T = [0, -32];
const CAB = [0, 34.2, -32];
const SITE = [0, 4.0, -32];

/* ------------------------------------------------------------------ intact -- */
/**
 * 150 m ON A BEARING THE FORTRESS IS NOT ON. Due south of the tower is (0, 118)
 * and NF-FORT stands at (0, 48) with a 36 m reach — the first run of this file
 * photographed "the tower from 150 m" and got a fortress with no tower behind
 * it. (106, 74) is 150 m from the tower and passes 56 m clear of the fort;
 * (-150, -32) is due west, down the open lane.
 */
await pose(106, 74, CAB);       await shot('01-intact-150m-southeast', 'intact, 150 m south-east, looking at the cab');
await pose(-150, -32, CAB);     await shot('02-intact-150m-west', 'intact, 150 m west');
await pose(0, 0, [0, 20, -32]); await shot('03-intact-from-D', 'intact, standing on zone D — 32 m to the tower');
await pose(0, -8, [0, 15.9, -32]); await shot('04-intact-signband', "intact, 24 m off the south face — the sign band at 18.6 m");
await pose(3.0, -32, [26, 10.6, -32], 1.62, 12.5);
await shot('05-intact-in-the-room', 'intact, standing IN the control room, looking out the east door');

/* --------------------------------------------------------- fire it for real -- */
// …and he does not move again: the camera stays where it is while the tower
// comes down on top of it. `pose` is not called again until it has settled.
/**
 * THE POSE IS SET AND THE EXPOSURE IS LET SETTLE *BEFORE* THE ACT IS FIRED.
 * The auto-exposure takes about a second and a half to adapt, and a camera
 * teleported mid-collapse and shuttered two frames later photographs a black
 * rectangle — which is what the run before this one produced. So each 'during'
 * frame poses first, waits for the eye to adjust while the tower is still
 * standing, and only then fires; `until` puts the shutter on the site's own
 * collapse clock and `shotT` prints what that clock actually read.
 */
const shotT = async (name, note, t) => {
  const now = await until(t);
  await p.screenshot({ path: `${DIR}/${name}.png` });
  const c = await readback();
  console.log(`  ${DIR}/${name}.png  site.t=${now}s  camera ${JSON.stringify(c)}  — ${note}`);
};

await freeze(false);
// …the man who is in the control room when it goes.
await pose(3.0, -32, [26, 8.0, -32], 1.62, 12.5);
await wait(60);
await p.evaluate(() => window.__ENGINE__.ctx.peek('match').airstrike.callDemolition('NF-TOWER'));
await shotT('06-during-inside-early', 'THE ACT, from where the man in the control room is standing', 0.5);
await shotT('07-during-inside-late', 'THE ACT, same man, same spot', 2.0);
await settled();   // let this one settle, then set up the outside pair
await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const s = m.airstrike.sites.find((k) => k.id === 'NF-TOWER');
  // put the building back up so the collapse can be photographed from outside
  s.demo.setDown(false); s.struck = false; s.baked = false; s.t = -1;
  for (const mesh of s.meshes) mesh.visible = false;
  if (s.nav) m.airstrike._applyNav(s, false);
});
// 86 m out on a clear bearing — (0, 40) is INSIDE the fortress.
await pose(60, 30, [0, 18, -32]);
await wait(60);
await p.evaluate(() => window.__ENGINE__.ctx.peek('match').airstrike.callDemolition('NF-TOWER'));
await shotT('08-during-from-86m-early', 'THE ACT, from 86 m south-east', 1.2);
await shotT('09-during-from-86m-late', 'THE ACT, from 86 m south-east', 3.2);
await settled();   // `site.t` stops at SETTLE_AT; the flag is the truth
await freeze(true);

/* ------------------------------------------------------------------- razed -- */
await pose(106, 74, [0, 4.5, -32]);  await shot('10-razed-150m-southeast', 'razed, 150 m south-east — the same frame as 01');
await pose(-150, -32, [0, 4.5, -32]); await shot('11-razed-150m-west', 'razed, 150 m west — the same frame as 02');
await pose(0, 0, [0, 3.6, -32]);    await shot('12-razed-from-D', 'razed, standing on zone D — the same frame as 03');
await pose(0, -32, [26, 3.6, -32]); await shot('13-razed-on-the-site', 'razed, standing ON the site at a standing eye, looking east');
await pose(3.0, -32, [26, 3.6, -32], 1.62); await shot('14-razed-where-the-room-was', 'razed, where the control room was — the man walks out');
await pose(6.5, -32, [1.5, 3.4, -32], 1.62); await shot('15-razed-rubble-at-5m', 'the rubble at 5 m, so the chunk size can be judged');
await pose(0, -20, [0, 3.4, -32], 1.62); await shot('16-razed-across-the-apron', 'razed, across the apron from the north');
await pose(14.5, -50, [14.5, 3.6, -32], 1.62); await shot('17-razed-the-cab-wreck', 'the cab on the ground and the mast beyond it');

console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
