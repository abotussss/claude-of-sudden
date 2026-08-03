/**
 * MATCH — THE CIVILIAN FORCE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════════
 * 「民間軍を投入して 民間軍は射殺した際に武装している場合は占領ポイントに影響がないが、
 *  武装していない民間人の場合は占領ポイントを下げて 民間軍は全て敵軍です 民間軍は基本
 *  的に隠れること、不意打ちをしてきますので、ランダムに屋内、もしくはマップ街の街から
 *  数人登場させること これはゲーム上アナウンスなし 民間人は体力５０です 武装している
 *  が防弾はないので 民間軍は私服にして軍服にはしないように 民間軍はAKとグレネードのみ
 *  装備 全部で１５人のみ出現させて そのうち民間人は５人、民間人は見つけられた場合は
 *  逃走します（攻撃してこない） 民間軍の武装している人は攻撃してきます 逃走以外で屋外
 *  に逃げることはない 基本屋内にのみ滞留 AI性能としては中の下くらいにして」
 *
 * A third side, all of them hostile to the player, that lives in the buildings
 * rather than on the streets: EIGHTEEN with an AK and a bandolier who hold the
 * doorways and go at whoever comes through them, and SIX with nothing who run
 * when they are seen. Killing one of the eighteen is free. Killing one of the
 * six TAKES CAPTURE SCORE OFF YOUR SIDE.
 *
 * 「民間平や民間人はもっと屋内にポップさせて もっと攻撃して邪魔してきて」 is the second
 * pass over them and it moved three things, each of which has its own note:
 * HOW MANY (@see `TOTAL` — fifteen to twenty-four, and the extra nine are
 * mostly rifles), WHERE (@see `DOOR_TRIES` — an armed man is offered his
 * building's thresholds before its back rooms) and WHAT HE DOES ABOUT SOMEBODY
 * IN HIS HOUSE (@see `HUNT_R` — he stops waiting and closes). The fourth thing
 * it moved is not in this file at all: how hard he FIGHTS is his persona, which
 * is drawn inside the `Agent` constructor — @see `drawCivilPersona` in
 * src/ai/index.js, where aggression, patience and trigger discipline moved and
 * `skill` deliberately did not, because 「AI性能としては中の下くらいに」 has not
 * been withdrawn and 「AIMは悪くてもいい」 is the same sentence.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THE FOUR DECISIONS, AND WHY EACH ONE IS THE WAY IT IS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── 1. LEGIBILITY IS THE WHOLE MECHANIC, AND IT IS PAID FOR IN `src/ai` ──
 *
 * If the player cannot tell an armed one from an unarmed one BEFORE he fires,
 * the penalty is a random tax and not a decision — so the two are different
 * MESHES, not different flags. @see `CIVIL_VARIANTS` in src/ai/soldier.js for
 * the three redundant cues (silhouette against both armies, a 7:1 value ratio
 * between the two civilians, and head/hands) and for the photographs. What this
 * file owns is the two consequences of that:
 *
 *   NOBODY IN THIS FACTION IS ON THE RADAR. `ai._civilise` keeps every one of
 *   them out of `getHudActors`, ARMED AND UNARMED ALIKE. Suppressing only the
 *   unarmed would make the HUD the answer to the question the player is
 *   supposed to have to look at a man to answer; suppressing the faction makes
 *   finding one a thing that only ever happens with your eyes, which is what
 *   「これはゲーム上アナウンスなし」 asks for.
 *
 *   NO BOT EVER SHOOTS AN UNARMED ONE ON PURPOSE. `ai.protect` (the spawn
 *   protection hook, which is "not a valid target" and NOT damage immunity)
 *   is held on every unarmed civilian for the whole match, so the penalty can
 *   only ever be paid by the player's own trigger finger. A side that levied a
 *   score penalty on you because a team-mate you cannot see shot somebody you
 *   have never met is not a mechanic.
 *
 * ── 2. WHAT A DEAD CIVILIAN COSTS: `CIVILIAN_PENALTY` ──
 *
 * @see that constant. Twelve points, floored at zero, against a `scoreTarget`
 * of 500.
 *
 * ── 3. "INDOORS" IS A MEASUREMENT, NOT A PLACEMENT ──
 *
 * `NavGrid._carveInteriors` re-samples every cell inside an enterable building
 * from INSIDE it and marks the ones that are genuinely in a room with
 * `grid.indoor[i] = 1` — strictly, so the doorstep apron is excluded. That flag
 * is the only honest definition of indoors on this map and it is what this file
 * places against. It also means the GROUND STOREY and nothing else: one height
 * per cell, so upstairs is not in the graph at all (@see the `world.features`
 * note in ARCHITECTURE.md, and `StairMap`, which is one measured route up per
 * building and belongs to `Agent._runPost` — a civilian has no squad and
 * therefore can never take a post, which is exactly right).
 *
 * Each candidate is then PROVED with a real A* from a base spawn, the same rule
 * `caches.js:prove` and `sites.js` use: a man in a sealed pocket is a man the
 * player can never find, and fifteen of the fifteen could be in one.
 *
 * WHICH ROOMS ARE ELIGIBLE AT ALL IS A SECOND, NARROWER QUESTION — 「大聖堂付近の
 * 屋内にのみ出現させて」 — and it is answered once at `place()`: only the buildings
 * round the church, and not the church. @see the `CATH_SPAN` note.
 *
 * ── 4. AMBUSH IS AN ABSENCE OF ORDERS, AND OBSTRUCTION IS ONE ORDER ──
 *
 * `Agent._think`'s IDLE branch is: speed zero; if I have a target, fight; else
 * if I have an objective, advance; else if I have a patrol route, patrol. A
 * civilian is given no objective and no patrol route, so he stands in the room
 * this file chose — not where a bot patrol expects, not moving, not making
 * noise — until somebody walks into his line, and then he opens fire at the
 * range his traits want. That is 「基本的に隠れること、不意打ちをしてきます」 and it
 * is written already; what this file adds to it is a LEASH, because a fight he
 * loses can walk him out of the door and 「逃走以外で屋外に逃げることはない」 — and
 * ONE order, the intercept, because 「邪魔してきて」 is not satisfied by a man who
 * waits to be walked into. @see `HUNT_R`: it fires only when a hostile is on a
 * room cell within a room's distance of him, it can only ever send him to
 * another room cell inside his own leash, and it is dropped the instant he has
 * a target of his own.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ALLOCATION
 * ════════════════════════════════════════════════════════════════════════════
 * `update()` runs every frame. The per-frame work is a slice of the roster, not
 * the whole of it, and every vector it touches is preallocated here. The one
 * expensive thing — the A* proof — happens at most `SPAWN_TRIES` times per man
 * per match, i.e. `TOTAL` times. The intercept adds at most three `nearest`
 * probes per armed man per `HUNT_REPICK`, and only for the ones who have
 * somebody standing in their building.
 */

import * as THREE from 'three';

/**
 * The two roles `src/ai` keys the civilian persona off, spelled the same way at
 * both ends. `match` may not import from `ai`, so the literal IS the interface —
 * exactly as `AI_ROLE_FIELD` already is. @see `CIVIL_ROLE` in src/ai/index.js.
 */
