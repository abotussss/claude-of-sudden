import * as THREE from 'three';
import { BOX, BOX_FINE, BOX_SOFT, BOX_THIN, IDENT, LL } from '../kit.js';
import { newTrs } from '../util.js';
import { Rng } from '../../core/rng.js';
import { wallRun, debrisField, drawDebris, fallenMember } from './plains-works.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD — DIE TRÜMMERSIEDLUNG. The settlement that was here before the map.
 * ════════════════════════════════════════════════════════════════════════════
 * 「また平原はもっと建物増やして 廃墟を」
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A NEW FILE AND NOT A LARGER `KIND_R.ruin`
 * ────────────────────────────────────────────────────────────────────────────
 * This is the THIRD time the plain has been reported as having too little on
 * it, and the first two answers were both measured and both accepted at the
 * time: the crossing pass took the mean sightline along the twelve real routes
 * from 115.4 m to 62.4 m and the exposed share from 38 % to 7 %, and the ring
 * pass filled the 24.5 m of bare ground `offPads` had been leaving round every
 * capture point. He asked again anyway, and this time he named the thing:
 * BUILDINGS. 廃墟.
 *
 * That is not a quantity, it is a KIND, and the difference is worth stating
 * because it is the whole design here. A berm, a wreck and a sandbag line are
 * all cover at ONE height — 1.35 m, 2.4 m, 2.55 m — and every one of them is
 * something you stand behind. Photographed from a standing eye they are a strip
 * of mass across the bottom sixth of the frame with three hundred metres of
 * empty plain over it, which is exactly what the map still looks like with
 * fifty-one of them on it. A building:
 *
 *   · breaks the sightline at EVERY height, from the footings to eleven metres,
 *     so it is still an occluder to a man on a rampart and to a hull;
 *   · is something you go INSIDE, fight through and get flanked in, which no
 *     amount of exterior mass ever becomes;
 *   · READS AT RANGE. A 2.55 m berm at 200 m subtends 0.7°. A 9 m gable
 *     subtends 2.6° and stands against the sky rather than against the ground,
 *     which is the only reason anything on a night map is legible at all.
 *
 * `plains-cover.ruin` already builds one of these and there are seven of them.
 * It is a SINGLE ROOM — one rectangle of broken wall 11-15 m by 8-11.5 m,
 * capped at 4.1 m — because it is a cover station on a walk and it is sized
 * against `KIND_R.ruin` = 8 m and against the spacing of the crossing solver.
 * What is missing is the other end of the scale: a range of houses, an
 * industrial hall, a four-storey shell, a grain terminal. Those are not a
 * parameter change to a station generator; they have bays, party walls, gables,
 * piers and interiors, and they are placed against the ARMOUR LANES rather than
 * against a crossing. So: a file.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE FOUR THINGS THIS ENGINE PUNISHES, AND A RUIN IS THE WORST CASE FOR ALL OF
 * THEM
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  1. `NavGrid` IS A 2.5D HEIGHT FIELD — one floor per 0.8 m cell, found by ONE
 *     downward ray, `maxStep` 0.45 m, slope limit 46°. The town's disease is
 *     36 820 walkable cells above 2.5 m in 2 113 components with ZERO joined to
 *     the ground: every upper floor and every roof on that map is walkable and
 *     unreachable. NACHTFELD was built as the reaction to it and its rule is
 *     that every AI-walkable surface sits in one component with the ground.
 *
 *     SO THERE IS NOT ONE HORIZONTAL SURFACE IN THIS FILE. Not a floor, not a
 *     deck, not a roof, not a coping, not a window sill, not a chimney top.
 *     `panel()` is the only thing that emits mass and it CANNOT emit a flat
 *     top: every run of wall is a box that stops `capH` short with a
 *     `ridgePrism` at `RIDGE_DEG` finishing it, so the total height is exactly
 *     what was asked for and the top of it is a 58° ridge that `NavGrid`
 *     refuses at every station. A ruin is a building whose floors have gone;
 *     that is not a compromise here, it is the subject.
 *
 *     AND NOTHING A MAN WALKS THROUGH HAS ANYTHING OVER IT. A refused cell is
 *     not an island — it is a cell nobody may stand in — so a lintel over a
 *     doorway would be perfectly safe for the nav COUNT and would close the
 *     door to every bot on the map. Every opening a route passes through is
 *     therefore a FULL-HEIGHT BREACH in plan, which is also what a shell does to
 *     a wall. Windows have heads because a window is not a route.
 *
 *  2. A CLOSED SOLID DRAWN WITH OUTWARD FACES HAS NO INSIDE. The control
 *     tower's shaft shipped with that fault and you could see the sky through
 *     its walls; `patchGeometry` and `domeGeometry` shipped with it and every
 *     ground sheet on this map was invisible from above and black from below. A
 *     ruin is MOSTLY interior surface. The answer here is structural rather
 *     than careful: every wall is its own closed box out of `kit.BOX`, so the
 *     face that points into a room is that box's own outward face and there is
 *     no winding to get wrong. The only authored geometry in this file is
 *     `ridgePrism`, whose two faces are its own top.
 *
 *  3. HORIZONTAL SURFACES RENDER BLACK AT NIGHT HERE. The only key light is a
 *     burning ridge ON THE HORIZON, so N·L on an up-facing face is ≈ 0 whatever
 *     its material — that is why 2 600 flat ground sheets were DELETED rather
 *     than fixed (@see `noSheet` in `plains-cover.js`) and why a slab 40 m up
 *     read as a black ceiling. Rule 1 has already deleted every horizontal
 *     surface here for a different reason; the two agree, and what is left —
 *     walls, gables, piers, silo staves, leaning slabs at 54-73° — is all
 *     vertical or near-vertical mass with a lit side and a shaded side.
 *
 *  4. PROPS IN DOORWAYS IS FIVE SEPARATE SHIPPED BUGS, and `interiors.js` once
 *     tested a prop's CENTRE against a circle while props have extent — 74 of
 *     546 openings impassable. Every opening `panel()` makes registers a
 *     `clear` circle and every interior prop is tested `d < r + footprintR`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND THE FIFTH, WHICH IS NOT A RULE BUT A MEASUREMENT: SIX TANKS
 * ────────────────────────────────────────────────────────────────────────────
 * `src/match/tank.js` drives six hulls down authored polylines that are RE-BAKED
 * against the built world, and cover has pinched one before — 「cover once
 * pinched a hull 40 m from any cut」. That file may not be imported from here and
 * its route table may not be copied (the five-files-out-of-sync trap this level
 * exists to escape), and `TALL` — the 2.55 m ceiling every wreck, berm and
 * emplacement in `plains-cover.js` is built under, so that a hull rides over it
 * — is no use at all to a building.
 *
 * What IS available is the shape of the failure. `_bakePath` fires a side probe
 * 9 m each way at every 1.25 m sample and cuts the leg when `dR + dL` falls
 * under `HULL_W + CLEARANCE` = 3.55 m. A building four metres off a centreline
 * therefore costs nothing: the probe stops at 4 on one side and runs its full 9
 * on the other, and 13 m of span is three times what is needed. The only thing
 * that pinches a leg is mass ON the line, or mass on BOTH sides of it inside two
 * metres. So the requirement is not "far from the armour" — it is simply that no
 * route runs THROUGH a building, and `ANCHORS` below is an authored table whose
 * every entry was measured against all 102 route segments before it was written
 * down. @see the note on it, which carries the numbers.
 */

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE ANGLE THAT KEEPS THE MAP ONE COMPONENT — moved here, unchanged, because
 * it is now shared
 * ────────────────────────────────────────────────────────────────────────────
 * `NavGrid` refuses a cell whose floor normal is under `cos(46°)`. 58° is
 * comfortably past that with room for the ground under a piece to tilt it a few
 * degrees the wrong way and still be refused. It lived in `plains-cover.js` and
 * is imported back into it; there is still exactly one statement of it.
 */
