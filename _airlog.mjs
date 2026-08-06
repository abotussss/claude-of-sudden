/**
 * WHAT THE AIR WAR AND THE ARMOUR BAKED, PER MAP.
 *
 * The four geography-bearing systems in `src/match` each print a `n/m baked`
 * line at boot and each DROPS its authored entries with a reason. This collects
 * those lines plus the live counts, so "five legs baked off the town's
 * polylines" is a measurement rather than a reading of the source.
 *
 *   node _airlog.mjs http://127.0.0.1:4576/?map=plains&seed=7
 */
import { chromium } from 'playwright';
const URL = process.argv[2];
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 560 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
const logs = [];
p.on('console', (m) => {
  const t = m.text();
  if (/\[airstrike\]|\[bomber\]|\[strafe\]|\[tank\]/i.test(t)) logs.push(t.slice(0, 500));
});
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await p.evaluate(() => new Promise((d) => { let i = 0; const t = () => (++i >= 60 ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }));
const s = await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const f = (o) => (o ? { ready: !!o.ready, n: (o.sites ?? o.runs ?? o.tanks ?? []).length } : null);
  return {
    map: window.__ENGINE__.ctx.peek('world')?.level?.id,
    airstrike: f(m.airstrike),
    salvos: (m.airstrike?.salvos ?? []).map((s) => s.id),
    bomber: f(m.bomber),
    strafe: f(m.strafe),
    tank: f(m.tank),
    tanks: (m.tank?.tanks ?? []).map((t) => ({
      id: t.id, team: t.team,
      legs: t.legs.map((l) => ({ zone: l.zone ?? 'HUB', len: +l.length.toFixed(0) })),
    })),
  };
});
for (const l of logs) console.log(l);
console.log('SUMMARY ' + JSON.stringify(s, null, 1));
console.log(errs.length ? 'PAGEERROR: ' + errs.slice(0, 5).join(' | ') : 'boot clean, 0 pageerrors');
await b.close();
process.exit(errs.length ? 1 : 0);
