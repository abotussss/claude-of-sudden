import * as THREE from 'three';
import { Arm, HAND_POSES } from './hands.js';
import { buildClips, makeSampleResult } from './clips.js';
import { triCount, mergeAll } from './geometry.js';
import {
  Spring,
  Spring3,
  Noise1,
  clamp,
  clamp01,
  lerp,
  damp,
  smootherstep,
  wrapPi,
  TAU,
} from './mathx.js';

/**
 * THE VIEWMODEL RIG.
 *
 * Everything the player looks at for the whole game happens in this file. It is
 * a stack of *additive procedural layers* over one base pose — no baked clips
 * for anything continuous:
 *
 *   base      hip / ADS / sprint / low-ready pose blend
 *   sway      layered incommensurate noise, so idle never visibly loops
 *   bob       stride-driven figure-eight, scaled by speed and stance
 *   lag       the gun TRAILS camera rotation on a spring, overshoots, settles.
 *             This is the single detail that makes a viewmodel feel real.
 *   recoil    per-shot rotational + positional impulse, spring-damper return
 *   clip      keyframed reload / inspect / draw additive offset
 *
 * ADS alignment is computed, not authored: the rig solves for the translation
 * that puts the weapon's sight node exactly on the camera axis at the right eye
 * relief, so the optic is pixel-centred at full ADS whatever the weapon.
 *
 * The scene graph:
 *   viewScene
 *     anchor          <- copies the world camera transform every frame, so the
 *                        gun is lit and shadowed as if it were in the world
 *       rig           <- the animation stack writes here
 *         weapon      <- body meshes + moving-part groups
 *         armL/armR   <- two-bone IK, hands welded to the weapon's grips
 *       reticle       <- collimated dot, placed on the optical axis in camera
 *                        space so it behaves like real glass
 */

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'XYZ');
const _m = new THREE.Matrix4();
const _axisX = new THREE.Vector3(1, 0, 0);
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisZ = new THREE.Vector3(0, 0, 1);

/**
 * Re-shape the curvature vertex masks baked by `materials.bakeMasks`.
 *
 * bakeMasks writes a LINEAR convexity ramp into vColor.rgb (wear / grime / AO).
 * On architecture that is right — a wall has interior vertices for the ramp to
 * fall off against. On chamfered hard-surface geometry there are none, so the
 * ramp runs from the chamfer to the middle of the panel and the whole face
 * reads as worn metal. Raising the exponent collapses that ramp back onto the
 * chamfer's own vertices, which is the outer 1-2 mm of the edge — the only place
 * a rifle actually polishes through.
 *
 * @param {THREE.BufferGeometry} geo   must already carry a `color` attribute
 */
function shapeMasks(geo, o) {
  const col = geo.getAttribute('color');
  if (!col) return geo;
  const a = col.array;
  const amp = [o.wearAmp ?? 1, o.grimeAmp ?? 1, o.aoAmp ?? 1];
  const exp = [o.wearExp ?? 1, o.grimeExp ?? 1, o.aoExp ?? 1];
  for (let i = 0; i < a.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = a[i + k];
      a[i + k] = v <= 0 ? 0 : amp[k] * Math.pow(v > 1 ? 1 : v, exp[k]);
    }
  }
  col.needsUpdate = true;
  return geo;
}

/** Right-handed hand basis from a finger direction and a back-of-hand direction. */

/**
 * HOW FAR THE HAND IS BURIED IN THE WEAPON, in metres, summed over the joints.
 *
 * The contact solve knows about exactly ONE cylinder — the grip — and nothing
 * else. It has no idea the pistol has a slide, a frame or a trigger guard, so a
 * search that only scores "fingertips on the grip cylinder" is free to put the
 * hand somewhere the slide passes straight through the palm. That is what
 * shipped, and it is what "なんで武器に手が貫通してる" is: the gun visibly
 * threaded through the fist.
 *
 * Axis-aligned boxes per mesh, not triangles: this runs thousands of times
 * inside the search, there is no BVH in the repo and adding a dependency is
 * forbidden. A box is conservative in the useful direction — it over-reports
 * near a slanted surface and never misses a gross impalement, which is the
 * failure being hunted.
 *
 * The GRIP REGION is exempt, or the metric would fight the thing it is meant to
 * preserve: a hand holding a 34 mm grip is legitimately inside the grip's own
 * bounding box, and its palm should interpenetrate by a few millimetres. Points
 * within `r + 0.03` of the grip axis and inside its span are skipped.
 */
function handPenetration(arm, weapon, cyl) {
  if (!cyl) return 0;
  _penInv.copy(arm.root.matrixWorld).invert();
  _penAxis.set(cyl.dir[0], cyl.dir[1], cyl.dir[2]).normalize();
  _penA0.set(cyl.axis[0], cyl.axis[1], cyl.axis[2]);
  const zHi = Math.max(cyl.z0, cyl.z1) + 0.02;
  const zLo = Math.min(cyl.z0, cyl.z1) - 0.02;
  const gripR2 = (cyl.r + 0.03) * (cyl.r + 0.03);

  const joints = [arm.hand];
  for (const f of arm.fingers) for (const j of f.joints) joints.push(j);
  for (const j of arm.thumb.joints) joints.push(j);

  let total = 0;
  for (const j of joints) {
    j.updateWorldMatrix(true, false);
    _penP.setFromMatrixPosition(j.matrixWorld).applyMatrix4(_penInv);
    // In the grip's own neighbourhood, interpenetration is the point.
    _penD.copy(_penP).sub(_penA0);
    _penD.addScaledVector(_penAxis, -_penD.dot(_penAxis));
    if (_penD.lengthSq() < gripR2 && _penP.z <= zHi && _penP.z >= zLo) continue;
    for (const mesh of weapon.meshes) {
      const geo = mesh.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox;
      // Depth of penetration = distance to the nearest face of the box, so a
      // joint just inside a big slide scores small and one at its centre scores
      // large. Zero when outside on any axis.
      const dx = Math.min(_penP.x - bb.min.x, bb.max.x - _penP.x);
      const dy = Math.min(_penP.y - bb.min.y, bb.max.y - _penP.y);
      const dz = Math.min(_penP.z - bb.min.z, bb.max.z - _penP.z);
      if (dx > 0 && dy > 0 && dz > 0) total += Math.min(dx, dy, dz);
    }
  }
  return +total.toFixed(4);
}

/** Scratch for debugRefitRight's wrist measurement. Debug path only. */
const _wv = new THREE.Vector3();
const _wv2 = new THREE.Vector3();
const _penInv = new THREE.Matrix4();
const _penAxis = new THREE.Vector3();
const _penA0 = new THREE.Vector3();
const _penP = new THREE.Vector3();
const _penD = new THREE.Vector3();

function handBasis(out, finger, back) {
  _v.set(-finger[0], -finger[1], -finger[2]).normalize(); // hand +Z
  _v2.set(back[0], back[1], back[2]);
  _v2.addScaledVector(_v, -_v2.dot(_v));
  if (_v2.lengthSq() < 1e-8) _v2.set(0, 1, 0).addScaledVector(_v, -_v.y);
  _v2.normalize(); // hand +Y
  _v3.crossVectors(_v2, _v).normalize(); // hand +X
  _m.makeBasis(_v3, _v2, _v);
  return out.setFromRotationMatrix(_m);
}