export const RIDGE_DEG = 58;

/** Cell of the relaxed rubble fields. @see `debrisField`. */
export const RUBBLE_CELL = 2.2;

/**
 * A triangular prism, ridge along local Z, apex over the middle — the collision
 * cap that stops a flat top being a floor.
 *
 * `halfW` is half the thickness it has to cover and the apex height follows
 * from `RIDGE_DEG`, so the caller cannot accidentally author a shallow one: the
 * only way to cover a wider top is to stand a taller ridge on it.
 */
export function ridgePrism(halfW, len) {
  const capH = halfW * Math.tan((RIDGE_DEG * Math.PI) / 180);
  const h = len / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, capH, -h, -halfW, 0, -h, halfW, 0, -h,
    0, capH, h, -halfW, 0, h, halfW, 0, h,
  ], 3));
  g.setIndex([
    0, 1, 4, 0, 4, 3,   // one face
    0, 3, 5, 0, 5, 2,   // the other
    0, 2, 1, 3, 4, 5,   // the two ends
  ]);
  g.computeVertexNormals();
  g.userData.capH = capH;
  return g;
}

// ──────────────────────────────────────────────────────────────── one panel ──
/**
 * ════════════════════════════════════════════════════════════════════════════
 * `panel` — THE ONLY THING IN THIS FILE THAT EMITS STANDING MASS
 * ════════════════════════════════════════════════════════════════════════════
 * Everything a building is made of comes through here: front walls, party
 * walls, gable steps, piers, silo staves, chimney stacks. That is deliberate and
 * it is what makes rule 1 above a property of the file rather than a habit —
 * there is no second path by which a flat top can reach the collision world.
 *
 * WHAT IT DRAWS. `wallRun` per solid interval, which is a stack of separate
 * course boxes with per-course jitter in height and setback, so the face has a
 * real horizontal shadow line every 0.6 m rather than a texture of one. This is
 * the detail layer that has to survive at 0.5 m; a single extruded slab is the
 * failing case for this map's quality bar and always has been.
 *
 * WHAT IT COLLIDES. One box per interval, and the TOPMOST interval's box stops
 * `capH` short of the authored height with a `ridgePrism` finishing it. Only the
 * topmost, because every interval of one panel shares one plan footprint and the
 * height field's ray finds the highest of them: a sill under a head is already
 * in the head's shadow and a ridge on it would only narrow the window.
 *
 * `holes` are [y0, y1] pairs over the footing, in metres. A hole that reaches
 * the ground is a BREACH — a way through — and it is reported back in `clear` so
 * nothing is ever dropped in it. @see rule 4.
 */
function panel(A, rng, gy, key, inner, ax, az, bx, bz, h, t, opts = {}) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.3) return null;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const base = gy(mx, mz);
  const yaw = Math.atan2(bx - ax, bz - az);
  const surface = A.surfaceOf(key);

  /**
   * A BREACH. It gets a footing course you step over — 0.18 m, well under the
   * 0.42 m `STANCE.stand.stepHeight` that 「石ころオブジェが移動の妨げです」 is
   * about — and a keep-out circle, and nothing else. No lintel: @see rule 1.
   */
  if (h <= 0.1) {
    A.add(inner, BOX_FINE(A), LL(IDENT, mx, base + 0.09, mz, yaw, t + 0.2, 0.18, len + 0.04),
      { masks: [0.62, 0.55, 0.5] });
    return { gap: true, clear: { x: mx, z: mz, r: len / 2 + 1.1 } };
  }

  /* ---- the solid intervals this panel is left with ---------------------- */
  const holes = (opts.holes ?? [])
    .filter((w) => w[0] < h - 0.3)
    .map((w) => [Math.max(0, w[0]), Math.min(h, w[1])])
    .sort((p, q) => p[0] - q[0]);
  const ivs = [];
  let y = 0;
  for (const [h0, h1] of holes) {
    if (h0 > y + 0.15) ivs.push([y, h0]);
    y = Math.max(y, h1);
  }
  if (h > y + 0.15) ivs.push([y, h]);
  if (!ivs.length) {
    A.add(inner, BOX_FINE(A), LL(IDENT, mx, base + 0.09, mz, yaw, t + 0.2, 0.18, len + 0.04),
      { masks: [0.62, 0.55, 0.5] });
    return { gap: true, clear: { x: mx, z: mz, r: len / 2 + 1.1 } };
  }

  const course = opts.course ?? rng.range(0.55, 0.74);
  for (let i = 0; i < ivs.length; i++) {
    const [y0, y1] = ivs[i];
    const top = i === ivs.length - 1;
    /** The lowest run is buried, so no swell can leave a strip of daylight. */
    const b0 = base + y0 - (y0 <= 0.01 ? 0.45 : 0);
    const b1 = base + y1;
    wallRun(A, rng, key, ax, az, bx, bz, {
      y0: b0, y1: b1, t, batter: opts.batter ?? 0.02, course, coping: false, overrun: 0.05,
    });
    if (top) {
      const cap = ridgePrism((t + 0.06) / 2, len + 0.06);
      const capH = Math.min(cap.userData.capH, (b1 - b0) * 0.55);
      A.box(surface, mx, (b0 + b1 - capH) / 2, mz, t + 0.06, b1 - capH - b0, len + 0.06, yaw);
      A.collideGeo(surface, cap, newTrs(mx, b1 - cap.userData.capH, mz, yaw));
      cap.dispose();
      /**
       * THE BROKEN TOP COURSE. Blocks with gaps sitting on the ridge — what the
       * last course of a shelled wall is, and DRAWN ONLY: a 0.2 m block is
       * under the nav cell it would otherwise re-floor, and the ridge under it
       * is what `NavGrid` actually reads.
       */
      const caps = Math.max(2, Math.round(len / 0.85));
      for (let q = 0; q < caps; q++) {
        if (rng.float() < 0.36) continue;
        const u = (q + 0.5) / caps;
        A.add(rng.float() < 0.4 ? inner : key, BOX(A), LL(IDENT,
          ax + (bx - ax) * u, b1 + rng.range(0.01, 0.14), az + (bz - az) * u,
          yaw + rng.range(-0.13, 0.13),
          t * rng.range(0.65, 1.0), rng.range(0.11, 0.28), (len / caps) * rng.range(0.55, 0.95)),
          { masks: [0.75, 0.5, 0.25] });
      }
    } else {
      A.box(surface, mx, (b0 + b1) / 2, mz, t + 0.06, b1 - b0, len + 0.06, yaw);
    }
  }

  /* ---- what makes it a ruin rather than a wall -------------------------- */
  /**
   * THE RENDER OFF THE CORE. A shelled house is two materials, and which one
   * you are looking at is a map of where the blast went — this is the single
   * cheapest thing in the file for how much it does at 0.5 m and at 30 m, one
   * box per patch against the plaster behind it.
   */
  if (rng.float() < 0.55) {
    const u = rng.range(0.15, 0.85);
    const pw = len * rng.range(0.18, 0.45);
    const ph = Math.min(h * rng.range(0.3, 0.8), h - 0.2);
    A.add(inner, BOX_FINE(A), LL(IDENT,
      ax + (bx - ax) * u, base + rng.range(0.1, Math.max(0.2, h - ph)) + ph / 2, az + (bz - az) * u,
      yaw, t * 0.55, ph, pw), { masks: [0.55, rng.range(0.35, 0.8), 0.45] });
  }
  /** Soot over every opening, because that is where the fire came out. */
  for (const [h0, h1] of holes) {
    if (h1 >= h - 0.05) continue;
    A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, mx, base + h1 + 0.24, mz, yaw,
      t + 0.13, 0.5, len * rng.range(0.6, 0.95)), { masks: [0.86, 0.24, 0.06] });
  }
  /** Reinforcement torn out of the top of it. Thin, drawn only, on the wall. */
  if (h > 2.2 && rng.float() < 0.5) {
    const u = rng.range(0.2, 0.8);
    A.add('metal_rust', BOX_THIN(A), LL(IDENT,
      ax + (bx - ax) * u, base + h + rng.range(0.15, 0.6), az + (bz - az) * u,
      rng.float() * 6.28, 0.035, rng.range(0.5, 1.5), 0.035,
      rng.range(-0.7, 0.7), rng.range(-0.7, 0.7)), { masks: [0.95, 0.7, 0] });
  }
  return { gap: false, top: base + h };
}

