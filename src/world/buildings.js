import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import {
  facadeWall,
  windowUnit,
  windowState,
  doorUnit,
  shopfront,
  balcony,
  parapet,
  stairRun,
  awning,
  drainpipe,
  spallPatch,
  rubbleMound,
  BOX,
  BOX_SOFT,
  IDENT,
  LL,
  worldOf,
} from './kit.js';
import { chamferBox, clothGeometry, fbm3, patchGeometry, runoffStreak } from './util.js';
import { furnishRoom } from './interiors.js';
import { featureKeepClear } from './features.js';

/**
 * WORLD — building assembly.
 *
 * A building is a footprint, a floor count and a per-side facade programme. The
 * generator walks each side in ~3 m bays and picks a kit element per bay per
 * floor (shopfront, door, window, arched window, balcony door, blank), then
 * dresses it: plinth, string courses, sills, lintels, shutters, drainpipes,
 * spalled render, bullet damage, roof parapet and roof clutter anchors.
 *
 * Sides are indexed 0:-Z 1:+X 2:+Z 3:-X. Every side gets a panel matrix whose
 * local +Z points INTO the building, so kit elements can work in a single
 * consistent panel space (see kit.js).
 */

const SIDE = [
  { ry: 0, n: [0, 0, -1] },
  { ry: -Math.PI / 2, n: [1, 0, 0] },
  { ry: Math.PI, n: [0, 0, 1] },
  { ry: Math.PI / 2, n: [-1, 0, 0] },
];

const _pm = new THREE.Matrix4();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

function panelMatrix(spec, side, y) {
  const { x, z, w, d } = spec;
  const s = SIDE[side];
  let px = x;
  let pz = z;
  if (side === 0) pz = z - d / 2;
  else if (side === 2) pz = z + d / 2;
  else if (side === 1) px = x + w / 2;
  else px = x - w / 2;
  _e.set(0, s.ry, 0);
  _q.setFromEuler(_e);
  _p.set(px, y, pz);
  _s.set(1, 1, 1);
  return _pm.compose(_p, _q, _s);
}

/** Repair-render key per wall colour: close in value, different in mix. */
const PATCH_KEY = {
  plaster_cream: 'plaster_sand',
  plaster_sand: 'plaster_cream',
  // A white patch on a blue-grey wall is nearly a stop brighter than the wall and
  // reads as a sheet of paper taped to the building — a cement repair does not.
  plaster_blue: 'concrete',
  plaster_pink: 'plaster_sand',
  plaster_white: 'concrete',
};

const sideLen = (spec, side) => (side === 0 || side === 2 ? spec.w : spec.d);

/**
 * Per-floor footprint. `spec.setback = { from, depth, side? }` pulls every floor
 * at or above `from` back from one face, leaving a roof terrace over the floor
 * below — the standard Mediterranean/Levantine form, and the thing that lets
 * afternoon sun down onto the street instead of walling it into shade.
 */
function floorSpec(spec, f) {
  const sb = spec.setback;
  if (!sb || f < sb.from) return spec;
  const d = sb.depth;
  const side = sb.side ?? spec.streetSide ?? 0;
  const o = { ...spec };
  if (side === 1) {
    o.x = spec.x - d / 2;
    o.w = spec.w - d;
  } else if (side === 3) {
    o.x = spec.x + d / 2;
    o.w = spec.w - d;
  } else if (side === 0) {
    o.z = spec.z + d / 2;
    o.d = spec.d - d;
  } else {
    o.z = spec.z - d / 2;
    o.d = spec.d - d;
  }
  return o;
}

/** The strip of roof left exposed by a setback: slab, coping and a parapet. */
function terrace(A, rng, spec, y, t) {
  const sb = spec.setback;
  const side = sb.side ?? spec.streetSide ?? 0;
  const d = sb.depth;
  const horiz = side === 1 || side === 3;
  const sign = side === 1 || side === 2 ? 1 : -1;
  const cx = horiz ? spec.x + sign * (spec.w / 2 - d / 2) : spec.x;
  const cz = horiz ? spec.z : spec.z + sign * (spec.d / 2 - d / 2);
  const sx = horiz ? d : spec.w;
  const sz = horiz ? spec.d : d;
  A.add('roof_screed', BOX(A), LL(IDENT, cx, y - 0.13, cz, 0, sx + 0.08, 0.26, sz + 0.08), {
    masks: [0.45, 0.3, 0.15],
  });
  A.box('concrete', cx, y - 0.13, cz, sx + 0.08, 0.26, sz + 0.08);
  // parapet along the exposed edge, low enough to fight over from the terrace
  const ph = 0.92;
  const px = horiz ? spec.x + sign * (spec.w / 2 - 0.11) : spec.x;
  const pz = horiz ? spec.z : spec.z + sign * (spec.d / 2 - 0.11);
  A.add(spec.wallKey ?? 'plaster_cream', BOX(A), LL(IDENT, px, y + ph / 2, pz, 0, horiz ? 0.22 : spec.w + 0.1, ph, horiz ? spec.d + 0.1 : 0.22), {
    masks: [0.5, 0.5, 0.2],
  });
  A.add('concrete', BOX_SOFT(A), LL(IDENT, px, y + ph + 0.05, pz, 0, horiz ? 0.32 : spec.w + 0.2, 0.1, horiz ? spec.d + 0.2 : 0.32), {
    masks: [0.8, 0.35, 0.1],
  });
  A.box('concrete', px, y + ph / 2, pz, horiz ? 0.26 : spec.w + 0.1, ph + 0.1, horiz ? spec.d + 0.1 : 0.26);
  // the returns at each end of the terrace
  for (const s of [-1, 1]) {
    const ex = horiz ? cx : spec.x + s * (spec.w / 2 - 0.11);
    const ez = horiz ? spec.z + s * (spec.d / 2 - 0.11) : cz;
    A.add(spec.wallKey ?? 'plaster_cream', BOX(A), LL(IDENT, ex, y + ph / 2, ez, 0, horiz ? d : 0.22, ph, horiz ? 0.22 : d), {
      masks: [0.5, 0.5, 0.2],
    });
    A.box('concrete', ex, y + ph / 2, ez, horiz ? d : 0.26, ph, horiz ? 0.26 : d);
  }
  return { cx, cz, sx, sz, y };
}

/**
 * @returns {object} anchors for the dressing pass:
 *   { facades:[{side, x, y, ry, wx, wz, nx, nz}], roof:{...}, doors:[], balconies:[] }
 */
