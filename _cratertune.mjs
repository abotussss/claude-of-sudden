/**
 * HOW PALE DOES CRATER SMOKE HAVE TO BE TO EXIST AT NIGHT?
 *
 *   node _cratertune.mjs [--port=4637] [--dist=30]
 *
 * `_litcheck.mjs` proved the LIT layer draws — a column at `dark: 4.0` eight
 * metres out is a white wall — and `_craterwhy.mjs` proved that at 0.58 the
 * crater is not in the picture AT ALL, and neither is one of `plains-cover.js`'s
 * own permanent banks at 0.62 forty-six metres away. So this is the tune that
 * `_nfsmoketune.mjs` did for the banks, aimed at the craters: ONE camera, ONE
 * view, and `craters.dark` mutated between shots a full sprite life apart, so
 * paleness is compared with nothing else in the frame moving.
 *
 * `_puff` writes `dark` straight into a LIT particle's colour and the composite
 * multiplies by auto-exposure before AgX, so the axis is not linear and cannot
 * be reasoned about — it has to be photographed.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4637'}/?map=plains&capture=1`;
const DIST = Number(args.dist ?? 30);
const OUT = args.out ?? 'shots/cratertune';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1024, height: 576 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await page.waitForFunction(() => (window.__ENGINE__.ctx.peek('match')?.phase ?? '') === 'live', null, { timeout: 300000 });
await page.waitForTimeout(4000);

const site = await page.evaluate((dist) => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics'), fx = e.ctx.peek('fx');
  const V3 = e.camera.position.constructor;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('ui')?.setHudVisible?.(false);
  if (e.ctx.viewScene) e.ctx.viewScene.visible = false;
  const m = e.ctx.peek('match'); if (m) { m.roundClock = 1e6; m._checkWinConditions = () => {}; }
  const pl = e.ctx.peek('player'); if (pl) pl.applyDamage = () => {};
  e.ctx.time.scale = 3;
  // The middle of a proved-open bomber run: ground a real stick walks.
  const run = window.__BOMBER__.runs.find((r) => r.id === 'OPEN-7') ?? window.__BOMBER__.runs[0];
  const a = run.bombs[0].impact, z = run.bombs[run.bombs.length - 1].impact;
  const tx = (a.x + z.x) / 2, tz = (a.z + z.z) / 2;
  /**
   * A STANDING PLACE WITH THE TARGET ACTUALLY IN IT.
   *
   * Three frames in a row on this map were photographed from inside a wall,
   * because "30 m perpendicular to the run line" is a formula and not a place.
   * So: sweep the bearings, keep the ones whose ground is real and whose eye
   * has an unobstructed ray to the target, and take the first that passes.
   */
  const gt0 = ph.groundHeight(tx, tz, 400);
  const tgt = { x: tx, y: (Number.isFinite(gt0) ? gt0 : 0) + 3, z: tz };
  let cx = 0, cz = 0, cy = 0, found = false;
  for (let k = 0; k < 24 && !found; k++) {
    const bear = (k / 24) * Math.PI * 2;
    const px = tx + Math.cos(bear) * dist, pz = tz + Math.sin(bear) * dist;
    const g = ph.groundHeight(px, pz, 400);
    if (!Number.isFinite(g) || g < -1e4) continue;
    const ey = g + 1.62;
    const dx = tgt.x - px, dy = tgt.y - ey, dz = tgt.z - pz;
    const L = Math.hypot(dx, dy, dz);
    const hit = ph.raycast(px, ey, pz, dx / L, dy / L, dz / L, L - 1.5, ph.MASK.WORLD);
    if (hit?.hit) continue;
    cx = px; cz = pz; cy = ey; found = true;
  }
  if (!found) { cx = tx + dist; cz = tz; cy = (Number.isFinite(gt0) ? gt0 : 0) + 1.62; }
  const gt = gt0;
  e.camera.position.set(cx, cy, cz);
  e.camera.lookAt(new V3(tx, (Number.isFinite(gt) ? gt : 0) + Math.min(10, 3 + dist * 0.06), tz));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  fx.craters.clear();
  window.__SITE__ = [tx, tz];
  return { target: [+tx.toFixed(1), +tz.toFixed(1)], cam: [+cx.toFixed(1), +cy.toFixed(2), +cz.toFixed(1)],
    run: run.id, clear: found };
}, DIST);
console.log(`run ${site.run}  target ${site.target}  cam ${site.cam}  dist ${DIST} m  clearLOS=${site.clear}`);