export class Viewmodel {
  constructor(ctx, mats) {
    this.ctx = ctx;
    this.mats = mats;
    this.rng = ctx.rng.fork();

    this.anchor = new THREE.Object3D();
    this.anchor.name = 'ow-viewmodel-anchor';
    this.rig = new THREE.Object3D();
    this.rig.name = 'ow-viewmodel-rig';
    this.anchor.add(this.rig);
    ctx.viewScene.add(this.anchor);

    // ---- arms -------------------------------------------------------------
    const handMats = {
      glove: mats.get('glove'),
      pad: mats.get('glove_pad'),
      seam: mats.get('glove_seam'),
      sleeve: mats.get('sleeve'),
    };
    // Shoulder joints in CAMERA space: ~200 mm lateral, ~210 mm below the eye
    // and only just behind it.
    //
    // Two constraints fight here. Too far BACK and a 570 mm arm cannot reach the
    // handguard, so the two-bone solve clamps and the elbow locks dead straight
    // — the "broomstick arm". Too far FORWARD (a properly bladed stance) and the
    // upper arm itself lands inside the near frustum, so a 100 mm-wide sleeve
    // fills half the screen. The support hand is therefore placed on the REAR of
    // the handguard instead, which buys the reach without moving the joint into
    // shot.
    this.armR = new Arm(1, handMats, {
      scale: 1,
      shoulderX: 0.205,
      shoulderY: -0.2,
      shoulderZ: 0.06,
      pose: 'grip',
    });
    // The shoulders stay BEHIND the eye. Blading the support shoulder forward to
    // reach the handguard was tried and measured: at z=-0.075 the 89 mm forearm
    // sleeve crosses the frame diagonally and hides the barrel and the muzzle,
    // which is precisely the failure the note above warns about. The reach is
    // bought by cheating the bones 10% long instead — see hands.js L_UPPER.
    this.armL = new Arm(-1, handMats, {
      scale: 0.97,
      shoulderX: 0.2,
      shoulderY: -0.22,
      shoulderZ: 0.02,
      pose: 'clamp',
    });
    this.rig.add(this.armR.root);
    this.rig.add(this.armL.root);
    /**
     * The arms get the SAME curvature-mask treatment the weapon does. Without
     * this every wear/grime/AO number in `sleeve`, `glove`, `glove_pad` and
     * `glove_seam` is dead code — see Arm.bakeSurfaceMasks. It has to happen
     * before `_fitSupportHand` runs, because that adds contact AO into the same
     * attribute with Math.max and would otherwise be overwritten.
     */
    const bakeArms = this.mats.lib?.bakeMasks?.bind(this.mats.lib) ?? null;
    if (bakeArms) {
      this.armR.bakeSurfaceMasks(bakeArms, shapeMasks, this.rng);
      this.armL.bakeSurfaceMasks(bakeArms, shapeMasks, this.rng);
    }
    // Body-fixed shoulders, expressed in camera space and re-based into rig
    // space every frame so the elbows do not swing when the gun moves.
    this.shoulderR = new THREE.Vector3(0.205, -0.2, 0.06);
    this.shoulderL = new THREE.Vector3(-0.2, -0.22, 0.02);

    // ---- reticle ----------------------------------------------------------
    this.reticle = new THREE.Object3D();
    this.reticle.name = 'ow-reticle';
    this.anchor.add(this.reticle);
    /**
     * A 2 MOA dot with a soft halo, a dark keyline and a 12-segment outer ring.
     *
     * All four are authored at UNIT radius and scaled together by the dot's
     * angular size in `_updateReticle`, so the whole reticle is one shape that
     * grows and shrinks as a unit — proportions can never drift.
     *
     *   core     the emitter. 0xff1a08 at intensity 1.35, and the intensity is
     *            measured — twice, because the first analysis was wrong.
     *
     *            The old note here reasoned about how much GREEN the emitter adds
     *            and concluded 3.2 was safe. It is not, and the reason is the tone
     *            curve, not the additive maths: the frame is graded with AgX (see
     *            render/composite.js), and AgX's whole signature is that it
     *            DESATURATES as it approaches display white. A pixel whose red
     *            channel is 3.2 over a mid-grey background comes out of the curve
     *            at rgb(255,248,239) whatever its green and blue were — measured on
     *            ads.png, a white dot, exactly what the previous note said it had
     *            fixed. There is no colour available up there.
     *            0.95 keeps the core on the near-linear part of the curve, where a
     *            saturated red stays a saturated red, and the halo + ring below are
     *            what carry the "it is an emitter" read instead of raw radiance.
     *   halo     1.6x the core radius, ~6% alpha. This is the bloom seed and the
     *            reason the dot looks like it is BEHIND glass. It has to stay
     *            tight; the old 0.0095 rad / 0.34 alpha halo was 23 px across and
     *            was what actually read on screen — a soft salmon blob.
     *   rim      a NORMALLY blended dark keyline. Additive blending cannot draw
     *            anything darker than what is behind it, so without a separate
     *            ring the dot dissolves the moment it crosses a blown-out sky.
     *   ring     12 arc segments at 3.2x the dot radius, 35% of its radiance.
     *            A bare dot at 8 px is indistinguishable from a dead subpixel;
     *            the segmented ring is what makes it read as an EMITTER, and it
     *            is the standard 65 MOA circle-dot every modern sight ships.
     */
    const core = new THREE.CircleGeometry(1, 32);
    const halo = new THREE.CircleGeometry(1.6, 32);
    const rim = new THREE.RingGeometry(1, 1.42, 32, 1);
    const RING_SEGS = 12;
    const ringArcs = [];
    for (let i = 0; i < RING_SEGS; i++) {
      const a0 = (i / RING_SEGS) * TAU;
      ringArcs.push(new THREE.RingGeometry(2.98, 3.42, 4, 1, a0, (TAU / RING_SEGS) * 0.56));
    }
    const ring = mergeAll(ringArcs);
    this._reticleGeo = [core, halo, rim, ring];
    this.dotCore = new THREE.Mesh(core, mats.reticle(0xff1206, 0.95));
    this.dotHalo = new THREE.Mesh(halo, mats.reticle(0xff2a0c, 0.34));
    this.dotRim = new THREE.Mesh(rim, mats.reticleOutline(0.85));
    this.dotRing = new THREE.Mesh(ring, mats.reticle(0xff1206, 0.95 * 0.5));
    this.dotHalo.renderOrder = 19;
    this.dotRim.renderOrder = 20;
    this.dotRing.renderOrder = 20;
    this.dotCore.renderOrder = 21;
    this.reticle.add(this.dotHalo);
    this.reticle.add(this.dotRim);
    this.reticle.add(this.dotRing);
    this.reticle.add(this.dotCore);
    for (const m of [this.dotCore, this.dotHalo, this.dotRim, this.dotRing]) {
      m.frustumCulled = false;
      m.userData.owNoPrepass = true;
      m.userData.owNoShadow = true;
    }

    // ---- animation state --------------------------------------------------
    this.weapons = new Map();
    this.active = null;

    this.adsT = 0;
    this.adsTarget = 0;
    this.sprintT = 0;
    this.lowReadyT = 0;
    this.bobPhase = 0;
    this.stepT = 0;
    this.noiseT = 0;
    this.triggerT = 0;
    this.triggerTarget = 0;

    this.lag = new Spring3(5.4, 0.46);
    this.lagRot = new Spring3(6.2, 0.42);
    this.recPos = new Spring3(9, 0.42);
    this.recRot = new Spring3(9, 0.42);
    this.jumpSpring = new Spring(5.5, 0.5);
    this.landSpring = new Spring(7.5, 0.55);
    this.settle = new Spring3(2.2, 0.7);

    this.noise = [];
    for (let i = 0; i < 6; i++) this.noise.push(new Noise1(this.rng, 512));
    this.noiseRates = [0.13, 0.19, 0.271, 0.083, 0.117, 0.163];

    this._angVel = { yaw: 0, pitch: 0 };
    this._prevYaw = 0;
    this._prevPitch = 0;
    this._hasPrev = false;

    // clip playback
    this.clip = null;
    this.clipT = 0;
    this.clipPrevT = 0;
    this.clipResult = makeSampleResult();
    this.onClipEvent = null;

    // moving-part drive
    this.boltCycle = 0; // 0..1, driven by firing
    this.boltHold = 0; // 1 = locked back (empty)
    /** Shots since the weapon was drawn — drives the revolver's cylinder. */
    this.cylShots = 0;
    this.magInHand = 0;
    this.magVisible = true;

    // preallocated working state
    this._basePos = new THREE.Vector3();
    this._baseQuat = new THREE.Quaternion();
    this._adsPos = new THREE.Vector3();
    this._poleTmp = new THREE.Vector3();
    this._adsQuat = new THREE.Quaternion();
    this._tmpPos = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._handPos = new THREE.Vector3();
    this._handQuat = new THREE.Quaternion();
    this._handPosL = new THREE.Vector3();
    this._handQuatL = new THREE.Quaternion();
    this._sightLocal = new THREE.Vector3();
    this._lhandTarget = new THREE.Vector3();
    this._lhandFinger = [0, 0, 0];
    this._lhandBack = [0, 0, 0];
    this._muzzleWorld = new THREE.Vector3();
    this._muzzleDir = new THREE.Vector3();
    this._ejectWorld = new THREE.Vector3();
    this._ejectVel = new THREE.Vector3();

    this.debugFrozen = false;
    /** Set false by the preview harness to leave the cameras alone. */
    this.trackCamera = true;
    this.rigOverride = null;
    this._scriptedFire = -1;
    this._scriptShots = 0;
  }

