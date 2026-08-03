/**
 * WHAT THE CATHEDRAL'S COLLAPSE DOES TO A RIDE BAKED BEFORE IT.
 *
 *   node _ruinride.mjs [--url=…] [--seed=7]
 *
 * `MatchSystem` calls `_setCathedralRazed(false)` in its constructor and builds
 * `Armour` two hundred lines later, so every leg is measured with the church
 * STANDING. This razes it and measures the error the old code would have
 * carried — the gap, per sample, between the ride's baked road and the ground
 * that is actually there — then checks `_watchCathedral` has closed it, and
 * that standing the church back up restores the boot measurement exactly.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true];
}));
const URL = args.url ?? 'http://127.0.0.1:4498/';
const SEED = args.seed ?? '7';

const b = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
p.on('console', (m) => { const t = m.text(); if (/cathedral (RAZED|STANDING)/.test(t)) console.log('  ' + t); });
await p.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

/** Per-leg: the biggest gap between the baked ride and the real ground. */
const measure = () => p.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ph = e.ctx.peek('physics');
  const w = e.ctx.peek('world');
  const cx = w.cathedral.cx, cz = w.cathedral.cz;
  const out = [];
  for (const t of m.tank.tanks) {
    for (let li = 0; li < t.legs.length; li++) {
      const p = t.legs[li];
      let worst = 0; let n = 0; let near = 0; let s0 = 0; let w0 = 0;
      for (let i = 0; i < p.n; i++) {
        if (Math.hypot(p.X[i] - cx, p.Z[i] - cz) > 42) continue;
        near++;
        const g = ph.groundHeight(p.X[i], p.Z[i], 40);
        if (!Number.isFinite(g)) continue;
        // What the ride actually puts the hull on at this sample.
        const ride = p.ROAD[i] + p.STEP[i];
        /**
         * ONLY MASS THE HULL SHOULD BE ON TOP OF. A sample under the church's
         * own roof reads 10-14 m of "error" and is not one: `_bakeRide`'s roof
         * rule deliberately drives under anything over `PASS_TOP`. What this
         * counts is ground that has come UP under a baked ride by more than a
         * step and less than a roof — which is exactly what collapse rubble is.
         */
        const err = g - ride;
        if (err > 0.35 && err <= 3.6) { n++; if (err > worst) worst = err; }
        /** …and the same question asked of the BOOT measurement, which is what
         *  the ride carried before `_watchCathedral` existed. */
        const e0 = g - p.Y0[i];
        if (e0 > 0.35 && e0 <= 3.6) { s0++; if (e0 > w0) w0 = e0; }
      }
      out.push({ id: t.id, leg: p.zone ?? 'HUB', near, off: n, worst: +worst.toFixed(2),
        stale: s0, staleWorst: +w0.toFixed(2), key: `${t.id}/${p.zone ?? 'HUB'}` });
    }
  }
  return { razed: !!w.cathedral.razed, legs: out };
});

const before = await measure();
console.log(`\n  cathedral standing (razed=${before.razed})`);
for (const r of before.legs) if (r.near) console.log(`    ${r.id} ${r.leg.padEnd(4)} ${String(r.near).padStart(3)} samples inside 42 m — baked ride ${r.off} off by >0.35 m (worst ${r.worst}) · boot measurement ${r.stale} off (worst ${r.staleWorst})`);

/* ---- raze it, with the tank system's own update loop running ---------- */
await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._setCathedralRazed(true);
});
await p.waitForTimeout(500);
const after = await measure();
console.log(`\n  cathedral razed (razed=${after.razed})`);
for (const r of after.legs) if (r.near) console.log(`    ${r.id} ${r.leg.padEnd(4)} ${String(r.near).padStart(3)} samples inside 42 m — baked ride ${r.off} off by >0.35 m (worst ${r.worst}) · boot measurement ${r.stale} off (worst ${r.staleWorst})`);

/* ---- …and back up ------------------------------------------------------ */
await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._setCathedralRazed(false);
});
await p.waitForTimeout(500);
const back = await measure();
console.log(`\n  cathedral standing again (razed=${back.razed})`);
for (const r of back.legs) if (r.near) console.log(`    ${r.id} ${r.leg.padEnd(4)} ${String(r.near).padStart(3)} samples inside 42 m — baked ride ${r.off} off by >0.35 m (worst ${r.worst}) · boot measurement ${r.stale} off (worst ${r.staleWorst})`);

const diffs = before.legs.filter((r, i) => r.off !== back.legs[i].off || Math.abs(r.worst - back.legs[i].worst) > 0.005 || r.key !== back.legs[i].key);
console.log(`\n  restore is exact: ${diffs.length === 0 ? 'YES' : 'NO — ' + diffs.map((r, i) => `${r.key} ${r.off}/${r.worst}`).join(', ')}`);
/** …and the boot arrays themselves, not just this summary. */
const exact = await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  let bad = 0; let n = 0;
  for (const t of m.tank.tanks) for (const p of t.legs) {
    if (!p.Y0) continue;
    for (let i = 0; i < p.n; i++) { n++; if (Math.abs(p.Y[i] - p.Y0[i]) > 1e-6) bad++; }
  }
  return { bad, n };
});
console.log(`  Y restored to the boot measurement on ${exact.n - exact.bad}/${exact.n} samples`);
if (errs.length) console.log('  PAGEERRORS', errs.slice(0, 3));
await b.close();