const ROLE = Object.freeze({ armed: 'civil', unarmed: 'civilUnarmed' });
/** …and the two dresses. @see `CIVIL_VARIANTS` in src/ai/soldier.js. */
const VARIANT = Object.freeze({ armed: 'civilArmed', unarmed: 'civilUnarmed' });

/**
 * 「全部で１５人のみ出現させて そのうち民間人は５人」 was the first number, and
 * 「民間平や民間人はもっと屋内にポップさせて」 is the second one: MORE OF THEM, INDOORS.
 *
 * TWENTY-FOUR, AND THE EXTRA NINE ARE MOSTLY RIFLES. The split moves from 10:5
 * to 18:6 rather than 16:8, and the reason is that the two kinds are not the
 * same request. The armed ones are what 「もっと攻撃して邪魔してきて」 asks for —
 * they are the interference. The unarmed ones are the identification tax
 * (`CIVILIAN_PENALTY` per body, and only the player's own trigger can pay it),
 * so scaling them 1:1 with the militia would multiply the thing he did NOT ask
 * to have more of. Six still spreads five-plus flights over a match and still
 * means a room can hold one.
 *
 * WHAT IT COSTS, HONESTLY: the roster is 20 v 20 plus up to 20 reinforcements
 * plus two hulls and two drones, so this is +9 actors on a worst case of ~84 —
 * about an eighth more AI. It buys nothing per frame in THIS file (the shepherd
 * pass is 4 Hz over the live list) and everything it costs is `src/ai`'s think
 * budget. @see the `stuckcheck` note in the report.
 *
 * The district has to hold them: `_district` widens until it has floor for
 * `TOTAL` men, and at 24 the need is 960 cells against the 1953 W2/W3/E2/E3
 * already publish — so the span does not move and 「大聖堂付近」 is unchanged.
 */
const TOTAL = 24;
const UNARMED = 6;

/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT KILLING AN UNARMED CIVILIAN COSTS — felt, and not ruinous
 * ════════════════════════════════════════════════════════════════════════════
 * READ AGAINST THE ACCRUAL THAT IS ACTUALLY IN `rules.js`, not against a guess:
 * `RULES.zonePayout` is `[0, 1, 4, 6, 7, 8]` points per `scoreInterval` (4 s)
 * indexed by zones held, and `RULES.scoreTarget` is 500. So a side holding the
 * two zones a contested match settles on earns 4 points every 4 seconds — ONE
 * POINT PER SECOND — and a side holding three earns 1.5.
 *
 * TWELVE POINTS IS THEREFORE TWELVE SECONDS OF A TWO-ZONE HOLD, and about eight
 * of a three-zone one. That is the number, and the reasoning is:
 *
 *   IT HAS TO BEAT THE VALUE OF THE SHOT. The alternative to identifying the
 *   man is shooting first and being right ten times in fifteen, so the penalty
 *   must be worth more than the tempo a hasty kill buys. A kill is worth no
 *   capture score at all in this mode — only ground is — so any penalty at all
 *   clears that bar; twelve clears it by enough to be worth a beat of
 *   hesitation at a doorway.
 *
 *   IT MUST NOT DECIDE THE MATCH. All five is 60 points, 12 % of the target,
 *   roughly a minute of a two-zone hold out of a measured 448-520 s match. A
 *   player who kills every civilian on the map has given away a minute; he has
 *   not lost. A penalty that CAN lose a match makes the correct play "never
 *   fire indoors", which deletes the interiors the last six months of this
 *   project spent making worth entering.
 *
 *   IT IS FLOORED AT ZERO, so it cannot produce a negative scoreboard and
 *   cannot be farmed against a side that has not scored yet.
 *
 * NOTE THE COMMENT ON `zonePayout` IS BEING RE-TUNED BY SOMEBODY ELSE AS THIS
 * IS WRITTEN. This constant is expressed in POINTS rather than as a fraction of
 * the curve on purpose: if the curve moves, twelve points is still twelve
 * points and still readable next to whatever the tick becomes.
 */
export const CIVILIAN_PENALTY = 12;

/**
 * HOW THEY ARRIVE — 「ランダムに屋内、もしくはマップ街の街から数人登場させること」.
 *
 * A FEW AT A TIME, not fifteen at the whistle, and the reason is the mechanic
 * rather than the pacing: a building the player has already cleared has to be
 * able to become dangerous again, or "clear the room" degenerates into "clear
 * the room once, in the first minute". The first wave is late enough that the
 * opening fight for the three zones happens between the two armies alone.
 */
const FIRST_WAVE = 20;
/**
 * MEASURED, then shortened. At [42, 78] a headless match had TEN of the fifteen
 * placed at t=260 s of a match that runs 448-520 s, i.e. the last third of the
 * roster arrives in the last minute or does not arrive at all. [34, 62] landed
 * all fifteen by roughly t=300, which leaves the whole back half of the match
 * with the full faction on the map — and the back half is where the buildings
 * matter, because it is where the cathedral opens and D goes live.
 *
 * …AND SHORTENED AGAIN FOR NINE MORE MEN, because the schedule is what decides
 * whether a bigger faction is actually MORE PRESENCE INDOORS or just a longer
 * tail: 24 men at [34,62] × 2-4 would still be arriving at t=400. At [20,38] ×
 * 3-5 the whole faction is placed by roughly t=170 with the first wave at 20 s,
 * which is still after the opening fight for the three zones and is now early
 * enough that a building is dangerous the first time somebody enters it rather
 * than the third.
 */
