/**
 * MATCH — THE TANK. One per side, AI-crewed, driving a street.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * "そんで戦車イベントを早く追加しろ 総力上げて"
 * ────────────────────────────────────────────────────────────────────────────
 * A sortie is: a telegraph, an armoured vehicle that drives out of its own
 * side's end of the mid street under its own crew, acquires men on the other
 * side, shells them with a main gun and rakes them with a coaxial machine gun,
 * and holds the ground it reached FOR THE REST OF THE MATCH — 「戦車は登場したら
 * 帰さないで 試合終了まで滞在させること」. There is no withdrawal and no despawn; the
 * only way a hull leaves the field is destroyed. @see `_drive`'s `hold` branch
 * for the measurement that killed the old sortie. It can be
 * killed the whole time, and killing it is worth `RULES.tankKillScore` to the
 * side that did it — which is 12 % of a domination win, so it is a play rather
 * than a trophy.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW IT NAVIGATES, AND WHY IT IS NOT `src/ai/nav.js`
 * ────────────────────────────────────────────────────────────────────────────
 * THE NAV GRID IS THE WRONG SHAPE FOR THIS AND CANNOT BE MADE THE RIGHT ONE.
 * `src/ai/nav.js` is a 2.5D height field on a 0.8 m lattice whose walkability
 * test is a 0.36 m infantry capsule with shoulder rays — it says whether a MAN
 * fits. This hull is 3.3 m wide and 6.9 m long. Every corner rule, every
 * doorway diagonal and every "one cell of pavement between a kerb and a wall"
 * in that grid is a lie to a vehicle, and the grid is `ai`'s to own: widening
 * it, adding a second capsule radius or carving a vehicle layer would be edits
 * to a subsystem this change may not touch and would change every bot's
 * pathfinding to move one tank.
 *
 * So the route is AUTHORED — a polyline down the middle of the mid street, in
 * the level's own plan coordinates, exactly the way `STRIKE_SITES` and `RUNS`
 * are authored in `airstrike.js` and `bomber.js`. It is then PROVED against the
 * built map at boot rather than trusted:
 *
 *   1. every 1.25 m along the polyline, the ground is probed with the same
 *      downward ray `physics.groundHeight` gives everything else. No ground ⇒
 *      the route is trimmed there.
 *   2. the STREET IS MEASURED at every sample — one ray left and one right,
 *      perpendicular to travel, at hull height — and the sample is SLID to the
 *      middle of the free span it found (up to `LATERAL_MAX`). The authored
 *      line is the intent; the measured centreline is where the tank drives.
 *   3. a sample whose free span is narrower than `HULL_W + CLEARANCE` TRIMS the
 *      route. The tank stops short of a pinch instead of driving through a
 *      building, and if the trim leaves less than `MIN_ROUTE` metres the whole
 *      sortie is dropped with an error naming the coordinates to fix.
 *
 * The result is baked into five flat arrays (x, y, z, yaw, pitch) plus arc
 * length, so driving is a lerp between two samples and costs no raycast at all.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IT CANNOT BLOCK A CAPTURE ZONE AND IT CANNOT BREAK `navcheck`
 * ────────────────────────────────────────────────────────────────────────────
 * Two independent guarantees, both structural rather than tuned:
 *
 *   • IT ADDS NO STATIC COLLISION AND NO NAV CHANGE. The hull is three moving
 *     `physics.addCollider` boxes on `LAYER.SHOOT_ONLY` — the layer that is in
 *     `MASK.BULLET` and in neither `MASK.CHARACTER` nor `MASK.SIGHT`. Rounds
 *     hit it, characters walk through it, A* never hears about it and the BVH
 *     is never rebuilt. `tools/navcheck.mjs`, `lanecheck` and `fightcheck` all
 *     measure a map this feature is invisible to. That IS the trade: you cannot
 *     take cover behind the hull. A 3.3 m solid moving down a lane that thirty
 *     men are pathing through, on a grid baked at boot, is how you get thirty
 *     men stuck against it — and a wreck that stops where a capture point is is
 *     the "blocks a zone permanently" failure by another name.
 *   • ITS ROUTE NEVER ENTERS A ZONE. Measured at boot and printed: the closest
 *     approach of either route to any capture circle is reported in the boot
 *     log, and both routes now stop 24 m off D — sixteen metres outside the 8 m
 *     circle they are shelling, and 58 m or further from every other point. A
 *     sortie is finite anyway — it advances, holds, and reverses back out — so
 *     nothing of it is standing anywhere when it is over. The number in this
 *     paragraph was 27 m for six commits after the map had moved it to 55-77;
 *     believe the boot log, not this comment. @see `ROUTES`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NOTHING IS COMPUTED IN THE FRAME IT DIES
 * ────────────────────────────────────────────────────────────────────────────
 * The same rule `airstrike.js` is built on, and it uses that file's own
 * helpers. At boot each tank's turret, gun, stowage and track runs are cut by
 * `fracture()` into ~250 chunks with their whole trajectory solved into four
 * instanced attributes, and the debris mesh is parented to the tank's own root
 * — so the fracture is baked in the HULL'S LOCAL FRAME and needs no rebuild
 * wherever on the route the tank happens to be when it brews up. The death
 * frame is: two booleans per mesh, one uniform write, one `explosion` event and
 * the `fx` calls that all write into preallocated rings.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLIC API   const a = ctx.get('match').armour
 * ────────────────────────────────────────────────────────────────────────────
 *   a.tanks                  [{ id, team, name, alive, health, position }]
 *   a.call()                 launch the sortie (both sides) with its telegraph
 *   a.fire()                 launch it now, no telegraph
 *   a.enemies = (team, out)  installed by `match`: fill `out` with live hostiles
 *   a.onAnnounce/onImpact    the same reused-record hooks the air systems use
 *   a.onKill = (tank, by)    a tank was destroyed. `match` scores it.
 *   a.busy                   something of ours is on the map
 *
 * Emits `match:tank { phase, id, team, position }`, phase
 * 'inbound' | 'rolling' | 'kill' | 'dead' | 'clear'.
 */

import * as THREE from 'three';
import { RULES, TEAM_COLOR } from './rules.js';
import { fracture, chunkGeometry, makeChunkMaterial, mergeGeometries, clamp } from './airstrike.js';
/**
 * ITS OWN STREAM, KEYED TO THE HULL'S ID — the same move `world/demolition.js`
 * makes for each building's ruin, and for the same reason. `tank.rng` is not a
 * boot-only generator: `_mainGun` and `_coax` draw their dispersion from it on
 * every shot, so a fork taken while BAKING re-phases every round the tank ever
 * fires. The plough cuts one pile per fork, which would have shifted that
 * stream by up to six draws and quietly changed the fall of shot of a feature
 * this change is not supposed to touch. An independently seeded generator
 * costs one import and moves nobody else's dice.
 */
import { Rng } from '../core/rng.js';

/**
 * THE MAP IS 1.5x. Same note as `src/match/sites.js` and `src/match/airstrike.js`
 * — `match` may not import `world`, so the factor is repeated. IF ONE MOVES,
 * MOVE THE OTHERS.
 *
 * These are authored in the WIDENED plan (the space `SPAWNS` and `ZONES` use in
 * sites.js), because the mid street is the one place on this map wide enough to
 * drive a tank down and `widenX` is the identity on its centreline.
 */
const SCALE = 1.5;
const L = (x, z) => [x * SCALE, z * SCALE];

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE TWO ROUTES, RE-AIMED AT THE CATHEDRAL — "まだ戦車が登場したの一回も見て
 * いないです"
 * ────────────────────────────────────────────────────────────────────────────
 * THE OLD ROUTES WORKED PERFECTLY AND THAT WAS THE PROBLEM. Measured over three
 * matches by `_tankdiag.mjs`: both hulls baked, both rolled at t = 91 s, both
 * drove their whole 57 m route, both reversed out ~60 s later — and the hull was
 * ON SCREEN for 0 of 4058 frames, finished on 2600/2600 health with not one
 * round from either side on it, and its closest approach to any capture circle
 * was 55 m (BLUE) and 77 m (RED). The header of this file still claimed "~27 m,
 * measured and printed at boot"; the map had grown out from under the authored
 * polyline (`SPAWNS` went out to level z ∓90, `widenX` prised the mid street
 * open to x ∓23, A and B moved to the flank districts) and nobody re-measured.
 *
 * So the polyline is authored against the map that exists, and it is aimed at
 * the one place the match is guaranteed to be: the CATHEDRAL. Each route leaves
 * its own side's spawn street six metres in front of the front rank — so the
 * first thing you see on foot is your own armour pulling out ahead of you —
 * converges on the mid street's centreline and stops in the square at the
 * cathedral's end wall. Both hulls arrive as D opens in the wreckage, which is
 * what makes them the collapse's consequence rather than a timer.
 * @see `RULES.tankAfterCathedral`.
 *
 * MEASURED WITH `_tankroute.mjs`, which re-runs `_bakePath` against the built
 * map without a rebuild, and re-printed at boot by `_logZones`:
 *
 *     RED    67.0 m of route, narrowest street 5.7 m, ends 24.1 m off D
 *     BLUE   75.7 m of route, narrowest street 10.0 m, ends 23.8 m off D
 *
 * ITS ROUTE STILL NEVER ENTERS A ZONE. 24 m against an 8 m circle, so the hull
 * stops sixteen metres outside the point it is shelling — close enough that the
 * gun and the coax cover the ruin, far enough that a wreck is never standing on
 * the capture circle. Every other capture point is 58 m or further from either
 * route; the boot log prints the true closest approach and the zone it is to,
 * so this claim is a measurement and stays one when the map moves again.
 *
 * The two converge on the centreline from opposite ends rather than staying in
 * echelon, because the thing that keeps them from being nose to nose down a
 * firing line is now the RUIN between them — 3.1 m of rubble against a muzzle
 * 2.6 m off the road, which `MASK.SIGHT` stops dead in `_acquire`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * …AND THEN IT STOPPED BEING ONE POLYLINE — 「戦車はできるだけ占領サれたエリアに
 * 向かい、そこが占領し返すまで戦闘するみたいにして」
 * ────────────────────────────────────────────────────────────────────────────
 * A ROUTE IS NOW A WHEEL, NOT A LINE. Each side has one APPROACH — the polyline
 * above, out of its own spawn street to the cathedral square, which is the HUB —
 * and one SPOKE per capture point it can actually drive to. The hull takes the
 * spoke to whichever point the enemy holds, stands off it and fights, and when
 * his side has taken it back it comes back down the spoke and goes out the next.
 * D needs no spoke: the hub IS the stand-off on the cathedral.
 *
 * EVERY SPOKE WAS SCOUTED AND THEN PROVED, and neither half was a guess. The
 * scout is `_hullpath.mjs` — an A* on a 2.25 m lattice whose node test is this
 * file's own "ground under the sample and HULL_W + CLEARANCE of side room",
 * whose edges are swept so a 1.5 m wall between two lattice nodes cannot be
 * stepped over, and which knows that mass the hull drives over is not a wall.
 * Its output is a polyline in these same authored units; `_bakePath` then
 * measures it against the built map exactly as it always has, and a spoke that
 * does not survive to within `ZONE_ARRIVE` of its point is DROPPED with its
 * reason printed. A dropped spoke costs one destination, never the sortie.
 *
 * The boot log prints every leg it baked and every one it did not. Believe it,
 * not this comment.
 */
const ROUTES = [
  {
    id: 'RED',
    team: 0,
    name: 'RED ARMOUR',
    approach: [L(8, 56), L(7, 46), L(5, 36), L(2.5, 28), L(1, 20), L(0.5, 15)],
    spokes: [
      { zone: 'C', points: [L(0.5, 15), L(-4.5, 15), L(-9, 12), L(-13.5, 10.5), L(-28.5, 10.5), L(-34.5, 4.5), L(-34.5, 1.5), L(-37.5, -1.5), L(-43.5, -3), L(-46.5, -3), L(-49.5, -1.5)] },
      { zone: 'E', points: [L(0.5, 15), L(4.5, 15), L(9, 12), L(13.5, 10.5), L(28.5, 10.5), L(33, 9), L(34.5, 7.5), L(34.5, 1.5), L(37.5, 0), L(43.5, 0), L(46.5, -3), L(49.5, -1.5)] },
      { zone: 'A', points: [L(0.5, 15), L(-4.5, 21), L(-13.5, 22.5), L(-16.5, 25.5), L(-25.5, 25.5), L(-31.5, 31.5), L(-39, 31.5), L(-42, 34.5), L(-69, 36)] },
      /**
       * RE-SCOUTED — the old polyline drove past E's doorstep (8.4 m off its
       * centre at the closest sample), so `_trimToStandoff` cut it 79 m short
       * of B and the whole spoke was DROPPED at boot: a hull whose enemy held
       * only B had nowhere to go and sat at the hub, which from the player's
       * seat is a stuck tank. `_hullpath.mjs` with the other four capture
       * circles blocked at 11 authored units found this corridor east of the
       * mid street and south through the diagonal; it clears every non-target
       * circle by more than the stand-off.
       */
      { zone: 'B', points: [L(0.5, 15), L(9, 15), L(13.5, 10.5), L(28.5, 10.5), L(33, 9), L(34.5, 7.5), L(34.5, -18), L(40.5, -24), L(46.5, -24), L(51, -28.5), L(51, -34.5), L(52.5, -36), L(55.5, -37.5), L(69, -37.5)] },
    ],
  },
  {
    id: 'BLUE',
    team: 1,
    name: 'BLUE ARMOUR',
    approach: [L(-8, -56), L(-7, -46), L(-5, -36), L(-2.5, -28), L(-1, -22), L(-0.5, -17)],
    spokes: [
      /**
       * RE-SCOUTED — the old loop went west then NORTH round the courtyard and
       * dead-ended nose-against a 4.2 x 2.6 m merged-masonry shed at world
       * (-37, 19): `pinch 3.4m at sample 40`, hull parked against it for the
       * rest of the match (watched, seed 7, twice). This corridor comes at C
       * from the south-east instead and never meets the shed.
       */
      { zone: 'C', points: [L(-0.5, -17), L(-10.5, -16.5), L(-13.5, -13.5), L(-15, -7.5), L(-39, -6), L(-40.5, -4.5), L(-46.5, -4.5), L(-49.5, -1.5)] },
      { zone: 'E', points: [L(-0.5, -17), L(4.5, -23), L(13.5, -24.5), L(24, -24.5), L(30, -18), L(34.5, -12), L(34.5, -6), L(37.5, -3), L(43.5, -3), L(48, -3), L(49.5, -1.5)] },
      { zone: 'B', points: [L(-0.5, -17), L(4.5, -23), L(13.5, -24.5), L(16.5, -27.5), L(25.5, -27.5), L(31.5, -33.5), L(39, -33.5), L(42, -36.5), L(69, -38)] },
      /**
       * RE-SCOUTED — the old spoke hugged the courtyard's east wall (8.4 m off
       * C's centre) and was DROPPED at boot on the C stand-off, so BLUE could
       * never drive at A at all. The x -15 corridor keeps 13 units off C and
       * 15 off D, then rejoins the outer-ring streets RED's A spoke proved.
       */
      { zone: 'A', points: [L(-0.5, -17), L(-10.5, -16.5), L(-13.5, -13.5), L(-13.5, -9), L(-21, -3), L(-27, -1.5), L(-28.5, -3), L(-34.5, 3), L(-34.5, 16.5), L(-40.5, 22.5), L(-46.5, 22.5), L(-51, 27), L(-51, 31.5), L(-55.5, 36), L(-69, 36)] },
    ],
  },
];

