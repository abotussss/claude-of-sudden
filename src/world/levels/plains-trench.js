import { BOX, BOX_FINE, BOX_THIN, IDENT, LL } from '../kit.js';
import { fbm3, patchGeometry } from '../util.js';
import { Rng } from '../../core/rng.js';
import * as THREE from 'three';
import { paintMasks } from '../util.js';
import { RAMP_GRADE } from './plains-works.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD — DAS GRABENNETZ. The trench SYSTEM.
 * 「塹壕もたくさんある 塹壕はもっと全体に張り巡らせろ」
 * ════════════════════════════════════════════════════════════════════════════
 * The first pass dug three lines because three lines were three answers to
 * 「平原の移動をリアルに」. Having walked them, the request is now a NETWORK — and
 * that is not "draw nine more of the same scratch". A trench system is a set of
 * PARTS WITH JOBS, and once you name the jobs the plan stops being arbitrary:
 *
 *   FRONT LINES face something. They are sited on the last fold of ground
 *     before an objective and they are dug so the fire step looks AT it.
 *   COMMUNICATION TRENCHES run BACK. They join a front line to the place its
 *     men come from, so a reinforcement is not a sprint across a shoulder.
 *   FLANK SPINES run ALONG. They join neighbouring sectors, so holding two
 *     zones does not mean crossing 190 m of open ground between them.
 *   SAPS are pushed FORWARD, out of a front line towards ground you do not
 *     hold yet, and they stop short on purpose.
 *   TRAVERSES stop one grenade taking a whole run, and here they double as the
 *     places the plain — and the armour — can still get across.
 *   DUGOUTS are the holes men live in. They are cut into the REAR wall and
 *     roofed flush with the plain, for a reason that is a nav reason.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE SECTION, AND WHY EVERY NUMBER IN IT IS THE NUMBER IT IS  (unchanged)
 * ────────────────────────────────────────────────────────────────────────────
 *
 *      parapet +0.35 ▁▁▁▁▄▄▄▄                    ▄▄▄▄▁▁▁▁  +0.35
 *   plain 0.00 ──────────────┐                  ┌──────────────
 *                            │   fire step      │
 *                     -1.20  │  ┌────────┐      │
 *                            │  │        │      │
 *                     -1.65  └──┘        └──────┘   floor, 3.0 m clear
 *
 *   DEPTH 1.65 + PARAPET 0.35 = 2.00 m of cover from the trench floor. A
 *   standing eye is 1.60, so a man on the floor is UNDER the crest by 0.40 —
 *   covered, and he cannot shoot either, which is what makes the fire step the
 *   decision it should be.
 *   THE FIRE STEP is 0.45 m. On it, a standing eye is 2.05 — 5 cm over the
 *   crest — and a CROUCHED eye (1.15) is 1.60, still 0.40 under it.
 *   3.0 m CLEAR AT THE FLOOR is a `NavGrid` number: cells are 0.8 m and the
 *   capsule radius is 0.36, so three cells of floor with room either side is
 *   what makes the trench a route the bots can walk rather than a one-cell
 *   ribbon the shoulder probe shuts.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT A HEIGHT FIELD CANNOT DO, AND WHAT THAT COSTS THE NETWORK
 * ────────────────────────────────────────────────────────────────────────────
 * `src/ai/nav.js` holds ONE walkable height per (x, z) cell. A trench is the
 * tower's problem upside down, and the system makes it worse in exactly one
 * place: A JUNCTION.
 *
 *   TWO CUTS THAT CROSS cannot both be built. Their two strip meshes are two
 *   surfaces over the same ground; where they overlap they are coplanar and
 *   fight over the depth buffer, and the cheek of one runs through the floor of
 *   the other. There is no version of this a single-floor field holds.
 *
 * So the network is built out of two junction forms, and NEITHER of them is a
 * crossing:
 *
 *   1. A CORNER INSIDE A LINE. Every line here is a POLYLINE — resampled at
 *      0.5 m and smoothed until no point on it is sharper than `MIN_RADIUS` —
 *      so ONE continuous cut can come back from a base, turn ninety degrees
 *      and run east as a firing line. That is a real junction: you walk it
 *      without ever coming up. `MIN_RADIUS` is 12 m because the ribbon folds
 *      through itself when the curvature radius drops under `STRIP_R`, and 10
 *      + 2 of margin is what keeps the inside of every bend a surface.
 *   2. A MOUTH-TO-MOUTH JOIN. Where two different lines meet, they stop
 *      `MIN_SEP` = 16 m apart and you cross that at grade. It costs about four
 *      seconds and it buys the two things this map cannot give up: no two
 *      strips overlap, and the plain stays crossable ON FOOT AND IN A TANK
 *      between them. `tools/navcheck.mjs` is the gate on the first and
 *      `_nftrenchplan.mjs --check` on the second.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ARMOUR, WHICH IS WHY `GRADE` EXISTS
 * ────────────────────────────────────────────────────────────────────────────
 * Six hulls drive baked polylines out of `src/match/tank.js`, and `_bakePath`
 * drops a whole leg at the first sample it cannot stand on. The last time
 * trenches landed on this map they took FIVE SPOKES off RED-W in one go.
 *
 * The first plan here was to route every line 7 m clear of all thirty-six legs.
 * `_nftrenchplan.mjs` answered NO ROUTE for every single run of the network,
 * and the picture said why: thirty-six legs fanning off six hubs leave no 7 m
 * corridor across this map in any direction. It was also the wrong question. A
 * trench does not have to MISS a tank lane — a real system leaves a VEHICLE
 * CROSSING where one runs through, and this map's three existing lines already
 * work exactly that way ("the two flank approaches cross perpendicular at the
 * traverse").
 *
 * So `GRADE` below is the list of places the plain is left UNDUG, and every
 * entry in it was computed FROM `src/match/tank.js` by
 * `node _nftrenchplan.mjs --emit`, not chosen. `--check` re-derives it against
 * the live route table and fails if a bay has drifted onto a leg, which is the
 * gate that stops a moved waypoint costing five spokes in silence.
 */

/* ---- the section --------------------------------------------------------- */
const DEPTH = 1.65;
const HALF = 1.5;          // 3.0 m clear at the floor
const WALL_W = 0.85;       // the cheek, cut at 63° so it is not a slope
const STEP_H = 0.45;       // the fire step
const STEP_W = 0.85;
const PARAPET = 0.35;      // spoil, and it is UNDER `maxStep` so it is walkable
const BERM_W = 2.4;
/** How much further back the floor goes where a dugout is cut into the rear. */
const DUG_D = 1.9;
/** Where the widest possible section has finished and the strip is plain again. */
const TOE = HALF + DUG_D + WALL_W + BERM_W + 1.0;

/**
 * HOW LONG A BAY IS, AND HOW MUCH UNDUG GROUND IS LEFT BETWEEN TWO OF THEM.
 * 34 m is the enfilade answer — one grenade, one bay — and the 9 m between two
 * bays is the reason the plain is still crossable every 43 m rather than cut in
 * half. Both are the numbers `tools/navcheck.mjs` passed on the first three
 * lines and neither has been touched.
 */
const BAY = 34;
const TRAVERSE = 9;
/** Ramped ends: 1.65 m at `RAMP_GRADE` is 4.34 m of run. */
const ENTRY = DEPTH / RAMP_GRADE;
/**
 * The shortest thing worth calling a bay: two ramped mouths and 2.4 m of full
 * depth between them. That is a FIRE BAY — two men and a periscope — and
 * allowing it is what lets a 30 m zone trench survive having a vehicle crossing
 * taken out of its middle instead of vanishing entirely.
 */
const MIN_BAY = ENTRY * 2 + 2.4;

/**
 * A TRENCH HAS TO BE CUT OUT OF THE TERRAIN MESH, NOT LAID UNDER IT.
 *
 * The first version of this file built the whole section as boxes 1.65 m below
 * `plainsY` and changed NOTHING: `[ai] nav` came back with 223 648 walkable
 * cells before and after, to the cell. The plain's terrain is ONE mesh and it is
 * also the collision, so the ray the height field drops hit the field over the
 * top of the trench and never saw it. A cut you cannot get into is scenery.
 *
 * So the field gets a HOLE and this module fills it: `inCorridor` tells
 * `buildTerrain` which triangles to drop, and `stripMesh` lays the section in,
 * running well past the ragged 3.18 m edge the hole leaves.
 *
 * `CUT_R` is a centroid test on 3.18 m quads, so the hole's real edge lands
 * anywhere in [CUT_R - 2.1, CUT_R + 2.1]: 5.6 keeps the WHOLE cut (2.35 m to
 * the top of the cheek, 4.25 at a dugout) inside the hole at the pessimistic
 * end, and `STRIP_R` 10 covers the optimistic one with 2.3 m to spare.
 */
const CUT_R = 5.6;
const STRIP_R = 10.0;
/**
 * How far past each end of a bay the strip runs on at zero depth, so it covers
 * the terrain hole's ragged edge. @see the note in `stripMesh` — this number
 * and `inCorridor`'s end cap are one fix and neither works alone.
 */
const MOUTH = 3.0;
/** Under this radius of curvature the offset ribbon folds through itself. */
const MIN_RADIUS = 12;
/** …and two different lines closer than this would overlap strips. */
const MIN_SEP = 16;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE LINES. Each one is a polyline in level metres and each one has a JOB.
 * ────────────────────────────────────────────────────────────────────────────
 * `fireSide` is which side of the cut the fire step, the sandbags and the wire
 * are on: +1 is the LEFT of the run as walked from the first point to the last,
 * i.e. the side the trench is meant to be FOUGHT from. The dugouts and the
 * sally ramps go on the other one, which is the definition of "the rear".
 */
export const TRENCHES = [
  /* ---- the three that were already here, unchanged --------------------- */
  {
    id: 'NF-TRENCH-N', name: 'NORDGRABEN', fireSide: 1,
    why: 'the north base to zone A — the attack’s covered approach to the west site',
    pts: [[-26, -138], [-104, -108]],
  },
  {
    id: 'NF-TRENCH-S', name: 'SUDGRABEN', fireSide: -1,
    why: 'the south base to zone B, its mirror',
    pts: [[26, 138], [104, 108]],
  },
  {
    id: 'NF-TRENCH-M', name: 'MITTELSAPPE', fireSide: -1,
    why: 'the sap from zone D to the fortress’s west bastion',
    pts: [[-13, -5], [-29, 34]],
  },

  /* ---- the attack’s system, north ------------------------------------- */
  /**
   * ────────────────────────────────────────────────────────────────────────
   * THIS WAS GOING TO BE THE FIRING LINE, AND THE ARMOUR SAID NO
   * ────────────────────────────────────────────────────────────────────────
   * The plan was one cut that is two things: out of the north base, 60 m back,
   * through 90° on a 16 m arc and then 100 m of parapet at z ≈ -60 looking
   * SOUTH at the tower and zone D — a man from his spawn to a fire step on the
   * centre of the map without standing up once.
   *
   * That arm is deleted, and the profile is why. Walked at 1 m against the
   * baked routes, every metre from s = 60 to s = 118 is inside 6 m of a tank
   * leg — RED-W→E, BLUE-W→E, RED-C→B and BLUE-C→E all sweep east-west through
   * z ≈ -60, because that fold of ground is the natural approach to the centre
   * for a hull for exactly the same reason it is the right place for a firing
   * line. `--emit` wanted 96 m of vehicle crossing on a 137 m run. Five more
   * sitings of it in that band, north-south so as to cross the fan rather than
   * lie in it, each came back needing two or three crossings on 35 m.
   *
   * THE SHAPE OF THIS NETWORK IS DICTATED BY THE ARMOUR and it is worth saying
   * plainly: thirty-six baked polylines fanning off six hubs to five zones
   * cover the middle of this map, so the trenches live on the flanks and the
   * approaches. The long continuous corners this file was built to allow are
   * on WESTRIEGEL and OSTRIEGEL instead, where there is room for them.
   *
   * What survives here is the honest half — the communication trench. It leaves
   * the north base's spawn cluster and runs 48 m west-south-west towards zone A
   * and the NORDGRABEN system, and it stops at the one place RED-E→A crosses it.
   */
  {
    id: 'NF-TRENCH-NF', name: 'NORDKEHLE', fireSide: -1,
    why: 'the north base out to the west, towards zone A and NORDGRABEN',
    pts: [[-16, -124], [-28, -108], [-40, -98], [-52, -94]],
  },
  /**
   * BASE-N → E WAS THE WORST CROSSING ON THE MAP — 76 m of continuous exposed
   * walk in the pass before the cover went down, the longest of the twelve. It
   * is also the one lane on the plain with no tank leg lying along it, so this
   * run has ZERO vehicle crossings and is dug end to end.
   */
  {
    id: 'NF-TRENCH-OK', name: 'OSTKEHLE', fireSide: -1,
    why: 'the north base out to the north-east, towards zone E',
    pts: [[10, -128], [40, -118], [68, -107], [84, -99]],
  },
  /**
   * ────────────────────────────────────────────────────────────────────────
   * THERE IS NO WEST SAP, AND THE REASON IS WORTH KEEPING
   * ────────────────────────────────────────────────────────────────────────
   * A sap pushed from the west shoulder towards the centre is the obvious
   * fourth run of the attack’s system and FOUR separate sitings of it were
   * measured and thrown away. The ground between the RED-W hub (-88,-24) and
   * zone D is where five tank legs interchange — RED-W:HUB, RED-W→D, RED-C→C,
   * BLUE-C→A and BLUE-W→D all pass inside thirty metres of each other — and
   * `--emit` came back wanting 112 m of vehicle crossing on a 49 m line. A
   * trench that is more crossing than trench is a ditch with a name.
   *
   * What the west approach got instead is WESTRIEGEL, 40 m further out, where
   * there is room for 137 m of it.
   */

  /* ---- the flank spines ------------------------------------------------ */
  /**
   * A ⇄ C IN COVER. 170 m down the whole western shoulder, hooked at the south
   * end to come up 16 m short of NORDGRABEN’s far mouth so the two systems join
   * at zone A, and running north past the west foot to within reach of C.
   */
  {
    id: 'NF-TRENCH-WR', name: 'WESTRIEGEL', fireSide: 1,
    why: 'the west flank spine: zone A to zone C without crossing the shoulder',
    pts: [[-122, -88], [-133, -70], [-142, -40], [-144, -2], [-140, 32], [-136, 44]],
  },
  {
    id: 'NF-TRENCH-OR', name: 'OSTRIEGEL', fireSide: -1,
    why: 'the east flank spine: zone E to zone B, the mirror of WESTRIEGEL',
    pts: [[134, -72], [143, -48], [146, -10], [144, 26], [138, 52], [130, 70]],
  },

  /* ---- the defence’s system, south ------------------------------------ */
  {
    id: 'NF-TRENCH-SF', name: 'SUDSTELLUNG', fireSide: 1,
    why: 'the defence’s line across the south base’s front, facing north at the fortress',
    pts: [[-6, 113], [16, 112], [28, 110]],
  },
  {
    id: 'NF-TRENCH-SW', name: 'SUDWESTSAPPE', fireSide: 1,
    why: 'out of the south-west swell towards the fortress’s western approach',
    pts: [[-92, 26], [-80, 40], [-66, 50]],
  },
  {
    id: 'NF-TRENCH-SO', name: 'SUDOSTSAPPE', fireSide: -1,
    why: 'the mirror, out of the south-east towards zone B',
    pts: [[54, 72], [64, 68], [76, 68], [86, 73]],
  },
  /**
   * ────────────────────────────────────────────────────────────────────────
   * AND THERE IS NO SOUTH-WEST SPINE EITHER, FOR THE SAME REASON AS THE WEST
   * ────────────────────────────────────────────────────────────────────────
   * A 63 m run from the fortress’s western approach up to zone C was authored,
   * measured and deleted, along with six re-sitings of it. BLUE-C→C, BLUE-W:HUB,
   * RED-E→C, BLUE-E→C and RED-W→B all fan through that quadrant, and
   * `--emit` came back wanting 102 m of vehicle crossing on the 63 m line: not
   * a trench with crossings in it, a set of crossings with trench between them.
   * The south-west is held by SUDWESTSAPPE, C-STELLUNG and WESTRIEGEL’s north
   * end instead, which is three runs that fit.
   */

  /* ---- what each capture point has dug in front of itself -------------- */
  /**
   * A ZONE IS A PLACE MEN HOLD, so each of the four shoulder points has a short
   * length of fire trench across the bearing it is attacked from.
   *
   * THEY ARE ON THE FAR SIDE OF EACH POINT, and that is `MIN_SEP` deciding the
   * plan rather than taste. The first cut put A's fire trench on the north-east
   * shoulder, which is exactly where NORDGRABEN's far mouth already is — 0.6 m
   * between two axes, i.e. two strip meshes on top of each other. Each point
   * already has one or two runs arriving from the map's side of it; what it did
   * not have was anything to fall back INTO, so these are dug behind them.
   */
  {
    id: 'NF-TRENCH-ZA', name: 'A-STELLUNG', fireSide: 1,
    why: 'zone A’s fire trench, dug behind the point and facing back over it',
    pts: [[-140, -90], [-134, -104], [-122, -116]],
  },
  {
    id: 'NF-TRENCH-ZE', name: 'E-STELLUNG', fireSide: 1,
    why: 'zone E’s fire trench, dug behind the point',
    pts: [[132, -102], [120, -112], [106, -116]],
  },
  {
    id: 'NF-TRENCH-ZB', name: 'B-STELLUNG', fireSide: -1,
    why: 'zone B’s fire trench, the mirror of A’s',
    pts: [[140, 90], [134, 104], [122, 116]],
  },
  {
    id: 'NF-TRENCH-ZC', name: 'C-STELLUNG', fireSide: -1,
    why: 'zone C’s fire trench, dug behind the point',
    pts: [[-138, 94], [-132, 106], [-122, 114]],
  },
];

/**
 * ────────────────────────────────────────────────────────────────────────────
 * WHERE THE PLAIN IS LEFT AT GRADE — the vehicle crossings
 * ────────────────────────────────────────────────────────────────────────────
 * [x, z, r] in level metres: no bay may be dug inside one of these circles.
 *
 * EVERY ENTRY IS COMPUTED, NOT CHOSEN. `node _nftrenchplan.mjs --emit` reads
 * `PLAINS_ROUTES` out of `src/match/tank.js` itself, walks each line above at
 * 1 m, and collapses every stretch that comes within 6 m of a baked tank leg
 * into one circle at its middle. 8 m of radius is 16 m of undug ground, which
 * is what a 3.3 m hull crossing a line obliquely needs with `LATERAL_MAX` = 3 m
 * of sample slide either side of its authored centreline.
 *
 * `node _nftrenchplan.mjs --check` re-derives this against the live route table
 * and exits non-zero if any bay has drifted onto a leg. Run it after touching
 * either file.
 */
export const GRADE = [
  [-46, -96, 8],                     // NORDKEHLE    × RED-E→A
  [82, -100, 8],                     // OSTKEHLE     × RED-C→E, at its far end
  [-125, -84, 8], [-137, 42, 8],     // WESTRIEGEL   × BLUE-W→A, BLUE-W→C
  [132, 66, 8],                      // OSTRIEGEL    × RED-E→B
  [-72, 46, 8],                      // SUDWESTSAPPE × BLUE-C→C
  [68, 68, 8],                       // SUDOSTSAPPE  × BLUE-E:HUB
  // SUDSTELLUNG and A-, B-, C- and E-STELLUNG cross nothing: the four zone
  // trenches are dug BEHIND their points,
  // which is where the armour is not. Nor does the first 64 m of OSTKEHLE —
  // BASE-N→E was the longest exposed walk on the plain AND is the one lane with
  // no tank leg lying along it, so the worst crossing gets the network's
  // longest uninterrupted run.
];

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE FIRST THREE LINES ARE GRANDFATHERED, ON PURPOSE
 * ────────────────────────────────────────────────────────────────────────────
 * `--emit` also reports crossings on NORDGRABEN, SUDGRABEN and MITTELSAPPE, and
 * NONE of them is in the table above. That is a decision, not an oversight.
 *
 * Those three are PROVED: with them exactly as they are, thirty-five of
 * thirty-six tank legs bake and the one that does not was taken by the tower's
 * new stairs at (-12,-34), not by a trench. Two of the three crossings `--emit`
 * finds are the traverse and the mouth that were MEASURED into place when they
 * were dug ("at grade in exactly three places per line: both ramped mouths and
 * one traverse at s = 40" — NORDGRABEN's come out at s ≈ 41 and s ≈ 84).
 *
 * The third would be actively harmful. MITTELSAPPE is 42 m long and `--emit`
 * wants 16 m of it undug at each end, which leaves ONE 13 m fire bay where the
 * map's most useful sap is. And the leg it is reacting to is the documented
 * 4.6 m gap into zone D from the west that three wheels already share and that
 * already works. `NEAR` = 6 m is a deliberately pessimistic proxy for "a hull
 * sample lands in the cut", and these three lines are the standing evidence
 * that 4.6 m of it is survivable.
 *
 * So: `--check` reports them and does not fail on them, and the boot log is
 * what says whether that was right. If a leg ever drops naming one of these
 * three, the fix is a `GRADE` circle here and this paragraph is why it was not
 * already there.
 */
const LEGACY = new Set(['NF-TRENCH-N', 'NF-TRENCH-S', 'NF-TRENCH-M']);

// ─────────────────────────────────────────────────────── the centreline ────
/**
 * A LINE, RESAMPLED AND SMOOTHED.
 *
 * The authored polyline is a set of corners; what the strip mesh needs is a
 * CURVE, because the section is laid out on the normal and a normal that snaps
 * through 90° at a vertex builds a bow tie. So: resample at `DS`, then run a
 * three-tap smoothing filter over the interior until the tightest curvature
 * radius anywhere on the line is over `MIN_RADIUS`. The ends are pinned, so a
 * line still starts and finishes where it was authored to.
 *
 * The number of passes is not a taste: each pass is a discrete heat step, and
 * the assert below is what says whether enough of them have run. A line whose
 * corner is too sharp to fix inside the pass budget is a LOUD failure rather
 * than a fold nobody notices until it is photographed.
 */
const DS = 0.5;

function centreline(pts) {
  const X = [], Z = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / DS));
    for (let k = 0; k < n; k++) {
      X.push(ax + ((bx - ax) * k) / n);
      Z.push(az + ((bz - az) * k) / n);
    }
  }
  X.push(pts[pts.length - 1][0]);
  Z.push(pts[pts.length - 1][1]);

  const n = X.length;
  const tx = new Float64Array(n), tz = new Float64Array(n);
  for (let pass = 0; pass < 160; pass++) {
    for (let i = 1; i < n - 1; i++) {
      tx[i] = X[i - 1] * 0.25 + X[i] * 0.5 + X[i + 1] * 0.25;
      tz[i] = Z[i - 1] * 0.25 + Z[i] * 0.5 + Z[i + 1] * 0.25;
    }
    for (let i = 1; i < n - 1; i++) { X[i] = tx[i]; Z[i] = tz[i]; }
  }

  /* ---- arc length, tangent and the curvature assert -------------------- */
  const S = new Float64Array(n);
  for (let i = 1; i < n; i++) S[i] = S[i - 1] + Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1]);
  const TX = new Float64Array(n), TZ = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = X[b] - X[a], dz = Z[b] - Z[a];
    const l = Math.hypot(dx, dz) || 1;
    TX[i] = dx / l; TZ[i] = dz / l;
  }
  let tightest = Infinity;
  for (let i = 1; i < n - 1; i++) {
    const ds = (S[i + 1] - S[i - 1]) / 2 || DS;
    const dth = Math.abs(Math.atan2(TX[i + 1], TZ[i + 1]) - Math.atan2(TX[i - 1], TZ[i - 1]));
    const k = (dth > Math.PI ? Math.PI * 2 - dth : dth) / (2 * ds);
    if (k > 1e-6) tightest = Math.min(tightest, 1 / k);
  }
  return { X, Y: null, Z, S, TX, TZ, n, total: S[n - 1], tightest };
}

