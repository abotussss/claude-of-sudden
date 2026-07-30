import { BOX, BOX_SOFT, BOX_THIN, IDENT, LL } from './kit.js';
import { chamferBox, patchGeometry, fillMasks, rockGeometry } from './util.js';
import { SITEWORKS } from './layout.js';

/**
 * WORLD — SITEWORKS: the mass that makes an OBJECTIVE defensible.
 *
 * It says "bomb site" in a lot of places below and that word is now wrong: the
 * mode is DOMINATION and these pieces stand on the three CAPTURE ZONES
 * `src/match/sites.js` publishes as `ZONES`, not on the two plant circles it
 * publishes as `SITES`. The zones are 10.5 m of ground north of where the plant
 * circles were, and the whole table in layout.js moved with them — see the note
 * over `SITEWORKS` there for the measurements, and for the 3.2-5.0 authored band
 * every piece of cover now has to sit in. Zone C, the mid street, had no
 * siteworks at all before that pass and now has five.
 *
 * The what and the why are in that long note. This file is the geometry, and it
 * exists as its own module rather than as more cases inside `relief.js` because
 * it is a different contract:
 *
 *   `relief.js`   TERRACES are ramped ground bots walk; DECKS and BLOCKS are
 *                 stacked, so they DELETE the nav cell under them and are a
 *                 player-only flank by construction.
 *   this file      every piece stands ON the ground both teams walk, and is
 *                 therefore an OBSTACLE IN A ROUTE. A run of it laid solid across
 *                 a courtyard is a wall A* cannot cross and the whole mode stops
 *                 working — which is why the authored runs come in segments with
 *                 gaps, and why `navcheck` is a gate on this file and not a
 *                 formality.
 *
 * QUALITY. These are the closest pieces of geometry to the camera in the two
 * places on the map the player spends the most time, so none of them is an
 * extruded rectangle:
 *
 *   - masonry is COURSED. Every block is its own box with its own length, its
 *     own millimetre of set-back, and its own wear mask, and the perpends
 *     stagger course by course the way a wall is actually laid.
 *   - a low wall has a BROKEN TOP. The course count is driven by a slow noise
 *     along the run, so the profile steps up and down instead of being ruled,
 *     and the capping stops where the wall has come down.
 *   - where it is broken there is REBAR: bent bar stubs out of the core, which
 *     is the detail that separates a demolished wall from a low wall.
 *   - everything meets the ground on SAND AND SPALL rather than on a polygon
 *     edge, and everything has a dark core so a gap between courses cannot show
 *     sky through the mass.
 *
 * Nothing is allocated per frame: this all runs once inside `WorldSystem.init`,
 * and every one-off geometry goes through `A.addOnce`, which disposes it.
 */

/** side -> outward unit vector, matching the rest of the level (0=-Z … 3=-X). */
const OUT = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** A cheap, smooth, deterministic 1-D wobble for broken-top profiles. */
function wobble(t, seed) {
  return (
    0.5 * Math.sin(t * 1.7 + seed) +
    0.32 * Math.sin(t * 3.9 + seed * 2.3) +
    0.18 * Math.sin(t * 8.1 + seed * 5.1)
  );
}

/**
 * Is (x, z) inside a sitework footprint? `dressing.isOpen` asks, for the same
 * reason it asks `inRelief`: the scatter is placed at `groundY`, so a crate
 * dropped inside a pier ends up buried in it and a stain painted on one is
 * painted on the ground underneath.
 */
export function inSitework(x, z, m = 0.3) {
  for (let i = 0; i < SITEWORKS.length; i++) {
    const p = SITEWORKS[i];
    if (
      x > p.x - p.w / 2 - m &&
      x < p.x + p.w / 2 + m &&
      z > p.z - p.d / 2 - m &&
      z < p.z + p.d / 2 + m
    )
      return true;
  }
  return false;
}

