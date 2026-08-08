/**
 * ════════════════════════════════════════════════════════════════════════════
 * IS THERE GROUND EVERYWHERE — ASKED OF THE WORLD THE PLAYER ACTUALLY FALLS
 * THROUGH, WHICH IS THE TRIANGLE BVH AND NOTHING ELSE.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfholebvh.mjs [--url=…] [--step=1] [--r=170]
 *
 * 「あとたまに穴があって次元のはざまに落とされるぞ」
 *
 * `_nfhole.mjs` fires `physics.raycast(…, MASK.WORLD)` and reports 0 holes on
 * this build. That is a true statement about a DIFFERENT WORLD from the one the
 * character moves in, and the difference is the whole reason "たまに" —
 * sometimes:
 *
 *   `Physics.raycast` tries the BVH, then `_raycastColliders`, then
 *   `_raycastBodies` (src/physics/index.js:497-511). It hits proxy boxes.
 *   `CharacterController` is constructed on `this.staticWorld` alone
 *   (src/physics/index.js:744) and moves with `sweepCapsule` / `overlapCapsule`,
 *   which consult NO COLLIDER LIST.
 *
 * So an `A.box(...)` proxy over a gap in the terrain mesh answers the ray and
 * holds up NOBODY. A hole in the BVH is a hole in the world even where a proxy
 * exists, and a probe built on `physics.raycast` cannot see it. This fires the
 * same lattice against `physics.staticWorld.raycast` directly.
 *
 * It also reports, separately, cells where the two DISAGREE — BVH says nothing,
 * the full raycast says something. Those are the dangerous ones: they look
 * solid to every other tool on the map and to the nav grid's ray, and they are
 * air to a man's feet. A pass is zero of both.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND A TOP-DOWN RAY CANNOT SEE THE FLOOR YOU ARE STANDING ON, WHICH IS PHASE 2
 * ────────────────────────────────────────────────────────────────────────────
 * One ray from y 120 stops at the FIRST thing it meets. Over the fortress that
 * is the parapet; over the tower it is the cab roof. A missing tile in a deck,
 * a stair landing or a magazine floor is under all of that and the sweep above
 * reports "ground present" for the cell, correctly and uselessly. 「たまに穴が
 * あって次元のはざまに落とされる」 — SOMETIMES — is the shape of exactly this: a
 * small number of places, not a systematic gap, and every one of them somewhere
 * a man is standing rather than somewhere he is looking.
 *
 * So phase 2 walks the WHOLE column at each cell, collects every up-facing
 * surface in it, and asks a question a single ray cannot: is there a cell with
 * NO surface at a height where three or four of its four neighbours have one?
 * That is a missing tile in an otherwise continuous floor — as opposed to an
 * EDGE, where the floor simply stops and one or two neighbours carry it, which
 * is what every roof, parapet, trench lip and stair nosing on the map is.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4625/?map=plains';
const STEP = Number(args.step ?? 1);
const R = Number(args.r ?? 170);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level.id=${level}   url=${URL}`);

const out = await p.evaluate(([STEP, R]) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const sw = ph.staticWorld;
  const MASK = ph.MASK.WORLD;
  const gy = e.ctx.peek('world').level?.groundY ?? (() => 0);
  const holes = [];        // nothing in the BVH at all
  const proxyOnly = [];    // nothing in the BVH, but the full raycast finds mass
  const o = {};
  let cells = 0;
  for (let z = -R; z <= R; z += STEP) {
    for (let x = -R; x <= R; x += STEP) {
      if (x * x + z * z > R * R) continue;
      cells++;
      // from over the tallest thing on the plain, down past the deepest cut
      if (sw.raycast(x, 120, z, 0, -1, 0, 200, MASK, o)) continue;
      const full = ph.raycast(x, 120, z, 0, -1, 0, 200, MASK);
      (full.hit ? proxyOnly : holes).push([x, z, +gy(x, z).toFixed(1), full.hit ? +full.point.y.toFixed(1) : null]);
    }
  }
  return { cells, holes, proxyOnly };
}, [STEP, R]);

/** Cluster the misses, so sixty-six trench mouths read as sixty-six lines. */
const cluster = (list) => {
  const seen = new Set(list.map(([x, z]) => `${x},${z}`));
  const by = new Map(list.map((c) => [`${c[0]},${c[1]}`, c]));
  const cl = [];
  for (const [x, z] of list) {
    const k = `${x},${z}`;
    if (!seen.has(k)) continue;
    const q = [[x, z]]; seen.delete(k);
    const cells = [];
    while (q.length) {
      const [cx, cz] = q.pop(); cells.push(by.get(`${cx},${cz}`));
      for (let dz = -STEP; dz <= STEP; dz += STEP) for (let dx = -STEP; dx <= STEP; dx += STEP) {
        const kk = `${cx + dx},${cz + dz}`;
        if (seen.has(kk)) { seen.delete(kk); q.push([cx + dx, cz + dz]); }
      }
    }
    const mx = cells.reduce((a, c) => a + c[0], 0) / cells.length;
    const mz = cells.reduce((a, c) => a + c[1], 0) / cells.length;
    const x0 = Math.min(...cells.map((c) => c[0])), x1 = Math.max(...cells.map((c) => c[0]));
    const z0 = Math.min(...cells.map((c) => c[1])), z1 = Math.max(...cells.map((c) => c[1]));
    cl.push({ n: cells.length, x: +mx.toFixed(0), z: +mz.toFixed(0), x0, x1, z0, z1, sample: cells[0] });
  }
  cl.sort((a, c) => c.n - a.n);
  return cl;
};

