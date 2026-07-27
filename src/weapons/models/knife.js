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
  const blade = addKnifeBlade(body, 'steel_black', 'steel_bright', {
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
       * SHOOTING HAND — a hammer grip, solved the same way the guns' are: the
       * targets the rig consumes are WRISTS, derived as
       * `knuckleContact - 0.098 * fingerDir` (see models/rifle.js).
       *
       * The handle is a 21 x 27 mm oval on the Z axis. On a hammer grip the
       * METACARPALS RUN ALONG THE HANDLE and the fingers wrap it transversely —
       * exactly as they do on a pistol grip, where the rifle's finger direction
       * is parallel to the front strap and not perpendicular to it. So:
       *   finger = (0.05, -0.02, -0.998)   wrist at the pommel, knuckles at the
       *            guard, 3 deg of inboard cant
       *   back   = (0.622, 0.783, 0)       the dorsum up and outboard at 51 deg,
       *            which is where the back of a right hand actually points with
       *            a blade held forward
       *
       * Contact: the palm normal is -back, so the hand presses the handle from
       * the (+0.622, +0.783) side. The ellipse's radius in that direction is
       *   1 / hypot(0.622/0.0105, 0.783/0.0136) = 12.1 mm
       * and the knuckle line is set 10.1 mm out, i.e. 2 mm INSIDE the surface —
       * a glove squeezing a handle interpenetrates it, the same 1.5-9 mm the
       * rifle's support hand does on the handguard. With the knuckle line at
       * z = +0.006 (immediately behind the guard collar):
       *   contact = (0.0063, 0.0079, 0.006)
       *   pos     = contact - 0.098 * finger = (0.0014, 0.0099, 0.1038)
       * which puts the wrist 104 mm back, level with the pommel — where a
       * hammer grip's wrist is.
       */
      gripR: {
        pos: [0.0014, 0.0099, 0.1038],
        finger: [0.05, -0.02, -0.998],
        back: [0.622, 0.783, 0],
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
       * (defs.js) this weapon-space point maps to camera (-0.240, -0.260,
       * -0.300), which is (212, 1351) at 1920x1080 — 270 px off the bottom-left
       * corner, so the hand is out of frame but its forearm still enters from
       * the lower left, which is what sells a knife-fighter's stance. Reach
       * from the support shoulder is 53% of a 611 mm arm: nowhere near the
       * clamp. Directions are the inverse-rotated camera-space
       * finger (-0.15, 0.05, -0.987) and dorsum (0.42, 0.90, -0.12).
       */
      gripL: {
        pos: [-0.2375, -0.3348, 0.0606],
        finger: [0.358, -0.3175, -0.8781],
        back: [-0.0342, 0.892, -0.4508],
      },
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
