/** Everything the armour prints at boot, plus a page-error gate. */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4291/';
const SEED = process.argv[3] ?? '';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; const logs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 300)));
page.on('console', (m) => { const t = m.text(); if (/\[tank\]/.test(t)) logs.push(t); });
await page.goto(`${URL}?capture=1${SEED ? `&seed=${SEED}` : ''}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const info = await page.evaluate(() => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), a = m.tank;
  return {
    seed: e.levelSeed, buildMs: Math.round(a.buildMs),
    atlas: a._atlas ? { recs: a._atlas.recs.length, cells: a._atlas.cells.size } : null,
    tanks: a.tanks.map((t) => ({
      id: t.id,
      legs: t.legs.map((l) => ({ zone: l.zone ?? 'HUB', len: +l.length.toFixed(1), n: l.n, narrow: +l.narrowest.toFixed(1), stop: l.stop ?? '' })),
      piles: t.plough?.length ?? 0,
    })),
  };
});
console.log(logs.join('\n'));
console.log(JSON.stringify(info, null, 1));
console.log(errs.length ? `[pageerror] ${errs.slice(0, 4).join('\n | ')}` : '[pageerror] none');
await b.close();
