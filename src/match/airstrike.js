/**
 * MATCH — the airstrike.
 *
 * Occasionally, mid-round, a bomb lands on the town and takes the top off a
 * building. Eight fixed sites, one strike per event, telegraphed with a jet
 * pass and a falling whistle so it is a thing you can react to rather than a
 * thing that kills you.
 *
 * Three of the eight are the map changers this file was written around; the
 * other five are smaller masses standing over the attackers' approach to the
 * bomb sites, so that pushing costs something. See `STRIKE_SITES`. The bomber
 * — an aircraft that walks a stick of bombs along a line rather than dropping
 * one on a point — is the other half of the same brief and lives in
 * `src/match/bomber.js`, built on the helpers this file exports.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EVERYTHING IS BAKED AT BOOT. NOTHING IS SOLVED WHEN IT FIRES.
 * ────────────────────────────────────────────────────────────────────────────
 * This is the whole design, and every other decision here follows from it.
 * At `build()` time, for each of the three sites, we solve and cache:
 *
 *   - the FRACTURE. Each site's mass (an added top storey, its crown, a stair
 *     hut, a water tank, two chimney stacks, a balcony and a strip of facade)
 *     is cut by a jittered 3D grid into ~260 chunks. Because the cut planes
 *     tile the boxes exactly, the chunks reassemble seamlessly: at rest the
 *     mass reads as one solid building, which is what makes the break read.
 *
 *   - the MOTION, as a closed-form curve per chunk with all its constants
 *     solved up front: delay, flight time, arc height, total spin, spin axis
 *     and the exact settled offset. The vertex shader evaluates
 *         p(u) = rest + rotate(k, θ·u(2-u))·(p - pivot) + off·u + up·arc·4u(1-u)
 *     off one uniform. There is no integrator, no collision solve and no CPU
 *     work per chunk per frame — the GPU is handed 260 independent trajectories
 *     and draws them in one instanced call.
 *
 *   - the SETTLED POSE, as a second pre-filled matrix array, so once the dust
 *     is down we memcpy it into `instanceMatrix`, switch the animation off and
 *     the rubble goes back to casting shadows and writing the depth prepass.
 *
 *   - the COLLISION. The rubble mound's collision proxy is registered with
 *     `physics` AT BOOT with a layer mask of 0, so it is in the BVH and invisible
 *     to every query. Making it solid is `mask.fill(LAYER.STATIC, a, b)` on a
 *     cached triangle range — no BVH rebuild, which would be a ~half-second
 *     stall in the middle of a round.
 *
 *   - the NAVIGATION PATCH. `src/ai/nav.js` is a 2.5D height field, so the
 *     mound only changes a few hundred cells. Those cells are re-probed at boot
 *     with the rubble temporarily solid, and the result is stored as three flat
 *     arrays (cell index, new flag, new floor) plus the values they replace.
 *     Applying it is a loop over ~300 array slots. A full `grid.build()` is
 *     22 500 raycasts and is exactly the "calculate it when the event fires"
 *     this is written to avoid.
 *
 * So the frame the strike fires does: two booleans per mesh, one uniform write,
 * one `explosion` event, and a handful of `fx` calls that all write into
 * preallocated rings. Measured on the trigger frame vs its neighbours — see the
 * report in the commit; `window.__STRIKE__.fire(i)` is the hook the harness
 * drives it through.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLIC API   const s = ctx.get('match').airstrike
 * ────────────────────────────────────────────────────────────────────────────
 *   s.sites                  [{ id, name, position, ... }]  world space
 *   s.salvos                 [{ id, name, sites, centre }]  the block events
 *   s.fire(indexOrId)        drop one now. Skips the telegraph.
 *   s.call(indexOrId)        run the full telegraphed sequence
 *   s.callSalvo(indexOrId)   the block event: three sites, one announcement
 *   s.struck(index)          has this one already come down this round?
 *   s.reset()                round reset: mass back up, nav and collision back
 *   s.enabled                false stops the scheduler (the strike still fires
 *                            on demand)
 *   s.setFocus(v)            where the fight is. Biases which site is picked —
 *                            a fixed-site event on a 114x141 m map is invisible
 *                            by construction unless somebody aims it.
 *   s.onAnnounce = (a) => {} called the moment a strike is CALLED, with the
 *                            reused announce record (see `_ann`). `match` turns
 *                            it into the HUD warning; nothing here touches `ui`.
 *   s.onImpact = (a) => {}   called on the frame it goes off, same record.
 *
 * Emits `match:airstrike { phase, site, position }` with phase
 * 'inbound' | 'impact' | 'settled'.
 */

import * as THREE from 'three';
import { RULES } from './rules.js';

/**
 * THE MAP IS 1.5x AND THESE ARE IN THE MAP'S OWN PLAN UNITS.
 *
 * `src/world/layout.js` scales its whole authored plan by `SCALE`, and
 * `src/match/sites.js` repeats the factor for the same reason: `match` may not
 * import `world`, so every gameplay-authored level point has to be transformed
 * the same way or it lands on the OLD map's geometry.
 *
 * THIS FILE MISSED THAT TRANSFORM AND THAT IS THE WHOLE "空爆イベントが起きて
 * いない" BUG. The scheduler was firing exactly on time — instrumented over a
 * live round it called WEST at 33.4 s and EAST at 82.5 s — but two of the three
 * anchors had drifted off the buildings they were authored on and into the open
 * street, so the boot probe put the roof at 0.05 m and the whole mass, its
 * fireball and its rubble were built at ankle height in the middle of a road.
 * Nothing came down, because there was nothing up. Measured at boot before the
 * fix:
 *
 *     MID   roof 0.06 m     WEST roof 6.50 m     EAST roof 0.05 m
 *
 * and after (`_findRoof` reports the plane it settled on in the boot log):
 *
 *     MID   roof 9.55 m     WEST roof 7.38 m     EAST roof 12.35 m
 *
 * `L()` and `SCALE` are duplicated from sites.js deliberately, the same way
 * sites.js duplicates them from layout.js. IF ONE MOVES, MOVE THE OTHERS.
 */
/**
 * ────────────────────────────────────────────────────────────────────────────
 * …AND THEN THE MID STREET WAS PRISED OPEN, AND THAT IS A SECOND TRANSFORM
 * ────────────────────────────────────────────────────────────────────────────
 * Every anchor below is authored ON A FACADE. `widenX` in src/world/layout.js
 * stretched the mid street from 13 to 31 authored units and TRANSLATED the two
 * building rows, both lanes and both courtyards outward by 9 units to make room
 * for the cathedral — so all eight of the original facades moved, and without
 * this every one of the eight sites would land in mid air and `_findRoof` would
 * drop it with the error it prints two hundred lines below. Exactly the failure
 * the SCALE note above describes, for exactly the same reason.
 *
 * It is duplicated here rather than imported because `match` may not import
 * `world`, the same way `SCALE` is and the same way `src/match/sites.js` now
 * carries its own copy. IF ONE MOVES, MOVE THE OTHERS.
 */
const SCALE = 1.5;
const SPREAD = 9.0;
const WB = 6.2;
const WK = 1 + SPREAD / WB;
const widenX = (x) => (Math.abs(x) <= WB ? x * WK : x + Math.sign(x) * SPREAD);
const L = (x, z) => [widenX(x) * SCALE, z * SCALE];
/**
 * The cathedral's own anchors are authored in the WIDENED plan (it is a new
 * building and stands in the street the transform created), so they take the
 * scale and not the widen. @see `CATHEDRAL` in src/world/layout.js.
 */
const LC = (x, z) => [x * SCALE, z * SCALE];
/**
 * Keep the cathedral's roof search inside the AISLE the anchor stands on: the
 * aisle is 4.85 m of clear span and the campanile, the nave roof and the dome
 * are all further in and all higher. @see `_findRoof`, which takes the maximum.
 */
const CATH_PROBE = { insets: [2.0, 3.0, 4.0], alongs: [0, 2.5, -2.5, 4, -4] };

/**
 * THE STRIKE SITES, authored in the level space `src/world/layout.js` uses.
 *
 * Each one is an added top storey on a building that FACES A LANE. `face` is
 * the level-space direction the mass overhangs and the rubble falls, i.e. out
 * into the lane; `yaw` is derived from it. Sites are deliberately ON the
 * building line and never inside a courtyard, so no strike can bury a bomb site
 * or a spawn — the demolition layout is untouched by every one of them.
 *
 * `kind` picks the mass profile and the scheduler's weighting:
 *
 *   'block'  the big one. A whole added storey, its crown, the stair hut, the
 *            water tank, two flues, a strip of facade and a balcony — 923
 *            chunks. These are MAP CHANGES: the mound is permanent cover for
 *            the rest of the round, and where it lands is the level design.
 *   'route'  a parapet, its coping, the wall under it and a balcony — 292
 *            chunks, a smaller radius and a smaller mound. These exist to make
 *            the WALK IN cost something, so they are not level design so much
 *            as weather on the attackers' approach.
 *
 * WHERE THEY ARE AND WHY — "C4設置場所に行くまでのところに空爆ポイントを作る
 * こと … 守る側有利にして". Measured off `tools/lanecheck.mjs`'s own A* on the
 * built map, the two sides' routes to the objectives do not overlap at all:
 *
 *     attack spawn -> either site   level z from +66.7 down to  -5.8
 *     defend spawn -> either site   level z from -67.1 up   to  -5.0
 *
 * They meet only AT the sites. So every anchor below is at level z >= +6.9,
 * which is on the attackers' half of every route and on none of the defenders'.
 * That is the entire balance argument and it is a geometric fact rather than a
 * tuning opinion — see the exposure table in the commit message.
 */
const STRIKE_SITES = [
  /* ---- the three map changers ------------------------------------------ */
  // east row, west face, on the mid street where both branches still share it
  { id: 'MID', name: 'MID STREET', level: L(7.7, 18.7), face: [-1, 0], reach: 5.2, kind: 'block' },
  // north row, south face, over the west connector the A branch crosses
  { id: 'WEST', name: 'WEST CROSSING', level: L(-13.1, 14.3), face: [0, -1], reach: 4.2, kind: 'block' },
  // east row, west face, on the B lane's long north run
  { id: 'EAST', name: 'B LANE', level: L(20.0, 17.3), face: [1, 0], reach: 4.4, kind: 'block' },

  /* ---- five points on the way in --------------------------------------- */
  // the trunk both branches walk out of spawn, west row's east face
  { id: 'R1', name: 'MAIN STREET', level: L(-6.3, 22.6), face: [1, 0], reach: 3.4, kind: 'route' },
  // west connector, south row's north face, where the A branch turns west
  { id: 'R2', name: 'WEST LINK', level: L(-15.5, 9.4), face: [0, 1], reach: 3.4, kind: 'route' },
  // A lane's last run in to site A, east row's west face
  { id: 'R3', name: 'A APPROACH', level: L(-20.9, 4.6), face: [-1, 0], reach: 3.4, kind: 'route' },
  // east connector, south row's north face, where the B branch turns east
  { id: 'R4', name: 'EAST LINK', level: L(15.5, 24.1), face: [0, 1], reach: 3.4, kind: 'route' },
  // B lane's last run in to site B, west row's east face
  { id: 'R5', name: 'B APPROACH', level: L(21.3, 7.5), face: [1, 0], reach: 3.4, kind: 'route' },

  /* ---- the cathedral ---------------------------------------------------- */
  /**
   * ────────────────────────────────────────────────────────────────────────────
   * "そこを戦闘激化させて 爆破させたり崩落もあり キャッシュさせて定期的に爆破や崩落を
   *  イベントで起こしてランダムで"
   * ────────────────────────────────────────────────────────────────────────────
   * The middle of the map is a 30 x 45 m cathedral now and the middle CAPTURE
   * POINT is under its dome, so it is where the round concentrates by
   * construction — which makes it the one building on the map where an event
   * that takes a bay of roof off is guaranteed to be seen. It is also the one
   * the player asked to be able to bring down.
   *
   * NOTHING NEW IS COMPUTED WHEN IT FIRES, and that is the whole reason these
   * are three more entries in this table rather than a new system. Everything
   * this file already bakes at boot it bakes for these too: the fracture (489
   * chunks each, 1467 for the group), the closed-form per-chunk trajectory in
   * four instanced attributes, the settled pose as a second matrix array to
   * memcpy, the mound's collision proxy parked in the BVH on layer 0, and the
   * nav patch as three flat arrays of the ~300 cells the mound actually changes.
   * The frame it goes off does two booleans per mesh and one uniform write.
   *
   * WHERE THEY ARE. Two bays of the west aisle roof and one of the east, all
   * three anchored on the outer wall with `face` pointing out over the flanking
   * street, 14 authored units apart so their 9 m masses do not overlap. Each
   * carries a `probe` that keeps the roof search inside the 4.85 m aisle it is
   * authored on — see `_findRoof`, and see what happened without it.
   *
   * THE STREET EITHER SIDE IS ONLY 8.25 m WIDE, and that is handled rather than
   * hoped: `_buildSite` measures the lane with a ray at chest height and scales
   * the mound to leave `LANE_CLEAR` = 3.6 m of it walkable, and `_verifyRoutes`
   * then re-proves every spawn/target route with ALL of them settled and takes
   * a site's collision away entirely if it costs anybody one. A cathedral that
   * sealed its own flank would be a capture point nobody could rotate to.
   */
  /**
   * AND THE Z OF ALL THREE IS DECIDED BY WHAT IS ACROSS THE STREET FROM THEM.
   *
   * The flank the mound falls into is 8.25 m wide opposite W2 and W3 and OPEN
   * where the two connectors meet it (authored z -8..-1 and 9..14). Anchored in
   * a connector mouth the lane ray measures 42.5 m, `LANE_CLEAR` therefore never
   * bites, and the full 6.6 m mound lands in the rotation: measured, CATH-W and
   * CATH-X in those two positions cost 52 and 63 of 135 spawn/target routes and
   * `_verifyRoutes` took both sites' collision away. So every anchor is opposite
   * a building — and none is on the west flank south of authored z -10, because
   * that is the campanile and its cap is 32.8 m up.
   */
  { id: 'CATH-W', name: 'CATHEDRAL NAVE', level: LC(10.0, -12.0), face: [1, 0], reach: 4.6, kind: 'vault', probe: CATH_PROBE },
  { id: 'CATH-X', name: 'CATHEDRAL CHOIR', level: LC(-10.0, 7.0), face: [-1, 0], reach: 4.6, kind: 'vault', probe: CATH_PROBE },
  /**
   * MOVED FROM z 2 TO z 6.5, AND THE REASON IS ON THE GROUND RATHER THAN ON THE
   * ROOF. `src/world/layout.js` now stands a 1.7 m screen in each flank street
   * in front of the transept portal (level z -3..1) to keep the cathedral from
   * being a building you walk straight into. `_buildSite` measures the street
   * beside each anchor with ONE chest-height ray and scales the rubble mound to
   * leave `LANE_CLEAR`; at z 2 that ray would have hit the screen 2 m out and
   * the mound would have come back the size of a skip. z 6.5 is still opposite
   * E2 (level z -1..9) rather than a connector mouth, and it is 5.5 units clear
   * of the screen. IF THAT SCREEN MOVES, RE-CHECK THIS.
   */
  { id: 'CATH-E', name: 'CATHEDRAL CHOIR EAST', level: LC(10.0, 6.5), face: [1, 0], reach: 4.6, kind: 'vault', probe: CATH_PROBE },
];