/**
 * A RUN OF WALL, cut into panels, each one given its own top by `env`.
 *
 * `env(u, i, n)` returns the height of panel `i` over the footing, and it is
 * where every silhouette in this file comes from — an eaves line, a gable, a
 * course of footings you see clean over, a corner still standing at nine metres.
 * The panel is the unit because a wall whose whole length shares one top is a
 * fence: what makes a ruin readable is that you can be behind 3.4 m of it on one
 * bearing and fire over 1.15 m of it on another.
 */
function wallLine(A, rng, gy, key, inner, ax, az, bx, bz, t, env, opts = {}) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(2, Math.round(len / (opts.panel ?? 2.3)));
  const clears = [];
  let topMax = 0;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const px0 = ax + (bx - ax) * t0, pz0 = az + (bz - az) * t0;
    const px1 = ax + (bx - ax) * t1, pz1 = az + (bz - az) * t1;
    const e = env((i + 0.5) / n, i, n);
    const r = panel(A, rng, gy, key, inner, px0, pz0, px1, pz1, e.h, t,
      { holes: e.holes, course: opts.course, batter: opts.batter });
    if (!r) continue;
    if (r.clear) clears.push(r.clear);
    if (r.top) topMax = Math.max(topMax, r.top);
  }
  return { clears, topMax };
}

// ─────────────────────────────────────────────────────────── the vocabulary ──
/**
 * The damage table. A panel is drawn from it once and the roll decides what the
 * shell did to that bay: still standing, holed, taken down to a course you can
 * see over, or gone entirely.
 *
 * CORNERS SURVIVE and that is not a flourish — a corner panel is braced on two
 * axes, which is why real ruins are mostly corners, and it is also what gives a
 * building a silhouette after the middle of it has gone.
 */
function storeyHoles(rng, h, storeys) {
  const holes = [];
  for (let s = 0; s < storeys; s++) {
    const sill = 0.95 + s * 3.05;
    if (sill + 1.9 > h - 0.35) break;
    if (rng.float() < 0.28) continue;              // a bay with no opening
    holes.push([sill, sill + rng.range(1.15, 1.45)]);
  }
  return holes;
}

/**
 * WHERE THE ROOF WENT. Two or three slabs leaning off the inside of a wall,
 * AUTHORED OVER 52° — past `NavGrid`'s 46° limit — so the cells beneath them are
 * refused rather than turned into a ramp the bots try to walk up. Same rule and
 * the same numbers `plains-cover.ruin` already ships.
 */
function fallenRoof(A, rng, gy, P, w, d, n) {
  for (let i = 0; i < n; i++) {
    const [px, pz] = P(rng.range(-0.36, 0.36) * w, rng.range(-0.36, 0.36) * d);
    const base = gy(px, pz);
    const len = rng.range(2.8, 5.0);
    const pitch = rng.range(0.95, 1.28);           // 54-73 degrees
    const yw = rng.float() * 6.28;
    const cy = base + (Math.sin(pitch) * len) / 2;
    const sx = rng.range(1.8, 3.2);
    A.add('concrete', BOX(A), LL(IDENT, px, cy, pz, yw, sx, 0.24, len, -pitch),
      { masks: [0.55, 0.45, 0.3] });
    A.box('concrete', px, cy, pz, sx, 0.24, len, yw, -pitch);
    for (let k = 0; k < 3; k++) {
      A.add('metal_rust', BOX_THIN(A), LL(IDENT,
        px + rng.range(-1.3, 1.3), base + Math.sin(pitch) * len + rng.range(-0.4, 0.5),
        pz + rng.range(-1.3, 1.3), rng.float() * 6.28, 0.03, rng.range(0.6, 1.6), 0.03,
        rng.range(-0.9, 0.9), rng.range(-0.9, 0.9)), { masks: [0.95, 0.7, 0] });
    }
  }
}

/**
 * WHAT IS LEFT INSIDE. Kept clear of every opening — @see rule 4, and the
 * radius is the PROP'S, not the point's, because `interiors.js` tested the
 * centre of a cabinet against a doorway circle and put it half in the door.
 */
function stores(A, rng, gy, P, w, d, clears, n) {
  const ids = ['crate_a', 'crate_c', 'barrel_rust', 'barrel_wood', 'block_big', 'pallet', 'tyre'];
  for (let i = 0; i < n; i++) {
    const [px, pz] = P(rng.range(-0.4, 0.4) * w, rng.range(-0.4, 0.4) * d);
    const id = rng.pick(ids);
    const pr = A.footprintR ? A.footprintR(id, 1.15) : 0.6;
    let blocked = false;
    for (const c of clears) {
      if ((px - c.x) ** 2 + (pz - c.z) ** 2 < (c.r + pr) ** 2) { blocked = true; break; }
    }
    if (blocked) continue;
    A.put(id, px, gy(px, pz) - 0.02, pz, rng.float() * 6.28, rng.range(0.9, 1.15));
  }
}

// ────────────────────────────────────────────────────────────── the shells ──
/**
 * ════════════════════════════════════════════════════════════════════════════
 * A RANGE OF HOUSES — `terrace`
 * ════════════════════════════════════════════════════════════════════════════
 * Two to four bays under one roof line, party walls between them, gables at the
 * ends. It is the shape that says "somebody lived here" at a hundred metres and
 * it is the best value in the file per square metre of ground taken: the front
 * and back walls are two separate occluders 9-12 m apart, so the sightline is
 * broken twice and the space between them is a fighting position.
 *
 * ONE BAY IS ALWAYS TAKEN DOWN. A terrace with every bay standing is a wall with
 * windows in it; the hole is what makes the rest of it read as damage, and it is
 * also the way in.
 */
