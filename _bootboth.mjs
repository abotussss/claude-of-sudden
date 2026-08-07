/**
 * BOTH MAPS BOOT, WITH NO PAGE ERRORS — and the map id is ECHOED rather than
 * assumed. Several probes in this tree assemble `${URL}?capture=1` from a
 * `--url=...?map=plains` argument, which yields `?map=plains?capture=1`: the
 * map id parses as the string "plains?capture=1", no level matches, the TOWN
 * loads, and the probe reports itself as the plain. The `level.id` below is the
 * only thing that proves which map actually ran.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
let bad = 0;
for (const map of ['town', 'plains']) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(`http://127.0.0.1:4579/?capture=1&seed=7&map=${map}`, { waitUntil: 'domcontentloaded' });
  const ready = await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 }).then(() => true, () => false);
  const info = await page.evaluate(() => {
    const e = window.__ENGINE__;
    const dr = window.__DRONES__;
    return {
      level: e.ctx.peek('world')?.level?.id,
      ready: window.__READY__ === true,
      emp: (dr?.emp?.zones ?? []).map((z) => z.id),
      pool: dr?.list?.length ?? 0,
      dronesReady: dr?.ready === true,
    };
  });
  console.log(`${map.padEnd(7)} ready=${ready && info.ready} level=${info.level} drones=${info.dronesReady} pool=${info.pool} emp=[${info.emp}] pageerrors=${errs.length}${errs.length ? ' :: ' + errs.slice(0, 3).join(' | ') : ''}`);
  if (!ready || !info.ready || errs.length || info.level !== map) bad++;
  await page.close();
}
await browser.close();
console.log(bad ? `FAIL (${bad})` : 'BOTH MAPS OK');
process.exit(bad ? 1 : 0);