/**
 * THE SALVO — three sites on ONE CITY BLOCK, called as one event.
 *
 * "大規模爆破で街が破壊されるとか起きないね？街を破壊するようなイベントです." A
 * single site is one added storey coming off one roof, which is the right size
 * for a hazard and the wrong size for the event the player is asking for. This
 * is the answer, and it needed NO new baked data: the three sites in each group
 * are already built, already fractured, already have their mound proxies in the
 * BVH and their nav patches solved, and were already proved harmless to every
 * route by `_verifyRoutes` WITH ALL EIGHT applied at once. Firing three of them
 * together is three uniform writes instead of one.
 *
 * The groups are the sites that are actually adjacent, measured off the level
 * coordinates above (world metres, after the 1.5x):
 *
 *   EAST BLOCK   MID -> R4 14.2 m, MID -> EAST 18.6 m, R4 -> EAST 12.4 m
 *   WEST BLOCK   WEST -> R2 8.2 m, WEST -> R1 16.1 m, R1 -> R2 24.0 m
 *
 * so each group spans roughly 20-30 m of frontage — a block — and the three
 * masses face three different ways, which is what makes it read as the middle
 * of a block coming apart rather than as one wall falling over.
 *
 * `stagger` is why it reads as a salvo and not as a glitch: a fifth of a second
 * apart, the three detonations are one event to the ear and three distinct
 * collapses to the eye. It also keeps the three `_bakeSettled` memcpys (and the
 * three nav patches) on three different frames six and a half seconds later.
 */
const SALVOS = [
  { id: 'EASTBLOCK', name: 'EAST BLOCK', members: ['MID', 'R4', 'EAST'], stagger: [0, 0.21, 0.44] },
  { id: 'WESTBLOCK', name: 'WEST BLOCK', members: ['WEST', 'R2', 'R1'], stagger: [0, 0.25, 0.47] },
  /**
   * THE CATHEDRAL COMING DOWN, and it is a salvo rather than three separate
   * strikes for the reason the other two groups are: "大規模爆破で街が破壊される
   * とか起きないね？街を破壊するようなイベントです". One bay of roof off one elevation
   * is a hazard; three bays off both elevations and the dome, a fifth of a
   * second apart, with 1467 chunks in the air and a five-column dust wall
   * standing in the nave for twenty seconds, is an event.
   *
   * It is also the group `_pickSalvo` will usually choose, and that is not luck.
   * `match` writes the centre of the fight to `setFocus` every few seconds and
   * `_pickSalvo` takes the group with the highest `_focusWeight` — and the
   * middle capture point is inside this building, so the fight is here. The
   * scheduler is what makes it "定期的に … ランダムで": `RULES.airstrikeSalvoDelay`
   * holds it off the opening of the round, `airstrikeInterval` is the random
   * gap, and the draw is weighted, never fixed.
   */
  { id: 'CATHEDRAL', name: 'THE CATHEDRAL', members: ['CATH-W', 'CATH-X', 'CATH-E'], stagger: [0, 0.23, 0.46] },
];

/**
 * THE DUST WALL a salvo leaves behind, and the reason it is authored separately
 * from the per-site spectacle.
 *
 * `fx.addSmokeColumn` draws from a pool of 24 emitters (`MAX_EMITTERS` in
 * src/fx/ambience.js). One strike's own spectacle is six of them, so three
 * sites firing together would ask for eighteen and the last site would steal the
 * first site's columns out from under it — the pile would stop smoking the
 * moment the third bomb landed, which is the opposite of what a levelled block
 * looks like. So a site fired AS PART OF A SALVO runs a reduced spectacle (three
 * columns, no mound column) and the group adds these five long-lived ones spread
 * across the whole frontage. 3x3 + 5 = 14 emitters, inside the pool with room
 * for the grenades and the burning wrecks that are also using it.
 *
 * `duration` is how long it keeps emitting and `life` how long each puff lives,
 * so the lane is genuinely occluded for about `duration + life` — 20 s, which is
 * a real tactical consequence and not a puff of set dressing.
 */
const SALVO_DUST = { count: 5, duration: 11, life: 9.5, radius: 5.6, rate: 9, rise: 1.7, growth: 7.2, dark: 0.22 };

/**
 * How far INSIDE the building line the roof height is probed.
 *
 * `level` is authored ON the facade plane, which is exactly where a downward
 * ray is ambiguous — a metre either way and it lands on the pavement instead of
 * the roof, and the whole mass ends up sitting in the gutter. Three metres in is
 * past every parapet and cornice in the kit and still inside every footprint.
 */
const ROOF_INSET = 3.0;

/**
 * Metres of the lane a settled mound must leave walkable.
 *
 * The nav agent's radius is well under a metre, so this is not a clearance
 * figure — it is a GAMEPLAY one. A lane you can only file through in single
 * file is a lane the defence holds with one man, and the point of dropping a
 * building into the attackers' route is to make it cost something, not to close
 * it. 3.6 m is about two men wide.
 */
const LANE_CLEAR = 3.6;

/**
 * The mass that comes down, in the site's own frame:
 *   +u  out over the lane      +v  along the facade      +y  up from the roof
 *
 * `cut` is the fracture grid. Sizes are chosen so no chunk is smaller than
 * ~0.35 m — below that a chunk is a particle, and `fx` already throws several
 * hundred of those.
 */
const MASS_BLOCK = [
  // the added storey itself: the big one, and the only piece with real depth
  { id: 'storey', mat: 0, size: [4.6, 3.4, 8.4], at: [-2.0, 1.7, 0], cut: [7, 6, 13] },
  // its crown course, proud of the storey on every side
  { id: 'crown', mat: 1, size: [5.2, 0.62, 9.0], at: [-1.9, 3.72, 0], cut: [7, 1, 13] },
  // stair penthouse, set back and off to one side
  { id: 'hut', mat: 0, size: [2.4, 2.3, 2.7], at: [-3.5, 5.2, 2.4], cut: [4, 4, 5] },
  // water tank on a low stand — the silhouette that reads from across the map
  { id: 'tank', mat: 1, size: [1.9, 1.7, 1.9], at: [-3.3, 4.9, -2.3], cut: [4, 4, 4] },
  { id: 'stand', mat: 1, size: [2.1, 0.9, 2.1], at: [-3.3, 3.6, -2.3], cut: [3, 1, 3] },
  // two chimney stacks
  { id: 'flueA', mat: 1, size: [0.68, 1.6, 0.68], at: [-2.3, 4.85, -0.2], cut: [2, 5, 2] },
  { id: 'flueB', mat: 1, size: [0.6, 1.2, 0.6], at: [-2.7, 4.65, 3.9], cut: [2, 4, 2] },
  // a strip of the facade below the roof line, so the wound runs down the wall
  { id: 'skin', mat: 0, size: [0.34, 2.4, 8.4], at: [-0.17, -1.4, 0], cut: [1, 5, 13] },
  // and the balcony that was hanging off it
  { id: 'balcony', mat: 1, size: [1.3, 0.24, 3.6], at: [0.65, -2.1, -1.4], cut: [2, 1, 7] },
  { id: 'rail', mat: 1, size: [0.14, 0.9, 3.6], at: [1.25, -1.6, -1.4], cut: [1, 2, 9] },
];

/**
 * The ROUTE mass: a parapet with its coping, the wall under it and the balcony
 * that was bolted to that wall. 292 chunks against the block's 923.
 *
 * It is deliberately ONE material and deliberately shallow. One material
 * because eight sites at two materials each is sixteen shader permutations
 * compiled at boot for a thing that is meant to be the cheap version; shallow
 * because a route strike must drop cover into a lane the attack has to walk,
 * not seal it — `moundR` comes out at 3.1 m against lanes 8-14 m wide, and
 * `tools/navcheck.mjs` is run WITH every strike settled to prove it.
 */
const MASS_LEDGE = [
  { id: 'parapet', mat: 0, size: [3.2, 1.5, 7.0], at: [-1.3, 0.75, 0], cut: [5, 3, 11] },
  { id: 'coping', mat: 0, size: [3.6, 0.4, 7.4], at: [-1.2, 1.7, 0], cut: [4, 1, 11] },
  { id: 'skin', mat: 0, size: [0.34, 2.6, 7.0], at: [-0.17, -1.9, 0], cut: [1, 5, 11] },
  { id: 'balcony', mat: 0, size: [1.2, 0.22, 3.2], at: [0.6, -2.7, -1.2], cut: [2, 1, 6] },
  { id: 'rail', mat: 0, size: [0.14, 0.85, 3.2], at: [1.15, -2.2, -1.2], cut: [1, 2, 8] },
];

/**
 * The VAULT mass: what comes off a cathedral rather than off a shop.
 *
 * A bay of the nave roof and the vault webbing under it, the parapet and coping
 * along the eaves, the two pinnacles on the buttress heads either side of that
 * bay, a strip of the clerestory wall so the wound runs down the elevation, and
 * the flying buttress that was propping it. 489 chunks — between the block's 923
 * and the ledge's 292, which is right: it is a bigger event than a parapet and a
 * shallower one than a whole added storey, because the mass has to fall into an
 * 8.25 m street rather than a 14 m lane.
 *
 * TWO MATERIALS, unlike the route mass. A cathedral that came down entirely in
 * render concrete would read as a car park collapsing; the roof and the wall are
 * `plaster` (the level's own limestone bake) and the dressed stone — coping,
 * pinnacles, flyer — is `concrete`. Two materials is two shader permutations per
 * site, which the block sites already pay for.
 */
const MASS_VAULT = [
  { id: 'ridge', mat: 0, size: [5.0, 1.5, 9.0], at: [-2.2, 0.75, 0], cut: [7, 3, 13] },
  { id: 'coping', mat: 1, size: [1.0, 0.9, 9.4], at: [-0.6, 1.85, 0], cut: [2, 2, 13] },
  { id: 'pinA', mat: 1, size: [1.1, 3.2, 1.1], at: [-0.7, 3.1, 3.0], cut: [2, 5, 2] },
  { id: 'pinB', mat: 1, size: [1.1, 3.2, 1.1], at: [-0.7, 3.1, -3.0], cut: [2, 5, 2] },
  { id: 'skin', mat: 0, size: [0.36, 4.2, 9.0], at: [-0.18, -2.3, 0], cut: [1, 8, 13] },
  { id: 'flyer', mat: 1, size: [3.0, 0.7, 1.0], at: [1.3, -3.4, 1.4], cut: [5, 2, 2] },
];

const MASS_FOR = { block: MASS_BLOCK, route: MASS_LEDGE, vault: MASS_VAULT };
/** Surface library name per material slot, per kind. */
const SURFACE_FOR = {
  block: ['plaster', 'concrete'],
  route: ['concrete'],
  vault: ['plaster', 'concrete'],
  /**
   * THE WHOLE BUILDING. Its mass is not in this file at all — `world` publishes
   * it per building, because `world` is the only thing that knows how big the
   * building is and where its floors are. @see `_buildDemoSite`.
   */
  demo: ['plaster', 'concrete'],
};
/**
 * Mound height per kind — a parapet does not make the pile a storey does.
 *
 * `demo` is almost nothing, and that is not a mistake: for every other kind the
 * settle probe finds the STREET and the chunks have to be piled onto it, while a
 * demolition's probe is run with its own debris field already solid and finds
 * the top of the pile. Add a metre of dome on top of that and the rubble floats.
 */
const MOUND_H = { block: 1.55, route: 1.05, vault: 1.45, demo: 0.3 };

/**
 * Parts whose `at[0]` is measured from the REAL facade plane found by the boot
 * probe rather than from the authored building line. The skin and the balcony
 * have to be flush with the wall they hang off; the mass on the roof does not
 * care to the centimetre, and moving it would push it off the parapet.
 */
const FACADE_PARTS = new Set(['skin', 'balcony', 'rail', 'flyer']);

/** Seconds of telegraph: jet first, then the whistle, then it lands. */
const JET_LEAD = 4.4;
const WHISTLE_LEAD = 2.6;
/** When the pile has stopped moving and the settled pose is baked in. */
const SETTLE_AT = 6.5;

const UP = new THREE.Vector3(0, 1, 0);

/* -------------------------------------------------------------------------- */

export class Airstrike {
  /**
   * @param {object} ctx     engine context
   * @param {object} opts    { rng }
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.rng = opts.rng ?? ctx.rng.fork();
    /**
     * The spawn/target pairs `tools/navcheck.mjs` asserts on, handed in by
     * `match` because `match` owns the layout. Used once, by `_verifyRoutes`.
     */
    this._routes = opts.routes ?? [];
    this.enabled = true;
    this.sites = [];
    /** The block events, resolved from `SALVOS` at boot. */
    this.salvos = [];
    this.ready = false;
    this.buildMs = 0;

    /** Live strikes, indexed the same as `sites`. */
    this._live = [];
    /** Pending telegraphed calls: { site, group, k, t, stage }. */
    this._pending = [];
    /** The flank beacon this system has already answered. @see `_pollFlankCall`. */
    this._flankKey = null;
    /** The rolling city-wide collapse, or null. @see `callEverything` */
    this._final = null;
    /** Seconds until the scheduler may pick a site. Set by `armRound`. */
    this._next = Infinity;
    /** Strikes called this round, against `RULES.airstrikeMaxPerRound`. */
    this._fired = 0;
    /** Salvos called this round, against `RULES.airstrikeSalvoPerRound`. */
    this._salvoed = 0;
    /** Seconds of LIVE round elapsed, for `RULES.airstrikeSalvoDelay`. */
    this._liveT = 0;
    /**
     * The other air systems, so no two ever share the sky. Set by `match`;
     * accepts one object or an array of them. @see `_coBusy`
     */
    this.coBusy = null;

