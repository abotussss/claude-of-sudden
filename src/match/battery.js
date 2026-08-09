/**
 * ════════════════════════════════════════════════════════════════════════════
 * MATCH — THE MOUNTAIN BATTERY. The player's side of the deadlock.
 * ════════════════════════════════════════════════════════════════════════════
 * 「隠し部隊が相手に登場した時は、味方にも山の上からの移動式固定砲台車両を３台投入
 *  占領サイトや敵に向けて１０数秒に１発ミサイル射撃させて ３０発撃ったら帰還」
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IT ANSWERS, AND WHY THAT DECIDES EVERY NUMBER BELOW
 * ────────────────────────────────────────────────────────────────────────────
 * `src/match/hidden.js` is the event this is the counterweight to, and its own
 * header states its purpose in the player's words: 「そうすることで最後に膠着した
 * 試合にしたい」 — to make the endgame a deadlock. It hands FIFTEEN CONCURRENT
 * MEN, up to `hiddenSquadWaves` x `hiddenSquadSize` = THIRTY ARRIVALS, to
 * `1 - playerTeam`, out of buildings beside ground that side already holds.
 *
 * THIS IS THE OTHER HALF OF THAT ONE SENTENCE. It is the player's side's answer
 * and it must be the squad's EQUAL, not its overmatch, or the deadlock the user
 * asked for becomes a rout in the other direction. So:
 *
 *   THE TRIGGER IS THE SQUAD'S OWN, not a second condition. 「隠し部隊が相手に
 *   登場した時は」 — when the squad APPEARS. @see `MatchSystem._updateHiddenSquad`,
 *   which calls `arm()` on the frame `HiddenSquad.call` returns true and NEVER
 *   otherwise: if the squad stands down because the human's side is more than
 *   `RULES.hiddenSquadDeficit` behind (his own rule, 「負けてたら隠し部隊は出さない」),
 *   the battery stands down with it. A counterweight to an event that did not
 *   happen is not a counterweight, it is a comeback mechanic nobody asked for.
 *
 *   THIRTY ROUNDS IS THE SQUAD'S OWN NUMBER. `hiddenSquadWaves` x
 *   `hiddenSquadSize` is 30, which is exactly the figure `rules.js` already
 *   computed for `HIDDEN_NAMES` ("THIRTY EACH, WHICH IS `hiddenSquadWaves` x
 *   `hiddenSquadSize`"). The user independently said 「３０発」. One round per man
 *   the mountain is answering is the whole balance argument, and it is measured
 *   rather than chosen.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠ WHERE THEY ARE, AND WHY THEY NEVER COME DOWN OFF THE MOUNTAIN ⚠
 * ────────────────────────────────────────────────────────────────────────────
 * 「山の上からの」 is where they are AND where they fire from, and taking it
 * literally is what makes this feature safe. Three facts about NACHTFELD:
 *
 *   THE RIM IS A CLIP RING AT r 178 AND THE BOUNDARY IS HELD BY 1.2-2.0 m OF
 *   HORIZONTAL MARGIN. `plains-rim.js` is a 0.62 m membrane standing 5.6 m over
 *   its own foot, deliberately thin because `physics.checkCapsule` is a SURFACE
 *   test and `boundcheck` walked straight through the 3.8 m prism that preceded
 *   it. `boundcheck` PASS on both maps is a gate on this project and the note
 *   over `THICK` says the margin outright: "Widen it past ~1.2 m and that stops
 *   being true again at the far side." Anything this file parks near that line
 *   is a thing the player can stand on next to a boundary, and a hull roof at
 *   3 m plus `MOVE.mantle.maxHeight` 1.85 is 4.85 of the 5.6 m that holds the
 *   map shut. THE ANSWER IS NOT TO MEASURE THE MARGIN — it is to be nowhere
 *   near it. The nearest berth is at r 190, TWELVE METRES BEYOND a face the
 *   character controller stops dead on at r 178.00 on all 720 bearings tested.
 *
 *   THESE VEHICLES HAVE NO COLLISION OF ANY KIND. No `physics.addCollider`, no
 *   triangle in the BVH, no `mask.fill()`, no nav patch, no entry in
 *   `ai.vehicles`. They are drawn meshes and a scalar, exactly as `Bomber`'s
 *   airframe is. So there is nothing to climb even if the rim were not there,
 *   `boundcheck`'s flood cannot change by one cell, `_nfvoid`'s sweep cannot
 *   change by one triangle, and `stuckcheck` has nothing new to wedge on. THIS
 *   IS THE ANSWER TO "A WEDGED VEHICLE IS THE SINGLE MOST-REPORTED DEFECT IN
 *   THIS PROJECT'S HISTORY": there is no pathfinder here, no `CLEARANCE`, no
 *   `arrived` state that can be terminal, and no leg that can be dropped —
 *   `s` is a number between 0 and 1 on a polyline baked at boot, and the only
 *   two values it ever settles at are `STOPS[i]` and 0.
 *
 *   THE MOUNTAIN FACE PITCHES 50-64°, `NavGrid` REFUSES IT, `plainsOpen()`
 *   REFUSES EVERYTHING PAST 176, AND NOTHING IS AUTHORED THERE BY ANYBODY.
 *   `warfield.js` already puts its rim engagements at r 192-216 on exactly this
 *   argument — "he cannot walk to it, so it can never fail to be there when he
 *   arrives, and it can never be mistaken for a fight he could join". This file
 *   is the same ground with two differences: these are real vehicles of a real
 *   side, and unlike everything else out there THIS ONE CARRIES DAMAGE. Every
 *   metre of that is spent on the telegraph. @see THE TELEGRAPH below.
 *
 * AND THE SEVENTH, EIGHTH AND NINTH VEHICLE IS NOT A TRAFFIC PROBLEM, because
 * they are never on the plain. `tank.js` bakes six wheels of six legs each over
 * ground the six hulls share with forty men; these three drive a mountain
 * contour twelve metres outside the map, and `_dtankdiag`'s 36 of 36 legs is
 * untouched because not one line of `tank.js` is read or written by this file.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 「移動式」 — THEY MOVE, AND IT IS SHOOT-AND-SCOOT RATHER THAN A DRIVE
 * ────────────────────────────────────────────────────────────────────────────
 * A 固定砲台 is a fixed emplacement; a 移動式固定砲台車両 is one that drives to
 * where it is needed and drives away again. Both halves are implemented and
 * neither costs a route solve:
 *
 *   THE ARRIVAL is a descent of the mountain — 24 m of radius and 34° of arc
 *   from the crest at `rTop` down to the firing shelf at `rBerth`, which is a
 *   ~13° grade over ~120 m rather than a 60° radial fall. They come over the
 *   skyline and drive down a contour, in view of the whole northern half of the
 *   map, for `RULES.mountainBatteryDrive` seconds. That IS the deployment
 *   telegraph and it is the reason the descent is diagonal.
 *   THE SCOOT is `STOPS`: three baked berths in the last 14 % of the same
 *   polyline. After every `SHIFT_EVERY` rounds the vehicle drives to the next
 *   one. Nothing is solved for it — it is the same `s` moving between three
 *   numbers that were baked at boot with the rest.
 *   THE WITHDRAWAL — 「３０発撃ったら帰還」 — is `s` running back to 0 and the
 *   instance going invisible over the crest.
 *
 * THE GUN DOES NOT ELEVATE AND THAT IS THE WORD 固定. Elevation is baked into
 * the geometry at `LAUNCH_PITCH`; the vehicle YAWS to lay on its target and the
 * missile arcs. That is one number per instance per frame, which is what lets
 * the whole battery be TWO `InstancedMesh`es and two draw calls.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠⚠ WHAT THEY MAY FIRE AT — THE THIRD NAMED EXCEPTION, AND ITS PROOF ⚠⚠
 * ────────────────────────────────────────────────────────────────────────────
 * 「占領サイトや敵に向けて」 is two target classes and they are implemented as two
 * DISJOINT, SEPARATELY PROVED gates, because one of them breaks a rule the user
 * set himself and the other one is bound by it.
 *
 * THE RULE, IN HIS OWN WORDS, SO NOBODY "FIXES" EITHER GATE:
 *
 *   「空爆は占領サイトに落とすのではなくそれ以外の平原にランダムに広範囲に一列爆撃に
 *    して それを定期的に起こす」
 *   「占領サイトへの直接はダメ ただし破壊オブジェ＋占領サイトの場所には落としてもいい」
 *
 * There are two existing exceptions and both are his: the 破壊オブジェ carve-out
 * above, and 「敵占領サイトへの大型爆撃を可能にする」 — the tower's satellite strike,
 * implemented in `nachtfeld.js` as a NAMED exception with a boot-time proof
 * (`satProve`) that every round lands INSIDE the circle it names.
 *
 * THIS IS THE THIRD CASE AND IT IS TREATED AS ONE. 「占領サイトや敵に向けて
 * ミサイル射撃させて」 is, for the first half of that sentence, a missile aimed at
 * a capture circle. It is legal here and nowhere else, and it carries every one
 * of the four properties `SAT_STRIKE`'s own note demands of an exception:
 *
 *   IT IS AIMED, NOT DRAWN.    `_pickTarget` names one live zone. Nothing lands
 *                              on a capture point in this game by chance.
 *   IT NAMES ITS TARGET FIRST. `onLay` fires `RULES.mountainBatteryLay` seconds
 *                              before the launch and `match` puts the zone's id
 *                              on the HUD and a reticle on the ground.
 *   IT IS BOUNDED INWARD.      `batteryProve` runs at boot over EVERY zone the
 *                              battery could ever be pointed at, including the
 *                              locked one, and asserts that all thirty baked
 *                              offsets are inside the target's own radius. Like
 *                              `satProve` it is the INVERSE of `plainsOpenRuns`:
 *                              that gate keeps bombs OUT of every circle, this
 *                              one keeps rounds IN the one they name. It cannot
 *                              leak onto open ground, onto a neutral point, onto
 *                              a point the battery's own side holds, or onto a
 *                              spawn. A failed proof DROPS the whole feature.
 *   IT IS ENEMY-HELD ONLY.     `z.owner >= 0 && z.owner !== this.team`, compared
 *                              against `RULES.playerTeam` upstream and never
 *                              against a raw index. This is NARROWER than
 *                              「占領サイトや」 asks for, deliberately: an exception
 *                              is only defensible in the direction that makes it
 *                              smaller.
 *
 * AND THE SECOND HALF — 「敵に向けて」 — IS BOUND BY THE RULE RATHER THAN EXEMPT
 * FROM IT. A round aimed at bodies is a round on open ground, so it is refused
 * unless its impact clears the EDGE of every live capture circle by
 * `spec.clear` and every base pad by `spec.spawnClear`. Those two numbers are
 * `bomber.js:PLAINS_OPEN`'s own, verbatim, with its note: "「占領サイトへの直接は
 * ダメ」 is not a near-miss rule."
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE TELEGRAPH — nothing may kill from nowhere
 * ────────────────────────────────────────────────────────────────────────────
 * The line bombardment shows an aeroplane 2.4 s before release, an `airAlert`
 * with a bearing arrow and a countdown, and an `airDanger` reticle on every
 * crater. The satellite, having no aeroplane, buys a designator that strikes
 * five times through a 9 s lead at accelerating intervals so the rhythm says how
 * long is left. A MISSILE FROM THE MOUNTAIN HAS TO EARN ITS OWN, and it does it
 * in two stages, because a single 14 m crater does not deserve a nine-second
 * strip take every thirteen seconds for two minutes:
 *
 *   STAGE 1, THE LAY (`mountainBatteryLay` s). The vehicle traverses onto the
 *     bearing — visible on the skyline, which is where it has been standing
 *     since it drove down. A `drone_lock` tone AT THE TARGET (the bank's
 *     "a machine has decided about you" voice, and the same choice `_satPulse`
 *     argues for over `strike_jet`), and a haze ring on the ground tightening
 *     onto the impact point. `match` puts up the reticle and, when the round can
 *     reach the human, the strip.
 *   STAGE 2, THE FLIGHT (4.2-6.5 s). A real object crossing the sky from a real
 *     bearing with a smoke trail — this is the aeroplane. `strike_incoming` is
 *     played AT THE TARGET for the last `WHISTLE` seconds, which is the voice
 *     the bank has for exactly this and which is placed at the target by design.
 *
 * Total lead is 6.8-9.1 s: longer than the bomber's 4.1 s of visible run-in,
 * inside the band `zoneBombardLead` (10) and `SAT_STRIKE.lead` (9.0) already
 * proved is "you have time to walk out of a circle" on this map.
 *
 * WHY THE HUD STRIP IS RATIONED AND THE WORLD TELEGRAPH IS NOT. `ui.airAlert`
 * is ONE strip and it holds for `lead + 2.2` s; thirty takes at a round every
 * ~4.5 s would own it for the rest of the match and stamp on the bomber's, the
 * strafe's and the bombardment's warnings. So `match` raises it only when the
 * round can actually reach the human (@see `RULES.mountainBatteryAlert`). Every
 * other channel — the tone, the ring, the launch flash, the missile, the trail,
 * the whistle — is in the WORLD and runs for every single round for everybody.
 * That is the honest ordering: the strip is a convenience, the world is the
 * warning.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ALLOCATION, AND WHAT IS BAKED
 * ────────────────────────────────────────────────────────────────────────────
 * AT BOOT: the three tracks (`X/Y/Z/YAW/PITCH` `Float32Array`s sampled off the
 * level's analytic deck), the thirty impact offsets as FRACTIONS of a radius,
 * the proof, two merged geometries, two `InstancedMesh`es and one missile
 * `InstancedMesh`. AT FIRE TIME: a target chosen out of lists `match` already
 * maintains, thirty pairs multiplied by one radius, and one `explosion` emit.
 * PER FRAME: at most six matrix composes and two `needsUpdate` flags. Nothing
 * in this file allocates after `build()`, nothing calls `Math.random` (every
 * draw is `ctx.rng.fork()`), and `dispose()` drops every geometry and material
 * it made.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLIC API   const b = ctx.get('match').battery
 * ────────────────────────────────────────────────────────────────────────────
 *   b.build()                    once, at boot; returns `this`
 *   b.proveAgainst(zones, pads)  the exception's gate; call once, after
 *                                `resolveLayout`. Returns the proof record.
 *   b.arm(team, zones, pads)     deploy. `match` calls this on the frame the
 *                                hidden squad is called, and never otherwise.
 *   b.update(dt, live, zones, foes)
 *   b.reset() / b.dispose() / b.report()
 *   b.onDeploy / b.onLay / b.onImpact / b.onHome   -> `match` owns the HUD
 */

