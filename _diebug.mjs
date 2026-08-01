/**
 * THE REPORTED BUG, DRIVEN END TO END:
 *   「武器を武器庫から変えた後に死ぬとメイン武器書質するし、ハンドガンしか
 *     持てなくてそれすらもう撃てない」
 *
 *   node _diebug.mjs [--url=…] [--seed=7]
 *
 * Take a primary off an armoury rack with a real HOLD F, die, respawn, and then
 * DUMP THE WHOLE WEAPON STATE rather than guessing at it: every state row's
 * mag / chamber / reserve, which slot is active, what `_switchTo` is, what the
 * viewmodel thinks is in the hands, and whether the fire path is gated. Then
 * pull the trigger for real and count the rounds that actually left the barrel
 * (`weapon:fire` + `weapons.stats.fired`).
 *
 * Nothing here decides anything: it only reports.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const SEED = args.seed ?? '7';
const URL = args.url ?? `http://127.0.0.1:4350/?seed=${SEED}`;
const SHOTS = args.shots ?? 'shots';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message)));

console.log(`[die] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
await page.waitForFunction(
  () => window.__ENGINE__.ctx.peek('match').phase === 'live',
  null,
  { timeout: 180000 }
);
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.time.scale = 1;
  const ai = e.ctx.peek('ai');
  ai.combatEnabled = false;
  ai.protect(e.ctx.peek('player'), 9999);
  window.__M__ = e.ctx.peek('match');
  window.__W__ = e.ctx.peek('weapons');
  // Count what actually comes out of the barrel, and what it hits.
  window.__FIRED__ = 0;
  window.__HITS__ = 0;
  window.__WOUND__ = 0;
  window.__WHO__ = '';
  e.ctx.events.on('weapon:fire', () => { window.__FIRED__++; });
  /**
   * A ROUND THAT WOUNDED SOMEBODY, and only the ones the PLAYER fired: `source`
   * is the attribution physics puts on the payload. Counting every
   * `damage:dealt` on the bus would also count the bots shooting each other.
   */
  e.ctx.events.on('damage:dealt', (ev) => {
    if (ev?.source !== e.ctx.peek('player')) return;
    window.__HITS__++;
    window.__WOUND__ += ev.amount ?? 0;
    window.__WHO__ = ev.target?.name ?? 'unnamed';
  });
});
await page.mouse.click(800, 450);
await page.waitForTimeout(400);

const dump = (tag) =>
  page.evaluate((label) => {
    const e = window.__ENGINE__;
    const wp = window.__W__;
    const p = e.ctx.peek('player');
    const vm = wp.viewmodel;
    const rows = {};
    for (const [id, s] of wp.states) {
      rows[id] = `mag=${s.mag}${s.chambered ? '+1' : ''} res=${s.reserve} cls=${s.def.class}`;
    }
    let hud = null;
    try { hud = wp.getHudState(); } catch (err) { hud = { name: 'THREW ' + err.message }; }
    return {
      label,
      t: +e.time.elapsed.toFixed(2),
      dead: p.dead ?? p.health?.dead,
      health: +(p.health?.value ?? -1).toFixed(0),
      controlEnabled: p.controlEnabled,
      inputEnabled: e.ctx.input?.enabled,
      inputFrozen: e.ctx.input?.frozen,
      primaryId: wp.primaryId,
      activeId: wp.activeId,
      primaryIds: wp.primaryIds.join(','),
      weaponIds: wp.weaponIds.join(','),
      switchTo: wp._switchTo,
      switching: wp.switching,
      switchTimer: +(wp._switchTimer ?? 0).toFixed(3),
      locked: wp.locked,
      reloading: wp.reloading,
      clipName: vm?.clipName ?? null,
      fireTimer: +(wp._fireTimer ?? 0).toFixed(3),
      cooking: wp._cooking,
      throwing: wp._throwing,
      burstLeft: wp._burstLeft,
      canFire: wp.canFire(),
      ammo: wp.ammo,
      rows,
      hudName: hud.name,
      hudAmmo: `${hud.ammo}/${hud.reserve}`,
      vmActive: vm?.active?.id ?? vm?.activeId ?? null,
      vmVisible: vm?.active?.group?.visible ?? null,
      vmGroups: [...(vm?.weapons?.entries?.() ?? [])]
        .map(([id, w]) => `${id}:${w.group.visible ? 'vis' : 'hid'}`)
        .join(' '),
      debugMode: wp.debugMode,
    };
  }, tag);

