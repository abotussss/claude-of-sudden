/**
 * AI — animation content.
 *
 * Poses are authored as **local euler deltas in degrees** on top of the bind
 * pose. The rig is built so that every bone's local axes mean the same thing:
 *
 *   x  flexion   — positive bends the bone forward (knee extends, spine bows)
 *   y  twist     — roll about the bone's own length
 *   z  lateral   — positive tips the bone toward the character's right
 *
 * That makes a walk cycle readable as anatomy rather than as quaternion soup,
 * and lets layers be blended by simple lerp of the delta arrays.
 *
 * Locomotion curves are hand-tuned against reference gait: the knee flexes
 * hardest just after toe-off, the pelvis drops through mid-stance and rolls
 * toward the stance leg, and the spine counter-rotates against the pelvis.
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const sin = Math.sin;
const cos = Math.cos;

/* ------------------------------------------------------------------ */
/* base stance                                                        */
/* ------------------------------------------------------------------ */

/** Weight on the left leg, knees soft, weapon at low ready. */
export function idle(P, ph, p = {}) {
  const t = ph * TAU;
  const breath = sin(t * 0.55);
  const sway = sin(t * 0.31 + 1.1);
  const micro = sin(t * 1.7 + 0.4) * 0.35 + sin(t * 2.9) * 0.2;

  P.hip(0.012 * sway, -0.008 + 0.004 * breath, 0);
  P.d('Hips', -1.5, 2.2 * sway, 1.6);
  P.d('Spine', 1.6 + 0.7 * breath, -1.4 * sway, -0.8);
  P.d('Spine1', 1.2 + 0.9 * breath, -1.0 * sway, -0.6);
  P.d('Spine2', -0.6 + 1.1 * breath, 1.6 * sway, 0.4);
  P.d('Neck', 1.0 - 0.5 * breath, 1.2 * sway + micro, 0);
  P.d('Head', -1.2, 1.0 * micro, 0.6 * sway);

  // stance: right leg carries, left slightly forward
  P.d('UpLegR', -2, 1.5, -1.5);
  P.d('LegR', -5.5, 0, 0);
  P.d('FootR', 4.5, -1.5, 0);
  P.d('UpLegL', 5, -4.5, 2.5);
  P.d('LegL', -9, 0, 0);
  P.d('FootL', 5.5, 3.0, 0);

  // shoulders settle, weapon rides the breath
  P.d('ClavicleR', -1.5 + 0.8 * breath, 0, 1.2);
  P.d('ClavicleL', -1.0 + 0.6 * breath, 0, -1.0);
  P.d('UpperArmR', -3, 0, 2);
  P.d('UpperArmL', 2, 0, -2);
  P.d('ForearmR', 2, 0, 0);
}

/**
 * Stock in the shoulder, head over the sights, weight forward on bent knees.
 * Additive over any base — this is what turns a standing mannequin into a man
 * in a gunfight.
 */
export function aimAdd(P, w = 1) {
  // fighting stance: knees soft, hips dropped, feet staggered
  P.hip(0, -0.035 * w, 0.012 * w);
  P.d('Hips', 4 * w, 3 * w, 0);
  P.d('UpLegR', 8 * w, 4 * w, -3 * w);
  P.d('LegR', -17 * w, 0, 0);
  P.d('FootR', 9 * w, -2 * w, 0);
  P.d('UpLegL', 3 * w, -6 * w, 4 * w);
  P.d('LegL', -13 * w, 0, 0);
  P.d('FootL', 8 * w, 3 * w, 0);
  P.d('Spine1', 2.5 * w, 0, 0);
  P.d('Spine2', 3.0 * w, -5.0 * w, 0);
  P.d('Neck', 5.0 * w, 3.0 * w, 0);
  P.d('Head', -3.5 * w, 2.0 * w, -1.5 * w);
  P.d('ClavicleR', -6.0 * w, -2 * w, 5.0 * w);
  P.d('ClavicleL', -3.0 * w, 4 * w, -3.0 * w);
  P.d('UpperArmR', 10 * w, 0, 14 * w);
  P.d('ForearmR', -12 * w, 0, 0);
  P.d('UpperArmL', 8 * w, 0, -6 * w);
}

