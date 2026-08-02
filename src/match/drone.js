import * as THREE from 'three';
import { RULES, TEAM_COLOR } from './rules.js';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE SUICIDE DRONES — 「ドローンは自爆系のドローンで…１試合に敵味方合わせて３０機」
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A loitering munition. It launches from a side's own base, climbs above the
 * roofline, flies to where the fighting is, picks the nearest enemy it can
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
 * 2. SHOOTING IT DOWN. Yes, and it is the other half of the answer above. One
 *    0.62 m box on `LAYER.SHOOT_ONLY` — the layer that is in `MASK.BULLET` and
 *    in neither `MASK.CHARACTER` nor `MASK.SIGHT`, so a moving object in the
 *    air can never cost anybody a route — with `owner: drone`, so a round that
 *    lands on it arrives as the canonical `damage:dealt` with the shooter
 *    attached and the player gets his hitmarker. 60 HP is three rounds of a
 *    21-damage rifle or one of the bolt gun, against a target the size of a
 *    dinner plate crossing at 10 m/s.
 *
 * 3. THE PACING. Thirty is the player's own figure and it is thirty PER MATCH,
 *    both sides, which at `droneLife` 45 s is 2.25 in the air at any moment and
 *    a hard ceiling of `droneMaxAloft` 4. Launches alternate sides so the split
 *    is 15/15 and they are paced on `_matchProgress` rather than the clock —
 *    @see `RULES.droneLaunchPad` for why that is what makes the thirty real.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE BLAST IS A GRENADE'S, THROUGH THE GRENADE'S OWN PATH
 * ──────────────────────────────────────────────────────────────────────────
 * `_detonate` emits the canonical `explosion` with `damage`, `radius` and
 * `kind: 'grenade'` — which is EXACTLY the payload `AiSystem._updateGrenades`
 * emits for a bot's frag. Everything downstream is therefore literally the same
 * code, not a copy of it:
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
 * Seconds between rotor strikes, cruising and diving. @see `_sound` — this is a
 * placeholder loop and the interval is the voice budget's, not the sound's: the
 * weapons bus is 18 of 40 emitters and a firefight must not be evicted by four
 * drones. One voice per drone per second, and only inside `ROTOR_RANGE`.
 */
const ROTOR_TICK = 0.95;
const ROTOR_TICK_DIVE = 0.42;
/** Metres a drone can be heard at. */
const ROTOR_RANGE = 58;