  /* ====================================================================== */
  /*  construction                                                          */
  /* ====================================================================== */

  /**
   * Turn a model description (body + moving assemblies + nodes) into meshes.
   * One mesh per material per assembly: a whole rifle lands in 7-9 draw calls.
   */
  addWeapon(model, def) {
    const group = new THREE.Object3D();
    group.name = `weapon-${model.id}`;
    group.visible = false;
    this.rig.add(group);

    let tris = 0;
    const meshes = [];
    const bake = this.mats.lib?.bakeMasks?.bind(this.mats.lib) ?? null;

    /**
     * `wearScale` may be a number or a per-material map.
     *
     * The map exists because of the knife. `bakeMasks` measures convexity per
     * VERTEX, and a lofted blade (geometry.js loftZ) has no interior vertices
     * anywhere — every one of them sits on a section outline, so every one
     * measures fully convex and the whole blade comes out at the wear layer's
     * full amplitude. On a rail tooth that reads as a bright comb (see the note
     * below); on a 125 x 30 mm flat it reads as WHITE PAPER, which is exactly
     * what the first capture measured. The masks are still baked — the grime
     * and AO layers are what put dirt in the fuller and along the guard — the
     * wear layer alone is turned down.
     */
    const scaleFor = (wearScale, matKey) =>
      typeof wearScale === 'object' ? wearScale[matKey] ?? 1 : wearScale;

    const build = (asm, parent, wear = 1) => {
      const map = asm.build();
      for (const [matKey, geo] of map) {
        const wearScale = scaleFor(wear, matKey);
        // Curvature masks: convex chamfers wear to bright metal, creases fill
        // with grime. This is what stops the gun reading as clean plastic.
        if (bake) {
          /**
           * Chamfered hard-surface geometry has no interior vertices on a face,
           * so a per-vertex edge mask interpolates linearly from the chamfer all
           * the way to the far side of the panel: a rail tooth, a mount top face
           * or a handguard slat comes out uniformly worn, which is what turned
           * the rail teeth into flat near-white bars and the mount into beige MDF.
           *
           * Bake the mask at full amplitude and then SHAPE it (below): raising the
           * exponent is the only knob that pulls a vertex-interpolated ramp back
           * onto the outer millimetre or two of the edge, because it pushes
           * everything below the chamfer's own vertices toward zero.
           */
          const soft = matKey === 'polymer' || matKey === 'rubber' || matKey === 'polymer_tan';
          bake(geo, { wear: 1, grime: 1, ao: 1, edgeThreshold: 0.16, rng: this.rng });
          shapeMasks(geo, {
            /**
             * wearAmp comes DOWN and grimeAmp goes UP.
             *
             * With the viewmodel recalibrated to be diffuse-dominant (see
             * materials.js `alu`), the wear layer's contrast against the base
             * albedo is what decides whether a chamfer reads as polished alloy or
             * as a white pencil line, and on small parts — where every vertex is
             * convex — it decides whether a takedown pin reads as steel or as a
             * cream plastic cube. 0.9 -> 0.62 on hard surfaces.
             *
             * Grime is the opposite: it is the only mask that paints the CONCAVE
             * side of the geometry, so it is what puts dirt in the magwell corners,
             * the trigger-guard fillet, the rail slots and the seam between the
             * handguard panels. Those creases were reading perfectly clean, which
             * is a large part of "props read as pasted-on decals" applied to a gun.
             */
            wearAmp: (soft ? 0.42 : 0.62) * wearScale,
            wearExp: soft ? 3.4 : 2.8,
            grimeAmp: 1.15,
            grimeExp: 1.25,
            aoAmp: 1.0,
            aoExp: 1.15,
          });
        }
        const mesh = new THREE.Mesh(geo, this.mats.get(matKey));
        mesh.name = `${asm.name}-${matKey}`;
        // The viewmodel does not cast into the cascades (it is not in the world
        // scene), but it absolutely must RECEIVE the sun shadow: without this the
        // gun is lit at full sun while the street around it is in shade, which is
        // the single most obvious "pasted-on sticker" tell.
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        parent.add(mesh);
        meshes.push(mesh);
        tris += triCount(geo);
      }
    };

    build(model.body, group, model.wearScale ?? 1);

    const parts = {};
    for (const [name, asm] of Object.entries(model.moving)) {
      const sub = new THREE.Object3D();
      sub.name = `${model.id}-${name}`;
      group.add(sub);
      build(asm, sub, name === 'magazine' ? 0.8 : 1);
      parts[name] = sub;
    }

    // Seat the moving parts at their rest transforms.
    const n = model.nodes;
    if (parts.magazine && n.magSeat) applyNode(parts.magazine, n.magSeat);
    if (parts.cylinder && n.cylinderRest) applyNode(parts.cylinder, n.cylinderRest);
    if (parts.charging && n.chargeRest) applyNode(parts.charging, n.chargeRest);
    if (parts.bolt && n.boltRest) applyNode(parts.bolt, n.boltRest);
    if (parts.slide && n.slideRest) applyNode(parts.slide, n.slideRest);
    if (parts.trigger && n.triggerPivot) applyNode(parts.trigger, n.triggerPivot);
    if (parts.selector && n.selectorPivot) applyNode(parts.selector, n.selectorPivot);

    const entry = {
      id: model.id,
      def,
      model,
      group,
      parts,
      meshes,
      tris,
      clips: buildClips(model.nodes, def),
      /**
       * Every node below is OPTIONAL, because a melee weapon genuinely has none
       * of them. They are left null rather than defaulted to the origin: a
       * zeroed `magSeat` is a magazine seated inside the shooter's hand, and a
       * zeroed `sight` is an ADS solve that yanks the weapon to the eye. Each
       * consumer branches on null instead (see _updateParts, ejectWorld and the
       * ADS block in update()).
       */
      sight: model.nodes.sight ? new THREE.Vector3().fromArray(model.nodes.sight) : null,
      ironSight: model.nodes.ironSight ?? model.nodes.sight
        ? new THREE.Vector3().fromArray(model.nodes.ironSight ?? model.nodes.sight)
        : null,
      muzzle: new THREE.Vector3().fromArray(model.nodes.muzzle),
      eject: model.nodes.eject ? new THREE.Vector3().fromArray(model.nodes.eject) : null,
      ejectDir: new THREE.Vector3().fromArray(model.nodes.ejectDir ?? [1, 0.4, 0.2]).normalize(),
      optic: model.nodes.opticGlass ?? null,
      magSeatPos: model.nodes.magSeat
        ? new THREE.Vector3().fromArray(model.nodes.magSeat.pos)
        : null,
      magSeatQuat: model.nodes.magSeat
        ? new THREE.Quaternion().setFromEuler(
          new THREE.Euler().fromArray(model.nodes.magSeat.rot)
        )
        : null,
      gripR: model.nodes.gripR,
      gripL: model.nodes.gripL,
      chargePull: new THREE.Vector3().fromArray(model.nodes.chargePull ?? [0, 0, 0]),
      boltTravel: new THREE.Vector3().fromArray(model.nodes.boltTravel ?? [0, 0, 0]),
      slideTravel: new THREE.Vector3().fromArray(model.nodes.slideTravel ?? [0, 0, 0]),
      triggerPull: model.nodes.triggerPull ?? -0.3,
      magLen: model.magSize?.len ?? 0.2,
      shell: model.shell,
      // A weapon may name its own support-hand pose; the knife's hand is off
      // the weapon entirely and stays open.
      lhandPose: model.nodes.lhandPose ?? (model.id === 'pistol' ? 'cup' : 'clamp'),
      /**
       * The SHOOTING hand's pose is per-weapon too now. It used to be the one
       * authored `grip` for everything, which is a pistol-grip pose: on a knife
       * handle — a 21 x 27 mm oval instead of a 31 x 34 mm grip section — the
       * same curls leave every fingertip 6-9 mm inside the handle. See
       * _fitShootingHand.
       */
      /**
       * From the MODEL, like `lhandPose` on the line above. This was a hardcoded
       * 'grip' — a pistol grip — so a model asking for a different shooting hand
       * was ignored and the knife's authored hammer grip never reached the arm.
       */
      rhandPose: model.nodes.rhandPose ?? 'grip',
      /** No trigger group => nothing for setTrigger to drive. */
      hasTrigger: !!parts.trigger,
    };
    this._fitSupportHand(entry);
    this._fitShootingHand(entry);
    this.weapons.set(model.id, entry);
    return entry;
  }

