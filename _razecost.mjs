/**
 * WHAT THE RAZE COSTS ON THE FRAME IT FIRES, against its neighbours.
 *
 *   node _razecost.mjs [--url=…]
 *
 * The discipline in this project is "bake at boot, swap at fire time", so the
 * only number that proves it is the length of the frame the swap lands on
 * measured against the frames either side of it. Frame times are sampled from
 * `requestAnimationFrame` deltas with the swap forced on a known frame.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4255/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const w = e.ctx.peek('world');
  const ai = e.ctx.peek('ai');
  const ph = e.ctx.peek('physics');
  const frames = [];
  let fireAt = -1;
  let last = performance.now();
  await new Promise((res) => {
    let n = 0;
    const tick = () => {
      const now = performance.now();
      frames.push(+(now - last).toFixed(2));
      last = now;
      n++;
      if (n === 40) {
        // the swap, on its own frame, timed on its own clock as well
        const t0 = performance.now();
        if (typeof m?._setCathedralRazed === 'function') m._setCathedralRazed(true);
        else w?.cathedral?.setRazed?.(true, ph);
        fireAt = +(performance.now() - t0).toFixed(3);
      }
      if (n >= 70) return res();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return {
    fireAt,
    frames,
    coverLive: ai.cover?.points?.length ?? 0,
    hasRuinTable: !!ai.coverRuin,
  };
});
await browser.close();

const f = out.frames;
const before = f.slice(30, 40);
const on = f.slice(40, 42);
const after = f.slice(42, 52);
const mean = (a) => +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2);
console.log(`[razecost] synchronous cost of the swap call itself: ${out.fireAt} ms`);
console.log(`[razecost] frames before  (10): ${before.join(' ')}  mean ${mean(before)} ms`);
console.log(`[razecost] the two frames it lands on: ${on.join(' ')} ms`);
console.log(`[razecost] frames after   (10): ${after.join(' ')}  mean ${mean(after)} ms`);
console.log(`[razecost] live cover points ${out.coverLive} · ruin table present: ${out.hasRuinTable}`);
if (errs.length) console.log('pageerrors:', errs.slice(0, 5));
