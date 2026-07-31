import * as THREE from 'three';
import { Assembler } from './builder.js';
import { BUILDINGS, STREET, SET_PIECES, GATE, SCALE, RELIEF, ALLEYS, SITEWORKS, FLAT, CATHEDRAL } from './layout.js';
import { buildCathedral } from './cathedral.js';
import { buildGround } from './ground.js';
import { buildBuilding, collapseRoof } from './buildings.js';
import { buildRelief } from './relief.js';
import { buildCordon } from './cordon.js';
import { buildFeatures } from './features.js';
import { buildLinks } from './links.js';
import { buildSiteWorks } from './sitework.js';
import { planDemolitions, buildRuins, publishDemolitions } from './demolition.js';
import { registerProps } from './props.js';
import {
  registerDressingProps,
  dressStreet,
  dressBuildings,
  scatterDebris,
  buildGate,
  buildPerimeter,
  groundY,
  isOpen,
  setDoorways,
} from './dressing.js';

/**
 * WORLD — level geometry, the modular building kit, props, set dressing and
 * static collision.
 *
 * A ~120 x 120 m Middle-Eastern market street: one main street with a plaza,
 * flanking alleys, eighteen buildings (three of them enterable and furnished
 * across multiple floors), an arched gate closing the vista, and several
 * thousand props. Nothing is loaded from disk — every vertex is generated here.
 *
 * HOW IT FITS TOGETHER
 *   layout.js     the map: footprints, facade programmes, set-piece positions
 *   util.js       geometry toolkit (chamfered boxes, wall panels with real
 *                 holes, cloth grids, catenary tubes, rocks) + vertex masks
 *   kit.js        the modular building kit (facades, windows, doors, balconies,
 *                 stairs, awnings, parapets, drainpipes, damage)
 *   buildings.js  assembles a building from a footprint + a facade programme
 *   interiors.js  furnishes rooms so an interior screenshot is worth taking
 *   props.js      the instanced prop library
 *   dressing.js   places the hundreds of props, cables, laundry and debris
 *   ground.js     terrain, road camber, kerbs, pavement slabs, sand drifts
 *   builder.js    the Assembler: merges statics, batches instances, authors
 *                 collision proxies, bakes the level->world transform
 *
 * PUBLIC API — `const world = ctx.get('world')`
 *   world.root                THREE.Group holding everything
 *   world.bounds              THREE.Box3 of the playable area, world space
 *   world.spawnPoints         [{ position:Vector3, yaw:number, tag:string }]
 *   world.levelYaw            the level->world yaw, for gameplay-authored facings
 *   world.spawn(i)            one of the above
 *   world.groundHeight(x, z)  cheap analytic floor height (physics is exact)
 *   world.isOpen(x, z)        true where a character can stand outdoors
 *   world.stats               { staticTris, instTris, instances, drawCalls }
 *   world.features            the authored REASONS to go indoors and upstairs:
 *                             [{ id, kind:'ammo'|'weapon'|'grenade'|'vantage',
 *                                building, floor:0..2|'roof', indoor,
 *                                botReachable, position:Vector3, level, yaw }].
 *                             `world` gives nothing away — `match` binds the
 *                             pickup, `ai` binds the interest. See features.js.
 *   world.links               the rooftop gangways: [{ id, from, to, a, b,
 *                             width, span, fall }] in world space. See links.js.
 *   world.demolitions         the buildings that carry a CACHED DESTROYED STATE:
 *                             [{ id, name, zone, opens, position, radius, top,
 *                                halfW, halfD, level, navRect, mass, surfaces,
 *                                tint, down, setVisual(d), setCollision(d),
 *                                setDown(d) }]. Both forms are built at boot and
 *                             live in the merged batches; bringing one down is
 *                             two index-range fills and two mask fills. See
 *                             `world.demolish` and src/world/demolition.js.
 *   world.demolish(id, down)  swap one building for its ruin, or back
 *   world.demolishAll(down)   …all of them. The round reset, and `?demo=down`.
 *   world.interiorVolumes     the GROUND FLOOR of every enterable building, as
 *                             an oriented box the bot height field can re-sample
 *                             itself against: [{ building, cx, cz, c, s, hw, hd,
 *                             floorY, probeY }]. See `_interiorVolumes()`.
 *   world.prewarmMaterials()  compile every shader permutation the world can
 *                             produce, before the frame loop starts. Awaitable.
 *                             Call it from src/core/prewarm.js — see the method.
 *   world.levelToWorld(x,y,z,out) / world.worldToLevel(x,y,z,out)
 */

