/**
 * ════════════════════════════════════════════════════════════════════════════
 * HOW LONG ARE YOU IN THE OPEN? — the crossing measured, not the prop counted
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _plaincross.mjs [--url=http://127.0.0.1:4604/?map=plains] [--json=path]
 *
 * 「平原にしても障害物なさすぎ … 平原での移動にもう少し無防備な時間を少なくして」
 *
 * The request is NOT "more props". It is LESS TIME WITH NOTHING BETWEEN YOU AND
 * A RIFLE, and the two come apart immediately: a hundred rocks scattered evenly
 * over 350 m of plain change the object count and change nothing about the
 * walk from the north base to zone A. So this measures the walk.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE METRIC
 * ────────────────────────────────────────────────────────────────────────────
 * Every route below is one a man actually walks — base to shoulder zone, zone
 * to zone, zone to centre. It is sampled every 2 m. At each sample the eye is
 * put at 1.62 m (`STANCE.stand`), and:
 *
 *   lane   metres of UNBROKEN CORRIDOR he is standing in, measured along the
 *          route itself: the ray forward to the first occluder plus the ray
 *          back. This is the lane a rifle already on the route can shoot him
 *          down. 300 m of lane is the whole map; 40 m of lane is a man who is
 *          about to be behind something.
 *   reach  mean metres to the first occluder over 24 azimuths — the general
 *          openness of the ground he is standing on, which is the number that
 *          says whether there is anything ANYWHERE near him.
 *   near   is there an occluder within 8 m on any bearing — cover within one
 *          sprint step. This is the honest test of "can I get out of the open",
 *          and it is the one a scattered stone can never pass.
 *
 * and the route-level numbers are:
 *
 *   exposed  the share of the walk whose lane is over 120 m. `Agent.viewRange`
 *            is 58 m, so a 120 m corridor is a man visible from both ends of it
 *            at once with no way to break either.
 *   run      THE HEADLINE. The longest CONTINUOUS stretch of the route, in
 *            metres, on which every sample is exposed. This is literally "how
 *            far you walk with nothing between you and a rifle" — the thing
 *            the complaint is about — and it is the number to move.
 *   covered  the share of the walk with an occluder inside 8 m.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AGAINST BOTH WORLDS, AND WHY
 * ────────────────────────────────────────────────────────────────────────────
 * `physics.raycast` finds collision. Smoke is not collision and a fire is not
 * collision, so neither shows up here AT ALL — that is deliberate and it is the
 * conservative direction: everything this file reports as open ground may in
 * fact be behind a bank of smoke, and nothing it reports as covered is smoke
 * pretending to be a wall. The mass is measured; the screen is photographed.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4604/?map=plains';

const b = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level=${level}`);
if (level !== 'plains') { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const MASK = ph.MASK.WORLD;
  const EYE = 1.62;
  const STEP = 2.0;
  const CAP = 320;        // longer than the map is wide
  const NAZ = 24;
  const REACH_CAP = 140;
  const NEAR = 8;
  const OPEN = 120;       // a lane this long is a man with nowhere to be

  /** The places people walk between, in level metres (= world, identity). */
  const P = {
    'BASE-N': [-14, -150], 'BASE-S': [14, 150],
    A: [-118, -104], B: [118, 104], C: [-128, 86], E: [128, -86], D: [0, 0],
  };
  const ROUTES = [
    ['BASE-N', 'A'], ['BASE-N', 'D'], ['BASE-N', 'E'],
    ['BASE-S', 'B'], ['BASE-S', 'D'], ['BASE-S', 'C'],
    ['A', 'D'], ['B', 'D'], ['C', 'D'], ['E', 'D'],
    ['A', 'C'], ['B', 'E'],
  ];

  const groundAt = (x, z) => {
    const h = ph.raycast(x, 300, z, 0, -1, 0, 400, MASK);
    return h.hit ? h.point.y : null;
  };
  const dist = (x, y, z, dx, dz, cap) => {
    const h = ph.raycast(x, y, z, dx, 0, dz, cap, MASK);
    return h.hit ? h.distance : cap;
  };

  const rows = [];
  for (const [aId, bId] of ROUTES) {
    const [ax, az] = P[aId]; const [bx, bz] = P[bId];
    const L = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / L, tz = (bz - az) / L;
    // Skip the pads themselves at each end: the capture circle is not the walk.
    const s0 = 18, s1 = L - 18;
    const samples = [];
    for (let s = s0; s <= s1; s += STEP) {
      const x = ax + tx * s, z = az + tz * s;
      const g = groundAt(x, z);
      if (g === null) continue;
      const y = g + EYE;
      const fwd = dist(x, y, z, tx, tz, CAP);
      const back = dist(x, y, z, -tx, -tz, CAP);
      let sum = 0, near = REACH_CAP;
      for (let i = 0; i < NAZ; i++) {
        const a = (i / NAZ) * Math.PI * 2;
        const d = dist(x, y, z, Math.cos(a), Math.sin(a), REACH_CAP);
        sum += d; if (d < near) near = d;
      }
      samples.push({ s, lane: fwd + back, reach: sum / NAZ, near });
    }
    if (!samples.length) continue;
    const n = samples.length;
    const exposed = samples.filter((v) => v.lane > OPEN).length / n;
    const covered = samples.filter((v) => v.near < NEAR).length / n;
    // the longest continuous exposed stretch, in metres
    let run = 0, cur = 0;
    for (const v of samples) {
      if (v.lane > OPEN) { cur += STEP; if (cur > run) run = cur; } else cur = 0;
    }
    const mean = (f) => samples.reduce((a, v) => a + f(v), 0) / n;
    const sorted = samples.map((v) => v.lane).sort((a, c) => a - c);
    rows.push({
      route: `${aId}->${bId}`, len: +L.toFixed(0), n,
      lane: +mean((v) => v.lane).toFixed(1),
      laneMed: +sorted[n >> 1].toFixed(1),
      reach: +mean((v) => v.reach).toFixed(1),
      exposed: +exposed.toFixed(3),
      covered: +covered.toFixed(3),
      run: +run.toFixed(0),
    });
  }
  const w = rows.reduce((a, r) => a + r.n, 0);
  const agg = {
    samples: w,
    lane: +(rows.reduce((a, r) => a + r.lane * r.n, 0) / w).toFixed(1),
    reach: +(rows.reduce((a, r) => a + r.reach * r.n, 0) / w).toFixed(1),
    exposed: +(rows.reduce((a, r) => a + r.exposed * r.n, 0) / w).toFixed(3),
    covered: +(rows.reduce((a, r) => a + r.covered * r.n, 0) / w).toFixed(3),
    runMax: Math.max(...rows.map((r) => r.run)),
    runMean: +(rows.reduce((a, r) => a + r.run, 0) / rows.length).toFixed(0),
  };
  return { rows, agg };
});

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
console.log('\n route          len    n    lane   med   reach  exposed covered   run');
console.log(' ' + '-'.repeat(70));
for (const r of out.rows) {
  console.log(` ${pad(r.route, 14)}${num(r.len, 4)}${num(r.n, 5)}${num(r.lane, 8)}${num(r.laneMed, 6)}${num(r.reach, 8)}` +
    `${num((r.exposed * 100).toFixed(0) + '%', 8)}${num((r.covered * 100).toFixed(0) + '%', 8)}${num(r.run, 6)}`);
}
console.log(' ' + '-'.repeat(70));
console.log(` ${pad('ALL', 14)}${num('', 4)}${num(out.agg.samples, 5)}${num(out.agg.lane, 8)}${num('', 6)}${num(out.agg.reach, 8)}` +
  `${num((out.agg.exposed * 100).toFixed(0) + '%', 8)}${num((out.agg.covered * 100).toFixed(0) + '%', 8)}${num(out.agg.runMax, 6)}`);
console.log(`\n runMax=${out.agg.runMax} m  runMean=${out.agg.runMean} m   (longest continuous walk with a >120 m clear lane)`);
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs[0]}` : '[pageerror] none');
if (args.json) writeFileSync(args.json, JSON.stringify(out, null, 1));
await b.close();