/* ------------------------------------------------------------------ */
/* locomotion                                                         */
/* ------------------------------------------------------------------ */

/**
 * STRIDE-LOCKED GAIT.
 *
 * The legs used to be three sinusoids on the hip, knee and ankle, and the
 * animator advanced their phase at `speed / strideLength` in the belief that
 * this alone kept the feet stuck to the ground. It does not, and measurement
 * (`src/ai/gaitcheck.mjs`) said so bluntly: on the run at 4.2 m/s the foot was
 * lowest at the exact moment it was travelling FORWARD at 10.4 m/s, because the
 * sinusoids put the low point of the foot in the middle of the *swing*. There
 * was no stance phase anywhere in the cycle. The feet skated at 4.4 m/s and both
 * of them were on the ground 100% of the time.
 *
 * Matching a phase RATE to a speed is not the same thing as matching a foot PATH
 * to a speed, and only the second one plants a foot. So the leg is authored the
 * other way round now: the ankle's path is written directly, in the actor's own
 * frame, and the hip and knee are whatever the two-bone IK needs to reach it.
 *
 *   stance   the foot is a FIXED POINT OF THE WORLD. In the actor's frame that
 *            is a straight line running backwards at exactly the speed the actor
 *            is moving, so the slide is zero by construction rather than by
 *            tuning. The pivot migrates heel -> flat -> toe across the phase,
 *            which is what lets a 0.857 m leg cover a 2.05 m stride without
 *            locking straight, and it is also what makes a toe-off read as one.
 *   swing    a free arc: the foot flicks back as the knee folds, lifts, then
 *            reaches forward and levels off into the next contact.
 *
 * `duty` is the fraction of the cycle a foot is down. Below 0.5 the two stances
 * do not overlap and the man is airborne in between — that is the definition of
 * a run, and it is why `RUN.duty` is 0.32 and `WALK.duty` is 0.58.
 *
 * The pelvis follows from the same clock. A walker is HIGHEST at mid-stance
 * (he vaults over a straight leg) and a runner is LOWEST there (he lands on a
 * bent one and rises into the flight phase), which is one sign — `bobSign` —
 * and it was wrong for the run before: the old curve gave both of them the
 * walker's phase.
 */

/** Foot geometry, in metres, measured off the bind pose. */
const SOLE_DROP = 0.088; // ankle height with the sole flat on the ground
const HEEL_BACK = 0.075; // heel contact point, behind the ankle
/**
 * Toe contact point, ahead of the ankle. This is the ANKLE-TO-TOE BONE LENGTH
 * (0.1423), not the z gap between their bind positions (0.130): the foot bone's
 * +Y runs down the foot and the sole is perpendicular to its +Z, so once the
 * sole is flat the whole 0.1423 lies along the ground. Pivoting the toe-off
 * about the shorter number drove the real toe 25 mm THROUGH the floor.
 */
const TOE_FWD = 0.1423;

const smooth = (x) => x * x * (3 - 2 * x);
const smoother = (x) => x * x * x * (x * (x * 6 - 15) + 10);
const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Ankle position for one foot at stance/swing phase `u`, written into `out` as
 * [z, y, pitchDeg]. `travel` is how far the actor moves while this foot is down.
 */
