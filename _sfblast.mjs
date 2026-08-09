/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE DETONATION, PHOTOGRAPHED AT EVERY RANGE A MAN CAN STAND AT
 * ════════════════════════════════════════════════════════════════════════════
 *   node _sfblast.mjs [--url=…] [--out=shots/skyfall-blast] [--tag=before]
 *
 * 「母艦大爆発してないね？？？」「大爆発演出はド派手にしないと」
 *
 * `_sfshots.mjs` photographs the EVENT — eleven frames spread over twenty-four
 * seconds, one of which happens to be 0.4 s after first contact. This
 * photographs the DETONATION: the frame before it, the frame it happens on and
 * the second after it, from four vantages at once, so a change to it is a
 * before/after on one build with one variable.
 *
 * ─── IT RUNS IN LOCKSTEP AND THAT IS THE WHOLE REASON IT CAN DO THIS ────────
 * `?capture=1&lockstep=1` means the engine never schedules a frame of its own
 * (@see src/dev/shots.js): frames happen only inside `__PUMP__`. So a shot can
 * be asked for at an exact ACT FRAME rather than at "the first rAF after `_t`
 * crossed 18.4", which on a headless GPU is anywhere in a 100 ms window — and a
 * fireball's core lives 85 ms. It also means the four vantages of one moment
 * are four CONSECUTIVE frames, 16.7 ms apart, rather than four different runs.
 *
 * Every range is measured off the walkable disc by `_sfstand.mjs` and not
 * named: first contact is 83 m from the map origin and the plain is a 176 m
 * disc, so the farthest a man can stand from this explosion is 240 m.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4639/?map=plains&capture=1&lockstep=1';
const TAG = args.tag ?? 'now';
const OUT = args.out ?? `shots/skyfall-blast/${TAG}`;
mkdirSync(OUT, { recursive: true });

/** First contact, from `skyfall.js`'s own TRACK.from. */
const AT = [-65.1, -51.8];
/**
 * The four vantages, every one of them walkable, outside the fire and with
 * clear line of sight to 20 m over first contact. @see `_sfstand.mjs`.
 */
const EYES = [
  ['30m', [-42, -33], 1.7, 75],
  ['83m-zoneD', [0, 0], 1.7, 75],
  ['151m-zoneC', [-128, 86], 1.7, 75],
  ['240m-far-east', [171, -10], 1.7, 75],
];
/** Act-clock seconds. The first is the frame BEFORE, so the pair is one frame. */
const MOMENTS = [
  ['0-before', 18.33],
  ['1-contact', 18.42],
  ['2-plus150ms', 18.57],
  ['3-plus500ms', 18.92],
  ['4-plus1500ms', 19.92],
  ['5-aftermath', 26.0],
];

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.stack ?? e.message)));
const notes = []; page.on('console', (m) => { const t = m.text(); if (/skyfall|crash\]/i.test(t)) notes.push(t.slice(0, 200)); });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log('level.id =', level, '· lockstep =', await page.evaluate(() => window.__LOCKSTEP__));
if (level !== 'plains') { console.error('NOT THE PLAIN'); await b.close(); process.exit(2); }

const pump = (n) => page.evaluate((k) => window.__PUMP__(k), n);

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
  for (const el of Array.from(document.body.children)) if (el.tagName !== 'CANVAS') el.style.display = 'none';
  e.ctx.viewScene.visible = false;
  const pl = e.ctx.peek('player');
  if (pl) { pl.applyDamage = () => {}; }
  e.time.scale = 8;
});

/* ---- to the live round, at eight times, in lockstep ---------------------- */
for (let i = 0; i < 60; i++) {
  await pump(30);
  const ph = await page.evaluate(() => window.__ENGINE__.ctx.peek('match')?.phase ?? '?');
  if (ph === 'live') break;
}
const phase = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  m._checkWinConditions = () => {};
  e.time.scale = 1;
  return m.phase;
});
console.log('phase =', phase);

/**
 * A vantage: stand on the ground at `from`, `eye` metres up, looking at a point
 * 12 m over first contact — the height of the fireball, not the ground, so the
 * shot is framed on the explosion rather than under it.
 */
