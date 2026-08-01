/**
 * BOUND WINDOW — boot ONE pinned seed and dump the flood's own account of the
 * hole: every void region with its bbox, every leak crossing, and the last
 * twenty-four cells of the path the capsule walked to get through it.
 *
 *   node _boundwin.mjs --seed=12 [--cell=0.8] [--win=60,0,128,110]
 *
 * `tools/boundcheck.mjs` cannot be pointed at a seeded URL — its own argument
 * parser splits on every '=' , so `--url=…/?seed=12` reaches the page as
 * `…/?seed` — which is why the gate "passed" on a seed the sweep failed.
 */
import { chromium } from 'playwright';
import { floodReport } from './tools/boundflood.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true];
}));
const URL = args.url ?? 'http://127.0.0.1:4278/';
const SEED = Number(args.seed ?? 12);
const CELL = Number(args.cell ?? 0.8);
const SLACK = Number(args.slack ?? 3.0);
const win = args.win ? String(args.win).split(',').map(Number) : null;

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const m = c.peek('match'), ai = c.peek('ai');
  if (m && !m.__boundcheckStopped) { m.update = () => {}; m.__boundcheckStopped = true; }
  if (ai) { ai.combatEnabled = false; try { ai.clearAgents(); } catch { /* ok */ } }
});
const r = await page.evaluate(floodReport, { CELL, SLACK, window: win, pathLen: Number(args.pathlen ?? 24) });

console.log(`\n  engine levelSeed ${r.engineSeed}  (asked for ${SEED})`);
console.log(`  reached ${r.reachedArea} m², void ${r.voidArea} m² in ${r.regionCount} regions`);
console.log('\n  REGIONS   area m²   centre        bbox [x0,z0,x1,z1]');
for (const g of r.regions) console.log(`   ${String(g.area).padStart(9)}   [${g.centre}]   [${g.bbox}]`);
console.log(`\n  LEAKS (${r.leakCount})`);
for (const k of r.leaks) console.log(`   [${String(k.lx).padStart(5)},${String(k.lz).padStart(5)}] y ${k.y}  ${k.n} cells  from ${k.from}`);
console.log('\n  PATHS OUT (newest first: the void cell, then back into the play area)');
for (const p of r.leakPaths) console.log('   ' + JSON.stringify(p));
if (win) {
  console.log(`\n  WINDOW ${win} — ${r.windowCells.length} reached cells`);
  const byZ = new Map();
  for (const [x, z, y, tag] of r.windowCells) {
    if (!byZ.has(z)) byZ.set(z, []);
    byZ.get(z).push([x, y, tag]);
  }
  for (const z of [...byZ.keys()].sort((a, b) => a - b)) {
    const row = byZ.get(z).sort((a, b) => a[0] - b[0]);
    console.log(`   z ${String(z).padStart(6)}  x ${row[0][0]} .. ${row[row.length - 1][0]}  (${row.length})  tags ${[...new Set(row.map((e) => e[2]))].slice(0, 4).join(',')}`);
  }
}
if (errs.length) console.log('\n  page errors', errs.slice(0, 4));
await browser.close();