function terrace(A, rng, gy, cx, cz, yaw, S) {
  const w = S.w, d = S.d, t = rng.range(0.44, 0.58);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx, lz) => [cx + c * lx + s * lz, cz - s * lx + c * lz];
  const key = rng.pick(['plaster_sand', 'plaster_cream', 'brick', 'plaster_white', 'concrete']);
  const inner = rng.float() < 0.55 ? 'brick_fine' : 'concrete_dark';
  const clears = [];

  const nb = 2 + (w > 20 ? 1 : 0) + (rng.float() < 0.5 ? 1 : 0);
  /** Bay boundaries along local x, irregular so it is a street and not a comb. */
  const cuts = [-w / 2];
  for (let i = 1; i < nb; i++) cuts.push(-w / 2 + (w * (i + rng.range(-0.18, 0.18))) / nb);
  cuts.push(w / 2);
  const razed = rng.int(0, nb - 1);
  const bays = [];
  for (let i = 0; i < nb; i++) {
    const two = rng.float() < 0.62;
    bays.push({
      x0: cuts[i], x1: cuts[i + 1],
      state: i === razed ? 'razed' : rng.float() < 0.26 ? 'half' : 'stand',
      eaves: two ? rng.range(6.3, 7.9) : rng.range(3.6, 4.6),
      storeys: two ? 2 : 1,
    });
  }

  /** The long walls, bay by bay: the eaves line steps where the party walls are. */
  for (const side of [-1, 1]) {
    for (let i = 0; i < nb; i++) {
      const B = bays[i];
      const [ax, az] = P(B.x0, (side * d) / 2);
      const [bx, bz] = P(B.x1, (side * d) / 2);
      /** One doorway per bay on the front, half as often on the back. */
      const doorAt = B.state === 'razed' ? -1
        : side < 0 || rng.float() < 0.5 ? rng.float() : -1;
      const env = (u, pi, pn) => {
        if (doorAt >= 0 && Math.abs(u - doorAt) < 0.5 / pn) return { h: 0 };
        if (B.state === 'razed') return { h: rng.float() < 0.3 ? 0 : rng.range(0.5, 1.5) };
        if (B.state === 'half') {
          return { h: pi === 0 || pi === pn - 1 ? rng.range(2.2, 3.6) : rng.range(0.9, 2.2) };
        }
        const roll = rng.float();
        const h = roll < 0.1 ? rng.range(1.1, 2.4)
          : roll < 0.22 ? B.eaves * rng.range(0.55, 0.78)
            : B.eaves * rng.range(0.93, 1.04);
        return { h, holes: storeyHoles(rng, h, B.storeys) };
      };
      const r = wallLine(A, rng, gy, key, inner, ax, az, bx, bz, t, env);
      clears.push(...r.clears);
    }
  }

  /**
   * THE END WALLS, GABLED. A gable is a triangular envelope over the eaves, laid
   * down by the SAME panel machinery — so it arrives as a stepped, broken rake
   * with a ridge cap on every step, which is what a shelled gable actually looks
   * like and is also the only way to have one without a walkable rake.
   */
  for (const [i, sgn] of [[0, -1], [nb - 1, 1]]) {
    const B = bays[i];
    const [ax, az] = P((sgn * w) / 2, -d / 2);
    const [bx, bz] = P((sgn * w) / 2, d / 2);
    const rise = B.state === 'stand' ? rng.range(1.7, 3.0) : 0;
    const gone = B.state === 'razed';
    const env = (u, pi, pn) => {
      if (gone) return { h: rng.float() < 0.35 ? 0 : rng.range(0.6, 1.8) };
      const tri = 1 - Math.abs(u - 0.5) * 2;
      const h = B.eaves * (B.state === 'half' ? 0.62 : 1) + rise * tri * tri ** 0.5;
      if (rng.float() < 0.14) return { h: h * rng.range(0.3, 0.6) };
      return { h, holes: storeyHoles(rng, h, B.storeys) };
    };
    const r = wallLine(A, rng, gy, key, inner, ax, az, bx, bz, t, env, { panel: 1.7 });
    clears.push(...r.clears);
  }

  /** The party walls: one door each, so the terrace is a route and not four pens. */
  for (let i = 1; i < nb; i++) {
    const B = bays[i - 1], C = bays[i];
    const hgt = Math.min(B.eaves, C.eaves) * rng.range(0.55, 0.95);
    const [ax, az] = P(cuts[i], -d / 2 + t);
    const [bx, bz] = P(cuts[i], d / 2 - t);
    const doorAt = rng.range(0.25, 0.75);
    const env = (u, pi, pn) => {
      if (Math.abs(u - doorAt) < 0.55 / pn) return { h: 0 };
      if (B.state === 'razed' || C.state === 'razed') {
        return { h: rng.float() < 0.4 ? 0 : rng.range(0.7, 2.0) };
      }
      return { h: hgt * rng.range(0.8, 1.05) };
    };
    const r = wallLine(A, rng, gy, key, inner, ax, az, bx, bz, 0.38, env, { panel: 2.0 });
    clears.push(...r.clears);
  }

  /** A chimney stack on a party wall: the tallest thing on a house and the one
   *  piece of it that survives a shell, which is why a bombed street is a row
   *  of them. Its top is a ridge like everything else here. */
  if (rng.float() < 0.78) {
    const ci = Math.min(nb - 1, 1 + rng.int(0, Math.max(0, nb - 2)));
    const lz = rng.range(-0.3, 0.3) * d;
    const [ax, az] = P(cuts[ci], lz - 0.44);
    const [bx, bz] = P(cuts[ci], lz + 0.44);
    const hh = Math.max(...bays.map((b) => b.eaves)) + rng.range(1.7, 3.6);
    panel(A, rng, gy, rng.float() < 0.6 ? 'brick' : key, inner, ax, az, bx, bz, hh, 0.8,
      { course: 0.42, batter: 0.01 });
  }

  fallenRoof(A, rng, gy, P, w, d, 2 + (rng.float() < 0.6 ? 1 : 0));
  for (let i = 0; i < 2; i++) {
    const [ax, az] = P(rng.range(-0.4, 0.4) * w, -d / 2 + rng.range(0.5, 1.8));
    const [bx, bz] = P(rng.range(-0.4, 0.4) * w, d / 2 - rng.range(0.5, 1.8));
    fallenMember(A, rng, 'wood_prop_dark', ax, gy(ax, az) + 0.2, az, bx, gy(bx, bz) + 0.38, bz, 0.2);
  }
  const [rx, rz] = P((cuts[razed] + cuts[razed + 1]) / 2, rng.range(-0.2, 0.2) * d);
  drawDebris(A, rng, debrisField(rng, rx, rz, rng.range(6, 8.5), rng.range(0.9, 1.4), RUBBLE_CELL),
    gy, { key, key2: 'concrete_dark', surface: 'concrete' });
  stores(A, rng, gy, P, w, d, clears, 10);
  return Math.hypot(w, d) / 2;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * AN INDUSTRIAL HALL — `hall`
 * ════════════════════════════════════════════════════════════════════════════
 * Twenty-odd metres of blown-open shed: two long side walls at 5.4-7.2 m with
 * three or four full-height breaches in each, a gabled end, a razed end, and a
 * ROW OF PIERS down the middle where the trusses used to bear.
 *
 * THE PIERS ARE THE POINT. A room you can see straight across is a room with one
 * firing position in it; a row of 0.6 m piers at four metres is a space with
 * eight, and it partially breaks the sightline at EVERY height without ever
 * blocking a route — which is the one thing a solid wall cannot do. It is also
 * the cheapest occluder in the file, six boxes and a cap each.
 */