/**
 * LEVEL -> WORLD. The street is authored down -Z; this yaw puts it on the axis
 * the canonical hero/sunset cameras look along, with the market in the near
 * third of the frame and the gate closing the far end.
 */
const LEVEL_YAW = 0.5877;
const LEVEL_TX = 0.9;
const LEVEL_TZ = 1.34;

/**
 * How many zero-intensity "ballast" point lights the world parks in the scene to
 * hold `numPointLights` — and therefore the shader permutation — constant. See
 * `_addBallast()`. Must be at least the worst-case number of practicals that can
 * be in range at once: a sweep of the whole playable area at three eye heights
 * puts that at 10 for the world's own lights, plus whatever `fx` keeps live.
 */
const LIGHT_SLOTS = 20;

/**
 * Spawn points in LEVEL space: [x, z, yaw, tag].
 *
 * These are the DEV/free-roam spawns, not the match's — but they are also the
 * only seeds `tools/boundcheck.mjs` floods from, so every reachable pocket of
 * the map has to be connected to one of them or that gate simply never looks at
 * it. Both base districts, the cathedral and the two new plazas are on the list
 * for that reason as much as for the camera's.
 *
 * Authored in WIDENED level space — the mid street's kerb is at x ∓15.5 now, so
 * a point at x ∓26 is in a lane rather than against a shopfront. @see `widenX`.
 */
/**
 * THE TWO NEW CORNER DISTRICTS ARE ON THIS LIST, AND THEY HAVE TO BE.
 *
 * `boundcheck` floods from these points and nothing else, so a district that is
 * not connected to one of them is ground the boundary gate never looks at — the
 * exact blind spot that let 5 645 m² of bare sand survive until `cordon.js` was
 * written. Zone A's and zone B's yards are 2 300 m² of brand new authored ground
 * each; they get a seed apiece, and the two flank beacon squares are covered by
 * the courtyard/lane seeds that were already here.
 */
const SPAWNS = [
  [0.4, 28.5, Math.PI, 'north cross'],
  [-2.4, 60.0, Math.PI, 'attack pocket'],
  [0.0, 47.0, Math.PI, 'north plaza'],
  [-38.0, 51.0, -Math.PI / 2, 'the north-west yard'],
  [-46.0, 34.0, Math.PI, 'north-west throat'],
  /**
   * THE TWO NEW CITIES, and they are on this list for the same reason the corner
   * districts are: `boundcheck` floods from these seeds and nothing else, so an
   * avenue that is not connected to one of them is 1 500 m² of brand new ground
   * the boundary gate never looks at. One seed at each capture point and one at
   * each avenue's far end, so the flood has to cross both cross-street mouths.
   * @see `THE MAP GROWS — PART 6` in layout.js.
   */
  [-76.5, 46.0, Math.PI, 'zone A — the west city'],
  [-76.5, 18.0, 0, 'the west avenue, south end'],
  [76.5, -48.0, 0, 'zone B — the east city'],
  [76.5, -20.0, Math.PI, 'the east avenue, north end'],
  [3.6, 18.0, Math.PI, 'mid street'],
  [0.0, -1.0, Math.PI, 'the cathedral crossing'],
  [-3.4, -12.5, 0, 'mid south'],
  [2.6, -30.0, 0, 'south cross'],
  [0.0, -49.0, 0, 'south plaza'],
  [38.0, -53.0, Math.PI / 2, 'zone B — south-east district'],
  [46.0, -36.0, 0, 'south-east throat'],
  [-1.0, -62.0, 0, 'defend pocket'],
  [35.0, -4.0, -Math.PI / 2, 'east courtyard'],
  [-35.0, -4.0, Math.PI / 2, 'zone C — west courtyard'],
];

export class WorldSystem {
  static id = 'world';
  static deps = ['materials', 'physics'];

  async init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    const rng = this.rng;
    const materials = ctx.get('materials');
    const physics = ctx.peek('physics');
    const render = ctx.peek('render');

    this.root = new THREE.Group();
    this.root.name = 'world';
    this.root.matrixAutoUpdate = false;
    ctx.scene.add(this.root);

    // Weathering in the shared materials keys off the ground plane.
    materials.setGroundLevel?.(0);

    const t0 = performance.now();
    const A = new Assembler({ materials, rng, render });
    this.A = A;
    A.setTransform(LEVEL_YAW, LEVEL_TX, LEVEL_TZ);

