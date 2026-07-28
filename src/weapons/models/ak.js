import { Assembly, box, blob, dome, extrude, roundRect, latheZ, rodZ, tubeZ, knurlBand, mergeAll } from '../geometry.js';
import {
  addBarrel,
  addPistolGrip,
  addRollmark,
  addSlingLoop,
  addPin,
  addScrew,
  buildMagazine,
  triggerPart,
  cartridge,
} from '../parts.js';

/**
 * The AK-pattern rifle — a 7.62x39 stamped-receiver carbine.
 *
 * NOT a recoloured M4, and the list of things that make that true is the list
 * of things a viewer actually uses to tell the two apart at 40 px:
 *
 *   - a STAMPED sheet-steel receiver with a riveted flank and a domed,
 *     ribbed top cover, in blued steel — against the M4's machined, anodised
 *     aluminium flat-top. Two different material classes, not two tints.
 *   - a heavily CURVED 30-round magazine (55 mm of sagitta over 235 mm, against
 *     the M4's 30 over 212) rocked 8 degrees forward into the receiver, with no
 *     magwell around it because an AK does not have one.
 *   - warm FDE/bakelite furniture: a clamshell lower handguard with finger
 *     grooves, an upper handguard over the gas tube, a club buttstock.
 *   - the canted GAS BLOCK and the hooded FRONT SIGHT BLOCK standing proud of
 *     the barrel, with the cleaning rod under it.
 *   - a SLANT compensator, cut oblique up and to the right.
 *   - the big stamped SAFETY LEVER down the right flank, and the reciprocating
 *     charging handle on the same side.
 *   - iron sights: a tangent leaf on the rear sight block AHEAD of the receiver.
 *
 * Layout (weapon-local metres, origin at the shooting hand's thumb web):
 *   bore axis          y = +0.0785
 *   receiver           z = +0.078 .. -0.128   (top cover crest y = +0.1027)
 *   rear sight block   z = -0.148
 *   handguard          z = -0.140 .. -0.262
 *   gas block          z = -0.272
 *   front sight block  z = -0.372
 *   muzzle crown       z = -0.468
 *   butt pad           z = +0.300
 */
