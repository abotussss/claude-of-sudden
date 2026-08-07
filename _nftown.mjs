/**
 * Which of the town's lights was holding a stale registration intensity, and how
 * far did the frame move when the culler stopped writing it back?
 *
 *   node _nftown.mjs [url]
 *
 * `_cullLights` cached `baseIntensity` at `addLight` time and, on the first
 * frame only, wrote that cache over whatever the owner had set since. Any light
 * registered BEFORE its real value is known was therefore wrong for one frame.
 * This lists every registered light whose live intensity differs from the value
 * it was registered with, which is exactly that set.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4603/?map=town&capture=1';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await p.evaluate(() => new Promise((d) => { let i = 0; const t = () => (++i > 120 ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }));

console.log(JSON.stringify(await p.evaluate(() => {
  const e = window.__ENGINE__, r = e.ctx.peek('render'), sky = e.ctx.peek('sky');
  const odd = r.lights
    .map((l) => ({ name: l.light.name || l.light.type, range: l.range, base: +l.baseIntensity.toFixed(4), applied: +(l.applied ?? -1).toFixed(4), live: +l.light.intensity.toFixed(4) }))
    .filter((l) => Math.abs(l.base - l.live) > 1e-4 || l.name.startsWith('sky-'));
  let exp = null; try { exp = r.debugExposure(); } catch (x) { exp = null; }
  return {
    level: e.ctx.peek('world').level.id, hour: sky?.hour,
    nLights: r.lights.length, activeSun: r.activeSun?.name,
    activeSunI: +(r.activeSun?.intensity ?? -1).toFixed(4),
    fallbackVisible: r.sun?.visible, notable: odd, exp,
  };
}), null, 1));
console.log(errs.length ? `PAGEERRORS(${errs.length}) ${errs[0]}` : '0 pageerrors');
await b.close();
