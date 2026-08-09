/**
 * PHOTOGRAPH THE MOUNTAIN BATTERY.
 *
 *   node _battshots.mjs --url='http://127.0.0.1:4634/?map=plains' [--seed=11]
 *                       [--out=shots/batt]
 *
 * Four frames, and each is a claim the feature makes that a number cannot:
 *   01 the vehicles arriving on the mountain
 *   02 a missile in flight
 *   03 what the target sees before it lands — the reticle, the strip, the ring
 *   04 the withdrawal, going back over the crest
 *
 * THE CAMERA CONVENTION IS THE ONE `_nfsat.mjs` MEASURED IN THE LIVE PAGE and
 * `MatchSystem._satTarget` writes down: the camera looks along
 * `(-sin yaw, -cos yaw)`, so aiming it at a point is
 * `yaw = atan2(-(t.x - p.x), -(t.z - p.z))`, and `rot.x` is pitch UP-positive.
 * `player.teleport(eye, rot)` reads a pitch ONLY when `rot` is an object, and
 * the first argument is the EYE and not the feet — @see `src/dev/shots.js`.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const arg = (k, d) => {
  const a = process.argv.find((s) => s.startsWith(`--${k}=`));
  return a ? a.slice(a.indexOf('=') + 1) : d;
};
const URL = arg('url', 'http://127.0.0.1:4634/?map=plains');
const SEED = arg('seed', '11');
const OUT = arg('out', 'shots/batt');
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.stack || e.message)));
await p.goto(`${URL}${URL.includes('?') ? '&' : '?'}seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

/**
 * FREE CAMERA, `_nffreecam.mjs`'S RECIPE. `Player.update` writes the camera only
 * under `if (this.controlEnabled)`, so with control OFF nothing in the engine
 * touches `ctx.camera` and a transform set from the driver simply stays. The
 * standing-eye probes need control ON for the rig to place the eye; this needs
 * it OFF, and getting that backwards is what put the first pass of these four
 * frames on the ground looking at grass while the vehicle stood 8 m up behind
 * the camera. The MATCH is deliberately left running — the subject is a moving
 * vehicle and a frozen `match.update` would have nothing to photograph.
 */
await p.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  /* the viewmodel is a SECOND scene composited over the world and it covers the
     centre-bottom of the frame, which is exactly where the subject is. */
  e.ctx.viewScene?.traverse?.((o) => {
    if (o.isMesh || o.isInstancedMesh || o.isSprite) o.visible = false;
  });
});
const look = (from, at) =>
  p.evaluate(([f, t]) => {
    const c = window.__ENGINE__.camera;
    c.position.set(f.x, f.y, f.z);
    c.lookAt(t.x, t.y, t.z);
    c.updateMatrixWorld(true);
  }, [from, at]);
/** Hold the camera for `n` frames — nothing else writes it, but the FX and the
 *  vehicles keep moving, so the frames have to be spent to see them. */
const hold = (from, at, n) => p.evaluate(async ([f, t, k]) => {
  const e = window.__ENGINE__;
  const c = e.camera;
  const pl = e.ctx.peek('player');
  for (let i = 0; i < k; i++) {
    /**
     * RE-DISABLED EVERY FRAME. `MatchSystem` turns control back ON at a
     * respawn and at a phase change, and forty frames at `time.scale` 3 is
     * long enough for the human to be killed and put back on his feet — which
     * is what put the first pass of these frames at ground level among the
     * bots while the camera had been asked for 40 m up a mountain.
     */
    e.input.frozen = true;
    e.input.enabled = false;
    pl?.setControlEnabled?.(false);
    c.position.set(f.x, f.y, f.z);
    c.lookAt(t.x, t.y, t.z);
    c.updateMatrixWorld(true);
    await new Promise((r) => requestAnimationFrame(r));
  }
}, [from, at, n]);

await p.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 180000 });
await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m.battery.arm(m.playerTeam, m._batteryPads());
});

