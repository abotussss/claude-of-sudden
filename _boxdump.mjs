/**
 * BOX DUMP — every collision proxy the level authored inside a level-space
 * window, with the source line that authored it.
 *
 *   node _boxdump.mjs --seed=12 --win=60,0,128,95 [--y=2,5]
 *
 * Needs `?boxtag` (a TEMPORARY instrument in src/world/builder.js) and the DEV
 * server, so the stacks name a file instead of a minified chunk.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true];
}));
const URL = args.url ?? 'http://127.0.0.1:4279/';
const SEED = Number(args.seed ?? 12);
const win = String(args.win ?? '60,0,128,95').split(',').map(Number);
const yr = String(args.y ?? '-2,12').split(',').map(Number);

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('  pageerror', String(e.message).slice(0, 160)));
await page.goto(`${URL}?seed=${SEED}&boxtag`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const out = await page.evaluate(({ win, yr }) => {
  const w = window.__ENGINE__.ctx.peek('world');
  const tag = w.A?.constructor?.TAG;
  if (!tag) return { err: 'Assembler.TAG not armed' };
  const rows = [];
  for (const b of tag) {
    const hx = Math.abs(b.sx * Math.cos(b.ry)) / 2 + Math.abs(b.sz * Math.sin(b.ry)) / 2;
    const hz = Math.abs(b.sx * Math.sin(b.ry)) / 2 + Math.abs(b.sz * Math.cos(b.ry)) / 2;
    if (b.cx + hx < win[0] || b.cx - hx > win[2]) continue;
    if (b.cz + hz < win[1] || b.cz - hz > win[3]) continue;
    if (b.cy + b.sy / 2 < yr[0] || b.cy - b.sy / 2 > yr[1]) continue;
    const line = String(b.at).split('\n').slice(1)
      .map((s) => s.trim())
      .find((s) => !/builder\.js/.test(s)) ?? '?';
    rows.push({
      k: b.k, s: b.surface,
      x: +b.cx.toFixed(1), y: +b.cy.toFixed(2), z: +b.cz.toFixed(1),
      sx: +b.sx.toFixed(2), sy: +b.sy.toFixed(2), sz: +b.sz.toFixed(2),
      top: +(b.cy + b.sy / 2).toFixed(2),
      ry: +b.ry.toFixed(2),
      src: line.replace(/^at\s+/, '').replace(/https?:\/\/[^/]+\//, ''),
    });
  }
  return { total: tag.length, rows };
}, { win, yr });

if (out.err) { console.log(out.err); await browser.close(); process.exit(2); }
console.log(`\n  ${out.total} collision boxes total, ${out.rows.length} inside [${win}] y [${yr}]`);
out.rows.sort((a, b) => a.z - b.z || a.x - b.x);
for (const r of out.rows) {
  console.log(`  ${r.k.padEnd(4)} ${r.s.padEnd(10)} c[${String(r.x).padStart(7)},${String(r.y).padStart(6)},${String(r.z).padStart(7)}] ` +
    `s[${String(r.sx).padStart(6)},${String(r.sy).padStart(6)},${String(r.sz).padStart(6)}] ry ${String(r.ry).padStart(6)} top ${String(r.top).padStart(6)}  ${r.src}`);
}
await browser.close();
