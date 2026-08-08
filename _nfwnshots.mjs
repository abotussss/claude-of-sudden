/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE MIDDLE THIRD, PHOTOGRAPHED — the frames `_nftrenchshots.mjs` cannot take
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfwnshots.mjs [--url=http://127.0.0.1:4624/?map=plains]
 *
 * `_nftrenchshots.mjs` photographs the LONGEST bay with a sally ramp, which is
 * always one of the flank spines out at r 140 — the very ground the user was not
 * complaining about. The complaint is 「塹壕が至る所にない」 while crossing the
 * MIDDLE, so these frames are taken inside a post at r 43, at the tightest
 * junction, standing in a vehicle crossing, and from a hundred metres out
 * looking across the centre of the map.
 *
 * Both stances at every close position, because the section is the argument:
 * 1.65 m of cut plus 0.35 m of spoil is 2.00 m of cover, so a standing eye at
 * 1.62 on the floor is 0.38 m UNDER the crest and a crouched one is 0.85 under.
 *
 * LIGHTING is whatever the map is currently lit by and it is genuinely dark, so
 * every frame reports the hour and the key light's intensity and the report
 * quotes them rather than describing the pictures as if they were daylight.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4624/?map=plains';
mkdirSync('shots/wn', { recursive: true });

const { trenchBays, trenchExits, GRADE } = await import('./src/world/levels/plains-trench.js');
const bays = trenchBays();
/** The post nearest the centre of the map — the one the complaint is about. */
const mid3 = bays
  .filter((b) => b.id.startsWith('NF-WN'))
  .sort((a, b) => Math.hypot(...a.pts[a.pts.length >> 1]) - Math.hypot(...b.pts[b.pts.length >> 1]))[0];
const M = mid3.pts[mid3.pts.length >> 1];
const N = mid3.pts[(mid3.pts.length >> 1) + 1] ?? mid3.pts[mid3.pts.length - 1];
const along = Math.atan2(N[0] - M[0], N[1] - M[1]);
console.log(`inside: ${mid3.name} at (${M[0].toFixed(0)},${M[1].toFixed(0)}), r ${Math.hypot(...M).toFixed(0)}`);

/** The tightest mouth-to-mouth junction anywhere on the network. */
const mouths = trenchExits().filter((e) => e.kind === 'mouth');
let jx = null, jd = 1e9;
for (let i = 0; i < mouths.length; i++) {
  for (let j = i + 1; j < mouths.length; j++) {
    if (mouths[i].id === mouths[j].id) continue;
    const d = Math.hypot(mouths[i].x - mouths[j].x, mouths[i].z - mouths[j].z);
    if (d > 1 && d < jd) { jd = d; jx = [mouths[i], mouths[j]]; }
  }
}
/** A vehicle crossing: ground deliberately left at grade for a hull. */
const G = GRADE[0];
console.log(`junction: ${jx[0].id} / ${jx[1].id}, ${jd.toFixed(1)} m apart`);
console.log(`crossing: GRADE circle at (${G[0]},${G[1]}) r ${G[2]}`);

const SHOTS = [
  { id: 'a-mid3-stand', x: M[0], z: M[1], eye: 1.62, yaw: along, pitch: 0.02, deep: true,
    note: `${mid3.name} floor, standing eye — the middle third, r ${Math.hypot(...M).toFixed(0)}` },
  { id: 'b-mid3-crouch', x: M[0], z: M[1], eye: 1.15, yaw: along, pitch: 0.02, deep: true,
    note: `the same spot, crouched` },
  { id: 'c-mid3-firestep', x: M[0], z: M[1], eye: 2.07, yaw: along + 1.45, pitch: 0.0, deep: true,
    note: `standing ON the fire step, looking out over the parapet at the centre of the map` },
  { id: 'd-junction-stand', x: (jx[0].x + jx[1].x) / 2, z: (jx[0].z + jx[1].z) / 2, eye: 1.62,
    yaw: Math.atan2(jx[1].x - jx[0].x, jx[1].z - jx[0].z), pitch: -0.04,
    note: `the tightest junction — ${jd.toFixed(1)} m of ground between two mouths, standing` },
  { id: 'e-junction-crouch', x: (jx[0].x + jx[1].x) / 2, z: (jx[0].z + jx[1].z) / 2, eye: 1.15,
    yaw: Math.atan2(jx[1].x - jx[0].x, jx[1].z - jx[0].z), pitch: -0.04,
    note: `the same junction, crouched` },
  { id: 'f-crossing-stand', x: G[0], z: G[1], eye: 1.62, yaw: 0.6, pitch: -0.05,
    note: 'standing in a vehicle crossing — the plain left undug so a hull can get over' },
  { id: 'g-crossing-crouch', x: G[0], z: G[1], eye: 1.15, yaw: 0.6, pitch: -0.05,
    note: 'the same crossing, crouched' },
  /**
   * THE CAMERA IS GIVEN, NOT DERIVED, FOR THESE THREE. A bearing and a `back`
   * chosen off a trench's own tangent kept landing the camera inside the control
   * tower at (0,-32) or the fortress at (0,48) — the two things in the middle of
   * this map. (-100, 60) is open plain looking north-east across 122 m of the
   * centre, with WN-01, WN-03, WN-05 and WN-07 between it and the far side.
   */
  { id: 'h-across-100m', x: -100, z: 60, eye: 1.62, yaw: 2.53, pitch: -0.01,
    note: 'from 122 m out at a standing eye, looking across the middle of the map' },
  { id: 'i-across-100m-crouch', x: -100, z: 60, eye: 1.15, yaw: 2.53, pitch: -0.01,
    note: 'the same, crouched' },
  /**
   * AND ONE FROM ABOVE. At hour 21.65 with a key light of 4.3 a 2 m cut is
   * genuinely hard to read at 120 m, which is the map working as intended and
   * useless as evidence.
   *
   * PITCHED NO STEEPER THAN -0.4, and that is a limit of this harness rather
   * than a choice: `player.teleport` hands the camera back to the player system,
   * which rewrites its pitch from its own state on the frame after each
   * placement, so only the position and yaw survive. At -1.02 the frame came
   * back as a photograph of the sky.
   */
  { id: 'j-mid3-down', x: -46, z: -40, eye: 34, yaw: 0.9, pitch: -0.36,
    note: 'the middle third from 34 m up — WN-01, WN-07 and the tower approach' },
  /**
   * AND ONE FROM OUTSIDE THE CUT, which is the frame that answers the actual
   * complaint. 「塹壕が至る所にない」 is about what a man SEES while crossing, and
   * a photograph taken from inside a trench cannot show whether he would have
   * found it. Thirty metres off at a standing eye is the range he meets one at.
   *
   * WEST OF THE POST AND NOT EAST: `along + PI/2` off WN-01 is a bearing 34 m
   * straight into the control tower at (0,-32), and both frames came back as
   * photographs of its stairwell.
   */
  { id: 'k-approach-stand', x: M[0], z: M[1], eye: 1.62, yaw: along + Math.PI / 2, pitch: -0.06, back: 30,
    note: `${mid3.name} seen from 30 m at a standing eye — the range a man meets it at` },
  { id: 'l-approach-high', x: M[0], z: M[1], eye: 9, yaw: along + Math.PI / 2, pitch: -0.28, back: 34,
    note: `${mid3.name} from 34 m and 9 m up, so the cut and its parapet read as a cut` },
];

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${URL}&capture=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const info = await p.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world');
  const m = c.peek('match'); if (m) m.update = () => {};
  const ui = c.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  let key = null, fill = null;
  c.scene.traverse((o) => {
    if (o.isDirectionalLight) { if (key === null) key = +o.intensity.toFixed(4); else fill = +o.intensity.toFixed(4); }
  });
  return { level: w.level.id, hour: w.level.hour, key, fill, fires: (w.level.fires ?? []).length };
});
console.log(`level.id=${info.level}  hour=${info.hour}  key light=${info.key}${info.fill !== null ? ` / ${info.fill}` : ''}  fires=${info.fires}`);
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

