import { Assembly, box, latheZ, rodZ, tubeZ, ring, extrude, dome, knurlBand, mergeAll } from '../geometry.js';
import { addPin, addScrew } from '../parts.js';

/**
 * THE OTHER THREE THINGS YOU THROW — 「グレネードに加えて閃光弾、スモークを導入して
 * もしくは感知式爆弾（レーザーが出ていて人が触れると1秒後に爆発するもの）」
 *
 *   flashbang   M84-pattern: a perforated steel can inside an open cage, so
 *               the light and the blast get out and the body does not become
 *               fragments. Reads as "not a frag" from the first frame because
 *               it is a CYLINDER and the frag is a ball.
 *   smoke       AN-M8-pattern: a smooth sheet-steel can with a crimped rim, a
 *               four-port emission head and a broad colour band. Taller and
 *               fatter than the flashbang, and painted, so the two cans are
 *               not the same silhouette either.
 *   mine        a laser tripwire mine: a wedge that sits on the floor with a
 *               sensor eye on the front face and two ground spikes. It is the
 *               only one of the three that is PLACED rather than detonated in
 *               the air, so it is the only one with a flat bottom.
 *
 * All three share the frag's grip solve verbatim — `gripCylinder`, `gripR`
 * and `gripL` are copied from models/grenade.js, which searched them with
 * tools/gripfit.mjs. That is legitimate here in a way it would not be between
 * two rifles: the hand closes on a body of the SAME 57 mm section on the SAME
 * axis at the SAME origin, and the pose is a property of that section rather
 * than of what the body is filled with. The cans are 2 mm slimmer, which the
 * per-fingertip fit at build time absorbs.
 *
 * `muzzle` is the release point, as on the frag. There is no magazine, no
 * optic and no bore, and those nodes are ABSENT rather than zeroed because the
 * viewmodel and the clip builder branch on their existence.
 */

/** The frag's searched hand solve. @see models/grenade.js for the derivation. */
const HANDS = {
  gripCylinder: { axis: [0, 0, 0], dir: [0, 0, 1], r: 0.0285, z0: 0.0285, z1: -0.0285 },
  gripR: {
    pos: [-0.0403, -0.0453, 0.029],
    finger: [-0.0451, 0.9988, -0.0168],
    back: [-0.8032, 0.2365, 0.5468],
  },
  gripL: {
    pos: [0.1121, -0.1385, 0.0555],
    finger: [0.5646, 0.4823, -0.6698],
    back: [-0.3944, 0.8703, 0.2943],
  },
  rhandPose: 'clamp',
};

/* ========================================================================== */
/*  flashbang                                                                 */
/* ========================================================================== */

/**
 * M84 STUN GRENADE. 44 mm can, 89 mm tall, held inside a hexagonal cage of six
 * uprights with a ring at each end — the cage is the whole visual identity and
 * it is why this cannot be mistaken for the smoke can at a glance.
 */
