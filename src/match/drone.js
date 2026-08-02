import * as THREE from 'three';
import { RULES } from './rules.js';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE SUICIDE DRONES — 「ドローンは自爆系のドローンで…全部で２０機まで登場」
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A loitering munition. It launches from one of the pads that side holds — its
 * base or any zone it owns outright, rotated per launch so the twenty do not
 * all cross the map on one bearing (@see `MatchSystem._droneLaunchPoint`, which
 * is where the list is decided; this file only asks for a point) — climbs above
 * the roofline, flies to where the fighting is, picks the nearest enemy it can
 * SEE, holds that sight for `RULES.droneLockTime` while the man it has chosen
 * is told about it in as many words, and then dives into him.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE THREE DESIGN QUESTIONS, ANSWERED WITH NUMBERS
 * ──────────────────────────────────────────────────────────────────────────
 *
 * 1. HOW IT TAKES YOU, AND HOW YOU GET AWAY.
 *
 *    Acquisition is the nearest live, targetable hostile inside
 *    `droneAcquireRange` (55 m) with a clear `MASK.SIGHT` ray from the drone to
 *    his chest, re-asked at 4 Hz. The lock is then 2.2 s of UNBROKEN sight
 *    before the dive commits, and for every one of those seconds the target has
 *    a warning strip, a bearing and a countdown on his HUD.
 *
 *    YOU CANNOT RUN. It cruises at 10 m/s and dives at 17; sprint is 7.01 and
 *    tactical sprint 8.38 (`src/player/tuning.js`), so a straight line loses by
 *    3 m/s and `droneBreakRange` (70 m) is unreachable on foot. What DOES work
 *    is a roof, a wall or a doorway: one second out of its sight
 *    (`droneLockBreak`) drops the lock outright, and the eight enterable
 *    buildings and every alley on this map are all inside that second from
 *    anywhere the fighting happens. That is the trade the whole feature is
 *    built on — the warning is long enough to reach cover and far too short to
 *    reach anywhere else, so it converts an ambush into a decision.
 *
 *    A dive is COMMITTED but not guided: `droneTurnRate` is 2.4 rad/s, which at
 *    17 m/s is a 7.1 m turning circle, so a sidestep inside the last two metres
 *    makes it miss. It then has to climb out and come round again, which costs
 *    it a fifth of its life.
 *
 * 2. SHOOTING IT DOWN. Yes — and IT GOES OFF WHEN YOU DO, at the airframe, on
 *    the frame the round kills it (@see `_takeRound` for why that beats letting
 *    the wreck fall and go off where it lands). It is the other half of the
 *    answer above, with a price on taking the shot late. One
 *    0.62 m box on `LAYER.SHOOT_ONLY` — the layer that is in `MASK.BULLET` and
 *    in neither `MASK.CHARACTER` nor `MASK.SIGHT`, so a moving object in the
 *    air can never cost anybody a route — with `owner: drone`, so a round that
 *    lands on it arrives as the canonical `damage:dealt` with the shooter
 *    attached and the player gets his hitmarker. `HEALTH` is 60, which is two
 *    rounds of the AK and three of the carbine once the collider's double-count
 *    is counted — @see the note on that constant for the measured table —
 *    against a target the size of a dinner plate crossing at 10 m/s.
 *
 * 3. THE PACING. Twenty PER MATCH, both sides, which at `droneLife` 45 s is 1.5
 *    in the air at any moment under a ceiling of `droneMaxAloft` 4. Launches
 *    alternate sides so the split is 10/10 and they are paced on
 *    `_matchProgress` rather than the clock — @see `BUDGET` for the arithmetic
 *    and `RULES.droneLaunchPad` for why progress is what makes the twenty real.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE BLAST IS A GRENADE'S, THROUGH THE GRENADE'S OWN PATH
 * ──────────────────────────────────────────────────────────────────────────
 * `_detonate` emits the canonical `explosion` with `damage`, `radius` and
 * `kind: 'grenade'` — which is EXACTLY the payload `AiSystem._updateGrenades`
 * emits for a bot's frag. THERE IS ONE BLAST PATH AND EVERY END OF A DRONE GOES
 * THROUGH IT: the dive that connects, the wall it flies into, the life clock
 * that runs out (`_scuttle`) and now the round that kills it (`_takeRound`).
 * Everything downstream is therefore literally the same code, not a copy of it:
 *
 *   bots    `ai`'s `explosion` listener — `damage * (1 - d/r)²`, occluded by
 *           `MASK.EXPLOSION`, which is `grenades.js:_damageActors` line for line
 *   player  `PlayerSystem._onExplosion` — `damage * pow(1 - d/r, 1.6)`, same
 *           mask, which is `grenades.js:_damagePlayer` line for line
 *   armour  `Armour._takeBlast` reads `kind: 'grenade'` and applies `fragMul`,
 *           so a drone is worth a sixth of a hull exactly as a frag is
 *   fx/audio/physics  the fireball, the report and the radial impulse
 *
 * The two numbers are read off the live `weapons` grenade def when there is one
 * (`RULES.droneBlastRadius` / `droneBlastDamage` are the fallback and are the
 * same figures), so if the frag is ever re-tuned the drone follows it.
 *
 * AND IT HURTS EVERYONE. `ai`'s listener has no team test — 「空爆は敵味方
 * 関係なく」 — so a drone that goes off over a friendly squad kills them. That is
 * the standing rule for every explosive in this game and it is not softened
 * here.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IT NEVER DOES
 * ──────────────────────────────────────────────────────────────────────────
 * It changes no collision, no navigation and no cover: it is in the air, its
 * one proxy is `SHOOT_ONLY`, and the crater is a `fx` decal. `stuckcheck`,
 * `navcheck` and `sitecheck` cannot see it. Nothing here allocates after
 * `build()`.
 */

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE TWO NUMBERS THE PLAYER RE-CUT, AND WHY THEY LIVE HERE
 * ══════════════════════════════════════════════════════════════════════════
 * 「体力は５０くらいにしてほしい」「全部で２０機まで登場」
 *
 * `RULES.droneHealth` (90) and `RULES.droneBudget` (30) still carry the old
 * figures, and `src/match/rules.js` is ANOTHER AGENT'S FILE this session — a
 * two-line edit there is a merge conflict on a 1700-line file for nothing.
 * Nothing outside this module reads either constant (checked: the only hits in
 * `src/` are in this file), so these two are the authority and the RULES
 * entries are dead. Move them back into RULES the moment that file is free.
 */

