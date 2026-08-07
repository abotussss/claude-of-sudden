/**
 * BOUNDARY GATE — where does the map STOP, and is there anything out there?
 *
 *   node tools/boundcheck.mjs [--url=…] [--cell=0.8] [--bearings=64]
 *                             [--slack=3] [--maxvoid=20] [--map] [--verbose]
 *
 * WHY IT EXISTS. The player sent a screenshot of himself standing in a huge
 * empty flat sand field with the background blocks 130-160 m away and wrote
 * "マップが未完成と言ってるのはこのエリアがあるから ここはなに？？？なぜ到達できるの？" —
 * THIS is why the map reads as unfinished. Nothing in the repo could see it.
 * `navcheck` proves a bot can walk from a spawn to a site; `lanecheck` proves
 * the three lanes are separate; `floorcheck` proves you can get upstairs. Not
 * one of them asks the opposite question: WHERE ELSE can the player get to, and
 * is there anything there when he arrives?
 *
 * WHAT IT MEASURES. The real player capsule (r 0.32, h 1.78) is flooded
 * outward from every spawn point and both bomb sites over every standable
 * surface in the level, with the moves the player actually has:
 *
 *   |dy| <= 0.42   walk            (STANCE.stand.stepHeight)
 *   dy  <= 1.85    mantle UP       (MOVE.mantle.maxHeight, reach 1.05 m)
 *   dy  <= 6.0     step off a ledge, downward only
 *
 * so a 1.5 m fence is NOT a boundary (you pull yourself over it), a crate
 * against a 3 m wall IS a hole in one, and dropping off the back of a wall
 * counts as getting out even though you cannot climb back in. Exactly the model
 * `floorcheck` uses, for the same reason: it is what the controller can do.
 *
 * THE ONE THING THIS MODEL CANNOT SEE, and it decides how a boundary must be
 * AUTHORED, so read it before you build one. A cell is refused when the standing
 * capsule overlaps something — `physics.checkCapsule`, which is
 * `StaticWorld.overlapCapsule`, which collects TRIANGLES WITHIN `radius` OF THE
 * CAPSULE. It is a surface test and not a containment test, and a hollow box is
 * twelve triangles: a capsule in the middle of a 3.8 m thick one is metres from
 * every face, reports zero contacts, and the flood walks the inside of the solid
 * one cell at a time. Measured on NACHTFELD's first rim, which registered 332
 * segments, stopped a `MASK.CHARACTER` ray dead on all 720 bearings tested, and
 * was crossed anyway.
 *
 * It is not a hole in the map — `CharacterController` sweeps, and a swept
 * capsule stops at the outer face at any speed — but it is a hole in what this
 * gate can see, and the rule that falls out of it is the one `cordon.js` already
 * follows without saying why: A BOUNDARY MUST BE THIN. A wall of thickness `t`
 * refuses every cell within `t/2 + 0.315` of its centreline, so the blocked band
 * is `t + 0.63` wide, and a `--cell` grid crossing it has a sample inside it only
 * while `t + 0.63 > cell`. At the default 0.8 m that means anything up to about
 * 1.2 m is honestly measured and anything thicker is not. The town's compound
 * wall is 0.55 m; NACHTFELD's rim is 0.62 m. Build mass around a thin membrane,
 * not a thick solid.
 *
 * Every cell the flood reaches is then classified against the AUTHORED CONTENT
 * of the level. A reached cell further than `--slack` metres from all of it is
 * VOID: ground the player can stand on where the level has authored nothing.
 * Void cells are grouped into connected regions and the gate FAILS on any
 * region bigger than `--maxvoid` m², because that is the thing being
 * complained about — not a 2 m gap behind a block, but a field.
 *
 * It also walks OUTWARD on `--bearings` bearings from the middle of the map and
 * reports, per bearing, how far the flood got and whether the far end of that
 * bearing is authored ground or void — which is the "how far can I walk that
 * way" question in the form the player asked it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE FLOOD IS GENERIC. THE CLASSIFICATION IS NOT — `BOUND_RULES`
 * ────────────────────────────────────────────────────────────────────────────
 * This gate was written when there was one map and it was hard-wired to that
 * map's authored tables: `L.STREET.kerb`, the three lanes, the building
 * footprints, the relief terraces, the gate. Pointed at NACHTFELD it died on
 * line 77 with `Cannot read properties of undefined (reading 'kerb')`, so the
 * plain — the map with a 46 m mountain for a boundary and no cordon behind it —
 * had NO BOUNDARY GATE AT ALL.
 *
 * The two halves are cleanly separable and only one of them was ever
 * map-specific:
 *
 *   GENERIC — the capsule, the three moves, the surface columns, the flood, the
 *             void regions, the leak trace back down `pred`, the bearings, the
 *             plan view. None of it names a map.
 *   PER-MAP — how big the grid is, how high to start the downward scan and how
 *             far down to carry it, and the two predicates: is there anything
 *             AUTHORED here, and is this cell inside the PLAY AREA.
 *
 * `BOUND_RULES` is that second half, one entry per level, selected by
 * `world.level.id`. It is the fourth table of its kind in this codebase and it
 * is deliberately the same shape as the other three — `MAPS`/`layoutFor` in
 * `src/match/sites.js`, `MAP_RULES`/`applyMapRules` in `src/match/rules.js`,
 * `forMap` in `src/match/geography.js` — down to the fallback, which uses the
 * town's rule and SAYS SO rather than throwing. It reads `world.level.id` and
 * NOT a second parse of `?map=`, for the reason `layoutFor` gives: two places
 * parsing the query string is two places to disagree, and this tool has already
 * been bitten once by a truncating `split('=')` that ran the town while
 * reporting the plain.
 *
 * NOT MEASURED: whether the boundary looks good. Take a screenshot.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  /** Split on the FIRST `=`: `--url=…/?seed=12` was truncated to `…/?seed`, so
   *  the gate measured seed 0 while reporting the seed it was given. */
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4173/';
/** null = take the active map's own default out of `BOUND_RULES`. */
const CELL = args.cell === undefined ? null : Number(args.cell);
const BEARINGS = Number(args.bearings ?? 64);
const SLACK = Number(args.slack ?? 3.0);
const MAXVOID = Number(args.maxvoid ?? 20);
const VERBOSE = !!args.verbose;

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

