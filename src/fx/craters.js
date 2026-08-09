import { P } from './atlas.js';
import { resetSpawn } from './particles.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * 「爆撃されたところは硝煙、煙をもくもくさせて」 — GROUND THAT KEEPS SMOKING
 * ════════════════════════════════════════════════════════════════════════════
 *
 * A stick of ten bombs walks 120 m across the plain, and ten seconds later the
 * only thing left on the ground is a scorch decal: every plume a crater had was
 * an `Ambience.addColumn` with `duration: 2.2` and `life: 6`, so the whole line
 * had stopped smoking before the debris finished settling. That is the
 * complaint, and it is a complaint about DURATION, not about density.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A FOURTH SMOKE IMPLEMENTATION
 * ────────────────────────────────────────────────────────────────────────────
 * This repo has already paid three times for a second implementation drifting
 * from the first — the bots' throwables against the player's, on radius and
 * then twice on drawing. So this does NOT invent a puff: it is `Ambience`'s
 * `_puff` recipe with the three numbers that were fought for kept intact —
 *
 *   a BIG spawn footprint, a HIGH rate, and a SMALL `growth`, never the reverse
 *
 * — which is the lesson of 5b8d7b0 (`rad*0.22`→`rad*0.62`, growth 5.85→1.8) and
 * of `plains-cover.js` (`SMOKE_FOOT` 5.4, `SMOKE_GROWTH` 2.2). What it does not
 * reuse is the EMITTER: `Ambience` has 24 slots, six of them permanently held
 * by the plain's own banks, and a sortie lays ten craters at once on top of
 * whatever a crash, an airstrike's dust wall and two thrown cans are already
 * holding. Ten `addColumn` calls would evict all of it. So craters are their
 * own pool with their own hard share of `fx.lit`, and the two systems only ever
 * meet at `fx.lit.emit`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE BUDGET, WHICH IS THE WHOLE DESIGN
 * ────────────────────────────────────────────────────────────────────────────
 * `rate x life` IS the live sprite count, and `fx.lit` is a fixed ring — 2 805
 * instances on the default preset. It is already heavily spoken for on the
 * plain: `plains-cover.js` holds `SMOKE_SHARE` 0.48 of it (1 346 sprites) in
 * six permanent banks, and the player's own can may take a further quarter.
 * Over-subscribing the ring does not fail loudly; it silently shortens the
 * blood, the impact puffs and everything else.
 *
 * So the craters take a STATED share — `SHARE` of `fx.lit.capacity`, 0.14, or
 * about 390 sprites — and that figure is a CEILING ON THE WHOLE FIELD, not a
 * per-crater allowance. `update` re-solves the split every frame:
 *
 *     demand_i = RATE0 x envelope(age_i) x visibility(distance_i)
 *     scale    = min( 1, CAP / (SPRITE_LIFE x Σ demand_i) )
 *     rate_i   = demand_i x scale
 *
 * which answers the question "what happens when two sorties overlap" with
 * arithmetic instead of a hope: the field costs the same 390 sprites whether
 * one crater is burning or twenty-five are, and the extra craters are paid for
 * out of each other. What they are NOT paid for out of is blood, impacts or the
 * player's can, and that is the point of a fixed ceiling.
 *
 * The split is by `envelope` (a fresh crater outweighs a minute-old one, which
 * is what the eye expects anyway) and by `visibility` (a crater 200 m away is
 * a wisp so that the one 20 m away can be 「もくもく」). `VIS_FLOOR` stops the
 * far ones going to zero, because a bombed strip seen from across the map is
 * exactly the shot that was asked for.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW LONG, AND WHY THAT NUMBER
 * ────────────────────────────────────────────────────────────────────────────
 * `DURATION` 78 s, against a 61 s sortie period and a 1 200 s match. Two facts
 * decide it:
 *
 *   · Under one sortie period and the strip stops smoking before the next one
 *     lands, which is the complaint restated more slowly.
 *   · Over two and craters accumulate without bound: at 10 a sortie every 61 s
 *     a 130 s life is 21 live craters before `zoneBombard` and the satellite
 *     have added theirs, and every one of them is thinner than the last.
 *
 * 78 s sits between: about 13 craters live at steady state, ~1.3 sorties, and
 * the ground a bomb hit is still smoking when the next stick walks past it.
 * The envelope inside those 78 s is the physical one — `BILLOW` seconds at full
 * rate, an exponential decay with time constant `TAU`, and a `FLOOR` it never
 * drops below until the last `FADE` seconds taper it out so nothing pops off.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IT DOES NOT BLOCK SIGHT, FOR ANYONE, AND THAT IS DELIBERATE
 * ────────────────────────────────────────────────────────────────────────────
 * @see the note on `AiSystem._smokeBlocks`: the plain's banks were cover to the
 * camera and not to a bot, and "a screen that hides you from the player's eye
 * and not from the enemy's is worse than no screen at all". Craters take the
 * only other consistent option — cover to NEITHER — for three reasons:
 *
 *  1. There is no seam that could carry them symmetrically. `_smoke` is a
 *     six-slot ration fed by `weapon:smoke`, and that event also LATCHES the
 *     bots' idea of what a can is worth; pushing ten craters through it would
 *     evict live grenade screens and re-tune every bot's smoke to a bomb's
 *     radius. `_bank` is a scan of `userData.fxSmoke` markers in the scene, and
 *     a crater is not a scene object. Both live in `src/ai`.
 *  2. The DRAWING makes it honest rather than merely convenient. A crater plume
 *     is a RISING COLUMN — `RISE` 3.4 against the banks' 0.5, which were
 *     deliberately laid across the ground to break a sightline. Its mass is
 *     above head height within a couple of seconds, so it is not cover to the
 *     player's eye either. Photograph it from a standing eye at 30 m: the ridge
 *     line behind it stays visible under the column.
 *  3. Ten to twenty sightline-refusing volumes appearing on the objectives
 *     every 61 s is a different game. The standing complaint is that bots must
 *     keep moving and take points rather than stand off, and blinding both
 *     sides on the point is the surest way to make them stand off.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS AS A BOMB
 * ────────────────────────────────────────────────────────────────────────────
 * `consider` is called from `explode()`, which is the ONE seam every bomb on
 * either map already passes through — the line bombardment, `zoneBombard`, the
 * satellite, the airstrikes, the acts. Routing it there is what lets the
 * satellite and `zoneBombard` smoke without touching `src/match/index.js`.
 *
 * The gate is `MIN_R` on the blast radius: 11 m takes the bombs (15 / 16 / 18 /
 * 17 / 24) and leaves the cannon (8), the tank's main gun (9), the drone (7.5)
 * and every grenade below it, which is the line between "a crater" and "a hole".
 * A caller that disagrees passes `crater: false` (or `true`) on the explosion
 * payload and is obeyed.
 *
 * Two calls at the same spot are ONE crater: `zoneBombard` and the satellite
 * both emit the gameplay `explosion` AND call `fx.explosion` again for the
 * show, and the satellite walks twelve rounds through a single capture circle.
 * `MERGE_R` folds anything landing within 8 m of a crater younger than
 * `MERGE_AGE` back into it and restarts its envelope, so a walk of twelve
 * rounds is four or five craters that keep re-billowing, not twelve thin ones.
 */

