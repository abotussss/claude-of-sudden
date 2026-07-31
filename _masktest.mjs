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

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const ph = e.ctx.peek('physics');
  const sw = ph.staticWorld;
  const sum = () => {
    let a = 0;
    let n = 0;
    for (let i = 0; i < sw.mask.length; i++) {
      if (sw.mask[i]) n++;
      a = (a * 31 + sw.mask[i] * (i % 97) + i) >>> 0;
    }
    return { a, n, len: sw.mask.length };
  };
  const before = sum();
  const recs = w.demolitions ?? [];
  // exactly what `_bakeCover` does: one block at a time, down and back up
  for (const r of recs) {
    r.setCollision(true);
    r.setCollision(false);
  }
  const after = sum();
  // and all six at once, then back
  for (const r of recs) r.setCollision(true);
  const allDown = sum();
  for (const r of recs) r.setCollision(false);
  const back = sum();
  return { before, after, allDown, back };
});
console.log('before  ', JSON.stringify(out.before));
console.log('cycled  ', JSON.stringify(out.after), out.after.a === out.before.a ? 'IDENTICAL' : 'DIFFERENT');
console.log('all down', JSON.stringify(out.allDown));
console.log('restored', JSON.stringify(out.back), out.back.a === out.before.a ? 'IDENTICAL' : 'DIFFERENT');
await browser.close();
