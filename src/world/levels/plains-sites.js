import * as THREE from 'three';
import { BOX, BOX_FINE, BOX_SOFT, BOX_THIN, IDENT, LL } from '../kit.js';
import { fbm3, paintMasks } from '../util.js';
import { Rng } from '../../core/rng.js';
import {
  RAMP_GRADE, octagon, edgeInfo, prism, ramp, interiorVolume, ladder, practical,
} from './plains-works.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD — THE CAPTURE SITES. 「占領サイトはもっと特徴的にしろ」
 * ════════════════════════════════════════════════════════════════════════════
 * Four of this map's five capture points were the same object: a flattened pad
 * of open grass with painted ground and a beacon on it. Only D had anything —
 * the control tower 32 m north of it and the fortress 48 m south — and D is the
 * only zone a player can name from across the plain. That is the complaint, and
 * it is a READABILITY problem before it is a decoration one: the zones here are
 * 154-314 m apart on a night map, so a man who has just crested a swell has to
 * be able to say WHICH ONE he is looking at from the silhouette alone, before
 * he decides whether to go there.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT EACH ZONE IS NOW, AND HOW YOU TELL IT FROM THE OTHERS AT 150 m
 * ────────────────────────────────────────────────────────────────────────────
 *   A, B   THE EMP STATIONS — a compact octagonal redoubt inside the field,
 *          four coil pylons standing outside the wall on the diagonals, and a
 *          generator set cabled to them. READ: a green dome with a hard-edged
 *          walled ring inside it and four masts around the outside.
 *   C      THE TANK FARM — four fuel silos with conical tops, one of them
 *          ruptured and burning. READ: the only fat cylinders on the map, and
 *          the only capture point that carries its OWN light. On a plain lit by
 *          a burning ridge, "the zone with the fire in it" is the strongest cue
 *          this map has and the one that survives being 200 m away.
 *   E      THE PYLON LINE — four steel transmission towers marching through the
 *          zone with their conductors slung between them, and a fifth down
 *          across the ground. READ: a skeletal comb on the skyline and cables
 *          against the cloud, which is a silhouette nothing else here makes.
 *   D      unchanged. The tower and the fortress are `plains-tower.js` and
 *          `plains-fort.js` and this file does not touch either.
 *
 * A AND B DELIBERATELY GET THE SAME STATION, and it is not a shortcut. They are
 * the FURTHEST PAIR on the map — 315 m apart on opposite corners, one on each
 * side's flank — so a player is never choosing between them and confusing the
 * two would mean being lost by half a map. What they have to be distinguishable
 * FROM is C, E and D, and a walled redoubt is none of those. What they gain by
 * being a matched pair is INFORMATION: two identical installations under two
 * identical domes read as "the two EMP stations", which is what the field is
 * for. They are exact images of each other, so neither side gets the better
 * fort — the same property `PLAINS_SPAWNS` is built to have.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE RULES THIS ENGINE PUNISHES, AND WHERE EACH IS ANSWERED
 * ────────────────────────────────────────────────────────────────────────────
 * 1. `NavGrid` IS A 2.5D HEIGHT FIELD — one floor per 0.8 m cell, found by one
 *    downward ray, `maxStep` 0.45 m, slope limit 46°. @see the header of
 *    `plains-works.js`. Everything standing here is built to one of exactly
 *    four patterns and there is no fifth:
 *
 *      NESTED ANNULUS    the redoubt. The rampart's top IS the walk and nothing
 *                        stands over it, so the ray finds one surface at the
 *                        height a man there would be. Reached by RAMPS at
 *                        `RAMP_GRADE` 0.38, never stairs.
 *      STEEPER THAN 46°  the silo cones (52°), the generator's cap (52°) and
 *                        the coil caps. A surface past the slope limit yields
 *                        NO walkable cell, which is how a 9 m tank stands on
 *                        this map without being a sky island. It is the same
 *                        problem the barrack shed at D had to be hollowed for,
 *                        solved with geometry instead of surgery.
 *      DRAWN ONLY        every member above 2.4 m on the pylons, the cables,
 *                        the pipe mains and all the bracing. `A.add` is VISUAL;
 *                        collision is a separate `A.box`/`A.collideGeo` call.
 *                        A member with no proxy is invisible to the height
 *                        field's ray AND to `_sealCrossings`, which is exactly
 *                        right for mass that is 15 m over open ground, and
 *                        exactly wrong for anything a man can touch — so
 *                        everything under 2.4 m is solid.
 *      CONTINUOUS WITH   the fallen pylon, which lies as a 6° ramp off the
 *      THE GROUND        plain rather than as a 1.6 m slab dropped on it.
 *
 *    `LAYER.CLIP` IS DELIBERATELY NOT USED, and it is worth naming why, because
 *    it looks like the tool for this job. Clip geometry is invisible to
 *    `MASK.WORLD`, and `NavGrid._sealCrossings` raycasts on `MASK.WORLD` — so a
 *    clipped mass neither creates a walkable top NOR blocks a route through
 *    itself, and A* walks men into it and the capsule stops dead. It is for
 *    OVERHANGS over ground that genuinely is walkable, which is not what
 *    anything here is.
 *
 * 2. PROPS IN DOORWAYS HAS SHIPPED FIVE TIMES ON THIS PROJECT. The answer taken
 *    is to put NOTHING in a gate passage rather than to keep a clearance list in
 *    step with a prop table: the passages are 5.2 m of empty concrete, and the
 *    only things in a courtyard are the two ramps, which ARE the floor.
 *
 * 3. NOTHING MAY STAND 0.42-0.68 m PROUD (「石ころオブジェが移動の妨げです、ジャンプ
 *    しないと乗り越えられない」). Every footing, kerb, sill and hardstanding here is
 *    either at or under 0.34 — inside the stance step, walked over without a
 *    jump — or over 0.9, which is a wall you walk round. There is no third case
 *    and `_scatterblock.mjs` is the gate.
 *
 * 4. A DRAWN-ONLY ROOF READS AS "A CEILING THAT MAKES NO SENSE"
 *    (「天井みたいな意味のわからないグラフィックが多い」). Nothing in this file has an
 *    interior, claims to have one, or puts a surface over a player's head that
 *    he cannot get on top of or under. The generator set is SOLID, the silos are
 *    SOLID, and the only thing carried over a head anywhere here is 0.4 m of
 *    gate lintel with a walk on top of it that you can stand on.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THESE ARE NOT BOMBING TARGETS, AND THAT NEEDS SIGNING OFF RATHER THAN ASSUMING
 * ────────────────────────────────────────────────────────────────────────────
 * The live rule is that the line bombardment must stay outside every RESOLVED
 * capture circle + 24 m, with one carve-out the player made himself —
 * 「破壊オブジェ＋占領サイトの場所には落としてもいい」 — for a DESTRUCTIBLE structure
 * that coincides with a site, which is what lets the tower and the fortress at D
 * be shelled where they stand.
 *
 * NOTHING IN THIS FILE PUBLISHES A DESTROYED STATE, so nothing here takes that
 * carve-out and the bombardment rule is untouched: A, B, C and E are exactly as
 * bomb-proof today as they were yesterday. That is the conservative reading and
 * it is deliberately the one taken WITHOUT asking, because the alternative
 * changes where live shells fall on four of the five capture points. If these
 * should be shellable, each needs a `shell`/`ruin` scope pair and a
 * `publishWorks` record — the machinery is already there and `plains-fort.js` is
 * the worked example — and it is the player's call, not this file's.
 */