export function buildFlashbang() {
  const body = new Assembly('flashbang');
  const rCan = 0.022;
  const rCage = 0.0272;
  const z0 = -0.036;
  const z1 = 0.036;

  /* ---- inner can: perforated, so it reads as a body inside a cage -------- */
  const can = latheZ(
    [
      [0, 0],
      [0, rCan - 0.002],
      [0.0015, rCan],
      [z1 - z0 - 0.0015, rCan],
      [z1 - z0, rCan - 0.002],
      [z1 - z0, 0],
    ],
    22
  );
  body.add(can, 'steel_enamel', { z: z0 });
  can.dispose();
  /** Six rows of ports: the light leaves through these and they catch a hard
   *  dark ring each, which is what makes the can read as perforated at 0.3 m. */
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + row * 0.36;
      const hole = tubeZ(0.0042, 0.0026, 0.004, 8, 0.0002);
      hole.rotateX(Math.PI / 2);
      hole.translate(Math.cos(a) * (rCan - 0.001), Math.sin(a) * (rCan - 0.001), -0.018 + row * 0.018);
      body.add(hole, 'cavity', {});
      hole.dispose();
    }
  }

  /* ---- the cage ---------------------------------------------------------- */
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const post = box(0.0052, 0.0034, (z1 - z0) - 0.004, 0.0006, 1);
    post.translate(rCage - 0.0017, 0, 0);
    post.rotateZ(a);
    body.add(post, 'steel', {});
    post.dispose();
  }
  for (const z of [z0 + 0.004, z1 - 0.004]) {
    const hoop = ring(rCage - 0.0018, 0.0019, 20, 6);
    body.add(hoop, 'steel', { z });
    hoop.dispose();
  }

  /* ---- fuze head, lever and pin ------------------------------------------ */
  const collar = latheZ(
    [
      [0, 0],
      [0, 0.0112],
      [0.0055, 0.0112],
      [0.0075, 0.009],
      [0.0075, 0],
    ],
    16
  );
  body.add(collar, 'steel_bright', { z: z1 });
  collar.dispose();
  const striker = rodZ(0.0072, 0.0068, 0.007, 14, 0.0005);
  body.add(striker, 'steel_bright', { z: z1 + 0.0105 });
  striker.dispose();
  // Safety lever down the +X flank, standing off the cage.
  const lever = extrude(
    [
      [-0.0042, 0],
      [0.0042, 0],
      [0.0042, -0.072],
      [0, -0.0782],
      [-0.0042, -0.072],
    ],
    0.0022,
    { bevel: 0.0005 }
  );
  body.add(lever, 'steel_bright', { x: rCage + 0.0026, y: 0, z: z1 + 0.0105, ry: Math.PI / 2, rz: Math.PI / 2 });
  lever.dispose();

  const pinAsm = new Assembly('flashbang-pin');
  const pinRing = ring(0.0049, 0.0011, 16, 6);
  pinAsm.add(pinRing, 'steel_bright', { x: -0.0012, y: 0.0142, z: z1 + 0.008, rx: Math.PI / 2 });
  pinRing.dispose();
  addPin(pinAsm, 'steel_bright', 0, 0.006, z1 + 0.008, 0.0011, 0.017);

  return {
    id: 'flashbang',
    label: 'M84',
    fxClass: 'melee',
    wearScale: { steel: 0.4, steel_enamel: 0.26, steel_bright: 0.5 },
    body,
    moving: { pin: pinAsm },
    nodes: { muzzle: [0, 0, 0], ...HANDS },
  };
}

/* ========================================================================== */
/*  smoke                                                                     */
/* ========================================================================== */

/**
 * AN-M8 SMOKE CAN. 64 mm across, 145 mm tall — the biggest thing in the
 * loadout that is not a rifle, and deliberately so: a smoke grenade that reads
 * as a frag is a smoke grenade the player throws by mistake.
 */
