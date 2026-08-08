/**
 * THE WHOLE CLIMB, AT A STANDING EYE, WITH THE POSE READ BACK OFF THE CAMERA.
 *
 *   node _nftowerclimb.mjs [--port=4623] [--out=shots/towerclimb]
 *
 * 「管制塔は修正した？ 階段治ってないけど？？ あと壁が透過されるバグもあるぞ？」
 *
 * Third time of asking on the stairs, so this photographs the climb rather than
 * arguing about it: the bottom step, three points up flight I, the head, the
 * parapet gate, flight II and where it comes out — plus the four internal shaft
 * flights, which are the only stairs on this map with a slab over them.
 *
 * THE CAMERA HOLDS, and that is the whole harness. `Player.update` writes the
 * camera every frame under `controlEnabled`, so a teleport with control ON is a
 * silent no-op and every look-up frame comes out level. `src/dev/shots.js` turns
 * control OFF first; this does the same and then PRINTS `camera.rotation` back,
 * so a shot that did not take cannot be reported as one that did.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const PORT = args.port ?? '4623';
const OUT = args.out ?? 'shots/towerclimb';
const EYE = 1.62;
mkdirSync(OUT, { recursive: true });

/* the tower's own numbers — @see src/world/levels/plains-tower.js */
const T = { x: 0, z: -32 };
const P1_TOP = 3.2, P2_TOP = 6.6, ROOM_Y = 6.74;
const FLOORS = [ROOM_Y, 11.6, 16.4, 21.2], ROOF_Y = 25.8;
const RUN1 = P1_TOP / 0.38, OUT1 = 21 + 3.6 / 2 + 0.15;
const RUN2 = (P2_TOP - P1_TOP) / 0.38, P2_R = 12;

/** East climb: n=(1,0), t=(0,1). P(u,v) = (T.x + u, T.z + v). */
const E = (u, v) => [T.x + u, T.z + v];
/** South climb: n=(0,1), t=(-1,0). P(u,v) = (T.x - v, T.z + u). */
const S = (u, v) => [T.x - v, T.z + u];

const SHOTS = [];
const add = (tag, p, y, look, ly) => SHOTS.push({ tag, x: p[0], y, z: p[1], lx: look[0], ly, lz: look[1] });

for (const [nm, P] of [['east', E], ['south', S]]) {
  const foot = P(OUT1, -RUN1 / 2), head = P(OUT1, RUN1 / 2);
  const q = (t) => P(OUT1, -RUN1 / 2 + t * RUN1);
  add(`${nm}-1-foot`, foot, 0, q(0.6), P1_TOP * 0.6);
  add(`${nm}-2-quarter`, q(0.25), P1_TOP * 0.25, q(0.85), P1_TOP * 0.85);
  add(`${nm}-3-mid`, q(0.5), P1_TOP * 0.5, head, P1_TOP);
  add(`${nm}-4-head`, head, P1_TOP, P(P2_R, RUN1 / 2), P1_TOP);
  add(`${nm}-5-gate`, P(21, RUN1 / 2), P1_TOP, P(P2_R - 2, RUN1 / 2), P2_TOP);
  add(`${nm}-6-flightII`, P(P2_R + RUN2 - 0.6, RUN1 / 2), P1_TOP, P(P2_R - 0.6, RUN1 / 2), P2_TOP);
  add(`${nm}-7-flightII-mid`, P(P2_R + RUN2 / 2, RUN1 / 2), (P1_TOP + P2_TOP) / 2, P(P2_R - 2, RUN1 / 2), P2_TOP);
  add(`${nm}-8-top`, P(P2_R - 1.5, RUN1 / 2), P2_TOP, [T.x, T.z], P2_TOP + 1.2);
}
/* the internal dog-leg: the foot of half-flight A, its head at the half-landing,
   and the foot of half-flight B, for each storey */
const WX = 1.28, Z0 = -2.6, ZL = 2.0;
for (let f = 1; f < FLOORS.length + 1; f++) {
  const fy = f < FLOORS.length ? FLOORS[f] : ROOF_Y;
  const prev = FLOORS[f - 1], mid = (prev + fy) / 2;
  add(`shaft-${f}-A-foot`, [T.x - WX, T.z + Z0 - 0.6], prev, [T.x - WX, T.z + ZL], mid + 1.2);
  add(`shaft-${f}-A-mid`, [T.x - WX, T.z + (Z0 + ZL) / 2], (prev + mid) / 2, [T.x - WX, T.z + ZL], mid + 1.2);
  add(`shaft-${f}-landing`, [T.x, T.z + (ZL + 3.5) / 2], mid, [T.x + WX, T.z + Z0], fy + 0.6);
  add(`shaft-${f}-B-mid`, [T.x + WX, T.z + (Z0 + ZL) / 2], (mid + fy) / 2, [T.x + WX, T.z + Z0], fy + 1.2);
}

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`http://127.0.0.1:${PORT}/?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));
await p.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  // THE LINE THAT MAKES THE CAMERA HOLD — @see src/dev/shots.js
  e.ctx.peek('player')?.setControlEnabled?.(false);
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
});
const frames = (n) => p.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

for (const s of SHOTS) {
  const pose = await p.evaluate((s) => {
    const e = window.__ENGINE__;
    const V = e.camera.position.constructor;
    // y is a HEIGHT ABOVE THE TOWER'S OWN GROUND, so the shots follow the climb.
    // THE ANALYTIC PLAIN, NOT `physics.groundHeight` — the latter answers with
    // the highest solid in the column and inside this podium that is the cab
    // floor at 26.9. That is defect 5 of this brief, met on the way past.
    const g = e.ctx.peek('world').level.groundY(0, -32);
    e.camera.position.set(s.x, g + s.y + 1.62, s.z);
    e.camera.lookAt(new V(s.lx, g + s.ly + 1.62, s.lz));
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    e.camera.position.set(s.x, g + s.y + 1.62, s.z);
    e.camera.lookAt(new V(s.lx, g + s.ly + 1.62, s.lz));
    e.camera.updateMatrixWorld(true);
    const c = e.camera;
    return { x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2),
      pitch: +c.rotation.x.toFixed(3), yaw: +c.rotation.y.toFixed(3) };
  }, s);
  await frames(24);
  const back = await p.evaluate(() => {
    const c = window.__ENGINE__.camera;
    return { x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2),
      pitch: +c.rotation.x.toFixed(3), yaw: +c.rotation.y.toFixed(3) };
  });
  await p.screenshot({ path: `${OUT}/${s.tag}.png` });
  const held = Math.abs(back.y - pose.y) < 0.05 && Math.abs(back.pitch - pose.pitch) < 0.02;
  console.log(`  · ${s.tag.padEnd(20)} at (${back.x}, ${back.y}, ${back.z}) pitch ${back.pitch} yaw ${back.yaw} ${held ? '' : '  ***MOVED*** wanted y ' + pose.y + ' pitch ' + pose.pitch}`);
}
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '\n0 pageerrors');
await b.close();