export function buildBuilding(A, rng, spec) {
  const t = spec.t ?? 0.34;
  const floors = spec.floors ?? 3;
  const groundH = spec.groundH ?? 3.45;
  const upperH = spec.upperH ?? 3.05;
  const wallKey = spec.wallKey ?? 'plaster_cream';
  const streetSide = spec.streetSide ?? 0;
  const info = {
    spec,
    floorY: [],
    doors: [],
    balconies: [],
    roofY: 0,
    windows: [],
    awnings: [],
    top: 0,
  };

  // The plinth is built AFTER the facades now — it has to know where the doors
  // ended up. See `plinthCourse` below the floor loop.
  const plinthH = spec.plinthH ?? 0.42;

  /**
   * The floor heights are ARITHMETIC and are now computed up front, before a
   * single wall goes up. They used to be accumulated inside the loop, which
   * meant `info.roofY` did not exist until the loop had finished — and that is
   * why `stairHoles` had to be a hand-authored table of absolute level
   * coordinates in layout.js: nothing inside the loop could work out where a
   * flight to the roof would end. Hand-authored voids are how E2's stairwell
   * came to be measured correct and unusable at the same time, and they cannot
   * survive the level being rescaled. Knowing every floor height first makes
   * `stairVoids` below derivable, which is the whole point.
   */
  let y = 0;
  for (let f = 0; f < floors; f++) {
    info.floorY.push(y);
    y += f === 0 ? groundH : upperH;
  }
  info.roofY = y;
  info.top = y;

  /**
   * Every authored flight, resolved to real geometry, and the VOID each one
   * needs cut in the slab it arrives at.
   *
   * `stairRun` lays a flight from the bottom tread's front-centre climbing +Z,
   * so the footprint is the run plus the landing slab the builder puts at
   * `D + 0.55`. A climbing player needs that whole strip open above him or he
   * walks head-first into the underside of the next floor, so the void is the
   * strip — not a guess at one.
   */
  /**
   * …and WHERE each one stands, which above the ground floor is derived rather
   * than authored. @see `resolveStairFlights` — this is the answer to "階段が
   * 全く同じ位置の縦軸が違うだけ". Written back onto the spec so the builder,
   * the void, the stairhead and `tools/floorcheck.mjs --climb` all read one
   * table. Idempotent: the ground flight it derives from is never rewritten.
   */
  if (spec.stairFlights?.length) {
    spec.stairFlights = resolveStairFlights(spec, info, t, floors);
  }

  info.stairs = [];
  const stairVoids = {};       // level -> {x0,x1,z0,z1}, unioned
  for (const fl of spec.stairFlights ?? []) {
    const g = stairGeometry(spec, info, fl, t, groundH, upperH, floors);
    if (!g) continue;
    info.stairs.push(g);
    const lvl = fl.floor + 1;
    const v = stairVoids[lvl];
    stairVoids[lvl] = v
      ? { x0: Math.min(v.x0, g.void.x0), x1: Math.max(v.x1, g.void.x1),
          z0: Math.min(v.z0, g.void.z0), z1: Math.max(v.z1, g.void.z1) }
      : { ...g.void };
  }
  /** An authored hole still wins, so an existing map can pin one by hand. */
  const holeFor = (level) =>
    (spec.enterable ? (spec.stairHoles?.[level] ?? stairVoids[level] ?? null) : null);

  info.terraces = [];
  y = 0;
  for (let f = 0; f < floors; f++) {
    const h = f === 0 ? groundH : upperH;
    const fs = floorSpec(spec, f);
    for (let side = 0; side < 4; side++) {
      if (spec.skipSides?.includes(side)) continue;
      buildFacade(A, rng, fs, info, { side, f, y, h, t, wallKey, streetSide, floors });
    }
    // ---- floor / ceiling slab of the NEXT level ----
    y += h;
    if (f < floors - 1) {
      interiorSlab(A, rng, floorSpec(spec, f + 1), y, t, holeFor(f + 1));
      // the setback happens on top of this floor: dress the exposed strip
      if (spec.setback && f + 1 === spec.setback.from) {
        info.terraces.push(terrace(A, rng, spec, y, t));
      }
    }
  }

  // ---------------------------------------------------------------- plinth --
  // A base course everywhere: catches the ground grime band and stops the walls
  // reading as slabs dropped on a plane.
  plinthCourse(A, spec, plinthH, spec.plinthKey ?? 'concrete', t, info.doors, !!spec.enterable);

  // ------------------------------------------------------------------ roof --
  const ts = floorSpec(spec, floors - 1);
  const roofHole = holeFor(floors);
  interiorSlab(A, rng, ts, y, t, roofHole, true);
  info.roofHole = roofHole;
  /**
   * WHICH WAY YOU WALK OUT OF THE STAIRHEAD, as a unit vector on the plan axes.
   *
   * Two things need this and they must not disagree: the stairhead cuts its
   * DOORWAY on this side (see `buildInterior`), and `dressBuilding` has to keep
   * the roof clutter off the walk-off in front of that doorway. Both used to
   * assume +Z — the stairhead by deriving it from the flight, the dressing by
   * hard-coding `rh.z1 + 2.4` — and the two agreed only because every top flight
   * on the map climbed +Z. `resolveStairFlights` turns them, so it is derived
   * once here and read twice.
   *
   * MEASURED: without this, `floorcheck` seed 1 put a crate stack in W1's and
   * E1's stairhead doorways and scored both roof flights ARRIVES AT NOTHING —
   * the roof landing has exactly one way off it (the other three probes are the
   * shed's own walls and its stairwell), so anything in the door seals a roof.
   */
  const topG = (info.stairs ?? []).find((s) => s.floor === floors - 1);
  info.roofExit = topG
    ? (Math.abs(Math.sin(topG.ry)) > 0.5
        ? [Math.sign(Math.sin(topG.ry)), 0]
        : [0, Math.sign(Math.cos(topG.ry))])
    : [0, 1];
  if (spec.parapet !== false) {
    parapet(A, spec.parapetKey ?? wallKey, ts.x, ts.z, ts.w + 0.1, ts.d + 0.1, y, rng, {
      h: spec.parapetH ?? 0.78,
      t: 0.22,
    });
  }
  info.roofSpec = ts;

  // ----------------------------------------------------------- interiors ---
  if (spec.enterable) {
    buildInterior(A, rng, spec, info, t, groundH, upperH, floors);
  } else {
    // Non-enterable: a dark core so windows read as depth, not as a hole into
    // a lit empty shell.
    // Sized off the SMALLEST floor plate so a setback never leaves the core
    // poking out through an upper wall.
    const top = floorSpec(spec, floors - 1);
    const inset = 2.0;
    const cw = Math.max(1.0, top.w - inset * 2);
    const cd = Math.max(1.0, top.d - inset * 2);
    // Stop the core short of the roof slab: coplanar faces z-fight, and a dark
    // core showing through the roof turns every rooftop into a grey blotch.
    const coreH = Math.max(0.5, y - 0.45);
    // `interior_shell`, not white plaster: seen through a doorway or a blown-out
    // hole a bright core reads as a sheet of paper taped behind the opening.
    A.add(
      'interior_shell',
      BOX(A),
      LL(IDENT, top.x, coreH / 2, top.z, 0, cw, coreH, cd),
      { masks: [0.1, 0.95, 0.9] }
    );
    /**
     * THE COLLISION IS THE BUILDING, NOT THE DARK CORE — and this line used to
     * be `A.box(top.x, coreH / 2, top.z, cw, coreH, cd)`, the core's own
     * dimensions, which made every background block on the map HOLLOW.
     *
     * The 2 m inset is a LOOK: the shell has to sit behind the glass or it
     * z-fights the window, and it is sized off the smallest floor plate so a
     * setback never pokes it through an upper wall. Neither reason survives
     * being handed to the collision proxy. What it left was a 1.66 m gallery
     * running right round the inside of every non-enterable block at EVERY
     * storey, floored by `interiorSlab` (which spans the full plate less the
     * wall thickness) and roofed by the slab above — and the three east
     * background blocks and their three west twins carry `skipSides: [1]`/`[3]`,
     * so on the outward elevation that gallery has no wall on it at all. It is
     * a 63 m balcony 3.45 m up, on the far side of the compound wall, open to
     * the dunes.
     *
     * MEASURED: `?seed=12` puts a 1.90 m sandbag wall under BE1's west balcony
     * (deck 3.61 m), a 1.71 m mantle against a 1.85 m limit. The capsule steps
     * off the sandbags onto the balcony, through the opening into the gallery,
     * walks 48 m north and 28 m east inside the block and drops off the end of
     * the slab at level x 89.7 into open sand: 7519.4 m² of void, which is the
     * number three agents reported to four significant figures over three
     * unrelated changes. Nothing about the boundary was missing. The wall was
     * there; the building behind it was not.
     *
     * So the mass is authored per floor at that floor's OWN plate, which is
     * what the inset was protecting against in the first place: a setback
     * building gets a wide box under its wide floors and a narrow one over,
     * and no storey has a ledge. The visual core above is untouched.
     */
    for (let f = 0; f < floors; f++) {
      const fs = floorSpec(spec, f);
      const y0 = info.floorY[f];
      const y1 = f + 1 < floors ? info.floorY[f + 1] : y;
      A.box('concrete', fs.x, (y0 + y1) / 2, fs.z, fs.w, y1 - y0, fs.d);
    }
    for (let f = 0; f <= floors; f++) {
      const fs = floorSpec(spec, Math.min(f, floors - 1));
      const fy = f === 0 ? 0.1 : info.floorY[f] ?? y;
      A.add(
        'floor_concrete',
        BOX(A),
        LL(IDENT, fs.x, fy - 0.06, fs.z, 0, fs.w - t * 2, 0.16, fs.d - t * 2),
        { masks: [0.2, 0.8, 0.6] }
      );
      if (f === 0) A.box('concrete', fs.x, fy - 0.06, fs.z, fs.w, 0.2, fs.d);
    }
  }

  // ------------------------------------------------------------- drainpipe --
  // A downpipe has to die into the wall it is clipped to. On a setback face the
  // wall STOPS at the terrace, so a pipe run to the main roof height carries on
  // three metres into open sky and reads as a floating mast — which is exactly
  // what it was doing. Clamp the top to the parapet of whatever surface is
  // actually above the pipe.
  const dpSide = streetSide;
  const pmD = panelMatrix(spec, dpSide, 0);
  const len = sideLen(spec, dpSide);
  const sbSide = spec.setback ? spec.setback.side ?? streetSide : -1;
  const dpTop =
    sbSide === dpSide
      ? (info.floorY[spec.setback.from] ?? info.roofY) + 0.55
      : info.roofY + 0.4;
  drainpipe(A, pmD.clone(), rng.range(-len / 2 + 0.4, -len / 2 + 1.0), dpTop, dpTop, rng);
  if (rng.float() < 0.6) {
    drainpipe(A, pmD.clone(), rng.range(len / 2 - 1.0, len / 2 - 0.4), dpTop, dpTop, rng);
  }

  return info;
}

/**
 * THE BASE COURSE — a ring, not a plug.
 *
 * This used to be a single box the size of the whole footprint with a matching
 * `A.box` collision proxy, and that one proxy is why the player could not get
 * into any building on the map. Two separate ways:
 *
 *   1. It sealed every ground-floor doorway from the floor up to 0.42 m. The
 *      stand step height is 0.42 m exactly (STANCE.stand.stepHeight), so the
 *      capsule was trying to mount a step precisely at its limit and stopped
 *      dead at the threshold — measurably, 0.15-0.38 m short of the footprint,
 *      which is a capsule radius pressed against the lip.
 *   2. It buried the interior. Partitions, stairs and every piece of furniture
 *      are authored at `floorY[0] + 0.13` and the interior slab tops out at
 *      0.14, so a solid 0.42 m plug sank the whole ground floor 0.29 m into
 *      concrete. Nobody had noticed, because nobody could get in to look.
 *
 * So it is four bars around the perimeter instead, flush with the inner face of
 * the wall and notched at every door the facade actually cut. From the street it
 * is the same base course it always was — the inside of a solid box was never
 * visible from outside — but the doorways are now open right down to the floor,
 * and the step from the pavement is the interior slab's 0.09 m rather than 0.42.
 *
 * `notch` is off for non-enterable blocks: their doors are decoration in front
 * of a solid core, and leaving their course unbroken keeps the change to the
 * buildings that are supposed to open.
 */
