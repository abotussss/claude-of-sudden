import { Assembly } from '../geometry.js';
import { addKnifeBlade, addKnifeGuard, addKnifeHandle } from '../parts.js';

/**
 * The combat knife — a 125 mm drop-point fighting blade on a scalloped polymer
 * handle with a steel skull-crusher pommel.
 *
 * Layout (weapon-local metres, origin at the shooting hand's thumb web, which
 * on a hammer grip is the point immediately behind the guard):
 *   handle axis      y = 0, on the Z axis
 *   pommel butt      z = +0.120
 *   handle           z = +0.093 .. -0.008
 *   cross-guard      z = -0.008 .. -0.017
 *   ricasso          z = -0.017 .. -0.036   (plunge line at -0.036)
 *   blade            z = -0.036 .. -0.161
 *   spine            y = +0.012 falling to the point
 *   edge             y = -0.019 rising to the point
 *   point            y = -0.0035, z = -0.161
 * Overall 281 mm, blade 125 mm — a real fighting knife, not a machete and not
 * a boot dagger.
 *
 * There is no magazine, no optic, no ejection port and no bore. Those nodes are
 * ABSENT rather than zeroed: the viewmodel and the clip builder branch on the
 * weapon class, and a fake `magSeat` at the origin would put a phantom
 * magazine-swap into every reload timeline.
 */