function hall(A, rng, gy, cx, cz, yaw, S) {
  const w = S.w, d = S.d, t = rng.range(0.5, 0.66);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx, lz) => [cx + c * lx + s * lz, cz - s * lx + c * lz];
  const key = rng.pick(['concrete', 'brick', 'plaster_sand']);
  const inner = rng.float() < 0.5 ? 'brick_fine' : 'concrete_dark';
  const eaves = rng.range(5.6, 7.4);
  const clears = [];

  for (const side of [-1, 1]) {
    const [ax, az] = P(-w / 2, (side * d) / 2);
    const [bx, bz] = P(w / 2, (side * d) / 2);
    /** Three or four ways in per side, so the hall is crossed rather than held. */
    const doors = [];
    const nd = 3 + (rng.float() < 0.5 ? 1 : 0);
    for (let i = 0; i < nd; i++) doors.push((i + rng.range(0.3, 0.7)) / nd);
    const env = (u, pi, pn) => {
      for (const dd of doors) if (Math.abs(u - dd) < 0.85 / pn) return { h: 0 };
      const roll = rng.float();
      if (roll < 0.14) return { h: rng.range(0.8, 2.2) };
      const h = eaves * (roll < 0.3 ? rng.range(0.5, 0.75) : rng.range(0.9, 1.05));
      return { h, holes: h > 4.4 ? [[3.2, 4.9]] : [] };
    };
    clears.push(...wallLine(A, rng, gy, key, inner, ax, az, bx, bz, t, env, { panel: 2.6 }).clears);
  }
  /** One gabled end and one taken down — a hall with two ends is a box. */
  {
    const [ax, az] = P(-w / 2, -d / 2);
    const [bx, bz] = P(-w / 2, d / 2);
    const rise = rng.range(2.2, 3.6);
    clears.push(...wallLine(A, rng, gy, key, inner, ax, az, bx, bz, t, (u, pi, pn) => {
      if (Math.abs(u - 0.5) < 0.9 / pn) return { h: 0 };
      const tri = 1 - Math.abs(u - 0.5) * 2;
      return { h: eaves + rise * Math.sqrt(Math.max(0, tri)) };
    }, { panel: 1.8 }).clears);
  }
  {
    const [ax, az] = P(w / 2, -d / 2);
    const [bx, bz] = P(w / 2, d / 2);
    clears.push(...wallLine(A, rng, gy, key, inner, ax, az, bx, bz, t,
      () => ({ h: rng.float() < 0.3 ? 0 : rng.range(0.6, 2.6) }), { panel: 2.0 }).clears);
  }

  /* ---- the piers, and the trusses that were on them --------------------- */
  const np = Math.max(3, Math.round(w / 4.4));
  for (let i = 0; i < np; i++) {
    const lx = -w / 2 + ((i + 0.5) * w) / np;
    const gone = rng.float() < 0.22;
    const ph = gone ? rng.range(0.8, 2.4) : eaves * rng.range(0.86, 0.99);
    const [ax, az] = P(lx - 0.3, rng.range(-0.12, 0.12) * d);
    const [bx, bz] = P(lx + 0.3, rng.range(-0.12, 0.12) * d);
    panel(A, rng, gy, key, inner, ax, az, bx, bz, ph, 0.62, { course: 0.5 });
    /**
     * A SNAPPED TRUSS, HANGING OFF ITS OWN PIER. Drawn only — a lattice member
     * six metres up is not a surface anybody stands on, and the drawn-mass half
     * of `_floatcheck` is satisfied by it touching the pier it fell off rather
     * than by anything under it.
     */
    if (!gone && rng.float() < 0.55) {
      const [px, pz] = P(lx, 0);
      const [qx, qz] = P(lx + rng.range(-2.6, 2.6), rng.range(-0.45, 0.45) * d);
      fallenMember(A, rng, 'metal_rust', px, gy(px, pz) + ph - 0.3, pz,
        qx, gy(qx, qz) + rng.range(0.3, 1.4), qz, 0.16);
    }
  }
  fallenRoof(A, rng, gy, P, w, d, 3 + (rng.float() < 0.5 ? 1 : 0));
  for (let k = 0; k < 2; k++) {
    const [rx, rz] = P(rng.range(-0.35, 0.35) * w, rng.range(-0.3, 0.3) * d);
    drawDebris(A, rng, debrisField(rng, rx, rz, rng.range(4.5, 6.5), rng.range(0.7, 1.2), RUBBLE_CELL),
      gy, { key: 'concrete', key2: 'metal_rust', surface: 'concrete' });
  }
  stores(A, rng, gy, P, w, d, clears, 12);
  return Math.hypot(w, d) / 2;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * A FOUR-STOREY SHELL — `blockhouse`
 * ════════════════════════════════════════════════════════════════════════════
 * Small in plan and TALL: 9-12 m by 8-10 m, standing to eleven metres. It is the
 * best silhouette-per-square-metre in the file and it is what goes wherever the
 * armour lanes leave only a small hole.
 *
 * WHAT MAKES IT A RUIN AND NOT A TOWER: three courses of window openings up
 * every standing face, one face taken clean out, and a corner that has come down
 * diagonally — the panel envelope does the last one with four lines of
 * arithmetic and it is the single most legible damage cue at 200 m, because what
 * the eye reads against the sky is the RAKE.
 */
