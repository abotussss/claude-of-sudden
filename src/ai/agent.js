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
};

/**
 * Who each side is made of. Ten slots, drawn from with replacement, so a
 * fifteen-man team is a plausible mix rather than a guaranteed one.
 */
const ARCHETYPE_MIX = {
  attack: ['rusher', 'rusher', 'rusher', 'flanker', 'flanker', 'hunter', 'hunter', 'support', 'anchor', 'marksman'],
  defend: ['rusher', 'rusher', 'flanker', 'hunter', 'hunter', 'support', 'support', 'anchor', 'anchor', 'marksman'],
  any: ['rusher', 'flanker', 'hunter', 'hunter', 'support', 'support', 'anchor', 'anchor', 'marksman', 'marksman'],
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

    /* ---------------- objective (owned by `match`) ---------------- */
    /** { mode, position: Vector3, site, facing: Vector3|null } or null. */
    this.objective = null;
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
    /** The actual hostile being engaged: another Agent, or the player system. */
    this.targetActor = null;
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
    /** a path request the frame budget pushed to the next frame */
    this.pathPending = false;
    this._pendingDest = new THREE.Vector3();

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
    this.coverDwell -= dt;
    this.holdTimer -= dt;
    this._scanTimer -= dt;
    this.vaultCooldown -= dt;
    if (this.lastKnownAge < 1e6) this.lastKnownAge += dt;

    // a path the frame budget deferred: ask again before anything else does
    if (this.pathPending) this._goTo(this._pendingDest);

    this._sense(dt);
    this._think(dt);
    this._move(dt);
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
        // A bold man is back up almost at once; a careful one stays down until
        // the rounds have genuinely stopped coming.
        if (this.suppression < 0.25 + (1 - this.traits.exposure) * 0.45) {
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
      && this.suppression > 1.55 - this.traits.exposure * 0.8) {
      this._setState(STATE.SUPPRESSED);
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
      const haste = 0.82 + this.traits.aggression * 0.36;
      this.desiredSpeed = inSector ? 2.0 + this.traits.aggression * 1.4
        : (obj.mode === 'hold' ? 3.4 : 4.3) * haste;
      if (this.repathTimer <= 0 && !this.pathPending && (!this.hasMoveTarget || this.stuckTimer > 0.6)) {
        this.repathTimer = this.rng.range(1.1, 2.2);
        if (!this._goTo(dest) && !this.pathPending) {
          if (holdish && this._hasHoldSpot) this._hasHoldSpot = false; // try another spot
          else this._advanceFallback(obj);
        }
      }
      return;
    }

    // ---- in position ---------------------------------------------------
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
    this.holdTimer = this.rng.range(2.4, 4.5) + tr.patience * this.rng.range(2.5, 9);
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
      const pick = this.ai.cover?.pick(this.position, target, {
        id: this.id,
        squad: sq?.members,
        minRange: Math.max(3, want * 0.45),
        maxRange: want * 1.7,
        // An eager man is willing to cross more ground to get where he wants to
        // be; a careful one shuffles between two adjacent walls.
        maxTravel: this.cover ? 7 + tr.aggression * 11 : 26,
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
        this.coverDwell = this.rng.range(1.5, 3.2) + tr.patience * this.rng.range(3, 9);
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
        && dist < this.weaponRange;
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
        if (this.peeking && this.cover) {
          this.peekSide = this.ai.cover.peekOffset(this.cover, target, this.eyeHeight, this._v2);
          this.coverPos.copy(this._v2);
        }
      }
      this.crouch = this.cover ? !this.cover.high || !this.peeking : false;
      this.aimWeight = this.peeking ? 1 : 0.55;
      this.wantFire = this.peeking && this.targetVisible && this.hasTarget && dist < this.weaponRange;
      /**
       * SUPPRESSING FIRE at the last known spot without a clean shot: a flat 35 %
       * coin flip for everybody became trigger discipline. A sprayer hoses the
       * window at 70 %, a marksman holds his round at 15 %, and the difference
       * between the two is audible from across the map — which is most of what
       * "もっと戦争らしく撃ち合いまくって" asks for and it costs the player nothing,
       * because rounds into a wall are rounds not into him.
       */
      if (!this.wantFire && this.hasTarget && this.lastKnownAge < 2.6 && this.peeking) {
        this.wantFire = this.rng.float() < 0.12 + (1 - tr.trigger) * 0.62;
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
        return;
      }
    }

    // grenade when the player is pinned and we have line of fire
    if (
      this.hasGrenade &&
      this.grenadeCooldown <= 0 &&
      // A man who fights at 10 m will throw at 7; one who fights at 35 will not
      // throw at all until you are inside his window.
      dist > 6 + (1 - tr.aggression) * 5 &&
      dist < 20 + tr.range * 0.4 &&
      this.lastKnownAge < 1.5 &&
      (!sq || sq.requestGrenade(this))
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
    this.pathLen = n;
    this.pathIndex = 0;
    this.moveTarget.copy(this.path[n - 1]);
    this.hasMoveTarget = true;
    return true;
  }

  _move(dt) {
    const wp = this.hasMoveTarget && this.pathIndex < this.pathLen ? this.path[this.pathIndex] : null;
    this._steer.set(0, 0, 0);
    let want = 0;

    if (wp) {
      const to = this._v.copy(wp).sub(this.position);
      to.y = 0;
      const d = to.length();
      if (d < (this.pathIndex === this.pathLen - 1 ? 0.45 : 0.75)) {
        this.pathIndex++;
        if (this.pathIndex >= this.pathLen) this.hasMoveTarget = false;
      } else {
        to.multiplyScalar(1 / d);
        this._steer.copy(to);
        want = this.desiredSpeed;
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
      c.move(vx * dt, this.velocity.y * dt, vz * dt);
      this.position.copy(c.position);
      this.grounded = c.grounded;
      if (c.grounded && this.velocity.y < 0) this.velocity.y = 0;

      // blocked by something low: vault it
      if (c.lastMoveBlocked && this.speed > 1.5 && this.vaultCooldown <= 0 && this.grounded) {
        this._tryVault();
      }
      if (c.lastMoveBlocked && this.speed > 0.5) {
        this.stuckTimer += dt;
        if (this.stuckTimer > 1.1) {
          this.stuckTimer = 0;
          this.repathTimer = 0;
          if (this.hasMoveTarget) this._goTo(this.moveTarget);
        }
      } else this.stuckTimer = 0;
    } else {
      this.position.x += this._steer.x * this.speed * dt;
      this.position.z += this._steer.z * this.speed * dt;
    }
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
      this.animator.reload(this.variantName === 'irregular' ? 2.9 : 2.35);
      this.ai.emitReload(this);
      this.ammo = this.magSize;
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
      this.position.y += Math.sin(t * Math.PI) * 0.42;
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
