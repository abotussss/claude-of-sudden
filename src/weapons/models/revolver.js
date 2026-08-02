import { Assembly, box, blob, extrude, roundRect, latheZ, rodZ, tubeZ, mergeAll } from '../geometry.js';
import { addPistolGrip, addScrew, addPin, triggerPart } from '../parts.js';

/**
 * The magnum revolver — a large-frame double-action .44 with a 6" barrel,
 * full underlug, vent-rib topstrap and a six-shot fluted cylinder.
 *
 * 「ハンドガンも種類増やして」 — this is the heavy-hitting slow one: half the
 * P-19's rate, a third of its capacity, and each round hits like a carbine.
 * The SILHOUETTE has to carry that: a revolver reads on the cylinder bulge and
 * the exposed hammer, so both are modelled rather than implied, and the
 * cylinder is a real moving part that indexes one chamber per shot
 * (see Viewmodel._updateParts).
 *
 * Layout (weapon-local metres, origin at the web of the shooting hand):
 *   bore axis        y = +0.042  (a magnum bore sits high over the grip)
 *   cylinder axis    y = +0.0275 (bore - 14.5 mm chamber offset)
 *   cylinder         z = -0.041 .. +0.001, r = 0.0205
 *   barrel           z = -0.045 .. -0.19
 *   hammer spur      z = +0.045
 */
