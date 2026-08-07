/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE CRASH — 「戦闘機や衛星落下イベントで平原を火の海に」
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD's third act and its signature. The tower and the fortress are
 * things the match DOES to the map; this is the thing that happens TO the
 * match, and it is meant to be the biggest event in the game.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THREE PARTS, AND THE MIDDLE ONE IS NOT THE POINT
 * ────────────────────────────────────────────────────────────────────────────
 * 「過激にそして激しく」 was asked of the cathedral and the cathedral answered it
 * with a HARD CUT — 「大聖堂破壊の時は破壊演出がないですね？？？」 — a building
 * that was standing on one frame and rubble on the next. The lesson written down
 * in `nachtfeld.js`'s header is that an event is a PERFORMANCE, so this one is
 * three things and the impact is only the second:
 *
 *   1. THE APPROACH, and it is the longest of the three. A burning airframe
 *      enters 400 m off the map at 180 m of altitude and comes down across the
 *      whole plain over THIRTEEN SECONDS, trailing fire and smoke, lit by its
 *      own light. It is visible from every capture point on the map from the
 *      moment it appears, which is the entire design: 「見えるように」 — the
 *      player should watch it coming and know where it is going to land.
 *   2. THE IMPACT. One blast, and it is the largest single explosion either map
 *      has: `fx.explosion` at 34 m with a light that carries 320 m.
 *   3. THE PLOUGH, AND WHAT IS LEFT. The wreck does not stop where it lands. It
 *      skids 160 m up the plain over five seconds, laying fire behind it, and
 *      then it is a burning hull sitting on the grass for the rest of the match
 *      with a 160 m scar of flame behind it. THAT is 「平原を火の海に」, and it
 *      is the half of this event that is still there two minutes later.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHERE IT COMES DOWN, AND WHY IT IS NOT ALLOWED TO BE INTERESTING
 * ────────────────────────────────────────────────────────────────────────────
 * The obvious place to crash a satellite is the middle of the map, and it is
 * wrong for a reason that is not aesthetic. D is a capture point that Act I
 * spends a whole event opening; the fortress and the tower are Act II's and
 * Act I's; and a fire has no collision, so a fire ON a capture circle is a
 * point the AI walks into and dies in with nothing in `NavGrid` to tell it not
 * to. So `TRACK` below threads the ONE corridor on this map that is clear of
 * every one of them, and the clearances are measured rather than asserted:
 *
 *   zone D  (0, 0)      r14   61.5 m from the track
 *   zone C  (-128, 86)  r14   48.8 m
 *   zone A  (-118,-104) r14   73.2 m
 *   NF-TOWER (0,-32)    r22   55.6 m
 *   NF-FORT  (0, 48)    r36   70.2 m
 *
 * The swathe is `BURN_W` 24 m wide, so the nearest capture circle keeps 37 m of
 * clear ground between its edge and the nearest flame. The fire changes which
 * way you approach C and A from; it does not take a point away from anybody and
 * it does not put a hazard on ground the bots are routed across.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NOTHING IS COMPUTED IN THE FIRE FRAME
 * ────────────────────────────────────────────────────────────────────────────
 * The airframe, the flame instances, the fire cells and every cell's GROUND
 * HEIGHT (`physics.groundHeight`, at boot, once) are baked in `build()`. Firing
 * is `this._t = 0`. The flames move on a closed-form vertex shader off one
 * uniform, exactly as `makeChunkMaterial`'s chunks do; the airframe is one
 * `Matrix4.compose` per frame into a preallocated matrix; the ploughing is an
 * index walk over a baked array. Nothing here allocates after `build()` and
 * everything it creates is disposed.
 */
import * as THREE from 'three';
import { forMap } from './geography.js';
import { mergeGeometries } from './airstrike.js';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE TRACK — where it comes from, where it lands, where it stops
 * ────────────────────────────────────────────────────────────────────────────
 * `from` and `to` are the GROUND TRACK's two ends in level space: the point the
 * wreck first touches and the point it stops. Everything else — the entry
 * point, the entry altitude, the descent angle — is derived from those two and
 * from `APPROACH`/`CLIMB` below, so this table is two coordinates per map and
 * not eight. @see the clearance table in the header for why these two.
 *
 * The town has none. It is a street map with a cathedral in it and nothing on
 * it is 160 m of open ground; the crash is the PLAIN's act.
 */
const TOWN_TRACK = null;
const PLAINS_TRACK = { from: [-55.9, -35.4], to: [-85.2, 121.9] };
const MAP_TRACK = { town: TOWN_TRACK, plains: PLAINS_TRACK };

/** Metres of flight path before first contact. Thirteen seconds at `SPEED`. */
const APPROACH = 416;
/** Metres of altitude at the entry point, over the ground under it. */
const CLIMB = 182;
/** Flight speed along the descent, m/s. @see `Bomber`'s `SPEED` 38 and its note
 *  — an aeroplane in this game is authored for legibility, not for physics. */
const SPEED = 32;
/** Seconds the wreck takes to skid from first contact to rest. */
const PLOUGH = 5.0;
/** Width of the burning swathe, metres. @see the clearance table. */
const BURN_W = 24;
/** Fire cells along the swathe. One every ~6 m of a 160 m plough. */
const CELLS = 27;
/**
 * Flame tongues per cell.
 *
 * 7 -> 16. Photographed at 7 (`CRASH-7-scar-close.png`) the scar was a scatter
 * of individual pale triangles standing on grass — you could count them, which
 * is the tell that they are objects rather than a fire. Fire is a CROWD: the
 * tongues have to overlap so that what the eye resolves is the body of flame
 * and not its members. 432 quads with no lighting, no depth write and an early
 * `discard` is a rounding error next to the 1587 chunks the two demolitions
 * already carry.
 *
 * 16 -> 22, for the second half of the same argument. @see `_buildFlames` —
 * every tongue is now a FRACTION of a flame rather than a whole one, so what
 * makes the body of the fire is how many of them are on top of each other.
 */
