/**
 * A PHOTOGRAPH FROM AN ABSOLUTE POINT IN SCALED LEVEL SPACE.
 *
 *   node _holeshot.mjs out=shots/hole url=http://127.0.0.1:4280/ seed=12 \
 *        id:fromX,fromY,fromZ,lookX,lookY,lookZ
 *
 * `_look.mjs` drops the eye onto whatever physics reports under the point, which
 * inside a building is the ROOF. The hole this is aimed at is a gallery 3.45 m up
 * behind a facade, so the eye height has to be stated rather than found.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const args = process.argv.slice(2);
const OUT = (args.find((a) => a.startsWith('out=')) ?? 'out=shots/hole').slice(4);
const URL = (args.find((a) => a.startsWith('url=')) ?? 'url=http://127.0.0.1:4280/').slice(4);
const SEED = (args.find((a) => a.startsWith('seed=')) ?? 'seed=12').slice(5);
/**
 * A pose is `id:x,y,z,x,y,z`. The `!a.includes('=')` is NOT tidiness: `url=http://…`
 * contains a colon, so without it the URL parses as a pose whose numbers are all
 * NaN, `camera.lookAt` writes a NaN matrix — and the camera never recovers, so
 * EVERY frame after it comes back black. Four rounds of this probe were spent
 * looking for the reason a lit map photographed as a black rectangle.
 */
const POSES = args.filter((a) => a.includes(':') && !a.includes('=')).map((a) => {
  const [id, rest] = a.split(':');
  const n = rest.split(',').map(Number);
  return { id, from: [n[0], n[1], n[2]], look: [n[3], n[4], n[5]] };
});
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
    '--force-color-profile=srgb', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(SEED === 'off' ? `${URL}?capture=1` : `${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
});
console.log('levelSeed', await page.evaluate(() => window.__ENGINE__.levelSeed));
for (const p of POSES) {
  await page.evaluate((pose) => {
    const e = window.__ENGINE__;
    const world = e.ctx.peek('world');
    const V3 = e.camera.position.constructor;
    const from = world.levelToWorld(pose.from[0], pose.from[1], pose.from[2], new V3());
    const to = world.levelToWorld(pose.look[0], pose.look[1], pose.look[2], new V3());
    e.camera.position.copy(from);
    e.camera.lookAt(to);
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  }, p);
  // 60 REAL FRAMES, not 2.6 s of wall clock. Headless throttles rAF when nothing
  // commits, so a timer-based settle screenshots a canvas that never redrew — it
  // comes back black with the DOM HUD on top of it, which is exactly what the
  // first four frames out of this probe were.
  await page.evaluate(
    (n) => new Promise((done) => { let i = 0; const t = () => (++i >= n ? done() : requestAnimationFrame(t)); requestAnimationFrame(t); }),
    60
  );
  await page.screenshot({ path: `${OUT}/${p.id}.png`, type: 'png' });
  console.log(`${OUT}/${p.id}.png`);
}
if (errs.length) console.log('PAGE ERRORS', errs.slice(0, 4));
await browser.close();
