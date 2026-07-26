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
import { RULES, TEAM, TEAM_NAME, TEAM_COLOR, ROLE, attackingTeam, BOT_NAMES, TEAM_VARIANTS } from './rules.js';
import { resolveLayout } from './sites.js';
import { Bomb, BOMB } from './bomb.js';
import { Spectator } from './spectate.js';

const PHASE = { WARMUP: 'warmup', FREEZE: 'freeze', LIVE: 'live', OVER: 'over', MATCH_OVER: 'matchover' };

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
    const patcher = ctx.peek('render')?.patcher;
    if (patcher) for (const m of this.bomb.materials) patcher.patch(m);
    this.spectator = new Spectator(ctx);

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
    this._interact = { held: 0, kind: null };
    this._playerWasDead = false;
    this._playerLastAttacker = null;
    this._objectiveTimer = 0;
    /** The attacker tasked with fetching a dropped charge. */
    this._fetcher = null;
    /** Where each side comes from, so a held position is actually watched. */
    this._approach = [new THREE.Vector3(), new THREE.Vector3()];

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
        `first to ${RULES.roundsToWin}, sides swap after round ${RULES.swapAfterRound}`
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

    // Attackers commit to one site; defenders split, weighted to the site the
    // attackers did NOT pick only by chance, because they do not know either.
    this.targetSite = this.sites[this.rng.int(0, this.sites.length - 1)];
    for (const s of this.sites) s.defenders.length = 0;

    this._spawnTeam(atk, ROLE.ATTACK);
    this._spawnTeam(def, ROLE.DEFEND);
    this._resetPlayer();

    // ---- the charge ---------------------------------------------------
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

    // Slot 0 of the human's own team is the human. Bots fill the rest.
    const human = team === this.playerTeam;
    if (human) {
      this.roster.push({
        name: 'YOU', team, kills: 0, deaths: 0, alive: true, isPlayer: true, actor: this.player,
      });
    }
    const bots = RULES.teamSize - (human ? 1 : 0);
    for (let i = 0; i < bots; i++) {
      const sp = spawns[(i + (human ? 1 : 0)) % spawns.length];
      const jitterA = this.rng.range(0, Math.PI * 2);
      const jitterR = this.rng.range(0, 1.1);
      this._v
        .copy(sp.position)
        .add(this._v2.set(Math.cos(jitterA) * jitterR, 0, Math.sin(jitterA) * jitterR));
      this._v.y = this.ai.groundAt(this._v.x, this._v.z, sp.position.y + 3);
      const agent = this.ai.spawn(variants[i % variants.length], this._v, sp.yaw, {
        team,
        name: names[i % names.length],
        role,
      });
      squad.add(agent);
      this._botsByTeam[team].push(agent);
      this.roster.push({
        name: agent.name, team, kills: 0, deaths: 0, alive: true, isPlayer: false, actor: agent,
      });
    }
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
        a.setObjective('push', this.targetSite.position, this.targetSite);
      }
    }

    // ---- defenders ----------------------------------------------------
    if (armed) {
      // One man works the charge; the rest clear and cover the other entries.
      const defuser = this._nearestTo(this._botsByTeam[def], this.bomb.position);
      for (const a of this._botsByTeam[def]) {
        if (!a.alive) continue;
        if (a === defuser) a.setObjective('defuse', this.bomb.position, this.bomb.site);
        else a.setObjective('retake', this.bomb.position, this.bomb.site, defFace);
      }
    } else {
      // Split across both sites — 4 on one, 3 on the other, so neither is naked.
      const live = this._botsByTeam[def].filter((a) => a.alive);
      for (let i = 0; i < live.length; i++) {
        const site = this.sites[i % this.sites.length];
        site.defenders.push(live[i]);
        live[i].setObjective('hold', site.hold, site, defFace);
      }
    }
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
  }

  _endRound(winner, reason) {
    if (this.phase !== PHASE.LIVE) return;
    // Whatever decided it, the fuse stops here.
    this.bomb.frozen = true;
    this.bomb.worker = null;
    this.bomb.workKind = null;
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
    this.ui.banner.show('ELIMINATED', 'NO RESPAWN THIS ROUND', 2.6);
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
        this._objectiveTimer -= dt;
        if (this._objectiveTimer <= 0) {
          this._objectiveTimer = 2;
          this._assignObjectives();
        }
        this._updateBotObjectiveWork(dt);
        this._updatePlayerInteraction(dt);
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

    // Dead players watch. Written here, in update(), so it lands before `ui`
    // and `render` read the camera this frame.
    if (this.spectator.active) {
      this._collectSquad();
      this.spectator.update(dt, this._squad);
    }

    this._publishHud();
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

    if (dAlive === 0) {
      this._endRound(atk, 'DEFENDERS ELIMINATED');
      return;
    }
    // Attackers wiped only loses the round if the charge is not already down —
    // this is the rule that makes a planted C4 worth trading lives for.
    if (aAlive === 0 && !this.bomb.armed) {
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
    this.ui.setObjectives(out);
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
