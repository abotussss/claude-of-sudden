/**
 * WHEN IS THE SMOKE ACTUALLY THERE, AND DOES IT READ IN THE DARK?
 *
 *   node _nfsmokewhen.mjs [--port=4613]
 *
 * Two questions the tune measurements never asked. `Ambience._scan` runs on a
 * 2 s timer and a world-authored bank does not exist until the level is built,
 * so the first frames of a match may genuinely have none — and 252 live sprites
 * a bank is a number about the bank, not about whether a man sixty metres away
 * can see it. So: the live sprite count per emitter against the wall clock from
 * `__READY__`, and then the same bank photographed from 30, 100 and 200 m at a
 * standing eye.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4613'}/?map=plains&capture=1`;
const OUT = args.out ?? 'shots/nfsmoke';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const t0 = Date.now();
console.log(`level=${await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id)}`);

const sample = () => page.evaluate(() => {
  const e = window.__ENGINE__;
  const fx = e.ctx.peek('fx');
  const amb = fx?.ambience;
  const em = amb?.emitters ?? [];
  const nf = em.filter((x) => x?.source?.name === 'nf-smoke' || x?.name === 'nf-smoke' || x?.persistent);
  let live = 0;
  const lit = fx?.lit;
  if (lit) live = lit.live ?? lit.count ?? lit.active ?? -1;
  return {
    emitters: em.length,
    nf: nf.length,
    litLive: live,
    litCap: lit?.capacity ?? lit?.max ?? -1,
    phase: e.ctx.peek('match')?.phase ?? '?',
  };
});

for (const t of [0, 3, 6, 10, 15, 25, 45, 70]) {
  while ((Date.now() - t0) / 1000 < t) await page.waitForTimeout(200);
  const s = await sample();
  console.log(`  t+${String(t).padStart(3)}s  phase=${String(s.phase).padEnd(7)} ambience emitters ${s.emitters}` +
    ` (persistent ${s.nf})  fx.lit live ${s.litLive}/${s.litCap}`);
}

// …and what one of them looks like at three ranges, from a standing eye.
const bank = await page.evaluate(() => {
  const w = window.__ENGINE__.ctx.peek('world');
  let found = null;
  w.root.traverse((o) => { if (!found && o.name === 'nf-smoke') found = [o.position.x, o.position.y, o.position.z]; });
  return found;
});
console.log(`bank at ${JSON.stringify(bank)}`);
if (bank) {
  await page.evaluate(() => {
    const e = window.__ENGINE__;
    e.input.frozen = true; e.input.enabled = false;
    e.ctx.peek('ui')?.debugState?.('clean');
    const m = e.ctx.peek('match'); if (m) { m.roundClock = 1e6; m._checkWinConditions = () => {}; }
    const pl = e.ctx.peek('player'); if (pl) pl.applyDamage = () => {};
  });
  const frames = (n) => page.evaluate((k) =>
    new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
  for (const d of [30, 100, 200]) {
    const dir = Math.atan2(bank[0], bank[2]);
    const y = await page.evaluate(([bx, by, bz, dist]) => {
      const e = window.__ENGINE__, ph = e.ctx.peek('physics');
      const V3 = e.camera.position.constructor;
      // stand `dist` metres from the bank, on the line back towards the map centre
      const L = Math.hypot(bx, bz) || 1;
      const x = bx - (bx / L) * dist, z = bz - (bz / L) * dist;
      const h = ph.raycast(x, 300, z, 0, -1, 0, 400, ph.MASK.WORLD);
      const cy = (h.hit ? h.point.y : 0) + 1.62;
      e.camera.position.set(x, cy, z);
      e.camera.lookAt(new V3(bx, by + 3, bz));
      e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
      return +cy.toFixed(2);
    }, [bank[0], bank[1], bank[2], d]);
    await frames(50);
    await page.screenshot({ path: `${OUT}/bank-${d}m.png` });
    console.log(`  · bank-${d}m.png  eye y ${y}  (bearing ${(dir * 180 / Math.PI).toFixed(0)})`);
  }
}
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs[0]}` : '0 pageerrors');
await b.close();
