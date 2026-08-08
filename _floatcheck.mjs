/**
 * IS ANY OF THE RUBBLE STANDING ON NOTHING?
 *
 *   node _floatcheck.mjs [--url=…] [--region=cath|demo|all] [--seed=N]
 *                        [--grid=0.5] [--tol=0.6] [--min=2] [--json]
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS
 * ────────────────────────────────────────────────────────────────────────────
 * 「大聖堂爆破すると空中に瓦礫が浮いてます しかも物理判定あるので戦車が空中に登って
 *  しまいますよ？？？」
 *
 * This class of defect has been found and half-fixed twice ("portal arches
 * hanging in the sky", "too many floating timbers"), BOTH TIMES BY LOOKING AT
 * SCREENSHOTS. The eyeball method demonstrably misses some: a mass 20 m up over
 * the middle of a 45 m ruin is only visible from an angle nobody photographed,
 * and every one of these bugs is INVISIBLE from the one place a human naturally
 * stands, which is on the ground under it.
 *
 * So this is the tool that should have existed the first time, and it does not
 * look at anything. It reconstructs the SOLID INTERVALS of the physics world
 * over a lattice and asks one question of every one of them: is there anything
 * underneath?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW — AND WHY IT IS NOT "CAST A RAY DOWN FROM EACH CHUNK"
 * ────────────────────────────────────────────────────────────────────────────
 * A per-piece downward ray is the obvious probe and it is wrong in both
 * directions. It FALSE-POSITIVES on every voussoir of a standing arch, every
 * balcony, every gallery deck and every roof — none of which has anything
 * directly beneath it and all of which are held up perfectly well from the
 * side. And it FALSE-NEGATIVES on a floating pile whose own lower half happens
 * to be under its own upper half.
 *
 * "Supported" is a question about CONNECTIVITY, not about what is directly
 * below one point, so this probe answers it as one:
 *
 *   1. COLUMNS. Over a lattice, CUT the world with a vertical line and keep the
 *      exact list of solid intervals on it. Not a ray walk — `queryAabb` over a
 *      hair-thin vertical box, every triangle it returns crossed against the
 *      line, depth counted off `nrm.y`. @see the note on the `column` function
 *      for why a closest-hit ray cannot do this on a map of flush-stacked boxes
 *      and reported four-storey buildings as parapets with nine metres of
 *      daylight under them.
 *   2. THE WORLD. An interval whose UNDERSIDE is at or below `--ground` metres
 *      is standing on the map: the terrain, a foundation, a wall, a heap of
 *      rubble on the tile. It is a seed and it is never anything else.
 *   3. A GRAPH OVER WHAT IS LEFT. One node per interval that is entirely ABOVE
 *      that plane. Lateral edges join two of them in neighbouring columns whose
 *      Y ranges overlap — the same piece, sampled twice.
 *   4. SUPPORT. A node is supported when the next solid down in its own column
 *      is within `--tol` of its underside, OR when a neighbouring column's
 *      GROUND-standing mass comes up to at least that underside. The second
 *      clause is what tells a roof or a balcony — nothing under it at all, held
 *      up perfectly well by the wall beside it — from a mass in the sky.
 *   5. AND THE WINDOW IS NOT THE WORLD. Every region below is a small frame
 *      chosen so it does not take in the neighbours' roofs, so a piece can run
 *      out of one — and then the support question was being asked of a fragment.
 *      An unsupported piece touching the edge of its frame is FOLLOWED off it,
 *      columns cut on demand, before it is judged. @see the note on the growth
 *      pass. `--grow=0` turns it off.
 *   6. A component with no supported node in it is standing on nothing. That is
 *      the bug, and it is reported with its extent, its height and the metres of
 *      open air under it.
 *
 * THE ONE RULE THAT MATTERS IS THAT A SKY NODE NEVER JOINS A GROUND NODE
 * LATERALLY, and it is not fastidiousness. A column that loses a face produces a
 * single interval running from the top of the rubble all the way into the
 * terrain — which, under plain Y-overlap linking, welds the sky to the ground
 * and the sweep comes back clean. That is exactly what the first version of this
 * file did on the bug it was written for: 16 900 columns, ONE component, "OK",
 * with a solid mass sitting 7.2 m up in open air inside it.
 *
 * An arch passes (its jambs are ground nodes and the voussoirs rest on them). A
 * cathedral vault 20 m up over a razed footprint does not, and neither does a
 * chunk of airstrike rubble that settled onto a roof that has since stopped
 * existing.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IT SWEEPS
 * ────────────────────────────────────────────────────────────────────────────
 *   --region=cath  the cathedral footprint plus its rubble apron, and it is run
 *                  against `?cath=down` so the shell really is gone.
 *   --region=demo  every `world.demolitions` block's own footprint, against
 *                  `?demo=down`.
 *   --region=strike each authored strike site's own settled mound, fired.
 *   --region=breach every `world.breaches` opening and the rubble spilling
 *                  through it, against `?breach=down`. A PARTIAL state and the
 *                  only one on this list where most of the building is still
 *                  standing, so the region is the hole and its spill rather than
 *                  a footprint: the house's own upper storeys are ground-standing
 *                  mass and must not be swept as candidates for floating.
 *   --region=all   all four.
 *
 * …and every region is only HALF the sweep. The regions above are what the
 * COLLISION half looks at; the DRAWN half at the foot of this file is not
 * region-scoped at all, because picture-only mass is not confined to a
 * footprint — the bomber and the fighter walk theirs down 68 m of street. It
 * runs on every invocation. @see "THE SECOND HALF OF THE QUESTION".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * --fire, AND WHY THE BOOT FLAGS ARE NOT ENOUGH ON THEIR OWN
 * ────────────────────────────────────────────────────────────────────────────
 * `?cath=down` swaps `world`'s own two cached forms and nothing else. THE
 * AIRSTRIKE CHUNKS ARE NOT WORLD GEOMETRY — the three `CATH-*` sites are masses
 * `src/match/airstrike.js` cut off the aisle roof, and they only exist in their
 * settled pose after the event has actually run. A sweep of `?cath=down` is
 * therefore a sweep of half the ruin, and it is exactly the half that was
 * already known to be fine.
 *
 *   --fire=cath   run the real collapse — and RUN IT AS THE SCHEDULE RUNS IT.
 *                 It holds the round clock and the win check open, lets
 *                 `_matchProgress` carry the match to `cathedralOpenProgress`,
 *                 and waits for the state the beat sheet leaves: razed, with
 *                 every cathedral site baked. It used to force the beats — set
 *                 `_cathedralCalled`, call the salvo and `_razeCathedral()` on
 *                 ONE frame — which made `world`'s ruin solid before a chunk had
 *                 left the wall and so came back clean by construction. That is
 *                 how this gate passed four boot states while the player was
 *                 looking at the bug. @see `_cathwatch.mjs`.
 *   --fire=all    the above plus `callEverything` — every site and every
 *                 district block — plus every bomber and every strafing run,
 *                 fired one at a time and waited out, so the DRAWN sweep below
 *                 judges the settled pose of all eight lines over the ruin
 *                 instead of whichever ones the scheduler's dice happened to
 *                 pick. @see the note where they are fired.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND NONE OF THE ABOVE IS THE MAP — @see "THE THIRD HALF" AT THE FOOT
 * ────────────────────────────────────────────────────────────────────────────
 * Every region named above is a footprint somebody remembered to publish, and
 * this gate reported "OK — every solid in the sweep is connected to the ground"
 * on a build with a concrete slab, a kerb, nine oil drums, a pump post and a
 * sign hanging 40 m in the air 14 m outside the nearest one. So there is now a
 * third pass that is scoped to NOTHING: it bins every drawn triangle on the
 * whole playable disc and asks the same support question of every column.
 * `--disc=0` turns it off, `--disc=N` sets the radius. It is the pass that
 * answers "is anything on this map standing on nothing"; the region passes
 * answer "is this ruin sound", which is a different and narrower question.
 *
 * Exit code 1 if anything floats — a solid mass standing on nothing, a drawn
 * instance hanging in clear sky, OR an orphan cluster anywhere on the disc.
 * `?seed=N` pins the level dice, so a find is reproducible: the seed of the
 * boot is printed either way.
 */
import { chromium } from 'playwright';

/**
 * Split on the FIRST `=` only. The destructured `split('=')` truncated any
 * value holding a second one, so `--url=…/?map=plains` measured `…/?map` —
 * which `getLevel` falls back to the TOWN for, silently, and this gate then
 * swept the town's cathedral apron while reporting itself as the plain's.
 * `tools/stuckcheck.mjs` carries the same fix for the same reason.
 */
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
  })
);
const BASE = args.url ?? 'http://127.0.0.1:4275/';
const REGION = args.region ?? 'cath';
const GRID = Number(args.grid ?? 0.5);
/** Metres of open air under a mass before it is a bug rather than a joint. */
const TOL = Number(args.tol ?? 0.6);
/** Lattice cells a component must cover to be worth a line. One cell of a
 *  0.5 m lattice is a 0.25 m² sliver and every ruin on this map has a few. */
const MIN_CELLS = Number(args.min ?? 2);
/** Metres over a region's own floor under which a solid IS the ground. */
const GROUND = Number(args.ground ?? 2.0);
/** Column-neighbours that must carry standing mass up to a piece's underside. */
const NEED_ATTACH = Number(args.attach ?? 1);
/** Metres of apron round a footprint, so the mound in the street is swept too. */
const APRON = Number(args.apron ?? 6.0);
/** Columns a truncated piece may be followed for, off the edge of its window.
 *  0 turns the growth pass off and judges every piece on the frame it fell in. */
const GROW = Number(args.grow ?? 2000);
const SEED = args.seed;
/** '' | 'cath' | 'all' — run the real event instead of the boot flag. */
const FIRE = args.fire === true ? 'cath' : (args.fire ?? '');

/** The flags each region needs so the thing it measures has actually happened. */
const FLAGS = {
  cath: ['cath=down'],
  demo: ['demo=down'],
  strike: [],
  breach: ['breach=down'],
  all: ['cath=down', 'demo=down', 'breach=down'],
};

/**
 * `--down=none` sweeps the SAME REGIONS on the INTACT map, and it is a state
 * worth gating: the down-flags are the only reason a plot is empty, so a mass
 * that floats with every building still standing is one no demolition has
 * touched. `--down=cath,breach` picks the set by hand. Named by EVENT and not
 * by query string because the argument parser splits on `=`.
 */
const FLAG_OVERRIDE = args.down === undefined
  ? null
  : (args.down === 'none' || args.down === true
      ? []
      : String(args.down).split(',').map((s) => `${s}=down`));

