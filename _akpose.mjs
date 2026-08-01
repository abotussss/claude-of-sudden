/**
 * POSE DUMP — the local transform of every AK sub-assembly, in hip and in ADS.
 *
 * The body of a weapon is merged into one geometry per material inside one
 * `group`, so a pose can only move the whole gun; what a pose CAN move
 * independently is the five moving assemblies (magazine, charging handle, bolt,
 * trigger, selector). This dumps their matrices in both poses so the offline
 * part-gap measurement can be run per pose rather than assumed pose-invariant.
 *
 *   node _akpose.mjs --url=http://127.0.0.1:4292/ > /tmp/akpose.json
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4292/';
const WEAPON = args.w ?? 'ak';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const pump = (n) =>
  page.evaluate(
    (n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }),
    n
  );

const out = {};
for (const kind of ['idle', 'ads']) {
  await page.evaluate(([k, w]) => window.__ENGINE__.ctx.peek('weapons').debugPose(k, { weapon: w }), [kind, WEAPON]);
  await pump(60);
  out[kind] = await page.evaluate((w) => {
    const vm = window.__ENGINE__.ctx.peek('weapons').viewmodel;
    const e = vm.weapons.get(w);
    const res = { adsT: vm.adsT, parts: {}, group: e.group.matrix.toArray() };
    for (const [k, o] of Object.entries(e.parts)) {
      if (!o) continue;
      o.updateMatrix();
      res.parts[k] = { m: o.matrix.toArray(), visible: o.visible };
    }
    return res;
  }, WEAPON);
}
console.log(JSON.stringify({ weapon: WEAPON, errs, poses: out }, null, 1));
await browser.close();
