/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD BY EYE — the fires, the dark between them, and a man at range
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfnight.mjs [--url=…] [--out=shots/nfnight] [--settle] [--at=SECONDS]
 *
 * 「夜なのに明るすぎる … もっと山の燃えている感じはリアルに 燃えていて煌々と光るのを
 *   再現して その燃えている光で夜なのにその周りは明るい、橙色に明るい雰囲気をそこに
 *   作る でも周りは夜の闇にして」
 *
 * That is a CONTRAST spec, not a level spec, so a single frame cannot answer it
 * and an average certainly cannot. What it needs is the same night photographed
 * in two places — inside a fire's pool and out of reach of every one of them —
 * and the ratio between them.
 *
 * And it has a hard floor under it that pulls the other way: he plays this map,
 * the capture points are 154-314 m apart, and he has complained that the enemy
 * does not engage at range. A night that reads beautifully and hides a man at
 * 150 m has failed. So every run puts a real agent on the ground at 50, 100 and
 * 200 m, lit and unlit, and photographs him.
 *
 * WHAT EACH FRAME CARRIES. Alongside the PNG this prints the metered EV100 and
 * the exposure scalar for that frame, so a picture that looks wrong can be
 * chased to a number without a second run.
 *
 *   --settle   ignores the shot list and instead photographs ONE camera at 5,
 *              30, 60, 120, 300 and 600 frames, which is the whole of the
 *              "does the first second of a round look like the tenth" question.
 *   --at=N     lets the match run N more seconds before shooting, so the list
 *              can be taken at several points in a round.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4603/?map=plains&capture=1';
