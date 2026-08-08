/**
 * NACHTFELD — THE GROUND AND THE MOUNTAIN, PHOTOGRAPHED.
 *
 *   node _terrshots.mjs [--url=http://127.0.0.1:4611/] [--out=shots/terr-after]
 *
 * 「もっと平原をリアルに、山もリアルに」 is judged by eye and by nothing else, so
 * this is the deliverable rather than a diagnostic. One fixed set of stands,
 * taken identically before and after, so the two directories diff.
 *
 * THE MAP IS ITS OWN QUERY PARAMETER and the run echoes `world.level.id`.
 * `?map=plains` appended to a URL that already carries a query is the truncating
 * bug that has silently photographed the TOWN in this tree more than once.
 *
 * The stands answer the brief's list:
 *   ground at 5 m / 30 m / 200 m      — the detail layer, the mid field, the far
 *   the mountain from the plain       — the rim as a skyline
 *   the mountain close to             — the face at arm's length
 *   the horizon where the two meet    — the join, which is where a swell fails
 *   in a fire's light / far from one  — the map is lit at 50 % night
 *   bearing 115° looking out          — where the pale plane was reported
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4611/';
const OUT = args.out ?? 'shots/terr';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${BASE}?capture=1&map=plains`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));
await p.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const m = c.peek('match'); if (m) m.update = () => {};
  const ui = c.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
});
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

/** eye height 1.65 m; pitch to put the ground `d` metres out in the middle. */
const look = (d) => -Math.atan(1.65 / d);

const SHOTS = [
  { id: '01-ground-5m',    x: -70, z: -60, yaw: 0.6,  pitch: look(5),   note: 'open ground, 5 m — the detail layer' },
  { id: '02-ground-30m',   x: -70, z: -60, yaw: 0.6,  pitch: look(30),  note: 'open ground, 30 m — the mid field' },
  { id: '03-ground-200m',  x: -70, z: -60, yaw: 0.6,  pitch: look(200), note: 'open ground, 200 m — the far read' },
  { id: '04-mtn-far',      x: 40,  z: 40,  bearing: 13.75, pitch: 0.06, note: 'the mountain from the plain (E fire bearing)' },
  { id: '05-mtn-near',     x: 0,   z: 0,   bearing: 13.75, r: 158, pitch: 0.22, note: 'the mountain close to, from its foot' },
  { id: '06-horizon',      x: 0,   z: 0,   bearing: 185, r: 120, pitch: 0.0,  note: 'the horizon where the plain meets the rim' },
  { id: '07-in-fire',      x: 0,   z: 0,   bearing: 13.75, r: 128, pitch: 0.10, note: "inside FIRE-E's pool" },
  { id: '08-no-fire',      x: -46, z: 62,  yaw: -1.9, pitch: 0.02, note: 'far from every fire — moon only' },
  { id: '09-out-115',      x: 0,   z: 0,   bearing: 115, r: 168, pitch: 0.10, note: 'bearing 115°, looking out — the reported pale plane' },
  { id: '10-swell-obliq',  x: -104, z: 22, yaw: 1.15, pitch: -0.03, note: 'raking light across the swell' },
  { id: '11-mtn-crest',    x: 0,   z: 0,   bearing: 150.1, r: 150, pitch: 0.30, note: 'up the face at the S fire' },
  { id: '12-ground-1m',    x: -70, z: -60, yaw: 0.6, pitch: look(1.2), note: 'ground at 1.2 m — the 0.5 m detail check' },
];

for (const s of SHOTS) {
  await p.evaluate((s) => {
    const c = window.__ENGINE__.ctx, w = c.peek('world'), pl = c.peek('player');
    let x = s.x, z = s.z, yaw = s.yaw;
    if (s.bearing !== undefined) {
      const a = s.bearing * Math.PI / 180;
      const r = s.r ?? 0;
      x = s.x + Math.cos(a) * r; z = s.z + Math.sin(a) * r;
      // face outward along +r; three looks down -Z
      yaw = Math.atan2(-Math.cos(a), -Math.sin(a));
    }
    const y = w.level.groundY(x, z) + 1.65;
    pl.teleport({ x, y, z }, yaw);
    if (pl.camera?.pitch !== undefined) pl.camera.pitch = s.pitch;
    c.camera.rotation.order = 'YXZ';
    c.camera.rotation.y = yaw;
    c.camera.rotation.x = s.pitch;
  }, s);
  await wait(140);
  await p.screenshot({ path: `${OUT}/${s.id}.png` });
  console.log(`  ${OUT}/${s.id}.png — ${s.note}`);
}
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