/* ---- the hull, in metres, in the tank's own frame ------------------------ */
/** +Z forward, +X right, +Y up, origin on the ground between the tracks. */
const HULL_W = 3.3;
const HULL_L = 6.9;
/** Metres of street the hull needs on top of its own width to drive somewhere. */
const CLEARANCE = 1.1;
/** How far a sample may be slid sideways onto the measured centreline. */
const LATERAL_MAX = 3.0;
/** Spacing of the baked path samples. */
const STEP = 1.25;
/** A route shorter than this is not a sortie. */
const MIN_ROUTE = 16;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 「戦車は多少の壁や建物は破壊しながら進めるようにして 大きな建物を壊せないけど」
 * WHAT THE HULL SHOVES ASIDE, AND WHAT STOPS IT
 * ────────────────────────────────────────────────────────────────────────────
 * THE RULE IS THE GLACIS, NOT A LIST OF PROP NAMES. `_buildBody` puts this
 * tank's glacis top edge at y 1.78 and its nose plate on the road at y 0.62;
 * mass that stands no higher than the plate that would hit it is mass a 40 t
 * tracked vehicle drives through, and mass that stands over it is a building.
 * So `PLOUGH_TOP` is the hull's own geometry rounded to 1.8 m and nothing in
 * this file names a jersey barrier, a sandbag wall or a crate.
 *
 * MEASURED ON THE BUILT MAP with `_ploughscan.mjs`, which marches this exact
 * test along both baked corridors (seed 7):
 *
 *   RED    7 masses met, 0 ploughable — 3.39 m cathedral piers, a 4.30 m
 *          plinth run and 8.99 / 10.69 m building shells. It is stopped by
 *          every one of them, which is the 大きな建物を壊せない half.
 *   BLUE  10 masses met, 9 ploughable at 0.56-1.01 m — the cover clusters of
 *          sandbags, crates, barrels and a jersey barrier that the mid street
 *          is dressed with. 8 of the 9 bind to a prop instance.
 *
 * AND IT ONLY PLOUGHS WHAT IT CAN ACTUALLY ERASE. `src/world` merges its static
 * collision per SURFACE and `match` may not reach into it, so there is no
 * "delete this wall" hook to call — but the level's props are `prop_*`
 * InstancedMeshes, and one instance is hidden by zeroing sixteen floats, which
 * is exactly what `Assembler.setScopeVisible` does to a demolition scope's
 * slots. Mass with NO instance behind it is therefore treated as BLOCKING even
 * when it is short (BLUE's ninth, at 0.56 m, binds nothing and is left alone),
 * because a hull that drives through a wall which is still standing afterwards
 * is worse than one that never tried. Nothing here adds collision or geometry
 * to the world; it only ever takes some away.
 */
/**
 * ────────────────────────────────────────────────────────────────────────────
 * RAISED FROM THE GLACIS TOP (1.8) TO 3.2 — 「とにかく戦車の踏破力を高くして
 * 基本何でも破壊して進めるようにして」, the player's THIRD report on this
 * ────────────────────────────────────────────────────────────────────────────
 * The glacis rule was the polite reading and he has now rejected it three
 * times: the policy he is asking for is BY DEFAULT IT DESTROYS AND ADVANCES.
 * So the ceiling is no longer the hull's own plate height — it is "anything
 * the erase machinery can actually erase": market stalls, pillars, posts,
 * stacked crates, every piece of street furniture with a `prop_*` instance
 * behind it, up to 3.2 m.
 *
 * 3.0 AND NOT MORE, AND THAT NUMBER WAS SWEPT RATHER THAN CHOSEN. The ceiling
 * is also `PASS_TOP` — what a route's side probe drives past — so it decides
 * where the hull may GO as well as what it removes, and the two answers stop
 * agreeing at the cathedral square. Baked at seed 7 (boot log, legs kept and
 * piles bound):
 *
 *     1.8 (old)  RED 4 legs / 40 piles · BLUE 4 legs / 34 piles
 *     2.2        RED 4 legs / 52 piles · BLUE 3 legs / 29 piles
 *     2.6        RED 4 legs / 53 piles · BLUE 4 legs / 40 piles
 *     3.0        RED 4 legs / 53 piles · BLUE 4 legs / 40 piles
 *     3.2        RED 3 legs / 38 piles · BLUE 4 legs / 39 piles — both
 *                approaches CUT 17 m short, because at 3.2 the 3.4 m masonry
 *                on the cathedral's outer steps reads as passable to the side
 *                probe and as a wall to `_trimAtBlockers`, and the hub moves.
 *
 * So 3.0 is the top of the plateau: +33 % of the map's street furniture over
 * the glacis rule with no route lost. What still stops the hull is unchanged
 * in kind — mass with no `prop_*` instance behind it (the enterable buildings,
 * the cathedral, the boundary wall, the merged masonry sheds) cannot be erased
 * by anything in this file, and now TRIMS the route at bake instead of being
 * ghosted through. @see `_trimAtBlockers` and `_ploughableAt`.
 */
const PLOUGH_TOP = 3.0;
/** Under this the hull simply drives over it — a kerb is not an event. */
const PLOUGH_MIN = 0.3;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 「また戦車は多少の障害物は破壊して乗り越えて走行できるようにして」
 * THE OTHER HALF OF THE VERB: 乗り越え
 * ────────────────────────────────────────────────────────────────────────────
 * THE PLOUGH WAS ONLY THE 破壊 HALF, AND THE 乗り越え HALF WAS MISSING TWICE
 * OVER — once in where the tank is allowed to go, and once in what the hull
 * does when it gets there.
 *
 *   1. WHERE IT MAY GO. `_bakePath`'s side probes are a single ray each way at
 *      hull height, and ANY hit is a wall: a 0.9 m jersey barrier standing in
 *      a street reads as the street's edge, so the sample slides away from it
 *      and — when there is one on each side — the span comes back under
 *      `HULL_W + CLEARANCE` and THE ROUTE IS TRIMMED THERE. Measured on the
 *      built map, that is not a corner case: every one of the eight spokes
 *      scouted for the zone wheel pinches inside twenty metres of the hub
 *      under the old rule, on spans of 1.1-3.9 m, in streets a hull plainly
 *      fits down. A tank that has to path round a kerb reads wrong, and this
 *      one could not leave the cathedral square at all.
 *
 *      So a side probe now RESUMES past mass it measures at `PASS_TOP` or
 *      less over the road it is standing on — the same height rule and the
 *      same "over the road, never over the obstacle's own top" measurement
 *      `_bakePlough` makes, because `groundHeight` at a point past a wall's
 *      face comes back as the WALL'S top and would make every wall on the map
 *      zero metres tall.
 *
 *   2. WHAT THE HULL DOES. The ride was `Y[i]` — one ground ray per sample,
 *      lerped — so a 0.8 m step made the whole hull rise 0.8 m over 1.25 m
 *      with its pitch clamped at 9 degrees: it did not climb, it POPPED. A
 *      tracked vehicle rests on the highest thing under its TRACK RUN, so the
 *      ride is now the two support points `SUPPORT` fore and aft of the origin
 *      and the pitch is the line between them. The nose lifts first, the hull
 *      levels on top and the tail settles last, which is what climbing looks
 *      like, and it costs no raycast — both supports are a max over a handful
 *      of baked samples.
 *
 * AND THE RIDE KNOWS WHAT THE PLOUGH ERASED. The plough fires `PLOUGH_NOSE`
 * before the origin reaches a pile, so a ride that rode the baked ground would
 * climb a pile that is no longer there and stay a foot in the air all the way
 * across it. Each sample carries the road under it and the step on top of it
 * separately (@see `_bakeRide`), and a fired pile drops its step.
 */
/** Mass no taller than this over the road is not a wall to a side probe: the
 *  hull either erases it (@see `PLOUGH_TOP`) or drives over it. */
const PASS_TOP = PLOUGH_TOP;
/**
 * The step the hull gets its nose over — RAISED 1.0 -> 1.6 on the same third
 * report: 「戦車は乗り越え性能高くして」. 1.6 is over any sandbag line, barrier,
 * crate stack or rubble crest this map dresses a street with, and short of the
 * 2.6 m masonry shed class that `_trimAtBlockers` now stops the route at.
 * Measured before and after with `_climbmax.mjs`, which walks a hull up a real
 * step on the real map rather than trusting the constant.
 */
const CLIMB_TOP = 1.6;
/** Nose up or down the ride is allowed to reach. ~30 degrees (was 24). */
const CLIMB_PITCH = 0.52;
/** How far fore and aft of the origin the track run bears on the ground. */
const SUPPORT = HULL_L * 0.42;
/** Metres the road may fall per metre travelled — the slope the lower envelope
 *  in `_bakeRide` is allowed to follow before it calls a rise a STEP. */
const ROAD_SLOPE = 0.17;
/** Half the corridor the hull actually sweeps, with a little shoulder. */
const PLOUGH_HALF = HULL_W * 0.5 + 0.25;
/** Metres ahead of the hull origin that the glacis reaches. */
const PLOUGH_NOSE = 3.3;
/** Two obstructions closer together than this are one pile. */
const PLOUGH_MERGE = 2.4;
/** Consecutive samples of unremovable mass that make a wall rather than a
 *  clipped corner. 3 x `STEP` is 3.75 m — wider than the hull. @see
 *  `_trimAtBlockers`, which measured why one sample is not enough. */
const BLOCK_RUN = 3;
/** Seconds of drag on the hull while it shoves a pile aside. */
const PLOUGH_DRAG = 0.7;
/** How much of its speed the hull keeps while ploughing. */
const PLOUGH_SLOW = 0.45;

/** Metres/second. A tracked vehicle in a street, not a car. */
const SPEED_ADVANCE = 4.6;
/** It slows down to shoot — a hull-down halt is what makes the gun readable. */
const SPEED_FIGHT = 1.5;
/** UNUSED since the hull stopped withdrawing. Kept so the shape of the drive
 *  state machine still reads, and because a future "pull back when crippled"
 *  would want exactly this number. @see `_drive`. */
const SPEED_REVERSE = 3.4;
/**
 * Seconds on the clock when it reaches the end of its run. NOTHING ACTS ON IT
 * any more — the hull holds until it is destroyed or the round resets — but it
 * is still counted down so anything reading `tank.hold` sees a sane value.
 */
const HOLD_TIME = 30;
/** Seconds of telegraph before the engine note becomes a tank in the street. */
const TANK_LEAD = 6.0;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE STAND-OFF, AND WHY IT IS STILL STRUCTURAL
 * ────────────────────────────────────────────────────────────────────────────
 * The old guarantee was "the authored route never enters a zone", and it was
 * true because the authored route went one place. A wheel that deliberately
 * drives AT the capture points cannot keep that shape of promise, so it keeps
 * the same promise a different way: EVERY BAKED LEG IS TRIMMED at the first
 * sample that comes inside `ZONE_STANDOFF` of ANY capture centre, target or
 * not. The hull therefore stops 16 m off the circle it is shelling — 8 m
 * outside a `RULES.captureRadius` 8 circle, and 4.5 m outside it even measured
 * from the far end of a 6.9 m hull — and a wreck can no more stand on a point
 * than it could before. It is measured per leg and printed at boot.
 *
 * (The hull was never a nav obstacle in the first place: three moving
 * `LAYER.SHOOT_ONLY` boxes, invisible to `MASK.CHARACTER` and to A*. The
 * stand-off is about what the player sees standing on his point, not about
 * whether men can walk.)
 */
const ZONE_STANDOFF = 16;
/** A leg whose trimmed end is further than this from the point it was authored
 *  at is not a route to that point, and is dropped rather than kept as a lie. */
const ZONE_ARRIVE = 34;
/** Seconds between "which point should we be at" decisions. */
const RETARGET_EVERY = 2.0;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 「戦車が占領地域へ向かっているが進んでいない時がある」 — IT WAS THE STEERING
 * ────────────────────────────────────────────────────────────────────────────
 * MEASURED BEFORE IT WAS CHANGED, with `_tankwhy.mjs` (seed 7, both hulls, the
 * fraction of the seconds a hull spends in `advance` — i.e. holding an order to
 * MOVE — at under walking pace, attributed to the drive's own three reasons):
 *
 *     RED    27.6 % of its advance under 1.4 m/s — 7.7 s pivot, 0.7 s fight
 *            speed, 0.0 s plough drag
 *     BLUE   45.5 % of its advance under 1.4 m/s — 41.6 s pivot, 0.1 s fight
 *            speed, 0.1 s plough drag
 *
 * So it is not the gun and it is not the plough: a hull ordered to a capture
 * point spent up to forty-five per cent of the drive AT A DEAD STOP, turning.
 * Two causes, both structural:
 *
 *   1. THE HEADING IT CHASED WAS THE BAKED YAW UNDER ITS OWN TRACKS. `YAW[i]`
 *      is the path's direction AT the sample the hull is standing on, so at an
 *      authored corner it steps by the whole corner in one sample: the error
 *      goes from nothing to ninety degrees between two frames, `pivoting` goes
 *      true, and the throttle is cut to ZERO until the nose has come round. The
 *      hull therefore stopped dead at every corner of every spoke — and the
 *      wheel is authored with a dozen of them.
 *
 *      It now chases the BEARING TO A POINT `LOOK_AHEAD` DOWN THE LEG, which is
 *      pure pursuit and is the standard answer: the aim point rotates smoothly
 *      over the metres before a corner instead of snapping at it, so the hull
 *      turns INTO the corner while it is still moving. The body may lead its
 *      own track by a few degrees mid-corner, which is what a tracked vehicle
 *      steering with its tracks looks like.
 *
 *   2. THE THROTTLE WAS A BOOLEAN. `speed = pivoting ? 0 : …` has no middle:
 *      thirty-five degrees off is full speed and thirty-six is stationary. It
 *      is now a ramp — full speed inside `TURN_EASE`, down to `TURN_MIN` of it
 *      at `PIVOT_HOLD`, and zero only past that, which is the hairpin a spoke
 *      driven back to the hub really does ask for.
 *
 * `PIVOT_RATE` was 0.5 rad/s, so the 180 degrees at the end of a spoke took
 * 6.3 SECONDS of a motionless tank. 0.9 makes that 3.5 s and lets the nose
 * track a 90 degree corner in 1.7 s, which the ramp above spends at a little
 * under half speed rather than stopped.
 */
const PIVOT_RATE = 0.9;
const PIVOT_HOLD = 0.6;
/** Metres down the leg the hull steers at. Half a hull length: far enough that
 *  a corner arrives as a turn, near enough that the body never leads the track
 *  it is actually on by more than a few degrees. */
const LOOK_AHEAD = 4.0;
/** Heading error the hull drives through at full speed. */
const TURN_EASE = 0.12;
/** …and the fraction of its speed it still has at `PIVOT_HOLD`. */
const TURN_MIN = 0.35;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 「また戦車の爆撃でも街を破壊できるようにして」 — THE GUN TAKES THE TOWN DOWN
 * ────────────────────────────────────────────────────────────────────────────
 * A shell landing on a market stall now does what the hull does driving through
 * one, and it is the SAME primitive: a prop instance stops being drawn when
 * sixteen floats in its `InstancedMesh` matrix are zeroed, and stops being
 * solid when its triangles' masks are zeroed. The plough could only ever do it
 * to piles it met on a corridor known at boot; a shell lands anywhere, so what
 * is baked at boot is an ATLAS instead of a corridor — every `prop_*` instance
 * in the level on a 3 m lattice, with the static triangles that draw it bound
 * to it. @see `_buildRazeAtlas`.
 *
 * THE RULE IS UNCHANGED FROM THE PLOUGH'S, and it is what keeps a shell from
 * punching an invisible hole in a building: mass with no `prop_*` instance
 * behind it is not erased, whatever it is and however hard it is hit. `world`
 * merges its static collision per SURFACE and publishes no per-prop registry,
 * so a triangle is bound to an instance by being SMALL and NEAR it — a merged
 * wall's triangles are metres long and bind to nothing.
 *
 * NOTHING IS EVER ADDED. Collision is only ever removed, so a nav grid baked at
 * boot can only become more walkable than it was measured to be and
 * `stuckcheck` cannot regress on account of this.
 */
/** How far from the burst the dressing comes off. Smaller than
 *  `RULES.tankMainRadius`, which is the radius men die inside: the shell kills
 *  at 9 m and flattens what is in the street at 5. */
const RAZE_R = 5.0;
/** Cell of the atlas lattice, metres. */
const RAZE_CELL = 3.0;
/** A triangle bigger than this in any axis is structure, not dressing. */
const RAZE_TRI = 2.6;
/** How close a triangle has to be to an instance to be part of it. */
const RAZE_BIND = 1.6;
/** A prop this far above the burst is on something the shell never reached. */
const RAZE_UP = 6.0;

/** Turret traverse and gun elevation, radians/second. */
const TRAVERSE = 0.62;
const ELEVATE = 0.5;
/** Gun elevation limits. */
const GUN_UP = 0.30;
const GUN_DOWN = -0.16;
/** How far off the target the gun has to be before the crew will fire. */
const AIM_TOL = 0.035;
/** Seconds between target re-selections. Cheap, but not every frame. */
const ACQUIRE_EVERY = 0.4;

/** Coaxial burst shape: rounds, and the gap between them. */
const COAX_ROUNDS = 9;
const COAX_GAP = 0.085;
const COAX_REST = 1.5;

/**
 * WHERE THE ARMOUR IS, as a damage multiplier per box.
 *
 * A tank that dies to a magazine is a jeep and a tank that never dies is
 * scenery, so the answer is that it dies to the RIGHT rounds: the glacis eats
 * rifle fire (0.22), the turret is a little softer (0.4), and the engine deck
 * over the back is the shot that works (1.7).
 *
 * MEASURED, NOT MULTIPLIED OUT — and the two differ by 2.6x, which is the
 * point of measuring. `_tankttk.mjs` fires the REAL `physics.fireBullet` at the
 * REAL boxes and counts rounds until the hull brews up:
 *
 *     M4 (17)      into the deck      58 rounds  = 1.9 magazines
 *     AKM (21)     into the deck      47 rounds  = 1.6 magazines
 *     bolt (125)   into the deck       8 rounds  = 1.6 magazines
 *     M4 (17)      into the glacis    447 rounds = 14.9 magazines
 *     bolt (125)   into the glacis     61 rounds = 12.2 magazines
 *
 * THE ARITHMETIC SAYS 90 ROUNDS INTO THE DECK AND THE MAP SAYS 58, because
 * THESE THREE BOXES OVERLAP: `hull` is z -3.2..3.4 / y 0.35..2.15, `deck` is
 * z -3.3..-0.7 / y 1.45..2.25 and `turret` is z -2.0..1.4 / y 1.45..2.55, so a
 * round coming in level from behind at deck height passes through all three and
 * `physics` emits a `damage:dealt` for each. The effective multiplier on that
 * line is 2.64, not 1.70. That is pre-existing geometry, not a new decision,
 * and it is written down here because the comment this replaced claimed "~28
 * rifle rounds into the deck" and no number in it had ever been fired.
 *
 * WHAT THAT MAKES THE TANK. A man carries 240 rounds, so the FRONT IS NOT A
 * ROUTE TO A KILL by rifle at all (447 needed, 240 carried) and is not meant to
 * be. The deck is, and it is on the tank's OWN side of the street — the hull
 * drives out of its own spawn towards the cathedral, so an enemy standing
 * behind it has already got past it. THE HOLE, HONESTLY: a bolt gun with line
 * of sight down onto the engine deck from a roof kills a full-health tank in
 * EIGHT rounds, and `world.features` puts a vantage nest on every reachable
 * roof. If the player says it dies too easily, that is the shot he means, and
 * the fix is this table rather than `RULES.tankHealth`.
 */
const PART_MUL = { hull: 0.22, turret: 0.4, deck: 1.7 };
const EXPLOSION_MUL = 1.35;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE SHOT THAT WORKS, AS A POINT — what `ai` aims the infantry at
 * ────────────────────────────────────────────────────────────────────────────
 * Read straight off `_buildColliders`, in the hull's own frame:
 *
 *     hull    |x| < 1.65   y 0.35 .. 2.15   z -3.20 .. 3.40   x0.22
 *     deck    |x| < 1.45   y 1.45 .. 2.25   z -3.30 .. -0.70  x1.70
 *     turret  |x| < 1.20   y 1.45 .. 2.55   z -2.00 .. 1.40   x0.40
 *
 * The deck is the only box worth a rifle round, and the deck's CENTRE is not
 * the place to aim at it: (0, 1.85, -2.0) sits exactly on the turret's rear
 * face and under the hull's roof, so a line to it from anywhere but dead astern
 * passes through 0.4 or 0.22 armour first. The rear-top corner does not —
 * z -3.05 is a quarter of a metre inside the deck box and a metre astern of the
 * turret; y 2.18 is above the hull roof (2.15) and inside the deck (2.25).
 *
 * `AiSystem.armourWorth` is derived from this point and from those three boxes;
 * if this moves, that moves. @see `DECK_ASTERN` / `DECK_PLUNGE` in src/ai/index.js.
 */
const DECK_AIM = [0, 2.18, -3.05];

/** `stats` key that counts rounds into a part, beside the one that sums them. */
const PART_COUNT = { hull: 'nHull', turret: 'nTurret', deck: 'nDeck' };

/**
 * How far along the hull a blast still counts as landing ON it. `HULL_L` is
 * 6.9, so the true half is 3.45; this is short of it because the glacis and the
 * tail plate slope away. @see `_takeBlast`.
 */
const HULL_HALF = 2.8;

/** How long a man who hit the hull stays the crew's problem. @see `_acquire`. */
const RETALIATE = 6.0;
/** …and how much nearer he counts than he is while he does. */
const RETALIATE_BIAS = 0.5;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 「戦車は空爆で破壊される仕様にして」 — A BOMB KILLS ARMOUR
 * ────────────────────────────────────────────────────────────────────────────
 * `_takeBlast` has always taken airstrike damage, and it has always been
 * pointless: `RULES.airstrikeDamage` is 260 over a 15 m radius, so a bomb
 * landing ON the hull took 260 x 1.35 = 351 of `RULES.tankHealth` 2600 — 13 %,
 * and three direct hits from the biggest weapon in the game left it driving.
 * A tank that shrugs off a five-hundred-pounder is not armour, it is weather.
 *
 * These are the two `explosion` sources that are AERIAL BOMBS. `strafe` is a
 * cannon raking a lane and stays on `EXPLOSION_MUL` — twenty millimetres does
 * not kill a tank, and the player asked for 空爆. The bombardments
 * (`MatchSystem._cathShell`, `_updateBombard`) emit `source: null` and are
 * indistinguishable from any other environmental blast, so they are unchanged.
 */
const AIR_ORDNANCE = new Set(['airstrike', 'bomber']);

/**
 * …AND THE MULTIPLIER IS DERIVED, NOT TUNED.
 *
 * The rule wanted is "a bomb that lands inside half its own blast radius
 * destroys a full-health tank", which is one line of algebra rather than a
 * magic number: at half the radius the linear falloff has already taken half
 * the damage, so the multiplier that reaches `tankHealth` there is
 * 2 x health / damage. Writing it out means it stays true when somebody moves
 * `tankHealth`, `airstrikeDamage` or the bomber's own numbers — which is not
 * hypothetical, they have all moved before. At the centre it is 2x overkill, at
 * the rim it is nothing, and a tank that has already been fought is killed
 * further out.
 */
const airMul = (damage) => (2 * RULES.tankHealth) / Math.max(1, damage);

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 「グレネードや銃弾である程度ダメージ入れたら壊す（ただし簡単に壊れたら面白くない）」
 * A FRAG DID EXACTLY NOTHING, AND IT WAS NOT A TUNING PROBLEM
 * ────────────────────────────────────────────────────────────────────────────
 * A thrown grenade reached this file as an `explosion` whose `damage` IS ZERO,
 * and `_takeBlast` multiplied that zero by `EXPLOSION_MUL` and wounded the hull
 * for nothing. Measured, not inferred: `src/weapons/grenades.js:191` sets
 * `damage: 0` on the blast ON PURPOSE and says so in a twelve-line comment —
 * `ai`'s own `explosion` listener has no team test, so a weapon the PLAYER
 * throws cannot carry its wound on that event without killing his own side.
 * The wound is dealt instead through `damage:dealt` from `_damageActors`, which
 * walks `LAYER.ACTOR` colliders only — and this tank's three boxes are
 * `LAYER.SHOOT_ONLY`. BOTH PATHS MISS THE TANK. Two frags on the engine deck
 * took it from 2600 to 2600.
 *
 * So the frag's strength is read off the channel `grenades.js` does publish:
 * `impulse`, which that file sets because "physics.explode derives its strength
 * from `damage` when it is absent, and the debris still has to fly". It is the
 * blast's own damage scaled by 0.9, so a 165-damage M67 arrives as 148.5 and
 * this file reads a frag 10 % weaker than the thrower does. That is a KNOWN
 * under-read and it is preferred to hard-coding another subsystem's 0.9.
 *
 * …AND THE MULTIPLIER IS DERIVED, exactly as `airMul` is. The rule wanted is
 * "a frag that goes off ON the hull is worth a sixth of a full-health tank",
 * so the multiplier that reaches it is `health / 6 / damage` and the tuning
 * lives in ONE fraction rather than in a magic number. Six frags at contact,
 * and the linear falloff below means a frag that lands 2 m short of a 7.5 m
 * blast is worth two thirds of that. A man carries TWO (`defs.js: count: 2`,
 * and `RULES.grenadeResupplyCooldown` is 60 s per player), so six frags on the
 * hull is a SQUAD deciding to deal with the tank rather than one man doing it
 * — which is the "簡単に壊れたら面白くない" half of the request.
 */
const FRAG_ORDNANCE = new Set(['grenade']);
/** What one frag detonating ON the hull is worth, as a share of full health. */
const FRAG_SHARE = 1 / 6;
const fragMul = (damage) => (RULES.tankHealth * FRAG_SHARE) / Math.max(1, damage);

/** Where the fracture ends up: the debris settles inside this radius, locally. */
const WRECK_R = 4.2;

const UP = new THREE.Vector3(0, 1, 0);
/** Shared by every instance the atlas bound nothing to. */
const EMPTY_TRIS = new Int32Array(0);

/* ========================================================================== */

export class Armour {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.rng = opts.rng ?? ctx.rng.fork();
    this.enabled = true;
    this.ready = false;
    this.tanks = [];
    this.buildMs = 0;

    /** Installed by `match`: fill `out` with the live hostiles of `team`. */
    this.enemies = null;
    /** Installed by `match`: a tank died and somebody gets paid for it. */
    this.onKill = null;
    this.onAnnounce = null;
    this.onImpact = null;
    /** The air systems, so a sortie does not open under an inbound salvo. */
    this.coBusy = null;
    /**
     * COUNT ONE PENETRATING ROUND ONCE. Diagnosed, implemented, and OFF —
     * flipping it moves every time-to-kill in the file, so it waits for the
     * player's answer. `?onewound=1` for a probe run, or one assignment from a
     * console. @see the long note in `_takeRound`.
     */
    this.oneWoundPerRound =
      typeof location !== 'undefined' &&
      new URLSearchParams(location.search).get('onewound') === '1';

    this._next = Infinity;
    this._sorties = 0;
    this._liveT = 0;
    /** Pending telegraphed launch: seconds left. */
    this._pending = -1;
    /** The cathedral's own sortie rolls through the dust. @see `armAfter`. */
    this._ignoreCoBusy = false;

    this.group = new THREE.Group();
    this.group.name = 'match-armour';
    this.group.matrixAutoUpdate = false;

    /* scratch — nothing below allocates */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    /** The hull's pitch quaternion, composed with its yaw every frame. */
    this._qp = new THREE.Quaternion();
    /** Where the route ends — what the HUD arrow points at. */
    this._end = new THREE.Vector3();
    /** `_destroy`'s own position, because a death can happen INSIDE a shell's
     *  own `explosion` emit (the other tank's) and would otherwise clobber the
     *  vector that emit is still using. Same reason `_deathBlast` is separate. */
    this._v4 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._sc = new THREE.Vector3(1, 1, 1);
    this._targets = [];
    this._blast = { position: this._v2, radius: 0, damage: 0, source: null };
    this._deathBlast = { position: this._v4, radius: 0, damage: 0, source: null };
    this._ev = { phase: '', id: '', team: 0, position: this._v2 };
    this._ann = {
      kind: 'TANK',
      id: '',
      name: '',
      lead: TANK_LEAD,
      position: null,
      points: [null, null],
      count: 0,
    };

    this._onExplosion = (e) => this._takeBlast(e);
    this._onDamage = (e) => this._takeRound(e);
    this._onActorDeath = (e) => this._creditKill(e);
  }

  get busy() {
    if (this._pending >= 0) return true;
    for (const t of this.tanks) if (t.state !== 'parked') return true;
    return false;
  }

  get _coBusy() {
    const c = this.coBusy;
    if (!c) return false;
    if (Array.isArray(c)) {
      for (const o of c) if (o?.busy) return true;
      return false;
    }
    return !!c.busy;
  }

  /* ====================================================================== */
  /* BOOT                                                                   */
  /* ====================================================================== */

  build() {
    const t0 = performance.now();
    const ctx = this.ctx;
    const world = ctx.peek('world');
    const physics = ctx.peek('physics');
    if (!world || !physics) {
      console.warn('[tank] no world/physics — disabled');
      return this;
    }
    this.physics = physics;
    this._lib = ctx.peek('materials');

    // Built once for both hulls and dropped again below — @see `_buildPropIndex`.
    let props = null;
    try {
      props = this._buildPropIndex();
    } catch (err) {
      console.warn('[tank] prop index failed — the plough is disabled', err);
    }
    for (const spec of ROUTES) {
      const tank = this._buildTank(spec, world, physics, props);
      if (tank) this.tanks.push(tank);
    }
    /**
     * AFTER the hulls, because the plough claims its instances first and the
     * atlas leaves those alone: one instance may not be owned by two erasers,
     * or whichever restores second puts a zeroed matrix back. @see
     * `_buildRazeAtlas` and the note on `_ploughClaimed`.
     */
    try {
      this._buildRazeAtlas(props, physics);
    } catch (err) {
      console.warn('[tank] raze atlas failed — the gun will not take the town down', err);
      this._atlas = null;
    }
    props = null;
    this._ploughClaimed = null;
    this._propGrid = null;
    if (this.tanks.length) ctx.scene.add(this.group);

    ctx.events.on('explosion', this._onExplosion);
    ctx.events.on('damage:dealt', this._onDamage);
    ctx.events.on('actor:death', this._onActorDeath);

    this.ready = this.tanks.length > 0;
    this.buildMs = performance.now() - t0;
    console.info(
      `[tank] ${this.tanks.length}/${ROUTES.length} tanks baked in ${this.buildMs.toFixed(0)}ms — ` +
        this.tanks
          .map(
            (t) =>
              `${t.id} ${t.legs.length} legs (${t.legs.map((l) => l.zone ?? 'HUB').join('/')}), ` +
              `${t.chunkCount} wreck chunks, ` +
              `${t.plough?.length ?? 0} piles to plough ` +
              `(${(t.plough ?? []).reduce((a, q) => a + q.inst.length, 0)} instances, ` +
              `${(t.plough ?? []).reduce((a, q) => a + (q.tris?.length ?? 0), 0)} triangles)`
          )
          .join(' · ')
    );
    if (this.tanks.length < ROUTES.length) {
      console.error(
        `[tank] ${ROUTES.length - this.tanks.length} SORTIE(S) DROPPED — the route ` +
          'coordinates in src/match/tank.js no longer match the map.'
      );
    }
    return this;
  }

  /* --------------------------------------------------------------- route -- */

  /**
   * HOW FAR A SIDE PROBE REALLY GETS, which is not the same as where the first
   * thing it touches is. Mass no taller than `PASS_TOP` over the road the probe
   * is standing on is mass the hull erases or drives over, so the ray RESUMES
   * past it. @see the long note on `PASS_TOP`.
   *
   * `oy` is road + 1.0 and the height is measured against `oy - 1.0` and never
   * against `groundHeight` at the far side: a downward ray just past a wall's
   * face lands on the WALL'S OWN TOP, which would make every wall on the map
   * zero metres tall and climbable. That bug was written, measured on a scout
   * that then routed straight through the cathedral, and is why this reads the
   * way it does.
   */
  _freeSide(physics, ox, oy, oz, dx, dz, max, props) {
    const o = this._bv ?? (this._bv = new THREE.Vector3());
    const d = this._bv2 ?? (this._bv2 = new THREE.Vector3());
    const MASK = physics.MASK.WORLD;
    let travelled = 0;
    // 6 resumes, not 4: with `PASS_TOP` at 3.2 a dressed street can put more
    // passable mass in one probe's way than the old ceiling ever could.
    for (let iter = 0; iter < 6; iter++) {
      o.set(ox + dx * travelled, oy, oz + dz * travelled);
      d.set(dx, 0, dz);
      const h = physics.raycast(o, d, max - travelled, MASK);
      if (!h?.hit) return max;
      const at = travelled + h.distance;
      o.set(ox + dx * (at + 0.2), oy + 29, oz + dz * (at + 0.2));
      d.set(0, -1, 0);
      const t = physics.raycast(o, d, 45, MASK);
      if (!t?.hit) return at;
      const top = oy + 29 - t.distance - (oy - 1.0);
      /**
       * ────────────────────────────────────────────────────────────────────
       * "GETS PAST IT" IS TWO DIFFERENT FACTS AND ONE HEIGHT CANNOT CARRY BOTH
       * ────────────────────────────────────────────────────────────────────
       * Under the glacis rule the ceiling was 1.8 for both halves and the lie
       * was small. At `PLOUGH_TOP` 3.2 it is not: a probe that resumes past
       * anything under 3.2 walks through the 1.9 m merged concrete wall at
       * world (25, 20) and the 3.4 m masonry shed at (17, 26), and MEASURED
       * that way the bake lost four of the eight spokes — every one of them
       * laid straight into masonry and cut back to 0-4 m by `_trimAtBlockers`.
       * A raised ceiling that costs the hull half its destinations is the
       * opposite of 「基本何でも破壊して進める」.
       *
       * So the two facts are asked separately, in the order they cost:
       *   • under `CLIMB_TOP` — the track run rides over it, always;
       *   • up to `PLOUGH_TOP` — only if a `prop_*` instance is standing there
       *     to be erased, because an instance is the ONLY mass this file can
       *     actually take off the map (@see `_firePlough`). A merged wall's
       *     triangles bind to nothing and it stays a wall.
       */
      if (top > CLIMB_TOP) {
        if (top > PASS_TOP) return at;
        if (!this._ploughableAt(physics, ox + dx * (at + 0.2), oz + dz * (at + 0.2), oy - 1.0, top, props)) {
          return at;
        }
      }
      travelled = at + 0.4;
      if (travelled >= max) return max;
    }
    return travelled;
  }

  /**
   * IS THE MASS AT THIS POINT SOMETHING THE HULL CAN ERASE? One cell lookup on
   * the prop grid plus one downward ray per candidate — the same measurement
   * `_bakeLegPlough` makes, asked before the route is committed instead of
   * after. An instance has to ACCOUNT for the height found (within half a
   * metre): a barrel standing beside a shed does not license driving through
   * the shed.
   */
  _ploughableAt(physics, x, z, roadY, top, props) {
    if (!props?.length) return false;
    const grid = this._propGridOf(props);
    const cell = grid.cell;
    const R = 1.3;
    const o = this._bv3 ?? (this._bv3 = new THREE.Vector3());
    const d = this._bv4 ?? (this._bv4 = new THREE.Vector3(0, -1, 0));
    const MASKW = physics.MASK.WORLD;
    for (let cx = Math.floor((x - R) / cell); cx <= Math.floor((x + R) / cell); cx++) {
      for (let cz = Math.floor((z - R) / cell); cz <= Math.floor((z + R) / cell); cz++) {
        const bucket = grid.g.get(cx * 65536 + cz);
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const q = bucket[k];
          const ex = q.x - x;
          const ez = q.z - z;
          if (ex * ex + ez * ez > R * R) continue;
          o.set(q.x, roadY + 30, q.z);
          d.set(0, -1, 0);
          const t = physics.raycast(o, d, 45, MASKW);
          if (!t?.hit) continue;
          const h = 30 - t.distance;
          if (h >= top - 0.5 && h <= PLOUGH_TOP) return true;
        }
      }
    }
    return false;
  }

  /**
   * Author -> measure -> bake. See the long note at the top of the file for why
   * this exists at all instead of `ai.grid.findPath`.
   *
   * `pts` are WORLD points. A spoke's first point is the approach's own baked
   * end rather than its authored one, so the two legs join without a step.
   */
  _bakePath(pts, world, physics, props) {
    /* ---- resample the polyline at a fixed step ------------------------- */
    const rx = [];
    const rz = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.round(seg / STEP));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        rx.push(a.x + (b.x - a.x) * t);
        rz.push(a.z + (b.z - a.z) * t);
      }
    }
    rx.push(pts[pts.length - 1].x);
    rz.push(pts[pts.length - 1].z);

    /* ---- measure the street and slide onto its middle ------------------ */
    const MASK = physics.MASK.WORLD;
    const need = HULL_W + CLEARANCE;
    const probe = new THREE.Vector3();
    const side = new THREE.Vector3();
    let narrowest = Infinity;
    let kept = 0;
    let stop = 'end of polyline';
    const px = [];
    const py = [];
    const pz = [];
    for (let i = 0; i < rx.length; i++) {
      // direction of travel, from the neighbours so the ends are not special
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(rx.length - 1, i + 1);
      let dx = rx[i1] - rx[i0];
      let dz = rz[i1] - rz[i0];
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl;
      dz /= dl;
      side.set(dz, 0, -dx);

      let x = rx[i];
      let z = rz[i];
      let y = physics.groundHeight(x, z, 30);
      if (!Number.isFinite(y)) { stop = `no ground at sample ${i}`; break; }

      // The side probes RESUME past anything the hull drives over or through.
      const dR = this._freeSide(physics, x, y + 1.0, z, side.x, side.z, 9, props);
      const dL = this._freeSide(physics, x, y + 1.0, z, -side.x, -side.z, 9, props);
      // Slide to the middle of what was found, then re-probe the ground there.
      const shift = clamp((dR - dL) * 0.5, -LATERAL_MAX, LATERAL_MAX);
      const sx = x + side.x * shift;
      const sz = z + side.z * shift;
      const y2 = physics.groundHeight(sx, sz, 30);
      /**
       * ────────────────────────────────────────────────────────────────────
       * A SLIDE MAY NOT PUT THE CENTRELINE ON TOP OF A BUILDING
       * ────────────────────────────────────────────────────────────────────
       * `_freeSide` answers "how much room is there THIS WAY", and the middle
       * of the room it found is not guaranteed to be ground: at the cathedral
       * square the resumed probes reach past a dressed corner on both sides,
       * the midpoint lands on the 3.4 m masonry shed at world (17, 26), and
       * the sample's own downward ray comes back with the SHED'S ROOF. The old
       * ride then quietly clamped that to `CLIMB_TOP` and drove the hull a
       * metre in the air across it; with `_trimAtBlockers` watching, it cut
       * RED's approach 17 m short instead and cost the hull two destinations.
       * Neither is the answer — the authored line was on the road all along.
       *
       * So a slide is REJECTED if it lands more than a climbable step above
       * where the sample already was. The authored point is what the route
       * falls back to, and the span test below still owns "the tank stops".
       */
      if (Number.isFinite(y2) && y2 - y <= CLIMB_TOP + 0.05) {
        x = sx;
        z = sz;
        y = y2;
      }
      const span = dR + dL;
      if (span < need) {
        // a pinch: the route ends here
        stop = `pinch ${span.toFixed(1)}m at sample ${i} (${x.toFixed(0)},${z.toFixed(0)})`;
        break;
      }
      narrowest = Math.min(narrowest, span);

      px.push(x);
      py.push(y);
      pz.push(z);
      kept++;
    }
    if (kept < 4) return null;

    /* ---- bake yaw and arc length --------------------------------------- */
    const n = kept;
    const X = new Float32Array(n);
    const Y = new Float32Array(n);
    const Z = new Float32Array(n);
    const YAW = new Float32Array(n);
    const S = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      X[i] = px[i];
      Y[i] = py[i];
      Z[i] = pz[i];
      if (i > 0) S[i] = S[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
    }
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      YAW[i] = Math.atan2(X[i1] - X[i0], Z[i1] - Z[i0]);
    }
    const length = S[n - 1];
    if (length < MIN_ROUTE) return null;
    const path = {
      n, X, Y, Z, YAW, S, length,
      narrowest: narrowest === Infinity ? 0 : narrowest,
      /** Filled by `_bakeRide`; `PILE` by `_bakePlough`. */
      ROAD: null, STEP: null, PILE: null,
      zone: null, plough: null, stop,
    };
    this._bakeRide(path, physics);
    return path;
  }

  /**
   * THE ROAD AND WHAT IS SITTING ON IT, split out of one ground ray per sample.
   *
   * `Y[i]` is the top of whatever the downward ray found — road, kerb, sandbag
   * line, rubble. The road under a pile cannot be probed directly (a second ray
   * from under the pile's own top is a guess at where its bottom is), but it
   * does not have to be: a road is CONTINUOUS AND ALMOST FLAT and a pile is a
   * short spike on it, so the road is the LOWER ENVELOPE of `Y` under a slope
   * constraint —
   *
   *     ROAD[i] = min over j of ( Y[j] + |S[i] - S[j]| * ROAD_SLOPE )
   *
   * — which follows a real ramp down and refuses to follow a 0.8 m barrier up.
   * A plain window minimum was written first and is wrong for exactly the
   * reason the slope term fixes: over the 6.25 m window a hull needs, a street
   * on this map's steepest legal grade falls a whole metre, so the hull would
   * have ridden a metre in the air down every slope.
   *
   * `STEP[i]` is then what stands on the road at that sample, and the ride adds
   * it back unless the plough has taken it away.
   *
   * ────────────────────────────────────────────────────────────────────────
   * AND A RISE OVER `PASS_TOP` IS NOT A STEP, IT IS A ROOF
   * ────────────────────────────────────────────────────────────────────────
   * `groundHeight` casts DOWN FROM 30 m and takes the first thing it meets, so
   * a sample that passes under a balcony, an awning or a rooftop gangway comes
   * back with the BALCONY's height, not the road's. Measured on the built map
   * the biggest rise this envelope found was 14.43 m, and the ride obediently
   * lifted the hull by the `CLIMB_TOP` clamp — a metre in the air, under a
   * balcony, for as long as the overhang lasted. A rise a tracked vehicle
   * plainly cannot climb is not a thing to climb: it is overhead structure the
   * ray caught, and the road is what the envelope already found.
   *
   * The envelope window is +-20 m rather than the hull's own length for the
   * same reason. A window shorter than the overhang would take the BALCONY as
   * the road and drive the tank along it.
   */
  _bakeRide(p, physics) {
    const n = p.n;
    const ROAD = new Float32Array(n);
    // NOT `STEP`: the module constant of that name is the sample spacing, and a
    // local shadowing it made `W` NaN and the envelope a no-op, silently.
    const RISE = new Float32Array(n);
    const PILE = new Int16Array(n).fill(-1);
    /**
     * 1 = a rise in the (CLIMB_TOP, PASS_TOP] band that a horizontal ray has
     * PROVED is standing mass. @see the note below; `_trimAtBlockers` reads it.
     */
    const SOLID = new Uint8Array(n);
    const W = Math.ceil(20 / STEP);
    const o = this._bv ?? (this._bv = new THREE.Vector3());
    const d = this._bv2 ?? (this._bv2 = new THREE.Vector3());
    const MASKW = physics.MASK.WORLD;
    for (let i = 0; i < n; i++) {
      let lo = p.Y[i];
      for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) {
        const v = p.Y[j] + Math.abs(p.S[i] - p.S[j]) * ROAD_SLOPE;
        if (v < lo) lo = v;
      }
      ROAD[i] = lo;
      const rise = p.Y[i] - lo;
      if (rise > PASS_TOP) {
        RISE[i] = 0; // a roof the ground ray caught — the hull drives under it
      } else if (rise <= CLIMB_TOP) {
        RISE[i] = Math.max(0, rise); // a step: the track run rides over it
      } else {
        /**
         * THE AMBIGUOUS BAND, AND ONE RAY SETTLES IT. With `PASS_TOP` at 3.2
         * the (CLIMB_TOP, PASS_TOP] band holds two different things the
         * downward ray cannot tell apart: a market awning 2.5 m OVER an open
         * road (drive under it, exactly as the roof rule always has) and a
         * 2.6 m masonry shed standing ON the road (nothing to drive under —
         * `_trimAtBlockers` must stop the route, or the plough must have an
         * instance to erase). Measured the wrong way first: classifying the
         * whole band as mass cut BOTH approaches off at the mid-street market
         * awnings within 48 m of the pocket. So a horizontal ray is fired at
         * hull height from the clear air of a neighbouring sample: it passes
         * under an awning and buries itself in a shed.
         */
        const j = i >= 2 ? i - 2 : Math.min(n - 1, i + 2);
        o.set(p.X[j], ROAD[i] + 1.1, p.Z[j]);
        d.set(p.X[i] - p.X[j], 0, p.Z[i] - p.Z[j]);
        const len = Math.hypot(d.x, d.z);
        let solid = false;
        if (len > 0.1) {
          d.multiplyScalar(1 / len);
          solid = !!physics.raycast(o, d, len + 0.3, MASKW)?.hit;
        }
        SOLID[i] = solid ? 1 : 0;
        RISE[i] = solid ? CLIMB_TOP : 0;
      }
    }
    p.ROAD = ROAD;
    p.STEP = RISE;
    p.PILE = PILE;
    p.SOLID = SOLID;
  }

  /* ---------------------------------------------------------- one tank --- */

  /**
   * BAKE THE WHEEL. The approach first — no approach, no sortie — then one
   * spoke per capture point, each starting from the approach's OWN BAKED END so
   * the two join without a step, each trimmed at the first sample that comes
   * inside `ZONE_STANDOFF` of any capture centre, and each kept only if what
   * survives still reaches its point. Every drop is printed with its reason.
   */
  _bakeLegs(spec, world, physics, props) {
    const zones = this._zoneCentres();
    const legs = [];
    const w = new THREE.Vector3();
    const pts = spec.approach.map((p) => world.levelToWorld(p[0], 0, p[1], new THREE.Vector3()));
    const approach = this._bakePath(pts, world, physics, props);
    if (!approach) return null;
    this._trimToStandoff(approach, zones, null);
    this._trimAtBlockers(approach, physics, props);
    if (approach.n < 4 || approach.length < MIN_ROUTE) return null;
    approach.zone = null;
    legs.push(approach);
    const hub = new THREE.Vector3(
      approach.X[approach.n - 1], approach.Y[approach.n - 1], approach.Z[approach.n - 1]
    );

    for (const sp of spec.spokes ?? []) {
      const target = zones.find((z) => z.id === sp.zone);
      if (!target) {
        console.warn(`[tank] ${spec.id}: no capture point called ${sp.zone} — spoke skipped`);
        continue;
      }
      const wp = sp.points.map((p, i) =>
        i === 0 ? hub.clone() : world.levelToWorld(p[0], 0, p[1], w.clone())
      );
      const path = this._bakePath(wp, world, physics, props);
      if (!path) {
        console.warn(`[tank] ${spec.id}->${sp.zone}: SPOKE DROPPED — no drivable route off the hub.`);
        continue;
      }
      const why = path.stop;
      // Join it to the hub exactly: the slide may have moved sample 0 by metres.
      path.X[0] = hub.x; path.Z[0] = hub.z; path.Y[0] = hub.y;
      path.ROAD[0] = Math.min(path.ROAD[0], hub.y);
      this._trimToStandoff(path, zones, target);
      this._trimAtBlockers(path, physics, props);
      const d = path.n
        ? Math.hypot(path.X[path.n - 1] - target.x, path.Z[path.n - 1] - target.z)
        : Infinity;
      if (path.n < 4 || path.length < MIN_ROUTE || d > ZONE_ARRIVE) {
        console.warn(
          `[tank] ${spec.id}->${sp.zone}: SPOKE DROPPED — ${path.length.toFixed(0)} m of route ` +
            `ends ${Number.isFinite(d) ? d.toFixed(0) : '-'} m off the point (needs <= ${ZONE_ARRIVE}) — ` +
            `${path.stop ?? why}`
        );
        continue;
      }
      path.zone = sp.zone;
      legs.push(path);
    }
    return legs;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE OTHER HALF OF RAISING `PASS_TOP`: WHAT CANNOT BE ERASED STOPS THE ROUTE
   * ────────────────────────────────────────────────────────────────────────
   * With the ceiling at 3.2 a side probe resumes past a 2.6 m masonry shed as
   * happily as past a stacked-crate stall — and only one of those two can the
   * hull actually remove. A route baked through the other is a hull sliding
   * through a wall that is still standing afterwards, which the plough's own
   * header names as the worst outcome there is.
   *
   * So every leg is re-read after the standoff trim: a rise over the road that
   * is above `CLIMB_TOP` (it cannot be climbed), no higher than `PASS_TOP`
   * (it is standing mass, not a balcony the ground ray caught — over
   * `PASS_TOP` is the `_bakeRide` roof rule and was always ridden under), and
   * with NO `prop_*` instance under the corridor tall enough to account for
   * it (it cannot be ploughed) is a wall in the driving line. The leg is cut a
   * hull length short of it and says so.
   *
   * MEASURED, seed 7: BLUE's spoke to C dead-ended nose-against exactly this —
   * a 4.2 x 2.6 x 3.6 m merged-masonry shed at world (-37, 19) — and the hull
   * then sat against it for the rest of the match, which is the picture the
   * player's report calls スタック.
   */
  _trimAtBlockers(p, physics, props) {
    const grid = props?.length ? this._propGridOf(props) : null;
    const MASKW = physics.MASK.WORLD;
    const o = this._bv ?? (this._bv = new THREE.Vector3());
    const d = this._bv2 ?? (this._bv2 = new THREE.Vector3());
    /**
     * A RUN, NOT A SAMPLE — measured, and the first cut of this rule got it
     * wrong. RED's approach clips the corner of the 3.6 m masonry shed at
     * world (17, 26) for ONE sample: the centreline's own downward ray lands
     * on its roof, everything either side of it is road, and a 6.9 m hull
     * rides across 1.25 m of clipped corner without noticing. Trimming there
     * cost RED seventeen metres of approach and, through the hub, THREE of its
     * four destinations. A wall that really crosses the driving line is at
     * least a hull's width thick and blocks `BLOCK_RUN` samples in a row.
     */
    let run = 0;
    let runStart = -1;
    for (let i = 0; i < p.n; i++) {
      const rise = p.Y[i] - p.ROAD[i];
      if (rise <= CLIMB_TOP + 0.05 || rise > PASS_TOP) { run = 0; continue; }
      // Only rises `_bakeRide`'s horizontal ray PROVED are standing mass — a
      // market awning over an open road is driven under, not trimmed at.
      if (!p.SOLID?.[i]) { run = 0; continue; }
      let erasable = false;
      if (grid) {
        const cell = grid.cell;
        const c0 = Math.floor((p.X[i] - PLOUGH_HALF) / cell);
        const c1 = Math.floor((p.X[i] + PLOUGH_HALF) / cell);
        const d0 = Math.floor((p.Z[i] - PLOUGH_HALF) / cell);
        const d1 = Math.floor((p.Z[i] + PLOUGH_HALF) / cell);
        for (let cx = c0; cx <= c1 && !erasable; cx++) {
          for (let cz = d0; cz <= d1 && !erasable; cz++) {
            const bucket = grid.g.get(cx * 65536 + cz);
            if (!bucket) continue;
            for (let k = 0; k < bucket.length; k++) {
              const q = bucket[k];
              const dx = q.x - p.X[i];
              const dz = q.z - p.Z[i];
              if (dx * dx + dz * dz > PLOUGH_HALF * PLOUGH_HALF) continue;
              // Its top over the ROAD — the same measurement the plough makes.
              o.set(q.x, p.ROAD[i] + 30, q.z);
              d.set(0, -1, 0);
              const t = physics.raycast(o, d, 45, MASKW);
              if (!t?.hit) continue;
              const top = 30 - t.distance;
              // The instance has to ACCOUNT for the rise: a barrel beside a
              // shed must not license driving through the shed.
              if (top >= rise - 0.5 && top <= PLOUGH_TOP) { erasable = true; break; }
            }
          }
        }
      }
      if (erasable) { run = 0; continue; }
      if (run === 0) runStart = i;
      if (++run < BLOCK_RUN) continue;
      const cut = Math.max(0, runStart - Math.ceil(HULL_L / STEP));
      p.n = cut;
      p.length = cut > 0 ? p.S[cut - 1] : 0;
      p.stop =
        `blocked by ${rise.toFixed(1)}m of unremovable mass over ${run} samples ` +
        `at (${p.X[runStart].toFixed(0)},${p.Z[runStart].toFixed(0)})`;
      p.trimmed = true;
      return;
    }
  }

  /** Capture centres in world space, D included. @see `_logZones` on `allZones`. */
  _zoneCentres() {
    const m = this.ctx.peek('match');
    const zones = m?.allZones ?? m?.sites ?? [];
    return zones.map((z) => ({ id: z.id, x: z.position.x, z: z.position.z }));
  }

  /**
   * Cut the path at the first sample inside `ZONE_STANDOFF` of ANY capture
   * centre. The target's own circle is not excused — a hull that stops 16 m
   * short of the point it is shelling is the whole guarantee.
   */
  _trimToStandoff(p, zones, target) {
    let cut = p.n;
    let which = '';
    for (let i = 0; i < p.n; i++) {
      for (const z of zones) {
        if (Math.hypot(p.X[i] - z.x, p.Z[i] - z.z) < ZONE_STANDOFF) {
          if (i < cut) { cut = i; which = z.id; }
          break;
        }
      }
      if (cut < p.n) break;
    }
    if (cut >= p.n) return;
    p.n = cut;
    p.length = cut > 0 ? p.S[cut - 1] : 0;
    p.stop = `trimmed at the ${ZONE_STANDOFF} m stand-off on ${which}`;
    p.trimmed = true;
    void target;
  }

  _buildTank(spec, world, physics, props) {
    const rng = this.rng.fork();
    const legs = this._bakeLegs(spec, world, physics, props);
    if (!legs) {
      console.error(
        `[tank] ${spec.id}: no drivable route from the authored polyline — SORTIE DROPPED. ` +
          'The street is narrower than the hull or the anchor is not on the ground; ' +
          'fix `ROUTES` in src/match/tank.js.'
      );
      return null;
    }
    const path = legs[0];

    const root = new THREE.Group();
    root.name = `match_tank_${spec.id}`;
    root.matrixAutoUpdate = false;
    root.visible = false;
    this.group.add(root);

    const turret = new THREE.Group();
    turret.name = `match_tank_${spec.id}_turret`;
    turret.matrixAutoUpdate = false;
    turret.position.set(0, 1.52, -0.15);
    root.add(turret);

    const gun = new THREE.Group();
    gun.name = `match_tank_${spec.id}_gun`;
    gun.matrixAutoUpdate = false;
    gun.position.set(0, 0.42, 0.95);
    turret.add(gun);

    const tank = {
      id: spec.id,
      team: spec.team,
      name: spec.name,
      /** So `ai.teamOf()` and `ui.isFriendlyTarget` answer correctly when a
       *  round lands on us — see the `damage:dealt` note in `_takeRound`. */
      isTank: true,
      /**
       * ────────────────────────────────────────────────────────────────────
       * AND SO THE INFANTRY CAN SEE IT AT ALL
       * ────────────────────────────────────────────────────────────────────
       * `AiSystem.hostilesOf` built its list from `ai.agents` plus the player,
       * and `Agent.target` only ever comes from that list — so measured, over
       * three matches with a hull on the field: a tank appeared in a hostile
       * list 0 times, a bot aimed at one 0 times, and the `deck` damage column
       * was 0 in every row. `match` hands `ai` this array (`ai.vehicles`) and
       * these three fields are the contract it reads:
       *
       *   isVehicle  it is not an `Agent`; the armour rules apply to it
       *   aimPoint   WHERE to shoot it, because a tank has no chest
       *   yaw        its heading, so "is the deck presented" is answerable
       *
       * `team`, `alive` and `position` were already here and already mean the
       * right thing — `alive` is exactly "out of its pocket and shootable".
       */
      isVehicle: true,
      /**
       * THE ENGINE DECK'S REAR-TOP, in world space, rewritten once a frame by
       * `_pose` off matrices it has already updated.
       *
       * It is `DECK_AIM` and not the hull centre because of the collider
       * layout: `hull` is 0.22, `turret` 0.4 and `deck` 1.7, so the deck is the
       * only box a rifle can do arithmetic with — and the deck's own rear-top
       * corner is the only PART of it that is astern of the turret (z -2.0) and
       * clear of the hull roof (y 2.15). Aim a metre further forward and every
       * shot from behind buries itself in the turret at 0.4.
       */
      aimPoint: new THREE.Vector3(),
      /**
       * WHEN THE MAIN GUN LAST FIRED, in `time.elapsed` seconds — the fourth
       * field of the `ai.vehicles` contract. `AiSystem.armourWorth` reads it
       * for the suppression clause: a tank that has just fired on your side of
       * the street is not ignorable, and the player judges the AI by what he
       * can SEE it doing. Written by `_mainGun` and `_coax`, reset by `_roll`.
       */
      firedAt: -1e9,
      /** Contact-breach cadence — @see the `damageAt` call in `_drive`. */
      breachIn: 0,
      /** THE WHEEL. `legs[0]` is the approach and its end is the hub; every
       *  other leg is a spoke off it, carrying the `zone` it stands off. */
      legs,
      /** The approach, kept under its old name for anything that reads it. */
      path,
      /** Which leg the hull is on, and which way along it. */
      legIx: 0,
      legDir: 1,
      /** The capture point it is trying to be at, and the plan to get there. */
      targetZone: null,
      retarget: 0,
      /** Up to two queued legs — a spoke back to the hub, then the next spoke. */
      plan: [
        { leg: -1, dir: 1 }, { leg: -1, dir: 1 }, { leg: -1, dir: 1 },
      ],
      planN: 0,
      planI: 0,
      /** The hull's actual heading. It CHASES the leg's; over `PIVOT_HOLD` off
       *  it, the hull pivots on the spot instead of driving. */
      yaw: 0,
      root,
      turret,
      gun,
      rng,
      meshes: [],
      materials: [],
      colliders: [],
      state: 'parked',
      /** Metres travelled along the current leg. */
      s: 0,
      hold: 0,
      health: RULES.tankHealth,
      alive: false,
      /** World position of the hull centre, kept in step every frame. */
      position: new THREE.Vector3(),
      /** Where the gun is pointing, in the hull's frame. */
      turretYaw: 0,
      gunPitch: 0,
      target: null,
      acquireIn: 0,
      reload: 0,
      coax: 0,
      coaxLeft: 0,
      lastHitBy: null,
      /** When, so the crew can turn on somebody who is still shooting at it. */
      lastHitAt: -1e9,
      /**
       * ONE WOUND PER ROUND, remembered across the events of a single frame.
       * @see the `_takeRound` note on `oneWoundPerRound`.
       */
      _woundFrame: -1,
      _woundSource: null,
      chunkCount: 0,
      wheelSpin: 0,
      /** Piles the hull will meet, baked by `_bakePlough`. */
      plough: null,
      /** Their debris meshes — @see the note in `_bakePileDebris`. */
      ploughMeshes: [],
      /** Seconds of plough drag left on the throttle. */
      ploughDrag: 0,
      uniforms: { uT: { value: -1 }, uAnim: { value: 1 } },
      /**
       * WHAT WAS ACTUALLY DONE TO IT, so "not easy" is a measurement rather
       * than an opinion. Preallocated and reset per sortie — nothing here
       * allocates in a frame. `_tankttk.mjs` reads it.
       */
      stats: {
        rounds: 0, roundDmg: 0,
        hull: 0, turret: 0, deck: 0,
        /**
         * …AND HOW MANY ROUNDS EACH BOX ATE, not just what they were worth.
         * "447 into the glacis, 58 into the deck" is a statement about COUNTS,
         * so a report that only carries damage cannot say whether the men are
         * shooting the right part of the tank. @see `_takeRound`.
         */
        nHull: 0, nTurret: 0, nDeck: 0,
        /** Damage events discarded by `oneWoundPerRound`, when it is on. */
        dupes: 0,
        blasts: 0, blastDmg: 0,
        frags: 0, fragDmg: 0,
        liveT: 0, kills: 0, sorties: 0, deaths: 0,
        /** Prop instances this hull's GUN took off the map. */
        razed: 0,
        /** …and cache-house elevations it blew open. @see `_mainGun`. */
        breaches: 0,
        /** Capture points it has stood off, in order. */
        legs: 0,
      },
    };

    this._buildBody(tank);
    this._buildWreck(tank);
    this._buildColliders(tank, physics);
    this.physics = physics;
    this._bakePlough(tank, physics, props);
    this._logZones(tank);
    return tank;
  }

  /* ====================================================================== */
  /* THE PLOUGH, BAKED AT BOOT                                              */
  /* ====================================================================== */

  /**
   * EVERY `prop_*` INSTANCE IN THE LEVEL, IN WORLD SPACE. Built once, shared by
   * both hulls, and dropped the moment the last route is baked — it is 27014
   * records on this map and none of it is wanted after boot.
   *
   * `src/world` publishes no per-prop registry (there is no `world.props` the
   * way there is a `world.demolitions`), so the geometry is read off the scene
   * graph the renderer already holds. That is a READ of a public field, and
   * nothing here writes to `world` — the only write this feature ever makes is
   * to an instance matrix it has first proved belongs to a pile the hull drove
   * through, and it puts every one of them back in `reset()`.
   */
  _buildPropIndex() {
    const list = [];
    const m = new THREE.Matrix4();
    const w = new THREE.Matrix4();
    // The world root carries `levelYaw`; without this the instances come back
    // in the level's own frame and nothing binds.
    this.ctx.scene.updateMatrixWorld(true);
    this.ctx.scene.traverse((o) => {
      if (!o.isInstancedMesh || !o.name.startsWith('prop_')) return;
      for (let j = 0; j < o.count; j++) {
        o.getMatrixAt(j, m);
        w.multiplyMatrices(o.matrixWorld, m);
        list.push({ mesh: o, slot: j, x: w.elements[12], y: w.elements[13], z: w.elements[14] });
      }
    });
    return list;
  }

  /**
   * MARCH THE CORRIDOR, CLASSIFY THE MASS, AND SOLVE ITS COLLAPSE.
   *
   * Four lanes across the hull's own width, one short forward ray per lane per
   * path sample, at 0.55 m — under the glacis and over the kerb. Anything the
   * ray finds is measured with a downward ray for its height over its own
   * ground, and that height is the whole classifier (@see `PLOUGH_TOP`).
   *
   * Nothing here trims the route. The lateral span test in `_bakePath` still
   * owns "the tank stops", and it already stops at exactly the mass this test
   * calls blocking — so this pass is purely additive and no route gets shorter
   * because of it. That is deliberate: a new trim rule is how you silently lose
   * a sortie the map used to have.
   */
  _bakePlough(tank, physics, props) {
    tank.plough = [];
    // @see the note on the `Rng` import: never `tank.rng`, which the gun draws
    // its dispersion from at runtime.
    let h = 0x9e3779b9;
    for (let i = 0; i < tank.id.length; i++) h = (Math.imul(h ^ tank.id.charCodeAt(i), 0x85ebca6b) >>> 0);
    tank.ploughRng = new Rng(h >>> 0);
    if (!props?.length) return;
    for (let li = 0; li < tank.legs.length; li++) this._bakeLegPlough(tank, li, physics, props);
    if (!tank.plough.length) return;
    this._bindPloughCollision(tank, physics);
    for (const pile of tank.plough) this._bakePileDebris(tank, pile);
    /**
     * AND THE RIDE IS TOLD WHICH SAMPLES A PILE OWNS. Without this the hull
     * climbs the baked step of a pile the glacis erased `PLOUGH_NOSE` earlier
     * and crosses the whole thing a foot in the air. @see `_bakeRide`.
     */
    for (const pile of tank.plough) {
      const p = tank.legs[pile.leg];
      for (let i = 0; i < p.n; i++) {
        if (Math.abs(p.S[i] - pile.s) <= PLOUGH_MERGE) p.PILE[i] = pile.ix;
      }
    }
  }

  /**
   * THE PROP INDEX ON A LATTICE, so the corridor sweep in `_bakeLegPlough` is a
   * cell lookup instead of 25 039 distance tests per path sample. Built once
   * for both hulls off the same index `build()` already holds, and dropped with
   * it — @see `build`, which nulls `_propGrid` beside `_ploughClaimed`.
   */
  _propGridOf(props) {
    if (this._propGrid) return this._propGrid;
    const cell = 5;
    const g = new Map();
    for (const q of props) {
      const k = Math.floor(q.x / cell) * 65536 + Math.floor(q.z / cell);
      let c = g.get(k);
      if (!c) g.set(k, (c = []));
      c.push(q);
    }
    return (this._propGrid = { cell, g });
  }

  /** One leg's worth of piles. @see `_bakePlough`. */
  _bakeLegPlough(tank, legIx, physics, props) {
    const p = tank.legs[legIx];
    const MASKW = physics.MASK.WORLD;
    const o = new THREE.Vector3();
    const d = new THREE.Vector3();
    const down = new THREE.Vector3(0, -1, 0);
    const piles = [];

    for (let i = 0; i < p.n; i++) {
      const yaw = p.YAW[i];
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const sx = fz;
      const sz = -fx;
      for (const lane of [-0.8, -0.3, 0.3, 0.8]) {
        const ox = p.X[i] + sx * lane * PLOUGH_HALF;
        const oz = p.Z[i] + sz * lane * PLOUGH_HALF;
        const g = physics.groundHeight(ox, oz, 30);
        if (!Number.isFinite(g)) continue;
        o.set(ox, g + 0.55, oz);
        d.set(fx, 0, fz);
        const h = physics.raycast(o, d, STEP * 1.3, MASKW);
        if (!h?.hit) continue;
        const hx = ox + fx * h.distance;
        const hz = oz + fz * h.distance;
        o.set(hx + fx * 0.12, g + 30, hz + fz * 0.12);
        const t = physics.raycast(o, down, 45, MASKW);
        if (!t?.hit) continue;
        const top = g + 30 - t.distance - g;
        // THE CLASSIFIER. Over the glacis is a building; under a kerb is not an
        // event. Everything between is a pile the hull shoves aside.
        if (top <= PLOUGH_MIN || top > PLOUGH_TOP) continue;
        let pile = null;
        for (const q of piles) {
          if (Math.hypot(q.x - hx, q.z - hz) < PLOUGH_MERGE) { pile = q; break; }
        }
        if (pile) {
          pile.top = Math.max(pile.top, top);
          pile.s = Math.min(pile.s, p.S[i]);
        } else {
          piles.push({ leg: legIx, s: p.S[i], x: hx, y: g, z: hz, top, fired: false });
        }
      }
    }

    /* ---- bind each pile to the instances that draw it ------------------ */
    // Shared across BOTH hulls, so the two routes can never claim one instance.
    const claimed = this._ploughClaimed ?? (this._ploughClaimed = new Set());

    /**
     * ────────────────────────────────────────────────────────────────────────
     * 「戦車が破壊可能オブジェを破壊していない」 — THE RAY WAS FLYING OVER THEM
     * ────────────────────────────────────────────────────────────────────────
     * MEASURED BEFORE IT WAS CHANGED, with `_tankwhy.mjs`, which counts the
     * prop instances standing inside `PLOUGH_HALF` of the metres a hull
     * ACTUALLY drove and then asks of each survivor why it is still there:
     *
     *     seed 7    RED  62 in the corridor, 35 erased — 27 LEFT STANDING
     *               BLUE 224 in the corridor, 112 erased — 112 LEFT STANDING
     *     seed 12   RED  117 / 67 — 50 left standing
     *               BLUE 208 / 93 — 115 left standing
     *
     * Half of everything the hull drove over survived it, and EVERY SINGLE
     * SURVIVOR was in the same category: bound to no pile at all. None was held
     * by the other hull's claim and none was in a pile that simply had not
     * fired yet — so it was never a scheduling problem, it was discovery.
     *
     * THE CAUSE IS ONE NUMBER. The pass above finds mass with a FORWARD ray at
     * `g + 0.55`, and the dressing this street is made of is shorter than that:
     * the survivors are `prop_sandbag_a/b/c`, `prop_jersey`, `prop_crate_a`,
     * `prop_barrel_wood`, `prop_jerry_can`, `prop_tyre`, `prop_brick_a/b`,
     * `prop_rock_a/b`, `prop_litter`, `prop_can`, `prop_bottle`, `prop_shrub`.
     * A ray half a metre off the road flies clean over a sandbag line, and four
     * lanes 1.14 m apart miss anything sitting between them.
     *
     * So the corridor is now swept against THE PROPS THEMSELVES rather than
     * against what a ray happened to touch, and the classifier is unchanged —
     * an instance is measured with one downward ray for its height OVER THE
     * ROAD `_bakeRide` already found, and mass over `PLOUGH_TOP` is still a
     * building the hull does not get to erase. That is what keeps a lamp post,
     * a pier and a plinth run standing while the sandbags go.
     *
     * A SWEPT PROP JOINS THE NEAREST PILE WITHIN `PLOUGH_MERGE` and only starts
     * a new one if it is over `PLOUGH_MIN` — a brick lying in the road beside a
     * sandbag line goes with the line, and a brick lying in the road on its own
     * is still not an event.
     */
    if (props?.length) {
      const grid = this._propGridOf(props);
      const cell = grid.cell;
      const half = PLOUGH_HALF;
      const o2 = new THREE.Vector3();
      const seen = new Set();
      for (let i = 0; i < p.n; i++) {
        const cx0 = Math.floor((p.X[i] - half) / cell);
        const cx1 = Math.floor((p.X[i] + half) / cell);
        const cz0 = Math.floor((p.Z[i] - half) / cell);
        const cz1 = Math.floor((p.Z[i] + half) / cell);
        for (let cx = cx0; cx <= cx1; cx++) {
          for (let cz = cz0; cz <= cz1; cz++) {
            const bucket = grid.g.get(cx * 65536 + cz);
            if (!bucket) continue;
            for (let k = 0; k < bucket.length; k++) {
              const q = bucket[k];
              const dx = q.x - p.X[i];
              const dz = q.z - p.Z[i];
              if (dx * dx + dz * dz > half * half) continue;
              const key = `${q.mesh.id}:${q.slot}`;
              if (seen.has(key) || claimed.has(key)) continue;
              seen.add(key);
              // Its height over the ROAD, never over its own top.
              o2.set(q.x, p.ROAD[i] + 30, q.z);
              const t = physics.raycast(o2, down, 45, MASKW);
              if (!t?.hit) continue;
              const top = p.ROAD[i] + 30 - t.distance - p.ROAD[i];
              if (top > PLOUGH_TOP) continue; // structure: it stays
              let pile = null;
              let bestD = PLOUGH_MERGE * PLOUGH_MERGE;
              for (const c of piles) {
                const ex = c.x - q.x;
                const ez = c.z - q.z;
                const d2 = ex * ex + ez * ez;
                if (d2 < bestD) { bestD = d2; pile = c; }
              }
              if (!pile) {
                if (top < PLOUGH_MIN) continue; // a kerb is not an event
                pile = { leg: legIx, s: p.S[i], x: q.x, y: p.ROAD[i], z: q.z, top, fired: false, found: [] };
                piles.push(pile);
              }
              pile.top = Math.max(pile.top, top);
              pile.s = Math.min(pile.s, p.S[i]);
              (pile.found ?? (pile.found = [])).push({ mesh: q.mesh, slot: q.slot, m: null, wx: q.x, wz: q.z });
              claimed.add(key);
            }
          }
        }
      }
    }

    for (const pile of piles) {
      const half = PLOUGH_MERGE * 0.75;
      pile.minX = pile.x - half; pile.maxX = pile.x + half;
      pile.minZ = pile.z - half; pile.maxZ = pile.z + half;
      /**
       * …AND THE BOX REACHES ROUND WHAT THE SWEEP FOUND. A sandbag line is
       * three metres of props on a pile centred at one of them; a box that only
       * ever reached `PLOUGH_MERGE * 0.75` would draw and unsolid the middle of
       * it and leave the ends. The growth is bounded by the attach radius: a
       * prop joins a pile only inside `PLOUGH_MERGE`, so no pile can grow past
       * it whatever the street is dressed with.
       */
      for (const r of pile.found ?? []) {
        pile.minX = Math.min(pile.minX, r.wx - 0.5); pile.maxX = Math.max(pile.maxX, r.wx + 0.5);
        pile.minZ = Math.min(pile.minZ, r.wz - 0.5); pile.maxZ = Math.max(pile.maxZ, r.wz + 0.5);
      }
      /**
       * A pile's own boxes STAND ON the road, so the band has to reach down to
       * the road to contain their side faces — and a hole in the road is how
       * men fall out of the level. The two are reconciled by `riseY` rather
       * than by lifting the floor: a triangle is only taken if it RISES above
       * the carriageway, which every side and top face of a prop does and no
       * piece of ground ever does.
       */
      pile.minY = pile.y - 0.2;
      pile.maxY = pile.y + pile.top + 0.9;
      pile.riseY = pile.y + 0.12;
      // The sweep's own finds are already claimed and already exclusive.
      pile.inst = pile.found ?? [];
      /**
       * AN INSTANCE BELONGS TO EXACTLY ONE PILE, and the alternative was a bug
       * that only showed up in `reset()`. RED's two piles are 2.5 m apart on
       * the arc and their binding boxes overlap, so two instances were bound to
       * both: the first pile saved the real matrix and zeroed it, the second
       * then saved THE ZEROED ONE, and restoring in order put the zero back.
       * Measured before the fix as 19 of 21 and 12 of 14 instances coming back.
       * The triangle sweep already claims exclusively (it `break`s on the first
       * pile that owns a centroid); this is the same rule for the drawn half.
       */
      for (const q of props) {
        if (q.x < pile.minX || q.x > pile.maxX) continue;
        if (q.z < pile.minZ || q.z > pile.maxZ) continue;
        if (q.y < pile.y - 0.9 || q.y > pile.y + pile.top + 1.2) continue;
        const key = `${q.mesh.id}:${q.slot}`;
        if (claimed.has(key)) continue;
        claimed.add(key);
        pile.inst.push({ mesh: q.mesh, slot: q.slot, m: null });
      }
      // NOTHING TO ERASE, NOTHING TO PLOUGH. @see the note on `PLOUGH_TOP`.
      if (pile.inst.length) {
        pile.ix = tank.plough.length;
        tank.plough.push(pile);
      }
    }
  }

  /**
   * The static triangles each pile is made of, found ONCE by a sweep of the
   * packed BVH array rather than per pile. The mask write at fire time is the
   * same move `Airstrike._setProxySolid` and `Assembler.setScopeSolid` both
   * make — a fill over a cached range, no BVH rebuild, no stall.
   *
   * Collision is only ever REMOVED, never added, so the nav grid baked at boot
   * can only become MORE walkable than it was measured to be and `stuckcheck`
   * cannot regress. HONEST LIMIT: `ai.cover` was baked with these piles solid
   * and there is no `ai` hook for a prop the way `syncCoverBlocks` is the hook
   * for a demolition block, so a man may briefly crouch behind a sandbag line
   * a tank has flattened. That is the same staleness class `_coverstale.mjs`
   * already measures for the airstrike ruins, over a much smaller area.
   */
  _bindPloughCollision(tank, physics) {
    const sw = physics.staticWorld;
    const pos = sw?.pos;
    const n = sw?.triCount ?? 0;
    if (!pos || !n || !sw.mask) return;
    const lists = tank.plough.map(() => []);
    /**
     * THE PILES ON THEIR OWN LATTICE FIRST. This walks every static triangle on
     * the map — 214 270 of them — and it used to test each one against EVERY
     * pile. That was 26 piles; the corridor sweep above finds the dressing the
     * old forward ray flew over, so it is now several times that, and 214 270 x
     * n is the wrong shape to grow. One 4 m grid keyed the same way the raze
     * atlas keys its own turns it back into a cell lookup.
     */
    const CELL = 4;
    const bins = new Map();
    for (let k = 0; k < tank.plough.length; k++) {
      const q = tank.plough[k];
      for (let cx = Math.floor(q.minX / CELL); cx <= Math.floor(q.maxX / CELL); cx++) {
        for (let cz = Math.floor(q.minZ / CELL); cz <= Math.floor(q.maxZ / CELL); cz++) {
          const kk = cx * 65536 + cz;
          let c = bins.get(kk);
          if (!c) bins.set(kk, (c = []));
          c.push(k);
        }
      }
    }
    /**
     * THE WHOLE TRIANGLE HAS TO FIT, not just its centroid — that is the
     * difference between flattening a sandbag line and punching an invisible
     * hole in the front of a building. A centroid test takes a SLICE out of any
     * tall wall that happens to pass within `PLOUGH_MERGE` of a pile, and the
     * wall goes on being drawn, so the player gets a window he can shoot
     * through and cannot see. A merged wall's triangles are metres long and
     * fail this test; a 0.9 m prop box's fit inside it entirely.
     */
    for (let t = 0; t < n; t++) {
      const o = t * 9;
      const x0 = pos[o], y0 = pos[o + 1], z0 = pos[o + 2];
      const x1 = pos[o + 3], y1 = pos[o + 4], z1 = pos[o + 5];
      const x2 = pos[o + 6], y2 = pos[o + 7], z2 = pos[o + 8];
      const lo = Math.min(y0, y1, y2);
      const hi = Math.max(y0, y1, y2);
      const xlo = Math.min(x0, x1, x2), xhi = Math.max(x0, x1, x2);
      const zlo = Math.min(z0, z1, z2), zhi = Math.max(z0, z1, z2);
      const bin = bins.get(Math.floor(((xlo + xhi) * 0.5) / CELL) * 65536 + Math.floor(((zlo + zhi) * 0.5) / CELL));
      if (!bin) continue;
      for (let b = 0; b < bin.length; b++) {
        const k = bin[b];
        const q = tank.plough[k];
        if (xlo < q.minX || xhi > q.maxX) continue;
        if (zlo < q.minZ || zhi > q.maxZ) continue;
        if (lo < q.minY || hi > q.maxY) continue;
        if (hi <= q.riseY) continue; // it lies on the road: it IS the road
        lists[k].push(t);
        break;
      }
    }
    for (let k = 0; k < tank.plough.length; k++) {
      tank.plough[k].tris = Int32Array.from(lists[k]);
    }
  }

  /**
   * The pile's own collapse, cut and solved at boot exactly the way the wreck
   * is — trajectories into four instanced attributes, one uniform to fire it.
   * The debris is VISUAL ONLY: it never becomes collision, so `_floatcheck.mjs`
   * cannot find a floating solid piece that came from a plough.
   */
  _bakePileDebris(tank, pile) {
    const rng = tank.ploughRng;
    const w = (pile.maxX - pile.minX) * 0.85;
    const dp = (pile.maxZ - pile.minZ) * 0.85;
    const chunks = [];
    fracture(
      /**
       * 5x2x5, NOT 3x2x3. Photographed at 3x2x3 the pieces came off a 0.76 m
       * pile at roughly 1.2 x 0.38 x 1.2 m and read as SLABS lying in the road
       * rather than as a barrier that had been broken up. Fifty pieces off the
       * same box are ~0.7 m across, which is a lump of concrete.
       */
      { id: 'pile', size: [w, pile.top, dp], at: [pile.x, pile.y + pile.top * 0.5, pile.z], cut: [5, 2, 5] },
      0, rng, (c) => chunks.push(c)
    );
    const n = chunks.length;
    const geo = chunkGeometry();
    const uniforms = { uT: { value: -1 }, uAnim: { value: 1 } };
    const mat = makeChunkMaterial(this.ctx, this._lib, 'concrete', uniforms);
    mat.color.setHex(0x9c9482);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.name = `match_tank_${tank.id}_plough`;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.userData.owNoShadow = true;
    mesh.userData.owNoPrepass = true;
    mesh.updateMatrix();
    this.group.add(mesh);

    const mot = new Float32Array(n * 4);
    const off = new Float32Array(n * 3);
    const axis = new Float32Array(n * 3);
    const uv = new Float32Array(n * 3);
    const colour = new Float32Array(n * 3);
    const posv = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const m4 = new THREE.Matrix4();
    const ax = new THREE.Vector3();
    const dir = new THREE.Vector3();
    // The shove comes from the hull, so the pile goes FORWARD and outward.
    const blast = new THREE.Vector3(pile.x, pile.y + 0.2, pile.z);

    for (let i = 0; i < n; i++) {
      const c = chunks[i];
      posv.set(c.cx, c.cy, c.cz);
      q.setFromAxisAngle(ax.set(rng.signed(), rng.signed(), rng.signed()).normalize(), rng.range(-0.05, 0.05));
      scale.set(c.hx * 2, c.hy * 2, c.hz * 2);
      m4.compose(posv, q, scale);
      m4.toArray(mesh.instanceMatrix.array, i * 16);

      dir.copy(posv).sub(blast);
      dir.y = 0;
      if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
      dir.normalize();
      const r = rng.range(0.5, 2.6);
      const sy = Math.max(c.hy, 0.08) + rng.range(0, 0.14);
      off[i * 3] = dir.x * r;
      off[i * 3 + 1] = pile.y + sy - posv.y;
      off[i * 3 + 2] = dir.z * r;
      mot[i * 4] = rng.range(0, 0.08);
      mot[i * 4 + 1] = clamp(rng.range(0.5, 1.1), 0.4, 1.6);
      mot[i * 4 + 2] = rng.range(0.2, 1.1);
      mot[i * 4 + 3] = rng.range(2.0, 8.0) * (rng.float() < 0.5 ? -1 : 1);
      ax.set(rng.signed(), rng.signed() * 0.5, rng.signed()).normalize();
      axis[i * 3] = ax.x;
      axis[i * 3 + 1] = ax.y;
      axis[i * 3 + 2] = ax.z;
      uv[i * 3] = rng.float();
      uv[i * 3 + 1] = rng.float();
      uv[i * 3 + 2] = rng.range(0.6, 1.4);
      const k = rng.range(0.5, 1.0);
      colour[i * 3] = 0.42 * k;
      colour[i * 3 + 1] = 0.39 * k;
      colour[i * 3 + 2] = 0.33 * k;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colour, 3);
    mesh.instanceColor.needsUpdate = true;
    geo.setAttribute('aMot', new THREE.InstancedBufferAttribute(mot, 4));
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
    geo.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 3));
    geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 3));
    pile.mesh = mesh;
    pile.uniforms = uniforms;
    pile.chunks = n;
    tank.materials.push(mat);
    /**
     * ITS OWN LIST, NOT `tank.meshes`. `_destroy` and `reset` both sweep
     * `tank.meshes` to swap the hull for the wreck — `mesh.visible = mesh ===
     * tank.wreck` and its inverse — so a plough mesh parked in there would be
     * shown by every round reset and hidden mid-fall by every brew-up.
     */
    tank.ploughMeshes.push(mesh);
  }

  /**
   * THE HULL REACHED A PILE. Sixteen floats to zero per instance, one mask fill
   * per pile, one uniform write, and the `fx` calls that all write into
   * preallocated rings. Nothing is cut, solved or searched for on this frame.
   */
  _firePlough(tank, pile) {
    if (pile.fired) return;
    pile.fired = true;

    // 1. it stops being drawn
    for (const r of pile.inst) {
      const arr = r.mesh.instanceMatrix.array;
      const o = r.slot * 16;
      if (!r.m) r.m = arr.slice(o, o + 16);
      arr.fill(0, o, o + 16);
      r.mesh.instanceMatrix.addUpdateRange(o, 16);
      r.mesh.instanceMatrix.needsUpdate = true;
    }
    /**
     * 2. it stops being solid — AND WHAT IT WAS IS REMEMBERED, ABSOLUTELY.
     *
     * `_restorePlough` used to put `LAYER.STATIC` back on every triangle it had
     * zeroed, on the assumption that every triangle a pile owns was STATIC to
     * begin with. MEASURED with `_maskproof.mjs`, that is false for 1428 of the
     * 5743 entries the two hulls touch: 17376 of this map's 213358 static
     * triangles are NOT solid at boot (`LAYER.CLIP` decks, masked-off faces),
     * and a pile's box test claims them like any other. So a round reset was
     * ADDING collision that had never been there — the exact shape of failure
     * `stuckcheck` exists to catch, arriving one round late.
     *
     * The fix is the one this repo already learnt on the cathedral host state:
     * store both states ABSOLUTE, never a delta applied and unapplied.
     */
    const sw = this.physics?.staticWorld;
    if (sw?.mask && pile.tris) {
      if (!pile.trisWas) pile.trisWas = new sw.mask.constructor(pile.tris.length);
      for (let i = 0; i < pile.tris.length; i++) {
        pile.trisWas[i] = sw.mask[pile.tris[i]];
        sw.mask[pile.tris[i]] = 0;
      }
    }
    // 3. it comes apart
    if (pile.uniforms) {
      pile.mesh.visible = true;
      pile.uniforms.uT.value = 0;
      pile.uniforms.uAnim.value = 1;
    }
    // 4. and the hull feels it
    tank.ploughDrag = PLOUGH_DRAG;

    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (fx) {
      fx.hazeRing?.(pile.x, pile.y + 0.3, pile.z, 1.4, 10, 0.35, 1.3);
      fx.dust?.(pile.x, pile.y + 0.4, pile.z, 1.8);
    }
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    audio?.play?.('strike_rubble', this._v.set(pile.x, pile.y + 0.5, pile.z), {
      level: 0.55, dur: 1.4, maxDist: 120, gain: 1.1, occlusion: 0.5,
    });
  }

  /** Put every pile back the way the level built it. */
  _restorePlough(tank) {
    if (!tank.plough) return;
    const sw = this.physics?.staticWorld;
    for (const pile of tank.plough) {
      if (pile.fired) {
        for (const r of pile.inst) {
          if (!r.m) continue;
          const arr = r.mesh.instanceMatrix.array;
          const o = r.slot * 16;
          arr.set(r.m, o);
          r.mesh.instanceMatrix.addUpdateRange(o, 16);
          r.mesh.instanceMatrix.needsUpdate = true;
        }
        // What each triangle ACTUALLY was, not what a pile is assumed to be
        // made of. @see the note in `_firePlough`.
        if (sw?.mask && pile.tris && pile.trisWas) {
          for (let i = 0; i < pile.tris.length; i++) sw.mask[pile.tris[i]] = pile.trisWas[i];
        }
      }
      pile.fired = false;
      if (pile.mesh) pile.mesh.visible = false;
      if (pile.uniforms) pile.uniforms.uT.value = -1;
    }
  }

  /* ====================================================================== */
  /* THE ATLAS: WHAT A SHELL CAN TAKE OFF THE MAP                            */
  /* ====================================================================== */

  /**
   * EVERY `prop_*` INSTANCE IN THE LEVEL, ON A LATTICE, WITH THE TRIANGLES THAT
   * DRAW IT BOUND TO IT — so a shell landing anywhere costs a cell lookup and a
   * fill, and nothing is searched for on the frame it goes off.
   *
   * WHY A TRIANGLE IS BOUND BY BEING SMALL AND NEAR. `src/world` merges its
   * static collision per SURFACE — the whole map is eight `collide_<surface>`
   * objects, 212146 triangles, and NOT ONE of them is named `prop_` — so
   * `staticWorld.object[t]` cannot say which triangles are a market stall and
   * which are the building behind it. The plough answered that with a box test
   * per pile; this answers it once, for the whole map, with the same two rules
   * that make the box test safe: a triangle bigger than `RAZE_TRI` in any axis
   * is structure and binds to nothing (a merged wall's triangles are metres
   * long), and a triangle further than `RAZE_BIND` from an instance origin is
   * not part of it. A shell therefore CANNOT punch an invisible hole in a
   * building, whatever it hits.
   *
   * PLOUGH PILES ARE LEFT ALONE. `_ploughClaimed` already owns ~35 instances
   * and saves their matrices on its own schedule; one instance owned by two
   * erasers means whichever restores second writes a zeroed matrix back, which
   * is the exact bug the note in `_bakePlough` was written about. They are
   * skipped here and the hull still flattens them.
   */
  _buildRazeAtlas(props, physics) {
    this._atlas = null;
    if (!props?.length) return;
    const sw = physics.staticWorld;
    const pos = sw?.pos;
    const nTri = sw?.triCount ?? 0;
    if (!pos || !nTri || !sw.mask) return;
    const t0 = performance.now();
    const claimed = this._ploughClaimed;
    const cells = new Map();
    const key = (cx, cz) => cx * 65536 + cz;
    const recs = [];
    for (const q of props) {
      if (claimed?.has(`${q.mesh.id}:${q.slot}`)) continue;
      const cx = Math.floor(q.x / RAZE_CELL);
      const cz = Math.floor(q.z / RAZE_CELL);
      const k = key(cx, cz);
      let c = cells.get(k);
      if (!c) cells.set(k, (c = []));
      const rec = { ix: recs.length, mesh: q.mesh, slot: q.slot, x: q.x, y: q.y, z: q.z, m: null, tris: null, fired: false };
      recs.push(rec);
      c.push(rec);
    }
    /* ---- bind the triangles ------------------------------------------- */
    const lists = new Array(recs.length);
    let bound = 0;
    for (let t = 0; t < nTri; t++) {
      const o = t * 9;
      const x0 = pos[o], y0 = pos[o + 1], z0 = pos[o + 2];
      const x1 = pos[o + 3], y1 = pos[o + 4], z1 = pos[o + 5];
      const x2 = pos[o + 6], y2 = pos[o + 7], z2 = pos[o + 8];
      if (Math.max(x0, x1, x2) - Math.min(x0, x1, x2) > RAZE_TRI) continue;
      if (Math.max(y0, y1, y2) - Math.min(y0, y1, y2) > RAZE_TRI) continue;
      if (Math.max(z0, z1, z2) - Math.min(z0, z1, z2) > RAZE_TRI) continue;
      const cxm = (x0 + x1 + x2) / 3;
      const cym = (y0 + y1 + y2) / 3;
      const czm = (z0 + z1 + z2) / 3;
      const bx = Math.floor(cxm / RAZE_CELL);
      const bz = Math.floor(czm / RAZE_CELL);
      let best = -1;
      let bestD = RAZE_BIND * RAZE_BIND;
      for (let ax = bx - 1; ax <= bx + 1; ax++) {
        for (let az = bz - 1; az <= bz + 1; az++) {
          const c = cells.get(key(ax, az));
          if (!c) continue;
          for (let i = 0; i < c.length; i++) {
            const r = c[i];
            const dy = cym - r.y;
            if (dy < -1.2 || dy > 3.0) continue;
            const dx = cxm - r.x, dz = czm - r.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD) { bestD = d2; best = r.ix; }
          }
        }
      }
      if (best < 0) continue;
      (lists[best] ?? (lists[best] = [])).push(t);
      bound++;
    }
    for (let i = 0; i < recs.length; i++) {
      recs[i].tris = lists[i] ? Int32Array.from(lists[i]) : EMPTY_TRIS;
    }
    this._atlas = { cells, recs, key, fired: [] };
    console.info(
      `[tank] raze atlas: ${recs.length} prop instances in ${cells.size} cells, ` +
        `${bound} of ${nTri} static triangles bound, in ${(performance.now() - t0).toFixed(0)}ms`
    );
  }

  /**
   * A SHELL LANDED. Every prop instance inside `r` stops being drawn and stops
   * being solid, in one pass over the cells the blast touches — no search, no
   * allocation, and collision only ever removed.
   */
  _razeAt(x, y, z, r) {
    const a = this._atlas;
    if (!a) return 0;
    const sw = this.physics?.staticWorld;
    const c0 = Math.floor((x - r) / RAZE_CELL), c1 = Math.floor((x + r) / RAZE_CELL);
    const d0 = Math.floor((z - r) / RAZE_CELL), d1 = Math.floor((z + r) / RAZE_CELL);
    const r2 = r * r;
    let n = 0;
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = d0; cz <= d1; cz++) {
        const cell = a.cells.get(a.key(cx, cz));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const rec = cell[i];
          if (rec.fired) continue;
          const dx = rec.x - x, dz = rec.z - z, dy = rec.y - y;
          if (dx * dx + dz * dz > r2) continue;
          if (dy > RAZE_UP || dy < -RAZE_UP) continue;
          this._eraseRec(rec, sw);
          a.fired.push(rec);
          n++;
        }
      }
    }
    return n;
  }

  /** The primitive: sixteen floats and a mask fill. @see `_firePlough`. */
  _eraseRec(rec, sw) {
    rec.fired = true;
    const arr = rec.mesh.instanceMatrix.array;
    const o = rec.slot * 16;
    if (!rec.m) rec.m = arr.slice(o, o + 16);
    arr.fill(0, o, o + 16);
    rec.mesh.instanceMatrix.addUpdateRange(o, 16);
    rec.mesh.instanceMatrix.needsUpdate = true;
    // Absolute, not a delta — @see the note in `_firePlough`.
    if (sw?.mask && rec.tris) {
      if (!rec.trisWas) rec.trisWas = new sw.mask.constructor(rec.tris.length);
      for (let i = 0; i < rec.tris.length; i++) {
        rec.trisWas[i] = sw.mask[rec.tris[i]];
        sw.mask[rec.tris[i]] = 0;
      }
    }
  }

  /** Put the town back up before the next round. */
  _restoreRaze() {
    const a = this._atlas;
    if (!a?.fired.length) return;
    const sw = this.physics?.staticWorld;
    for (const rec of a.fired) {
      if (rec.m) {
        const arr = rec.mesh.instanceMatrix.array;
        const o = rec.slot * 16;
        arr.set(rec.m, o);
        rec.mesh.instanceMatrix.addUpdateRange(o, 16);
        rec.mesh.instanceMatrix.needsUpdate = true;
      }
      // Absolute, not `LAYER.STATIC` — @see the note in `_firePlough`.
      if (sw?.mask && rec.tris && rec.trisWas) {
        for (let i = 0; i < rec.tris.length; i++) sw.mask[rec.tris[i]] = rec.trisWas[i];
      }
      rec.fired = false;
    }
    a.fired.length = 0;
  }

  /**
   * Closest the baked route ever gets to a capture circle, printed so the
   * "it must not block a capture zone" claim is a measurement.
   */
  _logZones(tank) {
    const m = this.ctx.peek('match');
    /**
     * `allZones`, NOT `sites`, AND THAT IS THE WHOLE VALUE OF THE LINE. D is
     * `locked` at boot and therefore not in `sites`, so the old measurement
     * silently omitted the one capture point the route now drives at: it
     * reported 55 m and 77 m to zone C while the true closest approach was
     * 35 m to D. A guarantee that skips a point does not guarantee anything.
     */
    const zones = m?.allZones ?? m?.sites;
    if (!zones?.length) return;
    let worst = Infinity;
    let worstLeg = '';
    let worstZone = '';
    const parts = [];
    for (const leg of tank.legs) {
      let best = Infinity;
      let which = '';
      let endTo = '';
      for (const z of zones) {
        for (let i = 0; i < leg.n; i++) {
          const d = Math.hypot(leg.X[i] - z.position.x, leg.Z[i] - z.position.z);
          if (d < best) { best = d; which = z.id; }
        }
        if (z.id === leg.zone) {
          endTo = Math.hypot(leg.X[leg.n - 1] - z.position.x, leg.Z[leg.n - 1] - z.position.z).toFixed(1);
        }
      }
      if (best < worst) { worst = best; worstLeg = leg.zone ?? 'HUB'; worstZone = which; }
      parts.push(
        `${(leg.zone ?? 'HUB').padEnd(3)} ${leg.length.toFixed(0)}m/${leg.n}, street ${leg.narrowest.toFixed(1)}m` +
          (endTo ? `, stands ${endTo}m off ${leg.zone}` : '') +
          (leg.stop ? ` [${leg.stop}]` : '')
      );
    }
    console.info(
      `[tank] ${tank.id}: ${tank.legs.length} legs — ${parts.join(' · ')}\n` +
        `[tank] ${tank.id}: closest any leg comes to a capture circle is ${worst.toFixed(1)} m ` +
        `(leg ${worstLeg}, zone ${worstZone}, r${RULES.captureRadius}, stand-off ${ZONE_STANDOFF})`
    );
  }

  /* ====================================================================== */
  /* THE MODEL                                                              */
  /* ====================================================================== */

  /**
   * A private instance of a library surface, for exactly the reason
   * `Airstrike._makeMaterial` documents: `materials.get()` hands back a SHARED
   * material and this one wants its own tint. The level's own albedo, normal and
   * ORM bakes come through, which is what keeps the hull off the quality bar's
   * "no flat/untextured surfaces".
   */
  _hullMaterial(tank, name, tint, opts = {}) {
    const set = this._lib?.getTextureSet?.(name) ?? null;
    const mat = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: opts.roughness ?? 0.68,
      metalness: opts.metalness ?? 0.35,
      dithering: true,
    });
    mat.name = `tank_${tank.id}_${name}`;
    if (set) {
      mat.map = set.albedo;
      mat.normalMap = set.normal;
      mat.normalScale.set(opts.normalScale ?? 1.0, opts.normalScale ?? 1.0);
      /**
       * `orm` is the LIBRARY's roughness for that surface, and three MULTIPLIES
       * it into `roughness`. For the road wheels that was the whole bug behind
       * "six cream circles a side": the rubber bake's ORM is glossy in the
       * crowns, so a 0.05-albedo tyre picked up a sky reflection and read as
       * pale concrete. `flat: true` is "this surface has no gloss variation" —
       * the scalar stands alone.
       */
      if (!opts.flat) mat.roughnessMap = set.orm;
    }
    this.ctx.peek('render')?.patcher?.patch(mat);
    tank.materials.push(mat);
    return mat;
  }

  /**
   * THE HULL, THE TURRET, THE GUN AND EVERYTHING BOLTED TO THEM.
   *
   * Built out of boxes and cylinders merged per material at boot; none of it is
   * a flat slab: the glacis and the rear plate are sloped plates, the turret is
   * six faceted panels rather than a cube, the track run is thirty-odd
   * individual shoes laid round the road wheels so it has real relief in a
   * grazing light, and the stowage — bins, drums, a tarp roll, spare track links
   * on the nose, a tow cable down each side — is what stops the silhouette
   * reading as a shipping container with a pipe on it.
   *
   * ────────────────────────────────────────────────────────────────────────
   * ELEVEN LISTS, NOT FOUR, AND THE BUG THAT SAYS WHY
   * ────────────────────────────────────────────────────────────────────────
   * The merge key is (MATERIAL × PARENT), never material alone. The parts below
   * are authored in three different frames — hull-local, TURRET-local and
   * GUN-local — and a geometry merged into the wrong parent keeps its numbers
   * and loses its frame.
   *
   * That is not hypothetical. With one `gear` list the gun TUBE, the muzzle
   * brake and the coaxial MG — all authored at gun-local (0, 0, 0.4..4.9) —
   * were merged into the hull's running-gear mesh and therefore drawn at
   * hull-local y = 0: the barrel lay on the road beside the tracks, and the
   * turret was a bare box with no cupola, no dischargers and no aerial, because
   * every one of those had gone the same way. Photographed and fixed.
   *
   * So: `paint`/`gear`/`canvas`/`team` are hull-local, `tPaint`/`tGear`/
   * `tCanvas`/`tTeam` are turret-local, `gPaint`/`gGear` are gun-local, and the
   * road wheels are their own InstancedMesh. Eleven draw calls for a vehicle
   * that is on screen twice a match; a merge that crosses a moving joint is not
   * a saving, it is a different model.
   */
  _buildBody(tank) {
    const rng = tank.rng;
    /* hull-local */
    const paint = [];
    const gear = [];
    const canvas = [];
    const team = [];
    /* turret-local */
    const tPaint = [];
    const tGear = [];
    const tCanvas = [];
    const tTeam = [];
    /* gun-local */
    const gPaint = [];
    const gGear = [];

    const box = (list, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (rx || ry || rz) g.rotateX(rx), g.rotateY(ry), g.rotateZ(rz);
      g.translate(x, y, z);
      list.push(g);
      return g;
    };
    const cyl = (list, r0, r1, h, seg, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const g = new THREE.CylinderGeometry(r0, r1, h, seg);
      if (rx || ry || rz) g.rotateX(rx), g.rotateY(ry), g.rotateZ(rz);
      g.translate(x, y, z);
      list.push(g);
      return g;
    };

    const hw = HULL_W * 0.5; // 1.65
    const trackW = 0.52;
    const trackX = hw - trackW * 0.5; // centre of each track run
    const hullW = HULL_W - trackW * 2 + 0.12; // between the tracks, with sponsons over

    /* ---- lower hull and sponsons -------------------------------------- */
    box(paint, hullW, 0.95, 6.1, 0, 0.92, -0.1);
    box(paint, HULL_W - 0.06, 0.46, 5.5, 0, 1.55, -0.2); // sponsons over the tracks
    /**
     * THE GLACIS, AND THE SIGN THAT WAS WRONG.
     *
     * `rotateX(θ)` sends a point at +Z to `y = -z sinθ`, so a NEGATIVE θ lifts
     * the FRONT of a plate. At -0.62 this plate stood up in front of the turret
     * like a dozer blade — photographed. A glacis slopes the other way: nose
     * low, top edge back at the hull roof. Positive θ, and the two things
     * bolted to it (the spare links and the team plate) carry the same sign.
     *
     * The numbers are the two edges rather than a guess: top edge at the roof
     * line (y 1.78, z 2.05), bottom edge at the nose (y 0.62, z 3.34) — a
     * 1.74 m plate at 0.73 rad from horizontal, which is a 42 degree glacis.
     */
    box(paint, HULL_W - 0.1, 0.2, 1.74, 0, 1.2, 2.7, 0.73);
    box(paint, hullW, 0.2, 1.0, 0, 0.62, 3.3, 0.55);
    // rear plate, sloped the other way, and the engine deck over the back
    box(paint, HULL_W - 0.12, 0.2, 1.5, 0, 1.28, -3.05, -0.5);
    box(paint, HULL_W - 0.24, 0.14, 2.3, 0, 1.79, -1.95);
    // deck louvres — six ribs across the engine deck
    for (let i = 0; i < 6; i++) {
      box(gear, HULL_W - 0.5, 0.09, 0.13, 0, 1.87, -2.75 + i * 0.32);
    }
    // driver's hatch and periscopes
    cyl(paint, 0.29, 0.29, 0.1, 12, -0.62, 1.85, 1.55);
    box(gear, 0.22, 0.09, 0.1, -0.62, 1.92, 1.82);
    box(gear, 0.18, 0.08, 0.09, -0.28, 1.9, 1.86);
    // headlamp cluster and its guard
    cyl(gear, 0.13, 0.13, 0.1, 10, -1.12, 1.62, 3.32, 0, 0, Math.PI / 2);
    box(gear, 0.05, 0.3, 0.05, -1.12, 1.62, 3.38);
    cyl(gear, 0.11, 0.11, 0.09, 10, 1.12, 1.6, 3.3, 0, 0, Math.PI / 2);

    /* ---- running gear: tracks, wheels, sprockets ----------------------- */
    // The track PATH: two straight runs joined by two arcs, laid as shoes.
    const wheelY = 0.62;
    const wheelR = 0.44;
    const sprocketZ = -2.62;
    const idlerZ = 2.62;
    const shoes = 34;
    for (const sx of [-1, 1]) {
      for (let i = 0; i < shoes; i++) {
        const u = i / shoes;
        // parametric loop: bottom run, front arc, top run, rear arc
        let x = 0;
        let y = 0;
        let z = 0;
        if (u < 0.36) {
          const t = u / 0.36;
          z = sprocketZ + (idlerZ - sprocketZ) * t;
          y = wheelY - wheelR;
        } else if (u < 0.5) {
          const a = ((u - 0.36) / 0.14) * Math.PI;
          z = idlerZ + Math.sin(a) * wheelR;
          y = wheelY - Math.cos(a) * wheelR;
        } else if (u < 0.86) {
          const t = (u - 0.5) / 0.36;
          z = idlerZ + (sprocketZ - idlerZ) * t;
          y = wheelY + wheelR + 0.06; // the top run sags over the rollers
        } else {
          const a = ((u - 0.86) / 0.14) * Math.PI;
          z = sprocketZ - Math.sin(a) * wheelR;
          y = wheelY + Math.cos(a) * wheelR;
        }
        x = sx * trackX;
        const tilt = u < 0.36 || (u >= 0.5 && u < 0.86) ? 0 : rng.range(-0.35, 0.35);
        box(gear, trackW, 0.13, 0.42, x, y, z, tilt);
        // the guide horn on the inner edge of every other shoe
        if (i % 2 === 0) box(gear, 0.1, 0.12, 0.16, x - sx * 0.14, y + 0.1, z, tilt);
      }
      // drive sprocket and idler
      cyl(gear, 0.4, 0.4, 0.3, 14, sx * trackX, wheelY, sprocketZ, 0, 0, Math.PI / 2);
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2;
        box(gear, 0.16, 0.12, 0.12, sx * trackX, wheelY + Math.cos(a) * 0.42, sprocketZ + Math.sin(a) * 0.42, 0, 0, -a);
      }
      cyl(gear, 0.36, 0.36, 0.3, 14, sx * trackX, wheelY, idlerZ, 0, 0, Math.PI / 2);
      // return rollers under the top run
      for (let i = 0; i < 3; i++) {
        cyl(gear, 0.13, 0.13, 0.2, 10, sx * trackX, wheelY + 0.44, -1.5 + i * 1.5, 0, 0, Math.PI / 2);
      }
      // side skirt plates, one per bogie, each hanging slightly differently
      for (let i = 0; i < 5; i++) {
        box(paint, 0.07, 0.5, 0.92, sx * (trackX + 0.24), 1.28, -2.0 + i * 1.0, 0, 0, rng.range(-0.05, 0.05));
      }
    }

    /* ---- road wheels, their own instanced mesh so they can turn -------- */
    this._buildWheels(tank, trackX, wheelY, wheelR);

    /* ---- stowage: what makes it look used ------------------------------ */
    // spare track links bolted across the glacis (same slope as the plate)
    for (let i = 0; i < 5; i++) {
      box(gear, 0.42, 0.12, 0.14, -0.9 + i * 0.45, 1.28, 2.78, 0.73, 0, rng.range(-0.03, 0.03));
    }
    // tool bins down the right sponson, fuel drums across the back
    box(paint, 0.34, 0.36, 1.25, hw - 0.16, 1.94, 0.55);
    box(paint, 0.34, 0.3, 0.85, hw - 0.16, 1.9, -0.85);
    cyl(gear, 0.27, 0.27, 0.82, 12, 0.72, 2.06, -3.35, 0, 0, Math.PI / 2);
    cyl(gear, 0.27, 0.27, 0.82, 12, -0.72, 2.06, -3.35, 0, 0, Math.PI / 2);
    // A tarpaulin roll and a folded net on the left sponson. The roll lies
    // FORE-AFT: across the hull it hung 0.55 m outside the tracks at head
    // height, and the narrowest street the route survives is 9.6 m.
    cyl(canvas, 0.21, 0.19, 1.5, 10, -(hw - 0.2), 1.92, 0.9, Math.PI / 2, 0, 0);
    box(canvas, 0.4, 0.26, 0.85, -(hw - 0.22), 1.9, -0.8, 0, rng.range(-0.1, 0.1), 0);
    // tow cable: four short runs down each side, so it drapes
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        box(gear, 0.06, 0.06, 1.15, sx * (hw - 0.05), 1.72 + (i % 2) * 0.05, -1.9 + i * 1.25, 0, 0, 0);
      }
    }
    // towing eyes
    box(gear, 0.16, 0.16, 0.24, -0.85, 0.85, 3.35);
    box(gear, 0.16, 0.16, 0.24, 0.85, 0.85, 3.35);

    /* ---- the turret ---------------------------------------------------- */
    // six faceted panels instead of a box: cheeks, sides, rear bustle, roof
    box(tPaint, 2.24, 0.78, 1.9, 0, 0, -0.1);
    box(tPaint, 1.5, 0.72, 0.95, 0, -0.02, 1.0, 0, 0, 0); // front, narrower
    box(tPaint, 1.05, 0.7, 0.8, 0.62, -0.02, 0.72, 0, -0.5, 0); // right cheek
    box(tPaint, 1.05, 0.7, 0.8, -0.62, -0.02, 0.72, 0, 0.5, 0); // left cheek
    box(tPaint, 2.05, 0.5, 1.05, 0, 0.05, -1.42); // rear bustle
    box(tPaint, 2.1, 0.1, 2.6, 0, 0.4, -0.2); // roof
    // commander's cupola, hatch, and the pintle MG on its ring
    cyl(tPaint, 0.42, 0.42, 0.3, 14, 0.5, 0.56, -0.5);
    cyl(tGear, 0.44, 0.44, 0.07, 14, 0.5, 0.73, -0.5);
    box(tGear, 0.1, 0.1, 0.66, 0.5, 0.86, -0.16);
    box(tGear, 0.13, 0.16, 0.2, 0.5, 0.84, -0.52);
    cyl(tPaint, 0.3, 0.3, 0.26, 12, -0.62, 0.54, -0.55); // loader's hatch
    // vision blocks around the cupola
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      box(tGear, 0.16, 0.1, 0.06, 0.5 + Math.sin(a) * 0.42, 0.6, -0.5 + Math.cos(a) * 0.42, 0, a, 0);
    }
    // smoke dischargers, three a side, splayed
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        cyl(tGear, 0.09, 0.09, 0.32, 8, sx * 0.95, 0.16, 0.35 - i * 0.26, -0.35, sx * 0.25, 0);
      }
    }
    // stowage basket around the bustle: a frame plus a canvas roll in it
    for (let i = 0; i < 5; i++) {
      box(tGear, 0.05, 0.34, 0.05, -0.95 + i * 0.48, 0.44, -1.95);
    }
    box(tGear, 2.0, 0.05, 0.05, 0, 0.6, -1.95);
    box(tCanvas, 1.55, 0.3, 0.42, 0, 0.42, -1.86, rng.range(-0.06, 0.06));
    // antenna bases and one bent whip
    cyl(tGear, 0.07, 0.07, 0.14, 8, -0.9, 0.5, -1.3);
    box(tGear, 0.035, 1.5, 0.035, -0.9, 1.28, -1.3, 0.12, 0, 0.07);
    // spare links on the turret side, the classic bit of extra armour
    for (let i = 0; i < 4; i++) {
      box(tGear, 0.1, 0.13, 0.4, -1.12, 0.12, 0.55 - i * 0.42);
    }

    /* ---- team markings ------------------------------------------------- */
    // A band round the bustle and a plate on each cheek, in the side's own HUD
    // colour: at 60 m in a shadowed street the silhouette is identical, so the
    // only thing that says whose tank it is has to be paint.
    box(tTeam, 2.12, 0.16, 0.06, 0, 0.12, -1.97);
    box(tTeam, 0.06, 0.34, 0.5, 1.13, 0.06, -0.3);
    box(tTeam, 0.06, 0.34, 0.5, -1.13, 0.06, -0.3);
    box(team, 0.5, 0.06, 0.34, 0, 1.02, 3.02, 0.73);

    /* ---- the gun ------------------------------------------------------- */
    // mantlet, barrel with a thermal sleeve over the breech end, muzzle brake
    box(gPaint, 1.15, 0.66, 0.5, 0, 0, 0.1);
    cyl(gPaint, 0.24, 0.2, 0.36, 14, 0, 0, 0.42, Math.PI / 2);
    cyl(gPaint, 0.155, 0.145, 2.1, 14, 0, 0, 1.55, Math.PI / 2); // sleeve
    cyl(gGear, 0.105, 0.098, 4.4, 14, 0, 0, 2.6, Math.PI / 2); // tube
    cyl(gGear, 0.17, 0.17, 0.5, 12, 0, 0, 4.6, Math.PI / 2); // muzzle brake
    box(gGear, 0.42, 0.1, 0.16, 0, 0, 4.55); // brake ports
    box(gGear, 0.42, 0.1, 0.16, 0, 0, 4.72);
    // coaxial machine gun beside the mantlet
    cyl(gGear, 0.055, 0.05, 1.1, 8, 0.42, -0.12, 0.95, Math.PI / 2);

    /* ---- merge, one mesh per material ---------------------------------- */
    const tint = tank.team === 0 ? 0x6b6450 : 0x4a5652;
    const mPaint = this._hullMaterial(tank, 'metal_painted', tint, { roughness: 0.72, metalness: 0.3 });
    const mGear = this._hullMaterial(tank, 'metal_rust', 0x55514a, { roughness: 0.9, metalness: 0.55, normalScale: 1.2 });
    const mCanvas = this._hullMaterial(tank, 'burlap', 0x6d6552, { roughness: 0.95, metalness: 0 });
    const mTeam = this._hullMaterial(tank, 'metal_painted', new THREE.Color(TEAM_COLOR[tank.team]).multiplyScalar(0.72).getHex(), {
      roughness: 0.6,
      metalness: 0.2,
    });

    const add = (parent, list, mat, name) => {
      if (!list.length) return;
      const mesh = new THREE.Mesh(mergeGeometries(list), mat);
      mesh.name = `match_tank_${tank.id}_${name}`;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.updateMatrix();
      parent.add(mesh);
      tank.meshes.push(mesh);
    };
    add(tank.root, paint, mPaint, 'hull');
    add(tank.root, gear, mGear, 'gear');
    add(tank.root, canvas, mCanvas, 'canvas');
    add(tank.root, team, mTeam, 'markings');
    add(tank.turret, tPaint, mPaint, 'turret');
    add(tank.turret, tGear, mGear, 'turret_gear');
    add(tank.turret, tCanvas, mCanvas, 'turret_canvas');
    add(tank.turret, tTeam, mTeam, 'turret_markings');
    add(tank.gun, gPaint, mPaint, 'gun');
    add(tank.gun, gGear, mGear, 'gun_barrel');
    tank.gearMat = mGear;
  }

  /**
   * The road wheels. Their own InstancedMesh because they TURN — twelve matrix
   * composes a frame off one preallocated quaternion, which is what a tracked
   * vehicle that is obviously moving costs.
   */
  _buildWheels(tank, trackX, wheelY, wheelR) {
    const rim = new THREE.CylinderGeometry(wheelR, wheelR, 0.3, 16);
    rim.rotateZ(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(0.17, 0.17, 0.34, 10);
    hub.rotateZ(Math.PI / 2);
    // Six lightening holes, so a wheel is not a disc.
    const holes = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const g = new THREE.BoxGeometry(0.33, 0.15, 0.15);
      g.translate(0, Math.cos(a) * 0.28, Math.sin(a) * 0.28);
      holes.push(g);
    }
    const geo = mergeGeometries([rim, hub, ...holes]);
    /**
     * A ROAD WHEEL IS THE DARKEST THING ON THE VEHICLE. `getTextureSet` hands
     * back the RAW bake — none of the library's `mat` tint/weather params are
     * applied, they belong to `materials.get()` — and the rubber bake alone
     * renders as a pale disc in direct sun, which is what six cream circles a
     * side looked like. 0x17_1614 against that map lands at roughly 0.05
     * albedo, which is what rubber is.
     */
    const mat = this._hullMaterial(tank, 'rubber', 0x171614, { roughness: 1.0, metalness: 0.0, flat: true });
    const n = 12;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.name = `match_tank_${tank.id}_wheels`;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.updateMatrix();
    tank.root.add(mesh);
    tank.wheels = mesh;
    tank.wheelPos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const sx = i < 6 ? -1 : 1;
      const k = i % 6;
      tank.wheelPos[i * 3] = sx * trackX;
      tank.wheelPos[i * 3 + 1] = wheelY;
      tank.wheelPos[i * 3 + 2] = -2.05 + k * 0.82;
    }
    this._poseWheels(tank);
    tank.meshes.push(mesh);
  }

  _poseWheels(tank) {
    const m = this._m;
    const q = this._q;
    const v = this._v;
    q.setFromAxisAngle(RIGHT, tank.wheelSpin);
    for (let i = 0; i < 12; i++) {
      v.set(tank.wheelPos[i * 3], tank.wheelPos[i * 3 + 1], tank.wheelPos[i * 3 + 2]);
      m.compose(v, q, this._sc);
      m.toArray(tank.wheels.instanceMatrix.array, i * 16);
    }
    tank.wheels.instanceMatrix.needsUpdate = true;
  }

  /* ====================================================================== */
  /* THE WRECK, BAKED AT BOOT                                               */
  /* ====================================================================== */

  /**
   * What comes off when it brews up, cut and solved at boot exactly the way
   * `airstrike.js` cuts a building — and PARENTED TO THE HULL, so the fracture
   * lives in the tank's own frame and stays correct wherever on the route it
   * dies. The death frame writes one uniform.
   */
  _buildWreck(tank) {
    const rng = tank.rng.fork();
    const parts = [
      // the turret, which is the thing that comes off a tank
      { id: 'turret', size: [2.3, 0.85, 2.7], at: [0, 1.95, -0.25], cut: [5, 3, 6] },
      { id: 'bustle', size: [2.1, 0.55, 1.1], at: [0, 2.0, -1.6], cut: [4, 2, 3] },
      // engine deck and the plates over it
      { id: 'deck', size: [2.9, 0.3, 2.4], at: [0, 1.78, -1.95], cut: [5, 1, 5] },
      // the sponson tops and the skirts
      { id: 'sponsonL', size: [0.55, 0.4, 5.2], at: [-1.3, 1.55, -0.2], cut: [1, 1, 8] },
      { id: 'sponsonR', size: [0.55, 0.4, 5.2], at: [1.3, 1.55, -0.2], cut: [1, 1, 8] },
      // a run of track off each side
      { id: 'trackL', size: [0.5, 0.2, 5.0], at: [-1.4, 0.25, 0], cut: [1, 1, 10] },
      { id: 'trackR', size: [0.5, 0.2, 5.0], at: [1.4, 0.25, 0], cut: [1, 1, 10] },
      // stowage and the drums
      { id: 'stow', size: [1.9, 0.5, 0.6], at: [0, 2.05, -3.3], cut: [4, 1, 1] },
    ];
    const chunks = [];
    for (const p of parts) fracture(p, 0, rng, (c) => chunks.push(c));
    const n = chunks.length;
    tank.chunkCount = n;

    const geo = chunkGeometry();
    const mat = makeChunkMaterial(this.ctx, this._lib, 'metal_rust', tank.uniforms);
    mat.color.setHex(0x4a453e);
    tank.materials.push(mat);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.name = `match_tank_${tank.id}_wreck`;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.updateMatrix();
    tank.root.add(mesh);

    const mot = new Float32Array(n * 4);
    const off = new Float32Array(n * 3);
    const axis = new Float32Array(n * 3);
    const uv = new Float32Array(n * 3);
    const colour = new Float32Array(n * 3);
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const m4 = new THREE.Matrix4();
    const ax = new THREE.Vector3();
    const settle = new THREE.Vector3();
    const dir = new THREE.Vector3();
    // The blast is in the fighting compartment, under the turret ring.
    const blast = new THREE.Vector3(0, 1.6, -0.2);

    for (let i = 0; i < n; i++) {
      const c = chunks[i];
      pos.set(c.cx, c.cy, c.cz);
      q.setFromAxisAngle(ax.set(rng.signed(), rng.signed(), rng.signed()).normalize(), rng.range(-0.03, 0.03));
      scale.set(c.hx * 2, c.hy * 2, c.hz * 2);
      m4.compose(pos, q, scale);
      m4.toArray(mesh.instanceMatrix.array, i * 16);

      dir.copy(pos).sub(blast);
      const d = Math.max(0.5, dir.length());
      dir.y = 0;
      if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
      dir.normalize();
      const r = WRECK_R * Math.sqrt(rng.float()) * (pos.y > 1.7 ? 1.0 : 0.45);
      settle.copy(dir).multiplyScalar(r);
      settle.y = Math.max(c.hy, 0.12) + rng.range(0, 0.25);

      const delay = Math.min(0.3, (d - 0.5) * 0.05) + rng.range(0, 0.06);
      const drop = Math.max(0.4, pos.y - settle.y);
      const flight = clamp(Math.sqrt((2 * drop) / 9.81) * rng.range(1.1, 1.7), 0.5, 2.4);
      // The turret goes UP. That is the shot everybody knows.
      const arc = (pos.y > 1.7 ? rng.range(1.6, 3.4) : rng.range(0.2, 1.0)) * clamp(3.0 / d, 0.4, 2.2);
      const spin = rng.range(2.0, 9.0) * (rng.float() < 0.5 ? -1 : 1);
      mot[i * 4] = delay;
      mot[i * 4 + 1] = flight;
      mot[i * 4 + 2] = arc;
      mot[i * 4 + 3] = spin;
      off[i * 3] = settle.x - pos.x;
      off[i * 3 + 1] = settle.y - pos.y;
      off[i * 3 + 2] = settle.z - pos.z;
      ax.set(rng.signed(), rng.signed() * 0.5, rng.signed()).normalize();
      axis[i * 3] = ax.x;
      axis[i * 3 + 1] = ax.y;
      axis[i * 3 + 2] = ax.z;
      uv[i * 3] = rng.float();
      uv[i * 3 + 1] = rng.float();
      uv[i * 3 + 2] = rng.range(0.6, 1.4);
      const k = rng.range(0.55, 1.0);
      colour[i * 3] = 0.34 * k;
      colour[i * 3 + 1] = 0.32 * k;
      colour[i * 3 + 2] = 0.3 * k;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colour, 3);
    mesh.instanceColor.needsUpdate = true;
    geo.setAttribute('aMot', new THREE.InstancedBufferAttribute(mot, 4));
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
    geo.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 3));
    geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 3));
    tank.wreck = mesh;
    tank.meshes.push(mesh);
  }

  /**
   * Three moving boxes on `LAYER.SHOOT_ONLY`. See the header: that layer is in
   * `MASK.BULLET` and in neither `MASK.CHARACTER` nor `MASK.SIGHT`, which is
   * what makes a moving 3.3 m obstacle safe on a nav grid baked at boot.
   *
   * `owner` is the tank, so a round that lands on it comes back through the
   * canonical `damage:dealt` path with the shooter attached — which is where
   * kill credit, the friend/foe hitmarker filter and the score come from.
   */
  _buildColliders(tank, physics) {
    const mk = (part, hx, hy, hz, scale) =>
      physics.addCollider({
        shape: 'box',
        layer: physics.LAYER.SHOOT_ONLY,
        surface: 'metal',
        owner: tank,
        part,
        damageScale: scale,
        enabled: false,
        hx,
        hy,
        hz,
      });
    tank.colliders.push(
      { c: mk('hull', HULL_W * 0.5, 0.9, 3.3, PART_MUL.hull), at: [0, 1.25, 0.1], turret: false },
      { c: mk('deck', 1.45, 0.4, 1.3, PART_MUL.deck), at: [0, 1.85, -2.0], turret: false },
      { c: mk('turret', 1.2, 0.55, 1.7, PART_MUL.turret), at: [0, 2.0, -0.3], turret: true }
    );
  }

  /* ====================================================================== */
  /* THE SORTIE                                                             */
  /* ====================================================================== */

  /** The telegraphed launch. */
  call() {
    if (!this.ready || this.busy) return false;
    this._pending = TANK_LEAD;
    const first = this.tanks[0];
    this._announce(this.onAnnounce, first);
    if (this._audio ?? (this._audio = this.ctx.peek('audio'))) {
      for (const t of this.tanks) {
        this._v.copy(t.position.set(t.legs[0].X[0], t.legs[0].Y[0] + 1.2, t.legs[0].Z[0]));
        this._audio.play?.('strike_jet', this._v, {
          level: 0.5, dur: TANK_LEAD, maxDist: 200, gain: 1.5, occlusion: 0.4,
        });
      }
    }
    this._emit('inbound', this.tanks[0]);
    return true;
  }

  /** Roll now, no telegraph. Every tank that is not already out. */
  fire() {
    if (!this.ready) return false;
    let any = false;
    for (const t of this.tanks) any = this._roll(t) || any;
    if (any) console.info(`[tank] SORTIE at t=${this.ctx.time.elapsed.toFixed(1)}s — ${this.tanks.map((t) => t.id).join(' + ')}`);
    return any;
  }

  _roll(tank) {
    if (tank.state !== 'parked') return false;
    tank.state = 'advance';
    tank.s = 0;
    tank.legIx = 0;
    tank.legDir = 1;
    tank.planN = 0;
    tank.planI = 0;
    tank.targetZone = null;
    tank.retarget = 0;
    tank.yaw = tank.legs[0].YAW[0];
    tank.health = RULES.tankHealth;
    tank.alive = true;
    tank.hold = HOLD_TIME;
    tank.target = null;
    tank.acquireIn = 0;
    tank.reload = 2.5;
    tank.coax = 0;
    tank.coaxLeft = 0;
    tank.turretYaw = 0;
    tank.gunPitch = 0;
    tank.lastHitBy = null;
    tank.ploughDrag = 0;
    const st = tank.stats;
    st.sorties++;
    st.rounds = 0; st.roundDmg = 0;
    st.hull = 0; st.turret = 0; st.deck = 0;
    st.nHull = 0; st.nTurret = 0; st.nDeck = 0; st.dupes = 0;
    st.blasts = 0; st.blastDmg = 0;
    st.frags = 0; st.fragDmg = 0;
    st.liveT = 0; st.razed = 0; st.breaches = 0; st.legs = 0;
    tank.lastHitAt = -1e9;
    tank.firedAt = -1e9;
    tank.breachIn = 0;
    tank._woundFrame = -1;
    tank._woundSource = null;
    tank.root.visible = true;
    tank.wreck.visible = false;
    tank.uniforms.uT.value = -1;
    tank.uniforms.uAnim.value = 1;
    for (const c of tank.colliders) c.c.enabled = true;
    this._pose(tank);
    this._emit('rolling', tank);
    return true;
  }

  /* ====================================================================== */
  /* frame                                                                  */
  /* ====================================================================== */

  update(dt, live) {
    if (!this.ready) return;

    if (this._pending >= 0) {
      this._pending -= dt;
      if (this._pending < 0) this.fire();
    }

    for (const tank of this.tanks) {
      if (tank.state === 'parked') continue;
      if (tank.state === 'dead') {
        tank.uniforms.uT.value += dt;
        if (tank.uniforms.uT.value > 30) {
          // The wreck stays; the clock stops so the shader's clamp is settled.
          tank.uniforms.uT.value = 30;
        }
        continue;
      }
      tank.stats.liveT += dt;
      this._drive(tank, dt);
      this._fight(tank, dt);
      this._pose(tank);
    }

    /**
     * The plough debris runs its own clock, because a pile keeps falling after
     * the hull has driven past it and after the hull has been knocked out.
     */
    for (const tank of this.tanks) {
      const list = tank.plough;
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const u = list[i].uniforms;
        if (list[i].fired && u && u.uT.value >= 0 && u.uT.value < 30) {
          u.uT.value = Math.min(30, u.uT.value + dt);
        }
      }
    }

    if (!live || !this.enabled) return;
    this._liveT += dt;
    this._next -= dt;
    if (this._next > 0) return;
    this._scheduleNext();
  }

  _scheduleNext() {
    // `_ignoreCoBusy` is the cathedral's own sortie coming in through the dust.
    // @see `armAfter`.
    if (this.busy || (this._coBusy && !this._ignoreCoBusy)) {
      this._next = 6;
      return;
    }
    if (this._sorties >= RULES.tankMaxPerMatch) {
      this._next = Infinity;
      return;
    }
    // A tank that is still a wreck in the street does not get a twin; the
    // sortie is only re-run once both hulls are back in their pockets.
    for (const t of this.tanks) if (t.state !== 'parked') return;
    this.call();
    this._sorties++;
    // Spent: every sortie after the first is the ordinary interval draw and
    // stands down for the sky like the other three air weapons.
    this._ignoreCoBusy = false;
    const [lo, hi] = RULES.tankInterval;
    this._next = this.rng.range(lo, hi);
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * 「戦車はできるだけ占領サれたエリアに向かい、そこが占領し返すまで戦闘する」
   * WHERE IT SHOULD BE, ASKED TWICE A SECOND
   * ────────────────────────────────────────────────────────────────────────
   * The point the ENEMY holds, nearest first; failing that a NEUTRAL one,
   * because a point nobody holds is ground the fight is still over. A point
   * this hull's own side holds is not a destination — that is the
   * 「占領し返すまで」 half, and it is the whole reason the hull leaves a
   * station: it stays until the zone's `owner` becomes its own team and then
   * goes to the next one.
   *
   * `match` owns `allZones` and this file reads it, exactly as `_logZones`
   * always has. A `locked` zone (D before the cathedral comes down) is not a
   * destination and has no spoke anyway — the hub is the stand-off on D.
   */
  _wantZone(tank) {
    const m = this.ctx.peek('match');
    const zones = m?.allZones;
    if (!zones?.length) return null;
    let best = null;
    let bestRank = 9;
    let bestLen = Infinity;
    for (let i = 1; i < tank.legs.length; i++) {
      const leg = tank.legs[i];
      const z = zones.find((q) => q.id === leg.zone);
      if (!z || z.locked) continue;
      if (z.owner === tank.team) continue;
      // 0 = the enemy holds it, 1 = nobody does.
      const rank = z.owner === -1 ? 1 : 0;
      if (rank > bestRank) continue;
      if (rank === bestRank && leg.length >= bestLen) continue;
      bestRank = rank;
      bestLen = leg.length;
      best = leg.zone;
    }
    return best;
  }

  /**
   * LAY IN A COURSE. At most three legs: finish the approach if we are still on
   * it, come back down the spoke we are on, then go out the new one. A spoke is
   * driven in reverse by driving it FORWARDS with the hull turned round — the
   * pivot in `_drive` does the turn — because a tank reversing sixty metres
   * down a street is not what "move to the next point" looks like.
   */
  _setCourse(tank, zoneId) {
    const want = tank.legs.findIndex((l, i) => i > 0 && l.zone === zoneId);
    if (want < 0) return false;
    /**
     * ALREADY ON THIS SPOKE. Driving it OUT is nothing to do. Driving it BACK
     * to the hub is a hull that has just been told to turn round again — the
     * point it was leaving has been taken off its side while it was leaving —
     * and the plan it would otherwise lay is "finish the retreat, then come all
     * the way out again", which is up to 130 m of street for no reason and
     * reads exactly like a tank that cannot make up its mind. It turns round
     * where it stands instead.
     */
    if (tank.legIx === want) {
      if (tank.legDir > 0) return false;
      tank.planN = 0;
      tank.planI = 0;
      tank.plan[tank.planN].leg = want;
      tank.plan[tank.planN++].dir = 1;
      tank.targetZone = zoneId;
      this._startPlanStep(tank, true);
      return true;
    }
    tank.planN = 0;
    tank.planI = 0;
    if (tank.legIx === 0) {
      // still on the approach: run it out first, from wherever we are.
      if (tank.s < tank.legs[0].length - 0.05 || tank.state === 'advance') {
        tank.plan[tank.planN].leg = 0;
        tank.plan[tank.planN++].dir = 1;
      }
    } else {
      tank.plan[tank.planN].leg = tank.legIx;
      tank.plan[tank.planN++].dir = -1;
    }
    tank.plan[tank.planN].leg = want;
    tank.plan[tank.planN++].dir = 1;
    tank.targetZone = zoneId;
    this._startPlanStep(tank, true);
    return true;
  }

  /** Begin the plan's current step. `keepS` keeps the arc we are already at. */
  _startPlanStep(tank, keepS) {
    const step = tank.plan[tank.planI];
    const same = step.leg === tank.legIx;
    tank.legIx = step.leg;
    tank.legDir = step.dir;
    const leg = tank.legs[tank.legIx];
    if (!(keepS && same)) tank.s = step.dir > 0 ? 0 : leg.length;
    tank.state = 'advance';
  }

  /** Advance along the leg the course is on. No raycast, no allocation. */
  _drive(tank, dt) {
    /**
     * WHERE IT SHOULD BE, ASKED TWICE A SECOND — AND WHILE IT IS STILL DRIVING.
     * This used to sit in the `hold` branch, with a copy of it in a second
     * `else if (tank.state === 'advance')` that could NEVER RUN: the chain
     * already opened with `if (tank.state === 'advance')`, so the duplicate was
     * dead from the day it was written and a point taken back under a hull that
     * was still driving at it did not re-lay the course until the hull had
     * arrived and stood there. It is asked once, here, before the leg is read,
     * because `_setCourse` may change which leg that is.
     */
    if (tank.state === 'advance' || tank.state === 'hold') {
      tank.retarget -= dt;
      if (tank.retarget <= 0) {
        tank.retarget = RETARGET_EVERY;
        const want = this._wantZone(tank);
        if (want && want !== tank.targetZone) this._setCourse(tank, want);
        else if (!want && tank.state === 'hold') tank.targetZone = null;
      }
    }
    const p = tank.legs[tank.legIx];
    /**
     * THE NOSE CHASES A POINT DOWN THE LEG, NOT THE GROUND UNDER ITS TRACKS.
     * @see the long note on `PIVOT_RATE` for what it chased before and for the
     * seconds-at-a-dead-stop that measured it. Over `PIVOT_HOLD` off the
     * heading it wants — the 180 degrees a spoke driven back to the hub asks
     * for — the hull still turns on the spot instead of driving, which is the
     * only way a wheel of routes reads as one vehicle rather than as a sprite
     * being slid along a new line. A CORNER IS NOT THAT, and no longer costs
     * the throttle everything.
     */
    const wantYaw = this._aimYaw(tank, p);
    const dy = wrapPi(wantYaw - tank.yaw);
    tank.yaw = wrapPi(tank.yaw + clamp(dy, -PIVOT_RATE * dt, PIVOT_RATE * dt));
    const off = Math.abs(dy);
    const pivoting = off > PIVOT_HOLD;
    const ease = pivoting
      ? 0
      : 1 - (1 - TURN_MIN) * clamp((off - TURN_EASE) / (PIVOT_HOLD - TURN_EASE), 0, 1);

    if (tank.state === 'advance') {
      let speed = (tank.target ? SPEED_FIGHT : SPEED_ADVANCE) * ease;
      /**
       * SHOVING A WALL COSTS MOMENTUM. Without this the hull crosses a pile at
       * exactly the speed it crosses open road and the destruction reads as
       * scenery going off beside it rather than as something it did.
       */
      if (tank.ploughDrag > 0) {
        tank.ploughDrag -= dt;
        speed *= PLOUGH_SLOW;
      }
      tank.s += speed * dt * tank.legDir;
      this._checkPlough(tank);
      /**
       * ────────────────────────────────────────────────────────────────────
       * 「家なども砲撃で破壊して」 — AND THE GLACIS GETS THE HOUSES THE SHELLS MISS
       * ────────────────────────────────────────────────────────────────────
       * `world.damageAt` is the cache houses' own breach entry point and the
       * shell already fires it (@see `_mainGun`) — but a shell goes where a
       * TARGET is, and the baseline measured a whole match with six breachable
       * walls on the map and not one opened. The hull itself passes within
       * `reach` (3.4 m) of one of those walls on its own routes, so the nose
       * now knocks: a breachable elevation inside the glacis's sweep comes
       * open ON CONTACT, exactly as a 40 t vehicle scraping a house front
       * should read. Four times a second while moving, and `damageAt` is six
       * clamped distance tests that answer null on almost all of them —
       * nothing is searched for and nothing allocated.
       */
      tank.breachIn -= dt;
      if (tank.breachIn <= 0) {
        tank.breachIn = 0.25;
        const world = this._world ?? (this._world = this.ctx.peek('world'));
        if (world?.damageAt) {
          const nose = this._v;
          nose.set(
            tank.position.x + Math.sin(tank.yaw) * PLOUGH_NOSE,
            tank.position.y + 1.0,
            tank.position.z + Math.cos(tank.yaw) * PLOUGH_NOSE
          );
          const breach = world.damageAt(nose, 1);
          if (breach) {
            tank.stats.breaches++;
            tank.ploughDrag = PLOUGH_DRAG;
            const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
            if (fx && breach.position) {
              fx.dust?.(breach.position.x, breach.position.y + 1.0, breach.position.z, 2.6);
              fx.hazeRing?.(breach.position.x, breach.position.y + 0.6, breach.position.z, 2.4, 14, 0.45, 1.6);
            }
            const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
            audio?.play?.('strike_rubble', breach.position ?? tank.position, {
              level: 0.8, dur: 2.0, maxDist: 200, gain: 1.4, occlusion: 0.3,
            });
            console.info(
              `[tank] ${tank.name} BREACHED ${breach.name ?? breach.id} BY CONTACT at ` +
                `${nose.x.toFixed(1)}, ${nose.z.toFixed(1)}`
            );
          }
        }
      }
      tank.wheelSpin -= (speed * dt) / 0.44;
      const done = tank.legDir > 0 ? tank.s >= p.length : tank.s <= 0;
      if (done) {
        tank.s = tank.legDir > 0 ? p.length : 0;
        tank.stats.legs++;
        if (tank.planI + 1 < tank.planN) {
          tank.planI++;
          this._startPlanStep(tank, false);
        } else {
          tank.planN = 0;
          tank.state = 'hold';
        }
      }
    } else if (tank.state === 'hold') {
      /**
       * ──────────────────────────────────────────────────────────────────────
       * 「戦車は登場したら帰さないで 試合終了まで滞在させること」
       * IT ARRIVES AND IT DOES NOT LEAVE
       * ──────────────────────────────────────────────────────────────────────
       * THIS IS WHY NOBODY HAD SEEN ONE, AND IT WAS MEASURED RATHER THAN
       * ASSUMED. `_tanklife.mjs` over three matches, with the sortie fired by
       * hand so it certainly happened:
       *
       *     seed 7    RED rolling@28.4  clear@93.5   BLUE rolling@28.4 clear@101
       *     seed 12   RED rolling@29.7  DEAD@62.3    BLUE rolling@29.7 clear@100
       *     seed 106  RED rolling@29.9  DEAD@50.1    BLUE rolling@29.9 clear@102
       *
       * Every hull that was not killed REVERSED OUT AND VANISHED about seventy
       * seconds after it rolled, and `_park` hides the mesh and disables the
       * colliders — so a player who happened to be on the far flank for that
       * window had no way of ever knowing a tank had been on the map. Four of
       * six hulls took 0 rounds and dealt 0 kills across 333 seconds: the
       * armour was driving an empty street and then tidying itself away.
       *
       * So `hold` is now terminal. The ONLY exits from a live hull are
       * `_destroy` and the round reset — there is no withdrawal, no despawn and
       * no lifetime. `tank.hold` is left counting for anything that reads it,
       * but nothing acts on it.
       *
       * IT STILL CANNOT BLOCK A CAPTURE POINT, which is the guarantee that had
       * to survive this change: the hull is three `LAYER.SHOOT_ONLY` boxes, so
       * A* never sees it however long it sits there, and the route ends 24 m
       * off D (printed at boot). A permanent wreck is in neither a lane nor a
       * circle. @see the header.
       */
      tank.hold -= dt;
      /**
       * …AND `hold` IS STILL TERMINAL IN THE ONLY SENSE THAT MATTERED. There is
       * no withdrawal, no despawn and no lifetime: the hull leaves a station
       * only to stand on ANOTHER one, and the exits from a live tank are still
       * `_destroy` and the round reset. What changed is that standing still is
       * no longer the end of the sortie.
       */
    }
  }

  /** The sample whose baked yaw the hull should be chasing. */
  _yawIndex(tank, p) {
    const s = clamp(tank.s, 0, p.length);
    let i = Math.min(p.n - 1, Math.max(0, Math.round((s / Math.max(1e-4, p.length)) * (p.n - 1))));
    if (i < 0) i = 0;
    return i;
  }

  /**
   * PURE PURSUIT: the bearing from where the hull IS to a point `LOOK_AHEAD`
   * down the leg in the sense it is driving. No allocation and no raycast —
   * two baked samples and an `atan2`.
   *
   * The sense is carried by `legDir` in the ARC rather than by a half turn on
   * the answer: a hull driving a spoke back to the hub is looking at a point
   * behind it in arc length, and the bearing to that point IS the way it wants
   * to be facing. `atan2(dx, dz)` is the same convention `_bakePath` bakes
   * `YAW` in.
   *
   * Within a metre of the aim point the bearing is noise, which is the last
   * stride of a leg and the frame the hull arrives — the baked yaw is the right
   * answer there and is what it falls back to.
   */
  _aimYaw(tank, p) {
    const q = clamp(tank.s + LOOK_AHEAD * tank.legDir, 0, p.length);
    let i = Math.min(p.n - 1, Math.max(0, Math.round((q / Math.max(1e-4, p.length)) * (p.n - 1))));
    while (i > 0 && p.S[i] > q) i--;
    while (i < p.n - 1 && p.S[i + 1] < q) i++;
    const j = Math.min(p.n - 1, i + 1);
    const span = Math.max(1e-4, p.S[j] - p.S[i]);
    const t = clamp((q - p.S[i]) / span, 0, 1);
    const dx = p.X[i] + (p.X[j] - p.X[i]) * t - tank.position.x;
    const dz = p.Z[i] + (p.Z[j] - p.Z[i]) * t - tank.position.z;
    if (dx * dx + dz * dz < 1) {
      return wrapPi(p.YAW[this._yawIndex(tank, p)] + (tank.legDir < 0 ? Math.PI : 0));
    }
    return Math.atan2(dx, dz);
  }

  /** Has the glacis reached a pile this sortie has not already flattened? */
  _checkPlough(tank) {
    const list = tank.plough;
    if (!list || !list.length) return;
    // The glacis leads whichever way the hull is pointing.
    const reach = tank.s + PLOUGH_NOSE * tank.legDir;
    for (let i = 0; i < list.length; i++) {
      const pile = list[i];
      if (pile.fired || pile.leg !== tank.legIx) continue;
      if (tank.legDir > 0 ? reach >= pile.s : reach <= pile.s) this._firePlough(tank, pile);
    }
  }

  _park(tank) {
    tank.state = 'parked';
    tank.alive = false;
    tank.root.visible = false;
    for (const c of tank.colliders) c.c.enabled = false;
    this._emit('clear', tank);
  }

  /**
   * THE RIDE HEIGHT AT AN ARC POSITION, which is the road plus whatever is
   * standing on it that the plough has not taken away. @see `_bakeRide`.
   */
  _rideAt(tank, p, s) {
    const q = clamp(s, 0, p.length);
    let i = Math.min(p.n - 1, Math.max(0, Math.round((q / Math.max(1e-4, p.length)) * (p.n - 1))));
    while (i > 0 && p.S[i] > q) i--;
    while (i < p.n - 1 && p.S[i + 1] < q) i++;
    let y = -Infinity;
    for (let k = i; k <= Math.min(p.n - 1, i + 1); k++) {
      const pile = p.PILE[k];
      const gone = pile >= 0 && tank.plough && tank.plough[pile]?.fired;
      const step = gone ? 0 : p.STEP[k]; // already clamped in `_bakeRide`
      const v = p.ROAD[k] + step;
      if (v > y) y = v;
    }
    return y;
  }

  /**
   * A TRACKED VEHICLE RESTS ON THE HIGHEST THING UNDER ITS TRACK RUN, not on
   * the ground under its centre — which is what makes a step read as a CLIMB
   * instead of the whole hull popping up 0.8 m over one 1.25 m sample with its
   * pitch clamped at 9 degrees. Two support points, `SUPPORT` fore and aft; the
   * body sits between them and the pitch is the line through them, so the nose
   * lifts first, the hull levels on top and the tail settles last.
   *
   * Costs no raycast: both supports are a max over a handful of baked samples.
   */
  _sample(tank) {
    const p = tank.legs[tank.legIx];
    const s = clamp(tank.s, 0, p.length);
    let i = Math.min(p.n - 2, Math.max(0, Math.floor((s / Math.max(1e-4, p.length)) * (p.n - 1))));
    while (i > 0 && p.S[i] > s) i--;
    while (i < p.n - 2 && p.S[i + 1] < s) i++;
    const span = Math.max(1e-4, p.S[i + 1] - p.S[i]);
    const t = clamp((s - p.S[i]) / span, 0, 1);
    const out = this._v3;

    // The two supports, in the hull's own travelling sense.
    const dir = tank.legDir;
    let front = -Infinity;
    let rear = -Infinity;
    const N = 4;
    for (let k = 0; k <= N; k++) {
      const u = (k / N) * SUPPORT;
      const f = this._rideAt(tank, p, s + u * dir);
      const r = this._rideAt(tank, p, s - u * dir);
      if (f > front) front = f;
      if (r > rear) rear = r;
    }
    out.set(
      p.X[i] + (p.X[i + 1] - p.X[i]) * t,
      (front + rear) * 0.5,
      p.Z[i] + (p.Z[i + 1] - p.Z[i]) * t
    );
    // yaw is not lerped through the wrap; the samples are 1.25 m apart and the
    // route is nearly straight, so the nearest one is the right answer.
    tank._yaw = p.YAW[t < 0.5 ? i : i + 1];
    tank._pitch = clamp(Math.atan2(front - rear, SUPPORT * 2), -CLIMB_PITCH, CLIMB_PITCH);
    return out;
  }

  /** Write the hull, turret, gun, wheels and colliders for this frame. */
  _pose(tank) {
    const at = this._sample(tank);
    tank.position.copy(at);
    // A tank reversing still faces the way it drove in; that is the whole point
    // of reversing out of a street.
    const q = this._q;
    // `tank.yaw` and not `tank._yaw`: the hull's own heading lags the leg's and
    // swings on the spot through a hairpin. @see `_drive`.
    q.setFromAxisAngle(UP, tank.yaw);
    this._qp.setFromAxisAngle(RIGHT, -tank._pitch);
    q.multiply(this._qp);
    tank.root.position.copy(at);
    tank.root.quaternion.copy(q);
    tank.root.updateMatrix();
    tank.root.updateMatrixWorld(true);

    tank.turret.quaternion.setFromAxisAngle(UP, tank.turretYaw);
    tank.turret.updateMatrix();
    tank.gun.quaternion.setFromAxisAngle(RIGHT, -tank.gunPitch);
    tank.gun.updateMatrix();
    tank.turret.updateMatrixWorld(true);

    /**
     * WHERE THE INFANTRY SHOULD BE AIMING, in world space, off the matrix that
     * was just written. `set` then `applyMatrix4` on a vector the tank has
     * owned since boot — no allocation, no second matrix, and it is done here
     * rather than in `ai` because `ai` may not know a hull's local frame.
     * @see the `aimPoint` note in `_buildTank`.
     */
    tank.aimPoint.set(DECK_AIM[0], DECK_AIM[1], DECK_AIM[2]).applyMatrix4(tank.root.matrixWorld);

    if (tank.state !== 'dead') this._poseWheels(tank);

    // Colliders follow. Three `Matrix4.copy` + an invert each, once a frame.
    for (const c of tank.colliders) {
      const parent = c.turret ? tank.turret : tank.root;
      this._v.set(c.at[0], c.at[1] - (c.turret ? 1.52 : 0), c.at[2] + (c.turret ? 0.15 : 0));
      this._m.compose(this._v, ZERO_Q, this._sc);
      this._m.premultiply(parent.matrixWorld);
      c.c.setMatrix(this._m);
    }
  }

  /* -------------------------------------------------------------- combat -- */

  _fight(tank, dt) {
    tank.acquireIn -= dt;
    if (tank.acquireIn <= 0) {
      tank.acquireIn = ACQUIRE_EVERY;
      this._acquire(tank);
    }
    const target = tank.target;

    /* ---- lay the gun ------------------------------------------------- */
    let wantYaw = 0;
    let wantPitch = 0;
    let onTarget = false;
    if (target) {
      const p = this._v;
      p.copy(target.position);
      p.y += 1.0;
      const dx = p.x - tank.position.x;
      const dz = p.z - tank.position.z;
      const dy = p.y - (tank.position.y + 2.0);
      const world = Math.atan2(dx, dz);
      // The HULL's heading, not the leg's: the two differ through a pivot.
      wantYaw = wrapPi(world - tank.yaw);
      wantPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), GUN_DOWN, GUN_UP);
      const dyaw = wrapPi(wantYaw - tank.turretYaw);
      const dpitch = wantPitch - tank.gunPitch;
      tank.turretYaw += clamp(dyaw, -TRAVERSE * dt, TRAVERSE * dt);
      tank.gunPitch += clamp(dpitch, -ELEVATE * dt, ELEVATE * dt);
      onTarget = Math.abs(dyaw) < AIM_TOL && Math.abs(dpitch) < AIM_TOL;
    } else {
      // Nothing to shoot: the turret returns to the way it is driving.
      const dyaw = wrapPi(-tank.turretYaw);
      tank.turretYaw += clamp(dyaw, -TRAVERSE * 0.5 * dt, TRAVERSE * 0.5 * dt);
      tank.gunPitch += clamp(-tank.gunPitch, -ELEVATE * dt, ELEVATE * dt);
    }

    /* ---- the main gun -------------------------------------------------- */
    tank.reload -= dt;
    if (target && onTarget && tank.reload <= 0) {
      this._mainGun(tank, target);
      tank.reload = RULES.tankMainReload;
      // and the coax opens up behind it
      tank.coaxLeft = COAX_ROUNDS;
      tank.coax = 0.35;
    }

    /* ---- the coax ------------------------------------------------------ */
    if (target) {
      tank.coax -= dt;
      if (tank.coax <= 0) {
        if (tank.coaxLeft > 0) {
          this._coax(tank, target);
          tank.coaxLeft--;
          tank.coax = COAX_GAP;
        } else if (onTarget || Math.abs(wrapPi(wantYaw - tank.turretYaw)) < 0.2) {
          tank.coaxLeft = COAX_ROUNDS;
          tank.coax = COAX_REST;
        }
      }
    }
  }

  /**
   * Pick a man to shoot at: the nearest live hostile inside `RULES.tankRange`
   * with a clear line from the muzzle. `match` fills the list — `match` owns the
   * roster, and this file never reads `ai`.
   */
  _acquire(tank) {
    const out = this._targets;
    out.length = 0;
    this.enemies?.(tank.team, out);
    if (!out.length) {
      tank.target = null;
      return;
    }
    const phys = this.physics;
    const muzzle = this._muzzle(tank, this._v2);
    /**
     * IT NOTICES BEING SHOT. Now that the infantry engages at all, "nearest man
     * with a line" is the wrong rule: the whole anti-armour policy in
     * `AiSystem.armourWorth` is about getting men ASTERN of the hull, and a
     * crew that keeps shelling the street in front of it while a section takes
     * its engine deck apart is the turkey shoot the brief warns about. A man
     * who has put a round on it inside `RETALIATE` seconds counts as
     * `RETALIATE_BIAS` of his real distance, so he beats anybody less than
     * twice as close — a preference, not a homing beacon: he still has to be
     * inside `tankRange`, still has to be visible, and the crew still has to
     * traverse onto him through `TRAVERSE`.
     */
    const avenge = tank.lastHitBy;
    const avengeOk = !!avenge && this.ctx.time.elapsed - tank.lastHitAt < RETALIATE;
    let best = null;
    let bestScore = RULES.tankRange;
    for (let i = 0; i < out.length; i++) {
      const e = out[i];
      const p = e.position;
      if (!p) continue;
      const d = Math.hypot(p.x - tank.position.x, p.z - tank.position.z);
      if (d >= RULES.tankRange) continue;
      const score = avengeOk && e === avenge ? d * RETALIATE_BIAS : d;
      if (score >= bestScore) continue;
      // one ray, and only for a candidate that is already the closest so far
      this._v.set(p.x - muzzle.x, p.y + 1.0 - muzzle.y, p.z - muzzle.z);
      const len = this._v.length();
      if (len < 0.5) continue;
      this._v.multiplyScalar(1 / len);
      if (phys.raycastAny(muzzle.x, muzzle.y, muzzle.z, this._v.x, this._v.y, this._v.z, len - 0.6, phys.MASK.SIGHT)) {
        continue;
      }
      best = e;
      bestScore = score;
    }
    tank.target = best;
  }

  /** World position of the muzzle. Written into `out`; allocates nothing. */
  _muzzle(tank, out) {
    out.set(0, 0, 4.9);
    out.applyMatrix4(tank.gun.matrixWorld);
    return out;
  }

  /**
   * THE MAIN GUN. A traced shell with a real fall of shot: the round goes where
   * the barrel is pointing plus a dispersion draw, so a tank misses a moving man
   * and does not miss a wall.
   */
  _mainGun(tank, target) {
    const phys = this.physics;
    // The suppression clause in `AiSystem.armourWorth` reads this: a hull that
    // has just fired is a hull the infantry is allowed to be SEEN answering.
    tank.firedAt = this.ctx.time.elapsed;
    const from = this._muzzle(tank, this._v2);
    const dir = this._v;
    dir.set(0, 0, 1).transformDirection(tank.gun.matrixWorld);
    // dispersion, in radians, drawn per shot
    dir.x += tank.rng.range(-0.012, 0.012);
    dir.y += tank.rng.range(-0.009, 0.009);
    dir.z += tank.rng.range(-0.012, 0.012);
    dir.normalize();
    const hit = phys.raycast(from, dir, 220, phys.MASK.WORLD);
    const dist = hit?.hit ? hit.distance : 220;
    const at = this._v3;
    at.copy(from).addScaledVector(dir, dist);

    // The blast. The canonical event, so `player`, `ai`, `fx` and `audio` all do
    // what they already do for a grenade or an airstrike.
    const b = this._blast;
    b.position = at;
    b.radius = RULES.tankMainRadius;
    b.damage = RULES.tankMainDamage;
    b.source = tank;
    this.ctx.events.emit('explosion', b);

    /**
     * ──────────────────────────────────────────────────────────────────────
     * 「また戦車の爆撃でも街を破壊できるようにして」
     * ──────────────────────────────────────────────────────────────────────
     * AND THE TOWN TAKES IT. The same erase the glacis makes, at the point the
     * shell landed rather than at a pile baked on a corridor — sixteen floats
     * per instance and a mask fill per instance, off an index built at boot.
     * @see `_buildRazeAtlas`. `tank.stats.razed` counts it so "the gun destroys
     * the town" is a number in the boot/death log and not a claim.
     */
    const razed = this._razeAt(at.x, at.y, at.z, RAZE_R);
    tank.stats.razed += razed;

    /**
     * ──────────────────────────────────────────────────────────────────────
     * …AND A HOUSE LOSES A WALL — 「物資やビーコンのある家も破壊できるようにして」
     * ──────────────────────────────────────────────────────────────────────
     * `world.damageAt(position, strength)` has existed, been documented in
     * ARCHITECTURE and been proved by `_breachprobe.mjs` since the cache houses
     * were built, and NOTHING HAS EVER CALLED IT. `_razeAt` above takes the
     * street furniture off the map and stops at the masonry; this is the other
     * half, and the tank's main gun is the weapon the entry point was specified
     * for — `world`'s own signature says so in as many words: "strength in
     * `match`'s own units; 1 is a tank main-gun round". Six houses carry a
     * breachable elevation, the reach is 3.4 m, the hole is 7.2 x 2.55 m, and a
     * tank route passes 2.3 m from one of those walls.
     *
     * It is one call because `world` owns everything else: which elevation is
     * breachable, whether this one is already open, whether the strength clears
     * that wall's own bar, the visual swap, the collision masks and the rubble
     * ramp. Null is the answer almost every time (nothing breachable within
     * reach) and costs six vector subtractions.
     *
     * `peek`, not `get`, and cached: `match` must stay playable on a `world`
     * that has no cache houses in it, and this runs inside a shell impact.
     */
    const world = this._world ?? (this._world = this.ctx.peek('world'));
    const breach = world?.damageAt?.(at, 1) ?? null;
    if (breach) {
      tank.stats.breaches++;
      console.info(
        `[tank] ${tank.name} BREACHED ${breach.name ?? breach.id} — ` +
          `${breach.holeW?.toFixed?.(1) ?? '?'}x${breach.holeH?.toFixed?.(1) ?? '?'} m ` +
          `at ${at.x.toFixed(1)}, ${at.z.toFixed(1)}`
      );
    }

    // Muzzle blast, the tracer down range and the dust it kicks off the street.
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (fx) {
      fx.explosion?.({ position: from, radius: 1.5 });
      fx.tracer?.(from, at, 900);
      fx.hazeRing?.(from.x, from.y, from.z, 1.6, 12, 0.4, 1.6);
      // What came off the street goes up as dust, so the props do not simply
      // stop existing inside the fireball.
      if (razed) {
        fx.dust?.(at.x, at.y + 0.5, at.z, RAZE_R * 0.6);
        fx.hazeRing?.(at.x, at.y + 0.4, at.z, RAZE_R * 0.5, 14, 0.5, 1.5);
      }
      if (fx.lights) fx.lights.flash(from.x, from.y, from.z, 1, 0.76, 0.42, 900, 0.5, 6, 40, 4);
    }
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    audio?.play?.('strike_tail', from, { level: 1.0, dur: 2.2, maxDist: 320, gain: 2.0, occlusion: 0.2 });
    this._emit('fire', tank);
  }

  /** The coaxial machine gun: one real round through `physics`, per shot. */
  _coax(tank, target) {
    const phys = this.physics;
    tank.firedAt = this.ctx.time.elapsed; // @see the note in `_mainGun`
    const from = this._muzzle(tank, this._v2);
    from.y -= 0.12;
    const p = target.position;
    const dir = this._v;
    dir.set(p.x - from.x, p.y + 1.0 - from.y, p.z - from.z).normalize();
    dir.x += tank.rng.range(-0.018, 0.018);
    dir.y += tank.rng.range(-0.014, 0.014);
    dir.z += tank.rng.range(-0.018, 0.018);
    dir.normalize();
    // Bots and every solid surface are handled by the canonical trace; the
    // player capsule is not in the ray world (see `AiSystem._testPlayerHit`), so
    // it is tested separately below.
    const impacts = phys.fireBullet({
      origin: from,
      dir,
      damage: RULES.tankCoaxDamage,
      penetration: 1.4,
      maxDist: RULES.tankRange + 30,
      mask: phys.MASK.BULLET,
      shooter: tank,
    });
    const end = impacts.length ? impacts[0].point : null;
    this._testPlayerHit(tank, from, dir, end);
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (fx && (tank.coaxLeft & 1) === 0) fx.tracer?.(from, end ?? this._v3.copy(from).addScaledVector(dir, 90), 780);
    if (tank.coaxLeft === COAX_ROUNDS - 1) {
      const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
      audio?.play?.('strafe_cannon', from, {
        level: 0.7, dur: COAX_ROUNDS * COAX_GAP, rate: 1 / COAX_GAP, maxDist: 220, gain: 1.3,
      });
    }
  }

  /**
   * The player capsule is not a physics collider, so a round aimed at them is
   * tested here — the same solve `src/ai/index.js` does for every bot round, for
   * the same reason. Damage is applied ONLY through the event.
   */
  _testPlayerHit(tank, origin, dir, end) {
    const player = this._player ?? (this._player = this.ctx.peek('player'));
    if (!player || player.dead) return;
    const m = this.ctx.peek('match');
    if ((m?.playerTeam ?? -1) === tank.team) return;
    const p = player.position;
    if (!p) return;
    const maxT = end ? origin.distanceTo(end) : 200;
    const px = p.x - origin.x;
    const py = p.y + 1.0 - origin.y;
    const pz = p.z - origin.z;
    const t = px * dir.x + py * dir.y + pz * dir.z;
    if (t < 0.5 || t > maxT) return;
    const miss = Math.hypot(px - dir.x * t, py - dir.y * t, pz - dir.z * t);
    if (miss > 0.42) {
      if (miss < 1.6) player.onNearMiss?.(miss);
      return;
    }
    this.ctx.events.emit('damage:dealt', {
      target: player,
      amount: RULES.tankCoaxDamage,
      headshot: false,
      killed: false,
      point: p,
      from: tank.position,
      source: tank,
    });
  }

  /* --------------------------------------------------------- taking it --- */

  /**
   * A round landed on one of our boxes. It arrives as `damage:dealt` because
   * the colliders carry `owner: tank` — which is the canonical path and is also
   * what gives the player a hitmarker and `e.source` the kill credit.
   */
  _takeRound(e) {
    const tank = e?.target;
    if (!tank?.isTank || !tank.alive) return;
    if (e.source && e.source.team === tank.team && !RULES.friendlyFire) return;

    /**
     * ────────────────────────────────────────────────────────────────────────
     * ONE PENETRATING ROUND, THREE WOUNDS — DIAGNOSED, IMPLEMENTED, AND OFF
     * ────────────────────────────────────────────────────────────────────────
     * `physics.emitImpact` fires a `damage:dealt` for every face the solver
     * crosses, and a box has two of them, so one round through the deck lands
     * as three events on THE SAME part with the residual energy stepping down:
     * 167.6 -> 119.6 -> 61.5. (The earlier "hull/deck/turret overlap" reading
     * of the same numbers was wrong — every event carries `part: 'deck'`.)
     * Effective multipliers, measured rather than multiplied out:
     *
     *     astern deck   x3.49   against the documented 1.70
     *     glacis        x0.45   against 0.22
     *     flank         x0.29   against 0.22
     *
     * The fix is one wound per round per hull, keeping the LARGEST event, which
     * is the entry face — and it moves every TTK line in the file, so it is
     * built and left OFF until the player has said which numbers he wants. It
     * is one boolean: `ctx.peek('match').tank.oneWoundPerRound = true`, or
     * `?onewound=1`. Everything the lethality work is tuned against is reported
     * both ways by `_tankfight.mjs`.
     *
     * A ROUND IS (FRAME, SHOOTER) and that is exact rather than approximate:
     * the three events are emitted synchronously from inside one `fireBullet`,
     * and no shooter in this engine fires twice in one frame — `Agent._shoot`
     * fires at most one round per `update`, and the player's `fireCooldown` is
     * longer than a frame at every fire rate in `weapons/defs.js`.
     */
    const amount = e.amount ?? 0;
    if (this.oneWoundPerRound) {
      const f = this.ctx.time.frame;
      const src = e.source ?? null;
      if (tank._woundFrame === f && tank._woundSource === src) {
        tank.stats.dupes++;
        return;
      }
      tank._woundFrame = f;
      tank._woundSource = src;
    }

    tank.lastHitBy = e.source ?? tank.lastHitBy;
    tank.stats.rounds++;
    tank.stats.roundDmg += amount;
    // `part` is the collider's own, set in `_buildColliders` and carried
    // through by `physics` — which box a shooter is actually finding is the
    // whole content of the armour table, so it is counted rather than assumed.
    if (e.part && tank.stats[e.part] !== undefined) {
      tank.stats[e.part] += amount;
      tank.stats[PART_COUNT[e.part]]++;
    }
    this._wound(tank, amount, e.source ?? null);
  }

  /**
   * A man the tank killed. `actor:death` carries `by` (see ARCHITECTURE's kill
   * credit note), so counting is a reference compare — this is the number that
   * says whether the hull is a threat or an ornament, and it is reported per
   * match by `_tankttk.mjs`.
   */
  _creditKill(e) {
    const by = e?.by;
    if (!by?.isTank) return;
    for (const tank of this.tanks) if (tank === by) tank.stats.kills++;
  }

  /**
   * Blast damage: a grenade, an airstrike, or the other tank's shell.
   *
   * NO TEAM TEST, AND THAT IS THE RULE RATHER THAN AN OVERSIGHT —
   * 「空爆は敵味方関係なくダメージを喰らう仕様にして」. A side's own bombs kill its own
   * armour, which is what makes calling a strike on a street your tank is in a
   * decision. `_takeRound` is the one that honours `RULES.friendlyFire`, because
   * a rifle is aimed and a bomb is not.
   */
  _takeBlast(e) {
    if (!e?.position) return;
    const air = typeof e.source === 'string' && AIR_ORDNANCE.has(e.source);
    /**
     * A BOT'S FRAG IS A FRAG. `src/weapons/grenades.js` names itself in
     * `source` because the PLAYER's grenade cannot carry an actor on this event
     * without killing his own side; `AiSystem._updateGrenades` CAN and does,
     * because that is how a bot gets the kill — so its payload named no
     * ordnance at all and fell through to `EXPLOSION_MUL`. Measured: 162
     * against the hull where the player's identical frag was worth 433.
     * `kind` is the field that says what it is without taking the attacker off
     * the payload, and either channel is accepted here.
     */
    const frag = e.kind === 'grenade' ||
      (typeof e.source === 'string' && FRAG_ORDNANCE.has(e.source));
    for (const tank of this.tanks) {
      if (!tank.alive) continue;
      if (e.source === tank) continue; // our own shell going off down the street
      /**
       * ────────────────────────────────────────────────────────────────────
       * A TANK IS 6.9 m LONG AND THIS MEASURED IT AS A POINT
       * ────────────────────────────────────────────────────────────────────
       * The distance was to `tank.position`, which is the hull's ORIGIN —
       * between the tracks, under the turret. A frag that lands dead centre on
       * the ENGINE DECK is 3.05 m astern of that, so at the bot grenade's 6.5 m
       * radius it was scored as a 53 % hit: 230 of the 433 that
       * 「一発でtankHealthの六分の一」 is meant to be worth. And the engine deck is
       * exactly where the anti-armour policy in `src/ai` sends every grenade.
       * Measured over one match at seed 12: six frags on BLUE for 1012, an
       * average of 169 apiece against a contact value of 433.
       *
       * So the offset is CLAMPED ALONG THE HULL first, which is the same move
       * `world.damageAt` makes ("the distance is to the opening's RECTANGLE
       * rather than its centre") and the same one `_acquire` has always made
       * with its own targets. A blast anywhere over the length of the tank is a
       * blast ON the tank; one beside it still falls off from the side it is
       * beside. `HULL_HALF` is short of the true 3.45 m half-length on purpose —
       * the glacis and the tail plate slope away, and a shell that lands level
       * with the very tip of either is not sitting on armour.
       *
       * IT IS NOT A GRENADE RULE. Every blast reads the same geometry, so an
       * airstrike or the other hull's shell that lands over the engine deck is
       * credited the same way — which is what they always should have been.
       */
      const ox = e.position.x - tank.position.x;
      const oz = e.position.z - tank.position.z;
      const s = Math.sin(tank.yaw);
      const c = Math.cos(tank.yaw);
      const along = clamp(ox * s + oz * c, -HULL_HALF, HULL_HALF);
      const d = Math.hypot(
        ox - s * along,
        e.position.y - (tank.position.y + 1.4),
        oz - c * along
      );
      const r = e.radius ?? 5;
      if (d > r) continue;
      /**
       * A BLAST THAT CARRIES NO `damage` IS NOT A BLAST THAT DOES NONE. The
       * frag publishes its strength as `impulse`; see `fragMul` above. `?? 90`
       * could never catch it, because 0 is not nullish.
       */
      const dmg = e.damage > 0 ? e.damage : e.impulse > 0 ? e.impulse : (e.damage ?? 90);
      const amount = dmg * (1 - d / r) * (air ? airMul(dmg) : frag ? fragMul(dmg) : EXPLOSION_MUL);
      tank.stats.blasts++;
      tank.stats.blastDmg += amount;
      if (frag) {
        tank.stats.frags++;
        tank.stats.fragDmg += amount;
      }
      /**
       * A BOMB IS NOT AN ACTOR. `e.source` on air ordnance is the string that
       * named the system ('airstrike', 'bomber'), and `MatchSystem`'s own note
       * on `_onTankKill` already says the killer "can be nothing at all (an
       * airstrike…)"; handing the string on would put it through `ai.teamOf`
       * and into the killfeed as an attacker called "airstrike". Passing null
       * leaves `lastHitBy` alone, so a hull somebody had already been shooting
       * still pays him and one nobody touched pays nobody.
       *
       * WIDENED FROM `air` TO EVERY STRING SOURCE, because the frag is a third
       * one: `grenades.js` sets `source: 'grenade'`, and the old test only
       * excused 'airstrike' and 'bomber', so the moment a frag started landing
       * for real (above) it would have put an attacker called "grenade" through
       * `ai.teamOf` and into the killfeed. A man who has been shooting the hull
       * still gets paid for finishing it with a frag; one who only ever threw
       * frags kills it for the environment, which is the same trade the bomb
       * already makes and is why `lastHitBy` is left alone rather than cleared.
       */
      this._wound(tank, amount, typeof e.source === 'string' ? null : e.source ?? null);
    }
  }

  _wound(tank, amount, by) {
    if (!(amount > 0)) return;
    tank.health -= amount;
    if (by) {
      tank.lastHitBy = by;
      // WHEN, so the crew can turn on a man who is still shooting at it rather
      // than on whoever happens to be nearest. @see `_acquire`.
      tank.lastHitAt = this.ctx.time.elapsed;
    }
    if (tank.health > 0) return;
    this._destroy(tank, tank.lastHitBy);
  }

  /**
   * IT BREWS UP. Two booleans per mesh, one uniform write, one `explosion`, and
   * the `fx` calls that all write into preallocated rings — the fracture, its
   * trajectories and its settled pose were solved at boot.
   */
  _destroy(tank, by) {
    if (!tank.alive) return;
    tank.alive = false;
    tank.state = 'dead';
    tank.health = 0;
    tank.stats.deaths++;
    tank.target = null;
    for (const c of tank.colliders) c.c.enabled = false;
    // The hull's own meshes go; the baked wreck takes over in the same frame.
    for (const mesh of tank.meshes) mesh.visible = mesh === tank.wreck;
    tank.wreck.visible = true;
    tank.wreck.userData.owNoShadow = true;
    tank.wreck.userData.owNoPrepass = true;
    tank.uniforms.uT.value = 0;
    tank.uniforms.uAnim.value = 1;

    const b = this._deathBlast;
    this._v4.copy(tank.position);
    this._v4.y += 1.5;
    b.position = this._v4;
    b.radius = RULES.tankDeathRadius;
    b.damage = RULES.tankDeathDamage;
    b.source = tank;
    this.ctx.events.emit('explosion', b);

    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (fx) {
      fx.explosion?.({ position: this._v4, radius: 5.5 });
      fx.hazeRing?.(this._v4.x, this._v4.y, this._v4.z, 3.0, 20, 0.5, 2.4);
      fx.scorch?.(tank.position.x, tank.position.y + 0.15, tank.position.z, 6.0);
      // A knocked-out tank burns for the rest of the round. One emitter.
      fx.addSmokeColumn?.(tank.position.x, tank.position.y + 1.2, tank.position.z, {
        radius: 2.4, duration: 26, rate: 9, rise: 2.6, dark: 0.5, life: 8, growth: 4.2,
      });
      if (fx.lights) fx.lights.flash(this._v4.x, this._v4.y, this._v4.z, 1, 0.6, 0.3, 1400, 0.7, 8, 60, 5);
    }
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    if (audio?.play) {
      audio.play('strike_tail', tank.position, { level: 1.3, dur: 3.4, maxDist: 380, gain: 2.4, occlusion: 0.1 });
      audio.play('strike_rubble', tank.position, { level: 0.9, dur: 2.6, extraDelay: 0.3, maxDist: 200 });
    }
    const st = tank.stats;
    console.info(
      `[tank] DESTROYED ${tank.id} at t=${this.ctx.time.elapsed.toFixed(1)}s — ` +
        `${tank.chunkCount} chunks, killed by ${by?.name ?? (by === undefined ? 'unknown' : 'the environment')} · ` +
        `alive ${st.liveT.toFixed(0)}s, ${st.rounds} rounds for ${st.roundDmg.toFixed(0)} ` +
        `(hull ${st.nHull}r/${st.hull.toFixed(0)} · turret ${st.nTurret}r/${st.turret.toFixed(0)} · ` +
        `deck ${st.nDeck}r/${st.deck.toFixed(0)}${st.dupes ? ` · ${st.dupes} dupes dropped` : ''}), ` +
        `${st.frags} frags for ${st.fragDmg.toFixed(0)}, ${st.blasts} blasts for ${st.blastDmg.toFixed(0)}, ` +
        `${st.kills} kills, ${st.legs} legs driven, ${st.razed} props shelled off the map, ` +
        `${st.breaches} walls breached, ` +
        `last standing off ${tank.targetZone ?? 'the cathedral'}`
    );
    this._announce(this.onImpact, tank);
    this.onKill?.(tank, by ?? null);
    this._emit('dead', tank);
  }

  /* ------------------------------------------------------------- plumbing -- */

  _announce(hook, tank) {
    if (!hook) return;
    const a = this._ann;
    a.kind = 'TANK';
    a.id = tank.id;
    a.name = tank.name;
    a.lead = TANK_LEAD;
    a.count = 0;
    // Where it is going, so the HUD arrow points at the street it will be in.
    const leg = tank.legs[tank.planN ? tank.plan[tank.planN - 1].leg : tank.legIx] ?? tank.legs[0];
    const j = tank.legDir < 0 && !tank.planN ? 0 : leg.n - 1;
    this._end.set(leg.X[j], leg.Y[j] + 1, leg.Z[j]);
    a.position = tank.state === 'dead' ? tank.position : this._end;
    a.points[a.count++] = a.position;
    hook(a);
  }

  _emit(phase, tank) {
    const e = this._ev;
    e.phase = phase;
    e.id = tank.id;
    e.team = tank.team;
    e.position = tank.position;
    this.ctx.events.emit('match:tank', e);
  }

  setFocus() {
    /* The routes are fixed and both fire, so there is nothing to bias. */
  }

  /**
   * A round has gone live. NOTHING IS SCHEDULED YET, and that is the change.
   *
   * There is no first-sortie timer any more: armour is the cathedral's
   * consequence, so `match` calls `armAfter` when the bombardment stops.
   * @see `RULES.tankAfterCathedral` and `MatchSystem._updateCathedralEvent`.
   */
  armRound() {
    this._next = Infinity;
    this._sorties = 0;
    this._liveT = 0;
    this._ignoreCoBusy = false;
    for (const t of this.tanks) {
      t.stats.kills = 0;
      t.stats.deaths = 0;
      t.stats.sorties = 0;
    }
  }

  /**
   * ARM THE FIRST SORTIE, `seconds` from now. One line, called by `match` from
   * the cathedral event's beat sheet; everything after it is the interval
   * scheduler this class already had (`RULES.tankInterval`, both hulls parked
   * first, never under an inbound salvo). Idempotent — a second call while the
   * armour is already armed or out does nothing.
   */
  armAfter(seconds) {
    if (!this.ready || this.busy) return false;
    if (this._next !== Infinity) return false;
    if (this._sorties >= RULES.tankMaxPerMatch) return false;
    this._next = Math.max(0, seconds);
    /**
     * AND THIS ONE SORTIE DOES NOT STAND DOWN FOR THE SKY.
     *
     * `_scheduleNext` waits out `_coBusy` because rolling a tank out under an
     * INBOUND salvo is two telegraphs at once — which is right for the ordinary
     * interval draw and exactly wrong here. `busy` on `Airstrike` is also true
     * while a mass is still FALLING and settling (`SETTLE_AT` = 6.5 s after the
     * last of a staggered group), so a sortie armed on the aftermath of the
     * cathedral spent its first three retries watching the church's own debris
     * come to rest: measured, the hull rolled 27 s after D opened rather than
     * with it, at 77-85 % of the match instead of 66-73 %, and the sortie was
     * still out when the clock ran down. Its own `busy` is still respected, so a
     * hull already in the street never gets a twin.
     */
    this._ignoreCoBusy = true;
    console.info(`[tank] armed — first sortie in ${this._next.toFixed(1)}s`);
    return true;
  }

  disarm() {
    this._next = Infinity;
    this._pending = -1;
    this._ignoreCoBusy = false;
  }

  reset() {
    this.disarm();
    // Every stall the guns took off the map goes back up before the next round.
    this._restoreRaze();
    for (const tank of this.tanks) {
      // Every pile the last round flattened goes back up before the next one.
      this._restorePlough(tank);
      tank.ploughDrag = 0;
      tank.state = 'parked';
      tank.alive = false;
      tank.s = 0;
      tank.legIx = 0;
      tank.legDir = 1;
      tank.planN = 0;
      tank.planI = 0;
      tank.targetZone = null;
      tank.yaw = tank.legs[0].YAW[0];
      tank.health = RULES.tankHealth;
      tank.firedAt = -1e9;
      tank.breachIn = 0;
      tank.root.visible = false;
      tank.uniforms.uT.value = -1;
      tank.uniforms.uAnim.value = 1;
      tank.wreck.visible = false;
      tank.wreck.userData.owNoShadow = false;
      tank.wreck.userData.owNoPrepass = false;
      for (const mesh of tank.meshes) mesh.visible = mesh !== tank.wreck;
      for (const c of tank.colliders) c.c.enabled = false;
    }
  }

  dispose() {
    this.ctx.events.off?.('explosion', this._onExplosion);
    this.ctx.events.off?.('damage:dealt', this._onDamage);
    this.ctx.events.off?.('actor:death', this._onActorDeath);
    for (const tank of this.tanks) {
      for (const c of tank.colliders) this.physics?.removeCollider(c.c);
      for (const mesh of tank.meshes) mesh.geometry?.dispose();
      for (const mesh of tank.ploughMeshes) mesh.geometry?.dispose();
      for (const m of tank.materials) m.dispose();
    }
    this.group.parent?.remove(this.group);
    this.tanks.length = 0;
  }
}

/* -------------------------------------------------------------------------- */

const RIGHT = new THREE.Vector3(1, 0, 0);
const ZERO_Q = new THREE.Quaternion();

function wrapPi(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