const OUT = args.out ?? 'shots/nfnight';
const AT = Number(args.at ?? 0);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('crash', () => errs.push('PAGE CRASHED'));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level=${level}  out=${OUT}  at=+${AT}s`);
if (level !== 'plains') { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

const hidden = await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('ui')?.debugState?.('clean');
  const pl = e.ctx.peek('player');
  if (pl) pl.applyDamage = () => {};
  /**
   * THE EMP DOMES COME OUT FOR THE LIGHTING SET. `match-emp` puts two 34 m
   * self-lit green shells on this map, they are somebody else's feature and they
   * are working correctly — but they are also 34 m of emissive standing in the
   * middle of the plain, and a frame taken from inside one is a photograph of a
   * green wall, not of a night. They are hidden for the shutter and nothing else
   * about them is touched. Named rather than guessed at: `EmpZones.group.name`.
   */
  const g = e.ctx.scene.getObjectByName('match-emp');
  if (g) g.visible = false;
  /**
   * AND THE HUD GOES WITH IT, which matters far more than it sounds. The Weber
   * measurement below samples the pixels a man occupies against the pixels
   * beside him, and this game draws a range readout and a spot bracket ON him
   * the moment he is seen. The first run of that measurement reported a Weber
   * of 1.0 for a man at 200 m in pure moonlight — a number that would mean he
   * was glowing — because what it had actually found was a "200M" caption in
   * HUD white. Measuring the overlay instead of the world is the exact way this
   * test would have passed while the map failed.
   */
  e.ctx.peek('ui')?.setHudVisible?.(false);
  return g ? 'match-emp hidden, HUD off' : 'no match-emp in scene, HUD off';
});
console.log(`  ${hidden}`);

const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

/** The round has to be LIVE or the spawn logic keeps snapping the camera home. */
await page.evaluate(() => (window.__ENGINE__.time.scale = 6));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  window.__ENGINE__.time.scale = 1;
});
if (AT > 0) await page.waitForTimeout(AT * 1000);

/** Where the fires actually are, read off the level rather than re-derived. */
const FIRES = await page.evaluate(() => (window.__ENGINE__.ctx.peek('world').level.fires ?? [])
  .map((f) => ({ id: f.id, x: +f.position.x.toFixed(1), y: +f.position.y.toFixed(1), z: +f.position.z.toFixed(1),
    lx: +f.light.position.x.toFixed(1), ly: +f.light.position.y.toFixed(1), lz: +f.light.position.z.toFixed(1),
    i: +f.light.intensity.toFixed(1) })));
console.log('  fires:', JSON.stringify(FIRES));

const meter = () => page.evaluate(() => {
  const r = window.__ENGINE__.ctx.peek('render');
  try { const d = r.debugExposure(); return `EV100 ${d.ev100.toFixed(2)}  exp ${d.exposure.toFixed(2)}  avgLum ${d.avgLum.toFixed(5)}`; }
  catch { return '(no meter)'; }
});

/** Stand at (x,z) with `eye` over the ground there — or at an absolute y. */
const place = (from, at, eye, free) => page.evaluate(([f, a, eye, free]) => {
  const e = window.__ENGINE__, phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  let y = free;
  if (y === null) {
    const h = phys.raycast(f[0], 300, f[1], 0, -1, 0, 400, phys.MASK.WORLD);
    y = (h.hit ? h.point.y : 0) + eye;
  }
  e.camera.position.set(f[0], y, f[1]);
  e.camera.lookAt(new V3(a[0], a[1], a[2]));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  return +y.toFixed(2);
}, [from, at, eye, free ?? null]);

/**
 * Put a real agent on the ground at a world point and stop him walking off.
 * A capsule primitive would answer the wrong question: what has to be findable
 * at 200 m is the actual character mesh in the actual material.
 *
 * IT ALSO REPORTS WHAT IS LIGHTING HIM AND WHETHER HE CAN BE SEEN AT ALL, and
 * both of those exist because the first run of this probe produced three
 * photographs of the inside of the control tower captioned "a man at 100 m".
 * A camera placed by hand on a map with a fortress in the middle of it is a
 * camera pointed at the fortress; the sightline is now raycast and printed, and
 * a shot that says BLOCKED is not evidence of anything.
 */
const manAt = (x, z) => page.evaluate(([x, z]) => {
  const e = window.__ENGINE__, ai = e.ctx.peek('ai'), phys = e.ctx.peek('physics');
  const h = phys.raycast(x, 300, z, 0, -1, 0, 400, phys.MASK.WORLD);
  const y = h.hit ? h.point.y : 0;
  const a = ai.agents.find((g) => g.alive && g !== e.ctx.peek('player'));
  if (!a) return null;
  a.position.set(x, y, z);
  a.group.position.set(x, y, z);
  a.moveTarget?.set?.(x, y, z);
  a.hasMoveTarget = false;
  a.update = () => {};          // hold him still for the shutter
  a.group.updateMatrixWorld(true);
  return { x, y: +y.toFixed(2), z, name: a.variantName ?? 'agent' };
}, [x, z]);

/** Irradiance at a point from the five fires, against the moon's own. */
const lightAt = (x, y, z) => page.evaluate(([x, y, z]) => {
  const e = window.__ENGINE__, sky = e.ctx.peek('sky');
  let fire = 0;
  for (const f of e.ctx.peek('world').level.fires ?? []) {
    const L = f.light, d = Math.hypot(L.position.x - x, L.position.y - y, L.position.z - z);
    if (L.distance > 0 && d >= L.distance) continue;
    const w = L.distance > 0 ? Math.max(0, 1 - (d / L.distance) ** 4) ** 2 : 1;
    fire += (L.intensity * w) / Math.max(d * d, 1);
  }
  return { fire: +fire.toFixed(4), moon: +sky.moonLight.intensity.toFixed(4) };
}, [x, y, z]);

/**
 * ────────────────────────────────────────────────────────────────────────────
 * CAN YOU ACTUALLY SEE HIM? — the acceptance test, as a number
 * ────────────────────────────────────────────────────────────────────────────
 * "A man must read at 200 m" cannot be settled by looking at a 12-pixel-tall
 * shape in a dark frame and deciding, because whoever is looking already knows
 * where he is. What decides it is the contrast between the pixels he occupies
 * and the pixels immediately around him — if that is at the level of the
 * sensor's own noise, the player will not find him no matter how long he looks.
 *
 * So this projects his chest to screen space, samples a box the size of his
 * torso and an annulus of the background just outside it, and reports the WEBER
 * contrast |Lman - Lbg| / Lbg. Rules of thumb worth having in the output:
 *
 *     under 0.10   invisible in motion. He is the ground.
 *     0.10 - 0.25  findable if you already suspect he is there.
 *     over 0.25    reads as a separate object at a glance.
 */
const projectMan = (mx, my, mz) => page.evaluate(([mx, my, mz]) => {
  const e = window.__ENGINE__, cam = e.camera;
  const V3 = cam.position.constructor;
  const p = new V3(mx, my + 1.05, mz).project(cam);
  const w = window.innerWidth, h = window.innerHeight;
  const near = new V3(mx, my + 1.05, mz).distanceTo(cam.position);
  // Vertical pixels per metre at that range, from the camera's own fov.
  const ppm = h / (2 * Math.tan((cam.fov * Math.PI) / 360) * near);
  return { x: Math.round(((p.x + 1) / 2) * w), y: Math.round(((1 - p.y) / 2) * h), ppm: +ppm.toFixed(2), range: +near.toFixed(1) };
}, [mx, my, mz]);

const lin = (u) => { const c = u / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function weber(pngPath, sx, sy, ppm) {
  const png = PNG.sync.read(readFileSync(pngPath));
  const halfW = Math.max(2, Math.round(0.30 * ppm));   // a torso is ~0.6 m across
  const halfH = Math.max(3, Math.round(0.55 * ppm));   // …and ~1.1 m of it is above the knee
  const L = (i, j) => {
    if (i < 0 || j < 0 || i >= png.width || j >= png.height) return null;
    const o = (j * png.width + i) * 4;
    return 0.2126 * lin(png.data[o]) + 0.7152 * lin(png.data[o + 1]) + 0.0722 * lin(png.data[o + 2]);
  };
  let mS = 0, mN = 0, bS = 0, bN = 0;
  for (let j = sy - halfH * 3; j <= sy + halfH * 3; j++) {
    for (let i = sx - halfW * 4; i <= sx + halfW * 4; i++) {
      const v = L(i, j); if (v === null) continue;
      const inMan = Math.abs(i - sx) <= halfW && Math.abs(j - sy) <= halfH;
      if (inMan) { mS += v; mN++; }
      else if (Math.abs(i - sx) > halfW * 2 || Math.abs(j - sy) > halfH * 2) { bS += v; bN++; }
    }
  }
  if (!mN || !bN) return null;
  const man = mS / mN, bg = bS / bN;
  return { man: +man.toFixed(4), bg: +bg.toFixed(4), weber: +(Math.abs(man - bg) / Math.max(bg, 1e-4)).toFixed(3), px: `${halfW * 2}x${halfH * 2}` };
}

/** Can the camera actually see his chest? */
const sightline = (mx, my, mz) => page.evaluate(([mx, my, mz]) => {
  const e = window.__ENGINE__, phys = e.ctx.peek('physics'), c = e.camera.position;
  const tx = mx, ty = my + 1.15, tz = mz;
  const dx = tx - c.x, dy = ty - c.y, dz = tz - c.z;
  const d = Math.hypot(dx, dy, dz);
  const h = phys.raycast(c.x, c.y, c.z, dx / d, dy / d, dz / d, d - 0.6, phys.MASK.WORLD);
  return { range: +d.toFixed(1), clear: !h.hit, blockedAt: h.hit ? +h.distance.toFixed(1) : null };
}, [mx, my, mz]);

const shoot = async (name, n = 45) => {
  await frames(n);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  · ${name.padEnd(24)} ${await meter()}`);
};