const place = (s) => {
  const c = window.__ENGINE__.ctx, w = c.peek('world'), pl = c.peek('player');
  let x = s.x, z = s.z;
  /**
   * `back` STEPS AWAY FROM THE SUBJECT AND THE CAMERA THEN LOOKS BACK AT IT.
   * Stepping ALONG `yaw` and also facing `yaw` — which is what the first cut of
   * this did, and what `_nftrenchshots.mjs` still does — puts the thing being
   * photographed directly behind the camera, and the "from 34 m" frame came back
   * as a picture of the ridge on the far side of the map.
   */
  if (s.back) { x -= Math.sin(s.yaw) * s.back; z -= Math.cos(s.yaw) * s.back; }
  const y = (s.back || !s.deep ? w.level.groundY(x, z) : w.level.groundY(s.x, s.z) - 1.65) + s.eye;
  pl?.teleport?.({ x, y, z }, s.yaw);
  c.camera.rotation.order = 'YXZ';
  c.camera.position.set(x, y, z);
  c.camera.rotation.y = s.yaw;
  c.camera.rotation.x = s.pitch;
  c.camera.updateMatrixWorld(true);
};
for (const s of SHOTS) {
  await p.evaluate(place, s);
  await wait(90);
  await p.evaluate(place, s);
  await p.screenshot({ path: `shots/wn/${s.id}.png` });
  console.log(`  shots/wn/${s.id}.png — ${s.note}`);
}
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs[0]}` : '[pageerror] none');
await b.close();
