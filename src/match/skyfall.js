/**
 * ════════════════════════════════════════════════════════════════════════════
 * SKYFALL — 「衛星墜落…それに合わせて無人爆撃機が５機墜落…母艦飛行機の墜落も」
 * ════════════════════════════════════════════════════════════════════════════
 * The second and third waves of NACHTFELD's third act, and the burning region
 * they leave. `src/match/crash.js` owns the first wave — the satellite — and it
 * owns the clock; this file is everything that comes down BEHIND it and what
 * the ground looks like afterwards. `Crash.fire()` is still the one entry
 * point, because Act III's `crash` beat calls exactly that and nothing else.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THREE WAVES, ONE EVENT, AND THE THING THAT MAKES IT ONE IS THE CAUSE
 * ────────────────────────────────────────────────────────────────────────────
 * Three aircraft falling out of the sky in twenty seconds is three
 * coincidences unless the first one EXPLAINS the other two, so the chain is
 * stated in the staging and not only in the banner:
 *
 *   THE SATELLITE dies first and it is the navigation. It enters at t=0.
 *   THE FIVE DRONES are unmanned and they are flying on it. They enter the sky
 *     at t=0 TOO — the same frame, not a beat later — and they enter TUMBLING,
 *     because the moment the thing they were flying on stopped existing they
 *     stopped being aircraft. They are the only objects in this event with no
 *     attitude control at all, and that reads at 400 m.
 *   THE CARRIER launched them and is steering by the same constellation. It is
 *     the last thing to arrive and the biggest by a factor of six, and it comes
 *     down more slowly than either — a heavy aeroplane takes a long time to
 *     fall. It enters at t=0.7 and lands at t=18.4.
 *
 * They also all come out of the SAME QUADRANT OF SKY. The satellite's own
 * entry bearing is 10.5° east of due south; the drones fan from 4° to 48°; the
 * carrier is at 38.5°. From any capture point on this map the whole event is
 * one piece of sky falling over, which is the entire design of the first wave
 * — 「見えるように」 — extended to the other two rather than restated.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW BIG THE CARRIER ACTUALLY IS
 * ────────────────────────────────────────────────────────────────────────────
 * MEASURED off the built geometry (`_sfseat.mjs`, which reads the bounding box
 * of the merged mesh rather than adding up the boxes in `_buildMother`):
 *
 *   86.6 m from the nose to the trailing edge of the fin
 *   62.8 m across the wing AS IT ARRIVES — the starboard outer panel is torn
 *         off at the root and is lying in the fire 34 m away, a further 29.6 m
 *         of wing, so the aeroplane was about 85 m across before it came apart
 *   32.1 m from the belly of the outboard nacelle to the top of the fin
 *
 * The satellite's fuselage is 15 m, so this is 5.8 times it end to end and
 * something over a hundred times its volume. For scale in the other direction:
 * zone A and zone C are 190 m apart, so the wreck alone is 46 % of the distance
 * between two capture points, and its fin is eight storeys.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 「一部マップが通行不可」 — WHAT IMPASSABLE MEANS, MECHANICALLY
 * ────────────────────────────────────────────────────────────────────────────
 * THE REGION IS TAKEN OFF THE MAP FOR EVERYBODY, and it is enforced by two
 * different mechanisms because the two things standing on this map fail
 * differently.
 *
 *   THE BOTS: the region's nav cells are set to 0 — not walkable — from a list
 *   baked at BOOT, exactly as `Airstrike._bakeNavPatch` patches the map when a
 *   building comes down. A* cannot enter it, so it costs nothing per solve and
 *   there is no avoidance layer to pay for. They walk round; they do not stand
 *   off. @see `_bakeDenial` and, for the proof that this cannot strand anybody,
 *   `_verifyDenial`.
 *
 *   THE PLAYER: NO COLLISION, EVER. A wall you bounce off in open ground is the
 *   worst thing this map could grow, and a fire you can lean on is worse. What
 *   stops him is that the ground kills him — `BURN_DPS` 30 is 3.3 seconds of
 *   life inside it, against 15 seconds to cross it at a sprint — and what TELLS
 *   him is that it is 116 x 88 m of burning ground with a 24 m wreck in the
 *   middle of it, lit, smoking, and visible from every capture point at night.
 *
 * AND THE OLD ARITHMETIC IS RE-DERIVED RATHER THAN INHERITED. The reason
 * `src/ai` has no fire avoidance is a measurement: 3 sear kills in 18 matches
 * against 8 from the satellite's impact, i.e. one death every six matches, and
 * an A* cost layer to prevent that is not worth its budget. That measurement
 * was taken against a 24 m ribbon threading a corridor nothing is routed down.
 * This is 8 500 m² — two and a quarter times the ribbon's area, in a disc
 * rather than a line — sitting on the west approach, and a man who walks into
 * the middle of it dies with certainty rather than with probability. The number
 * that changes the conclusion is not the damage, it is the WIDTH: you cannot
 * cross 88 m of it, so a policy of "walk through and take it" is not a policy,
 * it is a casualty list. The correct layer is therefore still not a cost field
 * — it is a hole, which costs zero.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHERE IT IS, AND THE CLEARANCES ARE MEASURED
 * ────────────────────────────────────────────────────────────────────────────
 * `crash.js`'s own rule is the binding one — a fire on a capture circle is a
 * point the AI walks into and dies in — and it is harder to satisfy here
 * because the region is a REGION. The west of this map is a roughly circular
 * pocket about 100 m across bounded by zone A, zone C, the fortress pad and the
 * rim, and a search over every centre, bearing and size that clears all of them
 * by 30 m puts the largest thing that fits at (-100, -8). The event is authored
 * there. Measured, from the flame edge to the CIRCLE edge:
 *
 *   zone A   (-118,-104) r14   31.1 m of clear ground
 *   zone C   (-128,  86) r14   27.3 m
 *   zone D   (   0,   0) r14   35.2 m
 *   NF-TOWER (   0, -32) r22   26.2 m
 *   NF-FORT  (   0,  48) r36   33.2 m
 *   BASE-N   ( -14,-150)       74.1 m
 *   BASE-S   (  14, 150)      113.5 m
 *   the rim: no part of it reaches past 152.8 m of the 176 m walkable disc
 *
 * It also swallows 57 m of the satellite's own 160 m scar, and that is not an
 * accident either: the two fires MEET, so what the player sees from a capture
 * point is one catastrophe with a tail on it rather than two fires that
 * happened at the same time.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NOTHING IS COMPUTED IN THE FIRE FRAME, INCLUDING THE NAVIGATION
 * ────────────────────────────────────────────────────────────────────────────
 * Every airframe, every flame instance, every cell's ground height, the cell
 * list the denial writes, AND BOTH CONNECTED-COMPONENT LABELLINGS OF THE WHOLE
 * NAV GRID are baked in `build()`. Denying the region is 13 000 byte writes and
 * two array swaps; releasing it is the same in reverse. `NavGrid._label` is a
 * flood over a quarter of a million cells and it is never run during a match —
 * it is run twice at boot, and the answer is memcpy'd in, which is the same
 * discipline `Airstrike._bakeSettled` uses for the settled pose of a building.
 */
import * as THREE from 'three';
import { chunkGeometry, makeChunkMaterial, mergeGeometries } from './airstrike.js';
import { BlastBuilder, KIND, makeBlastMaterial } from '../fx/detonation.js';
import { makeFireMaterial } from './fire.js';
import { layoutFor } from './sites.js';

/* ─────────────────────────────────────────────────────── the ground track ── */
/**
 * THE CARRIER'S GROUND TRACK: where the nose first touches and where it stops.
 * The same shape as `crash.js`'s `PLAINS_TRACK` and for the same reason —
 * everything else (the entry point, the entry altitude, the descent angle, the
 * region, the wreck's attitude) is derived from these two points, so there is
 * one place to move it and nothing to keep in sync. Level space is world space
 * on this map. @see the clearance table in the header.
 */
const TRACK = { from: [-65.1, -51.8], to: [-124.9, 23.4] };
/**
 * THE REGION, stated as a capsule ON that track: everything within `REGION_R`
 * of the segment from `from + SPINE0·û` to `from + SPINE1·û`. A capsule and not
 * a disc because a ploughing wreck makes a long fire, and it is only barely
 * longer than it is wide because that is all the room the west has.
 *
 * 116 m along the plough by 88 m across, 8 546 m². The satellite's swathe is
 * 157 x 24 = 3 770 m², so this is 2.27 times the burning ground the map has
 * ever had on it at once.
 */
const SPINE0 = 42;
const SPINE1 = 70;
const REGION_R = 44;

/* ─────────────────────────────────────────────────────────────── the clock ── */
/**
 * ONE CLOCK, and it is `Crash`'s. Every number below is seconds since
 * `Crash.fire()`, which is also seconds since the satellite appeared, so the
 * beat sheet reads top to bottom against the thing the player is already
 * watching. The satellite lands at 13.0 and finishes ploughing at 18.0.
 */
/** The five drones enter the sky on the frame the satellite does. */
const DRONE_IN = 0.0;
/** …and come down one after another, walking across the west. */
const DRONE_HIT = [14.2, 15.1, 15.9, 16.8, 17.6];
/** m/s. Faster than the satellite: they are small and they are falling. */
const DRONE_SPEED = 46;
/** Metres of altitude at the entry point. */
const DRONE_CLIMB = 210;
/** Entry bearings, degrees east of due south. @see the header — one sky. */
const DRONE_BEARING = [4, 16, 27, 38, 48];
/**
 * WHERE EACH ONE LANDS, in the region's own frame: `u` along the plough from
 * the region CENTRE, `v` across it. They are spread down the whole track and
 * alternate sides, so what the player sees between t=14 and t=18 is a line of
 * fireballs walking across the west — and every one of them is inside the
 * region the carrier is about to land in the middle of.
 */
const DRONE_AT = [[-34, 16], [-12, -24], [10, 26], [30, -12], [44, 6]];
/** Blast of one drone. Half the satellite's, which is the point of five. */
const DRONE_BLAST_R = 17;
const DRONE_BLAST_D = 150;

/** The carrier is in the sky from here. It is big enough to see immediately. */
const MOTHER_IN = 0.7;
/**
 * FIRST CONTACT AT 18.4, AND THE 0.4 IS LOAD-BEARING.
 *
 * `Crash`'s plough ends at 18.0 and `src/audio/index.js` says of `startPlough`
 * "Never two — a second act firing over a running one replaces it". The
 * satellite's voice therefore gets its own settle, this one starts on a clean
 * slot, and the satellite grinds to a halt four tenths of a second before the
 * carrier arrives, which is a better beat than the two on top of each other.
 */
const MOTHER_HIT = 18.4;
/** m/s. Slower than the drones, over a longer path: 17.7 s of falling. */
const MOTHER_SPEED = 40;
const MOTHER_CLIMB = 272;
/** Seconds from first contact to rest. Longer than the satellite's 5.0. */
const MOTHER_PLOUGH = 5.4;
/** Metres it ploughs. Its own length again, and it ends where it started. */
const MOTHER_SKID = 96;
/** The blast. The largest single explosion this game has: the satellite's 34. */
const MOTHER_BLAST_R = 52;
const MOTHER_BLAST_D = 300;
/** Seconds after the carrier stops before this file goes idle. */
const TAIL = 0.8;

/* ─────────────────────────────────────────────────────── the detonation ── */
/**
 * ════════════════════════════════════════════════════════════════════════════
 * 「母艦大爆発してないね？？？」「大爆発演出はド派手にしないと」
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT WAS ACTUALLY HAPPENING AT t=18.4, MEASURED ON THE SHIPPING BUILD BEFORE
 * ANY OF THIS WAS WRITTEN (`_sfbang.mjs`, which counts what is DRAWN rather
 * than timing it, because `_sfcost.mjs` had already reported that the two extra
 * waves cost 0.2 ms and that there was no spike at t=18.4 at all):
 *
 *   t=18.383    2 lit    3 add   43 decals 0   <- an ordinary frame
 *   t=18.400   99 lit   63 add   43 decals     <- THE CARRIER LANDS
 *   t=18.417    2 lit    2 add    0            <- and it is over
 *
 * ONE HUNDRED AND SIXTY-TWO PARTICLES, on one frame, and the biggest number in
 * the row was the 43 scorch DECALS. Two things made it that:
 *
 *   1. `explode()` IS A FIXED-SIZE RECIPE. `nFire = round(12*pScale)+5` — there
 *      is no `R` in any count in that file, only in the sizes. So the 86 m
 *      carrier and a rifle grenade emit the same eleven fireball sprites, and
 *      the carrier's are 36-60 m across. Eleven overlapping 50 m pale sprites
 *      is not a large explosion, it is a SMOOTH CREAM DISC, and that is exactly
 *      what it photographed as at 83 m. `_motherHit` was also calling it TWICE
 *      — once through the damage event and once directly — so the disc was
 *      drawn on top of itself.
 *   2. BOTH RINGS WERE ALREADY FULL. `liveLit 2805/2805`, `liveAdd 2295/2295`,
 *      pinned there by this file's own conflagration. Every sprite the
 *      detonation emitted OVERWROTE one of the fire it was landing in, so
 *      emitting harder could only ever have traded the fire for the explosion.
 *
 * And at 151 m it was a cream smudge dimmer than the street lamp beside it; at
 * 240 m — which `_sfstand.mjs` measures as the farthest a man can stand from
 * this impact, because the plain is a 176 m disc and first contact is 83 m from
 * its centre — NOTHING HAPPENED AT ALL. `LightPool.register` asks the renderer
 * for `range: 90`, and the renderer's own distance fade switches a light off
 * past ~1.15x of that, so the 15 000 candela flash at first contact IS NOT LIT
 * FOR ANY PLAYER MORE THAN ~103 m AWAY. A point light cannot be the light this
 * event casts on the map. Only geometry that is its own glow can be.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SO IT IS BAKED, AND THAT IS WHY IT CAN BE EXTRAVAGANT
 * ────────────────────────────────────────────────────────────────────────────
 * 1 728 quads and 180 airframe chunks, allocated at BOOT, drawn from four
 * instanced buffers that never change, moved by closed-form motion in a vertex
 * shader off ONE uniform each. The frame it fires assigns two floats and does
 * two memcpys. It takes NO particle-ring slot, so it displaces nothing — and
 * the count it does displace went DOWN, because the second `fx.explosion` call
 * is gone and the first one now draws its debris at `bodyR` instead of at a
 * 52 m fireball. @see `src/fx/detonation.js` and `bodyR` in
 * `src/fx/explosions.js`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT CARRIES AT WHICH RANGE, WHICH IS THE WHOLE DESIGN
 * ────────────────────────────────────────────────────────────────────────────
 *    30 m  you are inside it. The core, the airframe tearing apart over your
 *          head, and the DUST WALL arriving — a 240-quad ground front that
 *          reaches you 0.4 s after the flash. It must not white out: the body
 *          of the fireball is nearly pure red in source for the reason
 *          `src/match/fire.js` states twice.
 *   150 m  the SHAPE. A 60 m fireball with a dark shroud rolling off it, 520
 *          burning fragments arcing out to 150 m, and the blast ring crossing
 *          the plain towards you.
 *   240 m  the COLUMN. 260 quads climbing to 120 m — eight times the height of
 *          anything else in the event — because at a 1.7 m eye a ground-level
 *          fireball is behind the terrain rise and a column is not. This is the
 *          same argument this file already makes for the flames' height, and it
 *          is the only part of the event that is visible from the far spawn.
 */
