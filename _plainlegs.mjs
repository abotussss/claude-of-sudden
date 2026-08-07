/**
 * EVERY TANK LEG ON THE PLAIN, KEPT AND DROPPED — read off the boot log.
 *
 *   node _plainlegs.mjs "--url=http://127.0.0.1:4604/?map=plains&capture=1"
 *
 * `_dtankdiag.mjs` and `_dtankmatch.mjs` both hard-code `http://127.0.0.1:4579/`
 * and ignore their URL argument, so neither can be pointed at another agent's
 * preview. This asks the two questions those files ask about the ROUTES — how
 * many legs baked, how long each is, and what `_bakePath` said about the ones it
 * threw away — off whatever URL it is given, and it echoes `world.level.id` so a
 * run against the town cannot be mistaken for a run against the plain.
 *
 * The boot log is the authority: `Armour` re-bakes every polyline against the
 * BUILT world, so a wreck dropped on a spoke is a leg that quietly stops
 * existing and the only place that is ever said out loud is `[tank]`.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4604/?map=plains&capture=1';

const b = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 500 } });
const logs = []; const errs = [];
page.on('console', (m) => { const t = m.text(); if (/\[tank\]/.test(t)) logs.push(t); });
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level =', await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? '?'));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match')?.phase==='live'", null, { timeout: 300000 });
await page.waitForTimeout(3000);

const rows = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const a = m.tank;
  return {
    ready: !!a?.ready,
    hulls: (a?.tanks ?? []).map((t) => ({
      id: t.id, team: t.team,
      route: +(t.path?.length ?? 0).toFixed(1),
      samples: t.path?.n ?? 0,
      legs: (t.legs ?? t.spurs ?? []).length || null,
    })),
  };
});
console.log(JSON.stringify(rows, null, 1));
console.log('\n--- [tank] boot lines ---');
for (const l of logs) console.log(l);
console.log(errs.length ? `\n[pageerror] ${errs.length}: ${errs[0]}` : '\n[pageerror] none');
await b.close();
