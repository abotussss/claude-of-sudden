import * as THREE from 'three';
import { BOX, BOX_FINE, BOX_SOFT, BOX_THIN, PANE, IDENT, LL } from '../kit.js';
import { fbm3, rockGeometry, patchGeometry } from '../util.js';
import { Rng } from '../../core/rng.js';
import {
  RAMP_GRADE, octagon, edgeInfo, prism, wallRun, interiorVolume,
  debrisField, drawDebris, fallenMember, ladder, handrail, practical, embrasure,
} from './plains-works.js';
import { post, dressPost } from './plains-stores.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD — DER LEITTURM. The control tower. 「管制塔があり」
 * ════════════════════════════════════════════════════════════════════════════
 * It stands on zone D, the centre of the plain, and it is the only vertical
 * thing between the two mountain rims: 38.5 m to the beacon on 300 m of open
 * ground, which is what「かなり距離のあるマップ」costs you if you do not give the
 * player one landmark to navigate by. From the north base it is on the skyline
 * at 150 m; from either shoulder zone it is 155 m and still reads.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE HARD PART IS NOT THE TOWER, IT IS THE STAIRCASE
 * ────────────────────────────────────────────────────────────────────────────
 * `src/ai/nav.js` keeps ONE walkable height per 0.8 m cell. Two floors of a
 * building occupy the same (x, z), so a height field can hold exactly one of
 * them — measured on the town, all 3 353 walkable cells inside the eight
 * enterable buildings were on an UPPER storey and zero were on the ground, and
 * every roof up there sits in its own private component with no route down. A
 * tower built as a stack of floors joined by stairs is a tower no bot will ever
 * be on, and there is no amount of level design that fixes it from this side.
 *
 * So this one is not a stack. It is a ZIGGURAT, and every AI-walkable surface on
 * it owns its plan cells outright:
 *
 *          ▁▁▁▁▁▁▁▁ 38.5  lattice mast, beacon              (nobody)
 *         ┌────────┐ 31.0 cab roof: dishes, rails            (player)
 *         │ ▓▓▓▓▓▓ │ 25.8 THE CAB — glazed, canted           (player)
 *         │        │      four storeys of shaft              (player)
 *      ┌──┴────────┴──┐ 6.6  P2 DECK   r 6.5 → 12  ◄── AI
 *      │  control room │ 6.74 THE ROOM  r < 6.5     ◄── AI (interiorVolume)
 *   ┌──┴──────────────┴──┐ 3.2 P1 DECK  r 12 → 21   ◄── AI
 *   │                     │ 0.0 the apron            ◄── AI
 *
 * P1's deck is the top of P1's own mass and P2 is set back off it; P2's deck is
 * the top of P2 and the shaft is set back off THAT. A ray from the sky finds
 * each of them exactly once. They are joined by four ramps at gradient 0.38
 * (`RAMP_GRADE`) — 0.30 m of rise per cell against a 0.45 m `maxStep` and 20.8°
 * against a 46° slope limit — so A* walks the whole climb as ordinary ground
 * without a single special case.
 *
 * THE ROOM IS THE ONE PIECE THAT NEEDS THE SEAM. The control room is under the
 * shaft, and the shaft's own roof is 31 m of cab that no bot will ever want, so
 * `world.interiorVolumes` may re-probe those cells down onto the room's floor
 * without taking a walkable surface away from anything. That is exactly the test
 * that a volume under the P1 deck would fail, and why there is not one.
 *
 * WHAT IS PLAYER-ONLY, said plainly rather than discovered later: the four
 * shaft storeys, the cab, the cab roof and the mast. `NavGrid` cannot express a
 * staircase between two floors with the same footprint, and pretending otherwise
 * by putting the decks on `LAYER.CLIP` would only move the lie. Bots hold the
 * ground, the two decks and the room; the man at the keyboard gets the tower.
 */

// ────────────────────────────────────────────────────────────────── the plan ──
/**
 * WHERE IT STANDS — 32 m north of zone D rather than on top of it, and that is
 * a `src/match` constraint rather than a taste.
 *
 * `sites.resolveLayout` resolves a capture point with `ai.groundAt(x, z, 4)`:
 * ONE ray dropped from y = 4 in world space. Inside this podium y = 4 is three
 * metres inside solid concrete, so the ray comes back with the underside of the
 * plinth, `walkable()` finds no nav cell within 1.2 m of that height and zone D
 * resolves to a point in mid-air inside the mass. Measured, first boot with the
 * tower on the origin: `[match] site D: level (0, 0) is not walkable — using the
 * fallback (0, -8)`, and the fallback is inside the same block.
 *
 * So the tower stands OFF the point and commands it. The capture circle
 * (`RULES.captureRadius` 8) stays open plain: the podium's nearest face is at
 * z -11, eleven metres clear of the circle, and the two ground ramps are 36 m
 * out. What zone D is now is the ground BETWEEN the tower and the fortress, in
 * the open, overlooked from 3.2 m, 6.6 m and 38 m — which is a better objective
 * than a room with a door.
 *
 * IF SOMEBODY WANTS THE POINT INSIDE THE TOWER, the change is in `sites.js`, not
 * here: `groundPoint` needs to start its ray above the structure (or read the
 * nav grid's own floor) before any interior on any map can hold a capture point.
 */
export const TOWER = { x: 0, z: -32 };

/** Podium 1 — the fighting platform. Octagon, across-flats radius, corner cut. */
const P1_R = 21, P1_CUT = 7.0, P1_TOP = 3.2;
/** Podium 2 — the gallery the room opens onto. */
const P2_R = 12, P2_CUT = 4.2, P2_TOP = 6.6;
/** The shaft. */
const SH_R = 6.5, SH_CUT = 1.8, SH_WALL = 0.95;
const ROOM_Y = P2_TOP + 0.14;
/** Floor levels inside the shaft — the ground room, then four storeys. */
const FLOORS = [ROOM_Y, 11.6, 16.4, 21.2];
const ROOF_Y = 25.8;
/** The cab, corbelled out over the shaft, and what stands on it. */
const CAB_R = 8.6, CAB_CUT = 2.4, CAB_TOP = 31.0;
const MAST_TOP = 38.5;

/** Total footprint radius including the two external flights — @see `apron`. */
export const TOWER_R = 25.4;

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE STAIRCASE — 「タワーの階段の設置の仕方悪すぎる」
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG WITH IT, looked at from the ground rather than from the plan:
 *
 *   1. THE CLIMB WAS AN L WITH NO SIGN ON IT. The two ground ramps were on the
 *      ±X flats and the two ramps up to P2 were on the ±Z flats — ninety degrees
 *      apart. You came up the east ramp, arrived at (23, -27.8), and the next
 *      flight was twenty-four metres away round the corner of a deck with a
 *      chest-high parapet and fourteen stacks of crates on it. Nothing at the
 *      head of the first flight pointed at the second one, and from the deck you
 *      could not see it.
 *   2. AND THE SECOND FLIGHT HAD A WALL ACROSS ITS FOOT. Both P1→P2 ramps stood
 *      on x = 0 with their bottom landings at z -11.65 and -52.35; P1's ±Z flats
 *      carry a 1.16 m parapet whose inner face is at z -11.46 and -52.54. The
 *      parapet ran straight over both landings. The +Z one is solid for its whole
 *      28 m; the -Z one is the embrasure variant, so the only thing between a man
 *      and the way up was a 0.62 m slot he could see through and not walk through.
 *   3. FOUR SEPARATE RAMPS AT ONE GRADIENT, ALL ROUND THE OUTSIDE, IS A CAR PARK.
 *      Photographed from half way up (`shots/nfclimb-before/stair-mid-E.png`) the
 *      east ramp is a smooth concrete chute between a cheek wall and a podium
 *      face with the sky at the end of it and nothing to say what it is for.
 *
 * WHAT IT IS NOW: TWO complete climbs, one per side, each a straight line.
 *
 *      ground ── flight I (alongside the ±X face) ── head on the tower's own
 *      centreline ── the parapet's stair gate ── flight II (radial, inward)
 *      ── P2 gallery ── the control room's door on that same face.
 *
 * The east climb's foot opens NORTH (at the base's bearing) and the west
 * climb's opens SOUTH (at zone D's), so each of the two directions men actually
 * arrive from is met by the bottom of a stair instead of by 3.2 m of battered
 * concrete. The two flights of a climb are collinear and 2.6 m apart: from the
 * head of the first the second is dead ahead.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND THEY ARE STAIRS NOW, NOT RAMPS — 0.40 m OF TREAD, AND THAT IS THE TRICK
 * ────────────────────────────────────────────────────────────────────────────
 * `plains-works.js` chose ramps over stairs for a stated reason: "a stair tread
 * does not connect", `NavGrid.maxStep` is 0.45 m across an 0.8 m cell, and a
 * normal 0.19 / 0.28 stair rises 0.54 m per cell — over the step, so the flight
 * is a wall to the height field and the deck above it is an island. That is the
 * town's disease (36 820 walkable cells above 2.5 m in 2 113 components, ZERO
 * joined to the ground) and it is not worth a nicer-looking staircase.
 *
 * A stair whose TREAD DIVIDES THE CELL EXACTLY does connect, and the arithmetic
 * is not delicate. `NavGrid` samples one point per 0.8 m cell; at `TREAD` 0.40 m
 * every cell along a flight is exactly TWO treads from its neighbour, so the
 * sampled difference is exactly two risers WHATEVER the lattice phase is —
 * there is no worst case to be unlucky with, which is what a tread of 0.28 or
 * 0.35 would have left. Both flights are authored on a cardinal axis, which is
 * what makes "two treads along the run" and "two cells along the grid" the same
 * distance.
 *
 * The gradient is unchanged at `RAMP_GRADE` 0.38, so a riser is 0.152 m and a
 * cell-to-cell rise is 0.304 m against `maxStep` 0.45 and against the 0.42 m
 * stance step the character controller lifts a grounded move by. Both margins
 * are ~30 %. Measured after the change — @see the component counts in the
 * commit; the plain's biggest component and its stranded count did not move.
 */
const FLIGHT_W = 3.6;
const TREAD = 0.40;

/**
 * The four traces, TRANSLATED ONTO THE TOWER'S CENTRE at module load.
 *
 * `octagon()` returns a trace about the origin and `prism()` extrudes it exactly
 * where its points are, so an untranslated trace builds the whole podium at the
 * map origin while every part authored off `TOWER.x/TOWER.z` — the ramps, the
 * furniture, the room — builds 32 m away. That is not a subtle failure and it
 * did not look like one either: `[ai] nav` came back with the floor of the map's
 * whole centre at y 31, because the shaft was standing on zone D.
 */
const at = (pts) => pts.map(([x, z]) => [x + TOWER.x, z + TOWER.z]);
const P1 = at(octagon(P1_R, P1_CUT));
const P2 = at(octagon(P2_R, P2_CUT));
const SH = at(octagon(SH_R, SH_CUT));
const CAB = at(octagon(CAB_R, CAB_CUT));

/**
 * The four doorways out of the control room, on the cardinal faces, and the
 * keep-out circles that go with them. FIVE separate shipped bugs on this repo
 * have been a prop dressed across a door — `interiors.js` once tested a crate's
 * CENTRE against a circle while the crate is 0.64 m across — so the room's
 * dressing tests `A.footprintR()`, the real extent, against these.
 */
const DOOR_W = 2.1, DOOR_H = 2.5;
const DOORS = [
  { ax: 0, az: -1, yaw: 0 },
  { ax: 0, az: 1, yaw: Math.PI },
  { ax: -1, az: 0, yaw: Math.PI / 2 },
  { ax: 1, az: 0, yaw: -Math.PI / 2 },
];
const DOOR_CLEAR = 2.6;

/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHY ANYBODY WOULD CLIMB IT — 「管制塔はなんのためにあんの？？ 物資もないし」
 * ════════════════════════════════════════════════════════════════════════════
 * The honest answer before this table was: no reason at all, and not as a
 * matter of taste. `plains.js` returns `features: []`, so `world.features` was
 * empty, so `MatchSystem`'s `new Caches(ctx, world.features, …)` bound nothing.
 * Measured from inside a live match on the plain (`_nftier.mjs`):
 *
 *     caches: 0 bound, 0 proved bot-walkable
 *     {"ammo":0,"weapon":0,"grenade":0,"vantage":0,"medic":0}
 *
 * Not one round, one frag, one gun, one med kit or one beacon socket on three
 * hundred metres of map. So the tower was a view, and a view is not a reason.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EVERY REWARD HERE IS ONE THE GAME ALREADY HAS. NOTHING NEW WAS INVENTED.
 * ────────────────────────────────────────────────────────────────────────────
 *   `ammo`     `weapons.scavenge` for the player, `ai.resupply` for a bot.
 *   `grenade`  the ONLY source of frags inside a life other than dying.
 *   `weapon`   HOLD F swaps your primary for the one on the rack, fixed for the
 *              whole match — "I know where the bolt gun is" is the thing that
 *              makes a building worth crossing a map for (`caches.js`).
 *   `vantage`  a firing position that hands over rounds, which is what a firing
 *              position is actually short of.
 *   `medic`    +50 HP, either side, `RULES.medicHeal`.
 *   …and ANY of them takes a BEACON on a TAP of the same key: a 60 s forward
 *   spawn for your side. Holding the tower is a forward spawn 32 m off the
 *   capture point, and that is the reward verticality is actually worth here.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE LADDER OF REWARDS FOLLOWS THE LADDER OF EFFORT, AND WHO CAN CLIMB IT
 * ────────────────────────────────────────────────────────────────────────────
 *   3.2 m  P1 deck      a dressing station and a resupply — BOT-REACHABLE, so
 *                       the fight over the tower happens on the tower.
 *   6.6 m  P2 gallery   a nest overlooking zone D, with rounds. BOT.
 *   6.74 m control room a resupply and the map's only frag stack, INDOORS and
 *                       bot-reachable through `world.interiorVolumes` — which
 *                       is the whole "屋内戦闘" argument `caches.js` measured on
 *                       the town (3 of 29 men had ever gone inside; 23 do now).
 *   21.2 m shaft storey THE WEAPON RACK. Player only, and it is meant to be:
 *                       four storeys of stair is the price of the second gun.
 *   26 m   the cab      rounds at the best sightline on the map, for the man
 *                       who carried that gun up.
 *
 * `x`/`z` are OFFSETS from `TOWER`, `h` is height above the pad datum, so the
 * table reads against the section drawing at the top of this file. The two
 * player-only posts refuse a beacon — @see `plains-stores.js`, which has the
 * measurement of what `_jitterOnto` does with one planted at 26 m.
 */
