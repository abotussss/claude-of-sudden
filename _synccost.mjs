/**
 * WHAT THE COVER SWAPS COST, both of them, timed over many repetitions because
 * one of them is under the clock's resolution.
 *
 *   node _synccost.mjs [url]
 *
 * `ai.syncCoverBlocks` is the six-blocks pass and `ai.setCoverRazed` is the
 * cathedral's reference swap; the cathedral's was measured at 0.9 ms when it
 * was written and must not have got worse.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4257/?capture=1';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const r = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const ai = e.ctx.peek('ai');
  const ph = e.ctx.peek('physics');
  const N = 200;
  const out = {};

  const run = (label, prep, act) => {
    for (let i = 0; i < 20; i++) { prep(i); act(); } // warm
    let t = 0;
    let worst = 0;
    let n = 0;
    for (let i = 0; i < N; i++) {
      prep(i);
      const t0 = performance.now();
      const did = act();
      const dt = performance.now() - t0;
      if (did === false) continue;
      t += dt;
      if (dt > worst) worst = dt;
      n++;
    }
    out[label] = { mean: +(t / Math.max(1, n)).toFixed(3), worst: +worst.toFixed(3), n };
  };

  // THE SIX BLOCKS: all up <-> all down, which is the largest change possible.
  run(
    'syncCoverBlocks all six',
    (i) => { for (const d of w.demolitions) d.setDown((i & 1) === 0); },
    () => ai.syncCoverBlocks()
  );
  // ONE BLOCK, which is what a district salvo's members actually do.
  w.demolishAll(false);
  ai.syncCoverBlocks();
  run(
    'syncCoverBlocks one block',
    (i) => { w.demolitions[0].setDown((i & 1) === 0); },
    () => ai.syncCoverBlocks()
  );
  w.demolishAll(false);
  ai.syncCoverBlocks();

  // THE CATHEDRAL, with the blocks standing (its original measurement) …
  const m = e.ctx.peek('match');
  const raze = (d) => (typeof m?._setCathedralRazed === 'function'
    ? m._setCathedralRazed(d)
    : w.cathedral?.setRazed?.(d, ph));
  raze(false);
  let flip = false;
  run(
    'setCoverRazed alternating',
    () => { flip = !flip; },
    () => ai.setCoverRazed(flip)
  );
  ai.setCoverRazed(false);

  // …and again with three blocks down, which is the state a swap now has to
  // reconcile the incoming table to.
  for (const id of ['NW6', 'NW1', 'WC6']) w.demolish(id, true);
  ai.syncCoverBlocks();
  let flip2 = false;
  run(
    'setCoverRazed, 3 blocks down',
    () => { flip2 = !flip2; },
    () => ai.setCoverRazed(flip2)
  );
  ai.setCoverRazed(false);
  w.demolishAll(false);
  ai.syncCoverBlocks();

  out.tables = {
    intactAll: ai.coverIntact.all.length,
    intactLive: ai.coverIntact.points.length,
    ruinAll: ai.coverRuin?.all.length ?? 0,
    dynamic: ai.coverIntact.dynamic,
  };
  return out;
});

for (const [k, v] of Object.entries(r)) console.log(`  ${k.padEnd(28)} ${JSON.stringify(v)}`);
await browser.close();
