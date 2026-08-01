import * as THREE from 'three';
import { Accum, trs } from './util.js';
import { PALETTE } from './palette.js';

/**
 * WORLD — the assembler.
 *
 * Every module in src/world/ writes into one of these instead of touching the
 * scene, which is how a 120 m map of hundreds of thousands of triangles comes
 * out as ~100 draw calls:
 *
 *   add(key, geo, matrix, opts)   merge into the static batch for that surface
 *   proto(id, spec)               declare an instanced prop prototype
 *   place(id, matrix, masks)      add one instance
 *   box(surface, ...)             add an axis-aligned collision proxy
 *   clipBox(surface, ...)         …one the BOT HEIGHT FIELD cannot see (see below)
 *   light(light, opts)            register a punctual light with `render`
 *
 * Collision is authored separately from the visual mesh: proxies are cheap
 * boxes generated from the same numbers that built the geometry, so a doorway
 * is a real hole in the collision hull and the BVH stays in the low thousands
 * of triangles instead of chewing on every chamfer.
 */

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const EMPTY = Object.freeze({});
const _m = new THREE.Matrix4();
/** Scratch for the per-instance collision proxy; never escapes `_collideProto`. */
const _cm = new THREE.Matrix4();
const _xm = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _sph = new THREE.Sphere();
const _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _UP = new THREE.Vector3(0, 1, 0);

/**
 * Spatial bucket size for chunked instance clouds (frustum culling + LOD).
 * Sized so a 120 m map splits into a handful of buckets: finer chunking culls a
 * little better but multiplies draw calls through the prepass and four shadow
 * cascades, which is the wrong trade at this map size.
 */
const CHUNK = 64;

export class Assembler {
  /**
   * `?boxtag` — EVERY COLLISION PROXY, WITH THE LINE THAT AUTHORED IT.
   *
   * The whole map is ~4200 anonymous boxes merged into a hundred batches, so
   * "the player is standing on concrete at 3.45 m 90 m out" is a fact with no
   * author attached to it and no way to get one: the BVH knows a triangle and a
   * surface tag, and nothing else survives the merge. Every question that starts
   * "WHICH authored thing is this" — a hole in the boundary, a ledge that should
   * not be standable, a wall that is conditionally missing — dead-ends there.
   *
   * Armed, `box()` and `clipBox()` record their arguments plus `new Error().stack`,
   * and `_boxdump.mjs` prints the boxes inside a level-space window with the
   * first non-builder frame of each. It named `interiorSlab`, `buildBuilding`
   * and `kit.js:balcony` — the whole of the seed-12 boundary leak — in four
   * lines of output.
   *
   * OFF BY DEFAULT AND FREE WHEN OFF: `TAG` is null unless the query string asks
   * for it, so the cost on a real boot is one truthiness test per box and no
   * allocation. It is a DEV instrument — armed, it holds a stack per box.
   */
  static TAG = (typeof location !== 'undefined' && new URLSearchParams(location.search).has('boxtag')) ? [] : null;

