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
 *     hit it, A* never hears about it and the BVH is never rebuilt.
 *     `tools/navcheck.mjs`, `lanecheck` and `fightcheck` all measure a map this
 *     feature is invisible to. That IS the trade: you cannot take cover behind
 *     the hull. A 3.3 m solid moving down a lane that thirty men are pathing
 *     through, on a grid baked at boot, is how you get thirty men stuck against
 *     it — and a wreck that stops where a capture point is is the "blocks a
 *     zone permanently" failure by another name.
 *     IT IS STILL SOLID TO PEOPLE, and that is not a contradiction: the block
 *     is DYNAMIC and per capsule, resolved once a frame beside the men who are
 *     near it, and it changes no collider, no triangle and no nav cell.
 *     「戦車への物理判定つけて、キャラが通り過ぎることが可能なので」 — @see the
 *     `BODY_HALF_W` note, `_shovePlayer` here and `Agent._clearHulls` in
 *     `src/ai`. A man who cannot be shoved clear is run over or, when the hull
 *     is stopped, let through; nobody is ever wedged and no lane is ever
 *     corked, which is what keeps this half of the guarantee true.
 *   • IT STANDS ONLY ON THE POINT IT IS ATTACKING. This is the guarantee that
 *     CHANGED, and it changed because the player asked for the thing it
 *     forbade: 「戦車自体も占領できる物体として、つまり占領サイトにいたら占領％を加算
 *     できるようにして」. A hull that may never be inside a circle cannot add to
 *     one. So the stand-off is now per zone and per leg — `ZONE_ENTER` on the
 *     spoke's OWN target so the hull ends up in the circle and counts as
 *     `CAPTURE_BODIES` men (@see `captureBodies`), and the full
 *     `ZONE_STANDOFF` on every other point, applied to where a leg may END
 *     rather than to where it may pass. The approach is excused nothing, so
 *     the HUB is still 16 m or more off every zone including D and no hull
 *     ever stands in the cathedral's circle. It was never a NAV obstacle in
 *     any of this — three `LAYER.SHOOT_ONLY` boxes, in `MASK.BULLET` and in
 *     neither `MASK.CHARACTER` nor `MASK.WORLD`, so A* and the height field
 *     cannot see a hull or a wreck wherever it stops. The boot log prints
 *     every leg's true closest approach and the zone it is to; believe it, not
 *     this comment. @see `MAP_ROUTES` and `_trimToStandoff`.
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
 *   a.captureBodies(t, out)  append this side's hulls that are STANDING on a
 *                            point, as capture bodies. `match` folds it into
 *                            `capture.update`'s presence lists.
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
import { forMap, townScaled } from './geography.js';

/**
 * THE TOWN IS 1.5x, and it is stated once — in `src/match/geography.js`, which
 * every table-carrying file in `match` aliases back to its own table's name.
 * `match` may not import `world`, so it lives on this side of the line; it no
 * longer lives on this side of the line FIVE TIMES.
 *
 * The town's routes are authored in its WIDENED plan (the space `SPAWNS` and
 * `ZONES` use in sites.js), because the mid street is the one place on that map
 * wide enough to drive a tank down and `widenX` is the identity on its
 * centreline. The plain's are authored in metres and take no transform at all.
 */