// Take the match, the bots and the player controller out of the way: this walks
// the capsule by hand and a round running underneath it only adds noise.
await page.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const m = c.peek('match'), ai = c.peek('ai');
  if (m && !m.__boundcheckStopped) { m.update = () => {}; m.__boundcheckStopped = true; }
  if (ai) { ai.combatEnabled = false; try { ai.clearAgents(); } catch { /* ok */ } }
  c.peek('ui')?.banner?.hide?.();
});

const report = await page.evaluate(({ CELL_ARG, SLACK }) => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world'), phys = c.peek('physics');
  const L = w.layout;
  if (!L) return { err: 'world does not expose layout' };
  const V = c.camera.position.constructor;
  const MASK = phys.MASK.CHARACTER;

  const R = 0.32, H = 1.78, STEP = 0.42, MANTLE_UP = 1.85, DROP_MAX = 6.0, MREACH = 1.05;
  const _a = new V(), _b = new V(), _wp = new V(), _wq = new V();

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * BOUND_RULES — the map-specific half. @see the header.
   * ══════════════════════════════════════════════════════════════════════════
   * One entry per level, keyed by `world.level.id`. Each answers five questions
   * and nothing else; every one of them is about the LEVEL's authored content,
   * and none of the flood below knows which map it is walking.
   *
   *   cell            grid pitch, metres. The town's 0.8 is the number every
   *                   figure in `cordon.js`'s header was measured at, so it is
   *                   not a shared default that a second map may drift.
   *   surfaces        how many stacked floors one (x, z) column may hold. The
   *                   town's 3 is the depth every figure in `cordon.js` was
   *                   measured at; the plain needs a fourth for a trench floor
   *                   under a parapet under a fortress walk.
   *   ext(L, w)       grid half-extent in LEVEL metres. Must cover every
   *                   collidable triangle the flood could reach, or the gate
   *                   reports a boundary that is really the edge of its own grid.
   *   scanTop(lx,lz)  where the downward surface scan starts, LEVEL y.
   *   scanFloor(lx,lz) the lowest y that still counts as a standable surface;
   *                   the ray itself is carried `PROBE_UNDER` past it so a floor
   *                   sitting exactly on the limit is still found.
   *   authored(lx,lz,slack,surface) -> tag|null
   *                   "has a designer put anything here", with `slack` metres of
   *                   grace. null IS the failure — it means VOID.
   *   inPlay(lx,lz,surface) -> bool
   *                   the play area with NO grace at all. This is what the
   *                   confined flood is allowed to walk, and the difference
   *                   between the two floods is what names the LEAKS.
   */
  const PROBE_UNDER = 1.8;
  const BOUND_RULES = {
    /**
     * ──────────────────────────────────────────────────────────────────────
     * AL-MARIYA — the town. Rects, plus the surface tag under your feet.
     * ──────────────────────────────────────────────────────────────────────
     * Verbatim the classification this tool shipped with, moved not rewritten:
     * every figure in `src/world/cordon.js`'s header (14 659 m² reached, 5 645
     * void, the six crossings at x ±10) was measured by this code and the town
     * is the regression check for the split.
     */
    town: {
      cell: 0.8,
      surfaces: 3,
      /** The whole terrain plane, so the flood can walk off the end of the map. */
      ext: (L) => 168 * (L.SCALE ?? 1) * 0.5 + 2,
      /** Above every parapet the flood may stand on (the compound wall tops out
       *  under 4 m) and below the lowest real roof. */
      scanTop: () => 8.0,
      scanFloor: () => -1.2,
      build(L, w) {
        /**
         * The level's authored ground, in LEVEL space. Everything here is
         * somewhere a designer put something: a surface to walk on, a footprint
         * to walk round, or mass to fight over. `pad` is how far from the thing
         * itself still counts as "at" it — you stand against a building, not
         * inside it.
         */
        const rects = [];
        const addRect = (x0, z0, x1, z1, pad, tag) => rects.push({
          x0: Math.min(x0, x1) - pad, x1: Math.max(x0, x1) + pad,
          z0: Math.min(z0, z1) - pad, z1: Math.max(z0, z1) + pad, tag,
        });
        const S = L.STREET;
        addRect(-S.kerb, S.zMin, S.kerb, S.zMax, 0.6, 'street');
        for (const a of L.ALLEYS ?? []) addRect(a.rect[0], a.rect[1], a.rect[2], a.rect[3], 0.6, 'lane');
        for (const b of L.BUILDINGS ?? []) {
          addRect(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2, 1.2, `bldg ${b.id}`);
        }
        for (const p of L.SITEWORKS ?? []) addRect(p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2, 1.5, `sitework ${p.id}`);
        for (const t of L.RELIEF?.terraces ?? []) addRect(t.rect[0], t.rect[1], t.rect[2], t.rect[3], 2.0, `terrace ${t.id}`);
        for (const d of L.RELIEF?.decks ?? []) addRect(d.rect[0], d.rect[1], d.rect[2], d.rect[3], 1.5, `deck ${d.id}`);
        for (const b of L.RELIEF?.blocks ?? []) addRect(b.rect[0], b.rect[1], b.rect[2], b.rect[3], 1.5, `block ${b.id}`);
        if (L.GATE) addRect(-L.GATE.outerW, L.GATE.z - L.GATE.depth, L.GATE.outerW, L.GATE.z + L.GATE.depth, 2.5, 'gate');
        /** Anything the world publishes as a place worth going: loot, vantages. */
        for (const f of w.features ?? []) {
          const p = w.worldToLevel(f.position.x, f.position.y, f.position.z, new V());
          addRect(p.x, p.z, p.x, p.z, 3.5, `feature ${f.id}`);
        }
        const rectTag = (lx, lz, slack) => {
          for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (lx >= r.x0 - slack && lx <= r.x1 + slack && lz >= r.z0 - slack && lz <= r.z1 + slack) return r.tag;
          }
          return null;
        };
        /**
         * THE SURFACE UNDER YOUR FEET IS THE HONEST TEST, and it is why this
         * gate can be strict without a hand-maintained list of every authored
         * square metre.
         *
         * `buildGround` lays ONE sand plane under the whole 252 m terrain and
         * then puts the road, the pavements, the lanes and both courtyards ON
         * it as their own collision boxes with their own surface tags; `physics`
         * reports the tag of the triangle a ray lands on. So "the player is
         * standing on bare `sand`" IS "the player is standing on ground nobody
         * authored a floor for" — the dunes that carry the horizon, which is
         * exactly the ground in the screenshot. Everything else (dirt, gravel,
         * concrete, metal, wood, a roof, a container, a rubble pile) is
         * something somebody put there.
         *
         * The rect list still matters, because a designer may legitimately want
         * you standing on sand — inside a courtyard, on a terrace, against a
         * building. Authored = a floor tag, or inside one of those rects.
         */
        const authored = (lx, lz, slack, surface) =>
          (surface && surface !== 'sand' ? surface : null) ?? rectTag(lx, lz, slack);
        /**
         * THE PLAY AREA ITSELF — authored ground with NO pad round it.
         *
         * The pads above are what makes "is there anything here" a fair question
         * and they are exactly wrong for "can he get out this way": a 1.2 m
         * skirt round every background block is a continuous authored footpath
         * all the way round the outside of the map, so the confined flood walked
         * the ring it was supposed to be excluded from and reported 108 leaks,
         * one per block corner. Confined to floors and footprints only, it stops
         * where the level does.
         */
        const core = [];
        const addCore = (x0, z0, x1, z1) => core.push({
          x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1),
        });
        addCore(-S.kerb, S.zMin, S.kerb, S.zMax);
        for (const a of L.ALLEYS ?? []) addCore(a.rect[0], a.rect[1], a.rect[2], a.rect[3]);
        for (const b of L.BUILDINGS ?? []) addCore(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2);
        for (const t of L.RELIEF?.terraces ?? []) addCore(t.rect[0], t.rect[1], t.rect[2], t.rect[3]);
        for (const d of L.RELIEF?.decks ?? []) addCore(d.rect[0], d.rect[1], d.rect[2], d.rect[3]);
        const inCore = (lx, lz) => {
          for (let i = 0; i < core.length; i++) {
            const r = core[i];
            if (lx >= r.x0 && lx <= r.x1 && lz >= r.z0 && lz <= r.z1) return true;
          }
          return false;
        };
        return {
          note: `${rects.length} authored rects, ${core.length} play rects, sand = unauthored`,
          authored,
          inPlay: (lx, lz, surface) => surface !== 'sand' || inCore(lx, lz),
        };
      },
    },

    /**
     * ──────────────────────────────────────────────────────────────────────
     * NACHTFELD — the night plain. A DISC, because the level says so.
     * ──────────────────────────────────────────────────────────────────────
     * The town's two tests both fail here and it is worth being exact about why
     * rather than porting them badly:
     *
     *   THE SURFACE TAG SAYS NOTHING. The whole 470 m terrain — plain, ridge
     *   face, crest and the ground past it — is ONE mesh registered with one
     *   call, `A.collideGeo('dirt', field)`. Every triangle on this map reports
     *   `dirt`, so "what am I standing on" cannot separate the play area from
     *   the mountain the way `sand` separates the town's dunes from its road.
     *
     *   THERE ARE NO FOOTPRINTS TO LIST. A plain's authored ground is the plain.
     *   Rect-listing five pads, two bases and three trench lines would call
     *   ninety per cent of the map void.
     *
     * What the level DOES state, in one line of its own code, is where it stops:
     * `plainsOpen()` opens with `if (r > RIDGE_R0 - margin) return false` — past
     * the foot of the mountain the face pitches over and nothing stands there.
     * That is the authored boundary, it is published as `layout.RIDGE.r0`, and
     * every scatter pass on the map is already clipped to it. So the play area
     * is the disc, the mountain is out, and a cell up the face or over the crest
     * is exactly the "why can I get here, there is nothing here" the tool exists
     * to answer.
     *
     * The tag returned names the nearest authored thing rather than just
     * "plain", so the bearings table reads as a map instead of one repeated word.
     */
    plains: {
      cell: 0.8,
      surfaces: 4,
      /**
       * PAST THE CREST AND PAST THE LAST COLLIDABLE TRIANGLE. The walked field
       * is 470 m across and all of it is collision, so the flood has to be able
       * to reach the far corner of it or the gate would report the edge of its
       * own grid as the edge of the map — which is the one failure a boundary
       * tool must never have.
       */
      ext: (L) => Math.max(L.BOUNDS_HALF ?? 0, L.RIDGE?.r1 ?? 0) + 26,
      /**
       * THE SCAN FOLLOWS THE GROUND, and on this map it has to. The town's
       * fixed 8 m works because its terrain is flat to a metre; here the floor
       * runs from a trench bottom to a 64 m crest, so a fixed ceiling would
       * scan the sky over the mountain and the inside of the hill over the
       * plain. `level.groundY` is the analytic height field the terrain mesh
       * was built from — one statement, no drift.
       */
      scanTop: (lx, lz, w) => w.level.groundY(lx, lz) + 34,
      /** Under the deepest trench cut, so a revetted floor is still a surface. */
      scanFloor: (lx, lz, w) => w.level.groundY(lx, lz) - 9,
      build(L, w) {
        const R0 = L.RIDGE?.r0 ?? 176;
        const pads = L.PADS ?? [];
        const works = L.WORKS ?? [];
        const near = (lx, lz) => {
          for (const p of pads) {
            if ((lx - p.x) ** 2 + (lz - p.z) ** 2 < p.r1 * p.r1) return `pad ${p.id}`;
          }
          for (const q of works) {
            if ((lx - q.x) ** 2 + (lz - q.z) ** 2 < (q.r + 4) ** 2) return `works ${q.id}`;
          }
          return 'plain';
        };
        return {
          note: `disc r<=${R0} m (layout.RIDGE.r0), ${pads.length} pads, ${works.length} works`,
          authored: (lx, lz, slack) =>
            (Math.hypot(lx, lz) <= R0 + slack ? near(lx, lz) : null),
          inPlay: (lx, lz) => Math.hypot(lx, lz) <= R0,
        };
      },
    },
  };

  const levelId = w.level?.id ?? null;
  let ruleId = levelId;
  let RULE = BOUND_RULES[levelId];
  if (!RULE) { ruleId = 'town'; RULE = BOUND_RULES.town; }
  const CELL = CELL_ARG ?? RULE.cell;
  const cls = RULE.build(L, w);
  const authoredTag = cls.authored;
  const inPlayAt = cls.inPlay;
  const MAXSURF = RULE.surfaces;

  // ------------------------------------------------------------- the grid --
  const EXT = RULE.ext(L, w);
  const nx = Math.ceil((EXT * 2) / CELL) + 1;
  const nz = nx;
  const idx = (ix, iz) => iz * nx + ix;
  const lxOf = (ix) => -EXT + ix * CELL;
  const lzOf = (iz) => -EXT + iz * CELL;

  /** Lazily-evaluated surface columns: cellNodes[ci] = [node…] or undefined. */
  const cellNodes = new Array(nx * nz);
  const nodeY = [], nodeCell = [], nodeSurf = [];
  let rays = 0;
  const column = (ci) => {
    let list = cellNodes[ci];
    if (list !== undefined) return list;
    list = [];
    const ix = ci % nx, iz = (ci / nx) | 0;
    const lx = lxOf(ix), lz = lzOf(iz);
    w.levelToWorld(lx, 0, lz, _wp);
    /** Both ends of the scan are the map's to choose. @see `BOUND_RULES`. */
    const top = RULE.scanTop(lx, lz, w);
    const floor = RULE.scanFloor(lx, lz, w);
    let from = top;
    for (let s = 0; s < MAXSURF; s++) {
      rays++;
      const hit = phys.raycast(_wp.x, from, _wp.z, 0, -1, 0, from - floor + PROBE_UNDER, MASK);
      if (!hit.hit) break;
      const fy = hit.point.y;
      if (fy < floor) break;
      from = fy - 0.06;
      // A floor faces up. The BVH reports backfaces, so a downward ray through
      // a slab hands back its underside too — see the same note in floorcheck.
      if (hit.normal && hit.normal.y < 0.5) continue;
      _a.set(_wp.x, fy + STEP + R, _wp.z);
      _b.set(_wp.x, fy + H - R + 0.02, _wp.z);
      if (!phys.checkCapsule(_a, _b, R - 0.005, MASK)) continue;
      list.push(nodeY.length);
      nodeY.push(fy); nodeCell.push(ci); nodeSurf.push(hit.surface);
      if (from < floor) break;
    }
    cellNodes[ci] = list;
    return list;
  };

  /** Nothing solid between two nodes at the height of the higher one. */
  const clearBetween = (lo, hi) => {
    const lc = nodeCell[lo], hc = nodeCell[hi];
    w.levelToWorld(lxOf(lc % nx), 0, lzOf((lc / nx) | 0), _a);
    w.levelToWorld(lxOf(hc % nx), 0, lzOf((hc / nx) | 0), _b);
    const dx = _b.x - _a.x, dz = _b.z - _a.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return true;
    rays++;
    return !phys.raycast(_a.x, nodeY[hi] + 0.3, _a.z, dx / d, 0, dz / d, d, MASK).hit;
  };

  /** Cached authored-content tag per SURFACE (a roof and the street below it are
   *  not the same answer). */
  const tags = [];
  const tagOf = (k) => {
    let t = tags[k];
    if (t !== undefined) return t;
    const ci = nodeCell[k];
    t = authoredTag(lxOf(ci % nx), lzOf((ci / nx) | 0), SLACK, nodeSurf[k]);
    tags[k] = t;
    return t;
  };
  /** Cached "is this the play area" per surface. */
  const inPlay = [];
  const playOf = (k) => {
    let t = inPlay[k];
    if (t !== undefined) return t;
    const ci = nodeCell[k];
    t = inPlayAt(lxOf(ci % nx), lzOf((ci / nx) | 0), nodeSurf[k]);
    inPlay[k] = t;
    return t;
  };

  // ---------------------------------------------------------- the flood --
  const seedNodes = [];
  const seedInfo = [];
  for (const sp of w.spawnPoints ?? []) {
    const q = w.worldToLevel(sp.position.x, sp.position.y, sp.position.z, _wq);
    const ix = Math.round((q.x + EXT) / CELL), iz = Math.round((q.z + EXT) / CELL);
    let best = -1, bestD = Infinity;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        for (const k of column(idx(jx, jz))) {
          const d = dx * dx + dz * dz + Math.abs(nodeY[k]) * 4;
          if (d < bestD) { bestD = d; best = k; }
        }
      }
    }
    seedInfo.push({ lx: +q.x.toFixed(1), lz: +q.z.toFixed(1), ok: best >= 0 });
    if (best >= 0) seedNodes.push(best);
  }

  const RING = Math.ceil(MREACH / CELL);
  let popped = 0;
  /**
   * One flood. `authoredOnly` is what makes the LEAK report meaningful: run it
   * once with the whole level open and once confined to authored ground, and the
   * difference is exactly the set of places the player leaves the map — a 2000 m²
   * field of sand has a skirt of "authored" cells against every background block
   * standing in it, so asking which void cells touch authored ground finds the
   * whole outline of the field. Asking which void cells touch ground the player
   * can reach WITHOUT crossing void finds the door he went through.
   */
  const flood = (authoredOnly, pred = null) => {
    const seen = new Set();
    const queue = [];
    let head = 0;
    let cur = -1;
    const push = (k) => {
      if (seen.has(k)) return;
      if (authoredOnly && !playOf(k)) return;
      seen.add(k); queue.push(k);
      if (pred) pred.set(k, cur);
    };
    for (const s of seedNodes) push(s);
    // BREADTH first, so `pred` is the shortest walk the player could take and
    // the crossing it names is the one he actually went through.
    while (head < queue.length) {
      cur = queue[head++];
      popped++;
      const ci = nodeCell[cur], y = nodeY[cur];
      const ix = ci % nx, iz = (ci / nx) | 0;
      for (let dz = -RING; dz <= RING; dz++) {
        for (let dx = -RING; dx <= RING; dx++) {
          if (dx === 0 && dz === 0) continue;
          const step1 = Math.abs(dx) + Math.abs(dz) === 1;
          if (!step1 && Math.hypot(dx, dz) * CELL > MREACH) continue;
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          for (const k of column(idx(jx, jz))) {
            if (seen.has(k)) continue;
            const dy = nodeY[k] - y;
            const ady = Math.abs(dy);
            if (ady <= STEP) { if (step1) push(k); continue; }
            if (dy > 0) {
              if (dy > MANTLE_UP) continue;
              if (!step1 && !clearBetween(cur, k)) continue;
              push(k);
            } else {
              if (ady > DROP_MAX) continue;
              if (!step1 && !clearBetween(k, cur)) continue;
              push(k);
            }
          }
        }
      }
    }
    return seen;
  };

  const pred = new Map();
  const seen = flood(false, pred);
  const play = flood(true);
  const playCells = new Set();
  for (const k of play) playCells.add(nodeCell[k]);

  // ------------------------------------------------------- classification --
  /** One entry per REACHED cell (a cell counts once however many surfaces). */
  const reachedCell = new Map(); // ci -> { lx, lz, y, tag }
  for (const k of seen) {
    const ci = nodeCell[k];
    const prev = reachedCell.get(ci);
    if (prev && prev.y <= nodeY[k]) continue;
    const lx = lxOf(ci % nx), lz = lzOf((ci / nx) | 0);
    reachedCell.set(ci, { lx, lz, y: nodeY[k], tag: tagOf(k) });
  }

  const voidCells = [];
  for (const [ci, e] of reachedCell) if (e.tag === null) voidCells.push(ci);
  const voidSet = new Set(voidCells);

  /** Connected void regions, 8-connected, so a field is one number. */
  const regions = [];
  const done = new Set();
  for (const start of voidCells) {
    if (done.has(start)) continue;
    const q = [start]; done.add(start);
    let n = 0, sx = 0, sz = 0, far = 0, farAt = null;
    while (q.length) {
      const ci = q.pop(); n++;
      const e = reachedCell.get(ci);
      sx += e.lx; sz += e.lz;
      const d = Math.hypot(e.lx, e.lz);
      if (d > far) { far = d; farAt = [Math.round(e.lx), Math.round(e.lz)]; }
      const ix = ci % nx, iz = (ci / nx) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = idx(ix + dx, iz + dz);
          if (voidSet.has(j) && !done.has(j)) { done.add(j); q.push(j); }
        }
      }
    }
    regions.push({
      area: +(n * CELL * CELL).toFixed(1), cells: n,
      centre: [Math.round(sx / n), Math.round(sz / n)], far: +far.toFixed(1), farAt,
    });
  }
  regions.sort((a, b) => b.area - a.area);

  /**
   * THE LEAKS — where the play area joins the void.
   *
   * A void region 2000 m² across is not fixed by walling 2000 m²; it is fixed by
   * closing the handful of places the player gets OUT. So every void cell that
   * touches authored ground is a crossing, and they are clustered at 5 m so one
   * gap between two blocks reports as one line with a position you can build at.
   */
  const leaks = [];
  const crossOf = new Map();   // node -> the crossing node its path used
  const crossing = (k) => {
    if (crossOf.has(k)) return crossOf.get(k);
    const chain = [];
    let cur = k, found = -1;
    while (cur !== undefined && cur >= 0) {
      if (crossOf.has(cur)) { found = crossOf.get(cur); break; }
      if (play.has(cur)) { found = chain.length ? chain[chain.length - 1] : -1; break; }
      chain.push(cur);
      cur = pred.get(cur);
    }
    for (const n of chain) crossOf.set(n, found);
    crossOf.set(k, found);
    return found;
  };
  const byCross = new Map();
  for (const ci of voidCells) {
    // the surface in this cell that the flood actually stood on
    let node = -1;
    for (const k of column(ci)) if (seen.has(k)) { node = k; break; }
    if (node < 0) continue;
    const x = crossing(node);
    if (x < 0) continue;
    byCross.set(x, (byCross.get(x) ?? 0) + 1);
  }
  for (const [k, n] of byCross) {
    const ci = nodeCell[k];
    const lx = lxOf(ci % nx), lz = lzOf((ci / nx) | 0);
    const near = leaks.find((e) => Math.hypot(e.lx - lx, e.lz - lz) < 5);
    if (near) { near.n += n; continue; }
    leaks.push({ lx: Math.round(lx), lz: Math.round(lz), y: +nodeY[k].toFixed(2), from: nodeSurf[k], n });
  }
  leaks.sort((a, b) => b.n - a.n);

  // ------------------------------------------------------------- bearings --
  /**
   * How far out each way. The centre of the play area is the origin of level
   * space by construction (the mid street runs through x 0), so a bearing is
   * simply an angle from there; each reached cell is binned into the nearest
   * bearing and the furthest one wins.
   */
  const NB = 64;
  const bear = [];
  for (let i = 0; i < NB; i++) bear.push({ deg: Math.round((i * 360) / NB), d: 0, at: null, tag: null, voidD: 0, voidAt: null });
  for (const [, e] of reachedCell) {
    const d = Math.hypot(e.lx, e.lz);
    if (d < 1) continue;
    let a = (Math.atan2(e.lz, e.lx) * 180) / Math.PI;
    if (a < 0) a += 360;
    const b = bear[Math.round((a / 360) * NB) % NB];
    if (d > b.d) { b.d = +d.toFixed(1); b.at = [Math.round(e.lx), Math.round(e.lz)]; b.tag = e.tag; }
    if (e.tag === null && d > b.voidD) { b.voidD = +d.toFixed(1); b.voidAt = [Math.round(e.lx), Math.round(e.lz)]; }
  }

  return {
    /** ECHOED FROM INSIDE THE PAGE, never from the query string. A truncating
     *  `split('=')` in this repo's probes has already turned `?map=plains` into
     *  `?map` once and run the town while reporting the plain. */
    level: { id: levelId, name: w.level?.name ?? null, rule: ruleId, note: cls.note },
    grid: { cell: CELL, nx, nz, ext: +EXT.toFixed(1) },
    cost: { rays, popped, nodes: nodeY.length, columns: cellNodes.reduce((a, v) => a + (v === undefined ? 0 : 1), 0) },
    seeds: seedInfo,
    reached: reachedCell.size,
    reachedArea: +(reachedCell.size * CELL * CELL).toFixed(0),
    voidArea: +(voidCells.length * CELL * CELL).toFixed(0),
    regions: regions.slice(0, 14),
    regionCount: regions.length,
    leaks: leaks.slice(0, 24),
    leakCount: leaks.length,
    bearings: bear,
    /** The plan view, decimated to keep the dump readable. */
    map: (() => {
      const stride = Math.max(1, Math.round(1.6 / CELL));
      const rows = [];
      for (let iz = nz - 1; iz >= 0; iz -= stride) {
        let s = '';
        for (let ix = 0; ix < nx; ix += stride) {
          let ch = ' ';
          for (let dz = 0; dz < stride; dz++) {
            for (let dx = 0; dx < stride; dx++) {
              const e = reachedCell.get(idx(ix + dx, iz - dz));
              if (!e) continue;
              if (e.tag === null) { ch = 'X'; } else if (ch !== 'X') ch = 'o';
            }
          }
          s += ch;
        }
        rows.push(s);
      }
      return rows;
    })(),
  };
}, { CELL_ARG: CELL, SLACK });