function plinthCourse(A, spec, h, key, t, doors, notch) {
  const out = 0.07; // how far the course stands proud of the wall
  const bw = out + t / 2; // ring width: flush with the inner face of the wall
  const hw = spec.w / 2 + out;
  const hd = spec.d / 2 + out;
  const half = 0.7; // half the gap a 1.12 m doorway needs, with its reveal

  const gapsOn = (side) =>
    notch
      ? doors.filter((dr) => dr.side === side).map((dr) => (side === 1 || side === 3 ? dr.wp[2] : dr.wp[0]))
      : [];

  /** The stretches of a run left over once the door gaps are taken out. */
  const runs = (lo, hi, gaps) => {
    let segs = [[lo, hi]];
    for (const g of gaps) {
      const next = [];
      for (const [a, b] of segs) {
        const g0 = g - half;
        const g1 = g + half;
        if (g1 <= a || g0 >= b) {
          next.push([a, b]);
          continue;
        }
        if (g0 > a) next.push([a, g0]);
        if (g1 < b) next.push([g1, b]);
      }
      segs = next;
    }
    return segs.filter(([a, b]) => b - a > 0.02);
  };

  const bar = (cx, cz, sx, sz) => {
    A.add(key, BOX(A), LL(IDENT, cx, h / 2, cz, 0, sx, h, sz), { masks: [0.55, 0.75, 0.45] });
    A.box('concrete', cx, h / 2, cz, sx, h, sz);
  };

  // north/south faces run the full width; east/west run between them, so the
  // four bars tile the ring without overlapping at the corners.
  for (const side of [0, 2]) {
    const cz = side === 0 ? spec.z - spec.d / 2 - out + bw / 2 : spec.z + spec.d / 2 + out - bw / 2;
    for (const [a, b] of runs(spec.x - hw, spec.x + hw, gapsOn(side))) {
      bar((a + b) / 2, cz, b - a, bw);
    }
  }
  for (const side of [1, 3]) {
    const cx = side === 1 ? spec.x + spec.w / 2 + out - bw / 2 : spec.x - spec.w / 2 - out + bw / 2;
    for (const [a, b] of runs(spec.z - hd + bw, spec.z + hd - bw, gapsOn(side))) {
      bar(cx, (a + b) / 2, bw, b - a);
    }
  }
}

// =============================================================== facades ====
function buildFacade(A, rng, spec, info, ctx) {
  const { side, f, y, h, t, wallKey, streetSide, floors } = ctx;
  const len = sideLen(spec, side);
  const pm = panelMatrix(spec, side, y).clone();
  const street = side === streetSide;
  const secondary = spec.secondarySide === side;
  const openFace = street || secondary;

  const bays = Math.max(1, Math.round(len / 3.05));
  const bw = len / bays;
  const openings = [];
  const deco = [];

  const ruinTop = spec.ruin && f === floors - 1;

  for (let b = 0; b < bays; b++) {
    const bx = -len / 2 + (b + 0.5) * bw;
    // edge bays keep more solid wall so corners stay strong
    const room = Math.min(bw - 1.0, 2.6);
    let kind = 'blank';
    if (f === 0) {
      if (openFace) {
        const shopHere = spec.shops !== false && room > 2.0 && rng.float() < (street ? 0.5 : 0.25);
        if (spec.doorBays?.[side] === b) kind = 'door';
        else if (shopHere) kind = 'shop';
        else if (rng.float() < 0.72) kind = 'window';
      } else if (rng.float() < 0.4) kind = 'window';
    } else {
      if (rng.float() < (openFace ? 0.88 : 0.6)) {
        kind = spec.arches && f === 1 ? 'arch' : 'window';
        if (openFace && f >= 1 && rng.float() < (spec.balconies ?? 0.35)) kind = 'balconyDoor';
      }
    }
    if (ruinTop && rng.float() < 0.5) kind = kind === 'blank' ? 'blank' : 'ragged';

    /**
     * Hand-authored override for the bays that carry a sightline the map
     * depends on (the shop the interior camera looks out of, the doorway that
     * connects an alley to a stairwell). A string names the kind; an object
     * additionally passes options to the kit element.
     */
    let forced = spec.bayKinds?.[side]?.[f]?.[b];
    if (typeof forced === 'string') forced = { kind: forced };
    if (forced) kind = forced.kind;

    switch (kind) {
      case 'door': {
        const o = { x: bx, y: 1.08, w: 1.12, h: 2.16, kind };
        openings.push(o);
        deco.push(() =>
          doorUnit(A, pm, o, rng, {
            t,
            open: rng.float() < 0.45 ? rng.range(0.5, 1.6) : 0,
            leafKey: rng.pick(['metal_green', 'metal_blue', 'wood_dark']),
          })
        );
        info.doors.push({ side, x: bx, pm, wp: worldOf(pm, bx, 0, 0).slice() });
        break;
      }
      case 'shop': {
        const sw = Math.min(bw - 0.75, 3.1);
        const o = { x: bx, y: 1.32, w: sw, h: 2.58, kind };
        openings.push(o);
        // Never fully shuttered: a market street with every shop closed is dead,
        // and a shutter over an interior sightline blocks the shot.
        const drop = forced?.drop ?? (rng.float() < 0.5 ? rng.range(0.1, 0.55) : 0);
        deco.push(() => shopfront(A, pm, o, rng, { t, drop }));
        if (rng.float() < 0.8) {
          const aw = sw + 0.5;
          deco.push(() =>
            awning(A, pm, bx, o.y + o.h / 2 + 0.55, aw, rng, {
              depth: rng.range(1.3, 1.9),
              key: rng.pick(['fabric_red', 'fabric_teal', 'fabric_cream']),
              legs: rng.float() < 0.4,
            })
          );
          info.awnings.push({ side, x: bx, y: o.y + o.h / 2 + 0.55, w: aw, pm });
        }
        break;
      }
      case 'window': {
        /**
         * A hand-authored window can override its size, its state and its
         * grille. That is what a VAULT-IN is: a wide glassless opening with its
         * sill at 0.95 m, which is under `MOVE.mantle.maxHeight` (1.85) and
         * therefore a real entry, on a face the lane can see. Left to the dice a
         * ground-floor window is 1.05-1.3 m wide, barred 55 % of the time and
         * glazed most of the rest, i.e. never an entry at all.
         */
        const ww = forced?.w ?? Math.min(room, rng.range(1.05, 1.3));
        const wh = forced?.h ?? (f === 0 ? 1.62 : 1.48);
        const o = { x: bx, y: forced?.y ?? (f === 0 ? 1.05 : 0.95) + wh / 2, w: ww, h: wh, kind };
        openings.push(o);
        const broken = forced?.state ? forced.state === 'open' : rng.float() < (spec.damage ?? 0.15) * 1.6;
        // One window per bay is not the same window per bay: pick a state so the
        // facade carries open casements, boarded holes, shut louvres, curtains and
        // the occasional lit room instead of one repeated glazed panel.
        const st =
          forced?.state ??
          (broken ? 'open' : windowState(rng, f, spec.damage ?? 0.15, { allowLit: !openFace || f > 0 }));
        deco.push(() =>
          windowUnit(A, pm, o, rng, {
            t,
            broken,
            state: st,
            back: !spec.enterable,
            grille:
              forced?.grille ?? (f === 0 && st !== 'boarded' && rng.float() < 0.55),
            shutters: f > 0 && (st === 'shuttered' || rng.float() < 0.4),
            shutterKey: spec.shutterKey ?? rng.pick(['metal_blue', 'metal_green', 'wood_dark']),
            curtain: st === 'curtain' || (st === 'glazed' && rng.float() < 0.25),
          })
        );
        info.windows.push({ side, f, x: bx, y: o.y, w: ww, h: wh, pm, state: st });
        break;
      }
      case 'arch': {
        const ww = Math.min(room, 1.35);
        const o = { x: bx, y: 1.05 + 0.9, w: ww, h: 1.9, arch: 0.62, kind };
        openings.push(o);
        const st = windowState(rng, f, spec.damage ?? 0.15);
        deco.push(() =>
          windowUnit(A, pm, o, rng, {
            t,
            broken: rng.float() < 0.2,
            state: st,
            back: !spec.enterable,
            shutters: false,
            curtain: st === 'curtain' || rng.float() < 0.3,
            lintel: false,
          })
        );
        info.windows.push({ side, f, x: bx, y: o.y, w: ww, h: o.h, pm, state: st });
        break;
      }
      case 'balconyDoor': {
        const ww = Math.min(room, 1.15);
        const o = { x: bx, y: 1.12, w: ww, h: 2.24, kind };
        openings.push(o);
        const bwid = Math.min(bw - 0.35, 2.6);
        deco.push(() => {
          doorUnit(A, pm, o, rng, {
            t,
            open: rng.float() < 0.5 ? rng.range(0.6, 1.5) : 0,
            leafKey: 'wood_dark',
          });
          const balY = 0.02;
          const bal = balcony(A, pm, bx, balY, bwid, rng, {
            depth: rng.range(1.0, 1.35),
            railing: rng.float() < 0.45 ? 'concrete' : 'metal',
            key: spec.wallKey ?? 'plaster_cream',
          });
          // `y` here is PANEL-LOCAL, like info.windows/info.awnings: `pm`
          // already carries the floor height. Publishing the world floor `y`
          // made dressing place balcony clutter at 2*floorY (props and rugs
          // floating in mid-air above the street).
          info.balconies.push({ side, x: bx, y: balY, w: bal.w, d: bal.d, pm });
        });
        break;
      }
      case 'ragged': {
        const o = { x: bx, y: h * 0.55, w: Math.min(bw - 0.4, 2.2), h: h * 0.8, ragged: 0.22, kind };
        openings.push(o);
        break;
      }
      default:
        break;
    }
  }

  // ---- the wall itself ----
  const isTop = f === floors - 1;
  facadeWall(A, pm, {
    w: len,
    h: h + (isTop ? 0.02 : 0),
    t,
    key: wallKey,
    openings,
    rng,
    top: spec.ruin && isTop && (side === streetSide || side === spec.ruinSide) ? 'ragged' : 'flat',
    raggedAmp: 0.55,
    jag: isTop && !spec.ruin ? 0.03 : 0,
    warp: 0.02,
    paint: (x, wy, z, nx, ny, nz, out) => {
      // extra grime toward the base of the ground floor and under the eaves
      const base = f === 0 ? Math.max(0, 1 - wy / 1.4) : 0;
      const n = fbm3(x * 0.7, wy * 0.7, z * 0.7, 2);
      out[1] = Math.min(1, out[1] + base * base * 0.55 * (0.5 + n));
      out[2] = Math.min(1, out[2] + base * base * 0.4);
    },
  });

  for (const fn of deco) fn();

  // ---- rain runoff below every opening and ledge --------------------------
  // The world knows where the water comes off: sills, shopfront heads, awning
  // bars and balcony slabs. A facade with no runs below its openings reads as
  // freshly painted, which is the one thing a street like this never is.
  //
  // Drawn from a stream keyed to this panel's identity rather than from `rng`, so
  // adding or tuning the weathering never re-rolls the level's layout.
  const wr = new Rng(
    (Math.round((spec.x + 512) * 977 + (spec.z + 512) * 7919) ^ (side * 131 + f * 1237)) >>> 0
  );
  for (const o of openings) {
    if (o.kind === 'ragged') continue;
    const sillY = o.y - o.h / 2;
    // Not every sill sheds the same amount, and a couple are bone dry.
    if (wr.float() < 0.22) continue;
    const run = Math.min(wr.range(0.7, 1.8), Math.max(0.25, sillY - 0.12));
    const g = runoffStreak(wr, o.w * wr.range(0.6, 1.0), run, {
      amount: wr.range(0.72, 1.0),
    });
    A.addOnce(wallKey, g, LL(pm, o.x + wr.range(-0.1, 0.1), sillY - 0.03, -0.012, 0, 1, 1, 1));
    // a second, narrower run off one corner of the sill: water finds a low spot
    if (wr.float() < 0.55) {
      const sgn = wr.float() < 0.5 ? -1 : 1;
      const run2 = Math.min(wr.range(0.5, 1.3), Math.max(0.2, sillY - 0.1));
      const g2 = runoffStreak(wr, wr.range(0.1, 0.22), run2, { amount: wr.range(0.8, 1.0), cols: 3 });
      A.addOnce(
        wallKey,
        g2,
        LL(pm, o.x + sgn * o.w * wr.range(0.32, 0.5), sillY - 0.02, -0.013, 0, 1, 1, 1)
      );
    }
  }
  // and one long run off the string course / cornice per open facade
  if (openFace && wr.float() < 0.8) {
    const g = runoffStreak(wr, wr.range(0.18, 0.4), wr.range(1.0, 1.8), {
      amount: wr.range(0.78, 1.0),
      cols: 4,
    });
    A.addOnce(
      wallKey,
      g,
      LL(pm, wr.range(-len / 2 + 0.4, len / 2 - 0.4), h - 0.16, -0.012, 0, 1, 1, 1)
    );
  }

  // ---- string course between floors ----
  if (f < ctx.floors - 1 && (openFace || rng.float() < 0.5)) {
    A.add(
      spec.trimKey ?? 'concrete',
      BOX_SOFT(A),
      LL(pm, 0, h - 0.09, -0.055, 0, len + 0.06, 0.13, 0.12),
      { masks: [0.7, 0.45, 0.2] }
    );
  }
  // ---- top cornice ----
  if (f === ctx.floors - 1 && !spec.ruin) {
    A.add(
      spec.trimKey ?? 'concrete',
      BOX_SOFT(A),
      LL(pm, 0, h - 0.14, -0.11, 0, len + 0.14, 0.22, 0.2),
      { masks: [0.75, 0.5, 0.25] }
    );
  }

  // ---- damage: spalled render exposing brick, bullet-pocked plaster ----
  const dmg = spec.damage ?? 0.2;
  const spalls = Math.round(dmg * 5 * (openFace ? 1.4 : 0.7));
  for (let i = 0; i < spalls; i++) {
    const sx = rng.range(-len / 2 + 0.5, len / 2 - 0.5);
    const sy = rng.range(0.4, h - 0.5);
    const g = spallPatch(rng, rng.range(0.35, 1.0), rng.range(0.3, 0.8), 0.03);
    A.addOnce('brick_fine', g, LL(pm, sx, sy, 0.01, 0, 1, 1, 1));
  }
  // patched render — a slightly different mix where somebody repaired it. Kept
  // in the same value family as the wall, or it reads as a paper poster.
  if (openFace && rng.float() < 0.5) {
    const px = rng.range(-len / 2 + 1, len / 2 - 1);
    const py = rng.range(0.5, h - 1.2);
    const g = spallPatch(rng, rng.range(0.6, 1.4), rng.range(0.5, 1.1), 0.02);
    // Same value family as the wall: a bright white patch on cream render reads
    // as a sheet of paper stuck to the building.
    A.addOnce(PATCH_KEY[wallKey] ?? 'plaster_sand', g, LL(pm, px, py, 0.013, 0, 1, 1, 1));
  }

  // ---- bullet pocks, clustered where somebody took cover ----
  if (A.has('pock')) {
    const bursts = Math.round(dmg * 6) + (openFace ? 2 : 0);
    for (let i = 0; i < bursts; i++) {
      const cx = rng.range(-len / 2 + 0.4, len / 2 - 0.4);
      const cy = rng.range(0.5, Math.min(h - 0.4, 3.0));
      const n = rng.int(3, 9);
      for (let j = 0; j < n; j++) {
        const px = cx + rng.gauss() * 0.45;
        const py = cy + rng.gauss() * 0.32;
        if (Math.abs(px) > len / 2 - 0.15) continue;
        if (py < 0.15 || py > h - 0.15) continue;
        // skip pocks that would land inside an opening
        let inHole = false;
        for (const o of openings) {
          if (
            px > o.x - o.w / 2 - 0.05 &&
            px < o.x + o.w / 2 + 0.05 &&
            py > o.y - o.h / 2 - 0.05 &&
            py < o.y + o.h / 2 + 0.05
          ) {
            inHole = true;
            break;
          }
        }
        if (inHole) continue;
        // Just proud of the render. The pock is a raised-rim crater now, not a
        // solid cone, so burying the origin 4 mm inside the wall (which is what
        // hid the old cone's base) would sink the whole thing out of sight.
        const wp = worldOf(pm, px, py, 0.0015);
        const s = rng.range(0.55, 1.5);
        A.putS('pock', wp[0], wp[1], wp[2], SIDE[side].ry + Math.PI, s, s, rng.range(0.5, 1.2), [
          1,
          rng.range(0.7, 1.3),
          1,
        ]);
      }
    }
  }
}

