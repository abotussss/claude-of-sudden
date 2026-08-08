import { fbm3, rockGeometry, domeGeometry } from '../util.js';
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
 * So: two passes, both of them relief, neither of them a blade of grass.
 *
 *   PANS     bedrock breaking the surface, under 0.35 m proud. The only hard
 *            edge on the plain, and the only thing on it that is not soft.
 *   HUMMOCKS the mound of soil a tuft of grass actually stands on. Grazed
 *            steppe is not a lawn on a table; it is a field of low domes with
 *            scoured ground between them, and `nf_tussock` above is the plant
 *            without the mound. Small count, because these sit UNDER somebody
 *            else's vegetation rather than beside it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THERE WERE TWO MORE, AND THEY ARE DELETED. 「この地面テクスチャーが浮いてます
 * 至る所で 消して」
 * ────────────────────────────────────────────────────────────────────────────
 * ~1 100 SHEETS (4-17 m discs of a different soil, domed by 10-42 cm) and
 * ~1 600 SCARS (wind blowouts, a dish with its spoil on the lee lip). Both were
 * a horizontal sheet lying ON the plain, and both are gone.
 *
 * THEY WERE ALREADY "FIXED" ONCE AND THE COMPLAINT DID NOT MOVE. The first
 * diagnosis was that a rigid disc placed at `groundY` under its own CENTRE
 * stands proud at its rim on a swell — measured, 1 936 of them over 0.5 m, worst
 * 6.01 m — so they were draped per vertex with `conformToGround`. That
 * measurement was true and it was not the defect the user was photographing,
 * because:
 *
 *   A HORIZONTAL SURFACE AT NIGHT, WHEN THE ONLY KEY LIGHT IS A BURNING RIDGE
 *   AT GROUND LEVEL, RENDERS BLACK WHATEVER ITS MATERIAL AND WHATEVER ITS
 *   HEIGHT.
 *
 * The key light on this map arrives along the horizon. N·L on an up-facing
 * surface is therefore ~0, and every up-facing surface goes to the ambient
 * floor — so a sheet lying flat on the ground photographs as a hard-edged black
 * quadrilateral over the lit steppe, and is INDISTINGUISHABLE from a slab
 * floating over it. That is the same arithmetic that made a fuel dump 40 m up
 * read as a ceiling (`plains-fort.js`, the `fuelBund` argument order). "It is
 * correctly conformed to the ground" and "it looks like a black hole in the
 * map" were both true at once, which is why conforming them did not help.
 *
 * The relief passes below are kept: a hummock and a pan are MASSES with a lit
 * side and a shaded side, and a surface with a normal that is not straight up
 * is a surface the ridge can light. That is the whole difference, and it is why
 * the answer is "delete the sheets" rather than "make the sheets brighter".
 *
 * WHAT MOVED. This file's `rng` is one stream in sequence, so removing the two
 * loops re-rolls everything drawn after them: the HUMMOCKS AND THE PANS ARE IN
 * NEW PLACES. Neither carries a collision proxy, appears in the nav height
 * field or is reachable by `_scatterblock`, so nothing measurable moved with
 * them. No other file draws from this seed.
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

  // ────────────────────────────────────────────────────── the prototypes ──
  /**
   * The two instanced kinds. `collide` is not declared on either — @see the
   * header — and the hummock does not cast: it is a 0.2 m dome and its shadow is
   * a pixel, but three thousand of them in a cascade are not.
   *
   * ────────────────────────────────────────────────────────────────────────
   * A PROTOTYPE'S GEOMETRY IS NOT DISPOSED HERE, and the distinction matters.
   * A geometry handed to `A.add` is COPIED into the merge accumulator on the
   * spot, so disposing it afterwards is right — that is what the deleted sheet
   * and scar passes used a `geos` list for. A geometry handed to `A.proto` is
   * held by REFERENCE until `finalize` builds the `InstancedMesh` from it, so
   * there is nothing left in this file to dispose: `props.js` registers thirty
   * of these and disposes none.
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

  console.info(`[world] nachtfeld ground: ${pans} pans, ${hummocks} hummocks — no collision, no flat sheets`);
  return { sheets: 0, scars: 0, pans, hummocks };
}