const age = () => page.evaluate(() => {
  const cf = window.__ENGINE__.ctx.peek('fx').craters;
  let a = 0; for (const c of cf.craters) if (c.active && c.age > a) a = c.age;
  return a;
});
const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

/** Re-seed the five craters so the age stays in the billow window. */
const reseed = () => page.evaluate(() => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics'), fx = e.ctx.peek('fx');
  for (const c of fx.craters.craters) if (c.active) c.age = 0;
  void ph;
});

/** The REAL live population near the site, walked out of the ring — because
 *  `stats.sprites` is `rate x life` and has never been checked against a count. */
const ringCount = () => page.evaluate(() => {
  const fx = window.__ENGINE__.ctx.peek('fx');
  const l = fx.lit, A = l.array, S = 32, now = fx.now;
  const [tx, tz] = window.__SITE__;
  let live = 0, near = 0;
  for (let i = 0; i < l.capacity; i++) {
    const b = i * S, birth = A[b + 8], inv = A[b + 9];
    if (!inv) continue;
    const n = (now - birth) * inv;
    if (n < 0 || n >= 1) continue;
    live++;
    if (Math.hypot(A[b] - tx, A[b + 2] - tz) < 40) near++;
  }
  return { live, near, cap: l.capacity };
});

const COMBOS = (args.combos ?? '0.58:1,6:1,6:1.7,10:1.4,14:1,14:1.7').split(',').map((t) => t.split(':').map(Number));
for (const [d, op] of COMBOS) {
  await page.evaluate(([v, o]) => { const cf = window.__ENGINE__.ctx.peek('fx').craters; cf.dark = v; cf.opacity = o; cf.clear(); }, [d, op]);
  // rebuild the same five craters and give them a full sprite life at this value
  await page.evaluate(() => {
    const e = window.__ENGINE__, ph = e.ctx.peek('physics'), fx = e.ctx.peek('fx');
    const [tx, tz] = window.__SITE__;
    for (let i = -2; i <= 2; i++) {
      const x = tx + i * 12, z = tz + (i % 2 ? 4 : -4);
      const h = ph.groundHeight(x, z, 400);
      fx.craterSmoke(x, Number.isFinite(h) ? h : 0, z, 15);
    }
  });
  let guard = 0;
  while ((await age()) < 9 && guard++ < 90) { await reseed_if(); await page.waitForTimeout(1000); }
  await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });
  await frames(8);
  const st = await page.evaluate(() => {
    const cf = window.__ENGINE__.ctx.peek('fx').craters;
    let a = 0; for (const c of cf.craters) if (c.active && c.age > a) a = c.age;
    return { dark: cf.dark, age: +a.toFixed(1), live: cf.stats.live, sprites: cf.stats.sprites };
  });
  const rc = await ringCount();
  await page.screenshot({ path: `${OUT}/d${String(d).replace('.', 'p')}-a${String(op).replace('.', 'p')}-${DIST}m.png` });
  console.log(`  · dark ${d} opacity ${op}  age ${st.age}s  craters ${st.live}  estimate ${st.sprites}  ` +
    `RING live ${rc.live}/${rc.cap}, ${rc.near} within 40 m of the site`);
  await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 3; });
}
async function reseed_if() { /* craters age past BILLOW slowly; nothing to do */ }

console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs[0]}` : '0 pageerrors');
await b.close();
