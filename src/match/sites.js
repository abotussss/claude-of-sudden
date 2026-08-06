/**
 * MATCH — where the round is fought.
 *
 * Bomb sites and both team spawns, authored in LEVEL space (the same
 * coordinates `src/world/layout.js` uses) and pushed through
 * `world.levelToWorld()` so they follow the level transform. Nothing here
 * builds geometry: the map is the repo's market street exactly as shipped, and
 * this file only decides which parts of it the round happens in.
 *
 * Every point is SNAPPED to the navigation grid at resolve time. Authoring a
 * spawn six inches inside a wall is the classic way to lose a whole team to a
 * stuck pathfind, and the fallback below is what stops a layout tweak in
 * `world` from silently breaking the mode.
 */

import * as THREE from 'three';
import { RULES, MODE } from './rules.js';

/**
 * ONE SITE AT THE END OF EACH OUTER LANE, 56 m apart.
 *
 * The map is three lanes now (see the diagram at the top of
 * `src/world/layout.js`): an A lane down the west side, the old market street
 * as MID, a B lane down the east side, joined by two connectors in the middle.
 * Each lane bulges into a 15 x 14 m walled courtyard at x ∓28, z -4, which is
 * where its site sits.
 *
 * A SITE IS A ZONE, NOT A DOT. `RULES.plantRadius` is 8, so the 16 m circle
 * centred here covers the whole courtyard and nothing outside it. Each
 * courtyard has THREE mouths — the lane from the north (the attack's natural
 * approach), the lane from the south (the defence's), and the connector from
 * the mid street (either side's, and the one a fake gets punished through) —
 * plus a lorry, two sandbag runs, a barrier line and a collapsed corner inside
 * it, so a plant can be made from cover and a defuse can be contested.
 *
 * WHAT THESE REPLACE. Both sites used to sit a few metres either side of the
 * SAME stretch of the one street, at nearly the same z. `tools/lanecheck.mjs`
 * measured the consequence: 59.3 % of the attack's route to A lay within 6 m of
 * its route to B, so there was nothing to fake and nothing to rotate between.
 *
 * `fallback` is a point further up the same lane, used if the primary does not
 * resolve onto walkable ground.
 */
/**
 * THE MAP IS 1.5x AND THESE ARE IN THE MAP'S COORDINATES.
 *
 * `src/world/layout.js` scales its whole authored plan by `SCALE` (see the long
 * note at the bottom of that file). Everything here is a LEVEL-space point in
 * that same plan — the courtyard centres, the hold points, both spawn clusters
 * — so every one of them has to move with it, or the mode plays the old map's
 * geometry on the new map's ground: sites inside a building, spawns outside the
 * perimeter wall.
 *
 * `match` may not import `world`, so the factor is repeated here rather than
 * shared, exactly as `KEEPOUT` in layout.js repeats these site centres. IF ONE
 * MOVES, MOVE THE OTHER. `tools/navcheck.mjs` is the gate — it fails loudly the
 * moment a spawn cannot reach a site.
 */
const SCALE = 1.5;
const L = (x, z) => [x * SCALE, z * SCALE];
const spawnRow = (r) => r.map(([x, z, y]) => [x * SCALE, z * SCALE, y]);

/**
 * …AND THE MID STREET WAS PRISED OPEN IN THE SAME PASS THE ZONES MOVED IN.
 *
 * `widenX` in src/world/layout.js stretches everything inside the old kerb line
 * and TRANSLATES everything outside it by 9 authored units, so the mid street
 * went from 13 to 31 units across and the two building rows, both lanes and both
 * courtyards moved out with their walls. It is repeated here — like `SCALE`, and
 * for the same reason: `match` may not import `world`. IF ONE MOVES, MOVE THE
 * OTHER; `tools/navcheck.mjs` fails loudly the moment a point lands in a wall.
 *
 * `ZONES` and `SPAWNS` do NOT use it. Every one of them is on the street
 * centreline, where this transform is the identity — which is the whole reason
 * they are authored as `L(0, …)` below and read as raw plan coordinates.
 * `SITES`, the DEMOLITION plant circles, is authored on the two courtyards and
 * every one of its points would otherwise be nine units inside a building.
 */
const SPREAD = 9.0;
const WB = 6.2;
const WK = 1 + SPREAD / WB;
const widenX = (x) => (Math.abs(x) <= WB ? x * WK : x + Math.sign(x) * SPREAD);
const LW = (x, z) => [widenX(x) * SCALE, z * SCALE];

/**
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THE PLANT ZONE IS NOT IN THE FIRST-FLOOR COMMAND ROOM
 * ────────────────────────────────────────────────────────────────────────────
 * The brief was "C4設置できる場所は守る側に有利になるように配置して。屋内の２回の
 * 司令室とか" — put the site where the DEFENCE has the advantage, for instance a
 * command room upstairs in a building. Half of that is done below. The upstairs
 * half cannot be done and here is the measurement rather than the opinion:
 *
 *   `src/ai/nav.js` is a 2.5D HEIGHT FIELD — ONE floor per (x, z) cell, sampled
 *   by dropping a ray from above the level. Inside a building that ray lands on
 *   the ROOF, so a building's interior is not merely hard to path through, it
 *   is not in the grid at all. Probed at boot on this map: `grid.nearest()` at
 *   the centre of W2's ground floor and at the centre of E2's returns NO CELL
 *   within three rings. A* therefore cannot route a single bot into either
 *   building, let alone up a flight of stairs.
 *
 * A charge planted in a first-floor room would be a charge NO BOT COULD EVER
 * DEFUSE, which directly contradicts the other half of the same brief — "C4設置
 * したらちゃんと敵は解除をしに来るように". A site that cannot be defused is not a
 * defender-favouring site, it is an attacker-winning one.
 *
 * So the split is: the PLANT ZONE stays on ground both sides can walk, and the
 * ELEVATION is where the defence's advantage lives. Both sites sit in the half
 * of their courtyard that the storeys above look down into — `RELIEF.decks` in
 * src/world/layout.js runs a 2.9 m catwalk along each courtyard's outer wall
 * and E2/W2's balconies overhang the north end — and every one of those
 * positions is reachable by a PLAYER (`tools/floorcheck.mjs` is the gate on
 * that) and by nobody else. The human defending gets the command post. The bots
 * hold the ground, which is all they have ever been able to do.
 */