import * as THREE from 'three';
import { RULES, TEAM_COLOR } from './rules.js';
import { mergeGeometries } from './airstrike.js';
import { forMap } from './geography.js';

const DEG = Math.PI / 180;

/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHERE ON THE MOUNTAIN — the authored table, and every number is defended
 * ════════════════════════════════════════════════════════════════════════════
 * Level space is world space on NACHTFELD (@see `geography.js`: yaw 0, scale 1,
 * origin 0), so these are metres and bearings you can hand straight to
 * `tools/zonespot.mjs`. They still go through `world.levelToWorld` at bake time,
 * exactly as every other authored table in `src/match` does.
 */
const PLAINS_BATTERY = {
  id: 'NF-BATT',
  name: 'MOUNTAIN BATTERY',
  /**
   * THE THREE BEARINGS, IN DEGREES, OF THE FIRING BERTHS.
   *
   * TWO CONSTRAINTS PICKED THEM AND BOTH ARE READ OFF THE MAP.
   *
   * ON THE PLAYER'S OWN SIDE OF THE BOWL. 「味方にも」 — this is the human's side's
   * fire support, and support arrives over its own rear. `PLAINS.BASE_N` is
   * (-14, -150), i.e. bearing -95.3°, and the three berths straddle it.
   *
   * NOT ON A BURNING RIDGE. `plains.js` puts five fires at bearings -139, -66,
   * +14, +78 and +150, each with a 600 cd light and a real fire on it. A vehicle
   * silhouetted in a bonfire is a vehicle nobody can see arrive, and the
   * arrival is half the telegraph — `warfield.js` chose its own rim bearings on
   * the same argument and for the same reason. -122/-102/-82 sits in the
   * seventy-three degree unlit gap between the fires at -139 and -66, clearing
   * the nearer of them by 16-17° (54-57 m of arc at this radius).
   */
  berths: [-122, -102, -82],
  /**
   * DEGREES OF ARC THE DESCENT COVERS, and this is what makes it a road rather
   * than a fall. `rTop` to `rBerth` is 24 m of radius and about 32 m of drop; a
   * radial descent would be 53°, which is the face's own pitch and is not
   * something a vehicle drives. 34° of arc at r~202 is 120 m of run, so the
   * grade is ~15° and the whole descent is broadside to the map.
   */
  traverse: 34,
  /**
   * WHERE THE TRACK STARTS AND WHERE IT ENDS, metres from the middle.
   *
   * `rTop` 214 is `RIDGE_R1` — the crest, where `ridgeH` saturates. Starting
   * ON it is what "coming over the mountain" means and it is the furthest out
   * anything here goes: `plains.js`'s far sheet only takes over past ~320 m, so
   * every sample of every track is on the surface `groundY` actually describes.
   *
   * `rBerth` 190 is twelve metres outside the rim's clip face at 178 and four
   * metres outside `RIDGE_RB` 186, where `ridgeRelief` starts. Twelve metres of
   * a 50-64° face the controller is stopped in front of is the boundary
   * argument at the top of this file; four metres past the break of slope is
   * why the berths sit on the mountain's own crags rather than on bare apron.
   */
  rTop: 214,
  rBerth: 190,
  /**
   * THE THIRTY IMPACT OFFSETS, AS A FRACTION OF THE TARGET CIRCLE'S OWN RADIUS.
   *
   * NOT A METRE COUNT, for `SAT_STRIKE.spread`'s stated reason: `captureRadius`
   * is 8 on the town and 14 here, and a pattern authored in metres is a pattern
   * that is wrong on one of them. 0.80 of 14 m is 11.2 m — inside the lip, so
   * `batteryProve` can assert every round is in the circle, and wide enough that
   * thirty rounds do not all fall on the flag.
   */
  spread: 0.80,
  /**
   * ⚠ THE OTHER GATE — the one for 「敵に向けて」, which is NOT an exception.
   * Both numbers are `bomber.js:PLAINS_OPEN`'s, verbatim, and so is the reason:
   * `clear` is metres of air owed to the EDGE of a capture circle ("a man on the
   * point is never in the blast, and a man who has just stepped off it is not
   * either"), `spawnClear` is the same from a base pad "so nobody is bombed in
   * his own spawn".
   */
  clear: 24,
  spawnClear: 46,
  title: 'BATTERY LAYING',
  impactTitle: 'BATTERY ROUND ON TARGET',
  deployLine: 'MOUNTAIN BATTERY DEPLOYING',
  homeLine: 'MOUNTAIN BATTERY WITHDRAWING',
};