/**
 * The point and the frame at arc length `s`, by linear lookup.
 *
 * `s` MAY RUN OFF EITHER END, and it must: the strip overhangs its bay by
 * `MOUTH` so it can cover the terrain hole, and a bay that starts at s = 0 of
 * its own line therefore asks for negative arc length. Clamping the index
 * without extrapolating gave every such strip three metres of degenerate quads
 * stacked on one point. Off the end, the line is continued straight along its
 * end tangent, which is what an unsmoothed polyline does anyway.
 */
function at(L, s, d = 0) {
  if (s < 0 || s > L.total) {
    const e = s < 0 ? 0 : L.n - 1;
    const ov = s < 0 ? s : s - L.total;
    const tx = L.TX[e], tz = L.TZ[e];
    const x = L.X[e] + tx * ov;
    const z = L.Z[e] + tz * ov;
    return { x: x + tz * d, z: z - tx * d, tx, tz, nx: tz, nz: -tx, yaw: Math.atan2(tx, tz) };
  }
  const i = Math.max(0, Math.min(L.n - 2, Math.floor(s / DS)));
  const t = Math.max(0, Math.min(1, (s - L.S[i]) / (L.S[i + 1] - L.S[i] || DS)));
  const x = L.X[i] + (L.X[i + 1] - L.X[i]) * t;
  const z = L.Z[i] + (L.Z[i + 1] - L.Z[i]) * t;
  let tx = L.TX[i] + (L.TX[i + 1] - L.TX[i]) * t;
  let tz = L.TZ[i] + (L.TZ[i + 1] - L.TZ[i]) * t;
  const l = Math.hypot(tx, tz) || 1;
  tx /= l; tz /= l;
  // the normal: +d is the LEFT of the run, which is what `fireSide` +1 means
  return { x: x + tz * d, z: z - tx * d, tx, tz, nx: tz, nz: -tx, yaw: Math.atan2(tx, tz) };
}