export const SITES = [
  {
    id: 'A',
    name: 'WEST COURTYARD',
    /**
     * MOVED SOUTH, from z -4 to z -7, which is 4.5 m of world ground and the
     * whole of what "favour the defence" means here.
     *
     * Measured with A* over the real nav grid, shortest route from any spawn of
     * the cluster to the site centre:
     *
     *              attack      defence
     *   z -4 (old)   76.9 m      63.7 m     defence 13.2 m ahead
     *   z -7 (new)   81.0 m      58.8 m     defence 22.2 m ahead
     *
     * A 9 m swing, ~2 s at the player's 4.57 m/s stand speed, and it compounds:
     * the attack now has to cross the WHOLE courtyard to plant, with the
     * defence's own mouth behind the charge rather than in front of it, while
     * the deck along the west wall (2.9 m, player only) looks straight down on
     * the plant spot. The circle still fits the courtyard — `RULES.plantRadius`
     * is 8 and the south wall is 10.5 m away — and 92 % of it remains ground a
     * defender can physically stand on to cut the charge (swept cell by cell;
     * the missing 8 % is the strip against the perimeter wall).
     */
    level: LW(-28.0, -7.0),
    fallback: LW(-26.0, -5.0),
    /**
     * Where defenders set up: on the mouth their own rotation arrives through,
     * which for both sites is the lane from the south, ~9.6 m off the charge —
     * far enough that `Agent._pickHoldSpot`'s 4-11 m ring spreads them across
     * the south half of the courtyard instead of stacking them on the plant
     * spot, close enough to contest a plant the moment it starts. Open
     * courtyard ground, NOT inside a building — see groundPoint's roof note.
     */
    holdLevel: LW(-24.0, -12.0),
    /**
     * THE ATTACK'S SECOND WAY IN. @see `MatchSystem._assignObjectives`.
     *
     * A point in connector 2's west arm — the mid street's link into this lane,
     * which arrives at the courtyard's EAST mouth. The main body walks the A
     * lane down from the north; a third of the attack is sent here first and
     * comes in through a different hole in a different wall. Null-safe: if this
     * does not resolve onto reachable ground the flank is simply not ordered.
     */
    flankLevel: LW(-13.0, -4.5),
  },
  {
    id: 'B',
    name: 'EAST COURTYARD',
    level: LW(28.0, -7.0),
    fallback: LW(26.0, -5.0),
    holdLevel: LW(24.0, -12.0),
    /**
     * (15, -5) rather than the mirror of A's (-13, -4.5): the east arm of
     * connector 2 is not the west arm's mirror image. Probed cell by cell, the
     * mirrored point resolves onto something 0.84 m off the deck — a crate, and
     * therefore a cell no A* route reaches (0 of 15 attack spawns). Two metres
     * along the connector it is open gravel and all 15 reach it.
     */
    flankLevel: LW(15.0, -5.0),
  },
];

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE THREE DOMINATION ZONES, AND WHY THEY ARE NOT THE TWO BOMB SITES
 * ════════════════════════════════════════════════════════════════════════════
 * Two points is not domination, it is a tug of war: 1-1 is stable, whoever takes
 * the second has already won, and there is nothing to rotate. Three is the
 * genre's number because 2-1 is a lead you have to keep working at.
 *
 * So: the two courtyards, plus the mid street. Same geometry the C4 mode fights
 * over, one point further along each lane.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ALL THREE SIT ON LEVEL z 0, AND THAT IS THE WHOLE POINT
 * ────────────────────────────────────────────────────────────────────────────
 * MEASURED, and it decided the first two full headless matches. `SITES` above
 * puts A and B at level z -7, three metres of authored level SOUTH of their
 * courtyards' centres, and the long note in the A entry says exactly why: it is
 * a deliberate 22 m route advantage to the DEFENCE, who spawn in the south
 * pocket. In demolition that is fair, because the sides swap at
 * `RULES.swapAfterRound` and each half is played from both ends of it.
 *
 * DOMINATION NEVER SWAPS. Each side keeps one base for the whole match, so that
 * advantage stops being a round's tension and becomes a permanent property of
 * the map. `tools/navcheck.mjs` on the bomb-site placement:
 *
 *              attack (north)   defend (south)
 *   site A          77.5 m           59.1 m      south arrives first by 18.4 m
 *   site B          79.4 m           59.6 m      south arrives first by 19.8 m
 *
 * Two of three zones handed to the south side before anybody moves. Both matches
 * opened 2-1 to the south inside forty seconds, and 2-1 plus forward spawns is a
 * closed loop: 252-100 and 252-42.
 *
 * The spawn clusters are at level z +39.4 and -39.4 (`SPAWNS` below), so the
 * equidistant line between them is level z 0. Every zone centre is on it. The
 * courtyards are level z -11..3, so z 0 is inside both of them — at the north
 * end, covering the courtyard's north half and the mouth of its lane, which is
 * genuinely contestable ground rather than a corner.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * C, AND THE ONE PLACE IT CAN BE
 * ────────────────────────────────────────────────────────────────────────────
 * The mid lane runs x ±6.5 (kerb) with two single-storey islands standing in it:
 * K1 at level (0, 12) and K2 at level (-0.4, -4.6) — see `src/world/layout.js`.
 * K2's north face is at level z -1.5 and K1's south face at level z 9.3, so the
 * open tarmac between them is level z -1.5..9.3 and level z 0 is 1.5 units
 * (2.25 m of world ground) inside its southern end. That is the only value of z
 * that is both on the equidistant line and not inside a building.
 *
 * HEIGHT FIELD, NOT A ROOF. `src/ai/nav.js` is one floor per (x, z) cell, so
 * anything inside a footprint resolves onto the roof above it and no bot can
 * ever path there. C is deliberately the tarmac BETWEEN the two islands, both of
 * whose roofs a player can reach (there are steps) and no bot ever can. The
 * southern arc of C's circle laps over K2's footprint; `standRing` drops the
 * standing points that land on it and keeps the rest. A capture point bots
 * cannot take is a capture point that does not exist. @see the same argument at
 * the top of the A entry.
 *
 * `holdLevel` is the zone itself for all three: in domination a garrison holds
 * the point it owns, and `Agent._pickHoldSpot`'s 3-13 m ring is what spreads it
 * over the courtyard and its mouths. There is no separate rally point to author
 * and no side whose rotation arrives from a fixed direction.
 *
 * `flankLevel` is null for all three, and the flank leg is gone with it — see
 * the removals list at the top of src/match/index.js. Three live points on a
 * three-lane map is the rotation; a staging alley on the way to one of them was
 * a demolition answer to a demolition problem (fifteen men, one objective).
 */
/**
 * ════════════════════════════════════════════════════════════════════════════
 * AND THEN THE PLAYER REPLACED THE WHOLE ARGUMENT ABOVE WITH A BETTER ONE
 * ════════════════════════════════════════════════════════════════════════════
 * "ドミネーションのエリアの距離はもっと間を空けて 距離が近すぎ"
 * "それぞれの拠点から近いところにエリアを作り、中央部に１つさらに設置して そうすることで
 *  自陣プラス中央部を取るようになるので"
 * "また中央部は屋内にしてほしい なので中央部に広い大聖堂を配置して"
 *
 * The three-on-the-equidistant-line layout above solved the fairness problem and
 * created two others, and the player named both. The zones were 42.2 m apart —
 * one sprint, so there was no rotation, only a scrum — and all three were
 * outdoors on a map that had just learnt how to fight indoors.
 *
 * ONE ZONE BESIDE EACH BASE AND ONE IN THE MIDDLE is the genre's answer and it
 * is fair for a better reason than equidistance: it is SYMMETRIC. Each side is
 * 39.8 m from its own point and 98.3 m from the other's, and the middle is
 * 58.5 m from both. Nobody starts ahead; what each side starts with is one point
 * it should hold and one it has to go and take.
 *
 *                          A (north)     C (cathedral)    B (south)
 *   level                  (0, 38)       (0, -1)          (0, -40)
 *   from the north base       39.8 m        98.3 m          157 m
 *   from the south base        157 m        98.3 m         39.8 m
 *   A-C 58.5 m     C-B 58.5 m     A-B 117 m
 *
 * against 42.2 / 42.2 / 84.3 m before.
 *
 * C IS INSIDE A BUILDING, and that is the part that needed the most from the
 * rest of the engine. `src/world/cathedral.js` puts a 30 x 45 m aisled basilica
 * on the street centreline and publishes its ground storey on
 * `world.interiorVolumes`; `NavGrid._carveInteriors` re-samples those cells from
 * inside, which is the only reason a bot can walk to the crossing at all. The
 * long note at the top of the A entry in `SITES` — "a first-floor plant zone
 * would be a charge no bot could ever defuse" — is still true of an UPPER floor
 * and is no longer true of a ground one. That is what changed underneath this
 * file, and it is what makes an indoor capture point possible.
 *
 * All three are on the street centreline, at level x 0. That is why nothing here
 * repeats `widenX` from src/world/layout.js: the mid street was prised open from
 * 13 to 31 authored units in this pass, and the transform that did it is the
 * identity at x 0. `KEEPOUT` in layout.js duplicates all three centres — IF ONE
 * MOVES, MOVE THE OTHER.
 */
/**
 * ════════════════════════════════════════════════════════════════════════════
 * AND THEN ALL THREE CAME OFF THE CENTRELINE, BECAUSE A LINE IS NOT A MAP
 * ════════════════════════════════════════════════════════════════════════════
 * "ドミねーとする場所が一っ直線に並んでるでしょ？ そうするとマップの左右側に行くメリット
 *  ないから改善してほしい"
 * "ドミねーとする場所は大聖堂挟んで対角になるように配置、物理的に距離をもっと空けて、
 *  つまりマップの左右、大聖堂ではないエリアにドミネーションするエリアを配置して"
 *
 * Everything the note above says about SYMMETRY was right and is kept. What it got
 * wrong is that it bought that symmetry with COLLINEARITY: (0, 38), (0, -1),
 * (0, -40) is one straight line down the mid street, so the whole match happened
 * on one 46 m-wide corridor and the two lanes, the two courtyards and the four
 * cross-street arms — call it 40 % of the map's walkable ground — were worth
 * nothing at all. That is not a taste, it is what the player measured by playing
 * it: "マップの左右側に行くメリットない".
 *
 * THE NEW SHAPE. A and B are a 180° PAIR about the cathedral centre, in two
 * corner districts that had to be built for them (`THE MAP GROWS — PART 4` in
 * src/world/layout.js); C is the WEST COURTYARD. None of the three is in the
 * cathedral.
 *
 *   ρ(x, z) = (-x, -2 - z)   the rotation about the cathedral centre (0, -1)
 *   ρ(A) = B exactly, so any route advantage one side has to A the other has to B.
 *
 *              level (widened)   bearing from the cathedral   own base   far base
 *   A   NW district   (-38,  51)        140.9°                  53 u      184 u
 *   C   west courtyard (-37, -1)        180.0°                  75 u       75 u
 *   B   SE district    ( 38, -53)       -39.1°                 184 u       53 u
 *
 *   A-B 124 units = 186 m   (was 117 m)
 *   A-C  40 units =  60 m   (was  58.5 m)
 *   B-C  94 units = 141 m   (was  58.5 m)
 *
 * A and B are 180.0° apart across the building — "大聖堂挟んで対角" — and the
 * shortest leg of the triangle is longer than the LONGEST of the two legs the
 * player was calling too close.
 *
 * WHY C IS A COURTYARD AND NOT SOMEWHERE MORE INTERESTING. `SPAWNS` below are at
 * level z 64.5 and -66.5, so the line equidistant from the two bases is z -1, and
 * a third point off that line is a permanent lead for one side in a mode that
 * never swaps ends — the failure this file already has two long notes about (2-1
 * inside forty seconds, 252-100). Off the centreline and on z -1 there are exactly
 * two places on this map: the two courtyards. C is the west one; the east one is a
 * BEACON square instead (`BEACON_SPOTS` in src/world/layout.js), so both sides are
 * equidistant from both of them and the left and right of the map each carry one
 * reason to be there.
 *
 * THESE USE `LW`, NOT `L`. Every previous version of this table was on the street
 * centreline where `widenX` is the identity; none of these three are, and an
 * authored -29 is a widened -38. `KEEPOUT` in src/world/layout.js duplicates all
 * three — IF ONE MOVES, MOVE THE OTHER.
 */
