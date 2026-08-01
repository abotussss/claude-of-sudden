import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { BOX_SOFT, BOX_THIN, IDENT, LL, facadeWall } from './kit.js';
import { chamferBox, rockGeometry, fbm3 } from './util.js';
import { PALETTE } from './palette.js';
import { isOpen } from './dressing.js';
import { isDemolishable } from './demolition.js';
import { holdsCaches } from './features.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * WORLD — ONE ELEVATION OF A HOUSE, TAKEN OFF IT. BAKED AT BOOT.
 * ════════════════════════════════════════════════════════════════════════════
 * 「物資やビーコンのある家も破壊できるようにして、破壊と言っても家の一部を破壊したり、
 *  外壁が破壊されるような破壊にしてください」
 *
 * WHAT THIS IS NOT. It is not `src/world/demolition.js`, and the request says so
 * in its own second clause — 「破壊と言っても」. A full collapse already exists,
 * twice: six district blocks carry a complete cached RUIN, and the cathedral goes
 * from a 29 m shell to 2.76 m of rubble in one frame. Neither is what was asked
 * for here. The houses on this list are the ones that hold the CACHES — the
 * ammunition, the weapon racks, the grenade stacks a player walks in for — and
 * levelling one deletes the reason to go in. What comes off is A PIECE OF THE
 * HOUSE: one exterior wall, blown open across the middle of the ground storey,
 * with the storeys above it still standing on what is left of it.
 *
 * WHAT IT IS. Exactly the machinery `demolition.js` is written around, at the
 * granularity of one elevation instead of one building:
 *
 *   the WALL     — the ground-storey facade panel of ONE side, as an
 *                  `Assembler` scope: the triangle ranges it occupies in the
 *                  merged batches, its instanced slots, and the `slabBox`
 *                  collision `facadeWall` authored under it.
 *   the BREACH   — the same elevation with a hole in it, built beside the wall
 *                  at boot and hidden: two jambs of standing wall, the spandrel
 *                  over the opening, a toothed break down both jamb edges and
 *                  along the spandrel's underside, reinforcement out of the
 *                  break, and rubble spilling through the hole in both
 *                  directions.
 *
 * Taking the wall off is then a fill of degenerate indices over cached ranges
 * plus two collision-mask writes. Nothing is built, nothing is solved and no
 * draw call appears on the frame it fires. @see `Assembler.beginScope`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A BREACHED WALL IS A NEW WAY IN, AND THE HEIGHT FIELD HAS TO AGREE
 * ────────────────────────────────────────────────────────────────────────────
 * `src/ai/nav.js` is a 2.5D height field on a 0.8 m lattice with `maxStep` 0.45,
 * and `demolition.js` had to relax its debris to 0.38 m between neighbours to
 * make a rubble field crossable at all. The same rule with a much harder edge
 * applies here, because a breach that is not walkable is not a breach — it is a
 * window.
 *
 * THE OBSTACLE IS NOT THE RUBBLE, IT IS THE PLINTH. `plinthCourse` runs a 0.42 m
 * base course round every footprint, notched only at the doors the facade cut,
 * and 0.42 m is `STANCE.stand.stepHeight` EXACTLY — the value the plinth note in
 * buildings.js records as having stopped the capsule dead at every threshold on
 * the map. A hole in the wall above an unbroken course is a hole you cannot walk
 * through. So the spill is a RAMP and it carries real collision: `SILL` is
 * 0.32 m, which is 0.175 m over the pavement outside (a step), 0.10 m under the
 * plinth top (a step), and under `maxStep` from either side. Walking in is
 * pavement -> spill -> course -> floor, four surfaces, no rise over 0.18 m.
 *
 * That is also why the spill is the only part of the breach that is solid at
 * all. The teeth, the fallen panel and the loose lumps carry NO collision: every
 * one of them is under the step height where it lies, and a proxy on a piece of
 * masonry leaning out of a hole 2 m up is the "浮いてる瓦礫" this project has
 * shipped three times. @see `_floatcheck.mjs`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHICH WALL, AND WHY IT IS MEASURED RATHER THAN AUTHORED
 * ────────────────────────────────────────────────────────────────────────────
 * A table of `{ id, side }` goes stale the first time a building is turned, and
 * this file would not know: it would open a hole into a party wall, or into the
 * 0.75 m slot between two blocks, and the "new way in" would be a new way into
 * nothing. So the side is DERIVED, from two facts that are true before a single
 * wall goes up:
 *
 *   - it must not be a door's side. A breach beside the front door is a second
 *     entrance to a room you could already enter; the value is a way in on a
 *     bearing the house used to deny.
 *   - there must be somewhere to stand outside it. `dressing.isOpen` is the
 *     level's own answer to "can a character stand here outdoors" — it already
 *     knows about every footprint, the cathedral, the relief decks and the site
 *     works — so the elevation is probed at three points along its length, at
 *     1.4 m and 3.0 m out.
 *
 * `_demoprobe.mjs` measures a collapse as a bearing count; the equivalent here is
 * that the chosen side reports open ground on both probes at all three samples,
 * which is asserted at plan time and logged per house at boot.
 */

