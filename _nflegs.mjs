/**
 * ════════════════════════════════════════════════════════════════════════════
 * DID EVERY TANK LEG BAKE? — the one line of the boot log that matters here
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nflegs.mjs [--url=http://127.0.0.1:4624/?map=plains]
 *
 * `_dtankdiag.mjs` answers this and also plays a whole match, which is ninety
 * seconds. Digging a trench anywhere on this map reshuffles the cover —
 * `trenchKeepOut()` feeds `inWorks`, `plainsOpen` answers with it, and
 * `plains-cover.js` places every wreck against that answer — so the armour has
 * to be re-checked after EVERY edit to the line list, and a ninety-second gate
 * gets run once instead of every time. This reads the boot log and stops.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4624/?map=plains';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
const logs = [];
p.on('console', (m) => { const t = m.text(); if (/^\[tank\]|nachtfeld:/.test(t)) logs.push(t); });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id=' + await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id));
let legs = 0;
for (const t of logs) {
  if (/SPOKE DROPPED/.test(t)) console.log('  ' + t.replace(/^\s+/, ''));
  const m = t.match(/\[tank\] ([A-Z-]+): (\d+) legs —/);
  if (m) legs += Number(m[2]);
}
console.log(`  ${legs} of 36 tank legs baked`);
for (const t of logs) if (/nachtfeld:/.test(t)) console.log('  ' + t);
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs[0]}` : '[pageerror] none');
await b.close();
process.exit(legs >= 35 ? 0 : 1);