/**
 * ════════════════════════════════════════════════════════════════════════════
 * AND THEN A AND B ACTUALLY WENT THERE, BECAUSE A* COULD FINALLY TAKE A MAN
 * ════════════════════════════════════════════════════════════════════════════
 * "どう考えても近いよね？？？もっと大聖堂からはなせ もっと街中に占領ポイント作れ
 *  AもBも大聖堂から近すぎ なぜもっと対角かつ街中に作らない？？？意味ないってこの距離
 *  物理的な距離って数メートルじゃねーわ もっともっともっと離せ
 *  なぜAやBから視認できる距離にあんの？大聖堂が もっと街中に作れ 街中の戦闘を作れ"
 *
 * THE TABLE ABOVE WAS NEVER THE TABLE THIS FILE SHIPPED. The two corner
 * districts were built (`THE MAP GROWS — PART 4`), the note was written, and then
 * the zones were quietly left at the two mid-street plazas — widened (-10, 40)
 * and (10, -42) — because nothing could path to the yards. That is the map the
 * player was looking at: A and B 63 m from the cathedral, both on the mid street,
 * both with the dome in plain sight down an open plaza. "近すぎ" was correct.
 *
 * IT WAS TWO BUGS AND NEITHER WAS THE LEVEL.
 *
 *   1. `src/ai/nav.js` closed no cell on pop. With no decrease-key, a stale heap
 *      entry re-expanded a settled cell and the frontier compounded: 196 m across
 *      a 122k-cell component cost two million expansions and still returned "no
 *      route" under the ceiling. Every long query on this map failed silently,
 *      `ensureReachable` read that as sealed ground, and it dragged the zones
 *      back toward the middle. Fixed there, not here: the same route is now 10
 *      waypoints in 1.0 ms.
 *
 *   2. The yard centres each had a CACHE CRATE standing on them. `BEACON_SPOTS`
 *      put `FLANK-NW` / `FLANK-SE` on exactly the two points the zones wanted, and
 *      `world/features.js` builds real geometry on a beacon, which `KEEPOUT` does
 *      not govern — it only holds off the DRESSING. Measured on the nav grid: the
 *      cell at widened (-38, 51) sat at floor 0.98 m with all four neighbours at
 *      0.05, a 0.93 m step against `maxStep` 0.45, so it was a CONNECTED COMPONENT
 *      OF ONE CELL. Its ρ-image happened to sample 0.4 m off the crate and was
 *      fine, which is why the failure looked asymmetric and random.
 *
 * So the zones and the two beacons SWAP. The districts get the capture points
 * they were built for; the plazas the zones vacate keep their `SITEWORKS` cover
 * and get the beacons, and (-10, 40) / (10, -42) is a ρ pair exactly as
 * `FLANK-NW` / `FLANK-SE` was, so the beacon invariant is unchanged.
 *
 *              level (widened)   from the cathedral   own base   far base
 *   A   NW yard      (-38,  51)        96.6 m           53 u      184 u
 *   C   west court   (-37,  -1)        63.0 m           75 u       75 u
 *   B   SE yard      ( 38, -53)        96.6 m          184 u       53 u
 *
 *   A-B 186 m (was 63 m apart from the cathedral and 117 m from each other)
 *   Bearings from the cathedral: A 140.9°, B -39.1° — 180.0° apart.
 *
 * AND THE CATHEDRAL IS NOT VISIBLE FROM EITHER, which is the half of the request
 * that is a measurement rather than a distance. Swept as eye-height rays from 12
 * points on each zone's capture circle to 5 points up the cathedral's mass:
 * 0 of 60 clear from A and 0 of 60 from B. NW1's flank, the NW2/NW3 terrace and
 * the west lane's own row stand in every one of them. @see `tools/navcheck.mjs`
 * for the route half and the commit message for the raycast table.
 */