/**
 * PER MAP, and AL-MARIYA has no mountain. @see `forMap`.
 *
 * THIS IS A DROP AND NOT A FALLBACK, on `rules.js`'s own stated precedent for
 * the tower, the fortress and the satellite: "every one of them already DROPS
 * ITSELF with a logged reason when it cannot be baked against the map it is
 * given… That is the correct interim state: silent-but-wrong is what a fallback
 * table would have given." 「山の上からの」 cannot be authored on a 114 x 141 m
 * street plan with no mountain in it, and inventing a substitute (a spawn behind
 * the compound wall, a static gun on a roof) would be answering a different
 * request. THE CONSEQUENCE IS REAL AND IS REPORTED: on the town the hidden squad
 * still fires at 450 and has no counterweight.
 */
const MAP_BATTERY = { town: null, plains: PLAINS_BATTERY };

/** Samples per baked track. 1.5 m apart over ~125 m. */
const TRACK_N = 96;
/**
 * WHERE ON THE TRACK THE VEHICLE STANDS TO FIRE — 「移動式」, in one array.
 *
 * Three berths in the last 14 % of the polyline, ~17 m apart. Shoot and scoot:
 * after `SHIFT_EVERY` rounds the vehicle drives to the next one, which is the
 * same `s` moving between three numbers baked at boot. It is not a second route
 * and it cannot fail to bake.
 */
const STOPS = [1.0, 0.93, 0.86];
const SHIFT_EVERY = 4;
/** Radians a second the hull traverses onto a new bearing. */
const TRAVERSE_RATE = 0.55;
/**
 * THE LAUNCHER'S FIXED ELEVATION — 「固定砲台」. Baked into the geometry, never
 * animated: the tube is a rail at 38° and the missile arcs off it. A gun that
 * elevates is a second matrix per instance per frame and a different vehicle.
 */
const LAUNCH_PITCH = 38 * DEG;
/** Metres a second down the mountain track, and back up it. */
const DRIVE_SPEED = 7.5;
/** Metres a second on the scoot between two berths. Slower — it is a shuffle. */
const SHIFT_SPEED = 3.4;
/** Metres of run-in over which the hull levels itself into a berth. */
const LEVEL_IN = 8;
/** Track samples either side of `k` the ride pitch is measured over. @see `_bakeTrack`. */
const SUPPORT_K = 2;
/** Radians. The bound on that pitch — `tank.js:CLIMB_PITCH` is 0.52 for a 6.9 m hull. */
const RIDE_PITCH = 26 * DEG;

/**
 * SECONDS OF WHISTLE AT THE TARGET BEFORE A ROUND LANDS.
 *
 * `strike_incoming` is placed AT THE IMPACT POINT by design (`audio/airstrike.js`
 * — pitch falls while level rises), so this is the one channel that reaches a
 * man who is looking at his feet inside a building. 2.2 s is `RULES` own
 * `cathedralLead` shape: long enough to turn, short enough that it is the round
 * and not a siren.
 */
const WHISTLE = 2.2;
/** Seconds between two puffs of a missile's trail. @see `Skyfall._trail`. */
const TRAIL_GAP = 0.28;
/**
 * HOW MANY MISSILES MAY BE IN THE AIR. Three vehicles, and a vehicle cannot
 * launch again inside `mountainBatteryInterval[0]` (12.5 s) while the longest
 * flight is 6.5 s — so three is the ceiling by construction and the fourth slot
 * exists only so an overrun cannot silently drop a round.
 */
const MAX_INFLIGHT = 4;
/** Metres. Two enemies inside this of a candidate are "a cluster". */
const CLUSTER_R = 18;

/* ══════════════════════════════════════════════════════════════════════════ */
/* THE PATTERN AND ITS PROOF                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * The thirty impact offsets, solved ONCE at boot into two `Float32Array`s of
 * FRACTIONS of the target's radius. Nothing about a round is computed on the
 * frame it is fired: the frame multiplies one pair by one radius and adds one
 * centre.
 *
 * The shape is `bakeSatPattern`'s and deliberately so — a golden-angle spiral
 * out from the centre, spread by AREA (`sqrt`) so the rounds are not crowded at
 * the middle, jittered so the walk is not a diagram. Two differences, both
 * because this is thirty single rounds over two minutes rather than twelve in
 * six seconds: the FIRST round is not dead centre (a man who has not moved yet
 * has had no warning to move from), and the sequence is consumed across
 * DIFFERENT targets, so what it guarantees is that no two consecutive rounds of
 * the battery share a bearing from their own aim point.
 *
 * @param {object} spec `PLAINS_BATTERY`
 * @param {number} n    rounds in the magazine — `RULES.mountainBatteryRounds`
 * @param {object} rng  a `ctx.rng` fork — never `Math.random`
 */
export function bakeBatteryPattern(spec, n, rng) {
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const a = i * 2.39996 + 1.31;
    const r = Math.min(spec.spread, Math.sqrt(0.06 + 0.94 * t) * spec.spread + rng.range(-0.05, 0.05));
    u[i] = Math.cos(a) * Math.max(0, r);
    v[i] = Math.sin(a) * Math.max(0, r);
  }
  return { u, v };
}

/**
 * ⚠ THE GATE ON THE EXCEPTION. Run at boot over every zone the battery could
 * ever be pointed at — including the locked one, for the reason `_bakeSat`
 * gives: "a gate that only proved the zones that happened to be open at boot
 * would be a gate with a hole in it exactly where this map's signature event
 * puts a capture point."
 *
 * It proves the INVERSE of `plainsOpenRuns`: every round of the magazine lands
 * INSIDE the target's own capture circle, and no round comes within `padClear`
 * of a base pad. `worst` is the largest offset seen as a fraction of the
 * circle's radius and MUST be < 1.
 *
 * A pattern that fails is a bug in `bakeBatteryPattern`, not a zone to skip, so
 * this reports the worst case and `match` prints it — and a failure DROPS the
 * whole feature rather than shipping a quiet erosion of a rule the player set.
 *
 * @param {object} pat   what `bakeBatteryPattern` returned
 * @param {Array}  zones RESOLVED zones (`ensureReachable` has moved them),
 *                       each `{ id, position, radius }`
 * @param {Array}  pads  `[[x, z], …]` base pad centres, world space
 * @param {number} padClear metres of clear air owed to a pad
 */
export function batteryProve(pat, zones, pads, padClear) {
  let worst = 0;
  let nearestPad = Infinity;
  let checked = 0;
  const n = pat.u.length;
  for (const z of zones ?? []) {
    if (!z?.position) continue;
    const R = z.radius ?? RULES.captureRadius;
    for (let i = 0; i < n; i++) {
      const x = z.position.x + pat.u[i] * R;
      const zz = z.position.z + pat.v[i] * R;
      worst = Math.max(worst, Math.hypot(pat.u[i], pat.v[i]));
      for (const p of pads ?? []) nearestPad = Math.min(nearestPad, Math.hypot(x - p[0], zz - p[1]));
      checked++;
    }
  }
  return { ok: worst < 1 && nearestPad >= padClear, worst, nearestPad, checked };
}

/* ══════════════════════════════════════════════════════════════════════════ */

export class MountainBattery {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.rng = opts.rng ?? ctx.rng.fork();
    this.enabled = true;
    this.ready = false;
    this.spec = null;
    this.pat = null;
    this.proof = null;

    /** The side the guns belong to — `RULES.playerTeam`, handed in by `match`. */
    this.team = -1;
    /** Deployed and not yet home. */
    this.armed = false;
    /** Rounds left in the battery's shared magazine. 「３０発撃ったら帰還」. */
    this.magazine = 0;

