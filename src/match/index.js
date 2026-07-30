/**
 * MATCH — the Sudden Attack demolition ruleset.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SUBSYSTEM IS
 * ────────────────────────────────────────────────────────────────────────────
 * Everything in `src/render`, `src/materials`, `src/sky`, `src/world`,
 * `src/physics`, `src/fx` and `src/audio` is the engine this repo shipped with
 * and is untouched. What changed is the GAME: instead of a garrison to shoot
 * your way through, this is 7 v 7, one life a round, a two minute clock and a
 * C4 charge — 폭파미션, the mode Sudden Attack is actually played in.
 *
 *   src/match/rules.js    every duration, count and radius
 *   src/match/sites.js    bomb sites and both spawns, in the level's own space
 *   src/match/bomb.js     the charge: carry / drop / plant / defuse / detonate
 *   src/match/spectate.js the camera you get when you die, because you stay dead
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ROUND STATE MACHINE
 * ────────────────────────────────────────────────────────────────────────────
 *   warmup -> freeze -> live -> over -> (freeze | matchover)
 *
 *   freeze  weapons locked, movement free, loadout changeable
 *   live    the round. The clock only matters until the C4 is armed; after
 *           that the fuse is the only clock, which is the rule that makes a
 *           4 v 1 losable.
 *   over    scoreboard dwell, bodies left where they fell
 *
 * ────────────────────────────────────────────────────────────────────────────
 * RESPAWNS
 * ────────────────────────────────────────────────────────────────────────────
 * Death inside a round costs `RULES.respawnDelay` seconds, not the round. The
 * queue is one entry per dead ROSTER RECORD, so a bot and the human come back
 * on identical rules and the scoreboard row survives the death — a respawned
 * bot is a NEW `Agent` (the old one is a ragdoll and cannot be un-died), so the
 * record's `actor` is re-pointed and everything that looks a man up by his
 * record keeps working.
 *
 * Respawns CLOSE when the charge is armed or the clock drops under
 * `RULES.respawnCutoff`, which is what keeps the win condition intact: only
 * once the queue can no longer refill can a side be eliminated, so the last
 * stretch of every round is the one-life mode this is a version of.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLIC API — `const m = ctx.get('match')`
 * ────────────────────────────────────────────────────────────────────────────
 *   m.phase / m.round / m.score      -> [red, blue]
 *   m.attackers / m.defenders        -> TEAM ids for the current round
 *   m.playerRole                     -> 'attack' | 'defend'
 *   m.bomb                           -> the Bomb
 *   m.sites                          -> [{ id, name, position, radius }]
 *   m.roster                         -> [{ name, team, kills, deaths, alive }]
 *   m.getHudState()                  -> the snapshot `ui` draws the round HUD from
 *
 * EVENTS EMITTED (added to the table in ARCHITECTURE.md)
 *   match:round    { round, phase, attackers, score }
 *   match:bomb     { state, site, fuse, carrier }
 *   match:result   { winner, reason, score, matchOver }
 */

import * as THREE from 'three';
import { RULES, TEAM, TEAM_NAME, TEAM_COLOR, ROLE, attackingTeam, roleOf, BOT_NAMES, TEAM_VARIANTS } from './rules.js';
import { resolveLayout } from './sites.js';
import { Bomb, BOMB } from './bomb.js';
import { Spectator } from './spectate.js';
import { SiteMarks } from './sitemark.js';
import { Airstrike } from './airstrike.js';
import { Bomber } from './bomber.js';
import { Strafe } from './strafe.js';
import { AmmoDrops } from './ammo.js';