const L = townScaled;

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
const TOWN_ROUTES = [
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
      /**
       * …AND ITS FIRST CORNER IS NOW E'S. Measured at boot with the stop
       * reason the drop path now prints: the old `L(0.5,15) -> L(9,15) ->
       * L(13.5,10.5)` cut the corner off the hub straight into a 1.7 m pinch at
       * world (25, 11) — eleven samples, under `MIN_ROUTE`, so the whole
       * destination was thrown away and a RED hull whose enemy held only B had
       * nowhere to go. The E spoke leaves the hub through the same mouth and
       * bakes 107 m clean, so B borrows the two waypoints that open it and
       * rejoins its own corridor at `L(13.5, 10.5)`, which the two already
       * share. Nothing after that point moved.
       */
      { zone: 'B', points: [L(0.5, 15), L(4.5, 15), L(9, 12), L(13.5, 10.5), L(28.5, 10.5), L(33, 9), L(34.5, 7.5), L(34.5, -18), L(40.5, -24), L(46.5, -24), L(51, -28.5), L(51, -34.5), L(52.5, -36), L(55.5, -37.5), L(69, -37.5)] },
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

/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD — THREE HULLS A SIDE, 「戦車を３台ずつ出したり」
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT WAS HERE BEFORE, AND WHY IT WAS THE WORST OF THE THREE STALE TABLES
 * ────────────────────────────────────────────────────────────────────────────
 * The plain used to bake the TOWN'S polylines. Measured at boot before this
 * table existed:
 *
 *     RED    5 legs — HUB 63 m · C 186 m · E 183 m · A 269 m · B 316 m
 *     BLUE   5 legs — HUB 60 m · C 183 m · E 194 m · B 273 m · A 308 m
 *
 * TEN LEGS OUT OF TEN, EVERY ONE OF THEM BAKED CLEAN, EVERY ONE OF THEM
 * MEANINGLESS. That is not luck, it is the failure mode of a plain: `_bakePath`
 * drops a leg when the measured span falls under `HULL_W + CLEARANCE`, and open
 * grass is 40 m of span everywhere, so nothing was ever dropped and nothing was
 * ever warned about. The strike sites and the air runs at least said what they
 * had lost; the armour drove a street grid across a field and printed a healthy
 * boot line while it did it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A PLAIN IS NOT A STREET GRID, SO THE WHEEL IS SHAPED BY THE GROUND INSTEAD
 * ────────────────────────────────────────────────────────────────────────────
 * On the town every waypoint is a street: the polyline exists because there is
 * exactly one way through. Here there is no wall to route round for 300 m, and
 * the three things that DO shape a route are the swell, the works standing on
 * the centre pad, and the other two hulls on your own side.
 *
 *   1. EVERY HUB IS A MEASURED HOLLOW. `_plainscout.mjs` walks `plains.js`'s own
 *      analytic height field on an 8 m lattice, finds every local minimum inside
 *      the walkable disc, and reports how much crest stands between it and the
 *      centre of the map in the first 45 m. The six hubs below are six of the
 *      best of them:
 *
 *        RED-W   (-88, -24)   y -3.39   5.13 m of crest toward D
 *        RED-C   (-32, -88)   y -2.96   6.17 m
 *        RED-E   (112, -32)   y -5.37   5.42 m
 *        BLUE-W  (-128,  24)  y -4.46   4.26 m
 *        BLUE-C  ( -48,  32)  y -1.94   5.15 m — @see its own note; it was
 *                                       (8, 80), the deepest hollow on the map,
 *                                       until the fortress landed on it
 *        BLUE-E  (  64,  16)  y -1.83   5.03 m
 *
 *      `hold` is the only state that does not move, and the end of the approach
 *      IS the hold position, so a hull with nothing to want sits in a dip with
 *      four to eight metres of ground between its hull and the middle of the
 *      map. That is what the undulation is for: a hull-down tank on this map is
 *      a hull the swell is hiding, and `_acquire`'s `MASK.SIGHT` ray is stopped
 *      by terrain like anything else.
 *
 *   2. THE APPROACHES ARE LONG AND THEY FAN. Three hulls a side leave the base
 *      abreast, 20 m apart, six metres in front of the front rank — so the first
 *      thing you see on foot is your own armour pulling out ahead of you, three
 *      of it — and then diverge to three hubs 100-200 m apart. 144-182 m of
 *      approach on the wide lanes against the town's 62-65 m.
 *
 *   3. A TRENCH IS A WALL WITH THREE DOORS, AND THE DOORS ARE MEASURED.
 *      `plains-trench.js` cuts three lines out of the plain — NORDGRABEN
 *      (-26,-138)->(-104,-108), SUDGRABEN (26,138)->(104,108) and MITTELSAPPE
 *      (-13,-5)->(-29,34) — 1.6-1.7 m deep with 63° cheeks, which is over
 *      `NavGrid`'s 46° limit and is therefore a wall rather than a way through.
 *      NORDGRABEN lands squarely across the north base's western exit and
 *      SUDGRABEN across the south's eastern one, so this is not scenery a route
 *      can ignore. Probed at 3 m along each axis, the ground is AT GRADE in
 *      exactly three places per line: both ramped mouths (s <= 0 and s >= 80 of
 *      83.6) and one traverse at the midpoint, s = 40. The two flank approaches
 *      cross at that traverse, perpendicular, and the three D spokes that would
 *      otherwise run down MITTELSAPPE's corridor go round its north mouth.
 *      Measured, not read: `over 0.0` at s = 0, 40 and 80; `over -1.6` to
 *      `-1.7` everywhere between.
 *
 *   4. NOTHING HERE ASSUMES THE CENTRE IS OPEN. The control tower stands on the
 *      D pad at (0, -32) with a 25.4 m radius (`plains-tower.js`), the fortress
 *      and the trenches are still landing, and every one of them is mass this
 *      file did not author. So no D spoke comes at the point down the x = 0
 *      axis: they arrive from the west, the east and the south, and the north
 *      side's two western wheels swing wide round the tower's flank. If the
 *      works grow, `_bakePath`'s span test cuts the leg and the boot log names
 *      the pinch — which is the whole reason the drop path prints a reason.
 *
 *      AND IT IS NOT A D RULE, IT IS AN AXIS RULE, which is what cost this
 *      table its one dropped spoke (@see BLUE-C's leg to E). Measured on the
 *      x = 0 axis, the tower covers z -57.4…-6.6, D's own 16 m stand-off covers
 *      -16…+16 and NF-FORT covers +12…+84 — three intervals that OVERLAP, so
 *      the axis is continuously closed from z -57.4 to z +84 and NO spoke to
 *      any destination may cross it between those two numbers. The two
 *      crossings that exist are south of the tower and north of the fortress.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THREE A SIDE DOES TO TRAFFIC, AND WHAT IS DONE ABOUT IT
 * ────────────────────────────────────────────────────────────────────────────
 * One hull in a street cannot meet itself. Three on open ground can, and there
 * are exactly two ways they do it:
 *
 *   THEY WANT THE SAME POINT. `_wantZone` takes the enemy-held zone with the
 *   SHORTEST leg, and three identical wheels answer identically — all three
 *   would drive at one circle and all three would stop inside `ZONE_ENTER` of
 *   the same centre. That is fixed in `_wantZone` itself with a same-side claim:
 *   a zone another living hull of this team is already going to is skipped while
 *   any other destination is free. It is a NO-OP ON THE TOWN, where each side
 *   has exactly one hull and the two are on opposite teams.
 *
 *   THEY SHARE A CORRIDOR. Fixed here, by construction: every spoke leaves its
 *   OWN hub, and the three hubs of a side are 100-200 m apart, so two hulls
 *   ordered to the same point (which the claim allows only when nothing else is
 *   free) arrive on two different bearings and stand on two different arcs of
 *   the circle.
 *
 * A hull is not a nav obstacle and is not simulated against the world — it is
 * posed along a baked centreline — so two hulls meeting is a drawing problem
 * rather than a wedge, and neither of the above is a collision fix. It is about
 * what the player sees: three tanks nose to tail on one bearing is one tank
 * drawn three times.
 *
 * THE COORDINATES ARE METRES AND THERE IS NO TRANSFORM. `plains.js` is authored
 * at yaw 0, scale 1, origin 0, so a number here, a number in that file and a
 * `--at=` argument to `tools/zonespot.mjs` are the same point. @see
 * `src/match/geography.js`.
 */
const PLAINS_ROUTES = [
  /* ---- the north base, (-14, -150) — team 0 takes the `attack` cluster ---- */
  {
    id: 'RED-W',
    team: 0,
    name: 'RED ARMOUR WEST',
    /**
     * ────────────────────────────────────────────────────────────────────
     * ACROSS NORDGRABEN AT ITS TRAVERSE — @see the trench note in the header
     * ────────────────────────────────────────────────────────────────────
     * The old line ran diagonally down the trench's own corridor. The whole
     * wheel came back HUB 27 m and five spokes dropped: "no ground at sample 1".
     * `(-67,-133) -> (-60,-114)` is a perpendicular crossing at s = 40, the one
     * point on this line the probe finds at grade.
     */
    approach: [[-40, -148], [-58, -142], [-67, -133], [-60, -114], [-70, -80], [-88, -24]],
    spokes: [
      { zone: 'A', points: [[-88, -24], [-100, -50], [-112, -80]] },
      { zone: 'C', points: [[-88, -24], [-108, 8], [-126, 46]] },
      /** In to D from due west: the tower's footprint ends 26.6 m out. */
      { zone: 'D', points: [[-88, -24], [-60, -14], [-28, -4]] },
      { zone: 'E', points: [[-88, -24], [-40, -58], [24, -74], [80, -76]] },
      /**
       * SOUTH-WEST ROUND THE FORTRESS. The direct line crossed its western
       * outwork and the leg was DROPPED at boot — "blocked by 3.6 m of
       * unremovable mass over 3 samples at (-24, 41)", measured, which is the
       * drop path doing exactly its job. NF-FORT is at (0, 48) with a 36 m
       * reach; every point below clears it by 44 m or more.
       */
      { zone: 'B', points: [[-88, -24], [-70, 40], [-40, 84], [30, 100]] },
    ],
  },
  {
    id: 'RED-C',
    team: 0,
    name: 'RED ARMOUR CENTRE',
    approach: [[-14, -136], [-2, -124], [-2, -108], [-16, -96], [-32, -88]],
    spokes: [
      { zone: 'A', points: [[-32, -88], [-62, -96], [-96, -102]] },
      { zone: 'E', points: [[-32, -88], [18, -98], [76, -96]] },
      /** WEST ROUND THE TOWER. Straight down x 0 walks into 25.4 m of concrete. */
      { zone: 'D', points: [[-32, -88], [-56, -64], [-54, -24], [-30, -2]] },
      { zone: 'C', points: [[-32, -88], [-72, -48], [-104, 6], [-124, 50]] },
      { zone: 'B', points: [[-32, -88], [28, -52], [58, 6], [94, 66]] },
    ],
  },
  {
    id: 'RED-E',
    team: 0,
    name: 'RED ARMOUR EAST',
    approach: [[6, -138], [38, -133], [70, -122], [96, -104], [110, -74], [112, -32]],
    spokes: [
      { zone: 'E', points: [[112, -32], [124, -58]] },
      { zone: 'B', points: [[112, -32], [128, 14], [128, 62]] },
      /** In to D from due east, for the same reason RED-W comes from the west. */
      { zone: 'D', points: [[112, -32], [74, -18], [36, -4]] },
      /**
       * NORTH OF THE FORTRESS, not through it. `(14, 48)` is 14 m from NF-FORT's
       * centre — inside its 36 m reach — and this leg baked only because
       * `_bakePath` slid samples up to `LATERAL_MAX` to find a way past. A route
       * that survives by squeezing is a route the next course of masonry kills.
       */
      { zone: 'C', points: [[112, -32], [74, 14], [26, 10], [-46, 44], [-96, 62]] },
      { zone: 'A', points: [[112, -32], [62, -66], [-6, -86], [-72, -100]] },
    ],
  },

  /* ---- the south base, (14, 150) — team 1 takes the `defend` cluster ------ */
  {
    id: 'BLUE-W',
    team: 1,
    name: 'BLUE ARMOUR WEST',
    approach: [[-6, 138], [-38, 131], [-70, 118], [-97, 98], [-118, 66], [-128, 24]],
    spokes: [
      { zone: 'C', points: [[-128, 24], [-134, 54]] },
      { zone: 'A', points: [[-128, 24], [-126, -26], [-122, -72]] },
      /** Round MITTELSAPPE's north mouth: the direct line crosses its cut. */
      { zone: 'D', points: [[-128, 24], [-92, 18], [-52, -6], [-22, -14]] },
      { zone: 'B', points: [[-128, 24], [-98, 64], [-26, 96], [66, 104]] },
      { zone: 'E', points: [[-128, 24], [-98, -16], [-24, -52], [62, -78]] },
    ],
  },
  {
    id: 'BLUE-C',
    team: 1,
    name: 'BLUE ARMOUR CENTRE',
    /**
     * ────────────────────────────────────────────────────────────────────
     * THIS HUB MOVED, AND THE FORTRESS IS WHY — the exact failure this table
     * was written not to have
     * ────────────────────────────────────────────────────────────────────
     * It was (8, 80): the deepest hollow on the plain, 8.42 m of crest toward
     * the centre, and the best hull-down station the height field offers. Then
     * NF-FORT landed at (0, 48) with a 36 m reach and (8, 80) went under 8.2 m
     * of fortress — measured off `world.demolitions` and `physics.groundHeight`,
     * not guessed: deck 3.2, first solid 11.4.
     *
     * IT STILL BAKED. `_bakePath` slides a sample up to `LATERAL_MAX` onto the
     * middle of whatever span it finds, so the approach came back 62 m and
     * clean while its END was inside a wall — and the end of the approach is
     * the HOLD position, so this hull would have spent every idle second of the
     * match parked in somebody's courtyard.
     *
     * (-48, 32) is the next-best measured hollow: 5.15 m of crest, 50 m clear of
     * the fortress, 80 m clear of the tower, 58 m off D. The approach is 127 m
     * rather than 62 now, down the spine and then west of the works, which is
     * the drive this lane should have had anyway.
     */
    approach: [[14, 136], [-6, 124], [-22, 104], [-42, 72], [-48, 32]],
    spokes: [
      { zone: 'C', points: [[-48, 32], [-84, 52], [-116, 74]] },
      { zone: 'B', points: [[-48, 32], [-40, 84], [30, 102]] },
      /** In to D from the north-west of the fortress and south of the tower. */
      /**
       * ON TO RED-C'S LAST WAYPOINT, and that is the point rather than a
       * coincidence. MITTELSAPPE's north mouth (-13,-5) and the tower's apron
       * (0,-32, r 25.4) leave one 4.6 m gap between them, so there is exactly
       * ONE line into D from the west and three wheels share it. `(-22,-10)`
       * was two metres the tower's side of it and the leg came back "no ground
       * at sample 50", standing 16.7 m off a 14 m circle — kept, because
       * `ZONE_ARRIVE` is 34, and useless, because `captureBodies` counts a hull
       * only inside the circle.
       */
      { zone: 'D', points: [[-48, 32], [-42, 4], [-30, -2]] },
      /**
       * ────────────────────────────────────────────────────────────────────
       * SOUTH OF THE TOWER, BECAUSE THERE IS NO LANE PAST IT — the one spoke
       * this table lost, and the reason it could not be nudged
       * ────────────────────────────────────────────────────────────────────
       * It was `[[-48,32],[-30,-14],[30,-70],[96,-84]]` and it came back
       * "SPOKE DROPPED — 72 m of route ends 156 m off the point (needs <= 34)
       * — blocked by 2.7m of unremovable mass over 3 samples at (-12,-34)".
       * That is the control tower: the `(-30,-14) -> (30,-70)` segment passes
       * 7.31 m from `(0,-32)`, and the tower's apron reaches 25.4 m.
       *
       * The header's rule — no D spoke comes at the point down the x = 0 axis —
       * was written for the three D spokes and never applied to this one, which
       * is an E spoke that happens to cross the middle of the map. And it
       * cannot be fixed by walking the crossing a few metres either way,
       * because ON THE x = 0 AXIS THERE IS NO GAP TO WALK INTO:
       *
       *   the tower  (0,-32) r 25.4        z -57.4 … -6.6
       *   D's stand-off, r 16 off (0,0)    z -16   … +16
       *   NF-FORT    (0, 48) r 36          z +12   … +84
       *
       * Three overlapping intervals, so the axis is continuously occupied from
       * z -57.4 to z +84 and the only crossings that exist are SOUTH of the
       * tower or NORTH of the fortress. South is the one that goes to E.
       *
       * MEASURED with the engine's own baker against the built map
       * (`_ptankleg.mjs`, which calls the live `Armour._bakePath`,
       * `_trimToStandoff` and `_trimAtBlockers` off this tank's real hub rather
       * than re-implementing them): 252.4 m over 204 samples, narrowest street
       * 17.0 m, ends 6.2 m off E — inside the circle, so the hull counts for
       * `captureBodies`. The widest spoke on this wheel, and it clears the
       * tower by 36 m at its closest.
       *
       * RIGHT IN BOTH TOWER STATES, which is the requirement `_bakePath` cannot
       * check for itself: it bakes once at boot and the tower is razed by the
       * airstrike mid-match. A route that goes ROUND the footprint is unchanged
       * when the footprint goes away; a route threaded through it would only
       * have been drivable after the bombs.
       */
      { zone: 'E', points: [[-48, 32], [-44, -6], [-30, -60], [30, -88], [96, -84]] },
      { zone: 'A', points: [[-48, 32], [-72, -10], [-96, -62], [-112, -90]] },
    ],
  },
  {
    id: 'BLUE-E',
    team: 1,
    name: 'BLUE ARMOUR EAST',
    /** Across SUDGRABEN at its traverse, the mirror of RED-W's crossing. */
    approach: [[40, 148], [58, 142], [67, 133], [60, 114], [70, 80], [64, 16]],
    spokes: [
      { zone: 'B', points: [[64, 16], [92, 50], [110, 82]] },
      { zone: 'E', points: [[64, 16], [98, -14], [118, -54]] },
      { zone: 'D', points: [[64, 16], [34, 10]] },
      { zone: 'C', points: [[64, 16], [24, 54], [-40, 78], [-98, 88]] },
      /** Round the WEST of the tower — the direct line clips its apron. */
      { zone: 'A', points: [[64, 16], [26, 10], [-30, 6], [-72, -40], [-100, -84]] },
    ],
  },
];

/**
 * THE WHEELS, PER MAP. @see `forMap` in `src/match/geography.js` — the same
 * `world.level.id` selector `MAPS`/`layoutFor` and `MAP_RULES`/`applyMapRules`
 * already use, and NOT a second parse of `?map=`.
 */
const MAP_ROUTES = { town: TOWN_ROUTES, plains: PLAINS_ROUTES };

/* ---- the hull, in metres, in the tank's own frame ------------------------ */
/** +Z forward, +X right, +Y up, origin on the ground between the tracks. */
const HULL_W = 3.3;
const HULL_L = 6.9;
/**
 * Metres of street the hull needs ON TOP OF ITS OWN WIDTH to drive somewhere.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 1.1 -> 0.25 — 「戦車はとにかく踏破力と走破力を高めて スタックとかしないようにする
 * ことが優先」
 * ────────────────────────────────────────────────────────────────────────────
 * THIS NUMBER IS WHAT A PINCH IS. `_bakePath` ends a leg the moment the
 * measured span drops under `HULL_W + CLEARANCE`, so at 1.1 the hull demanded
 * 4.40 m of clear street — and the pinches that have actually killed spokes on
 * this map were measured at 3.4 m, and the one the map agent has since widened
 * came back at 4.05, WHICH IS STILL UNDER 4.40. The hull was being stopped by
 * lanes it fits down, which is the whole content of the stuck reports.
 *
 * 0.25 makes the bar 3.55 m: 12 cm of shoulder either side of a 3.3 m hull
 * after `_bakePath` has slid the sample onto the middle of the span it found.
 * That is a squeeze rather than a comfortable street, and a squeeze is what a
 * tank in a town does. IT IS NOT A COLLISION RISK IN EITHER DIRECTION — the
 * hull is not simulated against the world at all and NOTHING BELOW GIVES IT
 * WORLD COLLISION (being solid to a man is resolved on the man's capsule, not
 * on the hull's); it is posed along a baked centreline, so the cost of a tight
 * fit is a track edge visually grazing a kerb, and the cost of a loose one is a
 * hull that never leaves the square. Under `HULL_W` itself the span test still
 * ends the leg, because that is a wall rather than a squeeze.
 */
const CLEARANCE = 0.25;
/** How far a sample may be slid sideways onto the measured centreline. */
const LATERAL_MAX = 3.0;
/** Spacing of the baked path samples. */
const STEP = 1.25;
/** A route shorter than this is not a sortie. */
const MIN_ROUTE = 16;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * ONE SORTIE PER ROUND, AND WHY THAT WAS THE ARITHMETIC RATHER THAN THE INTENT
 * ────────────────────────────────────────────────────────────────────────────
 * 「まだ戦車が登場したの一回も見ていないです」 is what put armour in this game, and
 * the fix for it — `hold` became terminal, a hull that rolls never withdraws —
 * quietly took the sortie COUNT down to one:
 *
 *   `_scheduleNext` refused to run while any hull was out of its pocket, and
 *   `fire()` rolled EVERY parked hull at once. So sortie 1 emptied the pool,
 *   nothing ever returned to `parked`, and `RULES.tankMaxPerMatch` (3) could
 *   never be reached. `_park` — the withdrawal — was left behind as dead code,
 *   which is exactly why nothing put a hull back. On the plain that is six
 *   hulls in one event and then 900 s of nothing.
 *
 * TWO CHANGES, AND NEITHER OF THEM RECALLS A LIVING TANK:
 *
 *   A SORTIE IS A WAVE — one hull PER SIDE, taken in table order from whatever
 *   is still parked. NACHTFELD's six hulls are three waves of two (RED-W/BLUE-W,
 *   then -C, then -E, each wave driving a different sector), which is
 *   `tankMaxPerMatch` exactly. The town has one hull a side, so its single wave
 *   is what it always was.
 *
 *   A WRECK MAY BE CLEARED, and ONLY a wreck. When a sortie is due and every
 *   hull is out, a hull that has been dead longer than `WRECK_HOLD` is parked —
 *   its burn has finished, its smoke column (26 s) has run out — and it rolls
 *   again as the next wave. That is what `_park` is for now. A LIVE hull is
 *   still never touched: 「戦車は登場したら帰さないで 試合終了まで滞在させること」
 *   holds, and the only exits from a live tank remain `_destroy` and `reset`.
 *
 * This is also what makes the town reach more than one sortie: its two hulls
 * come back as replacements when the men kill them, which is the case worth
 * rewarding, and stay a single permanent pair when nobody does.
 */
/** Seconds a wreck must have burned before its hull may be re-issued. */
const WRECK_HOLD = 25;
/** Retry interval when a sortie is owed and there is no hull to give it. */
const WRECK_POLL = 8;

/* ---- the hull as an obstacle to PEOPLE ----------------------------------- */
/**
 * ────────────────────────────────────────────────────────────────────────────
 * 「戦車への物理判定つけて、キャラが通り過ぎることが可能なので」 — YOU COULD WALK
 * STRAIGHT THROUGH IT, AND THE COLLISION LAYER IS NOT THE FIX
 * ────────────────────────────────────────────────────────────────────────────
 * The three boxes are `LAYER.SHOOT_ONLY`, which is in `MASK.BULLET` and in
 * neither `MASK.CHARACTER` nor `MASK.WORLD`, and every note in this file said
 * that layer is why a man walks through a hull. IT IS NOT, and the difference
 * matters because the obvious one-word fix does nothing at all:
 *
 *   `physics.addCollider` COLLIDERS ARE A RAYCAST FEATURE. They are consulted
 *   by `PhysicsSystem._raycastColliders` and by nothing else. The character
 *   controller is `new CharacterController(this.staticWorld, …)` and every
 *   sweep, overlap and depenetration it runs goes to the TRIANGLE BVH — which
 *   is baked from `addStatic` meshes and cannot hold a moving object. So
 *   `layer |= LAYER.CLIP` would put the hull in `MASK.CHARACTER` and change
 *   nothing whatsoever: no capsule in this engine ever asks a collider where it
 *   is. Verified before writing a line of this: `physics/index.js:236` is the
 *   only `colliders` array, `physics/character.js` never touches it.
 *
 * A 3.3 m hull also may not go into the BVH — the nav grid is baked at boot off
 * that same static world (@see the header) and a per-frame `rebuildStatic()` is
 * not a cost that exists. So THE SOLID IS RESOLVED WHERE THE MEN ARE, once per
 * frame, against the hull's plan rectangle: `Armour._shovePlayer` for the one
 * capsule that is not an `Agent`, and `Agent._clearHulls` in `src/ai` for the
 * other thirty. Both do the same three things and both push through the
 * character controller's own `move()`, so a shove is a swept, sliding,
 * de-penetrating move against the real world and CANNOT put a man inside
 * geometry — which is the whole reason a moving 40 t solid is safe here at all.
 *
 * WHAT HAPPENS WHEN A HULL MEETS A MAN, in one place:
 *   1. HE IS PUSHED ASIDE — out of the nearest flank first, the far flank
 *      second, fore-or-aft last. The hull never slows down and never steers:
 *      its drive is a baked arc length with no world collision (@see
 *      `CLEARANCE`), and a hull that stopped for a man could be parked for the
 *      rest of the match by one bot standing in the street.
 *   2. IF THE SHOVE CANNOT CLEAR HIM AND THE HULL IS MOVING, he is run over —
 *      `CRUSH_DPS` while he stays pinned. Pinned means a wall on one side and a
 *      hull on the other, which is exactly the wedge that produced the original
 *      stuck epidemic; a man who dies there is a man who is not wedged there.
 *   3. IF THE SHOVE CANNOT CLEAR HIM AND THE HULL IS NOT MOVING (holding on a
 *      point, or a wreck), he is RELEASED after `PIN_GRACE` and walks through.
 *      A stopped hull must never be able to cork a lane: `_bakePath` only
 *      demands `HULL_W + CLEARANCE` = 3.55 m of street for a 3.3 m hull, so the
 *      shoulder beside a parked wreck can be 12 cm — narrower than a man. The
 *      graceless alternative is thirty men queued against a wreck for the rest
 *      of the match, and no amount of steering fixes a gap a capsule does not
 *      fit through. Being able to walk through a stopped hull in the one lane
 *      where there is no way past it is the cheaper failure by a distance.
 *
 * `_tankblock.mjs` measures all of it against a hull that is really rolling —
 * the player dropped on the hull centre, the player WALKING at the flank, and
 * every man's frames spent inside a rectangle; `_tankstuck.mjs` asks the
 * `stuckcheck` question with both hulls forced onto the field and reports how
 * close to a hull the men who are not moving actually are.
 */
/** Half the hull's plan footprint. Matches the `hull` collider box. */
const BODY_HALF_W = HULL_W * 0.5;
const BODY_HALF_L = 3.45;
/** The band above `tank.position.y` the body occupies, for the height test. */
const BODY_LOW = 0.15;
const BODY_HIGH = 2.35;
/** Most a single shove may travel, metres. A hull advances 0.08 m per frame. */
const SHOVE_MAX = 0.9;
/** Clearance left beyond the face so the next frame does not re-shove him. */
const SHOVE_SKIN = 0.05;
/** Damage per second to a man a moving hull has pinned against something. */
const CRUSH_DPS = 110;
/** Seconds a STOPPED hull holds a man it cannot shove before letting him by. */
const PIN_GRACE = 0.6;

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
/**
 * ────────────────────────────────────────────────────────────────────────────
 * 「また戦車は破壊可能なオブジェは破壊せよ 大聖堂入り口目の前の破壊可能そうな立方体
 *  オブジェはなんで壊れないの？？」 — THE FIFTH REPORT, AND THE CEILING WAS NEVER
 *  THE KNOB
 * ────────────────────────────────────────────────────────────────────────────
 * GO AND NAME THE OBJECT FIRST. `?boxtag` + `_cubewhy.mjs`, standing on the
 * parvis outside the great portal, seed 7:
 *
 *   d 2.5 m  box concrete  world [-16.98, 1.70, -25.50]  size 3.6 x 3.4 x 3.6
 *            stands 3.39 m over the parvis · CUBE · bound to 0 prop instances
 *            level [0, -32.25] · buildPier (src/world/sitework.js:366)
 *
 * That is `CATH south pier` in `SITEWORKS` — authored (0, -21.5, 2.4 x 2.4,
 * h 3.4), the gate-line pier that stands dead centre of the south forecourt so
 * the way into the precinct is two 3.3 m slots instead of open tarmac. Its twin
 * `CATH north pier` is the same box at level [0, +29.25]. It is a 3.6 m
 * coursed-masonry CUBE with a plinth course, a capping band and a painted band
 * at hand height, standing on its own in the middle of a square: it reads as an
 * object because it IS one, and it is the thing he is looking at.
 *
 * BOTH KNOWN MECHANISMS REFUSE IT, AND ONLY ONE OF THEM IS A NUMBER:
 *
 *   1. NO INSTANCE, NO ERASE. It is merged masonry — one `A.box` proxy and a
 *      few hundred triangles inside `world_concrete`, with no `prop_*`
 *      InstancedMesh behind it. `_ploughableAt`, `_bakeLegPlough` and
 *      `_buildRazeAtlas` all bind through an instance, so NOTHING in this file
 *      could ever have removed it. Four passes of ceiling-raising could not
 *      have touched it at any value.
 *   2. …and it is 3.39 m, over `PASS_TOP` 3.0 as well. Which is why the sweep
 *      at 3.2 lost a leg: this pier read PASSABLE to a side probe and BLOCKING
 *      to `_trimAtBlockers`, because those two asked different questions.
 *
 * SO THE ANSWER IS A SECOND KIND OF ERASABLE MASS, NOT A HIGHER CEILING.
 * `_buildBlockAtlas` measures the map's own free-standing BLOCKS at boot — a
 * height field over the whole map, flooded into islands, where an island that
 * is small in plan, thick in both plan axes, short, and ringed on every side by
 * clear road is an OBJECT standing in the street rather than a piece of a
 * building. Then it erases one the same way a scope does: degenerate indices
 * over its own drawn triangles and a mask fill over its own collision. Nothing
 * is added, nothing is built at fire time, and the mass genuinely stops
 * existing — it is not driven through and left standing.
 *
 * WHAT THE RULE TAKES ON THE BUILT MAP (`_blockcensus.mjs`, seed 7): 547
 * islands of mass, 28 taken —
 *
 *   5  `buildPier`      the two CATH gate piers (3.34 m — the cubes), the two
 *                       plaza throat piers (2.95 m), and the A connector
 *                       blockhouse (2.57 m), which the note over `CLIMB_TOP`
 *                       records as unremovable and route-pinching
 *   7  `buildPlinth`    the waist-high pads on the capture points
 *   6  `rubbleMound`    free piles of masonry
 *   5  `wrecks`         burnt-out cars
 *   5  the market-stall / barrier / sandbag clusters
 *
 * AND WHAT IT REFUSES, WHICH IS THE PART THAT MATTERS. Not one triangle of
 * `buildBuilding`, `buildCathedral`, `buildPerimeter` or `wallRun`
 * (`src/world/cordon.js`, the map boundary) is taken. Three guards do it and
 * each was put there by a measurement:
 *
 *   `BLOCK_TOP`   a building is 3.45 m per storey and 8.65-13 m of shell; the
 *                 island is simply too tall.
 *   `BLOCK_THIN`  a WALL is thin. The first census took compound-wall panels
 *                 (`buildPerimeter`, 3.95 x 0.45 x 3.6) and a cordon panel
 *                 beside them, because a 0.45 m wall floods as a 1-cell island
 *                 and passed every size test. A block is thick in BOTH plan
 *                 axes; the map's boundary can never be one.
 *   the RING      every cell round the island must read clear road. A gatehouse
 *                 built flush to a block's face (`A north gatehouse`) is part
 *                 of that block and is refused, which is right.
 *
 * `world.interiorVolumes` is a fourth, redundant guard: anything standing in an
 * enterable building's footprint is refused whatever its size.
 */
/** The lattice the height field is sampled on. */
const BLOCK_CELL = 1.0;
/** Mass under this over the road is not an object, it is a kerb. */
const BLOCK_MIN = 0.35;
/** …and over this it is a building. The CATH piers stand 3.39 m. */
const BLOCK_TOP = 3.6;
/** Widest a free-standing block may be in either plan axis. */
const BLOCK_PLAN = 5.0;
/** …and narrowest, in BOTH. This is what keeps a WALL from ever being one. */
const BLOCK_THIN = 2.0;
/** How much of its own bounding box the island has to fill. */
const BLOCK_FILL = 0.6;
/** How far outside the measured box a triangle may still belong to the block —
 *  the coping lip and the capping band stand proud of the mass under them. */
const BLOCK_PAD = 0.35;
/** How far the box may open off its own mass. A 1 m lattice under-reports a
 *  rotated footprint by up to half a cell each side; this is that, doubled. */
const BLOCK_GROW = 1.2;
/** A triangle wider than the widest box there can be is structure, not a block. */
const BLOCK_SPAN = BLOCK_PLAN + 2 * BLOCK_GROW;
/** Cell of the lookup grid the hull and the gun ask through. */
const BLOCK_LOOKUP = 4;

/**
 * How far out of the cathedral its collapse changes the ground. The building is
 * 30 x 45 m and `src/match/airstrike.js` settles its rubble mounds in the flank
 * streets either side, so the half-diagonal plus the street is the honest
 * radius. @see `_watchCathedral`.
 */
const RUIN_R = 42;

/** Mass no taller than this over the road is not a wall to a side probe: the
 *  hull either erases it (@see `PLOUGH_TOP` for a prop pile, `BLOCK_TOP` for a
 *  free-standing block) or drives over it. It is the HIGHER of the two, so the
 *  probe and `_trimAtBlockers` are asking about the same set of mass — the two
 *  disagreeing at 3.2 is what cost a leg in the sweep above. */
const PASS_TOP = Math.max(PLOUGH_TOP, BLOCK_TOP);
/**
 * ────────────────────────────────────────────────────────────────────────────
 * RAISED 1.6 -> 2.6 — 「戦車はもっと瓦礫を乗り越えていいし家や壁は破壊できるように
 * して」, THE FOURTH REPORT IN THIS DIRECTION
 * ────────────────────────────────────────────────────────────────────────────
 * 1.0 -> 1.6 -> 2.6, and each of the first two passes raised the ceiling by
 * exactly enough to clear the thing he had just driven into. The reading that
 * survives four reports is not "one more knob": the mass this map is dressed
 * and RUINED with — district demolition rubble, the cathedral's own collapse,
 * the debris fields an airstrike settles — is TERRAIN to a 40 t tracked
 * vehicle, and the only things that may still stop a hull are the three the
 * brief names: an enterable building's standing structure, the cathedral while
 * it stands, and the map boundary. All three are measured over `PASS_TOP` and
 * are therefore untouched by this number:
 *
 *     boundary cordon      3.3 - 4.6 m   (`src/world/cordon.js`, every panel)
 *     enterable storeys    3.2 m per floor, walls to 9.6 m
 *     cathedral            3.39 m piers, a 4.30 m plinth run, 8.99 m shells
 *
 * WHAT IT COSTS, HONESTLY: the (CLIMB_TOP, PASS_TOP] band that `_bakeRide`'s
 * horizontal ray and `_trimAtBlockers` police is now 2.6-3.0 rather than
 * 1.6-3.0, so the 2.6 m merged-masonry shed class that used to TRIM a leg is
 * now mass the hull rides over instead. That is the request, stated in the
 * file's own units — it is climbed, not ghosted through, because the two-point
 * ride in `_sample` puts the track run on top of it and the pitch limit still
 * applies (2.6 m over the 5.8 m track run is 24 degrees, inside `CLIMB_PITCH`).
 * Anything the hull cannot climb AND cannot erase still stops the route.
 */
const CLIMB_TOP = 2.6;
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
/** How often the hull knocks on the town it is driving through. @see `_contact`.
 *  Three `damageAt` calls and three atlas-cell sweeps per tick, both of which
 *  answer "nothing here" in a handful of compares on almost every one. */
const BREACH_EVERY = 0.15;
/** Radius of the glacis's own erase, round each of the three contact points.
 *  Together they cover the hull's width plus a shoulder. @see `_contact`. */
const CONTACT_RAZE_R = 1.9;
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
/**
 * ────────────────────────────────────────────────────────────────────────────
 * …AND "ARRIVED" IS NOT A STATE IT MAY DIE IN — 「スタックとかしないようにすることが
 * 優先」
 * ────────────────────────────────────────────────────────────────────────────
 * MEASURED, AND THE MEASUREMENT IS WHY THIS EXISTS: the hull was NOT stalling
 * on the numbers — 3-6 % of its advance under walking pace and no stall over
 * three seconds — and it still ended every watched run parked in the west
 * courtyard for the rest of the match. `hold` is terminal by design
 * (「戦車は登場したら帰さないで」) and the wheel only ever re-lays a course when
 * `_wantZone` NAMES A DIFFERENT POINT, so a hull whose side owns everything it
 * can drive to, or whose only enemy point lost its spoke at boot, is given
 * nothing to want and stands still until the whistle. From the player's seat a
 * tank that has not moved for four minutes is a stuck tank, whatever the
 * throttle trace says.
 *
 * So a hull that has been holding this long WITH NOTHING TO SHOOT goes
 * somewhere else — the next station on its own wheel. It is not a withdrawal
 * and not a despawn: the exits from a live tank are still `_destroy` and the
 * round reset, and every destination is a capture point it was already allowed
 * to stand off. A hull that is FIGHTING is never restless: `tank.target` holds
 * it where it is, which is the 「そこが占領し返すまで戦闘する」 half.
 */
const RESTLESS = 20;
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
 * (The hull is not a NAV obstacle: it changes no cell of the height field and
 * A* has never heard of it. It IS solid to a capsule that is standing where it
 * is — @see the `BODY_HALF_W` note — but that block is dynamic, is resolved
 * against the real world through the man's own controller, and releases rather
 * than wedges. The stand-off is about what the player sees standing on his
 * point, not about whether men can walk.)
 */
const ZONE_STANDOFF = 16;
/**
 * ────────────────────────────────────────────────────────────────────────────
 * …AND THE ONE ZONE IT IS ATTACKING IS NOW AN EXCEPTION — 「戦車自体も占領できる
 * 物体として、つまり占領サイトにいたら占領％を加算できるようにして」
 * ────────────────────────────────────────────────────────────────────────────
 * A HULL THAT MAY NEVER BE IN A CIRCLE CANNOT ADD TO ONE. The 16 m stand-off
 * above is measured against EVERY capture centre, target or not, so as written
 * the request was unimplementable: the hull stood eight metres outside the
 * circle it was shelling and `capture.js` counts presence, not intent.
 *
 * THE TRIM IS NOW PER ZONE RATHER THAN GLOBAL, and only for the leg's OWN
 * target: the spoke to A may run into A's circle, and it is still cut at the
 * full `ZONE_STANDOFF` off B, C, E and D. So the guarantee that changed is
 * exactly one — a hull may stand on THE POINT IT IS ATTACKING — and the one
 * that did not is the one that matters: it can never park on a point it is not
 * fighting for, and the HUB (the approach's end, in the cathedral square) is
 * trimmed at the full stand-off off every zone INCLUDING D, so no hull ever
 * stands in the cathedral's circle. @see `_trimToStandoff`.
 *
 * DERIVED FROM THE CIRCLE, NOT TYPED. The trim cuts at the first sample inside
 * this radius, so the hull's origin comes to rest between this and this plus
 * one sample step; both have to be inside `RULES.captureRadius` for the hull to
 * count at all. Two steps of margin, and a floor so a hull is never parked on
 * the exact centre of a point thirty men are fighting over.
 */
const ZONE_ENTER = Math.max(3.5, (RULES.captureRadius ?? 8) - STEP * 2 - 0.5);
/**
 * WHAT A HULL IS WORTH ON A POINT, in men. `capture.js` counts bodies and
 * scales the rate by the crowd (`RULES.captureCrowdBonus`), so this is the one
 * number that says how much a tank sitting on a circle is worth: at 2 it takes
 * an empty point in `captureTime / 1.42` — about 6.3 s against a rifleman's 9 —
 * and it outnumbers ONE defender rather than freezing against him. It cannot
 * flip a point on its own against a garrison, which is the same 「簡単に壊れたら
 * 面白くない」 trade the frag multiplier makes: armour on the objective is
 * decisive, not automatic.
 */
const CAPTURE_BODIES = 2;
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

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 「たまに穴があって次元のはざまに落とされる」 — THE FLOOR IS NOT DRESSING
 * ────────────────────────────────────────────────────────────────────────────
 * Every eraser in this file — the plough's piles, the raze atlas, the block
 * atlas — guarded the ground with a RISE TEST against a single road datum:
 * `yhi <= q.riseY` for the pile, `yhi <= b.y + 0.12` for the block. That datum
 * is the height of the road AT ONE POINT (the pile's centre, the block's
 * centre), and it is the reason a hole opens on the plain and never in the
 * town: the town's carriageway is flat, so one datum describes the whole box,
 * and the plain's is not. Ground half a metre into a pile box on a 6 % slope is
 * already above the centre's `riseY` and is taken as if it were a sandbag.
 *
 * The raze atlas had no rise test at all. Its two rules are that a triangle be
 * SMALL and NEAR an instance, and the note over `_buildRazeAtlas` justifies the
 * size rule with "a merged wall's triangles are metres long". SO IS NO PART OF
 * THIS MAP'S GROUND. Measured on the built plain: `collide_dirt` is 323 218
 * triangles and 311 497 of them are 1.0–1.5 m across — the terrain sheet is
 * finer than `RAZE_TRI`, not coarser — so 128 235 pieces of floor were bound to
 * whatever prop happened to stand within `RAZE_BIND` of them, and a shell
 * landing in the field took the field away. 29 362 of 608 181 sample points
 * (4.8 %) had no triangle left under them after 420 match seconds.
 *
 * So the datum goes, and the question is asked of the geometry instead: IS
 * THERE ANYTHING UNDER THIS TRIANGLE? A face with solid under it can be taken —
 * a man who walks off it lands on whatever held it up. A face with NOTHING
 * under it is the last thing between him and the void, whatever it is made of
 * and whatever is standing on it, and no eraser may bind it. That is the rise
 * test's intent, stated so that it follows the terrain, the trench floor, the
 * works platform and the fort deck for free, because it never mentions them.
 *
 * It is downward `raycastAny` over each face at BOOT, into `_floorTri`, and
 * every eraser reads the array. Nothing is computed on the frame a shell fires.
 */
/** |ny| above which a face is something a man could stand on. cos 70°. */
const FLOOR_UP = 0.34;
/** The support ray starts this far under the triangle's LOWEST vertex, so it
 *  cannot hit the triangle it is asking about. */
const FLOOR_DROP = 0.05;
/** …and looks this far down. Nothing below this is a floor either. */
const FLOOR_REACH = 300;
/**
 * WHERE THE SUPPORT IS ASKED FOR, in barycentric weights. A SINGLE RAY AT THE
 * CENTROID IS NOT ENOUGH, and the measurement that says so is the residue: with
 * one sample the plain came back from a 420 s match with 86 cells still missing
 * in 25 pockets up to 1.6 x 3.2 m, and `_zzsupport.mjs` attributed almost all of
 * them to a triangle whose support WAS STILL STANDING — a slab under the middle
 * of a face that does not reach its corners. `_nfvoid.mjs` samples the map on a
 * 0.4 m grid; a support test that samples one point of a 1.5 m triangle is
 * coarser than the gate that grades it.
 *
 * So: the centroid, the three corners and the three edge midpoints, each pulled
 * 5 % in so the ray cannot slip down a shared edge on floating-point luck — and
 * only 5 %, because at 12 % the plain still came back with 2-8 single-cell
 * pinpricks whose support was standing but stopped short of the corner. ANY of
 * the seven finding nothing makes the whole triangle floor, and the first one
 * that does ends the test — which is why seven samples cost well under seven
 * times one: 329 721 up-facing faces on the plain take ~500 000 rays, not
 * 2 308 047, because the great majority are floor and their first ray says so.
 *
 * ERRING THIS WAY IS FREE. A sample that wrongly reports air KEEPS a triangle
 * solid, and everything downstream of that is safe: the nav grid was baked with
 * it solid, `stuckcheck` measured the map with it solid, and the instance it
 * belongs to still stops being DRAWN when the shell lands. The other direction
 * is the hole the player fell through.
 */
const FLOOR_BARY = [
  [0.334, 0.333, 0.333],
  [0.9, 0.05, 0.05], [0.05, 0.9, 0.05], [0.05, 0.05, 0.9],
  [0.05, 0.475, 0.475], [0.475, 0.05, 0.475], [0.475, 0.475, 0.05],
];

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 「戦車自体はもっと敵に打たれたり補足したらすぐ打ち返してね」 — THE CREW ANSWERS AT ONCE
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THE DELAY ACTUALLY WAS, ADDED UP RATHER THAN GUESSED AT. Between a round
 * landing on the hull and the first round leaving it there were FOUR serial
 * waits, and the gun was only one of them:
 *
 *     up to 0.40 s   `ACQUIRE_EVERY` — the crew did not even look until the
 *                    next re-selection tick, however hard it had been hit
 *     up to 5.07 s   traverse at 0.62 rad/s — 180 degrees took FIVE SECONDS,
 *                    which is most of a main-gun reload spent turning
 *          1.50 s    `COAX_REST` on a COLD coax: a fresh target set `coaxLeft`
 *                    and then waited out a whole rest before the first burst,
 *                    so the machine gun answered later than the main gun did
 *     up to 5.50 s   `RULES.tankMainReload`, which is not this file's to move
 *
 * So the answer is the first three, in the order they cost. The tick halves,
 * the traverse nearly doubles, a SNAP rate on top of that is what the crew does
 * when the thing it is laying on is the thing that just hit it, and the coax
 * opens on the frame it is roughly aligned instead of after a rest it has not
 * earned. `_wound` also drops `acquireIn` to zero, so a round on the hull is
 * re-acquired on the NEXT FRAME rather than at the next tick.
 */
/** Turret traverse and gun elevation, radians/second. */
const TRAVERSE = 1.05;
const ELEVATE = 0.8;
/** …and the rate the crew lays at when the target IS the man who just hit it.
 *  180 degrees in 1.5 s. @see `_acquire`'s `snap`. */
const TRAVERSE_SNAP = 2.1;
const ELEVATE_SNAP = 1.5;
/** Gun elevation limits. */
const GUN_UP = 0.30;
const GUN_DOWN = -0.16;
/** How far off the target the gun has to be before the crew will fire. */
const AIM_TOL = 0.035;
/**
 * …and how far off it will accept while snapping onto whoever hit it. A moving
 * man on a 2.1 rad/s traverse can sit inside 0.035 for less than a frame, which
 * is a gun that lays perfectly and never fires; 0.07 rad at 40 m is 2.8 m and
 * `RULES.tankMainRadius` is 9. Certainty, which is what was asked for.
 */
const AIM_SNAP = 0.07;
/** Seconds between target re-selections. Cheap, but not every frame — and a
 *  round on the hull re-acquires immediately rather than waiting for it. */
const ACQUIRE_EVERY = 0.2;

/** Coaxial burst shape: rounds, and the gap between them. */
const COAX_ROUNDS = 9;
const COAX_GAP = 0.085;
const COAX_REST = 1.5;
/** How far off the bore the coax will still open up. It aims at the target
 *  itself rather than down the barrel (@see `_coax`), so this is only "the
 *  turret is round far enough that we are not shooting our own hull". */
const COAX_ARC = 0.35;

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

/**
 * How long a man who hit the hull stays the crew's problem. @see `_acquire`.
 * 6 -> 9 s: `RULES.tankMainReload` is 5.5, so at six seconds a shooter could
 * fall out of the window BETWEEN two rounds of the gun answering him.
 */
const RETALIATE = 9.0;
/** …and how much nearer he counts than he is while he does. 0.5 -> 0.3: he now
 *  beats anybody less than 3.3x closer instead of 2x. 「補足したらすぐ打ち返して」
 *  is a statement about WHO as much as about how fast. */
const RETALIATE_BIAS = 0.3;
/** …and how much nearer ENEMY ARMOUR counts than it is. @see `_acquire`. */
const ARMOUR_BIAS = 0.45;
/**
 * A shell that reaches a hull STOPS AT IT, as a radius round the hull centre.
 *
 * The three collider boxes are `LAYER.SHOOT_ONLY` and `MASK.WORLD` is
 * `STATIC | PROP`, so `_mainGun`'s trace does not see another tank AT ALL — it
 * passes through the target and lands wherever the ground is. Measured
 * geometrically rather than in a match, because the arithmetic is exact: the
 * muzzle is 2.4 m up and the gun lays on `target.position.y + 1.0`, so over a
 * horizontal D the ray has dropped 1.4 m at the target and reaches the deck
 * about D BEYOND it. At 60 m the round lands 60 m past the hull it was aimed
 * at, which is well outside `tankMainRadius` 9 — a duel in which neither side
 * can ever hit the other.
 *
 * 2.6 m is the hull's own bounding radius in plan and elevation (halfW 1.65,
 * halfL 3.45, roof 2.35), which is what forty tonnes of steel stops a shell
 * WITH. Only armour gets this: a man is not a wall, the round goes past him
 * and the 9 m of splash is what kills him, and that is the existing behaviour
 * of every main-gun round this file has ever fired.
 */
const SHELL_STOP = 2.6;

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

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 「戦車が通ったら爆発 戦車を破壊するだけのダメージを出して」 — THE ANTI-TANK MINE
 * ────────────────────────────────────────────────────────────────────────────
 * A MINE UNDER A HULL DESTROYS IT. Not "hurts it badly", not "with a second
 * one" — the request is one sentence and it is a kill, and the reason armour
 * dominates this plain is precisely that nothing on the ground could ever
 * answer it. So this multiplier is the one figure in the file that is allowed
 * to be certain.
 *
 * …AND IT IS DERIVED, EXACTLY AS `airMul` AND `fragMul` ARE, so it stays true
 * when `RULES.tankHealth` moves — which it has, twice, 2600 -> 4000. The
 * derivation has one more term than theirs because a mine is UNDER the hull
 * rather than beside it, and `_takeBlast`'s falloff is measured to a reference
 * point 1.4 m up the hull's centreline:
 *
 *   the blast sits at the mine, lifted 0.14 m by `_explode`
 *   the reference is `position.y + 1.4`, and `along` is clamped to HULL_HALF
 *   so the WORST geometry a plate can produce is a mine under a track edge:
 *   1.65 m off the centreline and 1.26 m below the reference — 2.08 m away.
 *
 * The multiplier is therefore the one that reaches `tankHealth` AT THAT WORST
 * POINT. Under the belly it is 1.16x overkill; at the track edge it is exactly
 * a kill; and a hull that is merely NEAR one — 4 m off, which no plate can
 * trip — takes about half. `damage` cancels out of the product, which is what
 * makes the promise independent of the mine's own anti-personnel figure:
 *
 *     amount = dmg x (1 - d/r) x mineMul(dmg, r) = tankHealth x (1-d/r)/(1-2.08/r)
 *
 * A DAMAGED HULL DIES FURTHER OUT, and a full-health one does not die to a
 * mine it drove PAST. That is the whole shape of the weapon.
 */
const MINE_ORDNANCE = new Set(['atmine']);
/** The worst point a track edge can put the charge, in metres. @see above. */
const MINE_EDGE = Math.hypot(1.65, 1.4 - 0.14);
const mineMul = (damage, radius) => {
  const r = Math.max(MINE_EDGE + 0.5, radius || 0);
  return RULES.tankHealth / Math.max(1, damage * (1 - MINE_EDGE / r));
};

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 「また戦車同士でも叩くようにして 認識して、お互いに」 — AND ONE HULL'S SHELL
 * AGAINST ANOTHER
 * ────────────────────────────────────────────────────────────────────────────
 * A tank duel has to RESOLVE, and on `EXPLOSION_MUL` it does not. Measured
 * arithmetic before this line existed: `tankMainDamage` 300 at contact x 1.35
 * is 405 of 4000, so ten hits, at `tankMainReload` 5.5 s apiece — FIFTY-FIVE
 * SECONDS of two hulls shelling each other at four metres a second, in which
 * both of them are also being re-tasked every two seconds by `_wantZone`. That
 * is not a duel, it is two vehicles ignoring each other loudly.
 *
 * A THIRD OF A HULL PER ROUND ON, so three rounds decide it — about seventeen
 * seconds including the laying, which is long enough to be a fight the player
 * can walk into the middle of and short enough that it ENDS. Derived off
 * `tankHealth` like the other three multipliers, so it survives that line
 * moving.
 *
 * IT IS KEYED ON `kind`, NOT ON `source`, and that matters: `_destroy` fires
 * its own `explosion` with `source: tank` as the hull brews up, and reading
 * "an explosion whose source is a tank" would make a dying hull's ammunition
 * a third of a kill against every other hull in twelve metres. Only the main
 * gun's own round carries `kind: 'tankmain'`. @see `_mainGun`.
 */
const TANK_SHARE = 1 / 3;
const tankMul = (damage) => (RULES.tankHealth * TANK_SHARE) / Math.max(1, damage);

/** Where the fracture ends up: the debris settles inside this radius, locally. */
const WRECK_R = 4.2;

/**
 * THE LANE CLOUD — @see `_bakeLanes`. `LANE_STEP` is how far apart the
 * published points are (the legs themselves are baked at `STEP` 1.25 m, which
 * is four times finer than anything choosing a place to bury a mine needs);
 * `LANE_CELL` is the uniform grid the lookup buckets them into.
 */
const LANE_STEP = 5.0;
const LANE_CELL = 12.0;
/**
 * HOW FAR IN FRONT OF A HULL A MINE MUST GO, and how far ahead is still worth
 * walking to. @see `armourAhead` — 35 m is `atmine.fuse` (6 s) times
 * `SPEED_ADVANCE` (4.6 m/s) plus the man's own last few steps, because ground
 * the hull crosses before the plate arms is ground the mine is not on.
 */
const MINE_LEAD = 35;
const MINE_REACH = 140;

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
    /** How many wheels THIS MAP authored, so the boot log's fraction is honest
     *  on a map with three hulls a side as well as on one with one. */
    this._routeN = 0;
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
    /**
     * ══════════════════════════════════════════════════════════════════════
     * WHAT KILLS ARMOUR ON THIS MAP, as a ledger rather than a claim
     * ══════════════════════════════════════════════════════════════════════
     * 「平原において戦車は最強すぎる」 is a statement about a number that nobody had:
     * how many hulls die, and to what. Three of four matches measured before
     * this work destroyed NEITHER hull in 152-232 s of life apiece (@see the
     * block on `tankAfterCathedral` in rules.js), which is what "too strong"
     * means in the seat. Both halves of the answer — the minefield and hulls
     * engaging each other — are counted here, keyed off `tank.lastOrd`, so
     * "before and after" is a table.
     *
     * Reset per ROUND (`armRound`), not per sortie.
     */
    this.kills = { mine: 0, tank: 0, air: 0, frag: 0, round: 0, blast: 0 };
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
    /** The hulls of the next wave. Reused; at most one per team. @see `_wave`. */
    this._waveBuf = [];
    this._blast = { position: this._v2, radius: 0, damage: 0, source: null, kind: null };
    this._deathBlast = { position: this._v4, radius: 0, damage: 0, source: null, kind: null };
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

  /**
   * ────────────────────────────────────────────────────────────────────────
   * 「戦車自体も占領できる物体として、つまり占領サイトにいたら占領％を加算できるように
   * して」 — THE HULL AS A BODY ON THE POINT
   * ────────────────────────────────────────────────────────────────────────
   * WHAT A CAPTURE POINT COUNTS IS PRESENCE, and `src/match/capture.js` counts
   * it by walking two lists of things that have `alive` and `position`. A tank
   * has both and means the same thing by both — `alive` is exactly "out of its
   * pocket and shootable" — so the whole of this feature is: put the hull in
   * the list. No new rule, no second code path, no capture arithmetic in this
   * file, and the circle test, the crowd scaling, the contest freeze and the
   * bleed-back are the ones every man on the map already obeys.
   *
   * `match` calls it (@see the `capture.update` call in `src/match/index.js`)
   * because `match` owns the roster and this file may not touch the zones. It
   * appends `CAPTURE_BODIES` references per live hull, which is how "a tank is
   * worth two men" is expressed to a counter that counts entries.
   *
   * A WRECK IS NOT A BODY. `alive` goes false the frame the hull brews up, so a
   * knocked-out tank standing in a circle contributes nothing to the capture.
   * It IS solid to a man now (`solid` outlives `alive` — @see the
   * `BODY_HALF_W` note), but it can neither be captured with nor cork the
   * circle: a wreck never crushes, and a man it cannot shove aside is let
   * through after `PIN_GRACE`. It is scenery on the point, which is the only
   * part of the old "never in a circle" guarantee this change spends.
   *
   * AND NEITHER IS A HULL DRIVING PAST. `hold` is the state a tank has ARRIVED
   * in, and it is the only state that does not move. That is not a nicety: the
   * stand-off is now a rule about where a leg may END rather than where it may
   * pass (@see `_trimToStandoff`), precisely so that a corridor to A which
   * clips B on the way is a route instead of a dropped spoke — and a hull that
   * counted while transiting would be flipping points it drove past. A tank
   * captures by standing on the objective, which is also what it looks like.
   */
  captureBodies(team, out) {
    if (!out) return out;
    for (const t of this.tanks) {
      if (!t.alive || t.team !== team || t.state !== 'hold') continue;
      for (let k = 0; k < CAPTURE_BODIES; k++) out.push(t);
    }
    return out;
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
    /**
     * BEFORE EVERY ERASER, because all three read it and none of them may bind
     * a piece of floor. @see the note over `FLOOR_UP`. A failure here leaves
     * `_floorTri` null and every eraser falls back to the rise tests it always
     * had, which is the behaviour this shipped with rather than an open hole.
     */
    try {
      this._buildFloorMask(physics);
    } catch (err) {
      console.warn('[tank] floor mask failed — the erasers fall back to their road datums', err);
      this._floorTri = null;
    }
    /**
     * BEFORE the hulls, because the routes are baked against it: `_ploughableAt`
     * asks `_blockAt` whether a 3.4 m pier is mass the hull can take off, and
     * `_trimAtBlockers` cuts a leg at anything it cannot. @see
     * `_buildBlockAtlas`.
     */
    try {
      this._buildBlockAtlas(world, physics);
    } catch (err) {
      console.warn('[tank] block atlas failed — merged masonry stays standing', err);
      this._blocks = null;
      this._blockTri = null;
    }
    /**
     * WHICH MAP'S WHEELS. Keyed off `world.level.id`, exactly as `sites.js`
     * keys its zone table and `rules.js` its tuning. @see `MAP_ROUTES`, and see
     * the note above `PLAINS_ROUTES` for what baking the town's polylines
     * against the plain looked like: ten legs out of ten, none of them dropped,
     * none of them anywhere.
     */
    const routes = forMap(MAP_ROUTES, world, 'tank routes');
    this._routeN = routes.length;
    for (const spec of routes) {
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
    // Nothing binds after boot, and it is 366 KB on the plain.
    this._floorTri = null;
    if (this.tanks.length) ctx.scene.add(this.group);

    ctx.events.on('explosion', this._onExplosion);
    ctx.events.on('damage:dealt', this._onDamage);
    ctx.events.on('actor:death', this._onActorDeath);

    /**
     * THE LANES, AS A POINT CLOUD — baked here, at BOOT, out of legs that have
     * already been baked. @see `laneNear`, which is the whole reason it exists.
     */
    this._bakeLanes();

    this.ready = this.tanks.length > 0;
    this.buildMs = performance.now() - t0;
    console.info(
      `[tank] ${this.tanks.length}/${this._routeN} tanks baked in ${this.buildMs.toFixed(0)}ms — ` +
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
    if (this.tanks.length < this._routeN) {
      console.error(
        `[tank] ${this._routeN - this.tanks.length} SORTIE(S) DROPPED — the route ` +
          'coordinates in src/match/tank.js no longer match the map.'
      );
    }
    return this;
  }

  /* ---------------------------------------------------------- the lanes -- */

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * WHERE ARMOUR ACTUALLY DRIVES, PUBLISHED — 「積極的に対戦車地雷を仕掛けるように」
   * ══════════════════════════════════════════════════════════════════════════
   * A MINE OFF THE LANE IS A MINE NOTHING WILL EVER DRIVE OVER, and that is the
   * whole difficulty of the bot behaviour this feature needs. NACHTFELD is
   * 260 x 300 m of open ground; six hulls drive 36 baked legs off six hubs and
   * they drive NOWHERE ELSE — a hull is posed along a centreline, it does not
   * steer, it does not avoid and it does not improvise. So "lay it somewhere
   * sensible" is not a heuristic a man can have about terrain; it is a lookup
   * against geometry this file already owns and nothing else can see.
   *
   * `laneNear(x, z, maxD, out)` is that lookup: the nearest point on any baked
   * leg to (x, z), or null past `maxD`. It is what `src/ai` should ask before
   * it commits a man to walking somewhere to bury a mine, and it answers with
   * the leg's own heading so a mine can be laid ACROSS the lane rather than
   * beside it.
   *
   * BAKED AT BOOT, out of legs that are themselves baked at boot: every sample
   * of every leg, thinned to `LANE_STEP` metres, into three flat typed arrays
   * and a uniform cell grid. On the plain that is 36 legs of 60-250 m at 1.25 m
   * per sample, thinned 4:1 — about 900 points, 22 KB, and it never changes
   * again. Nothing about it is per-frame and nothing about it allocates: the
   * query writes into an `out` object the caller owns.
   *
   * COST OF A QUERY: the cells within `maxD` of the point (9 at the default
   * 5 m cell and a 5 m radius, 25 at 12 m), each a `Map.get` and a short walk.
   * It is a decision a man makes every few seconds at most, not a frame cost.
   */
  _bakeLanes() {
    const X = [];
    const Z = [];
    const YAW = [];
    const TEAM = [];
    const step2 = LANE_STEP * LANE_STEP;
    for (const tank of this.tanks) {
      for (const leg of tank.legs) {
        let lx = Infinity;
        let lz = Infinity;
        for (let i = 0; i < leg.n; i++) {
          const dx = leg.X[i] - lx;
          const dz = leg.Z[i] - lz;
          if (dx * dx + dz * dz < step2) continue;
          lx = leg.X[i];
          lz = leg.Z[i];
          X.push(lx);
          Z.push(lz);
          YAW.push(leg.YAW[i]);
          TEAM.push(tank.team);
        }
      }
    }
    this._laneX = new Float32Array(X);
    this._laneZ = new Float32Array(Z);
    this._laneYaw = new Float32Array(YAW);
    /** WHICH SIDE'S ARMOUR DRIVES THIS POINT. @see the `enemyOf` filter. */
    this._laneTeam = new Uint8Array(TEAM);
    this._laneGrid = new Map();
    for (let i = 0; i < X.length; i++) {
      const key = this._laneKey(X[i], Z[i]);
      let b = this._laneGrid.get(key);
      if (!b) this._laneGrid.set(key, (b = []));
      b.push(i);
    }
    /** Written by `laneNear`; the caller may pass its own instead. */
    this._laneOut = { x: 0, z: 0, yaw: 0, d: 0, team: -1 };
    console.info(
      `[tank] ${X.length} lane points off ${this.tanks.reduce((a, t) => a + t.legs.length, 0)} ` +
        `baked legs, ${LANE_STEP} m apart, in ${this._laneGrid.size} cells — published as laneNear()`
    );
  }

  _laneKey(x, z) {
    return (Math.floor(x / LANE_CELL) + 4096) * 8192 + (Math.floor(z / LANE_CELL) + 4096);
  }

  /**
   * THE NEAREST POINT ON ANY BAKED TANK LANE to (x, z), or null past `maxD`.
   *
   * ────────────────────────────────────────────────────────────────────────
   * `enemyOf` IS THE HALF THAT WAS MISSING, AND IT WAS MEASURED
   * ────────────────────────────────────────────────────────────────────────
   * The first version of this took no team and answered "the nearest lane".
   * `_dtankwar.mjs` then ran the specification against it over two full
   * matches: TWENTY MINES LAID, TWENTY ARMED, **NOT ONE EVER TRIPPED**, and
   * the reason is geometry rather than a bug in anything. A man is near HIS
   * OWN SIDE'S ground for most of a match, the nearest lane to his own ground
   * belongs to HIS OWN wheel, and a plate does not fire under the side that
   * laid it (`armourFootprint`). Every mine on the map was buried on a road
   * only friendly armour would ever use.
   *
   * So the question a mine-layer actually has is not "where is a lane" but
   * "where is a lane THE OTHER SIDE'S ARMOUR DRIVES", and only this file can
   * answer it: the team is a property of the WHEEL the leg belongs to and is
   * not recoverable from a position. `enemyOf` filters to points driven by
   * somebody other than that team. The six wheels converge on the five capture
   * points, so on this map the answer is almost always "near the objective you
   * are already fighting over", which is where a minefield belongs.
   *
   * @param {number} x,z    world metres.
   * @param {number} maxD   how far to look, metres.
   * @param {number} enemyOf  a team index: keep only lanes driven by the OTHER
   *                        side's armour. -1 (the default) keeps all of them.
   * @param {object} [out]  `{x, z, yaw, d, team}`, written in place. Omit to
   *                        use the shared record, valid until the next call.
   * @returns {object|null} `out`, or null when there is no lane inside `maxD`.
   *          `yaw` is the leg's own heading there, in the `atan2(dx, dz)`
   *          convention `_bakePath` bakes — so a mine laid ACROSS the lane is
   *          laid at `yaw + PI/2`.
   */
  laneNear(x, z, maxD = 12, enemyOf = -1, out = null) {
    if (!this._laneGrid || !this._laneX?.length) return null;
    const o = out ?? this._laneOut;
    const R = Math.ceil(maxD / LANE_CELL);
    const cx = Math.floor(x / LANE_CELL);
    const cz = Math.floor(z / LANE_CELL);
    let best = maxD * maxD;
    let bi = -1;
    for (let gx = cx - R; gx <= cx + R; gx++) {
      for (let gz = cz - R; gz <= cz + R; gz++) {
        const b = this._laneGrid.get((gx + 4096) * 8192 + (gz + 4096));
        if (!b) continue;
        for (let k = 0; k < b.length; k++) {
          const i = b[k];
          if (enemyOf >= 0 && this._laneTeam[i] === enemyOf) continue;
          const dx = this._laneX[i] - x;
          const dz = this._laneZ[i] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) { best = d2; bi = i; }
        }
      }
    }
    if (bi < 0) return null;
    o.x = this._laneX[bi];
    o.z = this._laneZ[bi];
    o.yaw = this._laneYaw[bi];
    o.team = this._laneTeam[bi];
    o.d = Math.sqrt(best);
    return o;
  }

  /** How many lane points were baked. 0 means no wheel baked on this map. */
  get laneCount() {
    return this._laneX?.length ?? 0;
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * THE GROUND A HOSTILE HULL IS ABOUT TO DRIVE OVER — and this is the call
   * that makes a minefield work at all
   * ══════════════════════════════════════════════════════════════════════════
   * MEASURED, AND THE MEASUREMENT IS THE WHOLE ARGUMENT. `_dminefield.mjs`
   * lays the full ration — five men a side, two each — the moment armour rolls,
   * by three rules, and watches for 220 s (seed 7, NACHTFELD):
   *
   *     A  the bearer's nearest ENEMY lane                 20 laid   0 tripped
   *     B  the nearest enemy lane within 45 m of a ZONE    20 laid   0 tripped
   *     C  the leg a hull is ACTUALLY ON, ahead of it      20 laid   7 tripped
   *                                                       6 of 6 hulls dead,
   *                                                       every one to a mine
   *
   * The plate is not the problem, the damage is not the problem and the
   * emplacement is not the problem — C proves all three, completely. THE
   * PROBLEM IS WHICH LEG. Six wheels of six legs is 36 baked routes and about
   * five kilometres of centreline; a hull drives two or three of them in a
   * match, a few hundred metres. Twenty point mines scattered over "somewhere
   * armour could drive" is a fifth of a percent of coverage, and a fifth of a
   * percent measures as zero twice.
   *
   * `laneNear` cannot close that gap and no amount of tuning it will: it
   * answers a question about the MAP, and the missing information is about the
   * hulls that are on it right now. Only this file has that — `legIx`, `s` and
   * `legDir` are updated every frame by `_drive` and are meaningless outside
   * it. So it is published.
   *
   * IT IS NOT X-RAY VISION, and that matters for a weapon that has to be fair:
   * what it encodes is "there is a tank over there and it is going that way",
   * which is what a man watching a 7 m hull cross open ground on a 260 m plain
   * actually knows. `src/ai` should gate the CALL on the man having seen the
   * hull (`armourWorth` / the vehicle list already decides that); this method
   * holds no opinion about perception and will answer for a hull nobody can
   * see. That is the caller's rule to apply, and the report says so.
   *
   * `MINE_LEAD` is why it starts ahead rather than at the hull: the mine takes
   * `WEAPON_DEFS.atmine.fuse` (6 s) to arm and `SPEED_ADVANCE` is 4.6 m/s, so
   * anything inside ~28 m is ground the hull has crossed before the plate is
   * live. 35 m is that with the man's own last few steps in it.
   *
   * COST: live hostile hulls (at most three) x the samples between `MINE_LEAD`
   * and `MINE_REACH` at `LANE_STEP` (21), so about 63 distance tests, no
   * allocation, no ray. It is a decision a man makes every twenty seconds, not
   * a frame cost.
   *
   * @param {number} team   the LAYER's side. Hostile hulls are the others.
   * @param {number} x,z    where he is standing.
   * @param {number} maxD   how far he will walk to it.
   * @param {object} [out]  `{x, z, yaw, d, lead, id}`, written in place.
   * @returns {object|null} `out`, or null when no hostile hull is heading
   *          anywhere within `maxD` of him. `lead` is how far in front of the
   *          hull the point is, so a caller can prefer a longer fuse margin.
   */
  armourAhead(team, x, z, maxD = 60, out = null) {
    const o = out ?? this._aheadOut ??
      (this._aheadOut = { x: 0, z: 0, yaw: 0, d: 0, lead: 0, id: '' });
    let best = maxD * maxD;
    let found = false;
    for (const t of this.tanks) {
      if (!t.alive || t.team === team || t.state === 'dead') continue;
      const leg = t.legs[t.legIx];
      if (!leg) continue;
      for (let lead = MINE_LEAD; lead <= MINE_REACH; lead += LANE_STEP) {
        const s = t.s + lead * t.legDir;
        if (s < 0 || s > leg.length) continue;
        // The sample nearest that arc length. `S` is monotonic and the legs are
        // baked at `STEP`, so this is a divide rather than a search.
        let i = Math.round((s / Math.max(1e-4, leg.length)) * (leg.n - 1));
        if (i < 0) i = 0;
        else if (i > leg.n - 1) i = leg.n - 1;
        const dx = leg.X[i] - x;
        const dz = leg.Z[i] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= best) continue;
        best = d2;
        found = true;
        o.x = leg.X[i];
        o.z = leg.Z[i];
        o.yaw = leg.YAW[i];
        o.lead = lead;
        o.id = t.id;
      }
    }
    if (!found) return null;
    o.d = Math.sqrt(best);
    return o;
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
    // 9 resumes, not 4: with `PASS_TOP` at 3.0 and `CLIMB_TOP` at 2.6 a dressed
    // street can put far more passable mass in one probe's way than the old
    // ceiling ever could, and a probe that runs out of resumes UNDER-reports the
    // span — which trims a leg for a street the hull fits down.
    for (let iter = 0; iter < 9; iter++) {
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
    /**
     * A FREE-STANDING BLOCK ACCOUNTS FOR ITS OWN HEIGHT, and it is asked first
     * because it is one cell lookup and no raycast. This is the half of the
     * answer four ceiling passes could not reach: the 3.39 m pier on the
     * cathedral's parvis has no instance to bind to and is erasable anyway.
     * @see `_buildBlockAtlas`.
     */
    if (this._blockAt(x, z, top)) return true;
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
    /**
     * WHY, EVEN WHEN THERE IS NO PATH TO HANG IT ON. A leg that dies inside its
     * first four samples used to be reported as "no drivable route off the hub"
     * and nothing else, so the one failure a route author most needs to read —
     * WHICH pinch, and how wide — was the one the log threw away. @see
     * `_bakeLegs`, which prints it.
     */
    this._lastStop = `${stop} (${kept} samples kept)`;
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
    // `Y0` — the standing-cathedral measurement — is taken at the END of
    // `_bakeLegs`, after the hub join has written `Y[0]`. @see `_watchCathedral`.
    if (p.hub0 !== undefined) p.ROAD[0] = Math.min(p.ROAD[0], p.hub0);
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE RIDE WAS BAKED AGAINST A CHURCH THAT IS NO LONGER THERE
   * ────────────────────────────────────────────────────────────────────────
   * `MatchSystem` calls `_setCathedralRazed(false)` in its own constructor and
   * builds `Armour` two hundred lines later, so every leg on this map is
   * measured with the cathedral STANDING — and the collapse then drops rubble
   * mounds across the square the two approaches end in. `Y[i]`, and therefore
   * `ROAD[i]` and `STEP[i]`, know nothing about any of it: a hull crossing the
   * parvis after the strike rides the height of a road that is now under a
   * metre of masonry, which is a tank up to its axles in rubble it was never
   * told about. Raising `CLIMB_TOP` cannot help — the ride is not clamping,
   * it is measuring the wrong world.
   *
   * ONE BOOLEAN A FRAME, AND A RE-MEASURE ON THE EDGE. `world.cathedral.razed`
   * is the state both the raze and the round reset drive, so polling it costs a
   * property read and couples this file to nothing. When it flips, the legs
   * that pass within `RUIN_R` of the building are re-measured — one ground ray
   * per sample inside the radius, then `_bakeRide` again over the whole leg
   * because its road envelope is a +-20 m window. Coming back up is not a
   * re-measure at all: `Y0` is the boot measurement and is restored verbatim,
   * which is the same "store both states absolutely, never a delta" discipline
   * the mask writes in `_firePlough` are written to.
   *
   * WHAT IT DOES NOT DO, HONESTLY: it does not re-run `_bakePath`, so a leg is
   * neither re-trimmed nor re-slid. That is deliberate rather than unfinished —
   * a hull is usually STANDING ON the leg when the church comes down, and
   * shortening the road under a moving vehicle is worse than any rubble. The
   * ruin measures 2.76 m at its crest, which is inside the (CLIMB_TOP,
   * PASS_TOP] band the horizontal ray already settles, so the hull CLIMBS it —
   * 「戦車はもっと瓦礫を乗り越えていい」 — rather than needing the route moved.
   */
  _watchCathedral() {
    const world = this._world ?? (this._world = this.ctx.peek('world'));
    const razed = !!world?.cathedral?.razed;
    if (razed === this._cathRazed) return;
    const first = this._cathRazed === undefined;
    this._cathRazed = razed;
    if (first) return;
    const physics = this.physics;
    if (!physics || !world?.cathedral) return;
    const cx = world.cathedral.cx;
    const cz = world.cathedral.cz;
    let legs = 0;
    let moved = 0;
    let worst = 0;
    for (const tank of this.tanks) {
      for (const p of tank.legs) {
        let touches = false;
        for (let i = 0; i < p.n && !touches; i++) {
          if (Math.hypot(p.X[i] - cx, p.Z[i] - cz) < RUIN_R) touches = true;
        }
        if (!touches) continue;
        legs++;
        if (razed) {
          for (let i = 0; i < p.n; i++) {
            if (Math.hypot(p.X[i] - cx, p.Z[i] - cz) > RUIN_R) continue;
            const g = physics.groundHeight(p.X[i], p.Z[i], 40);
            if (!Number.isFinite(g)) continue;
            const d = Math.abs(g - p.Y[i]);
            if (d > 0.05) { moved++; if (d > worst) worst = d; }
            p.Y[i] = g;
          }
        } else {
          p.Y.set(p.Y0);
        }
        this._bakeRide(p, physics);
        // `_bakeRide` hands back a fresh `PILE`; the piles it belongs to have
        // not moved. @see `_bakePlough`, which owns this mapping.
        for (const pile of tank.plough ?? []) {
          if (tank.legs[pile.leg] !== p) continue;
          for (let i = 0; i < p.n; i++) {
            if (Math.abs(p.S[i] - pile.s) <= PLOUGH_MERGE) p.PILE[i] = pile.ix;
          }
        }
      }
    }
    if (legs) {
      console.info(
        `[tank] cathedral ${razed ? 'RAZED' : 'STANDING'} — re-measured the ride on ${legs} leg(s) ` +
          `within ${RUIN_R} m of it` +
          (razed ? `, ${moved} sample(s) moved, worst ${worst.toFixed(2)} m` : ' (restored from boot)')
      );
    }
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
      /**
       * ────────────────────────────────────────────────────────────────────
       * AND THE SPOKE IS AIMED AT THE CENTRE OF THE POINT, NOT AT ITS DOORSTEP
       * ────────────────────────────────────────────────────────────────────
       * Every spoke was scouted under the 16 m stand-off, so its authored last
       * point is where a hull was allowed to STOP rather than where the point
       * is: dropping `ZONE_ENTER` in without this trims nothing, because the
       * polyline never reaches the circle in the first place and the hull would
       * still be parked outside a zone it is now supposed to be capturing.
       *
       * The centre is appended as one more authored point and PROVED like every
       * other — `_bakePath` runs its own ground and span tests over the new
       * segment and stops the leg at the first pinch exactly as it always has,
       * and it can only ever ADD samples to the end. A spoke whose last few
       * metres are not drivable is therefore no shorter than it was before this
       * line existed, and one that is drivable now ends in the circle.
       */
      const lastP = wp[wp.length - 1];
      if (Math.hypot(lastP.x - target.x, lastP.z - target.z) > ZONE_ENTER) {
        wp.push(new THREE.Vector3(target.x, lastP.y, target.z));
      }
      const path = this._bakePath(wp, world, physics, props);
      if (!path) {
        console.warn(
          `[tank] ${spec.id}->${sp.zone}: SPOKE DROPPED — no drivable route off the hub: ` +
            `${this._lastStop ?? 'no reason recorded'}`
        );
        continue;
      }
      const why = path.stop;
      // Join it to the hub exactly: the slide may have moved sample 0 by metres.
      path.X[0] = hub.x; path.Z[0] = hub.z; path.Y[0] = hub.y;
      // Remembered, not just applied: `_watchCathedral` re-runs `_bakeRide` and
      // would otherwise recompute this sample off the polyline's own ground.
      path.hub0 = hub.y;
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
    /** The boot measurement, kept verbatim. @see `_watchCathedral`. */
    for (const p of legs) p.Y0 = Float32Array.from(p.Y);
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
      /**
       * A FREE-STANDING BLOCK IS ERASABLE, and this is the line the fifth
       * report turns on: the 3.39 m gate pier on the cathedral's parvis has no
       * `prop_*` instance for the sweep below to find, so it read as a wall
       * here and CUT BOTH HULLS' APPROACH 17 m SHORT of the square — which is
       * also the inconsistency the `PLOUGH_TOP` sweep recorded at 3.2 without
       * being able to name. @see `_buildBlockAtlas`.
       */
      let erasable = !!this._blockAt(p.X[i], p.Z[i], rise);
      if (!erasable && grid) {
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
   * Cut the path at the first sample inside the stand-off of ANY capture
   * centre — `ZONE_STANDOFF` for every zone except the one this leg was
   * authored AT, which gets `ZONE_ENTER` so the hull ends up INSIDE the circle
   * it is attacking and counts toward taking it. @see `ZONE_ENTER`, and
   * `captureBodies` for what it is worth once it is there.
   *
   * `target` null is the APPROACH, and the approach is excused nothing: the hub
   * is trimmed at the full stand-off off every zone including D, so the
   * cathedral's circle never has a hull standing in it whatever the wheel does.
   */
  _trimToStandoff(p, zones, target) {
    const cutTo = (k, why) => {
      p.n = Math.max(0, k);
      p.length = p.n > 0 ? p.S[p.n - 1] : 0;
      p.stop = why;
      p.trimmed = true;
    };

    /* ---- the point it is attacking: the leg ends INSIDE the circle ------ */
    if (target) {
      for (let i = 0; i < p.n; i++) {
        if (Math.hypot(p.X[i] - target.x, p.Z[i] - target.z) < ZONE_ENTER) {
          cutTo(i, `trimmed at the ${ZONE_ENTER.toFixed(1)} m entry on ${target.id}`);
          break;
        }
      }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * EVERY OTHER CIRCLE IS A RULE ABOUT WHERE A LEG MAY END, NOT WHERE IT MAY
     * PASS — 「スタックとかしないようにすることが優先」
     * ────────────────────────────────────────────────────────────────────────
     * THE OLD RULE CUT AT THE FIRST SAMPLE INSIDE ANY CIRCLE, and that is what
     * dropped spokes at boot: a corridor to A that clips sixteen metres past B
     * on its way there was cut AT B, came out under `MIN_ROUTE` or outside
     * `ZONE_ARRIVE`, and the whole destination was thrown away — so a hull
     * whose enemy held only that point had nowhere to go and stood in the
     * square, which is what the stuck reports look like from the player's seat.
     * The scout (`_hullpath.mjs`) has to route round five circles at once on a
     * map that only has so many streets, and on this one they are not all
     * avoidable.
     *
     * The guarantee those cuts were protecting is about a HULL STANDING on a
     * point it is not fighting for, and a hull only ever stands at the END of a
     * leg — `hold` is the only state that does not move. So the end is walked
     * BACK until it is clear of every non-target circle, and the middle of the
     * leg is left alone. A hull driving past B on its way to A is a tank in a
     * street; a hull parked on B is the thing that was never wanted. (It adds
     * nothing to B's capture bar in passing either — @see `captureBodies`,
     * which counts a hull only once it has arrived.)
     */
    for (let guard = p.n + 2; guard > 0 && p.n > 0; guard--) {
      const ex = p.X[p.n - 1];
      const ez = p.Z[p.n - 1];
      let bad = null;
      for (const z of zones) {
        if (target && z.id === target.id) continue;
        if (Math.hypot(ex - z.x, ez - z.z) < ZONE_STANDOFF) { bad = z; break; }
      }
      if (!bad) break;
      cutTo(p.n - 1, `end pulled back off ${bad.id}'s ${ZONE_STANDOFF} m stand-off`);
    }
  }

  _buildTank(spec, world, physics, props) {
    const rng = this.rng.fork();
    const legs = this._bakeLegs(spec, world, physics, props);
    if (!legs) {
      console.error(
        `[tank] ${spec.id}: no drivable route from the authored polyline — SORTIE DROPPED. ` +
          'The street is narrower than the hull or the anchor is not on the ground; ' +
          'fix this map\'s entry in `MAP_ROUTES` in src/match/tank.js.'
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
      /**
       * ────────────────────────────────────────────────────────────────────
       * …AND SO A MAN CANNOT WALK THROUGH IT — the rest of the `ai.vehicles`
       * contract. @see the `BODY_HALF_W` note for why a collision layer could
       * not do this and what the three rules are.
       * ────────────────────────────────────────────────────────────────────
       *   solid     it is on the field: a man may not stand inside it. TRUE
       *             FOR A WRECK TOO — `alive` means shootable and stops at the
       *             brew-up, but forty tonnes of dead steel is still forty
       *             tonnes of steel to walk into.
       *   crushing  it is under power. The only state in which a man who
       *             cannot be shoved clear is run over rather than let by.
       *   halfW/halfL/bodyLow/bodyHigh   the plan rectangle and the height
       *             band, in metres, around `position` and `yaw`. Published
       *             rather than assumed because `ai` may not know a hull's
       *             dimensions any more than it may know its local frame.
       */
      solid: false,
      crushing: false,
      halfW: BODY_HALF_W,
      halfL: BODY_HALF_L,
      bodyLow: BODY_LOW,
      bodyHigh: BODY_HIGH,
      /** Seconds the local player has been pinned. @see `_shovePlayer`. */
      playerPin: 0,
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
      /** Seconds it has been standing at a station with nothing to do. The
       *  restless test in `_drive` reads it; @see `RESTLESS`. */
      holdT: 0,
      /** The gun is laying on the man who just hit us. @see `_acquire`. */
      snap: false,
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
       * WHAT LANDED LAST — 'mine' | 'tank' | 'air' | 'frag' | 'blast' | 'round'.
       * `_destroy` classifies the kill off it, which is how "how many hulls did
       * the minefield take, how many did the other hulls take, how many
       * everything else" becomes a count rather than a guess. @see `this.kills`.
       */
      lastOrd: 'round',
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
        /** Anti-tank mines driven onto, and what they were worth. */
        mines: 0, mineDmg: 0,
        /** …and the other side's main-gun rounds. @see `tankMul`. */
        shells: 0, shellDmg: 0,
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
      // A triangle belongs to exactly one eraser. @see the `claimed` note above
      // — two owners means whichever restores second writes a zero back.
      if (this._blockTri?.[t]) continue;
      // It stands on nothing, so it is what everything else stands on. The
      // `riseY` test below is kept and is not enough on its own: `riseY` is the
      // road at the pile's CENTRE and the plain slopes through the box.
      // @see `_buildFloorMask`.
      if (this._floorTri?.[t]) continue;
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
      /**
       * ────────────────────────────────────────────────────────────────────
       * A CHUNK LANDS ON THE GROUND IT LANDS ON — 「空中に瓦礫が浮いてます」
       * ────────────────────────────────────────────────────────────────────
       * The settled height was `pile.y + sy`: the road under the PILE, for
       * every chunk, however far the shove threw it. That is right in a street
       * and wrong the moment a pile stands on anything with an edge — a kerb,
       * a plinth, a loading dock — because the outward throw is up to 2.6 m
       * and carries pieces past that edge, where they stop at the height of
       * the thing they came off.
       *
       * MEASURED with `_ploughsettle.mjs` (seed 7, all 70 piles, 3500 baked
       * chunk poses): two piles put 25 and 32 chunks between 1.5 m and 6.86 m
       * in the air. `_ploughfloat.mjs` passes and cannot see it — that gate
       * measures COLLISION and this debris is visual-only by design, so a
       * chunk hanging in the sky is invisible to the gate and perfectly
       * visible to the player, who has now raised floating rubble twice.
       *
       * One downward ray per chunk, at BOOT, at the point it will come to
       * rest. 3500 rays over the whole map next to the raze atlas's 213 358
       * triangle walk is not a cost worth trading a floating rock for.
       */
      const lx = posv.x + dir.x * r;
      const lz = posv.z + dir.z * r;
      let rest = pile.y;
      const g = this.physics?.groundHeight?.(lx, lz, 40);
      // Only ever DOWN to real ground: a ray that finds a roof over the
      // landing point must not lift the chunk onto it.
      if (Number.isFinite(g) && g < pile.y + 0.05) rest = g;
      off[i * 3] = dir.x * r;
      off[i * 3 + 1] = rest + sy - posv.y;
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
      // Claimed by a free-standing block already. @see `_buildBlockAtlas`, and
      // the `_ploughClaimed` note above for why one owner per triangle.
      if (this._blockTri?.[t]) continue;
      /**
       * IT IS THE GROUND THE PROP IS STANDING ON. This is the rise test the
       * plough always had and this atlas never did, and it is the whole of the
       * 「次元のはざま」 bug: the plain's terrain sheet is 1.0–1.5 m across, well
       * under `RAZE_TRI`, so every prop in the field bound the field under it
       * and a shell took it away. @see `_buildFloorMask`.
       */
      if (this._floorTri?.[t]) continue;
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
  _razeAt(x, y, z, r, up = RAZE_UP, dn = RAZE_UP) {
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
          // The vertical window is a parameter because the two callers mean
          // different things by "near": a shell reaches six metres either way,
          // and the glacis reaches only what is standing on the road it is on.
          if (dy > up || dy < -dn) continue;
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

  /* ====================================================================== */
  /* THE FLOOR: WHAT NO ERASER MAY TOUCH                                     */
  /* ====================================================================== */

  /**
   * ONE BIT PER STATIC TRIANGLE: is this the last thing between a man and the
   * void? @see the note over `FLOOR_UP` for why the rise tests it replaces
   * could not answer that on sloping ground.
   *
   * A triangle is FLOOR when it faces up enough to stand on AND there is no
   * other solid triangle beneath it. The ray starts `FLOOR_DROP` under its
   * LOWEST vertex, so the whole triangle is behind the origin and it cannot
   * answer with itself, and it asks the same BVH under the same mask the
   * character controller sweeps — `MASK.CHARACTER`, not `MASK.WORLD`, because a
   * dynamic collider is floor to `physics.raycast` and air to the player, which
   * is the second of the three ways `_nfhole.mjs` let this through.
   *
   * TWO DELIBERATE CONSERVATISMS, both of which keep collision rather than
   * remove it, which is the safe direction for a nav grid baked at boot:
   *
   *   A BOX RESTING ON THE GROUND has its underside flush with the ground, so
   *   the ray starts BELOW the ground and reports nothing. Its underside is
   *   therefore kept while its sides and top are taken — a face flush with the
   *   floor, which is not a wedge, not a step and not a wall.
   *
   *   MASS STACKED ON MASS is judged against the map as BUILT. If a prop stands
   *   on a prop, the upper one's floor is the lower one and it binds; both can
   *   then come off together. That is the airstrike's own staleness class, and
   *   `_floatcheck.mjs` is the gate for it.
   *
   * Triangles that are not in `MASK.CHARACTER` to begin with — the shoot-only
   * boxes, the clip volumes — are nobody's floor and are never marked.
   */
  _buildFloorMask(physics) {
    this._floorTri = null;
    const sw = physics?.staticWorld;
    const pos = sw?.pos;
    const n = sw?.triCount ?? 0;
    if (!pos || !n || !sw.mask) return;
    const t0 = performance.now();
    const CH = physics.MASK.CHARACTER;
    const floor = new Uint8Array(n);
    let marked = 0;
    let asked = 0;
    let rays = 0;
    for (let t = 0; t < n; t++) {
      if ((sw.mask[t] & CH) === 0) continue;
      const o = t * 9;
      const x0 = pos[o], y0 = pos[o + 1], z0 = pos[o + 2];
      const x1 = pos[o + 3], y1 = pos[o + 4], z1 = pos[o + 5];
      const x2 = pos[o + 6], y2 = pos[o + 7], z2 = pos[o + 8];
      // |ny| of the un-normalised cross product, against the triangle's own
      // area: the BVH does not promise a winding (8008 of the plain's dirt
      // triangles come back wound the other way) and a face that stands on
      // nothing is floor whichever side of it is up.
      const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
      const bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const L = Math.hypot(nx, ny, nz);
      if (!(L > 0) || Math.abs(ny) / L <= FLOOR_UP) continue;
      const lo = Math.min(y0, y1, y2) - FLOOR_DROP;
      let held = true;
      for (let s = 0; s < FLOOR_BARY.length; s++) {
        const w = FLOOR_BARY[s];
        rays++;
        if (sw.raycastAny(x0 * w[0] + x1 * w[1] + x2 * w[2], lo, z0 * w[0] + z1 * w[1] + z2 * w[2],
          0, -1, 0, FLOOR_REACH, CH)) continue;
        held = false;
        break;
      }
      asked++;
      if (held) continue;
      floor[t] = 1;
      marked++;
    }
    this._floorTri = floor;
    console.info(
      `[tank] floor mask: ${marked} of ${n} static triangles are unsupported somewhere over ` +
        `their own face and are unerasable (${asked} up-facing faces asked, ${rays} rays), ` +
        `in ${(performance.now() - t0).toFixed(0)}ms`
    );
  }

  /* ====================================================================== */
  /* THE BLOCK ATLAS: MERGED MASONRY THE HULL IS ALLOWED TO TAKE OFF         */
  /* ====================================================================== */

  /**
   * MEASURE THE MAP'S FREE-STANDING BLOCKS, AND BIND BOTH HALVES OF EACH ONE.
   * @see the long note over `BLOCK_TOP` for what this is answering and for the
   * census of what it takes and refuses on the built map.
   *
   * THREE PASSES, ALL AT BOOT, NOTHING SOLVED AFTERWARDS:
   *
   *  1. A HEIGHT FIELD over the whole map on `BLOCK_CELL`: one downward ray per
   *     cell, minus `world.groundHeight`, so every cell carries the height of
   *     the mass OVER THE ROAD rather than over sea level. ~150 ms at 1 m on a
   *     300 x 300 m map, once, and it is the only ray work here.
   *
   *  2. A FLOOD over the cells that hold mass, into islands, and the guards.
   *     An island is a block if it is `BLOCK_THIN`..`BLOCK_PLAN` across in BOTH
   *     plan axes, fills `BLOCK_FILL` of its own bounding box, tops out under
   *     `BLOCK_TOP` over the road, is ringed on every side by cells under
   *     `BLOCK_MIN`, and is not inside any `world.interiorVolumes` footprint.
   *
   *  3. THE BINDING, and it is the same rule `_bindPloughCollision` proved:
   *     THE WHOLE TRIANGLE HAS TO FIT inside the block's own measured box. A
   *     centroid test would take a slice out of anything that merely passes
   *     through, leave it drawn, and give the player a window he can shoot
   *     through and cannot see. Two sets come out of it —
   *
   *       the COLLISION triangles, out of the packed BVH array, zeroed in
   *         `sw.mask` at fire time exactly as a pile's are;
   *       the DRAWN triangles, out of `world.A.staticMeshes` — the merged
   *         batches themselves — collapsed to degenerate indices at fire time
   *         exactly as `Assembler.setScopeVisible` does it. A triangle whose
   *         three indices are the same vertex has zero area and is discarded
   *         before rasterisation in the forward draw, the depth prepass and all
   *         four shadow cascades, because they share the index buffer.
   *
   *     THAT SECOND SET IS THE WHOLE POINT. Zeroing only the collision would be
   *     a hull driving through masonry that is still standing behind it, which
   *     is the failure the note over `PLOUGH_TOP` refuses in as many words.
   *
   * NOTHING IS EVER ADDED. Collision is only removed, so a nav grid baked at
   * boot can only become more walkable than it was measured to be and
   * `stuckcheck` cannot regress on account of this. Every write is saved
   * ABSOLUTELY (never a delta) and the arrays are preallocated here, so `fire`
   * is a pair of fills and `reset()` is exact — @see the note in `_firePlough`
   * about the 1428 triangles that were not `LAYER.STATIC` to begin with.
   */
  _buildBlockAtlas(world, physics) {
    this._blocks = null;
    this._blockTri = null;
    const sw = physics?.staticWorld;
    const pos = sw?.pos;
    const nTri = sw?.triCount ?? 0;
    if (!pos || !nTri || !sw.mask || !world?.A?.staticMeshes) return;
    const t0 = performance.now();

    /* ---- 1. the height field --------------------------------------- */
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let t = 0; t < nTri; t++) {
      const o = t * 9;
      for (let v = 0; v < 3; v++) {
        const x = pos[o + v * 3];
        const z = pos[o + v * 3 + 2];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
    }
    // The ground sheet runs well past the playable map; the field does not.
    x0 = Math.max(x0, -160);
    x1 = Math.min(x1, 160);
    z0 = Math.max(z0, -160);
    z1 = Math.min(z1, 160);
    if (!(x1 > x0) || !(z1 > z0)) return;
    const nx = Math.ceil((x1 - x0) / BLOCK_CELL);
    const nz = Math.ceil((z1 - z0) / BLOCK_CELL);
    const H = new Float32Array(nx * nz);
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * BLOCK_CELL;
      for (let j = 0; j < nz; j++) {
        const z = z0 + (j + 0.5) * BLOCK_CELL;
        const road = world.groundHeight(x, z);
        const g = physics.groundHeight(x, z, 40);
        H[i * nz + j] = Number.isFinite(g) && Number.isFinite(road) ? g - road : 0;
      }
    }
    const fieldMs = performance.now() - t0;

    /* ---- 2. flood, and the guards ----------------------------------- */
    const owner = new Int32Array(nx * nz).fill(-1);
    const stack = [];
    const vols = world.interiorVolumes ?? [];
    const list = [];
    let isles = 0;
    for (let si = 0; si < nx; si++) {
      for (let sj = 0; sj < nz; sj++) {
        const sk = si * nz + sj;
        if (owner[sk] >= 0 || H[sk] <= BLOCK_MIN) continue;
        isles++;
        let i0 = si;
        let i1 = si;
        let j0 = sj;
        let j1 = sj;
        let cells = 0;
        let hi = 0;
        owner[sk] = isles;
        stack.length = 0;
        stack.push(sk);
        while (stack.length) {
          const c = stack.pop();
          const ci = (c / nz) | 0;
          const cj = c % nz;
          cells++;
          if (ci < i0) i0 = ci;
          if (ci > i1) i1 = ci;
          if (cj < j0) j0 = cj;
          if (cj > j1) j1 = cj;
          if (H[c] > hi) hi = H[c];
          for (let d = 0; d < 4; d++) {
            const ni = ci + (d === 0 ? 1 : d === 1 ? -1 : 0);
            const nj = cj + (d === 2 ? 1 : d === 3 ? -1 : 0);
            if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
            const nk = ni * nz + nj;
            if (owner[nk] >= 0 || H[nk] <= BLOCK_MIN) continue;
            owner[nk] = isles;
            stack.push(nk);
          }
        }
        const wpl = (i1 - i0 + 1) * BLOCK_CELL;
        const dpl = (j1 - j0 + 1) * BLOCK_CELL;
        if (wpl > BLOCK_PLAN || dpl > BLOCK_PLAN) continue;
        if (wpl < BLOCK_THIN || dpl < BLOCK_THIN) continue;
        if (hi > BLOCK_TOP) continue;
        if (cells / ((i1 - i0 + 1) * (j1 - j0 + 1)) < BLOCK_FILL) continue;
        // …and one cell of clear road all the way round it.
        let ring = 0;
        for (let i = i0 - 1; i <= i1 + 1 && ring <= BLOCK_MIN; i++) {
          for (let j = j0 - 1; j <= j1 + 1; j++) {
            if (i > i0 - 1 && i < i1 + 1 && j > j0 - 1 && j < j1 + 1) continue;
            if (i < 0 || j < 0 || i >= nx || j >= nz) { ring = 99; break; }
            const h = H[i * nz + j];
            if (h > ring) ring = h;
          }
        }
        if (ring > BLOCK_MIN) continue;
        const cx = x0 + ((i0 + i1 + 1) / 2) * BLOCK_CELL;
        const cz = z0 + ((j0 + j1 + 1) / 2) * BLOCK_CELL;
        let inside = false;
        for (const v of vols) {
          const dx = cx - v.cx;
          const dz = cz - v.cz;
          const u = dx * v.c + dz * v.s;
          const t = -dx * v.s + dz * v.c;
          if (Math.abs(u) < v.hw + 1.6 && Math.abs(t) < v.hd + 1.6) { inside = true; break; }
        }
        if (inside) continue;
        const road = Number.isFinite(world.groundHeight(cx, cz)) ? world.groundHeight(cx, cz) : 0;
        list.push({
          ix: list.length,
          x: cx, z: cz, y: road, top: hi,
          /**
           * THE CORE BOX is the flood's own cells, and it is NOT the block.
           * A cell only holds mass if its CENTRE does, and the map is authored
           * in level space and placed at a 33.7° yaw — so the cathedral's
           * 3.6 x 3.6 m pier is a rotated box 4.99 m across in world x, which
           * a 1 m lattice reports as four cells. Binding against the core box
           * took SIX of its twelve collision triangles and left the top face
           * standing: a hole in an object is worse than an object.
           *
           * So the box is GROWN off the mass itself below (@see the growth
           * pass), out of the core box by at most `BLOCK_GROW` — which is what
           * makes the bound set the WHOLE object rather than the part of it a
           * lattice happened to sample.
           */
          minX: cx - wpl / 2, maxX: cx + wpl / 2,
          minZ: cz - dpl / 2, maxZ: cz + dpl / 2,
          capX0: cx - wpl / 2 - BLOCK_GROW, capX1: cx + wpl / 2 + BLOCK_GROW,
          capZ0: cz - dpl / 2 - BLOCK_GROW, capZ1: cz + dpl / 2 + BLOCK_GROW,
          minY: road - 0.8,
          maxY: road + hi + 0.7,
          tris: null, trisWas: null, draws: null, fired: false,
        });
      }
    }
    if (!list.length) return;

    /**
     * ---- 3a. the lookup grid -----------------------------------------
     * Registered over the CAP box — the widest any box below can become —
     * so a centroid lookup is a sound test for containment in every pass:
     * a triangle that fits inside a block's box necessarily has its centroid
     * inside it, and therefore inside a cell the block is registered in.
     */
    const lookup = new Map();
    const keyOf = (cx, cz) => cx * 65536 + cz;
    for (const b of list) {
      for (let cx = Math.floor((b.capX0 - BLOCK_PAD) / BLOCK_LOOKUP); cx <= Math.floor((b.capX1 + BLOCK_PAD) / BLOCK_LOOKUP); cx++) {
        for (let cz = Math.floor((b.capZ0 - BLOCK_PAD) / BLOCK_LOOKUP); cz <= Math.floor((b.capZ1 + BLOCK_PAD) / BLOCK_LOOKUP); cz++) {
          const k = keyOf(cx, cz);
          let c = lookup.get(k);
          if (!c) lookup.set(k, (c = []));
          c.push(b);
        }
      }
    }

    /**
     * ---- 3b. GROW EACH BOX OFF THE MASS ITSELF ------------------------
     * Every piece of masonry that stands clear of the road and fits ENTIRELY
     * inside the block's cap box is part of the block, and the box opens to
     * hold it. Two properties make this safe rather than a creeping claim:
     *
     *   IT CANNOT REACH PAST `BLOCK_GROW`. The cap is fixed before any
     *   triangle is looked at, so an object 2 m away cannot pull the box onto
     *   itself — it does not fit inside the cap and is never considered.
     *
     *   IT IGNORES THE ROAD. `> y + 0.25` is what keeps the cathedral's 32.6 m
     *   parvis strip and the ground sheet out of the union; without it the
     *   first slab under a block would open the box to the whole square.
     */
    for (let t = 0; t < nTri; t++) {
      const o = t * 9;
      const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
      const bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5];
      const gx = pos[o + 6], gy = pos[o + 7], gz = pos[o + 8];
      const xlo = Math.min(ax, bx, gx), xhi = Math.max(ax, bx, gx);
      if (xhi - xlo > BLOCK_SPAN) continue;
      const zlo = Math.min(az, bz, gz), zhi = Math.max(az, bz, gz);
      if (zhi - zlo > BLOCK_SPAN) continue;
      const bin = lookup.get(keyOf(
        Math.floor(((xlo + xhi) * 0.5) / BLOCK_LOOKUP),
        Math.floor(((zlo + zhi) * 0.5) / BLOCK_LOOKUP)
      ));
      if (!bin) continue;
      const ylo = Math.min(ay, by, gy), yhi = Math.max(ay, by, gy);
      for (let i = 0; i < bin.length; i++) {
        const b = bin[i];
        if (xlo < b.capX0 || xhi > b.capX1) continue;
        if (zlo < b.capZ0 || zhi > b.capZ1) continue;
        if (ylo < b.minY || yhi > b.maxY) continue;
        if (yhi <= b.y + 0.25) continue;
        if (xlo < b.minX) b.minX = xlo;
        if (xhi > b.maxX) b.maxX = xhi;
        if (zlo < b.minZ) b.minZ = zlo;
        if (zhi > b.maxZ) b.maxZ = zhi;
        break;
      }
    }
    // The drawn skin — coping lips, capping bands, spall — stands a little
    // proud of the collision box it was authored round.
    for (const b of list) {
      b.minX -= BLOCK_PAD; b.maxX += BLOCK_PAD;
      b.minZ -= BLOCK_PAD; b.maxZ += BLOCK_PAD;
    }

    /* ---- 3c. the collision triangles ---------------------------------- */
    const mark = new Uint8Array(nTri);
    const cTris = list.map(() => []);
    for (let t = 0; t < nTri; t++) {
      const o = t * 9;
      const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
      const bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5];
      const gx = pos[o + 6], gy = pos[o + 7], gz = pos[o + 8];
      const xlo = Math.min(ax, bx, gx), xhi = Math.max(ax, bx, gx);
      const zlo = Math.min(az, bz, gz), zhi = Math.max(az, bz, gz);
      const bin = lookup.get(keyOf(
        Math.floor(((xlo + xhi) * 0.5) / BLOCK_LOOKUP),
        Math.floor(((zlo + zhi) * 0.5) / BLOCK_LOOKUP)
      ));
      if (!bin) continue;
      const ylo = Math.min(ay, by, gy), yhi = Math.max(ay, by, gy);
      for (let i = 0; i < bin.length; i++) {
        const b = bin[i];
        if (xlo < b.minX || xhi > b.maxX) continue;
        if (zlo < b.minZ || zhi > b.maxZ) continue;
        if (ylo < b.minY || yhi > b.maxY) continue;
        // It lies flat on the carriageway: it IS the road, not the block, and
        // a hole in the road is how men fall out of the level. `b.y` is the
        // road at the block's CENTRE, which is one datum for a box the plain
        // slopes through, so the geometric test stands beside it rather than
        // instead of it. @see `_buildFloorMask`.
        if (yhi <= b.y + 0.12) continue;
        if (this._floorTri?.[t]) continue;
        cTris[b.ix].push(t);
        mark[t] = 1;
        break;
      }
    }

    /* ---- 3d. the drawn triangles, out of the merged batches ---------- */
    let drawn = 0;
    for (const b of list) b.draws = [];
    for (const mesh of world.A.staticMeshes.values()) {
      const geo = mesh?.geometry;
      const index = geo?.index;
      const pAttr = geo?.getAttribute?.('position');
      if (!index || !pAttr) continue;
      const idx = index.array;
      const vp = pAttr.array;
      const tris = idx.length / 3;
      /** block ix -> the index-array offsets of its triangles in this mesh. */
      let hits = null;
      for (let t = 0; t < tris; t++) {
        const o = t * 3;
        const i0 = idx[o] * 3;
        const i1 = idx[o + 1] * 3;
        const i2 = idx[o + 2] * 3;
        const ax = vp[i0], bx = vp[i1], gx = vp[i2];
        const xlo = Math.min(ax, bx, gx);
        const xhi = Math.max(ax, bx, gx);
        const az = vp[i0 + 2], bz = vp[i1 + 2], gz = vp[i2 + 2];
        const zlo = Math.min(az, bz, gz);
        const zhi = Math.max(az, bz, gz);
        const bin = lookup.get(keyOf(
          Math.floor(((xlo + xhi) * 0.5) / BLOCK_LOOKUP),
          Math.floor(((zlo + zhi) * 0.5) / BLOCK_LOOKUP)
        ));
        if (!bin) continue;
        const ay = vp[i0 + 1], by = vp[i1 + 1], gy = vp[i2 + 1];
        const ylo = Math.min(ay, by, gy);
        const yhi = Math.max(ay, by, gy);
        for (let i = 0; i < bin.length; i++) {
          const b = bin[i];
          if (xlo < b.minX || xhi > b.maxX) continue;
          if (zlo < b.minZ || zhi > b.maxZ) continue;
          if (ylo < b.minY || yhi > b.maxY) continue;
          // It lies flat on the carriageway: it IS the road, not the block.
          if (yhi <= b.y + 0.12) continue;
          if (!hits) hits = new Map();
          let l = hits.get(b.ix);
          if (!l) hits.set(b.ix, (l = []));
          l.push(o);
          drawn++;
          break;
        }
      }
      if (!hits) continue;
      for (const [ix, offs] of hits) {
        list[ix].draws.push({
          index, arr: idx, off: Int32Array.from(offs),
          was: new idx.constructor(offs.length * 3),
          lo: offs[0], hi: offs[offs.length - 1] + 3,
        });
      }
    }

    /* ---- preallocate every saved buffer, so firing allocates nothing -- */
    let kept = 0;
    let cTot = 0;
    for (const b of list) {
      b.tris = Int32Array.from(cTris[b.ix]);
      b.trisWas = new sw.mask.constructor(b.tris.length);
      cTot += b.tris.length;
      if (b.tris.length || b.draws.length) kept++;
    }
    this._blocks = { list, lookup, keyOf, fired: [] };
    this._blockTri = mark;
    console.info(
      `[tank] block atlas: ${isles} islands of mass -> ${list.length} free-standing blocks ` +
        `(${kept} bound: ${cTot} collision triangles, ${drawn} drawn triangles), ` +
        `field ${nx}x${nz} in ${fieldMs.toFixed(0)}ms, total ${(performance.now() - t0).toFixed(0)}ms`
    );
  }

  /**
   * IS THERE A BLOCK AT THIS POINT THAT ACCOUNTS FOR `top` METRES OF MASS? One
   * cell lookup and a box test — the question `_ploughableAt` and
   * `_trimAtBlockers` ask before a route is committed. `top` is measured over
   * the road, the same way the atlas measured the block.
   */
  _blockAt(x, z, top) {
    const a = this._blocks;
    if (!a) return null;
    const bin = a.lookup.get(a.keyOf(Math.floor(x / BLOCK_LOOKUP), Math.floor(z / BLOCK_LOOKUP)));
    if (!bin) return null;
    for (let i = 0; i < bin.length; i++) {
      const b = bin[i];
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (top > b.top + 0.5) continue;
      return b;
    }
    return null;
  }

  /**
   * A HULL OR A SHELL REACHED ONE. Every free-standing block whose measured box
   * is inside `r` of the point stops being drawn and stops being solid, in one
   * pass over the cells the contact touches — no search and no allocation.
   */
  _breakBlocksAt(x, y, z, r) {
    const a = this._blocks;
    if (!a) return 0;
    const sw = this.physics?.staticWorld;
    const c0 = Math.floor((x - r) / BLOCK_LOOKUP);
    const c1 = Math.floor((x + r) / BLOCK_LOOKUP);
    const d0 = Math.floor((z - r) / BLOCK_LOOKUP);
    const d1 = Math.floor((z + r) / BLOCK_LOOKUP);
    let n = 0;
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = d0; cz <= d1; cz++) {
        const bin = a.lookup.get(a.keyOf(cx, cz));
        if (!bin) continue;
        for (let i = 0; i < bin.length; i++) {
          const b = bin[i];
          if (b.fired) continue;
          // Nearest point of the block's own box, not its centre: a glacis that
          // has driven into the face of a 3.6 m pier is 1.8 m from its middle.
          const dx = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0;
          const dz = z < b.minZ ? b.minZ - z : z > b.maxZ ? z - b.maxZ : 0;
          if (dx * dx + dz * dz > r * r) continue;
          if (y > b.maxY + 3.0 || y < b.minY - 3.0) continue;
          this._eraseBlock(b, sw);
          /**
           * AND WHATEVER WAS STANDING ON IT GOES WITH IT. `_contact` razes
           * `RAZE_UP` 2.6 m over the HULL, which does not reach the top of a
           * 3.4 m pier — so a prop resting up there would be left hanging in
           * the air over ground the block used to occupy, which is the
           * 「浮いてる瓦礫」 this project has shipped three times. Its own
           * footprint, its own height, plus a metre.
           */
          this._razeAt(
            (b.minX + b.maxX) * 0.5, b.y, (b.minZ + b.maxZ) * 0.5,
            Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5 + 0.4,
            b.top + 1.5, 1.0
          );
          a.fired.push(b);
          n++;
        }
      }
    }
    return n;
  }

  /** The primitive: degenerate indices over what it drew, zeroes over what it
   *  stopped. Both saved ABSOLUTELY — @see the note in `_firePlough`. */
  _eraseBlock(b, sw) {
    b.fired = true;
    for (let d = 0; d < b.draws.length; d++) {
      const rec = b.draws[d];
      const arr = rec.arr;
      const off = rec.off;
      for (let i = 0; i < off.length; i++) {
        const o = off[i];
        rec.was[i * 3] = arr[o];
        rec.was[i * 3 + 1] = arr[o + 1];
        rec.was[i * 3 + 2] = arr[o + 2];
        arr[o + 1] = arr[o];
        arr[o + 2] = arr[o];
      }
      rec.index.addUpdateRange(rec.lo, rec.hi - rec.lo);
      rec.index.needsUpdate = true;
    }
    if (sw?.mask && b.tris) {
      for (let i = 0; i < b.tris.length; i++) {
        b.trisWas[i] = sw.mask[b.tris[i]];
        sw.mask[b.tris[i]] = 0;
      }
    }
  }

  /** Put every block back up before the next round. */
  _restoreBlocks() {
    const a = this._blocks;
    if (!a?.fired.length) return;
    const sw = this.physics?.staticWorld;
    for (const b of a.fired) {
      for (let d = 0; d < b.draws.length; d++) {
        const rec = b.draws[d];
        const arr = rec.arr;
        const off = rec.off;
        for (let i = 0; i < off.length; i++) {
          const o = off[i];
          arr[o] = rec.was[i * 3];
          arr[o + 1] = rec.was[i * 3 + 1];
          arr[o + 2] = rec.was[i * 3 + 2];
        }
        rec.index.addUpdateRange(rec.lo, rec.hi - rec.lo);
        rec.index.needsUpdate = true;
      }
      if (sw?.mask && b.tris) {
        for (let i = 0; i < b.tris.length; i++) sw.mask[b.tris[i]] = b.trisWas[i];
      }
      b.fired = false;
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
   * THEY ARE NOT WHAT STOPS A MAN, and adding a layer bit here would not make
   * them: a `physics.addCollider` collider is only ever consulted by a RAY.
   * @see the `BODY_HALF_W` note for what is solid and where it is resolved.
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

  /**
   * THE NEXT WAVE — one parked hull per side, in table order. @see the note on
   * `WRECK_HOLD` for why a sortie is a wave rather than the whole pool.
   *
   * Returns a REUSED array (at most one entry per team, so at most two), and it
   * is read at `call()` time and again when the telegraph expires. Nothing can
   * change a hull's state in between — `_roll` is the only thing that takes a
   * tank out of `parked` and it is the thing being scheduled — so the two reads
   * agree by construction. That matters: `call()` writes each rolling hull's
   * position back to the head of its route for the telegraph, and doing that to
   * a hull already in the street would teleport it.
   */
  _wave() {
    const out = this._waveBuf;
    out.length = 0;
    for (const t of this.tanks) {
      if (t.state !== 'parked') continue;
      let taken = false;
      for (let i = 0; i < out.length; i++) if (out[i].team === t.team) { taken = true; break; }
      if (!taken) out.push(t);
    }
    return out;
  }

  /**
   * A WRECK GOES BACK IN ITS POCKET so its hull can be re-issued — and only a
   * wreck, and only one that has finished burning. @see `WRECK_HOLD`.
   */
  _recycle() {
    let any = false;
    for (const t of this.tanks) {
      if (t.state !== 'dead') continue;
      if (t.uniforms.uT.value < WRECK_HOLD) continue;
      this._park(t);
      any = true;
    }
    return any;
  }

  /** The telegraphed launch. */
  call() {
    if (!this.ready || this._pending >= 0) return false;
    const wave = this._wave();
    if (!wave.length) return false;
    this._pending = TANK_LEAD;
    this._announce(this.onAnnounce, wave[0]);
    if (this._audio ?? (this._audio = this.ctx.peek('audio'))) {
      for (const t of wave) {
        this._v.copy(t.position.set(t.legs[0].X[0], t.legs[0].Y[0] + 1.2, t.legs[0].Z[0]));
        this._audio.play?.('strike_jet', this._v, {
          level: 0.5, dur: TANK_LEAD, maxDist: 200, gain: 1.5, occlusion: 0.4,
        });
      }
    }
    this._emit('inbound', wave[0]);
    return true;
  }

  /**
   * ROLL NOW, NO TELEGRAPH — EVERY tank that is not already out, and it stays
   * the whole pool on purpose. This is the hand-fire hook the probes use
   * (`_tankmatch.mjs`, `_tanklife.mjs`) and a screenshot needs armour on the map
   * on a known frame; a probe that fires once and measures six hulls has to keep
   * measuring six. The SCHEDULED sortie is `_rollWave`.
   */
  fire() {
    if (!this.ready) return false;
    let any = false;
    for (const t of this.tanks) any = this._roll(t) || any;
    if (any) console.info(`[tank] SORTIE at t=${this.ctx.time.elapsed.toFixed(1)}s — ${this.tanks.map((t) => t.id).join(' + ')}`);
    return any;
  }

  /** The scheduled sortie: this wave and no more. @see `_wave`. */
  _rollWave() {
    const wave = this._wave();
    let any = false;
    const ids = [];
    for (const t of wave) if (this._roll(t)) { any = true; ids.push(t.id); }
    if (any) console.info(`[tank] SORTIE ${this._sorties}/${RULES.tankMaxPerMatch} at t=${this.ctx.time.elapsed.toFixed(1)}s — ${ids.join(' + ')}`);
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
    // It is a solid to people from the moment it leaves its pocket, and it
    // stays one as a wreck. @see the `BODY_HALF_W` note.
    tank.solid = true;
    tank.crushing = true;
    tank.playerPin = 0;
    tank.hold = HOLD_TIME;
    tank.holdT = 0;
    tank.target = null;
    tank.snap = false;
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

    this._watchCathedral();

    if (this._pending >= 0) {
      this._pending -= dt;
      // THE WAVE, not the pool — `fire()` is the hand-fire hook. @see `_wave`.
      if (this._pending < 0) this._rollWave();
    }

    for (const tank of this.tanks) {
      if (tank.state === 'parked') continue;
      if (tank.state === 'dead') {
        tank.uniforms.uT.value += dt;
        if (tank.uniforms.uT.value > 30) {
          // The wreck stays; the clock stops so the shader's clamp is settled.
          tank.uniforms.uT.value = 30;
        }
        // A wreck is still steel. It cannot run anybody over (`crushing` was
        // cleared in `_destroy`), so a man it cannot shove is let by.
        this._shovePlayer(tank, dt);
        continue;
      }
      tank.stats.liveT += dt;
      this._drive(tank, dt);
      this._fight(tank, dt);
      this._pose(tank);
      /**
       * …AND WHAT IS UNDER THE TRACKS — 「戦車が通ったら爆発」.
       *
       * AFTER `_pose`, because `_pose` is what writes `tank.position` for this
       * frame and a plate tested against last frame's centre is a plate the
       * hull drives 76 mm past at `SPEED_ADVANCE`. One call per live hull per
       * frame; the whole cost is in `ThrownGrenades.armourFootprint`, which
       * short-circuits on an integer when no mine is armed. It is deliberately
       * NOT gated on `state === 'advance'`: a mine emplaced under a hull that
       * has arrived and is standing on a capture point is a mine that has to
       * work, or the counter to armour is "wait for it to stop".
       */
      this._checkMines(tank);
      // Under power in `advance`; standing on its point in `hold`. Only the
      // first runs a man over. @see the `BODY_HALF_W` note.
      tank.crushing = tank.state === 'advance';
      this._shovePlayer(tank, dt);
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

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * HOW A MINE IS FOUND BY A HULL
   * ══════════════════════════════════════════════════════════════════════════
   * The hull publishes its own footprint and `weapons` answers. It is that way
   * round on purpose: the mine is `src/weapons`' object and this file may not
   * hold a list of them, while the hull's plan rectangle is this file's and is
   * already published (`halfW`/`halfL`, for `ai`'s `_clearHulls` and for
   * `_shovePlayer`). So nothing crosses the boundary but six numbers.
   *
   * WHAT IT COSTS, per frame, for the whole map: one `peek` (cached after the
   * first call, exactly as `_fx`, `_audio` and `_player` are), then one call
   * per LIVE hull — at most six on NACHTFELD, at most two on the town. Inside
   * that call it is an integer compare when nothing is armed, and otherwise a
   * dozen flops per armed mine. Six hulls x twenty mines is ~1.4 k flops, no
   * allocation, no ray, no broad phase. @see `ThrownGrenades.armourFootprint`,
   * which counts the pairs into `stats.probes` so this is measured.
   *
   * A WRECK DOES NOT SET ONE OFF. This is called only for a hull that is alive
   * and out of `dead`/`parked` — the `continue`s above see to that — because a
   * knocked-out hull sitting on a plate for the rest of the round would clear
   * the ground it died on for the other side.
   */
  _checkMines(tank) {
    const w = this._weapons ?? (this._weapons = this.ctx.peek('weapons'));
    if (!w?.armourFootprint) return;
    w.armourFootprint(
      tank.team,
      tank.position.x,
      tank.position.z,
      Math.sin(tank.yaw),
      Math.cos(tank.yaw),
      tank.halfW,
      tank.halfL
    );
  }

  _scheduleNext() {
    // `_ignoreCoBusy` is the cathedral's own sortie coming in through the dust.
    // @see `armAfter`.
    //
    // THE GUARD IS THE TELEGRAPH, NOT `busy`. `busy` is "something of ours is on
    // the map", and since `hold` became terminal that is true for the rest of
    // the round after the first sortie — which is the whole reason there was
    // only ever one. What may not overlap is two LAUNCHES. @see `WRECK_HOLD`.
    if (this._pending >= 0 || (this._coBusy && !this._ignoreCoBusy)) {
      this._next = 6;
      return;
    }
    if (this._sorties >= RULES.tankMaxPerMatch) {
      this._next = Infinity;
      return;
    }
    /**
     * A HULL TO GIVE IT. The pool first; failing that a wreck that has finished
     * burning. If neither, ask again shortly rather than standing down for the
     * round — a hull knocked out in the next minute is the next sortie's hull,
     * and `_sorties` is not spent here so nothing is lost by waiting.
     */
    if (!this._wave().length && !this._recycle()) {
      this._next = WRECK_POLL;
      return;
    }
    if (!this.call()) {
      this._next = WRECK_POLL;
      return;
    }
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
  /**
   * ────────────────────────────────────────────────────────────────────────
   * …AND WITH THREE HULLS A SIDE, "WHICH POINT" HAS TO BE A DIFFERENT ANSWER
   * FOR EACH OF THEM — 「戦車を３台ずつ出したり」
   * ────────────────────────────────────────────────────────────────────────
   * The rule above is a pure function of the map's state and this wheel's leg
   * lengths, so THREE HULLS OF ONE SIDE ANSWER IT IDENTICALLY. On the town that
   * could never show: one hull a side, and the two are on opposite teams. On
   * NACHTFELD it is three tanks driving at one circle, all three stopping
   * inside `ZONE_ENTER` of the same centre, and — because `captureBodies` is
   * worth `CAPTURE_BODIES` men each — three hulls' worth of capture arriving on
   * one point while four others go uncontested.
   *
   * So a destination is CLAIMED. A zone another living hull of this team is
   * already going to is skipped, unless skipping it would leave this hull with
   * nothing at all to want — in which case two hulls on one point is still
   * better than one hull standing still, which is the failure `_wantFallback`
   * exists to prevent and the single most-reported defect in this file's
   * history.
   *
   * IT IS A NO-OP WHEREVER EACH SIDE HAS ONE HULL: the loop can only match a
   * DIFFERENT tank of the SAME team, and the town has none.
   */
  _claimedBySide(tank, zoneId) {
    for (const o of this.tanks) {
      if (o === tank || o.team !== tank.team) continue;
      if (!o.alive || o.state === 'parked' || o.state === 'dead') continue;
      if (o.targetZone === zoneId) return true;
    }
    return false;
  }

  _wantZone(tank) {
    const m = this.ctx.peek('match');
    const zones = m?.allZones;
    if (!zones?.length) return null;
    let best = null;
    let bestRank = 9;
    let bestLen = Infinity;
    /** Second best, ignoring the claim — the fallback if every point is taken. */
    let any = null;
    let anyRank = 9;
    let anyLen = Infinity;
    for (let i = 1; i < tank.legs.length; i++) {
      const leg = tank.legs[i];
      const z = zones.find((q) => q.id === leg.zone);
      if (!z || z.locked) continue;
      if (z.owner === tank.team) continue;
      // 0 = the enemy holds it, 1 = nobody does.
      const rank = z.owner === -1 ? 1 : 0;
      if (rank < anyRank || (rank === anyRank && leg.length < anyLen)) {
        anyRank = rank;
        anyLen = leg.length;
        any = leg.zone;
      }
      if (this._claimedBySide(tank, leg.zone)) continue;
      if (rank > bestRank) continue;
      if (rank === bestRank && leg.length >= bestLen) continue;
      bestRank = rank;
      bestLen = leg.length;
      best = leg.zone;
    }
    return best ?? any;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * …AND WHAT TO DO WHEN THE ANSWER IS "NOTHING" — the other half of never
   * being stuck
   * ────────────────────────────────────────────────────────────────────────
   * `_wantZone` only ever names a point THIS WHEEL HAS A SPOKE TO, and there
   * are three ordinary ways for it to come back null: our side holds every
   * point we can drive to, the only enemy point had its spoke dropped at boot,
   * or the map is between captures. In every one of them the old code left
   * `targetZone` where it was and the hull stood still for the rest of the
   * match. THAT is what the stuck reports are looking at.
   *
   * So a hull with nothing to want goes to the station NEAREST THE FIGHT — the
   * end of whichever leg finishes closest to the nearest point the enemy holds
   * or nobody does, INCLUDING points this wheel has no spoke to, because
   * "twenty metres nearer the fight down a street I can actually drive" is a
   * real answer to "I cannot get there". If even that is where it already is,
   * `restless` drops the current leg from the running and it takes the next
   * best one instead, which is the difference between a hull that has arrived
   * and a hull that has stopped.
   */
  _wantFallback(tank, restless) {
    if (tank.legs.length < 2) return null;
    const m = this.ctx.peek('match');
    const zones = m?.allZones;
    let goal = null;
    let goalD = Infinity;
    for (const z of zones ?? []) {
      if (z.locked || z.owner === tank.team || !z.position) continue;
      const d = Math.hypot(z.position.x - tank.position.x, z.position.z - tank.position.z);
      if (d < goalD) { goalD = d; goal = z; }
    }
    let best = null;
    let bestD = Infinity;
    for (let i = 1; i < tank.legs.length; i++) {
      if (restless && i === tank.legIx) continue;
      const leg = tank.legs[i];
      if (!leg.n) continue;
      const ex = leg.X[leg.n - 1];
      const ez = leg.Z[leg.n - 1];
      // No enemy point anywhere: the wheel is walked in order instead, so the
      // hull is still a tank moving through a town rather than a monument.
      const d = goal
        ? Math.hypot(ex - goal.position.x, ez - goal.position.z)
        : (i - tank.legIx + tank.legs.length) % tank.legs.length;
      if (d < bestD) { bestD = d; best = leg.zone; }
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
    tank.holdT = 0;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * 「家や壁は破壊できるようにして」 — WHAT THE HULL ITSELF TAKES OFF THE MAP
   * ────────────────────────────────────────────────────────────────────────
   * Two erasures, on one clock, at the hull's own nose. Neither is new
   * machinery — both are the primitives this file already owns, moved off the
   * baked corridor and onto the vehicle:
   *
   *   THE BREACH. `world.damageAt` is the cache houses' own entry point and the
   *   shell has always fired it (@see `_mainGun`) — but a shell goes where a
   *   TARGET is, and a baseline match measured every breachable wall on the map
   *   still standing at the whistle. There are now TEN breachable elevations,
   *   the reach is 3.4 m, and a hull passes inside that of several of them, so
   *   the nose knocks: a wall inside the glacis's sweep comes open ON CONTACT.
   *   THREE points rather than one — the nose and both front corners — because
   *   a hull driving ALONG a house front never puts its centreline within reach
   *   of the wall beside it, which is most of how a tank meets a house.
   *
   *   THE CONTACT RAZE. The plough can only ever flatten piles BAKED ON THE
   *   CORRIDOR at boot, so anything the route bake did not classify — dressing
   *   the hull meets after a slide, a pile the other hull claimed, a lamp post
   *   the corridor sweep's radius missed — survived being driven through by a
   *   40 t vehicle. `_razeAt` is the same erase over the WHOLE-MAP atlas the
   *   gun already uses, so the glacis now takes what it touches whether or not
   *   anybody predicted it at boot. Collision is only ever REMOVED, so a nav
   *   grid baked at boot can only become more walkable and `stuckcheck` cannot
   *   regress on account of it.
   *
   * IT RUNS IN EVERY STATE, not only in `advance`. A hull that has arrived
   * beside a house and stopped used to stop knocking, which is exactly the
   * moment a player walks up and asks why the wall is still there.
   */
  _contact(tank, dt) {
    tank.breachIn -= dt;
    if (tank.breachIn > 0) return;
    tank.breachIn = BREACH_EVERY;
    const world = this._world ?? (this._world = this.ctx.peek('world'));
    const s = Math.sin(tank.yaw);
    const c = Math.cos(tank.yaw);
    const at = this._v;
    for (let k = -1; k <= 1; k++) {
      const lat = k * PLOUGH_HALF;
      at.set(
        tank.position.x + s * PLOUGH_NOSE + c * lat,
        tank.position.y + 1.0,
        tank.position.z + c * PLOUGH_NOSE - s * lat
      );
      const razed = this._razeAt(at.x, tank.position.y, at.z, CONTACT_RAZE_R, 2.6, 1.2);
      if (razed) {
        tank.stats.razed += razed;
        tank.ploughDrag = PLOUGH_DRAG;
        const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
        fx?.dust?.(at.x, tank.position.y + 0.5, at.z, 1.8);
      }
      /**
       * …AND THE MASONRY OBJECT GOES WITH IT — 「破壊可能なオブジェは破壊せよ」.
       * The three erasers on this clock now cover the three kinds of mass a
       * hull actually meets: an instanced prop (`_razeAt`), a breachable house
       * wall (`world.damageAt`), and a free-standing merged block — the gate
       * pier on the cathedral's parvis, the plinths on a capture point, the
       * blockhouse in a connector. @see `_buildBlockAtlas`.
       */
      const broke = this._breakBlocksAt(at.x, tank.position.y, at.z, CONTACT_RAZE_R);
      if (broke) {
        tank.stats.razed += broke;
        tank.ploughDrag = PLOUGH_DRAG;
        const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
        if (fx) {
          fx.dust?.(at.x, tank.position.y + 0.9, at.z, 3.0);
          fx.hazeRing?.(at.x, tank.position.y + 0.6, at.z, 2.6, 14, 0.5, 1.6);
        }
        const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
        audio?.play?.('strike_rubble', at, {
          level: 0.75, dur: 1.8, maxDist: 160, gain: 1.2, occlusion: 0.4,
        });
      }
      const breach = world?.damageAt?.(at, 1) ?? null;
      if (!breach) continue;
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
          `${at.x.toFixed(1)}, ${at.z.toFixed(1)}`
      );
    }
  }

  /** Advance along the leg the course is on. No raycast, no allocation. */
  _drive(tank, dt) {
    this._contact(tank, dt);
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
        /**
         * A HULL WITH NOTHING TO WANT IS GIVEN SOMETHING. @see `_wantFallback`:
         * `restless` is a hull that has been standing still for `RESTLESS`
         * seconds with nothing in its sights, and it drops the station it is
         * already at from the running so the answer is always somewhere else.
         */
        const restless = tank.state === 'hold' && !tank.target && tank.holdT > RESTLESS;
        let want = this._wantZone(tank);
        // The fallback is not consulted mid-drive on a course we already laid:
        // its `goal` is the nearest enemy point TO THE HULL, so a hull that is
        // moving would re-rank it every two seconds and could hunt between two
        // stations. A hull that has arrived is not moving and cannot.
        if (!want && (restless || tank.state === 'hold' || !tank.targetZone)) {
          want = this._wantFallback(tank, restless);
        }
        if (want && (want !== tank.targetZone || restless)) {
          if (this._setCourse(tank, want)) tank.holdT = 0;
          else if (restless) tank.holdT = 0; // already going there: stop asking
        }
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
       * to survive this change: A* never sees a hull however long it sits
       * there — the height field is baked at boot and nothing here writes to
       * it — and the route ends 24 m off D (printed at boot). A permanent wreck
       * is in neither a lane nor a circle, and a man it cannot shove aside is
       * let through rather than held. @see the header and `PIN_GRACE`.
       */
      tank.hold -= dt;
      /**
       * …AND `hold` IS STILL TERMINAL IN THE ONLY SENSE THAT MATTERED. There is
       * no withdrawal, no despawn and no lifetime: the hull leaves a station
       * only to stand on ANOTHER one, and the exits from a live tank are still
       * `_destroy` and the round reset. What changed is that standing still is
       * no longer the end of the sortie.
       *
       * `holdT` is HOW LONG IT HAS BEEN STANDING THERE, and it is the input to
       * the restless test above rather than to any withdrawal. Cleared by
       * `_startPlanStep` the moment a course is laid.
       */
      tank.holdT += dt;
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

  /**
   * BACK IN ITS POCKET, AND IT IS A HULL AGAIN RATHER THAN A HIDDEN WRECK.
   *
   * Called on one thing only — a wreck old enough to clear, from `_recycle` —
   * and never on a living tank. @see the note on `WRECK_HOLD`.
   *
   * THE MESH RESTORE IS THE HALF THAT WAS MISSING AND IT IS NOT COSMETIC.
   * `_destroy` hides every mesh but `tank.wreck` (`mesh.visible = mesh ===
   * tank.wreck`), and `_roll` only sets `root.visible` and `wreck.visible` — so
   * a hull re-issued without this would roll out of its pocket INVISIBLE, with
   * its wreck's no-shadow/no-prepass flags still on it. `reset()` carries the
   * same four lines for the same reason at the end of a round; this is that
   * restore for one tank in the middle of one.
   *
   * The plough piles are deliberately NOT put back (`reset` does that, this does
   * not): what one sortie flattened stays flattened, and a route with less on it
   * than it was baked with is a route that cannot wedge.
   */
  _park(tank) {
    tank.state = 'parked';
    tank.alive = false;
    // Back in its pocket: it is nobody's obstacle again.
    tank.solid = false;
    tank.crushing = false;
    tank.playerPin = 0;
    tank.root.visible = false;
    for (const c of tank.colliders) c.c.enabled = false;
    tank.wreck.visible = false;
    tank.wreck.userData.owNoShadow = false;
    tank.wreck.userData.owNoPrepass = false;
    for (const mesh of tank.meshes) mesh.visible = mesh !== tank.wreck;
    tank.uniforms.uT.value = -1;
    tank.uniforms.uAnim.value = 1;
    tank.health = RULES.tankHealth;
    tank.lastHitBy = null;
    tank.target = null;
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

  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE HULL, AGAINST THE ONE CAPSULE THAT IS NOT AN `Agent`
   * ────────────────────────────────────────────────────────────────────────
   * 「戦車への物理判定つけて、キャラが通り過ぎることが可能なので」. The other thirty
   * capsules are `src/ai`'s and are handled by `Agent._clearHulls` on exactly
   * these rules; @see the `BODY_HALF_W` note for why this is not a collision
   * layer and what the three rules are.
   *
   * THE PUSH GOES THROUGH `CharacterController.move`, never through
   * `character.position`, and that is the safety property the whole feature
   * rests on: `move` is a swept, sliding, de-penetrating resolve against the
   * static BVH, so a shove can be REFUSED by a wall and can never put the
   * player inside geometry. Three attempts — near flank, far flank, then out
   * whichever end he is nearer — and the NEXT one is only tried when the last
   * gained nothing along the direction it asked for. Firing all three every
   * frame puts a man in the middle of a hull back in the middle of the hull;
   * @see the same note on `Agent._clearHulls`, which measured what that costs.
   *
   * Allocates nothing: eight locals and a `Vector3.set` on the player's own
   * published feet vector, which is written so anything reading `player`
   * this frame sees where he actually is (the controller is authoritative for
   * the next fixed step either way).
   */
  _shovePlayer(tank, dt) {
    if (!tank.solid) return;
    const player = this._player ?? (this._player = this.ctx.peek('player'));
    const c = player?.character;
    if (!c || player.dead) {
      tank.playerPin = 0;
      return;
    }
    const hw = tank.halfW + c.radius;
    const hl = tank.halfL + c.radius;
    const s = Math.sin(tank.yaw);
    const co = Math.cos(tank.yaw);

    for (let k = 0; k <= 3; k++) {
      // Beside it, not on a roof over it or in a cellar under it.
      const rel = c.position.y - tank.position.y;
      if (rel > tank.bodyHigh || rel + c.height < tank.bodyLow) {
        tank.playerPin = 0;
        return;
      }
      const dx = c.position.x - tank.position.x;
      const dz = c.position.z - tank.position.z;
      // The hull's own frame: +Z is the nose, +X is the right track.
      const lx = dx * co - dz * s;
      const lz = dx * s + dz * co;
      if (Math.abs(lx) >= hw || Math.abs(lz) >= hl) {
        tank.playerPin = 0;
        return;
      }
      if (k === 3) break; // three shoves and he is still inside it
      // A hull that has stopped may not cork a lane. @see `PIN_GRACE`.
      if (tank.playerPin > PIN_GRACE) return;
      const side = lx < 0 ? -1 : 1;
      const ex = k === 2 ? 0 : k === 0 ? side : -side;
      const ez = k === 2 ? (lz < 0 ? -1 : 1) : 0;
      const out = ex ? hw - lx * ex : hl - lz * ez;
      const push = Math.min(SHOVE_MAX, out + SHOVE_SKIN);
      const wx = ex * co + ez * s;
      const wz = -ex * s + ez * co;
      const bx = c.position.x;
      const bz = c.position.z;
      c.move(wx * push, 0, wz * push);
      player.feetPosition?.set(c.position.x, c.position.y, c.position.z);
      // A shove that GAINED ground is left to finish next frame; only a shove
      // that was refused tries the next flank. @see `Agent._clearHulls` for the
      // measurement that made this necessary — trying all three every frame
      // returns a man in the middle of a hull to the middle of the hull.
      if ((c.position.x - bx) * wx + (c.position.z - bz) * wz > push * 0.35) {
        tank.playerPin = 0;
        return;
      }
    }

    if (tank.crushing) {
      // Nowhere to put him and forty tonnes still moving. A man who dies here
      // is a man who is not wedged here for the rest of the match.
      /**
       * AND THE HULL SIGNS IT. This is the one wound in the game that reaches
       * the player through neither `damage:dealt` nor `explosion`, so there was
       * no event for `PlayerSystem._recordDamage` to take an attacker off and
       * the kill cam called being run over by a named, teamed, forty-tonne
       * vehicle "BOMBARDMENT · INDIRECT FIRE" — @see the note there. `kind`
       * keeps it from becoming the other lie: a crush is not the main gun.
       */
      player.applyDamage?.(CRUSH_DPS * dt, tank.position, {
        type: 'explosion',
        source: tank,
        kind: 'crush',
      });
    } else {
      tank.playerPin += dt;
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
      /**
       * THE CREW LAYS FASTER ON THE MAN WHO IS SHOOTING AT IT. `snap` is set by
       * `_acquire` and means "this target is the one inside `RETALIATE`" — the
       * emergency traverse and the wider firing tolerance are what
       * 「打たれたらすぐ打ち返して」 asks for, and they are OFF for a routine
       * target so the ordinary sweep of the gun still reads as a laid shot.
       */
      const trav = tank.snap ? TRAVERSE_SNAP : TRAVERSE;
      const elev = tank.snap ? ELEVATE_SNAP : ELEVATE;
      const tol = tank.snap ? AIM_SNAP : AIM_TOL;
      tank.turretYaw += clamp(dyaw, -trav * dt, trav * dt);
      tank.gunPitch += clamp(dpitch, -elev * dt, elev * dt);
      onTarget = Math.abs(dyaw) < tol && Math.abs(dpitch) < tol;
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

    /**
     * ---- the coax ------------------------------------------------------
     *
     * IT OPENS UP ON THE FRAME IT IS ROUGHLY LAID, not a rest later. The old
     * chain set `coaxLeft` and then WAITED OUT `COAX_REST` before the first
     * round of the first burst, so a hull that had just been shot answered with
     * its machine gun a second and a half after it could have — and `COAX_REST`
     * is meant to be the gap BETWEEN bursts, which is where it is spent now.
     * The rest is charged when a burst runs dry rather than before it starts.
     */
    if (target) {
      const aligned = onTarget || Math.abs(wrapPi(wantYaw - tank.turretYaw)) < COAX_ARC;
      tank.coax -= dt;
      if (tank.coax <= 0) {
        if (tank.coaxLeft > 0) {
          if (aligned) {
            this._coax(tank, target);
            tank.coaxLeft--;
            tank.coax = tank.coaxLeft > 0 ? COAX_GAP : COAX_REST;
          }
          // Not laid yet: hold the burst rather than rake our own hull.
        } else if (aligned) {
          tank.coaxLeft = COAX_ROUNDS;
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
    /**
     * ══════════════════════════════════════════════════════════════════════
     * 「また戦車同士でも叩くようにして 認識して、お互いに」 — AND THE OTHER SIDE'S
     * ARMOUR IS ON THE LIST
     * ══════════════════════════════════════════════════════════════════════
     * WHY IT WAS NOT. `this.enemies` is installed by `match` and is
     * `MatchSystem._tankEnemies`, which walks `_botsByTeam[foe]` and then adds
     * the local player — men, and only men. There is no bug in it and no
     * oversight either: it is the hostile list a CREW SHOOTING INFANTRY wants,
     * it was written when there was one hull a side and the two were on
     * opposite ends of one street, and a tank has never been in any list of
     * things a tank could shoot. Measured consequence on NACHTFELD, where
     * there are now six hulls: `_acquire` scored 0 hulls, ever, so two tanks
     * 40 m apart with clear line drove past each other laying their guns on
     * whichever rifleman happened to be nearer.
     *
     * SO THE CREW'S TARGET SET IS "WHAT `match` GAVE US, PLUS THE ENEMY
     * ARMOUR WE CAN SEE", and the second half is appended HERE rather than
     * asked for from `match` — this file owns `this.tanks`, `_tankEnemies` is
     * not this file's to edit, and a hull is already everything the scoring
     * loop below needs (`position`, and it is checked `alive`). Nothing else
     * in `_acquire` changes: a hull still has to be inside `RULES.tankRange`,
     * still has to pass the same single sight ray from the muzzle, and still
     * competes on plain distance with every man in the list.
     *
     * A WRECK IS NOT A TARGET (`alive` goes false in `_destroy`), and neither
     * is a hull still in its pocket — `state === 'parked'` hulls sit at the
     * head of their route with `alive` false, so the one test covers both.
     */
    for (const t of this.tanks) {
      if (t === tank || !t.alive || t.team === tank.team) continue;
      out.push(t);
    }
    if (!out.length) {
      tank.target = null;
      tank.snap = false;
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
      /**
       * ARMOUR FIRST, and it is a preference rather than a rule — the same
       * shape as `RETALIATE_BIAS` above and for the same kind of reason.
       *
       * WITHOUT IT, "tanks recognise each other" is true and inert. `_acquire`
       * scores on plain distance and NACHTFELD is a plain: a rifleman at 25 m
       * outscores an enemy hull at 45 m every time, so two tanks with a clear
       * 45 m line lay their guns on infantry and drive past each other. The
       * argument for the bias is not aesthetic — the other hull is the ONLY
       * thing in range that can destroy this one, the main gun is the only
       * weapon on the map that answers it, and the coax is still raking the
       * men (@see `_coax`, which follows the same target but is a machine gun).
       *
       * 0.45: an enemy hull beats any man more than 2.2x closer than it is.
       * It still has to be inside `tankRange`, still has to pass the sight ray,
       * and a man who has just put a round on the hull still beats it
       * (`RETALIATE_BIAS` is 0.3, which is the stronger claim — 「打たれたら
       * すぐ打ち返して」 outranks everything).
       */
      let score = d;
      if (e.isTank === true) score *= ARMOUR_BIAS;
      if (avengeOk && e === avenge) score = d * RETALIATE_BIAS;
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
    /**
     * A NEW TARGET IS ANSWERED ON THIS FRAME. The coax's own clock is cleared so
     * the burst opens as soon as the turret is round far enough, instead of the
     * hull carrying a leftover `COAX_REST` from whoever it was shooting at
     * before. `snap` is the emergency-traverse flag: it is true only while the
     * man the gun is laying on is the man who put a round on the hull inside
     * `RETALIATE`. @see `_fight`.
     */
    if (best && best !== tank.target) tank.coax = 0;
    tank.target = best;
    tank.snap = !!best && avengeOk && best === avenge;
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
    let dist = hit?.hit ? hit.distance : 220;
    /**
     * …AND IT STOPS ON ARMOUR. @see `SHELL_STOP` for why the world trace above
     * cannot do this itself and for the 60-metres-past-the-target arithmetic
     * it produces without this clause. Closest approach of the round to the
     * hull's centre: two dot products, no allocation, and it runs only when
     * the thing being shot at is a tank.
     */
    if (target?.isTank === true) {
      const cx = target.position.x - from.x;
      const cy = target.position.y + 1.2 - from.y;
      const cz = target.position.z - from.z;
      const t = cx * dir.x + cy * dir.y + cz * dir.z;
      if (t > 0 && t < dist) {
        const miss = Math.hypot(cx - dir.x * t, cy - dir.y * t, cz - dir.z * t);
        if (miss < SHELL_STOP) dist = t;
      }
    }
    const at = this._v3;
    at.copy(from).addScaledVector(dir, dist);

    // The blast. The canonical event, so `player`, `ai`, `fx` and `audio` all do
    // what they already do for a grenade or an airstrike.
    const b = this._blast;
    b.position = at;
    b.radius = RULES.tankMainRadius;
    b.damage = RULES.tankMainDamage;
    b.source = tank;
    /**
     * WHAT IT IS — and only the MAIN GUN carries it. `_takeBlast` reads `kind`
     * to give a hull's round its armour multiplier against another hull; the
     * brew-up in `_destroy` fires its own `explosion` with `source: tank` and
     * must NOT be read as a main-gun round, which is exactly why the test is
     * on this field and not on the source's type. @see `tankMul`.
     */
    b.kind = 'tankmain';
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
     * …AND THE MASONRY IN THE STREET WITH IT. `_razeAt` stops at anything with
     * no `prop_*` instance behind it, which is every piece of free-standing
     * merged masonry on this map — the gate piers on the cathedral's parvis
     * above all. A main-gun round takes one off. @see `_buildBlockAtlas`.
     */
    const broke = this._breakBlocksAt(at.x, at.y, at.z, RAZE_R);
    tank.stats.razed += broke;

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
    tank.lastOrd = 'round';
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
    /**
     * A MINE AND A TANK'S OWN SHELL, on the same `kind` channel the bot frag
     * opened. Both are read here rather than off `source` because `source` is
     * the MAN (or the hull) that gets paid and must stay free to be one —
     * @see the notes on `mineMul` and `tankMul`.
     */
    const mine = e.kind === 'atmine' ||
      (typeof e.source === 'string' && MINE_ORDNANCE.has(e.source));
    const shell = e.kind === 'tankmain';
    /**
     * …AND A MINE IS NOT A FRAG. Measured, not foreseen: an unowned mine's
     * payload named 'grenade' in `source` (that is the string `grenades.js`
     * falls back to when no man laid it), so the FIRST run of `_dtankmine.mjs`
     * printed the kill as "1 frags for 4294" beside "1 AT mines for 4294" —
     * the multiplier was right, the ledger counted it twice. `grenades.js` now
     * falls back to `def.ordnance` instead, and this clause is the belt to that
     * brace: whatever a mine calls itself, it is not counted as a frag.
     */
    const frag = !mine && (e.kind === 'grenade' ||
      (typeof e.source === 'string' && FRAG_ORDNANCE.has(e.source)));
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
      const mul = air ? airMul(dmg)
        : mine ? mineMul(dmg, r)
        : shell ? tankMul(dmg)
        : frag ? fragMul(dmg)
        : EXPLOSION_MUL;
      const amount = dmg * (1 - d / r) * mul;
      tank.stats.blasts++;
      tank.stats.blastDmg += amount;
      if (frag) {
        tank.stats.frags++;
        tank.stats.fragDmg += amount;
      }
      /**
       * WHAT IS KILLING THE ARMOUR, counted per hull rather than inferred from
       * a killfeed row — 「戦車同士でも叩くようにして」 and the minefield are both
       * claims that only mean something as a number. `lastOrd` is the ordnance
       * of the most recent wound, and `_destroy` reads it to classify the kill.
       */
      if (mine) {
        tank.stats.mines++;
        tank.stats.mineDmg += amount;
      } else if (shell) {
        tank.stats.shells++;
        tank.stats.shellDmg += amount;
      }
      tank.lastOrd = mine ? 'mine' : shell ? 'tank' : air ? 'air' : frag ? 'frag' : 'blast';
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
      /**
       * …AND IT LOOKS NOW RATHER THAN AT THE NEXT TICK — 「打たれたらすぐ打ち返して」.
       * `_fight` re-acquires the moment this goes non-positive, so a round on
       * the hull costs at most ONE FRAME of "the crew has not noticed" instead
       * of up to `ACQUIRE_EVERY`. It is an assignment, not a call: `_takeRound`
       * runs inside `physics`'s own emit and a penetrating round arrives as
       * three of them, so acquiring HERE would fire three sets of sight rays
       * inside one frame for one bullet.
       */
      tank.acquireIn = 0;
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
    // The wreck is still a solid to walk into, and it is no longer a thing
    // that can run anybody over. @see the `BODY_HALF_W` note.
    tank.crushing = false;
    tank.playerPin = 0;
    tank.health = 0;
    tank.stats.deaths++;
    tank.target = null;
    // WHAT TOOK IT — the ordnance of the wound that finished it. @see `kills`.
    const ord = tank.lastOrd ?? 'round';
    if (this.kills[ord] !== undefined) this.kills[ord]++;
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
        `${st.mines} AT mines for ${st.mineDmg.toFixed(0)}, ${st.shells} enemy shells for ${st.shellDmg.toFixed(0)}, ` +
        `finished by ${ord.toUpperCase()}, ` +
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
    for (const k in this.kills) this.kills[k] = 0;
    for (const t of this.tanks) {
      t.stats.kills = 0;
      t.stats.deaths = 0;
      t.stats.sorties = 0;
    }
  }

  /**
   * ARM THE FIRST SORTIE, `seconds` from now. One line, called by `match` from
   * the cathedral event's beat sheet; everything after it is the interval
   * scheduler this class already had (`RULES.tankInterval`, a hull in the pool
   * to give it, never under an inbound salvo — @see `WRECK_HOLD`). Idempotent —
   * a second call while the armour is already armed or out does nothing.
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
    /**
     * …AND THE MINEFIELD GOES WITH THE HULLS.
     *
     * `weapons` cannot do this for itself on the right clock. Its own
     * `resetAmmo` — which is what calls `ThrownGrenades.clear()` — is run by
     * `match` ON EVERY PLAYER RESPAWN as well as at a round boundary, and
     * sweeping both sides' anti-armour off the map every time the player dies
     * is not a rule anybody asked for. This method is the one `match` runs
     * exactly once per round for exactly this purpose, so the field is cleared
     * from here and `clear()` was left meaning what it has always meant.
     */
    const w = this._weapons ?? (this._weapons = this.ctx.peek('weapons'));
    w?.clearMines?.();
    // Every stall the guns took off the map goes back up before the next round.
    this._restoreRaze();
    // …and every free-standing block the hulls drove through. @see
    // `_buildBlockAtlas`.
    this._restoreBlocks();
    for (const tank of this.tanks) {
      // Every pile the last round flattened goes back up before the next one.
      this._restorePlough(tank);
      tank.ploughDrag = 0;
      tank.state = 'parked';
      tank.alive = false;
      tank.solid = false;
      tank.crushing = false;
      tank.playerPin = 0;
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
      tank.holdT = 0;
      tank.snap = false;
      tank.target = null;
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
