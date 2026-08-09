/**
 * WHAT ACTUALLY HAPPENS ON THE FRAME THE CARRIER LANDS?
 *
 *   node _sfbang.mjs [--url=…] [--seed=N]
 *
 * `_sfcost.mjs` measured the frame and found NO SPIKE AT t=18.4 — the two extra
 * waves cost 0.2 ms against the satellite alone, and the worst frames sit at
 * ~3 s intervals in both runs. A frame trace that cannot tell the largest
 * explosion in the game from a satellite landing alone is a frame trace that
 * says almost nothing is being drawn, so this counts the things that ARE drawn
 * rather than timing them: particles emitted per frame into each ring, the
 * ring's live instance count, the light pool's occupancy and peak, the draw
 * calls and the triangles.
 *
 * It reports the whole event second by second and then the six frames around
 * first contact one at a time, because "the biggest explosion in the game"
 * is a claim about ONE frame.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4639/?map=plains&capture=1';

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log('level.id =', level);
if (level !== 'plains') { console.error('NOT THE PLAIN'); await b.close(); process.exit(2); }

await p.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.time.scale = 8;
});
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });

const pose = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  m._checkWinConditions = () => {};
  e.time.scale = 1;
  const ph = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const h = ph.raycast(-40, 300, -40, 0, -1, 0, 400, ph.MASK.WORLD);
  e.camera.position.set(-40, (h.hit ? h.point.y : 0) + 1.7, -40);
  e.camera.lookAt(new V3(-70, 6, -46));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  const pl = e.ctx.peek('player');
  if (pl) pl.applyDamage = () => {};

  const fx = e.ctx.peek('fx');
  const r = e.ctx.peek('render');
  const c = m.crash;
  window.__ROWS__ = [];
  let last = performance.now();
  let pLit = fx.lit.spawned, pAdd = fx.add.spawned, pMote = fx.motes.spawned;
  let pHaze = fx.hazeSys?.spawned ?? 0, pDec = fx.stats.decals;
  const tick = () => {
    const now = performance.now();
    const t = c?._sky?._t ?? -1;
    const lights = fx.lights.lights;
    window.__ROWS__.push({
      t: +t.toFixed(3),
      ms: +(now - last).toFixed(1),
      lit: fx.lit.spawned - pLit,
      add: fx.add.spawned - pAdd,
      mote: fx.motes.spawned - pMote,
      haze: (fx.hazeSys?.spawned ?? 0) - pHaze,
      dec: fx.stats.decals - pDec,
      liveLit: fx.lit.geometry.instanceCount,
      liveAdd: fx.add.geometry.instanceCount,
      lampN: lights.filter((l) => l.light.intensity > 0).length,
      lampMax: +Math.max(0, ...lights.map((l) => l.light.intensity)).toFixed(0),
      calls: r?.renderer?.info.render.calls ?? 0,
      tris: r?.renderer?.info.render.triangles ?? 0,
    });
    pLit = fx.lit.spawned; pAdd = fx.add.spawned; pMote = fx.motes.spawned;
    pHaze = fx.hazeSys?.spawned ?? 0; pDec = fx.stats.decals;
    if (window.__ROWS__.length > 6000) window.__ROWS__.shift();
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    litCap: fx.lit.capacity, addCap: fx.add.capacity, pScale: +fx.pScale.toFixed(2),
    lamps: fx.lights.lights.length,
    eye: e.camera.position.toArray().map((v) => +v.toFixed(1)),
  };
});
console.log('rings: lit cap', pose.litCap, '· add cap', pose.addCap, '· pScale', pose.pScale, '· lights', pose.lamps);
console.log('eye', pose.eye.join(', '));

await p.evaluate(() => window.__ENGINE__.ctx.peek('match').crash.fire());
await p.evaluate(() => new Promise((r) => { let i = 0; const t = () => (++i >= 1800 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }));

const out = await p.evaluate(() => {
  const R = window.__ROWS__.filter((r) => r.t >= 0);
  const bucket = new Map();
  for (const r of R) {
    const k = Math.floor(r.t);
    const e = bucket.get(k) ?? { n: 0, lit: 0, add: 0, mote: 0, haze: 0, dec: 0, ms: 0, worst: 0, calls: 0, tris: 0, lamp: 0 };
    e.n++; e.lit += r.lit; e.add += r.add; e.mote += r.mote; e.haze += r.haze; e.dec += r.dec;
    e.ms += r.ms; e.worst = Math.max(e.worst, r.ms);
    e.calls = Math.max(e.calls, r.calls); e.tris = Math.max(e.tris, r.tris);
    e.lamp = Math.max(e.lamp, r.lampMax);
    bucket.set(k, e);
  }
  const secs = [...bucket.entries()].sort((a, c) => a[0] - c[0]).map(([k, e]) => ({
    s: k, n: e.n, lit: e.lit, add: e.add, mote: e.mote, haze: e.haze, dec: e.dec,
    avg: +(e.ms / e.n).toFixed(1), worst: +e.worst.toFixed(1), calls: e.calls, tris: e.tris, lamp: e.lamp,
  }));
  const near = R.filter((r) => r.t >= 18.0 && r.t <= 19.2);
  return { secs, near, total: R.length };
});

console.log('\n── the whole event, one row a second (particles EMITTED in that second) ──');
console.log('  t   frames   lit    add   mote  haze  dec |  avg ms  worst |  calls    tris  peak cd');
for (const s of out.secs) {
  if (s.s > 40) break;
  console.log(
    `  ${String(s.s).padStart(2)}   ${String(s.n).padStart(5)}  ${String(s.lit).padStart(5)}  ${String(s.add).padStart(5)}  ` +
    `${String(s.mote).padStart(5)} ${String(s.haze).padStart(5)} ${String(s.dec).padStart(4)} | ` +
    `${String(s.avg).padStart(7)} ${String(s.worst).padStart(6)} | ${String(s.calls).padStart(6)} ${String(s.tris).padStart(8)} ${String(s.lamp).padStart(7)}`
  );
}
console.log('\n── frame by frame across first contact (t = 18.4) ──');
console.log('   t      ms    lit   add  mote haze dec | liveLit liveAdd | lamps peak |  calls');
for (const r of out.near) {
  console.log(
    `  ${r.t.toFixed(3).padStart(6)} ${String(r.ms).padStart(6)} ${String(r.lit).padStart(5)} ${String(r.add).padStart(5)} ` +
    `${String(r.mote).padStart(5)} ${String(r.haze).padStart(4)} ${String(r.dec).padStart(3)} | ` +
    `${String(r.liveLit).padStart(7)} ${String(r.liveAdd).padStart(7)} | ${String(r.lampN).padStart(5)} ${String(r.lampMax).padStart(5)} | ${String(r.calls).padStart(6)}`
  );
}
console.log(errs.length ? `\nPAGEERRORS(${errs.length}) ${errs[0]}` : '\n0 pageerrors');
await b.close();