function blockhouse(A, rng, gy, cx, cz, yaw, S) {
  const w = S.w, d = S.d, t = rng.range(0.46, 0.6);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx, lz) => [cx + c * lx + s * lz, cz - s * lx + c * lz];
  const key = rng.pick(['plaster_sand', 'concrete', 'brick', 'plaster_cream']);
  const inner = rng.float() < 0.5 ? 'brick_fine' : 'concrete_dark';
  const full = rng.range(8.6, 11.6);
  const storeys = 3;
  const clears = [];
  /** Which face is gone, and which way the rake falls off the tall corner. */
  const blown = rng.int(0, 3);
  const rakeFrom = rng.float() < 0.5 ? 0 : 1;

  const SIDES = [
    [-w / 2, -d / 2, w / 2, -d / 2],
    [w / 2, -d / 2, w / 2, d / 2],
    [w / 2, d / 2, -w / 2, d / 2],
    [-w / 2, d / 2, -w / 2, -d / 2],
  ];
  for (let i = 0; i < 4; i++) {
    const [lax, laz, lbx, lbz] = SIDES[i];
    const [ax, az] = P(lax, laz);
    const [bx, bz] = P(lbx, lbz);
    const doorAt = i === blown ? -1 : rng.float() < 0.6 ? rng.range(0.2, 0.8) : -1;
    const env = (u, pi, pn) => {
      if (doorAt >= 0 && Math.abs(u - doorAt) < 0.55 / pn) return { h: 0 };
      if (i === blown) return { h: rng.float() < 0.45 ? 0 : rng.range(0.7, 2.6) };
      /**
       * THE RAKE. The wall falls from full height at one end to a third of it at
       * the other, jittered — one line for the shape a collapsing corner leaves,
       * and it is why no two faces of this building read alike.
       */
      const v = rakeFrom ? u : 1 - u;
      const h = full * (0.34 + 0.66 * Math.min(1, v * 1.35)) * rng.range(0.93, 1.03);
      if (rng.float() < 0.1) return { h: h * rng.range(0.35, 0.6) };
      return { h, holes: storeyHoles(rng, h, storeys) };
    };
    clears.push(...wallLine(A, rng, gy, key, inner, ax, az, bx, bz, t, env, { panel: 2.1 }).clears);
  }

  /** One internal cross wall with a door: two positions rather than one pen. */
  {
    const at = rng.range(-0.22, 0.22) * w;
    const hgt = rng.range(2.4, full * 0.55);
    const [ax, az] = P(at, -d / 2 + t);
    const [bx, bz] = P(at, d / 2 - t);
    const doorAt = rng.range(0.3, 0.7);
    clears.push(...wallLine(A, rng, gy, inner, key, ax, az, bx, bz, 0.36, (u, pi, pn) =>
      (Math.abs(u - doorAt) < 0.6 / pn ? { h: 0 } : { h: hgt * rng.range(0.8, 1.06) }),
    { panel: 1.9 }).clears);
  }
  fallenRoof(A, rng, gy, P, w, d, 2 + (rng.float() < 0.5 ? 1 : 0));
  const [rx, rz] = P(rng.range(-0.4, 0.4) * w, rng.range(-0.4, 0.4) * d);
  drawDebris(A, rng, debrisField(rng, rx, rz, rng.range(5.5, 7.5), rng.range(0.9, 1.4), RUBBLE_CELL),
    gy, { key, key2: 'concrete_dark', surface: 'concrete' });
  stores(A, rng, gy, P, w, d, clears, 8);
  return Math.hypot(w, d) / 2;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * A GRAIN TERMINAL — `silos`
 * ════════════════════════════════════════════════════════════════════════════
 * Two to four ruptured cylinders, nine to thirteen metres, standing in a row.
 *
 * THIS IS THE 200 m READ, and it is the reason it is in the file at all. The
 * plain is 400 m across at 21:40 under a moon at 0.049 and the only thing the
 * eye resolves at that range is what stands AGAINST THE SKY. A gable does it at
 * 2.6° of arc; a thirteen-metre silo does it at four, from every bearing,
 * without depending on which way the building happens to face.
 *
 * IT IS BUILT OUT OF STAVES rather than out of a tube, and that is not a
 * shortcut: a `tubeY` cylinder collided as a box is a 4 m flat deck at 13 m —
 * the tallest island a piece could make on this map — while eighteen boxes on a
 * circle are eighteen `panel()` calls, which means eighteen ridge caps and a
 * ragged top rim that no ray can stand on. The breach is three staves wide and
 * FULL HEIGHT, so the inside is real ground, reachable, and one component with
 * the plain: a tower you can be inside on a map that has none.
 */
function silos(A, rng, gy, cx, cz, yaw, S) {
  const n = S.n ?? 3;
  const r = rng.range(2.1, 2.6);
  const key = rng.float() < 0.5 ? 'concrete' : 'plaster_white';
  const inner = 'concrete_dark';
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx, lz) => [cx + c * lx + s * lz, cz - s * lx + c * lz];
  const pitch = r * 2 + 0.25;
  let maxTop = 0;
  for (let k = 0; k < n; k++) {
    const [ox, oz] = P((k - (n - 1) / 2) * pitch, rng.range(-0.5, 0.5));
    const h = rng.range(8.6, 13.2) * (k === 0 || k === n - 1 ? rng.range(0.72, 1.0) : 1);
    maxTop = Math.max(maxTop, h);
    const segs = 18;
    const face = 2 * r * Math.sin(Math.PI / segs);
    /** The breach: three staves out of eighteen, on its own bearing per silo. */
    const b0 = rng.int(0, segs - 1);
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2 + yaw;
      const rr = r - 0.22;
      const mx = ox + Math.cos(a) * rr, mz = oz + Math.sin(a) * rr;
      const tang = a + Math.PI / 2;
      const ax = mx - Math.sin(tang) * face * 0.5, az = mz - Math.cos(tang) * face * 0.5;
      const bx = mx + Math.sin(tang) * face * 0.5, bz = mz + Math.cos(tang) * face * 0.5;
      const dd = Math.min((i - b0 + segs) % segs, (b0 - i + segs) % segs);
      /** Full height, so nothing overhangs the way in. @see rule 1. */
      const hh = dd <= 1 ? 0 : dd === 2 ? h * rng.range(0.18, 0.4)
        : h * rng.range(0.78, 1.02) * (dd < 5 ? 0.82 : 1);
      panel(A, rng, gy, key, inner, ax, az, bx, bz, hh, 0.44, { course: 0.62, batter: 0 });
    }
    /** The spill: what came out of the hole, relaxed so it is walkable. */
    const ba = (b0 / segs) * Math.PI * 2 + yaw;
    const sx = ox + Math.cos(ba) * (r + 2.2), sz = oz + Math.sin(ba) * (r + 2.2);
    drawDebris(A, rng, debrisField(rng, sx, sz, rng.range(3.4, 5.0), rng.range(0.5, 0.95), RUBBLE_CELL),
      gy, { key: 'sand', key2: 'concrete_dark', surface: 'dirt' });
  }
  /**
   * THE CONVEYOR GALLERY between the head of the range and the ground — DRAWN
   * ONLY. It is the piece that makes four cylinders read as a grain terminal
   * rather than as four cylinders, it is eight metres up where nobody stands,
   * and it lands on the silo it leans against, which is what the drawn half of
   * `_floatcheck` asks of it.
   */
  {
    const [hx, hz] = P((-(n - 1) / 2) * pitch, 0);
    const [tx, tz] = P((-(n - 1) / 2) * pitch - rng.range(7, 11), rng.range(-2, 2));
    fallenMember(A, rng, 'corrugated', hx, gy(hx, hz) + maxTop * rng.range(0.7, 0.88), hz,
      tx, gy(tx, tz) + rng.range(0.4, 1.6), tz, 0.55);
  }
  return (n * pitch) / 2 + r;
}