const TONGUES = 26;
/**
 * THE BED, and it is what 「火の海」 actually means.
 *
 * Photographed at 20, 80 and 200 m (`shots/scar/SCAR-before-*.png`) the scar
 * was a row of separate vertical needles standing on unlit grass: at 20 m you
 * could count them, at 80 m they were a dotted line and at 200 m they were a
 * dozen white specks. Tongues alone cannot fix that at ANY brightness, because
 * the thing that is missing is not intensity — it is CONTINUITY. Ground that is
 * on fire is a burning floor with licks coming off it, and the floor is the
 * part that survives distance, joins one cell to the next and lights the turf.
 *
 * So each cell also gets `BED` quads that are wide, short and dim — 2-4.5 m
 * across and under 1.5 m tall — scattered across the FULL swathe rather than
 * biased to the spine. They are the same instanced mesh, the same draw call and
 * the same `uT`; `aKind` is the only thing that tells them apart.
 *
 * They are view-space billboards like the tongues and NOT quads laid flat on
 * the ground, which was the first idea and is a trap on this map: a horizontal
 * quad 6 m across on a plain that rolls intersects the turf, and an additive
 * quad clipped by the depth buffer has a hard terrain-shaped edge through it.
 *
 * THE BED IS ALSO THE ONLY LIGHT THIS FIRE HAS. `_light` asks `LightPool` for
 * three lights down the whole 157 m and asks at `priority: 1`, which is the
 * ordinary tier — `LightPool.flash` will hand a slot straight to the next
 * muzzle flash that wants it, and in a live firefight it does. So the fire
 * cannot rely on lighting its own ground and the bed has to BE the glow: wide,
 * low, continuous and bright enough to read as burning ground from 200 m,
 * without spending a single light slot the gunfight needs.
 */
const BED = 16;
/**
 * Seconds the ground keeps burning after the wreck stops.
 *
 * It outlives the match on purpose: the plain's own end is t=456-472 s and the
 * act fires at about T-160, so 240 s is "for the rest of the match" with room
 * for a long one. `reset()` puts it out between rounds.
 */
const BURN_S = 240;
/** Seconds between one pass of burn damage over the cells. */
const SEAR_EVERY = 2.6;
/** How long the burn keeps doing damage. It is a hazard, then it is scenery. */
const SEAR_S = 70;
/** Damage and radius of one cell's sear. Small: this is a place not to stand. */
const SEAR_DMG = 26;
const SEAR_R = 7.0;
/** Metres under the map the airframe waits. @see `Bomber`'s `PARKED_Y`. */
const PARKED_Y = -400;

export class Crash {
  /**
   * @param {object} ctx   engine context
   * @param {object} opts  { rng }
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.rng = opts.rng ?? ctx.rng.fork();
    this.ready = false;
    this.enabled = true;
    this.buildMs = 0;

    /** Act clock. -1 when nothing is falling. Seconds from the entry point. */
    this._t = -1;
    /** Seconds of burning left on the ground. 0 when the plain is not on fire. */
    this._burn = 0;
    /** Which fire cell the plough has reached. */
    this._cell = 0;
    /** Countdown to the next pass of sear damage. */
    this._sear = 0;
    /** Seconds of sear left. The fire outlives the damage. */
    this._searLeft = 0;
    /** Set true on the frame the ground is struck, so `match` can announce it. */
    this.struck = false;
    /** True while anything of this act is on screen. `match` reads it. */
    this.busy = false;

    /**
     * WHERE IT LANDS, PUBLISHED. The act's HUD reticle, its banner and its
     * `_actAim` anchor all read this, so the event points at the place the
     * event actually happens and no coordinate is authored twice.
     */
    this.impact = new THREE.Vector3();
    /** The same shape `world.demolitions` publishes, so an act can bind to it. */
    this.anchor = null;

    this.group = new THREE.Group();
    this.group.name = 'match-crash';
    this.group.matrixAutoUpdate = false;

