import { Assembly, box, blob, extrude, roundRect, latheZ, rodZ, tubeZ, dome, mergeAll } from '../geometry.js';
import {
  addBarrel,
  addGasBlock,
  addMuzzleDevice,
  addHandguard,
  addRail,
  addPistolGrip,
  addCarbineStock,
  addFrontSight,
  addRearSight,
  addQdSocket,
  addSlingLoop,
  addPin,
  addScrew,
  buildOptic,
  triggerPart,
  cartridge,
} from '../parts.js';

/**
 * The light machine gun — a belt-fed 5.56 SAW in the MK46 idiom: a deep boxy
 * receiver with a top-hinged feed tray cover, a heavy quick-change barrel with
 * its gas system UNDER the bore, a soft 100-round belt pouch hanging from the
 * feed port, a folded bipod under the handguard and a tube red dot on the
 * cover rail.
 *
 * Requested as 「ライトマシンガン追加して つまりLMGなので重厚な球数の多い、
 * でも足がすごく遅くなるやつ」 — heavy, deep magazine, slow on your feet. The
 * SILHOUETTE has to carry "heavy": everything here is wider, deeper and longer
 * than the carbine — a 34 mm-wide receiver against the M4's 24, a barrel
 * profile half again the M4's, and the pouch, which no other weapon has.
 *
 * Layout (weapon-local metres, origin at the shooting hand's thumb web):
 *   bore axis        y = +0.075
 *   cover rail       y = +0.106
 *   receiver         z = +0.070 .. -0.175
 *   handguard        z = -0.180 .. -0.395
 *   muzzle crown     z = -0.585
 *   butt pad         z = +0.255
 */