function anklePath(out, u, k, travel) {
  const D = k.duty;
  if (u < D) {
    const s = u / D;
    // the flat-foot line: the whole foot is stationary in the world, so in the
    // actor's frame it slides back at exactly the actor's speed
    const zf = travel * (k.plantBias - s);
    if (s < k.heelRoll) {
      // rolling down onto a heel that is already planted
      const th = -k.heelPitch * (1 - smooth(s / k.heelRoll)) * DEG;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      out[0] = zf - HEEL_BACK + (HEEL_BACK * c + SOLE_DROP * sn);
      out[1] = -HEEL_BACK * sn + SOLE_DROP * c;
      out[2] = th / DEG;
    } else if (s > 1 - k.push) {
      // rolling over a toe that stays put: this is what buys the reach behind
      const th = k.pushPitch * smooth((s - (1 - k.push)) / k.push) * DEG;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      out[0] = zf + TOE_FWD + (-TOE_FWD * c + SOLE_DROP * sn);
      out[1] = TOE_FWD * sn + SOLE_DROP * c;
      out[2] = th / DEG;
    } else {
      out[0] = zf;
      out[1] = SOLE_DROP;
      out[2] = 0;
    }
    return 1; // planted
  }
  // ---- swing ----
  // Both ends are pinned to the pose stance hands over / asks for, so the arc
  // cannot pop at lift-off or drive the heel through the floor on the way in.
  // (It did: ending the swing at a flat 0.088 while stance began a heel-strike
  // at 0.102 buried the heel 11 mm.)
  const e = (u - D) / (1 - D);
  const thEnd = k.pushPitch * DEG;
  const z0 =
    travel * (k.plantBias - 1) + TOE_FWD - TOE_FWD * Math.cos(thEnd) + SOLE_DROP * Math.sin(thEnd);
  const y0 = TOE_FWD * Math.sin(thEnd) + SOLE_DROP * Math.cos(thEnd);
  const thIn = -k.heelPitch * DEG;
  const z1 = travel * k.plantBias - HEEL_BACK + (HEEL_BACK * Math.cos(thIn) + SOLE_DROP * Math.sin(thIn));
  const y1 = -HEEL_BACK * Math.sin(thIn) + SOLE_DROP * Math.cos(thIn);
  const a = smoother(e);
  out[0] = z0 + (z1 - z0) * a - k.tuck * Math.sin(Math.PI * e) ** 1.6;
  out[1] = y0 + (y1 - y0) * smooth(e) + k.lift * Math.sin(Math.PI * e ** 0.72);
  // toe stays pointed out of the push, then dorsiflexes to clear and to land
  out[2] =
    k.pushPitch * (1 - smooth(sat(e / 0.3))) - k.heelPitch * smooth(sat((e - 0.35) / 0.45));
  return 0;
}

const _ankle = [0, 0, 0];

function gait(P, ph, k, ctx) {
  // metres the actor covers while one foot is down
  const travel = ctx.stride * k.duty;
  const stanceMid = k.duty * 0.5;

  for (const side of [1, -1]) {
    const s = side > 0 ? 'R' : 'L';
    const kk = side > 0 ? 0 : 1;
    const u = side > 0 ? ph : (ph + 0.5) % 1;
    const plant = anklePath(_ankle, u, k, travel);
    // feet track in toward the midline as the pace picks up
    P.footPath(kk, -side * k.track, _ankle[1], _ankle[0], plant, _ankle[2]);
    // the toe segment stays flat on the ground while the foot rolls over it
    P.d(`Toe${s}`, plant ? -_ankle[2] * 0.9 : 0, 0, 0);
  }

  /* ---- pelvis: two bobs per cycle, phased off mid-stance ---- */
  const c1 = cos(TAU * (ph - stanceMid)); // once per cycle
  const s1 = sin(TAU * (ph - stanceMid));
  const c2 = cos(2 * TAU * (ph - stanceMid)); // twice
  P.hip(-k.sway * c1, k.bobBias + k.bob * k.bobSign * c2, 0);
  // hip drops on the SWING side, and the pelvis leads with the swinging hip
  P.d('Hips', k.pelvisTilt, -k.pelvisYaw * c1, -k.pelvisRoll * c1);
  // the spine unwinds the pelvis so the shoulders stay square to the run
  P.d('Spine', k.lean * 0.35, k.spineYaw * 0.45 * c1, k.pelvisRoll * 0.35 * c1);
  P.d('Spine1', k.lean * 0.35, k.spineYaw * 0.75 * c1, 0);
  P.d('Spine2', k.lean * 0.3, k.spineYaw * c1, 0);
  P.d('Neck', -k.lean * 0.5, -k.spineYaw * 0.6 * c1, 0);
  /* ---- arms oppose the legs; the rifle rides on the shoulders ---- */
  // the right leg is furthest forward at ph = 0, so -c1 is "right arm forward"
  P.d('ClavicleR', -k.armSwing * c1 - 1, 0, 1.5);
  P.d('ClavicleL', k.armSwing * c1 - 1, 0, -1.5);
  P.d('UpperArmR', -k.armSwing * 0.6 * c1, 0, 2);
  P.d('UpperArmL', k.armSwing * 0.8 * c1, 0, -2);
  // a little of the vertical goes into the torso rather than all of it into the
  // pelvis, which is what stops the head reading as a rigid mass on a piston
  P.d('Spine1', -k.bounce * c2, 0, 0);
  P.d('Neck', k.bounce * 0.8 * c2, 0, s1 * k.headRoll);
}

