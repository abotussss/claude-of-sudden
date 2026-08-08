/**
 * STAND SOMEWHERE ON THE PLAIN AND LOOK AT SOMETHING.
 *
 *   node _nflook.mjs "--url=…/?map=plains&capture=1" --out=shots/x \
 *     --shot=name:fx,fz:tx,tz[:eye]
 *
 * The general-purpose version of `_crossshots.mjs`, for the frames that are not
 * about a crossing: the ground under your feet, a berm at ten metres, a smoke
 * bank at thirty, the same ground near a fire and far from every fire. The
 * lighting on this map is being made much darker by another agent with the
 * burning ridge as the key, so ANY judgement about ground detail has to be made
 * in both — a frame taken 40 m off a fire and a frame taken 150 m from the
 * nearest one are two different maps.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = [];
const opt = {};
for (const a of process.argv.slice(2)) {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  const k = i < 0 ? s : s.slice(0, i); const v = i < 0 ? true : s.slice(i + 1);
  if (k === 'shot') args.push(String(v)); else opt[k] = v;
}
const URL = opt.url ?? 'http://127.0.0.1:4604/?map=plains&capture=1';
const OUT = opt.out ?? 'shots/nflook';
mkdirSync(OUT, { recursive: true });

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
  const pl = e.ctx.peek('player');
  if (pl) { pl.applyDamage = () => {}; pl._xHeal = setInterval(() => pl.heal?.(100), 250); }
});
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.ctx.peek('match')._checkWinConditions = () => {};
  e.ctx.peek('ui')?.debugState?.('clean');
  const emp = e.ctx.scene.getObjectByName('match-emp');
  if (emp) emp.visible = false;
});
const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

/**
 * ──────────────────────────────────────────────────────────────────────────
 * LET THE BANKS FILL, AND 14 s IS NOT ENOUGH — MEASURED
 * ──────────────────────────────────────────────────────────────────────────
 * Two waits are in series here and only the second one was accounted for.
 *
 * `Ambience._scan` walks the scene for `userData.fxSmoke` on a 2 s timer and
 * does not run at all until `fx` is updating, so a world-authored bank does not
 * EXIST until about 11.5 s after `__READY__`. Only then does it begin to fill,
 * and it is not the bank the player sees until it is `life` old — 8.5 s.
 *
 * Measured on this map: at the old 14 s the four banks were 1-3 s old and held
 * about 60 sprites between them, and photographs at 30 m and 80 m showed a 3 m
 * blob. At age 10.4 s they hold their authored 168 each. That is the entire
 * difference between "the smoke is broken" and "the probe was early", and the
 * first reading cost a smoke re-tune that was not needed.
 */
await frames(2);
await page.waitForTimeout(26000);

for (const spec of args) {
  const [name, from, to, eye] = spec.split(':');
  const f = from.split(',').map(Number);
  const t = to.split(',').map(Number);
  const y = await page.evaluate(([c, a, ey]) => {
    const e = window.__ENGINE__, ph = e.ctx.peek('physics');
    const V3 = e.camera.position.constructor;
    const gh = (x, z) => { const h = ph.raycast(x, 300, z, 0, -1, 0, 400, ph.MASK.WORLD); return h.hit ? h.point.y : 0; };
    const cy = gh(c[0], c[1]) + ey;
    e.camera.position.set(c[0], cy, c[1]);
    e.camera.lookAt(new V3(a[0], gh(a[0], a[1]) + 1.4, a[1]));
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    return +cy.toFixed(2);
  }, [f, t, Number(eye ?? 1.62)]);
  await frames(30);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  · ${name}.png  eye ${y} at (${f[0]},${f[1]}) -> (${t[0]},${t[1]})`);
}
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs[0]}` : '[pageerror] none');
await b.close();