// ────────────────────────────────────────────────────────────── the bays ────
/** Every bay of every line, resolved once at module load. */
const BAYS = [];
/** The lines themselves, keyed by spec, so a bay knows its own curve. */
const LINES = new Map();

function gradeAt(x, z) {
  for (const [gx, gz, r] of GRADE) if ((x - gx) ** 2 + (z - gz) ** 2 < r * r) return true;
  return false;
}

/**
 * WALK A LINE AND CUT IT INTO BAYS.
 *
 * Two rules break a run, and they are different in kind:
 *   · a `GRADE` circle is ground that MAY NOT be dug — a vehicle crossing —
 *     and the walk simply skips it.
 *   · `BAY` + `TRAVERSE` is ground that COULD be dug and is deliberately not,
 *     so no single run is longer than 34 m and the plain stays crossable on
 *     foot every 43 m.
 * Whatever survives both and is at least `MIN_BAY` long becomes a bay.
 */
for (const spec of TRENCHES) {
  const L = centreline(spec.pts);
  LINES.set(spec, L);
  if (L.tightest < MIN_RADIUS) {
    console.warn(
      `[world] trench ${spec.name}: tightest curvature radius ${L.tightest.toFixed(1)} m ` +
        `is under ${MIN_RADIUS} — the strip will fold on the inside of that bend`
    );
  }
  // where the line is undiggable, at 0.5 m
  const open = [];
  for (let s = 0; s <= L.total; s += DS) {
    const p = at(L, s);
    open.push(!gradeAt(p.x, p.z));
  }
  // the diggable stretches
  const runs = [];
  let s0 = null;
  for (let i = 0; i < open.length; i++) {
    if (open[i] && s0 === null) s0 = i * DS;
    else if (!open[i] && s0 !== null) { runs.push([s0, i * DS]); s0 = null; }
  }
  if (s0 !== null) runs.push([s0, L.total]);
  // …each chopped into bays with a traverse between them
  for (const [a, b] of runs) {
    const len = b - a;
    if (len < MIN_BAY) continue;
    // as many equal bays as fit, so a 40 m run is two 15.5 m bays rather than
    // one 34 and one 6 that gets thrown away
    const k = Math.max(1, Math.ceil((len + TRAVERSE) / (BAY + TRAVERSE)));
    const each = (len - TRAVERSE * (k - 1)) / k;
    if (each < MIN_BAY) continue;
    for (let i = 0; i < k; i++) {
      const bs = a + i * (each + TRAVERSE);
      BAYS.push({ spec, L, s0: bs, s1: bs + each });
    }
  }
}

