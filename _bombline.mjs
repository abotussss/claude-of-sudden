/**
 * ════════════════════════════════════════════════════════════════════════════
 * 「占領サイトへの直接はダメ」 — MEASURED, over a whole match
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _bombline.mjs [--url=…] [--scale=20] [--secs=1250]
 *
 * The generator in `src/match/bomber.js` proves every candidate line against
 * the resolved capture circles AT BOOT. This asks the other question — does
 * anything actually land on a point once the match is running — by listening
 * to every `match:bomber` impact, every `explosion` on the bus, and measuring
 * each one against the live zone positions.
 *
 * It also counts the sorties, because 「それを定期的に起こす」 is a rate and the
 * boot log cannot report one.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4609/?map=plains';
const SCALE = Number(args.scale ?? 20);
const SECS = Number(args.secs ?? 1250);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 560 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });

await p.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  m._checkWinConditions = () => {};
  const B = (window.__B__ = { impacts: 0, worst: 1e9, worstZone: '', inside: [], runs: new Set(), sorties: 0, t: [] });
  const zonesOf = () => m.allZones.map((z) => ({ id: z.id, x: z.position.x, z: z.position.z, r: z.radius ?? 14 }));
  e.ctx.events.on('match:bomber', (ev) => {
    if (ev.phase === 'inbound') { B.sorties++; B.runs.add(ev.run?.id ?? '?'); B.t.push(+(1200 - m.roundClock).toFixed(0)); return; }
    if (ev.phase !== 'impact' || !ev.position) return;
    B.impacts++;
    for (const z of zonesOf()) {
      const d = Math.hypot(ev.position.x - z.x, ev.position.z - z.z) - z.r;
      if (d < B.worst) { B.worst = d; B.worstZone = z.id; }
      if (d < 0) B.inside.push(`${ev.run?.id ?? '?'}->${z.id} ${d.toFixed(1)}m inside`);
    }
  });
});
await p.evaluate((s) => (window.__ENGINE__.time.scale = s), SCALE);
const t0 = await p.evaluate(() => 1200 - window.__ENGINE__.ctx.peek('match').roundClock);
for (;;) {
  await new Promise((r) => setTimeout(r, 2000));
  const t = await p.evaluate(() => 1200 - window.__ENGINE__.ctx.peek('match').roundClock);
  if (t - t0 >= SECS || (await p.evaluate(() => window.__ENGINE__.ctx.peek('match').phase !== 'live'))) break;
}
const o = await p.evaluate(() => {
  const B = window.__B__;
  return { ...B, runs: [...B.runs], elapsed: +(1200 - window.__ENGINE__.ctx.peek('match').roundClock).toFixed(0) };
});
console.log(`\n  ${o.elapsed - t0}s of live match`);
console.log(`  bomber sorties: ${o.sorties} at t=${o.t.join(', ')}s`);
console.log(`  lines flown (${o.runs.length}): ${o.runs.join(' ')}`);
console.log(`  bomb impacts: ${o.impacts}`);
console.log(`  closest any impact came to the EDGE of a capture circle: ${o.worst === 1e9 ? 'n/a' : o.worst.toFixed(1) + ' m (' + o.worstZone + ')'}`);
console.log(`  impacts INSIDE a capture circle: ${o.inside.length ? o.inside.join(' | ') : 'NONE'}`);
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs[0]}` : '0 pageerrors');
await b.close();
