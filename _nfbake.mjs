/**
 * WHAT DID THE ARMOUR ACTUALLY BAKE, AND WHAT DID IT LOSE?
 *
 *   node _nfbake.mjs --url=http://127.0.0.1:4608/?map=plains
 *
 * `_dtankdiag.mjs` answers this but hard-codes its own base port and drives a
 * whole match to do it; the trench work needs the BOOT half of that answer once
 * per build, on whatever port is free. So: boot, echo `world.level.id` (the map
 * is observed, never intended — @see the note at the top of `_dtankdiag.mjs`),
 * and print every leg with its length and its narrowest span, plus every
 * `[tank] … SPOKE DROPPED` line VERBATIM. The reason is the whole value: a leg
 * that vanished because a new cut crossed it says "no ground at sample N", and
 * that sentence is the difference between a bug and a coordinate.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4608/?map=plains';

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
const logs = [];
p.on('console', (m) => { const t = m.text(); if (/\[tank\]|\[world\] nachtfeld|\[ai\] nav/.test(t)) logs.push(t); });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const out = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const a = m.tank;
  return {
    level: e.ctx.peek('world')?.level?.id ?? null,
    n: a?.tanks?.length ?? 0,
    routeN: a?._routeN ?? null,
    rows: (a?.tanks ?? []).map((t) => ({
      id: t.id,
      legs: t.legs.map((l) => ({
        zone: l.zone ?? 'HUB',
        len: +l.length.toFixed(1),
        narrow: +l.narrowest.toFixed(1),
        stop: l.stop,
        end: [+l.X[l.n - 1].toFixed(0), +l.Z[l.n - 1].toFixed(0)],
      })),
    })),
  };
});

console.log(`level.id=${out.level}  tanks=${out.n}/${out.routeN}`);
let legs = 0;
for (const r of out.rows) {
  console.log(`\n  ${r.id}  (${r.legs.length} legs)`);
  for (const l of r.legs) {
    legs++;
    console.log(`    ${String(l.zone).padEnd(4)} ${String(l.len).padStart(6)} m  narrowest ${String(l.narrow).padStart(5)} m  ends (${l.end})  — ${l.stop}`);
  }
}
console.log(`\n  TOTAL LEGS BAKED: ${legs}`);
console.log('\n=== CONSOLE ===');
for (const l of logs) console.log('  ' + l);
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs[0]}` : '[pageerror] none');
await b.close();