/** Chest height on a target, whatever it is. Bots and the player are both 1.8 m. */
const CHEST = 1.15;

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
    this.health = 0;
    this.life = 0;
    this.target = null;
    /** Seconds of unbroken sight on `target`. */
    this.lockT = 0;
    /** Seconds since the last time it could see `target`. */
    this.blindT = 0;
    this.scanT = 0;
    this.recoverT = 0;
    /** Seconds until the next rotor strike. @see `Drones._sound`. */
    this.soundT = 0;
    this.rotor = 0;
    this.group = null;
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

    /** Launches spent. `_budget[t]` is per side; the sum is `RULES.droneBudget`. */
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

  /** Launches still owed this match. */
  get left() {
    return RULES.droneBudget - this._spent[0] - this._spent[1];
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
     * Two paints, one per side, plus the shared airframe. The airframe is a
     * matt composite that reads dark against the sky and the strobe is the only
     * thing on it with any emission — a drone must be seen as a SHAPE moving
     * against the cloud, and a shiny one disappears into the specular.
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
    for (let t = 0; t < 2; t++) {
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(TEAM_COLOR[t]),
        emissive: new THREE.Color(TEAM_COLOR[t]),
        emissiveIntensity: 5.5,
        roughness: 0.4,
        metalness: 0,
      });
      strobes.push(m);
      this.materials.push(m);
    }
    this._strobes = strobes;

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
    if (spent >= RULES.droneBudget) return;
    const owed = (spent + RULES.droneLaunchPad) / RULES.droneBudget;
    if (progress < owed) return;
    if (this._gap > 0) return;
    if (this.aloft >= RULES.droneMaxAloft) { this.stats.deferred++; return; }
    this._launch(this._nextTeam);
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
    d.health = RULES.droneHealth;
    d.life = RULES.droneLife;
    d.target = null;
    d.lockT = 0;
    d.blindT = 0;
    d.recoverT = 0;
    d.warning = false;
    // Off one shoulder of the spawn cluster rather than out of its middle, so
    // two drones on the same side do not launch through each other.
    const a = this.rng.range(0, Math.PI * 2);
    d.position.set(from.x + Math.cos(a) * 4, from.y + 1.6, from.z + Math.sin(a) * 4);
    d.groundY = from.y;
    d.vel.set(0, RULES.droneSpeed * 0.6, 0);
    d.scanT = this.rng.range(0, SCAN_EVERY);
    d.soundT = this.rng.range(0, ROTOR_TICK);
    d.rotor = this.rng.range(0, Math.PI * 2);
    d.group.visible = true;
    d.group.position.copy(d.position);
    d.strobe.material = this._strobes[team];

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

    this._integrate(d, dt);
    this._sound(d, dt);
  }

  /**
   * ──────────────────────────────────────────────────────────────────────────
   * THE NOISE — 「ドローンの音も明確に出して」
   * ──────────────────────────────────────────────────────────────────────────
   * A drone you cannot hear is an unfair drone, and this is the one part of the
   * feature that is currently a PLACEHOLDER and says so.
   *
   * `src/audio` is another agent's directory, so this goes out through the
   * public `audio.play(kind, position, opts)` and can only use voices that
   * already exist. Nothing in the bank is a rotor. What is used instead:
   *
   *   ROTOR   `strike_jet` at 0.3 s and low level, re-struck every `ROTOR_TICK`
   *           while the drone is within earshot. It is an aircraft, it is
   *           spatialised at the airframe and it moves with it, so the
   *           information (something is flying, and it is over THERE) is
   *           carried — but it is a turbine, not four small props.
   *   DIVE    `strike_incoming`, the falling-bomb whistle. Semantically almost
   *           exactly right and used at full value.
   *   BLAST   the `explosion` event, which `audio` already voices. Correct.
   *   LOCK    a head-locked `grenade_warn`, played by `ui` — the same sound
   *           `ui.airAlert` uses, and for the same reason. Correct.
   *
   * WHAT IS ACTUALLY WANTED, stated for the audio agent: a tracked emitter
   * `droneRotor` driven off `match.drones.list` exactly as `battle.js` drives
   * `tankEngine` off `match.tank.tanks` — four small two-blade props, a beat
   * frequency between them, a load term from the airframe's speed so a dive
   * screams — plus two one-shots, `drone_lock` (the target's own warble) and
   * `drone_dive`. @see the report.
   */
  _sound(d, dt) {
    const diving = d.state === 'dive';
    d.soundT -= dt;
    if (d.soundT > 0) return;
    const tick = diving ? ROTOR_TICK_DIVE : ROTOR_TICK;
    d.soundT = tick;
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    if (!audio?.play) return;
    const cam = this.ctx.camera.position;
    const dist = d.position.distanceTo(cam);
    if (dist > ROTOR_RANGE) return;
    // Louder in the dive and louder close in — the two things a man has to be
    // able to tell apart without looking up.
    const near = 1 - dist / ROTOR_RANGE;
    audio.play(diving ? 'strike_incoming' : 'strike_jet', d.position, {
      level: (diving ? 0.62 : 0.3) * (0.45 + near * 0.55),
      dur: tick * 1.2,
      maxDist: ROTOR_RANGE,
      gain: 0.9,
      occlusion: 0.6,
      priority: diving ? 0.72 : 0.3,
    });
  }

  /** Straight up out of the spawn until it is over the roofline. */
  _climb(d, dt, scan) {
    const ceil = d.groundY + RULES.droneAltitude;
    d.want.set(d.position.x, ceil, d.position.z);
    this._steer(d, dt, RULES.droneSpeed);
    if (d.position.y >= ceil - 1.5) d.state = 'hunt';
  }

  /**
   * TOWARD THE FIGHT, AND LOOKING. `focus` is `MatchSystem._airFocus` — the
   * centroid of the fight with the player's own eye weighted as four men, which
   * is the same aim every air weapon in this file takes and for the same reason
   * (@see `_updateAirFocus`): fixed geography on a 114x141 m map puts the median
   * event 71 m from the one seat that has to see it.
   */
  _hunt(d, dt, scan) {
    const f = this.focus;
    const ceil = d.groundY + RULES.droneAltitude;
    if (f) {
      // It circles rather than parks: a drone hanging still over the fight is a
      // target, and the orbit is what makes the sound move.
      const t = this.ctx.time.elapsed * 0.22 + d.slot;
      d.want.set(f.x + Math.cos(t) * 16, ceil, f.z + Math.sin(t) * 16);
    } else {
      d.want.set(d.position.x, ceil, d.position.z);
    }
    this._steer(d, dt, RULES.droneSpeed);
    this._avoid(d);
    if (scan) {
      const t = this._acquire(d);
      if (t) {
        d.target = t;
        d.lockT = 0;
        d.blindT = 0;
        d.state = 'lock';
        this.stats.locks++;
        this._emit('lock', d);
      }
    }
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
  }

  /* ---------------------------------------------------------- the eyes -- */

  /** Nearest live hostile it can see. Called at 4 Hz, never per frame. */
  _acquire(d) {
    const out = this._foe;
    out.length = 0;
    this.enemies?.(d.team, out);
    let best = null;
    let bestD = RULES.droneAcquireRange * RULES.droneAcquireRange;
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const p = a?.position;
      if (!p) continue;
      const dx = p.x - d.position.x, dy = p.y + CHEST - d.position.y, dz = p.z - d.position.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= bestD) continue;
      this._v2.set(p.x, p.y + CHEST, p.z);
      if (!this._sees(d, this._v2)) continue;
      bestD = d2;
      best = a;
    }
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
    // Shot down is DEAD, not detonated: a warhead that never functioned does
    // not go off over whoever killed it, which is what makes shooting one
    // down worth doing.
    this._emit('dead', d);
    this._retire(d, 'shot');
  }

  _retire(d, why) {
    d.alive = false;
    d.state = 'dead';
    d.target = null;
    if (d.warning) this._reportLock(null);
    d.group.visible = false;
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
