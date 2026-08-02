/**
 * THE THREE NEW GUNS, MEASURED IN ONE BOOT.
 *
 *   node _newguns.mjs [--url=…] [--out=shots/newguns]
 *
 * Four numbers per weapon, none of them read off the def alone:
 *
 *  1. MOVEMENT SPEED with the weapon actually in the hands. `targetSpeed()` is
 *     called on the real PlayerMovement after `PlayerSystem.update` has pushed
 *     `weapons.moveScale` into it, so this measures the wiring rather than the
 *     table — which is the whole question for the LMG's 「足がすごく遅くなる」.
 *  2. TTK vs a 100 HP man: rounds to kill on the torso and on the head (the
 *     head hitbox scales x4, see physics PART_MUL), and the wall-clock time
 *     those rounds take at the weapon's own cycle time — including the reload
 *     if the magazine cannot hold them.
 *  3. Which weapon is ACTUALLY in the hands at capture time, printed next to
 *     the screenshot's filename, because a pose harness that photographs the
 *     previous weapon is worse than one that crashes.
 *  4. Rounds fired through the real trigger, so a weapon that cannot shoot
 *     fails here rather than in a match.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4424/';
const OUT = args.out ?? 'shots/newguns';
const LIST = (args.only ? String(args.only) : 'rifle,lmg,pistol,revolver,mpistol').split(',');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const pump = (n) =>
  page.evaluate(
    (n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }),
    n
  );

await page.evaluate(() => window.__ENGINE__.ctx.peek('ui')?.setHudVisible?.(false));

/* ---- 1. movement speed, weapon by weapon ------------------------------- */
const speeds = await page.evaluate(async (LIST) => {
  const ctx = window.__ENGINE__.ctx;
  const wp = ctx.peek('weapons');
  const pl = ctx.peek('player');
  const mv = pl.movement;
  const out = [];
  const prevStance = mv.stance;
  for (const id of LIST) {
    wp.setWeaponImmediate(id);
    // PlayerSystem.update is what copies weapons.moveScale into movement; run
    // a frame rather than writing the field, so this measures the wiring.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    mv.sprinting = false;
    mv.adsAmount = 0;
    mv.leanAmount = 0;
    const walk = mv.targetSpeed();
    mv.sprinting = true;
    const sprint = mv.targetSpeed();
    mv.sprinting = false;
    out.push({
      id,
      moveScale: +(wp.moveScale ?? 1).toFixed(3),
      wired: +(mv.weaponMoveScale ?? 1).toFixed(3),
      walk: +walk.toFixed(3),
      sprint: +sprint.toFixed(3),
    });
  }
  mv.stance = prevStance;
  return out;
}, LIST);

const ref = speeds.find((s) => s.id === 'rifle');
console.log('\n=== MOVEMENT SPEED (m/s), weapon in the hands ===');
for (const s of speeds) {
  const rel = ref ? ((s.walk / ref.walk - 1) * 100).toFixed(1) : '—';
  const bad = s.wired !== s.moveScale ? '   <-- NOT WIRED' : '';
  console.log(
    `  ${s.id.padEnd(9)} moveScale ${s.moveScale.toFixed(2)}  wired ${s.wired.toFixed(2)}` +
      `  walk ${s.walk.toFixed(2)}  sprint ${s.sprint.toFixed(2)}   ${rel > 0 ? '+' : ''}${rel}% vs rifle${bad}`
  );
}

/* ---- 2. TTK vs a 100 HP man -------------------------------------------- */
const ttk = await page.evaluate((LIST) => {
  const ctx = window.__ENGINE__.ctx;
  const wp = ctx.peek('weapons');
  const out = [];
  for (const id of LIST) {
    const d = wp.states.get(id)?.def;
    if (!d) continue;
    // PART_MUL: head x4 on the AI hitboxes (src/ai/agent.js HITBOXES), and the
    // damage a projectile lands is `damage * partMul` at point blank.
    const body = Math.ceil(100 / d.damage);
    const head = Math.ceil(100 / (d.damage * 4));
    const cycle = 60 / d.rpm;
    const reloads = Math.max(0, Math.ceil(body / d.magSize) - 1);
    out.push({
      id, label: d.label, dmg: d.damage, rpm: d.rpm, mag: d.magSize,
      body, head,
      tBody: +((body - 1) * cycle + reloads * (d.reloadEmpty ?? 0)).toFixed(3),
      tHead: +((head - 1) * cycle).toFixed(3),
    });
  }
  return out;
}, LIST);

console.log('\n=== TTK vs a 100 HP man (point blank, no falloff) ===');
for (const t of ttk) {
  console.log(
    `  ${t.id.padEnd(9)} ${String(t.label).padEnd(7)} ${String(t.dmg).padStart(3)} dmg  ${String(t.rpm).padStart(4)} rpm  mag ${String(t.mag).padStart(3)}` +
      `   torso ${t.body} rds = ${t.tBody.toFixed(2)}s   head ${t.head} rd = ${t.tHead.toFixed(2)}s`
  );
}

/* ---- 3. does the trigger actually work, and what is in the hands -------- */
console.log('\n=== TRIGGER + POSE ===');
for (const id of LIST) {
  for (const kind of ['idle', 'ads']) {
    const info = await page.evaluate(
      ([id, kind]) => {
        const wp = window.__ENGINE__.ctx.peek('weapons');
        wp.debugPose(kind, { weapon: id });
        return { active: wp.activeId, vm: wp.viewmodel.active?.id ?? null };
      },
      [id, kind]
    );
    await pump(50);
    const shown = await page.evaluate(() => {
      const wp = window.__ENGINE__.ctx.peek('weapons');
      return { active: wp.activeId, vm: wp.viewmodel.active?.id ?? null, visible: wp.viewmodel.active?.group.visible };
    });
    await page.screenshot({ path: `${OUT}/${id}-${kind}.png`, clip: { x: 500, y: 300, width: 1000, height: 560 } });
    console.log(
      `  ${id.padEnd(9)} ${kind.padEnd(4)} -> shot shows activeId=${shown.active} viewmodel=${shown.vm}` +
        (shown.vm !== id ? '   <-- WRONG WEAPON PHOTOGRAPHED' : '')
    );
  }
  const fired = await page.evaluate(async (id) => {
    const ctx = window.__ENGINE__.ctx;
    const wp = ctx.peek('weapons');
    wp.debugMode = null;
    wp.setWeaponImmediate(id);
    wp.locked = false;
    const before = wp.stats.fired;
    const magBefore = wp.ammo.mag;
    for (let i = 0; i < 6; i++) {
      wp._fireTimer = 0;
      wp.tryFire();
      await new Promise((r) => requestAnimationFrame(r));
    }
    return { rounds: wp.stats.fired - before, magBefore, magAfter: wp.ammo.mag };
  }, id);
  console.log(
    `  ${id.padEnd(9)}      6 trigger pulls -> ${fired.rounds} rounds left the barrel` +
      `  (mag ${fired.magBefore} -> ${fired.magAfter})` + (fired.rounds < 6 ? '   <-- DID NOT FIRE' : '')
  );
}

console.log(`\npageerrors: ${errs.length}`);
for (const e of errs.slice(0, 5)) console.log('  ' + e);
console.log(`[newguns] wrote captures to ${OUT}`);
await browser.close();
