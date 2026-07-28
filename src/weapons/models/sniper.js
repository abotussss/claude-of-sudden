import * as THREE from 'three';
import {
  Assembly,
  box,
  blob,
  dome,
  extrude,
  roundRect,
  latheZ,
  rodZ,
  tubeZ,
  knurlBand,
  mlokSlot,
  mergeAll,
} from '../geometry.js';
import {
  addBarrel,
  addMuzzleDevice,
  addRail,
  addPistolGrip,
  addQdSocket,
  addSlingLoop,
  addPin,
  addScrew,
  addRollmark,
  buildMagazine,
  triggerPart,
  cartridge,
} from '../parts.js';

/**
 * The bolt-action sniper rifle — a 7.62x51 precision rifle in an aluminium
 * chassis, with a long heavy fluted barrel, a folded bipod and a full
 * variable-power TELESCOPIC SIGHT.
 *
 * The scope is the reason this file does not call `buildOptic`. That part is a
 * tube red dot: one diameter end to end, a 19 mm objective bell, no saddle, no
 * magnification ring, no parallax knob, and a single cantilever mount. A rifle
 * scope's silhouette is the opposite — a slim 34 mm tube with a fat OBJECTIVE
 * BELL at one end, an OCULAR BELL and a knurled power ring at the other, a
 * turret saddle swelling in the middle carrying tall capped elevation and
 * windage turrets and a side parallax knob, all clamped in two separate rings.
 * Every one of those is modelled below (see `buildScope`), because between them
 * they are what makes a weapon read as "scoped" from any angle at all.
 *
 * Bolt action: `modes: ['bolt']` does not exist in this engine's fire-control,
 * and inventing a mode system for one weapon is worse than using the one that
 * is there. So it is `['semi']` at 48 rpm — a 1.25 s cycle, which is what the
 * bolt throw costs — and the reload/inspect timeline works the bolt through the
 * `charging` part, exactly as an AR's timeline works the charging handle.
 *
 * Layout (weapon-local metres, origin at the shooting hand's thumb web):
 *   bore axis        y = +0.072
 *   rail deck        y = +0.1015
 *   scope axis       y = +0.1470
 *   action           z = +0.075 .. -0.115
 *   forend           z = -0.117 .. -0.315
 *   muzzle crown     z = -0.562
 *   butt pad         z = +0.318
 */