export const ZONES = [
  {
    id: 'A',
    name: 'NORTH-WEST DISTRICT',
    /** The north-west corner district's yard, behind the west lane and out of
     *  sight of the cathedral. `L`, not `LW` — like `SPAWNS` below, these are
     *  authored in WIDENED space, where `widenX` has already been applied. */
    /**
     * PUSHED OUT TO x -48. The request, three times: "もっともっともっと離せ …
     * もっと左右の街中に占領ポイント作れ … なぜAやBから視認できる距離にあんの？
     * 大聖堂が".
     *
     * The city is authored out to x +-65; the zones were sitting at x +-38 and
     * before that at x +-10, so most of the map's width had no reason to exist.
     * A and B are now deep on the WEST and EAST sides. They remain an exact 180
     * degree rotation image of each other about the cathedral at (0, -1) —
     * rho(x, z) = (-x, -2 - z) — because domination never swaps ends, so any
     * asymmetry is permanent.
     *
     * The distance is bounded by the pathfinder, not by taste: A* was measured
     * solving 217.7 m at the longest and every spawn->zone route has to fit
     * inside that. This is placed and then MEASURED with navcheck rather than
     * assumed; if a route fails, `ensureReachable` moves the zone and the
     * failure is silent, which is exactly how the last two attempts came back
     * close.
     */
    /**
     * ════════════════════════════════════════════════════════════════════════
     * AND THEN THE CITY WAS BUILT AND THE POINT WENT INTO IT
     * ════════════════════════════════════════════════════════════════════════
     * "48 is the MEASURED ceiling" was true of the map that existed when it was
     * written and it was the wrong measurement to be making. x -48 was the last
     * authored ground on this side — `NW1`'s east face — so ∓58 hung the boot
     * for the reason a zone always hangs the boot: `ensureReachable` walks
     * sixteen rings of twelve probes against thirty spawns when the authored
     * point cannot be served, and every one of those is a full-component A*.
     * The answer was never a bigger number here; it was ground out there.
     *
     * `THE MAP GROWS — PART 6` in src/world/layout.js builds it: a WEST CITY on
     * x -95..-70 and its exact ρ image in the east, each one a 19.5 m avenue
     * between two continuous rows with two cross streets cut into the inner one.
     * A stands in the middle of the west avenue and B in the middle of the east.
     *
     *                    authored (widened)   from the cathedral   A-B
     *   before              (-48,  38)             96.6 m          185.7 m
     *   now                 (-76.5, 46)              —             see below
     *
     * The point is NARROWER THAN ITS CIRCLE: `RULES.captureRadius` is 8 and the
     * avenue is 13 units = 19.5 m of ground, so taking A means holding a street
     * with three-storey frontage on both sides and a doorway every few metres,
     * which is what "街中の戦闘を作れ" asks for and what a 45 x 20 unit gravel
     * yard could never be.
     *
     * `KEEPOUT` in src/world/layout.js reserves both centres at r3.0. IF ONE
     * MOVES, MOVE THE OTHER — and unlike every previous version of this table,
     * these two ARE on that list. The zones at (-48, 38) / (48, -40) never were,
     * which is one dressing reroll away from the one-cell-island failure the
     * note above the ρ table describes.
     */
    level: L(-69.7, 36.0),
    /** Two units north up the avenue, still between the same two rows. */
    fallback: L(-69.7, 38.0),
    holdLevel: L(-69.7, 36.0),
    flankLevel: null,
  },
  {
    id: 'C',
    name: 'WEST COURTYARD',
    /**
     * STILL 56 m FROM THE CATHEDRAL, AND THAT IS THE ONE REQUIREMENT LEFT OPEN.
     *
     * A and B were moved to the flank districts and MEASURE 136 m out with the
     * dome blocked from both. C did not move with them, and "AもBも大聖堂から
     * 近すぎ" is therefore still true of one point in three.
     *
     * I moved it to LW(-70, -1) and MEASURED the result: navcheck went from
     * attack 110.5 vs defend 112.6 (2 m apart) to attack 266.8 vs defend 163.9
     * — a 103 m gift to one side, permanent, because domination never swaps
     * ends. Reverted.
     *
     * The reason is structural, not a bad number. The flank districts are
     * NORTH-WEST and SOUTH-EAST — a rho pair about the cathedral, which is what
     * makes A and B fair. There is no north-east or south-west district, so the
     * west flank only exists at z 15..62; at z -1 there is no avenue to stand
     * in. And the only point that is genuinely equidistant for both bases is
     * the cathedral itself, which is already D.
     *
     * So C cannot be both far from the cathedral and fair until a second rho
     * pair of districts is built on the other diagonal. That is world work and
     * it is the honest next step, not another number in this file.
     */
    /**
     * ════════════════════════════════════════════════════════════════════════
     * AND THE WORLD WORK GOT DONE — THE COURTYARD GREW AN OUTER BAY AND C WENT
     * INTO IT
     * ════════════════════════════════════════════════════════════════════════
     * "CサイトとEサイト付近はもう少し大聖堂から遠くできる？今近いから、もう少しマップを
     *  広くして遠ざけて"
     *
     * The entry above is still right about the CONSTRAINT: C must stay on level
     * z -1 (the line equidistant from the two bases) or one side gets a
     * permanent lead, and moving it to the flank district at LW(-70, -1)
     * measured a 103 m gift and was reverted. What changed is the GROUND. The
     * note said the answer was world work, and the world work is in
     * src/world/layout.js: BW2 — the 18-unit slab that walled the courtyard's
     * west side — is a 6-unit back wall now, and the 11 widened units it
     * vacated are authored courtyard ground (the WEST BAY, widened x -56..-45,
     * z -8..1, walled by BW1 north, BW3 south, BW2 west, open east into the
     * courtyard it grew from).
     *
     * C stands in the middle of that bay: `LW(-41, -1)` = widened (-50, -1),
     * 13 widened units — 19.5 m of ground — further from the cathedral than
     * the courtyard centre it left. E is its exact ρ image in the EAST BAY,
     * which is authored as the west one's mirror in the same commit (BE2
     * shrunk the same way, BE3's north face pulled from z -3 to z -8 to match
     * BW3's). Both zones stay on z -1, so ρ(x, -1) = (-x, -1) and the pair
     * costs neither side anything.
     *
     * `KEEPOUT`, the A/B-deck catwalks, their mantle steps and the new bay
     * SITEWORKS all moved in the same pass — IF ONE MOVES, MOVE THE OTHER.
     * The courtyard mass the zones left at (∓37, -1) stays where it is: it is
     * the approach through the courtyard now, the same call the avenues and
     * the plazas already made.
     */
    level: LW(-41.0, -1.0),
    /** Two units back toward the bay's mouth, off the back wall and the deck. */
    fallback: LW(-39.0, -1.0),
    holdLevel: LW(-41.0, -1.0),
    flankLevel: null,
  },
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * E — ρ(C), AND IT IS THE ANSWER THE ENTRY ABOVE SAID IT COULD NOT GIVE
   * ══════════════════════════════════════════════════════════════════════════
   * "Cサイトが片方に有利な位置なのでEサイトを作ってください"
   *
   * THE PLAYER IS RIGHT AND THE PROOF IS IN THIS FILE'S OWN TABLE. A and B are a
   * ρ pair — ρ(x, z) = (-x, -2 - z) about the cathedral at (0, -1) — so any route
   * advantage one side has to A the other has by construction to B. D is ρ of
   * ITSELF: the rotation's fixed point. C IS THE ONLY ZONE ρ SENDS NOWHERE. It
   * stands in the WEST courtyard, and until this entry there was nothing in the
   * east one, so the set of capture points was not symmetric under the symmetry
   * the rest of the map is built on.
   *
   * WHAT THAT IS WORTH, and it is not the attack/defend numbers — C is on level
   * z -1, the line equidistant from the two bases, so `navcheck` measures it
   * nearly even (110.5 vs 112.6 m) and always did. It is the ROTATION:
   *
   *              A(-69.7, 36)   C(-37, -1)   B(69.7, -38)   E(37, -1)
   *   A—C          —              40 u          124 u          107 u
   *   B—C        124 u            94 u            —             40 u   <- E fixes
   *
   * The side that holds A has a 40-unit leg to a second point; the side holding B
   * had 94. Two points on one flank against one on the other, permanently, in a
   * mode that never swaps ends — which is the exact class of failure the three
   * long notes above this table were each written about.
   *
   * IT IS ρ(C) AND NOTHING ELSE WAS EYEBALLED. C is authored `LW(-28, -1)`,
   * which is WIDENED (-37, -1); ρ(-37, -1) = (37, -1), which is `LW(28, -1)`
   * because `widenX(28)` is 37. The fallback is ρ'd the same way: C's
   * `LW(-27, -3)` is widened (-36, -3), ρ of that is (36, 1), and `widenX(27)`
   * is 36. That is the whole derivation, and it is written out because the B
   * entry below spent six commits two authored units off the ρ it claimed.
   *
   * WHY THIS IS NOT THE MOVE THE C ENTRY REJECTED. That one tried to make C
   * itself far from the cathedral — `LW(-70, -1)` — and measured a 103 m gift to
   * one side, because the west flank district only exists at z 15..62 and there
   * is no ground at z -1 out there. This does not move C. It ADDS the point ρ
   * says is missing, on ground that already exists and is already dressed: the
   * east courtyard is the west one's mirror, `SITEWORKS` in src/world/layout.js
   * already stands the same six pieces of mass in it (authored for demolition
   * site B, and every one of them the exact x-mirror of the pieces C counts), and
   * both courtyards are on z -1 so both sides are equidistant from both.
   *
   * THE COURTYARD'S BEACON HAD TO LEAVE, exactly as the two yard beacons left
   * when A and B moved into the districts. `BEACON_SPOTS`' `FLANK-C` stood at
   * widened (40, -3) — 5.4 m inside this circle — and a beacon is a real crate
   * with collision under it, not a decal. @see the removal in src/world/layout.js.
   *
   * WHAT THIS COSTS THE MATCH, MEASURED AND NOT FIXED HERE. A fifth zone is a
   * fifth income stream on a `scoreTarget` of 250, so it shortens the match and
   * everything scheduled on `_matchProgress` moves with it. The numbers are in
   * the commit message; `rules.js` and the schedule belong to another agent.
   */
  {
    id: 'E',
    name: 'EAST COURTYARD',
    /**
     * ρ(C) exactly, in the EAST BAY. C is widened (-50, -1); ρ(-50, -1) =
     * (50, -1), which is `LW(41, -1)` because `widenX(41)` is 50. The fallback
     * is ρ'd the same way: C's `LW(-39, -1)` is widened (-48, -1), ρ of that
     * is (48, -1) = `LW(39, -1)`. Written out because the B entry below once
     * spent six commits two authored units off the ρ it claimed.
     * @see the long note in the C entry — both bays are authored in
     * src/world/layout.js in the same commit as this pair of centres.
     */
    level: LW(41.0, -1.0),
    /** ρ(C's fallback): two units back toward the bay's mouth. */
    fallback: LW(39.0, -1.0),
    holdLevel: LW(41.0, -1.0),
    flankLevel: null,
  },
  {
    id: 'B',
    name: 'SOUTH-EAST DISTRICT',
    /**
     * ρ(A) exactly: (-x, -2 - z). Every point of it, including the fallback.
     *
     * ──────────────────────────────────────────────────────────────────────
     * AND IT SAID THAT FOR SIX COMMITS WHILE BEING TWO UNITS OFF, WHICH IS
     * WHERE THE ZONE'S WHOLE PROBLEM CAME FROM
     * ──────────────────────────────────────────────────────────────────────
     * ρ(-69.7, 36) is (69.7, -38). This entry authored -36 — the ρ of a
     * DIFFERENT map, the one whose symmetry is taken about the origin instead
     * of about the cathedral at (0, -1) — and the comment above claimed the
     * mirror it did not have. Two authored units, three metres of ground, and
     * it is the difference between standing in a street and standing on a wall:
     *
     *   `SE1` is authored x 60..70, z -36..-16 (`src/world/layout.js`), so its
     *   SOUTH FACE IS z -36 EXACTLY and B's authored centre was flush against
     *   it. `NW1` is ρ(SE1) at z 14..34 and A's centre at 36 has TWO UNITS of
     *   cross street between it and that face. The two zones were not the same
     *   placement measured from their own ground; only one of them was in a
     *   street at all.
     *
     * WHAT THAT COST, all of it measured on the built map rather than argued:
     *
     *   1. B'S CENTRE WANDERED BETWEEN BOOTS. `walkable()` asks `grid.nearest`
     *      for a cell within three rings and 1.2 m of the probe height, and on
     *      a wall face that is a coin flip: over 13 boots B resolved to
     *      (69.51, -36.15) nine times — the authored point, snapped — and to
     *      (69.51, -38.08) four times, the boots where the authored point was
     *      not walkable and `snap()` fell through to the fallback. A, two units
     *      off its own wall, resolved to (-69.52, 35.92) every single time.
     *      A CAPTURE POINT WITH TWO PLACES IT MIGHT BE IS TWO CAPTURE POINTS.
     *
     *   2. AND THE -36 ONE WAS BARE. `tools/sitecheck.mjs` wants 12 m² of
     *      0.9-2.8 m mass inside the circle. Measured over four boots of the
     *      build before this change, all four of which resolved to -36.15:
     *      10.5, 15.8, 15.8, 16.3 m² — a gate that fails on the dressing
     *      scatter's dice. The boots that fell through to -38.08 measured 21.3.
     *      The mass in `SITEWORKS` for this zone is authored at z -37.0, -38.9
     *      and -39.9 (it had to be, or a ρ'd table would have put a third of it
     *      inside SE1's ground floor), so from -36 half of it is hanging off
     *      the far edge of the circle and from -38 it is ON the point.
     *
     *   3. AND ITS NORTH ARC WAS INSIDE A BUILDING THAT COMES DOWN. `SE1` is on
     *      `DEMOLITION` in src/world/demolition.js — the `DISTRICT-B` salvo
     *      levels it mid-match — so a third of what B was resolving against was
     *      a building that does not survive the round. From -38 the circle
     *      clears SE1's face by two units and the mass it counts is the two
     *      plinths, the kerb wall and the district's own rubble mound, none of
     *      which is on a demolishable footprint. @see the measurement in the
     *      commit message: the counted mass standing on a demo footprint is
     *      0.0 m² intact, and the salvo ADDS 5.5 m² of walkable rubble to the
     *      circle rather than taking anything out of it.
     *
     * THE FAIRNESS COST IS NEGATIVE, which is the only reason this is the fix
     * rather than the other one. A and B are a ρ pair and domination never swaps
     * ends, so any asymmetry between them is permanent — this file has already
     * rejected one zone move that handed a side 103 m (@see the C entry). This
     * move does not create an asymmetry, it REMOVES the one that was there:
     * B was two units from where the mirror puts it, and `navcheck`'s own
     * attack/defend distances close up rather than open. The numbers are in the
     * commit message.
     *
     * `KEEPOUT` in src/world/layout.js reserves this centre at r3.0 and moved
     * with it. IF ONE MOVES, MOVE THE OTHER.
     */
    level: L(69.7, -38.0),
    /** ρ(A's fallback) — two units further down the avenue, away from SE1. */
    fallback: L(69.7, -40.0),
    holdLevel: L(69.7, -38.0),
    flankLevel: null,
  },
  /**
   * ────────────────────────────────────────────────────────────────────────
   * D — THE CATHEDRAL, AND IT IS NOT A CAPTURE POINT UNTIL IT IS RUBBLE
   * ────────────────────────────────────────────────────────────────────────
   * "大聖堂をDサイトとして途中で出現させて 大聖堂破壊イベントを通して"
   *
   * `locked: true` is the whole feature. The zone is AUTHORED, RESOLVED, PROVED
   * REACHABLE and PAINTED at boot exactly like the other three — so `navcheck`,
   * `Airstrike._verifyRoutes` and `standRing` all measure it against the map
   * they measure everything else against — and then it is held out of
   * `MatchSystem.sites` until the cathedral comes down. Before that moment it is
   * not on the HUD, not in the objective plan, not a forward spawn and not worth
   * a point. After it, it is a zone like any other, standing in the wreckage.
   *
   * WHY THE CENTRE IS (0, -1). That is the cathedral's own centre — the point
   * the ρ symmetry in the note above is taken about, so A, B and D are one
   * figure rather than three placements. Measured on the built map: the nave
   * floor at that cell is `flags = 1`, `floor = 0.16 m`, 232 of its ~314 cells
   * are walkable, and A* solves from ALL FIFTEEN attack spawn points to it on
   * the INTACT map, because `NavGrid._carveInteriors` carves the cathedral's
   * ground storey (it is `CATH` in `world.interiorVolumes`). A downward ray from
   * the sky finds the roof at 26.20 m and the FLOOR at 0.16 m is only there
   * because of that carve — which is exactly why this is proved and not assumed,
   * and why `MatchSystem._reprobeZoneNav` may not use the strike's own top-down
   * cell probe on it.
   *
   * `KEEPOUT` IS NOT AVAILABLE TO THIS CHANGE. It lives in `src/world/layout.js`
   * and `world` belongs to another agent, so the r3.0 reservation the other
   * three zone centres get cannot be added for this one. The substitute is a
   * measurement rather than a hope: `resolveLayout` proves the centre walkable,
   * `standRing` proves eight standing points inside the circle against A* from
   * both sides, and both counts are printed at boot. If the dressing ever drops
   * a crate on the nave crossing, those numbers fall and the boot log says so.
   */
  {
    id: 'D',
    name: 'THE CATHEDRAL',
    locked: true,
    level: L(0.0, -1.0),
    /** Four units up the nave, still under the crossing. */
    fallback: L(0.0, -5.0),
    holdLevel: L(0.0, -1.0),
    flankLevel: null,
  },
];