// ═════════════════════════════════════════════════════════════ the redoubt ══
/**
 * COMPACT — 「ENPドームのところは要塞にしろ コンパクトな要塞」 — and every number is
 * smaller than the fortress at D by design rather than by accident:
 *
 *                        D's fortress      this redoubt
 *   across the flats         60 m              40 m
 *   rampart thickness        6.0 m             4.4 m
 *   height to the walk       4.4 m             3.2 m
 *   courtyard               48 m across      31 m across
 *   gatehouses, magazine,
 *   barrack, gun pit, wire    yes              none
 *
 * THE COURTYARD IS SIZED OFF THE CAPTURE CIRCLE AND NOTHING ELSE.
 * `MAP_RULES.plains.captureRadius` is 14 m, so the inner face has to stand clear
 * of 14 m or the bar is fought over from on top of a wall: R_IN is 15.6, which
 * puts the whole circle on the courtyard floor with 1.6 m to spare. Shrinking
 * the redoubt further would start eating the objective, which is the floor on
 * how compact "compact" can be here.
 *
 * AND IT IS SIZED OFF THE PAD, WHICH IS WHAT MAKES IT BUILDABLE. `PADS['A']`
 * holds the ground DEAD LEVEL inside r0 = 16 and blends out to r1 = 34, so the
 * courtyard is flat by construction rather than by measurement, while the trace
 * at r 20 crosses ground that MEASURES 0.83 m of fall at A and 0.38 m at B
 * (`_padring.mjs`). The rampart mass is therefore sunk 2.6 m below the datum:
 * its top is one level plane wherever you stand on it and its bottom is BURIED
 * on the high side rather than floating on the low one. Floating rubble has
 * shipped four times on this map; a floating fortress would be the fifth.
 */
const R_OUT = 20;
const CUT = 6.0;
const RAMP_T = 4.4;
const R_IN = R_OUT - RAMP_T;
const WALK_Y = 3.2;
/** How far the mass runs BELOW the datum, so the low side is buried. @see above. */
const FOOT_Y = -2.6;
const PARAPET_H = 1.25;
/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE PARAPET IS THE ONE PART OF THIS THAT FIGHTS THE HEIGHT FIELD, AND THE
 * COPING IS THE ANSWER
 * ────────────────────────────────────────────────────────────────────────────
 * A parapet top is a flat surface 1.25 m over the walk with open sky above it,
 * so `NavGrid` calls every cell whose centre lands on it walkable and NO
 * neighbour is inside `maxStep` of it — each one is a one-cell island. MEASURED
 * on the first cut of this file, with a 0.5 m parapet under a flat 0.62 m
 * coping: stranded cells within 45 m of the zone centre went 16 -> 246 at A and
 * 25 -> 256 at B (`_sitenav.mjs`), 143 and 154 of them above the courtyard.
 *
 * SO THE COPING IS PITCHED PAST THE SLOPE LIMIT, which is what a coping is for
 * in life as well — it throws the rain clear of the face. It is a 0.62 x 0.18 m
 * section ROLLED 55° about its own long axis, which puts its wide faces at 55°
 * (refused: over the 46° limit) and leaves only the 0.18 m edge presenting an
 * upward face — a 0.10 m horizontal strip against an 0.8 m lattice. The body
 * under it is 0.36 m, narrower than the coping's 0.50 m horizontal extent, so
 * the body is never what the ray lands on.
 *
 * `LL`'s `rz` is the roll and it is applied FIRST, in object space, before the
 * yaw — which is why the section rolls about the wall's own run rather than
 * about a world axis. @see the same idiom in `member`.
 *
 * IT DOES NOT REACH ZERO AND IS NOT CLAIMED TO. What is left is measured in the
 * commit, and what is left is escape components rather than traps:
 * `NavGrid._measureDrops` gives a man who ends up on a coping a one-way fall
 * back on to his own walk. D's fortress, which has a flat coping, carries 559
 * stranded cells inside the same 45 m radius — this is the comparison that
 * matters and it is the reason the shape changed rather than the size.
 */
const PARAPET_T = 0.36;
const COPING_W = 0.62;
const COPING_T = 0.18;
const COPING_ROLL = 0.96;
/** Outer width of a gate passage. It narrows inward with the trace; @see `gate`. */
const GATE_W = 5.2;
const GATE_H = 2.8;
/** How far a bastion projects past the trace on its chamfer. */
const BASTION = 4.0;
/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE STATION IS SET BACK FROM ITS PAD, AND THAT NUMBER IS THE MAP BOUNDARY
 * ────────────────────────────────────────────────────────────────────────────
 * 「平原ちゃんと物理的に範囲外に行けないようにして」 — and the first cut of this file
 * reopened it. `boundcheck` on the finished tree: 115 282 m² of void, 64/64
 * bearings ending outside the map, two crossings, BOTH on zone A's redoubt at
 * floor y 3.61 in `concrete`. The flood's own walk, traced cell by cell
 * (`_nfpath.mjs`), is eight words long:
 *
 *     ramp -> walk -> out along the rampart to r 177.3, 3.61 m up
 *     [-145.6, -102.4]  r 178.0   y 4.77  dirt   <- MANTLE 1.16 m, on to the
 *                                                   crest of the rim's clip wall
 *     [-146.4, -103.2]  r 179.1   y -1.03 dirt   <- STEP OFF 5.80 m, outside
 *
 * `MOVE.mantle.maxHeight` is 1.85 and the step-off limit is 6.0, so both moves
 * are legal and the whole plateau behind the mountain opens.
 *
 * THE RIM IS NOT AT FAULT AND MUST NOT BE CHANGED TO FIX THIS. Read the head of
 * `plains-rim.js`: its wall is `RISE` = 5.6 m over the HIGHEST GROUND A MAN CAN
 * BE STANDING ON AGAINST IT, and 5.6 is three times the mantle precisely so that
 * standing on something does not defeat it. It is 0.62 m thick because a
 * boundary thicker than `cell - 0.63` is one `boundcheck` walks through the
 * middle of, and it is on `LAYER.CLIP` because zones here are 154-314 m apart
 * and a barrier that stopped bullets would be worse than the hole. Every one of
 * those three numbers is load-bearing and none of them can absorb a rampart:
 * what defeated it was a man standing 4.4 m above the terrain beside it, which
 * is not a case "the highest ground" was ever measured over.
 *
 * SO THE FIX IS HORIZONTAL, NOT VERTICAL, and deliberately so. Height margins
 * here are all marginal — the crest at A measures 4.5-4.8 m against a walk at
 * 3.61, and shrinking that gap past 1.85 m would mean cutting `WALK_Y` to about
 * 1.7 and the fortress with it. Distance is not marginal: the crest only exists
 * in the 0.62 m band at r 178.0-178.6, `boundcheck`'s diagonal mantle reach is
 * `MOVE.mantle.reach` 1.05 m, and its step is one 0.8 m cell. Keep every
 * walkable surface this file builds more than 2 m short of that band and the
 * crest is unreachable AT ANY HEIGHT — which is a property that survives the
 * terrain moving, survives zone B (whose identical redoubt is 0.5 m lower and
 * escaped by luck rather than by design), and survives the next pad somebody
 * adds. MEASURED after: the outermost walkable cell of the station is r 175.9,
 * 2.1 m short of the nearest crest cell.
 *
 * `INSET` is how that is bought. The whole station — trace, gates, ramps,
 * parapet, bastions, masts and generator — is one object slid `INSET` metres
 * back along its own -Z, i.e. toward the middle of the map. It comes out of the
 * courtyard's own slack and nothing else: `R_IN` is 15.6 against a 14 m capture
 * circle, so 1.3 m of set-back still leaves the whole circle standing on level
 * courtyard with 0.3 m to spare, which is the property `R_IN` was chosen for
 * and the floor on how far this can go. THE PAD IS NOT MOVED and the capture
 * point is not moved; only the masonry round it is.
 */
const INSET = 1.3;
/**
 * WHICH CHAMFERS CARRY A BASTION — and the two that no longer do are the two
 * that pointed at the cliff.
 *
 * A bastion is 4 m of projection, and at a pad 157.3 m out on a 176 m disc the
 * two OUTBOARD ones put their far corners at r 180.9 — three metres past the rim
 * wall, on the mountain flank, which is where `_nfbelt.mjs` found built concrete
 * on 42 of 720 bearings. They also had nothing to do: the file's own argument
 * for the shape is that "a fortification with square corners has four bearings
 * it cannot shoot along", and the two bearings these covered are the cliff face
 * 2 m behind them. The four flats and the two inboard chamfers still enfilade
 * every approach that exists. Edges 0 and 6 are the chamfers on the -Z side;
 * @see `octagon`.
 */
const BASTION_EDGES = [0, 6];
/** Where the coil pylons stand, and how tall. Inside the 34 m field, outside the wall. */
const COIL_R = 26;
const COIL_H = 12.5;