export function buildSniper() {
  const bore = 0.072;
  const rAction = 0.0182;
  const railTop = bore + 0.0295;
  const zActRear = 0.075;
  const zActFront = -0.115;
  const portZ = -0.014;
  const magZ = -0.055;
  const magTilt = 0.02;
  const feZ0 = -0.117;
  const feZ1 = -0.315;
  const zBarrelEnd = -0.5;
  const rBarrel = 0.0126;
  /**
   * SCOPE PLACEMENT, and both numbers are constraints rather than taste.
   *
   * HEIGHT: a 64 mm objective bell cannot clear a rail 29.5 mm over bore at any
   * mount height below rOb + railTop-bore + clearance = 68 mm. So the axis sits
   * 68 mm over bore and the rings are 21.5 mm tall. A "realistic" 45 mm mount
   * would bury the bell in the handguard.
   *
   * FORE/AFT: the ADS solve puts `sight` at (0, 0, -eyeRelief) in camera space,
   * so every other landmark lands at (p.z - sight.z) - eyeRelief. The ocular
   * lens ends up at z = -0.010, so with 115 mm of relief (defs.js) the shooting
   * hand comes out at +17 mm — BEHIND the eye and outside the frustum. Left
   * where a scope physically sits, ocular over the tang, that number goes
   * NEGATIVE: the firing fist in front of the camera, straddling the near
   * plane. The scope is therefore run as far forward in its rings as it goes,
   * and the rings straddle the action/forend rail joint to reach it.
   */
  const opticY = bore + 0.0715;
  const opticZ = -0.094;
  const gripAngle = 0.34;
  const gripY = 0.03;
  const gripZ = 0.014;
  const buttZ = 0.318;
  /** Forend collision axis — see the `handguard` node for the derivation. */
  const feAxisY = 0.051;
  const feR = 0.021;

  const body = new Assembly('sniper-body');

  /* ---- receiver / action ------------------------------------------------ */
  /**
   * A round-body action with a flat bottom bedded into the chassis: a 36 mm
   * cylinder, closed at the rear by the bolt shroud and at the front by the
   * barrel tenon. Closed ends for the same reason models/rifle.js closes its
   * receiver — in ADS the eye is 90 mm behind it looking straight in.
   *
   * CERAKOTED, not bare metal — `steel_enamel` (materials.js), the same
   * dielectric-over-steel class the AK's receiver uses. Measured: as
   * `steel_black` the 190 mm action barrel and the 185 mm of exposed barrel
   * both rendered as polished chrome pipes, because three folds a metal's tint
   * into F0 and `specularIntensity` cannot touch it, so a smooth cylinder aimed
   * at the key IS a mirror. A modern precision rifle's action and barrel are
   * finished in Cerakote, which is a ceramic-polymer film — a dielectric — and
   * therefore takes the 0.11 specular clamp like everything else on the gun.
   */
  const actLen = zActRear - zActFront;
  const action = latheZ(
    [
      [0, 0],
      [0, rAction * 0.97],
      [0.0026, rAction],
      [actLen - 0.004, rAction],
      [actLen, rAction * 0.94],
      [actLen, 0],
    ],
    24
  );
  body.add(action, 'steel_enamel', { y: bore, z: zActRear, ry: Math.PI });
  action.dispose();
  // Flat scope deck milled onto the crest, and the integral 20 MOA rail on it.
  const deck = box(0.0245, 0.0095, actLen - 0.004, 0.0009, 1);
  body.add(deck, 'steel_enamel', { y: bore + rAction - 0.0028, z: (zActRear + zActFront) / 2 });
  deck.dispose();
  addRail(body, 'alu', zActFront + 0.004, zActRear - 0.004, railTop);
  // Recoil lug + action screws into the chassis.
  const lug = box(0.0225, 0.014, 0.0075, 0.0009, 1);
  body.add(lug, 'steel_enamel', { y: bore - rAction - 0.005, z: zActFront + 0.008 });
  lug.dispose();
  addScrew(body, 'steel', 0, bore - rAction - 0.0195, zActFront + 0.008, 0.0034, 'y', 0.012);
  addScrew(body, 'steel', 0, bore - rAction - 0.0195, zActRear - 0.03, 0.0034, 'y', 0.012);

  /**
   * Ejection port — long and open on the right, with the loading port's front
   * ramp. A bolt gun's port is a single big rectangle because the whole round
   * has to be fed through it by hand.
   */
  const portW = 0.088;
  const portH = 0.019;
  const portCav = box(0.013, portH, portW, 0.0008, 1);
  body.add(portCav, 'cavity', { x: rAction - 0.007, y: bore + 0.0015, z: portZ, ry: Math.PI / 2 });
  portCav.dispose();
  const portLip = extrude(roundRect(portW + 0.005, portH + 0.005, 0.0024, 3), 0.0024, { bevel: 0.0006 });
  body.add(portLip, 'steel_enamel', { x: rAction - 0.0018, y: bore + 0.0015, z: portZ, ry: Math.PI / 2 });
  portLip.dispose();
  // Bolt shroud and cocking indicator at the rear of the action.
  const shroud = latheZ(
    [
      [0, 0],
      [0, 0.0155],
      [0.0034, 0.0162],
      [0.0165, 0.0162],
      [0.0175, 0.0128],
      [0.0175, 0],
    ],
    20
  );
  body.add(shroud, 'steel_enamel', { y: bore, z: zActRear + 0.0002 });
  shroud.dispose();
  const cockPin = rodZ(0.0028, 0.0028, 0.0085, 10, 0.0004);
  body.add(cockPin, 'steel_bright', { y: bore, z: zActRear + 0.0195 });
  cockPin.dispose();
  // Safety catch on the right of the tang.
  const safety = extrude(
    [
      [-0.0075, -0.0032],
      [0.009, -0.004],
      [0.0105, 0.0026],
      [-0.0075, 0.0038],
    ],
    0.0034,
    { bevel: 0.0006 }
  );
  body.add(safety, 'steel', { x: 0.0142, y: bore + 0.0075, z: zActRear - 0.014, ry: Math.PI / 2 });
  safety.dispose();

  /* ---- chassis: magwell, guard, grip, forend ---------------------------- */
  const chassisTop = bore - rAction - 0.004;
  const chassis = box(0.0345, 0.031, 0.164, 0.0018, 2);
  body.add(chassis, 'alu', { y: chassisTop - 0.0155, z: -0.018 });
  chassis.dispose();

  const magW = 0.0288;
  const magD = 0.087;
  const wellH = 0.03;
  const well = extrude(roundRect(magW + 0.0035, magD + 0.0035, 0.005, 4), wellH, {
    bevel: 0.0012,
    holes: [roundRect(magW - 0.0018, magD - 0.0018, 0.004, 4)],
  });
  body.add(well, 'alu', { y: chassisTop - 0.0245, z: magZ, rx: Math.PI / 2 + magTilt });
  well.dispose();
  const liner = extrude(roundRect(magW - 0.002, magD - 0.002, 0.004, 4), wellH - 0.004, {
    bevel: 0.0005,
    holes: [roundRect(magW - 0.006, magD - 0.006, 0.003, 4)],
  });
  body.add(liner, 'cavity', { y: chassisTop - 0.0245, z: magZ, rx: Math.PI / 2 + magTilt });
  liner.dispose();
  const flare = extrude(roundRect(magW + 0.009, magD + 0.009, 0.006, 4), 0.007, {
    bevel: 0.0013,
    holes: [roundRect(magW + 0.001, magD + 0.001, 0.004, 4)],
  });
  body.add(flare, 'alu', { y: chassisTop - 0.0385, z: magZ + 0.0012, rx: Math.PI / 2 + magTilt });
  flare.dispose();
  // Ambidextrous mag release paddles either side of the well.
  for (const sx of [-1, 1]) {
    const paddle = extrude(
      [
        [-0.009, -0.0042],
        [0.01, -0.005],
        [0.011, 0.0042],
        [-0.009, 0.005],
      ],
      0.004,
      { bevel: 0.0006 }
    );
    body.add(paddle, 'alu', { x: sx * 0.0182, y: chassisTop - 0.026, z: magZ + magD * 0.5 + 0.005, ry: Math.PI / 2 });
    paddle.dispose();
  }

  // Trigger guard: a separate bolt-on bow, as a chassis has.
  const guardOuter = [
    [-0.03, 0],
    [0.03, 0],
    [0.032, -0.007],
    [0.028, -0.0235],
    [0.017, -0.029],
    [-0.022, -0.029],
    [-0.03, -0.022],
  ];
  const guardInner = [
    [-0.0245, -0.0035],
    [0.0245, -0.0035],
    [0.0262, -0.0095],
    [0.0222, -0.0215],
    [0.0142, -0.0248],
    [-0.0182, -0.0248],
    [-0.0245, -0.0195],
  ];
  const guard = extrude(guardOuter, 0.0182, { bevel: 0.0012, bevelSegments: 2, holes: [guardInner] });
  guard.rotateY(Math.PI / 2);
  body.add(guard, 'alu', { y: chassisTop - 0.0305, z: -0.012 });
  guard.dispose();

  addPistolGrip(body, 'polymer', 'rubber', {
    y: gripY,
    z: gripZ,
    angle: gripAngle,
    len: 0.112,
    w: 0.032,
  });

  /**
   * FOREND — a squared aluminium tube with M-LOK slots, free-floating a heavy
   * barrel. Square, not round: it is the flat-bottomed section a rifle rides a
   * bag on, and it is the reason this weapon's front end does not read like the
   * carbines' 8-sided slatted tubes.
   */
  const feLen = feZ0 - feZ1;
  const feSection = [
    [-0.0215, 0.0165],
    [-0.0235, 0.006],
    [-0.0235, -0.0125],
    [-0.0195, -0.0195],
    [-0.011, -0.0225],
    [0.011, -0.0225],
    [0.0195, -0.0195],
    [0.0235, -0.0125],
    [0.0235, 0.006],
    [0.0215, 0.0165],
    [0.0105, 0.0205],
    [-0.0105, 0.0205],
  ];
  const forend = extrude(feSection, feLen, { bevel: 0.0018, bevelSegments: 2, curveSegments: 4 });
  body.add(forend, 'alu', { y: bore - 0.0035, z: (feZ0 + feZ1) / 2 });
  forend.dispose();
  // A real bore down the middle so the barrel is free-floated, not embedded.
  const feBore = tubeZ(0.0182, 0.0152, feLen - 0.006, 20, 0.0004);
  body.add(feBore, 'cavity', { y: bore, z: (feZ0 + feZ1) / 2 });
  feBore.dispose();
  /**
   * NO FULL-LENGTH TOP RAIL over the forend, on purpose. A 200 mm Picatinny
   * deck running from the action to the muzzle end is the single loudest AR
   * cue there is, and with one fitted this weapon read as a long-barrelled
   * AR-10 in every capture. A precision chassis carries its optic on the
   * ACTION rail and leaves most of the forend's spine as a flat machined top
   * with an M-LOK row — which is what is here, and what makes the front end
   * read as a bolt gun's.
   *
   * What it does keep is a 70 mm section at the REAR, butted up against the
   * action rail across the chassis joint, because the front scope ring lands at
   * z = -0.142 and has to be bolted to something.
   */
  addRail(body, 'alu', feZ0 - 0.07, feZ0 - 0.002, railTop);
  // M-LOK slots down both flanks and the belly.
  const slotGeo = mlokSlot(0.028, 0.0075, 0.002);
  slotGeo.rotateY(Math.PI / 2);
  for (let s = 0; s < 4; s++) {
    const sz = feZ0 - 0.034 - s * 0.04;
    if (sz < feZ1 + 0.018) break;
    for (const [sx, sy, rz] of [
      [-0.0236, 0.0, Math.PI],
      [0.0236, 0.0, 0],
      [0, -0.0226, -Math.PI / 2],
    ]) {
      body.add(slotGeo, 'alu', { x: sx, y: bore - 0.0035 + sy, z: sz, rz });
      const pocket = box(0.0013, 0.0055, 0.0248, 0.0002, 1);
      body.add(pocket, 'cavity', { x: sx * 0.94, y: bore - 0.0035 + sy * 0.94, z: sz, rz });
      pocket.dispose();
    }
  }
  slotGeo.dispose();
  addQdSocket(body, 'alu', 'steel', -0.0236, bore - 0.012, feZ0 - 0.024, 'x', 0.005);
  addSlingLoop(body, 'steel', 0, bore - 0.0255, feZ1 + 0.02, 0.0075, {
    rx: Math.PI / 2,
    ry: Math.PI / 2,
  });

  /* ---- barrel + brake --------------------------------------------------- */
  /**
   * Cerakoted, like the action — see the note there. 185 mm of this barrel is
   * exposed ahead of the forend, more bare cylinder than any other weapon here
   * shows, and no metal finish survives that much unbroken curvature pointed at
   * the viewmodel key.
   */
  addBarrel(body, 'steel_enamel', 'cavity', {
    y: bore,
    zBreech: -0.105,
    zMuzzle: zBarrelEnd,
    rChamber: 0.0172,
    rBarrel,
    rGas: rBarrel,
    gasAt: -0.42,
    knurl: false,
  });
  /**
   * FLUTES. A heavy barrel is 26 mm of unbroken steel for 400 mm and it renders
   * as one long featureless cylinder with a single specular stripe down it —
   * the "no flat/untextured surfaces" rule applied to a barrel. Six real flutes
   * cut into it break that stripe into six, and they are what says "precision
   * barrel" rather than "pipe".
   *
   * They run z = -0.325 .. -0.475, i.e. ON THE EXPOSED SECTION. Centred on the
   * barrel's own midpoint they sat almost entirely inside the forend, which is
   * the whole of "the flutes are modelled and you cannot see one of them".
   */
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 12;
    const flute = box(0.0064, 0.004, 0.15, 0.0009, 2);
    flute.translate(0, rBarrel - 0.0013, 0);
    flute.rotateZ(a);
    body.add(flute, 'cavity', { y: bore, z: -0.4 });
    flute.dispose();
  }
  for (const bz of [-0.322, -0.478]) {
    const band = latheZ(
      [
        [bz - 0.003, rBarrel * 0.98],
        [bz - 0.003, rBarrel + 0.0007],
        [bz + 0.003, rBarrel + 0.0007],
        [bz + 0.003, rBarrel * 0.98],
      ],
      18
    );
    body.add(band, 'steel_enamel', { y: bore });
    band.dispose();
  }
  const muzzle = addMuzzleDevice(body, 'steel_soot', 'cavity', 'comp', zBarrelEnd, rBarrel, bore);
  const muzzleKnurl = knurlBand(rBarrel + 0.0008, 0.014, 26, 0.00032, 3);
  body.add(muzzleKnurl, 'steel_enamel', { y: bore, z: zBarrelEnd + 0.012 });
  muzzleKnurl.dispose();

  /* ---- bipod, folded ---------------------------------------------------- */
  /**
   * Folded rather than deployed: a deployed bipod on a shouldered viewmodel
   * points its feet straight into the lower third of the frame and reads as two
   * spikes growing out of the barrel. Folded back along the belly of the forend
   * it does what a bipod actually does when the rifle is up.
   */
  const bipodHub = blob(0.026, 0.014, 0.03, 0.004, 3);
  body.add(bipodHub, 'alu', { y: bore - 0.0295, z: feZ1 + 0.026 });
  bipodHub.dispose();
  addPin(body, 'steel', 0, bore - 0.0305, feZ1 + 0.03, 0.0026, 0.028);
  for (const sx of [-1, 1]) {
    const leg = rodZ(0.0046, 0.0038, 0.088, 10, 0.0005);
    body.add(leg, 'alu', { x: sx * 0.0135, y: bore - 0.0345, z: feZ1 + 0.068, rx: 0.06, rz: sx * 0.05 });
    leg.dispose();
    const foot = blob(0.008, 0.0065, 0.012, 0.0025, 2);
    body.add(foot, 'rubber', { x: sx * 0.0142, y: bore - 0.0375, z: feZ1 + 0.11 });
    foot.dispose();
    const legSpring = latheZ(
      [
        [0, 0.0052],
        [0, 0.0062],
        [0.012, 0.0062],
        [0.012, 0.0052],
      ],
      10
    );
    body.add(legSpring, 'steel', { x: sx * 0.0135, y: bore - 0.0335, z: feZ1 + 0.034 });
    legSpring.dispose();
  }

  /* ---- chassis buttstock ------------------------------------------------ */
  /**
   * A skeleton chassis stock: a spine from the tang to the butt, an adjustable
   * cheek riser on two posts, a hooked butt plate with a rubber pad and a
   * length-of-pull spacer stack. Open in the middle, so the silhouette is a
   * frame rather than a slab — which is the whole visual difference between a
   * chassis rifle and a hunting rifle.
   */
  const spineTop = box(0.0285, 0.0195, 0.24, 0.002, 2);
  body.add(spineTop, 'alu', { y: bore + 0.0075, z: buttZ - 0.122, rx: 0.035 });
  spineTop.dispose();
  const spineBot = box(0.0275, 0.019, 0.192, 0.002, 2);
  body.add(spineBot, 'alu', { y: bore - 0.0445, z: buttZ - 0.1, rx: -0.06 });
  spineBot.dispose();
  const spineWeb = box(0.019, 0.046, 0.042, 0.002, 2);
  body.add(spineWeb, 'alu', { y: bore - 0.019, z: zActRear + 0.032 });
  spineWeb.dispose();
  // Lightening cuts through the web, so the frame reads as machined rather than
  // as a slab with a hole missing.
  for (const cz of [buttZ - 0.062, buttZ - 0.108]) {
    const cut = box(0.0295, 0.021, 0.026, 0.003, 2);
    body.add(cut, 'cavity', { y: bore - 0.019, z: cz });
    cut.dispose();
  }
  const strut = box(0.017, 0.0135, 0.056, 0.0018, 2);
  body.add(strut, 'alu', { y: bore - 0.019, z: buttZ - 0.085, rx: 0.0 });
  strut.dispose();
  // Cheek riser on two posts, with its adjustment thumbwheel.
  for (const sx of [-1, 1]) {
    const post = rodZ(0.0034, 0.0034, 0.024, 10, 0.0004);
    post.rotateX(Math.PI / 2);
    body.add(post, 'steel', { x: sx * 0.0075, y: bore + 0.02, z: buttZ - 0.15 + (sx > 0 ? 0.055 : 0) });
    post.dispose();
  }
  const riser = blob(0.033, 0.018, 0.112, 0.006, 3);
  body.add(riser, 'polymer', { y: bore + 0.0335, z: buttZ - 0.122, rx: 0.03 });
  riser.dispose();
  const riserWheel = latheZ(
    [
      [0, 0],
      [0, 0.0068],
      [0.0022, 0.0075],
      [0.0055, 0.0075],
      [0.0055, 0],
    ],
    14
  );
  body.add(riserWheel, 'alu', { x: 0.0158, y: bore + 0.021, z: buttZ - 0.152, ry: Math.PI / 2 });
  riserWheel.dispose();
  // Butt plate: a hooked toe, the pad, and the spacer stack behind it.
  const buttPlate = extrude(
    [
      [-0.0075, 0.03],
      [0.006, 0.031],
      [0.007, 0.006],
      [0.019, -0.016],
      [0.018, -0.028],
      [0.004, -0.03],
      [-0.0075, -0.012],
    ],
    0.042,
    { bevel: 0.0018, bevelSegments: 2 }
  );
  buttPlate.rotateY(Math.PI / 2);
  body.add(buttPlate, 'alu', { y: bore - 0.006, z: buttZ - 0.012 });
  buttPlate.dispose();
  const pad = blob(0.042, 0.058, 0.011, 0.0045, 3);
  body.add(pad, 'rubber', { y: bore - 0.004, z: buttZ - 0.001, rx: 0.05 });
  pad.dispose();
  for (let i = 0; i < 4; i++) {
    const g = box(0.04, 0.0032, 0.0045, 0.0011, 2);
    body.add(g, 'rubber', { y: bore + 0.018 - i * 0.0125, z: buttZ + 0.0042, rx: 0.05 });
    g.dispose();
  }
  const monopod = latheZ(
    [
      [0, 0],
      [0, 0.0075],
      [0.0026, 0.0082],
      [0.011, 0.0082],
      [0.011, 0],
    ],
    14
  );
  body.add(monopod, 'alu', { y: bore - 0.055, z: buttZ - 0.026, rx: -Math.PI / 2 });
  monopod.dispose();
  addQdSocket(body, 'alu', 'steel', -0.0122, bore - 0.038, buttZ - 0.084, 'x', 0.005);

  addRollmark(body, 'cavity', { x: -rAction - 0.0002, y: bore - 0.008, z: 0.046, h: 0.0036 });

  /* ---- the scope -------------------------------------------------------- */
  const scope = buildScope(body, { y: opticY, z: opticZ, railTop });

  /* ---- moving parts ----------------------------------------------------- */
  const magazine = new Assembly('sniper-mag');
  /**
   * A 5-round AICS-pattern box: short, deep and nearly straight, because a
   * rimless full-power cartridge stacks almost vertically. `witness: 0` — a
   * steel-bodied precision magazine has no witness holes.
   */
  const mag = buildMagazine(magazine, null, {
    w: 0.0272,
    d: 0.0855,
    len: 0.078,
    curve: 0.004,
    segs: 4,
    witness: 0,
    caseLen: 0.0512,
    rimR: 0.006,
    bulletLen: 0.0305,
    poly: 'polymer',
  });

  /**
   * The BOLT HANDLE, as the `charging` part. A bolt gun has no charging handle,
   * and this is the equivalent: the reload/inspect timelines already reach for
   * `chargeRest` and pull along `chargePull`, so routing the bolt through them
   * makes the empty reload work the action — which is exactly right here and
   * costs no new machinery.
   */
  const charging = new Assembly('sniper-bolt-handle');
  const bhParts = [];
  const bhStem = rodZ(0.0044, 0.0042, 0.026, 10, 0.0005);
  bhStem.rotateY(Math.PI / 2);
  bhStem.rotateX(0);
  bhStem.translate(0.013, 0, 0);
  bhParts.push(bhStem);
  const bhKnob = latheZ(
    [
      [0, 0],
      [0, 0.0058],
      [0.0022, 0.0072],
      [0.008, 0.0088],
      [0.0145, 0.0088],
      [0.0195, 0.0068],
      [0.0195, 0],
    ],
    16
  );
  bhKnob.rotateY(-Math.PI / 2);
  bhKnob.translate(-0.026, 0, 0);
  bhParts.push(bhKnob);
  const bhG = mergeAll(bhParts);
  // Swept down and rearward, the way a tactical bolt handle is.
  bhG.rotateZ(-0.42);
  bhG.rotateX(0.22);
  charging.add(bhG, 'steel_black', {});
  bhG.dispose();
  const bhKnurl = knurlBand(0.009, 0.008, 22, 0.0003, 3);
  bhKnurl.rotateY(Math.PI / 2);
  bhKnurl.translate(0.0345, -0.0142, 0.0035);
  charging.add(bhKnurl, 'steel_black', {});
  bhKnurl.dispose();

  const bolt = new Assembly('sniper-bolt');
  const boltBody = latheZ(
    [
      [0, 0.006],
      [0, 0.0142],
      [0.0035, 0.0148],
      [0.106, 0.0148],
      [0.11, 0.0138],
      [0.11, 0.006],
    ],
    18
  );
  bolt.add(boltBody, 'steel_bright', { z: -0.11 });
  boltBody.dispose();
  // Three locking lugs at the head, visible through the open port.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const lugG = box(0.0055, 0.0042, 0.012, 0.0006, 1);
    lugG.translate(0, 0.0158, 0);
    lugG.rotateZ(a);
    bolt.add(lugG, 'steel_bright', { z: -0.105 });
    lugG.dispose();
  }
  const chamberRound = cartridge(0.0512, 0.006, 0.0305);
  bolt.add(chamberRound.brass, 'brass', { z: -0.112, ry: Math.PI });
  chamberRound.brass.dispose();
  chamberRound.bullet.dispose();

  const trigger = new Assembly('sniper-trigger');
  const trg = triggerPart('steel_bright');
  trigger.add(trg.geo, 'steel_bright', {});
  trg.geo.dispose();
  // The trigger shoe of a match trigger: a wide flat blade.
  const shoe = box(0.0095, 0.0025, 0.0105, 0.0004, 1);
  trigger.add(shoe, 'steel_black', { y: -0.0155, z: 0.0032 });
  shoe.dispose();

  return {
    id: 'sniper',
    label: 'M91-SR',
    fxClass: 'sniper',
    body,
    moving: { magazine, charging, bolt, trigger },
    nodes: {
      muzzle: [0, bore, muzzle.crownZ],
      chamber: [0, bore, portZ],
      eject: [rAction + 0.007, bore + 0.004, portZ],
      ejectDir: [0.9, 0.38, 0.2],
      sight: [0, opticY, scope.lensZ],
      sightAxis: [0, 0, -1],
      ironSight: [0, railTop + 0.03, 0.04],
      /**
       * SHOOTING HAND — derived exactly as models/rifle.js's is, then carried
       * across this weapon's shallower grip rake (0.34 against the M4's 0.38)
       * by rotating both hand axes about X by the 0.04 rad difference. The
       * knuckle contact is grip origin + 36.3 mm down the grip axis + 13.1 mm
       * toward the back strap + 30.5 mm outboard (half the 32 mm grip section
       * plus a 14.5 mm palm, so the glove buries 1.5 mm and leaves no
       * daylight): (0.0305, 0.0002, 0.0385). Targets are WRISTS, so the value
       * below is that contact minus 0.098 along `finger`.
       */
      /**
       * SEARCHED against the real contact solve — see tools/gripfit.mjs.
       *
       * These were copied from the M4's gripR, and the M4's gripR was broken:
       * the index fingertip landed on the grip and the other three finished
       * 15.2, 16.8 and 23.3 mm away from it, so the hand rested one finger on the
       * weapon and held the rest in the air. The M4 was fixed by search rather
       * than by derivation; the same search closes this one to
       * [0.3, 0.4, 0.4, 0.4] mm.
       */
      /**
       * SEARCHED with a WRIST CONSTRAINT — see tools/gripfit.mjs.
       *
       * The previous values closed every fingertip on the grip and the hand
       * still looked wrong, because contact says nothing about how the hand
       * meets the ARM. Measured: this wrist sat at 59.7 degrees. A human
       * wrist manages about 70 of flexion and 60 of extension at the very
       * extreme and a firing grip lives around 15-35, so that was not a grip,
       * it was a fracture — and it is what "意味のわからない手首の曲がり方"
       * describes.
       *
       * Now 40.3 degrees, with every fingertip still within 0.7 mm AND on
       * the grip's authored Z span. That last clause matters: the solve's own
       * `gapAt` measures perpendicular distance to an INFINITE cylinder, so the
       * first wrist-aware search "fixed" the wrist by sliding the hand off the
       * bottom of the grip into the air under the magwell — all four fingers
       * reported in contact and the captured frame had no hand on the weapon at
       * all. The span is part of the score now.
       */
      gripR: {
        pos: [0.0556, -0.0493, 0.1022],
        finger: [-0.2469, 0.2579, -0.9341],
        back: [0.9988, 0.0284, 0.0411],
      },
      /**
       * The pistol grip as a cylinder, for Viewmodel._fitShootingHand: a point
       * on the raked centreline 36 mm below the grip's top, the rake direction
       * (0, -cos 0.34, sin 0.34), and half the 32 mm section plus the 1.2 mm
       * rubber over-mould the palm actually touches.
       */
      gripCylinder: {
        axis: [0, -0.0042, 0.0261],
        dir: [0, -0.9428, 0.3335],
        r: 0.0172,
        z0: 0.075,
        z1: -0.01,
      },
      /**
       * SUPPORT HAND — under the forend, at the rear of it and behind the
       * folded bipod, with the same construction models/rifle.js derives:
       * contact clock angle 250 deg, `finger` the tangent there rolled 0.30 rad
       * forward, `back` the surface normal tilted 0.62 rad rearward, and the
       * knuckle line 8.6 mm off the surface so a 16 mm half-palm squeezes into
       * it. `pos` is that contact minus 0.098 along `finger`, because the rig's
       * hand targets are wrists.
       */
      /**
       * SEARCHED, wrist- reach- and span-constrained — see tools/gripfit.mjs.
       *
       * The fingertips were already on the handguard (0.1-0.4 mm) and the hand
       * still looked wrong, because the WRIST was at 67.3 degrees. A human
       * wrist manages ~70 of flexion at the extreme; a support grip lives around
       * 15-35. Now 34.6 degrees, fingertips within 0.7 mm, still on the
       * handguard's authored span, and arm extension 0.773 -> 0.88 so the
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
        pos: [0.0193, -0.0037, -0.1635],
        finger: [0.2817, 0.8719, -0.4006],
        back: [0.8046, -0.4934, 0.3304],
      },
      /**
       * The forend's collision profile. The real section is a 47 x 43 mm
       * squared tube, so this is the inscribed-ish radius rather than the
       * circumscribed one: the fingertips come out slightly BURIED at the
       * corners and flush on the flats, which is the direction the error has to
       * go — daylight between a glove and the forend is visible, 2 mm of
       * squeeze is not.
       */
      handguard: {
        axis: [0, feAxisY, 0],
        dir: [0, 0, 1],
        r: feR,
        z0: feZ0,
        z1: feZ1,
      },
      magSeat: { pos: [0, chassisTop - 0.0125, magZ], rot: [magTilt, 0, 0] },
      magDrop: [0, -0.42, 0.03],
      chargeRest: { pos: [rAction - 0.004, bore + 0.002, portZ + 0.052], rot: [0, 0, 0] },
      chargePull: [0, 0, 0.072],
      boltRest: { pos: [0, bore, 0.052], rot: [0, 0, 0] },
      boltTravel: [0, 0, 0.072],
      triggerPivot: { pos: [0, chassisTop - 0.0285, -0.0075], rot: [0, 0, 0] },
      triggerPull: -0.3,
      opticGlass: scope,
    },
    shell: { caseLen: 0.0512, rimR: 0.006 },
    magSize: { len: mag.len, w: mag.w, d: mag.d },
  };
}

