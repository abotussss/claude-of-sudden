/**
 * FIRE THE MOUNTAIN BATTERY FOR REAL AND MEASURE IT.
 *
 *   node _battfire.mjs --url='http://127.0.0.1:4634/?map=plains' [--seed=7]
 *                      [--scale=6] [--wall=200] [--shots=shots/batt]
 *
 * The trigger is the hidden squad's own crossing (@see `_battclock.mjs`, which
 * measures WHEN that happens on the 1000-point clock). This probe does not wait
 * for it: it arms the battery through the same public call `MatchSystem` makes
 * — `battery.arm(match.playerTeam, match._batteryPads())` — so the whole
 * engagement can be watched inside one page.
 *
 * WHAT IT REPORTS, and each line is a claim the feature makes:
 *   · three vehicles on the mountain, their world positions and their radius
 *     from the middle of the map (must be well past the rim clip face at 178)
 *   · the cadence, per gun and for the battery
 *   · every round's target class and, for a round on a capture site, HOW FAR
 *     OUT OF THAT CIRCLE IT LANDED as a fraction of the circle's own radius.
 *     This is `batteryProve` re-asked of the rounds that were really fired.
 *   · the engagement's length, and the frame cost with and without it.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const arg = (k, d) => {
  const a = process.argv.find((s) => s.startsWith(`--${k}=`));
  return a ? a.slice(a.indexOf('=') + 1) : d;
};
const URL = arg('url', 'http://127.0.0.1:4634/?map=plains');
const SEED = arg('seed', '7');
const SCALE = +arg('scale', 6);
const WALL = +arg('wall', 200);
const SHOTS = arg('shots', '');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.stack || e.message)));
p.on('console', (m) => {
  const t = m.text();
  if (/\[batt/.test(t)) console.log('  ' + t);
});
const url = `${URL}${URL.includes('?') ? '&' : '?'}seed=${SEED}`;
await p.goto(url, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

/** Frame cost with the battery idle, so the engagement has something to beat. */
const frameCost = async (n) =>
  p.evaluate(async (samples) => {
    const t = window.__ENGINE__.ctx.time;
    const out = [];
    let last = performance.now();
    for (let i = 0; i < samples; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      out.push(now - last);
      last = now;
      void t;
    }
    out.sort((a, c) => a - c);
    return { mean: +(out.reduce((a, c) => a + c, 0) / out.length).toFixed(2), p95: +out[Math.floor(out.length * 0.95)].toFixed(2) };
  }, n);

await p.evaluate((s) => { window.__ENGINE__.ctx.time.scale = s; }, 1);
await p.waitForTimeout(4000);
const before = await frameCost(180);

const boot = await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const bt = m.battery;
  return {
    map: window.__ENGINE__.ctx.peek('world').level.id,
    ready: bt?.ready ?? false,
    proof: bt?.proof ?? null,
    vehicles: (bt?.vehicles ?? []).map((v) => ({
      i: v.i,
      x: +v.x.toFixed(1), y: +v.y.toFixed(1), z: +v.z.toFixed(1),
      r: +Math.hypot(v.x, v.z).toFixed(1),
      trackLen: +v.track.length.toFixed(1),
      gradeDeg: +(v.track.grade * 180 / Math.PI).toFixed(1),
    })),
    zones: m.allZones.map((z) => ({ id: z.id, x: +z.position.x.toFixed(1), z: +z.position.z.toFixed(1), r: z.radius })),
    pads: m._batteryPads(),
  };
});
console.log('=== BOOT ===');
console.log(JSON.stringify(boot, null, 1));

/* wait for the round to be live, then arm through the same call `match` uses */
await p.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 120000 });
const armed = await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  return m.battery.arm(m.playerTeam, m._batteryPads());
});
console.log('=== ARMED ===', armed);

