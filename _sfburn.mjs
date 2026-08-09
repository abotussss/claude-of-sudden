/**
 * DOES THE REGION ACTUALLY KILL THE PLAYER, AND DOES ITS EDGE ACTUALLY STOP?
 *
 * The whole "impassable" claim on the player's side is one number — he cannot
 * cross it — and `_sfbots.mjs` only measures the AI. So: fire the act, wait for
 * the region, then teleport the player to a series of points and read his
 * health off `player.healthFraction` a fixed number of seconds later.
 *
 * The one OUTSIDE the flame must not lose a point of health. If it does, the
 * region hurts where it is not drawn, which is the invisible hazard this
 * project has been shouted at for.
 */
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(process.argv[2] ?? 'http://127.0.0.1:4630/?map=plains', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await p.evaluate(() => (window.__ENGINE__.time.scale = 8));
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await p.evaluate(() => {
  const e = window.__ENGINE__; const m = e.ctx.peek('match');
  m._checkWinConditions = () => {}; e.time.scale = 1;
  e.input.frozen = true; e.ctx.peek('player')?.setControlEnabled?.(false);
  m.crash.fire();
});
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').crash._sky._live===true", null, { timeout: 300000 });
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
const trial = async (label, bearing, frac, secs) => {
  const put = await p.evaluate(([bearing, frac]) => {
    const e = window.__ENGINE__; const ph = e.ctx.peek('physics');
    const s = e.ctx.peek('match').crash._sky; const pl = e.ctx.peek('player');
    /** Walk out along `bearing` until `_inside` flips, then take `frac` of it. */
    let edge = 0;
    for (let r = 0; r < 140; r += 0.25) {
      if (!s._inside(s.centre.x + Math.cos(bearing) * r, s.centre.z + Math.sin(bearing) * r)) { edge = r; break; }
    }
    const r = edge * frac;
    const x = s.centre.x + Math.cos(bearing) * r;
    const z = s.centre.z + Math.sin(bearing) * r;
    const y = ph.groundHeight(x, z, 400) + 1.7;
    const V3 = e.camera.position.constructor;
    pl.heal(500);
    pl.teleport(new V3(x, y, z), e.camera.rotation);
    return { x: +x.toFixed(1), z: +z.toFixed(1), r: +r.toFixed(1), edge: +edge.toFixed(1),
      inside: s._inside(x, z), hp0: +(pl.healthFraction * 100).toFixed(0) };
  }, [bearing, frac]);
  await wait(Math.round(secs * 60));
  const hp = await p.evaluate(() => {
    const pl = window.__ENGINE__.ctx.peek('player');
    return { hp: +(pl.healthFraction * 100).toFixed(0), dead: pl.dead };
  });
  console.log(`  ${label.padEnd(28)} ${put.r} m of a ${put.edge} m radius, inside=${put.inside} · ` +
    `${put.hp0} -> ${hp.hp} HP after ${secs}s${hp.dead ? '  DEAD' : ''}`);
  if (hp.dead) await p.evaluate(() => window.__ENGINE__.ctx.peek('player').heal(500));
};
console.log('the region is alight; teleporting the player into and beside it\n');
/**
 * THE SURVIVABLE ONES FIRST, AND IT IS NOT TIDINESS. A dead player respawns at
 * his base, so a trial run after a lethal one measures a man standing 150 m
 * away on full health and reports it as "survived". That is how the first run
 * of this probe reported the middle of the fire as harmless.
 */
await trial('20 m outside', 0.4, 1.45, 6);
await trial('3 m outside the edge', 0.4, 1.06, 6);
await trial('two metres inside the edge', 0.4, 0.96, 2);
await wait(600); await p.evaluate(() => window.__ENGINE__.ctx.peek('player').heal(500));
await trial('halfway out', 0.4, 0.5, 2);
await wait(600); await p.evaluate(() => window.__ENGINE__.ctx.peek('player').heal(500));
await trial('dead centre', 0.4, 0.02, 4);
await wait(600); await p.evaluate(() => window.__ENGINE__.ctx.peek('player').heal(500));
await trial('a 4 s dash across a corner', 0.4, 0.9, 4);
console.log(errs.length ? `\nPAGEERRORS(${errs.length}) ${errs[0]}` : '\n0 pageerrors');
await b.close();
