/**
 * AI — one soldier: body, senses, brain, gun.
 *
 * PERCEPTION is deliberately imperfect. A target has to be inside a 100 degree
 * cone, in line of sight through the physics BVH, and then *stay* there for a
 * reaction delay that scales with angle off-centre and distance before the
 * agent acknowledges it. Gunshots and footsteps arrive as events and only give
 * a direction, which becomes a "last known position" that decays — so enemies
 * search where you were, not where you are.
 *
 * It is also TEAM-RELATIVE. This actor looks for anything hostile to its own
 * team, which may be the local player or another actor; `ai.pickVisibleHostile`
 * owns the search and the ray budget. Two sides of seven means most of the men
 * on the map are fighting somebody who is not you.
 *
 * BEHAVIOUR is a small state machine:
 *   idle / patrol / advance -> alert -> combat -> suppressed -> flank ->
 *   retreat -> dead
 * Combat runs a peek-and-shoot loop from a scored cover point, with the squad
 * handing out permission to peek so they never all lean out at once, plus
 * suppressing fire, grenades and repositioning when the target stops moving.
 *
 * ADVANCE is the objective layer the demolition mode needs: a destination and a
 * verb handed down by `match` (push to a site, carry the C4 in, hold an entry,
 * go and cut the wires). It only runs while nothing is shooting at this man —
 * a contact always outranks the objective, and the objective is picked back up
 * when the contact is lost.
 *
 * DAMAGE is per-bone: capsule colliders for head, chest, pelvis, arms and legs
 * are pushed into `physics` every frame, so a headshot is a headshot because of
 * where the round landed, not because of a random roll. Death hands the live
 * skeleton to the ragdoll solver with the bullet's impulse.
 */

import * as THREE from 'three';
import { RIG } from './rig.js';
import { Animator } from './animator.js';

const STATE = {
  IDLE: 'idle',
  PATROL: 'patrol',
  /** Walking to the objective `match` handed down. */
  ADVANCE: 'advance',
  ALERT: 'alert',
  COMBAT: 'combat',
  SUPPRESSED: 'suppressed',
  FLANK: 'flank',
  RETREAT: 'retreat',
  DEAD: 'dead',
};

export { STATE };

/**
 * HOW CLOSE A MAN HAS TO BE TO PUT A FRAG ON A HULL, and it is a narrower
 * window than the one he throws at a man through.
 *
 * The floor is a metre and a half further out than the anti-personnel one
 * because the tank is 6.9 m long and the throw is aimed at the ENGINE DECK
 * (`aimPoint`), which is at the far end of it — a man at 6 m from the hull
 * centre is standing on the thing he is lobbing at. The ceiling is 26 rather
 * than the 20-34 an archetype's `range` buys, because a 3.3 m wide target does
 * not need the arc solved as finely as a man does and six frags have to come
 * from six DIFFERENT men (one grenade each, 16-34 s before the next).
 *
 * Lives here rather than in `index.js` so `AiSystem.armourWorth` and
 * `Agent._combat` cannot disagree about it; `index.js` imports it from this
 * file, which it already imports.
 */
export const ARMOUR_FRAG_MIN = 6.5;
export const ARMOUR_FRAG_MAX = 28;

/**
 * PERSONALITY — and why one `skill` scalar was not enough.
 *
 * `skill` says how well a man SHOOTS: cone, tracking rate, reaction, settle. It
 * says nothing about what he DOES, so before this every bot made the same
 * decisions at different accuracies — the same dwell in the same cover, the same
 * willingness to leave it, the same range, the same flank appetite. Measured on
 * a full 15v15: the per-bot coefficient of variation in metres travelled was
 * 0.19 and in static time 0.16, i.e. thirty men whose *behaviour* was within a
 * fifth of identical. That is the "ただその位置に配置するだけ" complaint, and it
 * cannot be fixed by moving one dial: an aggressive man and a conservative man
 * are not two values of the same number.
 *
 * So each man draws six INDEPENDENT traits at spawn:
 *
 *   aggression  closes, breaks off a firefight to push, fights on at low health
 *   patience    how long he holds one piece of cover / one spot in his sector
 *   range       the distance in metres he WANTS the fight at; cover is scored
 *               around it, and he closes or backs off to reach it
 *   exposure    willingness to be in the open: peek length, whether he waits for
 *               the squad's peek token, how much fire it takes to make him duck
 *   flank       appetite for going wide
 *   trigger     discipline: burst length, the gap between bursts, and whether he
 *               hoses the last known position without a clean shot
 *
 * They are drawn around an ARCHETYPE rather than independently uniform, because
 * a rusher is not "random traits" — he is a recognisable set of them, and the
 * point is that a player can read him. The archetype only shifts the means; the
 * per-man gaussian on top is what makes two rushers different rushers.
 *
 * The mix is per ROLE: the attack is weighted to men who move, the defence to
 * men who hold — but the defence still gets rushers who push out of the site and
 * the attack still gets a marksman who sits back, which is the
 * "コンサバな奴がいてもいい" half of the request.
 */
const ARCHETYPES = {
  /*            aggression  patience  range  exposure  flank  trigger */
  rusher: { aggression: 0.88, patience: 0.16, range: 11, exposure: 0.84, flank: 0.34, trigger: 0.24 },
  flanker: { aggression: 0.66, patience: 0.30, range: 17, exposure: 0.60, flank: 0.92, trigger: 0.46 },
  hunter: { aggression: 0.58, patience: 0.42, range: 21, exposure: 0.54, flank: 0.62, trigger: 0.56 },
  support: { aggression: 0.44, patience: 0.62, range: 25, exposure: 0.36, flank: 0.22, trigger: 0.66 },
  anchor: { aggression: 0.30, patience: 0.80, range: 28, exposure: 0.24, flank: 0.10, trigger: 0.78 },
  marksman: { aggression: 0.16, patience: 0.92, range: 36, exposure: 0.14, flank: 0.04, trigger: 0.92 },
  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE SNIPER — "敵味方にスナイパーを持つキャラを追加して".
   * ────────────────────────────────────────────────────────────────────────
   * The extreme end of the marksman family and NOT a seventh flavour of
   * rifleman: 52 m is past the far edge of every lane on this map, so cover
   * scored around it puts him behind the fight looking down it rather than in
   * it. `flank` is a touch above the marksman's on purpose — a sniper who
   * cannot reposition is a sniper the first grenade kills — and everything
   * else is dialled to a man who holds one angle and waits.
   *
   * The GUN is not here. Traits say what a man DOES; what he is carrying is a
   * different set of numbers and it is applied in the constructor, keyed on
   * this archetype. @see the bolt-gun block there.
   */
  sniper: { aggression: 0.12, patience: 0.95, range: 52, exposure: 0.10, flank: 0.14, trigger: 0.97 },
};

/**
 * Who each side is made of. Ten slots, drawn from with replacement, so a
 * fifteen-man team is a plausible mix rather than a guaranteed one.
 *
 * ONE SLOT IN TEN IS A SNIPER, IN EVERY MIX, WHICH IS WHAT "敵味方に" MEANS.
 * Domination hands `ai.spawn` the same `role` for both sides (`AI_ROLE_FIELD`
 * in src/match), so both draw from `any` and both sides get them; the demolition
 * mixes carry one each so the ruleset the repo shipped with is not left out.
 * The slot is TAKEN FROM an existing long-range one rather than added — the
 * mixes are ten slots by construction and growing one silently re-weights every
 * other archetype in it. `attack` trades its marksman (its only man who wanted
 * the fight past 30 m), `defend` trades one of its two anchors so it keeps a
 * marksman as well, and `any` trades one of its two marksmen.
 */
const ARCHETYPE_MIX = {
  attack: ['rusher', 'rusher', 'rusher', 'flanker', 'flanker', 'hunter', 'hunter', 'support', 'anchor', 'sniper'],
  defend: ['rusher', 'rusher', 'flanker', 'hunter', 'hunter', 'support', 'support', 'anchor', 'sniper', 'marksman'],
  any: ['rusher', 'flanker', 'hunter', 'hunter', 'support', 'support', 'anchor', 'anchor', 'sniper', 'marksman'],
};

/**
 * Draw one soldier: an archetype, six traits jittered off it, and his marksmanship.
 *
 * Exported because `AiSystem` caches the result per callsign (`personaFor`) so a
 * man survives his own respawn as the same man — but the draw itself belongs next
 * to the table it draws from.
 *
 * `defenderBonus` is added to the DEFENCE's skill mean only:
 * "防衛側はもう少しAIの命中精度上げていい". The gaussian is untouched at sd 0.19, so
 * the defence gets better on average without becoming uniform — there is still a
 * 0.2 conscript in it.
 */
export function drawPersona(rng, role, meanSkill, defenderBonus = 0) {
  const mix = ARCHETYPE_MIX[role === 'defend' || role === 'attack' ? role : 'any'];
  const name = mix[rng.int(0, mix.length - 1)];
  const a = ARCHETYPES[name];
  const t = (v, sd) => Math.min(1, Math.max(0.02, v + rng.gauss() * sd));
  return {
    archetype: name,
    traits: {
      aggression: t(a.aggression, 0.11),
      patience: t(a.patience, 0.11),
      exposure: t(a.exposure, 0.12),
      flank: t(a.flank, 0.14),
      trigger: t(a.trigger, 0.11),
      /** METRES, not 0..1 — the distance this man wants the fight at. */
      range: a.range * rng.range(0.82, 1.24),
    },
    skill: Math.min(0.95, Math.max(0.12,
      meanSkill + (role === 'defend' ? defenderBonus : 0) + rng.gauss() * 0.19)),
  };
}

const HITBOXES = [
  ['head', 'Head', 'HeadTop', 0.098, 4.0],
  ['torso', 'Spine1', 'Neck', 0.185, 1.0],
  ['torso', 'Hips', 'Spine1', 0.175, 0.9],
  ['arm', 'UpperArmR', 'HandR', 0.072, 0.65],
  ['arm', 'UpperArmL', 'HandL', 0.072, 0.65],
  ['leg', 'UpLegR', 'FootR', 0.105, 0.7],
  ['leg', 'UpLegL', 'FootL', 0.105, 0.7],
];

/**
 * Ragdoll bone spec, in the order the solver wants it.
 *   [ headBone, tailBone, radius, massFraction, parentIndex, cone°, twist°, map ]
 * `map` false marks a stub whose only job is to weld a limb chain to the torso:
 * the solver shares a particle between two bones only when their endpoints are
 * coincident, so the shoulder and hip need a bone that starts exactly on the
 * spine joint. Deriving our own spec (instead of letting physics infer one from
 * all 25 bones) also gets the capsule radii right, which is the difference
 * between a body and a pancake.
 */
const DOLL = [
  ['Hips', 'Spine', 0.135, 0.14, -1, 0, 0, true],
  ['Spine', 'Spine1', 0.125, 0.10, 0, 22, 16, true],
  ['Spine1', 'Spine2', 0.135, 0.14, 1, 18, 12, true],
  ['Spine2', 'Neck', 0.130, 0.10, 2, 16, 10, true],
  ['Neck', 'Head', 0.052, 0.03, 3, 30, 25, true],
  ['Head', 'HeadTop', 0.098, 0.07, 4, 42, 30, true],
  // stubs get a free cone: their direction is lateral while the parent points
  // up the spine, so any limit here is violated in the bind pose and the solver
  // would inject energy trying to fix it
  ['Spine2', 'UpperArmR', 0.055, 0.02, 3, 179, 179, false],
  ['UpperArmR', 'ForearmR', 0.058, 0.027, 6, 100, 60, true],
  ['ForearmR', 'HandR', 0.048, 0.018, 7, 80, 45, true],
  ['HandR', 'FingersR', 0.038, 0.006, 8, 55, 40, true],
  ['Spine2', 'UpperArmL', 0.055, 0.02, 3, 179, 179, false],
  ['UpperArmL', 'ForearmL', 0.058, 0.027, 10, 100, 60, true],
  ['ForearmL', 'HandL', 0.048, 0.018, 11, 80, 45, true],
  ['HandL', 'FingersL', 0.038, 0.006, 12, 55, 40, true],
  ['Hips', 'UpLegR', 0.065, 0.02, 0, 179, 179, false],
  ['UpLegR', 'LegR', 0.088, 0.10, 14, 95, 35, true],
  ['LegR', 'FootR', 0.068, 0.045, 15, 70, 20, true],
  ['FootR', 'ToeR', 0.050, 0.012, 16, 40, 20, true],
  ['Hips', 'UpLegL', 0.065, 0.02, 0, 179, 179, false],
  ['UpLegL', 'LegL', 0.088, 0.10, 18, 95, 35, true],
  ['LegL', 'FootL', 0.068, 0.045, 19, 70, 20, true],
  ['FootL', 'ToeL', 0.050, 0.012, 20, 40, 20, true],
];

const DEG = Math.PI / 180;

/**
 * ──────────────────────────────────────────────────────────────────────────────
 * GOING NOWHERE — the window, and why it is two seconds and not five
 * ──────────────────────────────────────────────────────────────────────────────
 * "AIのスタック回避 — 移動意図があるのに5秒間ほとんど動かない個体に回避行動". Five
 * seconds is the SYMPTOM the player can see, and `tools/stuckcheck.mjs` scores it
 * exactly that way: five consecutive one-second samples in which a man wanted to
 * move and covered under 0.15 m. A recovery that only fires at five seconds has
 * therefore already lost — the run is five long by the time it does anything.
 *
 * So the verdict is taken on a TWO second window, which is still four to eight
 * metres of travel for anybody actually walking, and the recovery gets the
 * remaining three seconds to put more than 0.15 m under him. `STUCK_CLEAR` is
 * deliberately far below any real gait: the slowest thing on this map is a
 * crouched man crossing a courtyard at 1.8 m/s, and a capsule ground into a wall
 * covers centimetres.
 */
const STUCK_WINDOW = 2.0;
const STUCK_CLEAR = 0.9;
/**
 * A LANE IS FOR CROSSING GROUND, NOT FOR THE LAST TWENTY METRES. @see
 * `_laneVia`. Under `LANE_MIN` everybody converges on the point, which is what
 * taking a point is; `VIA_REACHED` is where a man stops steering at his lane
 * and turns for the objective, and it is deliberately generous — the lane's job
 * is to bend the approach, not to be arrived at.
 */
/**
 * 24 -> 14. MEASURED (`_clump.mjs`, three pinned seeds, 6.6 k man-samples), the
 * pack is not at the point: 93 % of every man sitting in a seven-or-more circle
 * was on the approach and only 7 % was inside twelve metres of a capture zone.
 * What 24 bought was a hard collapse to one file for the last stretch of every
 * route — and the offset already decays with the distance left (@see
 * `_laneVia`), so at 14 m a fireteam is still four men across four metres of
 * frontage rather than four men on one cell. Nothing under this is steered at
 * all: taking a point is converging on it.
 */
const LANE_MIN = 14;
const VIA_REACHED = 7;
/**
 * ──────────────────────────────────────────────────────────────────────────────
 * A FIRETEAM IS A FRONTAGE, NOT A FILE.
 * ──────────────────────────────────────────────────────────────────────────────
 * The lane (`Squad.regroup`) gives each FIRETEAM its own way in. It said nothing
 * about the four men inside one, and measured on the shipped build that is where
 * the pack still came from: the worst circle of a run held 14 men and FOUR
 * fireteams, so the unit of clumping had simply become the fireteam — four men
 * on one via, one A* route and four adjacent standing cells.
 *
 * A seat is therefore worth its own lateral offset, on the same axis and by the
 * same mechanism as the lane: seats 0-3 of a four-man team ride at -9, -3, +3,
 * +9 m of the team's centre line. Four tracks six metres apart is a fireteam
 * moving; it is also, deliberately, wider than the 8 m circle everybody is
 * measured in only at its edges — this is spacing, not scattering, and the team
 * is still one group arriving on one place.
 */
const SEAT_STEP = 6;
/**
 * The candidate ladder `_laneVia` walks, furthest along and widest first.
 * `VIA_AHEAD` is METRES FURTHER ALONG HIS OWN LINE, not a fraction of what is
 * left: the whole point is that the first via out of a spawn is sideways and
 * close, so the side fans out in the first thirty metres instead of the last
 * sixty. Module constants because a fireteam's way in may not allocate.
 * @see `_laneVia`.
 */
const VIA_AHEAD = [30, 20, 44];
const VIA_SCALE = [1, 0.7, 0.45];

/**
 * ──────────────────────────────────────────────────────────────────────────────
 * OFF THE HEIGHT FIELD — the failure that made half the roster statues
 * ──────────────────────────────────────────────────────────────────────────────
 * `src/ai/nav.js` is a 2.5D height field: ONE floor per cell, sampled by dropping
 * a ray from above. Where a bot is standing under something — a rooftop gangway,
 * a balcony, the ground storey of a footprint `_carveInteriors` did not re-sample
 * — the cell he occupies is marked walkable at the height of the thing OVER HIS
 * HEAD. Measured on a live match, every bot with a zero-metre run was standing at
 * y = 0.15 m on a cell whose floor reads 3.3, 3.45, 6.5 or 9.55 m.
 *
 * That is not a slow route, it is a route to a different storey, and it fails in
 * the most expensive way there is: `findPath` snaps `from` to the nearest cell
 * with NO height tolerance, lands on the roof, and then sweeps the entire
 * `maxNodes` ceiling before returning 0. Every one of those solves is ~1.2 ms
 * against a 0.3 ms design assumption, and the per-frame ration is derived from
 * the measured cost (`AiSystem.pathMsBudget`) — so a handful of men in bad cells
 * collapse the whole map's path budget from 9 solves a frame to 4 and starve the
 * men who were fine. `pathsDeferred` measured 5930 in forty seconds.
 *
 * So a man who is off the height field does not ask A* anything. He WALKS BACK
 * ONTO IT (`_regainGrid`) — the nearest cell whose floor is within a stride of
 * his feet, up to eight metres out — and asks again from there. `world` and
 * `nav` may or may not close the hole; the behaviour must not depend on it.
 */