/** The core: white for a tenth of a second, and never wider than this. */
const DET_CORE = 48;
/** The fireball proper — the mass, and the thing that reads at 150 m. */
const DET_BALL = 360;
/** The column. @see the range note above: this is the 240 m read. */
const DET_COLUMN = 260;
/** Dark smoke boiling off it. Alpha-blended: additive cannot make a silhouette. */
const DET_SHROUD = 300;
/** The ground front. 240 quads thrown radially at up to 150 m/s. */
const DET_WALL = 240;
/** Burning fragments. The only part of the event that is small and numerous. */
const DET_EMBER = 520;
/**
 * PER-QUAD RADIANCE, AND IT IS A FRACTION FOR THE SAME REASON THE FIRE'S IS.
 * The composite multiplies this frame by ~14x before AgX, so a crowd argument
 * has to be made in radiance and not in count. @see `FIRE_GAIN`, and the note
 * in `src/match/fire.js` about what (1.0, 0.15, 0.012) looks like on a screen.
 */
const DET_GAIN = 0.58;
const DET_SMOKE_GAIN = 0.50;
/** Seconds the detonation's own clock runs before the meshes go back to idle. */
const DET_S = 9.5;

/** Metres the shockwave reaches, and the seconds it takes. ~260 m/s off the mark. */
const WAVE_R = 210;
const WAVE_S = 1.6;

/**
 * THE AIRFRAME COMES APART, AND IT USES THE TOWER'S OWN SHADER.
 *
 * `Airstrike.makeChunkMaterial` is a `MeshStandardMaterial` with an
 * `onBeforeCompile` that rewrites `project_vertex` into closed-form ballistic
 * motion off `uT` — 3 365 chunks of the NACHTFELD tower ride it, `bomber.js`
 * already imports it for crater debris, and its own doc comment says why there
 * must not be a second copy. So this is that, at 180 chunks: the fin, the
 * tailplane, the nacelles, the spine plating and the skin, thrown off the
 * carrier ON THE FRAME OF CONTACT while the fuselage core ploughs on for
 * another 96 m. It is LIT geometry, which matters — the wreck's own note is
 * that what makes it read is the fire AROUND it and the darkness ON it, and an
 * unlit chunk at night is a black hole in the fireball.
 *
 * 180 and not 3 365 because these are not masonry: an aeroplane sheds panels
 * and structure, and 3 000 pieces of a 300 t airframe would be sand.
 */
const CHUNKS = 180;
/** Seconds after contact by which every chunk is down. @see `_settleChunks`. */
const CHUNK_S = 5.0;

/* ────────────────────────────────────────────────────────────────── the fire ── */
/** Metres between fire cells. 7.5 gives ~150 cells over 8 546 m². */
const CELL_STEP = 7.5;
/**
 * Flame tongues and bed quads per cell. @see `crash.js` for what each is.
 *
 * 12/11 -> 14/18, AND THE BED GOT SMALLER RATHER THAN THERE BEING MORE OF THE
 * SAME. Photographed from two metres outside the flame
 * (`shots/skyfall/SKY-14-at-the-edge.png`), eleven bed quads of 3.4-7.6 m
 * half-width per 8.5 m cell were four or five COUNTABLE orange mounds in the
 * near field, each with its own visible edge — the exact tell `crash.js`
 * records for the scar at seven tongues ("you could count them, which is the
 * tell that they are objects rather than a fire"). The scar never showed it
 * because a 24 m ribbon is a thing you look ALONG; a 88 m region is a thing you
 * stand at the edge of and look INTO, so its near field is the shot.
 *
 * A crowd is fixed by making its members smaller and more numerous, never by
 * making them brighter. @see `FIRE_GAIN`.
 */
const TONGUES = 14;
const BED = 18;
/**
 * A DENSER CROWD HAS TO BE QUIETER PER MEMBER. 2 700 quads over this region is
 * the same 0.3 instances/m² the scar carries, but a bed quad here reads against
 * an 88 m width rather than a 24 m one and the region is deep enough that the
 * eye is looking THROUGH a great many of them at any bearing, and because the
 * near field of this fire is a shot — you stand at the edge of it. @see `uGain` in
 * `src/match/fire.js` — the composite multiplies this frame by ~14x before AgX
 * and three channels over the shoulder is white whatever their ratio.
 */
const FIRE_GAIN = 0.80;
/** m/s the fire runs OUTWARD from the furrow. The wreck lights the ground. */
const SPREAD_V = 40;
/** …and outward from a drone's crater, over this radius. */
const DRONE_LIGHT_R = 16;
const DRONE_SPREAD_V = 12;
/**
 * Seconds the region burns. Twenty longer than the scar's 240 on purpose: this
 * is meant to be the last thing still alight when the match ends, and the act
 * fires at 0.80 of a 1000-point game.
 */
const BURN_S = 260;
/** Seconds between passes of burn damage over whatever is standing in it. */
const BURN_TICK = 0.5;
/**
 * DAMAGE PER SECOND TO ANYTHING INSIDE, AND THIS IS WHAT "IMPASSABLE" IS.
 *
 * 30/s is 3.3 s of life. Crossing the 88 m minor axis at a 6 m/s sprint takes
 * 14.7 s, so it cannot be crossed; clipping a 20 m corner takes 3.3 s, so it
 * can be clipped and it costs you the round. A man who steps two metres in and
 * turns round loses a third of his health and learns the rule. That is the
 * shape wanted: a boundary you are taught by, not a wall you bounce off.
 */
const BURN_DPS = 30;
/**
 * COOK-OFFS, and they are the whole reason the burn above is applied DIRECTLY
 * rather than through `ctx.events.emit('explosion')`.
 *
 * `src/fx` listens to that event and renders a full explosion for every one of
 * it, and `src/audio` plays a blast. The satellite's sear can afford it — 14
 * small ones every 2.6 s. This region needs its damage to be UNIFORM (it is a
 * fire, not a shelling) and it needs it everywhere at once, and an explosion
 * field dense enough to be uniform under a 1/r² falloff is thirty fireballs
 * every two seconds, which is a bombardment and not a fire. So the burn is a
 * containment test and a call to the same `applyDamage` the explosion handler
 * in `src/ai/index.js` calls, and the PICTURE of things going off inside the
 * fire is bought separately and cheaply: one real explosion every ~2.6 s at a
 * random cell, which is fuel and ordnance cooking off and costs 0.4 fireballs
 * a second.
 */
