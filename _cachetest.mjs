/**
 * DRIVE THE HUMAN ONTO THE CACHES, with real keyboard input, and read the
 * answers back off the systems that own them.
 *
 *   node _cachetest.mjs [--url=…] [--shots=shots/]
 *
 * Three things are proved, in this order:
 *   1. HOLD F on a weapon rack swaps the primary  — `weapons.primaryId` before
 *      and after, and the HUD's own weapon name off the DOM.
 *   2. HOLD F on a grenade stack refills the pouch — `weapons.grenadeCount`
 *      before and after, with the frags spent by actually throwing them.
 *   3. TAP F plants a beacon and a respawn USES it inside 30 s and NOT after —
 *      `caches.beacon.used` sampled while it is up and again once it has run out.
 *
 * The bots are frozen (`ai.combatEnabled = false`, a documented hook) and the
 * player is protected, so nothing here is decided by a firefight.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4214/';
const SHOTS = args.shots ?? 'shots';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message)));

console.log(`[cache] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
await page.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 180000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.time.scale = 1;
  const ai = e.ctx.peek('ai');
  const m = e.ctx.peek('match');
  ai.combatEnabled = false;
  ai.protect(e.ctx.peek('player'), 9999);
  window.__M__ = m;
});
await page.mouse.click(800, 450); // pointer lock, so `input.enabled` is true
await page.waitForTimeout(400);

const bootInfo = await page.evaluate(() => {
  const m = window.__M__;
  return {
    caches: m.caches.list.length,
    proved: m.caches.botList.length,
    racks: m.caches.list.filter((c) => c.kind === 'weapon').map((c) => `${c.id}=${c.label}`),
    grenades: m.caches.list.filter((c) => c.kind === 'grenade').map((c) => c.id),
  };
});
console.log(`[cache] ${bootInfo.caches} caches, ${bootInfo.proved} proved bot-walkable`);
console.log(`[cache] racks: ${bootInfo.racks.join(', ')}`);
console.log(`[cache] grenade stacks: ${bootInfo.grenades.join(', ')}`);

/**
 * Put the player on a cache's painted square, facing it.
 *
 * `player.respawnAt` cannot be used: it snaps to `physics.groundHeight(x, z,
 * y + 6)`, and six metres over an upper floor is above the ceiling, so the probe
 * lands on the ROOF and the player is teleported outside the building. Measured:
 * every f1 cache put him 3.45 m too high with `nearest()` returning null.
 * `movement.teleport` is the unsnapped one.
 */
const goTo = (id) =>
  page.evaluate((cid) => {
    const e = window.__ENGINE__;
    const m = window.__M__;
    const p = e.ctx.peek('player');
    const c = m.caches.list.find((x) => x.id === cid);
    if (!c) return null;
    p.health.reset(true);
    p.setControlEnabled(true);
    // 1.1 m off the crate along its own facing: inside the 2.6 m prompt radius
    // and standing on the painted square rather than in the geometry.
    const px = c.position.x - Math.sin(c.yaw) * 1.1;
    const pz = c.position.z - Math.cos(c.yaw) * 1.1;
    p.movement.yaw = c.yaw;
    p.movement.pitch = 0;
    p.movement.velocity.set(0, 0, 0);
    p.movement.teleport(px, c.position.y + 0.05, pz);
    e.ctx.peek('ai').protect(p, 9999);
    const near = m.caches.nearest(p.position);
    return {
      id: c.id, kind: c.kind, label: c.label,
      crate: [+c.position.x.toFixed(1), +c.position.y.toFixed(2), +c.position.z.toFixed(1)],
      player: [+p.position.x.toFixed(1), +p.position.y.toFixed(2), +p.position.z.toFixed(1)],
      dist: +c.position.distanceTo(p.position).toFixed(2),
      nearest: near ? near.id : null,
    };
  }, id);

const state = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const m = window.__M__;
    const wp = e.ctx.peek('weapons');
    const p = e.ctx.peek('player');
    const c = m.caches.nearest(p.position);
    const hud = wp.getHudState();
    return {
      t: +e.time.elapsed.toFixed(2),
      primaryId: wp.primaryId,
      activeId: wp.activeId,
      hudName: hud.name,
      grenades: wp.grenadeCount,
      grenadeCap: wp.grenadeCapacity,
      reserve: wp.ammo.reserve,
      mag: wp.ammo.mag,
      nearCache: c ? c.id : null,
      distToCache: c ? +c.position.distanceTo(p.position).toFixed(2) : null,
      prompt: document.querySelector('.ow-prompt-txt')?.textContent ?? '',
      promptSub: document.querySelector('.ow-prompt-sub')?.textContent ?? '',
      beacon: {
        active: m.caches.beacon.active,
        left: +m.caches.beaconRemaining(e.time.elapsed).toFixed(1),
        used: m.caches.beacon.used,
        at: m.caches.beacon.at,
      },
      beaconSpawns: m.caches.stats.beaconSpawns,
      dead: p.dead,
    };
  });

