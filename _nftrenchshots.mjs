/**
 * THE NETWORK, PHOTOGRAPHED — from inside a cut at both stances, at a junction,
 * and from a hundred metres off.
 *
 *   node _nftrenchshots.mjs [--url=http://127.0.0.1:4608/?map=plains]
 *
 * The stance pair is the whole point of the section and it is the one thing a
 * number cannot show: 1.65 m of cut plus 0.35 m of spoil is 2.00 m of cover, so
 * a STANDING eye at 1.62 on the floor is 0.38 under the crest and sees sky and
 * revetment, and the SAME eye on the 0.45 m fire step is 0.07 over it and sees
 * the map. A crouched eye on the step is back under. Both frames are taken from
 * the same (x, z) so the only variable is the stance.
 *
 * Positions come from `plains-trench.js` itself — bay axes and published ways
 * out — rather than from coordinates typed into this file, so a line that moves
 * moves its own photographs.
 *
 * LIGHTING: whatever the map is currently lit by. Another agent is making this
 * map much darker with the burning ridge as the key light, so every frame says
 * the moon's intensity and the hour it was taken at, and the report quotes them.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4608/?map=plains';
mkdirSync('shots/trench', { recursive: true });

const { trenchBays, trenchExits } = await import('./src/world/levels/plains-trench.js');
const bays = trenchBays();
/** A long bay with a sally ramp — the one worth photographing from inside. */
const deep = bays.filter((b) => b.exits.some((e) => e.kind === 'sally')).sort((a, b) => (b.s1 - b.s0) - (a.s1 - a.s0))[0];
const mid = deep.pts[deep.pts.length >> 1];
const nxt = deep.pts[(deep.pts.length >> 1) + 1] ?? deep.pts[deep.pts.length - 1];
const along = Math.atan2(nxt[0] - mid[0], nxt[1] - mid[1]);
const sally = trenchExits().find((e) => e.kind === 'sally' && e.id.startsWith(deep.name)) ?? trenchExits().find((e) => e.kind === 'sally');
/** The tightest junction on the map: two lines at MIN_SEP, mouth to mouth. */
const mouths = trenchExits().filter((e) => e.kind === 'mouth');
let jx = null, jd = 1e9;
for (let i = 0; i < mouths.length; i++) for (let j = i + 1; j < mouths.length; j++) {
  if (mouths[i].id === mouths[j].id) continue;
  const d = Math.hypot(mouths[i].x - mouths[j].x, mouths[i].z - mouths[j].z);
  if (d < jd) { jd = d; jx = [mouths[i], mouths[j]]; }
}

const SHOTS = [
  { id: 'a-floor-stand', x: mid[0], z: mid[1], eye: 1.62, yaw: along, pitch: 0.02,
    note: `standing eye on the floor of ${deep.name} — under the crest` },
  { id: 'b-floor-crouch', x: mid[0], z: mid[1], eye: 1.15, yaw: along, pitch: 0.02,
    note: `crouched eye on the same spot` },
  { id: 'c-firestep-stand', x: mid[0], z: mid[1], eye: 1.62 + 0.45, yaw: along + 1.4, pitch: 0.0,
    note: `standing eye ON the fire step — 0.07 m over the crest, looking out` },
  { id: 'd-firestep-crouch', x: mid[0], z: mid[1], eye: 1.15 + 0.45, yaw: along + 1.4, pitch: 0.0,
    note: `crouched on the fire step — back under it` },
  { id: 'e-sally', x: sally.x + sally.dx * 1.0, z: sally.z + sally.dz * 1.0, eye: 1.62,
    yaw: Math.atan2(sally.dx, sally.dz), pitch: -0.12, note: 'looking up a sally ramp, the way out' },
  { id: 'f-junction', x: (jx[0].x + jx[1].x) / 2, z: (jx[0].z + jx[1].z) / 2, eye: 1.62,
    yaw: Math.atan2(jx[1].x - jx[0].x, jx[1].z - jx[0].z), pitch: -0.03,
    note: `the tightest junction: ${jx[0].id} to ${jx[1].id}, ${jd.toFixed(1)} m of ground between them` },
  { id: 'g-100m', x: mid[0], z: mid[1], eye: 1.62, yaw: along + Math.PI / 2, pitch: -0.02, back: 100,
    note: 'the network from 100 m, at a standing eye' },
  { id: 'h-100m-high', x: mid[0], z: mid[1], eye: 26, yaw: along + Math.PI / 2, pitch: -0.42, back: 100,
    note: 'the same from 100 m and 26 m up, so the lace of it reads' },
];

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${URL}&capture=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const info = await p.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world');
  const sky = c.peek('sky');
  const m = c.peek('match'); if (m) m.update = () => {};
  const ui = c.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  let moon = null, sun = null;
  c.scene.traverse((o) => {
    if (o.isDirectionalLight) { if (moon === null) moon = +o.intensity.toFixed(4); else sun = +o.intensity.toFixed(4); }
  });
  return { level: w.level.id, hour: w.level.hour, moon, sun, fires: (w.level.fires ?? []).length };
});
console.log(`level.id=${info.level}  hour=${info.hour}  key light intensity=${info.moon}${info.sun !== null ? ` / ${info.sun}` : ''}  fires=${info.fires}`);
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

for (const s of SHOTS) {
  await p.evaluate((s) => {
    const c = window.__ENGINE__.ctx, w = c.peek('world'), pl = c.peek('player');
    let x = s.x, z = s.z;
    if (s.back) { x += Math.sin(s.yaw) * s.back; z += Math.cos(s.yaw) * s.back; }
    const y = (s.back ? w.level.groundY(x, z) : w.level.groundY(s.x, s.z) - 1.65) + s.eye;
    pl?.teleport?.({ x, y, z }, s.yaw);
    c.camera.rotation.order = 'YXZ';
    c.camera.position.set(x, y, z);
    c.camera.rotation.y = s.yaw;
    c.camera.rotation.x = s.pitch;
  }, s);
  await wait(90);
  await p.evaluate((s) => {
    const c = window.__ENGINE__.ctx, w = c.peek('world');
    let x = s.x, z = s.z;
    if (s.back) { x += Math.sin(s.yaw) * s.back; z += Math.cos(s.yaw) * s.back; }
    const y = (s.back ? w.level.groundY(x, z) : w.level.groundY(s.x, s.z) - 1.65) + s.eye;
    c.camera.position.set(x, y, z);
    c.camera.rotation.order = 'YXZ';
    c.camera.rotation.y = s.yaw;
    c.camera.rotation.x = s.pitch;
    c.camera.updateMatrixWorld(true);
  }, s);
  await p.screenshot({ path: `shots/trench/${s.id}.png` });
  console.log(`  shots/trench/${s.id}.png — ${s.note}`);
}
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs[0]}` : '[pageerror] none');
await b.close();