const STORES = [
  { id: 'NF-TOWER-P1-med', kind: 'medic', x: 0, z: -15.2, h: P1_TOP, yaw: 0 },
  { id: 'NF-TOWER-P1-ammo', kind: 'ammo', x: 0, z: 15.2, h: P1_TOP, yaw: Math.PI },
  { id: 'NF-TOWER-P2-nest', kind: 'vantage', x: 0, z: 9.4, h: P2_TOP, yaw: Math.PI },
  { id: 'NF-TOWER-ROOM-ammo', kind: 'ammo', x: 2.48, z: 0.77, h: ROOM_Y, yaw: -1.87, perishable: true },
  { id: 'NF-TOWER-ROOM-frag', kind: 'grenade', x: -2.48, z: -0.77, h: ROOM_Y, yaw: 1.27, perishable: true },
  {
    id: 'NF-TOWER-RACK', kind: 'weapon', x: -3.55, z: 0, h: FLOORS[3], yaw: Math.PI / 2,
    perishable: true, botReachable: false, beacon: false,
  },
  {
    id: 'NF-TOWER-CAB', kind: 'vantage', x: 0, z: 2.4, h: ROOF_Y + 0.32, yaw: Math.PI,
    perishable: true, botReachable: false, beacon: false, clip: true,
  },
];

/**
 * Is (x, z) close enough to a store post on level `h` to foul it? Every
 * scatter pass that runs over a deck or a room asks this before it puts
 * anything down. A crate dressed onto a supply post is the doorway bug in a
 * different coat: the thing the player is meant to walk up to and hold F on
 * ends up behind a barrel, and nothing in the boot log says so.
 */
function nearStore(x, z, h, r = 2.6) {
  for (const s of STORES) {
    if (Math.abs(s.h - h) > 0.6) continue;
    if ((x - TOWER.x - s.x) ** 2 + (z - TOWER.z - s.z) ** 2 < r * r) return true;
  }
  return false;
}

/** Build and dress the posts standing on level `h`. Returns nothing. */
function buildStores(A, rng, y, h) {
  for (const s of STORES) {
    if (Math.abs(s.h - h) > 0.6) continue;
    if (s.clip) A.clipProps = true;
    dressPost(A, rng, s.kind, TOWER.x + s.x, y(s.h), TOWER.z + s.z, s.yaw, { clip: s.clip });
    if (s.clip) A.clipProps = false;
  }
}

// ──────────────────────────────────────────────────────────────────── build ──
/**
 * @param {import('../builder.js').Assembler} A
 * @param {(x:number,z:number)=>number} groundY  the plain's analytic height
 * @returns {{ interiorVolumes: object[], demolition: object, lights: object[] }}
 */
export function buildTower(A, groundY) {
  /**
   * ITS OWN FIXED-SEED STREAM. `plains.js` hands its passes one shared `rng` and
   * the order of the draws IS the map, so a tower that drew from it would move
   * every stone and tuft on the plain the day somebody adds a rivet here. Same
   * rule `cathedral.js`, `features.js` and `demolition.js` all follow.
   */
  const rng = new Rng(0x7a11e2);
  const Y0 = groundY(TOWER.x, TOWER.z);
  const y = (v) => Y0 + v;
  const lights = [];

  /**
   * THE DESTROYED STATE IS SCOPED ROUND THE SUPERSTRUCTURE, NOT THE WHOLE
   * TOWER, and that is a navigation decision rather than a budget one. The two
   * podium decks are the AI's ground up here; re-baking a 21 m octagonal
   * platform into a ruin scope only to stand an identical one back up would
   * double the geometry to change nothing anybody can walk on. What comes down
   * is everything above the P2 deck — the shaft, the cab and the mast — which
   * is the whole of the skyline and the whole of the overwatch.
   */
  const shell = A.beginScope('shell:NF-TOWER');
  buildShaft(A, rng, y);
  buildCab(A, rng, y, lights);
  A.endScope();

  // …and the platform it stands on, which survives whatever happens to it.
  buildPodium(A, rng, y, groundY, lights);

  const ruin = A.beginScope('ruin:NF-TOWER');
  buildTowerRuin(A, new Rng(0x7a11e3), y, groundY);
  A.endScope();

  return {
    interiorVolumes: [
      /**
       * The control room. `hw`/`hd` are the OUTER footprint — the doorway a bot
       * walks through is in the wall, so a volume clipped to the inner face
       * leaves the threshold cell reading the cab roof 24 m up and the room is
       * an island. @see `NavGrid._carveInteriors`' own note on the same thing.
       */
      interiorVolume('NF-TOWER', TOWER.x, TOWER.z, SH_R, SH_R, y(ROOM_Y), y(FLOORS[1])),
    ],
    demolition: {
      id: 'NF-TOWER',
      name: 'THE CONTROL TOWER',
      zone: 'D',
      opens: false,
      shell, ruin,
      x: TOWER.x, z: TOWER.z,
      baseY: y(P2_TOP),
      top: y(MAST_TOP),
      radius: 22,
      halfW: SH_R, halfD: SH_R,
      surfaces: ['concrete', 'metal'],
      tint: 0x9aa0a2,
      /**
       * WHAT FALLS, in the EXACT shape `demolition._mass` publishes it, because
       * `src/match/airstrike.js:_buildDemoSite` consumes `world.demolitions`
       * generically and fractures every part it is handed:
       *
       *   { id, mat, size:[sx,sy,sz], at:[x,y,z], cut:[nx,ny,nz] }
       *
       * `mat` indexes `SURFACE_FOR.demo` (0 plaster, 1 concrete); `at` is level
       * space relative to `position` in x/z and ABSOLUTE in y, because that
       * method zeroes `base.y` and adds `at[1]` to it. Getting this wrong is not
       * a cosmetic failure — the first boot with a `{y, r, h}` record of my own
       * invention threw `Cannot read properties of undefined (reading '2')` out
       * of `fracture` and took the whole match system down with it.
       */
      mass: towerMass(y),
      /**
       * WHAT IS IN IT, published on the one record `world` carries for this
       * structure. `publishWorks` mutates and returns THIS object, so the list
       * arrives at `world.demolitions[*].caches` intact and `src/match/caches.js`
       * reads it with one generic loop. @see the header of `plains-stores.js`
       * for why it rides here and not on `world.features`.
       */
      caches: STORES.map((s) => post(
        s.id, s.kind, TOWER.x + s.x, y(s.h), TOWER.z + s.z, s.yaw,
        { botReachable: s.botReachable, perishable: s.perishable, beacon: s.beacon }
      )),
    },
    lights,
  };
}

/**
 * The falling mass, as axis-aligned boxes on the level's own axes. The octagon
 * is fractured as the square it is inscribed in: `fracture` cuts boxes, the
 * chunks are 1-2 m of broken concrete by the time they land, and nobody has ever
 * been able to see the corner of a chamfer in a dust cloud.
 */
function towerMass(y) {
  const n = (m, per = 1.6) => Math.max(1, Math.round(m / per));
  const t = SH_WALL;
  const W = SH_R * 2;
  const H = ROOF_Y - ROOM_Y;
  const parts = [
    { id: 'shaftXp', mat: 1, size: [t, H, W], at: [(W - t) / 2, y(ROOM_Y + H / 2), 0], cut: [1, n(H), n(W)] },
    { id: 'shaftXn', mat: 1, size: [t, H, W], at: [-(W - t) / 2, y(ROOM_Y + H / 2), 0], cut: [1, n(H), n(W)] },
    { id: 'shaftZp', mat: 1, size: [W - t * 2, H, t], at: [0, y(ROOM_Y + H / 2), (W - t) / 2], cut: [n(W), n(H), 1] },
    { id: 'shaftZn', mat: 1, size: [W - t * 2, H, t], at: [0, y(ROOM_Y + H / 2), -(W - t) / 2], cut: [n(W), n(H), 1] },
  ];
  for (let f = 1; f < FLOORS.length; f++) {
    parts.push({
      id: `slab${f}`, mat: 1, size: [W - t * 2, 0.28, W - t * 2],
      at: [0, y(FLOORS[f] - 0.14), 0], cut: [n(W, 2.1), 1, n(W, 2.1)],
    });
  }
  parts.push({ id: 'roof', mat: 1, size: [W, 0.4, W], at: [0, y(ROOF_Y - 0.2), 0], cut: [n(W, 2.1), 1, n(W, 2.1)] });
  // the cab: a light box that comes apart into a lot of small pieces
  parts.push({ id: 'cab', mat: 0, size: [CAB_R * 2, 3.2, CAB_R * 2], at: [0, y(ROOF_Y + 1.9), 0], cut: [n(CAB_R * 2, 1.5), 3, n(CAB_R * 2, 1.5)] });
  parts.push({ id: 'cabroof', mat: 1, size: [CAB_R * 2, 0.34, CAB_R * 2], at: [0, y(CAB_TOP - 0.17), 0], cut: [n(CAB_R * 2, 2.0), 1, n(CAB_R * 2, 2.0)] });
  parts.push({ id: 'mast', mat: 0, size: [1.5, MAST_TOP - CAB_TOP, 1.5], at: [0, y((CAB_TOP + MAST_TOP) / 2), 0], cut: [1, n(MAST_TOP - CAB_TOP, 1.4), 1] });
  return parts;
}

// ──────────────────────────────────────────────────────────────────── stair ──
/**
 * ONE FLIGHT. Treads, stringers, handrails and the embankment under it.
 *
 * The walked surface IS the treads and the collision IS the treads — one
 * statement, so the height field and the capsule cannot disagree about where
 * the stair is, which is the same rule `plains-works.ramp` was written under.
 * The number of treads is forced to `run / TREAD` so the 0.40 m that makes this
 * legal cannot be rounded away by an awkward run. @see the note on `TREAD`.
 *
 * THE SIDES ARE COVERED BY STRINGERS rather than left as the ends of twenty-one
 * boxes: adjacent treads have coincident side faces and a merged opaque batch
 * z-fights across them. A stringer is also what a concrete stair actually has.
 */