const press = async (ms) => {
  await page.keyboard.down('KeyF');
  await page.waitForTimeout(ms);
  await page.keyboard.up('KeyF');
  await page.waitForTimeout(250);
};

let fails = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

/* ══════════════════════════════ 1. WEAPON ON HOLD F ══════════════════════ */
console.log('\n── 1. HOLD F on a weapon rack ──────────────────────────────');
const rack = bootInfo.racks[2] ?? bootInfo.racks[0];
const rackId = rack.split('=')[0];
console.log(`[cache] going to ${rack}`);
console.log('  at cache:', JSON.stringify(await goTo(rackId)));
await page.waitForTimeout(700);
const w0 = await state();
console.log(`  before: primary=${w0.primaryId} active=${w0.activeId} hud="${w0.hudName}" ` +
  `prompt="${w0.prompt}" sub="${w0.promptSub}" dist=${w0.distToCache}`);
await page.screenshot({ path: `${SHOTS}/cache-1-rack-prompt.png` });

// A TAP first: it must NOT swap the weapon (it is the beacon's edge).
await press(120);
const wTap = await state();
check('a TAP does not swap the weapon', wTap.primaryId === w0.primaryId,
  `primary still ${wTap.primaryId}`);
check('a TAP at a cache plants the beacon instead', wTap.beacon.active === true,
  `beacon at ${wTap.beacon.at}, ${wTap.beacon.left}s left`);

await press(900);
const w1 = await state();
console.log(`  after:  primary=${w1.primaryId} active=${w1.activeId} hud="${w1.hudName}" ` +
  `mag=${w1.mag} reserve=${w1.reserve}`);
await page.screenshot({ path: `${SHOTS}/cache-2-rack-taken.png` });
check('HOLD F changed the primary', w1.primaryId !== w0.primaryId,
  `${w0.primaryId} -> ${w1.primaryId}`);
check('the weapon in hand changed too', w1.activeId === w1.primaryId,
  `active=${w1.activeId}`);
check('the HUD name changed', w1.hudName !== w0.hudName, `"${w0.hudName}" -> "${w1.hudName}"`);
check('the picked-up weapon is loaded', w1.mag > 0, `mag=${w1.mag}`);

// …and the cooldown holds: a second hold must not fire again.
await press(900);
const w2 = await state();
check('the cache is on cooldown after one take', w2.primaryId === w1.primaryId,
  `prompt sub now "${w2.promptSub}"`);

/* ══════════════════════════════ 2. GRENADE RESUPPLY ══════════════════════ */
console.log('\n── 2. HOLD F on a grenade stack ────────────────────────────');
const gId = bootInfo.grenades[0];
console.log('  at cache:', JSON.stringify(await goTo(gId)));
await page.waitForTimeout(600);

// Spend the frags for real: draw the grenade and throw them.
const g0 = await state();
console.log(`  carrying ${g0.grenades}/${g0.grenadeCap} frags — throwing them`);
for (let i = 0; i < g0.grenadeCap; i++) {
  // Digit4 draws the frag (weapons/index.js line ~1367), then mouse holds the
  // pin and releasing throws it.
  await page.keyboard.press('Digit4');
  await page.waitForTimeout(700);
  const held = await page.evaluate(() => window.__ENGINE__.ctx.peek('weapons').activeId);
  if (held !== 'grenade') console.log(`  (draw failed, holding ${held})`);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  await page.waitForTimeout(1800);
}
await page.waitForTimeout(600);
const g1 = await state();
console.log(`  after throwing: ${g1.grenades}/${g1.grenadeCap}  (near ${g1.nearCache}, "${g1.prompt}")`);
await page.screenshot({ path: `${SHOTS}/cache-3-grenade-empty.png` });
check('the frags were actually spent', g1.grenades < g0.grenades, `${g0.grenades} -> ${g1.grenades}`);

await goTo(gId);
await page.waitForTimeout(600);
await press(900);
const g2 = await state();
console.log(`  after HOLD F: ${g2.grenades}/${g2.grenadeCap}`);
await page.screenshot({ path: `${SHOTS}/cache-4-grenade-resupplied.png` });
check('HOLD F raised the frag count', g2.grenades > g1.grenades, `${g1.grenades} -> ${g2.grenades}`);
check('…and it is capped at the pouch size', g2.grenades <= g2.grenadeCap,
  `${g2.grenades} <= ${g2.grenadeCap}`);