/**
 * Local -> world for one station: a Y rotation about the pad centre, then the
 * offset. Matches three's Y-rotation sense, so a yaw handed to `LL` and a point
 * handed to this agree about which way round the structure is.
 */
function placer(pad, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return (lx, lz) => [pad.x + lx * c + lz * s, pad.z - lx * s + lz * c];
}

/**
 * A TILTED MEMBER, in the one idiom this map already uses (@see `fallenMember`
 * in plains-works.js): the long axis is local +Z, `yaw` swings it in plan and
 * `pitch` tips it out of the horizontal. Every strut, leg, cable and pipe here
 * goes through this, so there is exactly one place the trigonometry can be
 * wrong — which is the mistake the first cut of this file made in four
 * different ways.
 *
 * `solid` gives it a collision box as well. DEFAULT OFF, because `A.add` is
 * visual only and most of what is drawn here is 15 m over somebody's head.
 */
function member(A, key, x0, y0, z0, x1, y1, z1, w, opts = {}) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const flat = Math.hypot(dx, dz);
  const len = Math.hypot(flat, dy);
  const yaw = Math.atan2(dx, dz);
  const pitch = -Math.atan2(dy, flat);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  A.add(key, opts.thin === false ? BOX(A) : BOX_THIN(A),
    LL(IDENT, cx, cy, cz, yaw, w, opts.h ?? w, len, pitch),
    { masks: opts.masks ?? [0.76, 0.48, 0.1] });
  if (opts.solid) A.box(opts.surface ?? 'metal', cx, cy, cz, w, opts.h ?? w, len, yaw, pitch);
  return { len, yaw, pitch };
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * A FOOTING, AND WHY IT IS A STUB RATHER THAN AN APRON
 * ────────────────────────────────────────────────────────────────────────────
 * 「石ころオブジェが移動の妨げです、ジャンプしないと乗り越えられない」 — nothing on this
 * map may stand 0.42-0.68 m proud of the ground, and the first cut of this file
 * broke that rule in the one way that is invisible on a plan: it laid FLAT
 * SLABS on SLOPING GROUND. A 4.6 m concrete apron under a coil pylon and a
 * 12.8 x 9.2 m one under a generator set are level by construction and the
 * ground under them is not — outside the pads' r0 = 16 flat, the blend to r1 =
 * 34 falls 0.26 m per metre, so a 4.6 m apron spans 1.2 m of ground and a
 * 12.8 m one spans 3.3 m. Somewhere along every one of those edges the slab
 * crosses the forbidden band, and the strip where it does is a wall a walking
 * man has to jump.
 *
 * A SLAB CANNOT BE SIZED OUT OF THE PROBLEM, only out of one slope. So the
 * apron is gone and each leg gets its own STUB: 1.3 m square, its top 0.95 m
 * over the ground AT ITS OWN FOOT and 1.6 m of it buried. 0.95 is decisively
 * over the band rather than decisively under it, which is the right side to be
 * on for something 1.3 m across — a man walks ROUND a stub, and the worst a
 * cross-slope can do to it is make it taller. It is also what a pylon footing
 * actually is.
 */
function stub(A, groundY, x, z, w, yaw) {
  const gy = groundY(x, z);
  A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, x, gy + 0.95 - 1.3, z, yaw, w, 2.5, w),
    { masks: [0.58, 0.42, 0.16] });
  A.box('concrete', x, gy + 0.95 - 1.3, z, w, 2.5, w, yaw);
}

/**
 * The eight quads that tile the rampart, as an outer octagon and an inner one.
 * An annulus cannot be a `prism` — that takes one closed trace and FILLS it —
 * so the ring is built edge by edge, which is also what makes a gate a matter of
 * leaving one quad out in two pieces rather than of cutting a hole in a solid.
 * The winding matches `octagon`'s so the outward faces come out outward; @see
 * the mirroring warning in `prism`.
 */
function ring(outer, inner) {
  const out = [];
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length;
    out.push([outer[i], outer[j], inner[j], inner[i]]);
  }
  return out;
}

/** Cut a ring quad down to the span [t0, t1] along both of its long edges. */
function slice(q, t0, t1) {
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return [lerp(q[0], q[1], t0), lerp(q[0], q[1], t1), lerp(q[3], q[2], t1), lerp(q[3], q[2], t0)];
}

/**
 * ONE EMP STATION. Returns the `interiorVolume` records without which the
 * courtyard is a 31 m island with the capture point inside it and no way in:
 * the ray from the sky hits the walk carried over each passage, so both gates
 * come back as 3.2 m of solid rampart and A* is asked to path into a sealed box.
 *
 * Publishing a volume there is legal for the same reason it is legal at D's
 * gates and illegal under its rampart — the re-probe REPLACES the floor of every
 * cell in the box, and what it replaces at a gate is four square metres of a
 * walk that is a RING reached from two ramps.
 */
function empStation(A, groundY, pad, seed) {
  const rng = new Rng(seed);
  const Y0 = groundY(pad.x, pad.z);
  const y = (v) => Y0 + v;
  /**
   * One gate faces the middle of the map and the other faces out of it, so the
   * station is oriented to the FIGHT rather than to the axes. Local -Z is the
   * gate face; a three Y rotation maps local (0, -1) to (-sin θ, -cos θ), so θ
   * falls straight out of the bearing from the pad to the origin.
   */
  const len = Math.hypot(pad.x, pad.z) || 1;
  const yaw = Math.atan2(pad.x / len, pad.z / len);
  const P = placer(pad, yaw);
  /**
   * THE STATION'S OWN ORIGIN, `INSET` metres inboard of the pad's. EVERYTHING
   * this function places goes through `Q` and nothing goes through `P` — the
   * fort, the masts and the generator set are one installation and sliding half
   * of it would leave a mast standing in a rampart. @see `INSET`.
   */
  const Q = (lx, lz) => P(lx, lz - INSET);

  const outer = octagon(R_OUT, CUT).map(([x, z]) => Q(x, z));
  const inner = octagon(R_IN, CUT * (R_IN / R_OUT)).map(([x, z]) => Q(x, z));
  const quads = ring(outer, inner);
  /** Edges 3 and 7 are the flats normal to local Z: the gates. @see `octagon`. */
  const GATES = [3, 7];
  /** Edges 1 and 5 are the flats normal to local X: the ramps run inside these. */
  const RAMPS = [1, 5];
  const volumes = [];

  // ── the rampart ─────────────────────────────────────────────────────────
  for (let i = 0; i < quads.length; i++) {
    const q = quads[i];
    if (!GATES.includes(i)) { prism(A, 'concrete', q, y(FOOT_Y), y(WALK_Y)); continue; }
    // …and the two that carry a gate, as a pair of piers with a passage between
    // them. The gap is struck on the OUTER edge and carried through at the same
    // parameter, so the passage splays inward with the trace — which is what a
    // real gate does, and costs nothing here.
    const half = (GATE_W / 2) / Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
    prism(A, 'concrete', slice(q, 0, 0.5 - half), y(FOOT_Y), y(WALK_Y));
    prism(A, 'concrete', slice(q, 0.5 + half, 1), y(FOOT_Y), y(WALK_Y));
    volumes.push(gate(A, groundY, q, y, yaw));
  }

  // ── the bastions, on the two inboard chamfers ───────────────────────────
  // Their tops are at WALK_Y too, so a bastion is MORE WALK rather than a second
  // surface over one: the nested-annulus rule holds across the join, and a
  // fortification with square corners has four bearings it cannot shoot along,
  // which is the reason the shape was invented. @see `BASTION_EDGES` for why the
  // two that faced the map edge are gone.
  for (const i of BASTION_EDGES) {
    const e = edgeInfo(outer, i);
    const a = outer[i], b = outer[(i + 1) % outer.length];
    prism(A, 'concrete', [
      a, [a[0] + e.nx * BASTION, a[1] + e.nz * BASTION],
      [b[0] + e.nx * BASTION, b[1] + e.nz * BASTION], b,
    ], y(FOOT_Y), y(WALK_Y));
  }

  parapet(A, rng, outer, y);

  // ── two ramps up off the courtyard floor ────────────────────────────────
  for (const i of RAMPS) {
    const e = edgeInfo(inner, i);
    const run = WALK_Y / RAMP_GRADE;
    const w = 3.2;
    // Laid along the inner face, half a width in from it, so the top landing's
    // outer edge lands EXACTLY on the walk's inner edge and the two are the same
    // height in adjacent cells — which is the whole of why a bot can get up here.
    const cx = e.mx - e.nx * (w / 2), cz = e.mz - e.nz * (w / 2);
    ramp(A, rng, 'concrete',
      cx - e.tx * (run / 2), cz - e.tz * (run / 2), y(0),
      cx + e.tx * (run / 2), cz + e.tz * (run / 2), y(WALK_Y), w, { baseY: y(FOOT_Y) });
  }

  // ── what the field is FOR ───────────────────────────────────────────────
  // On the station's own diagonals, through `Q`: `P(sin a·R, cos a·R)` and
  // `pad + (sin(a+yaw), cos(a+yaw))·R` are the same point, so this is the same
  // ring the first cut drew, moved with the rest of the installation.
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * (Math.PI / 2);
    const [px, pz] = Q(Math.sin(a) * COIL_R, Math.cos(a) * COIL_R);
    coilPylon(A, groundY, px, pz, groundY(px, pz), yaw + a);
  }
  /**
   * THE GENERATOR SET IS ON THE FLANK, NOT OUT THE BACK, and that is the second
   * half of the boundary fix rather than a dressing choice. At `Q(0, COIL_R)` it
   * stood at r 183.3 — five metres OUTSIDE the rim wall, a 10.4 x 6.8 m block of
   * concrete and a live point light sitting on the mountain flank behind the
   * cliff, where no player can reach it and every player can see it. It is also
   * thick enough that `boundcheck`'s surface test walks the inside of it
   * (@see the header of `tools/boundcheck.mjs`), so it was a hole in the gate as
   * well as a hole in the fiction. Local -X puts it at r 158.9, clear of the
   * rampart by 4.8 m, between the two -X masts it feeds, and well inside the
   * 34 m field it powers.
   */
  const set = Q(-(COIL_R + 4), 0);
  generatorSet(A, set[0], set[1], groundY(set[0], set[1]), yaw);

  return volumes;
}