function url(region) {
  // With --fire the events do the work; booting already-down would put the
  // shell away before the strike that is supposed to knock it down.
  const q = FIRE ? [] : [...(FLAG_OVERRIDE ?? FLAGS[region] ?? [])];
  if (SEED !== undefined) q.push(`seed=${SEED}`);
  return q.length ? `${BASE}${BASE.includes('?') ? '&' : '?'}${q.join('&')}` : BASE;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(url(REGION), { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const levelSeed = await page.evaluate(() => window.__ENGINE__?.levelSeed ?? null);

/* ---- drive the real event, if asked -------------------------------------- */
let fired = null;
if (FIRE) {
  // Let the match START on its own: WARMUP -> FREEZE -> LIVE is what puts men
  // on the map, and forcing the phase skips `_beginRound`. @see `_postcheck.mjs`.
  await page.evaluate(() => (window.__ENGINE__.time.scale = 8));
  await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 180000 });
  await sleep(400);
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * THE SCHEDULE PLAYS IT. THIS ONLY KEEPS THE MATCH ALIVE LONG ENOUGH.
   * ──────────────────────────────────────────────────────────────────────────
   * This used to set `_cathedralCalled`, call the salvo and `_razeCathedral()`
   * ON ONE FRAME, which is not a path anything in the game ever takes and it
   * MASKED THE BUG THIS FLAG EXISTS TO FIND: razing the shell on the fire frame
   * makes `world`'s ruin solid before a single chunk has left the wall, so every
   * settled pose lands on ground and the sweep is clean by construction.
   *
   * What the player plays is `_updateCathedralEvent`'s beat sheet, where the
   * salvo goes at `cathedralLead` and the shell only follows
   * `cathedralRazeDelay` later — and a site fired by ANYTHING ELSE in between
   * drops its mass onto a ruin that is neither drawn nor solid yet. That was
   * measured (`_cathwatch.mjs`): the `CATHEDRAL` demolition site was not
   * `scheduled`, `_scheduleNext`'s weighted draw took it at t=211.4 s, and the
   * event began at t=216 s with 2151 chunks already hanging over a floor.
   *
   * So: hold the clock and the win check open, let progress carry the match to
   * `cathedralOpenProgress`, and wait for the state the beat sheet leaves —
   * razed, and every cathedral site baked.
   */
  await page.evaluate(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    m.roundClock = 1e6;
    m._checkWinConditions = () => {};
    m.airstrike.enabled = true;
    window.__ENGINE__.time.scale = 8;
  });
  await page.waitForFunction("window.__ENGINE__.ctx.peek('match')._cathedralCalled===true", null, { timeout: 300000 });
  await page.evaluate(() => (window.__ENGINE__.time.scale = 4));
  /**
   * `_bakeSettled` is what turns a mound's collision on, so a sweep run before
   * it has fired measures a map the event has not finished happening to. EVERY
   * CATHEDRAL SITE, NOT THREE OF THEM: the raze brings a fourth down with the
   * shell — the building's own 2151-chunk mass — and a wait that counted to
   * three returned while it was still in the air.
   */
  await page.waitForFunction(
    () => {
      const e = window.__ENGINE__;
      const cath = e.ctx.peek('match').airstrike.sites.filter((x) => /^CATH/.test(x.id));
      return (
        e.ctx.peek('world').cathedral?.razed === true &&
        cath.length >= 4 &&
        cath.every((x) => x.struck && x.baked)
      );
    },
    null,
    { timeout: 300000 }
  );
  if (FIRE === 'all') {
    await page.evaluate(() => {
      const m = window.__ENGINE__.ctx.peek('match');
      m._finalCalled = true;
      m.airstrike.callEverything(0.4);
    });
    await sleep(9000);
    /**
     * ──────────────────────────────────────────────────────────────────────
     * …AND EVERY DRAWN-ONLY RUN, ONE AT A TIME, OVER THE RUIN
     * ──────────────────────────────────────────────────────────────────────
     * `callEverything` is the AIRSTRIKE's own list. The bomber and the fighter
     * are on their own weighted schedulers with a per-round cap, so which of
     * their eight lines have flown by the time the cathedral comes down is a
     * DIE ROLL — and the two that matter most are the two that cross the
     * church. A gate whose coverage depends on the dice is a gate that will
     * one day be green for the wrong reason.
     *
     * The sweep below reads what is DRAWN, so an unflown run is still swept
     * (its buried rest pose is on screen from boot and 34 of the instances in
     * the photograph were exactly that). Firing them anyway is what puts the
     * SETTLED pose of all eight lines over the razed map, which is the state
     * the complaint is about. Fired serially, with the schedulers stood down so
     * nothing else joins in, and each one waited out to `settled`.
     */
    await page.evaluate(() => {
      const m = window.__ENGINE__.ctx.peek('match');
      m.airstrike.enabled = false;
      if (m.bomber) m.bomber.enabled = false;
      if (m.strafe) m.strafe.enabled = false;
    });
    for (const sys of ['bomber', 'strafe']) {
      const ids = await page.evaluate(
        (s) => (window.__ENGINE__.ctx.peek('match')[s]?.runs ?? []).map((r) => r.id),
        sys
      );
      for (const id of ids) {
        const lit = await page.evaluate(([s, i]) => {
          const sy = window.__ENGINE__.ctx.peek('match')[s];
          return !!(sy && !sy.flown(i) && sy.fire(i));
        }, [sys, id]);
        if (!lit) continue;
        await page.waitForFunction(
          (s) => !window.__ENGINE__.ctx.peek('match')[s].busy,
          sys,
          { timeout: 120000 }
        );
      }
    }
  }
  await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
  await sleep(1200);
  fired = await page.evaluate(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    return {
      razed: window.__ENGINE__.ctx.peek('world').cathedral?.razed ?? null,
      struck: m.airstrike.sites.filter((s) => s.struck).length,
      settled: m.airstrike.sites.filter((s) => s.baked).length,
      total: m.airstrike.sites.length,
    };
  });
}

/* -------------------------------------------------------------------------- */

