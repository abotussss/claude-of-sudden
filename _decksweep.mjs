/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHERE THE STREETS ACTUALLY ARE — the sweep `bomber.js`'s tables are argued
 * from, re-run against the map as it stands today
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _decksweep.mjs [--url=…] [--axis=x|z] [--from=-70] [--to=70]
 *                       [--at=4,30] [--step=0.5]
 *
 * `src/match/bomber.js` and `src/match/strafe.js` both quote a "3 m roof-height
 * sweep" that gave four open corridors, and both have been logging ever since
 * that two of the four (`ALANE`, `BLANE`) put four of five bombs 6.5-9.5 m over
 * the outdoor deck — i.e. on a permanent roof. The sweep they quote is older
 * than `widenX`, which moved every building row 9 authored units outward and
 * left the two lane lines standing where the row now is.
 *
 * This is that sweep, run live. For each candidate line (an x, swept in z, or
 * a z, swept in x) it reports the WORST height over `world.groundHeight` —
 * `physics.groundHeight` is what a bomb lands on, `world.groundHeight` is the
 * outdoor deck under it, and the difference is exactly "how much building is
 * standing here". A corridor is a run of candidates whose worst is ~0.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4609/';
const AXIS = args.axis ?? 'x';
const FROM = Number(args.from ?? -70);
const TO = Number(args.to ?? 70);
const STEP = Number(args.step ?? 0.5);
const [A0, A1] = String(args.at ?? '4,30').split(',').map(Number);
const TOL = Number(args.tol ?? 1.0);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const level = await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id);

const rows = await p.evaluate(([AXIS, FROM, TO, STEP, A0, A1]) => {
  const e = window.__ENGINE__;
  const phys = e.ctx.peek('physics');
  const world = e.ctx.peek('world');
  const V = new (e.camera.position.constructor)();
  const out = [];
  for (let c = FROM; c <= TO + 1e-6; c += STEP) {
    let worst = -1e9;
    let worstAt = 0;
    let n = 0;
    for (let a = A0; a <= A1 + 1e-6; a += 1) {
      const lx = AXIS === 'x' ? c : a;
      const lz = AXIS === 'x' ? a : c;
      /**
       * THE SWEEP IS IN LEVEL SPACE, WHICH ON THE TOWN IS NOT WORLD SPACE.
       * `town.js` declares `yaw: 0.5877` (33.7 degrees), so a world-space x
       * sweep crosses every street diagonally and reports the worst of a
       * building on the way — which is the first thing this probe measured and
       * why it found two 3 m 'corridors' in a town with four streets in it.
       * The tables in `bomber.js` / `strafe.js` are authored in the same
       * level space and go through the same transform, so this is exactly
       * their coordinate.
       */
      const w = world.levelToWorld(lx, 0, lz, V);
      const x = w.x, z = w.z;
      const h = phys.groundHeight(x, z, 60);
      const deck = world.groundHeight(x, z);
      const over = (Number.isFinite(h) ? h : deck) - deck;
      if (over > worst) { worst = over; worstAt = a; }
      n++;
    }
    out.push({ c: +c.toFixed(2), worst: +worst.toFixed(2), at: worstAt, n });
  }
  return out;
}, [AXIS, FROM, TO, STEP, A0, A1]);

console.log(`level=${level}  LEVEL-SPACE sweep: ${AXIS} ${FROM}..${TO}, ${AXIS === 'x' ? 'z' : 'x'} ${A0}..${A1}  (these are L() coordinates x 1.5 on the town)`);
/** Contiguous runs whose worst height over the deck is under 1 m: the streets. */
let run = null;
const bands = [];
for (const r of rows) {
  if (r.worst < TOL) { if (!run) run = { a: r.c, b: r.c, w: r.worst }; else { run.b = r.c; run.w = Math.max(run.w, r.worst); } }
  else if (run) { bands.push(run); run = null; }
}
if (run) bands.push(run);
console.log(`  open corridors (worst < ${TOL} m over the deck):`);
for (const s of bands) {
  if (s.b - s.a < 1.5) continue;
  console.log(`    ${AXIS} ${s.a.toFixed(1)} .. ${s.b.toFixed(1)}  (${(s.b - s.a).toFixed(1)} wide, worst ${s.w.toFixed(2)} m, centre ${((s.a + s.b) / 2).toFixed(2)} = L(${((s.a + s.b) / 3).toFixed(2)}))`);
}
if (args.dump) for (const r of rows) console.log(`    ${AXIS}=${r.c}  worst ${r.worst} at ${r.at}`);
await b.close();
