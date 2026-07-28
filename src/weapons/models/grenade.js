import { Assembly, latheZ, rodZ, ring, extrude, dome, knurlBand } from '../geometry.js';

/**
 * The fragmentation grenade — an M67-pattern hand grenade.
 *
 * Layout (weapon-local metres, +Z is the FUZE AXIS — see `gripCylinder` for
 * why it is Z and not Y — with the body centred on the origin, so the origin
 * is also the point the fingers close on):
 *   body sphere      r = 0.0285      (57 mm, the real M67 diameter)
 *   equator seam     z = 0           the weld line between the two hemispheres
 *   marking band     z = 0.0116 .. 0.0175
 *   fuze collar      z = 0.0195 .. 0.0240   (M213 fuze, 22.4 mm across)
 *   striker housing  z = 0.0240 .. 0.0300
 *   safety lever     from the striker cap at z = +0.031 down the +X flank to
 *                    z = -0.009, standing 2.6 mm off the body
 *   pull ring        centred (-0.0012, 0.0142, 0.0243), 9.8 mm ring on the pin
 * Overall 90 mm from plug to spoon hook, 400 g. A real frag, not a baseball
 * and not a pineapple — the M26's ribbed sleeve was dropped in 1968.
 *
 * There is no magazine, no optic, no ejection port and no bore, and — like the
 * knife — those nodes are ABSENT rather than zeroed, because the viewmodel and
 * the clip builder branch on their existence (see models/knife.js).
 *
 * `muzzle` IS present, because `Viewmodel.addWeapon` reads it unconditionally
 * and because a thrown weapon does have a business end: the point the grenade
 * leaves the hand from. It is the body centre.
 */