function flight(A, rng, key, x0, z0, y0, x1, z1, y1, w, opts = {}) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const run = Math.hypot(dx, dz);
  const ux = dx / run;
  const uz = dz / run;
  const yaw = Math.atan2(dx, dz);
  const rise = y1 - y0;
  const steps = Math.max(2, Math.round(run / TREAD));
  const tread = run / steps;
  const riser = rise / steps;
  const pitch = Math.atan2(rise, run);
  const surface = opts.surface ?? A.surfaceOf(key);
  const baseY = opts.baseY ?? Math.min(y0, y1) - 0.45;
  const box = BOX(A);

  // the embankment, in coarse blocks — the stair is cast on made ground, not
  // hung in the air. It stops 0.3 m under the treads so nothing pokes through.
  const fills = Math.max(3, Math.round(run / 1.4));
  for (let i = 0; i < fills; i++) {
    const t = (i + 0.5) / fills;
    const top = y0 + rise * t - 0.34;
    if (top <= baseY) continue;
    const fx = x0 + dx * t;
    const fz = z0 + dz * t;
    A.add(opts.fillKey ?? key, box, LL(IDENT, fx, (baseY + top) / 2, fz, yaw, w - 0.05, top - baseY, run / fills + 0.02),
      { masks: [0.2 + rng.float() * 0.3, 0.4 + rng.float() * 0.3, 0.35] });
    A.box(surface, fx, (baseY + top) / 2, fz, w - 0.05, top - baseY, run / fills, yaw);
  }

  for (let i = 0; i < steps; i++) {
    const top = y0 + (i + 1) * riser;
    // each tread overlaps the one below it, so there is never a seam a ray or a
    // capsule can fall into between two of them
    const bot = y0 + i * riser - 0.36;
    const cx = x0 + ux * (i + 0.5) * tread;
    const cz = z0 + uz * (i + 0.5) * tread;
    A.add(key, box, LL(IDENT, cx, (bot + top) / 2, cz, yaw, w, top - bot, tread + 0.008), {
      paint: (px, py, pz, nx, ny, nz, out) => {
        const n = fbm3(px * 0.55, py * 0.55, pz * 0.55, 2);
        // the broom finish across the tread, and the grit that has collected
        // against the riser behind it — the detail that has to hold at 0.5 m
        const across = Math.abs((((px * Math.cos(yaw) - pz * Math.sin(yaw)) * 5.5) % 1) - 0.5);
        const up = ny > 0.7;
        out[0] = Math.min(1, 0.3 + n * 0.36 + (up ? (1 - across) * 0.22 : 0));
        out[1] = Math.min(1, 0.32 + n * 0.42 + (up ? 0 : 0.2));
        out[2] = Math.min(1, 0.14 + n * 0.22 + (up ? 0 : 0.3));
      },
    });
    A.box(surface, cx, (bot + top) / 2, cz, w, top - bot, tread, yaw);
    /**
     * THE NOSING. A hard dark lip along the front edge of every tread — 5 cm
     * proud and 2.5 cm deep, so it is far under any step limit and cannot be a
     * lattice of two-hundred obstacles. It is also the only thing that makes a
     * flight read as a flight in raking moonlight: without it a stair at 21° is
     * a smooth grey slope again, which is what the old ramps looked like.
     */
    A.add('concrete_dark', BOX_FINE(A), LL(IDENT,
      cx + ux * (tread / 2 - 0.025), top - 0.021, cz + uz * (tread / 2 - 0.025), yaw,
      w - 0.14, 0.042, 0.05), { masks: [0.85, 0.28, 0.04] });
    // every fourth riser carries a cast number-plate, worn back to the metal
    if (i % 4 === 2) {
      A.add('metal_rust', BOX_THIN(A), LL(IDENT,
        cx + ux * (tread / 2) + Math.cos(yaw) * (w / 2 - 0.34), top - riser * 0.55,
        cz + uz * (tread / 2) - Math.sin(yaw) * (w / 2 - 0.34), yaw, 0.14, 0.08, 0.02),
        { masks: [0.9, 0.75, 0.1] });
    }
  }

  // the stringers: a raked slab down each side, standing proud of the treads
  const mid = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const slabLen = Math.hypot(run, rise) + 0.5;
  for (const s of [-1, 1]) {
    const sx = Math.cos(yaw) * s * (w / 2 + 0.13);
    const sz = -Math.sin(yaw) * s * (w / 2 + 0.13);
    A.add(opts.kerbKey ?? 'concrete_dark', box,
      LL(IDENT, mid[0] + sx, mid[1] - 0.02, mid[2] + sz, yaw, 0.28, 0.72, slabLen, -pitch),
      { masks: [0.62, 0.36, 0.12] });
    A.box(surface, mid[0] + sx, mid[1] - 0.02, mid[2] + sz, 0.28, 0.72, slabLen, yaw, -pitch);
    /**
     * THE HANDRAIL IS RAKED, which is why `plains-works.handrail` is not used
     * for it: that one lays a level run at one height, and a level rail over a
     * pitched flight is a pipe that starts at the knee and ends over the head.
     * Two raked runs on posts set on the stringer, exactly as a real one is.
     */
    if (opts.rail !== false) {
      for (const rh of [1.02, 0.56]) {
        A.add('metal_rust', BOX_THIN(A),
          LL(IDENT, mid[0] + sx, mid[1] + rh + 0.34, mid[2] + sz, yaw, 0.055, 0.055, slabLen, -pitch),
          { masks: [0.85, 0.5, 0] });
      }
      const posts = Math.max(3, Math.round(run / 1.9));
      for (let k = 0; k <= posts; k++) {
        const t = k / posts;
        A.add('metal_rust', BOX_THIN(A),
          LL(IDENT, x0 + dx * t + sx, y0 + rise * t + 0.86, z0 + dz * t + sz, yaw, 0.06, 1.04, 0.06),
          { masks: [0.9, 0.55, 0] });
      }
    }
  }

  // the landings, flat, at each end's own height and overlapping the flight
  for (const [lx, lz, ly, dir] of [[x0, z0, y0, -1], [x1, z1, y1, 1]]) {
    const ox = ux * dir * 0.65;
    const oz = uz * dir * 0.65;
    A.add(key, box, LL(IDENT, lx + ox, ly - 0.18, lz + oz, yaw, w, 0.36, 1.6), { masks: [0.5, 0.35, 0.12] });
    A.box(surface, lx + ox, ly - 0.18, lz + oz, w, 0.36, 1.6, yaw);
  }
  /**
   * THE CHEVRON AT THE FOOT. Emissive, on the ground, pointing up the flight.
   * It is a REAL light source in the render's terms and no light slot at all —
   * `world`'s punctual-light count is what forces every material's program
   * cache key, so the way to sign a stair on a night map is emission, not lamps.
   */
  for (let k = 0; k < 3; k++) {
    A.add('ember', BOX_SOFT(A), LL(IDENT,
      x0 - ux * (0.5 + k * 0.42), y0 + 0.05, z0 - uz * (0.5 + k * 0.42), yaw,
      w * (0.72 - k * 0.16), 0.03, 0.13));
  }
  /**
   * ────────────────────────────────────────────────────────────────────────
   * AND THE FLIGHT ITSELF, AS A LINE OF LIGHT — `opts.marks`
   * ────────────────────────────────────────────────────────────────────────
   * The chevron is 1.1 m of emission on the ground and it is legible at eight
   * metres (`shots/nfapproach-before/west-stair-foot.png`) and at nothing
   * further, because there is nothing to see from a bearing that is not square
   * on to it. A stud on the head of every fifth tread, both stringers, draws
   * TWO CONVERGING DOTTED LINES 8.4 m long at 21° — and a raked line of lights
   * on an otherwise black mass is a stair from any bearing and any range. It is
   * also what a real stair in a blackout is marked with.
   *
   * Every fifth tread is 2.0 m of spacing at `TREAD` 0.40, which stays a line
   * of separate lights at 30 m rather than becoming one bar. Nine studs a
   * flight; 0.09 m cubes sunk into the top of the stringer, so there is nothing
   * standing proud of anything anybody walks on.
   */
  if (opts.marks) {
    for (let i = 2; i < steps; i += 5) {
      const top = y0 + (i + 1) * riser;
      const cx = x0 + ux * (i + 0.5) * tread;
      const cz = z0 + uz * (i + 0.5) * tread;
      for (const s of [-1, 1]) {
        A.add('ember', BOX_FINE(A), LL(IDENT,
          cx + Math.cos(yaw) * s * (w / 2 + 0.13), top + 0.31, cz - Math.sin(yaw) * s * (w / 2 + 0.13),
          yaw, 0.1, 0.09, 0.1));
      }
    }
  }
  return { run, grade: riser / tread, steps, tread, riser, yaw };
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT SAYS "THE WAY IN IS HERE" FROM A HUNDRED METRES
 * ════════════════════════════════════════════════════════════════════════════
 * 「入る場所がわからない」 is a legibility problem before it is a geometry one,
 * and the measurement that settles it is a photograph rather than a plan: at
 * 40 m off the north face, at 21:40, THE WHOLE TOWER IS BLACK — one HUD marker
 * and no edge, no door, no opening (`shots/nfapproach-before/from-northbase-40m
 * .png`). Nothing on 38 m of concrete emits anything below the beacon at the
 * masthead, and the beacon says where the tower is, not how to get into it.
 *
 * Everything here is EMISSION and not one of it is a light. `world`'s punctual
 * count forces every material's program cache key on this renderer, so six new
 * lamps would recompile the map; an `ember` box is free and is what the stair
 * chevrons already are — and the note in the previous pass says those are
 * exactly the parts that still carry in the dark. So: more of the thing that
 * works, in the places a man is looking.
 *
 *   TWO PYLONS at the foot, 3.2 m, one either side, each with a full-height
 *   strip on both of its along-the-approach faces — a lit gateway you can see
 *   past the corner of the podium and from any bearing in the half-plane.
 *   A BOARD on the podium face beside the foot, with a chevron on it pointing
 *   at the stair: the thing that reads from the middle distance, where the
 *   pylons are two dots and the tower is a mass.
 *
 * The pylons are 0.6 m clear of the flight's 3.6 m width on each side, so the
 * stair keeps every centimetre of its clear width — props in a doorway is five
 * separate shipped bugs on this repo and a lit one is still a prop. Nothing
 * spans OVER the foot: an overhead member across a route ground bots walk is
 * the one thing `NavGrid` cannot be told to ignore, and a portal lintel is not
 * worth the island.
 */
function stairMarks(A, c, y) {
  const box = BOX(A);
  const yaw = Math.atan2(c.tx, c.tz);
  /** (u, v) in the face's own frame — u out along the normal, v along it. */
  const P = (u, v) => [TOWER.x + c.nx * u + c.tx * v, TOWER.z + c.nz * u + c.tz * v];

  // ---- the two pylons flanking the foot -----------------------------------
  /**
   * ONE PYLON, AND IT IS OUTBOARD, BECAUSE THERE IS NO INBOARD. The flight's
   * centreline stands at u 22.95 and its inner edge at 21.15 — 0.15 m off a
   * podium face at u 21. A second pylon "flanking" the foot on the inside was
   * authored, built, and photographed: it is 0.45 m INSIDE three metres of
   * concrete, drawn nowhere and colliding with the mass it is buried in. What
   * pairs with the pylon is the board on the face opposite it, and that is the
   * gateway — a lit post on the open side, a lit sign on the wall side.
   */
  const vF = -RUN1 / 2 - 1.35;
  {
    const [px, pz] = P(OUT1 + FLIGHT_W / 2 + 0.55, vF);
    /**
     * THE POST IS PALE AND IT HAS BANDS ON IT, and that is not decoration. The
     * first cut of this stood a `concrete_dark` post under a 2.5 m strip of
     * emission, and at 32 m the post was invisible and the strip was a slab of
     * orange light hanging in the air with nothing under it — which is the
     * shape of the complaint about this map's graphics, not the answer to it.
     * A light on a night map has to have a thing holding it up.
     */
    A.add('concrete', box, LL(IDENT, px, y(1.55), pz, yaw, 0.34, 3.1, 0.34),
      { masks: [0.2, 0.25, 0.9] });
    A.box('concrete', px, y(1.55), pz, 0.34, 3.1, 0.34, yaw);
    for (let k = 0; k < 3; k++) {
      A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, px, y(0.55 + k * 0.85), pz, yaw, 0.38, 0.26, 0.38),
        { masks: [0.85, 0.3, 0.05] });
    }
    // the strip down each face that looks along the approach, and the head lamp
    for (const f of [-1, 1]) {
      A.add('ember', BOX_SOFT(A), LL(IDENT,
        px + c.tx * f * 0.18, y(1.6), pz + c.tz * f * 0.18, yaw, 0.1, 1.85, 0.035));
    }
    A.add('ember', BOX_SOFT(A), LL(IDENT, px, y(3.02), pz, yaw, 0.26, 0.14, 0.26));
    // a hood over the lamp, so the pylon has a shape and not only a glow
    A.add('metal_dark', BOX_THIN(A), LL(IDENT, px, y(3.16), pz, yaw, 0.48, 0.1, 0.48),
      { masks: [0.8, 0.5, 0.15] });
  }

  /**
   * ---- the board on the podium face, beside the foot ----------------------
   * Flat against the face and 0.14 m proud of it, which is nothing to walk into
   * and nothing for `_scatterblock` to find: its lowest edge is at 1.55 m.
   */
  const [bx, bz] = P(P1_R + 0.07, -RUN1 / 2 + 0.9);
  A.add('metal_dark', box, LL(IDENT, bx, y(2.15), bz, yaw, 0.14, 1.3, 2.6),
    { masks: [0.85, 0.5, 0.1] });
  // the chevron on it, pointing up the flight
  for (let k = 0; k < 3; k++) {
    const [cx, cz] = P(P1_R + 0.15, -RUN1 / 2 + 0.9 + (k - 1) * 0.62);
    A.add('ember', BOX_SOFT(A), LL(IDENT, cx, y(2.15), cz, yaw,
      0.05, 1.02 - k * 0.16, 0.17));
  }
  // …and a bar under it, so the board reads as a sign and not as a window
  const [ux2, uz2] = P(P1_R + 0.12, -RUN1 / 2 + 0.9);
  A.add('ember', BOX_SOFT(A), LL(IDENT, ux2, y(1.52), uz2, yaw, 0.05, 0.09, 2.3));
}