const result = await page.evaluate(
  ({ REGION, GRID, TOL, MIN_CELLS, GROUND, APRON, NEED_ATTACH, GROW }) => {
    const e = window.__ENGINE__;
    const ph = e.ctx.peek('physics');
    const w = e.ctx.peek('world');
    const MASK = ph.MASK.WORLD;

    /**
     * THE FOOTPRINTS TO SWEEP, IN THEIR OWN FRAMES.
     *
     * A world-axis bounding square round a 30x45 m building rotated by
     * `world.levelYaw` is 65 m on a side and takes in whole city blocks — every
     * balcony and roof slab in them then reads as an unsupported mass, because
     * a roof IS one and its wall is a column the sweep never links it to. So a
     * region is a CENTRE, a HALF-EXTENT and the level's own two axes, and a
     * column is placed by rotating the offset out of that frame.
     */
    const regions = [];
    const k = w.cathedral;
    if (k && (REGION === 'cath' || REGION === 'all')) {
      const vol = w.interiorVolumes.find((v) => v.building === k.id);
      regions.push({
        id: 'CATHEDRAL',
        cx: vol?.cx ?? 0, cz: vol?.cz ?? 0,
        c: vol?.c ?? 1, s: vol?.s ?? 0,
        hw: k.hw + APRON, hd: k.hd + APRON,
        floorY: k.floorY ?? 0,
      });
    }
    /**
     * THE STRIKE MOUNDS. Eleven authored sites, each of which parks a solid
     * proxy where its rubble ends up — and where that is depends on one boot
     * probe over a street that is not always empty at the height the ray is
     * fired from. Small regions, because the mound is small and the buildings
     * either side of it are somebody else's balconies.
     */
    if (REGION === 'strike' || REGION === 'all') {
      for (const s of (window.__ENGINE__.ctx.peek('match')?.airstrike?.sites ?? [])) {
        if (s.demo) continue;
        const yaw = w.levelYaw ?? 0;
        regions.push({
          id: s.id,
          cx: s.mound.x, cz: s.mound.z,
          c: Math.cos(yaw), s: Math.sin(yaw),
          hw: s.moundR + 1.5, hd: s.moundR + 1.5,
          floorY: 0,
        });
      }
    }
    if (REGION === 'demo' || REGION === 'all') {
      for (const d of w.demolitions ?? []) {
        const yaw = w.levelYaw ?? 0;
        regions.push({
          id: d.id,
          cx: d.position.x, cz: d.position.z,
          c: Math.cos(yaw), s: Math.sin(yaw),
          /**
           * A TIGHTER APRON THAN THE CATHEDRAL'S, because a razed block has an
           * intact one next door. The cathedral needs six metres — its mounds
           * land in the flank street — and a district block's rubble stays on
           * its own plot, so anything further out is somebody's balcony.
           */
          hw: d.halfW + 2.0, hd: d.halfD + 2.0,
          floorY: 0,
        });
      }
    }
    /**
     * THE BREACHED WALLS. `src/world/breach.js` takes one ground-storey
     * elevation off a cache house and leaves the storeys above it standing on
     * two jambs, so this is the one region on the list that is a PIECE of a
     * building rather than a plot. Everything the damaged form authors is either
     * solid and on the ground (the spill, which is the ramp over the plinth) or
     * carries no proxy at all (the teeth, the fallen panels, the loose lumps) —
     * and "carries no proxy" is exactly the claim this sweep is here to check,
     * because the spandrel over the hole IS solid and IS held up from the side.
     *
     * The extent is the opening plus its spill, taken off the published `side`
     * and `holeW`; the apron is generous enough to catch a panel thrown clear
     * and tight enough to stay off the neighbour's balcony.
     */
    if (REGION === 'breach' || REGION === 'all') {
      const APRON_B = 4.6;
      for (const b of w.breaches ?? []) {
        const yaw = w.levelYaw ?? 0;
        const alongX = b.side === 0 || b.side === 2;
        regions.push({
          id: b.id,
          cx: b.position.x, cz: b.position.z,
          c: Math.cos(yaw), s: Math.sin(yaw),
          hw: (alongX ? b.holeW / 2 + 1.6 : APRON_B),
          hd: (alongX ? APRON_B : b.holeW / 2 + 1.6),
          floorY: 0,
        });
      }
    }
    if (!regions.length) return { error: 'no region' };

    /* ---- one column of solid intervals ------------------------------- */
    const TOP = 44;
    /** Well under any floor on this map, so "the world" is unbounded below. */
    const BOTTOM = -6;
    let anomalies = 0;

    /**
     * ────────────────────────────────────────────────────────────────────────
     * THE COLUMN IS CUT OUT OF THE BVH, NOT WALKED WITH A RAY
     * ────────────────────────────────────────────────────────────────────────
     * A closest-hit ray cannot reconstruct this world's solids, and it is not a
     * question of nudge size or of how closure is defined. `physics.raycast`
     * returns ONE hit and the walk has to restart past it, so of two faces
     * SHARING A PLANE exactly one is ever seen — and this map is built out of
     * boxes stacked flush. A four-storey building's column really comes back:
     *
     *     10.43 FRONT   parapet top
     *      9.55 back    parapet underside — and the storey top under it is lost
     *      6.50 back    storey 3 underside, its partner top lost
     *      3.45 back    storey 2 underside, its partner top lost
     *      0.42 FRONT   the kerb
     *
     * Under any front-opens/back-closes rule that is one solid from 10.43 to
     * 9.55 and then NINE METRES OF DAYLIGHT under a standing building. That is
     * where the "9 floating masses" on the intact map came from: they were the
     * intact buildings. Depth counting is no better — it sees three exits and no
     * entries and drives the depth negative.
     *
     * So the faces are taken from the BVH directly. `queryAabb` over a hair-thin
     * vertical box returns EVERY triangle whose own box straddles this (x, z) —
     * coincident planes and all, nothing culled by being the second-closest —
     * and the exact crossing height of each comes from the plane it lies in.
     * With the whole multiset in hand, depth counting is exact: `nrm.y > 0` is a
     * surface being entered on the way down and `nrm.y < 0` one being left, a
     * solid runs from 0 -> 1 to 1 -> 0, and flush-stacked storeys read as the
     * one continuous solid they are. Vertical faces never cross a vertical line
     * and are skipped; a single-sided upward surface (the terrain) opens and
     * never closes, which is exactly "the ground".
     *
     * It is also four times fewer queries than the ray walk it replaces.
     */
    const sw = ph.staticWorld;
    const EPS = 1e-4;
    /** Crossing heights and their winding, filled per column. */
    const cy = [];
    const cw = [];
    const ord = [];
    const column = (x, z, out) => {
      out.length = 0;
      cy.length = 0;
      cw.length = 0;
      const n = sw.queryAabb(x - EPS, BOTTOM, z - EPS, x + EPS, TOP, z + EPS, MASK);
      if (!n) return out;
      const cand = sw.candidates;
      const pos = sw.pos;
      const nrm = sw.nrm;
      for (let c = 0; c < n; c++) {
        const t = cand[c];
        const ny = nrm[t * 3 + 1];
        // A vertical face never crosses a vertical line, and its XZ projection
        // is a segment: no crossing to compute and no winding to count.
        if (ny > -1e-6 && ny < 1e-6) continue;
        const p = t * 9;
        const ax = pos[p], ay = pos[p + 1], az = pos[p + 2];
        const bx = pos[p + 3], by = pos[p + 4], bz = pos[p + 5];
        const gx = pos[p + 6], gy = pos[p + 7], gz = pos[p + 8];
        // Barycentric of (x, z) in the triangle's XZ projection.
        const v0x = bx - ax, v0z = bz - az;
        const v1x = gx - ax, v1z = gz - az;
        const den = v0x * v1z - v1x * v0z;
        if (den > -1e-12 && den < 1e-12) continue;
        const px = x - ax, pz = z - az;
        const u = (px * v1z - v1x * pz) / den;
        if (u < 0 || u > 1) continue;
        const v = (v0x * pz - px * v0z) / den;
        if (v < 0 || u + v > 1) continue;
        cy.push(ay + u * (by - ay) + v * (gy - ay));
        cw.push(ny > 0 ? 1 : -1);
      }
      if (!cy.length) return out;
      ord.length = cy.length;
      for (let i = 0; i < cy.length; i++) ord[i] = i;
      /**
       * Down the column, and AT A SHARED PLANE THE ENTRY IS TAKEN FIRST. Two
       * boxes flush on one plane give an exit and an entry at the same height;
       * entry-first keeps the depth at 1 through it and reads them as the one
       * solid they are, where exit-first would close and reopen and leave a
       * zero-metre "gap" for the joint test to have an opinion about.
       */
      ord.sort((i, j) => cy[j] - cy[i] || cw[j] - cw[i]);
      let depth = 0;
      let top = 0;
      for (let k = 0; k < ord.length; k++) {
        const i = ord[k];
        const before = depth;
        depth += cw[i];
        if (depth < 0) { anomalies++; depth = 0; continue; }
        if (before === 0 && depth === 1) top = cy[i];
        else if (before === 1 && depth === 0) out.push(top, cy[i]);
      }
      // Never closed: whatever this is, it reaches the bottom of the sweep.
      if (depth > 0) out.push(top, BOTTOM);
      return out;
    };

    /* ---- sweep every region, keeping only what is off the ground ----- */
    const nodes = []; // one per solid interval ENTIRELY above the ground plane
    const index = new Map(); // `${r}:${ix}:${iz}` -> [nodeIds]
    /** `${r}:${ix}:${iz}` -> the top of the tallest GROUND interval there. */
    const stand = new Map();
    /**
     * WHERE A LATTICE CELL IS, AND IT IS JITTERED OFF THE LATTICE.
     *
     * A ray fired exactly down a shared edge between two boxes can hit one face
     * and miss its partner, and the reconstruction then never closes — the piece
     * fuses to the terrain and reads as standing on it. On a 0.5 m lattice over
     * a map built out of boxes that alignment is not rare, it is systematic. A
     * fixed hash of the cell index moves each column a fifth of a cell off the
     * grid, which costs nothing and is still the same sweep on every run.
     *
     * Defined for ANY integer index, inside the window or outside it, because
     * the growth pass below walks off the edge of the region on purpose.
     */
    const cellH = (b, ix, iz) => ((ix * 73856093) ^ (iz * 19349663) ^ (b * 83492791)) >>> 0;
    const cellU = (rg, b, ix, iz) =>
      -rg.hw + (ix + 0.5) * GRID + (((cellH(b, ix, iz) & 1023) / 1023) - 0.5) * GRID * 0.4;
    const cellV = (rg, b, ix, iz) =>
      -rg.hd + (iz + 0.5) * GRID + ((((cellH(b, ix, iz) >>> 10) & 1023) / 1023) - 0.5) * GRID * 0.4;
    const cellX = (rg, b, ix, iz) =>
      rg.cx + cellU(rg, b, ix, iz) * rg.c + cellV(rg, b, ix, iz) * rg.s;
    const cellZ = (rg, b, ix, iz) =>
      rg.cz - cellU(rg, b, ix, iz) * rg.s + cellV(rg, b, ix, iz) * rg.c;
    const tmp = [];
    let rays = 0;
    let intervals = 0;
    let groundNodes = 0;
    /** Columns cut outside a window while following a piece off the edge. */
    let grownColumns = 0;
    /** Pieces the two look-again passes cleared, and by which. */
    let followed = 0;
    let refined = 0;
    const t0 = performance.now();

    for (let b = 0; b < regions.length; b++) {
      const rg = regions[b];
      const groundY = rg.floorY + GROUND;
      const nx = (rg.nx = Math.max(1, Math.round((rg.hw * 2) / GRID)));
      const nz = (rg.nz = Math.max(1, Math.round((rg.hd * 2) / GRID)));
      for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
          const x = cellX(rg, b, ix, iz);
          const z = cellZ(rg, b, ix, iz);
          column(x, z, tmp);
          if (!tmp.length) continue;
          rays += tmp.length;
          intervals += tmp.length / 2;
          const ids = [];
          /** The highest thing in this column that IS standing on the map. */
          let stands = -Infinity;
          for (let i = 0; i < tmp.length; i += 2) {
            const top = tmp[i];
            const bot = tmp[i + 1];
            // THE WORLD. Anything whose underside reaches the ground plane is
            // standing on the map and is never a candidate — and, critically,
            // is never a lateral neighbour either. @see the note in the header.
            if (bot <= groundY) {
              groundNodes++;
              if (top > stands) stands = top;
              continue;
            }
            const below = i + 2 < tmp.length ? tmp[i + 2] : BOTTOM;
            ids.push(nodes.length);
            nodes.push({
              b, ix, iz, x, z, top, bot,
              /** Metres of open air under this piece, in its own column. */
              gap: bot - below,
              below,
            });
          }
          if (ids.length) index.set(`${b}:${ix}:${iz}`, ids);
          if (stands > -Infinity) stand.set(`${b}:${ix}:${iz}`, stands);
        }
      }
    }

    /* ---- union-find, sky nodes only ---------------------------------- */
    const parent = new Int32Array(nodes.length);
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (a) => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    };
    const union = (a, b2) => {
      const ra = find(a);
      const rb = find(b2);
      if (ra !== rb) parent[ra] = rb;
    };

    /** How far two samples of the same piece may disagree in Y and still be it.
     *  A 0.5 m lattice across a 45° face moves the surface 0.5 m per step. */
    const LINK = GRID * 1.2;

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const ids = index.get(`${n.b}:${n.ix + dx}:${n.iz + dz}`);
        if (!ids) continue;
        for (const j of ids) {
          const m = nodes[j];
          if (n.bot <= m.top + LINK && m.bot <= n.top + LINK) union(i, j);
        }
      }
    }

    /* ---- supported iff ANY node in the piece rests on something ------- */
    const comp = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const r = find(i);
      let c = comp.get(r);
      if (!c) {
        c = {
          n: 0, cells: new Set(), supported: false,
          /** How many column-neighbours have ground-standing mass up to it. */
          attached: 0,
          bestStand: -Infinity,
          top: -Infinity, bot: Infinity, minGap: Infinity,
          x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity,
          region: nodes[i].b, at: null,
          /** Node ids, so a truncated piece can be followed off the window. */
          ids: [],
          /** Set when the piece runs into the wall of its own sweep window. */
          clipped: false,
          grown: 0,
        };
        comp.set(r, c);
      }
      const n = nodes[i];
      c.n++;
      c.ids.push(i);
      c.cells.add(`${n.ix}:${n.iz}`);
      const rg0 = regions[n.b];
      if (n.ix === 0 || n.iz === 0 || n.ix === rg0.nx - 1 || n.iz === rg0.nz - 1) c.clipped = true;
      // rests on the next solid down in its own column
      if (n.gap <= TOL) c.supported = true;
      /**
       * …OR IS ATTACHED TO SOMETHING STANDING RIGHT BESIDE IT, and this is the
       * clause that tells a roof from a mass in the sky. A roof has nothing at
       * all underneath it and is held up perfectly well: the test is that the
       * mass beside it which DOES reach the ground comes up to at least its own
       * underside. A balcony's wall does. The rubble of a razed block does not
       * reach ten metres, which is why the bug this file was written for is
       * still caught with this clause in.
       */
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const s = stand.get(`${n.b}:${n.ix + dx}:${n.iz + dz}`);
        if (s === undefined) continue;
        const lift = s - n.bot;
        if (lift > c.bestStand) c.bestStand = lift;
        if (s >= n.bot - TOL) c.attached++;
      }
      if (n.top > c.top) { c.top = n.top; c.at = [+n.x.toFixed(2), +n.z.toFixed(2)]; }
      if (n.bot < c.bot) c.bot = n.bot;
      if (n.gap < c.minGap) c.minGap = n.gap;
      c.x0 = Math.min(c.x0, n.x); c.x1 = Math.max(c.x1, n.x);
      c.z0 = Math.min(c.z0, n.z); c.z1 = Math.max(c.z1, n.z);
    }

    /**
     * ATTACHED TO SOMETHING STANDING. A roof, a balcony and a gangway deck all
     * have nothing whatever underneath them and are held up perfectly well by
     * the mass beside them; `--attach` is how many column-neighbours have to
     * carry ground-standing mass up to the piece's own underside before that
     * counts. One is enough now that a single freak column cannot manufacture a
     * ten-metre "ground" interval. @see the coincident-faces note above.
     */
    for (const c of comp.values()) {
      if (c.attached >= NEED_ATTACH) c.supported = true;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * AND A PIECE THAT RUNS OUT OF THE WINDOW HAS NOT BEEN JUDGED YET
     * ────────────────────────────────────────────────────────────────────────
     * Every region above is a WINDOW ON THE MAP chosen to be small — a strike
     * site is its mound plus 1.5 m, a razed block its plot plus two — because a
     * bigger one takes in the neighbours' roofs. The support test then asks
     * whether anything standing comes up beside the piece, and it asks it only
     * of the columns INSIDE that window. For a piece that fits, that is the
     * whole question. For a piece the window cuts in half it is not a question
     * about the world at all: the three `CATH-*` mounds are 4.5 m squares
     * dropped on the cathedral's flank, each of them catches the outer end of a
     * flying buttress, and the pier the buttress is built into is a metre
     * outside the frame. Five standing warnings, all of them the frame.
     *
     * So an unsupported piece that TOUCHES THE EDGE of its window is followed
     * off it: a flood in the region's own lattice, columns cut on demand
     * wherever it goes, joining a neighbouring solid on the same Y-overlap rule
     * the sweep uses inside the window, and asking the same support question of
     * every column it reaches. The mass is judged on its own extent instead of
     * on the extent somebody chose to sample.
     *
     * NOT AN EXEMPTION, A CONTINUATION — the criterion is the one already
     * written above, applied to the cells the window happened to leave out. A
     * piece that ends in mid-air still ends in mid-air however far it is
     * followed, and the growth stops the moment there is nothing left to join.
     * `--grow=0` turns it off; the budget is per piece and a hit one is
     * reported, because a runaway flood is a claim that wants looking at.
     */
    if (GROW > 0) {
      /** Columns cut outside the window, `${b}:${ix}:${iz}` -> intervals. */
      const outside = new Map();
      const cut = (rg, b, ix, iz) => {
        const key = `${b}:${ix}:${iz}`;
        let e = outside.get(key);
        if (e) return e;
        const x = cellX(rg, b, ix, iz);
        const z = cellZ(rg, b, ix, iz);
        const iv = column(x, z, []);
        const groundY = rg.floorY + GROUND;
        let stands = -Infinity;
        const sky = [];
        for (let i = 0; i < iv.length; i += 2) {
          if (iv[i + 1] <= groundY) { if (iv[i] > stands) stands = iv[i]; continue; }
          sky.push(iv[i], iv[i + 1]);
        }
        outside.set(key, (e = { sky, stand: stands }));
        grownColumns++;
        return e;
      };
      for (const c of comp.values()) {
        if (c.supported || !c.clipped || c.cells.size < MIN_CELLS) continue;
        const rg = regions[c.region];
        const b = c.region;
        // The frontier is (cell, interval); the interval is what a neighbour
        // has to overlap in Y to be the same piece.
        const seen = new Set();
        const q = [];
        for (const id of c.ids) {
          const n = nodes[id];
          q.push(n.ix, n.iz, n.top, n.bot);
          seen.add(`${n.ix}:${n.iz}:${Math.round(n.top * 4)}`);
        }
        let head = 0;
        while (head < q.length && c.grown < GROW && !c.supported) {
          const ix = q[head++];
          const iz = q[head++];
          const top = q[head++];
          const bot = q[head++];
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const jx = ix + dx;
            const jz = iz + dz;
            const inside = jx >= 0 && jz >= 0 && jx < rg.nx && jz < rg.nz;
            let sky;
            let st;
            if (inside) {
              // Already sampled: the sweep's own tables answer for this cell.
              st = stand.get(`${b}:${jx}:${jz}`);
              const ids = index.get(`${b}:${jx}:${jz}`);
              sky = null;
              if (ids) { sky = []; for (const j of ids) sky.push(nodes[j].top, nodes[j].bot); }
            } else {
              const e = cut(rg, b, jx, jz);
              c.grown++;
              sky = e.sky;
              st = e.stand > -Infinity ? e.stand : undefined;
            }
            if (st !== undefined) {
              const lift = st - bot;
              if (lift > c.bestStand) c.bestStand = lift;
              if (st >= bot - TOL) { c.attached++; c.supported = true; followed++; break; }
            }
            if (!sky) continue;
            for (let k = 0; k < sky.length; k += 2) {
              if (!(bot <= sky[k] + LINK && sky[k + 1] <= top + LINK)) continue;
              const tag = `${jx}:${jz}:${Math.round(sky[k] * 4)}`;
              if (seen.has(tag)) continue;
              seen.add(tag);
              q.push(jx, jz, sky[k], sky[k + 1]);
            }
          }
        }
        if (c.grown >= GROW) c.budget = true;
      }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * AND BEFORE ANYTHING IS REPORTED, LOOK AT IT AGAIN AT FOUR TIMES THE
     * RESOLUTION — THE SAME ANALYSIS, NOT A SOFTER ONE
     * ────────────────────────────────────────────────────────────────────────
     * A 0.5 m lattice is the right sampling for a slab and the wrong one for a
     * panel. A shopfront's roller shutter is 0.12 m thick and its proxy sits
     * 0.09 m off the plane of the wall slab it hangs in, so a column hits one
     * or the other and never both, and whether two ADJACENT columns happen to
     * pick different planes — which is what would join the shutter to its wall
     * — is down to where the jitter fell. Two slivers of a shutter set in a
     * standing wall came back as metal floating over a street on three of
     * fourteen seeds, and on a fourth only once `?breach=down` took the ground
     * storey out from under that wall.
     *
     * So a piece that is still unsupported gets the WHOLE PROCEDURE run again
     * over its own neighbourhood at a quarter of the cell: columns, ground
     * plane, Y-overlap graph, the same two support clauses. Nothing is
     * excused and no criterion moves — the piece is joined to the wall it is
     * set in because at 0.125 m the wall is next door, and the wall is carried
     * by jambs that reach the ground. A mound nine metres up over a razed plot
     * has nothing next door at any resolution and is reported exactly as
     * before; @see the pre-fix control in the commit that added this.
     */
    if (GROW > 0) {
      /** Metres of neighbourhood round the piece, so its wall is in frame. */
      const PAD = 1.25;
      const G = GRID / 4;
      const LINK2 = G * 1.2;
      for (const c of comp.values()) {
        if (c.supported || c.cells.size < MIN_CELLS) continue;
        const groundY = regions[c.region].floorY + GROUND;
        const x0 = c.x0 - PAD;
        const z0 = c.z0 - PAD;
        const mx = Math.ceil((c.x1 - c.x0 + PAD * 2) / G) + 1;
        const mz = Math.ceil((c.z1 - c.z0 + PAD * 2) / G) + 1;
        if (mx * mz > 40000) continue; // a piece this big was sampled fine
        const fn = []; // {ix,iz,top,bot,gap}
        const fi = new Map();
        const fstand = new Map();
        for (let iz = 0; iz < mz; iz++) {
          for (let ix = 0; ix < mx; ix++) {
            const h = ((ix * 73856093) ^ (iz * 19349663)) >>> 0;
            const x = x0 + (ix + 0.5) * G + (((h & 1023) / 1023) - 0.5) * G * 0.4;
            const z = z0 + (iz + 0.5) * G + ((((h >>> 10) & 1023) / 1023) - 0.5) * G * 0.4;
            const iv = column(x, z, []);
            grownColumns++;
            if (!iv.length) continue;
            const ids = [];
            let stands = -Infinity;
            for (let i = 0; i < iv.length; i += 2) {
              if (iv[i + 1] <= groundY) { if (iv[i] > stands) stands = iv[i]; continue; }
              const below = i + 2 < iv.length ? iv[i + 2] : BOTTOM;
              ids.push(fn.length);
              fn.push({ ix, iz, top: iv[i], bot: iv[i + 1], gap: iv[i + 1] - below });
            }
            if (ids.length) fi.set(`${ix}:${iz}`, ids);
            if (stands > -Infinity) fstand.set(`${ix}:${iz}`, stands);
          }
        }
        const fp = new Int32Array(fn.length);
        for (let i = 0; i < fp.length; i++) fp[i] = i;
        const ffind = (a) => { while (fp[a] !== a) { fp[a] = fp[fp[a]]; a = fp[a]; } return a; };
        for (let i = 0; i < fn.length; i++) {
          const n = fn[i];
          for (const [dx, dz] of [[1, 0], [0, 1]]) {
            const ids = fi.get(`${n.ix + dx}:${n.iz + dz}`);
            if (!ids) continue;
            for (const j of ids) {
              const m = fn[j];
              if (n.bot <= m.top + LINK2 && m.bot <= n.top + LINK2) {
                const ra = ffind(i); const rb = ffind(j);
                if (ra !== rb) fp[ra] = rb;
              }
            }
          }
        }
        /** Which fine components are the piece: same place, same height. */
        const mine = new Set();
        for (let i = 0; i < fn.length; i++) {
          const n = fn[i];
          const fx = x0 + (n.ix + 0.5) * G;
          const fz = z0 + (n.iz + 0.5) * G;
          for (const id of c.ids) {
            const o = nodes[id];
            if (Math.abs(fx - o.x) > GRID || Math.abs(fz - o.z) > GRID) continue;
            if (n.bot > o.top + LINK2 || o.bot > n.top + LINK2) continue;
            mine.add(ffind(i));
            break;
          }
        }
        if (!mine.size) continue; // the fine sweep cannot find it: leave the report alone
        for (let i = 0; i < fn.length && !c.supported; i++) {
          if (!mine.has(ffind(i))) continue;
          const n = fn[i];
          if (n.gap <= TOL) { c.supported = true; refined++; break; }
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const st = fstand.get(`${n.ix + dx}:${n.iz + dz}`);
            if (st === undefined) continue;
            if (st >= n.bot - TOL) { c.supported = true; refined++; break; }
          }
        }
      }
    }

    const floating = [];
    for (const c of comp.values()) {
      if (c.supported) continue;
      if (c.cells.size < MIN_CELLS) continue;
      floating.push({
        region: regions[c.region].id,
        cells: c.cells.size,
        samples: c.n,
        top: +c.top.toFixed(2),
        bot: +c.bot.toFixed(2),
        air: +c.minGap.toFixed(2),
        spanX: +(c.x1 - c.x0 + GRID).toFixed(1),
        spanZ: +(c.z1 - c.z0 + GRID).toFixed(1),
        at: c.at,
        grown: c.grown,
        budget: !!c.budget,
      });
    }
    floating.sort((a, b2) => b2.cells * b2.air - a.cells * a.air);

    /* ---- who owns it? name the mesh under the highest point ---------- */
    for (const f of floating.slice(0, 12)) {
      const h = ph.raycast(f.at[0], f.top + 0.5, f.at[1], 0, -1, 0, 3, MASK);
      f.owner = h.hit ? (h.object?.name || '(static batch)') : '?';
    }

    /* ---- every off-the-ground piece, supported or not ----------------- */
    const audit = [...comp.values()]
      .sort((a, b2) => b2.top - a.top)
      .slice(0, 10)
      .map((c) => ({
        top: +c.top.toFixed(2), bot: +c.bot.toFixed(2), cells: c.cells.size,
        supported: c.supported, air: +c.minGap.toFixed(2),
        attached: c.attached, lift: c.bestStand === -Infinity ? null : +c.bestStand.toFixed(2),
        at: c.at,
      }));

    return {
      audit,
      ms: Math.round(performance.now() - t0),
      regions: regions.map((r) => r.id),
      columns: index.size,
      rays,
      intervals,
      groundNodes,
      grownColumns,
      followed,
      refined,
      skyNodes: nodes.length,
      components: comp.size,
      anomalies,
      floating,
      total: floating.reduce((s, f) => s + f.cells, 0),
    };
  },
  { REGION, GRID, TOL, MIN_CELLS, GROUND, APRON, NEED_ATTACH, GROW }
);