    /**
     * WHERE THE FIGHT IS, and why a fixed-site weapon needs to be told.
     *
     * Eight sites on a 114x141 m map means the expected distance from the player
     * to a uniformly drawn strike is most of the map — measured over a live
     * round, the median was 71 m with buildings in between. The event fires, the
     * log says so, and the player is looking at a wall. That is the second half
     * of the "空爆が全然発生しない" report and no amount of HUD fixes it.
     *
     * So `match` writes the centre of the fight here (it owns the roster and
     * knows where the living are) and `_scheduleNext` weights the draw by it. It
     * is a BIAS, not a selection: the sites do not move, the balance argument in
     * the STRIKE_SITES comment is untouched, and a strike can still land on the
     * far side of the map — it is just no longer the likeliest outcome.
     */
    this.focus = new THREE.Vector3();
    this.focusValid = false;
    /** Metres. The half-weight distance of the focus bias. */
    this.focusScale = 30;

    /** Announce hooks, installed by `match`. See the API block above. */
    this.onAnnounce = null;
    this.onImpact = null;

    this.group = new THREE.Group();
    this.group.name = 'match-airstrike';
    this.group.matrixAutoUpdate = false;

    /* scratch — nothing in update() or fire() allocates */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._sc = new THREE.Vector3();
    this._blast = { position: this._v2, radius: 0, damage: 0, source: 'airstrike' };
    this._ev = { phase: '', site: '', position: this._v2 };
    /**
     * The announce record handed to `onAnnounce` / `onImpact`. REUSED, like
     * every other payload in this file — `points` holds references to existing
     * site vectors and `count` says how many of them are meaningful, so an
     * announcement allocates nothing either.
     */
    this._ann = {
      kind: 'STRIKE',
      id: '',
      name: '',
      lead: JET_LEAD,
      position: null,
      points: [null, null, null, null],
      count: 0,
    };
    /** Live salvo dust: { tag, at } — removed by `update` when it expires. */
    this._dust = [];
    /** Candidate + cumulative-weight scratch for the weighted draw. */
    this._cand = [];
    this._wt = [];
  }

  /** True while any co-system (bomber, strafe) has something in the air. */
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
  /* BOOT — every expensive thing in this file happens in here              */
  /* ====================================================================== */

  build() {
    const t0 = performance.now();
    const ctx = this.ctx;
    const world = ctx.peek('world');
    const physics = ctx.peek('physics');
    const materials = ctx.peek('materials');
    if (!world || !physics) {
      console.warn('[airstrike] no world/physics — disabled');
      return this;
    }
    this.physics = physics;
    this._lib = materials;

    for (let i = 0; i < STRIKE_SITES.length; i++) {
      const site = this._buildSite(STRIKE_SITES[i], i, world, physics);
      if (site) this.sites.push(site);
    }
    this._buildDemoSites(world, physics);

    ctx.scene.add(this.group);

    // The rubble proxies went in with mask 0; one rebuild now puts them in the
    // BVH so making them solid later is a mask write instead of a rebuild.
    if (this.sites.length) physics.rebuildStatic();
    for (const s of this.sites) this._cacheTriRange(s);

    // Nav patches are solved LAST, because they need the proxies in the BVH.
    const ai = ctx.peek('ai');
    for (const s of this.sites) this._bakeNavPatch(s, ai, physics);
    this._verifyRoutes(ai);

    this._buildSalvos();
    this._buildDemoSalvos();
    this._bootFlag();

    this.ready = this.sites.length > 0;
    this.buildMs = performance.now() - t0;
    let chunks = 0;
    let cells = 0;
    for (const s of this.sites) {
      chunks += s.chunkCount;
      cells += s.nav ? s.nav.cells.length : 0;
    }
    /**
     * TWO POPULATIONS, COUNTED SEPARATELY. The authored sites are the ones whose
     * level coordinates live in this file and can therefore go stale when the
     * map moves under them — that is what the error below is for. The
     * demolitions are derived from `world.demolitions` and cannot drift, so
     * folding them into the same fraction would have printed "17/11".
     */
    const authored = this.sites.filter((s) => !s.demo).length;
    const demos = this.sites.length - authored;
    console.info(
      `[airstrike] ${authored}/${STRIKE_SITES.length} authored sites + ${demos} whole buildings ` +
        `baked in ${this.buildMs.toFixed(0)}ms — ${chunks} chunks, ${cells} nav cells patched, ` +
        this.sites.map((s) => `${s.id}@${s.roofY.toFixed(1)}m`).join(' ')
    );
    if (authored < STRIKE_SITES.length) {
      console.error(
        `[airstrike] ${STRIKE_SITES.length - authored} SITE(S) DROPPED — ` +
          'the level coordinates in src/match/airstrike.js no longer match the map.'
      );
    }
    return this;
  }

  /**
   * Resolve `SALVOS` against the sites that actually built, and measure each
   * group's frontage so the boot log says whether it is a block or a coincidence.
   *
   * Two members is still a block event; one is a single strike wearing a bigger
   * name, so a group that loses two of its three is dropped.
   */
  _buildSalvos() {
    for (const spec of SALVOS) {
      const members = [];
      const stagger = [];
      for (let i = 0; i < spec.members.length; i++) {
        const site = this.sites.find((s) => s.id === spec.members[i]);
        if (!site) continue;
        members.push(site);
        stagger.push(spec.stagger[i] ?? i * 0.22);
      }
      if (members.length < 2) {
        console.error(
          `[airstrike] salvo ${spec.id}: only ${members.length} of ` +
            `${spec.members.length} member sites built — DROPPED.`
        );
        continue;
      }
      const centre = new THREE.Vector3();
      for (const m of members) centre.add(m.position);
      centre.multiplyScalar(1 / members.length);
      let span = 0;
      for (const a of members) for (const b of members) span = Math.max(span, a.position.distanceTo(b.position));
      let chunks = 0;
      for (const m of members) chunks += m.chunkCount;
      this.salvos.push({
        id: spec.id,
        name: spec.name,
        index: this.salvos.length,
        sites: members,
        stagger,
        centre,
        span,
        chunkCount: chunks,
        /** Where the telegraph and the HUD arrow point: the middle of the block. */
        position: centre,
      });
      console.info(
        `[airstrike] salvo ${spec.id} "${spec.name}": ${members.map((m) => m.id).join('+')} — ` +
          `${chunks} chunks over ${span.toFixed(1)} m of frontage`
      );
    }
  }

  /**
   * THE TWO DISTRICT EVENTS — the city round A and the city round B, each as one
   * telegraphed salvo.
   *
   * "AとBの周りの街は爆撃で定期的に破壊して". Periodic and telegraphed is what the
   * scheduler above already is: `_pickSalvo` takes the group nearest the fight
   * and `match` writes where the fight is every few seconds, so with a capture
   * point inside each district these are the groups that get picked while the
   * point is being contested — which is the only time levelling the block round
   * it means anything. `RULES.airstrikeSalvoDelay` still holds the first one off
   * the opening of the round and `airstrikeInterval` is still the random gap.
   *
   * Built from `world.demolitions` rather than authored, so a building added to
   * or removed from the demolition list needs no second edit here.
   */
  _buildDemoSalvos() {
    const byZone = new Map();
    for (const s of this.sites) {
      if (!s.demo || s.dropped) continue;
      const z = s.demo.zone ?? '?';
      if (!byZone.has(z)) byZone.set(z, []);
      byZone.get(z).push(s);
    }
    for (const [zone, members] of byZone) {
      if (members.length < 2) continue;
      const centre = new THREE.Vector3();
      for (const m of members) centre.add(m.position);
      centre.multiplyScalar(1 / members.length);
      let span = 0;
      for (const a of members) for (const b of members) span = Math.max(span, a.position.distanceTo(b.position));
      let chunks = 0;
      for (const m of members) chunks += m.chunkCount;
      this.salvos.push({
        id: `DISTRICT-${zone}`,
        name: `${zone} DISTRICT`,
        index: this.salvos.length,
        sites: members,
        // Wider than a block salvo's fifth of a second: these are whole
        // buildings tens of metres apart, and the eye needs to see each one go.
        stagger: members.map((_, i) => i * 0.55),
        centre,
        span,
        chunkCount: chunks,
        position: centre,
      });
      console.info(
        `[airstrike] salvo DISTRICT-${zone}: ${members.map((m) => m.id).join('+')} — ` +
          `${chunks} chunks, ${members.length} BUILDINGS over ${span.toFixed(1)} m`
      );
    }
  }

  /**
   * `?demo=down` — boot with every destructible building already collapsed.
   *
   * Every gate in `tools/` boots the level, measures it and exits, so all of
   * them only ever see the INTACT map — and a map that is only ever gated intact
   * is exactly how this project has shipped broken states before. The flag is
   * read once, here, after the nav patches are baked and the route gate has run,
   * and it applies precisely what `_bakeSettled` applies: the ruin drawn, the
   * ruin solid, the nav patch in. `node tools/navcheck.mjs --url=…/?demo=down`
   * then measures the levelled city with no change to any tool.
   */
  _bootFlag() {
    let flag = null;
    try {
      flag = new URLSearchParams(globalThis.location?.search ?? '').get('demo');
    } catch {
      flag = null;
    }
    if (flag !== 'down') return;
    const n = this.forceDemoNav(true);
    console.info(`[airstrike] ?demo=down — ${n} buildings booted COLLAPSED`);
  }

  /**
   * Put every demolition into (or out of) its settled state without the event:
   * the ruin drawn, the ruin solid and the nav patch applied. The boot flag and
   * `_demoprobe.mjs` are the only callers — a round uses `fire()`.
   * @returns {number} how many changed
   */
  forceDemoNav(down = true) {
    let n = 0;
    for (const site of this.sites) {
      if (!site.demo || site.dropped) continue;
      if (site.demo.down === !!down) continue;
      site.demo.setDown(!!down);
      site.struck = !!down;
      site.baked = !!down;
      if (site.blocking && site.nav) this._applyNav(site, !!down);
      n++;
    }
    return n;
  }

  /* ====================================================================== */
  /* THE BUILDINGS THEMSELVES                                               */
  /* ====================================================================== */
  /**
   * ────────────────────────────────────────────────────────────────────────────
   * "破壊というのは原型を留めない感じ。壊れるオブジェを入れてそれを破壊するのではなく、
   *  建物自体に壊れた時のキャッシュを持たせて、壊し方を派手にして"
   * "AとBの周りの街は爆撃で定期的に破壊して、その際に周りの建物が完全に崩れ、いろんな
   *  方向から到達可能にすること"
   * ────────────────────────────────────────────────────────────────────────────
   * Every site above this line is a mass ADDED ON TOP OF a building — a parapet,
   * an extra storey, a bay of aisle roof. They are good hazards and they are not
   * what was asked for: after one fires the building is still standing, still the
   * same shape, and still exactly as impassable. The map does not change.
   *
   * These sites are the buildings. `src/world/demolition.js` builds a second,
   * COLLAPSED form of six blocks round the two flank capture points at boot —
   * corner stubs, pancaked slabs and a debris field graded so `A*` can walk over
   * it — and publishes both forms as `world.demolitions`. What crosses the
   * subsystem line is DATA: the boxes the building is made of, in its own frame,
   * because `match` may not import `world` and `world` may not import the vertex
   * program below. Everything else here is the machinery that already exists —
   * the same `fracture`, the same closed-form trajectory in four instanced
   * attributes, the same settled-pose memcpy, the same nav patch, the same route
   * gate. A site is a site.
   *
   * THREE THINGS ARE DIFFERENT, and all three follow from the mass being the
   * building rather than an ornament on it:
   *
   *   1. The chunks are HIDDEN until it fires. Every other site's rest pose is
   *      geometry that exists nowhere else; this one's rest pose is the building,
   *      which `world` is already drawing. Two copies of the same wall is
   *      z-fighting, so the InstancedMesh is `visible = false` until the frame
   *      the shell stops being drawn.
   *   2. There is no mound proxy. `world` owns the ruin's collision, because
   *      `world` owns level geometry — this file only asks for it to be switched.
   *   3. The settle probe is run with the ruin already solid, so the chunks come
   *      to rest ON the debris field rather than on the roof of the building they
   *      are in the process of being.
   */
  _buildDemoSites(world, physics) {
    const list = world.demolitions;
    if (!list?.length) return;
    for (const rec of list) {
      const site = this._buildDemoSite(rec, this.sites.length, world, physics);
      if (site) this.sites.push(site);
    }
  }

  _buildDemoSite(rec, index, world, physics) {
    const rng = this.rng.fork();
    /**
     * THE FRAME. `_buildMesh` works in (u out, v along, y up) and derives the
     * chunk orientation from `yaw` alone, so the two have to agree: at
     * `yaw = levelYaw`, u is the level's +Z axis and v is its +X. `world`
     * authors the mass on (level X, up, level Z), so `at` swaps its two
     * horizontal components on the way in and nothing else moves.
     */
    const yaw = world.levelYaw ?? 0;
    const u = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); // level +Z
    const v = new THREE.Vector3(u.z, 0, -u.x); // level +X
    const base = rec.position.clone();
    base.y = 0; // the ruin is authored on the level's own ground plane

    const chunks = SURFACE_FOR.demo.map(() => []);
    let holed = 0;
    for (const part of rec.mass) {
      /**
       * A CHUNK IN A WINDOW IS NOT MASONRY. `world` publishes every opening it
       * cut in this elevation; dropping the chunks inside one is what keeps the
       * falling wall a facade instead of a beige rectangle. @see `_openings`.
       */
      const holes = part.holes ?? null;
      fracture(
        {
          id: part.id,
          size: [part.size[2], part.size[1], part.size[0]],
          at: [part.at[2], part.at[1], part.at[0]],
          cut: [part.cut[2], part.cut[1], part.cut[0]],
        },
        0,
        rng,
        (c) => {
          if (holes) {
            for (let i = 0; i < holes.length; i++) {
              const h = holes[i];
              if (
                Math.abs(c.cx - h.a[2]) < h.r[2] &&
                Math.abs(c.cy - h.a[1]) < h.r[1] &&
                Math.abs(c.cz - h.a[0]) < h.r[0]
              ) {
                holed++;
                return;
              }
            }
          }
          chunks[part.mat].push(c);
        }
      );
    }

    /** Where the bomb goes off: two thirds of the way up the elevation. */
    const blast = base.clone();
    blast.y = rec.top * 0.66;
    const ground = base.clone();
    ground.y += 1.0;

    const site = {
      id: rec.id,
      name: rec.name,
      index,
      kind: 'demo',
      /** The building's own record, so `fire` can swap the two cached forms. */
      demo: rec,
      radius: RULES.airstrikeRadius,
      damage: RULES.airstrikeDamage,
      position: ground,
      blast,
      mound: base.clone(),
      /**
       * Deliberately the SHORT half-extent: a 30 m block that scattered debris
       * over 30 m of radius would put chunks inside the buildings either side of
       * it. The pile reads across the middle of the plan and the ruin `world`
       * built covers the whole footprint underneath it.
       */
      moundR: Math.min(rec.halfW, rec.halfD) * 0.85,
      moundH: MOUND_H.demo,
      u,
      v,
      yaw,
      /** Where a settle probe has to start from to clear the whole building. */
      roofY: rec.top + 2,
      meshes: [],
      chunkCount: chunks.reduce((n, c) => n + c.length, 0),
      proxyId: -1,
      triStart: -1,
      triEnd: -1,
      nav: null,
      blocking: true,
      struck: false,
      t: -1,
      baked: false,
      /**
       * Two families of tint taken from the BUILDING'S OWN PLASTER, so the
       * rubble of a pink block is pink. The generic families in `_buildMesh` are
       * right for an anonymous added storey and wrong for a named building the
       * player has been looking at all round.
       */
      palette: [_tintFamily(rec.tint), [0x9a9691, 0x86837e, 0xa7a29a, 0x6e6a64]],
      uniforms: { uT: { value: -1 }, uAnim: { value: 1 } },
    };
    site.materials = SURFACE_FOR.demo.map((name) => this._makeMaterial(name, site.uniforms));

    /**
     * The settle probe runs against the RUIN, not against the building. A ray
     * dropped from over a building that is still standing finds its roof, and
     * every chunk would come to rest ten metres up in the air on the roof of the
     * thing it is falling off. Switched for the duration of the bake and back.
     */
    rec.setCollision(true);
    for (let m = 0; m < chunks.length; m++) {
      if (!chunks[m].length) continue;
      const mesh = this._buildMesh(site, chunks[m], m, base, u, v, blast, site.mound, rng, physics);
      // The building is still standing and still being drawn; these are the same
      // walls. @see point 1 in the note above.
      mesh.visible = false;
      site.meshes.push(mesh);
    }
    rec.setCollision(false);

    return site;
  }

  /**
   * A private instance of a library surface.
   *
   * NOT `materials.get()`: that returns a SHARED, cached material, and this one
   * needs `flatShading` (faceted chunks are what makes rubble read as broken
   * stone) plus an `onBeforeCompile` that rewrites `project_vertex`. Mutating
   * the shared instance would do both of those to every wall in the level.
   * Taking the baked texture set and building our own material on top of it
   * keeps the level's own albedo/normal/roughness bakes — the quality bar's
   * "no flat/untextured surfaces" — without touching anything shared.
   */
  _makeMaterial(name, uniforms) {
    return makeChunkMaterial(this.ctx, this._lib, name, uniforms);
  }

  /* ---- the free function that does the work is at the foot of the file --- */

  /* ------------------------------------------------------------- one site -- */

  /**
   * Find the roof plane this site's mass stands on, and refuse to build if
   * there is not one.
   *
   * ONE downward ray at one authored point is what let this feature ship
   * broken: when the map moved under the anchors, the ray answered "0.05 m" —
   * a perfectly valid height, just the tarmac — and the site built a building
   * storey in a road with nobody the wiser. So the probe is a small SEARCH,
   * and a miss is now fatal to the site rather than cosmetic.
   *
   * The search is a few dozen raycasts inside the footprint (varying how far in
   * from the building line and how far along it), taking the highest plane
   * found. All of it is boot work; nothing here is ever reached again.
   *
   * @returns {number} roof height, or NaN when the anchor is not on a building
   */
  /**
   * `spec.probe` OVERRIDES THE SEARCH, AND A CATHEDRAL IS WHY.
   *
   * The search takes the HIGHEST plane it finds inside the footprint, which is
   * exactly right for a shop with a flat roof and a stair hut on it and exactly
   * wrong for a building with a section. Measured on the first build of the
   * cathedral sites: anchored on the outer aisle wall, the default sweep (2-7.5 m
   * in, ∓5 m along) reached past the 4.85 m aisle to the nave roof at 15 m, over
   * the crossing dome at 21.6 m and, at the south end, onto the campanile's cap
   * at 32.8 m — so the mass was built at the roof plane of something 15 m INBOARD
   * of the wall it was authored on and hung in mid air over the aisle.
   *
   * `probe` is per-site and additive: give it insets that stay inside the bay the
   * anchor is actually on and the mass sits on the roof it is authored for. It
   * changes nothing for the eight sites that do not carry one.
   */
  _findRoof(anchor, u, v, physics, spec = null) {
    const p = this._v;
    let best = NaN;
    for (const inset of spec?.probe?.insets ?? [ROOF_INSET, 4.5, 6.0, 2.0, 7.5]) {
      for (const along of spec?.probe?.alongs ?? [0, 2.5, -2.5, 5, -5]) {
        p.copy(anchor).addScaledVector(u, -inset).addScaledVector(v, along);
        const h = physics.groundHeight(p.x, p.z, 40);
        if (Number.isFinite(h) && h >= 3 && !(h <= best)) best = h;
      }
    }
    return best;
  }

  _buildSite(spec, index, world, physics) {
    const rng = this.rng.fork();
    const kind = spec.kind ?? 'block';

    /* ---- frame ------------------------------------------------------- */
    const anchor = world.levelToWorld(spec.level[0], 0, spec.level[1], new THREE.Vector3());
    // The face direction is authored in level space and has to be rotated with
    // the level, like every other gameplay-authored facing in `match`.
    const yaw = Math.atan2(spec.face[0], spec.face[1]) + (world.levelYaw ?? 0);
    const u = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); // out over the lane
    const v = new THREE.Vector3(u.z, 0, -u.x); // along the facade
    // Roof height, probed INSIDE the footprint. Dropped from 40 m, over everything.
    const roofY = this._findRoof(anchor, u, v, physics, spec);
    if (!Number.isFinite(roofY)) {
      console.error(
        `[airstrike] ${spec.id}: no roof anywhere inside the footprint at level ` +
          `[${spec.level[0].toFixed(1)}, ${spec.level[1].toFixed(1)}] — SITE DROPPED. ` +
          'The anchor is not on a building; fix the level coordinates.'
      );
      return null;
    }
    const base = new THREE.Vector3(anchor.x, roofY, anchor.z);

    /* ---- how wide is the lane it falls into? --------------------------- */
    /**
     * A STRIKE MAY NOT SEAL A LANE, and `reach` on its own cannot promise that.
     *
     * The mound is a disc centred `reach * 0.52` out from the wall with radius
     * `reach * 0.92`, so it occupies `reach * 1.44` metres of the street — 6.3 m
     * at EAST. `tools/navcheck.mjs` run WITH every strike settled caught what
     * that does on a lane narrower than about ten metres: attack spawn 10 (and
     * on some dressing seeds spawn 1 as well) lost its route to site B entirely,
     * three boots out of three. From the outside that is a bot walking into a
     * rubble pile and standing there, which is the exact failure navcheck was
     * written for.
     *
     * So the lane is MEASURED — one ray across it at chest height — and the
     * mound is scaled to leave `LANE_CLEAR` metres of it walkable. It is the
     * same shape, just never wider than the street it is in.
     */
    const lane = (() => {
      /**
       * The ray has to START IN THE STREET, and that is the whole subtlety.
       *
       * Fired from just off the building line it starts at ROOF height — the
       * anchor is on the facade plane and half a metre out is still over the
       * parapet — so it sails over everything and reports a 40 m lane on a 12 m
       * street. That is exactly what EAST did, which is why EAST was the one
       * site that sealed its lane. So step out until the ground under the ray
       * is street rather than roof, then measure from there.
       */
      for (const out of [2.5, 4.0, 6.0, 8.0]) {
        const p = this._v.copy(base).addScaledVector(u, out);
        const g = physics.groundHeight(p.x, p.z, roofY + 2);
        if (!Number.isFinite(g) || g > roofY - 2.5) continue; // still on the roof
        p.y = g + 1.2;
        const hit = physics.raycast(p, u, 40, physics.MASK.WORLD);
        return (hit?.hit ? hit.distance : 40) + out;
      }
      return 40;
    })();

    /* ---- where the rubble ends up ------------------------------------ */
    let moundR = spec.reach * 0.92;
    let moundOut = spec.reach * 0.52;
    {
      const maxOut = Math.max(1.4, lane - LANE_CLEAR);
      const span = moundOut + moundR;
      if (span > maxOut) {
        const k = maxOut / span;
        moundR *= k;
        moundOut *= k;
      }
    }
    const moundC = new THREE.Vector3().copy(base).addScaledVector(u, moundOut);
    const streetY = physics.groundHeight(moundC.x, moundC.z, roofY + 2);
    moundC.y = Number.isFinite(streetY) ? streetY : world.groundHeight(moundC.x, moundC.z);
    const moundH = MOUND_H[kind];
    logLane(spec.id, lane, moundOut + moundR);

    /** Where the bomb goes off — at the roof line on the lane side. */
    const blast = new THREE.Vector3().copy(base).addScaledVector(u, 1.2);
    blast.y = roofY + 1.4;
    /** Where the DAMAGE is centred: street level, or a strike is a roof event. */
    const ground = new THREE.Vector3().copy(moundC);
    ground.y += 0.6;

    /* ---- where the real wall is --------------------------------------- */
    /**
     * The authored `level` point is the building LINE, and the kit does not put
     * every facade exactly on it — a shopfront is recessed, a pilaster is proud.
     * One horizontal ray finds the plane the skin and the balcony have to be
     * flush with, so they never hang in mid air. Measured at boot, once.
     */
    let facadeU = 0;
    {
      const from = new THREE.Vector3().copy(base).addScaledVector(u, 9);
      from.y = roofY - 1.4;
      const hit = physics.raycast(from, this._v.copy(u).multiplyScalar(-1), 13, physics.MASK.WORLD);
      if (hit?.hit) facadeU = 9 - hit.distance;
      /**
       * CLAMPED, because that ray can find the wrong wall.
       *
       * It is fired from 9 m out over the lane, and on a narrow lane 9 m out is
       * INSIDE the building on the other side — the ray then reports a facade
       * 8.3 m proud of the building line (measured at WEST) and the skin and
       * balcony get hung in mid-air over the middle of the street. The offset
       * this is for is a recessed shopfront or a proud pilaster, which is
       * decimetres; anything past 1.5 m is the ray having found somebody else's
       * wall, and the authored building line is the better answer.
       */
      if (Math.abs(facadeU) > 1.5) facadeU = 0;
      logFacade(spec.id, roofY, facadeU);
    }

    /* ---- cut the mass ------------------------------------------------- */
    const surfaces = SURFACE_FOR[kind];
    const chunks = surfaces.map(() => []);
    for (const part of MASS_FOR[kind]) {
      const shift = FACADE_PARTS.has(part.id) ? facadeU : 0;
      fracture(part, shift, rng, (c) => chunks[part.mat].push(c));
    }

    const site = {
      id: spec.id,
      name: spec.name,
      index,
      kind,
      /** Per-site blast, so a parapet is not a storey. */
      radius: spec.radius ?? (kind === 'route' ? RULES.routeStrikeRadius : RULES.airstrikeRadius),
      damage: spec.damage ?? (kind === 'route' ? RULES.routeStrikeDamage : RULES.airstrikeDamage),
      /** Where the HUD/markers should point: the impact, not the roof. */
      position: ground.clone(),
      blast: blast.clone(),
      mound: moundC.clone(),
      moundR,
      moundH,
      u: u.clone(),
      v: v.clone(),
      yaw,
      roofY,
      meshes: [],
      chunkCount: chunks.reduce((n, c) => n + c.length, 0),
      /** Cached collision handle + the triangle range it owns in the BVH. */
      proxyId: -1,
      triStart: -1,
      triEnd: -1,
      nav: null,
      /**
       * May this site's mound become solid ground? Cleared by `_verifyRoutes`
       * when the mound would cost somebody a route. Visual-only from then on.
       */
      blocking: true,
      struck: false,
      t: -1,
      baked: false,
      /**
       * ONE CLOCK PER SITE, not one for the level. Two materials share a site's
       * uniform object so both meshes move together, but site B settling must
       * not be able to reanimate site A's already-baked rubble.
       */
      uniforms: {
        /** Seconds since this site's strike; negative before it. */
        uT: { value: -1 },
        /** 1 while the baked curve drives the pose, 0 once it is baked in. */
        uAnim: { value: 1 },
      },
    };
    site.materials = surfaces.map((name) => this._makeMaterial(name, site.uniforms));

    for (let m = 0; m < chunks.length; m++) {
      if (!chunks[m].length) continue;
      site.meshes.push(this._buildMesh(site, chunks[m], m, base, u, v, blast, moundC, rng, physics));
    }

    /* ---- collision proxy for the mound, parked on layer 0 -------------- */
    const proxy = this._buildMoundProxy(site, rng);
    site.proxyMesh = proxy;
    site.proxyId = physics.addStatic(proxy, 'concrete', { mask: 0 });

    return site;
  }

  /**
   * One InstancedMesh: the rest pose in `instanceMatrix`, the whole animation in
   * four instanced attributes, and the settled pose kept beside it on the CPU.
   */
  _buildMesh(site, chunks, matIndex, base, u, v, blast, moundC, rng, physics) {
    const n = chunks.length;
    const geo = chunkGeometry();
    const mesh = new THREE.InstancedMesh(geo, site.materials[matIndex], n);
    mesh.name = `airstrike_${site.id}_${matIndex}`;
    mesh.frustumCulled = false; // the chunks leave the rest pose's bounds
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const mot = new Float32Array(n * 4);
    const off = new Float32Array(n * 3);
    const axis = new Float32Array(n * 3);
    const uv = new Float32Array(n * 3);
    const settled = new Float32Array(n * 16);
    const colour = new Float32Array(n * 3);

    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const q2 = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const m4 = new THREE.Matrix4();
    const dir = new THREE.Vector3();
    const settlePos = new THREE.Vector3();
    const ax = new THREE.Vector3();
    const tint = new THREE.Color();

    /**
     * Two families of tint per material, so the pile is not one colour. Keyed
     * off the SURFACE, not the slot index: a route site has only one material
     * and it is the concrete one, so keying off `matIndex === 0` would render
     * every route mound in render plaster.
     */
    const palette = site.palette?.[matIndex]
      ?? (SURFACE_FOR[site.kind][matIndex] === 'plaster'
        ? [0xc9b294, 0xb9a184, 0xd6c6ab, 0xa8836a]
        : [0x9a9691, 0x86837e, 0xa7a29a, 0x6e6a64]);

    for (let i = 0; i < n; i++) {
      const c = chunks[i];

      /* ---- rest pose ------------------------------------------------- */
      pos.copy(base)
        .addScaledVector(u, c.cx)
        .addScaledVector(v, c.cz);
      pos.y += c.cy;
      // Nothing perfectly straight: a couple of degrees of settle on every
      // chunk, which also stops the fracture grid reading as a grid.
      q.setFromAxisAngle(UP, site.yaw);
      q2.setFromAxisAngle(
        ax.set(rng.signed(), rng.signed(), rng.signed()).normalize(),
        rng.range(-0.022, 0.022)
      );
      q.multiply(q2);
      // AXIS ORDER MATTERS AND IT IS NOT THE OBVIOUS ONE. The chunk's local +X
      // ends up along the facade (`v`) and its local +Z out over the lane (`u`)
      // once the site yaw is applied, so the u/v half-extents cross over here.
      // Getting this backwards makes the facade skin 0.65 m deep and 0.34 m
      // wide instead of the other way round — which shows up as 30 cm black
      // gaps between every column of the intact wall.
      scale.set(c.hz * 2, c.hy * 2, c.hx * 2);
      m4.compose(pos, q, scale);
      m4.toArray(mesh.instanceMatrix.array, i * 16);

      /* ---- where it ends up ------------------------------------------ */
      // Thrown away from the blast, biased outward over the lane.
      dir.copy(pos).sub(blast);
      const distToBlast = Math.max(0.6, dir.length());
      dir.y = 0;
      if (dir.lengthSq() < 1e-4) dir.copy(u);
      // A ROOF MASS IS BLOWN OUT OVER THE LANE; A BUILDING FALLS INTO ITSELF.
      // The blast of a demolition is at the middle of the plan, so `dir` is
      // already radial and biasing it along `u` would throw the whole building
      // sideways into the street behind it.
      dir.normalize();
      if (site.kind !== 'demo') dir.addScaledVector(u, 1.35).normalize();

      // 72% of the mass piles up; the rest is thrown clear down the lane.
      const scatter = rng.float() < 0.28;
      const r = scatter
        ? site.moundR * rng.range(1.15, 2.45)
        : site.moundR * Math.sqrt(rng.float()) * 0.96;
      const spread = rng.range(-0.85, 0.85);
      settlePos
        .copy(moundC)
        .addScaledVector(dir, r * rng.range(0.55, 1.0))
        .addScaledVector(site.v, spread * site.moundR * 0.75);

      // The pile: a squashed dome, so chunks near the middle end up on top of
      // the ones underneath instead of all sitting on the tarmac.
      const rr = Math.min(1, settlePos.distanceTo(moundC) / site.moundR);
      const floor = physics.groundHeight(settlePos.x, settlePos.z, site.roofY + 1);
      const groundY = Number.isFinite(floor) ? floor : moundC.y;
      const pile = scatter ? 0 : site.moundH * (1 - rr * rr);
      settlePos.y = groundY + pile + Math.max(c.hx, c.hy, c.hz) * 0.72;

      /* ---- the curve, solved here and never again --------------------- */
      // Shock reaches a chunk at ~340 m/s of *apparent* propagation; slowed to
      // something readable so you can see the break run through the mass.
      const demo = site.kind === 'demo';
      /**
       * ────────────────────────────────────────────────────────────────────
       * A BUILDING PANCAKES. IT DOES NOT GET BLOWN UPWARDS.
       * ────────────────────────────────────────────────────────────────────
       * The two lines below are right for every other kind — a bomb hits an
       * added storey, throws it up and out, and it arcs into the lane — and
       * photographing a demolition with them showed exactly how wrong they are
       * for a building: a metre into the collapse the whole elevation was
       * TRAVELLING UPWARDS (`arc` reaches 3.5 m of loft near the detonation) and
       * the wall read as a slab being lifted off the ground.
       *
       * So a demolition gets the other physics. `delay` runs top-down instead of
       * outward from the blast, which is what a collapse looks like and is the
       * thing that makes the storeys go in sequence; `flight` is free fall with
       * almost none of the stretch; and `arc` is nothing at all except for the
       * quarter that is thrown clear. The whole building is on the ground in
       * about two seconds instead of drifting for three.
       */
      const above = demo ? Math.max(0, pos.y - base.y) / Math.max(4, site.demo.top) : 0;
      const delay = demo
        ? (1 - Math.min(1, above)) * 0.5 + rng.range(0, 0.06)
        : Math.min(0.42, (distToBlast - 0.6) * 0.045) + rng.range(0, 0.07);
      const drop = Math.max(0.5, pos.y - settlePos.y);
      // Free fall for the drop, stretched a little for the ones thrown clear.
      const flight = clamp(
        Math.sqrt((2 * drop) / 9.81) * (demo ? rng.range(0.9, 1.15) : rng.range(1.05, 1.55)),
        0.55,
        3.1
      );
      // Chunks close to the detonation get lofted; the rest just fall away.
      const arc = demo
        ? (scatter ? rng.range(0.6, 1.4) : rng.range(0.0, 0.18))
        : clamp(3.4 / distToBlast, 0.15, 2.6) * rng.range(0.5, 1.35) + (scatter ? 0.9 : 0);
      const spin = rng.range(1.4, 7.5) * (rng.float() < 0.5 ? -1 : 1);

      mot[i * 4] = delay;
      mot[i * 4 + 1] = flight;
      mot[i * 4 + 2] = arc;
      mot[i * 4 + 3] = spin;

      off[i * 3] = settlePos.x - pos.x;
      off[i * 3 + 1] = settlePos.y - pos.y;
      off[i * 3 + 2] = settlePos.z - pos.z;

      ax.set(rng.signed(), rng.signed() * 0.4, rng.signed()).normalize();
      axis[i * 3] = ax.x;
      axis[i * 3 + 1] = ax.y;
      axis[i * 3 + 2] = ax.z;

      uv[i * 3] = rng.float();
      uv[i * 3 + 1] = rng.float();
      uv[i * 3 + 2] = rng.range(0.55, 1.35);

      /* ---- the settled matrix, for the hand-back at the end ----------- */
      q2.setFromAxisAngle(ax, spin);
      q2.multiply(q);
      m4.compose(settlePos, q2, scale);
      m4.toArray(settled, i * 16);

      tint.setHex(palette[(rng.u32() >>> 3) % palette.length]);
      const k = rng.range(0.82, 1.12);
      colour[i * 3] = tint.r * k;
      colour[i * 3 + 1] = tint.g * k;
      colour[i * 3 + 2] = tint.b * k;
    }

    mesh.instanceMatrix.needsUpdate = true;
    /** The intact pose, kept so a round reset can put the town back up. */
    mesh.userData.rest = new Float32Array(mesh.instanceMatrix.array);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colour, 3);
    mesh.instanceColor.needsUpdate = true;
    geo.setAttribute('aMot', new THREE.InstancedBufferAttribute(mot, 4));
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
    geo.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 3));
    geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 3));
    mesh.userData.settled = settled;
    mesh.updateMatrix();
    this.group.add(mesh);
    return mesh;
  }

  /**
   * Collision for the settled mound: eight overlapping boxes on a dome profile
   * rather than the 260 chunks, because a character sweeping a capsule against
   * three thousand rubble triangles is a way to get stuck in a rubble pile.
   */
  _buildMoundProxy(site, rng) {
    const geos = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rings = [
      { r: 0.0, n: 1, h: 1.0, w: 0.5 },
      { r: 0.52, n: 4, h: 0.66, w: 0.44 },
      { r: 0.88, n: 5, h: 0.32, w: 0.4 },
    ];
    for (const ring of rings) {
      for (let i = 0; i < ring.n; i++) {
        const a = (i / ring.n) * Math.PI * 2 + rng.range(-0.3, 0.3);
        pos.copy(site.mound)
          .addScaledVector(site.u, Math.cos(a) * ring.r * site.moundR)
          .addScaledVector(site.v, Math.sin(a) * ring.r * site.moundR);
        const h = site.moundH * ring.h * rng.range(0.85, 1.1);
        pos.y = site.mound.y + h * 0.5 - 0.25; // sunk, so the top is walkable
        q.setFromAxisAngle(UP, site.yaw + rng.range(-0.4, 0.4));
        const w = site.moundR * ring.w * rng.range(0.9, 1.15);
        scale.set(w * 2, h, w * 2);
        const g = new THREE.BoxGeometry(1, 1, 1);
        g.applyMatrix4(m4.compose(pos, q, scale));
        geos.push(g);
      }
    }
    const geo = mergeGeometries(geos);
    const mesh = new THREE.Mesh(geo, site.materials[site.materials.length - 1]);
    mesh.name = `airstrike_${site.id}_rubble_proxy`;
    mesh.visible = false; // it is collision, the chunks are the picture
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    return mesh;
  }

  /** Find the contiguous triangle range the BVH gave our proxy. */
  _cacheTriRange(site) {
    const sw = this.physics?.staticWorld;
    if (!sw || site.proxyId < 0 || !sw.object) return;
    let start = -1;
    let end = -1;
    for (let t = 0; t < sw.object.length; t++) {
      if (sw.object[t] !== site.proxyId) continue;
      if (start < 0) start = t;
      end = t + 1;
    }
    site.triStart = start;
    site.triEnd = end;
  }

  /**
   * Re-probe the nav cells the mound covers, with the mound temporarily solid,
   * and keep both the before and the after. This is a copy of `NavGrid.build`'s
   * inner loop over a few hundred cells instead of twenty-two thousand — the
   * whole reason the strike can afford to change the navigation at all.
   */
  _bakeNavPatch(site, ai, physics) {
    const g = ai?.grid;
    if (!g || (!site.demo && site.triStart < 0)) return;

    /**
     * A DEMOLITION'S RECTANGLE IS THE BUILDING'S, NOT A MOUND'S. It is also the
     * one case where the patch mostly turns cells ON rather than off: the plan
     * of a three-storey block is a few hundred cells that have never been
     * walkable, and after the collapse every one of them is a slope you can
     * cross. @see `_verifyRoutes`, which measures exactly that.
     */
    const r = site.demo ? site.demo.navRect : null;
    const pad = site.moundR * 2.6 + 1.5;
    const ix0 = Math.max(0, g.cellX(r ? r.x0 : site.mound.x - pad));
    const ix1 = Math.min(g.nx - 1, g.cellX(r ? r.x1 : site.mound.x + pad));
    const iz0 = Math.max(0, g.cellZ(r ? r.z0 : site.mound.z - pad));
    const iz1 = Math.min(g.nz - 1, g.cellZ(r ? r.z1 : site.mound.z + pad));
    const count = Math.max(0, (ix1 - ix0 + 1) * (iz1 - iz0 + 1));
    if (count <= 0) return;

    const cells = new Int32Array(count);
    const oldFlags = new Uint8Array(count);
    const oldFloor = new Float32Array(count);
    const oldEnc = new Uint8Array(count);
    const newFlags = new Uint8Array(count);
    const newFloor = new Float32Array(count);
    const newEnc = new Uint8Array(count);

    let k = 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = g.index(ix, iz);
        cells[k] = i;
        oldFlags[k] = g.flags[i];
        oldFloor[k] = g.floor[i];
        oldEnc[k] = g.enclosure[i];
        k++;
      }
    }

    // Make it solid, re-probe, take the answer, put it back.
    this._setSiteSolid(site, true);
    k = 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const probe = probeCell(g, physics, ix, iz);
        newFlags[k] = probe.flag;
        newFloor[k] = probe.floor;
        newEnc[k] = probe.enclosure;
        k++;
      }
    }
    this._setSiteSolid(site, false);

    // Only keep the cells the mound actually changed — typically a third of the
    // rectangle, and the apply loop is proportional to what we keep.
    let changed = 0;
    for (let i = 0; i < count; i++) {
      if (newFlags[i] !== oldFlags[i] || Math.abs(newFloor[i] - oldFloor[i]) > 0.02) changed++;
    }
    const c = new Int32Array(changed);
    const of = new Uint8Array(changed);
    const oy = new Float32Array(changed);
    const oe = new Uint8Array(changed);
    const nf = new Uint8Array(changed);
    const ny = new Float32Array(changed);
    const ne = new Uint8Array(changed);
    let j = 0;
    for (let i = 0; i < count; i++) {
      if (newFlags[i] === oldFlags[i] && Math.abs(newFloor[i] - oldFloor[i]) <= 0.02) continue;
      c[j] = cells[i];
      of[j] = oldFlags[i];
      oy[j] = oldFloor[i];
      oe[j] = oldEnc[i];
      nf[j] = newFlags[i];
      ny[j] = newFloor[i];
      ne[j] = newEnc[i];
      j++;
    }
    site.nav = { grid: g, cells: c, oldFlags: of, oldFloor: oy, oldEnc: oe, newFlags: nf, newFloor: ny, newEnc: ne };
  }

  /**
   * Make a site's settled state solid or not, whatever kind of site it is: a
   * mound proxy this file owns, or a whole building `world` owns. Collision
   * only — the picture is `_bakeSettled`'s and `fire`'s business.
   */
  _setSiteSolid(site, solid) {
    if (site.demo) {
      site.demo.setCollision(solid);
      return;
    }
    this._setProxySolid(site, solid);
  }

  /** Layer-mask flip on a cached triangle range. No rebuild, no allocation. */
  _setProxySolid(site, solid) {
    const sw = this.physics?.staticWorld;
    if (!sw || site.triStart < 0) return;
    // A rebuild by anybody else repacks the triangle array. `obj.mask` is kept
    // in step below so the rebuild itself is correct; the cached RANGE is what
    // goes stale, so re-derive it when the first triangle is no longer ours.
    // Never on the fire frame — this is only reached at settle and at reset.
    if (sw.object?.[site.triStart] !== site.proxyId) this._cacheTriRange(site);
    if (site.triStart < 0) return;
    const LAYER = this.physics.LAYER;
    const m = solid ? LAYER.STATIC : 0;
    sw.mask.fill(m, site.triStart, site.triEnd);
    // Keep the source of truth in step, so a rebuild by anyone else is right.
    const obj = sw.objects[site.proxyId];
    if (obj) obj.mask = m;
  }

  /**
   * PROVE, AT BOOT, THAT NO SITE CAN COST ANYBODY A ROUTE.
   *
   * `tools/navcheck.mjs` asserts that every spawn of both teams can A* to every
   * bomb site and hold point — and it boots, measures and exits, so it only
   * ever sees the INTACT map. That is a real hole: the mounds are the one thing
   * in the game that changes navigation mid-round, and they are exactly what
   * navcheck was written to catch. Running the gate with the strikes settled is
   * how EAST was caught sealing the B lane.
   *
   * So the gate is inside the feature now. `match` hands us the same
   * spawn/target pairs navcheck uses; a site that costs a route the intact map
   * had loses its ability to block. `blocking = false` means the rubble still
   * falls, still reads and still hurts — the mound proxy is simply never made
   * solid and the nav patch never applied. The map's navigation is then
   * provably no worse than the one navcheck signed off.
   *
   * IT HAS TO BE CUMULATIVE, and testing one site at a time is the version of
   * this that does not work. Measured: with each of the eight applied ALONE,
   * all 90 routes survive every time; with all eight applied together, attack
   * spawn 10 loses site B on four boots out of four. Two mounds a lane apart
   * each leave a way past and together leave none. So the sites are walked in
   * order and each is judged against the ones already KEPT — which is the state
   * the map is actually in late in a round, when five have come down.
   *
   * A* only reads the grid, so this needs no collision change and no rebuild.
   * It costs about 0.6 s at boot, inside the loading state, and buys the one
   * invariant nothing else in the repo can check.
   */
  _verifyRoutes(ai) {
    const grid = ai?.grid;
    const routes = this._routes;
    if (!grid || !routes?.length) return;
    const t0 = performance.now();
    const out = [];
    const reach = () => {
      let n = 0;
      for (const [from, to] of routes) if (grid.findPath(from, to, out) > 0) n++;
      return n;
    };
    const intact = reach();
    const kept = [];
    for (const site of this.sites) {
      if (!site.nav) continue;
      this._applyNav(site, true);
      const withIt = reach();
      if (withIt >= intact) {
        kept.push(site);
        continue;
      }
      this._applyNav(site, false);
      site.blocking = false;
      /**
       * A DEMOLITION THAT FAILS THE GATE IS DROPPED, NOT DEMOTED.
       *
       * For every other site "the rubble still falls, it just cannot be stood
       * on" is a coherent state: the mass was an ornament and the building under
       * it is untouched. For a demolition it is not — the shell is GONE the
       * frame it fires, so a ruin that may not become ground would leave the
       * building's own collision standing invisibly in the street. There is no
       * halfway house, so the site never fires at all and the boot says so.
       */
      if (site.demo) site.dropped = true;
      console.error(
        `[airstrike] ${site.id}: on top of ${kept.map((s) => s.id).join('+') || 'nothing'}, its ` +
          (site.demo
            ? `ruin costs ${intact - withIt} of ${routes.length} spawn/target routes — THE ` +
              'BUILDING IS DROPPED FROM THE DEMOLITION LIST and will never come down. Its debris ' +
              'field must not narrow a lane; see `APRON` in src/world/demolition.js.'
            : `mound costs ${intact - withIt} of ${routes.length} spawn/target routes — COLLISION ` +
              'AND NAV DISABLED for this site. The rubble still falls; it just cannot be stood on ' +
              'or walked round. Widen the lane or lower `reach`.')
      );
    }
    // Back to the intact map — the round has not started.
    for (const site of kept) this._applyNav(site, false);
    /**
     * AND THE OTHER DIRECTION, WHICH IS THE WHOLE CLAIM OF THE DEMOLITIONS.
     * `intact` is what the map can reach standing; `razed` is what it can reach
     * with every strike settled AND every building down. A collapse that opens
     * approaches cannot lower it and should raise the walkable cell count by the
     * plan area of six buildings. Both numbers are printed rather than asserted
     * because "more routes" is not a failure condition — a DROP is, and that is
     * what the loop above already refuses.
     */
    let razed = intact;
    let cells = 0;
    for (const s of kept) {
      this._applyNav(s, true);
      cells += s.nav.cells.length;
    }
    razed = reach();
    for (const s of kept) this._applyNav(s, false);
    console.info(
      `[airstrike] route gate: ${intact}/${routes.length} routes intact, ${razed}/${routes.length} ` +
        `with the town levelled, ${kept.length}/${this.sites.length} sites keep their collision ` +
        `(${cells} nav cells) (${(performance.now() - t0).toFixed(0)}ms)`
    );
  }

  _applyNav(site, solid) {
    const n = site.nav;
    if (!n) return;
    const g = n.grid;
    const flags = solid ? n.newFlags : n.oldFlags;
    const floor = solid ? n.newFloor : n.oldFloor;
    const enc = solid ? n.newEnc : n.oldEnc;
    for (let i = 0; i < n.cells.length; i++) {
      const ci = n.cells[i];
      g.flags[ci] = flags[i];
      g.floor[ci] = floor[i];
      g.enclosure[ci] = enc[i];
    }
  }

  /* ====================================================================== */
  /* THE FIRE FRAME — this is the budget                                    */
  /* ====================================================================== */

  /**
   * Drop the bomb on `which` NOW. Everything below is a write; nothing here
   * builds geometry, solves a trajectory, rebuilds a BVH or allocates.
   */
  fire(which = 0, group = null) {
    const site = this._siteOf(which);
    if (!site || site.struck || site.dropped) return false;
    const ctx = this.ctx;

    site.struck = true;
    site.t = 0;
    site.baked = false;
    this._live.push(site);

    /**
     * 1. THE BUILDING STOPS BEING A BUILDING, and its collision goes WITH the
     *    picture rather than six and a half seconds after it.
     *
     *    Every other site can leave collision to `_bakeSettled`, because nothing
     *    it owns was ever solid: the mass is an ornament and the mound proxy is
     *    new ground appearing where there was street. A demolition is the other
     *    way round — the walls were the building — so deferring the flip leaves
     *    the shell INVISIBLE AND SOLID for the whole collapse, which is a man
     *    walking face-first into a building he has just watched fall over.
     *    Measured on the first build of this: `shellVisible false, shellSolid
     *    true` for 6.5 s.
     *
     *    So the two index-range fills and the two mask fills happen together, on
     *    this frame, under the fireball. NAVIGATION still waits — the patch is
     *    ~450 cells and the bots may as well keep walking round the block while
     *    it is still coming down. @see `_bakeSettled`.
     */
    if (site.demo) {
      site.demo.setVisual(true);
      if (site.blocking) site.demo.setCollision(true);
      site.demo.down = true;
      for (const mesh of site.meshes) mesh.visible = true;
    }

    // 2. hand the pose over to the baked curve
    for (const mesh of site.meshes) {
      // The shadow cascades and the depth prepass draw through an override
      // material, which does not carry our vertex code — so while the curve is
      // driving, they would draw the REST pose. Out of both until it settles.
      mesh.userData.owNoShadow = true;
      mesh.userData.owNoPrepass = true;
    }
    site.uniforms.uT.value = 0;
    site.uniforms.uAnim.value = 1;

    // 2. the blast: the canonical event, so `physics`, `player`, `ai`, `fx` and
    //    `audio` all do what they already do for the C4.
    const b = this._blast;
    b.position = site.position;
    b.radius = site.radius;
    b.damage = site.damage;
    ctx.events.emit('explosion', b);

    // 3. the show. Every one of these writes into a preallocated ring in `fx`.
    //    A site inside a salvo runs the reduced version — see SALVO_DUST for why
    //    three full spectacles would steal each other's smoke emitters.
    this._spectacle(site, !!group);

    // 4. the sound the blast event does not cover
    const audio = this._audio ?? (this._audio = ctx.peek('audio'));
    if (audio?.play) {
      audio.play('strike_tail', site.position, {
        level: group ? 1.55 : 1.25, maxDist: 400, gain: group ? 2.6 : 2.2, occlusion: 0,
      });
      audio.play('strike_rubble', site.mound, { level: 1.1, dur: 3.4, extraDelay: 0.34, maxDist: 220 });
    }

    // 5. one line per strike, so "it never happens" is answerable from a log
    //    rather than from memory. This is the only console write in the frame.
    console.info(
      `[airstrike] IMPACT ${site.id} (${site.kind}) at t=${ctx.time.elapsed.toFixed(1)}s ` +
        `— ${site.chunkCount} chunks, ${site.damage} dmg / ${site.radius} m, roof ${site.roofY.toFixed(1)} m` +
        (group ? ` · SALVO ${group.id}` : '')
    );

    // 6. tell the HUD it landed, once per event rather than once per site, and
    //    before the event goes out for the same reason as the telegraph above.
    if (!group || group.sites[0] === site) {
      this._announce(this.onImpact, group ? 'SALVO' : 'STRIKE', group ?? site, group ? group.sites : null);
    }
    this._emit('impact', site);
    return true;
  }

  /**
   * The visual event on top of the standard `explosion` handler: a second
   * fireball up at the roof line, a shockwave ring, a dust wall rolling out of
   * the building and a column that keeps rising for ten seconds.
   */
  _spectacle(site, inSalvo = false) {
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (!fx) return;
    const b = site.blast;
    const u = site.u;
    const v = site.v;

    // The roof burst — the one you actually see, up where the mass is.
    fx.explosion({ position: b, radius: site.radius * 0.62 });
    fx.hazeRing(b.x, b.y, b.z, 3.2, 26, 0.55, 2.9);

    /**
     * A WHOLE BUILDING MAKES ITS OWN WEATHER, and it has to, for a reason that
     * is not decoration: the frame it fires on, a three-storey elevation with
     * balconies and open casements is replaced by the same wall cut into
     * fourteen hundred pieces, and for the half second before the pieces
     * separate that is a plainer picture than the building was. The dust is what
     * covers the swap — it goes up the full height of the plan, on the footprint
     * itself, on the same frame. Six emitters, which is the same budget a single
     * strike already spends. @see SALVO_DUST for why the count matters.
     */
    if (site.kind === 'demo') {
      const hw = site.demo.halfW;
      const hd = site.demo.halfD;
      fx.hazeRing(site.mound.x, site.mound.y + 0.6, site.mound.z, Math.max(hw, hd) * 0.9, 34, 0.7, 3.6);
      const ring = [[0, 0], [0.72, 0.72], [-0.72, 0.72], [0.72, -0.72], [-0.72, -0.72]];
      for (let i = 0; i < ring.length; i++) {
        const [a, c] = ring[i];
        const mid = i === 0;
        fx.addSmokeColumn(
          site.mound.x + v.x * a * hw + u.x * c * hd,
          site.mound.y + 0.4,
          site.mound.z + v.z * a * hw + u.z * c * hd,
          {
            radius: mid ? 5.4 : 3.6,
            duration: mid ? 6.5 : 4.6,
            rate: mid ? 16 : 12,
            rise: mid ? 3.4 : 2.6,
            dark: 0.24,
            life: mid ? 11 : 8.5,
            growth: mid ? 8.0 : 6.2,
          }
        );
      }
      fx.scorch(site.mound.x, site.mound.y + 0.2, site.mound.z, Math.max(hw, hd) * 1.5);
      if (fx.lights) fx.lights.flash(b.x, b.y, b.z, 1, 0.66, 0.34, 2400, 0.75, 11, 90, 6);
      return;
    }

    if (inSalvo) {
      // Three columns instead of six, and no mound column: the group's own dust
      // wall covers the frontage and the emitter pool has to be shared.
      for (let i = -1; i <= 1; i++) {
        const t = i * 3.0;
        fx.addSmokeColumn(b.x + v.x * t + u.x * 0.6, site.mound.y + 0.35, b.z + v.z * t + u.z * 0.6, {
          radius: 3.0, duration: 3.2, rate: 12, rise: 2.5, dark: 0.18, life: 7.5, growth: 5.8,
        });
      }
      fx.scorch(site.mound.x, site.mound.y + 0.2, site.mound.z, 6.5);
      if (fx.lights) fx.lights.flash(b.x, b.y, b.z, 1, 0.68, 0.36, 1600, 0.6, 9, 70, 5);
      return;
    }

    // Dust boiling out along the facade, both ways, plus one rolling into the
    // lane. Five columns is what turns "some boxes fell" into a collapse.
    for (let i = -2; i <= 2; i++) {
      const t = i * 2.2;
      fx.addSmokeColumn(
        b.x + v.x * t + u.x * 0.6,
        site.mound.y + 0.35,
        b.z + v.z * t + u.z * 0.6,
        {
          radius: 2.6,
          duration: 2.6 + Math.abs(i) * 0.4,
          rate: 11,
          rise: 2.4,
          dark: 0.16,
          life: 6.5,
          growth: 5.2,
        }
      );
    }
    fx.addSmokeColumn(site.mound.x, site.mound.y + 0.3, site.mound.z, {
      radius: 4.2,
      duration: 4.5,
      rate: 14,
      rise: 1.9,
      dark: 0.2,
      life: 9,
      growth: 6.4,
    });
    fx.scorch(site.mound.x, site.mound.y + 0.2, site.mound.z, 6.5);
    if (fx.lights) {
      fx.lights.flash(b.x, b.y, b.z, 1, 0.68, 0.36, 1600, 0.6, 9, 70, 5);
    }
  }

  /** The telegraphed version: jet, whistle, then `fire()`. */
  call(which = 0) {
    const site = this._siteOf(which);
    if (!site || site.struck || site.dropped) return false;
    if (this._pending.some((p) => p.site === site)) return false;
    this._pending.push({ site, group: null, k: 0, t: 0, stage: 0 });
    return true;
  }

  /**
   * THE BLOCK EVENT. One telegraph, one announcement, three sites.
   *
   * Deliberately the same pending record and the same JET_LEAD / WHISTLE_LEAD as
   * a single strike: the player has already learnt what that sound means and
   * this must not need re-learning, it must simply be much bigger when it
   * arrives. The only differences are that the telegraph is placed at the middle
   * of the block and mixed louder, and that stage 2 fires three sites over half
   * a second instead of one.
   */
  callSalvo(which = 0) {
    const group = typeof which === 'number' ? this.salvos[which] : this.salvos.find((g) => g.id === which);
    if (!group) return false;
    // Every member has to be standing, or "the block comes down" is a lie the
    // first time one of its three has already been struck on its own.
    for (const s of group.sites) if (s.struck || s.dropped) return false;
    if (this._pending.some((p) => p.group === group)) return false;
    this._pending.push({ site: group.sites[0], group, k: 0, t: 0, stage: 0 });
    return true;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────────
   * THE CATHEDRAL MEGA-DESTRUCTION EVENT, AND WHO IS ALLOWED TO CALL IT
   * ────────────────────────────────────────────────────────────────────────────
   * "大聖堂大破壊イベントも入れてね"
   * "マップの左右のいく価値のないエリアにはビーコンエリアがあってそこからもリスポーンできる
   *  ようにして（起動したら）左右にもっとメリットを与えて、例えば爆撃機を呼べるとか"
   *
   * The two are ONE feature here, because the second one asks for a reward the
   * flanks can call in and the first one is the biggest thing this file owns.
   *
   * WHAT IT IS. The `CATHEDRAL` salvo — three bays of aisle roof off both
   * elevations, 1467 chunks, a five-column dust wall standing in the nave for
   * twenty seconds — fired TOGETHER with a bomber run down the middle of the map.
   * The salvo is this system's own; the aeroplane is `Bomber`'s, and it is asked
   * politely and optionally (`?.`), so if it is disarmed, already flown or absent
   * the collapse still happens on its own. Both telegraph themselves: 4.4 s of
   * jet and whistle, and an aircraft that is on screen for 2.4 s before it drops
   * anything. Nothing in this method is a new kind of event for anything
   * listening — it is the two that already exist, on the same second.
   *
   * WHERE IT SHOULD LIVE. In `src/match/index.js`, one line in the TAP-F branch
   * of `_updateCacheUse`, next to `plantBeacon`. That file is outside this
   * change's scope, so the trigger is polled here instead: `_pollFlankCall`
   * watches `match.caches.beacon` — one match module reading another match
   * module's public state through the registry, never `ai`, `ui` or `world` —
   * and fires when the square that was just lit is one of the FLANK beacon
   * squares `src/world/features.js` publishes. IF THAT LINE IS EVER ADDED IN
   * `index.js`, DELETE THE POLL: two triggers on one event is a double strike.
   */
  /**
   * ────────────────────────────────────────────────────────────────────────────
   * THE LAST EVENT: EVERYTHING STILL STANDING, IN ONE ROLL
   * ────────────────────────────────────────────────────────────────────────────
   * "最後に街全体が崩壊するイベント" — the map becomes a melee.
   *
   * It is not a new kind of destruction and it must not be: every site left
   * unstruck is fired on a rolling stagger through the SAME `fire()` the
   * scheduler uses, so the masses, the trajectories, the settled poses, the
   * collision flips and the nav patches are all the ones baked at boot and
   * already proved harmless to every route by `_verifyRoutes` WITH ALL OF THEM
   * DOWN AT ONCE. That proof is what makes this safe to do at all: the map after
   * this event is exactly the map the route gate signed off.
   *
   * The stagger is the whole spectacle. Eleven sites at 0.55 s apart is six
   * seconds of the town coming apart in sequence rather than one frame with
   * 5696 chunks in it — and it also keeps the eleven `_bakeSettled` memcpys and
   * the eleven nav patches on eleven different frames six and a half seconds
   * later, which is the same reason `SALVOS` have a stagger.
   *
   * @param {number} stagger seconds between members
   * @returns {number} how many sites are going to come down
   */
  callEverything(stagger = 0.55) {
    if (!this.ready || this._final) return 0;
    const left = [];
    for (const s of this.sites) if (!s.struck && !s.dropped) left.push(s);
    if (!left.length) return 0;
    this._final = { list: left, k: 0, t: 0, stagger };
    // One jet for the whole thing, placed over the middle of the town. The
    // per-site whistles are what the individual telegraph is for and there is no
    // "get clear of" a city-wide collapse — the alert is the banner `match` puts
    // up, and this is the noise underneath it.
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    audio?.play?.('strike_jet', left[0].position, {
      level: 0.85, dur: JET_LEAD + 1.5, maxDist: 400, gain: 2.0, occlusion: 0.3,
    });
    console.info(`[airstrike] FINAL COLLAPSE armed — ${left.length} sites, ${stagger}s apart, ${JET_LEAD}s lead`);
    return left.length;
  }

  callCathedralCollapse() {
    if (!this.ready || !this.enabled) return false;
    if (!this.callSalvo('CATHEDRAL')) return false;
    /** The aeroplane. Optional on purpose — see the note above. */
    this.ctx.peek?.('match')?.bomber?.fire?.('MAIN');
    return true;
  }

  /**
   * A flank beacon has just been lit. One call per PLANT — the key is the square
   * plus the moment it expires, so re-lighting the same square after its 30 s is
   * a new event and holding one is not.
   */
  _pollFlankCall(live) {
    if (!live) return;
    const b = this.ctx.peek?.('match')?.caches?.beacon;
    if (!b || !b.active || typeof b.at !== 'string') return;
    const key = `${b.at}:${b.until}`;
    if (key === this._flankKey) return;
    this._flankKey = key;
    if (!b.at.startsWith('FLANK-')) return;
    this.callCathedralCollapse();
  }

  struck(which = 0) {
    return !!this._siteOf(which)?.struck;
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

    /* ---- the flanks, calling it in ------------------------------------ */
    this._pollFlankCall(live);

    /* ---- the clock the shader reads ---------------------------------- */
    for (let i = this._live.length - 1; i >= 0; i--) {
      const s = this._live[i];
      s.t += dt;
      s.uniforms.uT.value = s.t;
      if (s.t >= SETTLE_AT) {
        this._bakeSettled(s);
        this._live.splice(i, 1);
      }
    }

    /* ---- the dust a salvo left in the lane ----------------------------- */
    // A persistent emitter has to be given back or it holds one of the pool's
    // 24 slots for the rest of the match. Checked here, never on a fire frame.
    if (this._dust.length) {
      const now = this.ctx.time.elapsed;
      for (let i = this._dust.length - 1; i >= 0; i--) {
        if (this._dust[i].at > now) continue;
        this._fx?.removeSmokeSource(this._dust[i].tag);
        this._dust.splice(i, 1);
      }
    }

    /* ---- telegraph ---------------------------------------------------- */
    for (let i = this._pending.length - 1; i >= 0; i--) {
      const p = this._pending[i];
      p.t += dt;
      if (p.stage === 0) {
        p.stage = 1;
        this._telegraph(p.site, 'jet', p.group);
        // ANNOUNCED BEFORE THE EVENT IS EMITTED, so anything listening to
        // `match:airstrike` already sees the HUD in its warned state. `match`
        // installs the hook; nothing in this file knows `ui` exists.
        this._announce(
          this.onAnnounce,
          p.group ? 'SALVO' : 'STRIKE',
          p.group ?? p.site,
          p.group ? p.group.sites : null
        );
        this._emit('inbound', p.site);
      } else if (p.stage === 1 && p.t >= JET_LEAD - WHISTLE_LEAD) {
        p.stage = 2;
        this._telegraph(p.site, 'whistle', p.group);
      } else if (p.stage === 2 && p.t >= JET_LEAD) {
        if (!p.group) {
          this._pending.splice(i, 1);
          this.fire(p.site.index);
          continue;
        }
        // A salvo walks its own stagger, so the three collapses are one event to
        // the ear and three distinct ones to the eye.
        const g = p.group;
        while (p.k < g.sites.length && p.t >= JET_LEAD + g.stagger[p.k]) {
          this.fire(g.sites[p.k].index, g);
          p.k++;
        }
        if (p.k >= g.sites.length) {
          this._salvoDust(g);
          this._pending.splice(i, 1);
        }
      }
    }

    /* ---- the final collapse, rolling ---------------------------------- */
    // Outside the `live`/`enabled` gate below on purpose: once the town has been
    // told to come down it comes down, the same way a mass already in the air
    // still has to land when a round ends.
    if (this._final) {
      const f = this._final;
      f.t += dt;
      while (f.k < f.list.length && f.t >= JET_LEAD + f.k * f.stagger) {
        const s = f.list[f.k++];
        if (!s.struck) this.fire(s.index);
      }
      if (f.k >= f.list.length) this._final = null;
    }

    /* ---- scheduler ---------------------------------------------------- */
    if (!live || !this.enabled) return;
    this._liveT += dt;
    this._next -= dt;
    if (this._next > 0) return;
    this._scheduleNext();
  }

  /**
   * The dust wall across the whole frontage, laid down once the last of the
   * three has gone off. Not on a fire frame: this is the frame AFTER the third
   * detonation, and it is five `addSmokeColumn` calls into a preallocated pool.
   */
  _salvoDust(group) {
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (!fx?.addSmokeSource) return;
    const d = SALVO_DUST;
    const n = Math.max(2, d.count);
    const a = group.sites[0].mound;
    const b = group.sites[group.sites.length - 1].mound;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0.5;
      this._v.lerpVectors(a, b, t);
      const tag = fx.addSmokeColumn(this._v.x, this._v.y + 0.4, this._v.z, {
        duration: d.duration,
        rate: d.rate,
        radius: d.radius,
        rise: d.rise,
        dark: d.dark,
        life: d.life,
        growth: d.growth,
      });
      // Finite duration, so `remove` is belt and braces — but a column that is
      // reused by somebody else must not be cancelled, so it is only chased for
      // as long as it should have been running.
      this._dust.push({ tag, at: this.ctx.time.elapsed + d.duration + 0.5 });
    }
    console.info(
      `[airstrike] SALVO ${group.id} dust: ${n} columns over ${group.span.toFixed(1)} m, ` +
        `lane occluded for ~${(d.duration + d.life).toFixed(0)}s`
    );
  }

  /**
   * Fill the reused announce record and hand it to a hook. `points` is the list
   * of impact points to mark in the world; for a single strike that is just the
   * one, for a salvo it is all three, which is what makes it read as an area.
   */
  _announce(hook, kind, subject, points) {
    if (!hook) return;
    const a = this._ann;
    a.kind = kind;
    a.id = subject.id;
    a.name = subject.name;
    a.lead = JET_LEAD;
    a.position = subject.position;
    a.count = 0;
    if (points) {
      for (let i = 0; i < points.length && i < a.points.length; i++) a.points[a.count++] = points[i].position;
    } else {
      a.points[a.count++] = subject.position;
    }
    hook(a);
  }

  /** True while anything of ours is falling or inbound. */
  get busy() {
    return this._pending.length > 0 || this._live.length > 0;
  }

  _scheduleNext() {
    // Never two at once: a second whistle while the first is still falling is
    // noise, not information. `coBusy` is the bomber and the strafing run, so no
    // two of the three can ever be in the air together.
    if (this.busy || this._coBusy) {
      this._next = 4;
      return;
    }
    if (this._fired >= RULES.airstrikeMaxPerRound) {
      this._next = Infinity;
      return;
    }

    /* ---- the block event, once a round --------------------------------- */
    if (this._salvoed < RULES.airstrikeSalvoPerRound && this._liveT >= RULES.airstrikeSalvoDelay) {
      const g = this._pickSalvo();
      if (g && this.callSalvo(g.index)) {
        this._salvoed++;
        // Counts double: it consumes three of the eight sites.
        this._fired += 2;
        const [lo, hi] = RULES.airstrikeInterval;
        this._next = this.rng.range(lo, hi);
        return;
      }
    }

    /**
     * Weighted pick: route points 2:1 over the map changers, and everything
     * biased toward the fight.
     *
     * The route points are the ones the brief is about — they are what makes
     * pushing cost something — and there are five of them against three, so an
     * unweighted draw would still spend a third of a round's strikes on the
     * three big ones. On top of that, `focus` pulls the draw toward wherever the
     * living are: a site 20 m from the fight is worth about 2.5x one 90 m away.
     * Both are weights on a cumulative draw, so nothing is ever excluded and the
     * balance argument in the STRIKE_SITES comment (every site is on the
     * attackers' half of every route) is untouched.
     */
    const cand = this._cand;
    const wt = this._wt;
    cand.length = 0;
    wt.length = 0;
    let total = 0;
    for (const s of this.sites) {
      if (s.struck || s.dropped) continue;
      total += (s.kind === 'route' ? 2 : 1) * this._focusWeight(s.position);
      cand.push(s);
      wt.push(total);
    }
    if (!cand.length) {
      this._next = Infinity;
      return;
    }
    this.call(cand[this._draw(wt, total)].index);
    this._fired++;
    const [lo, hi] = RULES.airstrikeInterval;
    this._next = this.rng.range(lo, hi);
  }

  /**
   * How much more likely a point near the fight is than one on the far side of
   * the map. 1 with no focus, 3.4 on top of it, ~1.5 at 30 m, ~1.1 at 90 m.
   */
  _focusWeight(p) {
    if (!this.focusValid) return 1;
    const d = Math.hypot(p.x - this.focus.x, p.z - this.focus.z);
    return 1 + 2.4 / (1 + (d / this.focusScale) ** 2);
  }

  /** Index into a cumulative-weight array. One rng draw, no allocation. */
  _draw(wt, total) {
    const r = this.rng.float() * total;
    for (let i = 0; i < wt.length; i++) if (r < wt[i]) return i;
    return wt.length - 1;
  }

  /** The whole-block event nearest the fight, of the groups still standing. */
  _pickSalvo() {
    let best = null;
    let bestW = -1;
    for (const g of this.salvos) {
      let up = true;
      for (const s of g.sites) if (s.struck || s.dropped) up = false;
      if (!up) continue;
      const w = this._focusWeight(g.centre);
      if (w > bestW) {
        bestW = w;
        best = g;
      }
    }
    return best;
  }

  /**
   * Called by `match` when a round goes live. The first strike can never land
   * inside the opening seconds — you do not lose a round to a noise you have
   * not learnt yet.
   */
  armRound() {
    const [lo, hi] = RULES.airstrikeInterval;
    this._next = RULES.airstrikeFirstDelay + this.rng.range(0, (hi - lo) * 0.5);
    this._fired = 0;
    this._salvoed = 0;
    this._liveT = 0;
  }

  disarm() {
    this._next = Infinity;
    this._pending.length = 0;
  }

  _telegraph(site, which, group = null) {
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    if (!audio?.play) return;
    // A salvo telegraphs from the middle of the BLOCK, not from one of its three
    // buildings, and louder — it is the same sound the player has already learnt
    // and it must not need re-learning, only be obviously bigger.
    const at = group ? group.centre : site.position;
    if (which === 'jet') {
      // High and wide of the target, so it reads as "overhead", not "here".
      this._v.copy(at);
      this._v.y += 46;
      audio.play('strike_jet', this._v, {
        level: group ? 1.3 : 1, dur: group ? 4.4 : 3.6, maxDist: 460, gain: group ? 3.8 : 3.2, occlusion: 0,
      });
      return;
    }
    // The whistle is AT the target and takes the whole remaining lead.
    this._v.copy(group ? group.centre : site.blast);
    this._v.y += 8;
    audio.play('strike_incoming', this._v, {
      level: group ? 1.4 : 1.15, dur: WHISTLE_LEAD, maxDist: 460, gain: group ? 3.0 : 2.6,
      occlusion: 0, noDelay: true,
    });
  }

  /**
   * The dust is down. Hand the settled pose back to `instanceMatrix`, switch
   * the curve off, and let the rubble cast shadows and write the prepass again.
   * This is the only place collision and navigation change.
   */
  _bakeSettled(site) {
    if (site.baked) return;
    site.baked = true;
    for (const mesh of site.meshes) {
      mesh.instanceMatrix.array.set(mesh.userData.settled);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.owNoShadow = false;
      mesh.userData.owNoPrepass = false;
    }
    if (site.blocking) {
      // A demolition already flipped its collision on the fire frame; this is a
      // no-op there (`setScopeSolid` is guarded) and the whole job everywhere
      // else. The NAV patch is this method's alone, for both.
      this._setSiteSolid(site, true);
      this._applyNav(site, true);
    }
    site.uniforms.uAnim.value = 0;
    this._emit('settled', site);
  }

  /** Round reset: the town is whole again. */
  reset() {
    this.disarm();
    this._live.length = 0;
    this._final = null;
    // Last round's dust does not hang over this round's street.
    for (const d of this._dust) this._fx?.removeSmokeSource(d.tag);
    this._dust.length = 0;
    for (const site of this.sites) {
      if (site.struck && site.blocking) {
        this._setSiteSolid(site, false);
        this._applyNav(site, false);
      }
      // The town is whole again, which for a demolition means the building is
      // back: shell drawn and solid, ruin hidden and intangible, chunks parked.
      if (site.demo && site.struck) {
        site.demo.setVisual(false);
        site.demo.setCollision(false);
        site.demo.down = false;
        for (const mesh of site.meshes) mesh.visible = false;
      }
      site.struck = false;
      site.baked = false;
      site.t = -1;
      for (const mesh of site.meshes) {
        mesh.instanceMatrix.array.set(mesh.userData.rest);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.userData.owNoShadow = false;
        mesh.userData.owNoPrepass = false;
      }
      site.uniforms.uT.value = -1;
      site.uniforms.uAnim.value = 1;
    }
  }

  _siteOf(which) {
    if (typeof which === 'number') return this.sites[which] ?? null;
    if (typeof which === 'string') return this.sites.find((s) => s.id === which) ?? null;
    return which ?? null;
  }

  _emit(phase, site) {
    const e = this._ev;
    e.phase = phase;
    e.site = site.id;
    e.position = site.position;
    this.ctx.events.emit('match:airstrike', e);
  }

  dispose() {
    for (const site of this.sites) {
      if (site.proxyId >= 0) this.physics?.removeStatic(site.proxyId);
      for (const mesh of site.meshes) mesh.geometry?.dispose();
      site.proxyMesh?.geometry?.dispose();
      for (const m of site.materials ?? []) m.dispose();
    }
    this.group.parent?.remove(this.group);
    this.sites.length = 0;
    this._live.length = 0;
    this._pending.length = 0;
  }
}

