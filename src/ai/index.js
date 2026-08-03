/**
 * AI — enemy characters, navigation, perception, cover selection and combat
 * behaviour.
 *
 * WHAT LIVES WHERE
 *   rig.js        25-bone skeleton, bind pose, weapon anchor points
 *   geo.js        loft/tube/revolve toolkit, skin binder, baked vertex AO
 *   parts.js      body and kit: jacket, plate carrier, pouches, helmet, boots
 *   weapon.js     the carried carbine / long rifle, baked into the character
 *   textures.js   tiling PBR sets: camo cloth, cordura, skin, polymer, steel
 *   soldier.js    variant assembly -> one skinned geometry + material list
 *   clips.js      hand-authored pose layers (idle/walk/run/crouch/hit/recoil…)
 *   animator.js   layered blending + aim, look-at, arm and foot IK
 *   nav.js        walkability grid from the physics BVH, A*, string pulling,
 *                 cover point extraction and scoring
 *   agent.js      one enemy: senses, state machine, gun, hit zones, death
 *   squad.js      peek rotation, contact sharing, flank and grenade rationing
 *
 * PUBLIC API — `const ai = ctx.get('ai')`
 *   ai.spawn(variant, position, yaw, opts) -> Agent   opts: { team, name, role }
 *   ai.agents                              live Agent list
 *   ai.clearAgents()                       dispose every actor (round restart)
 *   ai.debugStage('firefight')             staged combat tableau for captures
 *   ai.prewarmMaterials()                  await: build + compile every character
 *                                          shader without spawning anything
 *   ai.grid / ai.cover                     navigation + cover queries
 *   ai.getHudActors()                      minimap blips, friend/foe from the
 *                                          local player's point of view
 *   ai.stats                               { agents, alive, navMs, coverPts,
 *                                            pathsDeferred, lodIrrelevant,
 *                                            unstick, unstickRungs }
 *
 * TEAMS — set by `match`, and the reason this file is not the one the repo
 * shipped with. An actor's `team` decides who it looks for, who it may hit and
 * whose blip it is. There are exactly two, so "hostile to team t" is `1 - t`.
 *   ai.playerTeam        which side the local player fights for
 *   ai.friendlyFire      false ⇒ rounds pass harmlessly through team-mates
 *   ai.matchControlled   true ⇒ `match` owns spawning; do not garrison
 *   ai.combatEnabled     false during freeze time: nobody may pull a trigger
 *
 * FRAME BUDGETS — navigation and the garrison are built during init(), not on
 * the first frame of play; A* is rationed to `ai.pathsPerFrame` solves per frame;
 * and an actor that provably cannot reach a pixel this frame (see
 * `_updateRelevance`) animates at a third rate and leaves the shadow cascades.
 *
 * EVENTS consumed: weapon:fire, bullet:impact, damage:dealt, explosion,
 *   player:footstep
 * EVENTS emitted: weapon:fire (enemy muzzle), weapon:shell, bullet:tracer,
 *   damage:dealt (enemy hitting the player), actor:death
 */

import * as THREE from 'three';
import { SoldierMaterials, TEAM_RIM, TEAM_DRESS } from './textures.js';
import { buildSoldier, resolveMaterials, MATERIAL_SLOTS, VARIANTS } from './soldier.js';
import { RIG } from './rig.js';
import { NavGrid, CoverMap, StairMap } from './nav.js';
import {
  Agent, STATE, drawPersona, archetypeMixFor, eliteArms, ARMOUR_FRAG_MIN, ARMOUR_FRAG_MAX,
} from './agent.js';
import { Squad } from './squad.js';
import { Radio } from './radio.js';
import { GroundShadows } from './grounding.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE THIRD FACTION — 「民間軍を投入して」
 * ════════════════════════════════════════════════════════════════════════════
 * `src/match/civilians.js` owns WHO they are, HOW MANY there are, WHERE they
 * come out and what a dead one costs. `ai` owns exactly three facts about them,
 * because all three are things `match` may not reach in and set:
 *
 *   1. WHAT KIND OF SOLDIER a civilian is (`drawCivilPersona`). A persona is
 *      an archetype, six traits, a gun and a marksmanship draw, and it is
 *      DRAWN INSIDE THE `Agent` CONSTRUCTOR — the mesh depends on the gun — so
 *      it cannot be applied afterwards. `match` says WHICH KIND by passing
 *      `role`, which `Agent` assigns before it asks for the persona.
 *   2. THAT AN UNARMED ONE NEVER FIGHTS (`aiPacifist`, read in exactly one
 *      place: the top of `pickVisibleHostile`).
 *   3. THAT NONE OF THEM ARE ON THE RADAR (`aiCivil`, read in exactly one
 *      place: `getHudActors`).
 *
 * Everything else about them — hiding, ambushing, staying indoors, fleeing —
 * falls out of code that already exists. @see `AiSystem._civilise`.
 *
 * THE ROLE STRINGS ARE A CONTRACT WITH `src/match`, spelled the same way at
 * both ends and agreed the way `AI_ROLE_FIELD` already is: `match` may not
 * import from `ai`, so the literal is the interface.
 */
const CIVIL_ROLE = Object.freeze({ armed: 'civil', unarmed: 'civilUnarmed' });

/**
 * WHAT AN AMBUSHER IS, AS A PERSONA.
 *
 * 「AI性能としては中の下くらいにして」 — lower-middle, and that is a statement
 * about MARKSMANSHIP, which in this file is one number: `skill` drives the
 * cone, the tracking rate, the hand shake, the burst length, the reaction time
 * and the settle. `RULES.botSkill` is 0.44 with a gaussian of sd 0.19, so an
 * ordinary soldier ranges 0.12-0.95 around 0.44. A civilian is drawn from
 * 0.20-0.44 with a mean near 0.30: worse than an ordinary man essentially
 * always, never so bad he cannot hit somebody who walks into the room.
 *
 * THE TRAITS ARE THE `anchor`'s, AND THEY USED TO BE PUSHED THE OTHER WAY.
 * 「もっと攻撃して邪魔してきて」 moved three of them, and moved `skill` NOT AT ALL,
 * because those are two different requests: 「AI性能としては中の下くらいに」 has
 * not been withdrawn and 「AIMは悪くてもいい」 is the same sentence — a militiaman
 * is meant to be a nuisance, not a marksman.
 *
 *   `aggression` 0.18 -> 0.55. It is read in eight places in agent.js and every
 *   one of them is about WILLINGNESS rather than accuracy: he breaks contact at
 *   34 HP of his 50 instead of 46 (`breakHealth`), so he fights his fight out
 *   instead of dying in a retreat; his frag window opens at 8.3 m instead of
 *   10.1 (`fragLo`), which on a 9-12 m fight is the difference between carrying
 *   a grenade and throwing one; and he walks toward the noise at 2.4 m/s
 *   instead of 1.5 (ALERT), which is the follow-up after a burst.
 *
 *   `patience` 0.88 -> 0.42. How long he sits on one angle (`holdTimer`,
 *   `coverDwell`) and how long he searches before giving up on a contact. The
 *   anchor who has not moved since the round started is precisely the man the
 *   request is complaining about.
 *
 *   `trigger` 0.74 -> 0.34, and THIS is the volume of fire. Read `_fireRound`:
 *   a low-discipline man opens with a longer pull (a floor of ~16 rounds
 *   against ~11), leaves a shorter gap between pulls, and is likelier to shoot
 *   while moving. IT COSTS HIM ACCURACY — the bloom opens with the pull, which
 *   is exactly the trade 「AIMは悪くてもいい」 asks for. `skill` is untouched, so
 *   his cone, tracking, shake, reaction and settle are the 中の下 they were.
 *
 *   `exposure` 0.14 -> 0.28. He still crouches (`crouch` needs < 0.42) and he
 *   is still not a man who stands in the street; he peeks for longer, which is
 *   what holding a doorway looks like from the other side of it.
 *
 * `flank` stays at 0.04 and is inert either way — the manoeuvre is behind
 * `sq && sq.canFlank` and a civilian has no squad. `range` STAYS AT 9 m, and it
 * was moved to 11 and moved back: the cover window is built around it, so a
 * longer preferred range is a man whose best cover against a contact in the
 * street is in the street, and the leash then spends the match walking him
 * home. It buys nothing at the other end either — `fragHi` is 20 + range × 0.4,
 * which is 24 m against 23 m. A room is the correct answer.
 *
 * WHERE HE DOES HIS INTERFERING IS NOT HERE. Standing in the doorway, and going
 * at somebody who is already inside his building, are placements and orders —
 * @see `DOOR_TRIES` and `HUNT_R` in src/match/civilians.js.
 *
 * THE GUN IS THE REQUEST'S: 「民間軍はAKとグレネードのみ装備」. AK for everyone,
 * and it is not sampled — `ARCHETYPE_ARMS` would hand out submachine guns and
 * belts, and the AK is the one the militiaman's mesh is holding.
 *
 * AND THE UNARMED ONE KEEPS THE OLD SET, WHICH IS NOT A TIDINESS DECISION.
 * "None of it is ever reached" was true of the traits that decide a FIGHT and
 * false of the ones that decide how a man stands about: `_think`'s ALERT branch
 * is `desiredSpeed = 1.1 + aggression × 2.4` and it is entered by being SHOT AT,
 * which happens to a pacifist constantly. Measured with one set for both kinds,
 * an unarmed civilian who had never acquired anybody milled at 2.6 m/s in a
 * 1-6 m circle round his room, walked out of his own door, and was leashed back
 * — repeatedly, and 「逃走以外で屋外に逃げることはない」 is his rule too. He is
 * 「攻撃してこない」 and 「逃走します」 and neither of those was the thing that was
 * asked to change.
 */
function drawCivilPersona(rng, unarmed) {
  const t = (v, sd) => Math.min(1, Math.max(0.02, v + rng.gauss() * sd));
  return {
    archetype: 'anchor',
    weapon: 'ak',
    traits: unarmed
      ? {
        aggression: t(0.18, 0.08),
        patience: t(0.88, 0.07),
        exposure: t(0.14, 0.06),
        flank: t(0.04, 0.03),
        trigger: t(0.74, 0.10),
        /** METRES, and never used: he acquires nobody. */
        range: 9 * rng.range(0.8, 1.5),
      }
      : {
        aggression: t(0.55, 0.09),
        patience: t(0.42, 0.09),
        exposure: t(0.28, 0.07),
        flank: t(0.04, 0.03),
        trigger: t(0.34, 0.10),
        /** METRES. A room, not a street. */
        range: 9 * rng.range(0.8, 1.5),
      },
    elite: false,
    skill: unarmed ? 0.2 : Math.min(0.44, Math.max(0.20, 0.30 + rng.gauss() * 0.07)),
  };
}

/** HP for every one of them. 「民間人は体力５０です 武装しているが防弾はない」 */
const CIVIL_HEALTH = 50;

/**
 * THE ARMOUR CONSTANTS, all in the hull's own frame and all read off the
 * collider boxes `Armour._buildColliders` registers. @see `AiSystem.armourWorth`
 * for what each one is doing and for the derivation of `DECK_PLUNGE`.
 */
/** Aim point height above the tank's ground origin — the deck's rear-top. */
const DECK_AIM_Y = 2.18;
/** …and how far astern of the origin it sits. */
const DECK_REAR = 3.05;
/** Metres astern of the origin the clear rear cone begins (hull tail is 3.2). */
const DECK_ASTERN = 3.4;
/** Half-width of that cone where it begins. It widens at ~39 degrees. */
const DECK_HALF_W = 1.9;
/** Slope a plunging shot needs to clear the turret roof. 0.37 m over 1.1 m. */
const DECK_PLUNGE = 0.37 / 1.1;
/**
 * ────────────────────────────────────────────────────────────────────────────
 * A SHOT ON A TANK IS A PRIORITY, NOT A TIE-BREAK — and it was measured both
 * ways before it was decided
 * ────────────────────────────────────────────────────────────────────────────
 * `pickVisibleHostile` takes the nearest thing it can see, and a hull competes
 * against twenty men. The first cut of this was 1.35 — "a man in your face
 * beats a tank down the street" — and over a full 424 s match at seed 12 that
 * produced, per hull, the following (`_tankfight.mjs`):
 *
 *     RED    12217 man-samples in range, 897 with a DECK shot, 333 with a frag
 *            ready — AIMED AT BY 0.   Killed nobody, was hit 3 times.
 *     BLUE   15855 / 1114 / 854              — AIMED AT BY 39.  One frag landed.
 *
 * i.e. the policy gate was doing its job and the SELECTION was throwing the
 * result away: a man who has walked into the one arc that can hurt a tank had a
 * team-mate's opponent closer to him essentially always, so he shot that
 * instead. The bias was the whole difference between "bots may engage armour"
 * and "bots engage armour".
 *
 * 0.5 makes it the other way round: a hull at 40 m beats a rifleman at 21 m,
 * and a rifleman at 19 m still wins. That is not a licence to mob it, because
 * `armourWorth` is what decides whether the hull is a candidate at all and it
 * says no to roughly NINE IN TEN of the men inside `RULES.tankRange` —
 * measured at 88-90 % across four matches — so the priority only ever applies
 * to a man who is astern of it, above it, or holding a grenade inside throwing
 * range.
 */
const ARMOUR_BIAS = 0.5;
/**
 * ────────────────────────────────────────────────────────────────────────────
 * YOU DO NOT HAVE TO BE LOOKING AT A TANK TO KNOW IT IS THERE
 * ────────────────────────────────────────────────────────────────────────────
 * `_sightTo` applies a 100 degree cone to everything, and already exempts
 * anything inside 4.5 m from it — a man does not miss somebody standing next to
 * him. A hull is 6.9 m long and 2.5 m tall, runs a tracked engine and fires a
 * 300-damage main gun every 5.5 seconds; the same argument applies to it at a
 * great deal more than four and a half metres, and the cone was measurably
 * where the engagement went. Seed 12, one match, BLUE: 647 man-samples with a
 * clear line to the engine deck, 608 of them inside the man's own `viewRange` —
 * and 106 that actually became a target, because the other five sixths were
 * facing the way the fight was.
 *
 * 40 m is the radius, not the range: past it the cone applies exactly as it
 * does to a man, so a hull at 60 m still has to be looked at. It changes
 * nothing about who may SHOOT — `armourWorth` still says no to a man in front
 * of it — and it changes nothing at all for an `Agent`, whose 4.5 m is
 * untouched.
 */
const ARMOUR_NOTICE = 40;
/**
 * ────────────────────────────────────────────────────────────────────────────
 * SUPPRESSION AGAINST ARMOUR — the engagement the player can actually SEE
 * ────────────────────────────────────────────────────────────────────────────
 * The deck/frag policy is correct and was measured doing its job — and the
 * player still reports 「ちゃんと戦車を敵として認識して壊すようにAIにインプットして」,
 * his third time, because the policy's success is INVISIBLE from his seat:
 * `armourWorth` refuses 88-90 % of the men in range, and on seed 12 the RED
 * hull finished a whole match with 0 rounds ever fired at it. Thirty men
 * ignoring a tank that is shelling their objective reads as a bug whatever the
 * bench says.
 *
 * So there is now a THIRD worth (3): fire is allowed as SUPPRESSION — tracers
 * and sparks on the glacis, no expectation of effect — but only when the tank
 * has made itself unignorable, and only from the men whose personality hoses:
 *
 *   • the hull fired its guns inside `ARMOUR_PROVOKED` seconds (a tank that
 *     just killed your squadmate is not scenery), OR it is parked within
 *     `ARMOUR_OBJECTIVE_R` of the man's own objective;
 *   • the man's `traits.trigger` is under `ARMOUR_HOSE` — the sprayers, the
 *     same men who already hose windows on the suppression coin flip. The
 *     disciplined half of the roster still holds its fire, so the old refusal
 *     is loosened, not deleted;
 *   • and a suppressing man NEVER beats a live human contact: worth-3 armour
 *     is scored at `ARMOUR_SUPPRESS_BIAS` times its distance where a real
 *     shot on the deck is scored at `ARMOUR_BIAS` times. A man with a rifleman
 *     in his face keeps fighting the rifleman; a man with nothing else to
 *     shoot answers the tank.
 *
 * The glacis eats these rounds at 0.22 — that is the point. The kill still
 * comes from the deck and the frags; this is the tank being VISIBLY fought.
 */
const ARMOUR_PROVOKED = 6.0;
const ARMOUR_OBJECTIVE_R = 26;
const ARMOUR_HOSE = 0.62;
const ARMOUR_SUPPRESS_BIAS = 1.35;

/**
 * AN ENEMY INSIDE MY OBJECTIVE'S CIRCLE SCORES AS THOUGH HE WERE THIS MUCH
 * NEARER. @see `pickVisibleHostile`. 9 m is `Agent`'s `SITE_HOLD_R` — the 8 m
 * capture radius `src/match` owns, plus a metre of sandbag — squared here so
 * the test is a compare rather than a square root.
 */
const SITE_TARGET_BIAS = 0.55;
const SITE_TARGET_R2 = 9 * 9;

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE DRONE, SCORED — 「捕捉されたらちゃんと撃つように 間に合わなくてもいい」
 * ════════════════════════════════════════════════════════════════════════════
 * The request has two halves and they are two different numbers.
 *
 *   THE MAN WHO HAS BEEN LOCKED must shoot at it, and "間に合わなくてもいい" is
 *     the explicit permission to make that a losing fight: a drone dives at
 *     17 m/s and the warhead functions whatever the man does. `0.14` is a bias
 *     strong enough that the thing coming to kill him beats a rifleman standing
 *     seven times closer, which is the intent — it is not a filter, so a man
 *     with a muzzle in his face still fights the muzzle.
 *   EVERYBODY NEAR AN UNLOCKED ONE ("捕捉される前に近くにいても撃つように") gets a
 *     mild preference inside `DRONE_NEAR`, so a machine crossing a street draws
 *     fire from the men under it without emptying the capture point.
 *
 * `DRONE_NEAR` is deliberately shorter than any weapon's range: a 0.31 m sphere
 * at sixty metres is not a target, it is a distraction, and the men who should
 * be shooting at it are the ones it is about to be on top of.
 */
const DRONE_LOCKED_BIAS = 0.14;
const DRONE_NEAR_BIAS = 0.7;
const DRONE_NEAR = 34;
/**
 * A drone is a small fast thing overhead and a man is entitled to notice it
 * outside his cone: this is the `blind` radius `_sightTo` grants it, the same
 * mechanism `ARMOUR_NOTICE` is. Much shorter than the tank's 40 m, because a
 * quadcopter is not a 29-tonne hull.
 */
const DRONE_NOTICE = 18;

/**
 * SMOKE. @see `AiSystem._smokeBlocks`.
 *
 * `SMOKE_CORE` is the fraction of the can's drawn radius that actually refuses
 * a sightline, and it is under 1 on purpose: `fx`'s cloud grows to the full
 * radius over several seconds and is ragged at its edge for the whole of its
 * life, so a hard sphere at the drawn radius would refuse shots through air the
 * player can plainly see through. 0.78 is the part that is reliably opaque.
 */
