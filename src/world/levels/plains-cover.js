import * as THREE from 'three';
import { BOX, BOX_FINE, BOX_SOFT, BOX_THIN, IDENT, LL, mergeSimple } from '../kit.js';
import {
  fbm3, patchGeometry, rockGeometry, driftBerm, paintMasks, tubeY, fillMasks, newTrs,
} from '../util.js';
import { Rng } from '../../core/rng.js';
import { wallRun, debrisField, drawDebris, fallenMember } from './plains-works.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * `noSheet` — THE FLAT GROUND SHEETS, DELETED, WITHOUT MOVING ANYTHING ELSE
 * ════════════════════════════════════════════════════════════════════════════
 * 「この地面テクスチャーが浮いてます 至る所で 消して」
 *
 * WHY THEY GO. `patchGeometry` is a fan of triangles at y = 0 — a horizontal
 * surface, by construction, and nothing else. The only key light on this map is
 * a burning ridge ON THE HORIZON, so N·L on an up-facing surface is ≈ 0 and the
 * sheet falls to the ambient floor whatever material it carries. It
 * photographs as a hard-edged black quadrilateral lying across the lit steppe,
 * which is exactly what a slab floating over the ground photographs as. That is
 * why the previous fix — conforming them to the terrain per vertex — changed
 * nothing the user could see: "correctly on the ground" and "a black hole in
 * the map" were both true at once. @see the long note in `plains-ground.js`.
 *
 * WHY IT IS A SINK AND NOT A DELETED CALL. This file's `rng` is ONE STREAM
 * drawn in sequence across every site it dresses, and the sheets sit in the
 * middle of it — the scorch inside a bunker is drawn before the next wreck, the
 * hardstanding under a berm before the crates on it. Deleting the draws would
 * re-roll every crate, hesco block, sandbag, wreck and boulder placed after
 * them, and those carry COLLISION: `boundcheck`'s 1.2-2.0 m boundary margin,
 * `stuckcheck` and `_scatterblock`'s 0.42-0.68 m trip band are all measured
 * against where they are today. So `A.addOnce(...)` becomes `noSheet(...)`
 * with its argument list untouched: every `rng.float()`, `rng.range()` and
 * `patchGeometry` lobe draw still happens, in the same order, and NOT ONE PROP
 * ON THIS MAP MOVES. The geometry is built and thrown away, which costs a few
 * hundred discarded triangles at load and nothing at all per frame.
 *
 * Signature is `A.addOnce`'s so the call sites read unchanged and a future
 * reader can see exactly what used to be drawn.
 */
const noSheet = (key, geo) => { geo?.dispose?.(); };

/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD — DIE TRÜMMERFELDER. What the plain was fought over before tonight.
 * ════════════════════════════════════════════════════════════════════════════
 * 「平原にしても障害物なさすぎ もっと荒廃した建物、乗り物、でかい硝煙のようにして
 *   平原での移動にもう少し無防備な時間を少なくして」
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE REQUEST IS NOT "MORE PROPS". IT IS LESS TIME IN THE OPEN.
 * ────────────────────────────────────────────────────────────────────────────
 * Those two come apart the moment you measure them, and this map has already
 * been burned by the difference once — 「瓦礫があった歩けるからいいのではなく、
 * 瓦礫による視認性の悪さが問題」: walkability was the wrong metric, sightlines
 * were the metric. Here it is sightlines again, pointing the other way.
 *
 * A hundred boulders spread evenly over 350 m of plain change the object count
 * and change NOTHING about the walk from the north base to zone A, because that
 * walk is a straight line and the boulders are not on it. So this pass does not
 * scatter. Every piece of mass in this file is placed ON A CROSSING — the line
 * between two places people actually walk between — and the gate on it is
 * `_plaincross.mjs`, which walks each of those lines at a standing eye (1.62 m)
 * and reports:
 *
 *   lane   metres of unbroken corridor along the route the man is standing in
 *   run    THE HEADLINE — the longest CONTINUOUS stretch of the walk on which
 *          the lane never drops under 120 m. Literally "how far you go with
 *          nothing between you and a rifle".
 *   near   is there anything within 8 m to get behind
 *
 * MEASURED ON THE BARE PLAIN, before this file existed: mean lane 126 m, 42 % of
 * every walk in a >120 m corridor, worst continuous exposed run 76 m, and only
 * 28 % of the ground with cover within a sprint step. The north base's walk to
 * zone A was 100 % exposed for its whole length with a mean lane of 222 m.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS ENGINE PUNISHES, AND HOW EACH ONE IS ANSWERED HERE
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  1. `NavGrid` IS A 2.5D HEIGHT FIELD — one floor per 0.8 m cell, found by one
 *     downward ray. The town's 36 820 walkable-but-unreachable roof cells in
 *     2 113 components are what that costs when a structure has an upper storey,
 *     and the plain was deliberately built against it (222 438 of 223 223 cells
 *     in ONE component). So:
 *
 *       · NOTHING HERE HAS AN UPPER STOREY, A ROOF OR A DECK. A ruin is walls
 *         standing on the plain and the plain is its floor — there is no second
 *         surface anywhere over a cell this file touches, so no ray can find the
 *         wrong one.
 *       · WALL TOPS ARE BROKEN, NOT COPED. `wallRun`'s smooth coping is turned
 *         off and replaced with a jagged cap, because a continuous flat 0.5 m
 *         ledge 3 m up is a strip of cells the ray finds at 3 m and the ground
 *         beside them at 0 — an island, by construction.
 *       · LEANING SLABS ARE AUTHORED OVER 52°, past `NavGrid`'s 46° slope
 *         limit, so the cells under a fallen roof panel are refused rather than
 *         becoming a ramp to nowhere.
 *
 *  2. GROUND SCATTER THAT STOPS YOU WALKING HAS SHIPPED AND BEEN COMPLAINED
 *     ABOUT — 「地面に落ちている石ころオブジェが移動の妨げです、ジャンプしないと
 *     乗り越えられない」. `STANCE.stand.stepHeight` is 0.42, so anything standing
 *     0.42-0.68 m proud of the ground is a trip hazard. EVERY rubble pile here
 *     is a `debrisField` — the height field that is RELAXED until no cell stands
 *     more than 0.36 m over its neighbour, which is under the step however the
 *     two lattices line up. It is the shipped answer (the stepped cone) and not
 *     a second one.
 *
 *  3. PROPS IN DOORWAYS IS FIVE SEPARATE SHIPPED BUGS HERE, and `interiors.js`
 *     once tested a prop's CENTRE against a circle while props have extent. So
 *     every opening a man walks through registers a `clear` circle, and the test
 *     below is `d < r + propRadius` — the extent is in it.
 *
 *  4. SIX TANKS DRIVE THIS MAP on baked routes that are RE-BAKED AGAINST THE
 *     WORLD, and `src/match/tank.js` may not be imported from here (nor its
 *     route table copied — that is the five-files-out-of-sync trap this level
 *     was written to escape). So the routes are respected by CONSTRUCTION
 *     instead: `PASS_TOP` in that file is 3.6 m and `CLIMB_TOP` is 2.6 m —
 *     mass no taller than 2.6 m is ground a hull rides over and is invisible to
 *     the side probe that ends a leg. `TALL` below is 2.55 m and it is the
 *     ceiling on every wreck, berm, revetment and emplacement in this file.
 *     Only the ruin walls go over it, they are eight buildings rather than a
 *     wall, and the boot log's `[tank]` line is the gate that says so.
 *
 *  5. `rng` IS ONE STREAM. This pass takes its own (`Rng(0x4ca7e2)`) and is
 *     called at the very END of `PLAINS.build`, so not one stone, tuft or
 *     boulder placed by any earlier pass moves.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND THE SMOKE — 「でかい硝煙のような」
 * ────────────────────────────────────────────────────────────────────────────
 * `src/fx/ambience.js` already publishes the seam for exactly this: "`world` can
 * tag any object with `userData.fxSmoke = { radius, rate }` and it will start
 * smoking without either subsystem knowing about the other". That is the path
 * taken. It is NOT a third throwable implementation — the player's can
 * (`src/weapons/grenades.js`) and the bots' (`src/ai/index.js:_smokeDraw`) are
 * two that have drifted twice already, and neither is touched. Nor does this
 * publish `weapon:smoke`: that event LATCHES `AiSystem._smokeR` off its radius
 * and pushes a sightline volume into a fixed ring, so a permanent world plume
 * announcing itself as a grenade would quietly re-tune every bot's smoke.
 *
 * WHAT THAT MEANS HONESTLY: these banks are cover to the PLAYER'S EYE and to
 * the camera, and they are not cover to `AiSystem._smokeBlocks`. A bot can see
 * through them. That is a real limitation, it is stated here rather than
 * discovered later, and the fix for it lives in `src/ai`, not in `src/world`.
 *
 * WHAT IT LOOKS LIKE is its own problem and it has its own section: @see the
 * `SMOKE_*` block below, which is written against the density figure the
 * player's can was fixed to rather than against a radius.
 *
 * AND THE PLAIN'S OWN GROUND — 「平原なのになんで草とか砂利とかがないの？」 — is in
 * this pass too, for the reason the request gives: it is the same walk. @see
 * the `dressPlain` section.
 */

/**
 * One query-string read, guarded once. `globalThis.location` does not exist in
 * node, and every gate in `tools/` that builds a world outside a browser would
 * throw on the bare read — which is a boot failure reported as a nav failure.
 */
function coverFlag(name) {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').has(name);
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────────── the ceiling ──
/**
 * The tallest anything in this file may stand except a ruin wall. @see note 4:
 * `tank.js`'s `CLIMB_TOP` is 2.6 m and mass under it is terrain to a 40 t hull.
 * It is also 0.93 m over a standing eye, so it is full cover at every stance —
 * the ceiling costs nothing at all in what the player gets.
 */
const TALL = 2.55;

/** Cell of the relaxed rubble fields. @see `debrisField`. */
const RUBBLE_CELL = 2.2;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE ANGLE THAT KEEPS THE MAP ONE COMPONENT
 * ────────────────────────────────────────────────────────────────────────────
 * `NavGrid` refuses a cell whose floor normal is under `cos(46°)`, and THIS MAP
 * IS THE REACTION TO WHAT HAPPENS OTHERWISE: the town carries 36 820 walkable
 * cells above 2.5 m in 2 113 components with NOT ONE of them joined to the
 * ground, because every roof and upper floor there is a flat surface a ray can
 * find. NACHTFELD's rule is one component with the ground, and there are only
 * ever two ways to keep it — JOIN the surface, or make sure nothing can stand
 * on it at all.
 *
 * Everything in this file that a man has no business standing on is authored
 * past this angle rather than left flat and unreachable: the leaning roof slabs
 * in `ruin` (already 54-73°), the berm ridge, the caps on the ruin walls. 58°
 * is comfortably past 46° with room for the ground under a piece to tilt it a
 * few degrees the wrong way and still be refused.
 */
const RIDGE_DEG = 58;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * A CRUMPLED DECK — collision only, and the drawn hull does not move
 * ────────────────────────────────────────────────────────────────────────────
 * A wreck's decks are the last islands on this map: 771 stranded cells over 31
 * sites, a lorry bed at 1.08 m and a hull roof at 2.2 m that a ray finds, a man
 * can be put on and no bot can ever reach.
 *
 * ONE ridge over a deck is not an option — the apex height follows the width,
 * so a 2.25 m chassis would carry a 1.8 m spike. A CORRUGATION does the same
 * job at a fifth of the height: ridges every `pitch` metres, which is under the
 * 0.8 m nav cell, so wherever a cell centre lands it lands on a face at
 * `RIDGE_DEG` and the whole deck is refused. Six triangles a ridge.
 *
 * IT IS THE COLLISION AND NOT THE HULL. `wreck`'s `put` draws with `A.add` and
 * collides with `A.box` in two separate calls off the same transform, so this
 * changes what a ray finds and what a capsule stands on while every wreck looks
 * exactly as it did. That is also the honest description of the trade: a burnt
 * hull whose plating has buckled is not a firing step, and the alternative was
 * ramping thirty-one of them up to the ground.
 */
function deckCrown(A, surface, x, y, z, sx, sz, yaw, pitch = 0.5) {
  const m = Math.max(1, Math.round(sx / pitch));
  const halfW = sx / m / 2;
  const capH = halfW * Math.tan((RIDGE_DEG * Math.PI) / 180);
  const h = sz / 2;
  const pos = []; const idx = [];
  for (let i = 0; i < m; i++) {
    const cxl = -sx / 2 + (i + 0.5) * (sx / m);
    const b = i * 6;
    pos.push(
      cxl, capH, -h, cxl - halfW, 0, -h, cxl + halfW, 0, -h,
      cxl, capH, h, cxl - halfW, 0, h, cxl + halfW, 0, h,
    );
    idx.push(b, b + 1, b + 4, b, b + 4, b + 3);
    idx.push(b, b + 3, b + 5, b, b + 5, b + 2);
    idx.push(b, b + 2, b + 1, b + 3, b + 4, b + 5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  A.collideGeo(surface, g, newTrs(x, y, z, yaw));
  return capH;
}

/**
 * A triangular prism, ridge along local Z, apex over the middle — the collision
 * cap that stops a flat top being a floor.
 *
 * `halfW` is half the thickness it has to cover and the apex height follows
 * from `RIDGE_DEG`, so the caller cannot accidentally author a shallow one: the
 * only way to cover a wider top is to stand a taller ridge on it.
 */
function ridgePrism(halfW, len) {
  const capH = halfW * Math.tan((RIDGE_DEG * Math.PI) / 180);
  const h = len / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, capH, -h, -halfW, 0, -h, halfW, 0, -h,
    0, capH, h, -halfW, 0, h, halfW, 0, h,
  ], 3));
  g.setIndex([
    0, 1, 4, 0, 4, 3,   // one face
    0, 3, 5, 0, 5, 2,   // the other
    0, 2, 1, 3, 4, 5,   // the two ends
  ]);
  g.computeVertexNormals();
  g.userData.capH = capH;
  return g;
}