// ────────────────────────────────────────────────────────────── the anchors ──
/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHERE THEY STAND, AND EVERY NUMBER HERE WAS MEASURED BEFORE IT WAS WRITTEN
 * ════════════════════════════════════════════════════════════════════════════
 * A building is the one thing in `plains-cover.js`'s world that goes over
 * `tank.js`'s `PASS_TOP`, so unlike a berm or a wreck it cannot be placed by the
 * crossing solver and left to `TALL` to keep the armour safe. It has to be
 * placed against the ARMOUR, and the armour's table may not be imported or
 * copied here.
 *
 * SO IT WAS MEASURED OFFLINE AND THE RESULT IS THIS TABLE. `PLAINS_ROUTES`
 * expands to 102 segments — six approaches and thirty spokes — and every
 * candidate on a 2 m lattice over the walkable disc was scored against ALL of
 * them, against the three trench lines, and against every pad. What survived:
 *
 *   `tank`    metres from the nearest route CENTRELINE. `_bakePath` fires a
 *             9 m side probe each way and pinches only when `dR + dL` falls
 *             under `HULL_W + CLEARANCE` = 3.55 m, so what this has to buy is
 *             not distance, it is the guarantee that no centreline runs THROUGH
 *             a shell. `cap` below is `tank − 6`, i.e. six metres of daylight
 *             between the outermost wall and the middle of the lane.
 *   `trench`  ≥ 14 m from NORDGRABEN, SUDGRABEN and MITTELSAPPE. `isOpen`
 *             refuses the corridors anyway; this keeps the RUBBLE off them too.
 *   `pad`     ≥ 14 m outside every capture circle, both bases, the tower's
 *             apron and the fortress's reach. The objective is not a building.
 *
 * …and the survivors were then taken ONE PER SECTOR PER RING — three rings out
 * to 148 m, eight sectors — rather than by score, because the failure this file
 * is answering is REGIONAL. Greedy-by-score put fourteen of sixteen on the rim,
 * where the openness metric is highest because the mountain is behind you and
 * where nobody fights.
 *
 * `cap` IS THE HALF-DIAGONAL BUDGET and it is what chooses the building: the
 * kind is not authored, it is the largest shell that fits the hole the armour
 * left. The three sites with under nine metres get a blockhouse (7.3 m
 * half-diagonal, and the tallest thing in the file); the three with fourteen get
 * a hall or a long terrace.
 *
 * THE SOLVER STILL HAS THE LAST WORD. `isOpen` is consulted over the whole
 * outline, the ground is checked for flatness, and every existing cover station
 * is checked for clash — so a station the crossing solver happened to put here
 * moves this, not the other way round, and the table is a preference rather than
 * a claim.
 */
const ANCHORS = [
  //  x     z        r      lane   fall   what the sweep sized the hole for
  [-114, -32],  //  118    11.4   1.6 m   west of the tower, north flank
  [-58, -84],   //  102    10.4   1.4 m   the north-west approach
  [-78, -130],  //  152    11.4   1.9 m   behind NORDGRABEN's west end
  [-44, -116],  //  124    16.1   2.1 m   the north base's western push
  [-14, -110],  //  111     9.3   0.3 m   the north hollow — the flattest site on the map
  [14, -112],   //  113    14.5   2.2 m   the north base's eastern push
  [54, -142],   //  152    13.7   2.6 m   the north-east corner
  [86, -124],   //  151    10.8   0.7 m   the north-east shoulder, outside E
  [48, -56],    //   74    13.5   0.9 m   between the tower and E
  [66, -48],    //   82    12.6   1.1 m   …and its second building
  [84, -34],    //   91    11.6   1.3 m   the east centre
  [132, -30],   //  135    18.2   2.1 m   the east foot — the widest hole on the map
  [86, 20],     //   88    13.1   2.6 m   east of the fortress
  [114, 60],    //  129    14.0   2.5 m   between B and E
  [40, 22],     //   46     9.7   1.6 m   the closest to D anything may stand
  [84, 80],     //  116    14.0   2.9 m   south-east of the fortress, short of B
  /**
   * IT WAS (78, 102) AND THAT COST TWO LEGS, which is the one thing this table
   * is written to prevent and is worth keeping rather than quietly correcting.
   * The first sweep scored every candidate against the AUTHORED polylines, and
   * a spoke does not end at its last authored waypoint: `_trimToStandoff`
   * extends it to the capture circle and trims it there, so BLUE-W->B and
   * BLUE-C->B both run the 52 m from (66, 104) in to zone B that the table
   * never states. (78, 102) measured 12.2 m from the nearest authored segment
   * and 0.2 m from that stretch. Both legs came back
   * "SPOKE DROPPED — ends 37 m off the point (needs <= 34) — pinch 3.1 m at
   * (82, 104)", which is `_bakePath` reporting a building in the road exactly
   * as it should. The model now carries one entry segment per spoke — 132 of
   * them rather than 102 — and every anchor above was re-measured against it.
   */
  [84, 130],    //  155    17.3   2.3 m   the south-east, short of the south base
  [40, 118],    //  125    16.2   1.9 m   the south base's western push
  [-48, 144],   //  152    15.8   3.1 m   the south-west corner
  [-44, 104],   //  113    14.6   0.9 m   the south hollow
  [-86, 124],   //  151    14.3   1.5 m   between C and the south base
  [-144, 46],   //  151    11.4   2.0 m   the west foot, north of C
  [-92, 6],     //   92    10.3   1.0 m   the west centre
];
/**
 * The half-diagonal each anchor may spend: its measured distance to the nearest
 * armour centreline, LESS FOUR METRES of daylight between the outermost wall
 * and the middle of the lane. Four rather than six, and the reason is in the
 * arithmetic rather than in nerve: `_bakePath`'s slide is
 * `clamp((dR − dL) · 0.5, ±3)`, which always moves the centreline AWAY from the
 * nearer obstruction, so a shell beside a lane can never pull the line into
 * itself; and the pinch it is tested against needs the SUM of both side probes
 * to fall under 3.55 m, which four metres on one side and nine on the other is
 * three times clear of. The gate that decides this is `[tank] 36/36` and it is
 * run either side of every change to this table.
 */
const CAPS = [
  7.4, 6.4, 7.4, 12.1, 5.3, 10.5, 9.7, 6.8, 9.5, 8.6, 7.6, 14.2,
  9.1, 10.0, 5.7, 10.0, 13.3, 11.8, 11.8, 10.6, 10.3, 7.4, 6.3,
];

/**
 * The shells. `r` is the half-diagonal of the footprint and it is what the
 * anchor's budget is spent on; `mass` is the half-extent used for clash tests
 * against the crossing solver's own stations, which is exactly the distinction
 * `plains-cover.KIND_MASS` records having had to learn when a separation radius
 * was credited with covering a lane.
 *
 * THE LADDER IS WALKED IN A ROTATED ORDER, one preferred kind per anchor —
 * @see `buildRuinQuarter`. Walked strictly largest-first it stood up fourteen
 * blockhouses out of twenty-three, because a blockhouse is the only thing that
 * fits a small hole and most of the holes the armour leaves are small. Fourteen
 * of one building is one building drawn fourteen times, which is the failure the
 * fires' `size` field exists to avoid on the ridge and is the same failure here.
 */
const SHELLS = [
  { kind: 'hall', w: 20, d: 12, r: 11.7, mass: 10.6 },
  { kind: 'terrace', w: 20, d: 8.6, r: 10.9, mass: 9.9 },
  { kind: 'silos', n: 4, w: 20.5, d: 5.4, r: 10.6, mass: 9.5 },
  { kind: 'terrace', w: 17, d: 8, r: 9.4, mass: 8.5 },
  { kind: 'silos', n: 3, w: 15.4, d: 5.4, r: 8.2, mass: 7.4 },
  { kind: 'blockhouse', w: 11.5, d: 9.5, r: 7.4, mass: 6.8 },
  { kind: 'blockhouse', w: 9.5, d: 8.2, r: 6.3, mass: 5.8 },
  { kind: 'silos', n: 2, w: 10.4, d: 5.4, r: 5.9, mass: 5.2 },
  { kind: 'blockhouse', w: 8, d: 7, r: 5.3, mass: 4.9 },
];
/** Which kind each anchor asks for first. Rotated, so no two neighbours match. */
const PREFER = ['blockhouse', 'silos', 'terrace', 'hall'];

