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
import { NavGrid, CoverMap } from './nav.js';
import { Agent, STATE, drawPersona, ARMOUR_FRAG_MIN, ARMOUR_FRAG_MAX } from './agent.js';
import { Squad } from './squad.js';
import { Radio } from './radio.js';
import { GroundShadows } from './grounding.js';

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
 * A MAN IN YOUR FACE BEATS A TANK DOWN THE STREET. `pickVisibleHostile` takes
 * the nearest thing it can see; scaling a hull's distance up by this makes the
 * armour lose every tie and win only when it is genuinely the nearer problem —
 * a hull at 20 m beats a rifleman at 27 m, and does not beat one at 25 m.
 */
const ARMOUR_BIAS = 1.35;

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
      camo: ['arid', 'woodland', 'urban'],
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
     *       yaw:number }               // its heading — @see `armourWorth`
     *
     * `match` owns the roster, so it hands the LIVE ARRAY over once
     * (`this.ai.vehicles = this.tank.tanks`) and every entry's `alive` flag does
     * the rest: a parked hull is `alive:false` and is simply not in the list.
     * Nothing here is allocated per frame and nothing here reaches into `match`.
     */
    this.vehicles = null;
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
    return out.set(p.x, p.y + actor.eyeHeight - 0.22, p.z);
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
   * @returns 0 ignore it · 1 shoot it (the deck is there) · 2 frag it
   */
  armourWorth(agent, v) {
    if (!agent || !v || v.alive !== true) return 0;
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
    const cur = agent.targetActor;
    if (cur && cur.alive !== false && cur.dead !== true && this.targetable(cur) &&
        this.isHostile(agent, cur)) {
      const d = this._sightTo(agent, cur, eye, fx, fz, cone);
      if (d >= 0 && (cur.isVehicle !== true || this.armourWorth(agent, cur) > 0)) {
        best = cur;
        bestScore = cur.isVehicle === true ? d * ARMOUR_BIAS : d;
      }
    }
    let checks = 0;
    for (let k = 0; k < n && checks < 2; k++) {
      const t = list[(agent._scanCursor + k) % n];
      if (t === cur) continue;
      checks++;
      // The armour test is arithmetic and the sight test is a ray, so the cheap
      // one goes first: a hull nobody has a shot on costs no line of sight.
      if (t.isVehicle === true && this.armourWorth(agent, t) <= 0) continue;
      const d = this._sightTo(agent, t, eye, fx, fz, cone);
      if (d < 0) continue;
      const score = t.isVehicle === true ? d * ARMOUR_BIAS : d;
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
    if ((dx * inv) * fx + (dz * inv) * fz <= cone && dist > 4.5) return -1;
    if (this.phys && !this.phys.lineOfSight(eye, p, this.phys.MASK.SIGHT)) return -1;
    return dist;
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
    if (!agent.name || agent.name.startsWith('BOT-')) {
      return drawPersona(rng, agent.role, mean, this.defenderSkill);
    }
    const key = `${agent.team}:${agent.name}:${agent.role}`;
    let p = this._personas.get(key);
    if (!p) {
      p = drawPersona(rng, agent.role, mean, this.defenderSkill);
      this._personas.set(key, p);
    }
    return p;
  }

  spawn(variantName, position, yaw = 0, opts = {}) {
    const a = new Agent(this, { variant: variantName, position, yaw, ...opts });
    this.agents.push(a);
    this._noteVariantTeam(a.variantName, a.team);
    return a;
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

  throwGrenade(agent, from, target) {
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
    this._grenades.push({ body, mesh, fuse: 2.35, agent });
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