// ─────────────────────────────────────────────────────────────────── podium ──
/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHERE THE CLIMBS STAND — AND WHY THERE ARE THREE OF THEM NOW
 * ════════════════════════════════════════════════════════════════════════════
 * 「管制塔も入る場所がわからないし、階段の設置も修正されていない」, said while
 * playing, with the two-flight rebuild already in the build he was playing. So
 * the thing to establish was not whether the stairs work — eleven bots use them
 * — but what a man SEES on the way in. Measured, from a standing eye at 1.62 m:
 *
 *   FROM ZONE D, 32 m AWAY, LOOKING AT THE TOWER: a blank battered wall 28 m
 *   wide and 3.2 m tall, with two floating HUD markers over it and no stair,
 *   no door and no opening anywhere in the frame.
 *   (`shots/nfapproach-before/D-centre-look-tower.png`)
 *
 * And that is not a lighting accident, it is the plan. Both climbs stood on the
 * ±X faces, and the podium is a 21 m octagon: the sightline from D's centre
 * (0, 0) to the WEST stair's foot (-22.95, -27.79) passes 20.4 m from the
 * tower's axis and the one to the EAST foot passes 20.6 m — both inside 21 m of
 * solid concrete. NEITHER STAIR IS VISIBLE FROM THE CAPTURE POINT THE TOWER
 * EXISTS TO OVERLOOK, and the arithmetic says so before the camera does.
 *
 * From the north base's bearing it is worse but for a different reason: at 40 m
 * off the north face the whole tower is a black mass with nothing on it at all
 * (`from-northbase-40m.png`). The ember chevrons at a stair foot are bright and
 * they read — at eight metres. They are 1.1 m of emission on a 38 m building.
 *
 * SO: A THIRD CLIMB, ON THE FACE THAT LOOKS AT ZONE D, and every climb signed
 * at a distance. @see `stairMarks`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ONE CLIMB, DESCRIBED ONCE, IN THE FACE'S OWN FRAME
 * ────────────────────────────────────────────────────────────────────────────
 * A climb is now a unit outward normal `n` and its tangent `t = (-nz, nx)`, and
 * every part of it is written in (u, v) — u out along the face's normal, v
 * along the face. The south climb is then the east climb turned through ninety
 * degrees and nothing else, which matters for two separate reasons:
 *
 *   the octagon has 90° symmetry, so the parapet gate, the flat it is cut in
 *   and the deck edge it arrives at are all the same pieces in the same places;
 *   and BOTH FLIGHTS STAY ON A CARDINAL AXIS, which is the whole of why a 0.40 m
 *   tread is legal here — @see the note on `TREAD`. A climb on a chamfer would
 *   put the run at 45° to the lattice, where one diagonal cell step is 1.131 m
 *   of run and 0.43 m of rise against `maxStep` 0.45. That is a 4 % margin on
 *   the one number this whole staircase is built around, and it is why the
 *   third climb is on a flat and not on the corner that faces D squarely.
 *
 *   u = OUT  (22.95) the outboard flight's centreline, 1.95 m clear of the face
 *   v = ±RUN1/2      the head and the foot, half a run either side of centre
 *
 * The foot of each opens on a different bearing: EAST opens north (the north
 * base's), WEST opens south, SOUTH opens east (the south base's, and D's).
 */
const RUN1 = P1_TOP / RAMP_GRADE;
const RUN2 = (P2_TOP - P1_TOP) / RAMP_GRADE;
const OUT1 = P1_R + FLIGHT_W / 2 + 0.15;
const climb = (nx, nz, opts = {}) => {
  const tx = -nz, tz = nx;
  const P = (u, v) => [TOWER.x + nx * u + tx * v, TOWER.z + nz * u + tz * v];
  return {
    nx, nz, tx, tz,
    /** the ground flight, outboard of the P1 face and parallel to it */
    foot: P(OUT1, -RUN1 / 2),
    head: P(OUT1, RUN1 / 2),
    /** the radial flight over the P1 deck, from the parapet gate up to P2 */
    up0: P(P2_R + RUN2 - 0.6, RUN1 / 2),
    up1: P(P2_R - 0.6, RUN1 / 2),
    /** where each parapet is cut. Only the tangential component is used. */
    gate1: P(P1_R, RUN1 / 2),
    gate2: P(P2_R, RUN1 / 2),
    /**
     * THE CHEEK WALL IS THE ONE PIECE THE SOUTH CLIMB DOES NOT GET. On the ±X
     * climbs it stands one flight-width further out and covers a man on the
     * stair from the flank — but "further out" on the south climb is the side
     * zone D is on, so the wall would stand between the capture point and the
     * only stair that can be seen from it. The complaint is that the way in
     * cannot be found; a 3.6 m wall across it is the complaint.
     */
    cheek: opts.cheek !== false,
  };
};
/**
 * ONE PER CARDINAL FACE, and the fourth is the one the attack walks into for
 * the first minute of every round. Measured from the north base's bearing at
 * 40 m: nothing. The east climb's foot does open north, but the north base is
 * at x -14 and the foot is at x +22.95, so from due north it is thirty degrees
 * off the axis and behind the corner of a 21 m octagon; the west climb's foot
 * is on the far side of the podium entirely.
 *
 * The previous pass's own note says four ramps all round the outside "reads as
 * a car park", and it was right about what it was looking at: four smooth
 * wedges at one gradient with nothing on them and no sign at any of them. Four
 * STAIRS, each with a nosed tread, a raked handrail, a lit pylon pair, a signed
 * board and a gate in the parapet at its head is the opposite argument — the
 * building tells you where its doors are from every side, which is the entire
 * complaint. What it is NOT is four ways round the same corner: each foot
 * opens on its own bearing, so the four of them cover the compass.
 */
const CLIMBS = [
  climb(1, 0),    // east  — the foot opens NORTH
  climb(-1, 0),   // west  — the foot opens SOUTH
  climb(0, 1, { cheek: false }), // south — the face zone D looks at; foot opens EAST
  climb(0, -1),   // north — the attack's approach; foot opens WEST, at their base
];

/** Is (x, z) on or beside a flight? Keeps deck dressing out of the climb. */
function onClimb(x, z, margin = 1.1) {
  for (const c of CLIMBS) {
    const dx = x - TOWER.x, dz = z - TOWER.z;
    const u = dx * c.nx + dz * c.nz;
    const v = dx * c.tx + dz * c.tz;
    // flight I, outboard, running along the face
    if (Math.abs(u - OUT1) < FLIGHT_W / 2 + 1.0 + margin &&
        Math.abs(v) < RUN1 / 2 + 1.4 + margin) return true;
    // flight II, radial, running inward
    if (Math.abs(v - RUN1 / 2) < FLIGHT_W / 2 + margin &&
        u > P2_R - 2.4 && u < P1_R + 1.6) return true;
  }
  return false;
}

function buildPodium(A, rng, y, groundY, lights) {
  const box = BOX(A);

  /**
   * THE APRON — a skirt of hardstanding round the foot, so the podium meets the
   * plain on a made surface rather than on a razor edge through the grass. It is
   * flat ground: the nav grid keeps it exactly as it keeps the rest of the pad.
   */
  {
    const ap = at(octagon(P1_R + 4.4, P1_CUT + 1.2));
    prism(A, 'concrete_dark', ap, y(-0.55), y(0.06), { surface: 'concrete' });
    for (let i = 0; i < 130; i++) {
      const a = rng.float() * Math.PI * 2;
      const d = P1_R + rng.range(1.5, 8.5);
      const px = TOWER.x + Math.cos(a) * d;
      const pz = TOWER.z + Math.sin(a) * d;
      const g = patchGeometry(rng, rng.range(0.8, 3.0), { lobes: 11, wobble: 0.55 });
      A.addOnce('steppe_bare', g, LL(IDENT, px, groundY(px, pz) + 0.03, pz, rng.float() * 6.28,
        1, 1, rng.range(0.6, 1.4)), { masks: [0.5, rng.range(0.3, 0.8), 0.2] });
    }
  }

  // ---------------------------------------------------------------- P1 mass --
  prism(A, 'concrete', P1, y(0), y(P1_TOP), { surface: 'concrete' });
  faceDetail(A, rng, P1, 0, P1_TOP, y, { batter: 0.1, blind: true });
  deckWear(A, rng, P2_R, P1_R, y(P1_TOP));

  // ---------------------------------------------------------------- P2 mass --
  prism(A, 'concrete', P2, y(P1_TOP), y(P2_TOP), { surface: 'concrete' });
  faceDetail(A, rng, P2, P1_TOP, P2_TOP, y, { batter: 0.07 });
  deckWear(A, rng, SH_R, P2_R, y(P2_TOP));

  /**
   * THE PARAPETS. Chest high on the outer edge of both decks with embrasures cut
   * through them — cover you can shoot over standing and be behind crouched,
   * which is the only reason to walk up here at all.
   *
   * EVERY EDGE IS NOW WALLED AND THE CIRCULATION IS A GATE IN IT. The ±X flats
   * of P1 used to carry no parapet at all — twenty-eight metres of open deck
   * edge on each side, because that was where the ramps arrived — and the ±Z
   * flats of P2 were open for the same reason. A run that is skipped whole is a
   * platform you walk off in the dark; a run with a five-metre gate in it is
   * cover along its whole length AND a thing you can see the way up through
   * from anywhere on the deck. @see `parapetRun`'s `gap`.
   */
  /** The climb whose face this edge is, by the edge's own outward normal. */
  const climbOn = (e) => CLIMBS.find((k) =>
    Math.abs(e.nx - k.nx) < 0.05 && Math.abs(e.nz - k.nz) < 0.05);
  for (let i = 0; i < P1.length; i++) {
    const e = edgeInfo(P1, i);
    const c = climbOn(e);
    parapetRun(A, rng, e, y(P1_TOP), 1.16, i % 2 === 0,
      c ? { gap: { x: c.gate1[0], z: c.gate1[1], w: 5.4 } } : null);
  }
  for (let i = 0; i < P2.length; i++) {
    const e = edgeInfo(P2, i);
    const c = climbOn(e);
    parapetRun(A, rng, e, y(P2_TOP), 1.1, i % 2 === 1,
      c ? { gap: { x: c.gate2[0], z: c.gate2[1], w: 4.6 } } : null);
  }

  /**
   * THE TWO CLIMBS. @see the long note on `TREAD` — each is one straight line
   * from the plain to the gallery outside the control room's door, and the two
   * of them open in opposite directions so both approach bearings are met by
   * the bottom of a stair.
   */
  for (const c of CLIMBS) {
    // flight I — outboard of the podium face, climbing along it
    flight(A, rng, 'concrete', c.foot[0], c.foot[1], y(0), c.head[0], c.head[1], y(P1_TOP), FLIGHT_W,
      { fillKey: 'concrete_dark', baseY: y(-0.55), marks: true });
    /**
     * The cheek wall on the outside of the climb, so it is a cutting and not a
     * plank: a man on the stair is covered from the flank he is climbing away
     * from. It is held to ±(run/2 + 1.2) along the face because `TOWER_R` is
     * 25.4 and its face stands at 24.75 — `plains.js` keeps the plain's scatter
     * out of a circle of exactly that radius, and widening it would move several
     * thousand stones and tufts on somebody else's map.
     */
    if (c.cheek) {
      const w = P1_R + FLIGHT_W + 0.15;
      const l = RUN1 / 2 + 1.2;
      wallRun(A, rng, 'concrete_dark',
        TOWER.x + c.nx * w - c.tx * l, TOWER.z + c.nz * w - c.tz * l,
        TOWER.x + c.nx * w + c.tx * l, TOWER.z + c.nz * w + c.tz * l,
        { y0: y(-0.4), y1: y(P1_TOP - 0.2), t: 0.55, batter: 0.05, nx: c.nx, nz: c.nz, course: 0.7 });
    }
    // flight II — radial, inward, 2.6 m past the first's head
    flight(A, rng, 'concrete', c.up0[0], c.up0[1], y(P1_TOP), c.up1[0], c.up1[1], y(P2_TOP), FLIGHT_W,
      { fillKey: 'concrete_dark', baseY: y(P1_TOP - 0.45) });
    // …and what says, from three hundred metres, that any of this is here
    stairMarks(A, c, y);
  }

  /**
   * WHAT IS ON THE DECKS. A platform with nothing on it is a roof, and every
   * critique this project has had about procedural architecture has been about
   * exactly that — so both decks carry the things a position that has been held
   * for a while accumulates: ammunition revetments, cable drums, a generator set,
   * stacked ordnance boxes, and the cabling that ties the whole tower together.
   */
  deckFurniture(A, rng, y, lights);
}

/**
 * The face of a podium: pilasters on every angle, a string course, drip
 * mouldings, form-tie holes and the runoff stains under them.
 *
 * This is the "detail layer visible at 0.5 m" the quality bar asks for, and it
 * is geometry rather than texture because at night on this map the only thing
 * separating two surfaces is the shadow one throws on the other.
 */
function faceDetail(A, rng, pts, y0, y1, y, opts = {}) {
  const box = BOX(A);
  const fine = BOX_FINE(A);
  const h = y1 - y0;
  for (let i = 0; i < pts.length; i++) {
    const e = edgeInfo(pts, i);
    // the pilaster / buttress at each end of the run
    for (const t of [-0.5, 0.5]) {
      const px = e.mx + e.tx * e.len * t;
      const pz = e.mz + e.tz * e.len * t;
      A.add('concrete', box, LL(IDENT, px + e.nx * 0.16, y(y0 + h / 2), pz + e.nz * 0.16,
        e.yaw, 0.34, h, 1.05), { masks: [0.45, 0.3, 0.2] });
    }
    // a string course two thirds up, which is the line that reads at 150 m
    A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, e.mx + e.nx * 0.13, y(y0 + h * 0.68), e.mz + e.nz * 0.13,
      e.yaw, 0.26, 0.2, e.len - 0.4), { masks: [0.7, 0.42, 0.05] });
    // form-tie holes: 5 cm plugs on a 1.2 m grid, and the rust weep under each
    const cols = Math.max(2, Math.round(e.len / 1.35));
    const rows = Math.max(1, Math.round(h / 1.2));
    for (let cx = 0; cx < cols; cx++) {
      for (let ry = 0; ry < rows; ry++) {
        const t = (cx + 0.5) / cols - 0.5;
        const px = e.mx + e.tx * e.len * t;
        const pz = e.mz + e.tz * e.len * t;
        const py = y0 + (ry + 0.55) * (h / rows);
        A.add('concrete_dark', fine, LL(IDENT, px + e.nx * 0.055, y(py), pz + e.nz * 0.055,
          e.yaw, 0.075, 0.075, 0.06), { masks: [0.9, 0.75, 0.6] });
        if (rng.float() < 0.42) {
          A.add('metal_rust', BOX_THIN(A), LL(IDENT, px + e.nx * 0.05, y(py - 0.28), pz + e.nz * 0.05,
            e.yaw, 0.045, rng.range(0.25, 0.7), 0.012), { masks: [0.2, 1.0, 0.55] });
        }
      }
    }
    // blind arched recesses on the tall podium: relief, shadow and somewhere for
    // the eye to find the scale of the thing
    if (opts.blind && e.len > 8) {
      const bays = Math.max(2, Math.floor(e.len / 4.6));
      for (let b = 0; b < bays; b++) {
        const t = (b + 0.5) / bays - 0.5;
        const px = e.mx + e.tx * e.len * t;
        const pz = e.mz + e.tz * e.len * t;
        A.add('concrete_dark', box, LL(IDENT, px - e.nx * 0.14, y(y0 + h * 0.44), pz - e.nz * 0.14,
          e.yaw, 0.3, h * 0.62, 2.5), { masks: [0.25, 0.62, 0.72] });
        A.add('concrete', BOX_SOFT(A), LL(IDENT, px + e.nx * 0.1, y(y0 + h * 0.78), pz + e.nz * 0.1,
          e.yaw, 0.28, 0.16, 2.9), { masks: [0.6, 0.4, 0.15] });
      }
    }
  }
}

/**
 * A parapet run with an embrasure in the middle of the longer bays, and —
 * `opts.gap` — a STAIR GATE cut through it where a climb arrives.
 *
 * The gate is a real opening with a jamb pier either side and a lintel over it,
 * not an absence of wall: `NavGrid._sealCrossings` shuts a cell whose crossing
 * is blocked at 0.45 m, so the clear width has to be honest, and a man looking
 * along the deck has to be able to SEE that the way down is there.
 */