// ──────────────────────────────────────────────────────────────────── build ──
/**
 * THE PASS. Called from `plains-cover.buildCover`, off its own fixed-seed
 * stream, so it moves nothing any earlier pass placed — the same rule
 * `plains-tower.js`, `plains-fort.js` and `zoneWorks` follow.
 *
 * @param {Assembler} A
 * @param {(x:number,z:number)=>number} groundY  `plainsY` — the analytic plain
 * @param {(x,z,m)=>boolean} isOpen              `plainsOpen`
 * @param {Array} pads                           `PLAINS.pads`
 * @param {Array} sites                          what the cover solver already stood up
 * @returns {Array} one `{ x, z, r, kind }` per shell, for the vegetation mask
 */
export function buildRuinQuarter(A, groundY, isOpen, pads, sites) {
  const rng = new Rng(0x7d31a9);
  const out = [];

  /**
   * Would this shell stand here? Four questions, and the first three are the
   * ones a single inflated point test gets wrong — @see `plains-cover.stations`,
   * where testing a 19 m berm's centre against `isOpen` inflated by its radius
   * either refused ground it fits on or accepted ground it does not.
   */
  /** Why an attempt was refused, so a dropped anchor is a diagnosis. */
  const why = { open: 0, slope: 0, cover: 0, shell: 0, pad: 0 };
  const fits = (S, x, z, yaw) => {
    const hw = S.w / 2, hd = S.d / 2;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const lx = i * hw, lz = j * hd;
        if (!isOpen(x + c * lx + s * lz, z - s * lx + c * lz, 1.2)) { why.open++; return false; }
      }
    }
    /**
     * FLAT ENOUGH TO BUILD ON. The swell runs to 0.37 of gradient at its worst,
     * and every wall here takes its own footing from `groundY` at its own
     * midpoint — so a range of houses on a hillside is a range of houses that
     * STEPS, which is right, but 4 m of fall across one building is a gable with
     * its foot in the air at one end and its sill buried at the other. Nine
     * samples over the footprint; 2.4 m of range is about seven degrees.
     */
    let lo = Infinity, hi = -Infinity;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const lx = i * hw, lz = j * hd;
        const g = groundY(x + c * lx + s * lz, z - s * lx + c * lz);
        lo = Math.min(lo, g); hi = Math.max(hi, g);
      }
    }
    if (hi - lo > 3.4) { why.slope++; return false; }
    /**
     * CLEAR OF EVERYTHING THE CROSSING AND RING SOLVERS ALREADY STOOD UP, and
     * the number is `mr` — the MASS half-extent — rather than `r`, the
     * SEPARATION radius, for the reason `plains-cover.KIND_MASS` records having
     * had to learn: `KIND_R` credits a burnt lorry standing 8.5 m away with
     * being 9 m wide. Judged on `r` this pass stood up four shells of sixteen;
     * judged on what the two pieces would actually occupy, the question is
     * simply whether they interpenetrate.
     */
    for (const st of sites) {
      const need = (st.mr ?? st.r ?? 4) + S.mass + 1.5;
      if ((x - st.x) ** 2 + (z - st.z) ** 2 < need * need) { why.cover++; return false; }
    }
    /** Between two shells, a street: enough to walk down and fight along. */
    for (const st of out) {
      if ((x - st.x) ** 2 + (z - st.z) ** 2 < (st.r + S.r + 7) ** 2) { why.shell++; return false; }
    }
    /** …and off every objective, on the piece rather than on the point. */
    for (const p of pads) {
      if (p.id === 'TOWER' || p.id === 'FORT') continue;   // `isOpen` owns those
      const keep = (p.id.startsWith('BASE') ? p.r0 + 9 : p.r0 + 6) + S.mass;
      if ((x - p.x) ** 2 + (z - p.z) ** 2 < keep * keep) { why.pad++; return false; }
    }
    return true;
  };

  let dropped = 0;
  const counts = {};
  for (let ai = 0; ai < ANCHORS.length; ai++) {
    const [x0, z0] = ANCHORS[ai];
    const cap = CAPS[ai];
    let placed = false;
    /**
     * The anchor's own preference first, then everything else, each group
     * largest-first. @see the note on `SHELLS`.
     */
    const want = PREFER[ai % PREFER.length];
    const ladder = SHELLS.filter((s) => s.kind === want).concat(SHELLS.filter((s) => s.kind !== want));
    for (const S of ladder) {
      if (S.r > cap) continue;
      /**
       * ────────────────────────────────────────────────────────────────────
       * THE ANCHOR IS A PREFERENCE, NOT A COORDINATE — and the slide is
       * BUDGETED OFF THE SAME MEASUREMENT THE ANCHOR IS
       * ────────────────────────────────────────────────────────────────────
       * It slides before it shrinks, and shrinks before it gives up, exactly as
       * the crossing solver does: the offline sweep that produced `ANCHORS`
       * knows about the armour, the trenches and the pads and knows NOTHING
       * about where the crossing solver's hundred stations landed, because those
       * are placed by a search of their own against the same ground.
       *
       * HOW FAR IT MAY SLIDE IS NOT A TASTE NUMBER. `cap` is the half-diagonal
       * this anchor can spend before its outermost wall comes within six metres
       * of an armour centreline. A shell whose own half-diagonal is `S.r` is
       * therefore free to move `cap − S.r` in ANY direction and still hold that
       * margin — a blockhouse in a hole sized for a hall gets seven metres of
       * search, a hall in the same hole gets none. Plus two, because six metres
       * is already three times the 3.55 m of total span `_bakePath` needs and
       * the gate that decides this is `[tank] 36/36`, not this arithmetic.
       */
      const slide = Math.max(4, cap - S.r) + 2;
      for (let att = 0; att < 96 && !placed; att++) {
        const rad = att === 0 ? 0 : slide * Math.sqrt((att % 12) / 12);
        const ang = att * 2.399963;
        const x = x0 + Math.cos(ang) * rad;
        const z = z0 + Math.sin(ang) * rad;
        const yaw = (att % 8) * (Math.PI / 8) + rng.range(-0.16, 0.16);
        if (!fits(S, x, z, yaw)) continue;
        let r;
        if (S.kind === 'hall') r = hall(A, rng, groundY, x, z, yaw, S);
        else if (S.kind === 'terrace') r = terrace(A, rng, groundY, x, z, yaw, S);
        else if (S.kind === 'silos') r = silos(A, rng, groundY, x, z, yaw, S);
        else r = blockhouse(A, rng, groundY, x, z, yaw, S);
        out.push({ x, z, r: Math.max(r, S.mass), kind: S.kind });
        counts[S.kind] = (counts[S.kind] ?? 0) + 1;
        placed = true;
      }
      if (placed) break;
    }
    if (!placed) dropped++;
  }

  console.info(
    `[world] nachtfeld ruins: ${out.length}/${ANCHORS.length} shells — ` +
    Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') +
    (dropped ? ` · ${dropped} anchor(s) DROPPED, nothing would stand` : '') +
    ` · refusals ${Object.entries(why).map(([k, v]) => `${k} ${v}`).join(' ')}`
  );
  return out;
}
