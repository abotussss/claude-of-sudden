/**
 * DOES EACH SIDE ACTUALLY FIELD SNIPERS, AND ARE THEY HOLDING ONE?
 * Counts the bolt guns on a live roster per side and checks the VARIANT each
 * one was built with, which is what decides the mesh in his hands.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`http://127.0.0.1:4450/?seed=${+(args.seed ?? 7)}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await p.waitForFunction(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  return m && String(m.phase).toLowerCase() === 'live';
}, null, { timeout: 120000 }).catch(() => {});
await p.evaluate(() => new Promise((r) => { let i = 0; const t = () => (++i >= 40 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }));
const r = await p.evaluate(() => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  const side = [{}, {}], arch = [{}, {}], vars = [{}, {}], mismatch = [];
  for (const a of ai.agents) {
    const t = a.team === 1 ? 1 : 0;
    side[t][a.weaponId] = (side[t][a.weaponId] ?? 0) + 1;
    arch[t][a.archetype] = (arch[t][a.archetype] ?? 0) + 1;
    vars[t][a.variantName] = (vars[t][a.variantName] ?? 0) + 1;
    const holding = a.def?.variant?.weapon;
    if ((a.weaponId === 'sniper') !== (holding === 'sniper')) {
      mismatch.push({ n: a.name, weapon: a.weaponId, holding, variant: a.variantName });
    }
  }
  return { roster: ai.agents.length, weaponsBySide: side, archetypesBySide: arch,
    variantsBySide: vars, meshMismatches: mismatch };
});
console.log(JSON.stringify(r, null, 1));
console.log('pageerrors', errs.length, JSON.stringify(errs.slice(0, 5)));
await b.close();
process.exit(errs.length ? 1 : 0);
