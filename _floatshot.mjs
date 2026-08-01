/**
 * PHOTOGRAPH A VERDICT — the camera in WORLD coordinates, which is the frame
 * `_floatcheck` reports a floating mass in.
 *
 *   node _floatshot.mjs --out=shots/float --seed=12 --down=demo \
 *        "tower:-30,34,-2 -> -19.5,31,-9" \
 *        "flyer:@28,4,-> 20.9,10.2,9.1"
 *
 * A pose is `id:from -> to`. `from` is `x,y,z`, or `@x,z` to stand a player
 * there — the eye is dropped onto whatever physics says the floor is, plus
 * 1.62 m, because "is it reachable" is a question you answer by standing where
 * he stands. `to` is the point to look at.
 *
 * `tools/eyeshot.mjs` owns the canonical set and `_look.mjs` the authored
 * level-space one; neither can be aimed at a number this sweep printed.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true];
}));
const OUT = args.out ?? 'shots/float';
const URL = args.url ?? 'http://127.0.0.1:4345/';
const q = ['capture=1'];
if (args.seed) q.push(`seed=${args.seed}`);
if (args.down && args.down !== 'none') for (const d of String(args.down).split(',')) q.push(`${d}=down`);
// `--q=physdebug=1` draws the collision wireframe, which is the only way to
// photograph the difference between what a piece LOOKS like and what it IS.
if (args.q) q.push(String(args.q));

const POSES = argv.filter((a) => !a.startsWith('--')).map((s) => {
  const [id, rest] = s.split(':');
  const [f, t] = rest.split('->').map((x) => x.trim());
  const stand = f.startsWith('@');
  const fn = f.replace(/^@/, '').split(',').map(Number);
  const tn = t.split(',').map(Number);
  return { id, stand, from: fn, to: tn };
});
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--force-color-profile=srgb'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?${q.join('&')}`, { waitUntil: 'domcontentloaded' });
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
    const phys = e.ctx.peek('physics');
    const V3 = e.camera.position.constructor;
    let ex; let ey; let ez;
    if (pose.stand) {
      ex = pose.from[0]; ez = pose.from[1];
      const h = phys.raycast(ex, 44, ez, 0, -1, 0, 60, phys.MASK.WORLD);
      ey = (h.hit ? h.point.y : 0) + 1.62;
    } else {
      [ex, ey, ez] = pose.from;
    }
    e.camera.position.set(ex, ey, ez);
    e.camera.lookAt(new V3(pose.to[0], pose.to[1], pose.to[2]));
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    return { eye: [+ex.toFixed(2), +ey.toFixed(2), +ez.toFixed(2)] };
  }, p);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${p.id}.png` });
  console.log(`${OUT}/${p.id}.png  eye ${info.eye.join(', ')}`);
}
if (errs.length) console.log('PAGE ERRORS', errs);
await browser.close();