/**
 * Sand banked and masonry spalled where a mass meets the ground.
 *
 * `dressing.groundSkirt` does this job for props, but importing it here would
 * make world's module graph circular (dressing already imports `inSitework`
 * from this file), so this is the same idea in twenty lines.
 */
function footing(A, rng, p, x0, z0, x1, z1) {
  const per = Math.max(6, Math.round(((x1 - x0 + z1 - z0) * 2) * 1.1));
  for (let i = 0; i < per; i++) {
    const side = rng.int(0, 3);
    const [ox, oz] = OUT[side];
    const px = ox !== 0 ? (ox > 0 ? x1 : x0) + ox * rng.range(0.05, 0.75) : rng.range(x0, x1);
    const pz = oz !== 0 ? (oz > 0 ? z1 : z0) + oz * rng.range(0.05, 0.75) : rng.range(z0, z1);
    const g = patchGeometry(rng, rng.range(0.28, 0.8), { lobes: 9, wobble: 0.6 });
    A.addOnce('sand', g, LL(IDENT, px, 0.042, pz, rng.float() * 6.28, 1, 1, rng.range(0.5, 0.95)), {
      masks: [0.12, rng.range(0.5, 0.8), rng.range(0.35, 0.6)],
    });
    if (rng.float() < 0.45) {
      const rg = rockGeometry(rng, rng.range(0.06, 0.17), 1, rng.range(0.5, 0.8));
      fillMasks(rg, 0.85, rng.range(0.3, 0.7), 0.15);
      A.addOnce('concrete_dark', rg, LL(IDENT, px, rng.range(0.02, 0.09), pz, rng.float() * 6.28));
    }
  }
}

/**
 * Bent reinforcing bar stubbing out of a broken face. Three or four bars, each
 * kinked once, which is what a bar looks like after the concrete came off it.
 */
function rebar(A, rng, x, y, z, n, up = 0.32) {
  for (let i = 0; i < n; i++) {
    const bx = x + rng.range(-0.28, 0.28);
    const bz = z + rng.range(-0.16, 0.16);
    const h1 = up * rng.range(0.45, 0.8);
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, bx, y + h1 / 2, bz, 0, 0.016, h1, 0.016), {
      masks: [1, 0.9, 0.1],
    });
    // the kink: the top third bent over
    const lean = rng.range(0.35, 0.95) * (rng.float() < 0.5 ? -1 : 1);
    const h2 = up * rng.range(0.3, 0.55);
    A.add(
      'metal_rust',
      BOX_THIN(A),
      LL(IDENT, bx + Math.sin(lean) * h2 * 0.5, y + h1 + Math.cos(lean) * h2 * 0.5, bz, 0, 0.015, h2, 0.015, 0, lean),
      { masks: [1, 0.95, 0.1] }
    );
  }
}

/**
 * A coursed masonry face.
 *
 * `top(t)` gives the height of the wall at 0..1 along the run, so one call lays
 * a face with a broken profile: courses are only laid while the coursing height
 * is under the local top.
 */
