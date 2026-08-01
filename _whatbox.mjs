/**
 * WHAT IS THE SOLID AT THIS WORLD COORDINATE?
 *
 *   node _whatbox.mjs --at=47.7,13.3 --r=7 --y=8,11 [--flags=demo=down] [--seed=12]
 *
 * `_boxdump.mjs` filters `?boxtag` in LEVEL space, which is a different frame
 * per building. Every sweep on this map — `_floatcheck` above all — reports
 * WORLD coordinates, so this one filters on the world centre `Assembler._tag`
 * now records, and prints the authoring line and the scope.
 *
 * Needs the DEV server, so the stacks name a file rather than a minified chunk.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true];
}));
const URL = args.url ?? 'http://127.0.0.1:4345/';
const R = Number(args.r ?? 6);
const yr = String(args.y ?? '-2,14').split(',').map(Number);
/** `x,z[,r[,y0,y1]]` separated by `;` — one boot answers the whole sweep. */
const pts = String(args.pts ?? args.at ?? '0,0').split(';').map((s) => {
  const n = s.split(',').map(Number);
  return { at: [n[0], n[1]], r: n[2] ?? R, yr: [n[3] ?? yr[0], n[4] ?? yr[1]] };
});
const q = [];
if (args.seed) q.push(`seed=${args.seed}`);
if (args.flags) q.push(...String(args.flags).split(','));
q.push('boxtag');

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('  pageerror', String(e.message).slice(0, 200)));
await page.goto(`${URL}?${q.join('&')}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const out = await page.evaluate(({ pts }) => {
  const w = window.__ENGINE__.ctx.peek('world');
  const tag = w.A?.constructor?.TAG;
  if (!tag) return { err: 'Assembler.TAG not armed' };
  const sets = pts.map(() => []);
  for (const b of tag) {
    if (b.wx === undefined) return { err: 'TAG has no world centre — old build' };
    const hx = Math.abs(b.sx * Math.cos(b.wry)) / 2 + Math.abs(b.sz * Math.sin(b.wry)) / 2;
    const hz = Math.abs(b.sx * Math.sin(b.wry)) / 2 + Math.abs(b.sz * Math.cos(b.wry)) / 2;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (b.wx + hx < p.at[0] - p.r || b.wx - hx > p.at[0] + p.r) continue;
      if (b.wz + hz < p.at[1] - p.r || b.wz - hz > p.at[1] + p.r) continue;
      if (b.wy + b.sy / 2 < p.yr[0] || b.wy - b.sy / 2 > p.yr[1]) continue;
      const line = String(b.at).split('\n').slice(1)
        .map((s) => s.trim())
        .find((s) => !/builder\.js/.test(s)) ?? '?';
      sets[i].push({
        k: b.k, s: b.surface, scope: b.scope,
        x: +b.wx.toFixed(2), y: +b.wy.toFixed(2), z: +b.wz.toFixed(2),
        sx: +b.sx.toFixed(2), sy: +b.sy.toFixed(2), sz: +b.sz.toFixed(2),
        top: +(b.wy + b.sy / 2).toFixed(2), bot: +(b.wy - b.sy / 2).toFixed(2),
        ry: +b.wry.toFixed(2),
        src: line.replace(/^at\s+/, '').replace(/https?:\/\/[^/]+\//, ''),
      });
    }
  }
  return { total: tag.length, sets };
}, { pts });

if (out.err) { console.log(out.err); await browser.close(); process.exit(2); }
console.log(`\n  ${out.total} proxies total`);
for (let i = 0; i < pts.length; i++) {
  const p = pts[i];
  const rows = out.sets[i];
  console.log(`\n── ${rows.length} within ${p.r} m of world [${p.at}] y [${p.yr}]`);
  rows.sort((a, b) => b.top - a.top);
  for (const r of rows.slice(0, Number(args.max ?? 30))) {
    console.log(`  ${r.k.padEnd(4)} ${r.s.padEnd(9)} c[${String(r.x).padStart(8)},${String(r.y).padStart(6)},${String(r.z).padStart(8)}] ` +
      `s[${String(r.sx).padStart(6)},${String(r.sy).padStart(6)},${String(r.sz).padStart(6)}] ` +
      `bot ${String(r.bot).padStart(6)} top ${String(r.top).padStart(6)}  ${String(r.scope ?? '-').padEnd(14)} ${r.src}`);
  }
  if (rows.length > Number(args.max ?? 30)) console.log(`  … and ${rows.length - Number(args.max ?? 30)} more`);
}
await browser.close();
