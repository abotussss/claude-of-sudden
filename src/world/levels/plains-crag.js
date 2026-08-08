import { IDENT, LL } from '../kit.js';
import { fbm3, ridged3, rockGeometry, domeGeometry, disposeAll } from '../util.js';
import { Rng } from '../../core/rng.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD — THE CRAGS. What the mountain is MADE of, above the rim.
 * ════════════════════════════════════════════════════════════════════════════
 * 「山もリアルに ３Dの生成をしっかり細部までこだわって作って」
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY A HEIGHT FIELD IS NOT ENOUGH, WHICH IS THE WHOLE ARGUMENT FOR THIS FILE
 * ────────────────────────────────────────────────────────────────────────────
 * `ridgeRelief` in `plains.js` gives the mountain buttresses, cirques and ±6 m
 * of crag, and it is drawn at 1.59 m quads. That is a real mountain SHAPE and it
 * is as far as a height field can go, because a height field has one surface per
 * (x, z) and every real rock face is the opposite of that: it OVERHANGS, it has
 * blocks standing off it, it has slabs that have slid and stopped, and it has a
 * bottom edge buried in the debris that came off its own top. None of those
 * exist in a Float32 per column.
 *
 * So the shape is the field's and the MASS is here. Four passes, and each one is
 * a thing you can point at on a photograph of a mountain:
 *
 *   RIBS    bedrock ribs running up the fall line, where the face is steepest
 *           and the debris has slid off it. These are the light and shade: a rib
 *           has a lit side and a dark side and the smooth field between two of
 *           them does not.
 *   SLABS   flat plates lying at the bedding angle. One characteristic of real
 *           rock that no noise function produces is that its breaks are PLANAR
 *           and roughly PARALLEL — a mountain is a stack, not a lump — and a few
 *           hundred squashed masses all tilted the same way say so instantly.
 *   TEETH   the skyline. Everything above is invisible in silhouette; the crest
 *           is the only part of a mountain most players ever look at, and a
 *           smooth crest line is the single loudest tell of generated terrain.
 *   TALUS   the debris apron below, which is what stops the face from meeting
 *           the ground on a drawn line. `driftBerm` does this job for a wall on
 *           the town; here it is `domeGeometry` fans plus loose blocks.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE FOUR RULES THIS PASS IS UNDER, ALL OF THEM SOMEBODY ELSE'S MEASUREMENT
 * ────────────────────────────────────────────────────────────────────────────
 *  1. NOTHING INSIDE r 186. That is `plains-rim.js`'s band and `plainsOpen`'s
 *     boundary; the rim's clip ring stops the player at 178 and its boulders are
 *     placed off `groundY` between 173 and 178.4. @see `RIDGE_RB` in `plains.js`.
 *  2. NO COLLISION, AND THEREFORE NO PROXY. `A.add` authors none. This is past
 *     the boundary — nobody can touch it — and a solid out here would be a wall
 *     for a round (`MASK.BULLET` does contain the world) on a map whose whole
 *     point is the 300 m shot. The rim's talus follows the same rule and says so.
 *  3. ITS OWN SEED. `new Rng(0x5ac4e1)`, drawing nothing from the `rng` the
 *     level threads through `build`, so not one stone or tuft anywhere else on
 *     the plain moves because this file exists.
 *  4. MERGED, NOT INSTANCED. `A.put` prototypes carry `maxDist` and vanish; the
 *     crest of a mountain 200 m away is exactly the thing that must not. ~86 k
 *     triangles in three existing draw batches, always drawn, on a map at 4.3 M.
 */

/** Where the rim's rock ends and this file's begins. Mirrors `RIDGE_RB`. */
const R_START = 186;

/**
 * How far up the FALL LINE a piece is bedded, from the local gradient.
 *
 * A block sitting plumb on a 55° face is a block hovering on one corner, and a
 * hundred of them is a field of dice thrown at a hill. Real debris lies with its
 * flat on the slope. So every mass here is tilted so its own +Y leans onto the
 * surface normal — and the tilt has to be computed in the piece's OWN frame,
 * because three composes `YXZ` as `Ry * Rx * Rz` and the yaw is applied LAST:
 * a tilt authored in world axes comes out rotated by the yaw and beds the block
 * into a slope that is not there.
 *
 * So the surface normal is pushed back through `Ry(-yaw)` first, and the two
 * remaining angles are read off it. `lean` under 1 leaves the piece slightly
 * proud of true, which is what keeps a bedded field from looking shrink-wrapped.
 */