const hc = cluster(out.holes);
const pc = cluster(out.proxyOnly);
console.log(`\n  ${out.cells} lattice cells swept inside r ${R} at ${STEP} m`);
console.log(`\n  NO TRIANGLE UNDER THEM AT ALL — a man walking here falls out of the map:`);
console.log(`  ${out.holes.length} cells in ${hc.length} clusters`);
for (const c of hc.slice(0, 30)) {
  console.log(`    ${String(c.n).padStart(5)} cells around (${c.x}, ${c.z})   x ${c.x0}..${c.x1}  z ${c.z0}..${c.z1}   plain ${c.sample[2]}`);
}
if (hc.length > 30) console.log(`    …and ${hc.length - 30} more`);
console.log(`\n  BVH EMPTY BUT A PROXY ANSWERS — solid to every ray on the map, air to his feet:`);
console.log(`  ${out.proxyOnly.length} cells in ${pc.length} clusters`);
for (const c of pc.slice(0, 30)) {
  console.log(`    ${String(c.n).padStart(5)} cells around (${c.x}, ${c.z})   x ${c.x0}..${c.x1}  z ${c.z0}..${c.z1}   plain ${c.sample[2]}, proxy top ${c.sample[3]}`);
}
if (pc.length > 30) console.log(`    …and ${pc.length - 30} more`);
/* -------------------------------------------------------------------------- */
/* PHASE 2 — A MISSING TILE IN A FLOOR THE TOP-DOWN RAY NEVER REACHES          */
/* -------------------------------------------------------------------------- */
const TSTEP = Number(args.tstep ?? 0.5);
/** Metres a neighbour's floor may differ and still be "the same floor". */
const SAME = Number(args.same ?? 0.6);
/** Metres of drop under a gap before falling through it is worth reporting. */
const DROP = Number(args.drop ?? 3.0);
/** Metres over `plainsY` before a surface is a DECK and not a face of the ground. */
const DECK = Number(args.deck ?? 2.0);

