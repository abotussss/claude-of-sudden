/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THE AMBIENT WAR COSTS A FRAME
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _warperf.mjs [--url=…] [--map=plains] [--frames=200] [--blocks=6]
 *
 * `tools/perf.mjs` measures ABSOLUTES on the town at a hardcoded port. This
 * measures the DIFFERENCE on the map the work is on, which is the only number
 * that says whether it is affordable.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TWO MEASUREMENTS, BECAUSE ONE OF THEM CANNOT BE TRUSTED ON ITS OWN
 * ────────────────────────────────────────────────────────────────────────────
 * The first attempt at this was a straight A/B of frame time in a live match
 * and it produced nonsense — one ON block at 162 ms against an OFF block at 85,
 * and a STORM block CHEAPER than OFF. A 20v20 match with tanks, drones, three
 * air schedulers and three scored acts in it moves the frame time by more in
 * one sortie than this whole subsystem could in a thousand, so the delta was
 * measuring whatever the match happened to be doing.
 *
 *   1. SELF TIME, in a fully live match. `warfield.update` wrapped and timed,
 *      so the CPU cost is attributed rather than inferred. This is the number
 *      that cannot be confounded.
 *
 *   2. FRAME TIME A/B, in a QUIETED scene — the other air schedulers off, the
 *      win check stubbed, the camera nailed down — alternating blocks so drift
 *      cancels, reported as the median of the per-block medians. Quieting
 *      changes the absolute, and it is applied identically to both conditions,
 *      which is the whole point.
 *
 * The STORM block forces every engagement on every frame, bypassing the two-
 * and-two active cap: about four times what the scheduler will ever produce.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const MAP = args.map ?? 'plains';
const BASE = args.url ?? `http://127.0.0.1:4609/?capture=1${MAP === 'plains' ? '&map=plains' : ''}`;
const N = Number(args.frames ?? 200);
const BLOCKS = Number(args.blocks ?? 6);
const W = Number(args.w ?? 1920);
const H = Number(args.h ?? 1080);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const p = await b.newPage({ viewport: { width: W, height: H } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const level = await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id);
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
console.log(`level=${level}  ${W}x${H}  ${N} frames x ${BLOCKS} blocks`);

/**
 * ON THE CENTRE CAPTURE POINT, LOOKING WEST — where the most ambient fire is in
 * frame at once (WESTCENTRE at 110 m, the WESTGAP pair behind it at 160, and
 * two rim pairs on the skyline past both). A camera pointed at empty sky would
 * measure nothing and report it as free.
 */
const place = () => p.evaluate(() => {
  const e = window.__ENGINE__;
  const phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const h = phys.raycast(0, 300, 0, 0, -1, 0, 400, phys.MASK.WORLD);
  e.camera.position.set(0, (h.hit ? h.point.y : 0) + 1.62, 0);
  e.camera.lookAt(new V3(-140, 8, 30));
  const pl = e.ctx.peek('player');
  pl?.teleport?.(e.camera.position, e.camera.rotation);
  if (pl) pl.applyDamage = () => {};
  e.input.frozen = true; e.input.enabled = false;
});

const warm = (n) => p.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

/* ══════════════════════════════ 1. SELF TIME, live ═══════════════════════ */
await place();
await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const w = m.warfield;
  w.__u = w.update.bind(w);
  const S = (window.__S__ = { ms: [], spawnedAdd: 0, spawnedLit: 0 });
  const fx = window.__ENGINE__.ctx.peek('fx');
  w.update = (dt, live) => {
    const a0 = fx.add.spawned, l0 = fx.lit.spawned;
    const t0 = performance.now();
    const r = w.__u(dt, live);
    S.ms.push(performance.now() - t0);
    S.spawnedAdd += fx.add.spawned - a0;
    S.spawnedLit += fx.lit.spawned - l0;
    return r;
  };
  m._checkWinConditions = () => {};
});
await warm(30);
await p.evaluate(() => { window.__S__.ms.length = 0; window.__S__.spawnedAdd = 0; window.__S__.spawnedLit = 0; });
await warm(900);
const self = await p.evaluate(() => {
  const S = window.__S__;
  const v = S.ms.slice().sort((a, b) => a - b);
  return {
    n: v.length,
    mean: +(v.reduce((a, x) => a + x, 0) / v.length).toFixed(4),
    p95: +v[(v.length * 0.95) | 0].toFixed(4),
    max: +v[v.length - 1].toFixed(4),
    perFrameParticles: +((S.spawnedAdd + S.spawnedLit) / v.length).toFixed(2),
  };
});
console.log(`\n  1. warfield.update self time, LIVE match, ${self.n} frames`);
console.log(`     mean ${self.mean} ms   p95 ${self.p95} ms   max ${self.max} ms`);
console.log(`     particles spawned per frame: ${self.perFrameParticles}`);

/* ══════════════════════════ 2. FRAME TIME A/B, quiet ═════════════════════ */
await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  // Quiet everything that can move a frame by more than this subsystem can.
  for (const k of ['airstrike', 'bomber', 'strafe', 'tank', 'drones', 'reinforce', 'crash']) {
    if (m[k] && 'enabled' in m[k]) m[k].enabled = false;
  }
  m._callZoneBombard = () => {};
  m._updateMapEvents = () => {};
});
const block = (n) => p.evaluate((N) => new Promise((d) => {
  const ts = []; let last = performance.now(), i = 0;
  const t = () => {
    const now = performance.now(); ts.push(now - last); last = now;
    if (++i >= N) { ts.sort((a, b) => a - b); d(ts[(N * 0.5) | 0]); }
    else requestAnimationFrame(t);
  };
  requestAnimationFrame(t);
}), n);
const set = (on, storm) => p.evaluate(([on, storm]) => {
  const w = window.__ENGINE__.ctx.peek('match').warfield;
  w.enabled = on;
  w.update = storm
    ? (dt, live) => { for (const f of w.fights) if (!f.on) { f.on = true; f.t = 9e9; f.acc = 0; f.swap = 0.6; } return w.__u(dt, live); }
    : w.__u;
}, [on, storm]);

const got = { ON: [], OFF: [], STORM: [] };
for (let i = 0; i < BLOCKS; i++) {
  for (const tag of ['ON', 'OFF', 'STORM']) {
    await set(tag !== 'OFF', tag === 'STORM');
    await place();
    await warm(45);
    got[tag].push(await block(N));
  }
}
const med = (a) => { const v = a.slice().sort((x, y) => x - y); return v[(v.length / 2) | 0]; };
const lo = (a) => Math.min(...a);
for (const tag of ['OFF', 'ON', 'STORM']) {
  console.log(`\n  2. ${tag.padEnd(5)} block medians: ${got[tag].map((x) => x.toFixed(1)).join(' ')}`);
  console.log(`     median ${med(got[tag]).toFixed(2)} ms   best block ${lo(got[tag]).toFixed(2)} ms   (${(1000 / med(got[tag])).toFixed(0)} fps)`);
}
console.log(`\n  warfield costs ${(med(got.ON) - med(got.OFF)).toFixed(2)} ms/frame at the scheduler's own rate`);
console.log(`  and ${(med(got.STORM) - med(got.OFF)).toFixed(2)} ms/frame with every engagement forced on (~4x the real rate)`);
console.log(`  on best-block figures: ${(lo(got.ON) - lo(got.OFF)).toFixed(2)} ms and ${(lo(got.STORM) - lo(got.OFF)).toFixed(2)} ms`);
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs[0]}` : '0 pageerrors');
await b.close();