  constructor({ materials, rng, render }) {
    this.materials = materials;
    this.rng = rng;
    this.render = render;
    this._mats = new Map(); // palette key -> THREE.Material
    this._static = new Map(); // palette key -> Accum
    this._protos = new Map(); // id -> { geo, key, instances[], masks[], opts }
    this._collide = new Map(); // surface -> Accum
    /**
     * CLIP collision: surface -> Accum, registered on `LAYER.CLIP` instead of
     * `LAYER.STATIC`. See `clipBox()`.
     */
    this._clip = new Map();
    this._geoCache = new Map(); // kit piece key -> BufferGeometry
    this.lights = [];
    this.meshes = [];
    this.lodGroups = [];
    /**
     * LEVEL -> WORLD. The map is authored around a street running down -Z, then
     * placed in the world so the canonical hero camera looks straight along it.
     * Baking the transform in here (rather than rotating a parent Object3D)
     * keeps every merged vertex, collision proxy, instance matrix, light and
     * LOD bounding sphere in true world space — physics, culling and the
     * world-space triplanar materials all stay honest.
     */
    this.xform = new THREE.Matrix4();
    this._identity = true;
    /** Filled by interiors.js: where a bare bulb wants a point light. */
    this.interiorLights = [];
    /** Filled by dressing.js: where a street lamp wants a point light. */
    this.lampAnchors = [];
    /**
     * Per-instance placement jitter, armed for the set-dressing pass:
     * { rng, yaw, scale }. Per-prop tilt and sink come from the prototype.
     */
    this.jitter = null;
    /**
     * Whether put() drops a contact fillet under skirted prototypes. Turn it
     * off around a stack — the second crate in a pile is standing on the first,
     * not on the ground, and a dust ring floating at 60 cm is worse than none.
     */
    this.skirts = true;
    /**
     * ────────────────────────────────────────────────────────────────────────
     * SCOPES — a named span of everything written between two calls
     * ────────────────────────────────────────────────────────────────────────
     * @see `src/world/demolition.js`, the only caller. A building that carries
     * a destroyed state has to be able to STOP EXISTING at a moment's notice,
     * and everything above this line is built to make that impossible: the
     * whole map is merged into ~100 draw calls, so one shop's walls are a few
     * thousand triangles somewhere in the middle of `world_plaster_sand`.
     *
     * Giving each destructible building its own mesh is the obvious answer and
     * it is the wrong one: fifteen palette keys per building times six
     * buildings is ninety more draw calls, each of them redrawn by the depth
     * prepass and four shadow cascades.
     *
     * So the geometry stays exactly where it is and we remember WHERE. A scope
     * records, per palette key, the TRIANGLE RANGES its contents occupy in that
     * key's accumulator, plus the instanced placements and the collision it
     * authored. Switching a scope off is then a fill of degenerate indices over
     * cached ranges and a partial buffer upload, which is the same trick
     * `src/match/airstrike.js` plays on the collision mask, for the same reason:
     * nothing may be SOLVED on the frame a building comes down.
     *
     * TWO WAYS IN, AND THE SECOND ONE IS WHY A COLLAPSED BUILDING DOES NOT LEAVE
     * ITS SATELLITE DISHES HANGING IN THE AIR.
     *
     *   `beginScope(id)` / `endScope()` — lexical. `buildBuilding` is one call,
     *     so the shell, the slabs, the plinth and the parapet are all inside it.
     *
     *   `claimZones` — SPATIAL, armed for the set-dressing pass only. The
     *     dressing is a loop over every building inside `dressBuildings`, so
     *     there is no lexical bracket to put round one of them; instead, while
     *     the zones are armed, anything whose transform lands inside a claimed
     *     footprint and above its plinth is filed under that building. The AC
     *     units bracketed off its windows, the conduit, the washing lines, the
     *     roof tanks and dishes and the condensate streaks all go down with it.
     *
     * Ranges are therefore a LIST per key rather than one span: with the spatial
     * claim, two buildings' dressing interleaves in the same accumulator.
     */
    this._scope = null;
    /**
     * Armed spatial claims: [{ scope, x0, z0, x1, z1, y0, y1 }] in LEVEL space.
     * Empty (the default) costs one array-length test per `add`.
     */
    this.claimZones = [];
    /** Finished scopes, in the order they were opened. */
    this.scopes = [];
    /** palette key -> the merged mesh finalize() built for it. */
    this.staticMeshes = new Map();
    this.stats = { staticTris: 0, instTris: 0, instances: 0, drawCalls: 0, collideTris: 0 };
  }

  // -------------------------------------------------------------- transform --
  /**
   * Place LEVEL space into WORLD space. The map is authored around a street
   * running down -Z; the transform rotates and offsets it so the street lies on
   * the canonical camera axis. Baking it into every vertex, proxy, instance
   * matrix and light (rather than rotating a parent Object3D) keeps physics,
   * culling and the world-space triplanar materials honest.
   */
  setTransform(ry, tx = 0, tz = 0) {
    _q.setFromAxisAngle(_UP, ry);
    _v.set(tx, 0, tz);
    _one.set(1, 1, 1);
    this.xform.compose(_v, _q, _one);
    this._identity = ry === 0 && tx === 0 && tz === 0;
    this.ry = ry;
    return this;
  }

  /** LEVEL -> WORLD for a point. Writes into `out` (a THREE.Vector3). */
  toWorld(x, y, z, out = new THREE.Vector3()) {
    return out.set(x, y, z).applyMatrix4(this.xform);
  }

  /** Compose the level transform onto a level-space matrix (shared scratch). */
  _x(matrix) {
    if (this._identity) return matrix ?? null;
    if (!matrix) return this.xform;
    return _xm.copy(this.xform).multiply(matrix);
  }

  // ---------------------------------------------------------------- scopes --
  /**
   * Open a named scope. Everything written until `endScope()` belongs to it.
   * @param {string} id
   */
  beginScope(id) {
    const s = {
      id,
      /** palette key -> [{ start, count }] in TRIANGLES. */
      ranges: new Map(),
      collide: new Map(),
      clip: new Map(),
      /** [{ proto, index }] — instanced placements, resolved to `slots` below. */
      instances: [],
      /** [{ mesh, slot, m }] — filled by finalize(), `m` cached on first hide. */
      slots: [],
      /** [{ id, layer, triStart, triEnd }] — this scope's own static objects. */
      handles: [],
      tris: 0,
      visible: true,
      solid: true,
      _saved: null,
    };
    this._scope = s;
    this.scopes.push(s);
    return s;
  }

  endScope() {
    const s = this._scope;
    this._scope = null;
    return s;
  }

