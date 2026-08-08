/**
 * WHAT DOES THE TOWER COST ON THE FRAME IT FALLS?
 *
 *   BASE=http://127.0.0.1:4626/ node _tzcost.mjs [NF-TOWER|NF-FORT]
 *
 * `_razecost.mjs` is the town's: it calls `_setCathedralRazed`, and NACHTFELD
 * has no cathedral, so on this map it measures nothing and reports a frame time
 * that has nothing to do with the event. This fires the real thing —
 * `airstrike.callDemolition(id)`, the one call the act's `raze` beat makes.
 *
 * The discipline this project works under is "everything is baked at BOOT and
 * swapped at fire time", so the number that proves it is the length of the frame
 * the swap lands on measured against the frames either side. NF-TOWER is 3 365
 * chunks after this pass and NF-FORT is 610, so running both is the control: if
 * the cost scaled with the chunk count, the two would differ by five and a half.
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4626/';
const ID = process.argv[2] ?? 'NF-TOWER';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${BASE}?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const out = await page.evaluate(async (ID) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const site = m.airstrike.sites.find((s) => s.id === ID);
  const frames = [];
  let sync = -1, settleSync = -1, settleFrame = -1;
  let last = performance.now();
  await new Promise((res) => {
    let n = 0;
    const tick = () => {
      const now = performance.now();
      frames.push(+(now - last).toFixed(2));
      last = now;
      n++;
      if (n === 60) {
        const t0 = performance.now();
        m.airstrike.callDemolition(ID);
        sync = +(performance.now() - t0).toFixed(3);
      }
      // …and the OTHER frame this design has to be honest about: the settle,
      // where the whole settled pose is memcpy'd into the instance matrices.
      if (site.baked && settleFrame < 0) settleFrame = n;
      if (n >= 700) return res();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return { sync, frames, settleFrame, chunks: site.chunkCount, settleSync };
}, ID);

const f = out.frames;
const mean = (a) => +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2);
const before = f.slice(45, 60);
const on = f.slice(60, 63);
const after = f.slice(63, 78);
const settle = out.settleFrame > 0 ? f.slice(out.settleFrame - 1, out.settleFrame + 2) : [];
console.log(`[tzcost] ${ID} — ${out.chunks} chunks`);
console.log(`[tzcost]   the swap call itself, synchronously: ${out.sync} ms`);
console.log(`[tzcost]   15 frames before: mean ${mean(before)} ms   [${before.join(' ')}]`);
console.log(`[tzcost]   the frames it lands on: ${on.join(' ')} ms`);
console.log(`[tzcost]   15 frames after:  mean ${mean(after)} ms   [${after.join(' ')}]`);
if (settle.length) console.log(`[tzcost]   the settle frame (#${out.settleFrame}): ${settle.join(' ')} ms`);
console.log(`[tzcost]   worst frame in the whole 700: ${Math.max(...f)} ms; median ${f.slice().sort((a, c) => a - c)[f.length >> 1]} ms`);
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
