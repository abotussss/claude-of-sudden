/**
 * MATCH — the bomber run.
 *
 * "敵の戦闘機の爆弾投下も適宜行なって。守る側有利にして" — the other half of
 * the air brief. Where `src/match/airstrike.js` drops ONE bomb on ONE building
 * and rearranges it, this is an aircraft that crosses the map and WALKS a stick
 * of bombs along a line. The two are deliberately different weapons:
 *
 *                     airstrike                  bomber run
 *   shape             one point                  a 22-68 m line of 5-8 craters
 *   telegraph         jet, then a whistle        the aeroplane itself, visible
 *                                                for 2.4 s before the first
 *                                                bomb is even released
 *   what it does      takes a storey down and    cuts a lane in half for four
 *                     leaves permanent cover     seconds and leaves craters
 *   the answer        get off that street        get OUT of the lane, and there
 *                                                is no cover inside it that
 *                                                helps, because the stick walks
 *   per bomb          15 m / 260 (or 11 / 190)   9 m / 165
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EVERYTHING IS BAKED AT BOOT. NOTHING IS SOLVED WHEN IT FIRES.
 * ────────────────────────────────────────────────────────────────────────────
 * The same rule as airstrike.js, and the same machinery — this file imports
 * that one's `fracture`, `chunkGeometry`, `mergeGeometries` and, above all,
 * `makeChunkMaterial`, so the debris moves on the identical closed-form vertex
 * program. At `build()`, per run:
 *
 *   - the IMPACT POINTS. Authored as a line in level space; each bomb's ground
 *     height is probed once, here, with the same downward ray the airstrike
 *     uses for its roofs. In the frame a bomb lands there is no raycast.
 *
 *   - the TIMELINE, closed form. Fall time from the release altitude is solved
 *     per bomb (it depends on the ground under that bomb), the aircraft's lead
 *     is `speed * fall`, and from those two the release time and the impact
 *     time of every bomb in the stick are constants. The aeroplane's position
 *     is `start + dir * speed * t`, evaluated into a scratch vector; a bomb's
 *     is `release + dir * speed * dt + (0, -v0*dt - g*dt²/2, 0)`. No
 *     integrator, and nothing that can drift.
 *
 *   - the CRATER DEBRIS, as ONE InstancedMesh for the whole stick: 40 chunks
 *     per bomb, each with its delay set to ITS OWN bomb's impact time. So the
 *     entire run — seven separate bursts, spread over four seconds — is driven
 *     by ONE uniform write per frame, and the frame a bomb lands does no work
 *     for the debris at all. The chunks rest BELOW the tarmac and are lifted
 *     out along their baked arc, which is why the burst reads as ground being
 *     thrown up rather than as boxes appearing.
 *
 *   - the SETTLED POSE, pre-filled, memcpy'd into `instanceMatrix` when the
 *     dust is down exactly as the airstrike does it.
 *
 * WHAT IT DELIBERATELY DOES NOT BAKE is collision and navigation. A crater is
 * a hole and a scatter of grit, not a mound: there is nothing here for a man to
 * climb or to be blocked by, so the BVH and `ai.grid` are never touched. That
 * is not a shortcut, it is the reason a bomber run can be scheduled three times
 * a round on the attackers' route without `tools/navcheck.mjs` ever being able
 * to regress.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * …AND THE PLANE UNDER A RUN IS NOT A CONSTANT OF THE MAP
 * ────────────────────────────────────────────────────────────────────────────
 * 「宙にうく物体はまだ大聖堂の上に残ってますよ」, reported three times, fixed
 * three times, and photographed the fourth. Every gate said zero because the
 * debris CARRIES NO COLLISION — `_floatcheck` reconstructs the physics world and
 * is structurally blind to it — while the player was looking at a swarm of dark
 * cubes in clear sky over the razed cathedral.
 *
 * The cause is the boot probe above. MAIN and CROSS both cross the cathedral,
 * and measured at ?seed=7 the mid street has its nave roof at 15.2 m on it and
 * the cross street has the aisle roof at 9.0 m as well: 5 of the 23 impacts on
 * this map are on a 29 m building, and `world.cathedral.setRazed` takes that
 * building away in the middle of a match. The bomb, its crater, its scorch and
 * its forty chunks of spoil stay where the boot bake put them, 5.4 to 14.5 m
 * above the ruin.
 *
 * TWO ANSWERS WERE CONSIDERED AND ARE WRONG, and they are written down so they
 * are not re-derived:
 *   - probe the razed plane once, `host: 'cathedral'`-style. `Airstrike` may do
 *     that because `MatchSystem._razeCathedral` GUARANTEES the shell is gone
 *     `cathedralRazeDelay` after those sites fire. Nothing guarantees anything
 *     about when a bomber run is scheduled, so a single razed-state bake makes
 *     every bomb before the collapse detonate at nave-FLOOR level and drop its
 *     spoil through a roof that is still standing.
 *   - re-author the lines off the church. The cathedral is legitimately what is
 *     on the mid street and the cross street; moving the lines is moving the
 *     weapon off the two corridors it exists to price.
 *
 * So it is `Airstrike._bakeHostVariants`'s answer, which is this project's
 * answer to destruction everywhere: BAKE AT BOOT, SWAP AT FIRE TIME. Each run
 * that stands over a building that can stop existing carries A SECOND COMPLETE
 * POSE — impact heights, fall times, release points, the buried rest pose, the
 * settled pose and the throw between them — solved at boot with that building's
 * COLLISION swapped out and back, and the frame the host actually falls is a
 * scatter of pre-solved floats over the entries that host owns. Nothing is
 * solved on that frame and nothing at all is solved on a fire frame.
 * @see `_bakeHostVariants`, `_syncHosts`.
 *
 * The frame a bomb lands does: one `explosion` event, one uniform write that
 * was going to happen anyway, and three `fx` calls that write into preallocated
 * rings.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLIC API   const b = ctx.get('match').bomber
 * ────────────────────────────────────────────────────────────────────────────
 *   b.runs                   [{ id, name, bombs, ... }]  world space
 *   b.fire(indexOrId)        launch a run now
 *   b.flown(index)           has this one already been flown this round?
 *   b.reset()                round reset: craters gone, debris back under
 *   b.enabled                false stops the scheduler
 *   b.busy                   true while an aircraft is in the air
 *   b.setFocus(v)            where the fight is; biases which line is flown
 *   b.onAnnounce = (a) => {} the moment a run is launched, with the reused
 *                            announce record. `match` turns it into the HUD
 *                            warning — see src/ui/airalert.js for why a weapon
 *                            nobody is told about did not happen.
 *   b.onImpact = (a) => {}   the first bomb of the stick going off
 *
 * Emits `match:bomber { phase, run, position }` with phase
 * 'inbound' | 'impact' | 'settled'.
 */

import * as THREE from 'three';
import { RULES } from './rules.js';
import { chunkGeometry, clamp, makeChunkMaterial, mergeGeometries } from './airstrike.js';
import { forMap, townScaled, PLAINS } from './geography.js';

/** The town's 1.5x, stated once in `geography.js` and aliased to the name the
 *  table below already uses. The plain's tables need no transform at all. */
const L = townScaled;

/**
 * THE RUNS, as the line the BOMBS land on — not the line the aeroplane flies.
 *
 * Authoring the impact line is the only way to place this weapon honestly: the
 * aircraft's track is that line pushed back by `speed * fall`, which is 67 m,
 * and no one can author 67 m of lead in their head and be right about where the
 * craters end up.
 *
 * WHERE THEY ARE — the same geometric argument as `STRIKE_SITES`, measured off
 * the map's own A*:
 *
 *     attack spawn -> either site   level z from +66.7 down to  -5.8
 *     defend spawn -> either site   level z from -67.1 up   to  -5.0
 *
 * Every one of the 23 impact points below is at level z between +4.0 and +40.0.
 * All four runs are therefore entirely inside the half of the map the attack
 * must cross and outside the half the defence walks, so a bomber run can only
 * ever be paid for by the side that is pushing. They are also kept clear of
 * both spawn clusters — the attack's nearest spawn point is at z = +51.2 and
 * the northernmost impact is at z = +40.0, which is 11.2 m, more than the 9 m
 * blast. A stick of bombs in a spawn is not a hazard, it is a coin flip.
 *
 * A BOMBER FLIES STRAIGHT, and that is a real constraint on where these can go.
 * The first pass at this file authored the lines as "spawn to site", which on
 * paper follows the attack — and a straight line from the east connector to the
 * B lane goes clean over a block of buildings, so four of seven bombs in that
 * stick landed on ROOFTOPS (probed at 9.6 m) and did nothing to anybody in the
 * lane below. The four lines below are each along ONE open corridor of the map,
 * checked at boot: `_buildRun` prints every impact that is more than 3 m off
 * the deck, and all 23 currently come in at or under 1.1 m.
 *
 * The map's open ground, from a 3 m roof-height sweep of the level:
 *
 *      west lane   L(-36.3)..L(-30.3)   running in z, 9.0 m across
 *      mid street  L(-13.0)..L(-11.0) and L(11.0)..L(14.7), either side of
 *                                       the cathedral standing in it
 *      east lane   L( 30.7)..L( 36.3)   running in z, 8.5 m across
 *      cross st.   L( 24.7)..L( 31.3)   running in x, the full width of the map
 *
 * …AND THAT TABLE IS THE RE-MEASUREMENT, NOT THE ORIGINAL. The original was in
 * WORLD space and predated `widenX`, and it is what put ALANE and BLANE on a
 * rooftop for as long as the gate has been complaining about them. It is in
 * LEVEL space now, because the town is yawed 33.7° and a world-space sweep
 * crosses every street diagonally — which is what a table quoted in world x
 * cannot say. @see the note on ALANE/BLANE below and `_decksweep.mjs`.
 *      north st.   z +39..+45      running in x
 *
 *   MAIN   down the mid street both branches walk out of spawn.
 *   CROSS  the full width of the cross street — 68 m, the longest run on the
 *          map, and the band where BOTH branches turn out of the trunk toward
 *          their lane. One aircraft prices both routes at once.
 *   ALANE  down the west lane, the last open stretch before site A.
 *   BLANE  down the east lane, the same for site B.
 */
