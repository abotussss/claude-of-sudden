/**
 * THE TOWN'S GROUND, BEFORE AND AFTER THE WINDING FIX.
 *
 *   node _townground.mjs --tag=before|after [--port=4612]
 *
 * `patchGeometry` is shared: `dressing.js`, `ground.js`, `relief.js`,
 * `interiors.js`, `cathedral.js`, `sitework.js` and `buildings.js` all lay
 * decals with it, so reversing its winding in `src/world/util.js` reaches the
 * town as well as the plain. The town is another agent's map and the bar is that
 * nothing there gets worse, so this takes the same eight frames either side of
 * the change — street level, a square, an interior floor and the cathedral — and
 * `tools/imagediff.mjs` says what moved.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4612'}/?map=town&capture=1`;
const OUT = args.out ?? `shots/townground-${args.tag ?? 'x'}`;
mkdirSync(OUT, { recursive: true });

/** Level-space points; `world.levelToWorld` puts them where they belong. */
const SHOTS = [
  ['street-n', 0, -40, 0.0, -0.35],
  ['street-s', 0, 40, Math.PI, -0.35],
  ['square', -30, 0, 1.2, -0.30],
  ['east', 40, -10, -1.6, -0.30],
  ['west', -55, 20, 1.9, -0.30],
  ['centre', 0, 0, 0.7, -0.55],
  ['north-far', 10, -90, 2.6, -0.25],
  ['south-far', -10, 90, -0.5, -0.25],
];

const br = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await br.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const lvl = await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
console.log('level =', lvl, 'out =', OUT);
if (lvl !== 'town') { console.error('NOT THE TOWN'); await br.close(); process.exit(2); }
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
  const pl = e.ctx.peek('player'); if (pl) pl.applyDamage = () => {};
});
const frames = (n) => page.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

for (const [id, lx, lz, yaw, pitch] of SHOTS) {
  await page.evaluate(([lx, lz, yaw, pitch]) => {
    const e = window.__ENGINE__, w = e.ctx.peek('world'), ph = e.ctx.peek('physics');
    const p = w.levelToWorld ? w.levelToWorld(lx, 0, lz) : { x: lx, y: 0, z: lz };
    const h = ph.raycast(p.x, 300, p.z, 0, -1, 0, 400, ph.MASK.WORLD);
    const y = (h.hit ? h.point.y : 0) + 1.62;
    e.camera.position.set(p.x, y, p.z);
    e.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    e.camera.position.set(p.x, y, p.z);
    e.camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }, [lx, lz, yaw, pitch]);
  await frames(32);
  await page.screenshot({ path: `${OUT}/${id}.png` });
  console.log(`  · ${id}.png`);
}
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs[0]}` : '0 pageerrors');
await br.close();
