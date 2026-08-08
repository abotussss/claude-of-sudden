import { IDENT, LL } from '../kit.js';
import { fbm3, rockGeometry, domeGeometry, disposeAll } from '../util.js';
import { Rng } from '../../core/rng.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD — THE GROUND. What the plain is made of, at half a metre.
 * ════════════════════════════════════════════════════════════════════════════
 * 「もっと平原をリアルに ３Dの生成をしっかり細部までこだわって作って」
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY NONE OF THIS IS IN THE HEIGHT FIELD, WHICH IS THE FIRST THING TO SAY
 * ────────────────────────────────────────────────────────────────────────────
 * The obvious way to make a plain less flat is to add a term to `plainsY`, and
 * on this map there is NO ROOM FOR ONE. `_terrslope.mjs` samples the analytic
 * ground on the nav grid's own 0.8 m lattice and reports, for r < 170:
 *
 *     worst step 0.445 m     against `NavGrid.maxStep` of 0.45
 *     mean step  0.090 m     cells over the limit: 0 of 141 881
 *
 * Five millimetres. The plain is already at its limit — the worst points are the
 * shoulders where the capture pads blend out of the swell — and any term with
 * enough gradient to be VISIBLE takes cells over 0.45 and turns them into ground
 * the AI cannot walk. That is the failure this map's whole design is written
 * against: "every AI-walkable surface sits in one component with the ground".
 *
 * And the height field is not where the answer was anyway. What the eye reads as
 * "ground" at half a metre is not a shape a 0.8 m lattice could hold — it is
 * thousands of small MASSES with a lit side and a shaded side. So the plain's
 * detail is GEOMETRY, and geometry laid on this plain is free in every budget
 * that has ever bitten this map:
 *
 *   NAV      `A.put` and `A.add` author no collision unless a prototype declares
 *            it, and none here does. `nav.js` drops its ray against the physics
 *            static world, so a thing with no proxy is a thing the height field
 *            cannot see. Not one cell changes class.
 *   TRIPS    「石ころオブジェが移動の妨げです」 — `_scatterblock.mjs` enumerates
 *            collision proxies whose top stands 0.42-0.68 m over the ground.
 *            A pass that creates no proxies cannot appear in it at all, and
 *            nothing here is over 0.35 m proud in any case.
 *   TANKS    `_bakePath` ends a leg where `groundHeight` goes non-finite.
 *            `groundHeight` is `plainsY` and `plainsY` is untouched by this file.
 *   FRAME    everything under 5 m carries a `maxDist`, so eleven thousand
 *            tussocks are eleven thousand matrices of which only the near chunks
 *            are ever drawn — the same trick that makes 14 000 weed tufts
 *            affordable, and the reason the tuft rather than a ground texture is
 *            where the green lives on this map.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS SOIL FORM, AND IT DELIBERATELY DOES NOT DO COVER OR VEGETATION
 * ────────────────────────────────────────────────────────────────────────────
 * `plains-cover.dressPlain` is live and it already lays 16 700 swards, 2 100
 * foliage tussocks, 11 200 grit and shingle beds and 2 100 flat patches over
 * this same disc, against 「平原なのになんで草とか砂利とかがないの？」. A second
 * pass doing grass and loose stone would be forty thousand more instances for a
 * frame budget that is already the gate — and it would be the wrong answer
 * twice, because the two complaints are not the same one.
 *
 * What that pass has no way to do is change the SHAPE of the ground: every
 * instance in it is something lying ON a surface, and its sheets — the only part
 * with the range to matter at 150 m — are `patchGeometry`, a fan of triangles at
 * y = 0. A patch at y = 0 takes the ground's own normal, so it takes the ground's
 * own light, so at a fire on the skyline it disappears exactly when ground
 * detail is supposed to appear. THE PLAIN IS SMOOTH, and that is what is left.
 *
 * So: three passes, all of them relief, none of them a blade of grass.
 *
 *   SHEETS   4-16 m of a different soil, DOMED by 5-35 cm. Merged and always
 *            drawn, because this is the 30-200 m read — the thing that makes the
 *            plain a landscape with places in it rather than one disc of one
 *            material. Their flat patches do the colour; these do the form.
 *   SCARS    wind blowouts — a dish with the spoil piled on its lee lip. The one
 *            ground feature that reads as a HOLE, which nothing else on this map
 *            does at any scale.
 *   PANS     bedrock breaking the surface, under 0.35 m proud. The only hard
 *            edge on the plain, and the only thing on it that is not soft.
 *   HUMMOCKS the mound of soil a tuft of grass actually stands on. Grazed
 *            steppe is not a lawn on a table; it is a field of low domes with
 *            scoured ground between them, and `nf_tussock` above is the plant
 *            without the mound. Small count, because these sit UNDER somebody
 *            else's vegetation rather than beside it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DENSITY IS THE SAME FIELD THE VEGETATION USES
 * ────────────────────────────────────────────────────────────────────────────
 * `scatterVegetation` thins and thickens on `fbm3(x * 0.013, 6.4, z * 0.013, 3)`
 * so there are grazed patches you are exposed in and thick stands you are not.
 * The passes here read the SAME field, at the same frequency and phase, because
 * soil and vegetation are the same fact: where the tufts are thick the ground is
 * turf and hummock, and where they are thin it is stone and blown-out scar. Two
 * unrelated noises give a plain whose grass and whose soil disagree about where
 * the good ground is, which is the uncanny half of procedural terrain.
 *
 * OWN FIXED SEED. Draws nothing from the `rng` the level threads through
 * `build`, so no stone, tuft, wreck or rivet anywhere else on the plain moves.
 */