/**
 * ──────────────────────────────────────────────────────────────────────────
 * HP, 90 -> 60, AND IT IS A ROUNDS-TO-KILL RATHER THAN A NUMBER
 * ──────────────────────────────────────────────────────────────────────────
 * 「ドローンの体力は2回から3回球が当たって破壊されるのでちょうどいい ただし、基本的に
 *   AIとか撃っても当たりにくいからそれくらいの体力でいい」
 *
 * The ask is TWO TO THREE ROUNDS. 50 was the figure he named for it, and 50 is
 * not that — it is the bottom of the range and a shade under it, because a
 * round is worth more to a drone than its own damage number says.
 *
 * WHY. A round that punches through the proxy is scored on the ENTRY and the
 * EXIT face — the double-count `tank.js` documents under `oneWoundPerRound` —
 * so anything with the penetration to go out the far side lands twice. Measured
 * at 18 m through the canonical `phys.fireBullet` path, `_dronehp.mjs`:
 *
 *   gun      def   pen    events   effective   at 60 HP
 *   carbine   17   1.00      2        23.3       3 rounds
 *   AK        21   1.25      2        31.1       2 rounds
 *   LMG       17   1.40      2        26.0       3 rounds
 *   SMG       15   0.45      1        14.4       5 rounds
 *   pistol    16   0.35      1        15.4       4 rounds
 *   bolt gun 125   2.40      2       211.3       1 round
 *
 * THE SMG AND THE PISTOL DO NOT DOUBLE-COUNT: under about 0.5 penetration the
 * round stops inside the airframe and is scored once. A drone is a rifleman's
 * target and a poor one for anybody carrying a 9 mm, which is the right shape
 * for a thing you are meant to shoot out of the sky.
 *
 * SO 60, AND WHICH END OF HIS RANGE IT IS. It puts the two rifles either side
 * of the ask — AK two, carbine three — with the LMG at three and the bolt gun
 * at one, which is the MIDDLE of 「2回から3回」 rather than the floor. 50 would
 * have made the AK, the LMG and (nearly) the carbine all two, and 65 would have
 * made every rifle on the map three.
 *
 *   The AK's two is TIGHT: 62.2 against 60, and `dropoff` 0.7 over `maxRange`
 *   360 eats that 3.7% at about 130 m. So it is two rounds across the town and
 *   three from the far ridge, which is a fair way for a range band to read.
 *
 * AND HE IS RIGHT THAT IT IS SAFE TO BE FRAGILE: 「AIとか撃っても当たりにくい」 —
 * a 0.62 m airframe crossing at 10 m/s is a target bots rarely connect with, so
 * the cost of this is paid almost entirely by players who track it deliberately.
 * That is a caveat rather than a proof, though — @see the report: bots are being
 * taught to shoot at drones and pushed toward roughly triple their rate of fire
 * in parallel, and volume alone could make 60 read as instant once forty men are
 * firing at the sky. Nothing here is pre-compensated for that; it wants a
 * measurement once both land.
 */
const HEALTH = 60;

/**
 * TWENTY A MATCH, both sides, 10/10 — 「全部で２０機まで登場」, down from 30.
 *
 * RE-PACED, NOT JUST RE-COUNTED. The schedule is unchanged in shape — drone n
 * is owed at progress `(n + droneLaunchPad) / BUDGET`, so the budget empties
 * whichever way the match ends — but the arithmetic underneath it moves:
 *
 *   30 a match   one launch per 0.033 of the match, ~20 s, 2.25 aloft average
 *   20 a match   one launch per 0.050 of the match, ~30 s, 1.5 aloft average
 *
 * Thirty seconds apart is still INSIDE `droneLife` (45 s), which is the whole
 * test of whether twenty reads as a recurring threat or as twenty incidents:
 * the next one launches while the last is still up, so the sky is rarely empty
 * and the rotor is never a novelty. What it stops being is a swarm — with
 * `droneMaxAloft` 4 the old count could stack four over one street, and at 1.5
 * average the ceiling is now almost never the thing that binds. `droneGap` (8 s)
 * still holds the floor for the one case that matters, a scoring run that jumps
 * `_matchProgress` several drones' worth in a frame.
 */
const BUDGET = 20;

/** How often a drone re-asks who it should be looking at. */
const SCAN_EVERY = 0.25;
/** Rotor spin, rad/s. Fast enough to read as a blur, slow enough to strobe. */
const ROTOR_SPIN = 46;
/** Pool size. `droneMaxAloft` plus one, so a launch never waits on a free slot. */
const POOL = RULES.droneMaxAloft + 1;
/** Metres ahead the flight looks for a wall while cruising. */
const LOOK_AHEAD = 6;
/** Seconds a drone that missed spends climbing out before it may lock again. */
const RECOVER = 2.4;
/**
 * THE ROTOR IS NOT PLAYED FROM HERE ANY MORE.
 *
 * It was a one-shot re-struck about once a second — a placeholder, and audibly
 * the wrong shape: a rotor is continuous, and repeating a jet sample gives a
 * pass overhead rather than four propellers. `src/audio/vehicle.js` now drives
 * a tracked emitter off `match.drones.list`, the same contract `tankEngine`
 * takes from `match.tank.tanks`, so this file publishes state and plays
 * nothing. Leaving the placeholder in would layer a jet over the props.
 *
 * The audible range moved 58 -> 120 m with it, which is audio's call: hearing
 * one before it is overhead is what makes it fair rather than a coin flip.
 */

/** Chest height on a target, whatever it is. Bots and the player are both 1.8 m. */
const CHEST = 1.15;

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE HALO — 「ドローン自体をハイライトして 敵味方のドローンで色分けして」
 * ══════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS WRONG. The HUD strip is a CAPTION: it says a drone has you, which
 * way and how long you have. It cannot say WHICH SPECK. The airframe is 0.62 m
 * of matt composite at 22 m altitude against a bright sky, and the only thing
 * on it with any emission was a 3 cm strobe. A player who reads DRONE LOCK,
 * turns to the bearing and looks up is looking at an empty sky — and the one
 * counter-play the whole feature is built around (shoot it, or find the cover
 * it cannot see through) needs him to FIND it, not to know it exists.
 *
 * So the airframe carries its own mark, in the world, at the drone:
 *
 *   A RING, BILLBOARDED. Camera-facing, so it is the same shape from every
 *   angle and never edge-on to the man it is about to kill.
 *   A DARK BACKING RING UNDER IT. This is the whole reason it works against
 *   SKY: a coloured ring alone is a mid-tone against a bright cloud and it
 *   disappears. The backing gives both edges of the colour a hard dark border,
 *   which is what makes it read on cloud AND on the dark side of a roof. Not
 *   additive blending, for the same reason — additive against a bright sky is
 *   invisible, which is exactly where a drone lives.
 *   IT HOLDS AN ANGULAR SIZE. The world radius scales with camera distance
 *   (`HALO_PER_M`), floored and capped, so the mark is legible at 120 m without
 *   swallowing the drone at 8 m.
 *   IT IS OCCLUDED. `depthTest` is left ON: this marks a drone you can SEE, and
 *   an x-ray ring through a roof would be a wallhack rather than a highlight.
 *   The HUD's own drone mark (`ui/markers.js`) is the one that tracks it out of
 *   sight, which is a HUD's job and not the world's.
 *
 * AND WHEN IT IS COMING AT YOU (item 1), a second ring CONVERGES onto it — the
 * same grammar `WorldMarkers.updateDanger` uses for incoming air, where a
 * converging ring reads as something arriving and an expanding one reads as
 * something that has already gone off — and the halo itself beats. That fires
 * on `target.isPlayer` in `lock` or `dive`, which is the drone's own definition
 * of coming at you rather than a guess made from a distance.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE COLOURS ARE RELATIVE TO THE PLAYER, NOT TO TEAM IDENTITY
 * ──────────────────────────────────────────────────────────────────────────
 * These are `ui/style.js`'s own `--friend` / `--enemy`, and they are NOT
 * `TEAM_COLOR`, which is the bug this file used to have in its strobe:
 * `RULES.playerTeam` is `TEAM.RED` = 0 and `TEAM_COLOR[0]` is `#ff6a52`, the hex
 * the HUD reserves for HOSTILES — so painting by team index put the player's own
 * drones in enemy red and the ones hunting him in friendly blue. That exact
 * inversion shipped once on the zone markers and was caught; `sitemark.js` and
 * `MatchSystem._publishObjectives` both carry the fixed rule and now so does the
 * airframe. The hexes are literals here for the same reason they are literals
 * there: `src/match` may not import `src/ui`.
 */
