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

  ak: {
    id: 'ak',
    label: 'AKM-47',
    /* `rifle` rather than `carbine`: fx keys the muzzle flash off this string
     * (see fx/muzzle.js MUZZLE_PROFILES) and 7.62x39 out of a 314 mm barrel
     * throws a bigger, hotter flash than a 5.56 carbine does. Audio keys off
     * the ID and already has an `ak` profile. */
    class: 'rifle',
    caliber: '7.62x39',
    /* --- fire control ---
     * A real AKM is 600 rpm against the M4's 800: SLOWER, and every 100 rpm of
     * that is what buys the damage below. No burst — the AKM's selector has
     * exactly two fire positions plus safe. */
    rpm: 600,
    modes: ['auto', 'semi'],
    burstCount: 2,
    burstRpm: 600,
    burstDelay: 0.18,
    /* --- ammunition --- */
    magSize: 30,
    reserve: 180,
    /* --- terminal ballistics ---
     * 42 against the M4's 33 is a 3-shot kill against a 4-shot at close range,
     * which is the trade the rate of fire pays for. A heavier, slower, blunter
     * bullet also sheds velocity faster, so the falloff starts sooner (0.70 of
     * maxRange against 0.62) but maxRange itself is shorter. */
    muzzleVelocity: 715,
    damage: 42,
    penetration: 1.25,
    dropoff: 0.7,
    maxRange: 360,
    dragK: 0.34,
    tracerEvery: 3,
    /* --- accuracy (degrees) --- */
    spreadHip: 2.65,
    spreadAds: 0.32,
    spreadPerShot: 0.44,
    spreadMax: 4.5,
    spreadDecay: 3.1,
    /* --- recoil ---
     * Half again the M4's climb per shot and nearly twice its yaw, with a
     * slower, heavier oscillation (7.4 Hz against 8.5) and a first-shot
     * multiplier that starts at 1.5. The pattern is 30 long with its own seed,
     * so it is a different learnable snake, not a scaled copy of the M4's. */
    recoil: {
      pitch: 0.0128,
      yaw: 0.0039,
      kickBack: 0.0265,
      kickUp: 0.0104,
      roll: 0.045,
      punch: 0.52,
      freq: 7.4,
      damping: 0.44,
      patternLength: 30,
      patternSeed: 0x7a2e5b,
      climbShape: [1.5, 1.36, 1.22, 1.1, 1.0],
      drift: 0.72,
    },
    /* --- handling (seconds) ---
     * Heavier than the M4 everywhere: 280 ms to the sights against 220, a
     * slower draw, and a reload that has to rock a magazine out of a receiver
     * that has no magwell to guide it. */
    adsTime: 0.28,
    adsFov: 0.76,
    viewFov: 0.86,
    reloadTac: 2.45,
    reloadEmpty: 3.2,
    inspectTime: 3.4,
    drawTime: 0.72,
    holsterTime: 0.46,
    /* --- pose ---
     * The same rotation as the M4's solve (see there for the derivation): 4 deg
     * of bore convergence, 2.9 deg nose-down, 7.7 deg of outboard roll.
     *
     * The TRANSLATION is 16 mm higher and 12 mm further out than the M4's, and
     * both come off the in-game capture rather than off the M4's numbers. This
     * weapon has no optic, so nothing on it reaches above the dust cover and the
     * whole silhouette sits lower in the frame; and its most identifying
     * feature by a wide margin — the 235 mm curved magazine — hangs 74 mm
     * forward of the grip, so at the M4's distance it fell off the bottom-right
     * of the frame entirely. 12 mm further from the eye is affordable here
     * because the support hand grips 36 mm further back than the M4's does
     * (a clamshell handguard, not a 240 mm free-float tube), so the arm has
     * that much slack left before the two-bone solve clamps. */
    hipPos: [0.122, -0.172, -0.312],
    hipRot: [-0.05, 0.081, -0.135],
    adsCant: [0, 0, 0.004],
    /**
     * IRON SIGHTS, so this number is bounded on both sides and 0.16 is what is
     * left in the middle.
     *
     * The ADS solve puts `sight` — here the rear notch at z = -0.1295 — on the
     * camera axis, and every other landmark then lands at
     * (p.z - sight.z) - eyeRelief.
     *
     *   UPPER BOUND: the shooting hand is at z = +0.1176, so anything past
     *   0.247 puts the firing fist in front of the camera. Physically honest
     *   (an eye 60 mm behind an AK's receiver is 0.29 of relief) and unusable.
     *   LOWER BOUND: the rear leaf is the closest object to the eye and it
     *   subtends leafWidth/relief. At 0.10 the 16 mm leaf is 180 px across a
     *   1080 frame, i.e. the pale slab across the bottom of the sight picture
     *   that models/rifle.js spent a whole comment removing.
     *
     * A THIRD constraint decides it, and only an in-game capture showed it: the
     * eye has to end up BEHIND THE DUST COVER. The cover runs to z = +0.077 and
     * the notch is at z = -0.1295, so at 0.21 the eye landed at z = +0.108 —
     * 3 mm from the cover's rear edge — and a 190 mm sheet seen from 3 mm away
     * fills everything below the sight line. Measured: the lower half of the
     * ADS frame was solid receiver.
     *
     * 0.238 is the only band that satisfies all three: the eye is 31 mm behind
     * the cover, the leaf's near edge subtends 64 px instead of 400, the front
     * sight hood lands at 0.48 m, and the firing hand sits 9 mm behind the eye
     * — the same margin the M4 has.
     */
    eyeRelief: 0.238,
    sprintPos: [0.094, -0.249, -0.287],
    sprintRot: [-0.4, 0.6, 0.2],
    lowReadyPos: [0.116, -0.267, -0.301],
    lowReadyRot: [-0.46, 0.125, -0.09],
    swayScale: 1.12,
    bobScale: 1.08,
    magLen: 0.235,
  },

  sniper: {
    /**
     * A REAL 6x OPTIC.
     *
     * `adsFov` below is a viewmodel framing number; it never magnified
     * anything, and the note under `eyeRelief` in this file said as much — the
     * engine had no magnified optic because the zoom has to come from the world
     * camera and weapons does not own it. `WeaponSystem.adsFovScale` is that
     * hook now, and the camera reads it.
     *
     * 6x is the low end of a real designated-marksman scope and it is chosen to
     * be usable rather than authentic-at-all-costs: the map's longest sightline
     * is about 90 m, and at 6x a man at 90 m subtends roughly what a man at
     * 15 m does unscoped, which is a shot you can actually take.
     *
     * `fullScreen` puts the sight picture over the whole screen and hides the
     * viewmodel, which is what looking through a scope is. Without it the
     * magnified world is drawn behind a rifle held at arm's length, and the
     * scope tube is a 46%-of-housing window in the middle of the frame — the
     * thing being complained about.
     */
    scope: { magnification: 6, fullScreen: true },
    id: 'sniper',
    label: 'M91-SR',
    class: 'sniper',
    caliber: '7.62x51',
    /* --- fire control ---
     * BOLT ACTION, expressed in the fire-control system that exists rather than
     * in a new one. There is no 'bolt' mode: `tryFire` honours `modes[0]` and
     * `cycleTime = 60/rpm`, so a single-entry `['semi']` at 48 rpm is exactly
     * "one shot, then 1.25 s of cycle before the trigger will answer again" —
     * which is the bolt throw. A single-entry `modes` also makes
     * `cycleFireMode` a no-op, the same way the knife's does. */
    rpm: 48,
    modes: ['semi'],
    burstCount: 1,
    burstRpm: 48,
    burstDelay: 1.25,
    /**
     * The gameplay above already IS the bolt throw, but nothing could HEAR it:
     * `weaponShot`'s mech layer is a self-loader's carrier bouncing 30 ms after
     * the round leaves, and this rifle has no carrier. This flag is the one bit
     * that says "the shooter works the action by hand", and `weapons` turns it
     * into a `weapon:bolt` 180 ms after the shot. Nothing else reads it. */
    boltAction: true,
    /* --- ammunition --- */
    magSize: 5,
    reserve: 40,
    /* --- terminal ballistics ---
     * 125 is a one-shot kill on a 100 hp actor anywhere on the body, which is
     * the whole contract of a bolt gun: you get one round every 1.25 s and it
     * has to count. It holds that damage to 90% of a 900 m range, drags far
     * less than the intermediate cartridges (0.16 against 0.28), and every
     * round tracers. */
    muzzleVelocity: 840,
    damage: 125,
    penetration: 2.4,
    dropoff: 0.9,
    maxRange: 900,
    dragK: 0.16,
    tracerEvery: 1,
    /* --- accuracy (degrees) ---
     * Unusable from the hip (5.6 deg) and near-perfect from the glass (0.05),
     * with a per-shot bloom of 1.2 that takes 2.2 s to decay — the mirror image
     * of the automatics, and the reason a scoped rifle is a positional weapon
     * rather than a duelling one. */
    spreadHip: 5.6,
    spreadAds: 0.05,
    spreadPerShot: 1.2,
    spreadMax: 7.5,
    spreadDecay: 2.2,
    /* --- recoil ---
     * One big slow shove: 2.5x the M4's pitch, 2.9x its rearward travel, and a
     * 5.2 Hz oscillation that reads as mass rather than chatter. The pattern is
     * only 5 long because the magazine is. */
    recoil: {
      pitch: 0.0325,
      yaw: 0.0052,
      kickBack: 0.055,
      kickUp: 0.0225,
      roll: 0.052,
      punch: 1.15,
      freq: 5.2,
      damping: 0.52,
      patternLength: 5,
      patternSeed: 0x5d19c7,
      climbShape: [1.0],
      drift: 0.4,
    },
    /* --- handling (seconds) ---
     * 420 ms to the glass — nearly twice the M4's — plus the slowest draw and
     * holster in the loadout. Everything about picking this weapon up is slow;
     * that is the cost of the damage line above. */
    adsTime: 0.42,
    adsFov: 0.7,
    /* The VIEWMODEL camera's FOV scale, and it has to track the player camera's
     * global `adsFovScale` (0.72, see core/config.js) or the collimated reticle
     * — which is drawn in the viewmodel scene — stops landing on the same pixel
     * as the bore. There is no magnified optic in this engine; a scope's
     * magnification would have to come from the world camera, which weapons
     * does not own. */
    viewFov: 0.74,
    reloadTac: 3.0,
    reloadEmpty: 3.7,
    inspectTime: 3.8,
    drawTime: 0.95,
    holsterTime: 0.62,
    /* --- pose ---
     * Same bore-derived solve as the M4 (see there), pulled 20 mm further from
     * the eye because this weapon is 60 mm longer and the scope's objective
     * bell would otherwise sit in the middle of the frame at hipfire. */
    hipPos: [0.12, -0.182, -0.32],
    hipRot: [-0.05, 0.081, -0.135],
    adsCant: [0, 0, 0.003],
    /* Eye to the rear lens. Bounded the same way the AK's is, but by the OCULAR
     * BELL rather than a sight leaf.
     *
     * MEASURED: at 0.09 the 50 mm bell plus its rubber cup subtended 76% of the
     * frame HEIGHT — the scope was not something you looked through, it was a
     * wall with a hole in it. 0.115 (the same relief the M4's tube sight uses)
     * puts the housing at 51% of frame height and the 30 mm clear aperture at
     * 23%, so the sight picture is 46% of the housing: a scope, not a red dot,
     * and not a porthole. See buildScope for the matching aperture budget. */
    eyeRelief: 0.115,
    sprintPos: [0.092, -0.26, -0.295],
    sprintRot: [-0.4, 0.6, 0.2],
    lowReadyPos: [0.114, -0.278, -0.309],
    lowReadyRot: [-0.46, 0.125, -0.09],
    swayScale: 1.3,
    bobScale: 1.2,
    magLen: 0.078,
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
    /**
     * 0.38, up from 0.28 — set against reference photographs of two-handed
     * pistol shooting, which is what the user asked for and which the previous
     * number was not checked against.
     *
     * In every reference the arms are near FULL extension and the two hands
     * make one compact mass on the grip; the forearms are the dominant shape in
     * frame and the hands are small. At 0.28 this rig sat at 0.58 / 0.53
     * extension — elbows deeply bent, hands 0.28 m from the eye and subtending
     * about 200 px each — so the two gloves were the biggest things on screen
     * and the pistol hung between them. 0.38 gives 0.72 / 0.66 extension and
     * takes about a quarter off the apparent size of the hands.
     *
     * The cost is real and is accepted deliberately: the note below was written
     * to justify 0.28 on sight-picture size, and the reflex window drops from
     * roughly 65 x 56 px to 48 x 41 px. The window still carries an emitter dot,
     * and a small sight picture is a much smaller problem than not being able to
     * see the sight picture past your own hands.
     *
     * NOT the fix for the "mystery ring" — that was the 33 mm step between the
     * glove heel and the forearm cuff, see hands.js. Eye relief was measured
     * across 0.28-0.44 and moves the elbow by 17 mm, so it could never have been.
     */
    eyeRelief: 0.38,
    /**
     * ELBOW POLE, rig space, pistol only. See `Arm.setElbowPole`.
     * The shared default is (side*0.46, -0.86, +0.22) — elbow down, outboard and
     * BACK, which is correct for a shouldered rifle. On a two-handed pistol the
     * hands are 0.28 m out, the chain sits at 73% extension, and a backward pole
     * swings the elbow so far behind the shoulder that the upper arm points at
     * the eye: you see the sleeve end-on as a lit rim, which is the "mystery
     * ring". Down, wider outboard, and slightly FORWARD is also what a real
     * isosceles pistol stance does with the elbows.
     */
    elbowPole: [0.6, -0.78, -0.14],
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
    /**
     * THE KNIFE IS IN FRAME NOW.
     *
     * hipRot was [1.0, 0.75, -0.8] — 57 deg of pitch and 43 deg of yaw — which
     * jammed the whole knife against the right edge of the screen with the
     * blade pointing up and away, the guard off-frame and the hand only half
     * visible. Reported as "意味のわからないナイフの持ち方". It was not a bug in
     * the grip solve or in the swing clip; the swing does return to exactly
     * this pose, which I checked before changing anything. The authored rest
     * pose was simply wrong.
     *
     * Reference: a knife in a first-person view is carried in the lower right
     * with the blade angled up and INBOARD, toward the centre of the screen, so
     * that the edge, the guard and the fist are all readable at once — the
     * player has to be able to see what they are holding. Chosen by capturing
     * five candidates and looking at them, not by arithmetic.
     *
     * sprint and lowReady are shifted by the SAME delta rather than re-authored,
     * so their relationship to the rest pose is preserved: low ready still sits
     * below and outboard of the idle, sprint further still.
     */
    hipPos: [0.11, -0.07, -0.3],
    hipRot: [0.55, 0.45, -0.45],
    adsCant: [0, 0, 0],
    /* Sprint: the blade drops and swings across the body — 31 deg of nose-up
     * traded away and 14 deg more yaw, which takes the point down-left and out
     * of the sightline. Carried over by the same delta as the hip pose so the
     * blend does not translate the knife sideways on the way into a sprint. */
    sprintPos: [0.08, -0.155, -0.275],
    sprintRot: [0.01, 0.69, -0.1],
    lowReadyPos: [0.1, -0.14, -0.29],
    lowReadyRot: [0.17, 0.57, -0.37],
    swayScale: 1.25,
    bobScale: 1.2,
  },

  grenade: {
    id: 'grenade',
    label: 'M67',
    /**
     * ITS OWN CLASS, and that is load-bearing twice over.
     *
     * `WeaponSystem.primaryIds` derives the menu's primary picker by filtering
     * `class` — anything that is not `pistol` and not `melee` is offered as a
     * primary. A grenade under any existing class would appear in that list as
     * something to carry INSTEAD of a rifle. `class: 'grenade'` keeps it out of
     * the picker with nothing else to change, exactly as the comment on
     * `primaryIds` intends, and gives every other consumer (`buildClips`,
     * `reload`, the trigger state machine, `getHudState`) one honest thing to
     * branch on.
     */
    class: 'grenade',
    /* NO magazine, NO reserve, NO fire mode, NO ADS, NO recoil pattern. Like
     * the knife those keys are ABSENT rather than zeroed — `magSize: 0` is what
     * says "this weapon does not take magazines", which is a different
     * statement from "this magazine is empty" (see ammo.js). */
    modes: ['throw'],
    /* --- how many you carry -------------------------------------------- */
    /**
     * TWO, AND NO RESUPPLY INSIDE A ROUND. There are no ammo pickups in this
     * mode, so `resetAmmo()` at the top of the round is the only refill and two
     * frags is the round's whole budget. `reserve: 0` is not decoration: it is
     * what makes `reload()` a no-op and the HUD's reserve field truthful.
     */
    count: 2,
    reserve: 0,
    /* --- the fuze ------------------------------------------------------- */
    /**
     * 3.0 s FROM THE PULL, not from the release — an M67's fuze burns 4 to 5.5
     * s and this is the shooter-game 3, but the important half is *from the
     * pull*: the fuze starts when the spoon flies, so holding the button cooks
     * it and holding it too long kills you with your own grenade. That is the
     * entire tactical content of the weapon and it costs one subtraction.
     */
    fuse: 3.0,
    /* --- the blast ------------------------------------------------------
     * The same model the C4 uses (match/rules.js blastRadius/blastDamage, fired
     * through the canonical `explosion` event): a radius, a damage number and a
     * quadratic falloff, occluded by `MASK.EXPLOSION`. The NUMBERS are a frag's
     * rather than a satchel's — the C4 is 22 m / 600, which is the round ending
     * three metres from your face; this is lethal inside 3 m, painful at 7 and
     * survivable at the rim. */
    blastRadius: 7.5,
    blastDamage: 165,
    /* --- throwing ------------------------------------------------------- */
    /**
     * 17 m/s overhand, 8 m/s underhand, both released 9 degrees above the
     * sight line. A 400 g grenade at 17 m/s thrown level from 1.6 m carries
     * about 27 m before it lands, which is a street; the underhand toss is the
     * one you use to put it round a corner two metres away without it coming
     * back off the wall into your own feet.
     */
    throwSpeed: 17,
    tossSpeed: 8,
    throwLoft: 0.16,
    /** Restitution / drag of the thrown body, ballistics.js is not involved. */
    bounce: 0.34,
    /* --- handling (seconds) --- */
    ads: false,
    adsTime: 0.16,
    adsFov: 1,
    viewFov: 1,
    inspectTime: 2.2,
    drawTime: 0.5,
    holsterTime: 0.32,
    cycleTime: 0.3,
    /** Pull-to-cocked wind-up, and the throw itself. */
    cookTime: 0.42,
    throwTime: 0.66,
    /** Fraction of the throw clip at which the grenade leaves the hand. */
    releaseAt: 0.26,
    /* --- accuracy: a thrown weapon has no cone. Real zeros rather than
     * missing keys, because `_restSpread` reads them every frame. --- */
    spreadHip: 0,
    spreadAds: 0,
    spreadPerShot: 0,
    spreadMax: 0,
    spreadDecay: 1,
    /* --- pose ---
     * Weapon-local origin is the centre of the body, which is also the middle
     * of the fist. Carried high and inboard of the knife's rest pose: a
     * grenade is held up where you can see the spoon, and the whole point of
     * the readout is that the player can tell at a glance whether the pin is
     * still in it. The rotation turns the fuze up and rolls the lever toward
     * the camera so the spoon, the ring and the marking band are all readable.
     */
    hipPos: [0.115, -0.115, -0.30],
    hipRot: [-0.18, 0.28, -0.34],
    adsCant: [0, 0, 0],
    /* Sprint and low ready are the SAME deltas the knife uses off its own rest
     * pose, so the relationship between the three is preserved rather than
     * re-authored: the hand drops and swings across the body. */
    sprintPos: [0.085, -0.20, -0.275],
    sprintRot: [-0.72, 0.52, 0.01],
    lowReadyPos: [0.105, -0.185, -0.29],
    lowReadyRot: [-0.56, 0.40, -0.26],
    swayScale: 1.2,
    bobScale: 1.15,
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