    /** `match` owns the HUD. These four are how it hears about anything. */
    this.onDeploy = null;
    this.onLay = null;
    this.onImpact = null;
    this.onHome = null;
    /** Filled by `match` — live, targetable hostiles of the other side. */
    this.enemies = null;

    this.vehicles = [];
    this._shots = [];
    this._pads = [];

    /* ---- scene ---------------------------------------------------------- */
    this.group = null;
    this.geometries = [];
    this.materials = [];
    this._hullMesh = null;
    this._teamMesh = null;
    this._missileMesh = null;

    /* ---- reused records handed to `match`; it copies out synchronously --- */
    this._ann = {
      kind: 'BATTERY', title: '', impactTitle: '', name: '',
      lead: 0, x: 0, y: 0, z: 0,
      /** 'site' or 'bodies' — the report and the HUD wording both read it. */
      what: '', zone: null, round: 0, gun: 0,
    };
    /** The `explosion` payload. One record, reused, exactly as `match` does. */
    this._blast = { position: null, radius: 0, damage: 0, source: null };
    this._blastPos = new THREE.Vector3();

    /* ---- scratch (nothing below is allocated after this) ----------------- */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._aim = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._one = new THREE.Vector3(1, 1, 1);
    this._fwd = new THREE.Vector3(0, 0, 1);
    this._dir = new THREE.Vector3();
    this._fx = null;
    this._audio = null;