const WALK = {
  duty: 0.58, plantBias: 0.42, track: 0.098,
  heelRoll: 0.16, heelPitch: 15, push: 0.30, pushPitch: 40,
  lift: 0.10, tuck: 0.035,
  sway: 0.016, bob: 0.018, bobBias: -0.028, bobSign: 1,
  pelvisTilt: -1, pelvisYaw: 4.5, pelvisRoll: 3.2,
  lean: 4, spineYaw: 3.4, armSwing: 4, bounce: 0.8, headRoll: 0.8,
};

const RUN = {
  duty: 0.34, plantBias: 0.36, track: 0.072,
  heelRoll: 0.14, heelPitch: 12, push: 0.30, pushPitch: 44,
  lift: 0.30, tuck: 0.085,
  sway: 0.020, bob: 0.042, bobBias: -0.070, bobSign: -1,
  pelvisTilt: -3, pelvisYaw: 6, pelvisRoll: 4,
  lean: 13, spineYaw: 6, armSwing: 9, bounce: 1.6, headRoll: 1.2,
};

const CROUCH = {
  duty: 0.66, plantBias: 0.45, track: 0.115,
  heelRoll: 0.18, heelPitch: 8, push: 0.24, pushPitch: 22,
  lift: 0.075, tuck: 0.02,
  sway: 0.012, bob: 0.008, bobBias: -0.008, bobSign: 1,
  pelvisTilt: 6, pelvisYaw: 3, pelvisRoll: 2,
  lean: 16, spineYaw: 2.4, armSwing: 2, bounce: 0.4, headRoll: 0.4,
};

export function walk(P, ph, ctx) {
  gait(P, ph, WALK, ctx);
}

export function run(P, ph, ctx) {
  gait(P, ph, RUN, ctx);
  // the head is the last thing that should move on a runner: counter the lean
  // so the eyes stay level and the helmet stops describing an arc
  P.d('Head', -4.5, 0, 0);
}

export function crouchWalk(P, ph, ctx) {
  gait(P, ph, CROUCH, ctx);
  P.hip(0, -0.30, -0.02);
  P.d('Spine2', 4, 0, 0);
}

/** Static crouch — knees loaded, torso upright behind the weapon. */
export function crouchIdle(P, ph) {
  const t = ph * TAU;
  const breath = sin(t * 0.6);
  P.hip(0.004 * sin(t * 0.4), -0.315 + 0.004 * breath, -0.02);
  P.d('Hips', 7, 1.5, 1);
  P.d('UpLegR', 44, 3, -6);
  P.d('LegR', -78, 0, 0);
  P.d('FootR', 30, -2, 0);
  P.d('UpLegL', 36, -6, 7);
  P.d('LegL', -86, 0, 0);
  P.d('FootL', 32, 4, 0);
  P.d('Spine', 6 + 0.6 * breath, 0, 0);
  P.d('Spine1', 5 + 0.8 * breath, 0, 0);
  P.d('Spine2', 3 + 1.0 * breath, 0, 0);
  P.d('Neck', 2, 0, 0);
  P.d('ClavicleR', -2, 0, 1.5);
  P.d('ClavicleL', -1.5, 0, -1.5);
}

