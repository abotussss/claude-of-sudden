/**
 * DOES THE NEAR-MISS FLINCH REACH THE CAMERA?  — measured, not read.
 *
 *   node _nmfeel.mjs [--url=…]
 *
 * `onNearMiss` spends its weight on `rig.addTrauma`, and trauma only means
 * anything if it comes out of `CameraRig.update` as camera motion: shake goes as
 * trauma², so a plausible-looking number can still be invisible. This measures
 * the angle the VIEW actually moves, in degrees, by sampling the camera's
 * forward vector every frame — a control window first (breathing sway only),
 * then one flinch per miss distance, then a burst, then the impact path and a
 * real wound for scale.
 *
 * The player keeps control ON with no input: `Player.update` writes the camera
 * only under `if (this.controlEnabled)`, so a frozen-but-controlled player is
 * the only way to watch the rig place the eye.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4622/?map=plains';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message)));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('[feel] level.id =', await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  ctx.time.scale = 1;
  const player = ctx.peek('player');
  const ai = ctx.peek('ai');
  // A quiet room: nobody shooting, nothing else touching the camera, so every
  // degree measured below belongs to the thing being tested.
  if (ai) { ai.combatEnabled = false; ai.protect?.(player, 9999); }
  player.setControlEnabled(true);
  player.health.reset(true);

  const cam = ctx.camera;
  const F = { x: 0, y: 0, z: 0 };
  const fwd = () => {
    cam.updateMatrixWorld();
    const m = cam.matrixWorld.elements;
    F.x = -m[8]; F.y = -m[9]; F.z = -m[10];
    return F;
  };
  window.__SAMPLE__ = (ms, fn) =>
    new Promise((resolve) => {
      const f0 = fwd();
      const bx = f0.x, by = f0.y, bz = f0.z;
      let peak = 0, tmax = 0, n = 0;
      const t0 = performance.now();
      if (fn) fn();
      const step = () => {
        const f = fwd();
        const dot = Math.min(1, Math.max(-1, f.x * bx + f.y * by + f.z * bz));
        const deg = (Math.acos(dot) * 180) / Math.PI;
        if (deg > peak) peak = deg;
        if (player.rig.trauma > tmax) tmax = player.rig.trauma;
        n++;
        if (performance.now() - t0 < ms) requestAnimationFrame(step);
        else resolve({ peakDeg: +peak.toFixed(4), peakTrauma: +tmax.toFixed(4), frames: n });
      };
      requestAnimationFrame(step);
    });
});

const run = (label, ms, body) =>
  page.evaluate(async ([l, m, b]) => {
    const e = window.__ENGINE__;
    const ctx = e.ctx;
    const player = ctx.peek('player');
    // eslint-disable-next-line no-new-func
    const fn = b ? new Function('player', 'ctx', b) : null;
    const r = await window.__SAMPLE__(m, fn ? () => fn(player, ctx) : null);
    return { label: l, ...r };
  }, [label, ms, body]);

const rows = [];
const settle = () => page.waitForTimeout(1200);

rows.push(await run('CONTROL — nothing happens (breath sway only)', 500, null));
await settle();
rows.push(await run('near miss 1.55 m (the outer edge)', 500, 'player.onNearMiss(1.55)'));
await settle();
rows.push(await run('near miss 1.00 m', 500, 'player.onNearMiss(1.0)'));
await settle();
rows.push(await run('near miss 0.45 m (past your ear)', 500, 'player.onNearMiss(0.45)'));
await settle();
rows.push(await run('coax burst — five at 0.6 m inside 0.1 s', 600,
  'for (let i=0;i<5;i++) player.onNearMiss(0.6);'));
await settle();
rows.push(await run('_onBulletImpact — a round stopping 1.0 m behind the eye', 500,
  `const eye = ctx.camera.position; const f = player.rig.forward;
   player._onBulletImpact({ point: { x: eye.x - f.x*1.0, y: eye.y - f.y*1.0, z: eye.z - f.z*1.0 } });`));
await settle();
rows.push(await run('for scale: a 21-damage rifle round that HIT you', 700,
  'player.applyDamage(21, null, { type: "bullet" });'));

console.log('\n  what the VIEW actually did (peak angle off the pre-event forward)\n');
for (const r of rows) {
  console.log(`   ${String(r.peakDeg).padStart(7)}°   trauma peak ${String(r.peakTrauma).padStart(6)}   ` +
    `${String(r.frames).padStart(3)} frames   ${r.label}`);
}
console.log(`\n[feel] pageerrors: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log('   ' + e);
await browser.close();
