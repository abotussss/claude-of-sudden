/**
 * INDOOR GATE — can a PLAYER actually get inside the buildings marked
 * `enterable: true`?
 *
 *   node tools/indoorcheck.mjs [--url=…] [--verbose]
 *
 * WHY. The map declares eight enterable buildings with rooms, stairs and doors,
 * and the player reports "屋内も入れない" — you cannot get in. `navcheck` cannot
 * catch this: it tests the BOT nav grid, which is a 2.5D height field that has
 * no idea whether a doorway is wide enough for the player capsule or whether a
 * prop has been dressed across it. Nothing else in the repo tests the player's
 * own collision against the interiors at all.
 *
 * So this drives the real player controller: stand outside each enterable
 * building, walk at the wall on the bearing of each of its doors, and report
 * whether the capsule got INSIDE the footprint. A building nobody can walk into
 * is a failure, however good its interior looks in a screenshot.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE FIRST TWO VERSIONS GOT WRONG, AND WHY THIS ONE IS TRUSTWORTHY
 *
 * v1 walked at the CENTRE of each of the four faces and reported 8/8 dead. The
 * doors are authored per bay (`doorBays: { 1: 2, 3: 0 }`), so the middle of a
 * face is usually solid wall and the capsule was correctly stopping against it.
 * `WorldSystem.buildings[i].doors` carries the real world position of every
 * door the builder actually cut; v2 used those.
 *
 * v2 still could not be trusted, because IT LEFT THE MATCH RUNNING. Three
 * separate ways that corrupts a run, all of them found by instrumenting rather
 * than guessing:
 *
 *   1. TELEPORT. `MatchSystem._resetPlayer()` calls `player.respawnAt(spawn)`
 *      at the top of every round. v2 warmed up with `time.scale = 20` for 140
 *      frames — 46 SECONDS of simulated time — which marches WARMUP -> FREEZE
 *      -> LIVE and fires round transitions in the middle of the walks. That is
 *      the "capsule finished ~20 m from where it started" anomaly: E1 ended at
 *      level x -8.4 with its centre at 13.5 because the match had yanked it to
 *      an attacker spawn. Nothing to do with the door.
 *   2. FROZEN FEET. `_setPhase` sets `player.movementLocked = phase === FREEZE`.
 *      Holding W during the freeze phase moves the player exactly nowhere, and
 *      every building under test reports NO for a reason that is not the map.
 *   3. DEAD PLAYER. With `ai.combatEnabled` true the bots shoot the subject
 *      mid-walk; death hands control to the spectator and the run is garbage.
 *
 * This version therefore stops the match's clock, unlocks the feet and clears
 * the bots BEFORE settling, and re-asserts all three before every single walk.
 *
 * It also refuses to report a bare YES/NO any more. Every walk prints where the
 * capsule STARTED, where it ENDED and the straight-line distance between them,
 * so a teleport is impossible to miss: a 1.8 s walk cannot exceed ~8.4 m at the
 * 4.57 m/s stand speed, and anything past the sprint-speed ceiling is flagged
 * TELEPORT and fails the run outright. A NO you cannot trust is worse than no
 * result at all.
 *
 * Two things are measured rather than assumed:
 *   - `respawnAt` snaps the feet to `physics.groundHeight()`. The tool asks for
 *     a spot and then checks where it actually landed, so a door placed over a
 *     prop or a raised slab shows up as a START DRIFT instead of silently
 *     poisoning the walk.
 *   - "Inside" is sampled EVERY FRAME of the walk, not only at the end. A
 *     player who walks in one door and out the far side has still proved the
 *     building is enterable; judging only the final rest position scored that
 *     as a failure. The deepest penetration reached is reported alongside.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  /** Split on the FIRST `=`: `--url=…/?seed=12` was truncated to `…/?seed`, so
   *  the gate measured seed 0 while reporting the seed it was given. */
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4173/';
const VERBOSE = !!args.verbose;

/** Stand speed is 4.57 m/s (src/player/tuning.js). Sprint is the hard ceiling
 *  the capsule can never beat while W alone is held, so use it as the teleport
 *  threshold — anything above it did not get there by walking. */
