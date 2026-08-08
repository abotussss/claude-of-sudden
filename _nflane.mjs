/**
 * WHY DID NOTHING STAND UP ON THIS WALK?
 *
 *   node _nflane.mjs --url=… --route=BASE-N,E
 *
 * `plains-cover.js` places by SEARCH: it slides a piece along the crossing, then
 * off it, and drops what will not fit. When a route's exposure does not move,
 * the question is always which of the two happened — nothing was placed, or
 * everything was placed twenty metres to the side — and the answer is the
 * level's own `isOpen` sampled across the walk. This prints that band.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto(args.url ?? 'http://127.0.0.1:4604/?map=plains', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const out = await p.evaluate(({ route }) => {
  const w = window.__ENGINE__.ctx.peek('world');
  const P = {
    'BASE-N': [-14, -150], 'BASE-S': [14, 150],
    A: [-118, -104], B: [118, 104], C: [-128, 86], E: [128, -86], D: [0, 0],
  };
  const [aId, bId] = String(route).split(',');
  const [ax, az] = P[aId], [bx, bz] = P[bId];
  const L = Math.hypot(bx - ax, bz - az);
  const tx = (bx - ax) / L, tz = (bz - az) / L;
  const nx = tz, nz = -tx;
  const rows = [];
  for (let s = 12; s <= L - 12; s += 6) {
    let line = '';
    for (let o = -16; o <= 16; o += 2) {
      const x = ax + tx * s + nx * o, z = az + tz * s + nz * o;
      line += w.isOpen(x, z, 4.5) ? '.' : '#';
    }
    rows.push(`${String(Math.round(s)).padStart(4)} ${line}`);
  }
  return { L: Math.round(L), rows };
}, { route: args.route ?? 'BASE-N,E' });
console.log(`route ${args.route ?? 'BASE-N,E'}  len=${out.L}   ('.' = isOpen(margin 4.5), columns are -16..+16 m across the walk)`);
console.log('   s -16            0            +16');
for (const r of out.rows) console.log(r);
await b.close();