const OFFGRID_TOL = 1.5;

/**
 * Bearings a side-step tries, in eighths of a turn off the leg being walked:
 * perpendicular first, then obtuse, then straight back, then the shallow ones.
 * @see `Agent._sideStep`
 */
const SIDE_FAN = [2, -2, 3, -3, 4, 1, -1];

let _nextId = 1;

export class Agent {
  constructor(ai, opts = {}) {
    this.ai = ai;
    this.ctx = ai.ctx;
    this.id = _nextId++;
    this.rng = ai.rng.fork();
    this.variantName = opts.variant ?? 'vanguard';
    const def = ai.variant(this.variantName);
    this.def = def;
    this.scale = def.variant.scale ?? 1;

    /* ---------------- body ---------------- */
    const { bones, skeleton, root } = RIG.createSkeleton();
    this.bones = bones;
    this.skeleton = skeleton;
    this.mesh = new THREE.SkinnedMesh(def.geometry, def.materials);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = true;
    this.mesh.userData.agent = this;
    this.group = new THREE.Group();
    this.group.name = `enemy${this.id}`;
    this.group.add(root);
    this.group.add(this.mesh);
    this.mesh.bind(skeleton);
    this.group.scale.setScalar(this.scale);
    ai.root.add(this.group);

    /** Physics looks for these when it adopts the skeleton on death. */
    this.skinnedMesh = this.mesh;
    this.mass = 82 * this.scale;

    this.position = new THREE.Vector3().copy(opts.position ?? new THREE.Vector3());
    this.yaw = opts.yaw ?? 0;
    this.targetYaw = this.yaw;
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;
    // The bones' world matrices are derived from the group's, so the group has
    // to be current before anything reads them — including the very first
    // animator pass and a same-frame ragdoll hand-off.
    this.group.updateMatrixWorld(true);

    this.animator = new Animator(RIG, bones, {
      weapon: def.weapon,
      rng: this.rng.fork(),
      scale: this.scale,
      probe: (x, z, fromY, out) => this.ai.probeGround(x, z, fromY, out),
    });

    /* ---------------- physics ---------------- */
    const phys = this.ctx.peek('physics');
    this.phys = phys;
    this.height = 1.78 * this.scale;
    this.radius = 0.34 * this.scale;
    this.controller = phys
      ? phys.createCharacter({
        radius: this.radius,
        height: this.height,
        position: this.position,
        stepHeight: 0.42,
        slopeLimit: 48,
      })
      : null;
    this.velocity = new THREE.Vector3();
    this.grounded = true;

    this.colliders = [];
    if (phys) {
      for (const [part, a, b, r, dmg] of HITBOXES) {
        const c = phys.addCollider({
          shape: 'capsule',
          layer: phys.LAYER.ACTOR,
          surface: 'flesh',
          owner: this,
          part,
          radius: r * this.scale,
          damageScale: dmg,
        });
        c.userData = { a, b };
        this.colliders.push(c);
      }
    }

    /* ---------------- stats ---------------- */
    this.health = 100;
    this.maxHealth = 100;
    this.alive = true;
    this.state = STATE.IDLE;
    this.stateTime = 0;
    this.squad = opts.squad ?? null;
    this.team = opts.team ?? 1;
    /** Killfeed / scoreboard handle. */
    this.name = opts.name ?? `BOT-${this.id}`;
    /** 'attack' | 'defend' — informational; the objective carries the verb. */
    this.role = opts.role ?? null;

    /* ---------------- fireteam (owned by `Squad`) ---------------- */
    /**
     * The four-man team this man is currently in, and his seat in it (0-3).
     * @see `Squad.regroup` for what a fireteam is and why it is cut on the
     * ORDER rather than on the roster; `_laneVia` is the approach it gives him
     * and `_pickHoldSpot` is the arc.
     */
    this.fireteam = null;
    this.ftSeat = 0;
    /** His lane's via-point, snapped to the grid. @see `_laneVia`. */
    this._via = new THREE.Vector3();
    this._hasVia = false;
    this._viaTimer = 0;
    /**
     * THE LANE'S OWN LINE, latched when the lane is taken and not re-aimed at
     * every pick. @see `_laneVia` — without it the offset is measured from
     * wherever the man is standing, which is a bearing and not a lane: it
     * cannot open a gap that is already closed, so a whole side leaving one
     * spawn pocket stays one side for the first sixty metres.
     */
    this._viaOrigin = new THREE.Vector3();
    this._viaAxis = new THREE.Vector3();
    this._hasAxis = false;
    this._viaLane = 0;
    this._viaFor = new THREE.Vector3();

    /* ---------------- objective (owned by `match`) ---------------- */
    /** { mode, position: Vector3, site, facing: Vector3|null } or null. */
    this.objective = null;
    /** Has the "IN POSITION" for THIS objective gone out yet. @see `_advance`. */
    this._saidSet = false;
    /** `ctx.time.elapsed` of this man's last transmission. @see `radio.js`. */
    this._radioAt = -1e9;
    this._objPos = new THREE.Vector3();
    this._objFacing = new THREE.Vector3();
    this._hasFacing = false;
    /** 'plant' | 'defuse' while working the charge: no moving, no shooting. */
    this.working = null;
    /** Set by `ai._updateSpotting`; drives the enemy blip. */
    this.spottedAt = -1e9;
    /** Who put the last round into this man, for kill credit. */
    this.lastAttacker = null;

    /* ---------------- perception ---------------- */
    this.eyeHeight = RIG.eyeHeight * this.scale;
    this.viewRange = 58;
    this.viewCos = Math.cos((100 * Math.PI) / 180 / 2);
    this.awareness = 0; // 0..1 build-up before the target is acknowledged
    this.hasTarget = false;
    this.targetVisible = false;
    this.target = null;
    /**
     * The actual hostile being engaged: another Agent, the player system — or,
     * since the armour stopped being scenery, a vehicle (`isVehicle === true`),
     * which is neither and has no head, no chest and no hit zones.
     */
    this.targetActor = null;
    /**
     * WHAT HE MAY DO ABOUT A HULL, written by `AiSystem.pickVisibleHostile` on
     * every selection: 0 nothing (and then it is never his target), 1 the deck
     * is presented so a rifle is worth firing, 2 only a frag is. It is 0 for
     * every man on a map with no armour on it. @see `AiSystem.armourWorth`.
     */
    this.armourWorth = 0;
    /** Rotating start index for the line-of-sight budget in pickVisibleHostile. */
    this._scanCursor = this.id % 7;
    this.lastKnown = new THREE.Vector3();
    this.lastKnownAge = Infinity;
    this.searchPoint = new THREE.Vector3();
    this.suppression = 0;
    this.reactionTimer = 0;
    this.alertness = 0;

    /* ---------------- combat ---------------- */
    /**
     * SKILL. 0 = a conscript who sprays and misses, 1 = a player you should be
     * afraid of. Drawn per actor around `ai.skill` so a squad is a spread of
     * people rather than seven copies of the same shooter.
     *
     * WHY THIS EXISTS. Before it, every bot had spread 0.032 rad and fired 10.5
     * rounds a second for 17 damage. At 20 m that cone is 0.64 m across against
     * a 0.42 m player capsule — roughly a 40% hit rate, i.e. ~68 damage per
     * second from ONE bot. Two of them killed a full-health player in under a
     * second, from full health, with no regeneration to fall back on. That is
     * not difficulty, it is a coin flip decided before you can react.
     *
     * Everything below is derived from this one number so difficulty is a single
     * dial: `RULES.botSkill` shifts the mean, and the gaussian gives the squad
     * its individuals.
     */
    /**
     * PERSONALITY AND SKILL ARE STICKY PER SOLDIER.
     *
     * A respawn builds a NEW `Agent`, so drawing traits in the constructor alone
     * would give HAWK a different character every six seconds — which is both
     * unreadable to a player and unmeasurable, because a callsign's numbers
     * would then be the average of ten different people. `ai.personaFor` keys
     * the draw on team + callsign + role, so HAWK is the same man all half and
     * becomes somebody else when the sides swap.
     */
    const persona = ai.personaFor(this);
    /** 'rusher'|'flanker'|'hunter'|'support'|'anchor'|'marksman' — see ARCHETYPES. */
    this.archetype = persona.archetype;
    /** Six independent behaviour traits. Read by `_think`, not by the gun. */
    this.traits = persona.traits;
    this.skill = persona.skill;
    const k = this.skill;

    this.weaponRange = 44 + k * 18;
    // Rate of fire barely varies — trigger discipline is expressed in the burst
    // pattern below, which is what a player actually reads as "good" or "bad".
    this.fireRate = (this.variantName === 'irregular' ? 8.2 : 10.5) * (0.86 + k * 0.2);
    this.burstLeft = 0;
    this.fireCooldown = 0;
    this.burstCooldown = this.rng.range(0.4, 1.4);
    this.magSize = 30;
    this.ammo = this.magSize;
    /**
     * ────────────────────────────────────────────────────────────────────────
     * HOW MUCH AMMUNITION A MAN CAME OUT WITH — and why it did not used to be a
     * number at all.
     * ────────────────────────────────────────────────────────────────────────
     * "ここのメリットもっとAIに覚えさせて" — teach the AI the pickups are worth
     * something. A cache cannot be worth anything to a man who cannot run out,
     * and until this line `_shoot` read `this.ammo = this.magSize` on an empty
     * magazine, unconditionally, for ever. An ammunition crate was therefore a
     * square of floor with a reward of zero, and every "go and resupply" order
     * `match` could write was a lie about what the errand was for.
     *
     * FOUR MAGAZINES BEHIND THE ONE IN THE GUN, i.e. 150 rounds a life, and the
     * number is measured rather than picked. `src/ai/behaviour.mjs` over 900 s
     * of live round at 15v15: 262 deaths against ~26 000 actor-seconds is a
     * mean life of about 100 s, and the median man fires 24 rounds a minute —
     * so the median life spends 40 of its 150 rounds and NEVER notices this
     * exists. The top of the distribution fires 94 a minute, spends ~156, and
     * runs himself dry. That asymmetry is the design: the men who go looking
     * for a crate are the men who have actually been fighting, which is both
     * the plausible thing and the thing that puts them indoors.
     *
     * RUNNING DRY IS REAL. `_shoot` will not fire and will not fake a reload —
     * see the empty-magazine branch. It is recoverable in exactly one way, and
     * that way is a cache (`ai.resupply`, driven by `src/match/caches.js`).
     */
    this.reserve = this.magSize * 4;
    /** What he started with. `resupply` may not hand over more than this. */
    this.startReserve = this.reserve;
    /** Magazine empty AND nothing left to load. Set in `_shoot`. */
    this.dry = false;
    /**
     * Cone half-angle, radians. 0.030 at the top of the range down to 0.085 at
     * the bottom — a poor shooter is 2.8x wider, which at 25 m is the difference
     * between hitting you and hitting the wall beside you.
     */
    this.spread = 0.030 + (1 - k) * 0.055;
    /**
     * FIRST-CONTACT SETTLE, 0..1, the single biggest change to how survivable a
     * fight is. A bot that has just acquired a target does not start on it: for
     * the first moment its cone is up to 2.6x wider and it closes over
     * `settleTime`. Good bots settle in about a third of a second, poor ones
     * take over a second. This is what buys the player the beat they need to
     * find cover instead of dying to the first burst from across the street.
     */
    this.aimSettle = 0;
    this.settleTime = 1.25 - k * 0.85;
    /** How fast the muzzle tracks a moving target. Low skill = visibly behind. */
    this.trackRate = 2.6 + k * 4.2;
    /** Baseline hand shake, before suppression is added on top. */
    this.aimWobble = 0.007 + (1 - k) * 0.026;
    this.weaponDamage = 17;
    /**
     * ══════════════════════════════════════════════════════════════════════
     * AND IF HE IS THE SNIPER, HE IS CARRYING A DIFFERENT GUN.
     * ══════════════════════════════════════════════════════════════════════
     * Every number above is the 5.56 carbine every bot on the map has always
     * had. A bolt gun is not that weapon with a tighter cone — it is a
     * different trade in all six dimensions, and the trade is what a player
     * reads as "there is a sniper on that side":
     *
     *   ROUNDS PER SECOND  10x -> ~0.9x. One shot a second, and the second one
     *                      is a decision. This is the whole balance: he can be
     *                      pushed, because the man crossing his lane only has
     *                      to survive one round to be inside the cycle.
     *   DAMAGE             17 -> 55. Two rounds on a torso, one on a head
     *                      (the head hitbox scales x4). Deliberately NOT a
     *                      one-shot torso kill on a 100 HP player: this repo
     *                      already threw out one "decided before you can
     *                      react" weapon (@see the `skill` note above) and a
     *                      1.25x point-blank multiplier on 55 is 69, so the
     *                      player always gets a second in which to break line
     *                      of sight.
     *   CONE               a quarter of the carbine's. At 60 m his group is
     *                      about 0.45 m across, i.e. a torso, which is the
     *                      only reason a 60 m engagement is worth taking.
     *   SETTLE             SLOWER, not faster. He is deadly from a held angle
     *                      and poor when surprised, and that asymmetry is what
     *                      makes flanking him the answer.
     *   TRACKING           slower too — a scope is a bad way to follow a
     *                      sprinting man, and it is why rushing him works.
     *   MAGAZINE           5 + 6 spares. He runs dry on this map's timescale,
     *                      which puts him on the same crate errands as
     *                      everybody else rather than outside the economy.
     *
     * `weaponRange` and `viewRange` are the two that make the rest mean
     * anything: `_combat` will not pull a trigger past `weaponRange` and
     * `_sightTo` will not acquire past `viewRange`, so a 52 m preferred range
     * on a man who could neither see nor shoot past 58/62 m was a preference
     * with nothing behind it. The perception budget is unchanged — it is a
     * fixed two line-of-sight rays per actor per call, not a function of the
     * radius — and this is one man in ten.
     */
    this.sniper = this.archetype === 'sniper';
    if (this.sniper) {
      this.fireRate = 0.92 * (0.82 + k * 0.42);
      this.weaponDamage = 55;
      this.magSize = 5;
      this.ammo = this.magSize;
      this.reserve = this.magSize * 6;
      this.startReserve = this.reserve;
      this.spread = 0.0072 + (1 - k) * 0.0135;
      this.settleTime = 2.05 - k * 1.15;
      this.trackRate = 1.6 + k * 2.2;
      this.aimWobble = 0.004 + (1 - k) * 0.012;
      this.weaponRange = 78 + k * 30;
      this.viewRange = 96;
    }
    this.aimTarget = new THREE.Vector3();
    this.aimActual = new THREE.Vector3();
    this.aimWeight = 0;
    this.wantFire = false;
    this.peekSide = 0;
    this.peeking = false;
    this.peekTimer = this.rng.range(0.5, 2.5);
    this.grenadeCooldown = this.rng.range(9, 22);
    this.hasGrenade = true;

    /* ---------------- navigation ---------------- */
    this.path = [];
    this.pathLen = 0;
    this.pathIndex = 0;
    this.repathTimer = 0;
    this.moveTarget = new THREE.Vector3().copy(this.position);
    this.hasMoveTarget = false;
    this.desiredSpeed = 0;
    this.speed = 0;
    this.crouch = false;
    this.cover = null;
    this.coverPos = new THREE.Vector3();
    /**
     * HOW LONG THIS MAN WILL SIT IN ONE PIECE OF COVER.
     *
     * Cover selection used to be re-run on `repathTimer` and then almost always
     * return the point already occupied, because that point scores well BECAUSE
     * he is standing in it and it is claimed to him. The result is a man who
     * "re-evaluates" every three seconds and never moves — measured at 49.7 % of
     * all actor-time in COMBAT with a mean of 52 m travelled per bot per minute.
     * When this runs out the next pick EXCLUDES the current point, so the
     * re-evaluation has to produce an actual decision.
     */
    this.coverDwell = 0;
    /**
     * Where inside his sector a man holding ground is currently standing. A
     * hold objective is an AREA, not a spot: see `_pickHoldSpot`.
     */
    this._holdSpot = new THREE.Vector3();
    this._hasHoldSpot = false;
    this.holdTimer = 0;
    /**
     * WATCHING AN ANGLE IS NOT STARING AT A DOT. A man stood in his sector sweeps
     * his weapon across it: `_scanYaw` is the current offset off the facing the
     * objective gave him, re-rolled on `_scanTimer`. An impatient man sweeps
     * faster and wider. It is two scalars and it is the difference between a
     * sentry and a mannequin.
     */
    this._scanTimer = this.rng.range(0.5, 2.5);
    this._scanYaw = 0;
    this._scanBase = this.yaw;
    this.patrolPoints = opts.patrol ?? null;
    this.patrolIndex = 0;
    this.stuckTimer = 0;
    this.vaultCooldown = 0;
    /** How high the vault arc humps. Raised for a parapet. @see `_stepOff`. */
    this.vaultLift = 0.42;
    /** a path request the frame budget pushed to the next frame */
    this.pathPending = false;
    this._pendingDest = new THREE.Vector3();

    /* ---------------- going nowhere (see `_trackProgress` / `_unstick`) ---- */
    /** Where he was when the current progress window opened. */
    this._progFrom = new THREE.Vector3().copy(this.position);
    /** Seconds of WANTING to move accumulated in the current window. */
    this._progTime = 0;
    /** How far up the recovery ladder this man currently is, 0-5. */
    this.stuckRung = 0;
    /** Consecutive windows of real progress; two of them retire the ladder. */
    this._progGood = 0;
    /** A hand-made destination that owns the steering while it lasts. */
    this._detour = new THREE.Vector3();
    this._detourTimer = 0;
    /** Wall clock before which `_descend` will not try again. @see `_descend`. */
    this._descendUntil = -1e9;
    /** Which way he tries first. Flipped on every side-step so a repeat differs. */
    this._detourSide = this.rng.float() < 0.5 ? 1 : -1;
    /** Rotating bearing for the blind step the grid cannot advise. @see `_sideStep` */
    this._blindK = this.rng.int(0, 6);
    /** The waypoint he could not get through, and until when it is refused. */
    this._badWp = new THREE.Vector3();
    this._badUntil = -1e9;
    /** Re-entrancy guard for the nudged re-path inside `_goTo`. */
    this._nudging = false;

    /* ---------------- LOD ---------------- */
    /** set by AiSystem._updateRelevance: nothing this actor does reaches a pixel */
    this.lodIrrelevant = false;
    this._animSkip = 0;
    this._animAccum = 0;

    /* ---------------- scratch ---------------- */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._steer = new THREE.Vector3();
    this._boneA = new THREE.Vector3();
    this._boneB = new THREE.Vector3();
    this._muzzleDir = new THREE.Vector3();

    this.clip = 'idle';
  }

