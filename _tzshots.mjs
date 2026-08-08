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

await p.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const ui = c.peek('ui');
  if (ui?.root) ui.root.style.display = 'none';
});
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

/** Stand at (x,z) with the eye `eye` m over whatever is under it, looking at `at`. */
const pose = (x, z, at, eye = 1.62) => p.evaluate(({ x, z, at, eye }) => {
  const c = window.__ENGINE__.ctx;
  const ph = c.peek('physics');
  const pl = c.peek('player');
  let f = ph.groundHeight(x, z, 80);
  if (!Number.isFinite(f)) f = c.peek('world').groundHeight(x, z);
  const ey = f + eye;
  const dx = at[0] - x, dy = at[1] - ey, dz = at[2] - z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  // `rot` MUST be an object for the pitch to be read. @see the header.
  pl.teleport({ x, y: ey, z }, { x: pitch, y: yaw });
  return { want: { x, y: +ey.toFixed(2), z, yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3) } };
}, { x, z, at, eye });

const readback = () => p.evaluate(() => {
  const c = window.__ENGINE__.ctx.camera;
  c.rotation.order = 'YXZ';
  return { x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2), yaw: +c.rotation.y.toFixed(3), pitch: +c.rotation.x.toFixed(3) };
});

const shot = async (name, note) => {
  await wait(90);
  const got = await readback();
  await p.screenshot({ path: `${DIR}/${name}.png` });
  console.log(`  ${DIR}/${name}.png  camera ${JSON.stringify(got)}  — ${note}`);
};

const T = [0, -32];
const CAB = [0, 34.2, -32];
const SITE = [0, 4.0, -32];

/* ------------------------------------------------------------------ intact -- */
await pose(0, 118, CAB);      await shot('01-intact-150m-south', 'intact, 150 m south, looking at the cab');
await pose(-106, -32, CAB);   await shot('02-intact-150m-west', 'intact, 150 m west');
await pose(0, 0, [0, 20, -32]); await shot('03-intact-from-D', 'intact, standing on zone D at 32 m');
await pose(0, -8, [0, 6, -32]); await shot('04-intact-D-edge-signband', "intact, D's north edge — the sign band and the south climb");
await pose(3.0, -32, [12, 8.5, -32], 1.62); await shot('05-intact-in-the-room', 'intact, standing in the control room looking out the east door');

/* --------------------------------------------------------- fire it for real -- */
await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m.airstrike.callDemolition('NF-TOWER');
});
await wait(70);   // ~1.2 s in
await pose(0, 40, [0, 20, -32]); await shot('06-during-70f-from-72m', 'THE ACT, ~1.2 s in, from 72 m south');
await wait(70);
await pose(0, 40, [0, 14, -32]); await shot('07-during-140f', 'THE ACT, ~2.4 s in');
// …and the man who was inside it
await pose(3.0, -32, [12, 6, -32], 1.62); await shot('08-during-inside', 'THE ACT, from where a man in the control room is standing');
await wait(420);  // past SETTLE_AT 6.5 s

/* ------------------------------------------------------------------- razed -- */
await pose(0, 118, [0, 6, -32]);  await shot('09-razed-150m-south', 'razed, 150 m south — the same frame as 01');
await pose(-106, -32, [0, 6, -32]); await shot('10-razed-150m-west', 'razed, 150 m west — the same frame as 02');
await pose(0, 0, [0, 4, -32]);    await shot('11-razed-from-D', 'razed, standing on zone D — the same frame as 03');
await pose(0, -32, SITE);         await shot('12-razed-on-the-site', 'razed, standing ON the site at a standing eye');
await pose(3.0, -32, [24, 3.6, -32], 1.62); await shot('13-razed-where-the-room-was', 'razed, where the control room was — can he see out?');
await pose(6.5, -32, [1.5, 3.3, -32], 1.62); await shot('14-razed-rubble-at-5m', 'the rubble at 5 m, so the chunk size can be judged');
await pose(0, -20, [0, 3.4, -32], 1.62); await shot('15-razed-across-the-apron', 'razed, across the apron from the north');

console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