/* -------------------------------------------------------------------------- */
/* THE SECOND HALF OF THE QUESTION: WHAT THE PLAYER CAN SEE                    */
/* -------------------------------------------------------------------------- */
/**
 * ────────────────────────────────────────────────────────────────────────────
 * A GATE THAT SAYS OK WHILE THE PLAYER IS LOOKING AT THE BUG
 * ────────────────────────────────────────────────────────────────────────────
 * Everything above reconstructs the PHYSICS world. That is exactly the right
 * question for 「物理判定あるので戦車が空中に登ってしまいますよ？？？」 and it is
 * only half of 「宙にうく物体はまだ大聖堂の上に残ってますよ」, because
 * `Airstrike`'s rubble CHUNKS ARE NOT SOLID. The collision of a settled site is
 * a handful of mound-proxy boxes (or, for a demolition, the ruin `world` owns);
 * the several thousand chunks drawn round it are picture only. So a chunk that
 * comes to rest ten metres up in clear air is INVISIBLE to the sweep above — it
 * casts no ray, occupies no interval, and the run comes back "OK — every solid
 * in the sweep is connected to the ground" with the thing the player is
 * complaining about filling his screen.
 *
 * Measured on the build this note was written for: `--region=cath --fire=cath`
 * reported 13 sky intervals, all of them legitimately attached to standing
 * masonry, and passed — correctly, for what it was measuring. The drawn mass
 * was never asked about at all.
 *
 * So the gate now asks both. Every drawn instance of the picture-only mass is
 * walked in the pose it is CURRENTLY DRAWN IN, and one ray is dropped from above
 * each one to whatever it is resting on. The ray starts ABOVE the chunk and not
 * under it: fired from a chunk's own underside it starts below the terrain for
 * anything lying on the ground, which is a probe measuring its own start point
 * (the first version of this pass did exactly that and reported 297 chunks with
 * "60 m of air" at y = 0.4).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND IT WAS STILL ONLY ASKING ABOUT THE AIRSTRIKE — THE THIRD WAY THIS GATE
 * WAS FOOLED
 * ────────────────────────────────────────────────────────────────────────────
 * Two systems fooled it before (razing on the same frame as the salvo; a
 * raycast walk that saw only one of two coincident faces). The third was
 * simpler than either: the pass above swept `airstrike.sites` and NOTHING ELSE,
 * and `src/match/bomber.js` and `src/match/strafe.js` draw 1440 more chunks of
 * exactly the same picture-only kind on four fixed lines — two of which cross
 * the cathedral. Photographed from the player's eye in a real scheduled match,
 * the swarm in the sky censused as 114 drawn instances at 14.1-15.4 m, EVERY
 * ONE of them `bomber_*_debris` or `strafe_*_grit`, with nothing solid in the
 * twelve metres below. This file reported zero, correctly, about a question
 * nobody had asked it.
 *
 * So the sweep is now over DRAWN MASS rather than over one system's list:
 *
 *   1. every struck airstrike site (as before, and with the same "a struck site
 *      that has not baked has not been measured" refusal);
 *   2. every bomber run and every strafe run, FLOWN OR NOT — their rest pose is
 *      buried and on screen from the first boot frame, so a run that has never
 *      fired still has 320 drawn instances on the map and 34 of them were in
 *      the photograph;
 *   3. ANY OTHER INSTANCED MESH IN THE SCENE THAT IS DEBRIS, found by walking
 *      `ctx.scene` and testing the material rather than the owner. A list of
 *      systems is a list somebody has to remember to add to, which is how this
 *      gate came to be blind in the first place; `makeChunkMaterial` stamps
 *      `material.userData.owUniforms` on everything that moves on the settle
 *      program, so a fourth system that throws rubble is swept the day it is
 *      written and nobody has to edit this file.
 *
 * AND IT IS NOT ONE SYSTEM'S MISTAKE. While this was being written the tank
 * agent found its own plough spoil settling UP TO 6.86 m IN THE AIR, invisible
 * to `_ploughfloat.mjs` for exactly the reason the bomber's debris was
 * invisible here: a visual-only mass measured by a collision-only probe. Two
 * independent systems, the same blind spot, the same week — which is why the
 * test below is on the ATTRIBUTES THAT THROW A CHUNK rather than on a list of
 * owners. `match_tank_*_plough` is swept by this file with no line naming it.
 *
 * WHY THE WALK DOES NOT JUDGE EVERYTHING IT FINDS, WHICH IS A LIMIT AND IS
 * WRITTEN DOWN RATHER THAN QUIETLY APPLIED. The header of the collision half
 * says why a per-piece downward ray is the wrong probe: it false-positives on
 * every balcony, gallery and roof, none of which has anything beneath it and
 * all of which are held perfectly well from the side. That objection applies
 * unchanged to `world`'s instanced dressing — measured on this map, a plain
 * ray test calls 258 palm fronds, 121 conduit boxes on facades, 27 lamp
 * glasses and 27 pockmarks "floating", and every one of them is fixed to a wall
 * or a trunk. It is the right probe for DEBRIS because debris is the one class
 * whose whole contract is "it comes to rest on a plane" — so debris is what
 * FAILS the gate, and every other instanced mesh with something in clear air is
 * printed in full underneath, named and counted, so nothing is hidden.
 *
 * TWO TESTS, AND THE SECOND ONE IS WHY A BURIED CHUNK IS NOT A FAILURE. The
 * rest pose of every crater's spoil is UNDER the road on purpose: it is drawn
 * from boot, it is invisible, and the ray under it correctly reports the whole
 * depth of the map. So a candidate is also asked what is ABOVE it — one ray
 * down from over the map — and an instance whose top is under a solid surface
 * is buried or indoors and is counted as SHELTERED rather than as a failure.
 * Sheltered instances are printed, never silently dropped: a gate that hides a
 * category is the bug this file exists to stop.
 *
 * `--chunks=0` turns the whole pass off; `--cair` is the metres of open air that
 * make an instance a bug rather than one sat on the piece below it; `--cmin` is
 * how many one group needs before it is a failure rather than a note.
 */
