/**
 * WHAT DOES A BANK ACTUALLY LOOK LIKE AT (growth, dark, rate)?
 *
 *   node _nfsmoketune.mjs "1.9,0.18,20" "1.9,0.5,40" ...
 *
 * The constants in `plains-cover.js` are authored against a density argument,
 * and the argument has now been wrong twice in this repo's history — so this
 * stops arguing and photographs it. It finds the real emitters, stands the
 * camera a fixed distance off the first one at its own height, then for each
 * triple mutates every bank, waits a full sprite life for the ring to turn
 * over, and shoots. One boot, one viewpoint, one variable.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = 'shots/nf-smoke-tune';
mkdirSync(OUT, { recursive: true });
const DIST = Number(process.env.DIST ?? 26);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto('http://127.0.0.1:4604/?map=plains&capture=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await p.evaluate(() => {
  const e = window.__ENGINE__; e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  const pl = e.ctx.peek('player'); if (pl) { pl.applyDamage = () => {}; setInterval(() => pl.heal?.(100), 250); }
  e.ctx.peek('ui')?.debugState?.('clean');
});
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await p.evaluate(() => { window.__ENGINE__.ctx.peek('match')._checkWinConditions = () => {}; window.__ENGINE__.ctx.peek('ui')?.debugState?.('clean'); });
await p.waitForTimeout(24000);
const frames = (n) => p.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

const where = await p.evaluate((dist) => {
  const e = window.__ENGINE__;
  const am = e.ctx.peek('fx').ambience;
  const act = am.emitters.filter((x) => x.active);
  if (!act.length) return null;
  const s = act[0];
  const V3 = e.camera.position.constructor;
  e.camera.position.set(s.x + dist, s.y + 1.4, s.z);
  e.camera.lookAt(new V3(s.x, s.y + 3.0, s.z));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  return { n: act.length, x: +s.x.toFixed(1), y: +s.y.toFixed(1), z: +s.z.toFixed(1) };
}, DIST);
console.log('banks', JSON.stringify(where), `camera ${DIST} m off the first`);

for (const spec of process.argv.slice(2)) {
  const [growth, dark, rate] = spec.split(',').map(Number);
  await p.evaluate(([g, d, r]) => {
    const am = window.__ENGINE__.ctx.peek('fx').ambience;
    for (const e of am.emitters) { if (!e.active) continue; e.growth = g; e.dark = d; e.rate = r; }
  }, [growth, dark, rate]);
  await p.waitForTimeout(11000);   // a full sprite life, so the ring is all-new
  await frames(20);
  const name = `g${growth}-d${dark}-r${rate}`;
  await p.screenshot({ path: `${OUT}/${name}.png` });
  const live = await p.evaluate(() => window.__ENGINE__.ctx.peek('fx').lit?.geometry?.instanceCount);
  console.log(`  · ${name}.png  litInstances=${live}`);
}
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs[0]}` : '[pageerror] none');
await b.close();