/** Prone-ish crawl is out of scope; a wounded low stance stands in for it. */
export function hurtIdle(P, ph) {
  const t = ph * TAU;
  P.hip(0, -0.10, -0.03);
  P.d('Hips', 10, 0, 4);
  P.d('Spine', 12, 0, -3);
  P.d('Spine1', 9, 0, -2);
  P.d('Spine2', 5 + sin(t * 1.6), 0, 0);
  P.d('Neck', 6, 0, 0);
  P.d('UpLegR', 16, 0, -3);
  P.d('LegR', -28, 0, 0);
  P.d('FootR', 12, 0, 0);
  P.d('UpLegL', 10, 0, 4);
  P.d('LegL', -20, 0, 0);
  P.d('FootL', 9, 0, 0);
}

/* ------------------------------------------------------------------ */
/* one-shots (t is 0..1 over the clip's duration)                     */
/* ------------------------------------------------------------------ */

/** Pivot on the balls of the feet: the trailing foot lifts and re-plants. */
export function turnStep(P, t, dir) {
  const e = Math.sin(Math.PI * Math.min(1, t)); // 0..1..0
  const s = dir > 0 ? 'R' : 'L';
  const o = dir > 0 ? 'L' : 'R';
  P.d(`UpLeg${s}`, 12 * e, dir * 16 * e, 0);
  P.d(`Leg${s}`, -34 * e, 0, 0);
  P.d(`Foot${s}`, 16 * e, 0, 0);
  P.d(`UpLeg${o}`, -4 * e, -dir * 4 * e, 0);
  P.d(`Leg${o}`, -10 * e, 0, 0);
  P.d('Hips', 0, dir * 6 * e, dir * -2 * e);
  P.hip(0, -0.012 * e, 0);
}

/**
 * Vault: plant the support hand, tuck the knees over the obstacle, land.
 * Root motion (the actual translation) is driven by the agent.
 */
export function vault(P, t) {
  const rise = Math.sin(Math.PI * Math.min(1, t * 1.05));
  const tuck = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.12) * 1.3)));
  const land = Math.max(0, (t - 0.7) / 0.3);
  P.hip(0, 0.10 * rise, 0.02 * rise);
  P.d('Hips', 26 * rise - 16 * land, 0, 0);
  P.d('Spine', 20 * rise, 0, -4 * rise);
  P.d('Spine1', 14 * rise, 0, -3 * rise);
  P.d('Spine2', 8 * rise, -14 * rise, 0);
  P.d('Neck', -8 * rise, 6 * rise, 0);
  P.d('UpLegR', 86 * tuck + 30 * land, 0, -10 * tuck);
  P.d('LegR', -104 * tuck - 20 * land, 0, 0);
  P.d('FootR', 24 * tuck, 0, 0);
  P.d('UpLegL', 68 * tuck + 12 * land, 0, 12 * tuck);
  P.d('LegL', -92 * tuck - 30 * land, 0, 0);
  P.d('FootL', 20 * tuck, 0, 0);
  // support arm swings out of the weapon grip
  P.d('ClavicleL', -18 * rise, 12 * rise, -14 * rise);
  P.d('UpperArmL', -46 * rise, 0, -28 * rise);
  P.d('ForearmL', -30 * rise, 0, 0);
  P.d('ClavicleR', -6 * rise, 0, 4 * rise);
  P.d('UpperArmR', -14 * rise, 0, 10 * rise);
}

/**
 * Firing impulse. `t` is seconds since the shot; the shape is a fast spike and
 * a springy settle, which is what makes a burst read as recoil rather than as
 * a wobble.
 */
export function recoilAdd(P, t, strength = 1) {
  if (t > 0.26) return;
  const e = Math.exp(-t * 16);
  const osc = Math.sin(t * 92);
  const k = strength * e;
  P.d('ClavicleR', -7 * k, 0, 3 * k);
  P.d('UpperArmR', -9 * k + 2 * osc * k, 0, 5 * k);
  P.d('ForearmR', 7 * k, 0, 0);
  P.d('ClavicleL', -3 * k, 0, -2 * k);
  P.d('UpperArmL', -6 * k, 0, -3 * k);
  P.d('Spine2', -3.5 * k, 1.5 * k * osc, 0);
  P.d('Spine1', -2.0 * k, 0, 0);
  P.d('Neck', -2.5 * k, 0, 0);
  P.d('Head', 1.5 * k, 0.8 * k * osc, 0);
}