function parapetRun(A, rng, e, yTop, h, slit, opts = null) {
  const box = BOX(A);
  const t = 0.44;
  const ix = e.mx - e.nx * (t / 2 + 0.02);
  const iz = e.mz - e.nz * (t / 2 + 0.02);
  if (opts?.gap) {
    /**
     * Where along this edge the gate is, as an offset from its middle: the
     * projection of the gate's world point onto the edge's own tangent. Derived
     * rather than authored, so moving a flight moves its gate with it.
     */
    const off = (opts.gap.x - e.mx) * e.tx + (opts.gap.z - e.mz) * e.tz;
    const gw = opts.gap.w;
    for (const s of [-1, 1]) {
      const a = s < 0 ? -e.len / 2 : off + gw / 2;
      const b = s < 0 ? off - gw / 2 : e.len / 2;
      const seg = b - a;
      if (seg < 0.4) continue;
      const cx = ix + e.tx * ((a + b) / 2);
      const cz = iz + e.tz * ((a + b) / 2);
      A.add('concrete', box, LL(IDENT, cx, yTop + h / 2, cz, e.yaw, t, h, seg),
        { masks: [0.4 + rng.float() * 0.3, 0.3, 0.12] });
      A.box('concrete', cx, yTop + h / 2, cz, t, h, seg, e.yaw);
      A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, cx, yTop + h + 0.06, cz, e.yaw, t + 0.16, 0.12, seg),
        { masks: [0.75, 0.3, 0.05] });
      // the jamb: a taller pier on the gate side of each stub, so the opening
      // reads as a gateway from the far end of the deck
      const jx = ix + e.tx * (off + s * (gw / 2 + 0.28));
      const jz = iz + e.tz * (off + s * (gw / 2 + 0.28));
      A.add('concrete', box, LL(IDENT, jx, yTop + h * 0.78, jz, e.yaw, t + 0.34, h * 1.56, 0.56),
        { masks: [0.5, 0.35, 0.15] });
      A.box('concrete', jx, yTop + h * 0.78, jz, t + 0.34, h * 1.56, 0.56, e.yaw);
      A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, jx, yTop + h * 1.56 + 0.08, jz, e.yaw, t + 0.5, 0.16, 0.72),
        { masks: [0.8, 0.3, 0.05] });
      // and the lamp-less marker that says which way this hole goes
      A.add('ember', BOX_FINE(A), LL(IDENT, jx - e.nx * 0.3, yTop + h * 1.2, jz - e.nz * 0.3, e.yaw, 0.06, 0.5, 0.09));
      /**
       * …AND THE SAME MARKER ON THE OUTSIDE OF THE JAMB, which is the half of
       * it that was missing. The one above faces INBOARD: it tells a man
       * already on the deck where the way down is, and is invisible to the man
       * on the plain who is the one asking. This one is on the outward face,
       * so the head of every climb is two lit posts on the deck edge — the
       * mark that survives being seen from an oblique bearing at 150 m, when
       * the stair studs have foreshortened into one another.
       */
      A.add('ember', BOX_SOFT(A), LL(IDENT, jx + e.nx * 0.34, yTop + h * 0.86, jz + e.nz * 0.34,
        e.yaw, 0.05, h * 1.3, 0.11));
    }
    return;
  }
  if (slit && e.len > 6) {
    // two stubs and a firing slit between them
    const gap = 1.5;
    for (const s of [-1, 1]) {
      const seg = (e.len - gap) / 2;
      const cx = ix + e.tx * s * (gap / 2 + seg / 2);
      const cz = iz + e.tz * s * (gap / 2 + seg / 2);
      A.add('concrete', box, LL(IDENT, cx, yTop + h / 2, cz, e.yaw, t, h, seg),
        { masks: [0.4 + rng.float() * 0.3, 0.3, 0.12] });
      A.box('concrete', cx, yTop + h / 2, cz, t, h, seg, e.yaw);
      A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, cx, yTop + h + 0.06, cz, e.yaw, t + 0.16, 0.12, seg),
        { masks: [0.75, 0.3, 0.05] });
    }
    embrasure(A, ix, yTop + 0.62, iz, e.yaw + Math.PI / 2, gap, h - 0.62, t);
  } else {
    A.add('concrete', box, LL(IDENT, ix, yTop + h / 2, iz, e.yaw, t, h, e.len),
      { masks: [0.4 + rng.float() * 0.3, 0.3, 0.12] });
    A.box('concrete', ix, yTop + h / 2, iz, t, h, e.len, e.yaw);
    A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, ix, yTop + h + 0.06, iz, e.yaw, t + 0.16, 0.12, e.len),
      { masks: [0.75, 0.3, 0.05] });
    // sandbags along the inside of a plain run — the position has been held
    const n = Math.max(3, Math.round(e.len / 1.1));
    for (let i = 0; i < n; i++) {
      if (rng.float() < 0.32) continue;
      const tt = (i + 0.5) / n - 0.5;
      const px = ix - e.nx * 0.5 + e.tx * e.len * tt;
      const pz = iz - e.nz * 0.5 + e.tz * e.len * tt;
      for (let k = 0; k < 2; k++) {
        A.put(rng.float() < 0.5 ? 'sandbag_a' : 'sandbag_c', px + rng.range(-0.12, 0.12),
          yTop + 0.09 + k * 0.19, pz + rng.range(-0.12, 0.12),
          e.yaw + rng.range(-0.14, 0.14), rng.range(0.95, 1.12));
      }
    }
  }
}

/** Worn ground on a deck: the traffic pattern of a position people live on. */
function deckWear(A, rng, rI, rO, yTop) {
  for (let i = 0; i < 90; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = rI + 0.9 + rng.float() * Math.max(0.6, rO - rI - 2.2);
    const px = TOWER.x + Math.cos(a) * d;
    const pz = TOWER.z + Math.sin(a) * d;
    const g = patchGeometry(rng, rng.range(0.5, 1.9), { lobes: 11, wobble: 0.5 });
    A.addOnce(rng.float() < 0.5 ? 'road_dust' : 'steppe_bare', g,
      LL(IDENT, px, yTop + 0.022, pz, rng.float() * 6.28, 1, 1, rng.range(0.6, 1.3)),
      { masks: [0.55, rng.range(0.3, 0.85), 0.18] });
  }
}

/**
 * Ammunition, cable and plant on the two decks.
 *
 * EVERY DRAW IS TAKEN BEFORE ANYTHING IS SKIPPED, and the keep-out is
 * `onClimb`. A crate stacked in the head of a flight is the doorway bug this
 * repo has shipped five times, wearing a different hat: the old ramps had no
 * keep-out at all and the deck dressing could and did land on them.
 */
function deckFurniture(A, rng, y, lights) {
  const put = (id, px, pz, yy, ry, s) => A.put(id, px, yy, pz, ry, s ?? 1);
  // P1: revetments of ordnance boxes against the parapet, and a generator set
  for (let i = 0; i < 14; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = rng.range(13.5, 19.4);
    const px = TOWER.x + Math.cos(a) * d;
    const pz = TOWER.z + Math.sin(a) * d;
    const ry = rng.float() * 6.28;
    const stack = rng.int(1, 3);
    if (Math.abs(px - TOWER.x) > P1_R - 1.6 || Math.abs(pz - TOWER.z) > P1_R - 1.6) continue;
    if (onClimb(px, pz) || nearStore(px, pz, P1_TOP)) continue;
    for (let k = 0; k < stack; k++) {
      put(rng.float() < 0.5 ? 'crate_c' : 'crate_a', px + rng.range(-0.1, 0.1),
        pz + rng.range(-0.1, 0.1), y(P1_TOP) + 0.02 + k * 0.56, ry + rng.range(-0.1, 0.1));
    }
  }
  for (let i = 0; i < 9; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = rng.range(13.2, 19.0);
    const px = TOWER.x + Math.cos(a) * d;
    const pz = TOWER.z + Math.sin(a) * d;
    const id = rng.float() < 0.55 ? 'barrel_rust' : 'barrel_blue';
    const ry = rng.float() * 6.28;
    if (onClimb(px, pz) || nearStore(px, pz, P1_TOP)) continue;
    put(id, px, pz, y(P1_TOP) + 0.02, ry);
  }
  // the generator that keeps the beacon alight, and the conduit off it
  {
    const gx = TOWER.x + 15.5, gz = TOWER.z + 6.0;
    A.add('metal_dark', BOX(A), LL(IDENT, gx, y(P1_TOP) + 0.62, gz, 0.4, 2.4, 1.24, 1.35),
      { masks: [0.8, 0.55, 0.15] });
    A.box('metal', gx, y(P1_TOP) + 0.62, gz, 2.4, 1.24, 1.35, 0.4);
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, gx + 0.9, y(P1_TOP) + 1.75, gz - 0.4, 0.4, 0.16, 1.1, 0.16),
      { masks: [0.95, 0.7, 0] });
    for (let i = 0; i < 3; i++) {
      A.add('metal_dark', BOX_FINE(A), LL(IDENT, gx - 1.4, y(P1_TOP) + 0.2 + i * 0.09, gz + 1.0 + i * 0.1,
        0.4, 2.0, 0.06, 0.06), { masks: [0.7, 0.6, 0.3] });
    }
    lights.push(practical(A, gx - 0.4, y(P1_TOP) + 1.5, gz - 1.0, 0xffcf8e, 9, 15, { s: 0.16 }));
  }
  // P2: the gallery outside the room — cable trays, spare mast sections, a table
  for (let i = 0; i < 8; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = rng.range(8.2, 11.2);
    const px = TOWER.x + Math.cos(a) * d;
    const pz = TOWER.z + Math.sin(a) * d;
    const id = rng.pick(['crate_b', 'box_card_a', 'jerry_can', 'bucket']);
    const ry = rng.float() * 6.28;
    if (onClimb(px, pz, 0.6) || nearStore(px, pz, P2_TOP)) continue;
    put(id, px, pz, y(P2_TOP) + 0.02, ry);
  }
  lights.push(practical(A, TOWER.x + 8.6, y(P2_TOP) + 2.5, TOWER.z - 2.4, 0xffb066, 14, 18, { s: 0.2 }));

  /**
   * …AND THE STORES, LAST ON EACH DECK. After the scatter rather than before it
   * because the scatter is what has to give way: `nearStore` is consulted by
   * every loop above, so a post is a hole in the litter rather than a thing
   * buried under it.
   */
  buildStores(A, rng, y, P1_TOP);
  buildStores(A, rng, y, P2_TOP);
}

