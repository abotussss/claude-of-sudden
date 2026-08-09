/**
 * THE SKY COMES DOWN — the five drones, the carrier, and the region it burns.
 *
 *   node _sfshots.mjs [--url=…] [--out=shots/skyfall] [--seed=N]
 *
 * Same shape and the same disclaimer as `_nfcrashshot.mjs`: this calls
 * `crash.fire()` directly the moment the round is live, so it proves NOTHING
 * about when the act fires — `_nfacts.mjs` is the run for that. It is for the
 * questions no number answers (does 86 m of aeroplane read as 86 m of
 * aeroplane, can you see where you may not walk) and for the three things a
 * raycast cannot see: the new flames and both wrecks carry NO COLLISION, so
 * `_floatcheck.mjs` is structurally blind to all of them.
 *
 * It also measures THE FRAME. `?capture=1` runs a fake fixed clock, so
 * `time.dt` is a constant there and useless — the cost is taken as the wall
 * clock between successive rAF callbacks, which is what "465 ms on the frame"
 * means, plus a wrap of `engine.step` for the synchronous half.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4630/?map=plains&capture=1';
const OUT = args.out ?? 'shots/skyfall';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.stack ?? e.message)));
const notes = []; page.on('console', (m) => { const t = m.text(); if (/skyfall|crash\]/i.test(t)) notes.push(t.slice(0, 260)); });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log('level.id =', level);
if (level !== 'plains') { console.error('NOT THE PLAIN'); await b.close(); process.exit(2); }

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
  /** No HUD and no viewmodel: this is a picture of the map, not of a session. */
  if (!window.__HUD__) {
    for (const el of Array.from(document.body.children)) {
      if (el.tagName !== 'CANVAS') el.style.display = 'none';
    }
    e.ctx.viewScene.visible = false;
  }
  const pl = e.ctx.peek('player');
  if (pl) { pl.applyDamage = () => {}; setInterval(() => pl.heal?.(100), 250); }
  /** THE FRAME, measured on the wall clock between presented frames. */
  window.__FRAMES__ = [];
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const c = e.ctx.peek('match')?.crash;
    window.__FRAMES__.push([+(c?._sky?._t ?? -1).toFixed(2), +(now - last).toFixed(1)]);
    if (window.__FRAMES__.length > 4000) window.__FRAMES__.shift();
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const orig = e.step.bind(e);
  window.__STEPMS__ = [];
  e.step = (t) => {
    const a = performance.now();
    const r = orig(t);
    const c = e.ctx.peek('match')?.crash;
    window.__STEPMS__.push([+(c?._sky?._t ?? -1).toFixed(2), +(performance.now() - a).toFixed(2)]);
    if (window.__STEPMS__.length > 4000) window.__STEPMS__.shift();
    return r;
  };
});