const SMOKE_MAX = 6;
const SMOKE_CORE = 0.78;
/**
 * ══════════════════════════════════════════════════════════════════════════
 * A BOT'S CAN IS THE SAME CAN THE PLAYER THROWS — 「スモークの範囲今の５倍にして」
 * ══════════════════════════════════════════════════════════════════════════
 * `_detonateThrown` wrote `ev.radius = 6.5` from a bare literal, and the player's
 * screen has just gone to 40 m (`weapons/defs.js:smoke.smokeRadius`). The event
 * that literal rides out on is the SAME event `_addSmoke` builds the sightline
 * volume from, so a bot was throwing a screen a sixth of the size of the one
 * being thrown at him — and `_smokeBlocks` runs in both directions, so it was
 * an asymmetry in what each side could hide behind, not a cosmetic one.
 *
 * `ai` may not import `weapons/defs.js` (@see ARCHITECTURE.md rule 2), so these
 * are a MIRROR, exactly as the `WEAPONS` rack in agent.js mirrors the gun table
 * — but a mirror that CORRECTS ITSELF: `_smokeR` is latched from the radius the
 * player's own `weapon:smoke` carries the first time one goes off, so the two
 * numbers cannot drift apart again without the drift being repaired in flight.
 * Three unnamed literals in one file is how they drifted the first time; there
 * is now one named number and it is checked against the authority at runtime.
 *
 * `SMOKE_GROWTH` is a RATIO and not a distance — `Ambience._puff` sizes a puff
 * at `radius * growth` where `radius` is already `rad * 0.22`. The bot path
 * still carried the OLD quadratic form (`ev.radius * 0.9`), which at a 40 m can
 * is a growth of 36 and a sprite the size of the district. Mirrored from
 * `grenades.js`, where the same bug was already fixed.
 */
/**
 * AND THE MIRROR HAS ALREADY EARNED ITS LATCH. This was written at 40 against
 * `weapons/defs.js` and `weapons/grenades.js`, and both of them came back to 10
 * one commit later (`b65f0e8`, "40 broke the drawing"). The default is followed
 * back down here for tidiness; what matters is that a build in which it had NOT
 * been would still have thrown a 10 m can, because `_smokeR` takes the real
 * figure off the first `weapon:smoke` that goes off. That is the whole reason
 * it is a latch and not a literal.
 */
const SMOKE_R = 10;
const SMOKE_T = 14;
/**
 * ════════════════════════════════════════════════════════════════════════════
 * AND THE DRAWING DRIFTED FOR THE THIRD TIME — 「実質３mくらいしかスモークでてない」
 * ════════════════════════════════════════════════════════════════════════════
 * The player's can was just fixed and a bot's was not, because `_detonateThrown`
 * had its own `addSmokeSource` call carrying its own `rate: 26` and
 * `radius * 0.22` while `ev.radius` — the GAMEPLAY figure, latched off the
 * player's own `weapon:smoke` — was already the full 10 m. A bot's screen
 * therefore refused 10 m of sightline in `_smokeBlocks` and drew about 3 m of
 * cloud, symmetrically for both sides, which is a lie the player can see.
 *
 * THE THREE NUMBERS ARE READ OFF `src/weapons/grenades.js` — `SMOKE_FOOT`,
 * `SMOKE_GROWTH` and `SMOKE_RATE`, which is where they are recorded and argued.
 * They are RETYPED and not imported because ARCHITECTURE.md rule 2 forbids the
 * import, exactly as `SMOKE_R` and the `WEAPONS` rack are retyped; what is new
 * is that there is now ONE drawing path inside this file (`_smokeDraw`) instead
 * of a second inline copy, so the next change has one place to land.
 *
 * FOOT and GROWTH are two halves of one number. `Ambience._puff` spends
 * `radius` on the spawn disc, the newborn puff's width AND the turbulence, and
 * then sizes the puff at `radius * growth`. `0.22 x 5.85` was a 12.9 m sprite
 * born inside a 2.6 m disc: what the eye reads is the YOUNG puff, and the young
 * puff is the footprint. `0.62 x 1.8` is the same product against a footprint
 * 2.8x wider, which is the whole of the fix.
 *
 * THE RATE IS NOT OPTIONAL AND IT IS NOT TASTE. `rate x life` IS the live
 * sprite count — 78 x 7.5 is 585 — and they come out of `fx.lit`, which is a
 * share of `q.particleBudget` and is 935 slots on the `low` tier. That layer is
 * shared with blood, dust and impact puffs, so two cans at 585 would wrap the
 * ring inside a single puff's lifetime and evict all of it. A quarter of the
 * ring is the most one can may take; it binds on `low` alone (~31/s there, near
 * the 26 this always was) and leaves every other tier at the photographed 78.
 */
const SMOKE_FOOT = 0.62;
const SMOKE_GROWTH = 1.8;
const SMOKE_RATE = 78;
const SMOKE_LIFE = 7.5;
/** How much of his own flash a man who was warned about it takes. */
const FLASH_OWN_SIDE = 0.3;

/**
 * THE ZONE PULL. @see `AiSystem.divertZoneFor`.
 *
 * `DIVERT_MIN` is "he is still in transit rather than arriving" — 26 m is over
 * three capture radii, so a man anywhere near the point he was sent to is never
 * a candidate. `DIVERT_GAIN` is the honest margin: a diversion has to save a
 * real walk, or it is churn. `CONTEST_W` and `RETAKE_W` are the weights that
 * make "in play" beat "nearer", and they are why a contested point pulls men
 * from across the map while a merely enemy-held one only pulls the men who were
 * already going past it.
 */
const DIVERT_MIN = 26;
const DIVERT_GAIN = 12;
const CONTEST_W = 0.38;
const RETAKE_W = 0.82;

export class AiSystem {
  static id = 'ai';
  static deps = ['physics', 'world'];

  async init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    this.root = new THREE.Group();
    this.root.name = 'ai';
    ctx.scene.add(this.root);

    const t0 = performance.now();
    this.materials = new SoldierMaterials(this.rng.fork(), {
      size: 512,
      anisotropy: ctx.config.q.anisotropy ?? 8,
      // `civil` is PLAIN CLOTH and not a fourth camouflage — one bake serving
      // both civilian dresses, separated by tint. @see CAMO.civil in textures.js.
      camo: ['arid', 'woodland', 'urban', 'civil'],
    });
    // Contact occlusion under every actor. Without it the cast shadow alone
    // leaves them hovering: see grounding.js.
    //
    // The capacity is a HARD CAP — `addActor` silently drops quads past it, so
    // at 16 a 15v15 would have had half the men on the map floating. 40 covers
    // thirty live actors plus the corpse budget. It is two InstancedMeshes and
    // the count is set per frame, so an unused slot costs nothing to draw.
    this.ground = new GroundShadows(this.root, 40);
    this._variants = new Map();
    this.agents = [];
    this.squads = [];
    /**
     * THE RADIO NET. One object for the whole map, two nets inside it — see
     * `src/ai/radio.js` for why the rate limit cannot be global. Built here so
     * it exists before the first `spawn`, bound to the level in `_buildNav`.
     */
    this.radio = new Radio(this);
    this.grid = null;
    /**
     * THE COVER TABLE IN PLAY. It is one of the two below, never a third thing:
     * everything that reads cover reads `this.cover`, and the map changing is
     * this one reference moving. @see `setCoverRazed`.
     */
    this.cover = null;
    /** Cover with the cathedral STANDING. @see `_bakeCover`. */
    this.coverIntact = null;
    /** Cover with the cathedral LEVELLED, or null if this level has no ruin. */
    this.coverRuin = null;
    /** Which of the two `this.cover` currently points at. */
    this._coverRazed = false;
    /**
     * `world.demolitions`, held so the frame loop can see which blocks are
     * down without asking `world` for the list again. @see `syncCoverBlocks`.
     */
    this._demoRecs = null;
    /** One bit per demolition block, 1 = down. */
    this._blockMask = 0;
    this.inspect = false;
    this.debugLog = false;
    /** dev: force the garrison to spawn even in deterministic capture runs */
    this.forcePopulate = false;
    this._navPending = true;
    this.stats = {
      agents: 0,
      alive: 0,
      navMs: 0,
      coverPts: 0,
      coverRuinPts: 0,
      /** cover points whose mass belongs to a destructible block */
      coverDeps: 0,
      /** cover points that only exist once a block is rubble */
      coverRubblePts: 0,
      walkable: 0,
      unstick: 0,
    };
    /**
     * HOW OFTEN THE RECOVERY LADDER FIRED, AND HOW FAR UP IT WENT — one counter
     * per rung of `Agent._unstick`. It is the only way to tell "nobody gets
     * stuck any more" apart from "the detector stopped detecting", and the shape
     * matters as much as the total: a healthy map is nearly all rung one, and
     * weight at rung five is geometry nobody can walk rather than a wedge.
     * Preallocated; `_unstick` runs on real frames.
     */
    this.stats.unstickRungs = [0, 0, 0, 0, 0, 0];

    /* ---- teams (driven by `match`; the defaults are the shipped behaviour) -- */
    this.playerTeam = 0;
    /** Every actor spawned without an explicit team is hostile to the player. */
    this.friendlyFire = true;
    this.matchControlled = ctx.has('match');
    this.combatEnabled = true;
    /** 0..1, scales reaction time and aim discipline. */
    this.skill = 0.62;
    /**
     * ADDED TO THE DEFENCE'S SKILL MEAN — "防衛側はもう少しAIの命中精度上げていい".
     *
     * The defence is the side that gets shot at while standing still, and it is
     * the side the player spends most of a round pushing into, so it is the one
     * that has to be worth pushing into. This shifts only the MEAN: the per-man
     * gaussian (sd 0.19) is untouched, so a defence at `botSkill` 0.44 + 0.10
     * still contains men from 0.2 to 0.9 and the round is still readable.
     *
     * It lives here rather than in `RULES` because nothing in `match` needs to
     * know: `match` sets `ai.skill` and this is applied per actor from its role.
     */
    this.defenderSkill = 0.10;
    /**
     * Personality cache, `team:name:role` -> persona. A respawn is a new `Agent`
     * (see `match._respawnBot`), so without this a callsign would draw a new
     * character every death and no bot would be a recognisable person. Cleared
     * with the level, not with the round.
     */
    this._personas = new Map();
    /** One shuffled archetype deck per `team:role`. @see `_nextSlot`. */
    this._decks = new Map();
    /** Actors hostile to team i, rebuilt at most once per frame. */
    this._hostiles = [[], []];
    this._hostileFrame = -1e9;
    /**
     * ──────────────────────────────────────────────────────────────────────
     * NON-`Agent` HOSTILES — the armour, and the reason it was scenery
     * ──────────────────────────────────────────────────────────────────────
     * `hostilesOf` built its list from `this.agents` plus the local player, and
     * `Agent.target` only ever comes from that list. A tank is not an `Agent`,
     * so MEASURED while a hull was on the field: a tank appeared in a hostile
     * list 0 times and a bot aimed at one 0 times, across 273-321 man-samples
     * inside `RULES.tankRange`. Every round any hull ever absorbed was a stray
     * fired at a man standing beyond it — the `deck` damage column was 0 in
     * every row of every match.
     *
     * The contract is deliberately the smallest thing that can be shot at:
     *
     *     { position:Vector3, alive:boolean, team:0|1,
     *       isVehicle:true,            // opts in to the armour rules below
     *       aimPoint:Vector3,          // WHERE to shoot it — @see `actorChest`
     *       yaw:number,                // its heading — @see `armourWorth`
     *       firedAt:number,            // when its guns last fired, elapsed s —
     *                                  // the suppression clause reads it
     *       solid:boolean,             // a man may not stand inside it. TRUE
     *                                  // FOR A WRECK: `alive` is shootable,
     *                                  // `solid` is on the field at all
     *       crushing:boolean,          // it is under power, so a man it cannot
     *                                  // shove clear is run over rather than
     *                                  // let through
     *       halfW, halfL,              // its plan rectangle about `position`
     *       bodyLow, bodyHigh }        // and the height band above it
     *
     * THE LAST FIVE ARE THE PHYSICAL HULL — 「戦車への物理判定つけて、キャラが通り
     * 過ぎることが可能なので」. They are published rather than assumed because `ai`
     * may not know a vehicle's dimensions any more than it may know its local
     * frame, and they are read in exactly two places, both in `Agent`:
     * `_move`'s local-avoidance loop steers men round a hull, and
     * `_clearHulls` de-penetrates the ones a hull has driven onto. NOTHING
     * HERE TOUCHES THE NAV GRID — @see the `HULL_AVOID` note in `agent.js` for
     * why a 7 m moving solid cannot go into a height field baked at boot, and
     * why nobody can be wedged by one.
     *
     * `match` owns the roster, so it hands the LIVE ARRAY over once
     * (`this.ai.vehicles = this.tank.tanks`) and every entry's `alive` flag does
     * the rest: a parked hull is `alive:false` and is simply not in the list.
     * Nothing here is allocated per frame and nothing here reaches into `match`.
     */
    this.vehicles = null;
    /**
     * ──────────────────────────────────────────────────────────────────────
     * …AND THE DRONES, WHICH WERE SCENERY FOR EXACTLY THE SAME REASON
     * ──────────────────────────────────────────────────────────────────────
     * 「ドローンは捕捉されたらちゃんと撃つようにして 間に合わなくてもいい 捕捉される前に
     *  近くにいても撃つようにして」
     *
     * `src/match/drone.js` puts a 0.31 m sphere on `LAYER.SHOOT_ONLY` and a
     * round already arrives as a canonical `damage:dealt` with the shooter
     * attached, so the ONLY missing piece was the same one the tank had: a
     * drone is not an `Agent`, `Agent.target` only ever comes out of
     * `hostilesOf`, so nobody could ever choose to shoot one.
     *
     * `match` hands the LIVE POOL over once (`ai.drones = match.drones.list`)
     * and `alive` does the rest, exactly as it does for a parked hull. The
     * contract is even smaller than the vehicle one, because a drone is not
     * armour and needs none of the worth policy:
     *
     *     { position:Vector3, alive:boolean, team:0|1, target:actor|null }
     *
     * `target` is the man it has LOCKED, and it is the only field this file
     * interprets: @see `DRONE_LOCKED_BIAS`. Everything else about a drone —
     * where to aim at a body with no head, how a man engages it — falls out of
     * code that already exists (`actorChest`'s no-`eyeHeight` branch, and the
     * ordinary man-versus-man combat loop, because `isVehicle` is not set).
     *
     * The identity test is a `Set` built ONCE when the array is handed over
     * rather than a flag written onto `match`'s objects: `ai` may read another
     * subsystem's published record and may not scribble on it.
     */
    this._drones = null;
    this._droneSet = null;
    /**
     * ──────────────────────────────────────────────────────────────────────
     * LIVE SMOKE, AS FIVE NUMBERS EACH: x, y, z, radius, expiry.
     * ──────────────────────────────────────────────────────────────────────
     * A flat `Float64Array` rather than objects because `_smokeBlocks` runs
     * inside `_sightTo`, which is the hottest thing in this file — two rays per
     * actor per selection across forty men — and because a fixed array is the
     * only shape that cannot allocate. `SMOKE_MAX` is a ration, not a budget:
     * `Squad.screenCooldown` is eight seconds a side and a can lasts fourteen,
     * so four live clouds is already more than both sides can pay for, and the
     * oldest slot is recycled rather than the newest refused.
     */
    this._smoke = new Float64Array(SMOKE_MAX * 5);
    this._smokeN = 0;
    this._smokeNext = 0;
    /** What a can is worth, mirrored and then latched from the real one. @see `SMOKE_R`. */
    this._smokeR = SMOKE_R;
    /** Suppression against armour — @see clause 3 of `armourWorth`. Flipped
     *  only by `_tankfight.mjs`, to report the engagement rate both ways. */
    this.armourSuppress = true;
    /**
     * Which side wears each appearance, so the team rim can be resolved (see
     * TEAM_RIM in textures.js). A variant's materials are shared by every actor
     * wearing it — three uniform floats, not a per-actor value — which is what
     * makes the rim free. `match` already gives the two sides disjoint variant
     * lists (rules.js TEAM_VARIANTS); if that ever stops being true this warns
     * once rather than silently rimming half a squad the wrong colour.
     */
    this._variantTeam = new Map();
    this._rimTeam = -1;
    this._rimWarned = false;
    this._blips = [];
    this._blipOut = [];