    // 1. prototypes first: the level references them by id while it builds
    registerProps(A, rng);
    registerDressingProps(A, rng);

    // 2. ground, then the shells, then what people put in and on them
    buildGround(A, rng);

    /**
     * THE BUILDINGS THAT CAN COME DOWN, decided before the first wall goes up.
     * @see src/world/demolition.js. Opening a scope round `buildBuilding` costs
     * nothing and changes nothing — it only records WHERE in the merged batches
     * this building's triangles, instances and collision ended up, so that they
     * can all stop existing together later. No rng is drawn here, so the set
     * dressing of the whole map is bit-identical with the feature off.
     */
    const demoPlan = planDemolitions(BUILDINGS);
    const demoOf = new Map(demoPlan.map((d) => [d.id, d]));

    const infos = [];
    for (const spec of BUILDINGS) {
      const demo = demoOf.get(spec.id);
      if (demo) demo.shell = A.beginScope(`shell:${spec.id}`);
      const info = buildBuilding(A, rng, spec);
      if (demo) {
        A.endScope();
        demo.info = info;
      }
      infos.push(info);
      if (spec.collapse) {
        collapseRoof(A, rng, spec, info, {
          x: spec.x + rng.range(-2, 2),
          z: spec.z + rng.range(-2, 2),
        });
      }
    }
    this.buildings = infos;
    // The doors are cut; keep every prop with a collision proxy off their
    // approaches before a single one is placed. See `setDoorways`.
    setDoorways(infos, BUILDINGS);

    buildGate(A, rng);
    buildPerimeter(A, rng);
    /**
     * THE CORDON — the six holes the play area leaked out of, closed. It runs
     * after `buildPerimeter` and draws from its OWN rng stream, so it cannot
     * shift a single prop, stain or pock the dressing pass places below. See
     * `src/world/cordon.js`; `tools/boundcheck.mjs` is the gate.
     */
    this.cordon = buildCordon(A);
    // Height goes in BEFORE the dressing, because `groundY` reads it and every
    // scattered prop, stain and skirt is placed off `groundY`.
    buildRelief(A, rng);
    // …and the site works with it, for the same reason: `isOpen` consults
    // `inSitework` before the dressing pass drops anything, so a crate cannot be
    // scattered inside a pier.
    buildSiteWorks(A, rng);
    /**
     * THE CATHEDRAL, and it is built here for two ordering reasons rather than
     * one. It has to be up before the dressing pass, because `dressing.isOpen`
     * consults `inCathedral` and a stall pitched in the chancel is the same bug
     * as one pitched inside a pier; and it has to be up before `A.finalize`,
     * because its floor, its walls and its dome are collision the nav grid is
     * built from. It draws from its OWN fixed-seed rng stream — see the note at
     * the top of the module — so it cannot move a single prop placed below.
     */
    this.cathedral = buildCathedral(A);
    dressStreet(A, rng);
    /**
     * THE DRESSING GOES DOWN WITH THE BUILDING IT IS BOLTED TO.
     *
     * `dressBuildings` is one loop over every building, so there is no lexical
     * bracket to put round one of them — and without this a demolished block
     * leaves its satellite dishes, water tanks, AC units, conduit and washing
     * lines hanging in the air ten metres up. `A.claim` arms a SPATIAL claim
     * instead: anything the dressing pass writes inside one of these footprints
     * and above its plinth is filed under that building's shell scope. Disarmed
     * immediately after, so `scatterDebris` — which scatters onto the STREET —
     * is untouched. @see `claimZones` in builder.js.
     */
    for (const d of demoPlan) {
      if (!d.shell) continue;
      A.claim(d.shell, d.spec.x - d.spec.w / 2 - 1.2, d.spec.z - d.spec.d / 2 - 1.2,
        d.spec.x + d.spec.w / 2 + 1.2, d.spec.z + d.spec.d / 2 + 1.2, 0.45);
    }
    dressBuildings(A, rng, infos);
    A.disarmClaims();
    scatterDebris(A, rng);
    /**
     * …and the destroyed state itself, built into the same merged batches and
     * switched off at the end of `init`. It draws from its own fixed-seed stream
     * per building, so it cannot move a prop the dressing has already placed.
     */
    buildRuins(A, demoPlan);