/* -------------------------------------------------------------------------- */

/** How much of the elevation comes out, and the clamps either side of it. */
const HOLE_FRAC = 0.42;
const HOLE_MIN = 3.2;
const HOLE_MAX = 7.2;
/**
 * The opening's head height, and the spandrel left over it. A hole the full
 * height of the storey is a missing wall rather than a damaged one, and the
 * strip of masonry over the head is what says the floor above is still being
 * carried. 2.55 m is a man plus his rifle held over his head.
 */
const HOLE_H = 2.55;
const HEAD_MIN = 0.72;
/**
 * The crest of the rubble spilling through the hole. Everything in the note at
 * the top of this file turns on this number: over the pavement by 0.175, under
 * the plinth course by 0.10, under `STANCE.stand.stepHeight` (0.42) and under
 * `NavGrid.maxStep` (0.45) from either side.
 */
const SILL = 0.32;
/** How far the spill runs inside the house and out into the street. */
const SPILL_IN = 1.8;
const SPILL_OUT = 2.4;
/** …and how far past the jambs, so the pile is wider than the hole it came from. */
const SPILL_PAD = 0.85;
/** Spill cell size. Small enough to grade, big enough to read as masonry. */
const SPILL_CELL = 0.85;
/** Metres of open ground an elevation needs outside it to be worth breaching. */
const CLEAR_NEAR = 1.4;
const CLEAR_FAR = 3.0;

/**
 * What `strength` a hit has to carry to take a wall off, in the units `match`
 * chooses. Published per record rather than kept private so a caller can read
 * the bar instead of discovering it: `world.damageAt(p, s)` returns null and
 * changes nothing when `s` is under it, which is a hit that scarred the render.
 */
const BREACH_STRENGTH = 1.0;

/** Face index -> yaw, and the outward normal on the plan axes. @see kit SIDE. */
const SIDE_RY = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
const SIDE_N = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/* ========================================================================== */
/* PLAN — before the first wall goes up                                       */
/* ========================================================================== */

/**
 * One record per house that holds a cache, with the elevation already chosen —
 * `world` has to know which side to open a scope round BEFORE it builds it.
 *
 * A house that already carries a whole cached ruin is skipped. Not because the
 * two could not coexist visually, but because `Assembler._scope` is a single
 * slot: `beginScope` inside an open scope silently steals the rest of the outer
 * one's contents, and the outer one there is a building's entire shell. The two
 * sets are disjoint on this map by construction (`DEMOLITION` is six district
 * blocks, this is six cache houses) and this line is what keeps it that way.
 */
export function planBreaches(buildings) {
  const out = [];
  for (const spec of buildings) {
    if (!holdsCaches(spec.id)) continue;
    if (isDemolishable(spec.id)) {
      console.warn(`[world] breach ${spec.id}: already carries a full ruin — skipped`);
      continue;
    }
    const side = chooseSide(spec);
    if (side < 0) {
      console.warn(`[world] breach ${spec.id}: no elevation with open ground outside it — skipped`);
      continue;
    }
    const L = side === 0 || side === 2 ? spec.w : spec.d;
    const holeW = Math.min(HOLE_MAX, Math.max(HOLE_MIN, L * HOLE_FRAC));
    const groundH = spec.groundH ?? 3.45;
    out.push({
      id: `${spec.id}-S${side}`,
      building: spec.id,
      name: `${spec.id} WALL ${['N', 'E', 'S', 'W'][side]}`,
      spec,
      side,
      /** Along the elevation, from its middle. Centred: the jambs are the ends. */
      at: 0,
      holeW,
      holeH: Math.min(HOLE_H, groundH - HEAD_MIN),
      groundH,
      info: null,
      /** The two scopes, filled by `world` and by `buildBreaches`. */
      wall: null,
      ruin: null,
      down: false,
      strength: BREACH_STRENGTH,
      /** Filled by `publishBreaches`, once the level transform exists. */
      position: null,
      normal: null,
      reach: 0,
      mass: null,
      surfaces: ['plaster', 'concrete'],
      tint: 0xbfae92,
      navRect: null,
    });
  }
  return out;
}

/**
 * The elevation to open, measured. @see the long note at the top of the file.
 * Door-less sides first, then in face order, and the first one with somewhere to
 * stand outside it wins. Pure: no rng, no geometry, nothing written.
 */
export function chooseSide(spec) {
  const doors = new Set(Object.keys(spec.doorBays ?? {}).map(Number));
  const skip = new Set(spec.skipSides ?? []);
  const cands = [0, 1, 2, 3].filter((s) => !skip.has(s));
  cands.sort((a, b) => (doors.has(a) ? 1 : 0) - (doors.has(b) ? 1 : 0) || a - b);
  for (const s of cands) if (openOutside(spec, s)) return s;
  return -1;
}

