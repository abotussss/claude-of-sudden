/**
 * WHAT THE FRAME A BUILDING COMES DOWN ON ACTUALLY COSTS.
 *
 *   node _democost.mjs [--url=http://127.0.0.1:4252/]
 *
 * Nothing is screenshotted and nothing is stepped by hand: the page runs its own
 * loop, a rAF sampler records every frame's duration, the strike is fired from a
 * rAF callback so it lands INSIDE a frame rather than between two, and the frame
 * it landed on is reported against the distribution of the 200 frames round it.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const URL = args.url ?? 'http://127.0.0.1:4252/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await p.evaluate(async () => {
  const e = window.__ENGINE__;
  const st = e.ctx.peek('match').airstrike;
  st.enabled = false;
  const ft = [];
  let last = performance.now();
  let n = 0;
  const marks = {};
  const order = ['NW6', 'NW1', 'WC6', 'SE6', 'SE1', 'EC6'];
  let k = 0;
  await new Promise((done) => {
    const tick = (t) => {
      ft.push(t - last); last = t; n++;
      // one building every 120 frames, fired from inside the frame
      if (n > 120 && n % 120 === 0 && k < order.length) {
        const s = st.sites.find((x) => x.id === order[k]);
        if (s && !s.struck) { marks[order[k]] = { frame: n, chunks: s.chunkCount }; st.fire(s.index); }
        k++;
      }
      if (n >= 120 * (order.length + 2)) return done();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const rows = [];
  for (const id of order) {
    const m = marks[id]; if (!m) continue;
    const i = m.frame;
    const nb = ft.slice(Math.max(0, i - 100), i - 1).concat(ft.slice(i + 2, i + 101));
    rows.push({
      id, chunks: m.chunks,
      fire: +ft[i].toFixed(2),
      next: +ft[i + 1].toFixed(2),
      nbMedian: +pct(nb, 0.5).toFixed(2),
      nbP95: +pct(nb, 0.95).toFixed(2),
      nbMax: +Math.max(...nb).toFixed(2),
    });
  }
  return { rows, frames: n, median: +pct(ft, 0.5).toFixed(2) };
});
console.log(`[demofcost] ${out.frames} frames, median frame ${out.median} ms`);
console.log('  site   chunks   fire frame   next frame | neighbours median / p95 / max');
for (const r of out.rows) {
  console.log(`  ${r.id.padEnd(6)} ${String(r.chunks).padStart(5)}   ${String(r.fire).padStart(8)}   ${String(r.next).padStart(9)} | ${String(r.nbMedian).padStart(6)} / ${String(r.nbP95).padStart(6)} / ${String(r.nbMax).padStart(6)}`);
}
if (errs.length) console.log('PAGE ERRORS', errs);
await b.close();