export function buildAk() {
  const bore = 0.0785;
  const recW = 0.0362;
  const recWallTop = bore + 0.0105;
  const recBot = bore - 0.0338;
  const zRecRear = 0.078;
  const zRecFront = -0.128;
  const portZ = -0.036;
  const magZ = -0.074;
  const magTilt = 0.14;
  const hgZ0 = -0.14;
  const hgZ1 = -0.262;
  const zGas = -0.272;
  const zFsb = -0.372;
  const zBarrelEnd = -0.412;
  const zRearSight = -0.148;
  /**
   * SIGHT LINE HEIGHT, and it is set by the DUST COVER, not by the sight.
   *
   * At bore + 24.5 mm the line of sight ran exactly along the crest of the top
   * cover (bore + 24.2 mm), so in ADS the cover — a 190 mm sheet seen almost
   * edge-on, facing the sky — filled the bottom half of the frame as a blown
   * white wedge with the notch sitting on top of it. Measured on the first
   * in-game ADS capture, not guessed.
   *
   * bore + 28 mm clears the crest (now bore + 22.3 mm, the cover having lost
   * its flat top as well) by 5.7 mm, which is what a real AK's sights do: you
   * look down over the cover, not along it.
   */
  const sightY = bore + 0.028;
  const gasY = bore + 0.019;
  /** Handguard collision axis — see `handguard` in nodes for the derivation. */
  const hgAxisY = 0.0595;
  const hgR = 0.0198;
  const gripAngle = 0.44;
  const gripY = 0.031;
  const gripZ = 0.012;

  const body = new Assembly('ak-body');

  /* ---- stamped receiver ------------------------------------------------- */
  /**
   * A stamped receiver is a 1 mm sheet-steel channel with machined trunnions
   * riveted into each end, so the flanks are FLAT and the rivet heads are the
   * only thing standing off them. That flatness is the whole silhouette read,
   * and it is why the rivets below are not decoration: without them a stamped
   * receiver is a featureless blued box.
   */
  const recH = recWallTop - recBot;
  const recLen = zRecRear - zRecFront;
  const shell = box(recW, recH, recLen, 0.0016, 2);
  body.add(shell, 'steel_enamel', { y: (recWallTop + recBot) / 2, z: (zRecRear + zRecFront) / 2 });
  shell.dispose();

  // Rolled stiffening ribs down each flank, and the magazine-well swage.
  for (const sx of [-1, 1]) {
    const rib = box(0.0016, 0.0052, 0.086, 0.0004, 1);
    body.add(rib, 'steel_enamel', { x: sx * (recW * 0.5 - 0.0004), y: bore - 0.022, z: -0.008 });
    rib.dispose();
  }

  // Rivets: two rows, real domed heads. The lower row carries the trigger-guard
  // and grip-nut rivets, the upper row the trunnions and the rail block.
  const rivet = dome(0.0021, 10, 0.55);
  for (const sx of [-1, 1]) {
    for (const [rz, ry] of [
      [0.064, bore - 0.006],
      [0.064, bore - 0.026],
      [0.03, bore - 0.028],
      [-0.02, bore - 0.03],
      [-0.062, bore - 0.028],
      [-0.104, bore - 0.006],
      [-0.104, bore - 0.026],
      [-0.118, bore - 0.016],
    ]) {
      body.add(rivet, 'steel', { x: sx * (recW * 0.5 + 0.0002), y: ry, z: rz, ry: sx * Math.PI * 0.5 });
    }
  }
  rivet.dispose();

  // Front trunnion: the machined block the barrel screws into, swaged into the
  // front of the sheet. It stands 1.5 mm proud of the flanks all round, which
  // is what breaks the receiver's 206 mm prism into two masses.
  const trunnion = box(recW + 0.003, recH - 0.006, 0.03, 0.0018, 2);
  body.add(trunnion, 'steel_enamel', { y: (recWallTop + recBot) / 2 - 0.001, z: zRecFront + 0.014 });
  trunnion.dispose();

  /**
   * Top cover: a stamped dome, not a flat deck. Its cross-section is an arch
   * with two rolled ribs, and the arch is what stops the receiver reading as a
   * rectangular prism from every angle above the bore.
   */
  const coverSection = [
    [-0.0181, 0],
    [-0.0179, 0.0052],
    [-0.0158, 0.0092],
    [-0.0108, 0.0114],
    [-0.004, 0.0118],
    [0.004, 0.0118],
    [0.0108, 0.0114],
    [0.0158, 0.0092],
    [0.0179, 0.0052],
    [0.0181, 0],
  ];
  const cover = extrude(coverSection, 0.19, { bevel: 0.0009, bevelSegments: 2 });
  body.add(cover, 'steel_enamel', { y: recWallTop, z: -0.018 });
  cover.dispose();
  for (const sx of [-1, 1]) {
    const coverRib = box(0.0034, 0.0022, 0.176, 0.0006, 1);
    body.add(coverRib, 'steel_enamel', { x: sx * 0.0104, y: recWallTop + 0.0104, z: -0.018 });
    coverRib.dispose();
  }
  // Rear lip of the cover and the recoil-spring guide nub it locks onto.
  const coverLip = box(0.0368, 0.0044, 0.006, 0.0009, 1);
  body.add(coverLip, 'steel_enamel', { y: recWallTop + 0.0074, z: 0.0755 });
  coverLip.dispose();
  /**
   * The recoil-spring guide's protruding tail. It is DARK and it is small, and
   * both are forced by ADS: at 0.238 of eye relief (defs.js) this part sits
   * 28 mm from the camera, so in phosphate steel a 6.4 mm rod rendered as a
   * blown chrome facet 200 px across at the bottom of the sight picture.
   * Measured. Painted with the rest of the sheet metal and cut to 5 mm it is a
   * dark nub against a dark receiver, which is what it looks like down a real
   * AK's sights.
   */
  const guideNub = rodZ(0.0025, 0.0025, 0.007, 10, 0.0004);
  body.add(guideNub, 'steel_enamel', { y: recWallTop + 0.0048, z: 0.0795 });
  guideNub.dispose();

  /**
   * Ejection port. An AK's is a huge open rectangle in the right wall and the
   * top cover's edge, twice the area of an AR's, and its size is one of the
   * things the eye reads as "not an AR". The bolt carrier is visible in it.
   */
  const portW = 0.048;
  const portH = 0.0175;
  const portCav = box(0.012, portH, portW, 0.0008, 1);
  body.add(portCav, 'cavity', { x: recW * 0.5 - 0.007, y: bore + 0.0022, z: portZ, ry: Math.PI / 2 });
  portCav.dispose();
  const portLip = extrude(roundRect(portW + 0.005, portH + 0.005, 0.0022, 3), 0.0022, { bevel: 0.0006 });
  body.add(portLip, 'steel_enamel', { x: recW * 0.5 - 0.0018, y: bore + 0.0022, z: portZ, ry: Math.PI / 2 });
  portLip.dispose();

  /**
   * Magazine opening. There is no magwell: the receiver floor simply has a
   * rectangular hole with a front lip the magazine's front lug rocks into, and
   * a sprung catch behind it. Modelling a magwell here is the single fastest
   * way to make an AK read as an AR with a curved magazine.
   */
  const magW = 0.0272;
  const magD = 0.0715;
  const magMouth = extrude(roundRect(magW + 0.006, magD + 0.006, 0.004, 4), 0.0075, {
    bevel: 0.0012,
    holes: [roundRect(magW, magD, 0.003, 4)],
  });
  body.add(magMouth, 'steel_enamel', { y: recBot + 0.0016, z: magZ, rx: Math.PI / 2 + magTilt });
  magMouth.dispose();
  const magHole = extrude(roundRect(magW - 0.001, magD - 0.001, 0.003, 4), 0.006, { bevel: 0.0005 });
  body.add(magHole, 'cavity', { y: recBot + 0.005, z: magZ, rx: Math.PI / 2 + magTilt });
  magHole.dispose();
  // Front lug shelf and the rocking catch behind the well.
  const catchBody = extrude(
    [
      [-0.006, 0],
      [0.008, 0],
      [0.009, -0.012],
      [0.001, -0.016],
      [-0.006, -0.013],
    ],
    0.014,
    { bevel: 0.0008 }
  );
  catchBody.rotateY(Math.PI / 2);
  body.add(catchBody, 'steel_enamel', { y: recBot + 0.001, z: magZ + magD * 0.5 + 0.004 });
  catchBody.dispose();

  /**
   * LEFT-SIDE OPTIC RAIL — the riveted side mount, and it is here for a render
   * reason as much as an authenticity one.
   *
   * The hipfire pose rolls the weapon 7.7 degrees so the LEFT flank faces the
   * camera (see defs.js), and on a stamped receiver that flank is 206 x 44 mm
   * of dead-flat sheet carrying nothing but rivets — which is exactly the "no
   * flat/untextured surfaces" failure the quality bar names, and it read as one
   * in the first in-game capture. The side rail is a real and extremely common
   * AK fitting, it sits on precisely the surface the camera sees, and it gives
   * that flank a second mass with its own shadow line under it.
   */
  const railPlate = box(0.0055, 0.0235, 0.056, 0.0012, 2);
  body.add(railPlate, 'steel_enamel', { x: -recW * 0.5 - 0.0026, y: bore - 0.0125, z: 0.026 });
  railPlate.dispose();
  for (const [ly, rz] of [
    [bore - 0.0025, -0.5],
    [bore - 0.0225, 0.5],
  ]) {
    const lip = box(0.0105, 0.0072, 0.0525, 0.0011, 2);
    body.add(lip, 'steel_enamel', { x: -recW * 0.5 - 0.0048, y: ly, z: 0.026, rz });
    lip.dispose();
  }
  const railSlot = box(0.003, 0.008, 0.016, 0.0004, 1);
  body.add(railSlot, 'cavity', { x: -recW * 0.5 - 0.0072, y: bore - 0.0125, z: 0.0405 });
  railSlot.dispose();
  for (const rz of [0.004, 0.048]) {
    const rHead = dome(0.0028, 10, 0.55);
    body.add(rHead, 'steel', { x: -recW * 0.5 - 0.0054, y: bore - 0.0125, z: rz, ry: -Math.PI / 2 });
    rHead.dispose();
  }

  /* ---- trigger guard + grip -------------------------------------------- */
  const guardOuter = [
    [-0.03, 0],
    [0.028, 0],
    [0.03, -0.006],
    [0.026, -0.0215],
    [0.016, -0.0265],
    [-0.022, -0.0265],
    [-0.03, -0.02],
  ];
  const guardInner = [
    [-0.0245, -0.003],
    [0.0225, -0.003],
    [0.0245, -0.0085],
    [0.0205, -0.0195],
    [0.0135, -0.0225],
    [-0.0185, -0.0225],
    [-0.0245, -0.018],
  ];
  const guard = extrude(guardOuter, 0.0178, { bevel: 0.0011, bevelSegments: 2, holes: [guardInner] });
  guard.rotateY(Math.PI / 2);
  body.add(guard, 'steel_enamel', { y: recBot + 0.001, z: -0.008 });
  guard.dispose();

  // Grip nut boss under the receiver, then the grip itself.
  const gripBoss = box(0.028, 0.009, 0.031, 0.0012, 2);
  body.add(gripBoss, 'steel_enamel', { y: recBot + 0.0025, z: 0.0195, rx: -gripAngle * 0.5 });
  gripBoss.dispose();
  addPistolGrip(body, 'polymer_tan', 'rubber', {
    y: gripY,
    z: gripZ,
    angle: gripAngle,
    len: 0.102,
    w: 0.0305,
  });

  /* ---- barrel, gas system, front furniture ------------------------------ */
  const rBarrel = 0.0079;
  addBarrel(body, 'steel', 'cavity', {
    y: bore,
    zBreech: -0.116,
    zMuzzle: zBarrelEnd,
    rChamber: 0.0122,
    rBarrel,
    rGas: 0.0098,
    gasAt: zGas,
    knurl: false,
  });

  /**
   * Gas block, CANTED — the AK's gas port is drilled at 45 degrees, so the
   * block leans and the tube leaves it at an angle before straightening. That
   * lean is a silhouette cue the AR's dead-square low-profile block does not
   * have.
   */
  const gasBlock = extrude(
    [
      [-0.012, -0.011],
      [0.013, -0.011],
      [0.014, 0.004],
      [0.009, 0.019],
      [-0.008, 0.019],
      [-0.013, 0.004],
    ],
    0.0225,
    { bevel: 0.0011, bevelSegments: 2 }
  );
  gasBlock.rotateY(Math.PI / 2);
  body.add(gasBlock, 'steel_soot', { y: bore + 0.001, z: zGas, rx: 0.42 });
  gasBlock.dispose();
  addPin(body, 'steel', 0, bore - 0.004, zGas + 0.006, 0.0021, 0.0232);
  // Gas tube from the block back to the receiver, with its stamped ferrule.
  const gasTube = tubeZ(0.0085, 0.0068, 0.112, 16, 0.0005);
  body.add(gasTube, 'steel_soot', { y: gasY, z: -0.212 });
  gasTube.dispose();
  const gasFerrule = latheZ(
    [
      [-0.268, 0.0085],
      [-0.268, 0.0102],
      [-0.256, 0.0102],
      [-0.256, 0.0085],
    ],
    16
  );
  body.add(gasFerrule, 'steel_enamel', { y: gasY });
  gasFerrule.dispose();
  // Vent slots in the tube: real gaps read as holes, painted ones do not.
  for (let i = 0; i < 3; i++) {
    for (const sx of [-1, 1]) {
      const vent = box(0.0018, 0.0055, 0.0125, 0.0003, 1);
      body.add(vent, 'cavity', { x: sx * 0.0078, y: gasY, z: -0.176 - i * 0.019 });
      vent.dispose();
    }
  }

  /**
   * FRONT SIGHT BLOCK — the hooded post. The hood is a genuine cylinder with a
   * slot cut through the top, which is what makes an AK's front sight read as a
   * ring rather than as the AR's two flat ears.
   */
  const fsbBase = extrude(
    [
      [-0.011, -0.012],
      [0.012, -0.012],
      [0.013, 0.006],
      [0.0085, 0.0158],
      [-0.0085, 0.0158],
      [-0.012, 0.006],
    ],
    0.0225,
    { bevel: 0.001, bevelSegments: 2 }
  );
  fsbBase.rotateY(Math.PI / 2);
  body.add(fsbBase, 'steel_soot', { y: bore, z: zFsb });
  fsbBase.dispose();
  addPin(body, 'steel', 0, bore - 0.006, zFsb - 0.004, 0.0019, 0.0232);
  // Hood: a short tube standing on +Y, split by the sight slot.
  const hood = tubeZ(0.0092, 0.0076, 0.0215, 18, 0.0004);
  hood.rotateX(Math.PI / 2);
  body.add(hood, 'steel_soot', { y: sightY, z: zFsb });
  hood.dispose();
  const hoodSlot = box(0.0058, 0.0045, 0.0225, 0.0004, 1);
  body.add(hoodSlot, 'cavity', { y: sightY + 0.0105, z: zFsb });
  hoodSlot.dispose();
  // The post, on the sight line.
  const post = rodZ(0.0013, 0.0011, 0.0145, 8, 0.0002);
  post.rotateX(Math.PI / 2);
  body.add(post, 'steel_enamel', { y: sightY - 0.0072, z: zFsb });
  post.dispose();
  const postCollar = latheZ(
    [
      [0, 0],
      [0, 0.0028],
      [0.0022, 0.003],
      [0.0022, 0],
    ],
    10
  );
  body.add(postCollar, 'steel_enamel', { y: sightY - 0.0158, z: zFsb, rx: -Math.PI / 2 });
  postCollar.dispose();

  /**
   * REAR TANGENT SIGHT, on its own block ahead of the receiver — the position
   * that says "AK" more than any other single part, and the one an AR never
   * has (its rear sight is always at the back of the receiver or on the rail).
   *
   * The leaf is deliberately NARROW (16 mm) and in blued steel rather than
   * bright phosphate: it is the closest object to the eye in ADS, and models/
   * rifle.js documents at length what a wide bright blade does to that frame.
   */
  const rsBase = extrude(
    [
      [-0.013, -0.011],
      [0.013, -0.011],
      [0.014, 0.003],
      [0.008, 0.009],
      [-0.008, 0.009],
      [-0.014, 0.003],
    ],
    0.0225,
    { bevel: 0.001, bevelSegments: 2 }
  );
  rsBase.rotateY(Math.PI / 2);
  body.add(rsBase, 'steel_soot', { y: bore + 0.001, z: zRearSight });
  rsBase.dispose();
  // The tangent leaf, laid nearly flat with its slider, plus the notch blade.
  const leaf = extrude(
    [
      [-0.03, -0.0018],
      [0.014, -0.0018],
      [0.015, 0.0018],
      [-0.03, 0.0018],
    ],
    0.016,
    { bevel: 0.0005 }
  );
  leaf.rotateY(Math.PI / 2);
  body.add(leaf, 'steel_enamel', { y: sightY - 0.0112, z: zRearSight - 0.006, rx: -0.06 });
  leaf.dispose();
  const slider = box(0.0165, 0.0052, 0.0075, 0.0008, 1);
  body.add(slider, 'steel_enamel', { y: sightY - 0.0072, z: zRearSight + 0.0155 });
  slider.dispose();
  // Notch blade: the two shoulders either side of a U-notch, on the sight line.
  for (const sx of [-1, 1]) {
    const shoulder = box(0.0052, 0.0055, 0.0022, 0.0005, 1);
    body.add(shoulder, 'steel_enamel', { x: sx * 0.0044, y: sightY - 0.0026, z: zRearSight + 0.0185 });
    shoulder.dispose();
  }
  const notchFloor = box(0.0035, 0.0022, 0.0022, 0.0004, 1);
  body.add(notchFloor, 'cavity', { y: sightY - 0.0044, z: zRearSight + 0.0185 });
  notchFloor.dispose();

  /* ---- furniture: lower + upper handguards ------------------------------ */
  /**
   * The lower handguard is a CLAMSHELL, not a tube: a moulded trough that cups
   * the barrel, roughly 46 x 40 mm in section with a palm swell and three
   * finger grooves per flank. `hgR`/`hgAxisY` below are the round approximation
   * the fingertip solve uses; see the `handguard` node.
   */
  const lowerSection = [
    [-0.019, 0.0055],
    [-0.023, -0.004],
    [-0.0235, -0.016],
    [-0.019, -0.028],
    [-0.009, -0.0335],
    [0.009, -0.0335],
    [0.019, -0.028],
    [0.0235, -0.016],
    [0.023, -0.004],
    [0.019, 0.0055],
    [0.011, 0.0075],
    [-0.011, 0.0075],
  ];
  const lower = extrude(lowerSection, hgZ0 - hgZ1, { bevel: 0.0022, bevelSegments: 2, curveSegments: 4 });
  body.add(lower, 'polymer_tan', { y: bore - 0.0175, z: (hgZ0 + hgZ1) / 2 });
  lower.dispose();
  // Finger grooves: shallow cross-wise scallops on both flanks.
  for (let i = 0; i < 3; i++) {
    const gz = hgZ1 + 0.028 + i * 0.028;
    for (const sx of [-1, 1]) {
      const groove = blob(0.0055, 0.019, 0.0125, 0.0035, 3);
      body.add(groove, 'polymer_tan', { x: sx * 0.0215, y: bore - 0.0195, z: gz });
      groove.dispose();
    }
  }
  // Palm swell underneath and the retainer / ferrule at each end.
  const swell = blob(0.036, 0.008, 0.062, 0.006, 3);
  body.add(swell, 'polymer_tan', { y: bore - 0.0475, z: (hgZ0 + hgZ1) / 2 - 0.004 });
  swell.dispose();
  for (const [fz, fw] of [
    [hgZ0 - 0.0055, 0.0115],
    [hgZ1 + 0.005, 0.0105],
  ]) {
    const ferrule = extrude(
      [
        [-0.0235, 0.008],
        [-0.0245, -0.016],
        [-0.011, -0.0335],
        [0.011, -0.0335],
        [0.0245, -0.016],
        [0.0235, 0.008],
      ],
      fw,
      { bevel: 0.0008 }
    );
    body.add(ferrule, 'steel_enamel', { y: bore - 0.0175, z: fz });
    ferrule.dispose();
  }

  // Upper handguard, riding on the gas tube.
  const upperSection = [
    [-0.0125, -0.0015],
    [-0.0175, 0.007],
    [-0.0165, 0.0165],
    [-0.008, 0.0215],
    [0.008, 0.0215],
    [0.0165, 0.0165],
    [0.0175, 0.007],
    [0.0125, -0.0015],
  ];
  const upper = extrude(upperSection, 0.098, { bevel: 0.0018, bevelSegments: 2, curveSegments: 4 });
  body.add(upper, 'polymer_tan', { y: gasY - 0.0055, z: -0.202 });
  upper.dispose();
  for (let i = 0; i < 2; i++) {
    for (const sx of [-1, 1]) {
      const groove = blob(0.005, 0.0135, 0.011, 0.003, 3);
      body.add(groove, 'polymer_tan', { x: sx * 0.016, y: gasY + 0.006, z: -0.182 - i * 0.03 });
      groove.dispose();
    }
  }

  // Cleaning rod under the barrel — an AK always carries one, and it is the
  // long bright line that breaks up the underside of the front end.
  const rod = rodZ(0.0018, 0.0018, 0.196, 8, 0.0003);
  body.add(rod, 'steel', { y: bore - 0.0128, z: -0.3 });
  rod.dispose();

  addSlingLoop(body, 'steel', 0, bore - 0.0245, zGas + 0.014, 0.0072, {
    rx: Math.PI / 2,
    ry: Math.PI / 2,
  });

  /* ---- slant compensator ------------------------------------------------ */
  /**
   * AKM slant brake: a stubby can whose muzzle face is cut ~30 degrees off the
   * bore, with the tall side up and to the right — that asymmetry is the whole
   * point of the part (it vents up-right to fight muzzle rise) and it is the
   * single most recognisable muzzle device in existence.
   *
   * Authored in absolute weapon Z, so no flip: latheZ takes axial coordinates
   * directly and there is nothing to get backwards.
   */
  const brakeLen = 0.056;
  const zCrown = zBarrelEnd - brakeLen;
  const rBrake = rBarrel + 0.0056;
  const brakeBody = latheZ(
    [
      [zBarrelEnd + 0.002, rBarrel + 0.0012],
      [zBarrelEnd - 0.004, rBarrel + 0.0026],
      [zBarrelEnd - 0.007, rBrake],
      [zCrown + 0.024, rBrake],
      [zCrown + 0.021, rBrake * 0.97],
      [zCrown + 0.014, rBrake * 0.97],
      [zCrown + 0.012, rBrake],
      [zCrown + 0.004, rBrake],
      [zCrown + 0.004, rBarrel * 0.72],
      [zCrown + 0.03, rBarrel * 0.66],
    ],
    22
  );
  body.add(brakeBody, 'steel_soot', { y: bore });
  brakeBody.dispose();
  // The oblique crown: a canted collar plus the dark oblique mouth behind it.
  const crownRing = latheZ(
    [
      [0, rBarrel * 0.7],
      [0, rBrake * 1.02],
      [0.0042, rBrake * 1.02],
      [0.0042, rBarrel * 0.7],
      [0, rBarrel * 0.7],
    ],
    22
  );
  body.add(crownRing, 'steel_soot', { y: bore, z: zCrown + 0.012, rx: 0.52, rz: -0.16 });
  crownRing.dispose();
  const crownMouth = latheZ(
    [
      [0, 0],
      [0, rBarrel * 0.68],
      [0.006, rBarrel * 0.6],
      [0.006, 0],
    ],
    16
  );
  body.add(crownMouth, 'cavity', { y: bore, z: zCrown + 0.014, rx: 0.52, rz: -0.16 });
  crownMouth.dispose();
  // The big expansion port on the upper right, and its chamfered lip.
  const portSlot = box(0.0075, 0.0125, 0.0225, 0.0006, 1);
  body.add(portSlot, 'cavity', { x: rBrake * 0.62, y: bore + rBrake * 0.66, z: zCrown + 0.02, rz: -0.72 });
  portSlot.dispose();
  const portRim = box(0.0022, 0.0165, 0.0265, 0.0005, 1);
  body.add(portRim, 'steel_soot', { x: rBrake * 0.86, y: bore + rBrake * 0.86, z: zCrown + 0.02, rz: -0.72 });
  portRim.dispose();
  const detent = dome(0.0026, 10, 0.55);
  body.add(detent, 'steel', { y: bore - rBrake, z: zBarrelEnd - 0.004, rx: Math.PI / 2 });
  detent.dispose();

  /* ---- buttstock -------------------------------------------------------- */
  /**
   * The fixed club stock: a straight taper from the rear trunnion to a shallow
   * comb, with a steel butt plate and a trap for the cleaning kit. Authored as
   * a side outline extruded across, exactly as the carbine stock is, because a
   * stock's whole character is in its profile.
   */
  const stockTang = box(0.031, 0.024, 0.03, 0.0015, 2);
  body.add(stockTang, 'steel_enamel', { y: bore - 0.0165, z: zRecRear + 0.011 });
  stockTang.dispose();
  const buttZ = 0.3;
  /**
   * Side outline, authored with X = FORWARD from the butt plate (x = 0) to the
   * receiver tang (x = 0.222), then `rotateY(PI/2)` maps outline-X onto -Z and
   * the 40.5 mm extrusion onto the width — the same convention parts.js uses
   * for the trigger guard and the carbine stock, and the one that decides
   * whether the stock ends up on the right end of the gun at all.
   *
   * The shape is the AKM's: a straight comb dropping 12 mm over its length, a
   * deep belly under the wrist, and a butt whose toe kicks 6 mm further back
   * than its heel.
   */
  const stockOutline = [
    [0.0, bore + 0.0125],
    [0.008, bore + 0.0182],
    [0.075, bore + 0.0178],
    [0.165, bore + 0.0128],
    [0.213, bore + 0.0072],
    [0.222, bore - 0.002],
    [0.222, bore - 0.0165],
    [0.188, bore - 0.0272],
    [0.112, bore - 0.0405],
    [0.032, bore - 0.0478],
    [0.007, bore - 0.0505],
    [0.0, bore - 0.0425],
  ];
  const stockParts = [];
  const stockShell = extrude(stockOutline, 0.0425, { bevel: 0.0035, bevelSegments: 2, curveSegments: 4 });
  stockShell.rotateY(Math.PI / 2);
  stockParts.push(stockShell);
  // Lightening scallop on each flank, as the real stock's moulding has.
  for (const sx of [-1, 1]) {
    const sc = blob(0.005, 0.02, 0.07, 0.005, 3);
    sc.translate(sx * 0.0195, bore - 0.012, -0.09);
    stockParts.push(sc);
  }
  const stockBody = mergeAll(stockParts);
  body.add(stockBody, 'polymer_tan', { z: buttZ });
  stockBody.dispose();
  const buttPlate = extrude(roundRect(0.0425, 0.064, 0.005, 4), 0.0045, { bevel: 0.001 });
  body.add(buttPlate, 'steel_enamel', { y: bore - 0.0155, z: buttZ - 0.0015, rx: 0.08 });
  buttPlate.dispose();
  const buttTrap = box(0.0205, 0.0195, 0.0016, 0.0004, 1);
  body.add(buttTrap, 'steel', { y: bore - 0.0195, z: buttZ + 0.0016, rx: 0.08 });
  buttTrap.dispose();
  addScrew(body, 'steel', 0, bore + 0.0075, buttZ + 0.0012, 0.0024, 'z', 0.006);
  addSlingLoop(body, 'steel', -0.0205, bore - 0.0225, buttZ - 0.088, 0.0072, { ry: Math.PI / 2 });

  /* ---- markings --------------------------------------------------------- */
  addRollmark(body, 'cavity', { x: -recW * 0.5 - 0.0004, y: bore - 0.0165, z: 0.03, h: 0.0038 });
  addRollmark(body, 'cavity', {
    x: -recW * 0.5 - 0.0004,
    y: bore - 0.0272,
    z: 0.026,
    h: 0.0026,
    pitch: 0.0015,
    pattern: [3, 1, 2, 0, 3, 2, 1, 3],
  });

  /* ---- moving parts ----------------------------------------------------- */
  const magazine = new Assembly('ak-mag');
  /**
   * The banana. 55 mm of sagitta over 235 mm is a 2.6-degree-per-segment arc —
   * more than double the M4 magazine's curve — and it is the first thing anyone
   * identifies an AK by, so the segment count goes up with it (10 slices) to
   * keep the flanks smooth through the bend.
   */
  const mag = buildMagazine(magazine, null, {
    w: 0.0262,
    d: 0.07,
    len: 0.235,
    curve: 0.055,
    segs: 10,
    witness: 0,
    caseLen: 0.0387,
    rimR: 0.00568,
    bulletLen: 0.0265,
    poly: 'polymer_tan',
  });
  // Front locking lug — the tab that rocks into the receiver's front shelf.
  const magLug = box(0.0142, 0.0072, 0.0055, 0.0009, 1);
  magazine.add(magLug, 'polymer_tan', { y: -0.021, z: -0.0365 });
  magLug.dispose();

  /**
   * Charging handle — RIGHT side, and part of the bolt carrier, so it
   * reciprocates. An AK has no separate T-handle at the back of the receiver;
   * putting one there is the classic mistake.
   */
  const charging = new Assembly('ak-charging');
  const chParts = [];
  const chStem = box(0.014, 0.0085, 0.011, 0.0012, 2);
  chStem.translate(0.007, 0, 0);
  chParts.push(chStem);
  const chKnob = latheZ(
    [
      [0, 0],
      [0, 0.0048],
      [0.0022, 0.0055],
      [0.0135, 0.0055],
      [0.0158, 0.0046],
      [0.0158, 0],
    ],
    14
  );
  chKnob.rotateY(-Math.PI / 2);
  chKnob.translate(-0.012, 0, 0);
  chParts.push(chKnob);
  const chG = mergeAll(chParts);
  charging.add(chG, 'steel', {});
  chG.dispose();
  const chKnurl = knurlBand(0.0057, 0.009, 20, 0.0003, 3);
  chKnurl.rotateY(Math.PI / 2);
  chKnurl.translate(0.0195, 0, 0);
  charging.add(chKnurl, 'steel', {});
  chKnurl.dispose();

  const bolt = new Assembly('ak-bolt');
  const carrier = latheZ(
    [
      [0, 0.006],
      [0, 0.0135],
      [0.004, 0.0142],
      [0.086, 0.0142],
      [0.09, 0.0132],
      [0.09, 0.006],
    ],
    18
  );
  bolt.add(carrier, 'steel_bright', { z: -0.09 });
  carrier.dispose();
  // The carrier's flat top rail and its cam slot, seen through the open port.
  const carrierTop = box(0.0165, 0.005, 0.082, 0.0008, 1);
  bolt.add(carrierTop, 'steel_bright', { y: 0.0135, z: -0.046 });
  carrierTop.dispose();
  const chamberRound = cartridge(0.0387, 0.00568, 0.0265);
  bolt.add(chamberRound.brass, 'brass', { z: -0.094, ry: Math.PI });
  chamberRound.brass.dispose();
  chamberRound.bullet.dispose();

  const trigger = new Assembly('ak-trigger');
  const trg = triggerPart('steel_bright');
  trigger.add(trg.geo, 'steel_bright', {});
  trg.geo.dispose();

  /**
   * SAFETY LEVER — the big stamped sheet-steel arm down the right flank, with
   * its dust-cover shelf at the top of the travel. It is 60 mm long and stands
   * 4 mm off the receiver: on this weapon it is a primary silhouette feature,
   * not a switch.
   */
  const selector = new Assembly('ak-selector');
  const selParts = [];
  const selArm = extrude(
    [
      [-0.0075, -0.0055],
      [0.03, -0.0135],
      [0.036, -0.0075],
      [0.036, 0.0055],
      [0.006, 0.0105],
      [-0.0085, 0.006],
    ],
    0.0022,
    { bevel: 0.0005 }
  );
  selArm.rotateY(Math.PI / 2);
  selArm.translate(0.0025, 0, 0);
  selParts.push(selArm);
  const selShelf = box(0.0028, 0.0105, 0.0125, 0.0005, 1);
  selShelf.translate(0.0038, 0.0075, 0.028);
  selParts.push(selShelf);
  const selHub = latheZ(
    [
      [0, 0],
      [0, 0.005],
      [0.0016, 0.0056],
      [0.0075, 0.0056],
      [0.0075, 0],
    ],
    12
  );
  selHub.rotateY(-Math.PI / 2);
  selHub.translate(-0.0005, 0, 0);
  selParts.push(selHub);
  const selG = mergeAll(selParts);
  /**
   * `steel_enamel`, not `steel`. The selector is a 36 x 12 mm FLAT stamped
   * plate standing 4 mm off the flank, and in bare phosphate it rendered as a
   * white rectangle pasted onto the receiver — the same flat-metal-is-a-mirror
   * problem the receiver itself had. A Kalashnikov's selector is painted along
   * with the rest of the sheet metal.
   */
  selector.add(selG, 'steel_enamel', {});
  selG.dispose();

  return {
    id: 'ak',
    label: 'AKM-47',
    fxClass: 'rifle',
    /**
     * PER-MATERIAL WEAR AMPLITUDE, and this one is not cosmetic tuning — it is
     * the same defect models/knife.js documents, hit from the other direction.
     *
     * `bakeMasks` measures convexity PER VERTEX. A stamped receiver is a plain
     * chamfered box, so it has no interior vertices at all: every vertex sits on
     * a chamfer and measures fully convex, and the whole 206 x 44 mm flank comes
     * out at the wear layer's full amplitude. `steel_black`'s wearColor is
     * 0x6a6f75 applied at metalness 1.0 / roughness 0.22 — a polished mirror —
     * so the receiver rendered as a BLANK WHITE SLAB, by far the brightest thing
     * in the frame, while every lathe-built receiver in this directory came out
     * correctly dark. Measured on the first capture.
     *
     * The M4 escapes it because its receiver is a 22-segment lathe with slats,
     * rails and panels; there is nowhere on this weapon that is not flat sheet.
     * The grime and AO layers are untouched — they are what puts dirt in the
     * rivet lines and the magazine cut — only the wear layer comes down.
     *
     * (The far larger half of that defect was the material class, not the mask:
     * see `steel_enamel` in materials.js. This is the residual.)
     */
    wearScale: { steel_enamel: 0.55 },
    body,
    moving: { magazine, charging, bolt, trigger, selector },
    nodes: {
      muzzle: [0, bore, zCrown],
      chamber: [0, bore, portZ],
      eject: [recW * 0.5 + 0.006, bore + 0.004, portZ],
      /**
       * An AK throws brass hard, high and FORWARD-right — 3 to 5 metres, well
       * ahead of the shooter. The M4's case drops out sideways and slightly
       * rearward; this is the opposite sign on Z and it is genuinely how the
       * two guns behave.
       */
      ejectDir: [0.76, 0.58, -0.3],
      sight: [0, sightY, zRearSight + 0.0185],
      sightAxis: [0, 0, -1],
      ironSight: [0, sightY, zRearSight + 0.0185],
      /** Rear notch to front post — a short AK sight radius, as it should be. */
      sightRadius: zRearSight + 0.0185 - zFsb,
      /**
       * SHOOTING HAND — wrist target, derived exactly as models/rifle.js's is
       * (`knuckleContact - 0.098 * finger`), then carried across the 0.06 rad
       * of extra grip rake this weapon has (0.44 vs the M4's 0.38) by rotating
       * both hand axes about X by the same amount. That keeps the metacarpals
       * perpendicular to the grip and the CURL AXIS along it, which is the one
       * relationship that decides whether the fingers wrap or fold.
       *
       * Knuckle contact = grip origin + 36.3 mm down the grip axis
       *                              + 13.1 mm toward the back strap
       *                              + 29.8 mm outboard (half the 30.5 mm grip
       *                                section plus 14.5 mm of palm, so the
       *                                glove buries 1.5 mm and leaves no
       *                                daylight)
       *                 = (0.0298, 0.0037, 0.0393)
       */
      gripR: {
        pos: [0.0249, 0.0624, 0.1176],
        finger: [0.05, -0.599, -0.799],
        back: [1, 0.032, 0.038],
      },
      /**
       * The pistol grip AS A CYLINDER, for the build-time fingertip solve
       * (Viewmodel._fitShootingHand). `axis` is a point on the grip's own raked
       * centreline 36 mm below its top, `dir` is the rake direction
       * (0, -cos 0.44, sin 0.44), and `r` is half the 30.5 mm grip section plus
       * the 1.5 mm rubber over-mould the hand actually touches.
       *
       * Without this the solve returns on its first line and the hand falls
       * back to the raw authored `grip` pose — see models/knife.js for what
       * that looked like when it happened there.
       */
      gripCylinder: {
        axis: [0, -0.0016, 0.0273],
        dir: [0, -0.9048, 0.4259],
        r: 0.0168,
        z0: 0.075,
        z1: -0.01,
      },
      /**
       * SUPPORT HAND — under the lower handguard, solved against the cylinder
       * below with the same construction models/rifle.js derives:
       *   phi    = 250 deg  (below, slightly near-side, so the hand never sits
       *                      on top of the muzzle in the hipfire projection)
       *   finger = tangent at phi rolled 0.30 rad forward   -> wraps CCW
       *   back   = surface normal tilted 0.62 rad rearward  -> dorsum to camera
       *   pos    = contact - 0.098 * finger                 (targets are WRISTS)
       * with the knuckle contact 8.6 mm off the surface, i.e. a 16 mm half-palm
       * buried ~7 mm, which is what a glove squeezing a handguard does.
       */
      gripL: {
        pos: [-0.0977, 0.0648, -0.174],
        finger: [0.898, -0.3267, -0.2955],
        back: [-0.2784, -0.7651, 0.581],
      },
      /**
       * The handguard's collision profile. The real section is a 46 x 40 mm
       * clamshell, not a tube, so this is the mean radius: the fingertips land
       * within 1.5 mm of the true surface all round, biased to the BURIED side
       * (r is set from the shallower half-axis) because daylight between a
       * glove and the wood is visible and 1.5 mm of squeeze is not.
       */
      handguard: {
        axis: [0, hgAxisY, 0],
        dir: [0, 0, 1],
        r: hgR,
        z0: hgZ0,
        z1: hgZ1,
      },
      magSeat: { pos: [0, bore - 0.016, magZ], rot: [magTilt, 0, 0] },
      magDrop: [0, -0.42, 0.02],
      chargeRest: { pos: [recW * 0.5 + 0.003, bore + 0.0055, portZ + 0.03], rot: [0, 0, 0] },
      chargePull: [0, 0, 0.075],
      boltRest: { pos: [0, bore, 0.028], rot: [0, 0, 0] },
      boltTravel: [0, 0, 0.075],
      triggerPivot: { pos: [0, recBot + 0.0055, -0.0055], rot: [0, 0, 0] },
      triggerPull: -0.34,
      selectorPivot: { pos: [recW * 0.5, bore - 0.0165, -0.006], rot: [0, 0, 0] },
    },
    shell: { caseLen: 0.0387, rimR: 0.00568 },
    magSize: { len: mag.len, w: mag.w, d: mag.d },
  };
}