if (!report || report.err) {
  console.log('[boundcheck]', report?.err ?? 'no report');
  await browser.close(); process.exit(2);
}

console.log(`\n  MAP "${report.level.id}" — ${report.level.name}`);
console.log(`  classified by BOUND_RULES.${report.level.rule}: ${report.level.note}`);
if (report.level.rule !== report.level.id) {
  console.log(`  !! no BOUND_RULES entry for "${report.level.id}" — falling back to the town's`);
}
console.log(`  grid ${report.grid.nx}x${report.grid.nz} @ ${report.grid.cell} m over level ±${report.grid.ext} m`);
console.log(`  ${report.cost.rays} rays, ${report.cost.columns} columns sampled, ${report.cost.nodes} standable surfaces`);
const badSeed = report.seeds.filter((s) => !s.ok);
if (badSeed.length) console.log(`  !! ${badSeed.length} seed(s) had no standable surface: ${JSON.stringify(badSeed)}`);
console.log(`\n  the player can stand on ${report.reached} cells — ${report.reachedArea} m² of level`);
console.log(`  of that, ${report.voidArea} m² is further than ${SLACK} m from anything authored`);

console.log(`\n  VOID REGIONS — reachable ground with no authored content in it (${report.regionCount} total)`);
console.log('   area m²   cells   centre (level)     furthest point');
for (const r of report.regions) {
  console.log(
    `  ${String(r.area).padStart(8)}  ${String(r.cells).padStart(6)}   ` +
    `[${String(r.centre[0]).padStart(5)},${String(r.centre[1]).padStart(5)}]      ` +
    `[${String(r.farAt?.[0]).padStart(5)},${String(r.farAt?.[1]).padStart(5)}] at ${r.far} m` +
    (r.area > MAXVOID ? '   <-- TOO BIG' : '')
  );
}
if (!report.regions.length) console.log('        (none)');