const TWO_PI = Math.PI * 2;

/** Crater slots. ~13 live at steady state on the plain; the rest is headroom
 *  for two sorties overlapping plus a bombardment plus a satellite call. */
const SLOTS = 28;
/** Share of `fx.lit` the whole field may hold at once. @see the budget note. */
const SHARE = 0.14;
/** Sprite life. The plain's banks use 8.5 and the two are drawn side by side. */
const SPRITE_LIFE = 8.5;
/** Sprites/s a crater asks for at full strength, before the split. */
const RATE0 = 30;

const DURATION = 78;
const BILLOW = 5.5;
const TAU = 12;
const FLOOR = 0.085;
const FADE = 14;

/** Distance at which a crater's claim on the budget has halved. */
const NEAR = 34;
const VIS_FLOOR = 0.16;

const MERGE_R2 = 8 * 8;
const MERGE_AGE = 6;
const MIN_R = 11;

/** Spawn disc as a fraction of the blast radius, and its clamp in metres. */
const FOOT_OF_R = 0.3;
const FOOT_MIN = 2.2;
const FOOT_MAX = 6.0;
/** Sprite is `foot` across at birth and `foot * GROWTH` at death. Small on
 *  purpose: what the eye reads is the YOUNG puff. @see the header. */
const GROWTH = 2.0;
/**
 * ────────────────────────────────────────────────────────────────────────────
 * HOW PALE, AND HOW OPAQUE — MEASURED, AGAINST THE MAP'S OWN SMOKE
 * ────────────────────────────────────────────────────────────────────────────
 * `_puff` writes `dark` straight into a LIT particle's colour, and a LIT
 * particle is shaded by the sky's ambient and the sun ALONE — never by the
 * fires, which on a 50 %-night map are most of the light on the ground. So the
 * smoke is dark while the ground beside it is not, and the axis is not
 * reasonable-about: the composite multiplies by auto-exposure before AgX, and
 * three channels over the shoulder are white whatever their ratio.
 *
 * `_crateref.mjs` is the measurement, and it is built so the answer cannot be
 * an artefact of the vantage: it stands where one of `plains-cover.js`'s six
 * permanent `nf-smoke` banks is PROVED in shot — line-of-sight raycast, NDC
 * printed — puts craters 18 m either side of it at the same range, and shoots
 * the same frame at five values while the bank sits in the middle at its own
 * authored 0.62 as a fixed reference. Bank 34.2 m at ndc (0, -0.07) with ~220
 * live sprites; craters 38.5 m at ndc (±0.36) with ~205.
 *
 *   0.58 / 1.0   there, but no more so than the wreck bank beside it — which is
 *                the wrong answer for ground that was bombed ten seconds ago
 *   1.1  / 1.25  a plume, thin
 *   1.8  / 1.25  BILLOWS, and keeps its internal tonality against the ridge
 *   2.8  / 1.1   brighter and bigger, form starting to flatten into one mass
 *   14   / 1.6   a white cut-out. This is the shoulder, photographed.
 *
 * 1.9 / 1.25 is 1.8 rounded toward the light — three times the bank's 0.62,
 * which is the right RELATION and not an accident: a bank is a wreck that has
 * been burning for an hour and a crater is thirty kilos of high explosive that
 * went off ten seconds ago.
 *
 * THE FIRST CUT WAS 0.58 AND IT WAS ARGUED FROM `plains-cover.js` RATHER THAN
 * PHOTOGRAPHED, and three screenshot sets in a row were read as "the smoke is
 * not drawing at all" before `_litcheck.mjs` proved the layer was fine and the
 * vantage was the fault. Both are recorded here because the next person will
 * reach for the same 0.62.
 */