/**
 * Spawns, `[x, z, yaw]` in level space.
 *
 * Both clusters sit in the MID lane behind their own cross street — the attack
 * in the pocket north of W5/E5, the defence in the pocket south of W4/E4 — so
 * each side steps out of spawn into a full-width cross street and chooses a
 * lane there. That is what makes all three routes live: from the attack spawn
 * the A lane, mid and the B lane are 68, 69 and 68 m to their respective
 * objectives, so no route is the obvious one.
 *
 * THE SEPARATION IS LOAD-BEARING. An actor's view range is 58 m
 * (`Agent.viewRange`). At the first spacing tried on the old map — closest pair
 * 51 m — both sides acquired a target on the spawn frame and spent the round
 * trading shots down the middle instead of playing the objective. The two cross
 * streets are also blind to each other because the mid street's median (`K1`,
 * `K2`) stands between them, so the round opens with two teams walking rather
 * than two teams already shooting.
 *
 * FIFTEEN A SIDE NEEDS FIFTEEN POINTS. `_spawnTeam` walks this list modulo its
 * length, so seven points for fifteen men stacks two bodies per point inside a
 * 1.1 m jitter — they spend the freeze shoving each other out of the way and
 * the first thing the round does is look broken. Five ranks of three, filling
 * the mid-lane pocket the seven-man version only sampled:
 *
 *   x  -5.0    0.0    +5.0        (the mid lane's kerb line is x ±6.5)
 *   z  44.6  42.0  39.4  36.8  34.2   attack   (north cross street is z 24..32)
 *   z -44.6 -42.0 -39.4 -36.8 -34.2   defence  (south cross street is z -34..)
 *
 * The closest attack/defence pair is 68.4 m, still comfortably outside the 58 m
 * view range, so the opening frame is still two teams walking. These are also
 * the RESPAWN points — `MatchSystem._safeSpawn` picks whichever of the cluster
 * has the most empty ground around it, which only works if there are enough of
 * them to choose between. That is why the list is sized to `RULES.teamSize` and
 * has had to grow twice; @see the SEVEN RANKS note below.
 */