/** The walkable disc. `RIDGE_R0` is 176; three metres in is where scatter stops. */
const PLAIN_R = 173;

// ────────────────────────────────────────────────────────────────── the smoke ──
/**
 * ════════════════════════════════════════════════════════════════════════════
 * 「硝煙をもっともくもくさせろ」 — もくもく IS DENSITY, AND IT IS NOT RADIUS
 * ════════════════════════════════════════════════════════════════════════════
 * This exact mistake has already been made once in this repo and it is written
 * down: 「いやスモークは煙を１０mだせばいいのになんか実質３mくらいしかスモークで
 * てないです」. The can PUBLISHED a 10 m radius and drew about 3 m of it, and the
 * fix (commit 5b8d7b0) was not the radius:
 *
 *     footprint  rad x 0.22 -> rad x 0.62      the disc a puff is BORN in
 *     growth     5.85       -> 1.8             the multiplier it grows by
 *     rate       26         -> 78              live sprites 195 -> 585
 *
 * because `alphaCurve` is 1.7: a puff is only at `radius x growth` at the END of
 * its life, by which time it has all but been erased. WHAT YOU SEE IS THE YOUNG
 * PUFF, AND THE YOUNG PUFF IS THE FOOTPRINT. A huge `growth` over a small
 * footprint is a handful of enormous ghosts; a big footprint at a low rate is a
 * haze you can read a wall through. The number that makes smoke BILLOW is
 * SPRITES PER SQUARE METRE OF FOOTPRINT, and nothing else is.
 *
 * The can measures 4.8 sprites/m² (585 over a 6.2 m disc). These banks are
 * authored against that figure rather than against a look:
 *
 *     footprint 4.6 m -> 66 m² -> the can's density would be 320 sprites
 *
 * and `rate x life` is set to whatever share of the lit ring is affordable on
 * the tier the game booted at — 3.1 sprites/m² on the default preset, which is
 * 65 % of a grenade's density held permanently, on four banks at once.
 *
 * WHY IT IS NOT SIMPLY THE CAN'S NUMBERS: a can lives 14 s and there is one.
 * These never go out. `Ambience` has 24 emitter slots and a persistent source is
 * never evicted (`_acquire` ranks by `age/duration`, and Infinity ranks 0), so
 * four is already a sixth of the pool that the cans, `crash.js`'s nine burning
 * cells and the airstrike's dust wall cannot have — and `rate x life` IS the
 * live sprite count out of `fx.lit`, whose capacity is a share of
 * `q.particleBudget`. @see `smokeRate`.
 */
const SMOKE_BANKS = 6;
/**
 * ────────────────────────────────────────────────────────────────────────────
 * 4 -> 6, AND WHAT THE PHOTOGRAPH SAYS THAT THE TUNE DID NOT
 * ────────────────────────────────────────────────────────────────────────────
 * 「硝煙も少ない」, second time of asking, against a tune that had measured 252
 * live sprites a bank and called it 「もくもく」. Both are true, and the missing
 * measurement is RANGE. `_nfsmokewhen.mjs` stands a camera on the line back to
 * the map centre and shoots the same bank at three distances in the dark build:
 *
 *   30 m   a pale plume, clearly a burning wreck, clearly smoke
 *   100 m  a smudge — the bank does not read
 *   200 m  nothing
 *
 * A 400 m map with four banks all of them within seventy metres of the boundary
 * therefore has, from most places a man stands, no smoke in the frame at all —
 * which is exactly what he is reporting, and no amount of density on four banks
 * fixes it, because density is not the axis that failed.
 *
 * SO: MORE BANKS, AND THE COST IS STATED RATHER THAN HIDDEN. `rate x life` IS
 * the live sprite count out of `fx.lit`, whose capacity measured 2 805 on the
 * default preset, and `SMOKE_SHARE` is the fraction of that ring all the banks
 * together may hold. Six banks at 0.48 is 1 346 live against 1 010 before — 48 %
 * of the ring rather than 36 %, and 27.5 sprites/s a bank rather than 29.7, so
 * each bank is 7 % thinner and there are 50 % more of them.
 *
 * WHAT IS NOT MEASURED, and it is the honest half of this: whether 48 % of the
 * lit ring starves the blood, the impact puffs and the player's own can under a
 * heavy firefight. The ring does not fail loudly when it is over-subscribed, it
 * silently shortens everything else. @see `SMOKE_SHARE`.
 */
/** The disc a puff is born in. THIS is the number the eye reads. @see above. */
const SMOKE_FOOT = 5.4;
/**
 * ────────────────────────────────────────────────────────────────────────────
 * `growth` — THE FIELD THAT DECIDES BILLOW AGAINST HAZE
 * ────────────────────────────────────────────────────────────────────────────
 * `Ambience._scan` used to read SEVEN fields off `userData.fxSmoke` — radius,
 * rate, rise, dark, life, ember, haze — and drop this one, so a bank authored
 * here swelled by `addSource`'s default of 3.4 whatever it asked for. Measured:
 * `fx.ambience.emitters` came back with `growth: 3.4` on all four.
 *
 * That is not a cosmetic default. `_puff` sizes a sprite `radius` at birth and
 * `radius * growth` at death and `alphaCurve` is 1.7, so what the eye reads is
 * the YOUNG puff and a big `growth` spends the sprite's visible life inflating
 * it into something you can see a wall through. At 3.4 these banks were 18 m
 * ghosts: photographed at 12 m with all 168 sprites alive, the bank read as
 * FOG — an A/B against the same frame with the emitters suppressed is the only
 * way it showed up at all.
 *
 * So `_scan` now passes it, defaulted to the 3.4 it was already using so that
 * nothing which does not ask for it changes, and this asks for the number the
 * player's own smoke can was fixed to in 5b8d7b0 — 1.8, against the 5.85 that
 * produced 「実質３mくらいしかスモークでてない」. Same lesson, same direction: a
 * big footprint at a high rate with a SMALL growth, never the reverse.
 */
const SMOKE_GROWTH = 2.2;
const SMOKE_LIFE = 8.5;
/**
 * ────────────────────────────────────────────────────────────────────────────
 * HOW PALE, AND THIS IS THE ONE THAT DECIDED WHETHER IT WAS VISIBLE AT ALL
 * ────────────────────────────────────────────────────────────────────────────
 * The first cut used the smoke can's own 0.04, and the can is tuned on a town
 * at three in the afternoon. `_puff` writes `dark` STRAIGHT INTO the particle's
 * colour and these are LIT particles, so a value that reads as pale grey under
 * a sun reads as black against a night sky. 0.04 was invisible; 0.18 was chosen
 * to sit just over `crash.js`'s burning cells at 0.16, and photographed at 26 m
 * with every sprite alive it was STILL barely there — the bank only showed up
 * against a frame of the same view with the emitters suppressed.
 *
 * 0.62 is measured rather than reasoned. `_nfsmoketune.mjs` stands one camera
 * 26 m off a bank and photographs the same view while mutating the live
 * emitters, a full sprite life apart, so paleness is compared against nothing
 * else moving: 0.18 is a smudge, 0.45 is a bank you can see, 0.62 is one that
 * hides the foot of the ridge behind it. 0.75 is smoke you cannot see the fire
 * through at all, which is a different map.
 *
 * IT IS PALE FOR A REASON AND NOT BY ACCIDENT: this is what the eye does at
 * night. Smoke is only ever as bright as what lights it, and what lights this
 * is a wreck fire two metres under it and a burning ridge behind it, so the
 * near face of a real bank on this map IS the brightest thing on the ground.
 */
const SMOKE_DARK = 0.62;
/**
 * 0.5 against the can's 0.85. A burning wreck on a plain at 21:40 should lay
 * its smoke ACROSS the ground and downwind, not stand it up in a column — a
 * column breaks no sightline at all, which is the entire job here.
 */
const SMOKE_RISE = 0.5;
/**
 * Share of `fx.lit` all four banks together may hold. A can takes 25 % alone.
 *
 * 0.36 against the 0.24 this was authored at, which is 30 sprites a second a
 * bank instead of 20 — the step from "visible" to 「もくもく」 in the tune above,
 * and the last one that is affordable. At 70/s the ring SATURATES (2 805 of
 * 2 805 instances live, measured) and the blood, the impact puffs and the
 * player's own smoke are then competing for what four scenery plumes have
 * already taken. `fx.lit` is a ring and over-subscribing it does not fail
 * loudly — it silently shortens everything else.
 */
const SMOKE_SHARE = 0.48;

/**
 * The emission rate, resolved against the tier the game actually booted at.
 *
 * `fx` has not built its layers when `world` builds (its `deps` are render and
 * materials, and either may order before or after this), so the capacity is
 * recomputed from `q.particleBudget` with `FxSystem.init`'s own arithmetic
 * rather than read off `fx.lit` — the same numbers, available earlier. Getting
 * it wrong in the safe direction costs density; getting it wrong in the other
 * direction evicts the blood, the impact puffs and the player's own smoke.
 */
function smokeRate(ctx) {
  const budget = ctx?.config?.q?.particleBudget ?? 6000;
  const clampI = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
  const mote = clampI(budget * 0.06, 96, 600);
  const haze = clampI(budget * 0.04, 48, 320);
  const viewAdd = clampI(budget * 0.03, 48, 400);
  const viewLit = clampI(budget * 0.02, 32, 256);
  const rest = Math.max(256, budget - mote - haze - viewAdd - viewLit);
  const lit = Math.round(rest * 0.55);
  // …and a ceiling, so `ultra` does not spend 550 sprites a bank on scenery.
  return Math.min(38, (lit * SMOKE_SHARE) / SMOKE_BANKS / SMOKE_LIFE);
}

// ──────────────────────────────────────────────────────────── the crossings ──
/**
 * THE WALKS, and there is nothing else in this table.
 *
 * Each is a pair of pad ids out of `PADS` — so if a zone or a base ever moves,
 * the cover on the way to it moves with it and there is no second statement of
 * where anything is. `gap` is the metres between stations along the line and
 * `off` the lateral offsets it alternates through, in metres to the left and
 * right of the direction of travel.
 *
 * A STATION SITS ON THE LINE ON PURPOSE. An occluder 20 m to the side of a
 * crossing does not shorten one metre of that crossing's lane; the ray runs
 * straight down it. So the offsets are SMALL (4-11 m) and every piece is wide
 * enough that its mass straddles the centreline — which is also what makes it
 * cover you can put your back to rather than scenery you walk past.
 *
 * `weight` biases how much goes in: the six routes that measured worst on the
 * bare plain (BASE-N->A at 100 % exposed, BASE-N->E at 72 %, E->D at 67 %,
 * A->C at 53 %) get the shortest spacing.
 */
const CROSSINGS = [
  { a: 'BASE-N', b: 'A', gap: 26, off: [7, -6, 5, -9] },
  { a: 'BASE-N', b: 'E', gap: 27, off: [-6, 8, -9, 5] },
  { a: 'BASE-N', b: 'D', gap: 31, off: [8, -7, 6] },
  { a: 'BASE-S', b: 'B', gap: 29, off: [-7, 6, -5, 9] },
  { a: 'BASE-S', b: 'C', gap: 27, off: [6, -8, 9, -5] },
  { a: 'BASE-S', b: 'D', gap: 33, off: [-8, 7, -6] },
  { a: 'A', b: 'C', gap: 28, off: [7, -7, 10, -4] },
  { a: 'B', b: 'E', gap: 28, off: [-7, 7, -10, 4] },
  { a: 'E', b: 'D', gap: 27, off: [6, -9, 8, -5] },
  { a: 'A', b: 'D', gap: 30, off: [-6, 9, -8, 5] },
  { a: 'B', b: 'D', gap: 31, off: [7, -8, 5] },
  { a: 'C', b: 'D', gap: 31, off: [-7, 8, -5] },
];

/**
 * What goes at each station, in order, cycled per crossing with the crossing's
 * index as the phase — so no two neighbouring walks read as the same walk.
 *
 * The mix is deliberate and it is a mix of HEIGHTS rather than of shapes: a
 * berm at 2.2 m and a wreck at 2.4 m are both full cover standing, an
 * emplacement at 1.35 m is cover you fire OVER standing and hide behind
 * crouched, and a ruin is the only thing on the list you can be INSIDE. A
 * crossing made of one of them is a corridor; a crossing made of all four is
 * ground you can fight across.
 */
const KINDS = ['wreck', 'berm', 'emplace', 'ruin', 'wreck', 'emplace', 'berm', 'wreck'];

/**
 * Half-extent each kind claims ACROSS the walk (`KIND_R`, which is also the
 * separation radius) and ALONG it (`KIND_W`). A berm is 19 m of wall and 5 m of
 * thickness; a ruin is square-ish; a wreck cluster is two hulls abreast.
 */
const KIND_R = { wreck: 9.0, berm: 9.5, emplace: 4.5, ruin: 8.0 };
const KIND_W = { wreck: 4.5, berm: 3.0, emplace: 3.0, ruin: 7.0 };

/**
 * ────────────────────────────────────────────────────────────────────────────
 * WHERE THE MASS ACTUALLY IS — which is NOT `KIND_R`, and the difference cost a
 * whole crossing
 * ────────────────────────────────────────────────────────────────────────────
 * `KIND_R` is the SEPARATION radius: how far apart two stations are kept so the
 * map does not read as a row of the same object. It is deliberately generous.
 * The mass inside it is much smaller — a wreck site is two hulls about 3.5 m to
 * a side (`wreck` hands back r 4.2), a berm is its own 12-19 m of length.
 *
 * Using the separation radius to decide whether a piece BLOCKS THE LANE credits
 * a burnt lorry standing 8.5 m off the centreline with covering it. Measured on
 * BASE-N -> E: exactly that happened, the route was booked as having a lane
 * blocker at 111 m, both gap passes therefore left it alone, and the probe
 * walked the whole crossing with the forward ray dying at 138 m — 87 % exposed
 * with a station on the route that has no mass anywhere near it.
 *
 * So the two questions are asked with two numbers. Separation keeps `KIND_R`;
 * "is it on the lane" and "would these two interpenetrate" use this one.
 */