/* ========================================================================== */
/* geometry helpers                                                           */
/* ========================================================================== */

/**
 * Cut one box of the mass with a jittered 3D grid.
 *
 * The boundaries tile the box exactly, so the chunks reassemble with no seam —
 * before the strike this has to look like a wall, not like a stack of blocks.
 */
export function fracture(part, shiftU, rng, emit) {
  const [dx, dy, dz] = part.size;
  const [nx, ny, nz] = part.cut;
  const bx = splits(nx, dx, rng);
  const by = splits(ny, dy, rng);
  const bz = splits(nz, dz, rng);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        emit({
          cx: part.at[0] + shiftU + (bx[i] + bx[i + 1]) * 0.5,
          cy: part.at[1] + (by[j] + by[j + 1]) * 0.5,
          cz: part.at[2] + (bz[k] + bz[k + 1]) * 0.5,
          hx: (bx[i + 1] - bx[i]) * 0.5,
          hy: (by[j + 1] - by[j]) * 0.5,
          hz: (bz[k + 1] - bz[k]) * 0.5,
        });
      }
    }
  }
}

/** n+1 boundaries across [-d/2, d/2], interior ones jittered. */
export function splits(n, d, rng) {
  const out = new Float64Array(n + 1);
  const step = d / n;
  out[0] = -d * 0.5;
  out[n] = d * 0.5;
  for (let i = 1; i < n; i++) out[i] = -d * 0.5 + step * i + rng.range(-0.3, 0.3) * step;
  return out;
}