/**
 * ────────────────────────────────────────────────────────────────────────────
 * BOTH CLUSTERS MOVED OUT INTO THE TWO NEW BASE DISTRICTS
 * ────────────────────────────────────────────────────────────────────────────
 * They were at level z ∓34.2..∓44.6, which is three units behind the last cross
 * street — INSIDE the play box. There was nowhere to put "a zone near the base"
 * that was not already the base, so both ends of the street grew by 24 units of
 * authored map (see `THE MAP GROWS` in src/world/layout.js) and the clusters went
 * out into them:
 *
 *   x  -6.0   0.0   +6.0             (the mid lane's kerb line is x ∓15.5 now)
 *   z  60.1  62.3  64.5  66.7  68.9   attack   (row of blocks N1-N3 at z 50..58)
 *   z -62.1 -64.3 -66.5 -68.7 -70.9   defence  (row of blocks S1-S3 at -60..-52)
 *
 * Still five ranks of three, because `_spawnTeam` walks this list modulo its
 * length and seven points for fifteen men stacks two bodies per point. Still
 * facing down the map. `KEEPOUT` in layout.js reserves a 9.5-unit circle on each
 * cluster centre, which is what stops the dressing dropping a crate on a
 * respawn.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SEVEN RANKS, BECAUSE THE ROSTER WENT TO 20 A SIDE
 * ────────────────────────────────────────────────────────────────────────────
 * "あと２０VS20にしてください". The paragraph above is the exact argument for why
 * this list has to grow with `RULES.teamSize`, and it applies again one size up:
 * `_spawnTeam` indexes modulo the list, so fifteen points for twenty men stands
 * five pairs of bodies inside each other on the opening frame, and `_safeSpawn`
 * — whose whole tier 3 is "pick the emptiest of the cluster" — chooses between
 * fifteen points that are never all free. One rank is added at each END of the
 * cluster rather than a fourth column or a tighter pitch:
 *
 *   z  57.9 .. 71.1   attack       21 points, seven ranks of three
 *   z -59.9 .. -73.1  defence      pitch unchanged at 2.2 units in z, 6 in x
 *
 * RANKS RATHER THAN COLUMNS, BECAUSE DENSITY IS THE THING THAT MUST NOT GO UP.
 * The original stuck epidemic — 22 of 29 men wedged and going nowhere — was
 * CROWDING, men shoved on to one-cell nav islands, and a spawn cluster is the
 * most crowded ground on the map for the first ten seconds of a match and for
 * six seconds after every wave of deaths. A fourth column would have put 21 men
 * in the same ground; seven ranks grow the pocket with the roster instead.
 *
 * TWO CONSTRAINTS DECIDE WHERE THE RANKS CAN GO AND BOTH WERE MEASURED ON THE
 * RUNNING LEVEL RATHER THAN READ OFF THE PLAN (`_spawnfit.mjs`, `_navedge.mjs`):
 *
 *   1. THE KEEPOUT CIRCLE. `KEEPOUT` (src/world/layout.js — a file this one may
 *      not edit) reserves 9.5 units on (0, 64.5) and (0, -66.5), and it is what
 *      stops the dressing dropping a crate on a respawn. The corner man of the
 *      new outer rank stands at (6, 68.7), i.e. |(6, 4.2)| = 7.3 units out; the
 *      corner man of the new inner rank at (6, 57.9) is |(6, -6.6)| = 8.9. Both
 *      inside, so layout.js needed no change.
 *   2. THE GROUND ACTUALLY RUNS OUT, AND IT IS NOT SYMMETRIC. Walking the nav
 *      grid outward along each column: the ATTACK end stays walkable to level
 *      |z| = 81.8, the DEFENCE end only to 71.6-72.0. The first attempt put the
 *      outer ranks at the ρ-images ∓(2 + 71.1), and the three defence points at
 *      -73.1 were past that edge — `walkable()` dragged each of them ~2.0-2.4 m
 *      forward on to the nearest cell, which collapsed the two back ranks into
 *      each other at 0.8 m apart. That is the crowding this note exists to
 *      avoid, arriving through the back door of a silent relocation. Caught by
 *      `_spawnfit.mjs`, which reports the drag distance per point precisely
 *      because a relocated spawn looks perfectly valid from every other angle.
 *
 * So the pitch is 1.8 units rather than 2.2 and the band is sized to the
 * DEFENCE end, which is the binding one:
 *
 *   z  57.9 59.7 61.5 63.3 65.1 66.9 68.7   attack   (N2's face is at z 56.7)
 *   z -59.9 …                       -70.7   defence  (last walkable is -71.6)
 *
 * Both clusters are still exact ρ-images of each other (ρ(x, z) = (-x, -2 - z)),
 * so neither side gets the better pocket. Stand points went 15 -> 21 and the
 * ground under them 8.8 -> 10.8 units of z. MEASURED on the running level over
 * all 42 points: no point dragged more than 0.53 m off where it is authored
 * (that is ordinary nav-cell snapping, the same magnitude the fifteen already
 * had), every point with 11 or 12 of 12 clear bearings at 1.5 m, and
 * nearest-neighbour spacing min 1.79 m / median 2.88 m against min 2.88 m at the
 * old 2.2-unit pitch. So it IS tighter, and the honest reason that is accepted
 * rather than argued away is `tools/stuckcheck.mjs`: 0 of 39 stuck. A man is
 * 0.8 m across and 1.79 m is two of him, with `_jitterOnto` and `spawnProtect`
 * covering the moment itself.
 *
 * THE SEPARATION IS STILL LOAD-BEARING, and it is now enormous: the closest
 * attack/defence pair is 131 units = 197 m against an `Agent.viewRange` of 58 m,
 * so the round still opens with two teams walking. What changed is that neither
 * team is walking toward the other — each walks 40 m to its own point first,
 * which is the whole shape of the mode the player asked for.
 *
 * x ∓6 rather than ∓5: these are authored in WIDENED space and the street they
 * stand in is 46.5 m across, so the cluster is spread over 18 m of it and each
 * rank still clears the containers at the foot of N2/S2 by ~2 m.
 */
export const SPAWNS = {
  attack: spawnRow([
    [-6.0, 68.7, Math.PI], [0.0, 68.7, Math.PI], [6.0, 68.7, Math.PI],
    [-6.0, 66.9, Math.PI], [0.0, 66.9, Math.PI], [6.0, 66.9, Math.PI],
    [-6.0, 65.1, Math.PI], [0.0, 65.1, Math.PI], [6.0, 65.1, Math.PI],
    [-6.0, 63.3, Math.PI], [0.0, 63.3, Math.PI], [6.0, 63.3, Math.PI],
    [-6.0, 61.5, Math.PI], [0.0, 61.5, Math.PI], [6.0, 61.5, Math.PI],
    [-6.0, 59.7, Math.PI], [0.0, 59.7, Math.PI], [6.0, 59.7, Math.PI],
    [-6.0, 57.9, Math.PI], [0.0, 57.9, Math.PI], [6.0, 57.9, Math.PI],
  ]),
  defend: spawnRow([
    [-6.0, -70.7, 0], [0.0, -70.7, 0], [6.0, -70.7, 0],
    [-6.0, -68.9, 0], [0.0, -68.9, 0], [6.0, -68.9, 0],
    [-6.0, -67.1, 0], [0.0, -67.1, 0], [6.0, -67.1, 0],
    [-6.0, -65.3, 0], [0.0, -65.3, 0], [6.0, -65.3, 0],
    [-6.0, -63.5, 0], [0.0, -63.5, 0], [6.0, -63.5, 0],
    [-6.0, -61.7, 0], [0.0, -61.7, 0], [6.0, -61.7, 0],
    [-6.0, -59.9, 0], [0.0, -59.9, 0], [6.0, -59.9, 0],
  ]),
};

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE SECOND MAP — NACHTFELD, the night plain
 * ════════════════════════════════════════════════════════════════════════════
 * @see `src/world/levels/plains.js`, which owns the ground these stand on.
 *
 * THE COORDINATES ARE METRES AND THERE IS NO TRANSFORM TO KEEP IN SYNC. That is
 * the one thing this table gets that the town's never had: `plains.js` is
 * authored at yaw 0, scale 1, origin 0, so level space IS world space, and the
 * `SCALE`/`SPREAD`/`widenX` triple that is copied by hand into FIVE files of
 * `src/match` (this one, `airstrike.js`, `bomber.js`, `strafe.js`, `tank.js`)
 * with a comment begging whoever edits one to edit the others simply does not
 * apply here. A number below, a number in `plains.js` and a `--at=` argument to
 * `tools/zonespot.mjs` are the same point.
 *
 * EVERY CENTRE IS A `PADS` ENTRY IN `plains.js` — flattened ground, held level
 * inside 16 m and blended out to 34. A capture point on a 20° swell is one that
 * is always fought from above; these are the flat squares the plain has.
 *
 * THEY ARE 190-315 m APART — 「占領サイトの距離も空けて」. On the town, A and B
 * measure 185.7 m and everything else is closer; here the shortest zone pair is
 * A-C at 190 m and the longest is A-B at 315 m, with both bases 302 m apart.
 * That is what the 1000-point game is FOR: crossing this map is a decision.
 *
 *      C(-128, 86)                            B(118, 104)
 *                        D(0, 0)
 *      A(-118,-104)                           E(128, -86)
 *
 * D IS NOT LOCKED, and that is a deliberate hole for the next author rather
 * than an oversight. On the town, D is the cathedral and `locked: true` holds it
 * out of `MatchSystem.sites` until the church is brought down mid-match. This
 * map has no cathedral, so a locked D would never open. When the CONTROL TOWER
 * and the FORTRESS are built on this pad (「管制塔があり、要塞がある平原」) and
 * there is an event that destroys them, THIS is the zone to lock behind it —
 * `MatchSystem` finds the locked zone by predicate (`allZones.find(z => z.locked)`),
 * not by id, so nothing else has to change.
 */
const P = (x, z) => [x, z];

export const PLAINS_ZONES = [
  {
    id: 'A',
    name: 'THE WEST SHOULDER',
    level: P(-118, -104),
    fallback: P(-110, -97),
    holdLevel: P(-118, -104),
    flankLevel: null,
  },
  {
    id: 'C',
    name: 'THE SOUTH-WEST SWELL',
    level: P(-128, 86),
    fallback: P(-120, 80),
    holdLevel: P(-128, 86),
    flankLevel: null,
  },
  {
    id: 'E',
    name: 'THE NORTH-EAST SWELL',
    level: P(128, -86),
    fallback: P(120, -80),
    holdLevel: P(128, -86),
    flankLevel: null,
  },
  {
    id: 'B',
    name: 'THE EAST SHOULDER',
    level: P(118, 104),
    fallback: P(110, 97),
    holdLevel: P(118, 104),
    flankLevel: null,
  },
  {
    id: 'D',
    name: 'THE CENTRE',
    level: P(0, 0),
    fallback: P(0, -8),
    holdLevel: P(0, 0),
    flankLevel: null,
  },
];