/** Three samples along the elevation, two distances out, all of them open. */
function openOutside(spec, side) {
  const L = side === 0 || side === 2 ? spec.w : spec.d;
  const [nx, nz] = SIDE_N[side];
  const fx = spec.x + nx * (spec.w / 2);
  const fz = spec.z + nz * (spec.d / 2);
  // along the face: +X for sides 0/2, +Z for sides 1/3
  const ax = side === 0 || side === 2 ? 1 : 0;
  const az = ax ? 0 : 1;
  for (const u of [-0.3, 0, 0.3]) {
    for (const out of [CLEAR_NEAR, CLEAR_FAR]) {
      const x = fx + ax * u * L + nx * out;
      const z = fz + az * u * L + nz * out;
      if (!isOpen(x, z, 0.3)) return false;
    }
  }
  return true;
}

/**
 * The LEVEL-space rectangle a breach owns for the dressing pass: the opening's
 * width plus a bay, and the wall's own thickness plus a hand's breadth either
 * side of it. `world` arms it as an `A.claim` bounded at the ground storey's
 * ceiling, so anything the dressing bolts to THIS piece of wall goes with it and
 * nothing two floors up does. @see `Assembler.claim`.
 */
export function claimRect(rec) {
  const spec = rec.spec;
  const side = rec.side;
  const [nx, nz] = SIDE_N[side];
  const t = spec.t ?? 0.34;
  const fx = spec.x + nx * (spec.w / 2);
  const fz = spec.z + nz * (spec.d / 2);
  const ax = side === 0 || side === 2 ? 1 : 0;
  const az = ax ? 0 : 1;
  const hu = rec.holeW / 2 + 0.6;
  // …and along the outward normal: what a bracket stands out from the face, the
  // wall's own thickness, and as much again on the room side.
  const corners = [];
  for (const u of [-hu, hu]) {
    for (const v of [0.45, -(t + 0.45)]) {
      corners.push([fx + ax * u + nx * v, fz + az * u + nz * v]);
    }
  }
  return {
    x0: Math.min(...corners.map((c) => c[0])),
    x1: Math.max(...corners.map((c) => c[0])),
    z0: Math.min(...corners.map((c) => c[1])),
    z1: Math.max(...corners.map((c) => c[1])),
  };
}

/* ========================================================================== */
/* THE DAMAGED FORM                                                           */
/* ========================================================================== */

/** The panel matrix for one side, at height `y` and `along` off its middle. */
function panelAt(out, spec, side, y, along) {
  let px = spec.x;
  let pz = spec.z;
  if (side === 0) {
    pz = spec.z - spec.d / 2;
    px += along;
  } else if (side === 2) {
    pz = spec.z + spec.d / 2;
    px -= along;
  } else if (side === 1) {
    px = spec.x + spec.w / 2;
    pz -= along;
  } else {
    px = spec.x - spec.w / 2;
    pz += along;
  }
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, SIDE_RY[side], 0, 'YXZ'));
  return out.compose(new THREE.Vector3(px, y, pz), q, new THREE.Vector3(1, 1, 1));
}

/**
 * Build every record's damaged form. Runs after the shells and the dressing and
 * before `A.finalize`, exactly where `buildRuins` runs and for the same reason:
 * the triangles land in the merged batches and cost no extra draw call.
 *
 * ITS OWN RNG STREAM, KEYED TO THE RECORD. `world`'s stream is shared with every
 * prop and stain the dressing pass places, so one draw from it here would move
 * the set dressing of the whole map the day somebody adds a brick to a pile.
 * Same rule as `demolition.js`, `cathedral.js`, `features.js` and `links.js`.
 */
export function buildBreaches(A, records) {
  for (const rec of records) {
    if (!rec.wall) {
      console.error(`[world] breach ${rec.id}: the wall scope was never opened — SKIPPED`);
      continue;
    }
    const seed = [...rec.id].reduce((h, c) => (h * 131 + c.charCodeAt(0)) >>> 0, 0x51ce);
    const rng = new Rng(seed);
    rec.ruin = A.beginScope(`breach:${rec.id}`);
    _breach(A, rng, rec);
    A.endScope();
  }
}

