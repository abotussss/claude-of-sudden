/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE DETONATION BILLBOARD — one program, one uniform, nothing in the frame
 * ════════════════════════════════════════════════════════════════════════════
 * 「母艦大爆発してないね？？？」「大爆発演出はド派手にしないと」
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AND WHY IT IS NOT `fx.explosion` AT A BIGGER RADIUS
 * ────────────────────────────────────────────────────────────────────────────
 * MEASURED (`_sfbang.mjs`, on the shipping build, at the frame the 86 m carrier
 * hits the ground):
 *
 *   t=18.383   2 lit   3 add      <- an ordinary frame
 *   t=18.400  99 lit  63 add      <- THE LARGEST EXPLOSION IN THE GAME
 *   t=18.417   2 lit   2 add      <- and it is over
 *
 * One hundred and sixty-two particles on one frame. `explode()` in
 * `src/fx/explosions.js` is a FIXED-SIZE recipe: `nFire = round(12*pScale)+5`
 * has no `R` in it anywhere, and `R` only scales the SIZES. So the biggest
 * event this game has and a rifle grenade emit the same number of sprites — the
 * grenade's are 4 m across and the carrier's are 36-60 m, which is why the
 * carrier photographed as a smooth cream DISC at 83 m and as nothing at all at
 * 240 m. It is not a small explosion. It is eleven very large pale ones.
 *
 * And it could not be fixed by asking for more of them. Both particle rings
 * were already FULL — `liveLit 2805/2805`, `liveAdd 2295/2295`, pinned there by
 * the conflagration's own smoke — so every sprite the detonation emitted
 * OVERWROTE one of the fire it was landing in. An explosion that displaces the
 * fire it lights is an explosion that cannot be made bigger by emitting harder.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SO IT IS BAKED, LIKE EVERY OTHER EXTRAVAGANT THING ON THIS MAP
 * ────────────────────────────────────────────────────────────────────────────
 * The tower's raze is 3 365 chunks in a vertex shader off one uniform. The
 * conflagration is 2 700 quads in a vertex shader off one uniform. This is
 * 1 800 quads in a vertex shader off one uniform, allocated at BOOT, and the
 * frame it fires does one write: `uT.value = 0`. It costs the particle rings
 * NOTHING — it does not take a slot from them, so the fire it lands in is the
 * fire that was already there, plus a detonation on top of it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ONE SOURCE, TWO MATERIALS, ONE PROGRAM
 * ────────────────────────────────────────────────────────────────────────────
 * Blending is renderer STATE, not a shader define, so an additive material and
 * an alpha-blended one built from this one function are two materials on ONE
 * compiled program — the same argument `src/match/fire.js` makes for the two
 * fires, and it matters for the same reason: an event this size cannot afford a
 * shader compile in its own fire frame.
 *
 * The additive mesh draws what is HOT (the core, the fireball, the column,
 * embers). The alpha-blended mesh draws what is DARK (the smoke shroud, the
 * dust wall). Additive cannot make anything darker than the sky, so a
 * detonation that is additive-only has no silhouette at all — it is the cream
 * disc again, in a different shape.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE COLOUR IS DELIBERATELY ALMOST PURE RED IN THE SOURCE
 * ────────────────────────────────────────────────────────────────────────────
 * `composite.js` multiplies this frame by ~14x auto-exposure BEFORE AgX, so
 * three channels over the shoulder is white whatever their ratio, and a white
 * fireball at night is a white disc. This is the lesson `src/match/fire.js`
 * paid for twice and it is not re-derived here — the ramp below is the same
 * shape as that file's, one step hotter at the core because a fuel-air
 * detonation genuinely has a white centre for a tenth of a second. What it may
 * NOT have is a white BODY.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE MOTION IS CLOSED FORM, WITH DRAG, AND IT IS EXACT
 * ────────────────────────────────────────────────────────────────────────────
 * For linear drag `k` and constant acceleration `a`:
 *
 *   v(t) = v0.e^-kt + (a/k)(1 - e^-kt)
 *   x(t) = v0.F + (a/k)(t - F)          where F = (1 - e^-kt)/k
 *
 * One `exp` per vertex and every particle in the event is a function of `uT`
 * alone. Nothing is integrated, nothing is stored, nothing is written back, and
 * the whole thing can be scrubbed, reset or replayed by assigning a float.
 */
import * as THREE from 'three';

/** aKin.x — what a quad is. The two meshes each draw two of them. */
export const KIND = { FIRE: 0, SMOKE: 1, EMBER: 2, DUST: 3 };