const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
/** `from` on the ground + `eye`, looking at a world point. @see src/dev/shots.js */
const place = (from, at, eye, fov) => page.evaluate(([f, a, eye, fov]) => {
  const e = window.__ENGINE__, phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const h = phys.raycast(f[0], 300, f[1], 0, -1, 0, 400, phys.MASK.WORLD);
  const y = (h.hit ? h.point.y : 0) + eye;
  e.camera.position.set(f[0], y, f[1]);
  e.camera.lookAt(new V3(a[0], a[1], a[2]));
  if (fov) { e.camera.fov = fov; e.camera.updateProjectionMatrix(); }
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  return {
    eye: [+e.camera.position.x.toFixed(1), +e.camera.position.y.toFixed(2), +e.camera.position.z.toFixed(1)],
    look: a, fov: e.camera.fov,
  };
}, [from, at, eye, fov ?? 0]);
/** Aim at the centroid of everything this event currently has in the sky. */
const aimSky = (from, eye, fov, motherOnly) => page.evaluate(([f, eye, fov, motherOnly]) => {
  const e = window.__ENGINE__, phys = e.ctx.peek('physics');
  const s = e.ctx.peek('match').crash._sky;
  const V3 = e.camera.position.constructor;
  let x = 0, y = 0, z = 0, n = 0;
  const add = (m) => {
    if (!m.visible) return;
    x += m.matrix.elements[12]; y += m.matrix.elements[13]; z += m.matrix.elements[14]; n++;
  };
  if (motherOnly !== 'drones') {
    if (!motherOnly) {
      for (const d of s.drones) add(d);
      const c = e.ctx.peek('match').crash;
      if (c.hull.visible) add(c.hull);
    }
    add(s.mother);
  } else {
    for (const d of s.drones) add(d);
    const c = e.ctx.peek('match').crash;
    if (c.hull.visible) add(c.hull);
  }
  if (!n) { x = s.centre.x; y = s.centre.y; z = s.centre.z; n = 1; }
  const h = phys.raycast(f[0], 300, f[1], 0, -1, 0, 400, phys.MASK.WORLD);
  e.camera.position.set(f[0], (h.hit ? h.point.y : 0) + eye, f[1]);
  e.camera.lookAt(new V3(x / n, y / n, z / n));
  if (fov) { e.camera.fov = fov; e.camera.updateProjectionMatrix(); }
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  return { eye: [+e.camera.position.x.toFixed(1), +e.camera.position.y.toFixed(2), +e.camera.position.z.toFixed(1)],
    look: [+(x / n).toFixed(0), +(y / n).toFixed(0), +(z / n).toFixed(0)], n, fov: e.camera.fov };
}, [from, eye, fov ?? 0, motherOnly ?? false]);
const shot = async (n, pose) => {
  await page.screenshot({ path: `${OUT}/${n}.png` });
  console.log(`  · ${n}.png   eye ${pose.eye.join(', ')} -> ${pose.look.join(', ')} fov ${pose.fov}`);
};

await page.evaluate(() => (window.__ENGINE__.time.scale = 8));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._checkWinConditions = () => {};
  window.__ENGINE__.time.scale = 1;
});

/* ── the vantages. Every one of them is on open plain and outside the fire ── */
/**
 * EVERY VANTAGE IS MEASURED, NOT GUESSED. `_sfvantage.mjs` reports the ground
 * height, the range and `physics.lineOfSight` to the region for each of these:
 * the first attempt stood at (0, 0) and photographed the control tower, and at
 * (-18, -22) and photographed the inside of the trench works. On a map with a
 * 44 m tower, a 72 m fortress and a trench system in the middle of it, "open
 * plain" is a measurement.
 */
const D_POINT = [0, 0];            // zone D — 100 m, clear
const C_POINT = [-128, 86];        // zone C — 98 m, clear
const A_POINT = [-118, -104];      // zone A — the approach from a capture point
const NEAR = [-40, -40];           // 68 m off the centre, clear, open plain
const RIM = [-52, 24];             // 58 m off the centre, clear
const WEST = [-140, -40];          // 51 m, from the far side of the fire
const KNOLL = [-30, 30];           // ground 9.1 m — the high ground east of it

await frames(8);
await shot('SKY-0-before', await place(NEAR, [-100, 4, -8], 1.7, 75));

console.log('fired:', await page.evaluate(() => window.__ENGINE__.ctx.peek('match').crash.fire()));
const at = (t) => page.waitForFunction(
  (t) => (window.__ENGINE__.ctx.peek('match').crash?._sky?._t ?? -1) >= t, t, { timeout: 180000 });