// ──────────────────────────────────────────────────────────────────── shaft ──
function buildShaft(A, rng, y) {
  const box = BOX(A);

  // the mass, storey by storey so each pour reads as its own lift
  prism(A, 'concrete', SH, y(P2_TOP), y(ROOF_Y), { collide: false });
  // …hollow: the walls are the collision, so the room inside is a real room
  for (let i = 0; i < SH.length; i++) {
    const e = edgeInfo(SH, i);
    const isDoor = DOORS.some((d) => Math.abs(e.nx - d.ax) < 0.05 && Math.abs(e.nz - d.az) < 0.05);
    if (isDoor) {
      // two piers and a lintel, so the door is a hole in the collision as well
      const seg = (e.len - DOOR_W) / 2;
      for (const s of [-1, 1]) {
        const cx = e.mx + e.tx * s * (DOOR_W / 2 + seg / 2);
        const cz = e.mz + e.tz * s * (DOOR_W / 2 + seg / 2);
        A.box('concrete', cx, y((ROOM_Y + ROOF_Y) / 2), cz, SH_WALL, ROOF_Y - ROOM_Y, seg, e.yaw);
      }
      A.box('concrete', e.mx, y(ROOM_Y + DOOR_H + (ROOF_Y - ROOM_Y - DOOR_H) / 2), e.mz,
        SH_WALL, ROOF_Y - ROOM_Y - DOOR_H, DOOR_W, e.yaw);
      doorSurround(A, rng, e, y);
    } else {
      A.box('concrete', e.mx, y((P2_TOP + ROOF_Y) / 2), e.mz, SH_WALL, ROOF_Y - P2_TOP, e.len, e.yaw);
    }
  }

  faceDetail(A, rng, SH, P2_TOP, ROOF_Y, y, { batter: 0 });
  shaftFaces(A, rng, y);
  shaftLining(A, rng, y);
  controlRoom(A, rng, y);
  shaftInterior(A, rng, y);

  // the roof deck over the shaft, under the cab: a real slab with a hatch
  A.add('concrete_dark', box, LL(IDENT, TOWER.x, y(ROOF_Y - 0.2), TOWER.z, 0, SH_R * 2, 0.4, SH_R * 2),
    { masks: [0.55, 0.4, 0.2] });
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE INSIDE FACE OF THE SHAFT — 「壁が透過されるバグもあるぞ？」
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT WAS ACTUALLY WRONG, and it is not a hole. Measured with a ray per screen
 * cell from a standing eye in the control room at (3.6, -32), looking at the
 * south wall six metres away (`_nftowersee.mjs`): ZERO per cent of the frame
 * reaches the sky and every cell hits a triangle inside 20 m — while the
 * PHOTOGRAPH of the same pose is panels of night sky between the piers with the
 * far mountains, the fires and B's EMP dome legible through them.
 *
 * Both are true. `buildShaft` draws the shaft as `prism(A, 'concrete', SH, …)`,
 * which is a CLOSED SOLID with its faces pointing OUTWARD, and then hollows it
 * for collision only — `{ collide: false }` plus one `A.box` per edge. The
 * material is `side: FrontSide`, so from inside the room every one of those
 * faces is a back face and the GPU throws it away. The shaft has no inside.
 * That is the same fault, on a wall instead of on the ground, as the winding
 * that made every `patchGeometry` sheet on this map invisible from above.
 *
 * So the fix is to DRAW THE INSIDE, and it is drawn-only: no `A.box`, no
 * `A.clipBox`, not one byte of collision moves and `NavGrid` cannot see it.
 * Panels sit flush on the inner face of the wall the collision already
 * describes, and they are cut where the wall is cut — round the four doorways
 * on the ground storey and round the slit window on every storey above, so the
 * openings read from inside exactly as they read from outside. Anything else
 * would trade a wall you can see through for a window you cannot.
 */
function shaftLining(A, rng, y) {
  const box = BOX(A);
  /** Thin, and flush with the inner face of the wall `buildShaft` collides. */
  const T = 0.1;
  const off = SH_WALL / 2 - T / 2;
  /** One panel, in the face's own frame: `cv` along the edge, `w` long. */
  const panel = (e, cy, h, cv, w) => {
    if (h <= 0.03 || w <= 0.03) return;
    A.add('concrete_dark', box, LL(IDENT,
      e.mx - e.nx * off + e.tx * cv, y(cy), e.mz - e.nz * off + e.tz * cv,
      e.yaw, T, h, w), { masks: [0.32, 0.5, 0.55] });
  };
  /** A full-width band, with the doorway cut out of it if it crosses one. */
  const band = (e, y0, y1, doorway) => {
    if (y1 - y0 <= 0.03) return;
    const head = ROOM_Y + DOOR_H;
    if (!doorway || y0 >= head) { panel(e, (y0 + y1) / 2, y1 - y0, 0, e.len); return; }
    const seg = (e.len - DOOR_W) / 2;
    const lo = Math.min(y1, head);
    for (const s of [-1, 1]) panel(e, (y0 + lo) / 2, lo - y0, s * (DOOR_W / 2 + seg / 2), seg);
    if (y1 > head) panel(e, (head + y1) / 2, y1 - head, 0, e.len);
  };
  for (let i = 0; i < SH.length; i++) {
    const e = edgeInfo(SH, i);
    const isDoor = DOORS.some((d) => Math.abs(e.nx - d.ax) < 0.05 && Math.abs(e.nz - d.az) < 0.05);
    /**
     * The slits, taken from `shaftFaces` rather than restated: same storeys,
     * same 1.35 m of pane, same width. A reveal 0.15 m proud of the opening on
     * each side is what makes it read as a hole in a thickness.
     */
    const slits = [];
    if (e.len >= 3) {
      for (let f = 1; f < FLOORS.length; f++) {
        const wy = FLOORS[f] + 1.35;
        slits.push([wy - 0.82, wy + 0.82, Math.min(1.5, e.len - 1.6) + 0.5]);
      }
    }
    let y0 = ROOM_Y;
    for (const [s0, s1, sw] of slits) {
      band(e, y0, s0, isDoor);
      const cheek = (e.len - sw) / 2;
      for (const s of [-1, 1]) panel(e, (s0 + s1) / 2, s1 - s0, s * (sw / 2 + cheek / 2), cheek);
      y0 = s1;
    }
    band(e, y0, ROOF_Y, isDoor && !slits.length);
  }
}

/** The jamb, the head and the steel of one of the room's four doors. */
function doorSurround(A, rng, e, y) {
  const box = BOX(A);
  for (const s of [-1, 1]) {
    const cx = e.mx + e.tx * s * (DOOR_W / 2 + 0.11);
    const cz = e.mz + e.tz * s * (DOOR_W / 2 + 0.11);
    A.add('metal_dark', box, LL(IDENT, cx, y(ROOM_Y + DOOR_H / 2), cz, e.yaw, SH_WALL + 0.1, DOOR_H + 0.2, 0.22),
      { masks: [0.85, 0.5, 0.15] });
  }
  A.add('metal_dark', box, LL(IDENT, e.mx, y(ROOM_Y + DOOR_H + 0.12), e.mz, e.yaw,
    SH_WALL + 0.1, 0.24, DOOR_W + 0.44), { masks: [0.85, 0.5, 0.15] });
  // the blast door itself, standing open against the wall
  const s = rng.float() < 0.5 ? -1 : 1;
  A.add('metal_green', box, LL(IDENT,
    e.mx + e.nx * 0.14 + e.tx * s * (DOOR_W / 2 + 0.55), y(ROOM_Y + DOOR_H / 2 - 0.06),
    e.mz + e.nz * 0.14 + e.tz * s * (DOOR_W / 2 + 0.55), e.yaw, 0.09, DOOR_H - 0.12, DOOR_W - 0.1),
    { masks: [0.9, 0.55, 0.1] });
  // the concrete threshold, worn by everything that has been dragged over it
  A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, e.mx, y(ROOM_Y - 0.05), e.mz, e.yaw,
    SH_WALL + 0.5, 0.14, DOOR_W + 0.3), { masks: [0.95, 0.45, 0.05] });
  /**
   * THE DOOR IS LIT FROM THE JAMB. 「入る場所がわからない」 is about the door as
   * much as the stair: the room has two bulbs in it, but from the P2 gallery
   * a 2.1 m hole in a black wall at night is a slightly darker patch of black.
   * A strip down each jamb and one across the head is the shape of the opening
   * drawn in light, and it costs no light slot — @see `stairMarks`. It also
   * marks the door from the AIR and from the P1 deck below, which is where the
   * two bot posts on this tower stand.
   */
  for (const s of [-1, 1]) {
    A.add('ember', BOX_SOFT(A), LL(IDENT,
      e.mx + e.nx * 0.5 + e.tx * s * (DOOR_W / 2 + 0.05), y(ROOM_Y + DOOR_H / 2 - 0.05),
      e.mz + e.nz * 0.5 + e.tz * s * (DOOR_W / 2 + 0.05), e.yaw, 0.06, DOOR_H - 0.3, 0.09));
  }
  A.add('ember', BOX_SOFT(A), LL(IDENT, e.mx + e.nx * 0.5, y(ROOM_Y + DOOR_H + 0.02), e.mz + e.nz * 0.5,
    e.yaw, 0.06, 0.09, DOOR_W + 0.1));
}

/**
 * The shaft's elevations: a slit window per storey per face, the vertical
 * cable duct that feeds the cab, and the ladder up the north face.
 */
function shaftFaces(A, rng, y) {
  const box = BOX(A);
  for (let i = 0; i < SH.length; i++) {
    const e = edgeInfo(SH, i);
    if (e.len < 3) continue;
    for (let f = 1; f < FLOORS.length; f++) {
      const wy = FLOORS[f] + 1.35;
      const w = Math.min(1.5, e.len - 1.6);
      // the reveal, the dark room behind it and the light some of them carry
      A.add('window_void', PANE(A), LL(IDENT, e.mx - e.nx * 0.02, y(wy), e.mz - e.nz * 0.02,
        e.yaw + Math.PI / 2, w + 0.2, 1.35, 1), { masks: [0.15, 0.9, 0.95] });
      A.add('metal_dark', box, LL(IDENT, e.mx + e.nx * 0.08, y(wy + 0.72), e.mz + e.nz * 0.08,
        e.yaw, 0.3, 0.22, w + 0.6), { masks: [0.8, 0.5, 0.1] });
      A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, e.mx + e.nx * 0.11, y(wy - 0.7), e.mz + e.nz * 0.11,
        e.yaw, 0.36, 0.14, w + 0.5), { masks: [0.85, 0.4, 0.05] });
      // mullion bars
      for (const s of [-0.3, 0.3]) {
        A.add('metal_rust', BOX_THIN(A), LL(IDENT, e.mx + e.nx * 0.03 + e.tx * s * w,
          y(wy), e.mz + e.nz * 0.03 + e.tz * s * w, e.yaw, 0.04, 1.3, 0.04), { masks: [0.9, 0.6, 0] });
      }
      // runoff off the sill, which is what a concrete tower actually looks like
      if (rng.float() < 0.6) {
        A.add('concrete_dark', BOX_THIN(A), LL(IDENT, e.mx + e.nx * 0.045 + e.tx * rng.range(-0.5, 0.5),
          y(wy - 1.4), e.mz + e.nz * 0.045 + e.tz * rng.range(-0.5, 0.5), e.yaw,
          rng.range(0.1, 0.32), rng.range(0.8, 2.0), 0.014), { masks: [0.15, 1.0, 0.5] });
      }
    }
    // the cable duct: a fat steel trunking that climbs the whole shaft
    if (Math.abs(e.nx - 1) < 0.05) {
      A.add('metal_dark', box, LL(IDENT, e.mx + e.nx * 0.24, y((ROOM_Y + ROOF_Y) / 2), e.mz,
        e.yaw, 0.42, ROOF_Y - ROOM_Y, 0.66), { masks: [0.75, 0.55, 0.2] });
      for (let k = 0; k < 12; k++) {
        A.add('metal_rust', BOX_FINE(A), LL(IDENT, e.mx + e.nx * 0.3, y(ROOM_Y + 0.9 + k * 1.55), e.mz,
          e.yaw, 0.13, 0.1, 0.86), { masks: [0.9, 0.65, 0.1] });
      }
    }
    // the ladder to the cab roof, on the opposite face
    if (Math.abs(e.nx + 1) < 0.05) {
      ladder(A, e.mx + e.nx * 0.35, y(ROOM_Y + 0.4), y(ROOF_Y), e.mz, Math.PI / 2);
    }
  }
}

/**
 * THE CONTROL ROOM — the one interior on this tower a bot can be in, and the
 * reason `world.interiorVolumes` carries a record for it.
 *
 * Everything with a collision proxy is tested against the four door circles with
 * its OWN extent (`A.footprintR`), not with its centre. A crate is 0.64 m across
 * and a shelf unit 1.1; "the centre cleared the circle and the body of the object
 * did not" is written in `builder.js` about the exact bug this avoids.
 */
function controlRoom(A, rng, y) {
  const box = BOX(A);
  const inR = SH_R - SH_WALL / 2;

  /**
   * THE FLOOR RUNS OUT UNDER THE WALLS AND THROUGH EVERY DOOR REVEAL, which is
   * not tidiness: a slab clipped to the inner face leaves a 0.47 m ring of no
   * floor inside each doorway, the interior re-probe finds the podium 0.14 m
   * below it, and the real capsule then clips the slab's edge and comes back
   * BLOCKED. Measured on the first build: one dead cell per door, and the
   * control room sat in its own 84-cell component with four doors nobody could
   * walk through. So the slab is the shaft's whole octagon.
   */
  prism(A, 'concrete', SH, y(ROOM_Y - 0.5), y(ROOM_Y), { surface: 'concrete' });
  A.add('floor_concrete', box, LL(IDENT, TOWER.x, y(ROOM_Y - 0.02), TOWER.z, 0, inR * 2, 0.05, inR * 2), {
    paint: (x, yy, z, nx, ny, nz, out) => {
      const n = fbm3(x * 0.7 + 3.3, yy, z * 0.7, 3);
      const grid = Math.min(Math.abs(((x + 40) % 1.2) - 0.6), Math.abs(((z + 40) % 1.2) - 0.6)) / 0.6;
      out[0] = Math.min(1, 0.3 + n * 0.5 + (1 - grid) * 0.25);
      out[1] = Math.min(1, 0.25 + n * 0.5);
      out[2] = Math.min(1, 0.15 + (1 - grid) * 0.3);
    },
  });

  // the four internal piers that carry the storeys above — cover, and the reason
  // a 11 m room is a fight and not a box
  for (const [px, pz] of [[-3.1, -3.1], [3.1, -3.1], [-3.1, 3.1], [3.1, 3.1]]) {
    A.add('concrete_dark', box, LL(IDENT, TOWER.x + px, y(ROOM_Y + (FLOORS[1] - ROOM_Y) / 2), TOWER.z + pz,
      0.785, 0.9, FLOORS[1] - ROOM_Y, 0.9), { masks: [0.4, 0.35, 0.3] });
    A.box('concrete', TOWER.x + px, y(ROOM_Y + (FLOORS[1] - ROOM_Y) / 2), TOWER.z + pz,
      0.9, FLOORS[1] - ROOM_Y, 0.9, 0.785);
    // the corbel where the pier takes the slab
    A.add('concrete', BOX_SOFT(A), LL(IDENT, TOWER.x + px, y(FLOORS[1] - 0.55), TOWER.z + pz,
      0.785, 1.35, 0.32, 1.35), { masks: [0.55, 0.35, 0.25] });
  }

  // the plotting table in the middle — the thing the room is for
  A.add('metal_dark', box, LL(IDENT, TOWER.x, y(ROOM_Y + 0.82), TOWER.z, 0.3, 2.6, 0.1, 1.7),
    { masks: [0.8, 0.5, 0.2] });
  for (const [px, pz] of [[-1.1, -0.65], [1.1, -0.65], [-1.1, 0.65], [1.1, 0.65]]) {
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, TOWER.x + px * 0.96 - pz * 0.3, y(ROOM_Y + 0.41),
      TOWER.z + px * 0.3 + pz * 0.96, 0.3, 0.07, 0.82, 0.07), { masks: [0.9, 0.6, 0] });
  }
  A.box('wood', TOWER.x, y(ROOM_Y + 0.45), TOWER.z, 2.6, 0.9, 1.7, 0.3);
  A.add('window_glow', BOX_FINE(A), LL(IDENT, TOWER.x, y(ROOM_Y + 0.88), TOWER.z, 0.3, 2.2, 0.02, 1.3),
    { masks: [0.2, 0.3, 0] });

  // equipment racks against the two walls without a door in front of them
  for (const [ax, az] of [[-0.707, -0.707], [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707]]) {
    const bx = TOWER.x + ax * (inR - 0.85);
    const bz = TOWER.z + az * (inR - 0.85);
    const yaw = Math.atan2(-ax, -az);
    for (let k = -1; k <= 1; k++) {
      const px = bx + Math.cos(yaw) * k * 0.95;
      const pz = bz - Math.sin(yaw) * k * 0.95;
      A.add('metal_dark', box, LL(IDENT, px, y(ROOM_Y + 1.0), pz, yaw, 0.86, 2.0, 0.62),
        { masks: [0.7, 0.45, 0.25] });
      A.box('metal', px, y(ROOM_Y + 1.0), pz, 0.86, 2.0, 0.62, yaw);
      for (let r = 0; r < 6; r++) {
        A.add('metal_rust', BOX_FINE(A), LL(IDENT, px - Math.sin(yaw) * 0.33, y(ROOM_Y + 0.35 + r * 0.28),
          pz - Math.cos(yaw) * 0.33, yaw, 0.78, 0.16, 0.05), { masks: [0.85, 0.6, 0.1] });
        if (rng.float() < 0.35) {
          A.add('ember', BOX_FINE(A), LL(IDENT, px - Math.sin(yaw) * 0.36 + Math.cos(yaw) * rng.range(-0.3, 0.3),
            y(ROOM_Y + 0.35 + r * 0.28), pz - Math.cos(yaw) * 0.36 - Math.sin(yaw) * rng.range(-0.3, 0.3),
            yaw, 0.04, 0.03, 0.02));
        }
      }
    }
  }

  // …and the loose stores, which is where the door test earns its keep
  const clear = DOORS.map((d) => ({
    x: TOWER.x + d.ax * (SH_R + 0.4), z: TOWER.z + d.az * (SH_R + 0.4),
  }));
  const ids = ['crate_a', 'crate_b', 'crate_c', 'barrel_rust', 'jerry_can', 'box_card_a', 'bucket', 'pallet'];
  let placed = 0;
  for (let i = 0; i < 90 && placed < 22; i++) {
    const px = TOWER.x + rng.range(-inR + 0.7, inR - 0.7);
    const pz = TOWER.z + rng.range(-inR + 0.7, inR - 0.7);
    if (Math.hypot(px - TOWER.x, pz - TOWER.z) < 2.2) continue; // the table
    const id = rng.pick(ids);
    const s = rng.range(0.9, 1.1);
    const r = (A.footprintR(id, s) ?? 0.4) + 0.15;
    let ok = true;
    for (const c of clear) {
      // the circle is measured to the object's EDGE, not to its centre
      if (Math.hypot(px - c.x, pz - c.z) < DOOR_CLEAR + r) { ok = false; break; }
    }
    if (!ok) continue;
    for (const [qx, qz] of [[-3.1, -3.1], [3.1, -3.1], [-3.1, 3.1], [3.1, 3.1]]) {
      if (Math.hypot(px - TOWER.x - qx, pz - TOWER.z - qz) < 0.85 + r) { ok = false; break; }
    }
    // …and off the two supply posts, by the same edge-not-centre measure
    if (nearStore(px, pz, ROOM_Y, 1.9 + r)) ok = false;
    if (!ok) continue;
    A.put(id, px, y(ROOM_Y) + 0.02, pz, rng.float() * 6.28, s);
    placed++;
  }

  /**
   * THE TWO POSTS THIS ROOM EXISTS FOR. They flank the plotting table along its
   * own long axis, which is the one line in here with no pier, no rack and no
   * door on it — 2.4 m from the table's edge, 2.4 m from the nearest pier and
   * 4.1 m from the nearest doorway, so `Caches.prove` has open floor to snap a
   * bot's standing cell onto and the man at the keyboard is never holding F
   * through a crate.
   */
  buildStores(A, rng, y, ROOM_Y);

  // two bulbs, because an unlit room at 21:40 is a black hole with a door in it
  practical(A, TOWER.x - 2.2, y(ROOM_Y + 3.4), TOWER.z + 1.4, 0xffc07a, 11, 14, { s: 0.14 });
  practical(A, TOWER.x + 2.4, y(ROOM_Y + 3.4), TOWER.z - 1.8, 0xffc07a, 9, 13, { s: 0.14 });
}

