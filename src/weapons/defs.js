import { DEG } from './mathx.js';

/**
 * Weapon data.
 *
 * Ballistics are real: 5.56x45 leaves a 14.5" barrel at ~880 m/s, 9x19 from a
 * 4.5" barrel at ~360 m/s, and both drop under gravity on the way to the
 * target. Rates of fire, magazine capacities and ADS times are the real ones
 * too (an M4A1 is 800 rpm and reaches the optic in about 220 ms).
 *
 * Recoil is split in two, exactly as a modern shooter does it:
 *   - `pattern`  a DETERMINISTIC per-shot camera climb a player can memorise
 *                and counter. Generated once from a fixed seed.
 *   - `spread`   a random cone that grows with sustained fire and shrinks when
 *                aiming, crouched or still. This is the part you cannot learn.
 */

export const WEAPON_DEFS = {
  rifle: {
    id: 'rifle',
    label: 'M4A1',
    class: 'carbine',
    caliber: '5.56x45',
    /* --- fire control --- */
    rpm: 800,
    modes: ['auto', 'burst', 'semi'],
    burstCount: 3,
    burstRpm: 950,
    burstDelay: 0.16,
    /* --- ammunition --- */
    magSize: 30,
    reserve: 210,
    /* --- terminal ballistics --- */
    muzzleVelocity: 880,
    damage: 33,
    penetration: 1.0,
    dropoff: 0.62,
    maxRange: 420,
    dragK: 0.28,
    tracerEvery: 3,
    /* --- accuracy (degrees) --- */
    spreadHip: 2.05,
    spreadAds: 0.24,
    spreadPerShot: 0.3,
    spreadMax: 3.4,
    spreadDecay: 3.6,
    /* --- recoil --- */
    recoil: {
      pitch: 0.0085, // radians of camera climb per shot
      yaw: 0.0022,
      kickBack: 0.019, // metres the viewmodel travels rearward
      kickUp: 0.0072,
      roll: 0.032,
      punch: 0.35,
      freq: 8.5,
      damping: 0.42,
      patternLength: 30,
      patternSeed: 0x4d34a1,
      climbShape: [1.45, 1.3, 1.15, 1.05, 1.0], // first-shots multiplier
      drift: 0.55, // how much the pattern wanders horizontally
    },
    /* --- handling (seconds) --- */
    adsTime: 0.22,
    adsFov: 0.74,
    viewFov: 0.86,
    reloadTac: 2.1,
    reloadEmpty: 2.9,
    inspectTime: 3.2,
    drawTime: 0.62,
    holsterTime: 0.4,
    /* --- pose ---
     * Weapon-local origin is the web of the shooting hand (top of the grip).
     * The butt pad is at z=+0.245, the muzzle crown at z=-0.502, the optic
     * ocular at (0, 0.142, +0.006) and the mag floorplate ~150 mm below origin.
     *
     * SOLVED FROM THE BORE AXIS, not from where the optic happens to land.
     *
     * The previous pose (hipPos [0.081,-0.192,-0.215], hipRot [-0.026,0.076,
     * 0.055]) was derived by putting the OPTIC at a chosen screen position, and
     * that is the wrong constraint: it left the bore 1.5 deg nose-down with the
     * weapon only 215 mm from the eye, so the whole barrel forward of the
     * receiver ran off the top-left of the frame and the muzzle crown — where
     * the flash spawns — projected onto empty street. What reads as "the gun
     * points at the crosshair" is the MUZZLE being visible, up-left of the
     * receiver, on the way to the centre of the screen.
     *
     * Constraints, in order:
     *   1. bore axis 4.0 deg LEFT of view-forward (converging on the crosshair)
     *      and 2.9 deg nose-down:  rx = -0.050, ry = +0.070
     *   2. rolled 7.7 deg so the LEFT flank of the receiver (the side that
     *      carries the rollmark, the bolt catch and the port) faces the camera
     *      and the rail deck turns edge-on instead of presenting its lit top
     *      face:  rz = -0.135
     *   3. muzzle crown inside x 1050-1300, y 620-780 at 1920x1080
     *   4. optic ocular below and right of screen centre
     *   5. magazine + pistol grip in the lower-right frame
     *
     * With the rotation above the muzzle offset is (-0.025, +0.049, -0.505) and
     * the ocular offset (+0.019, +0.141, -0.003), so at a 60 deg vertical view
     * FOV (half-height 0.5774|z|, half-width 1.0264|z|):
     *   muzzle -> (1064, 698)   ocular -> (1374, 677)   magwell mouth -> (1268, 870)
     * i.e. the muzzle is 300 px up-LEFT of the optic and heading for the middle
     * of the frame, which is the read that was missing.
     *
     * z = -0.30 (was -0.215) is what makes the weapon small enough for the mag
     * and grip to enter the frame at all: the gun's vertical extent from optic
     * to floorplate is 291 mm, and at 215 mm from the eye that is 93% of the
     * frame height. It is also the limit — the support hand is then 620 mm
     * downrange of a shoulder 200 mm off the eye, and a 572 mm arm has nothing
     * left. The butt pad ends up 60 mm in FRONT of the eye but 140 mm off axis,
     * so it is outside the frustum rather than clipped by the near plane. */
    hipPos: [0.118, -0.185, -0.3],
    hipRot: [-0.05, 0.081, -0.135],
    adsCant: [0, 0, 0.004],
    /* Eye to the rear lens.
     *
     * MEASURED FROM THE ADS FRAME, not chosen for realism. Two numbers have to
     * come out right and they pull in opposite directions:
     *
     *   housing size     the 31 mm tube's outer rim subtends rOuter/relief. At
     *                    0.078 that was 256 px of radius — a 512 px ring, HALF
     *                    the frame height, and every critic called the optic
     *                    oversized. 0.115 puts it at 168 px (336 px across,
     *                    31% of frame height), which is where a modern shooter
     *                    frames a tube sight.
     *   sight picture    is stopped by the objective bore at (relief + len), so a
     *                    LONGER relief improves the picture-to-housing ratio:
     *                    (relief)/(relief+len) goes from 0.53 to 0.69.
     *
     * So both wanted the same thing and the old value was simply too close. With
     * the 52 mm tube and the flared bore (see parts.js buildOptic) this lands the
     * clear aperture at 115 px against a 168 px housing. */
    eyeRelief: 0.115,
    /* Sprint: gun dropped and angled across the body, muzzle down-left.
     * Carried over by the same delta as the hip pose so the blend does not
     * translate the weapon 90 mm sideways on the way into a sprint. */
    sprintPos: [0.09, -0.262, -0.275],
    sprintRot: [-0.4, 0.6, 0.2],
    lowReadyPos: [0.112, -0.28, -0.289],
    lowReadyRot: [-0.46, 0.125, -0.09],
    swayScale: 1,
    bobScale: 1,
    magLen: 0.212,
  },

  smg: {
    id: 'smg',
    label: 'MPX-9',
    class: 'smg',
    caliber: '9x19',
    rpm: 950,
    modes: ['auto', 'semi'],
    burstCount: 2,
    burstRpm: 1100,
    burstDelay: 0.14,
    magSize: 32,
    reserve: 224,
    muzzleVelocity: 400,
    damage: 24,
    penetration: 0.45,
    dropoff: 0.48,
    maxRange: 240,
    dragK: 0.42,
    tracerEvery: 4,
    spreadHip: 2.5,
    spreadAds: 0.4,
    spreadPerShot: 0.26,
    spreadMax: 3.9,
    spreadDecay: 4.4,
    recoil: {
      pitch: 0.0058,
      yaw: 0.0026,
      kickBack: 0.0135,
      kickUp: 0.0052,
      roll: 0.026,
      punch: 0.24,
      freq: 10.5,
      damping: 0.4,
      patternLength: 32,
      patternSeed: 0x9ac31f,
      climbShape: [1.3, 1.18, 1.08, 1.0],
      drift: 0.8,
    },
    adsTime: 0.185,
    adsFov: 0.78,
    viewFov: 0.88,
    reloadTac: 1.85,
    reloadEmpty: 2.5,
    inspectTime: 2.9,
    drawTime: 0.52,
    holsterTime: 0.34,
    /* Solved from the bore axis exactly as the rifle's is (see there): 4.1 deg of
     * convergence, 2.9 deg nose-down, 7.5 deg of outboard roll, and far enough
     * out that the muzzle of a 210 mm barrel is on screen up-left of the optic. */
    hipPos: [0.111, -0.163, -0.288],
    hipRot: [-0.05, 0.072, -0.131],
    adsCant: [0, 0, 0.005],
    /* Same aperture-budget derivation as the rifle (see there): the 27.6 mm tube's
     * outer rim wants to land near 165 px of radius and the 44 mm bore wants the
     * eye far enough back that the objective is not the stop. */
    eyeRelief: 0.104,
    sprintPos: [0.088, -0.24, -0.262],
    sprintRot: [-0.38, 0.58, 0.19],
    lowReadyPos: [0.108, -0.252, -0.276],
    lowReadyRot: [-0.44, 0.125, -0.085],
    swayScale: 0.92,
    bobScale: 0.95,
    magLen: 0.192,
  },

  pistol: {
    id: 'pistol',
    label: 'P-19',
    class: 'pistol',
    caliber: '9x19',
    rpm: 460,
    modes: ['semi'],
    burstCount: 1,
    burstRpm: 460,
    burstDelay: 0.1,
    magSize: 17,
    reserve: 68,
    muzzleVelocity: 360,
    damage: 28,
    penetration: 0.35,
    dropoff: 0.42,
    maxRange: 180,
    dragK: 0.46,
    tracerEvery: 5,
    spreadHip: 3.1,
    spreadAds: 0.5,
    spreadPerShot: 0.42,
    spreadMax: 4.6,
    spreadDecay: 5.2,
    recoil: {
      pitch: 0.0125,
      yaw: 0.0032,
      kickBack: 0.012,
      kickUp: 0.0105,
      roll: 0.018,
      punch: 0.3,
      freq: 9.0,
      damping: 0.45,
      patternLength: 17,
      patternSeed: 0x1f77bc,
      climbShape: [1.0],
      drift: 1.2,
    },
    adsTime: 0.16,
    adsFov: 0.86,
    viewFov: 0.92,
    reloadTac: 1.6,
    reloadEmpty: 2.2,
    inspectTime: 2.6,
    drawTime: 0.42,
    holsterTime: 0.3,
    /* A pistol is held out on the arms rather than braced on the shoulder, so
     * the hip pose is FURTHER from the eye than a carbine's. */
    hipPos: [0.115, -0.15, -0.34],
    hipRot: [-0.05, 0.066, -0.115],
    /**
     * ADS CANT IS ZERO, ON PURPOSE.
     *
     * It was 0.003 rad, and the reason it can go is the same reason everything
     * below works: the ADS solve puts ONE point (`sight`) on the camera axis
     * and takes its orientation from this cant, so any non-zero roll rotates
     * every OTHER landmark about that point. At the pistol's 157 mm sight
     * radius, 0.003 rad moves the front post 0.47 mm across — 1.7 px at the
     * distances below, which is a fifth of the post's width. On a red dot that
     * is invisible; on a notch-and-post it is a visible lean.
     */
    adsCant: [0, 0, 0],
    /**
     * PISTOL ADS — MEASURED, and four separate things were wrong.
     *
     * Geometry, weapon space (bore at y = 0.036, slide top at 0.0484, sight
     * radius 157 mm from the rear notch at z=+0.040 to the front post at
     * z=-0.117), and screen maths at 1920x1080 with the ADS view FOV of
     * 60 * 0.92 = 55.2 deg (half-height 0.5228|z|, 540 px):
     *
     * 1. THE IRONS WERE NEVER ON THE SIGHT LINE. The rig aligns `sight`, which
     *    is the mini reflex's window centre at y = 0.06196. The rear notch sat
     *    at 0.0551 and the front post top at 0.0570, so at full ADS they
     *    projected to 22 px and 11 px BELOW the crosshair — and 11 px apart
     *    from each other. The post could not sit in the notch and neither sat
     *    on the aim point.
     * 2. THE TWO SIGHT HEIGHTS DID NOT MATCH. Front post top 1.4 mm below the
     *    rear blade top. A correct picture is post top flush with the notch
     *    shoulders; 1.4 mm over 157 mm is 8.9 mrad, so eyeballing the picture
     *    aimed 0.51 deg high no matter what the rig did.
     * 3. THE OPTIC AND THE IRONS FOUGHT. Standard-height sights under a
     *    slide-mounted reflex are unusable by construction — the window blocks
     *    them. FIX: both irons are now built to the optic's own centre height
     *    (parts.js buildSlide `sightTop`), an absolute co-witness, so the notch
     *    shoulders, the post top and the emitter's dot all land on the SAME
     *    pixel at the crosshair. Post 4.0 mm in a 4.4 mm notch = 0.60 of the
     *    notch's angular width, i.e. ~2 px of light either side.
     * 4. THE WHOLE PICTURE WAS A POSTAGE STAMP. At 0.34 m the 17.6 x 15.1 mm
     *    window subtended 54 x 46 px — against the rifle's deliberately framed
     *    336 px tube (see there) — and the notch was 13 px wide. 0.28 m puts
     *    the window at 65 x 56 px, the notch at 16.3 px and the post at 9.7 px,
     *    which is the smallest picture that still reads at 1080p.
     *
     * 0.28 m is safe for the arms: the shooting wrist lands 0.368 m from its
     * shoulder, 58% of a 630 mm reach (it was 66% at 0.34 m), so both elbows
     * keep a deep bend. The old note here warned that past ~0.40 m the two-bone
     * solve locks — this moves in the other direction.
     */
    eyeRelief: 0.28,
    sprintPos: [0.09, -0.25, -0.28],
    sprintRot: [-0.42, 0.5, 0.14],
    lowReadyPos: [0.1, -0.26, -0.32],
    lowReadyRot: [-0.44, 0.105, -0.07],
    swayScale: 1.15,
    bobScale: 1.1,
    magLen: 0.108,
  },

  knife: {
    id: 'knife',
    label: 'KM-7',
    class: 'melee',
    /* NO magazine, NO reserve, NO fire mode, NO ADS. Those keys are ABSENT
     * rather than zeroed: `ammo` returns magSize 0 / total 0, the HUD prints an
     * em dash instead of a count (see ui/ammo.js), `cycleFireMode` is a no-op
     * because `modes` is a single entry, and `reload()` exits on the melee
     * class before it can touch a magazine that does not exist. */
    modes: ['melee'],
    /* --- melee --- */
    melee: {
      /**
       * LMB slash, RMB stab. Both are a wind-up, an impact frame and a
       * recovery; only the impact frame casts.
       *
       * `impact` is when the edge is at full extension in the clip, `reach` is
       * how far in front of the eye the cast runs and `radius` is the swept
       * sphere. 1.9 m of reach on a 281 mm knife is a LUNGE, not an arm's
       * length, and it is deliberate: the player's collision capsule stops
       * ~0.55 m short of an enemy's, so a cast measured from the eye has to
       * cover the standoff plus the enemy's own radius before the blade can
       * ever connect. The slash trades 250 mm of that for a 40% faster cycle.
       */
      slash: { damage: 55, impact: 0.13, cycle: 0.52, reach: 1.65, radius: 0.18 },
      /** 110 kills a 100 hp actor outright — a back stab is a back stab. */
      stab: { damage: 110, impact: 0.21, cycle: 0.86, reach: 1.9, radius: 0.16 },
    },
    /* --- handling (seconds) --- */
    ads: false,
    adsTime: 0.16,
    adsFov: 1,
    viewFov: 1,
    inspectTime: 2.4,
    drawTime: 0.44,
    holsterTime: 0.3,
    cycleTime: 0.3,
    /* --- accuracy: a knife has no cone. The HUD reads these every frame, so
     * they are real zeros rather than missing keys that would produce NaN. --- */
    spreadHip: 0,
    spreadAds: 0,
    spreadPerShot: 0,
    spreadMax: 0,
    spreadDecay: 1,
    /* --- pose ---
     * Weapon-local origin is the web of the shooting hand, immediately behind
     * the guard. Blade tip at (0, -0.0035, -0.161), guard at z=-0.013, pommel
     * butt at z=+0.120, wrist target at (0.0014, 0.0099, 0.1038).
     *
     * SOLVED FROM THE BLADE AXIS AND THE SCREEN FRAMING, the same way the
     * rifle's is — a knife's equivalent of the bore is the line from the ricasso
     * to the point, and its equivalent of "the muzzle must be visible heading
     * for the middle of the frame" is that the POINT must be, because the point
     * is the only part of a knife that says which way it is going.
     *
     * THE FAILURE MODE IS FORESHORTENING, and the first solve walked straight
     * into it. Aiming the blade close to view-forward (30 deg up, 17 deg left)
     * projects only sin(34 deg) = 0.56 of its 125 mm, so plunge-to-point
     * measured 185 px on screen against a fist 460 px across: measured on the
     * first capture, the hand simply covered the knife. A blade has to be held
     * ACROSS the view, not down it.
     *
     * Constraints, searched over pos x/y/z and rot x/y/z at 10 mm / 0.05 rad:
     *   1. plunge-to-point spans 351 px at 1920x1080 — the blade is the
     *      largest single thing in the frame's right half, which on a weapon
     *      with no receiver and no magazine is the only thing that can be
     *   2. blade axis 38.0 deg nose-UP and 59.9 deg left of view-forward, so
     *      the point sweeps up and INTO the frame: point (1010, 360), plunge
     *      (1295, 565), guard (1332, 642)
     *   3. the fist centre projects to (1627, 623) and the wrist to (1881,
     *      573) — 501 px from the blade's midpoint and hard against the right
     *      edge, so the hand frames the weapon instead of hiding it
     *   4. |flat . viewZ| = 0.860: the near flat is turned almost fully to the
     *      camera, which is what lets the fuller, the swedge and the grind
     *      line each catch their own specular band. Edge-on they are one wire.
     *   5. edge canted (-0.52, -0.79) — down and outboard, so the polished
     *      bevel faces the key rather than the floor
     *   6. point at 0.345 m, guard 0.289 m, wrist 0.207 m from the eye:
     *      nothing inside the near plane, and the shooting arm at 52%
     *      extension, so the elbow keeps a deep bend.
     */
    hipPos: [0.13, -0.03, -0.28],
    hipRot: [1.0, 0.75, -0.8],
    adsCant: [0, 0, 0],
    /* Sprint: the blade drops and swings across the body — 31 deg of nose-up
     * traded away and 14 deg more yaw, which takes the point down-left and out
     * of the sightline. Carried over by the same delta as the hip pose so the
     * blend does not translate the knife sideways on the way into a sprint. */
    sprintPos: [0.1, -0.115, -0.255],
    sprintRot: [0.46, 0.99, -0.45],
    lowReadyPos: [0.12, -0.1, -0.27],
    lowReadyRot: [0.62, 0.87, -0.72],
    swayScale: 1.25,
    bobScale: 1.2,
  },
};