const plan = [
  ['1-the-sky-falls-from-zone-A', 5.5, 'sky', A_POINT, 1.7, 100],
  ['2-from-zone-C', 9.5, 'sky', C_POINT, 1.7, 100],
  ['2b-eight-objects-over-the-plain', 11.5, 'sky', [-70, -20], 46, 66],
  ['2c-the-five-arrive', 13.2, 'drones', NEAR, 1.7, 90],
  ['3-drones-down', 14.7, 'look', NEAR, 1.7, 75],
  ['4-the-fourth-drone', 16.9, 'look', RIM, 1.7, 75],
  ['5-carrier-committed', 17.6, 'mother', NEAR, 1.7, 75],
  ['6-carrier-over-you', 18.25, 'mother', NEAR, 1.7, 95],
  ['7-impact', 18.8, 'look', NEAR, 1.7, 80],
  ['8-plough', 20.8, 'mother', RIM, 1.7, 80],
  ['9-at-rest', 24.2, 'mother', RIM, 1.7, 80],
];
for (const [tag, t, kind, from, eye, fov] of plan) {
  await at(t);
  const pose = kind === 'look'
    ? await place(from, [-100, 8, -8], eye, fov)
    : await aimSky(from, eye, fov, kind === 'mother' ? true : (kind === 'drones' ? 'drones' : false));
  await frames(1);
  await shot(`SKY-${tag}`, pose);
}

/* ── and the region, once it has settled ─────────────────────────────────── */
await frames(300);
await shot('SKY-10-region-from-zone-D', await place(D_POINT, [-100, 12, -8], 1.7, 75));
await shot('SKY-11-region-from-zone-A', await place(A_POINT, [-100, 12, -8], 1.7, 75));
await shot('SKY-12-region-from-zone-C', await place(C_POINT, [-100, 12, -8], 1.7, 75));
await shot('SKY-13-region-from-the-west', await place(WEST, [-100, 12, -8], 1.7, 80));
/** Two metres outside the flame, found by walking out until `_inside` is false. */
const edge = await page.evaluate(() => {
  const s = window.__ENGINE__.ctx.peek('match').crash._sky;
  /** South-west, deliberately: the satellite's own crater is at (-56, -35) and
   *  standing in THAT photographs the scar's fire, not this one. */
  const bx = Math.cos(3.82), bz = Math.sin(3.82);
  for (let r = 20; r < 120; r += 0.5) {
    const x = s.centre.x + bx * r, z = s.centre.z + bz * r;
    if (!s._inside(x, z)) return [+(s.centre.x + bx * (r + 2.5)).toFixed(1), +(s.centre.z + bz * (r + 2.5)).toFixed(1)];
  }
  return [-52, 24];
});
console.log('  edge of the fire at', edge.join(', '));
await shot('SKY-14-at-the-edge', await place(edge, [-100, 6, -8], 1.62, 85));
await shot('SKY-15-the-wreck', await place(WEST, [-124, 12, 23], 1.62, 60));
await shot('SKY-16-from-above', await place(KNOLL, [-100, 6, -8], 78, 62));
await shot('SKY-17-the-whole-west', await place([30, 60], [-90, 8, 0], 130, 60));

