import { P } from './atlas.js';
import { resetSpawn } from './particles.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * FX — THE WAR IN THE MIDDLE DISTANCE
 * ════════════════════════════════════════════════════════════════════════════
 * 「もっと実際の戦争の現場みたいな感じにして そこらじゅうに銃撃や銃弾が飛び交い、
 *  爆撃もあり」
 *
 * Four spawn recipes for ordnance the player is NOT part of, at 60-400 m.
 * `src/match/warfield.js` owns where and when; this file owns what it looks
 * like, and every one of the differences from the close-range recipes beside it
 * is a consequence of the range rather than a style choice.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THESE ARE NOT `fx.tracer` / `fx.muzzleFlash` / `fx.explosion`
 * ────────────────────────────────────────────────────────────────────────────
 * 1. COST. `spawnTracer` is THREE particles (core, afterglow, incandescent
 *    head) and every one of them is sized for a round crossing a 30 m street,
 *    where all three subtend real pixels. At 200 m the head and the afterglow
 *    land inside the core's own footprint and the second and third particle buy
 *    literally nothing. `farTracer` is ONE. A firefight is dozens of rounds a
 *    second and the difference is 3x the ring for an identical image.
 *
 * 2. THE LIGHT POOL IS FOUR LIGHTS FOR THE WHOLE GAME (`src/fx/lights.js`), and
 *    on a night map they are already being fought over by the muzzle flashes
 *    that matter, the burning ridge and every airstrike. NOTHING IN THIS FILE
 *    EVER CALLS `fx.lights.flash`. A 155 mm shell 240 m away up a mountain has
 *    no business evicting the light on the grenade at the player's feet, and at
 *    that range its own contribution to anything near him is zero anyway — what
 *    reads is the HDR sprite and the bloom it puts in the sky, which costs no
 *    slot. @see the point-light permutation note in ARCHITECTURE.md.
 *
 * 3. THE SMOKE EMITTER POOL IS 24 (`MAX_EMITTERS` in ambience.js) and the
 *    airstrike's dust wall has already been documented losing members to
 *    exactly this kind of casual borrowing (@see `SALVO_DUST` in
 *    `src/match/airstrike.js`). Ambient shelling is CONTINUOUS, so a long-lived
 *    emitter per shell would hold the whole pool inside a minute. The smoke
 *    here is a handful of long-life LIT particles spawned once, which come out
 *    of the ordinary ring and can starve nothing.
 *
 * 4. NO DECALS AND NO SCORCH. `fx.scorch` projects onto the physics BVH and the
 *    decal budget is a shared ring of 128. Nothing at 200 m is worth a decal
 *    slot that a bullet hole beside the player wants.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ARC IS THE READ, AND IT IS THE SAFETY FEATURE
 * ────────────────────────────────────────────────────────────────────────────
 * `farTracer` gives its round REAL DROOP (`gravity` -3.5 against the close
 * tracer's -1.2, over a flight that is five to ten times longer). That is
 * physically right — a round with 200 m to go falls — but the reason it is
 * worth the line is what it does to the player's eye: fire that is coming AT
 * you is flat, because it is coming at you. A visibly arcing streak crossing
 * the field broadside cannot be mistaken for a round on its way to your head,
 * and that distinction is the whole contract `src/match/warfield.js` signs.
 */

/** Visual travel speed of an ambient round, m/s. @see `MIN_SPEED` in tracers.js. */
const TRACER_V = 230;
/** Droop. Long flight + real gravity = the arc that says "not at you". */
const TRACER_G = -3.5;

/**
 * ONE ROUND, SEEN FROM A LONG WAY OFF.
 *
 * Sized UP rather than down (0.11 against `spawnTracer`'s 0.055): a sprite is
 * measured in metres and a 5 cm streak at 200 m is a sub-pixel smear that
 * flickers through the TAA. Intensity is sized DOWN (9 against 26) because
 * bloom is doing the work at this range and a far tracer at close-range
 * intensity is a searchlight.
 */
export function farTracer(fx, x0, y0, z0, x1, y1, z1, warm = 1) {
  const rng = fx.rng;
  let dx = x1 - x0;
  let dy = y1 - y0;
  let dz = z1 - z0;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 4) return;
  const inv = 1 / dist;
  dx *= inv; dy *= inv; dz *= inv;
  const v = TRACER_V;
  const life = dist / v;
  const s = resetSpawn();
  s.x = x0 + dx * 0.6; s.y = y0 + dy * 0.6; s.z = z0 + dz * 0.6;
  // Lofted a little: the arc has to come back DOWN onto the far end, so the
  // departure is above the chord rather than along it.
  s.vx = dx * v; s.vy = dy * v + dist * 0.018; s.vz = dz * v;
  s.tile = P.STREAK;
  s.size0 = 0.11;
  s.size1 = 0.085;
  s.stretch = 0.42;
  s.life = life;
  s.drag = 0.02;
  s.gravity = TRACER_G;
  s.r0 = 1; s.g0 = 0.5 * warm; s.b0 = 0.16 * warm; s.i0 = 9;
  s.r1 = 1; s.g1 = 0.34 * warm; s.b1 = 0.08 * warm; s.i1 = 4;
  s.alphaCurve = 0.3;
  s.soft = 0.1;
  s.seed = rng.float();
  fx.emitAdd(s);
}