// ================================================================= stairs ===
/**
 * How many treads a given climb takes. Shared so `resolveStairFlights` can know
 * how LONG a flight is before `stairGeometry` builds it, and the two cannot
 * drift apart.
 */
const stairSteps = (climb) => Math.max(6, Math.round(climb / 0.19));

/** Landing depth, as `buildInterior` builds it: a 1.1 m slab centred at D+0.55. */
const STAIR_LANDING = 1.1;

/**
 * ry = k * 90°, indexed 0..3, as (dx, dz). 0 = +Z, 1 = +X, 2 = -Z, 3 = -X, which
 * is the same numbering `stairGeometry` gets out of (sin ry, cos ry).
 */
const QUARTER = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/**
 * ────────────────────────────────────────────────────────────────────────────
 * WHERE EACH STOREY'S FLIGHT STANDS — "階段が全く同じ位置の縦軸が違うだけ"
 * ────────────────────────────────────────────────────────────────────────────
 * Every flight in layout.js was authored as a copy of the one below it. Measured
 * on the six multi-storey interiors, the plan distance between the foot of one
 * flight and the foot of the next was 0.00-0.10 m and the turn between them was
 * 0°: W1, W2, W3, E1, E2 and E3 all had a vertical tube in one corner with the
 * treads redrawn at three heights. It reads as a copy-paste because it is one,
 * and it plays as one too — the top of every flight is the bottom of the next,
 * so an interior has exactly one place worth holding on every floor and no
 * reason to walk across a storey you have arrived on.
 *
 * THE RULE: A FLIGHT TURNS AWAY FROM THE WALL IT RUNS AGAINST, AT EVERY LANDING.
 *
 * That is the whole derivation, and it is a real stair rather than a jitter. A
 * flight on this map is authored hard against one wall of the plan; the landing
 * at its head can only turn into the room, never into that wall, so the sense of
 * the turn is fixed by the ground flight and nothing else. Keep turning the same
 * way and the stair walks the four bays of the perimeter, one bay per storey,
 * and arrives back where it started on the fifth — which is a stair circulating
 * a plan, the ordinary thing a building with one core actually does.
 *
 * WHAT IS AUTHORED AND WHAT IS DERIVED. The GROUND flight stays authored: it is
 * the one that has to answer to the front door, the through-route and the room
 * plan, and layout.js places it against all three. Everything above it is this
 * function's, carried up in METRES — the gap to the wall it hugs and the
 * set-back of its bottom tread from the wall behind it are preserved exactly,
 * so a flight lands the same distance off the masonry in a 12.8 m bay as in a
 * 26.3 m one and a setback storey gets the same stair as a full one.
 *
 * WHY NOT A SWITCHBACK. A dog-leg is the other real answer and it was rejected
 * on arithmetic, not on a build: a half-turn back alongside the flight below
 * offsets it by one stair width plus a wall, about 1.4 m, against a complaint
 * that the flights are in the same place. The quarter-turn moves 9.4-21.9 m,
 * measured. If a future plan wants the tighter core, the switchback is `turn`
 * applied twice with the same `hug`, and it belongs here rather than in a table.
 *
 * WHAT THIS DOES NOT TOUCH. `NavGrid._carveInteriors` keeps the GROUND storey of
 * every footprint and nothing else — a bot cannot use a stair at all on a 2.5D
 * height field — so moving flights above the ground floor cannot move a single
 * nav cell. The ground flight is deliberately left exactly where it was for the
 * same reason.
 *
 * The result is written back onto `spec.stairFlights` because it is now the
 * truth about the building: `tools/floorcheck.mjs --climb` reads that table to
 * decide where to stand a player and drive him upstairs, and a table that no
 * longer describes the map is worse than no table.
 */