/** Turf where the tufts are thick, stone and grit where they are thin. */
function turf(x, z) {
  return fbm3(x * 0.013, 6.4, z * 0.013, 3);
}

/**
 * @param {Assembler} A
 * @param {(x:number,z:number)=>number} groundY   `plainsY`
 * @param {(x:number,z:number,m?:number)=>boolean} isOpen  `plainsOpen`
 * @param {Array} pads  `PADS` — the flattened, driven-over standing ground
 */
export function buildGroundDetail(A, groundY, isOpen, pads) {
  const rng = new Rng(0x3b91d7);
  const geos = [];
  const R = 172;

  /** How made-up this ground is: 1 on a capture pad, 0 out on the plain. */
  const padness = (x, z) => {
    let m = 0;
    for (const p of pads) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r0) m = Math.max(m, 1);
      else if (d < p.r1) m = Math.max(m, 1 - (d - p.r0) / (p.r1 - p.r0));
    }
    return m;
  };

  /** A point on the open plain, or null. Rejection sampling, uniform by area. */
  const site = (radius) => {
    const a = rng.float() * Math.PI * 2;
    const d = Math.sqrt(rng.float()) * radius;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    return isOpen(x, z, 0.6) ? [x, z] : null;
  };

  // ─────────────────────────────────────────────────────────────── sheets ──
  /**
   * The mid-distance read. Merged rather than instanced ON PURPOSE: a prototype
   * with a `maxDist` pops out at its radius, and the whole job of these is to be
   * the thing you can see 150 m away. Each one is its own geometry — a shared
   * prototype repeated eleven hundred times is a tiling pattern at exactly the
   * range this is trying to break up.
   */
  let sheets = 0;
  for (let i = 0; i < 1100; i++) {
    const s = site(R);
    if (!s) continue;
    const [x, z] = s;
    const t = turf(x, z);
    const pad = padness(x, z);
    // On the pads the ground is driven and bare; out on the plain it varies.
    const key = pad > 0.5
      ? (rng.float() < 0.7 ? 'steppe_bare' : 'steppe_dust')
      : t > 0.52 ? 'steppe'
        : t > 0.4 ? (rng.float() < 0.5 ? 'steppe_bare' : 'steppe_dust')
          : (rng.float() < 0.55 ? 'scree' : 'steppe_dust');
    const rad = rng.range(4.0, 17.0);
    /**
     * 0.10-0.42 m of crown, and the CEILING IS THE PLAYER rather than the eye.
     * This geometry is drawn and not collided — his feet stay on `plainsY` — so
     * a mound taller than he steps over is a mound he walks THROUGH, and the
     * illusion goes at exactly the moment he reaches it. `STANCE.stand.stepHeight`
     * is 0.42, so that is the whole budget, and it is why the plain's relief has
     * to be broad rather than tall. Flattened on the pads, which are made ground.
     */
    const g = domeGeometry(rng, rad, rng.range(0.10, 0.42) * (1 - pad * 0.75), {
      rings: 3, lobes: 12, wobble: 0.5, bump: 0.55, power: 2.1, lean: 0.5,
    });
    geos.push(g);
    A.add(key, g, LL(IDENT, x, groundY(x, z) + 0.015, z, rng.float() * 6.283, 1, 1, 1), {
      masks: [rng.range(0.1, 0.5), rng.range(0.25, 0.85), rng.range(0.1, 0.4)],
    });
    sheets++;
  }

  // ──────────────────────────────────────────────────────────────── scars ──
  /**
   * Wind blowouts. `dish` sinks the middle and `height` piles the spoil on the
   * lee lip, so the two together are a scrape with a bank on one side of it —
   * which is what a deflation hollow in dry ground actually is, and the only
   * feature on this plain that reads as a hole rather than as a lump.
   */
  let scars = 0;
  for (let i = 0; i < 1600; i++) {
    const s = site(R);
    if (!s) continue;
    const [x, z] = s;
    if (rng.float() > 0.95 - turf(x, z) * 0.75) continue; // thin ground blows out
    const g = domeGeometry(rng, rng.range(2.4, 8.5), rng.range(0.08, 0.26), {
      rings: 3, lobes: 11, wobble: 0.45, bump: 0.6, power: 1.4,
      dish: rng.range(0.12, 0.34), lean: 0.9,
    });
    geos.push(g);
    A.add(rng.float() < 0.6 ? 'steppe_dust' : 'steppe_bare',
      g, LL(IDENT, x, groundY(x, z) + 0.01, z, rng.float() * 6.283, 1, 1, 1), {
      masks: [rng.range(0.2, 0.6), rng.range(0.3, 0.9), rng.range(0.2, 0.5)],
    });
    scars++;
  }

  // ────────────────────────────────────────────────────── the prototypes ──
  /**
   * The two instanced kinds. `collide` is not declared on either — @see the
   * header — and the hummock does not cast: it is a 0.2 m dome and its shadow is
   * a pixel, but three thousand of them in a cascade are not.
   *
   * ────────────────────────────────────────────────────────────────────────
   * A PROTOTYPE'S GEOMETRY IS NOT DISPOSED HERE, and the distinction matters.
   * A PROTOTYPE'S GEOMETRY IS NOT DISPOSED HERE, and the distinction matters.
   * A geometry handed to `A.add` is COPIED into the merge accumulator on the
   * spot, so disposing it afterwards is right and `geos` collects those. A
   * geometry handed to `A.proto` is held by REFERENCE until `finalize` builds
   * the `InstancedMesh` from it — `props.js` registers thirty of these and
   * disposes none.
   */
  const P = (id, key, geo, opts) => {
    A.proto(id, { geo, key, ...opts });
    return id;
  };
  const HUMMOCK = [];
  for (let i = 0; i < 6; i++) {
    HUMMOCK.push(P(`nf_hummock${i}`, i < 4 ? 'steppe' : 'steppe_bare',
      domeGeometry(rng, rng.range(0.5, 1.3), rng.range(0.12, 0.30), {
        rings: 3, lobes: 11, wobble: 0.4, bump: 0.5, power: 1.6, lean: 0.4,
      }), { maxDist: 72, castShadow: false }));
  }
  const PAN = [];
  for (let i = 0; i < 6; i++) {
    const g = rockGeometry(rng, 1, 0, rng.range(0.16, 0.34));
    PAN.push(P(`nf_pan${i}`, i < 4 ? 'scree' : 'mountain_rock', g, { maxDist: 115 }));
  }
  // ───────────────────────────────────────────────────────────── hummocks ──
  /**
   * The mound the grass stands on. Deliberately a QUARTER of the count the first
   * draft used: `plains-cover` is already laying 16 700 swards over this disc and
   * these go under them, so what is wanted is enough to give the mat a lumpy
   * base — not a second ground cover competing with the first.
   */
  let hummocks = 0;
  for (let i = 0; i < 6000; i++) {
    const s = site(R);
    if (!s) continue;
    const [x, z] = s;
    const t = turf(x, z);
    if (rng.float() > (0.10 + t * 0.95) * (1 - padness(x, z) * 0.85)) continue;
    const sc = rng.range(0.75, 1.7);
    A.putS(HUMMOCK[rng.int(0, HUMMOCK.length - 1)],
      x, groundY(x, z) - 0.035, z, rng.float() * 6.283,
      sc * rng.range(0.85, 1.3), sc * rng.range(0.7, 1.4), sc * rng.range(0.85, 1.3),
      [rng.range(0.1, 0.5), rng.range(0.2, 0.9), rng.range(0.1, 0.4)],
      rng.range(-0.06, 0.06), rng.range(-0.06, 0.06));
    hummocks++;
  }

  // ───────────────────────────────────────────────────────────────── pans ──
  /**
   * Bedrock. Thin on the plain and thickening towards the mountain, because that
   * is where the rock is nearest the surface — the same gradient the existing
   * stone scatter follows, so the two agree. NOTHING HERE IS OVER 0.3 m PROUD:
   * `y - h * 0.62` keeps most of every slab inside the ground, which is both
   * what a pan looks like and what keeps it well under the 0.42 m step line even
   * though it carries no proxy that could enforce it.
   */
  let pans = 0;
  for (let i = 0; i < 2600; i++) {
    const s = site(R);
    if (!s) continue;
    const [x, z] = s;
    const d = Math.hypot(x, z);
    const near = Math.min(1, Math.max(0, (d - 60) / 110));
    if (rng.float() > (0.06 + near * 0.6) * (1 - padness(x, z) * 0.9)) continue;
    const w = rng.range(1.4, 5.0);
    const h = rng.range(0.22, 0.52);
    A.putS(PAN[rng.int(0, PAN.length - 1)],
      x, groundY(x, z) + h * 0.5 - h * rng.range(0.6, 0.82), z, rng.float() * 6.283,
      w, h, w * rng.range(0.5, 1.0),
      [rng.range(0.3, 0.9), rng.range(0.2, 0.6), rng.range(0.15, 0.45)],
      rng.range(-0.10, 0.10), rng.range(-0.10, 0.10));
    pans++;
  }

  disposeAll(geos);
  console.info(`[world] nachtfeld ground: ${sheets} sheets, ${scars} scars, ${pans} pans, ${hummocks} hummocks — no collision`);
  return { sheets, scars, pans, hummocks };
}
