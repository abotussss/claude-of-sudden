/**
 * THE CATHEDRAL, BEFORE / MID-COLLAPSE / SETTLED — and whether it reads as
 * levelled ground rather than as a church with some damage.
 *
 *   node _cathshot.mjs [--url=…] [--out=shots/cath]
 *
 * The event is three beats (`_updateMapEvents`): the `CATHEDRAL` salvo, then
 * `RULES.cathedralRazeDelay` later the shell swap, then D at
 * `cathedralOpenDelay`. This drives the REAL path — `_cathedralCalled` is left
 * alone and the progress threshold is reached by moving the score, so what is
 * photographed is what a match does and not a hand-called effect.
 *
 * Four camera poses per beat, in AUTHORED (pre-1.5x) level units like
 * `_look.mjs`: the cathedral centre is (0, -1) and its plan is 20 x 30 authored.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4253/';
const OUT = args.out ?? 'shots/cath';
mkdirSync(OUT, { recursive: true });

/** id: [fromX, fromZ, lookX, lookZ, eyeY] in AUTHORED level units. */
const POSES = {
  south: [0, -37, 0, -1, 1.62],
  corner: [-26, -26, 0, -1, 1.62],
  inside: [0, -13, 0, 10, 1.62],
  high: [-30, -30, 0, -1, 16],
};

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--force-color-profile=srgb'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 200)); });
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 480000 });

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
});

const shoot = async (phase) => {
  for (const [id, pose] of Object.entries(POSES)) {
    await page.evaluate((p) => {
      const e = window.__ENGINE__;
      const world = e.ctx.peek('world');
      const phys = e.ctx.peek('physics');
      const V3 = e.camera.position.constructor;
      const S = 1.5;
      const floor = (lx, lz) => {
        const w = world.levelToWorld(lx * S, 0, lz * S, new V3());
        const h = phys.raycast(w.x, 40, w.z, 0, -1, 0, 80, phys.MASK.WORLD);
        w.y = h.hit ? h.point.y : 0;
        return w;
      };
      const from = floor(p[0], p[1]);
      const to = floor(p[2], p[3]);
      const cam = e.camera;
      cam.position.set(from.x, from.y + p[4], from.z);
      cam.lookAt(new V3(to.x, to.y + (p[4] > 5 ? 2 : 6), to.z));
      e.ctx.peek('player')?.teleport?.(cam.position, cam.rotation);
    }, pose);
    await page.waitForTimeout(260);
    await page.screenshot({ path: `${OUT}/${phase}-${id}.png` });
  }
  console.log(`  [${phase}] 4 frames -> ${OUT}/${phase}-*.png`);
};

/* ---- 1. INTACT ----------------------------------------------------------- */
const before = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const c = window.__ENGINE__.ctx.peek('world').cathedral;
  return { razed: c?.razed, hasSetRazed: typeof c?.setRazed === 'function', phase: m.phase };
});
console.log('[cathshot] before:', JSON.stringify(before));
await shoot('1-intact');

/* ---- 2. reach the event the way a match does ---------------------------- */
// Get to LIVE on its own — forcing the phase skips `_beginRound`.
await page.evaluate(() => (window.__ENGINE__.time.scale = 10));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await page.waitForTimeout(400);
// Push the LEADER's score over `cathedralOpenProgress` and let _updateMapEvents
// find it. Nothing else is touched: the salvo, the raze timer and D all run.
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._checkWinConditions = () => {};
  m.score[0] = Math.ceil(250 * 0.53);
});
await page.waitForFunction("window.__ENGINE__.ctx.peek('match')._cathedralCalled===true", null, { timeout: 60000 });
console.log('[cathshot] event called');
// mid-collapse: chunks in the air, before and around the shell swap
await page.waitForTimeout(1500);
await shoot('2-mid');

/* ---- 3. settled ---------------------------------------------------------- */
await page.waitForFunction("window.__ENGINE__.ctx.peek('world').cathedral.razed===true", null, { timeout: 60000 });
await page.evaluate(() => (window.__ENGINE__.time.scale = 4));
// D is `cathedralOpenDelay` after the CALL, so wait for the zone rather than a
// wall-clock guess — the shot is meant to be of the settled ruin WITH D live.
await page.waitForFunction(
  "window.__ENGINE__.ctx.peek('match').sites.some((z)=>z.id==='D')", null, { timeout: 120000 }
);
await page.waitForTimeout(3000);
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await page.waitForTimeout(700);
await shoot('3-settled');

const after = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const c = e.ctx.peek('world').cathedral;
  const phys = e.ctx.peek('physics');
  const world = e.ctx.peek('world');
  const V3 = e.camera.position.constructor;
  const S = 1.5;
  /** Highest solid over the cathedral plan — the honest "is it levelled". */
  let top = -1;
  const probes = [];
  for (let u = -9; u <= 9; u += 3) {
    for (let v = -14; v <= 14; v += 3.5) {
      const w = world.levelToWorld(u * S, 0, (v - 1) * S, new V3());
      const h = phys.raycast(w.x, 60, w.z, 0, -1, 0, 120, phys.MASK.WORLD);
      const y = h.hit ? h.point.y : 0;
      if (y > top) top = y;
      probes.push(y);
    }
  }
  probes.sort((a, b) => a - b);
  return {
    razed: c.razed,
    dLive: m.sites.some((z) => z.id === 'D'),
    liveZones: m.sites.map((z) => z.id).join('/'),
    intactTopY: c.intactTopY,
    highestSolidOverThePlan: +top.toFixed(2),
    medianSurfaceY: +probes[probes.length >> 1].toFixed(2),
    samples: probes.length,
  };
});
console.log('[cathshot] after:', JSON.stringify(after, null, 1));
console.log('[cathshot] pageErrors', errs.length ? errs.slice(0, 6) : 'none');
await browser.close();
