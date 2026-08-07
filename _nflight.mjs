/**
 * ════════════════════════════════════════════════════════════════════════════
 * HOW BRIGHT IS THE HORIZONTAL CONCRETE, AND WHOSE FAULT IS IT?
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nflight.mjs [--url=…] [--out=shots/nflight] [--shots]
 *
 * 「the courtyard and the rampart walk still read bright under this map's moon」
 * is an opinion until somebody puts a number on it, and the two candidate faults
 * need DIFFERENT fixes: a surface that is too pale is a palette change in
 * `src/world`, and a map that is metered too high is `hour`, `weather` or
 * `setExposureBias` — and this map has already had one lighting catastrophe from
 * the second kind (a 2 200 m far range outside every cascade, out of the height
 * fog, which the auto-exposure metered on and took the plain to black).
 *
 * So this measures both, and it does not sample hand-drawn rectangles.
 *
 *   1. THE FRAME. A camera is placed, the shutter pressed, and the PNG read.
 *   2. WHAT EVERY PIXEL IS. The same grid of pixels is unprojected and fired
 *      into the physics world, so each sample carries the NAME OF THE MERGED
 *      BATCH it hit (which is the palette key), its distance, and its normal.
 *      Up-facing (ny > 0.8) and vertical (ny < 0.4) are counted apart, because
 *      the whole complaint is about up-facing faces.
 *   3. THE LIGHTING. Moon and sun intensity and colour off `sky`, the auto
 *      exposure scalar and its EV100 read straight out of the 1x1 float target,
 *      and the limits it is clamped between.
 *
 * THE DISCRIMINATOR is the RATIO between two surfaces in the SAME frame under
 * the same exposure. Exposure is one scalar over the whole image: it cannot make
 * the courtyard bright and leave the plain beside it dark. So if the concrete
 * sits far above the ground next to it, that is the surface; if the two move
 * together and the whole frame is lifted, that is the exposure.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4600/?map=plains&capture=1';
const OUT = args.out ?? 'shots/nflight';
mkdirSync(OUT, { recursive: true });

const W = 1280, H = 720;
/** Every Nth pixel, both axes — 128x72 = 9216 rays per frame. */
const STEP = 10;

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: W, height: H } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level=${level}`);
if (level !== 'plains' && !args.town) { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('ui')?.debugState?.('clean');
  const pl = e.ctx.peek('player');
  if (pl) { pl.applyDamage = () => {}; }
});
const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

const lighting = () => page.evaluate(() => {
  const e = window.__ENGINE__;
  const sky = e.ctx.peek('sky');
  const r = e.ctx.peek('render') ?? e.render ?? e.ctx.peek('renderer');
  let exp = null;
  try { exp = r.debugExposure(); } catch (err) { exp = { error: String(err.message) }; }
  const col = (l) => l ? [+l.color.r.toFixed(3), +l.color.g.toFixed(3), +l.color.b.toFixed(3)] : null;
  return {
    hour: sky?.hour ?? null,
    sun: { i: +(sky?.sunLight?.intensity ?? 0).toFixed(4), c: col(sky?.sunLight) },
    moon: { i: +(sky?.moonLight?.intensity ?? 0).toFixed(4), c: col(sky?.moonLight) },
    indirect: sky?.indirect ?? null,
    exposureBias: sky?.exposureBias ?? null,
    toneMapping: r?.renderer?.toneMapping ?? null,
    exp,
  };
});

/** Stand at a world point, look at another, feet on whatever is under it. */
const place = (from, at, eye = 1.62) => page.evaluate(([f, a, eye]) => {
  const e = window.__ENGINE__, phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const h = phys.raycast(f[0], 300, f[1], 0, -1, 0, 400, phys.MASK.WORLD);
  const y = (h.hit ? h.point.y : 0) + eye;
  e.camera.position.set(f[0], y, f[1]);
  e.camera.lookAt(new V3(a[0], a[1], a[2]));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  return +y.toFixed(2);
}, [from, at, eye]);

/** What is behind every sampled pixel: batch name, distance, floor normal. */
const classify = (step) => page.evaluate((step) => {
  const e = window.__ENGINE__, phys = e.ctx.peek('physics');
  const cam = e.camera;
  const V3 = cam.position.constructor;
  const w = window.innerWidth, h = window.innerHeight;
  const out = [];
  const v = new V3();
  for (let py = 0; py < h; py += step) {
    for (let px = 0; px < w; px += step) {
      v.set((px / w) * 2 - 1, -((py / h) * 2 - 1), 0.5).unproject(cam).sub(cam.position).normalize();
      const hit = phys.raycast(cam.position.x, cam.position.y, cam.position.z, v.x, v.y, v.z, 500, phys.MASK.WORLD);
      out.push(hit.hit
        ? [px, py, hit.object?.name ?? '(batch)', +hit.distance.toFixed(1), +hit.normal.y.toFixed(2)]
        : [px, py, '(sky)', -1, 0]);
    }
  }
  return out;
}, step);

/** sRGB -> relative linear luminance. */
const lin = (u) => { const c = u / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

function report(name, samples, png) {
  const by = new Map();
  for (const [px, py, key, dist, ny] of samples) {
    if (px >= png.width || py >= png.height) continue;
    const o = (py * png.width + px) * 4;
    const L = 0.2126 * lin(png.data[o]) + 0.7152 * lin(png.data[o + 1]) + 0.0722 * lin(png.data[o + 2]);
    const face = key === '(sky)' ? 'sky' : ny > 0.8 ? 'up' : ny < 0.4 ? 'vertical' : 'raked';
    const k = `${key}|${face}`;
    let e = by.get(k);
    if (!e) by.set(k, (e = { key, face, n: 0, sum: 0, max: 0, sumSrgb: 0 }));
    e.n++; e.sum += L; e.sumSrgb += (png.data[o] + png.data[o + 1] + png.data[o + 2]) / 3;
    if (L > e.max) e.max = L;
  }
  const rows = [...by.values()].filter((e) => e.n >= 12).sort((a, c) => c.sum / c.n - a.sum / a.n);
  console.log(`\n  ${name} — mean rendered luminance per surface (${samples.length} rays)`);
  console.log('    surface                          face       px      mean L    mean sRGB   peak L');
  for (const e of rows) {
    console.log(
      `    ${e.key.slice(0, 32).padEnd(32)} ${e.face.padEnd(9)} ${String(e.n).padStart(6)}   ` +
        `${(e.sum / e.n).toFixed(4).padStart(8)}   ${(e.sumSrgb / e.n).toFixed(1).padStart(9)}   ${e.max.toFixed(4)}`
    );
  }
  return rows;
}

console.log('\n  LIGHTING:', JSON.stringify(await lighting(), null, 0));

const CAMS = [
  ['courtyard', [-6, 62], [2, 4.4, 34], 1.62],
  ['rampart', [-27, 40], [-27, 4.6, 66], 5.6],
  ['plain-vs-wall', [0, 92], [0, 4.0, 60], 1.62],
  ['tower-deck', [0, -49], [0, 8.0, -32], 1.62],
];
for (const [name, from, at, eye] of CAMS) {
  const y = await place(from, at, eye);
  await frames(40);
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path });
  const samples = await classify(STEP);
  const png = PNG.sync.read(readFileSync(path));
  console.log(`\n  === ${name} — eye y ${y} ===  ${path}`);
  report(name, samples, png);
}

console.log('\n  LIGHTING (settled):', JSON.stringify(await lighting(), null, 0));
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 4).join(' | ')}` : '\n0 pageerrors');
await b.close();