const PHASE = { WARMUP: 'warmup', FREEZE: 'freeze', LIVE: 'live', OVER: 'over', MATCH_OVER: 'matchover' };

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

    /* ---- layout ------------------------------------------------------- */
    const layout = resolveLayout(this.world, this.ai);
    this.sites = layout.sites;
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
    this.roundClock = RULES.roundTime;
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

    /* ---- bomb + spectator --------------------------------------------- */
    this.bomb = new Bomb(ctx);
    // Paint the sites on the ground from the RESOLVED positions, so the paint is
    // always where the plant trigger is even when `resolveLayout` has had to
    // move a site off sealed geometry. See src/match/sitemark.js.
    this.marks = new SiteMarks(ctx, this.sites);
    /**
     * Ammunition on the bodies. The round's budget is still what you walk out
     * of spawn with (`weapons.resetAmmo`), but a five minute round with
     * respawns is long enough to spend it, and every man who goes down leaves
     * his pouches. See src/match/ammo.js for why it is walk-over rather than a
     * key, and why a pouch can never take you above your starting reserve.
     */
    this.ammoDrops = new AmmoDrops(ctx);
    const patcher = ctx.peek('render')?.patcher;
    if (patcher) {
      for (const m of this.bomb.materials) patcher.patch(m);
      for (const m of this.ammoDrops.materials) patcher.patch(m);
      patcher.patch(this.marks.paint);
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
    for (const site of this.sites) {
      for (const kind of ['attack', 'defend']) {
        for (const sp of this.spawns[kind]) navRoutes.push([sp.position, site.position]);
      }
      for (const sp of this.spawns.defend) navRoutes.push([sp.position, site.hold]);
    }
    this.airstrike = new Airstrike(ctx, { rng: this.rng.fork(), routes: navRoutes }).build();
    if (patcher) for (const site of this.airstrike.sites) for (const m of site.materials) patcher.patch(m);
    this.bomber = new Bomber(ctx, { rng: this.rng.fork() }).build();
    this.strafe = new Strafe(ctx, { rng: this.rng.fork() }).build();
    this.air = [this.airstrike, this.bomber, this.strafe];
    // Each stands down while EITHER of the other two has something in the air.
    this.airstrike.coBusy = [this.bomber, this.strafe];
    this.bomber.coBusy = [this.airstrike, this.strafe];
    this.strafe.coBusy = [this.airstrike, this.bomber];
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
    }

    /* ---- scratch ------------------------------------------------------- */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._bombPos = new THREE.Vector3();
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
    };
    this._hud.respawnIn = 0;
    this._interact = { held: 0, kind: null };
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
    /** Where each side comes from, so a held position is actually watched. */
    this._approach = [new THREE.Vector3(), new THREE.Vector3()];
    /** The centre of the fight, handed to the three air systems. @see `_updateAirFocus` */
    this._airFocus = new THREE.Vector3();
    this._airFocusTimer = 0;
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

    console.info(
      `[match] SUDDEN CLAUDE — demolition ${RULES.teamSize}v${RULES.teamSize}, ` +
        `${RULES.roundTime | 0}s rounds, first to ${RULES.roundsToWin}, ` +
        `sides swap after round ${RULES.swapAfterRound}` +
        (RULES.respawns
          ? ` · respawn ${RULES.respawnDelay}s, closes at ${RULES.respawnCutoff}s or on the plant`
          : ' · one life')
    );
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
    this.roundClock = RULES.roundTime;
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
    this.targetSite = this.sites[this.rng.int(0, this.sites.length - 1)];
    for (const s of this.sites) s.defenders.length = 0;
    this._flankLeg.clear();

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

    // ---- the charge ---------------------------------------------------
    // Last round's pouches go with last round's bodies: `_resetPlayer` has
    // already refilled the reserve, so leaving them would be free ammunition
    // for a budget that is already full.
    this.ammoDrops.clear();
    this.bomb.reset();
    if (this.playerTeam === atk) {
      // The human gets the C4 when their side attacks: the mode is only
      // interesting if the objective is yours to carry.
      this.bomb.giveTo(this.player);
    } else {
      const carriers = this._botsByTeam[atk];
      this.bomb.giveTo(carriers[this.rng.int(0, Math.max(0, carriers.length - 1))] ?? null);
    }
    this._assignObjectives();

    this._setPhase(PHASE.FREEZE, RULES.freeze);
    const mine = this.playerRole === ROLE.ATTACK;
    this.ui.banner.show(
      `ROUND ${this.round}`,
      mine ? 'PLANT THE C4' : 'DEFEND BOTH SITES',
      2.4
    );
    this.ctx.events.emit('match:round', {
      round: this.round,
      phase: this.phase,
      attackers: atk,
      score: this.score,
    });
    console.info(
      `[match] round ${this.round}: ${TEAM_NAME[atk]} attack, ${TEAM_NAME[def]} defend · ` +
        `score ${this.score[0]}-${this.score[1]}`
    );
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
        role,
      });
      squad.add(agent);
      this._botsByTeam[team].push(agent);
      this.roster.push({
        name: agent.name, team, kills: 0, deaths: 0, alive: true, isPlayer: false, actor: agent,
        role, variant, slot,
      });
    }
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
    return (
      RULES.respawns &&
      this.phase === PHASE.LIVE &&
      !this.bomb.armed &&
      this.roundClock > RULES.respawnCutoff
    );
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
   * The emptiest spawn point of a side's cluster, as a world position.
   *
   * "A respawn that puts you in front of an enemy" is the single thing that
   * makes respawning feel unfair, so this scores every point of the cluster by
   * the distance to the NEAREST live enemy and takes the largest. With fifteen
   * points spread over a 13 x 10 m pocket that is a real choice rather than a
   * formality. `RULES.respawnSafeRadius` is only a report threshold: if every
   * point is worse than that the best of a bad set is still used, because a
   * delayed respawn is worse than a contested one.
   */
  _safeSpawn(team, role, outYaw) {
    const spawns = role === ROLE.ATTACK ? this.spawns.attack : this.spawns.defend;
    const foes = this._botsByTeam[1 - team];
    const playerIsFoe = this.playerTeam !== team && !this.player.dead;
    let best = spawns[0];
    let bestD = -Infinity;
    for (const sp of spawns) {
      let nearest = Infinity;
      for (const f of foes) {
        if (!f.alive) continue;
        const d = f.position.distanceToSquared(sp.position);
        if (d < nearest) nearest = d;
      }
      if (playerIsFoe) {
        const d = this.player.position.distanceToSquared(sp.position);
        if (d < nearest) nearest = d;
      }
      // Break ties randomly so fifteen men do not queue on the same square.
      const score = nearest + this.rng.range(0, 36);
      if (score > bestD) {
        bestD = score;
        best = sp;
      }
    }
    outYaw.yaw = best.yaw;
    return this._jitterOnto(best, this._spawnPick);
  }

  _respawnBot(rec) {
    const team = rec.team;
    const role = roleOf(team, this.round);
    const yawOut = this._yawOut ?? (this._yawOut = { yaw: 0 });
    const pos = this._safeSpawn(team, role, yawOut);
    const agent = this.ai.spawn(rec.variant ?? TEAM_VARIANTS[team][0], pos, yawOut.yaw, {
      team,
      name: rec.name,
      role,
    });
    this._squads[team]?.add(agent);
    this._botsByTeam[team].push(agent);
    rec.actor = agent;
    rec.alive = true;
    this.ai.protect(agent, RULES.spawnProtect);
    this.ctx.events.emit('match:respawn', { name: rec.name, team, isPlayer: false });
  }

  _respawnPlayer(rec) {
    const role = this.playerRole;
    const yawOut = this._yawOut ?? (this._yawOut = { yaw: 0 });
    const pos = this._safeSpawn(this.playerTeam, role, yawOut);
    this.spectator.stop();
    this.player.respawnAt(pos, yawOut.yaw);
    this.player.setControlEnabled(true);
    this.weapons.resetAmmo();
    rec.alive = true;
    this._playerWasDead = false;
    this.ai.protect(this.player, RULES.spawnProtect);
    this.ui.banner.show('RESPAWN', `${RULES.spawnProtect | 0}S PROTECTED`, 1.6);
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
   * and again whenever the objective moves (plant, drop, pickup).
   */
  _assignObjectives() {
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
    const kr = killer ? this._record(killer) : null;
    if (kr && kr !== vr) kr.kills++;
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
      const killer = this._record(this._playerLastAttacker);
      if (killer && killer !== pr) killer.kills++;
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
        if (!this.bomb.armed) this.roundClock -= dt;
        if (this.bomb.update(dt, audio) === 'detonate') {
          this._endRound(this.attackers, 'C4 DETONATED');
          break;
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
        this._updateBotObjectiveWork(dt);
        this._updatePlayerInteraction(dt);
        this._updateAmmoDrops(dt, audio);
        this._checkWinConditions();
        break;

      case PHASE.OVER:
        this.timer -= dt;
        this.bomb.update(dt, null);
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
      default:
        h.title = 'AIRSTRIKE INBOUND';
        h.impactTitle = 'IMPACT';
        label = 'AIRSTRIKE';
        break;
    }
    this.ui.airAlert(h);
    for (let i = 0; i < info.count; i++) this.ui.airDanger(info.points[i], h.lead, label);
    this.ui.banner.show(
      h.title,
      info.kind === 'SALVO' ? `${h.name} · CLEAR THE AREA` : `${h.name} · GET CLEAR`,
      info.kind === 'STRAFE' ? 1.3 : 1.9
    );
  }

  /** It went off. The strip switches to its impact read; the banner confirms. */
  _airLanded(info) {
    if (!info) return;
    const title =
      info.kind === 'SALVO'
        ? 'BLOCK LEVELLED'
        : info.kind === 'BOMBER'
          ? 'BOMBS DOWN'
          : info.kind === 'STRAFE'
            ? 'CANNON FIRE'
            : 'AIRSTRIKE';
    this.ui.airImpact(title);
    // A salvo is the round's event and gets the full banner; the rest have
    // already had theirs on the way in and would only be shouting twice.
    if (info.kind === 'SALVO') this.ui.banner.show(title, `${info.name} · DOWN`, 2.4);
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
    h.alert =
      this.phase === PHASE.FREEZE
        ? 'PREPARE'
        : this.phase === PHASE.OVER || this.phase === PHASE.MATCH_OVER
          ? this.result
            ? `${TEAM_NAME[this.result.winner]} WIN`
            : ''
          : b.armed
            ? `C4 ARMED — SITE ${b.site?.id ?? '?'}`
            : '';

    this.ui.setMatch({
      scoreUs: this.score[this.playerTeam],
      scoreThem: this.score[1 - this.playerTeam],
      timeLeft: h.clock,
      mode: 'DEMOLITION',
    });
    this.ui.setRound?.(h);
    this._publishObjectives();
  }

  /** Site markers on the compass and the minimap, and the C4 once it is down. */
  _publishObjectives() {
    const out = this._objectives;
    out.length = 0;
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
    this.bomb?.dispose();
    this.ammoDrops?.dispose();
    this.marks?.dispose();
    this.airstrike?.dispose();
    this.bomber?.dispose();
    this.strafe?.dispose();
    if (typeof window !== 'undefined') {
      if (window.__STRIKE__ === this.airstrike) delete window.__STRIKE__;
      if (window.__BOMBER__ === this.bomber) delete window.__BOMBER__;
      if (window.__STRAFE__ === this.strafe) delete window.__STRAFE__;
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