const WAVE_GAP = [20, 38];
const WAVE_SIZE = [3, 5];

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE CATHEDRAL DISTRICT — 「民間軍は屋内にランダム出現だけど大聖堂付近の屋内にのみ
 * 出現させて」
 * ════════════════════════════════════════════════════════════════════════════
 * They used to arrive in ROOMS ACROSS THE WHOLE TOWN — every building with four
 * walkable interior cells in it, from the northern sheds to the southern
 * terrace, which is 80 m either side of the church. The request narrows that to
 * the buildings AROUND THE CATHEDRAL, and the reading it is written to is the
 * one that makes them mean something: this is not a militia, it is THIS
 * DISTRICT'S militia. They are the people who live where capture point D is
 * about to open, and they are indoors around it before the bombardment makes it
 * the most contested ground on the map.
 *
 * ── THE RADIUS IS MEASURED OFF THE MAP, NOT TYPED ──
 *
 * The one length this town publishes about the church is the church's own
 * footprint, and `world.interiorVolumes` carries it: the cathedral is the first
 * volume on that list (@see `WorldSystem._buildInteriorVolumes` — it is not a
 * `BUILDINGS` entry, so it is pushed by hand) and it is an oriented box like
 * every other one. `CATH_SPAN` is in units of THAT box's own radius, so the
 * rule reads "a building whose nearest corner is within one cathedral of the
 * cathedral" and it moves if the church is ever re-planned. Nothing here knows
 * a metre.
 *
 * Distance is centre-to-centre MINUS the candidate's own half-diagonal — the
 * church's centre to the building's NEAREST CORNER — because a 20 x 36 m block
 * across the street and a 5 m shed across the street are the same neighbour and
 * their centres are not.
 *
 * ── AND IT WIDENS UNTIL FIFTEEN MEN FIT ──
 *
 * A rule that can select two rooms would put the whole faction in one house, so
 * the span grows by `CATH_STEP` until the district holds `MIN_BUILDINGS` and
 * enough floor for `TOTAL` men — where ENOUGH is derived rather than guessed:
 * `SPAWN_CLEAR_CIVIL` is the radius no two of them may be inside, so a square
 * of that side (`SPAWN_CLEAR_CIVIL²` in the nav grid's own cell area) is the
 * floor one man occupies. What that selects on this map is reported at boot.
 *
 * ── THE CHURCH ITSELF IS NOT ONE OF THEM ──
 *
 * It is on `interiorVolumes` and it has by far the most room cells of anything
 * on the map, so it would take most of the fifteen — and it is the one interior
 * that must not have them. It BECOMES capture point D, so a militiaman standing
 * in it is a third side sitting on a live objective; and the shell comes down
 * mid-match (`world.cathedral.setRazed`), which leaves his anchor, his leash
 * and his ambush in the open air on `grid.indoor` cells that were baked when
 * there was a roof over them. 「大聖堂付近」 is the district, and the district is
 * the buildings round the church.
 */
const CATH_SPAN = 1;
const CATH_STEP = 0.5;
/** However far it has to widen, it stops before "the whole town" is the answer. */
const CATH_SPAN_MAX = 6;
/** Fewer than this and a bag of buildings is not a choice. @see `_nextBuilding`. */
const MIN_BUILDINGS = 3;

/** Tries at finding a room for one man before he waits for the next wave. */
const SPAWN_TRIES = 14;
/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE DOORWAY IS THE OBSTRUCTION — 「邪魔してきて」
 * ════════════════════════════════════════════════════════════════════════════
 * A militiaman in the middle of a back room is a man the attacker meets if he
 * decides to; a militiaman covering the threshold is a man he has to deal with
 * to use the building at all. That is the difference between an ambush and
 * INTERFERENCE, and it is a placement decision rather than a behaviour one.
 *
 * A THRESHOLD CELL IS DERIVED, NEVER AUTHORED — the same rule the rest of this
 * file lives by. It is a room cell (`grid.indoor === 1`) with a WALKABLE
 * neighbour that is NOT a room cell at roughly its own height: the inside face
 * of a doorway, since `_carveInteriors` is strict about the apron and the apron
 * is exactly what is on the other side of a door. The height test is what keeps
 * a balcony lip or a stair head from being called a door.
 *
 * IT IS A BIAS AND NOT A RULE. The first `DOOR_TRIES` of an armed man's
 * `SPAWN_TRIES` are drawn from his building's threshold list and the rest from
 * the whole room census, so a building whose doors are all taken (they are
 * 5 m apart at the most — @see `SPAWN_CLEAR_CIVIL`) still fills up inside
 * instead of deferring the man to the next wave. The unarmed five are never
 * drawn this way: a civilian standing in the doorway is a civilian the player
 * meets at the range where a mistake is likeliest, and the whole point of the
 * value split is that he gets to make the identification at a distance.
 */
const DOOR_TRIES = 8;
/** Metres a threshold cell's outside neighbour may differ in height. */
const DOOR_STEP = 1;
/**
 * CELLS OF STRAIGHT, WALKABLE RUN between a threshold cell and the apron. Two
 * is 1.6 m on the 0.8 m lattice — the same reach `_carveInteriors` probes past
 * a wall with, and one cell of wall plus one of doorstep. @see `_thresholds`
 * for what it measured at one.
 */
const DOOR_REACH = 2;
/** Nobody appears inside this many metres of the player unless a wall is between. */
const SPAWN_CLEAR_PLAYER = 26;
/** …or of any soldier of either army, LOS or not. A man who pops in is a bug. */
const SPAWN_CLEAR_SOLDIER = 15;
/** Two civilians in the same room is a firing squad, not an ambush. */
const SPAWN_CLEAR_CIVIL = 5;

/**
 * THE LEASH — 「逃走以外で屋外に逃げることはない 基本屋内にのみ滞留」.
 *
 * An ambusher who wins his fight stays where he is (no objective, no patrol).
 * One who LOSES it does not: `_combat` breaks off to `lastKnown`, and a chase
 * out of a doorway is the one path that puts a militiaman in the street. So a
 * man more than `LEASH_R` from the room he was placed in is walked back to it,
 * and the order is dropped the moment he is home — which puts him back in IDLE,
 * i.e. back to being an ambush rather than a patrol.
 *
 * `pickup` and not `hold` deliberately: `hold` is `holdish` in `Agent`, which
 * rolls a sector spot 4-11 m from the objective and would happily choose one
 * through the wall he is being brought back inside.
 */
const LEASH_R = 13;
/**
 * HOME, AND IT HAS TO ANSWER THE SAME QUESTION THE ARM DOES.
 *
 * The first cut armed the leash on `far > LEASH_R || !indoors` and dropped it on
 * `far < LEASH_HOME` alone — two different questions, so a man standing 2 m from
 * his anchor on a doorstep cell (walkable, but `indoor = 0`, because
 * `_carveInteriors` is strict about the apron) unleashed on the distance test
 * and re-armed on the indoor test in the SAME tick, for ever. Measured over one
 * headless match: 163 leash events against a roster of fifteen, and the same two
 * men reported three to five metres from home in nine consecutive samples,
 * shuffling in a doorway.
 *
 * So the drop is the arm's negation, plus one escape: `far < 1.2` is AT the
 * anchor, and the anchor is by construction a cell `grid.indoor` called a room —
 * if the flag disagrees at that range it is a lattice artefact and standing on
 * the spot he was placed on is as indoors as this man is ever going to be.
 */
const LEASH_HOME = 3.5;
/**
 * …AND A FIGHT ONLY BUYS YOU THIS LONG IN THE OPEN.
 *
 * The leash is normally suspended while a man has a target, because dragging
 * somebody out of cover mid-firefight is the one thing that would make him look
 * scripted. Measured with that as the only rule, one militiaman held a doorway
 * OUTDOORS for the whole of a headless match — his fight never ended, so the
 * leash never ran, and 「屋外に逃げることはない」 was false for him specifically.
 * Six seconds is the difference between stepping out to take a shot and having
 * moved house: past it he goes back inside whether or not he is being shot at.
 *
 * …AND SHORTENED AGAIN, BECAUSE THE MAN THE GRACE COVERS IS A DIFFERENT MAN
 * NOW. The persona that answers 「もっと攻撃して」 (@see `drawCivilPersona`) holds
 * a contact far longer than the ambusher did: he breaks off at 34 HP of his 50
 * instead of 46, he searches a lost contact instead of settling, and his cover
 * moves travel 13 m instead of 9. Measured on the 24-man build with the grace
 * still at six seconds, one sample had SEVEN of nine live civilians standing
 * OUTDOORS — 「基本屋内にのみ滞留」 read the wrong way round, and the opposite of
 * 「もっと屋内に」.
 *
 * Two and a half seconds is still a man stepping into a doorway to take his
 * shot. It is no longer a man fighting his way up the street.
 */
const OUT_GRACE = 2.5;

/**
 * ════════════════════════════════════════════════════════════════════════════
 * HE COMES TO YOU — the other half of 「もっと攻撃して邪魔してきて」
 * ════════════════════════════════════════════════════════════════════════════
 * AMBUSH IS AN ABSENCE OF ORDERS, and that is still what he is: no objective,
 * no patrol, standing in the room this file put him in. What it also was, and
 * should not be, is a man who does nothing until somebody walks into his exact
 * line of sight — you could cross his building diagonally and never be his
 * problem, which is scenery that occasionally shoots.
 *
 * So a militiaman with a HOSTILE INSIDE HIS OWN WALLS moves on him. Three
 * things make that a nuisance rather than a scripted charge:
 *
 *   HE ONLY HEARS WHAT IS IN THE HOUSE. `HUNT_R` is a room away, and both men
 *   must be on `grid.indoor` cells — the militiaman AND the hostile. A man in
 *   the street outside is not his business and does not move him. This is not
 *   clairvoyance, it is the one thing a man standing in a small building
 *   genuinely knows.
 *
 *   THE POINT HE WALKS TO IS INDOORS AND INSIDE HIS LEASH, always. It is
 *   probed along the bearing to the hostile and rejected unless it lands on a
 *   room cell within `LEASH_R` of his anchor, so the manoeuvre cannot put him
 *   in the street and cannot fight the leash — 「逃走以外で屋外に逃げることは
 *   ない」 survives it untouched.
 *
 *   IT STOPS THE MOMENT HE HAS A TARGET. Once he can see somebody the fight
 *   belongs to `Agent._combat` and this file has no business in it; the order
 *   is dropped, which puts him back in the hands of his own cover selection.
 *
 * `pickup` and not `push` deliberately, for the reason the leash already gives:
 * `push` and `hold` are `holdish` in `Agent` and roll a sector spot 3-13 m out,
 * which is happy to be through a wall. `pickup` walks to the point it was
 * given. It is also the one verb `setObjective` does not announce on the net,
 * which matters here for nothing — a militiaman's radio is `Infinity` — but is
 * the right verb anyway.
 */
const HUNT_R = 16;
/** He does not walk onto the man; he closes to somewhere he can shoot from. */
const HUNT_MIN = 2.2;
/** Seconds between re-aiming an intercept, so he does not re-path every tick. */
const HUNT_REPICK = 1.6;

/**
 * FLEEING — 「民間人は見つけられた場合は逃走します」.
 *
 * SEEN BY THE PLAYER, measured the same way `AiSystem._updateSpotting` measures
 * a contact: inside `FLEE_SEEN_R`, inside the view cone, and a clear sight line.
 * It is asked with `physics` rather than read off `Agent.spottedAt` because
 * `spottedAt` is `ai`'s bookkeeping and `match` does not read another
 * subsystem's internals — and because the distance gate is different: 90 m of
 * "my side has eyes on him" is a radar fact, and being FOUND is a thing that
 * happens in a room.
 *
 * He runs for `FLEE_MEMORY` seconds after he was last seen, then stops wherever
 * he is. This is the ONE case in which a civilian may be outdoors.
 */
const FLEE_SEEN_R = 34;
const FLEE_CONE = 0.5;
const FLEE_MEMORY = 7;
/** How far he runs for. Long enough to leave the building and keep going. */
const FLEE_RUN = 38;
/** Seconds between re-aiming a flight, so he does not jitter between bearings. */
const FLEE_REPICK = 3.2;

/** Roster slices walked per second. The whole list at 15 men is trivial either way. */
const TICK = 0.25;

export class Civilians {
  /**
   * @param ctx   the engine context
   * @param opts  { rng }
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.rng = opts.rng ?? ctx.rng.fork();

    /** Live records: `{ agent, unarmed, anchor, fleeing, fleeUntil, fleeAt }`. */
    this.list = [];
    /** How many of each kind are still to come out. */
    this._left = { armed: TOTAL - UNARMED, unarmed: UNARMED };
    this._nextWave = FIRST_WAVE;
    this._tick = 0;
    this._enabled = false;
    /**
     * `place()` has run. Set even when it finds nothing to place, so a level
     * with no interiors is asked once rather than on every frame for ten
     * minutes; `_enabled` is the separate answer to "did it find any".
     */
    this.placed = false;

    /**
     * PER-BUILDING ROOM CELLS, built once at `place()` from `grid.indoor`.
     * `rooms[b]` is the walkable ground-storey cells genuinely inside building
     * `b`; `_bag` is a shuffled deck of building indices so the fifteen are
     * spread over the town rather than piled into whichever one the RNG likes.
     */
    this.rooms = [];
    /**
     * …AND THE SUBSET OF THEM THAT COVERS A DOOR. `doors[b]` is the room cells
     * of building `b` with the apron on the other side of one wall — where an
     * armed man is put so that using the building means dealing with him.
     * @see `DOOR_TRIES`.
     */
    this.doors = [];
    /**
     * THE BUILDINGS ROUND THE CHURCH, as indices into `rooms` — and the only
     * ones anybody is ever placed in. @see `_district`, which chooses them once
     * from `world.interiorVolumes` at `place()`.
     */
    this.district = [];
    this._bag = [];
    this._bagAt = 0;

    /* ---- measurement: the only way to know any of this happened ---- */
    this.stats = {
      /** Placed on the map, per kind. */
      spawned: [0, 0],
      /** Killed by the local player, per kind — index 1 is what costs. */
      killedByPlayer: [0, 0],
      /** Killed by anything else (a stray, a blast, a team-mate's spray). */
      killedByOther: [0, 0],
      /** Total points taken off the player's side. */
      penalty: 0,
      /** Rooms rejected by the A* proof, and rooms that never passed at all. */
      unreachable: 0,
      /** Men a wave could not place because every candidate was watched. */
      deferred: 0,
      /** Times a man was walked back inside. */
      leashed: 0,
      /** Armed men placed covering a doorway rather than a back room. */
      onDoor: 0,
      /** Times a militiaman was sent at somebody inside his own building. */
      hunted: 0,
      /** Times an unarmed man broke and ran. */
      fled: 0,
    };

    /* ---- scratch ---- */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._path = [];
  }

  /**
   * Bind the things this needs and measure the town's rooms. Called once, after
   * `ai` has a nav grid — the grid is what "indoors" MEANS here.
   *
   * @param ai       the AI system
   * @param world    the world system, for `interiorVolumes`
   * @param spawns   `{ attack:[{position}], defend:[{position}] }`
   * @param capture  the `CaptureZones`, whose `score` a dead civilian moves
   * @param team     which side they fight for — every one of them is hostile
   */
  place(ai, world, spawns, capture, team) {
    this.ai = ai;
    this.capture = capture;
    this.team = team;
    this.spawns = spawns;
    this.phys = this.ctx.peek('physics');
    const g = ai?.grid;
    const vols = world?.interiorVolumes;
    this.rooms.length = 0;
    this.doors.length = 0;
    this.district.length = 0;
    this.placed = true;
    if (!g || !vols || !vols.length) {
      console.warn('[civil] no nav grid or no interiors — the civilian force stands down');
      this._enabled = false;
      return 0;
    }
    /**
     * ONE PASS OVER THE INDOOR FLAG, BUCKETED BY BUILDING. `grid.indoor` is
     * strict — it is set only for cells INSIDE a footprint, never for the
     * doorstep apron — so a cell in this list is a cell in a room. Which
     * building it belongs to is asked of the volume's own oriented rect, the
     * same test `_carveInteriors` used to write the flag in the first place.
     */
    for (let b = 0; b < vols.length; b++) { this.rooms.push([]); this.doors.push([]); }
    let n = 0;
    for (let iz = 0; iz < g.nz; iz++) {
      for (let ix = 0; ix < g.nx; ix++) {
        const i = g.index(ix, iz);
        if (!g.indoor || g.indoor[i] !== 1 || g.flags[i] === 0) continue;
        const x = g.worldX(ix), z = g.worldZ(iz);
        for (let b = 0; b < vols.length; b++) {
          const v = vols[b];
          const dx = x - v.cx, dz = z - v.cz;
          const lx = dx * v.c - dz * v.s;
          const lz = dx * v.s + dz * v.c;
          if (Math.abs(lx) > v.hw || Math.abs(lz) > v.hd) continue;
          this.rooms[b].push(i);
          n++;
          break;
        }
      }
    }
    let used = 0;
    for (let b = 0; b < this.rooms.length; b++) if (this.rooms[b].length >= 4) used++;
    /**
     * …AND THEN ONLY THE ONES ROUND THE CHURCH. The census above is still the
     * whole town because the district is chosen FROM it — and because a report
     * that only counted the district could not say what was left out.
     */
    const near = this._district(world, vols, g.cell ?? 0.8);
    let dn = 0;
    let dd = 0;
    for (const b of this.district) {
      dn += this.rooms[b].length;
      dd += this._thresholds(g, b);
    }
    this._enabled = dn > 0;
    console.info(
      `[civil] ${n} ground-floor room cells in ${used}/${vols.length} buildings; ` +
        `cathedral district ${near.span.toFixed(1)}x its own footprint ` +
        `(${near.radius.toFixed(1)} m): ${dn} cells in ` +
        `${this.district.map((b) => vols[b].building).join(', ') || 'nothing'}, ` +
        `${dd} of them on a threshold; ` +
        `${TOTAL} to place (${UNARMED} unarmed)`
    );
    return dn;
  }

  /**
   * WHICH BUILDINGS ARE "NEAR THE CATHEDRAL" — the whole of the rule, run once.
   * @see the `CATH_SPAN` note for why the radius is the church's own footprint
   * and why the church itself is not in the answer.
   *
   * @returns {{span:number, radius:number}} what it settled on, for the report.
   */
  _district(world, vols, cell) {
    this.district.length = 0;
    // The candidates are the buildings that could hold anybody at all — the
    // same `>= 4` bar `_nextBuilding` has always used.
    const cand = [];
    for (let b = 0; b < this.rooms.length; b++) if (this.rooms[b].length >= 4) cand.push(b);

    /** The church, by its own published id; by area if the id ever moves. */
    const cathId = world?.cathedral?.id ?? null;
    let ci = -1;
    for (let b = 0; b < vols.length; b++) if (vols[b].building === cathId) { ci = b; break; }
    if (ci < 0) {
      let big = -1;
      for (let b = 0; b < vols.length; b++) {
        const a = vols[b].hw * vols[b].hd;
        if (a > big) { big = a; ci = b; }
      }
    }
    if (ci < 0) {
      // No cathedral on the list at all: fall back to the whole town rather
      // than to nobody, and say so — an empty faction is a silent failure.
      console.warn('[civil] no cathedral in world.interiorVolumes — the district is the whole town');
      for (const b of cand) this.district.push(b);
      return { span: Infinity, radius: Infinity };
    }

    const cath = vols[ci];
    const cathR = Math.hypot(cath.hw, cath.hd);
    /** How much room floor one man needs. @see the `CATH_SPAN` note. */
    const perMan = Math.ceil((SPAWN_CLEAR_CIVIL * SPAWN_CLEAR_CIVIL) / (cell * cell));
    const need = TOTAL * perMan;

    /** Church centre to each candidate's NEAREST CORNER. */
    const gap = [];
    for (const b of cand) {
      const v = vols[b];
      const d = Math.hypot(v.cx - cath.cx, v.cz - cath.cz) - Math.hypot(v.hw, v.hd);
      gap.push(b === ci ? Infinity : Math.max(0, d));
    }

    let span = CATH_SPAN;
    for (; ; span += CATH_STEP) {
      this.district.length = 0;
      let cells = 0;
      const r = cathR * span;
      for (let k = 0; k < cand.length; k++) {
        if (gap[k] > r) continue;
        this.district.push(cand[k]);
        cells += this.rooms[cand[k]].length;
      }
      if (this.district.length >= MIN_BUILDINGS && cells >= need) break;
      if (span >= CATH_SPAN_MAX) break;
    }
    return { span, radius: cathR * span };
  }

  /**
   * WHICH OF BUILDING `b`'s ROOM CELLS COVER A DOOR, measured once at `place()`
   * and only for the district — nobody is ever placed outside it. @see the
   * `DOOR_TRIES` note for what a threshold is and why the height test is there.
   *
   * @returns {number} how many it found.
   */
  _thresholds(g, b) {
    const cells = this.rooms[b];
    const out = this.doors[b];
    if (!out) return 0;
    out.length = 0;
    if (!cells || !g?.indoor || !g.flags) return 0;
    const nx = g.nx, nz = g.nz;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      const ix = i % nx, iz = (i / nx) | 0;
      const y = g.floor[i];
      let door = false;
      for (let d = 0; d < 4 && !door; d++) {
        const sx = d === 0 ? 1 : d === 1 ? -1 : 0;
        const sz = d === 2 ? 1 : d === 3 ? -1 : 0;
        /**
         * EVERY CELL ON THE WAY OUT HAS TO BE WALKABLE, AND THAT IS THE WHOLE
         * TEST. It is what makes this a DOOR rather than "a cell near an
         * outside wall": a wall is a cell the height field refuses, so a
         * straight run from here to the apron can only exist where there is an
         * opening. Measured with `DOOR_REACH` at 1 the whole district published
         * FIVE threshold cells — a 0.8 m lattice against a wall thicker than
         * one cell — which is a rule that never fires.
         */
        for (let step = 1; step <= DOOR_REACH; step++) {
          const jx = ix + sx * step, jz = iz + sz * step;
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) break;
          const j = g.index(jx, jz);
          if (g.flags[j] === 0) break;
          if (!(Math.abs(g.floor[j] - y) <= DOOR_STEP)) break;
          // …and the run ends the moment it is standing outside a room.
          if (g.indoor[j] !== 1) { door = true; break; }
        }
      }
      if (door) out.push(i);
    }
    return out.length;
  }

  /** A new match: forget everybody and re-arm the schedule. */
  reset() {
    // The agents themselves are gone — `_beginRound` calls `ai.clearAgents()`.
    this.list.length = 0;
    this._left.armed = TOTAL - UNARMED;
    this._left.unarmed = UNARMED;
    this._nextWave = FIRST_WAVE;
    this._bag.length = 0;
    this._bagAt = 0;
    const s = this.stats;
    s.spawned[0] = s.spawned[1] = 0;
    s.killedByPlayer[0] = s.killedByPlayer[1] = 0;
    s.killedByOther[0] = s.killedByOther[1] = 0;
    s.penalty = 0;
    s.unreachable = 0;
    s.deferred = 0;
    s.leashed = 0;
    s.onDoor = 0;
    s.hunted = 0;
    s.fled = 0;
  }

  /** How many are on their feet right now. Report-time only. */
  get aliveCount() {
    let n = 0;
    for (const c of this.list) if (c.agent.alive) n++;
    return n;
  }

  /**
   * One frame.
   *
   * @param dt
   * @param live   the round is actually being played
   * @param player the local player, or null
   */
  update(dt, live, player) {
    if (!this._enabled || !live) return;
    this._nextWave -= dt;
    if (this._nextWave <= 0) {
      this._nextWave = this.rng.range(WAVE_GAP[0], WAVE_GAP[1]);
      this._wave(player);
    }
    this._tick -= dt;
    if (this._tick > 0) return;
    this._tick = TICK;
    this._prune();
    this._shepherd(player);
  }

  /* ================================================================== */
  /* arrival                                                            */
  /* ================================================================== */

  /**
   * A FEW MEN, SOMEWHERE NOBODY IS LOOKING. The kind is drawn against what is
   * left rather than fixed per wave, so the unarmed ones are spread over the
   * whole match instead of arriving together — a wave that is all civilians
   * would be a wave the player learns to recognise.
   */
  _wave(player) {
    const left = this._left.armed + this._left.unarmed;
    if (left <= 0) return;
    const want = Math.min(left, this.rng.int(WAVE_SIZE[0], WAVE_SIZE[1]));
    for (let i = 0; i < want; i++) {
      const unarmed = this._left.unarmed > 0 &&
        this.rng.float() < this._left.unarmed / (this._left.armed + this._left.unarmed);
      if (!this._place(unarmed, player)) { this.stats.deferred++; break; }
      if (unarmed) this._left.unarmed--; else this._left.armed--;
      if (this._left.armed + this._left.unarmed <= 0) break;
    }
  }

  /** Put ONE man in a room. Returns false if every candidate was being watched. */
  _place(unarmed, player) {
    const g = this.ai.grid;
    for (let t = 0; t < SPAWN_TRIES; t++) {
      const b = this._nextBuilding();
      const cells = this.rooms[b];
      if (!cells || cells.length < 4) continue;
      /**
       * AN ARMED MAN IS OFFERED THE DOORS FIRST. @see `DOOR_TRIES`: the bias
       * is in the POOL and not in the test, so a building whose thresholds are
       * all occupied falls through to its rooms on the later tries instead of
       * losing the man to the next wave.
       */
      const door = this.doors[b];
      const onDoor = !unarmed && t < DOOR_TRIES && door != null && door.length > 0;
      const pool = onDoor ? door : cells;
      const i = pool[this.rng.int(0, pool.length - 1)];
      const x = g.worldX(i % g.nx);
      const z = g.worldZ((i / g.nx) | 0);
      const y = g.floor[i];
      if (!Number.isFinite(y)) continue;
      this._v.set(x, y, z);
      if (!this._unwatched(this._v, player)) continue;
      /**
       * PROVED, not assumed — the rule `caches.js:prove` and `sites.js` both
       * use. A room with no route from a base is a room the player cannot
       * reach either, and a man in one is fifteen minutes of nothing.
       */
      if (!this._reachable(this._v)) { this.stats.unreachable++; continue; }
      /**
       * FACING THE ROOM. A man dropped on a random bearing spends the ambush
       * looking at a wall; the building's own centre is the cheap answer that
       * puts a man in a corner looking at the space somebody has to cross to
       * reach him. `Agent` re-aims the moment he has a target, so this only
       * decides where he is looking while he waits — which is the whole of it.
       *
       * …AND A MAN ON A THRESHOLD FACES THE OTHER WAY, because his room is
       * behind him: the whole value of that cell is the doorway, and a doorway
       * holder looking at his own back wall is a doorway nobody is holding.
       */
      const v = this.ctx.peek('world')?.interiorVolumes?.[b];
      const yaw = v
        ? Math.atan2(v.cx - x, v.cz - z) + (onDoor ? Math.PI : 0)
        : this.rng.range(0, Math.PI * 2);
      const agent = this.ai.spawn(
        unarmed ? VARIANT.unarmed : VARIANT.armed,
        this._v,
        yaw,
        {
          team: this.team,
          // Not a callsign: these men have no roster row and no scoreboard
          // line, and "MILITIA killed you" is what the kill cam should say.
          name: unarmed ? 'CIVILIAN' : 'MILITIA',
          role: unarmed ? ROLE.unarmed : ROLE.armed,
        }
      );
      // No squad, no objective, no patrol route. @see `AiSystem._civilise` and
      // the "AMBUSH IS AN ABSENCE OF ORDERS" note at the top of this file.
      this.list.push({
        agent,
        unarmed,
        anchor: new THREE.Vector3(x, y, z),
        fleeing: false,
        fleeUntil: 0,
        fleeAt: 0,
        leashed: false,
        /** Elapsed time he was first found outdoors, or 0. @see `OUT_GRACE`. */
        outSince: 0,
        /** He is walking at somebody inside his own walls. @see `HUNT_R`. */
        hunting: false,
        /** Elapsed time his next intercept may be re-aimed. */
        huntAt: 0,
      });
      this.stats.spawned[unarmed ? 1 : 0]++;
      if (onDoor) this.stats.onDoor++;
      return true;
    }
    return false;
  }

  /**
   * Shuffled deck of buildings, reshuffled when it runs out — DEALT FROM THE
   * CATHEDRAL DISTRICT and never from the town, which is the whole of where
   * 「大聖堂付近の屋内にのみ」 is enforced. `district` already carries the `>= 4`
   * test. @see `_district`.
   */
  _nextBuilding() {
    if (this._bagAt >= this._bag.length) {
      this._bag.length = 0;
      for (const b of this.district) this._bag.push(b);
      for (let i = this._bag.length - 1; i > 0; i--) {
        const j = this.rng.int(0, i);
        const t = this._bag[i]; this._bag[i] = this._bag[j]; this._bag[j] = t;
      }
      this._bagAt = 0;
      // NOT zero: building 0 is the cathedral on this map and the district is
      // deliberately not it. `_place` reads `rooms[-1]` as undefined and skips.
      if (!this._bag.length) return -1;
    }
    return this._bag[this._bagAt++];
  }

  /**
   * NOBODY WATCHES A MAN APPEAR. The player gets the strict test — far away OR
   * behind something — and every soldier of either army gets a plain radius,
   * because a bot has no camera to be surprised in front of but a player
   * standing next to one absolutely does.
   */
  _unwatched(p, player) {
    for (const c of this.list) {
      if (c.agent.alive && c.agent.position.distanceTo(p) < SPAWN_CLEAR_CIVIL) return false;
    }
    const ag = this.ai.agents;
    for (let i = 0; i < ag.length; i++) {
      const a = ag[i];
      if (!a.alive || a.aiCivil === true) continue;
      if (a.position.distanceTo(p) < SPAWN_CLEAR_SOLDIER) return false;
    }
    if (player && !player.dead && player.position) {
      const d = player.position.distanceTo(p);
      if (d < SPAWN_CLEAR_SOLDIER) return false;
      if (d < SPAWN_CLEAR_PLAYER && this.phys) {
        this._eye.copy(this.ctx.camera.position);
        this._v2.set(p.x, p.y + 1.4, p.z);
        if (this.phys.lineOfSight(this._eye, this._v2, this.phys.MASK.SIGHT)) return false;
      }
    }
    return true;
  }

  /**
   * An A* from a base spawn of either side reaches this cell.
   *
   * TWO SPAWN POINTS PER SIDE AND NOT ALL OF THEM, deliberately: a base cluster
   * is a dozen points three metres apart, they are all in the same nav
   * component, and this can be asked `SPAWN_TRIES` times inside ONE frame — the
   * uncapped version is up to four hundred A* on the frame a wave lands, which
   * is a visible hitch bought to re-prove a fact the first pair already
   * answered. A pocket that two points of both bases cannot see is a pocket.
   */
  _reachable(p) {
    const g = this.ai.grid;
    const sp = this.spawns;
    if (!g || !sp) return true;
    for (const kind of ['attack', 'defend']) {
      const list = sp[kind] ?? [];
      const n = Math.min(2, list.length);
      for (let i = 0; i < n; i++) {
        if (g.findPath(list[i].position, p, this._path) > 0) return true;
      }
    }
    return false;
  }

  /* ================================================================== */
  /* keeping them where they belong                                     */
  /* ================================================================== */

  _prune() {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (!this.list[i].agent.alive) this.list.splice(i, 1);
    }
  }

  /**
   * The leash, the flight and the intercept, in one pass over the live roster
   * at 4 Hz.
   *
   * ORDER MATTERS TWICE:
   *
   *   A FLEEING MAN IS NOT LEASHED. Running outdoors is the ONE thing
   *   「逃走以外で屋外に逃げることはない」 permits, and a leash that fired during a
   *   flight would walk a terrified civilian back into the room he is running
   *   away from.
   *
   *   AN INTERCEPT IS ASKED BEFORE THE LEASH AND ANSWERS TO IT. @see `HUNT_R`.
   *   The point he is sent to is indoors and inside `LEASH_R` of his anchor by
   *   construction, so the two orders can never pull against each other; and
   *   the hunt is dropped — clearing `leashed` with it — the moment its reason
   *   goes, which puts the leash back in charge on the very next tick.
   */
  _shepherd(player) {
    const now = this.ctx.time.elapsed;
    const seen = player && !player.dead ? player : null;
    for (const c of this.list) {
      const a = c.agent;
      if (!a.alive) continue;
      if (c.unarmed) {
        if (seen && now > c.fleeAt && this._isSeen(a, seen)) {
          if (!c.fleeing) this.stats.fled++;
          c.fleeing = true;
          c.fleeUntil = now + FLEE_MEMORY;
          c.fleeAt = now + FLEE_REPICK;
          this._runAway(c, seen);
          continue;
        }
        if (c.fleeing) {
          if (now < c.fleeUntil) continue;
          // He has not been seen for `FLEE_MEMORY`: he stops where he is and
          // the room he stops in becomes the one he now belongs to.
          c.fleeing = false;
          c.anchor.copy(a.position);
          c.leashed = false;
          a.setObjective('hold', null);
          continue;
        }
      }
      /**
       * THE LEASH. Not while he is in a fight — a man backing off two rooms
       * under fire is not a man who has wandered off, and dragging him out of
       * cover mid-firefight is the one thing that would make him look scripted
       * — UNLESS the fight has had him outdoors for `OUT_GRACE`, which is not a
       * fight any more, it is a move. @see that constant for the measurement.
       */
      const inside = this._indoors(a.position);
      c.outSince = inside ? 0 : (c.outSince || now);
      const overstayed = !inside && now - c.outSince > OUT_GRACE;
      /**
       * HE COMES TO YOU. Only while he is indoors and only while he has no
       * target of his own — both are tested inside `_hunt` — so this can never
       * override the leash's "he has been outdoors too long" branch and never
       * reaches into a firefight. @see `HUNT_R`.
       */
      if (!c.unarmed && inside && !overstayed && this._hunt(c, seen, now)) continue;
      if (a.hasTarget && !overstayed) continue;
      const far = a.position.distanceTo(c.anchor);
      /**
       * OUT OF THE ROOM IS OUT OF POSITION, AND DISTANCE ALONE DID NOT SAY SO.
       * Measured over a headless match with the leash on `LEASH_R` only, the
       * sample at t=104/130/156/182 s had two men each time standing OUTDOORS
       * three to ten metres from their anchor — inside the leash, outside the
       * building. Of course: an anchor near a door is ten metres from most of
       * the street. So the second test is the one the request actually made —
       * 「基本屋内にのみ滞留」 — asked of the only thing on this map that knows
       * what indoors means, `NavGrid.indoor`, which is written by
       * `_carveInteriors` and is strict about the doorstep apron.
       */
      if (!c.leashed && (far > LEASH_R || !inside)) {
        c.leashed = true;
        // An intercept that ended with him out of position is over: the leash
        // is the order now, and two owners of one objective is a fight.
        c.hunting = false;
        this.stats.leashed++;
        a.setObjective('pickup', c.anchor);
      } else if (c.leashed && (far < 1.2 || (far < LEASH_HOME && inside))) {
        c.leashed = false;
        // Back to no orders at all, which is back to being an ambush.
        a.setObjective('hold', null);
      }
    }
  }

  /**
   * A MILITIAMAN WITH SOMEBODY IN HIS BUILDING GOES AT HIM — the 「邪魔してきて」
   * half of the request, and the whole of what this file adds to his aggression
   * (the rest of it is his persona and lives in `src/ai`). @see `HUNT_R`.
   *
   * @returns {boolean} true while an intercept is standing, i.e. this man's
   * orders are already decided and the leash must not touch him this tick.
   */
  _hunt(c, player, now) {
    const a = c.agent;
    /**
     * THE FIGHT OUTRANKS THE HUNT. Once he can see somebody, `Agent._combat`
     * owns him — cover, peeking, the burst, the grenade — and an objective on
     * top of that is this file second-guessing the one part of him that is
     * genuinely good at its job.
     */
    if (a.hasTarget || !player || player.dead || !player.position) {
      return this._dropHunt(c);
    }
    const p = player.position;
    if (a.position.distanceTo(p) > HUNT_R || !this._indoors(p)) return this._dropHunt(c);
    if (now >= c.huntAt) {
      c.huntAt = now + HUNT_REPICK;
      if (!this._huntPoint(c, p)) return this._dropHunt(c);
      if (!c.hunting) this.stats.hunted++;
      c.hunting = true;
      // The hunt supersedes a leash in progress; it cannot leave the building.
      c.leashed = false;
      a.setObjective('pickup', this._v2);
    }
    return c.hunting;
  }

  /** Forget an intercept, hand the man back to the leash. Always false. */
  _dropHunt(c) {
    if (c.hunting) {
      c.hunting = false;
      c.leashed = false;
      // No orders at all is what an ambusher is. @see `_shepherd`.
      c.agent.setObjective('hold', null);
    }
    return false;
  }

  /**
   * SOMEWHERE HE CAN SHOOT FROM, ON THE WAY TO THE MAN — probed along the
   * bearing at three depths and rejected unless it lands on a room cell inside
   * the leash. The path from here to there is A*'s problem, exactly as it is
   * for the leash; what this decides is only that the destination is a place a
   * militiaman is allowed to be.
   *
   * @returns {boolean} true with the point in `_v2`.
   */
  _huntPoint(c, p) {
    const g = this.ai?.grid;
    if (!g || !g.indoor) return false;
    const a = c.agent;
    let dx = p.x - a.position.x;
    let dz = p.z - a.position.z;
    const len = Math.hypot(dx, dz);
    if (len < HUNT_MIN) return false;
    dx /= len; dz /= len;
    // Never onto the man himself, and never further than the leash allows.
    const reach = Math.min(len - HUNT_MIN * 0.5, LEASH_R);
    if (reach < HUNT_MIN) return false;
    for (const frac of [1, 0.66, 0.4]) {
      const r = reach * frac;
      if (r < HUNT_MIN) continue;
      const i = g.nearest(a.position.x + dx * r, a.position.z + dz * r, a.position.y, 2, 1.4);
      if (i < 0 || g.indoor[i] !== 1) continue;
      this._v2.set(g.worldX(i % g.nx), g.floor[i], g.worldZ((i / g.nx) | 0));
      if (this._v2.distanceTo(c.anchor) > LEASH_R) continue;
      if (this._v2.distanceTo(a.position) < HUNT_MIN) continue;
      return true;
    }
    return false;
  }

  /**
   * Is this point in a room? `NavGrid.indoor` is the flag `_carveInteriors`
   * writes for cells it re-sampled from INSIDE a building's footprint, and it
   * is the only honest answer on this map. Two rings and a 1.4 m height
   * tolerance so a man standing on a doorway cell that fell between lattice
   * points is not called outdoors on a rounding error.
   */
  _indoors(p) {
    const g = this.ai?.grid;
    if (!g || !g.indoor) return true;
    const i = g.nearest(p.x, p.z, p.y, 2, 1.4);
    return i >= 0 && g.indoor[i] === 1;
  }

  /**
   * Is the PLAYER looking at this man: inside `FLEE_SEEN_R`, inside the view
   * cone, clear sight line to his chest. The same three tests
   * `AiSystem._updateSpotting` makes, asked of `physics` directly because
   * `match` does not read `ai`'s per-actor bookkeeping.
   */
  _isSeen(a, player) {
    const eye = this._eye.copy(this.ctx.camera.position);
    const p = this._v.set(a.position.x, a.position.y + 1.35, a.position.z);
    const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > FLEE_SEEN_R || d < 1e-3) return false;
    const f = player.forward;
    if (f && (dx * f.x + dy * f.y + dz * f.z) / d < FLEE_CONE) return false;
    if (this.phys && !this.phys.lineOfSight(eye, p, this.phys.MASK.SIGHT)) return false;
    return true;
  }

  /**
   * AWAY. A point `FLEE_RUN` metres along the bearing from the player, snapped
   * onto the nav grid — `nearest` is doing the work of "somewhere he can
   * actually get to", and it degrades to a shorter run rather than to nothing
   * when the bearing walks into a wall.
   *
   * `push` is the fast objective in `Agent` (4.3 m/s against `hold`'s 3.4) and
   * at this distance it is never `holdish`, so he runs in a straight-ish line
   * instead of picking a sector spot. He does not shoot on the way because he
   * cannot: @see `aiPacifist`.
   */
  _runAway(c, player) {
    const a = c.agent;
    const g = this.ai.grid;
    let dx = a.position.x - player.position.x;
    let dz = a.position.z - player.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) { dx = 1; dz = 0; } else { dx /= len; dz /= len; }
    for (const reach of [FLEE_RUN, FLEE_RUN * 0.6, FLEE_RUN * 0.3]) {
      const tx = a.position.x + dx * reach;
      const tz = a.position.z + dz * reach;
      const i = g ? g.nearest(tx, tz, null, 6) : -1;
      if (i < 0) continue;
      this._v2.set(g.worldX(i % g.nx), g.floor[i], g.worldZ((i / g.nx) | 0));
      if (this._v2.distanceTo(a.position) < 6) continue;
      a.setObjective('push', this._v2);
      return;
    }
  }

  /* ================================================================== */
  /* the price                                                          */
  /* ================================================================== */

  /**
   * One of them went down. Returns true if the actor was ours, so `match` knows
   * this death has no roster row, no respawn and no killfeed identity.
   *
   * THE PENALTY IS THE PLAYER'S ALONE. `by` has to BE the local player — not
   * his team, not a bot on his side — for the same reason `ai.protect` keeps
   * bots from choosing to shoot one: a cost you cannot avoid is not a decision.
   * A stray round of the player's own that kills a civilian he never saw still
   * counts, and should: that is what firing through a doorway means.
   *
   * KILLING AN ARMED ONE COSTS NOTHING — 「武装している場合は占領ポイントに影響が
   * ない」 — and it is also worth nothing. He is not on the scoreboard.
   */
  onActorDeath(victim, by, player) {
    const c = this._recordOf(victim);
    if (!c) return false;
    const mine = by != null && (by === player || by === 'player' || by.isPlayer === true);
    const k = c.unarmed ? 1 : 0;
    if (mine) this.stats.killedByPlayer[k]++;
    else this.stats.killedByOther[k]++;
    if (!mine || !c.unarmed) return true;

    const cap = this.capture;
    const t = player?.team ?? -1;
    if (cap && t >= 0) {
      const before = cap.score[t];
      cap.score[t] = Math.max(0, before - CIVILIAN_PENALTY);
      this.stats.penalty += before - cap.score[t];
    }
    /**
     * AND HE IS TOLD, AFTER THE FACT AND NEVER BEFORE IT. The whole feature is
     * silent until the trigger is pulled — no marker, no radar blip, no
     * killfeed row that reads differently. This is the receipt, and without it
     * the penalty is a number that quietly moved on a bar he was not looking
     * at. It is deliberately NOT a hitmarker or a kill banner: it says what he
     * did and what it cost, and nothing about what to do next.
     */
    this.ctx.peek('ui')?.banner?.show('CIVILIAN KILLED', `-${CIVILIAN_PENALTY} CAPTURE POINTS`, 2.4);
    return true;
  }

  /** Is this actor one of ours? Fifteen at the very most, so a scan is right. */
  _recordOf(actor) {
    if (!actor) return null;
    for (const c of this.list) if (c.agent === actor) return c;
    return null;
  }

  /** True if this actor belongs to the civilian force. Cheap; used by `match`. */
  owns(actor) {
    return actor?.aiCivil === true;
  }

  report() {
    const s = this.stats;
    return (
      `[civil] placed ${s.spawned[0]}+${s.spawned[1]}u of ${TOTAL}, ` +
      `alive ${this.aliveCount} · player killed ${s.killedByPlayer[0]} armed / ` +
      `${s.killedByPlayer[1]} unarmed (-${s.penalty} pts) · ` +
      `other killed ${s.killedByOther[0]}/${s.killedByOther[1]} · ` +
      `on doors ${s.onDoor}/${s.spawned[0]} · intercepts ${s.hunted} · ` +
      `leashed ${s.leashed} · fled ${s.fled} · ` +
      `unreachable rooms ${s.unreachable} · deferred ${s.deferred}`
    );
  }
}
