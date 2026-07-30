/**
 * EYE-LEVEL PHOTOGRAPHY AT AN ARBITRARY PAIR OF AUTHORED POINTS.
 *
 *   node _look.mjs out=/tmp/shots id:fromX,fromZ,lookX,lookZ[,eyeY[,lookAbsY]]
 *
 * `tools/eyeshot.mjs` is the canonical set and its poses are fixed there. This
 * is the same camera hand-over for a point you are holding in your head while
 * you type a block — so the coordinates are AUTHORED (widened, pre-1.5x) level
 * units, the ones src/world/layout.js is written in, and not the scaled ones.
 * The eye is dropped onto whatever physics says the floor is.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const args = process.argv.slice(2);
const OUT = (args.find((a) => a.startsWith('out=')) ?? 'out=shots/look').slice(4);
const URL = (args.find((a) => a.startsWith('url=')) ?? 'url=http://127.0.0.1:4250/').slice(4);
const POSES = args.filter((a) => a.includes(':')).map((a) => {
  const [id, rest] = a.split(':');
  const n = rest.split(',').map(Number);
  return { id, from: [n[0], n[1]], look: [n[2], n[3]], dy: n[4], lookAbs: n[5] };
});
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--force-color-profile=srgb'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
});
for (const p of POSES) {
  const info = await page.evaluate((pose) => {
    const e = window.__ENGINE__;
    const world = e.ctx.peek('world');
    const phys = e.ctx.peek('physics');
    const V3 = e.camera.position.constructor;
    const S = 1.5;
    const floor = (lx, lz) => {
      const w = world.levelToWorld(lx * S, 0, lz * S, new V3());
      const h = phys.raycast(w.x, 30, w.z, 0, -1, 0, 60, phys.MASK.WORLD);
      w.y = h.hit ? h.point.y : 0;
      return w;
    };
    const from = floor(pose.from[0], pose.from[1]);
    const to = floor(pose.look[0], pose.look[1]);
    if (Number.isFinite(pose.lookAbs)) to.y = pose.lookAbs - 1.2;
    const cam = e.camera;
    cam.position.set(from.x, from.y + (Number.isFinite(pose.dy) ? pose.dy : 1.62), from.z);
    cam.lookAt(new V3(to.x, to.y + 1.2, to.z));
    e.ctx.peek('player')?.teleport?.(cam.position, cam.rotation);
    return { floorY: +from.y.toFixed(2), targetY: +to.y.toFixed(2) };
  }, p);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${p.id}.png` });
  console.log(`${OUT}/${p.id}.png  floor ${info.floorY}  target ${info.targetY}`);
}
if (errs.length) console.log('PAGE ERRORS', errs);
await browser.close();
