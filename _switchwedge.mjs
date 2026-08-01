/**
 * IS A WEAPON SWITCH IN FLIGHT SURVIVED BY A RESPAWN?
 *
 *   node _switchwedge.mjs
 *
 * `WeaponSystem.setWeapon` latches `_switchTo` and hands the completion to the
 * holster clip's `end` callback. `resetAmmo()` — which is what `match` calls on
 * every respawn — calls `viewmodel.stopClip()` and starts `draw`. If stopping a
 * clip does not run its `end`, `_switchTo` is never cleared, and:
 *   `switching` is true for ever  → `canFire()` is false for ever
 *   `setWeapon` returns false     → 1/2/3/4 and the wheel do nothing
 *
 * This probe asserts nothing about how a player gets there; it only measures
 * whether the wedge exists.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4350/?seed=7';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
await page.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 180000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.time.scale = 1;
  e.ctx.peek('ai').combatEnabled = false;
  e.ctx.peek('ai').protect(e.ctx.peek('player'), 9999);
  window.__W__ = e.ctx.peek('weapons');
  window.__M__ = e.ctx.peek('match');
});
await page.mouse.click(640, 360);
await page.waitForTimeout(400);

const snap = (tag) => page.evaluate((t) => {
  const w = window.__W__;
  return {
    tag: t,
    activeId: w.activeId, primaryId: w.primaryId, switchTo: w._switchTo,
    switching: w.switching, canFire: w.canFire(), clip: w.viewmodel.clipName,
    reloading: w.reloading, locked: w.locked,
  };
}, tag);

console.log('\n── A. does stopClip() strand a switch? ───────────────────────');
console.log(JSON.stringify(await snap('idle')));
await page.evaluate(() => { window.__W__.setWeapon('pistol'); });
await page.waitForTimeout(60);
console.log(JSON.stringify(await snap('switch started')));
// …and the respawn's own call, mid-holster.
await page.evaluate(() => { window.__W__.resetAmmo(); });
await page.waitForTimeout(1500);
console.log(JSON.stringify(await snap('1.5s after resetAmmo')));
await page.waitForTimeout(3000);
console.log(JSON.stringify(await snap('4.5s after resetAmmo')));
// Can he do anything about it?
await page.keyboard.press('Digit1');
await page.waitForTimeout(800);
console.log(JSON.stringify(await snap('after Digit1')));
await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up();
await page.waitForTimeout(300);
const fired = await page.evaluate(() => window.__W__.stats.fired);
console.log(`   rounds fired while wedged: ${fired}`);

console.log('\n── B. is the weapon live while DEAD? ────────────────────────');
await page.evaluate(() => { location.reload(); }).catch(() => {});
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
await page.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 180000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.time.scale = 1;
  e.ctx.peek('ai').combatEnabled = false;
  window.__W__ = e.ctx.peek('weapons');
  window.__M__ = e.ctx.peek('match');
  window.__FIRED__ = 0;
  e.ctx.events.on('weapon:fire', () => { window.__FIRED__++; });
});
await page.mouse.click(640, 360);
await page.waitForTimeout(400);
await page.evaluate(() => { window.__ENGINE__.ctx.peek('player').health.damage(9999, null, {}); });
await page.waitForTimeout(600);
console.log(JSON.stringify(await snap('dead')));
const magBefore = await page.evaluate(() => window.__W__.ammo.mag);
// The spectator's OWN control is LMB (`Spectator.update` cycles on firePressed).
await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up();
await page.keyboard.press('Digit2');
await page.waitForTimeout(400);
const after = await page.evaluate(() => ({
  fired: window.__FIRED__, mag: window.__W__.ammo.mag,
  activeId: window.__W__.activeId, dead: window.__ENGINE__.ctx.peek('player').health.dead,
}));
console.log(`   mag ${magBefore} -> ${after.mag}; weapon:fire while dead = ${after.fired}; ` +
  `active=${after.activeId} (still dead: ${after.dead})`);

console.log(`\npageerrors: ${errors.length}`);
await browser.close();