const show = (d) => {
  console.log(`\n── ${d.label}  (t=${d.t})`);
  console.log(`   dead=${d.dead} hp=${d.health} control=${d.controlEnabled} ` +
    `input.enabled=${d.inputEnabled} frozen=${d.inputFrozen}`);
  console.log(`   primaryId=${d.primaryId}  activeId=${d.activeId}  vmActive=${d.vmActive} ` +
    `vmVisible=${d.vmVisible}`);
  console.log(`   primaryIds=[${d.primaryIds}]  weaponIds=[${d.weaponIds}]`);
  console.log(`   _switchTo=${d.switchTo} switching=${d.switching} timer=${d.switchTimer} ` +
    `locked=${d.locked} reloading=${d.reloading} clip=${d.clipName}`);
  console.log(`   fireTimer=${d.fireTimer} cooking=${d.cooking} throwing=${d.throwing} ` +
    `burst=${d.burstLeft}  canFire=${d.canFire}`);
  console.log(`   ammo mag=${d.ammo.mag} reserve=${d.ammo.reserve} magSize=${d.ammo.magSize} ` +
    `chambered=${d.ammo.chambered}`);
  console.log(`   hud "${d.hudName}" ${d.hudAmmo}`);
  console.log(`   vm groups: ${d.vmGroups}`);
  for (const [id, r] of Object.entries(d.rows)) console.log(`      ${id.padEnd(8)} ${r}`);
};

const goTo = (id) =>
  page.evaluate((cid) => {
    const e = window.__ENGINE__;
    const m = window.__M__;
    const p = e.ctx.peek('player');
    const c = m.caches.list.find((x) => x.id === cid);
    if (!c) return null;
    p.health.reset(true);
    p.setControlEnabled(true);
    const px = c.position.x - Math.sin(c.yaw) * 1.1;
    const pz = c.position.z - Math.cos(c.yaw) * 1.1;
    p.movement.yaw = c.yaw;
    p.movement.pitch = 0;
    p.movement.velocity.set(0, 0, 0);
    p.movement.teleport(px, c.position.y + 0.05, pz);
    e.ctx.peek('ai').protect(p, 9999);
    return { id: c.id, kind: c.kind, label: c.label, weaponId: c.weaponId };
  }, id);

const holdF = async (ms) => {
  await page.keyboard.down('KeyF');
  await page.waitForTimeout(ms);
  await page.keyboard.up('KeyF');
  await page.waitForTimeout(300);
};

/** Kill the player for real: full damage through `player.health`. */
const die = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const p = e.ctx.peek('player');
    p.health.damage(9999, null, { type: 'bullet' });
    return p.health.dead;
  });

/**
 * WHAT A DEAD PLAYER ACTUALLY DOES, and every one of these is a control the
 * game itself hands him while he is dead:
 *   LMB is the SPECTATOR'S OWN CYCLE BUTTON (`Spectator.update` cycles on
 *   `input.firePressed`), so clicking to look at a teammate is unavoidable.
 *   The wheel and 1/2/3 are the weapon slots, which nothing takes away.
 */
const deadInput = async () => {
  await page.mouse.down();
  await page.waitForTimeout(220);
  await page.mouse.up();
  await page.waitForTimeout(120);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(300);
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(200);
};

const waitRespawn = async () => {
  await page.evaluate(() => { window.__ENGINE__.time.scale = 4; });
  await page.waitForFunction(
    () => window.__ENGINE__.ctx.peek('player').health.dead === false,
    null,
    { timeout: 60000 }
  );
  await page.evaluate(() => { window.__ENGINE__.time.scale = 1; });
  await page.waitForTimeout(900);
};

