/**
 * MATCH — DOMINATION, with the demolition ruleset kept behind a mode flag.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SUBSYSTEM IS
 * ────────────────────────────────────────────────────────────────────────────
 * Everything in `src/render`, `src/materials`, `src/sky`, `src/world`,
 * `src/physics`, `src/fx` and `src/audio` is the engine this repo shipped with
 * and is untouched. What changed is the GAME.
 *
 *   src/match/rules.js    every duration, count and radius, and `RULES.mode`
 *   src/match/sites.js    the three capture zones (and the two bomb sites), both
 *                         spawn clusters, in the level's own space
 *   src/match/capture.js  DOMINATION: presence, the capture bar, the score tick
 *   src/match/bomb.js     DEMOLITION: carry / drop / plant / defuse / detonate
 *   src/match/spectate.js the camera you get while you wait to come back
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY DOMINATION, AND WHAT THAT REPLACED
 * ────────────────────────────────────────────────────────────────────────────
 * "爆破サイトにするとゲーム性が悪いのでドミネーションにします。占領サイトを一定時間
 * いるとポイント加算で、サイトを占領するとそこからリスポーン可能で、奪われたら既定の
 * リスポーン位置からのスポーンのみ"
 *
 * Three zones, A / C / B west to east. Standing in one takes it, holding one
 * prints `RULES.scorePerZone` every `RULES.scoreInterval`, first side to
 * `RULES.scoreTarget` wins, and a zone you hold is a spawn for your side that
 * disappears the instant it is taken off you.
 *
 * WHAT DOMINATION DOES NOT USE (all of it still runs under
 * `RULES.mode = MODE.DEMOLITION`, none of it is half-converted):
 *   • the C4 entirely — no plant, no defuse, no fuse, no `match:bomb`
 *   • rounds. There is ONE match: no `roundsToWin`, no `maxRounds`, no side
 *     swap, no per-round rebuild. `m.round` stays 1.
 *   • attack and defence as roles. Both sides want all three zones; `role` now
 *     only names which base cluster you spawn at, and it never swaps.
 *   • elimination as a win condition, and with it `RULES.respawnCutoff` — a side
 *     with nobody alive is a side losing three points every four seconds, which
 *     is punishment enough. Respawns never close.
 *   • the flank staging leg (`_flankTarget`) and the contact-report rotation
 *     (`_threatenedSite`). Domination has real zone state to rotate on, which is
 *     strictly better information than a guess about which site is being hit.
 * KEPT: warmup (the level finishes streaming), freeze (both sides hold at spawn
 * so the match does not open mid-firefight), the respawn queue and its 6 s / 4 s
 * protection, the three air weapons, the ammunition pouches, spectating.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * STATE MACHINE
 * ────────────────────────────────────────────────────────────────────────────
 *   warmup -> freeze -> live -> over -> matchover -> (freeze, a fresh match)
 *
 *   freeze    weapons locked, feet locked, both sides at their base
 *   live      the match. `roundClock` is `RULES.matchTime` counting down.
 *   over      scoreboard dwell
 *   matchover the result, then a restart
 *
 * In demolition the same graph loops `over -> freeze` for the next round.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLIC API — `const m = ctx.get('match')`
 * ────────────────────────────────────────────────────────────────────────────
 *   m.phase / m.round / m.score      -> [red, blue]
 *   m.attackers / m.defenders        -> TEAM ids (in domination: fixed bases)
 *   m.playerRole                     -> 'attack' | 'defend' (which base)
 *   m.sites                          -> the zones: [{ id, name, position, radius,
 *                                      owner, progress, capTeam, contested }]
 *   m.capture                        -> the CaptureZones, or null in demolition
 *   m.bomb                           -> the Bomb (inert in domination)
 *   m.roster                         -> [{ name, team, kills, deaths, alive }]
 *   m.getHudState()                  -> the snapshot `ui` draws the round HUD from
 *
 * EVENTS EMITTED (added to the table in ARCHITECTURE.md)
 *   match:round    { round, phase, attackers, score }
 *   match:capture  { zone, owner, previous, score }
 *   match:bomb     { state, site, fuse, carrier }      demolition only
 *   match:result   { winner, reason, score, matchOver }
 */

import * as THREE from 'three';
import { RULES, MODE, TEAM, TEAM_NAME, TEAM_COLOR, ROLE, attackingTeam, roleOf, BOT_NAMES, REINFORCE_NAMES, TEAM_VARIANTS } from './rules.js';
import { resolveLayout } from './sites.js';
import { CaptureZones } from './capture.js';
import { Bomb, BOMB } from './bomb.js';
import { Spectator } from './spectate.js';
import { SiteMarks } from './sitemark.js';
import { Airstrike, JET_LEAD } from './airstrike.js';
import { Bomber } from './bomber.js';
import { Strafe } from './strafe.js';
import { Armour } from './tank.js';
import { AmmoDrops } from './ammo.js';
import { Caches } from './caches.js';
import { Reinforcements } from './reinforce.js';

const PHASE = { WARMUP: 'warmup', FREEZE: 'freeze', LIVE: 'live', OVER: 'over', MATCH_OVER: 'matchover' };

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE CATHEDRAL EVENT'S BEAT SHEET — "大聖堂崩壊イベントは過激にそして激しく破壊
 * し、大イベントにしてください"
 * ────────────────────────────────────────────────────────────────────────────
 * `[seconds relative to the moment the ordnance ARRIVES, what happens]`, in
 * ascending order, played by `MatchSystem._updateCathedralEvent` off one clock.
 * Zero is `RULES.cathedralLead` seconds after the warning goes up.
 *
 * IT IS RELATIVE TO THE ARRIVAL AND NOT TO THE CALL, and that one word is the
 * bug it replaces. The old code started the raze countdown when the collapse was
 * CALLED, and `Airstrike` does not drop anything for `JET_LEAD` = 4.4 s after a
 * call — so the 30 x 45 m building vanished 2.2 s BEFORE the first bomb landed,
 * measured on a live match at t = 166.2 against a first impact at t = 168.4.
 * The salvo entry below is at `-JET_LEAD` for exactly that reason: it is CALLED
 * early so that it LANDS on the beat, and if the telegraph is ever retuned the
 * arithmetic follows it because the constant is imported rather than copied.
 *
 * The barrage is not in this table — it is a continuous walk on its own count
 * from `-3.0` to `+8.0`, so the salvo, the aeroplanes and the building going
 * all happen INSIDE a bombardment rather than in the gaps between events.
 * @see `RULES.cathedralLead` for the whole sheet written out in one place.
 */
const CATH_BEATS = [
  [-JET_LEAD, 'salvo'],
  /**
   * The aeroplane is its own telegraph: 2.4 s on screen before it releases and
   * 1.7 s of fall after, so firing it here puts its stick down just behind the
   * salvo and puts the airframe over the square while the warning is still up.
   *
   * -3.4 RATHER THAN -3.0 BECAUSE THE BARRAGE OPENS AT -3.0. Measured with
   * `_cathcost.mjs`: on the same frame the two cost 303 ms against a
   * neighbourhood median of 131, and `Bomber.fire` is the expensive half (it
   * poses and first-draws an airframe whose materials have never been on
   * screen). Four hundred milliseconds of separation is a dozen frames, and it
   * costs the choreography nothing.
   */
  [-3.4, 'bomber'],
  [RULES.cathedralRazeDelay, 'raze'],
  [3.4, 'strafe'],
  [9.0, 'aftermath'],
  // ARMED ON THE AFTERMATH, NOT ON D, so `RULES.tankAfterCathedral` lands the
  // hulls on the same second the point opens rather than three after it. It is
  // one line either way; what it buys is the two events reading as one.
  [9.0, 'armour'],
  [RULES.cathedralOpenDelay, 'open'],
];

/**
 * THE `role` HANDED TO `ai.spawn` IN DOMINATION, AND WHY IT IS NOT 'defend'.
 *
 * MEASURED, and it decided a whole match before this existed. `Agent.role` is
 * only ever read by `ai.personaFor` -> `drawPersona`, where it does two things:
 * it picks the archetype mix (`ARCHETYPE_MIX.attack` is rusher-heavy,
 * `.defend` is anchor-heavy) and it adds `ai.defenderSkill` — a flat +0.10 on
 * the skill mean — to anybody whose role is `'defend'`.
 *
 * In demolition that is fair, because the sides SWAP at `swapAfterRound` and
 * each half of the match is played from both ends of it. Domination never swaps:
 * `roleOf` is a fixed statement about which base you spawn at. So the south side
 * would carry a permanent 0.44-vs-0.54 skill edge and a permanently different
 * personality mix, for the whole match, on every match. The first full headless
 * match ran 252-100 to the south side with the north side pinned on one zone for
 * three minutes.
 *
 * Passing a role that is neither `'attack'` nor `'defend'` makes `drawPersona`
 * fall through to `ARCHETYPE_MIX.any` and skip the bonus, for both sides. It also
 * keeps `ai.defenderSkill` alone, which is `src/ai`'s number to own — `match`
 * drives `ai` through the hooks in ARCHITECTURE.md and does not reach in and
 * rewrite its tuning.
 */
const AI_ROLE_FIELD = 'field';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE CACHE LEG'S FOUR NUMBERS. @see `_assignCacheLegs`
 * ────────────────────────────────────────────────────────────────────────────
 * `CACHE_LEGS` is per side per two-second refresh and is also capped at a fifth
 * of the live side, so a team of fifteen sends at most three men inside and a
 * team of five sends one. Above that the mode stops being domination: a capture
 * point is taken by the side that put more bodies on it, and men in a building
 * are men not on the point.
 *
 * `CACHE_NEAR_ZONE` is 26 m, which is the distance at which a ground floor is
 * still part of the fight for a point rather than a different part of the map —
 * the same order as `sitecheck`'s 26 m overwatch span, for the same reason.
 *
 * `RESUPPLY_AFTER` / `RESUPPLY_RANGE`: a man who has been alive 40 s has been
 * shooting, and 22 m is close enough that the detour is on his way.
 */
/**
 * 3 -> 5, AND THE CAP FROM A FIFTH OF THE SIDE TO A QUARTER. "もっとAIが屋内に
 * 入って" is a request for a bigger number and this is the number. At the 20 v 20
 * roster that is five men per side per refresh instead of three, and the cap
 * (20/4 = 5) stops binding rather than the other way round; at five men a side
 * it is still one, so a thin team is not emptied into a building.
 *
 * It is safe to raise because of what it was measured DOING, not because five
 * felt right: of 39 legs handed out on one seed, 10 arrived, 11 died on the way
 * and 12 timed out — nobody was queueing at a door. The failure mode this
 * constant guards against is crowding at a doorway (@see `tools/stuckcheck.mjs`,
 * which is the gate), and the gate reports 0/39 with it at 5.
 */
const CACHE_LEGS = 5;
const CACHE_NEAR_ZONE = 26;
const RESUPPLY_AFTER = 40;
const RESUPPLY_RANGE = 22;
/**
 * ────────────────────────────────────────────────────────────────────────────
 * AND THE THREE THE NEED-DRIVEN LEGS ADDED. @see `_assignCacheLegs`
 * ────────────────────────────────────────────────────────────────────────────
 * `RESUPPLY_AFTER` above is a proxy — "he has been alive 40 s so he has been
 * shooting" — and it was the best `match` could do while `src/ai` had no
 * ammunition to run out of. It does now (`Agent.reserve`, see its constructor),
 * so the proxy is demoted to the LAST reason a man is sent to a crate and the
 * real one goes first.
 *
 * `NEED_RANGE` is deliberately larger than `RESUPPLY_RANGE`: a man who is DRY
 * is not a rifle any more, and walking him 38 m to become one again is worth
 * more than whatever he was going to do standing where he is. A man who is
 * merely low is not, which is why the two are ranked and not merged.
 */
const NEED_RANGE = 38;
/** Kinds that hand a bot rounds. @see `Caches.takeForBot` for what each gives. */
const AMMO_KINDS = new Set(['ammo', 'vantage', 'weapon']);
const GRENADE_KINDS = new Set(['grenade']);
/**
 * A FIRING POSITION IS A PERSONALITY, NOT A REWARD, and this is the one rule in
 * the set that currently selects nothing. A `vantage` is a nest with an
 * ordnance box in it; the men who want one are the men who fight long and hold
 * still, which is `traits.patience` high and `traits.range` long — the marksman
 * and the anchor. ALL EIGHT VANTAGE NESTS ON THIS MAP ARE `floor: 'roof'` AND
 * NO BOT CAN REACH ONE (`src/ai/nav.js` is a 2.5D height field: one floor per
 * cell, so a stair is zero waypoints). `Caches.prove` therefore keeps none of
 * them and `nearestBotCache(..., VANTAGE_KINDS)` returns null every time it is
 * called. It is written, it is measured returning zero, and it is left in
 * because the day a nest is published on a ground floor it is already wired —
 * not because it does anything today. @see `Caches.takeForBot`.
 */
const VANTAGE_KINDS = new Set(['vantage']);
/**
 * EVERY KIND THAT IS WORTH A BOT'S WALK, which is now "not the med posts".
 *
 * The two `_spareCache` rules used to pass no filter at all and meant "any
 * proved cache" — which was right while every kind handed a bot SOMETHING.
 * `medic` does not: `Caches.takeForBot` refuses it, because `Agent.health` is
 * `src/ai`'s state and there is no `ai.heal` on the hook list in
 * ARCHITECTURE.md. Without this the contest rule would happily walk a man to a
 * dressing station, stand him on it for `CACHE_DWELL` and hand him nothing —
 * the exact "what was measured was footfall" failure `Caches.takeForBot`'s own
 * header exists to have fixed. @see `Caches.takeForBot`.
 */
const BOT_USEFUL_KINDS = new Set(['ammo', 'vantage', 'weapon', 'grenade']);
const VANTAGE_PATIENCE = 0.62;
const VANTAGE_RANGE = 24;
/**
 * Seconds a man keeps the cache he was given. The plan is re-cut every two
 * seconds and re-tasks EVERY live man, so without this a leg is re-chosen from
 * scratch on every refresh and a bot walking to a door is turned round in the
 * street — the same "arrives nowhere in strength" failure `_focus` exists to
 * stop. He drops it early when he gets there, and on death, because a respawn
 * is a new Agent.
 */
const CACHE_HOLD = 18;
/** Metres. Close enough to the crate to call the errand done. */
const CACHE_ARRIVE = 2.2;
/**
 * Seconds a man STAYS once he is there, and the difference between a bot who
 * has been indoors and a fight that happened indoors. Dropping the errand on
 * arrival hands him back to the zone plan on the next two-second refresh and he
 * walks straight back out of the door he came in by: measured, that is 6.5 % of
 * bot-time inside a building and one indoor kill in forty-nine. He is holding a
 * room somebody else's side has a reason to walk into; let him hold it.
 */
const CACHE_DWELL = 14;
/**
 * Metres from the zone this side is fighting for, inside which a crate is a
 * FORWARD position and therefore worth the beacon. @see `_beaconWorth`.
 *
 * Wider than `CACHE_NEAR_ZONE` (26 m, "part of the fight for this point") on
 * purpose: a spawn does not have to be in the fight, it has to be a short walk
 * into it, and 40 m is roughly the far side of a block — near enough that the
 * men coming out of it arrive at the point, far enough that the beacon is not
 * itself standing in the contested paint.
 */
const BEACON_NEAR_ZONE = 40;

/** Metres. Close enough to the flank staging point to count as "been there". */
const FLANK_ARRIVE = 7;
/** Seconds. A staging point he has not reached by now is not worth any more of the round. */
const FLANK_TIMEOUT = 45;

export class MatchSystem {
  static id = 'match';
  static deps = ['world', 'physics', 'player', 'weapons', 'ai', 'ui'];

  async init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    this.ai = ctx.get('ai');
    this.player = ctx.get('player');
    this.weapons = ctx.get('weapons');
    this.ui = ctx.get('ui');
    this.world = ctx.get('world');
    /**
     * PUT THE CATHEDRAL'S RUIN AWAY BEFORE THE FIRST FRAME.
     *
     * `world` assembles both states of the building and can hide neither: a
     * scope is recorded visible and `buildCathedral` returns before
     * `Assembler.finalize` has made a mesh to hide. `_beginRound` primes it too,
     * but the first round is several seconds of WARMUP away and the ruin would
     * be drawn standing inside the intact church for all of them.
     */
    this._setCathedralRazed(false);
    /** Which ruleset is running. Read all over this file. @see RULES.mode */
    this.domination = RULES.mode === MODE.DOMINATION;

    /* ---- layout ------------------------------------------------------- */
    const layout = resolveLayout(this.world, this.ai);
    /** The LIVE zones. A locked zone joins this array when the match opens it. */
    this.sites = layout.sites;
    /**
     * EVERY authored zone, live or not, in authored order. Used only by the
     * things that have to be right about the whole map at BOOT — the site paint,
     * and the route gate `Airstrike._verifyRoutes` runs — because a zone that
     * appears at t=210 s must have been proved against the same intact map as
     * the other three, not against whatever the town looks like when it opens.
     */
    this.allZones = layout.all;
    this.spawns = layout.spawns;
    this._spawnCentre = { attack: centroid(layout.spawns.attack), defend: centroid(layout.spawns.defend) };
    for (const s of this.sites) {
      console.info(
        `[match] site ${s.id} "${s.name}" at ${s.position.x.toFixed(1)}, ` +
          `${s.position.y.toFixed(2)}, ${s.position.z.toFixed(1)}`
      );
    }

    /* ---- teams -------------------------------------------------------- */
    this.playerTeam = RULES.playerTeam;
    this.player.team = this.playerTeam;
    this.player.name = 'YOU';
    this.score = [0, 0];
    this.round = 0;
    this.phase = PHASE.WARMUP;
    this.timer = RULES.warmup;
    this.roundClock = this.domination ? RULES.matchTime : RULES.roundTime;
    this.result = null;
    this.matchOver = false;

    /** One record per participant for the scoreboard. Never reallocated. */
    this.roster = [];
    this._botsByTeam = [[], []];
    /** The Squad each side's bots belong to, so a respawn joins the right one. */
    this._squads = [null, null];
    /** Pending respawns: { rec, at } sorted by nothing — the list is tiny. */
    this._respawnQueue = [];

    /* ---- hand the rules to the systems that enforce them --------------- */
    this.ai.playerTeam = this.playerTeam;
    this.ai.friendlyFire = RULES.friendlyFire;
    this.ai.matchControlled = true;
    this.ai.skill = RULES.botSkill;
    this.ai.clearAgents();
    // No health regeneration: the 100 HP you spawn with is the round's budget.
    this.player.health.regenEnabled = RULES.regen;
    // `ui` stops inventing killfeed rows and scores off raw damage events —
    // attribution in a team mode has to come from here, where teams are known.
    this.ui.matchDriven = true;
    this.ui.isFriendlyTarget = (t) => this.ai.teamOf(t) === this.playerTeam;
    // Nothing is live until the first round starts.
    this.weapons.locked = true;
    this.ai.combatEnabled = false;

    /* ---- the zones ----------------------------------------------------- */
    /**
     * DOMINATION lives here. `this.score` is ADOPTED from it rather than copied:
     * the HUD, the scoreboard, `match:round` and `match:result` all read
     * `m.score`, and pointing them at the capture system's own array means there
     * is exactly one score in the process and no way for the two to drift.
     */
    this.capture = this.domination ? new CaptureZones(this.sites) : null;
    if (this.capture) {
      this.score = this.capture.score;
      this.capture.onCapture = (z, previous, byPlayer) => this._onCaptured(z, previous, byPlayer);
      this.capture.onScoreTick = null; // silent on purpose; the HUD already shows it
    }
    /** Forward vs base spawns actually used, per team. Reported, not gameplay. */
    this._forwardSpawns = [0, 0];
    this._baseSpawns = [0, 0];

    /* ---- bomb + spectator --------------------------------------------- */
    this.bomb = new Bomb(ctx);
    // Paint the sites on the ground from the RESOLVED positions, so the paint is
    // always where the plant trigger is even when `resolveLayout` has had to
    // move a site off sealed geometry. See src/match/sitemark.js.
    // EVERY zone, including the locked one: the paint has to be built from the
    // resolved position (that is why it lives here and not in `world`), and a
    // locked zone is then hidden until it opens. @see SiteMarks.setVisible
    this.marks = new SiteMarks(ctx, this.allZones);
    // The ground paint is friend-or-foe, not team identity. @see SiteMarks.
    this.marks.playerTeam = this.playerTeam;
    for (const z of this.allZones) if (z.locked) this.marks.setVisible(z, false);
    /**
     * Ammunition on the bodies. The round's budget is still what you walk out
     * of spawn with (`weapons.resetAmmo`), but a five minute round with
     * respawns is long enough to spend it, and every man who goes down leaves
     * his pouches. See src/match/ammo.js for why it is walk-over rather than a
     * key, and why a pouch can never take you above your starting reserve.
     */
    this.ammoDrops = new AmmoDrops(ctx);
    /**
     * THE CACHES. `world.features` is twenty-four places the level authored and
     * marked and gave nothing to; this is what they are worth and who walks to
     * them. See src/match/caches.js — including the measurement it exists to
     * move (4.25 % of bot-time indoors before anything was bound to them).
     */
    /**
     * `player` is handed over for ONE verb — `health.heal` — which is what the
     * medical zone gives. @see `Caches.take`'s `medic` branch and
     * `RULES.medicHeal`; the two promoted features are named in `MEDIC_FEATURES`.
     */
    this.caches = new Caches(ctx, this.world?.features ?? [], this.weapons, this.player);
    /**
     * THE MEDICAL ZONE'S DRESSING — a painted disc, a red cross and a standard
     * at each promoted feature, so a dressing station does not look like the
     * ammunition dump `world` built there. @see `Caches.buildMedicMarkers`.
     */
    const med = this.caches.buildMedicMarkers();
    if (med) ctx.scene.add(med);
    /**
     * …and then PROVED against the real nav grid, because `world.features`'s
     * `botReachable` is `floor === 0` and four of the eight ground floors on
     * this map are not in the height field at all. @see `Caches.prove`.
     */
    this.caches.prove(this.ai, this.spawns);
    console.info(
      `[match] ${this.caches.list.length} caches bound · ${this.caches.botList.length} ` +
        `of ${this.caches.list.filter((c) => c.botReachable).length} flagged bot-reachable ` +
        `PROVED walkable · racks: ${this.caches.list.filter((c) => c.weaponId)
          .map((c) => `${c.building}f${c.floor}=${c.label}`).join(' ') || 'none'}`
    );
    /**
     * THE MEDICAL ZONE, REPORTED SEPARATELY AND PROVED LIKE EVERYTHING ELSE.
     * Two lines rather than one, because the promotion is a `match` decision
     * (`MEDIC_FEATURES`) and a boot on which `world` renamed or moved a flank
     * square would otherwise show up as a feature that silently is not there.
     */
    {
      const med = this.caches.list.filter((c) => c.kind === 'medic');
      const proved = med.filter((c) => c.stand).length;
      if (!med.length) {
        console.warn(
          '[match] MEDICAL ZONE: no published feature matched — the med kit is unreachable ' +
            'this boot. `MEDIC_FEATURES` in src/match/caches.js names them by id.'
        );
      } else {
        console.info(
          `[match] medical zone: ${med.length} post(s) — ${med.map((c) => c.id).join(' ')} · ` +
            `${proved} walkable-proved · +${RULES.medicHeal} HP on HOLD F, ` +
            `${RULES.medicCooldown}s per post, no team lock`
        );
      }
    }
    const patcher = ctx.peek('render')?.patcher;
    if (patcher) {
      for (const m of this.bomb.materials) patcher.patch(m);
      for (const m of this.ammoDrops.materials) patcher.patch(m);
      // Three paints, not one: neutral plus a tint per side. @see SiteMarks.
      for (const m of this.marks.materials) patcher.patch(m);
      for (const m of this.caches.medMaterials ?? []) patcher.patch(m);
    }
    this.spectator = new Spectator(ctx);