/**
 * Both bases, 302 m apart on the plain's long diagonal. Twenty-one men a side in
 * seven ranks of three, the same shape as the town's clusters and for the same
 * reason: `Agent.viewRange` is 58 m, so the round has to open with both sides
 * walking rather than shooting.
 *
 * yaw 0 faces +Z and `Math.PI` faces -Z (this level's transform is the identity,
 * so `world.levelYaw` adds nothing). North base looks south down the plain,
 * south base looks north.
 */
const plainsRank = (x0, z, yaw) => [
  [x0 - 8, z, yaw],
  [x0, z, yaw],
  [x0 + 8, z, yaw],
];
export const PLAINS_SPAWNS = {
  attack: [-158, -155.5, -153, -150.5, -148, -145.5, -143].flatMap((z) => plainsRank(-14, z, 0)),
  defend: [158, 155.5, 153, 150.5, 148, 145.5, 143].flatMap((z) => plainsRank(14, z, Math.PI)),
};

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE MAP TABLE — the seam that lets a second level have its own geography
 * ────────────────────────────────────────────────────────────────────────────
 * `resolveLayout` used to read the module-level `ZONES`/`SITES`/`SPAWNS`
 * directly, which is the whole reason `src/match` was single-map: the zones were
 * not merely tuned for the town, they were the ONLY zones that existed.
 *
 * The selector is `world.level.id` — published by `src/world/index.js` — and NOT
 * a second copy of the query string, because two places parsing `?map=` is two
 * places to disagree and the failure would be silent: the match would resolve
 * the town's five zones onto the plain's ground, `ensureReachable` would walk
 * each of them up to 35 m looking for a route, and the boot would come back with
 * a playable-looking layout that is geometrically nonsense. An unknown id falls
 * back to the town's table, exactly as `getLevel` falls back to the town.
 */
export const MAPS = {
  town: { zones: ZONES, sites: SITES, spawns: SPAWNS },
  plains: { zones: PLAINS_ZONES, sites: PLAINS_ZONES.slice(0, 2), spawns: PLAINS_SPAWNS },
};

export function layoutFor(world) {
  const id = world?.level?.id;
  const m = id ? MAPS[id] : null;
  if (m) return m;
  if (id) console.warn(`[match] no zone table for map "${id}" — using the town's`);
  return MAPS.town;
}

/**
 * Turn the authored level coordinates into world-space points that a character
 * can actually stand on.
 *
 * The returned list is still called `sites` and every entry still carries
 * `{ id, name, position, radius, hold, flank }`, in domination as in demolition.
 * That is deliberate: `tools/navcheck.mjs`, `sitecheck`, `lanecheck` and
 * `src/match/airstrike.js`'s route proof all read those field names, and a mode
 * change must not quietly turn the map's own gate off.
 *
 * @param {object} world  the `world` subsystem (for levelToWorld)
 * @param {object} ai     the `ai` subsystem (for the nav grid + ground probe)
 * @returns {{sites: Array, spawns: {attack: Array, defend: Array}}}
 */
export function resolveLayout(world, ai) {
  const domination = RULES.mode === MODE.DOMINATION;
  /** WHICH MAP's geography. @see `MAPS` / `layoutFor` above. */
  const map = layoutFor(world);
  const authored = domination ? map.zones : map.sites;
  const defaultRadius = domination ? RULES.captureRadius : RULES.plantRadius;
  const snap = (lx, lz, fx, fz, tag) => {
    const primary = groundPoint(world, ai, lx, lz);
    if (walkable(ai, primary)) return primary;
    const alt = groundPoint(world, ai, fx ?? lx, fz ?? lz);
    console.warn(
      `[match] ${tag}: level (${lx}, ${lz}) is not walkable — using the fallback ` +
        `(${fx}, ${fz})`
    );
    return walkable(ai, alt) ? alt : primary;
  };

  const bake = (list) =>
    list.map(([x, z, yaw]) => ({
      position: groundPoint(world, ai, x, z),
      yaw: yaw + (world?.levelYaw ?? 0),
    }));
  const spawns = { attack: bake(map.spawns.attack), defend: bake(map.spawns.defend) };
  for (const k of ['attack', 'defend']) for (const sp of spawns[k]) walkable(ai, sp.position);

  const sites = authored.map((s) => {
    const position = snap(s.level[0], s.level[1], s.fallback[0], s.fallback[1], `site ${s.id}`);
    ensureReachable(ai, position, spawns, ['attack', 'defend'], `site ${s.id}`, false);
    const hold = groundPoint(world, ai, s.holdLevel[0], s.holdLevel[1]);
    /**
     * A hold point only ever has defenders sent to it. It is anchored with the
     * same relaxed rule the sites use — one defend spawn proving the area is
     * part of the playable map — because the strict "every spawn" version could
     * not be satisfied anywhere within 35 m of either authored point once the
     * interiors went in, so both holds silently collapsed onto the site centre
     * and shouted an error every boot. Individual spawns are proved against the
     * SITES below, and `Agent._advanceFallback` covers the rest.
     */
    const holdOk =
      walkable(ai, hold) &&
      ensureReachable(ai, hold, spawns, ['defend'], `site ${s.id} hold`, false);
    if (holdOk && !sitesReachableFrom(ai, hold, [{ position }])) {
      // A hold you cannot get to the site from is worse than no hold at all.
      console.warn(`[match] site ${s.id} hold: no route on to the site — using the site itself`);
    }
    /**
     * THE FLANK STAGING POINT, and it is allowed to be null.
     *
     * A via-point in the connector that joins the mid street to this lane. It
     * is proved from the ATTACK spawns only — nobody else is ever sent here —
     * and it must also have a route on to the site, or "flank" would mean
     * "walk into a connector and stop". If either fails the point is dropped
     * and `_assignObjectives` simply never orders a flank: a broken flank is a
     * third of the attack standing in an alley, which is worse than no flank.
     */
    let flank = null;
    if (s.flankLevel) {
      const f = groundPoint(world, ai, s.flankLevel[0], s.flankLevel[1]);
      const ok =
        walkable(ai, f) &&
        ensureReachable(ai, f, spawns, ['attack'], `site ${s.id} flank`, false) &&
        sitesReachableFrom(ai, f, [{ position }]);
      if (ok) flank = f;
      else console.warn(`[match] site ${s.id} flank: no usable staging point — flank disabled`);
    }

    const radius = s.radius ?? defaultRadius;
    const zone = {
      id: s.id,
      name: s.name,
      /**
       * AUTHORED SHUT. A locked zone is resolved, proved and painted here like
       * any other and then held out of `MatchSystem.sites` until the match opens
       * it — see the note on D above. Nothing downstream of this file needs to
       * know: `sites` is the live list, and opening one is a push.
       */
      locked: !!s.locked,
      // No per-site override authored: the default lives in rules.js.
      radius,
      position,
      hold: holdOk ? hold : position.clone(),
      flank,
      /** Filled in by the match each round. */
      defenders: [],
      /* ---- domination state, owned by src/match/capture.js ---- */
      /** -1 neutral, else the team id that holds it. */
      owner: -1,
      /** The team currently making progress on it, or -1. */
      capTeam: -1,
      /** 0..1 toward `capTeam` owning it. */
      progress: 0,
      /** Both sides inside the circle ⇒ progress frozen. */
      contested: false,
      /** Live bodies of each team inside the circle, refreshed every tick. */
      counts: [0, 0],
      /** `ctx.time.elapsed` when the current owner took it. */
      ownedSince: 0,
      /**
       * STANDING GROUND INSIDE THE CIRCLE — see `standRing`.
       *
       * Bots are sent to one of these rather than to the centre, so fifteen men
       * taking a point spread over it instead of stacking on one square, and
       * every one of them is provably INSIDE the capture radius. It is also
       * where a forward spawn puts you.
       */
      stand: [],
      /** `[{position, yaw}]` per team, for `_safeSpawn`. Built below. */
      spawnFor: [[], []],
    };
    return zone;
  });

  // A SPAWN THAT CANNOT REACH THE OBJECTIVE IS A DEAD MAN. Sites are placed
  // first, then every spawn is proved against them and moved if it fails —
  // navcheck measured two defender spawns sitting in pockets with no route to
  // either site, which is two of seven men standing still all round.
  for (const kind of ['attack', 'defend']) {
    for (let i = 0; i < spawns[kind].length; i++) {
      const sp = spawns[kind][i];
      if (sitesReachableFrom(ai, sp.position, sites)) continue;
      if (!relocateSpawn(ai, sp.position, sites, `${kind} spawn ${i}`)) {
        console.error(`[match] ${kind} spawn ${i}: no nearby ground reaches the sites`);
      }
    }
  }

  /**
   * The standing ring, and the forward spawns cut from it. Domination only —
   * demolition has no use for either and must not pay the path queries.
   */
  if (domination) {
    for (const z of sites) standRing(ai, z, spawns);
    for (const z of sites) {
      for (const team of [0, 1]) {
        /**
         * Face the way the enemy arrives. A forward spawn that puts you looking
         * at your own wall is a free kill for whoever is already in the zone,
         * and `role` here is "which base cluster is NOT yours".
         */
        const foeBase = centroidOf(team === RULES.playerTeam ? spawns.defend : spawns.attack);
        for (const p of z.stand) {
          z.spawnFor[team].push({
            position: p,
            yaw: Math.atan2(foeBase.x - p.x, -(foeBase.z - p.z)) + Math.PI,
          });
        }
      }
      console.info(
        `[match] zone ${z.id} "${z.name}" at ${z.position.x.toFixed(1)}, ` +
          `${z.position.z.toFixed(1)} · r${z.radius} · ${z.stand.length} standing points` +
          (z.locked ? ' · LOCKED until the match opens it' : '')
      );
    }
  }

  /**
   * `sites` is the LIVE list and `all` is every authored zone in order. A locked
   * zone is in `all` and not in `sites`, and opening it is one `push` into the
   * array `CaptureZones`, the HUD, the marks and the objective plan all already
   * hold — @see `MatchSystem._setZoneLive`.
   */
  return { sites: sites.filter((z) => !z.locked), all: sites, spawns };
}

