import { smootherstep, easeOutBack, easeOutCubic, clamp01, lerp } from './mathx.js';

/**
 * Procedural animation clips (reload, inspect, draw, holster).
 *
 * These are *authored keyframes*, not baked animation data: every key is
 * expressed relative to the weapon's own attachment nodes, so the same timeline
 * drives a carbine, an SMG and a pistol with correct hand positions, and the
 * timing scales with the weapon's reload speed.
 *
 * Channels
 *   weapon : additive pose offset for the whole viewmodel  { p:[x,y,z], r:[rx,ry,rz] }
 *   lhand  : support-hand target in WEAPON space           { p, finger, back, pose }
 *   rhand  : shooting-hand additive offset (thumb work)    { p }
 *   parts  : moving-part drive                             { mag, magHand, charge, bolt, slide, trigger }
 *   events : named beats the weapon system reacts to       { t, name }
 *
 * A key may carry `ease`: 'smooth' (default), 'linear', 'out', 'back'.
 */

const EASE = {
  linear: (t) => t,
  smooth: (t) => smootherstep(0, 1, t),
  out: (t) => easeOutCubic(t),
  back: (t) => easeOutBack(t, 1.4),
};

function sampleTrack(keys, t, out, blend) {
  if (!keys || !keys.length) return false;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[Math.min(keys.length - 1, i + 1)];
  let w = 0;
  if (b !== a) {
    const span = b.t - a.t;
    w = span > 1e-6 ? clamp01((t - a.t) / span) : 1;
    w = (EASE[b.ease] ?? EASE.smooth)(w);
  }
  blend(a, b, w, out);
  return true;
}

export class Clip {
  constructor(name, duration, channels) {
    this.name = name;
    this.duration = duration;
    this.weapon = channels.weapon ?? null;
    this.lhand = channels.lhand ?? null;
    this.rhand = channels.rhand ?? null;
    this.parts = channels.parts ?? null;
    this.events = channels.events ?? [];
  }

  /** Sample into a preallocated result object. */
  sample(t, out) {
    out.active = true;
    // ---- weapon additive pose ----
    if (this.weapon) {
      sampleTrack(this.weapon, t, out, (a, b, w, o) => {
        for (let k = 0; k < 3; k++) {
          o.pos[k] = lerp(a.p?.[k] ?? 0, b.p?.[k] ?? 0, w);
          o.rot[k] = lerp(a.r?.[k] ?? 0, b.r?.[k] ?? 0, w);
        }
      });
    } else {
      out.pos[0] = out.pos[1] = out.pos[2] = 0;
      out.rot[0] = out.rot[1] = out.rot[2] = 0;
    }

    // ---- support hand ----
    if (this.lhand) {
      sampleTrack(this.lhand, t, out, (a, b, w, o) => {
        for (let k = 0; k < 3; k++) {
          o.lhand.pos[k] = lerp(a.p[k], b.p[k], w);
          o.lhand.finger[k] = lerp(a.finger?.[k] ?? 0, b.finger?.[k] ?? 0, w);
          o.lhand.back[k] = lerp(a.back?.[k] ?? 0, b.back?.[k] ?? 0, w);
        }
        o.lhand.pose = w < 0.5 ? a.pose ?? 'wrap' : b.pose ?? 'wrap';
        o.lhand.weight = lerp(a.weight ?? 1, b.weight ?? 1, w);
      });
    } else {
      out.lhand.weight = 0;
    }

    // ---- moving parts ----
    if (this.parts) {
      sampleTrack(this.parts, t, out, (a, b, w, o) => {
        o.parts.mag = lerp(a.mag ?? 0, b.mag ?? 0, w);
        o.parts.magVisible = (b.magVisible ?? a.magVisible ?? 1) > 0.5 || w < 0.5;
        o.parts.charge = lerp(a.charge ?? 0, b.charge ?? 0, w);
        o.parts.bolt = lerp(a.bolt ?? 0, b.bolt ?? 0, w);
        o.parts.slide = lerp(a.slide ?? 0, b.slide ?? 0, w);
      });
    }
    return out;
  }
}

export function makeSampleResult() {
  return {
    active: false,
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    lhand: { pos: [0, 0, 0], finger: [0, 0, 0], back: [0, 0, 0], pose: 'wrap', weight: 0 },
    parts: { mag: 0, magVisible: true, charge: 0, bolt: 0, slide: 0 },
  };
}

