/**
 * WHERE CAN A MAN ACTUALLY STAND AND WATCH THIS, at 30 m, 150 m and as far
 * away as this map allows?
 *
 *   node _sfstand.mjs [--url=…]
 *
 * The detonation has to read at every range a player can be at, so the ranges
 * have to be MEASURED off the walkable disc rather than named: the carrier's
 * first contact is 83 m from the map origin and the plain is a 176 m disc, so
 * "300 m" is not a place — the farthest a man can stand from the impact is
 * reported here rather than assumed.
 *
 * For every candidate: the ground height, the range to first contact, whether
 * the nav grid says a man can stand there, whether it is inside the fire, and
 * `physics.lineOfSight` to a point 20 m over the impact (the fireball's own
 * height), because on a map with a 44 m tower and a 72 m fortress "open plain"
 * is a measurement.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4639/?map=plains&capture=1';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const r = await p.evaluate(() => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics'), ai = e.ctx.peek('ai');
  const s = e.ctx.peek('match').crash._sky;
  const g = ai.grid;
  /** First contact, from the file's own track. */
  const I = [s.impact.x - 0, s.impact.z];
  const A = [-65.1, -51.8];
  const walk = (x, z) => {
    const i = g.nearest(x, z, ph.groundHeight(x, z, 400), 3, 3);
    return i >= 0;
  };
  const test = (x, z) => {
    const gy = ph.groundHeight(x, z, 400);
    const from = { x, y: gy + 1.7, z };
    const to = { x: A[0], y: ph.groundHeight(A[0], A[1], 400) + 20, z: A[1] };
    return {
      x: +x.toFixed(0), z: +z.toFixed(0), ground: +gy.toFixed(1),
      d: +Math.hypot(x - A[0], z - A[1]).toFixed(0),
      los: ph.lineOfSight ? !!ph.lineOfSight(from, to, ph.MASK.WORLD) : null,
      inside: s._inside(x, z), walk: walk(x, z),
      rad: +Math.hypot(x, z).toFixed(0),
    };
  };
  const rows = [];
  let far = null;
  for (let deg = 0; deg < 360; deg += 10) {
    const a = deg * Math.PI / 180;
    const dx = Math.cos(a), dz = Math.sin(a);
    for (const R of [30, 150, 200, 240, 260]) {
      const x = A[0] + dx * R, z = A[1] + dz * R;
      if (Math.hypot(x, z) > 172) continue;
      const t = test(x, z);
      t.bearing = deg;
      t.R = R;
      if (t.walk && t.los && !t.inside) {
        rows.push(t);
        if (!far || t.d > far.d) far = t;
      }
    }
  }
  return {
    impact: [+A[0].toFixed(1), +A[1].toFixed(1)], rest: [+s.impact.x.toFixed(1), +s.impact.z.toFixed(1)],
    centre: [+s.centre.x.toFixed(1), +s.centre.z.toFixed(1)],
    rows, far, n: rows.length,
    named: [[0, 0], [-118, -104], [-128, 86], [128, -86], [118, 104], [-14, -150], [14, 150], [-40, -40], [-30, 30], [60, 60], [100, 40]].map(([x, z]) => test(x, z)),
  };
});
console.log('first contact', r.impact, '· wreck at rest', r.rest, '· region centre', r.centre);
console.log('\nnamed points (zones, spawns, the old vantages):');
for (const o of r.named) console.log(`  (${String(o.x).padStart(5)},${String(o.z).padStart(5)})  ground ${String(o.ground).padStart(5)}  ${String(o.d).padStart(4)} m from contact  los=${o.los} walk=${o.walk} inside=${o.inside}`);
console.log(`\n${r.n} clear standing points on the ring scan. Farthest:`, r.far);
for (const R of [30, 150, 200, 240, 260]) {
  const c = r.rows.filter((o) => o.R === R);
  console.log(`  R=${R}: ${c.length} clear — ${c.slice(0, 8).map((o) => `(${o.x},${o.z})@${o.bearing}deg`).join(' ')}`);
}
await b.close();