    /* ---- the air ------------------------------------------------------- */
    /**
     * TWO WEAPONS, ONE RULE: everything about how they break is baked here at
     * boot, and the frame either of them fires is a uniform write.
     *
     * `airstrike` is eight fixed strike sites on the town — three that take a
     * storey down and change the map, five smaller ones standing over the
     * attackers' approach so that pushing costs something. `bomber` is the
     * aircraft that crosses and walks a STICK of bombs along a line, which is a
     * different shape of threat: a line you have to be out of rather than a
     * point you have to be away from.
     *
     * `build()` on each is the only expensive call in either feature and both
     * run exactly once, inside the loading state.
     *
     * They are told about each other so they can never share the sky. Two
     * telegraphs at once is noise — the player has to be able to tell which one
     * is about to be theirs — so each one's scheduler stands down while the
     * other has something inbound.
     */
    /**
     * The strike's own copy of `tools/navcheck.mjs`'s invariant.
     *
     * navcheck asserts every spawn of both sides can A* to every site and hold
     * point, and it measures the INTACT map — which is the one state the mounds
     * are guaranteed not to be in. Handing the pairs to `Airstrike.build()`
     * lets it run the same assertion per site with that site's nav patch
     * applied, at boot, and disable any mound that would cost a route. See
     * `Airstrike._verifyRoutes`.
     */
    const navRoutes = [];
    // `allZones`, not `sites`: D is not live yet and the mounds must still be
    // proved not to cost anybody a route to it, because they will all have come
    // down long before it opens.
    for (const site of this.allZones) {
      for (const kind of ['attack', 'defend']) {
        for (const sp of this.spawns[kind]) navRoutes.push([sp.position, site.position]);
      }
      for (const sp of this.spawns.defend) navRoutes.push([sp.position, site.hold]);
    }
    this.airstrike = new Airstrike(ctx, { rng: this.rng.fork(), routes: navRoutes }).build();
    if (patcher) for (const site of this.airstrike.sites) for (const m of site.materials) patcher.patch(m);
    this.bomber = new Bomber(ctx, { rng: this.rng.fork() }).build();
    this.strafe = new Strafe(ctx, { rng: this.rng.fork() }).build();
    /**
     * THE ARMOUR — "そんで戦車イベントを早く追加しろ 総力上げて".
     *
     * A fourth event on the same shape as the other three (`build()` at boot,
     * `update(dt, live)`, `armRound`/`disarm`/`reset`, a reused announce record)
     * and one that is deliberately NOT in the others' `coBusy`: a sortie lasts
     * about a minute, and standing the whole sky down for it would turn the
     * tank into a minute of silence. The reverse IS true — see below — because
     * rolling a tank out under an inbound salvo is two telegraphs at once.
     */
    this.tank = new Armour(ctx, { rng: this.rng.fork() }).build();
    this.air = [this.airstrike, this.bomber, this.strafe, this.tank];
    // Each stands down while EITHER of the other two has something in the air.
    this.airstrike.coBusy = [this.bomber, this.strafe];
    this.bomber.coBusy = [this.airstrike, this.strafe];
    this.strafe.coBusy = [this.airstrike, this.bomber];
    this.tank.coBusy = [this.airstrike, this.bomber, this.strafe];
    /**
     * WHO THE CREW CAN SEE. `match` owns the roster, so the tank never reads
     * `ai` — it asks for a list and gets live, targetable hostiles of the other
     * side, the local player included on exactly the same terms (spawn
     * protection is `ai.targetable`, which takes the human as happily as it
     * takes an Agent).
     */
    /**
     * THE REINFORCEMENT DROP — the fifth thing in the sky, and the only one that
     * is not a weapon. @see src/match/reinforce.js for the aircraft and the
     * fall, `_updateReinforcements` for when, and `RULES.reinforceDeficit` for
     * why the trigger is the SCORE GAP and not `_matchProgress`.
     *
     * It is deliberately NOT in `this.air`: it has no `armRound`, it takes no
     * `setFocus` (its target is a held zone, not the centroid of the fight), and
     * it must not appear in any other system's `coBusy` or a sixty-second-long
     * comeback would stand the whole sky down. The one-way courtesy — it waits
     * for clear air, nothing waits for it — is in `_updateReinforcements`.
     */
    this.reinforce = new Reinforcements(ctx, { rng: this.rng.fork() }).build();
    this.reinforce.onLand = (i, p, yaw) =>
      this._landReinforcement(this._reinforceTeam, i, p, yaw);
    this.reinforce.onAnnounce = (info) => this._announceReinforce(info);
    /** Drops spent, per team. @see `RULES.reinforceMaxPerTeam`. */
    this._reinforceUsed = [0, 0];
    /** Whose sortie is in the air. Read by `onLand`, which is per man. */
    this._reinforceTeam = -1;
    this._reinforcePoll = RULES.reinforcePoll;
    /**
     * REPORTED, NOT GAMEPLAY, and it exists because the brief asks a question
     * that cannot be answered from the rules: how often does it actually fire,
     * for which side, at what score, and did it change the result.
     * `windows` counts polls at which a side QUALIFIED — the gap between it and
     * `calls` is what `reinforceChance` is doing.
     */
    this.reinforceStats = {
      calls: 0, windows: [0, 0], landed: [0, 0], lost: [0, 0], at: [],
    };
    if (typeof window !== 'undefined') window.__REINFORCE__ = this.reinforce;

    this.tank.enemies = (team, out) => this._tankEnemies(team, out);
    this.tank.onKill = (t, by) => this._onTankKill(t, by);
    /**
     * ──────────────────────────────────────────────────────────────────────
     * …AND THE OTHER DIRECTION, WHICH IS THE ONE NOBODY HAD WIRED
     * ──────────────────────────────────────────────────────────────────────
     * `tank.enemies` above tells the CREW who to shoot. Nothing told the
     * infantry, and `AiSystem.hostilesOf` builds its list from `ai.agents` plus
     * the local player — a tank is not an `Agent`, so it was in nobody's list
     * and `Agent.target` only ever comes from that list. Measured over three
     * matches: a tank appeared in a hostile list 0 times, a bot aimed at one 0
     * times across 273-321 man-samples inside `RULES.tankRange`, the `deck`
     * damage column was 0 in every row, and in 3 of 4 matches NEITHER HULL WAS
     * EVER DESTROYED while scoring 12-27 kills apiece. Bots treated a tank as
     * scenery because nothing had ever shown them one.
     *
     * The LIVE ARRAY is handed over rather than copied per round: every hull's
     * own `alive` flag is exactly "out of its pocket and shootable", and
     * `hostilesOf` reads it. So there is nothing to keep in step — `_roll`,
     * `_park`, `_destroy` and `reset` already move the only bit that matters.
     * `ai` owns what it does with them (`AiSystem.armourWorth`); `match` owns
     * only the fact that these two objects are on the map.
     */
    this.ai.vehicles = this.tank.tanks;
    /**
     * THE ANNOUNCEMENT, and the reason it is wired here rather than inside the
     * three weapons.
     *
     * `ui` is `match`'s to drive (see the ownership map in ARCHITECTURE.md), so
     * every HUD call in this feature lands in one method in one file and the air
     * systems stay pure gameplay — they hand over a reused record and do not
     * know a HUD exists. @see `_announceAir`
     */
    for (const a of this.air) {
      a.onAnnounce = (info) => this._announceAir(info);
      a.onImpact = (info) => this._airLanded(info);
    }
    if (typeof window !== 'undefined') {
      window.__STRIKE__ = this.airstrike;
      window.__BOMBER__ = this.bomber;
      window.__STRAFE__ = this.strafe;
      window.__TANK__ = this.tank;
    }

    /* ---- scratch ------------------------------------------------------- */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._bombPos = new THREE.Vector3();
    /**
     * THE POINT A SHELL DOES ITS DAMAGE FROM, which is not the point it craters.
     *
     * `RULES.blastBurstHeight` above `_bombPos`, and it is a SECOND vector on
     * purpose: the scorch, the haze and the flash want the impact and every
     * occlusion ray wants head height, and one vector cannot be both. @see
     * `RULES.blastBurstHeight` for the measurement that made this necessary.
     */
    this._blastPos = new THREE.Vector3();
    this._prompt = { key: 'F', text: '', sub: '', progress: 0 };
    this._objectives = [];
    this._squad = [];
    this._hud = {
      phase: PHASE.WARMUP,
      round: 0,
      maxRounds: RULES.maxRounds,
      score: this.score,
      teamName: TEAM_NAME,
      teamColor: TEAM_COLOR,
      playerTeam: this.playerTeam,
      role: ROLE.ATTACK,
      clock: 0,
      bombState: BOMB.CARRIED,
      bombFuse: 0,
      bombSite: '',
      carrying: false,
      aliveUs: 0,
      aliveThem: 0,
      rosterUs: RULES.teamSize,
      rosterThem: RULES.teamSize,
      alert: '',
      spectating: '',
      dead: false,
      /** 0..1 on whatever is currently being planted or defused. */
      progress: 0,
      /** '' | 'plant' | 'defuse' | 'plant-player' | 'defuse-player' */
      working: '',
      roster: this.roster,
      /* ---- domination ---- */
      /** 'domination' | 'demolition'. `ui` branches the HUD on this. */
      mode: RULES.mode,
      scoreTarget: RULES.scoreTarget,
      /**
       * ONE RECORD PER ZONE, ALLOCATED ONCE AND WRITTEN IN PLACE.
       *
       * `ui` reads this array every frame and must never retain it. `mine` and
       * `theirs` are from the LOCAL player's point of view, because a HUD that
       * makes you work out which of RED and BLUE you are is a HUD you misread
       * under fire.
       */
      zones: this.sites.map((z) => this._zoneHudRecord(z)),
      /** How many zones each side holds, player's point of view. */
      ownedUs: 0,
      ownedThem: 0,
    };
    this._hud.respawnIn = 0;
    /**
     * THE CACHE HUD, and the beacon's clock. Allocated once; `ui` reads it every
     * frame and must never retain it. @see `_updateCacheUse`
     */
    this._hud.cache = { near: '', kind: '', hold: 0, ready: true, cooldown: 0, grenadeCooldown: 0 };
    this._hud.beacon = { active: false, mine: false, seconds: 0, cooldown: 0, at: '' };
    /** So the beacon strip can scale its bar without importing RULES. */
    this._hud.beaconLife = RULES.beaconTime;
    /**
     * THE CACHES THE PLAYER CAN SEE, for `ui.setCaches`. Allocated once: six
     * view records and the six-slot window `Caches.nearby` sorts into. `ui`
     * reads them every frame and must never retain them. @see `_publishCaches`
     */
    this._cacheNear = new Array(6).fill(null);
    /**
     * The records live HERE and the published array only ever holds references
     * to them. `_cacheView.length = n` is how the list is shortened, and an
     * array whose own elements were the records lost them the first time the
     * count fell — the next frame with more caches in range then wrote through
     * `undefined` and threw, every frame, killing the rest of the match update
     * with it. Measured, not reasoned about: the first run of `_capui.mjs`
     * caught 130 identical `Cannot set properties of undefined` page errors.
     */
    this._cacheRecords = [];
    this._cacheView = [];
    for (let i = 0; i < 6; i++) {
      this._cacheRecords.push({
        id: '',
        kind: 'ammo',
        label: '',
        position: null,
        ready: true,
        cooldown: 0,
        inReach: false,
      });
    }
    /**
     * The cache prompt is its OWN reused object rather than `_prompt`, which the
     * demolition branch also writes: it carries two extra fields (`hold` and the
     * `alt` row) and a stale one of those on a C4 prompt would draw a beacon
     * line under "DEFUSE C4". One object per branch, no shared state.
     */
    this._cachePrompt = { key: 'F', text: '', sub: '', progress: 0, hold: true, alt: null };
    /** The second row: TAP plants the beacon. Reused. */
    this._promptAlt = { key: 'F', text: '', sub: '', hold: false };
    this._interact = { held: 0, kind: null };
    /**
     * HOLD vs TAP on the ONE interaction key. `held` is seconds the key has been
     * down at the current cache, `done` latches the hold so it fires once, and
     * `at` is the cache the press started on — walking off a cache mid-hold has
     * to cancel it rather than give you the next one's contents.
     */
    this._cacheUse = { held: 0, done: false, at: null, wasDown: false };
    this._playerWasDead = false;
    /** Scratch for `_safeSpawn`, which runs on a respawn and must not allocate. */
    this._spawnPick = new THREE.Vector3();
    this._playerLastAttacker = null;
    this._objectiveTimer = 0;
    /** The attacker tasked with fetching a dropped charge. */
    this._fetcher = null;
    /** The defenders told to cut the charge. Reused; see `_nearestInto`. */
    this._crew = [];
    this._crewDist = [];
    /**
     * Who is taking the long way round, and how far through it they are.
     * Agent -> the time they were given the order, or -1 once they have been.
     * Cleared every round and pruned with the bodies, so it never holds a
     * ragdoll alive. @see `_flankTarget`
     */
    this._flankLeg = new Map();
    /**
     * DOMINATION OBJECTIVE SCRATCH, all preallocated: `_assignDomination` runs
     * every two seconds over thirty actors and must not allocate.
     *   _live   the live bots of the side being tasked
     *   _taken  parallel to `_live`; true once that man has a zone
     *   _plan   one record per zone, rewritten in place each refresh
     */
    this._live = [];
    this._taken = [];
    this._plan = this.sites.map((z) => ({ zone: z, mode: 'hold', want: 0, prio: 0, filled: 0 }));
    /** Plan records the spare men are spread over. @see `_assignDomination` */
    this._spare = [];
    /**
     * Walks the standing ring for men who have reported they cannot reach the
     * point they were given. One counter for the whole match: it only has to
     * produce a DIFFERENT point each refresh, not a fair one. @see `_orderZone`
     */
    this._zoneRotate = 0;
    /**
     * The ONE zone each side is currently trying to take. Sticky across the two
     * second refresh, or a side re-cuts its target every two seconds and arrives
     * nowhere in strength. Cleared with the match.
     */
    this._focus = [null, null];
    /** Where each side comes from, so a held position is actually watched. */
    this._approach = [new THREE.Vector3(), new THREE.Vector3()];
    /** The centre of the fight, handed to the three air systems. @see `_updateAirFocus` */
    this._airFocus = new THREE.Vector3();
    this._airFocusTimer = 0;
    /* ---- the scheduled map changes. @see `_updateMapEvents` ---- */
    /** The one authored `locked` zone (D), or null. It never leaves `allZones`. */
    this.lockedZone = this.allZones.find((z) => z.locked) ?? null;
    this._cathedralCalled = false;
    /**
     * ───────────────────────────────────────────────────────────────────────
     * THE CATHEDRAL EVENT'S OWN CLOCK. `t` counts UP from the warning; `beat`
     * is how many entries of the beat sheet have been played; `shot` is how many
     * barrage shells have landed. -1 is "not running".
     * ───────────────────────────────────────────────────────────────────────
     * ONE CLOCK, NOT THREE COUNTDOWNS, and that is the fix rather than a
     * refactor. `_cathedralPending` and `_razeIn` were independent and both
     * started when the salvo was CALLED, so the shell swapped 2.2 s after the
     * call and the salvo landed 4.4 s after it — the building came down two and
     * a half seconds BEFORE the first bomb. @see `RULES.cathedralRazeDelay`.
     */
    this._cath = { t: -1, beat: 0, shot: 0 };
    /**
     * THE BARRAGE'S AIMING POINTS, SOLVED ONCE AT BOOT.
     *
     * Twenty shells walking the nave is twenty world positions, and not one of
     * them may be computed in the frame it is fired — the same discipline the
     * salvo's fracture is baked under. They are stored as OFFSETS on the
     * cathedral's own two axes rather than as world points, because the zone
     * record they are relative to is resolved after this and the axes are two
     * `levelToWorld` calls. `_cathAim` writes the world point into `_bombPos`.
     */
    this._cathU = new Float32Array(RULES.cathedralBarrageShells);
    this._cathV = new Float32Array(RULES.cathedralBarrageShells);
    /** The level's +x and +z as world directions. Filled in `_bakeCathedralBarrage`. */
    this._cathAxisU = new THREE.Vector3(1, 0, 0);
    this._cathAxisV = new THREE.Vector3(0, 0, 1);
    /** How many of `RULES.districtSalvoProgress` have been spent. @see `_updateMapEvents` */
    this._districtsFired = 0;
    /** Seconds still owed before the next big event may be called. */
    this._districtGap = 0;
    this._finalCalled = false;
    this._finalLeft = 0;
    this._bombardIn = RULES.zoneBombardFirst;
    /** The live bombardment: which zone, the lead left, how many have landed. */
    this._bombard = { zone: null, t: 0, shot: 0 };
    /** Reused `explosion` payload for the bombardment. Listeners copy out of it. */
    this._blast = { position: null, radius: 0, damage: 0, source: null };
    /** Reused `ui.airAlert` argument — the HUD copies out of it synchronously. */
    this._airHud = {
      kind: 'STRIKE',
      title: '',
      impactTitle: '',
      name: '',
      x: 0,
      y: 0,
      z: 0,
      lead: 0,
    };
    this._bakeCathedralBarrage();

    /* ---- events -------------------------------------------------------- */
    this._offs = [];
    const on = (t, fn) => this._offs.push(ctx.events.on(t, fn));
    on('actor:death', (e) => this._onActorDeath(e));
    on('player:death', () => this._onPlayerDeath());
    // `player:death` carries no shooter, so remember the last thing that hurt us.
    on('damage:dealt', (e) => {
      if (!e || !this._isPlayer(e.target)) return;
      this._playerLastAttacker = e.source ?? null;
    });

