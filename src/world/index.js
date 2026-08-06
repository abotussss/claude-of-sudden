import * as THREE from 'three';
import { Assembler } from './builder.js';
import { getLevel } from './levels/index.js';
import { BUILDINGS, STREET, SET_PIECES, GATE } from './layout.js';

/**
 * WORLD — level geometry, the modular building kit, props, set dressing and
 * static collision.
 *
 * THERE IS MORE THAN ONE MAP NOW. This file used to BE the map: it imported
 * `layout.js` at module scope and `init()` unconditionally assembled one
 * Middle-Eastern market town, with that town's yaw, scale, spawn table, play box
 * and ground queries written into it as constants. It is now the HOST — the
 * prologue (root, Assembler, transform), the epilogue (lights, `finalize`,
 * publish, bounds, queries) and the public API — and the map itself is a level
 * module under `src/world/levels/`, selected by `config.map` / `?map=`.
 *
 *   levels/index.js   the registry and the level contract (READ THIS FIRST)
 *   levels/town.js    AL-MARIYA — the ~190 x 190 m market town, unchanged
 *   levels/plains.js  NACHTFELD — the night plain
 *
 * HOW THE REST FITS TOGETHER (all of it generic, shared by every level)
 *   layout.js     the TOWN's map: footprints, facade programmes, set pieces
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
 *   world.level               the active level record (id, name, …)
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
 *                             MAY BE EMPTY: a level with no enterable buildings
 *                             publishes `[]`, and every consumer already handles
 *                             that (`src/match/caches.js` proves each one
 *                             against the real nav grid and drops the rest).
 *   world.links               the rooftop gangways: [{ id, from, to, a, b,
 *                             width, span, fall }] in world space. See links.js.
 *                             MAY BE EMPTY.
 *   world.demolitions         the buildings that carry a CACHED DESTROYED STATE:
 *                             [{ id, name, zone, opens, position, radius, top,
 *                                halfW, halfD, level, navRect, mass, surfaces,
 *                                tint, down, setVisual(d), setCollision(d),
 *                                setDown(d) }]. Both forms are built at boot and
 *                             live in the merged batches; bringing one down is
 *                             two index-range fills and two mask fills. See
 *                             `world.demolish` and src/world/demolition.js.
 *                             MAY BE EMPTY.
 *   world.demolish(id, down)  swap one building for its ruin, or back
 *   world.demolishAll(down)   …all of them. The round reset, and `?demo=down`.
 *   world.breaches            the CACHE HOUSES, which lose a WALL rather than
 *                             the building. MAY BE EMPTY. See breach.js.
 *   world.damageAt(p, s)      A HIT, at a world position, carrying a strength.
 *                             Returns the `world.breaches` record that opened,
 *                             or null (nothing there / already open / too weak).
 *                             This is the entry point `match` fires through.
 *   world.breach(id, down)    open one wall, or put it back, by id
 *   world.breachAll(down)     …all of them. The round reset, and `?breach=down`.
 *   world.interiorVolumes     the GROUND FLOOR of every enterable building, as
 *                             an oriented box the bot height field can re-sample
 *                             itself against: [{ building, cx, cz, c, s, hw, hd,
 *                             floorY, probeY }]. MAY BE EMPTY.
 *   world.prewarmMaterials()  compile every shader permutation the world can
 *                             produce, before the frame loop starts. Awaitable.
 *                             Call it from src/core/prewarm.js — see the method.
 *   world.levelToWorld(x,y,z,out) / world.worldToLevel(x,y,z,out)
 */

/**
 * How many zero-intensity "ballast" point lights the world parks in the scene to
 * hold `numPointLights` — and therefore the shader permutation — constant. See
 * `_addBallast()`. Must be at least the worst-case number of practicals that can
 * be in range at once: a sweep of the whole playable area at three eye heights
 * puts that at 10 for the world's own lights, plus whatever `fx` keeps live.
 */
