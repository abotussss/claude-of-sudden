/**
 * DOES THE GUN LEAVE ANYTHING STANDING ON NOTHING?
 *
 * `_floatcheck.mjs` sweeps the rubble the airstrike and the cathedral leave.
 * The tank's gun is a third demolition and it works the other way round: it
 * TAKES mass away, so what it can leave behind is not a floating chunk but a
 * prop whose support has been erased out from under it — a crate that was
 * sitting on a pallet, a sandbag on a barrel.
 *
 * Fires the gun's raze at N points along both hulls' baked legs, then for every
 * prop instance still standing within `--near` of each burst, drops a ray from
 * just under its origin and asks whether anything is holding it up.
 *
 *   node _razefloat.mjs [--url=…] [--seed=N] [--bursts=24] [--near=14] [--tol=0.6]
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4291/';
const BURSTS = +(args.bursts ?? 24);
const NEAR = +(args.near ?? 14);
const TOL = +(args.tol ?? 0.6);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
await page.goto(`${URL}?capture=1${args.seed ? `&seed=${args.seed}` : ''}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(({ BURSTS, NEAR, TOL }) => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), phys = e.ctx.peek('physics');
  const a = m.tank;
  if (!a?._atlas) return { err: 'no raze atlas' };
  const V3 = e.camera.position.constructor;
  const down = new V3(0, -1, 0), o = new V3();
  /** Support test: is there mass within TOL under this instance's origin? */
  const supported = (x, y, z) => {
    o.set(x, y + 0.25, z);
    const h = phys.raycast(o, down, 0.25 + TOL, phys.MASK.WORLD);
    return !!h?.hit;
  };
  const bursts = [];
  for (const t of a.tanks) {
    for (const p of t.legs) {
      const step = Math.max(1, Math.floor(p.n / Math.ceil(BURSTS / (a.tanks.length * 2))));
      for (let i = 2; i < p.n - 2; i += step) bursts.push({ x: p.X[i], y: p.Y[i], z: p.Z[i] });
    }
  }
  /* baseline: how many props are unsupported BEFORE anything is razed? */
  let preBad = 0, preSeen = 0;
  for (const q of bursts) {
    for (const r of a._atlas.recs) {
      if (Math.hypot(r.x - q.x, r.z - q.z) > NEAR) continue;
      preSeen++;
      if (!supported(r.x, r.y, r.z)) preBad++;
    }
  }
  let razed = 0;
  for (const q of bursts) razed += a._razeAt(q.x, q.y, q.z, 5.0);
  let postBad = 0, postSeen = 0;
  const worst = [];
  for (const q of bursts) {
    for (const r of a._atlas.recs) {
      if (r.fired) continue;
      if (Math.hypot(r.x - q.x, r.z - q.z) > NEAR) continue;
      postSeen++;
      if (!supported(r.x, r.y, r.z)) {
        postBad++;
        if (worst.length < 8) worst.push([+r.x.toFixed(1), +r.y.toFixed(1), +r.z.toFixed(1)]);
      }
    }
  }
  a._restoreRaze();
  /* and did the restore put everything back? */
  let restored = 0;
  for (const r of a._atlas.recs) if (r.fired) restored++;
  return { bursts: bursts.length, razed, preSeen, preBad, postSeen, postBad, worst, stillFired: restored };
}, { BURSTS, NEAR, TOL });

if (out.err) console.log('[razefloat]', out.err);
else {
  console.log(`[razefloat] ${out.bursts} bursts razed ${out.razed} prop instances`);
  console.log(`  before: ${out.preBad} of ${out.preSeen} nearby props had nothing within ${TOL} m under them`);
  console.log(`  after:  ${out.postBad} of ${out.postSeen} still-standing props do`);
  console.log(`  NEW unsupported props caused by the gun: ${Math.max(0, out.postBad - out.preBad)}`);
  if (out.worst.length) console.log(`  examples: ${JSON.stringify(out.worst)}`);
  console.log(`  restore left ${out.stillFired} instances still erased (must be 0)`);
  console.log(out.postBad <= out.preBad && out.stillFired === 0 ? '[razefloat] PASS' : '[razefloat] LOOK');
}
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
