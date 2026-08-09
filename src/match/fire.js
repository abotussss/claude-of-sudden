/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE FIRE BILLBOARD — one program, two fires
 * ════════════════════════════════════════════════════════════════════════════
 * This is `Crash._buildFlames`'s material, MOVED here unchanged, because the
 * satellite's 157 m scar is no longer the only thing on this map that is on
 * fire: `src/match/skyfall.js` sets a 116 x 88 m region of the west alight and
 * it wants the same fire, at a different size, on its own clock.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SHARED RATHER THAN COPIED, AND IT IS A FRAME-COST ARGUMENT
 * ────────────────────────────────────────────────────────────────────────────
 * Three's program cache keys a `ShaderMaterial` on its shader SOURCE, so two
 * materials built from this one function are two materials on ONE compiled
 * program. Two copies of the text, differing by a digit somebody tuned once,
 * would be two programs — and the tower's raze already measures 3.7 ms of
 * synchronous work against 465 ms on the frame, which is FIRST DRAW and VFX and
 * not chunk count. An event this size cannot afford a shader compile in its own
 * fire frame, and it does not take one.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `uGain` IS THE ONLY THING THAT IS NEW, AND IT IS 1.0 FOR THE SATELLITE
 * ────────────────────────────────────────────────────────────────────────────
 * A multiply by exactly 1.0 is the identity in IEEE floating point, so the
 * scar's fragments are bit-identical to what they were before this file
 * existed. It is here because the conflagration is FOUR TIMES the scar's
 * instance count over TWO AND A QUARTER times its area — the same per-quad
 * radiance would stack to white through the composite's ~14x auto-exposure, and
 * "brighter cannot fix pale, it is what causes it" is a lesson this file's
 * original author paid for twice. @see the radiance note in the fragment
 * shader: the crowd argument is made in RADIANCE, not in count, and a denser
 * crowd has to be quieter per member.
 *
 * Everything else below — the view-space billboard, the minimum subtended
 * angle, the near-pure-red body colour, the taper carried by alpha rather than
 * by geometry — is verbatim, comments included, and the notes in it are the
 * measurements that produced those numbers. Do not tune them here for one of
 * the two fires; give that fire an attribute.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `uBlast` — THE SHOCKWAVE, AND IT IS THE ONLY WAY TO SPEND THE FIRE THAT IS
 * ALREADY THERE INSTEAD OF DISPLACING IT
 * ────────────────────────────────────────────────────────────────────────────
 * 「大爆発演出はド派手にしないと」. When the carrier lands there is already an
 * 8 546 m² conflagration and a 157 m scar burning on this plain, and both of
 * them are made of THIS material. A detonation that only draws new things has
 * to draw them ON TOP of that; a detonation that drives one more uniform makes
 * 2 700 quads that are already on screen, already paid for and already in
 * exactly the right place LEAN AWAY FROM IT AND FLARE.
 *
 * `uBlast` is `vec4(x, z, wavefront radius, strength)` in world space. A quad
 * within `WAVE_W` of the wavefront is pushed over and brightened, on a gaussian
 * so the front has no edge. Ten instructions on a vertex shader that already
 * runs, on a mesh that already draws, with no new instance, no new draw call,
 * no particle-ring slot and no light.
 *
 * DEFAULT IS `w = 0`, which multiplies the whole term out — the scar's
 * fragments are bit-identical to what they were when it was the only fire, and
 * both fires still share ONE program because the source is one string.
 */
import * as THREE from 'three';

/**
 * @param {object} uniforms  `{ uT, uFade, uGain, uBlast }`, each a `{ value }`
 *                           box the caller keeps and drives. `uGain` and
 *                           `uBlast` may be omitted; they default to the
 *                           identity, which is what the scar passed before
 *                           either existed.
 * @returns {THREE.ShaderMaterial}
 */
export function makeFireMaterial(uniforms) {
  if (!uniforms.uGain) uniforms.uGain = { value: 1 };
  if (!uniforms.uBlast) uniforms.uBlast = { value: new THREE.Vector4(0, 0, -1, 0) };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
        attribute vec4 aAt;     // xyz base, w half-width
        attribute vec4 aFire;   // x light-at, y phase, z height, w flicker
        attribute float aKind;  // 0 tongue, 1 bed
        uniform float uT;
        uniform vec4 uBlast;   // xz centre, z wavefront radius, w strength
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
           * THE WAVEFRONT PASSES. uBlast.w is 0 for the whole match except for
           * the second and a half after the carrier lands, so this branch is
           * UNIFORM -- every invocation in every warp takes the same side of it
           * and it costs nothing when there is no blast.
           *
           * The fire is dragged OUTWARD along its own bearing from the centre,
           * whipped taller and flared, on a gaussian 14 m wide so the front has
           * no edge to give it away. It is the base that moves and not the tip:
           * a wave that bent the tips would read as wind, and this is a wall of
           * air arriving.
           *
           * (No backticks in here. This comment lives inside a JS template
           * literal and one backtick ends the shader.)
           */
          vec3 fpos = aAt.xyz;
          float bs = 0.0;
          if ( uBlast.w > 0.0 ) {
            vec2 rd = fpos.xz - uBlast.xy;
            float rl = length( rd ) + 1e-4;
            float dw = ( rl - uBlast.z ) / 14.0;
            bs = exp( -dw * dw ) * uBlast.w;
            fpos.xz += ( rd / rl ) * bs * 8.0;
            h *= 1.0 + bs * 1.7;
            vHot *= 1.0 + bs * 1.3;
          }
          /**
           * THE BILLBOARD, BUILT IN VIEW SPACE. The base goes through the model
           * view once; the corners are then offset on the view axes, so the quad
           * faces the camera from every bearing and still stands on its base.
           */
          vec4 base = modelViewMatrix * vec4( fpos, 1.0 );
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
        uniform float uGain;
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
           *
           * uGain is 1.0 for the scar and lower for a denser crowd. @see the
           * header of this file.
           */
          float a = body * fall * uFade * uGain * vHot * mix( 0.42, 0.34, vKind );
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
  return mat;
}