/**
 * PUT A LIVE ENEMY IN FRONT OF THE MUZZLE and aim at his chest.
 *
 * `ai.spawn` is a documented hook, so this is a real man on the enemy team with
 * a real hitbox rather than a probe target: a round that reaches him goes
 * through `physics` → `damage:dealt` → `agent.health`, which is the only proof
 * that "a round left the barrel" also means "it hit something".
 */
const putTarget = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const ai = e.ctx.peek('ai');
    const m = window.__M__;
    const p = e.ctx.peek('player');
    const foe = 1 - m.playerTeam;
    /**
     * A TARGET YOU CAN ACTUALLY SHOOT. Dropping him along the player's own
     * facing put him behind a wall — the muzzle raycast came back "concrete at
     * 5.5 m" — and a wound count of zero then measures the wall rather than the
     * weapon. Sample the compass and use the clearest lane.
     */
    const phys = e.ctx.peek('physics');
    e.ctx.camera.updateMatrixWorld();
    const probe = p.position.clone();
    let yaw = p.movement.yaw;
    let d = 0;
    for (let i = 0; i < 32; i++) {
      const t = (i / 32) * Math.PI * 2;
      probe.set(-Math.sin(t), 0, -Math.cos(t));
      const h = phys.raycast(e.ctx.camera.position, probe, 24, phys.MASK.BULLET);
      const free = h.hit ? h.distance - 1.5 : 24;
      if (free > d) { d = free; yaw = t; }
    }
    d = Math.max(4, Math.min(d, 14));
    const x = p.position.x - Math.sin(yaw) * d;
    const z = p.position.z - Math.cos(yaw) * d;
    const y = ai.groundAt(x, z, p.position.y + 3);
    const at = p.position.clone().set(x, y, z);
    const variant = m._botsByTeam?.[foe]?.[0]?.variantName;
    const a = ai.spawn(variant, at, yaw + Math.PI, { team: foe, name: 'PROBE-TGT' });
    if (!a) return null;
    // Aim at his chest: yaw is (-sin, -cos) forward, pitch positive is up.
    const dx = a.position.x - e.ctx.camera.position.x;
    const dz = a.position.z - e.ctx.camera.position.z;
    const dy = a.position.y + 1.25 - e.ctx.camera.position.y;
    p.movement.yaw = Math.atan2(-dx, -dz);
    p.movement.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    window.__TGT__ = a;
    return { name: a.name, team: a.team, health: a.health, dist: +Math.hypot(dx, dz).toFixed(1) };
  });

/**
 * Re-point at the target and say what the muzzle line actually reaches. Called
 * before every trigger pull, because the man is a live agent and walks.
 */
const aim = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const p = e.ctx.peek('player');
    const a = window.__TGT__;
    if (!a) return null;
    const cam = e.ctx.camera;
    const dx = a.position.x - cam.position.x;
    const dz = a.position.z - cam.position.z;
    const dy = a.position.y + 1.2 - cam.position.y;
    p.movement.yaw = Math.atan2(-dx, -dz);
    p.movement.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    p.rig.update(1 / 60, p.movement, p.health);
    p.rig.applyTo(cam);
    cam.updateMatrixWorld();
    const phys = e.ctx.peek('physics');
    const dir = cam.position.clone().set(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    const h = phys.raycast(cam.position, dir, 40, phys.MASK.BULLET);
    return { reaches: h.hit ? (h.actor?.name ?? h.surface ?? 'world') : 'nothing',
      onTarget: h.actor === a, dist: h.hit ? +h.distance.toFixed(1) : null };
  });

/** Pull the trigger for real and count the rounds that left the barrel. */
const shoot = async (ms = 900) => {
  await page.evaluate(() => {
    window.__FIRED__ = 0;
    window.__HITS__ = 0;
    window.__WOUND__ = 0;
    window.__WHO__ = '';
    window.__MAG0__ = window.__W__.ammo.mag;
  });
  // A semi/bolt weapon needs the trigger cycled; auto only needs it held.
  let lane = null;
  for (let i = 0; i < 6; i++) {
    lane = await aim();
    await page.mouse.down();
    await page.waitForTimeout(ms / 6);
    await page.mouse.up();
    // Long enough for a bolt gun to cycle: the sniper fires ~1 round per pull
    // and a 120 ms gap gave it two shots in six pulls.
    await page.waitForTimeout(320);
  }
  if (lane) console.log(`   muzzle line reaches ${lane.reaches} at ${lane.dist}m ` +
    `(on the probe target: ${lane.onTarget})`);
  await page.waitForTimeout(500);
  return page.evaluate(() => ({
    fireEvents: window.__FIRED__,
    magSpent: window.__MAG0__ - window.__W__.ammo.mag,
    wounds: window.__HITS__,
    damage: +window.__WOUND__.toFixed(1),
    hitWho: window.__WHO__,
  }));
};

