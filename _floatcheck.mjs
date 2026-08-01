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
 *   1. COLUMNS. Over a lattice, walk straight down through the world collecting
 *      EVERY hit, front faces and back. `src/physics/bvh.js` does not cull
 *      backfaces (bullet penetration needs exit hits) and reports `frontFace`,
 *      so a front face is a solid being ENTERED and a back face one being LEFT.
 *      Counting depth turns that into the exact list of solid intervals in the
 *      column, and it stays exact through overlapping boxes — which is what the
 *      whole map is made of.
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
 *   5. A component with no supported node in it is standing on nothing. That is
 *      the bug, and it is reported with its extent, its height and the metres of
 *      open air under it.
 *
 * THE ONE RULE THAT MATTERS IS THAT A SKY NODE NEVER JOINS A GROUND NODE
 * LATERALLY, and it is not fastidiousness. A ray that clips the corner of a box
 * can miss its exit face, and one such column anywhere in a 17 000-column sweep
 * produces a single interval running from the top of the rubble all the way into
 * the terrain — which, under plain Y-overlap linking, welds the sky to the
 * ground and the sweep comes back clean. That is exactly what the first version
 * of this file did on the bug it was written for: 16 900 columns, ONE component,
 * "OK", with a solid mass sitting 7.2 m up in open air inside it.
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
 *   --region=all   both.
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
 *   --fire=cath   run the real collapse: let the match reach `live`, call
 *                 `callCathedralCollapse`, raze the shell, wait past `SETTLE_AT`
 *                 so the settled pose is baked and its collision is on, sweep.
 *   --fire=all    the above plus `callEverything` — every site and every
 *                 district block, which is the state `--region=all` wants.
 *
 * Exit code 1 if anything floats. `?seed=N` pins the level dice, so a find is
 * reproducible: the seed of the boot is printed either way.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
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
const SEED = args.seed;
/** '' | 'cath' | 'all' — run the real event instead of the boot flag. */
const FIRE = args.fire === true ? 'cath' : (args.fire ?? '');

/** The flags each region needs so the thing it measures has actually happened. */
const FLAGS = {
  cath: ['cath=down'],
  demo: ['demo=down'],
  all: ['cath=down', 'demo=down'],
};