    /**
     * WHY YOU WOULD EVER GO IN, AND WHY YOU WOULD EVER GO UP.
     *
     * Both of these run LAST and on their own rng streams, so neither can move a
     * prop the dressing has already placed:
     *
     *   `features` — 22 caches, one per level of every enterable building and one
     *     on every reachable roof. Published as `world.features` for `match`/`ai`
     *     to bind pickups to; the world only guarantees the place exists, is
     *     reachable, is marked and looks deliberate. See src/world/features.js.
     *   `links` — the four rooftop gangways that turn six separate roofs into two
     *     continuous upper routes. Their decks are `LAYER.CLIP`, so the four
     *     connectors they cross are still open ground to the bot height field.
     *     See src/world/links.js.
     */
    this.features = buildFeatures(A, infos);
    this.links = buildLinks(A, infos);
    this.interiorVolumes = this._interiorVolumes(infos);

    this._addLights(A);

    A.finalize(this.root, physics);
    A.releaseCache();

    /**
     * THE DESTROYED STATES, PUBLISHED. Every ruin is hidden and intangible from
     * here; `src/match/airstrike.js` re-probes the nav cells each one covers at
     * boot and owns the event that brings them down. @see `world.demolitions`.
     */
    this.demolitions = publishDemolitions(A, demoPlan, physics, this.root);
    this._demoDown = false;

    // -------------------------------------------------------------- queries --
    this._v = new THREE.Vector3();
    this._inv = new THREE.Matrix4().copy(A.xform).invert();
    /** The level->world yaw, so gameplay can author facings in level space. */
    this.levelYaw = LEVEL_YAW;
    this.spawnPoints = SPAWNS.map(([x, z, yaw, tag]) => ({
      position: A.toWorld(x * SCALE, 0, z * SCALE),
      yaw: yaw + LEVEL_YAW,
      tag,
    }));
    /**
     * The published feature list gets its WORLD position here, where the
     * transform exists. `level` is kept beside it because every tool in
     * `tools/` authors and reports in level space.
     */
    for (const f of this.features) {
      f.position = A.toWorld(f.level.x, f.level.y, f.level.z);
      f.yaw += LEVEL_YAW;
    }
    for (const l of this.links) {
      l.a = A.toWorld(l.x, l.y0, l.z0);
      l.b = A.toWorld(l.x, l.y1, l.z1);
    }
    /**
     * The playable box. `src/ai/index.js` builds its nav grid straight off
     * this, so it is also the nav grid's extent and therefore its memory and
     * its boot cost: 1.5x here is 2.25x the cells. Left at ±62 while the map
     * went to 1.5x, everything outside 62 m would simply have no nav in it and
     * both spawns would sit off the edge of the grid.
     */
    /**
     * 62 -> 86 AUTHORED UNITS, and this is the single most expensive line in
     * the growth pass. The street now runs level z -80..70 and `buildCordon`
     * closes it at ∓83.7, so a box at ±62 would leave both base districts —
     * both SPAWNS — off the edge of the nav grid entirely. Sized to the
     * cordon, plus a metre: 86 * 1.5 = 129 m.
     *
     * WHAT IT COSTS, measured: the grid goes 328x329 (108k cells, 518 ms) to
     * 448x448 (~200k cells), i.e. 1.86x the cells, the rays and the memory.
     * `NavGrid`'s open list is `Math.min(n, 1 << 18)` and therefore sized to the
     * grid on its own, but A*'s `maxNodes` default of 24000 is NOT — it is a
     * fixed cap, and an overflowing search reports "no route" silently rather
     * than loudly. `navcheck` is the gate that would see it.
     */
    const HB = 86 * SCALE;
    this.bounds = new THREE.Box3(
      new THREE.Vector3(-HB, -2, -HB),
      new THREE.Vector3(HB, 26, HB)
    ).applyMatrix4(A.xform);
    this.stats = A.stats;
    /**
     * The authored layout, exposed for TOOLS only — nothing in the engine reads
     * it back through here. `tools/indoorcheck.mjs` needs the footprints of the
     * `enterable` buildings so it can walk the real player capsule at each one
     * and prove you can actually get inside; `navcheck` cannot tell, because it
     * tests the BOT height field and that has no opinion about whether a doorway
     * fits the player or whether a prop was dressed across it.
     *
     * `RELIEF` and `ALLEYS` are here for `tools/sitecheck.mjs`: it has to know
     * where the authored overwatch decks are in order to say whether they see
     * the plant spot, and where each courtyard's rect is in order to find that
     * courtyard's entry mouths by walking its boundary.
     *
     * `SITEWORKS` and `FLAT` are here for `tools/boundcheck.mjs`, which has to
     * know what the level ACTUALLY AUTHORED in order to say whether a piece of
     * ground the player can walk to has anything on it — the site works are
     * most of the mass in both courtyards, and `FLAT` is the flattened play box
     * itself.
     */
    this.layout = { BUILDINGS, STREET, SET_PIECES, GATE, SCALE, RELIEF, ALLEYS, SITEWORKS, FLAT, CATHEDRAL };

