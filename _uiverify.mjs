/**
 * TASK 2 + 3 PHOTOGRAPHY — the hostile hull, and a medical post from range and
 * from the prompt.
 *   node _uiverify.mjs <url> <outDir>
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = process.argv[2] ?? 'http://127.0.0.1:4380/?seed=7';
const OUT = process.argv[3] ?? 'shots/uiverify';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
await page.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 180000 });
await page.evaluate(() => {
  const e = window.__ENGINE__; e.time.scale = 1;
  const ai = e.ctx.peek('ai'); ai.combatEnabled = false; ai.protect(e.ctx.peek('player'), 9999);
});
await page.mouse.click(700, 400); await page.waitForTimeout(400);

const dump = () => page.evaluate(() => {
  const q = (sel) => [...document.querySelectorAll(sel)].filter((n) => n.style.display !== 'none');
  return {
    veh: q('.ow-veh').map((n) => ({
      l: n.querySelector('.ow-veh-l')?.textContent,
      d: n.querySelector('.ow-veh-d')?.textContent,
      bar: n.querySelector('.ow-veh-track i')?.style.transform,
      w: n.style.width, h: n.style.height, edge: n.classList.contains('edge'),
      colour: getComputedStyle(n).color,
    })),
    cache: q('.ow-cache').map((n) => ({
      l: n.querySelector('.ow-cache-label')?.textContent,
      s: n.querySelector('.ow-cache-sub')?.textContent,
      med: n.classList.contains('med'),
      glyph: [...n.querySelectorAll('.ow-cache-glyph svg')].findIndex((g) => g.style.display !== 'none'),
    })),
    med: q('.ow-vt-med').map((n) => ({ t: n.textContent, cls: n.className })),
  };
});


/** Look at `what` RIGHT NOW — the hull moves while the frame settles. */
const reaim = (what) => page.evaluate((w) => {
  const e = window.__ENGINE__; const m = e.ctx.peek('match'); const p = e.ctx.peek('player');
  let t = null;
  if (w === 'tank') t = m.tank.tanks.find((x) => x.alive && x.team !== m.playerTeam)?.position;
  else t = (m.caches?.list ?? []).filter((c) => c.kind === 'medic')[0]?.position;
  if (!t) return null;
  const eye = e.ctx.camera.position;
  const dx = t.x - eye.x; const dz = t.z - eye.z; const dy = t.y - eye.y;
  // movement._fwd is (-sin yaw, 0, -cos yaw) — @see src/player/movement.js
  p.movement.yaw = Math.atan2(-dx, -dz);
  p.movement.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return +Math.hypot(dx, dz).toFixed(1);
}, what);

/* ---------------------------------------------------------------- TANK --- */
const tk = await page.evaluate(() => {
  const e = window.__ENGINE__; const m = e.ctx.peek('match');
  if (!m.tank?.tanks?.length) return { err: 'no tanks' };
  m.tank.fire();
  return { tanks: m.tank.tanks.map((t) => ({ id: t.id, team: t.team, alive: t.alive })), me: m.playerTeam };
});
console.log('tank fire ->', JSON.stringify(tk));
await page.waitForTimeout(3500);