const racks = await page.evaluate(() =>
  window.__M__.caches.list.filter((c) => c.kind === 'weapon')
    .map((c) => ({ id: c.id, weaponId: c.weaponId, label: c.label }))
);
console.log(`[die] racks: ${racks.map((r) => `${r.id}=${r.weaponId}`).join(', ')}`);

/** One rack per distinct primary the armoury offers. */
const byWeapon = new Map();
for (const r of racks) if (!byWeapon.has(r.weaponId)) byWeapon.set(r.weaponId, r);
console.log(`[die] distinct primaries on racks: ${[...byWeapon.keys()].join(', ')}`);

let fails = 0;
const check = (name, ok, detail) => {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

for (const [wid, rack] of byWeapon) {
  console.log(`\n[die] ══════════ ARMOURY ${rack.id} → ${wid} (${rack.label}) ══════════`);
  console.log('   at', JSON.stringify(await goTo(rack.id)));
  await page.waitForTimeout(600);
  const b = await dump('BEFORE PICKUP');
  await holdF(900);
  const a = await dump('AFTER HOLD F');
  show(a);
  check(`HOLD F made ${wid} the primary`, a.primaryId === wid,
    `${b.primaryId} -> ${a.primaryId}`);
  check('…and it is in the hands', a.activeId === wid, `active=${a.activeId}`);

  for (let n = 1; n <= 2; n++) {
    await die();
    await page.waitForTimeout(300);
    const dd = await dump(`DEAD ${n}`);
    console.log(`\n   -- DEATH ${n}: active=${dd.activeId} primary=${dd.primaryId} ` +
      `switchTo=${dd.switchTo} locked=${dd.locked} mag=${dd.ammo.mag}`);
    if (!args.quiet) await deadInput();
    const dd2 = await dump(`DEAD ${n} after spectator input`);
    console.log(`   -- while DEAD, after clicking/scrolling: active=${dd2.activeId} ` +
      `mag=${dd2.ammo.mag} switchTo=${dd2.switchTo} clip=${dd2.clipName}`);
    await waitRespawn();
    const d = await dump(`RESPAWNED ${n} (${wid})`);
    show(d);
    check(`respawn ${n} kept ${wid} as the primary`, d.primaryId === wid, `primary=${d.primaryId}`);
    check(`respawn ${n} put it back in the hands`, d.activeId === wid, `active=${d.activeId}`);
    check(`respawn ${n} left a full magazine`, d.ammo.mag > 0, `mag=${d.ammo.mag}`);
    check(`respawn ${n} is not stuck mid-switch`, d.switchTo === null, `_switchTo=${d.switchTo}`);
    check(`respawn ${n} is not left locked`, d.locked === false);
    check(`respawn ${n} canFire`, d.canFire === true);

    const tgt = await putTarget();
    console.log(`   target: ${JSON.stringify(tgt)}`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/diebug-${wid}-respawn-${n}.png` });
    const fire = await shoot(2100);
    console.log(`   FIRE after respawn ${n}: ${JSON.stringify(fire)}`);
    check(`respawn ${n}: rounds left the barrel`, fire.fireEvents > 0,
      `${fire.fireEvents} weapon:fire, ${fire.magSpent} out of the magazine`);
    check(`respawn ${n}: a round wounded somebody`, fire.wounds > 0,
      `${fire.wounds} hits on ${fire.hitWho} for ${fire.damage} damage`);
  }
}

console.log(`\n[die] ${fails} FAIL(s)`);

console.log(`\n[die] pageerrors: ${errors.length}`);
for (const e of errors) console.log('   ' + e);
await browser.close();
