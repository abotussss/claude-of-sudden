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
/** Flame tongues per cell. */
const TONGUES = 7;
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
    this._buildFlames();
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
        `(${(n * TONGUES)} flames, ${BURN_W} m wide, burns ${BURN_S}s)`
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
   * THE FIRE — one InstancedMesh, one uniform, no per-frame work
   * ────────────────────────────────────────────────────────────────────────
   * `CELLS * TONGUES` tapered boxes, every one of them placed at boot on a real
   * ground height. The whole field lives on ONE `uT` uniform, exactly as
   * `makeChunkMaterial`'s chunks do:
   *
   *   aFire.x  the second this tongue lights (the plough passing it)
   *   aFire.y  its own phase, so no two flicker together
   *   aFire.z  its height in metres
   *   aFire.w  its flicker rate
   *
   * The vertex shader scales it about its own base — a flame that shrank about
   * its centre would sink into the ground — and the fragment shader takes it
   * from white-hot at the base to smoke at the tip. It is unlit, additive and
   * depth-write-off, which is what makes fifty overlapping tongues read as one
   * body of flame rather than as fifty boxes.
   */
  _buildFlames() {
    const n = CELLS * TONGUES;
    const g = new THREE.ConeGeometry(0.5, 1.0, 5, 1, true);
    g.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = g.index;
    geo.attributes.position = g.attributes.position;
    geo.attributes.normal = g.attributes.normal;
    geo.attributes.uv = g.attributes.uv;
    g.dispose();

    const fire = new Float32Array(n * 4);
    const mtx = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    let k = 0;
    for (let c = 0; c < CELLS; c++) {
      for (let j = 0; j < TONGUES; j++, k++) {
        const a = this.rng.range(0, Math.PI * 2);
        const r = Math.sqrt(this.rng.float()) * BURN_W * 0.5;
        v.set(
          this._cx[c] + Math.cos(a) * r,
          this._cy[c] - 0.2,
          this._cz[c] + Math.sin(a) * r
        );
        const w = this.rng.range(0.9, 2.4);
        s.set(w, 1, w);
        q.setFromAxisAngle(this._up, this.rng.range(0, Math.PI * 2));
        m.compose(v, q, s);
        m.toArray(mtx.array, k * 16);
        fire[k * 4 + 0] = this._ct[c] + this.rng.range(0, 0.5);
        fire[k * 4 + 1] = this.rng.range(0, 20);
        fire[k * 4 + 2] = this.rng.range(1.6, 5.2);
        fire[k * 4 + 3] = this.rng.range(2.2, 4.6);
      }
    }
    /**
     * `aMat`, NOT `instanceMatrix`. This is a plain `Mesh` over an
     * `InstancedBufferGeometry` rather than an `InstancedMesh`, so three does
     * not define `USE_INSTANCING` and does not declare `instanceMatrix` for us —
     * the shader below declares its own. Using three's reserved name for an
     * attribute three is not managing is how that goes wrong quietly the first
     * time somebody turns this into an `InstancedMesh`.
     */
    geo.setAttribute('aMat', mtx);
    geo.setAttribute('aFire', new THREE.InstancedBufferAttribute(fire, 4));
    geo.instanceCount = n;

    this._fireU = { uT: { value: -1 }, uFade: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this._fireU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: `
        attribute mat4 aMat;
        attribute vec4 aFire;
        uniform float uT;
        varying float vY;
        varying float vSeed;
        void main() {
          vSeed = aFire.y;
          // Not lit yet: collapse it to nothing behind the camera's back.
          float on = step( aFire.x, uT );
          float age = max( 0.0, uT - aFire.x );
          // Flicker in height and in width, out of phase with each other.
          float f = sin( age * aFire.w + aFire.y ) * 0.5 + sin( age * aFire.w * 2.7 + aFire.y * 1.7 ) * 0.5;
          float grow = clamp( age * 1.6, 0.0, 1.0 );
          float h = aFire.z * ( 0.72 + f * 0.28 ) * grow * on;
          float wob = 1.0 + f * 0.12;
          vec3 p = position;
          vY = p.y;
          // Scale about the BASE, and lean the tip downwind of its own phase.
          p.xz *= wob;
          p.y *= h;
          p.x += sin( age * 0.9 + aFire.y ) * p.y * 0.16;
          p.z += cos( age * 0.7 + aFire.y ) * p.y * 0.16;
          vec4 wp = aMat * vec4( p, 1.0 );
          gl_Position = projectionMatrix * modelViewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float uFade;
        varying float vY;
        varying float vSeed;
        void main() {
          // White at the root, orange through the body, smoke-dark at the tip.
          float t = clamp( vY, 0.0, 1.0 );
          vec3 c = mix( vec3( 1.0, 0.93, 0.72 ), vec3( 1.0, 0.42, 0.10 ), smoothstep( 0.0, 0.55, t ) );
          c = mix( c, vec3( 0.28, 0.10, 0.05 ), smoothstep( 0.6, 1.0, t ) );
          float a = ( 1.0 - t ) * 0.85 * uFade;
          if ( a <= 0.002 ) discard;
          gl_FragColor = vec4( c * ( 1.0 + ( 1.0 - t ) * 0.8 ), a );
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
      this.impact.y + 0.9,
      this.impact.z + this._hz * this._len * d
    );
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
    this._t = -1;
    this._cell = 0;
    this.struck = false;
    this.busy = false;
    this._extinguish();
    this._fireU.uT.value = -1;
    this._fireU.uFade.value = 1;
    this._park();
  }

  dispose() {
    this._extinguish();
    this.hull?.geometry?.dispose();
    this.hullMat?.dispose();
    this.fireGeo?.dispose();
    this.fireMat?.dispose();
    this.group.parent?.remove(this.group);
  }
}