  /* ================================================================== */
  /* frame                                                              */
  /* ================================================================== */

  get eye() {
    return this._eye.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  update(dt, ctx) {
    if (!this.alive) return;
    this.stateTime += dt;
    this.suppression = Math.max(0, this.suppression - dt * 0.55);
    this.fireCooldown -= dt;
    this.burstCooldown -= dt;
    this.grenadeCooldown -= dt;
    this.peekTimer -= dt;
    this.repathTimer -= dt;
    this._detourTimer -= dt;
    this.coverDwell -= dt;
    this.holdTimer -= dt;
    this._scanTimer -= dt;
    this.vaultCooldown -= dt;
    this._viaTimer -= dt;
    if (this.lastKnownAge < 1e6) this.lastKnownAge += dt;

    // a path the frame budget deferred: ask again before anything else does
    if (this.pathPending) this._goTo(this._pendingDest);

    this._sense(dt);
    this._think(dt);
    this._move(dt);
    // AFTER the move, because the question it asks is about the move that was
    // just integrated: did the man who wanted to go somewhere actually go.
    this._trackProgress(dt);
    this._shoot(dt);
    this._drive(dt);
  }

  /* ================================================================== */
  /* perception                                                         */
  /* ================================================================== */

  _sense(dt) {
    // The cone, the range limit and the line-of-sight test all still apply —
    // `ai.pickVisibleHostile` owns them now because it also owns the per-frame
    // ray budget across every actor on the map.
    const found = this.ai.pickVisibleHostile(this);
    this.targetVisible = !!found;

    if (found) {
      // A NEW target resets the settle; the same one keeps building.
      if (found !== this.targetActor) this.aimSettle = 0;
      this.targetActor = found;
      const chest = this.ai.actorChest(found, this._v3);
      const dist = this.position.distanceTo(chest);
      // reaction: fast head-on and close, slow at the edge of vision. A less
      // skilled bot takes measurably longer to commit.
      const slack = 1.5 - 0.6 * this.skill;
      const rate = 1 / Math.max(0.12, (0.16 + dist * 0.0075 + (1 - this.alertness) * 0.28) * slack);
      this.awareness = Math.min(1, this.awareness + dt * rate);
      this.lastKnown.copy(chest);
      this.lastKnownAge = 0;
      this.alertness = 1;
      if (this.awareness >= 1) {
        /**
         * THE CONTACT REPORT GOES OUT ON ACQUISITION, not on every frame he can
         * see somebody. This is the exact instant `awareness` crosses 1 — the
         * reaction delay is already spent, so the callout lands when the man
         * commits rather than when the ray first connects, and a man tracking
         * the same target across a street does not re-report him.
         *
         * `_contactVoice` turns `chest` into a bearing or a landmark; the net's
         * per-kind clock stops the whole squad reporting one man. @see radio.js
         */
        if (!this.hasTarget) this.ai.radio?.contact(this, chest);
        this.hasTarget = true;
        this.target = chest;
      }
    } else {
      this.awareness = Math.max(0, this.awareness - dt * 0.35);
      // Losing sight costs some of the settle back — re-peeking is not free.
      this.aimSettle = Math.max(0, this.aimSettle - dt * 0.8);
      if (this.hasTarget && this.lastKnownAge > 6.5) {
        this.hasTarget = false;
        this.targetActor = null;
      }
    }
  }

  /**
   * Where to go and what to do when nobody is shooting. Called by `match`.
   * @param {string} mode  'push'|'plant'|'hold'|'pickup'|'defuse'|'retake'
   * @param {THREE.Vector3} position
   * @param {object|null} site
   * @param {THREE.Vector3|null} facing  look this way once in position
   */
  setObjective(mode, position, site = null, facing = null) {
    if (!position) {
      this.objective = null;
      return;
    }
    const changed = !this.objective || this.objective.mode !== mode
      || this._objPos.distanceToSquared(position) > 1.5 * 1.5;
    this._objPos.copy(position);
    if (facing) {
      this._objFacing.copy(facing);
      this._hasFacing = true;
    } else {
      this._hasFacing = false;
    }
    this.objective = { mode, position: this._objPos, site };
    if (changed) this.objectiveBlocked = false;
    // Force a fresh path next time ADVANCE runs rather than finishing the old one.
    if (changed) {
      /**
       * A NEW ORDER IS SOMETHING TO ACKNOWLEDGE AND SOMETHING TO ARRIVE AT.
       * `_saidSet` gates the "IN POSITION" on the far end of the walk; the
       * "MOVING UP" / "PUSHING" here is the near end, and which one he says is
       * his own aggression — the same man says the same one every time, so it
       * reads as a person rather than as a dice roll.
       *
       * It is deliberately NOT sent for a `pickup`: an errand to a crate is not
       * a manoeuvre and putting it on the net would make the resupply traffic
       * the loudest thing on it. @see `_assignCacheLegs`.
       */
      this._saidSet = false;
      if (mode !== 'pickup' && this.alive && this.ai.combatEnabled !== false) {
        this.ai.radio?.say(this,
          this.traits.aggression > 0.55 ? 'pushing' : 'movingup',
          this.traits.aggression > 0.55 ? 'pushing' : 'movingup', null, true);
      }
      this.repathTimer = 0;
      // A sector spot belongs to the objective it was rolled around; a new
      // objective has to roll a new one or the man holds the old site's ground.
      this._hasHoldSpot = false;
      this.holdTimer = 0;
      if (this.state === STATE.ADVANCE) this.hasMoveTarget = false;
    }
  }

  /** A gunshot or footstep heard from `pos` with a given loudness (metres). */
  hear(pos, loudness) {
    if (!this.alive) return;
    const d = this.position.distanceTo(pos);
    if (d > loudness) return;
    const strength = 1 - d / loudness;
    this.alertness = Math.max(this.alertness, Math.min(1, 0.35 + strength));
    if (this.lastKnownAge > 1.2 || strength > 0.6) {
      this.lastKnown.copy(pos);
      this.lastKnownAge = Math.min(this.lastKnownAge, 0.35);
    }
    // hearing alone never grants a target; it turns the head and the body
    this.awareness = Math.min(0.85, this.awareness + strength * 0.5);
    if (this.state === STATE.IDLE || this.state === STATE.PATROL) this._setState(STATE.ALERT);
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * STORES — what this man is short of, and what a crate may give him
   * ────────────────────────────────────────────────────────────────────────
   * `match` decides what a cache is worth and `ai` owns what a soldier is
   * carrying, so the split is the same one `weapons.scavenge` already draws for
   * the player: `match` says "hand him two magazines", this decides what two
   * magazines actually are and what the ceiling is.
   */

  /** Half a magazine of reserve left, or less: worth walking for. */
  get ammoLow() {
    return this.dry || this.reserve <= this.magSize * 1.5;
  }

  /**
   * Top up. CAPPED AT WHAT HE STARTED WITH, exactly as `weapons.scavenge` is
   * capped at each weapon's starting `def.reserve` and for the same reason: a
   * five minute round with respawns and eight crates on it must not become
   * infinite ammunition. Returns the rounds actually handed over.
   */
  resupply(mags) {
    const want = Math.max(0, Math.min(this.magSize * mags, this.startReserve - this.reserve));
    if (want <= 0) return 0;
    this.reserve += want;
    // A dry man is only dry until somebody gives him something to load; the
    // magazine itself is filled by the next `_shoot`, which plays the reload.
    this.dry = false;
    return want;
  }

  /** One frag, or nothing if he still has his. Returns true if it went in. */
  resupplyGrenade() {
    if (this.hasGrenade) return false;
    this.hasGrenade = true;
    // Straight back into the fight: an unthrown grenade with a 30 s cooldown on
    // it is a crate that gave him nothing for the length of most lives.
    this.grenadeCooldown = Math.min(this.grenadeCooldown, this.rng.range(2, 6));
    return true;
  }

  /** Rounds cracking past raise suppression, which drives the flinch + duck. */
  suppress(amount) {
    if (!this.alive) return;
    this.suppression = Math.min(1.6, this.suppression + amount);
    this.alertness = 1;
  }

  /* ================================================================== */
  /* behaviour                                                          */
  /* ================================================================== */

  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
    if (s !== STATE.COMBAT && s !== STATE.SUPPRESSED) this.peeking = false;
  }

  _think(dt) {
    const sq = this.squad;

    // Working the charge outranks everything: both hands are on it, so no
    // walking, no shooting, and a crouched silhouette that reads as "busy".
    if (this.working) {
      this.desiredSpeed = 0;
      this.hasMoveTarget = false;
      this.wantFire = false;
      this.crouch = true;
      this.aimWeight = 0.2;
      return;
    }

    switch (this.state) {
      case STATE.IDLE:
        this.desiredSpeed = 0;
        this.crouch = false;
        if (this.hasTarget) this._enterCombat();
        else if (this.objective) this._setState(STATE.ADVANCE);
        else if (this.patrolPoints && this.stateTime > 2.5) this._setState(STATE.PATROL);
        break;

      case STATE.ADVANCE:
        this._advance(dt);
        break;

      case STATE.PATROL: {
        this.crouch = false;
        this.desiredSpeed = 1.0 + this.traits.aggression * 0.9;
        if (this.hasTarget) {
          this._enterCombat();
          break;
        }
        if (this.objective) {
          this._setState(STATE.ADVANCE);
          break;
        }
        // a route point whose path is still queued is not a route point reached:
        // taking the next one here would walk the patrol index forward for free
        if (this.pathPending) break;
        if (!this.hasMoveTarget || this.position.distanceTo(this.moveTarget) < 1.1) {
          const p = this.patrolPoints?.[this.patrolIndex % this.patrolPoints.length];
          if (p) {
            this.patrolIndex++;
            this._goTo(p);
          } else this._setState(STATE.IDLE);
        }
        break;
      }

      case STATE.ALERT: {
        this.crouch = false;
        // A man who wants the fight walks toward the noise; a careful one edges.
        this.desiredSpeed = 1.1 + this.traits.aggression * 2.4;
        if (this.hasTarget) {
          this._enterCombat();
          break;
        }
        // move to the last known position, then look around
        if (this.lastKnownAge < 8 && !this.hasMoveTarget) this._goTo(this.lastKnown);
        this._scan(dt, null);
        // An objective is a standing order: stop searching an empty street and
        // get back on it. Without this the attack stalls the first time somebody
        // fires a shot from a window and disappears.
        // How long he will search an empty street before getting back on the
        // objective: a patient man clears the room, an eager one moves on.
        if (this.objective && this.stateTime > 2.2 + this.traits.patience * 5) {
          this._setState(STATE.ADVANCE);
          break;
        }
        if (this.stateTime > 12) this._setState(this.patrolPoints ? STATE.PATROL : STATE.IDLE);
        break;
      }

      case STATE.COMBAT:
        this._combat(dt);
        break;

      case STATE.SUPPRESSED:
        this.crouch = true;
        this.desiredSpeed = 0;
        this.wantFire = false;
        this.peeking = false;
        /**
         * A bold man is back up almost at once; a careful one stays down until the
         * rounds have genuinely stopped coming. NOTE THE DIRECTION: this is the
         * suppression level he is willing to come UP at, so bold is the HIGHER
         * number. Written the other way round (measured) the boldest men on the
         * map were the ones who stayed down longest and the attack spent 21 % of
         * its life in SUPPRESSED against 8.8 % before.
         */
        if (this.suppression < 0.3 + this.traits.exposure * 0.5) {
          // Somebody has this angle ranged. Coming back up in the same spot he
          // was just driven out of is how a man dies twice — the dwell and the
          // repath are both spent, so the first thing COMBAT does is move him.
          this.coverDwell = 0;
          this.repathTimer = 0;
          this._setState(STATE.COMBAT);
        }
        break;

      case STATE.FLANK: {
        this.crouch = false;
        this.desiredSpeed = 3.9 + this.traits.aggression * 1.0;
        this.wantFire = false;
        if (!this.hasMoveTarget || this.position.distanceTo(this.moveTarget) < 1.2
          || this.stateTime > 5 + this.traits.flank * 5) {
          this._setState(STATE.COMBAT);
          this.cover = null;
        }
        // How much incoming fire it takes to abandon the move and turn and fight.
        if (this.suppression > 0.6 + this.traits.exposure * 0.8) this._setState(STATE.COMBAT);
        break;
      }

      case STATE.RETREAT: {
        this.crouch = false;
        this.desiredSpeed = 4.6;
        this.wantFire = false;
        if (!this.hasMoveTarget || this.position.distanceTo(this.moveTarget) < 1.2) {
          this._setState(STATE.COMBAT);
        }
        // Back into it: an aggressive man re-takes the ground he gave up as soon
        // as he is off the floor, a conservative one waits it out.
        if (this.health > 45 && this.stateTime > 2 + (1 - this.traits.aggression) * 5) {
          this._setState(STATE.COMBAT);
        }
        break;
      }
    }

    // Ducking is a personality, not a constant: 0.75 for the boldest man on the
    // map, 1.55 for the most careful. The old flat 1.15 is the middle of that.
    if (this.state === STATE.COMBAT && this.cover
      && this.suppression > 1.7 - this.traits.exposure * 0.8) {
      this._setState(STATE.SUPPRESSED);
      // A man who has just been driven behind his cover says so. High priority,
      // long per-kind cooldown: it is news the first time and noise the fourth.
      this.ai.radio?.say(this, 'pinned', 'pinned', null, true);
    }
  }

  _enterCombat() {
    this._setState(STATE.COMBAT);
    this.cover = null;
    this.repathTimer = 0;
  }

  /**
   * SWEEP THE SECTOR. Called by whatever is holding ground with nothing in sight:
   * the yaw and the muzzle move across an angle either side of the bearing the
   * objective gave him, re-rolled on `_scanTimer`. An impatient man sweeps wider
   * and more often — a marksman holds one bearing almost still, which is exactly
   * the difference the player should be able to read at 30 m.
   *
   * `facing` is a world point to watch, or null to sweep around where he already
   * looks. Two scalars and one lerp; no allocation.
   */
  _scan(dt, facing) {
    if (this._scanTimer <= 0) {
      const p = this.traits.patience;
      this._scanTimer = this.rng.range(0.8, 1.9) + p * this.rng.range(0.7, 3.0);
      this._scanYaw = this.rng.signed() * (0.28 + (1 - p) * 1.05);
      if (!facing) this._scanBase = this.yaw;
    }
    const base = facing
      ? Math.atan2(facing.x - this.position.x, facing.z - this.position.z)
      : this._scanBase;
    this.targetYaw = base + this._scanYaw;
    // the weapon follows the eyes
    this._v.set(
      this.position.x + Math.sin(this.targetYaw) * 14,
      this.position.y + this.eyeHeight - 0.1,
      this.position.z + Math.cos(this.targetYaw) * 14
    );
    this.aimTarget.lerp(this._v, Math.min(1, dt * 2.2));
  }

  /**
   * A* said there is no route to the objective. GET AS CLOSE AS THE GEOMETRY
   * ALLOWS instead of standing still.
   *
   * The previous behaviour here — clear the move target, set speed 0, retry in
   * three to five seconds — is what turned one badly placed bomb site into six
   * motionless bots. An unreachable objective is a level-design bug, but the AI
   * must degrade into "walk toward it and hold" rather than into a statue,
   * because a statue is indistinguishable from a crash.
   *
   * Tries 70% and 40% of the way there, which on a real map lands in the room or
   * the street outside whatever is sealed. Only if EVERY step fails does it give
   * up, and then it says so once rather than silently.
   */
  _advanceFallback(obj) {
    for (const t of [0.7, 0.4]) {
      this._v.copy(this.position).lerp(obj.position, t);
      const ci = this.ai.grid?.nearest(this._v.x, this._v.z, this._v.y, 5, 2.5) ?? -1;
      if (ci < 0) continue;
      const g = this.ai.grid;
      this._v.set(g.worldX(ci % g.nx), g.floor[ci], g.worldZ((ci / g.nx) | 0));
      if (this.position.distanceToSquared(this._v) < 2 * 2) continue; // already there
      if (this._goTo(this._v)) {
        this.repathTimer = this.rng.range(1.5, 2.5);
        return;
      }
    }
    // Genuinely boxed in. Hold, face the objective, and let `match` re-task on
    // its two-second objective refresh.
    if (!this._loggedUnreachable) {
      this._loggedUnreachable = true;
      console.warn(
        `[ai] ${this.name}: no route to its "${obj.mode}" objective ` +
          `(${obj.position.x.toFixed(1)}, ${obj.position.z.toFixed(1)}) — holding`
      );
    }
    this.objectiveBlocked = true;
    this.repathTimer = this.rng.range(2.5, 4);
    this.hasMoveTarget = false;
    this.desiredSpeed = 0;
    this.targetYaw = Math.atan2(
      obj.position.x - this.position.x,
      obj.position.z - this.position.z
    );
  }

  /**
   * Walk the objective. Nothing clever: a path to the point, a run or a jog
   * depending on the verb, and a stand-and-face once there. What makes it read
   * as a squad taking a site is that seven men are doing it at once with local
   * avoidance between them, and that any contact drops them straight into the
   * cover-and-peek loop they already had.
   *
   * Arrival distances are per-verb because the *match* decides what counts as
   * arrived: standing on the C4 is 1 m, taking a bomb site is 2 m.
   */
  _advance(dt) {
    // Freeze time. Nobody moves up before the round starts — and it is not
    // cosmetic: at 4.3 m/s two teams that walk for ten seconds close 86 m, which
    // on a 60 m map means the round is already a firefight before it begins.
    if (this.ai.combatEnabled === false) {
      this.desiredSpeed = 0;
      this.hasMoveTarget = false;
      this.wantFire = false;
      return;
    }
    if (this.hasTarget) {
      this._enterCombat();
      return;
    }
    const obj = this.objective;
    if (!obj) {
      this._setState(this.patrolPoints ? STATE.PATROL : STATE.IDLE);
      return;
    }
    this.crouch = false;
    this.wantFire = false;
    this.aimWeight = 0.4;

    /**
     * A HOLD IS A SECTOR, NOT A FLAGPOLE.
     *
     * `hold` and `retake` are given to more than half the men on the map at any
     * moment (measured: 51 % + 6 % of all objective-time), and the old code
     * walked them to a single authored point and set `desiredSpeed = 0` for the
     * rest of the round. Fifteen defenders converging on one dot and then
     * standing on it is exactly the "AIが立ち止まる" complaint, and it is also
     * bad defence: one grenade, one angle, and the whole site is gone.
     *
     * So a holder walks a spot INSIDE his sector, re-rolled every few seconds,
     * which spreads the defence across the courtyard, keeps every man moving,
     * and means an attacker peeking the same angle twice sees a different
     * picture. `_pickHoldSpot` keeps every spot on the nav grid and inside the
     * sector, so this can never wander a man off the objective.
     */
    /**
     * AND SO IS ARRIVING AT ONE.
     *
     * `push` was not on this list, and the men carrying it are the whole attack
     * minus the carrier. An attacker who reached the site with nothing in sight
     * therefore did exactly what the defenders used to: `desiredSpeed = 0`, face
     * the spawn, stand there. Measured on a full match, the attack spent 32 % of
     * its time in ADVANCE and most of the men in it were parked. Once he is at
     * the site he roams it like a holder does — same sector logic, forward bias
     * from his own aggression — so the attack keeps working the mouths of the
     * courtyard while it waits for the charge instead of queueing at one wall.
     *
     * The pull to the objective is unchanged until he gets there: the sector only
     * engages inside 9 m, so nothing re-routes an approach or a staged flank.
     */
    const anchored = obj.mode === 'hold' || obj.mode === 'retake';
    const holdish = anchored
      || (obj.mode === 'push' && this.position.distanceTo(obj.position) < 9);
    let dest = obj.position;
    if (holdish) {
      if (!this._hasHoldSpot || this.holdTimer <= 0) this._pickHoldSpot(obj);
      if (this._hasHoldSpot) dest = this._holdSpot;
    } else {
      this._hasHoldSpot = false;
    }

    const arrive =
      obj.mode === 'pickup' || obj.mode === 'defuse' ? 1.0
        : obj.mode === 'plant' ? 1.6
          : 2.2;
    const dist = this.position.distanceTo(dest);

    if (dist > arrive) {
      // Crossing the map is a run; moving inside a sector you already hold is a
      // walk, because a defender who sprints between two sandbags cannot shoot.
      // How fast he crosses is his own: a rusher is at 5 m/s, a marksman at 3.4.
      const inSector = holdish && this.position.distanceTo(obj.position) < 14;
      // `haste` is deliberately centred slightly ABOVE 1: personality must not
      // cost the map its pace. Measured, an 0.82-1.18 window took 16 % off the
      // attack's metres per minute on its own.
      const haste = 0.92 + this.traits.aggression * 0.34;
      this.desiredSpeed = inSector ? 2.4 + this.traits.aggression * 1.6
        : (obj.mode === 'hold' ? 3.4 : 4.3) * haste;
      /**
       * WHEN TO ASK A* AGAIN. `stuckTimer` used to be true for everybody on
       * almost every frame (see `_move`), so in practice this gate was "the
       * repath timer expired" and a holder whose sector spot had just been
       * re-rolled got the new route for free. Now that the timer means something,
       * the destination-changed test has to be written down rather than ridden
       * on the back of a broken signal — otherwise a man walks to the spot he was
       * told to leave and only re-plans once he arrives.
       */
      /**
       * …AND HIS FIRETEAM'S OWN WAY IN. `dest` is where the ORDER points; this
       * is the route his four men take to it, and it is the difference between
       * a side and a queue. @see `_laneVia`.
       */
      const target = this._laneVia(dest, dist) ?? dest;
      const moved = this.hasMoveTarget && this.moveTarget.distanceToSquared(target) > 2 * 2;
      /**
       * NOT WHILE HE IS IN THE AIR. A man halfway down a six metre drop is off
       * the height field by definition (@see `OFFGRID_TOL`), so `_goTo` refuses,
       * `_advanceFallback` reads the refusal as "no route to your objective" and
       * sets `objectiveBlocked` — on a man whose route is working perfectly and
       * who lands two thirds of a second later. The route he is already on is
       * the right answer until his feet are back down.
       */
      const airborne = !this.grounded && this.velocity.y < -1.2;
      if (this.repathTimer <= 0 && !this.pathPending && this._detourTimer <= 0 && !airborne
        && (!this.hasMoveTarget || moved || this.stuckTimer > 0.6)) {
        this.repathTimer = this.rng.range(1.1, 2.2);
        if (!this._goTo(target) && !this.pathPending) {
          // A lane that will not route is a lane, not a dead objective: drop it
          // and take the straight line before anything is called blocked.
          if (this._hasVia) this._hasVia = false;
          else if (holdish && this._hasHoldSpot) this._hasHoldSpot = false; // try another spot
          else this._advanceFallback(obj);
        }
      }
      return;
    }

    // ---- in position ---------------------------------------------------
    /**
     * ARRIVING IS A TRANSMISSION, and it is the one that makes the net sound
     * like a plan rather than like an alarm. It fires on the EDGE — the frame
     * `dist` first falls inside `arrive` — so a man holding a sector for two
     * minutes says it once, not once a frame. `_saidSet` is cleared whenever
     * the objective changes (`setObjective`), which is where "a new objective
     * is a new thing to arrive at" belongs.
     *
     * Which of the two he says is what he was sent to do: a man told to HOLD
     * says "HOLDING", everybody else says "IN POSITION".
     */
    if (!this._saidSet) {
      this._saidSet = true;
      if (anchored) this.ai.radio?.say(this, 'holding', 'holding', null, false);
      else this.ai.radio?.say(this, 'inposition', 'inposition', null, false);
    }
    this.desiredSpeed = 0;
    this.hasMoveTarget = false;
    // Watch the sector rather than one bearing off it — and if the objective gave
    // no facing, sweep around where he is already looking rather than freezing.
    this._scan(dt, this._hasFacing ? this._objFacing : null);
    /**
     * Taking a knee used to be `(this.id & 1) === 0`, which is a coin flip on a
     * spawn counter — the same man crouched or did not for reasons no player
     * could ever read. It is the careful men who go prone behind a sandbag and
     * the bold ones who stand in the mouth of it.
     */
    this.crouch = holdish && this.traits.exposure < 0.42;
    this.aimWeight = 0.6;
  }

  /**
   * ──────────────────────────────────────────────────────────────────────────
   * HIS FIRETEAM'S WAY IN — the one point that makes four men a manoeuvre
   * element and not four men in a queue.
   * ──────────────────────────────────────────────────────────────────────────
   * "こういうAI全員が行動経路が一緒で同じ動きだとゲーム性が悪いので ちゃんと４人
   *  １チームの感じで動くところを考えて BFのシステムみたいに"
   *
   * `match` gives thirteen men one capture point and `_advance` walked all
   * thirteen at it in a straight line, which on a street map means ONE STREET.
   * Nothing in here was wrong — every man had a sensible order and a sensible
   * route — and the sum of it is the screenshot: a clump.
   *
   * A LANE IS A VIA-POINT AND NOTHING ELSE. His fireteam's signed offset is
   * measured perpendicular to the line between him and his objective, applied
   * a little past halfway along it, and SNAPPED TO A CELL OF HIS OWN NAV
   * COMPONENT — which is the whole safety argument. The doorway epidemic came
   * from `findPath` returning 0 and `_goTo` reading it as "no route"; a via
   * that is on his own component cannot do that, because a route to it exists
   * by construction. If no such cell is within six rings the lane is simply not
   * taken and he walks the straight line, exactly as before.
   *
   * IT IS SPENT AND THEN DROPPED. Within `VIA_REACHED` of it he stops steering
   * at it and heads for the objective, so a lane bends the approach and never
   * moves the destination — a man cannot be walked away from his order by this.
   * The swing also scales with how far he has to go, so nobody detours fifteen
   * metres sideways to cross a courtyard.
   */
  _laneVia(dest, dist) {
    const ft = this.fireteam;
    /**
     * HIS OWN OFFSET IS HIS TEAM'S PLUS HIS SEAT'S. @see `SEAT_STEP`. A team on
     * the centre lane is no longer a team with nothing to do: its four men take
     * four tracks either side of the middle, which is the case the shipped build
     * left as a file and the case most men are in (the ladder restarts per
     * objective, so the biggest group on every side draws lane 0).
     */
    const seatOff = ft && ft.members.length > 1
      ? (this.ftSeat - (ft.members.length - 1) * 0.5) * SEAT_STEP : 0;
    const lane = ft ? ft.lane + seatOff : 0;
    if (!ft || lane === 0 || dist < LANE_MIN) {
      this._hasVia = false;
      this._hasAxis = false;
      return null;
    }
    const grid = this.ai.grid;
    if (!grid) return null;
    if (this._hasVia) {
      const dx = this._via.x - this.position.x, dz = this._via.z - this.position.z;
      // still worth walking to, and still aimed at the same objective
      if (dx * dx + dz * dz > VIA_REACHED * VIA_REACHED
        && this._viaFor.distanceToSquared(dest) < 8 * 8) return this._via;
      this._hasVia = false;
      this._viaTimer = 1.5;
    }
    if (this._viaTimer > 0) return null;
    this._viaTimer = 2.5;
    const px = this.position.x, pz = this.position.z;
    const here = grid.nearest(px, pz, this.position.y, 3, OFFGRID_TOL);
    if (here < 0) return null;
    const comp = grid.comp[here];

    /**
     * ────────────────────────────────────────────────────────────────────────
     * THE LANE HAS A LINE, AND IT IS LATCHED.
     * ────────────────────────────────────────────────────────────────────────
     * MEASURED on the shipped build: the worst circle of a run held 14 men, it
     * sat 32 m from the nearest spawn point of a pocket 12 m in radius, and the
     * walkable ground under it was 61 m wide. Not a choke, not a doorway, not
     * the capture circle — a side leaving one gate at one moment. Every one of
     * those twelve men already had a lane, a via and a destination, and their
     * destinations were spread over 28 m of ground.
     *
     * The reason the gap never opened is that the offset was measured
     * PERPENDICULAR TO THE LINE FROM WHERE HE IS STANDING NOW. That is a
     * bearing, not a lane: a man 20 m out of the gate with 90 m still to go is
     * sent to a via 50 m ahead and 20 m to the side, which is 22° off — so
     * after those 20 m he has opened six metres on the man beside him, and the
     * next pick re-measures from his new position and asks for the same 22°
     * again. It converges on the objective correctly and never separates
     * anybody early, which is exactly the frame the player screenshotted.
     *
     * So the line is taken ONCE, when the lane is first taken, and the via is a
     * point ON IT: `off` metres to the side of the straight line from where he
     * started to where he is going, `ahead` metres further along it than he
     * has got. The first via is therefore SIDEWAYS AND CLOSE rather than
     * forwards and far, the side fans out inside the first thirty metres, and
     * because the line does not move there is no drift outward to correct — his
     * lateral displacement approaches `off` and stays there.
     */
    if (!this._hasAxis || this._viaLane !== lane
      || this._viaFor.distanceToSquared(dest) > 8 * 8) {
      const dx0 = dest.x - px, dz0 = dest.z - pz;
      const l0 = Math.hypot(dx0, dz0);
      if (l0 < 1e-3) return null;
      this._viaOrigin.copy(this.position);
      this._viaAxis.set(dx0 / l0, 0, dz0 / l0);
      this._viaLane = lane;
      this._viaFor.copy(dest);
      this._hasAxis = true;
    }
    const ax = this._viaAxis.x, az = this._viaAxis.z;
    const ox = this._viaOrigin.x, oz = this._viaOrigin.z;
    // how far along his own line he is, and how far along it the objective is
    const s = (px - ox) * ax + (pz - oz) * az;
    const axisLen = (dest.x - ox) * ax + (dest.z - oz) * az;
    // A fight, a detour or a respawn can leave the line meaningless. Re-take it.
    if (s < -6 || axisLen - s < LANE_MIN || Math.abs(-az * (px - ox) + ax * (pz - oz)) > 34) {
      this._hasAxis = false;
      return null;
    }
    // wider the further he has to go, and never wider than the lane asked for
    const off = lane * Math.min(1, dist / 70);
    /**
     * ONE CANDIDATE WAS NOT ENOUGH, and that is measured rather than argued: on
     * the shipped build only 31 % of live men held a lane at any moment. A
     * street map has buildings in it, so a point fifteen metres off the middle
     * of an avenue is very often inside one — `grid.nearest` then either finds
     * nothing or snaps straight back onto the avenue, the lateral test refuses
     * it, and the man gave up on his lane for two and a half seconds.
     *
     * So the ladder is walked instead: the furthest out and the furthest along
     * first, then nearer and narrower, and the first candidate that is really
     * off the line and really on the way wins. Nine `grid.nearest` calls at
     * worst, at most once every 2.5 s per man, and both ladders are module
     * constants — nothing is allocated here.
     */
    for (let i = 0; i < VIA_AHEAD.length; i++) {
      const t = Math.min(s + VIA_AHEAD[i], axisLen - LANE_MIN);
      if (t <= s + 4) continue;
      for (let j = 0; j < VIA_SCALE.length; j++) {
        const o = off * VIA_SCALE[j];
        const vx = ox + ax * t - az * o;
        const vz = oz + az * t + ax * o;
        const ci = grid.nearest(vx, vz, null, 6, Infinity, comp);
        if (ci < 0) continue;
        const wx = grid.worldX(ci % grid.nx), wz = grid.worldZ((ci / grid.nx) | 0);
        // A via that snapped back onto his own line is not a different way in.
        const lateral = -az * (wx - ox) + ax * (wz - oz);
        if (Math.abs(lateral) < Math.min(3.5, Math.abs(o) * 0.6)) continue;
        // …and it has to be on the side of it the lane asked for
        if (o !== 0 && lateral * o < 0) continue;
        // …and one that is further from the objective than he is has turned him round
        if (Math.hypot(dest.x - wx, dest.z - wz) > dist * 1.1) continue;
        this._via.set(wx, grid.floor[ci], wz);
        this._hasVia = true;
        return this._via;
      }
    }
    return null;
  }

  /**
   * Roll a new spot inside the sector this man is holding.
   *
   * The ring is 4-11 m from the objective, which for a bomb site (radius 8) is
   * the courtyard and its mouths rather than the middle of the paint. Twelve
   * candidate bearings are tried and the first that lands on a nav cell at
   * roughly the objective's height wins — cheap, and the height test is what
   * stops a man on the street "holding" a spot on a roof he cannot path to. If
   * nothing lands, the objective itself is used and the timer is short, so the
   * next attempt comes round quickly instead of the man giving up for good.
   */
  _pickHoldSpot(obj) {
    const grid = this.ai.grid;
    const tr = this.traits;
    /**
     * HOW LONG HE STAYS IN IT is his patience, 2.4 s to 13 s, where it used to be
     * a flat 4-9 for everybody. This one number is most of what makes two men on
     * the same sandbag look like different soldiers: the impatient one is never
     * where you last saw him and the anchor has not moved since the round started.
     */
    this.holdTimer = this.rng.range(2.4, 4.5) + tr.patience * this.rng.range(2.5, 7);
    this._hasHoldSpot = false;
    if (!grid) return;
    /**
     * WHERE IN THE SECTOR, AND ON WHICH SIDE OF IT.
     *
     * The old ring was a uniform 4-11 m on a uniform random bearing, so every man
     * held a random point and the defence had no shape. A bearing is now PREFERRED:
     * the aggressive men take the mouths on the threat side — forward of the
     * objective, toward where the attack is coming from — and the careful ones
     * hold the far side of the courtyard with the site in front of them. Candidate
     * bearings are tried outward from that preference, so the first one that lands
     * on the nav grid is the closest available to where this man wants to be.
     *
     * `_objFacing` is the world point the objective says the threat comes from
     * (`match` passes the enemy's spawn centre), which is what makes "forward"
     * mean anything.
     */
    const forward = tr.aggression >= 0.5;
    let pref = this.rng.range(0, Math.PI * 2);
    if (this._hasFacing) {
      pref = Math.atan2(
        this._objFacing.z - obj.position.z,
        this._objFacing.x - obj.position.x
      );
      if (!forward) pref += Math.PI;
      // ±35° of slop, re-rolled every time, so a man who holds the same side of
      // the site does not hold the same square of it twice.
      pref += this.rng.signed() * 0.6;
    }
    /**
     * …AND FOUR MEN COVER FOUR ARCS. His seat in his own fireteam fans the
     * preference out around the sector, so the team holds the courtyard's
     * mouths between them instead of four soldiers taking a knee behind the
     * same sandbag. It is a bias and not a rule: the ±35° slop above is still
     * on top of it, and the candidate search still fans out from wherever this
     * lands, so a seat whose arc has no ground in it takes the next one.
     * @see `Squad.regroup`.
     */
    const ft = this.fireteam;
    if (ft && ft.members.length > 1) {
      pref += (this.ftSeat - (ft.members.length - 1) * 0.5) * (Math.PI * 0.55);
    }
    // Radius: forward men push out to the mouths, careful men sit deeper.
    const rMin = forward ? 5 : 3;
    const rMax = forward ? 13 : 9;
    for (let i = 0; i < 12; i++) {
      // 0, +30°, -30°, +60°, -60° … so the search fans out from the preference
      const th = pref + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 6);
      const r = this.rng.range(rMin, rMax);
      const x = obj.position.x + Math.cos(th) * r;
      const z = obj.position.z + Math.sin(th) * r;
      const ci = grid.nearest(x, z, obj.position.y, 2, 1.4);
      if (ci < 0) continue;
      this._holdSpot.set(
        grid.worldX(ci % grid.nx),
        grid.floor[ci],
        grid.worldZ((ci / grid.nx) | 0)
      );
      // Do not re-roll onto the square we are already standing on.
      if (this.position.distanceToSquared(this._holdSpot) < 2.5 * 2.5) continue;
      this._hasHoldSpot = true;
      this.repathTimer = 0;
      return;
    }
    this.holdTimer = this.rng.range(1.2, 2.4);
  }

