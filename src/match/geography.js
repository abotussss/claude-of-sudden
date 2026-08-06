/**
 * ════════════════════════════════════════════════════════════════════════════
 * MATCH — GEOGRAPHY. The level-space transforms, once, and the per-map selector.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES, AND WHY IT HAD TO STOP BEING FIVE COPIES
 * ────────────────────────────────────────────────────────────────────────────
 * `src/match` may not import `src/world`, so the town's authoring transform —
 * its 1.5x scale and the `widenX` that prised its mid street open — was
 * re-declared BY HAND in five files:
 *
 *     sites.js      SCALE, SPREAD, WB, WK, widenX, L, LW
 *     airstrike.js  SCALE, SPREAD, WB, WK, widenX, L, LC
 *     bomber.js     SCALE, L
 *     strafe.js     SCALE, L
 *     tank.js       SCALE, L
 *
 * each under a comment begging whoever moved one to move the others. Five
 * copies of one number is five chances to have four of them, and the failure is
 * silent: an anchor a metre off the facade drops with a logged reason, but a
 * ROUTE authored a metre off the kerb bakes perfectly and drives somewhere
 * nobody is.
 *
 * It is one statement now, and every one of those files aliases it back to the
 * name its own tables already use, so not a digit of authored geography moved.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * …AND THE PLAIN IS WHAT MADE THE DUPLICATION ACTIVELY MISLEADING
 * ────────────────────────────────────────────────────────────────────────────
 * `src/world/levels/plains.js` is authored at yaw 0, scale 1, origin 0 — LEVEL
 * SPACE IS WORLD SPACE on NACHTFELD. A number in that file, a number in a
 * plains table here and a `--at=` argument to `tools/zonespot.mjs` are the same
 * point, and there is nothing to keep in sync at all. A file that carries one
 * `SCALE = 1.5` at module scope and applies it to every table in it cannot say
 * that; a file that names the town's transform `townScaled` can.
 *
 * Every authored table below the transform is still authored in LEVEL space and
 * still goes through `world.levelToWorld` at bake time, exactly as it always
 * has. On the town that rotates and translates it; on the plain it is the
 * identity. Neither table knows which.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE SELECTOR IS `world.level.id`, AND IT IS THE THIRD OF ITS KIND
 * ────────────────────────────────────────────────────────────────────────────
 * `MAPS`/`layoutFor` in `sites.js` picks the zone and spawn tables; `MAP_RULES`/
 * `applyMapRules` in `rules.js` picks the tuning. `forMap` below is the same
 * move for the four systems that carry their own authored geography — the tank
 * routes, the strike sites, the bomber runs and the strafe lines.
 *
 * IT READS `world.level.id` AND NOT A SECOND PARSE OF `?map=`, for the reason
 * `layoutFor`'s own note gives: two places parsing the query string is two
 * places to disagree, and the failure is exactly the one this module exists to
 * fix — the town's polylines baked against the plain's ground, silently, with
 * nothing dropped and nothing warned, because open ground is walkable
 * everywhere. An unknown id falls back to the town's table and SAYS SO.
 */

/* ─────────────────────────────────────────────────── the town's transform ── */
/**
 * THE TOWN IS 1.5x. `src/world/levels/town.js` scales its whole authored plan
 * by this before it builds a thing, so every level-space point `match` authors
 * against that plan has to move with it or the mode plays the old map's
 * geometry on the new map's ground.
 */
export const TOWN_SCALE = 1.5;
/**
 * …AND ITS MID STREET WAS PRISED OPEN, WHICH IS A SECOND TRANSFORM.
 *
 * `widenX` in the town's layout stretches everything inside the old kerb line
 * and TRANSLATES everything outside it by 9 authored units, so the mid street
 * went from 13 to 31 units across and the two building rows, both lanes and
 * both courtyards moved out with their walls. Anything authored ON a facade
 * takes it; anything authored on the street centreline is unaffected, because
 * the transform is the identity there.
 */
export const TOWN_SPREAD = 9.0;
/** Half-width of the old kerb line — inside this the street is stretched. */
const TOWN_WB = 6.2;
const TOWN_WK = 1 + TOWN_SPREAD / TOWN_WB;

export const townWidenX = (x) =>
  Math.abs(x) <= TOWN_WB ? x * TOWN_WK : x + Math.sign(x) * TOWN_SPREAD;

/**
 * SCALED ONLY. For points authored in the WIDENED plan — the street
 * centrelines, the spawn clusters, the zones, the cathedral (which is a new
 * building standing in the street the widen created) and the tank routes, whose
 * whole polyline is on the one centreline `widenX` leaves alone.
 */
export const townScaled = (x, z) => [x * TOWN_SCALE, z * TOWN_SCALE];

/**
 * WIDENED, THEN SCALED. For points authored ON A FACADE — the strike anchors
 * and the two courtyards — every one of which moved outward by 9 authored units
 * when the street opened.
 */
export const townWidened = (x, z) => [townWidenX(x) * TOWN_SCALE, z * TOWN_SCALE];

/* ────────────────────────────────────────────────────────── the selector ── */
/**
 * Pick one map's table out of a `{ [levelId]: table }` object.
 *
 * @param {object} tables  keyed by `world.level.id`; `town` is the fallback
 * @param {object} world   the `world` subsystem, for `level.id`
 * @param {string} what    what is being picked, for the warning
 * @returns {*} the map's table, or the town's
 */
export function forMap(tables, world, what) {
  const id = world?.level?.id;
  const t = id ? tables[id] : null;
  if (t) return t;
  if (id) console.warn(`[match] no ${what} authored for map "${id}" — using the town's`);
  return tables.town;
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * NACHTFELD, FOR THE FILES THAT AUTHOR AGAINST IT
 * ────────────────────────────────────────────────────────────────────────────
 * The plain's own numbers, repeated here for the same reason the town's scale
 * is: `match` may not import `src/world/levels/plains.js`. Unlike the town's
 * they are not a TRANSFORM — nothing is multiplied by them — they are the four
 * facts a table on this map has to be authored against, and each one is
 * independently checkable at boot (`world.level.ridge`, `world.level.pads`,
 * `MAPS.plains` in sites.js).
 *
 * IF THESE MOVE, `tools/navcheck.mjs` AND THE PER-SYSTEM DROP LOGS ARE THE
 * GATE, exactly as they are for the town's.
 */
export const PLAINS = {
  /** Zone centres, metres, world space. @see `PLAINS_ZONES` in sites.js. */
  ZONES: {
    A: [-118, -104],
    B: [118, 104],
    C: [-128, 86],
    E: [128, -86],
    D: [0, 0],
  },
  /** Both base pads. @see `PADS` in `src/world/levels/plains.js`. */
  BASE_N: [-14, -150],
  BASE_S: [14, 150],
  /**
   * The foot of the mountain. Past this the face pitches over at 50-64°, the
   * nav grid's own slope limit stops it, and nothing may be authored there.
   */
  RIDGE_R0: 176,
};
