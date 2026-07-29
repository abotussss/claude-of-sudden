/**
 * SOLID GATE — is every prop you can see actually there?
 *
 *   node tools/solidcheck.mjs [--url=…] [--audit] [--drive=N] [--only=id,id]
 *
 * WHY IT EXISTS. "障害物が通り抜けできるところが多々ある" — there are many places
 * where you walk straight through an obstacle. Nothing in this repo could have
 * caught that. `navcheck` tests the BOT height field, which is a single ray per
 * cell and has no opinion about what the player capsule hits. `throughcheck`
 * and `floorcheck` ask whether a route EXISTS, so a prop that has quietly
 * stopped existing to physics makes them PASS HARDER, not fail. `indoorcheck`
 * only ever stands at a door. A barrel with no collision proxy is invisible to
 * every gate in the tree, and the map has thousands of props.
 *
 * The cause is structural rather than incidental, and it is worth stating
 * because it is what makes an automatic gate the only honest answer here:
 * `src/world` authors collision SEPARATELY from geometry. `A.put(id, …)` draws
 * a prop; `A.box(surface, …)` is a completely different call that a human has
 * to remember to type next to it, with numbers re-typed by hand. Nothing binds
 * the two. Every prop in the level is therefore one forgotten line away from
 * being a hologram, and the only way to know which ones are is to go and look
 * at all of them.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES
 *
 * PHASE A — enumerate, then probe. Every `prop_*` InstancedMesh under
 * `world.root` is walked instance by instance (the instance matrices are the
 * ground truth: they are what the GPU draws, transform included, after the
 * level->world bake). Each instance's world AABB is reconstructed from the
 * prototype geometry's bounding box, and the ones a player could stand against
 * are kept — see `isObstacle` for the exact test and why each threshold is the
 * number it is. For each of those the REAL player capsule (r = 0.32, h = 1.78,
 * from `STANCE.stand.stepHeight` = 0.42 up, exactly as `throughcheck` builds
 * it) is placed at the prop's own centre and tested against the REAL physics
 * BVH under `MASK.CHARACTER`. If the capsule fits INSIDE the prop, the player
 * can stand where the prop is, which is the definition of walking through it.
 *
 * This is a static probe and it is cheap, so it covers all ~n thousand
 * instances rather than a sample. It is also strictly conservative in the
 * direction that matters: it can only report a walk-through where the physics
 * world genuinely has nothing, never the reverse.
 *
 * PHASE B — drive the real controller. A static overlap query is not a player.
 * So for every prop KIND that phase A flagged, up to `--drive` instances are
 * confirmed the way the human found them: the player is respawned ~2.6 m from
 * the prop on a clear bearing, faced at it, and W is held for 1.6 s of
 * simulated time. If the capsule finishes INSIDE the prop's footprint it walked
 * through it, on the real controller, exactly as reported. Phase B is the
 * evidence; phase A is the coverage.
 *
 * ---------------------------------------------------------------------------
 * TRAPS, ALL OF THEM PAID FOR ALREADY BY THE OTHER GATES IN THIS FOLDER
 *
 *   - `player.movement.yaw` is the basis. There is no `setYaw()`, and writing
 *     `player.yaw` alone does nothing (see `indoorcheck`).
 *   - `Input.beginFrame` drains `_pendingDown` BEFORE `_pendingUp`, so a keyup
 *     and a keydown in the same engine frame annihilate. Presses are separated
 *     by real frames and then VERIFIED; a walk during which W was not held is
 *     reported INVALID rather than scored as a walk-through.
 *   - The match teleports the subject (`_resetPlayer` on every round), freezes
 *     his feet (`movementLocked` in FREEZE) and shoots him. `quiesce()` stops
 *     all three and is re-asserted before every single walk.
 *   - `respawnAt` snaps the feet to `physics.groundHeight()`, so where the
 *     capsule actually started is measured, not assumed.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const URL = args.url ?? 'http://127.0.0.1:4173/';
const AUDIT = !!args.audit;
const DRIVE = args.drive === undefined ? 2 : Number(args.drive);
const ONLY = typeof args.only === 'string' ? args.only.split(',') : null;

/** Stand speed is 4.57 m/s; sprint 7.01 is the ceiling W alone can ever reach. */
const SPRINT = 7.01;
/** Seconds of SIMULATED time per drive. 1.6 s * 4.57 = 7.3 m — well past a 2.6 m standoff. */
const WALK_S = 1.6;

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const step = (n) => page.evaluate((n) => new Promise((r) => {
  let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

const quiesce = () => page.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const m = c.peek('match'), ai = c.peek('ai'), pl = c.peek('player');
  if (m && !m.__solidcheckStopped) { m.update = () => {}; m.__solidcheckStopped = true; }
  if (m) { m.timer = Infinity; m.roundClock = Infinity; }
  if (ai) { ai.combatEnabled = false; try { ai.clearAgents(); } catch { /* ok */ } }
  if (pl) {
    pl.movementLocked = false; pl.setControlEnabled?.(true); pl.alive = true;
    if (pl.movement) { pl.movement.movementLocked = false; pl.movement.sprinting = false; }
  }
  c.peek('ui')?.banner?.hide?.();
});

await quiesce();
await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await step(70);
await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });
await quiesce();