export function buildSmokeGrenade() {
  const body = new Assembly('smoke');
  const rCan = 0.028;
  const z0 = -0.05;
  const z1 = 0.05;

  const can = latheZ(
    [
      [0, 0],
      [0, rCan - 0.0035],
      [0.0022, rCan - 0.0008],
      [0.006, rCan],
      [z1 - z0 - 0.006, rCan],
      [z1 - z0 - 0.0022, rCan - 0.0008],
      [z1 - z0, rCan - 0.0035],
      [z1 - z0, 0],
    ],
    26
  );
  body.add(can, 'enamel_od', { z: z0 });
  can.dispose();
  // Crimped rims, top and bottom: the seam a rolled sheet-steel can has.
  for (const z of [z0 + 0.0045, z1 - 0.0045]) {
    const rim = ring(rCan - 0.0006, 0.0016, 24, 6);
    body.add(rim, 'steel_enamel', { z });
    rim.dispose();
  }
  /** The colour band — the only marking that matters on a smoke can, because
   *  it is what says which smoke is inside it. */
  const band = latheZ(
    [
      [0, rCan + 0.0004],
      [0.016, rCan + 0.0004],
    ],
    26
  );
  body.add(band, 'polymer_tan', { z: 0.012 });
  band.dispose();

  /* ---- emission head: four ports round the fuze -------------------------- */
  const head = latheZ(
    [
      [0, 0],
      [0, 0.014],
      [0.006, 0.014],
      [0.008, 0.0108],
      [0.008, 0],
    ],
    18
  );
  body.add(head, 'steel_enamel', { z: z1 });
  head.dispose();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const port = tubeZ(0.0046, 0.0031, 0.006, 10, 0.0003);
    port.translate(Math.cos(a) * 0.0165, Math.sin(a) * 0.0165, z1 + 0.0025);
    body.add(port, 'cavity', {});
    port.dispose();
  }
  const striker = rodZ(0.0068, 0.0064, 0.0075, 14, 0.0005);
  body.add(striker, 'steel_bright', { z: z1 + 0.0105 });
  striker.dispose();
  const lever = extrude(
    [
      [-0.0042, 0],
      [0.0042, 0],
      [0.0042, -0.086],
      [0, -0.0925],
      [-0.0042, -0.086],
    ],
    0.0022,
    { bevel: 0.0005 }
  );
  body.add(lever, 'steel_bright', { x: rCan + 0.0028, y: 0, z: z1 + 0.0105, ry: Math.PI / 2, rz: Math.PI / 2 });
  lever.dispose();

  const pinAsm = new Assembly('smoke-pin');
  const pinRing = ring(0.0049, 0.0011, 16, 6);
  pinAsm.add(pinRing, 'steel_bright', { x: -0.0012, y: 0.0142, z: z1 + 0.008, rx: Math.PI / 2 });
  pinRing.dispose();
  addPin(pinAsm, 'steel_bright', 0, 0.006, z1 + 0.008, 0.0011, 0.017);

  return {
    id: 'smoke',
    label: 'M8-HC',
    fxClass: 'melee',
    wearScale: { enamel_od: 0.3, steel_enamel: 0.26, steel_bright: 0.5, polymer_tan: 0.35 },
    body,
    moving: { pin: pinAsm },
    nodes: { muzzle: [0, 0, 0], ...HANDS },
  };
}

/* ========================================================================== */
/*  proximity mine                                                            */
/* ========================================================================== */

/**
 * THE LASER TRIPWIRE MINE — 「感知式爆弾（レーザーが出ていて人が触れると1秒後に
 * 爆発するもの）」.
 *
 * A wedge, because it is the only one of the four throwables that comes to
 * REST on a floor and stays there: a flat base and a face raked back 20
 * degrees so the sensor eye looks slightly upward at chest height across a
 * doorway. Two ground spikes under the base, a domed sensor eye in the middle
 * of the face, and an arming lamp beside it.
 *
 * The BEAM itself is not here: it is a world object with a length that depends
 * on what the mine is looking at, so `ThrownGrenades` builds and owns it.
 */