/* ========================================================================== */
/*  clip construction                                                         */
/* ========================================================================== */

const v3 = (x, y, z) => [x, y, z];

/**
 * Build every clip for one weapon from its attachment nodes.
 * `scale` compresses or stretches the whole timeline (weapon reload speed).
 */
export function buildClips(nodes, def) {
  if (def.class === 'melee') return buildMeleeClips(nodes, def);
  const grip = nodes.gripL;
  const seat = nodes.magSeat.pos;
  const magLen = def.magLen ?? 0.2;
  // Support-hand orientation while it is holding the weapon vs. a magazine.
  const wrapFinger = grip.finger ?? v3(0.82, 0.5, -0.28);
  const wrapBack = grip.back ?? v3(-0.5, 0.32, -0.8);
  const magFinger = v3(0.1, 0.72, -0.68);
  const magBack = v3(-0.86, 0.34, -0.38);
  const hgP = grip.pos;

  // Points the support hand visits, all in weapon space.
  const atMag = v3(seat[0] + 0.012, seat[1] - magLen * 0.62, seat[2] + 0.012);
  const belowGun = v3(seat[0] + 0.05, seat[1] - magLen * 1.5, seat[2] + 0.09);
  const offFrame = v3(seat[0] + 0.11, seat[1] - magLen * 2.0, seat[2] + 0.16);
  const magHigh = v3(seat[0] + 0.006, seat[1] - magLen * 0.78, seat[2] + 0.008);
  const seated = v3(seat[0], seat[1] - magLen * 0.62, seat[2]);
  const charge = nodes.chargeRest
    ? v3(nodes.chargeRest.pos[0] - 0.02, nodes.chargeRest.pos[1] + 0.008, nodes.chargeRest.pos[2] + 0.03)
    : null;

  const tac = def.reloadTac ?? 2.15;
  const emp = def.reloadEmpty ?? 2.85;

  /* ---------------------------------------------------------------- tactical */
  const reloadTac = new Clip('reloadTac', tac, {
    weapon: [
      { t: 0, p: v3(0, 0, 0), r: v3(0, 0, 0) },
      { t: 0.12 * tac, p: v3(0.014, -0.026, 0.03), r: v3(-0.14, 0.3, 0.42) },
      { t: 0.5 * tac, p: v3(0.016, -0.03, 0.026), r: v3(-0.1, 0.34, 0.5) },
      { t: 0.72 * tac, p: v3(0.012, -0.022, 0.022), r: v3(-0.12, 0.26, 0.44) },
      { t: 0.78 * tac, p: v3(0.008, -0.008, 0.014), r: v3(-0.05, 0.18, 0.3), ease: 'back' },
      { t: 1, p: v3(0, 0, 0), r: v3(0, 0, 0) },
    ],
    lhand: [
      { t: 0, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap' },
      { t: 0.1 * tac, p: atMag, finger: magFinger, back: magBack, pose: 'pinch' },
      { t: 0.2 * tac, p: atMag, finger: magFinger, back: magBack, pose: 'pinch' },
      { t: 0.3 * tac, p: belowGun, finger: magFinger, back: magBack, pose: 'pinch', ease: 'out' },
      { t: 0.42 * tac, p: offFrame, finger: magFinger, back: magBack, pose: 'open' },
      { t: 0.56 * tac, p: offFrame, finger: magFinger, back: magBack, pose: 'pinch' },
      { t: 0.68 * tac, p: belowGun, finger: magFinger, back: magBack, pose: 'pinch' },
      { t: 0.76 * tac, p: magHigh, finger: magFinger, back: magBack, pose: 'pinch', ease: 'out' },
      { t: 0.8 * tac, p: seated, finger: magFinger, back: magBack, pose: 'pinch' },
      { t: 0.86 * tac, p: v3(seated[0], seated[1] - 0.012, seated[2]), finger: magFinger, back: magBack, pose: 'open' },
      { t: 1, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap', ease: 'out' },
    ],
    parts: [
      { t: 0, mag: 0, magVisible: 1 },
      { t: 0.16 * tac, mag: 0, magVisible: 1 },
      { t: 0.2 * tac, mag: 1, magVisible: 1 },
      { t: 0.3 * tac, mag: 1, magVisible: 1, ease: 'linear' },
      { t: 0.34 * tac, mag: 1, magVisible: 0 },
      { t: 0.66 * tac, mag: 1, magVisible: 0 },
      { t: 0.68 * tac, mag: 1, magVisible: 1 },
      { t: 0.79 * tac, mag: 1, magVisible: 1, ease: 'out' },
      { t: 0.81 * tac, mag: 0, magVisible: 1 },
      { t: 1, mag: 0, magVisible: 1 },
    ],
    events: [
      { t: 0.02 * tac, name: 'start' },
      { t: 0.2 * tac, name: 'magout' },
      { t: 0.34 * tac, name: 'magdrop' },
      { t: 0.81 * tac, name: 'magin' },
      { t: 0.88 * tac, name: 'slap' },
      { t: 0.995 * tac, name: 'end' },
    ],
  });

  /* ------------------------------------------------------------------ empty */
  const emptyLhand = [
    { t: 0, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap' },
    { t: 0.08 * emp, p: atMag, finger: magFinger, back: magBack, pose: 'pinch' },
    { t: 0.16 * emp, p: atMag, finger: magFinger, back: magBack, pose: 'pinch' },
    { t: 0.26 * emp, p: belowGun, finger: magFinger, back: magBack, pose: 'open', ease: 'out' },
    { t: 0.36 * emp, p: offFrame, finger: magFinger, back: magBack, pose: 'open' },
    { t: 0.48 * emp, p: offFrame, finger: magFinger, back: magBack, pose: 'pinch' },
    { t: 0.58 * emp, p: belowGun, finger: magFinger, back: magBack, pose: 'pinch' },
    { t: 0.66 * emp, p: magHigh, finger: magFinger, back: magBack, pose: 'pinch', ease: 'out' },
    { t: 0.7 * emp, p: seated, finger: magFinger, back: magBack, pose: 'pinch' },
    { t: 0.75 * emp, p: v3(seated[0], seated[1] - 0.01, seated[2]), finger: magFinger, back: magBack, pose: 'open' },
  ];
  if (charge) {
    emptyLhand.push(
      { t: 0.82 * emp, p: v3(charge[0], charge[1], charge[2] - 0.01), finger: v3(0.55, 0.2, 0.81), back: v3(-0.2, 0.94, -0.27), pose: 'pinch', ease: 'out' },
      { t: 0.87 * emp, p: charge, finger: v3(0.55, 0.2, 0.81), back: v3(-0.2, 0.94, -0.27), pose: 'pinch' },
      { t: 0.9 * emp, p: v3(charge[0], charge[1], charge[2] + 0.07), finger: v3(0.55, 0.2, 0.81), back: v3(-0.2, 0.94, -0.27), pose: 'pinch', ease: 'linear' },
      { t: 0.93 * emp, p: v3(charge[0], charge[1], charge[2] + 0.02), finger: v3(0.55, 0.2, 0.81), back: v3(-0.2, 0.94, -0.27), pose: 'open', ease: 'out' }
    );
  } else {
    // Pistol: the support hand racks the slide from above.
    emptyLhand.push(
      { t: 0.82 * emp, p: v3(-0.02, seat[1] + 0.06, seat[2] - 0.05), finger: v3(0.7, -0.3, 0.65), back: v3(0.1, 0.94, 0.32), pose: 'pinch', ease: 'out' },
      { t: 0.88 * emp, p: v3(-0.02, seat[1] + 0.06, seat[2] - 0.02), finger: v3(0.7, -0.3, 0.65), back: v3(0.1, 0.94, 0.32), pose: 'pinch', ease: 'linear' },
      { t: 0.92 * emp, p: v3(-0.02, seat[1] + 0.06, seat[2] - 0.06), finger: v3(0.7, -0.3, 0.65), back: v3(0.1, 0.94, 0.32), pose: 'open', ease: 'out' }
    );
  }
  emptyLhand.push({ t: 1, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap', ease: 'out' });

  const emptyParts = [
    { t: 0, mag: 0, magVisible: 1, bolt: 1, slide: 1 },
    { t: 0.12 * emp, mag: 0, magVisible: 1, bolt: 1, slide: 1 },
    { t: 0.16 * emp, mag: 1, magVisible: 1, bolt: 1, slide: 1 },
    { t: 0.26 * emp, mag: 1, magVisible: 1, bolt: 1, slide: 1, ease: 'linear' },
    { t: 0.3 * emp, mag: 1, magVisible: 0, bolt: 1, slide: 1 },
    { t: 0.56 * emp, mag: 1, magVisible: 0, bolt: 1, slide: 1 },
    { t: 0.58 * emp, mag: 1, magVisible: 1, bolt: 1, slide: 1 },
    { t: 0.69 * emp, mag: 1, magVisible: 1, bolt: 1, slide: 1, ease: 'out' },
    { t: 0.71 * emp, mag: 0, magVisible: 1, bolt: 1, slide: 1 },
    { t: 0.86 * emp, mag: 0, magVisible: 1, bolt: 1, slide: 1, charge: 0 },
    { t: 0.9 * emp, mag: 0, magVisible: 1, bolt: 1, slide: 1, charge: 1, ease: 'linear' },
    { t: 0.915 * emp, mag: 0, magVisible: 1, bolt: 0, slide: 0, charge: 0, ease: 'back' },
    { t: 1, mag: 0, magVisible: 1, bolt: 0, slide: 0, charge: 0 },
  ];

  const reloadEmpty = new Clip('reloadEmpty', emp, {
    weapon: [
      { t: 0, p: v3(0, 0, 0), r: v3(0, 0, 0) },
      { t: 0.1 * emp, p: v3(0.016, -0.03, 0.032), r: v3(-0.16, 0.34, 0.46) },
      { t: 0.44 * emp, p: v3(0.018, -0.034, 0.028), r: v3(-0.12, 0.38, 0.54) },
      { t: 0.7 * emp, p: v3(0.014, -0.026, 0.024), r: v3(-0.14, 0.3, 0.48) },
      { t: 0.72 * emp, p: v3(0.01, -0.014, 0.018), r: v3(-0.06, 0.24, 0.38), ease: 'back' },
      { t: 0.86 * emp, p: v3(0.006, -0.012, 0.016), r: v3(-0.02, 0.42, 0.22) },
      { t: 0.92 * emp, p: v3(0.004, -0.006, 0.022), r: v3(0.02, 0.44, 0.18), ease: 'linear' },
      { t: 1, p: v3(0, 0, 0), r: v3(0, 0, 0), ease: 'out' },
    ],
    lhand: emptyLhand,
    parts: emptyParts,
    events: [
      { t: 0.02 * emp, name: 'start' },
      { t: 0.16 * emp, name: 'magout' },
      { t: 0.3 * emp, name: 'magdrop' },
      { t: 0.71 * emp, name: 'magin' },
      { t: 0.9 * emp, name: 'charge' },
      { t: 0.917 * emp, name: 'boltrelease' },
      { t: 0.995 * emp, name: 'end' },
    ],
  });

  /* ----------------------------------------------------------------- inspect */
  const insp = def.inspectTime ?? 3.0;
  const inspect = new Clip('inspect', insp, {
    weapon: [
      { t: 0, p: v3(0, 0, 0), r: v3(0, 0, 0) },
      { t: 0.16 * insp, p: v3(-0.03, -0.012, 0.075), r: v3(0.1, -0.62, -0.34) },
      { t: 0.34 * insp, p: v3(-0.026, -0.006, 0.085), r: v3(-0.05, -0.78, -0.5) },
      { t: 0.52 * insp, p: v3(0.01, -0.02, 0.07), r: v3(0.22, 0.5, 0.9) },
      { t: 0.7 * insp, p: v3(0.012, -0.024, 0.055), r: v3(0.3, 0.62, 1.15) },
      { t: 0.86 * insp, p: v3(-0.006, -0.01, 0.03), r: v3(0.06, -0.18, 0.2) },
      { t: 1, p: v3(0, 0, 0), r: v3(0, 0, 0), ease: 'out' },
    ],
    lhand: [
      { t: 0, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap' },
      { t: 0.3 * insp, p: v3(hgP[0] - 0.01, hgP[1] - 0.01, hgP[2] + 0.03), finger: wrapFinger, back: wrapBack, pose: 'clamp' },
      { t: 0.55 * insp, p: v3(hgP[0] + 0.01, hgP[1] - 0.02, hgP[2] - 0.02), finger: wrapFinger, back: wrapBack, pose: 'wrap' },
      { t: 1, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap', ease: 'out' },
    ],
    parts: [
      { t: 0, mag: 0, magVisible: 1 },
      { t: 1, mag: 0, magVisible: 1 },
    ],
    events: [{ t: 0.995 * insp, name: 'end' }],
  });

  /* -------------------------------------------------------------- draw/holster */
  const drawT = def.drawTime ?? 0.62;
  const draw = new Clip('draw', drawT, {
    weapon: [
      { t: 0, p: v3(0.05, -0.3, 0.14), r: v3(-0.85, 0.5, 0.55) },
      { t: 0.55 * drawT, p: v3(0.01, -0.03, 0.02), r: v3(-0.1, 0.06, 0.06), ease: 'out' },
      { t: 0.78 * drawT, p: v3(-0.004, 0.008, -0.006), r: v3(0.04, -0.02, -0.02) },
      { t: 1, p: v3(0, 0, 0), r: v3(0, 0, 0), ease: 'out' },
    ],
    lhand: [
      { t: 0, p: v3(hgP[0] - 0.02, hgP[1] - 0.09, hgP[2] + 0.06), finger: wrapFinger, back: wrapBack, pose: 'open' },
      { t: 0.6 * drawT, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap', ease: 'out' },
      { t: 1, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap' },
    ],
    parts: [{ t: 0, mag: 0, magVisible: 1 }],
    events: [{ t: 0.995 * drawT, name: 'end' }],
  });

  const holT = def.holsterTime ?? 0.4;
  const holster = new Clip('holster', holT, {
    weapon: [
      { t: 0, p: v3(0, 0, 0), r: v3(0, 0, 0) },
      { t: 0.25 * holT, p: v3(0.004, 0.014, -0.01), r: v3(0.08, -0.04, -0.05) },
      { t: 1, p: v3(0.05, -0.32, 0.15), r: v3(-0.9, 0.55, 0.6), ease: 'out' },
    ],
    lhand: [
      { t: 0, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap' },
      { t: 1, p: v3(hgP[0] - 0.02, hgP[1] - 0.1, hgP[2] + 0.07), finger: wrapFinger, back: wrapBack, pose: 'open', ease: 'out' },
    ],
    parts: [{ t: 0, mag: 0, magVisible: 1 }],
    events: [{ t: 0.995 * holT, name: 'end' }],
  });

  return { reloadTac, reloadEmpty, inspect, draw, holster };
}

/* ========================================================================== */
/*  melee                                                                     */
/* ========================================================================== */

/**
 * Clips for a bladed weapon.
 *
 * A melee weapon has no magazine, no charging handle and no support-hand work,
 * so none of the tracks above apply and none of the nodes they read
 * (`magSeat`, `chargeRest`) exist. The `lhand` channel is deliberately NULL
 * rather than a run of keys pinned to the rest position: a null channel leaves
 * `lhand.weight` at 0, which is what tells `_solveHands` to keep the support
 * hand on its authored guard position for the whole swing. Writing keys would
 * mean re-authoring that position in six places and getting it wrong in one.
 *
 * TIMING IS THE WHOLE DESIGN. Each attack is wind-up / impact / follow-through
 * / recovery, and the `impact` beat in defs.js `melee` is the frame the trace
 * is cast on — so the damage lands exactly when the edge is at full extension
 * on screen, not when the button went down. A knife that damages on press and
 * animates afterwards is the single most common melee bug in the genre.
 */
function buildMeleeClips(nodes, def) {
  const m = def.melee ?? {};
  const sl = m.slash ?? { cycle: 0.52, impact: 0.13 };
  const st = m.stab ?? { cycle: 0.86, impact: 0.21 };

  /**
   * SLASH — a right-to-left diagonal, edge leading.
   *
   * The wind-up carries the knife back, right and up (+x, +y, +z with 0.45 rad
   * of counter-yaw), so the blade leaves the frame edge-first before it comes
   * back across; the impact key is at full extension 60 mm left and 50 mm
   * forward of rest with 0.62 rad of yaw the other way, which sweeps the point
   * across roughly 700 px of screen in 60 ms. Follow-through overshoots by
   * another 0.18 rad before the long, slow recovery — the overshoot is what
   * gives the swing weight.
   */
  const slash = new Clip('slash', sl.cycle, {
    weapon: [
      { t: 0, p: v3(0, 0, 0), r: v3(0, 0, 0) },
      { t: 0.135 * sl.cycle, p: v3(0.032, 0.03, 0.042), r: v3(-0.3, -0.45, 0.36), ease: 'out' },
      { t: sl.impact, p: v3(-0.058, -0.048, -0.052), r: v3(0.26, 0.62, -0.56), ease: 'linear' },
      { t: 0.42 * sl.cycle, p: v3(-0.076, -0.072, -0.016), r: v3(0.16, 0.8, -0.76), ease: 'out' },
      { t: 0.62 * sl.cycle, p: v3(-0.03, -0.03, 0.012), r: v3(0.02, 0.34, -0.3) },
      { t: 1, p: v3(0, 0, 0), r: v3(0, 0, 0), ease: 'out' },
    ],
    events: [
      { t: 0.02 * sl.cycle, name: 'start' },
      { t: sl.impact, name: 'meleeimpact' },
      { t: 0.995 * sl.cycle, name: 'end' },
    ],
  });

  /**
   * STAB — chamber to the ribs, then a straight thrust down the sight line.
   *
   * The chamber pulls the knife 90 mm back and 40 mm right and rolls the edge
   * outboard, which is the only part of the animation the victim gets to read.
   * The thrust is 130 mm of forward travel with the blade axis rotated 0.42 rad
   * back toward view-forward — i.e. the point converges on the crosshair rather
   * than crossing it — and it holds there for 90 ms, which is what makes the
   * stab feel committed and is why it is the slower of the two.
   */
  const stab = new Clip('stab', st.cycle, {
    weapon: [
      { t: 0, p: v3(0, 0, 0), r: v3(0, 0, 0) },
      { t: 0.16 * st.cycle, p: v3(0.04, -0.012, 0.09), r: v3(-0.22, -0.3, 0.5), ease: 'out' },
      { t: st.impact, p: v3(-0.028, 0.016, -0.132), r: v3(-0.1, 0.42, -0.16), ease: 'linear' },
      { t: 0.36 * st.cycle, p: v3(-0.03, 0.018, -0.138), r: v3(-0.09, 0.44, -0.14) },
      { t: 0.56 * st.cycle, p: v3(0.008, -0.006, 0.026), r: v3(0.04, -0.06, 0.1), ease: 'out' },
      { t: 1, p: v3(0, 0, 0), r: v3(0, 0, 0), ease: 'out' },
    ],
    events: [
      { t: 0.02 * st.cycle, name: 'start' },
      { t: st.impact, name: 'meleeimpact' },
      { t: 0.995 * st.cycle, name: 'end' },
    ],
  });

  const drawT = def.drawTime ?? 0.44;
  const draw = new Clip('draw', drawT, {
    weapon: [
      { t: 0, p: v3(0.06, -0.28, 0.16), r: v3(-0.5, 0.7, 0.9) },
      { t: 0.6 * drawT, p: v3(0.008, -0.02, 0.014), r: v3(-0.06, 0.05, 0.08), ease: 'out' },
      { t: 0.8 * drawT, p: v3(-0.004, 0.008, -0.006), r: v3(0.04, -0.03, -0.03) },
      { t: 1, p: v3(0, 0, 0), r: v3(0, 0, 0), ease: 'out' },
    ],
    events: [{ t: 0.995 * drawT, name: 'end' }],
  });

  const holT = def.holsterTime ?? 0.3;
  const holster = new Clip('holster', holT, {
    weapon: [
      { t: 0, p: v3(0, 0, 0), r: v3(0, 0, 0) },
      { t: 0.25 * holT, p: v3(0.004, 0.016, -0.012), r: v3(0.07, -0.05, -0.06) },
      { t: 1, p: v3(0.06, -0.3, 0.17), r: v3(-0.55, 0.75, 0.95), ease: 'out' },
    ],
    events: [{ t: 0.995 * holT, name: 'end' }],
  });

  /** Inspect: turn the blade over so both flats and the swedge pass the key. */
  const insp = def.inspectTime ?? 2.4;
  const inspect = new Clip('inspect', insp, {
    weapon: [
      { t: 0, p: v3(0, 0, 0), r: v3(0, 0, 0) },
      { t: 0.2 * insp, p: v3(-0.05, 0.03, 0.05), r: v3(-0.25, -0.5, 0.9) },
      { t: 0.44 * insp, p: v3(-0.06, 0.045, 0.04), r: v3(-0.15, -0.72, 2.1) },
      { t: 0.68 * insp, p: v3(-0.03, 0.03, 0.05), r: v3(0.1, -0.3, 3.0) },
      { t: 0.86 * insp, p: v3(-0.01, 0.008, 0.02), r: v3(0.05, -0.1, 0.35) },
      { t: 1, p: v3(0, 0, 0), r: v3(0, 0, 0), ease: 'out' },
    ],
    events: [{ t: 0.995 * insp, name: 'end' }],
  });

  return { slash, stab, draw, holster, inspect };
}
