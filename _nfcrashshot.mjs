/**
 * THE CRASH, CLOSE UP — the approach, the impact, the plough and the scar.
 *
 *   node _nfcrashshot.mjs [--url=…] [--out=shots/nachtfeld]
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS ONE FORCES THE SUBSYSTEM, AND SAYS SO
 * ────────────────────────────────────────────────────────────────────────────
 * `_nfshots.mjs` photographs the acts as the SCHEDULE plays them and forces
 * nothing — that is the run that proves the event happens. It costs a whole
 * match per look, which is the wrong tool for judging whether a flame reads as
 * a flame.
 *
 * So this calls `crash.fire()` directly, the moment the round is live, and
 * photographs the thirteen seconds that follow from four vantages. It proves
 * NOTHING about when the act fires or whether the schedule reaches it. It is
 * only for the question no number answers: 「過激にそして激しく」, does it look
 * like something came down and set the plain on fire.
 *
 * It also measures what a raycast cannot: the flames and the wreck carry NO
 * COLLISION, so `_floatcheck.mjs` is structurally blind to them. Every flame
 * instance's base is compared against `physics.groundHeight` at its own x/z.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4578/?map=plains&capture=1';
const OUT = args.out ?? 'shots/nachtfeld';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.stack ?? e.message)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
if (level !== 'plains') { console.error(`NOT THE PLAIN (${level})`); await b.close(); process.exit(2); }

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
  const pl = e.ctx.peek('player');
  if (pl) { pl.applyDamage = () => {}; setInterval(() => pl.heal?.(100), 250); }
});
const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
const place = (from, at, eye) => page.evaluate(([f, a, eye]) => {
  const e = window.__ENGINE__, phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const h = phys.raycast(f[0], 300, f[1], 0, -1, 0, 400, phys.MASK.WORLD);
  const y = (h.hit ? h.point.y : 0) + eye;
  e.camera.position.set(f[0], y, f[1]);
  e.camera.lookAt(new V3(a[0], a[1], a[2]));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
}, [from, at, eye]);
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log(`  · ${n}.png`); };

await page.evaluate(() => (window.__ENGINE__.time.scale = 8));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._checkWinConditions = () => {};
  window.__ENGINE__.time.scale = 1;
});

/**
 * THREE CAMERAS, ALL ON OPEN PLAIN. The first two attempts stood at (40, 20)
 * and (26, -4) and photographed the inside of the fortress's glacis and the
 * inside of the tower's podium respectively — a stand-off measured against a
 * structure's CENTRE is not a stand-off, because a fortress is 72 m across.
 *
 * `UP` looks north along the incoming bearing, so the satellite descends toward
 * the lens. `WIDE` is abeam the impact. `CLOSE` stands 33 m off the track's
 * centreline, ~21 m clear of a 24 m swathe.
 */
const UP =    [[-45, 70],  [-56, 40, -35], 2.0];
const WIDE =  [[-45, 70],  [-58, 6, -34],  2.0];
const CLOSE = [[-40, 60],  [-75, 4, 72],   1.62];

await place(...WIDE);
await frames(8);
await shot('CRASH-0-before');

console.log('crash:', await page.evaluate(() => window.__ENGINE__.ctx.peek('match').crash.fire()));
const at = (t) => page.waitForFunction((t) => (window.__ENGINE__.ctx.peek('match').crash?._t ?? -1) >= t, t, { timeout: 120000 });

for (const [tag, t, cam] of [
  ['1-approach-high', 3.0, UP], ['2-approach-low', 8.5, UP], ['3-committed', 11.8, UP],
  ['4-impact', 13.25, WIDE], ['5-plough', 15.2, WIDE], ['6-plough-close', 17.0, CLOSE],
]) {
  await at(t);
  await place(...cam);
  await frames(1);
  await shot(`CRASH-${tag}`);
}

await frames(180);
for (const [tag, cam] of [['7-scar-close', CLOSE], ['8-scar-wide', WIDE],
  ['9-scar-high', [[40, 150], [-70, 10, 40], 26]]]) {
  await place(...cam);
  await frames(8);
  await shot(`CRASH-${tag}`);
}

/**
 * AND THE ONE MEASUREMENT A RAY CANNOT MAKE. Neither the flames nor the wreck
 * carry collision, so `_floatcheck.mjs` cannot see them at all — 「空中に瓦礫が
 * 浮いてます」 has shipped four times on this project and three of those were
 * things a raycast was blind to. Every flame's base against the real ground at
 * its own x/z, read straight out of the baked instance matrices.
 */
const air = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const ph = window.__ENGINE__.ctx.peek('physics');
  const c = m.crash;
  const a = c.flames.geometry.getAttribute('aAt').array;
  const n = c.flames.geometry.instanceCount;
  let worst = -1e9, worstAt = null, below = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i * 4 + 0], y = a[i * 4 + 1], z = a[i * 4 + 2];
    const g = ph.groundHeight(x, z, 400);
    const d = y - g;
    if (d > worst) { worst = d; worstAt = [+x.toFixed(1), +y.toFixed(2), +z.toFixed(1), +g.toFixed(2)]; }
    if (d < -1.0) below++;
  }
  const hp = c.hull.matrix.elements;
  const hg = ph.groundHeight(hp[12], hp[14], 400);
  return {
    n, worst: +worst.toFixed(2), worstAt, below,
    wreck: { x: +hp[12].toFixed(1), y: +hp[13].toFixed(2), z: +hp[14].toFixed(1), ground: +hg.toFixed(2), air: +(hp[13] - hg).toFixed(2) },
    burn: +c._burn.toFixed(0), cells: c._cell,
  };
});
console.log(`\n  flames: ${air.n} instances · worst base ${air.worst} m over its own ground at ` +
  `(${air.worstAt?.join(', ')}) · ${air.below} more than 1 m under it`);
console.log(`  wreck at rest: (${air.wreck.x}, ${air.wreck.y}, ${air.wreck.z}) — ground ${air.wreck.ground}, ${air.wreck.air} m of air under it`);
console.log(`  ${air.cells} cells alight, ${air.burn}s of fire left`);
console.log(errs.length ? `\nPAGEERRORS(${errs.length}):\n  ${errs.slice(0, 3).join('\n  ')}` : '\n0 pageerrors');
await b.close();