function _breach(A, rng, rec) {
  const spec = rec.spec;
  const side = rec.side;
  const t = spec.t ?? 0.34;
  const wallKey = spec.wallKey ?? 'plaster_cream';
  const L = side === 0 || side === 2 ? spec.w : spec.d;
  const H = rec.groundH;
  const hh = rec.holeH;
  const jw = (L - rec.holeW) / 2;
  const pm = new THREE.Matrix4();

  /**
   * THE TWO JAMBS — the ends of the elevation, still standing full height.
   *
   * Flat-topped, not `ragged`: the storey above this one is untouched and its
   * wall lands on top of these. A ragged top here would leave a saw-tooth seam
   * with two floors of intact facade sitting in it. The break is a VERTICAL
   * edge on this elevation, and it is the teeth below rather than the panel top.
   *
   * They carry the collision `facadeWall` authors, so the wall either side of
   * the hole is still a wall to a bullet, a capsule and the height field.
   */
  for (const end of [-1, 1]) {
    panelAt(pm, spec, side, 0, end * (L / 2 - jw / 2));
    facadeWall(A, pm.clone(), {
      w: jw,
      h: H,
      t,
      key: wallKey,
      openings: [],
      rng,
      top: 'flat',
      warp: 0.03,
      paint: (x, wy, z, nx, ny, nz, out) => {
        // Scoured where the blast came out, filthy at the base.
        const base = Math.max(0, 1 - wy / 1.0);
        out[1] = Math.min(1, out[1] + base * base * 0.5);
        out[0] = Math.min(1, out[0] + Math.max(0, 1 - Math.abs(wy - hh * 0.6) / 1.6) * 0.45);
      },
    });
  }

  /**
   * THE SPANDREL over the opening. It is what carries the picture: a hole with
   * nothing over it reads as a wall that was never built, and this strip with
   * the two floors above it is what reads as a wall that was hit.
   *
   * Its collision is `facadeWall`'s own slab, and it is held up laterally by the
   * two jambs — which is what `_floatcheck.mjs`'s fourth rule is for: a node
   * whose neighbouring column carries ground-standing mass up to at least its
   * underside is supported, which is how an arch and a balcony pass.
   */
  panelAt(pm, spec, side, hh, rec.at);
  facadeWall(A, pm.clone(), {
    w: rec.holeW,
    h: H - hh,
    t,
    key: wallKey,
    openings: [],
    rng,
    top: 'flat',
    warp: 0.03,
  });

  _teeth(A, rng, spec, side, rec, t, wallKey);
  _spill(A, rng, spec, side, rec, t, wallKey);
}

/**
 * THE BREAK, AS TEETH.
 *
 * Three clean rectangles is a doorway somebody cut with a saw. What a blast
 * leaves is a torn edge: render sheared off, the block behind it exposed and
 * broken back at a different line, and reinforcement standing out of both. So
 * every edge of the opening — the two vertical jamb faces and the underside of
 * the spandrel — gets a run of small chamfered blocks pushed a random distance
 * INTO the opening, in the render's colour and in the structural one, plus bent
 * bars out of the spandrel.
 *
 * NONE OF IT IS SOLID. Every piece is well under the step height where it sits,
 * and a proxy on masonry leaning out of a hole two metres up is the exact defect
 * `_floatcheck.mjs` exists to find. @see the note at the top of this file.
 */
function _teeth(A, rng, spec, side, rec, t, wallKey) {
  const pm = new THREE.Matrix4();
  const hh = rec.holeH;
  const hw = rec.holeW / 2;

  // --- the two vertical edges ---
  for (const end of [-1, 1]) {
    const edge = end * hw; // panel x of the jamb's inner face
    const n = rng.int(5, 8);
    for (let i = 0; i < n; i++) {
      const y = (i / n) * hh + rng.range(0.05, hh / n);
      const bh = rng.range(0.18, 0.45);
      const bite = rng.range(0.12, 0.62);
      panelAt(pm, spec, side, 0, 0);
      const key = rng.float() < 0.45 ? 'brick_fine' : wallKey;
      A.add(
        key,
        BOX_SOFT(A),
        // …and bitten 0.08 m back INTO the jamb for the same reason as the head.
        LL(pm, edge - end * (bite * 0.5 - 0.08), y + bh / 2, t * 0.5, rng.range(-0.1, 0.1),
          bite, bh, t * rng.range(0.55, 1.0), rng.range(-0.14, 0.14), rng.range(-0.14, 0.14)),
        { masks: [rng.range(0.5, 0.9), rng.range(0.6, 1.0), rng.range(0.45, 0.85)] }
      );
    }
    // The block core exposed down the full height of the break.
    panelAt(pm, spec, side, 0, 0);
    const g = chamferBox(0.1, hh * rng.range(0.55, 0.9), t * 0.55, 0.012);
    A.addOnce('brick_fine', g, LL(pm, edge - end * 0.05, hh * rng.range(0.3, 0.5), t * 0.62), {
      masks: [0.6, 0.7, 0.5],
    });
  }

  // --- the spandrel's underside ---
  {
    const n = rng.int(4, 7);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1 || 1) - 0.5) * rec.holeW * 0.94 + rng.range(-0.2, 0.2);
      const drop = rng.range(0.14, 0.42);
      panelAt(pm, spec, side, 0, 0);
      A.add(
        rng.float() < 0.5 ? 'brick_fine' : wallKey,
        BOX_SOFT(A),
        /**
         * BITTEN 0.1 m UP INTO THE SPANDREL, not hung off its bottom edge.
         * A tooth flush with the head is one rotation away from a gap, and a
         * brick with daylight over it reads as floating masonry whatever the
         * collision says — which is the complaint this project has had twice.
         */
        LL(pm, x, hh - drop / 2 + 0.1, t * 0.5, rng.range(-0.12, 0.12),
          rng.range(0.35, 0.8), drop, t * rng.range(0.5, 0.95), rng.range(-0.2, 0.2), rng.range(-0.2, 0.2)),
        { masks: [rng.range(0.5, 0.9), rng.range(0.6, 1.0), rng.range(0.4, 0.8)] }
      );
    }
    // Reinforcement out of the head, bent down into the opening.
    const bars = rng.int(3, 6);
    for (let b = 0; b < bars; b++) {
      const bl = rng.range(0.35, 0.9);
      panelAt(pm, spec, side, 0, 0);
      A.add(
        'metal_rust',
        BOX_THIN(A),
        LL(pm, rng.range(-rec.holeW / 2 + 0.2, rec.holeW / 2 - 0.2), hh - bl * 0.45, t * rng.range(0.3, 0.8),
          rng.range(-0.5, 0.5), 0.022, bl, 0.022, rng.range(-0.8, 0.8), rng.range(-0.8, 0.8)),
        { masks: [0.9, 0.7, 0.1] }
      );
    }
  }
}