    if (this.domination) {
      console.info(
        `[match] SUDDEN CLAUDE — DOMINATION ${RULES.teamSize}v${RULES.teamSize} · ` +
          `${this.sites.length} zones (${this.sites.map((z) => z.id).join('/')}) · ` +
          `first to ${RULES.scoreTarget} · ${RULES.scorePerZone} pts per zone every ` +
          `${RULES.scoreInterval}s · ${RULES.matchTime | 0}s clock · capture ` +
          `${RULES.captureTime}s solo, r${RULES.captureRadius} · respawn ` +
          `${RULES.respawnDelay}s, forward spawns on held zones`
      );
    } else {
      console.info(
        `[match] SUDDEN CLAUDE — demolition ${RULES.teamSize}v${RULES.teamSize}, ` +
          `${RULES.roundTime | 0}s rounds, first to ${RULES.roundsToWin}, ` +
          `sides swap after round ${RULES.swapAfterRound}` +
          (RULES.respawns
            ? ` · respawn ${RULES.respawnDelay}s, closes at ${RULES.respawnCutoff}s or on the plant`
            : ' · one life')
      );
    }
  }

  /** Compile the C4's materials before the frame loop — see src/core/prewarm.js. */
  async prewarmMaterials(ctx = this.ctx) {
    const render = ctx.peek('render');
    const renderer = render?.renderer;
    if (!renderer || !this.bomb) return { ok: false, reason: 'no renderer' };
    const before = renderer.info.programs?.length ?? 0;
    const scene = new THREE.Scene();
    const wasVisible = this.bomb.group.visible;
    this.bomb.group.visible = true;
    scene.add(this.bomb.group);
    /**
     * One pouch has to be VISIBLE for this to be worth anything: three's
     * `compile()` walks the scene with `traverseVisible`, and every drop in the
     * pool starts hidden. Without this the first man to die in the first round
     * compiles two materials on that frame.
     */
    const drop = this.ammoDrops?.slots?.[0]?.mesh ?? null;
    const dropWasVisible = drop?.visible ?? false;
    if (drop) {
      drop.visible = true;
      scene.add(this.ammoDrops.group);
    }
    try {
      await renderer.compileAsync(scene, ctx.camera, ctx.scene);
      const depth = render.csm?.depthMaterial;
      if (depth) {
        const prev = scene.overrideMaterial;
        scene.overrideMaterial = depth;
        await renderer.compileAsync(scene, ctx.camera, ctx.scene);
        scene.overrideMaterial = prev;
      }
    } catch {
      /* a driver we cannot pre-warm on; boot must still proceed */
    }
    scene.remove(this.bomb.group);
    ctx.scene.add(this.bomb.group);
    this.bomb.group.visible = wasVisible;
    if (drop) {
      scene.remove(this.ammoDrops.group);
      ctx.scene.add(this.ammoDrops.group);
      drop.visible = dropWasVisible;
    }
    return { ok: true, compiled: (renderer.info.programs?.length ?? 0) - before };
  }

  /* ==================================================================== */
  /* accessors                                                            */
  /* ==================================================================== */

  get attackers() {
    return attackingTeam(Math.max(1, this.round));
  }

  get defenders() {
    return 1 - this.attackers;
  }

  get playerRole() {
    return this.attackers === this.playerTeam ? ROLE.ATTACK : ROLE.DEFEND;
  }

  aliveCount(team) {
    let n = 0;
    for (const r of this.roster) if (r.team === team && r.alive) n++;
    return n;
  }

  _rosterSize(team) {
    let n = 0;
    for (const r of this.roster) if (r.team === team) n++;
    return n || RULES.teamSize;
  }

  /* ==================================================================== */
  /* round lifecycle                                                      */
  /* ==================================================================== */

  _beginRound() {
    this.round++;
    const atk = this.attackers;
    const def = this.defenders;
    this.roundClock = this.domination ? RULES.matchTime : RULES.roundTime;
    this.result = null;
    this._interact.held = 0;

    // ---- rebuild both sides ------------------------------------------
    this.ai.clearAgents();
    this.roster.length = 0;
    this._botsByTeam[0].length = 0;
    this._botsByTeam[1].length = 0;
    this._respawnQueue.length = 0;

    // Attackers commit to one site; defenders split, weighted to the site the
    // attackers did NOT pick only by chance, because they do not know either.
    // DOMINATION has no target: every zone is everybody's.
    this.targetSite = this.domination
      ? null
      : this.sites[this.rng.int(0, this.sites.length - 1)];
    for (const s of this.sites) s.defenders.length = 0;
    this._flankLeg.clear();
    /**
     * Every zone back to NEUTRAL, and the paint with it. A match starts with the
     * map up for grabs — starting each side on its nearest zone would make the
     * opening a 1-1 stalemate and remove the one moment when all three are live.
     */
    if (this.capture) {
      /**
       * D GOES BACK IN ITS BOX. A new match starts with the cathedral standing,
       * so the fourth zone leaves the live list before `capture.reset` walks it
       * — and the three scheduled map events re-arm on the new clock.
       */
      if (this.lockedZone) this._setZoneLive(this.lockedZone, false);
      // …and the BUILDING goes back up with the zone. This is also the call that
      // hides the ruin scope for the first time on a fresh boot. @see
      // `_setCathedralRazed`.
      this._setCathedralRazed(false);
      this._cathedralCalled = false;
      this._cath.t = -1;
      this._cath.beat = 0;
      this._cath.shot = 0;
      this._districtsFired = 0;
      this._districtGap = 0;
      this._finalCalled = false;
      this._finalLeft = 0;
      this._bombardIn = RULES.zoneBombardFirst;
      this._bombard.zone = null;
      this._bombard.shot = 0;
      this.capture.reset(this.ctx.time.elapsed);
      for (const z of this.sites) this.marks.setOwner(z, -1);
      this._focus[0] = null;
      this._focus[1] = null;
      this._forwardSpawns[0] = 0;
      this._forwardSpawns[1] = 0;
      this._baseSpawns[0] = 0;
      this._baseSpawns[1] = 0;
    }

    this._spawnTeam(atk, ROLE.ATTACK);
    this._spawnTeam(def, ROLE.DEFEND);
    this._resetPlayer();

    // ---- the town is whole again --------------------------------------
    // Rest pose back in `instanceMatrix`, rubble back off the BVH mask and the
    // nav cells back to what `ai` built. All three are array writes.
    this.airstrike?.reset();
    // Same for the bomber, minus the collision and nav restore it never made:
    // a crater is a hole and a scatter of grit, so the BVH and `ai.grid` were
    // never touched and there is nothing to put back.
    this.bomber?.reset();
    this.strafe?.reset();
    // Both hulls back in their pockets, invisible, colliders off, wreck hidden.
    this.tank?.reset();
    /**
     * ──────────────────────────────────────────────────────────────────────
     * AND THE CACHE HOUSES GET THEIR WALLS BACK
     * ──────────────────────────────────────────────────────────────────────
     * `world.breachAll(down)` is documented as "the round reset, and
     * `?breach=down`" and NOTHING IN `match` HAS EVER CALLED IT — so the first
     * shell that took an elevation off a cache house took it off for the rest
     * of the SESSION, through every subsequent round and match. It is the exact
     * counterpart of the three lines above it and of `_setCathedralRazed(false)`
     * at the top of this method: the town is whole again, and that has to
     * include the six houses that hold `world.features`, because a breached
     * house is a house with one fewer reason to go indoors.
     *
     * `breachAll` is idempotent and returns how many it actually put back, so
     * the ordinary round — where nobody breached anything — is six boolean
     * compares and no log line.
     */
    const restored = this.world?.breachAll?.(false) ?? 0;
    if (restored) console.info(`[match] ${restored} breached wall(s) rebuilt for the new round`);
    /**
     * THE DROP GOES BACK IN ITS BOX WITH EVERYTHING ELSE. A new match is a new
     * scoreline, so both sides get their one sortie back — and any canopy still
     * in the air belongs to a match that no longer exists. `_reinforceUsed` is
     * the ceiling and `reinforceStats` is only reported, so it is left to
     * accumulate across a restart on purpose: a probe running several matches
     * wants the total.
     */
    this.reinforce?.reset();
    this._reinforceUsed[0] = 0;
    this._reinforceUsed[1] = 0;
    this._reinforceTeam = -1;
    this._reinforcePoll = RULES.reinforcePoll;

    // ---- the charge ---------------------------------------------------
    // Last round's pouches go with last round's bodies: `_resetPlayer` has
    // already refilled the reserve, so leaving them would be free ammunition
    // for a budget that is already full.
    this.ammoDrops.clear();
    // The charge is reset in both modes — in domination that is what keeps it
    // hidden and inert (state CARRIED, no carrier, group invisible) rather than
    // leaving a live object nobody drives.
    this.bomb.reset();
    if (!this.domination) {
      if (this.playerTeam === atk) {
        // The human gets the C4 when their side attacks: the mode is only
        // interesting if the objective is yours to carry.
        this.bomb.giveTo(this.player);
      } else {
        const carriers = this._botsByTeam[atk];
        this.bomb.giveTo(carriers[this.rng.int(0, Math.max(0, carriers.length - 1))] ?? null);
      }
    }
    this._assignObjectives();

    this._setPhase(PHASE.FREEZE, RULES.freeze);
    if (this.domination) {
      this.ui.banner.show(
        'DOMINATION',
        `CAPTURE ${this.sites.map((z) => z.id).join(' · ')} — FIRST TO ${RULES.scoreTarget}`,
        2.8
      );
    } else {
      const mine = this.playerRole === ROLE.ATTACK;
      this.ui.banner.show(
        `ROUND ${this.round}`,
        mine ? 'PLANT THE C4' : 'DEFEND BOTH SITES',
        2.4
      );
    }
    this.ctx.events.emit('match:round', {
      round: this.round,
      phase: this.phase,
      attackers: atk,
      score: this.score,
    });
    if (this.domination) {
      console.info(
        `[match] domination match live: ${TEAM_NAME[atk]} north base, ` +
          `${TEAM_NAME[def]} south base · all ${this.sites.length} zones neutral`
      );
    } else {
      console.info(
        `[match] round ${this.round}: ${TEAM_NAME[atk]} attack, ${TEAM_NAME[def]} defend · ` +
          `score ${this.score[0]}-${this.score[1]}`
      );
    }
  }

  _spawnTeam(team, role) {
    const spawns = role === ROLE.ATTACK ? this.spawns.attack : this.spawns.defend;
    const variants = TEAM_VARIANTS[team];
    const names = BOT_NAMES[team];
    const squad = this.ai.createSquad();
    squad.team = team;
    this._squads[team] = squad;

    // Slot 0 of the human's own team is the human. Bots fill the rest.
    const human = team === this.playerTeam;
    if (human) {
      this.roster.push({
        name: 'YOU', team, kills: 0, deaths: 0, alive: true, isPlayer: true, actor: this.player,
        /** Kept so a respawn can rebuild exactly this man. */
        role, variant: null, slot: 0,
      });
    }
    const bots = RULES.teamSize - (human ? 1 : 0);
    for (let i = 0; i < bots; i++) {
      const slot = i + (human ? 1 : 0);
      const sp = spawns[slot % spawns.length];
      this._jitterOnto(sp, this._v);
      const variant = variants[i % variants.length];
      const agent = this.ai.spawn(variant, this._v, sp.yaw, {
        team,
        name: names[slot % names.length],
        // Symmetric personalities in domination. @see AI_ROLE_FIELD
        role: this.domination ? AI_ROLE_FIELD : role,
      });
      squad.add(agent);
      this._stampSpawn(agent);
      this._botsByTeam[team].push(agent);
      this.roster.push({
        name: agent.name, team, kills: 0, deaths: 0, alive: true, isPlayer: false, actor: agent,
        role, variant, slot,
      });
    }
  }

  /**
   * When this man came into the round, on `match`'s own clock and on `match`'s
   * own field.
   *
   * A respawned bot is a NEW `Agent` (see `match:respawn` in ARCHITECTURE.md), so
   * there is nothing on the actor that survives a death and nothing in `src/ai`
   * that says how long somebody has been fighting. `_assignCacheLegs` needs
   * exactly that to decide who is worth sending to resupply, and `match` may not
   * add a field to `src/ai`'s class — so it stamps one on the instance it was
   * handed, underscore-prefixed to say whose it is.
   */
  _stampSpawn(agent) {
    if (!agent) return;
    agent._matchSpawnedAt = this.ctx.time.elapsed;
    agent._matchCache = null;
    agent._matchCacheUntil = 0;
    agent._matchCacheHeld = false;
  }

  /** A spawn point plus a metre of scatter, dropped onto the floor. */
  _jitterOnto(sp, out) {
    const a = this.rng.range(0, Math.PI * 2);
    const r = this.rng.range(0, 1.1);
    out.copy(sp.position).add(this._v2.set(Math.cos(a) * r, 0, Math.sin(a) * r));
    out.y = this.ai.groundAt(out.x, out.z, sp.position.y + 3);
    return out;
  }

  _resetPlayer() {
    const role = this.playerRole;
    const spawns = role === ROLE.ATTACK ? this.spawns.attack : this.spawns.defend;
    const sp = spawns[0];
    this.player.health.reset(true);
    this.player.setControlEnabled(true);
    this.player.respawnAt(sp.position, sp.yaw);
    this.weapons.resetAmmo();
    this.spectator.stop();
    this._playerWasDead = false;
  }

  /* ==================================================================== */
  /* respawns                                                             */
  /* ==================================================================== */

  /**
   * Is the respawn window open?
   *
   * Two gates, and both of them exist to protect the win condition rather than
   * the balance. Once the C4 is armed the fuse is the only clock and a defuse
   * has to be *possible*, which it is not against an attack that refills for
   * ever; and inside the last `respawnCutoff` seconds the round has to be able
   * to end, which it cannot while either side can replace a loss.
   */
  _respawnsOpen() {
    if (!RULES.respawns || this.phase !== PHASE.LIVE) return false;
    /**
     * DOMINATION: ALWAYS OPEN. Both gates below exist to protect a win condition
     * domination does not have — there is no charge to make undefusable and no
     * elimination to reach, and a side with nobody alive is already losing three
     * points every four seconds. Closing respawns here would only mean the last
     * forty-five seconds of a decided match are played 15 v 3.
     */
    if (this.domination) return true;
    return !this.bomb.armed && this.roundClock > RULES.respawnCutoff;
  }

  /** Men of `team` waiting to come back. Reads as "not eliminated yet". */
  _queuedFor(team) {
    let n = 0;
    for (const q of this._respawnQueue) if (q.rec.team === team) n++;
    return n;
  }

  /**
   * Put a dead roster record in the queue. Called from both death paths, which
   * is the whole reason bots and the human respawn on identical rules: there is
   * one queue and one timer, and neither of them knows which is which.
   */
  _queueRespawn(rec) {
    if (!rec || rec.alive) return;
    /**
     * ────────────────────────────────────────────────────────────────────────
     * A REINFORCEMENT DOES NOT COME BACK — "その１０人はリスポーンしない"
     * ────────────────────────────────────────────────────────────────────────
     * ONE LINE, AND IT IS DELIBERATELY IN THIS METHOD RATHER THAN IN
     * `_safeSpawn`. `_safeSpawn` answers WHERE a man returns and has three tiers
     * of its own to get right; the question here is WHETHER, and it is a
     * property of the MAN. `rec.noRespawn` is written once when he is created
     * (`_landReinforcement`) and read here, which is the single gate BOTH death
     * paths already pass through — the bot's and the human's, on one queue and
     * one timer, which is the whole reason this method exists.
     *
     * So there is no branch anywhere else that could disagree with it: he is not
     * queued, so `_updateRespawns` cannot reach him, so `_respawnBot` cannot be
     * called for him, so no tier of `_safeSpawn` is ever consulted. He is on the
     * scoreboard as a dead man for the rest of the match, which is exactly what
     * "形勢逆転要素なだけで、リスポーンなし" describes.
     */
    if (rec.noRespawn) {
      this.reinforceStats.lost[rec.team]++;
      return;
    }
    if (!this._respawnsOpen()) return;
    for (const q of this._respawnQueue) if (q.rec === rec) return;
    this._respawnQueue.push({ rec, at: this.ctx.time.elapsed + RULES.respawnDelay });
  }

  _updateRespawns() {
    const q = this._respawnQueue;
    if (!q.length) return;
    // The window can close while men are already queued (the charge goes down,
    // the clock runs under the cutoff). Those men stay dead — that is the point
    // of the cutoff, and dropping the queue here is what lets the round end.
    if (!this._respawnsOpen()) {
      q.length = 0;
      return;
    }
    const now = this.ctx.time.elapsed;
    let changed = false;
    for (let i = q.length - 1; i >= 0; i--) {
      if (q[i].at > now) continue;
      const rec = q[i].rec;
      q.splice(i, 1);
      if (rec.isPlayer) this._respawnPlayer(rec);
      else this._respawnBot(rec);
      changed = true;
    }
    if (changed) {
      this._pruneDead();
      this._assignObjectives();
    }
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * WHERE A MAN COMES BACK: THREE TIERS IN PREFERENCE ORDER, NOT ONE AUCTION
   * ────────────────────────────────────────────────────────────────────────
   * "ビーコン／占領地点からのリスポーンの修正". Both features were plumbed
   * correctly and neither was ever CHOSEN, and the reason is that this used to
   * be a single `max` over one number:
   *
   *   base point     nearestFoeDist + rand(0, 6)
   *   forward point  nearestFoeDist + forwardSpawnBias + rand(0, 6)
   *   beacon         nearestFoeDist + forwardSpawnBias + rand(0, 6)
   *
   * Every term is metres, so the comparison was literally "is the capture point
   * I am holding further from the enemy than my own back line, plus 34 m of
   * thumb". A base cluster sits at the back of the map and measures 90-130 m to
   * the nearest live enemy; a point you hold is where the fighting is and
   * measures 8-40 m. 34 m does not close a 70-100 m gap. MEASURED (`_spawnprobe.mjs`):
   *
   *   BLUE holding C and B, all 14 stand points clear of the block radius,
   *     best base 107.5 m vs best forward 39.1 m -> 0 of 14 beat the base.
   *   A beacon planted, active, 23.9 m from the nearest enemy: chosen
   *     0 times in 200 respawns. `stats.beaconSpawns` 0 across whole matches.
   *
   * The one case that DID pick a forward point was an enemy leaking to within
   * 12 m of the base cluster — i.e. the feature only fired when the base was the
   * dangerous option, which is backwards. That is why the behaviour read as
   * random: RED took 30 % of its respawns forward and BLUE 93.8 % in the same
   * match, decided entirely by where the front happened to sit relative to each
   * base, and not at all by what either side held.
   *
   * So the choice is now an ORDER and the distance is only a veto and a
   * tie-break inside a tier. This is what the brief has said all along —
   * "サイトを占領するとそこからリスポーン可能で、奪われたら既定のリスポーン位置からの
   * スポーンのみ": holding it IS the spawn, losing it IS the fallback.
   *
   *   1. THE BEACON. One per side, 30 s, `beaconCooldown` between plants, and a
   *      deliberate act by the player. If it is live and clear it wins — a
   *      thing you spend a cooldown on and then never spawn at is not a feature.
   *   2. A ZONE YOU OWN, safest clear standing point first.
   *   3. THE BASE CLUSTER, unchanged, and always reachable as the fallback.
   *
   * `RULES.forwardSpawnBlockRadius` still vetoes an individual point with a live
   * enemy on it, and a tier with every point vetoed falls through to the next —
   * so a zone being overrun stops being a spawn, gradually and per point, which
   * is the gradient the old code was reaching for. `RULES.respawnSafeRadius`
   * remains a report threshold only: the best of a bad set is still used,
   * because a delayed respawn is worse than a contested one.
   */
  _safeSpawn(team, role, outYaw) {
    let best = null;
    let forward = null;
    let beacon = false;

    /**
     * TIER 1 — THE BEACON. "テンポラリーリスポーン地点としてのビーコンを起動できる（３０秒間）".
     *
     * THE EXPIRY IS TESTED HERE, at the moment of the respawn, exactly as
     * `z.owner === team` is below. `Caches.update` clears the flag on the frame
     * it runs out, but a respawn that lands in the same frame must not be able
     * to use a beacon whose thirty seconds are gone — so the clock is read, not
     * the flag alone. That is the difference between "expires" and "expires,
     * eventually".
     */
    const bc = this.caches?.beacon;
    if (this.domination && bc && bc.active && bc.team === team && this.ctx.time.elapsed < bc.until) {
      if (this._nearestFoeDist(team, bc.position) >= RULES.forwardSpawnBlockRadius) {
        best = bc;
        beacon = true;
      }
    }

    /**
     * TIER 2 — A ZONE THIS SIDE OWNS.
     *
     * The ONLY ownership test is `z.owner === team`, evaluated at the moment of
     * the respawn. That is what makes losing a zone remove the option
     * immediately and with no bookkeeping: there is no cached spawn list to
     * invalidate, so there is no window in which somebody can be dropped into a
     * point his side no longer holds. A neutral zone is not a spawn either.
     *
     * Inside the tier the score is the old one — furthest from the nearest live
     * enemy, plus a random tie-break so fifteen men do not queue on one square.
     * It is only ever compared against OTHER forward points now, which is the
     * comparison it was always fair for.
     */
    if (!best && this.domination) {
      let bestScore = -Infinity;
      for (const z of this.sites) {
        if (z.owner !== team) continue;
        for (const sp of z.spawnFor[team]) {
          const d = this._nearestFoeDist(team, sp.position);
          // Owning the zone is not the same as it being safe this second.
          if (d < RULES.forwardSpawnBlockRadius) continue;
          const score = d + this.rng.range(0, 6);
          if (score <= bestScore) continue;
          bestScore = score;
          best = sp;
          forward = z;
        }
      }
    }

    /**
     * TIER 3 — THE BASE CLUSTER, and the reason nothing above needs a guard.
     * With twenty-one points spread over a 13 x 15 m pocket the emptiest-point
     * choice is a real one rather than a formality. It was fifteen points in
     * 13 x 10 m for the 15v15 and it grew with `RULES.teamSize`, at the SAME
     * points-per-square-metre — a cluster that has fewer stand points than the
     * side has men is a cluster with no empty point to find. @see `SPAWNS` in
     * src/match/sites.js.
     */
    if (!best) {
      const spawns = role === ROLE.ATTACK ? this.spawns.attack : this.spawns.defend;
      best = spawns[0];
      let bestScore = -Infinity;
      for (const sp of spawns) {
        const score = this._nearestFoeDist(team, sp.position) + this.rng.range(0, 6);
        if (score > bestScore) {
          bestScore = score;
          best = sp;
        }
      }
    }
    if (beacon) {
      bc.used++;
      this.caches.stats.beaconSpawns++;
      this._forwardSpawns[team]++;
    } else if (forward) this._forwardSpawns[team]++;
    else if (this.domination) this._baseSpawns[team]++;
    outYaw.yaw = best.yaw;
    outYaw.zone = beacon ? 'BEACON' : forward ? forward.id : '';
    outYaw.beacon = beacon;
    return this._jitterOnto(best, this._spawnPick);
  }

  /**
   * Metres to the nearest LIVE enemy of `team`, including the human.
   *
   * Linear rather than the squared distance this used to compare, because it is
   * tested against `RULES.forwardSpawnBlockRadius` and added to a metres-wide
   * tie-break jitter, and all three have to be in the same units. (It was
   * introduced for a `forwardSpawnBias` that no longer exists — @see `_safeSpawn`
   * — but the veto and the jitter still need real metres.) `max` over a
   * monotonic function is the same `max`, so the choice between base points is
   * unchanged; only the tie-break jitter is 6 m rather than 6 m of squared
   * distance.
   */
  _nearestFoeDist(team, p) {
    let nearest = Infinity;
    for (const f of this._botsByTeam[1 - team]) {
      if (!f.alive) continue;
      const d = f.position.distanceToSquared(p);
      if (d < nearest) nearest = d;
    }
    if (this.playerTeam !== team && !this.player.dead) {
      const d = this.player.position.distanceToSquared(p);
      if (d < nearest) nearest = d;
    }
    return nearest === Infinity ? 1e4 : Math.sqrt(nearest);
  }

  _respawnBot(rec) {
    const team = rec.team;
    const role = roleOf(team, this.round);
    const yawOut = this._yawOut ?? (this._yawOut = { yaw: 0, zone: '' });
    const pos = this._safeSpawn(team, role, yawOut);
    const agent = this.ai.spawn(rec.variant ?? TEAM_VARIANTS[team][0], pos, yawOut.yaw, {
      team,
      name: rec.name,
      // Must match `_spawnTeam` or a respawn draws a DIFFERENT man: the persona
      // cache is keyed on team + callsign + role. @see AI_ROLE_FIELD
      role: this.domination ? AI_ROLE_FIELD : role,
    });
    this._squads[team]?.add(agent);
    this._stampSpawn(agent);
    this._botsByTeam[team].push(agent);
    rec.actor = agent;
    rec.alive = true;
    this.ai.protect(agent, RULES.spawnProtect);
    this.ctx.events.emit('match:respawn', { name: rec.name, team, isPlayer: false });
  }

  _respawnPlayer(rec) {
    const role = this.playerRole;
    const yawOut = this._yawOut ?? (this._yawOut = { yaw: 0, zone: '' });
    const pos = this._safeSpawn(this.playerTeam, role, yawOut);
    this.spectator.stop();
    this.player.respawnAt(pos, yawOut.yaw);
    this.player.setControlEnabled(true);
    this.weapons.resetAmmo();
    rec.alive = true;
    this._playerWasDead = false;
    this.ai.protect(this.player, RULES.spawnProtect);
    this.ui.banner.show(
      yawOut.beacon ? 'RESPAWN — BEACON' : yawOut.zone ? `RESPAWN — ZONE ${yawOut.zone}` : 'RESPAWN',
      `${RULES.spawnProtect | 0}S PROTECTED`,
      1.6
    );
    this.ctx.events.emit('match:respawn', { name: rec.name, team: this.playerTeam, isPlayer: true });
  }

  /**
   * Drop corpses out of the per-team lists.
   *
   * `_botsByTeam` is walked every frame by objective assignment, the defuse
   * search and `_safeSpawn`; over a five minute round with respawns it would
   * otherwise grow to every body that has ever fallen. The Agent objects
   * themselves are reaped by `ai` (see `ai.corpseLimit`); this is only the
   * match's own bookkeeping.
   */
  _pruneDead() {
    for (const list of this._botsByTeam) {
      let w = 0;
      for (let i = 0; i < list.length; i++) if (list[i].alive) list[w++] = list[i];
      list.length = w;
    }
    for (const s of this._squads) s?.prune();
    // A dead flanker's entry would keep his ragdoll referenced for the round.
    if (this._flankLeg.size) {
      for (const a of this._flankLeg.keys()) if (!a.alive) this._flankLeg.delete(a);
    }
  }

  /**
   * Hand every bot the thing it should be walking toward. Called at round start
   * and again whenever the objective moves (plant, drop, pickup), and on a two
   * second timer.
   */
  _assignObjectives() {
    if (this.domination) {
      this._assignDomination(0);
      this._assignDomination(1);
      return;
    }
    this._assignDemolition();
  }

  /**
   * ────────────────────────────────────────────────────────────────────────────
   * DOMINATION: WHAT ONE SIDE'S FIFTEEN MEN ARE DOING
   * ────────────────────────────────────────────────────────────────────────────
   * Called for each team independently, so both sides play the mode — there is
   * no "the bots defend and the player attacks" asymmetry left anywhere in here.
   *
   * Three steps, and the order is the whole design:
   *
   *  1. SCORE EVERY ZONE by how badly this side needs bodies in it. A zone of
   *     ours with an enemy standing in it is the most urgent thing on the map,
   *     because it is the only way to LOSE points that are already coming in; a
   *     neutral zone is next, because it is free; an enemy zone after that, and
   *     it is worth more when we are behind, which is the "rotate when the score
   *     demands it" rule; and a quiet zone of ours only wants a garrison.
   *
   *  2. FILL THE SLOTS NEAREST-FIRST. For each zone in priority order, take the
   *     closest man who has not been given a job yet. That is what makes "take
   *     the nearest uncaptured point" true without ever writing it down: the man
   *     already beside C is the man C gets.
   *
   *  3. THE VERB. Two of them, and they are `src/ai`'s words, not new ones —
   *     `match` may not add behaviour to `src/ai`, only drive it.
   *
   *       TAKE / CONTEST -> `'defuse'`, aimed at one of the zone's STANDING
   *         POINTS. `Agent._advance` treats a non-anchored objective as a single
   *         destination with a 1 m arrival radius, and `_combat`'s urgency table
   *         gives `'defuse'` a 2.5 s break-off — so the man walks onto the point,
   *         stands on it, and leaves a firefight to do it. That is exactly the
   *         behaviour a capture needs, and it is why the objective is a standing
   *         point rather than the centre: `sites.js` proves every standing point
   *         is inside the capture radius and reachable from both bases, so a bot
   *         that ARRIVES is a bot that is CAPTURING. Fifteen men handed the
   *         centre would instead scrum at the edge of one square.
   *
   *       GARRISON -> `'hold'`, aimed at the zone centre with the enemy base as
   *         the facing. That is the sector-roam path (`Agent._pickHoldSpot`), so
   *         a garrison spreads over the courtyard and its mouths instead of
   *         standing on the paint. A holder does not need to be inside the circle
   *         — ownership does not decay — he needs to be able to shoot whoever
   *         walks into it, and the moment somebody does the zone becomes
   *         contested and step 1 turns those men into contesters.
   *
   * Everything here writes into preallocated arrays. @see `_live` / `_plan`
   */
  _assignDomination(team) {
    const live = this._live;
    const taken = this._taken;
    live.length = 0;
    for (const a of this._botsByTeam[team]) if (a.alive) live.push(a);
    if (!live.length) return;
    taken.length = live.length;
    for (let i = 0; i < live.length; i++) taken[i] = false;

    const foe = 1 - team;
    /**
     * Where the enemy arrives from, handed to every garrison as its facing so
     * `Agent._pickHoldSpot` knows which side of the zone is "forward". Each side
     * keeps one base all match, so this is a constant per team.
     */
    const face = this._spawnCentre[team === this.attackers ? 'defend' : 'attack'];
    const behind = this.score[team] < this.score[foe];
    const owned = this.capture.ownedBy(team);
    /** Two of three is the lead worth defending; below it, go and get one. */
    const majority = Math.floor(this.sites.length / 2) + 1;
    const ahead = owned >= majority;

    /* ---- 1a. ONE zone to take, not two ------------------------------- */
    /**
     * MEASURED, and it is the difference between a mode and a deadlock.
     *
     * The first version scored both enemy zones the same and filled their slots
     * nearest-first, which split a fifteen-man side seven and seven. Seven men
     * arriving in ones and twos across sixty metres never outnumbered the two
     * defenders already standing on the point, so the bar sat frozen on
     * CONTESTED and the zone never moved: 3-0 to the side that got the opening,
     * for a hundred and ten seconds, with both sides at full strength. From the
     * outside that is the mode not working.
     *
     * So a side that is not holding the majority picks ONE zone and puts the
     * bulk of itself on it, which is what a human team does and what actually
     * breaks a held point. `focus` is scored on the things that make a point
     * cheap — near our own base, thin on defenders, neutral rather than theirs,
     * and a bar we already have running — and it is STICKY, because the two
     * second refresh must not re-cut the team's target every two seconds.
     */
    const myBase = this._spawnCentre[team === this.attackers ? 'attack' : 'defend'];
    const last = this._focus[team];
    let focus = null;
    let focusScore = -Infinity;
    for (const z of this.sites) {
      if (z.owner === team) continue;
      let sc = -myBase.distanceTo(z.position) * 0.35;
      sc -= z.counts[foe] * 6;
      if (z.owner < 0) sc += 18;
      if (z.capTeam === team) sc += 14 + z.progress * 20;
      if (z === last) sc += 12;
      if (sc > focusScore) {
        focusScore = sc;
        focus = z;
      }
    }
    this._focus[team] = focus;

    /* ---- 1b. what each zone is worth --------------------------------- */
    const plan = this._plan;
    for (let i = 0; i < plan.length; i++) {
      const e = plan[i];
      const z = this.sites[i];
      e.zone = z;
      e.filled = 0;
      const mine = z.owner === team;
      const enemyIn = z.counts[foe] > 0;
      const beingTaken = z.capTeam === foe && z.progress > 0;
      if (mine && (enemyIn || beingTaken)) {
        // Ours and under threat. Nothing else on the map matters as much: it is
        // the only way to lose points that are already coming in.
        e.mode = 'defuse';
        e.want = 4 + Math.min(3, z.counts[foe]);
        e.prio = 140;
      } else if (mine) {
        e.mode = 'hold';
        e.want = RULES.zoneGarrison;
        e.prio = ahead ? 45 : 25;
      } else if (z === focus) {
        e.mode = 'defuse';
        e.want = 5 + Math.min(3, z.counts[foe]);
        e.prio = 120;
      } else {
        /**
         * The zone we are NOT going for still gets one man. Not for the capture
         * — one man against a garrison takes nothing — but so the side has eyes
         * on it, and so a point the enemy walks off is picked up for free
         * instead of sitting neutral for the rest of the match.
         */
        e.mode = 'defuse';
        e.want = 1;
        e.prio = 12 + (behind ? 6 : 0);
      }
    }
    // Insertion sort by priority, descending. Three elements; allocates nothing.
    for (let i = 1; i < plan.length; i++) {
      const e = plan[i];
      let j = i - 1;
      while (j >= 0 && plan[j].prio < e.prio) {
        plan[j + 1] = plan[j];
        j--;
      }
      plan[j + 1] = e;
    }

    /* ---- 2. and 3. nearest man to each slot, then the verb ------------ */
    let assigned = 0;
    for (const e of plan) {
      for (let k = 0; k < e.want && assigned < live.length; k++) {
        const pick = this._nearestFreeIndex(live, taken, e.zone.position, e.zone);
        if (pick < 0) break;
        taken[pick] = true;
        assigned++;
        this._orderZone(live[pick], e.zone, e.mode, e.filled++, face);
      }
    }
    /**
     * WHOEVER IS LEFT — and there are always eight or nine of them, because the
     * wants above deliberately add up to less than a side.
     *
     * A man with no objective falls through `Agent._think` to PATROL, which on
     * this map is a soldier wandering a street for no reason, so everybody gets
     * somewhere. WHERE depends on the score, and this is the "rotate when the
     * score demands it" rule in its most concrete form:
     *
     *   NOT holding the majority -> every spare man onto the FOCUS. Thirteen men
     *     on one point is what takes a point off a garrison; that is the whole
     *     reason `focus` exists.
     *   holding the majority -> spread over the zones we already own, so the
     *     lead is defended in depth instead of thrown at a third point we do not
     *     need. A side that is winning on points wins by not losing them.
     */
    if (assigned < live.length) {
      const spare = this._spare;
      spare.length = 0;
      if (ahead) {
        /**
         * The zones we own AND the focus, round-robined. MEASURED: with the
         * spares going only onto owned zones, the leading side put eight and then
         * eleven men inside two courtyards and one man on the third point, and
         * the match froze at 2-1 for two hundred seconds. Including the focus
         * keeps a third of the lead's spare strength pressing, which is what
         * makes the third zone change hands and the match have a middle.
         */
        for (const e of plan) if (e.zone.owner === team) spare.push(e);
        if (focus) for (const e of plan) if (e.zone === focus) spare.push(e);
      }
      if (!spare.length) {
        let e = plan[0];
        // No `find`: a closure every two seconds is still a closure.
        if (focus) for (const p of plan) if (p.zone === focus) e = p;
        spare.push(e);
      }
      let k = 0;
      for (let i = 0; i < live.length; i++) {
        if (taken[i]) continue;
        taken[i] = true;
        const e = spare[k++ % spare.length];
        this._orderZone(live[i], e.zone, e.mode, e.filled++, face);
      }
    }

    /**
     * …AND THEN SOME OF THEM GET SENT INSIDE. @see `_assignCacheLegs`
     * Last, deliberately: this RE-tasks men who already have a zone, so the
     * zone plan above is always complete first and a cache leg can only ever
     * take a man who was surplus to it.
     */
    this._assignCacheLegs(team, live, face);
  }

  /**
   * ────────────────────────────────────────────────────────────────────────────
   * THE REASON A BOT GOES INDOORS
   * ────────────────────────────────────────────────────────────────────────────
   * "もっと屋内戦闘をさせたいので屋内のエリアを作ってそこにもAIがいく利点やメリットを
   *  与えて でないとAIが屋内戦闘しない"
   *
   * THIS WAS WRITTEN ONCE BEFORE, MEASURED, AND REMOVED. The orders worked and
   * the number they existed to move went the WRONG WAY — bot time inside a
   * footprint 4.65 % -> 0.00 % — because `src/ai/nav.js` sampled every cell from
   * above and found the ROOF, so the only destination a "go to that cache" order
   * could offer was a square of street outside a door, and standing men there
   * took them off the ground they had been incidentally fighting over. The whole
   * history is in `caches.js`'s header. `NavGrid._carveInteriors` is the thing
   * that changed: the ground storeys are in the height field now, `prove()` snaps
   * each cache to a cell that is genuinely INSIDE its building, and this is the
   * same code with a destination that finally exists.
   *
   * TWO REASONS, AND THEY ARE DIFFERENT REASONS.
   *
   *  1. CONTEST — a bot-reachable cache within `CACHE_NEAR_ZONE` of a zone this
   *     side is fighting over (its focus, or one of ours with an enemy in it).
   *     This is the one that answers the complaint, and it is not a detour: a
   *     ground floor twenty metres off a capture point is a door onto that point
   *     with a wall in front of it. Sending two men through the building instead
   *     of eleven up the same street is what indoor fighting on this map IS.
   *
   *  2. RESUPPLY — the nearest cache to a man who has been in the fight a long
   *     time. `src/ai` runs its own ammunition (`Agent.ammo`, refilled on its own
   *     reload) and `match` may not reach in and rewrite it, so "low" here is
   *     honest about what it can see: TIME SINCE HE SPAWNED. A man who has been
   *     alive `RESUPPLY_AFTER` seconds has been shooting, and sending him to pull
   *     a crate open on the way to his next objective is both plausible and, more
   *     to the point, is the behaviour that was asked for.
   *
   * WHAT IT COSTS THE PLAN. `CACHE_LEGS` men per side per refresh, capped at a
   * fifth of the side, and only ever men the zone plan had already filled its
   * `want` from — i.e. the spare bodies. It cannot take the last man off a
   * contested point.
   *
   * A MAN KEEPS HIS ERRAND (`CACHE_HOLD`), because the plan re-cuts every two
   * seconds and would otherwise turn him round in the street before he reached
   * the door. He drops it when he arrives, when it times out, or when he dies.
   *
   * THE VERB IS `'pickup'`, which is `src/ai`'s own word (see `setObjective`'s
   * doc) and not a new one: 1.0 m arrival radius, 2.5 s combat break-off. That is
   * exactly "walk to that crate and stand on it, and leave a firefight to do it".
   * `match` may not add behaviour to `src/ai`; it may only drive it.
   *
   * Allocates nothing: `_claimed` is built once.
   */
  _assignCacheLegs(team, live, face) {
    const caches = this.caches;
    if (!caches || !caches.botList.length || !live.length) return;
    const claimed = this._claimed ?? (this._claimed = new Set());
    claimed.clear();
    /**
     * A cache one of OUR OWN live men is already standing on or walking to is
     * taken. The claim is per SIDE and not per map, which is `Caches`'s own
     * rule and is the whole point: two men of the same side on one crate is a
     * queue, but two men of DIFFERENT sides converging on one crate is a fight
     * in a doorway, which is the entire thing 屋内戦闘 asks for. Claiming
     * globally caps the feature at one man per building and the two sides never
     * meet indoors. @see `Caches.nearestBotCache`.
     */
    for (const a of this.ai.agents) {
      if (a.alive && a._matchCache && this.ai.teamOf(a) === team) claimed.add(a._matchCache);
    }

    const now = this.ctx.time.elapsed;
    let legs = Math.min(CACHE_LEGS, Math.max(1, (live.length / 4) | 0));
    // 1. the men already on an errand keep it, and count against the cap.
    for (let i = 0; i < live.length && legs > 0; i++) {
      const a = live[i];
      const c = a._matchCache;
      if (!c) continue;
      if (now > a._matchCacheUntil) {
        a._matchCache = null;
        claimed.delete(c);
        continue;
      }
      // arrived: hold the room for a while instead of handing him straight back
      if (!a._matchCacheHeld && a.position.distanceTo(c.stand) < CACHE_ARRIVE) {
        a._matchCacheHeld = true;
        a._matchCacheUntil = now + CACHE_DWELL;
        /**
         * AND HE OPENS IT. Until this line the errand had no reward and the
         * whole feature measured footfall — see `Caches.takeForBot`, which is
         * the same decision table `take()` runs for the player, addressed to
         * `src/ai`'s hooks instead of `src/weapons`'s.
         *
         * On arrival, ONCE, and only for the man who was sent: the cooldown it
         * burns is the same per-cache `RULES.cacheCooldown` the player's hold
         * burns, so a bot and a human racing for one crate is a real race and
         * the loser gets nothing. A man who needed nothing takes nothing and
         * the crate stays armed — `takeForBot` returns null and does not stamp
         * `readyAt`, exactly as `take()` refuses to burn a cooldown on a full
         * pouch.
         */
        this.caches.takeForBot(c, a, this.ai, now);
        /**
         * ────────────────────────────────────────────────────────────────────
         * …AND HE SWITCHES THE BEACON ON — "ビーコン起動したりするようにして".
         * ────────────────────────────────────────────────────────────────────
         * Until this line the beacon was a PLAYER verb and nothing else: the
         * only call to `plantBeacon` in the repo is on the human's KeyF tap, so
         * across a whole bot-only match `stats.beacons` was 0 and so was
         * `beaconSpawns`. That is a feature that does not exist for nineteen of
         * the twenty men on each side.
         *
         * It is planted on ARRIVAL and by the man who was sent, i.e. exactly
         * where and when the crate is opened, because `plantBeacon` pins the
         * spawn to the CACHE's authored position rather than to wherever a
         * capsule happens to be standing — the same guarantee that makes the
         * player's beacon land somewhere `floorcheck` proved has standing room.
         * It is therefore free of the "twenty men materialise in a doorway"
         * risk that picking an arbitrary point would carry.
         *
         * THE GATE IS THE PLAYER'S OWN GATE, unchanged: the record is one per
         * MAP (`Caches.beacon` is a single object with a `team` on it), so bots
         * planting greedily would starve the human of a verb he has a key
         * bound to. `beaconCooldown` is 75 s and `beaconTime` 30 s, so both
         * sides and the player are racing for the same one slot, which is the
         * same race the crates already are.
         *
         * `_beaconWorth` is the only new judgement: a beacon nobody can respawn
         * at is a wasted cooldown, so it has to pass the same veto
         * (`forwardSpawnBlockRadius`) that `_safeSpawn` will apply to it, and it
         * has to be forward — near the point this side is fighting for — rather
         * than a crate behind its own line.
         */
        if (this._beaconWorth(team, c, now)) {
          this.caches.plantBeacon(c, team, a.yaw, now);
        }
      }
      legs--;
      this._orderCache(a, c, face);
    }
    /**
     * 2. AND THE SPARE BODIES FILL WHAT IS LEFT OF THE CAP — in two passes,
     *    because the men are not interchangeable any more.
     *
     * The first pass takes only men who WANT something a crate has: dry, low,
     * out of frags, or a marksman who would rather be in a nest. The second
     * takes anybody, on the old contest/veteran rules. Two passes rather than a
     * sort: `live` is walked twice at thirty men and nothing is allocated,
     * where a comparator would allocate a closure every two seconds for the
     * length of the match.
     *
     * The order matters and it is the whole point of this pass. Contest legs
     * used to be first and they always match — `_focus[team]` is almost never
     * null — so the three legs a side has were spent on proximity before need
     * was ever consulted. A man who is out of ammunition now outranks a man who
     * is near a door.
     */
    /**
     * A THIRD PASS, AND THE MEASUREMENT THAT DEMANDED IT.
     *
     * `_legfate.mjs` followed every leg on one seed: 39 handed out, 10 ARRIVED
     * — and `stats.botTakes` was 1. The errand was working; the reward was not.
     * `Agent.resupply` is capped at what a man spawned with, so a bot who has
     * not yet reloaded once is FULL, `takeForBot` hands him nothing and returns
     * null (correctly — a full pouch must not burn a crate's cooldown), and the
     * leg bought a walk and no物資. 74 of the 79 legs on that seed went to men
     * selected purely on proximity by `_spareCache`, i.e. to men who could not
     * be paid.
     *
     * So the middle pass now takes the contest/veteran rules AND asks whether
     * the crate can actually give this man something. `ammoState` is the same
     * published hook `_needCache` ranks by — `match` still never reads
     * `Agent.reserve` — and it is < 1 for anybody who has loaded a magazine.
     *
     * The old rule is NOT deleted, it is demoted to a third pass, because
     * footfall is a feature in its own right: a man walking into a room the
     * other side also wants is 屋内戦闘 whether or not he needed the rounds.
     * The order is need, then need-and-near, then near.
     */
    for (let pass = 0; pass < 3 && legs > 0; pass++) {
      for (let i = 0; i < live.length && legs > 0; i++) {
        const a = live[i];
        if (a._matchCache) continue;
        if (pass === 1 && this.ai.ammoState(a) >= 1 && !this.ai.needsGrenade(a)) continue;
        const c = pass === 0 ? this._needCache(a, claimed) : this._spareCache(a, team, claimed, now);
        if (!c) continue;
        claimed.add(c);
        legs--;
        a._matchCache = c;
        a._matchCacheUntil = now + CACHE_HOLD;
        a._matchCacheHeld = false;
        this._orderCache(a, c, face);
      }
    }
  }

  /**
   * IS THIS CRATE WORTH SPENDING THE BEACON ON? @see `_assignCacheLegs`.
   *
   * Four questions, cheapest first, and every one of them is a question the
   * spawn code is going to ask anyway — a beacon that fails any of them burns a
   * 75 s cooldown and produces zero respawns, which is the exact state the
   * feature was already in before bots could plant at all.
   *
   *  1. DOMINATION ONLY. `_safeSpawn` only consults the beacon in domination;
   *     in the demolition ruleset there are no respawns for it to change.
   *  2. THE SLOT IS FREE. One record per MAP, not per side (`Caches.beacon`),
   *     and the human has a key bound to it. Bots use the player's own gate —
   *     nothing live, cooldown clear — so they cannot lock him out of it any
   *     more than another player would.
   *  3. IT WILL SURVIVE THE VETO. `_safeSpawn` refuses a beacon inside
   *     `forwardSpawnBlockRadius` of a live enemy. Testing it here as well
   *     means a beacon is not planted into a room the other side is already in.
   *  4. IT IS FORWARD. `_focus[team]` is the zone this side is fighting for; a
   *     beacon near it is a forward spawn, and one behind the line is a slower
   *     walk to the same place. No focus (nothing contested) means no beacon:
   *     there is nothing for it to be forward OF.
   */
  _beaconWorth(team, c, now) {
    if (!this.domination || !this.caches) return false;
    const b = this.caches.beacon;
    if (b.active || this.caches.beaconCooldown(now) > 0) return false;
    if (this._nearestFoeDist(team, c.position) < RULES.forwardSpawnBlockRadius) return false;
    const zone = this._focus[team];
    if (!zone) return false;
    return c.stand.distanceToSquared(zone.position) < BEACON_NEAR_ZONE * BEACON_NEAR_ZONE;
  }

  /**
   * THE CRATE THIS MAN ACTUALLY WANTS, or null.
   *
   * Everything here is asked through a published `ai` hook — `needsAmmo`,
   * `needsGrenade`, `ammoState` — and never read off the agent: `Agent.reserve`
   * is `src/ai`'s state exactly as `reserve` is `src/weapons`'s, and `match`
   * has no more business reading one than the other.
   *
   * Ranked, hardest need first:
   *  1. DRY (`ammoState` 0) — he cannot shoot at all. `NEED_RANGE`, 38 m.
   *  2. LOW — half a magazine of reserve. `RESUPPLY_RANGE`, on his way.
   *  3. NO FRAGS, and only for a man aggressive enough to use one. A grenade in
   *     an anchor's pouch at the end of the round is a walk that bought nothing.
   *  4. A NEST, for the men whose personality is a firing position. Selects
   *     nothing on this map and is measured doing so. @see `VANTAGE_KINDS`.
   */
  _needCache(a, claimed) {
    const ai = this.ai;
    const caches = this.caches;
    const st = caches.stats;
    if (ai.needsAmmo(a)) {
      const dry = ai.ammoState(a) <= 0.001;
      const c = caches.nearestBotCache(a.position, claimed,
        dry ? NEED_RANGE : RESUPPLY_RANGE, AMMO_KINDS);
      if (c) { st.legsAmmo++; return c; }
    }
    if (ai.needsGrenade(a) && (a.traits?.aggression ?? 0.5) > 0.45) {
      const c = caches.nearestBotCache(a.position, claimed, RESUPPLY_RANGE, GRENADE_KINDS);
      if (c) { st.legsGrenade++; return c; }
    }
    const tr = a.traits;
    if (tr && tr.patience > VANTAGE_PATIENCE && tr.range > VANTAGE_RANGE) {
      const c = caches.nearestBotCache(a.position, claimed, CACHE_NEAR_ZONE, VANTAGE_KINDS);
      if (c) { st.legsVantage++; return c; }
    }
    return null;
  }

  /** The old two rules, unchanged, for a man who needs nothing in particular. */
  _spareCache(a, team, claimed, now) {
    const caches = this.caches;
    const zone = this._focus[team] ?? null;
    // 1. contest: a cache beside the point this side is trying to take.
    if (zone) {
      const c = caches.nearestBotCache(zone.position, claimed, CACHE_NEAR_ZONE, BOT_USEFUL_KINDS);
      if (c) { caches.stats.legsContest++; return c; }
    }
    /**
     * 2. resupply by PROXY. `_matchSpawnedAt` is stamped by `_stampSpawn`, not
     * read out of `src/ai`: the agent object is replaced wholesale on a respawn
     * (`match:respawn` says a respawned bot is a NEW Agent), so a field of our
     * own on the actor is the only honest clock for "how long has this man been
     * in it". It is last now — `_needCache` asks the real question.
     */
    if (now - (a._matchSpawnedAt ?? now) > RESUPPLY_AFTER) {
      const c = caches.nearestBotCache(a.position, claimed, RESUPPLY_RANGE, BOT_USEFUL_KINDS);
      if (c) { caches.stats.legsVeteran++; return c; }
    }
    return null;
  }

  /**
   * Send one man to one cache. The destination is `stand` — the nav cell
   * `Caches.prove` measured a bot can occupy — and NOT `position`, which is the
   * crate itself and is up to 1.6 m of shelving away from anywhere a capsule
   * fits. @see `Caches.prove`.
   */
  _orderCache(a, c, face) {
    a.setObjective('pickup', c.stand, null, face);
    /**
     * `setObjective` builds `{mode, position, site}` and does not carry a cache,
     * so the tag goes on afterwards. It is read by `_indoortime.mjs`; `src/ai`
     * never looks at it.
     */
    if (a.objective) a.objective.cache = c;
  }

  /**
   * Give one man one zone. `slot` spreads consecutive men around the standing
   * ring so a squad taking a point covers it instead of stacking on one cell.
   */
  _orderZone(a, zone, mode, slot, face) {
    /**
     * ────────────────────────────────────────────────────────────────────────
     * A MAN WHO CANNOT GET THERE IS NOT GIVEN THE SAME PLACE AGAIN
     * ────────────────────────────────────────────────────────────────────────
     * `Agent.objectiveBlocked` is `src/ai`'s own word for "I have tried and I
     * cannot reach the point you gave me" — it is set when A* returns no route
     * at all, and now also by the top rung of `Agent._unstick`, when four
     * escalating manoeuvres have failed to get a body onto a route that does
     * exist. Nothing read it. The order therefore arrived, correctly, every two
     * seconds for the rest of the match, aimed at the same square of ground,
     * and the man stood in the street: MEASURED at 9.8 % of all live actor-time
     * carrying that flag while 22 of 29 bots were going nowhere.
     *
     * `match` owns which square of a zone a man is sent to, so this is where the
     * answer belongs. `_zoneRotate` walks the standing ring so a blocked man is
     * offered a DIFFERENT mouth of the same courtyard on every refresh — a zone
     * has several standing points and they are proved reachable independently
     * (`sites.js`), so the one that failed says nothing about the next.
     */
    if (mode === 'hold') {
      a.setObjective('hold', zone.position, zone, face);
      return;
    }
    const ring = zone.stand;
    const bump = a.objectiveBlocked ? ++this._zoneRotate : 0;
    a.setObjective('defuse', ring[(slot + bump) % ring.length], zone);
  }

  /**
   * Index into `live` of the nearest man with no job yet, or -1.
   *
   * `zone` is optional and does one thing: a man who has just told us he cannot
   * reach THIS zone is the last man it should be handed to. He is not excluded —
   * on a thin side he may be all there is — he is put at the back of the queue,
   * so the slot goes to somebody who can walk to it and he falls through to a
   * different plan record. Together with the ring rotation in `_orderZone`, a
   * bot that reports a dead end gets a different way in, then a different zone.
   */
  _nearestFreeIndex(live, taken, point, zone = null) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < live.length; i++) {
      if (taken[i]) continue;
      const a = live[i];
      let d = a.position.distanceToSquared(point);
      if (zone && a.objectiveBlocked && a.objective && a.objective.site === zone) d += 1e6;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** The C4 mode's objective assignment, unchanged. @see RULES.mode */
  _assignDemolition() {
    const atk = this.attackers;
    const def = this.defenders;
    const armed = this.bomb.armed;
    const loose = this.bomb.loose;
    this.bomb.worldPosition(this._bombPos);

    // Whoever fetches a dropped charge should be somebody who can actually walk
    // to it, so prefer a man who is not currently in a firefight and only fall
    // back to the nearest of all of them if everybody is engaged.
    this._fetcher = loose
      ? this._nearestTo(this._botsByTeam[atk], this.bomb.position, true) ??
        this._nearestTo(this._botsByTeam[atk], this.bomb.position)
      : null;

    // ---- attackers ----------------------------------------------------
    // Once the charge is down the attack is the one holding ground, so it looks
    // back the way the defence will come — and vice versa before the plant.
    const atkFace = this._spawnCentre.defend;
    const defFace = this._spawnCentre.attack;
    let i = 0;
    for (const a of this._botsByTeam[atk]) {
      if (!a.alive) continue;
      if (this.bomb.carrier === a) {
        a.setObjective('plant', this.targetSite.position, this.targetSite);
      } else if (loose && this._fetcher === a) {
        a.setObjective('pickup', this.bomb.position, null);
      } else if (armed) {
        a.setObjective('hold', this.bomb.position, this.bomb.site, atkFace);
      } else if (loose) {
        // A bomb site is worthless without the charge. When it is on the floor
        // the whole attack regroups on it rather than continuing to the site —
        // which is both the correct call and the fix for the failure this mode
        // kept producing: a C4 lying in the middle of the street for ninety
        // seconds while six men pushed past it to a site they could not use.
        a.setObjective('push', this.bomb.position, null);
      } else {
        /**
         * THE FLANK — "攻める側は裏どりや屋内移動 … 移動に関しては攻める側が
         * 有利になるように".
         *
         * Fifteen men walking one lane at one mouth is not an attack, it is a
         * queue: the defence only ever has to hold the direction the whole
         * courtyard is being entered from, which on a map with three mouths per
         * site throws away the attack's only structural advantage. So a share
         * of the attack is staged through the CONNECTOR first (see
         * `site.flank` in sites.js) and arrives at a different mouth, at the
         * same time, from a lane the defence's hold does not overlook.
         *
         * The share is every third man — `RULES.flankShare`, the number that
         * keeps the main push heavy enough to still take the site on its own.
         * Picked by list index rather than by dice, and MEMBERSHIP IS STICKY:
         * `_flankTarget` only consults the index for a man it has never sent,
         * so a flanker keeps flanking while the list is re-cut under him by
         * deaths and respawns, instead of changing his mind every two seconds.
         */
        const via = this._flankTarget(a, i);
        a.setObjective('push', via ?? this.targetSite.position, via ? null : this.targetSite);
      }
      i++;
    }

    // ---- defenders ----------------------------------------------------
    if (armed) {
      /**
       * A CREW works the charge; the rest clear and cover the other entries.
       *
       * This used to be one man — `_nearestTo`, singular — and one man is a
       * single point of failure against fifteen attackers holding the site:
       * he gets shot on the approach, and the two second objective refresh
       * then picks the same profile of man again while the fuse burns. See
       * `RULES.defuseCrew`. The rest are `retake`, which is what actually
       * makes the defuse possible: somebody has to be shooting at the hold.
       */
      const crew = this._nearestInto(
        this._botsByTeam[def],
        this.bomb.position,
        RULES.defuseCrew,
        this._crew
      );
      for (const a of this._botsByTeam[def]) {
        if (!a.alive) continue;
        if (crew.includes(a)) a.setObjective('defuse', this.bomb.position, this.bomb.site);
        else a.setObjective('retake', this.bomb.position, this.bomb.site, defFace);
      }
    } else {
      /**
       * ROTATE ONTO THE SITE THAT IS ACTUALLY BEING HIT.
       *
       * The old split was a flat alternation across both sites for the whole
       * round, which means half the defence spends every round guarding a
       * courtyard nobody ever walks into. That is not a defence, it is two
       * half-strength garrisons — and against fifteen attackers who all commit
       * to one site it loses every time.
       *
       * `_threatenedSite` reads the defence's OWN contact reports (see the
       * function), so this is information the team has genuinely earned: a man
       * has to have seen an attacker near a site within the last few seconds.
       * Two thirds rotate onto it and a third stays home, because a rotation
       * that empties the other site is exactly what a fake is for.
       */
      const hot = this._threatenedSite();
      const live = this._botsByTeam[def].filter((a) => a.alive);
      for (let i = 0; i < live.length; i++) {
        const site = hot
          ? (i % 3 === 0 ? this._otherSite(hot) : hot)
          : this.sites[i % this.sites.length];
        site.defenders.push(live[i]);
        live[i].setObjective('hold', site.hold, site, defFace);
      }
    }
  }

  /**
   * Where attacker number `index` should be walking on his way to the site:
   * the flank staging point, or null for "straight down the lane".
   *
   * A LATCH, NOT A TEST. `_flankLeg` remembers who has already been through
   * the connector (`-1`), because a pure distance test oscillates: the man
   * arrives, is re-tasked to the site, walks away from the staging point, and
   * the next refresh two seconds later sends him back to it. He goes once.
   *
   * The timeout is the other half of not stranding anybody — a staging point
   * he cannot reach (rubble from an airstrike, a body of men in the way) stops
   * being his problem after `FLANK_TIMEOUT` and he joins the push.
   */
  _flankTarget(a, index) {
    const site = this.targetSite;
    if (!site?.flank || index % RULES.flankShare !== 0) return null;
    const leg = this._flankLeg.get(a);
    if (leg === -1) return null;
    const now = this.ctx.time.elapsed;
    if (leg === undefined) {
      this._flankLeg.set(a, now);
      return site.flank;
    }
    const arrived = a.position.distanceToSquared(site.flank) < FLANK_ARRIVE * FLANK_ARRIVE;
    if (arrived || now - leg > FLANK_TIMEOUT) {
      this._flankLeg.set(a, -1);
      return null;
    }
    return site.flank;
  }

  /**
   * Which bomb site the defence currently believes is under attack, or null.
   *
   * Built from `lastKnown` — the position each defender last put an enemy at —
   * so it is exactly the "call it out or it isn't there" rule the rest of the
   * mode runs on, and it can be faked. A contact only votes if it is fresh
   * (under six seconds) and within 22 m of a site, and a site needs two votes
   * to move anybody: one man glimpsing somebody in a connector must not swing
   * the whole defence, or the attack rotates the defence back and forth by
   * showing one player at each site in turn.
   */
  _threatenedSite() {
    const def = this.defenders;
    let bestSite = null;
    let bestVotes = 1;
    for (const s of this.sites) {
      let votes = 0;
      for (const a of this._botsByTeam[def]) {
        if (!a.alive || a.lastKnownAge > 6) continue;
        const dx = a.lastKnown.x - s.position.x;
        const dz = a.lastKnown.z - s.position.z;
        if (dx * dx + dz * dz < 22 * 22) votes++;
      }
      if (votes > bestVotes) {
        bestVotes = votes;
        bestSite = s;
      }
    }
    return bestSite;
  }

  _otherSite(site) {
    for (const s of this.sites) if (s !== site) return s;
    return site;
  }

  /**
   * The `n` live actors of `list` closest to `point`, written into `out`.
   *
   * Insertion into a preallocated array rather than a sort: `n` is three and
   * the list is fifteen, so this is a couple of dozen comparisons and — the
   * part that matters — it allocates nothing, which a `.sort().slice()` on an
   * objective refresh that runs every two seconds would not manage.
   */
  _nearestInto(list, point, n, out) {
    out.length = 0;
    const d = this._crewDist ?? (this._crewDist = []);
    d.length = 0;
    for (const a of list) {
      if (!a.alive) continue;
      const dist = a.position.distanceToSquared(point);
      let i = out.length;
      while (i > 0 && d[i - 1] > dist) i--;
      if (i >= n) continue;
      // Shift the tail down by one and drop whatever falls off the end. No
      // `splice`: splice returns a fresh array of what it removed.
      const last = Math.min(out.length, n - 1);
      for (let k = last; k > i; k--) {
        out[k] = out[k - 1];
        d[k] = d[k - 1];
      }
      // Writing past the end grows both arrays by exactly one, which is the
      // only growth there is; they never exceed `n`.
      out[i] = a;
      d[i] = dist;
    }
    return out;
  }

  /** @param {boolean} freeOnly  skip anyone currently engaged */
  _nearestTo(list, point, freeOnly = false) {
    let best = null;
    let bestD = Infinity;
    for (const a of list) {
      if (!a.alive) continue;
      if (freeOnly && a.hasTarget) continue;
      const d = a.position.distanceToSquared(point);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  _setPhase(phase, timer) {
    this.phase = phase;
    this.timer = timer;
    // Weapons are dead during the freeze and after the round is decided.
    this.weapons.locked = phase !== PHASE.LIVE;
    this.ai.combatEnabled = phase === PHASE.LIVE;
    // Freeze time locks the feet, not the head: look around, change your gun,
    // do not move up. Both sides — `Agent._advance` reads `combatEnabled`.
    this.player.movementLocked = phase === PHASE.FREEZE;
    this._objectiveTimer = 0;
    // The airstrike only schedules itself inside a live round, and the first
    // one cannot be called for `RULES.airstrikeFirstDelay` seconds after GO.
    if (phase === PHASE.LIVE) {
      for (const a of this.air) a.armRound();
    } else {
      for (const a of this.air) a.disarm();
    }
  }

  _endRound(winner, reason) {
    if (this.phase !== PHASE.LIVE) return;
    // Whatever decided it, the fuse stops here.
    this.bomb.frozen = true;
    this.bomb.worker = null;
    this.bomb.workKind = null;
    // Nobody comes back after the round is decided.
    this._respawnQueue.length = 0;
    for (const a of this.ai.agents) a.working = null;
    this.score[winner]++;
    this.result = { winner, reason };
    const mine = winner === this.playerTeam;
    this.ui.banner.show(
      mine ? 'ROUND WON' : 'ROUND LOST',
      `${TEAM_NAME[winner]} · ${reason}`,
      3.2
    );
    this.ctx.events.emit('match:result', {
      winner,
      reason,
      score: this.score,
      matchOver: false,
    });
    console.info(`[match] round ${this.round} → ${TEAM_NAME[winner]} (${reason}) ${this.score[0]}-${this.score[1]}`);

    const decided =
      this.score[winner] >= RULES.roundsToWin || this.round >= RULES.maxRounds;
    if (decided) {
      this.matchOver = true;
      this._setPhase(PHASE.OVER, RULES.roundOverTime);
      this._pendingMatchWinner =
        this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1;
    } else {
      this._setPhase(PHASE.OVER, RULES.roundOverTime);
    }
  }

  _endMatch() {
    const w = this._pendingMatchWinner ?? -1;
    this._setPhase(PHASE.MATCH_OVER, RULES.matchOverTime);
    this.ui.banner.show(
      w < 0 ? 'DRAW' : w === this.playerTeam ? 'VICTORY' : 'DEFEAT',
      `${this.score[0]} — ${this.score[1]}`,
      5
    );
    this.ctx.events.emit('match:result', {
      winner: w,
      reason: 'match',
      score: this.score,
      matchOver: true,
    });
  }

  _restartMatch() {
    this.score[0] = 0;
    this.score[1] = 0;
    this.round = 0;
    this.matchOver = false;
    this._pendingMatchWinner = undefined;
    this._beginRound();
  }

  /* ==================================================================== */
  /* deaths and scoring                                                   */
  /* ==================================================================== */

  _isPlayer(t) {
    return t === this.player || t === 'player' || t?.isPlayer === true;
  }

  _record(actor) {
    for (const r of this.roster) if (r.actor === actor) return r;
    return null;
  }

  _onActorDeath(e) {
    const victim = e?.actor;
    if (!victim) return;
    const vr = this._record(victim);
    if (vr) {
      vr.alive = false;
      vr.deaths++;
    }
    const killer = e.by ?? null;
    /**
     * A TANK IS A KILLER WITHOUT A ROSTER ROW. It is not a man, it does not
     * score and it must never appear on the scoreboard — but it has a `name`
     * and a `team`, which is everything the killfeed asks of an attacker, and
     * "WORLD killed you" for a shell you watched being laid on you is a lie.
     */
    const kr = killer ? this._record(killer) ?? (killer.isTank ? killer : null) : null;
    if (kr && kr !== vr && kr.kills !== undefined) kr.kills++;
    this._pushKillfeed(kr, vr, !!e.headshot);
    if (vr) this._queueRespawn(vr);

    // He was carrying magazines. They are still there. Both sides drop — see
    // the "EVERY BODY" note in src/match/ammo.js.
    if (this.phase === PHASE.LIVE && victim.position) {
      this.ammoDrops.drop(
        victim.position,
        this.ai.groundAt(victim.position.x, victim.position.z, victim.position.y + 2)
      );
    }

    // The carrier going down drops the charge where they fell.
    if (this.bomb.carrier === victim) {
      this._v.copy(victim.position ?? this._bombPos);
      this._v.y = this.ai.groundAt(this._v.x, this._v.z, this._v.y + 2) + 0.02;
      this.bomb.drop(this._v);
      this._assignObjectives();
      this.ctx.events.emit('match:bomb', { state: this.bomb.state, site: null, fuse: 0, carrier: null });
    } else if (this.phase === PHASE.LIVE) {
      this._assignObjectives();
    }
  }

  _onPlayerDeath() {
    const pr = this._record(this.player);
    if (pr && pr.alive) {
      pr.alive = false;
      pr.deaths++;
      const att = this._playerLastAttacker;
      // Same as `_onActorDeath`: a tank has no roster row but is a real killer.
      const killer = this._record(att) ?? (att?.isTank ? att : null);
      if (killer && killer !== pr && killer.kills !== undefined) killer.kills++;
      this._pushKillfeed(killer, pr, false);
      this._queueRespawn(pr);
    }
    if (this.bomb.carrier === this.player) {
      this._v.copy(this.player.position);
      this._v.y = this.ai.groundAt(this._v.x, this._v.z, this._v.y + 2) + 0.02;
      this.bomb.drop(this._v);
      this._assignObjectives();
      this.ctx.events.emit('match:bomb', {
        state: this.bomb.state,
        site: null,
        fuse: 0,
        carrier: null,
      });
    }
    this.player.setControlEnabled(false);
    this.spectator.start(this.ctx.camera.position);
    this._playerWasDead = true;
    const q = this._respawnQueue.find((r) => r.rec === pr);
    this.ui.banner.show(
      'ELIMINATED',
      q ? `RESPAWN IN ${RULES.respawnDelay | 0}S` : 'NO RESPAWN — PLAY IT OUT',
      2.6
    );
  }

  _pushKillfeed(killer, victim, headshot) {
    if (!victim) return;
    const mine = killer?.isPlayer === true;
    this.ui.killfeed.push({
      attacker: killer ? killer.name : 'WORLD',
      victim: victim.name,
      headshot,
      mine,
      // Colour the row from the LOCAL player's point of view.
      attackerFriendly: killer ? killer.team === this.playerTeam : true,
    });
    if (mine) {
      this.ui.banner.show('ENEMY ELIMINATED', headshot ? 'HEADSHOT' : '', 1.2);
    }
  }

  /* ==================================================================== */
  /* frame                                                                */
  /* ==================================================================== */

  update(dt, ctx) {
    const audio = this._audio ?? (this._audio = ctx.peek('audio'));

    switch (this.phase) {
      case PHASE.WARMUP:
        this.timer -= dt;
        if (this.timer <= 0) this._beginRound();
        break;

      case PHASE.FREEZE:
        this.timer -= dt;
        if (this.timer <= 0) {
          this._setPhase(PHASE.LIVE, 0);
          this.ui.banner.show('GO', '', 1.0);
        }
        break;

      case PHASE.LIVE:
        // In domination the match clock is the only clock there is; in demolition
        // it stops the moment the fuse starts.
        if (this.domination || !this.bomb.armed) this.roundClock -= dt;
        if (!this.domination && this.bomb.update(dt, audio) === 'detonate') {
          this._endRound(this.attackers, 'C4 DETONATED');
          break;
        }
        /**
         * THE ZONES, BEFORE ANYTHING READS THEM. Presence, the bar, the flips and
         * the score tick all land here, so `_assignObjectives` below is deciding
         * on this frame's ownership rather than last frame's, and
         * `_checkWinConditions` sees the score the tick just wrote.
         */
        if (this.capture) {
          this.capture.update(
            dt,
            ctx.time.elapsed,
            this._botsByTeam,
            this.player,
            this.playerTeam
          );
        }
        // Re-task on a timer, not only on a death. MEASURED: with reassignment
        // driven purely by `actor:death`, a dropped charge stayed on the floor
        // for a whole round — the one man tasked to fetch it was pinned in a
        // firefight and nobody else was ever told to. Two seconds is short
        // enough that the nearest free attacker picks it up and long enough that
        // nobody oscillates between two orders.
        this._updateRespawns();
        this._objectiveTimer -= dt;
        if (this._objectiveTimer <= 0) {
          this._objectiveTimer = 2;
          this._pruneDead();
          this._assignObjectives();
        }
        if (!this.domination) this._updateBotObjectiveWork(dt);
        /**
         * The beacon's thirty seconds. Retired here rather than lazily inside
         * `_safeSpawn` so the marker, the HUD clock and the "you may plant
         * another" state all turn over on the frame it actually runs out.
         */
        if (this.caches?.update(ctx.time.elapsed)) this.ui.banner.show('BEACON OFFLINE', '', 1.2);
        /**
         * THE MAP CHANGES UNDER YOU: D opening in the cathedral ruin, the
         * artillery that makes camping A or B cost you, and the final city-wide
         * collapse. Domination only — none of the three has a meaning in a
         * two-site demolition round. @see `_updateMapEvents`
         */
        if (this.domination) {
          this._updateMapEvents(dt);
          this._updateBombard(dt);
          /**
           * TEN MEN FOR WHOEVER IS LOSING. It is polled here, INSIDE the
           * domination branch and after the score tick, so the gap it reads is
           * this frame's and not last frame's — the same reason `capture.update`
           * runs before `_assignObjectives`. @see `_updateReinforcements`.
           */
          this._updateReinforcements(dt);
        }
        this._updatePlayerInteraction(dt);
        this._updateAmmoDrops(dt, audio);
        this._checkWinConditions();
        break;

      case PHASE.OVER:
        this.timer -= dt;
        if (!this.domination) this.bomb.update(dt, null);
        if (this.timer <= 0) {
          if (this.matchOver) this._endMatch();
          else this._beginRound();
        }
        break;

      case PHASE.MATCH_OVER:
        this.timer -= dt;
        if (this.timer <= 0) this._restartMatch();
        break;
      default:
        break;
    }

    // Both run their own clock in every phase — a mass that is mid-air when a
    // round ends still has to land, and an aeroplane halfway across the map
    // still has to finish crossing it — but they only ARM during LIVE.
    const live = this.phase === PHASE.LIVE;
    // WHERE THE FIGHT IS, refreshed on a slow timer and handed to all three.
    // A fixed-site weapon on a 114x141 m map lands where nobody is unless
    // somebody aims it. @see `_updateAirFocus`
    if (live) this._updateAirFocus(dt);
    this.airstrike?.update(dt, live);
    this.bomber?.update(dt, live);
    this.strafe?.update(dt, live);
    this.tank?.update(dt, live);
    /**
     * The helicopter runs its own clock in every phase, exactly as the four
     * above do: a sortie that is in the air when a match ends still has to
     * finish crossing the map. `live` is what stops the MEN arriving — a canopy
     * that touches down after the final whistle lands nobody. @see
     * `Reinforcements._land`.
     */
    this.reinforce?.update(dt, live);

    // Dead players watch. Written here, in update(), so it lands before `ui`
    // and `render` read the camera this frame.
    if (this.spectator.active) {
      this._collectSquad();
      this.spectator.update(dt, this._squad);
    }

    this._publishHud();
  }

  /* ------------------------------------------------------------- the air -- */

  /**
   * WHERE THE FIGHT IS — the one number that decides whether an air event is
   * something the player experiences or a line in the console.
   *
   * The three air weapons all pick from fixed geography (eight strike sites,
   * four bomb lines, four gun lines) because their masses, timelines and nav
   * patches are baked at boot and that is the whole design. On a 114x141 m map an
   * unbiased draw over fixed points puts the median event most of the map away
   * with a block in between — measured at 71 m — and from the seat that is
   * indistinguishable from nothing happening. Which is exactly what was reported.
   *
   * So the choice is aimed. This is the centroid of the fight with THE PLAYER'S
   * OWN EYE WEIGHTED AS FOUR MEN, because the one seat that has to see it is the
   * one behind the camera; when the player is dead it follows whoever they are
   * spectating, for the same reason. Bots more than 60 m from that eye are not
   * part of the fight the player is in and are left out of the average.
   *
   * It is only ever a WEIGHT on the draw (see `Airstrike._focusWeight`): the
   * geography does not move, so the balance argument that every strike site and
   * every bomb line sits on the attackers' half of every route — which is a
   * geometric fact about the map, not a tuning opinion — is untouched.
   *
   * Refreshed at 1.5 s, which is far quicker than the 28-84 s gaps between air
   * events and costs one pass over thirty actors.
   */
  _updateAirFocus(dt) {
    this._airFocusTimer -= dt;
    if (this._airFocusTimer > 0) return;
    this._airFocusTimer = 1.5;
    const f = this._airFocus;
    f.set(0, 0, 0);
    let w = 0;
    const eye = this.player.dead
      ? this.spectator.active
        ? this.spectator.target?.position ?? null
        : null
      : this.player.position;
    if (eye) {
      f.addScaledVector(eye, 4);
      w += 4;
    }
    for (const a of this.ai.agents) {
      if (!a.alive) continue;
      if (eye && a.position.distanceToSquared(eye) > 60 * 60) continue;
      f.add(a.position);
      w++;
    }
    if (!w) {
      for (const a of this.air) a.setFocus(null);
      return;
    }
    f.multiplyScalar(1 / w);
    for (const a of this.air) a.setFocus(f);
  }

  /**
   * TELL THE PLAYER. Called by all three air systems the moment something is
   * called, with their own reused announce record.
   *
   * Three things, because the failure this fixes was that there were none:
   *   1. the HUD strip, which holds a live bearing and a countdown for the whole
   *      telegraph (src/ui/airalert.js),
   *   2. a world marker on EVERY impact point in the event — three for a salvo,
   *      three along a stick or a gun line — so it reads as an area to leave and
   *      not as one dot to look at,
   *   3. the banner, because that is what catches an eye that is down a sight.
   */
  _announceAir(info) {
    if (!info) return;
    /**
     * ────────────────────────────────────────────────────────────────────────
     * THE CATHEDRAL EVENT KEEPS ITS OWN HEADLINE
     * ────────────────────────────────────────────────────────────────────────
     * PHOTOGRAPHED, not reasoned about (`_evshots.mjs`, shots 01-08 of the first
     * pass). The event calls three of this file's other weapons inside itself,
     * every one of them announces itself through this method, and every
     * announcement resets the strip and takes the banner — so the sequence the
     * player actually read was "THE CATHEDRAL IS BEING LEVELLED · 10 SECONDS"
     * for four seconds, then "BOMBER INBOUND · MAIN STREET · GET CLEAR", then
     * "BLOCK LEVELLED", then "STRAFING RUN", then "AIRSTRIKE INBOUND". The one
     * thing the HUD had to say — the middle of the map is being annihilated and
     * here is how long you have — was overwritten by its own component parts,
     * and the countdown bar restarted three times.
     *
     * So while the event is running its sub-events keep their DANGER RETICLES,
     * which are the half that is genuinely per-impact and which read as an area
     * to leave, and give up the strip and the banner. The headline is re-asserted
     * by the event itself at `raze` and `aftermath`. @see `_cathBeat`.
     */
    const inEvent = this._cath.t >= 0;
    const h = this._airHud;
    const p = info.position;
    h.kind = info.kind;
    h.name = info.name ?? '';
    h.lead = info.lead ?? 4.4;
    h.x = p?.x ?? 0;
    h.y = p?.y ?? 0;
    h.z = p?.z ?? 0;
    let label = 'INCOMING';
    switch (info.kind) {
      case 'SALVO':
        h.title = 'HEAVY AIRSTRIKE';
        h.impactTitle = 'BLOCK LEVELLED';
        label = 'AIRSTRIKE';
        break;
      case 'BOMBER':
        h.title = 'BOMBER INBOUND';
        h.impactTitle = 'BOMBS DOWN';
        label = 'BOMBS';
        break;
      case 'STRAFE':
        h.title = 'STRAFING RUN';
        h.impactTitle = 'CANNON FIRE';
        label = 'CANNON';
        break;
      case 'TANK':
        // The only one of the four whose marker is not a point to leave: it is
        // a street to stay out of, and it will still be there in thirty seconds.
        h.title = 'ARMOUR MOVING UP';
        h.impactTitle = 'TANK DESTROYED';
        label = 'ARMOUR';
        break;
      default:
        h.title = 'AIRSTRIKE INBOUND';
        h.impactTitle = 'IMPACT';
        label = 'AIRSTRIKE';
        break;
    }
    for (let i = 0; i < info.count; i++) this.ui.airDanger(info.points[i], h.lead, label);
    if (inEvent) return;
    this.ui.airAlert(h);
    this.ui.banner.show(
      h.title,
      info.kind === 'SALVO'
        ? `${h.name} · CLEAR THE AREA`
        : // Both hulls roll on one call, so naming one side would be a lie to
          // the other. The tank's line is what to do about it, not whose it is.
          info.kind === 'TANK'
          ? 'BOTH SIDES · STAY OUT OF THE MID STREET'
          : `${h.name} · GET CLEAR`,
      info.kind === 'STRAFE' ? 1.8 : info.kind === 'TANK' ? 2.6 : 1.9
    );
  }

  /** It went off. The strip switches to its impact read; the banner confirms. */
  _airLanded(info) {
    if (!info) return;
    // Inside the cathedral event the impact read belongs to the event, not to
    // whichever of its parts happens to have landed. @see `_announceAir`.
    if (this._cath.t >= 0) return;
    const title =
      info.kind === 'SALVO'
        ? 'BLOCK LEVELLED'
        : info.kind === 'BOMBER'
          ? 'BOMBS DOWN'
          : info.kind === 'STRAFE'
            ? 'CANNON FIRE'
            : info.kind === 'TANK'
              ? 'TANK DESTROYED'
              : 'AIRSTRIKE';
    this.ui.airImpact(title);
    // A salvo is the round's event and gets the full banner; the rest have
    // already had theirs on the way in and would only be shouting twice.
    if (info.kind === 'SALVO') this.ui.banner.show(title, `${info.name} · DOWN`, 2.4);
  }

  /* ==================================================================== */
  /* THE MAP CHANGES UNDER YOU — D, the bombardment, the final collapse    */
  /* ==================================================================== */

  /**
   * ────────────────────────────────────────────────────────────────────────
   * FOUR SCHEDULED EVENTS, ONE CLOCK, AND NOTHING BUILT WHEN THEY FIRE
   * ────────────────────────────────────────────────────────────────────────
   * All of them are `Airstrike`'s existing machinery aimed by this file. Nothing
   * below allocates, bakes, fractures or rebuilds anything: the cathedral salvo
   * and every strike site were cut, solved and nav-patched at BOOT, and firing
   * one is two booleans per mesh and a uniform write. What this method owns is
   * WHEN, which is the part that is a ruleset and not an effect.
   *
   *   `districtSalvoProgress`  the city round A and the city round B, one salvo
   *                            each, opening the bearings the two avenues denied
   *   `cathedralOpenProgress`  the cathedral comes down and D opens in the wreckage
   *   `zoneBombard*`           A and B are shelled on a random gap, so holding a
   *                            point means moving inside it, not sitting on it
   *   `finalCollapseProgress`  everything still standing, in one rolling event
   *
   * THEY ARE IN THAT ORDER ON PURPOSE and the order is the whole schedule: the
   * districts open routes, the cathedral is the second act on top of the routes,
   * the last event is the last event. Each is far enough from the next that it
   * is its own event — @see `RULES.districtSalvoGap`.
   *
   * THE TWO BIG ONES ARE ON `_matchProgress`, NOT ON THE CLOCK, and that is a
   * fix rather than a refactor. The note that used to stand here said "a match
   * decided in four minutes never sees the final collapse, which is correct" —
   * it is not correct, it is the whole complaint. `_timeline.mjs` measures every
   * match ending at t = 276..288 s on `scoreTarget` and `finalCollapseAt: 470`
   * therefore firing in NONE of them. An event nobody has ever seen is not a
   * late-game event. @see `RULES.cathedralOpenProgress`.
   */
  _updateMapEvents(dt) {
    const t = RULES.matchTime - this.roundClock;
    const p = this._matchProgress();

    /* ---- the two districts -------------------------------------------- */
    /**
     * ONE SALVO EACH, GUARANTEED, AND FAR ENOUGH APART TO BE TWO EVENTS.
     *
     * The threshold is `match`'s and the choice of which district goes first is
     * `airstrike`'s — @see `Airstrike.callDistrictSalvo` for why the order stays
     * emergent, and `RULES.districtSalvoProgress` for what the two numbers were
     * measured against. `_districtGap` is the floor under the spacing: two
     * thresholds that happen to be reached in the same few seconds (a side that
     * takes three zones scores 1.5 pt/s and covers 0.1 of progress in seventeen)
     * would otherwise be one long noise instead of two events.
     */
    this._districtGap -= dt;
    if (
      this._districtsFired < RULES.districtSalvoProgress.length &&
      p >= RULES.districtSalvoProgress[this._districtsFired] &&
      this._districtGap <= 0 &&
      !this.airstrike?.busy
    ) {
      const id = this.airstrike?.callDistrictSalvo?.() ?? null;
      if (id) {
        this._districtsFired++;
        this._districtGap = RULES.districtSalvoGap;
        console.info(
          `[match] ${id} levelled at t=${t.toFixed(0)}s p=${p.toFixed(2)} — ` +
            `${this._districtsFired} of ${RULES.districtSalvoProgress.length}`
        );
      } else if (this.airstrike?.ready) {
        // Nothing of either district is left standing (a re-run, or the final
        // collapse got there first). Stop asking.
        this._districtsFired = RULES.districtSalvoProgress.length;
      }
    }

    /* ---- D ------------------------------------------------------------ */
    /**
     * ONE SCORED EVENT, ON ONE CLOCK. @see `_updateCathedralEvent`, and
     * `RULES.cathedralLead` for the beat sheet and what it replaced.
     */
    if (this._cath.t >= 0) {
      this._updateCathedralEvent(dt);
      /**
       * NOT ON TOP OF A DISTRICT, AND `busy` ALONE WAS NOT ENOUGH FOR THAT.
       *
       * `busy` is a salvo in the air or still settling — about nine seconds —
       * so it stopped the two biggest events of the match from literally
       * overlapping and nothing more. `_districtGap` is the same 25 s floor the
       * two district salvos hold each other to (@see `RULES.districtSalvoGap`),
       * and the cathedral is now held to it as well, because the argument that
       * set it applies here with more force rather than less: "three big events
       * inside twenty seconds is one big event". It became reachable when
       * `cathedralOpenProgress` came down to 0.40 — measured, the cathedral then
       * wants to fire 18 s after the second district in the fastest of three
       * matches, which `busy` would have allowed.
       *
       * IT ONLY EVER DELAYS. `p` is monotone and `_districtGap` counts down, so
       * the branch is still taken on the first frame the sky is clear; it can
       * postpone the collapse by seconds and can never skip it.
       */
    } else if (
      !this._cathedralCalled &&
      this.lockedZone &&
      p >= RULES.cathedralOpenProgress &&
      this._districtGap <= 0 &&
      !this.airstrike?.busy
    ) {
      this._beginCathedralEvent(t, p);
    }

    /* ---- the bombardment of A and B ----------------------------------- */
    this._bombardIn -= dt;
    if (this._bombardIn <= 0) this._callZoneBombard();

    /* ---- the last event ----------------------------------------------- */
    if (!this._finalCalled && p >= RULES.finalCollapseProgress) {
      this._finalCalled = true;
      this._finalLeft = this.airstrike?.callEverything?.(RULES.finalCollapseStagger) ?? 0;
      if (this._finalLeft > 0) {
        this.ui.banner.show('THE CITY IS COMING DOWN', `${this._finalLeft} SITES · FIND OPEN GROUND`, 4.0);
        this._airHud.kind = 'SALVO';
        this._airHud.title = 'THE CITY IS COMING DOWN';
        this._airHud.impactTitle = 'CITY LEVELLED';
        this._airHud.name = 'EVERYTHING STILL STANDING';
        this._airHud.lead = 4.4;
        const c = this._spawnCentre.attack;
        this._airHud.x = 0;
        this._airHud.y = c.y;
        this._airHud.z = 0;
        this.ui.airAlert(this._airHud);
      }
      console.info(
        `[match] FINAL COLLAPSE at t=${t.toFixed(0)}s p=${p.toFixed(2)} — ${this._finalLeft} sites still standing`
      );
    }
  }

  /* ==================================================================== */
  /* THE REINFORCEMENT DROP                                               */
  /* ==================================================================== */

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * TEN MEN FOR THE SIDE THAT IS LOSING, ONCE, AND THEY DO NOT COME BACK
   * ══════════════════════════════════════════════════════════════════════════
   * "大幅に負けている（１００ポイント差とか、残り１００ポイントに相手チームがなったら）
   *  チームはたまに増援として１０人追加されるようにしてAI"
   *
   * ────────────────────────────────────────────────────────────────────────
   * IT IS NOT ON `_matchProgress`, AND THAT IS THE ONE DESIGN DECISION HERE
   * ────────────────────────────────────────────────────────────────────────
   * Every other scheduled event in this file fires on
   * `max(elapsed/matchTime, leader/scoreTarget)` — the districts, the cathedral,
   * the final collapse — because they are about the SHAPE of a match and have to
   * land at the same point in it whether it is decided on points in four minutes
   * or runs the clock out in ten.
   *
   * This one must not be, and the reason is that `_matchProgress` reads the
   * LEADER. It says how close the match is to ending and it says NOTHING about
   * whether it is close: 400-390 and 400-120 are the same progress and they are
   * opposite matches. A comeback mechanic hung off it would fire in the second
   * one — which is right — and equally in the first, which is a rubber band on a
   * game somebody is winning fairly. So the trigger is the two things the player
   * actually named, and both are about the GAP or about the loser:
   *
   *   • `RULES.reinforceDeficit` behind — being ground down, at any point in the
   *     match.
   *   • the enemy within `RULES.reinforceEndgame` of `scoreTarget` — a match
   *     about to end, where the trailing side may be only forty behind.
   *
   * ────────────────────────────────────────────────────────────────────────
   * "たまに" IS A ROLL PER POLL AND NOT A TIMER. @see `RULES.reinforceChance`
   * ────────────────────────────────────────────────────────────────────────
   * The condition is sticky — a side a hundred behind is usually still a hundred
   * behind eight seconds later — so "fire when true" would mean "fire the
   * instant you fall behind" and every match with a drop in it would have it at
   * the same moment. The window opens; the dice decide when inside it.
   *
   * BOTH SIDES ARE POLLED. The map is symmetric and so is this: whichever side
   * is losing gets the offer, including the human's. A mechanic that only ever
   * helped the bots would read as the game cheating, and one that only ever
   * helped the player would read as the game apologising.
   */
  _updateReinforcements(dt) {
    const r = this.reinforce;
    if (!r?.ready) return;
    const t = RULES.matchTime - this.roundClock;
    if (t < RULES.reinforceFirstDelay) return;
    this._reinforcePoll -= dt;
    if (this._reinforcePoll > 0) return;
    this._reinforcePoll = RULES.reinforcePoll;
    /**
     * ONE SORTIE IN THE SKY AT A TIME, AND NOT UNDER SOMEBODY ELSE'S. A
     * helicopter is not in the other three weapons' `coBusy` — adding it would
     * change the schedule of events this pass was not asked to touch — but it
     * stands down for them, because flying a slow airframe into a telegraphed
     * salvo is two events fighting for the same four seconds of the player's
     * attention, which is the exact failure `_announceAir`'s header records.
     */
    if (r.busy) return;
    if (this.airstrike?.busy || this.bomber?.busy || this.strafe?.busy) return;
    if (this._cath.t >= 0) return;

    for (const team of [0, 1]) {
      if (this._reinforceUsed[team] >= RULES.reinforceMaxPerTeam) continue;
      const mine = this.score[team];
      const theirs = this.score[1 - team];
      const behind = theirs - mine >= RULES.reinforceDeficit;
      const endgame = RULES.scoreTarget - theirs <= RULES.reinforceEndgame;
      if (!behind && !endgame) continue;
      this.reinforceStats.windows[team]++;
      /**
       * `Rng` HAS NO `chance()`. It has `float()`, `range`, `int`, `signed`,
       * `gauss`, `pick`, `disc` and `fork` — and the first version of this line
       * called a method that does not exist, which threw inside the poll every
       * eight seconds for a whole match and meant the drop could never fire.
       * Measured: seed 11 opened SEVEN qualifying windows for RED and produced
       * zero drops and three page errors. A feature guarded by a throw is a
       * feature that is off.
       */
      if (this.rng.float() >= RULES.reinforceChance) continue;
      if (this._callReinforcement(team, t, behind, endgame)) return;
    }
  }

  /**
   * Fly one. Returns false when there was nowhere to put the men, in which case
   * nothing is spent and the next poll tries again.
   */
  _callReinforcement(team, t, behind, endgame) {
    const zone = this._dropZone(team);
    const landings = this._dropPoints(team, zone);
    if (!landings.length) {
      console.warn(
        `[match] reinforcement for ${TEAM_NAME[team]} found no landing ground — not called`
      );
      return false;
    }
    const approach =
      roleOf(team, this.round) === ROLE.ATTACK
        ? this._spawnCentre.attack
        : this._spawnCentre.defend;
    const label = zone ? `ZONE ${zone.id}` : `${TEAM_NAME[team]} LINE`;
    const ok = this.reinforce.fire({
      team,
      label,
      centre: zone ? zone.position : landings[0],
      // The aircraft crosses its OWN side's ground before it crosses the drop
      // zone, so a comeback never flies in over the people it is coming to fight.
      approach,
      landings,
    });
    if (!ok) return false;
    this._reinforceUsed[team]++;
    this._reinforceTeam = team;
    this.reinforceStats.calls++;
    this.reinforceStats.at.push({
      team,
      t: +t.toFixed(1),
      score: this.score.slice(),
      zone: zone?.id ?? 'BASE',
      reason: behind ? (endgame ? 'behind+endgame' : 'behind') : 'endgame',
    });
    console.info(
      `[match] REINFORCEMENTS: ${TEAM_NAME[team]} + ${landings.length} (no respawn) at ` +
        `t=${t.toFixed(0)}s score ${this.score[0]}-${this.score[1]} · ${label} · ` +
        `${behind ? 'behind' : ''}${behind && endgame ? '+' : ''}${endgame ? 'endgame' : ''}`
    );
    return true;
  }

  /**
   * WHICH HELD SITE THE DROP GOES IN AT — "占領されているサイト付近から".
   *
   * A zone this side OWNS, and of those the one nearest the fight
   * (`_airFocus`, the same centroid the three air weapons are aimed by), because
   * ten men put down on the quiet end of the map are ten men who spend the rest
   * of the match walking.
   *
   * IT MAY RETURN NULL, AND THE FALLBACK IS DELIBERATE. The side this event
   * exists for is the side that is being beaten, and a side a hundred points
   * behind very often holds NOTHING — which would make a comeback mechanic
   * unable to fire in exactly the match it was written for. So a side with no
   * zone drops on its own base cluster instead, which is ground it certainly
   * holds and which `resolveLayout` has already proved. The log and the
   * announcement both say which it was.
   */
  _dropZone(team) {
    let best = null;
    let bestD = Infinity;
    for (const z of this.sites) {
      if (z.owner !== team) continue;
      if (!z.stand?.length) continue;
      const d = z.position.distanceToSquared(this._airFocus);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    return best;
  }

  /**
   * `RULES.reinforceCount` places a man can be put down, and EVERY ONE OF THEM
   * IS GROUND SOMEBODY HAS ALREADY PROVED.
   *
   * This is the trap the brief names: "paratroopers must land on ground that
   * exists and is reachable", and `ensureReachable` will either quietly relocate
   * a bad point or hunt for four minutes without a word when there is no ground
   * under it. So nothing here is invented:
   *
   *   • A ZONE's points are `z.stand` — up to eight cells `standRing` snapped to
   *     the nav grid and then A*-PROVED from a spawn of each side, which is a
   *     stronger claim than the drop needs.
   *   • A BASE's points are the spawn cluster, twenty-one cells that
   *     `resolveLayout` proved can reach the sites and that twenty men already
   *     stand on every round.
   *
   * They are handed out ROUND-ROBIN with a rotating offset, so ten men over
   * eight points is at most two men per point and never the same two points
   * every drop. Combined with `RULES.reinforceDropGap` — 0.62 s between
   * touchdowns — that is the whole answer to "ten men landing in one place is a
   * crowding event": at no instant are two men arriving on one cell.
   *
   * The array is rebuilt per drop rather than pooled: a drop happens at most
   * twice a match and the alternative is ten Vector3s living for ever to save an
   * allocation nobody will ever see.
   */
  _dropPoints(team, zone) {
    const src = zone
      ? zone.stand
      : (roleOf(team, this.round) === ROLE.ATTACK ? this.spawns.attack : this.spawns.defend)
          .map((sp) => sp.position);
    if (!src?.length) return [];
    const out = [];
    const rot = this._zoneRotate++;
    for (let i = 0; i < RULES.reinforceCount; i++) {
      const p = src[(i + rot) % src.length];
      /**
       * A metre of scatter about the proved cell, and NOT more: `_jitterOnto`
       * uses 1.1 m for the same reason on every spawn in the game, and the point
       * of a small number is that the man is still on the cell that was proved.
       * The height is re-probed with `ai.groundAt` exactly as `_jitterOnto`
       * does, because a drop zone in the cathedral ruin is not at zone y.
       */
      const a = this.rng.range(0, Math.PI * 2);
      const rad = this.rng.range(0, 1.1);
      const v = new THREE.Vector3(p.x + Math.cos(a) * rad, p.y, p.z + Math.sin(a) * rad);
      v.y = this.ai.groundAt(v.x, v.z, p.y + 3);
      out.push(v);
    }
    return out;
  }

  /**
   * ONE MAN'S FEET TOUCH THE GROUND. Called by `Reinforcements` at touchdown,
   * once per canopy.
   *
   * THIS IS THE SAME CODE PATH AS EVERY OTHER ARRIVAL IN THE GAME and that is
   * on purpose: `ai.spawn` with the side's variant, into the side's `Squad`,
   * `_stampSpawn` so `_assignCacheLegs` has a clock for him, into
   * `_botsByTeam`, on to the roster, and `ai.protect` for `RULES.spawnProtect`
   * — because a man who materialises in a contested zone with no protection is
   * a free kill for whoever is standing in it, and spawn protection is
   * implemented as "not a valid target" rather than immunity, so it cannot make
   * him invulnerable either.
   *
   * THE TWO THINGS THAT ARE DIFFERENT ARE BOTH ON THE ROSTER RECORD:
   *   `noRespawn`      the gate in `_queueRespawn`. @see `RULES.reinforceRespawns`.
   *   `reinforcement`  reporting only, so a probe can tell these ten from the
   *                    twenty who started.
   *
   * A CALLSIGN FROM `REINFORCE_NAMES`, NOT FROM `BOT_NAMES`: the roster grows
   * past the twenty-one names a side has, and `_spawnTeam`'s own note says what
   * happens then — "two men share a name and the killfeed stops being readable".
   */
  _landReinforcement(team, index, position, yaw) {
    if (this.phase !== PHASE.LIVE) return;
    const names = REINFORCE_NAMES[team] ?? REINFORCE_NAMES[0];
    const name = names[index % names.length];
    const variants = TEAM_VARIANTS[team];
    const variant = variants[index % variants.length];
    const agent = this.ai.spawn(variant, position, yaw, {
      team,
      name,
      // Must match `_spawnTeam`, or the persona cache draws a different man.
      role: this.domination ? AI_ROLE_FIELD : roleOf(team, this.round),
    });
    this._squads[team]?.add(agent);
    this._stampSpawn(agent);
    this._botsByTeam[team].push(agent);
    this.roster.push({
      name,
      team,
      kills: 0,
      deaths: 0,
      alive: true,
      isPlayer: false,
      actor: agent,
      role: roleOf(team, this.round),
      variant,
      slot: this.roster.length,
      /** THE WHOLE RULE. @see `_queueRespawn`. */
      noRespawn: true,
      reinforcement: true,
    });
    this.ai.protect(agent, RULES.spawnProtect);
    this.reinforceStats.landed[team]++;
    this.ctx.events.emit('match:respawn', { name, team, isPlayer: false });
    // Re-cut the plan on the LAST man, not on each: `_assignObjectives` walks
    // every live actor of both sides and running it ten times in six seconds is
    // ten full re-tasks for nine partial rosters.
    if (index >= RULES.reinforceCount - 1) this._assignObjectives();
  }

  /**
   * THE ANNOUNCEMENT. It reuses `_announceAir`'s record and `ui.airAlert`,
   * because "an aircraft is coming and here is where it is going" is exactly
   * what that strip was built to say — @see `src/ui/airalert.js`, whose own
   * header is about air events that fired correctly for weeks while the player
   * reported they never happened.
   *
   * IT IS TOLD TO BOTH SIDES, in the sense that there is one HUD and it is the
   * human's: if the drop is his, it is help arriving; if it is the enemy's, it
   * is ten men about to land on a point and the ten seconds of warning is the
   * only chance to be somewhere else. The banner says which.
   */
  _announceReinforce(info) {
    if (!info) return;
    const mine = this._reinforceTeam === this.playerTeam;
    const h = this._airHud;
    h.kind = 'REINFORCE';
    h.name = info.name ?? '';
    h.lead = info.lead ?? RULES.reinforceLead;
    const p = info.position;
    h.x = p?.x ?? 0;
    h.y = p?.y ?? 0;
    h.z = p?.z ?? 0;
    h.title = mine ? 'REINFORCEMENTS INBOUND' : 'ENEMY REINFORCEMENTS';
    h.impactTitle = mine ? 'REINFORCEMENTS DOWN' : 'ENEMY ON THE GROUND';
    // The drop zone as a world reticle, the same one an impact gets: it is the
    // patch of ground that is about to matter.
    for (let i = 0; i < info.count; i++) this.ui.airDanger(info.points[i], h.lead, 'DROP');
    this.ui.airAlert(h);
    this.ui.banner.show(
      h.title,
      `${RULES.reinforceCount} ${mine ? 'FRIENDLIES' : 'HOSTILES'} · ${info.name}`,
      2.6
    );
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * HOW FAR THROUGH THE MATCH WE ARE — 0 at the start, 1 at whichever end
   * actually arrives.
   * ────────────────────────────────────────────────────────────────────────
   * A DOMINATION match has TWO endings and the wrong one was being scheduled
   * against. `matchTime` is 600 s, but `scoreTarget` is 250 and two zones held
   * is a point a second, so every measured match ended on points at t = 276..288
   * — and every absolute second in `RULES` had been authored against the 600.
   * That is not a mistuned number, it is a schedule whose late half never
   * happens; @see `RULES.finalCollapseProgress`.
   *
   * `max` of the two fractions rather than a blend, because either one reaching
   * 1 ends the match, so the larger is always the better estimate of how close
   * the end is. Both terms are monotone, so the result is monotone and an event
   * latched on a threshold cannot un-fire. It reads the LEADER's score: the
   * match ends when somebody gets there, not when both do.
   *
   * No allocation, no rate estimator and nothing to predict — a match decided in
   * four minutes and one that runs the clock out in ten both put the cathedral
   * at the same point in the SHAPE of the match.
   */
  _matchProgress() {
    const byClock = 1 - Math.max(0, this.roundClock) / RULES.matchTime;
    const lead = this.score[0] > this.score[1] ? this.score[0] : this.score[1];
    const byScore = RULES.scoreTarget > 0 ? lead / RULES.scoreTarget : 0;
    return byClock > byScore ? byClock : byScore;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * LEVEL THE BUILDING ITSELF — "大聖堂自体を破壊して更地にする"
   * ────────────────────────────────────────────────────────────────────────
   * The `CATHEDRAL` salvo takes three bays of AISLE ROOF off, which reads as a
   * church with a hole in it and not as the thing the brief asks for: "大爆撃に
   * よる大聖堂周りを瓦礫の山にして、大聖堂自体を破壊して更地に". Levelling the
   * arcade, the clerestory, the vault, the dome and the campanile is a
   * different job from cratering a roof, and it belongs to whoever built them —
   * so it lives in `src/world/cathedral.js`, baked at BOOT exactly like every
   * other destruction in this project, and this is the one line that fires it.
   *
   * REACHED THROUGH `ctx.get('world')` AND NOTHING ELSE. `world.cathedral` is the
   * record `buildCathedral` already returns and `WorldSystem` already holds; the
   * raze is a method on it. `match` may no more import `world/cathedral.js` than
   * it may import `ai/nav.js`. Optional at every step, because a `world` that
   * has not been given the hook must leave the match playable rather than throw
   * in the middle of a scheduled event.
   *
   * Idempotent in `world` — calling it twice is the second call returning false.
   */
  _razeCathedral() {
    return this._setCathedralRazed(true);
  }

  /* ==================================================================== */
  /* THE CATHEDRAL EVENT                                                  */
  /* ==================================================================== */

  /**
   * ────────────────────────────────────────────────────────────────────────
   * WHERE THE SHELLS GO, SOLVED ONCE AT BOOT
   * ────────────────────────────────────────────────────────────────────────
   * "大聖堂崩壊イベントは過激にそして激しく破壊し、大イベントにしてください."
   *
   * `RULES.cathedralBarrageShells` heavy shells walking the length of the nave
   * and out into both flanking streets. Every aiming point is a pair of offsets
   * on the cathedral's OWN axes — across the nave and along it — drawn here from
   * `this.rng` and stored in two Float32Arrays, so the frame a shell fires does
   * one multiply-add per axis into a preallocated vector and nothing else.
   *
   * A CREEPING BARRAGE, NOT A SCATTER. `i` walks `along` monotonically from one
   * end of the building to the other with a jittered `across`, so what the
   * player sees is a line of fire coming up the nave at them rather than twenty
   * unrelated bangs — which is the difference between a bombardment and a noise
   * floor. Every fourth shell is thrown wide into a flank street, because a
   * building being levelled takes its pavements with it.
   *
   * The axes are two `levelToWorld` calls: `world` owns the level's rotation,
   * `match` may not assume it, and the cathedral is authored square to the plan.
   */
  _bakeCathedralBarrage() {
    const n = RULES.cathedralBarrageShells;
    const world = this.ctx.peek('world');
    if (world?.levelToWorld) {
      const o = world.levelToWorld(0, 0, 0, this._v);
      const ox = o.x;
      const oz = o.z;
      const a = world.levelToWorld(10, 0, 0, this._v2);
      this._cathAxisU.set(a.x - ox, 0, a.z - oz).normalize();
      const b = world.levelToWorld(0, 0, 10, this._v2);
      this._cathAxisV.set(b.x - ox, 0, b.z - oz).normalize();
    }
    const hw = RULES.cathedralBarrageHalfW;
    const hd = RULES.cathedralBarrageHalfD;
    const rng = this.rng.fork();
    for (let i = 0; i < n; i++) {
      /**
       * THE FIRST TWO GO ON THE TWO PORTALS, AND THAT IS A PHOTOGRAPH RATHER
       * THAN A PREFERENCE. The mid street runs the length of the nave and the
       * player is at one end of it or the other; a walk that starts inside the
       * footprint of a building that is still standing puts its opening rounds
       * where the building itself hides them, and the first pass of
       * `_evshots.mjs` caught exactly that — six shells down and nothing on
       * screen but a flat facade. Both ends first, so the bombardment announces
       * itself from wherever you are watching, and the walk follows.
       */
      if (i < 4) {
        // Both portals, then both flank streets: four rounds that are OUTSIDE
        // the standing shell and therefore visible from anywhere in the middle
        // of the map, before the walk goes inside where the building hides it.
        const portal = i < 2;
        this._cathU[i] = portal ? rng.range(-3, 3) : (i === 2 ? -1 : 1) * hw * 0.95;
        this._cathV[i] = portal ? (i === 0 ? -1 : 1) * hd * 0.98 : rng.range(-hd * 0.5, hd * 0.5);
        continue;
      }
      const t = (i - 4) / Math.max(1, n - 5);
      // Along the nave, end to end, with enough jitter that the walk is not a
      // metronome. Alternating the direction of the sweep would read as a
      // pendulum; one pass in one direction reads as a barrage being walked.
      const along = (-1 + 2 * t) * hd + rng.range(-2.2, 2.2);
      // Every fourth round goes wide, into the flank street on alternate sides.
      const wide = i % 4 === 3;
      const across = wide
        ? (i % 8 === 3 ? 1 : -1) * rng.range(hw * 0.72, hw)
        : rng.range(-hw * 0.62, hw * 0.62);
      this._cathU[i] = across;
      this._cathV[i] = along;
    }
  }

  /**
   * Aiming point `i`, in world space, written into the reused `_bombPos`. Every
   * caller (`ui.airDanger` and the `explosion` payload) copies out of it
   * synchronously, exactly as `_bombardPoint`'s callers do.
   */
  _cathAim(i) {
    const c = this.lockedZone?.position;
    const p = this._bombPos;
    if (!c) return p.set(0, 0.4, 0);
    p.copy(c);
    p.y += 0.4;
    p.addScaledVector(this._cathAxisU, this._cathU[i]);
    p.addScaledVector(this._cathAxisV, this._cathV[i]);
    return p;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE WARNING — beat 0 of the beat sheet in `RULES.cathedralLead`
   * ────────────────────────────────────────────────────────────────────────
   * Ten seconds before anything lands, and it is the half of the event the old
   * one did not have at all: the only telegraph was the salvo's own 4.4 s of
   * jet and whistle, which is not enough time to cross the square it is aimed
   * at, so the only available reaction was to already be somewhere else.
   *
   * Three channels, all of them ones the HUD already speaks: the alert strip
   * with a live bearing and a countdown bar (`ui.airAlert`), a world-space
   * danger reticle on every sixth aiming point so the beaten zone reads as an
   * AREA rather than a dot, and the banner. Plus the siren — the jet note this
   * file's other events use, held for the whole lead and mixed loud, over a map
   * whose middle is about to stop existing.
   */
  _beginCathedralEvent(t, p) {
    this._cathedralCalled = true;
    this._cath.t = 0;
    this._cath.beat = 0;
    this._cath.shot = 0;

    const z = this.lockedZone;
    const h = this._airHud;
    h.kind = 'SALVO';
    h.title = 'THE CATHEDRAL IS BEING LEVELLED';
    // NOT "GONE" — the strip flips to its impact read the moment the countdown
    // expires, and at that instant the building is still standing with the first
    // bays only just coming off it. Photographed reading "THE CATHEDRAL IS GONE"
    // over an intact facade. The `raze` beat owns that line. @see `_cathBeat`.
    h.impactTitle = 'THE CATHEDRAL UNDER BOMBARDMENT';
    h.name = z?.name ?? 'THE CATHEDRAL';
    h.lead = RULES.cathedralLead;
    h.x = z?.position.x ?? 0;
    h.y = z?.position.y ?? 0;
    h.z = z?.position.z ?? 0;
    this.ui.airAlert(h);
    // Six reticles across the footprint: the whole building is the target.
    for (let i = 0; i < RULES.cathedralBarrageShells; i += 3) {
      this.ui.airDanger(this._cathAim(i), RULES.cathedralLead, 'BOMBARDMENT');
    }
    this.ui.banner.show(
      'THE CATHEDRAL IS BEING LEVELLED',
      `${RULES.cathedralLead | 0} SECONDS · GET OUT OF THE MIDDLE`,
      4.2
    );
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    audio?.play?.('strike_jet', z?.position ?? null, {
      level: 1.2, dur: RULES.cathedralLead, maxDist: 500, gain: 3.6, occlusion: 0.15,
    });
    console.info(
      `[match] CATHEDRAL EVENT called at t=${t.toFixed(0)}s p=${p.toFixed(2)} — ` +
        `${RULES.cathedralLead}s warning, ${RULES.cathedralBarrageShells} shells over ` +
        `${RULES.cathedralBarrageSpan}s, salvo at +${RULES.cathedralLead}s, shell down at ` +
        `+${(RULES.cathedralLead + RULES.cathedralRazeDelay).toFixed(1)}s, D opens at ` +
        `+${(RULES.cathedralLead + RULES.cathedralOpenDelay).toFixed(1)}s`
    );
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE BEAT SHEET, PLAYED
   * ────────────────────────────────────────────────────────────────────────
   * `_cath.beat` is a monotone index into `CATH_BEATS` below, so every beat
   * fires exactly once and a long frame plays the ones it skipped rather than
   * dropping them. The barrage runs alongside on its own count, the same shape
   * `_updateBombard` uses for the zone shelling.
   *
   * NOTHING HERE BUILDS ANYTHING. The salvo, its 1467 chunks, their closed-form
   * trajectories, the settled pose and the nav patch were baked at boot; the two
   * aircraft are the runs `Bomber` and `Strafe` baked at boot; the shell swap is
   * `mask.fill()` plus a memcpy'd pose in `world`; the barrage's aiming points
   * were solved in `_bakeCathedralBarrage`. The heaviest frame in the event is
   * the salvo's own, which is the frame the old event already had.
   */
  _updateCathedralEvent(dt) {
    const c = this._cath;
    c.t += dt;
    const LEAD = RULES.cathedralLead;

    /* ---- the scored beats --------------------------------------------- */
    while (c.beat < CATH_BEATS.length && c.t >= LEAD + CATH_BEATS[c.beat][0]) {
      const beat = CATH_BEATS[c.beat++];
      this._cathBeat(beat[1]);
    }

    /* ---- the barrage, walking ----------------------------------------- */
    // It opens BEFORE the salvo — the first rounds are what makes the salvo the
    // second thing that happens rather than the first.
    const n = RULES.cathedralBarrageShells;
    const t0 = LEAD - 3.0;
    if (c.shot < n && c.t >= t0) {
      const step = RULES.cathedralBarrageSpan / n;
      const due = Math.min(n, Math.floor((c.t - t0) / step) + 1);
      while (c.shot < due) this._cathShell(c.shot++);
    }

    /* ---- and it is over ----------------------------------------------- */
    // The last beat is D opening; the barrage's tail lands four seconds before
    // it. Both have to be spent, so a frame long enough to swallow either one
    // still leaves the other to be played rather than dropping it.
    if (c.beat >= CATH_BEATS.length && c.shot >= n) c.t = -1;
  }

  /** One named beat. Kept apart from the clock so the sheet reads as a sheet. */
  _cathBeat(kind) {
    switch (kind) {
      case 'salvo': {
        // Called `JET_LEAD` BEFORE the beat it is scheduled on, so the strike's
        // own jet-and-whistle telegraph lands inside this event's warning
        // instead of after it. That ordering is the whole bug this replaces.
        const fired = this.airstrike?.callCathedralCollapse?.() ?? false;
        console.info(`[match] cathedral salvo ${fired ? 'fired' : 'declined — already down'}`);
        break;
      }
      case 'bomber':
        this.bomber?.fire?.('MAIN');
        break;
      case 'raze': {
        const razed = this._razeCathedral();
        // …and the strip is taken back off the sub-events, with a second
        // countdown that runs to the last shell of the barrage. The alert puts
        // itself away 2.2 s after its lead expires, so without this the event's
        // own headline would be gone for the whole second half of it.
        const z = this.lockedZone;
        const h = this._airHud;
        h.kind = 'SALVO';
        h.title = 'THE CATHEDRAL IS COMING DOWN';
        h.impactTitle = 'THE CATHEDRAL IS GONE';
        h.name = z?.name ?? 'THE CATHEDRAL';
        h.lead = 9.0 - RULES.cathedralRazeDelay;
        h.x = z?.position.x ?? 0;
        h.y = z?.position.y ?? 0;
        h.z = z?.position.z ?? 0;
        this.ui.airAlert(h);
        console.info(
          `[match] cathedral SHELL DOWN at +${(RULES.cathedralLead + RULES.cathedralRazeDelay).toFixed(1)}s ` +
            `(${razed ? 'levelled' : 'no ruin state available'})`
        );
        break;
      }
      case 'strafe':
        this.strafe?.fire?.('MAIN');
        break;
      case 'aftermath': {
        this.ui.airImpact('THE CATHEDRAL IS GONE');
        this.ui.banner.show('THE CATHEDRAL IS GONE', 'THE MIDDLE OF THE MAP IS RUBBLE', 3.6);
        const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
        audio?.play?.('strike_rubble', this.lockedZone?.position ?? null, {
          level: 1.2, dur: 5.0, maxDist: 420, gain: 2.4, occlusion: 0.2,
        });
        break;
      }
      case 'open':
        this._openCathedral();
        break;
      case 'armour':
        // THE CONSEQUENCE — "大聖堂破壊イベントの後には戦車も登場させて". One line;
        // everything after it is the sortie scheduler `Armour` already had.
        // @see `RULES.tankAfterCathedral`.
        this.tank?.armAfter?.(RULES.tankAfterCathedral);
        break;
      default:
        break;
    }
  }

  /** Shell `i` of the barrage. Same shape as `_updateBombard`, aimed at a building. */
  _cathShell(i) {
    const at = this._cathAim(i);
    const p = this._blast;
    // Head height, not crater floor. @see `RULES.blastBurstHeight`.
    p.position = this._blastPos.copy(at).setY(at.y + RULES.blastBurstHeight);
    p.radius = RULES.cathedralBarrageRadius;
    p.damage = RULES.cathedralBarrageDamage;
    p.source = null;
    this.ctx.events.emit('explosion', p);
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (fx) {
      fx.explosion?.({ position: at, radius: RULES.cathedralBarrageRadius * 0.65 });
      fx.scorch?.(at.x, at.y - 0.3, at.z, RULES.cathedralBarrageRadius * 0.55);
      fx.hazeRing?.(at.x, at.y, at.z, 3.4, 18, 0.5, 2.0);
      if (fx.lights) fx.lights.flash(at.x, at.y + 1, at.z, 1, 0.66, 0.34, 1300, 0.6, 8, 52, 4);
    }
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    audio?.play?.('strike_tail', at, { level: 1.0, dur: 2.6, maxDist: 340, gain: 2.0, occlusion: 0.2 });
  }

  /**
   * Put the cathedral into one of its two states, or report that it has no
   * second state to be in.
   *
   * `down = false` is ALSO the boot-time prime: the ruin scope is assembled
   * visible (that is what `beginScope` records) and cannot hide itself, because
   * `buildCathedral` returns before `Assembler.finalize` has built a mesh to
   * hide. So the first call of the match is what puts it away — and the same
   * call is what stands the church back up between matches, which `_beginRound`
   * already promises: "A new match starts with the cathedral standing".
   *
   * `physics` is fetched here and handed over because `Assembler` does not
   * retain it. `peek`, not `get`, at both steps: this runs inside a scheduled
   * event and a missing subsystem must leave the match playable.
   *
   * AND IT IS THE ONE PLACE THE AI IS TOLD, which is why the `ai.setCoverRazed`
   * line is here and not at the three call sites. `ai.cover` is a table of
   * places worth taking cover at, and every entry in it names the DIRECTION of
   * the mass it hides behind — so the frame the shell stops being solid, 304 of
   * the 634 points inside the footprint describe air (`_coverstale.mjs`), 27 of
   * them inside D, the point that opens in the wreckage. `ai` bakes a second
   * table at boot against the ruin and this hands it the switch; both states of
   * the map are covered by all three callers — the boot prime, the raze, and
   * the round reset that stands the church back up.
   */
  _setCathedralRazed(down) {
    const cath = this.ctx.peek?.('world')?.cathedral;
    if (typeof cath?.setRazed !== 'function') return false;
    const changed = cath.setRazed(down, this.ctx.peek?.('physics')) === true;
    this.ai?.setCoverRazed?.(down);
    return changed;
  }

  /**
   * D GOES LIVE IN THE WRECKAGE.
   *
   * Three things, in this order, and the first is the one the brief is about:
   *
   * 1. RE-PROBE THE NAV. `Airstrike` re-probes the cells its own mounds cover
   *    and applies them as a loop over three flat arrays; the ruin's own floor
   *    is a different question and it is asked here, over D's circle, with the
   *    town in the state it is actually in. It is the same `probeCell` the
   *    strike uses and it NEVER calls `grid.build()` — 400-odd cells against
   *    205 000. Measured and printed: if the collapse changed nothing under the
   *    dome, the number is zero and that is the honest answer.
   * 2. PUSH IT INTO `sites`. Every consumer in this file — the objective plan,
   *    the HUD strip, forward spawns, the win check, `CaptureZones` itself —
   *    iterates that one array, so a zone joining the match is one push and no
   *    special case anywhere. @see `_setZoneLive`
   * 3. TELL THE PLAYER, in the same three places every air event uses.
   */
  _openCathedral() {
    const z = this.lockedZone;
    if (!z || this.sites.includes(z)) return;
    const cells = this._reprobeZoneNav(z);
    this._setZoneLive(z, true);
    this.capture?.resetZone(z, this.ctx.time.elapsed);
    this.ui.banner.show('SITE D IS OPEN', `${z.name} · CONTEST THE RUIN`, 3.4);
    this._airHud.kind = 'STRIKE';
    this._airHud.title = 'SITE D OPEN';
    this._airHud.impactTitle = 'SITE D OPEN';
    this._airHud.name = z.name;
    this._airHud.lead = 6;
    this._airHud.x = z.position.x;
    this._airHud.y = z.position.y;
    this._airHud.z = z.position.z;
    this.ui.airAlert(this._airHud);
    this.ui.airDanger(z.position, 6, 'SITE D');
    this._assignObjectives();
    console.info(
      `[match] SITE D OPEN — ${z.name} at ${z.position.x.toFixed(1)}, ${z.position.z.toFixed(1)} ` +
        `· ${z.stand.length} standing points · ${cells} nav cells re-probed in the ruin ` +
        `· ${this.sites.length} zones live`
    );
    this.ctx.events.emit('match:capture', {
      zone: z.id,
      owner: -1,
      previous: -1,
      score: this.score,
    });
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * RE-PROBE THE HEIGHT FIELD IN THE RUIN, FROM INSIDE IT
   * ────────────────────────────────────────────────────────────────────────
   * A loop over the ~400 cells of D's circle, not the grid's 205 209, and it
   * never calls `grid.build()` — that is seconds on this map and a zone that
   * opens mid-match cannot afford one of them. Same shape as
   * `Airstrike._bakeNavPatch`: re-probe a rectangle, write three flat arrays.
   *
   * THE ONE THING IT DOES DIFFERENTLY IS THE ONLY THING THAT MATTERS HERE.
   * `Airstrike`'s `probeCell` drops ONE RAY FROM ABOVE THE LEVEL, which is what
   * `NavGrid.build`'s open-air pass does and is correct for a mound of rubble in
   * a street. Run over the nave it would find the CATHEDRAL VAULT AT 26.2 m and
   * put every cell of site D on the roof — the exact failure
   * `NavGrid._carveInteriors` exists to defeat (the boot probe measures the nave
   * floor at 0.16 m and a sky ray at 26.20 m over the same cell).
   *
   * So this probes DOWNWARD FROM JUST ABOVE THE FLOOR THE GRID ALREADY HAS, and
   * refuses any answer more than `MAX_STEP` away from it. That makes the pass
   * strictly conservative: it can raise a cell on to new rubble, and it can shut
   * a cell that is now blocked, and it CANNOT move a cell to another storey. A
   * mistake here is a ruin bots will not enter, which is the one outcome the
   * whole feature is about.
   *
   * Returns how many cells actually changed, so "the ruin is walkable" is a
   * number in the log rather than a claim in a comment.
   */
  _reprobeZoneNav(z) {
    const g = this.ai?.grid;
    const ph = this.ctx.peek('physics');
    if (!g || !ph) return 0;
    const MASK = ph.MASK.WORLD;
    /** How far above the known floor the ray starts, and how far it may move. */
    const START_UP = 5.0;
    const MAX_STEP = 2.5;
    const pad = z.radius + 2.4;
    const ix0 = Math.max(0, g.cellX(z.position.x - pad));
    const ix1 = Math.min(g.nx - 1, g.cellX(z.position.x + pad));
    const iz0 = Math.max(0, g.cellZ(z.position.z - pad));
    const iz1 = Math.min(g.nz - 1, g.cellZ(z.position.z + pad));
    let changed = 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = g.index(ix, iz);
        if (g.flags[i] === 0) continue; // it was not walkable; rubble cannot open it
        const x = g.worldX(ix);
        const zz = g.worldZ(iz);
        const y0 = g.floor[i];
        const down = ph.raycast(x, y0 + START_UP, zz, 0, -1, 0, START_UP + 0.6, MASK);
        if (!down.hit) continue; // nothing under it any more: leave the old answer
        const ny = down.point.y;
        if (Math.abs(ny - y0) > MAX_STEP) continue; // a different storey — not ours
        // Too steep to stand on is the same test the grid's own pass makes.
        if (down.normal.y < g.maxSlope) {
          if (g.flags[i] !== 0) {
            g.flags[i] = 0;
            changed++;
          }
          continue;
        }
        const up = ph.raycast(x, ny + 0.25, zz, 0, 1, 0, g.height - 0.2, MASK);
        const flag = !up.hit ? 1 : up.distance > g.crouchHeight - 0.25 ? 2 : 0;
        if (g.flags[i] === flag && Math.abs(g.floor[i] - ny) <= 0.02) continue;
        g.flags[i] = flag;
        g.floor[i] = ny;
        changed++;
      }
    }
    return changed;
  }

  /**
   * Add or remove a zone from the LIVE list, keeping the three parallel arrays
   * that are indexed by it in step.
   *
   * `this.sites`, `this._plan` and `this._hud.zones` are all walked by index —
   * `_assignDomination` and `_publishZones` both do `for (i < sites.length)` and
   * write `plan[i]` / `h.zones[i]` — so they grow and shrink together or the
   * fourth zone reads off the end of the second array. `CaptureZones` holds the
   * SAME array object as `this.sites`, which is why it needs no call here.
   */
  _setZoneLive(z, on) {
    const i = this.sites.indexOf(z);
    if (on) {
      if (i >= 0) return;
      this.sites.push(z);
      this._plan.push({ zone: z, mode: 'hold', want: 0, prio: 0, filled: 0 });
      this._hud.zones.push(this._zoneHudRecord(z));
      this.marks.setVisible(z, true);
      this.marks.setOwner(z, -1);
      return;
    }
    if (i < 0) return;
    this.sites.splice(i, 1);
    this._plan.splice(i, 1);
    this._hud.zones.splice(i, 1);
    this.marks.setVisible(z, false);
    if (this._focus[0] === z) this._focus[0] = null;
    if (this._focus[1] === z) this._focus[1] = null;
  }

  /**
   * A STRIKE ON A CAPTURE POINT — "camping kills you", with an answer.
   *
   * It picks whichever of A and B has been held longest by the side that holds
   * it, so it lands on the point that is being SAT on rather than on the one
   * being fought over, and it walks `zoneBombardShells` impacts across the
   * circle so there is no safe metre inside it. `zoneBombardLead` seconds of
   * `ui.airAlert` with the zone named and a world marker on every impact point
   * is what makes the right answer "move for ten seconds": step outside r8, let
   * it land, walk back on. Standing still is the only thing it punishes.
   */
  _callZoneBombard() {
    const [lo, hi] = RULES.zoneBombardInterval;
    this._bombardIn = this.rng.range(lo, hi);
    const now = this.ctx.time.elapsed;
    let target = null;
    let best = -1;
    for (const z of this.sites) {
      /**
       * EVERY PERMANENT POINT, NOT `'A'` AND `'B'`.
       *
       * The rule is "camping kills you" and the id list was written when there
       * were three zones and only two of them were flank districts. There are
       * four permanent points now — A, C, E, B — and hard-coding two of them
       * means half the map may be sat on for the whole match with no answer,
       * which is the failure this rule exists to prevent rather than a tuning
       * preference. D is out because D is the locked point: it only exists at
       * all because a bombardment levelled the building it stands in, and the
       * contest for the ruin is the event's own consequence.
       */
      if (z.locked) continue;
      if (z.owner < 0) continue;
      const held = now - z.ownedSince;
      if (held > best) {
        best = held;
        target = z;
      }
    }
    // Nobody is camping anything: nothing to punish, ask again on the next gap.
    if (!target || best < 20) return;
    this._bombard.zone = target;
    this._bombard.t = RULES.zoneBombardLead;
    this._bombard.shot = 0;
    this._announceBombard(target);
    console.info(
      `[match] ZONE BOMBARDMENT on ${target.id} — held by ${TEAM_NAME[target.owner]} for ` +
        `${best.toFixed(0)}s, ${RULES.zoneBombardShells} shells in ${RULES.zoneBombardLead}s`
    );
  }

  /** The telegraph: the strip, a world marker per impact point, the banner. */
  _announceBombard(z) {
    const h = this._airHud;
    h.kind = 'BOMBARD';
    h.title = `ARTILLERY ON ${z.id}`;
    h.impactTitle = `${z.id} UNDER FIRE`;
    h.name = z.name;
    h.lead = RULES.zoneBombardLead;
    h.x = z.position.x;
    h.y = z.position.y;
    h.z = z.position.z;
    this.ui.airAlert(h);
    for (let i = 0; i < RULES.zoneBombardShells; i++) {
      this.ui.airDanger(this._bombardPoint(z, i), RULES.zoneBombardLead, 'ARTILLERY');
    }
    const mine = z.owner === this.playerTeam;
    this.ui.banner.show(
      `ARTILLERY ON ${z.id}`,
      mine ? `${z.name} · GET OFF THE POINT` : `${z.name} · ${TEAM_NAME[z.owner]} UNDER FIRE`,
      2.6
    );
  }

  /**
   * Impact `i` of the walk, in the zone's own frame. Reused vector — every
   * caller copies out of it synchronously (`ui.airDanger` and the blast payload
   * both do), and this runs five times per bombardment, not per frame.
   */
  _bombardPoint(z, i) {
    const n = RULES.zoneBombardShells;
    const a = (i / n) * Math.PI * 2 + z.position.x * 0.37;
    const r = i === 0 ? 0 : RULES.zoneBombardSpread * (0.45 + 0.55 * ((i * 7) % n) / n);
    return this._bombPos.set(
      z.position.x + Math.cos(a) * r,
      z.position.y + 0.4,
      z.position.z + Math.sin(a) * r
    );
  }

  /** The shells landing, one every `zoneBombardLead / shells` seconds. */
  _updateBombard(dt) {
    const b = this._bombard;
    if (!b.zone) return;
    b.t -= dt;
    const step = RULES.zoneBombardLead / (RULES.zoneBombardShells + 3);
    // The lead is the WARNING; the walk starts when it expires and takes three
    // more steps to cross the circle, so leaving late still costs you.
    if (b.t > 0) return;
    const due = Math.min(RULES.zoneBombardShells, Math.floor(-b.t / step) + 1);
    while (b.shot < due) {
      const at = this._bombardPoint(b.zone, b.shot);
      const p = this._blast;
      // Head height, not crater floor. @see `RULES.blastBurstHeight`.
      p.position = this._blastPos.copy(at).setY(at.y + RULES.blastBurstHeight);
      p.radius = RULES.zoneBombardRadius;
      p.damage = RULES.zoneBombardDamage;
      p.source = null;
      this.ctx.events.emit('explosion', p);
      const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
      if (fx) {
        fx.explosion?.({ position: at, radius: RULES.zoneBombardRadius * 0.6 });
        fx.scorch?.(at.x, at.y - 0.3, at.z, RULES.zoneBombardRadius * 0.5);
        fx.hazeRing?.(at.x, at.y, at.z, 3.0, 16, 0.5, 1.8);
        if (fx.lights) fx.lights.flash(at.x, at.y + 1, at.z, 1, 0.68, 0.36, 1100, 0.55, 7, 46, 4);
      }
      const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
      audio?.play?.('strike_tail', at, { level: 0.95, dur: 2.4, maxDist: 300, gain: 1.9, occlusion: 0.2 });
      if (b.shot === 0) this.ui.airImpact(`${b.zone.id} UNDER FIRE`);
      b.shot++;
    }
    if (b.shot >= RULES.zoneBombardShells) b.zone = null;
  }

  /* ------------------------------------------------------------- armour -- */

  /**
   * WHO THE TANK CREW MAY SHOOT AT. Filled into a list the caller owns and
   * reuses, so this allocates nothing; called once every
   * `ACQUIRE_EVERY` (0.4 s) per hull, not per frame.
   *
   * The two filters are the ones every other shooter on the map goes through:
   * a corpse is not a target (`alive`), and neither is a man inside his spawn
   * protection (`ai.targetable`, which `match` sets on every respawn for bots
   * and the human alike). The local player is on the list on the same terms as
   * anybody else — the tank does not know which of its targets has a camera.
   */
  _tankEnemies(team, out) {
    const foe = team === 0 ? 1 : 0;
    for (const a of this._botsByTeam[foe]) {
      if (a.alive && this.ai.targetable(a)) out.push(a);
    }
    if (this.playerTeam === foe && !this.player.dead && this.ai.targetable(this.player)) {
      out.push(this.player);
    }
    return out;
  }

  /**
   * A HULL BREWED UP, AND SOMEBODY GETS PAID FOR IT.
   *
   * `RULES.tankKillScore` on to the killer's side of the DOMINATION score — the
   * same array the zones print into, so it moves the same bar and can win the
   * match. That is the whole reason the tank is worth turning to fight: 30
   * points is fifteen seconds of holding two zones, taken in one play.
   *
   * `by` is whatever landed the last round. It can be a man on either side, and
   * it can be nothing at all (an airstrike, or the other tank's shell), in which
   * case nobody is paid and the killfeed says so.
   */
  _onTankKill(tank, by) {
    const killerTeam = by ? this.ai.teamOf(by) : -1;
    // A tank killed by its own side's shell or grenade pays nobody.
    const paid = killerTeam === 0 || killerTeam === 1 ? killerTeam !== tank.team : false;
    if (paid && this.capture) this.capture.score[killerTeam] += RULES.tankKillScore;
    const kr = by ? this._record(by) : null;
    if (kr) kr.kills++;
    this.ui.killfeed.push({
      attacker: kr ? kr.name : by?.name ?? 'WORLD',
      victim: tank.name,
      headshot: false,
      mine: kr?.isPlayer === true,
      attackerFriendly: killerTeam === -1 ? true : killerTeam === this.playerTeam,
    });
    if (paid) {
      const mine = killerTeam === this.playerTeam;
      this.ui.banner.show(
        mine ? 'TANK DESTROYED' : 'ARMOUR LOST',
        `${tank.name} · ${mine ? '+' : ''}${RULES.tankKillScore} ${TEAM_NAME[killerTeam]}`,
        2.4
      );
    }
    console.info(
      `[match] ${tank.name} destroyed by ${kr?.name ?? by?.name ?? 'the environment'} — ` +
        `${paid ? `+${RULES.tankKillScore} to ${TEAM_NAME[killerTeam]}` : 'no credit'} · ` +
        `score ${this.score[0]}-${this.score[1]}`
    );
  }

  _collectSquad() {
    const out = this._squad;
    out.length = 0;
    for (const a of this._botsByTeam[this.playerTeam]) if (a.alive) out.push(a);
  }

  /* ---------------------------------------------------------- bot work -- */

  /**
   * Bots do not get a special-cased plant: they walk to the objective through
   * the same navigation everything else uses, and this only turns "standing on
   * the objective" into progress on it.
   */
  _updateBotObjectiveWork(dt) {
    const b = this.bomb;

    // The player can walk up and take over a charge a bot is already working.
    // Whoever loses it has to be released, or they stand there frozen — the
    // `working` flag is what stops an actor moving and shooting.
    if (b.workKind === 'plant-player' || b.workKind === 'defuse-player') {
      for (const a of this.ai.agents) if (a.working) a.working = null;
    }

    // ---- pickup -------------------------------------------------------
    if (b.loose) {
      for (const a of this._botsByTeam[this.attackers]) {
        if (!a.alive) continue;
        // 3 m rather than arm's length: a bot walking a path is not steering to
        // the centimetre, and a charge you have to stand exactly on is a charge
        // that gets walked past.
        if (a.position.distanceToSquared(b.position) < 3 * 3) {
          b.giveTo(a);
          this._assignObjectives();
          this.ctx.events.emit('match:bomb', { state: b.state, site: null, fuse: 0, carrier: a.name });
          break;
        }
      }
    }

    // ---- plant --------------------------------------------------------
    const carrier = b.state === BOMB.CARRIED ? b.carrier : null;
    if (carrier && carrier !== this.player) {
      const site = this._siteAt(carrier.position);
      if (site) {
        carrier.working = 'plant';
        b.worker = carrier;
        b.workKind = 'plant';
        b.progress = Math.min(1, b.progress + dt / RULES.plantTime);
        if (b.progress >= 1) {
          this._v.copy(carrier.position);
          this._v.y = this.ai.groundAt(this._v.x, this._v.z, this._v.y + 2) + 0.01;
          b.plant(site, this._v, carrier.yaw);
          carrier.working = null;
          this._onPlanted(site);
        }
      } else if (b.worker === carrier) {
        carrier.working = null;
        b.worker = null;
        b.progress = 0;
      }
    }

    // ---- defuse -------------------------------------------------------
    if (b.armed) {
      let worker = b.worker && b.worker !== this.player ? b.worker : null;
      if (worker && (!worker.alive || worker.position.distanceToSquared(b.position) > RULES.defuseRadius ** 2)) {
        worker.working = null;
        worker = null;
        if (b.workKind === 'defuse') b.progress = 0;
      }
      if (!worker && b.workKind !== 'defuse-player') {
        for (const a of this._botsByTeam[this.defenders]) {
          if (!a.alive) continue;
          if (a.position.distanceToSquared(b.position) <= RULES.defuseRadius ** 2) {
            worker = a;
            break;
          }
        }
      }
      if (worker) {
        worker.working = 'defuse';
        b.worker = worker;
        b.workKind = 'defuse';
        b.progress = Math.min(1, b.progress + dt / RULES.defuseTime);
        if (b.progress >= 1) {
          worker.working = null;
          b.defused();
          this._endRound(this.defenders, 'C4 DEFUSED');
        }
      }
    }
  }

  /**
   * Age the pouches on the floor and let the player walk into one.
   *
   * The pickup itself is `AmmoDrops.update` — it only fires when the player is
   * genuinely short (`weapons.needsAmmo`), so this branch is silent on every
   * frame the player runs over a body with full pouches. The feedback lives
   * here rather than in `ammo.js` because `ui` and `audio` are the match's to
   * drive; the readout's own reaction (the reserve figure flashing) is
   * ui/ammo.js's business and needs nothing plumbed to it.
   */
  _updateAmmoDrops(dt, audio) {
    const got = this.ammoDrops.update(dt, this.player.dead ? null : this.player, this.weapons);
    if (got <= 0) return;
    this.ui.banner.show('AMMUNITION', `+${got} ROUNDS`, 0.9);
    try {
      audio?.play?.('hit_armour', this.player.position, { level: 0.35 });
    } catch {
      /* audio is optional feedback */
    }
  }

  _onPlanted(site) {
    this.bomb.worker = null;
    this.bomb.progress = 0;
    this._assignObjectives();
    this.ui.banner.show(
      this.playerRole === ROLE.ATTACK ? 'C4 ARMED' : 'C4 PLANTED',
      `SITE ${site.id} · ${RULES.bombTime | 0}S`,
      2.6
    );
    // Everybody hears a charge go down.
    for (const a of this.ai.agents) if (a.alive) a.hear(this.bomb.position, 70);
    this.ctx.events.emit('match:bomb', {
      state: this.bomb.state,
      site: site.id,
      fuse: this.bomb.fuse,
      carrier: null,
    });
  }

  /* ------------------------------------------------------ player input -- */

  _updatePlayerInteraction(dt) {
    const ui = this.ui;
    if (this.player.dead) {
      ui.clearPrompt();
      return;
    }
    /**
     * DOMINATION'S CAPTURE HAS NO INTERACTION. Presence is the whole verb — a
     * capture point you have to hold a key on does not exist in this genre, and
     * in this engine it would be actively wrong: `Agent.working` freezes a bot
     * where it stands, so a "use" gate would have to be human-only and the bots
     * could never take anything. The player's feedback for the ZONES is the zone
     * strip on the HUD (`h.zones`, with `here` set on the one he is standing in).
     *
     * The key is not idle, though. It is the CACHES — @see `_updateCacheUse`.
     */
    if (this.domination) {
      this._updateCacheUse(dt);
      return;
    }
    const b = this.bomb;
    const held = this.ctx.input.action('use') && this.ctx.input.enabled;
    const mine = this.playerRole;
    const p = this.player.position;

    // ---- pick a loose charge back up ----------------------------------
    if (b.loose && mine === ROLE.ATTACK && p.distanceToSquared(b.position) < 2.2 * 2.2) {
      this._prompt.text = 'PICK UP C4';
      this._prompt.sub = '';
      this._prompt.progress = undefined;
      ui.setPrompt(this._prompt);
      if (held) {
        b.giveTo(this.player);
        this._assignObjectives();
        ui.clearPrompt();
      }
      return;
    }

    // ---- plant ---------------------------------------------------------
    if (b.state === BOMB.CARRIED && b.carrier === this.player) {
      const site = this._siteAt(p);
      if (site) {
        this._prompt.text = `PLANT C4 — SITE ${site.id}`;
        this._prompt.sub = 'HOLD';
        this._prompt.progress = b.workKind === 'plant-player' ? b.progress : 0;
        ui.setPrompt(this._prompt);
        if (held) {
          b.workKind = 'plant-player';
          b.worker = this.player;
          b.progress = Math.min(1, b.progress + dt / RULES.plantTime);
          this.weapons.locked = true;
          if (b.progress >= 1) {
            this._v.copy(p);
            this._v.y = this.ai.groundAt(this._v.x, this._v.z, this._v.y + 2) + 0.01;
            b.plant(site, this._v, this.player.yaw);
            b.workKind = null;
            this.weapons.locked = false;
            this._onPlanted(site);
          }
        } else if (b.workKind === 'plant-player') {
          b.workKind = null;
          b.worker = null;
          b.progress = 0;
          this.weapons.locked = false;
        }
        return;
      }
      // Carrying, but not on a site: say where to take it.
      this._prompt.text = `C4 — TAKE IT TO SITE ${this.sites.map((s) => s.id).join(' OR ')}`;
      this._prompt.sub = '';
      this._prompt.progress = undefined;
      ui.setPrompt(this._prompt);
      return;
    }

    // ---- defuse --------------------------------------------------------
    if (b.armed && mine === ROLE.DEFEND && p.distanceToSquared(b.position) < RULES.defuseRadius ** 2) {
      this._prompt.text = 'DEFUSE C4';
      this._prompt.sub = `${RULES.defuseTime}S`;
      this._prompt.progress = b.workKind === 'defuse-player' ? b.progress : 0;
      ui.setPrompt(this._prompt);
      if (held) {
        if (b.workKind !== 'defuse-player') b.progress = 0;
        b.workKind = 'defuse-player';
        b.worker = this.player;
        b.progress = Math.min(1, b.progress + dt / RULES.defuseTime);
        this.weapons.locked = true;
        if (b.progress >= 1) {
          b.defused();
          this.weapons.locked = false;
          this._endRound(this.defenders, 'C4 DEFUSED');
        }
      } else if (b.workKind === 'defuse-player') {
        b.workKind = null;
        b.worker = null;
        b.progress = 0;
        this.weapons.locked = false;
      }
      return;
    }

    if (b.workKind === 'plant-player' || b.workKind === 'defuse-player') {
      b.workKind = null;
      b.worker = null;
      b.progress = 0;
      this.weapons.locked = false;
    }
    ui.clearPrompt();
  }

  /**
   * ────────────────────────────────────────────────────────────────────────────
   * THE CACHES, FROM THE PLAYER'S SIDE — ONE KEY, TWO VERBS
   * ────────────────────────────────────────────────────────────────────────────
   * "武器はF長押しで交換可能にする グレネードを補充できる テンポラリーリスポーン地点と
   *  してのビーコンを起動できる（３０秒間）"
   *
   *   HOLD F (past `RULES.cacheHoldTime`)  take what the cache holds — the
   *     weapon off the rack, the frags out of the stack, the rounds out of the
   *     dump. `Caches.take` decides what that is; `weapons` decides what it is
   *     worth. The prompt's progress bar is the hold.
   *   TAP  F (released before it)          switch on the beacon: a spawn point
   *     for your side for `RULES.beaconTime` seconds.
   *
   * WHY THE SPLIT IS SAFE. The demolition mode's F is a TAP ("PICK UP C4") and a
   * HOLD (plant / defuse), and this is the same shape — but it is also in the
   * other branch of `_updatePlayerInteraction` entirely, so the two can never be
   * live at once whatever `RULES.mode` says. Inside this branch the two verbs
   * cannot fight each other either, because they are decided at DIFFERENT
   * MOMENTS: the hold fires the instant the timer crosses the threshold with the
   * key still down, and the tap can only fire on the RELEASE edge of a press
   * that never reached it. `done` latches the hold so one press is one item, and
   * `at` pins the press to the cache it began on so walking down a corridor with
   * F held cannot empty three of them.
   *
   * The weapon is NOT locked for the hold. `plant` and `defuse` lock it because
   * they are four and seven seconds of both hands; half a second at a crate is
   * not, and every `weapons.locked = true` needs a guaranteed path back to false
   * — the cheapest way to never leave a player unable to shoot is not to take it
   * away for half a second in the first place.
   */
  _updateCacheUse(dt) {
    const ui = this.ui;
    const st = this._cacheUse;
    const now = this.ctx.time.elapsed;
    const h = this._hud.cache;
    const c = this.caches.nearest(this.player.position);
    const down = this.ctx.input.action('use') && this.ctx.input.enabled;

    if (!c) {
      st.held = 0;
      st.done = false;
      st.at = null;
      st.wasDown = down;
      h.near = '';
      h.kind = '';
      h.hold = 0;
      h.grenadeCooldown = this.caches.grenadeCooldown(now);
      ui.clearPrompt();
      return;
    }

    const ready = this.caches.ready(c, now);
    const beaconReady = this.caches.beaconCooldown(now) <= 0 && !this.caches.beacon.active;

    /* ---- the press ---------------------------------------------------- */
    if (down) {
      if (st.at !== c) {
        // A new cache under the same held key starts its own press.
        st.at = c;
        st.held = 0;
        st.done = false;
      }
      st.held += dt;
      if (!st.done && st.held >= RULES.cacheHoldTime) {
        st.done = true;
        /**
         * `take` now decides the refusal as well as the handover, and says
         * WHICH refusal in `caches.denied` — full pouch, cache still
         * resupplying, or the player's own one-minute frag clock. A hold that
         * did nothing and said "NOTHING TO TAKE" was the same message for three
         * different situations, only one of which is worth walking away from.
         */
        const got = this.caches.take(c, now);
        if (got) {
          ui.banner.show(got.title, got.sub, 1.4);
          ui.pickup?.(got.title, got.sub, c.kind === 'weapon' ? 'weapon' : 'supply');
          this._cacheFeedback();
        } else {
          const d = this.caches.denied;
          ui.pickup?.(d?.title ?? 'NOTHING TO TAKE', d?.sub ?? '', 'deny');
        }
      }
    } else {
      // The RELEASE edge. A press that never reached the hold threshold is a tap.
      if (st.wasDown && st.at === c && !st.done && st.held > 0.02) {
        if (beaconReady && this.caches.plantBeacon(c, this.playerTeam, this.player.yaw, now)) {
          ui.banner.show('BEACON ONLINE', `${RULES.beaconTime | 0}S FORWARD SPAWN`, 2.0);
          ui.pickup?.('BEACON ONLINE', `${RULES.beaconTime | 0}S FORWARD SPAWN · ${c.id}`, 'beacon');
          this._cacheFeedback();
        } else {
          const why = this.caches.beacon.active
            ? `ONE IS ALREADY UP · ${this.caches.beaconRemaining(now).toFixed(0)}S`
            : `READY IN ${this.caches.beaconCooldown(now).toFixed(0)}S`;
          ui.pickup?.('BEACON UNAVAILABLE', why, 'deny');
        }
      }
      st.held = 0;
      st.done = false;
      st.at = null;
    }
    st.wasDown = down;

    /* ---- the prompt ---------------------------------------------------- */
    /**
     * TWO ROWS, ONE KEY. @see `Prompt.set` — the old single grey line
     * "HOLD F · TAP F FOR BEACON" carried both verbs and was read by nobody,
     * which is half of "ユーザーが気付けるように". The other half is that each row
     * now says what it COSTS and whether it is available AT ALL before the key
     * goes down: the frag clock is the common refusal now that it is one a
     * minute, and finding that out only after a 0.55 s hold is finding it out
     * from a bug report.
     */
    const frag = this.caches.grenadeCooldown(now);
    const p = this._cachePrompt;
    p.text =
      c.kind === 'medic' ? 'TAKE MED KIT'
        : c.kind === 'weapon' ? `TAKE ${c.label}`
          : c.kind === 'grenade' ? 'RESUPPLY FRAGS'
            : 'RESUPPLY AMMUNITION';
    p.sub = !ready
      ? // A dressing station is not "resupplying"; say what it is doing.
        c.kind === 'medic'
        ? `NO KIT · ${Math.ceil(c.readyAt - now)}S`
        : `CACHE RESUPPLYING · ${Math.ceil(c.readyAt - now)}S`
      : c.kind === 'medic'
        ? // The number the player asked for, and the state he is in, on the
          // prompt rather than after the hold. `RULES.regen` is false, so a man
          // who is full has no reason to spend `cacheHoldTime` finding out.
          this.player.health && this.player.health.value >= this.player.health.max - 0.5
          ? 'NO INJURIES'
          : `+${RULES.medicHeal} HP`
        : c.kind === 'grenade'
          ? frag > 0
            ? `FRAGS READY IN ${Math.ceil(frag)}S`
            : `+${RULES.cacheGrenades} FRAGS · ONE PER ${RULES.grenadeResupplyCooldown | 0}S`
          : c.kind === 'weapon'
            ? 'SWAP YOUR PRIMARY'
            : `+${RULES.cacheAmmoMags} MAGS`;
    p.progress = st.at === c && !st.done ? Math.min(1, st.held / RULES.cacheHoldTime) : 0;
    const alt = this._promptAlt;
    alt.hold = false;
    alt.text = 'PLANT BEACON';
    alt.sub = beaconReady
      ? `${RULES.beaconTime | 0}S FORWARD SPAWN`
      : this.caches.beacon.active
        ? `ONE IS UP · ${Math.ceil(this.caches.beaconRemaining(now))}S`
        : `READY IN ${Math.ceil(this.caches.beaconCooldown(now))}S`;
    p.alt = alt;
    ui.setPrompt(p);

    h.near = c.id;
    h.kind = c.kind;
    h.hold = p.progress;
    h.ready = ready;
    h.cooldown = ready ? 0 : c.readyAt - now;
    h.grenadeCooldown = frag;
  }

  /**
   * THE CACHES THE PLAYER CAN SEE, published for `ui.setCaches`.
   *
   * Written into the six records allocated in `init`; nothing is allocated per
   * frame and `ui` never retains them. The whole reason this exists is that
   * twenty-four caches stand on painted squares INSIDE buildings and on roofs,
   * and a feature you have to already know about to find is a feature that, from
   * the seat, does not exist — which is exactly what was reported.
   */
  _publishCaches() {
    if (!this.caches || !this.ui.setCaches) return;
    if (this.player.dead) {
      this.ui.setCaches(null);
      return;
    }
    const now = this.ctx.time.elapsed;
    const near = this._cacheNear;
    const n = this.caches.nearby(this.player.position, RULES.cacheMarkerRange, near, 6);
    // The one the interaction would actually reach, asked of the same method the
    // prompt asks: the marker says HOLD F on exactly the frames the prompt is up.
    const reach = this.caches.nearest(this.player.position);
    const view = this._cacheView;
    view.length = n;
    for (let i = 0; i < n; i++) {
      const c = near[i];
      const v = this._cacheRecords[i];
      view[i] = v;
      v.id = c.id;
      v.kind = c.kind;
      /**
       * `medic` HAS NO GLYPH OF ITS OWN AND KEEPS THE AMMO ONE. `ui.markers`
       * holds a four-entry table and falls back to the supply glyph on anything
       * it does not know (`this._cacheGlyph[o.kind] ?? 1`), which is `src/ui`'s
       * to extend and not this pass's file. The LABEL is what carries it, and
       * the world dressing — a painted disc and a red cross — is what actually
       * says "medical zone" at range. @see `Caches.buildMedicMarkers`.
       */
      v.label =
        c.kind === 'medic' ? 'MED KIT'
          : c.kind === 'weapon' ? c.label || 'WEAPON'
            : c.kind === 'grenade' ? 'FRAGS'
              : c.kind === 'vantage' ? 'NEST'
                : 'AMMO';
      v.position = c.position;
      v.ready = this.caches.ready(c, now);
      v.cooldown = Math.max(0, c.readyAt - now);
      // The same 2.6 m `nearest()` uses, so the marker says HOLD F on exactly
      // the frames the prompt is up and never on a frame it is not.
      v.inReach = c === reach;
    }
    this.ui.setCaches(n ? view : null);
  }

  /** One transient off a cache. Audio is optional; never let it break the take. */
  _cacheFeedback() {
    try {
      const audio = this._audio ?? this.ctx.peek('audio');
      audio?.play?.('hit_armour', this.player.position, { level: 0.4 });
    } catch {
      /* feedback only */
    }
  }

  /** The site whose radius contains `p`, or null. */
  _siteAt(p) {
    for (const s of this.sites) {
      const dx = p.x - s.position.x;
      const dz = p.z - s.position.z;
      if (dx * dx + dz * dz <= s.radius * s.radius && Math.abs(p.y - s.position.y) < 3) return s;
    }
    return null;
  }

  /* ------------------------------------------------------ win conditions -- */

  _checkWinConditions() {
    if (this.domination) return this._checkDominationWin();
    const atk = this.attackers;
    const def = this.defenders;
    const aAlive = this.aliveCount(atk);
    const dAlive = this.aliveCount(def);

    // ELIMINATION STILL SCORES, but a man in the respawn queue is not dead — he
    // is late. Counting him would end the round the instant a fifteen-man side
    // happened to be between waves, which with a six second delay is most of
    // the time. This is the whole of what respawns change about the rules.
    if (dAlive === 0 && this._queuedFor(def) === 0) {
      this._endRound(atk, 'DEFENDERS ELIMINATED');
      return;
    }
    // Attackers wiped only loses the round if the charge is not already down —
    // this is the rule that makes a planted C4 worth trading lives for.
    if (aAlive === 0 && this._queuedFor(atk) === 0 && !this.bomb.armed) {
      this._endRound(def, 'ATTACKERS ELIMINATED');
      return;
    }
    if (!this.bomb.armed && this.roundClock <= 0) {
      this.roundClock = 0;
      this._endRound(def, 'TIME');
    }
  }

  /**
   * DOMINATION HAS TWO ENDINGS AND NEITHER OF THEM IS A BODY COUNT.
   *
   * The score target, or the clock with the higher score taking it. Elimination
   * is deliberately absent: with respawns permanently open a side is never
   * eliminated, and a side that is being wiped is already losing the score race
   * because it is not standing in anything. That is the mode punishing it, on the
   * same axis it is played on.
   */
  _checkDominationWin() {
    const s = this.score;
    if (s[0] >= RULES.scoreTarget || s[1] >= RULES.scoreTarget) {
      // Both can cross on the same tick (a 1-1 split, both on 248): the larger
      // total takes it, and a genuine dead heat is a draw.
      const w = s[0] === s[1] ? -1 : s[0] > s[1] ? 0 : 1;
      this._finishMatch(w, `${RULES.scoreTarget} POINTS`);
      return;
    }
    if (this.roundClock <= 0) {
      this.roundClock = 0;
      this._finishMatch(s[0] === s[1] ? -1 : s[0] > s[1] ? 0 : 1, 'TIME');
    }
  }

  /**
   * The domination match is over. Replaces `_endRound` rather than reusing it:
   * `_endRound` increments `this.score`, which in this mode IS the capture score
   * and must not be touched by the thing that reads it.
   */
  _finishMatch(winner, reason) {
    if (this.phase !== PHASE.LIVE) return;
    this._respawnQueue.length = 0;
    for (const a of this.ai.agents) a.working = null;
    this.result = { winner, reason };
    this.matchOver = true;
    this._pendingMatchWinner = winner;
    this.ui.banner.show(
      winner < 0 ? 'DRAW' : winner === this.playerTeam ? 'MATCH WON' : 'MATCH LOST',
      `${winner < 0 ? 'LEVEL' : TEAM_NAME[winner]} · ${reason} · ` +
        `${this.score[0]} — ${this.score[1]}`,
      3.6
    );
    this.ctx.events.emit('match:result', {
      winner,
      reason,
      score: this.score,
      matchOver: false,
    });
    const mean = this.capture.meanOwnership(this.ctx.time.elapsed);
    const st = this.capture.stats;
    console.info(
      `[match] DOMINATION over — ${winner < 0 ? 'DRAW' : TEAM_NAME[winner]} (${reason}) ` +
        `${this.score[0]}-${this.score[1]} · captures ${st.captures[0]}/${st.captures[1]} ` +
        `(bots ${st.capturesByBots[0]}/${st.capturesByBots[1]}) · mean hold ` +
        `${mean[0]}s/${mean[1]}s · forward spawns ` +
        `${this._forwardSpawns[0]}/${this._forwardSpawns[1]} of ` +
        `${this._forwardSpawns[0] + this._baseSpawns[0]}/` +
        `${this._forwardSpawns[1] + this._baseSpawns[1]}`
    );
    this._setPhase(PHASE.OVER, RULES.roundOverTime);
  }

  /**
   * A zone changed hands. The banner is the LOCAL player's news, so it is worded
   * from their side; the killfeed row is what makes a capture visible to somebody
   * who was looking down a sight when it happened.
   */
  _onCaptured(zone, previous, byPlayer) {
    this.marks.setOwner(zone, zone.owner);
    const mine = zone.owner === this.playerTeam;
    this.ui.banner.show(
      mine ? `ZONE ${zone.id} CAPTURED` : `ZONE ${zone.id} LOST`,
      byPlayer
        ? `${zone.name} · YOURS`
        : `${zone.name} · ${TEAM_NAME[zone.owner]} · ${this.capture.ownedBy(zone.owner)}/${this.sites.length}`,
      2.0
    );
    this.ui.killfeed.push({
      attacker: TEAM_NAME[zone.owner],
      victim: `ZONE ${zone.id}`,
      headshot: false,
      mine: false,
      attackerFriendly: mine,
    });
    // Everybody hears a point go. Same call the C4 used, same 70 m.
    for (const a of this.ai.agents) if (a.alive) a.hear(zone.position, 70);
    this.ctx.events.emit('match:capture', {
      zone: zone.id,
      owner: zone.owner,
      previous,
      score: this.score,
    });
    // The map just changed shape for both sides: re-task immediately rather than
    // waiting up to two seconds for the refresh.
    this._assignObjectives();
  }

  /* ------------------------------------------------------------- to ui -- */

  _publishHud() {
    const h = this._hud;
    const b = this.bomb;
    h.phase = this.phase;
    h.round = this.round;
    h.role = this.playerRole;
    h.playerTeam = this.playerTeam;
    h.attackers = this.attackers;
    h.clock =
      this.phase === PHASE.LIVE
        ? b.armed
          ? b.fuse
          : Math.max(0, this.roundClock)
        : this.timer;
    h.bombState = b.state;
    h.bombFuse = b.fuse;
    h.bombSite = b.site?.id ?? '';
    h.carrying = b.carrier === this.player;
    h.aliveUs = this.aliveCount(this.playerTeam);
    h.aliveThem = this.aliveCount(1 - this.playerTeam);
    h.rosterUs = this._rosterSize(this.playerTeam);
    h.rosterThem = this._rosterSize(1 - this.playerTeam);
    h.dead = this.player.dead;
    // Seconds until the human is back, 0 when nothing is pending. `ui` reads it
    // if it wants to; the banner at the moment of death carries it either way.
    const mine = this._respawnQueue.find((q) => q.rec.isPlayer);
    h.respawnIn = mine ? Math.max(0, mine.at - this.ctx.time.elapsed) : 0;
    h.spectating = this.spectator.active ? this.spectator.targetName : '';
    h.progress = b.progress;
    h.working = b.workKind ?? '';
    if (this.domination) {
      this._publishZones();
      // Every frame, not only while standing at one: the markers are how a
      // player finds out the caches exist at all.
      this._publishCaches();
    }
    /**
     * THE BEACON'S CLOCK, written in place. `ui/round.js` draws it under the zone
     * strip. `mine` is from the LOCAL player's point of view for the same reason
     * every other field on this object is: a HUD that makes you work out which of
     * RED and BLUE you are is a HUD you misread under fire.
     */
    if (this.caches) {
      const bn = this.caches.beacon;
      const hb = h.beacon;
      const now = this.ctx.time.elapsed;
      hb.active = bn.active;
      hb.mine = bn.active && bn.team === this.playerTeam;
      hb.seconds = this.caches.beaconRemaining(now);
      hb.cooldown = this.caches.beaconCooldown(now);
      hb.at = bn.active ? bn.at : '';
    }
    h.alert =
      this.phase === PHASE.FREEZE
        ? 'PREPARE'
        : this.phase === PHASE.OVER || this.phase === PHASE.MATCH_OVER
          ? this.result
            ? this.result.winner < 0
              ? 'DRAW'
              : `${TEAM_NAME[this.result.winner]} WIN`
            : ''
          : this.domination
            ? h.ownedUs === this.sites.length
              ? 'ALL ZONES HELD'
              : h.ownedUs
                ? `HOLDING ${h.ownedUs} / ${this.sites.length}`
                : 'NO ZONES HELD'
            : b.armed
              ? `C4 ARMED — SITE ${b.site?.id ?? '?'}`
              : '';

    this.ui.setMatch({
      scoreUs: this.score[this.playerTeam],
      scoreThem: this.score[1 - this.playerTeam],
      timeLeft: h.clock,
      mode: this.domination ? 'DOMINATION' : 'DEMOLITION',
    });
    this.ui.setRound?.(h);
    this._publishObjectives();
  }

  /**
   * The zone strip's snapshot, written into the records allocated in `init`.
   *
   * Everything is expressed from the LOCAL player's side — `mine` / `theirs`
   * rather than red and blue — because the one thing a HUD must never make you do
   * while being shot at is work out which colour you are.
   */
  /**
   * ONE HUD RECORD PER ZONE, ALLOCATED ONCE AND WRITTEN IN PLACE.
   *
   * `ui` reads the array every frame and must never retain it. `mine` and
   * `theirs` are from the LOCAL player's point of view, because a HUD that makes
   * you work out which of RED and BLUE you are is a HUD you misread under fire.
   *
   * A method rather than an inline literal because a zone can now JOIN the match
   * — D, when the cathedral comes down — and its record has to be the same shape
   * as the three that were built at boot. @see `_setZoneLive`
   */
  _zoneHudRecord(z) {
    return {
      id: z.id,
      name: z.name,
      /** 'neutral' | 'mine' | 'theirs' */
      owner: 'neutral',
      /** 0..1 on the bar, and whose bar it is. */
      progress: 0,
      capture: 'none',
      contested: false,
      /**
       * Bar-units per second, signed, as `capture.js` advanced it THIS frame.
       * `src/ui/capture.js` turns it into the countdown and the GAINING /
       * LOSING read — the two things a bar alone cannot say.
       */
      rate: 0,
      /** Live bodies inside the circle, from the player's point of view. */
      mine: 0,
      theirs: 0,
      /** True when the local player is standing in this one. */
      here: false,
    };
  }

  _publishZones() {
    const h = this._hud;
    const me = this.playerTeam;
    const here = this.player.dead ? null : this.capture.zoneAt(this.player.position);
    let us = 0;
    let them = 0;
    for (let i = 0; i < this.sites.length; i++) {
      const z = this.sites[i];
      const r = h.zones[i];
      r.owner = z.owner < 0 ? 'neutral' : z.owner === me ? 'mine' : 'theirs';
      r.progress = z.progress;
      r.capture = z.capTeam < 0 ? 'none' : z.capTeam === me ? 'mine' : 'theirs';
      r.contested = z.contested;
      r.rate = z.rate ?? 0;
      r.mine = z.counts[me];
      r.theirs = z.counts[1 - me];
      r.here = z === here;
      if (z.owner === me) us++;
      else if (z.owner >= 0) them++;
    }
    h.ownedUs = us;
    h.ownedThem = them;
  }

  /** Site markers on the compass and the minimap, and the C4 once it is down. */
  _publishObjectives() {
    const out = this._objectives;
    out.length = 0;
    /**
     * DOMINATION: one marker per zone, coloured by who holds it. Amber is
     * neutral, your own side is cold, theirs is hot — the same palette the zone
     * strip and the paint on the ground use, so the compass, the minimap and the
     * courtyard you are standing in all agree.
     *
     * RELATIVE TO THE PLAYER, NOT TO TEAM IDENTITY — and this is the second half
     * of the fix `sitemark.js` got in cb4ae95.
     *
     * 「占領した地域の距離離れているUIにおいて、占領しているのに赤のまま 占領できる
     *   地域が青なのも修正して」
     *
     * The colour was `TEAM_COLOR[z.owner]`, and `RULES.playerTeam` is `TEAM.RED`
     * = 0 = `#ff6a52`, which is the hex `ui/style.js` reserves for HOSTILES
     * (`--enemy`). So a zone the player HELD came out red on the world markers
     * and the compass, and a zone he could take came out blue — exactly backwards
     * from `ui/round.js`'s chips (`z.owner === 'mine' ? var(--friend) : ...`) and
     * from the paint under his feet.
     *
     * The hexes are `ui/style.js`'s own `--friend` / `--enemy` / `--amber` rather
     * than `TEAM_COLOR`: `ui/minimap.js` draws these into a canvas, where a
     * `var(--friend)` fillStyle is silently transparent. `sitemark.js` carries the
     * same two constants for the same reason.
     */
    if (this.domination) {
      for (const z of this.sites) {
        out.push(
          this._marker(
            z.id,
            z.id,
            z.position,
            z.owner < 0 ? '#ffb02a' : z.owner === this.playerTeam ? '#8fc8ff' : '#ff7a63'
          )
        );
      }
      /**
       * A LIVE BEACON IS A PLACE ON THE MAP, so it gets the same treatment a zone
       * does — a world marker the compass and the minimap both pick up. Only your
       * own side's: it is a spawn point, and telling the enemy where one is is a
       * different feature (and one nobody asked for).
       */
      const bn = this.caches?.beacon;
      if (bn?.active && bn.team === this.playerTeam) {
        out.push(this._marker('beacon', 'BEACON', bn.position, '#4dffa6'));
      }
      this._publishEnemyMarkers(out);
      this.ui.setObjectives(out);
      return;
    }
    const b = this.bomb;
    if (b.armed) {
      out.push(this._marker('bomb', 'C4', b.position, '#ff3f31'));
    } else if (b.loose) {
      out.push(this._marker('bomb', 'C4', b.position, '#ffb02a'));
    } else {
      for (const s of this.sites) {
        // Attackers see the site they are taking picked out; defenders see both.
        const hot = this.playerRole === ROLE.ATTACK && s === this.targetSite;
        out.push(this._marker(s.id, s.id, s.position, hot ? '#ffb02a' : '#79d2ff'));
      }
    }
    this._publishEnemyMarkers(out);
    this.ui.setObjectives(out);
  }

  /**
   * ENEMY MARKERS — a red diamond over anyone your side currently has eyes on.
   *
   * The characters wear real camouflage against a sand-and-plaster street, and
   * the camo bake measures a mean albedo of 0.09 (see the `[ai] camo` lines at
   * boot). That is doing its job: at 30 m in shadow a man in woodland against a
   * dirt alley is genuinely hard to pick out, and the player said so.
   *
   * The fix is NOT to make the characters brighter — that undoes the art. It is
   * to tell you what you have already seen, which is what Sudden Attack's own
   * enemy nameplates do.
   *
   * IT IS NOT A WALLHACK. `ai._updateSpotting` stamps `spottedAt` only when
   * somebody on your side genuinely has line of sight — your own eyes, inside
   * the view cone, LOS-tested through the physics BVH, or a team-mate who has
   * the man as a live target. `ai.getHudActors()` then drops any enemy whose
   * stamp is more than three seconds old, so a contact FADES rather than
   * following him through a wall. You get told about a man you could already
   * see, and you keep the information for three seconds after you lose him —
   * which is the same rule the minimap blips already follow.
   */
  _publishEnemyMarkers(out) {
    const actors = this.ai.getHudActors?.();
    if (!actors) return;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (a.friendly) continue;
      out.push(this._marker(`e${i}`, '', a.position, '#ff3f31'));
    }
  }

  _marker(id, label, position, color) {
    this._markers = this._markers ?? new Map();
    let m = this._markers.get(id);
    if (!m) {
      m = { id, label, position: new THREE.Vector3(), color };
      this._markers.set(id, m);
    }
    m.label = label;
    m.color = color;
    m.position.copy(position);
    return m;
  }

  /** For `ui` and anything else that wants the whole snapshot in one object. */
  getHudState() {
    return this._hud;
  }

  dispose() {
    for (const off of this._offs ?? []) off();
    this._offs = [];
    // Hand `ui` and `weapons` back the way they were found.
    if (this.ui) {
      this.ui.matchDriven = false;
      this.ui.isFriendlyTarget = null;
      this.ui.round = null;
    }
    if (this.weapons) this.weapons.locked = false;
    if (this.ai) this.ai.combatEnabled = true;
    // The hulls are about to stop existing; a stale array in `ai.hostilesOf`
    // would be a list of things nobody may shoot at and nothing may move.
    if (this.ai && this.ai.vehicles === this.tank?.tanks) this.ai.vehicles = null;
    this.bomb?.dispose();
    this.ammoDrops?.dispose();
    this.marks?.dispose();
    this.caches?.dispose();
    this.airstrike?.dispose();
    this.bomber?.dispose();
    this.strafe?.dispose();
    this.tank?.dispose();
    this.reinforce?.dispose();
    if (typeof window !== 'undefined') {
      if (window.__STRIKE__ === this.airstrike) delete window.__STRIKE__;
      if (window.__BOMBER__ === this.bomber) delete window.__BOMBER__;
      if (window.__STRAFE__ === this.strafe) delete window.__STRAFE__;
      if (window.__TANK__ === this.tank) delete window.__TANK__;
    }
  }
}

/** Mean position of a spawn cluster — the direction the other side arrives from. */
function centroid(list) {
  const out = new THREE.Vector3();
  for (const s of list) out.add(s.position);
  if (list.length) out.multiplyScalar(1 / list.length);
  return out;
}

export { PHASE, TEAM, RULES };