const COOK_EVERY = 2.6;
const COOK_R = 15;
const COOK_D = 90;
/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE REGION'S LIGHT, AND IT BIDS FROM THE BOTTOM OF THE POOL
 * ────────────────────────────────────────────────────────────────────────────
 * `LightPool` is FOUR LIGHTS for the whole game and the satellite's scar
 * already holds three of them for sixty seconds at `priority: 1`, the ordinary
 * tier. A fire this size that asked at the same tier would leave the gunfight
 * one slot for a minute, and 「その燃えている光で夜なのにその周りは明るい」 is a
 * lighting argument, not a licence — the burning ridge lost this fight once
 * already and `plains.js` says so.
 *
 * So it asks at PRIORITY 0, which is below every muzzle flash, every grenade
 * and the scar's own three. `LightPool.flash` hands out a FREE slot to anybody
 * — the score for an idle light is 1e6 whatever the priority — and refuses to
 * evict a holder of higher priority, so this takes a light exactly when
 * nothing else wants one and loses it the instant something does. The fire is
 * not lit BY it: the bed is its own glow (@see `crash.js`'s note on why), and
 * this is only what puts a hard edge on the 86 m wreck standing in the middle.
 *
 * It is re-asked every `LIGHT_EVERY` seconds for the whole burn rather than
 * held, for the same reason: a light held for 260 s is a slot the match cannot
 * have back, and re-asking is one `flash` call every fifty seconds.
 */
const LIGHT_EVERY = 50;
const LIGHT_HOLD = 52;
/**
 * HOW SMALL A PIECE OF STRANDED GROUND IS NOT AN ISLAND, in nav cells.
 *
 * 24, and it is `DROP_LAND_MIN`'s number verbatim: `src/ai/nav.js` refuses to
 * let a man fall onto a component under 24 cells with the comment "24 cells is
 * 15 m² of real ground". Anything under that is the 0.8 m lattice catching the
 * corner of a boulder or the shoulder of a crag, not a place a soldier goes,
 * and `findPath` already re-anchors off components that size. A REAL island —
 * a crescent of plain sealed between the fire and the rim — is hundreds of
 * cells and is refused. @see `_verifyDenial`, which prints the number and the
 * place either way, so this can never be silent.
 */
const ISLAND_MIN = 24;
/** Metres under the map the airframes wait. @see `Crash`'s `PARKED_Y`. */
const PARKED_Y = -400;

const DEG = Math.PI / 180;

export class Skyfall {
  /**
   * @param {object} ctx  engine context
   * @param {object} opts { rng }
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.rng = opts.rng ?? ctx.rng.fork();
    /**
     * THE SATELLITE'S FIRE UNIFORM, handed in by `Crash.build()`. The only
     * thing ever written on it here is `uBlast`, so the carrier's shockwave
     * crosses the scar as well as this file's own region — the two fires MEET
     * by construction (@see the header) and a wave that stopped at the seam
     * between them would draw the seam. Null on any map that has no scar.
     */
    this._scarFire = opts.scarFire ?? null;
    this.ready = false;
    this.buildMs = 0;
    /** True while anything of these two waves is in the air or ploughing. */
    this.busy = false;

    /** The act clock, seconds since `Crash.fire()`. -1 when nothing is falling. */
    this._t = -1;
    /** Seconds of burning left on the region. 0 when the west is not on fire. */
    this._burn = 0;
    /** True while the region is denied and burning what stands in it. */
    this._live = false;
    /** True while the nav grid is holed. Idempotence for `reset`/`dispose`. */
    this._denied = false;
    /** Countdown to the next burn pass, cook-off and light renewal. */
    this._tick = 0;
    this._cook = 0;
    this._light = 0;
    /** Seconds since the carrier's last trail puff, and the squadron's. */
    this._puff = 0;
    this._dpuff = 0;
    /** Which of the five gets the next puff. @see `_droneTrail`. */
    this._dnext = 0;
    /** Which drones have already struck. */
    this._hit = [false, false, false, false, false];
    /**
     * The detonation's own clock, seconds since first contact, and -1 when
     * there is not one. It is the ONLY thing the fireball, the column, the
     * shroud, the dust wall, the embers and the shockwave are functions of.
     */
    this._det = -1;
    /** True until the chunks' settled pose has been memcpy'd back. */
    this._chunksFlying = false;
    /** The carrier's plough voice, `{ drive, stop }` or null. @see `Crash`. */
    this._plough = null;
    /** Persistent smoke tags, so `reset`/`dispose` can hand them back. */
    this._smoke = [];

    /** Where the carrier comes to rest. Published for a banner or a reticle. */
    this.impact = new THREE.Vector3();
    /** The region's centre, published for the same reason. */
    this.centre = new THREE.Vector3();

    this.group = new THREE.Group();
    this.group.name = 'match-skyfall';
    this.group.matrixAutoUpdate = false;

    /* scratch — nothing in update() allocates */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._sc = new THREE.Vector3(1, 1, 1);
    this._eul = new THREE.Euler();
    this._dv = new THREE.Vector3();
    this._blast = { position: null, radius: 0, damage: 0, source: 'crash' };
  }

  /* ====================================================================== */
  /*  BOOT — everything, including both labellings of the nav grid           */
  /* ====================================================================== */

  build() {
    const t0 = performance.now();
    const ctx = this.ctx;
    const physics = ctx.peek('physics');
    const world = ctx.peek('world');
    if (!physics || !world) {
      console.warn('[skyfall] no world/physics — disabled');
      return this;
    }
    this._lib = ctx.peek('materials');

    /* ---- the track and the region's frame ------------------------------ */
    const [ax, az] = TRACK.from;
    const [bx, bz] = TRACK.to;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    /** Unit heading of the plough. */
    this._hx = dx / len;
    this._hz = dz / len;
    this._yaw = Math.atan2(this._hx, this._hz);
    this._skid = len;

    const gy = (x, z) => physics.groundHeight(x, z, 400);
    this._ay = gy(ax, az);
    this.impact.set(bx, gy(bx, bz), bz);

    /** The capsule, in the form `_inside` wants: one end plus a direction. */
    this._sx = ax + this._hx * SPINE0;
    this._sz = az + this._hz * SPINE0;
    this._sLen = SPINE1 - SPINE0;
    this._r2 = REGION_R * REGION_R;
    const cx = ax + this._hx * (SPINE0 + SPINE1) * 0.5;
    const cz = az + this._hz * (SPINE0 + SPINE1) * 0.5;
    this.centre.set(cx, gy(cx, cz), cz);

    /** The carrier's entry point, derived exactly as `Crash`'s is. */
    const mFall = MOTHER_HIT - MOTHER_IN;
    const mPath = mFall * MOTHER_SPEED;
    const mHoriz = Math.sqrt(Math.max(1, mPath * mPath - MOTHER_CLIMB * MOTHER_CLIMB));
    this._mex = ax - this._hx * mHoriz;
    this._mez = az - this._hz * mHoriz;
    this._mey = this._ay + MOTHER_CLIMB;
    this._mFall = mFall;
    this._mPitch = Math.atan2(MOTHER_CLIMB, mHoriz);
    /** Origin height on the frame of contact: nose on the ground, pitch on. */
    this._mContactY = this._ay + 37 * Math.sin(this._mPitch);

    this._buildDrones(physics);
    this._buildMother(physics);
    this._buildFlames(physics);
    this._buildDetonation(physics);
    this._buildBreakup(physics);
    this._park();
    ctx.scene.add(this.group);

    this._bakeDenial(ctx.peek('ai'), world, physics);

    this.ready = true;
    this.buildMs = performance.now() - t0;
    console.info(
      `[skyfall] baked in ${this.buildMs.toFixed(0)}ms — 5 drones down between ` +
        `t=${DRONE_HIT[0]} and t=${DRONE_HIT[DRONE_HIT.length - 1]}, the carrier ` +
        `(${this._mLen.toFixed(0)} x ${this._mSpan.toFixed(0)} x ${this._mTall.toFixed(0)} m) ` +
        `enters at (${this._mex.toFixed(0)}, ${this._mez.toFixed(0)}) ${MOTHER_CLIMB} m up, ` +
        `${mFall.toFixed(1)}s of approach at ${MOTHER_SPEED} m/s, first contact ` +
        `(${ax.toFixed(0)}, ${az.toFixed(0)}) at t=${MOTHER_HIT}, ploughs ${len.toFixed(0)} m ` +
        `to (${bx.toFixed(0)}, ${bz.toFixed(0)}); the region is ` +
        `${(2 * (this._sLen * 0.5 + REGION_R)).toFixed(0)} x ${(2 * REGION_R).toFixed(0)} m ` +
        `(${(Math.PI * REGION_R * REGION_R + 2 * this._sLen * REGION_R).toFixed(0)} m2) in ` +
        `${this._cells} cells, ${this._quads} quads, burns ${BURN_S}s at ${BURN_DPS} dps`
    );
    console.info(
      `[skyfall] the detonation: ${this._detAdd} additive + ${this._detSmoke} alpha quads and ` +
        `${CHUNKS} airframe chunks, all baked, all closed-form off one uniform each; ` +
        `the fireball reaches ${this._detR.toFixed(0)} m, the column ${this._detTop.toFixed(0)} m up, ` +
        `the front ${WAVE_R} m in ${WAVE_S}s; ${this._chunkFloat.toFixed(2)} m is the highest ` +
        'chunk centre over its own ground at rest'
    );
    return this;
  }

  /* ------------------------------------------------------------------ wave 2 */
  /**
   * THE FIVE, AND THEY ARE FLYING WINGS BECAUSE NOBODY IS IN THEM.
   *
   * `Bomber._buildAircraft`'s rule is the one that matters — the silhouette
   * carries the telegraph — and the telegraph here is "there is no cockpit on
   * that". A blended body, two straight panels, two small canted fins and no
   * canopy, no windows and no tail. 13.8 m across against the carrier's 78, so
   * when the third wave arrives the scale of it is established by comparison
   * with something the player watched five of.
   *
   * They share ONE geometry and ONE material. Five `Mesh`es rather than an
   * `InstancedMesh` because each one wants its own matrix anyway and five
   * `Matrix4.compose` calls a frame for four seconds is not a budget.
   */
  _buildDrones(physics) {
    const geo = mergeGeometries([
      boxGeo(4.0, 1.8, 7.0, 0, 0, 0),               // body
      boxGeo(2.4, 1.1, 2.8, 0, -0.15, 4.3),         // nose
      boxGeo(5.6, 0.7, 4.4, -4.5, 0.15, -0.7, 0, 0.09),  // port panel
      boxGeo(5.6, 0.7, 4.4, 4.5, 0.15, -0.7, 0, -0.09),  // starboard panel
      boxGeo(0.5, 1.9, 1.8, -2.3, 1.2, -2.7, 0, 0.22),   // fins, canted out
      boxGeo(0.5, 1.9, 1.8, 2.3, 1.2, -2.7, 0, -0.22),
      boxGeo(1.6, 1.0, 3.2, 0, -0.9, -1.2),         // the weapons pallet
    ]);
    const mat = this._hullMaterial('metal_dark', 0x35322e, 0x1a0702);
    this._droneGeo = geo;
    this._droneMat = mat;
    this.drones = [];
    this._dex = new Float32Array(5);
    this._dez = new Float32Array(5);
    this._dey = new Float32Array(5);
    this._dix = new Float32Array(5);
    this._diy = new Float32Array(5);
    this._diz = new Float32Array(5);
    this._dPitch = new Float32Array(5);
    /** Perpendicular to the plough, for the `v` half of `DRONE_AT`. */
    const px = -this._hz;
    const pz = this._hx;
    for (let i = 0; i < DRONE_AT.length; i++) {
      const [u, v] = DRONE_AT[i];
      const x = this.centre.x + this._hx * u + px * v;
      const z = this.centre.z + this._hz * u + pz * v;
      this._dix[i] = x;
      this._diz[i] = z;
      this._diy[i] = physics.groundHeight(x, z, 400);
      /**
       * ITS OWN BEARING OUT OF THE SAME SKY. `DRONE_BEARING` is degrees east of
       * due south, so the entry direction is (sin, -cos) — the satellite's own
       * is 10.5° on this scale and the carrier's is 38.5°, and these five fan
       * between and around them.
       */
      const b = DRONE_BEARING[i] * DEG;
      const ex = Math.sin(b);
      const ez = -Math.cos(b);
      const fall = DRONE_HIT[i] - DRONE_IN;
      const path = fall * DRONE_SPEED;
      const horiz = Math.sqrt(Math.max(1, path * path - DRONE_CLIMB * DRONE_CLIMB));
      this._dex[i] = x + ex * horiz;
      this._dez[i] = z + ez * horiz;
      this._dey[i] = this._diy[i] + DRONE_CLIMB;
      this._dPitch[i] = Math.atan2(DRONE_CLIMB, horiz);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `match_skyfall_drone_${i}`;
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.userData.owNoShadow = true;
      this.group.add(mesh);
      this.drones.push(mesh);
    }
  }

  /* ------------------------------------------------------------------ wave 3 */
  /**
   * THE CARRIER, AND IT IS ALREADY COMING APART.
   *
   * Same rule as the satellite's airframe: at 500 m this has to read as
   * something that is FINISHED, not as something arriving. So it is a very
   * large fuselage with a flight-deck hump on top of it, one whole wing, the
   * starboard outer panel torn off at the root (it is lying in the fire 34 m
   * away — @see `_panel`), a bent fin and four nacelles of which one is gone.
   *
   * IT IS SEATED ON THE GROUND IT ACTUALLY LANDS ON. `Crash._groundAlong`'s
   * note is the lesson and it was expensive: the satellite finished its skid
   * 2.2 m UNDER the turf because the impact point's ground is 1.6 m and the far
   * end of the plough is 3.8 m, and no raycast could ever have said so because
   * the wreck carries no collision. This hull is 82 m long, so the same error
   * would be four times as visible. Four `groundHeight` probes at boot — nose,
   * tail and both wing roots — give the settled PITCH and ROLL directly, and
   * the origin is then dropped so the belly is 2.5 m under the mean ground: a
   * thing this heavy does not rest ON a field, it is IN one.
   */
  _buildMother(physics) {
    const parts = [
      boxGeo(10.0, 10.0, 30, 0, 0.6, -28),          // rear fuselage
      boxGeo(11.5, 11.5, 46, 0, 0, 2),              // main fuselage
      boxGeo(9.5, 7.0, 22, 0, 6.6, 13),             // flight-deck hump
      boxGeo(8.5, 8.0, 14, 0, -1.8, 30, 0, 0, 0.17), // nose, crushed and dug in
      boxGeo(34, 4.4, 30, 0, 0.6, -4),              // centre wing box
      boxGeo(22, 2.6, 20, -28, -1.6, -5, 0, 0.10),  // port outer wing, drooped
      boxGeo(13, 3.6, 24, 15.5, 1.2, -5, 0, -0.30), // starboard root, torn
      boxGeo(7.4, 7.4, 17, -20, -3.6, 4),           // nacelles
      boxGeo(7.4, 7.4, 17, -34, -4.6, -2),
      boxGeo(7.4, 7.4, 17, 20, -3.4, 4),
      boxGeo(2.6, 22, 22, 0, 13, -38, 0, 0.34),     // fin, bent
      boxGeo(28, 2.0, 10, 0, 6.5, -38),             // tailplane
      boxGeo(6.0, 3.0, 9.0, -3.0, 6.4, -14, 0.4),   // plating torn off the spine
      boxGeo(4.0, 2.4, 7.0, 4.2, 5.6, -2, -0.6),
    ];
    /** MEASURED off the merged geometry by `_sfseat.mjs`, not added up here. */
    this._mLen = 86.6;
    /** As it ARRIVES. The torn starboard panel is a further 29.6 m. */
    this._mSpan = 62.8;
    /** Outboard nacelle belly to the top of the fin. */
    this._mTall = 32.1;
    const geo = mergeGeometries(parts);
    const mat = this._hullMaterial('metal_rust', 0x3f3931, 0x030100);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'match_skyfall_mother';
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.userData.owNoShadow = true;
    this.group.add(mesh);
    this.mother = mesh;
    this.motherMat = mat;
    this.motherGeo = geo;

    /**
     * THE TORN STARBOARD PANEL. It is a separate mesh because it is a separate
     * object on the ground — it comes off in the air and it is lying in the
     * fire when the carrier stops, 34 m off the fuselage. Parked under the map
     * for the whole flight and placed, once, on the frame of contact, from a
     * pose solved here.
     */
    const pGeo = mergeGeometries([
      boxGeo(24, 2.4, 18, 0, 0, 0, 0, 0.06),
      boxGeo(9, 1.6, 11, 13, 0.7, -1.5, 0, 0.2),
      boxGeo(7.0, 6.6, 15, -7, -2.0, 2, 0, 0.1),   // the nacelle that went with it
    ]);
    const pMesh = new THREE.Mesh(pGeo, mat);
    pMesh.name = 'match_skyfall_panel';
    pMesh.matrixAutoUpdate = false;
    pMesh.frustumCulled = false;
    pMesh.userData.owNoShadow = true;
    this.group.add(pMesh);
    this._panel = pMesh;
    this._panelGeo = pGeo;

    /* ---- seat both of them on the ground they land on ------------------- */
    const gy = (x, z) => physics.groundHeight(x, z, 400);
    const px = -this._hz;
    const pz = this._hx;
    /** The origin sits 37 m behind the nose, and the nose stops at `to`. */
    const ox = this.impact.x - this._hx * 37;
    const oz = this.impact.z - this._hz * 37;
    const yNose = gy(this.impact.x, this.impact.z);
    const yTail = gy(ox - this._hx * 49, oz - this._hz * 49);
    const yPort = gy(ox - px * 30, oz - pz * 30);
    const yStbd = gy(ox + px * 30, oz + pz * 30);
    /**
     * The ground's own pitch along the hull, plus 0.055 rad of nose-down: it
     * did not land, it drove in.
     */
    this._mRestPitch = Math.atan2(yNose - yTail, 86) - 0.055;
    /** …and the ground's roll across it, plus a list onto the whole wing. */
    this._mRestRoll = Math.atan2(yStbd - yPort, 60) + 0.085;
    this._mox = ox;
    this._moz = oz;
    /** Belly 2.5 m under the mean ground. Fuselage half-height is 5.75. */
    this._moy = (yNose + yTail + yPort + yStbd) * 0.25 + 3.25;

    /** The panel, 34 m off the fuselage on the starboard side, in the fire. */
    const qx = this.centre.x + this._hx * 18 + px * 31;
    const qz = this.centre.z + this._hz * 18 + pz * 31;
    this._pax = qx;
    this._paz = qz;
    this._pay = gy(qx, qz) + 0.6;
    this._paYaw = this._yaw + 0.9;
    this._paRoll = 0.22;
    this._paPitch = 0.06;
  }

  /** Same reasoning as `Crash._hullMaterial`: our own tint on the library bake. */
  _hullMaterial(name, tint, emissive) {
    const set = this._lib?.getTextureSet?.(name) ?? null;
    const mat = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.74,
      metalness: 0.28,
      dithering: true,
      /**
       * IT IS ON FIRE, SO IT IS NEVER BLACK — AND THAT IS AS FAR AS IT GOES.
       *
       * The satellite's hull carries 0x2a0e04 and is right to: it is a 15 m
       * object usually seen at 300 m against a night sky, where a warm bias is
       * the only thing that says it is burning. PHOTOGRAPHED at 86 m and 30 m
       * away, the same value is a catastrophe — `composite.js` multiplies this
       * frame by ~14x before AgX, so (0.17, 0.06, 0.015) arrives at (2.4, 0.83,
       * 0.2), the red channel is far over the shoulder everywhere on the hull
       * at once, and the aeroplane is a flat orange silhouette with no shading
       * anywhere in it. It is the SAME failure the flames had as 189 white
       * paper cones, in the other primary.
       *
       * 0x030100 is (0.012, 0.004, 0) — an ember under exposure, not a light.
       * MEASURED down to it: at 0x090200 with the region's own lights at 2600
       * candela the hull still photographed as one flat orange mass 86 m long
       * (`WRECK-A-side-nofire.png`), because at night EVERY lit surface in this
       * composite is over the shoulder in red at once. What makes the wreck read
       * is the fire AROUND it and the darkness ON it. @see `_regionLight`.
       */
      emissive: new THREE.Color(emissive),
    });
    mat.name = `skyfall_${name}`;
    if (set) {
      mat.map = set.albedo;
      mat.normalMap = set.normal;
      mat.normalScale.set(1.2, 1.2);
      mat.roughnessMap = set.orm;
    }
    this.ctx.peek('render')?.patcher?.patch?.(mat);
    return mat;
  }

  /* -------------------------------------------------------------- the fire */
  /**
   * THE REGION'S FLAMES. Same material, same one uniform, same closed form as
   * the satellite's scar — @see `src/match/fire.js` and `Crash._buildFlames`
   * for every measurement behind the shape and the colour, none of which is
   * restated here. What IS different is three things:
   *
   *   THE LATTICE IS A LATTICE. The scar is a line of 27 cells; this is a
   *   jittered grid over a capsule with a RAGGED EDGE — a cell is kept if it
   *   falls inside `REGION_R * (0.90..1.04)` of the spine, jittered per cell —
   *   because a fire with a drawn-compass boundary is a decal, not a fire.
   *
   *   EVERY CELL HAS ITS OWN GROUND, AND SO DOES EVERY QUAD. Same probe, same
   *   reason (`Crash._buildFlames`: 23 tongues finished more than a metre under
   *   the turf when they took their cell's height instead of their own).
   *
   *   THE LIGHT TIME IS A CAUSAL ORDER. `aFire.x` is when a quad lights, and it
   *   is the MINIMUM of what the five drones and the carrier do to that cell:
   *   a drone lights a 16 m crater the moment it lands, and the carrier lights
   *   its furrow as it passes and the fire runs outward from it at 40 m/s. So
   *   the region catches in five patches between t=14.2 and t=17.6, and then
   *   the carrier drags a line of fire through the middle of it and the whole
   *   thing joins up. The player sees WHY the west is burning.
   */
  _buildFlames(physics) {
    const rng = this.rng;
    const px = -this._hz;
    const pz = this._hx;
    /** Half the extent along the plough, plus the caps. */
    const halfU = this._sLen * 0.5 + REGION_R;
    const nU = Math.ceil((halfU * 2) / CELL_STEP);
    const nV = Math.ceil((REGION_R * 2) / CELL_STEP);
    const cxs = [];
    const czs = [];
    const cts = [];
    for (let iu = 0; iu <= nU; iu++) {
      for (let iv = 0; iv <= nV; iv++) {
        const u = -halfU + (iu / nU) * halfU * 2 + rng.range(-CELL_STEP * 0.4, CELL_STEP * 0.4);
        const v = -REGION_R + (iv / nV) * REGION_R * 2 + rng.range(-CELL_STEP * 0.4, CELL_STEP * 0.4);
        /** Distance from the capsule's spine, in the region's own frame. */
        const su = Math.max(0, Math.abs(u) - this._sLen * 0.5);
        const d = Math.hypot(su, v);
        if (d > REGION_R * rng.range(0.90, 1.04)) continue;
        const x = this.centre.x + this._hx * u + px * v;
        const z = this.centre.z + this._hz * u + pz * v;
        cxs.push(x);
        czs.push(z);
        cts.push(this._lightAt(x, z));
      }
    }
    const cells = cxs.length;
    this._cells = cells;
    this._cx = Float32Array.from(cxs);
    this._cz = Float32Array.from(czs);
    this._ct = Float32Array.from(cts);
    this._cy = new Float32Array(cells);
    for (let i = 0; i < cells; i++) this._cy[i] = physics.groundHeight(this._cx[i], this._cz[i], 400);

    const per = TONGUES + BED;
    const n = cells * per;
    this._quads = n;
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = g.index;
    geo.attributes.position = g.attributes.position;
    geo.attributes.uv = g.attributes.uv;
    g.dispose();

    const fire = new Float32Array(n * 4);
    const at = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const kind = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    let k = 0;
    let lifted = 0;
    for (let c = 0; c < cells; c++) {
      for (let j = 0; j < per; j++, k++) {
        const bed = j >= TONGUES;
        const a = rng.range(0, Math.PI * 2);
        /** Same bias as the scar's: inward for tongues, flat for the bed. */
        const r = Math.pow(rng.float(), bed ? 0.95 : 1.5) * CELL_STEP * 0.78;
        const x = this._cx[c] + Math.cos(a) * r;
        const z = this._cz[c] + Math.sin(a) * r;
        const y = physics.groundHeight(x, z, 400);
        if (Math.abs(y - this._cy[c]) > 0.5) lifted++;
        at.array[k * 4 + 0] = x;
        at.array[k * 4 + 1] = y - (bed ? 0.35 : 0.25);
        at.array[k * 4 + 2] = z;
        kind.array[k] = bed ? 1 : 0;
        if (bed) {
          at.array[k * 4 + 3] = rng.range(2.2, 5.4);
          fire[k * 4 + 2] = rng.range(0.9, 2.6);
          fire[k * 4 + 3] = rng.range(0.7, 1.9);
        } else {
          at.array[k * 4 + 3] = rng.range(0.44, 1.35);
          const u = rng.float();
          /**
           * TALLER THAN THE SCAR'S, AND IT IS A DISTANCE ARGUMENT. Photographed
           * from zone D at 100 m with the scar's own `1.5 + u^2 * 3.9`, this
           * region was a thin orange line on the horizon while the 24 m scar
           * beside it read as a fire: 88 m of DEPTH compresses to almost no
           * screen height at a 1.7 m eye, so the only thing that gives a region
           * vertical presence at range is the height of the flames in it. A
           * carrier's fuel load throws taller flames than a satellite's anyway.
           */
          fire[k * 4 + 2] = 2.0 + u * u * 6.6;
          fire[k * 4 + 3] = rng.range(2.2, 4.6);
        }
        fire[k * 4 + 0] = this._ct[c] + rng.range(0, 0.6);
        fire[k * 4 + 1] = rng.range(0, 20);
      }
    }
    geo.setAttribute('aAt', at);
    geo.setAttribute('aFire', new THREE.InstancedBufferAttribute(fire, 4));
    geo.setAttribute('aKind', kind);
    geo.instanceCount = n;
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(this.centre.x, this.centre.y + 5, this.centre.z),
      halfU + CELL_STEP
    );
    this._lifted = lifted;

    this._fireU = { uT: { value: -1 }, uFade: { value: 1 }, uGain: { value: FIRE_GAIN } };
    const mat = makeFireMaterial(this._fireU);
    mat.name = 'skyfall_fire';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'match_skyfall_fire';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 6;
    mesh.visible = false;
    this.group.add(mesh);
    /** `flames`, not `fire` — @see the note in `Crash._buildFlames`. */
    this.flames = mesh;
    this.fireMat = mat;
    this.fireGeo = geo;
  }

  /**
   * WHEN THIS PATCH OF GROUND CATCHES, on the region's clock (0 = the first
   * drone landing). The minimum of six causes, and every one of them is a thing
   * the player watched happen.
   */
  _lightAt(x, z) {
    let best = Infinity;
    for (let i = 0; i < DRONE_HIT.length; i++) {
      const d = Math.hypot(x - this._dix[i], z - this._diz[i]);
      if (d > DRONE_LIGHT_R) continue;
      const t = DRONE_HIT[i] - DRONE_HIT[0] + d / DRONE_SPREAD_V;
      if (t < best) best = t;
    }
    /** The furrow: how far along the skid this cell is, and how far off it. */
    const dx = x - TRACK.from[0];
    const dz = z - TRACK.from[1];
    const s = dx * this._hx + dz * this._hz;
    const perp = Math.abs(dx * -this._hz + dz * this._hx);
    /**
     * `_poseAt` skids on `d = 1 - (1-u)^2`, so the time to reach a fraction `f`
     * of the way along is `PLOUGH * (1 - sqrt(1 - f))`. Inverted here rather
     * than searched, for the same reason the plough's own voice differentiates
     * the curve instead of measuring it: this file authored the curve.
     */
    const f = Math.max(0, Math.min(1, s / this._skid));
    const tPlough = MOTHER_PLOUGH * (1 - Math.sqrt(1 - f));
    const t = MOTHER_HIT - DRONE_HIT[0] + tPlough + perp / SPREAD_V;
    return Math.max(0, Math.min(best, t));
  }

  /* ====================================================================== */
  /*  THE DETONATION, BAKED AT BOOT                                         */
  /* ====================================================================== */

  /**
   * ────────────────────────────────────────────────────────────────────────
   * SIX THINGS, ONE CLOCK, TWO DRAW CALLS, AND NOT ONE PARTICLE SLOT
   * ────────────────────────────────────────────────────────────────────────
   * @see the block comment on `DET_CORE` for what was there before this and
   * how it was measured; @see `src/fx/detonation.js` for the shader. Every
   * number below is authored HERE, because this file is the one that knows how
   * big the aeroplane is and where it lands.
   *
   * The six are ordered the way a real detonation is ordered, and the order IS
   * the effect:
   *
   *   CORE     0.0-0.4 s   white-hot, ~30 m, and gone before the eye settles
   *   FIREBALL 0.0-2.6 s   the mass, expanding on a decelerating curve and
   *                        rising on its own heat, cooling red as it goes
   *   WALL     0.0-5.2 s   the ground front, thrown radially at up to 150 m/s
   *   EMBERS   0.0-5.2 s   520 burning fragments on ballistic arcs
   *   SHROUD   0.1-9.4 s   dark smoke rolling off it — the SILHOUETTE, and the
   *                        only part of this that is not additive
   *   COLUMN   0.05-5.9 s  and then it goes UP, which is the 240 m read
   *
   * THE ORIGIN IS FIRST CONTACT AND NOT THE WRECK. `TRACK.from` is where the
   * nose hits at t=18.4; the wreck finishes 96 m further on at t=23.8. The
   * detonation belongs to the ground contact, and it stays where the ground
   * contact was while the aeroplane goes on without most of itself.
   */
  _buildDetonation(physics) {
    const rng = this.rng;
    const TAU = Math.PI * 2;
    const ax = TRACK.from[0];
    const az = TRACK.from[1];
    const ay = this._ay;
    const add = new BlastBuilder(DET_CORE + DET_BALL + DET_COLUMN + DET_EMBER);
    const dark = new BlastBuilder(DET_SHROUD + DET_WALL);
    let reach = 0;
    let top = 0;
    /** Terminal displacement of one quad, closed form, for the report only. */
    const note = (r, vy, k, accel, life, y0) => {
      const F = (1 - Math.exp(-k * life)) / k;
      if (r > reach) reach = r;
      const h = y0 - ay + vy * F + (accel / k) * (life - F);
      if (h > top) top = h;
    };

    /* ---- the core ------------------------------------------------------ */
    for (let i = 0; i < DET_CORE; i++) {
      const a = rng.range(0, TAU);
      const r = Math.pow(rng.float(), 0.6) * 7;
      const sp = rng.range(4, 26);
      add.push({
        x: ax + Math.cos(a) * r, y: ay + rng.range(1.5, 9.0), z: az + Math.sin(a) * r,
        vx: Math.cos(a) * sp, vy: rng.range(6, 26), vz: Math.sin(a) * sp,
        r0: rng.range(5, 11), r1: rng.range(14, 26),
        birth: rng.range(0, 0.05), life: rng.range(0.18, 0.40),
        drag: 3.4, accel: 6,
        /**
         * THE ONE PLACE WHITE IS ALLOWED. A fuel-air detonation genuinely has a
         * white centre for a tenth of a second and this is it — 48 quads, gone
         * by 0.4 s. What it may not have is a white BODY, which is what the
         * shipping build had at every range. @see `src/match/fire.js`.
         */
        cr: 1.0, cg: rng.range(0.44, 0.62), cb: rng.range(0.14, 0.26),
        peak: rng.range(2.4, 4.0),
        kind: KIND.FIRE, seed: rng.float(), aCurve: 0.55, sCurve: 0.30,
      });
    }

    /* ---- the fireball -------------------------------------------------- */
    for (let i = 0; i < DET_BALL; i++) {
      const a = rng.range(0, TAU);
      const r = Math.pow(rng.float(), 0.55) * 26;
      const sp = rng.range(8, 44);
      const life = rng.range(0.9, 2.6);
      const k = rng.range(1.5, 2.6);
      /** Inner puffs are hotter. A fireball with one colour is a balloon. */
      const hot = 1 - r / 26;
      add.push({
        x: ax + Math.cos(a) * r, y: ay + rng.range(0.5, 18), z: az + Math.sin(a) * r,
        vx: Math.cos(a) * sp, vy: rng.range(4, 34), vz: Math.sin(a) * sp,
        r0: rng.range(5, 12), r1: rng.range(15, 32),
        birth: rng.range(0, 0.22), life, drag: k, accel: 7,
        cr: 1.0, cg: 0.095 + hot * 0.215, cb: 0.005 + hot * 0.038,
        peak: rng.range(0.9, 1.8),
        kind: KIND.FIRE, seed: rng.float(), aCurve: 0.95, sCurve: 0.34,
      });
      note(r + (sp * (1 - Math.exp(-k * life))) / k, 20, k, 7, life, ay + 9);
    }

    /* ---- the column ---------------------------------------------------- */
    for (let i = 0; i < DET_COLUMN; i++) {
      const a = rng.range(0, TAU);
      const r = Math.pow(rng.float(), 0.7) * 14;
      const vy = rng.range(40, 95);
      const k = rng.range(0.9, 1.25);
      const life = rng.range(2.2, 5.0);
      const y0 = ay + rng.range(2, 22);
      add.push({
        x: ax + Math.cos(a) * r, y: y0, z: az + Math.sin(a) * r,
        vx: Math.cos(a) * rng.range(2, 14), vy, vz: Math.sin(a) * rng.range(2, 14),
        r0: rng.range(6, 14), r1: rng.range(20, 44),
        /**
         * IT LEAVES OVER NEARLY A SECOND, NOT ON ONE FRAME. A column whose every
         * quad is born at t=0 is a rod that appears; one that is fed for 0.9 s
         * is a column that CLIMBS, which is the thing a man 240 m away actually
         * watches happen.
         */
        birth: rng.range(0.05, 0.9), life, drag: k, accel: 3.0,
        cr: 1.0, cg: rng.range(0.075, 0.175), cb: rng.range(0.005, 0.022),
        peak: rng.range(0.7, 1.3),
        kind: KIND.FIRE, seed: rng.float(), aCurve: 1.25, sCurve: 0.45,
      });
      note(r, vy, k, 3.0, life, y0);
    }

    /* ---- the embers ---------------------------------------------------- */
    for (let i = 0; i < DET_EMBER; i++) {
      const a = rng.range(0, TAU);
      const el = rng.range(0.12, 1.25);
      const sp = rng.range(35, 130);
      const k = rng.range(0.25, 0.6);
      const life = rng.range(1.4, 5.2);
      add.push({
        x: ax + Math.cos(a) * rng.range(0, 12), y: ay + rng.range(1.5, 16),
        z: az + Math.sin(a) * rng.range(0, 12),
        vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp,
        vz: Math.sin(a) * Math.cos(el) * sp,
        r0: rng.range(0.5, 1.9), r1: rng.range(0.2, 0.9),
        birth: rng.range(0, 0.35), life, drag: k, accel: -19,
        cr: 1.0, cg: rng.range(0.30, 0.55), cb: rng.range(0.03, 0.12),
        peak: rng.range(5, 17),
        kind: KIND.EMBER, seed: rng.float(), aCurve: 0.6, sCurve: 0.7,
      });
      note((Math.cos(el) * sp * (1 - Math.exp(-k * life))) / k, 0, k, 0, life, ay);
    }

    /* ---- the shroud ---------------------------------------------------- */
    for (let i = 0; i < DET_SHROUD; i++) {
      const a = rng.range(0, TAU);
      const r = Math.pow(rng.float(), 0.6) * 34;
      dark.push({
        x: ax + Math.cos(a) * r, y: ay + rng.range(2, 30), z: az + Math.sin(a) * r,
        vx: Math.cos(a) * rng.range(3, 24), vy: rng.range(8, 52), vz: Math.sin(a) * rng.range(3, 24),
        r0: rng.range(8, 18), r1: rng.range(30, 64),
        birth: rng.range(0.1, 1.4), life: rng.range(3.5, 8.0),
        drag: rng.range(0.7, 1.2), accel: 1.6,
        /**
         * NEARLY BLACK IN SOURCE, and it has to be: this is the only part of the
         * event drawn with `NormalBlending`, so it is the only part that can put
         * a HOLE in the sky. An additive detonation has no silhouette at all —
         * which is half of why the shipping one read as weather.
         */
        cr: 0.045, cg: 0.038, cb: 0.035, peak: rng.range(0.75, 1.15),
        kind: KIND.SMOKE, seed: rng.float(), aCurve: 1.5, sCurve: 0.5,
      });
    }

    /* ---- the ground front ---------------------------------------------- */
    for (let i = 0; i < DET_WALL; i++) {
      /**
       * EVENLY SPACED AND ONLY SLIGHTLY JITTERED, unlike everything else here.
       * A ring is the one shape in this event whose whole meaning is that it is
       * CONTINUOUS: a wall of dust with gaps in it is a scatter of dust.
       */
      const a = (i / DET_WALL) * TAU + rng.range(-0.05, 0.05);
      const sp = rng.range(70, 150);
      const k = rng.range(0.85, 1.25);
      const life = rng.range(2.6, 5.2);
      dark.push({
        x: ax + Math.cos(a) * rng.range(4, 16), y: ay + rng.range(0.4, 5.0),
        z: az + Math.sin(a) * rng.range(4, 16),
        vx: Math.cos(a) * sp, vy: rng.range(1.5, 9), vz: Math.sin(a) * sp,
        r0: rng.range(4, 9), r1: rng.range(22, 48),
        birth: rng.range(0, 0.12), life, drag: k, accel: -1.4,
        cr: 0.115, cg: 0.090, cb: 0.066, peak: rng.range(0.7, 1.0),
        kind: KIND.DUST, seed: rng.float(), aCurve: 1.6, sCurve: 0.45,
      });
      note((sp * (1 - Math.exp(-k * life))) / k, 0, k, 0, life, ay);
    }

    this._detR = reach;
    this._detTop = top;
    this._detAdd = add.i;
    this._detSmoke = dark.i;

    const centre = new THREE.Vector3(ax, ay + 45, az);
    /**
     * ONE `uT` BOX, TWO MATERIALS. The uniform object is SHARED, so the frame
     * this fires writes one float and both meshes move. Two `uGain`s, because
     * the smoke's alpha and the fire's radiance are not the same quantity.
     */
    this._detU = { uT: { value: -1 }, uGain: { value: DET_GAIN } };
    this._detSU = { uT: this._detU.uT, uGain: { value: DET_SMOKE_GAIN } };

    const matA = makeBlastMaterial(this._detU, { blending: THREE.AdditiveBlending });
    matA.name = 'skyfall_blast_add';
    const matS = makeBlastMaterial(this._detSU, { blending: THREE.NormalBlending });
    matS.name = 'skyfall_blast_smoke';

    const mk = (geo, mat, order, name) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.renderOrder = order;
      /**
       * VISIBLE, WITH ONE INSTANCE. @see `BlastBuilder.finish` — three compiles
       * a program the first time an object is DRAWN and `renderer.compile`
       * walks `traverseVisible`, so a mesh hidden until t=18.4 is a shader
       * compile ON the frame this file exists to keep cheap. Instance 0 is a
       * core quad whose birth is in the future while `uT` is -1, so it collapses
       * to zero width and discards: one draw call, two triangles, no pixels.
       */
      m.visible = true;
      this.group.add(m);
      return m;
    };
    /** Smoke first: the fire is additive and has to land ON it, not under it. */
    this._blastSmoke = mk(dark.finish(centre, 300), matS, 5, 'match_skyfall_blast_smoke');
    this._blastAdd = mk(add.finish(centre, 300), matA, 7, 'match_skyfall_blast_add');
    this.blastMats = [matA, matS];
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE AIRFRAME COMES APART, ON THE TOWER'S OWN SHADER
   * ────────────────────────────────────────────────────────────────────────
   * @see `CHUNKS`. `instanceMatrix` holds the pose each chunk has ON THE FRAME
   * OF CONTACT — which is a rigid transform of the carrier and therefore
   * perfectly knowable at boot — and `aOff`/`aAxis`/`aMot` carry it to a
   * settled place on ground probed at boot. `_settleChunks` then memcpys the
   * settled matrices in and switches the animation off, exactly as
   * `Airstrike._bakeSettled` does.
   *
   * NOTHING FLOATS, BY CONSTRUCTION AND NOT BY INSPECTION. Floating rubble has
   * shipped four times on this project, once badly enough that a tank climbed
   * it into the sky, and every one of those was found by looking. A chunk's
   * settled CENTRE is put at `ground + 0.22 * largest half-extent`, so its
   * lowest point is under the turf whatever the tumble does to its attitude —
   * the same reasoning as the wreck's belly being 2.5 m under the mean ground
   * ("a thing this heavy does not rest ON a field, it is IN one"). `build()`
   * prints the worst case and `_sfblast.mjs` measures it again on the settled
   * state, because neither `_floatcheck` nor `_nffloating` can see any of this:
   * these chunks carry NO COLLISION and they are not in the `world` group.
   */
  _buildBreakup(physics) {
    const rng = this.rng;
    this._chunkU = { uT: { value: -1 }, uAnim: { value: 1 } };
    const mat = makeChunkMaterial(this.ctx, this._lib, 'metal_rust', this._chunkU);
    mat.name = 'skyfall_chunk';
    /**
     * AND IT IS ON FIRE, WHICH IS WHY IT IS NOT BLACK — AND THAT IS AS FAR AS
     * IT GOES. PHOTOGRAPHED at 151 m on the first build of this: the chunks
     * were flat BLACK QUADRILATERALS tumbling out of an orange fireball, and
     * they were right to be — the only punctual light this event has is culled
     * at `range: 90` from the camera, so at 151 m nothing lights them at all and
     * a flat-shaded box in night ambient is a silhouette. A silhouette of an
     * aeroplane panel is indistinguishable from a hole in the fireball.
     *
     * 0x0a0200 is (0.039, 0.008, 0) — under the composite's ~14x that is a dim
     * ember, not a light, and it is the same order as the wreck's own 0x030100.
     * The wreck can afford less because it is 86 m of continuous surface with
     * the fire behind it; a 4 m chunk in the air has nothing behind it but sky.
     */
    mat.emissive = new THREE.Color(0x0a0200);
    const mesh = new THREE.InstancedMesh(chunkGeometry(), mat, CHUNKS);
    mesh.name = 'match_skyfall_chunks';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.owNoShadow = true;

    const mot = new Float32Array(CHUNKS * 4);
    const off = new Float32Array(CHUNKS * 3);
    const axis = new Float32Array(CHUNKS * 3);
    const uv = new Float32Array(CHUNKS * 3);
    this._chunkStart = new Float32Array(CHUNKS * 16);
    this._chunkSettled = new Float32Array(CHUNKS * 16);

    /** The carrier's pose on the frame of contact. @see `_motherUpdate`. */
    const cq = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-this._mPitch, this._yaw, this._mRestRoll, 'YXZ')
    );
    const cp = new THREE.Vector3(
      TRACK.from[0] - this._hx * 37, this._mContactY, TRACK.from[1] - this._hz * 37
    );
    const cm = new THREE.Matrix4().compose(cp, cq, new THREE.Vector3(1, 1, 1));

    /**
     * WHERE A CHUNK COMES FROM IS A VERTEX OF THE AEROPLANE, not a point in a
     * box around it. `motherGeo` is the merged hull, so sampling its positions
     * puts every piece on a surface that is actually there — the fin, a
     * nacelle, the deck hump — and the shed mass reads as the aeroplane rather
     * than as a cloud that happened to be near it.
     */
    const src = this.motherGeo.getAttribute('position');
    const nv = src.count;
    const local = new THREE.Vector3();
    const start = new THREE.Vector3();
    const settle = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const q2 = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const ax3 = new THREE.Vector3();
    const m4 = new THREE.Matrix4();
    const mR = new THREE.Matrix4();
    const mT1 = new THREE.Matrix4();
    const mT2 = new THREE.Matrix4();
    const tint = new THREE.Color();
    const px = -this._hz;
    const pz = this._hx;
    /** The wreck's own palette. @see `_hullMaterial` — dark, because it is night. */
    const palette = [0x3f3931, 0x332e28, 0x4a4239, 0x2a2622];
    let float = -1e9;

    for (let i = 0; i < CHUNKS; i++) {
      const j = Math.min(nv - 1, (rng.float() * nv) | 0);
      local.set(src.getX(j), src.getY(j), src.getZ(j));
      start.copy(local).applyMatrix4(cm);
      sc.set(rng.range(1.0, 4.8), rng.range(0.6, 2.6), rng.range(1.0, 5.5));
      q.copy(cq).multiply(
        q2.setFromAxisAngle(
          ax3.set(rng.signed(), rng.signed(), rng.signed()).normalize(),
          rng.range(-0.5, 0.5)
        )
      );
      m4.compose(start, q, sc);
      m4.toArray(this._chunkStart, i * 16);

      /**
       * IT LANDS IN THE FIRE. Thrown outward from first contact, biased ALONG
       * the plough — the aeroplane had 40 m/s of forward speed when it came
       * apart and its pieces keep it — and every settled point is inside or on
       * the edge of the region that is about to be denied, so the debris field
       * and the impassable ground are the same place.
       */
      const a = rng.range(0, Math.PI * 2);
      const rr = rng.range(12, 95);
      const u = Math.cos(a) * rr + rng.range(6, 54);
      const v = Math.sin(a) * rr * 0.7;
      settle.set(
        TRACK.from[0] + this._hx * u + px * v, 0,
        TRACK.from[1] + this._hz * u + pz * v
      );
      const half = Math.max(sc.x, sc.y, sc.z) * 0.5;
      const g = physics.groundHeight(settle.x, settle.z, 400);
      settle.y = g + half * 0.44;
      if (settle.y - g > float) float = settle.y - g;

      off[i * 3] = settle.x - start.x;
      off[i * 3 + 1] = settle.y - start.y;
      off[i * 3 + 2] = settle.z - start.z;
      ax3.set(rng.signed(), rng.signed(), rng.signed()).normalize();
      axis[i * 3] = ax3.x; axis[i * 3 + 1] = ax3.y; axis[i * 3 + 2] = ax3.z;
      const ang = rng.range(4, 26) * (rng.float() < 0.5 ? -1 : 1);
      mot[i * 4] = rng.range(0, 0.4);
      mot[i * 4 + 1] = rng.range(1.6, 4.4);
      mot[i * 4 + 2] = rng.range(8, 48);
      mot[i * 4 + 3] = ang;
      uv[i * 3] = rng.float();
      uv[i * 3 + 1] = rng.float();
      uv[i * 3 + 2] = rng.range(0.5, 1.4);

      /**
       * THE SETTLED MATRIX IS THE SHADER'S OWN ARITHMETIC, SOLVED ON THE CPU.
       * `project_vertex` ends at `piv + R(axis, ang)*(v - piv) + aOff`, so the
       * pose the GPU stops at and the pose memcpy'd in at `_settleChunks` are
       * the same matrix and there is no snap on the frame the animation ends.
       */
      mR.makeRotationAxis(ax3, ang);
      mT1.makeTranslation(-start.x, -start.y, -start.z);
      mT2.makeTranslation(settle.x, settle.y, settle.z);
      m4.fromArray(this._chunkStart, i * 16);
      m4.premultiply(mT1).premultiply(mR).premultiply(mT2);
      m4.toArray(this._chunkSettled, i * 16);

      tint.setHex(palette[(rng.float() * palette.length) | 0]);
      mesh.setColorAt(i, tint);
    }
    this._chunkFloat = float;

    mesh.geometry.setAttribute('aMot', new THREE.InstancedBufferAttribute(mot, 4));
    mesh.geometry.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
    mesh.geometry.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 3));
    mesh.geometry.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 3));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    this.chunks = mesh;
    this.chunkMat = mat;
  }

  /* ====================================================================== */
  /*  THE NAVIGATION, BAKED AND PROVED AT BOOT                              */
  /* ====================================================================== */

  /**
   * ────────────────────────────────────────────────────────────────────────
   * TAKE THE REGION OFF THE MAP — the cell list, both labellings, and the gate
   * ────────────────────────────────────────────────────────────────────────
   * `Airstrike._bakeNavPatch` is the idiom and this is the simple half of it:
   * that one has to RE-PROBE its cells because a building changed shape, and a
   * fire changes nothing about the ground. Every cell inside the capsule simply
   * stops being walkable, so the patch is a list of indices and their old flags.
   *
   * WHAT IS NOT SIMPLE IS `comp`. `NavGrid` keeps a connected-component label
   * per cell and `findPath` uses it to refuse a search it cannot win — which is
   * the whole reason A* on this map is affordable. Holing 13 000 cells can
   * renumber every component in the grid (ids are assigned in scan order), and
   * `escape` is indexed BY component id, so a stale pair of those is a grid
   * that lies about which parts of the map can reach which. So both labellings
   * are computed HERE, at boot, by asking `NavGrid` itself to do it — its rule,
   * not a copy of its rule — and the runtime swap is two assignments.
   *
   * THE GATE IS `_verifyDenial` AND IT IS NOT OPTIONAL. @see it.
   */
  _bakeDenial(ai, world, physics) {
    const g = ai?.grid;
    this._nav = null;
    if (!g || !g.flags || !g.comp) {
      console.warn('[skyfall] no nav grid — the region will burn but it will not be denied');
      return;
    }
    const t0 = performance.now();
    /* ---- the cells, from the capsule's own AABB ------------------------- */
    const halfU = this._sLen * 0.5 + REGION_R;
    const ex = Math.abs(this._hx * halfU) + Math.abs(this._hz * REGION_R) + g.cell;
    const ez = Math.abs(this._hz * halfU) + Math.abs(this._hx * REGION_R) + g.cell;
    const ix0 = Math.max(0, g.cellX(this.centre.x - ex));
    const ix1 = Math.min(g.nx - 1, g.cellX(this.centre.x + ex));
    const iz0 = Math.max(0, g.cellZ(this.centre.z - ez));
    const iz1 = Math.min(g.nz - 1, g.cellZ(this.centre.z + ez));
    const list = [];
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = g.index(ix, iz);
        if (!g.flags[i]) continue;
        if (!this._inside(g.worldX(ix), g.worldZ(iz))) continue;
        list.push(i);
      }
    }
    if (!list.length) {
      console.warn('[skyfall] the region covers no walkable cell — nothing to deny');
      return;
    }
    const cells = Int32Array.from(list);
    const old = new Uint8Array(cells.length);
    for (let i = 0; i < cells.length; i++) old[i] = g.flags[cells[i]];

    /* ---- the intact map, measured before anything is touched ----------- */
    const probes = this._routeProbes(g, world, physics);
    const tR0 = performance.now();
    const openRoutes = this._routeCount(g, probes);
    let msRoutes = performance.now() - tR0;
    let msLabel = 0;
    const openComp = g.comp.slice();
    const openSize = g.compSize.slice();
    const openEsc = g.escape;
    const openN = g.components;

    /* ---- the same map with the west denied ----------------------------- */
    for (let i = 0; i < cells.length; i++) g.flags[cells[i]] = 0;
    const tL0 = performance.now();
    g._label();
    g._labelEscapes();
    msLabel = performance.now() - tL0;
    const shutComp = g.comp.slice();
    const shutSize = g.compSize.slice();
    const shutEsc = g.escape;
    const shutN = g.components;
    const tR1 = performance.now();
    const shutRoutes = this._routeCount(g, probes);
    msRoutes += performance.now() - tR1;

    /* ---- and back to the map the round starts on ----------------------- */
    for (let i = 0; i < cells.length; i++) g.flags[cells[i]] = old[i];
    g.comp.set(openComp);
    g.compSize = openSize;
    g.escape = openEsc;
    g.components = openN;

    const ok = this._verifyDenial(g, openComp, shutComp, openRoutes, shutRoutes, probes.n);
    this._nav = ok
      ? { g, cells, old, openComp, openSize, openEsc, openN, shutComp, shutSize, shutEsc, shutN }
      : null;
    console.info(
      `[skyfall] nav denial: ${cells.length} cells of ${g.flags.length} (${((cells.length / g.flags.length) * 100).toFixed(1)}%) ` +
        `come off the grid, ${openN} components -> ${shutN}, baked in ${(performance.now() - t0).toFixed(0)}ms ` +
        `(${msLabel.toFixed(0)}ms relabelling the grid, ${msRoutes.toFixed(0)}ms on ${probes.n} route probes)` +
        (ok ? '' : ' — REFUSED, see the error above')
    );
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE GATE: A HOLE IN THE MAP MAY NOT STRAND ANYBODY
   * ────────────────────────────────────────────────────────────────────────
   * `Airstrike._verifyRoutes` is the precedent and its argument is exactly the
   * one that applies: the mounds are the only thing in the game that changes
   * navigation mid-round, `tools/navcheck.mjs` boots and exits and therefore
   * only ever sees the intact map, so the gate has to live inside the feature.
   *
   * TWO QUESTIONS, AND THE FIRST ONE IS THE ONE THAT WOULD HAVE BEEN MISSED.
   *
   *   1. DOES IT MAKE AN ISLAND? Not "are the objectives reachable" — that is
   *      question two — but "does any piece of ground that could reach the rest
   *      of the map stop being able to". A capsule that touches the rim would
   *      seal a crescent of plain behind it, and a man spawning or falling into
   *      that crescent is a man who plays no more of the match. It is checked
   *      by comparing the two labellings CELL BY CELL: for every component of
   *      the intact grid, the cells of it that survive must all carry ONE label
   *      in the holed grid. Anything else is a component that has been split,
   *      which is the definition of an island.
   *
   *   2. CAN EVERYTHING STILL REACH EVERYTHING? Ten spawn points and five zone
   *      centres, every pair, on both grids. A route the intact map has and the
   *      holed map does not is a refusal.
   *
   * A FAILURE IS A REFUSAL AND NOT A DEGRADATION. The fire still falls, still
   * burns and still kills — those are pictures and damage, and both are true
   * whatever the grid says. What it loses is the right to take ground off the
   * bots, because a bot that cannot reach a capture point is the one failure
   * this map is not allowed to have: 「もっと動き回れ」「占領しにいけ」.
   */
  _verifyDenial(g, openComp, shutComp, openRoutes, shutRoutes, nProbes) {
    /* ---- 1. islands ----------------------------------------------------- */
    const seen = new Map();
    /** newLabel -> how many cells landed on it, so the SMALLER side is named. */
    const size = new Map();
    let split = 0;
    for (let i = 0; i < shutComp.length; i++) {
      const a = openComp[i];
      const b = shutComp[i];
      /** `-1` on either side is a cell that is not walkable in that state. */
      if (a < 0 || b < 0) continue;
      size.set(b, (size.get(b) ?? 0) + 1);
      const was = seen.get(a);
      if (was === undefined) seen.set(a, b);
      else if (was !== b) split++;
    }
    if (split) {
      /**
       * NAME THE PIECE THAT WAS CUT OFF, in cells and in metres, because "an
       * island" is not actionable and "eleven cells at (-149, 6), 7 m² behind
       * the west vertex" is. Same discipline as `Airstrike._verifyRoutes`,
       * which prints which site cost which routes rather than only that one did.
       */
      const strays = [];
      for (let i = 0; i < shutComp.length && strays.length < 400; i++) {
        const a = openComp[i];
        const b = shutComp[i];
        if (a < 0 || b < 0) continue;
        if (seen.get(a) === b) continue;
        strays.push(i);
      }
      let cx = 0;
      let cz = 0;
      for (const i of strays) {
        cx += g.worldX(i % g.nx);
        cz += g.worldZ((i / g.nx) | 0);
      }
      const n = Math.max(1, strays.length);
      const where =
        `${split} cells (${(split * g.cell * g.cell).toFixed(1)} m2) of the intact map's own ` +
        `components come out on a different component with the west denied, centred about ` +
        `(${(cx / n).toFixed(0)}, ${(cz / n).toFixed(0)}), ` +
        `${Math.hypot(cx / n, cz / n).toFixed(0)} m from the map origin`;
      /**
       * …UNLESS IT IS SMALLER THAN A MAN CAN STAND ON. `NavGrid` already refuses
       * to route to a component under `DROP_LAND_MIN` cells and `findPath`
       * re-anchors off one, so a two-cell crumb behind a boulder is not ground
       * anybody was ever going to use — it is the lattice catching the corner of
       * a rock. A REAL island is a piece of PLAIN, and a piece of plain is
       * hundreds of cells. `ISLAND_MIN` is where that line is drawn, and the
       * error above is printed either way so the number is never silent.
       */
      if (split > ISLAND_MIN) {
        console.error(
          `[skyfall] THE REGION MAKES AN ISLAND — ${where}. A piece of this plain would be ` +
            'sealed behind the fire. THE NAV DENIAL IS REFUSED; the region still burns and ' +
            'still kills, it simply does not come off the grid. Move it off the rim or ' +
            'shrink REGION_R.'
        );
        return false;
      }
      console.info(
        `[skyfall] ${where} — under the ${ISLAND_MIN} cells that could hold a man, so it is ` +
          'the 0.8 m lattice catching the corner of something and not an island. @see ISLAND_MIN.'
      );
    }

    /* ---- 2. routes ------------------------------------------------------ */
    if (shutRoutes < openRoutes) {
      console.error(
        `[skyfall] THE REGION COSTS ${openRoutes - shutRoutes} OF ${openRoutes} ROUTES between ` +
          'the spawns and the five zones. THE NAV DENIAL IS REFUSED; the region still burns ' +
          'and still kills, it simply does not come off the grid. Move it or shrink REGION_R.'
      );
      return false;
    }
    console.info(
      `[skyfall] route gate: ${openRoutes} pairs reachable intact, ${shutRoutes} with the west ` +
        `denied, over ${nProbes} spawn and zone points; ${split} cells stranded`
    );
    return true;
  }

  /**
   * The points the route gate paths between: the five zone centres and ten of
   * the ninety spawn points, snapped to the nearest walkable cell exactly as
   * `resolveLayout` snaps them. Built ONCE, off the intact grid, and reused for
   * both measurements — the same endpoints on both sides is the whole point of
   * the comparison.
   */
  _routeProbes(g, world, physics) {
    const map = layoutFor(world);
    const snap = (x, z) => {
      const y = physics.groundHeight(x, z, 400);
      const i = g.nearest(x, z, y, 14, 6);
      return i < 0 ? null : new THREE.Vector3(g.worldX(i % g.nx), g.floor[i], g.worldZ((i / g.nx) | 0));
    };
    const zones = [];
    const spawns = [];
    for (const z of map.zones) {
      const p = snap(z.level[0], z.level[1]);
      if (p) zones.push(p);
    }
    /**
     * THREE POINTS A SIDE OUT OF FORTY-FIVE, and that is not a corner cut. A
     * spawn cluster on this map is nine ranks of five inside a 24 x 20 m pad —
     * every point in it is within one A* step of every other, so a fourth one
     * measures the same route a third time. `tools/navcheck.mjs` walks all
     * ninety; this gate runs at BOOT, twice, and A* over a 400 m plain is 5.5 ms
     * a solve, so the difference between six probes and ninety is 0.4 s of
     * loading against 10 s.
     */
    for (const side of ['attack', 'defend']) {
      const list = map.spawns[side] ?? [];
      if (!list.length) continue;
      for (const at of [0, list.length >> 1, list.length - 1]) {
        const p = snap(list[at][0], list[at][1]);
        if (p) spawns.push(p);
      }
    }
    return { zones, spawns, n: zones.length + spawns.length };
  }

  /**
   * How many routes A* can still solve: every spawn to every zone, which is
   * `navcheck`'s own question, plus every zone to every zone, which is the one
   * it does not ask and the one a wall through the middle of the map would
   * break first.
   */
  _routeCount(g, probes) {
    const out = [];
    const { zones, spawns } = probes;
    let n = 0;
    for (const s of spawns) for (const z of zones) if (g.findPath(s, z, out) > 0) n++;
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) if (g.findPath(zones[i], zones[j], out) > 0) n++;
    }
    return n;
  }

  /** Apply or release the hole. Two array writes and a list walk; no search. */
  _deny(on) {
    const n = this._nav;
    if (!n || this._denied === on) return;
    const g = n.g;
    if (on) {
      for (let i = 0; i < n.cells.length; i++) g.flags[n.cells[i]] = 0;
      g.comp.set(n.shutComp);
      g.compSize = n.shutSize;
      g.escape = n.shutEsc;
      g.components = n.shutN;
    } else {
      for (let i = 0; i < n.cells.length; i++) g.flags[n.cells[i]] = n.old[i];
      g.comp.set(n.openComp);
      g.compSize = n.openSize;
      g.escape = n.openEsc;
      g.components = n.openN;
    }
    this._denied = on;
    console.info(
      `[skyfall] the west is ${on ? 'CLOSED' : 'open again'} — ${n.cells.length} nav cells ` +
        `${on ? 'off' : 'back on'} the grid`
    );
  }

  /* ====================================================================== */
  /*  FIRE                                                                  */
  /* ====================================================================== */

  /** Armed by `Crash.fire()` and by nothing else. @see the header. */
  fire() {
    if (!this.ready) return false;
    this._t = 0;
    this._puff = 0;
    this._dpuff = 0;
    this._dnext = 0;
    this.busy = true;
    for (let i = 0; i < this._hit.length; i++) this._hit[i] = false;
    this._stopPlough();
    this._fireU.uT.value = -1;
    this._fireU.uFade.value = 1;
    this.flames.visible = false;
    /**
     * EVERYTHING GOES BACK UNDER THE MAP AND STAYS HIDDEN. `_pose` is what
     * makes an airframe visible and it is only ever called once that airframe
     * is actually in the sky, so a drone with an entry two seconds away is not
     * a draw call and the carrier's wreck cannot appear before the carrier.
     */
    this._park();
    return true;
  }

  update(dt) {
    if (!this.ready) return;

    /**
     * ---- the detonation, on its own clock ------------------------------
     * NOT on `_t`. `_t` ends 0.8 s after the wreck stops, at 24.6, and the
     * shroud is still rising at 27.9 — a smoke column that vanished because the
     * airframe had finished ploughing would be the event admitting it was an
     * animation. Four assignments and one closed-form radius per frame.
     */
    if (this._det >= 0) {
      this._det += dt;
      this._detU.uT.value = this._det;
      this._chunkU.uT.value = this._det;
      this._wave(this._det);
      if (this._chunksFlying && this._det >= CHUNK_S) this._settleChunks();
      if (this._det >= DET_S) this._endDetonation();
    }

    /* ---- the west, still burning --------------------------------------- */
    if (this._burn > 0) {
      this._burn -= dt;
      this._fireU.uT.value += dt;
      /** The last fourteen seconds it goes out rather than vanishing. */
      this._fireU.uFade.value = Math.min(1, this._burn / 14);
      if (this._live) {
        this._tick -= dt;
        if (this._tick <= 0) {
          this._tick = BURN_TICK;
          this._burnPass(BURN_DPS * BURN_TICK);
        }
        this._cook -= dt;
        if (this._cook <= 0) {
          this._cook = COOK_EVERY * this.rng.range(0.55, 1.6);
          this._cookOff();
        }
        this._light -= dt;
        if (this._light <= 0) {
          this._light = LIGHT_EVERY;
          this._regionLight();
        }
      }
      if (this._burn <= 0) this._extinguish();
    }

    if (this._t < 0) return;
    this._t += dt;
    const t = this._t;

    /* ---- wave two: the five ------------------------------------------- */
    for (let i = 0; i < DRONE_HIT.length; i++) {
      if (this._hit[i]) continue;
      if (t < DRONE_IN) continue;
      if (t >= DRONE_HIT[i]) {
        this._hit[i] = true;
        this._droneHit(i);
        continue;
      }
      const u = (t - DRONE_IN) / (DRONE_HIT[i] - DRONE_IN);
      this._v.set(
        this._dex[i] + (this._dix[i] - this._dex[i]) * u,
        this._dey[i] + (this._diy[i] - this._dey[i]) * u,
        this._dez[i] + (this._diz[i] - this._dez[i]) * u
      );
      /**
       * IT IS TUMBLING AND THAT IS THE WHOLE TELEGRAPH. Three axes on three
       * incommensurate rates, seeded off the index so no two of the five are
       * ever in the same attitude. A drone that held a clean nose-down line
       * would read as one that is still being flown.
       */
      const s = t * (1.0 + i * 0.17);
      this._eul.set(-this._dPitch[i] + Math.sin(s * 1.7) * 0.9, s * 0.8 + i, s * 2.3, 'YXZ');
      this._pose(this.drones[i], this._v, this._eul);
      if (i === this._dnext) this._dv.copy(this._v);
    }
    this._droneTrail(dt, t);

    /* ---- wave three: the carrier --------------------------------------- */
    if (t >= MOTHER_IN) this._motherUpdate(dt, t);

    if (t >= MOTHER_HIT + MOTHER_PLOUGH + TAIL) {
      this._t = -1;
      this.busy = false;
    }
  }

  /** The carrier's frame: pose, trail, contact, plough, voice. */
  _motherUpdate(dt, t) {
    if (t < MOTHER_HIT) {
      const u = (t - MOTHER_IN) / this._mFall;
      /** Its nose ends the fall exactly at the first contact point. */
      this._v.set(
        this._mex + (TRACK.from[0] - this._mex) * u,
        this._mey + (this._ay - this._mey) * u,
        this._mez + (TRACK.from[1] - this._mez) * u
      );
      /**
       * The origin is 37 m behind the nose, so the whole aeroplane has to be
       * pushed back along its own heading or it flies with its wing box where
       * its nose should be. On a 15 m satellite this is a rounding error; on 86
       * metres it is the difference between landing and landing 37 m short.
       *
       * The horizontal offset is a flat 37 rather than `37·cos(pitch)`, so that
       * the last frame of the fall and the first frame of the plough put the
       * origin on exactly the same point. The 8 % foreshortening a 22° nose-down
       * attitude ought to apply is three metres on an 86 m aeroplane seen from
       * 400 m; a discontinuity at the moment of contact would not be.
       */
      this._v.x -= this._hx * 37;
      this._v.z -= this._hz * 37;
      this._v.y += 37 * Math.sin(this._mPitch);
      /** It is dying: the port wing is already going down and it is yawing. */
      const roll = this._mRestRoll * u * u + Math.sin(t * 0.62) * 0.12 * (1 - u);
      this._eul.set(-this._mPitch, this._yaw + Math.sin(t * 0.4) * 0.05, roll, 'YXZ');
      this._pose(this.mother, this._v, this._eul);
      this._trail(dt, this._v);
      return;
    }

    if (!this._hitMother) {
      this._hitMother = true;
      this._motherHit();
    }

    const skid = Math.min(MOTHER_PLOUGH, t - MOTHER_HIT);
    const u = skid / MOTHER_PLOUGH;
    const d = 1 - (1 - u) * (1 - u);
    /**
     * ATTITUDE AND HEIGHT SETTLE OVER THE FIRST 1.6 s OF THE SKID, and the
     * height is a lerp from `_mContactY` rather than a bump on the settled one.
     * `_mContactY` is the origin height at which the NOSE is exactly on the
     * ground with the descent pitch still on — 37·sin(22°) over it — and
     * without that the frame of contact puts a 22°-nose-down aeroplane's origin
     * at its resting height, which buries fourteen metres of nose.
     */
    const k = Math.min(1, skid / 1.6);
    this._v.set(
      this._mox + this._hx * this._skid * (d - 1),
      this._mContactY + (this._moy - this._mContactY) * k,
      this._moz + this._hz * this._skid * (d - 1)
    );
    /** `_mox/_moz` is where the ORIGIN rests, so the skid runs back from it. */
    this._eul.set(
      -(this._mPitch * (1 - k) + this._mRestPitch * k),
      this._yaw,
      this._mRestRoll,
      'YXZ'
    );
    this._pose(this.mother, this._v, this._eul);

    /**
     * THE VOICE, AND ITS PITCH IS THIS DERIVATIVE — the same argument
     * `Crash.update` makes and for the same reason: this file authored the
     * curve two lines up, so it is differentiated rather than measured off
     * successive positions. `d = 1 - (1-u)^2` gives a ground speed of
     * `skid * 2(1-u) / PLOUGH`, which is 36 m/s on the frame of contact and
     * falls linearly to nothing. It ENDS at `MOTHER_PLOUGH`, on a settle.
     */
    if (this._plough) {
      if (skid >= MOTHER_PLOUGH) {
        this._plough.stop();
        this._plough = null;
      } else {
        this._plough.drive(
          (this._skid * 2 * (1 - u)) / MOTHER_PLOUGH, u,
          this._v.x, this._v.y + 4, this._v.z
        );
      }
    }
  }

  /** One matrix compose into a preallocated matrix. Nothing allocates. */
  _pose(mesh, at, eul) {
    this._q.setFromEuler(eul);
    this._m.compose(at, this._q, this._sc);
    mesh.matrix.copy(this._m);
    mesh.matrixWorldNeedsUpdate = true;
    mesh.visible = true;
  }

  /**
   * THE CARRIER'S TRAIL, rate-limited exactly as the satellite's is — four
   * puffs a second over seventeen seconds is seventy emitters for the whole
   * approach, which is what `Ambience` is sized for. It is BIGGER than the
   * satellite's in every dimension because it is five times the aeroplane, and
   * it takes a light for the same reason the satellite's does: on a night map,
   * a thing this size crossing the sky has to light the ground under it.
   */
  _trail(dt, at) {
    this._puff -= dt;
    if (this._puff > 0) return;
    this._puff = 0.22;
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (!fx) return;
    fx.addSmokeColumn?.(at.x, at.y, at.z, {
      duration: 0.1, rate: 34, radius: 5.0, rise: 6.0, dark: 0.24,
      life: 8.0, growth: 9.0, ember: 0.8, haze: 0.7,
    });
    fx.haze?.(at.x, at.y, at.z, 9.0, 20, 2.0, 1.2);
    if (fx.lights) fx.lights.flash(at.x, at.y, at.z, 1, 0.5, 0.16, 3400, 0.5, 1.2, 300, 5);
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    audio?.play?.('strike_jet', at, {
      level: 1.6, dur: 0.7, maxDist: 1100, gain: 5.0, occlusion: 0.05,
    });
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE SQUADRON'S TRAIL, ROUND-ROBIN, BECAUSE THE POOL IS FOUR LIGHTS
   * ────────────────────────────────────────────────────────────────────────
   * PHOTOGRAPHED from zone A at t=5.5 on the first build: one object visible in
   * the whole sky, and it was the carrier. The five were there — 13.8 m of dark
   * grey airframe at 400 m subtends two degrees and carries no light of its
   * own, so against a night sky they were nothing at all, and 「見えるように」
   * is the entire design of this act.
   *
   * The satellite's own `Crash._trail` is the answer and it cannot simply be
   * run five times: it takes a `LightPool` slot every 0.25 s and the pool is
   * FOUR LIGHTS for the whole game. So the five share ONE emitter at the
   * satellite's own rate and take it in turn — each drone lights every 0.85 s,
   * the light pressure is exactly one trail's, and what the eye reads is a
   * group of burning objects flickering across the sky rather than five steady
   * flares, which is closer to the truth anyway: they are tumbling.
   */
  _droneTrail(dt, t) {
    this._dpuff -= dt;
    if (this._dpuff > 0) return;
    this._dpuff = 0.17;
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    const at = this._dv;
    this._dnext = (this._dnext + 1) % DRONE_HIT.length;
    if (!fx || at.y < -100) return;
    fx.addSmokeColumn?.(at.x, at.y, at.z, {
      duration: 0.1, rate: 14, radius: 1.6, rise: 4.0, dark: 0.18,
      life: 5.0, growth: 5.0, ember: 0.9, haze: 0.4,
    });
    if (fx.lights) fx.lights.flash(at.x, at.y, at.z, 1, 0.5, 0.18, 1600, 0.4, 1.4, 220, 5);
  }

  /**
   * ONE DRONE HITS. A real blast — `fx` renders the event, so this is one emit
   * and not two — a scorch, a plume, and the crater it lights is already baked
   * into `aFire.x`, so the fire simply arrives on its own.
   */
  _droneHit(i) {
    const x = this._dix[i];
    const y = this._diy[i];
    const z = this._diz[i];
    this.drones[i].visible = false;
    const p = this._blast;
    p.position = this._v2.set(x, y + 1.4, z);
    p.radius = DRONE_BLAST_R;
    p.damage = DRONE_BLAST_D;
    /** @see `_motherHit` — only the carrier draws its own fireball. */
    p.bodyR = undefined;
    p.source = 'crash';
    this.ctx.events.emit('explosion', p);
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (fx) {
      fx.scorch?.(x, y - 0.3, z, 13);
      fx.haze?.(x, y + 5, z, 12, 26, 3.4, 1.5);
      if (fx.lights) fx.lights.flash(x, y + 3, z, 1, 0.55, 0.2, 4200, 1.2, 2.4, 220, 6);
    }
    /**
     * THE FIRE STARTS HERE, ON THE FIRST OF THE FIVE. `uT` is the region's own
     * clock and its zero is `DRONE_HIT[0]`, so every `aFire.x` baked in
     * `_lightAt` is relative to this frame. The region is NOT denied yet and
     * nothing is burning yet: five craters are not a wall, and taking ground
     * off the map before there is anything on it to see would be the invisible
     * hazard this project has been shouted at for.
     */
    if (i === 0) {
      this._burn = BURN_S;
      this._fireU.uT.value = 0;
      this._fireU.uFade.value = 1;
      this.flames.visible = true;
    }
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    audio?.play?.('strike_tail', p.position, {
      level: 1.1, dur: 2.2, maxDist: 900, gain: 3.2, occlusion: 0.1,
    });
    console.info(`[skyfall] DRONE ${i + 1} of 5 down at (${x.toFixed(0)}, ${z.toFixed(0)})`);
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE CARRIER HITS, AND THIS IS THE FRAME THE MAP CHANGES SHAPE
   * ────────────────────────────────────────────────────────────────────────
   * Everything below is a write. The blast is one emit; the fire field is a
   * uniform that was already running; the wreck's settled attitude was solved
   * at boot from four ground probes; the nav denial is a list walk and two
   * array assignments over labellings computed at boot. Nothing here searches,
   * probes, allocates or compiles.
   */
  _motherHit() {
    /* ---- the picture, which is 1 728 baked quads and 180 baked chunks --- */
    this._det = 0;
    this._detU.uT.value = 0;
    this._chunkU.uT.value = 0;
    this._chunkU.uAnim.value = 1;
    this._blastAdd.geometry.instanceCount = this._detAdd;
    this._blastSmoke.geometry.instanceCount = this._detSmoke;
    this.chunks.instanceMatrix.array.set(this._chunkStart);
    this.chunks.instanceMatrix.needsUpdate = true;
    this.chunks.count = CHUNKS;
    this._chunksFlying = true;
    this._wave(0);

    const at = this._v2.set(TRACK.from[0], this._ay + 3.0, TRACK.from[1]);
    const p = this._blast;
    p.position = at;
    p.radius = MOTHER_BLAST_R;
    p.damage = MOTHER_BLAST_D;
    /**
     * THE DAMAGE IS STILL 52 m AND THE PICTURE IS NOW 14. @see `bodyR` in
     * `src/fx/explosions.js`: that recipe's particle COUNT does not scale with
     * its radius, so asking it for 52 m bought eleven 40-60 m pale sprites that
     * merged into the cream disc this whole rewrite exists to delete. At 14 m
     * the same call still lays the ground dust ring, the debris cone, the
     * embers and the crater plume exactly where they belong — at the FOOT of
     * the fireball, which is drawn above by things that are actually 60 m wide.
     *
     * The second `fx.explosion({ radius: 42 })` that used to sit below this is
     * GONE: it was a second copy of the same disc drawn over the first. Net
     * particle-ring pressure on the frame of first contact goes DOWN.
     */
    p.bodyR = 14;
    p.source = 'crash';
    this.ctx.events.emit('explosion', p);
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (fx) {
      fx.scorch?.(at.x, at.y - 3.0, at.z, 30);
      /**
       * THE REFRACTION FRONT, on the same curve as `uBlast` and reaching the
       * same 210 m. `HazeSystem` is a screen-space pass with its own 240-sprite
       * pool that neither particle ring can be spent on, so this is the one
       * shockwave that distorts what is BEHIND it — the smoke banks, the burning
       * ridge and both fires — rather than drawing over them. Two slots.
       */
      fx.hazeRing?.(at.x, at.y + 2, at.z, 18, WAVE_R, WAVE_S, 5.0);
      fx.haze?.(at.x, at.y + 26, at.z, 46, 90, 7.5, 2.8);
      /**
       * ONE LIGHT, AND IT IS THE SAME ONE SLOT THIS EVENT ALREADY TOOK.
       *
       * `LightPool` is four lights for the whole game and this asks at priority
       * 9, above everything, for two seconds — unchanged in kind. What changed
       * is the number, and it changed because of what a light IS here:
       * `LightPool.register` asks the renderer for `range: 90` and the
       * renderer's distance fade switches a light off past ~1.15x of that, so
       * this flash does not exist for anybody more than ~103 m away and cannot
       * ever be "the light on the whole map". Inside 103 m it was 15 000 cd,
       * which PHOTOGRAPHED at 30 m as a pure white screen — every channel over
       * AgX's shoulder, no fireball in it at all. 6 000 lights the ground and
       * the men standing on it and leaves the detonation its own colour; the
       * light at range is the 1 188 additive quads, which have no range limit
       * because they are geometry.
       *
       * 15 000 -> 6 000 -> 3 600, and the last step was taken because 6 000
       * still photographed the 86 m hull twenty metres away as a flat white
       * cut-out at t+0.5 s. The composite's auto-exposure takes about a second
       * to adapt, so anything this bright inside the first half second is over
       * AgX's shoulder whatever its colour was.
       */
      if (fx.lights) fx.lights.flash(at.x, at.y + 10, at.z, 1, 0.54, 0.20, 3600, 2.0, 3.0, 420, 9);
      /**
       * THE SMOKE WALL, and it is the half of "you can see where you may not
       * go" that survives daylight-adapted eyes at 250 m. Twelve persistent
       * sources over 8 500 m² — the scar takes nine over 3 800 — handed back in
       * `_extinguish`. They are NOT one per cell: 118 columns is a wall the
       * frame budget notices and a fire this size only needs its outline.
       */
      /**
       * SCORCHED GROUND UNDER THE FIRE, every fourth cell. `fx.scorch` is a
       * decal against a budget, so 129 of them is not on — 32 discs 9 m across
       * cover the region and, unlike the flames, they are still there when the
       * fire goes out, which is what a burnt field looks like.
       */
      for (let i = 0; i < this._cells; i += 4) {
        fx.scorch?.(this._cx[i], this._cy[i] - 0.3, this._cz[i], 9);
      }
      const px = -this._hz;
      const pz = this._hx;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const rr = REGION_R * 0.74;
        const u = Math.cos(a) * (rr + this._sLen * 0.5);
        const v = Math.sin(a) * rr;
        const x = this.centre.x + this._hx * u + px * v;
        const z = this.centre.z + this._hz * u + pz * v;
        const y = this.ctx.peek('physics')?.groundHeight(x, z, 400) ?? this.centre.y;
        const tag = fx.addSmokeSource?.({ x, y: y + 0.8, z }, {
          rate: 7.0, radius: 3.4, rise: 3.2, dark: 0.2, life: 7.0,
          growth: 7.0, ember: 0.7, haze: 0.6,
        });
        if (tag !== undefined && tag !== null) this._smoke.push(tag);
      }
    }
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    /**
     * THE FLOOR. @see `Crash._impact`'s note, which is the argument in full:
     * `strike_rubble` is masonry ARRIVING and `strike_tail` is mid-heavy by
     * construction, so between them an event like this has nothing under 40 Hz,
     * and `_playCollapse` is the one path that ducks the whole mix and concusses
     * the listener. `dur` and `maxDist` only — everything else is a fact about
     * the mix and lives there. One beat longer than the satellite's, because
     * this is five times the aeroplane.
     */
    audio?.play?.('collapse_sub', at, { dur: 3.6, maxDist: 1400 });
    audio?.play?.('strike_rubble', at, {
      level: 2.0, dur: 6.0, maxDist: 1400, gain: 6.4, occlusion: 0.05,
    });
    audio?.play?.('strike_tail', at, {
      level: 1.8, dur: 5.0, maxDist: 1200, gain: 4.4, occlusion: 0.1,
    });
    /** @see `Crash._impact` — `?? null`, never `??=`. A null is safe here. */
    this._plough = audio?.startPlough?.(at) ?? null;

    /* ---- the torn panel, placed once from a pose solved at boot -------- */
    this._v.set(this._pax, this._pay, this._paz);
    this._eul.set(this._paPitch, this._paYaw, this._paRoll, 'YXZ');
    this._pose(this._panel, this._v, this._eul);

    /* ---- and the map changes shape ------------------------------------ */
    this._live = true;
    this._tick = BURN_TICK;
    this._cook = COOK_EVERY;
    this._light = 0;
    this._deny(true);
    console.info(
      `[skyfall] THE CARRIER IS DOWN at (${at.x.toFixed(0)}, ${at.z.toFixed(0)}) — ` +
        `${MOTHER_BLAST_R} m blast over a ${this._detAdd + this._detSmoke} quad detonation ` +
        `(${this._detR.toFixed(0)} m across, ${this._detTop.toFixed(0)} m up), ${CHUNKS} chunks of ` +
        `airframe thrown, a ${WAVE_R} m front through both fires, ${this._cells} cells alight, ` +
        `${(Math.PI * REGION_R * REGION_R + 2 * this._sLen * REGION_R).toFixed(0)} m2 of the west ` +
        `is impassable for ${BURN_S}s`
    );
  }

  /* ====================================================================== */
  /*  WHAT THE REGION DOES TO WHATEVER IS STANDING IN IT                    */
  /* ====================================================================== */

  /**
   * Inside the capsule? One dot product, one clamp and one squared length, in
   * the plane. Called once per agent per pass — 81 of them twice a second is
   * a rounding error, and it is EXACT, which is the whole reason the burn is
   * not an explosion lattice. @see `COOK_EVERY`'s note.
   */
  _inside(x, z) {
    const dx = x - this._sx;
    const dz = z - this._sz;
    let u = dx * this._hx + dz * this._hz;
    if (u < 0) u = 0;
    else if (u > this._sLen) u = this._sLen;
    const px = dx - u * this._hx;
    const pz = dz - u * this._hz;
    return px * px + pz * pz <= this._r2;
  }

  /**
   * ONE PASS OF BURNING, over the men and the player rather than over cells.
   *
   * `a.applyDamage(amount, 'torso', null, null)` is the same call
   * `src/ai/index.js`'s own `explosion` handler makes, reached the way
   * ARCHITECTURE.md says to reach another subsystem — `ctx.peek` at runtime,
   * never an import — and `player.applyDamage(amount, from, opts)` is the
   * published one. No direction is passed for either: a fire does not come
   * from anywhere, and a hit marker pointing at the middle of a burning field
   * would be a lie about where the danger is.
   */
  _burnPass(amount) {
    const ai = this._ai ?? (this._ai = this.ctx.peek('ai'));
    const agents = ai?.agents;
    if (agents) {
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        if (!a.alive) continue;
        if (!this._inside(a.position.x, a.position.z)) continue;
        a.applyDamage(amount, 'torso', null, null);
      }
    }
    const pl = this._player ?? (this._player = this.ctx.peek('player'));
    if (pl && !pl.dead && this._inside(pl.position.x, pl.position.z)) {
      pl.applyDamage(amount, null, { type: 'burn' });
    }
  }

  /**
   * ASK THE POOL FOR THE REGION, FROM THE BOTTOM. @see `LIGHT_EVERY` for the
   * whole argument. Two lights, at the two ends of the plough, so an 86 m wreck
   * lying across the middle is lit from both sides rather than from one and
   * silhouetted from the other — and both at priority 0, so between them they
   * cost the gunfight nothing it wanted.
   */
  _regionLight() {
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (!fx?.lights) return;
    for (const u of [-this._sLen * 0.5 - 12, this._sLen * 0.5 + 12]) {
      const x = this.centre.x + this._hx * u;
      const z = this.centre.z + this._hz * u;
      fx.lights.flash(x, this.centre.y + 6, z, 1, 0.55, 0.24, 700, LIGHT_HOLD, 0.004, 150, 0);
    }
  }

  /** Fuel and ordnance going off inside the fire. @see `COOK_EVERY`. */
  _cookOff() {
    const i = Math.min(this._cells - 1, (this.rng.float() * this._cells) | 0);
    const p = this._blast;
    p.position = this._v2.set(this._cx[i], this._cy[i] + 1.6, this._cz[i]);
    p.radius = COOK_R;
    p.damage = COOK_D;
    /** @see `_motherHit` — only the carrier draws its own fireball. */
    p.bodyR = undefined;
    p.source = 'crash';
    this.ctx.events.emit('explosion', p);
  }

  /* ====================================================================== */
  /*  THE DETONATION AT RUNTIME — three writes and a radius                 */
  /* ====================================================================== */

  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE SHOCKWAVE, DRIVEN THROUGH THE FIRE THAT IS ALREADY BURNING
   * ────────────────────────────────────────────────────────────────────────
   * The carrier lands INSIDE an 8 546 m² conflagration that has been alight
   * for four seconds, 40 m from the end of a 157 m scar that is still burning,
   * and 「大爆発演出はド派手にしないと」 is answered better by making 2 700 quads
   * that are already on screen react than by drawing 2 700 more.
   *
   * `uBlast` is `vec4(x, z, wavefront radius, strength)` and BOTH fires get it
   * — this file's region and, through `opts.scarFire`, the satellite's scar.
   * The radius is the plough's own curve, `1 - (1-u)²`, which leaves at 262 m/s
   * and decelerates to nothing at `WAVE_R`; the strength falls off with it, and
   * on the frame it reaches zero the shader's branch turns off for good.
   *
   * Cost: one closed-form radius, two `Vector4.set`. No instance, no draw call,
   * no particle slot, no light. @see the `uBlast` note in `src/match/fire.js`.
   */
  _wave(t) {
    const u = Math.min(1, t / WAVE_S);
    const r = WAVE_R * (1 - (1 - u) * (1 - u));
    const s = u >= 1 ? 0 : Math.pow(1 - u, 1.3);
    this._fireU.uBlast.value.set(TRACK.from[0], TRACK.from[1], r, s);
    const scar = this._scarFire?.uBlast;
    if (scar) scar.value.set(TRACK.from[0], TRACK.from[1], r, s);
  }

  /**
   * THE DEBRIS IS DOWN. Hand the settled pose back to `instanceMatrix` and
   * switch the animation off — `Airstrike._bakeSettled` verbatim, and for its
   * reason: the vertex shader stops rotating 180 chunks about their own pivots
   * for the rest of the match, and the pose it stops at is bit-identical to the
   * one memcpy'd in. @see `_buildBreakup` for why those two are the same matrix.
   */
  _settleChunks() {
    this._chunksFlying = false;
    this.chunks.instanceMatrix.array.set(this._chunkSettled);
    this.chunks.instanceMatrix.needsUpdate = true;
    this._chunkU.uAnim.value = 0;
  }

  /**
   * The fireball is out. Both blast meshes go back to ONE instance — they stay
   * VISIBLE and keep their program (@see `_buildDetonation`) — and the clock
   * stops. The CHUNKS DO NOT MOVE: they are the aftermath, they are lying in
   * the fire, and they stay there until the round resets.
   */
  _endDetonation() {
    this._det = -1;
    this._detU.uT.value = -1;
    this._blastAdd.geometry.instanceCount = 1;
    this._blastSmoke.geometry.instanceCount = 1;
    this._fireU.uBlast.value.set(0, 0, -1, 0);
    const scar = this._scarFire?.uBlast;
    if (scar) scar.value.set(0, 0, -1, 0);
  }

  /* ====================================================================== */
  /*  ENDINGS                                                               */
  /* ====================================================================== */

  /** @see `Crash._stopPlough` — idempotent, and not folded into `_extinguish`. */
  _stopPlough() {
    if (!this._plough) return;
    this._plough.stop();
    this._plough = null;
  }

  /** The west stops burning: put the fire out, take the smoke back, open it. */
  _extinguish() {
    this._burn = 0;
    this._live = false;
    this.flames.visible = false;
    this._deny(false);
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    for (const tag of this._smoke) fx?.removeSmokeSource?.(tag);
    this._smoke.length = 0;
  }

  /** Out of sight under the map. @see `Crash._park`. */
  _park() {
    this._v.set(0, PARKED_Y, 0);
    this._eul.set(0, 0, 0, 'YXZ');
    for (const d of this.drones) {
      this._pose(d, this._v, this._eul);
      d.visible = false;
    }
    this._pose(this.mother, this._v, this._eul);
    this.mother.visible = false;
    this._pose(this._panel, this._v, this._eul);
    this._panel.visible = false;
    this._hitMother = false;
    /**
     * THE DETONATION GOES BACK TO ONE INSTANCE AND THE DEBRIS UNDER THE MAP.
     *
     * The two blast meshes stay VISIBLE with `instanceCount = 1` — that is the
     * whole prewarm argument and undoing it here would put the shader compile
     * back on the event's own frame. The 180 chunks are different: they are
     * `InstancedMesh`es whose rest pose is a real place on the plain, so
     * `count = 1` plus one parked matrix is what keeps the program alive
     * without leaving a piece of aeroplane lying in the west of a round that
     * has not had the crash yet. @see `src/match/reinforce.js`, same idiom.
     */
    this._det = -1;
    this._chunksFlying = false;
    if (this._detU) {
      this._detU.uT.value = -1;
      this._blastAdd.geometry.instanceCount = 1;
      this._blastSmoke.geometry.instanceCount = 1;
    }
    if (this.chunks) {
      this._chunkU.uT.value = -1;
      this._chunkU.uAnim.value = 1;
      this._m.makeTranslation(0, PARKED_Y, 0).toArray(this.chunks.instanceMatrix.array, 0);
      this.chunks.instanceMatrix.needsUpdate = true;
      this.chunks.count = 1;
    }
    if (this._fireU) this._fireU.uBlast.value.set(0, 0, -1, 0);
    const scar = this._scarFire?.uBlast;
    if (scar) scar.value.set(0, 0, -1, 0);
  }

  /**
   * ROUND RESET: nothing falling, nothing burning, and — the one that matters —
   * THE WEST BACK ON THE GRID. A nav hole that survived a round reset would be
   * a map that is permanently missing 5 % of itself with nothing on screen to
   * explain it, and it would be invisible to every boot gate in this repo.
   */
  reset() {
    if (!this.ready) return;
    this._t = -1;
    this.busy = false;
    this._live = false;
    this._stopPlough();
    this._extinguish();
    this._fireU.uT.value = -1;
    this._fireU.uFade.value = 1;
    this._park();
  }

  dispose() {
    /** @see `Crash.dispose` — the voice is not gated, the fire is. */
    this._stopPlough();
    if (this.ready) this._extinguish();
    this._droneGeo?.dispose();
    this._droneMat?.dispose();
    this.motherGeo?.dispose();
    this.motherMat?.dispose();
    this._panelGeo?.dispose();
    this.fireGeo?.dispose();
    this.fireMat?.dispose();
    this._blastAdd?.geometry.dispose();
    this._blastSmoke?.geometry.dispose();
    for (const m of this.blastMats ?? []) m.dispose();
    this.chunks?.geometry.dispose();
    this.chunkMat?.dispose();
    this.chunks?.dispose?.();
    this.group.parent?.remove(this.group);
  }
}

