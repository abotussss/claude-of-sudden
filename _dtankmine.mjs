/**
 * DOES A TANK DIE TO A MINE, AND WHAT DOES FINDING ONE COST?
 *
 * The two things the feature is: 「戦車が通ったら爆発 戦車を破壊するだけのダメージを
 * 出して」. Everything else in the change is scaffolding for these two lines.
 *
 *   1. A live full-health hull is rolled, a mine is laid ON ITS OWN BAKED LEG
 *      20 m ahead of it through the PUBLIC entry point (`weapons.layMine`, the
 *      same one `src/ai` will use), and the run watches the hull drive onto it.
 *      Reported: health before, health after, whether it was destroyed, and the
 *      one wound's size against `RULES.tankHealth`.
 *   2. `weapons.mineStats.probes` divided by frames — the ACTUAL number of
 *      (hull, armed mine) pairs tested per frame, which is the cost claim in
 *      `armourFootprint`'s own comment measured rather than asserted.
 *
 * Also proved here because they are cheap once a hull is rolling:
 *   - a mine does NOT fire under the side that laid it (same-team pass)
 *   - `laneNear` answers on this map, with a count and a sample
 *   - an armed mine's height off the ground, against `NavGrid`'s 0.42 m band
 *
 * Usage: BASE=http://127.0.0.1:4638/ MAP=plains node _dtankmine.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4638/';
const MAP = process.env.MAP ?? 'plains';
const SEED = process.env.SEED ?? '7';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
const logs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { const t = m.text(); if (/\[tank\]|\[weapons\] mine/.test(t)) logs.push(t); });
await page.goto(`${BASE}?capture=1&map=${MAP}&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('map', await page.evaluate(() => window.__ENGINE__?.ctx?.peek('world')?.level?.id ?? '?'));

const res = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const w = e.ctx.peek('weapons');
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.time.scale = 4;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  while (m.phase !== 'live') await frame();
  const armour = m.tank;

  const out = { lanes: armour.laneCount, laneSample: null, cases: [], probes: null };
  const ln = armour.laneNear(0, 0, 200, -1);
  if (ln) out.laneSample = { x: +ln.x.toFixed(1), z: +ln.z.toFixed(1), d: +ln.d.toFixed(1), yaw: +ln.yaw.toFixed(2) };

  // Roll every hull by hand so the run does not wait out the schedule.
  armour.fire();
  for (let i = 0; i < 40; i++) await frame();

  /** Put a mine `ahead` metres down a hull's own leg, in its driving sense. */
  const layAhead = (tank, ahead, team) => {
    const leg = tank.legs[tank.legIx];
    const s = Math.min(leg.length - 0.5, tank.s + ahead * tank.legDir);
    let i = 0;
    while (i < leg.n - 1 && leg.S[i + 1] < s) i++;
    const p = { x: leg.X[i], y: leg.Y[i] + 0.4, z: leg.Z[i] };
    return { ok: w.layMine(p, { team, owner: null }), p };
  };

  const run = async (label, teamOffset) => {
    const tank = armour.tanks.find((t) => t.alive && t.state === 'advance');
    if (!tank) return { label, error: 'no hull advancing' };
    const team = teamOffset === 'same' ? tank.team : tank.team === 0 ? 1 : 0;
    const h0 = tank.health;
    const laid = layAhead(tank, 22, team);
    const rec = {
      label, tank: tank.id, hullTeam: tank.team, mineTeam: team,
      laid: laid.ok, at: [+laid.p.x.toFixed(1), +laid.p.z.toFixed(1)],
      h0: Math.round(h0), h1: null, alive: null, tripped0: w.mineStats.tripped,
      armedY: null, groundY: null, secs: 0,
    };
    // Watch until the hull drives past it or 40 s of match time is gone.
    const t0 = m.roundClock;
    let armedSeen = false;
    while (t0 - m.roundClock < 40) {
      await frame();
      if (!armedSeen && w.mineStats.armed > 0) {
        armedSeen = true;
        const g = w.thrown.field.find((f) => f.live && f.armed);
        if (g?.mesh) {
          // The MODEL's own top, not the group origin — the origin is snapped
          // onto the ground by construction and measuring it says nothing.
          const bb = new (Object.getPrototypeOf(e.camera).constructor.prototype.constructor === Function
            ? window.__THREE_BOX3__ ?? Object : Object)();
          void bb;
          g.mesh.updateMatrixWorld(true);
          let top = -Infinity;
          g.mesh.traverse((o) => {
            if (!o.isMesh) return;
            o.geometry.computeBoundingBox();
            const b3 = o.geometry.boundingBox;
            for (const px of [b3.min.x, b3.max.x]) {
              for (const py of [b3.min.y, b3.max.y]) {
                for (const pz of [b3.min.z, b3.max.z]) {
                  const v = new e.camera.position.constructor(px, py, pz).applyMatrix4(o.matrixWorld);
                  if (v.y > top) top = v.y;
                }
              }
            }
          });
          const gy = e.ctx.peek('physics').groundHeight(g.pos.x, g.pos.z, g.pos.y + 3);
          rec.armedY = +top.toFixed(3);
          rec.groundY = +gy.toFixed(3);
        }
      }
      if (w.mineStats.tripped > rec.tripped0) {
        // let the trig delay and the blast land
        for (let k = 0; k < 60; k++) await frame();
        break;
      }
      if (!tank.alive) break;
    }
    rec.secs = +(t0 - m.roundClock).toFixed(1);
    rec.h1 = Math.round(tank.health);
    rec.alive = tank.alive;
    rec.wound = Math.round(h0 - tank.health);
    rec.tripped = w.mineStats.tripped - rec.tripped0;
    rec.lastOrd = tank.lastOrd;
    return rec;
  };

  out.cases.push(await run('ENEMY mine on the lane', 'enemy'));
  out.cases.push(await run('FRIENDLY mine on the lane', 'same'));

  /**
   * CAN A MAN BE KILLED BY AN ANTI-TANK MINE? Two halves, and they are
   * different questions:
   *   - can he SET ONE OFF?  No, by construction: `beamRange` is 0 and the
   *     only sensor is a plate keyed to a hull footprint. Proved by standing
   *     him ON it for four seconds and reading `tripped`.
   *   - can he be killed BY one a TANK sets off?  Measured below: he stands
   *     `STAND` metres off a plate on a live hull's leg and the run reads his
   *     health across the blast.
   */
  const man = async (STAND) => {
    const player = e.ctx.peek('player');
    const tank = armour.tanks.find((t) => t.alive && t.state === 'advance');
    if (!tank || !player) return { STAND, error: 'no hull / no player' };
    const leg = tank.legs[tank.legIx];
    const s = Math.min(leg.length - 0.5, tank.s + 40 * tank.legDir);
    let i = 0;
    while (i < leg.n - 1 && leg.S[i + 1] < s) i++;
    const p = { x: leg.X[i], y: leg.Y[i] + 0.4, z: leg.Z[i] };
    const team = tank.team === 0 ? 1 : 0;
    const t0 = w.mineStats.tripped;
    if (!w.layMine(p, { team, owner: null })) return { STAND, error: 'field full' };
    // Put him beside the plate, square to the lane, and hold him there.
    const ph = e.ctx.peek('physics');
    const off = { x: p.x + Math.cos(leg.YAW[i]) * STAND, z: p.z - Math.sin(leg.YAW[i]) * STAND };
    const gy = ph.groundHeight(off.x, off.z, p.y + 6);
    const dst = armour.tanks[0].position.clone();
    dst.set(off.x, Number.isFinite(gy) ? gy : p.y, off.z);
    player.respawnAt(dst, leg.YAW[i]);
    const h0 = player.health;
    // 4 s of standing ON/BESIDE it before any hull arrives: nothing may happen.
    let standTrips = 0;
    const c0 = m.roundClock;
    while (c0 - m.roundClock < 4) {
      await frame();
      player.respawnAt(dst, leg.YAW[i]);
    }
    standTrips = w.mineStats.tripped - t0;
    const hStand = player.health;
    // …and now let the hull come.
    const c1 = m.roundClock;
    let fired = false;
    while (c1 - m.roundClock < 40) {
      await frame();
      player.respawnAt(dst, leg.YAW[i]);
      if (w.mineStats.tripped > t0) { fired = true; for (let k = 0; k < 50; k++) await frame(); break; }
    }
    return {
      STAND, h0: Math.round(h0), hStand: Math.round(hStand),
      h1: Math.round(player.health), dead: player.dead === true,
      standTrips, fired,
    };
  };
  out.man = [await man(1.0), await man(5.0)];

  /* ---- the per-frame cost, measured ------------------------------------- */
  // Fill the field with mines on the lanes so the count is the worst case the
  // ration can produce (5 men x 2 x 2 sides = 20), then count pairs per frame.
  for (let i = 0; i < 20; i++) {
    const t = armour.tanks[i % armour.tanks.length];
    const leg = t.legs[0];
    const j = Math.floor((i / 20) * (leg.n - 1));
    w.layMine({ x: leg.X[j] + 40, y: leg.Y[j] + 0.4, z: leg.Z[j] + 40 }, { team: 9, owner: null });
  }
  for (let i = 0; i < 90; i++) await frame(); // arm them (fuse 6 s at 4x)
  const p0 = w.mineStats.probes;
  const f0 = e.ctx.time.frame;
  for (let i = 0; i < 240; i++) await frame();
  const frames = e.ctx.time.frame - f0;
  out.probes = {
    armed: w.mineStats.armed,
    liveHulls: armour.tanks.filter((t) => t.alive).length,
    pairs: w.mineStats.probes - p0,
    frames,
    perFrame: +((w.mineStats.probes - p0) / Math.max(1, frames)).toFixed(1),
  };
  out.kills = { ...armour.kills };
  out.mineStats = { ...w.mineStats };
  return out;
});

