import { Assembly, box, blob, extrude, roundRect, latheZ, rodZ, tubeZ, mergeAll } from '../geometry.js';
import {
  addRail,
  addPistolGrip,
  addScrew,
  addPin,
  buildMagazine,
  buildSlide,
  triggerPart,
} from '../parts.js';

/**
 * The machine pistol — a blowback 9 mm select-fire pocket hose: a squared-off
 * slide with cocking wings, a two-port compensator hanging off the muzzle, a
 * 24-round extended stick standing proud of the grip, and plain irons.
 *
 * 「ハンドガンも種類増やして」 — this is the fast one, the opposite pole from
 * the RX-44: 1050 rpm of 13-damage rounds through a grip you can barely hold
 * on to. Visually it must NOT read as the P-19: no reflex optic, a longer
 * blockier slide, the comp, and the stick magazine are the four tells.
 *
 * Layout mirrors the P-19 (origin at the web of the hand, bore y = +0.036).
 */
export function buildMpistol() {
  const bore = 0.036;
  const slideH = 0.0262;
  const slideW = 0.0272;
  const slideLen = 0.196;
  const zSlideRear = 0.054;
  const zSlideFront = zSlideRear - slideLen;
  const gripAngle = 0.3;
  const compLen = 0.03;

  const body = new Assembly('mpistol-frame');

  /* ---- frame ------------------------------------------------------------- */
  const dust = extrude(
    [
      [-slideW * 0.5 + 0.001, 0],
      [slideW * 0.5 - 0.001, 0],
      [slideW * 0.5 - 0.001, -0.014],
      [slideW * 0.5 - 0.004, -0.0175],
      [-slideW * 0.5 + 0.004, -0.0175],
      [-slideW * 0.5 + 0.001, -0.014],
    ],
    0.112,
    { bevel: 0.001 }
  );
  body.add(dust, 'polymer', { y: bore - 0.0075, z: -0.064 });
  dust.dispose();
  const frameCore = blob(slideW - 0.001, 0.052, 0.064, 0.004, 3);
  body.add(frameCore, 'polymer', { y: bore - 0.033, z: 0.012 });
  frameCore.dispose();
  const tang = extrude(
    [
      [-0.008, 0],
      [0.032, -0.004],
      [0.034, -0.013],
      [-0.008, -0.015],
    ],
    slideW - 0.003,
    { bevel: 0.0012 }
  );
  body.add(tang, 'polymer', { y: bore - 0.014, z: 0.036, ry: Math.PI / 2 });
  tang.dispose();
  addRail(body, 'polymer', -0.114, -0.06, bore - 0.019, 0, {
    width: 0.0175,
    waist: 0.013,
    baseH: 0.0026,
    topH: 0.0024,
    pitch: 0.0092,
    slot: 0.0046,
  });

  // Squared trigger guard with a hooked front face for the support finger.
  const guardOuter = [
    [-0.024, 0],
    [0.028, 0],
    [0.03, -0.008],
    [0.028, -0.024],
    [0.02, -0.028],
    [-0.016, -0.028],
    [-0.024, -0.022],
  ];
  const guardInner = [
    [-0.019, -0.003],
    [0.023, -0.003],
    [0.0245, -0.01],
    [0.023, -0.0215],
    [0.016, -0.0245],
    [-0.013, -0.0245],
    [-0.019, -0.019],
  ];
  const guard = extrude(guardOuter, slideW - 0.004, { bevel: 0.001, holes: [guardInner] });
  body.add(guard, 'polymer', { y: bore - 0.0255, z: -0.031 });
  guard.dispose();

  /* ---- grip + fire selector ---------------------------------------------- */
  addPistolGrip(body, 'polymer', 'rubber', {
    y: bore - 0.014,
    z: 0.017,
    angle: gripAngle,
    len: 0.118,
    w: 0.0305,
  });
  // Selector lever on the left flank — the one control the P-19 does not have.
  const sel = extrude(
    [
      [-0.003, -0.002],
      [0.012, -0.003],
      [0.014, 0.002],
      [-0.003, 0.003],
    ],
    0.0034,
    { bevel: 0.0005 }
  );
  body.add(sel, 'steel', { x: -0.0155, y: bore - 0.012, z: 0.008, ry: Math.PI / 2, rz: 0.4 });
  sel.dispose();
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
  body.add(relButton, 'polymer', { x: 0.0138, y: bore - 0.033, z: -0.013, ry: Math.PI / 2 });
  relButton.dispose();

  /* ---- barrel + compensator ---------------------------------------------- */
  const barrel = latheZ(
    [
      [0, 0],
      [0, 0.0084],
      [0.0016, 0.009],
      [0.008, 0.009],
      [0.0095, 0.0078],
      [0.0095, 0.005],
    ],
    18
  );
  body.add(barrel, 'steel_bright', { y: bore, z: zSlideFront + 0.0012, ry: Math.PI });
  barrel.dispose();
  /** Two-port compensator: a squared block past the slide with top vents. */
  const comp = box(slideW - 0.002, slideH - 0.002, compLen, 0.0016, 2);
  body.add(comp, 'steel_enamel', { y: bore + 0.0042, z: zSlideFront - compLen / 2 + 0.002 });
  comp.dispose();
  for (let i = 0; i < 2; i++) {
    const port = box(0.012, 0.004, 0.0095, 0.0006, 1);
    body.add(port, 'cavity', { y: bore + 0.0155, z: zSlideFront - 0.007 - i * 0.013 });
    port.dispose();
  }
  const boreHole = tubeZ(0.0048, 0.0034, 0.024, 12, 0.0002);
  body.add(boreHole, 'cavity', { y: bore, z: zSlideFront - compLen + 0.01 });
  boreHole.dispose();

  /* ---- moving parts ------------------------------------------------------- */
  const slideAsm = new Assembly('mpistol-slide');
  /** Plain irons on the slide — no reflex. `sightTop` is the sight line. */
  const sightTop = slideH * 0.5 + 0.0062;
  const slide = buildSlide(slideAsm, {
    w: slideW,
    h: slideH,
    len: slideLen,
    mat: 'steel_enamel',
    zRear: zSlideRear,
    sightTop,
  });
  // Cocking wings at the rear of the slide — the machine-pistol tell.
  for (const sx of [-1, 1]) {
    const wing = blob(0.0052, 0.012, 0.018, 0.0015, 2);
    slideAsm.add(wing, 'steel_enamel', { x: sx * (slideW / 2 + 0.0022), y: 0.004, z: zSlideRear - 0.014 });
    wing.dispose();
  }

  const magazine = new Assembly('mpistol-mag');
  const mag = buildMagazine(magazine, null, {
    w: 0.0212,
    d: 0.0295,
    len: 0.164,
    curve: 0.005,
    segs: 6,
    witness: 5,
    caseLen: 0.0192,
    rimR: 0.00478,
    bulletLen: 0.0132,
    poly: 'polymer',
  });
  // Rubber basepad on the stick.
  const pad = box(0.0235, 0.008, 0.033, 0.0012, 1);
  pad.translate(0, -0.164, 0.004);
  magazine.add(pad, 'rubber', {});
  pad.dispose();

  const trigger = new Assembly('mpistol-trigger');
  const trg = triggerPart('polymer');
  trigger.add(trg.geo, 'polymer', {});
  trg.geo.dispose();

  const opticY = bore + sightTop;

  return {
    id: 'mpistol',
    label: 'VZ-93',
    fxClass: 'pistol',
    body,
    moving: { magazine, trigger, slide: slideAsm },
    nodes: {
      muzzle: [0, bore, zSlideFront - compLen - 0.002],
      chamber: [0, bore, zSlideRear - 0.052],
      eject: [slideW * 0.5 + 0.004, bore + 0.005, zSlideRear - 0.052],
      ejectDir: [0.82, 0.55, 0.22],
      /** The REAR NOTCH is the sight the ADS solve aligns — irons only. */
      sight: [0, opticY, zSlideRear - 0.012],
      sightAxis: [0, 0, -1],
      ironSight: [0, opticY, zSlideRear - 0.012],
      sightRadius: (zSlideRear - 0.012) - (zSlideFront + 0.014),
      gripCylinder: {
        axis: [0, bore - 0.014, 0.017],
        dir: [0, -Math.cos(gripAngle), Math.sin(gripAngle)],
        r: 0.0168,
        z0: 0.017,
        z1: 0.017 + 0.118 * Math.sin(gripAngle),
      },
      /**
       * SEARCHED — tools/gripfit.mjs, seeded from the P-19's own searched
       * solve (same grip section, 2 deg less rake) and then re-run against
       * THIS weapon's geometry, because a seed is not a measurement.
       *
       *   before  gaps [0.8 0.1 0.1 0.0] mm  wrist 41.4 deg  pen 4.7 mm
       *   after   gaps [0.8 0.4 0.2 0.5] mm  wrist 27.4 deg  pen 0.0 mm
       *
       * The 4.7 mm of burial was the slide passing through the web of the
       * hand — a longer slide than the P-19's, seated 3 mm lower. Extension
       * 0.385, so the elbow keeps a deep bend.
       */
      gripR: {
        pos: [-0.0295, -0.113, 0.1035],
        finger: [-0.0424, 0.6079, -0.7929],
        back: [-0.9545, -0.034, -0.2961],
      },
      /** SEARCHED against `supportCylinder` below: gaps [0.3 0.3 0.5 0.5] mm
       *  (worst 0.7 -> 0.5), wrist 39.8 deg, penetration 0.0 mm, ext 0.666. */
      gripL: {
        pos: [0.0028, -0.0269, 0.1024],
        finger: [0.3989, 0.442, -0.8034],
        back: [0.9207, 0.309, -0.2386],
      },
      lhandPose: 'cup',
      supportCylinder: {
        axis: [0, bore - 0.0615, 0.0328],
        dir: [0, -Math.cos(gripAngle), Math.sin(gripAngle)],
        r: 0.03,
        z0: 0.061,
        z1: -0.009,
      },
      magSeat: { pos: [0, bore - 0.03, 0.02], rot: [-gripAngle, 0, 0] },
      magDrop: [0, -0.42, 0.05],
      slideRest: { pos: [0, bore, 0], rot: [0, 0, 0] },
      slideTravel: [0, 0, 0.0235],
      triggerPivot: { pos: [0, bore - 0.0135, -0.0175], rot: [0, 0, 0] },
      triggerPull: -0.3,
      slideGeom: slide,
    },
    shell: { caseLen: 0.0192, rimR: 0.00478 },
    magSize: { len: mag.len, w: mag.w, d: mag.d },
  };
}