/**
 * The four storeys above the room. PLAYER ONLY, and said so in the header: a
 * height field with one floor per cell cannot hold a staircase, so these exist
 * for the man at the keyboard, for the silhouette and for the fight on the way
 * down. Each slab leaves a well, and each well has the flight that serves it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A STAIRCASE INTO A CEILING — 「階段治ってないけど？？」, THIRD TIME OF ASKING
 * ────────────────────────────────────────────────────────────────────────────
 * The two rebuilds before this one were both about the OUTSIDE climbs, and the
 * outside climbs are fine: photographed at a standing eye from the bottom step
 * to the gallery door, all four of them arrive where they say they do
 * (`shots/towerclimb/`). What he was standing in is this one, and it was
 * genuinely a stair into a soffit — photographed mid-flight between the control
 * room and storey 1, the frame is flat concrete from edge to edge.
 *
 * WHY, in one line: ONE straight flight per storey, every storey's flight in
 * the SAME 2.7 x 6.6 m plan slot, and every step drawn as a box from the FLOOR
 * up to its tread. So the flight above is a solid mass whose underside is flat
 * at the floor it stands on, sitting directly over the flight below — and the
 * two of them meet at the same end, because a straight flight that reverses
 * direction has nowhere else to turn. Measured on the old build: head clearance
 * over the top 4.9 m of every flight is under 1.8 m and reaches ZERO at the
 * final tread. The nav arithmetic the header spends a page on was never the
 * problem; the section was.
 *
 * WHAT IT IS NOW: A DOG-LEG, which is what a tower stair actually is. The well
 * is widened to hold two half-flights SIDE BY SIDE, they climb opposite ways
 * with a half-landing between them, and the near end of the well is closed to
 * make the arrival landing that joins one storey's top to the next one's foot.
 * Minimum head clearance is then half a storey everywhere — 2.43 m against the
 * 4.86 m rise — because the mass above any point on a half-flight is the SAME
 * half-flight one storey up, and that is half a storey higher by construction.
 *
 * NOTHING ABOVE THE CONTROL ROOM IS BOT GROUND and none of this changes that:
 * `NavGrid` drops one ray per cell from the sky and finds the cab. The audience
 * is the man at the keyboard, which is exactly who complained.
 */
/** The well, in the tower's own frame. Two half-flights wide. */
const WELL_X = 2.6;
const WELL_Z0 = -2.6, WELL_Z1 = 3.5;
/** Where the half-landing starts, so each half-flight runs WELL_Z0..LAND_Z. */
const LAND_Z = 2.0;
/** One half-flight: its centre off the axis, and its width. */
const FLIGHT_XO = 1.28, FLIGHT_XW = 2.3;

function shaftInterior(A, rng, y) {
  const box = BOX(A);
  const inR = SH_R - SH_WALL / 2;
  for (let f = 1; f < FLOORS.length + 1; f++) {
    const fy = f < FLOORS.length ? FLOORS[f] : ROOF_Y;
    const prev = FLOORS[f - 1];
    /**
     * THE SLAB, IN FOUR PIECES ROUND A WELL WIDE ENOUGH FOR TWO — @see the note
     * on `WELL_X` above. The near end (z < WELL_Z0) is the ARRIVAL LANDING: it
     * is the piece flight B tops out onto and the piece the next storey's
     * flight A starts from, so the two half-flights are joined by real floor
     * and not by the hole they used to share.
     */
    const side = inR - WELL_X;
    for (const s of [-1, 1]) {
      A.add('floor_concrete', box, LL(IDENT, TOWER.x + s * (inR - side / 2), y(fy - 0.14), TOWER.z, 0,
        side, 0.28, inR * 2), { masks: [0.4, 0.4, 0.3] });
      A.box('concrete', TOWER.x + s * (inR - side / 2), y(fy - 0.14), TOWER.z, side, 0.28, inR * 2);
    }
    for (const [z0, z1] of [[-inR, WELL_Z0], [WELL_Z1, inR]]) {
      A.add('floor_concrete', box, LL(IDENT, TOWER.x, y(fy - 0.14), TOWER.z + (z0 + z1) / 2, 0,
        WELL_X * 2, 0.28, z1 - z0), { masks: [0.4, 0.4, 0.3] });
      A.box('concrete', TOWER.x, y(fy - 0.14), TOWER.z + (z0 + z1) / 2, WELL_X * 2, 0.28, z1 - z0);
    }

    /**
     * THE TWO HALF-FLIGHTS AND THE HALF-LANDING. `A` climbs +Z on the west half
     * of the well, the landing turns you through 180°, `B` climbs -Z on the
     * east half and arrives on the landing slab above. Every storey is the same
     * pair, so the climb is one continuous dog-leg from the control room to the
     * roof deck and every turn is on a floor rather than in mid-air.
     */
    const rise = fy - prev;
    const mid = prev + rise / 2;
    const runZ = LAND_Z - WELL_Z0;
    for (const leg of [0, 1]) {
      const b0 = leg ? mid : prev, b1 = leg ? fy : mid;
      const xo = leg ? FLIGHT_XO : -FLIGHT_XO;
      const dir = leg ? -1 : 1;
      const steps = Math.max(4, Math.round((b1 - b0) / 0.185));
      const run = runZ / steps;
      const z0 = leg ? LAND_Z : WELL_Z0;
      for (let i = 0; i < steps; i++) {
        const top = b0 + (i + 1) * ((b1 - b0) / steps);
        const sz = TOWER.z + z0 + dir * (i + 0.5) * run;
        A.add('concrete_dark', box, LL(IDENT, TOWER.x + xo, y((b0 + top) / 2), sz, 0,
          FLIGHT_XW, top - b0, run), { masks: [0.65, 0.35, 0.2] });
        A.box('concrete', TOWER.x + xo, y(b0 + (i + 0.5) * ((b1 - b0) / steps)), sz,
          FLIGHT_XW, (b1 - b0) / steps, run);
        A.add('concrete', BOX_FINE(A), LL(IDENT, TOWER.x + xo, y(top - 0.03),
          sz + dir * (run / 2 - 0.03), 0, FLIGHT_XW - 0.03, 0.06, 0.05), { masks: [0.9, 0.25, 0.05] });
      }
    }
    // the half-landing at the turn, full width of the well
    A.add('floor_concrete', box, LL(IDENT, TOWER.x, y(mid - 0.14), TOWER.z + (LAND_Z + WELL_Z1) / 2, 0,
      WELL_X * 2, 0.28, WELL_Z1 - LAND_Z), { masks: [0.4, 0.4, 0.3] });
    A.box('concrete', TOWER.x, y(mid - 0.14), TOWER.z + (LAND_Z + WELL_Z1) / 2,
      WELL_X * 2, 0.28, WELL_Z1 - LAND_Z);
    // the rail down the open side of each half-flight and round the well
    handrail(A, 'metal_rust', TOWER.x, TOWER.z + WELL_Z0, TOWER.x, TOWER.z + WELL_Z1,
      y(fy - 0.14), { h: 1.05 });
    handrail(A, 'metal_rust', TOWER.x - WELL_X, TOWER.z + WELL_Z0, TOWER.x + WELL_X, TOWER.z + WELL_Z0,
      y(fy - 0.14), { h: 1.05 });
    // a storey's worth of stores and a bulb
    for (let i = 0; i < 5; i++) {
      const px = TOWER.x + (rng.float() < 0.5 ? -1 : 1) * rng.range(2.2, inR - 0.8);
      const pz = TOWER.z + rng.range(-inR + 0.8, inR - 0.8);
      const id = rng.pick(['crate_b', 'box_card_b', 'jerry_can', 'sandbag_b']);
      const ry = rng.float() * 6.28;
      const sc = rng.range(0.9, 1.1);
      if (nearStore(px, pz, fy, 2.2)) continue;
      // NOT OVER THE WELL. It is 5.2 m wide now, so the old 2.2 m stand-off
      // from the axis no longer clears it and a crate would hang in the stair.
      if (Math.abs(px - TOWER.x) < WELL_X + 0.6 &&
          pz - TOWER.z > WELL_Z0 - 0.6 && pz - TOWER.z < WELL_Z1 + 0.6) continue;
      A.put(id, px, y(fy) + 0.02, pz, ry, sc);
    }
    /**
     * …AND ON ONE OF THEM, THE RACK. Four storeys of stair is the price of the
     * map's second primary weapon, and that price is the point — it is the one
     * reward on this tower a bot can never take, because `NavGrid` is a height
     * field and an internal staircase is zero waypoints. @see `STORES`.
     */
    buildStores(A, rng, y, fy);
    if (f < FLOORS.length) {
      practical(A, TOWER.x + rng.range(-2, 2), y(fy + 3.2), TOWER.z + rng.range(-2, 2), 0xffc07a, 7, 11, { s: 0.12 });
    }
  }
}

// ────────────────────────────────────────────────────────────────────── cab ──
/**
 * THE CAB. Corbelled 2.1 m out over the shaft on a ring of brackets, glazed all
 * round with the panes CANTED OUTWARD — which is what every real control tower
 * does and is the single detail that makes the silhouette read as one at 300 m,
 * because a canted pane never mirrors the sky back at you the way a vertical one
 * does. Above it: the dish array, the anemometer and the beacon.
 */