    /* scratch — nothing in update() or fire() allocates */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._sc = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
    this._eul = new THREE.Euler();
    this._blast = { position: null, radius: 0, damage: 0, source: 'crash' };
    /** Persistent smoke tags, so `dispose`/`reset` can take them back. */
    this._smoke = [];
    /**
     * THE PLOUGH'S VOICE while it is running, `{ drive, stop }` or null.
     * @see src/audio/crash.js. It is a SUSTAINED voice holding a slot in the
     * spatial field, which makes it the one thing this act owns that has to be
     * given back — `fire()`, `reset()` and `dispose()` all end it, and if none
     * of them ever runs the emitter's own three-second lease reclaims the slot.
     */
    this._plough = null;
    /** Seconds since the last trail puff, so the approach does not emit per frame. */
    this._puff = 0;
  }

  /* ====================================================================== */
  /*  BOOT                                                                  */
  /* ====================================================================== */

  build() {
    const t0 = performance.now();
    const ctx = this.ctx;
    const world = ctx.peek('world');
    const physics = ctx.peek('physics');
    if (!world || !physics) {
      console.warn('[crash] no world/physics — disabled');
      return this;
    }
    const track = forMap(MAP_TRACK, world, 'crash track');
    if (!track) {
      console.info('[crash] this map authors no crash track — disabled');
      return this;
    }
    this._lib = ctx.peek('materials');

    /* ---- the ground track, and every cell's real ground height --------- */
    const [ax, az] = track.from;
    const [bx, bz] = track.to;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    /** Unit heading of the plough, level space = world space on this map. */
    this._hx = dx / len;
    this._hz = dz / len;
    this._len = len;
    this._yaw = Math.atan2(this._hx, this._hz);

    const gy = (x, z) => physics.groundHeight(x, z, 400);
    this.impact.set(ax, gy(ax, az), az);

    /**
     * THE ENTRY POINT. Derived: back along the heading by the horizontal leg of
     * a right triangle whose hypotenuse is `APPROACH` and whose rise is `CLIMB`,
     * so the descent angle is a consequence of the two numbers above rather
     * than a third one to keep in sync.
     */
    const horiz = Math.sqrt(Math.max(1, APPROACH * APPROACH - CLIMB * CLIMB));
    this._ex = ax - this._hx * horiz;
    this._ez = az - this._hz * horiz;
    this._ey = this.impact.y + CLIMB;
    this._fall = APPROACH / SPEED;
    this._pitch = Math.atan2(CLIMB, horiz);

    /* ---- the fire cells ------------------------------------------------ */
    const n = CELLS;
    this._cx = new Float32Array(n);
    this._cy = new Float32Array(n);
    this._cz = new Float32Array(n);
    /** Seconds after first contact that the plough reaches this cell. */
    this._ct = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const x = ax + dx * u + this._hz * this.rng.range(-BURN_W * 0.22, BURN_W * 0.22);
      const z = az + dz * u - this._hx * this.rng.range(-BURN_W * 0.22, BURN_W * 0.22);
      this._cx[i] = x;
      this._cz[i] = z;
      this._cy[i] = gy(x, z);
      /**
       * The plough DECELERATES. `1 - (1-u)^2` puts the wreck through the first
       * half of the skid in a third of the time, which is what a body losing
       * energy to the ground does and what makes the tail of the scar read as
       * the wreck grinding to a halt rather than as a train passing.
       */
      this._ct[i] = PLOUGH * (1 - (1 - u) * (1 - u));
    }

    this._buildAirframe();
    this._buildFlames(physics);
    this._park();
    ctx.scene.add(this.group);
    this.ready = true;
    this.buildMs = performance.now() - t0;
    console.info(
      `[crash] track baked in ${this.buildMs.toFixed(0)}ms — enters at ` +
        `(${this._ex.toFixed(0)}, ${this._ez.toFixed(0)}) ${CLIMB} m up, ` +
        `${this._fall.toFixed(1)}s of approach at ${SPEED} m/s, ` +
        `impact (${this.impact.x.toFixed(0)}, ${this.impact.z.toFixed(0)}) y=${this.impact.y.toFixed(1)}, ` +
        `ploughs ${len.toFixed(0)} m over ${PLOUGH}s into ${n} fire cells ` +
        `(${n * TONGUES} tongues + ${n * BED} of bed, ${BURN_W} m wide, burns ${BURN_S}s; ` +
        `${this._lifted} of them sit more than 0.5 m off their own cell's height, ` +
        'which is why each is probed for its own)'
    );

    /**
     * The anchor an act binds to, in the shape `world.demolitions` publishes so
     * `_bakeActs` needs no second case. `top` is absolute, as theirs is.
     */
    this.anchor = {
      id: 'NF-CRASH',
      name: 'THE CRASH',
      position: this.impact,
      top: this.impact.y + 6,
      radius: BURN_W,
      halfW: BURN_W * 0.5,
      halfD: len * 0.5,
    };
    return this;
  }

  /**
   * THE AIRFRAME, AND IT IS ALREADY BROKEN WHEN YOU FIRST SEE IT.
   *
   * `Bomber._buildAircraft`'s note is the rule here — the silhouette carries the
   * telegraph — but the telegraph is the opposite one. A bomber has to read as
   * an aeroplane ARRIVING; this has to read, at 300 m, as something that is
   * already finished: a heavy fuselage, ONE wing, the other torn off at the
   * root, a bent tail and a solar boom folded back over the spine. Whatever it
   * was, it is coming down.
   */
  _buildAirframe() {
    const box = (w, h, d, x, y, z, ry = 0, rz = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (rz) g.rotateZ(rz);
      if (ry) g.rotateY(ry);
      g.translate(x, y, z);
      return g;
    };
    const geo = mergeGeometries([
      box(3.2, 3.0, 15.0, 0, 0, 0), // fuselage
      box(2.2, 2.0, 3.4, 0, -0.3, 8.6), // nose, crumpled
      box(12.0, 0.6, 4.2, -6.4, -0.2, -0.8, 0, 0.22), // the wing it still has
      box(2.6, 0.6, 3.4, 3.0, 0.3, -0.8, 0, -0.9), // the stub of the one it lost
      box(0.6, 4.0, 3.0, 0, 2.4, -6.2, 0, 0.35), // fin, bent
      box(5.0, 0.5, 1.8, 0, 0.9, -6.6), // tailplane
      box(2.0, 2.0, 2.0, -1.0, 1.4, -3.0, 0.5), // torn plating over the spine
      box(7.0, 0.24, 1.6, 0, 1.9, -1.0, 0.28), // solar boom, folded back
      box(1.6, 1.6, 2.6, 2.0, -1.4, 2.2), // engine, hanging
    ]);
    const mat = this._hullMaterial('metal_rust', 0x5a5148);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'match_crash_airframe';
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.userData.owNoShadow = true;
    this.group.add(mesh);
    this.hull = mesh;
    this.hullMat = mat;
  }

  /** Same reasoning as `Strafe._hullMaterial`: our own tint on the library bake. */
  _hullMaterial(name, tint) {
    const set = this._lib?.getTextureSet?.(name) ?? null;
    const mat = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.72,
      metalness: 0.25,
      dithering: true,
      /** It is on fire for the whole of its own event, so it is never black. */
      emissive: new THREE.Color(0x2a0e04),
    });
    mat.name = `crash_${name}`;
    if (set) {
      mat.map = set.albedo;
      mat.normalMap = set.normal;
      mat.roughnessMap = set.orm;
    }
    this.ctx.peek('render')?.patcher?.patch?.(mat);
    return mat;
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * THE FIRE — camera-facing billboards, one uniform, no per-frame work
   * ────────────────────────────────────────────────────────────────────────
   * `CELLS * TONGUES` quads, every one of them placed at boot on ITS OWN
   * ground height. The whole field lives on one `uT` uniform, exactly as
   * `makeChunkMaterial`'s chunks do:
   *
   *   aFire.x  the second this tongue lights (the plough passing it)
   *   aFire.y  its own phase, so no two flicker together
   *   aFire.z  its height in metres
   *   aFire.w  its flicker rate
   *
   * ────────────────────────────────────────────────────────────────────────
   * WHY BILLBOARDS AND NOT CONES, WHICH IS WHAT THIS WAS FIRST
   * ────────────────────────────────────────────────────────────────────────
   * The first version extruded a five-sided `ConeGeometry` per tongue and it
   * was photographed (`_nfcrashshot.mjs`, `CRASH-7-scar-close.png`): a hundred
   * and eighty-nine WHITE PAPER CONES standing on a hillside. Additive blending
   * on a solid cone gives it a hard silhouette and a flat interior, which is
   * the exact opposite of fire — and no number in this repo would ever have
   * caught it, which is the argument for the screenshot gate.
   *
   * A flame has no silhouette. So each tongue is now a quad built IN VIEW SPACE
   * — the instance's origin is transformed to view space and the corners are
   * offset there, so it always faces the camera and still grows from its own
   * base — with the shape carried entirely by the fragment's alpha: a taper
   * that closes to a point, a soft edge, and a body that goes transparent
   * towards the tip so the tongues behind show through the ones in front.
   *
   * ────────────────────────────────────────────────────────────────────────
   * AND IT STILL PHOTOGRAPHED PALE, FOR A REASON THAT IS IN THE COMPOSITE
   * ────────────────────────────────────────────────────────────────────────
   * Its own author signed it off as "better than cones, not final — the flames
   * still read slightly pale at distance". Photographed properly (20 m, 80 m,
   * 200 m, at night: `shots/scar/SCAR-before-*.png`) it was not slightly pale,
   * it was CREAM: pale straw needles with no orange in them at all, standing on
   * grass the fire was not lighting.
   *
   * THE COLOURS IN THIS SHADER ARE NOT THE COLOURS ON THE SCREEN, and that is
   * the whole bug. `render/index.js` sets `renderer.toneMapping =
   * NoToneMapping` and tonemaps in the composite instead, where the frame is
   * first multiplied by an AUTO-EXPOSURE — measured at roughly 14x on this
   * night map, and `composite.js` says so in its own comment — and then run
   * through AgX. AgX desaturates hard as it rolls off, which it must: that is
   * what stops every bright thing in the game from being a colour cast. So a
   * fragment authored at `vec3(1.0, 0.34, 0.05)` arrives at the tone mapper as
   * `(14, 4.8, 0.7)`, which is three channels all far above the shoulder, and
   * three channels above the shoulder is WHITE whatever their ratio was.
   *
   * Being brighter cannot fix that; it is what causes it. The two things that
   * do are:
   *
   *   1. FAR MORE SATURATION THAN LOOKS RIGHT IN THE SOURCE. The body of the
   *      flame is `(1.00, 0.150, 0.012)` — a colour that would be nearly pure
   *      red on any ordinary display and is a correct orange after 14x and AgX.
   *      Yellow-white is authored ONLY for the root, where a fire really is
   *      that hot, and it is reached through `heat` rather than being the
   *      average colour of the whole tongue.
   *   2. A PER-TONGUE RADIANCE WELL UNDER ONE. Each tongue contributes about a
   *      third of what it used to, so a single one is a dim orange lick and it
   *      takes three or four overlapping to reach the hot core. THAT is the
   *      crowd argument made in radiance instead of in count: the bright part
   *      of the fire is now a place where tongues agree, which is a thing the
   *      eye cannot count, rather than each tongue being individually white.
   *
   * `heat` also carries `body`, so a tongue's SPINE is hotter than its edges.
   * A flame's cross-section is not flat and a flat one reads as paper.
   */
  _buildFlames(physics) {
    const n = CELLS * (TONGUES + BED);
    /** A unit quad with its BASE on y=0, so scaling y is scaling the flame. */
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = g.index;
    geo.attributes.position = g.attributes.position;
    geo.attributes.uv = g.attributes.uv;
    g.dispose();

    const fire = new Float32Array(n * 4);
    /** x, y, z of the base and the tongue's own width. */
    const at = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    /** 0 = a tongue, 1 = a quad of the bed. @see BED */
    const kind = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    let k = 0;
    let lifted = 0;
    for (let c = 0; c < CELLS; c++) {
      for (let j = 0; j < TONGUES + BED; j++, k++) {
        const bed = j >= TONGUES;
        const a = this.rng.range(0, Math.PI * 2);
        /**
         * `float()^1.6` RATHER THAN `sqrt(float())`. The square root spreads
         * points evenly over the disc, which is right for scattering debris and
         * wrong for a fire: it put as much flame on the cold outer edge of the
         * swathe as on the line the wreck actually ploughed. This biases inward,
         * so the scar has a bright spine and a ragged edge.
         *
         * THE BED IS THE EXCEPTION AND IT IS DELIBERATELY FLAT (^0.95, very
         * slightly biased OUTWARD of the even spread): the burning floor has to reach the edges of the
         * swathe or the scar is a bright line with dark ground either side of
         * it, which is what 24 m of `BURN_W` is for. The SPINE is the tongues'
         * job and they still bias hard into it.
         */
        const r = Math.pow(this.rng.float(), bed ? 0.95 : 1.6) * BURN_W * 0.5;
        const x = this._cx[c] + Math.cos(a) * r;
        const z = this._cz[c] + Math.sin(a) * r;
        /**
         * ITS OWN GROUND, NOT ITS CELL'S. Measured on the first build: a tongue
         * may sit 12 m from its cell's centre and this plain rolls, so taking
         * the cell's height put the worst flame 1.53 m in the air and
         * twenty-three of them more than a metre under the turf. `groundHeight`
         * is a boot-time call and there are 189 of them, once.
         */
        const y = physics ? physics.groundHeight(x, z, 400) : this._cy[c];
        if (Math.abs(y - this._cy[c]) > 0.5) lifted++;
        at.array[k * 4 + 0] = x;
        /** The bed sits deeper: it is ground that is alight, not a lick of it. */
        at.array[k * 4 + 1] = y - (bed ? 0.35 : 0.25);
        at.array[k * 4 + 2] = z;
        kind.array[k] = bed ? 1 : 0;
        if (bed) {
          /**
           * WIDE AND LOW. 3.2-7.0 m of half-width against 0.7-2.0 m of height,
           * so a bed quad is three to twenty times WIDER than it is tall — the
           * exact inverse of a tongue, and the reason a cell reads as a patch of
           * ground on fire rather than as a bundle of sticks.
           *
           * SIXTEEN OF THEM, THIS WIDE, BECAUSE OF THE 200 m FRAME. Twelve at
           * 5.5 m left most of a 24 m swathe dark, and at 200 m what was left
           * was a five-pixel dashed orange line where a 157 x 24 m fire should
           * have been a band twenty-five pixels deep. The bed has to COVER the
           * swathe — that is the difference between a fire you can see from the
           * far side of the map and a row of lights.
           */
          at.array[k * 4 + 3] = this.rng.range(3.2, 7.0);
          fire[k * 4 + 2] = this.rng.range(0.7, 2.0);
          /** Slower than a tongue. A burning floor breathes; it does not whip. */
          fire[k * 4 + 3] = this.rng.range(0.7, 1.9);
        } else {
          /**
           * HALF-WIDTH 0.26-0.8 m against a height of 1.8-5.5, i.e. a tongue
           * three to ten times taller than it is wide. It was 0.7-2.1 against
           * 1.4-4.6 — as wide as it was tall — and a flame that is as wide as it
           * is tall is a traffic cone.
           *
           * 0.26-0.8 -> 0.40-1.15, and the height is drawn `1.5 + u^2 * 3.9`
           * rather than uniformly. Both are the same correction: at 20 m the
           * uniform draw gave twenty-seven cells of near-identical needles, and
           * a fire is mostly LOW with a few tall licks in it. Squaring the
           * uniform puts two thirds of the tongues under 2.2 m and still throws
           * the occasional 5 m one, which is the size distribution the eye
           * reads as turbulence instead of as a fence.
           */
          at.array[k * 4 + 3] = this.rng.range(0.40, 1.15);
          const u = this.rng.float();
          fire[k * 4 + 2] = 1.5 + u * u * 3.9;
          fire[k * 4 + 3] = this.rng.range(2.2, 4.6);
        }
        fire[k * 4 + 0] = this._ct[c] + this.rng.range(0, 0.5);
        fire[k * 4 + 1] = this.rng.range(0, 20);
      }
    }
    geo.setAttribute('aAt', at);
    geo.setAttribute('aFire', new THREE.InstancedBufferAttribute(fire, 4));
    geo.setAttribute('aKind', kind);
    geo.instanceCount = n;
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3((this._cx[0] + this._cx[CELLS - 1]) / 2, this._cy[0] + 4, (this._cz[0] + this._cz[CELLS - 1]) / 2),
      this._len
    );
    this._lifted = lifted;

    this._fireU = { uT: { value: -1 }, uFade: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this._fireU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: `
        attribute vec4 aAt;     // xyz base, w half-width
        attribute vec4 aFire;   // x light-at, y phase, z height, w flicker
        attribute float aKind;  // 0 tongue, 1 bed
        uniform float uT;
        varying vec2 vUv;
        varying float vHot;
        varying float vKind;
        void main() {
          vUv = uv;
          vKind = aKind;
          float on = step( aFire.x, uT );
          float age = max( 0.0, uT - aFire.x );
          // Two out-of-phase sines: one body flicker, one faster tip flutter.
          float f = sin( age * aFire.w + aFire.y ) * 0.5 + sin( age * aFire.w * 2.7 + aFire.y * 1.7 ) * 0.5;
          float grow = clamp( age * 1.9, 0.0, 1.0 );
          // A tongue whips through two thirds of its height; the bed only
          // breathes, because ground that is alight does not change shape.
          float amp = mix( 0.32, 0.11, aKind );
          float h = aFire.z * ( 1.0 - amp + f * amp ) * grow * on;
          float w = aAt.w * ( 0.92 + f * 0.12 );
          vHot = 0.55 + f * 0.45;
          /**
           * THE BILLBOARD, BUILT IN VIEW SPACE. The base goes through the model
           * view once; the corners are then offset on the view axes, so the quad
           * faces the camera from every bearing and still stands on its base.
           */
          vec4 base = modelViewMatrix * vec4( aAt.xyz, 1.0 );
          /**
           * WHY THE FIRE WENT PALE AT EIGHTY METRES, AND IT IS NOT THE COLOUR.
           *
           * The tongue's shape is carried by the FRAGMENT's alpha, evaluated
           * once at each pixel centre. That is fine while the quad is many
           * pixels across; it is not fine when the quad is one or two, because
           * the only samples taken are somewhere out on the flanks where the
           * taper has already closed, and the tongue loses most of its own
           * energy to where the samples happened to land. It does not fade
           * evenly, either: it scintillates and averages dim, which is exactly
           * "reads pale at distance" and is why no change of colour fixed it.
           *
           * So a quad is never allowed to subtend less than MIN_ANG of the
           * view, and whatever it is widened by it is dimmed by — a little
           * less than exactly (^0.85), because a fire at 200 m genuinely does
           * glow through the air rather than merely getting smaller. This is a
           * function of the instance and the camera, so it stays closed-form
           * and costs nothing per frame; the depth is already in hand.
           */
          float depth = max( -base.z, 1.0 );
          float widen = max( 1.0, 0.0016 / max( w / depth, 1e-6 ) );
          w *= widen;
          vHot /= pow( widen, 0.85 );
          // Lean the tip with its own phase — a flame is never plumb. The bed
          // does not lean: it has no tip to lean.
          float lean = sin( age * 0.8 + aFire.y ) * 0.13 * ( 1.0 - aKind );
          base.x += position.x * w + position.y * h * lean;
          base.y += position.y * h;
          gl_Position = projectionMatrix * base;
        }`,
      fragmentShader: `
        uniform float uFade;
        varying vec2 vUv;
        varying float vHot;
        varying float vKind;
        void main() {
          float t = vUv.y;
          float d = abs( vUv.x - 0.5 ) * 2.0;
          /**
           * THE SHAPE IS THE ALPHA, NOT THE MESH, and the falloff has to be
           * SOFT ALL THE WAY OUT or the quad's own edge shows. The first pass
           * used one smoothstep between two fractions of the taper -- a hard-ish
           * shoulder -- and 189 of them read as pale triangles. This has no
           * shoulder at all: bright on the spine, asymptotic at the edge, so the
           * tongue has no outline to give it away.
           *
           * The BED closes far later and far more gently than a tongue does:
           * 1 - t*t holds nearly its full width to two thirds of its height and
           * only then rolls off, so it reads as a mound of burning ground
           * rather than as a very fat lick.
           *
           * (No backticks in here. This comment lives inside a JS template
           * literal and one backtick ends the shader.)
           */
          float taper = mix( pow( 1.0 - t, 0.55 ), pow( max( 0.0, 1.0 - t * t ), 0.40 ), vKind );
          float body = pow( max( 0.0, 1.0 - d / max( taper, 1e-3 ) ), 2.2 );
          float fall = mix( pow( 1.0 - t, 1.6 ), pow( 1.0 - t, 1.0 ), vKind );
          /**
           * RADIANCE PER QUAD, AND IT IS DELIBERATELY A FRACTION.
           *
           * See the header of _buildFlames — the composite multiplies this
           * frame by ~14x before AgX sees it, so a quad that peaks near 1 is a
           * quad that arrives white however it was coloured. At 0.38 a single
           * tongue is a dim orange lick and it takes three or four overlapping
           * to make the hot core, which is the crowd argument stated in
           * radiance rather than in count. The bed is lower again (0.34) and
           * there are sixteen of them a cell, so the floor of the fire is bright
           * because it is CONTINUOUS and not because any part of it is intense.
           */
          float a = body * fall * uFade * vHot * mix( 0.42, 0.34, vKind );
          if ( a <= 0.004 ) discard;
          /**
           * TEMPERATURE, NOT PAINT. heat is 1 on the spine of the root and 0
           * at the tip and the edges, and the ramp below is the order a real
           * flame cools in: yellow where the fuel is burning, orange through
           * the body, deep red where it is going out. Carrying body into it
           * is what gives the tongue a hot centre line and cool flanks — a
           * flame's cross-section is not flat, and a flat one reads as paper.
           *
           * THESE NUMBERS LOOK WRONG IN THE SOURCE AND ARE RIGHT ON THE SCREEN.
           * (1.00, 0.150, 0.012) is very nearly pure red here; after 14x
           * exposure and AgX's roll-off it is the orange of a fire. Anything
           * with more green in it than this comes out cream, which is exactly
           * what the previous (1.0, 0.66, 0.20) did.
           */
          float heat = pow( 1.0 - t, 1.25 ) * ( 0.55 + 0.45 * body );
          vec3 c = mix( vec3( 0.42, 0.030, 0.004 ), vec3( 1.00, 0.150, 0.012 ),
                        smoothstep( 0.10, 0.58, heat ) );
          c = mix( c, vec3( 1.00, 0.520, 0.150 ), smoothstep( 0.66, 1.00, heat ) );
          gl_FragColor = vec4( c, a );
        }`,
    });
    mat.name = 'crash_fire';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'match_crash_fire';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 6;
    mesh.visible = false;
    this.group.add(mesh);
    /**
     * `flames`, NOT `fire`. It was `this.fire` for exactly one build, which
     * SHADOWED THE `fire()` METHOD with a `THREE.Mesh` — so the beat that fires
     * this act threw `this.crash?.fire is not a function` on the frame the
     * satellite was supposed to appear, and `?.()` does not save you from a
     * property that is truthy and not callable.
     */
    this.flames = mesh;
    this.fireMat = mat;
    this.fireGeo = geo;
  }

  /* ====================================================================== */
  /*  FIRE, AND THE FRAME IT COSTS                                          */
  /* ====================================================================== */

  /**
   * Bring it down. One assignment and two flags — everything this plays was
   * solved in `build()`.
   * @returns {boolean} false when this map has no track
   */
  fire() {
    if (!this.ready || !this.enabled) return false;
    this._t = 0;
    this._cell = 0;
    this._puff = 0;
    this.struck = false;
    this.busy = true;
    /** A second firing must not strand the first one's voice. @see _plough */
    this._stopPlough();
    this._fireU.uT.value = -1;
    this._fireU.uFade.value = 1;
    this.flames.visible = false;
    console.info(
      `[crash] INBOUND — ${this._fall.toFixed(1)}s to impact at ` +
        `(${this.impact.x.toFixed(0)}, ${this.impact.z.toFixed(0)}), ` +
        `descent ${((this._pitch * 180) / Math.PI).toFixed(0)}°`
    );
    return true;
  }

  /** Where the airframe is at `t` seconds after entry. Closed form, no state. */
  _poseAt(t, out) {
    if (t <= this._fall) {
      const u = t / this._fall;
      out.set(
        this._ex + (this.impact.x - this._ex) * u,
        this._ey + (this.impact.y - this._ey) * u,
        this._ez + (this.impact.z - this._ez) * u
      );
      return;
    }
    /** After contact it is on the ground, decelerating up the scar. */
    const u = Math.min(1, (t - this._fall) / PLOUGH);
    const d = 1 - (1 - u) * (1 - u);
    out.set(
      this.impact.x + this._hx * this._len * d,
      this._groundAlong(d) + 0.9,
      this.impact.z + this._hz * this._len * d
    );
  }

  /**
   * THE GROUND UNDER THE WRECK, `d` of the way along the scar.
   *
   * `this.impact.y + 0.9` was the whole of this and it was measured wrong
   * (`_nfcrashshot.mjs`): the impact point's ground is 1.6 m and the far end of
   * the plough is 3.8 m, so the hull finished the skid 2.2 m UNDER the turf —
   * and a raycast could never have said so, because it carries no collision.
   *
   * The heights are already baked, one per fire cell, off `physics.groundHeight`
   * at boot. This is a lerp between two of them and no probe at all.
   */
  _groundAlong(d) {
    const n = CELLS;
    const f = Math.max(0, Math.min(n - 1, d * (n - 1)));
    const i = Math.min(n - 2, f | 0);
    const k = f - i;
    return this._cy[i] * (1 - k) + this._cy[i + 1] * k;
  }

  update(dt) {
    if (!this.ready) return;

    /* ---- the ground, still burning ------------------------------------ */
    if (this._burn > 0) {
      this._burn -= dt;
      this._fireU.uT.value += dt;
      // The last twelve seconds it goes out rather than vanishing.
      this._fireU.uFade.value = Math.min(1, this._burn / 12);
      if (this._searLeft > 0) {
        this._searLeft -= dt;
        this._sear -= dt;
        if (this._sear <= 0) {
          this._sear = SEAR_EVERY;
          this._searPass();
        }
      }
      if (this._burn <= 0) this._extinguish();
    }

    if (this._t < 0) return;
    this._t += dt;
    const t = this._t;

    /* ---- the approach -------------------------------------------------- */
    if (t < this._fall) {
      this._poseAt(t, this._v);
      this._poseHull(this._v, this._pitch, t * 1.1);
      this._trail(dt, this._v, t);
      return;
    }

    /* ---- contact ------------------------------------------------------- */
    if (!this.struck) {
      this.struck = true;
      this._impact();
    }

    /* ---- the plough ---------------------------------------------------- */
    const skid = t - this._fall;
    this._poseAt(t, this._v);
    this._poseHull(this._v, 0.06, 0);
    this._fireU.uT.value = skid;
    while (this._cell < CELLS && this._ct[this._cell] <= skid) this._light(this._cell++);

    /**
     * ────────────────────────────────────────────────────────────────────
     * THE VOICE TRAVELS WITH THE WRECK, AND ITS PITCH IS THIS DERIVATIVE
     * ────────────────────────────────────────────────────────────────────
     * `_poseAt` skids on `d = 1 - (1-u)^2`, so the ground speed is
     * `len * dd/du / PLOUGH` = `len * 2(1-u) / PLOUGH` — 64 m/s on the frame
     * of contact, falling LINEARLY to nothing at rest. It is differentiated
     * here rather than measured off successive positions for the reason
     * `battle.js` has to do the opposite: that file cannot see inside a tank
     * and must difference what it is given, and this one authored the curve
     * two lines up. Differencing it would be measuring our own arithmetic
     * through a frame time.
     *
     * `src/audio/crash.js` turns that number into a RATE of stick-slip grabs,
     * so the pitch of the scrape falls because the wreck is slowing down and
     * cannot drift out of step with the picture. `u` goes as the second
     * argument: it is how far into the furrow the wreck has buried itself,
     * and it is what closes the airframe's ring down.
     *
     * IT ENDS AT `PLOUGH`, NOT AT `PLOUGH + 0.4`. The wreck is at rest from
     * `skid = 5.0`; the extra four tenths below are for the fire and the
     * camera. Carrying the scrape through them would be four tenths of a
     * second of a stationary object grinding.
     */
    if (this._plough) {
      if (skid >= PLOUGH) {
        this._plough.stop();
        this._plough = null;
      } else {
        const u = skid / PLOUGH;
        this._plough.drive(
          (this._len * 2 * (1 - u)) / PLOUGH, u,
          this._v.x, this._v.y, this._v.z
        );
      }
    }

    if (skid >= PLOUGH + 0.4) {
      this._t = -1;
      this.busy = false;
      this._burn = BURN_S;
      this._searLeft = SEAR_S;
      this._sear = SEAR_EVERY;
      console.info(
        `[crash] AT REST at (${this._v.x.toFixed(0)}, ${this._v.z.toFixed(0)}) — ` +
          `${CELLS} cells alight over ${this._len.toFixed(0)} m, ` +
          `${SEAR_S}s of burn damage, ${BURN_S}s of fire`
      );
    }
  }

  /** One matrix compose. `roll` spins it about its own axis as it falls. */
  _poseHull(at, pitch, roll) {
    this._eul.set(-pitch, this._yaw, roll * 0.5, 'YXZ');
    this._q.setFromEuler(this._eul);
    this._m.compose(at, this._q, this._sc);
    this.hull.matrix.copy(this._m);
    this.hull.matrixWorldNeedsUpdate = true;
    this.hull.visible = true;
  }

  /**
   * THE TRAIL, and it is rate-limited rather than per-frame.
   *
   * Four puffs a second down a thirteen-second approach is fifty-odd emitters
   * for the whole event, which is what `Ambience` is sized for. A puff per frame
   * at 120 fps would be sixteen hundred.
   */
  _trail(dt, at, t) {
    this._puff -= dt;
    if (this._puff > 0) return;
    this._puff = 0.25;
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (!fx) return;
    fx.addSmokeColumn?.(at.x, at.y, at.z, {
      duration: 0.1, rate: 26, radius: 2.6, rise: 5.0, dark: 0.2,
      life: 6.0, growth: 7.0, ember: 0.7, haze: 0.5,
    });
    fx.haze?.(at.x, at.y, at.z, 5.0, 14, 1.6, 1.1);
    // It lights the ground it is passing over — the whole point of a night map.
    if (fx.lights) fx.lights.flash(at.x, at.y, at.z, 1, 0.55, 0.2, 2600, 0.5, 1.2, 260, 5);
    // …and it is heard before it is understood.
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    audio?.play?.('strike_jet', at, {
      level: 1.4, dur: 0.6, maxDist: 900, gain: 4.4, occlusion: 0.05,
    });
  }

  /**
   * THE IMPACT. One blast, and it is the largest single one on either map.
   *
   * `fx.explosion` is the game's own full-fat path — fireball, shockwave,
   * debris, smoke column, light and scorch in one call — so this is not a new
   * explosion, it is the existing one at the size the event deserves.
   */
  _impact() {
    const at = this.impact;
    const p = this._blast;
    p.position = this._v2.copy(at).setY(at.y + 2.2);
    p.radius = 34;
    p.damage = 240;
    p.source = 'crash';
    this.ctx.events.emit('explosion', p);
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (fx) {
      fx.explosion?.({ position: p.position, radius: 26 });
      fx.scorch?.(at.x, at.y - 0.3, at.z, 20);
      fx.hazeRing?.(at.x, at.y + 1.4, at.z, 10, 90, 1.6, 3.4);
      fx.haze?.(at.x, at.y + 10, at.z, 20, 34, 5.0, 2.0);
      if (fx.lights) fx.lights.flash(at.x, at.y + 6, at.z, 1, 0.6, 0.24, 9000, 2.6, 2.6, 320, 8);
    }
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));
    audio?.play?.('strike_rubble', at, {
      level: 2.0, dur: 5.0, maxDist: 1200, gain: 6.0, occlusion: 0.05,
    });
    audio?.play?.('strike_tail', at, {
      level: 1.6, dur: 4.0, maxDist: 1000, gain: 4.0, occlusion: 0.1,
    });
    /**
     * ──────────────────────────────────────────────────────────────────────
     * THE FLOOR UNDER THE BIGGEST EVENT IN THE GAME, WHICH IT DID NOT HAVE
     * ──────────────────────────────────────────────────────────────────────
     * MEASURED with `_collvoice.mjs` before this line: the whole act — thirteen
     * seconds of approach, a 34 m blast and 160 m of burning plain — made 0
     * calls to any `collapse_*` and put 0 emitters tagged `collapse` in the
     * field. What it had was the two voices above, and the argument
     * `src/audio/collapse.js` opens with is precisely that those two ARE NOT
     * ENOUGH FOR SOMETHING THIS SIZE and no amount of gain makes them enough:
     * `strikeRubble` is masonry ARRIVING and `strikeTail` is mid-heavy BY
     * CONSTRUCTION (it is a roll built to carry across a map), so between them
     * this event had nothing at all below 40 Hz. The weight of something
     * falling out of orbit is not loudness, it is bandwidth.
     *
     * AND IT IS THE HALF OF 「もっと音大きく激しくして」 THAT LOUDNESS CANNOT BUY.
     * `AudioSystem._playCollapse` ducks the whole mix and concusses the
     * listener on `collapse_sub` SPECIFICALLY — everything else in the match
     * getting out of the way for half a second is what makes an event enormous
     * once the limiter is already working, and it is the one thing this event
     * was not doing. The fortress magazine got it this session; the act that
     * the map's own header calls its signature did not.
     *
     * WHAT IS PASSED, AND WHAT DELIBERATELY IS NOT. `dur` and `maxDist` only:
     * how long the thing takes and how far a 400 m plain has to carry it are
     * facts about this event, and gain, occlusion, priority, the duck depth and
     * the concussion are facts about the MIX — they live in `_playCollapse`,
     * they were measured, and a caller that restates them is a caller that goes
     * stale. This is the same bag the fortress magazine passes, one beat longer.
     * (`_onExplosion` restating `send: 1.0` is what killed a whole reverb pass.)
     *
     * NO `collapse_tear`. It is tempting — the plough IS five seconds of an
     * airframe coming apart — but that voice is masonry to its bones: three
     * load-shed modes of a MASONRY BOX, vault ribs and floor plates. Using it
     * on a satellite would be the wrong voice played correctly. The plough's
     * own sound is a separate piece of work and it is NOT done here; say so
     * rather than half-do it.
     *
     * THAT WORK IS DONE NOW, AND IT IS ITS OWN VOICE. @see src/audio/crash.js.
     * The reasoning above stands unchanged — nothing about this wreck is
     * failing under its own weight, it is being DRAGGED — so what plays over
     * the next five seconds is stick-slip: a rate of grabs set by the ground
     * speed, which falls three decades as the wreck decelerates and takes the
     * pitch of the whole voice down with it. It is started on the frame of
     * contact, one line under the blast, because the ground contact IS the
     * event; it travels with the wreck (`update` below drives it); and it
     * ENDS, on a settle, rather than fading out.
     */
    audio?.play?.('collapse_sub', at, { dur: 2.6, maxDist: 1200 });
    /**
     * `?? null` AND NOT `??=`. `startPlough` returns null when there is no
     * graph yet, when the pool refused the slot or when nobody is near enough
     * to spend one on — all three are ordinary, none is an error, and every
     * call site below is `this._plough?.`. A truthy-but-not-callable handle is
     * what shadowed `fire()` with a mesh and threw on the frame this act was
     * supposed to appear; a null is safe in a way that was learned here.
     */
    this._plough = audio?.startPlough?.(at) ?? null;
    this.flames.visible = true;
    console.info(`[crash] IMPACT at (${at.x.toFixed(0)}, ${at.y.toFixed(1)}, ${at.z.toFixed(0)}) — 34 m blast`);
  }

  /** The plough reaches one cell: it scorches, it smokes, and it stays alight. */
  _light(i) {
    const x = this._cx[i];
    const y = this._cy[i];
    const z = this._cz[i];
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    if (fx) {
      fx.scorch?.(x, y - 0.25, z, BURN_W * 0.42);
      // A persistent source per THIRD cell — nine columns down 160 m of scar is
      // a continuous plume; twenty-seven is a wall the frame budget notices.
      if (i % 3 === 0) {
        const tag = fx.addSmokeSource?.({ x, y: y + 0.6, z }, {
          rate: 5.5, radius: 2.2, rise: 2.4, dark: 0.16, life: 5.6,
          growth: 5.0, ember: 0.6, haze: 0.4,
        });
        if (tag !== undefined && tag !== null) this._smoke.push(tag);
      }
      /**
       * THREE LONG-LIVED LIGHTS DOWN 160 m, AND NOT ONE PER CELL.
       *
       * `LightPool` has a fixed slot budget that `plains.js` already spends five
       * of on the ridge fires ("five fires fit inside it with room to spare"),
       * and a light held for a minute is a slot no muzzle flash can have.
       * `priority: 1` is the ordinary tier on purpose — if the pool is under
       * pressure these are evicted like anything else, and the fire is still
       * there in the flame mesh and the smoke.
       */
      if (i % 9 === 0 && fx.lights) {
        fx.lights.flash(x, y + 2.4, z, 1, 0.5, 0.18, 1400, 60, 0.004, 120, 1);
      }
    }
    const p = this._blast;
    p.position = this._v2.set(x, y + 1.0, z);
    p.radius = 9;
    p.damage = 70;
    p.source = 'crash';
    this.ctx.events.emit('explosion', p);
  }

  /**
   * ONE PASS OF BURN DAMAGE over the whole scar. Every `SEAR_EVERY` seconds for
   * `SEAR_S`, and then the fire is scenery.
   *
   * It is EVERY OTHER CELL, alternating, rather than all of them: fourteen
   * small blasts is one event handler pass, and a man walking the scar crosses
   * one of them either way. Standing in it is what this punishes.
   */
  _searPass() {
    const p = this._blast;
    const odd = (this._searLeft / SEAR_EVERY) & 1;
    for (let i = odd; i < CELLS; i += 2) {
      p.position = this._v2.set(this._cx[i], this._cy[i] + 0.9, this._cz[i]);
      p.radius = SEAR_R;
      p.damage = SEAR_DMG;
      p.source = 'crash';
      this.ctx.events.emit('explosion', p);
    }
  }

  /**
   * END THE SCRAPE IF ONE IS RUNNING. Idempotent, and deliberately NOT folded
   * into `_extinguish`: putting the fire out and stopping the plough are two
   * different events five seconds apart, and `_extinguish` is also what runs
   * 240 seconds later when the ground finally stops burning.
   */
  _stopPlough() {
    if (!this._plough) return;
    this._plough.stop();
    this._plough = null;
  }

  /** The fire is out. Take the smoke back and hide the field. */
  _extinguish() {
    this._burn = 0;
    this._searLeft = 0;
    this.flames.visible = false;
    const fx = this._fx ?? (this._fx = this.ctx.peek('fx'));
    for (const tag of this._smoke) fx?.removeSmokeSource?.(tag);
    this._smoke.length = 0;
  }

  /** Out of sight under the map. @see `Bomber._park`. */
  _park() {
    this._v.set(0, PARKED_Y, 0);
    this._q.identity();
    this._m.compose(this._v, this._q, this._sc);
    this.hull.matrix.copy(this._m);
    this.hull.matrixWorldNeedsUpdate = true;
    this.hull.visible = false;
  }

  /**
   * ROUND RESET: nothing falling, nothing burning, no wreck on the grass.
   *
   * The wreck IS put away here and the two `world.demolitions` records are not
   * (@see the note in `MatchSystem._setPhase`), and the difference is that this
   * one owns its own object. A record that stays down is an existing behaviour
   * of a path this change does not touch; a burning hull that survived a round
   * reset would be this file's own leak.
   */
  reset() {
    /**
     * A MAP WITH NO CRASH TRACK HAS NO AIRFRAME AND NO FLAMES.
     *
     * `build()` returns early on any map `MAP_TRACK` does not author — the town
     * — leaving `ready` false and `flames`, `hull` and `_fireU` undefined.
     * `MatchSystem._beginRound` calls `this.crash?.reset()`, and `?.` does not
     * help: the object exists, it is its fields that do not. Unguarded this
     * threw `Cannot set properties of undefined (setting 'visible')` out of
     * `_extinguish` on EVERY round begin — measured at 2688 pageerrors in 25 s
     * on the town, which never left warmup.
     *
     * Same shape as `fire()` and `update()`, which both open on `ready`. This
     * is the third entry point and it was the one without the test.
     */
    if (!this.ready) return;
    this._t = -1;
    this._cell = 0;
    this.struck = false;
    this.busy = false;
    this._stopPlough();
    this._extinguish();
    this._fireU.uT.value = -1;
    this._fireU.uFade.value = 1;
    this._park();
  }

  dispose() {
    /**
     * THE VOICE IS NOT GATED ON `ready` AND THE FIRE IS.
     *
     * `_extinguish` dereferences `this.flames`, which a map with no crash track
     * does not have — that is the bug `reset()`'s own note is about, measured at
     * 2688 pageerrors on the town. `_stopPlough` reads one nullable field of
     * this object and can be called on any map in any state, so it is outside
     * the test: a guard that is wider than its dereference is how this file
     * shipped a crash, and a guard that is narrower is how audio shipped six.
     */
    this._stopPlough();
    /** @see the note in `reset()` — a map with no track has nothing to put out. */
    if (this.ready) this._extinguish();
    this.hull?.geometry?.dispose();
    this.hullMat?.dispose();
    this.fireGeo?.dispose();
    this.fireMat?.dispose();
    this.group.parent?.remove(this.group);
  }
}
