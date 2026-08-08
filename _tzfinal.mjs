/**
 * THE COLLAPSE FROM ZONE D, AND THE SITE IT LEAVES.
 *
 *   BASE=http://127.0.0.1:4626/ node _tzfinal.mjs
 *
 * Split out of `_tzshots.mjs`, which owns the INTACT frames. Two lessons are
 * baked into the poses here rather than into a comment somewhere else:
 *
 *   THE COLLAPSE IS PHOTOGRAPHED FROM ZONE D, at 32 m. The 86 m south-east
 *   vantage the first pass used sits in a hollow — the camera's own eye reads
 *   y 0.65 against a plain at 3.20 — and a ridge takes the tower out of frame
 *   entirely, so four frames of "the act" were four frames of a dust column
 *   with no building under it. D is where the player is standing when this
 *   fires, it is the point the tower exists to overlook, and it has a clean
 *   sightline (@see `03-intact-from-D`).
 *   `site.t` STOPS at `SETTLE_AT` 6.5, so the settle is waited on by its own
 *   flag. A `t >= 9` wait hangs forever.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4626/';
const DIR = 'shots/tzraze';
mkdirSync(DIR, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${BASE}?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id),
  ' hour =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.hour));
await p.evaluate(() => { const c = window.__ENGINE__.ctx;
  c.peek('ui')?.banner?.hide?.(); const ui = c.peek('ui'); if (ui?.root) ui.root.style.display = 'none'; });
const freeze = (on) => p.evaluate((on) => { const m = window.__ENGINE__.ctx.peek('match');
  if (on) { m.__realUpdate = m.__realUpdate ?? m.update; m.update = () => {}; } else if (m.__realUpdate) m.update = m.__realUpdate; }, on);
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
const pose = (x, z, at, eye = 1.62, from = 80) => p.evaluate(({ x, z, at, eye, from }) => {
  const c = window.__ENGINE__.ctx, ph = c.peek('physics'), pl = c.peek('player');
  let f = ph.groundHeight(x, z, from); if (!Number.isFinite(f)) f = c.peek('world').groundHeight(x, z);
  const ey = f + eye, dx = at[0] - x, dy = at[1] - ey, dz = at[2] - z;
  pl.teleport({ x, y: ey, z }, { x: Math.atan2(dy, Math.hypot(dx, dz)), y: Math.atan2(-dx, -dz) });
}, { x, z, at, eye, from });
const until = (secs) => p.evaluate((secs) => new Promise((r) => {
  const s = window.__ENGINE__.ctx.peek('match').airstrike.sites.find((k) => k.id === 'NF-TOWER');
  const t = () => (s.t >= secs || s.t < 0 ? r(+s.t.toFixed(2)) : requestAnimationFrame(t)); requestAnimationFrame(t); }), secs);
const settled = () => p.evaluate(() => new Promise((r) => {
  const s = window.__ENGINE__.ctx.peek('match').airstrike.sites.find((k) => k.id === 'NF-TOWER');
  let n = 0; const t = () => (s.baked || ++n > 4000 ? r(!!s.baked) : requestAnimationFrame(t)); requestAnimationFrame(t); }));
const cam = () => p.evaluate(() => { const k = window.__ENGINE__.ctx.camera; k.rotation.order = 'YXZ';
  return { x:+k.position.x.toFixed(2), y:+k.position.y.toFixed(2), z:+k.position.z.toFixed(2), yaw:+k.rotation.y.toFixed(3), pitch:+k.rotation.x.toFixed(3) }; });
const shutter = async (n, note, t) => { const now = t === undefined ? null : await until(t);
  await p.screenshot({ path: `${DIR}/${n}.png` });
  console.log(`  ${DIR}/${n}.png  ${now === null ? '' : `site.t=${now}s  `}camera ${JSON.stringify(await cam())}  — ${note}`); };
const shot = async (n, note, f = 90) => { await wait(f); await shutter(n, note); };

// ---- the act, from the capture point it exists to overlook --------------------
await freeze(true); await pose(0, 0, [0, 20, -32]); await wait(70); await freeze(false);
await p.evaluate(() => window.__ENGINE__.ctx.peek('match').airstrike.callDemolition('NF-TOWER'));
await shutter('06-act-from-D-0_5s', 'THE ACT from zone D, 32 m', 0.5);
await shutter('07-act-from-D-1_5s', 'THE ACT from zone D, 32 m', 1.5);
await shutter('08-act-from-D-2_6s', 'THE ACT from zone D, 32 m', 2.6);
await shutter('09-act-from-D-4_2s', 'THE ACT from zone D, 32 m', 4.2);
await settled(); await freeze(true);
// ---- and the site it leaves ---------------------------------------------------
await pose(106, 74, [0, 4.5, -32]);  await shot('10-razed-150m-southeast', 'razed, 150 m south-east — same frame as 01');
await pose(-150, -32, [0, 4.5, -32]); await shot('11-razed-150m-west', 'razed, 150 m west — same frame as 02');
await pose(0, 0, [0, 3.6, -32]);      await shot('12-razed-from-D', 'razed, standing on zone D — same frame as 03');
await pose(0, -32, [26, 3.6, -32]);   await shot('13-razed-on-the-site', 'razed, standing ON the site at a standing eye');
await pose(3.0, -32, [26, 3.6, -32]); await shot('14-razed-where-the-room-was', 'razed, where the control room was — the man walks out');
await pose(6.5, -32, [1.5, 3.4, -32]); await shot('15-razed-rubble-at-5m', 'the rubble at 5 m, so the chunk size can be judged');
await pose(0, -20, [0, 3.4, -32]);    await shot('16-razed-across-the-apron', 'razed, across the apron from the north');
await pose(14.5, -50, [14.5, 3.6, -32]); await shot('17-razed-the-cab-wreck', 'the cab on the ground and the mast beyond it');
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