/**
 * NO TWO LINES MAY COME WITHIN `MIN_SEP`. @see the junction note in the header:
 * closer than this and two strip meshes overlap, which is two surfaces fighting
 * over one depth buffer and one cheek running through another floor. Checked at
 * module load rather than trusted, because it is invisible until photographed.
 */
(function checkSeparation() {
  let worst = Infinity, who = null;
  for (let i = 0; i < BAYS.length; i++) {
    for (let j = i + 1; j < BAYS.length; j++) {
      if (BAYS[i].spec === BAYS[j].spec) continue;
      const a = BAYS[i], b = BAYS[j];
      for (let s = a.s0; s <= a.s1; s += 2) {
        const p = at(a.L, s);
        for (let t = b.s0; t <= b.s1; t += 2) {
          const q = at(b.L, t);
          const d = Math.hypot(p.x - q.x, p.z - q.z);
          if (d < worst) { worst = d; who = `${a.spec.name} / ${b.spec.name}`; }
        }
      }
    }
  }
  if (worst < MIN_SEP) {
    console.warn(`[world] trenches ${who} come within ${worst.toFixed(1)} m — under MIN_SEP ${MIN_SEP}, their strips overlap`);
  }
})();

/**
 * ────────────────────────────────────────────────────────────────────────────
 * A SAMPLE INDEX, because `inCorridor` is asked forty thousand times
 * ────────────────────────────────────────────────────────────────────────────
 * `buildTerrain` calls `inCorridor` on every one of 44 000 terrain triangle
 * centroids and `plains.js` calls `inWorks` on 21 000 scattered props. With
 * three straight lines a linear scan was nothing; with nine hundred metres of
 * curve it is 1 800 samples per query and the boot gains a second. So every
 * bay is sampled at 1 m into a 12 m hash grid once, and a query touches the
 * nine buckets around it.
 */
const HASH = 12;
const GRID = new Map();
/** [x, z, tx, tz, bayIndex, end] per sample; `end` is -1 first, +1 last, 0 else. */
const SAMPLES = [];
const STRIDE = 6;
for (let b = 0; b < BAYS.length; b++) {
  const bay = BAYS[b];
  const n = Math.max(1, Math.round((bay.s1 - bay.s0) / 1.0));
  for (let i = 0; i <= n; i++) {
    const s = bay.s0 + ((bay.s1 - bay.s0) * i) / n;
    const p = at(bay.L, s);
    const ix = SAMPLES.length;
    SAMPLES.push(p.x, p.z, p.tx, p.tz, b, i === 0 ? -1 : i === n ? 1 : 0);
    const key = `${Math.floor(p.x / HASH)},${Math.floor(p.z / HASH)}`;
    let cell = GRID.get(key);
    if (!cell) GRID.set(key, (cell = []));
    cell.push(ix);
  }
}

