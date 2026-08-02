/**
 * REGRESSION CHECK for the minimap pip colour: the objective list `match`
 * publishes also carries an UNLABELLED marker per spotted hostile, and those
 * squares were cyan before this change. If they are now hot they must not bury
 * the zone pips. Runs a live match with combat ON and counts what lands.
 *   node _mmclutter.mjs <url> <outDir>
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = process.argv[2] ?? 'http://127.0.0.1:4380/?seed=7';
const OUT = process.argv[3] ?? 'shots/uiverify';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => { window.__ENGINE__.time.scale = 10; });
await page.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 180000 });
await page.mouse.click(700, 400);
// let a real fight develop, so spotting is live
await page.waitForTimeout(9000);
await page.evaluate(() => {
  const e = window.__ENGINE__; e.time.scale = 1;
  const ai = e.ctx.peek('ai'); ai.protect(e.ctx.peek('player'), 9999);
});
await page.waitForTimeout(1200);
const r = await page.evaluate(() => {
  const ui = window.__ENGINE__.ctx.peek('ui');
  const objs = ui._objectives ?? [];
  const counts = {};
  for (const o of objs) counts[o.color ?? 'none'] = (counts[o.color ?? 'none'] ?? 0) + 1;
  return {
    total: objs.length,
    labelled: objs.filter((o) => o.label).length,
    unlabelled: objs.filter((o) => !o.label).length,
    byColour: counts,
    drawn: (ui._mmObjs ?? []).length,
  };
});
console.log('objectives', JSON.stringify(r));
await page.screenshot({ path: `${OUT}/minimap-live.png`, clip: { x: 0, y: 0, width: 220, height: 200 } });
console.log(`${OUT}/minimap-live.png`);
if (errs.length) console.log('PAGE ERRORS', errs.slice(0, 5)); else console.log('no page errors');
await browser.close();