function resolveStairFlights(spec, info, t, floors) {
  const src = spec.stairFlights;
  if (!src?.length) return src ?? [];
  const list = src.slice().sort((a, b) => a.floor - b.floor);
  const first = list[0];
  if (first.x === undefined || first.z === undefined) return src;

  // ---- the authored flight, read back as (climb dir, hug wall, start, hug) --
  const fs0 = floorSpec(spec, first.floor);
  const iw0 = fs0.w - t * 2, id0 = fs0.d - t * 2;
  const ox0 = fs0.x - iw0 / 2 + first.x * iw0;
  const oz0 = fs0.z - id0 / 2 + first.z * id0;
  let k = (((Math.round((first.ry ?? 0) / (Math.PI / 2)) % 4) + 4) % 4);
  const alongZ0 = k % 2 === 0;
  const Lk0 = alongZ0 ? id0 : iw0;
  const Lm0 = alongZ0 ? iw0 : id0;
  const cen0 = alongZ0 ? fs0.z : fs0.x;         // plan centre, climb axis
  const ccen0 = alongZ0 ? fs0.x : fs0.z;        // plan centre, cross axis
  const c0 = alongZ0 ? oz0 : ox0;
  const cc0 = alongZ0 ? ox0 : oz0;
  const sk0 = alongZ0 ? QUARTER[k][1] : QUARTER[k][0];
  /** Bottom tread's set-back from the wall BEHIND it, in metres. */
  const start = sk0 > 0 ? c0 - (cen0 - Lk0 / 2) : (cen0 + Lk0 / 2) - c0;
  const dLow = cc0 - (ccen0 - Lm0 / 2);
  const dHigh = (ccen0 + Lm0 / 2) - cc0;
  /** Gap from the flight's centreline to the wall it hugs, in metres. */
  const hug = Math.min(dLow, dHigh);
  /** The quarter-turn index that POINTS AT that wall. */
  let m = alongZ0 ? (dLow < dHigh ? 3 : 1) : (dLow < dHigh ? 2 : 0);
  /** Wall on the right -> the landing can only turn left, and vice versa. */
  const turn = m === (k + 1) % 4 ? -1 : 1;

  const out = [{ ...first }];
  let prev = out[0];
  for (let i = 1; i < list.length; i++) {
    const fl = list[i];
    const f = fl.floor;
    if (f < 0 || f >= floors) { out.push({ ...fl }); continue; }
    const fs = floorSpec(spec, f);
    const iw = fs.w - t * 2, id = fs.d - t * 2;
    const base = info.floorY[f] + (f === 0 ? 0.13 : 0);
    const climb = (info.floorY[f + 1] ?? info.roofY) - base;
    const run = fl.run ?? first.run ?? 0.275;
    const sw = fl.w ?? first.w ?? 1.2;
    const len = stairSteps(climb) * run + STAIR_LANDING;

    const nk = (k + turn + 4) % 4;
    const nm = (m + turn + 4) % 4;
    const alongZ = nk % 2 === 0;
    const Lk = alongZ ? id : iw;
    const Lm = alongZ ? iw : id;
    const half = sw / 2 + 0.3;
    /**
     * A TURN THAT DOES NOT FIT IS NOT A TURN. A flight plus its landing is
     * 5.5-5.8 m; a bay shorter than that has nowhere to put one, and a stacked
     * flight is far better than a flight that walks out through a wall. Nothing
     * on this map hits either of these — the shortest bay any flight turns into
     * is 12.8 m — but the level is scalable and this is the one failure that
     * would be silent.
     */
    const room = Lk - len - 0.3;
    if (room < 0.35 || Lm < half * 2) { out.push({ ...fl, x: prev.x, z: prev.z, ry: prev.ry }); continue; }
    const startC = Math.min(Math.max(start, 0.35), room);
    const hugC = Math.min(Math.max(hug, half), Lm - half);

    const sk = alongZ ? QUARTER[nk][1] : QUARTER[nk][0];
    const sm = alongZ ? QUARTER[nm][0] : QUARTER[nm][1];
    const along = (alongZ ? fs.z : fs.x) + sk * (startC - Lk / 2);
    const cross = (alongZ ? fs.x : fs.z) + sm * (Lm / 2 - hugC);
    const ox = alongZ ? cross : along;
    const oz = alongZ ? along : cross;

    k = nk; m = nm;
    prev = {
      ...fl,
      x: (ox - (fs.x - iw / 2)) / iw,
      z: (oz - (fs.z - id / 2)) / id,
      ry: (nk * Math.PI) / 2,
    };
    out.push(prev);
  }
  return out;
}

/**
 * One authored flight, resolved. LEVEL SPACE throughout.
 *
 * This is the single place that knows how a flight is laid out, and both the
 * builder and the void it needs cut above it read it — so the tread the player
 * stands on and the hole over his head cannot disagree, which is exactly how
 * E2's first floor came to be sealed off behind a stairwell that measured
 * correct.
 *
 * `ry` is supported for completeness but every authored flight is axis-aligned;
 * the void is an AABB, so a diagonal flight gets a conservative (larger) one.
 */
function stairGeometry(spec, info, fl, t, groundH, upperH, floors) {
  const f = fl.floor;
  if (f < 0 || f >= floors) return null;
  const fs = floorSpec(spec, f);
  const iw = fs.w - t * 2;
  const id = fs.d - t * 2;
  const base = info.floorY[f] + (f === 0 ? 0.13 : 0);
  const climb = (info.floorY[f + 1] ?? info.roofY) - base;
  if (climb <= 0.5) return null;
  const steps = stairSteps(climb);
  const rise = climb / steps;
  const run = fl.run ?? 0.275;
  const sw = fl.w ?? 1.2;
  const ry = fl.ry ?? 0;
  const ox = fs.x - iw / 2 + fl.x * iw;
  const oz = fs.z - id / 2 + fl.z * id;
  const D = steps * run;
  /** Landing depth, as built below: a 1.1 m slab centred at D + 0.55. */
  const landing = STAIR_LANDING;
  const ax = Math.sin(ry), az = Math.cos(ry); // the climb direction
  /**
   * THE VOID STARTS WHERE THE HEAD CLEARANCE DOES, NOT AT THE BOTTOM TREAD.
   *
   * Cutting the whole flight out of the slab above is the obvious thing and it
   * is wrong, for a reason that only shows up once a building has TWO flights.
   * `floorcheck` measured it: W1, W3, E1 and E2 all stacked their upper flight
   * directly over the lower one, so with a full-length void the upper flight's
   * bottom step stood over five metres of open stairwell — no floor to walk to
   * it across, and the storey above was sealed. E1's second floor and the roofs
   * of four buildings were unreachable for exactly this.
   *
   * NOTHING STACKS ANY MORE (@see `resolveStairFlights`) and the soffit still
   * has to be here. It was never only about the flight above: it is the head of
   * the flight BELOW, and without it the last three treads of every staircase on
   * the map come up through a hole in a floor with no ceiling over them, which
   * is a hatch, not a stairwell.
   *
   * A real stairwell has a soffit: the slab covers the lower treads and opens
   * where a climber's head would otherwise hit it. That is `nextY - thick -
   * H - margin`, solved for the tread that first exceeds it. The floor above
   * therefore stays SOLID over the foot of the flight, which is the ground the
   * next flight up has to stand on.
   */
  const nextY = info.floorY[f + 1] ?? info.roofY;
  const slabT = f + 1 >= floors ? 0.26 : 0.2;   // interiorSlab's roof/floor thickness
  const headroom = nextY - slabT - 1.78 - 0.06;
  let firstOpen = 0;
  while (firstOpen < steps && base + (firstOpen + 1) * rise <= headroom) firstOpen++;
  /**
   * …pulled back by a capsule radius, a tread and a hand's breadth.
   *
   * A PLAYER IS NOT A POINT. Cutting the soffit at the first tread whose top
   * exceeds the headroom leaves the climber's shoulders under the slab while
   * his feet are past it, and `floorcheck --climb` measured exactly that: the
   * real controller stopped dead 1.98 m short on eight of fourteen flights
   * while the capsule flood — which samples one column at a time — walked
   * straight past it. The flood said yes and the player said no, which is the
   * whole reason the driven climb is part of this gate.
   */
  const openAt = Math.max(0, firstOpen * run - (sw / 2 + run + 0.32));
  /** …and 0.22 m of side clearance for the railing and the capsule's shoulder. */
  const sideR = sw / 2 + 0.22;
  const fwd = D + landing;
  const cx = [ox + ax * openAt, ox + ax * fwd];
  const cz = [oz + az * openAt, oz + az * fwd];
  const px = Math.abs(az) * sideR + Math.abs(ax) * 0.0;
  const pz = Math.abs(ax) * sideR + Math.abs(az) * 0.0;
  return {
    floor: f, ox, oz, ry, sw, run, rise, steps, base, climb,
    top: base + climb, D, landing,
    /**
     * Where the soffit ends and the shaft begins, along the climb axis. The
     * void rectangle below is the same thing in level coordinates; this is the
     * scalar, published because the FURNISHING of the floor above needs it —
     * everything from here to the head of the flight is a hole, and a wardrobe
     * standing in a hole is over a climber's head. @see `buildInterior`.
     */
    open: openAt,
    void: {
      x0: Math.min(cx[0], cx[1]) - px - Math.abs(ax) * 0,
      x1: Math.max(cx[0], cx[1]) + px,
      z0: Math.min(cz[0], cz[1]) - pz,
      z1: Math.max(cz[0], cz[1]) + pz,
    },
  };
}