const CHUNKS = args.chunks !== '0' && args.chunks !== false;
/** Metres of open air under a drawn instance before it is a floating object. */
const CAIR = Number(args.cair ?? 1.5);
/** Instances in one group over CAIR before the group fails rather than notes. */
const CMIN = Number(args.cmin ?? 3);

const drawn = CHUNKS
  ? await page.evaluate(({ CAIR }) => {
      const e = window.__ENGINE__;
      const ph = e.ctx.peek('physics');
      const m = e.ctx.peek('match');
      const MASK = ph.MASK.WORLD;
      const M4 = e.camera.matrixWorld.constructor;
      const V3 = e.camera.position.constructor;
      const mat = new M4();
      const pos = new V3();
      const sc = new V3();
      const q = e.camera.quaternion.clone();
      /** Well over the tallest thing on this map, for the "what is above" ray. */
      const SKY = 60;

      /**
       * WHAT IS DRAWN, NOT WHAT IS INTENDED. `instanceMatrix` is the buffer the
       * renderer reads, so this is the only array that answers "what can the
       * player see" for a settled mass, a never-fired run's buried rest pose and
       * anything else instanced on the map alike.
       *
       * `userData.settled` is deliberately NOT used any more: it is where a
       * chunk is GOING. The systems that animate declare themselves unsettled
       * below instead, which is the same refusal made in the right place.
       */
      const groups = [];
      const claimed = new Set();
      const claim = (mesh) => { if (mesh) claimed.add(mesh); };
      /**
       * AND IT HAS TO BE ON SCREEN TO BE IN THE SKY. `src/match/tank.js` parks
       * a 179-instance wreck and its plough spoil on `visible = false` groups
       * rather than under the map, and a sweep that ignored that reported 155
       * "floating" instances belonging to two tanks that are not destroyed and
       * are not drawn. Visibility is inherited, so the whole chain is asked.
       *
       * `airstrike`, `bomber` and `strafe` are unaffected either way: all three
       * keep their meshes visible from the first boot frame ON PURPOSE, because
       * hiding them moves the shader compile onto the frame the weapon fires.
       */
      const shown = (o) => {
        for (let q = o; q; q = q.parent) if (!q.visible) return false;
        return true;
      };

      /* ---- 1. the airstrike, exactly as before -------------------------- */
      const unsettled = [];
      const sites = m?.airstrike?.sites ?? [];
      for (const s of sites) {
        for (const mesh of s.meshes ?? []) claim(mesh);
        if (!s.struck) continue;
        /**
         * A STRUCK SITE THAT HAS NOT BAKED IS NOT A SWEPT SITE, and saying so is
         * the difference between a gate and a rubber stamp: until `_bakeSettled`
         * copies the settled pose into `instanceMatrix` the screen shows the
         * vertex shader's curve, so what is in the buffer is neither where the
         * chunks are nor where they are going.
         */
        if (!s.baked) unsettled.push(s.id);
        groups.push({ id: s.id, kind: s.kind, family: 'airstrike', judge: true, meshes: s.meshes ?? [] });
      }

      /* ---- 2. the bomber and the fighter, flown or not ------------------ */
      for (const [sys, family, key, kind] of [
        [m?.bomber, 'bomber', 'debris', 'crater'],
        [m?.strafe, 'strafe', 'grit', 'cannon'],
      ]) {
        for (const run of sys?.runs ?? []) {
          const mesh = run[key];
          if (!mesh) continue;
          claim(mesh);
          // Mid-run the buffer holds the buried rest pose while the shader draws
          // the arc, so the same refusal the airstrike gets applies here.
          if (run.active && !run.baked) unsettled.push(`${family}:${run.id}`);
          groups.push({ id: `${family}:${run.id}`, kind, family, judge: true, meshes: [mesh] });
        }
      }

      /* ---- 3. and every other instanced mesh in the scene --------------- */
      /**
       * DEBRIS IDENTIFIES ITSELF BY THE ATTRIBUTES THAT THROW IT, and the test
       * is the geometry rather than the material: `src/materials/shader.js`
       * stamps `userData.owUniforms` on EVERY patched material on the map, so
       * that field says "this went through the patcher" and not "this is
       * rubble" (tried first, and it claimed 816 meshes of `world` dressing).
       *
       * `aMot` + `aOff` are `makeChunkMaterial`'s own instanced attributes —
       * delay/flight/arc/spin and the rest→settled throw — and nothing that is
       * not on the settle program carries them. A fourth system that throws
       * rubble is therefore swept the day it is written.
       */
      const isDebris = (mesh) => {
        const g = mesh.geometry;
        return !!(g?.getAttribute?.('aMot') && g.getAttribute('aOff'));
      };
      const rest = [];
      let hidden = 0;
      e.ctx.scene.traverse((o) => {
        if (!o.isInstancedMesh || claimed.has(o)) return;
        if (!(o.count > 0)) return;
        if (!shown(o)) { hidden++; return; }
        rest.push(o);
      });
      let strays = 0;
      for (const mesh of rest) {
        const debris = isDebris(mesh);
        if (debris) strays++;
        groups.push({
          id: mesh.name || '(unnamed)',
          kind: debris ? 'DEBRIS' : 'dressing',
          family: 'scene',
          judge: debris,
          meshes: [mesh],
        });
      }

      /* ---- the sweep ---------------------------------------------------- */
      const rows = [];
      let checked = 0;
      let sheltered = 0;
      for (const g of groups) {
        let n = 0;
        let shelter = 0;
        let worst = 0;
        let hiY = -Infinity;
        let at = null;
        let instances = 0;
        for (const mesh of g.meshes) {
          const arr = mesh.instanceMatrix?.array;
          if (!arr || !shown(mesh)) continue;
          const count = Math.min(mesh.count ?? arr.length / 16, arr.length / 16);
          instances += count;
          /**
           * `instanceMatrix` IS MESH-LOCAL. The airstrike, the bomber and the
           * fighter all park their meshes on an identity group at the scene
           * root, so for years local and world were the same numbers and the
           * distinction never came up — until the walk in step 3 found
           * `match_tank_*_wreck`, whose instances are the hull's own boxes in
           * the HULL's frame and which read as 42 objects hanging over the map
           * origin. Compose with `matrixWorld` and they are a tank.
           */
          mesh.updateWorldMatrix(true, false);
          const world = mesh.matrixWorld;
          for (let i = 0; i < count * 16; i += 16) {
            mat.fromArray(arr, i);
            mat.premultiply(world);
            mat.decompose(pos, q, sc);
            // The largest half-extent, so a rotated chunk's underside is never
            // over-estimated: this can under-report air, never invent it.
            const half = Math.max(sc.x, sc.y, sc.z) * 0.5;
            const under = pos.y - half;
            checked++;
            if (under < 0.6) continue; // lying on the map, or parked below it
            const h = ph.raycast(pos.x, pos.y + 0.15, pos.z, 0, -1, 0, 80, MASK);
            const gap = h.hit ? under - h.point.y : under;
            if (gap <= CAIR) continue;
            // Nothing under it — but is there anything OVER it? A rest pose is
            // buried on purpose and an instance inside a building is not in the
            // sky. Counted and printed, never a failure.
            const up = ph.raycast(pos.x, SKY, pos.z, 0, -1, 0, SKY + 20, MASK);
            if (up.hit && up.point.y > pos.y + half) { shelter++; sheltered++; continue; }
            n++;
            if (gap > worst) worst = +gap.toFixed(2);
            if (pos.y > hiY) {
              hiY = pos.y;
              at = [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)];
            }
          }
        }
        if (n || shelter) {
          rows.push({
            id: g.id, kind: String(g.kind), family: g.family, judge: !!g.judge,
            chunks: instances, n, shelter, worst, at,
          });
        }
      }
      rows.sort((a, b) => b.n - a.n || b.shelter - a.shelter);
      return {
        rows,
        checked,
        sheltered,
        unsettled,
        groups: groups.length,
        judged: groups.filter((g) => g.judge).length,
        strays,
        hidden,
        struck: sites.filter((s) => s.struck).length,
        scene: rest.length,
      };
    }, { CAIR })
  : null;