/**
 * A gate: the walk carried over a 5.2 m passage, and the `interiorVolume` that
 * is the only thing making it a way IN as far as a bot is concerned.
 *
 * THERE IS NO SILL AND THERE IS NOTHING IN THE PASSAGE, both on purpose. A
 * threshold between 0.42 and 0.68 m is the one height this map refuses, and a
 * prop in a doorway is five separate shipped bugs here; the hardstanding through
 * it is 0.12 m, which the capsule takes for free and the height field never sees
 * as an edge.
 */
function gate(A, groundY, q, y, stationYaw) {
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const o = lerp(q[0], q[1], 0.5);
  const i = lerp(q[3], q[2], 0.5);
  const cx = (o[0] + i[0]) / 2, cz = (o[1] + i[1]) / 2;
  const depth = Math.hypot(i[0] - o[0], i[1] - o[1]);
  const yaw = Math.atan2(i[0] - o[0], i[1] - o[1]);
  const roadY = groundY(cx, cz);
  const box = BOX(A);

  // the lintel — the walk, carried across, and nothing more than that
  A.add('concrete', box, LL(IDENT, cx, y(GATE_H + (WALK_Y - GATE_H) / 2), cz, yaw,
    GATE_W + 1.6, WALK_Y - GATE_H, depth + 0.2), { masks: [0.3, 0.44, 0.32] });
  A.box('concrete', cx, y(GATE_H + (WALK_Y - GATE_H) / 2), cz, GATE_W + 1.6, WALK_Y - GATE_H, depth + 0.2, yaw);

  /**
   * The hardstanding through the passage: 0.08 m, laid off the ground AT THE
   * PASSAGE rather than off the pad datum, and only as long as the passage
   * itself. The first cut ran it 12 m out through the gate at the datum height,
   * which on the pad's blend slope stands it up to 0.40 m proud at the far end —
   * inside touching distance of the 0.42 m band this map refuses. @see `stub`.
   */
  A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, cx, roadY + 0.04, cz, yaw, GATE_W - 0.4, 0.08, depth + 1.0),
    { masks: [0.62, 0.4, 0.16] });

  // …and the jambs, which is where the gate reads as a gate and not as a hole
  for (const s of [-1, 1]) {
    const jx = cx + Math.cos(yaw) * s * (GATE_W / 2 - 0.1);
    const jz = cz - Math.sin(yaw) * s * (GATE_W / 2 - 0.1);
    A.add('concrete_dark', box, LL(IDENT, jx, y(GATE_H / 2), jz, yaw, 0.36, GATE_H, depth + 0.16),
      { masks: [0.55, 0.3, 0.2] });
    A.box('concrete', jx, y(GATE_H / 2), jz, 0.36, GATE_H, depth + 0.16, yaw);
    // the leaf, swung back flat against its own pier: five bars and a stile, all
    // of it OUTSIDE the passage so nothing narrows the opening
    const lx = jx + Math.cos(yaw) * s * 1.15, lz = jz - Math.sin(yaw) * s * 1.15;
    for (let b = 0; b < 5; b++) {
      A.add('metal_rust', BOX_THIN(A), LL(IDENT, lx, y(0.4 + b * 0.52), lz, yaw, 2.1, 0.1, 0.07),
        { masks: [0.92, 0.7, 0.05] });
    }
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, jx + Math.cos(yaw) * s * 0.22, y(GATE_H / 2 - 0.2),
      jz - Math.sin(yaw) * s * 0.22, yaw, 0.14, GATE_H - 0.4, 0.14), { masks: [0.9, 0.62, 0.05] });
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE VOLUME IS ON THE STATION'S OWN AXES, AND THAT IS WORTH 60 CELLS A GATE
   * ────────────────────────────────────────────────────────────────────────
   * `interiorVolume()` hardcodes `c: 1, s: 0` because the two structures it was
   * written for stand at the plain's identity yaw. These do not — each station
   * is swung so a gate faces the middle of the map — so an AXIS-ALIGNED box big
   * enough to contain a rotated 5.2 x 4.4 m passage is 6.8 x 6.8, and
   * `_carveInteriors` REPLACES the floor of every cell in it plus a 1.6 m
   * apron. What that reaches, at a rotated gate, is the inside of the two solid
   * piers either side: those cells come back reading GROUND under 3.2 m of
   * concrete, walkable and sealed off from everything.
   *
   * MEASURED with the square box: 60 of A's 176 stranded cells were at dy = 0.0
   * and r = 16-20 m, i.e. exactly inside the rampart's own footprint
   * (`_sitewhere.mjs`). `_carveInteriors` already rotates by `c`/`s` — it maps
   * the world delta back on to the building's axes before the extent test — so
   * the fix is to hand it the yaw the station was built at and size `hw`/`hd` to
   * the passage in LOCAL units: the gates are on the two faces normal to local
   * Z, so the width is along local X.
   */
  const v = interiorVolume(
    `NF-EMP-GATE-${Math.round(cx)}-${Math.round(cz)}`,
    cx, cz, GATE_W / 2, RAMP_T / 2, y(0.01), y(GATE_H)
  );
  v.c = Math.cos(stationYaw);
  v.s = Math.sin(stationYaw);
  return v;
}

/**
 * The parapet, along the OUTER face of everything walkable, with a crenel every
 * third bay for a man to fire through standing. The inner edge of the walk is
 * left open on purpose so he can step off on to a ramp anywhere along its
 * length rather than at one authored place.
 */
