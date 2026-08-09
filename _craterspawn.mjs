/**
 * WHAT IS `_puff` ACTUALLY WRITING?
 *
 *   node _craterspawn.mjs [--port=4637]
 *
 * Five craters twenty metres from a clear eye, 393 estimated sprites, and a
 * photograph with nothing in it at every value of `dark` from 0.58 to 3.4. The
 * estimate is arithmetic; this reads the spawns. `fx.emitLit` is wrapped for
 * two seconds and every field of every particle that goes through it is
 * summarised, so the answer is either "nothing is being written", "it is being
 * written somewhere else" or "it is being written correctly and the fault is
 * downstream".
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4637'}/?map=plains&capture=1`;

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 450 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await page.waitForFunction(() => (window.__ENGINE__.ctx.peek('match')?.phase ?? '') === 'live', null, { timeout: 300000 });
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics'), fx = e.ctx.peek('fx');
  const V3 = e.camera.position.constructor;
  e.input.frozen = true; e.input.enabled = false;
  const run = window.__BOMBER__.runs.find((r) => r.id === 'OPEN-7') ?? window.__BOMBER__.runs[0];
  const a = run.bombs[0].impact, z2 = run.bombs[run.bombs.length - 1].impact;
  const tx = (a.x + z2.x) / 2, tz = (a.z + z2.z) / 2;
  const g = ph.groundHeight(tx, tz, 400);
  const gy = Number.isFinite(g) ? g : 0;
  e.camera.position.set(tx + 26, gy + 1.62, tz + 15);
  e.camera.lookAt(new V3(tx, gy + 3, tz));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  fx.craters.clear();
  fx.craterSmoke(tx, gy, tz, 15);

  // wrap emitLit and record what craters push through it
  const st = { n: 0, minY: 1e9, maxY: -1e9, minS: 1e9, maxS: -1e9, first: null, alpha: 0, tile: {}, near: 0 };
  window.__ST__ = st;
  const orig = fx.emitLit;
  fx.emitLit = (s) => {
    const d = Math.hypot(s.x - tx, s.z - tz);
    if (d < 12) {
      st.n++;
      st.minY = Math.min(st.minY, s.y); st.maxY = Math.max(st.maxY, s.y);
      st.minS = Math.min(st.minS, s.size0); st.maxS = Math.max(st.maxS, s.size0);
      st.alpha += s.alpha;
      st.tile[s.tile] = (st.tile[s.tile] ?? 0) + 1;
      if (!st.first) st.first = { x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2),
        size0: +s.size0.toFixed(2), size1: +s.size1.toFixed(2), life: +s.life.toFixed(2), alpha: +s.alpha.toFixed(2),
        r0: +s.r0.toFixed(3), i0: s.i0, i1: s.i1, tile: s.tile, soft: s.soft, drag: s.drag, gravity: s.gravity,
        vy: +s.vy.toFixed(2), delay: s.delay, alphaCurve: s.alphaCurve, sizeCurve: s.sizeCurve, turb: +s.turb.toFixed(2) };
    }
    return orig(s);
  };
  window.__UNWRAP__ = () => { fx.emitLit = orig; };
  return { target: [+tx.toFixed(1), +tz.toFixed(1)], gy: +gy.toFixed(2),
    cam: [+(tx + 26).toFixed(1), +(gy + 1.62).toFixed(2), +(tz + 15).toFixed(1)] };
});
console.log(JSON.stringify(info));

await page.waitForTimeout(4000);
const st = await page.evaluate(() => { const s = window.__ST__; window.__UNWRAP__(); return s; });
console.log(`puffs near the crater: ${st.n}`);
console.log(`  y ${st.minY === 1e9 ? '-' : st.minY.toFixed(2)}..${st.maxY === -1e9 ? '-' : st.maxY.toFixed(2)}  size0 ${st.minS === 1e9 ? '-' : st.minS.toFixed(2)}..${st.maxS === -1e9 ? '-' : st.maxS.toFixed(2)}  tiles ${JSON.stringify(st.tile)}`);
console.log(`  first: ${JSON.stringify(st.first)}`);

const layer = await page.evaluate(() => {
  const fx = window.__ENGINE__.ctx.peek('fx');
  const l = fx.lit;
  // walk the ring and count instances whose birth is in the last 3 s and whose
  // position is within 12 m of the crater
  const A = l.array, S = 32, now = fx.now;
  const t = window.__T__ ?? null; void t;
  let live = 0, nearLive = 0;
  const [tx, tz] = window.__TARGET__ ?? [0, 0];
  for (let i = 0; i < l.capacity; i++) {
    const b = i * S;
    const birth = A[b + 8], inv = A[b + 9];
    if (!inv) continue;
    const n = (now - birth) * inv;
    if (n < 0 || n >= 1) continue;
    live++;
    if (Math.hypot(A[b] - tx, A[b + 2] - tz) < 14) nearLive++;
  }
  return { live, nearLive, now: +now.toFixed(1), cap: l.capacity };
});
console.log(`ring: ${layer.live} live of ${layer.cap}, ${layer.nearLive} within 14 m of origin-target`);
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs[0]}` : '0 pageerrors');
await b.close();