// ================================================================= slabs ====
/** Floor slab for one level, with the stairwell void left open. */
function interiorSlab(A, rng, spec, y, t, hole = null, roof = false) {
  const iw = spec.w - t * 2;
  const id = spec.d - t * 2;
  const key = roof ? 'roof_screed' : 'floor_concrete';
  const thick = roof ? 0.26 : 0.2;
  if (!hole) {
    A.add(key, BOX(A), LL(IDENT, spec.x, y - thick / 2, spec.z, 0, iw, thick, id), {
      masks: roof ? [0.45, 0.25, 0.12] : [0.3, 0.55, 0.35],
    });
    A.box('concrete', spec.x, y - thick / 2, spec.z, iw, thick, id);
  } else {
    // picture-frame decomposition around the void
    const x0 = spec.x - iw / 2;
    const x1 = spec.x + iw / 2;
    const z0 = spec.z - id / 2;
    const z1 = spec.z + id / 2;
    /**
     * CLAMPED to the slab. A derived void runs the length of the flight and a
     * flight tucked against a wall (every one on this map is) pokes out past
     * the slab edge — and an unclamped hz0 < z0 makes the first picture-frame
     * part negative-depth, which the loop below silently drops. That is a
     * missing STRIP of floor, not a missing hole, and it is the kind of thing
     * that only shows up as a player falling through a corner.
     */
    const hx0 = Math.max(x0, Math.min(x1, hole.x0));
    const hx1 = Math.max(x0, Math.min(x1, hole.x1));
    const hz0 = Math.max(z0, Math.min(z1, hole.z0));
    const hz1 = Math.max(z0, Math.min(z1, hole.z1));
    const parts = [
      [x0, z0, x1, hz0],
      [x0, hz1, x1, z1],
      [x0, hz0, hx0, hz1],
      [hx1, hz0, x1, hz1],
    ];
    for (const [ax, az, bx, bz] of parts) {
      const w = bx - ax;
      const d = bz - az;
      if (w < 0.05 || d < 0.05) continue;
      A.add(key, BOX(A), LL(IDENT, (ax + bx) / 2, y - thick / 2, (az + bz) / 2, 0, w, thick, d), {
        masks: roof ? [0.45, 0.25, 0.12] : [0.3, 0.55, 0.35],
      });
      A.box('concrete', (ax + bx) / 2, y - thick / 2, (az + bz) / 2, w, thick, d);
    }
  }
  // exposed ceiling beams / joists under the slab, seen from inside
  if (!roof && spec.enterable) {
    const n = Math.max(2, Math.round(id / 1.5));
    for (let i = 0; i < n; i++) {
      const bz = spec.z - id / 2 + ((i + 0.5) / n) * id;
      A.add('wood_dark', BOX(A), LL(IDENT, spec.x, y - thick - 0.08, bz, 0, iw, 0.16, 0.13), {
        masks: [0.4, 0.6, 0.5],
      });
    }
  }
}

