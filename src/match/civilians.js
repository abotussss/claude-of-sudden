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
 * A third side of FIFTEEN, all of them hostile to the player, that lives in the
 * buildings rather than on the streets: TEN with an AK and a bandolier who
 * ambush whoever walks into their room, and FIVE with nothing who run when they
 * are seen. Killing one of the ten is free. Killing one of the five TAKES
 * CAPTURE SCORE OFF YOUR SIDE.
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
 * ── 4. AMBUSH IS AN ABSENCE OF ORDERS ──
 *
 * `Agent._think`'s IDLE branch is: speed zero; if I have a target, fight; else
 * if I have an objective, advance; else if I have a patrol route, patrol. A
 * civilian is given no objective and no patrol route, so he stands in the room
 * this file chose — not where a bot patrol expects, not moving, not making
 * noise — until somebody walks into his line, and then he opens fire at the
 * 9 m his traits want. That is 「基本的に隠れること、不意打ちをしてきます」 and it
 * is written already; the only thing this file adds is a LEASH, because a fight
 * he loses can walk him out of the door and 「逃走以外で屋外に逃げることはない」.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ALLOCATION
 * ════════════════════════════════════════════════════════════════════════════
 * `update()` runs every frame. The per-frame work is a slice of the roster, not
 * the whole of it, and every vector it touches is preallocated here. The one
 * expensive thing — the A* proof — happens at most `SPAWN_TRIES` times per man
 * per match, i.e. fifteen times.
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

/** 「全部で１５人のみ出現させて そのうち民間人は５人」 */
const TOTAL = 15;
const UNARMED = 5;

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
const FIRST_WAVE = 28;
const WAVE_GAP = [42, 78];
const WAVE_SIZE = [2, 4];

/** Tries at finding a room for one man before he waits for the next wave. */
const SPAWN_TRIES = 14;
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
const LEASH_HOME = 3.5;

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
    for (let b = 0; b < vols.length; b++) this.rooms.push([]);
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
    this._enabled = n > 0;
    console.info(
      `[civil] ${n} ground-floor room cells in ${used}/${vols.length} buildings; ` +
        `${TOTAL} to place (${UNARMED} unarmed)`
    );
    return n;
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
   * left rather than fixed per wave, so the five unarmed ones are spread over
   * the whole match instead of arriving together — a wave that is all civilians
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
      const i = cells[this.rng.int(0, cells.length - 1)];
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
       */
      const v = this.ctx.peek('world')?.interiorVolumes?.[b];
      const yaw = v ? Math.atan2(v.cx - x, v.cz - z) : this.rng.range(0, Math.PI * 2);
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
      });
      this.stats.spawned[unarmed ? 1 : 0]++;
      return true;
    }
    return false;
  }

  /** Shuffled deck of buildings, reshuffled when it runs out. @see `_nextSlot`. */
  _nextBuilding() {
    if (this._bagAt >= this._bag.length) {
      this._bag.length = 0;
      for (let b = 0; b < this.rooms.length; b++) if (this.rooms[b].length >= 4) this._bag.push(b);
      for (let i = this._bag.length - 1; i > 0; i--) {
        const j = this.rng.int(0, i);
        const t = this._bag[i]; this._bag[i] = this._bag[j]; this._bag[j] = t;
      }
      this._bagAt = 0;
      if (!this._bag.length) return 0;
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
   * The leash and the flight, in one pass over fifteen men at 4 Hz.
   *
   * ORDER MATTERS: a fleeing man is not leashed. Running outdoors is the ONE
   * thing 「逃走以外で屋外に逃げることはない」 permits, and a leash that fired
   * during a flight would walk a terrified civilian back into the room he is
   * running away from.
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
       * cover mid-firefight is the one thing that would make him look scripted.
       */
      if (a.hasTarget) continue;
      const far = a.position.distanceTo(c.anchor);
      if (!c.leashed && far > LEASH_R) {
        c.leashed = true;
        this.stats.leashed++;
        a.setObjective('pickup', c.anchor);
      } else if (c.leashed && far < LEASH_HOME) {
        c.leashed = false;
        // Back to no orders at all, which is back to being an ambush.
        a.setObjective('hold', null);
      }
    }
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
      `leashed ${s.leashed} · fled ${s.fled} · ` +
      `unreachable rooms ${s.unreachable} · deferred ${s.deferred}`
    );
  }
}