  _combat(dt) {
    const target = this.hasTarget ? this.lastKnown : this.lastKnownAge < 5 ? this.lastKnown : null;
    if (!target) {
      this._setState(STATE.ALERT);
      return;
    }

    // TIME-CRITICAL OBJECTIVES OUTRANK A FIREFIGHT.
    //
    // MEASURED, not a preference: with cover-and-peek always winning, a headless
    // match had the C4 lying on the floor for 110 of a round's 120 seconds. The
    // one man tasked to fetch it was in a duel, and a duel has no end condition —
    // so the attack lost a round it had numbers for, twice, without anybody ever
    // walking to the objective. The same applies to the defuser.
    //
    // The rule is deliberately narrow: only the three verbs that are somebody's
    // job rather than the whole team's ('pickup', 'defuse', and the carrier's
    // 'plant'), only once the firefight has stopped being immediate (nothing
    // visible for a beat), and only after a dwell, so it can never be used to
    // walk out of an ambush. The carrier waits twice as long as the other two
    // because it is the man everybody is shooting at.
    const mode = this.objective?.mode;
    const urgency =
      mode === 'pickup' || mode === 'defuse' ? 2.5
        : mode === 'plant' ? 4
          // 'push' is on the list because without it the attack never arrives:
          // in a stalemate somebody is always visible, so a break-off gated only
          // on "nothing in sight" never fires for the men who are not carrying
          // anything.
          //
          // 12 s -> 5 s with the move to fifteen a side. Twelve was tuned for a
          // 120 s round with seven men, where one duel was a large fraction of
          // the team; at thirty men there is ALWAYS a duel somewhere, so a
          // twelve second dwell meant the attack advanced in the gaps between
          // other people's fights. Five is still long enough that it cannot be
          // used to walk straight out of an ambush — the man has to have had
          // nothing in his sights for the last beat of it.
          : mode === 'push' ? 5
            : 0;
    /**
     * AND HOW LONG *THIS MAN* WILL TRADE SHOTS BEFORE HE GOES ANYWAY.
     *
     * The dwells above are the mode's; this scales them by the person. A rusher
     * breaks off at 0.65x — three seconds of a push objective and he is moving —
     * and a marksman at 1.35x, which is a man who genuinely wants to win the
     * firefight before taking the ground. Same for the stalemate break below,
     * where patience rather than aggression is the trait that fits: it is a
     * question about how long you are willing to hold a line, not about how
     * badly you want the site.
     */
    const breakOff = urgency * (1.35 - this.traits.aggression * 0.7);
    if (urgency && this.stateTime > breakOff && !this.targetVisible) {
      this.cover = null;
      this.ai.cover?.release(this.id);
      this._setState(STATE.ADVANCE);
      return;
    }
    /**
     * THE STALEMATE BREAK. Everything above still requires a clear beat with
     * nothing in sight, and across a thirty-man map that beat can simply never
     * arrive: two lines of men trade shots down a lane and both sides hold,
     * for ever, because every one of them individually always has somebody
     * visible. Three times the dwell — fifteen seconds of continuous contact
     * with no progress — and the man goes anyway, from cover to cover with the
     * objective pull turned up (see `toward` below). This is the difference
     * between a firing line and an assault.
     */
    if (urgency && this.stateTime > breakOff * (1.4 + this.traits.patience * 3)) {
      this.cover = null;
      this.ai.cover?.release(this.id);
      this._setState(STATE.ADVANCE);
      return;
    }
    const sq = this.squad;
    const tr = this.traits;
    const dist = this.position.distanceTo(target);
    /**
     * ══════════════════════════════════════════════════════════════════════
     * THE THING HE IS FIGHTING IS A TANK — three gates, and two of them are
     * "hold your fire"
     * ══════════════════════════════════════════════════════════════════════
     * `AiSystem.armourWorth` has already decided he has a shot worth taking or
     * this hull would not be his target at all. What it cannot decide is what
     * he does with the trigger, and the bench says the wrong answer is loud:
     * 447 rounds into the glacis against the 150 he carries. So
     *
     *   • he fires only on `armourWorth === 1`, which is "the engine deck is
     *     presented" and nothing else;
     *   • he does not put SUPPRESSING fire on a last known position — the whole
     *     point of covering fire is that the man behind the wall might be hit
     *     and might flinch, and a tank does neither;
     *   • his frag is thrown through the armour window rather than the
     *     anti-personnel one, and it is NOT rationed by the squad.
     *
     * That last one is the deliberate opening. `Squad.requestGrenade` exists so
     * a fire team does not put four frags through one window, and it is exactly
     * right for that; against a hull that takes SIX at contact it would be the
     * difference between a squad killing a tank and a squad watching one. A man
     * still throws one grenade every 16-34 s and still has to be handed the
     * next by a cache, so the ration that matters is still there.
     */
    const armour = this.targetActor?.isVehicle === true;

    /**
     * WOUNDED: fall back — at a threshold that is his own. 18 HP for the boldest
     * man on the map and 52 for the most careful, where it used to be a flat 34
     * for everybody, and the roll rate goes with it. This is most of what "some
     * of them should be conservative" means in practice: the anchor breaks
     * contact at half health and comes back, the rusher dies where he stands.
     */
    const breakHealth = 18 + (1 - tr.aggression) * 34;
    if (this.health < breakHealth && this.stateTime > 1.5
      && this.rng.float() < dt * (0.25 + (1 - tr.aggression) * 0.7)) {
      const away = this._v
        .copy(this.position)
        .sub(target)
        .setY(0)
        .normalize()
        .multiplyScalar(9)
        .add(this.position);
      if (this._goTo(away)) {
        this._setState(STATE.RETREAT);
        /**
         * "COVER ME" IS A REQUEST, and it is the one call here that is aimed at
         * a specific man rather than at the net. It goes out as a wounded man
         * breaks contact, which is the moment somebody else has to hold the
         * angle he is leaving — so it is marked `answer`, and what comes back
         * is "ROGER" from whoever is nearest him.
         */
        this.ai.radio?.say(this, 'coverme', 'coverme', null, true);
        return;
      }
    }

    /**
     * COVER SELECTION, AND WHY IT HAS A DWELL NOW.
     *
     * The old condition was "no cover, or the repath timer expired", and the
     * pick that followed nearly always came back with the point the man was
     * already standing in: he is on it, so `travel` is 0 and the travel penalty
     * is 0; it is claimed to him, so the claim filter lets it through; and if it
     * protected him a moment ago it still does. `pick !== this.cover` then made
     * the whole thing a no-op. A man therefore chose cover ONCE per contact and
     * stayed there until the contact died — which is the rooting the brief is
     * about, and it is invisible in the code because it looks like it is
     * re-deciding every three seconds.
     *
     * `coverDwell` forces the issue: when it runs out the current point is
     * EXCLUDED from the search, so the pick has to name somewhere else and the
     * man has to walk. Re-taking cover under fire is most of what reads as
     * competence in a firefight, and it is also how ground gets taken, because
     * the `toward` bias is applied on every one of these moves.
     */
    const stale = this.cover !== null && this.coverDwell <= 0;
    if (!this.cover || this.repathTimer <= 0 || stale) {
      // An attacker's cover has to take ground. See `toward` in nav.js.
      const mode2 = this.objective?.mode;
      const pushing = mode2 === 'push' || mode2 === 'plant' || mode2 === 'pickup' ||
        mode2 === 'defuse' || mode2 === 'retake';
      /**
       * PREFERRED RANGE IS A REAL DECISION NOW.
       *
       * `minRange: 7, maxRange: 30` was every man on the map: thirty soldiers who
       * all wanted the fight at the same distance, which is why they all ended up
       * on the same line. `traits.range` is 9 m for a rusher and 44 for a marksman,
       * and the window is built around it — so the rusher's cover scores best 4 to
       * 15 m from the enemy and he walks INTO the fight, while the marksman's
       * scores best at 20 to 75 and he backs out of it. Two men in the same
       * doorway now leave it in opposite directions.
       */
      const want = tr.range;
      /**
       * AND HE WILL WALK TO IT. `toward` was for attackers only, on the argument
       * that holding IS the defence's objective — true of the site, not of the
       * fight. An aggressive defender pulled toward the CONTACT is a man who
       * pushes out of the site to meet the attack, which is the
       * "行動ももっとアグレッシブでもいい" half of the request; a hurt or careful one
       * is pulled toward his own objective instead, which reads as falling back
       * onto the site and re-taking it. Neither can walk off the map: the pull is
       * a score bias on cover points, not a destination.
       */
      let towardPt = null;
      let towardW = 0.55;
      if (pushing) {
        towardPt = this.objective.position;
        towardW = mode2 === 'plant' || mode2 === 'defuse' ? 0.9
          : 0.3 + tr.aggression * 0.6;
      } else if (this.objective) {
        const bold = tr.aggression > 0.55 && this.health > 55 && dist > want;
        towardPt = bold ? target : this.objective.position;
        towardW = bold ? 0.25 + tr.aggression * 0.45 : 0.2 + (1 - tr.aggression) * 0.35;
      }
      /**
       * ══════════════════════════════════════════════════════════════════════
       * THE ONE MANOEUVRE THE ARMOUR GETS, AND IT IS NOT A CHARGE
       * ══════════════════════════════════════════════════════════════════════
       * A man carrying a frag he cannot throw yet is the whole anti-armour plan
       * standing forty metres too far back. Measured over a full match, seed 12:
       * BLUE had 1633 man-samples inside the throwing window and only 585 of
       * them still had a grenade — the supply is there, the RANGE is what is
       * missing, and a bot who never closes it is a bot who watches.
       *
       * So he is pulled in, and he is pulled in through the machinery that
       * already exists: `toward` is a SCORE BIAS ON COVER POINTS, not a
       * destination, so what this buys is a man working from wall to wall
       * towards the hull rather than a man walking into a coaxial machine gun
       * across an open square. Everything that made his last cover point safe
       * still scores. `0.8` is between an attacker's push (0.3-0.9) and a
       * planter's (0.9): a tank in your street outranks taking ground, and does
       * not outrank arming the bomb.
       *
       * DELIBERATELY NOT A MANOEUVRE FOR THE ENGINE DECK. Sending riflemen round
       * the back of a hull whose coax already scores 11-27 kills a match is
       * feeding it; this sends men who are ALREADY holding the answer to the
       * range at which it works, and only while they are holding it.
       */
      if (this.targetActor?.isVehicle === true && this.hasGrenade &&
          this.grenadeCooldown <= 0 && dist > ARMOUR_FRAG_MAX) {
        towardPt = target;
        towardW = 0.8;
      }
      /**
       * ══════════════════════════════════════════════════════════════════════
       * "スナイパーは基本高台や建物に優先していき" — AND ONLY WHERE HE CAN WALK.
       * ══════════════════════════════════════════════════════════════════════
       * Four options, all of which are zero for everybody else, so no other
       * archetype's cover choice changes by a single point of score.
       *
       * `comp` is the important one and it is a REFUSAL, not a preference. The
       * measurement that forced it: of the 6095 cover points this map bakes,
       * 1293 are above 2.5 m and every single one of them is on a nav island —
       * roofs and upper floors, walkable in a 2.5D height field and reachable
       * by nobody, because a stair is zero waypoints in it. A height bias
       * without the component filter is an order to walk onto a roof, `_goTo`
       * gets no route, and the man stands in the street: the exact failure the
       * `objectiveBlocked` ladder exists to catch, manufactured on purpose.
       * With it, the 53 low-rise positions (berms, docks, plinths) that ARE on
       * his component are the ones he climbs, and because a component label is
       * symmetric they are also positions he can climb back down from.
       *
       * `indoorBonus` is the "建物" half and it is the one that actually pays
       * on this level: 1071 of the baked points are inside an enterable
       * footprint and the ground storeys are in the grid, so a window is
       * somewhere a bot can genuinely hold.
       *
       * `maxThreat` lifts the hard 40 m ceiling in `CoverMap.pick` to his own
       * reach. Without it a man whose preferred range is 52 m is offered
       * nothing at all past 40 and fights where everyone else does.
       */
      /**
       * THE COMPONENT IS A PRECONDITION OF THE PREFERENCE, NOT A COMPANION TO
       * IT. `_navComp` returns -1 for a man who is off the height field, and -1
       * is `pick`'s "no filter" — so a sniper in that state would get the full
       * height bias with nothing stopping it aiming him at a roof, which is the
       * one outcome this whole block exists to prevent. When the grid cannot
       * say where he is, he is scored exactly like everybody else.
       */
      const comp = this.sniper === true ? this._navComp() : -1;
      const isSniper = comp >= 0;
      const pick = this.ai.cover?.pick(this.position, target, {
        id: this.id,
        squad: sq?.members,
        comp,
        /**
         * The weights are measured, not chosen. At 1.6/m and 2.4 the first run
         * put the sniper INDOORS 5.3 % of the time against the marksman's
         * 12.9 % — his own preferred range is 52 m, and `pick` charges
         * `(wantMin - dT) * 0.55` for a position closer to the contact than
         * that, which is ten points or more for the window he is supposed to
         * want. A 2.4 bonus never had a chance against it. These are sized to
         * compete with that penalty rather than to be tasteful, and they are
         * still bounded: the rise is clamped at 6 m inside `pick`.
         */
        heightBias: isSniper ? 2.0 : 0,
        indoorBonus: isSniper ? 6 : 0,
        maxThreat: isSniper ? Math.max(40, this.weaponRange * 0.85) : 40,
        /**
         * AND THE FLOOR OF HIS WINDOW IS LOWER THAN HIS PREFERENCE.
         *
         * `want * 0.45` is 23 m for a sniper, and `pick` charges 0.55 a metre
         * for anything closer — so a window twelve metres from the contact was
         * six points down before the indoor bonus was even added, and the
         * buildings on this map sit ON the capture points, i.e. exactly where
         * the contacts are. The first attempt at this measured him indoors
         * 0-5 % of the time against the marksman's 13 %: the range preference
         * was pushing him out of the one place he was asked to prefer.
         *
         * `maxRange` is untouched at `want * 1.7`, so he still WANTS the long
         * shot and still backs out of a brawl. What changes is that he no
         * longer refuses a good position for being too close to the enemy,
         * which is not a thing a man holding a window does.
         */
        minRange: Math.max(3, want * (isSniper ? 0.25 : 0.45)),
        // The window has a floor: a rusher who wants the fight at 9 m would
        // rather have a wall at 22 m than no wall at all, and the range terms in
        // `CoverMap.pick` are a soft penalty, not a filter.
        maxRange: Math.max(22, want * 1.7),
        // An eager man is willing to cross more ground to get where he wants to
        // be; a careful one shuffles between two adjacent walls. The sniper is
        // the exception on purpose: his aggression is 0.12, which buys him an
        // 8 m leash, and a building he can hold is rarely eight metres away —
        // walking to the position IS his contribution, so he gets a long one.
        maxTravel: isSniper ? (this.cover ? 15 : 34) : this.cover ? 7 + tr.aggression * 11 : 26,
        // Rotating out of a stale spot has to be allowed to go somewhere; with
        // the current point excluded and no room to move, the man would drop
        // cover entirely and stand in the open.
        avoid: stale ? this.cover : null,
        toward: towardPt,
        towardWeight: towardW,
      });
      this.repathTimer = this.rng.range(1.1, 2.2) + tr.patience * this.rng.range(1.2, 3.6);
      if (pick && pick !== this.cover) {
        this.cover = pick;
        this.coverPos.set(pick.x, pick.y, pick.z);
        /**
         * 4-8 s for everybody became 1.5-3 s for an impatient man and up to 12 for
         * an anchor. The dwell is the single strongest lever on how static a bot
         * looks — it is the timer that decides how often he is allowed to want to
         * be somewhere else — so it is the one that has to carry the personality.
         */
        this.coverDwell = this.rng.range(1.5, 3.2) + tr.patience * this.rng.range(2.5, 7);
        this._goTo(this.coverPos);
      } else if (stale) {
        // Nothing better exists right now — do not ask again next frame.
        this.coverDwell = this.rng.range(1.2, 2.8);
      }
    }

    // A cover point we cannot actually reach must not mute the agent for ever.
    // `_goTo` fails outright when A* finds no route (which happens for a cover
    // point across an unwalkable seam), and a path can also run out short of the
    // point. The branch below reads "has cover, not standing in it" as "walk,
    // weapon down, hold fire", so without this the agent stands in the open with
    // the player in plain sight and never pulls the trigger.
    if (
      this.cover &&
      !this.hasMoveTarget &&
      !this.pathPending && // still queued behind the frame's A* budget
      this.position.distanceTo(this.coverPos) > 0.85
    ) {
      this.cover = null;
      this.ai.cover?.release(this.id);
      this.repathTimer = Math.min(this.repathTimer, 0.6);
    }

    const atCover = this.cover
      ? this.position.distanceTo(this.coverPos) < 0.85
      : false;

    if (this.cover && !atCover) {
      /**
       * MOVING INTO POSITION — AND FIRING WHILE HE DOES, IF HE IS THAT MAN.
       *
       * "weapon down, no shooting" for every man crossing between two walls is
       * most of the reason a thirty-man map was quiet: COMBAT held half of all
       * actor-time and only a fifth of it had anybody's finger on a trigger. A
       * bold man shoots on the move — badly, which is the point: `_fireRound`
       * opens his cone with his own speed, so advancing fire is suppression
       * rather than a free kill, and he moves slower while he does it.
       */
      const shootMoving = tr.exposure > 0.5 && this.targetVisible && this.hasTarget
        && dist < this.weaponRange && (!armour || this.armourWorth === 1);
      this.desiredSpeed = shootMoving ? 2.6 + tr.aggression * 1.2 : 4.3;
      this.crouch = false;
      this.wantFire = shootMoving;
      this.aimWeight = shootMoving ? 0.85 : 0.35;
    } else {
      this.desiredSpeed = 0;
      this.hasMoveTarget = false;
      /**
       * PEEK-AND-SHOOT. The squad still alternates who leans out — except that a
       * reckless man does not wait his turn. `exposure > 0.7` is two or three men
       * on a fifteen-man side, and it is what stops a peek token being a queue
       * ticket that silences the whole line while one man shoots.
       */
      const allowed = !sq || sq.requestPeek(this, dt) || tr.exposure > 0.7;
      if (this.peekTimer <= 0) {
        this.peeking = allowed && this.targetVisible !== false;
        // How long he stays out, and how long he stays in. A bold man is out for
        // three seconds at a time and back out almost at once; a careful one
        // shows a shoulder for one and hides for two.
        this.peekTimer = this.peeking
          ? this.rng.range(0.8, 1.6) + tr.exposure * this.rng.range(0.6, 2.4)
          : this.rng.range(0.35, 1.0) + (1 - tr.exposure) * this.rng.range(0.4, 1.6);
        /**
         * A SNIPER'S PEEK IS AN AIM, AND IT HAS TO OUTLAST HIS SETTLE.
         *
         * `exposure` is 0.10 for him by design, which buys a 0.9-1.8 s look —
         * and his `settleTime` is 1.4-1.9 s, so the cone was still 1.5-2.6x
         * open every single time he ducked back in. Measured on the first run:
         * 20 rounds fired and no kills. Holding the angle for at least a settle
         * and a bolt cycle is not "more reckless" — `exposure` still decides
         * how long he HIDES, which is the half of the cycle that is about
         * risk — it is the difference between a man aiming and a man flinching
         * at a scope.
         */
        if (this.sniper && this.peeking) {
          this.peekTimer = Math.max(this.peekTimer, this.settleTime + 1 / this.fireRate + 0.35);
        }
        if (this.peeking && this.cover) {
          this.peekSide = this.ai.cover.peekOffset(this.cover, target, this.eyeHeight, this._v2);
          this.coverPos.copy(this._v2);
        }
      }
      this.crouch = this.cover ? !this.cover.high || !this.peeking : false;
      this.aimWeight = this.peeking ? 1 : 0.55;
      this.wantFire = this.peeking && this.targetVisible && this.hasTarget && dist < this.weaponRange
        && (!armour || this.armourWorth === 1);
      /**
       * SUPPRESSING FIRE at the last known spot without a clean shot: a flat 35 %
       * coin flip for everybody became trigger discipline. A sprayer hoses the
       * window at 70 %, a marksman holds his round at 15 %, and the difference
       * between the two is audible from across the map — which is most of what
       * "もっと戦争らしく撃ち合いまくって" asks for and it costs the player nothing,
       * because rounds into a wall are rounds not into him.
       */
      if (!this.wantFire && !armour && this.hasTarget && this.lastKnownAge < 2.6 && this.peeking) {
        this.wantFire = this.rng.float() < 0.12 + (1 - tr.trigger) * 0.62;
        // Rounds into a window nobody is holding are only useful if somebody
        // knows they are covering fire, so this one is on the net too — at the
        // longest per-kind cooldown in the table, because it is a state and not
        // an event. @see KIND_GAP in radio.js.
        if (this.wantFire) this.ai.radio?.say(this, 'suppress', 'suppressing', null, false);
      }
    }

    /**
     * FLANK when somebody else is holding the enemy's attention.
     *
     * This used to carry `this.grenadeCooldown < 0 === false` as a condition,
     * which parses as `grenadeCooldown >= 0` — i.e. "only flank while the
     * grenade is NOT ready". `grenadeCooldown` is seeded to 9-22 s at spawn and
     * counts down, so the term evaluated true for the first few seconds of an
     * actor's life and false for ever afterwards: flanking switched itself off
     * about twenty seconds into every round. Measured consequence at 15v15:
     * 0.4 % of all actor-time in FLANK. There is no reason a man's grenade
     * should decide whether he may move, and the term is gone.
     *
     * The dwell is 4 s -> 2.5 s and the rate 0.25 -> 0.55/s to match: `Squad`
     * rations flankers properly now (one per five men rather than exactly one),
     * so the gate that matters is the squad's, not a coin flip per actor.
     */
    if (
      sq &&
      this.stateTime > 1.6 + this.traits.patience * 3 &&
      sq.canFlank(this) &&
      // APPETITE. 0.12/s for a man who wants to hold his angle, 1.4/s for one
      // whose whole game is arriving from somewhere else.
      this.rng.float() < dt * (0.12 + tr.flank * 1.3)
    ) {
      const side = this.rng.float() < 0.5 ? 1 : -1;
      const perp = this._v.copy(target).sub(this.position).setY(0).normalize();
      const flank = this._v2
        // How wide he goes is his appetite too: 7 m is a corner, 22 m is the
        // other lane.
        .set(-perp.z * side, 0, perp.x * side)
        .multiplyScalar(this.rng.range(6, 12 + tr.flank * 11))
        .add(this.position)
        .addScaledVector(perp, 4);
      if (this._goTo(flank)) {
        this.cover = null;
        this.ai.cover?.release(this.id);
        this._setState(STATE.FLANK);
        sq.claimFlank(this);
        // Going wide is the one manoeuvre that gets a man shot by his own side,
        // so it is announced and it is answered with "SET".
        this.ai.radio?.say(this, 'flank', 'flanking', null, true);
        return;
      }
    }

    // grenade when the player is pinned and we have line of fire
    //
    // …or when the thing in front of him is armour, on the window above and
    // out of the squad's ration. @see the `armour` note at the top of `_combat`.
    const fragLo = armour ? ARMOUR_FRAG_MIN : 6 + (1 - tr.aggression) * 5;
    const fragHi = armour ? ARMOUR_FRAG_MAX : 20 + tr.range * 0.4;
    if (
      this.hasGrenade &&
      this.grenadeCooldown <= 0 &&
      // A man who fights at 10 m will throw at 7; one who fights at 35 will not
      // throw at all until you are inside his window.
      dist > fragLo &&
      dist < fragHi &&
      this.lastKnownAge < 1.5 &&
      (armour || !sq || sq.requestGrenade(this))
    ) {
      this._throwGrenade(target);
    }
  }

