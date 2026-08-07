/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE AMBIENT WAR, MEASURED — is it there, and can it touch anybody?
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _warfield.mjs [--url=…] [--scale=6] [--secs=240]
 *
 * Three questions no screenshot answers:
 *
 *   1. IS IT FIRING? Rounds, bursts and shells over a stretch of live match,
 *      and how many engagements were ever audible at once.
 *   2. CAN IT HURT ANYBODY? Every `explosion` event on the bus is counted and
 *      its position printed. `src/match/warfield.js` emits none, so any
 *      explosion that lands past the ridge foot is this file's bug.
 *   3. IS IT DISTINGUISHABLE FROM BEING SHOT AT? The closest an ambient muzzle
 *      or impact ever gets to the camera, sampled by instrumenting `fx.far*`.
 *      The honesty ramp is supposed to make that floor ~28 m, never zero.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4609/?map=plains';
const SCALE = Number(args.scale ?? 6);
const SECS = Number(args.secs ?? 240);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 560 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.stack ?? e.message)));
const boot = [];
p.on('console', (m) => { const t = m.text(); if (/warfield|bomber\]|strafe\]/.test(t)) boot.push(t.slice(0, 300)); });

await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const level = await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level=${level}`);
console.log(boot.map((l) => '  ' + l).join('\n'));

await p.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const fx = e.ctx.peek('fx');
  const cam = e.camera;
  const W = (window.__W__ = {
    minMuzzle: 1e9, minImpact: 1e9, minShell: 1e9,
    tracerNear: 1e9, blasts: [], maxActive: 0, ridgeMin: 1e9,
  });
  const V = new (cam.position.constructor)();
  const d = (x, y, z) => { V.setFromMatrixPosition(cam.matrixWorld); return Math.hypot(V.x - x, V.y - y, V.z - z); };

  const f0 = fx.farFlash.bind(fx);
  fx.farFlash = (x, y, z, s) => { W.minMuzzle = Math.min(W.minMuzzle, d(x, y, z)); return f0(x, y, z, s); };
  const i0 = fx.farImpact.bind(fx);
  fx.farImpact = (x, y, z, s) => { W.minImpact = Math.min(W.minImpact, d(x, y, z)); return i0(x, y, z, s); };
  const s0 = fx.farShell.bind(fx);
  fx.farShell = (x, y, z, s) => {
    W.minShell = Math.min(W.minShell, d(x, y, z));
    W.ridgeMin = Math.min(W.ridgeMin, Math.hypot(x, z));
    return s0(x, y, z, s);
  };
  /**
   * THE TRACER'S CLOSEST APPROACH TO THE EYE — the number rule 2 in
   * `warfield.js` is actually about. A round that never comes within tens of
   * metres of the camera cannot be read as a round at the camera.
   */
  const t0 = fx.farTracer.bind(fx);
  fx.farTracer = (ax, ay, az, bx, by, bz, w) => {
    V.setFromMatrixPosition(cam.matrixWorld);
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L2 = dx * dx + dy * dy + dz * dz;
    let t = L2 > 0 ? ((V.x - ax) * dx + (V.y - ay) * dy + (V.z - az) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    W.tracerNear = Math.min(W.tracerNear, Math.hypot(V.x - (ax + dx * t), V.y - (ay + dy * t), V.z - (az + dz * t)));
    return t0(ax, ay, az, bx, by, bz, w);
  };
  e.ctx.events.on('explosion', (ev) => {
    const q = ev.position;
    W.blasts.push({ r: +Math.hypot(q.x, q.z).toFixed(1), dmg: ev.damage, rad: ev.radius });
    if (W.blasts.length > 400) W.blasts.shift();
  });
  const u = m.warfield.update.bind(m.warfield);
  m.warfield.update = (dt, live) => { const r = u(dt, live); W.maxActive = Math.max(W.maxActive, m.warfield._onField + m.warfield._onRim); W.maxField = Math.max(W.maxField||0, m.warfield._onField); W.maxRim = Math.max(W.maxRim||0, m.warfield._onRim); return r; };
});

await p.evaluate((s) => (window.__ENGINE__.time.scale = s), SCALE);
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });

const t0 = await p.evaluate(() => 1200 - window.__ENGINE__.ctx.peek('match').roundClock);
for (;;) {
  await new Promise((r) => setTimeout(r, 1500));
  const t = await p.evaluate(() => 1200 - window.__ENGINE__.ctx.peek('match').roundClock);
  if (t - t0 >= SECS) break;
  if (await p.evaluate(() => window.__ENGINE__.ctx.peek('match').phase !== 'live')) break;
}

const out = await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const W = window.__W__;
  return {
    elapsed: +(1200 - m.roundClock).toFixed(0),
    stats: m.warfield.stats,
    fights: m.warfield.fights.map((f) => `${f.id}(${f.kind}) ${f.span.toFixed(0)}m y${f.ay.toFixed(1)}/${f.by.toFixed(1)}`),
    maxActive: W.maxActive, maxField: W.maxField ?? 0, maxRim: W.maxRim ?? 0,
    minMuzzle: +W.minMuzzle.toFixed(1),
    minImpact: +W.minImpact.toFixed(1),
    minShell: +W.minShell.toFixed(1),
    tracerNear: +W.tracerNear.toFixed(1),
    shellMinRadius: +W.ridgeMin.toFixed(1),
    blasts: W.blasts.length,
    blastFar: W.blasts.filter((x) => x.r > 176).map((x) => `r${x.r}m dmg${x.dmg} rad${x.rad}`),
  };
});

console.log(`\nlive ${out.elapsed - t0}s of match at scale ${SCALE}`);
console.log('  engagements baked:');
for (const f of out.fights) console.log('    ' + f);
console.log(`  rounds=${out.stats.rounds}  bursts=${out.stats.bursts}  shells=${out.stats.shells}  maxActive=${out.maxActive} (field ${out.maxField} / rim ${out.maxRim})`);
console.log(`  closest ambient muzzle to the eye : ${out.minMuzzle} m`);
console.log(`  closest ambient impact to the eye : ${out.minImpact} m`);
console.log(`  closest ambient tracer to the eye : ${out.tracerNear} m`);
console.log(`  closest ambient shell  to the eye : ${out.minShell} m  (min radius from map centre ${out.shellMinRadius} m)`);
console.log(`  explosion events on the bus: ${out.blasts}; any past the ridge foot (r>176): ${out.blastFar.length ? out.blastFar.join(' ') : 'NONE'}`);
console.log(errs.length ? `\nPAGEERRORS(${errs.length}):\n  ${errs.slice(0, 3).join('\n  ')}` : '\n0 pageerrors');
await b.close();