const KIND_MASS = { wreck: 4.0, berm: 7.5, emplace: 2.5, ruin: 6.0 };

// ─────────────────────────────────────────────────────────────── the placer ──
/**
 * Walk each crossing and hand back the stations that survive every keep-out.
 *
 * `isOpen` IS `plainsOpen` — the level's own published test, which already
 * refuses the mountain face, the control tower, the fortress and all three
 * trench corridors, inflated by whatever margin it is handed. Consulting it
 * rather than re-deriving any of that is the whole reason it is exported: a
 * revetment built across NORDGRABEN is the same bug as a stall pitched in the
 * cathedral.
 */
function stations(rng, pads, isOpen) {
  const by = new Map(pads.map((p) => [p.id, p]));
  const placed = [];
  const out = [];

  /**
   * Clear of every capture circle and every base — the objective is not cover,
   * and a spawn cluster with a burnt lorry in it is a spawn cluster you die in.
   * The margin is on the PIECE, not on the point: `r` is its half-extent, so
   * nothing crosses the ring at all rather than nothing being centred on it.
   */
  const offPads = (x, z, r) => {
    for (const p of pads) {
      if (p.id === 'TOWER' || p.id === 'FORT') continue; // `isOpen` owns those
      const keep = (p.id.startsWith('BASE') ? p.r0 + 7 : p.r0 + 4) + r;
      if ((x - p.x) ** 2 + (z - p.z) ** 2 < keep * keep) return false;
    }
    return true;
  };

  /**
   * DOES THE WHOLE PIECE FIT, not just the point at the middle of it.
   *
   * The first cut of this tested the CENTRE against `isOpen` inflated by the
   * piece's radius, which is the same class of mistake as `interiors.js`
   * testing a prop's centre against a doorway circle: a 19 m berm laid ACROSS a
   * crossing is 19 m of extent on one axis and 5 on the other, and a single
   * inflated point either refuses ground it fits on or accepts ground it does
   * not. So the piece's own long axis is sampled end to end.
   */
  const fits = (x, z, halfLen, halfW, ax, az) => {
    for (let i = -2; i <= 2; i++) {
      const u = (i / 2) * halfLen;
      if (!isOpen(x + ax * u, z + az * u, halfW + 1.5)) return false;
    }
    return true;
  };

  /**
   * The longest stretch of a walk that may stand with no lane-blocking mass on
   * it. It is the gate for BOTH passes below, so a change to it moves the whole
   * map's spacing rather than one loop's.
   */
  const MAX_GAP = 46;

  /** Each crossing's geometry and what stood up on it. @see the edge pass. */
  const routes = [];

  for (let ci = 0; ci < CROSSINGS.length; ci++) {
    const c = CROSSINGS[ci];
    const A0 = by.get(c.a); const B0 = by.get(c.b);
    if (!A0 || !B0) continue;
    const dx = B0.x - A0.x, dz = B0.z - A0.z;
    const L = Math.hypot(dx, dz);
    const tx = dx / L, tz = dz / L;
    const nx = tz, nz = -tx;         // left of the direction of travel
    /**
     * EVERY PIECE IS LAID ACROSS THE WALK, and this is the correction that made
     * the difference between the first cut and this one. Measured: 33 stations
     * placed, `covered` (something within 8 m) up from 28 % to 47 % — and the
     * LANE, which is what the complaint is about, moved by four metres. The
     * pieces were parallel to the route. A berm lying along a crossing is a
     * handrail; the same berm turned ninety degrees is a wall you have to walk
     * round, and the ray down the middle of the route stops at it.
     */
    const yaw = Math.atan2(tx, tz);

    /**
     * Try to stand one piece near `s`. THE SEARCH SLIDES ALONG THE WALK BEFORE
     * IT SLIDES OFF IT, and that order is the difference between cover and
     * decoration: a berm 22 m to the side of a 190 m lane changes `covered` and
     * does not change `lane` by one metre, because the man walking the middle
     * of the route is still in the open. Only when nothing on the line will fit
     * — which on BASE-N -> A is most of its length, because NORDGRABEN is dug
     * within four metres of that walk and `isOpen` refuses the whole corridor —
     * does it give up and take the flank.
     *
     * AND ON ONE WALK THE FLANK IS THE RIGHT ANSWER, WHICH IS WORTH SAYING SO
     * THAT NOBODY "FIXES" IT. BASE-N -> E measures ~70 % exposed after
     * everything in this file has run and it is the last route that does. That
     * is not a hole in the placement. `_nflane.mjs` on that walk: `isOpen`
     * refuses the centreline from 30 m to 108 m, and 6-10 m to its left is a
     * cut 1.6-1.7 m deep running 36 m to 96 m — a covered route beside 60 of
     * the 78 refused metres, which is what a trench dug ALONG a walk is.
     * `_plaincross.mjs` measures the straight line between the pads, so on that
     * one route it is measuring the surface beside the trench rather than the
     * walk. From inside the cut the same crossing is 71 m of lane and a 12 m
     * run.
     *
     * Both tempting answers are wrong: building a revetment across NORDGRABEN,
     * and widening the search until a berm lands twenty metres off the route so
     * `covered` improves while `lane` does not move. What happens instead is
     * that the lane is bounded at the first open ground on each side — @see the
     * edge pass — and the corridor is left to the trench.
     */
    const tryAt = (s, kind, slack) => {
      const r = KIND_R[kind];
      for (let attempt = 0; attempt < 34; attempt++) {
        const wide = attempt < 20 ? 1 : attempt < 27 ? 1.9 : 2.8;
        const o = c.off[attempt % c.off.length] * rng.range(0.8, 1.2) * wide;
        const along = s + (attempt < 3 ? 0 : rng.range(-slack, slack));
        const x = A0.x + tx * along + nx * o;
        const z = A0.z + tz * along + nz * o;
        if (along < A0.r0 + 8 || along > L - B0.r0 - 8) continue;
        if (!offPads(x, z, r)) continue;
        // the long axis runs across the walk, so it is sampled along `n`
        if (!fits(x, z, r, KIND_W[kind], nx, nz)) continue;
        let clash = false;
        for (const p of placed) {
          const need = p.r + r + 4;
          if ((x - p.x) ** 2 + (z - p.z) ** 2 < need * need) { clash = true; break; }
        }
        if (clash) continue;
        const st = {
          x, z, r, kind, mr: KIND_MASS[kind], yaw: yaw + rng.range(-0.32, 0.32), route: ci,
          /** Along-route coordinate, and whether the MASS covers the middle. */
          s: along, onLane: Math.abs(o) - KIND_MASS[kind] < 1.5,
        };
        placed.push(st); out.push(st);
        return st;
      }
      return null;
    };

    const mine = [];
    let k = 0;
    for (let s = A0.r0 + 10; s < L - B0.r0 - 10; s += c.gap) {
      const st = tryAt(s, KINDS[(k + ci) % KINDS.length], 10);
      if (st) mine.push(st);
      k++;
    }

    /**
     * ────────────────────────────────────────────────────────────────────
     * THE GAP PASS — the one that actually moves the number
     * ────────────────────────────────────────────────────────────────────
     * The loop above places on a fixed rhythm and drops whatever will not fit,
     * so a crossing that loses two neighbouring stations to a trench, a pad or
     * another crossing's claim ends up with sixty metres of nothing in the
     * middle of it and a run of exposure exactly that long. `run` is the
     * headline number and it is a MAXIMUM, so one gap ruins a route however
     * good the rest of it is.
     *
     * So: sort what stood up, and wherever two consecutive LANE-BLOCKING pieces
     * are more than `MAX_GAP` apart — including the stretch from each end pad —
     * put one more in between and let it search the whole gap. An emplacement
     * does not count as a blocker: it is 1.4 m and a standing eye is 1.62, so
     * you see straight over it, which is the entire point of it.
     */
    for (let pass = 0; pass < 3; pass++) {
      const line = mine.filter((m) => m.onLane && m.kind !== 'emplace')
        .map((m) => m.s).sort((a, b) => a - b);
      const edges = [A0.r0 + 6, ...line, L - B0.r0 - 6];
      let added = false;
      for (let i = 1; i < edges.length; i++) {
        const gap = edges[i] - edges[i - 1];
        if (gap <= MAX_GAP) continue;
        const st = tryAt((edges[i] + edges[i - 1]) / 2,
          rng.float() < 0.55 ? 'wreck' : 'berm', gap * 0.34);
        if (st) { mine.push(st); added = true; }
      }
      if (!added) break;
    }
    routes.push({ ci, A0, B0, L, tx, tz, nx, nz, yaw, mine });
  }

  /**
   * ──────────────────────────────────────────────────────────────────────────
   * THE EDGE PASS — bound the lane where the MIDDLE of it is somebody else's
   * ──────────────────────────────────────────────────────────────────────────
   * The gap pass above searches outwards FROM THE MIDDLE of a gap, so on a walk
   * whose middle cannot be built on it finds nothing on the line, slides off,
   * and puts a berm twenty metres to the side — which moves `covered` and does
   * not move `lane` by one metre. That is not a hypothetical: BASE-N -> E
   * measured 87 % exposed with an 84 m run AFTER the whole of this file had run,
   * and the 84 m is NORDGRABEN. `isOpen` refuses the centreline of that walk
   * from 30 m to 108 m because the trench is dug along it, the trench IS the
   * covered route there, and this file may no more build across it than it may
   * pitch a stall in the cathedral.
   *
   * What it CAN do is stop the lane at the first open ground on each side. The
   * ray backwards stops at the pad, so on a 156 m walk ONE piece standing on the
   * centreline at 114 m takes every sample on it from a 138 m lane to a 114 m
   * one — the man crossing the corridor is no longer in something open from both
   * ends at once. So: walk IN from each edge of every unfillable gap, three
   * metres at a time, and take the first place a piece will stand.
   *
   * THE OFFSETS ARE TINY ON PURPOSE — ±6 m against the main search's ±25. A
   * piece that does not straddle the centreline fails the only test this pass
   * exists to pass, so it is better to place nothing than to place it wide.
   */
  const MAX_EDGE = 3;
  for (const R of routes) {
    /**
     * Scan OUT from the middle of the gap towards `to`, and take the first
     * spot that will stand — so the piece lands as DEEP into the unbuildable
     * stretch as the ground allows rather than as close to the edge as
     * possible. It is the same number of pieces and a much shorter lane: a stop
     * at 114 m bounds every sample behind it at 114 m, one at 130 m bounds them
     * at 130, and 120 is the line between covered and exposed.
     */
    const scan = (mid, to) => {
      const kind = rng.float() < 0.5 ? 'wreck' : 'berm';
      const r = KIND_R[kind];
      const mr = KIND_MASS[kind];
      const dir = Math.sign(to - mid) || 1;
      for (let d = 0; d <= Math.abs(to - mid); d += 3) {
        const along = mid + dir * d;
        if (along < R.A0.r0 + 8 || along > R.L - R.B0.r0 - 8) continue;
        for (const o of [0, 3.5, -3.5, 6, -6]) {
          const x = R.A0.x + R.tx * along + R.nx * o;
          const z = R.A0.z + R.tz * along + R.nz * o;
          if (!offPads(x, z, r)) continue;
          if (!fits(x, z, r, KIND_W[kind], R.nx, R.nz)) continue;
          /**
           * CLASHES ARE JUDGED ON MASS HERE, not on the separation radius —
           * @see `KIND_MASS`. This pass is deliberately standing a stop NEXT to
           * whatever is already on the walk, so the only thing it has to be
           * sure of is that the two do not interpenetrate. Judged on `KIND_R`
           * the one spot on BASE-N -> E that bounds the lane is refused for
           * being 18 m from a lorry that is 4 m across.
           */
          let clash = false;
          for (const p of placed) {
            const need = (p.mr ?? p.r) + mr + 4;
            if ((x - p.x) ** 2 + (z - p.z) ** 2 < need * need) { clash = true; break; }
          }
          if (clash) continue;
          const st = {
            x, z, r, mr, kind, yaw: R.yaw + rng.range(-0.24, 0.24), route: R.ci,
            s: along, onLane: Math.abs(o) - mr < 1.5, edge: true,
          };
          placed.push(st); out.push(st); R.mine.push(st);
          return st;
        }
      }
      return null;
    };

    let budget = MAX_EDGE;
    for (let pass = 0; pass < 3 && budget > 0; pass++) {
      const line = R.mine.filter((m) => m.onLane && m.kind !== 'emplace')
        .map((m) => m.s).sort((a, b) => a - b);
      const edges = [R.A0.r0 + 6, ...line, R.L - R.B0.r0 - 6];
      let added = false;
      for (let i = 1; i < edges.length && budget > 0; i++) {
        const lo = edges[i - 1], hi = edges[i];
        if (hi - lo <= MAX_GAP) continue;
        // out towards the far edge, then out towards the near one — both ends
        // of the stretch get a stop, so the lane is bounded whichever way he
        // walks it, and each stop is as deep in as the ground allows
        const mid = (lo + hi) / 2;
        for (const to of [hi, lo]) {
          if (budget <= 0) break;
          if (scan(mid, to)) { added = true; budget--; }
        }
      }
      if (!added) break;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────── pieces ──
/**
 * THE FALLEN BUILDING. Single storey, no roof, no floor slab, no deck — @see
 * note 1. It is a rectangle of broken wall standing straight on the plain, and
 * the plain inside it is the same nav cells as the plain outside it.
 *
 * WHAT MAKES IT COVER RATHER THAN A SHAPE is the height profile: every panel
 * carries its own top, drawn from a damage table that runs from a corner still
 * standing at 4 m down to a course of footings you can see clean over. A man in
 * here can be behind 3.4 m of wall on one bearing, fire over 1.15 m of it on
 * another, and be seen through the breach on a third — which is the difference
 * between a building and a box.
 */
function ruin(A, rng, gy, cx, cz, yaw) {
  const w = rng.range(11, 15);         // along local x
  const d = rng.range(8, 11.5);        // along local z
  const t = rng.range(0.44, 0.58);
  const y0 = gy(cx, cz);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  /** local (x, z) -> level (x, z) */
  const P = (lx, lz) => [cx + c * lx + s * lz, cz - s * lx + c * lz];
  const key = rng.pick(['plaster_sand', 'brick', 'concrete', 'plaster_cream']);
  const inner = rng.float() < 0.5 ? 'brick_fine' : 'concrete_dark';
  /** Openings a man walks through — nothing may be dropped inside one. */
  const clear = [];

  /**
   * The four sides, each cut into panels. `prof` is the top of each panel over
   * the footing: 0 is a gap you walk through, and a gap is what a shell did.
   */
  const SIDES = [
    { ax: -w / 2, az: -d / 2, bx: w / 2, bz: -d / 2 },
    { ax: w / 2, az: -d / 2, bx: w / 2, bz: d / 2 },
    { ax: w / 2, az: d / 2, bx: -w / 2, bz: d / 2 },
    { ax: -w / 2, az: d / 2, bx: -w / 2, bz: -d / 2 },
  ];
  /** One side is mostly gone. Which one is a draw, so no two ruins face alike. */
  const blown = rng.int(0, 3);

  for (let i = 0; i < 4; i++) {
    const S = SIDES[i];
    const len = Math.hypot(S.bx - S.ax, S.bz - S.az);
    const n = Math.max(3, Math.round(len / 2.6));
    for (let j = 0; j < n; j++) {
      const t0 = j / n, t1 = (j + 1) / n;
      const lax = S.ax + (S.bx - S.ax) * t0, laz = S.az + (S.bz - S.az) * t0;
      const lbx = S.ax + (S.bx - S.ax) * t1, lbz = S.az + (S.bz - S.az) * t1;
      // The damage profile. A corner panel is likelier to still be standing —
      // it is braced on two axes, which is why real ruins are mostly corners.
      const corner = j === 0 || j === n - 1;
      let h;
      const roll = rng.float();
      if (i === blown) h = roll < 0.55 ? 0 : rng.range(0.55, 1.35);
      else if (corner) h = roll < 0.12 ? 0 : rng.range(2.4, 4.1);
      else if (roll < 0.17) h = 0;                       // a breach
      else if (roll < 0.42) h = rng.range(0.95, 1.5);    // fire over it
      else if (roll < 0.72) h = rng.range(1.8, 2.6);     // full cover standing
      else h = rng.range(2.9, 3.9);
      const [ax, az] = P(lax, laz);
      const [bx, bz] = P(lbx, lbz);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const base = gy(mx, mz);
      if (h <= 0.01) {
        // A GAP IS A DOOR. It gets a footing course you step over (0.18, well
        // under the 0.42 step) and a keep-out so nothing is ever put in it.
        A.add(inner, BOX_FINE(A), LL(IDENT, mx, base + 0.09, mz, Math.atan2(bx - ax, bz - az), t + 0.2, 0.18, len / n + 0.04),
          { masks: [0.6, 0.55, 0.5] });
        clear.push({ x: mx, z: mz, r: len / n / 2 + 1.1 });
        continue;
      }
      // The mass, in courses, battered, with per-course jitter. `coping:false`:
      // a smooth 0.5 m cap 3 m up is a strip of nav cells nobody can reach.
      wallRun(A, rng, key, ax, az, bx, bz, {
        y0: base - 0.35, y1: base + h, t, batter: 0.05, course: rng.range(0.5, 0.72),
        coping: false, overrun: 0.05,
      });
      /**
       * THE WALL, AND ITS TOP IS A RIDGE. The note at the head of this file has
       * always said a wall top here is not a ledge — "a continuous flat 0.5 m
       * ledge 3 m up is a strip of cells the ray finds at 3 m and the ground
       * beside them at 0 — an island, by construction" — and it was only ever
       * true of the DRAWN cap. `wallRun` adds no collision at all; this box was
       * the whole of the wall as far as `NavGrid` is concerned, and its top was
       * flat. Measured: 229 stranded cells over 7 ruins.
       *
       * So the box stops `capH` short and a prism finishes it, which leaves the
       * total height exactly `h` — the cover a man fires over is unchanged to
       * the centimetre, and there is no longer a floor on top of it.
       */
      const panelYaw = Math.atan2(bx - ax, bz - az);
      const cap = ridgePrism((t + 0.04) / 2, len / n + 0.05);
      const capH = Math.min(cap.userData.capH, h * 0.5);
      A.box('concrete', mx, base + (h - capH - 0.35) / 2, mz, t + 0.04, h - capH + 0.35,
        len / n + 0.05, panelYaw);
      A.collideGeo('concrete', cap, newTrs(mx, base + h - cap.userData.capH, mz, panelYaw));
      // …and a broken cap: three or four blocks with gaps, which is what the
      // top course of a shelled wall is and is also not a ledge.
      const caps = Math.max(2, Math.round((len / n) / 0.8));
      for (let q = 0; q < caps; q++) {
        if (rng.float() < 0.34) continue;
        const u = (q + 0.5) / caps;
        A.add(inner, BOX(A), LL(IDENT,
          ax + (bx - ax) * u, base + h + rng.range(0.02, 0.16), az + (bz - az) * u,
          Math.atan2(bx - ax, bz - az) + rng.range(-0.12, 0.12),
          t * rng.range(0.7, 1.0), rng.range(0.12, 0.3), (len / n) / caps * rng.range(0.6, 0.95)),
          { masks: [0.75, 0.5, 0.25] });
      }
      // A window head where the wall is tall enough to have had one.
      if (h > 2.3 && rng.float() < 0.45) {
        A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, mx, base + rng.range(1.9, 2.2), mz,
          Math.atan2(bx - ax, bz - az), t + 0.12, 0.16, rng.range(0.9, 1.5)), { masks: [0.8, 0.4, 0.1] });
      }
    }
  }

  /**
   * ONE INTERNAL CROSS WALL, with a doorway in it. It is what turns the inside
   * from a pen into two positions, and it is the reason a man clearing this can
   * be surprised in it.
   */
  {
    const at = rng.range(-0.2, 0.2) * w;
    const hgt = rng.range(1.25, 2.35);
    const gapAt = rng.range(-0.25, 0.25) * d;
    for (const [z0, z1] of [[-d / 2 + t, gapAt - 1.25], [gapAt + 1.25, d / 2 - t]]) {
      if (z1 - z0 < 0.9) continue;
      const [ax, az] = P(at, z0); const [bx, bz] = P(at, z1);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const base = gy(mx, mz);
      const len = Math.hypot(bx - ax, bz - az);
      wallRun(A, rng, inner, ax, az, bx, bz, {
        y0: base - 0.3, y1: base + hgt, t: 0.36, batter: 0.03, course: 0.55, coping: false,
      });
      A.box('concrete', mx, base + (hgt - 0.3) / 2, mz, 0.4, hgt + 0.3, len, Math.atan2(bx - ax, bz - az));
    }
    const [gx, gz] = P(at, gapAt);
    clear.push({ x: gx, z: gz, r: 2.0 });
  }

  /**
   * THE COLLAPSE. A relaxed field over the blown corner and spilling outside
   * it — @see note 2. `drawDebris` lays one low collision box per cell so what
   * a man walks on is the RELAXED surface and not the top of whichever lump of
   * masonry he happens to be standing on.
   */
  {
    const [rx, rz] = P(rng.range(-0.3, 0.3) * w, rng.range(-0.3, 0.3) * d);
    const field = debrisField(rng, rx, rz, rng.range(5.5, 8), rng.range(0.85, 1.35), RUBBLE_CELL);
    drawDebris(A, rng, field, gy, { key, key2: 'concrete_dark', surface: 'concrete' });
  }

  /**
   * THE ROOF, WHERE IT WENT. Two or three slabs leaning off the inside of a
   * wall — AUTHORED OVER 52°, past `NavGrid`'s 46 ° limit, so the cells beneath
   * are refused rather than turned into a ramp the bots try to walk up.
   */
  for (let i = 0, n = 2 + (rng.float() < 0.5 ? 1 : 0); i < n; i++) {
    const [px, pz] = P(rng.range(-0.35, 0.35) * w, rng.range(-0.35, 0.35) * d);
    const base = gy(px, pz);
    const len = rng.range(2.6, 4.2);
    const pitch = rng.range(0.95, 1.28); // 54-73 degrees
    const yw = rng.float() * 6.28;
    const cy = base + Math.sin(pitch) * len / 2;
    A.add('concrete', BOX(A), LL(IDENT, px, cy, pz, yw, rng.range(1.6, 2.8), 0.24, len, -pitch),
      { masks: [0.55, 0.45, 0.3] });
    A.box('concrete', px, cy, pz, rng.range(1.6, 2.8), 0.24, len, yw, -pitch);
    // the reinforcement torn out of it
    for (let k = 0; k < 3; k++) {
      A.add('metal_rust', BOX_THIN(A), LL(IDENT,
        px + rng.range(-1.2, 1.2), base + Math.sin(pitch) * len + rng.range(-0.3, 0.5), pz + rng.range(-1.2, 1.2),
        rng.float() * 6.28, 0.03, rng.range(0.5, 1.4), 0.03, rng.range(-0.9, 0.9), rng.range(-0.9, 0.9)),
        { masks: [0.95, 0.7, 0] });
    }
  }

  /** Fallen purlins, lying where the roof dropped them. Low, and crossable. */
  for (let i = 0; i < 2; i++) {
    const [ax, az] = P(rng.range(-0.4, 0.4) * w, -d / 2 + rng.range(0.4, 1.6));
    const [bx, bz] = P(rng.range(-0.4, 0.4) * w, d / 2 - rng.range(0.4, 1.6));
    fallenMember(A, rng, 'wood_prop_dark', ax, gy(ax, az) + 0.2, az, bx, gy(bx, bz) + 0.36, bz, 0.19);
  }

  /** What is left inside, kept clear of every opening. @see note 3. */
  const stores = ['crate_a', 'crate_c', 'barrel_rust', 'barrel_wood', 'block_big', 'pallet', 'tyre'];
  for (let i = 0; i < 9; i++) {
    const [px, pz] = P(rng.range(-0.42, 0.42) * w, rng.range(-0.42, 0.42) * d);
    const id = rng.pick(stores);
    const pr = A.footprintR ? A.footprintR(id, 1.15) : 0.6;
    let blocked = false;
    for (const cl of clear) {
      // THE PROP HAS EXTENT. `interiors.js` tested the centre and put a cabinet
      // half in a doorway; this is the same test with the radius in it.
      if ((px - cl.x) ** 2 + (pz - cl.z) ** 2 < (cl.r + pr) ** 2) { blocked = true; break; }
    }
    if (blocked) continue;
    A.put(id, px, gy(px, pz) - 0.02, pz, rng.float() * 6.28, rng.range(0.9, 1.15));
  }

  /** Scorch and blown dust round the bunker — deleted. @see `noSheet`. */
  for (let i = 0; i < 14; i++) {
    const [px, pz] = P(rng.range(-0.85, 0.85) * w, rng.range(-0.85, 0.85) * d);
    noSheet(rng.float() < 0.5 ? 'road_dust' : 'steppe_bare',
      patchGeometry(rng, rng.range(0.7, 2.6), { lobes: 11, wobble: 0.6 }),
      LL(IDENT, px, gy(px, pz) + 0.03, pz, rng.float() * 6.28, 1, 1, rng.range(0.6, 1.3)),
      { masks: [0.5, rng.range(0.4, 0.9), 0.4] });
  }
  return { x: cx, z: cz, r: Math.max(w, d) / 2 };
}

// ────────────────────────────────────────────────────────────────── vehicles ──
/**
 * A BURNT-OUT HULL. Four of them, and every one is capped at `TALL` — @see
 * note 4 — which is still 0.93 m over a standing eye.
 *
 * The heights are the point of the shape rather than the shape being the point:
 * a chassis at 1.05 m is what you go prone or crouch behind, a bed side at
 * 1.7-2.0 is what you fight from at a crouched eye (1.15) and are hidden
 * behind, and a cab or an upturned floor pan at 2.4 is full cover standing.
 * Every wreck below has all three on it somewhere, so which stance you take at
 * one is a decision and not a fact about the prop.
 */
function wreck(A, rng, gy, cx, cz, yaw, variant) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx, lz) => [cx + c * lx + s * lz, cz - s * lx + c * lz];
  /**
   * A HULL IS RIGID AND THE PLAIN IS NOT. Taking `gy` at the centre stands a
   * seven-metre wreck on one point of a swell that runs to 0.37 of gradient, so
   * one axle floats and the other is buried. The LOWEST ground under its own
   * footprint, less a few centimetres of settle, puts every wheel on or in the
   * ground and none of them in the air — which is the side of the error
   * `_floatcheck.mjs` does not fail and the player does not see.
   */
  let g = Infinity;
  for (const [lx, lz] of [[0, 0], [-1.4, -3.4], [1.4, -3.4], [-1.4, 3.4], [1.4, 3.4]]) {
    const [px, pz] = P(lx, lz);
    g = Math.min(g, gy(px, pz));
  }
  g -= 0.06;
  const burnt = { masks: [0.95, 0.8, 0.15] };
  const box = BOX(A);
  /** Put a box in the wreck's own frame. `ry` is extra yaw, `rz` a list. */
  const put = (key, lx, ly, lz, sx, sy, sz, ry = 0, rx = 0, rz = 0, m = burnt, solid = true) => {
    const [x, z] = P(lx, lz);
    A.add(key, box, LL(IDENT, x, g + ly, z, yaw + ry, sx, sy, sz, rx, rz), { masks: m });
    if (solid) A.box(A.surfaceOf(key), x, g + ly, z, sx, sy, sz, yaw + ry, rx, rz);
  };
  /**
   * A `put` whose TOP would otherwise be a floor — a bed, a cab roof, an engine
   * deck, the shell of a tanker. Identical drawing, crumpled collision.
   * @see `deckCrown`. Only surfaces wide enough for a 0.8 m nav cell to land on
   * are worth crowning, and only where nothing else is stacked over them.
   */
  const deck = (key, lx, ly, lz, sx, sy, sz, ry = 0, rx = 0, rz = 0, m = burnt) => {
    put(key, lx, ly, lz, sx, sy, sz, ry, rx, rz, m);
    const [x, z] = P(lx, lz);
    deckCrown(A, A.surfaceOf(key), x, g + ly + sy / 2, z, sx, sz, yaw + ry);
  };
  const wheel = (lx, lz, r, lean = 0) => {
    const [x, z] = P(lx, lz);
    A.put('tyre', x, g + r * 0.5, z, yaw + Math.PI / 2 + lean, r / 0.33, null, 1.55, 0);
  };

  if (variant === 0) {
    /* ---- a lorry, upright, burnt to the frame -------------------------- */
    const L = rng.range(6.2, 7.4);
    put('metal_rust', 0, 0.72, 0, 2.25, 0.42, L);                       // chassis
    deck('metal_dark', 0, 1.05, -L / 2 + 1.15, 2.2, 0.62, 2.3);         // engine bay
    // the cab, crushed to one side
    deck('metal_rust', 0.12, 1.85, -L / 2 + 1.6, 2.05, 1.35, 2.05, 0.05, 0, rng.range(0.08, 0.2));
    // the bed: a floor, four ribs, one side standing and one collapsed out
    deck('wood_prop_dark', 0, 1.0, L / 2 - 2.2, 2.15, 0.16, L - 3.1, 0, 0, 0, { masks: [0.85, 0.7, 0.3] });
    for (let i = 0; i < 4; i++) {
      const lz = L / 2 - 3.6 + i * ((L - 3.4) / 4);
      put('metal_rust', 0, 1.55, lz, 2.25, 0.1, 0.13, 0, 0, 0, burnt, false);
    }
    put('corrugated', 1.02, 1.68, L / 2 - 2.2, 0.1, 1.32, L - 3.3, 0, 0, rng.range(-0.09, 0.09));
    // the far side, off its hinges and lying out
    {
      const [x, z] = P(-1.9, L / 2 - 2.4);
      A.add('corrugated', box, LL(IDENT, x, g + 0.36, z, yaw + rng.range(-0.2, 0.2), 1.5, 0.1, L - 3.4, 0, 0.22),
        { masks: [0.9, 0.8, 0.4] });
    }
    for (const [lx, lz] of [[-1.05, -L / 2 + 1.5], [1.05, -L / 2 + 1.5], [-1.05, L / 2 - 1.6], [1.05, L / 2 - 1.6]]) {
      if (rng.float() < 0.22) continue;
      wheel(lx, lz, 0.52, rng.range(-0.1, 0.1));
    }
  } else if (variant === 1) {
    /* ---- rolled onto its side: a 2.4 m slab of floor pan -------------- */
    const L = rng.range(6.0, 7.2);
    const roll = rng.range(1.36, 1.62); // 78-93 degrees
    put('metal_rust', 0, 1.2, 0, 0.5, 2.4, L, 0, 0, 0, burnt);
    put('metal_dark', -0.42, 1.55, 0, 0.42, 1.55, L - 1.2, 0, 0, rng.range(-0.1, 0.1));
    deck('metal_rust', 0.3, 2.05, -L / 2 + 1.5, 1.5, 0.5, 2.0, 0, 0, -roll * 0.18);
    deck('metal_dark', 0, 0.34, 1.2, 2.3, 0.5, 2.6, rng.range(-0.2, 0.2), 0, rng.range(-0.14, 0.14));
    // wheels in the air, on the axles that are now horizontal
    for (const lz of [-L / 2 + 1.6, L / 2 - 1.8]) {
      const [x, z] = P(0.75, lz);
      A.put('tyre', x, g + 1.9, z, yaw, 1.6, null, 0, 1.5);
      if (rng.float() < 0.5) {
        const [x2, z2] = P(rng.range(-3.4, -1.8), lz + rng.range(-1, 1));
        A.put('tyre', x2, gy(x2, z2) + 0.1, z2, rng.float() * 6.28, 1.5);
      }
    }
  } else if (variant === 2) {
    /* ---- a ruptured tanker on a dropped trailer ----------------------- */
    const L = rng.range(6.6, 8.0);
    put('metal_rust', 0, 0.62, 0, 2.15, 0.34, L);
    // `tubeY` stands the cylinder on y=0, so it is re-centred before being
    // tipped onto its side — otherwise `rx` swings it a whole barrel off its
    // own chassis and the tanker floats beside the trailer.
    const tank = tubeY(1.0, L - 1.6, { radial: 14 });
    tank.translate(0, -(L - 1.6) / 2, 0);
    const [tx, tz] = P(0, 0.2);
    A.addOnce('steel', tank, LL(IDENT, tx, g + 1.5, tz, yaw, 1, 1, 1, Math.PI / 2), { masks: [0.9, 0.75, 0.2] });
    /**
     * The barrel is DRAWN round and COLLIDES as a box, so its top is a 2 m wide
     * flat deck 2.5 m up — the tallest island a wreck makes here. The box stays
     * (a cylinder BVH for a prop this size is not worth it) and the crown goes
     * over it, which also happens to be the shape the drawn barrel already has.
     */
    A.box('metal', tx, g + 1.5, tz, 2.0, 2.0, L - 1.6, yaw);
    deckCrown(A, 'metal', tx, g + 2.5, tz, 2.0, L - 1.6, yaw);
    // the split down the top, and the shell that made it
    put('metal_dark', 0.1, 2.42, rng.range(-1.5, 1.5), 1.35, 0.22, rng.range(1.8, 3.0), rng.range(-0.15, 0.15), 0, 0.3);
    put('metal_rust', 0, 1.35, -L / 2 + 0.5, 1.9, 1.5, 0.5, 0, 0, 0, burnt);
    for (const [lx, lz] of [[-1.0, L / 2 - 1.4], [1.0, L / 2 - 1.4], [-1.0, L / 2 - 2.7], [1.0, L / 2 - 2.7]]) {
      if (rng.float() < 0.18) continue;
      wheel(lx, lz, 0.48);
    }
    // the landing legs, one of them folded
    for (const lx of [-0.9, 0.9]) put('metal_dark', lx, 0.3, -L / 2 + 1.4, 0.16, 0.62, 0.16, 0, 0, rng.range(0, 0.5));
  } else {
    /* ---- a tracked hull, turret gone, one track unspooled -------------- */
    const L = rng.range(6.2, 7.0);
    put('metal_dark', 0, 0.62, 0, 3.0, 0.9, L, 0, 0, rng.range(-0.05, 0.05));
    deck('metal_rust', 0, 1.32, rng.range(-0.4, 0.4), 2.55, 0.62, L - 1.4, 0, 0, rng.range(-0.05, 0.05));
    // the glacis, and the ring where the turret was
    put('metal_dark', 0, 1.42, -L / 2 + 1.1, 2.5, 0.5, 1.9, 0, 0.32, 0);
    deck('metal_rust', 0, 1.78, 0.4, 1.85, 0.34, 1.85, rng.range(-0.3, 0.3));
    deck('metal_dark', rng.range(-0.3, 0.3), 2.05, 0.4, 1.25, 0.36, 1.25, rng.range(-0.4, 0.4), 0, rng.range(-0.2, 0.2));
    // road wheels down both sides
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const [x, z] = P(side * 1.35, -L / 2 + 0.9 + i * ((L - 1.8) / 4));
        A.put('tyre_small', x, g + 0.42, z, yaw + Math.PI / 2, 1.5, null, 1.55, 0);
      }
    }
    // the thrown track, run out on the ground beside it
    {
      const n = 9;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const [x, z] = P(-1.7 - u * rng.range(1.2, 3.0), -L / 2 + u * (L + rng.range(0, 2)));
        A.add('metal_dark', BOX_FINE(A), LL(IDENT, x, gy(x, z) + 0.11, z,
          yaw + rng.range(-0.5, 0.5), 0.62, 0.16, 0.9, rng.range(-0.12, 0.12), rng.range(-0.12, 0.12)),
          { masks: [0.9, 0.85, 0.5] });
      }
    }
  }

  /* ---- what every burnt vehicle has under and around it ---------------- */
  const field = debrisField(rng, cx, cz, rng.range(4.5, 6.5), rng.range(0.28, 0.5), RUBBLE_CELL);
  drawDebris(A, rng, field, gy, { key: 'concrete_dark', key2: 'metal_rust', surface: 'dirt' });
  for (let i = 0; i < 7; i++) {
    const a = rng.float() * 6.28, dd = rng.range(1.5, 6.5);
    const x = cx + Math.cos(a) * dd, z = cz + Math.sin(a) * dd;
    noSheet(rng.float() < 0.6 ? 'road_dust' : 'steppe_bare',
      patchGeometry(rng, rng.range(0.8, 2.4), { lobes: 10, wobble: 0.6 }),
      LL(IDENT, x, gy(x, z) + 0.03, z, rng.float() * 6.28, 1, 1, rng.range(0.6, 1.2)),
      { masks: [0.7, rng.range(0.4, 0.9), 0.5] });
  }
  return { x: cx, z: cz, r: 4.2 };
}