/**
 * Up to `STAND_POINTS` walkable, REACHABLE points inside a zone's circle.
 *
 * Why this exists rather than "send everybody to the centre": `Agent._advance`
 * treats a non-anchored objective as a single destination with a 1 m arrival
 * radius, so fifteen men handed the same Vector3 all try to stand on the same
 * square and local avoidance turns the capture into a scrum at the edge of it.
 * A ring at 0.5 r spreads them across the zone and — the part that matters for
 * the mode working at all — every point is inside the capture radius by
 * construction, so a bot that arrives is a bot that is capturing.
 *
 * Each candidate is snapped to a nav cell and then PROVED: it must have an A*
 * route from at least one spawn of each side, the same relaxed rule the zone
 * centres are anchored with. A standing point nobody can walk to would be a man
 * standing still in an alley, which is the exact failure `ensureReachable`'s
 * header is about.
 */
const STAND_POINTS = 8;
function standRing(ai, zone, spawns) {
  const g = ai?.grid;
  // The centre is always a legal answer — it is snapped and proved above.
  const centre = zone.position;
  if (!g) {
    zone.stand.push(centre.clone());
    return;
  }
  const path = [];
  const reach = (q) => {
    for (const kind of ['attack', 'defend']) {
      let any = false;
      for (const sp of spawns[kind]) if (g.findPath(sp.position, q, path) > 0) { any = true; break; }
      if (!any) return false;
    }
    return true;
  };
  const probe = new THREE.Vector3();
  const r = zone.radius * 0.5;
  for (let i = 0; i < STAND_POINTS; i++) {
    const th = (i / STAND_POINTS) * Math.PI * 2 + 0.31;
    probe.set(centre.x + Math.cos(th) * r, centre.y, centre.z + Math.sin(th) * r);
    if (!walkable(ai, probe)) continue;
    // `walkable` snapped it; two bearings can land on the same cell.
    let dup = false;
    for (const p of zone.stand) if (p.distanceToSquared(probe) < 1.2 * 1.2) dup = true;
    if (dup) continue;
    // And it must still be inside the circle after the snap.
    const dx = probe.x - centre.x;
    const dz = probe.z - centre.z;
    if (dx * dx + dz * dz > zone.radius * zone.radius) continue;
    if (!reach(probe)) continue;
    zone.stand.push(probe.clone());
  }
  if (!zone.stand.length) {
    console.warn(`[match] zone ${zone.id}: no standing ring resolved — using the centre alone`);
    zone.stand.push(centre.clone());
  }
}

/** Mean position of a spawn cluster. Boot-time only; allocates once. */
function centroidOf(list) {
  const out = new THREE.Vector3();
  for (const s of list) out.add(s.position);
  if (list.length) out.multiplyScalar(1 / list.length);
  return out;
}

/** True when `p` has an A* route to every bomb site. */
function sitesReachableFrom(ai, p, sites) {
  const g = ai?.grid;
  if (!g) return true;
  const path = [];
  for (const s of sites) if (g.findPath(p, s.position, path) <= 0) return false;
  return true;
}

/** Walk outward until the spawn can reach every site. Mutates `p`. */
function relocateSpawn(ai, p, sites, tag) {
  const probe = new THREE.Vector3();
  for (let ring = 1; ring <= 16; ring++) {
    const r = ring * 2.2;
    for (let a = 0; a < 12; a++) {
      const th = (a / 12) * Math.PI * 2 + ring * 0.55;
      probe.set(p.x + Math.cos(th) * r, p.y, p.z + Math.sin(th) * r);
      if (!walkable(ai, probe) || !sitesReachableFrom(ai, probe, sites)) continue;
      console.warn(
        `[match] ${tag}: no route to the sites — moved ${r.toFixed(1)} m to ` +
          `${probe.x.toFixed(1)}, ${probe.z.toFixed(1)}`
      );
      p.copy(probe);
      return true;
    }
  }
  return false;
}

/**
 * WALKABLE IS NOT REACHABLE, and the difference is worth a whole team.
 *
 * `walkable()` only asks whether the nav grid has a standable cell near a
 * point. A sealed courtyard, a first-floor room, the inside of a shop — all of
 * them are full of walkable cells and connected to nothing you can get to. When
 * this was not checked, both `hold` points resolved onto walkable ground that
 * NO defender spawn had a route to, so every round `match` sent seven men to an
 * objective A* could not path to and `Agent._advance` did as it was told and
 * stood still. From outside that reads as "the AI went brain-dead".
 *
 * `tools/navcheck.mjs` asserts this same invariant from the outside and is what
 * caught it. This is the in-engine half: prove it at boot, and if the authored
 * point fails, walk outward in rings until one passes, so a layout change can
 * degrade the design intent but can never break the mode.
 *
 * @param {string[]} teams which spawn clusters must be able to get here
 * @returns {boolean} true if `p` ended up reachable (mutated in place if moved)
 */
function ensureReachable(ai, p, spawns, teams, tag, all = true) {
  const g = ai?.grid;
  if (!g) return true;
  const path = [];
  /**
   * `all` picks the strictness. Sites are anchored with `all = false` — one
   * spawn per team is enough to prove the area is part of the playable map —
   * and the individual spawns are then proved against the sites afterwards and
   * moved if they fail. Doing it the other way round makes the two constraints
   * chase each other.
   */
  const connected = (q) => {
    for (const kind of teams) {
      let any = false;
      for (const sp of spawns[kind]) {
        const ok = g.findPath(sp.position, q, path) > 0;
        if (!ok && all) return false;
        if (ok) any = true;
      }
      if (!any) return false;
    }
    return true;
  };
  if (connected(p)) return true;

  const probe = new THREE.Vector3();
  for (let ring = 1; ring <= 16; ring++) {
    const r = ring * 2.2;
    for (let a = 0; a < 12; a++) {
      const th = (a / 12) * Math.PI * 2 + ring * 0.4;
      probe.set(p.x + Math.cos(th) * r, p.y, p.z + Math.sin(th) * r);
      if (!walkable(ai, probe) || !connected(probe)) continue;
      console.warn(
        `[match] ${tag}: authored point is walkable but NOT reachable from every ` +
          `${teams.join('/')} spawn — moved ${r.toFixed(1)} m to ` +
          `${probe.x.toFixed(1)}, ${probe.z.toFixed(1)}`
      );
      p.copy(probe);
      return true;
    }
  }
  console.error(
    `[match] ${tag}: nothing within 35 m is reachable from every ${teams.join('/')} ` +
      'spawn. The level has sealed this area off; bots sent here will have nowhere to walk.'
  );
  return false;
}

/**
 * Level (x, z) -> a world point sitting on the floor.
 *
 * THE PROBE HEIGHT MATTERS. It used to drop a ray from y = 30, which is above
 * everything — so any point that happened to lie inside a building footprint
 * resolved onto its ROOF. A roof is walkable and completely disconnected from
 * the street, which is how both bomb-site hold points ended up unreachable from
 * every spawn while looking perfectly valid. Dropping from 4 m finds the ground
 * floor or the street and cannot see over a wall.
 */
function groundPoint(world, ai, lx, lz) {
  const p = world
    ? world.levelToWorld(lx, 0, lz, new THREE.Vector3())
    : new THREE.Vector3(lx, 0, lz);
  const y = ai?.groundAt?.(p.x, p.z, 4);
  p.y = Number.isFinite(y) ? y : 0;
  return p;
}

/**
 * True when the nav grid has a walkable cell within 2 m and within a metre of
 * this height — i.e. a bot handed this point can path to it. Mutates `p` onto
 * that cell so the authored point and the point bots walk to are the same one.
 */
function walkable(ai, p) {
  const g = ai?.grid;
  if (!g) return true; // no navigation yet: trust the author
  const ci = g.nearest(p.x, p.z, p.y, 3, 1.2);
  if (ci < 0) return false;
  p.set(g.worldX(ci % g.nx), g.floor[ci], g.worldZ((ci / g.nx) | 0));
  return true;
}