export function buildGrenade() {
  const body = new Assembly('grenade');

  const R = 0.0285;
  /** Radius of the sphere at height h — the whole body is derived from this. */
  const rAt = (h) => Math.sqrt(Math.max(0, R * R - h * h));

  const zFuze = 0.0195; // where the sphere is cut for the fuze boss
  const rFuze = rAt(zFuze);

  /* ---- body ------------------------------------------------------------ */
  /**
   * ONE LATHE FROM POLE TO FUZE, sampled off the sphere equation rather than
   * typed in, so the silhouette is a real 57 mm ball at any segment count.
   *
   * The profile is NOT a clean half-circle: it carries a 0.6 mm step at the
   * equator (the two drawn hemispheres are crimped together there and the seam
   * is the one hard line on an otherwise smooth grenade) and a flat facet at
   * the bottom pole where the filler plug goes.
   */
  const prof = [];
  const steps = 18;
  prof.push([-R + 0.0008, 0]);
  for (let i = 0; i <= steps; i++) {
    const h = -R + 0.0008 + ((zFuze + R - 0.0008) * i) / steps;
    // The seam: a 0.5 mm proud collar either side of the equator.
    const seam = Math.abs(h) < 0.0016 ? 0.0005 * (1 - Math.abs(h) / 0.0016) : 0;
    prof.push([h, rAt(h) + seam]);
  }
  prof.push([zFuze, rFuze - 0.0012]);
  const shell = latheZ(prof, 32);
  body.add(shell, 'enamel_od', {});
  shell.dispose();

  /**
   * THE FILLER PLUG at the bottom pole. A grenade is filled through the base
   * and closed with a screwed plug, and it is the one asymmetry on the lower
   * half — without it the underside is a featureless dome and reads as a
   * billiard ball from below.
   */
  const plug = latheZ(
    [
      [0, 0],
      [0, 0.0052],
      [0.0009, 0.0058],
      [0.0026, 0.0058],
      [0.0026, 0],
    ],
    16
  );
  body.add(plug, 'steel_enamel', { z: -R + 0.0006, ry: Math.PI });
  plug.dispose();

  /**
   * THE MARKING BAND — a painted ring, not a machined one, so it is a 0.4 mm
   * proud shell wrapped on the sphere rather than a groove. Every HE grenade
   * carries one and it is the single feature that stops an olive ball reading
   * as a rock; `polymer_tan` is the library's only warm dielectric, which is
   * what a paint band has to be (a metal here would take an F0 tint and flare).
   */
  const bandLo = 0.0045;
  const bandHi = 0.0125;
  const bandGeo = latheZ(
    [
      [bandLo, rAt(bandLo)],
      [bandLo + 0.0005, rAt(bandLo) + 0.0006],
      [bandHi - 0.0005, rAt(bandHi) + 0.0006],
      [bandHi, rAt(bandHi)],
    ],
    32
  );
  body.add(bandGeo, 'polymer_tan', {});
  bandGeo.dispose();

  /* ---- fuze ------------------------------------------------------------ */
  // Threaded collar screwed into the body's neck, then the striker housing.
  const collar = latheZ(
    [
      [0, 0.0104],
      [0.0042, 0.0112],
      [0.0044, 0.0112],
      [0.0045, 0.0104],
      [0.0045, 0.0062],
    ],
    22
  );
  body.add(collar, 'steel', { z: zFuze });
  collar.dispose();
  // Wrench flats read as knurling at this size; the real collar is hex.
  const knurl = knurlBand(0.0112, 0.0034, 26, 0.00035, 2);
  body.add(knurl, 'steel', { z: zFuze + 0.0022 });
  knurl.dispose();

  const housing = latheZ(
    [
      [0, 0.0062],
      [0.0048, 0.0062],
      [0.0052, 0.0058],
      [0.0058, 0.0058],
    ],
    18
  );
  body.add(housing, 'steel', { z: zFuze + 0.0045 });
  housing.dispose();
  const strikerCap = dome(0.0058, 14, 0.5);
  body.add(strikerCap, 'steel', { z: zFuze + 0.0103 });
  strikerCap.dispose();

  /**
   * THE EAR the safety pin passes through — a stamped tab on the -X side of
   * the housing, 2.2 mm thick across Y. The pin has to go through SOMETHING
   * or the ring floats in the air beside the fuze.
   */
  const ear = extrude(
    [
      [-0.0052, 0.0],
      [-0.0012, 0.0],
      [-0.0012, 0.0068],
      [-0.0052, 0.0068],
    ],
    0.0022,
    { bevel: 0.0004 }
  );
  body.add(ear, 'steel', { z: zFuze + 0.0032, rx: Math.PI / 2 });
  ear.dispose();

  /* ---- safety lever (the spoon) ---------------------------------------- */
  /**
   * THE SPOON IS THE SILHOUETTE. A sphere alone is a ball; the spoon hooked
   * over the striker and running down the flank is what says "grenade" at a
   * glance, so it is a real 1.7 mm stamped strip standing off the body, not a
   * decal — it casts its own shadow into the gap and the gap is readable.
   *
   * PAINTED, in `steel_enamel`, not bare `steel`. Built in bare steel first and
   * it photographed as a chrome ribbon laid across the body — the brightest
   * thing in the frame by a distance. Same defect the knife blade documents at
   * length: a flat metal facing the viewmodel key is a mirror by construction,
   * and a lever is 11 x 60 mm of flat. A real lever is painted with the body
   * for exactly the reason the render objects to.
   *
   * One closed outline in the plane that contains the fuze axis, extruded
   * 9.5 mm across it: the hook over the striker cap, down the outer arc at
   * R + 4.2 mm, back up the inner arc at R + 2.6 mm. `extrude` works in XY and
   * pushes along Z, so the whole piece is turned a quarter about X — the
   * outline's own "up" becomes +Z (the fuze axis) and the extrusion depth
   * becomes the lever's 9.5 mm width across Y.
   */
  const off = 0.0016;
  const th = 0.0017;
  const a0 = 0.30; // rad from the fuze axis, just clear of the collar
  const a1 = 2.25; // ~129 deg, i.e. well past the equator on the +X flank
  const arcN = 9;
  const pts = [[-0.0022, 0.0312], [0.0092, 0.0298]];
  for (let i = 0; i <= arcN; i++) {
    const a = a0 + ((a1 - a0) * i) / arcN;
    const r = R + off + th;
    pts.push([Math.sin(a) * r, Math.cos(a) * r]);
  }
  for (let i = arcN; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / arcN;
    const r = R + off;
    pts.push([Math.sin(a) * r, Math.cos(a) * r]);
  }
  pts.push([0.0082, 0.0288]);
  const spoon = extrude(pts, 0.0112, { bevel: 0.0005, curveSegments: 4 });
  body.add(spoon, 'steel_enamel', { rx: Math.PI / 2 });
  spoon.dispose();

  /**
   * The stiffening channel pressed down the middle of the lever. 0.5 mm of
   * relief on a 9.5 mm strip: invisible at arm's length, and at 0.5 m it is the
   * difference between a stamped part and a grey ribbon.
   */
  const ribPts = [];
  for (let i = 0; i <= arcN; i++) {
    const a = a0 + ((a1 - a0) * i) / arcN;
    ribPts.push([Math.sin(a) * (R + off + th + 0.0004), Math.cos(a) * (R + off + th + 0.0004)]);
  }
  for (let i = arcN; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / arcN;
    ribPts.push([Math.sin(a) * (R + off + th - 0.0002), Math.cos(a) * (R + off + th - 0.0002)]);
  }
  const rib = extrude(ribPts, 0.0052, { bevel: 0.0003, curveSegments: 4 });
  body.add(rib, 'steel_enamel', { rx: Math.PI / 2 });
  rib.dispose();

  /* ---- pin and pull ring ----------------------------------------------- */
  /**
   * A SEPARATE ASSEMBLY, because the pin comes OUT.
   *
   * It is listed under `moving` purely so the viewmodel builds it into its own
   * Object3D — nothing drives it, and `Viewmodel.addWeapon` only seats the
   * moving parts it has rest nodes for (magazine, bolt, slide, charging,
   * trigger, selector), so an unknown name is left at identity, which is
   * exactly right for geometry already authored in weapon space. The weapon
   * system hides the whole group on the `pinpull` beat and shows it again on
   * the draw: a cooked grenade with the ring still hanging off the fuze is the
   * same lie as a fired case still in the chamber.
   */
  const pinAsm = new Assembly('grenade-pin');
  const pin = rodZ(0.0011, 0.0011, 0.0135, 10, 0.0003);
  pinAsm.add(pin, 'steel_bright', { x: -0.0032, y: 0.0022, z: zFuze + 0.0058, rx: Math.PI / 2 });
  pin.dispose();
  /**
   * A ring on a pin is PERPENDICULAR to it — the pin passes through the ring —
   * so the ring's own axis has to be the pin's. `ring()` is a torus in XY (axis
   * +Z), and the pin runs along Y, so a quarter turn about X puts the ring's
   * axis on Y and its plane in XZ: the plane that contains the fuze axis, which
   * is where a pull ring visibly hangs. Left flat around the collar (the axes
   * agreeing with each other by accident) it photographs as a saucer.
   */
  const pullRing = ring(0.0098, 0.0013, 20, 6);
  pinAsm.add(pullRing, 'steel_bright', {
    x: -0.0138,
    y: 0.0022,
    z: zFuze + 0.0062,
    rx: Math.PI / 2,
    ry: 0.3,
  });
  pullRing.dispose();

  return {
    id: 'grenade',
    label: 'M67',
    fxClass: 'melee',
    /**
     * PER-MATERIAL WEAR AMPLITUDE — the knife's lesson, on a sphere.
     *
     * `bakeMasks` measures convexity per VERTEX and a lathed ball has no
     * interior vertices at all: every vertex sits on the outline, so every one
     * measures fully convex and the wear layer paints the entire body as
     * polished-through steel. On a 57 mm ball held 0.3 m from the eye that is a
     * chrome bauble. 0.3 on the painted shell and 0.4 on the bare pressings
     * leaves the wear on the seam, the collar and the lever's edges, where a
     * grenade that has lived in a pouch actually wears. Grime and AO are
     * untouched — they are what fill the seam and the gap under the spoon.
     */
    wearScale: { enamel_od: 0.3, steel: 0.4, steel_enamel: 0.26, polymer_tan: 0.35, steel_bright: 0.5 },
    body,
    moving: { pin: pinAsm },
    nodes: {
      /**
       * The release point — where the grenade leaves the hand. `muzzle` is the
       * name the rig already uses for "the business end in weapon space" and
       * `Viewmodel.addWeapon` reads it unconditionally, so the thrown body is
       * spawned from it rather than from a parallel node nothing else knows.
       */
      muzzle: [0, 0, 0],
      /**
       * THE BODY, AS A CYLINDER — what the fingers close on.
       *
       * `Viewmodel._fitShootingHand` bails at `if (!cyl || !gR) return;`, so
       * without this the hand would wear the raw authored pose and never touch
       * the grenade (this is exactly how the knife was broken; see knife.js).
       * A sphere is not a cylinder, but the fingers only ever wrap one great
       * circle of it, and the solve measures perpendicular distance to the
       * axis — so a 28.5 mm cylinder through the centre IS the section the
       * fingers close on, with the error only at the poles, where no fingertip
       * lands.
       *
       * THE AXIS IS Z, not the fuze axis, and that is not a modelling opinion —
       * it is what makes the search's span test do anything. `gapAt` measures
       * perpendicular distance to an INFINITE cylinder, and the only thing
       * stopping a hand from sliding down that infinite tube into open air is
       * `onGrip`, which tests the contact's weapon-space **z** against z0/z1
       * (see `Viewmodel.debugRefitRight`). With the axis on Y that test is
       * blind to exactly the degree of freedom that runs away, and the first
       * search proved it: every fingertip 0.4 mm off the surface with the hand
       * 276 mm below the grenade. On Z, sliding along the axis IS sliding in z,
       * the span catches it, and the four fingertips end up spread across the
       * ball's own 57 mm the way four fingers on a ball actually are.
       */
      gripCylinder: {
        axis: [0, 0, 0],
        dir: [0, 0, 1],
        r: R,
        z0: R,
        z1: -R,
      },
      /**
       * SHOOTING HAND — SEARCHED, not derived. See tools/gripfit.mjs.
       *
       * Numbers pasted back from `node tools/gripfit.mjs --only=grenade`, which
       * walks the wrist target and the two hand directions by coordinate
       * descent from twelve seeds and scores fingertip contact, wrist bend, how
       * many fingertips land on the body's own span, and arm extension. Every
       * previous hand in this directory that was authored by reasoning about
       * the geometry — carbine, pistol, knife — measured 15 to 24 mm off the
       * grip and had to be searched in the end anyway.
       */
      gripR: {
        pos: [-0.0403, -0.0453, 0.029],
        finger: [-0.0451, 0.9988, -0.0168],
        back: [-0.8032, 0.2365, 0.5468],
      },
      /**
       * SUPPORT HAND — off the weapon entirely, like the knife's.
       *
       * You throw a grenade with one hand. The support hand is carried low and
       * outboard and the pose stays `open`; the pin is pulled by the SHOOTING
       * hand's own thumb in the cook clip, which is how it is actually done —
       * the two-handed "pull the ring with the other hand" is a movie.
       */
      /**
       * SEARCHED in the same measured way the shooting hand is, because the
       * knife's numbers do NOT transfer: `gripL` is a point in WEAPON space,
       * and this weapon's rest rotation is nothing like the knife's, so the
       * inherited target measured a 101.5-degree wrist and 0.913 extension —
       * an arm reaching out straight with the hand folded back on it. Solved
       * against wrist bend, reach and where the hand lands in camera space:
       * 29.5 degrees, 30% extension, elbow 0.426 m from the eye, and the hand
       * itself at camera (-0.301, -0.346, -0.070), i.e. below the frame with
       * only the forearm entering from the lower left.
       *
       * Each trial is settled over real FRAMES, not by calling the rig's update
       * in a loop: the composed rest pose damps toward its target, so a search
       * that measures three ticks after moving the node scores a hand that is
       * still on its way there. That version returned 32.7 degrees and the same
       * node measured 81.5 in the capture harness.
       */
      gripL: {
        pos: [0.2534, -0.3983, 0.3198],
        finger: [0.715, -0.6219, 0.3195],
        back: [0.208, 0.8578, -0.4701],
      },
      lhandPose: 'open',
      /**
       * A fist round a ball, not a pistol grip. `clamp` is the library's
       * widest-radius closed pose (solved against a 47 mm handguard, the
       * closest thing to a 57 mm ball), so it is the seed the per-fingertip
       * solve starts from; `hammer`'s 1.5 rad curls are sized for a 25 mm
       * handle and start every finger buried inside this body.
       */
      rhandPose: 'clamp',
    },
  };
}