/* ── 01 the arrival ─────────────────────────────────────────────────────── */
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 3; });
await p.waitForFunction(() => {
  const bt = window.__ENGINE__.ctx.peek('match').battery;
  return bt.vehicles[1].s > 0.42;
}, null, { timeout: 120000 });
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 0.4; });
let v = await p.evaluate(() => {
  const bt = window.__ENGINE__.ctx.peek('match').battery;
  const m = bt.vehicles[1];
  return { x: m.x, y: m.y + 2.2, z: m.z, state: m.state, s: +m.s.toFixed(2) };
});
console.log('vehicle 1', JSON.stringify(v));
/* 58 m out along the bearing towards the middle of the map, and 9 m below the
   hull, so the three of them are on the skyline rather than against rock. */
let f = 1 - 58 / Math.hypot(v.x, v.z);
await hold({ x: v.x * f, y: v.y - 9, z: v.z * f }, v, 45);
await p.screenshot({ path: `${OUT}/01-arrival.png` });

/* ── 02 a missile in flight, seen from the plain ────────────────────────── */
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 4; });
await p.waitForFunction(() => {
  const bt = window.__ENGINE__.ctx.peek('match').battery;
  return bt._shots.some((s) => s.live && s.t > s.flight * 0.3);
}, null, { timeout: 180000 });
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 0.12; });
let shot = await p.evaluate(() => {
  const bt = window.__ENGINE__.ctx.peek('match').battery;
  const s = bt._shots.find((q) => q.live);
  const k = Math.min(1, s.t / s.flight);
  return {
    x: s.ax + (s.bx - s.ax) * k,
    y: s.ay + (s.by - s.ay) * k + s.apex * 4 * k * (1 - k),
    z: s.az + (s.bz - s.az) * k,
    bx: s.bx, by: s.by, bz: s.bz, k: +k.toFixed(2), zone: s.zoneId,
  };
});
console.log('missile', JSON.stringify(shot));
await hold(
  { x: shot.x + 46, y: shot.y - 8, z: shot.z - 30 }, shot, 30
);
await p.screenshot({ path: `${OUT}/02-missile-in-flight.png` });

/* ── 03 what the target sees ────────────────────────────────────────────── */
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 4; });
await p.waitForFunction(() => {
  const bt = window.__ENGINE__.ctx.peek('match').battery;
  return bt.vehicles.some((q) => q.lay > 0.6);
}, null, { timeout: 180000 });
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 0.18; });
const lay = await p.evaluate(() => {
  const bt = window.__ENGINE__.ctx.peek('match').battery;
  const q = bt.vehicles.find((z) => z.lay > 0);
  return { x: q.aimX, y: q.aimY, z: q.aimZ, gun: q.i, site: q.targetIsSite };
});
console.log('lay', JSON.stringify(lay));
/**
 * STAND ON THE AIM POINT AT EYE HEIGHT, looking back up the bearing the round
 * is coming from — which is the mountain, i.e. towards the middle of the north
 * rim. This is the frame that has to answer "nothing may kill from nowhere".
 */
const eye = await p.evaluate(([x, z]) => {
  const g = window.__ENGINE__.ctx.peek('physics').groundHeight(x, z, 90);
  return (Number.isFinite(g) ? g : 0) + 1.66;
}, [lay.x + 3, lay.z + 3]);
await hold(
  { x: lay.x + 3, y: eye, z: lay.z + 3 },
  { x: lay.x * 0.1 - 30, y: eye + 26, z: -190 },
  36
);
await p.screenshot({ path: `${OUT}/03-what-the-target-sees.png` });

/* ── 04 the withdrawal ──────────────────────────────────────────────────── */
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 12; });
await p.waitForFunction(() => {
  const bt = window.__ENGINE__.ctx.peek('match').battery;
  return bt.vehicles.some((q) => q.state === 'withdraw' && q.s < 0.75) || !bt.armed;
}, null, { timeout: 400000 });
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 0.5; });
v = await p.evaluate(() => {
  const bt = window.__ENGINE__.ctx.peek('match').battery;
  const q = bt.vehicles.find((z) => z.state === 'withdraw') ?? bt.vehicles[1];
  return { x: q.x, y: q.y + 2.2, z: q.z, state: q.state, s: +q.s.toFixed(2) };
});
console.log('withdrawing', JSON.stringify(v));
f = 1 - 62 / Math.hypot(v.x, v.z);
await hold({ x: v.x * f, y: v.y - 8, z: v.z * f }, v, 45);
await p.screenshot({ path: `${OUT}/04-withdrawal.png` });

console.log(`[pageerror] ${errs.length ? errs[0].slice(0, 400) : 'none'}`);
await b.close();