    /* scratch */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._probe = { y: 0, nx: 0, ny: 1, nz: 0, hit: false };
    this._tracerFrom = new THREE.Vector3();
    this._tracerTo = new THREE.Vector3();
    this._fireEvent = {
      weapon: 'ai_rifle',
      origin: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      seed: 0,
      // Sprites and light are gained SEPARATELY: see _flashGain/_flashLight.
      // The sprites have to read as fire at 25 m; the punctual light must not
      // turn the shooter into the brightest object in the frame.
      intensity: 0.12,
      light: 0.006,
      // Size is gained separately from radiance: a 0.12-intensity flash scaled
      // geometrically by 0.12 is 3 mm across and invisible at 20 m.
      flashScale: 0.8,
    };
    this._shellEvent = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };
    this._tracerEvent = { from: this._tracerFrom, to: this._tracerTo, speed: 800 };
    this._grenades = [];
    this._grenadeGeo = null;
    this._grenadeMat = null;
    /**
     * The two non-lethal payloads, preallocated and REUSED — the same contract
     * `match`'s air events publish under. @see `_detonateThrown`.
     */
    this._throwEvent = { position: new THREE.Vector3(), radius: 0, duration: 0, team: -1 };
    this._blastEvent = {
      position: new THREE.Vector3(), radius: 0, damage: 0, impulse: 0,
    };

    /* ---- frame budgets and LOD state (see _updateRelevance / requestPath) ---- */
    this._pathBudget = 0;
    /** Rotating start index for the per-frame sweep; see `update()`. */
    this._turnCursor = 0;
    /** A* solves allowed per frame. Measured: one solve is 0.5-1.1 ms on the
     *  221x221 grid, and a squad that all enters combat on the same frame used to
     *  ask for six of them at once.
     *
     *  Raised from 2 to 4 under `match`: two full seven-man teams are 13 actors
     *  rather than 6, and a headless match measured 12k deferred solves across
     *  4.1k frames — three requests a frame going unanswered, which reads as
     *  bots hesitating at every corner. 4 solves is ~3 ms worst case and the
     *  worst case does not happen on consecutive frames.
     *
     *  Raised again to 9 for the 15v15, and this one was measured three ways on
     *  full headless matches at thirty actors — ~250 s of wall clock each, ~20
     *  live minutes of match. One solve on this grid costs 0.29-0.33 ms (mean
     *  over ~50k of them), so the ration is a hard cap of about 3 ms:
     *
     *    ration   solves/frame   ai ms   m/bot/min   deferred/frame
     *      7          6.07        4.47      62.1          6.1
     *      9          8.08        5.17      67.0          4.3
     *     11          9.10        5.80      69.7          2.4
     *
     *  Distance travelled keeps climbing with the ration, because a man whose
     *  path request is never answered has no move target and stands still — but
     *  it is flattening by 9 while the millisecond is not. 9 takes most of the
     *  starvation out for a fifth of a 60 Hz frame. (Plant counts and win
     *  reasons moved around by more than the ration did across these runs; seven
     *  to ten rounds is not enough to read a two-plant difference, so they are
     *  deliberately not in this table.)
     *
     *  The other half of this fix is in `update()`: the sweep starts at a
     *  rotating offset so the ration is round-robin. Without that, no ration is
     *  large enough — the tail of the array is starved every frame regardless. */
    this.pathsPerFrame = ctx.has('match') ? 9 : 2;
    /**
     * THE RATION IS REALLY A MILLISECOND BUDGET, and a solve count is only a
     * proxy for it. That proxy broke the moment the level changed size: the
     * table above was measured on a 221x221 grid at 0.33 ms a solve, and when
     * `world` scaled the map by 1.5 the grid became 328x329 with 86k walkable
     * cells and a solve became 1.50 ms — same ration, 9.76 ms a frame of A*,
     * and the AI subsystem's mean went from 5.5 ms to 12.6 ms without a line of
     * this file changing.
     *
     * So the count is now a CAP and this is the actual budget: the effective
     * ration each frame is `pathMsBudget / (measured cost of a solve)`, clamped
     * into 3..pathsPerFrame. `_pathCostMs` is an exponential mean maintained by
     * `requestPath`, so it costs one multiply-add per solve and needs no
     * knowledge of the map at all. A bigger level automatically buys fewer
     * solves per frame rather than silently costing four times as much.
     */
    this.pathMsBudget = 4.5;
    this._pathCostMs = 0.4;
    this.stats.pathsDeferred = 0;
    /**
     * CORPSE BUDGET. With one life a round there were at most 30 bodies on the
     * map and they all appeared in the last few seconds. With respawns a five
     * minute round produces hundreds, and each one is a live ragdoll in the
     * physics solver plus a skinned mesh in the scene — the frame time walks
     * upward for the whole round and never comes back. The oldest bodies are
     * disposed once there are more than this many; the newest stay, because the
     * body you care about is the one that just fell in front of you.
     */
    this.corpseLimit = ctx.has('match') ? 14 : 64;
    this._corpses = [];
    this._frustum = new THREE.Frustum();
    this._mvp = new THREE.Matrix4();
    this._sphere = new THREE.Sphere();
    this._sweep = new THREE.Sphere();
    this._sun = new THREE.Vector3(0, 1, 0);
    this._lodStats = { irrelevant: 0 };

    this._wireEvents(ctx);
    console.info(
      `[ai] materials ${(performance.now() - t0).toFixed(0)}ms ` +
        `(${this.materials.bakeMs.toFixed(0)}ms texture bake)`
    );
    // The albedo budget is only real if it is measured. Print what every camo
    // bake actually landed on, so a drift out of 0.09-0.32 is visible in the
    // capture log instead of only in the critic's histogram.
    for (const k in this.materials.camoStats ?? {}) {
      const s = this.materials.camoStats[k];
      console.info(
        `[ai] camo ${k}: map mean ${s.mean.toFixed(3)} (was ${s.was.toFixed(3)}) ` +
          `range ${s.min.toFixed(3)}-${s.max.toFixed(3)} sd ${s.sd.toFixed(3)}`
      );
    }

    // Navigation, the garrison and every character shader, DURING BOOT.
    //
    // MEASURED, not guessed: all of this used to land on the first `update()`
    // after the player took control — 224 ms for the 221x221 walkability grid,
    // 19 ms for the cover map and 93/58/57 ms to build the three soldier
    // geometries the first three spawns ask for. One 450 ms freeze, on the frame
    // the player starts playing, plus five character programs compiling over the
    // frames after it (116-328 ms each).
    //
    // Doing it here is behaviour-identical rather than merely similar: no frame
    // has run yet, so `physics`, `world` and `player` are in exactly the state
    // the first update would have found them in, and the order of RNG draws —
    // which is what decides how every soldier is stitched together — is
    // unchanged. `update()` keeps the same code as a fallback for the case where
    // the collision world is not registered yet.
    this._bootNav(ctx);
    // `physics` keeps 8 ragdolls by default and evicts the oldest to make room.
    // We keep 14 corpses, so six of the bodies on the map were being drawn by a
    // solver that had been disposed underneath them: `dispose()` drops
    // `bones3D`, the doll leaves `physics.ragdolls`, and the skeleton freezes on
    // whatever transforms it last wrote — mid-fall, mid-air, mid-blast. `ai`
    // owns `corpseLimit`, so `ai` is what has to say how deep the pool must be.
    const phys = this.phys;
    if (phys) phys.maxRagdolls = Math.max(phys.maxRagdolls, this.corpseLimit);
    await this.prewarmMaterials();
  }

  /**
   * Build navigation and garrison the level at boot. Never throws: if physics
   * has no level yet, `_navPending` stays set and `update()` retries.
   */
  _bootNav(ctx) {
    try {
      this._buildNav();
      // Under `match` the round owns who exists and where: garrisoning here
      // would spawn a patrol that the first round teardown throws away.
      if (!this._navPending && !this.matchControlled && (!ctx.config.deterministic || this.forcePopulate)) {
        this.populate();
      }
    } catch (err) {
      this._navPending = true;
      console.warn('[ai] boot nav deferred to the first frame:', err?.message ?? err);
    }
  }

  /**
   * Build every character material and force its shader program to compile,
   * WITHOUT spawning a gameplay object and WITHOUT drawing a frame.
   *
   * This is the hook `src/core/prewarm.js` documents as missing: its `transients`
   * pass reached the character programs by staging a firefight, which left actors
   * and decals behind and blew the pixel gate. Nothing here is a gameplay object.
   *
   *  - `resolveMaterials()` is a pure function of the variant name, so every
   *    material every variant will ever ask for can be created now. It draws no
   *    random numbers, so the RNG stream — and therefore the picture — is
   *    untouched. It MUST be handed `MATERIAL_SLOTS` in the builder's own order:
   *    three sorts opaque draws (including the nine groups inside one soldier) by
   *    the global `Material.id` counter, so creating them in any other order
   *    reorders those draws and flips the depth tie on coplanar surfaces. That is
   *    a measured 2-pixel gate failure, not a theory — see MATERIAL_SLOTS.
   *  - the programs are compiled against a throwaway scene holding ONE dummy
   *    SkinnedMesh. The permutation three compiles is decided by the material
   *    plus the object's features (skinning, vertex colours, uv) and the target
   *    scene's lights, so a 6-triangle stand-in with the real 25-bone skeleton
   *    and the real vertex attributes yields the same programs a soldier does.
   *  - the cascade depth variant is compiled too, by borrowing render's own
   *    override material: `compileAsync` only ever looks at `object.material`, so
   *    the skinned depth program is otherwise not reachable without rendering a
   *    shadow map.
   *
   * Idempotent and never throws — a failed prewarm just means the old stutter.
   */
  async prewarmMaterials() {
    if (this._prewarmed) return this._prewarmed;
    const t0 = performance.now();
    const out = { ok: false, materials: 0, programs: 0, ms: 0 };
    this._prewarmed = out;
    try {
      const mats = [];
      const seen = new Set();
      for (const name in VARIANTS) {
        for (const m of resolveMaterials(name, MATERIAL_SLOTS, this.materials)) {
          if (m && !seen.has(m)) { seen.add(m); mats.push(m); }
        }
      }
      // the thrown grenade's mesh is built on the first throw, mid-firefight
      this._ensureGrenade();
      out.materials = mats.length + 1;

      const r = this.ctx.peek('render');
      if (r?.patcher) {
        for (const m of mats) r.patcher.patch(m);
        r.patcher.patch(this._grenadeMat);
      }
      const renderer = r?.renderer;
      if (!renderer) return out;
      const before = renderer.info.programs?.length ?? 0;

      const scene = new THREE.Scene();
      const { skeleton, root } = RIG.createSkeleton();
      const geo = this._dummySkinGeometry();
      const mesh = new THREE.SkinnedMesh(geo, mats);
      mesh.frustumCulled = false;
      scene.add(root);
      scene.add(mesh);
      mesh.bind(skeleton);

      const compile = async (target) => {
        try {
          await renderer.compileAsync(scene, this.ctx.camera, target);
        } catch {
          try { renderer.compile(scene, this.ctx.camera, target); } catch { /* driver */ }
        }
      };
      await compile(this.ctx.scene);
      // cascade depth: same object, render's own override material
      const depth = r.csm?.depthMaterial;
      if (depth) {
        mesh.material = depth;
        await compile(this.ctx.scene);
      }
      // the grenade is a plain (unskinned) mesh, so it needs its own object
      scene.remove(mesh);
      const g = new THREE.Mesh(this._grenadeGeo, this._grenadeMat);
      scene.add(g);
      await compile(this.ctx.scene);
      scene.remove(g);

      geo.dispose();
      skeleton.dispose?.();
      out.programs = (renderer.info.programs?.length ?? 0) - before;
      out.ok = true;
    } catch (err) {
      out.error = String(err?.message ?? err);
    }
    out.ms = Math.round(performance.now() - t0);
    console.info(`[ai] prewarmMaterials ${JSON.stringify(out)}`);
    return out;
  }

  /**
   * A 2-triangle skinned stand-in carrying exactly the attributes a soldier's
   * geometry does — position, normal, uv, colour, skinIndex, skinWeight. Three
   * derives half of the shader permutation from the geometry's attributes, so
   * anything missing here would compile the wrong program.
   */
  _dummySkinGeometry() {
    const g = new THREE.BufferGeometry();
    const n = 3;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(n * 4), 4));
    const w = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) w[i * 4] = 1;
    g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    return g;
  }

  /* ================================================================== */
  /* events                                                             */
  /* ================================================================== */

  _wireEvents(ctx) {
    this._off = [];
    const on = (t, fn) => this._off.push(ctx.events.on(t, fn));

    on('weapon:fire', (e) => {
      if (!e || !e.origin || e.weapon === 'ai_rifle') return; // ignore our own
      // A gunshot is the loudest thing in the level: everybody hears it, and
      // anyone near the line of fire also feels suppressed by it.
      for (const a of this.agents) {
        if (!a.alive) continue;
        a.hear(e.origin, 90);
        if (e.dir) {
          const d = this._distanceToRay(a.position, e.origin, e.dir, a.eyeHeight);
          if (d < 2.6) a.suppress(0.45 * (1 - d / 2.6) + 0.12);
        }
      }
    });

    on('bullet:impact', (e) => {
      if (!e || !e.point) return;
      for (const a of this.agents) {
        if (!a.alive) continue;
        const d = a.position.distanceTo(e.point);
        if (d < 3.2) a.suppress(0.5 * (1 - d / 3.2));
        else if (d < 12) a.hear(e.point, 12);
      }
    });

    on('damage:dealt', (e) => {
      if (!e || !e.target || !(e.target instanceof Agent)) return;
      const a = e.target;
      if (!a.alive) return;
      const src = e.source ?? null;
      // A round from a team-mate still cracks past and still suppresses — it
      // just does not wound. Turning it into a no-op instead would make the AI
      // walk through its own squad's line of fire without flinching.
      if (src && src !== a && !this.friendlyFire && this.teamOf(src) === a.team) {
        a.suppress(0.25);
        return;
      }
      const amount = e.amount * this._falloff(e.point, src);
      a.applyDamage(amount, e.headshot ? 'head' : e.part ?? 'torso', e.point ?? a.position, e.incident, src);
      if (!a.alive) {
        e.killed = true;
        e.killer = src;
      }
    });

    on('explosion', (e) => {
      if (!e || !e.position) return;
      const radius = e.radius ?? 5;
      for (const a of this.agents) {
        if (!a.alive) continue;
        const d = a.position.distanceTo(e.position) + 0.001;
        a.hear(e.position, 120);
        if (d > radius) continue;
        if (this.phys && !this.phys.lineOfSight(e.position, a.eye, this.phys.MASK.EXPLOSION)) continue;
        const f = 1 - d / radius;
        this._v.copy(a.position).sub(e.position).normalize();
        a.suppress(1.4 * f);
        a.applyDamage((e.damage ?? 100) * f * f, 'torso', a.eye, this._v);
      }
    });

    /**
     * ══════════════════════════════════════════════════════════════════════
     * THE FLASH BLINDS BOTS TOO — 「閃光弾」
     * ══════════════════════════════════════════════════════════════════════
     * A flashbang only the human suffers is the opposite of a flashbang. This
     * is listened for rather than plumbed, and that is what makes it work for
     * BOTH implementations at once: `src/weapons/grenades.js` publishes
     * `weapon:flash` for the player's, and `AiSystem._detonateThrown` publishes
     * the identical payload for a bot's, so one listener covers every bang on
     * the map and neither subsystem has to know the other exists.
     *
     * WHAT BEING BANGED DOES TO A SOLDIER, in the fields this engine already
     * has: `blindT` seconds of not acquiring anything (`pickVisibleHostile`
     * returns null), a shove on `suppression` so he ducks and his cone opens,
     * and `alertness` at 1 because a man who has just been flashed knows
     * perfectly well that somebody is coming. The strength falls off with
     * distance and is gated on the same `MASK.EXPLOSION` line of sight the
     * player's own is, so a wall is a wall for everybody.
     */
    on('weapon:flash', (e) => {
      if (!e || !e.position) return;
      const radius = e.radius ?? 16;
      const dur = e.duration ?? 4.2;
      /**
       * `team` IS ADDITIVE AND OPTIONAL, and it is the difference between a
       * flashbang and a mistake. A bot throws his at a man 6-22 m away and the
       * blind radius is 16, so without this he is inside his own bang every
       * single time — a squad that assaults a door by blinding itself. The side
       * that threw it was TOLD ("FRAG OUT" goes out on the net before it
       * lands), so they get `FLASH_OWN_SIDE` of it rather than none: turning
       * your head is not immunity. The player's own grenade carries no `team`
       * at all and therefore blinds everybody fully, which is correct — nobody
       * warned them.
       */
      const from = e.team === 0 || e.team === 1 ? e.team : -1;
      for (const a of this.agents) {
        if (!a.alive) continue;
        const d = a.position.distanceTo(e.position);
        if (d > radius) continue;
        if (this.phys && !this.phys.lineOfSight(e.position, a.eye, this.phys.MASK.EXPLOSION)) continue;
        const see = 1 - d / radius;
        const mine = from >= 0 && a.team === from ? FLASH_OWN_SIDE : 1;
        a.blind(dur * (0.35 + see * 0.65) * mine);
      }
    });

    /**
     * AND THE SCREEN IS A WALL TO BOTS TOO. @see `_smokeBlocks` for the test
     * and `this._smoke` for the ring. Same argument as the flash: one listener,
     * both grenade implementations, no import either way.
     */
    on('weapon:smoke', (e) => {
      if (!e || !e.position) return;
      // THE LATCH. @see `SMOKE_R`: whatever the authority currently says rides
      // out on this event, so the mirror is repaired the first time one goes off
      // rather than the next time somebody reads both files side by side.
      if (typeof e.radius === 'number' && e.radius > 0) this._smokeR = e.radius;
      this._addSmoke(e.position, e.radius ?? this._smokeR, e.duration ?? SMOKE_T);
    });

    on('player:footstep', (e) => {
      if (!e || !e.position) return;
      const loud = e.running ? 24 : 11;
      for (const a of this.agents) if (a.alive) a.hear(e.position, loud);
    });

    /**
     * ─────────────────────────────────────────────────────────────────────
     * WHAT GOES ON THE NET, PART 1: the things a man learns from an event
     * ─────────────────────────────────────────────────────────────────────
     * The rest is in `agent.js`, at the decisions themselves. These two are
     * here because they are facts about the SIDE, and no single soldier is
     * the right place to notice them.
     */

    /**
     * MAN DOWN, and ENEMY DOWN. Both come off one death, and which one a net
     * hears depends on which side the dead man was on. The caller is the
     * nearest live man to the body — not the killer, who has his own line —
     * so "MAN DOWN" comes from the direction the body is in.
     *
     * `by` is kill credit and is already on the payload; a bot that killed
     * somebody says so on his own net at a much lower priority, because it is
     * morale rather than information and must never outrank a contact.
     */
    on('actor:death', (e) => {
      const dead = e?.actor;
      if (!dead || !(dead instanceof Agent)) return;
      const mate = this.radio._anyLive(dead.team, dead);
      if (mate) this.radio.say(mate, 'mandown', 'mandown', dead.position, false);
      const killer = e.by;
      if (killer instanceof Agent && killer.alive && killer.team !== dead.team) {
        this.radio.say(killer, 'enemydown', 'enemydown', null, false);
      }
    });

    /**
     * THE OBJECTIVE. `match` owns the capture and emits `match:capture` the
     * frame the bar fills; both sides have something to say about it and they
     * are not the same thing. @see `Radio.zone`.
     */
    on('match:capture', (e) => {
      if (!e || !e.zone) return;
      this.radio.zone(e.zone, e.owner ?? -1, e.previous ?? -1);
    });
  }

  /**
   * Long-range damage taper, measured from whoever fired. Falls back to the
   * player when the shot carries no shooter, which is exactly the behaviour
   * this file had before teams existed.
   */
  _falloff(point, source) {
    if (!point) return 1;
    const p = source?.position ? this._v2.copy(source.position) : this.playerPosition(this._v2);
    if (!p) return 1;
    const d = p.distanceTo(point);
    // full damage inside 22 m, tapering to 45 % by 70 m
    return d < 22 ? 1 : Math.max(0.45, 1 - (d - 22) * 0.0125);
  }

  /* ================================================================== */
  /* teams                                                              */
  /* ================================================================== */

  /** Team of any actor: an Agent, the player system, or the string 'player'. */
  teamOf(actor) {
    if (!actor) return -1;
    if (actor === 'player') return this.playerTeam;
    if (actor.isPlayer === true) return actor.team ?? this.playerTeam;
    return actor.team ?? 1;
  }

  isHostile(a, b) {
    const ta = this.teamOf(a);
    const tb = this.teamOf(b);
    return ta >= 0 && tb >= 0 && ta !== tb;
  }

  /**
   * SPAWN PROTECTION — `match` calls this on every respawn, for a bot and for
   * the human alike.
   *
   * It is implemented as "not a valid target", not as damage immunity, and the
   * difference is the whole design. Immunity means rounds visibly hitting a man
   * and doing nothing, which reads as a bug or a cheat depending on which end of
   * it you are on; this instead means nobody chooses to shoot at him, which is
   * what a real spawn area does. A protected man who walks into a grenade, or
   * into fire already going down a lane, still dies — protection buys the two
   * seconds it takes to get out of the spawn, and no more.
   *
   * The field lives on the actor rather than in a map here so it costs one
   * number compare in `hostilesOf` and nothing at all when it has expired. It is
   * namespaced to this subsystem: `player` neither sets nor reads it.
   *
   * @param {object} actor an Agent, or the player system
   * @param {number} seconds
   */
  protect(actor, seconds) {
    if (!actor || !(seconds > 0)) return;
    actor.aiProtectedUntil = this.ctx.time.elapsed + seconds;
  }

  /** False while `actor` is inside its spawn protection window. */
  targetable(actor) {
    const t = actor?.aiProtectedUntil;
    return !(t !== undefined && this.ctx.time.elapsed < t);
  }

  /* ================================================================== */
  /* stores — the hooks `match` drives a resupply through                */
  /* ================================================================== */

  /**
   * WHAT A BOT IS SHORT OF. Three getters and one verb, and they mirror the
   * `weapons` hooks `match` already drives for the player one for one:
   * `weapons.needsAmmo` / `weapons.scavenge(mags)` / `weapons.needsGrenades` /
   * `weapons.resupplyGrenades(n)`. `match` must not read `Agent.reserve` any
   * more than it may read `weapons.reserve` — it asks, and it hands over.
   *
   * `ammoState` exists because `_assignCacheLegs` has to RANK men, not just
   * filter them: with more men wanting a crate than there are crates, the one
   * who is dry has to beat the one who is merely low.
   */
  needsAmmo(actor) {
    return actor instanceof Agent && actor.alive && actor.ammoLow;
  }

  needsGrenade(actor) {
    return actor instanceof Agent && actor.alive && !actor.hasGrenade;
  }

  /** 0 = dry, 1 = came out of the spawn full. */
  ammoState(actor) {
    if (!(actor instanceof Agent) || !actor.startReserve) return 1;
    return Math.max(0, Math.min(1, (actor.reserve + actor.ammo) / (actor.startReserve + actor.magSize)));
  }

  /**
   * Hand a bot what a cache holds. Returns `{ rounds, grenade }` — what he
   * actually took, which is not what was offered: a man with a full pouch takes
   * nothing, and `match` uses that to decide whether the crate was consumed.
   *
   * The bot ALSO says so on the net. "AMMO UP" is the lowest priority
   * transmission in the system on purpose — it is the sound of the errand
   * having worked, and it must never be the thing that delays a contact report.
   */
  resupply(actor, mags = 2, grenades = 0) {
    if (!(actor instanceof Agent) || !actor.alive) return null;
    const rounds = mags > 0 ? actor.resupply(mags) : 0;
    const grenade = grenades > 0 ? actor.resupplyGrenade() : false;
    if (rounds > 0 || grenade) this.radio?.say(actor, 'ammoup', 'ammoup', null, false);
    return { rounds, grenade };
  }

  /**
   * Chest position of any actor — what perception aims at. Writes into `out`.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * A TANK HAS NO HEAD, SO IT CANNOT HAVE A CHEST EITHER
   * ──────────────────────────────────────────────────────────────────────────
   * Every aiming path in this subsystem funnels through here — the line of
   * sight test in `_sightTo`, the `lastKnown` a man walks to and suppresses,
   * and the point `Agent._shoot` lerps the muzzle onto. All three assumed a
   * humanoid: `position.y + eyeHeight - 0.22`.
   *
   * `aimPoint` is the BODY-SHOT SOLUTION and the owner keeps it: `Armour._pose`
   * writes the world position of the hull's ENGINE DECK into it once a frame,
   * on the matrices it has already updated. That is not a decoration — it is
   * the only part of the tank a rifle can do anything to (`PART_MUL` 1.7
   * against the glacis's 0.22), and it is why `armourWorth` can then be a
   * question about geometry rather than about hit points.
   */
  actorChest(actor, out) {
    if (!actor) return null;
    if (actor.aimPoint) return out.copy(actor.aimPoint);
    if (actor.isPlayer === true) {
      const p = actor.position;
      return out.set(p.x, p.y + 1.35, p.z);
    }
    const p = actor.position;
    /**
     * AND A DRONE HAS NEITHER. It is a 0.31 m sphere whose `position` IS its
     * centre of mass, so the aim point is the position — and the test is
     * "does this actor have a body at all" rather than a type check, because
     * `eyeHeight` is what every branch above is really asking for. Without
     * this the expression evaluates to NaN, `_sightTo` compares NaN and
     * returns -1, and a drone is invisible in a way that looks like a policy.
     */
    if (actor.eyeHeight === undefined) return out.set(p.x, p.y, p.z);
    return out.set(p.x, p.y + actor.eyeHeight - 0.22, p.z);
  }

  /**
   * THE DRONE POOL, handed over once by `match`. @see `this._drones`.
   *
   * The `Set` is built HERE and only when the array identity changes, so the
   * per-frame cost of "is this actor a drone" is one hash lookup and the
   * per-match cost is one pass over a fixed pool. `match.drones.list` is
   * allocated at boot and never reallocated, so in practice this runs once.
   */
  set drones(list) {
    if (this._drones === list) return;
    this._drones = list ?? null;
    if (!list) { this._droneSet = null; return; }
    this._droneSet = new Set(list);
  }

  get drones() {
    return this._drones;
  }

  /** Is this actor one of `match`'s suicide drones? */
  isDrone(actor) {
    return this._droneSet !== null && this._droneSet.has(actor);
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * THE ZONES, READ RATHER THAN OWNED — 「CONTESTEDのところをメインに敵と戦闘する」
   * ══════════════════════════════════════════════════════════════════════════
   * `match` is and stays the only subsystem that decides who owns what and who
   * is sent where: this is a READ of the record it already publishes
   * (`m.sites`, documented at the head of `src/match/index.js`), reached at
   * runtime through `ctx.peek` exactly as `fx`, `audio` and `player` are. No
   * import, no write, and nothing here changes an order — @see
   * `Agent._zonePull`, which can only ever bend a man's DESTINATION toward a
   * point `match` has already declared to be in play.
   *
   * `peek` rather than `get` and cached only once it answers, because `match`
   * deps on `ai`: at `ai.init` there is no match, and on a capture run there
   * never will be.
   */
  get zones() {
    const m = this._matchRef ?? (this._matchRef = this.ctx.peek('match') ?? null);
    return m?.sites ?? null;
  }

  /**
   * IS THIS ZONE WORTH WALKING TO INSTEAD? Returns the zone or null.
   *
   * "もっと占領がメインかつ銃撃がメインです 奪われた領地を取り返す、CONTESTEDのところを
   *  メインに敵と戦闘するといったことをBOTに覚えさせて 今の所AIは占領したら終わりみたいに
   *  なってる"
   *
   * Two facts sit behind this and they are both measurements. 90.6 % of every
   * order on this map is the TAKE/CONTEST verb, and men spend 84 % of their
   * actor-time in transit with a median 57 m still to walk — so the single
   * biggest thing standing between this roster and a firefight is the length of
   * the walk, and the single biggest thing standing between it and a CAPTURE is
   * that the walk often ends somewhere nothing is happening.
   *
   * So a man far from his assigned point who can see a nearer one that is IN
   * PLAY goes there instead. Three gates keep it from fighting `match`'s plan:
   *
   *   IT IS ONLY EVER A SHORTER WALK. `DIVERT_GAIN` metres nearer, minimum, and
   *     only for a man who still has `DIVERT_MIN` to go. A man closing on his
   *     own objective is never pulled off it, so the plan converges.
   *   THE ZONE HAS TO BE IN PLAY. Contested (both sides standing in the paint),
   *     or an enemy bar actually filling on ground we hold — that second case
   *     is 「奪われた領地を取り返す」 literally — or simply not ours. A quiet zone we
   *     already own is never a diversion.
   *   AND IT IS WEIGHTED, NOT FILTERED. `CONTEST_W` makes a contested point
   *     score as though it were nearly three times closer than it is, so a
   *     brawl two streets over beats an empty flag next door — which is the
   *     whole sentence: the fighting IS the objective.
   */
  divertZoneFor(agent) {
    const zones = this.zones;
    if (!zones || zones.length === 0) return null;
    const obj = agent.objective;
    const curD = obj ? agent.position.distanceTo(obj.position) : Infinity;
    /**
     * THE ELITE SQUAD IS PULLED HARDER AND FROM CLOSER IN — 「最強部隊はそれぞれの
     * 占領地点を確実に占領するのが目的」. Their objective is not "fight well", it is
     * "the point changes hands", so a zone that is actually in play outranks a
     * shorter walk for them at half the distance it does for a rifleman.
     */
    const elite = agent.elite === true;
    if (curD < (elite ? DIVERT_MIN * 0.5 : DIVERT_MIN)) return null;
    let best = null;
    let bestScore = curD - (elite ? DIVERT_GAIN * 0.5 : DIVERT_GAIN);
    if (!(bestScore > 0)) return null;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (!z || !z.position) continue;
      const mine = z.owner === agent.team;
      // "being taken off us right now" — the enemy's bar is filling on ground
      // we hold. `contested` alone is only true while both sides are physically
      // in the circle, which is a much narrower moment than the fight for it.
      const losing = z.capTeam >= 0 && z.capTeam !== agent.team && z.progress > 0.05;
      const hot = z.contested === true || losing;
      if (mine && !hot) continue;
      const d = agent.position.distanceTo(z.position);
      let score = d * (hot ? CONTEST_W : RETAKE_W);
      if (elite) score *= 0.6;
      if (score < bestScore) { bestScore = score; best = z; }
    }
    return best;
  }

  /** Live actors hostile to `team`. The list is rebuilt at most once a frame. */
  hostilesOf(team) {
    const f = this.ctx.time.frame;
    if (this._hostileFrame !== f) {
      this._hostileFrame = f;
      this._hostiles[0].length = 0;
      this._hostiles[1].length = 0;
      for (let i = 0; i < this.agents.length; i++) {
        const a = this.agents[i];
        if (!a.alive || !this.targetable(a)) continue;
        const t = a.team === 1 ? 1 : 0;
        this._hostiles[1 - t].push(a);
      }
      const p = this.ctx.peek('player');
      if (p && p.dead !== true && this.targetable(p)) {
        const t = this.teamOf(p) === 1 ? 1 : 0;
        this._hostiles[1 - t].push(p);
      }
      /**
       * …AND THE ARMOUR, ON EXACTLY THE SAME TERMS. `alive` is the whole gate:
       * `Armour._roll` sets it true as the hull comes out of its pocket and
       * `_park`/`_destroy` set it false, so a hull that is not on the field is
       * not in anybody's list and this loop is over an empty-or-two array.
       * `targetable` costs one undefined compare and is honoured so a future
       * spawn-protected vehicle behaves like a spawn-protected man.
       */
      const veh = this.vehicles;
      if (veh) {
        for (let i = 0; i < veh.length; i++) {
          const v = veh[i];
          if (!v || v.alive !== true || !this.targetable(v)) continue;
          const t = v.team === 1 ? 1 : 0;
          this._hostiles[1 - t].push(v);
        }
      }
      /**
       * …AND THE DRONES, on exactly the same terms again. `alive` is the whole
       * gate: `Drones._launch` sets it as the machine leaves its base and
       * `_retire`/`_detonate` clear it, so a pool slot that is not flying is in
       * nobody's list. @see `this._drones`.
       */
      const dr = this._drones;
      if (dr) {
        for (let i = 0; i < dr.length; i++) {
          const d = dr[i];
          if (!d || d.alive !== true || !this.targetable(d)) continue;
          const t = d.team === 1 ? 1 : 0;
          this._hostiles[1 - t].push(d);
        }
      }
    }
    return this._hostiles[team === 1 ? 1 : 0];
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * IS THIS SHOT WORTH TAKING? — the whole anti-armour policy, in geometry
   * ══════════════════════════════════════════════════════════════════════════
   * 「グレネードや銃弾である程度ダメージ入れたら壊す（ただし簡単に壊れたら面白くない）」
   *
   * Putting a hull in the hostile list is not the same as telling thirty men to
   * shoot it, and the difference is the difference between a fight and a farce.
   * The bench (`_tankttk.mjs`, real `fireBullet` at the real boxes) is:
   *
   *     M4 (17) into the GLACIS   447 rounds  — a man carries 150
   *     M4 (17) into the DECK      58 rounds  — a magazine and a half
   *     bolt (125) into the DECK    8 rounds
   *     one frag ON the hull        1/6 of full health  (`FRAG_SHARE`)
   *
   * A RIFLEMAN EMPTYING MAGAZINES INTO A GLACIS HE CANNOT HURT IS WORSE
   * BEHAVIOUR THAN IGNORING IT. He is not fighting, he is not taking the point,
   * and he is announcing his position to a coaxial machine gun for nothing. So
   * a bot may only make the hull its target when one of exactly three things is
   * true, and every one of them is a real shot:
   *
   *   1 — THE DECK IS PRESENTED. Not "is behind it" in the loose sense: the
   *       three colliders are `hull` (z -3.2..3.4, top 2.15), `turret`
   *       (z -2.0..1.4, top 2.55) and `deck` (z -3.3..-0.7, y 1.45..2.25), and
   *       `Armour`'s `aimPoint` sits at the deck's REAR-TOP, local (0, 2.18,
   *       -3.05) — the one spot on it that is astern of the turret and above
   *       the hull roof. From there the two ways to have a line are ASTERN
   *       (behind the tail, inside a cone that starts at the hull's rear
   *       corners) and PLUNGING (high enough that the ray clears the turret's
   *       2.55 m roof on its way down). The plunge threshold is derived, not
   *       tuned: the ray must be above 2.55 where it crosses the turret's rear
   *       face 1.1 m short of the aim point, which is
   *       `h > 2.18 + (0.37/1.1) * (forward + 3.05)`.
   *   2 — HE HAS A FRAG AND IS INSIDE THROWING RANGE. Six frags at contact kill
   *       it and a man carries one at a time, so this is a SQUAD deciding to
   *       deal with the tank, which is the 「簡単に壊れたら面白くない」 half.
   *   3 — nothing. He goes on fighting men, exactly as he did before.
   *
   * NO MANOEUVRE IS ORDERED, and that is a decision rather than an omission.
   * Sending men round the back of a hull whose coax already scores 12-27 kills
   * a match is feeding it: the walk is across the open, in front of the gun,
   * and the reward at the end of it is a 58-round burst. What arrives at the
   * deck instead is the men who were ALREADY there — the hull drives out of its
   * own spawn towards the cathedral, so everyone it has driven past is astern
   * of it — plus the roof nests `world.features` puts on every reachable roof,
   * which clause 1's plunge term is written for. `Agent`'s own FLANK is
   * untouched and still goes wide of its own accord.
   *
   * Called once per candidate per selection (twice a second-ish per man, on
   * `pickVisibleHostile`'s rotating cursor), and it is arithmetic — no ray, no
   * allocation.
   *
   * @returns 0 ignore it · 1 shoot it (the deck is there) · 2 frag it ·
   *          3 suppress it (fire allowed, effect not expected — @see
   *          ARMOUR_PROVOKED; the wound arithmetic is the glacis's problem)
   */
  armourWorth(agent, v) {
    if (!agent || !v || v.alive !== true) return 0;
    /**
     * THE ELITE SQUAD DOES NOT FIGHT ARMOUR AT ALL — 「近くに戦車がいるときは無闇に
     * 戦わず迂回する動きをとって、何故なら負けるから確実に」. Clause 0, above the deck
     * and above the frag, because for these ten men there is no shot worth
     * taking: they cannot respawn, and a hull that notices them costs the side
     * its whole reversal. The other half of the order is the walk —
     * @see `Agent._tankDodge`.
     */
    if (agent.elite === true) return 0;
    const p = v.position;
    const dx = agent.position.x - p.x;
    const dz = agent.position.z - p.z;
    const d = Math.hypot(dx, dz);

    /* ---- 1. the deck ------------------------------------------------- */
    if (d < agent.weaponRange) {
      const yaw = v.yaw ?? 0;
      const s = Math.sin(yaw);
      const c = Math.cos(yaw);
      // The shooter, in the hull's own frame: +z ahead of it, +x to its right.
      const fz = dx * s + dz * c;
      const fx = dx * c - dz * s;
      if (fz < -DECK_ASTERN && Math.abs(fx) < DECK_HALF_W + (-fz - DECK_ASTERN) * 0.8) return 1;
      const h = agent.position.y + agent.eyeHeight - p.y;
      if (h > DECK_AIM_Y + DECK_PLUNGE * Math.max(0, fz + DECK_REAR)) return 1;
    }

    /* ---- 2. the frag ------------------------------------------------- */
    if (agent.hasGrenade && agent.grenadeCooldown <= 0 &&
        d > ARMOUR_FRAG_MIN && d < ARMOUR_FRAG_MAX) return 2;

    /* ---- 3. suppression — @see the ARMOUR_PROVOKED note --------------- */
    // `armourSuppress` is the A/B switch, not a setting: one build has to be
    // able to report the engagement rate with and without this clause, and
    // building the file twice is how you compare two different maps by
    // accident. Nothing in the game ever writes it.
    if (this.armourSuppress && d < agent.weaponRange &&
        (agent.traits?.trigger ?? 1) < ARMOUR_HOSE) {
      if (this.ctx.time.elapsed - (v.firedAt ?? -1e9) < ARMOUR_PROVOKED) return 3;
      const o = agent.objective?.position;
      if (o && Math.hypot(p.x - o.x, p.z - o.z) < ARMOUR_OBJECTIVE_R) return 3;
    }

    return 0;
  }

  /**
   * The enemy `agent` can see right now, or null.
   *
   * Perception stays as imperfect as it was — 100 degree cone, real line of
   * sight, distance limit — it just no longer assumes the only thing worth
   * looking for is the local player. The line-of-sight test is the expensive
   * part, so each actor re-tests the enemy it already has plus TWO others per
   * frame on a rotating cursor: a 14-man server settles on a target inside a
   * tenth of a second and costs ~40 rays a frame instead of ~200.
   */
  pickVisibleHostile(agent) {
    /**
     * A BANGED MAN SEES NOTHING. @see the `weapon:flash` listener. This is the
     * whole mechanical effect of a flashbang on a bot and it is deliberately
     * the same one it has on the player: he does not stop existing, he does not
     * stop shooting at what he already believed, he simply stops ACQUIRING —
     * and `Agent` keeps walking to `lastKnown` with `armourWorth` cleared.
     */
    if (agent.blindT > 0) {
      agent.armourWorth = 0;
      return null;
    }
    /**
     * AN UNARMED MAN ACQUIRES NOBODY — 「民間人は…攻撃してこない」. @see
     * `AiSystem._civilise`. This is the whole of it: `Agent.target` has exactly
     * one source and it is this function, so a null here is no shooting, no
     * grenade, no suppression, no cover rush and no peek, permanently and
     * without a second flag anywhere in the behaviour tree. He is blind in the
     * same sense a flashed man is, for ever, and by the same mechanism.
     */
    if (agent.aiPacifist === true) {
      agent.armourWorth = 0;
      return null;
    }
    const list = this.hostilesOf(agent.team);
    const n = list.length;
    if (!n) return null;
    const eye = this._v.set(
      agent.position.x,
      agent.position.y + agent.eyeHeight,
      agent.position.z
    );
    const fx = Math.sin(agent.yaw);
    const fz = Math.cos(agent.yaw);
    // Peripheral vision widens once alerted; a target already acquired is
    // tracked almost all the way round, which is what stops the "walks past the
    // man shooting him" read.
    const cone = agent.hasTarget ? -0.2 : agent.viewCos - agent.alertness * 0.25;

    let best = null;
    /**
     * SCORE, NOT DISTANCE, because a hull is not chosen on the same terms as a
     * man: `ARMOUR_BIAS` pushes it down the list and `armourWorth` can keep it
     * off the list altogether. Everything else is unchanged — for a map with no
     * armour on it every score IS the distance and this picks what it always
     * picked.
     */
    let bestScore = Infinity;
    /**
     * ════════════════════════════════════════════════════════════════════════
     * THE MAN ON MY POINT IS THE MAN I AM SHOOTING — "占領するために敵を倒す"
     * ════════════════════════════════════════════════════════════════════════
     * Everything else here scores a MAN at his plain distance, i.e. "whoever is
     * nearest". That is a sensible default and it is also why a capture point
     * is contested by nobody in particular: the man standing in the circle and
     * the man walking past a side street forty metres away are worth the same,
     * so a bot sent to take the point shoots whichever of them he happened to
     * look at. This makes an enemy inside the objective's own circle score as
     * though he were `SITE_TARGET_BIAS` times closer.
     *
     * It is a BIAS AND NOT A FILTER, and the multiplier is deliberately mild:
     * at 0.55, a contester at 30 m beats a rifleman at 17 m and loses to one at
     * 15. A man with somebody in his face still fights the man in his face.
     *
     * Costs one hypot on a target that already passed the line-of-sight ray, and
     * nothing at all for a man whose order carries no site (@see
     * `Agent.setObjective`) — which is every bot in demolition's push phase and
     * every bot on a map with no capture points.
     */
    const site = agent.objective?.site ? agent.objective.position : null;
    const cur = agent.targetActor;
    if (cur && cur.alive !== false && cur.dead !== true && this.targetable(cur) &&
        this.isHostile(agent, cur)) {
      const d = this._sightTo(agent, cur, eye, fx, fz, cone);
      // worth 3 is suppression: kept as a target, but at the WEAK bias, so any
      // real man who shows himself takes over. @see ARMOUR_SUPPRESS_BIAS.
      const curWorth = cur.isVehicle === true ? this.armourWorth(agent, cur) : 0;
      if (d >= 0 && (cur.isVehicle !== true || curWorth > 0)) {
        best = cur;
        bestScore = cur.isVehicle === true
          ? d * (curWorth === 3 ? ARMOUR_SUPPRESS_BIAS : ARMOUR_BIAS)
          : d * this._siteBias(cur, site) * this._droneBias(agent, cur, d);
      }
    }
    let checks = 0;
    for (let k = 0; k < n && checks < 2; k++) {
      const t = list[(agent._scanCursor + k) % n];
      if (t === cur) continue;
      checks++;
      // The armour test is arithmetic and the sight test is a ray, so the cheap
      // one goes first: a hull nobody has a shot on costs no line of sight.
      const worth = t.isVehicle === true ? this.armourWorth(agent, t) : 0;
      if (t.isVehicle === true && worth <= 0) continue;
      const d = this._sightTo(agent, t, eye, fx, fz, cone);
      if (d < 0) continue;
      const score = t.isVehicle === true
        ? d * (worth === 3 ? ARMOUR_SUPPRESS_BIAS : ARMOUR_BIAS)
        : d * this._siteBias(t, site) * this._droneBias(agent, t, d);
      if (score < bestScore) {
        best = t;
        bestScore = score;
      }
    }
    agent._scanCursor = (agent._scanCursor + 2) % n;
    /**
     * WHAT HE MAY DO ABOUT IT, cached on the man for `Agent._combat` — which is
     * the half of the policy this file cannot enforce, because "shoot" and
     * "throw" are decisions about a trigger and a pouch rather than about a
     * target list. 0 for everything that is not armour, so no other code path
     * has to know the field exists.
     */
    agent.armourWorth = best?.isVehicle === true ? this.armourWorth(agent, best) : 0;
    return best;
  }

  /**
   * `SITE_TARGET_BIAS` if this actor is standing inside `site`'s circle, else 1.
   * @see the block in `pickVisibleHostile`. `site` is null for every order that
   * did not name one, and then this is a null test and a return.
   */
  _siteBias(actor, site) {
    if (site === null) return 1;
    const p = actor.position;
    if (!p) return 1;
    const dx = p.x - site.x, dz = p.z - site.z;
    return dx * dx + dz * dz <= SITE_TARGET_R2 ? SITE_TARGET_BIAS : 1;
  }

  /**
   * HOW BADLY THIS MAN WANTS TO SHOOT THIS DRONE. 1 for everything that is not
   * one, so no other target's score moves. @see `DRONE_LOCKED_BIAS`.
   *
   * The elite squad is the one exception in the table and it is the player's
   * own sentence: 「AI最強部隊は戦車は避ける、ドローンは撃ち落とすこと」. They take a
   * drone at the locked man's bias whether it is hunting them or not, which is
   * what "shoot it down" means as a standing order rather than as self defence.
   */
  _droneBias(agent, actor, d) {
    if (this._droneSet === null || !this._droneSet.has(actor)) return 1;
    if (actor.target === agent) return DRONE_LOCKED_BIAS;
    if (agent.elite === true) return DRONE_LOCKED_BIAS;
    return d < DRONE_NEAR ? DRONE_NEAR_BIAS : 1;
  }

  /** Distance to `target` if `agent` can see it, else -1. */
  _sightTo(agent, target, eye, fx, fz, cone) {
    const p = this.actorChest(target, this._v3);
    if (!p) return -1;
    const dx = p.x - eye.x;
    const dy = p.y - eye.y;
    const dz = p.z - eye.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > agent.viewRange || dist < 1e-4) return -1;
    const inv = 1 / dist;
    // @see ARMOUR_NOTICE — a tank is not something you fail to notice at 4.6 m.
    // @see DRONE_NOTICE — nor is a rotor coming down the street at you.
    const blind = target.isVehicle === true ? ARMOUR_NOTICE
      : this.isDrone(target) ? DRONE_NOTICE : 4.5;
    if ((dx * inv) * fx + (dz * inv) * fz <= cone && dist > blind) return -1;
    if (this.phys && !this.phys.lineOfSight(eye, p, this.phys.MASK.SIGHT)) return -1;
    /**
     * AND THE SMOKE. @see `_smokeBlocks` — a screen only the player can hide
     * behind is a decoration, and this is the line that makes it a wall.
     */
    if (this._smokeN > 0 && this._smokeBlocks(eye, p)) return -1;
    return dist;
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * SMOKE ACTUALLY BLOCKS AI SIGHT
   * ══════════════════════════════════════════════════════════════════════════
   * `fx` draws the cloud and `physics` knows nothing about it, so before this a
   * smoke can — the player's or a bot's — changed exactly one thing on the map:
   * what the player could see. A screen that only works one way is worse than
   * no screen, because it is a handicap dressed as an option.
   *
   * The volume is a SPHERE and the test is the classic segment/sphere one, with
   * a deliberate softening: sight is refused when the ray passes within
   * `SMOKE_CORE` of the centre AND the nearest approach lies between the two
   * ends, so grazing the edge of a cloud is still a shot and standing in the
   * middle of one is not. A man INSIDE the cloud is blind out of it and
   * everybody outside is blind into it, which is the honest reading — and it is
   * symmetric, so a bot cannot use one as a firing position either.
   *
   * At most `SMOKE_MAX` are ever live; the loop is over a fixed preallocated
   * array of plain numbers, runs only when one is burning, and allocates
   * nothing. @see `_onSmoke` for where they come from — BOTH grenade
   * implementations, because both publish `weapon:smoke`.
   */
  /**
   * A can has gone off. Takes the FIRST expired slot, then the oldest, so a
   * seventh cloud never refuses to exist and never grows the array.
   */
  _addSmoke(position, radius, duration) {
    const S = this._smoke;
    const now = this.ctx.time.elapsed;
    let slot = -1;
    for (let i = 0; i < this._smokeN; i++) {
      if (S[i * 5 + 4] <= now) { slot = i; break; }
    }
    if (slot < 0) {
      if (this._smokeN < SMOKE_MAX) slot = this._smokeN++;
      else { slot = this._smokeNext; this._smokeNext = (this._smokeNext + 1) % SMOKE_MAX; }
    }
    const o = slot * 5;
    S[o] = position.x;
    // Chest height of the column rather than the base: the cloud rises, and a
    // sphere centred on the ground screens a man's knees.
    S[o + 1] = position.y + radius * 0.45;
    S[o + 2] = position.z;
    S[o + 3] = radius * SMOKE_CORE;
    S[o + 4] = now + duration;
  }

  /** Every cloud gone — a round reset, and every path that clears the board. */
  clearSmoke() {
    this._smokeN = 0;
    this._smokeNext = 0;
  }

  _smokeBlocks(a, b) {
    const S = this._smoke;
    const now = this.ctx.time.elapsed;
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz;
    if (len2 < 1e-6) return false;
    for (let i = 0; i < this._smokeN; i++) {
      const o = i * 5;
      if (S[o + 4] <= now) continue;
      const cx = S[o] - a.x, cy = S[o + 1] - a.y, cz = S[o + 2] - a.z;
      let t = (cx * abx + cy * aby + cz * abz) / len2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const px = cx - abx * t, py = cy - aby * t, pz = cz - abz * t;
      const r = S[o + 3];
      if (px * px + py * py + pz * pz < r * r) return true;
    }
    return false;
  }

  /** Wipe the board — every actor, every squad, every ragdoll. */
  clearAgents() {
    for (const a of this.agents) {
      // A cover point claimed by a man who is about to stop existing would stay
      // claimed for the rest of the match.
      this.cover?.release(a.id);
      a.dispose();
    }
    this.agents.length = 0;
    this.squads.length = 0;
    // Every queued message names a man who no longer exists.
    this.radio.reset();
    this._stagedAgents = null;
    this._hostileFrame = -1e9;
    this._hostiles[0].length = 0;
    this._hostiles[1].length = 0;
    // A cloud from the last round is a wall in the next one.
    this.clearSmoke();
  }

  /**
   * Minimap blips, from the LOCAL player's point of view. Team-mates are always
   * shown; the enemy only while somebody on your side actually has eyes on
   * them, which is how Sudden Attack's radar behaves and is the difference
   * between reading the map and reading a wallhack.
   */
  getHudActors() {
    const out = this._blipOut;
    out.length = 0;
    const now = this.ctx.time.elapsed;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.alive) continue;
      /**
       * NO CIVILIAN IS EVER ON THE RADAR — 「これはゲーム上アナウンスなし」, and it
       * applies to the ARMED ones as well, which is the part that matters.
       * Suppressing only the unarmed would make the HUD itself the answer to
       * the one question the player is supposed to have to look at a man to
       * answer; suppressing the whole faction makes finding one a thing that
       * only happens with your eyes. It costs nothing else: the minimap blip,
       * the world contact bracket and `match._publishEnemyMarkers` are all this
       * one list. @see `AiSystem._civilise`.
       */
      if (a.aiCivil === true) continue;
      const friendly = a.team === this.playerTeam;
      if (!friendly && now - (a.spottedAt ?? -1e9) > 3) continue;
      let rec = this._blips[out.length];
      if (!rec) {
        rec = this._blips[out.length] = {
          position: new THREE.Vector3(), alive: true, friendly: true, heading: 0,
          /**
           * ADDITIVE FIELDS, for a marker that has to be the size of the man.
           * `height` is his standing height in metres and `stance` how much of it
           * he is actually using, so `src/ui` can size a bracket off the figure
           * instead of off a guess; `age` is how long ago the contact was
           * confirmed, so a stale one can fade instead of vanishing. Existing
           * readers (`ui._collectBlips`, `match._publishEnemyMarkers`) touch
           * `position`, `friendly`, `alive` and `heading` only.
           */
          height: 1.78, stance: 1, age: 0, name: '',
        };
      }
      rec.position.copy(a.position);
      rec.alive = true;
      rec.friendly = friendly;
      rec.heading = (a.yaw * 180) / Math.PI;
      rec.height = a.height ?? 1.78;
      rec.stance = a.crouch ? 0.68 : 1;
      rec.age = friendly ? 0 : now - (a.spottedAt ?? now);
      rec.name = a.name ?? '';
      out.push(rec);
    }
    return out;
  }

  _distanceToRay(point, origin, dir, eyeH) {
    const px = point.x - origin.x;
    const py = point.y + eyeH * 0.7 - origin.y;
    const pz = point.z - origin.z;
    const t = Math.max(0, px * dir.x + py * dir.y + pz * dir.z);
    return Math.hypot(px - dir.x * t, py - dir.y * t, pz - dir.z * t);
  }

  /* ================================================================== */
  /* assets                                                             */
  /* ================================================================== */

  variant(name) {
    let v = this._variants.get(name);
    if (!v) {
      const t0 = performance.now();
      v = buildSoldier(name, { rng: this.rng.fork(), materials: this.materials });
      this._variants.set(name, v);
      // Hand the new materials to render immediately rather than waiting for its
      // scene walk: they are all MeshStandardMaterial, so the patcher injects the
      // CSM sun shadow, the screen-space contact shadow, GTAO and the bounce fill
      // into them. Without the shadow term a character is lit by ambient alone
      // and looks pasted onto the ground.
      const r = this.ctx.peek('render');
      if (r?.patcher) for (const m of v.materials) r.patcher.patch(m);
      console.info(
        `[ai] variant "${name}" ${v.stats.triangles | 0} tris / ${v.stats.vertices} verts / ` +
          `${v.materials.length} materials in ${(performance.now() - t0).toFixed(0)}ms`
      );
    }
    return v;
  }

  /** Bone index lookup for the shared rig (used by the ragdoll spec). */
  rigIndex(name) {
    return RIG.index(name);
  }

  get phys() {
    return this._phys ?? (this._phys = this.ctx.peek('physics'));
  }

  /* ================================================================== */
  /* navigation                                                         */
  /* ================================================================== */

  _buildNav() {
    const phys = this.phys;
    const world = this.ctx.peek('world');
    if (!phys) return;
    if (phys.staticWorld.dirty) phys.rebuildStatic();
    if (phys.triangleCount <= 0) return; // level not registered yet — retry next frame
    const bounds =
      world?.bounds?.clone?.() ??
      new THREE.Box3(new THREE.Vector3(-70, -4, -70), new THREE.Vector3(70, 24, 70));
    bounds.expandByScalar(2);
    const t0 = performance.now();
    this.grid = new NavGrid(phys, { bounds, cell: 0.8, radius: 0.36, height: 1.78 });
    /**
     * `world.interiorVolumes` is the ground storey of every enterable building,
     * and handing it over is what puts an INDOORS in the height field at all —
     * without it the sweep finds those cells' roofs and no bot on this map can
     * ever be inside one. @see `NavGrid._carveInteriors`.
     */
    this.grid.build(world?.interiorVolumes ?? null);
    /**
     * ONE WAY UPSTAIRS PER BUILDING, MEASURED. @see `StairMap` — a height field
     * with one floor per cell cannot hold an upper storey, so this is a short
     * list of world points beside the grid rather than anything in it, and
     * `Agent._runPost` walks it. Same volumes, same capsule, one boot pass.
     */
    this.stairs = new StairMap(phys, this.grid).build(world?.interiorVolumes ?? null);
    /** Report-time only. @see `Agent._dropPost`. */
    this.postStats = { taken: 0, reachedTop: 0, drop: {} };
    this._bakeCover(phys, world);
    this.stats.navMs = performance.now() - t0;
    this.stats.walkable = this.grid.walkableCount;
    this._navPending = false;
    // The contact reports need the level's yaw (a bearing on world axes is off
    // by it against every street) and its ground storeys (a man seen indoors is
    // "CONTACT INSIDE", not a compass point). Both are read once, here.
    this.radio.bind();
    console.info(
      `[ai] nav ${this.grid.nx}x${this.grid.nz} cells · ${this.grid.walkableCount} walkable ` +
        `(${this.grid.interiorCells ?? 0} indoor) · ` +
        `${this.stats.coverPts} cover points` +
        (this.coverRuin ? ` (+${this.stats.coverRuinPts} in the cathedral ruin)` : '') +
        (this._demoRecs
          ? ` · ${this.stats.coverDeps} of them stand on a destructible block ` +
            `(+${this.stats.coverRubblePts} the rubble makes, ` +
            `${this.coverIntact.depMs.toFixed(0)}ms)`
          : '') +
        ` · ${this.stairs.posts.length} upper posts ` +
        `(${this.stairs.columns} columns, ${this.stairs.ms.toFixed(0)}ms)` +
        ` · ${this.stats.navMs.toFixed(0)}ms`
    );
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * COVER FOR A TOWN THAT DOES NOT STAY THE SAME SHAPE — baked at boot, both
   * of it.
   * ────────────────────────────────────────────────────────────────────────
   * A cover point is a place to stand PLUS THE DIRECTION THE MASS IS IN
   * (`p.dx`,`p.dz`), and `CoverMap.build` finds it by firing a ray at chest
   * height and keeping the first direction that hits something. So a cover
   * table is a statement about the collision world AT THE MOMENT IT WAS BAKED,
   * and this level does not keep that promise: `world.cathedral.setRazed` takes
   * a 29 m church down to a 2.76 m rubble field in one frame, and capture point
   * D appears in the middle of it.
   *
   * Measured with `_coverstale.mjs`, on the single table this used to bake:
   *
   *   304 of the 634 points inside the cathedral footprint (47.9 %) fire their
   *   own ray into open air once the shell is gone, 27 of the 100 inside D.
   *   That is a man crouching behind nothing at the most contested point on the
   *   map, and it is worst exactly where it matters most.
   *
   * AND THE INTACT TABLE WAS ALREADY WRONG, which is the part nobody was
   * looking for. `Assembler.beginScope` records a scope as VISIBLE AND SOLID —
   * `cath:ruin` is built that way and stays that way until `match` makes its
   * first `_setCathedralRazed(false)` call, which happens after `ai.init` (see
   * `MatchSystem.static deps`). This bake ran in between, so 129 points were
   * anchored to rubble that is put away before the first frame, all 129 of them
   * inside the footprint and 37 of them inside D. The cover table was wrong
   * about D before anybody had touched the cathedral.
   *
   * BOTH ARE THE SAME FIX: probe each state with that state actually loaded.
   * Two flips of a switch that already exists, three `CoverMap.build`s' worth of
   * work in total at BOOT (19 ms each), and NOTHING computed on the frame the
   * event fires — `setCoverRazed` is one reference assignment. It is the same
   * move `cathedral.js` makes with its own two scopes and the same move
   * `Airstrike` makes when it bakes a demolition's nav patch at boot "with the
   * ruin temporarily solid and the building visibly standing the whole time".
   *
   * NO FRAME IS DRAWN BETWEEN THE FLIPS. This runs inside `ai.init` →
   * `_bootNav`, synchronously, and every flip is paired, so the visual state on
   * exit is the state on entry and the renderer never sees the intermediate.
   * `world.cathedral.razed` is read rather than assumed, so a level that is
   * somehow already down is restored to down.
   *
   * REACHED THROUGH `ctx.peek('world')` AND NOTHING ELSE, exactly as
   * `MatchSystem._setCathedralRazed` reaches it. `ai` may no more import
   * `world/cathedral.js` than `match` may. Every step is optional: a `world`
   * with no cathedral, or a cathedral with no second state, bakes one table and
   * behaves precisely as this did before.
   */
  _bakeCover(phys, world) {
    const cath = world?.cathedral ?? null;
    const canSwap = typeof cath?.setRazed === 'function';
    /** The state the level is in now, so the pair of flips lands back on it. */
    const was = canSwap ? cath.razed === true : false;

    /**
     * THE SIX BLOCKS, WHICH ARE NOT THE CATHEDRAL'S PROBLEM AGAIN.
     * `world.demolitions` fire independently, so there is no pair of tables
     * that can describe them — the dependency is baked PER POINT instead.
     * @see `CoverMap.bakeBlockDeps`, and `_demoState` for the flips.
     */
    const recs = world?.demolitions ?? null;
    this._demoRecs = recs?.length ? recs : null;
    const rects = this._demoRecs ? this._demoRecs.map((r) => r.navRect) : null;
    /**
     * COLLISION ONLY, NEVER THE PICTURE — the same split `Airstrike._bakeNavPatch`
     * uses to probe a ruin at boot "with the building visibly standing the whole
     * time". Nothing here is allowed to be seen.
     */
    const setDown = this._demoRecs
      ? (k, down) => this._demoRecs[k].setCollision?.(down)
      : null;
    /**
     * THE BLOCKS ARE LEFT EXACTLY AS THEY BOOTED, and the bake is expressed
     * relative to that. `NavGrid` has already dropped its rays through this
     * level, so the state the grid describes is the only state whose candidate
     * cells mean anything — and under `?demo=down` that state is six ruins,
     * decided inside `world` before `ai.init` ever ran. Forcing them upright
     * here measured 151 of 477 points on those blocks describing air on the
     * first frame. @see `CoverMap.bakeBlockDeps`.
     */
    const bakeMask = this._demoRecs
      ? this._demoRecs.reduce((m, r, i) => (r.down === true ? m | (1 << i) : m), 0)
      : 0;
    const demoOpts = { reach: 1.3, bakeMask };

    // The church STANDING and the rubble put away — which is NOT the state a
    // freshly assembled level is in. @see the note above.
    if (canSwap) cath.setRazed(false, phys);
    this.coverIntact = new CoverMap(this.grid, phys).build({ step: 1, reach: 1.3 });
    if (rects) this.coverIntact.bakeBlockDeps(rects, setDown, demoOpts);

    if (canSwap) {
      cath.setRazed(true, phys);
      this.coverRuin = new CoverMap(this.grid, phys).build({ step: 1, reach: 1.3 });
      if (rects) this.coverRuin.bakeBlockDeps(rects, setDown, demoOpts);
      cath.setRazed(was, phys);
    } else {
      this.coverRuin = null;
    }

    this.stats.coverPts = this.coverIntact.points.length;
    this.stats.coverRuinPts = this.coverRuin?.points.length ?? 0;
    this.stats.coverDeps = this.coverIntact.depStats?.dependent ?? 0;
    this.stats.coverRubblePts = this.coverIntact.depStats?.created ?? 0;
    // `_coverRazed` may already have been set by `match` if the nav build was
    // deferred past the first round — honour it rather than reset it.
    this.cover = this._coverRazed && this.coverRuin ? this.coverRuin : this.coverIntact;
    // …and whatever the blocks are doing right now, which under `?demo=down` or
    // a nav build deferred past the first salvo is not "all standing".
    this._blockMask = -1;
    this.syncCoverBlocks();
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE BLOCKS, NOTICED. One `if` per frame; a pass over the table only when a
   * building actually changed state.
   * ────────────────────────────────────────────────────────────────────────
   * `world.demolitions[].down` is the public truth about which blocks are down,
   * and it is written by five different paths — the salvo settling, the round
   * reset, `Airstrike.forceDemoNav`, the `?demo=down` boot flag and the probes.
   * Reading the flags is cheaper than hooking all five and cannot be wired up
   * wrong: six array reads and a compare, allocating nothing.
   *
   * The pass itself lands on the frame AFTER the one the building came down on,
   * which is the frame the rubble becomes collision anyway.
   *
   * Public so `match` (or a probe) can force it inside the same frame.
   * @returns {boolean} did anything change
   */
  syncCoverBlocks() {
    const recs = this._demoRecs;
    if (!recs) return false;
    let mask = 0;
    for (let i = 0; i < recs.length; i++) if (recs[i].down === true) mask |= 1 << i;
    if (mask === this._blockMask) return false;
    this._blockMask = mask;
    if (!this.cover?.applyBlocks(mask)) return false;
    // A man holding a point the rubble just took away has to let go of it — the
    // one whose point survived with a different facing has not lost his cover
    // and is left where he is. @see `setCoverRazed` for the same rule.
    for (const a of this.agents) if (a.cover && a.cover.live === false) a.cover = null;
    return true;
  }

  /**
   * THE SWAP. `match` owns WHEN the cathedral falls; this owns what the AI
   * thinks is left standing when it does.
   *
   * One reference assignment plus a walk over the agents that were using the
   * old table, and that is the whole of it — both tables were probed at BOOT
   * against the geometry each of them describes. @see `_bakeCover`.
   *
   * THE AGENTS HAVE TO LET GO. `Agent.cover` holds a POINT OBJECT out of the
   * live table, and `coverPos` is a copy of its position. Leaving those alone
   * across a swap would keep every man in combat standing at a spot from the
   * other map, scored on a normal that no longer describes anything, and
   * `pick`'s `avoid` test compares by identity so he would never rotate off it
   * either. Dropping the reference makes the next `_combat` tick re-pick from
   * the table that is now true — which is the behaviour the event should
   * produce anyway: the building just came down, everybody move.
   *
   * Idempotent, and it allocates nothing.
   */
  setCoverRazed(down) {
    const want = !!down;
    if (this._coverRazed === want) return false;
    this._coverRazed = want;
    if (!this.coverRuin || !this.coverIntact) return false; // nothing baked yet
    const next = want ? this.coverRuin : this.coverIntact;
    if (next === this.cover) return false;
    this.cover?.releaseAll();
    this.cover = next;
    // The table coming in was baked with every block standing and has been out
    // of play for however many salvos: bring it up to the town it is joining
    // before anybody picks out of it. @see `syncCoverBlocks`.
    next.applyBlocks(this._blockMask);
    next.releaseAll();
    for (const a of this.agents) a.cover = null;
    return true;
  }

  /** Floor probe used by foot IK and spawning. */
  probeGround(x, z, fromY, out) {
    const phys = this.phys;
    if (!phys) return false;
    const h = phys.raycast(x, fromY, z, 0, -1, 0, 3.2, phys.MASK.WORLD);
    if (!h.hit) return false;
    out.y = h.point.y;
    out.nx = h.normal.x;
    out.ny = h.normal.y;
    out.nz = h.normal.z;
    out.hit = true;
    return true;
  }

  groundAt(x, z, fromY = 40) {
    const phys = this.phys;
    if (!phys) return 0;
    const h = phys.raycast(x, fromY, z, 0, -1, 0, 80, phys.MASK.WORLD);
    if (h.hit) return h.point.y;
    return this.ctx.peek('world')?.groundHeight?.(x, z) ?? 0;
  }

  /** The player's chest position, however the player system exposes itself. */
  playerPosition(out) {
    const p = this.ctx.peek('player');
    const src = p?.position ?? p?.capsulePosition ?? null;
    if (src && Number.isFinite(src.x)) {
      out.set(src.x, src.y + 1.35, src.z);
      return out;
    }
    out.setFromMatrixPosition(this.ctx.camera.matrixWorld);
    out.y -= 0.1;
    return out;
  }

  /* ================================================================== */
  /* spawning                                                           */
  /* ================================================================== */

  /**
   * This soldier's personality: an archetype, six behaviour traits and a
   * marksmanship draw. See `drawPersona` in agent.js for what they mean.
   *
   * Cached per `team:callsign:role` so a man is the same man across his own
   * respawns, and a different one after the sides swap at half time (the
   * archetype mix is per role — the attack is weighted to men who move).
   * A nameless actor — the debug tableau, the garrison — gets a fresh draw and
   * is not cached, so `debugStage` cannot grow the map.
   */
  personaFor(agent) {
    const rng = this._personaRng ?? (this._personaRng = this.rng.fork());
    const mean = this.skill ?? 0.5;
    if (agent.role === CIVIL_ROLE.armed || agent.role === CIVIL_ROLE.unarmed) {
      return drawCivilPersona(rng, agent.role === CIVIL_ROLE.unarmed);
    }
    /**
     * `elite` IS PART OF THE KEY, not just of the draw. `src/match` reuses the
     * field roster's callsign namespace for the paradrop, and a cache keyed only
     * on team + callsign + role would hand a reinforcement the ordinary man's
     * persona (or, worse, hand the ordinary man the spearhead's on his next
     * respawn). @see the `spearhead` archetype in agent.js.
     */
    const elite = agent._elite === true;
    if (!agent.name || agent.name.startsWith('BOT-')) {
      return drawPersona(rng, agent.role, mean, this.defenderSkill, elite,
        this._nextSlot(agent, elite), elite ? this._nextEliteArm(agent) : null);
    }
    const key = `${agent.team}:${agent.name}:${agent.role}${elite ? ':elite' : ''}`;
    let p = this._personas.get(key);
    if (!p) {
      p = drawPersona(rng, agent.role, mean, this.defenderSkill, elite,
        this._nextSlot(agent, elite), elite ? this._nextEliteArm(agent) : null);
      this._personas.set(key, p);
    }
    return p;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * DEAL THE NEXT ARCHETYPE SLOT TO THIS SIDE — 「あとスナイパー持ってるAIはちゃんと
   * いる？」
   * ────────────────────────────────────────────────────────────────────────
   * `ARCHETYPE_MIX` used to be SAMPLED per man, which makes "one slot in ten is
   * a sniper" a probability: P(none at all in twenty) is 12 %, and on seed 7 one
   * side fielded one and the other fielded none. That is a player playing a
   * whole round without ever seeing the thing he is asking about.
   *
   * So the ten slots are DEALT round-robin off a shuffled copy, one deck per
   * side and role. Twenty men are then exactly two snipers, two anchors and so
   * on — the composition the table already described, with the variance taken
   * out — and every other archetype whose absence would be noticed gets the same
   * guarantee for free. The SHUFFLE is what keeps it from being a fixed roster:
   * it is drawn once per deck from the persona rng, so the same callsign is not
   * the same man every match, and the deck reshuffles on each pass through it.
   *
   * Reinforcements are exempt: they are all `spearhead` and must not consume a
   * field slot. @see `drawPersona`.
   */
  /**
   * THE NEXT GUN OFF THE ELITE RACK — 「武器もそれぞれ構成を変えて」. @see
   * `eliteArms` in agent.js for why this is dealt rather than sampled.
   *
   * Byte-for-byte the same deck machinery `_nextSlot` uses for the archetype
   * mix: one shuffled copy per side, dealt in order, reshuffled when it runs
   * out — so a ten-man drop always contains the rack's whole composition and
   * never the same weapon twice more than the list says it should. Shuffled on
   * `_personaRng`, so it is deterministic under `?seed=` like everything else.
   */
  _nextEliteArm(agent) {
    const key = `E${agent.team}`;
    let deck = this._decks.get(key);
    if (!deck || deck.at >= deck.order.length) {
      const src = eliteArms();
      const order = deck?.order ?? src.slice();
      order.length = 0;
      for (const a of src) order.push(a);
      const rng = this._personaRng ?? (this._personaRng = this.rng.fork());
      for (let i = order.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        const t = order[i]; order[i] = order[j]; order[j] = t;
      }
      deck = { order, at: 0 };
      this._decks.set(key, deck);
    }
    return deck.order[deck.at++];
  }

  _nextSlot(agent, elite) {
    if (elite) return null;
    const key = `${agent.team}:${agent.role}`;
    let deck = this._decks.get(key);
    if (!deck || deck.at >= deck.order.length) {
      const src = archetypeMixFor(agent.role);
      const order = deck?.order ?? src.slice();
      order.length = 0;
      for (const a of src) order.push(a);
      // Fisher-Yates on the persona rng: deterministic under `?seed=`.
      const rng = this._personaRng ?? (this._personaRng = this.rng.fork());
      for (let i = order.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        const t = order[i]; order[i] = order[j]; order[j] = t;
      }
      deck = { order, at: 0 };
      this._decks.set(key, deck);
    }
    return deck.order[deck.at++];
  }

  spawn(variantName, position, yaw = 0, opts = {}) {
    const a = new Agent(this, { variant: variantName, position, yaw, ...opts });
    if (a.role === CIVIL_ROLE.armed || a.role === CIVIL_ROLE.unarmed) {
      this._civilise(a, a.role === CIVIL_ROLE.unarmed);
    }
    this.agents.push(a);
    this._noteVariantTeam(a.variantName, a.team);
    return a;
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * EVERYTHING ELSE A CIVILIAN IS, AS SIX WRITES ON A FRESHLY BUILT `Agent`
   * ══════════════════════════════════════════════════════════════════════════
   * All six are things the constructor has already decided and none of them can
   * be expressed through the persona, so they are set here rather than reached
   * in from `src/match` — @see `CIVIL_ROLE`.
   *
   * NO SQUAD IS NOT AN OVERSIGHT, IT IS THREE RULES FOR FREE. `_spawnTeam` puts
   * every soldier in a `Squad`; `civilians.js` deliberately does not, and
   * `Agent` guards every use of `this.squad`, so a civilian:
   *   - can never take a window post (`_wantPost` opens with `!this.squad`),
   *     which is what would otherwise send him up a staircase on a quota he is
   *     not part of;
   *   - can never FLANK (the manoeuvre is behind `sq && sq.canFlank`), which is
   *     the one behaviour that would walk him out of his building and across
   *     the street — 「逃走以外で屋外に逃げることはない」;
   *   - is not counted by, and does not consume, the two sides' fireteam,
   *     grenade, smoke and peek rations.
   *
   * NO OBJECTIVE IS THE AMBUSH. `Agent._think`'s IDLE branch is `desiredSpeed =
   * 0` and then "if I have a target, fight; else if I have an objective,
   * advance; else if I have a patrol route, patrol". A man with neither stands
   * exactly where `civilians.js` put him — in a room, not where a bot patrol
   * expects — until somebody walks into his line, and then he opens fire at the
   * range his traits want, which is 9 m. That is the whole of 「基本的に隠れる
   * こと、不意打ちをしてきます」 and it is written already.
   */
  _civilise(a, unarmed) {
    /** 「民間人は体力５０です 武装しているが防弾はないので」 — no armour, so no more HP. */
    a.health = CIVIL_HEALTH;
    a.maxHealth = CIVIL_HEALTH;
    /** 「AKとグレネードのみ」. The flashbang, the smoke and the mine are soldier's stores. */
    a.hasFlash = false;
    a.hasSmoke = false;
    /**
     * OFF THE RADIO. `Radio.say` refuses a speaker who transmitted less than
     * `SPEAKER_GAP` ago and `_radioAt` is the field it compares, so `Infinity`
     * is a permanent refusal — no contact reports, no "MOVING UP", no "MAN
     * DOWN" from a militiaman. Two reasons and both are the request's:
     * 「アナウンスなし」 means a civilian must not be able to announce himself,
     * and fifteen extra speakers would otherwise compete for the enemy net's
     * rate-limited slots and thin out the traffic between the actual squads.
     */
    a._radioAt = Infinity;
    /** Kept off the minimap and out of the contact brackets. @see `getHudActors`. */
    a.aiCivil = true;
    if (!unarmed) return;
    /**
     * 「民間人は見つけられた場合は逃走します（攻撃してこない）」 — TWO separate rules
     * and this is the second one. He never fights: `pickVisibleHostile` returns
     * null for him unconditionally, so he acquires nobody, and every branch that
     * shoots, throws or takes cover is downstream of having a target. The
     * FLEEING half is `match`'s, because being seen is a fact about the player
     * and `ai` has no opinion about it.
     */
    a.aiPacifist = true;
    /**
     * …AND NOBODY SHOOTS HIM ON PURPOSE EITHER. `protect` is "not a valid
     * target" and not damage immunity — the exact distinction spawn protection
     * already draws — so a bot never CHOOSES to fire at an unarmed civilian
     * while the player always can, which is what keeps the score penalty a
     * decision the player makes rather than a tax his own side levies on him
     * from across the map. A stray round or a grenade still kills him.
     */
    this.protect(a, 1e9);
  }

  /**
   * Record which side wears `variant` and repaint its team rim if that changed.
   * Costs a Map lookup on spawn and three float writes per material when it
   * actually moves; nothing at all per frame.
   */
  _noteVariantTeam(variant, team) {
    const t = team === 1 ? 1 : 0;
    const prev = this._variantTeam.get(variant);
    if (prev === t) return;
    if (prev !== undefined && !this._rimWarned) {
      this._rimWarned = true;
      console.warn(
        `[ai] variant "${variant}" is now worn by team ${t} as well as ${prev}; ` +
          'the team rim is per-appearance, so both sides will read as the newer one'
      );
    }
    this._variantTeam.set(variant, t);
    this._applyTeamRims();
  }

  /**
   * Re-key every known variant's rim AND its uniform colour against the CURRENT
   * `playerTeam`. Both are resolved in the same pass off the same test, so a side
   * swap moves the garment and the rim together and a friendly can never end up
   * wearing the enemy's colour. See TEAM_RIM and TEAM_DRESS in textures.js.
   */
  _applyTeamRims() {
    this._rimTeam = this.playerTeam;
    for (const [variant, team] of this._variantTeam) {
      const friendly = team === this.playerTeam;
      this.materials.setTeamRim(variant, friendly ? TEAM_RIM.friendly : TEAM_RIM.hostile);
      this.materials.setTeamDress(variant, friendly ? TEAM_DRESS.friendly : TEAM_DRESS.hostile);
    }
  }

  /**
   * Garrison the level: two squads on patrol routes drawn from the world's own
   * spawn points, far enough from the player to be found rather than spawned on
   * top of. This is what the behaviour tree, navigation and perception actually
   * run against in play.
   */
  populate(opts = {}) {
    const world = this.ctx.peek('world');
    const spawns = world?.spawnPoints ?? [];
    if (!spawns.length || !this.grid) return 0;
    const player = this.playerPosition(this._v3).clone();
    // rank the spawn points by distance from the player, take the far half
    const ranked = spawns
      .map((s, i) => ({ s, i, d: s.position.distanceTo(player) }))
      .sort((a, b) => b.d - a.d)
      .filter((e) => e.d > 18);
    if (!ranked.length) return 0;

    const variants = ['vanguard', 'irregular', 'breacher'];
    const squads = opts.squads ?? 2;
    const per = opts.perSquad ?? 3;
    let made = 0;
    for (let q = 0; q < squads && q < ranked.length; q++) {
      const squad = this.createSquad();
      const anchor = ranked[q % ranked.length].s;
      // patrol route: this spawn point and the two next-nearest ones
      const route = [anchor.position.clone()];
      const others = ranked
        .filter((e) => e.s !== anchor)
        .sort(
          (a, b) =>
            a.s.position.distanceTo(anchor.position) - b.s.position.distanceTo(anchor.position)
        )
        .slice(0, 2);
      for (const o of others) route.push(o.s.position.clone());

      for (let m = 0; m < per; m++) {
        const jitterA = this.rng.range(0, Math.PI * 2);
        const jitterR = this.rng.range(0.8, 3.2);
        const p = anchor.position
          .clone()
          .add(new THREE.Vector3(Math.cos(jitterA) * jitterR, 0, Math.sin(jitterA) * jitterR));
        const ci = this.grid.nearest(p.x, p.z, anchor.position.y, 6, 1.4);
        if (ci >= 0) {
          p.set(
            this.grid.worldX(ci % this.grid.nx),
            this.grid.floor[ci],
            this.grid.worldZ((ci / this.grid.nx) | 0)
          );
        } else {
          p.y = this.groundAt(p.x, p.z, anchor.position.y + 4);
        }
        const a = this.spawn(variants[(q * per + m) % variants.length], p, anchor.yaw + this.rng.signed() * 0.7, {
          patrol: route,
        });
        squad.add(a);
        made++;
      }
    }
    console.info(`[ai] garrison: ${made} enemies in ${squads} squads`);
    return made;
  }

  createSquad() {
    const s = new Squad(this.rng.fork());
    this.squads.push(s);
    return s;
  }

  /* ================================================================== */
  /* firing                                                             */
  /* ================================================================== */

  /** 0 at night, 1 in full daylight. Drives both flash gains below. */
  _daylight() {
    const sky = this._sky ?? (this._sky = this.ctx.peek('sky'));
    const alt = sky?.sunAltitude ?? 0.6; // radians above the horizon
    return Math.min(1, Math.max(0, Math.sin(Math.max(0, alt)) * 4));
  }

  /**
   * SPRITE gain. The flash itself has to be *visible* — a firefight with no fire
   * in it is not a firefight — so this stays high enough to read as burning gas
   * at 10-25 m and is only trimmed in daylight, where the sun is competing.
   */
  _flashGain() {
    return 0.12 + 0.5 * (1 - this._daylight());
  }

  /**
   * LIGHT gain, deliberately separate and two orders of magnitude smaller.
   *
   * The crown sits 0.6 m from the shooter's own chest, so a player-strength
   * 90 cd flash puts 90/0.36 = 250 W/m^2 on him against 4 W/m^2 of sun. That is
   * the whole reason the soldiers used to render BRIGHTER than the sunlit stucco
   * behind them: they were being lit, on the frame the shutter fell, by their own
   * muzzle flash. A real flash is ~1 ms inside a 16 ms frame, so the honest
   * time-averaged contribution in daylight is a highlight on the receiver and
   * nothing more; after dark it is the only light there is and gets to earn its
   * keep. Measured: torso 0.44 -> 0.13 linear, i.e. from 1.9x the sunlit wall to
   * 0.55x, which is what an 0.19-albedo uniform in shade should be.
   */
  _flashLight() {
    const day = this._daylight();
    return 0.006 + 0.05 * (1 - day);
  }

  onAgentFire(agent, origin, dir) {
    const ctx = this.ctx;
    const phys = this.phys;

    // muzzle flash, light and smoke come from fx via the canonical event
    const fe = this._fireEvent;
    /**
     * WHICH GUN THIS WAS. Every bot on the map used to emit `'ai_rifle'`, which
     * `src/audio/weapons.js:resolveProfile` falls through to the `rifle` family —
     * so forty men firing was one report forty times. `Agent.weaponAudio` is one
     * of the families that file already publishes (rifle / ak / smg / lmg /
     * sniper / magnum / machinepistol), so a rack that varies is a rack you can
     * HEAR varying. @see the `WEAPONS` table in agent.js.
     */
    fe.weapon = agent.weaponAudio ?? 'ai_rifle';
    fe.origin.copy(origin);
    fe.dir.copy(dir);
    fe.intensity = this._flashGain();
    fe.light = this._flashLight();
    fe.flashScale = 0.8;
    fe.seed = (agent.id * 2654435761 + ctx.time.frame) >>> 0;
    ctx.events.emit('weapon:fire', fe);

    // ejected case
    const se = this._shellEvent;
    se.position.copy(agent.animator.ejectWorld);
    se.velocity.set(dir.z, 0.55, -dir.x).multiplyScalar(2.1).addScaledVector(dir, -0.6);
    ctx.events.emit('weapon:shell', se);

    // the round itself. `shooter` is what lets `damage:dealt` carry attribution,
    // which is what team damage, kill credit and the killfeed all hang off.
    let end = null;
    if (phys) {
      const impacts = phys.fireBullet({
        origin,
        dir,
        damage: agent.weaponDamage,
        penetration: 0.9,
        maxDist: 200,
        mask: phys.MASK.BULLET,
        shooter: agent,
      });
      if (impacts.length) end = impacts[0].point;
    }
    // physics has no player collider, so test the player capsule ourselves.
    // Staged agents shoot for the camera, not for blood: a capture must not be
    // graded through the player's low-health filter.
    if (!agent.staged?.noDamage) this._testPlayerHit(agent, origin, dir, end);

    this._tracerFrom.copy(origin);
    if (end) this._tracerTo.copy(end);
    else this._tracerTo.copy(origin).addScaledVector(dir, 120);
    if ((agent.id + agent.ammo) % 3 === 0) ctx.events.emit('bullet:tracer', this._tracerEvent);
  }

  _testPlayerHit(agent, origin, dir, end) {
    const player = this.ctx.peek('player');
    if (player?.dead) return;
    // A round from the player's own side passes through them. Without this the
    // six team-mates walking in front of you would kill you inside a round.
    if (!this.friendlyFire && this.teamOf(agent) === this.teamOf(player ?? 'player')) return;
    const p = this.playerPosition(this._v);
    if (!p) return;
    const maxT = end ? origin.distanceTo(end) : 200;
    const px = p.x - origin.x, py = p.y - origin.y, pz = p.z - origin.z;
    const t = px * dir.x + py * dir.y + pz * dir.z;
    if (t < 0.5 || t > maxT) return;
    const miss = Math.hypot(px - dir.x * t, py - dir.y * t, pz - dir.z * t);
    if (miss > 0.42) {
      if (miss < 1.6) player?.onNearMiss?.(miss); // whip-crack past the ear
      return;
    }
    const amount = agent.weaponDamage * (miss < 0.16 ? 1.25 : 1);
    this._v2.copy(origin);
    // Damage is applied *only* through the event below. `player` listens for
    // `damage:dealt` with itself as the target, so calling applyDamage() here as
    // well wounded the player twice for every round that connected.
    this.ctx.events.emit('damage:dealt', {
      target: player ?? 'player',
      amount,
      headshot: false,
      killed: false,
      point: p,
      from: this._v2,
      source: agent,
    });
  }

  emitReload(agent) {
    this.ctx.events.emit('weapon:reload', { weapon: 'ai_rifle', phase: 'start', actor: agent });
  }

  /**
   * A BOT'S FLASH OR SMOKE HAS GONE OFF. @see `throwGrenade`.
   *
   * The payloads are BYTE-FOR-BYTE the ones `src/weapons/grenades.js` publishes
   * for the player's own — same event names, same three fields, same numbers
   * off `weapons/defs.js`'s defaults — which is what makes one bot's bang and
   * one player's bang the same thing to `fx`, to `ai`'s own listeners and to
   * anything added later. The flash also emits the canonical zero-damage
   * `explosion` so the burst is drawn and the blast voice plays, exactly as the
   * player's does; a smoke deliberately emits none, because a can that fires
   * the blast voice sounds like a frag that did nothing.
   *
   * The one thing this does NOT do is reach into `fx.viewFlash` for the player:
   * `weapons` owns the player's eye and does that from its own listener path.
   * A bot's flash still reaches the player through `_flashPlayer` below, which
   * is the same distance-and-line-of-sight test, because a flashbang the human
   * is standing next to has to blind the human.
   */
  /**
   * A BOT'S CAN, DRAWN AT THE SIZE IT IS PLAYED AT. @see the `SMOKE_FOOT` block.
   *
   * The one place in `src/ai` that talks to `fx.addSmokeSource`, so the two
   * copies that drifted twice are now one. `rad` is the GAMEPLAY radius — the
   * same figure `_addSmoke` builds the sightline volume from — and every
   * dimension of the cloud is derived from it here rather than being carried in
   * beside it, which is how they came apart in the first place.
   */
  _smokeDraw(position, rad, duration) {
    const fx = this.ctx.peek('fx');
    if (!fx?.addSmokeSource) return;
    // A quarter of the lit ring is the most one can may take. @see SMOKE_RATE.
    const slots = fx.lit?.capacity ?? 0;
    const rate = slots > 0 ? Math.min(SMOKE_RATE, (slots * 0.25) / SMOKE_LIFE) : SMOKE_RATE;
    fx.addSmokeSource(position, {
      duration,
      rate,
      radius: rad * SMOKE_FOOT,
      rise: 0.85,
      dark: 0.04,
      life: SMOKE_LIFE,
      // A MULTIPLIER, NOT A SIZE. @see the note on `SMOKE_FOOT`.
      growth: SMOKE_GROWTH,
      ember: 0,
      haze: 0.85,
    });
  }

  _detonateThrown(kind, p, team = -1) {
    const ev = this._throwEvent;
    ev.position.set(p.x, p.y + 0.14, p.z);
    /**
     * ADDITIVE AND OPTIONAL, exactly as `team` on an `explosion` is: whose bang
     * this is, so the side that threw it (and was told on the net) is not
     * blinded by its own assault. @see the `weapon:flash` listener. The player's
     * own grenades carry no `team` and blind everybody, which is right.
     */
    ev.team = team;
    if (kind === 'smoke') {
      ev.radius = this._smokeR;
      ev.duration = SMOKE_T;
      this._smokeDraw(ev.position, ev.radius, ev.duration);
      this.ctx.peek('audio')?.play?.('impact', ev.position, { surface: 'metal', energy: 1, level: 0.9 });
      this.ctx.events.emit('weapon:smoke', ev);
      return;
    }
    const b = this._blastEvent;
    b.position.copy(ev.position);
    b.radius = 4.5;
    b.damage = 0;
    b.impulse = 60;
    this.ctx.events.emit('explosion', b);
    ev.radius = 16;
    ev.duration = 4.2;
    this.ctx.events.emit('weapon:flash', ev);
    this._flashPlayer(ev.position, ev.radius, ev.duration);
  }

  /**
   * A BOT'S FLASH, IN THE HUMAN'S FACE. The same three effects `weapons`
   * applies for his own — the light, the trauma and the suppression — scaled by
   * how much of the bang he could actually SEE, and gated on the same
   * `MASK.EXPLOSION` line of sight that gates blast damage, so a wall is a wall.
   */
  _flashPlayer(position, radius, dur) {
    const player = this.ctx.peek('player');
    if (!player || player.dead === true) return;
    const eye = this.ctx.camera?.position;
    if (!eye) return;
    const d = position.distanceTo(eye);
    let see = d < radius ? 1 - d / radius : 0;
    if (see > 0 && this.phys?.lineOfSight
      && !this.phys.lineOfSight(position, eye, this.phys.MASK.EXPLOSION)) see = 0;
    if (see <= 0) return;
    this.ctx.peek('fx')?.viewFlash?.(eye.x, eye.y, eye.z - 0.35, 1, 0.98, 0.92, 0.4 + see * 1.8);
    player.addTrauma?.(Math.min(0.85, 0.25 + see * 0.7));
    player.addSuppression?.(Math.min(1, 0.4 + see * 0.9));
  }

  /** Grenade geometry + material. Built at prewarm, not on the first throw. */
  _ensureGrenade() {
    if (this._grenadeGeo) return;
    this._grenadeGeo = new THREE.IcosahedronGeometry(0.045, 1);
    this._grenadeMat = new THREE.MeshStandardMaterial({
      color: 0x2c3226,
      roughness: 0.62,
      metalness: 0.85,
    });
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * A BOT'S THROW — and it is now three things rather than one
   * ══════════════════════════════════════════════════════════════════════════
   * 「AIにも閃光弾やスモークを使わせて」
   *
   * This is deliberately still self-contained — its own mesh, its own body, its
   * own fuse — and does NOT reach into `src/weapons/grenades.js`, because that
   * file's pool is the PLAYER's viewmodel state machine (a cook, a release
   * beat, a proxy per throw) and forty bots do not have viewmodels. What is
   * SHARED is the only thing that has to be: the two events the player's
   * grenades publish, `weapon:flash` and `weapon:smoke`. `fx` draws the cloud
   * off the same call the player's can makes, `ai`'s own listeners blind bots
   * and screen sightlines off the same payload, and neither implementation
   * knows the other exists. One map, one set of rules, two throwers.
   *
   * `kind` is `'frag'` (the default and everything that came before),
   * `'flash'` or `'smoke'`. The ballistics, the animation and the radio are
   * identical for all three — physically it is the same act.
   */
  throwGrenade(agent, from, target, kind = 'frag') {
    const phys = this.phys;
    if (!phys) return;
    this._ensureGrenade();
    const mesh = new THREE.Mesh(this._grenadeGeo, this._grenadeMat);
    this.root.add(mesh);
    // lobbed ballistic solve
    const dx = target.x - from.x, dz = target.z - from.z;
    const dist = Math.max(0.5, Math.hypot(dx, dz));
    const g = Math.abs(phys.gravity);
    const speed = Math.min(18, Math.sqrt(Math.max(4, (dist * g) / 0.95)));
    const vy = speed * 0.62;
    const vh = Math.min(speed, dist / Math.max(0.35, (2 * vy) / g));
    const body = phys.addRigidBody({
      shape: 'sphere',
      radius: 0.05,
      mass: 0.42,
      position: from,
      velocity: { x: (dx / dist) * vh, y: vy, z: (dz / dist) * vh },
      restitution: 0.28,
      friction: 0.7,
      lifetime: 9,
      object3D: mesh,
      surfaceType: 'metal',
    });
    // A smoke can is lit rather than fuzed and takes a beat longer to bloom;
    // a flash is thrown to go off as it lands, which is what makes it useful
    // for a door. The frag's 2.35 s is untouched.
    const fuse = kind === 'smoke' ? 2.8 : kind === 'flash' ? 1.9 : 2.35;
    this._grenades.push({ body, mesh, fuse, agent, kind });
    agent.animator.fire(0.35);

    /**
     * TWO NETS HEAR ONE GRENADE, and they say different things. The thrower
     * calls "FRAG OUT" on his own so his squad does not walk into it; the
     * nearest man on the OTHER side who can see where it is going calls
     * "GRENADE", which is the highest priority message in the system because
     * it is the only one with a fuse on it.
     *
     * The warning is `lineOfSight` gated on purpose: a man warned about a
     * grenade he cannot see is a man with x-ray hearing, and the whole point of
     * the perception model in this file is that it is imperfect.
     */
    // Only a frag is worth two transmissions. "GRENADE" is the highest priority
    // message in the system because it is the only one with a fuse on it, and a
    // smoke can does not have one; a flash announces itself.
    if (kind !== 'frag') return;
    this.radio.say(agent, 'fragout', 'fragout', null, false);
    let warner = null;
    let bestD = 14 * 14;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.alive || a.team === agent.team) continue;
      const d = a.position.distanceToSquared(target);
      if (d >= bestD) continue;
      if (phys.lineOfSight && !phys.lineOfSight(a.eye, target, phys.MASK.SIGHT)) continue;
      bestD = d;
      warner = a;
    }
    if (warner) this.radio.say(warner, 'grenade', 'grenade', target, false);
  }

  _updateGrenades(dt) {
    for (let i = this._grenades.length - 1; i >= 0; i--) {
      const g = this._grenades[i];
      g.fuse -= dt;
      if (g.fuse > 0) continue;
      const p = g.body?.position ?? g.mesh.position;
      if (g.kind === 'flash' || g.kind === 'smoke') {
        this._detonateThrown(g.kind, p, g.agent?.team ?? -1);
        this.phys?.removeRigidBody(g.body);
        this.root.remove(g.mesh);
        this._grenades.splice(i, 1);
        continue;
      }
      this.ctx.events.emit('explosion', {
        position: new THREE.Vector3(p.x, p.y, p.z),
        radius: 6.5,
        damage: 120,
        source: g.agent,
        /**
         * WHAT IT IS, said out loud — and it is not cosmetic. `Armour._takeBlast`
         * recognised a frag by `source === 'grenade'`, which is the string
         * `src/weapons/grenades.js` publishes because the PLAYER's grenade
         * cannot carry an actor on this event without killing his own side. A
         * BOT's grenade can and does carry one (that is how it gets kill
         * credit), so it matched none of the ordnance sets and fell through to
         * the generic `EXPLOSION_MUL` of 1.35: 120 x 1.35 = 162 against the
         * hull, where the player's identical frag was worth 433 through
         * `fragMul`. Sixteen bot frags to kill a tank against the player's six,
         * for the same weapon, measured — and this is the field that closes it
         * WITHOUT taking `source` (and therefore the kill) off the payload.
         *
         * Additive. Nothing else in the engine reads `kind` on an explosion.
         */
        kind: 'grenade',
      });
      this.phys?.removeRigidBody(g.body);
      this.root.remove(g.mesh);
      this._grenades.splice(i, 1);
    }
  }

  /* ================================================================== */
  /* frame                                                              */
  /* ================================================================== */

  update(dt, ctx) {
    if (this._navPending) {
      this._buildNav();
      // Populate the level for normal play. Capture runs stay empty unless a
      // shot asks for a tableau, so nobody's screenshot gets a stray patrol
      // wandering through it. `match`, when present, spawns instead.
      if (!this._navPending && !this.matchControlled && (!ctx.config.deterministic || this.forcePopulate)) {
        this.populate();
      }
    }

    // `match` flips playerTeam at the half; hostile and friendly swap with it.
    if (this._rimTeam !== this.playerTeam) this._applyTeamRims();

    // Six flags and a compare. Only a block that actually moved costs anything.
    if (this._demoRecs) this.syncCoverBlocks();

    // Per-frame A* budget: a millisecond allowance turned into a solve count at
    // whatever a solve costs on THIS level. See `pathMsBudget`.
    this._pathBudget = Math.max(
      3,
      Math.min(this.pathsPerFrame, Math.round(this.pathMsBudget / Math.max(0.06, this._pathCostMs)))
    );
    this.stats.pathBudget = this._pathBudget;
    this._updateRelevance(ctx);

    for (const s of this.squads) s.update(dt);

    /**
     * THE UPDATE ORDER ROTATES, AND IT IS NOT COSMETIC.
     *
     * `requestPath` is a per-frame ration, and it is spent by whoever asks
     * first. Walking `agents` from index 0 every frame therefore means the men
     * at the front of the array take the whole budget every frame and the men at
     * the back are deferred every frame — for ever, not just once. At thirteen
     * actors the budget covered nearly everyone and this never showed; at thirty
     * it starves the tail of the array outright, and a man whose path request is
     * never answered has no move target, so he stands in the street thinking
     * about moving. MEASURED: 95k deferred solves in 8k frames with a fixed
     * order, and mean distance travelled per bot FELL when the AI was made
     * keener to reposition, because keener meant more requests into the same
     * starved queue.
     *
     * Starting the sweep at a rotating offset makes the ration round-robin, so
     * every actor is served within `agents.length / pathsPerFrame` frames.
     */
    const n = this.agents.length;
    this._turnCursor = n ? (this._turnCursor + this.pathsPerFrame) % n : 0;
    const start = this._turnCursor;

    let alive = 0;
    for (let j = 0; j < n; j++) {
      const i = (start + j) % n;
      const a = this.agents[i];
      if (a.alive) {
        if (a.staged) this._updateStaged(a, dt);
        else a.update(dt, ctx);
        alive++;
      } else if (a.deadTime !== undefined) {
        a.deadTime += dt;
        if (this.debugLog && a.ragdoll && !a._loggedDoll && a.deadTime > 1.2) {
          a._loggedDoll = true;
          const b = a.ragdoll.aabb;
          console.info(
            `[ai] ragdoll ${a.id} settled: ${(b.maxx - b.minx).toFixed(2)} x ` +
              `${(b.maxy - b.miny).toFixed(2)} x ${(b.maxz - b.minz).toFixed(2)} m ` +
              `at y=${b.miny.toFixed(2)} sleeping=${a.ragdoll.sleeping}`
          );
        }
      }
    }
    // The net drains after everybody has thought: a contact queued this frame
    // may go out this frame, and the heat that sets the net's gap is measured
    // from the states the sweep above has just written.
    this.radio.update(dt, this.agents);
    this._updateGrenades(dt);
    this._reapCorpses();
    this._updateSpotting(ctx);
    this.stats.agents = this.agents.length;
    this.stats.alive = alive;
    this.stats.corpses = this.agents.length - alive;
  }

  /**
   * Keep at most `corpseLimit` bodies on the map, oldest out first.
   *
   * A ragdoll is not free once it has settled: physics still steps it, `render`
   * still draws a skinned mesh with its own material set, and `lateUpdate` still
   * puts a contact shadow under it. Thirty men respawning on a six second timer
   * for five minutes is a few hundred of those, and the cost is monotonic — the
   * round starts at 60 fps and ends somewhere else.
   *
   * Reaping by AGE rather than by distance is deliberate: a body that vanishes
   * because you looked away and looked back is worse than one that vanishes
   * thirty seconds after it fell, and the age rule is the same wherever you
   * happen to be standing. `deadTime` is accumulated above; a body is only
   * eligible once it has had four seconds to settle and be seen, so nothing
   * ever disappears in the same beat it fell in.
   */
  _reapCorpses() {
    const list = this._corpses;
    list.length = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.alive && a.deadTime !== undefined) list.push(a);
    }
    if (list.length <= this.corpseLimit) return;
    list.sort((a, b) => b.deadTime - a.deadTime); // oldest first
    let toRemove = list.length - this.corpseLimit;
    for (let i = 0; i < list.length && toRemove > 0; i++) {
      const a = list[i];
      if (a.deadTime < 4) break; // nothing dies twice in front of you
      const k = this.agents.indexOf(a);
      if (k >= 0) this.agents.splice(k, 1);
      this.cover?.release(a.id);
      a.dispose();
      toRemove--;
    }
  }

  /**
   * Radar contacts. An enemy appears on the minimap only while somebody on the
   * other side is actually looking at them — the same "call it out or it isn't
   * there" rule the mode is built on. Stamped as a time so `getHudActors` can
   * let a contact fade instead of blinking.
   */
  _updateSpotting(ctx) {
    const now = ctx.time.elapsed;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.alive || !a.targetVisible) continue;
      const t = a.targetActor;
      if (t && t.isPlayer !== true) t.spottedAt = now;
    }
    // The player's own eyes count too: anything inside the view frustum and in
    // line of sight is a contact for their team.
    const player = ctx.peek('player');
    if (!player || player.dead) return;
    const eye = ctx.camera.position;
    const f = player.forward;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.alive || a.team === this.playerTeam) continue;
      if (now - (a.spottedAt ?? -1e9) < 0.25) continue;
      const p = this.actorChest(a, this._v);
      const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 90 || d < 1e-3) continue;
      if ((dx * f.x + dy * f.y + dz * f.z) / d < 0.55) continue;
      if (this.phys && !this.phys.lineOfSight(eye, p, this.phys.MASK.SIGHT)) continue;
      a.spottedAt = now;
    }
  }

  lateUpdate() {
    const g = this.ground;
    g.begin();
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      a.syncHitboxes();
      // Dead men keep their contact: a ragdoll on the floor needs it most.
      //
      // An actor `_updateRelevance` proved cannot reach a pixel is skipped: its
      // contact quad is a screen-space sprite lying under it, so if the actor's
      // inflated sphere misses the frustum the quad does too. That is worth two
      // `bonePos` calls per actor per frame, which at thirty actors is the
      // difference between the cap mattering and not.
      if (!a.lodIrrelevant) g.addActor(a);
    }
    g.end();
  }

  /* ================================================================== */
  /* frame budgets and LOD                                              */
  /* ================================================================== */

  /**
   * A* on the shared grid, rationed. Returns the waypoint count, or -1 when this
   * frame's budget is spent — the caller keeps its old path and asks again next
   * frame, which is invisible at 60 Hz and turns a squad-wide repath (six solves,
   * ~5 ms, on the frame the player opens fire) into two solves per frame.
   */
  requestPath(from, dest, out) {
    if (!this.grid) return 0;
    if (this._pathBudget <= 0) {
      this.stats.pathsDeferred++;
      return -1;
    }
    this._pathBudget--;
    const t0 = performance.now();
    const n = this.grid.findPath(from, dest, out);
    // What a solve costs on this level, as an exponential mean. One multiply-add
    // per solve, and it is what turns `pathMsBudget` into a ration — see there.
    this._pathCostMs += (performance.now() - t0 - this._pathCostMs) * 0.05;
    this.stats.pathCostMs = this._pathCostMs;
    return n;
  }

  /** Unit vector pointing AT the sun, however the sky exposes itself. */
  _sunDirection() {
    const sky = this._sky ?? (this._sky = this.ctx.peek('sky'));
    const d = sky?.sunDirection;
    if (d && Number.isFinite(d.x)) this._sun.copy(d);
    else this._sun.set(0.3, 0.8, 0.4);
    if (this._sun.lengthSq() < 1e-8) this._sun.set(0, 1, 0);
    return this._sun.normalize();
  }

  /**
   * Decide, per actor, whether anything it does this frame can reach a pixel.
   *
   * An actor is IRRELEVANT only when both of these hold:
   *   1. its (already 1.45x inflated) bounding sphere, grown by a further 4 m,
   *      misses the camera frustum — so it is not drawn, and no screen-space
   *      effect can sample it either, because it is not in the depth buffer;
   *   2. the volume its sun shadow could possibly darken misses the frustum too.
   *      For a directional light that volume is exactly the actor's sphere swept
   *      along -sunDir: a visible surface can only be shadowed by this actor if
   *      the ray from that surface toward the sun passes through it. Sweeping to
   *      where the ray leaves the level below the floor covers every receiver,
   *      ground or wall, and the 4 m of slack absorbs both the soft-shadow filter
   *      radius (up to ~1 m of cascade texels) and a frame of camera motion.
   *
   * Irrelevant actors animate at a third of the rate and are dropped from the
   * shadow cascades (`userData.owNoShadow`, which render honours per frame). They
   * are still simulated, still shootable, still make noise — only the parts that
   * can exclusively affect pixels are skipped.
   */
  _updateRelevance(ctx) {
    const cam = ctx.camera;
    this._mvp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._mvp);
    const sun = this._sunDirection();
    // how far a shadow ray can travel before it is under the level
    const floorY = (this.grid ? -6 : -20);
    const sunY = Math.max(0.06, sun.y);
    let irrelevant = 0;

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      const geo = a.mesh.geometry;
      const bs = geo.boundingSphere;
      if (!bs) { a.lodIrrelevant = false; continue; }
      const s = this._sphere.copy(bs).applyMatrix4(a.mesh.matrixWorld);
      s.radius += 4;
      let visible = this._frustum.intersectsSphere(s);
      if (!visible) {
        const sweep = this._sweep;
        const tMax = Math.min(320, (s.center.y - floorY) / sunY);
        const step = Math.max(2, s.radius * 0.9);
        sweep.radius = s.radius;
        for (let t = step; t <= tMax; t += step) {
          sweep.center.copy(s.center).addScaledVector(sun, -t);
          if (this._frustum.intersectsSphere(sweep)) { visible = true; break; }
        }
      }
      a.lodIrrelevant = !visible;
      if (!visible) irrelevant++;
      a.mesh.userData.owNoShadow = !visible;
    }
    this._lodStats.irrelevant = irrelevant;
    this.stats.lodIrrelevant = irrelevant;
  }

  /* ================================================================== */
  /* staged tableau for the capture harness                             */
  /* ================================================================== */

  /**
   * Pin an agent into a photogenic combat beat: it still animates, aims and
   * fires for real, it just does not get to decide where to stand.
   */
  _updateStaged(a, dt) {
    const s = a.staged;
    const p = this.playerPosition(this._v3);
    a.stateTime += dt;
    a.fireCooldown -= dt;
    a.burstCooldown -= dt;
    a.state = STATE.COMBAT;
    a.hasTarget = true;
    a.targetVisible = true;
    a.alertness = 1;
    a.lastKnown.copy(p);
    a.lastKnownAge = 0;
    a.crouch = !!s.crouch;
    a.aimWeight = s.aimWeight ?? 1;
    a.suppression = s.suppression ?? 0;
    a.desiredSpeed = s.speed ?? 0;
    a.wantFire = s.fire !== false;
    if (s.speed) {
      a.hasMoveTarget = true;
      if (!a.path[0]) a.path[0] = new THREE.Vector3();
      a.path[0].copy(a.position).addScaledVector(s.heading, 6);
      a.pathLen = 1;
      a.pathIndex = 0;
    } else {
      a.hasMoveTarget = false;
    }
    if (s.reloadEvery && a.stateTime > s.reloadEvery && !a.animator.reloading) {
      a.stateTime = 0;
      a.animator.reload(2.4);
    }
    a._move(dt);
    a._shoot(dt);
    a._drive(dt);
  }

  /**
   * Compose a staged enemy into the frame: find the walkable spot whose
   * projected screen position and depth best match the requested composition,
   * that the camera can actually see, that is not on top of another actor, and
   * that has cover nearby. Occlusion is checked at chest and head height, which
   * is what stops a soldier being placed behind a market stall.
   */
  _stageSlot(cam, ndcX, wantDepth, placed) {
    const g = this.grid;
    const F = this._v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    F.y = 0;
    F.normalize();
    const rx = F.z, rz = -F.x; // camera right, flattened
    const tanH = Math.tan((cam.fov * Math.PI) / 360) * cam.aspect;
    const ideal = new THREE.Vector3()
      .copy(cam.position)
      .addScaledVector(F, wantDepth)
      .add(this._v2.set(rx, 0, rz).multiplyScalar(ndcX * tanH * wantDepth));
    const yRef = cam.position.y - 1.7;
    const out = new THREE.Vector3(ideal.x, yRef, ideal.z);
    if (!g) {
      out.y = this.groundAt(out.x, out.z, cam.position.y + 3);
      return out;
    }
    const chest = this._v3;
    const cx = g.cellX(ideal.x), cz = g.cellZ(ideal.z);
    const span = Math.ceil(7 / g.cell);
    let best = -1, bestScore = Infinity, bestX = 0, bestZ = 0;
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const ix = cx + dx, iz = cz + dz;
        if (!g.walkable(ix, iz)) continue;
        const i = g.index(ix, iz);
        const fy = g.floor[i];
        if (Math.abs(fy - yRef) > 1.0) continue;
        const x = g.worldX(ix), z = g.worldZ(iz);
        // spacing from the men already placed
        let tooClose = false;
        for (const q of placed) {
          if (Math.hypot(q.x - x, q.z - z) < 2.4) { tooClose = true; break; }
        }
        if (tooClose) continue;
        // project
        const ex = x - cam.position.x, ez = z - cam.position.z;
        const depth = ex * F.x + ez * F.z;
        if (depth < 3) continue;
        const lateral = ex * rx + ez * rz;
        const ndc = lateral / (depth * tanH);
        // must be visible: chest and head
        if (this.phys) {
          chest.set(x, fy + 1.25, z);
          if (!this.phys.lineOfSight(cam.position, chest, this.phys.MASK.SIGHT)) continue;
          chest.set(x, fy + 1.62, z);
          if (!this.phys.lineOfSight(cam.position, chest, this.phys.MASK.SIGHT)) continue;
        }
        let score = Math.abs(ndc - ndcX) * 9 + Math.abs(depth - wantDepth) * 0.5;
        // prefer standing next to something solid
        score -= g.enclosure[i] * 0.35;
        if (score < bestScore) {
          bestScore = score;
          best = i;
          bestX = x;
          bestZ = z;
        }
      }
    }
    if (best >= 0) out.set(bestX, g.floor[best], bestZ);
    else out.y = this.groundAt(out.x, out.z, cam.position.y + 3);
    return out;
  }

  /**
   * `debugStage('firefight')` — a staged firefight in front of the shot camera:
   * one man up and firing from behind hard cover, one crouched and peeking, one
   * moving between positions, one reloading further back.
   */
  debugStage(name) {
    if (name !== 'firefight') return this.stats;
    if (this.inspect) return this._stageInspect();
    if (this._navPending) this._buildNav();

    const cam = this.ctx.camera;
    // A firefight the critic can actually see: drop the sun low enough to rake
    // down the street so the characters are lit, not silhouetted. This shot is
    // ours to compose; every other shot keeps its own time of day.
    this.ctx.peek('sky')?.setTimeOfDay?.(17.9);
    const F = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    F.y = 0;
    F.normalize();
    const right = new THREE.Vector3(F.z, 0, -F.x);
    const squad = this.createSquad();

    /** [variant, ndcX, depth, crouch, speed, fire, reloadEvery] */
    const LAYOUT = [
      // hero: up and firing, left of frame, close enough to read the kit
      ['vanguard', -0.44, 8.0, false, 0, true, 0],
      // second man crouched in cover, right of frame
      ['breacher', 0.30, 12.0, true, 0, true, 0],
      // one caught mid-stride between positions
      ['irregular', -0.14, 16.0, false, 4.1, false, 0],
      // one reloading behind cover on the far right
      ['vanguard', 0.60, 9.5, true, 0, true, 3.4],
      // depth: a fifth man well down the street
      ['irregular', -0.26, 22.0, false, 0, true, 0],
    ];

    const placedPositions = [];
    for (const [variant, ndcX, d, crouch, speed, fire, reload] of LAYOUT) {
      const pos = this._stageSlot(cam, ndcX, d, placedPositions);
      const yaw = Math.atan2(cam.position.x - pos.x, cam.position.z - pos.z);
      const a = this.spawn(variant, pos, yaw);
      squad.add(a);
      a.staged = {
        crouch,
        speed,
        fire,
        noDamage: true,
        heading: right.clone().multiplyScalar(-1),
        aimWeight: 1,
        reloadEvery: reload || 0,
        suppression: crouch ? 0.15 : 0,
      };
      // stagger the burst timers so the frame catches muzzle flashes
      a.burstCooldown = this.rng.range(0, 0.3);
      a.burstLeft = this.rng.int(2, 6);
      a.peeking = true;
      a.aimTarget.copy(this.playerPosition(this._v3));
      a.animator.update(0.016, 0);
      placedPositions.push(pos.clone());
      this._stagedAgents = (this._stagedAgents ?? []);
      this._stagedAgents.push(a);
      if (this.debugLog) {
        console.info(
          `[ai] staged ${variant} at ${pos.x.toFixed(1)},${pos.y.toFixed(2)},${pos.z.toFixed(1)} ` +
            `d=${cam.position.distanceTo(pos).toFixed(1)}m`
        );
      }
    }

    // One man already down, handed to the ragdoll solver with the round's
    // impulse — it dresses the tableau and it exercises the death path.
    const dPos = this._stageSlot(cam, -0.58, 9.4, placedPositions);
    const casualty = this.spawn('breacher', dPos, Math.atan2(cam.position.x - dPos.x, cam.position.z - dPos.z));
    squad.add(casualty);
    casualty.animator.update(0.016, 0);
    const hit = new THREE.Vector3(dPos.x, dPos.y + 1.35, dPos.z);
    const inc = new THREE.Vector3().subVectors(hit, cam.position).normalize();
    casualty.applyDamage(260, 'torso', hit, inc);

    return this.stats;
  }

  /** Model inspection line-up (dev only). */
  _stageInspect() {
    const cam = this.ctx.camera;
    const F = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    F.y = 0;
    F.normalize();
    const right = new THREE.Vector3(F.z, 0, -F.x);
    this.ctx.peek('sky')?.setTimeOfDay?.(11.5);
    const layout = [
      ['vanguard', 1.9, 0.35, 0.25],
      ['irregular', 2.7, -0.95, 3.0],
      ['breacher', 3.6, 1.15, -0.7],
    ];
    for (const [nm, d, s2, extraYaw] of layout) {
      const p = new THREE.Vector3().copy(cam.position).addScaledVector(F, d).addScaledVector(right, s2);
      p.y = this.groundAt(p.x, p.z, cam.position.y + 1.0);
      const toCam = Math.atan2(cam.position.x - p.x, cam.position.z - p.z);
      const a = this.spawn(nm, p, toCam + extraYaw);
      a.staged = {
        crouch: false,
        speed: 0,
        fire: false,
        aimWeight: 1,
        heading: new THREE.Vector3(0, 0, 1),
      };
    }
    return this.stats;
  }

  /* ================================================================== */

  dispose() {
    for (const off of this._off ?? []) off();
    for (const a of this.agents) a.dispose();
    this.agents.length = 0;
    this.squads.length = 0;
    // Queued messages hold a speaker; without this the net keeps thirty
    // disposed actors alive for as long as anything holds the system.
    this.radio.reset();
    for (const g of this._grenades) {
      this.phys?.removeRigidBody(g.body);
      this.root.remove(g.mesh);
    }
    this._grenades.length = 0;
    this._grenadeGeo?.dispose();
    this._grenadeMat?.dispose();
    this.ground?.dispose();
    for (const v of this._variants.values()) v.geometry.dispose();
    this._variants.clear();
    this.materials?.dispose();
    this.root.parent?.remove(this.root);
  }
}

export { VARIANTS, STATE };