const DARK = 1.9;
const OPACITY = 1.25;
const RISE = 3.4;

/** Seconds of guttering fire in the crater seat. @see `_ember`. */
const EMBER_FOR = 9;
const EMBER_RATE = 7;

class Crater {
  constructor() {
    this.active = false;
    this.age = 0;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.foot = 3;
    this.acc = 0;
    this.eacc = 0;
    this.rate = 0;
    this.w = 0;
  }
}

export class CraterField {
  constructor(fx) {
    this.fx = fx;
    this.craters = [];
    for (let i = 0; i < SLOTS; i++) this.craters.push(new Crater());
    /** Live-sprite ceiling for the whole field, resolved off the real ring. */
    this.cap = Math.round((fx.lit?.capacity ?? 2805) * SHARE);
    this.enabled = true;
    /**
     * Held on the instance and not read from the const, so a probe can mutate
     * it between two frames of the same view. That is how `SMOKE_DARK` was
     * arrived at in `plains-cover.js` and it is the only way to compare
     * paleness against nothing else moving. @see `DARK`.
     */
    this.dark = DARK;
    /** Opacity multiplier, tunable for the same reason as `dark`. @see `OPACITY`. */
    this.opacity = OPACITY;
    /** Reported by the probes; never read by anything that draws. */
    this.stats = { live: 0, demand: 0, scale: 1, sprites: 0 };
  }

  /* --------------------------------------------------------------------- */

  /**
   * An explosion happened. Decide whether it leaves smoking ground, and where
   * that ground actually is — a bomb bursts at `RULES.blastBurstHeight` above
   * the floor and a crater smokes from the floor.
   */
  consider(x, y, z, radius, o) {
    if (!this.enabled) return;
    const want = o?.crater;
    if (want === false) return;
    if (want !== true && !(radius >= MIN_R)) return;
    const ph = this.fx.physics;
    let gy = y;
    if (ph?.groundHeight) {
      const h = ph.groundHeight(x, z, y + Math.max(6, radius * 0.5));
      if (Number.isFinite(h) && h > -1e5 && y - h < radius + 8) gy = h;
    }
    this.add(x, gy, z, radius);
  }

