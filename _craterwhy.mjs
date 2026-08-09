/**
 * A CRATER AND ONE OF THE PLAIN'S OWN BANKS, IN THE SAME FRAME.
 *
 *   node _craterwhy.mjs [--port=4637]
 *
 * `_cratershots.mjs` reported ten live craters and 393 sprites and photographed
 * frames with no smoke in them. `stats.sprites` is an ESTIMATE (`rate x life`)
 * and proves nothing was drawn, so this puts the crater NEXT TO a `nf-smoke`
 * bank — smoke that is known to read on this map at 30 m, tuned against a
 * photograph — and shoots both at once. If the bank shows and the crater does
 * not, the fault is in `craters.js`'s drawing; if neither shows, the fault is
 * the frame.
 *
 * It also prints MATCH time against wall time on every sample. On this box the
 * two differ by a factor of seven, which is the trap that made the first set of
 * screenshots one-second-old craters wearing sixty-second labels.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4637'}/?map=plains&capture=1`;
const OUT = 'shots/craterwhy';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1024, height: 576 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await page.waitForFunction(() => (window.__ENGINE__.ctx.peek('match')?.phase ?? '') === 'live', null, { timeout: 300000 });
await page.waitForTimeout(4000);

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('ui')?.setHudVisible?.(false);
  if (e.ctx.viewScene) e.ctx.viewScene.visible = false;
  const m = e.ctx.peek('match'); if (m) { m.roundClock = 1e6; m._checkWinConditions = () => {}; }
  const pl = e.ctx.peek('player'); if (pl) pl.applyDamage = () => {};
  e.ctx.time.scale = 3;
});

const setup = await page.evaluate(() => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics'), fx = e.ctx.peek('fx');
  const V3 = e.camera.position.constructor;
  const w = e.ctx.peek('world');
  let bank = null;
  w.root.traverse((o) => { if (!bank && o.name === 'nf-smoke') bank = o.position.clone(); });
  if (!bank) return null;
  // stand 46 m off the bank, on the line back to the map centre
  const L = Math.hypot(bank.x, bank.z) || 1;
  const cx = bank.x - (bank.x / L) * 46, cz = bank.z - (bank.z / L) * 46;
  const g = ph.groundHeight(cx, cz, 400);
  const cy = (Number.isFinite(g) ? g : 0) + 1.62;
  e.camera.position.set(cx, cy, cz);
  e.camera.lookAt(new V3(bank.x, bank.y + 5, bank.z));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  // two craters ON THE SAME LINE, 22 m and 32 m out, so bank and crater share a frame
  fx.craters.clear();
  const put = (d) => {
    const t = d / 46;
    const x = cx + (bank.x - cx) * t, z = cz + (bank.z - cz) * t;
    const h = ph.groundHeight(x, z, 400);
    fx.craterSmoke(x, Number.isFinite(h) ? h : 0, z, 15);
    return [+x.toFixed(1), +z.toFixed(1)];
  };
  const a = put(22), c = put(32);
  return { bank: [+bank.x.toFixed(1), +bank.z.toFixed(1)], cam: [+cx.toFixed(1), +cy.toFixed(2), +cz.toFixed(1)], craters: [a, c] };
});
console.log(`bank ${setup.bank}  cam ${setup.cam}  craters ${JSON.stringify(setup.craters)}`);

const look = () => page.evaluate(() => {
  const e = window.__ENGINE__, fx = e.ctx.peek('fx');
  const cs = fx.craters.craters.filter((k) => k.active);
  let ambRate = 0;
  for (const em of fx.ambience.emitters) if (em.active) ambRate += em.rate;
  return {
    elapsed: +e.ctx.time.elapsed.toFixed(1), dt: +e.ctx.time.dt.toFixed(3),
    spawned: fx.lit.spawned,
    age: +(cs[0]?.age ?? 0).toFixed(1), rate: +(cs[0]?.rate ?? 0).toFixed(1),
    n: cs.length, ambRate: +ambRate.toFixed(0),
    cam: [+e.camera.position.x.toFixed(1), +e.camera.position.y.toFixed(2), +e.camera.position.z.toFixed(1)],
  };
});

let prev = await look();
const w0 = Date.now();
console.log(`t0 ${JSON.stringify(prev)}`);
for (;;) {
  await page.waitForTimeout(2000);
  const s = await look();
  const wall = (Date.now() - w0) / 1000;
  console.log(`wall ${wall.toFixed(0)}s  match ${(s.elapsed - prev.elapsed).toFixed(1)}s/step  crater age ${s.age}s ` +
    `rate ${s.rate}/s  lit +${s.spawned - prev.spawned}  ambience ${s.ambRate}/s  cam ${s.cam}`);
  prev = s;
  if (s.age >= 12 || wall > 240) break;
}

await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });
await page.evaluate(() => new Promise((d) => { let i = 0; const t = () => (++i >= 10 ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }));
await page.screenshot({ path: `${OUT}/crater-vs-bank.png` });
const fin = await look();
console.log(`SHOT crater-vs-bank.png — crater age ${fin.age}s rate ${fin.rate}/s, cam ${fin.cam}, bank ${setup.bank}`);

// control: the craters suppressed, same frame, so the bank alone is visible
await page.evaluate(() => { const cf = window.__ENGINE__.ctx.peek('fx').craters; cf.enabled = false; cf.clear(); });
await page.waitForTimeout(12000);
await page.screenshot({ path: `${OUT}/bank-only.png` });
console.log('SHOT bank-only.png');
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs[0]}` : '0 pageerrors');
await b.close();