function coursedFace(A, rng, key, x0, z0, x1, z1, side, top, course = 0.32) {
  const [ox, oz] = OUT[side];
  const alongX = ox === 0;
  const a = alongX ? x0 : z0;
  const b = alongX ? x1 : z1;
  const fixed = ox > 0 ? x1 : ox < 0 ? x0 : oz > 0 ? z1 : z0;
  const span = b - a;
  if (span <= 0.02) return;
  const hMax = Math.max(top(0), top(0.5), top(1));
  const courses = Math.max(1, Math.round(hMax / course));
  const ch = hMax / courses;
  for (let c = 0; c < courses; c++) {
    const cy = (c + 0.5) * ch;
    // Stagger the perpends course by course, the way a real wall is laid.
    let t = a + (c % 2 ? rng.range(0.12, 0.42) : 0);
    while (t < b - 0.04) {
      const bl = Math.min(rng.range(0.42, 0.98), b - t);
      if (bl < 0.14) break;
      // Skip a block wherever the wall has come down below this course.
      const mid = (t + bl / 2 - a) / span;
      if (cy > top(mid)) {
        t += bl + rng.range(0.01, 0.03);
        continue;
      }
      const set = rng.range(-0.014, 0.02); // faces are never flush
      const cxm = alongX ? t + bl / 2 : fixed + ox * (0.095 + set);
      const czm = alongX ? fixed + oz * (0.095 + set) : t + bl / 2;
      A.add(
        key,
        BOX(A),
        LL(
          IDENT,
          cxm,
          cy,
          czm,
          rng.range(-0.012, 0.012),
          alongX ? bl - 0.025 : 0.2,
          ch - 0.02,
          alongX ? 0.2 : bl - 0.025
        ),
        { masks: [rng.range(0.3, 0.95), rng.range(0.25, 0.85), 0.3 + (1 - cy / hMax) * 0.45] }
      );
      t += bl + rng.range(0.01, 0.03);
    }
  }
}

/**
 * A SANDBAG REVETMENT along the fighting face of a wall.
 *
 * Two courses banked against the foot of the run on the side the fire comes
 * from. It exists for a reason that is not decoration: the pieces that carry
 * `revet: true` in `SITEWORKS` are the ones that now stand between an attack and
 * a CAPTURE POINT — the two spines, the two retake walls and both of zone C's
 * street screens — and a bare 1.45 m garden wall in the middle of a street does
 * not read as somebody's fighting position. Bags at its foot say a side has been
 * holding this and expects to keep holding it.
 *
 * It is 0.30-0.34 m tall, which is deliberately UNDER `sitecheck`'s 0.9 m cover
 * line and under `CoverMap.build`'s 1.32 m standing-cover probe: this must not
 * change a single measurement, only what the wall looks like from 2 m. It also
 * carries no collision — the wall's own box already stands at full height right
 * through it, so a bag cannot become a step, a ledge or a nav cell.
 *
 * `sandbag_a/b/c` are `src/world/props.js`'s own prototypes, registered at
 * line 126 of index.js, long before `buildSiteWorks` runs at 163. Reusing them
 * costs no new geometry, no new material and no new draw call. Building this
 * here rather than importing `sandbagWall` from dressing.js is deliberate:
 * dressing.js already imports `inSitework` from THIS file, and closing that loop
 * would make world's module graph circular.
 *
 * @param {number} face  +1 to bank the bags on the +Z side of the run, -1 for -Z
 */
const BAG_IDS = ['sandbag_a', 'sandbag_b', 'sandbag_c'];
function revetment(A, rng, p, face) {
  const len = p.w - 0.25; // stop short of each end: a revetment is not a plinth
  if (len < 0.6) return;
  const zEdge = p.z + face * (p.d / 2 + 0.16);
  let prev = -1;
  for (let c = 0; c < 2; c++) {
    /** The bottom course carries the top one and squats under it. */
    const squash = c === 0 ? 0.9 : 1.0;
    const spread = c === 0 ? 1.07 : 1.0;
    const pitch = 0.5 - rng.range(0.02, 0.05);
    const per = Math.max(2, Math.round(len / pitch));
    const stagger = (c % 2) * pitch * 0.5 + rng.range(-0.03, 0.03);
    for (let i = c; i < per - c; i++) {
      const lx = p.x - len / 2 + stagger + (i + 0.5) * pitch;
      if (Math.abs(lx - p.x) > len / 2) continue;
      // Never the same silhouette twice running.
      let pick = rng.int(0, 2);
      if (pick === prev) pick = (pick + 1 + rng.int(0, 1)) % 3;
      prev = pick;
      /** Headers — bags turned across the run — are what stops a row of loaves. */
      const header = rng.float() < 0.28;
      A.putS(
        BAG_IDS[pick],
        lx,
        0.01 + c * 0.15 * squash,
        zEdge + rng.range(-0.04, 0.04) - face * (c * 0.05),
        (header ? Math.PI / 2 : 0) + rng.range(-0.2, 0.2),
        rng.range(0.9, 1.12) * spread,
        rng.range(0.9, 1.06) * squash,
        rng.range(0.94, 1.12) * spread,
        [1, rng.range(0.7, 1.6), rng.range(0.85, 1.3)],
        rng.range(-0.09, 0.09),
        rng.range(-0.11, 0.11)
      );
    }
  }
}