/**
 * Generate the deterministic recoil pattern for a weapon.
 *
 * The shape is what a player learns: a strong vertical climb for the first few
 * shots, then the vertical settles while the muzzle starts to wander sideways
 * in a smooth, repeatable S. Everything comes from one fixed seed so the same
 * weapon always kicks the same way — including in capture mode.
 *
 * @returns {Float32Array} pairs of [pitch, yaw] in radians, length n*2.
 */
export function buildRecoilPattern(def, Rng) {
  const r = def.recoil;
  const n = r.patternLength;
  const rng = new Rng(r.patternSeed);
  const out = new Float32Array(n * 2);
  // Two out-of-phase wanders make the horizontal read as a learnable snake
  // rather than as noise.
  const phase = rng.float() * Math.PI * 2;
  const phase2 = rng.float() * Math.PI * 2;
  const bias = rng.signed() * 0.35;
  for (let i = 0; i < n; i++) {
    const shot = i;
    const climb = r.climbShape[Math.min(shot, r.climbShape.length - 1)];
    // Vertical: strong early, tapering, with a per-shot signature bump.
    const sig = 0.88 + rng.float() * 0.24;
    out[i * 2] = r.pitch * climb * sig;
    // Horizontal: a smooth snake plus a fixed per-shot signature.
    const t = i / Math.max(1, n - 1);
    const snake =
      Math.sin(phase + t * Math.PI * 2.6) * 0.75 + Math.sin(phase2 + t * Math.PI * 5.1) * 0.35;
    out[i * 2 + 1] = r.yaw * (snake * r.drift * 3.2 + bias + rng.signed() * 0.25);
  }
  return out;
}

export const SPREAD_MODS = {
  crouch: 0.78,
  prone: 0.6,
  still: 0.82,
  walking: 1.15,
  sprinting: 2.2,
  airborne: 2.0,
  hipfire: 1,
};

export const DEG2RAD = DEG;