// ── the settle series ──────────────────────────────────────────────────────
if (args.settle) {
  await place([0, 40], [0, 3, -60], 1.62, null);
  let seen = 0;
  for (const n of [5, 30, 60, 120, 300, 600]) {
    await frames(n - seen); seen = n;
    await page.screenshot({ path: `${OUT}/settle-${String(n).padStart(3, '0')}.png` });
    console.log(`  · settle-${String(n).padStart(3, '0')}   ${await meter()}`);
  }
  console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 4).join(' | ')}` : '\n0 pageerrors');
  await b.close();
  process.exit(0);
}

// ── the shot list ──────────────────────────────────────────────────────────
// FIRE-E burns on bearing 0.24 rad, so its light stands at about (146, 36) and
// the ground in front of it is the brightest ground on the map. The map centre
// is ~150 m from every fire light and is the darkest.
const F = FIRES[2] ?? { lx: 146, lz: 36, x: 197, y: 20, z: 48 };
const bx = F.lx / Math.hypot(F.lx, F.lz), bz = F.lz / Math.hypot(F.lx, F.lz); // outward unit

/** A point `d` metres inward from the fire light, along its own bearing. */
const inward = (d) => [+(F.lx - bx * d).toFixed(1), +(F.lz - bz * d).toFixed(1)];

const SHOTS = [
  // ── the open steppe, away from every fire ────────────────────────────────
  ['steppe-50', [-30, 10], [-30, 1.4, -40], 1.62, null],
  ['steppe-200', [0, 150], [0, 2.0, -50], 1.62, null],
  // ── a frame holding both ground and sky ──────────────────────────────────
  ['ground-and-sky', [-60, 120], [-60, 26, -60], 1.62, null],
  // ── the burning ridge ────────────────────────────────────────────────────
  ['fire-close', inward(34), [F.x, F.y + 8, F.z], 1.62, null],
  ['fire-200', inward(200), [F.x, F.y + 10, F.z], 1.62, null],
  ['fire-ridge-wide', [-150, -110], [-190, 40, -140], 1.62, null],
  // ── the ground, in a fire's pool and out of it ───────────────────────────
  ['ground-in-pool', inward(12), [F.lx - bx * 60, 0.4, F.lz - bz * 60], 1.62, null],
  ['ground-pool-edge', inward(78), [F.lx - bx * 130, 0.6, F.lz - bz * 130], 1.62, null],
  ['ground-far-dark', [0, 0], [-70, 0.8, -70], 1.62, null],
  // ── the works ────────────────────────────────────────────────────────────
  ['tower', [-46, -70], [0, 26, -32], 1.62, null],
  ['fortress', [0, 96], [0, 8, 56], 1.62, null],
];

for (const [name, from, at, eye, free] of SHOTS) {
  await place(from, at, eye, free);
  await shoot(name);
}

// ── a man at range ─────────────────────────────────────────────────────────
/**
 * THE POSITIONS ARE SEARCHED FOR, NOT TYPED IN, and that is not fastidiousness.
 * The first version of this hand-placed a camera at the map centre and produced
 * three photographs of the inside of the control tower captioned "a man at
 * 100 m". NACHTFELD has a 46 m tower pad at (0,-32) and a 58 m fortress pad at
 * (0,48) sitting in the middle of every long line anyone would think to draw.
 *
 * So for each distance this sweeps the bearing, keeps only stands that are on
 * open ground with a CLEAR raycast to the man's chest, and then picks the one
 * whose fire irradiance is lowest (`dark`) or highest (`lit`). Every frame is
 * printed with the range, the sightline verdict and the fire:moon ratio it was
 * actually taken at, so the photograph and the number cannot drift apart.
 *
 * WHY THE DARK SET STOPS BEING FULLY DARK AT 200 m is a fact about the map and
 * is worth stating rather than hiding: five fires stand on a 150 m ring inside
 * a 176 m bowl, so the unlit part of this map is its MIDDLE, and no straight
 * 200 m of it stays there — the far end of any such line is on the ring. The
 * ratio printed under each shot says exactly how far into a pool it got.
 */
const pickStand = (d, want) => page.evaluate(([d, want]) => {
  const e = window.__ENGINE__, lvl = e.ctx.peek('world').level, phys = e.ctx.peek('physics');
  const fires = lvl.fires ?? [];
  /** The five fires' irradiance at a point, THREE's own windowed inverse square. */
  const irr = (x, y, z) => {
    let f = 0;
    for (const s of fires) {
      const L = s.light, dd = Math.hypot(L.position.x - x, L.position.y - y, L.position.z - z);
      if (L.distance > 0 && dd >= L.distance) continue;
      const w = L.distance > 0 ? Math.max(0, 1 - (dd / L.distance) ** 4) ** 2 : 1;
      // The site's own base, not the live flickering value: which stand is the
      // brightest must not depend on which millisecond the search ran in.
      f += ((s.baseIntensity ?? L.intensity) * w) / Math.max(dd * dd, 1);
    }
    return f;
  };

  /**
   * CAMERA AND MAN ARE BOTH SWEPT OVER THE FULL CIRCLE. An earlier version put
   * the camera on a ring and always aimed it at the centre, and that quietly
   * made the whole "lit" set impossible to satisfy: the fires are ON the ring,
   * so aiming inward guarantees the man is inside it and out of every pool. It
   * dutifully reported fire = 0 for a shot whose entire purpose was fire.
   */
  const cands = [];
  for (const R of [55, 90, 125, 150, 168]) {
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const cx = Math.cos(a) * R, cz = Math.sin(a) * R;
      if (!lvl.isOpen(cx, cz, 0.7)) continue;
      for (let j = 0; j < 40; j++) {
        const t = (j / 40) * Math.PI * 2;
        const mx = cx + Math.cos(t) * d, mz = cz + Math.sin(t) * d;
        if (Math.hypot(mx, mz) > 170 || !lvl.isOpen(mx, mz, 0.7)) continue;
        const f = irr(mx, lvl.groundY(mx, mz) + 1.6, mz);
        cands.push({ cx, cz, mx, mz, f, score: want === 'dark' ? -f : f });
      }
    }
  }
  cands.sort((p, q) => q.score - p.score);

  /**
   * …and only now the raycast, best-first. The sightline is the expensive test
   * and the one that actually decides whether the photograph is evidence, so it
   * is run on the ranked list until something is clear rather than on all of
   * them. Without it this probe produced three frames of the inside of the
   * control tower captioned "a man at 100 m".
   */
  let tried = 0;
  for (const c of cands) {
    if (tried++ > 400) break;
    const cy = lvl.groundY(c.cx, c.cz) + 1.62;
    const my = lvl.groundY(c.mx, c.mz) + 1.15;
    const dx = c.mx - c.cx, dy = my - cy, dz = c.mz - c.cz;
    const L = Math.hypot(dx, dy, dz);
    const h = phys.raycast(c.cx, cy, c.cz, dx / L, dy / L, dz / L, L - 0.7, phys.MASK.WORLD);
    if (h.hit) continue;
    return { cx: +c.cx.toFixed(1), cz: +c.cz.toFixed(1), mx: +c.mx.toFixed(1), mz: +c.mz.toFixed(1),
      fire: +c.f.toFixed(4), searched: cands.length, tried };
  }
  return null;
}, [d, want]);

for (const want of ['dark', 'lit']) {
  for (const d of [50, 100, 200]) {
    const s = await pickStand(d, want);
    if (!s) { console.log(`  · man-${want}-${d}m  NO STAND FOUND`); continue; }
    const m = await manAt(s.mx, s.mz);
    await place([s.cx, s.cz], [s.mx, (m?.y ?? 0) + 1.0, s.mz], 1.62, null);
    const sl = await sightline(s.mx, m?.y ?? 0, s.mz);
    const lit = await lightAt(s.mx, (m?.y ?? 0) + 1, s.mz);
    await shoot(`man-${want}-${d}m`);
    const pr = await projectMan(s.mx, m?.y ?? 0, s.mz);
    const c = weber(`${OUT}/man-${want}-${d}m.png`, pr.x, pr.y, pr.ppm);
    console.log(`      eye (${s.cx}, ${s.cz}) -> man (${s.mx}, ${s.mz})  range ${sl.range} m  ` +
      `${sl.clear ? 'CLEAR' : `BLOCKED at ${sl.blockedAt} m`}  fire ${lit.fire}  moon ${lit.moon}  ` +
      `(${(lit.fire / lit.moon).toFixed(2)}x the moon)`);
    console.log(`      he is ${c ? `${c.px} px, L ${c.man} against ${c.bg} — WEBER ${c.weber}` +
      `  ${c.weber >= 0.25 ? 'reads at a glance' : c.weber >= 0.10 ? 'findable if suspected' : 'INVISIBLE'}` : '(off screen)'}`);
  }
}

console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 4).join(' | ')}` : '\n0 pageerrors');
await b.close();