/**
 * A LOW WALL — chest high to a standing man, full cover to a crouching one.
 *
 * The piece the plant is made behind. Deliberately broken: the top steps between
 * `h` and about 0.62 h along the run, the concrete capping only survives where
 * the wall is at full height, and the low stretches have bar out of them.
 */
function buildWall(A, rng, p) {
  const w = p.w;
  const d = p.d;
  const x0 = p.x - w / 2;
  const x1 = p.x + w / 2;
  const z0 = p.z - d / 2;
  const z1 = p.z + d / 2;
  const alongX = w >= d;
  const key = p.key ?? 'brick';
  const seed = (p.x * 0.37 + p.z * 0.71) % 6.283;

  /** Broken profile: full height, dropping to ~0.62 where it has come down. */
  const top = (t) => p.h * (0.81 + 0.19 * Math.max(-1, Math.min(1, wobble(t * 4.2, seed))));

  // ---- the mass. One collision box at the FULL height: a wall you can shoot
  //      over is not a wall you may shoot through, and the broken profile is
  //      3-8 cm of relief that a capsule sweep should not be able to find.
  A.box('concrete', p.x, p.h / 2, p.z, w, p.h, d);
  // A dark core, so a gap between courses cannot show sky through the wall.
  A.add('concrete_dark', BOX(A), LL(IDENT, p.x, p.h * 0.44, p.z, 0, w - 0.22, p.h * 0.9, d - 0.22), {
    masks: [0.25, 0.85, 0.7],
  });

  for (const side of [0, 1, 2, 3]) {
    // The two ends of a run are half the area of the faces and take a coarser
    // profile; running `top` along them would read the wobble across the wall.
    const isEnd = alongX ? side === 1 || side === 3 : side === 0 || side === 2;
    coursedFace(A, rng, key, x0, z0, x1, z1, side, isEnd ? () => top(side === 1 || side === 2 ? 1 : 0) : top);
  }

  // ---- capping, in the stretches that are still standing
  const steps = Math.max(3, Math.round((alongX ? w : d) / 0.7));
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const th = top(t);
    if (th < p.h * 0.9) continue; // come down here: no coping left
    const len = (alongX ? w : d) / steps;
    A.add(
      'concrete_dark',
      BOX_SOFT(A),
      LL(
        IDENT,
        alongX ? x0 + w * t : p.x,
        th + 0.035,
        alongX ? p.z : z0 + d * t,
        rng.range(-0.02, 0.02),
        alongX ? len - 0.02 : d + 0.06,
        0.1,
        alongX ? d + 0.06 : len - 0.02
      ),
      { masks: [0.95, rng.range(0.25, 0.6), 0.08] }
    );
  }

  // ---- rebar out of the broken stretches
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const th = top(t);
    if (th > p.h * 0.78 || rng.float() < 0.45) continue;
    rebar(A, rng, alongX ? x0 + w * t : p.x, th - 0.04, alongX ? p.z : z0 + d * t, rng.int(2, 3), 0.3);
  }

  // ---- masonry that has fallen off, piled on the low side
  for (let i = 0; i < Math.round((w + d) * 1.6); i++) {
    const s = rng.float() < 0.5 ? -1 : 1;
    const px = alongX ? rng.range(x0, x1) : p.x + s * (d === 0 ? 0 : w / 2 + rng.range(0.05, 0.5));
    const pz = alongX ? p.z + s * (d / 2 + rng.range(0.05, 0.5)) : rng.range(z0, z1);
    const g = rockGeometry(rng, rng.range(0.07, 0.2), 1, rng.range(0.45, 0.8));
    fillMasks(g, 0.8, rng.range(0.3, 0.8), 0.2);
    A.addOnce(key, g, LL(IDENT, px, rng.range(0.03, 0.11), pz, rng.float() * 6.28));
  }

  /**
   * The bags, on the face the fire comes from. Every `revet` piece in SITEWORKS
   * runs along X with the attack to its +Z, so that is the side; a run authored
   * along Z is not revetted rather than revetted on a guess.
   */
  if (p.revet && alongX) revetment(A, rng, p, 1);

  footing(A, rng, p, x0, z0, x1, z1);
}