/** The nearest bay sample to a point: its distance, its index and its bay. */
function nearestSample(x, z) {
  const cx = Math.floor(x / HASH), cz = Math.floor(z / HASH);
  let best = Infinity, at2 = -1;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cell = GRID.get(`${cx + i},${cz + j}`);
      if (!cell) continue;
      for (const ix of cell) {
        const dx = SAMPLES[ix] - x, dz = SAMPLES[ix + 1] - z;
        const d = dx * dx + dz * dz;
        if (d < best) { best = d; at2 = ix; }
      }
    }
  }
  return { d: Math.sqrt(best), ix: at2, bay: at2 < 0 ? -1 : SAMPLES[at2 + 4] };
}

/** Perpendicular distance to the nearest cut, for the strip's paint. */
function nearestD(x, z) {
  return nearestSample(x, z).d;
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * IS THIS POINT INSIDE THE CORRIDOR THE TERRAIN MESH MUST GIVE UP?
 * ────────────────────────────────────────────────────────────────────────────
 * `buildTerrain` calls this on every triangle centroid and DELETES the ones it
 * says yes to. So the set this returns is the set `stripMesh` has to cover, and
 * anywhere the two disagree is a piece of the world with nothing under it.
 *
 * IT IS CAPPED AT THE BAY ENDS, AND THAT IS THE WHOLE POINT OF THIS FUNCTION.
 * Written as a plain "within `r` of the nearest sample" it is a CAPSULE, and a
 * capsule reaches `CUT_R` = 5.6 m past the last sample at each end. Two bays
 * facing each other across a 9 m traverse then have overlapping caps, the
 * traverse's terrain is deleted, and NOTHING lays it back — because the strip
 * stops at the bay end. Measured with `_nfhole.mjs`: 2 593 lattice cells with
 * no ground under them in 47 clusters, one per mouth and one per traverse.
 *
 * The traverses are the vehicle crossings. `Armour._bakePath` ends a leg the
 * moment `physics.groundHeight` is not finite, so ELEVEN tank spokes dropped
 * with `no ground at sample N` — RED-C's entire wheel, because its hub at
 * (-32,-88) stood in one of the holes. Silent: both maps still reached
 * `phase === 'live'` with zero page errors the whole time.
 *
 * So the test is a RECTANGLE in (along, across): within `r` perpendicular AND
 * not past either end. The strip then overhangs by `MOUTH` and covers it.
 */
export function inCorridor(x, z, r = CUT_R) {
  const s = nearestSample(x, z);
  if (s.ix < 0 || s.d >= r) return false;
  const end = SAMPLES[s.ix + 5];
  if (!end) return true;
  const along = (x - SAMPLES[s.ix]) * SAMPLES[s.ix + 2] + (z - SAMPLES[s.ix + 1]) * SAMPLES[s.ix + 3];
  return end < 0 ? along >= 0 : along <= 0;
}

/** Published so `plains.js` can keep its scatter and its cover out of the cut. */
export function trenchKeepOut() {
  const out = [];
  for (const b of BAYS) {
    const n = Math.ceil((b.s1 - b.s0) / 4);
    for (let i = 0; i <= n; i++) {
      const p = at(b.L, b.s0 + ((b.s1 - b.s0) * i) / n);
      out.push({ x: p.x, z: p.z, r: HALF + WALL_W + BERM_W + 1.0 });
    }
  }
  return out;
}

/**
 * The SMOOTHED centrelines, at 1 m. Published for `_nftrenchplan.mjs --emit`,
 * which derives `GRADE` from them — deriving the vehicle crossings from the
 * AUTHORED polyline instead was wrong by up to four metres at every corner,
 * because the corner the strip is actually cut on is the filleted one.
 */
export function trenchLines() {
  return TRENCHES.map((spec) => {
    const L = LINES.get(spec);
    const pts = [];
    for (let s = 0; s <= L.total; s += 1) { const p = at(L, s); pts.push([p.x, p.z]); }
    return { id: spec.id, name: spec.name, legacy: LEGACY.has(spec.id), total: L.total, pts };
  });
}

/** Published for `_nftrenchplan.mjs`, which gates these against the tank table. */
export function trenchBays() {
  return BAYS.map((b) => ({
    id: b.spec.id,
    name: b.spec.name,
    legacy: LEGACY.has(b.spec.id),
    s0: b.s0,
    s1: b.s1,
    /** The axis at 1 m, in level metres — what the gate measures against. */
    pts: (() => {
      const out = [];
      const n = Math.max(1, Math.round((b.s1 - b.s0) / 1.0));
      for (let i = 0; i <= n; i++) {
        const p = at(b.L, b.s0 + ((b.s1 - b.s0) * i) / n);
        out.push([p.x, p.z]);
      }
      return out;
    })(),
    /** …and the sally ramps and dugouts, which are holes in the cover. */
    exits: exitsOf(b).map((e) => {
      const p = at(b.L, e.s);
      return { kind: e.kind, x: p.x, z: p.z };
    }),
  }));
}

// ─────────────────────────────────────────────────── the section, analytic ──
/**
 * ────────────────────────────────────────────────────────────────────────────
 * SALLY RAMPS AND DUGOUTS — the two modulations of the section, and the ONE-WAY
 * PROBLEM they exist for
 * ────────────────────────────────────────────────────────────────────────────
 * A 63° cheek is a wall by design, which means a trench with exits only at its
 * two ramped mouths is a hole a man can FALL INTO and then walk up to 17 m
 * along in the dark to get out of. `_measureDrops` was already flagged for
 * letting a bot jump in with nobody ever checking it could get out. A trench
 * that is a trap is worse than no trench.
 *
 * So every bay over 22 m gets a SALLY RAMP at its middle: 4 m of the REAR cheek
 * replaced by a straight `RAMP_GRADE` slope from the floor up to the plain,
 * 4.34 m of run. It is a way OUT and — because it is on one side only — it is
 * not a way ACROSS: the far cheek is still a wall, so the trench still cuts the
 * line it is dug on, which is what the armour's `GRADE` crossings and
 * `navcheck` both depend on. `_nftrap.mjs` proves the result: it floods the nav
 * grid and asserts every cell that stands in a cut is in the same component as
 * the plain.
 *
 * A DUGOUT is the other one. It is 4 m of the rear wall taken back another
 * 1.9 m and ROOFED — and the roof is flush with the plain, which is a NAV
 * decision before it is a picture: the height field's one ray finds the roof at
 * exactly the height the ground it replaced was, so the cell over a dugout
 * reads as the plain it always was and nothing is stranded and nothing is
 * carved. Underneath there is 1.40 m of headroom, so you go in CROUCHED, which
 * is what a dugout is.
 */
const SALLY_MIN = 22;      // a bay shorter than this has its mouths and nothing else
const SALLY_W = 4.0;       // …and the ramp is this long, along the trench
const DUG_MIN = 26;
const DUG_W = 4.0;
const ROOF_T = 0.25;

/** The sally ramps and dugouts of one bay, as arc lengths along its own line. */
function exitsOf(bay) {
  const len = bay.s1 - bay.s0;
  const out = [];
  if (len >= SALLY_MIN) out.push({ kind: 'sally', s: bay.s0 + len * 0.5 });
  if (len >= DUG_MIN) out.push({ kind: 'dugout', s: bay.s0 + len * 0.22 });
  return out;
}

/** 1 inside a window of half-width `w`, 0 outside, smooth across 1.2 m. */
function window1(s, c, w) {
  const a = Math.abs(s - c);
  if (a <= w * 0.5) return 1;
  const t = 1 - Math.min(1, (a - w * 0.5) / 1.2);
  return t * t * (3 - 2 * t);
}

/**
 * THE SECTION, ANALYTIC — depth below the plain at a perpendicular distance `d`
 * for a bay whose local depth (0 at each ramped mouth) is `depth`.
 * Negative is a cut, positive is the spoil thrown up on the lip.
 *
 * `sally` and `dug` are 0..1 and only ever bite on the REAR side, which is the
 * side `fireSide` is not.
 */
function section(d, depth, fireSide, sally = 0, dug = 0) {
  const rear = d * fireSide < 0;
  const a = Math.abs(d);
  const half = rear ? HALF + DUG_D * dug : HALF;
  let v;
  if (a <= half) v = -depth;
  else if (a <= half + WALL_W) {
    // the cheek: 63° at full depth, which is over `maxSlopeDeg` 46 and is
    // therefore a wall to the height field rather than a way in
    const t = (a - half) / WALL_W;
    v = -depth * (1 - t * t * (3 - 2 * t));
  } else {
    const b = a - half - WALL_W;
    // the parapet, and 0.35 is UNDER the 0.45 m step so it stays crossable
    v = b <= BERM_W ? PARAPET * Math.sin((b / BERM_W) * Math.PI) ** 0.8 : 0;
  }
  if (rear && sally > 0) {
    const r = Math.min(0, -depth + Math.max(0, a - HALF) * RAMP_GRADE);
    v = v * (1 - sally) + r * sally;
  }
  return v;
}

// ──────────────────────────────────────────────────────────────── build ────
export function buildTrenches(A, groundY) {
  /** Its own fixed-seed stream — @see the same note in `plains-tower.js`. */
  const rng = new Rng(0x7c8ea1);
  let dug = 0;
  for (let i = 0; i < BAYS.length; i++) {
    const b = BAYS[i];
    stripMesh(A, b, groundY, i);
    dressBay(A, rng, b, groundY);
    dug += b.s1 - b.s0;
  }
  console.info(
    `[world] nachtfeld: ${TRENCHES.length} trench lines, ${BAYS.length} bays, ` +
      `${dug.toFixed(0)} m of cut, ${GRADE.length} vehicle crossings left at grade`
  );
}

/**
 * THE ACROSS-SAMPLING, once. Fine where the section is (the cheek is 0.85 m and
 * wants three quads of its own), coarse out on the flat ring that only exists
 * to cover the terrain hole's ragged edge. Uniform 0.3 m out to 10 m was 40 %
 * more triangles than this for no visible difference past the parapet, and with
 * nine hundred metres of cut that is the difference between a budget and a
 * problem.
 */
const DCOLS = (() => {
  const out = [];
  for (let d = -STRIP_R; d < -TOE; d += 1.0) out.push(d);
  for (let d = -TOE; d <= TOE + 1e-6; d += 0.3) out.push(d);
  for (let d = TOE + 1.0; d <= STRIP_R + 1e-6; d += 1.0) out.push(d);
  return out;
})();

/**
 * THE CUT ITSELF, as one mesh per bay, and it is the collision as well — the
 * same discipline `buildTerrain` follows, for the same reason: a separate
 * coarse hull would put the player a few centimetres off the visible floor and
 * describe a trench to the bots that the man at the keyboard cannot see.
 */
function stripMesh(A, bay, groundY, index) {
  const { L, s0, s1, spec } = bay;
  /**
   * THE STRIP OVERHANGS ITS BAY AT BOTH ENDS, at zero depth, and this is the
   * other half of `inCorridor`'s end cap.
   *
   * `buildTerrain` drops a triangle when its CENTROID is in the corridor, and a
   * 3.18 m quad's vertices stand up to 2.1 m outside its own centroid — so the
   * hole the terrain is left with is ragged and reaches about 1.6 m past the
   * last in-corridor centroid. A strip that stops dead at `s1` leaves that as a
   * gap you can fall through. Three metres of flat apron covers it with margin
   * and costs three rows of quads a bay.
   */
  const a0 = s0 - MOUTH;
  const a1 = s1 + MOUTH;
  const rows = Math.max(6, Math.round((a1 - a0) / 1.0)) + 1;
  const cols = DCOLS.length;
  const exits = exitsOf(bay);
  const depthAt = (s) => DEPTH * Math.max(0, Math.min(1, Math.min(s - s0, s1 - s) / ENTRY));
  const sallyAt = (s) => exits.reduce((m, e) => (e.kind === 'sally' ? Math.max(m, window1(s, e.s, SALLY_W)) : m), 0);
  const dugAt = (s) => exits.reduce((m, e) => (e.kind === 'dugout' ? Math.max(m, window1(s, e.s, DUG_W)) : m), 0);

  /**
   * TWO STRIPS THAT OVERLAP MUST NOT BE COPLANAR. Nothing overlaps inside the
   * section — `MIN_SEP` is what guarantees that — but two lines meeting at 16 m
   * DO overlap out on the flat ring, and two flat surfaces at the same height
   * is a depth fight visible from 200 m. A centimetre per line, cycled, is
   * under the 3 cm lip this strip already stands proud of the terrain by.
   */
  const over = 0.03 + (index % 5) * 0.01;

  const pos = new Float32Array(rows * cols * 3);
  let w = 0;
  for (let r = 0; r < rows; r++) {
    const s = a0 + ((a1 - a0) * r) / (rows - 1);
    const depth = depthAt(s);
    const sally = sallyAt(s);
    const dug = dugAt(s);
    for (let c = 0; c < cols; c++) {
      const d = DCOLS[c];
      const p = at(L, s, d);
      const base = groundY(p.x, p.z);
      pos[w++] = p.x;
      pos[w++] = base + section(d, depth, spec.fireSide, sally, dug) + (Math.abs(d) > TOE ? over : 0);
      pos[w++] = p.z;
    }
  }
  const idx = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, e = a + cols, f = e + 1;
      idx.push(a, e, b, b, e, f);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  /**
   * THE STRIP IS PAINTED WITH THE PLAIN'S OWN RECIPE, not with its own, and it
   * carries the plain's own palette key. `steppe_bare` and a paint of this
   * module's invention drew a hard-edged 22 m band of a different colour across
   * the grass wherever a trench ran — the geometry was seamless and the material
   * was not, which is the more obvious of the two failures at 30 m.
   */
  paintMasks(g, (x, y, z, mx, my, mz, out) => {
    const n = fbm3(x * 0.055, 2.3, z * 0.055, 3);
    const steep = 1 - Math.min(1, Math.max(0, (my - 0.62) / 0.3));
    const l = nearestD(x, z);
    const turned = Math.max(0, 1 - Math.max(0, l - HALF - WALL_W) / BERM_W);
    out[0] = Math.min(1, 0.18 + steep * 0.6 + turned * 0.22);
    out[1] = Math.min(1, 0.22 + n * 0.46 - steep * 0.18 + turned * 0.3);
    out[2] = Math.min(1, 0.18 + n * 0.22 + turned * 0.2);
  });
  A.add('steppe', g, null);
  A.collideGeo('dirt', g);
  g.dispose();
}

// ─────────────────────────────────────────────────────────────── dressing ──
/**
 * ONE BAY'S DRESSING. The cut itself is `stripMesh` — this is everything that
 * was put IN it: duckboards on the floor, revetment against both cheeks, the
 * fire step on the side that faces the enemy, sandbags on the crest above it,
 * the stores a held trench accumulates and the wire out in front. Plus, new
 * with the network, the sally ramp's treads and the dugout's roof and bunk.
 *
 * The fire step and the dugout roof are the only things here that carry
 * collision, because they are the only things here you stand on or under.
 *
 * SEG IS 2.0, NOT 1.6. Nine hundred metres of cut is four and a half times what
 * this file used to build, and the revetment is the per-metre cost: at 1.6 m
 * the network came to a quarter of the map's whole static triangle budget. 2.0
 * with a stake every third panel reads the same at 2 m and costs a fifth less.
 */
const SEG = 2.0;

function dressBay(A, rng, bay, groundY) {
  const { L, s0, s1, spec } = bay;
  const exits = exitsOf(bay);
  const depthAt = (s) => DEPTH * Math.max(0, Math.min(1, Math.min(s - s0, s1 - s) / ENTRY));
  const sallyAt = (s) => exits.reduce((m, e) => (e.kind === 'sally' ? Math.max(m, window1(s, e.s, SALLY_W)) : m), 0);
  const dugAt = (s) => exits.reduce((m, e) => (e.kind === 'dugout' ? Math.max(m, window1(s, e.s, DUG_W)) : m), 0);
  const sd = spec.fireSide;

  const n = Math.max(3, Math.round((s1 - s0) / SEG));
  for (let i = 0; i < n; i++) {
    const s = s0 + (i + 0.5) * ((s1 - s0) / n);
    const p = at(L, s);
    const g = groundY(p.x, p.z);
    const depth = depthAt(s);
    if (depth < 0.55) continue; // the ramped mouths are bare earth, and have to be
    const sally = sallyAt(s);
    const dug = dugAt(s);
    const floor = g - depth;
    const len = (s1 - s0) / n + 0.06;
    const yaw = p.yaw;

    // ---- duckboards, laid down the middle of the floor ---------------------
    if (i % 2 === 0) {
      A.add('wood_prop_dark', BOX_FINE(A), LL(IDENT, p.x, floor + 0.05, p.z,
        yaw + rng.range(-0.02, 0.02), HALF * 1.6, 0.07, len * 0.92), { masks: [0.85, 0.75, 0.3] });
      for (let k = -1; k <= 1; k++) {
        A.add('wood_prop', BOX_THIN(A), LL(IDENT, p.x + p.tx * k * 0.5, floor + 0.1, p.z + p.tz * k * 0.5,
          yaw, HALF * 1.5, 0.04, 0.16), { masks: [0.8, 0.6, 0.2] });
      }
    }

    // ---- revetment against the two cheeks ----------------------------------
    for (const side of [-1, 1]) {
      // the rear wall steps back at a dugout and vanishes at a sally ramp
      const rear = side * sd < 0;
      const off = HALF + 0.14 + (rear ? DUG_D * dug : 0);
      if (rear && sally > 0.5) continue;
      const q = at(L, s, side * off);
      const h = depth * (rear ? 1 - sally : 1);
      if (h < 0.4) continue;
      if (side > 0) {
        // corrugated sheet, held by a stake every third panel
        A.add('corrugated', BOX_THIN(A), LL(IDENT, q.x, floor + h / 2 + 0.06, q.z,
          yaw, 0.06, h + 0.1, len), { masks: [0.9, 0.75, 0.25] });
        if (i % 3 === 0) {
          A.add('wood_prop_dark', BOX_THIN(A), LL(IDENT, q.x - p.nx * side * 0.09, floor + h / 2, q.z - p.nz * side * 0.09,
            yaw, 0.12, h + 0.3, 0.13), { masks: [0.8, 0.65, 0.2] });
        }
      } else {
        // hurdles: three raking boards behind a picket
        for (let k = 0; k < 3; k++) {
          A.add('wood_prop', BOX_THIN(A), LL(IDENT, q.x, floor + 0.3 + k * (h / 3.1), q.z,
            yaw + rng.range(-0.03, 0.03), 0.08, 0.19, len * 0.98), { masks: [0.85, 0.6, 0.25] });
        }
        if (i % 4 === 1) {
          A.add('metal_rust', BOX_THIN(A), LL(IDENT, q.x - p.nx * side * 0.07, floor + h / 2 + 0.15, q.z - p.nz * side * 0.07,
            yaw, 0.06, h + 0.4, 0.06), { masks: [0.9, 0.7, 0] });
        }
      }
    }

    // ---- the fire step, on the side that faces the enemy --------------------
    {
      const e = at(L, s, sd * (HALF - STEP_W / 2));
      A.add('dirt', BOX(A), LL(IDENT, e.x, floor + STEP_H / 2, e.z, yaw, STEP_W, STEP_H, len), {
        masks: [0.3, 0.7, 0.45],
      });
      A.box('dirt', e.x, floor + STEP_H / 2, e.z, STEP_W, STEP_H, len);
      if (i % 2 === 0) {
        A.add('wood_prop_dark', BOX_FINE(A), LL(IDENT, e.x, floor + STEP_H + 0.03, e.z, yaw,
          STEP_W * 0.92, 0.06, len * 0.9), { masks: [0.85, 0.7, 0.3] });
        /**
         * ON THE CREST OF THE PARAPET, and the height comes from `section` for
         * exactly that reason. Placed at `g + PARAPET` on a fixed offset they
         * sat three quarters of a metre in the air over the CHEEK, which is
         * still 0.4 m below the plain there — photographed from inside the
         * trench, a row of sandbags floating against the sky.
         */
        const bd = sd * (HALF + WALL_W + BERM_W * 0.35);
        const b = at(L, s, bd);
        const by = groundY(b.x, b.z) + section(bd, depth, sd);
        for (let k = 0; k < 2; k++) {
          A.put(rng.pick(['sandbag_a', 'sandbag_b', 'sandbag_c']),
            b.x + rng.range(-0.2, 0.2), by + 0.09 + k * 0.18, b.z + rng.range(-0.2, 0.2),
            yaw + rng.range(-0.18, 0.18), rng.range(0.95, 1.15));
        }
      }
    }
  }

  for (const e of exits) {
    if (e.kind === 'sally') sallySteps(A, rng, bay, groundY, e.s);
    else dugout(A, rng, bay, groundY, e.s);
  }

  // ---- what a held trench accumulates -------------------------------------
  const stores = Math.round((s1 - s0) / 9);
  for (let i = 0; i < stores; i++) {
    const s = s0 + ENTRY + rng.float() * (s1 - s0 - ENTRY * 2);
    const q = at(L, s, rng.range(-HALF + 0.7, HALF - 0.7));
    const g = groundY(q.x, q.z) - depthAt(s);
    A.put(rng.pick(['crate_b', 'box_card_b', 'jerry_can', 'bucket', 'sandbag_b', 'plank_a']),
      q.x, g + 0.16, q.z, rng.float() * 6.28, rng.range(0.85, 1.1));
  }

  // ---- wire pickets and a coil of it, out on the parapet facing the enemy --
  {
    const pickets = Math.max(2, Math.round((s1 - s0) / 5));
    for (let i = 0; i < pickets; i++) {
      const s = s0 + ((i + 0.5) / pickets) * (s1 - s0);
      const depth = depthAt(s);
      if (depth < DEPTH * 0.7) continue;
      const pd = sd * (HALF + WALL_W + BERM_W + rng.range(0.6, 2.6));
      const q = at(L, s, pd);
      const g = groundY(q.x, q.z) + section(pd, depth, sd);
      A.add('metal_rust', BOX_THIN(A), LL(IDENT, q.x, g + 0.52, q.z, rng.float() * 6.28,
        0.07, 1.05, 0.07, rng.range(-0.12, 0.12), rng.range(-0.12, 0.12)), { masks: [0.9, 0.7, 0] });
      for (let k = 0; k < 3; k++) {
        A.add('metal_rust', BOX_THIN(A), LL(IDENT, q.x + rng.range(-0.5, 0.5), g + 0.35 + k * 0.26,
          q.z + rng.range(-0.5, 0.5), rng.float() * 6.28, rng.range(0.7, 1.9), 0.022, 0.022,
          rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)), { masks: [0.95, 0.75, 0] });
      }
    }
  }

  // ---- spoil and boot-churn on the parapet and the floor ------------------
  for (let i = 0; i < Math.round((s1 - s0) * 0.6); i++) {
    const s = s0 + rng.float() * (s1 - s0);
    const dd = rng.range(-HALF - WALL_W - BERM_W, HALF + WALL_W + BERM_W);
    const q = at(L, s, dd);
    const g = groundY(q.x, q.z) + section(dd, depthAt(s), sd);
    const patch = patchGeometry(rng, rng.range(0.4, 1.5), { lobes: 10, wobble: 0.55 });
    A.addOnce(rng.float() < 0.55 ? 'steppe_bare' : 'road_dust', patch,
      LL(IDENT, q.x, g + 0.04, q.z, rng.float() * 6.28, 1, 1, rng.range(0.6, 1.3)),
      { masks: [0.35, rng.range(0.45, 0.95), 0.35] });
  }
}