function parapet(A, rng, outer, y) {
  const box = BOX(A);
  for (let i = 0; i < outer.length; i++) {
    const e = edgeInfo(outer, i);
    // a chamfer that carries a bastion has its parapet BASTION further out; one
    // that does not is a plain rampart edge and the parapet sits on the trace.
    // Reading this off `BASTION_EDGES` rather than off `i % 2` is what stops the
    // two dropped bastions leaving a parapet floating 4 m out over nothing.
    const push = BASTION_EDGES.includes(i) ? BASTION : 0;
    const mx = e.mx + e.nx * push, mz = e.mz + e.nz * push;
    const bays = Math.max(3, Math.round(e.len / 2.6));
    for (let b = 0; b < bays; b++) {
      const t = (b + 0.5) / bays - 0.5;
      const px = mx + e.tx * t * e.len - e.nx * (PARAPET_T / 2);
      const pz = mz + e.tz * t * e.len - e.nz * (PARAPET_T / 2);
      const h = (b % 3 === 2) ? PARAPET_H - 0.55 : PARAPET_H;
      const seg = (e.len / bays) - 0.12;
      A.add('concrete', box, LL(IDENT, px, y(WALK_Y + h / 2), pz, e.yaw, PARAPET_T, h, seg),
        { masks: [0.3 + rng.float() * 0.3, 0.3 + rng.float() * 0.34, 0.22] });
      A.box('concrete', px, y(WALK_Y + h / 2), pz, PARAPET_T, h, seg, e.yaw);
      // …and the pitched coping over it, which is what keeps the top off the
      // height field. @see the note on `PARAPET_T`.
      A.add('concrete_dark', BOX_FINE(A), LL(IDENT, px, y(WALK_Y + h + 0.06), pz, e.yaw,
        COPING_W, COPING_T, seg, 0, COPING_ROLL), { masks: [0.72, 0.3, 0.05] });
      A.box('concrete', px, y(WALK_Y + h + 0.06), pz, COPING_W, COPING_T, seg, e.yaw, 0, COPING_ROLL);
    }
  }
}

/**
 * A COIL PYLON — what a 34 m field is actually coming out of.
 *
 * Four stand OUTSIDE the wall on the diagonals at r 26, which is inside the
 * field (`empzone.js` derives its radius from the pad's own `r1` = 34) and clear
 * of the rampart. Outside rather than in the courtyard because the courtyard is
 * the capture circle, and the one thing that has to stay empty is the ground the
 * bar is fought over.
 *
 * THE CAP IS A CONE AT 59°, past the 46° slope limit, so the height field yields
 * nothing on top of it. That is the whole reason it is a cone rather than a
 * platform, and the same reason the silos at C have the tops they have.
 */
function coilPylon(A, groundY, x, z, gy, yaw) {
  const foot = 1.9, headR = 0.75;
  const legAt = (k, r) => {
    const a = yaw + Math.PI / 4 + k * (Math.PI / 2);
    return [x + Math.sin(a) * r, z + Math.cos(a) * r];
  };
  for (let k = 0; k < 4; k++) {
    const [bx, bz] = legAt(k, foot);
    const [tx, tz] = legAt(k, headR);
    stub(A, groundY, bx, bz, 1.3, yaw);
    member(A, 'metal_dark', bx, gy, bz, tx, gy + COIL_H, tz, 0.3,
      { thin: false, solid: true, masks: [0.74, 0.46, 0.1] });
  }
  for (let b = 1; b * 2.1 < COIL_H; b++) {
    const t = (b * 2.1) / COIL_H;
    const r = foot + (headR - foot) * t;
    const yb = gy + b * 2.1;
    for (let k = 0; k < 4; k++) {
      const p0 = legAt(k, r), p1 = legAt((k + 1) % 4, r);
      member(A, 'metal_dark', p0[0], yb, p0[1], p1[0], yb, p1[1], 0.11, { masks: [0.8, 0.5, 0.08] });
      // the X in each panel, which is what makes a lattice read as steelwork
      const rp = foot + (headR - foot) * ((b - 1) * 2.1 / COIL_H);
      const q0 = legAt(k, rp), q1 = legAt((k + 1) % 4, r);
      member(A, 'metal_dark', q0[0], yb - 2.1, q0[1], q1[0], yb, q1[1], 0.09, { masks: [0.8, 0.5, 0.08] });
    }
  }
  // the coil: six stacked rings under the cap
  for (let r = 0; r < 6; r++) {
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, x, gy + COIL_H + 0.35 + r * 0.34, z, yaw,
      2.3 - r * 0.16, 0.14, 2.3 - r * 0.16), { masks: [0.88, 0.6, 0.04] });
  }
  const capH = 2.6;
  const cap = new THREE.ConeGeometry(1.55, capH, 8, 1);
  paintMasks(cap, (px, py, pz, nx, ny, nz, out) => {
    out[0] = 0.8; out[1] = 0.55; out[2] = 0.12;
  });
  const cm = LL(IDENT, x, gy + COIL_H + 2.5 + capH / 2, z, yaw, 1, 1, 1);
  A.add('metal_dark', cap, cm, null);
  A.collideGeo('metal', cap, cm);
  cap.dispose();
  // a green tell-tale at the head, so a coil that is LIVE is readable at range.
  // Emissive body plus a deliberately SHORT light — the light budget on this map
  // is a program-cache key (@see `practical`), so what carries at 150 m is the
  // emitter and not the illumination.
  A.add('ember', BOX_SOFT(A), LL(IDENT, x, gy + COIL_H + 5.4, z, 0, 0.34, 0.34, 0.34));
}

/**
 * THE GENERATOR SET — where the coils get their power, said in geometry so the
 * field has a cause standing next to it.
 *
 * A SOLID BLOCK WITH A 52° CAP, and both halves of that are load-bearing. Solid,
 * because an interior would be a room nobody asked for with a ceiling over it,
 * and this map has just been told it has too many of those. 52°, because a flat
 * roof on a 3 m block is a walkable island in the sky.
 */
function generatorSet(A, x, z, gy, yaw) {
  const box = BOX(A);
  const hw = 5.2, hd = 3.4;
  /**
   * NO APRON, AND THE BLOCK IS SUNK. @see `stub` — a 12.8 x 9.2 m level slab on
   * the pad's blend slope crosses the 0.42-0.68 m band somewhere along every
   * edge of itself. The block runs from 1.6 m below the ground at its centre to
   * 2.1 m above it, so it is buried on the high side and a 2 m+ wall on the low
   * one: over the band at every bearing, which is the only safe place to be.
   */
  A.add('concrete', box, LL(IDENT, x, gy + 0.25, z, yaw, hw * 2, 3.7, hd * 2), { masks: [0.3, 0.46, 0.34] });
  A.box('concrete', x, gy + 0.25, z, hw * 2, 3.7, hd * 2, yaw);
  const cap = new THREE.ConeGeometry(hd * 1.3, hd * 1.66, 4, 1);
  paintMasks(cap, (px, py, pz, nx, ny, nz, out) => {
    const n = fbm3(px * 0.4, py * 0.4, pz * 0.4, 2);
    out[0] = 0.3 + n * 0.25; out[1] = 0.48 + n * 0.3; out[2] = 0.3;
  });
  const cm = LL(IDENT, x, gy + 2.1 + hd * 0.83, z, yaw + Math.PI / 4, 1, 1, 1);
  A.add('concrete', cap, cm, null);
  A.collideGeo('concrete', cap, cm);
  cap.dispose();
  // the exhaust stack and the cooling bank: the silhouette, and drawn only —
  // both are over 2.4 m or flat against a face a man cannot walk into anyway
  member(A, 'metal_rust', x + Math.cos(yaw) * (hw - 1.2), gy + 2.2, z - Math.sin(yaw) * (hw - 1.2),
    x + Math.cos(yaw) * (hw - 1.2), gy + 8.0, z - Math.sin(yaw) * (hw - 1.2), 0.5,
    { masks: [0.9, 0.6, 0.05] });
  for (let i = 0; i < 4; i++) {
    A.add('metal_dark', BOX_THIN(A), LL(IDENT,
      x - Math.cos(yaw) * (hw - 1.0 - i * 0.72), gy + 3.4, z + Math.sin(yaw) * (hw - 1.0 - i * 0.72),
      yaw, 0.14, 2.2, hd * 1.7), { masks: [0.7, 0.45, 0.12] });
  }
  // ONE real light per station, and it is green rather than warm on purpose: the
  // field's own hex is nobody's team colour (@see the header of `empzone.js`),
  // so the thing that powers it must not read as somebody's installation either.
  practical(A, x, gy + 2.6, z, 0x7dffd6, 3.2, 15, { s: 0.22, priority: 3 });
}