function bedTo(groundY, x, z, yaw, lean = 0.85, h = 1.4) {
  const dx = (groundY(x + h, z) - groundY(x - h, z)) / (2 * h);
  const dz = (groundY(x, z + h) - groundY(x, z - h)) / (2 * h);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Ry(-yaw) applied to the surface normal (-dx, 1, -dz)
  const px = -dx * c + dz * s;
  const pz = -dx * s - dz * c;
  return {
    rx: Math.atan(pz) * lean,
    rz: -Math.atan(px) * lean,
    grade: Math.hypot(dx, dz),
  };
}

/** Scale a geometry in place so its bounding box is a unit cube at the origin. */
function normalise(g) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  const sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
  const cx = (b.max.x + b.min.x) / 2, cy = (b.max.y + b.min.y) / 2, cz = (b.max.z + b.min.z) / 2;
  const pa = g.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    pa.setXYZ(i, (pa.getX(i) - cx) / (sx || 1), (pa.getY(i) - cy) / (sy || 1), (pa.getZ(i) - cz) / (sz || 1));
  }
  pa.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
}

/**
 * @param {Assembler} A
 * @param {(x:number,z:number)=>number} groundY  the analytic plain, `plainsY`
 * @param {{r0:number,r1:number,height:number}} ridge  `PLAINS.ridge`
 */
