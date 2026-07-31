/**
 * WHAT DOES A DISTRICT SALVO COST ON THE FRAME IT LANDS? — measured against its
 * own neighbouring frames rather than against a budget.
 *
 *   node _salvocost.mjs [url]
 *
 * `DISTRICT-A` is three whole blocks, staggered 0.55 s apart, and each one
 * settling is a frame on which `world.demolitions[].down` moves and `ai` has to
 * bring its cover table up to the town. This records every frame's wall time,
 * marks the frames the flags changed on, and prints them beside the ten frames
 * either side.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4257/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('[salvocost] ready');

await page.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const ai = e.ctx.peek('ai');
  const rec = { t: [], mask: [], sync: [] };
  window.__FT = rec;
  let last = performance.now();
  // Piggy-back on rAF: this runs in the same frame callback queue as the engine
  // loop, so the delta it sees is the frame the engine just spent.
  const tick = () => {
    const now = performance.now();
    rec.t.push(now - last);
    last = now;
    let m = 0;
    for (let i = 0; i < w.demolitions.length; i++) if (w.demolitions[i].down) m |= 1 << i;
    rec.mask.push(m);
    rec.sync.push(ai._blockMask ?? -1);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const fired = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const a = m?.airstrike;
  if (!a) return 'no airstrike';
  const s = (a.salvos ?? []).find((x) => x.id === 'DISTRICT-A');
  if (!s) return 'no DISTRICT-A salvo';
  return a.callSalvo(s.index) ? `fired ${s.id} (${s.sites.length} buildings)` : 'callSalvo refused';
});
console.log(`[salvocost] ${fired}`);
await page.waitForTimeout(25000);

const r = await page.evaluate(() => window.__FT);
const marks = [];
for (let i = 1; i < r.mask.length; i++) if (r.mask[i] !== r.mask[i - 1]) marks.push(i);
const sorted = [...r.t].slice(20).sort((a, b) => a - b);
const med = sorted[Math.floor(sorted.length / 2)];
const p95 = sorted[Math.floor(sorted.length * 0.95)];
console.log(
  `[salvocost] ${r.t.length} frames · median ${med.toFixed(1)} ms · p95 ${p95.toFixed(1)} ms` +
    ` · max ${Math.max(...sorted).toFixed(1)} ms`
);
console.log(`[salvocost] frames on which a block's flag moved: ${marks.join(', ') || 'none'}`);
for (const i of marks) {
  const win = [];
  for (let j = i - 3; j <= i + 3; j++) {
    if (j < 0 || j >= r.t.length) continue;
    win.push(`${j === i ? '>>' : '  '}f${j} ${r.t[j].toFixed(1)}ms mask=${r.mask[j]} ai=${r.sync[j]}`);
  }
  console.log(`\n  --- block down on frame ${i} ---\n   ${win.join('\n   ')}`);
}
await browser.close();
