/**
 * WHAT DID THE NAV-PATCH CHANGE ACTUALLY TOUCH, PER MAP?
 *
 *   node _nfpatchlog.mjs --url=…
 *
 * `_bakeNavPatch` now declines two classes of cell — ones the interior carve
 * owns, and ones the ruin merely hung something over — and prints a line per
 * site when it declines any. The town is the map the user plays today, so
 * "how many cells does this change on the TOWN" is the regression question,
 * and it is answerable straight off the boot log.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4578/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 480 } });
const lines = [];
p.on('console', (m) => { const s = m.text(); if (/nav patch|EVENT-OWNED|route gate|buildings baked/.test(s)) lines.push(s); });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const lvl = await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id);
console.log(`level=${lvl}`);
for (const l of lines) console.log('  ' + l);
if (!lines.some((l) => /nav patch/.test(l))) console.log('  (no site declined a single cell on this map)');
await b.close();