export function buildLmg() {
  const bore = 0.075;
  const recW = 0.034; // half-widths below are recW/…, this is the full width
  const railTop = bore + 0.031;
  const zRecRear = 0.07;
  const zRecFront = -0.175;
  const portZ = -0.03;
  /** The feed port the pouch hangs from — forward of the grip, under the tray. */
  const magZ = -0.075;
  const hgZ0 = -0.18;
  const hgZ1 = -0.395;
  const hgR = 0.0245;
  const zBreech = -0.13;
  const zBarrelEnd = -0.523;
  const opticY = bore + 0.067;
  const opticZ = -0.012;

  const body = new Assembly('lmg-body');

  /* ---- receiver: a deep riveted box, not an AR forging ------------------ */
  const recH = 0.062;
  const recBox = box(recW, recH, zRecRear - zRecFront, 0.0022, 2);
  body.add(recBox, 'steel_enamel', { y: bore - 0.006, z: (zRecRear + zRecFront) / 2 });
  recBox.dispose();
  // Feed tray cover: a raised lid over the front half of the receiver with a
  // hinge boss at the front and a latch at the rear — the one shape that says
  // "belt-fed" from every angle.
  const cover = box(recW - 0.003, 0.014, 0.15, 0.0018, 2);
  body.add(cover, 'steel_enamel', { y: bore + 0.0295, z: -0.055 });
  cover.dispose();
  const hinge = rodZ(0.005, 0.005, recW - 0.006, 12, 0.0006);
  hinge.rotateY(Math.PI / 2);
  body.add(hinge, 'steel', { y: bore + 0.034, z: -0.128 });
  hinge.dispose();
  /* Cover latch: enamel like the sheet it locks, not bright steel — as bare
   * `steel` its top face sat ~120 mm from the eye in ADS and rendered as the
   * brightest slab on screen (measured on lmg-ads.png). */
  const latch = box(0.014, 0.004, 0.016, 0.001, 1);
  body.add(latch, 'steel_enamel', { y: bore + 0.037, z: 0.014 });
  latch.dispose();
  // Rivet lines along both receiver flanks.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      addScrew(body, 'steel', sx * (recW / 2 - 0.0006), bore - 0.02, 0.05 - i * 0.04, 0.0022, 'x', 0.004);
    }
  }
  // Ejection port with a spent-link chute below it, right side.
  const cav = box(0.01, 0.02, 0.05, 0.0008, 1);
  body.add(cav, 'cavity', { x: recW / 2 - 0.004, y: bore - 0.002, z: portZ, ry: Math.PI / 2 });
  cav.dispose();
  const chute = extrude(
    [
      [-0.02, 0],
      [0.02, 0],
      [0.028, -0.03],
      [-0.028, -0.03],
    ],
    0.012,
    { bevel: 0.001 }
  );
  body.add(chute, 'steel_enamel', { x: recW / 2 - 0.002, y: bore - 0.03, z: portZ, ry: Math.PI / 2 });
  chute.dispose();
  // Top rail on the cover for the optic.
  addRail(body, 'alu', zRecFront + 0.02, zRecRear - 0.05, railTop);

  /* ---- barrel: heavy profile, gas system UNDER the bore ------------------ */
  addBarrel(body, 'steel', 'cavity', {
    y: bore,
    zBreech,
    zMuzzle: zBarrelEnd,
    rChamber: 0.0135,
    rBarrel: 0.0098,
    rGas: 0.0118,
    gasAt: -0.34,
  });
  // Carry handle on the barrel — the quick-change grab. Folded to the right.
  const chPost = box(0.008, 0.02, 0.014, 0.001, 1);
  body.add(chPost, 'steel_enamel', { y: bore + 0.02, z: -0.155 });
  chPost.dispose();
  const chBar = box(0.012, 0.008, 0.085, 0.0012, 2);
  body.add(chBar, 'polymer', { x: 0.014, y: bore + 0.03, z: -0.185, rz: -0.5 });
  chBar.dispose();
  // Gas block + tube run UNDER the barrel on a SAW; addGasBlock puts its tube
  // over `y + r`, so hand it a mirrored y and let the block itself sit low.
  const gasZ = -0.36;
  const gasBlock = box(0.022, 0.022, 0.03, 0.001, 2);
  body.add(gasBlock, 'steel_soot', { y: bore - 0.017, z: gasZ });
  gasBlock.dispose();
  const gasTube = tubeZ(0.0055, 0.0035, gasZ - zBreech - 0.01, 12, 0.0003);
  body.add(gasTube, 'steel', { y: bore - 0.021, z: (gasZ + zBreech) / 2 });
  gasTube.dispose();
  const muzzle = addMuzzleDevice(body, 'steel_soot', 'cavity', 'brake', zBarrelEnd, 0.0098, bore);

  /* ---- handguard + folded bipod ----------------------------------------- */
  addHandguard(body, 'alu', {
    matPanel: 'polymer',
    y: bore,
    z0: hgZ0,
    z1: hgZ1,
    r: hgR,
    sides: 8,
    slatW: 0.017,
    slatT: 0.0038,
    slots: 4,
    braces: 3,
    topFrom: -0.28,
    topTo: hgZ1 + 0.05,
  });
  addQdSocket(body, 'alu', 'steel', -hgR + 0.001, bore - 0.008, hgZ0 - 0.03, 'x', 0.005);
  addSlingLoop(body, 'steel', 0, bore - hgR - 0.0015, hgZ1 + 0.028, 0.0075, {
    rx: Math.PI / 2,
    ry: Math.PI / 2,
  });
  // Bipod, folded rearward along the handguard's underside: a clamp collar and
  // two legs with feet, tucked at a slight splay.
  const collar = tubeZ(hgR + 0.006, hgR + 0.002, 0.018, 16, 0.0006);
  body.add(collar, 'steel_black', { y: bore, z: hgZ1 + 0.016 });
  collar.dispose();
  for (const sx of [-1, 1]) {
    const leg = rodZ(0.0042, 0.0036, 0.15, 10, 0.0005);
    body.add(leg, 'steel_black', {
      x: sx * 0.018,
      y: bore - hgR - 0.004,
      z: hgZ1 + 0.095,
      rx: 0.06,
      ry: sx * 0.05,
    });
    leg.dispose();
    const foot = box(0.008, 0.008, 0.02, 0.001, 1);
    body.add(foot, 'rubber', { x: sx * 0.022, y: bore - hgR - 0.006, z: hgZ1 + 0.175 });
    foot.dispose();
  }

  /* ---- furniture --------------------------------------------------------- */
  addPistolGrip(body, 'polymer', 'rubber', { y: 0.035, z: 0.015, angle: 0.38, len: 0.108, w: 0.031 });
  addCarbineStock(body, 'alu', 'polymer', 'rubber', {
    bore,
    zFront: zRecRear + 0.003,
    zRear: 0.255,
    y: bore - 0.012,
  });
  // Trigger guard.
  const guardOuter = [
    [-0.026, 0],
    [0.028, 0],
    [0.03, -0.006],
    [0.026, -0.022],
    [0.016, -0.027],
    [-0.018, -0.027],
    [-0.026, -0.021],
  ];
  const guardInner = [
    [-0.021, -0.003],
    [0.0225, -0.003],
    [0.0235, -0.008],
    [0.02, -0.0205],
    [0.013, -0.0235],
    [-0.015, -0.0235],
    [-0.0205, -0.0185],
  ];
  const guard = extrude(guardOuter, 0.016, { bevel: 0.0009, holes: [guardInner] });
  body.add(guard, 'polymer', { y: bore - 0.036, z: -0.006 });
  guard.dispose();

  /* ---- sights ------------------------------------------------------------ */
  const optic = buildOptic(body, {
    rTube: 0.0155,
    len: 0.052,
    hood: 0.007,
    y: opticY,
    z: opticZ,
    railTop,
    matBody: 'alu_fine',
    matSteel: 'steel',
  });
  addFrontSight(body, 'polymer', 'alu', 0, bore + 0.0245, -0.5, false);
  /**
   * Folded BUIS FORWARD of the optic, not behind it — the same composition fix
   * the rifle documents at length: a folded rear sight at the back of the rail
   * sits ~120 mm from the eye in ADS and its windage drum renders as the
   * brightest slab on screen, directly under the sight picture. Measured here
   * too (lmg-ads.png, first capture), so it rides the front of the cover rail.
   */
  addRearSight(body, 'polymer', 'alu', 0, railTop, zRecFront + 0.045, false);

  /* ---- moving parts ------------------------------------------------------ */
  /**
   * THE BELT POUCH — this weapon's "magazine". A 100-round soft pack clipped
   * into the feed port: a fabric box with a moulded top frame, a strap seam
   * around its waist, and the first three linked rounds climbing out of its
   * mouth toward the tray. The generic reload clip pulls it off, throws it
   * away and clips a fresh one in, which is exactly how the real pouch works.
   * Authored hanging from its origin (the clip at the feed port), so the
   * `magSeat` node is the port and `magDrop` throws it down and away.
   */
  const magazine = new Assembly('lmg-pouch');
  const frame = box(0.062, 0.016, 0.1, 0.0016, 2);
  magazine.add(frame, 'polymer', { y: -0.008, z: 0 });
  frame.dispose();
  const pouch = blob(0.072, 0.118, 0.13, 0.008, 3);
  magazine.add(pouch, 'rubber', { y: -0.075, z: 0.004 });
  pouch.dispose();
  // Waist seam strap.
  const seam = box(0.074, 0.012, 0.132, 0.0014, 1);
  magazine.add(seam, 'polymer', { y: -0.07, z: 0.004 });
  seam.dispose();
  // Three linked rounds at the mouth, lying across the feed direction.
  for (let i = 0; i < 3; i++) {
    const round = cartridge(0.0446, 0.00495, 0.019);
    round.brass.rotateY(Math.PI / 2);
    magazine.add(round.brass, 'brass', { x: -0.024 + i * 0.013, y: 0.004, z: -0.012 });
    round.brass.dispose();
    round.bullet.dispose();
    const link = box(0.004, 0.012, 0.013, 0.0006, 1);
    magazine.add(link, 'steel', { x: -0.0175 + i * 0.013, y: 0.004, z: -0.012 });
    link.dispose();
  }

  // Charging handle: a rearward-raked slot handle on the right flank.
  const charging = new Assembly('lmg-charging');
  const chParts = [];
  const chShaft = box(0.006, 0.012, 0.07, 0.0008, 1);
  chParts.push(chShaft);
  const chKnob = blob(0.012, 0.03, 0.02, 0.0025, 2);
  chKnob.translate(0.008, -0.006, 0.03);
  chParts.push(chKnob);
  const chG = mergeAll(chParts);
  charging.add(chG, 'polymer', {});
  chG.dispose();

  const trigger = new Assembly('lmg-trigger');
  const trg = triggerPart('steel_bright');
  trigger.add(trg.geo, 'steel_bright', {});
  trg.geo.dispose();

  return {
    id: 'lmg',
    label: 'MK-46',
    fxClass: 'lmg',
    body,
    moving: { magazine, charging, trigger },
    nodes: {
      muzzle: [0, bore, muzzle.crownZ],
      chamber: [0, bore, portZ],
      eject: [recW / 2 + 0.006, bore - 0.002, portZ],
      /** Links and brass leave low and to the right, below the port. */
      ejectDir: [0.88, 0.28, 0.2],
      sight: [0, opticY, optic.lensZ],
      sightAxis: [0, 0, -1],
      ironSight: [0, railTop + 0.026, zRecRear - 0.062],
      /**
       * Same derivation as the rifle's: the cylinder comes from the
       * `addPistolGrip` arguments above, and the wrist target is SEARCHED with
       * tools/gripfit.mjs (wrist-, span- and penetration-constrained), not
       * reasoned out. Seeded from the rifle's solved grip — the grip itself is
       * the identical part at the identical offset.
       */
      gripCylinder: {
        axis: [0, 0.035, 0.015],
        dir: [0, -Math.cos(0.38), Math.sin(0.38)],
        r: 0.017,
        z0: 0.015,
        z1: 0.015 + 0.108 * Math.sin(0.38),
      },
      gripR: {
        pos: [0.0526, -0.034, 0.0023],
        finger: [-0.2465, 0.9307, 0.2702],
        back: [0.9958, -0.0912, -0.0052],
      },
      /**
       * Support hand under the handguard — SEARCHED with gripfit --side=left
       * (seeded from the rifle's solved pose shifted back with the handguard).
       * Search result: tip gaps [0.2 0.4 0.5 0.5] mm, wrist 32.7 -> 17.1 deg,
       * extension 0.953 -> 0.906 (off the clamp), penetration 0.0 mm.
       * The shooting hand keeps the rifle's searched numbers verbatim: the
       * grip is the identical part at the identical offset, and the re-search
       * here scored worse on penetration (17.5 -> 35.8 mm), so it was refused.
       */
      gripL: {
        pos: [-0.065, 0.0034, -0.2558],
        finger: [0.7064, 0.1858, -0.683],
        back: [0.1447, -0.9891, 0.0287],
      },
      handguard: {
        axis: [0, bore, 0],
        dir: [0, 0, 1],
        r: hgR + 0.0038,
        z0: hgZ0,
        z1: hgZ1,
      },
      magSeat: { pos: [0, bore - 0.037, magZ], rot: [0, 0, 0] },
      magDrop: [0, -0.42, 0.04],
      chargeRest: { pos: [recW / 2 + 0.004, bore + 0.002, 0.005], rot: [0, 0, 0] },
      chargePull: [0, 0, 0.075],
      triggerPivot: { pos: [0, 0.0455, -0.0055], rot: [0, 0, 0] },
      triggerPull: -0.34,
      opticGlass: optic,
    },
    shell: { caseLen: 0.0446, rimR: 0.00495 },
    magSize: { len: 0.14, w: 0.075, d: 0.14 },
  };
}
