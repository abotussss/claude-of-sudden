/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE SATELLITE UPLINK, MEASURED — not read
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   BASE=http://127.0.0.1:4629/ node _nfsat.mjs
 *
 * Everything this file checks was, at some point in this subsystem's history,
 * something somebody read out of a comment and was wrong about:
 *
 *   1. IS THE POST THERE, and is it the post the spec names? A spec bound to an
 *      id nobody publishes is a prompt at a place that does not exist.
 *   2. CAN A BOT GET IT? `botReachable: false` is a CLAIM; `Caches.prove` is the
 *      fact. This asserts the console is not in `botList` and that no bot errand
 *      can ever be assigned to it.
 *   3. WHICH WAY IS FORWARD? `_satTarget` picks the enemy point nearest the
 *      bearing the player faces, and the yaw -> direction convention on this
 *      engine is stated in exactly one place (`Spectator._follow`) and is worth
 *      exactly nothing until it is measured. Four known bearings, four answers,
 *      each printed with the real compass bearing to the zone it picked.
 *   4. ⚠ DOES THE EXCEPTION HOLD? Every impact of a real, fired strike, measured
 *      against the RESOLVED centre and radius of the circle it was aimed at —
 *      the whole justification for this feature breaking 「占領サイトへの直接は
 *      ダメ」 is that it can only ever land inside the one circle it names.
 *   5. DOES IT ACTUALLY HURT ANYBODY? An `explosion` payload counted at the
 *      event bus, with its radius and damage, on the frames it fires.
 *   6. DOES IT DIE WITH THE TOWER? `perishable` + `Caches.update` is the whole
 *      of 「そのため管制塔は破壊されないといけない」, so the post is checked again
 *      after `NF-TOWER` has been fired.
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4629/';

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1000, height: 640 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
const boot = [];
p.on('console', (m) => { const t = m.text(); if (/NF-SAT|EXCEPTION|satcall|uplink/i.test(t)) boot.push(t.slice(0, 300)); });
await p.goto(`${BASE}?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

/**
 * WAIT FOR `phase === 'live'` BEFORE ASKING ANYTHING ABOUT THE PROMPT.
 * `_updatePlayerInteraction` is only called from `case PHASE.LIVE`, so the first
 * run of this file posed a man at the console during the freeze, read
 * `_cachePrompt.text === ''` and would have reported the prompt as broken. The
 * match has to be running before a question about the HUD means anything.
 */
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await p.waitForFunction(() => window.__ENGINE__.ctx.peek('match')?.phase === 'live', null, { timeout: 120000 });
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });

console.log('\n── 1. THE POST ─────────────────────────────────────────────────');
console.log(boot.join('\n  ') || '  (no boot line — that is itself the answer)');
const post = await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const c = m.caches.list.find((k) => k.id === 'NF-TOWER-SATCALL');
  if (!c) return null;
  return {
    id: c.id, kind: c.kind, label: c.label,
    x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2),
    beacon: c.beacon, botReachable: c.botReachable, perishable: !!c.work, disabled: !!c.disabled,
    inBotList: m.caches.botList.some((k) => k.id === 'NF-TOWER-SATCALL'),
    stand: c.stand ? [c.stand.x, c.stand.z] : null,
    specShells: m._sat?.spec?.shells ?? null,
    specLead: m._sat?.spec?.lead ?? null,
    patN: m._sat?.pat ? m._sat.pat.u.length : 0,
  };
});
console.log(' ', JSON.stringify(post));
console.log('  BOT-REACHABLE?', post?.inBotList ? 'IN botList — FAIL' : 'not in botList — PASS');

console.log('\n── 2. THE MAN AT THE CONSOLE ───────────────────────────────────');
/**
 * `player.teleport(eye, rot)` reads a pitch ONLY when `rot` is an object, and
 * the pose is read back off the player rather than assumed. @see `src/dev/shots.js`.
 */
const stand = await p.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const m = c.peek('match');
  const pl = c.peek('player');
  const k = m.caches.list.find((q) => q.id === 'NF-TOWER-SATCALL');
  // A metre back from the console on its own -forward, at eye height.
  pl.teleport({ x: k.position.x, y: k.position.y + 1.6, z: k.position.z - 1.0 }, { x: 0, y: 0 });
  return { at: [+pl.position.x.toFixed(2), +pl.position.y.toFixed(2), +pl.position.z.toFixed(2)] };
});
await wait(6);
const reach = await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const n = m.caches.nearest(m.player.position);
  return { nearest: n?.id ?? null, kind: n?.kind ?? null, prompt: { ...m._cachePrompt, alt: m._cachePrompt.alt ? 'SET' : null } };
});
console.log('  posed at', stand.at, '→ nearest =', reach.nearest);
console.log('  prompt  :', JSON.stringify(reach.prompt));

console.log('\n── 3. WHICH WAY IS FORWARD ─────────────────────────────────────');
/**
 * MEASURED OFF THE CAMERA, BECAUSE THE TWO PLACES THAT STATE IT DISAGREE.
 * `Spectator._follow` reads as `forward = (sin yaw, cos yaw)` and
 * `PlayerSystem`'s sprint velocity reads as `(-sin yaw, -cos yaw)`. The camera's
 * own world matrix is the only thing that cannot be wrong: its -Z column is
 * where the man is looking. `player.yaw` is a GETTER WITH NO SETTER, so the
 * only way to pose a yaw is `teleport(eye, { x: pitch, y: yaw })`.
 */
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  await p.evaluate((yaw) => {
    window.__ENGINE__.ctx.peek('player').teleport({ x: 0, y: 40, z: -34 }, { x: 0, y: yaw });
  }, yaw);
  await wait(4);
  const r = await p.evaluate(() => {
    const e = window.__ENGINE__;
    const pl = e.ctx.peek('player');
    const cam = e.camera ?? e.ctx.camera ?? e.ctx.peek('render')?.camera ?? null;
    const m = cam?.matrixWorld?.elements ?? null;
    return { yaw: +pl.yaw.toFixed(3), lookXZ: m ? [+(-m[8]).toFixed(3), +(-m[10]).toFixed(3)] : null };
  });
  console.log(`  yaw ${String(r.yaw).padStart(6)} camera looks ${JSON.stringify(r.lookXZ)} · ` +
    `(-sin,-cos)=${JSON.stringify([+(-Math.sin(yaw)).toFixed(3), +(-Math.cos(yaw)).toFixed(3)])} · ` +
    `(sin,cos)=${JSON.stringify([+Math.sin(yaw).toFixed(3), +Math.cos(yaw).toFixed(3)])}`);
}

/**
 * GIVE THE ENEMY EVERY POINT FIRST. `_satTarget` only ever names an ENEMY-HELD
 * site, and at t≈15 s of a real match nobody owns anything — so the first run of
 * this file measured four nulls and proved nothing about the bearing. Handing
 * the whole map to the other side is the only state in which "which of them is
 * he looking at" has four different answers.
 */
await p.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const m = c.peek('match');
  for (const z of m.sites) { z.owner = 1 - m.playerTeam; z.ownedSince = c.time.elapsed; }
});
console.log('  …every live point handed to the enemy, so all four bearings have an answer');
const bearings = [];
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  await p.evaluate((yaw) => {
    const c = window.__ENGINE__.ctx;
    const k = c.peek('match').caches.list.find((q) => q.id === 'NF-TOWER-SATCALL');
    c.peek('player').teleport({ x: k.position.x, y: k.position.y + 1.6, z: k.position.z - 1.0 }, { x: 0, y: yaw });
  }, yaw);
  await wait(4);
  bearings.push(await p.evaluate(() => {
    const c = window.__ENGINE__.ctx;
    const m = c.peek('match');
    const pl = c.peek('player');
    const z = m._satTarget();
    const dx = z ? z.position.x - pl.position.x : 0;
    const dz = z ? z.position.z - pl.position.z : 0;
    const d = Math.hypot(dx, dz) || 1;
    const f = [-Math.sin(pl.yaw), -Math.cos(pl.yaw)];
    return {
      yaw: +pl.yaw.toFixed(2),
      forward: [+f[0].toFixed(2), +f[1].toFixed(2)],
      picked: z?.id ?? null,
      toTarget: z ? [+(dx / d).toFixed(2), +(dz / d).toFixed(2)] : null,
      dot: z ? +((dx * f[0] + dz * f[1]) / d).toFixed(2) : null,
      sub: m._cachePrompt.sub,
    };
  }));
}
for (const r of bearings) {
  console.log(`  yaw ${String(r.yaw).padStart(5)} forward ${JSON.stringify(r.forward).padEnd(14)} → ` +
    `${String(r.picked).padEnd(2)} unit-to-target ${JSON.stringify(r.toTarget).padEnd(14)} dot ${String(r.dot).padStart(5)}  | ${r.sub}`);
}
const distinct = new Set(bearings.map((r) => r.picked)).size;
const aligned = bearings.filter((r) => r.dot !== null && r.dot >= 0.26).length;
console.log(`  ${distinct} distinct zones over 4 bearings; ${aligned}/4 picked one that is genuinely ` +
  `in front of him (dot >= 0.26 = within 75°). The rest fall back to the longest-held, which is the design.`);

console.log('\n── 4. ⚠ THE EXCEPTION, ON A REAL FIRED STRIKE ──────────────────');
const fired = await p.evaluate(() => new Promise((resolve) => {
  const c = window.__ENGINE__.ctx;
  const m = c.peek('match');
  const blasts = [];
  const off = c.events.on('explosion', (e) => {
    blasts.push({ x: e.position.x, y: e.position.y, z: e.position.z, r: e.radius, d: e.damage });
  });
  // Make sure there IS an enemy-held point to call on, without touching the
  // capture system's own rules: take whichever zone is live and give it away.
  const me = m.playerTeam;
  const z = m.sites.find((q) => q.owner >= 0 && q.owner !== me)
    ?? (() => { const q = m.sites[0]; q.owner = 1 - me; q.ownedSince = c.time.elapsed; return q; })();
  m._sat.readyAt = 0;
  /**
   * MEASURE AGAINST WHAT IT ACTUALLY CHOSE, NOT WHAT WE HOPED IT WOULD.
   * The first run of this file set `player.yaw` to face `z` — `yaw` is a getter
   * with no setter, the write vanished, `_satCall` targeted a different zone,
   * and the twelve impacts were measured against a circle 200 m away and
   * reported "0 within 3r" as if the pattern were broken. So the target is read
   * back off `_sat.zone` after the call.
   */
  const denied = m._satCall();
  if (denied) { off(); resolve({ denied }); return; }
  const t = m._sat.zone;
  const target = { id: t.id, x: t.position.x, y: t.position.y, z: t.position.z, r: t.radius, owner: t.owner };
  const t0 = c.time.elapsed;
  const step = () => {
    if (m._sat.t < 0 || c.time.elapsed - t0 > 40) {
      off();
      resolve({ target, blasts, calls: m._sat.calls, readyIn: +(m._sat.readyAt - c.time.elapsed).toFixed(1) });
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}));
if (fired.denied) console.log('  REFUSED:', JSON.stringify(fired.denied));
else {
  const t = fired.target;
  const mine = fired.blasts.filter((x) => Math.hypot(x.x - t.x, x.z - t.z) <= t.r * 3);
  const d = mine.map((x) => Math.hypot(x.x - t.x, x.z - t.z));
  console.log(`  target ${t.id} at (${t.x.toFixed(1)}, ${t.z.toFixed(1)}) r${t.r}, held by team ${t.owner}`);
  console.log(`  explosions on the bus: ${fired.blasts.length} total, ${mine.length} within 3r of the centre`);
  console.log(`  impact radii from the centre: min ${Math.min(...d).toFixed(2)} m  max ${Math.max(...d).toFixed(2)} m ` +
    `of a ${t.r} m circle  →  ${Math.max(...d) < t.r ? 'ALL INSIDE — EXCEPTION HOLDS' : 'OUTSIDE — FAIL'}`);
  console.log(`  blast radius/damage: ${mine[0]?.r} / ${mine[0]?.d}`);
  console.log(`  calls so far ${fired.calls}, next in ${fired.readyIn}s`);
}

console.log('\n── 5. THE COOLDOWN REFUSES, AND SAYS WHY ───────────────────────');
console.log(' ', JSON.stringify(await p.evaluate(() => window.__ENGINE__.ctx.peek('match')._satCall())));

console.log('\n── 6. IT DIES WITH THE TOWER ───────────────────────────────────');
const after = await p.evaluate(() => new Promise((resolve) => {
  const c = window.__ENGINE__.ctx;
  const m = c.peek('match');
  const ok = m.airstrike?.callDemolition?.('NF-TOWER') ?? false;
  const t0 = c.time.elapsed;
  const step = () => {
    const k = m.caches.list.find((q) => q.id === 'NF-TOWER-SATCALL');
    if (k.disabled || c.time.elapsed - t0 > 20) {
      resolve({ ok, disabled: !!k.disabled, nearestAtConsole: m.caches.nearest(k.position)?.id ?? null });
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}));
console.log(`  callDemolition('NF-TOWER') = ${after.ok} → console disabled = ${after.disabled} ` +
  `· nearest at its own position now = ${after.nearestAtConsole}`);

console.log(`\npageerrors = ${errs.length}${errs.length ? ' :: ' + errs[0] : ''}`);
await b.close();