export function buildMine() {
  const body = new Assembly('mine');
  const w = 0.052;
  const h = 0.046;
  const d = 0.03;

  /* ---- the wedge --------------------------------------------------------- */
  const shell = extrude(
    [
      [-d * 0.5, -h * 0.5],
      [d * 0.5, -h * 0.5],
      [d * 0.5 - 0.009, h * 0.5],
      [-d * 0.5, h * 0.5],
    ],
    w,
    { bevel: 0.0015 }
  );
  body.add(shell, 'polymer_tan', { ry: Math.PI / 2 });
  shell.dispose();
  // Ribbed back, so the wedge is not a bare slab from behind.
  for (let i = 0; i < 4; i++) {
    const rib = box(w - 0.008, 0.0034, 0.0022, 0.0005, 1);
    body.add(rib, 'polymer_tan', { y: -0.016 + i * 0.0105, z: -d * 0.5 - 0.0009 });
    rib.dispose();
  }

  /* ---- sensor eye + arming lamp ------------------------------------------ */
  const bezel = latheZ(
    [
      [0, 0.0068],
      [0, 0.0102],
      [0.0032, 0.0102],
      [0.0042, 0.0082],
      [0.0042, 0.0068],
    ],
    16
  );
  body.add(bezel, 'steel_enamel', { y: 0.004, z: d * 0.5 - 0.001, rx: -0.35 });
  bezel.dispose();
  /** The eye. `cavity` so it reads as a hole rather than a dot of paint —
   *  the emitter's own glow is the world beam, which lives in grenades.js. */
  const eye = dome(0.0068, 14, 0.55);
  body.add(eye, 'cavity', { y: 0.004, z: d * 0.5 + 0.0012, rx: -0.35 + Math.PI });
  eye.dispose();
  const lamp = dome(0.0026, 10, 0.6);
  body.add(lamp, 'steel_bright', { x: 0.016, y: 0.012, z: d * 0.5 + 0.0008, rx: Math.PI });
  lamp.dispose();
  addScrew(body, 'steel', -0.019, -0.014, d * 0.5 - 0.0005, 0.0018, 'z', 0.004);
  addScrew(body, 'steel', 0.019, -0.014, d * 0.5 - 0.0005, 0.0018, 'z', 0.004);

  /* ---- ground spikes ------------------------------------------------------ */
  for (const sx of [-1, 1]) {
    const spike = latheZ(
      [
        [0, 0.0034],
        [0.012, 0.0028],
        [0.018, 0],
      ],
      10
    );
    body.add(spike, 'steel', { x: sx * 0.016, y: -h * 0.5, z: 0, rx: Math.PI / 2 });
    spike.dispose();
  }

  return {
    id: 'mine',
    label: 'PM-1',
    fxClass: 'melee',
    wearScale: { polymer_tan: 0.35, steel: 0.4, steel_enamel: 0.26, steel_bright: 0.5 },
    body,
    /** No pin: a mine is armed by the throw, not by a ring. `moving` must not
     *  be empty of a `pin` key silently — nothing reads one, and the clip's
     *  `pinpull` beat guards on `parts.pin` existing. */
    moving: {},
    nodes: { muzzle: [0, 0, 0], ...HANDS },
  };
}

/* ========================================================================== */
/*  anti-tank mine — the CARRIED canister                                     */
/* ========================================================================== */

/**
 * ══════════════════════════════════════════════════════════════════════════
 * PT-6 ANTI-TANK MINE — 「対戦車地雷を設置できるようにして」
 * ══════════════════════════════════════════════════════════════════════════
 * THIS IS THE THING IN THE HAND, AND IT IS NOT THE THING ON THE GROUND. That
 * is a deliberate split and it is worth the paragraph, because "one weapon,
 * two meshes" is normally a smell:
 *
 *   A REAL AT MINE IS 300 mm ACROSS. Every throwable in this file shares one
 *   grip solve (`HANDS`) whose `gripCylinder` is r 28.5 mm, because the hand
 *   closes on a 57 mm section — the frag's ball, the two cans' bodies, the
 *   PM-1's wedge. A 300 mm disc handed to that solver puts the whole fist
 *   INSIDE the mine: the fingers are solved onto a 28.5 mm cylinder that no
 *   longer exists as a surface. Widening the solve for one weapon is how the
 *   knife's grip note says these things go wrong.
 *
 *   SO THE CARRIED OBJECT IS THE CHARGE, ON THE SAME 57 mm WAIST every other
 *   throwable has — a squat olive canister with a fuze well, a carrying strap
 *   lug and an arming key. The hand solve is the frag's, verbatim, which is
 *   the same argument the header already makes for the flashbang and the
 *   smoke can: the pose is a property of the SECTION, not of the filling.
 *
 *   AND THE EMPLACED OBJECT IS THE MINE, 320 mm across and 90 mm proud, built
 *   in `ThrownGrenades._atMesh` because its size, its lie and its ring marker
 *   are world facts rather than viewmodel ones. A man emplacing a mine opens
 *   it out; that is what 「設置」 means and it is what the two meshes say.
 *
 * NOTHING HERE IS A SECOND IMPLEMENTATION of anything: there is one mine
 * record, one sensor, one trip voice and one blast, all in `grenades.js`, and
 * bots and the player reach them through the same `WeaponSystem.layMine`.
 */