/** Region-specific hit reaction; `t` seconds since impact, 0.45 s long. */
export function hitAdd(P, region, t, dirSide = 0, strength = 1) {
  if (t > 0.5) return;
  const e = Math.exp(-t * 7.5) * Math.min(1, t * 22);
  const k = strength * e;
  const side = dirSide >= 0 ? 1 : -1;
  switch (region) {
    case 'head':
      P.d('Neck', -16 * k, 10 * k * side, 6 * k * side);
      P.d('Head', -20 * k, 14 * k * side, 8 * k * side);
      P.d('Spine2', -7 * k, 4 * k * side, 0);
      P.d('Spine1', -4 * k, 0, 0);
      break;
    case 'torso':
      P.d('Spine', -6 * k, 3 * k * side, 2 * k * side);
      P.d('Spine1', -9 * k, 5 * k * side, 3 * k * side);
      P.d('Spine2', -11 * k, 6 * k * side, 4 * k * side);
      P.d('Neck', 6 * k, -3 * k * side, 0);
      P.d('Hips', 4 * k, 0, 0);
      P.hip(-0.02 * k * side, -0.02 * k, -0.03 * k);
      break;
    case 'armR':
      P.d('ClavicleR', -14 * k, 6 * k, 10 * k);
      P.d('UpperArmR', -22 * k, 0, 14 * k);
      P.d('ForearmR', 16 * k, 0, 0);
      P.d('Spine2', -5 * k, 6 * k, 0);
      break;
    case 'armL':
      P.d('ClavicleL', -14 * k, -6 * k, -10 * k);
      P.d('UpperArmL', -24 * k, 0, -16 * k);
      P.d('ForearmL', 18 * k, 0, 0);
      P.d('Spine2', -5 * k, -6 * k, 0);
      break;
    case 'legR':
      P.d('UpLegR', 14 * k, 0, -8 * k);
      P.d('LegR', -30 * k, 0, 0);
      P.d('Hips', 8 * k, 0, -6 * k);
      P.hip(0, -0.05 * k, 0);
      break;
    case 'legL':
      P.d('UpLegL', 14 * k, 0, 8 * k);
      P.d('LegL', -30 * k, 0, 0);
      P.d('Hips', 8 * k, 0, 6 * k);
      P.hip(0, -0.05 * k, 0);
      break;
    default:
      P.d('Spine1', -6 * k, 0, 0);
      P.d('Spine2', -6 * k, 0, 0);
  }
}

/** Flinch/duck when rounds crack past. */
export function suppressAdd(P, w) {
  if (w <= 0) return;
  P.d('Hips', 7 * w, 0, 0);
  P.d('Spine', 9 * w, 0, 0);
  P.d('Spine1', 8 * w, 0, 0);
  P.d('Spine2', 6 * w, 0, 0);
  P.d('Neck', -6 * w, 0, 0);
  P.d('Head', -8 * w, 0, 0);
  P.d('UpLegR', 16 * w, 0, 0);
  P.d('LegR', -26 * w, 0, 0);
  P.d('UpLegL', 14 * w, 0, 0);
  P.d('LegL', -24 * w, 0, 0);
  P.hip(0, -0.10 * w, 0);
}

/**
 * Reload: the support hand leaves the handguard, drops the magazine, fetches a
 * fresh one from the chest and slaps it home. The hand path itself is driven by
 * the animator's IK target; this is the body language around it.
 */
export function reloadAdd(P, t) {
  const w = Math.min(1, Math.max(0, Math.min(t * 6, (1 - t) * 6)));
  P.d('Spine2', 4 * w, -16 * w, -3 * w);
  P.d('Spine1', 3 * w, -6 * w, 0);
  P.d('Neck', 6 * w, 8 * w, 0);
  P.d('Head', -4 * w, 6 * w, 3 * w);
  P.d('ClavicleR', -4 * w, -4 * w, 4 * w);
  P.d('UpperArmR', 6 * w, 0, 10 * w);
  P.d('ForearmR', -6 * w, 0, 0);
}

export const CLIPS = { idle, walk, run, crouchWalk, crouchIdle, hurtIdle };