// ───────────────────────────────────────────────────────────────────── earth ──
/**
 * A BULLDOZED SPOIL BANK. `driftBerm` is the plain's own generator (the trench
 * spoil and the fortress glacis are made of it) so this is the same earth,
 * pushed up by the same machine.
 *
 * IT IS SHORT ON PURPOSE — 12-19 m, never longer. 2.2 m of bank is far over
 * `maxStep` and is therefore a WALL to the height field, which is exactly what
 * makes it cover and exactly how you cut a map in half by accident. The trenches
 * answered that with traverses every 43 m; a berm answers it by being something
 * you walk round in four seconds, and by never being placed in a line with
 * another one.
 */
function berm(A, rng, gy, cx, cz, yaw) {
  const len = rng.range(12, 19);
  const h = rng.range(1.85, TALL - 0.25);
  const w = rng.range(3.6, 5.2);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const base = gy(cx, cz);
  /**
   * THE DRAWN SKIN, MEASURED, so the collision below can be made out of it
   * rather than out of a second guess at the same bank. @see the note there.
   * Per side: the crest height and the toe distance at each station.
   */
  const skin = [];
  /** Both faces, so it is a bank and not a cliff with a back you can see over. */
  for (const side of [1, -1]) {
    const g = driftBerm(rng, len, w, h, { nz: 5 });
    /**
     * ────────────────────────────────────────────────────────────────────
     * CONFORMED TO THE PLAIN, VERTEX BY VERTEX — the float bug this had
     * ────────────────────────────────────────────────────────────────────
     * `driftBerm` builds a flat-bottomed bank about y=0 and the first cut of
     * this placed the whole thing at `gy(cx, cz)`. The swell runs to 0.37 of
     * gradient at its worst, so a 19 m berm laid on it stood up to 1.4 m clear
     * of the ground at one end and was buried to the crest at the other —
     * photographed at 12 m, and the class of defect `_floatcheck.mjs` exists
     * for, which has shipped four times on this project.
     *
     * `plainsY` IS the ground (@see the note on it in plains.js — the terrain
     * mesh is built from it and the collision IS that mesh), so asking it per
     * vertex puts the toe of the bank exactly on the plain everywhere. The
     * yaw used here is the yaw the piece is PLACED at, so the mirrored face
     * conforms to the ground it is actually standing on rather than to its
     * twin's.
     */
    const yw = yaw + (side > 0 ? 0 : Math.PI);
    const cw2 = Math.cos(yw), sw2 = Math.sin(yw);
    const pa = g.getAttribute('position');
    for (let i = 0; i < pa.count; i++) {
      const lx = pa.getX(i), lz = pa.getZ(i);
      const wx = cx + cw2 * lx + sw2 * lz;
      const wz = cz - sw2 * lx + cw2 * lz;
      pa.setY(i, pa.getY(i) + gy(wx, wz) - base);
    }
    g.computeVertexNormals();
    /**
     * READ THE SKIN BACK. `driftBerm` lays `nz + 1` points across the section
     * at each of `nx + 1` stations, j = 0 at the crest and j = nz at the toe,
     * so the crest profile and the toe line are two columns of this attribute
     * and neither of them is knowable from `h` and `w` alone — @see the
     * collision note. Read in the LOCAL frame, which is the frame the collision
     * strip is authored in and the one `yw` maps to the world.
     */
    {
      const nz = 5, row = nz + 1;
      const stations = pa.count / row;
      const prof = [];
      for (let i = 0; i < stations; i++) {
        prof.push({
          lx: pa.getX(i * row),
          crest: pa.getY(i * row),
          toeZ: pa.getZ(i * row + nz),
          toeY: pa.getY(i * row + nz),
        });
      }
      skin.push({ yw, prof });
    }
    paintMasks(g, (x, y, z, mx, my, mz, out) => {
      const n = fbm3(x * 0.35 + cx, 2.3, z * 0.35 + cz, 3);
      out[0] = Math.min(1, 0.2 + n * 0.5);
      out[1] = Math.min(1, 0.34 + n * 0.5);
      out[2] = Math.min(1, 0.3 + (1 - Math.min(1, y / h)) * 0.35);
    });
    A.addOnce('steppe_bare', g, LL(IDENT, cx, base - 0.06, cz, yw), { masks: [0.3, 0.6, 0.35] });
  }
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * COLLISION IS A RIDGE, NOT A RUN OF BOXES — AND THAT IS A NAV FACT
   * ──────────────────────────────────────────────────────────────────────────
   * The drawn skin is a shell; these triangles are the berm as far as anything
   * that matters. They used to be a run of boxes, and a box has a FLAT TOP.
   *
   * `NavGrid.build` drops one ray per 0.8 m cell and keeps the first hit under
   * `MASK.WORLD`, then refuses the cell only if `down.normal.y < maxSlope`
   * (cos 46°). A flat crest 2 m up is therefore a strip of PERFECTLY WALKABLE
   * cells whose sides are vertical — which is the definition of an island, and
   * this map exists as the reaction to the town's 36 820 of them. Measured with
   * `_nfisland.mjs`: 1 302 stranded cells over 17 berms, the single largest
   * contributor on the plain and more than the wrecks and ruins together.
   *
   * A BERM IS A WALL. Its own note two paragraphs up says so — "2.2 m of bank
   * is far over `maxStep` and is therefore a WALL to the height field, which is
   * exactly what makes it cover". A wall you can stand on top of but never
   * reach is not cover, it is 76 cells of nothing. So the cross-section is a
   * triangle whose faces stand at `RIDGE_DEG`, past the 46° limit at every
   * station INCLUDING the tapered ends — the half-width is derived FROM the
   * local crest height rather than fixed, so a lower end is a narrower ridge
   * and not a shallower one.
   *
   * It stays on `LAYER.STATIC` and it is NOT `clipBox`. A berm has to stop
   * bullets — it is the cover — and `clipBox`'s own contract is that bullets and
   * sightlines pass through it. The fix here is the shape, not the layer.
   */
  /**
   * ────────────────────────────────────────────────────────────────────────
   * AND IT IS MADE OUT OF THE SKIN NOW, BECAUSE THE TWO DID NOT AGREE
   * ────────────────────────────────────────────────────────────────────────
   * The cross-section here used to be derived from `h` and `RIDGE_DEG` alone:
   * a smooth triangle whose apex tapered evenly from `h` at the middle to
   * 0.55 h at the ends, half-width `h / tan 58°`. `driftBerm` does not draw
   * that bank and never did. Measured off the geometry it actually emits:
   *
   *   the drawn crest is `h · wob · taper` with `wob = 0.45 + fbm · 1.1`, so it
   *   WANDERS between 0.45 h and 1.55 h along the length — 0.8 m to 3.4 m on a
   *   2.2 m berm — while the collision apex was a smooth 2.2 m everywhere;
   *   the drawn toe is at `w · (0.6 + fbm · 0.85)` and the bank is drawn TWICE,
   *   mirrored, so the visible mound is up to 15 m across the flats, against a
   *   collision ridge 2.8 m wide.
   *
   * Both errors are shipped defects and they are opposite ones. Where the skin
   * is low the collision stands over a metre PROUD OF VISIBLE GROUND — an
   * invisible wall on open plain, which is what the single ray at a berm centre
   * was actually reporting when it "found the plain, not a crest": the ray was
   * on the flank, and the flank of this ridge is 1.3 m of nothing where the
   * drawing has 4 m of earth. Where the skin is high you walk INTO the mound and
   * shoot THROUGH it, up to 1.2 m before anything stops either of you. Both are
   * "obstacles that do not work", and 「平原に障害物が少ない」 is what a map full
   * of them looks like from the inside.
   *
   * So the strip is built from the two skins' own vertices — crest height and
   * toe distance read back per station per side — and it is a TRAPEZOID, not a
   * triangle: the top 82 % of each face stands at `RIDGE_DEG` (past the 46°
   * limit, so no cell on it is ever walkable and no island is ever made) and the
   * remaining skirt runs out to the drawn toe at ~15°, which is walkable, is
   * CONNECTED to the plain by construction, and is where the visible earth is.
   *
   * THE APEX IS CAPPED AT THE OLD CEILING and that is a tank decision, not a
   * taste one: `tank.js`'s `CLIMB_TOP` is 2.6 m and six hulls drive baked routes
   * over these. Letting the collision follow a 3.4 m drawn crest would turn a
   * climbable bank into a wall on legs that were baked over it, and the boot log
   * would report the dropped spokes after the fact.
   */
  {
    const tan = Math.tan((RIDGE_DEG * Math.PI) / 180);
    const CAP = TALL - 0.25;
    /**
     * The two skins are the same stations in opposite order — side -1 is drawn
     * at `yaw + PI`, so its local (x, z) is this frame's (-x, -z). They are
     * merged into ONE profile before anything is emitted, and the crest takes
     * the HIGHER of the two: the faces are drawn from two different fbm seeds,
     * so a strip built per side would leave a vertical crack up to a metre deep
     * along the whole crest — a seam that a capsule can fall into and a bullet
     * can pass through, which is the class of defect this is fixing.
     */
    const A0 = skin[0].prof, B0 = skin[1].prof;
    const n = A0.length - 1;
    const pos = [];
    const idx = [];
    for (let i = 0; i <= n; i++) {
      const lx = A0[i].lx;
      const H = Math.max(0.25, Math.min(Math.max(A0[i].crest, B0[n - i].crest), CAP));
      const Zp = Math.max(0.7, A0[i].toeZ);
      const Zn = Math.max(0.7, B0[n - i].toeZ);
      const dy = gy(cx + c * lx, cz - s * lx) - base;
      const yB = H * 0.18;
      // the break: the top 82 % of the face stands at RIDGE_DEG, the rest is skirt
      const zBp = Math.min(Zp * 0.75, (H - yB) / tan);
      const zBn = Math.min(Zn * 0.75, (H - yB) / tan);
      pos.push(lx, dy - 0.3, -Zn);   // 0 toe, -Z
      pos.push(lx, dy + yB, -zBn);   // 1 break, -Z
      pos.push(lx, dy + H, 0);       // 2 apex
      pos.push(lx, dy + yB, zBp);    // 3 break, +Z
      pos.push(lx, dy - 0.3, Zp);    // 4 toe, +Z
    }
    for (let i = 0; i < n; i++) {
      const a = i * 5, b = (i + 1) * 5;
      for (let k = 0; k < 4; k++) {
        idx.push(a + k, a + k + 1, b + k + 1, a + k, b + k + 1, b + k);
      }
    }
    // and the two ends, which are vertical and therefore refused on their own
    for (const e of [0, n * 5]) {
      idx.push(e, e + 1, e + 2, e, e + 2, e + 3, e, e + 3, e + 4);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cg.setIndex(idx);
    cg.computeVertexNormals();
    A.collideGeo('dirt', cg, newTrs(cx, base, cz, yaw));
  }
  /**
   * WHAT WAS PUSHED UP WITH IT. A bank of bare spoil is a shape; the stone,
   * the torn reinforcement and the scrub taking hold in it are the detail layer
   * that has to survive at 0.5 m.
   */
  for (let i = 0; i < 22; i++) {
    const lx = rng.range(-0.5, 0.5) * len;
    const lz = rng.range(-0.55, 0.55) * w;
    const x = cx + c * lx + s * lz, z = cz - s * lx + c * lz;
    const t = Math.min(1, Math.min((lx / len + 0.5), (0.5 - lx / len)) * 5);
    const top = gy(x, z) + h * (0.5 + 0.4 * t) * Math.cos((Math.abs(lz) / w) * 1.4) ** 1.6;
    A.put(rng.float() < 0.55 ? 'rock_b' : 'rock_a', x, top - 0.12, z,
      rng.float() * 6.28, rng.range(0.5, 1.5), null, rng.range(-0.2, 0.2), rng.range(-0.2, 0.2));
    if (rng.float() < 0.4) A.put('weeds', x, top - 0.06, z, rng.float() * 6.28, rng.range(0.7, 1.5));
  }
  for (let i = 0; i < 3; i++) {
    const lx = rng.range(-0.45, 0.45) * len;
    const x = cx + c * lx, z = cz - s * lx;
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, x, gy(x, z) + h * 0.7, z, rng.float() * 6.28,
      0.04, rng.range(0.6, 1.5), 0.04, rng.range(-0.5, 0.5), rng.range(-0.5, 0.5)), { masks: [0.95, 0.7, 0] });
  }
  return { x: cx, z: cz, r: len / 2 };
}