export function buildCrags(A, groundY, ridge) {
  const rng = new Rng(0x5ac4e1);
  const geos = [];
  const R1 = ridge.r1;

  /**
   * Two pools, both normalised to a unit cube so the scale arguments below mean
   * exactly what they say. `rockGeometry`'s radius is multiplied by an fbm in
   * 0.62-1.34, so an un-normalised "6 m block" is anything from 3.7 to 8 m —
   * the same trap `plains-rim.js` documents, and the same fix.
   */
  const BLOCK = [];
  for (let i = 0; i < 16; i++) {
    const g = rockGeometry(rng, 1, 1, rng.range(0.55, 0.95));
    normalise(g);
    geos.push(g);
    BLOCK.push(g);
  }
  /**
   * Plates: the same generator squashed, for bedding planes.
   *
   * 0.30-0.55 AND NOT 0.14-0.30, which the first draft used and which was wrong
   * in a way only a photograph shows. A plate that thin is a BLADE: seen from
   * the side it is a dark line with no lit face, and a face covered in them
   * reads as a scatter of black shards stuck on rather than as rock that has
   * split along its bedding. What says "bedded" is the STEP between one plate
   * and the next, and a step needs thickness to cast.
   */
  const PLATE = [];
  for (let i = 0; i < 12; i++) {
    const g = rockGeometry(rng, 1, 1, rng.range(0.3, 0.55));
    normalise(g);
    geos.push(g);
    PLATE.push(g);
  }
  /** 20-tri masses for the debris, which carries no silhouette. */
  const CHIP = [];
  for (let i = 0; i < 14; i++) {
    const g = rockGeometry(rng, 1, 0, rng.range(0.5, 0.9));
    normalise(g);
    geos.push(g);
    CHIP.push(g);
  }

  const pick = (pool) => pool[rng.int(0, pool.length - 1)];
  const mask = () => [rng.range(0.4, 0.95), rng.range(0.2, 0.7), rng.range(0.15, 0.45)];

  /**
   * WHERE THE ROCK IS EXPOSED, as a field in [0, 1].
   *
   * Not uniform, and the non-uniformity is most of the read. A mountain face is
   * bare where it is steep and where a buttress stands out of it, and buried
   * where the debris off those buttresses has collected between them. The same
   * `ridged3` the height field uses for its buttresses is sampled here, in
   * METRES of arc so the two agree about where a buttress is — the rock sits on
   * the ribs the shape already has, rather than in a second, unrelated pattern.
   */
  const exposure = (x, z, grade) => {
    const s = Math.atan2(z, x) * R1;
    const butt = ridged3(s * 0.011, 3.7, 1.9, 3);
    const patch = fbm3(x * 0.02 + 3.1, 5.5, z * 0.02, 3);
    return Math.min(1, Math.max(0, (grade - 0.45) * 0.9)) * (0.25 + 0.75 * butt) * (0.35 + 0.9 * patch);
  };

  let ribs = 0, slabs = 0, teeth = 0, debris = 0;

  // ───────────────────────────────────────────────────────────────── ribs ──
  /**
   * Bedrock ribs. Long in the fall line, narrow across it, and half buried:
   * `y - h * 0.34` puts a third of every mass inside the hill so it grows out of
   * the face instead of resting on it.
   */
  for (let i = 0; i < 3200; i++) {
    const a = rng.float() * Math.PI * 2;
    const rr = R_START + Math.sqrt(rng.float()) * 46;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    const y = groundY(x, z);
    /**
     * The long axis runs DOWN THE FALL LINE and the jitter on it is small.
     * A rib is an outcrop of one bed following the slope; scattered yaws make
     * the same masses read as rubble, which is what the debris pass is for.
     */
    const yaw = a + Math.PI / 2 + rng.range(-0.22, 0.22);
    const bed = bedTo(groundY, x, z, yaw);
    if (rng.float() > exposure(x, z, bed.grade)) continue;
    const h = rng.range(1.4, 4.4);
    A.add('mountain_rock', pick(BLOCK), LL(
      IDENT, x, y + h * 0.5 - h * 0.40, z, yaw,
      rng.range(2.2, 5.5), h, rng.range(8.0, 22.0),
      bed.rx + rng.range(-0.1, 0.1), bed.rz + rng.range(-0.1, 0.1)
    ), { masks: mask() });
    ribs++;
  }

  // ──────────────────────────────────────────────────────────────── slabs ──
  /**
   * Bedding planes. Every plate on this mountain leans the SAME way — one dip
   * direction and one dip angle for the whole massif, jittered by a few degrees
   * — because that is what a bedded rock does and it is the one property of a
   * cliff that a noise field will never produce on its own. `DIP` is authored,
   * not drawn from the stream, so it is the mountain's geology and not a seed.
   */
  const DIP = 0.42;
  const DIP_DIR = 1.15;
  for (let i = 0; i < 2400; i++) {
    const a = rng.float() * Math.PI * 2;
    const rr = R_START + 3 + Math.sqrt(rng.float()) * 42;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    const y = groundY(x, z);
    const bed = bedTo(groundY, x, z, 0, 1);
    if (bed.grade < 0.5) continue;
    if (rng.float() > 0.35 + exposure(x, z, bed.grade) * 0.8) continue;
    const yaw = DIP_DIR + rng.range(-0.35, 0.35);
    const w = rng.range(4.5, 12.0);
    const th = rng.range(1.0, 2.6);
    /**
     * SUNK, not floated. `+0.9` here in the first draft put a third of the
     * plates hanging clear of a 55° face — on a slope, "a little above the
     * ground" is "a little out in the air". Every plate now has at least a
     * quarter of its own thickness inside the hill.
     */
    A.add('mountain_rock', pick(PLATE), LL(
      IDENT, x, y + th * 0.5 - th * rng.range(0.55, 0.9), z, yaw,
      w, th, w * rng.range(0.55, 1.0),
      DIP + rng.range(-0.14, 0.14), rng.range(-0.16, 0.16)
    ), { masks: mask() });
    slabs++;
  }

  // ──────────────────────────────────────────────────────────────── teeth ──
  /**
   * THE SKYLINE, and it is the only part of this file most players will ever
   * consciously see. Placed on a band straddling the crest so each tooth breaks
   * the ridge line from BOTH sides — a mass wholly in front of the crest reads
   * as a bump on the face, and only one that crosses it changes the silhouette.
   *
   * Tall and narrow, leaning off plumb, and NOT bedded to the surface: a summit
   * tor stands up out of its own mountain, which is what makes a crest read as
   * broken rather than as scalloped.
   */
  /**
   * IN CLUSTERS, AND THE CLUSTERING IS THE POINT. 460 teeth drawn independently
   * came out evenly spaced and within a factor of three of one height, and at
   * 150 m an evenly spaced row of similar masses on a ridge line reads as a
   * HEDGE. Rock does not distribute itself: it stands in tors, a few masses of
   * one size together with bare crest between them, and the size varies by an
   * order of magnitude from one tor to the next. So the outer loop chooses a
   * place and a SCALE, and the inner loop builds a group at that scale.
   */
  for (let i = 0; i < 210; i++) {
    const a = rng.float() * Math.PI * 2;
    const s = a * R1;
    // tors stand on the buttresses, as they do on a real arete
    if (rng.float() > 0.16 + 0.84 * ridged3(s * 0.011, 3.7, 1.9, 3)) continue;
    /** One scale for the whole tor: 3 m boulders or a 14 m stack. */
    const S = rng.range(0.45, 1.0) ** 2.2;
    const rr0 = R1 + rng.range(-10, 8);
    const n = rng.int(2, 6);
    for (let k = 0; k < n; k++) {
      const aa = a + rng.range(-0.028, 0.028);
      const rr = rr0 + rng.range(-6, 6);
      const x = Math.cos(aa) * rr;
      const z = Math.sin(aa) * rr;
      const y = groundY(x, z);
      const h = (2.6 + 13.0 * S) * rng.range(0.55, 1.15);
      A.add('mountain_rock', pick(BLOCK), LL(
        IDENT, x, y + h * 0.5 - h * 0.30, z, rng.float() * 6.283,
        h * rng.range(0.35, 0.8), h, h * rng.range(0.35, 0.8),
        rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)
      ), { masks: mask() });
      teeth++;
    }
  }

  // ──────────────────────────────────────────────────────────────── talus ──
  /**
   * The debris apron. Fans of the mountain's own gravel spilling off the face
   * onto the band the terrain already draws in `scree`, plus loose blocks
   * scattered through them, thinning upward — because everything that has come
   * off this face has ended up at the bottom of it.
   *
   * `domeGeometry` with a `lean` gives each fan a windward and a lee side, so a
   * fan is a fan and not a cone, and its rim closes at ground level so it has no
   * lip to catch the light on.
   */
  for (let i = 0; i < 330; i++) {
    const a = rng.float() * Math.PI * 2;
    const rr = R_START + rng.range(-3, 14);
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    const y = groundY(x, z);
    const g = domeGeometry(rng, rng.range(3.5, 11.0), rng.range(0.5, 2.2), {
      rings: 4, lobes: 13, wobble: 0.42, bump: 0.5, power: 1.5, lean: 0.55,
    });
    geos.push(g);
    A.add('scree', g, LL(IDENT, x, y - 0.06, z, rng.float() * 6.283, 1, 1, 1), {
      masks: [rng.range(0.3, 0.7), rng.range(0.3, 0.8), rng.range(0.2, 0.4)],
    });
    debris++;
  }
  for (let i = 0; i < 1500; i++) {
    const a = rng.float() * Math.PI * 2;
    const rr = R_START + Math.sqrt(rng.float()) * 34;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    // debris thins upward: what fell is at the bottom
    if (rng.float() > 1.05 - (rr - R_START) / 40) continue;
    const y = groundY(x, z);
    const yaw = rng.float() * 6.283;
    const bed = bedTo(groundY, x, z, yaw, 0.9);
    const s = rng.range(0.5, 2.6);
    A.add('mountain_rock', pick(CHIP), LL(
      IDENT, x, y + s * 0.12, z, yaw,
      s * rng.range(0.9, 1.9), s * rng.range(0.4, 0.8), s * rng.range(0.9, 1.9),
      bed.rx + rng.range(-0.2, 0.2), bed.rz + rng.range(-0.2, 0.2)
    ), { masks: mask() });
    debris++;
  }

  disposeAll(geos);
  console.info(`[world] nachtfeld crags: ${ribs} ribs, ${slabs} slabs, ${teeth} teeth, ${debris} debris — r ${R_START}-${R_START + 46} m, no collision`);
  return { ribs, slabs, teeth, debris };
}