/* -------------------------------------------------------------------------- */
/* THE THIRD HALF: THE WHOLE DISC, NOT A LIST OF COLUMNS                       */
/* -------------------------------------------------------------------------- */
/**
 * ────────────────────────────────────────────────────────────────────────────
 * THIS GATE SAID "OK" ABOUT A 129 m² CONCRETE SLAB HANGING 40 m IN THE AIR
 * ────────────────────────────────────────────────────────────────────────────
 * `--region=all` on NACHTFELD printed
 *
 *     swept NF-TOWER, NF-FORT — 2 columns
 *     OK — every solid in the sweep is connected to the ground.
 *
 * on a build where `plains-fort.js` called `fuelBund(A, rng, BUND.x, y(0),
 * BUND.z, …)` against a signature of `(cx, cz, gy)`. The bund was therefore
 * built at cz = 3.243 and gy = 43.5: a concrete slab, its kerb, NINE OIL DRUMS,
 * a pump post and a NO SMOKING board, 40 m up, with nothing whatever between
 * y 4 and y 40. `physics.groundHeight(17.5, 3.25)` came back **44.54** against
 * a real plain at 3.20, so it was not only a picture — `NavGrid` drops one ray
 * per cell and keeps the first hit, and a tank has climbed this map's rubble
 * into the sky before.
 *
 * IT MISSED IT BECAUSE OF WHAT IT WAS POINTED AT, not because of how it judges.
 * Every region above is a FOOTPRINT — a cathedral, a demolition plot, a strike
 * mound, a breach — and `world.demolitions` on this map publishes two: the
 * tower and the fortress. The bund landed 14 m outside the fortress's own half
 * extent, in the open, where no region reached. A gate that only looks where
 * somebody remembered to point it is a gate that reports OK on open ground, and
 * every report this session has quoted that OK.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SO: NO LIST. THE WHOLE PLAYABLE DISC, AND `_nffloating.mjs` FOLDED IN
 * ────────────────────────────────────────────────────────────────────────────
 * `_nffloating.mjs` DID find it — 129 m², 39 m of clear air, the only genuine
 * orphan inside r 172 — by binning every drawn world triangle into 2 m plan
 * cells and 1 m height bins and walking each column down. That sweep is here
 * now rather than in a third file, with one thing added that it did not have
 * and that a gate needs:
 *
 *   A SUPPORT TEST, so a ROOF IS NOT A FLOATING SLAB. A pure column walk flags
 *   every roof on the map — a 10 m room has 10 m of clear air under its ceiling
 *   in every column that is not a wall — which is why the disc sweep could not
 *   simply be switched on for the town. The collision half above already knows
 *   the answer: a mass is held up when a NEIGHBOURING COLUMN carries solid
 *   material from the ground up to its underside. So each flagged cluster is
 *   asked whether ANY cell it covers, or any cell adjacent to one, has an
 *   unbroken run of mass from the terrain up to within `--dtol` of the
 *   cluster's own bottom. A roof's perimeter cells sit next to its walls and
 *   pass; the bund's neighbours were open plain 40 m below and it fails.
 *
 * This half is TRIANGLES, not rays, so it sees mass whether or not it carries a
 * proxy — the picture-only failure the drawn half above was written for — and
 * it costs one traversal of the scene rather than 389 000 raycasts.
 *
 * `--disc=0` turns it off. `--disc=N` sets the radius (178 covers NACHTFELD's
 * boundary at 176 and the rim rock behind it).
 */
/**
 * THE SWEEP IS WIDER THAN THE JUDGEMENT, AND THAT IS NOT A DODGE.
 *
 * A mass is held by what is BESIDE it, so a sweep that stops at the boundary
 * throws away the mountain face that half the rim rock is resting against and
 * then reports the rim rock as floating. Measured: at `--disc=178` eleven
 * clusters of `mountain_rock`/`scree` at r 155-178 came back orphaned purely
 * because the face holding them was outside the window. So the disc is swept
 * WIDE (250 m takes in the whole ridge and the crag apron) and FAILED ON only
 * inside `--djudge` — 176 m, which is where `plains-rim.js` stops the player.
 * Everything between the two is printed under the failures, never dropped: the
 * back of the mountain is not the player's problem, and a gate that silently
 * hides a category is the bug this file exists to stop.
 */
const DISC = args.disc === '0' || args.disc === false ? 0 : Number(args.disc ?? 250);
/** Metres from the centre inside which an orphan is a failure, not a note. */
const DJUDGE = Number(args.djudge ?? 176);
/** Metres of clear air under a mass before it is a candidate. */
const DGAP = Number(args.dgap ?? 6);
/** Plan cell, metres. 2 m is `_nffloating`'s and is what found the bund. */
const DCELL = Number(args.dcell ?? 2);
/** m² of a cluster before it is worth failing on rather than noting. */
const DMIN = Number(args.dmin ?? 4);
/** Metres a neighbour's ground-connected mass may fall short and still hold. */
const DTOL = Number(args.dtol ?? 2.0);