const place = (from, eye, fov, at) => page.evaluate(([f, eye, fov, a]) => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const h = ph.raycast(f[0], 300, f[1], 0, -1, 0, 400, ph.MASK.WORLD);
  const y = (h.hit ? h.point.y : 0) + eye;
  e.camera.position.set(f[0], y, f[1]);
  e.camera.lookAt(new V3(a[0], a[1], a[2]));
  if (fov) { e.camera.fov = fov; e.camera.updateProjectionMatrix(); }
  /** `rot` is a THREE.Euler — an OBJECT — so the pitch actually lands. */
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  return {
    eye: [+e.camera.position.x.toFixed(1), +e.camera.position.y.toFixed(2), +e.camera.position.z.toFixed(1)],
    rot: [+e.camera.rotation.x.toFixed(3), +e.camera.rotation.y.toFixed(3), +e.camera.rotation.z.toFixed(3)],
    look: a, fov: e.camera.fov,
  };
}, [from, eye, fov, at]);

const state = () => page.evaluate(() => {
  const e = window.__ENGINE__, fx = e.ctx.peek('fx');
  const s = e.ctx.peek('match').crash._sky;
  return {
    t: +(s._t ?? -1).toFixed(3),
    frame: e.time.frame,
    lit: fx.lit.spawned, add: fx.add.spawned,
    lamps: fx.lights.lights.map((l) => Math.round(l.light.intensity)).join('/'),
    calls: e.ctx.peek('render')?.renderer?.info.render.calls ?? 0,
  };
});

const groundY = await page.evaluate((a) => window.__ENGINE__.ctx.peek('physics').groundHeight(a[0], a[1], 400), AT);
const LOOK = [AT[0], groundY + 12, AT[1]];
console.log('first contact', AT.join(', '), '· ground', groundY.toFixed(2), '· looking at', LOOK.map((v) => v.toFixed(1)).join(', '));

console.log('\nfired:', await page.evaluate(() => window.__ENGINE__.ctx.peek('match').crash.fire()));
/**
 * THE CLOCK IS THE FRAME INDEX AND NOT `_sky._t`, AND THAT IS NOT A STYLE
 * CHOICE. `_t` goes back to -1 the instant the wreck settles (t=24.6), so a
 * loop that pumps "until `_t` >= 26" pumps for ever — measured, at 720 000
 * frames, on the first run of this file. `?capture=1` runs a fixed 1/60 clock
 * with `time.scale` at 1, so act seconds and engine frames are the same thing
 * and the frame index only ever goes up.
 */
const fireFrame = await page.evaluate(() => window.__ENGINE__.time.frame);
const frameNow = () => page.evaluate(() => window.__ENGINE__.time.frame);

let done = 0;
for (const [mtag, target] of MOMENTS) {
  /** Pump to `EYES.length` frames short: each vantage below consumes one. */
  const want = fireFrame + Math.round(target * 60) - EYES.length;
  for (let guard = 0; guard < 200; guard++) {
    const cur = await frameNow();
    if (cur >= want) break;
    await pump(Math.min(240, want - cur));
  }
  for (const [etag, from, eye, fov] of EYES) {
    const pose = await place(from, eye, fov, LOOK);
    await pump(1);
    const st = await state();
    const name = `BLAST-${mtag}-${etag}`;
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(
      `  · ${name}.png  t=${st.t}s frame=${st.frame}  eye ${pose.eye.join(', ')} rot ${pose.rot.join(', ')} ` +
      `fov ${pose.fov} -> ${pose.look.map((v) => +v.toFixed(1)).join(', ')}  ·  lit ${st.lit} add ${st.add} lamps ${st.lamps} calls ${st.calls}`
    );
    done++;
  }
}
console.log(`\n${done} frames into ${OUT}`);
for (const n of notes.filter((n) => /CARRIER IS DOWN|nav denial|baked in/.test(n))) console.log('   ', n);
console.log(errs.length ? `PAGEERRORS(${errs.length}) ${errs[0]}` : '0 pageerrors');
await b.close();