  /**
   * Arm a SPATIAL claim: anything written inside this level-space footprint and
   * between `y0` and `y1` belongs to `scope` even though no lexical scope is
   * open. @see the `claimZones` note in the constructor — this is what keeps a
   * demolished building's roof clutter from surviving the building.
   *
   * `y1` IS WHY THIS TAKES A CEILING AT ALL. A whole building's claim wants
   * everything above the plinth and `Infinity` is the right answer for it; a
   * BREACH claims one storey of one elevation (`src/world/breach.js`), and
   * without a top the AC unit two floors up over the hole would be filed under
   * the wall and would vanish with it.
   */
  claim(scope, x0, z0, x1, z1, y0 = 0.3, y1 = Infinity) {
    this.claimZones.push({ scope, x0, z0, x1, z1, y0, y1 });
    return this;
  }

  disarmClaims() {
    this.claimZones.length = 0;
    return this;
  }

  /** The scope a piece at this LEVEL-space transform falls into, or null. */
  _claimFor(geo, matrix) {
    const zones = this.claimZones;
    if (zones.length === 0) return null;
    let x;
    let y;
    let z;
    if (matrix) {
      const e = matrix.elements;
      x = e[12];
      y = e[13];
      z = e[14];
    } else {
      // No transform: the geometry is already in level space (a cable, a run of
      // cloth). Its own centre is the only anchor there is.
      if (!geo || !geo.getAttribute('position')) return null;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) return null;
      x = (bb.min.x + bb.max.x) * 0.5;
      y = (bb.min.y + bb.max.y) * 0.5;
      z = (bb.min.z + bb.max.z) * 0.5;
    }
    for (let i = 0; i < zones.length; i++) {
      const c = zones[i];
      if (y >= c.y0 && y <= c.y1 && x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) return c.scope;
    }
    return null;
  }

  /** Record a triangle run, coalescing with the previous one where it can. */
  _mark(s, key, start, count) {
    if (count <= 0) return;
    let list = s.ranges.get(key);
    if (!list) s.ranges.set(key, (list = []));
    const last = list[list.length - 1];
    if (last && last.start + last.count === start) last.count += count;
    else list.push({ start, count });
    s.tris += count;
  }

  // ------------------------------------------------------------- materials --
  mat(key) {
    let m = this._mats.get(key);
    if (m) return m;
    const def = PALETTE[key];
    if (!def) {
      console.warn(`[world] unknown palette key "${key}"`);
      return this.mat('concrete');
    }
    m = this.materials.get(def.name, def.opts);
    this._mats.set(key, m);
    return m;
  }

  surfaceOf(key) {
    return PALETTE[key]?.surface ?? 'concrete';
  }

  // --------------------------------------------------------- static batch --
  /** Merge a transformed geometry into the batch for `key`. */
  add(key, geo, matrix = null, opts = null) {
    let a = this._static.get(key);
    if (!a) {
      a = new Accum(`world:${key}`);
      this._static.set(key, a);
    }
    const s = this._scope ?? this._claimFor(geo, matrix);
    if (s) {
      const start = a.tris;
      a.add(geo, this._x(matrix), opts);
      this._mark(s, key, start, a.tris - start);
      return this;
    }
    a.add(geo, this._x(matrix), opts);
    return this;
  }

  /** Convenience: a transformed box merged into the static batch. */
  addBox(key, geo, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, opts = null) {
    return this.add(key, geo, trs(_m, x, y, z, ry, sx, sy, sz), opts);
  }

  /**
   * Geometry cache for kit pieces that repeat (window frames, sills, steps).
   * Merged data is copied, so everything here is freed by releaseCache() once
   * the level is built.
   */
  cache(key, factory) {
    let g = this._geoCache.get(key);
    if (!g) {
      g = factory();
      this._geoCache.set(key, g);
    }
    return g;
  }

  /** Merge a one-off geometry and free it immediately. */
  addOnce(key, geo, matrix = null, opts = null) {
    this.add(key, geo, matrix, opts);
    geo.dispose();
    return this;
  }

  releaseCache() {
    for (const g of this._geoCache.values()) g.dispose();
    this._geoCache.clear();
  }

  // ------------------------------------------------------------ instanced --
  /**
   * @param {string} id
   * @param {object} spec { geo, key, castShadow, chunk, maxDist, collide }
   */
  proto(id, spec) {
    if (this._protos.has(id)) return id;
    this._protos.set(id, {
      id,
      geo: spec.geo,
      /**
       * COLLISION IS A PROPERTY OF THE PROTOTYPE.
       *
       * This field has been in the signature above since the Assembler was
       * written and `proto()` never read it, so collision for an instanced prop
       * had to be authored by hand — one `A.box(surface, cx, cy, cz, sx, sy,
       * sz)` typed next to each `A.put(id, x, y, z)`, with the numbers written
       * out a second time. Nothing bound the two. That is not a style problem,
       * it is the bug: `tools/solidcheck.mjs` found ~280 prop instances a
       * player walks straight through, and they were not oversights scattered
       * one by one. They were WHOLE CATEGORIES. Every satellite dish and roof
       * vent on the map. Every chair, table and shelf indoors. The oil drums in
       * one of the three places drums are placed but not in the other two. A
       * category is missed once, by one person, in one function, and then it is
       * invisible forever, because the thing that is missing is a line that was
       * never typed.
       *
       * Declaring it here makes it structural instead: a prototype is solid or
       * it is not, `place()` emits the proxy under the SAME matrix that draws
       * the mesh, and a prop can no longer be dressed into the level without
       * its collision because there is no longer a second thing to remember.
       * The yaw, tilt, sink and scale jitter `put()` applies come along for
       * free, which the hand-typed boxes never did — a drum lying on its side
       * had an upright 0.9 m box standing where it used to be.
       *
       *   collide: true                  box the prototype's own bounding box
       *   collide: { shrink, h, surface }
       *     shrink   metres taken off EACH horizontal side, so the proxy never
       *              stands proud of the skin it stands in for. Default 0.03,
       *              about one chamfer.
       *     h        solid height from the base, for a prop whose top is not
       *              something you can lean on.
       *     surface  overrides the surface of the prototype's palette key.
       */
      collide: spec.collide ?? null,
      /** Derived from `geo` on first placement — see `_protoBox`. */
      _cbox: undefined,
      /**
       * How far a loose object of this kind is allowed to be knocked out of
       * true, in radians, and how far to sink it so the raised corner does not
       * float. 0 (the default) means "this prop is fixed" — a lamp post, a
       * bullet pock, a bottle standing on a table — and `put()` leaves it alone.
       */
      tilt: spec.tilt ?? 0,
      sink: spec.sink ?? 0,
      key: spec.key,
      /**
       * Radius, in metres, of the swept dust fillet `put()` should drop under
       * every instance of this prototype. Nothing in the frame currently
       * touches anything: a crate meets the road on a razor-straight polygon
       * edge with no darkening, no piled grit and no transition, which is what
       * makes props read as decals pasted on. A low mound of the ground's own
       * material against the base fixes it geometrically (so the AO pass and
       * the sun both see it) rather than by painting a shadow.
       */
      skirt: spec.skirt ?? 0,
      castShadow: spec.castShadow !== false,
      receiveShadow: spec.receiveShadow !== false,
      chunk: spec.chunk !== false,
      maxDist: spec.maxDist ?? 0,
      matrices: [],
      masks: [],
      noPrepass: !!spec.noPrepass,
    });
    return id;
  }

  has(id) {
    return this._protos.has(id);
  }

  /**
   * Does an instance of this prototype come with collision?
   *
   * `dressing.js` needs the answer to keep solid props out of the bomb-plant
   * circles and the spawn pockets, and it used to answer it with its own
   * `id.startsWith('barrel') || id.startsWith('crate')`. That was a second,
   * private copy of "which props are solid" living three files away from the
   * declaration — the same shape of mistake as the missing proxies themselves.
   * Ask the prototype.
   */
  isSolid(id) {
    return !!this.footprint(id);
  }

  /**
   * HOW BIG THE SOLID PART ACTUALLY IS — `{ sx, sy, sz }` in the prototype's own
   * space, at scale 1, or null when the prop carries no proxy.
   *
   * `isSolid` answers "does this thing block", and every caller that asked it
   * then went on to invent its own number for "and how far". `interiors.js` had
   * a column of hand-picked pads — 0.25, 0.35, 0.4, 0.5 — next to placements of
   * a bucket, a crate stack, a shelf unit and a wardrobe, and none of them was
   * the size of the thing being placed. A wardrobe is 0.9 m across, was tested
   * as a point, and stood in doorways and on stair treads: the centre cleared
   * the keep-out circle and the body of the object did not.
   *
   * The extent is already known exactly — `_protoBox` derives it from the same
   * geometry the proxy is built from — so publish it rather than let four files
   * guess at it. A table of magic radii per kind is the version of this that
   * rots the first time a prop's geometry changes.
   */
  footprint(id) {
    const p = this._protos.get(id);
    if (!p || !p.collide) return null;
    if (p._cbox === undefined) p._cbox = this._protoBox(p);
    const c = p._cbox;
    return c ? { sx: c.sx, sy: c.sy, sz: c.sz } : null;
  }

  /**
   * The radius of that footprint: half its diagonal, so it is independent of the
   * yaw the prop will be placed at. Props are yawed by hand, by `put`'s jitter,
   * or both, so a width and a depth cannot be assigned to level axes here; the
   * circumscribing circle is the honest bound and it is at most 4 cm wider than
   * the true half-width on the longest prop indoors (a 1.1 x 0.35 m shelf unit).
   * 0 for anything that carries no proxy — a bucket, a sandbag, a lying tyre —
   * because the character controller steps over those and the gates, which
   * measure standing room from `STANCE.stand.stepHeight` up, cannot see them.
   */
  footprintR(id, s = 1) {
    const f = this.footprint(id);
    return f ? (Math.hypot(f.sx, f.sz) / 2) * s : 0;
  }

  /** Add an instance. `masks` scales the geometry's [wear, grime, ao]. */
  place(id, matrix, masks = null) {
    const p = this._protos.get(id);
    if (!p) {
      console.warn(`[world] no prop prototype "${id}"`);
      return this;
    }
    const wm = this._x(matrix).clone();
    p.matrices.push(wm);
    p.masks.push(masks ? [masks[0], masks[1], masks[2]] : null);
    const s = this._scope ?? this._claimFor(p.geo, matrix);
    if (s) s.instances.push({ proto: p, index: p.matrices.length - 1 });
    // Solid prototypes get their proxy from the very matrix that draws them —
    // see the `collide` field on `proto()` for why this is not optional. A
    // claimed instance's proxy has to go into the SAME scope as the instance,
    // or a demolished building leaves invisible boxes standing in its footprint.
    if (p.collide) {
      const prev = this._scope;
      this._scope = s;
      this._collideProto(p, wm);
      this._scope = prev;
    }
    return this;
  }

  /**
   * The prototype's collision box in ITS OWN space, derived once from the
   * geometry it is standing in for. Returns null when the prop is too small to
   * be worth a proxy: under `STANCE.stand.stepHeight` (0.42) the character
   * controller steps over it without the player ever feeling the contact, so a
   * box there is BVH triangles nobody can touch — and, worse, a bump in the
   * bot height field, which is sampled by dropping one ray per cell and cannot
   * tell a 0.2 m cinder block from a 0.2 m step.
   */
  _protoBox(p) {
    const geo = p.geo;
    if (!geo) return null;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) return null;
    const o = p.collide === true ? EMPTY : p.collide;
    const shrink = o.shrink ?? 0.03;
    const sx = Math.max(0.04, bb.max.x - bb.min.x - shrink * 2);
    const sz = Math.max(0.04, bb.max.z - bb.min.z - shrink * 2);
    const sy = Math.min(o.h ?? Infinity, bb.max.y - bb.min.y);
    if (sy < 0.42) return null;
    return {
      sx, sy, sz,
      cx: (bb.min.x + bb.max.x) / 2,
      cy: bb.min.y + sy / 2,
      cz: (bb.min.z + bb.max.z) / 2,
      surface: o.surface ?? this.surfaceOf(p.key),
    };
  }

  /** Emit one instance's proxy. `wm` is already in WORLD space. */
  _collideProto(p, wm) {
    if (p._cbox === undefined) p._cbox = this._protoBox(p);
    const c = p._cbox;
    if (!c) return;
    _cm.makeScale(c.sx, c.sy, c.sz);
    _cm.setPosition(c.cx, c.cy, c.cz);
    _cm.premultiply(wm);
    this._accum(c.surface).add(UNIT_BOX, _cm);
  }

  /** The collision accumulator for a surface, created on demand. */
  _accum(surface) {
    const s = this._scope;
    if (s) {
      let sa = s.collide.get(surface);
      if (!sa) s.collide.set(surface, (sa = new Accum(`collide:${s.id}:${surface}`)));
      return sa;
    }
    let a = this._collide.get(surface);
    if (!a) this._collide.set(surface, (a = new Accum(`collide:${surface}`)));
    return a;
  }

  /**
   * Place with loose transform arguments — the common case.
   *
   * When `jitter` is armed (dressing.js does it for the whole set-dressing pass)
   * every prop declared as loose gets knocked out of true: a little yaw, a
   * little tilt on both horizontal axes and a little scale. Nothing in a real
   * street is square to anything else, and the identical-clone read is the
   * loudest tell in an instanced prop cloud — a barrel dropped by hand is never
   * plumb, and two barrels are never the same size.
   */
  put(id, x, y, z, ry = 0, s = 1, masks = null, rx = 0, rz = 0) {
    const j = this.jitter;
    const p = this._protos.get(id);
    if (j) {
      if (p && p.tilt > 0) {
        const r = j.rng;
        ry += r.range(-j.yaw, j.yaw);
        rx += r.range(-p.tilt, p.tilt);
        rz += r.range(-p.tilt, p.tilt);
        s *= 1 + r.range(-j.scale, j.scale);
        y -= p.sink;
      }
    }
    trs(_m, x, y, z, ry, s, s, s, rx, rz);
    this.place(id, _m, masks);
    // Ground it. The fillet is never tilted and never rotated with the prop:
    // it is a pile of dust, not part of the object.
    if (this.skirts && p && p.skirt > 0 && this._protos.has('dust_skirt')) {
      const rr = p.skirt * s;
      trs(_m, x, y + 0.004, z, (x * 2.7 + z * 1.9) % 6.283, rr, 1, rr);
      this.place('dust_skirt', _m, null);
    }
    return this;
  }

  putS(id, x, y, z, ry, sx, sy, sz, masks = null, rx = 0, rz = 0) {
    trs(_m, x, y, z, ry, sx, sy, sz, rx, rz);
    return this.place(id, _m, masks);
  }

  count(id) {
    return this._protos.get(id)?.matrices.length ?? 0;
  }

  // ------------------------------------------------------------ collision --
  /** Axis-aligned (or Y-rotated) box collision proxy. */
  box(surface, cx, cy, cz, sx, sy, sz, ry = 0) {
    if (Assembler.TAG) Assembler.TAG.push({ k: 'box', surface, cx, cy, cz, sx, sy, sz, ry, at: new Error().stack });
    this._accum(surface).add(UNIT_BOX, this._x(trs(_m, cx, cy, cz, ry, sx, sy, sz)));
    return this;
  }

  /**
   * A CHARACTER-ONLY collision proxy. Stops the player and the bots; INVISIBLE to
   * `MASK.WORLD`, which is to say invisible to the bot height field.
   *
   * WHY THIS EXISTS, and it is a navigation fact, not a convenience.
   * `src/ai/nav.js` builds its 2.5D grid by dropping ONE ray per cell from
   * `bounds.max.y + 4` and keeping the FIRST hit under `MASK.WORLD`. So any
   * overhead structure on `LAYER.STATIC` becomes the floor of every cell under
   * it: a 1.4 m wide gangway thrown across a connector at roof height turns a
   * 1.4 m strip of that connector into an island at 6.5 m, and the rotation
   * through it stops existing for every bot on the map. Measured against the
   * balconies, which already do this to 1.2 m of pavement and get away with it
   * only because the road beside them is clear.
   *
   * `MASK.CHARACTER` includes `LAYER.CLIP` and `MASK.WORLD` does not, so a deck
   * authored here holds the player up and leaves the ground below it walkable
   * ground as far as A*, `world.groundHeight`, `physics.groundHeight` and the
   * bomb-site resolve rays are concerned. Bullets and sightlines pass through it
   * too (`MASK.BULLET`/`MASK.SIGHT` exclude CLIP) — which is the honest trade: a
   * scaffold plank you can be shot through, rather than bullet-proof floating
   * cover nobody can contest.
   */
  clipBox(surface, cx, cy, cz, sx, sy, sz, ry = 0, rx = 0) {
    if (Assembler.TAG) Assembler.TAG.push({ k: 'clip', surface, cx, cy, cz, sx, sy, sz, ry, at: new Error().stack });
    this._clipAccum(surface).add(UNIT_BOX, this._x(trs(_m, cx, cy, cz, ry, sx, sy, sz, rx)));
    return this;
  }

  /** Arbitrary triangles as CLIP collision — a sloped gangway, a ramp. */
  clipGeo(surface, geo, matrix = null) {
    this._clipAccum(surface).add(geo, this._x(matrix));
    return this;
  }

  _clipAccum(surface) {
    const s = this._scope;
    if (s) {
      let sa = s.clip.get(surface);
      if (!sa) s.clip.set(surface, (sa = new Accum(`clip:${s.id}:${surface}`)));
      return sa;
    }
    let a = this._clip.get(surface);
    if (!a) this._clip.set(surface, (a = new Accum(`clip:${surface}`)));
    return a;
  }

  /** Register real triangles as collision (ramps, terrain, odd shapes). */
  collideGeo(surface, geo, matrix = null) {
    this._accum(surface).add(geo, this._x(matrix));
    return this;
  }

  /** A wall slab given in panel space, placed by the panel's matrix. */
  slabBox(surface, panelMatrix, x, y, w, h, t) {
    trs(_m, x, y, t * 0.5, 0, w, h, t);
    _m.premultiply(panelMatrix);
    this._accum(surface).add(UNIT_BOX, this._x(_m));
    return this;
  }

  /** Register a punctual light. Position is in LEVEL space. */
  light(light, opts) {
    if (!this._identity) light.position.applyMatrix4(this.xform);
    this.lights.push({ light, opts });
    return this;
  }

  // ------------------------------------------------------------- finalize --
  /** Build the meshes, add them to `root`, register collision with physics. */
  finalize(root, physics) {
    // --- merged static geometry ---
    for (const [key, acc] of this._static) {
      if (acc.empty) continue;
      const geo = acc.build();
      const mesh = new THREE.Mesh(geo, this.mat(key));
      mesh.name = `world_${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.userData.surface = this.surfaceOf(key);
      mesh.userData.collision = false; // proxies own collision
      mesh.updateMatrix();
      root.add(mesh);
      this.meshes.push(mesh);
      this.staticMeshes.set(key, mesh);
      this.stats.staticTris += geo.index.count / 3;
      this.stats.drawCalls++;
    }

    /** prototype -> (matrix index -> owning scope), for the loop below. */
    const scopeOf = new Map();
    for (const s of this.scopes) {
      for (const rec of s.instances) {
        let m = scopeOf.get(rec.proto);
        if (!m) scopeOf.set(rec.proto, (m = new Map()));
        m.set(rec.index, s);
      }
      s.instances.length = 0;
    }

    // --- instanced props ---
    for (const p of this._protos.values()) {
      const n = p.matrices.length;
      if (n === 0) {
        p.geo.dispose();
        continue;
      }
      const buckets = new Map();
      if (p.chunk && n > 24) {
        for (let i = 0; i < n; i++) {
          const m = p.matrices[i];
          const gx = Math.floor(m.elements[12] / CHUNK);
          const gz = Math.floor(m.elements[14] / CHUNK);
          const k = gx * 97 + gz;
          let b = buckets.get(k);
          if (!b) buckets.set(k, (b = []));
          b.push(i);
        }
      } else {
        buckets.set(0, [...Array(n).keys()]);
      }

      const mat = this.mat(p.key);
      for (const list of buckets.values()) {
        const im = new THREE.InstancedMesh(p.geo, mat, list.length);
        im.name = `prop_${p.id}`;
        im.castShadow = p.castShadow;
        im.receiveShadow = p.receiveShadow;
        im.matrixAutoUpdate = false;
        im.userData.surface = this.surfaceOf(p.key);
        im.userData.collision = false;
        if (p.noPrepass) im.userData.owNoPrepass = true;
        let needColor = false;
        for (let j = 0; j < list.length; j++) if (p.masks[list[j]]) needColor = true;
        if (needColor) {
          const arr = new Float32Array(list.length * 3);
          for (let j = 0; j < list.length; j++) {
            const mk = p.masks[list[j]] ?? [1, 1, 1];
            arr[j * 3] = mk[0];
            arr[j * 3 + 1] = mk[1];
            arr[j * 3 + 2] = mk[2];
          }
          im.instanceColor = new THREE.InstancedBufferAttribute(arr, 3);
        }
        const owners = scopeOf.get(p);
        for (let j = 0; j < list.length; j++) {
          im.setMatrixAt(j, p.matrices[list[j]]);
          const owner = owners?.get(list[j]);
          if (owner) owner.slots.push({ mesh: im, slot: j, m: null });
        }
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.updateMatrix();
        root.add(im);
        this.meshes.push(im);
        this.stats.drawCalls++;
        this.stats.instances += list.length;
        const tri = (p.geo.index ? p.geo.index.count : p.geo.getAttribute('position').count) / 3;
        this.stats.instTris += tri * list.length;
        if (p.maxDist > 0) {
          im.userData.owLodDist = p.maxDist;
          this.lodGroups.push(im);
        }
      }
      p.matrices.length = 0;
      p.masks.length = 0;
    }

    // --- collision proxies ---
    this.collisionRoot = new THREE.Group();
    this.collisionRoot.name = 'world_collision';
    this.collisionRoot.visible = false;
    root.add(this.collisionRoot);
    this.handles = [];
    for (const [surface, acc] of this._collide) {
      if (acc.empty) continue;
      const geo = acc.build();
      const mesh = new THREE.Mesh(geo, INVISIBLE);
      mesh.name = `collide_${surface}`;
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.collisionRoot.add(mesh);
      this.stats.collideTris += geo.index.count / 3;
      if (physics) this.handles.push(physics.addStatic(mesh, surface));
    }
    // --- CLIP proxies: characters only, invisible to the bot height field ---
    for (const [surface, acc] of this._clip) {
      if (acc.empty) continue;
      const geo = acc.build();
      const mesh = new THREE.Mesh(geo, INVISIBLE);
      mesh.name = `clip_${surface}`;
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.collisionRoot.add(mesh);
      this.stats.collideTris += geo.index.count / 3;
      if (physics) {
        this.handles.push(physics.addStatic(mesh, surface, { layer: physics.LAYER.CLIP }));
      }
    }
    /**
     * --- a scope's own collision ---
     * Its own `physics` object rather than a triangle range inside the level's,
     * so switching it off is one mask write on a range the BVH cannot repack out
     * from under us. Never drawn, so this is not a draw call — the whole reason
     * the VISUAL side of a scope has to live inside the merged batches while its
     * collision does not.
     */
    for (const s of this.scopes) {
      for (const [map, layer] of [[s.collide, null], [s.clip, physics?.LAYER?.CLIP]]) {
        for (const [surface, acc] of map) {
          if (acc.empty) continue;
          const geo = acc.build();
          const mesh = new THREE.Mesh(geo, INVISIBLE);
          mesh.name = `scope_${s.id}_${surface}`;
          mesh.visible = false;
          mesh.matrixAutoUpdate = false;
          mesh.updateMatrix();
          this.collisionRoot.add(mesh);
          this.stats.collideTris += geo.index.count / 3;
          if (!physics) continue;
          const id = physics.addStatic(mesh, surface, layer == null ? {} : { layer });
          s.handles.push({ id, layer: layer ?? physics.LAYER.STATIC, triStart: -1, triEnd: -1 });
        }
      }
    }

    if (physics) physics.rebuildStatic();
    for (const s of this.scopes) this._cacheScopeTris(s, physics);

    // --- lights ---
    for (const { light, opts } of this.lights) {
      root.add(light);
      this.render?.addLight?.(light, opts);
    }
    return this;
  }

  /* ---------------------------------------------------------- scope switch -- */
  /**
   * DRAW A SCOPE, OR STOP DRAWING IT. One `fill` per triangle range and one
   * partial buffer upload; no geometry is rebuilt, no material is touched and no
   * draw call appears or disappears.
   *
   * A triangle whose three indices are the same vertex has zero area and is
   * discarded before rasterisation, in every pass — the forward draw, the depth
   * prepass and all four shadow cascades read the same index buffer, so a scope
   * that is off is off for its shadow too. The indices it replaces are kept
   * verbatim the first time they are needed, which is what makes `reset()` at
   * the end of a round exact rather than approximate.
   */
  setScopeVisible(scope, visible) {
    if (!scope || scope.visible === visible) return this;
    scope.visible = visible;
    if (!scope._saved) scope._saved = new Map();
    for (const [key, list] of scope.ranges) {
      const mesh = this.staticMeshes.get(key);
      const index = mesh?.geometry?.index;
      if (!index) continue;
      const arr = index.array;
      let saved = scope._saved.get(key);
      if (!saved) {
        let n = 0;
        for (const r of list) n += r.count * 3;
        saved = new arr.constructor(n);
        let o = 0;
        for (const r of list) {
          saved.set(arr.subarray(r.start * 3, (r.start + r.count) * 3), o);
          o += r.count * 3;
        }
        scope._saved.set(key, saved);
      }
      let o = 0;
      for (const r of list) {
        const a0 = r.start * 3;
        const n = r.count * 3;
        if (visible) arr.set(saved.subarray(o, o + n), a0);
        else arr.fill(saved[o], a0, a0 + n);
        index.addUpdateRange(a0, n);
        o += n;
      }
      index.needsUpdate = true;
    }
    for (let i = 0; i < scope.slots.length; i++) {
      const rec = scope.slots[i];
      const arr = rec.mesh.instanceMatrix.array;
      const o = rec.slot * 16;
      if (!rec.m) rec.m = arr.slice(o, o + 16);
      if (visible) arr.set(rec.m, o);
      else arr.fill(0, o, o + 16);
      rec.mesh.instanceMatrix.addUpdateRange(o, 16);
      rec.mesh.instanceMatrix.needsUpdate = true;
    }
    return this;
  }

  /**
   * Make a scope's collision solid or invisible to every query. A mask write on
   * a cached triangle range — the same move, and for the same reason, as
   * `Airstrike._setProxySolid`: a BVH rebuild is a half-second stall and this
   * happens in the middle of a round.
   */
  setScopeSolid(scope, physics, solid) {
    if (!scope || !physics || scope.solid === solid) return this;
    scope.solid = solid;
    const sw = physics.staticWorld;
    if (!sw) return this;
    for (const h of scope.handles) {
      if (h.triStart < 0 || sw.object?.[h.triStart] !== h.id) this._cacheHandleTris(h, sw);
      if (h.triStart < 0) continue;
      const m = solid ? h.layer : 0;
      sw.mask.fill(m, h.triStart, h.triEnd);
      const obj = sw.objects[h.id];
      if (obj) obj.mask = m;
    }
    return this;
  }

  _cacheScopeTris(scope, physics) {
    const sw = physics?.staticWorld;
    if (!sw) return;
    for (const h of scope.handles) this._cacheHandleTris(h, sw);
  }

  /** Where in the packed triangle array the BVH put this object. */
  _cacheHandleTris(h, sw) {
    h.triStart = -1;
    h.triEnd = -1;
    if (!sw.object) return;
    for (let t = 0; t < sw.object.length; t++) {
      if (sw.object[t] !== h.id) continue;
      if (h.triStart < 0) h.triStart = t;
      h.triEnd = t + 1;
    }
  }

  /** Distance LOD for prop clouds: cheap, per-mesh, no per-frame allocation. */
  updateLod(camera) {
    for (let i = 0; i < this.lodGroups.length; i++) {
      const im = this.lodGroups[i];
      const s = im.boundingSphere;
      if (!s) continue;
      _sph.copy(s);
      const d = _v.copy(camera.position).distanceTo(_sph.center) - _sph.radius;
      im.visible = d < im.userData.owLodDist;
    }
  }

  dispose() {
    this.releaseCache();
    for (const m of this.meshes) {
      // instanced meshes share a prototype geometry — the prototype frees it
      if (!m.isInstancedMesh) m.geometry?.dispose();
      m.parent?.remove(m);
    }
    for (const c of this.collisionRoot?.children ?? []) c.geometry?.dispose();
    this.meshes.length = 0;
    this.lodGroups.length = 0;
    for (const p of this._protos.values()) p.geo?.dispose();
    this._protos.clear();
    this._static.clear();
    this._collide.clear();
    this._clip.clear();
  }
}

/** Collision proxies are never drawn; they still need a material object. */
const INVISIBLE = new THREE.MeshBasicMaterial({ visible: false });