  /** Start (or refresh) a crater. Public so a caller may bypass the gate. */
  add(x, y, z, radius) {
    const foot = Math.min(FOOT_MAX, Math.max(FOOT_MIN, radius * FOOT_OF_R));
    // Fold into a neighbour rather than spending a slot. @see `MERGE_R`.
    let free = null;
    let worst = null;
    let worstW = Infinity;
    for (let i = 0; i < this.craters.length; i++) {
      const c = this.craters[i];
      if (!c.active) {
        if (!free) free = c;
        continue;
      }
      if (c.age < MERGE_AGE) {
        const dx = c.x - x;
        const dz = c.z - z;
        if (dx * dx + dz * dz < MERGE_R2) {
          c.age = 0;
          c.eacc = 0;
          if (foot > c.foot) c.foot = foot;
          // Drift the seat toward the new round so a walk spreads its plume.
          c.x += (x - c.x) * 0.35;
          c.z += (z - c.z) * 0.35;
          c.y = y;
          return;
        }
      }
      if (c.w < worstW) {
        worstW = c.w;
        worst = c;
      }
    }
    const c = free ?? worst;
    if (!c) return;
    c.active = true;
    c.age = 0;
    c.acc = 0;
    c.eacc = 0;
    c.rate = 0;
    c.w = 1;
    c.x = x;
    c.y = y;
    c.z = z;
    c.foot = foot;
  }

  clear() {
    for (const c of this.craters) c.active = false;
  }

  /* --------------------------------------------------------------------- */

  /**
   * The strength curve. Full for `BILLOW` seconds, then an exponential fall to
   * a smouldering `FLOOR`, then a linear taper over the last `FADE` seconds so
   * a crater goes out instead of switching off.
   */
  _envelope(t) {
    if (t >= DURATION) return 0;
    let s;
    if (t <= BILLOW) s = 1;
    else s = FLOOR + (1 - FLOOR) * Math.exp(-(t - BILLOW) / TAU);
    const left = DURATION - t;
    if (left < FADE) s *= left / FADE;
    return s;
  }