/**
 * A FIRING POSITION — sandbags, hesco block and a sheet of corrugated over a
 * scrape. 1.3-1.5 m, which is the ONE height on this list you can fire over
 * standing (eye 1.62) and be completely behind crouched (1.15).
 *
 * That is what it is for: a berm and a wreck take you out of the fight while you
 * are behind them, and this does not. A crossing made only of full cover is a
 * crossing you sprint; a crossing with these on it is a crossing you fight down.
 */
function emplacement(A, rng, gy, cx, cz, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx, lz) => [cx + c * lx + s * lz, cz - s * lx + c * lz];
  const span = rng.range(4.5, 7.0);
  const bags = ['sandbag_a', 'sandbag_b', 'sandbag_c'];
  /** A two-course sandbag revetment on an arc, opening away from the enemy. */
  const rows = 2 + (rng.float() < 0.45 ? 1 : 0);
  const n = Math.round(span / 0.52);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n - 0.5;
    const bow = Math.cos(u * 2.4) * rng.range(0.5, 1.1);
    for (let r = 0; r < rows; r++) {
      if (rng.float() < 0.1) continue; // a course knocked out
      const [x, z] = P(u * span + rng.range(-0.06, 0.06), bow + r * 0.06);
      A.put(rng.pick(bags), x, gy(x, z) + 0.1 + r * 0.235, z,
        yaw + rng.range(-0.16, 0.16), rng.range(0.98, 1.16));
    }
  }
  /** One hesco/concrete block at an end, so the line has a hard shoulder. */
  {
    const [x, z] = P(span / 2 * rng.pick([1, -1]), rng.range(-0.4, 0.8));
    const h = rng.range(1.25, 1.5);
    A.add('concrete', BOX(A), LL(IDENT, x, gy(x, z) + h / 2, z, yaw + rng.range(-0.3, 0.3), 1.35, h, rng.range(1.6, 2.6)),
      { masks: [0.4, 0.55, 0.4] });
    A.box('concrete', x, gy(x, z) + h / 2, z, 1.35, h, 2.1, yaw);
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, x, gy(x, z) + h + 0.06, z, yaw, 1.42, 0.06, 2.2),
      { masks: [0.9, 0.6, 0] });
  }
  /** The scrape behind it — the sheet is deleted; @see `noSheet`. What was
   *  left standing in it is the loop under this one and is untouched. */
  for (let i = 0; i < 5; i++) {
    const [x, z] = P(rng.range(-0.45, 0.45) * span, rng.range(-2.2, -0.5));
    noSheet('steppe_bare', patchGeometry(rng, rng.range(0.7, 1.9), { lobes: 10, wobble: 0.55 }),
      LL(IDENT, x, gy(x, z) + 0.03, z, rng.float() * 6.28, 1, 1, rng.range(0.6, 1.2)),
      { masks: [0.45, rng.range(0.4, 0.9), 0.25] });
  }
  for (let i = 0; i < 3; i++) {
    const [x, z] = P(rng.range(-0.4, 0.4) * span, rng.range(-2.0, -0.7));
    A.put(rng.pick(['crate_b', 'jerry_can', 'bucket', 'box_card_b', 'barrel_rust']),
      x, gy(x, z) + 0.02, z, rng.float() * 6.28, rng.range(0.85, 1.1));
  }
  /** A sheet of corrugated on stakes: overhead cover you can see under. */
  if (rng.float() < 0.5) {
    const [x, z] = P(rng.range(-1, 1), rng.range(-1.9, -1.1));
    const y = gy(x, z);
    A.add('corrugated', BOX_THIN(A), LL(IDENT, x, y + 1.02, z, yaw + rng.range(-0.4, 0.4),
      2.2, 0.06, 1.7, rng.range(0.1, 0.28)), { masks: [0.9, 0.8, 0.35] });
    for (const [lx, lz] of [[-0.9, -0.6], [0.9, -0.6], [-0.9, 0.6], [0.9, 0.6]]) {
      A.add('wood_prop_dark', BOX_THIN(A), LL(IDENT, x + c * lx + s * lz, y + 0.5, z - s * lx + c * lz,
        yaw, 0.09, 1.0, 0.09), { masks: [0.8, 0.6, 0.3] });
    }
  }
  return { x: cx, z: cz, r: span / 2 + 1 };
}

