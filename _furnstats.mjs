/**
 * HOW MUCH FURNITURE HAD TO MOVE, AND HOW MUCH FOUND NOWHERE TO GO.
 *
 * `src/world/interiors.js` clears a spot against the prop's real footprint now,
 * so more pieces have to be shifted than when clearance was a point test. The
 * question that answers whether that is a fix or a thinning of the map is how
 * many pieces ended up homeless — dropped rather than relocated — and the
 * furnishing pass counts them on the assembler as it goes.
 *
 *   node _furnstats.mjs --url=http://127.0.0.1:4310/?seed=3
 *
 * kept      the authored/sampled spot was already legal
 * nudged    moved within 2.2 m of it by the ring search
 * moved     relocated by the whole-room sweep (still in the same room)
 * homeless  no legal spot anywhere in the room — the piece is not placed
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4310/';

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world');
  return { seed: window.__ENGINE__.levelSeed, stats: w?.A?.furnishStats ?? null };
});
const s = out.stats;
if (!s) {
  console.log('[furnstats] world publishes no furnishStats');
} else {
  const total = s.kept + s.nudged + s.moved + s.homeless;
  const pc = (n) => `${((n / total) * 100).toFixed(1)}%`;
  console.log(`  seed ${out.seed}  —  ${total} collision-bearing interior placements`);
  console.log(`    kept      ${String(s.kept).padStart(4)}  ${pc(s.kept)}`);
  console.log(`    nudged    ${String(s.nudged).padStart(4)}  ${pc(s.nudged)}`);
  console.log(`    moved     ${String(s.moved).padStart(4)}  ${pc(s.moved)}`);
  console.log(`    homeless  ${String(s.homeless).padStart(4)}  ${pc(s.homeless)}`);
}
if (errs.length) console.log('[furnstats] page errors', errs.slice(0, 4));
await browser.close();
process.exit(errs.length ? 1 : 0);
