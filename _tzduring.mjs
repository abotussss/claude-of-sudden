/**
 * THE MAN WHO IS INSIDE THE CONTROL ROOM WHEN IT COMES DOWN.
 *
 *   BASE=http://127.0.0.1:4626/ node _tzduring.mjs
 *
 * Split out of `_tzshots.mjs` because getting this one frame right needs three
 * things at once that fight each other, and each of them cost a run:
 *
 *   THE EXPOSURE has to adapt BEFORE the shutter — a camera teleported into the
 *   dark and shuttered two frames later photographs a black rectangle.
 *   THE MATCH has to be FROZEN while it adapts, or the man standing in a lit
 *   room on the objective is shot and respawned in a trench 100 m away and the
 *   frame is captioned with a pose it does not have.
 *   …AND IT HAS TO BE RUNNING WHEN THE ACT FIRES, because `Airstrike.update` is
 *   called by `MatchSystem.update` and a stubbed one means `site.t` never
 *   advances and the collapse never plays at all.
 *
 * So: pose, freeze, let the eye adjust, UNFREEZE, fire, and put the shutter on
 * `site.t` — the site's own collapse clock, which is what drives the shader's
 * `uT`. The pose is read back off the camera into every line.
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
await p.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const ui = c.peek('ui');
  if (ui?.root) ui.root.style.display = 'none';
  c.peek('ui')?.banner?.hide?.();
});
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
const freeze = (on) => p.evaluate((on) => {
  const m = window.__ENGINE__.ctx.peek('match');
  if (on) { m.__realUpdate = m.__realUpdate ?? m.update; m.update = () => {}; }
  else if (m.__realUpdate) m.update = m.__realUpdate;
}, on);
const pose = (x, z, at, eye = 1.62, from = 80) => p.evaluate(({ x, z, at, eye, from }) => {
  const c = window.__ENGINE__.ctx, ph = c.peek('physics'), pl = c.peek('player');
  let f = ph.groundHeight(x, z, from);
  if (!Number.isFinite(f)) f = c.peek('world').groundHeight(x, z);
  const ey = f + eye, dx = at[0] - x, dy = at[1] - ey, dz = at[2] - z;
  pl.teleport({ x, y: ey, z }, { x: Math.atan2(dy, Math.hypot(dx, dz)), y: Math.atan2(-dx, -dz) });
}, { x, z, at, eye, from });
const until = (secs) => p.evaluate((secs) => new Promise((r) => {
  const s = window.__ENGINE__.ctx.peek('match').airstrike.sites.find((k) => k.id === 'NF-TOWER');
  const t = () => (s.t >= secs || s.t < 0 ? r(+s.t.toFixed(2)) : requestAnimationFrame(t));
  requestAnimationFrame(t);
}), secs);
const shutter = async (name, note, t) => {
  const now = await until(t);
  await p.screenshot({ path: `${DIR}/${name}.png` });
  const c = await p.evaluate(() => { const k = window.__ENGINE__.ctx.camera; k.rotation.order = 'YXZ';
    return { x: +k.position.x.toFixed(2), y: +k.position.y.toFixed(2), z: +k.position.z.toFixed(2), yaw: +k.rotation.y.toFixed(3), pitch: +k.rotation.x.toFixed(3) }; });
  console.log(`  ${DIR}/${name}.png  site.t=${now}s  camera ${JSON.stringify(c)}  — ${note}`);
};

// the control-room floor is at 9.94; 12.5 is the ray start that finds it
await freeze(true);
await pose(3.0, -32, [26, 9.5, -32], 1.62, 12.5);
await wait(70);
await freeze(false);
await p.evaluate(() => window.__ENGINE__.ctx.peek('match').airstrike.callDemolition('NF-TOWER'));
await shutter('06-during-inside-early', 'THE ACT, from where the man in the control room is standing', 0.5);
await shutter('07-during-inside-mid', 'THE ACT, same man, same spot', 1.6);
await shutter('07b-during-inside-late', 'THE ACT, same man, same spot', 3.2);
await freeze(true);
await wait(60);
await shutter('07c-after-inside-settled', 'AFTER — the same man, the same spot, once it has settled', 9.0);
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