// ════════════════════════════════════════════════════════════ the tank farm ══
/**
 * C — THE TANK FARM. Four fuel silos ringing the capture circle at r 22, one of
 * them opened up and burning.
 *
 * THE CONE IS THE WHOLE NAV ARGUMENT. A 9 m cylinder with a flat top is a
 * hundred-cell walkable island in the sky — the town's disease, and the exact
 * thing the barrack shed at D had to be hollowed to avoid. A silo has a conical
 * top in life for reasons that have nothing to do with this, and at 52° it is
 * past `NavGrid`'s 46° limit, so the height field yields NOTHING on it while
 * `_sealCrossings` shuts the cell edges round the base against the real
 * collision. One shape, both problems.
 *
 * THEY STAND AT r 22 — outside the 14 m capture circle and off the 16 m flat —
 * so each sits on its own `groundY` with its base sunk 1.6 m. The fall across
 * that ring MEASURES 0.60 m at C (`_padring.mjs`), so nothing floats and nothing
 * needs a plinth in the 0.42-0.68 m band.
 */
const SILO_R = 22;
function tankFarm(A, groundY, pad, seed) {
  const rng = new Rng(seed);
  const bearings = [0.42, 1.78, 3.30, 4.86];
  const sizes = [[5.4, 9.4], [4.3, 7.2], [5.4, 8.6], [4.3, 6.8]];
  const feet = [];
  for (let i = 0; i < bearings.length; i++) {
    const [r, h] = sizes[i];
    const x = pad.x + Math.sin(bearings[i]) * SILO_R;
    const z = pad.z + Math.cos(bearings[i]) * SILO_R;
    silo(A, rng, x, z, groundY(x, z), r, h, i === 0);
    feet.push([x, z, r]);
  }
  // the trunk main between them: what turns four cylinders into an installation
  for (let i = 0; i < feet.length; i++) {
    const a = feet[i], b = feet[(i + 1) % feet.length];
    pipeRun(A, a[0], a[1], a[2], b[0], b[1], b[2], groundY);
  }
  // the spill under the ruptured one, burnt down to the bedrock
  const bx = pad.x + Math.sin(bearings[0]) * (SILO_R - 3);
  const bz = pad.z + Math.cos(bearings[0]) * (SILO_R - 3);
  for (let i = 0; i < 26; i++) {
    const t = rng.range(0, Math.PI * 2), d = rng.range(0, 11);
    const px = bx + Math.sin(t) * d, pz = bz + Math.cos(t) * d;
    A.add('concrete_dark', BOX_FINE(A), LL(IDENT, px, groundY(px, pz) + 0.04, pz,
      rng.float() * 6.28, rng.range(1.4, 4.2), 0.08, rng.range(1.0, 3.4)),
      { masks: [0.92, 0.12, 0.02] });
  }
}

/**
 * ONE SILO. A riveted body, a conical top, a caged ladder up the outside
 * (player-only vertical circulation, and honestly labelled as such by `ladder`'s
 * own note — nothing in `NavGrid` climbs one), and if it is the ruptured one, a
 * tear in the shell with fire behind it.
 */
function silo(A, rng, x, z, gy, r, h, burning) {
  const body = new THREE.CylinderGeometry(r, r * 1.05, h + 1.6, 22, 1, false);
  paintMasks(body, (px, py, pz, nx, ny, nz, out) => {
    /**
     * THE DETAIL LAYER THAT HAS TO SURVIVE AT 0.5 m, at three scales: a
     * horizontal STRAKE line every 1.7 m (riveted plate is built in courses), a
     * vertical SEAM every ~2 m of circumference, and a rust BLOOM that runs
     * DOWN from each strake because that is where water sits. None of it is a
     * texture and none of it is an asset.
     */
    const strake = Math.abs(((py + 200) % 1.7) - 0.85) / 0.85;
    const seam = Math.abs(((Math.atan2(pz, px) * r * 0.5 + 100) % 2.0) - 1.0);
    const n = fbm3(px * 0.42, py * 0.24, pz * 0.42, 3);
    const bloom = Math.max(0, 1 - Math.abs(((py + 200) % 1.7) - 1.45)) * n;
    out[0] = Math.min(1, 0.4 + n * 0.3 + (1 - strake) * 0.22 + bloom * 0.4);
    out[1] = Math.min(1, 0.3 + n * 0.4 + (seam < 0.12 ? 0.28 : 0));
    out[2] = Math.min(1, 0.1 + bloom * 0.5 + Math.max(0, 1 - (py + h / 2) / 3) * 0.3);
  });
  const bm = LL(IDENT, x, gy + (h + 1.6) / 2 - 1.6, z, 0, 1, 1, 1);
  A.add('metal_rust', body, bm, null);
  A.collideGeo('metal', body, bm);
  body.dispose();

  /**
   * 52°, and the number is the point. The slope limit is 46° (`normal.y`
   * 0.695); a cone of rise 1.3r over run r has its faces at 52.4°, so every
   * cell whose ray lands on it is REFUSED and a 9 m tank costs this map zero
   * stranded cells. @see the header.
   */
  const coneH = r * 1.3;
  const cone = new THREE.ConeGeometry(r * 1.02, coneH, 22, 1);
  paintMasks(cone, (px, py, pz, nx, ny, nz, out) => {
    const n = fbm3(px * 0.5, py * 0.5, pz * 0.5, 3);
    out[0] = Math.min(1, 0.48 + n * 0.32);
    out[1] = Math.min(1, 0.34 + n * 0.4);
    out[2] = Math.min(1, 0.2 + n * 0.3);
  });
  const cm = LL(IDENT, x, gy + h + coneH / 2, z, 0, 1, 1, 1);
  A.add('metal_rust', cone, cm, null);
  A.collideGeo('metal', cone, cm);
  cone.dispose();
  A.add('metal_dark', BOX_THIN(A), LL(IDENT, x, gy + h + coneH + 0.45, z, 0, 0.7, 0.9, 0.7),
    { masks: [0.8, 0.5, 0.05] });
  ladder(A, x + r * 0.99, gy + 0.4, gy + h + 0.6, z, Math.PI / 2);

  if (!burning) return;
  /**
   * THE RUPTURE — and this is the one capture point on the map that carries its
   * own light, which is what makes C nameable from 200 m in the dark. Two
   * practicals rather than five: the light count is a program-cache key on this
   * renderer (@see `practical`), so the fire is one long-range warm source for
   * the read and one short hot one for the ground under it.
   */
  const ta = 0.6;
  const tx = x + Math.sin(ta) * r, tz = z + Math.cos(ta) * r;
  for (let i = 0; i < 5; i++) {
    A.add('metal_rust', BOX_THIN(A), LL(IDENT,
      tx + rng.range(-1.4, 1.4), gy + 2.4 + i * 0.9, tz + rng.range(-1.4, 1.4),
      ta + rng.range(-0.5, 0.5), rng.range(1.2, 2.6), 0.1, rng.range(0.8, 1.8),
      rng.range(-0.9, 0.9), rng.range(-0.7, 0.7)), { masks: [0.95, 0.72, 0.02] });
  }
  for (let i = 0; i < 10; i++) {
    A.add('ember', BOX_FINE(A), LL(IDENT,
      tx + rng.range(-2.0, 2.0), gy + 1.6 + rng.range(0, 5.4), tz + rng.range(-2.0, 2.0),
      rng.float() * 6.28, rng.range(0.5, 1.7), rng.range(0.4, 1.2), rng.range(0.4, 1.2)));
  }
  practical(A, tx, gy + 4.6, tz, 0xff8a3c, 22, 42, { s: 1.0, priority: 1 });
  practical(A, tx, gy + 1.4, tz, 0xff5a1c, 9, 20, { s: 0.6, priority: 2 });
}

/**
 * A trunk main on trestles, run between two silos. The pipes are 2.6 m up and
 * DRAWN ONLY — nothing that high needs collision and a proxy on one would be a
 * 40 m invisible wall — while each trestle is solid and 2.6 m tall, which is
 * over the 0.68 m band and therefore something a man walks round rather than
 * trips on.
 */