/**
 * A PIER — a solid single-storey mass with a coping. Full cover, and at a mouth
 * it is the chokepoint.
 *
 * Coursed on all four faces with a plinth course standing proud at the bottom
 * and a capping band at the top, plus a painted maintenance band at 1.1 m: a
 * 3 m blank face with nothing at human scale on it reads as a placeholder box
 * however good the material is, and the band is what gives the eye the height.
 */
function buildPier(A, rng, p) {
  const w = p.w;
  const d = p.d;
  const x0 = p.x - w / 2;
  const x1 = p.x + w / 2;
  const z0 = p.z - d / 2;
  const z1 = p.z + d / 2;
  const key = p.key ?? 'plaster_sand';
  const seed = (p.x * 0.51 + p.z * 0.29) % 6.283;
  const top = (t) => p.h * (0.965 + 0.035 * wobble(t * 3.1, seed));

  A.box('concrete', p.x, p.h / 2, p.z, w, p.h, d);
  A.add('concrete_dark', BOX(A), LL(IDENT, p.x, p.h * 0.46, p.z, 0, w - 0.2, p.h * 0.94, d - 0.2), {
    masks: [0.25, 0.85, 0.65],
  });

  for (const side of [0, 1, 2, 3]) coursedFace(A, rng, key, x0, z0, x1, z1, side, top, 0.36);

  // ---- plinth course, standing 5 cm proud all round
  A.add('concrete', BOX_SOFT(A), LL(IDENT, p.x, 0.19, p.z, 0, w + 0.1, 0.38, d + 0.1), {
    masks: [0.9, 0.85, 0.6],
  });
  // ---- capping band and a coping lip over it
  A.add('concrete', BOX(A), LL(IDENT, p.x, p.h - 0.19, p.z, 0, w + 0.05, 0.34, d + 0.05), {
    masks: [0.85, 0.35, 0.1],
  });
  A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, p.x, p.h + 0.03, p.z, 0, w + 0.18, 0.11, d + 0.18), {
    masks: [0.95, 0.3, 0.05],
  });

  // ---- the painted band, at hand height, chipped along its length
  const bandY = 1.1;
  for (const side of [0, 1, 2, 3]) {
    const [ox, oz] = OUT[side];
    const alongX = ox === 0;
    const a = alongX ? x0 : z0;
    const b = alongX ? x1 : z1;
    const fixed = ox > 0 ? x1 : ox < 0 ? x0 : oz > 0 ? z1 : z0;
    let t = a;
    while (t < b - 0.05) {
      const bl = Math.min(rng.range(0.4, 1.3), b - t);
      if (rng.float() < 0.26) {
        t += bl;
        continue;
      } // chipped away here
      A.add(
        rng.float() < 0.5 ? 'plaster_white' : 'plaster_blue',
        BOX_THIN(A),
        LL(
          IDENT,
          alongX ? t + bl / 2 : fixed + ox * 0.135,
          bandY + rng.range(-0.02, 0.02),
          alongX ? fixed + oz * 0.135 : t + bl / 2,
          0,
          alongX ? bl - 0.02 : 0.012,
          rng.range(0.2, 0.3),
          alongX ? 0.012 : bl - 0.02
        ),
        { masks: [rng.range(0.5, 1.0), rng.range(0.4, 0.9), 0.1] }
      );
      t += bl + rng.range(0.02, 0.12);
    }
  }

  // ---- one shell hole and the bar behind it, on the face that takes the fire
  if (p.h > 2.2) {
    const side = rng.int(0, 3);
    const [ox, oz] = OUT[side];
    const hx = ox !== 0 ? (ox > 0 ? x1 : x0) : rng.range(x0 + 0.5, x1 - 0.5);
    const hz = oz !== 0 ? (oz > 0 ? z1 : z0) : rng.range(z0 + 0.5, z1 - 0.5);
    const hy = rng.range(1.5, p.h - 0.6);
    for (let i = 0; i < 7; i++) {
      const g = rockGeometry(rng, rng.range(0.07, 0.16), 1, rng.range(0.5, 0.85));
      fillMasks(g, 0.95, 0.8, 0.1);
      A.addOnce(
        'concrete_dark',
        g,
        LL(IDENT, hx + rng.range(-0.3, 0.3) - ox * 0.06, hy + rng.range(-0.28, 0.28), hz + rng.range(-0.3, 0.3) - oz * 0.06, rng.float() * 6.28)
      );
    }
    rebar(A, rng, hx - ox * 0.1, hy - 0.18, hz - oz * 0.1, 2, 0.26);
  }

  // ---- drip staining and a drainpipe stub off the coping
  for (let i = 0; i < 5; i++) {
    const side = rng.int(0, 3);
    const [ox, oz] = OUT[side];
    const alongX = ox === 0;
    const t = rng.range(0.15, 0.85);
    const sx = alongX ? x0 + w * t : (ox > 0 ? x1 : x0) + ox * 0.01;
    const sz = alongX ? (oz > 0 ? z1 : z0) + oz * 0.01 : z0 + d * t;
    const len = rng.range(0.5, p.h * 0.7);
    A.add(
      'concrete_dark',
      BOX_THIN(A),
      LL(IDENT, sx, p.h - 0.28 - len / 2, sz, 0, alongX ? rng.range(0.1, 0.34) : 0.008, len, alongX ? 0.008 : rng.range(0.1, 0.34)),
      { masks: [1, 1, 0.05] }
    );
  }

  footing(A, rng, p, x0, z0, x1, z1);
}