const TOWN_RUNS = [
  { id: 'MAIN', name: 'MAIN STREET', from: L(-4.0, 26.67), to: L(-4.0, 12.0), bombs: 5 },
  { id: 'CROSS', name: 'CROSS STREET', from: L(-22.67, 12.0), to: L(22.67, 12.0), bombs: 8 },
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * THE TWO LANES, RE-AUTHORED — they were on the roof, and said so every boot
   * ──────────────────────────────────────────────────────────────────────────
   * These two were at `L(-24.0)` and `L(27.33)`, and `_reportGround` has been
   * printing the consequence since `widenX` landed:
   *
   *     [bomber] ALANE: 4/5 bombs land more than 3 m over the outdoor deck
   *              (6.5 m up) on ground that is there in EVERY state of this map
   *              — the run is over a permanent rooftop, not over a street.
   *     [bomber] BLANE: 4/5 … (9.5, 8.1, 9.5, 9.5 m up)
   *
   * THE GATE WAS RIGHT AND THE TABLE WAS STALE. `widenX` (@see `geography.js`)
   * translated everything outside the old kerb line outward by 9 authored
   * units — both building rows, both lanes and both courtyards — and the two
   * lane lines did not move with them, so each ended up 9 units INSIDE its own
   * lane, which is to say on the roof of the row between the lane and the mid
   * street. The header's quoted sweep ("west lane x -45..-30") is older than
   * that transform and was describing a town that no longer exists.
   *
   * RE-MEASURED LIVE (`_decksweep.mjs`, in LEVEL space — the town is yawed
   * 33.7°, so a world-space sweep crosses every street diagonally and finds
   * nothing), over the exact z span these lines run:
   *
   *     west lane   L(-36.3) .. L(-30.3)   9.0 m wide, worst 1.57 m over deck
   *     mid street  L(-13.0) .. L(-11.0)   and L(11.0) .. L(14.7), either side
   *                                        of the cathedral
   *     east lane   L( 30.7) .. L( 36.3)   8.5 m wide, worst 1.57 m over deck
   *
   * so the centres are L(-33.33) and L(33.50). The west one is the old number
   * plus exactly the 9 units `widenX` moved it; the east one is NOT (33.50, not
   * 36.33), because AL-MARIYA is not symmetric and the measurement is the
   * authority rather than the arithmetic.
   *
   * The z spans, the bomb counts and the directions are untouched: what was
   * wrong with these lines was which strip of ground they were over.
   */
  { id: 'ALANE', name: 'A LANE', from: L(-33.33, 20.0), to: L(-33.33, 2.67), bombs: 5 },
  { id: 'BLANE', name: 'B LANE', from: L(33.5, 18.67), to: L(33.5, 2.67), bombs: 5 },
];

