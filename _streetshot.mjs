/**
 * STREET PHOTOGRAPHY FOR THE SET DRESSING — 「壊すためだけのオブジェが多いので…
 * 露骨ではなく自然にマップに溶け込ませて」. Fixed LEVEL-space poses down the lanes
 * and the courtyards, where the scatter actually lives, so a before/after pair
 * is the same six frames of the same six places.
 *
 *   node _streetshot.mjs [--url=…] [--seed=N] --out=dir
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)];
  })
);
const BASE = args.url ?? 'http://127.0.0.1:4422/';
const OUT = args.out ?? '/tmp/street';
mkdirSync(OUT, { recursive: true });
const url = BASE + '?seed=' + (args.seed ?? 11);

/** [label, stand (authored level x,z), look-at (authored level x,z)] */
const POSES = [
  ['a-lane-north', [-25.5, 14], [-25.5, 30]],
  ['a-lane-south', [-25.5, -16], [-25.5, -26]],
  ['b-lane-north', [25.5, 14], [25.5, 30]],
  ['courtyard-C', [-40, -4], [-46, -1]],
  ['connector-2', [-13, -4.5], [-3, -4.5]],
  ['cross-street-n', [-18, 28], [-30, 28]],
];

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  ai.combatEnabled = false;
  ai.protect(e.ctx.peek('player'), 9999);
  // Noon, so a before/after pair is not two different times of day.
  const sky = e.ctx.peek('sky');
  if (sky && 'timeOfDay' in sky) sky.timeOfDay = 11.0;
});
await page.waitForTimeout(600);

for (const [label, at, to] of POSES) {
  await page.evaluate(([at, to]) => {
    const e = window.__ENGINE__;
    const w = e.ctx.peek('world');
    const p = e.ctx.peek('player');
    const ai = e.ctx.peek('ai');
    const V3 = p.movement.position.constructor;
    const S = w.layout.SCALE;
    const a = w.levelToWorld(at[0] * S, 0, at[1] * S, new V3());
    const t = w.levelToWorld(to[0] * S, 0, to[1] * S, new V3());
    const g = ai.grid;
    const ci = g.nearest(a.x, a.z, 0, 6, 4);
    const eye = ci >= 0 ? new V3(g.worldX(ci % g.nx), g.floor[ci], g.worldZ((ci / g.nx) | 0)) : a;
    p.movement.yaw = Math.atan2(t.x - eye.x, -(t.z - eye.z));
    p.movement.pitch = 0.06;
    p.movement.velocity.set(0, 0, 0);
    p.movement.teleport(eye.x, eye.y + 0.05, eye.z);
  }, [at, to]);
  await page.waitForTimeout(850);
  await page.screenshot({ path: `${OUT}/${label}.png` });
  console.log(`${OUT}/${label}.png`);
}
if (errs.length) console.log('PAGE ERRORS', errs.slice(0, 4));
await browser.close();