/**
 * THE SPILL — the wall, on the floor, on both sides of where it used to be.
 *
 * A graded field rather than a scatter, for the reason `demolition.js` states at
 * length: the bot height field samples one floor per cell, so the only debris
 * that is walkable is debris that is a SURFACE. This one is small enough that no
 * relaxation pass is needed — it is authored monotonic, highest against the wall
 * line and falling to nothing at both ends of its run — and `SILL` caps it under
 * every step limit on the map at once.
 *
 * The solid boxes are the whole point of the pile and not a side effect: they
 * are the ramp over the 0.42 m plinth course, which is otherwise a step exactly
 * at the character controller's limit standing across the middle of the hole.
 */
function _spill(A, rng, spec, side, rec, t, wallKey) {
  const [nx, nz] = SIDE_N[side];
  // the outer face of this elevation, in level space
  const fx = spec.x + nx * (spec.w / 2);
  const fz = spec.z + nz * (spec.d / 2);
  // the along-face axis
  const ax = side === 0 || side === 2 ? 1 : 0;
  const az = ax ? 0 : 1;

  const halfU = rec.holeW / 2 + SPILL_PAD;
  const nu = Math.max(3, Math.round((halfU * 2) / SPILL_CELL));
  const nv = Math.max(3, Math.round((SPILL_IN + SPILL_OUT) / SPILL_CELL));
  const du = (halfU * 2) / nu;
  const dv = (SPILL_IN + SPILL_OUT) / nv;
  const soft = BOX_SOFT(A);
  const keys = [wallKey, 'concrete', 'concrete_dark', 'brick_fine', 'roof_screed'];
  const wt = [0.32, 0.22, 0.16, 0.18, 0.12];
  const pick = () => {
    let r = rng.float();
    for (let i = 0; i < keys.length; i++) {
      r -= wt[i];
      if (r <= 0) return keys[i];
    }
    return keys[0];
  };
  const seed = rng.range(0, 40);

  for (let iv = 0; iv < nv; iv++) {
    // v measured along the outward normal: -SPILL_IN inside, +SPILL_OUT outside
    const v = -SPILL_IN + (iv + 0.5) * dv;
    for (let iu = 0; iu < nu; iu++) {
      const u = -halfU + (iu + 0.5) * du;
      /**
       * The profile: full crest on the wall line, falling to nothing at the far
       * end of the run in either direction and at both ends of the width. Two
       * octaves of noise on top so it is not a wedge, and the whole thing
       * clamped to `SILL` — a piece of debris that is taller than the step is a
       * wall, and this one is standing in the only way through.
       */
      const fu = Math.max(0, 1 - Math.abs(u / halfU) ** 1.6);
      const fv = v < 0 ? Math.max(0, 1 + v / SPILL_IN) : Math.max(0, 1 - v / SPILL_OUT);
      const n = fbm3(u * 0.9 + seed, 2.3, v * 0.9 + seed, 2) - 0.5;
      const h = Math.min(SILL, Math.max(0.05, SILL * fu * fv + n * 0.1));
      const cx = fx + ax * u + nx * v;
      const cz = fz + az * u + nz * v;

      // Two or three pieces per cell: one carrying the height the proxy
      // promises and one or two jammed against it. @see `_debris` in
      // demolition.js — same reason, a carpet of single slabs reads as plywood.
      const heap = rng.int(2, 3);
      for (let k = 0; k < heap; k++) {
        const main = k === 0;
        const sx = du * (main ? rng.range(0.8, 0.98) : rng.range(0.3, 0.6));
        const sz = dv * (main ? rng.range(0.8, 0.98) : rng.range(0.3, 0.6));
        const sy = main ? h * rng.range(1.0, 1.15) : h * rng.range(0.4, 0.9);
        A.add(
          pick(),
          soft,
          LL(
            IDENT,
            cx + (main ? 0 : rng.range(-du * 0.35, du * 0.35)),
            sy * 0.5 + (main ? 0 : rng.range(0, h * 0.4)),
            cz + (main ? 0 : rng.range(-dv * 0.35, dv * 0.35)),
            rng.range(-0.9, 0.9),
            sx,
            sy,
            sz,
            rng.range(main ? -0.1 : -0.4, main ? 0.1 : 0.4),
            rng.range(main ? -0.1 : -0.4, main ? 0.1 : 0.4)
          ),
          { masks: [rng.range(0.5, 0.95), rng.range(0.6, 1.0), rng.range(0.45, 0.85)] }
        );
      }
      /**
       * THE RAMP. Only the cells that are actually worth standing on get a
       * proxy — under 0.16 m the controller and the height field both walk over
       * them and a box there is a bump for nothing.
       */
      if (h >= 0.16) A.box('concrete', cx, h * 0.5, cz, du, h, dv);

      // Loose lumps, no collision, all of them under the step where they lie.
      for (let k = 0; k < rng.int(1, 3); k++) {
        const s = rng.range(0.13, 0.34);
        A.addOnce(
          rng.float() < 0.5 ? 'concrete' : 'brick_fine',
          rockGeometry(rng, s, 0, 0.72),
          LL(IDENT, cx + rng.range(-0.4, 0.4), h + s * 0.22, cz + rng.range(-0.4, 0.4),
            rng.float() * 6.28, 1, 1, 1, rng.range(-0.5, 0.5), rng.range(-0.5, 0.5)),
          { masks: [0.35, 0.8, 0.5] }
        );
      }
    }
  }

  /**
   * ONE PANEL OF THE WALL, LYING OUTSIDE ON THE PILE. The single most legible
   * thing about a blown elevation and the thing a graded field can never say by
   * itself: a run of render, face down in the street, at the foot of the hole it
   * came out of. No collision, for the reason `_fallen` in demolition.js has
   * none — it lies ON the field and stands at most a step proud of it.
   */
  {
    const len = rng.range(2.0, 3.4);
    const wide = rng.range(0.8, 1.5);
    const u = rng.range(-rec.holeW * 0.22, rec.holeW * 0.22);
    const v = SPILL_OUT * rng.range(0.4, 0.75);
    const cx = fx + ax * u + nx * v;
    const cz = fz + az * u + nz * v;
    const ry = Math.atan2(ax, az) + rng.range(-0.6, 0.6);
    const y = SILL * 0.55 + rng.range(0.03, 0.12);
    const tilt = rng.range(-0.26, 0.26);
    const roll = rng.range(-0.22, 0.22);
    A.add(wallKey, soft, LL(IDENT, cx, y, cz, ry, len, t, wide, tilt, roll), {
      masks: [rng.range(0.5, 0.9), rng.range(0.55, 0.95), rng.range(0.4, 0.8)],
    });
    A.add(
      'brick_fine',
      soft,
      LL(IDENT, cx, y + t * 0.55, cz, ry, len * rng.range(0.35, 0.7), 0.05, wide * rng.range(0.4, 0.75), tilt, roll),
      { masks: [0.65, 0.75, 0.6] }
    );
    for (let b = 0; b < rng.int(2, 4); b++) {
      const bl = rng.range(0.4, 1.2);
      A.add(
        'metal_rust',
        BOX_THIN(A),
        LL(IDENT, cx + rng.range(-len * 0.5, len * 0.5), y + rng.range(0.08, 0.3), cz + rng.range(-wide * 0.5, wide * 0.5),
          rng.float() * 6.28, 0.024, bl, 0.024, rng.range(-1.3, 1.3), rng.range(-1.3, 1.3)),
        { masks: [0.9, 0.75, 0.1] }
      );
    }
  }

  /**
   * …AND ONE PROPPED AGAINST A JAMB, which is what carries the silhouette. A
   * spill capped at 0.32 m so it stays walkable reads from twenty metres as
   * gravel; a two-metre run of elevation leaning on the corner it came off says
   * the wall fell rather than that somebody swept something up. Its foot is on
   * the ground and its head is against the jamb, so it is held up the way an
   * arch's voussoirs are — and it carries no collision either way.
   */
  {
    const end = rng.float() < 0.5 ? -1 : 1;
    const tall = rng.range(1.7, 2.4);
    const lean = rng.range(0.55, 0.85);
    const u = end * (rec.holeW / 2 - rng.range(0.1, 0.7));
    const v = Math.sin(lean) * tall * 0.5 + rng.range(0.1, 0.4);
    const cx = fx + ax * u + nx * v;
    const cz = fz + az * u + nz * v;
    const ry = Math.atan2(ax, az) + rng.range(-0.25, 0.25);
    const y = Math.cos(lean) * tall * 0.5 + SILL * 0.4;
    A.add(
      wallKey,
      soft,
      LL(IDENT, cx, y, cz, ry, rng.range(1.1, 1.9), tall, t, 0, end * lean),
      { masks: [rng.range(0.5, 0.9), rng.range(0.55, 0.95), rng.range(0.4, 0.8)] }
    );
    for (let b = 0; b < rng.int(2, 4); b++) {
      const bl = rng.range(0.3, 0.9);
      A.add(
        'metal_rust',
        BOX_THIN(A),
        LL(IDENT, cx + rng.range(-0.7, 0.7), y + tall * rng.range(0.25, 0.45), cz + rng.range(-0.3, 0.3),
          rng.float() * 6.28, 0.022, bl, 0.022, rng.range(-1.2, 1.2), rng.range(-1.2, 1.2)),
        { masks: [0.9, 0.75, 0.1] }
      );
    }
  }

  // The scorch and dust the blast leaves on the ground round the opening, flat
  // and a centimetre proud so it reads as a stain rather than as more rubble.
  for (let i = 0; i < 4; i++) {
    const u = rng.range(-halfU, halfU);
    const v = rng.range(-SPILL_IN * 0.8, SPILL_OUT * 1.15);
    A.add(
      'road_dust',
      BOX_THIN(A),
      LL(IDENT, fx + ax * u + nx * v, 0.02, fz + az * u + nz * v, rng.float() * 6.28,
        rng.range(1.4, 3.2), 0.02, rng.range(1.4, 3.2)),
      { masks: [0.1, 1.0, 0.5] }
    );
  }
}