/**
 * The chunk primitive: a unit cube with its eight corners pulled in by a fixed
 * amount per corner, so every instance is a slightly irregular block rather
 * than a perfect box. One geometry, shared by every chunk in the level — the
 * variety comes from the per-instance scale, rotation, tint and uv offset.
 */
export function chunkGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position.array;
  const uv = g.attributes.uv.array;
  // Deterministic per-corner nibble; the same corner is shared by three faces
  // and has to move identically in all of them or the chunk tears open.
  const bite = (sx, sy, sz) => {
    const h = ((sx + 1) * 9 + (sy + 1) * 3 + (sz + 1)) * 0.618;
    return 0.018 + (h - Math.floor(h)) * 0.05;
  };
  for (let i = 0; i < p.length; i += 3) {
    const sx = Math.sign(p[i]);
    const sy = Math.sign(p[i + 1]);
    const sz = Math.sign(p[i + 2]);
    const b = bite(sx, sy, sz);
    p[i] -= sx * b * 0.5;
    p[i + 1] -= sy * b * 0.5;
    p[i + 2] -= sz * b * 0.5;
  }
  // A chunk should show about half a metre of surface, not one whole tile.
  for (let i = 0; i < uv.length; i++) uv[i] *= 0.62;
  // USE_COLOR (which `instanceColor` needs turned on) declares a `color`
  // attribute; without one WebGL feeds the shader black and every chunk
  // renders as a silhouette. White here, tint comes from instanceColor.
  const white = new Float32Array(g.attributes.position.count * 3).fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(white, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Merge position/normal/uv geometries. Written here rather than imported from
 * `world` because a subsystem never imports another subsystem's module
 * (ARCHITECTURE.md rule 2) — the same reason `bomb.js` has its own copy.
 */
export function mergeGeometries(list) {
  let vtx = 0;
  let idx = 0;
  for (const g of list) {
    vtx += g.attributes.position.count;
    idx += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vtx * 3);
  const nrm = new Float32Array(vtx * 3);
  const uv = new Float32Array(vtx * 2);
  const ind = new Uint32Array(idx);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    const a = g.attributes.position;
    const n = g.attributes.normal;
    const t = g.attributes.uv;
    pos.set(a.array, vo * 3);
    if (n) nrm.set(n.array, vo * 3);
    if (t) uv.set(t.array, vo * 2);
    if (g.index) {
      const src = g.index.array;
      for (let i = 0; i < src.length; i++) ind[io++] = src[i] + vo;
    } else {
      for (let i = 0; i < a.count; i++) ind[io++] = i + vo;
    }
    vo += a.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(ind, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * One nav cell, probed exactly the way `NavGrid.build()` probes it. Kept in
 * step with that loop by hand: `ai` owns the rule, we only re-run it locally.
 */
const _probe = { flag: 0, floor: 0, enclosure: 0 };
/**
 * Re-probe ONE nav cell exactly the way `NavGrid.build`'s OPEN-AIR pass did at
 * boot: one ray down from above the level.
 *
 * NOT USABLE INDOORS, and `src/match/index.js` says so where it re-probes the
 * cathedral ruin: inside a footprint this ray can only ever hit the ROOF, which
 * is the entire reason `NavGrid._carveInteriors` exists. Run over the nave it
 * would put all ~400 cells of site D on the vault at 26.2 m and take the
 * building out of the height field.
 */
function probeCell(g, phys, ix, iz) {
  const MASK = phys.MASK.WORLD;
  const x = g.worldX(ix);
  const z = g.worldZ(iz);
  _probe.flag = 0;
  _probe.floor = 0;
  _probe.enclosure = 0;
  const down = phys.raycast(x, g.topY, z, 0, -1, 0, g.topY + 30, MASK);
  if (!down.hit) return _probe;
  _probe.floor = down.point.y;
  if (down.normal.y < g.maxSlope) return _probe;
  const fy = down.point.y;
  const up = phys.raycast(x, fy + 0.25, z, 0, 1, 0, g.height - 0.2, MASK);
  if (!up.hit) _probe.flag = 1;
  else if (up.distance > g.crouchHeight - 0.25) _probe.flag = 2;
  else return _probe;
  let blocked = 0;
  for (let d = 0; d < 4; d++) {
    const dx = d === 0 ? 1 : d === 1 ? -1 : 0;
    const dz = d === 2 ? 1 : d === 3 ? -1 : 0;
    if (phys.raycastAny(x, fy + 0.95, z, dx, 0, dz, g.radius + 0.06, MASK)) blocked++;
  }
  if (blocked >= 3) {
    _probe.flag = 0;
    return _probe;
  }
  _probe.enclosure = blocked;
  return _probe;
}

/** Boot diagnostics: if either number looks wrong the site is in the wrong place. */
function logLane(id, lane, span) {
  console.info(
    `[airstrike] ${id}: lane ${lane.toFixed(1)} m, mound reaches ${span.toFixed(1)} m into it ` +
      `(${(lane - span).toFixed(1)} m left walkable)`
  );
}

function logFacade(id, roofY, facadeU) {
  console.info(`[airstrike] ${id}: roof ${roofY.toFixed(2)} m, facade offset ${facadeU.toFixed(2)} m`);
}

/**
 * Four related tints round one base colour, for the per-chunk `instanceColor` of
 * a building whose plaster the player has been looking at all round. Two shades
 * down, one up, and one heavily soiled — the same spread as the generic families
 * in `_buildMesh`, keyed to the building instead of to the kind.
 */
function _tintFamily(hex) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const at = (dl, ds) =>
    new THREE.Color().setHSL(hsl.h, clamp(hsl.s * ds, 0, 1), clamp(hsl.l + dl, 0.04, 0.92)).getHex();
  return [at(0.03, 1.0), at(-0.07, 0.95), at(0.1, 0.8), at(-0.16, 0.7)];
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * THE CHUNK MATERIAL AND ITS VERTEX PROGRAM.
 *
 * A free function rather than a method because `src/match/bomber.js` needs the
 * exact same closed-form animation for its crater debris, and two copies of a
 * `project_vertex` rewrite is two things to keep in step. `Airstrike` reaches
 * it through `_makeMaterial`; the doc comment on that method is the one that
 * explains why this is not `materials.get()`.
 */
export function makeChunkMaterial(ctx, lib, name, uniforms) {
  const set = lib?.getTextureSet?.(name) ?? null;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    flatShading: true,
    dithering: true,
    // Carries the per-chunk tint through `instanceColor`. The chunk geometry
    // ships a white `color` attribute because USE_COLOR expects one.
    vertexColors: true,
  });
  mat.name = `airstrike_${name}`;
  if (set) {
    mat.map = set.albedo;
    mat.normalMap = set.normal;
    mat.normalScale.set(1.15, 1.15);
    mat.roughnessMap = set.orm; // r=ao, g=rough, b=metal — three's convention
    mat.transparent = false;
  }

  mat.userData.owUniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uT = uniforms.uT;
    shader.uniforms.uAnim = uniforms.uAnim;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
  attribute vec4 aMot;   // x delay, y flight, z arc height, w total spin
  attribute vec3 aOff;   // rest -> settled, mesh local
  attribute vec3 aAxis;  // spin axis, unit
  attribute vec3 aUv;    // xy uv offset, z uv scale
  uniform float uT;
  uniform float uAnim;`
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
  #ifdef USE_MAP
  vMapUv = vMapUv * aUv.z + aUv.xy;
  #endif
  #ifdef USE_NORMALMAP
  vNormalMapUv = vNormalMapUv * aUv.z + aUv.xy;
  #endif
  #ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv = vRoughnessMapUv * aUv.z + aUv.xy;
  #endif`
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
  mvPosition = instanceMatrix * mvPosition;
  float owU = clamp( ( uT - aMot.x ) / max( aMot.y, 1e-4 ), 0.0, 1.0 ) * uAnim;
  if ( owU > 0.0 ) {
  vec3 owPiv = instanceMatrix[ 3 ].xyz;
  vec3 owRel = mvPosition.xyz - owPiv;
  // Spin eases out as the chunk lands, and ends exactly on aMot.w so the
  // settled pose the CPU baked and the pose the GPU stops at are the same.
  float owAng = aMot.w * owU * ( 2.0 - owU );
  float owS = sin( owAng );
  float owC = cos( owAng );
  owRel = owRel * owC + cross( aAxis, owRel ) * owS + aAxis * dot( aAxis, owRel ) * ( 1.0 - owC );
  vec3 owD = aOff * owU;
  owD.y += aMot.z * 4.0 * owU * ( 1.0 - owU );
  mvPosition.xyz = owPiv + owRel + owD;
  }
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;`
      );
  };
  // Flat shading means the fragment normal comes from the derivatives of the
  // view position we just rewrote, so the tumbling chunks light correctly
  // without touching a single normal chunk.
  const patcher = ctx.peek('render')?.patcher;
  patcher?.patch(mat);
  return mat;
}