console.log(`\n  LEAKS — where authored ground joins the void (${report.leakCount} crossings)`);
console.log('    at (level)      floor y   cells   from');
for (const k of report.leaks) {
  console.log(`   [${String(k.lx).padStart(5)},${String(k.lz).padStart(5)}]    ${String(k.y).padStart(6)}   ${String(k.n).padStart(5)}   ${k.from}`);
}
if (!report.leaks.length) console.log('        (none)');

const step = Math.max(1, Math.round(report.bearings.length / 32));
console.log('\n  HOW FAR OUT — the furthest the flood gets on each bearing from the middle');
console.log('   bearing    reach    at (level)        what is there');
for (let i = 0; i < report.bearings.length; i += step) {
  const b = report.bearings[i];
  console.log(
    `  ${String(b.deg).padStart(6)}°  ${String(b.d).padStart(7)}   ` +
    `[${String(b.at?.[0] ?? '-').padStart(5)},${String(b.at?.[1] ?? '-').padStart(5)}]   ` +
    (b.tag ?? '<-- VOID') + (b.voidD ? `   (void out to ${b.voidD} m)` : '')
  );
}

if (args.map) {
  console.log("\n  plan view — 'o' reachable authored ground, 'X' reachable VOID, +x right, +z up");
  for (const r of report.map) console.log('   ' + r);
}
if (VERBOSE) console.log('\n[boundcheck] raw', JSON.stringify(report.regions, null, 1));

const big = report.regions.filter((r) => r.area > MAXVOID);
const voidBearings = report.bearings.filter((b) => b.tag === null).length;
console.log(`\n  void regions over ${MAXVOID} m²: ${big.length}   bearings ending in void: ${voidBearings}/${report.bearings.length}`);
console.log(
  big.length || badSeed.length
    ? `\n[boundcheck] FAIL — ${big.length} region(s) of empty reachable ground, largest ${big[0]?.area ?? 0} m²`
    : `\n[boundcheck] PASS — everywhere the player can walk is authored ground (${report.voidArea} m² of slop in ${report.regionCount} pockets, none over ${MAXVOID} m²)`
);
if (errs.length) console.log('\n[boundcheck] page errors', errs.slice(0, 4));
await browser.close();
process.exit(big.length || badSeed.length || errs.length ? 1 : 0);