const SPRINT = 7.01;
/** Seconds of SIMULATED time each walk gets. 2.4 s * 4.57 = ~11 m: enough to
 *  cross the 3 m standoff, the 0.34 m wall and get well inside every footprint. */
const WALK_S = 2.4;

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const step = (n) => page.evaluate((n) => new Promise((r) => {
  let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

/**
 * Stop the game from interfering with the measurement. Called once before the
 * settle and again before every walk, because a single missed frame of LIVE is
 * enough to put a bullet in the subject.
 */
const quiesce = () => page.evaluate(() => {
  const e = window.__ENGINE__, c = e.ctx;
  const m = c.peek('match'), pl = c.peek('player'), ai = c.peek('ai');
  if (m) {
    // Freeze the round state machine where it stands. Overriding the instance
    // method is a harness-only change; nothing in src/match is touched.
    if (!m.__indoorcheckStopped) { m.update = () => {}; m.__indoorcheckStopped = true; }
    m.timer = Infinity; m.roundClock = Infinity;
  }
  if (ai) { ai.combatEnabled = false; try { ai.clearAgents(); } catch { /* ok */ } }
  if (pl) {
    pl.movementLocked = false;
    pl.setControlEnabled?.(true);
    if (pl.movement) { pl.movement.movementLocked = false; pl.movement.sprinting = false; }
    pl.alive = true;
  }
  c.peek('ui')?.banner?.hide?.();
});

await quiesce();
await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await step(90);
await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });
await quiesce();

const list = await page.evaluate(() => {
  const w = window.__ENGINE__.ctx.peek('world');
  const B = w.layout?.BUILDINGS;
  if (!B || !w.buildings) return null;
  return B.map((b, i) => ({
    id: b.id, enterable: !!b.enterable, x: b.x, z: b.z, w: b.w, d: b.d,
    doors: (w.buildings[i]?.doors ?? []).map((d) => ({ side: d.side, wp: d.wp })),
  })).filter((b) => b.enterable);
});
if (!list) {
  console.log('[indoorcheck] world does not expose layout/buildings');
  await browser.close(); process.exit(2);
}

/**
 * One walk. Places the capsule 3 m outside `door` on the line from the building
 * centre, faces it in, holds W for WALK_S seconds of simulated time and samples
 * the footprint test every frame.
 */
async function walk(b, door) {
  await quiesce();
  const start = await page.evaluate(([b, door]) => {
    const e = window.__ENGINE__, pl = e.ctx.peek('player'), w = e.ctx.peek('world');
    const V = e.ctx.camera.position.constructor;
    /**
     * `doors[].wp` is LEVEL space, not world.
     *
     * It comes from `worldOf(pm, …)` in src/world/kit.js, whose name says world
     * but whose docstring says "transform a panel-space point to LEVEL space" —
     * and it is the docstring that is right, because `panelMatrix` is composed
     * straight out of `spec.x/spec.z`, which are the level coordinates in
     * layout.js. The level is then yaw-rotated into the world by `A.xform`.
     *
     * v2 of this tool took `wp` at its name and subtracted it from a genuine
     * world-space centre (`levelToWorld(b.x,0,b.z)`). Mixing the two spaces
     * yields a nonsense bearing and a nonsense standoff point, so the capsule
     * was dropped at a random spot — usually flat against some other wall — and
     * then walked into it. That is why every building moved 0 m.
     *
     * So do the geometry entirely in LEVEL space, where the footprint test also
     * lives, and convert to world exactly once at the end.
     */
    const dl = new V(door.wp[0], door.wp[1], door.wp[2]);
    /**
     * Approach along the FACE NORMAL, square to the door.
     *
     * Standing off on the line from the building centroid instead means that
     * every door which is not dead centre of its face is approached at an
     * angle — W2's side-3 door is bay 0 of three, so that line crosses the
     * threshold at about 25°. A 1.12 m opening in a 0.34 m thick wall presents
     * about 1.0 m at that incidence and the capsule catches a jamb and slides
     * along the facade, which scored a perfectly good door as sealed. A player
     * walks AT a door, not at the middle of the building, so square is both the
     * fairer test and the more realistic one. The result is still the real
     * controller going through the real opening and having to finish inside.
     */
    const OUT = [[0, -1], [1, 0], [0, 1], [-1, 0]][door.side];
    const outL = new V(dl.x + OUT[0] * 3, 0, dl.z + OUT[1] * 3);
    const wantW = w.levelToWorld(outL.x, dl.y + 0.2, outL.z, new V());
    const centreW = w.levelToWorld(dl.x, 0, dl.z, new V()); // aim through the door
    pl.respawnAt({ x: wantW.x, y: wantW.y, z: wantW.z });
    // movement.yaw is the basis; forward is (-sin yaw, -cos yaw). There is no
    // setYaw() — writing player.yaw alone does nothing, which is what made the
    // first run of this tool meaningless. The yaw is a WORLD yaw.
    const yaw = Math.atan2(-(centreW.x - wantW.x), -(centreW.z - wantW.z));
    pl.movement.yaw = yaw; pl.yaw = yaw;
    const q = pl.position ?? e.ctx.camera.position;
    const l = w.worldToLevel(q.x, q.y, q.z, new V());
    return {
      // how far respawnAt moved us from the spot we asked for: it snaps the
      // feet to physics.groundHeight(), so a door over a prop shows up here
      drift: Math.hypot(q.x - wantW.x, q.z - wantW.z),
      wantLvl: [+outL.x.toFixed(1), +outL.z.toFixed(1)],
      lvl: [+l.x.toFixed(1), +l.z.toFixed(1)], y: +q.y.toFixed(2),
    };
  }, [b, door]);

  /**
   * Press W and PROVE the game saw it.
   *
   * `Input.beginFrame` drains `_pendingDown` BEFORE `_pendingUp`:
   *
   *     for (const c of this._pendingDown) if (!this.down.has(c)) this.down.add(c);
   *     for (const c of this._pendingUp)   if (this.down.delete(c)) …
   *     this._pendingDown.clear(); this._pendingUp.clear();
   *
   * so a keyup and a keydown that land in the SAME engine frame annihilate: the
   * code is added, then deleted, then both queues are cleared. A human can never
   * type fast enough to hit that, but this harness released W at the end of one
   * walk and pressed it again microseconds later, which coalesced constantly.
   * The key silently stayed un-held and EVERY building after the first reported
   * "cannot get in" while the capsule simply stood there. That is precisely the
   * untrustworthy NO this tool exists to prevent, so the press is now separated
   * by real frames AND verified — if W is not held, the walk is reported INVALID
   * rather than being scored as a failure of the map.
   */
  await step(4);
  await page.keyboard.down('KeyW');
  await step(3);
  const held = await page.evaluate(() => window.__ENGINE__.ctx.input.down.has('KeyW'));
  if (!held) {
    await page.keyboard.up('KeyW'); await step(6);
    await page.keyboard.down('KeyW'); await step(3);
  }
  const res = await page.evaluate(([b, secs]) => new Promise((done) => {
    const e = window.__ENGINE__, c = e.ctx;
    const pl = c.peek('player'), w = c.peek('world');
    const V = c.camera.position.constructor;
    const tmp = new V();
    const t0 = c.time.elapsed;
    const p0 = pl.position ?? c.camera.position;
    const s = { x: p0.x, z: p0.z };
    // margin: how far INSIDE the footprint edge the capsule got. Positive means
    // properly indoors, not merely standing in the door reveal.
    let best = -Infinity, everIn = false, frames = 0, heldFrames = 0;
    const tick = () => {
      const q = pl.position ?? c.camera.position;
      const l = w.worldToLevel(q.x, q.y, q.z, tmp);
      const mx = b.w / 2 - Math.abs(l.x - b.x);
      const mz = b.d / 2 - Math.abs(l.z - b.z);
      const margin = Math.min(mx, mz);
      if (margin > best) best = margin;
      if (margin > 0.3) everIn = true;
      frames++;
      // The stimulus is part of the measurement: a walk during which W was not
      // actually held proves nothing about the building.
      if (c.input.down.has('KeyW')) heldFrames++;
      if (c.time.elapsed - t0 >= secs) {
        const l2 = w.worldToLevel(q.x, q.y, q.z, new V());
        return done({
          everIn, best: +best.toFixed(2), frames, heldFrames,
          sim: +(c.time.elapsed - t0).toFixed(2),
          dist: +Math.hypot(q.x - s.x, q.z - s.z).toFixed(1),
          end: [+l2.x.toFixed(1), +l2.z.toFixed(1)], endY: +q.y.toFixed(2),
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), [b, WALK_S]);
  await page.keyboard.up('KeyW');
  return {
    ...start, ...res,
    teleport: res.dist > SPRINT * res.sim + 1,
    // W must have been held for essentially the whole walk for the result to mean anything
    invalid: res.heldFrames < res.frames * 0.9,
  };
}

const rows = [];
for (const b of list) {
  const tries = [];
  // Every door, not just until one works. A building with a usable back door
  // still passes, but a front door nobody can walk through is a map defect and
  // stopping early hid four of them.
  for (const door of b.doors) {
    const r = await walk(b, door);
    tries.push({ ...r, side: door.side });
  }
  rows.push({ id: b.id, doors: b.doors.length, entered: tries.some((t) => t.everIn),
              tries, centre: [b.x, b.z] });
}

console.log('\n  building  in?   door  start(lvl)        end(lvl)          moved   maxDepth  sim');
let fail = 0, ports = 0, drifts = 0, bad = 0;
for (const r of rows) {
  if (!r.entered) fail++;
  for (const t of r.tries) {
    if (t.teleport) ports++;
    if (t.drift > 1.0) drifts++;
    if (t.invalid) bad++;
    const flag = t.invalid ? ` <-- INVALID: W held ${t.heldFrames}/${t.frames} frames`
      : t.teleport ? ' <-- TELEPORT' : t.drift > 1.0 ? ` <-- START DRIFT ${t.drift.toFixed(1)}m` : '';
    console.log(
      `  ${r.id.padEnd(9)} ${(t.everIn ? 'YES' : 'NO ')}   s${t.side}   ` +
      `[${String(t.lvl[0]).padStart(6)},${String(t.lvl[1]).padStart(6)}]  ` +
      `[${String(t.end[0]).padStart(6)},${String(t.end[1]).padStart(6)}]  ` +
      `${String(t.dist).padStart(5)}m  ${String(t.best).padStart(7)}m  ${t.sim}s${flag}`
    );
  }
  if (!r.entered) console.log(`  ${' '.repeat(9)}      ^ CANNOT GET IN — centre ${r.centre}, ${r.doors} door(s)`);
}
const doorsTotal = rows.reduce((n, r) => n + r.tries.length, 0);
const doorsShut = rows.reduce((n, r) => n + r.tries.filter((t) => !t.everIn).length, 0);
console.log(`\n  doors that pass a player: ${doorsTotal - doorsShut}/${doorsTotal}`);
if (VERBOSE) console.log('\n[indoorcheck] raw', JSON.stringify(rows, null, 1));
if (errs.length) console.log('\n[indoorcheck] page errors', errs.slice(0, 4));
if (ports) console.log(`\n[indoorcheck] ${ports} walk(s) TELEPORTED — results untrustworthy, fix the harness`);
if (bad) console.log(`\n[indoorcheck] ${bad} walk(s) INVALID — the keypress never reached the game, fix the harness`);
if (drifts) console.log(`[indoorcheck] ${drifts} walk(s) started >1 m from the requested spot`);
console.log(fail ? `\n[indoorcheck] FAIL — ${fail}/${rows.length} enterable buildings cannot be entered`
                 : `\n[indoorcheck] PASS — all ${rows.length} enterable buildings can be walked into`);
await browser.close();
process.exit(fail || ports || bad || errs.length ? 1 : 0);