export function buildKnife() {
  const body = new Assembly('knife');

  const zPlunge = -0.036;
  const zTip = -0.161;

  // Blade: blued flats, polished ground bevel. See addKnifeBlade for the
  // section-by-section derivation of the swedge, the fuller and the grind line.
  const blade = addKnifeBlade(body, 'steel_black', 'steel', {
    z0: zPlunge,
    z1: zTip,
    ySpine: 0.012,
    yEdge: -0.019,
    yTip: -0.0035,
    thickness: 0.0049,
    thicknessTip: 0.0027,
  });

  const guard = addKnifeGuard(body, 'steel', { zFront: zPlunge, zRear: -0.0075 });
  const handle = addKnifeHandle(body, 'polymer', 'rubber', 'steel', {
    z0: -0.0075,
    z1: 0.0925,
  });

  return {
    id: 'knife',
    label: 'KM-7',
    fxClass: 'melee',
    /**
     * PER-MATERIAL WEAR AMPLITUDE. See Viewmodel.addWeapon: a lofted blade has
     * no interior vertices, so the convexity bake finds the whole surface
     * convex and the wear layer paints the entire flat as polished-through
     * metal. Measured on the first capture: the blade read as white paper
     * against a correctly-dark pistol slide built from the same material.
     * 0.2 on the flats and 0.28 on the ground bevel leaves the wear where the
     * geometry actually puts it — the spine, the swedge and the edge — and the
     * grime and AO layers are untouched.
     */
    wearScale: { steel_black: 0.2, steel: 0.28 },
    body,
    moving: {},
    nodes: {
      /**
       * The blade tip, and the point the melee trace is cast from. `muzzle` is
       * the name the rig already uses for "the business end in weapon space",
       * so the knife reuses it rather than inventing a parallel node the
       * viewmodel would have to special-case.
       */
      muzzle: blade.tip,
      edgeMid: blade.edgeMid,
      /**
       * THE HANDLE, AS A CYLINDER — and its absence is why the knife hand was a
       * fan of open fingers beside the grip instead of a fist around it.
       *
       * `Viewmodel._fitShootingHand` is the per-fingertip solve that closes a
       * hand on a round thing, and its first line is
       * `if (!cyl || !gR) return;`. `gripR` was authored here; `gripCylinder`
       * was not, so the whole solve returned immediately and the knife fell
       * back to the raw `grip` pose — which is authored for a PISTOL grip. That
       * pose's own comment says it closes ~170 deg on a 34 mm section, and a
       * knife handle is 21 x 27 mm, so nothing ever met the handle.
       *
       * Taken straight from the geometry at the top of this file: the handle
       * runs along Z at y = 0 from z = +0.093 to z = -0.008, and its section is
       * 21 x 27 mm, so a 12.5 mm radius is the round approximation the solve
       * wants. `axis` is a POINT on the axis (the handle's midpoint), `dir` is
       * the axis direction — the same shape `handguard` has on the carbines.
       */
      gripCylinder: {
        axis: [0, 0, 0.0425],
        dir: [0, 0, 1],
        r: 0.0125,
        z0: 0.093,
        z1: -0.008,
      },
      /**
       * SHOOTING HAND — a hammer grip, solved the same way the guns' are: the
       * targets the rig consumes are WRISTS, derived as
       * `knuckleContact - 0.098 * fingerDir` (see models/rifle.js).
       *
       * SOLVED FROM THE CURL AXIS. This is the one constraint that decides
       * whether a hammer grip works at all, and getting it wrong is not subtle:
       *
       *   The finger joints in hands.js rotate about the hand's local X, and
       *   hand X = back x (-finger). So the plane the fingers close in is fixed
       *   entirely by these two vectors, and for a hand to WRAP something the
       *   curl axis has to lie along that thing.
       *
       * Aiming `finger` down the handle (which is where "the metacarpals run
       * along the handle" leads) puts the curl axis PERPENDICULAR to it, and
       * the fingers then flex in the plane that contains the handle: they fold
       * forward over the guard and the blade instead of closing round the
       * grip. Measured on the first build — the fist covered the blade
       * outright.
       *
       * A hammer grip actually lays the handle DIAGONALLY across the palm, so:
       *   finger = (0.341, -0.7822, -0.5215)   58 deg off the handle axis
       *   back   = (0.9167, 0.3996, 0)         chosen as the Y that makes
       *            hand X = (.., .., 0.853) — i.e. the curl axis 32 deg off
       *            the handle, which is as close as an anatomically possible
       *            metacarpal direction gets
       *
       * Contact: the palm normal is -back, so the hand presses the handle from
       * the (+0.917, +0.400) side. The 10.5 x 13.6 mm ellipse's radius in that
       * direction is 1 / hypot(0.917/0.0105, 0.400/0.0136) = 10.9 mm, and the
       * knuckle line is set 8.9 mm out — 2 mm INSIDE the surface, the same
       * interpenetration a glove squeezing a handguard has on the rifle. With
       * the knuckle line at z = +0.006, just behind the guard collar:
       *   contact = (0.0082, 0.0036, 0.006)
       *   pos     = contact - 0.098 * finger = (-0.0253, 0.0802, 0.0651)
       * The distal joints are then fitted per fingertip against the handle
       * cylinder at build time; see Viewmodel._fitShootingHand.
       */
      /**
       * SEARCHED, not derived — see tools/gripfit.mjs.
       *
       * Adding `gripCylinder` made the solve RUN, and the hand still
       * photographed fanned open; hiding the left arm proved the open hand was
       * this one. The measurement said why: all four fingertips were 12.8, 17.6,
       * 17.9 and 5.3 mm off a 25 mm handle. Not a curl problem at all — the hand
       * was never near the handle, so no amount of flexion could ever have
       * closed it, and every previous attempt to fix this by tuning curl was
       * aimed at the wrong thing.
       *
       * Coordinate descent on the real solve brings all four to
       * [0.4, 0.5, 0.4, 0.2] mm.
       */
      gripR: {
        pos: [-0.0028, 0.1002, 0.0651],
        finger: [0.464, -0.8415, 0.2767],
        back: [0.9167, 0.3996, 0],
      },
      /**
       * SUPPORT HAND — off the weapon entirely.
       *
       * A knife is a one-handed weapon. The support hand is carried low and
       * outboard in a guard position rather than welded to the handle, so the
       * target is a free-space point and the pose stays `open`. Putting it on
       * the handle is what makes a knife viewmodel read as a two-handed rifle
       * with the barrel removed.
       *
       * SOLVED BACKWARD from where it has to land on screen. At the hip pose
       * (defs.js) this weapon-space point maps to camera (-0.235, -0.255,
       * -0.300), which is (227, 1335) at 1920x1080 — 255 px off the bottom-left
       * corner, so the hand is out of frame but its forearm still enters from
       * the lower left, which is what sells a knife-fighter's stance. Reach
       * from the support shoulder is 53% of a 611 mm arm: nowhere near the
       * clamp. Directions are the inverse-rotated camera-space
       * finger (-0.15, 0.05, -0.987) and dorsum (0.42, 0.90, -0.12).
       */
      gripL: {
        pos: [-0.1716, -0.3753, -0.1182],
        finger: [0.7735, -0.3574, -0.5234],
        back: [0.328, 0.8906, -0.3152],
      },
      /** Relaxed, not clamped: there is nothing under this hand to close on. */
      lhandPose: 'open',
      /**
       * Hammer grip, authored rather than fitted — see HAND_POSES.hammer. The
       * default 'grip' is a PISTOL grip and leaves the fingers open on a 25 mm
       * knife handle.
       */
      rhandPose: 'hammer',
      /**
       * The handle's collision profile, for the build-time fingertip solve
       * (Arm.fitToCylinder). The handle is an ELLIPSE, 10.5 x 13.6 mm, and the
       * solver takes a cylinder — so this is the mean radius and the fingertips
       * land within +/-1.5 mm of the real surface rather than exactly on it.
       * That is inside the 2 mm of interpenetration the grip already carries,
       * so no fingertip ends up standing off in daylight; the error only shows
       * as slightly more or less squeeze around the clock.
       */
      gripCylinder: {
        axis: [0, 0, 0],
        dir: [0, 0, 1],
        r: 0.0121,
        z0: handle.z0,
        z1: handle.z1,
      },
      guard,
    },
  };
}