/**
 * A MUZZLE FLASH AT RANGE — two sprites and no light.
 *
 * `muzzle.js` builds a flash out of a core, three lobes, gas, smoke and a
 * punctual light because at 0.6 m the shape of the gas is the effect. At 150 m
 * the shape is one bright dot for two frames, and the ONLY thing that carries
 * is that it is HDR enough to bloom. `scale` is the calibre: a rifle is 1, a
 * tripod-mounted gun is ~1.6.
 */
export function farFlash(fx, x, y, z, scale = 1) {
  const rng = fx.rng;
  let s = resetSpawn();
  s.x = x; s.y = y; s.z = z;
  s.tile = P.FLASH_CORE;
  s.size0 = 0.30 * scale;
  s.size1 = 0.52 * scale;
  s.sizeCurve = 0.35;
  s.life = 0.055;
  s.drag = 5;
  s.r0 = 1; s.g0 = 0.86; s.b0 = 0.58; s.i0 = 22 * scale;
  s.r1 = 1; s.g1 = 0.44; s.b1 = 0.12; s.i1 = 0;
  s.alphaCurve = 0.5;
  s.soft = 0.35;
  s.seed = rng.float();
  fx.emitAdd(s);

  s = resetSpawn();
  s.x = x; s.y = y; s.z = z;
  s.tile = P.FLASH_LOBE;
  s.size0 = 0.16 * scale;
  s.size1 = 0.62 * scale;
  s.sizeCurve = 0.3;
  s.life = 0.085;
  s.drag = 6;
  s.rot = rng.float() * 6.2831853;
  s.r0 = 1; s.g0 = 0.62; s.b0 = 0.26; s.i0 = 9 * scale;
  s.r1 = 1; s.g1 = 0.3; s.b1 = 0.06; s.i1 = 0;
  s.alphaCurve = 0.7;
  s.soft = 0.4;
  s.seed = rng.float();
  fx.emitAdd(s);
}

/**
 * WHERE THE ROUNDS ARE LANDING — the half of a firefight that is usually
 * missing from one.
 *
 * A distant exchange with muzzle flashes and tracers but no terminal effect
 * reads as a fireworks display: nothing is being SHOT AT. Three sprites — a
 * spark pair off the strike and one dust puff standing up off the deck — is
 * what turns a light show into somebody's position being worked over. The dust
 * is the part that carries at range; the sparks are for the near end of the
 * band.
 */
