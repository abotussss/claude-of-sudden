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
 *
 * ────────────────────────────────────────────────────────────────────────────
 * …AND ALL OF IT STOPS EXISTING IN ACT I — 「更地にするつもりで」
 * ────────────────────────────────────────────────────────────────────────────
 * The section above is the tower for the first three minutes of a match. After
 * `NF-TOWER` fires there is no ziggurat, no deck, no climb and no room: the
 * whole of it is inside the `shell` scope now, the apron is the only thing that
 * survives, and the site is a graded rubble field on the plain. Everything this
 * file says about nested annuli and one-floor-per-cell is about the standing
 * tower; what the demolition leaves is flat ground and the nav patch re-probes
 * it as such. @see `buildTower`'s scope note and `buildTowerRuin`.
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
 * ════════════════════════════════════════════════════════════════════════════
 * 「管制塔はもっと役目を果たせ」— AND THE MEASUREMENT OF WHY IT WAS NOT
 * ════════════════════════════════════════════════════════════════════════════
 * The table above was the answer to 「なんのためにあんの？？」 and it is still not
 * enough, said while playing. Three things were measurably wrong with it, and
 * none of them is about what the rewards ARE.
 *
 *   1. THE TWO BEST THINGS ON THE MAP WERE INVISIBLE BY CONSTRUCTION.
 *      `Caches.nearby` — the ONLY thing that puts a marker on a supply post —
 *      drops any post more than `dy > 8` above the player (`src/match/caches.js`,
 *      and the comment there says why: a marker about a room you cannot reach
 *      from here). The weapon rack stood at 21.2 m and the cab post at 26 m, so
 *      from the P2 gallery at 6.6 m they are 14.6 m and 19.4 m up and NEITHER
 *      HAS EVER BEEN MARKED FOR ANYBODY. The map's only second primary weapon
 *      was a thing you could only find by guessing it was there.
 *   2. …AND `RULES.cacheMarkerRange` IS 26 m, ON A 300 m MAP. That number is
 *      right for the town ("about one building plus its street") and it means
 *      that on the plain nothing tells you a tower has anything in it until you
 *      are already at its foot. It is shared with the town and is not this
 *      file's to move — so the TOWER has to say it, in the one language this
 *      map has proved works in the dark. @see `annunciator`.
 *   3. EVERY REWARD DIED WITH THE BUILDING. Five of the seven posts stand on
 *      something in the shell scope, and the scope is now the whole tower, so
 *      after Act I the tower's ground would have been worth nothing at all for
 *      the remaining 240 s of the match.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE LADDER OF REWARDS, WHO CAN CLIMB IT, AND WHAT SURVIVES ACT I
 * ────────────────────────────────────────────────────────────────────────────
 *   0.06 m THE APRON     a dressing station on the south foot (the face zone D
 *                        is on) and a resupply on the north foot (the face the
 *                        attack walks in at). BOT-REACHABLE, beacon-plantable,
 *                        AT GRADE — and therefore OUTSIDE the shell, so this is
 *                        the half of the tower that is still worth holding
 *                        after it has been levelled. It is also what makes the
 *                        tower a place men go THROUGH on the way to D rather
 *                        than past.
 *   3.2 m  P1 deck       a dressing station and a resupply — BOT-REACHABLE, so
 *                        the fight over the tower happens on the tower. DIES.
 *   6.6 m  P2 gallery    a nest overlooking zone D, with rounds. BOT. DIES.
 *   6.74 m control room  a resupply and the map's only frag stack, INDOORS and
 *                        bot-reachable through `world.interiorVolumes` — which
 *                        is the whole "屋内戦闘" argument `caches.js` measured on
 *                        the town (3 of 29 men had ever gone inside; 23 do now).
 *                        DIES.
 *   11.6 m shaft storey  THE WEAPON RACK, moved down from 21.2 m. Still player
 *                        only and still a real climb — one storey of dog-leg
 *                        above the room, and the fight on the way back down is
 *                        the price. What changes is that 11.6 m is 5.0 m over
 *                        the P2 gallery and 4.9 m over the control-room floor,
 *                        i.e. INSIDE `Caches.nearby`'s 8 m window from both, so
 *                        a man who has got as far as the gallery is TOLD the
 *                        gun is one flight up. At 21.2 m nothing ever was. DIES.
 *   26 m   the cab       rounds at the best sightline on the map, for the man
 *                        who carried that gun up. DIES.
 *
 * `x`/`z` are OFFSETS from `TOWER`, `h` is height above the pad datum, so the
 * table reads against the section drawing at the top of this file. The two
 * player-only posts refuse a beacon — @see `plains-stores.js`, which has the
 * measurement of what `_jitterOnto` does with one planted at 26 m.
 *
 * `perishable` is now on EVERY post inside the shell, which after this pass is
 * every post above the apron. `Caches.update` disables one the frame its record
 * goes down; a live pickup marker floating over a rubble field is the same bug
 * as floating rubble and it has shipped here four times.
 */
const STORES = [
  /** `x`/`z`/`yaw` are filled by `placeFootStores` off `CLIMBS[foot]`. */
  { id: 'NF-TOWER-FOOT-med', kind: 'medic', x: 0, z: 0, h: 0.06, yaw: 0, foot: 2 },
  { id: 'NF-TOWER-FOOT-ammo', kind: 'ammo', x: 0, z: 0, h: 0.06, yaw: 0, foot: 3 },
  { id: 'NF-TOWER-P1-med', kind: 'medic', x: 0, z: -15.2, h: P1_TOP, yaw: 0, perishable: true },
  { id: 'NF-TOWER-P1-ammo', kind: 'ammo', x: 0, z: 15.2, h: P1_TOP, yaw: Math.PI, perishable: true },
  { id: 'NF-TOWER-P2-nest', kind: 'vantage', x: 0, z: 9.4, h: P2_TOP, yaw: Math.PI, perishable: true },
  { id: 'NF-TOWER-ROOM-ammo', kind: 'ammo', x: 2.48, z: 0.77, h: ROOM_Y, yaw: -1.87, perishable: true },
  { id: 'NF-TOWER-ROOM-frag', kind: 'grenade', x: -2.48, z: -0.77, h: ROOM_Y, yaw: 1.27, perishable: true },
  {
    id: 'NF-TOWER-RACK', kind: 'weapon', x: -3.55, z: 0, h: FLOORS[1], yaw: Math.PI / 2,
    perishable: true, botReachable: false, beacon: false,
  },
  {
    id: 'NF-TOWER-CAB', kind: 'vantage', x: 0, z: 2.4, h: ROOF_Y + 0.32, yaw: Math.PI,
    perishable: true, botReachable: false, beacon: false, clip: true,
  },
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * THE BUTTON — 「管制塔の一番上は衛星爆撃呼び出しボタンがあり」
   * ══════════════════════════════════════════════════════════════════════════
   * THE HIGHEST THING ON THE MAP A MAN CAN STAND AT, and that is the price
   * rather than a flourish. 26.12 m, on the cab floor, four storeys of dog-leg
   * above the control room, glazed on all eight faces, with the only way down
   * being the stair he came up. `src/match/nachtfeld.js`'s `SAT_STRIKE` is what
   * it does; this line is where it is.
   *
   * FACING +Z, i.e. AT ZONE D AND AT THE WHOLE SOUTHERN HALF OF THE PLAIN. The
   * tower stands at z -32 and D at z 0, so a man at this console is looking
   * over the point the tower overlooks — which is the answer to "how does he
   * know what he is calling on": he is looking at it, and `_satTarget` picks by
   * the bearing he is facing. The existing `NF-TOWER-CAB` vantage post is at
   * z +2.4 facing the other way; 4.8 m apart is well outside
   * `RULES.cacheUseRadius` 2.6, so `Caches.nearest` can never be ambiguous
   * between them and neither is inside `nearStore`'s 2.6 m keep-out of the other.
   *
   * `perishable: true` IS THE DESIGN AND NOT BOOKKEEPING. 「そのため管制塔は
   * 破壊されないといけない」 — Act I at p 0.50 razes the shell this stands on and
   * `Caches.update` disables the post on that frame. The weapon is gone because
   * the building is gone. @see `TOWER_ACT.progress`.
   *
   * `botReachable: false` is the same measured fact the rack and the cab post
   * carry: `src/ai/nav.js` is a 2.5D height field and cannot express a shaft, so
   * `Caches.prove` never puts any of the three in `botList`. @see the long note
   * on `SAT_STRIKE` for why that makes this the player's weapon and what the
   * enemy's answer to it is.
   *
   * `clip: true` FOR THE REASON THE CAB POST HAS IT — every surface up here is
   * on `LAYER.CLIP` and a `STATIC` proxy standing on a clip floor at 26 m is a
   * walkable island in the sky and a `_floatcheck` failure. It is dressed by
   * `uplinkConsole` rather than by `dressPost`, which knows four kinds of crate
   * and no consoles.
   */
  {
    id: 'NF-TOWER-SATCALL', kind: 'satcall', x: 0, z: -2.4, h: ROOF_Y + 0.32, yaw: 0,
    perishable: true, botReachable: false, beacon: false, clip: true,
  },
];