/* ========================================================================== */
/* PHASE A — every visible prop instance, probed with the real capsule         */
/* ========================================================================== */
const scan = await page.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world'), phys = c.peek('physics');
  if (!w?.root || !phys) return null;
  const THREE_V = c.camera.position.constructor;
  const MASK = phys.MASK.CHARACTER;

  const R = 0.32;     // UNITS.playerRadius
  const H = 1.78;     // UNITS.playerHeight
  const STEP = 0.42;  // STANCE.stand.stepHeight — anything under this is stepped over

  /**
   * IS THIS A THING YOU BUMP INTO?
   *
   * Three thresholds, none of them arbitrary:
   *
   *   tall  >= 0.55 m. `STANCE.stand.stepHeight` is 0.42: the controller walks
   *         OVER anything shorter without the player ever feeling it, so a
   *         0.2 m cinder block owes physics nothing. 0.55 leaves margin over
   *         the step for the tilt jitter `Assembler.put` adds.
   *   wide  >= 0.30 m on BOTH horizontal axes OF THE PROP ITSELF, not of its
   *         world AABB. The level is yawed 0.5877 rad into the world and the
   *         dressing jitters another ±0.21 on top, so a 1.6 x 0.08 m shop sign
   *         has a 1.4 x 0.95 m AABB — and the AABB version of this test duly
   *         demanded collision on facade signage. Measuring the prototype's own
   *         box under the instance's SCALE gives the real plate. A plank on
   *         edge is not cover, and making it solid would be worse than leaving
   *         it open.
   *   in the way. Its base must be no more than one step above the floor
   *         beside it (else you walk UNDER it — a sign, an awning, an AC unit
   *         bolted under a first-floor window) and its top at least MIN_H above
   *         that same floor. You cannot walk through what is not in front of
   *         you.
   */
  const MIN_H = 0.55, MIN_W = 0.30;

  /**
   * Kinds that are SUPPOSED to be permeable, and why. This list is the tool's
   * only judgement call, so it is short and each entry has a reason:
   *   foliage    you walk through a bush in every shooter ever shipped, and
   *              `LAYER.FOLIAGE` exists in src/physics for exactly this.
   *   dust_skirt a painted contact fillet, 4 mm thick — not an object.
   *   litter/glass_shards/pock  decals with a thickness.
   * Everything else that is big enough to bump into is expected to be solid.
   */
  const PERMEABLE = new Set(['shrub', 'weeds', 'palm_frond', 'dust_skirt',
                             'litter', 'glass_shards', 'pock']);

  const _a = new THREE_V(), _b = new THREE_V(), _c = new THREE_V();
  const M = c.camera.matrixWorld.constructor;      // THREE.Matrix4
  const _m = new M();

  const kinds = new Map();
  const flagged = [];
  let instances = 0, obstacles = 0;

  for (const im of w.root.children) {
    if (!im.isInstancedMesh || !im.name?.startsWith('prop_')) continue;
    const id = im.name.slice(5);
    const geo = im.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const permeable = PERMEABLE.has(id);
    let k = kinds.get(id);
    if (!k) kinds.set(id, (k = { id, n: 0, obstacles: 0, through: 0, permeable,
                                 surface: im.userData.surface ?? '?' }));

    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, _m);
      instances++; k.n++;
      // world AABB of this instance: the prototype's box under its own matrix.
      let nx = Infinity, ny = Infinity, nz = Infinity;
      let xx = -Infinity, xy = -Infinity, xz = -Infinity;
      for (let cix = 0; cix < 8; cix++) {
        _c.set(cix & 1 ? bb.max.x : bb.min.x,
               cix & 2 ? bb.max.y : bb.min.y,
               cix & 4 ? bb.max.z : bb.min.z).applyMatrix4(_m);
        if (_c.x < nx) nx = _c.x; if (_c.x > xx) xx = _c.x;
        if (_c.y < ny) ny = _c.y; if (_c.y > xy) xy = _c.y;
        if (_c.z < nz) nz = _c.z; if (_c.z > xz) xz = _c.z;
      }
      // The prop's OWN box, scaled but not rotated — see MIN_W above.
      const e = _m.elements;
      const sX = Math.hypot(e[0], e[1], e[2]);
      const sY = Math.hypot(e[4], e[5], e[6]);
      const sZ = Math.hypot(e[8], e[9], e[10]);
      const ox = (bb.max.x - bb.min.x) * sX;
      const oh = (bb.max.y - bb.min.y) * sY;
      const oz = (bb.max.z - bb.min.z) * sZ;
      if (oh < MIN_H || ox < MIN_W || oz < MIN_W) continue;
      const hgt = xy - ny, wx = xx - nx, wz = xz - nz;
      /**
       * PROBE AT THE INSTANCE ORIGIN, NOT THE AABB CENTRE.
       *
       * Every prototype in props.js is authored around its own origin at the
       * base of the object, and `put(id, x, y, z)` puts that origin exactly
       * where the prop was placed. The AABB centre is a different point the
       * moment a prop is not a box: a street lamp's bounding box includes the
       * 1.4 m arm, so its centre sits 0.7 m out in mid-air BESIDE the pole —
       * and the first run of this tool duly reported 7 of the 9 street lamps
       * as walk-throughs when all nine have had a collision box since the day
       * they were placed. A gate that cries wolf is worse than no gate.
       */
      const cx = _m.elements[12], cz = _m.elements[14];

      /**
       * THE FLOOR THIS PROP STANDS ON, measured AROUND it and never through it.
       *
       * Dropping the ray down the prop's own axis cannot work in both of the
       * cases this tool has to tell apart: when the prop is solid the ray
       * starts inside its collision box and the answer depends on whether the
       * BVH happens to report a backface, and when it is not solid the answer
       * is the ground. So sample a ring just outside the footprint instead and
       * keep the hit nearest the prop's own base. That is the surface a player
       * walking up to it is standing on, which is the thing the FOOT test is
       * actually about.
       */
      const oy = _m.elements[13];
      const ring = Math.max(wx, wz) / 2 + 0.45;
      let fy = -Infinity, fd = Infinity;
      for (let s = 0; s < 8; s++) {
        const th = (s / 8) * Math.PI * 2;
        const h = phys.groundHeight(cx + Math.sin(th) * ring, cz + Math.cos(th) * ring,
                                    oy + 1.6, phys.MASK.WORLD);
        if (!isFinite(h)) continue;
        if (Math.abs(h - oy) < fd) { fd = Math.abs(h - oy); fy = h; }
      }
      // In the way: base within one step of that floor, top MIN_H above it.
      if (!(ny - fy <= STEP && ny - fy > -1.2 && xy - fy >= MIN_H)) continue;
      obstacles++; k.obstacles++;
      if (permeable) continue;

      /**
       * Can the player stand where the prop is? The capsule spans STEP..H at
       * the prop's own centre, shaved 5 mm exactly as `CharacterController`
       * does. `checkCapsule` returns TRUE when the capsule is CLEAR — i.e.
       * TRUE here means the prop is not there.
       */
      const base = Math.max(oy, fy);
      _a.set(cx, base + STEP + R, cz);
      _b.set(cx, base + H - R + 0.02, cz);
      if (!phys.checkCapsule(_a, _b, R - 0.005, MASK)) continue;
      k.through++;
      flagged.push({ id, i, c: [+cx.toFixed(2), +oy.toFixed(2), +cz.toFixed(2)],
        base: +base.toFixed(2), h: +oh.toFixed(2),
        // The inscribed radius of the prop's own footprint — rotation-proof,
        // and what phase B calls "inside".
        rad: +(Math.min(ox, oz) / 2).toFixed(2),
        span: +(Math.max(wx, wz) / 2).toFixed(2) });
    }
  }

  return { instances, obstacles, flagged,
           kinds: [...kinds.values()].sort((a, b) => b.through - a.through || b.obstacles - a.obstacles) };
});