// ============================================================= interiors ====
function buildInterior(A, rng, spec, info, t, groundH, upperH, floors) {
  const it = 0.16; // partition thickness
  const g0 = floorSpec(spec, 0);

  /**
   * KEEP THE DOORWAYS CLEAR.
   *
   * A door is only a way in if the first stride past it is walkable, and two
   * things were standing in it. The inward normal of each face, used by both:
   * side 0 is the -Z wall, so inward is +Z, and so on round.
   */
  const IN = [[0, 1], [-1, 0], [0, -1], [1, 0]];
  /** Circles just inside each door that collision-bearing clutter must avoid. */
  const doorSpots = info.doors.map((dr) => {
    const [nx, nz] = IN[dr.side];
    return { x: dr.wp[0] + nx * 1.0, z: dr.wp[2] + nz * 1.0, r: 1.15 };
  });

  /**
   * KEEP THE STAIRS CLEAR — on EVERY floor.
   *
   * The same argument as the doorways, and the same failure. `furnishRoom` has
   * never known where a staircase is, and above the ground floor it was handed
   * no keep-clear set at all (`doorways: f === 0 ? doorSpots : null`). The
   * result was measured by `tools/floorcheck.mjs`: E2's only flight had a
   * storage room's crate stacks rolled onto its bottom step, so the whole
   * building above the ground floor — two storeys and a roof — was sealed. The
   * other seven were passing on nothing but where the dice fell.
   *
   * A flight is a strip, not a point, so it is covered with a chain of circles
   * every 0.5 m: the approach behind the bottom tread, the run itself, and — on
   * the floor it ARRIVES at — the landing and the void, because a wardrobe at
   * the top of a staircase is exactly as good as a locked door.
   */
  const floorClear = [];
  for (let f = 0; f < floors; f++) floorClear.push(f === 0 ? doorSpots.slice() : []);
  /**
   * …AND KEEP THE CACHES CLEAR. `src/world/features.js` authors one loot cache
   * per floor of every enterable building, and a shelf dropped on top of one is
   * the same failure as a shelf dropped on a stair: the thing the player came up
   * here for is inside a wardrobe. The spots are pure geometry off this same
   * spec, so the furnishing pass and the cache cannot disagree about where they
   * are. See `featureSpots`.
   */
  for (const k of featureKeepClear(spec, info, t)) {
    if (floorClear[k.floor]) floorClear[k.floor].push({ x: k.x, z: k.z, r: k.r });
  }
  const chain = (list, ax, az, bx, bz, r) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
    for (let i = 0; i <= n; i++) {
      list.push({ x: ax + ((bx - ax) * i) / n, z: az + ((bz - az) * i) / n, r });
    }
  };
  for (const g of info.stairs ?? []) {
    const ax = Math.sin(g.ry), az = Math.cos(g.ry);
    const r = g.sw / 2 + 0.5;
    // the floor the flight LEAVES: the approach and the first third of the run
    // (past that the treads are already above furniture height)
    if (floorClear[g.floor]) {
      // THE WHOLE RUN, not the first third of it. The first attempt stopped at
      // 35 % on the theory that past there the treads are above furniture
      // height — which is true of the treads and false of the man standing on
      // them. `floorcheck --climb` found W1's upper flight stopped dead 1.26 m
      // up, at a wardrobe standing beside tread six. The staircase occupies
      // that floor area; nothing else belongs in it.
      chain(floorClear[g.floor], g.ox - ax * 1.5, g.oz - az * 1.5,
        g.ox + ax * (g.D + 0.3), g.oz + az * (g.D + 0.3), r);
    }
    /**
     * The floor it ARRIVES at: THE WHOLE SHAFT, then the landing, then the
     * walk-off in front of it.
     *
     * This used to start at `D - 0.6`, three quarters of the way up the flight,
     * on the reading that what has to be kept clear upstairs is the landing. It
     * is not: from `g.open` forward there is NO FLOOR — that is where the soffit
     * ends and the slab is cut (@see `stairGeometry`) — and the furnishing pass
     * was free to drop a shelf unit or a crate stack anywhere in the first three
     * quarters of it. The prop then hangs in mid-air over the stairwell with its
     * collision box across the shaft, and `floorcheck` reports it from BELOW, as
     * a flight with no headroom and no standing room on its top treads. Measured
     * on the 14 pinned seeds: E1-f0 on seed 10 and W1-f1 on seed 2 were both a
     * prop on the floor above, sitting over the hole, over a climber's head.
     */
    const up = floorClear[g.floor + 1];
    if (up) {
      chain(up, g.ox + ax * g.open, g.oz + az * g.open,
        g.ox + ax * (g.D + g.landing + 1.4), g.oz + az * (g.D + g.landing + 1.4), r);
    }
  }

  /**
   * THE THROUGH-ROUTE.
   *
   * An interior on this map is a ROUTE, not a room: every enterable building has
   * at least two ways out, and the point of going inside is to come out
   * somewhere else. That only works if the line between two openings is
   * actually walkable, and it was not — `tools/throughcheck.mjs` measured the
   * real player capsule over the ground floor of all eight and found nine
   * openings that led nowhere: W1 and W2 had BOTH their doors opening into
   * furniture pockets, and K1 — a 5.4 m shed with a door on each end — was
   * sealed across the middle by its own shop counter.
   *
   * Nothing about that was authored; it was where the furnishing dice landed.
   * So the route stops being an emergent property and becomes a declared one:
   * `spec.route` is a list of polylines through the ground floor, given in the
   * same normalised interior coordinates as the room plans, with the openings
   * named ('s1' = the door on side 1, 'w3' = the vault window on side 3) so the
   * ends stay attached to the real geometry wherever the builder cut it.
   *
   * Two things then use it, and between them they are what makes the route real:
   *   - a partition the route crosses gets its doorway AT THE CROSSING, instead
   *     of wherever `doorAt` put it;
   *   - nothing that carries a collision proxy may stand within `ROUTE_R` of it
   *     (see `interiors.js`) — the shop counter is slid and shortened, the crate
   *     stacks and the wardrobe are moved or dropped.
   * Everything with no proxy — litter, stains, shelves, wall dressing — is
   * untouched, so the corridor is clear to walk and is not visibly empty.
   */
  const g0iw = g0.w - t * 2;
  const g0id = g0.d - t * 2;
  const g0x0 = g0.x - g0iw / 2;
  const g0z0 = g0.z - g0id / 2;
  const openingAt = (tag) => {
    const side = +tag.slice(1);
    if (tag[0] === 's') {
      const dr = info.doors.find((d) => d.side === side);
      return dr ? { x: dr.wp[0], z: dr.wp[2] } : null;
    }
    /**
     * THE AUTHORED WINDOW, not whichever one the dice opened first.
     *
     * E3's side-1 face has three glassless openings on the ground floor and
     * only ONE of them — bay 4, declared in `spec.bayKinds` — is the vault-in
     * this map's route is drawn to. Taking the first `state === 'open'` window
     * in bay order meant the corridor's anchor moved whenever the window dice
     * moved, and `vaultcheck` caught the authored window walled in behind a
     * shop counter while the route ran to an incidental one nine metres away.
     * Resolve the bay the same way `buildFacade` derived it, and prefer the bay
     * that was actually authored.
     */
    const cands = (info.windows ?? []).filter(
      (o) => o.f === 0 && o.side === side && o.state === 'open'
    );
    if (!cands.length) return null;
    const bayOf = (o) => {
      const len = o.side === 0 || o.side === 2 ? spec.w : spec.d;
      const bays = Math.max(1, Math.round(len / 3.05));
      return Math.round((o.x + len / 2) / (len / bays) - 0.5);
    };
    const win = cands.find((o) => spec.bayKinds?.[side]?.[0]?.[bayOf(o)]) ?? cands[0];
    const p = worldOf(win.pm, win.x, 0, 0);
    return { x: p[0], z: p[2] };
  };
  const routes = [];
  for (const leg of spec.route ?? []) {
    const pts = [];
    for (const p of leg) {
      if (typeof p === 'string') {
        const q = openingAt(p);
        if (q) pts.push(q);
        else console.warn(`[world] ${spec.id}: route references missing opening "${p}"`);
      } else {
        pts.push({ x: g0x0 + p[0] * g0iw, z: g0z0 + p[1] * g0id });
      }
    }
    if (pts.length >= 2) routes.push(pts);
  }

  /**
   * Where along a wall (as fractions of its length) the route crosses it.
   * Plain segment/segment intersection; a route that runs ALONG a wall rather
   * than through it produces no crossing, which is correct — a corridor beside
   * a partition does not need a hole in it.
   */
  const routeCrossings = (ax, az, bx, bz) => {
    const out = [];
    const rx = bx - ax;
    const rz = bz - az;
    for (const line of routes) {
      for (let i = 1; i < line.length; i++) {
        const cx = line[i - 1].x;
        const cz = line[i - 1].z;
        const sx = line[i].x - cx;
        const sz = line[i].z - cz;
        const den = rx * sz - rz * sx;
        if (Math.abs(den) < 1e-6) continue;
        const tt = ((cx - ax) * sz - (cz - az) * sx) / den;
        const uu = ((cx - ax) * rz - (cz - az) * rx) / den;
        if (tt < 0 || tt > 1 || uu < 0 || uu > 1) continue;
        out.push(tt);
      }
    }
    return out.sort((p, q) => p - q);
  };

  /**
   * Pull a partition back if it runs into an exterior doorway.
   *
   * W1's plan puts a wall at z-fraction 0.5 running out to x-fraction 1.0, and
   * the side-1 door is bay 1 of a three-bay face — dead centre, z-fraction 0.5.
   * The partition therefore ended exactly in the middle of its own front door
   * and split the 1.12 m opening into two 0.48 m slots, neither of which passes
   * a 0.64 m capsule. E1 had the same collision. Trimming is done here rather
   * than by hand in layout.js so a future room plan cannot reintroduce it.
   */
  const clearOfDoors = (ax, az, bx, bz) => {
    const CLEAR = 1.35; // door half-width, plus a capsule, plus the reveal
    let x0 = ax, z0 = az, x1 = bx, z1 = bz;
    for (const dr of info.doors) {
      const vx = x1 - x0, vz = z1 - z0;
      const len = Math.hypot(vx, vz);
      if (len < 0.4) break;
      const ux = vx / len, uz = vz / len;
      // perpendicular distance from the door to this wall's line
      if (Math.abs((dr.wp[0] - x0) * uz - (dr.wp[2] - z0) * ux) > 0.6) continue;
      const along = (dr.wp[0] - x0) * ux + (dr.wp[2] - z0) * uz;
      if (along < len / 2) {
        const cut = along + CLEAR; // door is off the near end
        if (cut > 0) { x0 += ux * cut; z0 += uz * cut; }
      } else {
        const cut = along - CLEAR; // door is off the far end
        if (cut < len) { x1 = x0 + ux * cut; z1 = z0 + uz * cut; }
      }
    }
    return [x0, z0, x1, z1];
  };

  /**
   * …and the same for a partition run across a stairwell.
   *
   * No plan in layout.js does this today, but every one of them was written
   * against a hand-authored `stairHoles` table and none of them will survive
   * the level being rescaled or a flight being moved. A wall across the head of
   * a staircase is a sealed floor, which is the defect this whole pass exists
   * to remove, so it is made structurally impossible here rather than left to
   * be re-checked by hand. Same trim-back-from-the-nearer-end rule as the doors.
   */
  const clearOfStairs = (f, ax, az, bx, bz) => {
    let x0 = ax, z0 = az, x1 = bx, z1 = bz;
    for (const g of info.stairs ?? []) {
      // the void belongs to the floor the flight arrives at AND the one it
      // leaves — you have to be able to walk onto the bottom step too
      if (g.floor !== f && g.floor + 1 !== f) continue;
      const v = g.void;
      const cx = (v.x0 + v.x1) / 2, cz = (v.z0 + v.z1) / 2;
      const half = Math.max(v.x1 - v.x0, v.z1 - v.z0) / 2;
      const vx = x1 - x0, vz = z1 - z0;
      const len = Math.hypot(vx, vz);
      if (len < 0.4) break;
      const ux = vx / len, uz = vz / len;
      if (Math.abs((cx - x0) * uz - (cz - z0) * ux) > half) continue;
      const along = (cx - x0) * ux + (cz - z0) * uz;
      if (along < -half || along > len + half) continue;
      const CLEAR = half + 0.6;
      if (along < len / 2) {
        const cut = along + CLEAR;
        if (cut > 0) { x0 += ux * cut; z0 += uz * cut; }
      } else {
        const cut = along - CLEAR;
        if (cut < len) { x1 = x0 + ux * cut; z1 = z0 + uz * cut; }
      }
    }
    return [x0, z0, x1, z1];
  };

  // Ground slab, a step up from the street. It runs the FULL footprint (and the
  // 0.07 the base course stands proud) rather than stopping two wall-thicknesses
  // short: the old inset left a 0.5 m ring with no floor between the slab edge
  // and the wall, which the plinth plug used to hide. With the course notched at
  // the doors that ring is the threshold you walk over, so it has to be floored.
  A.add('floor_concrete', BOX(A), LL(IDENT, g0.x, 0.06, g0.z, 0, g0.w + 0.14, 0.14, g0.d + 0.14), {
    masks: [0.3, 0.6, 0.4],
  });
  A.box('concrete', g0.x, 0.06, g0.z, g0.w + 0.14, 0.16, g0.d + 0.14);

  const rooms = spec.rooms ?? [];
  for (let f = 0; f < floors; f++) {
    // Room plans are normalised, so they follow a setback automatically.
    const fs = floorSpec(spec, f);
    const iw = fs.w - t * 2;
    const id = fs.d - t * 2;
    const x0 = fs.x - iw / 2;
    const z0 = fs.z - id / 2;
    const fy = info.floorY[f] + (f === 0 ? 0.13 : 0.0);
    const fh = f === 0 ? groundH - 0.13 : upperH;
    // partitions for this floor
    const plan = rooms[f] ?? rooms[rooms.length - 1] ?? null;
    if (plan) {
      for (const wall of plan.walls) {
        const [ax, az, bx, bz, doorAt] = wall;
        // Only the ground floor meets the exterior doors; upper floors are free.
        const raw =
          f === 0
            ? clearOfDoors(x0 + ax * iw, z0 + az * id, x0 + bx * iw, z0 + bz * id)
            : [x0 + ax * iw, z0 + az * id, x0 + bx * iw, z0 + bz * id];
        const [wx0, wz0, wx1, wz1] = clearOfStairs(f, raw[0], raw[1], raw[2], raw[3]);
        const len = Math.hypot(wx1 - wx0, wz1 - wz0);
        if (len < 0.5) continue; // trimmed away to nothing
        /**
         * The route wins over `doorAt`. A partition the corridor crosses gets
         * its opening at the crossing; one the corridor misses keeps the
         * authored door, because that door is cover to fight over and moving it
         * for no reason would change the plan. A stub too short to take a
         * 1.05 m opening AND be crossed is dropped: half a wall in the middle
         * of a doorway is worse than no wall.
         */
        const HOLE_W = 1.05;
        const holes = [];
        const cross = f === 0 ? routeCrossings(wx0, wz0, wx1, wz1) : [];
        if (cross.length && len < HOLE_W + 0.5) continue;
        for (const tc of cross) {
          const at = Math.min(Math.max(tc * len, HOLE_W / 2 + 0.2), len - HOLE_W / 2 - 0.2);
          const hx = -len / 2 + at;
          if (holes.some((h) => Math.abs(h.x - hx) < HOLE_W)) continue;
          holes.push({ x: hx, y: 1.06, w: HOLE_W, h: 2.12 });
        }
        if (!holes.length && doorAt !== undefined && doorAt !== null) {
          holes.push({ x: -len / 2 + doorAt * len, y: 1.06, w: HOLE_W, h: 2.12 });
        }
        const ry = Math.atan2(wx1 - wx0, wz1 - wz0) - Math.PI / 2;
        _e.set(0, ry, 0);
        _q.setFromEuler(_e);
        _p.set((wx0 + wx1) / 2 - Math.sin(ry) * (it / 2), fy, (wz0 + wz1) / 2 - Math.cos(ry) * (it / 2));
        _s.set(1, 1, 1);
        const pm = new THREE.Matrix4().compose(_p, _q, _s);
        facadeWall(A, pm, {
          w: len,
          h: fh,
          t: it,
          key: 'plaster_white',
          openings: holes,
          rng,
          warp: 0.012,
          bevel: 0.012,
          paint: (px, py, pz, nx, ny, nz, out) => {
            const base = Math.max(0, 1 - py / 1.1);
            out[1] = Math.min(1, out[1] + base * base * 0.5);
            out[2] = Math.min(1, out[2] + base * base * 0.35);
          },
        });
        for (const hole of holes) {
          doorUnit(A, pm, hole, rng, { t: it, leaf: rng.float() < 0.4, open: 1.4, leafKey: 'wood_dark' });
        }
      }
    }

    // ---- stairs rising out of this floor ----
    for (const g of info.stairs) {
      if (g.floor !== f) continue;
      _e.set(0, g.ry, 0);
      _q.setFromEuler(_e);
      _p.set(g.ox, g.base, g.oz);
      _s.set(1, 1, 1);
      const pm = new THREE.Matrix4().compose(_p, _q, _s);
      stairRun(A, pm, 0, 0, 0, g.sw, g.steps, g.rise, g.run, {
        key: 'concrete_dark',
        railing: spec.stairFlights.find((fl) => fl.floor === f)?.railing ?? 'right',
      });
      const D = g.D;
      const H = g.steps * g.rise;
      A.add('concrete_dark', BOX(A), LL(pm, 0, H - 0.1, D + 0.55, 0, g.sw + 0.1, 0.2, 1.1), {
        masks: [0.4, 0.5, 0.3],
      });
      const wp = worldOf(pm, 0, H - 0.1, D + 0.55);
      A.box('concrete', wp[0], wp[1], wp[2], g.sw + 0.1, 0.2, 1.1, g.ry);
    }

    // furnishing
    if (plan?.furnish) {
      for (const r of plan.furnish) {
        furnishRoom(A, rng, {
          kind: r.kind,
          // so furnishing never stacks a shelf across a shopfront opening
          street: spec.streetSide,
          x0: x0 + r.x0 * iw,
          z0: z0 + r.z0 * id,
          x1: x0 + r.x1 * iw,
          z1: z0 + r.z1 * id,
          y: fy,
          h: fh,
          spec,
          // Ground-floor clutter carries a collision proxy, so a crate stack or
          // an oil drum rolled in front of a door is a locked door. E3's side-3
          // and K2's side-2 openings were both blocked down to a 0.3 m slot.
          // THE STAIR IS ON THAT LIST NOW, on every floor. `floorclear[f]`
          // covers the foot of every flight leaving this floor and the head of
          // every flight arriving on it — measured, E2's ground floor had a
          // storage room's crate stacks dropped straight onto its only
          // staircase, and floorcheck's flood could not get to E2's first or
          // second storey at all. Nothing above the ground floor used to get
          // any keep-clear whatsoever, which is why every upper floor on the
          // map was one dice roll away from the same thing.
          doorways: floorClear[f] ?? null,
          // …and the same is true of the whole corridor between two openings,
          // not just the first metre of it. See the route note above.
          route: f === 0 && routes.length ? routes : null,
        });
      }
    }
  }

  /**
   * ROOF ACCESS — the stairhead, built OVER the hole the stair comes up through.
   *
   * What was here before was a 2.4 x 2.6 m box parked 3.6 m in +Z of the top
   * flight's foot and a doorway cut in its +Z wall. It was scenery. No flight
   * ever ran to the roof and no hole was ever cut in the roof slab, so the one
   * building on the map that declared `roofAccess` had a shed on its roof with
   * a solid floor under it: floorcheck's first run reached 0 of 8 roofs.
   *
   * It is now sized and placed off `info.roofHole`, which is derived from the
   * flight itself, so the shed is around the stairwell by construction. A flight
   * plus its landing is 5-6 m long, which is a long stairhead — that is what a
   * flat-roofed block with an internal stair actually has, and the extra mass
   * and its cast shadow are worth more on the skyline than the old cube was.
   */
  if (spec.roofAccess && info.roofHole) {
    const hv = info.roofHole;
    const y = info.roofY;
    const px = (hv.x0 + hv.x1) / 2;
    const pz = (hv.z0 + hv.z1) / 2;
    const pw = hv.x1 - hv.x0 + 1.0;
    const pd = hv.z1 - hv.z0 + 1.0;
    /**
     * The wall the player walks OUT of: the end the flight climbs toward, taken
     * from `info.roofExit` so the doorway and the roof clutter's keep-out cannot
     * end up on opposite sides of the shed.
     */
    const [rex, rez] = info.roofExit ?? [0, 1];
    const exitSide = rex > 0 ? 1 : rex < 0 ? 3 : rez < 0 ? 0 : 2;
    for (let side = 0; side < 4; side++) {
      const pm = panelMatrix({ x: px, z: pz, w: pw, d: pd }, side, y).clone();
      const len = side === 0 || side === 2 ? pw : pd;
      const holes = side === exitSide
        ? [{ x: 0, y: 1.12, w: 1.15, h: 2.24 }]
        // a slot window on the long flanks so the stairhead is not a blind box
        : len > 3.2 ? [{ x: len * 0.28, y: 1.7, w: 0.8, h: 0.9 }] : [];
      facadeWall(A, pm, {
        w: len,
        h: 2.6,
        t: 0.22,
        key: spec.wallKey ?? 'plaster_cream',
        openings: holes,
        rng,
        warp: 0.015,
      });
    }
    /**
     * THE STAIRHEAD'S LID HAS A HOLE IN IT, AND THAT IS THE ANSWER TO
     * "階段も上がれるけど天井が塞がっているように見えます".
     *
     * `floorcheck` now walks every flight tread by tread and reports 2.6-2.85 m
     * of air over every single one, so the stairwell is not sealed and never was.
     * What IS sealed is what you see: the void runs up through the roof slab into
     * the stairhead, and the stairhead had a solid concrete lid 2.7 m over the
     * roof. Standing on the first floor looking up the stairwell — which is
     * exactly what a player does before he decides whether to climb — the last
     * thing at the top of the shaft was a ceiling. No daylight, so no route.
     *
     * A light well changes what the shaft looks like from the bottom without
     * changing a single thing about how it plays: the lid becomes a frame around
     * a 1.0 x 1.3 m opening, offset toward the door so the sky is in the same
     * direction as the way out, with a raised kerb and a sheet of corrugated iron
     * lying half over it, weighted down — which is how a real one on a flat roof
     * is covered.
     */
    const holeW = Math.min(1.0, pw * 0.42);
    const holeD = Math.min(1.3, pd * 0.34);
    const OUT4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const [ex, ez] = OUT4[exitSide];
    const hx = px + ex * (pw / 2 - holeW / 2 - 0.55);
    const hz = pz + ez * (pd / 2 - holeD / 2 - 0.55);
    const LID = y + 2.7;
    const lidW = pw + 0.3, lidD = pd + 0.3;
    const parts = [
      [px - lidW / 2, pz - lidD / 2, px + lidW / 2, hz - holeD / 2],
      [px - lidW / 2, hz + holeD / 2, px + lidW / 2, pz + lidD / 2],
      [px - lidW / 2, hz - holeD / 2, hx - holeW / 2, hz + holeD / 2],
      [hx + holeW / 2, hz - holeD / 2, px + lidW / 2, hz + holeD / 2],
    ];
    for (const [ax, az, bx, bz] of parts) {
      const w = bx - ax, d = bz - az;
      if (w < 0.05 || d < 0.05) continue;
      A.add('concrete', BOX(A), LL(IDENT, (ax + bx) / 2, LID, (az + bz) / 2, 0, w, 0.2, d), {
        masks: [0.5, 0.45, 0.2],
      });
      A.box('concrete', (ax + bx) / 2, LID, (az + bz) / 2, w, 0.2, d);
    }
    // the kerb round the opening, so the hole has a lip rather than a cut edge
    for (const [ox, oz, kw, kd] of [
      [0, -holeD / 2 - 0.06, holeW + 0.24, 0.12],
      [0, holeD / 2 + 0.06, holeW + 0.24, 0.12],
      [-holeW / 2 - 0.06, 0, 0.12, holeD + 0.24],
      [holeW / 2 + 0.06, 0, 0.12, holeD + 0.24],
    ]) {
      A.add('concrete', BOX_SOFT(A), LL(IDENT, hx + ox, LID + 0.16, hz + oz, 0, kw, 0.14, kd), {
        masks: [0.8, 0.4, 0.15],
      });
    }
    // a sheet of corrugated iron lying over part of it, with a block on it
    /**
     * The tilt and the yaw are derived from the position, NOT drawn from `rng`.
     * `buildBuilding` shares the level's one stream with every prop, stain and
     * pock placed after it, so three draws here would move the whole set dressing
     * of the map sideways for a sheet of iron on a shed.
     */
    const j = (px * 7.31 + pz * 3.17) % 1;
    A.add('corrugated', BOX(A), LL(IDENT, hx - ex * holeW * 0.32, LID + 0.24, hz - ez * holeD * 0.32, 0, holeW * 0.9, 0.05, holeD * 0.55, (j - 0.5) * 0.1, (j - 0.5) * 0.08), {
      masks: [0.8, 0.6, 0.2],
    });
    A.put('block_small', hx - ex * holeW * 0.3, LID + 0.28, hz - ez * holeD * 0.3, j * 6.28, 1);
  }
}

/** A hole in the roof slab and a matching heap of rubble on the floor below. */
export function collapseRoof(A, rng, spec, info, hole) {
  rubbleMound(A, rng, hole.x, info.floorY[info.floorY.length - 1] + 0.15, hole.z, 2.1, 26, {
    key: 'concrete',
  });
}