export function farImpact(fx, x, y, z, scale = 1) {
  const rng = fx.rng;
  for (let i = 0; i < 2; i++) {
    const a = rng.float() * 6.2831853;
    const sp = rng.range(3, 9);
    const s = resetSpawn();
    s.x = x; s.y = y + 0.05; s.z = z;
    s.vx = Math.cos(a) * sp * 0.4; s.vy = rng.range(2.5, 6.5); s.vz = Math.sin(a) * sp * 0.4;
    s.tile = P.STREAK;
    s.size0 = 0.035 * scale;
    s.size1 = 0.014;
    s.stretch = 1.0;
    s.life = rng.range(0.16, 0.36);
    s.drag = 1.4;
    s.gravity = -14;
    s.r0 = 1; s.g0 = 0.66; s.b0 = 0.28; s.i0 = rng.range(7, 14);
    s.r1 = 1; s.g1 = 0.2; s.b1 = 0.04; s.i1 = 0.2;
    s.alphaCurve = 0.6;
    s.soft = 0.08;
    s.seed = rng.float();
    fx.emitAdd(s);
  }
  const s = resetSpawn();
  s.x = x; s.y = y + 0.12 * scale; s.z = z;
  s.vy = rng.range(0.9, 1.8);
  s.tile = P.DUST;
  s.size0 = 0.24 * scale;
  s.size1 = 1.05 * scale;
  s.sizeCurve = 0.45;
  s.life = rng.range(0.75, 1.35);
  s.drag = 2.2;
  s.gravity = -0.4;
  s.rot = rng.float() * 6.2831853;
  s.spin = rng.signed() * 0.8;
  s.r0 = 0.40; s.g0 = 0.35; s.b0 = 0.28;
  s.r1 = 0.30; s.g1 = 0.27; s.b1 = 0.23;
  s.alpha = rng.range(0.32, 0.6);
  s.alphaCurve = 1.5;
  s.soft = 0.5;
  s.turb = 0.08; s.turbFreq = 1.3;
  s.seed = rng.float();
  fx.emitLit(s);
}

/**
 * A SHELL LANDING SOMEWHERE ELSE.
 *
 * `explode()` costs ~90 particles, a light, a smoke emitter, a refraction ring
 * and a scorch decal, all of which are correct at 12 m and none of which
 * survives the trip to 240 m — except the two that this keeps: a hot core that
 * blooms, and a column that stands up long enough to still be there when the
 * player looks over. Sixteen sprites, no pooled resource of any kind.
 *
 * `scale` is calibre-ish: 1 is a field gun, 1.8 is something heavy, and it is
 * multiplied straight into every dimension because at this range apparent size
 * IS the only cue for what calibre it was.
 */