  /* ================================================================== */
  /* movement                                                           */
  /* ================================================================== */

  _goTo(dest) {
    const grid = this.ai.grid;
    if (!grid) {
      this.moveTarget.copy(dest);
      this.hasMoveTarget = true;
      return true;
    }
    /**
     * DO NOT ASK A QUESTION WHOSE ANSWER IS ALREADY KNOWN, AND IS EXPENSIVE.
     *
     * A man off the height field (@see `OFFGRID_TOL`) gets a `from` snapped to a
     * roof and a search that sweeps the whole `maxNodes` ceiling before failing —
     * ~1.2 ms against the 0.3 ms `pathMsBudget` is calibrated for, which drags
     * the ration for every OTHER man on the map down with it. The recovery is
     * `_regainGrid`, not a route.
     */
    if (this._offGrid()) {
      this.pathPending = false;
      this.hasMoveTarget = false;
      return false;
    }
    const n = this.ai.requestPath(this.position, dest, this.path);
    if (n < 0) {
      // The frame's A* budget is spent. Hold the destination and retry on the
      // next frame instead of failing outright: `_combat` reads a failed _goTo as
      // "that cover point is unreachable" and drops it.
      this._pendingDest.copy(dest);
      this.pathPending = true;
      return false;
    }
    this.pathPending = false;
    if (n === 0) {
      this.hasMoveTarget = false;
      return false;
    }
    /**
     * THE EDGE THAT IS NOT WORKING. `_unstick`'s fourth rung remembers the
     * waypoint a man could not get through, and this is where the memory is
     * spent: a fresh route that leaves by the same doorstep is the same route,
     * and handing it back is how a bot spends a whole match re-deciding to walk
     * into the same wall. One slot per man and a wall-clock expiry — a blacklist
     * that never forgets turns a crowd jam into permanent map damage.
     */
    if (this._badUntil > this.ctx.time.elapsed && !this._nudging
      && this.path[0].distanceToSquared(this._badWp) < 1.4 * 1.4) {
      this._nudging = true;
      const ok = this._repathFrom(dest, 2.6);
      this._nudging = false;
      if (ok) return true;
    }
    this.pathLen = n;
    this.pathIndex = 0;
    this.moveTarget.copy(this.path[n - 1]);
    this.hasMoveTarget = true;
    return true;
  }

