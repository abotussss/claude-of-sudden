/**
 * THE THREE THINGS THIS PASS TOUCHED, PHOTOGRAPHED AT NIGHT.
 *
 *   node _nfeye.mjs [--url=…] [--out=shots/nfeye]
 *
 * A brightness claim and a geometry claim are both only as good as the frame
 * that shows them, and this map is lit at 21:40 — the one gate a number cannot
 * stand in for. `?map=plains&capture=1`, and `world.level.id` is checked at the
 * far end because a screenshot of the wrong map is the most convincing wrong
 * evidence there is.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4600/?map=plains&capture=1';
const OUT = args.out ?? 'shots/nfeye';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level=${level}  out=${OUT}`);
if (level !== 'plains') { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('ui')?.debugState?.('clean');
  const pl = e.ctx.peek('player');
  if (pl) pl.applyDamage = () => {};
});
const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

/**
 * THE ROUND HAS TO BE LIVE FIRST. WARMUP and FREEZE keep snapping the player
 * back to a spawn, and the camera follows the player — the first run of this
 * probe produced a photograph of the north base captioned "the barrack shed".
 */
await page.evaluate(() => (window.__ENGINE__.time.scale = 6));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  window.__ENGINE__.time.scale = 1;
});

/** `eye` over whatever is under `from`; `free` puts the camera at an absolute y. */
const place = (from, at, eye, free) => page.evaluate(([f, a, eye, free]) => {
  const e = window.__ENGINE__, phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  let y = free;
  if (y === null) {
    const h = phys.raycast(f[0], 300, f[1], 0, -1, 0, 400, phys.MASK.WORLD);
    y = (h.hit ? h.point.y : 0) + eye;
  }
  e.camera.position.set(f[0], y, f[1]);
  e.camera.lookAt(new V3(a[0], a[1], a[2]));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  return +y.toFixed(2);
}, [from, at, eye, free ?? null]);

const SHOTS = [
  // the control tower, whole, from the ground — the six minutes every match
  // starts by looking at this
  ['tower-whole', [-46, -70], [0, 26, -32], 1.62, null],
  // …and the cab and the mast, close, which is where the four props are
  ['tower-cab', [-22, -32], [0, 34, -32], 1.62, 26],
  ['tower-cabroof', [-13, -40], [0, 34.4, -32], 1.62, 42],
  // the fortress wall foot: the plinth that was 0.57 m proud and is now 0.41
  ['fort-plinth', [-38, 44], [-30, 1.2, 50], 1.62, null],
  ['fort-plinth-close', [-34.4, 47], [-31.0, 3.4, 47.6], 1.62, null],
  ['fort-north', [0, 84], [0, 4.5, 56], 1.62, null],
  // the barrack shed, outside and in
  ['shed-outside', [-3, 68], [-13, 2.0, 60], 1.62, null],
  ['shed-door', [-6.5, 57.5], [-13, 1.5, 60], 1.62, null],
  ['shed-inside', [-14.5, 60.5], [-8.0, 4.6, 58.0], 1.62, 4.85],
  // the horizontal concrete the brightness question is about
  ['fort-courtyard', [-6, 62], [2, 4.4, 34], 1.62, null],
  ['fort-walk', [-27, 40], [-27, 4.6, 66], 5.6, null],
];

for (const [name, from, at, eye, free] of SHOTS) {
  const y = await place(from, at, eye, free);
  await frames(45);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  · ${name}.png   eye y ${y}`);
}
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 4).join(' | ')}` : '\n0 pageerrors');
await b.close();