  /**
   * GROUND THE SUPPORT HAND ON THE HANDGUARD — once, at build time.
   *
   * Two halves, and both are needed: geometry alone still reads as two floating
   * objects, and AO alone cannot close a 10 mm gap.
   *
   *  1. `Arm.fitToCylinder` searches each distal joint for the rotation that puts
   *     that fingertip's contact patch on the handguard surface (<=1 mm off, up
   *     to 1.5 mm buried), measured through the real transform chain rather than
   *     derived analytically — see the note there for why the analytic version
   *     was 8-14 mm out in every frame despite the maths being right.
   *  2. The contact points that come back are then used to bake a contact-AO
   *     gradient into BOTH sides of the interface: the handguard here, the glove
   *     in `Arm.bakeContactAO`. 0.55 multiply at the contact, easing to 1.0 over
   *     12 mm.
   *
   * The AO mask lives in vColor.b, which the library's shader turns into
   * `orm.r *= 1 - vColor.b * wear[2]`; wear[2] is 0.5 on every weapon material,
   * so a mask of 0.9 is the 0.55 multiply asked for.
   */
  _fitSupportHand(w) {
    /**
     * The pistol used to be excluded outright, and that exclusion is the whole
     * of "the support hand floats near the slide instead of closing on it": its
     * `cup` pose is authored curls, aimed at nothing, so the four fingertips
     * ended up wherever 1.05-1.20 rad of curl put them. There IS a cylinder to
     * close on — the shooting hand's own finger column wrapped round the front
     * strap — and `supportCylinder` on the model is it, so the pistol now goes
     * through exactly the same per-fingertip solve the carbines do.
     */
    const hg = w.model.nodes.handguard ?? w.model.nodes.supportCylinder;
    const gL = w.gripL;
    if (!hg || !gL) return;
    this._handPosL.fromArray(gL.pos);
    handBasis(this._handQuatL, gL.finger ?? [0.82, 0.5, -0.28], gL.back ?? [-0.5, 0.32, -0.8]);
    const basePose = w.lhandPose ?? 'clamp';
    const poseName = `${basePose}:${w.id}`;
    this.armL.setPose(basePose);
    const contacts = this.armL.fitToCylinder(
      this._handPosL,
      this._handQuatL,
      hg.axis,
      hg.dir,
      hg.r,
      { clearance: 0.001, poseName, base: basePose }
    );
    w.lhandPose = poseName;
    /** @see the `fitR` note in _fitShootingHand. */
    w.fitL = this.armL.lastFit;
    // Only keep contacts that actually landed on the handguard's own extent —
    // a fingertip that overshot past the end cap must not paint AO on the barrel.
    const z0 = Math.max(hg.z0, hg.z1);
    const z1 = Math.min(hg.z0, hg.z1);
    const kept = contacts.filter((p) => p.z <= z0 + 0.012 && p.z >= z1 - 0.012);
    this.armL.bakeContactAO(kept, 0.012, 0.7);
    this._bakeContactAOOnWeapon(w, kept, 0.012, 0.9);
    this.armL.setPose(poseName);
  }

  /**
   * The SUPPORT hand's equivalent of `debugRefitRight`.
   *
   * The support wrists measured 64 to 97 degrees while every fingertip sat
   * within 0.4 mm of the handguard — the same "contact is not the whole story"
   * failure the shooting hand had, on the other arm. Debug only; mutates the
   * authored node, caller restores or reloads.
   */
  debugRefitLeft(w, trial) {
    const g = w.model.nodes.gripL;
    const hg = w.model.nodes.handguard ?? w.model.nodes.supportCylinder;
    if (!g || !hg) return null;
    if (trial.pos) g.pos = trial.pos;
    if (trial.finger) g.finger = trial.finger;
    if (trial.back) g.back = trial.back;
    w.gripL = g;
    this._fitSupportHand(w);
    const zHi = Math.max(hg.z0, hg.z1);
    const zLo = Math.min(hg.z0, hg.z1);
    let onGrip = 0;
    for (const c of this.armL.lastFit?.contactPts ?? []) {
      if (c.z <= zHi + 0.012 && c.z >= zLo - 0.012) onGrip++;
    }
    // `_handPosL`/`_handQuatL`, NOT the right hand's scratch — passing
    // `_handPos` here made the reported wrist a constant 86.8 degrees for every
    // weapon and every trial, which is what a measurement that isn't measuring
    // anything looks like.
    this.armL.solve(this._handPosL, this._handQuatL);
    const fore = _wv.copy(this.armL.hand.position).sub(this.armL.elbow).normalize();
    const fwd = _wv2.set(0, 0, -1).applyQuaternion(this.armL.hand.quaternion).normalize();
    const wrist = (Math.acos(Math.max(-1, Math.min(1, fore.dot(fwd)))) * 180) / Math.PI;
    /**
     * REACH. `Arm.solve` clamps the target to 99.5% of (l1 + l2); at the clamp
     * the elbow locks dead straight and the limb reads as a broomstick. The
     * wrist-aware search walked the carbine's support hand 0.33 m down the
     * barrel to straighten the wrist, which put it at 1.011 extension — past the
     * end of the arm — and the documented "hand covers the muzzle, elbow locks"
     * defect would have come straight back. So reach is scored too.
     */
    const ext = this.armL.hand.position.distanceTo(this.armL.shoulder) /
      (this.armL.l1 + this.armL.l2);
    return { gaps: w.fitL?.gaps ?? null, wrist: +wrist.toFixed(1), onGrip, ext: +ext.toFixed(3),
      pen: handPenetration(this.armL, w, hg) };
  }

  /**
   * RE-RUN the shooting-hand solve with a trial `gripR`, and report the gaps.
   *
   * Authoring a grip by reasoning about the geometry did not converge: the
   * carbine's right hand touched with the index finger and missed with the
   * other three by 15, 17 and 24 mm, and no amount of deriving the knuckle row
   * from the grip's rake explained a spread that large. This makes the pose a
   * thing that can be SEARCHED instead of argued about — `tools/gripfit.mjs`
   * scans offsets and directions and keeps whichever one actually closes all
   * four fingers.
   *
   * Debug only, never called by the runtime. It mutates the authored node, so
   * the caller is responsible for putting it back (or reloading, which is what
   * the tool does between weapons).
   */
  debugRefitRight(w, trial) {
    const g = w.model.nodes.gripR;
    if (!g) return null;
    if (trial.pos) g.pos = trial.pos;
    if (trial.finger) g.finger = trial.finger;
    if (trial.back) g.back = trial.back;
    w.gripR = g;
    this._fitShootingHand(w);
    /**
     * The WRIST ANGLE comes back too, because contact alone is not enough.
     *
     * Every fingertip can sit 0.3 mm off the handle and the hand still look
     * broken — the first search closed the carbine's fingers and left the wrist
     * at 94 degrees, and the knife's at 168, which is the hand folded back onto
     * its own forearm. That is what "意味のわからない手首の曲がり方" is.
     *
     * `Arm.solve` has to be re-run for this: the elbow is computed from the hand
     * target every frame, so after moving the target the stored elbow is stale
     * and the angle measured against it is meaningless.
     */
    /**
     * HOW MANY FINGERTIPS ARE ACTUALLY ON THE GRIP, not merely at the right
     * distance from its axis.
     *
     * `Arm.fitToCylinder.gapAt` measures PERPENDICULAR distance to an infinite
     * cylinder — it has to, the solve only cares about the radial gap. But that
     * makes the contact test satisfiable by a hand sitting well below the bottom
     * of a 108 mm pistol grip, out in the air under the magwell, and the first
     * wrist-aware search did exactly that: it fixed the wrist, reported all four
     * fingers within 0.8 mm, and the captured frame had no right hand visible on
     * the weapon at all. So the span has to be part of the score.
     */
    const cyl = w.model.nodes.gripCylinder;
    const zHi = Math.max(cyl.z0, cyl.z1);
    const zLo = Math.min(cyl.z0, cyl.z1);
    let onGrip = 0;
    for (const c of this.armR.lastFit?.contactPts ?? []) {
      if (c.z <= zHi + 0.012 && c.z >= zLo - 0.012) onGrip++;
    }
    this.armR.solve(this._handPos, this._handQuat);
    const fore = _wv.copy(this.armR.hand.position).sub(this.armR.elbow).normalize();
    const fwd = _wv2.set(0, 0, -1).applyQuaternion(this.armR.hand.quaternion).normalize();
    const wrist = (Math.acos(Math.max(-1, Math.min(1, fore.dot(fwd)))) * 180) / Math.PI;
    /**
     * REACH. `Arm.solve` clamps the target to 99.5% of (l1 + l2); at the clamp
     * the elbow locks dead straight and the limb reads as a broomstick. The
     * wrist-aware search walked the carbine's support hand 0.33 m down the
     * barrel to straighten the wrist, which put it at 1.011 extension — past the
     * end of the arm — and the documented "hand covers the muzzle, elbow locks"
     * defect would have come straight back. So reach is scored too.
     */
    const ext = this.armR.hand.position.distanceTo(this.armR.shoulder) /
      (this.armR.l1 + this.armR.l2);
    return { gaps: w.fitR?.gaps ?? null, wrist: +wrist.toFixed(1), onGrip, ext: +ext.toFixed(3),
      pen: handPenetration(this.armR, w, cyl) };
  }