if (!scan) {
  console.log('[solidcheck] world/physics not exposed');
  await browser.close(); process.exit(2);
}

console.log(`\n[solidcheck] ${scan.instances} prop instances, ${scan.obstacles} of them ` +
            `big enough to stand against\n`);
console.log('  prop kind        surface     instances  obstacles  WALK-THROUGH');
for (const k of scan.kinds) {
  if (!AUDIT && k.through === 0 && !k.permeable) continue;
  if (!AUDIT && k.permeable) continue;
  console.log(`  ${k.id.padEnd(16)} ${String(k.surface).padEnd(11)} ` +
    `${String(k.n).padStart(9)}  ${String(k.obstacles).padStart(9)}  ` +
    `${k.permeable ? '        (permeable)' : String(k.through).padStart(12)}`);
}
const through = scan.flagged.length;
console.log(`\n  walk-throughs: ${through} / ${scan.obstacles} standable-against instances`);

/* ========================================================================== */
/* PHASE B — drive the real player controller at a sample of them              */
/* ========================================================================== */
async function drive(f) {
  await quiesce();
  const start = await page.evaluate((f) => {
    const e = window.__ENGINE__, c = e.ctx;
    const pl = c.peek('player'), phys = c.peek('physics');
    const V = c.camera.position.constructor;
    const half = f.span;
    /**
     * Pick an approach bearing with somewhere to stand. Sixteen bearings at
     * three standoffs, nearest first, and the first one whose floor is within
     * 1 m of the prop's base and where the real capsule fits wins. Dropping the
     * player into a wall and then reporting that he failed to reach the prop
     * would be exactly the untrustworthy NO the other gates in this folder
     * exist to avoid — and a single 2.2 m ring skipped every chair and shelf on
     * the map, because indoors there is often no 2.2 m of clear room.
     */
    const R = 0.32, H = 1.78, STEP = 0.42;
    const a = new V(), b = new V();
    for (const extra of [1.5, 2.2, 3.0]) {
      for (let s = 0; s < 16; s++) {
        const th = (s / 16) * Math.PI * 2;
        const stand = half + extra;
        const px = f.c[0] + Math.sin(th) * stand, pz = f.c[2] + Math.cos(th) * stand;
        const fy = phys.groundHeight(px, pz, f.base + 3, phys.MASK.WORLD);
        if (!isFinite(fy) || Math.abs(fy - f.base) > 1.0) continue;
        a.set(px, fy + STEP + R, pz); b.set(px, fy + H - R + 0.02, pz);
        if (!phys.checkCapsule(a, b, R - 0.005, phys.MASK.CHARACTER)) continue;
        pl.respawnAt({ x: px, y: fy + 0.05, z: pz });
        // movement.yaw is the basis, and respawnAt RESETS it (its `yaw`
        // parameter defaults to 0), so it can only be set afterwards.
        const yaw = Math.atan2(-(f.c[0] - px), -(f.c[2] - pz));
        pl.movement.yaw = yaw; pl.yaw = yaw;
        const q = pl.position ?? c.camera.position;
        return { ok: true, from: [+px.toFixed(1), +pz.toFixed(1)], stand: +stand.toFixed(1),
                 drift: +Math.hypot(q.x - px, q.z - pz).toFixed(2) };
      }
    }
    return { ok: false };
  }, f);
  if (!start.ok) return { ...start, skipped: true };

  await step(4);
  await page.keyboard.down('KeyW');
  await step(3);
  if (!await page.evaluate(() => window.__ENGINE__.ctx.input.down.has('KeyW'))) {
    await page.keyboard.up('KeyW'); await step(6);
    await page.keyboard.down('KeyW'); await step(3);
  }
  const res = await page.evaluate(([f, secs]) => new Promise((done) => {
    const c = window.__ENGINE__.ctx;
    const pl = c.peek('player');
    const t0 = c.time.elapsed;
    const p0 = pl.position ?? c.camera.position;
    const s = { x: p0.x, z: p0.z };
    /**
     * "INSIDE" IS THE CAPSULE CENTRE INSIDE THE VISIBLE FOOTPRINT.
     *
     * `pl.position` is `movement.renderPosition` — the FEET, on the capsule
     * axis. A solid prop stops that axis a full capsule radius (0.32 m) OUTSIDE
     * its own face, so getting the axis strictly inside the footprint at all is
     * already 0.32 m more than a solid prop can ever allow. Requiring it to
     * reach some deeper margin instead is what made the first run of phase B
     * report "stopped" at a `deepest` of -0.04 m for props phase A had proved
     * empty: the player had walked clean through a 0.6 m barrel and the test
     * was asking him to also hit its exact centreline.
     */
    let deepest = -Infinity, inside = false, frames = 0, held = 0;
    const tick = () => {
      const q = pl.position ?? c.camera.position;
      const m = f.rad - Math.hypot(q.x - f.c[0], q.z - f.c[2]);
      if (m > deepest) deepest = m;
      // …and the feet must be BELOW the prop's top, or he climbed onto it.
      if (m > 0 && q.y < f.base + f.h - 0.25) inside = true;
      frames++;
      if (c.input.down.has('KeyW')) held++;
      if (c.time.elapsed - t0 >= secs) {
        return done({ inside, deepest: +deepest.toFixed(2), frames, held,
          sim: +(c.time.elapsed - t0).toFixed(2),
          dist: +Math.hypot(q.x - s.x, q.z - s.z).toFixed(1),
          endY: +q.y.toFixed(2) });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), [f, WALK_S]);
  await page.keyboard.up('KeyW');
  return { ...start, ...res,
    teleport: res.dist > SPRINT * res.sim + 1,
    invalid: res.held < res.frames * 0.9 };
}

let driven = 0, confirmed = 0, skipped = 0, bad = 0;
if (DRIVE > 0 && through > 0) {
  console.log('\n  --- driving the real controller at a sample ---');
  console.log('  prop kind        from(world)      moved  deepest inside  verdict');
  const byKind = new Map();
  for (const f of scan.flagged) {
    if (ONLY && !ONLY.includes(f.id)) continue;
    const list = byKind.get(f.id) ?? byKind.set(f.id, []).get(f.id);
    if (list.length < DRIVE) list.push(f);
  }
  for (const [id, list] of byKind) {
    for (const f of list) {
      const r = await drive(f);
      if (r.skipped) { skipped++; console.log(`  ${id.padEnd(16)} — no clear standoff, skipped`); continue; }
      driven++;
      if (r.invalid || r.teleport) bad++;
      else if (r.inside) confirmed++;
      const verdict = r.invalid ? `INVALID (W held ${r.held}/${r.frames})`
        : r.teleport ? 'TELEPORT' : r.inside ? 'WALKED THROUGH' : 'stopped';
      console.log(`  ${id.padEnd(16)} [${String(r.from[0]).padStart(6)},${String(r.from[1]).padStart(6)}]  ` +
        `${String(r.dist).padStart(5)}m ${String(r.deepest).padStart(7)}m  ${verdict}`);
    }
  }
  console.log(`\n  driven ${driven}, confirmed walk-through ${confirmed}, skipped ${skipped}, unusable ${bad}`);
}

if (errs.length) console.log('\n[solidcheck] page errors', errs.slice(0, 4));
console.log(through
  ? `\n[solidcheck] FAIL — ${through} prop instance(s) you can walk straight through`
  : `\n[solidcheck] PASS — all ${scan.obstacles} standable-against prop instances are solid`);
await browser.close();
process.exit(through || bad || errs.length ? 1 : 0);