/**
 * A box, rotated about its own centre and then translated — the same helper
 * `Crash._buildAirframe` uses, hoisted so both airframes below can share it.
 * Order is Z, Y, X: `rz` droops a wing, `ry` yaws a panel, `rx` digs a nose in.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND IT REPROJECTS THE UVs, WHICH IS THE DIFFERENCE BETWEEN AN AEROPLANE AND
 * A PIECE OF ORANGE CARD
 * ────────────────────────────────────────────────────────────────────────────
 * `BoxGeometry` gives every face a 0..1 UV square, so a 46 m fuselage samples
 * one copy of a 1 k rust texture across forty-six metres — 22 texels a metre,
 * which is no texels at all. PHOTOGRAPHED (`shots/skyfall/SKY-15-the-wreck` on
 * the first build): the carrier read as three flat orange rectangles with no
 * surface, no seam and no shading, and at 86 m long that is most of the frame.
 * The satellite has the same UVs and gets away with it because it is 15 m and
 * usually 300 m away.
 *
 * So each vertex takes its UV from its own LOCAL POSITION on the two axes its
 * face does not point down — a per-box triplanar projection, done once at boot
 * on a static geometry — and the texture then tiles every `TILE` metres over
 * every panel of both airframes. `getTextureSet` returns `RepeatWrapping`
 * textures (`src/materials/generator.js`), so this needs nothing else.
 *
 * It is done BEFORE the rotations, so the tiling runs along the box's own
 * length: a drooped wing panel is still panelled along the wing.
 */
const TILE = 3.0;
function boxGeo(w, h, d, x, y, z, ry = 0, rz = 0, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position.array;
  const nor = g.attributes.normal.array;
  const uv = g.attributes.uv.array;
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
    const ax = Math.abs(nor[i]);
    const ay = Math.abs(nor[i + 1]);
    const az = Math.abs(nor[i + 2]);
    let u;
    let v;
    if (ax >= ay && ax >= az) { u = pos[i + 2]; v = pos[i + 1]; }
    else if (ay >= az) { u = pos[i]; v = pos[i + 2]; }
    else { u = pos[i]; v = pos[i + 1]; }
    uv[j] = u / TILE;
    uv[j + 1] = v / TILE;
  }
  if (rz) g.rotateZ(rz);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
