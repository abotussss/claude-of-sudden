/**
 * THE CROSSINGS, PHOTOGRAPHED AT THREE RANGES — 30 m, 100 m, 200 m.
 *
 *   node _crossshots.mjs "--url=http://127.0.0.1:4604/?map=plains&capture=1" --out=shots/cross-before
 *
 * A number can say a lane is 220 m long; only a frame says whether the man at
 * the far end of it is a silhouette against a burning ridge or nothing at all.
 * The camera stands ON the route at a standing eye (1.62, `STANCE.stand`) and
 * looks down it at a point 30 / 100 / 200 m ahead, at the height a man's chest
 * would be there — so what is in the picture is exactly what is between a rifle
 * and a man walking the crossing at that range.
 *
 * `?map=plains` is checked at the far end through `world.level.id`: a shot of
 * the wrong map is the one piece of evidence that looks completely convincing.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4604/?map=plains&capture=1';
const OUT = args.out ?? 'shots/cross';
mkdirSync(OUT, { recursive: true });

/** [tag, from, to] — the route, in level metres (identity transform). */
const CROSS = [
  ['n-a', [-14, -150], [-118, -104]],   // north base -> zone A, the worst lane
  ['n-e', [-14, -150], [128, -86]],     // north base -> zone E, across the top
  ['a-c', [-118, -104], [-128, 86]],    // the whole west flank
  ['e-d', [128, -86], [0, 0]],          // north-east shoulder into the centre
];
const RANGES = [30, 100, 200];

const b = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level=${level} out=${OUT}`);
if (level !== 'plains') { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
  // The camera may not be shot. @see the same note in _nfshots.mjs.
  const pl = e.ctx.peek('player');
  if (pl) { pl.applyDamage = () => {}; pl._xHeal = setInterval(() => pl.heal?.(100), 250); }
});
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.ctx.peek('match')._checkWinConditions = () => {};
  // The HUD once the round is live — `debugState` before `live` is overwritten.
  e.ctx.peek('ui')?.debugState?.('clean');
  /**
   * THE EMP DOMES ARE NOT THE SUBJECT. `match-emp` is two 34 m green shells on
   * zones A and B (@see src/match/empzone.js) and they fill two thirds of a
   * frame taken from inside one — which is the frame this file needs, because
   * the crossings start at the zones. They carry no collision, so hiding them
   * changes the picture and not one number in `_plaincross.mjs`.
   */
  const emp = e.ctx.scene.getObjectByName('match-emp');
  if (emp) emp.visible = false;
});

const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

for (const [tag, from, to] of CROSS) {
  const L = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const tx = (to[0] - from[0]) / L, tz = (to[1] - from[1]) / L;
  for (const R of RANGES) {
    // Stand a little way onto the route so the base pad itself is behind us.
    const s = Math.min(24, Math.max(0, (L - R) / 2));
    const cx = from[0] + tx * s, cz = from[1] + tz * s;
    const ax = from[0] + tx * (s + R), az = from[1] + tz * (s + R);
    const y = await page.evaluate(([c, a]) => {
      const e = window.__ENGINE__, ph = e.ctx.peek('physics');
      const V3 = e.camera.position.constructor;
      const gh = (x, z) => { const h = ph.raycast(x, 300, z, 0, -1, 0, 400, ph.MASK.WORLD); return h.hit ? h.point.y : 0; };
      const cy = gh(c[0], c[1]) + 1.62;
      e.camera.position.set(c[0], cy, c[1]);
      // Look at a man's chest at the far end, not at the ground under him.
      e.camera.lookAt(new V3(a[0], gh(a[0], a[1]) + 1.2, a[1]));
      e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
      return +cy.toFixed(2);
    }, [[cx, cz], [ax, az]]);
    await frames(24);
    await page.screenshot({ path: `${OUT}/${tag}-${R}m.png` });
    console.log(`  · ${tag}-${R}m.png  eye ${y} at (${cx.toFixed(0)},${cz.toFixed(0)})`);
  }
}
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs[0]}` : '[pageerror] none');
await b.close();