const HALO_FRIEND = 0x8fc8ff;
const HALO_ENEMY = 0xff7a63;
/** Halo world radius per metre of camera distance, before the clamp. */
const HALO_PER_M = 0.019;
const HALO_MIN = 0.7;
const HALO_MAX = 2.6;

let _nextId = 1;

class Drone {
  constructor(i) {
    this.slot = i;
    this.id = 0;
    this.name = '';
    this.team = 0;
    this.alive = false;
    /** 'climb' | 'hunt' | 'lock' | 'dive' | 'recover' */
    this.state = 'climb';
    this.position = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    /** Where it is trying to be this frame. */
    this.want = new THREE.Vector3();
    /**
     * The waypoint: the nearest hostile's position as of the last scan, COPIED.
     * Per drone rather than shared scratch — four drones sharing one vector fly
     * at one man. `vector` is this, or null when there is nobody. @see `_scan`.
     */
    this.vec = new THREE.Vector3();
    this.vector = null;
    this.health = 0;
    /** What it launched with. The HUD mark draws `health / maxHealth`. */
    this.maxHealth = HEALTH;
    this.life = 0;
    this.target = null;
    /** Seconds of unbroken sight on `target`. */
    this.lockT = 0;
    /** Seconds since the last time it could see `target`. */
    this.blindT = 0;
    this.scanT = 0;
    this.recoverT = 0;
    this.rotor = 0;
    /** Halo beat/converge phase, integrated so a paused game freezes it. */
    this.markT = 0;
    /** From the LOCAL player's point of view, fixed at launch. @see `HALO_*`. */
    this.hostile = true;
    /** True while it is locked on or diving at the local player. */
    this.atPlayer = false;
    this.group = null;
    /** The billboarded halo group, and its two rings. @see `_mark`. */
    this.mark = null;
    this.halo = null;
    this.aim = null;
    this.rotors = null;
    this.collider = null;
    /** Ground under it, refreshed on the scan tick — one ray, not one per frame. */
    this.groundY = 0;
    /** True while this drone owns the player's lock warning. */
    this.warning = false;
  }
}

export class Drones {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.rng = opts.rng ?? ctx.rng.fork();
    this.ready = false;
    this.enabled = true;
    /**
     * WHICH SIDE THE CAMERA IS ON. Every colour on a drone is relative to this
     * and never to the team index — @see the note on `HALO_FRIEND`. `match`
     * overwrites it with its own `playerTeam` at wiring time, exactly as it does
     * for `sitemark`; the default keeps a standalone harness honest.
     */
    this.playerTeam = RULES.playerTeam;

    /** Installed by `match`: fill `out` with the live hostiles of `team`. */
    this.enemies = null;
    /** Installed by `match`: where a side's drones come out of. */
    this.launchPoint = null;
    /** Installed by `match`: the centre of the fight, or null. */
    this.focus = null;
    /** Installed by `match`: the player's lock state changed. */
    this.onLock = null;
    /** Installed by `match`: one launched, for the killfeed/console. */
    this.onLaunch = null;

    /** Live drones. `audio` reads this the way it reads `match.tank.tanks`. */
    this.list = [];
    for (let i = 0; i < POOL; i++) this.list.push(new Drone(i));

    /** Launches spent. `_spent[t]` is per side; the sum is `BUDGET`. */
    this._spent = [0, 0];
    /** Which side launches next. Alternates, so the split is exact. */
    this._nextTeam = 0;
    this._gap = 0;

    this.group = new THREE.Group();
    this.group.name = 'match-drones';
    this.materials = [];
    this._geo = [];

    /* ---- scratch: nothing below allocates ---------------------------- */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._foe = [];
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    /** Reused `explosion` payload. Listeners copy out of it. */
    this._blast = {
      position: new THREE.Vector3(),
      radius: RULES.droneBlastRadius,
      damage: RULES.droneBlastDamage,
      /**
       * WHAT IT IS, said out loud, and it is the field `Armour._takeBlast`
       * reads to tell a frag from a bomb. @see the header.
       */
      kind: 'grenade',
      /**
       * A STRING, DELIBERATELY, exactly as 'airstrike' / 'bomber' / 'grenade'
       * are. `Armour._takeBlast` passes a NON-string source straight through to
       * `tank.lastHitBy` and from there to `ai.teamOf` and the killfeed, so a
       * drone object on this field would put an attacker called "DRONE-7" on
       * the scoreboard. The identity the kill cam needs rides on the two
       * additive fields below instead.
       */
      source: 'drone',
      /** Additive, optional, ignored by everything but the kill cam. */
      label: 'SUICIDE DRONE',
      team: -1,
    };
    /** Reused `match:drone` payload — `audio` and the HUD copy out of it. */
    this._ev = { phase: 'launch', id: 0, team: 0, position: new THREE.Vector3() };
    /** Reused lock report handed to `match`. */
    this._lock = {
      active: false, id: 0, team: 0, progress: 0, remain: 0, diving: false,
      range: 0, x: 0, y: 0, z: 0,
    };

    /**
     * MEASUREMENT ONLY. A death inside a blast that has just gone off is a
     * drone kill; nothing in the game reads this, and the credit on the event
     * itself is unchanged (a blast kills for the environment, as every blast in
     * this game does). @see `_onDeath`.
     */
    this.stats = {
      launched: 0, perTeam: [0, 0], detonated: 0, shotDown: 0, scuttled: 0,
      kills: 0, friendlyKills: 0, playerKills: 0, locks: 0, lockSeconds: 0,
      playerLocks: 0, playerLockSeconds: 0, dives: 0, missed: 0, deferred: 0,
    };
    this._blastAt = -100;
    this._blastPos = new THREE.Vector3();
    this._blastTeam = -1;