    this.stats = {
      rounds: 0, atSite: 0, atBodies: 0,
      refusedNoTarget: 0, refusedNearCircle: 0, refusedNearPad: 0,
      armedAt: -1, homeAt: -1, shifts: 0,
      log: [],
    };
  }

  /* ==================================================================== */
  /* boot                                                                 */
  /* ==================================================================== */

  /**
   * Resolve the table against the map, bake the three tracks off the level's
   * own analytic deck, bake the pattern, and build the meshes. ONCE.
   *
   * THE GROUND IS `world.groundHeight` AND NOT `physics.groundHeight`, which is
   * the opposite of the choice `tank.js` makes and the same one `warfield.js`
   * makes for its rim. The reason is which question is being asked: a tank route
   * has to agree with the collision the hull is driven against, and there is no
   * collision out here at all. `world.groundHeight` is `plainsY`, the analytic
   * surface the mountain mesh is BUILT from, defined and continuous at every
   * radius; `physics.groundHeight` is a ray into a BVH whose triangles out here
   * are 1.6 m apart. The physics answer is still taken, once, per sample, and
   * the worst disagreement is printed — that is the boot line somebody reads if
   * a berth ever ends up inside a crag.
   */
  build() {
    const ctx = this.ctx;
    const world = ctx.peek('world');
    if (!world) {
      console.warn('[batt] no world — the mountain battery is disabled');
      return this;
    }
    const spec = forMap(MAP_BATTERY, world, 'mountain battery');
    const id = world.level?.id;
    if (!spec) {
      console.info(
        `[batt] no mountain battery authored for "${id}" — DROPPED. ` +
          '「山の上からの」 needs a mountain; AL-MARIYA has none, so on this map the ' +
          'hidden squad has no counterweight.'
      );
      return this;
    }
    /**
     * IT IS GATED ON THE RIDGE EXISTING, NOT ON THE LEVEL ID — `warfield.js`'s
     * rule, for the same reason: a map that gains a table but no mountain would
     * otherwise author three vehicles onto flat ground inside the boundary,
     * which is the one thing the argument at the top of this file forbids.
     */
    const ridge = world.level?.ridge;
    if (!ridge || !(ridge.r0 >= 100) || !(spec.rBerth > ridge.r0 + 6)) {
      console.warn(
        `[batt] "${id}" publishes no ridge past r${spec.rBerth} — DROPPED rather than ` +
          'authored onto ground the player can reach'
      );
      return this;
    }
    this.spec = spec;

    /**
     * `world.groundHeight` TAKES WORLD COORDINATES (it runs `worldToLevel`
     * itself), so the authored level-space point is transformed FIRST and the
     * deck is asked about where the vehicle will actually stand. On NACHTFELD
     * that transform is the identity and the two are the same number; writing
     * it the other way round would be a table that is silently correct on the
     * only map it has and wrong on the first one that is yawed.
     */
    const gy = (wx, wz) => {
      const h = world.groundHeight?.(wx, wz);
      return Number.isFinite(h) ? h : NaN;
    };
    const phys = ctx.peek('physics');

    let worstDelta = 0;
    let worstGrade = 0;
    const p = this._v;
    for (let i = 0; i < spec.berths.length; i++) {
      const track = this._bakeTrack(spec, i, world, gy);
      if (!track) continue;
      /* the physics cross-check, once per sample, boot only */
      if (phys?.groundHeight) {
        for (let k = 0; k < track.n; k += 6) {
          const h = phys.groundHeight(track.X[k], track.Z[k], 120);
          if (Number.isFinite(h)) worstDelta = Math.max(worstDelta, Math.abs(h - track.Y[k]));
        }
      }
      worstGrade = Math.max(worstGrade, track.grade);
      this.vehicles.push(this._makeVehicle(i, track));
    }
    if (!this.vehicles.length) {
      console.error('[batt] no track baked on the mountain — DROPPED');
      return this;
    }

    this.pat = bakeBatteryPattern(spec, RULES.mountainBatteryRounds, this.rng.fork());
    this._buildMeshes();
    for (let i = 0; i < MAX_INFLIGHT; i++) {
      this._shots.push({
        live: false, t: 0, flight: 1, trail: 0, whistled: false,
        gun: 0, round: 0, what: '', zoneId: '',
        ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, apex: 0,
      });
    }
    this.ready = true;
    p.set(0, 0, 0);
    console.info(
      `[batt] ${this.spec.id} "${this.spec.name}" on "${id}": ${this.vehicles.length} vehicle(s) ` +
        `on the mountain at r${spec.rBerth} (bearings ${spec.berths.join('/')}°, ` +
        `${spec.traverse}° descent from r${spec.rTop}, worst grade ${(worstGrade / DEG).toFixed(0)}°, ` +
        `worst deck/BVH disagreement ${worstDelta.toFixed(2)} m) · ` +
        `${RULES.mountainBatteryRounds} rounds between them, one per gun per ` +
        `${RULES.mountainBatteryInterval[0]}-${RULES.mountainBatteryInterval[1]}s, ` +
        `r${RULES.mountainBatteryRadius}/${RULES.mountainBatteryDamage} · ` +
        'NO COLLIDER, NO NAV, NO BVH — 12 m outside the rim clip face at r178'
    );
    return this;
  }

  /**
   * ONE TRACK: from the crest at `rTop`, `spec.traverse` degrees round the rim,
   * down to a berth at `rBerth`. Sampled at `TRACK_N` points, every one of them
   * proved to have a finite deck under it before anything else is done with it.
   *
   * THE EARLY EXIT IS `_bakePath`'S AND FOR ITS REASON. `tank.js` ends a leg the
   * instant `groundHeight` goes non-finite, which is how three collision erasers
   * zeroing 6 % of the map's floor surfaced as dropped tank legs. Here a
   * non-finite sample drops the WHOLE track and says which sample and where —
   * a battery with two guns is a reportable fact, a battery whose third gun
   * stops halfway down a mountain is a screenshot.
   */
  _bakeTrack(spec, i, world, gy) {
    const b1 = spec.berths[i] * DEG;
    const b0 = b1 - spec.traverse * DEG;
    const n = TRACK_N;
    const X = new Float32Array(n);
    const Y = new Float32Array(n);
    const Z = new Float32Array(n);
    const YAW = new Float32Array(n);
    const PITCH = new Float32Array(n);
    const S = new Float32Array(n);
    const v = this._v2;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      /** `smoothstep` on the radius so the vehicle noses over the crest rather
       *  than driving off it, and comes level into the berth. */
      const e = t * t * (3 - 2 * t);
      const r = spec.rTop + (spec.rBerth - spec.rTop) * e;
      const a = b0 + (b1 - b0) * t;
      const lx = Math.cos(a) * r;
      const lz = Math.sin(a) * r;
      world.levelToWorld(lx, 0, lz, v);
      const wy = gy(v.x, v.z);
      if (!Number.isFinite(wy)) {
        console.error(
          `[batt] track ${i} (bearing ${spec.berths[i]}°): no deck at sample ${k} ` +
            `(${v.x.toFixed(0)},${v.z.toFixed(0)}, r${r.toFixed(0)}) — DROPPED`
        );
        return null;
      }
      X[k] = v.x; Y[k] = wy; Z[k] = v.z;
    }
    let len = 0;
    let grade = 0;
    for (let k = 0; k < n; k++) {
      if (k > 0) {
        len += Math.hypot(X[k] - X[k - 1], Y[k] - Y[k - 1], Z[k] - Z[k - 1]);
        S[k] = len;
      }
      /**
       * THE RIDE PITCH IS TAKEN OVER THE HULL'S OWN LENGTH, NOT OVER ONE
       * SAMPLE, which is `tank.js:_sample`'s two-point support (`SUPPORT =
       * HULL_L * 0.42`) applied to a baked polyline. `ridgeRelief` authors
       * creased buttresses above r 186 and a per-sample slope reads 44° off one
       * of them — a 7.4 m vehicle does not pitch to a 1.6 m crease, it bridges
       * it. Two samples either side is ±3.3 m, which is this hull's support.
       */
      const k0 = Math.max(0, k - SUPPORT_K);
      const k1 = Math.min(n - 1, k + SUPPORT_K);
      const dx = X[k1] - X[k0], dy = Y[k1] - Y[k0], dz = Z[k1] - Z[k0];
      YAW[k] = Math.atan2(dx, dz);
      const flat = Math.hypot(dx, dz);
      /**
       * …AND IT IS CLAMPED, for `CLIMB_PITCH`'s reason: past about 26° a hull
       * with a fixed 38° rail on it is a rocket aimed at the sky, and no amount
       * of honest terrain sampling makes that read as a vehicle. The POSITION
       * still follows the ground exactly; only the attitude is bounded.
       */
      PITCH[k] = flat > 1e-4
        ? Math.max(-RIDE_PITCH, Math.min(RIDE_PITCH, Math.atan2(dy, flat)))
        : 0;
      grade = Math.max(grade, Math.abs(Math.atan2(dy, Math.max(1e-4, flat))));
    }
    /**
     * LEVEL INTO THE BERTH. A gun berth is a levelled emplacement and a real
     * 移動式砲台 puts its jacks down before it fires; a hull sitting at 15° with
     * a fixed 38° rail is a rocket aimed at the sky. The last `LEVEL_IN` metres
     * of the track fade the ride pitch to zero, which costs one lerp at bake
     * time and nothing at all afterwards.
     */
    for (let k = n - 1; k >= 0; k--) {
      const back = len - S[k];
      if (back > LEVEL_IN) break;
      PITCH[k] *= back / LEVEL_IN;
    }
    return { n, X, Y, Z, YAW, PITCH, S, length: len, grade };
  }

  _makeVehicle(i, track) {
    return {
      i,
      track,
      /** 0 at the crest, 1 at the last berth. THE WHOLE OF ITS POSITION. */
      s: 0,
      /** Where it is heading on the track. */
      goal: 0,
      /** 'off' | 'descend' | 'station' | 'shift' | 'withdraw' | 'home' */
      state: 'off',
      stop: 0,
      firedHere: 0,
      /** Seconds until this gun may begin its next lay. */
      wait: 0,
      /** > 0 while laying. */
      lay: 0,
      target: null,
      targetIsSite: false,
      /** The aim point, frozen at the lay so the reticle cannot lie. */
      aimX: 0, aimY: 0, aimZ: 0,
      /** Seconds of flight for the round being laid. @see `_station`. */
      flight: 0,
      /** Countdown to the next designator ring. @see `_layPulse`. */
      pulse: 0,
      yaw: track.YAW[0],
      wantYaw: track.YAW[0],
      pitch: track.PITCH[0],
      x: track.X[0], y: track.Y[0], z: track.Z[0],
      rounds: 0,
      visible: false,
    };
  }

  /* ==================================================================== */
  /* the meshes                                                           */
  /* ==================================================================== */

  /**
   * THREE VEHICLES AND FOUR MISSILES IN THREE DRAW CALLS.
   *
   * `InstancedMesh` rather than three scene graphs, and it is what 「固定砲台」
   * buys: the launcher does not elevate and the turret does not traverse
   * independently of the hull, so a vehicle's ENTIRE pose is one position, one
   * yaw and one ride pitch — a single matrix. Two instanced meshes (the paint
   * and the team panel) carry the whole battery.
   *
   * The materials are PRIVATE instances of the library's surfaces, for
   * `Armour._hullMaterial`'s stated reason: `materials.get()` hands back a
   * SHARED material and this one wants its own tint. The level's albedo, normal
   * and ORM bakes come through, which is what keeps these off the quality bar's
   * "no flat/untextured surfaces".
   */
  _buildMeshes() {
    const ctx = this.ctx;
    const n = this.vehicles.length;
    const hull = [];
    const team = [];
    const box = (arr, w, h, d, x, y, z, rx = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      this._m.makeRotationX(rx).setPosition(x, y, z);
      g.applyMatrix4(this._m);
      arr.push(g);
    };
    const cyl = (arr, r, len, x, y, z, axis, tilt = 0) => {
      const g = new THREE.CylinderGeometry(r, r, len, 10, 1);
      /* three's cylinder is Y-up; 'x' lays it on the X axis, 'z' along Z. */
      if (axis === 'x') this._e.set(0, 0, Math.PI / 2);
      else if (axis === 'z') this._e.set(Math.PI / 2 + tilt, 0, 0);
      else this._e.set(0, 0, 0);
      this._q.setFromEuler(this._e);
      this._m.compose(this._v.set(x, y, z), this._q, this._one);
      g.applyMatrix4(this._m);
      arr.push(g);
    };

    /* ── the vehicle. +Z is forward and is where the rail points. ───────── */
    box(hull, 3.0, 1.05, 7.4, 0, 1.25, 0);            // chassis
    box(hull, 2.5, 1.45, 2.3, 0, 2.35, 2.1);          // cab
    box(hull, 2.6, 0.55, 3.0, 0, 2.05, -1.6);         // launcher bed
    box(hull, 0.5, 1.5, 0.5, -0.95, 2.6, -3.0);       // rear jacks
    box(hull, 0.5, 1.5, 0.5, 0.95, 2.6, -3.0);
    /* the rail and its two tubes, at a FIXED elevation. @see `LAUNCH_PITCH`. */
    cyl(hull, 0.34, 6.0, -0.42, 3.5, -1.1, 'z', -LAUNCH_PITCH);
    cyl(hull, 0.34, 6.0, 0.42, 3.5, -1.1, 'z', -LAUNCH_PITCH);
    box(hull, 1.6, 0.35, 2.2, 0, 2.55, -1.5);         // rail cradle
    for (let w = 0; w < 4; w++) {
      const zz = 2.5 - w * 1.9;
      cyl(hull, 0.68, 0.5, -1.55, 0.7, zz, 'x');
      cyl(hull, 0.68, 0.5, 1.55, 0.7, zz, 'x');
    }
    /* the team panel — the only thing on it that says whose it is. */
    box(team, 0.12, 0.5, 4.4, -1.53, 1.55, -0.3);
    box(team, 0.12, 0.5, 4.4, 1.53, 1.55, -0.3);
    box(team, 1.2, 0.16, 0.9, 0, 3.0, 2.1);

    const gHull = mergeGeometries(hull);
    const gTeam = mergeGeometries(team);
    this.geometries.push(gHull, gTeam);

    const lib = ctx.peek('materials');
    const patcher = ctx.peek('render')?.patcher ?? null;
    const mk = (name, tint, rough, metal) => {
      const set = lib?.getTextureSet?.(name) ?? null;
      const mat = new THREE.MeshStandardMaterial({
        color: tint, roughness: rough, metalness: metal, dithering: true,
      });
      mat.name = `batt_${name}`;
      if (set) {
        mat.map = set.albedo;
        mat.normalMap = set.normal;
        mat.roughnessMap = set.orm;
      }
      patcher?.patch(mat);
      this.materials.push(mat);
      return mat;
    };
    /**
     * THE TEAM COLOUR IS `RULES.playerTeam`'S AND IS READ THROUGH IT.
     * 「味方にも」 — these are the human's. `TEAM_COLOR[RULES.playerTeam]` rather
     * than `TEAM_COLOR[0]`, because painting by raw index has shipped the wrong
     * colour twice in this project. Flip `playerTeam` and the paint follows.
     */
    const mHull = mk('metal_painted', 0x4a5148, 0.74, 0.32);
    const mTeam = mk('metal_painted',
      new THREE.Color(TEAM_COLOR[RULES.playerTeam] ?? TEAM_COLOR[0]).multiplyScalar(0.72).getHex(),
      0.55, 0.28);

    this._hullMesh = new THREE.InstancedMesh(gHull, mHull, n);
    this._teamMesh = new THREE.InstancedMesh(gTeam, mTeam, n);

    /* ── the missile: a body, a nose and four fins. ─────────────────────── */
    const mis = [];
    cyl(mis, 0.22, 2.6, 0, 0, 0, 'z');
    const nose = new THREE.ConeGeometry(0.22, 0.7, 10);
    this._e.set(Math.PI / 2, 0, 0);
    this._q.setFromEuler(this._e);
    this._m.compose(this._v.set(0, 0, 1.65), this._q, this._one);
    nose.applyMatrix4(this._m);
    mis.push(nose);
    for (let f = 0; f < 4; f++) {
      const a = f * Math.PI / 2;
      const g = new THREE.BoxGeometry(0.06, 0.62, 0.7);
      this._e.set(0, 0, a);
      this._q.setFromEuler(this._e);
      this._m.compose(
        this._v.set(Math.sin(a) * 0.36, Math.cos(a) * 0.36, -1.15), this._q, this._one
      );
      g.applyMatrix4(this._m);
      mis.push(g);
    }
    const gMis = mergeGeometries(mis);
    this.geometries.push(gMis);
    const mMis = mk('metal_painted', 0xd8d2c4, 0.5, 0.3);
    this._missileMesh = new THREE.InstancedMesh(gMis, mMis, MAX_INFLIGHT);

    this.group = new THREE.Group();
    this.group.name = 'match-battery';
    this.group.matrixAutoUpdate = false;
    for (const m of [this._hullMesh, this._teamMesh, this._missileMesh]) {
      /**
       * NOT FRUSTUM CULLED. An `InstancedMesh`'s bounding sphere is the
       * GEOMETRY's until somebody recomputes it over the instance matrices, and
       * this geometry is authored at the origin while every instance stands 190 m
       * away on a mountain — culled-at-origin is exactly the class of bug that
       * makes a vehicle invisible from the half of the map it is visible from.
       * Three meshes of a handful of triangles each is not a culling problem.
       */
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      m.count = 0;
      this.group.add(m);
    }
    this.group.visible = false;
    ctx.scene.add(this.group);
  }

  /* ==================================================================== */
  /* the exception's gate, and the programme                              */
  /* ==================================================================== */

  /**
   * ⚠ PROVE THE CAPTURE-CIRCLE EXCEPTION. `match` calls this once, at boot,
   * after `resolveLayout` has moved the zones. A FAILURE DROPS THE FEATURE.
   * @see `batteryProve` and the exception block at the top of this file.
   */
  proveAgainst(zones, pads) {
    if (!this.ready || !this.spec) return null;
    this.proof = batteryProve(this.pat, zones, pads, this.spec.spawnClear);
    if (!this.proof.ok) {
      console.error(
        `[batt] ${this.spec.id}: the capture-circle exception DID NOT PROVE ` +
          `(worst impact ${(this.proof.worst * 100).toFixed(1)}% of its own capture radius, ` +
          `nearest base pad ${this.proof.nearestPad.toFixed(1)} m). ` +
          '「占領サイトへの直接はダメ ただし破壊オブジェ＋占領サイトの場所には落としてもいい」 — ' +
          'a battery round is only legal INSIDE the circle it names. DROPPED.'
      );
      this.ready = false;
      if (this.group) this.group.visible = false;
    }
    return this.proof;
  }

  /**
   * DEPLOY. `match` calls this on the frame `HiddenSquad.call` returned true,
   * with `RULES.playerTeam` and the pads, and never otherwise.
   * 「隠し部隊が相手に登場した時は、味方にも…投入」.
   */
  arm(team, pads) {
    if (!this.ready || this.armed || team < 0 || !this.enabled) return false;
    this.team = team;
    this.armed = true;
    this.magazine = RULES.mountainBatteryRounds;
    this._pads.length = 0;
    for (const p of pads ?? []) this._pads.push(p);
    for (const v of this.vehicles) {
      v.state = 'descend';
      v.s = 0;
      v.goal = STOPS[0];
      v.stop = 0;
      v.firedHere = 0;
      v.rounds = 0;
      v.visible = true;
      /**
       * THE FIRST LAY IS STAGGERED BY A THIRD OF A CYCLE PER GUN, so the
       * battery's tempo is even rather than three rounds at once and then
       * nothing for thirteen seconds. `_descendTime` is added because a gun
       * that has not arrived cannot fire.
       */
      v.wait = RULES.mountainBatteryInterval[0] * (v.i / this.vehicles.length);
      v.lay = 0;
      v.target = null;
    }
    if (this.group) this.group.visible = true;
    this.stats.armedAt = this._matchSecond();
    this.onDeploy?.(this.vehicles.length);
    console.info(
      `[batt] ${this.spec.id} DEPLOYING — ${this.vehicles.length} vehicles over the crest at ` +
        `t+${this.stats.armedAt}s, ${this.magazine} rounds between them. ` +
        'Armed by the hidden squad and by nothing else: 「隠し部隊が相手に登場した時は、味方にも」'
    );
    return true;
  }

  /** A new match or a round reset: everything back over the crest, magazine full. */
  reset() {
    this.armed = false;
    this.team = -1;
    this.magazine = 0;
    for (const v of this.vehicles) {
      v.state = 'off';
      v.s = 0;
      v.goal = 0;
      v.stop = 0;
      v.firedHere = 0;
      v.rounds = 0;
      v.wait = 0;
      v.lay = 0;
      v.target = null;
      v.visible = false;
      v.yaw = v.track.YAW[0];
      v.wantYaw = v.yaw;
    }
    for (const s of this._shots) s.live = false;
    if (this.group) this.group.visible = false;
    if (this._hullMesh) this._hullMesh.count = 0;
    if (this._teamMesh) this._teamMesh.count = 0;
    if (this._missileMesh) this._missileMesh.count = 0;
    const st = this.stats;
    st.rounds = st.atSite = st.atBodies = 0;
    st.refusedNoTarget = st.refusedNearCircle = st.refusedNearPad = 0;
    st.armedAt = st.homeAt = -1;
    st.shifts = 0;
    st.log.length = 0;
  }

  /* ==================================================================== */
  /* the frame                                                            */
  /* ==================================================================== */

  /**
   * @param dt
   * @param live   the round is being played
   * @param zones  every LIVE capture zone (`match.sites`)
   * @param foes   live targetable hostiles, filled by `match` into a list it owns
   */
  update(dt, live, zones, foes) {
    if (!this.ready) return;
    /**
     * THE ROUNDS IN THE AIR RUN IN EVERY PHASE, for `Crash.update`'s reason: a
     * missile that was launched while the round was live still has to land. The
     * GUNS only lay and launch while `live`.
     */
    this._updateShots(dt);
    if (this.armed) this._updateVehicles(dt, live, zones, foes);
    this._pose();
  }

  _updateVehicles(dt, live, zones, foes) {
    let home = 0;
    for (const v of this.vehicles) {
      switch (v.state) {
        case 'descend':
        case 'shift': {
          const speed = v.state === 'descend' ? DRIVE_SPEED : SHIFT_SPEED;
          const step = (speed * dt) / v.track.length;
          if (v.s < v.goal) v.s = Math.min(v.goal, v.s + step);
          else v.s = Math.max(v.goal, v.s - step);
          this._readTrack(v, true);
          if (Math.abs(v.s - v.goal) < 1e-4) {
            v.state = 'station';
            v.firedHere = 0;
          }
          break;
        }
        case 'withdraw': {
          v.s = Math.max(0, v.s - (DRIVE_SPEED * dt) / v.track.length);
          this._readTrack(v, true);
          if (v.s <= 1e-4) {
            v.state = 'home';
            v.visible = false;
          }
          break;
        }
        case 'station':
          this._readTrack(v, false);
          this._station(v, dt, live, zones, foes);
          break;
        case 'home':
          home++;
          break;
        default:
          break;
      }
      /* traverse onto the bearing, at a rate, in every state. */
      let d = v.wantYaw - v.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const lim = TRAVERSE_RATE * dt;
      v.yaw += Math.max(-lim, Math.min(lim, d));
    }
    if (home === this.vehicles.length) {
      this.armed = false;
      this.stats.homeAt = this._matchSecond();
      this.onHome?.(this.stats.rounds);
      if (this.group) this.group.visible = false;
      console.info(
        `[batt] the battery is home — ${this.stats.rounds}/${RULES.mountainBatteryRounds} ` +
          `rounds away (${this.stats.atSite} on capture sites, ${this.stats.atBodies} on bodies), ` +
          `${this.stats.shifts} berth shifts · t+${(this.stats.homeAt - this.stats.armedAt).toFixed(0)}s`
      );
    }
  }

  /** Read the baked pose at `v.s`. `drive` takes the track's own heading. */
  _readTrack(v, drive) {
    const t = v.track;
    const f = Math.max(0, Math.min(1, v.s)) * (t.n - 1);
    const i = Math.min(t.n - 2, Math.floor(f));
    const a = f - i;
    v.x = t.X[i] + (t.X[i + 1] - t.X[i]) * a;
    v.y = t.Y[i] + (t.Y[i + 1] - t.Y[i]) * a;
    v.z = t.Z[i] + (t.Z[i + 1] - t.Z[i]) * a;
    v.pitch = t.PITCH[i] + (t.PITCH[i + 1] - t.PITCH[i]) * a;
    if (drive) v.wantYaw = t.YAW[i];
  }

  /** One stationed gun: wait, lay, launch, and scoot every `SHIFT_EVERY`. */
  _station(v, dt, live, zones, foes) {
    if (!live) return;
    if (v.lay > 0) {
      v.lay -= dt;
      this._layPulse(v, dt);
      if (v.lay <= 0) this._launch(v);
      return;
    }
    if (this.magazine <= 0) {
      v.state = 'withdraw';
      return;
    }
    v.wait -= dt;
    if (v.wait > 0) return;
    const got = this._pickTarget(v, zones, foes);
    if (!got) {
      // Nothing legal to shoot at is a round DEFERRED, never a round spent.
      this.stats.refusedNoTarget++;
      v.wait = 1.5;
      return;
    }
    /** 「１０数秒に１発」 — this gun's cycle. @see `RULES.mountainBatteryInterval`. */
    v.lay = RULES.mountainBatteryLay;
    v.wantYaw = Math.atan2(this._aim.x - v.x, this._aim.z - v.z);
    /* the aim point is frozen HERE, at the lay, so the reticle cannot lie. */
    v.aimX = this._aim.x; v.aimY = this._aim.y; v.aimZ = this._aim.z;
    const range = Math.hypot(v.aimX - v.x, v.aimZ - v.z);
    v.flight = Math.max(
      RULES.mountainBatteryFlight[0],
      Math.min(RULES.mountainBatteryFlight[1], range / RULES.mountainBatterySpeed)
    );
    const a = this._ann;
    a.title = this.spec.title;
    a.impactTitle = this.spec.impactTitle;
    a.name = v.targetIsSite ? `${v.target.id} · ${v.target.name ?? ''}`.trim() : 'ENEMY IN THE OPEN';
    a.lead = v.lay + v.flight;
    a.x = v.aimX; a.y = v.aimY; a.z = v.aimZ;
    a.what = v.targetIsSite ? 'site' : 'bodies';
    a.zone = v.targetIsSite ? v.target : null;
    a.round = this.stats.rounds + 1;
    a.gun = v.i;
    this.onLay?.(a);
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    /**
     * `drone_lock` AND DELIBERATELY NOT `strike_jet`, which is `_satPulse`'s own
     * argument: there is no aeroplane here either, and this is the one voice in
     * the bank that is A MACHINE DECIDING rather than a machine flying. It is on
     * the `ui` bus, so it survives the concussion muffle a man on a shelled
     * point is already under.
     */
    audio?.play?.('drone_lock', this._v.set(v.aimX, v.aimY + 0.4, v.aimZ),
      { level: 0.8, dur: 0.55, maxDist: 240 });
  }

  /**
   * THE DESIGNATOR RING, once a lay. A ring on the ground at the impact point
   * tightening as the lay runs out, so a man who is looking at his feet inside
   * the circle still knows. It carries no light — `LightPool` is four for the
   * whole game and `warfield.js` already lost that argument for the burning
   * ridge; the launch flash below is the one slot this feature spends.
   */
  _layPulse(v, dt) {
    v.pulse -= dt;
    if (v.pulse > 0) return;
    v.pulse = RULES.mountainBatteryLay / 3;
    const k = 1 - Math.max(0, v.lay) / RULES.mountainBatteryLay;
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    const r = (v.targetIsSite ? (v.target.radius ?? RULES.captureRadius) : RULES.mountainBatteryRadius);
    fx?.hazeRing?.(v.aimX, v.aimY + 0.5, v.aimZ, r * (0.9 - 0.45 * k), 26, 0.6, 2.0);
  }

  /* ==================================================================== */
  /* what it may fire at                                                  */
  /* ==================================================================== */

  /**
   * CHOOSE ONE ROUND'S AIM POINT. Writes it into `this._aim` and sets
   * `v.target` / `v.targetIsSite`. Returns false when nothing LEGAL was found,
   * which defers the round rather than spending it.
   *
   * 「占領サイトや敵に向けて」, in that order and as two disjoint gates.
   *
   *   1. AN ENEMY-HELD CAPTURE SITE — the named exception. The one held longest
   *      (`_callZoneBombard`'s own "sat on longest" rule, which is the honest
   *      definition of the point that is actually costing this side the match),
   *      minus any point another gun is already laying on, so three guns are on
   *      three points rather than three guns on one.
   *   2. A CLUSTER OF ENEMY BODIES ON OPEN GROUND — and this one is BOUND by
   *      the rule, not exempt from it: the aim point must clear the EDGE of
   *      every live circle by `spec.clear` and every base pad by
   *      `spec.spawnClear`.
   *
   * `z.owner === this.team` is compared against the side `match` handed in,
   * which is `RULES.playerTeam`, and never against a raw index.
   */
  _pickTarget(v, zones, foes) {
    const now = this.ctx.time?.elapsed ?? 0;
    /* ---- 1. an enemy-held site ----------------------------------------- */
    let best = null;
    let bestHeld = -1;
    for (const z of zones ?? []) {
      if (!z || z.owner < 0 || z.owner === this.team) continue;
      let taken = false;
      for (const o of this.vehicles) {
        if (o !== v && o.lay > 0 && o.targetIsSite && o.target === z) taken = true;
      }
      if (taken) continue;
      const held = now - (z.ownedSince ?? now);
      if (held > bestHeld) { bestHeld = held; best = z; }
    }
    if (best) {
      const i = this.stats.rounds % this.pat.u.length;
      const R = best.radius ?? RULES.captureRadius;
      this._aim.set(
        best.position.x + this.pat.u[i] * R,
        best.position.y + 0.4,
        best.position.z + this.pat.v[i] * R
      );
      v.target = best;
      v.targetIsSite = true;
      return true;
    }
    /* ---- 2. enemy bodies, clear of every circle and every pad ----------- */
    if (!foes || !foes.length) return false;
    let cx = 0, cz = 0, cy = 0, bestN = 0;
    for (let i = 0; i < foes.length; i++) {
      const p = foes[i]?.position;
      if (!p) continue;
      let n = 0;
      for (let k = 0; k < foes.length; k++) {
        const q = foes[k]?.position;
        if (q && Math.hypot(q.x - p.x, q.z - p.z) <= CLUSTER_R) n++;
      }
      if (n > bestN) { bestN = n; cx = p.x; cy = p.y; cz = p.z; }
    }
    if (bestN < RULES.mountainBatteryCluster) return false;
    for (const z of zones ?? []) {
      if (!z?.position) continue;
      const r = (z.radius ?? RULES.captureRadius) + this.spec.clear;
      if (Math.hypot(cx - z.position.x, cz - z.position.z) < r) {
        this.stats.refusedNearCircle++;
        return false;
      }
    }
    for (const p of this._pads) {
      if (Math.hypot(cx - p[0], cz - p[1]) < this.spec.spawnClear) {
        this.stats.refusedNearPad++;
        return false;
      }
    }
    this._aim.set(cx, cy + 0.4, cz);
    v.target = null;
    v.targetIsSite = false;
    return true;
  }

  /* ==================================================================== */
  /* the round                                                            */
  /* ==================================================================== */

  _launch(v) {
    v.lay = 0;
    if (this.magazine <= 0) { v.state = 'withdraw'; return; }
    let slot = null;
    for (const s of this._shots) if (!s.live) { slot = s; break; }
    if (!slot) { v.wait = 2; return; }
    this.magazine--;
    this.stats.rounds++;
    v.rounds++;
    v.firedHere++;
    if (v.targetIsSite) this.stats.atSite++;
    else this.stats.atBodies++;

    /**
     * THE RAIL'S MUZZLE, IN WORLD SPACE. The model's +Z is forward and the rail
     * is a 38° cradle over the cab, so the tube's mouth is 1.3 m forward of the
     * hull centre and 5.3 m up. Forward is `(sin yaw, cos yaw)`, which is the
     * convention `_pickTarget`'s own `atan2(dx, dz)` establishes.
     */
    const mx = v.x + Math.sin(v.yaw) * 1.3;
    const mz = v.z + Math.cos(v.yaw) * 1.3;
    const my = v.y + 5.3;
    slot.live = true;
    slot.t = 0;
    slot.flight = v.flight;
    slot.trail = 0;
    slot.whistled = false;
    slot.gun = v.i;
    slot.round = this.stats.rounds;
    slot.what = v.targetIsSite ? 'site' : 'bodies';
    slot.zoneId = v.targetIsSite ? v.target.id : '';
    slot.ax = mx; slot.ay = my; slot.az = mz;
    slot.bx = v.aimX; slot.by = v.aimY; slot.bz = v.aimZ;
    const range = Math.hypot(slot.bx - slot.ax, slot.bz - slot.az);
    /** Apex over the chord. It has to clear a 5.6 m rim wall from 190 m out and
     *  read as a missile rather than a mortar bomb at every range. */
    slot.apex = Math.max(28, Math.min(120, range * 0.26));

    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (fx) {
      fx.hazeRing?.(mx, my, mz, 2.6, 22, 0.6, 2.2);
      fx.addSmokeColumn?.(mx, my - 1.2, mz, {
        duration: 0.6, rate: 26, radius: 2.4, rise: 3.2, dark: 0.2, life: 5.0, growth: 4.2,
      });
      /**
       * ONE LIGHT, AT PRIORITY 3. Below the 4 every explosion in the game takes,
       * deliberately: a launch on the skyline may never evict the flash of a
       * round landing on somebody. `LightPool.flash` returns null and does
       * nothing when it loses, which is the correct outcome here.
       */
      if (fx.lights) fx.lights.flash(mx, my, mz, 1, 0.66, 0.34, 1300, 0.5, 6, 90, 3);
    }
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    /**
     * `strike_jet` AT THE VEHICLE. There is no launch voice in the bank —
     * `src/audio` publishes no rocket motor — and the standing rule for this
     * project is to use the existing voices through their existing entry points
     * rather than write a second implementation that drifts from the first.
     * `strike_jet` is a burning motor crossing the sky, which is what
     * `skyfall.js` and `crash.js` both already reuse it for.
     */
    audio?.play?.('strike_jet', this._v.set(mx, my, mz),
      { level: 1.0, dur: 1.1, maxDist: 460, gain: 2.0, occlusion: 0.15 });

    /**
     * 「１０数秒に１発」 — THIS GUN'S CYCLE, and the whole of what makes thirty
     * rounds fit the match. @see `RULES.mountainBatteryInterval` for the
     * measured arithmetic against the trigger's own clock.
     */
    const iv = RULES.mountainBatteryInterval;
    v.wait = this.rng.range(iv[0], iv[1]) - RULES.mountainBatteryLay;
    if (this.magazine <= 0) {
      v.state = 'withdraw';
      return;
    }
    /* 「移動式」 — shoot and scoot. @see `STOPS`. */
    if (v.firedHere >= SHIFT_EVERY && STOPS.length > 1) {
      v.stop = (v.stop + 1) % STOPS.length;
      v.goal = STOPS[v.stop];
      v.state = 'shift';
      v.firedHere = 0;
      this.stats.shifts++;
    }
  }

  _updateShots(dt) {
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    for (const s of this._shots) {
      if (!s.live) continue;
      s.t += dt;
      const k = Math.min(1, s.t / s.flight);
      this._shotAt(s, k, this._v);
      /* the whistle, AT THE TARGET, for the last `WHISTLE` seconds. */
      if (!s.whistled && s.flight - s.t <= WHISTLE) {
        s.whistled = true;
        audio?.play?.('strike_incoming', this._v2.set(s.bx, s.by + 1.0, s.bz),
          { level: 1.0, dur: WHISTLE, maxDist: 300, gain: 1.6 });
      }
      s.trail -= dt;
      if (s.trail <= 0 && k < 0.98) {
        s.trail = TRAIL_GAP;
        /**
         * A ONE-SHOT PUFF (`duration` 0.1), NOT AN EMITTER THAT LIVES FOR THE
         * FLIGHT. `Ambience` has 24 emitters for the whole game and evicts
         * oldest-first; a five-second emitter per puff would be eighteen slots
         * per missile and would silently take the map's smoke away.
         * `Skyfall._trail` is the same shape for the same reason.
         */
        fx?.addSmokeColumn?.(this._v.x, this._v.y, this._v.z, {
          duration: 0.1, rate: 22, radius: 1.1, rise: 1.2, dark: 0.16, life: 3.4, growth: 2.6,
        });
      }
      if (k >= 1) {
        s.live = false;
        this._impact(s);
      }
    }
  }

  /** Closed form. Position of shot `s` at normalised time `k`, into `out`. */
  _shotAt(s, k, out) {
    return out.set(
      s.ax + (s.bx - s.ax) * k,
      s.ay + (s.by - s.ay) * k + s.apex * 4 * k * (1 - k),
      s.az + (s.bz - s.az) * k
    );
  }

  _impact(s) {
    const at = this._v.set(s.bx, s.by, s.bz);
    /**
     * `source: null` — NOBODY'S ROUND, WHICH MEANS IT KILLS BOTH SIDES. The
     * same payload `_updateBombard`, the acts' barrages and the orbital strike
     * all use, and here it is a design cost rather than an implementation
     * detail: a man of the battery's own side contesting the point it is
     * shelling dies in it, and so does the human. That is what stops thirty
     * free rounds from being a free win, and it is why the telegraph above is
     * the largest part of this file.
     */
    const p = this._blast;
    p.position = this._blastPos.copy(at).setY(at.y + RULES.blastBurstHeight);
    p.radius = RULES.mountainBatteryRadius;
    p.damage = RULES.mountainBatteryDamage;
    p.source = null;
    /**
     * ONE EMIT IS THE WHOLE EVENT. `fx` listens for `explosion` and already
     * lays the fireball, the scorch, the smoke column and a priority-4 light;
     * `audio`, `ui`'s flinch, `physics`' impulse and both damage paths are on
     * the same listener list. A second `fx.explosion` here would be double
     * spending a light slot the impact has already taken.
     */
    this.ctx.events.emit('explosion', p);
    const a = this._ann;
    a.title = this.spec.title;
    a.impactTitle = this.spec.impactTitle;
    a.name = s.zoneId || 'ENEMY IN THE OPEN';
    a.lead = 0;
    a.x = s.bx; a.y = s.by; a.z = s.bz;
    a.what = s.what;
    a.zone = null;
    a.round = s.round;
    a.gun = s.gun;
    this.onImpact?.(a);
    this.stats.log.push({
      t: this._matchSecond(), round: s.round, gun: s.gun,
      what: s.what, zone: s.zoneId,
    });
  }

  /* ==================================================================== */
  /* the pose                                                             */
  /* ==================================================================== */

  /**
   * EVERY MATRIX THIS FEATURE WRITES, ONCE A FRAME. At most three vehicles and
   * four missiles: seven `compose` calls and three `needsUpdate` flags, and
   * nothing is allocated to do it.
   */
  _pose() {
    if (!this.group) return;
    let n = 0;
    for (const v of this.vehicles) {
      if (!v.visible) continue;
      this._e.set(v.pitch, v.yaw, 0);
      this._q.setFromEuler(this._e);
      this._m.compose(this._v.set(v.x, v.y, v.z), this._q, this._one);
      this._hullMesh.setMatrixAt(n, this._m);
      this._teamMesh.setMatrixAt(n, this._m);
      n++;
    }
    this._hullMesh.count = n;
    this._teamMesh.count = n;
    if (n) {
      this._hullMesh.instanceMatrix.needsUpdate = true;
      this._teamMesh.instanceMatrix.needsUpdate = true;
    }
    let m = 0;
    for (const s of this._shots) {
      if (!s.live) continue;
      const k = Math.min(1, s.t / s.flight);
      this._shotAt(s, k, this._v);
      /* heading = the analytic derivative of the arc, so the nose is truthful. */
      this._dir.set(
        s.bx - s.ax,
        s.by - s.ay + s.apex * 4 * (1 - 2 * k),
        s.bz - s.az
      ).normalize();
      this._q.setFromUnitVectors(this._fwd, this._dir);
      this._m.compose(this._v, this._q, this._one);
      this._missileMesh.setMatrixAt(m, this._m);
      m++;
    }
    this._missileMesh.count = m;
    if (m) this._missileMesh.instanceMatrix.needsUpdate = true;
    /**
     * THE GROUP OUTLIVES THE BATTERY BY ONE ROUND. A missile that was in the
     * air when the last vehicle went over the crest still has to land, so
     * visibility is `anything to draw` rather than `armed` — the same reason
     * `update` runs the shots in every phase.
     */
    this.group.visible = n + m > 0;
  }

  /* ==================================================================== */

  _matchSecond() {
    const m = this.ctx.peek('match');
    const left = m?.roundClock ?? 0;
    return +(RULES.matchTime - left).toFixed(1);
  }

  report() {
    const s = this.stats;
    if (!this.ready) return '[batt] no mountain battery on this map';
    if (s.armedAt < 0 && !s.rounds) return '[batt] never deployed';
    const span = s.homeAt >= 0 ? (s.homeAt - s.armedAt).toFixed(0) : 'still up';
    return (
      `[batt] ${s.rounds}/${RULES.mountainBatteryRounds} rounds — ` +
      `${s.atSite} on enemy-held capture sites (the named exception), ` +
      `${s.atBodies} on bodies in the open · ` +
      `deferred: nothing legal ${s.refusedNoTarget}, ` +
      `too near a circle ${s.refusedNearCircle}, too near a pad ${s.refusedNearPad} · ` +
      `${s.shifts} berth shifts · armed at t+${s.armedAt}s, home at t+${s.homeAt}s (${span}s) · ` +
      s.log.map((e) => `r${e.round}@${e.t}s g${e.gun} ${e.zone || e.what}`).join(' | ')
    );
  }

  dispose() {
    if (this.group) {
      this.ctx.scene?.remove(this.group);
      this.group.clear();
      this.group = null;
    }
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this._hullMesh = this._teamMesh = this._missileMesh = null;
    this.vehicles.length = 0;
    this._shots.length = 0;
    this._pads.length = 0;
    this.onDeploy = this.onLay = this.onImpact = this.onHome = null;
    this.enemies = null;
    this.ready = false;
  }
}
