/**
 * THE TWO REMAINING SHAPES OF 「武器を武器庫から変えた後に死ぬと」
 *
 *   node _swapdeath.mjs [--url=…]
 *
 *   C. KILLED MID-SWAP. `setWeapon` latches `_switchTo` and the holster clip
 *      carries it; dying inside that window used to hand the respawn a latch it
 *      then stranded. The man must come back with his primary up and firing.
 *   D. THE RACK TAKEN WITH THE PISTOL OUT. `setPrimary` only RECORDS the choice
 *      when a sidearm is in the hands (documented, and right) — so the only
 *      place that choice can become visible is the next time he walks out of
 *      spawn. If a respawn did not draw slot 1, the rack he crossed the map for
 *      would be invisible until he pressed 1.
 *
 * Both end in a real trigger pull with the round counted out of the magazine.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, '');
  const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4350/?seed=7';

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
  window.__FIRED__ = 0;
  e.ctx.events.on('weapon:fire', () => { window.__FIRED__++; });
});
await page.mouse.click(640, 360);
await page.waitForTimeout(400);

let fails = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};
const snap = () => page.evaluate(() => {
  const w = window.__W__;
  return { activeId: w.activeId, primaryId: w.primaryId, switchTo: w._switchTo,
    switching: w.switching, canFire: w.canFire(), mag: w.ammo.mag, locked: w.locked,
    hud: w.getHudState().name };
});
const die = () => page.evaluate(() => window.__ENGINE__.ctx.peek('player').health.damage(9999, null, {}));
const waitRespawn = async () => {
  await page.evaluate(() => { window.__ENGINE__.time.scale = 4; });
  await page.waitForFunction(() => window.__ENGINE__.ctx.peek('player').health.dead === false, null, { timeout: 60000 });
  await page.evaluate(() => { window.__ENGINE__.time.scale = 1; });
  await page.waitForTimeout(900);
};
const pull = async () => {
  await page.evaluate(() => { window.__FIRED__ = 0; window.__MAG0__ = window.__W__.ammo.mag; });
  for (let i = 0; i < 3; i++) {
    await page.mouse.down(); await page.waitForTimeout(260); await page.mouse.up();
    await page.waitForTimeout(300);
  }
  return page.evaluate(() => ({ fired: window.__FIRED__, spent: window.__MAG0__ - window.__W__.ammo.mag }));
};
const goTo = (id) => page.evaluate((cid) => {
  const e = window.__ENGINE__;
  const p = e.ctx.peek('player');
  const c = window.__M__.caches.list.find((x) => x.id === cid);
  if (!c) return null;
  p.health.reset(true);
  p.setControlEnabled(true);
  p.movement.yaw = c.yaw;
  p.movement.pitch = 0;
  p.movement.velocity.set(0, 0, 0);
  p.movement.teleport(c.position.x - Math.sin(c.yaw) * 1.1, c.position.y + 0.05, c.position.z - Math.cos(c.yaw) * 1.1);
  e.ctx.peek('ai').protect(p, 9999);
  return { id: c.id, weaponId: c.weaponId, label: c.label };
}, id);

/* ══════════════ C. killed mid-swap ══════════════════════════════════════ */
console.log('\n── C. killed with a swap still in the air ───────────────────');
await page.evaluate(() => { window.__W__.setPrimary('ak'); });
await page.waitForTimeout(900);
await page.keyboard.press('Digit3');       // start the swap to the knife…
await page.waitForTimeout(60);             // …and die 60 ms into the holster.
const mid = await snap();
console.log(`  mid-swap: ${JSON.stringify(mid)}`);
check('the swap really was in the air', mid.switching === true, `_switchTo=${mid.switchTo}`);
await die();
await waitRespawn();
const c1 = await snap();
console.log(`  respawned: ${JSON.stringify(c1)}`);
check('not stranded mid-swap', c1.switching === false && c1.switchTo === null);
check('the primary is in the hands', c1.activeId === 'ak', `active=${c1.activeId}`);
check('the trigger is available', c1.canFire === true);
const cf = await pull();
console.log(`  trigger: ${JSON.stringify(cf)}`);
check('rounds left the barrel', cf.fired > 0 && cf.spent > 0, `${cf.fired} fired, ${cf.spent} out of the mag`);

/* ══════════════ D. the rack taken with the pistol out ═══════════════════ */
console.log('\n── D. HOLD F on a rack while holding the sidearm ────────────');
const rack = await page.evaluate(() => {
  const r = window.__M__.caches.list.find((c) => c.kind === 'weapon' && c.weaponId === 'sniper');
  return r ? r.id : null;
});
console.log(`  rack: ${JSON.stringify(await goTo(rack))}`);
await page.keyboard.press('Digit2');
await page.waitForTimeout(900);
const d0 = await snap();
check('the sidearm is out', d0.activeId === 'pistol', `active=${d0.activeId}`);
await page.keyboard.down('KeyF');
await page.waitForTimeout(900);
await page.keyboard.up('KeyF');
await page.waitForTimeout(400);
const d1 = await snap();
console.log(`  after HOLD F: ${JSON.stringify(d1)}`);
check('the rack recorded the new primary', d1.primaryId === 'sniper', `primary=${d1.primaryId}`);
check('…without taking the sidearm out of his hands', d1.activeId === 'pistol');
await die();
await waitRespawn();
const d2 = await snap();
console.log(`  respawned: ${JSON.stringify(d2)}`);
check('the respawn drew the weapon he took off the rack', d2.activeId === 'sniper',
  `active=${d2.activeId}, hud "${d2.hud}"`);
check('the trigger is available', d2.canFire === true);
const df = await pull();
console.log(`  trigger: ${JSON.stringify(df)}`);
check('rounds left the barrel', df.fired > 0 && df.spent > 0, `${df.fired} fired, ${df.spent} out of the mag`);

console.log(`\n${fails} FAIL(s); pageerrors: ${errors.length}`);
for (const e of errors) console.log('  ' + e);
await browser.close();