const disc = DISC
  ? await page.evaluate(([R, CELL, GAP, TOL]) => {
      const e = window.__ENGINE__;
      const w = e.ctx.peek('world');
      const groundY = w.level?.groundY ?? (() => 0);
      const chain = (o) => { const s = []; let c = o; while (c) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };
      const root = e.scene.children.find((c) => c.name === 'world');
      if (!root) return { error: 'no world root' };
      root.updateMatrixWorld(true);

      const YMIN = -20, YMAX = 100;                 // bin index 0 == y YMIN
      const NY = YMAX - YMIN;
      const NX = Math.ceil((R * 2) / CELL);
      const col = new Map();
      const P = { x: 0, y: 0, z: 0 };
      const xf = (el, x, y, z) => {
        P.x = el[0] * x + el[4] * y + el[8] * z + el[12];
        P.y = el[1] * x + el[5] * y + el[9] * z + el[13];
        P.z = el[2] * x + el[6] * y + el[10] * z + el[14];
      };
      const mul = (a, bm, out) => {
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
          let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * bm[c * 4 + k];
          out[c * 4 + r] = s;
        }
        return out;
      };
      const cellOf = (x, z) => {
        const i = Math.floor((x + R) / CELL), j = Math.floor((z + R) / CELL);
        return i < 0 || j < 0 || i >= NX || j >= NX ? -1 : j * NX + i;
      };
      let tris = 0;
      const collect = (obj, el, label) => {
        const g = obj.geometry; const pa = g?.getAttribute('position'); if (!pa) return;
        const idx = g.getIndex(); const n = idx ? idx.count : pa.count;
        for (let i = 0; i < n; i += 3) {
          const a = idx ? idx.getX(i) : i, b2 = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
          xf(el, pa.getX(a), pa.getY(a), pa.getZ(a)); const ax = P.x, ay = P.y, az = P.z;
          xf(el, pa.getX(b2), pa.getY(b2), pa.getZ(b2)); const bx = P.x, by = P.y, bz = P.z;
          xf(el, pa.getX(c), pa.getY(c), pa.getZ(c)); const cx = P.x, cy = P.y, cz = P.z;
          const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
          if (mx * mx + mz * mz > R * R) continue;
          const k = cellOf(mx, mz); if (k < 0) continue;
          tris++;
          const ux = bx - ax, uy = by - ay, uz = bz - az;
          const wx = cx - ax, wy = cy - ay, wz = cz - az;
          const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
          const A2 = 0.5 * Math.hypot(nx, ny, nz);
          const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)) - YMIN);
          const y1 = Math.min(NY - 1, Math.ceil(Math.max(ay, by, cy)) - YMIN);
          /**
           * OCCUPANCY OVER THE TRIANGLE'S WHOLE PLAN FOOTPRINT, not just under
           * its centroid — and that distinction is a false positive of 731 m²
           * on the town. `world_interior_shell` draws a room's ceiling as one or
           * two large triangles; binned at the centroid, the whole ceiling
           * landed in ONE cell in the middle of the room, so the support test
           * looked at that cell's eight neighbours, found open floor 9 m below,
           * and called a ceiling a floating slab. The walls holding it up were
           * five cells away. Marking every cell the triangle covers puts the
           * ceiling next to its own walls, which is what it is.
           *
           * AREA STAYS ON THE CENTROID so a big triangle is not counted once
           * per cell — the m² column is a size, not an occupancy.
           */
          const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) + R) / CELL));
          const i1 = Math.min(NX - 1, Math.floor((Math.max(ax, bx, cx) + R) / CELL));
          const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) + R) / CELL));
          const j1 = Math.min(NX - 1, Math.floor((Math.max(az, bz, cz) + R) / CELL));
          const span = (i1 - i0 + 1) * (j1 - j0 + 1);
          if (span > 1 && span <= 4096) {
            for (let j = j0; j <= j1; j++) {
              for (let i = i0; i <= i1; i++) {
                const kk = j * NX + i;
                let rr = col.get(kk);
                if (!rr) col.set(kk, (rr = { bins: new Uint8Array(NY), area: new Float32Array(NY), lab: new Map() }));
                for (let y = y0; y <= y1; y++) rr.bins[y] = 1;
              }
            }
          }
          let r = col.get(k);
          if (!r) col.set(k, (r = { bins: new Uint8Array(NY), area: new Float32Array(NY), lab: new Map() }));
          for (let y = y0; y <= y1; y++) { r.bins[y] = 1; r.area[y] += A2 / (y1 - y0 + 1); }
          const lb = Math.floor((ay + by + cy) / 3) - YMIN;
          if (lb >= 0 && lb < NY) {
            const key = `${label}@${lb}`;
            r.lab.set(key, (r.lab.get(key) ?? 0) + A2);
          }
        }
      };
      root.traverse((o) => {
        if (!o.visible) return;
        for (let q = o; q; q = q.parent) if (!q.visible) return;
        if (o.isInstancedMesh) {
          const el = new Array(16); const im = o.instanceMatrix.array;
          for (let i = 0; i < o.count; i++) collect(o, mul(o.matrixWorld.elements, im.slice(i * 16, i * 16 + 16), el), chain(o));
        } else if (o.isMesh) collect(o, o.matrixWorld.elements, chain(o));
      });

      /**
       * THE GROUND-CONNECTED CEILING OF EVERY COLUMN: how high solid material
       * runs WITHOUT A BREAK from the terrain up. This is the whole support
       * test — a wall's column reaches its own roof, so a roof beside it is
       * held; open plain reaches the plain, so a slab 40 m over it is not.
       */
      const reach = new Map();
      for (const [k, r] of col) {
        const i = k % NX, j = Math.floor(k / NX);
        const x = -R + i * CELL + CELL / 2, z = -R + j * CELL + CELL / 2;
        const gb = Math.floor(groundY(x, z)) - YMIN;
        let y = Math.max(0, Math.min(NY - 1, gb));
        // step down to the first occupied bin at or under the ground, then up
        while (y > 0 && !r.bins[y]) y--;
        let top = y;
        while (top + 1 < NY && r.bins[top + 1]) top++;
        reach.set(k, top);
      }

      /* ---- flag every run with clear air under it ----------------------- */
      const flags = [];
      for (const [k, r] of col) {
        const i = k % NX, j = Math.floor(k / NX);
        const x = -R + i * CELL + CELL / 2, z = -R + j * CELL + CELL / 2;
        const gb = Math.floor(groundY(x, z)) - YMIN;
        let y = NY - 1;
        while (y >= 0) {
          if (!r.bins[y]) { y--; continue; }
          const top = y;
          while (y >= 0 && r.bins[y]) y--;
          const bot = y + 1;
          let below = y;
          while (below >= 0 && !r.bins[below]) below--;
          const under = Math.max(below >= 0 ? below : gb, gb);
          const gap = bot - under;
          if (gap >= GAP && bot > gb + GAP) {
            let area = 0;
            for (let q = bot; q <= top; q++) area += r.area[q];
            const labs = [];
            for (const [lk, la] of r.lab) {
              const yy = Number(lk.split('@').pop());
              if (yy >= bot && yy <= top) labs.push([lk.split('/').pop().split('@')[0], la]);
            }
            flags.push({ k, x, z, bot, top, gap, gy: groundY(x, z), m2: area, labs });
          }
        }
      }

      /* ---- cluster the flagged runs, then ask what holds each cluster --- */
      const byKey = new Map();
      for (const f of flags) byKey.set(`${f.k}|${f.bot}`, f);
      const seen = new Set(); const islands = [];
      for (const f of flags) {
        const k0 = `${f.k}|${f.bot}`;
        if (seen.has(k0)) continue;
        const q = [f]; seen.add(k0);
        const isl = {
          cells: [], m2: 0, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9,
          bot: 1e9, top: -1e9, gap: 1e9, gy: f.gy, labs: new Map(),
        };
        while (q.length) {
          const c = q.pop();
          isl.cells.push(c.k); isl.m2 += c.m2;
          isl.x0 = Math.min(isl.x0, c.x); isl.x1 = Math.max(isl.x1, c.x);
          isl.z0 = Math.min(isl.z0, c.z); isl.z1 = Math.max(isl.z1, c.z);
          isl.bot = Math.min(isl.bot, c.bot); isl.top = Math.max(isl.top, c.top);
          isl.gap = Math.min(isl.gap, c.gap);
          for (const [n2, a2] of c.labs) isl.labs.set(n2, (isl.labs.get(n2) ?? 0) + a2);
          const ci = c.k % NX, cj = Math.floor(c.k / NX);
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const ni = ci + di, nj = cj + dj;
            if (ni < 0 || nj < 0 || ni >= NX || nj >= NX) continue;
            const nk = nj * NX + ni;
            for (let db = -3; db <= 3; db++) {
              const kk = `${nk}|${c.bot + db}`;
              if (byKey.has(kk) && !seen.has(kk)) { seen.add(kk); q.push(byKey.get(kk)); }
            }
          }
        }
        /**
         * HELD FROM THE SIDE? Any cell of the cluster, or any of its eight
         * neighbours, whose ground-connected mass comes up to within TOL of the
         * cluster's underside. That is a wall under a roof, a pier under a
         * bridge, a trunk under a canopy — and it is nothing at all under a
         * fuel dump in the middle of a plain.
         */
        let held = null;
        const want = isl.bot - Math.round(TOL);
        outer:
        for (const k of isl.cells) {
          const ci = k % NX, cj = Math.floor(k / NX);
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const ni = ci + di, nj = cj + dj;
            if (ni < 0 || nj < 0 || ni >= NX || nj >= NX) continue;
            const rr = reach.get(nj * NX + ni);
            if (rr !== undefined && rr >= want) {
              held = [-R + ni * CELL + CELL / 2, -R + nj * CELL + CELL / 2, rr + YMIN];
              break outer;
            }
          }
        }
        islands.push({
          n: isl.cells.length, m2: +isl.m2.toFixed(1),
          bot: isl.bot + YMIN, top: isl.top + YMIN, gap: isl.gap, gy: +isl.gy.toFixed(1),
          x0: isl.x0, x1: isl.x1, z0: isl.z0, z1: isl.z1,
          held,
          labs: [...isl.labs.entries()].sort((a, c) => c[1] - a[1]).slice(0, 4)
            .map(([n2, a2]) => [n2, +a2.toFixed(1)]),
        });
      }
      islands.sort((a, c) => c.m2 - a.m2);
      return { cells: col.size, tris, flagged: flags.length, islands };
    }, [DISC, DCELL, DGAP, DTOL])
  : null;

await browser.close();

