import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { WeaponMaterials, ENV_OCCLUSION } from './materials.js';
import { Viewmodel } from './viewmodel.js';
import { ProjectileSim } from './ballistics.js';
import { WEAPON_DEFS, buildRecoilPattern, SPREAD_MODS } from './defs.js';
import { buildRifle } from './models/rifle.js';
import { buildAk } from './models/ak.js';
import { buildSniper } from './models/sniper.js';
import { buildSmg } from './models/smg.js';
import { buildPistol } from './models/pistol.js';
import { buildKnife } from './models/knife.js';
import { buildGrenade } from './models/grenade.js';
import { ThrownGrenades } from './grenades.js';
import { clamp, clamp01, lerp, damp, DEG } from './mathx.js';

/**
 * WEAPONS — weapon meshes, the first-person viewmodel rig, ADS, recoil, sway,
 * bob, reload/inspect animation and projectile ballistics.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT LIVES HERE
 *   geometry.js   hard-surface kit: chamfered boxes, lathes, extrusions,
 *                 Picatinny rail, M-LOK, knurling, screws, and the Assembly
 *                 that merges everything down to a handful of draw calls.
 *   parts.js      real firearm components built from published dimensions:
 *                 receivers, barrels, muzzle devices, handguards, stocks,
 *                 grips, magazines, optics, iron sights, triggers.
 *   models/*.js   the seven weapons assembled from those parts — five firearms
 *                 (an AR carbine, an AK-pattern rifle, a bolt-action sniper, an
 *                 SMG and a pistol), the combat knife (a `class: 'melee'`
 *                 weapon with no magazine, no reserve, no fire mode and no ADS)
 *                 and the frag grenade (`class: 'grenade'`: two of them, a
 *                 3 s fuze from the pull, and no ADS either).
 *   grenades.js   grenades in the air — rigid bodies, fuzes and the blast.
 *   hands.js      gloved hands + sleeved arms, two-bone IK from the hand.
 *   viewmodel.js  the animation stack (sway/bob/lag/recoil/ADS/clips).
 *   clips.js      keyframed reload / inspect / draw timelines.
 *   ballistics.js travelling projectiles with gravity and drag.
 *   defs.js       every tuning number, plus the deterministic recoil patterns.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLIC API — `const wp = ctx.get('weapons')`
 * ────────────────────────────────────────────────────────────────────────────
 *   wp.current            { id, label, class, mode, magSize, ... } (the def)
 *   wp.ammo               { mag, chambered, reserve, magSize, total, empty }
 *   wp.fireMode           'auto' | 'burst' | 'semi'
 *   wp.spreadDegrees      live cone half-angle — drive the crosshair gap with it
 *   wp.adsProgress        0..1
 *   wp.reloading / wp.firing / wp.switching / wp.inspecting
 *   wp.weaponIds          ['rifle','ak','sniper','smg','pistol','knife','grenade']
 *   wp.isMelee / wp.swinging
 *   wp.isThrown / wp.cooking / wp.cookRemaining / wp.grenadeCount
 *   wp.startCook('over'|'under')   pull the pin — hold
 *   wp.releaseThrow()              let go; the grenade leaves on the clip beat
 *   wp.setWeapon(id)      draw/holster animated swap
 *   wp.nextWeapon()
 *   wp.meleeAttack('slash'|'stab')   blade only; traces on the impact frame
 *   wp.cycleFireMode()
 *   wp.reload()           no-op if full or empty of reserve
 *   wp.scavenge(mags) / wp.needsAmmo          ammunition off a body
 *   wp.pickUpPrimary(id) / wp.needsGrenades   OFF A CACHE — see below
 *   wp.resupplyGrenades(n) / wp.grenadeCapacity
 *   wp.inspect()
 *   wp.tryFire()          honours fire mode + rpm; returns true if a shot left
 *   wp.viewmodel          the rig (fx/ui may read muzzle/eject transforms)
 *   wp.muzzleWorld(v3)    world-space muzzle, for anything that needs it
 *   wp.debugPose(kind)    'idle' | 'ads' | 'fire'  (the capture harness)
 *   wp.stats              { tris, drawCalls, live, fired }
 *
 * EVENTS EMITTED  (all canonical, see ARCHITECTURE.md)
 *   weapon:fire    { weapon, origin, dir, seed }
 *   weapon:shell   { position, velocity }
 *   weapon:reload  { weapon, phase: 'start'|'magout'|'magin'|'end' }
 *   weapon:bolt    { weapon, duration }               manual actions only
 *   weapon:melee   { weapon, phase, kind, surface, position }   the blade
 *   bullet:tracer  { from, to, speed }
 * `bullet:impact` comes from physics, because physics owns penetration.
 * Anything else (ammo counts, fire mode, the current weapon) is a getter on
 * this object rather than an event.
 *
 * `weapon:bolt` and `weapon:melee` exist because two things the player does
 * make a sound and produce NO other event: working a bolt (the whole 1.25 s
 * cycle is expressed as fire-control timing, which nothing can hear) and
 * swinging a knife at a wall or at air (no `damage:dealt`, so audio never knew
 * it happened). Both are rows in ARCHITECTURE.md.
 */
/**
 * Registration order, which is also the order 1/2/3... and `nextWeapon` cycle
 * in, and the order the pause menu lists. Primaries first, then the sidearm,
 * then the blade.
 */
const WEAPON_IDS = ['rifle', 'ak', 'sniper', 'smg', 'pistol', 'knife', 'grenade'];

export class WeaponSystem {
  static id = 'weapons';
  static deps = ['materials', 'physics'];