  /* ================================================================== */
  /* going nowhere                                                      */
  /* ================================================================== */

  /**
   * DID THE MAN WHO WANTED TO MOVE ACTUALLY MOVE.
   *
   * The only two things it needs are INTENT and DISPLACEMENT, and both are
   * already on the actor — which is the point: it does not care WHY he is not
   * moving. A wall the nav grid cannot see, a doorway he keeps clipping, four
   * squadmates in a stairwell and a kerb are all the same failure from here, and
   * a recovery that only handles the cause it was written for will be wrong the
   * next time the map changes.
   *
   * `desiredSpeed` is intent, and it is the SAME field `tools/stuckcheck.mjs`
   * reads, deliberately: a man this refuses to judge is a man the gate refuses
   * to count. Working the charge and the pre-round freeze are both real reasons
   * to stand still, and both zero `desiredSpeed` themselves, so neither needs a
   * special case here.
   */
  _trackProgress(dt) {
    if (this.desiredSpeed <= 0.1 || this.working) {
      this._progTime = 0;
      this._progFrom.copy(this.position);
      return;
    }
    this._progTime += dt;
    if (this._progTime < STUCK_WINDOW) return;
    const dx = this.position.x - this._progFrom.x;
    const dz = this.position.z - this._progFrom.z;
    this._progTime = 0;
    this._progFrom.copy(this.position);
    if (dx * dx + dz * dz >= STUCK_CLEAR * STUCK_CLEAR) {
      // Moving again. Two clean windows retire the ladder rather than one, so a
      // man who is shuffled two metres by the crowd and re-wedged does not get
      // sent back to rung one and repeat the manoeuvre that just failed.
      if (this.stuckRung > 0 && ++this._progGood >= 2) {
        this.stuckRung = 0;
        this._progGood = 0;
      }
      return;
    }
    this._progGood = 0;
    this._unstick();
  }

  /**
   * ──────────────────────────────────────────────────────────────────────────
   * THE LADDER — and the rule is that it never offers the same thing twice
   * ──────────────────────────────────────────────────────────────────────────
   * Everything below `_unstick` was already in this file in one form: `_move`
   * re-pathed to the destination it had just failed to reach, `_advance` asked
   * A* the same question every two seconds, and `_advanceFallback` gave up and
   * stood still. Each of those is a REPEAT, and a repeat is worth nothing
   * against a capsule that is wedged — the state that produced the answer has
   * not changed, so neither does the answer.
   *
   *   1  SIDE-STEP        leave the wedge by hand. No planner, no route: a real
   *                       point two and a half metres off his own heading, and
   *                       the side alternates so rung 3 tries the other one.
   *   2  NUDGED RE-PATH   same destination, search started from a cell to the
   *                       side. A* snaps `from` to a grid cell, so a man ground
   *                       into a corner keeps being handed the corner's route
   *                       until the question is asked from somewhere else.
   *   3  ANOTHER WAYPOINT skip the leg that is not working and steer for the one
   *                       after it, with a side-step to get out first.
   *   4  BLACKLIST        refuse that waypoint for twelve seconds (@see `_goTo`),
   *                       drop the hold spot, and re-plan from scratch.
   *   5  A FRESH JOB      hand the problem to `match`. `objectiveBlocked` is the
   *                       word `src/ai` already had for "I cannot get there";
   *                       `_assignDomination` now reads it and gives the man a
   *                       different standing point or a different zone.
   *
   * A man who has already PROVEN there is no route — `_advanceFallback` set
   * `objectiveBlocked` — skips straight to the top. The first four rungs are all
   * about a route that exists and cannot be walked; his does not exist.
   */
  _unstick() {
    if (this.objectiveBlocked && this.objective) this.stuckRung = 5;
    else this.stuckRung = Math.min(5, this.stuckRung + 1);
    const s = this.ai.stats;
    if (s) {
      s.unstick = (s.unstick ?? 0) + 1;
      if (s.unstickRungs) s.unstickRungs[this.stuckRung]++;
    }
    /**
     * RUNG ZERO, TAKEN BEFORE ANY OF THE OTHERS AND AT WHATEVER RUNG HE IS ON.
     * A man off the height field cannot be helped by a planner, a waypoint or a
     * new objective — all four of those are grid queries and all four return
     * nothing. He has one problem and it is that he is standing somewhere A*
     * cannot see, so he walks until he is not. The rung still climbs underneath
     * it, so a man this cannot rescue reaches `match` for a fresh job anyway.
     */
    if (this._offGrid() && this._regainGrid()) {
      if (s) s.unstickRegain = (s.unstickRegain ?? 0) + 1;
      return;
    }
    /**
     * RUNG ZERO'S SECOND HALF, AND IT ONLY EVER POINTS DOWN. `_regainGrid` walks
     * SIDEWAYS — the nearest cell within a stride of his own feet — and there is
     * a whole surface on this map where nothing is: the roof of an enterable
     * building, whose cells the interior pass re-sampled as the ground storey.
     * @see `NavGrid.nearestGroundBelow` for the measurement. A man up there has
     * no route, no cell, no drop edge and no level neighbour, and every rung
     * below this one is a grid query that will return nothing.
     */
    if (this._descend()) {
      if (s) s.unstickDescend = (s.unstickDescend ?? 0) + 1;
      return;
    }
    switch (this.stuckRung) {
      case 1:
        this._sideStep(2.6);
        break;
      case 2:
        if (!this._repathFrom(this._unstickDest(), 2.6)) this._sideStep(3.2);
        break;
      case 3:
        this._sideStep(3.4);
        this._skipWaypoint();
        break;
      case 4: {
        const wp = this.hasMoveTarget && this.pathIndex < this.pathLen
          ? this.path[this.pathIndex] : null;
        if (wp) {
          this._badWp.copy(wp);
          this._badUntil = this.ctx.time.elapsed + 12;
        }
        this._sideStep(3.4);
        this._hasHoldSpot = false;
        this.holdTimer = 0;
        this.hasMoveTarget = false;
        this.repathTimer = 0;
        this.cover = null;
        this.ai.cover?.release(this.id);
        break;
      }
      default:
        /**
         * ASK FOR SOMETHING ELSE TO DO — and keep the old job while he waits.
         *
         * `objectiveBlocked` is the request, and it survives the write it is
         * asking for: `setObjective` only clears it when the order that arrives
         * is a genuinely DIFFERENT one, which is exactly the case where the man
         * got what he asked for. `match` re-tasks every live bot every two
         * seconds and `_orderZone` now walks him round the zone's standing ring,
         * so a blocked man gets a different mouth and then, via
         * `_nearestFreeIndex`, a different zone.
         *
         * The objective is NOT dropped. A man with none falls through `_think`
         * to IDLE, which is a soldier standing in a street with `desiredSpeed`
         * at zero — the exact posture this whole change exists to remove — and
         * it would also hide the site from `_nearestFreeIndex`, which is the
         * thing that has to know which zone he could not reach.
         */
        this.objectiveBlocked = true;
        this._hasHoldSpot = false;
        this.holdTimer = 0;
        this.hasMoveTarget = false;
        this.repathTimer = 0;
        this._badUntil = -1e9;
        this.stuckRung = 0;
        this._progGood = 0;
        this._sideStep(3.4);
        break;
    }
  }

  /** Where he is currently trying to get to, for a re-plan. */
  _unstickDest() {
    if (this.hasMoveTarget) return this.moveTarget;
    if (this.objective) return this.objective.position;
    return null;
  }

  /**
   * IS THIS MAN WHERE THE HEIGHT FIELD THINKS HE IS. @see `OFFGRID_TOL`
   *
   * A ring search, not a single cell lookup, because the answer that matters is
   * "is there anywhere within a stride that A* and this capsule agree about" —
   * a man on a kerb between two sampled heights is fine, a man under a roof is
   * not. Three rings is 2.4 m at an 0.8 m lattice.
   */
  _offGrid() {
    const g = this.ai.grid;
    if (!g) return false;
    return g.nearest(this.position.x, this.position.z, this.position.y, 3, OFFGRID_TOL) < 0;
  }

