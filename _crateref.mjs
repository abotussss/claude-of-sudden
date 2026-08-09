/**
 * THE CRATER AGAINST THE MAP'S OWN REFERENCE SMOKE, WITH BOTH PROVED IN FRAME.
 *
 *   node _crateref.mjs [--port=4637]
 *
 * Before accepting a `dark` twenty times `plains-cover.js`'s measured 0.62, one
 * question has to be answered: is 0.62 STILL VISIBLE on this map? If it is, a
 * crater at 0.58 that vanishes is a fault in `craters.js`; if it is not, the
 * map's night smoke reads differently than when that value was photographed and
 * any number tuned against today's frame will blow out white when that changes.
 *
 * So: stand where a `nf-smoke` bank is proved in shot — line of sight raycast,
 * NDC printed — put craters at the same range on the same bearing, and take the
 * frame twice, at the authored 0.58 and at the candidate. Four numbers per
 * frame: bank range, bank NDC, crater range, crater NDC.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4637'}/?map=plains&capture=1`;
const OUT = 'shots/crateref';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1024, height: 576 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await page.waitForFunction(() => (window.__ENGINE__.ctx.peek('match')?.phase ?? '') === 'live', null, { timeout: 300000 });
await page.waitForTimeout(4000);

const setup = await page.evaluate(() => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics'), fx = e.ctx.peek('fx');
  const V3 = e.camera.position.constructor;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('ui')?.setHudVisible?.(false);
  if (e.ctx.viewScene) e.ctx.viewScene.visible = false;
  const m = e.ctx.peek('match'); if (m) { m.roundClock = 1e6; m._checkWinConditions = () => {}; }
  const pl = e.ctx.peek('player'); if (pl) pl.applyDamage = () => {};
  e.ctx.time.scale = 3;

  const w = e.ctx.peek('world');
  const banks = [];
  w.root.traverse((o) => { if (o.name === 'nf-smoke') banks.push(o.position.clone()); });

  // find a bank and a standing place 34 m off it with an unobstructed eye
  let best = null;
  for (const bk of banks) {
    for (let k = 0; k < 32 && !best; k++) {
      const bear = (k / 32) * Math.PI * 2;
      const px = bk.x + Math.cos(bear) * 34, pz = bk.z + Math.sin(bear) * 34;
      const g = ph.groundHeight(px, pz, 400);
      if (!Number.isFinite(g) || g < -1e4) continue;
      const ey = g + 1.62;
      const dx = bk.x - px, dy = bk.y + 3 - ey, dz = bk.z - pz;
      const L = Math.hypot(dx, dy, dz);
      if (ph.raycast(px, ey, pz, dx / L, dy / L, dz / L, L - 2, ph.MASK.WORLD)?.hit) continue;
      best = { bk, px, pz, ey, bear };
    }
    if (best) break;
  }
  if (!best) return null;
  e.camera.position.set(best.px, best.ey, best.pz);
  e.camera.lookAt(new V3(best.bk.x, best.bk.y + 6, best.bk.z));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);

  // craters at the SAME range, 18 m either side of the bank across the view
  fx.craters.clear();
  const ux = -Math.sin(best.bear), uz = Math.cos(best.bear);
  window.__CR__ = [];
  for (const s of [-18, 0, 18]) {
    const x = best.bk.x + ux * s, z = best.bk.z + uz * s;
    if (s === 0) continue; // leave the bank's own spot alone
    const h = ph.groundHeight(x, z, 400);
    fx.craterSmoke(x, Number.isFinite(h) ? h : 0, z, 15);
    window.__CR__.push([x, Number.isFinite(h) ? h : 0, z]);
  }
  window.__BK__ = [best.bk.x, best.bk.y, best.bk.z];
  return { bank: [+best.bk.x.toFixed(1), +best.bk.y.toFixed(1), +best.bk.z.toFixed(1)],
    cam: [+best.px.toFixed(1), +best.ey.toFixed(2), +best.pz.toFixed(1)], banks: banks.length };
});
if (!setup) { console.log('NO CLEAR BANK VANTAGE'); await b.close(); process.exit(1); }
console.log(JSON.stringify(setup));

const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

const report = () => page.evaluate(() => {
  const e = window.__ENGINE__, fx = e.ctx.peek('fx'), cam = e.camera;
  const V3 = cam.position.constructor;
  const v = new V3();
  const proj = (p, dy) => { v.set(p[0], p[1] + dy, p[2]); const d = v.distanceTo(cam.position); const q = v.clone().project(cam);
    return { d: +d.toFixed(1), ndc: [+q.x.toFixed(2), +q.y.toFixed(2)] }; };
  const l = fx.lit, A = l.array, S = 32, now = fx.now;
  const bk = window.__BK__;
  let nearBank = 0, nearCr = 0;
  for (let i = 0; i < l.capacity; i++) {
    const b = i * S, birth = A[b + 8], inv = A[b + 9];
    if (!inv) continue;
    const n = (now - birth) * inv;
    if (n < 0 || n >= 1) continue;
    if (Math.hypot(A[b] - bk[0], A[b + 2] - bk[2]) < 12) nearBank++;
    for (const c of window.__CR__) if (Math.hypot(A[b] - c[0], A[b + 2] - c[2]) < 12) { nearCr++; break; }
  }
  let age = 0; for (const c of fx.craters.craters) if (c.active && c.age > age) age = c.age;
  return { bank: proj(bk, 4), craters: window.__CR__.map((c) => proj(c, 4)),
    bankSprites: nearBank, craterSprites: nearCr, dark: fx.craters.dark, opacity: fx.craters.opacity,
    age: +age.toFixed(1), live: fx.craters.stats.live };
});

const COMBOS = (args.combos ?? '0.58:1,1.1:1.25,1.8:1.25,2.8:1.1,4.2:1').split(',').map((t) => t.split(':').map(Number));
for (const [d, op] of COMBOS) {
  await page.evaluate(([v, o]) => {
    const cf = window.__ENGINE__.ctx.peek('fx').craters;
    cf.dark = v; cf.opacity = o; cf.clear();
    const e = window.__ENGINE__, ph = e.ctx.peek('physics');
    for (const c of window.__CR__) { const h = ph.groundHeight(c[0], c[2], 400); e.ctx.peek('fx').craterSmoke(c[0], Number.isFinite(h) ? h : 0, c[2], 15); }
  }, [d, op]);
  for (let i = 0; i < 60; i++) {
    const a = await page.evaluate(() => { let a = 0; for (const c of window.__ENGINE__.ctx.peek('fx').craters.craters) if (c.active && c.age > a) a = c.age; return a; });
    if (a >= 9) break;
    await page.waitForTimeout(1000);
  }
  await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });
  await frames(8);
  const r = await report();
  await page.screenshot({ path: `${OUT}/bank-vs-crater-d${String(d).replace('.', 'p')}-a${String(op).replace('.', 'p')}.png` });
  console.log(`  · dark ${d} op ${op}: bank ${JSON.stringify(r.bank)} ${r.bankSprites} sprites | ` +
    `craters ${JSON.stringify(r.craters)} ${r.craterSprites} sprites, age ${r.age}s`);
  await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 3; });
}
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs[0]}` : '0 pageerrors');
await b.close();