    this._onDamage = (e) => this._takeRound(e);
    this._onActorDeath = (e) => this._onDeath(e?.actor);
    this._onPlayerDeath = () => this._onDeath(this.ctx.peek('player'));
  }

  get physics() {
    if (!this._phys) this._phys = this.ctx.peek('physics');
    return this._phys;
  }

  /** How many are in the air right now. */
  get aloft() {
    let n = 0;
    for (const d of this.list) if (d.alive) n++;
    return n;
  }

  /** Launches still owed this match. @see `BUDGET` */
  get left() {
    return BUDGET - this._spent[0] - this._spent[1];
  }

  /* ====================================================================== */
  /* build                                                                  */
  /* ====================================================================== */

  /**
   * One airframe, built once, cloned into the pool. It is 0.62 m across and
   * lives 20 m up, so the detail budget goes where it can be read from the
   * ground: a hard silhouette (four arms, four discs), a team strobe that says
   * whose it is at range, and a warhead slung underneath that says what it is.
   */
  build() {
    const mk = (g) => { this._geo.push(g); return g; };
    const body = mk(new THREE.BoxGeometry(0.2, 0.085, 0.3));
    const arm = mk(new THREE.BoxGeometry(0.42, 0.018, 0.03));
    const pod = mk(new THREE.CylinderGeometry(0.028, 0.028, 0.05, 8));
    const disc = mk(new THREE.CircleGeometry(0.115, 14));
    const head = mk(new THREE.SphereGeometry(0.072, 10, 8));
    const strobe = mk(new THREE.BoxGeometry(0.03, 0.016, 0.03));
    /**
     * The halo, at unit radius: the colour is an annulus and the backing is a
     * WIDER annulus that overlaps it on both edges, so the colour always has a
     * dark border on the inside and the outside. @see the note on `HALO_FRIEND`.
     */
    const haloRing = mk(new THREE.RingGeometry(0.66, 1.0, 30));
    const haloBack = mk(new THREE.RingGeometry(0.54, 1.13, 30));

    /**
     * Two paints, FRIEND THEN HOSTILE — relative to the local player and never
     * indexed by team, @see the note on `HALO_FRIEND` — plus the shared
     * airframe. The airframe is a matt composite that reads dark against the sky
     * and the strobe is the only thing on it with any emission: a drone must be
     * seen as a SHAPE moving against the cloud, and a shiny one disappears into
     * the specular.
     */
    const shell = new THREE.MeshStandardMaterial({
      color: 0x23262a, roughness: 0.78, metalness: 0.18,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: 0x4a4f55, roughness: 0.42, metalness: 0.85,
    });
    const blade = new THREE.MeshStandardMaterial({
      color: 0x9aa4ad, roughness: 0.5, metalness: 0.3,
      transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false,
    });
    const warhead = new THREE.MeshStandardMaterial({
      color: 0x2f2a1e, roughness: 0.62, metalness: 0.55,
    });
    this.materials.push(shell, metal, blade, warhead);
    const strobes = [];
    const halos = [];
    for (let s = 0; s < 2; s++) {
      const hex = s === 0 ? HALO_FRIEND : HALO_ENEMY;
      const st = new THREE.MeshStandardMaterial({
        color: new THREE.Color(hex),
        emissive: new THREE.Color(hex),
        emissiveIntensity: 5.5,
        roughness: 0.4,
        metalness: 0,
      });
      strobes.push(st);
      /**
       * FRIENDLY IS QUIETER. Both sides get a ring — the player asked to tell
       * them apart, and a mark that only appears on hostiles cannot say "that
       * one is ours" — but his own side's is half the opacity and, in `_mark`,
       * four fifths the size. Ten friendly drones a match at full weight would
       * be ten more things in a sky he has to clear before he finds the one
       * that matters.
       */
      const hl = new THREE.MeshBasicMaterial({
        color: new THREE.Color(hex),
        transparent: true,
        opacity: s === 0 ? 0.6 : 1,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      });
      halos.push(hl);
      this.materials.push(st, hl);
    }
    /** Near-black, so the colour has a hard edge on cloud and on brick alike. */
    const haloEdge = new THREE.MeshBasicMaterial({
      color: 0x05080b,
      transparent: true,
      opacity: 0.68,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    /** The converging ring, hostile-only by definition. @see `_mark`. */
    const aimMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(HALO_ENEMY),
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    this.materials.push(haloEdge, aimMat);
    this._strobes = strobes;
    this._halos = halos;
    /** The halos live OUTSIDE the airframe groups: those yaw and bank, and a
     *  billboard inside a rotating parent has to undo the parent every frame. */
    this.markGroup = new THREE.Group();
    this.markGroup.name = 'match-drone-marks';
    this.group.add(this.markGroup);

    for (const d of this.list) {
      const g = new THREE.Group();
      g.name = `drone-${d.slot}`;
      g.visible = false;
      const hull = new THREE.Mesh(body, shell);
      hull.castShadow = true;
      g.add(hull);
      const wh = new THREE.Mesh(head, warhead);
      wh.position.set(0, -0.075, 0.055);
      wh.castShadow = true;
      g.add(wh);
      const st = new THREE.Mesh(strobe, strobes[0]);
      st.position.set(0, 0.055, -0.1);
      g.add(st);
      d.strobe = st;
      d.rotors = [];
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI / 4) + (i * Math.PI) / 2;
        const armMesh = new THREE.Mesh(arm, metal);
        armMesh.rotation.y = a;
        armMesh.castShadow = true;
        g.add(armMesh);
        const x = Math.cos(a) * 0.2;
        const z = -Math.sin(a) * 0.2;
        const p = new THREE.Mesh(pod, metal);
        p.position.set(x, 0.018, z);
        g.add(p);
        const r = new THREE.Mesh(disc, blade);
        r.position.set(x, 0.05, z);
        r.rotation.x = -Math.PI / 2;
        // The blur is a shadow-caster nobody can read and four of them per
        // drone is four cascade draws for nothing.
        r.userData.owNoShadow = true;
        g.add(r);
        d.rotors.push(r);
      }
      d.group = g;
      this.group.add(g);

      /* ---- the halo: three coplanar rings on one billboard ------------- */
      const m = new THREE.Group();
      m.name = `drone-mark-${d.slot}`;
      m.visible = false;
      const back = new THREE.Mesh(haloBack, haloEdge);
      // A hair BEHIND the colour along the billboard's own normal: two coplanar
      // transparent rings with depthWrite off otherwise z-fight on the overlap.
      back.position.z = -0.004;
      back.renderOrder = 3;
      m.add(back);
      const halo = new THREE.Mesh(haloRing, halos[1]);
      halo.renderOrder = 4;
      m.add(halo);
      const aim = new THREE.Mesh(haloRing, aimMat);
      aim.position.z = 0.004;
      aim.renderOrder = 4;
      aim.visible = false;
      m.add(aim);
      d.mark = m;
      d.halo = halo;
      d.aim = aim;
      this.markGroup.add(m);
    }
    this.ctx.scene.add(this.group);
    this.ready = true;
    this.ctx.events.on('damage:dealt', this._onDamage);
    this.ctx.events.on('actor:death', this._onActorDeath);
    this.ctx.events.on('player:death', this._onPlayerDeath);
    return this;
  }

  /* ====================================================================== */
  /* the match                                                              */
  /* ====================================================================== */

  /** Everything back in the box. Called between matches. */
  reset() {
    for (const d of this.list) if (d.alive) this._retire(d, 'reset');
    this._spent[0] = 0;
    this._spent[1] = 0;
    this._nextTeam = 0;
    this._gap = 0;
    for (const k in this.stats) {
      if (Array.isArray(this.stats[k])) this.stats[k][0] = this.stats[k][1] = 0;
      else this.stats[k] = 0;
    }
    this._reportLock(null);
  }

  /**
   * @param {number} dt
   * @param {boolean} live  the round is running — drones LAUNCH only then
   * @param {number} progress `MatchSystem._matchProgress()`, 0..1
   */
  update(dt, live, progress = 0) {
    if (!this.ready || !this.enabled) return;
    if (live) this._schedule(dt, progress);
    let warned = null;
    for (const d of this.list) {
      if (!d.alive) continue;
      this._fly(d, dt);
      if (d.warning) warned = d;
    }
    if (!warned) this._reportLock(null);
  }

  /**
   * WHOSE TURN AND WHETHER YET. @see `RULES.droneLaunchPad` — drone n is owed
   * at progress `(n + 0.5) / budget`, so the budget empties whichever way the
   * match ends, and `droneGap` / `droneMaxAloft` are the two floors that turn a
   * scoring run into a stream rather than a flight.
   */
  _schedule(dt, progress) {
    this._gap -= dt;
    const spent = this._spent[0] + this._spent[1];
    if (spent >= BUDGET) return;
    const owed = (spent + RULES.droneLaunchPad) / BUDGET;
    if (progress < owed) return;
    if (this._gap > 0) return;
    if (this.aloft >= RULES.droneMaxAloft) { this.stats.deferred++; return; }
    this._launch(this._nextTeam);
  }

  /**
   * LAUNCH ONE NOW, ignoring the schedule — the same hand-fire hook
   * `Armour.fire()` publishes and for the same reason: a probe cannot afford to
   * wait for `_matchProgress` to come round, and a screenshot needs a drone in
   * the air on a known frame. It still spends the budget, so a probe that fires
   * thirty gets thirty and no more.
   */
  fire(team = this._nextTeam) {
    return this._launch(team);
  }

  _launch(team) {
    let d = null;
    for (const s of this.list) if (!s.alive) { d = s; break; }
    if (!d) return null;
    const from = this.launchPoint?.(team, this._v);
    if (!from) return null;

    d.id = _nextId++;
    d.team = team;
    d.name = `${team === 0 ? 'HORNET' : 'WASP'}-${this._spent[team] + 1}`;
    d.alive = true;
    d.state = 'climb';
    d.health = HEALTH;
    d.maxHealth = HEALTH;
    d.life = RULES.droneLife;
    d.target = null;
    d.lockT = 0;
    d.blindT = 0;
    d.recoverT = 0;
    d.vector = null;
    d.warning = false;
    // Off one shoulder of the spawn cluster rather than out of its middle, so
    // two drones on the same side do not launch through each other.
    const a = this.rng.range(0, Math.PI * 2);
    d.position.set(from.x + Math.cos(a) * 4, from.y + 1.6, from.z + Math.sin(a) * 4);
    d.groundY = from.y;
    d.vel.set(0, RULES.droneSpeed * 0.6, 0);
    d.scanT = this.rng.range(0, SCAN_EVERY);
    d.rotor = this.rng.range(0, Math.PI * 2);
    d.group.visible = true;
    d.group.position.copy(d.position);
    /**
     * WHOSE IT IS, FROM THE SEAT — one index, decided here and read by both the
     * strobe and the halo, so the two can never disagree. Fixed at launch
     * because a drone cannot change sides mid-flight. @see `HALO_FRIEND`.
     */
    d.hostile = team !== this.playerTeam;
    const paint = d.hostile ? 1 : 0;
    d.strobe.material = this._strobes[paint];
    d.halo.material = this._halos[paint];
    d.markT = 0;
    d.atPlayer = false;
    d.aim.visible = false;
    d.mark.visible = true;

    const phys = this.physics;
    if (phys?.addCollider) {
      d.collider = phys.addCollider({
        shape: 'sphere',
        layer: phys.LAYER.SHOOT_ONLY,
        surface: 'metal',
        owner: d,
        part: 'drone',
        radius: 0.31,
      });
      d.collider.setSphere(d.position.x, d.position.y, d.position.z, 0.31);
    }

    this._spent[team]++;
    this._nextTeam = team === 0 ? 1 : 0;
    this._gap = RULES.droneGap;
    this.stats.launched++;
    this.stats.perTeam[team]++;
    this._emit('launch', d);
    this.onLaunch?.(d);
    return d;
  }

  /* ====================================================================== */
  /* the flight                                                             */
  /* ====================================================================== */

  _fly(d, dt) {
    d.life -= dt;
    if (d.life <= 0) { this._scuttle(d); return; }

    d.scanT -= dt;
    const scan = d.scanT <= 0;
    if (scan) {
      d.scanT = SCAN_EVERY;
      d.groundY = this._groundAt(d.position.x, d.position.z, d.position.y + 2);
    }

    switch (d.state) {
      case 'climb': this._climb(d, dt, scan); break;
      case 'hunt': this._hunt(d, dt, scan); break;
      case 'lock': this._holdLock(d, dt, scan); break;
      case 'dive': this._dive(d, dt); break;
      case 'recover': this._recover(d, dt, scan); break;
      default: break;
    }

    /**
     * COMING AT YOU, in the drone's own terms rather than a guess made from a
     * range: it has CHOSEN the man behind the camera and is either counting out
     * his warning or already committed. Read by `_mark` and by nothing else.
     */
    d.atPlayer = d.target?.isPlayer === true && (d.state === 'lock' || d.state === 'dive');

    this._integrate(d, dt);
  }

  /** Straight up out of the spawn until it is over the roofline. */
  _climb(d, dt, scan) {
    const ceil = d.groundY + RULES.droneAltitude;
    d.want.set(d.position.x, ceil, d.position.z);
    this._steer(d, dt, RULES.droneSpeed);
    if (d.position.y >= ceil - 1.5) d.state = 'hunt';
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * TOWARD THE ENEMY, NOT TOWARD THE FIGHT — and that is a fix, not a taste
   * ────────────────────────────────────────────────────────────────────────
   * This flew to `MatchSystem._airFocus`, which is the aim every OTHER air
   * weapon in this file takes and is right for all of them: they pick from
   * fixed geography and the focus is what stops a strike landing where nobody
   * is. A drone is not fixed geography, and the focus is the centroid of the
   * fight WITH THE PLAYER'S OWN EYE WEIGHTED AS FOUR MEN — so a player standing
   * still (in his spawn, at a cache, in the capture harness) drags the point
   * every drone on the map is flying to onto his own back line, where by
   * definition his enemies are not.
   *
   * Measured, seed 7, on the focus: over 119 hunting samples the nearest
   * hostile averaged 94 m and 0.95 of them were inside the 55 m acquire range,
   * of which ZERO were visible; 6 of 12 drones died on their life clock without
   * ever seeing anybody, and a full match scuttled 14 of 26.
   *
   * A loitering munition has an OPERATOR and a datalink, so it flies at the
   * enemy rather than searching at random: `_scan` picks the nearest live
   * hostile with no sight test at all and that is the waypoint. What is NOT
   * given away is the kill — the lock still needs `droneAcquireRange`, an
   * unbroken `MASK.SIGHT` ray and 2.2 s of warning, so cover works exactly as
   * before and the drone can be flown past a man in a doorway all day.
   *
   * `focus` is kept as the fallback for the one case that has no hostiles at
   * all (a side wiped out between respawns), because a drone with nowhere to be
   * should still be over the town.
   */
  _hunt(d, dt, scan) {
    const ceil = d.groundY + RULES.droneAltitude;
    if (scan) {
      const t = this._scan(d);
      if (t) {
        d.target = t;
        d.lockT = 0;
        d.blindT = 0;
        d.state = 'lock';
        this.stats.locks++;
        this._emit('lock', d);
        return;
      }
    }
    const aim = d.vector ?? this.focus;
    if (aim) {
      // Offset rather than dead on: a drone that flies exactly at a man arrives
      // over his head with nothing in sight, and the drift is what makes the
      // sound move across the street rather than sit still.
      const t = this.ctx.time.elapsed * 0.35 + d.slot * 1.9;
      d.want.set(aim.x + Math.cos(t) * 9, ceil, aim.z + Math.sin(t) * 9);
    } else {
      d.want.set(d.position.x, ceil, d.position.z);
    }
    this._steer(d, dt, RULES.droneSpeed);
    this._avoid(d);
  }

  /**
   * THE 2.2 SECONDS. It closes the whole time — the lock is a warning, not a
   * pause — and the target loses it by breaking sight for `droneLockBreak`, by
   * getting `droneBreakRange` away (which cannot be done on foot), or by dying
   * to something else first.
   */
  _holdLock(d, dt, scan) {
    const t = d.target;
    if (!this._valid(t)) { this._dropLock(d); return; }
    const p = t.position;
    this._v2.set(p.x, p.y + CHEST, p.z);
    const range = d.position.distanceTo(this._v2);
    if (range > RULES.droneBreakRange) { this._dropLock(d); return; }

    const seen = scan ? this._sees(d, this._v2) : d.blindT < RULES.droneLockBreak;
    if (scan) d.blindT = seen ? 0 : d.blindT + SCAN_EVERY;
    else if (!seen) d.blindT += dt;
    if (d.blindT >= RULES.droneLockBreak) { this._dropLock(d); return; }

    d.lockT += dt;
    this.stats.lockSeconds += dt;
    // Down to the target's own height as it closes, so the dive is not a
    // vertical drop the man cannot see coming.
    const alt = Math.min(d.groundY + RULES.droneAltitude, this._v2.y + Math.max(3, range * 0.35));
    d.want.set(this._v2.x, alt, this._v2.z);
    this._steer(d, dt, RULES.droneSpeed);
    this._avoid(d);

    if (t.isPlayer === true) this._reportLock(d, range);
    if (d.lockT >= RULES.droneLockTime) {
      d.state = 'dive';
      this.stats.dives++;
      this._emit('dive', d);
    }
  }

  /**
   * COMMITTED. It steers at `droneTurnRate` and nothing else — no re-planning,
   * no second target — so the last two metres are the player's to win. It goes
   * off on proximity, on contact with the level, or on the ground.
   */
  _dive(d, dt) {
    const t = d.target;
    if (!this._valid(t)) { this._recoverFrom(d); return; }
    const p = t.position;
    this._v2.set(p.x, p.y + CHEST, p.z);
    if (t.isPlayer === true) this._reportLock(d, d.position.distanceTo(this._v2));

    // Steer the VELOCITY at a bounded rate rather than the position: that is
    // what makes the turning circle real and a sidestep survivable.
    this._dir.copy(this._v2).sub(d.position);
    const range = this._dir.length();
    if (range < 1e-4) { this._detonate(d); return; }
    this._dir.divideScalar(range);
    const speed = RULES.droneDiveSpeed;
    if (d.vel.lengthSq() < 1e-6) d.vel.copy(this._dir).multiplyScalar(speed);
    this._v3.copy(d.vel).normalize();
    const dot = Math.min(1, Math.max(-1, this._v3.dot(this._dir)));
    const ang = Math.acos(dot);
    const max = RULES.droneTurnRate * dt;
    if (ang <= max || ang < 1e-5) this._v3.copy(this._dir);
    else this._v3.lerp(this._dir, max / ang).normalize();
    d.vel.copy(this._v3).multiplyScalar(speed);

    if (range <= RULES.droneTriggerRange) { this._detonate(d); return; }
    // Past him and still flying: it missed. Climb out and come round again.
    if (range > 4 && dot < 0.1) { this.stats.missed++; this._recoverFrom(d); }
  }

  /** It missed. Out of the street, no lock for `RECOVER` seconds. */
  _recover(d, dt, scan) {
    d.recoverT -= dt;
    const ceil = d.groundY + RULES.droneAltitude;
    d.want.set(d.position.x, ceil, d.position.z);
    this._steer(d, dt, RULES.droneSpeed);
    if (d.recoverT <= 0 && d.position.y > ceil - 3) d.state = 'hunt';
  }

  _recoverFrom(d) {
    d.state = 'recover';
    d.recoverT = RECOVER;
    d.target = null;
    d.lockT = 0;
    if (d.warning) this._reportLock(null);
  }

  _dropLock(d) {
    d.target = null;
    d.lockT = 0;
    d.blindT = 0;
    d.state = 'hunt';
    if (d.warning) this._reportLock(null);
  }

  /* ---------------------------------------------------------- movement -- */

  /** Accelerate toward `want`, capped at `speed`. */
  _steer(d, dt, speed) {
    this._dir.copy(d.want).sub(d.position);
    const dist = this._dir.length();
    if (dist < 1e-4) { d.vel.multiplyScalar(Math.max(0, 1 - 3 * dt)); return; }
    this._dir.divideScalar(dist);
    // Ease into the last few metres so it does not oscillate around a waypoint.
    const want = speed * Math.min(1, dist / 3);
    this._dir.multiplyScalar(want);
    // Critically damped-ish: a quadcopter has thrust to spare and no inertia
    // worth modelling at this scale.
    d.vel.lerp(this._dir, Math.min(1, 3.2 * dt));
  }

  /**
   * A WALL IN FRONT MEANS UP. It cruises above the roofline, so the only things
   * it can meet are the church and the tall blocks; climbing over is always the
   * right answer and it costs one ray on the scan tick.
   */
  _avoid(d) {
    const phys = this.physics;
    if (!phys) return;
    const s = d.vel.lengthSq();
    if (s < 1) return;
    this._dir.copy(d.vel).normalize();
    const hit = phys.raycast(d.position, this._dir, LOOK_AHEAD, phys.MASK.WORLD);
    if (hit?.hit) d.want.y = Math.max(d.want.y, hit.point.y + 6);
  }

  /**
   * One integration, one sweep, one proxy write and one transform. The sweep is
   * what stops a 17 m/s dive tunnelling through a wall between two frames.
   */
  _integrate(d, dt) {
    const step = this._v3.copy(d.vel).multiplyScalar(dt);
    const len = step.length();
    if (len > 1e-5) {
      const phys = this.physics;
      if (phys?.sphereCast) {
        this._dir.copy(step).divideScalar(len);
        const hit = phys.sphereCast(d.position, this._dir, 0.28, len, phys.MASK.WORLD);
        if (hit?.hit) {
          d.position.copy(hit.point).addScaledVector(this._dir, -0.3);
          // A drone that flies into a wall while hunting is a drone that has
          // stopped being a threat; one that does it in a dive is a near miss
          // with a warhead on it.
          if (d.state === 'dive') this._detonate(d);
          else { d.vel.set(0, RULES.droneSpeed, 0); this._pose(d, dt); }
          return;
        }
      }
      d.position.add(step);
    }
    this._pose(d, dt);
  }

  /** The transform, the rotors and the shoot-down proxy. */
  _pose(d, dt) {
    const g = d.group;
    g.position.copy(d.position);
    // Nose along the velocity, with the bank a real quad flies with.
    const vx = d.vel.x, vz = d.vel.z;
    const h = Math.hypot(vx, vz);
    if (h > 0.2) {
      g.rotation.y = Math.atan2(vx, vz);
      g.rotation.x = Math.min(0.5, (h / RULES.droneDiveSpeed) * 0.42);
    }
    d.rotor += ROTOR_SPIN * dt;
    for (let i = 0; i < 4; i++) d.rotors[i].rotation.z = d.rotor * (i & 1 ? -1 : 1);
    d.collider?.setSphere(d.position.x, d.position.y, d.position.z, 0.31);
    this._mark(d, dt);
  }

  /**
   * THE HALO, ONE DRONE, ONE FRAME. @see the note on `HALO_FRIEND` for what it
   * is for and why the colour is relative to the player rather than to a team.
   *
   * Four writes and no allocation: a position, the camera's own quaternion (the
   * billboard — the mark hangs off `markGroup`, which has no transform of its
   * own, precisely so that copy is the whole of it), a scale, and the converging
   * ring's scale when there is one.
   */
  _mark(d, dt) {
    const m = d.mark;
    if (!m) return;
    const cam = this.ctx.camera;
    m.position.copy(d.position);
    if (!cam) return;
    m.quaternion.copy(cam.quaternion);
    d.markT += dt;
    // Held angular size: a ring that is a true 0.6 m across is four pixels at
    // 120 m, which is the range at which finding it matters most.
    const dist = cam.position.distanceTo(d.position);
    let s = Math.min(HALO_MAX, Math.max(HALO_MIN, dist * HALO_PER_M));
    // His own side's, smaller — @see the note on the friendly halo material.
    if (!d.hostile) s *= 0.8;
    const at = d.atPlayer;
    if (at) {
      // The beat is the same information the lock strip's pulse carries, for an
      // eye that is on the sky rather than on the top of the screen.
      s *= 1 + 0.17 * Math.sin(d.markT * (d.state === 'dive' ? 22 : 11));
    }
    m.scale.setScalar(s);
    if (d.aim.visible !== at) d.aim.visible = at;
    if (at) {
      // CONVERGING, never expanding: the grammar `WorldMarkers.updateDanger`
      // uses for incoming air, and it means the same thing here.
      const ph = (d.markT * (d.state === 'dive' ? 2.4 : 1.3)) % 1;
      const r = 3.2 - 2.2 * (1 - (1 - ph) * (1 - ph) * (1 - ph));
      d.aim.scale.setScalar(r);
    }
  }

  /* ---------------------------------------------------------- the eyes -- */

  /**
   * ONE PASS, TWO ANSWERS, at 4 Hz and never per frame:
   *
   *   the return value  the nearest hostile inside `droneAcquireRange` that it
   *                     can actually SEE — the only thing it may lock on to
   *   `d.vector`        the nearest hostile at ANY range and behind anything —
   *                     where the operator is flying it. @see `_hunt`
   *
   * The sight ray is only fired for candidates already inside the range and
   * already closer than the best so far, so the worst case is a handful of rays
   * per drone per quarter second and the common case is one or none.
   */
  _scan(d) {
    const out = this._foe;
    out.length = 0;
    this.enemies?.(d.team, out);
    let best = null;
    let bestD = RULES.droneAcquireRange * RULES.droneAcquireRange;
    let near = null;
    let nearD = Infinity;
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const p = a?.position;
      if (!p) continue;
      const dx = p.x - d.position.x, dy = p.y + CHEST - d.position.y, dz = p.z - d.position.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < nearD) { nearD = d2; near = p; }
      if (d2 >= bestD) continue;
      this._v2.set(p.x, p.y + CHEST, p.z);
      if (!this._sees(d, this._v2)) continue;
      bestD = d2;
      best = a;
    }
    // A POSITION, COPIED, not the actor's own vector: he may be a corpse by the
    // next scan and a waypoint that follows a ragdoll is a drone flying at the
    // floor. Refreshed every quarter second, which is all a waypoint needs.
    if (near) { d.vec.copy(near); d.vector = d.vec; } else d.vector = null;
    out.length = 0;
    return best;
  }

  _sees(d, at) {
    const phys = this.physics;
    if (!phys?.lineOfSight) return true;
    return phys.lineOfSight(d.position, at, phys.MASK.SIGHT);
  }

  _valid(t) {
    if (!t || !t.position) return false;
    if (t.alive === false || t.dead === true) return false;
    return true;
  }

  _groundAt(x, z, fromY) {
    const phys = this.physics;
    if (!phys) return 0;
    const h = phys.raycast(x, fromY, z, 0, -1, 0, 90, phys.MASK.WORLD);
    return h.hit ? h.point.y : 0;
  }

  /* ====================================================================== */
  /* the end of one                                                         */
  /* ====================================================================== */

  /**
   * THE BLAST — the grenade's own path, and see the header for why that is a
   * statement about code rather than about numbers. The two figures come off
   * the live `weapons` grenade def when there is one, so the drone follows the
   * frag if the frag is ever re-tuned.
   */
  _detonate(d) {
    const b = this._blast;
    const def = this._fragDef();
    b.position.copy(d.position);
    b.radius = def.radius;
    b.damage = def.damage;
    b.team = d.team;
    /**
     * `impulse` because `Armour._takeBlast` reads a frag's strength off it —
     * "a blast that carries no `damage` is not a blast that does none" — and
     * `grenades.js` sets it to `damage * 0.9`. Matching that means the drone
     * and the frag are worth the same against a hull to the last point.
     */
    b.impulse = def.damage * 0.9;
    this._blastAt = this.ctx.time.elapsed;
    this._blastPos.copy(d.position);
    this._blastTeam = d.team;
    this.ctx.events.emit('explosion', b);
    this.stats.detonated++;
    this._emit('boom', d);
    this._retire(d, 'detonate');
  }

  /**
   * Life expired with nobody found. It goes off WHERE IT IS, which is 20 m up
   * over open ground and therefore usually harms nobody — a wasted drone is a
   * real outcome and it is not quietly deleted.
   */
  _scuttle(d) {
    this.stats.scuttled++;
    this._detonate(d);
  }

  /**
   * A round landed on it. Arrives as `damage:dealt` because the proxy carries
   * `owner: d` — the canonical path, which is also what gives the shooter his
   * hitmarker and the kill credit.
   */
  _takeRound(e) {
    const d = e?.target;
    if (!(d instanceof Drone) || !d.alive) return;
    d.health -= e.amount ?? 0;
    if (d.health > 0) return;
    this.stats.shotDown++;
    /**
     * ────────────────────────────────────────────────────────────────────────
     * A DESTROYED DRONE FUNCTIONS ITS WARHEAD — 「ドローンは破壊されたときに爆破して」
     * ────────────────────────────────────────────────────────────────────────
     * THIS REVERSES THE OLD RULE ON PURPOSE. It used to be that "shot down ≠
     * detonated", so a kill deleted the threat outright; a kill now sets the
     * warhead off, and the phase pair says both things happened — `dead` (it
     * was shot down) immediately followed by `boom` (and the warhead
     * functioned), so anything counting shoot-downs still counts them.
     *
     * WHERE THE BLAST HAPPENS: AT THE AIRFRAME, ON THE FRAME THE ROUND KILLED
     * IT, and that is the decision rather than a fallout of one.
     *
     *   THE ALTERNATIVE WAS A DEAD FALL — kill the flight, let the wreck drop
     *   and go off where it lands. It is more physical and it is worse to play
     *   against: the blast then happens somewhere the shooter did not choose,
     *   several tenths of a second later, out of his sight if the thing falls
     *   behind a roof. A risk you cannot see coming is not a risk you can
     *   price.
     *
     *   BLOWING IT UP WHERE IT IS makes the range the whole decision, and the
     *   range is a thing the player is already looking at down his sights: the
     *   blast is `_fragDef().radius` (7.5 m) around the speck he is shooting.
     *   One killed at 40 m over the town, or at `droneAltitude` overhead, is a
     *   firework — the same outcome the old rule gave, because 20 m of air is
     *   more than the radius. One killed at 6 m on its dive is a frag going off
     *   at 6 m, which is most of a man. So shooting early is free, shooting
     *   late costs, and the man who waits until it is close enough to hit
     *   easily has chosen to eat it.
     *
     * AND IT HURTS EVERYONE, unchanged: this is `_detonate` itself, not a
     * variant of it, so the payload is the same canonical `explosion` with
     * `kind: 'grenade'` a dive emits and there is still no team test anywhere
     * downstream. Shooting a hostile drone down over your own squad kills your
     * own squad.
     */
    this._emit('dead', d);
    this._detonate(d);
  }

  _retire(d, why) {
    d.alive = false;
    d.state = 'dead';
    d.target = null;
    if (d.warning) this._reportLock(null);
    d.group.visible = false;
    d.mark.visible = false;
    d.aim.visible = false;
    d.atPlayer = false;
    if (d.collider && this.physics?.removeCollider) this.physics.removeCollider(d.collider);
    d.collider = null;
  }

  /** The frag's own numbers, off the live weapon system when there is one. */
  _fragDef() {
    const out = this._frag ?? (this._frag = { radius: RULES.droneBlastRadius, damage: RULES.droneBlastDamage });
    if (this._fragRead) return out;
    const w = this.ctx.peek('weapons');
    const states = w?.states;
    if (states?.values) {
      for (const s of states.values()) {
        const def = s?.def;
        if (def?.class !== 'grenade' || !(def.blastDamage > 0)) continue;
        out.radius = def.blastRadius ?? out.radius;
        out.damage = def.blastDamage;
        break;
      }
      this._fragRead = true;
    }
    return out;
  }

  /* ---------------------------------------------------------- plumbing -- */

  _emit(phase, d) {
    const e = this._ev;
    e.phase = phase;
    e.id = d.id;
    e.team = d.team;
    e.position.copy(d.position);
    this.ctx.events.emit('match:drone', e);
  }

  /** Tell `match` about the player's lock, or that there is not one any more. */
  _reportLock(d, range = 0) {
    const l = this._lock;
    if (!d) {
      if (!l.active) return;
      l.active = false;
      for (const s of this.list) s.warning = false;
      this.onLock?.(l);
      return;
    }
    if (!d.warning) this.stats.playerLocks++;
    d.warning = true;
    l.active = true;
    l.id = d.id;
    l.team = d.team;
    l.progress = Math.min(1, d.lockT / RULES.droneLockTime);
    l.remain = Math.max(0, RULES.droneLockTime - d.lockT);
    l.diving = d.state === 'dive';
    l.range = range;
    l.x = d.position.x;
    l.y = d.position.y;
    l.z = d.position.z;
    this.stats.playerLockSeconds += this.ctx.time.dt || 0;
    this.onLock?.(l);
  }

  /** MEASUREMENT ONLY — was that death inside a blast we had just made? */
  _onDeath(actor) {
    if (!actor?.position) return;
    if (this.ctx.time.elapsed - this._blastAt > 0.35) return;
    const r = this._blast.radius;
    if (actor.position.distanceToSquared(this._blastPos) > r * r) return;
    this.stats.kills++;
    if (actor.isPlayer === true) this.stats.playerKills++;
    const team = actor.team ?? -1;
    if (team === this._blastTeam) this.stats.friendlyKills++;
  }

  dispose() {
    this.ctx.events.off?.('damage:dealt', this._onDamage);
    this.ctx.events.off?.('actor:death', this._onActorDeath);
    this.ctx.events.off?.('player:death', this._onPlayerDeath);
    for (const d of this.list) if (d.alive) this._retire(d, 'dispose');
    this.group.removeFromParent();
    for (const g of this._geo) g.dispose();
    this._geo.length = 0;
    for (const m of this.materials) m.dispose();
    this.materials.length = 0;
    this.ready = false;
  }
}
