/**
 * THE CATHEDRAL EVENT, PLAYED AS THE MATCH PLAYS IT, PHOTOGRAPHED FRAME BY FRAME.
 *
 * `callCathedralCollapse()` is NOT the collapse — it is `callSalvo('CATHEDRAL')`,
 * three bays of AISLE ROOF, which is why a probe that calls it directly reads
 * "THE CATHEDRAL DOWN" over an intact church. The building coming down is
 * `MatchSystem._razeCathedral()`, the `raze` beat of `_updateCathedralEvent`.
 * So this drives the REAL entry point, `_beginCathedralEvent`, and lets the beat
 * sheet play on its own clock — the same code the schedule runs at
 * `cathedralOpenProgress`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT PUMPS THE ENGINE BY HAND, AND THAT IS THE WHOLE POINT
 * ─────────────────────────────────────────────────────────────────────────────
 * A headless screenshot of this scene costs about two seconds of wall time, and
 * the collapse lasts two and a half seconds. A probe that lets the clock run
 * while it photographs therefore samples the entire event ONCE — the first
 * version of this file took sixty frames and every one of them was a different
 * second of the match. `Engine.step` is exposed for exactly this ("so the
 * capture harness can pump frames by hand"), so: `stop()` the loop, advance a
 * fixed 1/60 per call, and let each screenshot take as long as it likes. The
 * event then plays at a rate this file chooses and every frame of the collapse
 * is on disk.
 *
 * It also makes the cost measurement honest: with dt pinned, the wall time of
 * each `step()` IS the frame's cost, so the fire frame can be compared against
 * its own neighbours rather than against a frame rate.
 *
 *   node _cathdown.mjs [url] [outdir] [--every=3] [--frames=260] [--seed=N]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const URL = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4305/';
const OUT = args.find((a) => !a.startsWith('-') && !a.startsWith('http')) ?? 'shots/cathdown';
/** Simulated frames between photographs. 3 is 20 stills a second. */
const EVERY = Number(flag('every', 3));
/** How many simulated frames to run after the event opens. 260 = 4.3 s. */
const FRAMES = Number(flag('frames', 260));
const SEED = flag('seed', null);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
const logs = [];
page.on('console', (m) => {
  const t = m.text();
  if (/cathedral|CATHEDRAL|IMPACT|razed|route gate|whole buildings/i.test(t)) logs.push(t);
});