/**
 * A variable-power rifle scope, built centred on (0, o.y, o.z).
 *
 * THE APERTURE BUDGET, the same one models/../parts.js buildOptic derives at
 * length: looking down a tube from a fixed eye, the sight picture is the
 * SMALLER of the ocular bore subtended at the eye relief and the objective bore
 * subtended at (relief + length). Balance them or the frame vignettes down to a
 * porthole. With the eye relief this weapon ships (90 mm, defs.js) and a 132 mm
 * body:
 *   ocular    0.0150 / 0.115 -> 0.1304 rad
 *   objective 0.0335 / 0.299 -> 0.1120 rad
 * i.e. the objective is the stop by 14%, so the sight picture is 86% of the
 * exit pupil and there is no second concentric ring worth seeing. That is also
 * *why* the objective bell is 74 mm across: on a 184 mm body nothing smaller
 * can keep up with the ocular, and it happens to be exactly the proportion that
 * makes a scope read as a scope from the side.
 */
function buildScope(asm, o) {
  const y = o.y;
  const z = o.z;
  const railTop = o.railTop;

  const SEG = 64;
  const SEG_IN = 72;

  const rTube = 0.019; // 38 mm main tube
  const rOc = 0.025; // ocular bell, 50 mm
  const rOb = 0.037; // objective bell, 74 mm
  const rBoreOc = 0.015;
  const rBoreOb = 0.0335;
  const zOc = 0.092; // rear-most point of the ocular bell
  const zOb = -0.092; // front-most point of the objective bell

  /**
   * One lathe for the whole body, so the tube, both bells and every shoulder
   * between them share a silhouette with no seams: ocular bell -> power ring
   * shoulder -> 34 mm tube -> saddle shoulder -> tube -> objective taper ->
   * objective bell. Every rim carries a 0.3-0.5 mm chamfer face, which is the
   * only thing on a curved silhouette that can catch a specular line.
   */
  const shell = latheZ(
    [
      [zOb, rBoreOb * 0.995],
      [zOb, rOb * 1.005],
      [zOb + 0.0025, rOb],
      [zOb + 0.04, rOb],
      [zOb + 0.046, rOb * 0.98],
      [zOb + 0.07, rTube * 1.14],
      [zOb + 0.078, rTube * 1.02],
      [zOb + 0.084, rTube],
      [zOc - 0.068, rTube],
      [zOc - 0.062, rTube * 1.05],
      [zOc - 0.04, rTube * 1.07],
      [zOc - 0.034, rOc * 0.95],
      [zOc - 0.026, rOc],
      [zOc - 0.005, rOc],
      [zOc - 0.0015, rOc * 0.97],
      [zOc, rOc * 0.93],
      [zOc, rBoreOc * 1.02],
    ],
    SEG
  );
  asm.add(shell, 'alu_fine', { y, z });
  shell.dispose();

  /**
   * TURRET SADDLE — the boxy swelling in the middle of the tube that carries
   * all three adjusters. Without it the turrets grow straight out of a 38 mm
   * pipe and the scope reads as a length of tube with knobs glued on.
   *
   * IT HAS A HOLE THROUGH IT, and that is not a detail. As a solid `blob` — a
   * 48 x 48 x 62 mm rounded box centred ON the optical axis — it PLUGGED THE
   * BORE: its front face sat 162 mm from the eye in ADS, opaque and
   * depth-writing, so the sight picture was a flat dark disc of the saddle's
   * own interior and the collimated reticle, which lives at 198 mm, was
   * depth-rejected and never drawn at all. Measured by hiding the weapon meshes
   * and watching the dot appear.
   *
   * So it is an extrusion with a 19.2 mm circular hole down it — 0.2 mm proud
   * of the tube's outer wall, so the two surfaces do not z-fight.
   */
  const saddle = extrude(roundRect(0.048, 0.048, 0.008, 3), 0.062, {
    bevel: 0.0016,
    bevelSegments: 2,
    holes: [roundRect(0.0384, 0.0384, 0.0192, 8)],
  });
  asm.add(saddle, 'alu_fine', { y, z: z + 0.006 });
  saddle.dispose();

  /**
   * Turrets: a tall capped ELEVATION turret on top, a WINDAGE turret on the
   * right and a side PARALLAX knob on the left. Each is a knurled drum on a
   * skirt with engraved click marks — modelled as real recessed geometry in the
   * part's own space, not a decal, for the same reason the rollmarks are: the
   * viewmodel translates and rotates every frame and anything sampled in world
   * space swims.
   */
  const turretTall = (() => {
    const parts = [];
    parts.push(
      latheZ(
        [
          [0, 0.0095],
          [0.003, 0.0112],
          [0.0075, 0.0112],
          [0.008, 0.0102],
          [0.026, 0.0102],
          [0.0285, 0.0118],
          [0.0335, 0.0118],
          [0.0345, 0.0104],
          [0.0345, 0],
        ],
        28
      )
    );
    parts.push(knurlBand(0.0106, 0.014, 28, 0.00034, 4).translate(0, 0, 0.0165));
    parts.push(knurlBand(0.0122, 0.0044, 24, 0.0003, 2).translate(0, 0, 0.0308));
    return mergeAll(parts);
  })();
  const turretLow = (() => {
    const parts = [];
    parts.push(
      latheZ(
        [
          [0, 0.0092],
          [0.003, 0.0108],
          [0.007, 0.0108],
          [0.0075, 0.0098],
          [0.019, 0.0098],
          [0.0205, 0.0112],
          [0.0235, 0.0112],
          [0.0245, 0.0098],
          [0.0245, 0],
        ],
        26
      )
    );
    parts.push(knurlBand(0.0102, 0.0105, 26, 0.00032, 3).translate(0, 0, 0.013));
    return mergeAll(parts);
  })();
  const marks = (() => {
    const parts = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const long = i % 4 === 0;
      const h = long ? 0.0032 : 0.0017;
      const t = box(0.0004, h, 0.0007, 0.0001, 1);
      t.rotateZ(a);
      t.translate(Math.cos(a) * (0.0102 - h * 0.45), Math.sin(a) * (0.0102 - h * 0.45), 0);
      parts.push(t);
    }
    return mergeAll(parts);
  })();
  const elev = { y: y + 0.0215, z: z + 0.006, rx: -Math.PI / 2 };
  const wind = { x: 0.0215, y, z: z + 0.006, ry: Math.PI / 2 };
  const para = { x: -0.0215, y, z: z + 0.006, ry: -Math.PI / 2 };
  asm.add(turretTall, 'alu_fine', elev);
  asm.add(turretLow, 'alu_fine', wind);
  asm.add(turretLow, 'alu_fine', para);
  asm.add(marks, 'cavity', { ...elev, y: elev.y + 0.0092 });
  asm.add(marks, 'cavity', { ...wind, x: wind.x + 0.0092 });
  asm.add(marks, 'cavity', { ...para, x: para.x - 0.0092 });
  turretTall.dispose();
  turretLow.dispose();
  marks.dispose();

  /**
   * MAGNIFICATION RING with a throw lever — the detail that says "variable
   * power". The ring is a knurled collar just ahead of the ocular bell; the
   * lever is the stubby arm sticking out of it at 4 o'clock.
   */
  const powerRing = latheZ(
    [
      [zOc - 0.06, rTube * 1.02],
      [zOc - 0.06, rTube * 1.15],
      [zOc - 0.037, rTube * 1.15],
      [zOc - 0.037, rTube * 1.02],
    ],
    SEG
  );
  asm.add(powerRing, 'alu_fine', { y, z });
  powerRing.dispose();
  const ringKnurl = knurlBand(rTube * 1.16, 0.02, 34, 0.00034, 4);
  asm.add(ringKnurl, 'alu_fine', { y, z: z + zOc - 0.0485 });
  ringKnurl.dispose();
  const lever = extrude(
    [
      [-0.0038, 0],
      [0.0038, 0],
      [0.003, 0.019],
      [-0.003, 0.019],
    ],
    0.0075,
    { bevel: 0.0008 }
  );
  asm.add(lever, 'polymer', {
    x: 0.0128,
    y: y - 0.0128,
    z: z + zOc - 0.039,
    rz: 2.36,
  });
  lever.dispose();
  const leverKnob = dome(0.0042, 10, 0.9);
  asm.add(leverKnob, 'polymer', { x: 0.0258, y: y - 0.0258, z: z + zOc - 0.0485 });
  leverKnob.dispose();

  /* ---- the optical train ------------------------------------------------ */
  /**
   * Interior: a light trap that OPENS toward the objective, so the wall is seen
   * at a shallow angle from the eye and occupies a thin annulus instead of a
   * wide band of lit tube. `optic_tube`, not `cavity` — see
   * WeaponMaterials.opticTube for why a pure black hole reads as a drilled
   * hole and a 0.02-linear trap reads as a bore.
   */
  const baffle = latheZ(
    [
      [zOb + 0.0018, rBoreOb],
      [zOb + 0.0018, rBoreOb * 0.985],
      [zOc - 0.0125, rBoreOc * 0.985],
      [zOc - 0.0125, rBoreOc],
    ],
    SEG_IN
  );
  asm.add(baffle, 'optic_tube', { y, z });
  baffle.dispose();

  const lensR = rBoreOc * 0.99;
  // Field stop right behind the ocular lens: the black shoulder that frames the
  // sight picture. Without it the aperture edge is lit tube wall.
  const relief = latheZ(
    [
      [0, lensR * 0.998],
      [0.0014, lensR * 1.014],
      [0.0038, rBoreOc * 1.01],
      [0.0042, rOc * 0.93],
      [0.0042, rBoreOc],
      [0, rBoreOc],
    ],
    SEG_IN
  );
  asm.add(relief, 'optic_tube', { y, z: z + zOc - 0.0052 });
  relief.dispose();

  const lensOc = latheZ(
    [
      [0, 0],
      [-0.001, lensR * 0.6],
      [-0.0016, lensR],
    ],
    SEG_IN
  );
  const lensOb = latheZ(
    [
      [0, 0],
      [-0.0018, rBoreOb * 0.58],
      [-0.0028, rBoreOb * 0.985],
    ],
    SEG_IN
  );
  asm.add(lensOb, 'glass', { y, z: z + zOb + 0.008 });
  asm.add(lensOc, 'glass', { y, z: z + zOc - 0.008, ry: Math.PI });
  lensOc.dispose();
  lensOb.dispose();
  // Hairline reflection inside the ocular rim — the cue that says there is
  // glass in the tube rather than air.
  {
    const edge = new THREE.RingGeometry(lensR * 0.965, lensR * 0.99, SEG_IN, 1);
    asm.add(edge, 'lens_ring', { y, z: z + zOc - 0.0076 });
    edge.dispose();
  }
  const vig = new THREE.CircleGeometry(lensR * 0.995, SEG_IN);
  asm.add(vig, 'lens_vig', { y, z: z + zOc - 0.0095 });
  vig.dispose();

  // Rubber eyepiece bezel: the whole rear rim of the scope is moulded rubber,
  // for the reason parts.js buildOptic documents — an aluminium annulus at 89
  // degrees of incidence lights up like chrome however dark its albedo is.
  const cup = latheZ(
    [
      [0, rBoreOc * 0.995],
      [0.0005, rBoreOc * 1.04],
      [0.0012, rOc * 0.97],
      [0.0022, rOc * 1.03],
      [0.007, rOc * 1.05],
      [0.0092, rOc * 1.035],
      [-0.005, rOc * 1.03],
      [-0.0056, rOc * 0.985],
    ],
    SEG
  );
  asm.add(cup, 'rubber', { y, z: z + zOc - 0.0015 });
  cup.dispose();
  // Objective bumper, same argument, and it is the end that faces the camera in
  // the hipfire pose.
  const obBumper = latheZ(
    [
      [0, rOb * 1.005],
      [0.0008, rOb * 1.06],
      [0.005, rOb * 1.065],
      [0.0064, rOb * 1.02],
    ],
    SEG
  );
  asm.add(obBumper, 'rubber', { y, z: z + zOb - 0.005 });
  obBumper.dispose();

  /* ---- rings ------------------------------------------------------------ */
  /**
   * TWO separate rings, not a cantilever. A 34 mm tube in a pair of split rings
   * with four cap screws each is what a precision rifle wears, and the gap
   * between them — with the rail visible through it — is a large part of the
   * scope's read from the side.
   */
  const ringH = y - rTube - railTop;
  for (const rz of [z - 0.048, z + 0.058]) {
    const base = extrude(
      [
        [-0.0132, 0],
        [0.0132, 0],
        [0.0145, -0.003],
        [0.0102, -ringH * 0.5],
        [0.0102, -ringH + 0.005],
        [0.016, -ringH + 0.002],
        [0.016, -ringH],
        [-0.016, -ringH],
        [-0.016, -ringH + 0.002],
        [-0.0102, -ringH + 0.005],
        [-0.0102, -ringH * 0.5],
        [-0.0145, -0.003],
      ],
      0.026,
      { bevel: 0.0009 }
    );
    asm.add(base, 'alu_fine', { y: y - rTube, z: rz });
    base.dispose();
    const collar = latheZ(
      [
        [-0.013, rTube],
        [-0.013, rTube + 0.0042],
        [0.013, rTube + 0.0042],
        [0.013, rTube],
      ],
      SEG
    );
    asm.add(collar, 'alu_fine', { y, z: rz });
    collar.dispose();
    /**
     * Split line and the four cap screws that close it — OUTSIDE the tube.
     *
     * They were at |x| <= 0.015 against a 19 mm bore radius, i.e. INSIDE the
     * optical path, and the ADS frame showed exactly that: a horizontal bar with
     * a bright fixture at each end lying across the middle of the sight picture.
     * Measured on the first in-game ADS capture. A split ring's parting plane is
     * at the tube's centre HEIGHT but at the ring's own radius, so both the gap
     * and the bolts belong out at |x| >= rTube.
     */
    for (const sx of [-1, 1]) {
      const split = box(0.0044, 0.0016, 0.026, 0.0003, 1);
      asm.add(split, 'cavity', { x: sx * (rTube + 0.0022), y, z: rz });
      split.dispose();
      /**
       * `screw()` is authored head-at-z=0 running to +Z, and `axis: 'x'` rotates
       * +Z onto -X for BOTH sides — so the right-hand screw's 10 mm shank ran
       * from x = +0.024 inward to x = +0.014, five millimetres inside a 19 mm
       * bore. In the ADS frame that was a bright cylinder poking into the sight
       * picture from the right, and it is the whole reason this note exists.
       * 25.5 mm out with a 4 mm shank leaves the inner end at 20.2 mm, i.e.
       * 1.2 mm clear of the tube wall on both sides.
       */
      for (const sz of [-0.0085, 0.0085]) {
        addScrew(asm, 'steel', sx * 0.0255, y, rz + sz, 0.0026, 'x', 0.004);
      }
    }
    const clampBar = box(0.03, 0.0062, 0.026, 0.0009, 1);
    asm.add(clampBar, 'alu_fine', { y: railTop + 0.001, z: rz });
    clampBar.dispose();
    addScrew(asm, 'steel', 0.0158, railTop + 0.001, rz, 0.0032, 'x', 0.012);
  }

  return {
    center: [0, y, z],
    lensZ: z + zOc - 0.008,
    apertureR: lensR * 0.94,
    tubeR: rTube,
    len: zOc - zOb,
  };
}