export function buildAtMine() {
  const body = new Assembly('atmine');
  const r = 0.0285;
  const z0 = -0.052;
  const z1 = 0.052;

  /* ---- the charge body: a squat can with a rolled waist ------------------ */
  const can = latheZ(
    [
      [0, 0],
      [0, r - 0.005],
      [0.004, r - 0.0012],
      [0.011, r],
      [0.03, r + 0.0016],
      [(z1 - z0) - 0.03, r + 0.0016],
      [(z1 - z0) - 0.011, r],
      [(z1 - z0) - 0.004, r - 0.0012],
      [(z1 - z0), r - 0.005],
      [(z1 - z0), 0],
    ],
    24
  );
  body.add(can, 'enamel_od', { z: z0 });
  can.dispose();
  /** Two crimped hoops, so a plain lathe reads as pressed sheet at 0.3 m. */
  for (const z of [z0 + 0.014, z1 - 0.014]) {
    const hoop = ring(r - 0.0004, 0.0017, 22, 6);
    body.add(hoop, 'steel_enamel', { z });
    hoop.dispose();
  }
  /** The yellow-band stencil every anti-tank store carries. Flat lathe skin. */
  const band = latheZ([[0, r + 0.0022], [0.013, r + 0.0022]], 24);
  body.add(band, 'polymer_tan', { z: -0.0065 });
  band.dispose();

  /* ---- fuze well and arming key ----------------------------------------- */
  const well = latheZ(
    [
      [0, 0],
      [0, 0.0136],
      [0.0062, 0.0136],
      [0.0082, 0.0112],
      [0.0082, 0],
    ],
    16
  );
  body.add(well, 'steel_enamel', { z: z1 });
  well.dispose();
  const throat = tubeZ(0.0096, 0.0072, 0.006, 14, 0.0004);
  body.add(throat, 'cavity', { z: z1 + 0.006 });
  throat.dispose();
  const key = box(0.0038, 0.0026, 0.021, 0.0005, 1);
  body.add(key, 'steel_bright', { x: 0.0122, y: 0.0034, z: z1 + 0.0074, ry: 0.32 });
  key.dispose();
  addScrew(body, 'steel', 0, -0.0158, z1 + 0.0026, 0.0021, 'z', 0.004);

  /* ---- carrying lug on the flank, so it is not a smooth barrel ----------- */
  const lug = box(0.0088, 0.0046, 0.013, 0.0009, 1);
  body.add(lug, 'steel', { x: r + 0.0016, y: 0, z: 0, ry: Math.PI / 2 });
  lug.dispose();
  const grip = knurlBand(r + 0.0006, 0.016, 20, 0.0006, 3);
  body.add(grip, 'steel_enamel', { z: 0.026 });
  grip.dispose();

  return {
    id: 'atmine',
    label: 'PT-6',
    fxClass: 'melee',
    wearScale: { enamel_od: 0.3, steel: 0.4, steel_enamel: 0.26, steel_bright: 0.5, polymer_tan: 0.35 },
    body,
    /** No pin. It is armed by being emplaced, not by a ring — the same
     *  statement the PM-1 above makes, and `parts.pin` is guarded either way. */
    moving: {},
    nodes: { muzzle: [0, 0, 0], ...HANDS },
  };
}