console.log(`\n=== LANES ===  ${res.lanes} points published; nearest to (0,0): ${JSON.stringify(res.laneSample)}`);
console.log(`\n=== A TANK DRIVES ONTO A MINE ===`);
for (const c of res.cases) {
  if (c.error) { console.log(`  ${c.label}: ${c.error}`); continue; }
  console.log(
    `  ${c.label}\n` +
    `      hull ${c.tank} (team ${c.hullTeam}) vs mine of team ${c.mineTeam}, laid=${c.laid} at (${c.at})\n` +
    `      health ${c.h0} -> ${c.h1}   wound ${c.wound}   destroyed=${!c.alive}   ` +
    `trips=${c.tripped}   lastOrd=${c.lastOrd}   after ${c.secs}s\n` +
    `      armed mine sat at y=${c.armedY} on ground y=${c.groundY} ` +
    `(proud ${c.armedY !== null && c.groundY !== null ? (c.armedY - c.groundY).toFixed(3) : '?'} m)`
  );
}
console.log(`\n=== CAN A MAN BE KILLED BY ONE? ===`);
for (const c of res.man ?? []) {
  if (c.error) { console.log(`  ${c.STAND} m: ${c.error}`); continue; }
  console.log(
    `  standing ${c.STAND} m from the plate: 4 s ON it set off ${c.standTrips} mine(s) — ` +
    `health ${c.h0} -> ${c.hStand}; then a hull drove over it (fired=${c.fired}) — health ${c.h1}, dead=${c.dead}`
  );
}
console.log(`\n=== THE COST OF FINDING ONE ===`);
console.log(`  ${res.probes.armed} armed mines x ${res.probes.liveHulls} live hulls`);
console.log(`  ${res.probes.pairs} pairs tested over ${res.probes.frames} frames = ${res.probes.perFrame} per frame`);
console.log(`\n=== LEDGER === kills ${JSON.stringify(res.kills)}  mineStats ${JSON.stringify(res.mineStats)}`);
console.log(`\n=== CONSOLE ===`);
for (const l of logs.slice(0, 24)) console.log('  ' + l);
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