/* ══════════════════════════════ 3. THE BEACON ════════════════════════════ */
console.log('\n── 3. TAP F beacon: used inside 30 s, not after ────────────');
// Wait out whatever beacon step 1 left up, and its cooldown.
await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
await page.waitForFunction(
  () => !window.__M__.caches.beacon.active && window.__M__.caches.beaconCooldown(window.__ENGINE__.time.elapsed) <= 0,
  null,
  { timeout: 120000 }
);
await page.evaluate(() => { window.__ENGINE__.time.scale = 1; });

const bId = bootInfo.grenades[0];
console.log('  at cache:', JSON.stringify(await goTo(bId)));
await page.waitForTimeout(600);
await press(120);
const b0 = await state();
console.log(`  beacon: active=${b0.beacon.active} at=${b0.beacon.at} left=${b0.beacon.left}s`);
await page.screenshot({ path: `${SHOTS}/cache-5-beacon-up.png` });
check('the beacon is up', b0.beacon.active === true);
check('for ~30 s', b0.beacon.left > 27 && b0.beacon.left <= 30, `${b0.beacon.left}s`);
check('the HUD shows its clock', /BEACON/.test(
  await page.evaluate(() => document.querySelector('.ow-zones')?.textContent ?? '')));

/**
 * Kill friendly bots and watch where they come back. `_safeSpawn` is one auction
 * over the base cluster, every standing point of every zone this side owns, and
 * the beacon; the beacon wins on `forwardSpawnBias` when it is not contested.
 * Counting `beacon.used` is counting respawns that actually came out of it.
 */
const killFriends = (n) =>
  page.evaluate((count) => {
    const e = window.__ENGINE__;
    const m = window.__M__;
    const V3 = m.sites[0].position.constructor;
    let k = 0;
    for (const a of m._botsByTeam[m.playerTeam]) {
      if (!a.alive || k >= count) continue;
      a.applyDamage(999, 'torso', a.position.clone(), new V3(0, 0, 1), null);
      k++;
    }
    return k;
  }, n);

const usedBefore = b0.beacon.used;
console.log(`  killing 8 friendly bots while the beacon is up (t+${(30 - b0.beacon.left).toFixed(1)}s)`);
await killFriends(8);
// respawnDelay is 6 s; run at 2x so every one of them lands inside the 30 s.
await page.evaluate(() => { window.__ENGINE__.time.scale = 2; });
await page.waitForTimeout(5000);
await page.evaluate(() => { window.__ENGINE__.time.scale = 1; });
const b1 = await state();
console.log(`  beacon.used=${b1.beacon.used} (was ${usedBefore}), ${b1.beacon.left}s left, ` +
  `beaconSpawns=${b1.beaconSpawns}`);
await page.screenshot({ path: `${SHOTS}/cache-6-beacon-used.png` });
check('a respawn came out of the beacon INSIDE 30 s', b1.beacon.used > usedBefore,
  `${usedBefore} -> ${b1.beacon.used}`);
check('…while the beacon was still live', b1.beacon.left > 0, `${b1.beacon.left}s left`);

// Now let it run out and try again.
await page.evaluate(() => { window.__ENGINE__.time.scale = 6; });
await page.waitForFunction(() => !window.__M__.caches.beacon.active, null, { timeout: 60000 });
await page.evaluate(() => { window.__ENGINE__.time.scale = 1; });
const b2 = await state();
console.log(`  beacon expired: active=${b2.beacon.active}, used=${b2.beacon.used}`);
check('the beacon expired on its own', b2.beacon.active === false);

const spawnsAtExpiry = b2.beaconSpawns;
console.log('  killing 8 more friendly bots AFTER expiry');
await killFriends(8);
await page.evaluate(() => { window.__ENGINE__.time.scale = 2; });
await page.waitForTimeout(6000);
await page.evaluate(() => { window.__ENGINE__.time.scale = 1; });
const b3 = await state();
console.log(`  beaconSpawns=${b3.beaconSpawns} (was ${spawnsAtExpiry} at expiry)`);
await page.screenshot({ path: `${SHOTS}/cache-7-beacon-expired.png` });
check('NO respawn used the beacon after it expired', b3.beaconSpawns === spawnsAtExpiry,
  `${spawnsAtExpiry} -> ${b3.beaconSpawns}`);

console.log(`\n[cache] ${fails ? `FAIL — ${fails} check(s)` : 'PASS — every check'}`);
if (errors.length) console.log('[cache] page errors', errors.slice(0, 6));
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