/** Where a cluster is, as a radius, so the judgement can be scoped to the play area. */
const discR = (i) => Math.hypot((i.x0 + i.x1) / 2, (i.z0 + i.z1) / 2);
/** Clusters over the disc with nothing under them and nothing beside them. */
const discBad = (disc?.islands ?? []).filter((i) => !i.held && i.m2 >= DMIN && discR(i) <= DJUDGE);
/** The same, out on the mountain where the player cannot go: printed, not failed. */
const discOut = (disc?.islands ?? []).filter((i) => !i.held && i.m2 >= DMIN && discR(i) > DJUDGE);

/** Groups whose drawn mass is genuinely hanging, rather than one stray chunk. */
const drawnBad = (drawn?.rows ?? []).filter((r) => r.judge && r.n >= CMIN);
/**
 * …AND A GROUP STILL IN THE AIR IS A FAILED RUN, NOT A PASSED ONE. It used to
 * print a note and exit 0, which is a gate saying OK about a question it could
 * not answer — the exact failure mode this file has now had three times. The
 * `--fire` driver waits every event out before it censuses, so reaching here
 * with something unsettled means the wait was wrong and the sweep is void.
 */
const drawnVoid = drawn?.unsettled?.length ?? 0;

/* -------------------------------------------------------------------------- */

if (args.json) {
  console.log(JSON.stringify({ levelSeed, ...result, drawn, disc }, null, 2));
} else {
  console.log(`\nFLOATCHECK  region=${REGION}  grid=${GRID}m  tol=${TOL}m  levelSeed=${levelSeed}`);
  console.log(`  ${url(REGION)}${FIRE ? `  --fire=${FIRE}` : ''}`);
  if (fired) {
    console.log(
      `  fired: cathedral razed=${fired.razed}, ${fired.struck}/${fired.total} sites struck, ${fired.settled} settled`
    );
  }
  if (result.error) {
    console.log(`  ERROR: ${result.error}`);
  } else {
    console.log(
      `  swept ${result.regions.join(', ')} — ${result.columns} columns with something off the ` +
        `ground, ${result.rays} rays, ${result.intervals} solid intervals ` +
        `(${result.groundNodes} standing on the map, ${result.skyNodes} not) in ${result.ms}ms` +
        (result.grownColumns
          ? `  ·  ${result.grownColumns} more cut looking again at ` +
            `${result.followed + result.refined} pieces (${result.followed} carried past the ` +
            `window edge, ${result.refined} carried inside a cell)`
          : '') +
        (result.anomalies ? `  ·  ${result.anomalies} single-sided surfaces ignored` : '')
    );
    if (args.audit) {
      console.log('  tallest pieces off the ground:');
      for (const a of result.audit) console.log(`    ${JSON.stringify(a)}`);
    }
    if (!result.floating.length) {
      /**
       * QUALIFIED, AND THE QUALIFICATION IS THE POINT. This sentence used to
       * read "OK — every solid in the sweep is connected to the ground", and it
       * was quoted all session as a whole-map pass on a build with a 129 m²
       * slab hanging 40 m up 14 m outside the nearest region. The sweep is the
       * regions; the map is the disc pass at the foot of this report.
       */
      console.log(
        `  OK — inside the ${result.regions.length} swept region(s) (${result.regions.join(', ')}), ` +
          'every solid is connected to the ground.\n' +
          '     THIS IS NOT A STATEMENT ABOUT THE MAP. @see WHOLE DISC below.\n'
      );
    } else {
      console.log(`\n  ${result.floating.length} FLOATING MASSES (${result.total} lattice cells):\n`);
      console.log(
        '    cells   top     bottom   air under   span        at (x,z)        owner'
      );
      for (const f of result.floating.slice(0, 40)) {
        console.log(
          `    ${String(f.cells).padStart(5)}  ${f.top.toFixed(2).padStart(6)}  ` +
            `${f.bot.toFixed(2).padStart(6)}   ${f.air.toFixed(2).padStart(7)}m   ` +
            `${(f.spanX + 'x' + f.spanZ).padEnd(10)}  ` +
            `${(f.at[0] + ',' + f.at[1]).padEnd(15)} ${f.owner ?? ''}` +
            (f.budget ? `  (--grow budget hit after ${f.grown} columns)` : '')
        );
      }
      if (result.floating.length > 40) console.log(`    … and ${result.floating.length - 40} more`);
      console.log('');
    }
  }
  /* ---- and the drawn mass, which carries no collision at all ------------- */
  if (drawn === null) {
    console.log('  drawn mass: not swept (--chunks=0)');
  } else {
    const inSky = drawn.rows.filter((r) => r.n && r.judge);
    const dressing = drawn.rows.filter((r) => r.n && !r.judge);
    console.log(
      `\n  DRAWN MASS — ${drawn.checked} instances swept over ${drawn.groups} groups, ` +
        `${drawn.judged} of them DEBRIS and judged (${drawn.struck} struck strike sites, every ` +
        `bomber and strafe run flown or not, and ${drawn.strays} unregistered mesh(es) on the ` +
        `settle program); ${drawn.scene} other instanced mesh(es) walked and reported only, ` +
        `${drawn.hidden} skipped as not drawn (visible=false). ` +
        `${drawn.sheltered} instances are under a solid surface — buried or indoors, not in the sky.`
    );
    if (drawn.unsettled.length) {
      console.log(
        `\n  ${drawn.unsettled.length} GROUP(S) HAVE NOT SETTLED — ${drawn.unsettled.join(', ')}.\n` +
          "    Their mass is still on the vertex shader's curve, so `instanceMatrix` is neither\n" +
          '    where it is nor where it is going. Wait past the settle time and run it again.'
      );
    }
    const line = (r) =>
      `    ${r.id.padEnd(22)} ${r.kind.padEnd(9)} ${String(r.chunks).padStart(5)}   ` +
      `${String(r.n).padStart(10)}   ${String(r.shelter).padStart(9)}   ` +
      `${String(r.worst).padStart(9)}   ${r.at.join(', ')}`;
    const head =
      '    group                  kind      drawn   in the sky   sheltered   worst air   highest (x,y,z)';
    if (!inSky.length) {
      console.log(
        `  no DEBRIS with more than ${CAIR} m of air under it and open sky over it.\n`
      );
    } else {
      console.log(
        `\n  DEBRIS IN CLEAR SKY (air > ${CAIR} m with nothing above; a group FAILS at ${CMIN}):\n`
      );
      console.log(head);
      for (const r of inSky) {
        console.log(line(r) + (r.n < CMIN ? '   (noted, under the threshold)' : ''));
      }
      console.log('');
    }
    /**
     * Reported and NOT judged. A downward ray is not a support test for a sign
     * bracketed to a wall or a frond on a trunk — @see the header — so these are
     * printed so that a real regression in the dressing is still visible to a
     * human, and are never the reason this file exits 1.
     */
    if (dressing.length) {
      console.log(
        `  ${dressing.length} non-debris instanced mesh(es) also have instances with air under ` +
          'them. A ray is not a support test for wall-mounted geometry, so these are REPORTED, ' +
          'NOT JUDGED:\n'
      );
      console.log(head);
      for (const r of dressing.slice(0, 12)) console.log(line(r));
      if (dressing.length > 12) console.log(`    … and ${dressing.length - 12} more`);
      console.log('');
    }
    const shelteredOnly = drawn.rows.filter((r) => !r.n && r.shelter && r.judge);
    if (shelteredOnly.length) {
      console.log(
        '  sheltered only (buried rest poses and mass inside buildings — reported, not failed):'
      );
      for (const r of shelteredOnly) {
        console.log(`    ${r.id.padEnd(15)} ${String(r.shelter).padStart(5)} of ${r.chunks}`);
      }
      console.log('');
    }
  }
  /* ---- and the whole disc, which is not scoped to anybody's footprint --- */
  if (disc === null) {
    console.log('  whole disc: not swept (--disc=0)');
  } else if (disc.error) {
    console.log(`  whole disc: ERROR ${disc.error}`);
  } else {
    const noted = disc.islands.filter((i) => !i.held && i.m2 < DMIN);
    const held = disc.islands.filter((i) => i.held);
    console.log(
      `\n  WHOLE DISC — swept to r ${DISC} m, judged inside r ${DJUDGE} m. ` +
        `${disc.cells} occupied ${DCELL} m plan cells over ${disc.tris} drawn triangles; ` +
        `${disc.flagged} column runs stand ≥${DGAP} m clear of anything below them, in ` +
        `${disc.islands.length} clusters. ${held.length} are held from the side (a wall under ` +
        `a roof, a face under a ledge); ${discBad.length} are ORPHANS over ${DMIN} m² inside ` +
        `the play area, ${discOut.length} outside it, ${noted.length} under the area threshold.`
    );
    const line = (i) =>
      `    ${String(i.m2.toFixed(0)).padStart(7)} m²  ${String(i.n).padStart(4)} cells  ` +
      `y ${String(i.bot).padStart(3)}–${String(i.top).padEnd(3)} (ground ${String(i.gy).padStart(6)}, ` +
      `clear ${String(i.gap).padStart(3)} m)  x ${i.x0}..${i.x1}  z ${i.z0}..${i.z1}\n` +
      `             ${i.labs.map(([n2, a2]) => `${n2} ${a2}`).join('  ')}` +
      (i.held ? `\n             held by the column at (${i.held[0]}, ${i.held[1]}), solid from the ground to y ${i.held[2]}` : '');
    if (discBad.length) {
      console.log(`\n  ${discBad.length} MASS(ES) STANDING ON NOTHING ANYWHERE ON THE MAP:\n`);
      for (const i of discBad.slice(0, 30)) console.log(line(i));
      console.log('');
    } else {
      console.log(`  OK — nothing over ${DMIN} m² inside r ${DJUDGE} m is standing on nothing.`);
    }
    if (discOut.length) {
      console.log(`\n  outside r ${DJUDGE} m — the mountain face and the back of the ridge, where`);
      console.log('  the player cannot stand. REPORTED, NOT FAILED:\n');
      for (const i of discOut.slice(0, 10)) console.log(line(i));
      if (discOut.length > 10) console.log(`    … and ${discOut.length - 10} more`);
      console.log('');
    }
    if (noted.length) {
      console.log(`  under the ${DMIN} m² threshold, reported not failed (mountain spires and rim rock):`);
      for (const i of noted.slice(0, 8)) console.log(line(i));
      if (noted.length > 8) console.log(`    … and ${noted.length - 8} more`);
      console.log('');
    }
  }
}
if (errs.length) {
  console.log(`  ${errs.length} PAGE ERROR(S):`);
  for (const s of errs.slice(0, 5)) console.log(`    ${s}`);
}
process.exit(result?.floating?.length || drawnBad.length || drawnVoid || discBad.length ? 1 : 0);
