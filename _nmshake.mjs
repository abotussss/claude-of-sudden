/**
 * HOW BIG IS A FLINCH, IN DEGREES — the rig driven at 120 Hz, synchronously.
 *
 *   node _nmshake.mjs [--url=…]
 *
 * `_nmfeel.mjs` samples the camera on requestAnimationFrame, which headless
 * gives at ~25 fps; that is enough to prove a transient exists but not to
 * compare candidates. This drives `CameraRig.update` itself in a synchronous
 * loop at a fixed 1/120 s — the engine cannot interleave with a sync loop — and
 * reports the peak angle the view reaches off its pre-impulse forward, and how
 * long it stays above the breathing sway that is always there.
 *
 * It is a MEASURING instrument, not a test: every candidate impulse below is
 * fed to the same rig from the same rest state and reported in the same units,
 * so the tuning can be read off rather than reasoned about.
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
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('[shake] level.id =', await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

const rows = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const player = ctx.peek('player');
  const ai = ctx.peek('ai');
  if (ai) { ai.combatEnabled = false; ai.protect?.(player, 9999); }
  player.setControlEnabled(true);
  player.health.reset(true);
  const rig = player.rig;
  const cam = ctx.camera;
  const m = player.movement;
  const DEG = Math.PI / 180;

  /** Drive the rig for `secs` at 120 Hz and report what the view did. */
  const drive = (label, secs, impulse) => {
    rig.reset(rig.eye);
    player.health.suppression = 0;
    /**
     * `ctx.time.elapsed` does not advance inside a synchronous loop, so without
     * this every drive after the first looks to `onNearMiss` like the second
     * round of a burst and is scaled to `burstScale`. That is correct at run
     * time and an artefact here.
     */
    if (player._nearMiss) player._nearMiss.at = -1000;
    // settle
    for (let i = 0; i < 60; i++) rig.update(1 / 120, m, player.health);
    rig.applyTo(cam); cam.updateMatrixWorld();
    let el = cam.matrixWorld.elements;
    const bx = -el[8], by = -el[9], bz = -el[10];
    if (impulse) impulse(player, rig, ctx);
    let peak = 0, above = 0, tPeak = 0;
    const n = Math.round(secs * 120);
    for (let i = 0; i < n; i++) {
      rig.update(1 / 120, m, player.health);
      rig.applyTo(cam); cam.updateMatrixWorld();
      el = cam.matrixWorld.elements;
      const d = Math.min(1, Math.max(-1, -el[8] * bx + -el[9] * by + -el[10] * bz));
      const deg = Math.acos(d) / DEG;
      if (deg > peak) { peak = deg; tPeak = i / 120; }
      if (deg > 0.07) above++; // the breathing floor measured below
    }
    return { label, peakDeg: +peak.toFixed(3), atMs: Math.round(tPeak * 1000),
      aboveMs: Math.round((above / 120) * 1000) };
  };

  const out = [];
  out.push(drive('CONTROL — breathing sway only', 2.0, null));
  out.push(drive('trauma 0.34 (what onNearMiss spends today)', 2.0, (p, r) => r.addTrauma(0.34)));
  out.push(drive('trauma 0.60', 2.0, (p, r) => r.addTrauma(0.6)));
  out.push(drive('trauma 1.00 (the cap)', 2.0, (p, r) => r.addTrauma(1.0)));
  out.push(drive('recoil pitch 0.25° + roll 0.35°', 2.0,
    (p, r) => r.addRecoil(0.25 * DEG, 0, 0.35 * DEG, 0)));
  out.push(drive('recoil pitch 0.45° + yaw 0.30° + roll 0.70°', 2.0,
    (p, r) => r.addRecoil(0.45 * DEG, 0.3 * DEG, 0.7 * DEG, 0)));
  out.push(drive('recoil pitch 0.80° + yaw 0.55° + roll 1.20°', 2.0,
    (p, r) => r.addRecoil(0.8 * DEG, 0.55 * DEG, 1.2 * DEG, 0)));
  // ---- what onNearMiss actually does now ----------------------------------
  out.push(drive('LIVE onNearMiss(1.55) — the outer edge', 2.0, (p) => p.onNearMiss(1.55)));
  out.push(drive('LIVE onNearMiss(1.00)', 2.0, (p) => p.onNearMiss(1.0)));
  out.push(drive('LIVE onNearMiss(0.45) — past your ear', 2.0, (p) => p.onNearMiss(0.45)));
  out.push(drive('LIVE coax burst — five at 0.6 m inside one frame', 2.0,
    (p) => { for (let i = 0; i < 5; i++) p.onNearMiss(0.6); }));
  out.push(drive('for scale: a 21-damage round that HIT you', 2.0,
    (p) => p.applyDamage(21, null, { type: 'bullet' })));
  out.push(drive('for scale: suppression pinned at 1.0 (breath ×2.2)', 2.0,
    (p) => { p.health.suppression = 1; }));
  player.health.reset(true);
  return out;
});

console.log('\n   peak°   at     >0.07° for   what\n');
for (const r of rows) {
  console.log(`  ${String(r.peakDeg).padStart(6)}°  ${String(r.atMs).padStart(4)}ms  ` +
    `${String(r.aboveMs).padStart(7)}ms     ${r.label}`);
}
console.log(`\n[shake] pageerrors: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log('   ' + e);
await browser.close();
