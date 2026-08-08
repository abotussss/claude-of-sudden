/**
 * THE BOOT LOG, VERBATIM, FOR ONE MAP — every `[tank]`, `[ai]`, `[airstrike]`,
 * `[world]` and `[match]` line, so a spoke that never bakes says so in its own
 * words instead of being inferred from a route table.
 *
 *   BASE=http://127.0.0.1:4626/ MAP=plains node _tzboot.mjs [grep]
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4626/';
const MAP = process.env.MAP ?? 'plains';
const RE = new RegExp(process.argv[2] ?? '.');
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { const t = m.text(); if (RE.test(t)) console.log(t); });
await page.goto(`${BASE}?capture=1&map=${MAP}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('--- level.id', await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));
console.log('--- pageerrors', errs.length, errs[0] ?? '');
await b.close();
