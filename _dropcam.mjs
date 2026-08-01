/**
 * THE HELICOPTER AND THE CANOPIES, PHOTOGRAPHED FROM ABOVE THE ROOFLINE.
 *
 * Every eye-level camera this pass tried ended up against a wall or under an
 * overhang — the drop zones are courtyards with buildings round them, which is
 * the point of a courtyard. The aircraft runs at `RULES.reinforceAltitude` (46 m)
 * and the canopies come down through everything between, so a camera at 18 m
 * over the zone, backed off along the run, sees the whole descent with nothing
 * in the way. It is not a player's eye; it is the shot that proves the event.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('shots/verify', { recursive: true });
const URL = process.argv[2] ?? 'http://127.0.0.1:4294/';
const SEED = process.argv[3] ?? '33';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const frames = (n) => page.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await page.evaluate(() => { const e = window.__ENGINE__; e.input.frozen = true; e.input.enabled = false; e.ctx.peek('player')?.setControlEnabled?.(false); e.ctx.peek('ui')?.debugState?.('clean'); });
await page.evaluate(() => new Promise((done) => {
  const e = window.__ENGINE__, m = e.ctx.peek('match');
  e.time.scale = 10;
  const t = () => (m.phase === 'live' ? done() : requestAnimationFrame(t)); t();
}));
await page.evaluate(() => new Promise((done) => {
  const e = window.__ENGINE__, m = e.ctx.peek('match');
  const want = m.roundClock - 140;
  const t = () => {
    if (m.roundClock <= want && m.sites.some((z) => z.owner >= 0)) { e.time.scale = 1; done(); }
    else requestAnimationFrame(t);
  }; t();
}));
const aim = await page.evaluate(() => {
  const e = window.__ENGINE__, m = e.ctx.peek('match');
  const team = m.score[0] <= m.score[1] ? 0 : 1;
  const zone = m._dropZone(team) ?? m.sites.find((z) => z.owner === team) ?? m.sites[0];
  window.__T__ = team; window.__Z__ = zone;
  const base = m.playerTeam === team ? m._spawnCentre.attack : m._spawnCentre.defend;
  const c = zone.position;
  const dx = c.x - base.x, dz = c.z - base.z, L = Math.hypot(dx, dz) || 1;
  // Backed off ALONG the approach so the aircraft flies toward the lens, high
  // enough to clear the courtyard walls.
  window.__CAM__ = { x: c.x + (dx / L) * 46, y: c.y + 18, z: c.z + (dz / L) * 46 };
  return { team, zone: zone.id, score: m.score.slice() };
});
console.log('drop side:', JSON.stringify(aim));
const place = () => page.evaluate(() => {
  const e = window.__ENGINE__, m = e.ctx.peek('match');
  const V3 = e.camera.position.constructor;
  const r = m.reinforce, c = window.__Z__.position, cam = window.__CAM__;
  e.camera.position.set(cam.x, cam.y, cam.z);
  let tx = c.x, ty = c.y + 12, tz = c.z;
  if (r?.run && r.run.landed < 3) { const el = r.heli.matrix.elements; tx = el[12]; ty = el[13]; tz = el[14]; }
  e.camera.lookAt(new V3(tx, ty, tz));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  return { busy: !!r?.run, out: r?.run?.out ?? 0, landed: r?.run?.landed ?? 0 };
});
await place(); await frames(20);
const fired = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  return m._callReinforcement(window.__T__, 600 - m.roundClock, true, false);
});
console.log('fired:', fired);
for (let i = 1; i <= 44; i++) {
  await frames(20);
  const s = await place();
  await frames(2);
  await page.screenshot({ path: `shots/verify/heli-${String(i).padStart(2, '0')}.png` });
  console.log(`  t${i} busy=${s.busy} out=${s.out} landed=${s.landed}`);
  if (!s.busy && i > 4) break;
}
console.log(errs.length ? `[pageerror] ${errs[0]}` : '[pageerror] none');
await b.close();