  /**
   * WALK BACK ONTO THE NAVIGABLE WORLD. The nearest cell whose floor is within a
   * stride of his feet, out to ten rings — eight metres, which is the width of a
   * street on this map — walked directly, because the planner is exactly the
   * thing that cannot help here.
   */
  _regainGrid() {
    const g = this.ai.grid;
    if (!g) return false;
    const ci = g.nearest(this.position.x, this.position.z, this.position.y, 10, OFFGRID_TOL);
    if (ci < 0) return false;
    this._detour.set(g.worldX(ci % g.nx), g.floor[ci], g.worldZ((ci / g.nx) | 0));
    if (this.position.distanceToSquared(this._detour) < 0.9 * 0.9) return false;
    this._commitDetour(2.4);
    return true;
  }

  /**
   * ──────────────────────────────────────────────────────────────────────────
   * GET OFF THE ROOF. 「屋上だとかにリスポーンしても階段降りるなり、飛び降りるなりして
   * 戦闘に参加しに行って」 — the half of that request the drop graph cannot serve.
   * ──────────────────────────────────────────────────────────────────────────
   * `NavGrid.drop` / `escape` handle the roof A* CAN SEE, and they work: they
   * are edges between two cells of the height field. This is for the man there
   * is no edge for — off the field entirely (a vantage nest, whose cells the
   * interior pass owns), or on a shelf whose component is not the ground's and
   * has no fall out of it. Both look identical from inside the ladder: he wants
   * to move, he is not moving, and every planner query returns nothing.
   *
   * THE TEST IS THAT THE GROUND UNDER HIM IS GROUND HE CANNOT WALK TO, and the
   * component it compares against is the one he is STANDING ON rather than the
   * one under his feet in plan — `_navComp` reads the cell at his x/z with no
   * regard for height, and on a carved roof that is the SHOP FLOOR SIX METRES
   * BELOW HIM, which compares equal to the landing and refused every rescue.
   * The escape label is deliberately not consulted: a man whose component the
   * graph says can fall to the floor, who has nevertheless spent the ladder's
   * whole window going nowhere, is a man the graph is wrong about.
   *
   * The fall is right when he gets here — he takes no damage from it (@see
   * `NavGrid`'s `DROP_MAX` note) and the alternative, measured, is four hundred
   * seconds on a roof.
   *
   * It hands him a DETOUR and not a route, because a route is the thing that
   * does not exist. He walks at the lip, `_stepOff` mantles the parapet when he
   * reaches it, and `_move`'s integrator does the rest.
   *
   * AND IT MAY NOT OWN THE LADDER. A descent that does not work must not be the
   * only thing this man ever tries, so it stands aside for six seconds after
   * each attempt and the rungs below run in the meantime.
   */
  _descend() {
    const g = this.ai.grid;
    if (!g || !g.compSize?.length) return false;
    if (this._detourTimer > 0) return false;
    const now = this.ctx.time.elapsed;
    if (now < this._descendUntil) return false;
    const ci = g.nearestGroundBelow(this.position.x, this.position.z, this.position.y);
    if (ci < 0) return false;
    // Ground he can already walk to is ground he must walk to.
    const hi = g.nearest(this.position.x, this.position.z, this.position.y, 3, OFFGRID_TOL);
    if (hi >= 0 && g.comp[hi] === g.comp[ci]) return false;
    this._descendUntil = now + 6;
    this._detour.set(g.worldX(ci % g.nx), g.floor[ci], g.worldZ((ci / g.nx) | 0));
    // Long enough to cross a roof at the detour's own 2.4 m/s floor. A man who
    // arrives sooner clears it himself (@see `_move`), and one who runs out of
    // clock re-sticks and asks again.
    this._commitDetour(4.0);
    this._detourSide = -this._detourSide;
    return true;
  }

  /**
   * WHICH PIECE OF THE MAP IS THIS MAN STANDING ON, or -1.
   *
   * `NavGrid.comp` is the connected-component label A* already uses to decide
   * whether a goal is reachable before it searches for it. Handing it to
   * `CoverMap.pick` turns "prefer somewhere higher" from an order to walk onto
   * a roof into an order to walk onto the highest thing that is actually
   * joined to the ground he is on. @see the option block in `_combat`.
   *
   * -1 when the grid has not been built or when he is off it — and -1 is
   * `pick`'s "no filter", so a man in that state gets exactly the behaviour he
   * had before, which is what we want: an off-grid man has bigger problems and
   * `_unstick` owns them.
   */
  _navComp() {
    const g = this.ai.grid;
    if (!g || !g.comp) return -1;
    const ix = g.cellX(this.position.x);
    const iz = g.cellZ(this.position.z);
    if (!g.inside(ix, iz)) return -1;
    return g.comp[g.index(ix, iz)];
  }

  /** Hand the steering to `_detour` for `t` seconds and keep the planner off it. */
  _commitDetour(t) {
    this._detourTimer = t;
    // Nothing may overwrite the manoeuvre while it runs: `_advance` re-paths on
    // `repathTimer` and `_combat` on `coverDwell`, and both would put the man
    // straight back on the leg he cannot walk.
    this.repathTimer = Math.max(this.repathTimer, t + 0.2);
    this.coverDwell = Math.max(this.coverDwell, t + 0.2);
  }

  /**
   * A point `dist` metres away on the bearing `k` eighths of a turn off the leg
   * this man is trying to walk, written to `out`. The heading is the LEG and not
   * his facing — a man grinding on a wall is usually already looking at it.
   *
   * `blind` skips the grid. It is not a shortcut: a man off the height field
   * (see `OFFGRID_TOL`) gets `false` from every cell test there is, including
   * the ones that would tell him where to go, so refusing to move without the
   * grid's blessing is how the roster turns to statues. The character controller
   * still sweeps the capsule, so the worst a blind step can do is nothing.
   */
  _lateralCell(dist, k, out, blind) {
    const grid = this.ai.grid;
    let hx = Math.sin(this.yaw);
    let hz = Math.cos(this.yaw);
    const wp = this.hasMoveTarget && this.pathIndex < this.pathLen ? this.path[this.pathIndex] : null;
    if (wp) {
      const dx = wp.x - this.position.x;
      const dz = wp.z - this.position.z;
      const l = Math.sqrt(dx * dx + dz * dz);
      if (l > 0.25) {
        hx = dx / l;
        hz = dz / l;
      }
    }
    const th = Math.atan2(hx, hz) + k * (Math.PI / 4) * this._detourSide;
    const x = this.position.x + Math.sin(th) * dist;
    const z = this.position.z + Math.cos(th) * dist;
    if (blind || !grid) {
      out.set(x, this.position.y, z);
      return true;
    }
    // A tight y tolerance: stepping "sideways" onto a roof or into a stairwell
    // is not a side-step, it is a new bug.
    const ci = grid.nearest(x, z, this.position.y, 2, 1.2);
    if (ci < 0) return false;
    out.set(grid.worldX(ci % grid.nx), grid.floor[ci], grid.worldZ((ci / grid.nx) | 0));
    if (this.position.distanceToSquared(out) < 1.1 * 1.1) return false;
    // The grid's own straight-line test. It knows nothing about the collision
    // that wedged him — that is the whole problem — but it does stop the man
    // side-stepping into a wall everybody agrees is there.
    return grid.lineOfWalk(this.position, out);
  }

  /**
   * RUNG 1. A couple of metres to the side, walked directly. It is the cheapest
   * thing on the ladder and it is the one that works most of the time, because
   * most wedges are a shoulder on a corner rather than a sealed route.
   *
   * The fan is ±90°, then ±135°, then straight back, then ±45°: perpendicular
   * first because that is what clears a corner without giving up the leg, and
   * backwards late because it is the one that costs ground. `_detourSide`
   * mirrors the whole fan and flips on every commit, so the manoeuvre a man
   * repeats is never the manoeuvre that just failed.
   */
  _sideStep(dist) {
    for (let i = 0; i < SIDE_FAN.length; i++) {
      if (!this._lateralCell(dist, SIDE_FAN[i], this._detour, false)) continue;
      this._commitDetour(1.5);
      this._detourSide = -this._detourSide;
      return true;
    }
    /**
     * NOTHING THE GRID WILL BLESS. Either he is boxed in, or — far more often on
     * this map — he is off the height field and every cell query he can make
     * returns nothing. Step anyway, on a bearing that rotates so consecutive
     * attempts are genuinely different attempts.
     */
    this._blindK = (this._blindK + 3) % SIDE_FAN.length;
    this._lateralCell(dist, SIDE_FAN[this._blindK], this._detour, true);
    this._commitDetour(1.5);
    this._detourSide = -this._detourSide;
    return true;
  }

  /**
   * RUNG 2. The same destination, asked from somewhere else. `NavGrid.findPath`
   * snaps `from` to the nearest walkable cell, so every re-plan a wedged man
   * makes starts on the cell he is wedged on and comes back with the leg that is
   * not working. Starting the search two and a half metres to the side is the
   * smallest change that can produce a different first leg — and he walks to
   * that cell first, so the plan and the body agree.
   */
  _repathFrom(dest, dist) {
    if (!dest || !this.ai.grid) return false;
    for (let i = 0; i < 3; i++) {
      // Grid-validated only: this rung spends an A* solve, and spending one from
      // a point the height field does not recognise is the exact waste `_goTo`
      // now refuses to make.
      if (!this._lateralCell(dist, SIDE_FAN[i], this._v2, false)) continue;
      const n = this.ai.requestPath(this._v2, dest, this.path);
      if (n <= 0) continue; // -1 is the frame's ration, 0 is no route at all
      this.pathPending = false;
      this.pathLen = n;
      this.pathIndex = 0;
      this.moveTarget.copy(this.path[n - 1]);
      this.hasMoveTarget = true;
      this._detour.copy(this._v2);
      this._commitDetour(1.5);
      this._detourSide = -this._detourSide;
      return true;
    }
    return false;
  }

  /** RUNG 3. Give up on this leg and steer for the one after it. */
  _skipWaypoint() {
    if (!this.hasMoveTarget || this.pathIndex >= this.pathLen - 1) return false;
    this.pathIndex++;
    this.repathTimer = Math.max(this.repathTimer, 1.7);
    return true;
  }

  _move(dt) {
    /**
     * A DETOUR OUTRANKS THE PATH. `_unstick` hands one down when the route the
     * planner believes in is not one this capsule can walk, and it is a raw
     * world point rather than a path precisely because the planner is the thing
     * that is wrong — asking A* again is rung two, not rung one.
     *
     * `want` gets a floor while one is live: the whole point of the manoeuvre is
     * to move, and the state that produced `desiredSpeed` is the state that has
     * been failing to.
     */
    const onDetour = this._detourTimer > 0;
    const wp = onDetour
      ? this._detour
      : this.hasMoveTarget && this.pathIndex < this.pathLen ? this.path[this.pathIndex] : null;
    this._steer.set(0, 0, 0);
    let want = 0;

    if (wp) {
      const to = this._v.copy(wp).sub(this.position);
      to.y = 0;
      const d = to.length();
      if (d < (onDetour ? 0.6 : this.pathIndex === this.pathLen - 1 ? 0.45 : 0.75)) {
        if (onDetour) this._detourTimer = 0;
        else {
          this.pathIndex++;
          if (this.pathIndex >= this.pathLen) this.hasMoveTarget = false;
        }
      } else {
        to.multiplyScalar(1 / d);
        this._steer.copy(to);
        want = onDetour ? Math.max(this.desiredSpeed, 2.4) : this.desiredSpeed;
      }
    }

    // local avoidance: push off squadmates and steer around them
    const others = this.ai.agents;
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (o === this || !o.alive) continue;
      const dx = this.position.x - o.position.x;
      const dz = this.position.z - o.position.z;
      const d2 = dx * dx + dz * dz;
      const rr = (this.radius + o.radius + 0.42) ** 2;
      if (d2 > rr || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (1 - d / Math.sqrt(rr)) * 1.5;
      this._steer.x += (dx / d) * push;
      this._steer.z += (dz / d) * push;
      // tangential bias breaks head-on deadlocks deterministically
      this._steer.x += (-dz / d) * push * 0.35 * (this.id % 2 ? 1 : -1);
      this._steer.z += (dx / d) * push * 0.35 * (this.id % 2 ? 1 : -1);
      if (want === 0) want = this.desiredSpeed * 0.35;
    }

    if (this._steer.lengthSq() > 1e-6) this._steer.normalize();

    // speed: ease toward the request so starts and stops have weight
    const targetSpeed = want * (this.crouch ? 0.42 : 1) * (1 - this.suppression * 0.25);
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 7);
    if (this.speed < 0.05) this.speed = 0;

    // facing: look where we are going, or at the threat when engaged
    const engaged =
      this.state === STATE.COMBAT || this.state === STATE.SUPPRESSED || this.hasTarget;
    if (engaged && this.lastKnownAge < 8) {
      this.targetYaw = Math.atan2(this.lastKnown.x - this.position.x, this.lastKnown.z - this.position.z);
    } else if (this.speed > 0.2) {
      this.targetYaw = Math.atan2(this._steer.x, this._steer.z);
    }
    let dy = this.targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    // a big turn while standing still becomes a real turn-in-place step
    if (Math.abs(dy) > 0.9 && this.speed < 0.3) this.animator.turn(dy > 0 ? 1 : -1);
    const turnRate = this.speed > 0.3 ? 6.5 : 3.4;
    this.yaw += Math.max(-turnRate * dt, Math.min(turnRate * dt, dy));