const floors = await p.evaluate(([STEP, R, SAME, DROP, DECK]) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const sw = ph.staticWorld;
  const MASK = ph.MASK.WORLD;
  const gy = e.ctx.peek('world').level?.groundY ?? (() => 0);
  const N = Math.round((R * 2) / STEP) + 1;
  const key = (i, j) => j * N + i;
  const surf = new Map();          // cell -> sorted array of up-facing y
  const o = {};
  for (let j = 0; j < N; j++) {
    const z = -R + j * STEP;
    for (let i = 0; i < N; i++) {
      const x = -R + i * STEP;
      if (x * x + z * z > R * R) continue;
      const floorY = gy(x, z) - 14;
      const ys = [];
      let from = 120;
      for (let k = 0; k < 12; k++) {
        if (!sw.raycast(x, from, z, 0, -1, 0, from - floorY, MASK, o)) break;
        const y = o.py;
        if (!isFinite(y) || y < floorY) break;
        // up-facing only: a wall's side is not a floor
        if (o.ny > 0.5) ys.push(y);
        from = y - 0.04;
      }
      if (ys.length) surf.set(key(i, j), ys);
    }
  }
  /**
   * A HOLE is a cell with no surface at a height where THREE OR FOUR of its
   * four orthogonal neighbours have one, and with a real drop under it. Two
   * neighbours is a floor's edge and is every roof, lip and landing on the map.
   */
  const holes = [];
  const at = (i, j) => (i < 0 || j < 0 || i >= N || j >= N ? undefined : surf.get(key(i, j)));
  const near = (ys, y) => !!ys && ys.some((v) => Math.abs(v - y) <= SAME);
  /**
   * CAN A MAN STANDING AT `y` FALL `DROP` METRES HERE? — and this, not "is
   * there a surface at exactly y", is the question. The first draft asked
   * whether the gap cell had a surface within ±SAME of the neighbour's floor
   * and, finding none, looked only BELOW y for something to land on. On any
   * slope steeper than SAME/STEP (about 50°, which is every trench wall and
   * every swell shoulder on this map) the gap cell's own perfectly solid ground
   * sits just ABOVE y, was never looked at, and the cell was reported as a void
   * with nothing under it. 384 of the 384 hits on the first run were that.
   * A cell is only a hole if it has NO surface at all above `y - DROP`.
   */
  const canFall = (ys, y) => !ys || !ys.some((v) => v > y - DROP);
  for (const [k, ys] of surf) {
    const i = k % N, j = Math.floor(k / N);
    const x = -R + i * STEP, z = -R + j * STEP;
    for (const y of ys) {
      /**
       * DECKS ONLY, AND THE LIMIT IS WRITTEN DOWN RATHER THAN QUIETLY APPLIED.
       * Within a couple of metres of `plainsY` this test cannot tell a hole
       * from a steep face: a trench wall is a legitimate BVH surface that is
       * not a floor, its cell therefore stores nothing at all, and the cell
       * beside it reads as a void. 222 of the second run's 222 hits were trench
       * walls and swell shoulders. Above the terrain there is no such ambiguity
       * — a surface 2 m up IS a deck, a landing or a bridge — and that is
       * exactly the class phase 1's single top-down ray cannot see, which is
       * the whole reason phase 2 exists. Holes AT ground level are phase 1's,
       * and phase 1 is exhaustive there: 608 181 cells at 0.4 m, zero misses.
       */
      if (y - gy(x, z) < DECK) continue;
      // the cell that is MISSING the floor is the one being judged, so look one
      // step out: a neighbour with no floor here whose own neighbours have one
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const gi = i + di, gj = j + dj;
        if (gi < 0 || gj < 0 || gi >= N || gj >= N) continue;
        const gys = at(gi, gj);
        if (!canFall(gys, y)) continue;                    // solid enough to stand on
        const gx = -R + gi * STEP, gz = -R + gj * STEP;
        if (gx * gx + gz * gz > R * R) continue;
        // how many of the GAP cell's own four neighbours carry this floor?
        let held = 0;
        for (const [ei, ej] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (near(at(gi + ei, gj + ej), y)) held++;
        }
        if (held < 3) continue;                            // an edge, not a hole
        const below = gys ? gys.filter((v) => v < y).sort((a, c) => c - a)[0] : undefined;
        const drop = below === undefined ? 99 : y - below;
        holes.push({ x: +gx.toFixed(1), z: +gz.toFixed(1), y: +y.toFixed(2), held, drop: +drop.toFixed(1), ground: +gy(gx, gz).toFixed(1) });
      }
    }
  }
  // de-duplicate: the same gap is found from up to four sides
  const uniq = new Map();
  for (const h of holes) {
    const kk = `${h.x},${h.z},${h.y.toFixed(0)}`;
    const cur = uniq.get(kk);
    if (!cur || h.held > cur.held) uniq.set(kk, h);
  }
  return { cells: surf.size, holes: [...uniq.values()].sort((a, c) => c.drop - a.drop) };
}, [TSTEP, R, SAME, DROP, DECK]);

/**
 * PHASE 2 IS A CANDIDATE LIST AND NOT A GATE, AND THE DIFFERENCE IS WRITTEN
 * HERE RATHER THAN DISCOVERED BY THE NEXT READER.
 *
 * "Three of four neighbours carry this floor" is a heuristic for "a tile is
 * missing from the middle of a floor", and it has two known false positives
 * that inspection — not tuning — is the answer to:
 *
 *   A STAIR. Treads 0.19 m apart in Y and 0.5 m apart in plan are all "the same
 *   floor" at SAME 0.6, so the cell beside a flight has three neighbours
 *   carrying it and no tread of its own. Every hit on the control tower's four
 *   climbs is this.
 *   A SMALL ROOF. On a 2 m hut, three of the four neighbours of a cell just off
 *   the edge are roof. Stepping off it is a 3.5 m drop onto ground that is
 *   there.
 *
 * So this prints and does not fail. Phase 1 is the gate: it is exhaustive over
 * the walkable disc at 0.4 m and it has no heuristic in it at all.
 */
console.log(`\n  PHASE 2 (candidates for inspection, not a gate) — every up-facing surface in every column, ${floors.cells} cells at ${TSTEP} m`);
console.log(`  A MISSING TILE IN A DECK ≥${DECK} m over the plain (no surface where ≥3 of 4 neighbours have one, ≥${DROP} m to fall):`);
console.log(`  ${floors.holes.length} found`);
for (const h of floors.holes.slice(0, 40)) {
  console.log(`    (${String(h.x).padStart(7)}, ${String(h.z).padStart(7)})  floor y ${String(h.y).padStart(7)}  ` +
    `${h.held}/4 neighbours carry it  ${h.drop === 99 ? 'NOTHING BELOW' : `${h.drop} m to the next surface`}  (plain ${h.ground})`);
}
if (floors.holes.length > 40) console.log(`    …and ${floors.holes.length - 40} more`);

console.log(errs.length ? `\n[pageerror] ${errs.length}: ${errs[0]}` : '\n[pageerror] none');
await b.close();
// Phase 2 does not decide the exit code. @see the note above it.
process.exit(out.holes.length || out.proxyOnly.length ? 1 : 0);