// ─────────────────────────────────────────────────────────────────── the fire ──
/**
 * A BANK OF SMOKE, drifting off a wreck that is still alight. @see the header
 * for why this is `userData.fxSmoke` and not a third throwable path, and for
 * what it costs out of `Ambience`'s 24 slots and `fx.lit`'s ring.
 *
 * It is a marker Object3D with NO geometry: the fire under it is drawn here as
 * emissive mass, the smoke is `fx`'s. Parented to `world.root`, so it is removed
 * with the level rather than left in the scene when a map is switched.
 */
function smokeMarker(x, y, z, cfg) {
  const o = new THREE.Object3D();
  o.name = 'nf-smoke';
  o.position.set(x, y, z);
  o.userData.fxSmoke = cfg;
  return o;
}

/**
 * The seat of the fire: embers and a low flame body. The charred ground under
 * it was a flat sheet and is deleted — @see `noSheet`. The fire itself is
 * `ember` mass, which stands up out of the ground and is untouched.
 */
function burning(A, rng, gy, x, z) {
  const g = gy(x, z);
  for (let i = 0; i < 6; i++) {
    const a = rng.float() * 6.28, d = rng.range(0.4, 3.4);
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    noSheet('road_dust', patchGeometry(rng, rng.range(0.9, 2.2), { lobes: 11, wobble: 0.65 }),
      LL(IDENT, px, gy(px, pz) + 0.035, pz, rng.float() * 6.28, 1, 1, rng.range(0.5, 1.1)),
      { masks: [0.95, 0.2, 0.85] });
  }
  for (let i = 0; i < 7; i++) {
    A.add('ember', BOX_SOFT(A), LL(IDENT,
      x + rng.range(-1.4, 1.4), g + rng.range(0.05, 0.95), z + rng.range(-1.4, 1.4),
      rng.float() * 6.28, rng.range(0.2, 0.8), rng.range(0.15, 0.7), rng.range(0.2, 0.8)));
  }
}