/**
 * A PLINTH — a waist-high cast concrete pad. The cover 3 m off the charge.
 *
 * THE FIRST VERSION OF THIS WAS THE WEAKEST THING IN EITHER COURTYARD, and it
 * took a screenshot to see it: from the defence's hold at 6 m it read as two
 * smooth grey boxes. Every surface it had was one uncut plane a metre and a half
 * across, and no amount of material detail rescues a silhouette that is a
 * rectangle. So it is now built the way a machine base actually is:
 *
 *   - a STEP. The pad pours at two heights, the taller two thirds at `h` and the
 *     rest 0.35 m down, which gives it a profile from every angle and gives the
 *     player a choice between standing cover and something to shoot over.
 *   - FORMWORK. Bolt pockets down each long face on the 0.6 m grid a shutter is
 *     actually tied on, and the horizontal seam where the two lifts met.
 *   - a KERB that overhangs, so the top edge catches the sun as a line rather
 *     than as the end of a face.
 *   - one corner knocked off with the bar showing, and the pipe stubs cast into
 *     the top that say the thing used to carry something.
 */
function buildPlinth(A, rng, p) {
  const w = p.w;
  const d = p.d;
  const x0 = p.x - w / 2;
  const x1 = p.x + w / 2;
  const z0 = p.z - d / 2;
  const z1 = p.z + d / 2;
  const key = p.key ?? 'concrete';
  /** Which end steps down, and how far along. */
  const stepSide = rng.float() < 0.5 ? -1 : 1;
  const alongX = w >= d;
  const cut = rng.range(0.58, 0.7);
  /**
   * How far the step drops, and it is bounded from BELOW for a gameplay reason
   * rather than a visual one. The first version dropped 0.30-0.40 m off a 1.2 m
   * pad, which put the low third at 0.80-0.90 m — under the 0.9 m line
   * `sitecheck` counts as cover and under the 1.32 m probe `CoverMap.build` uses
   * to call a spot STANDING cover. Measured: site A's mass inside the plant zone
   * went from 28.0 m² to 21.5 m², i.e. a quarter of the cover this whole pass
   * exists to add was given back for a silhouette. 0.20-0.30 m keeps the low
   * step at 0.90-1.00 m and still reads as a step from 3 m.
   */
  const lowH = p.h - rng.range(0.2, 0.3);

  // ---- collision: the tall part at full height, the step at its own
  const tall = (alongX ? w : d) * cut;
  const low = (alongX ? w : d) - tall;
  const tallC = (alongX ? p.x : p.z) - stepSide * low / 2;
  const lowC = (alongX ? p.x : p.z) + stepSide * tall / 2;
  A.box('concrete', alongX ? tallC : p.x, p.h / 2, alongX ? p.z : tallC, alongX ? tall : w, p.h, alongX ? d : tall);
  A.box('concrete', alongX ? lowC : p.x, lowH / 2, alongX ? p.z : lowC, alongX ? low : w, lowH, alongX ? d : low);

  // ---- the pour, in two lifts with a visible day joint between them
  const lift = lowH * 0.62;
  A.add(key, BOX(A), LL(IDENT, p.x, lift / 2, p.z, 0, w, lift, d), {
    masks: [0.55, 0.8, 0.55],
  });
  A.add(
    key,
    BOX(A),
    LL(
      IDENT,
      alongX ? tallC : p.x,
      lift + (p.h - lift) / 2,
      alongX ? p.z : tallC,
      0,
      alongX ? tall - 0.03 : w - 0.03,
      p.h - lift,
      alongX ? d - 0.03 : tall - 0.03
    ),
    { masks: [0.45, 0.6, 0.3] }
  );
  A.add(
    key,
    BOX(A),
    LL(
      IDENT,
      alongX ? lowC : p.x,
      lift + (lowH - lift) / 2,
      alongX ? p.z : lowC,
      0,
      alongX ? low - 0.03 : w - 0.03,
      lowH - lift,
      alongX ? d - 0.03 : low - 0.03
    ),
    { masks: [0.5, 0.7, 0.4] }
  );
  A.add('concrete_dark', BOX_THIN(A), LL(IDENT, p.x, lift, p.z, 0, w + 0.01, 0.03, d + 0.01), {
    masks: [0.9, 0.9, 0.4],
  });

  // ---- kerbs: a chamfered cap standing proud of each level
  const kg = chamferBox(alongX ? tall + 0.12 : w + 0.12, 0.14, alongX ? d + 0.12 : tall + 0.12, 0.03);
  fillMasks(kg, 0.95, 0.35, 0.06);
  A.addOnce('concrete_dark', kg, LL(IDENT, alongX ? tallC : p.x, p.h - 0.04, alongX ? p.z : tallC));
  const kg2 = chamferBox(alongX ? low + 0.1 : w + 0.1, 0.12, alongX ? d + 0.1 : low + 0.1, 0.028);
  fillMasks(kg2, 0.95, 0.45, 0.06);
  A.addOnce('concrete_dark', kg2, LL(IDENT, alongX ? lowC : p.x, lowH - 0.03, alongX ? p.z : lowC));

  // ---- formwork bolt pockets, on the 0.6 m grid a shutter is tied on
  for (const side of [0, 1, 2, 3]) {
    const [ox, oz] = OUT[side];
    const faceAlongX = ox === 0;
    const a = faceAlongX ? x0 : z0;
    const b = faceAlongX ? x1 : z1;
    const fixed = ox > 0 ? x1 : ox < 0 ? x0 : oz > 0 ? z1 : z0;
    const n = Math.max(1, Math.round((b - a) / 0.6));
    for (let i = 0; i < n; i++) {
      for (const hy of [lift * 0.55, lift + (lowH - lift) * 0.6]) {
        if (hy > lowH - 0.16) continue;
        const t = a + ((i + 0.5) / n) * (b - a);
        A.add(
          'concrete_dark',
          BOX_THIN(A),
          LL(
            IDENT,
            faceAlongX ? t : fixed + ox * 0.006,
            hy,
            faceAlongX ? fixed + oz * 0.006 : t,
            0,
            faceAlongX ? 0.075 : 0.006,
            0.075,
            faceAlongX ? 0.006 : 0.075
          ),
          { masks: [1, 0.95, 0.35] }
        );
      }
    }
  }

  // ---- pipe stubs cast into the tall top: this used to carry something
  for (let i = 0; i < rng.int(2, 3); i++) {
    const px = alongX ? tallC + rng.range(-tall / 2 + 0.2, tall / 2 - 0.2) : p.x + rng.range(-w / 2 + 0.2, w / 2 - 0.2);
    const pz = alongX ? p.z + rng.range(-d / 2 + 0.2, d / 2 - 0.2) : tallC + rng.range(-tall / 2 + 0.2, tall / 2 - 0.2);
    const ph = rng.range(0.1, 0.22);
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, px, p.h + ph / 2, pz, rng.float() * 6.28, 0.055, ph, 0.055), {
      masks: [1, 0.85, 0.15],
    });
  }

  // ---- one corner spalled off, with bar
  const sx = rng.float() < 0.5 ? x0 : x1;
  const sz = rng.float() < 0.5 ? z0 : z1;
  for (let i = 0; i < 11; i++) {
    const g = rockGeometry(rng, rng.range(0.06, 0.17), 1, rng.range(0.45, 0.8));
    fillMasks(g, 0.9, rng.range(0.4, 0.9), 0.12);
    A.addOnce(
      'concrete_dark',
      g,
      LL(
        IDENT,
        sx + (sx < p.x ? 1 : -1) * rng.range(0.02, 0.34),
        rng.range(lowH - 0.42, lowH - 0.02),
        sz + (sz < p.z ? 1 : -1) * rng.range(0.02, 0.34),
        rng.float() * 6.28
      )
    );
  }
  rebar(A, rng, sx + (sx < p.x ? 0.16 : -0.16), lowH - 0.26, sz + (sz < p.z ? 0.16 : -0.16), 2, 0.24);

  // ---- streaked staining down the faces
  for (let i = 0; i < 8; i++) {
    const side = rng.int(0, 3);
    const [ox, oz] = OUT[side];
    const faceAlongX = ox === 0;
    const t = rng.range(0.15, 0.85);
    const px = faceAlongX ? x0 + w * t : (ox > 0 ? x1 : x0) + ox * 0.008;
    const pz = faceAlongX ? (oz > 0 ? z1 : z0) + oz * 0.008 : z0 + d * t;
    const len = rng.range(0.25, lowH * 0.8);
    A.add(
      'concrete_dark',
      BOX_THIN(A),
      LL(IDENT, px, lowH - 0.14 - len / 2, pz, 0, faceAlongX ? rng.range(0.08, 0.26) : 0.007, len, faceAlongX ? 0.007 : rng.range(0.08, 0.26)),
      { masks: [1, 1, 0.06] }
    );
  }

  footing(A, rng, p, x0, z0, x1, z1);
}

/** Build every authored sitework piece. Called from `WorldSystem.init`. */
export function buildSiteWorks(A, rng) {
  for (const p of SITEWORKS) {
    if (p.kind === 'pier') buildPier(A, rng, p);
    else if (p.kind === 'plinth') buildPlinth(A, rng, p);
    else buildWall(A, rng, p);
  }
}