/**
 * THE SALLY RAMP'S TREADS. The slope itself is `section`'s — this is what a
 * working party would have pinned to it so it is not a mudslide: six risers of
 * board held by pickets, and a handrail of scaffold pipe on the low side.
 * Nothing here carries collision: the RAMP is the ground, and a tread that
 * collided would be a 6 cm step every 70 cm on the one way out.
 */
function sallySteps(A, rng, bay, groundY, sc) {
  const { L, spec } = bay;
  const sd = -spec.fireSide;
  const run = DEPTH / RAMP_GRADE;
  const p = at(L, sc);
  for (let k = 0; k < 7; k++) {
    const t = (k + 0.5) / 7;
    const d = sd * (HALF + run * t);
    const q = at(L, sc, d);
    const y = groundY(q.x, q.z) - DEPTH + run * t * RAMP_GRADE;
    A.add('wood_prop_dark', BOX_THIN(A), LL(IDENT, q.x, y + 0.03, q.z, p.yaw,
      SALLY_W * 0.82, 0.06, 0.26), { masks: [0.85, 0.7, 0.3] });
    if (k % 2 === 0) {
      for (const e of [-1, 1]) {
        const r = at(L, sc + e * SALLY_W * 0.42, d);
        A.add('wood_prop', BOX_THIN(A), LL(IDENT, r.x, y + 0.16, r.z, p.yaw, 0.09, 0.3, 0.09),
          { masks: [0.8, 0.6, 0.2] });
      }
    }
  }
  // the handrail, on the uphill edge, and a sign the way out is used
  for (let k = 0; k < 4; k++) {
    const t = k / 3;
    const d = sd * (HALF + 0.3 + (run - 0.6) * t);
    const q = at(L, sc - SALLY_W * 0.45, d);
    const y = groundY(q.x, q.z) - DEPTH + (0.3 + (run - 0.6) * t) * RAMP_GRADE;
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, q.x, y + 0.52, q.z, p.yaw, 0.06, 1.04, 0.06),
      { masks: [0.9, 0.7, 0] });
  }
  const b = at(L, sc, sd * (HALF + run - 0.5));
  A.put('sandbag_a', b.x, groundY(b.x, b.z) - 0.06, b.z, p.yaw, 1.05);
}