if (SHOTS) {
  /* stand on the plain looking at the northern rim: the arrival. */
  await p.evaluate(() => {
    const e = window.__ENGINE__;
    const pl = e.ctx.peek('player');
    const ph = e.ctx.peek('physics');
    const x = -40, z = -70;
    const y = ph.groundHeight(x, z, 60);
    pl.teleport({ x, y: (Number.isFinite(y) ? y : 0) + 1.66, z }, { x: -0.13, y: Math.atan2(40 - 0, -190 + 70) });
    e.input.frozen = true; e.input.enabled = false; pl.setControlEnabled?.(false);
  });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${SHOTS}/01-arrival.png` });
}

await p.evaluate((s) => { window.__ENGINE__.ctx.time.scale = s; }, SCALE);

const t0 = Date.now();
let shotFlight = false;
let shotHome = false;
let during = null;
let last = null;
while (Date.now() - t0 < WALL * 1000) {
  await p.waitForTimeout(700);
  last = await p.evaluate(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    const bt = m.battery;
    return {
      armed: bt.armed, mag: bt.magazine,
      rounds: bt.stats.rounds, atSite: bt.stats.atSite, atBodies: bt.stats.atBodies,
      liveWorst: +bt.stats.liveWorst.toFixed(3), liveOut: bt.stats.liveOut,
      inFlight: bt._shots.filter((s) => s.live).length,
      states: bt.vehicles.map((v) => v.state),
      phase: m.phase, score: [m.score[0], m.score[1]],
    };
  });
  if (!during && last.rounds >= 4) {
    during = await frameCost(150);
  }
  if (SHOTS && !shotFlight && last.inFlight > 0 && last.rounds >= 2) {
    shotFlight = true;
    await p.evaluate((s) => { window.__ENGINE__.ctx.time.scale = s; }, 0.25);
    /* put the camera at the impact point of the round in the air */
    await p.evaluate(() => {
      const e = window.__ENGINE__;
      const bt = e.ctx.peek('match').battery;
      const s = bt._shots.find((q) => q.live);
      if (!s) return;
      const pl = e.ctx.peek('player');
      const ph = e.ctx.peek('physics');
      const dx = s.ax - s.bx, dz = s.az - s.bz;
      const d = Math.hypot(dx, dz) || 1;
      const x = s.bx + (dx / d) * 22, z = s.bz + (dz / d) * 22;
      const y = ph.groundHeight(x, z, 60);
      pl.teleport({ x, y: (Number.isFinite(y) ? y : 0) + 1.66, z },
        { x: -0.38, y: Math.atan2(-(s.bx - x), -(s.bz - z)) });
    });
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${SHOTS}/02-missile-in-flight.png` });
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${SHOTS}/03-what-the-target-sees.png` });
    await p.evaluate((s) => { window.__ENGINE__.ctx.time.scale = s; }, SCALE);
  }
  if (SHOTS && !shotHome && !last.armed && last.rounds > 0) {
    shotHome = true;
  }
  if (!last.armed && last.rounds > 0) break;
  if (last.phase !== 'live') break;
}

if (SHOTS) {
  await p.evaluate((s) => { window.__ENGINE__.ctx.time.scale = s; }, 1);
  await p.evaluate(() => {
    const e = window.__ENGINE__;
    const pl = e.ctx.peek('player');
    const ph = e.ctx.peek('physics');
    const x = -40, z = -70;
    const y = ph.groundHeight(x, z, 60);
    pl.teleport({ x, y: (Number.isFinite(y) ? y : 0) + 1.66, z }, { x: -0.13, y: Math.atan2(40 - 0, -190 + 70) });
  });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${SHOTS}/04-withdrawal.png` });
}

const out = await p.evaluate(() => {
  const bt = window.__ENGINE__.ctx.peek('match').battery;
  return { stats: bt.stats, report: bt.report() };
});
console.log('=== MATCH ===');
console.log(JSON.stringify(last));
console.log('=== ROUNDS ===');
const log = out.stats.log;
let prev = null;
for (const e of log) {
  console.log(
    `  r${String(e.round).padStart(2)} t+${e.t}s gun${e.gun} ` +
      `${e.zone ? `SITE ${e.zone} frac ${e.frac}` : 'BODIES'} at (${e.x},${e.z})` +
      (prev === null ? '' : `   +${(e.t - prev).toFixed(1)}s`)
  );
  prev = e.t;
}
const gaps = [];
for (let i = 1; i < log.length; i++) gaps.push(log[i].t - log[i - 1].t);
const perGun = {};
for (const e of log) (perGun[e.gun] ??= []).push(e.t);
console.log('=== CADENCE ===');
console.log(`  battery: ${gaps.length} gaps, mean ${(gaps.reduce((a, c) => a + c, 0) / (gaps.length || 1)).toFixed(2)}s`);
for (const g of Object.keys(perGun)) {
  const t = perGun[g];
  const d = [];
  for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
  console.log(`  gun ${g}: ${t.length} rounds, mean gap ${(d.reduce((a, c) => a + c, 0) / (d.length || 1)).toFixed(2)}s ` +
    `[${d.map((v) => v.toFixed(1)).join(', ')}]`);
}
console.log('=== FRAME ===');
console.log(`  idle   mean ${before.mean} ms  p95 ${before.p95} ms`);
console.log(`  firing mean ${during?.mean ?? '-'} ms  p95 ${during?.p95 ?? '-'} ms`);
console.log('=== REPORT ===');
console.log('  ' + out.report);
console.log(`[pageerror] ${errs.length ? errs[0].slice(0, 500) : 'none'}`);
await b.close();