/* ========================================================================== */
/* WHAT COMES OFF IT WHILE IT GOES                                            */
/* ========================================================================== */

/**
 * THE MASS, PUBLISHED RATHER THAN THROWN — the same contract, field for field,
 * that `world.demolitions[].mass` publishes, so a caller that already knows how
 * to cut, throw and settle a district block's walls needs no second code path
 * for a single elevation. `world` may not import the chunk vertex program and
 * `match` may not import `world`, so what crosses the line is the box this wall
 * is made of, in the BUILDING's own frame, plus the openings cut in it.
 *
 *   size  [along level +X, up, along level +Z]
 *   at    the box centre in the same axes, from (spec.x, 0, spec.z)
 *   cut   the fracture grid, sized for ~1.3 m chunks
 *   mat   0 = the render (this house's own plaster), 1 = structure
 */
function _mass(rec, info) {
  const spec = rec.spec;
  const t = spec.t ?? 0.34;
  const side = rec.side;
  const W = rec.holeW;
  const H = rec.holeH;
  const n = (m, per = 1.3) => Math.max(1, Math.round(m / per));
  const holes = [];
  /**
   * The openings the facade generator actually cut inside the piece that goes.
   * Read off `info.windows` / `info.doors` rather than a table, so a re-rolled
   * bay cannot leave a chunk standing where a window was. Panel `x` is measured
   * from the elevation's middle, which is the same axis `rec.at` is on.
   */
  const inHole = (along, halfW) => Math.abs(along - rec.at) < W / 2 + halfW;
  for (const o of info.windows ?? []) {
    if (o.side !== side || (o.f ?? 0) !== 0) continue;
    if (!inHole(o.x, o.w / 2)) continue;
    const y = (info.floorY?.[o.f] ?? 0) + o.y;
    if (y - o.h / 2 > H) continue;
    holes.push({ along: o.x, y, hw: o.w / 2 + 0.25, hh: o.h / 2 + 0.25 });
  }
  for (const d of info.doors ?? []) {
    if (d.side !== side) continue;
    if (!inHole(d.x, 0.56)) continue;
    holes.push({ along: d.x, y: 1.08, hw: 0.81, hh: 1.33 });
  }

  const deep = Math.max(t, 0.5);
  const cut = side === 0 || side === 2 ? [n(W), n(H), 1] : [1, n(H), n(W)];
  const shaped = [];
  for (const h of holes) {
    const u = h.along - rec.at;
    if (side === 0) shaped.push({ a: [rec.at + u, h.y, -spec.d / 2], r: [h.hw, h.hh, deep] });
    else if (side === 2) shaped.push({ a: [-(rec.at + u), h.y, spec.d / 2], r: [h.hw, h.hh, deep] });
    else if (side === 1) shaped.push({ a: [spec.w / 2, h.y, rec.at + u], r: [deep, h.hh, h.hw] });
    else shaped.push({ a: [-spec.w / 2, h.y, -(rec.at + u)], r: [deep, h.hh, h.hw] });
  }

  let size;
  let at;
  if (side === 0) {
    size = [W, H, t];
    at = [rec.at, H / 2, -(spec.d - t) / 2];
  } else if (side === 2) {
    size = [W, H, t];
    at = [-rec.at, H / 2, (spec.d - t) / 2];
  } else if (side === 1) {
    size = [t, H, W];
    at = [(spec.w - t) / 2, H / 2, rec.at];
  } else {
    size = [t, H, W];
    at = [-(spec.w - t) / 2, H / 2, -rec.at];
  }
  return [{ id: `wall${side}`, mat: 0, size, at, cut, holes: shaped }];
}