    const ms = performance.now() - t0;
    console.info(
      `[world] built in ${ms.toFixed(0)}ms — ${(A.stats.staticTris / 1000).toFixed(0)}k static tris, ` +
        `${(A.stats.instTris / 1000).toFixed(0)}k instanced tris in ${A.stats.instances} instances, ` +
        `${A.stats.drawCalls} draw calls, ${(A.stats.collideTris / 1000).toFixed(1)}k collision tris`
    );
  }

  /**
   * ────────────────────────────────────────────────────────────────────────────
   * THE GROUND FLOORS, PUBLISHED AS SOMETHING THE BOT GRID CAN SAMPLE
   * ────────────────────────────────────────────────────────────────────────────
   * "もっと屋内戦闘をさせたいので屋内のエリアを作ってそこにもAIがいく利点やメリットを与えて
   *  でないとAIが屋内戦闘しない"
   *
   * `src/ai/nav.js` is a 2.5D height field: ONE floor per (x, z) cell, found by
   * dropping a single ray from above the level. Inside a footprint that ray can
   * only ever hit the ROOF, so — measured, `_navin.mjs` — every one of the 3353
   * walkable cells inside the eight enterable buildings was at 3.2 / 6.5 / 9.6 m
   * and ZERO were at ground level. No bot on this map could be indoors, every
   * "give the AI a reason to go in" feature was dead on arrival, and the one that
   * was built measured bot-time-indoors at 0.00 %.
   *
   * This is `world`'s half of the fix. It publishes each enterable building's
   * GROUND STOREY as an oriented box with the height to re-probe from, and `ai`
   * re-samples those cells from INSIDE the building — under the roof, under every
   * upper slab — so the storey the player has always been able to walk into
   * appears in the height field too. `world` changes NO geometry and NO collision
   * to do it: the roof is still a roof, an upper floor still stops a bullet, and
   * nothing here is on `LAYER.CLIP`. It is a statement about where the map's
   * interiors are, which is exactly the kind of thing `world` is allowed to know
   * and `ai` is not.
   *
   *   cx, cz    the footprint centre in WORLD space
   *   c, s      cos/sin of the level yaw, so a consumer can put a world point
   *             back on the building's own axes without knowing the transform
   *   hw, hd    half extents along those axes — the OUTER footprint, walls
   *             included, because the doorway a bot enters through is in the wall
   *   floorY    the walking surface of the ground storey
   *   probeY    where a downward ray must START to find that floor: above the
   *             tallest thing worth standing on, BELOW the head of a 2.16 m
   *             doorway (or the threshold cells sample the lintel and the storey
   *             is an island), and far below the ceiling.
   */
  _interiorVolumes(infos) {
    const c = Math.cos(LEVEL_YAW);
    const s = Math.sin(LEVEL_YAW);
    const out = [];
    /**
     * THE CATHEDRAL GOES ON THIS LIST FIRST, AND IF IT DID NOT THE WHOLE MIDDLE
     * OF THE MAP WOULD BE A ROOM NO BOT COULD ENTER.
     *
     * It is not in `BUILDINGS` (see `CATHEDRAL` in layout.js for why), so the
     * loop below cannot find it — but it is the biggest interior on the map by
     * a factor of four and it has a CAPTURE POINT in the middle of it. Same
     * shape of record as every other one: an oriented box on the level's own
     * axes, the outer footprint (walls included, because the doorway a bot walks
     * through is in the wall), and the height a downward ray must start at to
     * find the floor rather than the vault.
     */
    if (this.cathedral) {
      const k = this.cathedral;
      const p = this.A.toWorld(k.cx, 0, k.cz, new THREE.Vector3());
      out.push({
        building: k.id,
        cx: p.x, cz: p.z, c, s,
        hw: k.hw, hd: k.hd,
        floorY: k.floorY,
        probeY: k.probeY,
      });
    }
    for (const info of infos) {
      const spec = info.spec;
      if (!spec.enterable) continue;
      const p = this.A.toWorld(spec.x, 0, spec.z, new THREE.Vector3());
      /** The interior slab tops out 0.14 above the storey's own datum. */
      const floorY = (info.floorY?.[0] ?? 0) + 0.14;
      /**
       * The underside of whatever is over the ground storey — the first floor's
       * slab and its exposed joists, or the roof slab in a single-storey block.
       */
      const ceil = (info.floorY?.[1] ?? info.roofY) - 0.44;
      out.push({
        building: spec.id,
        cx: p.x, cz: p.z, c, s,
        hw: spec.w / 2, hd: spec.d / 2,
        floorY,
        probeY: Math.min(floorY + 1.56, ceil),
      });
    }
    return out;
  }

  // ----------------------------------------------------------------- lights --
  /**
   * Punctual lights the world owns: the bare bulbs inside the enterable
   * buildings (what makes an interior read as lived-in against cool skylight)
   * and the street lamps, which only draw power after dusk.
   */
  _addLights(A) {
    this.bulbs = [];
    this.lamps = [];

    for (const b of A.interiorLights.slice(0, 20)) {
      // A bare 60 W bulb in an unlit room: the only thing separating an interior
      // from a black hole, so it has to actually carry the room.
      // Intensity is re-driven every update() off the solar altitude; this is
      // the daylight value so a frame captured before the first update is right.
      const l = new THREE.PointLight(0xffc07a, 5, 13, 2);
      l.position.set(b.x, b.y, b.z);
      l.castShadow = false;
      A.light(l, { range: 13, priority: 2 });
      this.bulbs.push(l);
    }

    for (const p of A.lampAnchors) {
      const l = new THREE.PointLight(0xffb765, 0, 22, 2);
      l.position.set(p.x, p.y - 0.12, p.z);
      l.castShadow = false;
      A.light(l, { range: 22, priority: 3 });
      this.lamps.push(l);
    }
    this.lampLens = A.mat('lamp_lens');
    this._lampMix = -1;

    this._addBallast();
  }

  /**
   * BALLAST — hold the scene's point-light COUNT constant.
   *
   * MEASURED, not guessed. The single worst source of stalls in this build was
   * not geometry: it was shader compilation triggered by the world's own
   * practicals. `render` distance-culls every registered punctual light
   * (`light.visible = fade > 0.002`), and Three bakes the number of *visible*
   * point lights into the program cache key. The world owns 17 practicals (12
   * interior bulbs at 13 m, 5 street lamps at 22 m), so walking down the street
   * sweeps the visible count through 9-8-7-6-5-4 — and every single step
   * recompiles EVERY lit material in the frame:
   *
   *   f15 +36 programs  636 ms   f32 +35  702 ms   f41 +35  699 ms
   *   f51 +35 programs  678 ms   f99 +33  698 ms
   *   → 186 programs and ~3.5 s of stalls inside 900 frames of play
   *
   * Pre-compiling every count instead costs 9.5 s of boot (measured: 595
   * programs for counts 0-16), which is the wrong trade. Holding the count
   * still costs nothing.
   *
   * These lights are black (`color 0x000000`, `intensity 0`) with a 1 cm range,
   * parked under the map, and are NOT registered with `render.addLight`, so
   * nothing culls or re-lights them. A point light whose colour times intensity
   * is exactly 0 contributes `0.0` to irradiance — not "almost nothing", but a
   * float zero that is added to the accumulator — so this cannot move a pixel
   * no matter how many slots are lit. It only changes `numPointLights`, which
   * is a shader-permutation input and nothing else.
   *
   * Cost of the padding, measured over 3 paired runs at 1512x982 DPR 2 with 20
   * ballast slots live: p05 frame time 15.7 ms -> 14.4 ms (i.e. inside noise).
   */
  _addBallast() {
    this._ballast = [];
    for (let i = 0; i < LIGHT_SLOTS + 4; i++) {
      const l = new THREE.PointLight(0x000000, 0, 0.01, 2);
      l.name = `world_light_ballast_${i}`;
      l.castShadow = false;
      l.visible = false;
      l.userData.owBallast = true;
      // Far under the terrain, so even the distance-attenuation term is 0.
      l.position.set(0, -1000, 0);
      this.root.add(l);
      this._ballast.push(l);
    }
    /** Point lights in the scene that are NOT ballast; refreshed periodically. */
    this._pointLights = [];
    this._pointLightsFrame = -1e9;
    this._lightTarget = LIGHT_SLOTS;
    this._lightRanges = new Map(); // light -> the cull radius `render` gave it
    this._camPos = new THREE.Vector3();
    this._collectPointLight = (o) => {
      if (o.isPointLight === true && o.userData.owBallast !== true) this._pointLights.push(o);
    };
  }

  /**
   * Top the visible point-light count up to a fixed target. Runs in lateUpdate,
   * after every subsystem has finished moving lights and the camera, and before
   * `render` draws — so the count Three sees is the same every frame.
   *
   * The count has to be PREDICTED rather than read off `light.visible`, because
   * `render._cullLights()` runs inside `render.render()` — i.e. after this. Using
   * last frame's flags is right on 99% of frames and off by one on exactly the
   * frames where a light crosses its cull radius, which are exactly the frames
   * that used to stall. So mirror the renderer's own test here. Getting the
   * prediction wrong can only cost a permutation, never a pixel: the ballast
   * lights are black, and a black light is a no-op however many are lit.
   */
  _stabiliseLightCount(ctx) {
    const list = this._pointLights;
    if (!list) return;
    const render = this._render ?? (this._render = ctx.peek('render'));
    // The set of point lights in the scene only changes when a subsystem builds
    // or frees a pool, so rescanning every frame is pure waste. Every 90 frames
    // is often enough to catch a pool that appears after boot.
    if (ctx.time.frame - this._pointLightsFrame >= 90) {
      this._pointLightsFrame = ctx.time.frame;
      list.length = 0;
      ctx.scene.traverse(this._collectPointLight);
      this._lightRanges.clear();
      for (const e of render?.lights ?? []) {
        if (e.light?.isPointLight === true) this._lightRanges.set(e.light, e.range);
      }
    }

    ctx.camera.getWorldPosition(this._camPos);
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      const range = this._lightRanges.get(l);
      if (range === undefined) {
        // Not registered for distance culling: its owner drives `visible`.
        if (l.visible === true) n++;
        continue;
      }
      // The renderer's test, verbatim: fade = 1 - smoothstep(d, .75r, 1.15r),
      // light.visible = fade > 0.002.
      const d = l.position.distanceTo(this._camPos);
      if (1 - THREE.MathUtils.smoothstep(d, range * 0.75, range * 1.15) > 0.002) n++;
    }

    // A subsystem can always out-run the pool; adopting the higher count costs
    // one compile, once, instead of one per crossing.
    if (n > this._lightTarget) this._lightTarget = n;
    const want = this._lightTarget - n;
    const pool = this._ballast;
    for (let i = 0; i < pool.length; i++) {
      const v = i < want;
      if (pool[i].visible !== v) pool[i].visible = v;
    }
  }

  // ---------------------------------------------------------------- runtime --
  update(dt, ctx) {
    // Distance LOD for the scatter clouds: one bounding-sphere test per batch.
    this.A?.updateLod(ctx.camera);

    // Street lamps come on as the sun goes down, driven by the sky's real solar
    // altitude rather than a timer, so it is right at any time of day.
    const sky = this._sky ?? (this._sky = ctx.peek('sky'));
    const alt = sky?.sunAltitude ?? 0.6;
    const mix = 1 - Math.min(1, Math.max(0, (alt + 0.05) / 0.16));
    if (Math.abs(mix - this._lampMix) > 0.01) {
      this._lampMix = mix;
      for (let i = 0; i < this.lamps.length; i++) this.lamps[i].intensity = 14 * mix;
      if (this.lampLens) this.lampLens.emissiveIntensity = 9 * mix;
      // Bulbs stay on around the clock — but a 60 W bulb is NOT competitive with
      // daylight, and running it at night strength at noon is what made every
      // interior read as pure tungsten (B-R -93) and sit level with the sunlit
      // street instead of 1.5-2.5 stops under it. Gate the bulb on solar
      // altitude: a weak practical by day, the room's only light after dark.
      for (let i = 0; i < this.bulbs.length; i++) this.bulbs[i].intensity = 5 + 17 * mix;
    }
  }

  lateUpdate(dt, ctx) {
    this._stabiliseLightCount(ctx);
  }

  // --------------------------------------------------------------- pre-warm --
  /**
   * Compile every shader permutation the world can produce, before the frame
   * loop starts. See `src/core/prewarm.js` — that module asks each subsystem for
   * exactly this hook, because `renderer.compileAsync(scene, camera)` alone
   * reaches only the forward lit variant of a material, not the two override
   * passes the world's geometry also goes through every frame:
   *
   *   - the CSM cascades render the whole scene with `csm.depthMaterial`
   *   - the prepass renders it again with the gbuffer's ShaderMaterial
   *
   * Both are separate programs, and each one has its own permutations for plain
   * geometry, instanced geometry and instanced geometry with an instanceColor —
   * which is precisely the mix the world puts in front of them.
   *
   * Pixel-neutral by construction: it compiles, it does not draw. The only
   * mutations are `scene.overrideMaterial` and the ballast light visibility,
   * both restored in the `finally`.
   */
  async prewarmMaterials(ctx = this.ctx) {
    const render = ctx.peek?.('render') ?? ctx.get?.('render');
    const renderer = render?.renderer;
    if (!renderer) return { ok: false, reason: 'no renderer' };
    const scene = ctx.scene;
    const camera = ctx.camera;
    const before = renderer.info.programs?.length ?? 0;
    const t0 = performance.now();

    // Every lit material must carry render's CSM/AO/SSR injection before it is
    // compiled, or the program we warm is not the program the frame will use.
    render.patchMaterials?.(this.root);

    // Compile at the count the frame loop will actually run at, not at whatever
    // the distance cull happens to have left visible during boot.
    this._stabiliseLightCount(ctx);

    const prevOverride = scene.overrideMaterial;
    try {
      // 1. forward lit pass.
      await this._compile(renderer, scene, camera);
      // 2. the shadow cascades and 3. the depth/normal/velocity prepass, both of
      //    which draw this same geometry through an override material.
      for (const over of [render.csm?.depthMaterial, render.gbuffer?.material]) {
        if (!over) continue;
        scene.overrideMaterial = over;
        await this._compile(renderer, scene, camera);
      }
    } finally {
      scene.overrideMaterial = prevOverride;
    }

    return {
      ok: true,
      ms: Math.round(performance.now() - t0),
      compiled: (renderer.info.programs?.length ?? 0) - before,
      lightTarget: this._lightTarget,
    };
  }

  async _compile(renderer, scene, camera) {
    try {
      await renderer.compileAsync(scene, camera);
    } catch {
      try {
        renderer.compile(scene, camera);
      } catch {
        /* a driver we cannot pre-warm on; boot must still proceed */
      }
    }
  }

  // ------------------------------------------------------------ demolition --
  /**
   * BRING ONE DOWN, OR PUT IT BACK. `down` swaps a building's two cached forms:
   * the shell stops being drawn and stops being solid, the ruin starts. Two
   * index-range fills and two collision-mask fills; nothing is built.
   *
   * `match` drives this — see `src/match/airstrike.js`, which owns the event,
   * the telegraph and the several hundred pieces of masonry in the air between
   * the two states. Calling it here directly is the round reset and the tools.
   * @param {string} id     a building id from `world.demolitions`
   * @param {boolean} down
   */
  demolish(id, down = true) {
    const rec = this.demolitions?.find((d) => d.id === id);
    if (!rec) return false;
    if (rec.down === !!down) return false;
    rec.setDown(!!down);
    return true;
  }

  /** Every destructible building at once — the round reset, and `?demo=down`. */
  demolishAll(down = true) {
    let n = 0;
    for (const rec of this.demolitions ?? []) {
      if (rec.down === !!down) continue;
      rec.setDown(!!down);
      n++;
    }
    this._demoDown = !!down;
    return n;
  }

  // ---------------------------------------------------------------- queries --
  spawn(i = 0) {
    const n = this.spawnPoints.length;
    return this.spawnPoints[((i % n) + n) % n];
  }

  levelToWorld(x, y, z, out = new THREE.Vector3()) {
    return out.set(x, y, z).applyMatrix4(this.A.xform);
  }

  worldToLevel(x, y, z, out = new THREE.Vector3()) {
    return out.set(x, y, z).applyMatrix4(this._inv);
  }

  /** Analytic floor height. Physics owns the exact answer; this is a hint. */
  groundHeight(x, z) {
    const p = this.worldToLevel(x, 0, z, this._v);
    return groundY(p.x, p.z);
  }

  /** True where a character can stand outdoors (street, pavement, alley). */
  isOpen(x, z, margin = 0.4) {
    const p = this.worldToLevel(x, 0, z, this._v);
    return isOpen(p.x, p.z, margin);
  }

  dispose() {
    this.A?.dispose();
    this.root?.parent?.remove(this.root);
    for (const l of this._ballast ?? []) l.parent?.remove(l);
    this._ballast = null;
    this._pointLights = null;
    this.bulbs = null;
    this.lamps = null;
  }
}

export { BUILDINGS, STREET, SET_PIECES, GATE };