  constructor() {
    this.viewmodel = null;
    this.sim = null;
    this.states = new Map();
    this.activeId = 'rifle';
    /** Which weapon slot 1 draws. @see setPrimary */
    this.primaryId = 'rifle';
    this.debugMode = null;
    /**
     * Trigger disabled from outside. `match` holds this true through freeze
     * time, the round-end dwell and while the player has both hands on the C4.
     * Reload and weapon swap stay available during a freeze — changing loadout
     * is the whole point of the ten seconds.
     */
    this.locked = false;

    this._fireTimer = 0;
    this._burstLeft = 0;
    this._burstCooldown = 0;
    this._semiLatch = false;
    this._spread = 0;
    this._shotIndex = 0;
    this._sinceShot = 10;
    this._switchTimer = 0;
    this._switchTo = null;
    this._reloadPhase = null;

    this._muzzle = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._firePayload = { weapon: null, origin: new THREE.Vector3(), dir: new THREE.Vector3(), seed: 0 };
    this._reloadPayload = { weapon: null, phase: 'start' };
    // `weapon:shell` carries the canonical { position, velocity } plus the real
    // case dimensions and a spin, so fx can size and tumble the brass instead of
    // guessing: a 9x19 case is less than half the length of a 5.56x45 one.
    this._shellPayload = {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      weapon: null,
      caseLen: 0.0446,
      caseRadius: 0.00495,
      spin: 0,
    };
    this._pendingShots = 0;
    this._pendingFirst = false;

    // ---- melee (preallocated; the strike runs inside a clip callback) ----
    this._meleeKind = 'slash';
    this._meleeCooldown = 0;
    this._meleePart = null;
    this._meleeOrigin = new THREE.Vector3();
    this._meleeDir = new THREE.Vector3();
    this._meleePoint = new THREE.Vector3();
    this._meleePayload = {
      target: null, amount: 0, headshot: false, part: 'torso',
      killed: false, point: null, source: null,
    };
    /**
     * `weapon:melee` — what the blade DID, which `damage:dealt` cannot carry.
     * A whiff deals no damage and a knife into a wall deals no damage, and both
     * have to be audible: `phase:'swing'` on every attack, `phase:'hit'` with a
     * surface only when the edge reached something.
     */
    this._meleeSound = {
      weapon: null, phase: 'swing', kind: 'slash', surface: 'flesh',
      position: null, at: new THREE.Vector3(),
    };
    /**
     * `weapon:bolt` — a MANUALLY cycled action, queued after the shot.
     *
     * The bolt gun is expressed entirely in the fire-control system that already
     * exists (defs.js: 48 rpm and one fire mode IS the 1.25 s bolt throw), and
     * that was right for gameplay and silent for audio: the only action noise a
     * shot makes is `weaponShot`'s MECH layer, which is a self-loader's carrier
     * bouncing 30 ms after the round leaves. A bolt gun's throw is a separate,
     * unhurried, half-second EVENT the shooter performs, and hearing it is how
     * you know he cannot answer you yet.
     */
    this._boltTimer = -1;
    this._boltPayload = { weapon: null, duration: 0.78 };

    /**
     * ---- thrown (the grenade) ------------------------------------------
     *
     * THE FUZE IS HELD HERE, NOT ON THE GRENADE, until the moment it leaves
     * the hand. `_cooking` is true from the pin pull to the release, and
     * `_cookFuse` is the time left on a fuze that is already burning — which is
     * what makes cooking a real decision rather than a hold-to-charge bar:
     * whatever is left when it leaves the hand is what `ThrownGrenades` counts
     * down, and if it reaches zero first it goes off in the fist.
     */
    this._cooking = false;
    this._cookStyle = 'over';
    this._cookFuse = 0;
    this._throwing = false;
    this._throwFuse = 0;
    this._throwOrigin = new THREE.Vector3();
    this._throwVel = new THREE.Vector3();

    // Deferred shell ejections (a case leaves the port a few ms after the shot).
    this._shellQueue = [];
    for (let i = 0; i < 8; i++) {
      this._shellQueue.push({ t: -1, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
    }
    this._droppedMags = [];
    this._state = {
      ads: false,
      sprint: false,
      lowReady: false,
      speed: 0,
      crouch: false,
      airborne: false,
      trigger: false,
      empty: false,
    };
    // Preallocated HUD snapshot handed to `ui` (see getHudState).
    this._hudState = {
      name: '', mode: 'auto', ammo: 0, reserve: 0, magSize: 0,
      reloading: false, reloadProgress: 0, ads: false, spread: 0, firing: false,
      melee: false, lethalCount: 0,
    };
  }

  /* ====================================================================== */
  /*  init                                                                  */
  /* ====================================================================== */

  async init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    this.mats = new WeaponMaterials(ctx);
    this.sim = new ProjectileSim(ctx);
    /** Grenades in the air: rigid bodies, fuzes and the blast. @see grenades.js */
    this.thrown = new ThrownGrenades(ctx);
    this.viewmodel = new Viewmodel(ctx, this.mats);
    // three only honours `material.envMapIntensity` when the material carries its
    // OWN `envMap`; for a material lit by `scene.environment` the renderer
    // overwrites that uniform with `scene.environmentIntensity` every frame
    // (WebGLRenderer.setProgram, the isMeshStandardMaterial branch). The
    // viewmodel is drawn from its own scene, so ENV_OCCLUSION — how much of the
    // sky a shouldered weapon actually sees, see materials.js — has to be
    // expressed there or it is silently a no-op.
    ctx.viewScene.environmentIntensity = ENV_OCCLUSION;
    this.viewmodel.onClipEvent = (name, clip) => this._onClipEvent(name, clip);

    const t0 = performance.now();
    const builders = {
      rifle: buildRifle,
      ak: buildAk,
      sniper: buildSniper,
      smg: buildSmg,
      pistol: buildPistol,
      knife: buildKnife,
      grenade: buildGrenade,
    };
    let tris = 0;
    for (const id of WEAPON_IDS) {
      const def = { ...WEAPON_DEFS[id] };
      const melee = def.class === 'melee';
      /** A thrown weapon has no rpm, no recoil pattern and no magazine. */
      const thrown = def.class === 'grenade';
      if (!melee && !thrown) def.cycleTime = 60 / def.rpm;
      const model = builders[id]();
      const entry = this.viewmodel.addWeapon(model, def);
      tris += entry.tris;
      console.info(`[weapons] ${id}: ${entry.tris} tris`);
      this.states.set(id, {
        def,
        // A melee weapon has no recoil pattern to generate and no ammunition.
        // 0/0/0 here is not a fake ammo count — it is what `ammo` reports as
        // `empty: true, magSize: 0`, which is the flag the HUD reads to print
        // an em dash instead of a number.
        pattern: melee || thrown ? null : buildRecoilPattern(def, Rng),
        // A grenade's "magazine" is how many you are carrying: 2, with no
        // reserve, so `ammo` reports { mag: 2, magSize: 0 } — a real count of a
        // weapon that does not take magazines. @see getHudState.
        mag: melee ? 0 : thrown ? def.count : def.magSize,
        chambered: !melee && !thrown,
        reserve: melee || thrown ? 0 : def.reserve,
        mode: def.modes[0],
        modeIndex: 0,
      });
    }
    this.viewmodel.setActive(this.activeId);
    this.viewmodel.play('draw');

    // Player hooks (all optional: the viewmodel works standalone).
    this.player = ctx.peek('player');
    this.fx = ctx.peek('fx');
    this.physics = ctx.peek('physics');
    this._off = [];
    this._off.push(
      ctx.events.on('player:land', (e) => this.viewmodel.land(Math.abs(e?.velocity ?? 3)))
    );
    this._off.push(ctx.events.on('player:jump', () => this.viewmodel.jump()));

    this.stats = { tris, drawCalls: 0, live: 0, fired: 0 };
    console.info(
      `[weapons] ${this.states.size} weapons · ${(tris / 1000).toFixed(1)}k tris viewmodel · ` +
        `built in ${(performance.now() - t0).toFixed(0)}ms`
    );
  }

  /* ====================================================================== */
  /*  public getters                                                        */
  /* ====================================================================== */

  get state() {
    return this.states.get(this.activeId);
  }

  get current() {
    return this.state?.def ?? null;
  }

  /**
   * THE PRIMARY SLOT'S CANDIDATES — carbine, AK, sniper, SMG.
   *
   * A loadout is not the same thing as what is in your hands, and the menu was
   * conflating them: it listed all six weapons and switching one was the same
   * action as pressing its number key. That is a weapon SWITCHER. What a
   * demolition game needs, and what was asked for, is choosing WHICH primary
   * you carry — the sidearm and the knife are fixed, slot 1 is the choice.
   *
   * Derived from `class` rather than listed, so a new primary added to defs.js
   * appears in the menu with nothing else to change.
   */
  get primaryIds() {
    return WEAPON_IDS.filter((id) => {
      const c = WEAPON_DEFS[id]?.class;
      return c !== 'pistol' && c !== 'melee';
    });
  }

  /**
   * Choose the primary. Slot 1 draws it from now on.
   *
   * If the player is currently holding a primary — which they are, in the menu,
   * essentially always — swap to the new one so the choice is visible
   * immediately rather than only after the next number-key press. If they are
   * holding the pistol or the knife, the choice is recorded and takes effect
   * when they go back to slot 1.
   */
  setPrimary(id) {
    if (!this.primaryIds.includes(id)) return false;
    this.primaryId = id;
    const holdingPrimary = this.primaryIds.includes(this.activeId);
    if (holdingPrimary) {
      if (typeof this.setWeaponImmediate === 'function') this.setWeaponImmediate(id);
      else this.setWeapon(id);
    }
    return true;
  }

  /**
   * The ADS field-of-view scale the CAMERA should use for the weapon in hand.
   *
   * A scoped weapon's `scope.magnification` is a real magnification: 6x means
   * the world camera runs at a sixth of its FOV, which is what actually makes
   * distant targets bigger. Everything else returns null and the camera keeps
   * the global `adsFovScale`.
   */
  get adsFovScale() {
    const mag = this.state?.def?.scope?.magnification;
    return mag > 1 ? 1 / mag : null;
  }

  /** True while the player is looking THROUGH a magnified optic. */
  get scoped() {
    return !!this.state?.def?.scope && this.viewmodel.adsT > 0.72;
  }

  /** Movement multiplier for the weapon in hand. @see PlayerMovement.targetSpeed */
  get moveScale() {
    return this.state?.def?.moveScale ?? 1;
  }

  /** Recoil recovery profile for the weapon in hand. @see CameraRig.setRecoilControl */
  get recoilControl() {
    return this.state?.def?.recoilControl ?? null;
  }

  get weaponIds() {
    return [...this.states.keys()];
  }

  get ammo() {
    const s = this.state;
    if (!s) return { mag: 0, chambered: false, reserve: 0, magSize: 0, total: 0, empty: true };
    const mag = s.mag;
    const ch = s.chambered ? 1 : 0;
    return {
      mag: mag + ch,
      inMag: mag,
      chambered: s.chambered,
      reserve: s.reserve,
      // A melee weapon has no magSize at all; 0 is what says "this weapon does
      // not take ammunition", which is different from "this magazine is empty".
      magSize: s.def.magSize ?? 0,
      total: mag + ch + s.reserve,
      empty: mag + ch === 0,
    };
  }

  /** True when the active weapon is a blade — no ammo, no fire mode, no ADS. */
  get isMelee() {
    return this.current?.class === 'melee';
  }

  /** True when the active weapon is thrown — no ammo, no fire mode, no ADS. */
  get isThrown() {
    return this.current?.class === 'grenade';
  }

  /** Pin out, fuze burning, still in the hand. */
  get cooking() {
    return this._cooking;
  }

  /** Seconds left on the fuze of the grenade being cooked, or 0. */
  get cookRemaining() {
    return this._cooking ? Math.max(0, this._cookFuse) : 0;
  }

  /** Grenades left, whatever is currently in the player's hands. */
  get grenadeCount() {
    return this.states.get('grenade')?.mag ?? 0;
  }

  get fireMode() {
    return this.state?.mode ?? 'semi';
  }

  get adsProgress() {
    return this.viewmodel?.adsT ?? 0;
  }

  get reloading() {
    const n = this.viewmodel?.clipName;
    return n === 'reloadTac' || n === 'reloadEmpty';
  }

  get inspecting() {
    return this.viewmodel?.clipName === 'inspect';
  }

  get switching() {
    return this._switchTo !== null;
  }

  get firing() {
    return this._sinceShot < 0.12;
  }

  /** Current spread cone half-angle in degrees — the crosshair should use this. */
  get spreadDegrees() {
    return this._spread;
  }

  muzzleWorld(out) {
    return this.viewmodel.muzzleWorld(out ?? this._tmp);
  }

  /**
   * HUD adapter polled by `ui` every lateUpdate. Shape is fixed by the contract
   * documented at the top of src/ui/index.js; the object is preallocated and
   * mutated in place because `ui` reads it once per frame and never keeps it.
   */
  getHudState() {
    const h = this._hudState;
    const s = this.state;
    if (!s) return h;
    const a = this.ammo;
    const vm = this.viewmodel;
    h.name = s.def.label ?? s.def.id;
    h.mode = s.mode;
    // `ui` prints an em dash for the count and hides the pip strip when this is
    // set — see ui/ammo.js. Without it a knife reads "0 / 0" with an empty
    // magazine strip and a flashing PRESS R TO RELOAD.
    h.melee = s.def.class === 'melee';
    // `a.mag` counts the chambered round, so a topped-off rifle is 31. The HUD
    // draws one pip per round against magSize, so clamp the *display* to the
    // magazine capacity rather than overflowing the pip strip.
    /**
     * A GRENADE HAS A COUNT BUT NO MAGAZINE, which is a third case the readout
     * did not have. The knife's `magSize: 0` is the right flag — it is what
     * says "this weapon does not take magazines" — but the knife's answer to
     * the count is an em dash, and "—" is exactly the wrong thing to print
     * next to a weapon whose whole tactical question is *how many have I got
     * left*. So: the real count, `magSize: 0`, and no reserve; ui/ammo.js
     * reads that combination as countless-but-counted and drops the separator,
     * the reserve, the pip strip and the reload prompt.
     */
    h.ammo = a.magSize > 0 ? Math.min(a.mag, a.magSize) : a.mag;
    h.reserve = a.reserve;
    h.magSize = a.magSize;
    /**
     * The equipment row's frag count, which the HUD has drawn as a hardcoded
     * "2" since it was written. It is a real number now, and it is true on
     * every weapon — you can see how many grenades you have while holding the
     * rifle, which is the only time the number is any use.
     */
    h.lethalCount = this.grenadeCount;
    h.reloading = this.reloading;
    // 0..1 through the active reload clip; the bar is meaningless otherwise.
    h.reloadProgress = h.reloading && vm?.clip?.duration
      ? Math.min(1, vm.clipT / vm.clip.duration)
      : 0;
    h.ads = (vm?.adsT ?? 0) > 0.5;
    // `ui` maps this to reticle bloom as 4 + spread * 40 px, so hand it a
    // normalised 0..1 rather than raw degrees.
    h.spread = Math.min(1, Math.max(0, this._spread / 6));
    h.firing = this.firing;
    return h;
  }

  /* ====================================================================== */
  /*  weapon management                                                     */
  /* ====================================================================== */

  setWeapon(id) {
    if (!this.states.has(id) || id === this.activeId || this._switchTo) return false;
    /**
     * A LIT GRENADE CANNOT BE PUT AWAY. The pin is on the floor and the fuze is
     * burning; holstering it would either lose the timer or leave a bomb in a
     * pouch. Both hands are on it until it is thrown or it goes off, exactly as
     * a reload owns the weapon until it finishes.
     */
    if (this._cooking || this._throwing) return false;
    this._switchTo = id;
    this._switchTimer = this.viewmodel.play('holster');
    return true;
  }

  nextWeapon() {
    const ids = this.weaponIds;
    const i = ids.indexOf(this.activeId);
    return this.setWeapon(ids[(i + 1) % ids.length]);
  }

  cycleFireMode() {
    const s = this.state;
    if (!s || s.def.modes.length < 2) return s?.mode;
    s.modeIndex = (s.modeIndex + 1) % s.def.modes.length;
    s.mode = s.def.modes[s.modeIndex];
    this._burstLeft = 0;
    return s.mode;
  }

  reload() {
    const s = this.state;
    if (!s || this.reloading || this.switching) return false;
    if (s.def.class === 'melee' || s.def.class === 'grenade') return false;
    if (s.mag >= s.def.magSize || s.reserve <= 0) return false;
    this.viewmodel.stopClip();
    const empty = s.mag === 0 && !s.chambered;
    this.viewmodel.play(empty ? 'reloadEmpty' : 'reloadTac');
    this._pendingReloadEmpty = empty;
    return true;
  }

  /**
   * SCAVENGE — put a dead man's ammunition into your own pouches.
   *
   * `match` owns WHERE this comes from (a pouch on a body, see
   * src/match/ammo.js); this owns what it is worth, because ammunition is this
   * subsystem's state and nothing outside it may write `reserve`.
   *
   * Three decisions, each of which could have gone the other way:
   *
   *   IT IS NOT CALIBRE-MATCHED. One pouch tops up EVERY magazine-fed weapon in
   *   the loadout rather than only the one in your hands. A body on this map
   *   carries whatever `src/ai` gave it, the player carries five different
   *   guns, and a pickup that is usually the wrong ammunition is a pickup the
   *   player learns to walk past — which is the opposite of the point.
   *
   *   IT CANNOT EXCEED THE ROUND-START BUDGET. Every weapon is capped at its
   *   own `def.reserve`, so scavenging can only ever CLAW BACK what you have
   *   already spent. A five minute round with respawns and thirty men produces
   *   enough bodies that an uncapped pickup would mean infinite ammunition,
   *   which deletes the reload economy the whole weapon feel is built on.
   *
   *   GRENADES ARE NOT IN IT. `resetAmmo` documents that the round's frags are
   *   the round's budget, and that is a balance rule about the strongest thing
   *   in the loadout, not an oversight. "弾" is bullets.
   *
   * @param {number} mags magazines' worth per weapon, per pouch
   * @returns {number} rounds actually added across the loadout — 0 means the
   *   player was already full and the pouch should be left where it is
   */
  scavenge(mags = 1) {
    let added = 0;
    for (const s of this.states.values()) {
      const def = s.def;
      if (def.class === 'melee' || def.class === 'grenade') continue;
      const cap = def.reserve ?? 0;
      if (s.reserve >= cap) continue;
      const want = Math.max(1, Math.round((def.magSize ?? 0) * mags));
      const take = Math.min(want, cap - s.reserve);
      s.reserve += take;
      added += take;
    }
    return added;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────────
   * TAKE A WEAPON OFF A RACK — "武器が落ちてるとか、武器はF長押しで交換可能にする"
   * ────────────────────────────────────────────────────────────────────────────
   * `match` owns WHERE a weapon is lying (a `kind: 'weapon'` cache out of
   * `world.features`, bound in src/match/caches.js) and this owns WHAT PICKING
   * ONE UP IS WORTH, for exactly the reason `scavenge` above does: `mag`,
   * `chambered` and `reserve` are this subsystem's state and nothing outside it
   * may write them.
   *
   * IT IS NOT `setPrimary`. `setPrimary` is the LOADOUT choice made in the pause
   * menu, out of the round, and it is right that it changes nothing but which
   * gun slot 1 draws — you are picking what you walk out of spawn with. Taking a
   * gun off a rack in the middle of a firefight is a different verb and has to
   * answer a question the menu never asks: WHAT IS IN IT?
   *
   *   THE MAGAZINE IS FULL. A rack weapon you have to reload before you can use
   *   it is a rack weapon you never take, because the two seconds it costs are
   *   two seconds spent standing in a building.
   *   THE RESERVE IS HALF, AND IT IS A FLOOR NOT A GIFT. `Math.max` against what
   *   you already had, capped at the weapon's own `def.reserve` — same cap
   *   `scavenge` uses and for the same reason. Swapping to a gun and back cannot
   *   manufacture ammunition, and a gun you have already been carrying and
   *   shooting is not silently topped up by walking past a rack.
   *   THE OLD GUN IS NOT CONSUMED. You keep it; you have simply chosen which of
   *   the five is in your hands. Modelling a two-slot inventory would mean
   *   throwing one away with no way to get it back on a map with eight racks on
   *   it, and `weaponIds` — which the number keys, the HUD and `nextWeapon` all
   *   walk — is a fixed list this subsystem builds at init.
   *
   * @param {string} id one of `primaryIds`
   * @returns {string|null} the primary this replaced, or null if nothing changed
   */
  pickUpPrimary(id) {
    if (!this.states.has(id) || id === this.primaryId) return null;
    /**
     * NOT THE FRAG. `primaryIds` is derived by excluding `pistol` and `melee`,
     * which leaves `class: 'grenade'` in it — so `setPrimary('grenade')` is
     * currently legal and would make slot 1 draw a hand grenade with no
     * magazine, no reserve and no fire mode. Nothing off a cache may do that.
     */
    const cls = this.states.get(id).def.class;
    if (cls === 'grenade' || cls === 'melee') return null;
    const prev = this.primaryId;
    if (!this.setPrimary(id)) return null;
    const s = this.states.get(id);
    const def = s.def;
    if (def.magSize) {
      s.mag = def.magSize;
      s.chambered = true;
    }
    const cap = def.reserve ?? 0;
    if (cap) s.reserve = Math.min(cap, Math.max(s.reserve, Math.round(cap * 0.5)));
    return prev;
  }

  /** How many frags a full pouch is. @see resupplyGrenades */
  get grenadeCapacity() {
    return this.states.get('grenade')?.def.count ?? 0;
  }

  /** True when the frag pouch is not full. The cheap test before a resupply. */
  get needsGrenades() {
    return this.grenadeCount < this.grenadeCapacity;
  }

  /**
   * PUT FRAGS BACK IN THE POUCH — "グレネードを補充できる".
   *
   * `resetAmmo` says in as many words that "the round's grenades are the round's
   * budget… there are no pickups", and `scavenge` excludes them on purpose,
   * because a frag is the strongest thing in the loadout and a body every ten
   * seconds would mean infinite ones. Neither of those arguments applies to a
   * grenade cache: it is ONE FIXED PLACE, it is INDOORS on somebody else's half
   * of the map, and `match` puts a cooldown on it — so the frag economy becomes
   * "you may have more if you are willing to go and stand in that room", which
   * is the entire point of the feature.
   *
   * Capped at `def.count` like everything else here, so this can only ever claw
   * back what has been thrown. A lit grenade is not topped up: `mag` is the
   * pouch and the one in your hand has already left it.
   *
   * @param {number} n frags to hand over
   * @returns {number} how many actually went in — 0 means the pouch was full
   */
  resupplyGrenades(n = 2) {
    const s = this.states.get('grenade');
    if (!s) return 0;
    const cap = s.def.count ?? 0;
    const take = Math.min(Math.max(0, n | 0), cap - s.mag);
    if (take <= 0) return 0;
    s.mag += take;
    return take;
  }

  /** True when at least one magazine-fed weapon is below its starting reserve. */
  get needsAmmo() {
    for (const s of this.states.values()) {
      const def = s.def;
      if (def.class === 'melee' || def.class === 'grenade') continue;
      if (s.reserve < (def.reserve ?? 0)) return true;
    }
    return false;
  }

  /**
   * Full loadout, as if you had just walked out of spawn: every magazine
   * topped off, every reserve refilled, no half-finished animation. Called by
   * `match` at the top of each round — the round's ammunition is the round's
   * budget, and `scavenge()` above is the only thing that adds to it inside a
   * round (never above this same starting figure).
   */
  resetAmmo() {
    for (const s of this.states.values()) {
      if (s.def.class === 'melee') continue; // nothing to refill
      if (s.def.class === 'grenade') {
        // Two frags, and this is the ONLY place they come back: there are no
        // pickups, so the round's grenades are the round's budget.
        s.mag = s.def.count;
        s.chambered = false;
        s.reserve = 0;
        continue;
      }
      s.mag = s.def.magSize;
      s.chambered = true;
      s.reserve = s.def.reserve;
    }
    // A round boundary is not a place to be holding a lit grenade. The model
    // is hidden between the release beat and the end of the throw clip, so if
    // the round turns over inside that window the visibility has to be put
    // back here — otherwise the player draws a full pouch and holds nothing.
    this._cooking = false;
    this._throwing = false;
    this.thrown?.clear();
    const gren = this.viewmodel?.weapons?.get('grenade');
    if (gren) {
      gren.group.visible = this.activeId === 'grenade';
      if (gren.parts.pin) gren.parts.pin.visible = true;
    }
    this._burstLeft = 0;
    this._burstCooldown = 0;
    this._fireTimer = 0;
    this._shotIndex = 0;
    this._spread = 0;
    this._pendingShots = 0;
    // Swapping weapons cancels a queued bolt throw; the rifle is not in his
    // hands any more and the sound would come from nowhere.
    this._boltTimer = -1;
    this.viewmodel?.stopClip();
    this.viewmodel.boltHold = 0;
    this.viewmodel?.play('draw');
    return true;
  }

  inspect() {
    if (this.reloading || this.switching || this.inspecting) return false;
    this.viewmodel.play('inspect');
    return true;
  }

  /* ====================================================================== */
  /*  firing                                                                */
  /* ====================================================================== */

  canFire() {
    const s = this.state;
    if (!s) return false;
    if (this.reloading || this.switching) return false;
    if (this._fireTimer > 0) return false;
    return s.chambered;
  }

  /** One round leaves the barrel. Returns false if the trigger clicked dry. */
  tryFire() {
    const s = this.state;
    if (!s) return false;
    if (this.reloading || this.switching || this._fireTimer > 0) return false;
    if (!s.chambered) {
      // Dry: lock the bolt back and let the player know by feel.
      this.viewmodel.boltHold = 1;
      this._fireTimer = 0.25;
      return false;
    }
    if (this.inspecting) this.viewmodel.stopClip();

    const def = s.def;
    const first = this._sinceShot > 0.35;
    // ---- feed the next round ----
    s.chambered = false;
    if (s.mag > 0) {
      s.mag--;
      s.chambered = true;
    } else {
      this.viewmodel.boltHold = 1;
    }

    // ---- deterministic recoil pattern ----
    const idx = Math.min(this._shotIndex, def.recoil.patternLength - 1);
    const pitch = s.pattern[idx * 2];
    const yaw = s.pattern[idx * 2 + 1];
    this._shotIndex++;

    // ---- aim: camera forward + a spread cone ----
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    this._camDir.set(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    this._dir.copy(this._camDir);
    const spreadRad = this._spread * DEG;
    if (spreadRad > 1e-5) {
      const d = this.rng.disc(this._disc ?? (this._disc = { x: 0, y: 0 }));
      this._right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      this._up.set(0, 1, 0).applyQuaternion(cam.quaternion);
      this._dir
        .addScaledVector(this._right, Math.tan(spreadRad) * d.x)
        .addScaledVector(this._up, Math.tan(spreadRad) * d.y)
        .normalize();
    }

    // ---- projectile ----
    this.viewmodel.muzzleWorld(this._muzzle);
    const seed = this.rng.u32();
    this.sim.spawn({
      origin: this._muzzle,
      dir: this._dir,
      speed: def.muzzleVelocity,
      damage: def.damage,
      penetration: def.penetration,
      dragK: def.dragK,
      dropoff: def.dropoff,
      maxRange: def.maxRange,
      weapon: def,
      tracer: this.stats.fired % def.tracerEvery === 0,
      // Attribution: physics puts this on `damage:dealt` as `source`, which is
      // what gives the player kill credit in a team mode.
      shooter: this.player ?? 'player',
    });

    // ---- feedback ----
    this.viewmodel.addRecoil(pitch, yaw, first);
    const p = this.player;
    if (p?.addRecoil) {
      // The camera climb is the learnable part; the viewmodel kick is the feel.
      p.addRecoil(pitch, yaw, def.recoil.roll * 0.35, def.recoil.punch);
    }
    this._spread = Math.min(def.spreadMax, this._spread + def.spreadPerShot);
    this._fireTimer = 60 / def.rpm;
    this._sinceShot = 0;
    this.stats.fired++;
    this._pendingShots++;
    this._pendingFirst = this._pendingFirst || first;
    this._fireSeed = seed;

    // Shell leaves the port shortly after the shot, once the bolt is back.
    this._queueShell(Math.min(0.05, this._fireTimer * 0.45));

    /**
     * A manually cycled action does NOT start with the shot: the shooter has to
     * come off the recoil first. 180 ms of dwell, then the throw runs over 62%
     * of the cycle — the same fraction `viewmodel.boltCycle` animates it over
     * (see the bolt/slide block in viewmodel.js), so the sound and the moving
     * part are the same event rather than two events that happen to overlap.
     */
    if (def.boltAction) {
      this._boltTimer = 0.18;
      this._boltPayload.duration = Math.max(0.2, this._fireTimer * 0.62);
    }
    return true;
  }

  _queueShell(delay) {
    for (const q of this._shellQueue) {
      if (q.t < 0) {
        q.t = delay;
        return q;
      }
    }
    return null;
  }

  /* ====================================================================== */
  /*  melee                                                                 */
  /* ====================================================================== */

  /**
   * Start a swing. `kind` is 'slash' (LMB) or 'stab' (RMB).
   *
   * Nothing is traced here — the clip's `meleeimpact` beat calls
   * `_meleeStrike`, so the damage lands on the frame the edge is at full
   * extension on screen (130 ms into a slash, 210 ms into a stab). Damaging on
   * the button press and animating afterwards is the standard melee bug and it
   * is what makes a knife feel like a hitscan pistol.
   */
  meleeAttack(kind = 'slash') {
    const s = this.state;
    if (!s || s.def.class !== 'melee') return false;
    if (this.switching || this._meleeCooldown > 0) return false;
    const spec = s.def.melee?.[kind];
    if (!spec) return false;
    this.viewmodel.stopClip();
    this._meleeKind = kind;
    this._meleeCooldown = spec.cycle;
    this.viewmodel.play(kind);
    this._emitMelee('swing', null, null);
    return true;
  }

  /** One preallocated payload for both melee beats. `point` may be null. */
  _emitMelee(phase, surface, point) {
    const m = this._meleeSound;
    m.weapon = this.current;
    m.phase = phase;
    m.kind = this._meleeKind;
    m.surface = surface ?? 'flesh';
    // A swing is our own arm and is head-locked; a hit happened somewhere.
    if (point) m.position = m.at.copy(point);
    else m.position = null;
    this.ctx.events.emit('weapon:melee', m);
  }

  get swinging() {
    const n = this.viewmodel?.clipName;
    return n === 'slash' || n === 'stab';
  }

  /**
   * THE IMPACT FRAME. Two queries, because neither one alone is enough:
   *
   *  1. `sphereCast` sweeps a 160-180 mm sphere through the STATIC world only
   *     (physics/index.js capsuleCast goes to `staticWorld.sweepCapsule` and
   *     never visits the collider list), so it answers "how far can the blade
   *     travel before it hits a wall" and nothing else. Without it a swing
   *     through a doorframe kills the man on the other side of it.
   *  2. Dynamic hitboxes — the AI's per-part capsules, which are what carry
   *     `owner` and `part` — are only tested by `raycast`. So the actor query
   *     is a five-ray fan: the centre line plus four rays offset by the swing
   *     radius in screen right/up, which approximates the swept sphere to
   *     within the radius and costs four extra rays ONCE PER SWING, not per
   *     frame.
   *
   * Nearest actor inside the wall distance wins. `source` is required on the
   * payload: `ai` reads it for friendly fire and kill credit, and `match` reads
   * it for the scoreboard (see ARCHITECTURE.md).
   */
  _meleeStrike() {
    const s = this.state;
    const spec = s?.def.melee?.[this._meleeKind];
    if (!spec) return false;
    const phys = this.physics ?? (this.physics = this.ctx.peek('physics'));
    if (!phys) return false;

    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    const origin = this._meleeOrigin.setFromMatrixPosition(cam.matrixWorld);
    const dir = this._meleeDir.set(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    this._right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(cam.quaternion);

    // 1 — how far the blade can actually travel.
    const wall = phys.sphereCast(origin, dir, spec.radius, spec.reach, phys.MASK.BULLET);
    const maxDist = wall.hit ? Math.min(spec.reach, wall.distance + spec.radius) : spec.reach;

    // 2 — the fan.
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < 5; i++) {
      const ox = i === 1 ? -spec.radius : i === 2 ? spec.radius : 0;
      const oy = i === 3 ? -spec.radius : i === 4 ? spec.radius : 0;
      this._tmp.copy(origin).addScaledVector(this._right, ox).addScaledVector(this._up, oy);
      const h = phys.raycast(this._tmp, dir, maxDist, phys.MASK.BULLET);
      if (!h.hit || !h.actor || h.distance >= bestD) continue;
      bestD = h.distance;
      // The hit record comes out of a 64-deep ring pool, so the two fields that
      // outlive this loop are copied out rather than stashed by reference.
      best = h.actor;
      this._meleePoint.copy(h.point);
      this._meleePart = h.part;
    }
    if (!best) {
      // Nothing alive in reach. If the blade reached a WALL it still made a
      // noise, and which wall decides what noise — `physics` has already tagged
      // the collider (ARCHITECTURE.md, surface types). A clean whiff makes none.
      if (wall.hit && wall.distance <= spec.reach) {
        this._tmp.copy(origin).addScaledVector(dir, wall.distance);
        this._emitMelee('hit', wall.surface ?? 'concrete', this._tmp);
      }
      return false;
    }
    this._emitMelee('hit', 'flesh', this._meleePoint);

    const p = this._meleePayload;
    p.target = best;
    p.amount = spec.damage;
    p.headshot = this._meleePart === 'head';
    p.part = this._meleePart ?? 'torso';
    p.killed = false;
    p.point = this._meleePoint;
    p.source = this.player ?? this.ctx.peek('player') ?? 'player';
    this.ctx.events.emit('damage:dealt', p);
    return true;
  }

  /* ====================================================================== */
  /*  throwing                                                              */
  /* ====================================================================== */

  /**
   * Pull the pin. `style` is 'over' (LMB, a hard overhand throw) or 'under'
   * (RMB, a short underhand toss for putting one round a corner).
   *
   * Nothing is thrown here and nothing is consumed here: this starts the FUZE
   * and the wind-up, and the grenade only leaves the hand on the `release`
   * beat of the throw clip — which is 170 ms into a whip that lasts 660 ms, so
   * it leaves at the point of the arc where the hand is actually fastest. A
   * grenade that spawns on the button press and animates afterwards is the
   * throwing version of the melee bug the knife documents at length.
   */
  startCook(style = 'over') {
    const s = this.state;
    if (!s || s.def.class !== 'grenade') return false;
    if (this._cooking || this._throwing || this.switching) return false;
    if (s.mag <= 0) return false;
    this.viewmodel.stopClip();
    this._cooking = true;
    this._cookStyle = style;
    this._cookFuse = s.def.fuse ?? 3;
    this.viewmodel.play('cook');
    return true;
  }

  /** Let go. Runs the throw clip; the grenade leaves on its `release` beat. */
  releaseThrow() {
    if (!this._cooking) return false;
    this._cooking = false;
    this._throwing = true;
    this._throwFuse = this._cookFuse;
    this.viewmodel.play('throw');
    return true;
  }

  /**
   * THE RELEASE FRAME. One grenade leaves the hand with whatever is left of
   * its fuze — cook it for two seconds and it detonates one second after it
   * lands, which is the entire reason to hold the button.
   */
  _launchGrenade() {
    const s = this.state;
    if (!s || s.mag <= 0) return false;
    const def = s.def;
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    const dir = this._camDir.set(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    const eye = this._tmp.setFromMatrixPosition(cam.matrixWorld);
    /**
     * Released 0.42 m down the sight line — an arm's length in front of the
     * eye — but pulled back to whatever is actually clear when there is a wall
     * there. Spawning the body inside geometry is how a thrown object ends up
     * on the far side of a door it never went through.
     */
    let reach = 0.42;
    const phys = this.physics ?? (this.physics = this.ctx.peek('physics'));
    if (phys?.raycast) {
      const h = phys.raycast(eye, dir, reach + 0.12, phys.MASK.WORLD);
      if (h?.hit) reach = Math.max(0.1, h.distance - 0.14);
    }
    const origin = this._throwOrigin.copy(eye).addScaledVector(dir, reach);

    const under = this._cookStyle === 'under';
    const speed = under ? def.tossSpeed ?? 8 : def.throwSpeed ?? 17;
    // The toss is lobbed twice as high as the throw: it has to clear the
    // doorway and land short, not skip off the floor into the far wall.
    const loft = (def.throwLoft ?? 0.16) * (under ? 2.2 : 1);
    const vel = this._throwVel.copy(dir).multiplyScalar(speed);
    vel.y += speed * Math.sin(loft);
    // A grenade thrown from a moving man carries the man's momentum.
    const pv = this.player?.velocity;
    if (pv) vel.add(pv);

    s.mag--;
    this.thrown.spawn(origin, vel, this._throwFuse, def, this.viewmodel.active?.meshes);
    // The hand is empty from this frame: hide the viewmodel copy or the player
    // throws a grenade and is still holding it.
    if (this.viewmodel.active) this.viewmodel.active.group.visible = false;
    // Head-locked whoosh — the same voice the knife's swing uses, at half level.
    try {
      this.ctx.peek('audio')?.play?.('swing', { kind: 'slash', level: 0.5 });
    } catch { /* audio is optional feedback */ }
    return true;
  }

  /**
   * COOK-OFF — the fuze reached zero with the grenade still in the fist.
   *
   * It goes off where the player is standing, at full damage, and the player is
   * inside their own blast: `_damagePlayer` does not consult friendly fire
   * because there is no such thing as being on your own bad side. This is the
   * cost of the hold, and without it holding the button would be free.
   */
  _cookOff() {
    const s = this.state;
    this._cooking = false;
    this._cookFuse = 0;
    if (!s) return;
    if (s.mag > 0) s.mag--;
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    this._throwOrigin.setFromMatrixPosition(cam.matrixWorld);
    // Chest height, not eye height: it is in a hand, not between the teeth.
    this._throwOrigin.y -= 0.25;
    this.viewmodel.stopClip();
    if (this.viewmodel.active) this.viewmodel.active.group.visible = false;
    this.thrown.blastAt(this._throwOrigin, s.def);
    this._afterThrow();
  }

  /** Draw the next one, or fall back to the primary when the pouch is empty. */
  _afterThrow() {
    const s = this.state;
    this._throwing = false;
    if (!s || s.def.class !== 'grenade') return;
    const w = this.viewmodel.active;
    if (s.mag > 0) {
      if (w) {
        w.group.visible = true;
        if (w.parts.pin) w.parts.pin.visible = true;
      }
      this.viewmodel.play('draw');
    } else {
      // `setActive` turns the group's visibility back on when it next becomes
      // the active weapon, so the hidden group heals itself on the way back.
      this.setWeapon(this.primaryId);
    }
  }

  /* ====================================================================== */
  /*  reload / clip callbacks                                               */
  /* ====================================================================== */

  _onClipEvent(name, clipName) {
    const s = this.state;
    const isReload = clipName === 'reloadTac' || clipName === 'reloadEmpty';
    switch (name) {
      case 'start':
        if (isReload) this._emitReload('start');
        break;
      case 'magout':
        if (isReload) this._emitReload('magout');
        break;
      case 'magdrop':
        if (isReload) this._dropMagazine();
        break;
      case 'magin':
        if (isReload) {
          this._emitReload('magin');
          this._completeReload(clipName === 'reloadEmpty');
        }
        break;
      case 'boltrelease':
        this.viewmodel.boltHold = 0;
        break;
      case 'meleeimpact':
        this._meleeStrike();
        break;
      /**
       * The pin is out. The ring and the pin are a separate assembly on the
       * model precisely so they can go away here — a grenade whose fuze is
       * burning with the ring still hanging off it is the same lie as a fired
       * case still sitting in the chamber.
       */
      case 'pinpull':
        if (this.viewmodel.active?.parts.pin) {
          this.viewmodel.active.parts.pin.visible = false;
        }
        try {
          this.ctx.peek('audio')?.play?.('dryfire', { level: 0.5 });
        } catch { /* audio is optional feedback */ }
        break;
      case 'release':
        if (clipName === 'throw') this._launchGrenade();
        break;
      case 'end':
        if (clipName === 'throw') this._afterThrow();
        if (isReload) {
          this._emitReload('end');
          this.viewmodel.boltHold = 0;
        }
        if (clipName === 'holster' && this._switchTo) {
          this.activeId = this._switchTo;
          this._switchTo = null;
          this.viewmodel.setActive(this.activeId);
          this.viewmodel.play('draw');
          this._shotIndex = 0;
          this._spread = 0;
        }
        break;
      default:
        break;
    }
  }

  /**
   * The chambered-round model: a tactical reload keeps the round in the chamber
   * and gives you magSize+1; an empty reload has to feed one out of the fresh
   * magazine, so you end up with exactly magSize.
   */
  _completeReload(empty) {
    const s = this.state;
    if (!s) return;
    const want = s.def.magSize - s.mag;
    const take = Math.min(want, s.reserve);
    s.reserve -= take;
    s.mag += take;
    if (empty && !s.chambered && s.mag > 0) {
      s.mag--;
      s.chambered = true;
    }
    this._shotIndex = 0;
  }

  _emitReload(phase) {
    this._reloadPayload.weapon = this.current;
    this._reloadPayload.phase = phase;
    this.ctx.events.emit('weapon:reload', this._reloadPayload);
  }

  /** Spawn the discarded magazine as a real rigid body in the world. */
  _dropMagazine() {
    const phys = this.physics ?? (this.physics = this.ctx.peek('physics'));
    const w = this.viewmodel.active;
    if (!w) return;
    const proxy = this._magProxy(w);
    if (!proxy) return;
    const mag = w.parts.magazine;
    mag.updateMatrixWorld();
    proxy.group.position.setFromMatrixPosition(mag.matrixWorld);
    proxy.group.quaternion.setFromRotationMatrix(mag.matrixWorld);
    proxy.group.visible = true;
    // Magazine geometry hangs below its origin, so bias the body centre down.
    const half = w.magLen * 0.45;
    proxy.group.position.y -= half * 0.4;

    const vel = this._tmp.set(0, -0.7, 0);
    const pv = this.player?.velocity;
    if (pv) vel.add(pv);
    vel.x += this.rng.signed() * 0.25;
    vel.z += this.rng.signed() * 0.25;

    if (phys?.spawnDebris) {
      proxy.body = phys.spawnDebris(proxy.group.position, vel, {
        size: Math.max(0.02, w.magLen * 0.28),
        surface: 'rubber',
        mass: 0.38,
        lifetime: 22,
        restitution: 0.18,
        object3D: proxy.group,
      });
      proxy.until = this.ctx.time.elapsed + 22;
    } else {
      proxy.until = this.ctx.time.elapsed + 2;
    }
  }

  /** Two reusable world-space magazine props per weapon. */
  _magProxy(w) {
    if (!this._magPools) this._magPools = new Map();
    let pool = this._magPools.get(w.id);
    if (!pool) {
      pool = [];
      for (let i = 0; i < 2; i++) {
        const group = new THREE.Object3D();
        group.name = `dropped-mag-${w.id}-${i}`;
        group.visible = false;
        // Share the viewmodel's geometry and materials; the world copy needs no
        // resources of its own.
        w.parts.magazine.traverse((o) => {
          if (o.isMesh) {
            const m = new THREE.Mesh(o.geometry, o.material);
            m.position.copy(o.position);
            m.quaternion.copy(o.quaternion);
            m.castShadow = true;
            group.add(m);
          }
        });
        this.ctx.scene.add(group);
        pool.push({ group, body: null, until: 0 });
        this._droppedMags.push(pool[i]);
      }
      this._magPools.set(w.id, pool);
    }
    // Reuse the oldest.
    let best = pool[0];
    for (const p of pool) if (p.until < best.until) best = p;
    if (best.body && this.physics?.removeRigidBody) this.physics.removeRigidBody(best.body);
    best.body = null;
    return best;
  }

  /* ====================================================================== */
  /*  frame                                                                 */
  /* ====================================================================== */

  fixedUpdate(h) {
    this.sim.fixedUpdate(h);
  }

  update(dt, ctx) {
    const s = this.state;
    if (!s) return;
    const def = s.def;
    const input = ctx.input;
    const player = this.player ?? (this.player = ctx.peek('player'));
    const st = this._state;

    this._sinceShot += dt;
    if (this._fireTimer > 0) this._fireTimer -= dt;
    if (this._burstCooldown > 0) this._burstCooldown -= dt;
    if (this._meleeCooldown > 0) this._meleeCooldown -= dt;
    const melee = def.class === 'melee';
    const thrown = def.class === 'grenade';

    // ---- the fuze, and everything already in the air ---------------------
    // A burning fuze does not care whether the trigger is available: it is the
    // only clock in this system that runs while the weapon is locked.
    if (this._cooking) {
      this._cookFuse -= dt;
      if (this._cookFuse <= 0) this._cookOff();
    }
    this.thrown.update(dt);

    // ---- spread recovery -------------------------------------------------
    const rest = this._restSpread(def, player, st);
    this._spread = Math.max(rest, this._spread - def.spreadDecay * dt * (1 + this.adsProgress));
    if (this._sinceShot > 0.6) this._shotIndex = 0;

    // ---- gather state ----------------------------------------------------
    const live = !input.frozen && input.enabled !== false && this.debugMode === null;
    // RMB is the heavy attack on a blade and the underhand toss on a grenade,
    // not an aim request; neither weapon has sights to look through.
    st.ads = melee || thrown
      ? false
      : live
        ? input.ads || player?.adsRequested === true
        : this.debugMode === 'ads';
    st.sprint = live ? player?.sprinting === true && this._sinceShot > 0.3 : false;
    st.speed = player?.horizontalSpeed ?? player?.speed ?? 0;
    st.crouch = player?.stance === 'crouch';
    st.airborne = player?.airborne === true;
    st.lowReady = player?.state === 'mantle' || player?.mantling === true;
    st.empty = s.mag === 0 && !s.chambered;

    // ---- input -----------------------------------------------------------
    if (live) {
      if (input.actionPressed('reload')) this.reload();
      if (input.pressed('KeyB')) this.cycleFireMode();
      if (input.pressed('KeyI')) this.inspect();
      /**
       * SLOTS: 1 primary, 2 sidearm, 3 knife, 4 frag — Sudden Attack's own
       * layout.
       *
       * The SMG stays reachable on the mouse wheel, which cycles everything in
       * `weaponIds` order (rifle, smg, pistol, knife, grenade). Tab is NOT
       * touched: it is the scoreboard in this build.
       */
      // Slot 1 is whatever primary the player chose in the menu, not always
      // the M4. @see setPrimary
      if (input.pressed('Digit1')) this.setWeapon(this.primaryId);
      if (input.pressed('Digit2')) this.setWeapon('pistol');
      if (input.pressed('Digit3')) this.setWeapon('knife');
      /** Slot 4: the frag. Empty pouch = an empty hand, so the swap is refused. */
      if (input.pressed('Digit4') && this.grenadeCount > 0) this.setWeapon('grenade');
      if (input.wheel) this.nextWeapon();
      if (!this.locked) {
        if (melee) {
          // LMB quick slash, RMB heavy stab.
          if (input.firePressed) this.meleeAttack('slash');
          else if (input.pressed('Mouse2')) this.meleeAttack('stab');
          st.trigger = false;
        } else if (thrown) {
          /**
           * HOLD TO COOK, RELEASE TO THROW. LMB is the overhand throw and RMB
           * the underhand toss, and the release is read off whichever button
           * started the cook — letting go of the OTHER one mid-throw must not
           * launch anything.
           */
          if (input.firePressed) this.startCook('over');
          else if (input.pressed('Mouse2')) this.startCook('under');
          if (this._cooking) {
            const btn = this._cookStyle === 'under' ? 'Mouse2' : 'Mouse0';
            if (input.released(btn) || !input.held(btn)) this.releaseThrow();
          }
          st.trigger = false;
        } else {
          this._runTrigger(dt, input.fire, input.firePressed, def, s);
          st.trigger = input.fire && this.canFire();
          // Auto-reload on a dry trigger pull, like every modern shooter.
          if (input.firePressed && st.empty) this.reload();
        }
      } else {
        st.trigger = false;
      }
    } else if (this.debugMode) {
      this._runDebug(ctx);
      st.trigger = this._sinceShot < 0.09;
    }

    // Push the ADS curve to the player so camera FOV / move speed follow it.
    player?.setAdsProgress?.(this.viewmodel.adsT);

    this.stats.live = this.sim.stats.live;
    this.stats.fired = this.sim.stats.fired;
  }

  /** Fire-mode state machine. */
  _runTrigger(dt, held, pressed, def, s) {
    switch (s.mode) {
      case 'auto':
        if (held) this.tryFire();
        break;
      case 'burst':
        if (pressed && this._burstLeft === 0 && this._burstCooldown <= 0) {
          this._burstLeft = def.burstCount;
        }
        if (this._burstLeft > 0 && this._fireTimer <= 0) {
          if (this.tryFire()) {
            this._burstLeft--;
            this._fireTimer = 60 / def.burstRpm;
            if (this._burstLeft === 0) this._burstCooldown = def.burstDelay;
          } else {
            this._burstLeft = 0;
          }
        }
        break;
      default: // semi
        if (pressed) this.tryFire();
        break;
    }
  }

  _restSpread(def, player, st) {
    let base = lerp(def.spreadHip, def.spreadAds, this.adsProgress);
    if (st.crouch) base *= SPREAD_MODS.crouch;
    if (player?.stance === 'prone') base *= SPREAD_MODS.prone;
    if (st.speed < 0.4) base *= SPREAD_MODS.still;
    else if (st.speed > 3.2) base *= SPREAD_MODS.walking;
    if (st.sprint) base *= SPREAD_MODS.sprinting;
    if (st.airborne) base *= SPREAD_MODS.airborne;
    return base;
  }

  lateUpdate(dt, ctx) {
    const vm = this.viewmodel;
    if (!vm) return;
    vm.update(dt, this._state);

    // ---- muzzle flash / audio, now that the pose is final ---------------
    if (this._pendingShots > 0) {
      const def = this.current;
      vm.muzzleWorld(this._firePayload.origin);
      vm.boreDir(this._firePayload.dir);
      this._firePayload.weapon = def;
      this._firePayload.seed = this._fireSeed >>> 0;
      for (let i = 0; i < this._pendingShots; i++) {
        ctx.events.emit('weapon:fire', this._firePayload);
      }
      this._pendingShots = 0;
      this._pendingFirst = false;
    }

    // ---- deferred bolt throw (manual actions only) ----------------------
    if (this._boltTimer >= 0) {
      this._boltTimer -= dt;
      if (this._boltTimer <= 0) {
        this._boltTimer = -1;
        this._boltPayload.weapon = this.current;
        ctx.events.emit('weapon:bolt', this._boltPayload);
      }
    }

    // ---- deferred shell ejection ---------------------------------------
    for (const q of this._shellQueue) {
      if (q.t < 0) continue;
      q.t -= dt;
      if (q.t > 0) continue;
      q.t = -1;
      vm.ejectWorld(this._shellPayload.position);
      vm.ejectVelocity(this._shellPayload.velocity, 2.3 + this.rng.float() * 1.2);
      const pv = this.player?.velocity;
      if (pv) this._shellPayload.velocity.add(pv);
      this._shellPayload.velocity.y += 1.1;
      this._shellPayload.weapon = this.current;
      const shell = vm.active?.shell;
      this._shellPayload.caseLen = shell?.caseLen ?? 0.0446;
      this._shellPayload.caseRadius = shell?.rimR ?? 0.00495;
      this._shellPayload.spin = 28 + this.rng.float() * 34;
      ctx.events.emit('weapon:shell', this._shellPayload);
    }

    // ---- retire dropped magazines --------------------------------------
    if (this._droppedMags.length) {
      const now = ctx.time.elapsed;
      for (const p of this._droppedMags) {
        if (p.group.visible && p.until && now > p.until) {
          p.group.visible = false;
          if (p.body && this.physics?.removeRigidBody) {
            this.physics.removeRigidBody(p.body);
            p.body = null;
          }
        }
      }
    }
  }

  /* ====================================================================== */
  /*  capture harness                                                       */
  /* ====================================================================== */

  /**
   * Freeze the viewmodel in a photogenic state.
   * The harness applies a shot, then pumps `SETTLE` frames before grabbing the
   * frame, so 'fire' schedules a short burst that peaks right at the capture.
   */
  debugPose(kind = 'idle', opts = {}) {
    const vm = this.viewmodel;
    this.debugMode = kind;
    /**
     * `opts.weapon`, because this used to be a hardcoded 'rifle' and it silently
     * invalidated capture work: a "pistol ADS" grab taken through this function
     * was a photograph of the carbine. The default stays 'rifle' so the existing
     * shot harness is unchanged.
     */
    this.setWeaponImmediate(opts.weapon ?? 'rifle');
    vm.stopClip();
    vm.recPos.reset();
    vm.recRot.reset();
    vm.settle.reset();
    vm.lag.reset();
    vm.lagRot.reset();
    vm.boltHold = 0;
    vm.boltCycle = 0;
    vm.sprintT = 0;
    vm.lowReadyT = 0;
    vm.bobPhase = 0;
    vm._angVel.yaw = 0;
    vm._angVel.pitch = 0;
    vm._hasPrev = false;
    // A fixed, non-zero noise phase: a settled but not artificially symmetric pose.
    vm.noiseT = 12.37;
    vm.debugFrozen = true;
    this._spread = kind === 'ads' ? 0.24 : 2.05;
    this._sinceShot = 10;
    this._debugFrame = 0;

    const s = this.state;
    if (s?.def.class === 'grenade') {
      // A full pouch and a pin still in it: the pose harness photographs the
      // weapon as it is carried, and `magSize` does not exist on this def.
      s.mag = s.def.count;
      s.chambered = false;
      s.reserve = 0;
      this._cooking = false;
      this._throwing = false;
      if (vm.active) {
        vm.active.group.visible = true;
        if (vm.active.parts.pin) vm.active.parts.pin.visible = true;
      }
    } else if (s) {
      s.mag = kind === 'fire' ? 22 : s.def.magSize;
      s.chambered = true;
      s.reserve = s.def.reserve;
    }

    if (kind === 'ads') {
      vm.adsT = 1;
      this._state.ads = true;
    } else {
      vm.adsT = 0;
      this._state.ads = false;
    }
    this._state.sprint = false;
    this._state.speed = 0;
    this._state.trigger = false;
    // Frames (at the harness's fixed 60 Hz) on which to fire for the 'fire'
    // shot. The burst has to land at the END of the harness's settle window: a
    // flash core lives 52 ms (~3 frames), so the last rounds must leave the
    // barrel a frame or two before the grab or there is nothing to photograph.
    // `grabFrame` is how many frames the harness will pump — it is a CLI flag
    // (`--settle`), so it cannot be hard-coded here. The offsets below straddle
    // the grab because the harness pumps on its own rAF chain, which can land a
    // frame either side of the engine's.
    // A flash core lives 52 ms — about three frames at 60 Hz — while the exact
    // frame the shutter lands on is only known to within a handful of frames
    // (the harness pumps its settle count on its own rAF chain, then the
    // screenshot RPC costs a few more). So: three spaced rounds early to fill
    // the frame with drifting smoke, brass in flight and a tracer, then a
    // sustained tail on a 2-frame cadence, so a flash is lit continuously
    // across the whole uncertainty window.
    //
    // The cadence was 3 frames, which is the flash core's own lifetime rounded
    // UP: measured across settle 86/88/90/92/94, frame 90 landed in the trough
    // between two cores and photographed a dying flash (10k hot pixels against
    // 26-29k on either side). Two frames guarantees overlap.
    if (kind === 'fire') {
      const grab = Math.round(opts?.grabFrame ?? 90);
      const frames = [grab - 26, grab - 19, grab - 12];
      for (let f = grab - 6; f <= grab + 18; f += 2) frames.push(f);
      this._scriptFrames = frames.filter((f) => f >= 2);
    } else {
      this._scriptFrames = null;
    }
    return kind;
  }

  /** Swap without the draw animation (harness + debug only). */
  setWeaponImmediate(id) {
    if (!this.states.has(id)) return false;
    this._switchTo = null;
    this.activeId = id;
    this.viewmodel.setActive(id);
    return true;
  }

  _runDebug(ctx) {
    this._debugFrame = (this._debugFrame ?? 0) + 1;
    const frames = this._scriptFrames;
    if (!frames) return;
    for (const f of frames) {
      if (f === this._debugFrame) {
        this._fireTimer = 0;
        this.tryFire();
      }
    }
  }

  /* ====================================================================== */

  resize() {}

  dispose() {
    for (const off of this._off ?? []) off();
    this.sim?.clear();
    this.thrown?.dispose();
    for (const p of this._droppedMags) {
      p.group.removeFromParent();
      if (p.body && this.physics?.removeRigidBody) this.physics.removeRigidBody(p.body);
    }
    this._droppedMags.length = 0;
    this.viewmodel?.dispose();
    this.mats?.dispose();
  }
}
