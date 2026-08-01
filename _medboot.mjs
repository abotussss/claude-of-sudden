import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
const logs = []; page.on('console', (m) => { const t = m.text(); if (/medical zone|caches bound|MEDICAL/.test(t)) logs.push(t); });
await page.goto('http://127.0.0.1:4294/?capture=1&seed=11', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const r = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const med = m.caches.list.filter((c) => c.kind === 'medic');
  return { seed: window.__ENGINE__.levelSeed, total: m.caches.list.length,
    med: med.map((c) => ({ id: c.id, label: c.label, stand: !!c.stand,
      p: [+c.position.x.toFixed(1), +c.position.y.toFixed(2), +c.position.z.toFixed(1)] })),
    dressing: !!m.caches.medGroup };
});
console.log(logs.join('\n'));
console.log(JSON.stringify(r, null, 1));
console.log(errs.length ? `[pageerror] ${errs.slice(0,3).join(' | ')}` : '[pageerror] none');
await b.close();