function pipeRun(A, x0, z0, r0, x1, z1, r1, groundY) {
  const dx = x1 - x0, dz = z1 - z0;
  const full = Math.hypot(dx, dz);
  const ux = dx / full, uz = dz / full;
  // start and end ON the shells, not at the centres
  const ax = x0 + ux * r0, az = z0 + uz * r0;
  const span = full - r0 - r1;
  if (span < 3) return;
  const yaw = Math.atan2(ux, uz);
  const bays = Math.max(2, Math.round(span / 6.0));
  for (let i = 0; i < bays; i++) {
    const s0 = (i / bays) * span, s1 = ((i + 1) / bays) * span;
    const px = ax + ux * s0, pz = az + uz * s0;
    const qx = ax + ux * s1, qz = az + uz * s1;
    const py = groundY(px, pz) + 2.6, qy = groundY(qx, qz) + 2.6;
    for (const off of [-0.45, 0.45]) {
      const ox = Math.cos(yaw) * off, oz = -Math.sin(yaw) * off;
      member(A, 'metal_rust', px + ox, py, pz + oz, qx + ox, qy, qz + oz, 0.34,
        { masks: [0.85, 0.55, 0.12] });
    }
    if (i === 0) continue;
    const gY = groundY(px, pz);
    A.add('metal_dark', BOX_THIN(A), LL(IDENT, px, gY + 1.3, pz, yaw, 1.5, 2.6, 0.26),
      { masks: [0.7, 0.42, 0.1] });
    A.box('metal', px, gY + 1.3, pz, 1.5, 2.6, 0.26, yaw);
  }
}

// ═══════════════════════════════════════════════════════════ the pylon line ══
/**
 * E — THE PYLON LINE. Four steel transmission towers walking through the zone on
 * one bearing with their conductors slung between them, and a fifth lying across
 * the ground where it came down.
 *
 * WHY THIS AND NOT ANOTHER BUILDING. The read has to survive 150 m of darkness,
 * and at that range the only channels left are SILHOUETTE and LIGHT. C took the
 * light. A lattice tower is the one silhouette on this map that is mostly SKY —
 * a comb rather than a mass — so it cannot be confused with the dome at A, the
 * drums at C, or the tower and the fortress at D, and the catenaries between
 * them draw a line across the cloud that nothing else here draws.
 *
 * IT ALSO EXPLAINS THE MAP. There are two 34 m EMP fields on this plain and
 * nothing that says where the power for them comes from. This is the line.
 *
 * NAV, WHICH IS WHERE A LATTICE TOWER IS DANGEROUS:
 *   under 2.4 m   REAL collision on the legs and the footings, so they block
 *                 movement, sight and bullets, and `_sealCrossings` shuts the
 *                 cell edges through them because it raycasts `MASK.WORLD`.
 *   over 2.4 m    DRAWN ONLY. Nothing walks at 15 m, so the only thing that mass
 *                 could do to navigation is put a walkable island under an open
 *                 sky — and geometry with no collision proxy is invisible to the
 *                 one downward ray the height field is built from. The trade is
 *                 stated rather than hidden: bullets pass through the upper
 *                 lattice, which for a structure that is 95 % air is closer to
 *                 right than a solid box would be.
 *   the fallen    a 6° RAMP off the plain, not a slab dropped on it. @see
 *   one           `fallenPylon`.
 */
const PYLON_H = 22;
function pylonLine(A, groundY, pad, seed) {
  const rng = new Rng(seed);
  /**
   * The line runs across the bearing to the map centre, offset so the capture
   * circle sits BETWEEN two towers rather than under one: the nearest leg is
   * 19 m out, i.e. 5 m clear of the 14 m circle, and the span crosses the zone
   * instead of standing on it.
   */
  const a = Math.atan2(-pad.x, -pad.z) + Math.PI / 2;
  const ux = Math.sin(a), uz = Math.cos(a);
  const at = (s) => [pad.x + ux * s, pad.z + uz * s];
  const stations = [-58, -19, 19, 58];
  for (const s of stations) {
    const [x, z] = at(s);
    pylon(A, groundY, x, z, groundY(x, z), a);
  }
  for (let i = 0; i < stations.length - 1; i++) {
    const [x0, z0] = at(stations[i]);
    const [x1, z1] = at(stations[i + 1]);
    catenary(A, x0, groundY(x0, z0) + PYLON_H - 4.2, z0, x1, groundY(x1, z1) + PYLON_H - 4.2, z1, a);
  }
  /**
   * THE FALLEN ONE STOPS AT -72, AND THE FIRST CUT'S -96 WAS OUTSIDE THE MAP.
   * The line runs TANGENTIALLY from a pad 154.2 m out, so a station at `s` sits
   * at `hypot(154.2, s)`: -96 is r 181.6, past the rim wall at 178, with a
   * walkable deck 2.9 m up on the mountain flank — `_nfbelt.mjs` found it at
   * bearing 289.5°. -72 puts the mass at r 170.1 and its high end, which is the
   * only part of it a man stands on at height, at r 174.5 — 3.8 m short of the
   * crest band and out of mantle reach of it. It is also still 14 m clear of the
   * last standing tower, so the line still reads as four up and one down.
   */
  const [fx, fz] = at(-72);
  fallenPylon(A, rng, fx, fz, groundY, a);
}

/** One tower: four battered legs, a braced body, a head and two cross-arms. */
function pylon(A, groundY, x, z, gy, yaw) {
  const base = 4.2, waist = 1.5, bodyH = PYLON_H * 0.62;
  const legAt = (k, r) => {
    const t = yaw + Math.PI / 4 + k * (Math.PI / 2);
    return [x + Math.sin(t) * r, z + Math.cos(t) * r];
  };
  for (let k = 0; k < 4; k++) {
    const [bx, bz] = legAt(k, base);
    const [tx, tz] = legAt(k, waist);
    stub(A, groundY, bx, bz, 1.6, yaw);
    // the first 2.4 m is SOLID — it is all a man can touch, and it is what makes
    // the tower a piece of cover rather than a picture of one
    const f = 2.4 / bodyH;
    const mx = bx + (tx - bx) * f, mz = bz + (tz - bz) * f;
    member(A, 'metal_dark', bx, gy, bz, mx, gy + 2.4, mz, 0.36,
      { thin: false, solid: true, masks: [0.72, 0.44, 0.1] });
    member(A, 'metal_dark', mx, gy + 2.4, mz, tx, gy + bodyH, tz, 0.3, { masks: [0.74, 0.46, 0.1] });
  }
  for (let b = 1; b * 2.4 < bodyH; b++) {
    const rb = base + (waist - base) * ((b * 2.4) / bodyH);
    const rp = base + (waist - base) * (((b - 1) * 2.4) / bodyH);
    const yb = gy + b * 2.4;
    for (let k = 0; k < 4; k++) {
      const p0 = legAt(k, rb), p1 = legAt((k + 1) % 4, rb);
      const q0 = legAt(k, rp);
      member(A, 'metal_dark', p0[0], yb, p0[1], p1[0], yb, p1[1], 0.12, { masks: [0.78, 0.5, 0.08] });
      member(A, 'metal_dark', q0[0], yb - 2.4, q0[1], p1[0], yb, p1[1], 0.1, { masks: [0.78, 0.5, 0.08] });
    }
  }
  // the head and the two cross-arms, with insulator strings hanging off them
  A.add('metal_dark', BOX_THIN(A), LL(IDENT, x, gy + bodyH + (PYLON_H - bodyH) / 2, z, yaw,
    1.5, PYLON_H - bodyH, 1.5), { masks: [0.74, 0.46, 0.1] });
  for (const [ay, aw] of [[PYLON_H - 4.2, 9.6], [PYLON_H - 0.6, 6.4]]) {
    const ex = Math.cos(yaw), ez = -Math.sin(yaw);
    member(A, 'metal_dark', x - ex * aw / 2, gy + ay, z - ez * aw / 2,
      x + ex * aw / 2, gy + ay, z + ez * aw / 2, 0.34, { masks: [0.76, 0.48, 0.08] });
    for (const s of [-1, 1]) {
      const ix = x + ex * s * (aw / 2 - 0.4), iz = z + ez * s * (aw / 2 - 0.4);
      for (let d = 0; d < 4; d++) {
        A.add('plaster_white', BOX_THIN(A), LL(IDENT, ix, gy + ay - 0.35 - d * 0.3, iz, yaw,
          0.32, 0.2, 0.32), { masks: [0.14, 0.2, 0.05] });
      }
    }
  }
  // a red obstruction lamp on the peak. Its RANGE is short on purpose: what
  // carries 300 m is the emissive body, and a long-range light is a program
  // cache key this map cannot spend four of. @see `practical`.
  practical(A, x, gy + PYLON_H + 0.6, z, 0xff3a2a, 2.0, 11, { s: 0.26, priority: 4 });
}