/**
 * @param {object} uniforms `{ uT, uGain }` — `{ value }` boxes the caller keeps
 *                          and drives. `uT` is seconds since the detonation and
 *                          -1 when there is not one.
 * @param {object} [o]      `{ blending, depthWrite, renderOrder }`
 * @returns {THREE.ShaderMaterial}
 */
export function makeBlastMaterial(uniforms, o = {}) {
  if (!uniforms.uGain) uniforms.uGain = { value: 1 };
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: o.blending ?? THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
        attribute vec4 aAt;    // xyz spawn, w half-width at birth
        attribute vec4 aVel;   // xyz initial velocity m/s, w half-width at death
        attribute vec4 aLife;  // x birth, y life, z drag 1/s, w vertical accel
        attribute vec4 aCol;   // xyz linear colour, w peak
        attribute vec4 aKin;   // x kind, y seed, z alpha curve, w size curve
        uniform float uT;
        varying vec2 vUv;
        varying vec3 vCol;
        varying float vA;
        varying float vKind;
        varying float vAge;
        void main() {
          vUv = uv;
          vKind = aKin.x;
          float age = uT - aLife.x;
          float life = max( aLife.y, 1e-3 );
          float u = clamp( age / life, 0.0, 1.0 );
          vAge = u;
          /**
           * ON is a product of two steps and not an if: a quad that has not been
           * born yet and a quad that is finished both collapse to zero size at
           * the spawn point, which costs one multiply and never branches.
           */
          float on = step( 0.0, age ) * ( 1.0 - step( life, age ) );
          float k = max( aLife.z, 0.02 );
          float F = ( 1.0 - exp( -k * max( age, 0.0 ) ) ) / k;
          vec3 p = aAt.xyz + aVel.xyz * F;
          p.y += ( aLife.w / k ) * ( max( age, 0.0 ) - F );
          float w = mix( aAt.w, aVel.w, pow( u, aKin.w ) ) * on;
          /**
           * SPIN OFF THE SEED. A fireball whose puffs do not turn reads as a
           * bank of decals, and a per-instance rotation attribute would be a
           * fifth vec4 for one float. fract() of the seed is deterministic,
           * costs nothing and is different for every quad.
           */
          float spin = ( fract( aKin.y * 17.13 ) - 0.5 ) * 2.6;
          float ang = aKin.y * 6.2831 + age * spin;
          float ca = cos( ang );
          float sa = sin( ang );
          vec2 q = vec2( position.x * ca - position.y * sa, position.x * sa + position.y * ca );
          vA = pow( 1.0 - u, aKin.z ) * on;
          vCol = aCol.xyz * aCol.w;
          /** The billboard, built in view space. @see src/match/fire.js. */
          vec4 base = modelViewMatrix * vec4( p, 1.0 );
          /**
           * THE NEAR FADE, AND IT IS WHY THE SAME DETONATION CAN BE RIGHT AT
           * 30 m AND AT 240 m.
           *
           * PHOTOGRAPHED from 30 m (BLAST-3-plus500ms-30m): a pure cream frame.
           * At 240 m the whole event subtends a few degrees and every quad in it
           * contributes once; at 30 m the camera is INSIDE a 60 m fireball and
           * the same quads are stacked forty deep across the screen, so the sum
           * is forty times larger for no change in the thing being drawn. Turning
           * the gain down to fix the near field emptied the far one -- measured,
           * both ways, in that order.
           *
           * So the crowding is corrected where it happens. A quad ten metres from
           * the eye carries 0.30 of its radiance and one past 55 m carries all of
           * it, which is the same shape of argument as the fire's own MIN_ANG
           * widen (a function of the instance and the camera, closed form, and the
           * depth is already in hand) applied at the other end of the range.
           *
           * (No backticks in here. This comment lives inside a JS template
           * literal and one backtick ends the shader.)
           */
          float depth = max( -base.z, 1.0 );
          vA *= mix( 0.30, 1.0, smoothstep( 10.0, 55.0, depth ) );
          base.xy += q * w;
          gl_Position = projectionMatrix * base;
        }`,
    fragmentShader: `
        uniform float uGain;
        varying vec2 vUv;
        varying vec3 vCol;
        varying float vA;
        varying float vKind;
        varying float vAge;
        void main() {
          float d = length( vUv - 0.5 ) * 2.0;
          if ( d > 1.0 ) discard;
          /**
           * SOFT ALL THE WAY OUT, NO SHOULDER. The conflagration's tongues
           * learned this the expensive way: any hard-ish edge and 189 quads read
           * as 189 quads. An ember is the one exception — it is MEANT to be a
           * point — so its falloff is much tighter.
           */
          float hard = step( 1.5, vKind ) * ( 1.0 - step( 2.5, vKind ) );
          float body = pow( max( 0.0, 1.0 - d ), mix( 2.1, 5.0, hard ) );
          float a = body * vA * uGain;
          if ( a <= 0.004 ) discard;
          /**
           * SMOKE AND DUST ARE ALPHA-BLENDED AND DARK; FIRE AND EMBERS ARE
           * ADDITIVE. The material decides which, so the fragment only has to
           * keep the dark ones from going out too fast — smoke thins rather than
           * disappearing, so its alpha is held up and its colour lifts a little
           * as it entrains air. Its own colour comes in through aCol.
           */
          float dark = step( 0.5, vKind ) * ( 1.0 - step( 1.5, vKind ) ) + step( 2.5, vKind );
          vec3 c = mix( vCol, vCol * ( 0.7 + 0.9 * vAge ), dark );
          a = mix( a, min( 0.92, a * 1.5 ), dark );
          gl_FragColor = vec4( c, a );
        }`,
  });
}

/**
 * A staging buffer for one baked detonation: five vec4 attributes over `n`
 * quads, written by the authoring file one quad at a time and handed to
 * `finish()` once. Nothing here runs during a match — this is BOOT.
 *
 * It exists so `src/match/skyfall.js` states WHAT the detonation is (a core, a
 * fireball, a column, a shroud, a dust wall, embers) without also restating HOW
 * an interleaved instanced attribute set is filled in, six times.
 */
export class BlastBuilder {
  constructor(n) {
    this.n = n;
    this.i = 0;
    this.at = new Float32Array(n * 4);
    this.vel = new Float32Array(n * 4);
    this.life = new Float32Array(n * 4);
    this.col = new Float32Array(n * 4);
    this.kin = new Float32Array(n * 4);
  }

  /**
   * @param {object} q
   *   x,y,z      spawn point
   *   vx,vy,vz   initial velocity, m/s
   *   r0,r1      half-width at birth and at death, metres
   *   birth,life seconds on the detonation's own clock
   *   drag       1/s
   *   accel      vertical acceleration, m/s^2 (+ buoyant, - ballistic)
   *   cr,cg,cb   linear colour
   *   peak       radiance multiplier
   *   kind       @see KIND
   *   seed       0..1
   *   aCurve     alpha falloff exponent
   *   sCurve     size curve exponent (<1 expands immediately)
   */
  push(q) {
    const i = this.i++;
    if (i >= this.n) throw new Error(`[detonation] builder overflow at ${i}/${this.n}`);
    const b = i * 4;
    this.at[b] = q.x; this.at[b + 1] = q.y; this.at[b + 2] = q.z; this.at[b + 3] = q.r0;
    this.vel[b] = q.vx; this.vel[b + 1] = q.vy; this.vel[b + 2] = q.vz; this.vel[b + 3] = q.r1;
    this.life[b] = q.birth; this.life[b + 1] = q.life; this.life[b + 2] = q.drag; this.life[b + 3] = q.accel;
    this.col[b] = q.cr; this.col[b + 1] = q.cg; this.col[b + 2] = q.cb; this.col[b + 3] = q.peak;
    this.kin[b] = q.kind; this.kin[b + 1] = q.seed; this.kin[b + 2] = q.aCurve; this.kin[b + 3] = q.sCurve;
    return i;
  }

  /**
   * Turn everything pushed so far into an `InstancedBufferGeometry`.
   *
   * `instanceCount` is left at ONE and the mesh is left VISIBLE, which is the
   * idiom `src/match/reinforce.js` and `src/match/bomber.js` both use and state:
   * three compiles a program the first time an object is actually DRAWN, and
   * `renderer.compile()` walks `traverseVisible`, so a mesh hidden until the
   * event is a shader compile ON the event's own frame. One instance, parked
   * under the map by its own birth time being in the future, is one draw call
   * with two triangles for the whole match and no compile when it matters.
   */
  finish(centre, radius) {
    const g = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = g.index;
    geo.attributes.position = g.attributes.position;
    geo.attributes.uv = g.attributes.uv;
    g.dispose();
    const put = (name, arr) =>
      geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr.subarray(0, this.i * 4), 4));
    put('aAt', this.at);
    put('aVel', this.vel);
    put('aLife', this.life);
    put('aCol', this.col);
    put('aKin', this.kin);
    geo.instanceCount = 1;
    geo.boundingSphere = new THREE.Sphere(centre.clone(), radius);
    geo.userData.blastCount = this.i;
    return geo;
  }
}
