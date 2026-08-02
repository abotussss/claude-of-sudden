/**
 * WHAT A ROUND IS ACTUALLY WORTH TO A DRONE.
 *
 * 「ドローンの体力は2回から3回球が当たって破壊されるのでちょうどいい」 — the target is
 * a rounds-to-kill, not a number, so the number has to come out of a
 * measurement. This fires each gun's own `damage` / `penetration` at a parked
 * drone through the canonical `phys.fireBullet` path — the same MASK.BULLET
 * every rifle in the game uses — and reports the EFFECTIVE damage per round,
 * which is not the def's figure because the collider box is scored on the entry
 * AND the exit face (`tank.js`, `oneWoundPerRound`).
 *
 * Usage: node _dronehp.mjs [url] [seed]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4483/';
const SEED = process.argv[3] ?? '7';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(async () => {
  const m = window.__ENGINE__.ctx.peek('match');
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
});

const out = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const p = e.ctx.peek('player');
  const phys = e.ctx.peek('physics');
  const d = m.drones;
  const guns = [
    { id: 'rifle', damage: 17, penetration: 1.0 },
    { id: 'ak', damage: 21, penetration: 1.25 },
    { id: 'lmg', damage: 17, penetration: 1.4 },
    { id: 'smg', damage: 15, penetration: 0.45 },
    { id: 'pistol', damage: 16, penetration: 0.35 },
    { id: 'sniper', damage: 125, penetration: 2.4 },
  ];
  const z = m.sites[1] ?? m.sites[0];
  p.respawnAt(z.position, 0);
  await new Promise((r) => requestAnimationFrame(r));
  const res = [];
  for (const g of guns) {
    for (const x of d.list) if (x.alive) d._retire(x, 'probe');
    const one = d.fire(m.playerTeam === 0 ? 1 : 0);
    if (!one) { res.push({ id: g.id, skipped: 'no slot' }); continue; }
    const eye = e.ctx.camera.position;
    one.vel.set(0, 0, 0);
    one.state = 'recover';
    one.recoverT = 60;
    /**
     * A CLEAR SHOT, FOUND RATHER THAN ASSUMED. Parking it at a fixed offset
     * from the eye put it behind a bank of dirt on this seed and every round
     * died at 0.83 m — twelve rounds, zero events, which reads exactly like a
     * broken collider and is not one. Sweep the sky until the canonical
     * `MASK.BULLET` ray reaches the drone itself, then shoot at that.
     */
    let placed = false;
    for (let a = 0; a < 16 && !placed; a++) {
      const th = (a / 16) * Math.PI * 2;
      const el = 0.55;
      const dx = Math.cos(th) * Math.cos(el);
      const dy = Math.sin(el);
      const dz = Math.sin(th) * Math.cos(el);
      one.position.set(eye.x + dx * 18, eye.y + dy * 18, eye.z + dz * 18);
      one.collider?.setSphere(one.position.x, one.position.y, one.position.z, 0.31);
      // `part`, not `owner`: the hit record carries `actor` / `collider` and a
      // `part` string, and there is no `owner` field on it at all — testing for
      // one is how the first pass concluded "no clear line" sixteen times.
      const h = phys.raycast(eye.x, eye.y, eye.z, dx, dy, dz, 40, phys.MASK.BULLET);
      if (h?.hit && h.part === 'drone') placed = true;
    }
    if (!placed) { res.push({ id: g.id, skipped: 'no clear line' }); d._retire(one, 'probe'); continue; }
    // A tall bar of health so several rounds land before it dies: this measures
    // the damage a round is WORTH, and the rounds-to-kill is arithmetic on it.
    one.health = 100000;
    await new Promise((r) => requestAnimationFrame(r));
    const dir = { x: 0, y: 0, z: 0 };
    let rounds = 0;
    let events = 0;
    const off = e.ctx.events.on('damage:dealt', (ev) => { if (ev.target === one) events++; });
    const hp0 = one.health;
    while (rounds < 6) {
      dir.x = one.position.x - eye.x;
      dir.y = one.position.y - eye.y;
      dir.z = one.position.z - eye.z;
      const l = Math.hypot(dir.x, dir.y, dir.z);
      dir.x /= l; dir.y /= l; dir.z /= l;
      phys.fireBullet({
        origin: eye, dir, damage: g.damage, penetration: g.penetration,
        maxDist: 60, mask: phys.MASK.BULLET, shooter: p,
      });
      rounds++;
      await new Promise((r) => requestAnimationFrame(r));
    }
    off();
    const spent = hp0 - one.health;
    d._retire(one, 'probe');
    res.push({
      id: g.id, nominal: g.damage, rounds, events,
      perRound: +(spent / rounds).toFixed(1),
      ratio: +(spent / rounds / g.damage).toFixed(2),
    });
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
const hp = [50, 60, 65, 70, 90];
for (const h of hp) {
  console.log(
    `HP ${h}:`,
    out.filter((r) => r.perRound).map((r) => `${r.id} ${Math.ceil(h / r.perRound)}`).join('  ')
  );
}
console.log('pageerrors', errs.length, errs.slice(0, 4));
await b.close();
