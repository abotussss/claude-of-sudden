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
  /**
   * ────────────────────────────────────────────────────────────────────────
   * A HORIZONTAL RAY IS NOT A SIGHTLINE, AND THE FIRST CUT OF THIS FILE USED
   * ONE
   * ────────────────────────────────────────────────────────────────────────
   * The plain swells ±6 m over a 100 m wavelength. A ray fired flat out of a
   * hollow at 1.62 m is five metres in the AIR by the time it is 60 m away —
   * it sails clean over a 2.5 m berm standing on the route and then hits the
   * far side of the next swell, and the number it reports is the distance to
   * that hillside. Measured: with 39 pieces of cover standing on the walks,
   * the flat-ray version moved the mean lane by seven metres and reported
   * "nothing on the lane" for routes with two burnt lorries lying across them.
   *
   * A sightline is EYE TO MAN. So this marches a real man down the route — a
   * chest at 1.2 m over whatever the ground is THERE — and asks whether the
   * line from the standing eye to him is clear. That line follows the ground,
   * so cover on the ground is in it.
   */
  const CHEST = 1.2;
  const MARCH = 4;
  /**
   * The target man is always ON the route, so the whole route's ground is
   * sampled ONCE at `STEP` and every march step reads it out of that array —
   * `MARCH` is a multiple of `STEP` so the lookup is exact. Without it this is
   * 85 000 redundant downward rays and a twelve-minute run.
   */
  const seen = (x, y, z, i0, sign, prof, cap) => {
    const k = MARCH / STEP;
    for (let d = MARCH, j = i0 + sign * k; d <= cap; d += MARCH, j += sign * k) {
      if (j < 0 || j >= prof.length) return d;
      const p = prof[j];
      if (!p) return d;
      const dx = p.x - x, dy = p.g + CHEST - y, dz = p.z - z;
      const len = Math.hypot(dx, dy, dz);
      const h = ph.raycast(x, y, z, dx / len, dy / len, dz / len, len - 0.15, MASK);
      if (h.hit) return d;
    }
    return cap;
  };

  const rows = [];
  for (const [aId, bId] of ROUTES) {
    const [ax, az] = P[aId]; const [bx, bz] = P[bId];
    const L = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / L, tz = (bz - az) / L;
    // The ground down the WHOLE route, once. @see `seen`.
    const prof = [];
    for (let s = 0; s <= L + 1e-6; s += STEP) {
      const x = ax + tx * s, z = az + tz * s;
      const g = groundAt(x, z);
      prof.push(g === null ? null : { x, z, g, s });
    }
    // Skip the pads themselves at each end: the capture circle is not the walk.
    const s0 = 18, s1 = L - 18;
    const samples = [];
    for (let i = 0; i < prof.length; i++) {
      const p = prof[i];
      if (!p || p.s < s0 || p.s > s1) continue;
      const s = p.s, x = p.x, z = p.z, g = p.g;
      const y = g + EYE;
      const fwd = seen(x, y, z, i, 1, prof, CAP);
      const back = seen(x, y, z, i, -1, prof, CAP);
      /**
       * `reach` and `near` stay FLAT rays on purpose. They are not sightlines,
       * they are the question "is there mass beside me" — the 8 m one is "can I
       * get behind something in a sprint step" — and a flat ray at chest height
       * is exactly right for that at the ranges it is asked over.
       */
      let sum = 0, near = REACH_CAP;
      for (let i = 0; i < NAZ; i++) {
        const a = (i / NAZ) * Math.PI * 2;
        const h = ph.raycast(x, y - 0.3, z, Math.cos(a), 0, Math.sin(a), REACH_CAP, MASK);
        const d = h.hit ? h.distance : REACH_CAP;
        sum += d; if (d < near) near = d;
      }
      samples.push({ s, lane: fwd + back, reach: sum / NAZ, near, fwd, back });
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
      /**
       * WHERE THE OCCLUDERS ACTUALLY ARE, along the route. `s + fwd` is the
       * along-route coordinate the forward ray died at, so the set of them is
       * the list of things standing on this lane — and the GAPS between them
       * are the answer to "why did the number not move". Placing a piece 16 m
       * off a 200 m lane changes `covered` and does not change `lane`, and this
       * row is what says so rather than a guess.
       */
      hits: samples.filter((v) => v.fwd < CAP).map((v) => Math.round(v.s + v.fwd))
        .filter((v, i, a) => i === 0 || v - a[i - 1] > 3),
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
if (args.detail) {
  console.log('\n where the forward ray dies, in metres along each route:');
  for (const r of out.rows) console.log(`  ${pad(r.route, 14)} ${r.hits.join(' ') || '— nothing on the lane —'}`);
}
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs[0]}` : '[pageerror] none');
if (args.json) writeFileSync(args.json, JSON.stringify(out, null, 1));
await b.close();