function buildCab(A, rng, y, lights) {
  const box = BOX(A);
  // the brackets that carry the overhang
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const px = TOWER.x + Math.cos(a) * (SH_R - 0.2);
    const pz = TOWER.z + Math.sin(a) * (SH_R - 0.2);
    A.add('concrete_dark', box, LL(IDENT, px, y(ROOF_Y - 0.75), pz, -a, 0.5, 1.5, 3.0, 0, 0.42),
      { masks: [0.6, 0.4, 0.25] });
  }
  // the cab floor and its collision
  const cf = ROOF_Y + 0.2;
  prism(A, 'concrete_dark', CAB, y(cf - 0.45), y(cf), { surface: 'concrete', clip: true });

  for (let i = 0; i < CAB.length; i++) {
    const e = edgeInfo(CAB, i);
    // the canted glazing: sill, raked mullions, glass, and the dark room behind
    const gh = 2.7;
    A.add('window_glass', PANE(A), LL(IDENT, e.mx + e.nx * 0.26, y(cf + gh / 2), e.mz + e.nz * 0.26,
      e.yaw + Math.PI / 2, e.len - 0.2, gh + 0.5, 1, 0.2), { masks: [0.1, 0.3, 0] });
    A.add('window_void', PANE(A), LL(IDENT, e.mx - e.nx * 0.5, y(cf + gh / 2), e.mz - e.nz * 0.5,
      e.yaw + Math.PI / 2, e.len, gh + 0.6, 1), { masks: [0.15, 0.9, 0.9] });
    const bays = Math.max(2, Math.round(e.len / 1.5));
    for (let b = 0; b <= bays; b++) {
      const t = b / bays - 0.5;
      A.add('metal_dark', BOX_THIN(A), LL(IDENT,
        e.mx + e.nx * 0.26 + e.tx * e.len * t, y(cf + gh / 2), e.mz + e.nz * 0.26 + e.tz * e.len * t,
        e.yaw, 0.1, gh + 0.6, 0.14, -0.2), { masks: [0.8, 0.5, 0.1] });
    }
    A.add('metal_dark', box, LL(IDENT, e.mx + e.nx * 0.06, y(cf + 0.12), e.mz + e.nz * 0.06,
      e.yaw, 0.6, 0.24, e.len), { masks: [0.85, 0.5, 0.1] });
    A.clipBox('metal', e.mx + e.nx * 0.06, y(cf + gh / 2), e.mz + e.nz * 0.06, 0.3, gh, e.len, e.yaw);
    // the eaves fascia over the glass, deep enough to throw a shadow line
    A.add('metal_dark', BOX_SOFT(A), LL(IDENT, e.mx + e.nx * 0.55, y(cf + gh + 0.3), e.mz + e.nz * 0.55,
      e.yaw, 1.5, 0.42, e.len + 0.5), { masks: [0.75, 0.55, 0.2] });
  }
  // the cab's own floor plate and the consoles round the front of it
  A.add('floor_concrete', box, LL(IDENT, TOWER.x, y(cf + 0.06), TOWER.z, 0, CAB_R * 1.8, 0.12, CAB_R * 1.8),
    { masks: [0.5, 0.4, 0.3] });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (i === 4) continue; // the hatch
    const px = TOWER.x + Math.cos(a) * (CAB_R - 1.5);
    const pz = TOWER.z + Math.sin(a) * (CAB_R - 1.5);
    A.add('metal_dark', box, LL(IDENT, px, y(cf + 0.55), pz, -a, 1.9, 0.95, 0.75), { masks: [0.75, 0.5, 0.2] });
    A.clipBox('metal', px, y(cf + 0.55), pz, 1.9, 0.95, 0.75, -a);
    A.add('window_glow', BOX_FINE(A), LL(IDENT, px - Math.cos(a) * 0.2, y(cf + 1.06), pz - Math.sin(a) * 0.2,
      -a, 1.5, 0.05, 0.5), { masks: [0.2, 0.3, 0] });
  }
  lights.push(practical(A, TOWER.x, y(cf + 2.4), TOWER.z, 0xffd7a0, 26, 26, { s: 0.24 }));

  /**
   * THE CAB POST, AND IT IS DRESSED `clip` FOR THE REASON THE ROOF ARRAY IS.
   * Every piece of this cab is on `LAYER.CLIP`, which `MASK.WORLD` does not
   * contain — and `NavGrid.build` drops ONE ray per cell under that same mask
   * and keeps the FIRST hit. A `STATIC` ordnance box standing on a CLIP floor
   * at 29.3 m is a walkable island in the sky and a `_floatcheck` failure, which
   * is exactly what the four roof props were before `clipProps` was put round
   * them. So the whole post goes on the same layer as the floor it stands on.
   */
  buildStores(A, rng, y, ROOF_Y + 0.32);

  // ---- the cab roof, the dishes and the mast ------------------------------
  prism(A, 'concrete_dark', CAB, y(CAB_TOP - 0.34), y(CAB_TOP), { surface: 'concrete', clip: true });
  for (let i = 0; i < CAB.length; i++) {
    const e = edgeInfo(CAB, i);
    handrail(A, 'metal_rust', e.mx - e.tx * e.len * 0.45, e.mz - e.tz * e.len * 0.45,
      e.mx + e.tx * e.len * 0.45, e.mz + e.tz * e.len * 0.45, y(CAB_TOP), { h: 1.05 });
  }
  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE ARRAY ON THE ROOF IS PLAYER-ONLY, BECAUSE THE ROOF IS
   * ────────────────────────────────────────────────────────────────────────
   * Every piece of this cab — the floor prism, the roof prism, the glazing, the
   * consoles and the mast — is authored `clip: true` / `clipBox`, i.e. on
   * `LAYER.CLIP`, which `MASK.WORLD` does not contain. These four are `put()`,
   * and a SOLID prototype's proxy went on `LAYER.STATIC`: four solid masses at
   * 34-36 m standing on a surface the world mask cannot see.
   *
   * MEASURED, not inferred. A `MASK.WORLD` ray dropped from y 70 hit
   * sat_dish 35.86, sat_dish 35.62, roof_vent 35.22 and water_tank 35.40, with
   * the next solid down at 29.01 — the top of the shaft. `_floatcheck
   * --region=all --down=none` reported the two biggest of them as masses
   * standing on nothing, which is what they were.
   *
   * It was not only a gate failing. `NavGrid.build` drops ONE ray per cell under
   * that same mask and keeps the FIRST hit, so each of these was on course to
   * become the FLOOR of the cells beneath it — the tower's own centre, at 35 m.
   * The only reason it was not is that all four happen to fall inside the
   * control room's 6.5 m `interiorVolume`, whose re-probe replaces the cell;
   * the cab roof is 8.6 m across, so a fifth one set down a metre further out
   * would have been a walkable island in the sky and nothing would have said so.
   *
   * `clipProps` puts their proxies where the roof's is. They still stop the
   * player and the bots and they are still drawn; bullets and sightlines pass
   * through them, exactly as they already do through the roof they stand on.
   */
  A.clipProps = true;
  A.put('sat_dish', TOWER.x + 4.4, y(CAB_TOP) + 0.5, TOWER.z - 2.2, 2.1, 1.7);
  A.put('sat_dish', TOWER.x - 3.6, y(CAB_TOP) + 0.5, TOWER.z + 3.0, -0.6, 1.35);
  A.put('roof_vent', TOWER.x - 4.4, y(CAB_TOP) + 0.1, TOWER.z - 3.4, 0.4, 1.2);
  A.put('water_tank', TOWER.x + 2.0, y(CAB_TOP) + 0.1, TOWER.z + 4.2, 1.1, 1.0);
  A.clipProps = false;

  // the lattice mast: four legs, bracing every 1.6 m, guys down to the cab roof
  const legs = [[-0.62, -0.62], [0.62, -0.62], [0.62, 0.62], [-0.62, 0.62]];
  for (const [lx, lz] of legs) {
    A.add('steel', BOX_THIN(A), LL(IDENT, TOWER.x + lx, y((CAB_TOP + MAST_TOP) / 2), TOWER.z + lz, 0,
      0.13, MAST_TOP - CAB_TOP, 0.13), { masks: [0.7, 0.4, 0.1] });
  }
  A.clipBox('metal', TOWER.x, y((CAB_TOP + MAST_TOP) / 2), TOWER.z, 1.5, MAST_TOP - CAB_TOP, 1.5);
  const bays = Math.round((MAST_TOP - CAB_TOP) / 1.6);
  for (let b = 0; b < bays; b++) {
    const by = CAB_TOP + (b + 0.5) * ((MAST_TOP - CAB_TOP) / bays);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      A.add('steel', BOX_THIN(A), LL(IDENT, TOWER.x + Math.cos(a) * 0.62, y(by), TOWER.z + Math.sin(a) * 0.62,
        a + Math.PI / 2, 0.07, 0.07, 1.24), { masks: [0.75, 0.45, 0.1] });
      A.add('steel', BOX_THIN(A), LL(IDENT, TOWER.x + Math.cos(a) * 0.62, y(by), TOWER.z + Math.sin(a) * 0.62,
        a + Math.PI / 2, 0.055, 0.055, 2.05, 0, 0.66), { masks: [0.75, 0.45, 0.1] });
    }
  }
  ladder(A, TOWER.x + 0.95, y(CAB_TOP), y(MAST_TOP - 1.4), TOWER.z, 0, { cage: true });
  // whip aerials off the head
  for (let i = 0; i < 3; i++) {
    A.add('steel', BOX_THIN(A), LL(IDENT, TOWER.x + Math.cos(i * 2.1) * 0.5, y(MAST_TOP + 1.1),
      TOWER.z + Math.sin(i * 2.1) * 0.5, 0, 0.05, 2.6, 0.05, 0.06, 0.05), { masks: [0.8, 0.4, 0] });
  }
  /**
   * THE BEACON. The only thing on this map you can navigate by from the far
   * rim — and it is a REAL light rather than an emissive box, because 300 m of
   * moonlit plain has nothing else in it to give you a bearing.
   */
  A.add('ember', BOX_SOFT(A), LL(IDENT, TOWER.x, y(MAST_TOP + 0.4), TOWER.z, 0, 0.55, 0.6, 0.55));
  lights.push(practical(A, TOWER.x, y(MAST_TOP + 0.4), TOWER.z, 0xff4d3a, 120, 150, { s: 0.42, priority: 1 }));
}

// ───────────────────────────────────────────────────────────────────── ruin ──
/**
 * WHAT IS LEFT AFTER THE EVENT. Baked at boot into the same merged batches,
 * hidden and intangible until somebody calls `setDown(true)`.
 *
 * The shaft is snapped off eight metres above the gallery with the reinforcement
 * standing out of the break; the cab has gone over the side and lies across the
 * P1 deck and the apron with the mast beyond it; the rest is graded rubble. The
 * debris field is RELAXED (`debrisField`) so it presents no step over 0.36 m —
 * a pile the bots cannot cross would only replace a tower nobody could climb
 * with a mound nobody can pass.
 */
function buildTowerRuin(A, rng, y, groundY) {
  const box = BOX(A);
  const BREAK = ROOM_Y + 7.6;

  // the stump: the same walls, torn off at a different height on every face
  for (let i = 0; i < SH.length; i++) {
    const e = edgeInfo(SH, i);
    const h = BREAK + rng.range(-2.6, 1.4) - ROOM_Y;
    const courses = Math.max(2, Math.round(h / 0.8));
    for (let c = 0; c < courses; c++) {
      const ch = h / courses;
      const cy = ROOM_Y + (c + 0.5) * ch;
      const shrink = c === courses - 1 ? rng.range(0.3, 0.8) : 1;
      A.add('concrete', box, LL(IDENT, e.mx, y(cy), e.mz, e.yaw + rng.range(-0.01, 0.01),
        SH_WALL, ch * (c === courses - 1 ? 0.7 : 1.0), e.len * shrink),
        { masks: [0.55 + rng.float() * 0.4, 0.5 + rng.float() * 0.4, 0.3] });
    }
    A.box('concrete', e.mx, y(ROOM_Y + h / 2), e.mz, SH_WALL, h, e.len, e.yaw);
    // reinforcement standing out of the break
    for (let k = 0; k < 6; k++) {
      A.add('metal_rust', BOX_THIN(A), LL(IDENT,
        e.mx + e.tx * rng.range(-e.len / 2, e.len / 2), y(ROOM_Y + h + rng.range(0.3, 1.5)),
        e.mz + e.tz * rng.range(-e.len / 2, e.len / 2), rng.float() * 6.28,
        0.035, rng.range(0.8, 2.4), 0.035, rng.range(-0.5, 0.5), rng.range(-0.5, 0.5)),
        { masks: [0.95, 0.75, 0] });
    }
  }

  // the debris: on the P2 gallery, over the P1 deck and out onto the apron
  const inner = debrisField(rng, TOWER.x, TOWER.z, 11.6, 1.5, 2.2);
  drawDebris(A, rng, inner, () => y(P2_TOP), { key: 'concrete', key2: 'concrete_dark' });
  const outer = debrisField(rng, TOWER.x + 12, TOWER.z - 4, 14, 1.25, 2.4);
  drawDebris(A, rng, outer, (x, z) => {
    const d = Math.hypot(x - TOWER.x, z - TOWER.z);
    return d < P1_R ? y(P1_TOP) : groundY(x, z);
  }, { key: 'concrete', key2: 'concrete_dark' });

  // the cab, on its side across the deck, and the mast beyond it
  {
    const cx = TOWER.x + 14.5, cz = TOWER.z - 6.5;
    A.add('concrete_dark', box, LL(IDENT, cx, y(P1_TOP + 2.4), cz, 0.7, 9.5, 4.6, 8.4, 0.34, 0.2),
      { masks: [0.7, 0.7, 0.35] });
    A.box('concrete', cx, y(P1_TOP + 2.4), cz, 9.5, 4.6, 8.4, 0.7, 0.34);
    for (let i = 0; i < 26; i++) {
      A.add('window_glass', BOX_THIN(A), LL(IDENT, cx + rng.range(-6, 6), y(P1_TOP + rng.range(0.1, 0.5)),
        cz + rng.range(-6, 6), rng.float() * 6.28, rng.range(0.2, 0.9), 0.012, rng.range(0.2, 0.9)),
        { masks: [0.1, 0.4, 0] });
    }
    fallenMember(A, rng, 'steel', cx + 6.0, y(P1_TOP + 2.2), cz - 4.0,
      cx + 22.0, y(0.9), cz - 15.0, 1.4);
  }

  // scorch and dust over everything
  for (let i = 0; i < 46; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = rng.range(2, 26);
    const px = TOWER.x + Math.cos(a) * d;
    const pz = TOWER.z + Math.sin(a) * d;
    const gy = d < P2_R ? y(P2_TOP) : d < P1_R ? y(P1_TOP) : groundY(px, pz);
    const g = patchGeometry(rng, rng.range(1.2, 4.5), { lobes: 12, wobble: 0.6 });
    A.addOnce('road_dust', g, LL(IDENT, px, gy + 0.04, pz, rng.float() * 6.28, 1, 1, rng.range(0.6, 1.4)),
      { masks: [0.15, 1.0, 0.55] });
  }
}