/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD — SIX LINES ON A MAP THAT IS ALL CORRIDOR
 * ════════════════════════════════════════════════════════════════════════════
 * The town's four lines were baked against the plain until this table existed,
 * and unlike the tank routes they at least SAID something was wrong — 3 of
 * MAIN's 5 and 6 of CROSS's 8 came back over "a permanent rooftop". They were
 * wrong about that too (it was the plain's own swell — @see `ROOF_Y`), and the
 * two that did not complain were 40 m lines dropped across empty grass 300 m
 * from anybody. The plain had almost no air war.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT DECIDES WHERE A LINE GOES HERE, AND IT IS A DIFFERENT ARGUMENT
 * ────────────────────────────────────────────────────────────────────────────
 * On the town the constraint is that A BOMBER FLIES STRAIGHT and the map is a
 * street grid, so a line has to lie along one open corridor or four of seven
 * bombs land on roofs. Here every bearing is open, so the constraint is
 * WHERE THE PEOPLE ARE, and that is a different measurement.
 *
 * The town's other rule — every impact on the ATTACK's half of every route —
 * does not transfer either. NACHTFELD is the 1000-point domination map: nobody
 * attacks, each side keeps ONE base for the whole match (`RULES.swapAfterRound`
 * never comes round), and both sides push. A line biased at one base is a line
 * that permanently taxes one team. So the six below are SYMMETRIC IN PAIRS
 * about the origin — the plain's own symmetry, the same one the zone table and
 * the two bases have — and the fire-line pair is the exception that proves it,
 * being the flank both sides use.
 *
 * MEASURED CLEARANCES, all of them:
 *
 *   SPAWNS. The blast is `RULES.bombRadius` 9 m. North ranks stand at x -22..-6,
 *   z -158..-143; south at x 6..22, z 143..158. The nearest impact on any line
 *   below is 31 m from the nearer rank — more than three blast radii — so no
 *   stick can ever land in a spawn. A stick in a spawn is not a hazard, it is a
 *   coin flip.
 *
 *   THE WORKS. The control tower stands on the D pad at (0, -32) with a 25.4 m
 *   radius, and the fortress and the trenches are still landing. Nothing here
 *   crosses the tower's footprint: the closest line passes 26 m from its
 *   centre. A bomb that lands on a structure is a bomb that did nothing to
 *   anybody in the field, and `_reportGround` is the gate that says so.
 *
 *   THE MOUNTAIN. The walkable disc ends at r 176 and the face past it is 50-64°
 *   of rock nobody stands on. Every impact below is inside r 169.
 *
 * THREE PAIRS, and what each of them prices:
 *
 *   NORTHFAN / SOUTHFAN   across the fan of ground each base's three columns
 *                         spread into, 31 m clear of the ranks. The one line
 *                         that prices a push before it has gone anywhere.
 *   WESTFLANK / EASTFLANK the long side corridors, the A-C and E-B runs. These
 *                         are the rotations: 190 m between the zones at each end
 *                         and no cover on the way.
 *   CENTREWEST /          the two lanes either side of the works. The tower and
 *   CENTREEAST            the fortress between them occupy |x| < 36 from z -58
 *                         to z +84, which is most of the middle of the map, so
 *                         the ground everything crossing it has to use is the
 *                         two 20 m gaps beside them.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND THE PAIR THAT IS NOT HERE: A RUN ON THE BURNING RIDGE
 * ────────────────────────────────────────────────────────────────────────────
 * `PLAINS.fires` publishes five burning sites and the obvious thing to do with
 * them is to bomb one. MEASURED, IT IS NOT WORTH A LINE. Every fire sits on the
 * mountain FACE — `plains.js` puts each at `RIDGE_R0 + (RIDGE_R1 - RIDGE_R0) *
 * h`, i.e. r 188 to 203, and the walkable disc ends at r 176 with a 50-64° slope
 * past it that `NavGrid` refuses. So the five sites in world space are
 *
 *     FIRE-NW (-150,-132)  FIRE-N (79,-177)  FIRE-E (197,48)
 *     FIRE-SE (41,191)     FIRE-S (-172,99)
 *
 * and a stick of bombs on any of them is seven craters on a cliff nobody can
 * stand on. There is no room to put one at the FOOT of a fire either: the two
 * fires nearest the play are FIRE-NW and FIRE-S, and A (-118,-104) and
 * C (-128,86) already stand 19 and 25 m off the foot under them — the line
 * would be a line through a capture circle.
 *
 * WHAT THE FIRES ACTUALLY DO FOR THIS TABLE is decide which of these lines can
 * be seen at night, and that is not nothing: FIRE-NW lights NORTHFAN's west end
 * and WESTFLANK's north half, FIRE-S the rest of WESTFLANK, FIRE-E the whole of
 * EASTFLANK, and FIRE-N and FIRE-SE stand behind the two fans, so an aircraft
 * running either of them crosses a lit horizon and is a silhouette rather than a
 * noise. That is what a 600 cd point light at 240 m range is for.
 */
const PLAINS_RUNS = [
  { id: 'NORTHFAN', name: 'THE NORTH FAN', from: [-80, -112], to: [10, -112], bombs: 7 },
  { id: 'SOUTHFAN', name: 'THE SOUTH FAN', from: [80, 112], to: [-10, 112], bombs: 7 },
  { id: 'WESTFLANK', name: 'THE WEST FLANK', from: [-124, -40], to: [-124, 40], bombs: 6 },
  { id: 'EASTFLANK', name: 'THE EAST FLANK', from: [124, 40], to: [124, -40], bombs: 6 },
  /**
   * CENTREWEST MOVED -58 -> -47, ON A RE-MEASUREMENT. The fieldworks that have
   * gone in beside the tower since this line was authored put one of its seven
   * bombs 3.6 m over the outdoor deck and `_reportGround` said so every boot.
   * Swept live in level space (`_decksweep.mjs`, x -56..-40 over this line's own
   * z span): x -49.5..-44.0 is 5.5 m wide with a worst of 0.35 m, against a
   * corridor at -58 that no longer exists. CENTREEAST is NOT moved to match —
   * it measures clear at +58 and the works are not symmetric.
   */
  { id: 'CENTREWEST', name: 'WEST OF THE WORKS', from: [-47, -50], to: [-47, 40], bombs: 7 },
  { id: 'CENTREEAST', name: 'EAST OF THE WORKS', from: [58, 40], to: [58, -50], bombs: 7 },
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * …AND THE TWO THAT CROSS THE WHOLE MAP, WHICH ONLY THIS MAP HAS ROOM FOR
   * ──────────────────────────────────────────────────────────────────────────
   * Every line above runs in z — they are the six N-S corridors, because that
   * is the axis the fight moves along. NOTHING CROSSED, and on a 350 m plain
   * that is a horizon the player never has to watch: six aircraft a match, all
   * six flying the same way.
   *
   * These two run in x, 184 m from side to side, and they are the reason the
   * plain rather than the town gets them: AL-MARIYA is 114 m wide with a
   * building row every 20 m, so a line across it is a line over roofs. Here it
   * is 184 m of open grass and nine craters walking the full width of the map.
   *
   * THE Z VALUES ARE THE TWO GAPS THE WORKS LEAVE. `plains-tower.js` and
   * `plains-fort.js` occupy |x| < 36 from z -58 to z +84 (@see `PLAINS_ROUTES`
   * in tank.js, which measures the same hollow), so a line in x has to clear
   * that block or it drops bombs on the tower roof — the exact failure
   * `_reportGround` exists to catch. -76 is 18 m north of it and +96 is 12 m
   * south of it, both on open ground.
   *
   * THE ENDS ARE PULLED IN TO ±92 for the clearance every other line in this
   * table keeps: at ±104 the west end of SOUTHCROSS would be 16 m from B's
   * centre, i.e. inside the 14 m capture circle plus nothing. At ±92 the
   * nearest zone centre to any impact is 27 m (B from SOUTHCROSS's east end)
   * and 37-38 m for the rest, which is the same "prices the approach, does not
   * bomb the point" the six lines above are authored to.
   */
  { id: 'NORTHCROSS', name: 'THE NORTH TRAVERSE', from: [-92, -76], to: [92, -76], bombs: 9 },
  { id: 'SOUTHCROSS', name: 'THE SOUTH TRAVERSE', from: [92, 96], to: [-92, 96], bombs: 9 },
];

/**
 * ════════════════════════════════════════════════════════════════════════════
 * …AND THE LINES NOBODY AUTHORED — 「ランダムに広範囲に一列爆撃にして それを定期的に」
 * ════════════════════════════════════════════════════════════════════════════
 * 「空爆は占領サイトに落とすのではなくそれ以外の平原にランダムに広範囲に一列爆撃に
 *  して それを定期的に起こす / 占領サイトへの直接はダメ / ただし破壊オブジェ＋占領
 *  サイトの場所には落としてもいい」
 *
 * Five requirements, and this table is the first four of them:
 *
 *   一列爆撃      a STICK walking a line, which is what this whole file is
 *   ランダムに     the line is drawn rather than authored
 *   広範囲に      anywhere on the 350 m plain, not on six fixed corridors
 *   定期的に      through the match — @see `bomberMaxPerRound` in rules.js
 *   占領サイトへの直接はダメ   no impact inside a capture circle, ever
 *
 * The fifth — 「破壊オブジェ＋占領サイトの場所には落としてもいい」 — is what keeps
 * the two NACHTFELD acts legal, and it needs no code here: `NF-TOWER` and
 * `NF-FORT` are `world.demolitions` records at zone D, they are fired by
 * `Airstrike.callDemolition` off `MAP_ACTS`, and nothing below touches them.
 * This table does NOT take the exception for itself. It could — D is a
 * structure and a capture point at the same time — but a randomised line is
 * not a scored act, and a bomb that lands on the point by chance is
 * indistinguishable to the man standing on it from the rule being broken.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * RANDOM AT BOOT, DRAWN AT FIRE TIME. NOTHING IS SOLVED WHEN IT FIRES.
 * ────────────────────────────────────────────────────────────────────────────
 * This is the one constraint that decides the shape. A bomber run is a baked
 * object — the impact heights, the release points, the closed-form timeline,
 * 40 chunks of crater debris per bomb with their delays and their settled
 * poses — and none of that can be solved in the frame the aeroplane launches
 * (@see the header). So "random" means A POOL OF RANDOM LINES BAKED AT BOOT
 * and a draw over the pool at fire time, which is exactly what `_scheduleNext`
 * already does over the authored ones. `count` lines cost `count * bombs * 40`
 * chunks and about a millisecond each of bake.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EVERY CANDIDATE IS PROVED AGAINST THE REAL GROUND, AND THAT IS THE POINT
 * ────────────────────────────────────────────────────────────────────────────
 * The reason this file's plains table has never been randomised before is the
 * failure at the top of `src/match/airstrike.js`: `_findRoof` accepts any plane
 * at 3 m, NACHTFELD's swell crosses 3 m over most of its northern half, and
 * importing the town's anchors built 2 682 chunks of masonry hanging in a
 * field. A randomised line over undulating ground with a fortress, a control
 * tower, fourteen trench lines and a growing field of wrecks on it is that
 * hazard again, and an authored table at least gets read by a human once.
 *
 * So `plainsOpenRuns` DOES NOT AUTHOR AND THEN WARN. It probes every impact
 * point of every candidate with the same two calls `_reportGround` uses —
 * `physics.groundHeight` for what is actually there, `world.groundHeight` for
 * the outdoor deck — and REJECTS the whole line if any point stands more than
 * `ROOF_Y` over the deck. Measured against the deck and never against zero,
 * which is the fix `ROOF_Y`'s own note records and which this must not regress.
 * That is a stronger guarantee than the authored lines have: it holds no
 * matter what anybody builds on this map tomorrow, because it is a measurement
 * of the map as it stands at boot rather than a number somebody wrote down.
 */
const PLAINS_OPEN = {
  /** How many candidate lines to bake. @see the pool note above. */
  count: 14,
  /** Metres of ground one stick walks. 「広範囲に」 is this and `count` together. */
  len: [96, 168],
  /** Bombs in the stick, so spacing lands at 12-24 m — the authored table's. */
  bombs: [7, 10],
  /**
   * Metres from the map centre an endpoint may reach. `RIDGE_R0` is 176 and
   * the rim boundary stands just inside it; 154 keeps the whole line, its
   * blast radius and its debris on ground a man can actually be standing on.
   */
  reach: 154,
  /**
   * Metres of clear air between any impact and the EDGE of a capture circle.
   * `captureRadius` is 14 on this map and `bomberRadius` is 9, so 24 m of
   * margin puts the nearest lethal ring 15 m outside the circle: a man on the
   * point is never in the blast, and a man who has just stepped off it is not
   * either. 「占領サイトへの直接はダメ」 is not a near-miss rule.
   */
  clear: 24,
  /** …and the same from a base pad, so nobody is bombed in his own spawn. */
  spawnClear: 46,
  /** Metres between the midpoints of two accepted lines — spread, not a cluster. */
  apart: 44,
  /** Draws before the generator gives up and ships what it has. */
  tries: 1600,
};
/** The town authors its four and randomises none: @see `TOWN_RUNS`. */
const MAP_OPEN = { town: null, plains: PLAINS_OPEN };

/**
 * Draw `spec.count` open-ground lines that no capture circle, no base pad and
 * no standing structure intersects.
 *
 * @param {object} spec    `PLAINS_OPEN`
 * @param {object} rng     a fork — this must not disturb anybody else's stream
 * @param {object} world   for `levelToWorld` and the analytic deck
 * @param {object} physics for what is ACTUALLY standing at a point
 * @param {Array}  zones   the RESOLVED capture points, `{ position, radius }`
 * @returns {Array} run specs in the same shape as the authored table
 */
export function plainsOpenRuns(spec, rng, world, physics, zones) {
  const out = [];
  const mid = [];
  const p = new THREE.Vector3();
  /**
   * THE ZONES ARE THE RESOLVED ONES, NOT A COPY OF THE TABLE. `sites.js`
   * authors a centre and `ensureReachable` MOVES it when the point it names is
   * not standable — up to 35 m on this map's own history — so a keep-out
   * measured off the authored number is a keep-out around where the point used
   * to be. `match` hands these in from `allZones`.
   */
  const keep = [];
  for (const z of zones ?? []) {
    if (!z?.position) continue;
    keep.push([z.position.x, z.position.z, (z.radius ?? 14) + spec.clear]);
  }
  keep.push([PLAINS.BASE_N[0], PLAINS.BASE_N[1], spec.spawnClear]);
  keep.push([PLAINS.BASE_S[0], PLAINS.BASE_S[1], spec.spawnClear]);

  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

  for (let t = 0; t < spec.tries && out.length < spec.count; t++) {
    // Uniform over the disc: sqrt, or every line starts near the middle.
    const a0 = rng.float() * Math.PI * 2;
    const r0 = Math.sqrt(rng.float()) * spec.reach;
    const ax = Math.cos(a0) * r0;
    const az = Math.sin(a0) * r0;
    const head = rng.float() * Math.PI * 2;
    const len = rng.range(spec.len[0], spec.len[1]);
    const bx = ax + Math.cos(head) * len;
    const bz = az + Math.sin(head) * len;
    if (Math.hypot(bx, bz) > spec.reach) continue;

    const mx = (ax + bx) * 0.5;
    const mz = (az + bz) * 0.5;
    let crowded = false;
    for (const m of mid) if (Math.hypot(mx - m[0], mz - m[1]) < spec.apart) { crowded = true; break; }
    if (crowded) continue;

    const n = rng.int(spec.bombs[0], spec.bombs[1]);
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const u = i / (n - 1);
      const x = ax + (bx - ax) * u;
      const z = az + (bz - az) * u;
      for (const k of keep) {
        if (Math.hypot(x - k[0], z - k[1]) < k[2]) { ok = false; break; }
      }
      if (!ok) break;
      /**
       * AND IS ANYTHING STANDING HERE? The rooftop gate, applied as an
       * ACCEPTANCE test rather than as a warning. @see the note above.
       */
      world.levelToWorld(x, 0, z, p);
      const deck = world.groundHeight(p.x, p.z);
      const h = physics.groundHeight(p.x, p.z, 60);
      if (Number.isFinite(h) && h - deck > ROOF_Y) ok = false;
    }
    if (!ok) continue;

    const bearing = (Math.atan2(bx - ax, -(bz - az)) * 180) / Math.PI;
    const c = COMPASS[(((Math.round(bearing / 22.5) % 16) + 16) % 16)];
    mid.push([mx, mz]);
    out.push({
      id: `OPEN-${out.length + 1}`,
      name: `OPEN GROUND — ${c}`,
      from: [ax, az],
      to: [bx, bz],
      bombs: n,
      open: true,
    });
  }
  return out;
}

/**
 * THE RUNS, PER MAP. @see `forMap` in `src/match/geography.js` —
 * `world.level.id`, never a second parse of `?map=`.
 */
const MAP_RUNS = { town: TOWN_RUNS, plains: PLAINS_RUNS };

/** Release altitude above the highest ground on the run, metres. */
const ALT = 42;
/** Aircraft ground speed, m/s. Slow for an aeroplane, readable for a player. */
const SPEED = 38;
/** Downward speed a bomb leaves the bay with — a shallow dive, not a level drop. */
const DROP_V = 14;
const G = 9.81;
/** How far back the aircraft enters before the first release point. */
const APPROACH = 90;
/** How far past the last release it keeps flying before it is put away. */
const EXIT = 120;
/** Chunks of tarmac and grit thrown out of each crater. */
const CHUNKS_PER_BOMB = 40;
/** Seconds after the last impact before the debris is baked down. */
const DEBRIS_SETTLE = 4.5;
/**
 * Slack round a perishable building's own radius when deciding whether a run is
 * even ASKED about it. Same value and same job as `Airstrike`'s: it only picks
 * who is measured, and everything it picks is then measured with real rays.
 */
const HOST_REACH = 6.0;
/** Metres a probe must move before a host is judged to have moved the ground. */
const HOST_EPS = 0.05;
/**
 * A bomb this far ABOVE THE OUTDOOR DECK is on a roof rather than in the street
 * the line was authored for.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IT IS MEASURED AGAINST `world.groundHeight`, NOT AGAINST ZERO
 * ────────────────────────────────────────────────────────────────────────────
 * This was an absolute 3 m, and on the town that is the same thing: `groundY`
 * there is the street, the street is at 0.05 m, and the lowest eaves in the kit
 * are 6.5 m up, so "above 3" and "on a building" agree everywhere.
 *
 * NACHTFELD'S GROUND IS NOT AT ZERO. Its swell runs -5.6 to +3.8 m and crosses
 * 3 m over a good part of the north half, so the absolute test called the PLAIN
 * ITSELF a rooftop: booting the town's lines against it printed "6/8 bombs land
 * above 3 m (3.2, 3.2, …) — the run is over a permanent rooftop", about eight
 * craters in open grass. A gate that cries wolf on flat ground is a gate nobody
 * reads on the day a line really does go over a roof.
 *
 * `world.groundHeight` is the level's own analytic outdoor floor — `reliefY` on
 * the town, `plainsY` on the plain — so the difference is exactly "how much
 * building is standing under this impact", on any map, with no per-map number.
 * @see `_reportGround`.
 */
const ROOF_Y = 3;
/** Metres above a crater a settle/burial ray starts from. @see `_crown`. */
const SETTLE_PROBE = 6;

const UP = new THREE.Vector3(0, 1, 0);
/**
 * Where the aircraft and the bombs sit when there is no run on.
 *
 * NOT `visible = false`, which is what this did first and what cost 174 ms ON
 * THE FIRE FRAME: three.js compiles a material's program the first time it is
 * actually drawn, so hiding the hardware until the run starts moves three
 * shader compiles onto the one frame the whole feature exists to keep cheap.
 * Parked 600 m under the map they are drawn from the first boot frame — inside
 * the loading state, where every other program in the game is also compiled —
 * and cost one culled draw call each thereafter. The crater debris does not
 * need this trick: its rest pose is already buried, so it is on screen from
 * boot and simply not visible.
 */
const PARKED_Y = -600;

/* -------------------------------------------------------------------------- */

/**
 * ────────────────────────────────────────────────────────────────────────────
 * EVERY BUILDING ON THIS MAP THAT CAN STOP EXISTING, AS ONE LIST
 * ────────────────────────────────────────────────────────────────────────────
 * The two destroyed-state publishers `world` already has, behind one shape: a
 * circle on the plan, a COLLISION-ONLY swap, and a live `down` flag. It is the
 * same list `Airstrike._perishables` builds for the same reason, rebuilt here
 * rather than imported because it is four lines of `world`'s PUBLIC contract
 * and reaching into another site's private cache to save them would be worse.
 *
 * COLLISION ONLY, NEVER THE PICTURE. The whole point of `world`'s
 * `setVisual`/`setCollision` split is that a probe may re-ask what the ground
 * is with the building still visibly standing, at boot, with no frame drawn
 * between — and `setCollision` neither touches `cathedral.razed` nor fires
 * `onRaze`, so a bake cannot start somebody else's collapse.
 *
 * `world.breaches` is deliberately NOT here, for the reason `airstrike.js`
 * gives: a breach takes one ground-storey elevation off and leaves the storeys
 * above standing on their jambs, so nothing's settle plane moves. Measured for
 * these runs too — `_runhost.mjs` swaps all six `world.demolitions` and the
 * cathedral one at a time and reports which impacts move.
 *
 * `strafe.js` imports this. It is the one thing the two air files share beyond
 * `airstrike.js`'s chunk machinery, and duplicating it would be two places to
 * fix when `world` gains a third destructible.
 *
 * @param {object} world
 * @param {object} physics
 * @returns {Array<{id:string, centre:THREE.Vector3, reach:number,
 *                  probeSwap:(down:boolean)=>void, isDown:()=>boolean}>}
 */
export function perishableHosts(world, physics) {
  const out = [];
  for (const rec of world?.demolitions ?? []) {
    if (typeof rec.setCollision !== 'function' || !rec.position) continue;
    out.push({
      id: rec.id,
      centre: rec.position.clone(),
      reach: (rec.radius ?? Math.hypot(rec.halfW ?? 8, rec.halfD ?? 8)) + HOST_REACH,
      probeSwap: (down) => rec.setCollision(down),
      isDown: () => !!rec.down,
    });
  }
  const k = world?.cathedral;
  if (k && typeof k.setCollision === 'function' && k.level) {
    out.push({
      id: 'CATHEDRAL',
      centre: world.levelToWorld(k.level.x, 0, k.level.z, new THREE.Vector3()),
      reach: Math.hypot(k.halfW ?? 15, k.halfD ?? 22.5) + HOST_REACH,
      probeSwap: (down) => k.setCollision(down, physics),
      isDown: () => !!k.razed,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */

export class Bomber {
  /**
   * @param {object} ctx   engine context
   * @param {object} opts  { rng }
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.rng = opts.rng ?? ctx.rng.fork();
    this.enabled = true;
    this.runs = [];
    /**
     * THE RESOLVED CAPTURE POINTS, for the randomised open-ground lines to keep
     * out of. `match` hands these in from `allZones` for the same reason it
     * hands them to `Airstrike`: `match` owns the layout, `ensureReachable`
     * MOVES a point that is not standable, and a keep-out measured off the
     * authored table is a keep-out around where the point used to be.
     * @see `plainsOpenRuns`.
     */
    this.zones = opts.zones ?? null;
    /** How many of `runs` were drawn rather than authored, for the boot line. */
    this._openN = 0;
    /** How many lines THIS MAP authored, so the boot fraction is honest. */
    this._runN = 0;
    this.ready = false;
    this.buildMs = 0;

    /** Runs currently in the air. At most one — the scheduler enforces it. */
    this._live = [];
    /** Seconds until the scheduler may launch. Set by `armRound`. */
    this._next = Infinity;
    /** Runs flown this round, against `RULES.bomberMaxPerRound`. */
    this._flown = 0;
    /**
     * The other air systems, so no two ever share the sky. Set by `match`;
     * accepts one object or an array. @see `_coBusy`
     */
    this.coBusy = null;

    /**
     * WHERE THE FIGHT IS. Four fixed lines on a 114x141 m map means three runs
     * out of four are somewhere the player is not — the same "空爆が全然発生し
     * ない" problem the airstrike has, for the same reason. `match` writes the
     * centre of the fight here and the draw is weighted by the distance from it
     * to the NEAREST POINT ON THE LINE, which is the right measure for a weapon
     * that is 68 m long.
     */
    this.focus = new THREE.Vector3();
    this.focusValid = false;
    this.focusScale = 30;

    /** Announce hooks, installed by `match`. */
    this.onAnnounce = null;
    this.onImpact = null;

    this.group = new THREE.Group();
    this.group.name = 'match-bomber';
    this.group.matrixAutoUpdate = false;

    /* scratch — nothing in update() or fire() allocates */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._sc = new THREE.Vector3();
    this._blast = { position: this._v2, radius: 0, damage: 0, source: 'bomber' };
    this._ev = { phase: '', run: '', position: this._v2 };
    /** The announce record. REUSED; `points` holds references, never copies. */
    this._ann = {
      kind: 'BOMBER',
      id: '',
      name: '',
      lead: 0,
      position: null,
      points: [null, null, null, null],
      count: 0,
    };
    this._cand = [];
    this._wt = [];

    /**
     * Every (run, host) binding on the map, flat, so the per-frame compare is
     * one loop over a list that is normally two entries long.
     * @see `_bakeHostVariants`
     */
    this._variants = [];
    this._hostBakeMs = 0;
    /** Scratch bomb for the boot-time re-solve. Never touched after `build`. */
    this._probeBomb = {
      impact: new THREE.Vector3(),
      release: new THREE.Vector3(),
      fall: 0,
      tRelease: 0,
      tImpact: 0,
      tPlane: 0,
    };
  }

  /** True while any co-system (airstrike, strafe) has something in the air. */
  get _coBusy() {
    const c = this.coBusy;
    if (!c) return false;
    if (Array.isArray(c)) {
      for (const o of c) if (o?.busy) return true;
      return false;
    }
    return !!c.busy;
  }

  /** Where the fight is. Copied; the caller's vector is not retained. */
  setFocus(v) {
    if (!v) {
      this.focusValid = false;
      return;
    }
    this.focus.copy(v);
    this.focusValid = true;
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
      console.warn('[bomber] no world/physics — disabled');
      return this;
    }
    this.physics = physics;
    this._lib = ctx.peek('materials');

    /**
     * WHICH MAP'S LINES, and it is resolved BEFORE the hardware because
     * `_buildBombs` sizes its InstancedMesh off the longest stick in the table.
     * @see `MAP_RUNS`.
     */
    const authored = forMap(MAP_RUNS, world, 'bomber runs');
    /**
     * …PLUS THE ONES NOBODY AUTHORED. Drawn here, BEFORE `_buildBombs`, because
     * that sizes its InstancedMesh off the longest stick in the table and a
     * stick it has never seen would overrun the bay. @see `plainsOpenRuns`.
     */
    const openSpec = forMap(MAP_OPEN, world, 'open-ground bombing');
    const open = openSpec
      ? plainsOpenRuns(openSpec, this.rng.fork(), world, physics, this.zones)
      : [];
    this._openN = open.length;
    if (openSpec && open.length < openSpec.count) {
      console.warn(
        `[bomber] open-ground lines: ${open.length}/${openSpec.count} drawn in ${openSpec.tries} tries — ` +
          'the plain has less clear ground than the generator assumes'
      );
    }
    const specs = authored.concat(open);
    this._runN = specs.length;

    this._buildAircraft();
    this._buildBombs(specs);
    // Both parked under the map from the first frame — see PARKED_Y.
    this._park();
    for (let i = 0; i < specs.length; i++) {
      const run = this._buildRun(specs[i], i, world, physics);
      if (run) this.runs.push(run);
    }
    // The second pose per run, and only then the report — what "over a rooftop"
    // means is a different sentence once we know whether the roof survives the
    // match. @see `_bakeHostVariants`.
    this._bakeHostVariants(world, physics);
    this._reportGround();

    ctx.scene.add(this.group);
    this.ready = this.runs.length > 0;
    this.buildMs = performance.now() - t0;
    let chunks = 0;
    for (const r of this.runs) chunks += r.chunkCount;
    console.info(
      `[bomber] ${this.runs.length}/${this._runN} runs baked in ${this.buildMs.toFixed(0)}ms ` +
        `(${this._openN} drawn over open ground, clear of every capture circle) — ` +
        `${chunks} debris chunks, ` +
        this.runs
          .map((r) => `${r.id}:${r.bombs.length}x${r.spacing.toFixed(1)}m/${r.duration.toFixed(1)}s`)
          .join(' ')
    );
    return this;
  }

  /**
   * The aeroplane. One mesh, boxes merged at boot, +Z forward.
   *
   * It exists to be READ at 40 m against the sky in the two and a half seconds
   * before the first bomb is released, which is the only telegraph this weapon
   * has — so the silhouette carries it: a long fuselage, a straight high-aspect
   * wing, two underslung nacelles and a tall fin. It is kept out of the shadow
   * cascades (`owNoShadow`): a 17 m wingspan at 42 m sits outside the near
   * cascades and only ever costs a cascade draw for a shadow nobody sees.
   */
  _buildAircraft() {
    const box = (w, h, d, x, y, z) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      return g;
    };
    const geo = mergeGeometries([
      box(2.0, 2.0, 12.0, 0, 0, 0), // fuselage
      box(1.3, 1.3, 2.8, 0, -0.15, 7.0), // nose
      box(1.35, 0.85, 2.6, 0, 1.1, 3.0), // canopy
      box(17.0, 0.5, 3.6, 0, -0.35, -0.6), // wing
      box(6.4, 0.42, 2.0, 0, 0.45, -5.6), // tailplane
      box(0.42, 3.2, 2.4, 0, 1.9, -5.4), // fin
      box(1.55, 1.55, 4.4, 4.2, -1.05, 0.6), // port nacelle
      box(1.55, 1.55, 4.4, -4.2, -1.05, 0.6), // starboard nacelle
      box(0.45, 0.9, 1.2, 4.2, -0.5, 0.6), // pylons
      box(0.45, 0.9, 1.2, -4.2, -0.5, 0.6),
    ]);
    const mat = this._hullMaterial('metal_painted', 0x4a5048);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'match_bomber_aircraft';
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.userData.owNoShadow = true;
    this.group.add(mesh);
    this.aircraft = mesh;
    this.aircraftMat = mat;
  }

  /**
   * The bombs themselves, one InstancedMesh sized to the longest stick.
   *
   * `count` is set to how many are in the air, and because releases are evenly
   * spaced and every fall in a stick takes very nearly the same time, the bombs
   * in flight are always a contiguous run — so the live ones can be packed into
   * slots 0..k-1 and the draw call shrinks to nothing between runs.
   */
  _buildBombs(specs) {
    let most = 0;
    for (const r of specs) most = Math.max(most, r.bombs);
    const body = new THREE.CylinderGeometry(0.19, 0.15, 1.35, 8, 1);
    const nose = new THREE.ConeGeometry(0.19, 0.5, 8);
    nose.translate(0, 0.92, 0);
    const finA = new THREE.BoxGeometry(0.5, 0.42, 0.05);
    finA.translate(0, -0.78, 0);
    const finB = new THREE.BoxGeometry(0.05, 0.42, 0.5);
    finB.translate(0, -0.78, 0);
    const geo = mergeGeometries([body, nose, finA, finB]);
    const mat = this._hullMaterial('metal_rust', 0x6d6a62);
    const mesh = new THREE.InstancedMesh(geo, mat, most);
    mesh.name = 'match_bomber_bombs';
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    // One instance, parked, so the program is compiled at boot rather than on
    // the frame the bay doors open. See PARKED_Y.
    mesh.count = 1;
    mesh.userData.owNoShadow = true;
    this.group.add(mesh);
    this.bombMesh = mesh;
    this.bombMat = mat;
  }

  /**
   * A private instance of a library surface for the hardware.
   *
   * Same reasoning as `Airstrike._makeMaterial`: `materials.get()` hands back a
   * SHARED material and this one wants its own tint, so it is built on top of
   * the library's baked texture set instead. The level's own albedo, normal and
   * ORM bakes come through, which is what keeps the airframe off the quality
   * bar's "no flat/untextured surfaces".
   */
  _hullMaterial(name, tint) {
    const set = this._lib?.getTextureSet?.(name) ?? null;
    const mat = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.62,
      metalness: 0.25,
      dithering: true,
    });
    mat.name = `bomber_${name}`;
    if (set) {
      mat.map = set.albedo;
      mat.normalMap = set.normal;
      mat.normalScale.set(0.8, 0.8);
      mat.roughnessMap = set.orm;
    }
    this.ctx.peek('render')?.patcher?.patch(mat);
    return mat;
  }

  /* ----------------------------------------------------------- one run --- */

  _buildRun(spec, index, world, physics) {
    const rng = this.rng.fork();
    const a = world.levelToWorld(spec.from[0], 0, spec.from[1], new THREE.Vector3());
    const b = world.levelToWorld(spec.to[0], 0, spec.to[1], new THREE.Vector3());
    const dir = new THREE.Vector3().subVectors(b, a);
    const span = dir.length();
    if (!(span > 4)) {
      console.error(`[bomber] ${spec.id}: run is ${span.toFixed(1)} m long — DROPPED`);
      return null;
    }
    dir.multiplyScalar(1 / span);
    const n = spec.bombs;
    const spacing = span / Math.max(1, n - 1);

    /* ---- impact points, probed once ---------------------------------- */
    const bombs = [];
    let topY = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3().copy(a).addScaledVector(dir, spacing * i);
      const h = physics.groundHeight(p.x, p.z, 60);
      /** The outdoor deck under this impact, for the rooftop gate. @see `ROOF_Y`. */
      const deck = world.groundHeight(p.x, p.z);
      p.y = Number.isFinite(h) ? h : deck;
      topY = Math.max(topY, p.y);
      bombs.push({
        impact: p,
        deck,
        tRelease: 0,
        tImpact: 0,
        /** The aircraft's own life, implied by THIS bomb's release. @see `_retime`. */
        tPlane: 0,
        fall: 0,
        release: new THREE.Vector3(),
      });
    }

    /* ---- the timeline, closed form ----------------------------------- */
    /**
     * Release altitude is above the HIGHEST ground on the run, so the aircraft
     * clears the tallest roof under it by the same margin everywhere.
     *
     * IT IS BAKED IN THE STATE THE LEVEL BOOTS IN AND NEVER MOVES AGAIN, and
     * that is deliberate. `alt` and `start` are the AEROPLANE, and the
     * aeroplane's track is the whole telegraph of this weapon — a run whose
     * flight path jumped 12 m the moment somebody else's building fell would be
     * a different aircraft on a different line. Razing the host only makes the
     * aircraft's clearance over that ground larger, never smaller.
     */
    const alt = topY + ALT;
    for (const bomb of bombs) this._solveDrop(bomb, alt, dir);
    const start = new THREE.Vector3().copy(bombs[0].release).addScaledVector(dir, -APPROACH);
    for (const bomb of bombs) this._solveTimes(bomb, start);

    const run = {
      id: spec.id,
      name: spec.name,
      index,
      bombs,
      spacing,
      dir,
      start,
      alt,
      /** For the HUD / the event payload: the middle of the stick. */
      position: new THREE.Vector3().copy(a).addScaledVector(dir, span * 0.5),
      planeTime: 0,
      lastImpact: 0,
      settleAt: 0,
      duration: 0,
      yaw: Math.atan2(dir.x, dir.z),
      flown: false,
      active: false,
      baked: false,
      next: 0,
      t: -1,
      chunkCount: n * CHUNKS_PER_BOMB,
      /** Alternative poses, one per perishable building under this run. */
      hostVariants: [],
      uniforms: {
        /** Seconds since this run started; negative before it. */
        uT: { value: -1 },
        /** 1 while the baked curve drives the debris, 0 once it is baked in. */
        uAnim: { value: 1 },
      },
    };
    this._retime(run);
    run.material = makeChunkMaterial(this.ctx, this._lib, 'asphalt', run.uniforms);
    run.debris = this._buildDebris(run, rng, physics);
    return run;
  }

  /* --------------------------------------------- one bomb, closed form --- */

  /**
   * How long this bomb falls, and where it has to leave the bay to land where
   * it is authored to. `v0` down, constant g: `t = (-v0 + sqrt(v0² + 2gh)) / g`.
   *
   * A LONGER FALL MOVES THE RELEASE BACK, NOT THE CRATER FORWARD. The impact
   * point is the authored quantity; the release is derived from it. That is
   * also what makes the alternative pose cheap — with `start` fixed, dropping
   * the ground under a bomb moves its release BACKWARDS by exactly `SPEED·Δfall`
   * and its release TIME earlier by `Δfall`, so `tImpact` barely moves and the
   * stick still walks in the order and at the rate it was authored at.
   */
  _solveDrop(bomb, alt, dir) {
    const drop = Math.max(0.5, alt - bomb.impact.y);
    bomb.fall = (-DROP_V + Math.sqrt(DROP_V * DROP_V + 2 * G * drop)) / G;
    bomb.release.copy(bomb.impact).addScaledVector(dir, -SPEED * bomb.fall);
    bomb.release.y = alt;
  }

  /** …and when, given where the aircraft enters. `start` never moves. */
  _solveTimes(bomb, start) {
    const s = start.distanceTo(bomb.release);
    bomb.tRelease = Math.max(0, s / SPEED);
    bomb.tImpact = bomb.tRelease + bomb.fall;
    bomb.tPlane = (s + EXIT) / SPEED;
  }

  /**
   * The four run-level clocks, re-reduced from whatever the bombs currently say.
   *
   * This is the ONLY arithmetic `_syncHosts` does, and it is a max over at most
   * eight floats plus three adds. It is a reduction rather than a fifth pair of
   * baked scalars on purpose: a run standing over TWO perishable buildings has
   * four states and no pair can express them, whereas a reduction over the live
   * per-bomb values is exact in all four. Measured on this map exactly one
   * building ever binds, so it is a reduction over eight numbers that never
   * disagree — and it stays right if a second one ever appears.
   */
  _retime(run) {
    const b = run.bombs;
    let last = 0;
    for (let i = 0; i < b.length; i++) if (b[i].tImpact > last) last = b[i].tImpact;
    run.lastImpact = last;
    run.planeTime = b[b.length - 1].tPlane;
    run.settleAt = last + DEBRIS_SETTLE;
    run.duration = Math.max(run.planeTime, run.settleAt) + 0.2;
  }

  /**
   * One InstancedMesh for the whole stick's craters.
   *
   * The only thing that distinguishes bomb 3's debris from bomb 0's is the
   * DELAY baked into `aMot.x` — bomb i's chunks simply do not start until
   * `tImpact[i]`. That is what lets seven bursts spread over four seconds run
   * off a single uniform, and it is the same trick the airstrike uses to make
   * the break run through a mass instead of the whole thing moving at once.
   */
  _buildDebris(run, rng, physics) {
    const n = run.chunkCount;
    const geo = chunkGeometry();
    const mesh = new THREE.InstancedMesh(geo, run.material, n);
    mesh.name = `bomber_${run.id}_debris`;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Drawn from the first boot frame, and invisible because the rest pose is
    // under the tarmac. Out of the cascades and the prepass until it settles:
    // both draw through an override material that does not carry our vertex
    // program, so they would put the buried pose in the depth buffer.
    mesh.userData.owNoShadow = true;
    mesh.userData.owNoPrepass = true;

    const mot = new Float32Array(n * 4);
    const off = new Float32Array(n * 3);
    const axis = new Float32Array(n * 3);
    const uv = new Float32Array(n * 3);
    const settled = new Float32Array(n * 16);
    const colour = new Float32Array(n * 3);

    const pos = new THREE.Vector3();
    const settlePos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const q2 = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const m4 = new THREE.Matrix4();
    const ax = new THREE.Vector3();
    const tint = new THREE.Color();
    /**
     * Tarmac, the sub-base under it, and the dust the two make together.
     *
     * LIGHTENED after reading the frames back: the first pass ran 0x4a4844 to
     * 0x8c8378, which is the right hue for asphalt and the wrong VALUE for
     * asphalt lying broken on a pale street in direct sun. It read as a scatter
     * of black cubes rather than as broken road. The bottom of the range is now
     * about where the airstrike's concrete palette sits, and the top is the
     * pulverised sub-base, which is the light one in every real crater photo.
     */
    const palette = [0x6f6a62, 0x847d73, 0x9c9488, 0xb2a897];

    /**
     * WHAT THE SECOND POSE NEEDS AND CANNOT RE-DRAW.
     *
     * The alternative pose is solved from the same three rules as this one, so
     * the only things it needs back are the DICE: which bomb owns each chunk,
     * how deep it was buried, how far its own half-extent lifts it off the
     * plane it settles on, and the sub-frame jitter on its delay. Everything
     * else — the scatter angles, the spin, the arc, the tint — is identical in
     * both states and is never re-drawn. @see `_solveState`.
     */
    const owner = new Uint16Array(n);
    const dig = new Float32Array(n);
    const lift = new Float32Array(n);
    const jitter = new Float32Array(n);

    let k = 0;
    for (let bi = 0; bi < run.bombs.length; bi++) {
      const bomb = run.bombs[bi];
      for (let i = 0; i < CHUNKS_PER_BOMB; i++, k++) {
        owner[k] = bi;
        /* ---- rest pose: UNDER the road ------------------------------- */
        // Buried, so nothing is visible until the bomb that owns this chunk
        // lands and the baked arc lifts it out of its own crater.
        const ra = rng.float() * Math.PI * 2;
        const rr = Math.sqrt(rng.float()) * 1.1;
        const rx = bomb.impact.x + Math.cos(ra) * rr;
        const rz = bomb.impact.z + Math.sin(ra) * rr;
        dig[k] = rng.range(0.8, 2.0);
        pos.set(rx, this._crown(bomb, rx, rz, physics) - dig[k], rz);
        const size = rng.range(0.16, 0.52);
        scale.set(size, size * rng.range(0.4, 0.95), size * rng.range(0.6, 1.25));
        q.setFromAxisAngle(
          ax.set(rng.signed(), rng.signed(), rng.signed()).normalize(),
          rng.range(-Math.PI, Math.PI)
        );
        m4.compose(pos, q, scale);
        m4.toArray(mesh.instanceMatrix.array, k * 16);

        /* ---- where it lands ------------------------------------------ */
        // Thrown out of the crater, biased flat: a bomb in a road throws a
        // shallow fan, not a fountain.
        const sa = rng.float() * Math.PI * 2;
        const sr = 1.4 + Math.sqrt(rng.float()) * 6.2;
        settlePos.set(
          bomb.impact.x + Math.cos(sa) * sr,
          0,
          bomb.impact.z + Math.sin(sa) * sr
        );
        const floor = physics.groundHeight(settlePos.x, settlePos.z, bomb.impact.y + SETTLE_PROBE);
        lift[k] = size * 0.36;
        settlePos.y = (Number.isFinite(floor) ? floor : bomb.impact.y) + lift[k];

        /* ---- the curve, solved here and never again ------------------- */
        // The delay is this bomb's impact time. Six hundredths of a second of
        // jitter on top, so a crater does not empty itself on one frame.
        jitter[k] = rng.range(0, 0.06);
        mot[k * 4] = bomb.tImpact + jitter[k];
        mot[k * 4 + 1] = clamp(Math.sqrt((2 * (sr * 0.55 + 1.2)) / G) * rng.range(1.1, 2.0), 0.5, 2.2);
        mot[k * 4 + 2] = rng.range(0.7, 1.0) * (1.1 + sr * 0.24);
        mot[k * 4 + 3] = rng.range(2.2, 9.5) * (rng.float() < 0.5 ? -1 : 1);

        off[k * 3] = settlePos.x - pos.x;
        off[k * 3 + 1] = settlePos.y - pos.y;
        off[k * 3 + 2] = settlePos.z - pos.z;

        ax.set(rng.signed(), rng.signed() * 0.5, rng.signed()).normalize();
        axis[k * 3] = ax.x;
        axis[k * 3 + 1] = ax.y;
        axis[k * 3 + 2] = ax.z;

        uv[k * 3] = rng.float();
        uv[k * 3 + 1] = rng.float();
        uv[k * 3 + 2] = rng.range(0.5, 1.3);

        q2.setFromAxisAngle(ax, mot[k * 4 + 3]);
        q2.multiply(q);
        m4.compose(settlePos, q2, scale);
        m4.toArray(settled, k * 16);

        tint.setHex(palette[(rng.u32() >>> 3) % palette.length]);
        const g = rng.range(0.78, 1.16);
        colour[k * 3] = tint.r * g;
        colour[k * 3 + 1] = tint.g * g;
        colour[k * 3 + 2] = tint.b * g;
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.rest = new Float32Array(mesh.instanceMatrix.array);
    mesh.userData.settled = settled;
    run.owner = owner;
    run.dig = dig;
    run.lift = lift;
    run.jitter = jitter;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colour, 3);
    mesh.instanceColor.needsUpdate = true;
    geo.setAttribute('aMot', new THREE.InstancedBufferAttribute(mot, 4));
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
    geo.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 3));
    geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 3));
    mesh.updateMatrix();
    this.group.add(mesh);
    return mesh;
  }

  /**
   * The plane a chunk is buried UNDER, which is not always its own bomb's.
   *
   * A crater's spoil is drawn inside a 1.1 m disc round the impact, and a bomb
   * on a 4 m canopy or on a cathedral aisle has some of that disc hanging over
   * the street beside it. Burying those chunks `dig` metres under THE BOMB'S
   * plane leaves them in open air off the edge of the roof — measured at
   * ?seed=7 on the untouched map, 27 of BLANE's 200 and 6 of CROSS's 320 sat
   * 1.5 m or more above the pavement with nothing over them and nothing under
   * them, on the INTACT level, with no event fired. They are the same defect as
   * the settled chunks over the cathedral and they were there first.
   *
   * So the burial plane is the LOWER of the bomb's own and the chunk's own —
   * one extra ray per chunk at boot, and the rest pose is under a surface
   * everywhere instead of under the surface the middle of the crater is on. It
   * changes nothing that is ever drawn: the rest pose exists to be invisible.
   */
  _crown(bomb, x, z, physics) {
    const g = physics.groundHeight(x, z, bomb.impact.y + SETTLE_PROBE);
    return Number.isFinite(g) && g < bomb.impact.y ? g : bomb.impact.y;
  }

  /* ====================================================================== */
  /* THE BUILDING UNDER THE RUN, WHICH MAY NOT BE THERE LATER               */
  /* ====================================================================== */

  /**
   * ────────────────────────────────────────────────────────────────────────
   * ONE ALTERNATIVE POSE PER (RUN, HOST), SOLVED AT BOOT
   * ────────────────────────────────────────────────────────────────────────
   * `Airstrike._bakeHostVariants` bakes a second rest pose for the handful of
   * its chunks that are thrown clear onto somebody else's doomed roof. This is
   * the same move with a bigger subject: for these four lines the host is not
   * under a few stray chunks, it is under the IMPACT POINTS — so what carries a
   * second pose is the whole run, bomb heights and all.
   *
   * WHAT IS BAKED: for each state of the host, every bomb's impact height, fall
   * time, release point, release time, impact time and implied plane time, and
   * every chunk's buried rest height, settled height, throw offset and delay.
   * All of it absolute, never as a delta applied and unapplied — every buffer
   * here is a `Float32Array` and `x + d - d` is not always `x`, so absolute
   * values make the swap idempotent over a round reset that stands the church
   * back up and puts it down again.
   *
   * WHAT IS SOLVED WHEN THE HOST FALLS: nothing. `_syncHosts` is a scatter of
   * pre-solved floats plus `_retime`, which is a max over eight numbers.
   *
   * `probeSwap`, never `setRazed`: this pass must not touch
   * `world.cathedral.razed` and must not fire `onRaze`. Collision only, and the
   * level is left in exactly the state it was called in — `_runhost.mjs`
   * re-probes every impact afterwards and asserts a drift of zero.
   */
  _bakeHostVariants(world, physics) {
    const hosts = perishableHosts(world, physics);
    if (!hosts.length || !this.runs.length) return;
    const t0 = performance.now();
    let bound = 0;
    let rays = 0;

    for (const run of this.runs) {
      for (const host of hosts) {
        // The plan test only decides WHO IS ASKED. A run that goes nowhere near
        // a building skips it without firing a ray, which is 27 of the 28
        // (run, host) pairs on this map.
        if (!this._runNear(run, host)) continue;
        /**
         * ONE HOST PER RUN, AND IT IS CHECKED RATHER THAN ASSUMED.
         *
         * `_solveState` re-solves THE WHOLE RUN, so a second binding's two
         * states would both carry whatever the first host happened to be doing
         * while they were probed, and applying either would clobber the other.
         * Measured on this map — `_runhost.mjs`, all six `world.demolitions`
         * and the cathedral swapped one at a time — the cathedral is the only
         * building that moves anything under any of these four lines, so this
         * has never fired. If `world` ever gains a destructible that overlaps
         * one of them, this says so at boot instead of drawing the wrong
         * answer, and the fix is a sparse per-entry variant like
         * `Airstrike._makeVariant`'s.
         */
        if (run.hostVariants.length) {
          console.error(
            `[bomber] ${run.id} already binds ${run.hostVariants[0].host.id} and ${host.id} is a ` +
              'SECOND perishable building under the same run. A whole-run pose pair cannot ' +
              'express four states — the second binding is DROPPED and its ground will not be ' +
              'followed. @see _bakeHostVariants.'
          );
          continue;
        }
        const was = host.isDown();
        host.probeSwap(false);
        const up = this._solveState(run, physics);
        host.probeSwap(true);
        const down = this._solveState(run, physics);
        host.probeSwap(was);
        rays += 2 * (run.bombs.length + run.chunkCount * 2);
        if (!this._statesDiffer(up, down)) continue;

        const v = { run, host, up, down, applied: null };
        run.hostVariants.push(v);
        this._variants.push(v);
        bound++;
        const moved = [];
        for (let i = 0; i < run.bombs.length; i++) {
          if (Math.abs(up.impactY[i] - down.impactY[i]) > HOST_EPS) {
            moved.push(`${up.impactY[i].toFixed(1)}→${down.impactY[i].toFixed(1)}`);
          }
        }
        let chunks = 0;
        for (let k = 0; k < run.chunkCount; k++) {
          if (Math.abs(up.settledY[k] - down.settledY[k]) > HOST_EPS
            || Math.abs(up.restY[k] - down.restY[k]) > HOST_EPS) chunks++;
        }
        console.info(
          `[bomber] ${run.id}: ${moved.length}/${run.bombs.length} bombs and ${chunks}/` +
            `${run.chunkCount} chunks stand on ${host.id} — second pose baked ` +
            `(${moved.join(', ')} m)`
        );
      }
    }
    // …and put every run into the state the level is ACTUALLY in right now,
    // which is a no-op when that is the state the base bake ran in and is the
    // correction under `?cath=down`.
    this._syncHosts(true);

    this._hostBakeMs = performance.now() - t0;
    if (bound) {
      console.info(
        `[bomber] perishable hosts: ${bound} run/host binding(s) carry a second pose ` +
          `(${rays} rays, ${this._hostBakeMs.toFixed(0)}ms)`
      );
    }
  }

  /** Is any part of this run — a crater or a chunk — inside `host`'s circle? */
  _runNear(run, host) {
    const rr = host.reach * host.reach;
    for (const b of run.bombs) {
      const dx = b.impact.x - host.centre.x;
      const dz = b.impact.z - host.centre.z;
      if (dx * dx + dz * dz <= rr) return true;
    }
    const s = run.debris.userData.settled;
    for (let k = 0; k < run.chunkCount; k++) {
      const dx = s[k * 16 + 12] - host.centre.x;
      const dz = s[k * 16 + 14] - host.centre.z;
      if (dx * dx + dz * dz <= rr) return true;
    }
    return false;
  }

  /**
   * The whole run, re-solved against the collision the level has RIGHT NOW.
   *
   * Same three rules as the boot bake and no fourth one, which is what makes
   * the two states comparable: the impact point is the first surface under the
   * line, the rest pose is `dig` under the lower of its bomb's plane and its
   * own, and the settled pose is `lift` over the plane it lands on. The dice
   * are never re-drawn — `run.dig`, `run.lift` and `run.jitter` are the draws
   * the first bake made.
   */
  _solveState(run, physics) {
    const n = run.bombs.length;
    const nc = run.chunkCount;
    const s = {
      impactY: new Float64Array(n),
      fall: new Float64Array(n),
      tRelease: new Float64Array(n),
      tImpact: new Float64Array(n),
      tPlane: new Float64Array(n),
      relX: new Float64Array(n),
      relZ: new Float64Array(n),
      restY: new Float32Array(nc),
      settledY: new Float32Array(nc),
      offY: new Float32Array(nc),
      delay: new Float32Array(nc),
    };
    const bomb = this._probeBomb;
    for (let i = 0; i < n; i++) {
      const src = run.bombs[i];
      const h = physics.groundHeight(src.impact.x, src.impact.z, 60);
      bomb.impact.set(src.impact.x, Number.isFinite(h) ? h : src.impact.y, src.impact.z);
      this._solveDrop(bomb, run.alt, run.dir);
      this._solveTimes(bomb, run.start);
      s.impactY[i] = bomb.impact.y;
      s.fall[i] = bomb.fall;
      s.tRelease[i] = bomb.tRelease;
      s.tImpact[i] = bomb.tImpact;
      s.tPlane[i] = bomb.tPlane;
      s.relX[i] = bomb.release.x;
      s.relZ[i] = bomb.release.z;
    }
    const rest = run.debris.userData.rest;
    const settled = run.debris.userData.settled;
    for (let k = 0; k < nc; k++) {
      const bi = run.owner[k];
      bomb.impact.set(run.bombs[bi].impact.x, s.impactY[bi], run.bombs[bi].impact.z);
      const rx = rest[k * 16 + 12];
      const rz = rest[k * 16 + 14];
      s.restY[k] = this._crown(bomb, rx, rz, physics) - run.dig[k];
      const sx = settled[k * 16 + 12];
      const sz = settled[k * 16 + 14];
      const f = physics.groundHeight(sx, sz, s.impactY[bi] + SETTLE_PROBE);
      s.settledY[k] = (Number.isFinite(f) ? f : s.impactY[bi]) + run.lift[k];
      s.offY[k] = s.settledY[k] - s.restY[k];
      s.delay[k] = s.tImpact[bi] + run.jitter[k];
    }
    return s;
  }

  /** True when the two states put anything anywhere different. */
  _statesDiffer(a, b) {
    for (let i = 0; i < a.impactY.length; i++) {
      if (Math.abs(a.impactY[i] - b.impactY[i]) > HOST_EPS) return true;
    }
    for (let k = 0; k < a.restY.length; k++) {
      if (Math.abs(a.restY[k] - b.restY[k]) > HOST_EPS) return true;
      if (Math.abs(a.settledY[k] - b.settledY[k]) > HOST_EPS) return true;
    }
    return false;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE COMPARE, ONCE A FRAME — the same move `Airstrike._syncHosts` makes
   * ────────────────────────────────────────────────────────────────────────
   * `world.demolitions[].down` and `world.cathedral.razed` are written by the
   * salvo, the round reset, `forceDemoNav`, `?demo=down`, `?cath=down`, the
   * cathedral beat sheet and half a dozen probes. ARCHITECTURE.md already says
   * why that is READ rather than hooked: "six flags and a compare cannot be
   * wired up wrong". When nothing changed it is one boolean read per binding.
   *
   * `isDown` IS THE COLLISION, NOT THE PICTURE, and the two are written
   * together everywhere it reads from — `setRazed` does the shell and the ruin
   * in one call — so there is no frame on which a crater has been moved onto
   * ground that is not there yet.
   *
   * THE ONE ROUGH EDGE, STATED: a host that falls while this run's own bombs
   * are in the air moves them mid-stick, and a chunk already on its arc takes a
   * step of `Δ · u` on that frame. It needs the cathedral to come down inside
   * the ten seconds one bomber run lasts, and the alternative is cratering a
   * roof that has gone.
   *
   * @param {boolean} force  ignore the cached state (the boot bake's own apply)
   */
  _syncHosts(force = false) {
    const list = this._variants;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      const down = v.host.isDown();
      if (!force && down === v.applied) continue;
      v.applied = down;
      this._applyState(v.run, down ? v.down : v.up);
    }
  }

  /** Scatter one pre-solved state over a run. No arithmetic but `_retime`. */
  _applyState(run, s) {
    if (!run) return;
    const n = run.bombs.length;
    for (let i = 0; i < n; i++) {
      const b = run.bombs[i];
      b.impact.y = s.impactY[i];
      b.fall = s.fall[i];
      b.tRelease = s.tRelease[i];
      b.tImpact = s.tImpact[i];
      b.tPlane = s.tPlane[i];
      b.release.set(s.relX[i], run.alt, s.relZ[i]);
    }
    this._retime(run);

    const mesh = run.debris;
    const rest = mesh.userData.rest;
    const settled = mesh.userData.settled;
    const inst = mesh.instanceMatrix.array;
    const off = mesh.geometry.getAttribute('aOff');
    const mot = mesh.geometry.getAttribute('aMot');
    // What is DRAWN is the settled pose once the dust is down and the buried
    // rest pose at every other moment, so the live matrix follows whichever the
    // run is currently showing.
    const live = run.baked;
    for (let k = 0; k < run.chunkCount; k++) {
      rest[k * 16 + 13] = s.restY[k];
      settled[k * 16 + 13] = s.settledY[k];
      off.array[k * 3 + 1] = s.offY[k];
      mot.array[k * 4] = s.delay[k];
      inst[k * 16 + 13] = live ? s.settledY[k] : s.restY[k];
    }
    off.needsUpdate = true;
    mot.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * WHAT GROUND DOES EACH RUN ACTUALLY HAVE, IN EVERY STATE THE MAP HAS?
   * ────────────────────────────────────────────────────────────────────────
   * The old line said "N bombs land above 3 m — the run is over rooftops. Re-
   * author the line" and printed it for MAIN and CROSS, whose roof is the
   * cathedral. It was true and it was the wrong instruction: the cathedral is
   * legitimately what is on the mid street, and 15.2 m IS the ground that run
   * has until the church comes down. Meanwhile the same line printed for ALANE
   * and BLANE, whose roofs are PERMANENT and where it is the right instruction,
   * and the two were indistinguishable.
   *
   * So the report separates them. A bomb on a building that can stop existing
   * is reported with both of its heights and is not a warning; a bomb that is
   * on a roof in EVERY state the map can be in is the authoring mistake the
   * check was written to find, and only that is a warning.
   */
  _reportGround() {
    for (const run of this.runs) {
      const n = run.bombs.length;
      const perishable = [];
      const permanent = [];
      for (let i = 0; i < n; i++) {
        let lo = run.bombs[i].impact.y;
        let hi = lo;
        for (const v of run.hostVariants) {
          lo = Math.min(lo, v.up.impactY[i], v.down.impactY[i]);
          hi = Math.max(hi, v.up.impactY[i], v.down.impactY[i]);
        }
        // A bomb a host MOVES is that host's, whatever the two heights are —
        // the ruin's own crest is still ground the run has. Only a bomb NO
        // state of the map ever lowers is an authored line over a rooftop.
        if (hi - lo > HOST_EPS) perishable.push(`${hi.toFixed(1)}→${lo.toFixed(1)}`);
        else if (hi - run.bombs[i].deck > ROOF_Y) permanent.push(hi - run.bombs[i].deck);
      }
      const host = run.hostVariants.map((v) => v.host.id).join('+');
      if (permanent.length) {
        console.warn(
          `[bomber] ${run.id}: ${permanent.length}/${n} bombs land more than ${ROOF_Y} m ` +
            `over the outdoor deck (${permanent.map((y) => y.toFixed(1)).join(', ')} m up) ` +
            'on ground that is there in ' +
            'EVERY state of this map — the run is over a permanent rooftop, not over a ' +
            'street. Re-author the line.'
        );
      }
      if (perishable.length) {
        console.info(
          `[bomber] ${run.id}: ${perishable.length}/${n} bombs land on ${host}, which the ` +
            `match can take away (${perishable.join(', ')} m) — both poses baked, and the ` +
            'crater follows the building down.'
        );
      }
      if (!permanent.length && !perishable.length) {
        console.info(`[bomber] ${run.id}: all ${n} bombs land on the street in every state.`);
      }
    }
  }

  /* ====================================================================== */
  /* THE RUN                                                                */
  /* ====================================================================== */

  /**
   * Launch `which` now. There is no separate telegraph call because the
   * aircraft IS the telegraph: it is on screen and audible for
   * `bombs[0].tRelease` seconds (2.4 s) before the first bomb even leaves it,
   * and another 1.7 s of fall after that.
   */
  fire(which = 0) {
    const run = this._runOf(which);
    if (!run || run.flown) return false;
    const ctx = this.ctx;

    run.flown = true;
    run.active = true;
    run.baked = false;
    run.next = 0;
    run.t = 0;
    this._live.push(run);

    run.uniforms.uT.value = 0;
    run.uniforms.uAnim.value = 1;
    run.debris.userData.owNoShadow = true;
    run.debris.userData.owNoPrepass = true;
    this._poseAircraft(run, 0);

    const audio = this._audio ?? (this._audio = ctx.peek('audio'));
    if (audio?.play) {
      // Placed on the AEROPLANE, not on the target: the point of this telegraph
      // is that you look up and find out which lane it is about to be.
      this._v.copy(run.start);
      audio.play('strike_jet', this._v, {
        level: 1.1, dur: 4.6, maxDist: 460, gain: 3.4, occlusion: 0,
      });
    }

    console.info(
      `[bomber] RUN ${run.id} at t=${ctx.time.elapsed.toFixed(1)}s — ` +
        `${run.bombs.length} bombs ${run.spacing.toFixed(1)} m apart, ` +
        `first away +${run.bombs[0].tRelease.toFixed(2)}s, first down ` +
        `+${run.bombs[0].tImpact.toFixed(2)}s, last down +${run.lastImpact.toFixed(2)}s`
    );
    // THE STICK IS A LINE, so the warning marks the line: the first crater, the
    // middle and the last. One marker in the middle of a 68 m run would tell the
    // player to stand exactly where the fourth bomb lands. Announced before the
    // event goes out, so a listener sees the HUD already warned.
    this._announce(this.onAnnounce, run, run.bombs[0].tImpact);
    this._emit('inbound', run);
    return true;
  }

  /** Fill the reused announce record and hand it to a hook. No allocation. */
  _announce(hook, run, lead) {
    if (!hook) return;
    const a = this._ann;
    const n = run.bombs.length;
    a.kind = 'BOMBER';
    a.id = run.id;
    a.name = run.name;
    a.lead = Math.max(0.3, lead);
    a.position = run.position;
    a.count = 0;
    a.points[a.count++] = run.bombs[0].impact;
    if (n > 2) a.points[a.count++] = run.bombs[(n / 2) | 0].impact;
    if (n > 1) a.points[a.count++] = run.bombs[n - 1].impact;
    hook(a);
  }

  flown(which = 0) {
    return !!this._runOf(which)?.flown;
  }

  /** True while an aircraft is in the air. */
  get busy() {
    return this._live.length > 0;
  }

  /* ====================================================================== */
  /* frame                                                                  */
  /* ====================================================================== */

  /**
   * @param {number} dt
   * @param {boolean} live  true only while the round is being played
   */
  update(dt, live) {
    if (!this.ready) return;
    // One boolean read per binding when nothing has changed, and a scatter of
    // pre-solved floats on the one frame a building under a run stops existing.
    if (this._variants.length) this._syncHosts();

    let flying = null;
    for (let i = this._live.length - 1; i >= 0; i--) {
      const run = this._live[i];
      run.t += dt;
      run.uniforms.uT.value = run.t;

      /* ---- the bombs that have arrived ------------------------------- */
      while (run.next < run.bombs.length && run.bombs[run.next].tImpact <= run.t) {
        // The HUD's warning switches to its impact read on the FIRST crater; the
        // rest of the stick is the same event still arriving.
        if (run.next === 0) this._announce(this.onImpact, run, 0.3);
        this._detonate(run, run.bombs[run.next]);
        run.next++;
      }

      /* ---- the aeroplane and whatever is still falling ---------------- */
      if (run.t <= run.planeTime) {
        this._poseAircraft(run, run.t);
        flying = run;
      } else {
        this._park();
      }
      this._poseBombs(run);

      if (!run.baked && run.t >= run.settleAt) this._bakeSettled(run);
      if (run.t >= run.duration) {
        run.active = false;
        this._live.splice(i, 1);
      }
    }
    if (!flying) this._park();

    /* ---- scheduler --------------------------------------------------- */
    if (!live || !this.enabled) return;
    this._next -= dt;
    if (this._next > 0) return;
    this._scheduleNext();
  }

  /** Aircraft and bombs out of sight under the map. See PARKED_Y. */
  _park() {
    this._v.set(0, PARKED_Y, 0);
    this._q.identity();
    this._sc.set(1, 1, 1);
    this.aircraft.matrix.compose(this._v, this._q, this._sc);
    this.aircraft.matrixWorldNeedsUpdate = true;
    const mesh = this.bombMesh;
    if (mesh.count !== 1 || mesh.instanceMatrix.array[13] !== PARKED_Y) {
      mesh.count = 1;
      this._m.compose(this._v, this._q, this._sc);
      this._m.toArray(mesh.instanceMatrix.array, 0);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** `start + dir * SPEED * t`, into the mesh matrix. No allocation. */
  _poseAircraft(run, t) {
    this._v.copy(run.start).addScaledVector(run.dir, SPEED * t);
    this._q.setFromAxisAngle(UP, run.yaw);
    this._sc.set(1, 1, 1);
    this.aircraft.matrix.compose(this._v, this._q, this._sc);
    this.aircraft.matrixWorldNeedsUpdate = true;
  }

  /**
   * Every bomb still in the air, on its own closed-form curve.
   *
   * `k` bombs at most — five to seven — so this is a handful of matrix composes
   * a frame while a run is on and literally nothing between runs, which is why
   * the bomb bodies are CPU-posed while the debris is not: forty chunks a
   * crater is a GPU job, seven falling objects is not.
   */
  _poseBombs(run) {
    const mesh = this.bombMesh;
    let k = 0;
    for (let i = run.next; i < run.bombs.length; i++) {
      const bomb = run.bombs[i];
      const dt = run.t - bomb.tRelease;
      if (dt < 0) break; // releases are ordered; nothing after this is away yet
      this._v.copy(bomb.release).addScaledVector(run.dir, SPEED * dt);
      this._v.y = bomb.release.y - DROP_V * dt - 0.5 * G * dt * dt;
      // Nose along the velocity: horizontal SPEED, vertical -(v0 + g·dt).
      this._v2.copy(run.dir).multiplyScalar(SPEED);
      this._v2.y = -(DROP_V + G * dt);
      this._v2.normalize();
      this._q.setFromUnitVectors(UP, this._v2);
      this._sc.set(1, 1, 1);
      this._m.compose(this._v, this._q, this._sc);
      this._m.toArray(mesh.instanceMatrix.array, k * 16);
      k++;
    }
    // Never zero: one parked instance keeps the draw call — and therefore the
    // compiled program — alive between runs.
    if (k) {
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
    } else {
      this._park();
    }
  }

  /**
   * One bomb arrives. The whole frame cost of a crater is here.
   *
   * Nothing in this method builds, solves or allocates: the `explosion` event
   * is the canonical one `physics`, `player`, `ai`, `fx` and `audio` already
   * handle for the C4, and the three `fx` calls write into preallocated rings.
   * The debris needs no work at all — its delay was baked at boot.
   */
  _detonate(run, bomb) {
    const b = this._blast;
    b.position = bomb.impact;
    b.radius = RULES.bombRadius;
    b.damage = RULES.bombDamage;
    this.ctx.events.emit('explosion', b);

    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (fx) {
      fx.hazeRing(bomb.impact.x, bomb.impact.y + 0.5, bomb.impact.z, 2.0, 17, 0.42, 2.2);
      fx.scorch(bomb.impact.x, bomb.impact.y + 0.15, bomb.impact.z, 4.4);
      fx.addSmokeColumn(bomb.impact.x, bomb.impact.y + 0.25, bomb.impact.z, {
        radius: 2.2,
        duration: 2.2,
        rate: 9,
        rise: 2.1,
        dark: 0.22,
        life: 6,
        growth: 4.6,
      });
    }
    this._emit('impact', run, bomb.impact);
  }

  /** The dust is down: hand the settled pose back and switch the curve off. */
  _bakeSettled(run) {
    run.baked = true;
    const mesh = run.debris;
    mesh.instanceMatrix.array.set(mesh.userData.settled);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.owNoShadow = false;
    mesh.userData.owNoPrepass = false;
    run.uniforms.uAnim.value = 0;
    this._emit('settled', run);
  }

  /* ====================================================================== */
  /* scheduling                                                             */
  /* ====================================================================== */

  _scheduleNext() {
    // Never in the sky at the same time as an airstrike or a strafing run: two
    // telegraphs at once is noise, and the player has to be able to tell which
    // one is theirs.
    if (this.busy || this._coBusy) {
      this._next = 5;
      return;
    }
    if (this._flown >= RULES.bomberMaxPerRound) {
      this._next = Infinity;
      return;
    }
    /**
     * Weighted by how close the LINE comes to the fight, not how close its
     * midpoint does — a run whose far end is on top of the fight is a run the
     * player sees, and by midpoint it would score the same as one aimed at an
     * empty lane. Nothing is excluded; the lines do not move.
     */
    const cand = this._cand;
    const wt = this._wt;
    cand.length = 0;
    wt.length = 0;
    let total = 0;
    for (const r of this.runs) {
      if (r.flown) continue;
      total += this._focusWeight(r);
      cand.push(r);
      wt.push(total);
    }
    if (!cand.length) {
      this._next = Infinity;
      return;
    }
    const draw = this.rng.float() * total;
    let pick = cand.length - 1;
    for (let i = 0; i < wt.length; i++) {
      if (draw < wt[i]) {
        pick = i;
        break;
      }
    }
    this.fire(cand[pick].index);
    this._flown++;
    const [lo, hi] = RULES.bomberInterval;
    this._next = this.rng.range(lo, hi);
  }

  /** 1 with no focus, up to 3.4 with the fight standing in the impact line. */
  _focusWeight(run) {
    if (!this.focusValid) return 1;
    const b = run.bombs;
    const a0 = b[0].impact;
    const a1 = b[b.length - 1].impact;
    const dx = a1.x - a0.x;
    const dz = a1.z - a0.z;
    const len2 = dx * dx + dz * dz;
    let t = 0;
    if (len2 > 1e-6) {
      t = ((this.focus.x - a0.x) * dx + (this.focus.z - a0.z) * dz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    const d = Math.hypot(this.focus.x - (a0.x + dx * t), this.focus.z - (a0.z + dz * t));
    return 1 + 2.4 / (1 + (d / this.focusScale) ** 2);
  }

  /** Called by `match` when a round goes live. */
  armRound() {
    const [lo, hi] = RULES.bomberInterval;
    this._next = RULES.bomberFirstDelay + this.rng.range(0, (hi - lo) * 0.5);
    this._flown = 0;
  }

  disarm() {
    this._next = Infinity;
  }

  /** Round reset: no craters, no debris, no aeroplane. */
  reset() {
    this.disarm();
    this._live.length = 0;
    this._park();
    for (const run of this.runs) {
      run.flown = false;
      run.active = false;
      run.baked = false;
      run.next = 0;
      run.t = -1;
      run.uniforms.uT.value = -1;
      run.uniforms.uAnim.value = 1;
      const mesh = run.debris;
      mesh.instanceMatrix.array.set(mesh.userData.rest);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.owNoShadow = true;
      mesh.userData.owNoPrepass = true;
    }
  }

  _runOf(which) {
    if (typeof which === 'number') return this.runs[which] ?? null;
    if (typeof which === 'string') return this.runs.find((r) => r.id === which) ?? null;
    return which ?? null;
  }

  _emit(phase, run, position) {
    const e = this._ev;
    e.phase = phase;
    e.run = run.id;
    e.position = position ?? run.position;
    this.ctx.events.emit('match:bomber', e);
  }

  dispose() {
    for (const run of this.runs) {
      run.debris?.geometry?.dispose();
      run.material?.dispose();
    }
    this.aircraft?.geometry?.dispose();
    this.aircraftMat?.dispose();
    this.bombMesh?.geometry?.dispose();
    this.bombMat?.dispose();
    this.group.parent?.remove(this.group);
    this.runs.length = 0;
    this._live.length = 0;
  }
}