  /**
   * GROUND THE SHOOTING HAND ON THE HANDLE — the same build-time solve the
   * support hand gets, for weapons that declare a `gripCylinder`.
   *
   * A pistol grip is a tapered slab and the authored `grip` pose is right for
   * it. A knife handle is a 21 x 27 mm oval cylinder held in a hammer grip, and
   * the fingers have to wrap 200+ degrees of it — 1.15/1.20/0.62 rad of curl
   * (HAND_POSES.grip) closes about 170 deg on a 34 mm section and therefore
   * buries every fingertip inside a 24 mm one. Fitting per fingertip against
   * the real cylinder is the same fix, applied to the other hand.
   */
  _fitShootingHand(w) {
    const cyl = w.model.nodes.gripCylinder;
    const gR = w.gripR;
    if (!cyl || !gR) return;
    this._handPos.fromArray(gR.pos);
    handBasis(this._handQuat, gR.finger ?? [0, -0.35, -0.94], gR.back ?? [0.95, 0.25, 0.18]);
    /**
     * The BASE pose comes from the model now, not a hardcoded 'grip'. A pistol
     * grip and a knife handle need different starting hands, and starting a
     * knife from the pistol pose is why the fit had nothing to work with.
     */
    const basePose = w.rhandPose ?? 'grip';
    const poseName = `${basePose}:${w.id}`;
    this.armR.setPose(basePose);
    const contacts = this.armR.fitToCylinder(
      this._handPos,
      this._handQuat,
      cyl.axis,
      cyl.dir,
      cyl.r,
      { clearance: 0.001, poseName, base: basePose }
    );
    w.rhandPose = poseName;
    /** Per-weapon copy of the solve's own report — `Arm.lastFit` is overwritten
     *  by the next weapon built, so it cannot be read after boot. Diagnostic. */
    w.fitR = this.armR.lastFit;
    const z0 = Math.max(cyl.z0, cyl.z1);
    const z1 = Math.min(cyl.z0, cyl.z1);
    const kept = contacts.filter((p) => p.z <= z0 + 0.012 && p.z >= z1 - 0.012);
    this.armR.bakeContactAO(kept, 0.012, 0.7);
    this._bakeContactAOOnWeapon(w, kept, 0.012, 0.9);
    this.armR.setPose(poseName);
  }