    /* integrate through the character controller */
    const c = this.controller;
    if (c) {
      const g = this.phys.gravity;
      this.velocity.y += g * dt;
      const vx = this._steer.x * this.speed;
      const vz = this._steer.z * this.speed;
      c.setHeight?.(this.crouch ? 1.16 * this.scale : this.height);
      const px = this.position.x;
      const pz = this.position.z;
      c.move(vx * dt, this.velocity.y * dt, vz * dt);
      this.position.copy(c.position);
      this.grounded = c.grounded;
      if (c.grounded && this.velocity.y < 0) this.velocity.y = 0;

      // blocked by something low: get over it. A parapet with a route on the
      // other side of it is a STEP OFF and not a vault — @see `_stepOff`.
      if (c.lastMoveBlocked && this.speed > 1.5 && this.vaultCooldown <= 0 && this.grounded) {
        if (!this._stepOff()) this._tryVault();
      }
      /**
       * `lastMoveBlocked` CANNOT SAY WHETHER ANYBODY IS STUCK, and this branch
       * used to be built entirely on it. Measured on a live match, it is true for
       * every man on almost every frame — gravity presses the capsule into the
       * FLOOR and the floor is a contact plane like any other — so the old test
       * reduced to `speed > 0.5`, i.e. "is he walking", and it re-ran A* to THE
       * SAME DESTINATION every 1.1 s for every moving bot on the map. It burned
       * the frame's path ration on men who were fine and did nothing whatsoever
       * for the men who were not.
       *
       * Progress is the honest signal. A man travelling under a third of what his
       * own speed asked for is being held by something; a man who is simply
       * walking clears it every frame.
       *
       * AND IT ONLY GETS ONE SHOT. A stale path is worth re-asking for exactly
       * once — after that, asking the same question again is the bug this whole
       * change exists to fix, so the escalation ladder (`_unstick`) takes over
       * and this stays out of its way for the rest of the episode.
       */
      const dx = this.position.x - px;
      const dz = this.position.z - pz;
      const asked = this.speed * dt * 0.35;
      if (this.speed > 0.8 && dx * dx + dz * dz < asked * asked) {
        this.stuckTimer += dt;
        if (this.stuckTimer > 1.1) {
          this.stuckTimer = 0;
          if (this.stuckRung === 0 && this.hasMoveTarget && this._detourTimer <= 0) {
            this.repathTimer = 0;
            this._goTo(this.moveTarget);
          }
        }
      } else this.stuckTimer = 0;
    } else {
      this.position.x += this._steer.x * this.speed * dt;
      this.position.z += this._steer.z * this.speed * dt;
    }
  }

  /**
   * ──────────────────────────────────────────────────────────────────────────
   * OFF THE ROOF. "屋上だとかにリスポーンしても階段降りるなり、飛び降りるなりして
   * 戦闘に参加しに行って"
   * ──────────────────────────────────────────────────────────────────────────
   * `NavGrid._measureDrops` is the half of this that says the fall is legal —
   * it is a one-way edge, the landing is real ground, and nothing full-height
   * is in the way. This is the half that gets the capsule over the lip, and it
   * is needed because every roof on this map is KERBED: measured over the four
   * biggest of them, 0 drop edges are blocked by a wall and 71/80/237/254 are
   * blocked by a parapet under 1.1 m. Without this the man walks to the edge,
   * leans on the kerb, and is exactly as stranded as he was before — the route
   * would exist and he could not take its first step.
   *
   * It is deliberately NOT `_tryVault` with a bigger number. A vault is a move
   * ONTO ground on the far side and its whole shape is "land 1.5 m away at the
   * same height"; the landing test that refuses a six metre drop is the right
   * test for a vault and the wrong one for this. So this is its own move, it
   * only ever fires when THE ROUTE ITSELF says the next waypoint is below him,
   * and it hands him to gravity rather than to a destination: he is lifted over
   * the parapet and dropped, and `Agent._move`'s own integrator does the fall.
   */
  _stepOff() {
    /**
     * The thing he is STEERING AT has to be the thing asking. A man near a ledge
     * with a route along it is not jumping off it.
     *
     * A detour outranks the path here for the same reason it does in `_move`: a
     * man off the height field has no path by definition (`_goTo` refuses to
     * plan for him), so reading the path alone meant `_descend` could walk him
     * to the parapet and then leave him leaning on it — the exact failure this
     * move was written to prevent, arriving by the one route that has no
     * waypoints. @see `_descend`.
     */
    const wp = this._detourTimer > 0
      ? this._detour
      : this.hasMoveTarget && this.pathIndex < this.pathLen ? this.path[this.pathIndex] : null;
    if (!wp) return false;
    const drop = this.position.y - wp.y;
    if (drop < 0.6 || drop > 7.5) return false;
    const dx = wp.x - this.position.x, dz = wp.z - this.position.z;
    const flat = Math.hypot(dx, dz);
    if (flat > 2.6) return false;
    const fx = flat > 1e-3 ? dx / flat : Math.sin(this.yaw);
    const fz = flat > 1e-3 ? dz / flat : Math.cos(this.yaw);
    const phys = this.phys;
    const py = this.position.y;
    // a lip, not a wall: something at shin height and nothing at chest height
    const low = phys.raycast(this.position.x, py + 0.35, this.position.z, fx, 0, fz, 1.1, phys.MASK.WORLD);
    if (!low.hit) return false;
    if (phys.raycastAny(this.position.x, py + 1.25, this.position.z, fx, 0, fz, 1.3, phys.MASK.WORLD)) return false;
    // how high is the thing he is putting a hand on
    const capX = this.position.x + fx * (low.distance + 0.12);
    const capZ = this.position.z + fz * (low.distance + 0.12);
    const cap = phys.raycast(capX, py + 1.7, capZ, 0, -1, 0, 2.0, phys.MASK.WORLD);
    const lipY = cap.hit ? cap.point.y : py + 0.9;
    if (lipY - py > 1.3) return false;
    this.vaultCooldown = 2.5;
    this.animator.vault(0.8);
    this.vaultFrom = (this.vaultFrom ?? new THREE.Vector3()).copy(this.position);
    // Just past the parapet and no further. There is nothing under him there,
    // which is the point: the vault ends and he falls the rest of the way.
    this.vaultTo = (this.vaultTo ?? new THREE.Vector3())
      .set(this.position.x + fx * (low.distance + 0.75), lipY + 0.04, this.position.z + fz * (low.distance + 0.75));
    this.vaultLift = Math.max(0.42, lipY - py + 0.3);
    this.vaultT = 0;
    // he steps off with the fall already under him, not from a standing start
    this.velocity.y = 0;
    return true;
  }

  _tryVault() {
    const phys = this.phys;
    const fwd = this._v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const low = phys.raycast(
      this.position.x, this.position.y + 0.35, this.position.z,
      fwd.x, 0, fwd.z, 0.85, phys.MASK.WORLD
    );
    if (!low.hit) return;
    const high = phys.raycastAny(
      this.position.x, this.position.y + 1.25, this.position.z,
      fwd.x, 0, fwd.z, 1.1, phys.MASK.WORLD
    );
    if (high) return; // a wall, not a ledge
    // landing spot on the other side
    const lx = this.position.x + fwd.x * 1.5;
    const lz = this.position.z + fwd.z * 1.5;
    const y = this.ai.groundAt(lx, lz, this.position.y + 2.2);
    if (!Number.isFinite(y) || Math.abs(y - this.position.y) > 1.3) return;
    this.vaultCooldown = 2.5;
    this.animator.vault(0.8);
    this.vaultFrom = (this.vaultFrom ?? new THREE.Vector3()).copy(this.position);
    this.vaultTo = (this.vaultTo ?? new THREE.Vector3()).set(lx, y, lz);
    this.vaultLift = 0.42;
    this.vaultT = 0;
  }

  /* ================================================================== */
  /* shooting                                                           */
  /* ================================================================== */

  _shoot(dt) {
    // where the gun is pointing: lead toward the target with human error
    const t = this.hasTarget || this.lastKnownAge < 3 ? this.lastKnown : null;
    if (t) {
      // aim at the chest, not the feet
      this._v.set(t.x, t.y + 0.05, t.z);
      const dist = this.position.distanceTo(this._v);
      const wobbleT = this.ctx.time.elapsed * 1.7 + this.id;
      const wob = this.aimWobble + this.suppression * 0.05;
      this._v.x += Math.sin(wobbleT) * wob * dist * 0.12;
      this._v.y += Math.sin(wobbleT * 1.7 + 1.1) * wob * dist * 0.08;
      this._v.z += Math.cos(wobbleT * 0.8) * wob * dist * 0.12;
      this.aimTarget.lerp(this._v, Math.min(1, dt * this.trackRate));
    } else {
      const fwd = this._v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this._v2
        .copy(this.position)
        .addScaledVector(fwd, 12)
        .setY(this.position.y + this.eyeHeight - 0.1);
      this.aimTarget.lerp(this._v2, Math.min(1, dt * 3));
    }

    // Settling on the target. Only counts while it is actually visible — a bot
    // holding an angle at a doorway does not get to pre-aim you through it.
    if (this.targetVisible && this.hasTarget) {
      this.aimSettle = Math.min(1, this.aimSettle + dt / Math.max(0.1, this.settleTime));
    }

    // Freeze time: the round has not started, so nobody's weapon works —
    // including theirs. `match` flips this.
    if (this.ai.combatEnabled === false) this.wantFire = false;

    if (!this.wantFire || this.animator.reloading || this.animator.vaulting) return;
    if (this.ammo <= 0) {
      /**
       * THE MAGAZINE COMES OFF THE RESERVE. @see the constructor for the size
       * of it and for the measurement that chose it.
       *
       * A dry man does not play a reload animation he has nothing to feed. He
       * calls it on the net — "AMMO DRY" is a real radio call and it is also
       * the cue `match` reads to send him to a crate — and the call is rate
       * limited per speaker and per net like everything else, so a dry man
       * standing in a firefight does not repeat it every frame.
       */
      const take = Math.min(this.magSize, this.reserve);
      if (take <= 0) {
        this.dry = true;
        this.wantFire = false;
        this.ai.radio?.say(this, 'ammodry', 'ammodry', null, true);
        return;
      }
      this.animator.reload(this.variantName === 'irregular' ? 2.9 : 2.35);
      this.ai.emitReload(this);
      this.reserve -= take;
      this.ammo = take;
      // "RELOADING" is the oldest callout in the genre and it is information:
      // it is the beat in which a squadmate is meant to take over the angle.
      this.ai.radio?.say(this, 'reload', 'reloading', null, true);
      if (this.reserve <= this.magSize) {
        this.ai.radio?.say(this, 'ammolow', 'ammolow', null, false);
      }
      return;
    }
    if (this.burstLeft <= 0) {
      if (this.burstCooldown > 0) return;
      /**
       * THE BURST PATTERN IS TRIGGER DISCIPLINE, and it used to be skill alone.
       * Skill still shapes it — a poor shooter dumps a magazine and then has to
       * wait, which is the window the player uses — but WHETHER a man is a
       * sprayer is now a trait independent of whether he can shoot. A disciplined
       * marksman fires 2-4 and pauses; an undisciplined rusher fires up to 14 and
       * pauses for half as long. That asymmetry is deliberate: the volume of fire
       * on the map goes up, and it comes from the men least likely to hit with it.
       */
      const t = this.traits.trigger;
      const lo = 2 + Math.round((1 - t) * 3);
      this.burstLeft = this.rng.int(lo,
        lo + 2 + Math.round((1 - this.skill) * 5 + (1 - t) * 5));
      this.burstCooldown =
        (this.rng.range(0.3, 0.85) + (1 - this.skill) * this.rng.range(0.25, 0.95))
          * (0.55 + t * 0.8)
        + this.suppression * 0.5;
    }
    if (this.fireCooldown > 0) return;
    this.fireCooldown = 1 / this.fireRate;
    this.burstLeft--;
    this.ammo--;
    this._fireRound();
  }

  _fireRound() {
    const an = this.animator;
    const origin = an.muzzleWorld;
    const dir = this._muzzleDir.copy(an.muzzleDir);
    /**
     * Cone of fire. Three multipliers, all of which a player can feel:
     *   settle      up to 2.6x while the target is fresh, decaying over
     *               `settleTime` — the first burst out of a corner sprays
     *   bloom       sustained fire opens the group up, exactly as the player's
     *               own weapon does (see `spreadPerShot` in weapons/defs.js).
     *               A long burst from a low-skill bot is genuinely inaccurate
     *   suppression being shot at makes it worse, as before
     */
    const settle = 1 + (1 - this.aimSettle) * 1.6;
    const bloom = 1 + Math.min(6, this.magSize - this.ammo) * 0.055 * (1.4 - this.skill);
    /**
     * ADVANCING FIRE COSTS ACCURACY. A man who shoots while he walks (see
     * `shootMoving` in `_combat`) opens his cone by up to 1.5x, so the aggressive
     * archetypes put a great deal more lead in the air without becoming more
     * dangerous per round than a man who stopped and aimed.
     */
    const moving = 1 + Math.min(1, this.speed * 0.22) * 0.5;
    const spread = this.spread * settle * bloom * moving * (1 + this.suppression * 1.5);
    dir.x += this.rng.gauss() * spread;
    dir.y += this.rng.gauss() * spread * 0.8;
    dir.z += this.rng.gauss() * spread;
    dir.normalize();
    an.fire(1);
    this.ai.onAgentFire(this, origin, dir);
  }

  _throwGrenade(target) {
    this.grenadeCooldown = this.rng.range(16, 34);
    this.hasGrenade = false;
    const from = this._v.copy(this.animator.muzzleWorld);
    this.ai.throwGrenade(this, from, target);
  }

  /* ================================================================== */
  /* damage                                                             */
  /* ================================================================== */

  /**
   * Take a hit. NOTE: named `applyDamage`, not `damage` — the weapon's damage
   * value is a field on this object and a method of the same name would be
   * shadowed by it.
   * @param amount  post-falloff damage
   * @param part    'head' | 'torso' | 'arm' | 'leg'
   * @param point   world impact point
   * @param dir     incident direction (unit)
   * @param source  who fired it, for kill credit. May be undefined.
   */
  applyDamage(amount, part, point, dir, source) {
    if (!this.alive) return;
    if (source) this.lastAttacker = source;
    this.health -= amount;
    this.alertness = 1;
    this.suppression = Math.min(1.6, this.suppression + 0.35);
    // knowing where it came from
    if (dir) {
      this._v.copy(point).addScaledVector(dir, -14);
      if (this.lastKnownAge > 0.5) {
        this.lastKnown.copy(this._v);
        this.lastKnownAge = 0.4;
      }
    }
    if (this.state === STATE.IDLE || this.state === STATE.PATROL) this._setState(STATE.ALERT);

    if (this.health <= 0) {
      this.die(point, dir, amount, part === 'head');
      return;
    }
    // hit reaction by region, with the side the round came from
    const side = dir ? Math.sign(dir.x * Math.cos(this.yaw) - dir.z * Math.sin(this.yaw)) || 1 : 1;
    const region =
      part === 'head' ? 'head'
        : part === 'arm' ? (this._sideOf(point) < 0 ? 'armR' : 'armL')
          : part === 'leg' ? (this._sideOf(point) < 0 ? 'legR' : 'legL')
            : 'torso';
    this.animator.hit(region, side, Math.min(1.4, 0.5 + amount / 45));
    if (part === 'leg') this.speed *= 0.4;
  }

  /** Which side of the body a world point is on: <0 right, >0 left. */
  _sideOf(p) {
    const dx = p.x - this.position.x;
    const dz = p.z - this.position.z;
    return dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw);
  }

  die(point, dir, amount = 30, headshot = false) {
    if (!this.alive) return;
    this.alive = false;
    this.state = STATE.DEAD;
    this.working = null;
    this.objective = null;
    this.targetActor = null;
    this.armourWorth = 0;
    this.wantFire = false;
    this.animator.enabled = false;
    this.ai.cover?.release(this.id);
    if (this.controller) this.phys.removeCharacter(this.controller);
    this.controller = null;
    for (const c of this.colliders) this.phys?.removeCollider(c);
    this.colliders.length = 0;

    // Impulse is N·s, and the ragdoll turns it into a velocity change on the
    // particles it lands near: a 5.56 round carries ~4 N·s, so anything in the
    // hundreds launches the body across the street instead of dropping it.
    this.group.updateMatrixWorld(true);
    const impulse = this._v2
      .copy(dir ?? this._v.set(0, 0, 1))
      .normalize()
      .multiplyScalar(Math.min(5.5, 1.5 + amount * 0.02));
    const hitPoint = point ?? this._v.copy(this.position).setY(this.position.y + 1.2);

    // Own the hand-off: build the capsule spec from the *live* animated pose,
    // hand it to the solver and let it drive the skeleton from here. Setting
    // __ragdoll stops physics creating a second one off our death event.
    const rd = this._makeRagdoll(impulse, hitPoint);
    if (rd) {
      this.__ragdoll = rd;
      this.ragdoll = rd;
    }
    this.ctx.events.emit('actor:death', {
      actor: this,
      point: hitPoint,
      impulse,
      headshot,
      /** Kill credit. `ui` and `match` both read this; null means the world. */
      by: this.lastAttacker ?? null,
    });
    this.deadTime = 0;
  }

  /**
   * Hand the live pose to the ragdoll solver. `physics` derives the capsule
   * chain from the skeleton itself, so the doll starts exactly in the pose the
   * animator left — the death has no pop. `radiusRatio` fattens the capsules
   * (its default is thin enough that a settled body reads as a pancake).
   */
  _makeRagdoll(impulse, point) {
    const phys = this.phys;
    if (!phys) return null;
    // Fat capsules that start half-buried in the floor tunnel straight through
    // it: the contact normal flips once a bone's axis is on the far side. Lift
    // the pose clear of the ground for the one frame it takes to build the doll,
    // then put the group back — the body drops the 15 cm invisibly.
    const lift = 0.15 * this.scale;
    this.group.position.y += lift;
    this.group.updateMatrixWorld(true);
    const rd = phys.createRagdollFromSkeleton(this.mesh, {
      actor: this,
      mass: this.mass,
      radiusRatio: 0.42,
      cone: 74,
      twist: 38,
      iterations: 8,
      velocity: { x: this.velocity.x * 0.6, y: 0, z: this.velocity.z * 0.6 },
    });
    this.group.position.y -= lift;
    this.group.updateMatrixWorld(true);
    if (!rd) return null;
    if (impulse && point) {
      // wide radius: a tight one dumps all of it into whichever light bone is
      // nearest and whips the limb across the street
      rd.applyImpulse(point.x, point.y, point.z, impulse.x, impulse.y, impulse.z, 0.85);
    }
    if (this.ai.debugLog) {
      console.info(
        `[ai] ragdoll ${rd.boneCount} bones / ${rd.particleCount} particles, ` +
          `mask=${rd.mask} tris=${rd.world?.triCount}`
      );
    }
    return rd;
  }

  /* ================================================================== */
  /* drive the visual                                                   */
  /* ================================================================== */

  _drive(dt) {
    // root motion for a vault
    if (this.vaultT !== undefined && this.animator.vaulting && this.vaultFrom) {
      this.vaultT += dt / 0.8;
      const t = Math.min(1, this.vaultT);
      this.position.lerpVectors(this.vaultFrom, this.vaultTo, t);
      // the hump has to clear whatever he put his hand on. @see `_stepOff`.
      this.position.y += Math.sin(t * Math.PI) * (this.vaultLift ?? 0.42);
      if (t >= 1) this.vaultLift = 0.42;
      this.controller?.teleport(this.position.x, this.position.y, this.position.z);
    }

    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;
    this.group.updateMatrixWorld(true);

    const moving = this.speed > 0.25;
    let clip;
    if (this.crouch) clip = moving ? 'crouchWalk' : 'crouchIdle';
    else if (this.speed > 2.6) clip = 'run';
    else if (moving) clip = 'walk';
    else clip = this.health < 35 ? 'hurtIdle' : 'idle';
    this.clip = clip;

    const an = this.animator;
    an.setState({
      clip,
      speed: this.speed,
      crouch: this.crouch,
      aimTarget: this.aimTarget,
      lookTarget: this.hasTarget || this.lastKnownAge < 4 ? this.lastKnown : this.aimTarget,
      aimWeight: this.aimWeight,
      suppress: Math.min(1, this.suppression * 0.8),
    });

    // ANIMATION RATE LOD. The pose write, the three IK chains and the two foot
    // ground rays are the whole per-actor cost, and for an actor that cannot
    // reach a pixel this frame (see AiSystem._updateRelevance) they buy nothing.
    // Evaluate a third as often and hand the solver the accumulated dt, so the
    // stride phase, the recoil envelope and the reload timeline stay on the same
    // clock — nothing skates or slides when the actor becomes visible again, and
    // the frame it does become visible is always a full evaluation because
    // lodIrrelevant is false by then.
    this._animAccum += dt;
    if (this.lodIrrelevant) {
      if (this._animSkip > 0) {
        this._animSkip--;
        return;
      }
      this._animSkip = 2; // one evaluation in three while nothing can see it
    } else {
      this._animSkip = 0;
    }
    an.update(this._animAccum, this.ctx.time.elapsed);
    this._animAccum = 0;
  }

  /** Push the hit capsules onto the animated skeleton. */
  syncHitboxes() {
    if (!this.alive) return;
    const an = this.animator;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      const { a, b } = c.userData;
      an.bonePos(a, this._boneA);
      an.bonePos(b, this._boneB);
      c.setSegment(
        this._boneA.x, this._boneA.y, this._boneA.z,
        this._boneB.x, this._boneB.y, this._boneB.z
      );
    }
  }

  dispose() {
    if (this.controller) this.phys?.removeCharacter(this.controller);
    for (const c of this.colliders) this.phys?.removeCollider(c);
    this.colliders.length = 0;
    if (this.ragdoll) this.phys?.removeRagdoll(this.ragdoll);
    this.group.parent?.remove(this.group);
  }
}