/**
 * A DUGOUT. Four metres of the rear wall taken back 1.9 m by `section`, and
 * this is what stands in the hole it leaves: a roof of baulks with the spoil
 * back on top of it, four posts, a bunk of boards and wire, and the stores a
 * section keeps where the rain does not reach.
 *
 * THE ROOF IS FLUSH WITH THE PLAIN AND CARRIES COLLISION, and both halves of
 * that are the nav decision in the header: the height field's ray finds it at
 * the height the ground it replaced was, so the cell over a dugout is the plain
 * — nothing carved, nothing stranded, no second floor anywhere. Underneath,
 * 1.65 - 0.25 = 1.40 m of headroom, which is a crouch.
 */
function dugout(A, rng, bay, groundY, sc) {
  const { L, spec } = bay;
  const sd = -spec.fireSide;
  const p = at(L, sc);
  const mid = HALF + DUG_D * 0.5 + 0.05;
  const c = at(L, sc, sd * mid);
  const gy = groundY(c.x, c.z);
  const floor = gy - DEPTH;

  // the roof: baulks, then a slab of spoil, top flush with the plain
  const roofW = DUG_D + 0.1;
  A.add('wood_prop_dark', BOX(A), LL(IDENT, c.x, gy - ROOF_T * 0.62, c.z, p.yaw, roofW, 0.16, DUG_W + 0.3),
    { masks: [0.8, 0.7, 0.25] });
  A.add('dirt', BOX(A), LL(IDENT, c.x, gy - ROOF_T * 0.16, c.z, p.yaw, roofW + 0.2, 0.1, DUG_W + 0.5),
    { masks: [0.35, 0.72, 0.45] });
  A.box('dirt', c.x, gy - ROOF_T / 2, c.z, roofW + 0.2, ROOF_T, DUG_W + 0.5, p.yaw);
  // …and the baulks read as baulks from underneath
  for (let k = 0; k < 6; k++) {
    const q = at(L, sc - DUG_W * 0.42 + (DUG_W * 0.84 * k) / 5, sd * mid);
    A.add('wood_prop', BOX_THIN(A), LL(IDENT, q.x, gy - ROOF_T - 0.07, q.z, p.yaw, roofW * 0.96, 0.11, 0.17),
      { masks: [0.85, 0.62, 0.22] });
  }
  // four posts, so it is standing on something
  for (const es of [-1, 1]) {
    for (const ed of [0.12, 0.9]) {
      const q = at(L, sc + es * DUG_W * 0.42, sd * (HALF + DUG_D * ed));
      A.add('wood_prop_dark', BOX_THIN(A), LL(IDENT, q.x, floor + (gy - ROOF_T - floor) / 2, q.z, p.yaw,
        0.13, gy - ROOF_T - floor, 0.13), { masks: [0.8, 0.6, 0.2] });
    }
  }
  // the back wall, revetted, and a bunk against it
  {
    const q = at(L, sc, sd * (HALF + DUG_D));
    A.add('corrugated', BOX_THIN(A), LL(IDENT, q.x, floor + 0.66, q.z, p.yaw, 0.06, 1.32, DUG_W * 0.94),
      { masks: [0.9, 0.75, 0.25] });
    const b = at(L, sc + 0.5, sd * (HALF + DUG_D * 0.62));
    A.add('wood_prop', BOX_FINE(A), LL(IDENT, b.x, floor + 0.42, b.z, p.yaw, DUG_D * 0.6, 0.08, 1.9),
      { masks: [0.85, 0.65, 0.28] });
    for (const es of [-0.85, 0.85]) {
      const l = at(L, sc + 0.5 + es, sd * (HALF + DUG_D * 0.62));
      A.add('wood_prop_dark', BOX_THIN(A), LL(IDENT, l.x, floor + 0.2, l.z, p.yaw, DUG_D * 0.5, 0.4, 0.1),
        { masks: [0.8, 0.6, 0.2] });
    }
  }
  // what lives in it
  for (let k = 0; k < 4; k++) {
    const q = at(L, sc + rng.range(-1.6, 1.6), sd * (HALF + rng.range(0.3, 1.6)));
    A.put(rng.pick(['crate_b', 'jerry_can', 'bucket', 'box_card_b', 'sandbag_c']),
      q.x, floor + 0.16, q.z, rng.float() * 6.28, rng.range(0.8, 1.05));
  }
  // a stove pipe out through the spoil, which is how you find one at night
  {
    const q = at(L, sc - DUG_W * 0.3, sd * (HALF + DUG_D * 0.85));
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, q.x, gy + 0.34, q.z, 0, 0.11, 0.9, 0.11), { masks: [0.9, 0.7, 0] });
  }
}
