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
  const ph = window.__ENGINE__.ctx.peek('physics');
  /**
   * How far the real floor sits BELOW the analytic plain. `plainsY` does not
   * know about the trenches — the terrain mesh has the corridors cut out of it
   * and `plains-trench.stripMesh` lays the section in — so collision minus
   * analytic IS the depth of the cut, and a run of it along a walk is a covered
   * route that the straight-line probe cannot see.
   */
  const depth = (x, z) => {
    const h = ph.raycast(x, 300, z, 0, -1, 0, 400, ph.MASK.WORLD);
    if (!h.hit) return 0;
    return (w.groundHeight ? w.groundHeight(x, z) : 0) - h.point.y;
  };
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
    let cut = '';
    let deepest = 0, deepAt = 0;
    for (let o = -16; o <= 16; o += 2) {
      const x = ax + tx * s + nx * o, z = az + tz * s + nz * o;
      line += w.isOpen(x, z, 4.5) ? '.' : '#';
      const d = depth(x, z);
      if (d > deepest) { deepest = d; deepAt = o; }
      // a man is hidden standing in anything over 1.7 m, crouched over 1.1
      cut += d > 1.7 ? 'X' : d > 1.1 ? 'x' : d > 0.5 ? '-' : '.';
    }
    rows.push(`${String(Math.round(s)).padStart(4)} ${line}   ${cut}  ${deepest > 0.5
      ? `deepest ${deepest.toFixed(1)}m at ${deepAt > 0 ? '+' : ''}${deepAt}` : ''}`);
  }
  return { L: Math.round(L), rows };
}, { route: args.route ?? 'BASE-N,E' });
console.log(`route ${args.route ?? 'BASE-N,E'}  len=${out.L}   ('.' = isOpen(margin 4.5), columns are -16..+16 m across the walk)`);
console.log('   s   isOpen(4.5m margin)      depth of cut (X>1.7m  x>1.1m  ->0.5m)');
for (const r of out.rows) console.log(r);
await b.close();