// ────────────────────────────────────────────────────────── the ground itself ──
/**
 * ════════════════════════════════════════════════════════════════════════════
 * 「平原なのになんで草とか砂利とかがないの？ もっと追加しろ」
 * ════════════════════════════════════════════════════════════════════════════
 * THE PLAIN WAS BARE, AND THE ARITHMETIC SAYS WHY RATHER THAN THE EYE.
 *
 * `scatterVegetation` puts 14 000 `weeds` and 2 600 `shrub` over a 176 m disc —
 * 97 000 m² — and its own density filter rejects a share of them. That is about
 * ONE TUFT PER EIGHT SQUARE METRES. No arrangement of one tuft per eight square
 * metres reads as grassland; it reads as a texture with things standing on it,
 * which is exactly the complaint. And `weeds` carries `maxDist: 40`, so past
 * forty metres there is no vegetation in the frame AT ALL and the plain is the
 * terrain material and nothing else — which is the state every one of the
 * before photographs is in.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SO THE UNIT IS A PATCH, NOT A BLADE
 * ────────────────────────────────────────────────────────────────────────────
 * Getting to a real ground cover one tuft at a time would take 150 000-250 000
 * instances. Instead each instance here is a SWARD — a metre-wide clump of ten
 * blades merged into one geometry — so 34 000 of them cover about a third of the
 * ground, and `maxDist` culls whole 64 m chunks so only the near ring is ever
 * drawn. Same trick the existing pass uses, one level up in granularity.
 *
 * Three ranges, so the ground does not end at a hard circle:
 *   sward    0.24-0.5 m,  maxDist 64   the mat you are standing in
 *   tussock  0.5-0.9 m,   maxDist 118  the silhouette in the middle distance
 *   grit     a bed of pebbles, maxDist 58
 * …plus GRAVEL SHEETS as merged static patches, which have NO distance limit at
 * all and are therefore what makes the plain read as ground at 200 m.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND NOT ONE OF THEM HAS COLLISION
 * ────────────────────────────────────────────────────────────────────────────
 * 「地面に落ちている石ころオブジェが移動の妨げです、ジャンプしないと乗り越えられない」
 * — gravel is precisely the shape of that bug. `Assembler.proto` makes collision
 * a property of the prototype and the default is NONE, so every prototype below
 * simply does not declare `collide` and there is no proxy to trip over: not one
 * of them can appear in `_scatterblock.mjs`'s 0.42-0.68 m band because not one
 * of them is in the collision world at all. The tallest is a 0.9 m tussock,
 * which is foliage you walk through exactly as you already walk through `shrub`.
 */

/** A clump of grass: crossed quads, splayed, sized in metres. */
function swardGeometry(rng, blades, w, h) {
  const list = [];
  for (let i = 0; i < blades; i++) {
    const bw = w * rng.range(0.16, 0.34);
    const bh = h * rng.range(0.55, 1.25);
    const q = new THREE.PlaneGeometry(bw, bh, 1, 1);
    const m = new THREE.Matrix4();
    const e = new THREE.Euler(rng.range(-0.34, 0.34), rng.float() * 3.14, rng.range(-0.3, 0.3), 'YXZ');
    m.makeRotationFromEuler(e);
    const a = rng.float() * 6.28;
    const d = rng.float() ** 0.6 * w * 0.5;
    m.setPosition(Math.cos(a) * d, bh * 0.46, Math.sin(a) * d);
    q.applyMatrix4(m);
    /**
     * The masks are the whole of the variation at this scale: `foliage` reads
     * its wear channel as dryness, so a sward is green at the root and burnt at
     * the tips, and no two clumps are the same mix. A single flat green would
     * be the "flat untextured surface" the quality bar forbids, drawn 34 000
     * times.
     */
    fillMasks(q, rng.range(0.1, 0.45), rng.range(0.25, 0.8), rng.range(0.15, 0.55));
    list.push(q);
  }
  const g = mergeSimple(list);
  for (const q of list) q.dispose();
  return g;
}

/**
 * One stone, at the cheapest polygon count a stone can have.
 *
 * `rockGeometry` is an icosahedron: 20 triangles even at detail 0, and a bed of
 * eleven of them is 220 triangles for a patch of gravel — measured, the first
 * cut of this pass put 4.2 M instanced triangles on the map and three quarters
 * of them were grit. A tetrahedron is FOUR, warped and squashed reads as a chip
 * of stone at the 0.05-0.2 m these are, and nothing in the frame is close
 * enough to count its faces.
 */
function chipGeometry(rng, size, squash) {
  const g = new THREE.TetrahedronGeometry(size * 0.62, 0);
  const pa = g.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    pa.setXYZ(i,
      pa.getX(i) * rng.range(0.7, 1.4),
      pa.getY(i) * squash * rng.range(0.7, 1.3),
      pa.getZ(i) * rng.range(0.7, 1.4));
  }
  g.computeVertexNormals();
  return g;
}

/** A bed of grit: a handful of little faceted stones, merged into one draw. */
function gritGeometry(rng, n, spread, size) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const s = size * rng.range(0.5, 1.5);
    const r = chipGeometry(rng, s, rng.range(0.35, 0.7));
    const m = new THREE.Matrix4();
    m.makeRotationFromEuler(new THREE.Euler(rng.range(-0.6, 0.6), rng.float() * 6.28, rng.range(-0.6, 0.6), 'YXZ'));
    const a = rng.float() * 6.28;
    const d = Math.sqrt(rng.float()) * spread * 0.5;
    m.setPosition(Math.cos(a) * d, s * rng.range(0.1, 0.34), Math.sin(a) * d);
    r.applyMatrix4(m);
    fillMasks(r, rng.range(0.2, 0.7), rng.range(0.2, 0.6), rng.range(0.1, 0.5));
    list.push(r);
  }
  const g = mergeSimple(list);
  for (const q of list) q.dispose();
  return g;
}

/**
 * The prototypes. Registered off THIS module's stream, so the shared `rng` —
 * which `registerProps` and every scatter pass on the plain draw from in
 * sequence — is not advanced by a single call. @see note 5.
 */
function registerCoverProps(A, rng) {
  const P = (id, key, geo, opts) => A.proto(id, { geo, key, ...opts });
  // NO `collide` ON ANY OF THESE. @see the header of this section.
  P('nf_sward', 'foliage', swardGeometry(rng, 10, 1.15, 0.42), { maxDist: 64, castShadow: false });
  P('nf_sward_b', 'foliage', swardGeometry(rng, 8, 0.95, 0.3), { maxDist: 64, castShadow: false });
  P('nf_tussock', 'foliage', swardGeometry(rng, 11, 0.8, 0.86), { maxDist: 118 });
  P('nf_grit', 'gravel', gritGeometry(rng, 11, 1.0, 0.075), { maxDist: 58, castShadow: false });
  P('nf_shingle', 'concrete_dark', gritGeometry(rng, 8, 1.4, 0.13), { maxDist: 74, castShadow: false });
}

/**
 * Lay it. Density follows its OWN low-frequency field rather than the swell's,
 * so the grassy swards and the blown-out gravel flats are not the same shape as
 * the hills — a plain where the vegetation follows the contours exactly reads as
 * a shader, and the point of this is that there are thin, grazed lanes you are
 * exposed in and thick stands you are not.
 *
 * `wet` is the same field pushed by the ground's own height: grass gathers in
 * the hollows and the crowns of the swells scour to grit, which is what a
 * steppe actually does and is also free variation across the whole map.
 */
function dressPlain(A, rng, gy, isOpen, sites, R) {
  registerCoverProps(A, rng);
  /** Nothing grows through a wreck or up the inside of a ruin. */
  const clearOf = (x, z) => {
    for (const s of sites) {
      if ((x - s.x) ** 2 + (z - s.z) ** 2 < (s.r + 1.5) ** 2) return false;
    }
    return true;
  };
  const field = (x, z) => fbm3(x * 0.0093 + 31.7, 2.9, z * 0.0093 - 12.4, 4);
  const fine = (x, z) => fbm3(x * 0.061, 7.7, z * 0.061, 2);

  let sward = 0, grit = 0, tuss = 0, sheetsDropped = 0;

  /* ---- the sward: the mat you stand in --------------------------------- */
  for (let i = 0; i < 40000; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = Math.sqrt(rng.float()) * R;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const g = gy(x, z);
    // Hollows hold the grass. `g` runs about -6..+6 over the open plain.
    const wet = field(x, z) + Math.max(0, -g) * 0.055;
    if (rng.float() > 0.18 + wet * 1.05) continue;
    if (!isOpen(x, z, 0.4) || !clearOf(x, z)) continue;
    A.put(rng.float() < 0.6 ? 'nf_sward' : 'nf_sward_b', x, g - 0.05, z,
      rng.float() * 6.28, rng.range(0.7, 1.7), null, rng.range(-0.09, 0.09), rng.range(-0.09, 0.09));
    sward++;
  }

  /* ---- tussocks: the mid-distance silhouette ---------------------------- */
  for (let i = 0; i < 7000; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = Math.sqrt(rng.float()) * R;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const g = gy(x, z);
    const wet = field(x, z) + Math.max(0, -g) * 0.05;
    if (rng.float() > 0.1 + wet * 0.85) continue;
    if (!isOpen(x, z, 0.5) || !clearOf(x, z)) continue;
    A.put('nf_tussock', x, g - 0.08, z, rng.float() * 6.28, rng.range(0.6, 1.5),
      null, rng.range(-0.1, 0.1), rng.range(-0.1, 0.1));
    tuss++;
  }

  /* ---- grit and shingle: the gravel, thickest where the grass is not ---- */
  for (let i = 0; i < 30000; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = Math.sqrt(rng.float()) * R;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const g = gy(x, z);
    // the inverse of the grass field, plus a bias onto the crowns and the foot
    const dry = (1 - field(x, z)) * 0.9 + Math.max(0, g) * 0.05 + Math.max(0, (d - R * 0.72) / R) * 1.4;
    if (rng.float() > 0.12 + dry * 0.75) continue;
    if (!isOpen(x, z, 0.3) || !clearOf(x, z)) continue;
    A.put(rng.float() < 0.72 ? 'nf_grit' : 'nf_shingle', x, g - 0.035, z,
      rng.float() * 6.28, rng.range(0.6, 1.8), null, rng.range(-0.12, 0.12), rng.range(-0.12, 0.12));
    grit++;
  }

  /**
   * ---- and the sheets, WHICH ARE DELETED ---------------------------------
   *
   * 2 600 of them, 1.1-4.6 m, and they were the largest single family of flat
   * ground on the map: gravel pans, scoured crowns, silt in the hollows, drawn
   * at 200 m as readily as at 2 m because a merged static patch has no LOD.
   * That reach is exactly what made them the thing in the photograph — 「この
   * 地面テクスチャーが浮いてます 至る所で 消して」. @see `noSheet` at the top of
   * this file for why a horizontal fan at y = 0 is black on this map wherever
   * it lies, and why draping it on the terrain did not change that.
   *
   * WHAT CARRIES THE GROUND NOW: the three instanced passes above — 16 700
   * swards, 2 100 tussocks, 11 200 grit and shingle — plus `plains-ground.js`'s
   * hummocks and bedrock pans. Every one of those is a MASS with a lit side and
   * a shaded side, which is the whole difference. They are LOD'd, so the far
   * read of the plain is now the terrain's own shading and not a patchwork.
   */
  for (let i = 0; i < 2600; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = Math.sqrt(rng.float()) * R;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!isOpen(x, z, 0.2)) continue;
    const dry = 1 - field(x, z) + fine(x, z) * 0.3;
    const key = dry > 0.85 ? 'gravel' : dry > 0.6 ? 'scree' : dry > 0.4 ? 'steppe_dust' : 'steppe_bare';
    noSheet(key, patchGeometry(rng, rng.range(1.1, 4.6), { lobes: 11, wobble: 0.62 }),
      LL(IDENT, x, gy(x, z) + 0.018, z, rng.float() * 6.28, 1, 1, rng.range(0.55, 1.5)),
      { masks: [rng.range(0.2, 0.6), rng.range(0.3, 0.9), rng.range(0.15, 0.5)] });
    sheetsDropped++;
  }
  return { sward, tuss, grit, sheetsDropped };
}