export function farShell(fx, x, y, z, scale = 1) {
  const rng = fx.rng;
  const R = 3.2 * scale;

  // core flash — the frame you catch out of the corner of your eye
  let s = resetSpawn();
  s.x = x; s.y = y + R * 0.15; s.z = z;
  s.tile = P.FLASH_CORE;
  s.size0 = R * 0.45;
  s.size1 = R * 1.9;
  s.sizeCurve = 0.3;
  s.life = 0.1;
  s.drag = 5;
  s.r0 = 1; s.g0 = 0.93; s.b0 = 0.78; s.i0 = 40 * scale;
  s.r1 = 1; s.g1 = 0.4; s.b1 = 0.09; s.i1 = 0;
  s.alphaCurve = 0.5;
  s.soft = 0.5;
  s.seed = rng.float();
  fx.emitAdd(s);

  // fireball — four, because past three the silhouette stops changing at range
  for (let i = 0; i < 4; i++) {
    const a = rng.float() * 6.2831853;
    const sp = rng.range(2.0, 5.0) * scale;
    s = resetSpawn();
    s.x = x + Math.cos(a) * R * 0.14; s.y = y + R * 0.1; s.z = z + Math.sin(a) * R * 0.14;
    s.vx = Math.cos(a) * sp * 0.5; s.vy = rng.range(3.0, 7.0); s.vz = Math.sin(a) * sp * 0.5;
    s.tile = P.FIRE;
    s.size0 = R * rng.range(0.3, 0.5);
    s.size1 = R * rng.range(1.0, 1.5);
    s.sizeCurve = 0.34;
    s.life = rng.range(0.42, 0.8);
    s.drag = 3.0;
    s.gravity = 2.2;
    s.rot = rng.float() * 6.2831853;
    s.spin = rng.signed() * 1.6;
    s.r0 = 1; s.g0 = rng.range(0.66, 0.88); s.b0 = rng.range(0.34, 0.55);
    s.i0 = rng.range(9, 18);
    s.r1 = 1; s.g1 = 0.2; s.b1 = 0.03; s.i1 = 0.25;
    s.alphaCurve = 0.55;
    s.soft = 0.6;
    s.turb = R * 0.05; s.turbFreq = 2.2; s.seed = rng.float();
    fx.emitAdd(s);
  }

  // the column. LONG lives, because "still smoking when you look over" is the
  // entire difference between shelling and a flash in the dark.
  for (let i = 0; i < 6; i++) {
    const a = rng.float() * 6.2831853;
    s = resetSpawn();
    s.x = x + Math.cos(a) * R * 0.2; s.y = y + R * (0.1 + i * 0.13); s.z = z + Math.sin(a) * R * 0.2;
    s.vx = Math.cos(a) * rng.range(0.4, 1.6); s.vy = rng.range(2.6, 5.4); s.vz = Math.sin(a) * rng.range(0.4, 1.6);
    s.tile = i % 2 ? P.SMOKE_A : P.SMOKE_B;
    s.size0 = R * rng.range(0.35, 0.6);
    s.size1 = R * rng.range(1.9, 3.2);
    s.sizeCurve = 0.5;
    s.life = rng.range(3.4, 6.4);
    s.delay = rng.range(0.04, 0.3);
    s.drag = 1.5;
    s.gravity = 0.65;
    s.rot = rng.float() * 6.2831853;
    s.spin = rng.signed() * 0.5;
    s.r0 = 0.11; s.g0 = 0.105; s.b0 = 0.10;
    s.r1 = 0.22; s.g1 = 0.215; s.b1 = 0.21;
    s.alpha = rng.range(0.5, 0.8);
    s.alphaCurve = 1.6;
    s.soft = 0.7;
    s.turb = R * 0.09; s.turbFreq = 0.9; s.seed = rng.float();
    fx.emitLit(s);
  }

  // earth thrown up — five streaks, which is what a shell looks like at range
  for (let i = 0; i < 5; i++) {
    const a = rng.float() * 6.2831853;
    const sp = rng.range(8, 22) * scale;
    const el = rng.range(0.55, 1.0);
    s = resetSpawn();
    s.x = x; s.y = y + 0.1; s.z = z;
    s.vx = Math.cos(a) * sp * (1 - el); s.vy = sp * el; s.vz = Math.sin(a) * sp * (1 - el);
    s.tile = P.CHIP;
    s.size0 = rng.range(0.05, 0.14) * scale;
    s.size1 = s.size0;
    s.stretch = 0.5;
    s.life = rng.range(0.9, 2.0);
    s.drag = 0.5;
    s.gravity = -19;
    s.rot = rng.float() * 6.2831853;
    s.spin = rng.signed() * 20;
    s.r0 = 0.26; s.g0 = 0.22; s.b0 = 0.18;
    s.r1 = 0.2; s.g1 = 0.18; s.b1 = 0.15;
    s.alphaCurve = 0.35;
    s.soft = 0.1;
    s.seed = rng.float();
    fx.emitLit(s);
  }
}