/**
 * The two apron posts are placed IN THEIR CLIMB'S OWN FRAME rather than by hand,
 * for the reason the whole `climb()` frame exists: move a flight and its post
 * moves with it. `foot` indexes `CLIMBS`; this is resolved once, at module load,
 * after `CLIMBS` is built.
 */
function placeFootStores() {
  /**
   * Past the bottom step and clear of `onClimb`'s keep-out, so nothing is ever
   * dressed in a stair: the keep-out reaches `RUN1/2 + 1.4 + 1.1` = 6.71 m along
   * the face and this stands at 7.61 m. Props in a doorway is five separate
   * shipped bugs on this repo.
   */
  const v = -(RUN1 / 2 + 3.4);
  for (const s of STORES) {
    if (s.foot === undefined) continue;
    const c = CLIMBS[s.foot];
    s.x = c.nx * OUT1 + c.tx * v;
    s.z = c.nz * OUT1 + c.tz * v;
    // face back along the approach, i.e. at the man walking in
    s.yaw = Math.atan2(-c.tx, -c.tz);
  }
}

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
    /**
     * `dressPost` KNOWS FOUR KINDS OF CRATE AND NO CONSOLES, and it lives in
     * `plains-stores.js`, which is shared with the fortress. The uplink is one
     * object in one place on one map, so it is dressed here rather than by
     * teaching the shared dresser a fifth vocabulary — and a `kind` it does not
     * recognise falls through its `if` chain and dresses NOTHING AT ALL, which
     * is a silent no-op and this codebase's signature defect. Named, not
     * defaulted.
     */
    if (s.kind === 'satcall') uplinkConsole(A, TOWER.x + s.x, y(s.h), TOWER.z + s.z, s.yaw);
    else dressPost(A, rng, s.kind, TOWER.x + s.x, y(s.h), TOWER.z + s.z, s.yaw, { clip: s.clip });
    if (s.clip) A.clipProps = false;
  }
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE SATELLITE UPLINK CONSOLE — what the button actually looks like
 * ════════════════════════════════════════════════════════════════════════════
 * 「管制塔の一番上は衛星爆撃呼び出しボタンがあり」
 *
 * A desk with one guarded red button on it, and everything about it is drawn to
 * be READ FROM THE HATCH — a man arriving at the top of a dog-leg stair in the
 * dark has to know which of the two posts in this cab is the weapon. So the
 * console is the only thing up here that is RED: the eight ordinary consoles
 * round the cab wall are `window_glow` (the map's amber), and this is `ember`
 * under a red-painted guard, with a lit ARC on the deck under it.
 *
 * EVERY PIECE IS ON `LAYER.CLIP` and that is not cosmetic — `A.clipProps` is
 * set by `buildStores` round this call for the reason the cab post's own note
 * gives, and `solid` below is `A.clipBox` and never `A.box`. A `STATIC` proxy
 * on a clip floor at 26 m is a walkable island in the sky.
 *
 * NO LIGHT SLOT. `world`'s punctual count forces every material's program cache
 * key on this renderer, so a lamp here would recompile the map — the same
 * argument `stairMarks` and `signBand` are both built on. It is emission.
 */
function uplinkConsole(A, x, y, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  /** post-local (right, forward) -> world. `forward` is the way the operator looks. */
  const px = (r, f) => x + c * r + s * f;
  const pz = (r, f) => z - s * r + c * f;
  const box = BOX(A);

  /**
   * ---- the deck ring: a dashed lit circle you stand inside -----------------
   * The other seven posts on this tower are announced by `bay()`'s painted
   * hardstanding, which is 2 cm of unlit paint and is invisible in a cab at
   * 21.65 hours. `LL`'s local +X at angle `a` is `(cos a, -sin a)`, i.e.
   * perpendicular to the radius, so `sx` is the arc length of one dash and `sz`
   * its radial thickness.
   */
  for (let i = 0; i < 8; i++) {
    const a = yaw + (i / 8) * Math.PI * 2;
    A.add('ember', BOX_THIN(A), LL(IDENT,
      x + Math.sin(a) * 1.25, y + 0.03, z + Math.cos(a) * 1.25, a, 0.42, 0.02, 0.1));
  }

  /**
   * ---- the desk -----------------------------------------------------------
   * `LL(pm, x, y, z, ry, sx, sy, sz, rx, rz)` composes an Euler in 'YXZ', so
   * after the yaw: `rx` PITCHES about the desk's own right-hand axis (a rake
   * toward the operator) and `rz` ROLLS it sideways. The first cut of this
   * console raked its top and its instrument face with `rz` and PHOTOGRAPHED as
   * two white slabs leaning over at 13° and 28° across the desk — a rake about
   * the wrong axis is not subtle from a metre away. @see `shots/satcall`.
   */
  A.add('metal_dark', box, LL(IDENT, px(0, 0.55), y + 0.5, pz(0, 0.55), yaw, 2.0, 1.0, 0.85),
    { masks: [0.8, 0.5, 0.15] });
  A.clipBox('metal', px(0, 0.55), y + 0.5, pz(0, 0.55), 2.0, 1.0, 0.85, yaw);
  // a flat working top, proud of the body on every side
  A.add('metal_dark', BOX_SOFT(A), LL(IDENT, px(0, 0.55), y + 1.03, pz(0, 0.55), yaw, 2.12, 0.08, 0.95),
    { masks: [0.85, 0.45, 0.1] });
  /**
   * the instrument screen, standing at the BACK of the desk and raked back
   * toward the man — amber, like the eight ordinary consoles round the wall, so
   * the one red thing on this desk is the only red thing in the cab
   */
  A.add('metal_dark', box, LL(IDENT, px(0, 0.93), y + 1.35, pz(0, 0.93), yaw, 1.7, 0.66, 0.1, -0.28),
    { masks: [0.85, 0.5, 0.1] });
  A.add('window_glow', BOX_FINE(A), LL(IDENT, px(0, 0.885), y + 1.35, pz(0, 0.885), yaw, 1.5, 0.5, 0.05, -0.28),
    { masks: [0.2, 0.3, 0] });

  // ---- the button, and it is the only red thing in the cab ------------------
  // the plinth it sits on, near the operator's edge of the top
  A.add('metal_dark', box, LL(IDENT, px(0, 0.32), y + 1.11, pz(0, 0.32), yaw, 0.66, 0.1, 0.54),
    { masks: [0.85, 0.5, 0.1] });
  // the guard: a red-painted horseshoe open toward the man
  for (const r of [-0.36, 0.36]) {
    A.add('metal_rust', BOX(A), LL(IDENT, px(r, 0.36), y + 1.25, pz(r, 0.36), yaw, 0.08, 0.24, 0.46),
      { masks: [0.95, 0.4, 0.05] });
  }
  A.add('metal_rust', BOX(A), LL(IDENT, px(0, 0.57), y + 1.25, pz(0, 0.57), yaw, 0.8, 0.24, 0.08),
    { masks: [0.95, 0.4, 0.05] });
  // …and the lit dome inside it
  A.add('ember', BOX_SOFT(A), LL(IDENT, px(0, 0.33), y + 1.22, pz(0, 0.33), yaw, 0.44, 0.12, 0.36));
  // the two strips down the desk cheeks, so the console has an outline at night
  for (const r of [-0.99, 0.99]) {
    A.add('ember', BOX_SOFT(A), LL(IDENT, px(r, 0.55), y + 0.55, pz(r, 0.55), yaw, 0.05, 0.7, 0.09));
  }

  /**
   * ---- the mark on the desk face, so it says WHAT it is --------------------
   * ON THE FACE THE OPERATOR WALKS UP TO, which is the near one at forward
   * 0.125, and turned to face him. `LL`'s local +X is `(cos ry, -sin ry)` and
   * `uplinkGlyph` puts the plate's thin axis on it, so a plate that faces the
   * operator (-forward) needs `ry = yaw + π/2`. Checked against `signBand`,
   * where the same relation holds between `e.yaw` and the outward normal.
   */
  uplinkGlyph(A, px(0, 0.105), y + 0.6, pz(0, 0.105), yaw + Math.PI / 2, 0.56);

  // ---- and the cable that ties it to the mast ------------------------------
  A.add('metal_rust', BOX_THIN(A), LL(IDENT, px(-0.98, 0.9), y + 0.36, pz(-0.98, 0.9), yaw, 0.09, 0.72, 0.09),
    { masks: [0.9, 0.5, 0.05] });
}

/**
 * THE MARK. A satellite over three descending chevrons over the ground line —
 * "something comes down from up there onto here". It is the ONE glyph in this
 * file that is not about supply, it is drawn wherever the uplink is announced
 * (the shaft band at 20 m, the cab fascia at 29 m, the console's own desk) and
 * it is deliberately the same shape at all three ranges so the thing you read
 * from 150 m is the thing you find when you arrive.
 *
 * `w` is the mark's own width; everything else is a fraction of it, so one call
 * draws it at 0.5 m on a desk and at 1.6 m on a wall.
 */
function uplinkGlyph(A, mx, my, mz, ry, w) {
  /**
   * `LL(pm, x, y, z, ry, sx, sy, sz, rx, rz)` puts local +Z on `(sin ry, cos ry)`
   * and local +X on `(cos ry, -sin ry)`. So `sx` is the plate's thickness along
   * its own normal, `sz` is its width along the face, and the marks step along
   * `(sin ry, cos ry)` — the same convention `supplyMarks` reads out of
   * `edgeInfo`, where `e.yaw = atan2(dx, dz)` and the tangent is `(dx, dz)`.
   */
  const tx = Math.sin(ry), tz = Math.cos(ry);
  /**
   * `rake` GOES IN AS `rx` AND NOT AS `rz`, AND THE FIRST CUT PUT IT IN `rz`.
   * The Euler is 'YXZ', so after `ry` the local axes are: +X the plate's own
   * normal, +Y up, +Z along the face. A mark rotated IN ITS OWN PLANE — which
   * is what a chevron is — turns about the NORMAL, i.e. `rx`. `rz` turns it
   * about the width axis, which tips it out of the wall instead, and the first
   * photograph of this glyph at 150 m was six horizontal bars in a blob where
   * six diagonals were meant to be. @see `shots/satcall/03b-tower-150m-crop.png`.
   */
  const bar = (v, dy, sy, sz, rake = 0) =>
    A.add('ember', BOX_SOFT(A), LL(IDENT, mx + tx * v, my + dy, mz + tz * v, ry, 0.055, sy, sz, rake, 0));
  // the satellite: a body with two panels
  bar(0, w * 0.60, w * 0.22, w * 0.26);
  bar(-w * 0.40, w * 0.60, w * 0.11, w * 0.36);
  bar(w * 0.40, w * 0.60, w * 0.11, w * 0.36);
  // two chevrons coming down, each a pair of raked bars meeting on the axis
  for (let k = 0; k < 2; k++) {
    const dy = w * (0.22 - k * 0.28);
    // rake signs chosen so the pair meets at the BOTTOM: it is a thing coming
    // DOWN, and the first photograph of it had two chevrons pointing up.
    bar(-w * 0.21, dy, w * 0.1, w * 0.46, 0.62);
    bar(w * 0.21, dy, w * 0.1, w * 0.46, -0.62);
  }
  // …and the ground it is coming down onto
  bar(0, -w * 0.52, w * 0.1, w * 0.98);
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * HOW A PLAYER FINDS OUT THERE IS A BUTTON AT ALL
 * ════════════════════════════════════════════════════════════════════════════
 * THE PRECEDENT AND THE FAILURE IT ANSWERS ARE BOTH ALREADY IN THIS FILE.
 * `Caches.nearby` is the only thing that marks a post, it marks at
 * `RULES.cacheMarkerRange` 26 m on a 300 m map, and it drops anything more than
 * `dy > 8` overhead — so the weapon rack and the cab post were never once
 * marked for anybody in the whole of their existence. The answer to that was
 * `signBand`: lit marks at 18.6 m, photographed legible from 150 m. A button
 * that decides whether a capture point can be held has to clear the same bar.
 *
 * SO IT GETS ITS OWN BAND, ABOVE THE SUPPLY ONE, AND NOT A FOURTH SUPPLY GLYPH.
 * Two reasons, and the second is the load-bearing one:
 *
 *   1. It is not supply. A fourth mark in the row of three says "there is
 *      another crate up there", which is the wrong sentence.
 *   2. NOTHING THAT IS ALREADY PHOTOGRAPHED MOVES. `supplyMarks` is spaced and
 *      sized against `shots/tzraze/02-intact-150m-west`; re-spacing three marks
 *      to fit a fourth would change a frame somebody has already reviewed, for
 *      a mark that wants to be different anyway.
 *
 * WHERE THE CLEAR WALL IS, measured off `shaftFaces`'s own slit table rather
 * than guessed: the slits are at `FLOORS[f] + 1.35 ± 0.82`, so the bands of
 * clear concrete on a shaft face are 13.77-16.93 (which `signBand` fills) and
 * 18.57-21.73. This sits in the middle of the second one.
 *
 * AND IT POINTS. A lit line runs from the top of this plate up the face to the
 * underside of the cab, so the sign is not just a symbol on a wall — it is an
 * arrow at the thing it is about, from the one bearing a man reads it on.
 */
function uplinkBand(A, y) {
  /** Between the second and third slit windows: 18.57 .. 21.73 of clear wall. */
  const bandY = (FLOORS[2] + 1.35 + 0.82 + (FLOORS[3] + 1.35 - 0.82)) / 2;
  for (let i = 0; i < SH.length; i++) {
    const e = edgeInfo(SH, i);
    const isDoor = DOORS.some((d) => Math.abs(e.nx - d.ax) < 0.05 && Math.abs(e.nz - d.az) < 0.05);
    if (!isDoor) continue;
    const ox = e.nx * 0.52, oz = e.nz * 0.52;
    /**
     * THE BACKING PLATE, for `signBand`'s reason: a strip of emission on a dark
     * post at 32 m is a slab of orange light hanging in the air with nothing
     * under it. A light on a night map has to have a thing holding it up.
     */
    A.add('metal_dark', BOX(A), LL(IDENT, e.mx + e.nx * 0.46, y(bandY), e.mz + e.nz * 0.46, e.yaw,
      0.16, 2.8, 3.4), { masks: [0.85, 0.45, 0.1] });
    for (const s of [-1, 1]) {
      A.add('metal_rust', BOX_THIN(A), LL(IDENT, e.mx + ox, y(bandY) + s * 1.43, e.mz + oz, e.yaw,
        0.09, 0.14, 3.4), { masks: [0.9, 0.6, 0.05] });
    }
    /**
     * 1.6 -> 1.9. MEASURED AT THE RANGE IT HAS TO WORK AT: at 150 m on a
     * 1600 px frame this map renders about 22.8 px per degree, so a 1.6 m mark
     * is 14 px and a 1.9 m one is 17 px — and the first photograph
     * (`shots/satcall/03b-tower-150m-crop.png`) came back with the supply row's
     * three 1.5 m glyphs legible and this single one a blob above them, which is
     * the wrong way round for the more important of the two signs.
     */
    uplinkGlyph(A, e.mx + ox, y(bandY), e.mz + oz, e.yaw, 1.9);
    /**
     * …AND THE LINE UP TO THE CAB. From the top frame of this plate to the
     * underside of the cab floor, on the face's own centreline. It is the only
     * part of the sign that says WHERE, and it is why this is a band on the
     * shaft rather than a plate on the cab: from the ground you cannot see the
     * top of the tower and the sign in one glance unless something joins them.
     *
     * 0.13 -> 0.34 WIDE, FOR THE SAME MEASUREMENT. 0.13 m at 150 m is 1.2 px —
     * it did not appear in the photograph at all. 0.34 is 3 px over 4.2 m of
     * height, which is a continuous vertical stroke rather than a dashed one,
     * and the ticks are 0.9 m so they are 8 px and read as direction.
     */
    const y0 = bandY + 1.5, y1 = ROOF_Y - 0.4;
    A.add('ember', BOX_SOFT(A), LL(IDENT, e.mx + ox, y((y0 + y1) / 2), e.mz + oz, e.yaw,
      0.05, y1 - y0, 0.34));
    // three ticks up it, so the line reads as a direction and not as a seam
    for (let k = 1; k <= 3; k++) {
      const ty = y0 + (k / 4) * (y1 - y0);
      A.add('ember', BOX_SOFT(A), LL(IDENT, e.mx + ox, y(ty), e.mz + oz, e.yaw, 0.05, 0.12, 0.9));
    }
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
   * ══════════════════════════════════════════════════════════════════════════
   * THE WHOLE TOWER IS IN THE SCOPE NOW — 「更地にするつもりで」
   * ══════════════════════════════════════════════════════════════════════════
   * This scope USED to be the superstructure alone — the shaft, the cab and the
   * mast — and the two podium decks, their four climbs and everything on them
   * survived. That was a deliberate navigation decision (the decks are the AI's
   * only high ground on this map, and rebuilding a 21 m octagon into a ruin
   * scope to stand an identical one back up buys nothing anybody can walk on),
   * and it is reversed here because it was measured doing the one thing a
   * demolition must never do.
   *
   * MEASURED, `_tztrap.mjs`, flooding the real collision surface from where the
   * man is standing, 0.4 m lattice, `maxStep` 0.45, torso capsule:
   *
   *   INTACT, a man in the control room     47 716 cells, 62.2 m of reach,
   *                                         44 040 of them at grade
   *   RAZED,  the same man                     817 cells,  7.1 m of reach,
   *                                         **NOT ONE of them at grade**
   *
   * — 「管制塔の中にいるときに爆撃されると出れなくなる」, exactly, and the cause was
   * the OLD RUIN rather than the settle: `buildTowerRuin` re-walled all eight
   * edges of the shaft as a stump WITH NO DOORWAYS IN IT, while the room's own
   * floor slab and its four door surrounds were inside this scope and went. The
   * man landed on the debris drawn over the P2 gallery at 10.9 m and stood
   * inside a closed octagon seven metres above the plain.
   *
   * WHAT IT COSTS, stated rather than discovered: the two podium decks stop
   * being AI ground and all five of the posts that stood on them die with their
   * shells (@see `STORES`). What replaces them is two posts ON THE APRON, which
   * is at grade, is outside this scope, and therefore outlives the tower.
   */
  buildApron(A, rng, y, groundY);

  const shell = A.beginScope('shell:NF-TOWER');
  buildPodium(A, rng, y, groundY, lights);
  buildShaft(A, rng, y, lights);
  buildCab(A, rng, y, lights);
  A.endScope();

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
      /**
       * THE BASE IS THE GROUND NOW, NOT THE GALLERY. `baseY` is what
       * `nachtfeld.structH` measures the structure's height against and what
       * `_actAim` adds to every aiming point, so leaving it at the P2 deck
       * would have the barrage begin 6.6 m up a building that now comes down
       * from the turf. At grade it is 38.5 m of structure and the four opening
       * rounds on the apron land on the apron — which is also the only way they
       * leave a scorch, @see `SCORCH_CEIL`.
       */
      baseY: y(0),
      top: y(MAST_TOP),
      /**
       * 22 -> 26: the rectangle the nav patch re-probes and the circle the
       * barrage's opening rounds walk. It has to take in everything that STOPS
       * EXISTING, and that is now the apron's own edge — the outboard flights
       * stand at 24.75 and `TOWER_R` is 25.4.
       */
      radius: 26,
      /**
       * ──────────────────────────────────────────────────────────────────────
       * THE HALF-EXTENT IS THE PODIUM'S, AND IT IS THE SETTLE THAT NEEDS IT
       * ──────────────────────────────────────────────────────────────────────
       * `airstrike._buildDemoSite` derives `moundR` from
       * `min(halfW, halfD) * 0.85` and `_buildMesh` settles EVERY chunk at
       * `mound + dir * r` — the rest pose is not consulted. At `SH_R` that is a
       * 5.5 m disc, which is right for a shaft and would have dragged all four
       * podium faces, forty-two metres apart, into one mound on the axis. At
       * `P1_R` it is 17.9 m and the podium's rubble comes to rest over the
       * podium's own plan, which is what 更地 means.
       *
       * It is also what `_spectacle` sizes a demolition's dust off: the haze
       * ring goes from 5.9 m to 18.9 m and the five smoke columns from ±4.7 m
       * to ±15 m, i.e. the dust now covers the thing that fell.
       *
       * THE ONE READER THAT WANTED THE OLD NUMBER IS `climbAim`, which used
       * `halfW * 0.9` as the radius its helix tightens to at the cab. That is
       * fixed where it belongs — in `nachtfeld.js`, off `rec.radius`, so this
       * record has one meaning for `halfW` instead of two.
       */
      halfW: P1_R, halfD: P1_R,
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
      /**
       * ────────────────────────────────────────────────────────────────────
       * THE LAMPS GO OUT WITH THE THING THAT HELD THEM UP
       * ────────────────────────────────────────────────────────────────────
       * `A.setScopeVisible` switches merged triangle ranges and instance slots
       * and it does NOT touch registered lights — they are `THREE.PointLight`s
       * added straight to the level root in `Assembler.finalize`. Every lamp
       * below is authored INSIDE the shell scope, so its emissive body goes and
       * the light it is supposed to come from stays.
       *
       * MEASURED, `_tzlights.mjs`, intact vs razed: the masthead beacon at
       * `(0, 42.1, -32)` — 38.9 m over the plain, intensity 105.7, range 150 —
       * came back `visible: true` in BOTH states. After the raze there is bare
       * ground under it (max 1.06 m over the plain), so what it lit was rubble
       * tinted red from a source that no longer exists anywhere in the world.
       *
       * `publishWorks` switches these with the shell. @see its own note for why
       * the switch is `intensity` and not `visible`.
       */
      lights,
    },
    lights,
  };
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * HOW BIG A PIECE OF THIS TOWER IS WHEN IT LANDS — 「瓦礫がデカすぎる、小さくしろ」
 * ════════════════════════════════════════════════════════════════════════════
 * A chunk's size is `size / cut` per axis and nothing else, so these three
 * numbers ARE the rubble. What they were, measured off the table this replaces:
 *
 *   shaft walls   1.59 x 1.63 m      roof slab    2.17 x 2.17 m
 *   storey slabs  1.85 x 1.85 m      cab roof     1.91 x 1.91 m
 *
 * — i.e. the biggest pieces of this building landed at over two metres across,
 * which is a car, not rubble, and it is the whole complaint.
 *
 * THEY ARE NOT ONE NUMBER, AND THE REASON IS PERSPECTIVE RATHER THAN THRIFT.
 * The pieces a player ever gets to judge are the ones that come to rest at his
 * feet — the podium, its parapets and the four climbs — and the pieces he only
 * ever sees falling are the cab and the mast, thirty metres up. So the ladder
 * runs the other way from the building: finest at the bottom, coarsest at the
 * top. Halving a chunk's edge quadruples the count on a plate and octuples it in
 * a solid, and this mass is already the biggest on the map, so spending the
 * count where it cannot be seen would be paying twice for nothing.
 *
 * AND THESE ARE NOT THE CHUNK SIZE, THEY ARE ITS MEAN. `fracture` jitters every
 * interior boundary by ±0.3 of a cell (`splits` in `airstrike.js`), so two
 * boundaries that jitter apart give a cell 1.6x nominal — which is why the
 * table above says 2.17 for a part authored at 2.1 and why this is measured on
 * the DRAWN INSTANCES rather than read off the cut grid. `_tzchunks.mjs` takes
 * the longest world edge of every chunk of the site; `_tzbefore.mjs` runs the
 * old table through the same `splits` with the same seed:
 *
 *             chunks   min   p25  median   p75   p95   max   >1.5m  >2.0m
 *   before       977  0.95  1.65    1.83  2.01  2.42  3.08     861    285
 *   after      3 365  0.83  1.11    1.30  1.44  1.67  1.89     681      0
 *
 * The median piece of this tower is 0.53 m smaller, the biggest is 1.19 m
 * smaller, and NOT ONE of 3 365 is over two metres where 285 of 977 were — and
 * that is while the mass being broken went from the superstructure alone to the
 * whole building, podium and stairs included.
 *
 * WHAT IT COSTS, because 3 365 is more than the cathedral's 2 151 and that
 * deserves a number rather than a shrug: nothing is computed on the frame it
 * fires — @see the discipline note in `airstrike.js` — so the cost is boot
 * (one `groundHeight` per chunk for the settle probe), 210 KB of settled poses
 * to memcpy at `SETTLE_AT`, and 40 k triangles in two instanced draws that
 * exist only between the fire and the end of the round. Measured with
 * `_razecost.mjs`; the numbers are in the commit.
 */
const CHUNK_LOW = 0.85;
const CHUNK_MID = 1.15;
const CHUNK_HIGH = 1.25;
/**
 * Along a forty-metre wall, where the OTHER two axes are already a chunk. It is
 * a shade coarser than `CHUNK_LOW` for the same reason the ladder exists at
 * all: cutting the long axis of four 42 m faces as fine as their section would
 * add three hundred chunks to make a piece look 0.3 m shorter from one bearing
 * out of four.
 */
const RUN_LOW = 1.15;

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE FALLING MASS — AND IT IS THE WHOLE TOWER NOW
 * ════════════════════════════════════════════════════════════════════════════
 * 「完全に管制塔破壊しろ、つまり更地にするつもりで」.
 *
 * Axis-aligned boxes on the level's own axes; the octagon is fractured as the
 * square it is inscribed in, because `fracture` cuts boxes and nobody has ever
 * seen the corner of a chamfer in a dust cloud.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IS HERE THAT WAS NOT, AND WHAT IS DELIBERATELY STILL NOT
 * ────────────────────────────────────────────────────────────────────────────
 * ADDED: both podium rings with their parapets, and all four climbs. Those are
 * the parts a man standing on the plain watches come apart, and the previous
 * scope — superstructure only — is exactly why the site was still a fortress
 * afterwards.
 *
 * NOT ADDED: the DECK PLATES, i.e. the 9 m annulus of P1 and the disc of P2.
 * That is not an oversight and it is the same judgement `MASS_BLOCK` in
 * `airstrike.js` makes about a building (a storey box, a skin and a balcony —
 * never the solid volume). A podium is mass on grade: demolishing it breaks the
 * RIM and the parapets and turns the middle into rubble WHERE IT ALREADY IS,
 * which is what `buildTowerRuin`'s graded debris field draws on the same frame
 * the plates stop being drawn. Fracturing 1 700 m² of 0.34 m plate would cost
 * six hundred chunks to animate a surface that is under a nineteen-metre dust
 * ring and is replaced by rubble at the instant it moves.
 */
function towerMass(y) {
  const n = (m, per) => Math.max(1, Math.round(m / per));
  const t = SH_WALL;
  const W = SH_R * 2;
  const H = ROOF_Y - ROOM_Y;
  const parts = [];

  /**
   * ---- the two podium rings ------------------------------------------------
   * Each is FOUR walls round the square the octagon is inscribed in, carried up
   * over the deck to take in the parapet as one pour: the parapet is the piece
   * that actually gets thrown, and separating it would only mean two rows of
   * chunks meeting on a joint no one can see.
   */
  const ring = (id, mat, r, y0, y1, th) => {
    const w = r * 2;
    const h = y1 - y0;
    const cy = y((y0 + y1) / 2);
    const up = n(h, CHUNK_LOW);
    parts.push(
      { id: `${id}Xp`, mat, size: [th, h, w], at: [(w - th) / 2, cy, 0], cut: [1, up, n(w, RUN_LOW)] },
      { id: `${id}Xn`, mat, size: [th, h, w], at: [-(w - th) / 2, cy, 0], cut: [1, up, n(w, RUN_LOW)] },
      { id: `${id}Zp`, mat, size: [w - th * 2, h, th], at: [0, cy, (w - th) / 2], cut: [n(w - th * 2, RUN_LOW), up, 1] },
      { id: `${id}Zn`, mat, size: [w - th * 2, h, th], at: [0, cy, -(w - th) / 2], cut: [n(w - th * 2, RUN_LOW), up, 1] }
    );
  };
  ring('p1', 1, P1_R, 0, P1_TOP + 1.16, 1.1);
  ring('p2', 1, P2_R, P1_TOP, P2_TOP + 1.1, 1.0);

  /**
   * ---- the four climbs ----------------------------------------------------
   * Every flight on this tower is on a cardinal axis (@see the note on `TREAD`,
   * which is the reason), so each one is an axis-aligned box with no transform:
   * the ±X climbs run their first flight along Z and their second along X, and
   * the ±Z climbs are the same two boxes with their footprints swapped.
   */
  for (const c of CLIMBS) {
    const alongX = Math.abs(c.tx) > 0.5;
    // flight I — outboard of the P1 face, climbing along it
    const f1 = [FLIGHT_W, P1_TOP, RUN1];
    const c1 = [n(FLIGHT_W, RUN_LOW), n(P1_TOP, CHUNK_LOW), n(RUN1, RUN_LOW)];
    parts.push({
      id: `climb${c.nx}${c.nz}A`, mat: 1,
      size: alongX ? [f1[2], f1[1], f1[0]] : f1,
      at: [c.nx * OUT1, y(P1_TOP / 2), c.nz * OUT1],
      cut: alongX ? [c1[2], c1[1], c1[0]] : c1,
    });
    // flight II — radial, inward, from the parapet gate up to P2
    const uMid = (P2_R + RUN2 - 0.6 + P2_R - 0.6) / 2;
    const f2 = [FLIGHT_W, P2_TOP - P1_TOP, RUN2];
    const c2 = [n(FLIGHT_W, RUN_LOW), n(P2_TOP - P1_TOP, CHUNK_LOW), n(RUN2, RUN_LOW)];
    parts.push({
      id: `climb${c.nx}${c.nz}B`, mat: 1,
      size: alongX ? f2 : [f2[2], f2[1], f2[0]],
      at: [c.nx * uMid + c.tx * (RUN1 / 2), y((P1_TOP + P2_TOP) / 2), c.nz * uMid + c.tz * (RUN1 / 2)],
      cut: alongX ? c2 : [c2[2], c2[1], c2[0]],
    });
  }

  // ---- the shaft, storey by storey ----------------------------------------
  parts.push(
    { id: 'shaftXp', mat: 1, size: [t, H, W], at: [(W - t) / 2, y(ROOM_Y + H / 2), 0], cut: [1, n(H, CHUNK_MID), n(W, CHUNK_MID)] },
    { id: 'shaftXn', mat: 1, size: [t, H, W], at: [-(W - t) / 2, y(ROOM_Y + H / 2), 0], cut: [1, n(H, CHUNK_MID), n(W, CHUNK_MID)] },
    { id: 'shaftZp', mat: 1, size: [W - t * 2, H, t], at: [0, y(ROOM_Y + H / 2), (W - t) / 2], cut: [n(W - t * 2, CHUNK_MID), n(H, CHUNK_MID), 1] },
    { id: 'shaftZn', mat: 1, size: [W - t * 2, H, t], at: [0, y(ROOM_Y + H / 2), -(W - t) / 2], cut: [n(W - t * 2, CHUNK_MID), n(H, CHUNK_MID), 1] }
  );
  for (let f = 1; f < FLOORS.length; f++) {
    parts.push({
      id: `slab${f}`, mat: 1, size: [W - t * 2, 0.28, W - t * 2],
      at: [0, y(FLOORS[f] - 0.14), 0], cut: [n(W, CHUNK_HIGH), 1, n(W, CHUNK_HIGH)],
    });
  }
  parts.push({ id: 'roof', mat: 1, size: [W, 0.4, W], at: [0, y(ROOF_Y - 0.2), 0], cut: [n(W, CHUNK_HIGH), 1, n(W, CHUNK_HIGH)] });
  /**
   * THE CAB IS A RIM, NOT A BLOCK. It is 17.2 m across, 3.2 m tall and almost
   * entirely glazing and air — fracturing it as a solid box spent 363 chunks at
   * the old cut and would spend 768 at this one, on a thing that is four glazed
   * walls on a floor plate. Four rim boxes are 126, and they are what actually
   * comes off it.
   */
  const CAB_W = CAB_R * 2;
  const rim = 1.3;
  const cabUp = n(3.2, CHUNK_LOW);
  parts.push(
    { id: 'cabXp', mat: 0, size: [rim, 3.2, CAB_W], at: [(CAB_W - rim) / 2, y(ROOF_Y + 1.9), 0], cut: [1, cabUp, n(CAB_W, CHUNK_HIGH)] },
    { id: 'cabXn', mat: 0, size: [rim, 3.2, CAB_W], at: [-(CAB_W - rim) / 2, y(ROOF_Y + 1.9), 0], cut: [1, cabUp, n(CAB_W, CHUNK_HIGH)] },
    { id: 'cabZp', mat: 0, size: [CAB_W - rim * 2, 3.2, rim], at: [0, y(ROOF_Y + 1.9), (CAB_W - rim) / 2], cut: [n(CAB_W - rim * 2, CHUNK_HIGH), cabUp, 1] },
    { id: 'cabZn', mat: 0, size: [CAB_W - rim * 2, 3.2, rim], at: [0, y(ROOF_Y + 1.9), -(CAB_W - rim) / 2], cut: [n(CAB_W - rim * 2, CHUNK_HIGH), cabUp, 1] }
  );
  parts.push({ id: 'cabroof', mat: 1, size: [CAB_W, 0.34, CAB_W], at: [0, y(CAB_TOP - 0.17), 0], cut: [n(CAB_W, CHUNK_HIGH), 1, n(CAB_W, CHUNK_HIGH)] });
  parts.push({ id: 'mast', mat: 0, size: [1.5, MAST_TOP - CAB_TOP, 1.5], at: [0, y((CAB_TOP + MAST_TOP) / 2), 0], cut: [1, n(MAST_TOP - CAB_TOP, CHUNK_MID), 1] });
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

  /**
   * ──────────────────────────────────────────────────────────────────────────
   * AND WHAT IS UP THERE, AT THE HEIGHT A MAN READS IT FROM
   * ──────────────────────────────────────────────────────────────────────────
   * The same three marks the shaft carries at 18.6 m (@see `signBand`), on a
   * second board beside the foot of the stair. The band is what tells you the
   * tower has something on it from across the plain; this is what tells you
   * WHAT, at the moment you are deciding whether to spend the climb. Both are
   * flat against the podium face, 0.14 m proud, lowest edge at 1.15 m — nothing
   * to walk into and nothing for `_scatterblock` to find.
   */
  const [sx, sz] = P(P1_R + 0.07, -RUN1 / 2 + 4.6);
  A.add('metal_dark', box, LL(IDENT, sx, y(1.72), sz, yaw, 0.14, 1.1, 3.3),
    { masks: [0.85, 0.5, 0.1] });
  const [gx, gz] = P(P1_R + 0.15, -RUN1 / 2 + 4.6);
  supplyMarks(A, gx, y(1.72), gz, c.nx, c.nz, yaw, 0.62, 1.0);
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
/** …and the two apron posts, in the frames the flights they stand at own. */
placeFootStores();

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

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE APRON — THE ONE PIECE OF THIS TOWER THAT IS NOT IN THE SHELL
 * ════════════════════════════════════════════════════════════════════════════
 * A skirt of hardstanding round the foot, so the podium meets the plain on a
 * made surface rather than on a razor edge through the grass.
 *
 * IT SURVIVES THE DEMOLITION, AND IT SURVIVES IT BECAUSE IT IS ALREADY THE
 * GROUND: 0.61 m of slab whose top stands 0.06 m over the plain. There is
 * nothing here to climb, nothing to fall off, nothing for `_scatterblock` to
 * find and nothing in the 0.42-0.68 m band that this map refuses to have
 * standing proud of the turf. What keeping it buys is everything: the site
 * still reads as a place where something stood, the two supply posts on it are
 * still there for the remaining four minutes of the match, and the nav patch
 * has a flat, known plane to re-probe onto instead of raw steppe under rubble.
 */
function buildApron(A, rng, y, groundY) {
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
  /** …and the two posts that outlive the tower. @see `STORES`. */
  buildStores(A, rng, y, 0.06);
}

function buildPodium(A, rng, y, groundY, lights) {
  const box = BOX(A);

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
function buildShaft(A, rng, y, lights) {
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
  signBand(A, y);
  /** …and the one above it, which is about the button rather than the stores. */
  uplinkBand(A, y);
  controlRoom(A, rng, y, lights);
  shaftInterior(A, rng, y, lights);

  // the roof deck over the shaft, under the cab: a real slab with a hatch
  A.add('concrete_dark', box, LL(IDENT, TOWER.x, y(ROOF_Y - 0.2), TOWER.z, 0, SH_R * 2, 0.4, SH_R * 2),
    { masks: [0.55, 0.4, 0.2] });
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * HOW A PLAYER FINDS OUT THE TOWER HAS ANYTHING IN IT — 「もっと役目を果たせ」
 * ════════════════════════════════════════════════════════════════════════════
 * THE ANSWER TODAY IS THAT HE DOES NOT, AND THAT IS A MEASUREMENT RATHER THAN
 * AN OPINION. A supply post is announced by exactly one thing in this game,
 * `MatchSystem`'s `caches.nearby(player, RULES.cacheMarkerRange, …)`, and:
 *
 *   `cacheMarkerRange` is 26 m. This map is 300 m across. Nothing on the plain
 *   tells you a building has stores in it until you are already at its foot,
 *   and 26 is the town's number — one building plus its street — which is right
 *   there and is not this file's to change.
 *   `Caches.nearby` drops anything more than `dy > 8` overhead, so the two best
 *   things on the tower have never been marked for anybody at all.
 *
 * The previous two passes answered 「なんのためにあんの」 with stores and a beacon
 * and answered 「入る場所がわからない」 with lit stairs, and he played both builds
 * and said it again. Both answers were about the WAY IN. Neither was about the
 * REASON, and a reason nobody can see from three hundred metres is not one.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SO THE BUILDING SAYS IT, IN THE ONE LANGUAGE THIS MAP HAS PROVED IN THE DARK
 * ────────────────────────────────────────────────────────────────────────────
 * A lit band on each of the four shaft faces, mid-shaft, 18.6 m over the plain
 * and clear of every slit window on that elevation. It is EMISSION and not one
 * light: `world`'s punctual count forces every material's program cache key on
 * this renderer, so four lamps here would recompile the map — the same argument
 * `stairMarks` is built on, and those are the parts the previous pass measured
 * as still carrying in the dark.
 *
 * IT IS DESIGNED TO DEGRADE, and this is what it was PHOTOGRAPHED doing at
 * hour 21.65 with no lighting changed (`_tzshots.mjs`, `shots/tzraze/`):
 *
 *   at 150 m  (`02-intact-150m-west`) three separate orange marks on a black
 *             shaft, under the red masthead beacon — the tower has a supply
 *             point on it, and that is the whole of what needs to carry at
 *             the range a man decides whether to cross the plain
 *   at  32 m  (`03-intact-from-D`, standing on zone D) the three glyphs resolve:
 *             a rifle, a stack of rounds, a cross — an aid post, ammunition and
 *             the map's only second primary weapon are in this building
 *
 * Four faces, so it reads from every bearing men arrive on, and the same three
 * marks go on the sign board at the foot of every climb, at eye height, where
 * the man who has walked up to it can read them properly.
 */
/** Aid, rounds, a rifle: three marks, in a face's own frame. `w` is one mark. */
function supplyMarks(A, mx, my, mz, nx, nz, yaw, w, gap) {
  const tx = -nz, tz = nx;
  const mark = (v, sy, sz, dy = 0) =>
    A.add('ember', BOX_SOFT(A), LL(IDENT, mx + tx * v, my + dy, mz + tz * v, yaw, 0.055, sy, sz));
  // ---- the cross -----------------------------------------------------------
  mark(-gap, w, w * 0.3);
  mark(-gap, w * 0.3, w);
  // ---- the rounds: three bars in a stack -----------------------------------
  for (let k = -1; k <= 1; k++) mark(0, w * 0.2, w * 0.92, k * w * 0.36);
  // ---- the rifle: a long bar with its magazine under the middle of it -------
  mark(gap, w * 0.18, w, w * 0.16);
  mark(gap + w * 0.12, w * 0.42, w * 0.2, -w * 0.2);
}

function signBand(A, y) {
  /** Between the first and second slit windows: 13.77 .. 16.93 of clear wall. */
  const bandY = y((FLOORS[1] + 1.35 + 0.82 + (FLOORS[2] + 1.35 - 0.82)) / 2);
  for (let i = 0; i < SH.length; i++) {
    const e = edgeInfo(SH, i);
    const isDoor = DOORS.some((d) => Math.abs(e.nx - d.ax) < 0.05 && Math.abs(e.nz - d.az) < 0.05);
    if (!isDoor) continue;
    const ox = e.nx * 0.52, oz = e.nz * 0.52;
    /**
     * THE BACKING PLATE FIRST, AND IT IS NOT DECORATION. The first cut of the
     * stair pylons stood a strip of emission on a dark post and at 32 m the
     * post was invisible and the strip was a slab of orange light hanging in
     * the air with nothing under it — which is the shape of the complaint about
     * this map's graphics, not the answer to it. A light on a night map has to
     * have a thing holding it up.
     */
    A.add('metal_dark', BOX(A), LL(IDENT, e.mx + e.nx * 0.46, bandY, e.mz + e.nz * 0.46, e.yaw,
      0.16, 2.5, 7.4), { masks: [0.85, 0.45, 0.1] });
    // the frame round it, so the band has an edge in raking moonlight
    for (const s of [-1, 1]) {
      A.add('metal_rust', BOX_THIN(A), LL(IDENT, e.mx + ox, bandY + s * 1.28, e.mz + oz, e.yaw,
        0.09, 0.14, 7.4), { masks: [0.9, 0.6, 0.05] });
    }
    supplyMarks(A, e.mx + ox, bandY, e.mz + oz, e.nx, e.nz, e.yaw, 1.5, 2.35);
  }
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
function controlRoom(A, rng, y, lights) {
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
  lights.push(practical(A, TOWER.x - 2.2, y(ROOM_Y + 3.4), TOWER.z + 1.4, 0xffc07a, 11, 14, { s: 0.14 }));
  lights.push(practical(A, TOWER.x + 2.4, y(ROOM_Y + 3.4), TOWER.z - 1.8, 0xffc07a, 9, 13, { s: 0.14 }));
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

function shaftInterior(A, rng, y, lights) {
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
      lights.push(practical(A, TOWER.x + rng.range(-2, 2), y(fy + 3.2), TOWER.z + rng.range(-2, 2), 0xffc07a, 7, 11, { s: 0.12 }));
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
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT IS LEFT AFTER THE EVENT — 「更地にするつもりで」
 * ════════════════════════════════════════════════════════════════════════════
 * Baked at boot into the same merged batches, hidden and intangible until
 * somebody calls `setDown(true)`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACED, AND WHY IT WAS THE TRAP
 * ────────────────────────────────────────────────────────────────────────────
 * The old ruin re-walled ALL EIGHT EDGES of the shaft as a stump 5-9 m tall —
 * `A.box('concrete', e.mx, …, SH_WALL, h, e.len, e.yaw)` for every edge — and
 * the four doorways were not cut in it, because the door piers and lintels live
 * in `buildShaft` and `buildShaft` is inside the shell. The control room's own
 * floor slab went with the shell too. So the destroyed state was a closed
 * octagonal wall standing on the P2 deck with a 1.5 m debris pile inside it,
 * and a man who had been in the room when the strike landed came to rest on
 * that pile SEVEN METRES ABOVE THE PLAIN with no opening on any bearing.
 *
 * Measured before (`_tztrap.mjs`, flooding the real collision surface):
 *   817 cells reachable, 7.1 m of reach, NOT ONE cell at grade.
 * 「管制塔の中にいるときに爆撃されると出れなくなる」, and that is it exactly.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SO THERE IS NO STUMP. THERE IS NOTHING TO BE INSIDE OF.
 * ────────────────────────────────────────────────────────────────────────────
 * Everything here stands on `groundY` — the plain's own analytic height field —
 * and nothing on it reaches a metre. The site becomes:
 *
 *   ONE GRADED DEBRIS FIELD over the whole footprint. `debrisField` RELAXES the
 *   height field until no cell stands more than 0.36 m over its neighbour,
 *   which is under `NavGrid.maxStep` 0.45 however the two lattices line up, so
 *   the pile is a slope rather than a wall.
 *   `peak` IS 0.6 AND THE ARITHMETIC MATTERS: the field's own noise term is
 *   `peak * shape * (0.45 + fbm * 1.1)`, i.e. up to 1.55x, so 0.6 tops out at
 *   0.93 m — measured 4.13 against a plain at 3.20. That is under the 1.02 m
 *   crouch eye EVERYWHERE, which is what stops 更地 turning into the complaint
 *   `KEEP_LOW` was written for (「瓦礫による視認性の悪さが問題」): the whole site is
 *   cover you get behind crouched and see over standing. At 0.85 the tallest
 *   cells reached 1.32 m and half a dozen of them were chest-high walls.
 *   A HEAVIER RING where the podium's rim was, because that is where 42 m of
 *   battered face and its parapet came down, and a ruin with no plan in it is
 *   a gravel car park.
 *   THE CAB, on the ground on its side, and the mast lying out across the
 *   apron. They are the two pieces a player can still name, and they are the
 *   whole of what says a TOWER stood here rather than a shed.
 *   Both are laid so their tops are inside the crouch line at the middle and
 *   the mast tapers to nothing, so neither is a step and neither is a wall.
 *
 * NOTHING IS IN THE 0.42-0.68 m BAND AS A STEP, nothing is over `maxStep` and
 * nothing encloses anything. @see `_tztrap.mjs` and `tools/navcheck.mjs` for
 * the numbers this is measured against.
 */
function buildTowerRuin(A, rng, y, groundY) {
  const box = BOX(A);

  /**
   * THE FIELD, over the WHOLE footprint rather than over the shaft. `TOWER_R`
   * is 25.4 and the apron's own edge is at 25.4, so the rubble stops exactly
   * where the made ground does and the plain outside it is untouched — which is
   * what keeps `plains.js`'s scatter, the tank lanes and the boundary margin
   * out of this entirely.
   */
  const field = debrisField(rng, TOWER.x, TOWER.z, TOWER_R, 0.6, 2.2);
  drawDebris(A, rng, field, (x, z) => groundY(x, z), { key: 'concrete', key2: 'concrete_dark' });

  /**
   * THE RIM. A ring of heavier broken mass on the line the podium's face stood
   * on, drawn only — the walked surface is the relaxed field above and this sits
   * inside it, so nothing here can be a step. Two courses of it, on the two
   * radii the two podiums had, so the plan of the building is still legible in
   * its own rubble from the P-something-metres a player sees it from.
   */
  for (const [r, count, size] of [[P1_R, 130, 1.15], [P2_R, 70, 0.95]]) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng.range(-0.03, 0.03);
      const d = r + rng.range(-1.9, 1.9);
      const px = TOWER.x + Math.cos(a) * d;
      const pz = TOWER.z + Math.sin(a) * d;
      const s = rng.range(0.55, 1.0) * size;
      const g = rockGeometry(rng, s, 0, rng.range(0.35, 0.75));
      A.addOnce(rng.float() < 0.3 ? 'concrete_dark' : 'concrete', g,
        LL(IDENT, px, groundY(px, pz) + s * 0.2, pz, rng.float() * 6.28, 1, 1, 1,
          rng.range(-0.7, 0.7), rng.range(-0.7, 0.7)),
        { masks: [0.4 + rng.float() * 0.4, 0.5 + rng.float() * 0.4, 0.35] });
      // reinforcement torn out of the face, bent over
      if (rng.float() < 0.18) {
        A.add('metal_rust', BOX_THIN(A), LL(IDENT, px + rng.range(-0.8, 0.8),
          groundY(px, pz) + rng.range(0.2, 0.75), pz + rng.range(-0.8, 0.8), rng.float() * 6.28,
          0.035, rng.range(0.6, 1.7), 0.035, rng.range(-1.1, 1.1), rng.range(-1.1, 1.1)),
          { masks: [0.95, 0.7, 0] });
      }
    }
  }

  /**
   * ──────────────────────────────────────────────────────────────────────────
   * THE CAB, ON THE GROUND — AND FLAT ENOUGH TO WALK OVER, WHICH IS MEASURED
   * ──────────────────────────────────────────────────────────────────────────
   * It used to lie at `P1_TOP + 2.4`, i.e. on top of a deck that no longer
   * exists — 5.6 m in the air. Bedding it on the apron is the obvious half of
   * the fix and it is not the whole of it.
   *
   * THE FIRST CUT OF THIS STOOD 0.9 m PROUD AND ISLANDED 124 NAV CELLS.
   * Measured (`_tzsite.mjs`, walkable cells inside r 176 not joined to the
   * ground component): 1 899 intact, 2 023 with the tower razed — and the
   * difference is a 9.5 x 8.4 m slab whose sides are twice `NavGrid.maxStep`.
   * A ray from the sky finds its top, the top is flat, so the grid calls it
   * walkable and A* then has 124 cells of roof that nothing can reach. That is
   * the same defect as a floating chunk wearing a different hat, and floating
   * rubble has shipped on this map four times.
   *
   * So it lies 0.18 m proud at its middle and 0.085-0.275 m across its whole
   * length (1.2 m box, bedded at -0.42, tilted 0.02 rad over a 4.75 m half
   * length). Under `maxStep` everywhere, and clear of the 0.42-0.68 m band this
   * map refuses to have anything standing in. What makes it read as a CAB at
   * that height is the eaves fascia and the mullions, which are drawn and carry
   * no collision at all — the same split the shaft lining is built on.
   */
  {
    const cx = TOWER.x + 14.5, cz = TOWER.z - 6.5;
    const gy = groundY(cx, cz);
    A.add('concrete_dark', box, LL(IDENT, cx, gy - 0.42, cz, 0.7, 9.5, 1.2, 8.4, 0.02, 0.01),
      { masks: [0.7, 0.7, 0.35] });
    A.box('concrete', cx, gy - 0.42, cz, 9.5, 1.2, 8.4, 0.7, 0.02);
    // the eaves and the mullions off it — drawn only, so nothing here is a step
    for (const s of [-1, 1]) {
      A.add('metal_dark', BOX_SOFT(A), LL(IDENT, cx + Math.cos(0.7) * s * 4.3, gy + 0.3,
        cz - Math.sin(0.7) * s * 4.3, 0.7, 0.5, 0.34, 8.0), { masks: [0.75, 0.55, 0.2] });
    }
    for (let i = 0; i < 9; i++) {
      const t = (i / 8 - 0.5) * 7.6;
      A.add('metal_dark', BOX_THIN(A), LL(IDENT, cx - Math.sin(0.7) * t, gy + 0.22,
        cz - Math.cos(0.7) * t, 0.7, 8.6, 0.12, 0.1), { masks: [0.8, 0.5, 0.1] });
    }
    for (let i = 0; i < 26; i++) {
      const px = cx + rng.range(-6, 6);
      const pz = cz + rng.range(-6, 6);
      A.add('window_glass', BOX_THIN(A), LL(IDENT, px, groundY(px, pz) + rng.range(0.05, 0.3),
        pz, rng.float() * 6.28, rng.range(0.2, 0.9), 0.012, rng.range(0.2, 0.9)),
        { masks: [0.1, 0.4, 0] });
    }
    /**
     * THE MAST, and it is held to the same rule: a 0.9 m section lying on the
     * turf is a thirteen-metre kerb across the apron. 0.55 m bedded at 0.12
     * puts its top at 0.40 m — a thing you step over rather than a wall.
     */
    fallenMember(A, rng, 'steel', cx + 4.0, gy + 0.12, cz - 3.0,
      cx + 17.0, groundY(cx + 17, cz - 12) + 0.10, cz - 12.0, 0.55);
  }

  /**
   * …AND THE THINGS THAT ARE STILL BURNING. The tower's own lamps are REAL
   * point lights and `Assembler.setScopeVisible` switches merged geometry and
   * instance slots — it does not touch `A.lights` — so the generator lamp on
   * P1 and the gallery lamp keep burning after the shell goes. Rather than
   * leave two glows with nothing under them, the ruin puts a source under each:
   * a fire in the wreck is what a demolished plant room looks like, and it is
   * the only reason this site is lit at all at 21:40.
   */
  for (const [ox, oz] of [[15.5, 6.0], [8.6, -2.4], [-6.0, 9.0]]) {
    const px = TOWER.x + ox, pz = TOWER.z + oz;
    A.add('ember', BOX_SOFT(A), LL(IDENT, px, groundY(px, pz) + 0.32, pz, rng.float() * 6.28,
      rng.range(0.5, 0.9), 0.3, rng.range(0.5, 0.9)));
  }

  // scorch and dust over everything, all of it on the plain
  for (let i = 0; i < 46; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = rng.range(2, 26);
    const px = TOWER.x + Math.cos(a) * d;
    const pz = TOWER.z + Math.sin(a) * d;
    const g = patchGeometry(rng, rng.range(1.2, 4.5), { lobes: 12, wobble: 0.6 });
    A.addOnce('road_dust', g, LL(IDENT, px, groundY(px, pz) + 0.04, pz, rng.float() * 6.28, 1, 1, rng.range(0.6, 1.4)),
      { masks: [0.15, 1.0, 0.55] });
  }
}
