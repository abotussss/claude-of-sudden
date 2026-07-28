import { Assembly, box, blob, extrude, roundRect, latheZ, rodZ, tubeZ, dome, ring, mergeAll } from '../geometry.js';
import {
  addRail,
  addPistolGrip,
  addScrew,
  addPin,
  buildMagazine,
  buildMiniReflex,
  buildSlide,
  triggerPart,
  cartridge,
} from '../parts.js';

/**
 * The sidearm — a striker-fired polymer-framed 9 mm, slide-mounted mini reflex.
 *
 * A pistol is where proportion errors are most obvious, so the numbers are the
 * real ones: 183 mm slide, 26 mm across, bore 36 mm over the web of the hand,
 * 18-degree grip rake, 22 mm of slide travel.
 */
export function buildPistol() {
  const bore = 0.036;
  const slideH = 0.0248;
  const slideW = 0.0262;
  const slideLen = 0.183;
  const zSlideRear = 0.052;
  const zSlideFront = zSlideRear - slideLen;
  const gripAngle = 0.32;

  const body = new Assembly('pistol-frame');

  /* ---- frame ---------------------------------------------------------- */
  // Dust cover / frame rails under the slide.
  const dust = extrude(
    [
      [-slideW * 0.5 + 0.001, 0],
      [slideW * 0.5 - 0.001, 0],
      [slideW * 0.5 - 0.001, -0.0125],
      [slideW * 0.5 - 0.004, -0.016],
      [-slideW * 0.5 + 0.004, -0.016],
      [-slideW * 0.5 + 0.001, -0.0125],
    ],
    0.108,
    { bevel: 0.001 }
  );
  body.add(dust, 'polymer', { y: bore - 0.0075, z: -0.062 });
  dust.dispose();

  // Frame body around the trigger and the magwell.
  const frameCore = blob(slideW - 0.001, 0.05, 0.062, 0.004, 3);
  body.add(frameCore, 'polymer', { y: bore - 0.032, z: 0.012 });
  frameCore.dispose();

  // Beavertail / tang.
  const tang = extrude(
    [
      [-0.008, 0],
      [0.03, -0.004],
      [0.032, -0.012],
      [-0.008, -0.014],
    ],
    slideW - 0.003,
    { bevel: 0.0012 }
  );
  body.add(tang, 'polymer', { y: bore - 0.014, z: 0.034, ry: Math.PI / 2 });
  tang.dispose();

  // Accessory rail under the dust cover.
  addRail(body, 'polymer', -0.112, -0.058, bore - 0.0175, 0, {
    width: 0.0175,
    waist: 0.013,
    baseH: 0.0026,
    topH: 0.0024,
    pitch: 0.0092,
    slot: 0.0046,
  });

  // Trigger guard: undercut, with a slight index ledge.
  const guardOuter = [
    [-0.024, 0],
    [0.026, 0],
    [0.028, -0.007],
    [0.024, -0.022],
    [0.013, -0.027],
    [-0.016, -0.027],
    [-0.024, -0.021],
  ];
  const guardInner = [
    [-0.019, -0.003],
    [0.021, -0.003],
    [0.0225, -0.009],
    [0.0185, -0.0205],
    [0.01, -0.0235],
    [-0.013, -0.0235],
    [-0.019, -0.0185],
  ];
  const guard = extrude(guardOuter, slideW - 0.004, { bevel: 0.001, holes: [guardInner] });
  body.add(guard, 'polymer', { y: bore - 0.0245, z: -0.03 });
  guard.dispose();

  /* ---- grip ----------------------------------------------------------- */
  addPistolGrip(body, 'polymer', 'rubber', {
    y: bore - 0.014,
    z: 0.016,
    angle: gripAngle,
    len: 0.113,
    w: 0.0305,
  });
  // Stippling: a field of tiny raised pyramids on both side panels.
  const stipple = [];
  for (let r = 0; r < 9; r++) {
    for (let cIdx = 0; cIdx < 5; cIdx++) {
      const g = box(0.0024, 0.0024, 0.0009, 0.0003, 1);
      g.translate(-0.005 + cIdx * 0.0026 + (r % 2) * 0.0013, -0.012 - r * 0.0072, 0);
      stipple.push(g);
    }
  }
  const stippleG = mergeAll(stipple);
  for (const sx of [-1, 1]) {
    body.add(stippleG, 'polymer', {
      x: sx * 0.0152,
      y: bore - 0.016,
      z: 0.017,
      ry: sx * Math.PI * 0.5,
      rx: 0,
      rz: sx > 0 ? -gripAngle : gripAngle,
    });
  }
  stippleG.dispose();

  // Magazine release, slide stop lever, takedown lever.
  const relButton = latheZ(
    [
      [0, 0],
      [0, 0.0042],
      [0.0015, 0.0048],
      [0.0038, 0.0048],
      [0.0038, 0],
    ],
    12
  );
  body.add(relButton, 'polymer', { x: 0.0138, y: bore - 0.032, z: -0.014, ry: Math.PI / 2 });
  relButton.dispose();
  const stopLever = extrude(
    [
      [-0.014, -0.0028],
      [0.012, -0.0035],
      [0.014, 0.0028],
      [-0.014, 0.0035],
    ],
    0.0032,
    { bevel: 0.0005 }
  );
  body.add(stopLever, 'steel', { x: -0.0132, y: bore - 0.0135, z: -0.022, ry: Math.PI / 2 });
  body.add(stopLever, 'steel', { x: 0.0132, y: bore - 0.0135, z: -0.022, ry: Math.PI / 2 });
  stopLever.dispose();
  const takedown = latheZ(
    [
      [0, 0],
      [0, 0.0035],
      [0.0022, 0.004],
      [0.0022, 0],
    ],
    12
  );
  body.add(takedown, 'steel', { x: -0.0138, y: bore - 0.0175, z: -0.046, ry: -Math.PI / 2 });
  takedown.dispose();

  /* ---- barrel, exposed at the muzzle, plus the recoil spring ---------- */
  const barrel = latheZ(
    [
      [0, 0],
      [0, 0.0082],
      [0.0016, 0.0088],
      [0.006, 0.0088],
      [0.0072, 0.0078],
      [0.0072, 0.0048],
    ],
    18
  );
  body.add(barrel, 'steel_bright', { y: bore, z: zSlideFront + 0.0012, ry: Math.PI });
  barrel.dispose();
  const boreHole = tubeZ(0.0048, 0.0034, 0.03, 12, 0.0002);
  body.add(boreHole, 'cavity', { y: bore, z: zSlideFront + 0.012 });
  boreHole.dispose();
  const spring = latheZ(
    [
      [0, 0.0032],
      [0, 0.0048],
      [0.004, 0.0048],
      [0.004, 0.0032],
    ],
    12
  );
  body.add(spring, 'steel_bright', { y: bore - 0.0125, z: zSlideFront + 0.0025 });
  spring.dispose();

  /* ---- moving parts --------------------------------------------------- */
  const slideAsm = new Assembly('pistol-slide');
  // Optic geometry first, because the IRONS ARE BUILT TO ITS CENTRE HEIGHT.
  // A slide-mounted reflex and standard-height sights cannot both be used; the
  // irons have to clear the window, which is what "suppressor height" means.
  // Everything here is in SLIDE space (bore at y=0); the slide's rest node adds
  // `bore` back to get weapon space.
  const reflexH = 0.021;
  const reflexLen = 0.0455;
  const reflexBase = slideH * 0.5 + 0.0018;
  const reflexZ = zSlideRear - 0.038;
  /** Optic centre, slide space — and therefore the iron sight line as well. */
  const sightTop = reflexBase + reflexH * 0.56;
  const slide = buildSlide(slideAsm, {
    w: slideW,
    h: slideH,
    len: slideLen,
    // Nitrided, not bare steel: a slide is one big flat facing the sky.
    mat: 'steel_black',
    zRear: zSlideRear,
    sightTop,
  });
  // Slide-mounted mini reflex, in a milled pocket behind the rear sight.
  const reflex = buildMiniReflex(slideAsm, {
    w: 0.0246,
    h: reflexH,
    len: reflexLen,
    y: reflexBase,
    z: reflexZ,
    matBody: 'alu_fine',
  });
  const opticY = bore + sightTop;
  const opticZ = reflexZ + reflexLen * 0.14;

  const magazine = new Assembly('pistol-mag');
  const mag = buildMagazine(magazine, null, {
    w: 0.0212,
    d: 0.0295,
    len: 0.108,
    curve: 0.004,
    segs: 5,
    witness: 3,
    caseLen: 0.0192,
    rimR: 0.00478,
    bulletLen: 0.0132,
    poly: 'polymer',
  });

  const trigger = new Assembly('pistol-trigger');
  const trg = triggerPart('polymer');
  trigger.add(trg.geo, 'polymer', {});
  trg.geo.dispose();
  // The trigger safety blade down the middle of the face.
  const blade = extrude(
    [
      [-0.0022, 0.003],
      [0.0022, 0.003],
      [0.0022, -0.016],
      [-0.0022, -0.017],
    ],
    0.0028,
    { bevel: 0.0004 }
  );
  trigger.add(blade, 'steel', { x: 0, y: -0.001, z: 0.0022 });
  blade.dispose();

  return {
    id: 'pistol',
    label: 'P-19',
    fxClass: 'pistol',
    body,
    moving: { magazine, trigger, slide: slideAsm },
    nodes: {
      muzzle: [0, bore, zSlideFront - 0.004],
      chamber: [0, bore, zSlideRear - 0.05],
      eject: [slideW * 0.5 + 0.004, bore + 0.005, zSlideRear - 0.05],
      ejectDir: [0.82, 0.52, 0.24],
      sight: [0, opticY, opticZ],
      sightAxis: [0, 0, -1],
      /**
       * The rear notch, at the SAME height as the optic centre and the front
       * post — an absolute co-witness. Because the ADS solve puts `sight` on
       * the camera axis with an identity-ish rotation, and all three landmarks
       * now share y = bore + 0.02596, the notch shoulders, the post top and the
       * dot project to the same pixel at the crosshair. See defs.js.
       */
      ironSight: [0, bore + sightTop, zSlideRear - 0.012],
      /** Rear notch to front post: the sight radius the picture is scaled by. */
      sightRadius: (zSlideRear - 0.012) - (zSlideFront + 0.014),
      // Wrist targets (see models/rifle.js for the derivation).
      /**
       * THE PISTOL GRIP AS A CYLINDER, so the fingertip contact solve actually
       * runs on the SHOOTING hand.
       *
       * `Viewmodel._fitShootingHand` bails at `if (!cyl || !gR) return;`, and
       * until now the knife was the only model that declared one. So on every
       * firearm the right hand was never solved at all: it wore the static
       * `HAND_POSES.grip` curls whatever the geometry underneath them happened
       * to be, which is why the hand read as bent at an angle that belongs to no
       * grip in particular.
       *
       * Derived from the arguments passed to `addPistolGrip` above rather than
       * typed in, so it cannot drift out of sync with the mesh:
       *   axis  the top of the grip centreline, at (oy, oz)
       *   dir   straight down the grip, raked rearward by `angle` — the part
       *         rotates by `rx: -angle`, so down maps to (0, -cos, +sin)
       *   r     half the front-strap-to-back-strap depth of the extruded
       *         profile, plus the rubber over-mould the fingers actually touch
       *   z0/z1 the Z span the grip occupies, which is what filters the baked
       *         contact points
       */
      gripCylinder: {
        axis: [0, bore - 0.014, 0.016],
        dir: [0, -Math.cos(gripAngle), Math.sin(gripAngle)],
        r: 0.0168,
        z0: 0.016,
        z1: 0.016 + 0.113 * Math.sin(gripAngle),
      },
      /**
       * SEARCHED with a WRIST CONSTRAINT — see tools/gripfit.mjs.
       *
       * The previous values closed every fingertip on the grip and the hand
       * still looked wrong, because contact says nothing about how the hand
       * meets the ARM. Measured: this wrist sat at 87.1 degrees. A human
       * wrist manages about 70 of flexion and 60 of extension at the very
       * extreme and a firing grip lives around 15-35, so that was not a grip,
       * it was a fracture — and it is what "意味のわからない手首の曲がり方"
       * describes.
       *
       * Now 43.8 degrees, with every fingertip still within 0.7 mm AND on
       * the grip's authored Z span. That last clause matters: the solve's own
       * `gapAt` measures perpendicular distance to an INFINITE cylinder, so the
       * first wrist-aware search "fixed" the wrist by sliding the hand off the
       * bottom of the grip into the air under the magwell — all four fingers
       * reported in contact and the captured frame had no hand on the weapon at
       * all. The span is part of the score now.
       */
      /**
       * SEARCHED with a PENETRATION constraint — see tools/gripfit.mjs.
       *
       * Reported as "なんで武器に手が貫通してる", and measured: 72.6 mm of
       * total joint burial inside this weapon's own meshes. The contact solve
       * models exactly ONE cylinder, the grip, and knows nothing about the
       * slide, the frame, the receiver or the magwell — so every search before
       * this one was free to satisfy "fingertips on the grip" with a hand the
       * weapon passes straight through, and on the pistol it visibly did.
       *
       * Now 4.7 mm, which is the normal amount for a hand wrapped round a
       * grip with a finger inside the trigger guard, at 39.8 degrees of
       * wrist and every fingertip within 0.8 mm.
       *
       * Demanding ZERO was tried and is wrong: it drove the carbine's wrist from
       * 40 to 82 degrees and pushed a finger off the grip entirely, because a
       * real grip legitimately puts joints inside the trigger guard's box. The
       * budget is 20 mm of total burial across fifteen joints.
       */
      gripR: {
        pos: [-0.0295, -0.093, 0.1025],
        finger: [-0.068, 0.3328, -0.9405],
        back: [-0.9145, -0.2126, -0.3443],
      },
      /**
       * SUPPORT HAND — cups the firing hand, and now actually CLOSES on it.
       *
       * MEASURED against `supportCylinder` below (the grip plus the firing
       * hand's own fingers wrapped round it, a 60 mm column on the grip axis).
       * The old target put the support knuckle line
       *   contact = pos + 0.098 * finger = (0.0033, -0.0394, -0.0122)
       * which is 46.3 mm from that column's axis — 16 mm of daylight outside a
       * 30 mm radius, with nothing for the fingers to close on, which is the
       * whole of "the support hand floats near the slide". The target is moved
       * 16.3 mm straight down the perpendicular so the contact lands 30 mm out,
       * i.e. 2 mm inside the surface, and the per-fingertip solve then runs
       * against it exactly as it does on the carbines. That is 1 mm in x, 5 mm
       * in y and 15 mm in z from the old pose — the hand does not move
       * anywhere the camera can notice, it just arrives at something solid.
       */
      /**
       * SEARCHED, wrist- reach- and span-constrained — see tools/gripfit.mjs.
       *
       * The fingertips were already on the handguard (0.1-0.4 mm) and the hand
       * still looked wrong, because the WRIST was at 80.1 degrees. A human
       * wrist manages ~70 of flexion at the extreme; a support grip lives around
       * 15-35. Now 39.7 degrees, fingertips within 0.7 mm, still on the
       * handguard's authored span, and arm extension 0.619 -> 0.675 so the
       * two-bone solve keeps a visible elbow bend.
       *
       * That last number is not decoration. The first wrist-aware search
       * straightened this wrist by walking the hand 0.33 m down the barrel, to
       * 1.011 extension — past the end of the arm — where `Arm.solve` clamps,
       * the elbow locks dead straight and the limb reads as a broomstick. That
       * is the failure this file already documents twice. Caught by capturing
       * the frame, not by any of the contact numbers, which were perfect.
       */
      gripL: {
        pos: [0.0038, -0.0269, 0.0964],
        finger: [0.3989, 0.442, -0.8034],
        back: [0.9127, 0.3412, -0.2248],
      },
      /**
       * What the support hand closes on: not the frame — the firing hand.
       *
       * A two-handed pistol grip has the support fingers wrapped over the
       * FIRING hand's fingers, so the cylinder is the grip (30.5 mm wide) plus
       * a wrapped finger diameter either side: a 60 mm column on the grip's own
       * raked axis. `dir` is the grip rake, (0, -cos 0.32, sin 0.32).
       */
      supportCylinder: {
        axis: [0, bore - 0.0615, 0.0318],
        dir: [0, -0.949, 0.315],
        r: 0.03,
        z0: 0.06,
        z1: -0.01,
      },
      magSeat: { pos: [0, bore - 0.03, 0.019], rot: [-gripAngle, 0, 0] },
      magDrop: [0, -0.42, 0.05],
      slideRest: { pos: [0, bore, 0], rot: [0, 0, 0] },
      slideTravel: [0, 0, 0.0225],
      triggerPivot: { pos: [0, bore - 0.0135, -0.0165], rot: [0, 0, 0] },
      triggerPull: -0.3,
      opticGlass: reflex,
      slideGeom: slide,
    },
    shell: { caseLen: 0.0192, rimR: 0.00478 },
    magSize: { len: mag.len, w: mag.w, d: mag.d },
  };
}
