/**
 * ════════════════════════════════════════════════════════════════════════════
 * HOW TALL A THING DOES THE HULL ACTUALLY GET OVER? — 「戦車は乗り越え性能高くして」
 * ════════════════════════════════════════════════════════════════════════════
 * `CLIMB_TOP` is a constant and a constant is not a measurement. This drives
 * the REAL `Armour` ride solver over a synthetic step of increasing height —
 * the same `_rideAt` / `_sample` the frame loop calls, on a leg whose ROAD and
 * STEP arrays are written by hand — and reports the tallest step whose crest
 * the hull's own support points actually reach, plus the pitch it reached it
 * at. A step the ride flattens to zero is a step it did NOT climb.
 *
 * Then it does the same thing against the map's own geometry: every baked leg
 * of every hull is walked and the tallest RISE the ride carries the hull over
 * is reported, with where it is.
 *
 *   node _climbmax.mjs [url] [seed]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4423/';
const SEED = process.argv[3] ?? '7';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await p.evaluate(() => {
  const a = window.__ENGINE__.ctx.peek('match').tank;
  const tank = a.tanks[0];
  if (!tank) return { err: 'no hull' };

  /* ---- 1. a synthetic step, driven with the real ride solver ---------- */
  const N = 80;
  const STEP_M = 1.25;
  const synth = (h) => {
    const leg = {
      n: N,
      X: new Float32Array(N), Y: new Float32Array(N), Z: new Float32Array(N),
      YAW: new Float32Array(N), S: new Float32Array(N),
      ROAD: new Float32Array(N), STEP: new Float32Array(N),
      PILE: new Int16Array(N).fill(-1), SOLID: new Uint8Array(N),
      length: 0, zone: null, plough: null, stop: '',
    };
    for (let i = 0; i < N; i++) {
      leg.S[i] = i * STEP_M;
      leg.X[i] = i * STEP_M;
      leg.Z[i] = 0;
      leg.ROAD[i] = 0;
      // the step starts halfway along and never comes back down
      leg.STEP[i] = i >= N / 2 ? h : 0;
      leg.Y[i] = leg.ROAD[i] + leg.STEP[i];
    }
    leg.length = leg.S[N - 1];
    return leg;
  };

  const rows = [];
  for (let h = 0.4; h <= 3.01; h += 0.2) {
    const leg = synth(h);
    const saveLegs = tank.legs;
    const saveIx = tank.legIx;
    const saveS = tank.s;
    const saveDir = tank.legDir;
    tank.legs = [leg];
    tank.legIx = 0;
    tank.legDir = 1;
    let top = -Infinity;
    let maxPitch = 0;
    // drive the whole leg through the real sampler
    for (let s = 0; s <= leg.length; s += 0.25) {
      tank.s = s;
      const at = a._sample(tank);
      if (at.y > top) top = at.y;
      if (Math.abs(tank._pitch) > maxPitch) maxPitch = Math.abs(tank._pitch);
    }
    tank.legs = saveLegs;
    tank.legIx = saveIx;
    tank.s = saveS;
    tank.legDir = saveDir;
    rows.push({
      step: +h.toFixed(2),
      rideTop: +top.toFixed(2),
      crested: top >= h - 0.02,
      maxPitchDeg: +((maxPitch * 180) / Math.PI).toFixed(1),
    });
  }

  /* ---- 2. the map's own legs ----------------------------------------- */
  const legs = [];
  for (const t of a.tanks) {
    for (const leg of t.legs) {
      let tallest = 0;
      let where = null;
      let carried = 0;
      for (let i = 0; i < leg.n; i++) {
        const rise = leg.Y[i] - leg.ROAD[i];
        if (rise > tallest) { tallest = rise; where = [+leg.X[i].toFixed(1), +leg.Z[i].toFixed(1)]; }
        if (leg.STEP[i] > carried) carried = leg.STEP[i];
      }
      legs.push({
        tank: t.id, leg: leg.zone ?? 'HUB', n: leg.n,
        len: +leg.length.toFixed(0),
        tallestRise: +tallest.toFixed(2),
        tallestCarried: +carried.toFixed(2),
        at: where,
      });
    }
  }
  /* ---- 3. the END-TO-END ceiling: what `_bakeRide` will hand the ride -- */
  // `_bakeRide` clamps a rise to CLIMB_TOP before the ride ever sees it, so the
  // solver's own limit (part 1) is an upper bound and this is the real answer.
  let bakeCap = 0;
  for (const t of a.tanks) {
    for (const leg of t.legs) {
      for (let i = 0; i < leg.n; i++) if (leg.STEP[i] > bakeCap) bakeCap = leg.STEP[i];
    }
  }
  return { rows, legs, bakeCap: +bakeCap.toFixed(2) };
});

if (out.err) { console.log(out.err); await b.close(); process.exit(2); }

console.log('\n=== THE RIDE SOLVER ON A SYNTHETIC STEP (real _sample / _rideAt) ===');
console.log('  step(m)  ride crest(m)  crested?  max pitch');
let best = 0;
for (const r of out.rows) {
  console.log(
    `  ${String(r.step).padStart(5)}    ${String(r.rideTop).padStart(9)}    ` +
      `${r.crested ? 'YES' : 'no '}       ${r.maxPitchDeg}deg`
  );
  if (r.crested) best = r.step;
}
console.log(
  `\n  the RIDE SOLVER itself crests up to ${best.toFixed(2)} m (pitch-limited, not height-limited)` +
    `\n  but \`_bakeRide\` clamps every rise to CLIMB_TOP before the solver sees it, so:` +
    `\n  TALLEST STEP THE HULL ACTUALLY CROSSES ON THIS MAP: ${out.bakeCap} m`
);

console.log('\n=== THE MAP\'S OWN BAKED LEGS ===');
for (const l of out.legs) {
  console.log(
    `  ${l.tank}/${String(l.leg).padEnd(4)} ${String(l.len).padStart(4)} m, ${l.n} samples — ` +
      `tallest rise ${l.tallestRise} m (carried as ${l.tallestCarried} m) at ${JSON.stringify(l.at)}`
  );
}
await b.close();