/** Three conductors a side, sagging. Drawn only — a cable has no collision. */
function catenary(A, x0, y0, z0, x1, y1, z1, yaw) {
  const dx = x1 - x0, dz = z1 - z0;
  const sag = Math.min(4.6, Math.hypot(dx, dz) * 0.09);
  const segs = 10;
  const ex = Math.cos(yaw), ez = -Math.sin(yaw);
  for (const off of [-4.4, 0, 4.4]) {
    const ox = ex * off, oz = ez * off;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const yy = (t) => y0 + (y1 - y0) * t - sag * 4 * t * (1 - t);
      member(A, 'metal_dark',
        x0 + dx * t0 + ox, yy(t0), z0 + dz * t0 + oz,
        x0 + dx * t1 + ox, yy(t1), z0 + dz * t1 + oz, 0.09, { masks: [0.6, 0.35, 0.05] });
    }
  }
}

/**
 * THE ONE THAT CAME DOWN, AND IT IS A RAMP RATHER THAN AN OBSTACLE.
 *
 * `fallenMember` would lay a 1.6 m member on the plain, and a 1.6 m slab with a
 * flat top is a walkable island with no neighbour inside `maxStep` — the silo
 * roof problem, at ankle height. Laid as a 6° incline with its low end ON the
 * ground it is CONTINUOUS with the plain instead: a man walks up it, A* walks up
 * it, and the high end is 2.9 m of vantage over open ground rather than a place
 * to be stuck. Grade 0.11 against `RAMP_GRADE` 0.38 and `maxStep`'s 0.56.
 */
function fallenPylon(A, rng, x, z, groundY, yaw) {
  const len = 26, w = 2.6, tilt = yaw + 0.7;
  const ux = Math.sin(tilt), uz = Math.cos(tilt);
  const x0 = x - ux * len / 2, z0 = z - uz * len / 2;
  const x1 = x + ux * len / 2, z1 = z + uz * len / 2;
  const y0 = groundY(x0, z0), y1 = groundY(x1, z1) + 2.9;
  const rise = y1 - y0;
  const pitch = -Math.atan2(rise, len);
  const slabLen = Math.hypot(len, rise);
  // the walked surface, and the collision IS that surface — one statement, so
  // the height field and the capsule cannot disagree about where the slope is
  A.add('metal_rust', BOX(A), LL(IDENT, (x0 + x1) / 2, (y0 + y1) / 2 - 0.18, (z0 + z1) / 2,
    tilt, w, 0.36, slabLen, pitch), {
    paint: (px, py, pz, qx, qy, qz, out) => {
      const n = fbm3(px * 0.5, py * 0.5, pz * 0.5, 2);
      out[0] = Math.min(1, 0.58 + n * 0.35);
      out[1] = Math.min(1, 0.44 + n * 0.4);
      out[2] = Math.min(1, 0.1 + n * 0.22);
    },
  });
  A.box('metal', (x0 + x1) / 2, (y0 + y1) / 2 - 0.18, (z0 + z1) / 2, w, 0.36, slabLen, tilt, pitch);
  // the lattice it is made of, sitting ON the deck — under 0.42 m so it is
  // walked over, never in the band that has to be jumped
  const bays = Math.round(len / 2.2);
  for (let i = 0; i < bays; i++) {
    const t0 = i / bays, t1 = (i + 1) / bays;
    const ax = x0 + (x1 - x0) * t0, az = z0 + (z1 - z0) * t0, ay = y0 + rise * t0;
    const bx = x0 + (x1 - x0) * t1, bz = z0 + (z1 - z0) * t1, by = y0 + rise * t1;
    for (const s of [-1, 1]) {
      const ox = Math.cos(tilt) * s * (w / 2 - 0.2), oz = -Math.sin(tilt) * s * (w / 2 - 0.2);
      member(A, 'metal_dark', ax + ox, ay + 0.2, az + oz, bx + ox, by + 0.2, bz + oz, 0.16,
        { masks: [0.8, 0.5, 0.1] });
    }
    const o = 0.34;
    member(A, 'metal_dark',
      ax + Math.cos(tilt) * -(w / 2 - 0.2), ay + o, az - Math.sin(tilt) * -(w / 2 - 0.2),
      bx + Math.cos(tilt) * (w / 2 - 0.2), by + o, bz - Math.sin(tilt) * (w / 2 - 0.2), 0.12,
      { masks: [0.82, 0.52, 0.1] });
  }
  // the torn-out footing at the low end. Each block is over 0.68 m tall, so it
  // is cover to walk round rather than a stone to trip on.
  for (let i = 0; i < 7; i++) {
    const px = x0 + rng.range(-3.6, 3.6), pz = z0 + rng.range(-3.6, 3.6);
    const s = rng.range(1.0, 1.9);
    const py = groundY(px, pz) + s * 0.42;
    A.add('concrete', BOX_SOFT(A), LL(IDENT, px, py, pz, rng.float() * 6.28,
      s, s * 0.85, s * 1.25, rng.range(-0.4, 0.4), rng.range(-0.4, 0.4)),
      { masks: [0.35, 0.5, 0.4] });
    A.box('concrete', px, py, pz, s, s * 0.85, s * 1.25, 0);
  }
}

// ═════════════════════════════════════════════════════════════════ the pass ══
/**
 * `PLAINS.pads` IS THE SEAM, and the pads are the RESOLVED zone centres — not an
 * authored copy of them. `plains.js` publishes `PADS`, `src/match/sites.js`
 * authors the same numbers, and `_sitescape.mjs` reads `match.allZones` back out
 * of a live boot and confirms `ensureReachable` relocates none of the five (it
 * may move a zone up to 35 m and say nothing conclusive, which is exactly why
 * that is checked rather than assumed).
 *
 * ITS OWN FIXED-SEED STREAMS, one per site, and it is called at the END of
 * `PLAINS.build`. The `rng` there is ONE sequence and every pass draws from it in
 * order, so a draw inserted anywhere earlier moves several thousand stones and
 * tufts sideways; this file takes nothing from it and moves nothing above it —
 * the same rule `plains-tower.js`, `plains-fort.js`, `plains-cover.js`,
 * `plains-crag.js` and `plains-ground.js` already follow.
 *
 * A MISSING PAD IS LOGGED AND SKIPPED rather than thrown, because a level that
 * boots without one site is playable and a level that throws in `build` is a
 * 240 s timeout with no message in every tool in `tools/`.
 */
export function buildSites(A, groundY, pads) {
  const by = new Map(pads.map((p) => [p.id, p]));
  const volumes = [];
  const built = [];
  for (const [id, seed] of [['A', 0x517e0a1], ['B', 0x517e0b2]]) {
    const pad = by.get(id);
    if (!pad) { console.warn(`[world] nachtfeld sites: no pad "${id}" — EMP station SKIPPED`); continue; }
    volumes.push(...empStation(A, groundY, pad, seed));
    built.push(`${id}:redoubt`);
  }
  if (by.get('C')) { tankFarm(A, groundY, by.get('C'), 0x517e0c3); built.push('C:tank-farm'); }
  else console.warn('[world] nachtfeld sites: no pad "C" — the tank farm is SKIPPED');
  if (by.get('E')) { pylonLine(A, groundY, by.get('E'), 0x517e0d4); built.push('E:pylon-line'); }
  else console.warn('[world] nachtfeld sites: no pad "E" — the pylon line is SKIPPED');
  console.info(`[world] nachtfeld sites: ${built.join(' ')} — ${volumes.length} gate volumes`);
  return volumes;
}