/* ── the measurements ────────────────────────────────────────────────────── */
const m = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const ai = e.ctx.peek('ai');
  const c = e.ctx.peek('match').crash;
  const s = c._sky;
  const a = s.flames.geometry.getAttribute('aAt').array;
  const n = s.flames.geometry.instanceCount;
  let worst = -1e9, worstAt = null, below = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i * 4], y = a[i * 4 + 1], z = a[i * 4 + 2];
    const d = y - ph.groundHeight(x, z, 400);
    if (d > worst) { worst = d; worstAt = [+x.toFixed(1), +y.toFixed(2), +z.toFixed(1)]; }
    if (d < -1.0) below++;
  }
  const seat = (mesh) => {
    const el = mesh.matrix.elements;
    const g = ph.groundHeight(el[12], el[14], 400);
    return { x: +el[12].toFixed(1), y: +el[13].toFixed(2), z: +el[14].toFixed(1),
      ground: +g.toFixed(2), air: +(el[13] - g).toFixed(2), visible: mesh.visible };
  };
  /** How much of the grid is off, and can the bots still get everywhere. */
  const g = ai.grid;
  let walk = 0;
  for (let i = 0; i < g.flags.length; i++) if (g.flags[i]) walk++;
  const out = [];
  const V3 = e.camera.position.constructor;
  const snap = (x, z) => {
    const i = g.nearest(x, z, ph.groundHeight(x, z, 400), 14, 6);
    return i < 0 ? null : new V3(g.worldX(i % g.nx), g.floor[i], g.worldZ((i / g.nx) | 0));
  };
  const zones = [[-118, -104], [-128, 86], [128, -86], [118, 104], [0, 0]].map(([x, z]) => snap(x, z));
  const spawns = [[-14, -150], [14, 150]].map(([x, z]) => snap(x, z));
  const routes = [];
  for (const sp of spawns) for (const zn of zones) routes.push(g.findPath(sp, zn, out));
  for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) routes.push(g.findPath(zones[i], zones[j], out));
  const insideZone = zones.map((p) => s._inside(p.x, p.z));
  const frames = window.__FRAMES__.filter((f) => f[0] >= 0);
  const steps = window.__STEPMS__.filter((f) => f[0] >= 0);
  const top = (arr) => arr.slice().sort((p, q) => q[1] - p[1]).slice(0, 5);
  const med = (arr) => { const v = arr.map((x) => x[1]).sort((p, q) => p - q); return v.length ? v[v.length >> 1] : 0; };
  return {
    flames: { n, worst: +worst.toFixed(2), worstAt, below },
    mother: seat(s.mother), panel: seat(s._panel),
    denied: s._denied, live: s._live, burn: +s._burn.toFixed(0),
    cells: s._nav ? s._nav.cells.length : 0,
    walkable: walk, aiWalkable: ai.stats?.walkable ?? null,
    routes: { total: routes.length, failed: routes.filter((r) => r <= 0).length },
    insideZone,
    frame: { medianMs: med(frames), worst: top(frames), stepMedian: med(steps), stepWorst: top(steps) },
  };
});

console.log('\n  ── boot ──');
for (const n of notes) console.log('   ', n);
console.log('\n  ── the region, settled ──');
console.log(`  flames: ${m.flames.n} instances · worst base ${m.flames.worst} m over its own ground at (${m.flames.worstAt?.join(', ')}) · ${m.flames.below} more than 1 m under it`);
console.log(`  carrier at rest: (${m.mother.x}, ${m.mother.y}, ${m.mother.z}) — ground ${m.mother.ground}, ${m.mother.air} m of air under the origin`);
console.log(`  torn panel:      (${m.panel.x}, ${m.panel.y}, ${m.panel.z}) — ground ${m.panel.ground}, ${m.panel.air} m of air`);
console.log(`  denied=${m.denied} live=${m.live} burn=${m.burn}s  ·  ${m.cells} cells off the grid, ${m.walkable} walkable cells remain`);
console.log(`  routes with the west denied: ${m.routes.total - m.routes.failed}/${m.routes.total} solved${m.routes.failed ? '  <-- FAIL' : ''}`);
console.log(`  any capture point inside the fire: ${m.insideZone.some(Boolean) ? 'YES  <-- FAIL' : 'no'}`);
console.log('\n  ── the frame ──');
console.log(`  median presented frame ${m.frame.medianMs.toFixed(1)} ms · worst ${m.frame.worst.map((f) => `${f[1]}ms@t=${f[0]}`).join('  ')}`);
console.log(`  median engine.step ${m.frame.stepMedian.toFixed(2)} ms · worst ${m.frame.stepWorst.map((f) => `${f[1]}ms@t=${f[0]}`).join('  ')}`);
console.log(errs.length ? `\nPAGEERRORS(${errs.length}):\n  ${errs.slice(0, 3).join('\n  ')}` : '\n0 pageerrors');
await b.close();