function url(region) {
  // With --fire the events do the work; booting already-down would put the
  // shell away before the strike that is supposed to knock it down.
  const q = FIRE ? [] : [...(FLAGS[region] ?? [])];
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
  await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
  await sleep(400);
  await page.evaluate(() => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    m.roundClock = 1e6;
    m._checkWinConditions = () => {};
    m.airstrike.enabled = true;
    m._cathedralCalled = true;
    m.airstrike.callCathedralCollapse();
    // Forcing `_cathedralCalled` skips the branch that arms `_razeIn`, so
    // without these two the sweep runs on a map whose church is still standing.
    m._razeCathedral();
    m._openCathedral();
    e.time.scale = 4;
  });
  // 1.34 s of stagger + `SETTLE_AT` 6.5 s of match time, at 4x, with slack —
  // `_bakeSettled` is what turns the mound's collision on, so a sweep run
  // before it has fired measures a map the event has not finished happening to.
  await page.waitForFunction(
    "window.__ENGINE__.ctx.peek('match').airstrike.sites.filter(s=>s.baked).length>=3",
    null,
    { timeout: 60000 }
  );
  if (FIRE === 'all') {
    await page.evaluate(() => {
      const m = window.__ENGINE__.ctx.peek('match');
      m._finalCalled = true;
      m.airstrike.callEverything(0.4);
    });
    await sleep(9000);
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
  ({ REGION, GRID, TOL, MIN_CELLS, GROUND, APRON, NEED_ATTACH }) => {
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
    if (!regions.length) return { error: 'no region' };

    /* ---- one column of solid intervals ------------------------------- */
    const TOP = 44;
    /** Well under any floor on this map, so "the world" is unbounded below. */
    const BOTTOM = -6;
    /** Two hits closer than this are one surface seen twice; the ray has to be
     *  nudged past a hit to make progress. @see the note on closure below. */
    const NUDGE = 2e-3;

    let anomalies = 0;

    const ys = [];
    const fs = [];
    /**
     * ────────────────────────────────────────────────────────────────────────
     * CLOSURE IS THE FIRST BACK FACE, NOT A DEPTH COUNT — COINCIDENT FACES
     * ────────────────────────────────────────────────────────────────────────
     * Counting depth (+1 per front face, -1 per back) reconstructs overlapping
     * boxes exactly, and it was the first thing this file did. It is wrong here,
     * and the reason is that a closest-hit ray has to be RESTARTED past each hit
     * to find the next one — so every face sharing a plane with the one that was
     * returned is behind the new origin and is never seen at all.
     *
     * `Airstrike._buildMoundProxy` builds ten boxes ALL SUNK TO THE SAME
     * `mound.y - 0.25`: three tops at three heights, ten undersides on one
     * plane. Depth counts three entries and one exit, never returns to zero, and
     * the mound is reported as a single solid running from its own crown down
     * into the terrain ten metres below — i.e. as standing on the ground. That
     * is a FALSE NEGATIVE on exactly the bug this file exists for, and no size
     * of nudge fixes it: below the plane the partners are behind you and above
     * it you have not moved.
     *
     * So a solid is opened by a front face while outside and closed by the FIRST
     * back face after it, whatever happens in between. Coincident undersides
     * close correctly (the first one is the underside). Overlapping boxes with
     * staggered undersides close early — the remainder is then measured as the
     * next thing down and reads as a joint rather than as air, which is the safe
     * direction: it can under-report a piece's thickness, never invent daylight.
     */
    const column = (x, z, out) => {
      out.length = 0;
      ys.length = 0;
      fs.length = 0;
      let y = TOP;
      for (let guard = 0; guard < 400 && y > BOTTOM; guard++) {
        const h = ph.raycast(x, y, z, 0, -1, 0, y - BOTTOM, MASK);
        if (!h.hit) break;
        ys.push(h.point.y);
        fs.push(h.frontFace ? 1 : 0);
        const ny = h.point.y - NUDGE;
        if (ny >= y) break;
        y = ny;
      }
      let inside = false;
      let top = 0;
      for (let i = 0; i < ys.length; i++) {
        if (fs[i]) {
          if (!inside) { top = ys[i]; inside = true; }
        } else if (inside) {
          out.push(top, ys[i]);
          inside = false;
        } else {
          // a back face while outside: a single-sided surface, or the partner
          // of a front face that shared a plane with an earlier hit
          anomalies++;
        }
      }
      // Never closed: whatever this is, it reaches the bottom of the sweep.
      if (inside) out.push(top, BOTTOM);
      return out;
    };

    /* ---- sweep every region, keeping only what is off the ground ----- */
    const nodes = []; // one per solid interval ENTIRELY above the ground plane
    const index = new Map(); // `${r}:${ix}:${iz}` -> [nodeIds]
    /** `${r}:${ix}:${iz}` -> the top of the tallest GROUND interval there. */
    const stand = new Map();
    const tmp = [];
    let rays = 0;
    let intervals = 0;
    let groundNodes = 0;
    const t0 = performance.now();

    for (let b = 0; b < regions.length; b++) {
      const rg = regions[b];
      const groundY = rg.floorY + GROUND;
      const nx = Math.max(1, Math.round((rg.hw * 2) / GRID));
      const nz = Math.max(1, Math.round((rg.hd * 2) / GRID));
      for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
          /**
           * JITTERED OFF THE LATTICE, DETERMINISTICALLY.
           *
           * A ray fired exactly down a shared edge between two boxes can hit
           * one face and miss its partner, and the depth count then never
           * returns to zero — the piece fuses to the terrain and reads as
           * standing on it. On a 0.5 m lattice over a map built out of boxes
           * that alignment is not rare, it is systematic. A fixed hash of the
           * cell index moves each column a fifth of a cell off the grid, which
           * costs nothing and is still the same sweep on every run.
           */
          const h = ((ix * 73856093) ^ (iz * 19349663) ^ (b * 83492791)) >>> 0;
          const u = -rg.hw + (ix + 0.5) * GRID + (((h & 1023) / 1023) - 0.5) * GRID * 0.4;
          const v = -rg.hd + (iz + 0.5) * GRID + ((((h >>> 10) & 1023) / 1023) - 0.5) * GRID * 0.4;
          const x = rg.cx + u * rg.c + v * rg.s;
          const z = rg.cz - u * rg.s + v * rg.c;
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
        };
        comp.set(r, c);
      }
      const n = nodes[i];
      c.n++;
      c.cells.add(`${n.ix}:${n.iz}`);
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
      skyNodes: nodes.length,
      components: comp.size,
      anomalies,
      floating,
      total: floating.reduce((s, f) => s + f.cells, 0),
    };
  },
  { REGION, GRID, TOL, MIN_CELLS, GROUND, APRON, NEED_ATTACH }
);

await browser.close();

/* -------------------------------------------------------------------------- */

if (args.json) {
  console.log(JSON.stringify({ levelSeed, ...result }, null, 2));
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
        (result.anomalies ? `  ·  ${result.anomalies} single-sided surfaces ignored` : '')
    );
    if (args.audit) {
      console.log('  tallest pieces off the ground:');
      for (const a of result.audit) console.log(`    ${JSON.stringify(a)}`);
    }
    if (!result.floating.length) {
      console.log('  OK — every solid in the sweep is connected to the ground.\n');
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
            `${(f.at[0] + ',' + f.at[1]).padEnd(15)} ${f.owner ?? ''}`
        );
      }
      if (result.floating.length > 40) console.log(`    … and ${result.floating.length - 40} more`);
      console.log('');
    }
  }
}
if (errs.length) {
  console.log(`  ${errs.length} PAGE ERROR(S):`);
  for (const s of errs.slice(0, 5)) console.log(`    ${s}`);
}
process.exit(result?.floating?.length ? 1 : 0);
