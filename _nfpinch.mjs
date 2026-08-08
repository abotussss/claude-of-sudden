/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT IS STANDING IN THE TANK LANE AT (x, z)?
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfpinch.mjs [--url=…] --at=-56,-49 [--r=16]
 *
 * `_bakePath` reports `pinch 2.5m at sample 39 (-56,-49)` and stops there, which
 * names the place and not the thing. Adding trenches to this map cannot pinch a
 * lane twenty metres away with the CUT — `STRIP_R` is 11.5 — but it can do it at
 * one remove: `trenchKeepOut()` feeds `inWorks`, `plainsOpen` answers with it,
 * and `plains-cover.js` places every wreck and revetment against that answer. So
 * a post dug anywhere reshuffles the cover EVERYWHERE, and the question is which
 * of the two it was.
 *
 * This drops a ray per 0.5 m over a box round the point and prints every solid
 * top over the ground, so the same command run against two builds says what
 * changed and by how much.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4624/?map=plains';
const AT = String(args.at ?? '-56,-49').split(',').map(Number);
const R = Number(args.r ?? 16);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id=' + await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id));

const out = await p.evaluate(({ AT, R }) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const lvl = e.ctx.peek('world').level;
  const rows = [];
  for (let dz = -R; dz <= R; dz += 1) {
    let row = '';
    for (let dx = -R; dx <= R; dx += 1) {
      const x = AT[0] + dx, z = AT[1] + dz;
      const g = ph.groundHeight(x, z);
      const a = lvl.plainsY(x, z);
      const up = g - a;
      row += !Number.isFinite(g) ? '?' : up > 1.5 ? '#' : up > 0.6 ? '+' : up > 0.2 ? ':' : up < -0.8 ? 'v' : '.';
    }
    rows.push(String(AT[1] + dz).padStart(5) + ' ' + row);
  }
  /** The tallest solid inside the box, and where. */
  let top = 0, at = null;
  for (let dz = -R; dz <= R; dz += 0.5) {
    for (let dx = -R; dx <= R; dx += 0.5) {
      const x = AT[0] + dx, z = AT[1] + dz;
      const g = ph.groundHeight(x, z);
      const a = lvl.plainsY(x, z);
      if (Number.isFinite(g) && g - a > top) { top = g - a; at = [+x.toFixed(1), +z.toFixed(1)]; }
    }
  }
  return { rows, top: +top.toFixed(2), at };
}, { AT, R });

console.log(`\n  ground relative to the analytic plain, 1 m per char, centre (${AT})`);
console.log('  "#" >1.5 m up   "+" >0.6   ":" >0.2   "v" >0.8 DOWN (a cut)   "." at grade\n');
for (const r of out.rows) console.log(r);
console.log(`\n  tallest solid in the box: ${out.top} m above the plain at (${out.at})`);
await b.close();