export function buildRevolver() {
  const bore = 0.042;
  const gripAngle = 0.3;
  const cylR = 0.0205;
  const cylLen = 0.042;
  const cylY = bore - 0.0145;
  const cylZ0 = 0.001; // rear face
  const zMuz = -0.19;
  const zBarrel0 = -0.045; // barrel starts at the frame's front face
  /** Both irons at the same height — the sight line the ADS solve aligns. */
  const sightY = bore + 0.0142;

  const body = new Assembly('revolver-frame');

  /* ---- barrel: heavy tube, full underlug, vent-rib top ------------------- */
  const barrel = latheZ(
    [
      [0, 0],
      [0, 0.0095],
      [0.002, 0.0102],
      [zBarrel0 - zMuz - 0.004, 0.0102],
      [zBarrel0 - zMuz - 0.002, 0.0095],
      [zBarrel0 - zMuz, 0.006],
    ],
    20
  );
  body.add(barrel, 'steel_black', { y: bore, z: zBarrel0, ry: Math.PI });
  barrel.dispose();
  const boreHole = tubeZ(0.0054, 0.0038, 0.03, 12, 0.0002);
  body.add(boreHole, 'cavity', { y: bore, z: zMuz + 0.014 });
  boreHole.dispose();
  // Full underlug: shrouds the ejector rod all the way to the muzzle.
  const lug = extrude(roundRect(0.016, 0.017, 0.006, 3), zBarrel0 - zMuz - 0.006, { bevel: 0.001 });
  body.add(lug, 'steel_black', { y: bore - 0.0165, z: zMuz + 0.002, rx: 0 });
  lug.dispose();
  // Vent rib with three slots.
  const rib = box(0.009, 0.005, zBarrel0 - zMuz - 0.008, 0.0008, 1);
  body.add(rib, 'steel_black', { y: bore + 0.0115, z: (zBarrel0 + zMuz) / 2 });
  rib.dispose();
  for (let i = 0; i < 3; i++) {
    const slot = box(0.0092, 0.0028, 0.016, 0.0004, 1);
    body.add(slot, 'cavity', { y: bore + 0.0122, z: -0.085 - i * 0.03 });
    slot.dispose();
  }

  /* ---- frame ------------------------------------------------------------- */
  // Topstrap over the cylinder.
  const strap = box(0.0165, 0.009, 0.065, 0.0012, 2);
  body.add(strap, 'steel_black', { y: bore + 0.008, z: -0.017 });
  strap.dispose();
  // Standing breech / recoil shield behind the cylinder.
  const breech = blob(0.034, 0.052, 0.02, 0.0035, 3);
  body.add(breech, 'steel_black', { y: cylY + 0.004, z: cylZ0 + 0.011 });
  breech.dispose();
  // Frame under the cylinder, down to the trigger guard.
  const under = blob(0.026, 0.03, 0.05, 0.003, 3);
  body.add(under, 'steel_black', { y: cylY - 0.022, z: -0.014 });
  under.dispose();
  // Crane bulge, left side (the cylinder swings out this way).
  const crane = blob(0.008, 0.024, 0.034, 0.0025, 2);
  body.add(crane, 'steel_black', { x: -0.014, y: cylY - 0.006, z: -0.022 });
  crane.dispose();
  // Cylinder release latch on the left of the breech.
  const latch = box(0.004, 0.008, 0.018, 0.0008, 1);
  body.add(latch, 'steel', { x: -0.017, y: cylY + 0.008, z: cylZ0 + 0.013 });
  latch.dispose();
  addPin(body, 'steel', 0, cylY - 0.004, -0.036, 0.0024, 0.03);
  addScrew(body, 'steel', 0.0135, cylY - 0.012, -0.006, 0.002, 'x', 0.005);

  /* ---- hammer + trigger guard -------------------------------------------- */
  const hammer = extrude(
    [
      [-0.004, 0],
      [0.012, -0.002],
      [0.02, 0.008],
      [0.026, 0.02],
      [0.02, 0.024],
      [0.012, 0.014],
      [-0.002, 0.008],
    ],
    0.0064,
    { bevel: 0.0008 }
  );
  body.add(hammer, 'steel', { y: bore - 0.004, z: 0.036, ry: Math.PI / 2, rz: -0.25 });
  hammer.dispose();
  // Chequered hammer spur pad.
  const spur = box(0.007, 0.0022, 0.009, 0.0004, 1);
  body.add(spur, 'steel', { y: bore + 0.017, z: 0.055, rx: 0.5 });
  spur.dispose();

  const guardOuter = [
    [-0.022, 0],
    [0.024, 0],
    [0.026, -0.007],
    [0.022, -0.021],
    [0.012, -0.026],
    [-0.014, -0.026],
    [-0.022, -0.02],
  ];
  const guardInner = [
    [-0.017, -0.003],
    [0.019, -0.003],
    [0.0205, -0.009],
    [0.0165, -0.0195],
    [0.009, -0.0225],
    [-0.011, -0.0225],
    [-0.017, -0.0175],
  ];
  const guard = extrude(guardOuter, 0.0145, { bevel: 0.0009, holes: [guardInner] });
  body.add(guard, 'steel_black', { y: cylY - 0.033, z: -0.024 });
  guard.dispose();

  /* ---- grip: rubber combat stocks ---------------------------------------- */
  addPistolGrip(body, 'rubber', 'rubber', {
    y: bore - 0.02,
    z: 0.022,
    angle: gripAngle,
    len: 0.102,
    w: 0.0295,
  });

  /* ---- sights: serrated ramp front, square-notch rear -------------------- */
  const front = extrude(
    [
      [-0.012, 0],
      [0.012, 0],
      [0.012, 0.0032],
      [-0.004, 0.0038],
    ],
    0.0032,
    { bevel: 0.0004 }
  );
  body.add(front, 'steel_black', { y: sightY - 0.0035, z: zMuz + 0.012 });
  front.dispose();
  const rearBlade = extrude(roundRect(0.0165, 0.0042, 0.0008, 2), 0.0028, {
    bevel: 0.0004,
    holes: [roundRect(0.0034, 0.0036, 0.0004, 1)],
  });
  body.add(rearBlade, 'steel_black', { y: sightY - 0.001, z: 0.012 });
  rearBlade.dispose();

  /* ---- moving parts ------------------------------------------------------ */
  /**
   * THE CYLINDER — six fluted chambers on the cylinder axis. Authored about
   * its own origin so `Viewmodel._updateParts` can spin it in place: it
   * indexes one sixth of a turn per hammer fall, which is the one motion that
   * says "revolver" from the shooter's seat.
   */
  const cylinder = new Assembly('revolver-cylinder');
  const drum = latheZ(
    [
      [0, 0.012],
      [0, cylR * 0.985],
      [0.002, cylR],
      [cylLen - 0.004, cylR],
      [cylLen, cylR * 0.94],
      [cylLen, 0.012],
    ],
    24
  );
  drum.translate(0, 0, -cylLen);
  cylinder.add(drum, 'steel_black', {});
  drum.dispose();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    // Flute between chambers.
    const flute = box(0.0062, 0.003, cylLen * 0.55, 0.0006, 1);
    flute.translate(0, cylR - 0.0002, -cylLen * 0.45);
    flute.rotateZ(a + Math.PI / 6);
    cylinder.add(flute, 'steel', {});
    flute.dispose();
    // Case head on the rear face of each chamber.
    const head = rodZ(0.0058, 0.0058, 0.0022, 12, 0.0003);
    head.translate(0, 0.0145, 0.0004);
    head.rotateZ(a);
    cylinder.add(head, 'brass', {});
    head.dispose();
  }

  const trigger = new Assembly('revolver-trigger');
  const trg = triggerPart('steel');
  trigger.add(trg.geo, 'steel', {});
  trg.geo.dispose();

  return {
    id: 'revolver',
    label: 'RX-44',
    fxClass: 'pistol',
    body,
    moving: { cylinder, trigger },
    nodes: {
      muzzle: [0, bore, zMuz - 0.003],
      chamber: [0, bore, -0.02],
      /* NO eject node and the def sets ejectOnFire:false — a revolver keeps
       * its brass until the reload. */
      sight: [0, sightY, 0.012],
      sightAxis: [0, 0, -1],
      ironSight: [0, sightY, 0.012],
      sightRadius: 0.012 - (zMuz + 0.012),
      /** The revolver indexes this moving part one sixth-turn per shot. */
      cylinderSpec: { steps: 6, axis: 'z' },
      cylinderRest: { pos: [0, cylY, cylZ0], rot: [0, 0, 0] },
      /** Same derivation as the P-19: cylinder from the addPistolGrip args. */
      gripCylinder: {
        axis: [0, bore - 0.02, 0.022],
        dir: [0, -Math.cos(gripAngle), Math.sin(gripAngle)],
        r: 0.0162,
        z0: 0.022,
        z1: 0.022 + 0.102 * Math.sin(gripAngle),
      },
      /** Seeded from the P-19's searched solve (same rake, grip 6 mm lower),
       *  then refined with tools/gripfit.mjs. */
      gripR: {
        pos: [-0.0295, -0.099, 0.1085],
        finger: [-0.068, 0.3328, -0.9405],
        back: [-0.9145, -0.2126, -0.3443],
      },
      gripL: {
        pos: [0.0038, -0.0329, 0.1024],
        finger: [0.3989, 0.442, -0.8034],
        back: [0.9127, 0.3412, -0.2248],
      },
      /** Two-handed hold: the support hand cups the firing hand, like the P-19. */
      lhandPose: 'cup',
      supportCylinder: {
        axis: [0, bore - 0.0675, 0.0378],
        dir: [0, -Math.cos(gripAngle), Math.sin(gripAngle)],
        r: 0.03,
        z0: 0.066,
        z1: -0.004,
      },
      /**
       * NO `parts.magazine` — the cylinder stays in the gun. `magSeat` exists
       * because the generic reload clip derives every support-hand waypoint
       * from it (clips.js reads `nodes.magSeat.pos` unconditionally): the hand
       * works at the cylinder as if running a speedloader, and the `magdrop`
       * beat is a no-op because `_dropMagazine` guards on the missing part.
       */
      magSeat: { pos: [0, cylY - 0.008, -0.02], rot: [0, 0, 0] },
      magDrop: [0, -0.4, 0.03],
      triggerPivot: { pos: [0, cylY - 0.0195, -0.0205], rot: [0, 0, 0] },
      triggerPull: -0.32,
    },
    shell: { caseLen: 0.033, rimR: 0.00615 },
    magSize: { len: 0.05, w: 0.041, d: 0.041 },
  };
}