// ───────────────────────────────────────────────────────── the objectives ──
/**
 * ════════════════════════════════════════════════════════════════════════════
 * COVER ON THE POINTS THEMSELVES — 「平原に障害物が少なく」, SECOND TIME OF ASKING
 * ════════════════════════════════════════════════════════════════════════════
 * The measurement the first pass made is a WALK: mean lane 115 → 62 m, exposed
 * 38 % → 7 %, eleven of twelve walks at 0 %. All of that is true and none of it
 * is what a player does. He stands on a point, holds it, and turns round.
 *
 * PHOTOGRAPHED, standing eye 1.62 m, eight bearings at each of the five zones
 * and both bases (`shots/nf360-before/`): at zone E, at zone A and at both
 * bases the ground is EMPTY for sixty metres on most bearings. Not thin —
 * empty. And it is empty by construction rather than by accident, which is why
 * adding a thirteenth crossing would not have touched it:
 *
 *     `stations.offPads` refuses any piece whose own half-extent crosses
 *     `p.r0 + 4` of a zone or `p.r0 + 7` of a base. With `r0` 16 at every zone
 *     that is 20 m plus the piece — 24.5 m for an emplacement, 29.5 m for a
 *     berm — so THE NEAREST COVER TO ANY CAPTURE POINT IS 24.5 m AWAY, and the
 *     one place on this map a man is required to stand still is the largest
 *     clear circle on it.
 *
 * The rule that made that is right about the thing it was written for — the
 * objective is not cover, and a spawn cluster with a burnt lorry in it is a
 * spawn cluster you die in. What it should have said is that the objective is
 * not FULL cover. So this pass fills the ring the other one is forbidden from,
 * with the one kind on the list you can fight from rather than hide behind.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IS ALLOWED IN THERE, AND WHERE, AND WHY IT DOES NOT CLOSE THE POINT
 * ────────────────────────────────────────────────────────────────────────────
 *   NOTHING inside r 11. `RULES.captureRadius` is 8, so the circle a man has to
 *   stand in to take the point is untouched and no piece can be stood on to
 *   contest it from outside the mechanic.
 *   THE INNER RING SITS BETWEEN THE STANDING POINTS. `sites.standRing` resolves
 *   eight standing points at r 14 on the cardinal and diagonal bearings and
 *   every one of them is proved walkable at boot, so the ring is authored at
 *   the EIGHT BEARINGS BETWEEN THEM, 22.5° off, and the nearest piece to a
 *   standing point is 6.2 m of open ground away.
 *   MOSTLY EMPLACEMENTS: 1.3-1.5 m, the one height in this file you fire over
 *   standing and are completely behind crouched. A ring of berms would be a
 *   fort, and a fort on a capture point is a point whose holder cannot be shot
 *   at, which is worse than an empty one.
 *   THE OUTER RING IS SIX PIECES AT 60°, so between any two of them there are
 *   fifteen metres of open ground at r 23 — the point stays approachable from
 *   every bearing and `navcheck` still solves every spawn to every site.
 *
 * ZONE D IS NOT IN THIS LIST. `src/match/sites.js` states in as many words that
 * D is "the 21 m of open plain between the two [works], in the open, overlooked
 * from a 43.7 m gallery on one side and a rampart on the other", and it is
 * locked until the tower comes off it. Cover in that gap is a change to a
 * documented decision in somebody else's file, not a change to this one.
 *
 * ITS OWN FIXED-SEED STREAM, so it can be called between two passes that share
 * `buildCover`'s `rng` without moving one stone either of them places. Same rule
 * `plains-tower.js` and `plains-fort.js` follow.
 */
const RING_ZONES = ['A', 'B', 'C', 'E'];
/** Inner ring: r, and what stands there, per bearing (22.5° + k·45°). */
const RING_IN = ['emplace', 'emplace', 'wreck', 'emplace', 'emplace', 'emplace', 'wreck', 'emplace'];
/** Outer ring: six at 60°, offset 15°, where the full-cover pieces are. */
const RING_OUT = ['berm', 'emplace', 'ruin', 'berm', 'emplace', 'wreck'];
/** …and a thinner apron outside each base, where the first forty metres are. */
const APRON = ['emplace', 'berm', 'emplace', 'emplace', 'berm', 'emplace'];

function zoneWorks(A, groundY, isOpen, pads) {
  const rng = new Rng(0x4ca7f7);
  const out = [];
  /**
   * Would this piece stand here? The same fit test the crossing solver uses,
   * and for the same reason: a piece whose CENTRE is open can still have half
   * its length in a trench. `KIND_MASS` is the mass half-extent, not the
   * separation radius.
   */
  const willFit = (kind, x, z, yaw) => {
    const m = KIND_MASS[kind];
    for (let i = -2; i <= 2; i++) {
      const u = (i / 2) * m;
      if (!isOpen(x + Math.cos(yaw) * u, z - Math.sin(yaw) * u, 1.2)) return false;
    }
    for (const s of out) {
      if ((x - s.x) ** 2 + (z - s.z) ** 2 < (s.r + m) ** 2) return false;
    }
    return true;
  };
  const lay = (kind, x, z, yaw) => {
    const m = KIND_MASS[kind];
    let r;
    if (kind === 'berm') r = berm(A, rng, groundY, x, z, yaw).r;
    else if (kind === 'ruin') r = ruin(A, rng, groundY, x, z, yaw).r ?? KIND_MASS.ruin;
    else if (kind === 'wreck') r = wreck(A, rng, groundY, x, z, yaw, rng.int(0, 3)).r ?? KIND_MASS.wreck;
    else r = emplacement(A, rng, groundY, x, z, yaw).r;
    out.push({ x, z, r: Math.max(r, 2.5), kind, ring: true });
  };
  /**
   * A piece laid on a bearing lies ACROSS it — its long axis (local +X, which a
   * yaw of `y` maps to `(cos y, -sin y)`) is set tangential, so it is a wall
   * between the point and whoever is coming from that bearing rather than a
   * handrail pointing at him. Same convention correction the crossing solver
   * records having had to make.
   */
  const across = (a) => Math.atan2(-Math.cos(a), -Math.sin(a));

  /**
   * THE SLOT IS A SEARCH, NOT A COORDINATE. The first cut of this authored one
   * point per bearing and stood up 23 of 68: three of the four zones sit 157 m
   * out on a plain `plainsOpen` refuses past 173, so every outward slot on
   * their far side was over the boundary, and the two flank spine trenches run
   * within twenty metres of A, C, B and E. So each slot slides in and out along
   * its own bearing, then a few degrees round, exactly as the crossing solver
   * slides along a walk before it slides off it — and falls back to an
   * emplacement, which needs 2.5 m of mass rather than a berm's 7.5, before it
   * gives the slot up.
   */
  const slot = (kind, cx0, cz0, a, d0) => {
    for (const k of kind === 'emplace' ? [kind] : [kind, 'emplace']) {
      for (const dd of [0, -2.6, 2.6, -5.2, 5.2, -7.8]) {
        for (const da of [0, 0.22, -0.22, 0.44, -0.44]) {
          const a2 = a + da;
          const d = d0 + dd;
          if (d < 11.5) continue;
          const x = cx0 + Math.cos(a2) * d;
          const z = cz0 + Math.sin(a2) * d;
          if (!willFit(k, x, z, across(a2))) continue;
          lay(k, x, z, across(a2));
          return true;
        }
      }
    }
    return false;
  };

  for (const p of pads) {
    const zone = RING_ZONES.includes(p.id);
    const base = p.id.startsWith('BASE');
    if (!zone && !base) continue;
    if (zone) {
      for (let k = 0; k < 8; k++) {
        const a = (k + 0.5) * Math.PI / 4 + rng.range(-0.06, 0.06);
        const d = 13.2 + (k % 3) * 1.4 + rng.range(-0.6, 0.9);
        slot(RING_IN[k], p.x, p.z, a, d);
      }
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3 + Math.PI / 12 + rng.range(-0.08, 0.08);
        const d = 21.5 + (k % 2) * 1.8 + rng.range(-0.8, 1.2);
        slot(RING_OUT[k], p.x, p.z, a, d);
      }
    } else {
      /**
       * The base apron stands OUTSIDE `r0 + 7`, which is where `offPads` starts
       * refusing — 27 m — so nothing here is in a spawn cluster. What it covers
       * is the first thirty metres of every push, which every man on the map
       * walks twice a life.
       */
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3 + Math.PI / 6 + rng.range(-0.1, 0.1);
        const d = 29 + (k % 2) * 2.4 + rng.range(-1, 1.5);
        slot(APRON[k], p.x, p.z, a, d);
      }
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────── build ──
/**
 * THE PASS. Called last in `PLAINS.build`, off its own stream. @see note 5.
 *
 * @param {Assembler} A
 * @param {(x:number,z:number)=>number} groundY   `plainsY` — the analytic plain
 * @param {(x:number,z:number,m:number)=>boolean} isOpen  `plainsOpen`
 * @param {Array} pads  `PADS` — the crossings are pairs of ids out of it
 * @param {object} ctx  the engine context, for `world.root` (smoke markers)
 */
export function buildCover(A, groundY, isOpen, pads, ctx) {
  /**
   * `?nocover` — build the plain WITHOUT this pass, so the before/after the
   * whole file is justified by can be measured against the SAME build.
   *
   * The alternative is a git stash and a second `vite build`, which compares two
   * different worlds: three other agents have uncommitted work in the trenches,
   * the tower and the fort, and a baseline taken before their changes would
   * credit this file with their occluders. This flag moves one variable.
   *
   * It is safe to return early. This pass is called LAST in `PLAINS.build` and
   * draws from its own `Rng`, so skipping it does not move one stone placed by
   * any earlier pass — @see note 5 — and the two runs differ only in this file.
   */
  if (coverFlag('nocover')) {
    console.info('[world] nachtfeld cover: SKIPPED (?nocover) — bare plain');
    return { sites: [], fires: [], ground: null };
  }
  const rng = new Rng(0x4ca7e2);
  const sites = stations(rng, pads, isOpen);
  const counts = { ruin: 0, wreck: 0, berm: 0, emplace: 0 };
  /** The wrecks that are still alight, longest lanes first. @see `smokeMarker`. */
  const fires = [];

  for (const st of sites) {
    counts[st.kind]++;
    /**
     * `st.yaw` looks DOWN the walk, and everything below ends up ACROSS it —
     * @see the note in `stations`. The two conventions in this file differ by a
     * right angle and it is worth saying which is which, because getting it
     * wrong is invisible in a screenshot and costs the whole point of the pass:
     *
     *   a berm, a ruin and a sandbag line run along their own LOCAL X, which a
     *   yaw of `y` maps to `(cos y, -sin y)` — perpendicular to the walk when
     *   `y` is the walk's own yaw. They are handed `st.yaw` unchanged.
     *   a vehicle runs along its LOCAL Z, which the same yaw maps to
     *   `(sin y, cos y)` — down the walk. It is handed `st.yaw + PI/2`.
     */
    const across = st.yaw + Math.PI / 2;
    /** Unit vector ACROSS the walk, so a cluster spreads over the lane. */
    const px = Math.cos(st.yaw), pz = -Math.sin(st.yaw);
    if (st.kind === 'ruin') {
      ruin(A, rng, groundY, st.x, st.z, st.yaw + rng.range(-0.2, 0.2));
    } else if (st.kind === 'berm') {
      berm(A, rng, groundY, st.x, st.z, st.yaw + rng.range(-0.28, 0.28));
    } else if (st.kind === 'emplace') {
      emplacement(A, rng, groundY, st.x, st.z, st.yaw + rng.range(-0.4, 0.4));
    } else {
      /**
       * WRECKS COME IN TWOS. One burnt lorry on 350 m of grass is a prop; two
       * of them abreast with the ground between them churned is a column that
       * was caught in the open, which is the story this map is already telling
       * with five burning ridges and a crashed satellite — and two hulls
       * abreast is also sixteen metres of lane rather than six.
       */
      const n = rng.float() < 0.7 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const a = across + rng.range(-0.55, 0.55);
        const off = i === 0 ? rng.range(-2, 2) : rng.range(8.0, 10.5) * rng.pick([1, -1]);
        const lag = i === 0 ? 0 : rng.range(-3.5, 3.5);
        const wx = st.x + px * off + Math.sin(st.yaw) * lag + rng.range(-1.2, 1.2);
        const wz = st.z + pz * off + Math.cos(st.yaw) * lag + rng.range(-1.2, 1.2);
        if (i > 0 && !isOpen(wx, wz, 5)) continue;
        wreck(A, rng, groundY, wx, wz, a, rng.int(0, 3));
        if (rng.float() < 0.4) fires.push({ x: wx, z: wz, route: st.route });
      }
    }
  }

  /* ---- and the objectives, which had NONE ------------------------------- */
  const ring = zoneWorks(A, groundY, isOpen, pads);
  for (const s of ring) sites.push(s);

  /* ---- and the ground it is all standing on ---------------------------- */
  const ground = dressPlain(A, rng, groundY, isOpen, sites, PLAIN_R);

  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE SMOKE — 「硝煙をもっともくもくさせろ」
   * ────────────────────────────────────────────────────────────────────────
   * Four banks, taken from the burning wrecks that are furthest apart so the
   * map has smoke on several bearings rather than one cloud in one corner.
   */
  const root = ctx?.peek?.('world')?.root ?? null;
  const chosen = [];
  for (const f of fires) {
    if (chosen.length >= SMOKE_BANKS) break;
    if (chosen.some((c) => (c.x - f.x) ** 2 + (c.z - f.z) ** 2 < 66 * 66)) continue;
    chosen.push(f);
  }
  const rate = smokeRate(ctx);
  for (const f of chosen) {
    burning(A, rng, groundY, f.x, f.z);
    if (!root) continue;
    root.add(smokeMarker(f.x, groundY(f.x, f.z) + 0.7, f.z, {
      radius: SMOKE_FOOT, growth: SMOKE_GROWTH, rate, life: SMOKE_LIFE,
      rise: SMOKE_RISE, dark: SMOKE_DARK, ember: 0.14, haze: 0.75,
    }));
  }

  /**
   * `?covertag` — where every piece actually stood up. Placement here is a
   * SEARCH (it slides along the walk, then off it, and drops what will not fit),
   * so the only way to point a camera at a berm or to say which crossing lost a
   * station to a trench is to have the solver say where it put things. Off by
   * default: fifty-one records is not a boot log.
   */
  if (coverFlag('covertag')) {
    console.info('[world] nachtfeld cover sites: ' +
      sites.map((s) => `${s.kind}@${s.x.toFixed(0)},${s.z.toFixed(0)}`).join(' '));
    console.info('[world] nachtfeld smoke banks: ' +
      chosen.map((s) => `${s.x.toFixed(0)},${s.z.toFixed(0)}`).join(' '));
  }

  console.info(
    `[world] nachtfeld cover: ${sites.length - ring.length} stations on ${CROSSINGS.length} crossings ` +
    `+ ${ring.length} on the objectives — ` +
    `${counts.ruin} ruins, ${counts.wreck} wreck sites, ${counts.berm} berms, ${counts.emplace} emplacements · ` +
    `${chosen.length} smoke banks at ${rate.toFixed(1)}/s (${Math.round(rate * SMOKE_LIFE)} live sprites each)` +
    `${root ? '' : ' — NO WORLD ROOT, SMOKE SKIPPED'} · ground ${ground.sward} sward, ` +
    `${ground.tuss} tussock, ${ground.grit} grit, ${ground.sheetsDropped} flat sheets DELETED`
  );
  return { sites, fires: chosen, ground };
}