/* ========================================================================== */
/* PUBLISH                                                                    */
/* ========================================================================== */

/**
 * Turn the records into the list `world` publishes and `match` consumes. Called
 * after `A.finalize`, which is where the scopes' meshes and collision handles
 * come from.
 *
 * THE FIRST HIDE IS THE EXPENSIVE ONE AND IT HAPPENS HERE, for the reason
 * `publishDemolitions` gives: `setScopeVisible` copies the indices it overwrites
 * lazily, and doing that on the frame a shell lands is a few hundred kilobytes
 * of allocation in a feature whose whole design is that nothing is solved on
 * that frame. One hide/show cycle at boot fills every `_saved` array and leaves
 * the wall standing.
 */
export function publishBreaches(A, records, physics) {
  const out = [];
  for (const rec of records) {
    if (!rec.wall || !rec.ruin || !rec.info) {
      console.error(`[world] breach ${rec.id}: wall or breach scope missing — SKIPPED`);
      continue;
    }
    const spec = rec.spec;
    const side = rec.side;
    const [nx, nz] = SIDE_N[side];
    const fx = spec.x + nx * (spec.w / 2);
    const fz = spec.z + nz * (spec.d / 2);
    const ax = side === 0 || side === 2 ? 1 : 0;
    const az = ax ? 0 : 1;

    rec.mass = _mass(rec, rec.info);
    rec.tint = PALETTE[spec.wallKey ?? 'plaster_cream']?.opts?.tint ?? 0xbfae92;
    rec.level = { x: fx + ax * rec.at, y: rec.holeH / 2, z: fz + az * rec.at };
    rec.position = A.toWorld(rec.level.x, rec.level.y, rec.level.z, new THREE.Vector3());
    /** The outward face normal and the along-face axis, both in WORLD space. */
    rec.normal = A.toWorld(nx, 0, nz, new THREE.Vector3()).sub(A.toWorld(0, 0, 0, new THREE.Vector3())).normalize();
    rec.along = A.toWorld(ax, 0, az, new THREE.Vector3()).sub(A.toWorld(0, 0, 0, new THREE.Vector3())).normalize();
    rec.halfLen = rec.holeW / 2;
    rec.top = rec.holeH;
    /**
     * How near a hit has to land. Half the opening plus a bay either side: a
     * shell that strikes the jamb beside the hole took this wall off too, and a
     * caller should not have to hit a rectangle to the centimetre.
     */
    rec.reach = 3.4;

    // The world-space AABB the collision changes over, for whoever re-probes it.
    {
      const r = Math.max(rec.holeW / 2 + SPILL_PAD, SPILL_IN + SPILL_OUT) + 1.0;
      rec.navRect = {
        x0: rec.position.x - r, x1: rec.position.x + r,
        z0: rec.position.z - r, z1: rec.position.z + r,
      };
    }

    A.setScopeVisible(rec.wall, false);
    A.setScopeVisible(rec.wall, true);
    A.setScopeVisible(rec.ruin, false);
    A.setScopeSolid(rec.ruin, physics, false);

    /** Geometry only — the picture, with no opinion about collision. */
    rec.setVisual = (down) => {
      A.setScopeVisible(rec.wall, !down);
      A.setScopeVisible(rec.ruin, down);
    };
    /**
     * Collision and therefore navigation. SEPARATE from the picture on purpose
     * and for the same reason `demolition.js` separates them: a nav patch has to
     * be baked with the damaged form temporarily solid and the house visibly
     * intact the whole time. @see `Airstrike._bakeNavPatch`.
     */
    rec.setCollision = (down) => {
      A.setScopeSolid(rec.wall, physics, !down);
      A.setScopeSolid(rec.ruin, physics, down);
    };
    rec.setDown = (down) => {
      rec.down = !!down;
      rec.setVisual(!!down);
      rec.setCollision(!!down);
    };
    out.push(rec);
  }
  console.info(
    `[world] breach: ${out.length} cache houses carry a damaged wall — ` +
      out
        .map(
          (r) =>
            `${r.building}:S${r.side}(${(r.wall.tris / 1000).toFixed(1)}k->` +
              `${(r.ruin.tris / 1000).toFixed(1)}k tris, ${r.holeW.toFixed(1)}x${r.holeH.toFixed(1)}m)`
        )
        .join(' ')
  );
  return out;
}