async function shootTank(dist, tag) {
  const info = await page.evaluate((d) => {
    const e = window.__ENGINE__; const m = e.ctx.peek('match'); const p = e.ctx.peek('player');
    const ai = e.ctx.peek('ai'); const g = ai.grid;
    const t = m.tank.tanks.find((x) => x.alive && x.team !== m.playerTeam);
    if (!t) return null;
    const V3 = t.position.constructor;
    let best = null; let bestErr = 1e9;
    for (let a = 0; a < 48; a++) {
      const th = (a / 48) * Math.PI * 2;
      for (let r = Math.max(6, d - 8); r <= d + 8; r += 1.5) {
        const x = t.position.x + Math.cos(th) * r;
        const zz = t.position.z + Math.sin(th) * r;
        const ci = g.nearest(x, zz, t.position.y, 3, 3);
        if (ci < 0) continue;
        const cx = g.worldX(ci % g.nx); const cz = g.worldZ((ci / g.nx) | 0);
        const real = Math.hypot(cx - t.position.x, cz - t.position.z);
        const err = Math.abs(real - d);
        if (err < bestErr) { bestErr = err; best = { x: cx, y: g.floor[ci], z: cz, real }; }
      }
    }
    if (!best) return null;
    p.movement.yaw = Math.atan2(-(t.position.x - best.x), -(t.position.z - best.z));
    p.movement.pitch = 0.0; p.movement.velocity.set(0, 0, 0);
    p.movement.teleport(best.x, best.y + 0.05, best.z);
    return { dist: +best.real.toFixed(1), id: t.id, team: t.team, hp: t.health, me: m.playerTeam };
  }, dist);
  if (!info) { console.log(`tank @${dist}m — no hostile hull / no cell`); return; }
  await page.waitForTimeout(900);
  await reaim('tank');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/tank-${tag}.png` });
  console.log(`${OUT}/tank-${tag}.png  ${info.dist}M ${info.id} team=${info.team} me=${info.me} hp=${info.hp}  ${JSON.stringify((await dump()).veh)}`);
}
await shootTank(22, 'close');
await shootTank(60, 'far');
// and a wounded one, so the bar and the amber state are photographed too
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const t = m.tank.tanks.find((x) => x.alive && x.team !== m.playerTeam);
  if (t) t.health = t.health * 0.22;
});
await shootTank(30, 'weak');

/* ---------------------------------------------------------------- MED --- */
async function shootMed(dist, tag) {
  const info = await page.evaluate((d) => {
    const e = window.__ENGINE__; const m = e.ctx.peek('match'); const p = e.ctx.peek('player');
    const ai = e.ctx.peek('ai'); const g = ai.grid;
    const posts = (m.caches?.list ?? []).filter((c) => c.kind === 'medic');
    if (!posts.length) return null;
    const c = posts[0];
    // hurt him, so the vitals line has a reason to exist. `Health.value` is the
    // number the widget reads; regen would refill it, so it is pinned off too.
    if (p.health) { p.health.regenEnabled = false; p.health.value = 44; }
    let best = null; let bestErr = 1e9;
    for (let a = 0; a < 48; a++) {
      const th = (a / 48) * Math.PI * 2;
      for (let r = Math.max(1.4, d - 6); r <= d + 6; r += 1) {
        const x = c.position.x + Math.cos(th) * r;
        const zz = c.position.z + Math.sin(th) * r;
        const ci = g.nearest(x, zz, c.position.y, 3, 3);
        if (ci < 0) continue;
        const cx = g.worldX(ci % g.nx); const cz = g.worldZ((ci / g.nx) | 0);
        const real = Math.hypot(cx - c.position.x, cz - c.position.z);
        const err = Math.abs(real - d);
        if (err < bestErr) { bestErr = err; best = { x: cx, y: g.floor[ci], z: cz, real }; }
      }
    }
    if (!best) return null;
    p.movement.yaw = Math.atan2(-(c.position.x - best.x), -(c.position.z - best.z));
    p.movement.pitch = 0.03; p.movement.velocity.set(0, 0, 0);
    p.movement.teleport(best.x, best.y + 0.05, best.z);
    return { dist: +best.real.toFixed(1), posts: posts.length, at: [+c.position.x.toFixed(1), +c.position.z.toFixed(1)] };
  }, dist);
  if (!info) { console.log(`med @${dist}m — no post / no cell`); return; }
  await page.waitForTimeout(1100);
  await reaim('med');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/med-${tag}.png` });
  const d = await dump();
  console.log(`${OUT}/med-${tag}.png  ${info.dist}M posts=${info.posts}  caches=${JSON.stringify(d.cache)}  vitals=${JSON.stringify(d.med)}`);
}
await shootMed(20, 'far');
await shootMed(2.2, 'reach');

if (errs.length) console.log('PAGE ERRORS', errs.slice(0, 8)); else console.log('no page errors');
await browser.close();