const LIGHT_SLOTS = 20;

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

    /**
     * WHICH MAP. `config.map` is set from `?map=` in src/main.js and defaults to
     * `'town'`, so every existing tool, gate and capture path that knows nothing
     * about levels boots the map it always booted.
     */
    const level = getLevel(ctx.config?.map);
    this.level = level;

    this.root = new THREE.Group();
    this.root.name = 'world';
    this.root.matrixAutoUpdate = false;
    ctx.scene.add(this.root);

    // Weathering in the shared materials keys off the ground plane.
    materials.setGroundLevel?.(0);

    const t0 = performance.now();
    const A = new Assembler({ materials, rng, render });
    this.A = A;
    A.setTransform(level.yaw, level.tx, level.tz);

    /**
     * THE MAP ITSELF. Everything from the prototype registration to the last
     * scattered stone, in the level's own order — and the order IS the map,
     * because `rng` is one stream and every pass draws from it in sequence.
     */
    const rec = level.build(A, rng, ctx);
    this.buildings = rec.buildings ?? [];
    this.cathedral = rec.cathedral ?? null;
    this.cordon = rec.cordon ?? null;
    this.features = rec.features ?? [];
    this.links = rec.links ?? [];
    this.interiorVolumes = rec.interiorVolumes ?? [];

    this._addLights(A);

    A.finalize(this.root, physics);
    A.releaseCache();

    /**
     * THE DESTROYED STATES, PUBLISHED — and this can only happen after
     * `finalize`, because a destroyed state is a cached TRIANGLE RANGE in a
     * merged batch that does not exist until then. A level with nothing
     * destructible returns neither list and publishes two empty arrays; every
     * consumer is already written against that.
     */
    const pub = level.publish?.(A, rec, physics, this.root) ?? null;
    this.demolitions = pub?.demolitions ?? [];
    this.breaches = pub?.breaches ?? [];
    /**
     * 「屋上破壊」 — the buildings that can lose the deck over their heads. Same
     * record shape as `breaches` down to the field, so `damageAt` walks the two
     * lists with one loop and a caller that already knows what to do with a
     * blown wall needs no third code path. @see src/world/roofbreak.js.
     */
    this.roofs = pub?.roofs ?? [];
    this._demoDown = false;
    /**
     * `?breach=down` — boot with every cache house's wall already blown open.
     * The gates need the damaged state as a STATE rather than as an event, the
     * same way `?demo=down` and `?cath=down` give them the other two: floorcheck,
     * indoorcheck, throughcheck, navcheck, boundcheck, solidcheck and
     * `_floatcheck.mjs` all boot a URL and measure what they find.
     */
    try {
      const q = new URLSearchParams(globalThis.location?.search ?? '');
      const flag = q.get('breach');
      if (flag === 'down' || flag === '1') {
        console.info(`[world] ?breach=down — ${this.breachAll(true)} walls booted OPEN`);
      }
      const rflag = q.get('roof');
      if (rflag === 'down' || rflag === '1') {
        console.info(`[world] ?roof=down — ${this.roofAll(true)} decks booted IN`);
      }
    } catch {
      /* no location (a node import of this module): nothing to read */
    }

    // -------------------------------------------------------------- queries --
    this._v = new THREE.Vector3();
    /** `damageAt` scratch — it is called from a shell impact, not from init. */
    this._bv = new THREE.Vector3();
    this._bw = new THREE.Vector3();
    this._inv = new THREE.Matrix4().copy(A.xform).invert();
    /** The level->world yaw, so gameplay can author facings in level space. */
    this.levelYaw = level.yaw;
    this.spawnPoints = level.spawns.map(([x, z, yaw, tag]) => ({
      position: A.toWorld(x * level.scale, 0, z * level.scale),
      yaw: yaw + level.yaw,
      tag,
    }));
    /**
     * The published feature list gets its WORLD position here, where the
     * transform exists. `level` is kept beside it because every tool in
     * `tools/` authors and reports in level space.
     */
    for (const f of this.features) {
      f.position = A.toWorld(f.level.x, f.level.y, f.level.z);
      f.yaw += this.levelYaw;
    }
    for (const l of this.links) {
      l.a = A.toWorld(l.x, l.y0, l.z0);
      l.b = A.toWorld(l.x, l.y1, l.z1);
    }
    /**
     * The playable box. `src/ai/index.js` builds its nav grid straight off
     * this, so it is also the nav grid's extent and therefore its memory and
     * its boot cost: cells go as the SQUARE of the half-extent. Each level
     * declares its own — see `boundsHalf` in `levels/index.js`.
     */
    const HB = level.boundsHalf;
    const [y0, y1] = level.boundsY;
    this.bounds = new THREE.Box3(
      new THREE.Vector3(-HB, y0, -HB),
      new THREE.Vector3(HB, y1, HB)
    ).applyMatrix4(A.xform);
    this.stats = A.stats;
    /** The authored layout, exposed for TOOLS only. @see `levels/town.js`. */
    this.layout = rec.layout ?? {};

    /**
     * THE LEVEL'S OWN TIME OF DAY, and this is the one thing `world` reaches
     * outside itself to do. `sky.setTimeOfDay` is already `sky`'s published API
     * (see the header of src/sky/index.js) and it is fetched at RUNTIME rather
     * than imported, which is what ARCHITECTURE.md's rule 2 asks for. A level
     * whose `hour` is null does not touch the sky at all, so the town is lit
     * exactly as it always was.
     *
     * ORDERING: `sky.deps` is `['render','materials']` and `world.deps` is
     * `['materials','physics']`, and the registry's topological order already
     * puts sky before world — but this is guarded anyway, because a headless
     * harness may register no sky at all.
     */
    const sky = ctx.peek('sky');
    if (level.hour != null) sky?.setTimeOfDay?.(level.hour);
    /**
     * …AND ITS WEATHER, for the same reason and through the same published API
     * (`sky.setWeather`). On a 400 m map this is not decoration: without haze
     * the range beyond the crest sits at full lit value while the plain in front
     * of it is moonlit, the auto-exposure meter has to serve both, and whichever
     * it picks the other one is wrong. A level with no `weather` touches nothing.
     */
    if (level.weather) sky?.setWeather?.(level.weather);

    const ms = performance.now() - t0;
    console.info(
      `[world] "${level.id}" built in ${ms.toFixed(0)}ms — ${(A.stats.staticTris / 1000).toFixed(0)}k static tris, ` +
        `${(A.stats.instTris / 1000).toFixed(0)}k instanced tris in ${A.stats.instances} instances, ` +
        `${A.stats.drawCalls} draw calls, ${(A.stats.collideTris / 1000).toFixed(1)}k collision tris`
    );
  }

  // ----------------------------------------------------------------- lights --
  /**
   * Punctual lights the world owns: the bare bulbs inside the enterable
   * buildings (what makes an interior read as lived-in against cool skylight)
   * and the street lamps, which only draw power after dusk.
   *
   * BOTH LISTS ARE FILLED BY THE LEVEL, through the Assembler: `interiors.js`
   * pushes to `A.interiorLights` and `dressing.js` to `A.lampAnchors`. A level
   * that has neither gets ballast and nothing else, which is correct — and a
   * level that wants a light that is neither (a burning ridge line) registers it
   * itself with `A.light` during `build`, where it is under the same distance
   * cull and the same fixed permutation budget.
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
    this.level?.update?.(dt, ctx, this);
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

  // ---------------------------------------------------------------- breach --
  /**
   * ────────────────────────────────────────────────────────────────────────────
   * A HIT ON A HOUSE — the entry point `match` fires a shell through
   * ────────────────────────────────────────────────────────────────────────────
   * 「物資やビーコンのある家も破壊できるようにして、破壊と言っても家の一部を破壊したり、
   *  外壁が破壊されるような破壊にしてください」
   *
   * `match` may not know which building a wall belongs to, which side of it faces
   * the street, or where the merged batches put its triangles — so what it hands
   * over is A WORLD POSITION AND A STRENGTH, which is everything a shell knows
   * about itself. `world` answers with the elevation that came off, or null.
   *
   *   const br = world.damageAt(impact.point, 1);
   *   if (br) { …use br.mass / br.position / br.normal for the picture… }
   *
   * NULL IS A REAL ANSWER AND THERE ARE THREE OF THEM: nothing breachable within
   * `reach` of the point (most of the map), the wall is already open, or the
   * strength is under that wall's own `strength` bar — a hit that scarred the
   * render. A caller that wants the bar can read `world.breaches[i].strength`
   * rather than discover it.
   *
   * The distance is to the OPENING's rectangle rather than to its centre, so a
   * shell into the jamb beside the hole takes the same wall off as one dead in
   * the middle of it. Allocation-free: two preallocated vectors, no matrices.
   *
   * @param {THREE.Vector3} position world space
   * @param {number} strength in `match`'s own units; 1 is a tank main-gun round
   * @returns {object|null} the `world.breaches` record that opened, or null
   */
  damageAt(position, strength = 1) {
    if (!position) return null;
    let best = null;
    let bestD = Infinity;
    /**
     * WALLS AND ROOFS ARE ONE LOOP AND TWO GATES.
     *
     * `world.roofs` publishes the identical record shape — position, along,
     * halfLen, reach, strength, down, setDown — so the geometry of "did this
     * shell land on it" is the same question for a deck as for an elevation and
     * is asked once. What separates them is what a record ASKS OF THE HIT:
     *
     *   `minY`     a roof carries one and a wall does not. 「屋上破壊」 is an
     *              event that comes from above; without the floor a hit on the
     *              ground-storey wall is "within reach" of a deck 9.5 m over it
     *              and a rifle grenade in the doorway would take the roof off.
     *   `strength` a roof's bar is over a tank round on purpose, so the walls
     *              direct fire opens and the roofs only air opens stay two
     *              different events. @see ROOF_STRENGTH in roofbreak.js.
     *
     * Nearest wins across BOTH lists, which is the honest answer for a bomb
     * through a parapet: the deck is nearer than the wall under it and the deck
     * is what goes.
     */
    for (const list of [this.breaches, this.roofs]) {
      for (const b of list ?? []) {
        if (b.down) continue;
        if (b.minY !== undefined && position.y < b.minY) continue;
        // point -> the opening's centre line, clamped to its own half-length
        this._bv.copy(position).sub(b.position);
        const along = Math.max(-b.halfLen, Math.min(b.halfLen, this._bv.dot(b.along)));
        this._bw.copy(b.position).addScaledVector(b.along, along);
        const d = position.distanceTo(this._bw);
        if (d < b.reach && d < bestD) {
          bestD = d;
          best = b;
        }
      }
    }
    if (!best) return null;
    if (strength < best.strength) return null;
    best.setDown(true);
    return best;
  }

  /** Bring one roof in, or put it back, by `world.roofs[i].id` or its building. */
  roof(id, down = true) {
    const rec = this.roofs?.find((r) => r.id === id || r.building === id);
    if (!rec || rec.down === !!down) return false;
    rec.setDown(!!down);
    return true;
  }

  /** Every deck at once — the round reset, and `?roof=down`. */
  roofAll(down = true) {
    let n = 0;
    for (const rec of this.roofs ?? []) {
      if (rec.down === !!down) continue;
      rec.setDown(!!down);
      n++;
    }
    return n;
  }

  /**
   * Open one wall, or put it back, by its `world.breaches[i].id`. The round
   * reset and the tools; `damageAt` is the gameplay path.
   */
  breach(id, down = true) {
    const rec = this.breaches?.find((b) => b.id === id || b.building === id);
    if (!rec || rec.down === !!down) return false;
    rec.setDown(!!down);
    return true;
  }

  /** Every damaged wall at once — the round reset, and `?breach=down`. */
  breachAll(down = true) {
    let n = 0;
    for (const rec of this.breaches ?? []) {
      if (rec.down === !!down) continue;
      rec.setDown(!!down);
      n++;
    }
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
    return this.level.groundY(p.x, p.z);
  }

  /** True where a character can stand outdoors (street, pavement, alley). */
  isOpen(x, z, margin = 0.4) {
    const p = this.worldToLevel(x, 0, z, this._v);
    return this.level.isOpen(p.x, p.z, margin);
  }

  dispose() {
    this.level?.dispose?.();
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