const q = ['capture=1'];
if (SEED) q.push(`seed=${SEED}`);
await page.goto(`${URL}?${q.join('&')}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => new Promise((d) => {
  const m = window.__ENGINE__.ctx.peek('match');
  const t = () => (m.phase === 'live' ? d() : requestAnimationFrame(t));
  t();
}));
const levelSeed = await page.evaluate(() => window.__ENGINE__.levelSeed ?? null);

/* ---- take the clock off the browser and on to this file ------------------ */
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
  const m = e.ctx.peek('match');
  m.roundClock = 1e6;              // the round may not end under us
  m._checkWinConditions = () => {};
  e.stop();
  window.__T__ = performance.now();
  e._last = window.__T__;
  window.__MS__ = [];
  /** Advance exactly `n` frames of 1/60, timing each one. */
  window.__PUMP__ = (n) => {
    for (let i = 0; i < n; i++) {
      window.__T__ += 1000 / 60;
      const t0 = performance.now();
      e.step(window.__T__);
      window.__MS__.push(+(performance.now() - t0).toFixed(2));
    }
  };
});

/** Stand at level z = `lz` on the cathedral's own axis, looking at height `lookY`. */
const place = (lz, lookY, lift = 1.62) => page.evaluate(([lz, lookY, lift]) => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const from = w.levelToWorld(0, 0, lz, new V3());
  const at = w.levelToWorld(0, 0, -1, new V3());
  const h = phys.raycast(from.x, 80, from.z, 0, -1, 0, 120, phys.MASK.WORLD);
  e.camera.position.set(from.x, (h.hit ? h.point.y : 0) + lift, from.z);
  e.camera.lookAt(new V3(at.x, lookY, at.z));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
}, [lz, lookY, lift]);

const pump = (n) => page.evaluate((k) => window.__PUMP__(k), n);
const state = () => page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const s = m.airstrike.sites.find((x) => x.id === 'CATHEDRAL');
  return {
    razed: !!e.ctx.peek('world').cathedral?.razed,
    t: +(m._cath?.t ?? -1).toFixed(2),
    beat: m._cath?.beat ?? -1,
    struck: !!s?.struck,
    uT: s ? +(s.uniforms.uT.value).toFixed(2) : -1,
    frame: e.ctx.time.frame,
  };
});

await place(58, 14);
await pump(30);
await page.screenshot({ path: `${OUT}/00-standing.png` });

await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._beginCathedralEvent(m.ctx.time.elapsed, 0.99);
});
console.log(`[probe] event opened · levelSeed=${levelSeed} · ${FRAMES} frames, a still every ${EVERY}`);

/**
 * FAST-FORWARD TO THE BEAT THAT MATTERS. The sheet is 22 s long and the
 * collapse is the two and a half seconds after `cathedralLead + cathedralRazeDelay`
 * = 12.2 s; photographing the ten-second warning at 20 stills a second is four
 * hundred pictures of a church standing still. Frames are still SIMULATED —
 * the barrage, the salvo and both aircraft all play — they are just not
 * photographed.
 */
const FROM = Number(flag('from', 11.0));
{
  let guard = 0;
  for (;;) {
    const s = await state();
    if (s.t < 0 || s.t >= FROM || guard++ > 120) break;
    await pump(30);
  }
  const s = await state();
  console.log(`[probe] fast-forwarded to event t=${s.t}s (beat ${s.beat}); photographing from here`);
}

let shot = 0;
let fireFrame = -1;
const rows = [];
for (let i = 0; i < FRAMES; i += EVERY) {
  await pump(EVERY);
  const s = await state();
  rows.push({ i, ...s });
  if (fireFrame < 0 && s.struck) {
    fireFrame = s.frame;
    console.log(`[probe] CATHEDRAL FIRED at event t=${s.t}s (beat ${s.beat}), razed=${s.razed}`);
  }
  await place(58, 14);
  await page.screenshot({ path: `${OUT}/p${String(shot++).padStart(3, '0')}.png` });
}
console.log(`[probe] ${shot} stills over ${(FRAMES / 60).toFixed(1)} s of the event`);

/* ---- the fire frame against its neighbours ------------------------------- */
const ms = await page.evaluate(() => window.__MS__);
const base = await page.evaluate(() => window.__ENGINE__.ctx.time.frame - window.__MS__.length);
if (fireFrame > 0 && ms.length) {
  const k = fireFrame - base - 1;
  const win = (a, b) => ms.slice(Math.max(0, a), b).filter((x) => x > 0);
  const med = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : NaN);
  console.log(
    `[cost] fire frame ${ms[k]} ms  ·  the 60 before it median ${med(win(k - 60, k))} ms ` +
      `max ${Math.max(...win(k - 60, k))} ms  ·  the 60 after median ${med(win(k + 1, k + 61))} ms ` +
      `max ${Math.max(...win(k + 1, k + 61))} ms  ·  whole run median ${med(ms)} ms`
  );
  console.log(`[cost] the ten frames round it: ${ms.slice(k - 5, k + 5).join(', ')} ms`);
}
writeFileSync(`${OUT}/frames.json`, JSON.stringify({ levelSeed, fireFrame, base, rows, ms }, null, 1));

/* ---- and the angles every floating-mass bug has hidden at ----------------- */
/**
 * PAST `SETTLE_AT` **AND PAST THE DUST**. The pose is handed back at 6.5 s but
 * the columns live for up to fourteen, and a sky full of smoke is a sky you
 * cannot see a floating mass in — the first pass of these six shots was six
 * photographs of dust. Nine hundred frames is fifteen seconds.
 *
 * The camera is lifted well clear of the rubble for the same class of reason:
 * at 1.62 m the "look up from the crossing" shot put the eye INSIDE a settled
 * chunk and photographed the inside of a box.
 */
await pump(900);
for (const [name, lz, ly, lift] of [
  ['up-nave', 6, 30, 4.2],
  ['up-parvis', 40, 34, 2.2],
  ['up-north', -34, 32, 2.2],
  ['up-crossing', 0, 38, 5.0],
  ['ruin-parvis', 58, 6, 1.62],
  ['ruin-nave', 14, 4, 3.4],
]) {
  await place(lz, ly, lift);
  await pump(2);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

const fin = await state();
console.log(`[probe] final: razed=${fin.razed} struck=${fin.struck}`);
console.log(logs.slice(0, 30).map((l) => '  ' + l).join('\n'));
console.log(errs.length ? `[pageerror] ${errs.slice(0, 5).join(' | ')}` : '[pageerror] none');
await browser.close();