  /**
   * The weapon side of the same contact gradient. The handguard geometry already
   * carries wear/grime/AO masks from `bakeMasks`, so this only ever RAISES the
   * AO channel — the edge-wear and grime layers are untouched.
   */
  _bakeContactAOOnWeapon(w, contacts, radius, peak) {
    if (!contacts.length) return;
    const r2 = radius * radius;
    for (const mesh of w.meshes) {
      const geo = mesh.geometry;
      const pos = geo.getAttribute('position');
      const col = geo.getAttribute('color');
      if (!pos || !col) continue;
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i);
        let closest = Infinity;
        for (const c of contacts) {
          const d2 = _v.distanceToSquared(c);
          if (d2 < closest) closest = d2;
        }
        if (closest > r2) continue;
        const t = 1 - Math.sqrt(closest) / radius;
        const s = t * t * t * (t * (t * 6 - 15) + 10);
        const k = i * 3 + 2;
        col.array[k] = Math.max(col.array[k], peak * s);
      }
      col.needsUpdate = true;
    }
  }

  setActive(id) {
    const w = this.weapons.get(id);
    if (!w || w === this.active) return this.active;
    if (this.active) this.active.group.visible = false;
    this.active = w;
    w.group.visible = true;
    this.recPos.reset();
    this.recRot.reset();
    this.settle.reset();
    this.boltCycle = 0;
    this.boltHold = 0;
    this.cylShots = 0;
    this.magInHand = 0;
    this.magVisible = true;
    // The FITTED poses for this weapon, not the authored ones — see
    // _fitShootingHand / _fitSupportHand.
    this.armR.setPose(w.rhandPose ?? 'grip');
    this.armL.setPose(w.lhandPose ?? (id === 'pistol' ? 'cup' : 'clamp'));
    // Elbows swing differently for a shouldered weapon and a pistol held out on
    // the arms — see Arm.setElbowPole for what going without this looked like.
    const ep = w.def?.elbowPole ?? null;
    for (const arm of [this.armR, this.armL]) {
      arm.setElbowPole(ep ? this._poleTmp.set(arm.side * ep[0], ep[1], ep[2]) : null);
    }
    return w;
  }

  /* ====================================================================== */
  /*  clip playback                                                         */
  /* ====================================================================== */

  play(name) {
    const w = this.active;
    if (!w) return 0;
    const clip = w.clips[name];
    if (!clip) return 0;
    this.clip = clip;
    this.clipT = 0;
    this.clipPrevT = -1;
    return clip.duration;
  }

  stopClip() {
    this.clip = null;
    this.clipResult.active = false;
    this.clipResult.lhand.weight = 0;
  }

  get clipPlaying() {
    return this.clip !== null;
  }

  get clipName() {
    return this.clip?.name ?? null;
  }

  /* ====================================================================== */
  /*  impulses                                                              */
  /* ====================================================================== */

  /**
   * Per-shot viewmodel kick. `pitch`/`yaw` are the aim-space recoil for this
   * shot (from the deterministic pattern) so the visual climb matches where the
   * bullets are actually going.
   */
  addRecoil(pitch, yaw, first = false) {
    const w = this.active;
    if (!w) return;
    const r = w.def.recoil;
    const ads = this.adsT;
    // Aiming braces the weapon: less travel, faster return.
    const scale = lerp(1, 0.54, ads) * (first ? 1.18 : 1);
    const jitter = 0.86 + this.rng.float() * 0.3;
    this.recPos.f = r.freq;
    this.recPos.z = r.damping;
    this.recRot.f = r.freq * 0.92;
    this.recRot.z = r.damping;
    // A velocity impulse of v0 on a spring of angular frequency w peaks at
    // roughly v0/w, so the kick amplitudes below are in real metres/radians.
    const wp = TAU * this.recPos.f;
    const wr = TAU * this.recRot.f;
    this.recPos.kick(
      this.rng.signed() * r.kickBack * 0.2 * scale * wp,
      r.kickUp * scale * jitter * wp,
      r.kickBack * scale * jitter * wp
    );
    this.recRot.kick(
      (pitch * 5.5 + r.pitch * 1.4) * scale * jitter * wr,
      (-yaw * 4.5 - this.rng.signed() * r.yaw * 0.8) * scale * wr,
      (this.rng.signed() * 0.4 + 0.6) * r.roll * scale * wr
    );
    // Slow settling drift after a burst — the muzzle keeps wandering a little.
    const ws = TAU * this.settle.f;
    this.settle.kick(
      this.rng.signed() * 0.0012 * scale * ws,
      0.0018 * scale * ws,
      this.rng.signed() * 0.003 * scale * ws
    );
    this.boltCycle = 1;
    // The revolver's hammer fall advances the cylinder one chamber.
    if (w.parts?.cylinder) this.cylShots++;
  }

  jump() {
    this.jumpSpring.kick(-1.2);
  }

  land(speed = 3) {
    this.landSpring.kick(clamp(speed * 0.45, 0.4, 3.4));
  }

  /* ====================================================================== */
  /*  frame update                                                          */
  /* ====================================================================== */

  /**
   * @param {number} dt
   * @param {object} s  { ads, sprint, lowReady, speed, crouch, airborne,
   *                      trigger, empty, cycleTime }
   */
  update(dt, s) {
    const w = this.active;
    if (!w) return;
    const def = w.def;
    // Defensive: a non-positive or absurd dt would integrate the whole
    // animation stack backwards (a negative step snaps ADS straight to 1).
    dt = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;

    /* -------- camera-relative anchor ---------------------------------- */
    const cam = this.ctx.camera;
    const vcam = this.ctx.viewCamera;
    if (this.trackCamera) {
      cam.updateMatrixWorld();
      this.anchor.position.setFromMatrixPosition(cam.matrixWorld);
      this.anchor.quaternion.setFromRotationMatrix(cam.matrixWorld);
      // Keep the viewmodel camera coincident with the world camera: the renderer
      // uses that to decide the gun can share the world's shadow cascades.
      vcam.position.copy(this.anchor.position);
      vcam.quaternion.copy(this.anchor.quaternion);
    }

    /* -------- angular velocity for the lag layer ---------------------- */
    _e.setFromQuaternion(this.anchor.quaternion, 'YXZ');
    const yaw = _e.y;
    const pitch = _e.x;
    if (this._hasPrev && dt > 1e-5) {
      const dy = wrapPi(yaw - this._prevYaw) / dt;
      const dp = wrapPi(pitch - this._prevPitch) / dt;
      // Low-pass, then clamp: a teleport must not throw the gun off screen.
      this._angVel.yaw = damp(this._angVel.yaw, clamp(dy, -9, 9), 18, dt);
      this._angVel.pitch = damp(this._angVel.pitch, clamp(dp, -9, 9), 18, dt);
    } else {
      this._angVel.yaw = 0;
      this._angVel.pitch = 0;
    }
    this._prevYaw = yaw;
    this._prevPitch = pitch;
    this._hasPrev = true;

    /* -------- blends --------------------------------------------------- */
    const adsRate = 1 / Math.max(0.05, def.adsTime);
    // `ads: false` in the def is a hard gate, not a preference: a knife has no
    // sight node to solve against, and RMB is its heavy attack.
    const canAds = def.ads !== false && w.sight;
    const wantAds = !canAds || (this.clip && this.clip.name !== 'draw') ? 0 : s.ads ? 1 : 0;
    this.adsTarget = wantAds;
    // Linear rate with a smootherstep shaping: a spring here reads as mushy.
    this.adsT = clamp01(this.adsT + (wantAds ? adsRate : -adsRate * 1.25) * dt);
    const ads = smootherstep(0, 1, this.adsT);

    const sprintTarget = s.sprint && !this.clip ? 1 : 0;
    this.sprintT = damp(this.sprintT, sprintTarget, 9, dt);
    this.lowReadyT = damp(this.lowReadyT, s.lowReady ? 1 : 0, 8, dt);

    this.triggerTarget = s.trigger ? 1 : 0;
    this.triggerT = damp(this.triggerT, this.triggerTarget, 26, dt);

    /* -------- base pose ------------------------------------------------ */
    const hipP = def.hipPos;
    const hipR = def.hipRot;
    this._basePos.set(hipP[0], hipP[1], hipP[2]);
    _e.set(hipR[0], hipR[1], hipR[2], 'XYZ');
    this._baseQuat.setFromEuler(_e);

    // Sprint / low-ready poses replace the hip pose.
    if (this.sprintT > 1e-3) {
      const p = def.sprintPos;
      const r = def.sprintRot;
      this._tmpPos.set(p[0], p[1], p[2]);
      _e.set(r[0], r[1], r[2], 'XYZ');
      this._tmpQuat.setFromEuler(_e);
      this._basePos.lerp(this._tmpPos, this.sprintT);
      this._baseQuat.slerp(this._tmpQuat, this.sprintT);
    }
    if (this.lowReadyT > 1e-3) {
      const p = def.lowReadyPos;
      const r = def.lowReadyRot;
      this._tmpPos.set(p[0], p[1], p[2]);
      _e.set(r[0], r[1], r[2], 'XYZ');
      this._tmpQuat.setFromEuler(_e);
      this._basePos.lerp(this._tmpPos, this.lowReadyT);
      this._baseQuat.slerp(this._tmpQuat, this.lowReadyT);
    }

    /* -------- ADS pose: solved, not authored ---------------------------
     * `canAds` gates the SOLVE as well as the target. Gating only the target
     * is not enough: swapping from an aimed pistol to the knife leaves adsT
     * mid-decay for a couple of frames, and the solve would then dereference a
     * sight node the knife does not have. */
    if (ads > 1e-4 && canAds) {
      const cant = def.adsCant;
      _e.set(cant[0], cant[1], cant[2], 'XYZ');
      this._adsQuat.setFromEuler(_e);
      // sight point in rig space, then the translation that lands it on axis
      this._sightLocal.copy(w.sight).applyQuaternion(this._adsQuat);
      this._adsPos.set(0, 0, -def.eyeRelief).sub(this._sightLocal);
      this._basePos.lerp(this._adsPos, ads);
      this._baseQuat.slerp(this._adsQuat, ads);
    }

    /* -------- additive layers ------------------------------------------ */
    const swayScale = def.swayScale * lerp(1, 0.22, ads) * lerp(1, 1.5, this.sprintT);
    this.noiseT += dt;
    const n = this.noise;
    const nr = this.noiseRates;
    const t = this.noiseT;
    // Layered, incommensurate rates: the pattern does not repeat in a session.
    const swayX = n[0].fbm(t * nr[0], 3) * 0.55 + n[3].fbm(t * nr[3] * 2.3, 2) * 0.45;
    const swayY = n[1].fbm(t * nr[1], 3) * 0.55 + n[4].fbm(t * nr[4] * 2.1, 2) * 0.45;
    const swayZ = n[2].fbm(t * nr[2], 2) * 0.6 + n[5].fbm(t * nr[5] * 1.7, 2) * 0.4;
    // Breathing: a slow 0.22 Hz cycle under the noise.
    const breath = Math.sin(t * 1.38) * 0.5 + Math.sin(t * 0.61 + 1.1) * 0.25;

    let px = swayX * 0.0075 * swayScale;
    let py = (swayY * 0.006 + breath * 0.0022) * swayScale;
    let pz = swayZ * 0.004 * swayScale;
    let rx = (swayY * 0.021 + breath * 0.006) * swayScale;
    let ry = swayX * 0.028 * swayScale;
    let rz = swayZ * 0.017 * swayScale;

    /* -------- movement bob --------------------------------------------- */
    const speed = s.speed ?? 0;
    const bobAmt =
      def.bobScale * clamp01(speed / 4.2) * lerp(1, 0.28, ads) * (s.airborne ? 0.25 : 1);
    if (speed > 0.05) {
      // Stride frequency scales with speed; sprint takes longer strides.
      this.bobPhase += dt * (3.1 + speed * 0.72) * (s.sprint ? 1.05 : 1);
      if (this.bobPhase > TAU * 64) this.bobPhase -= TAU * 64;
    }
    const bp = this.bobPhase;
    px += Math.sin(bp) * 0.0165 * bobAmt;
    py += (Math.abs(Math.cos(bp)) - 0.6) * 0.0125 * bobAmt;
    pz += Math.sin(bp * 2) * 0.0055 * bobAmt;
    rz += Math.sin(bp) * 0.031 * bobAmt;
    rx += Math.cos(bp * 2) * 0.014 * bobAmt;
    ry += Math.sin(bp + 0.6) * 0.019 * bobAmt;

    /* -------- weapon lag ---------------------------------------------- */
    const lagScale = lerp(1, 0.42, ads);
    const av = this._angVel;
    this.lag.step(
      dt,
      clamp(-av.yaw * 0.019, -0.05, 0.05) * lagScale,
      clamp(av.pitch * 0.014, -0.04, 0.04) * lagScale,
      clamp(-Math.abs(av.yaw) * 0.006, -0.03, 0.03) * lagScale
    );
    this.lagRot.step(
      dt,
      clamp(-av.pitch * 0.075, -0.24, 0.24) * lagScale,
      clamp(av.yaw * 0.085, -0.3, 0.3) * lagScale,
      clamp(-av.yaw * 0.055, -0.2, 0.2) * lagScale
    );
    px += this.lag.x;
    py += this.lag.y;
    pz += this.lag.z;
    rx += this.lagRot.x;
    ry += this.lagRot.y;
    rz += this.lagRot.z;

    /* -------- recoil + settle ----------------------------------------- */
    this.recPos.step(dt, 0, 0, 0);
    this.recRot.step(dt, 0, 0, 0);
    this.settle.step(dt, 0, 0, 0);
    px += this.recPos.x;
    py += this.recPos.y;
    pz += this.recPos.z;
    rx += this.recRot.x + this.settle.y;
    ry += this.recRot.y + this.settle.x;
    rz += this.recRot.z + this.settle.z;

    /* -------- jump / land --------------------------------------------- */
    this.jumpSpring.step(dt, 0);
    this.landSpring.step(dt, 0);
    py -= this.landSpring.x * 0.014 + this.jumpSpring.x * 0.006;
    rx -= this.landSpring.x * 0.05;

    /* -------- clip (reload / inspect / draw) -------------------------- */
    const res = this.clipResult;
    if (this.clip) {
      this.clipT += dt;
      const c = this.clip;
      const tt = clamp(this.clipT, 0, c.duration);
      c.sample(tt, res);
      for (const ev of c.events) {
        if (ev.t > this.clipPrevT && ev.t <= tt) this.onClipEvent?.(ev.name, c.name);
      }
      this.clipPrevT = tt;
      px += res.pos[0];
      py += res.pos[1];
      pz += res.pos[2];
      rx += res.rot[0];
      ry += res.rot[1];
      rz += res.rot[2];
      if (this.clipT >= c.duration) {
        this.stopClip();
      }
    }

    /* -------- compose -------------------------------------------------- */
    this.rig.position.set(
      this._basePos.x + px,
      this._basePos.y + py,
      this._basePos.z + pz
    );
    _e.set(rx, ry, rz, 'XYZ');
    _q.setFromEuler(_e);
    this.rig.quaternion.copy(this._baseQuat).multiply(_q);
    // The standalone preview harness pins the rig so the weapon can be framed
    // in its own space; everything downstream reads the composed transform.
    if (this.rigOverride) {
      this.rig.position.copy(this.rigOverride.position);
      this.rig.quaternion.copy(this.rigOverride.quaternion);
    }
    this.rig.updateMatrix();
    this.rig.updateMatrixWorld(true);

    /* -------- hands (first: the magazine can be held by one) ---------- */
    this._solveHands(w, res);

    /* -------- moving parts -------------------------------------------- */
    this._updateParts(w, dt, s, res);

    /* -------- reticle -------------------------------------------------- */
    this._updateReticle(w, ads);

    /* -------- viewmodel FOV ------------------------------------------- */
    const fovBase = 60;
    const targetFov = fovBase * lerp(1, def.viewFov, ads);
    if (Math.abs(vcam.fov - targetFov) > 1e-3) {
      vcam.fov = targetFov;
      vcam.updateProjectionMatrix();
    }
  }

  /* ---------------------------------------------------------------------- */

  _updateParts(w, dt, s, res) {
    const p = w.parts;

    // Bolt / slide cycle: a fast rearward stroke and a slightly slower return.
    if (this.boltCycle > 0) {
      const cycle = Math.max(0.045, (w.def.cycleTime ?? 60 / w.def.rpm) * 0.62);
      this.boltCycle = Math.max(0, this.boltCycle - dt / cycle);
    }
    const cyc = this.boltCycle;
    // 1 -> 0 over the cycle: out fast, back with a small bounce.
    const stroke = cyc > 0.55 ? (1 - cyc) / 0.45 : cyc / 0.55;
    const clipBolt = res.active ? res.parts.bolt : 0;
    const boltOff = Math.max(stroke, this.boltHold, clipBolt * this.boltHold);

    if (p.bolt) {
      p.bolt.position.set(
        w.model.nodes.boltRest.pos[0] + w.boltTravel.x * boltOff,
        w.model.nodes.boltRest.pos[1] + w.boltTravel.y * boltOff,
        w.model.nodes.boltRest.pos[2] + w.boltTravel.z * boltOff
      );
    }
    if (p.slide) {
      p.slide.position.set(
        w.model.nodes.slideRest.pos[0] + w.slideTravel.x * boltOff,
        w.model.nodes.slideRest.pos[1] + w.slideTravel.y * boltOff,
        w.model.nodes.slideRest.pos[2] + w.slideTravel.z * boltOff
      );
    }
    if (p.charging) {
      const pull = res.active ? res.parts.charge : 0;
      const rest = w.model.nodes.chargeRest.pos;
      p.charging.position.set(
        rest[0] + w.chargePull.x * pull,
        rest[1] + w.chargePull.y * pull,
        rest[2] + w.chargePull.z * pull
      );
    }
    if (p.trigger) {
      p.trigger.rotation.x = w.triggerPull * this.triggerT;
    }
    /**
     * REVOLVER CYLINDER — indexes one chamber per hammer fall, riding the
     * same 0..1 `boltCycle` every other action uses: at the shot the drum is
     * still on the fired chamber, and it rolls onto the next one as the cycle
     * decays. `cylShots` counts shots since the draw, so the rotation is
     * absolute and cannot drift.
     */
    if (p.cylinder && w.model.nodes.cylinderSpec) {
      const steps = w.model.nodes.cylinderSpec.steps ?? 6;
      const turn = (Math.PI * 2) / steps;
      const roll = 1 - Math.min(1, this.boltCycle);
      p.cylinder.rotation.z = -turn * (Math.max(0, this.cylShots - 1) + roll * Math.min(1, this.cylShots));
    }
    if (p.selector) {
      p.selector.rotation.x = lerp(-0.95, 0, clamp01(this.selectorLive ?? 1));
    }

    // Magazine: seated, in the support hand, or hidden.
    if (p.magazine) {
      const inHand = res.active ? res.parts.mag : 0;
      this.magVisible = res.active ? res.parts.magVisible : true;
      p.magazine.visible = this.magVisible;
      if (!w.magSeatPos) {
        // no magazine on this weapon at all
      } else if (inHand > 1e-4) {
        // Follow the support hand: the magazine is gripped by its spine.
        this._magFromHand(w, p.magazine, inHand);
      } else {
        p.magazine.position.copy(w.magSeatPos);
        p.magazine.quaternion.copy(w.magSeatQuat);
      }
    }
  }

  _magFromHand(w, magGroup, weight) {
    // The hand target is a WRIST in weapon space, so the magazine has to be
    // offset into the palm (about 62 mm along the hand's -Z, the metacarpal
    // axis) before the along-the-magazine offset — otherwise the mag is gripped
    // by thin air behind the hand.
    _q.copy(this._handQuatL);
    _v.copy(this._handPosL);
    _v2.set(0, w.magLen * 0.62, -0.062).applyQuaternion(_q);
    _v.add(_v2);
    magGroup.position.lerpVectors(w.magSeatPos, _v, weight);
    _q2.copy(w.magSeatQuat).slerp(_q, weight);
    magGroup.quaternion.copy(_q2);
  }

  _solveHands(w, res) {
    // Shoulders are body-fixed: express the camera-space anchor in rig space.
    _q.copy(this.rig.quaternion).invert();
    _v.copy(this.shoulderR).sub(this.rig.position).applyQuaternion(_q);
    this.armR.shoulder.copy(_v);
    _v.copy(this.shoulderL).sub(this.rig.position).applyQuaternion(_q);
    this.armL.shoulder.copy(_v);

    // ---- shooting hand: welded to the grip ----
    const gR = w.gripR;
    this._handPos.fromArray(gR.pos);
    handBasis(this._handQuat, gR.finger ?? [0, -0.35, -0.94], gR.back ?? [0.95, 0.25, 0.18]);
    const rPose = w.rhandPose ?? 'grip';
    if (rPose !== this.armR.pose) this.armR.setPose(rPose);
    this.armR.solve(this._handPos, this._handQuat);
    // setTrigger overwrites the index finger's three joints every frame. On a
    // weapon with no trigger group that would straighten the one finger the
    // fingertip solve just wrapped around the handle, and it is the finger
    // nearest the guard — the one the camera sees.
    if (w.hasTrigger !== false) this.armR.setTrigger(this.triggerT);

    // ---- support hand: grip, or wherever the clip puts it ----
    const gL = w.gripL;
    let pos = gL.pos;
    let finger = gL.finger ?? [0.82, 0.5, -0.28];
    let back = gL.back ?? [-0.5, 0.32, -0.8];
    let pose = w.lhandPose ?? (w.id === 'pistol' ? 'cup' : 'clamp');
    if (res.active && res.lhand.weight > 0.5) {
      pos = res.lhand.pos;
      finger = res.lhand.finger;
      back = res.lhand.back;
      pose = res.lhand.pose;
    }
    this._handPosL.set(pos[0], pos[1], pos[2]);
    /**
     * IN ADS THE SUPPORT HAND SLIDES FORWARD ON THE HANDGUARD.
     *
     * MEASURED against first-person viewmodel references (CS2 and the like) and
     * against range photography, which agree here: the support forearm reaches
     * FORWARD ALONG the weapon, 25-40 degrees off the bore. At the hip this rig
     * does that — the carbine is 33.3 degrees. The moment you aim it is 70, the
     * AK 85, the SMG 86: the arm lies ACROSS the gun, which is the "he is
     * leaning on it, not holding it" read.
     *
     * The cause is structural, not a bad authored number. The support target is
     * fixed in WEAPON space, so when ADS pulls the weapon back toward the eye
     * the hand travels back with it and ends up close to and above a shoulder
     * that has not moved — and a short forearm between two nearby points can
     * only point sideways. A real shooter's rifle also comes back to the
     * shoulder, but their support hand STAYS half a metre downrange and the
     * elbow drops instead.
     *
     * So the hand slides down the handguard as the aim blends in. Clamped to
     * the handguard's own authored span (less a hand's half-width) so it can
     * never leave the surface it is solved against, which would undo the
     * fingertip contact the build-time solve established.
     */
    const hgN = w.model.nodes.handguard;
    if (hgN && this.adsT > 0.001) {
      /**
       * 0.13 m. MEASURED across 0.075 / 0.13 / 0.19 / 0.25: the carbine improves
       * to 54.8 degrees at 0.13 and then stops, and the AK and the sniper do not
       * move at all, because the clamp below is already hard against the front
       * of their handguards at the smallest push. An AK handguard is 122 mm
       * long; there is nowhere further forward to put the hand.
       */
      const push = (w.def?.adsSupportPush ?? 0.13) * this.adsT;
      const front = Math.min(hgN.z0, hgN.z1) + 0.045;
      this._handPosL.z = Math.max(front, this._handPosL.z - push);
    }
    handBasis(this._handQuatL, finger, back);
    if (pose !== this.armL.pose) this.armL.setPose(pose);
    this.armL.solve(this._handPosL, this._handQuatL);
  }

  /**
   * The collimated dot.
   *
   * A red dot sight is a collimator: the reticle sits at optical infinity along
   * the tube axis, so its apparent direction from the eye is the tube axis —
   * independent of where the eye is. Reproducing that exactly (rather than
   * gluing a sprite to the glass) is why the dot stays on target while the
   * weapon sways, and why it vignettes out when you look through the tube from
   * an angle.
   */
  _updateReticle(w, ads) {
    const optic = w.optic;
    if (!optic) {
      this.reticle.visible = false;
      return;
    }
    // Optic axis and lens centre, both in camera space. The weapon group is a
    // child of the rig which is a child of the anchor, so camera space is just
    // the rig transform applied to the weapon-local values — no inverses, no
    // allocation.
    _v.fromArray(optic.center).applyQuaternion(this.rig.quaternion).add(this.rig.position);
    _v3.set(0, 0, -1).applyQuaternion(this.rig.quaternion).normalize();

    // Where the axis ray from the eye crosses the lens plane.
    const s = _v.dot(_v3);
    if (s <= 0.02) {
      this.reticle.visible = false;
      return;
    }
    _v2.copy(_v3).multiplyScalar(s); // dot position in camera space
    // Vignette: how far off the lens centre the apparent dot lands.
    const offX = _v2.x - _v.x;
    const offY = _v2.y - _v.y;
    const off = Math.hypot(offX, offY);
    const apertureR = optic.apertureR ?? 0.01;
    let alpha = 1 - smootherstep(apertureR * 0.5, apertureR * 1.05, off);
    alpha *= lerp(0.55, 1, ads); // brighter once the eye is behind the glass

    if (alpha <= 0.01) {
      this.reticle.visible = false;
      return;
    }
    this.reticle.visible = true;
    this.reticle.position.copy(_v2);
    this.reticle.lookAt(this.anchor.getWorldPosition(_v));
    /**
     * SIZE. Angular, so it is FOV-independent within a stance — but not constant
     * across stances, because the requirement is a fixed number of PIXELS.
     *
     * A geometrically honest 2 MOA emitter subtends 0.58 mrad, which at the
     * viewmodel camera's 0.97 mrad/px (60 deg over 1080 px) is 0.6 px: a dead
     * subpixel, which is exactly what the old 0.0012 rad dot measured as. Every
     * shipped red dot cheats this, and cheats it in the same direction — the
     * reticle is drawn at a legible size and grows as you come into the glass,
     * because that is the perceptual experience of putting your eye behind a
     * collimator. So:
     *   hipfire  0.00385 rad -> 4.0 px radius,  7.9 px dot
     *   ADS      0.00655 rad -> 7.9 px radius, 15.7 px dot   (0.83 mrad/px)
     * with the halo at 1.6x and the segmented ring at 3.2x, both scaled off the
     * same number so the reticle never changes shape.
     */
    const coreR = s * lerp(0.00385, 0.00655, ads);
    this.dotCore.scale.setScalar(coreR);
    this.dotRim.scale.setScalar(coreR);
    this.dotHalo.scale.setScalar(coreR);
    this.dotRing.scale.setScalar(coreR);
    this.dotCore.material.opacity = alpha;
    this.dotRim.material.opacity = alpha * 0.8;
    this.dotRing.material.opacity = alpha;
    // The halo is a bloom seed, not a glow: 6% at 1.6x the core radius adds ~1 px
    // of soft falloff and nothing else.
    this.dotHalo.material.opacity = alpha * 0.06;
  }

  /* ====================================================================== */
  /*  world-space queries for firing                                        */
  /* ====================================================================== */

  /** Muzzle position in WORLD space (for the flash and the shell). */
  muzzleWorld(out) {
    const w = this.active;
    if (!w) return out.set(0, 0, 0);
    w.group.updateMatrixWorld();
    out.copy(w.muzzle).applyMatrix4(w.group.matrixWorld);
    // viewScene space == world space because the anchor tracks the camera.
    return out;
  }

  ejectWorld(out) {
    const w = this.active;
    if (!w || !w.eject) return out.set(0, 0, 0);
    w.group.updateMatrixWorld();
    out.copy(w.eject).applyMatrix4(w.group.matrixWorld);
    return out;
  }

  ejectVelocity(out, speed = 2.6) {
    const w = this.active;
    if (!w || !w.eject) return out.set(0, 0, 0);
    out.copy(w.ejectDir).transformDirection(w.group.matrixWorld).multiplyScalar(speed);
    return out;
  }

  /** Bore direction in world space. */
  boreDir(out) {
    const w = this.active;
    if (!w) return out.set(0, 0, -1);
    out.set(0, 0, -1).transformDirection(w.group.matrixWorld).normalize();
    return out;
  }

  dispose() {
    for (const w of this.weapons.values()) {
      for (const m of w.meshes) m.geometry.dispose();
    }
    this.weapons.clear();
    this.armL.dispose();
    this.armR.dispose();
    for (const g of this._reticleGeo) g.dispose();
    this.anchor.removeFromParent();
  }
}

function applyNode(obj, node) {
  obj.position.fromArray(node.pos);
  if (node.rot) obj.rotation.fromArray(node.rot);
}