  update(dt, now, camera) {
    const list = this.craters;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;

    // ---- pass 1: age, retire, and price every crater --------------------
    let demand = 0;
    let live = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.active) continue;
      c.age += dt;
      const s = this._envelope(c.age);
      if (s <= 0) {
        c.active = false;
        c.w = 0;
        continue;
      }
      live++;
      const dx = c.x - cx;
      const dy = c.y - cy;
      const dz = c.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const vis = Math.max(VIS_FLOOR, 1 / (1 + d2 / (NEAR * NEAR)));
      c.w = s * vis;
      demand += c.w;
    }
    this.stats.live = live;
    if (!live) {
      this.stats.demand = 0;
      this.stats.scale = 1;
      this.stats.sprites = 0;
      return;
    }

    // ---- pass 2: split the ceiling and emit -----------------------------
    const total = RATE0 * demand * SPRITE_LIFE;
    const scale = total > this.cap ? this.cap / total : 1;
    this.stats.demand = total;
    this.stats.scale = scale;
    this.stats.sprites = Math.round(Math.min(total, this.cap));

    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.active) continue;
      c.rate = RATE0 * c.w * scale;
      c.acc += c.rate * dt;
      // Guard identical to `Ambience.update`: a long frame may not be allowed
      // to spend the whole ring catching up.
      let guard = 8;
      while (c.acc >= 1 && guard-- > 0) {
        c.acc -= 1;
        this._puff(c, dt);
      }
      if (guard <= 0) c.acc = 0;

      if (c.age < EMBER_FOR) {
        c.eacc += EMBER_RATE * (1 - c.age / EMBER_FOR) * dt;
        let g = 3;
        while (c.eacc >= 1 && g-- > 0) {
          c.eacc -= 1;
          this._ember(c);
        }
        if (g <= 0) c.eacc = 0;
      }
    }
  }

  /**
   * One puff. `Ambience._puff`'s recipe with a column's rise and an intensity
   * that does NOT fall to zero — `SP.i1` defaults to 0, which is right for a
   * dissipating dust puff and wrong for the top of a standing column, where it
   * takes the head of the plume to black exactly where it is highest against
   * the sky and easiest to see.
   */
  _puff(c) {
    const fx = this.fx;
    const rng = fx.rng;
    const r = c.foot;
    const s = resetSpawn();
    const a = rng.float() * TWO_PI;
    // sqrt so the disc fills by AREA and the column is not a spike.
    const rad = Math.sqrt(rng.float()) * r * 0.85;
    s.x = c.x + Math.cos(a) * rad;
    s.y = c.y + rng.range(0.1, r * 0.35);
    s.z = c.z + Math.sin(a) * rad;
    // Older smoke is a wisp off the seat rather than a column off a fireball.
    const hot = 0.42 + 0.58 * Math.min(1, c.age <= BILLOW ? 1 : this._envelope(c.age));
    const rise = RISE * hot;
    s.vx = Math.cos(a) * rng.range(0.1, 0.55) + rng.signed() * 0.3;
    s.vy = rise * rng.range(0.75, 1.3);
    s.vz = Math.sin(a) * rng.range(0.1, 0.55) + rng.signed() * 0.3;
    s.tile = rng.float() < 0.5 ? P.SMOKE_A : P.SMOKE_B;
    s.size0 = r * rng.range(0.72, 1.18);
    s.size1 = r * GROWTH * rng.range(0.85, 1.3);
    s.sizeCurve = 0.7;
    s.life = SPRITE_LIFE * rng.range(0.8, 1.2);
    s.drag = 0.72;
    s.gravity = 0.62; // buoyant
    s.rot = rng.float() * TWO_PI;
    s.spin = rng.signed() * 0.3;
    // Warm at the seat while it is still burning, grey once it is not.
    const d = this.dark;
    const warm = c.age < EMBER_FOR ? 1 - c.age / EMBER_FOR : 0;
    s.r0 = d * (1 + warm * 0.22);
    s.g0 = d * (0.95 - warm * 0.06);
    s.b0 = d * (0.9 - warm * 0.16);
    s.r1 = d * 1.32;
    s.g1 = d * 1.28;
    s.b1 = d * 1.24;
    s.i0 = 1;
    s.i1 = 0.5;
    s.alpha = rng.range(0.3, 0.55) * this.opacity;
    s.alphaCurve = 1.5;
    s.soft = 0.9;
    s.turb = r * 0.45;
    s.turbFreq = 0.38;
    s.seed = rng.float();
    fx.emitLit(s);
  }

  /**
   * The crater seat, for `EMBER_FOR` seconds. Not decoration: it is night, the
   * only key light on the map is a ridge on the horizon, and a grey column with
   * nothing under it has no reason to be brighter than the ground. A handful of
   * additive embers give the base of the plume a source, which is what makes a
   * fresh crater legible as a fresh crater at 100 m.
   */
  _ember(c) {
    const fx = this.fx;
    const rng = fx.rng;
    const s = resetSpawn();
    const a = rng.float() * TWO_PI;
    const rad = Math.sqrt(rng.float()) * c.foot * 0.55;
    s.x = c.x + Math.cos(a) * rad;
    s.y = c.y + rng.range(0.05, 0.5);
    s.z = c.z + Math.sin(a) * rad;
    s.vx = rng.signed() * 0.4;
    s.vy = rng.range(0.8, 2.6);
    s.vz = rng.signed() * 0.4;
    s.tile = rng.float() < 0.3 ? P.FIRE : P.SPARK;
    const big = s.tile === P.FIRE;
    s.size0 = big ? rng.range(0.3, 0.75) : rng.range(0.006, 0.016);
    s.size1 = big ? s.size0 * 1.5 : s.size0 * 0.4;
    s.life = big ? rng.range(0.5, 1.1) : rng.range(0.9, 2.2);
    s.drag = big ? 1.6 : 0.9;
    s.gravity = big ? 1.4 : 1.1;
    s.rot = rng.float() * TWO_PI;
    s.spin = rng.signed() * 1.4;
    s.r0 = 1; s.g0 = big ? 0.52 : 0.5; s.b0 = 0.14;
    s.i0 = big ? rng.range(4, 9) : rng.range(3, 8);
    s.r1 = 0.9; s.g1 = 0.14; s.b1 = 0.02; s.i1 = 0.1;
    s.flags = big ? 0 : 1;
    s.alphaCurve = 1.1;
    s.turb = 0.14;
    s.turbFreq = 1.5;
    s.soft = 0.2;
    s.seed = rng.float();
    fx.emitAdd(s);
  }
}
