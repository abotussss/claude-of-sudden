/**
 * BOUNDARY SWEEP — boot N seeds, run boundcheck's flood on each, name the ones
 * that leak.
 *
 * WHY IT EXISTS. `tools/boundcheck.mjs` is the gate, and it failed INTERMITTENTLY:
 * three agents on three unrelated changes each hit it once and all three reported
 * the same void area to four significant figures (7519 m²), which is not
 * measurement noise — it is one specific hole that opens under one specific roll
 * of the level dice. `Engine` seeds `ctx.rng` from `Math.random()`, so nobody
 * could boot the same map twice and the bug had no handle.
 *
 * `?seed=N` (src/main.js) pins that roll. This walks a range of seeds through it
 * and prints which ones fail, so a one-in-N bug becomes a URL.
 *
 *   node tools/boundsweep.mjs [--url=…] [--from=0] [--n=64] [--jobs=4]
 *                             [--cell=0.9] [--maxvoid=20] [--seeds=1,2,3]
 *
 * The flood is boundcheck's, reduced to the numbers a sweep needs (total void
 * area, the biggest regions, the leaks). `--cell` defaults COARSER than
 * boundcheck's 0.8 because a sweep is looking for a field, not for a 2 m pocket,
 * and 0.9 m halves the ray count. Confirm any hit with the real gate at its own
 * cell size before believing it.
 */
import { chromium } from 'playwright';
import { floodReport } from './boundflood.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const URL = args.url ?? 'http://127.0.0.1:4273/';
const CELL = Number(args.cell ?? 0.9);
const SLACK = Number(args.slack ?? 3.0);
const MAXVOID = Number(args.maxvoid ?? 20);
const JOBS = Number(args.jobs ?? 4);
const seeds = args.seeds
  ? String(args.seeds).split(',').map(Number)
  : Array.from({ length: Number(args.n ?? 64) }, (_, i) => Number(args.from ?? 0) + i);

const results = [];
let next = 0;

async function worker(id) {
  const browser = await chromium.launch({ headless: true,
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  while (true) {
    const i = next++;
    if (i >= seeds.length) break;
    const seed = seeds[i];
    errs.length = 0;
    const t0 = Date.now();
    try {
      await page.goto(`${URL}?seed=${seed}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
      await page.evaluate(() => {
        const c = window.__ENGINE__.ctx;
        const m = c.peek('match'), ai = c.peek('ai');
        if (m && !m.__boundcheckStopped) { m.update = () => {}; m.__boundcheckStopped = true; }
        if (ai) { ai.combatEnabled = false; try { ai.clearAgents(); } catch { /* ok */ } }
        c.peek('ui')?.banner?.hide?.();
      });
      const r = await page.evaluate(floodReport, { CELL, SLACK });
      const big = (r.regions ?? []).filter((x) => x.area > MAXVOID);
      results.push({ seed, voidArea: r.voidArea, big: big.length, top: r.regions?.[0] ?? null,
        leaks: r.leaks?.slice(0, 4) ?? [], engineSeed: r.engineSeed, errs: errs.slice(0, 2) });
      const flag = big.length ? 'FAIL' : 'pass';
      console.log(`  [w${id}] seed ${String(seed).padStart(6)}  ${flag}  void ${String(r.voidArea).padStart(6)} m²` +
        (big.length ? `  biggest ${big[0].area} m² at [${big[0].centre}] leak ${JSON.stringify(r.leaks?.[0] ?? null)}` : '') +
        `  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      results.push({ seed, err: String(e.message).slice(0, 120) });
      console.log(`  [w${id}] seed ${String(seed).padStart(6)}  ERROR ${String(e.message).slice(0, 90)}`);
    }
  }
  await browser.close();
}

console.log(`\n  sweeping ${seeds.length} seeds at cell ${CELL} m, ${JOBS} browsers, ${URL}`);
await Promise.all(Array.from({ length: Math.min(JOBS, seeds.length) }, (_, i) => worker(i)));

results.sort((a, b) => a.seed - b.seed);
const bad = results.filter((r) => r.big > 0);
console.log(`\n  ${results.length} seeds, ${bad.length} FAIL, ${results.filter((r) => r.err).length} errored`);
if (bad.length) {
  console.log('\n   seed    void m²   regions   biggest              leaks');
  for (const r of bad) {
    console.log(`  ${String(r.seed).padStart(6)}   ${String(r.voidArea).padStart(7)}   ${String(r.big).padStart(7)}   ` +
      `${String(r.top.area).padStart(8)} m² at [${r.top.centre}]   ${JSON.stringify(r.leaks)}`);
  }
}
console.log(`\n[boundsweep] failure rate ${bad.length}/${results.length} = ${(100 * bad.length / results.length).toFixed(1)}%`);
process.exit(0);
