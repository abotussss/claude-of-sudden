import { IDENT, LL } from '../kit.js';
import { rockGeometry, disposeAll } from '../util.js';
import { Rng } from '../../core/rng.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD — THE RIM. The scarp at the foot of the mountain, and the edge of
 * the map.
 * ════════════════════════════════════════════════════════════════════════════
 * 「平原ちゃんと物理的に範囲外に行けないようにして」
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS — THE MOUNTAIN DID NOT HOLD, AND IT DID NOT HOLD ANYWHERE
 * ────────────────────────────────────────────────────────────────────────────
 * `plains.js` states the bowl is the boundary and gives the reason: "the rim
 * rises 46 m over 38 m of ground, which is a 50-64° face … and `NavGrid`'s slope
 * limit is 46° — so the bot height field stops itself at the foot without a
 * single authored keep-out." The first half of that is arithmetic about the
 * BOTS. The player was never measured.
 *
 * `tools/boundcheck.mjs` — which could not run on this map at all until it was
 * split into a generic flood and a per-map classification — measured him, with
 * the capsule and the three moves the controller actually has:
 *
 *     the player can stand on 336 240 cells — 215 194 m² of level
 *     of that, 115 392 m² is further than 3 m from anything authored
 *     VOID REGIONS: 1, area 115 392 m², furthest point [234, 234] at 331.5 m
 *     bearings ending in void: 64/64
 *
 * MORE THAN HALF of everywhere he could stand was outside the map, it was one
 * connected region, it reached the far corner of the terrain mesh 117 m past the
 * crest, and there was no bearing on which the ridge held. 148 crossings, the
 * five biggest of them at the shoulders beside the capture points and straight
 * out of the back of the north base:
 *
 *     [ 130, -119] 25 475 cells   [-118, -131] 22 296   [-154,  86] 21 641
 *     [ 142,  104] 21 315         [ -14, -176] 14 722
 *
 * THE 50-64° FIGURE IS WRONG AT THE BEARINGS THAT MATTER, and the reason is one
 * clamp in `ridgeH`: the crest multiplier is `Math.max(0.42, peak)`, and where
 * the three harmonics dip together the floor takes over. At `peak = 0.42` the
 * rim rises 19.3 m over 38 m — 27° averaged and 37° at the steepest point of the
 * smoothstep — against a player slope limit of 48° (`movement.js:155`). He walks
 * up it. And the smoothstep's tails are gentle at BOTH ends whatever the peak,
 * so even a 68° face has a walkable apron at its foot and a walkable shoulder at
 * its top.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IS OUT THERE, AND WHY IT IS THE SAME BUG AS THE TOWN'S
 * ────────────────────────────────────────────────────────────────────────────
 * Past the crest, `plainsY` is `swell + ridgeH + farH`, `ridgeH` has saturated,
 * and `farH` is under 1.5 m out to the edge of the walked mesh. So the far side
 * of the mountain is a 100 m wide FLAT PLATEAU at crest height, drawn in one
 * material, with nothing on it — no prop, no light, no cover, no reason. It is
 * `src/world/cordon.js`'s "flat empty sand field with the background blocks
 * 130 m away" with a different texture on it, and it is bigger than the map.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ANSWER IS ROCK, AND THE COLLISION IS ON `LAYER.CLIP`. BOTH ARE MEASURED.
 * ────────────────────────────────────────────────────────────────────────────
 * A cliff band at the break of slope is what a bowl-shaped range actually looks
 * like, it needs no explanation to a player standing under it, and it keeps the
 * boundary a thing you can SEE — which is the property `plains.js` chose the
 * mountain for in the first place and the property `cordon.js` says the town
 * never had. So the rim is drawn as exposed bedrock rising out of the lower
 * face, continuous all the way round, with a ragged crest and a clean foot.
 *
 * THE COLLISION UNDER IT IS `A.clipBox` AND NOT `A.box`, and two claims had to
 * be settled by measurement before that could be written down. One agent had
 * recorded "CLIP is solid to bullets"; another "MASK.BULLET/MASK.SIGHT exclude
 * CLIP". Fired at a real CLIP surface on this map (the control tower's mast, a
 * ray from world [26, 29, -32] down -x):
 *
 *     MASK.CHARACTER  17.40 m     MASK.BULLET     19.03 m
 *     MASK.ALL        17.40 m     MASK.SIGHT      19.03 m
 *     capsule blocked   true      MASK.WORLD      19.03 m
 *     phys.fireBullet({damage:33, penetration:1}) -> ONE impact, at 19.03 m
 *
 * The CLIP face is at 17.40 and the concrete behind it at 19.03. A real round
 * put its only impact past the CLIP face. The SECOND agent was right: CLIP stops
 * a body and nothing else. And what stops a body is the triangle BVH and only
 * the triangle BVH — `physics.createCharacter` hands the controller
 * `this.staticWorld`, and `CharacterController` calls `sweepCapsule` and
 * `overlapCapsule` on it and consults no collider list anywhere.
 *
 * That settles all three constraints this rim is under at once:
 *
 *   IT MUST NOT STOP A ROUND OR A SIGHTLINE. Zones here are 154-314 m apart and
 *   the long shot is the point of the map. `MASK.BULLET` and `MASK.SIGHT` do not
 *   contain `LAYER.CLIP`, so nothing fired on this map can be stopped by the
 *   boundary — measured above, not quoted.
 *
 *   IT MUST NOT MOVE THE NAV GRID. `src/ai/nav.js` drops one `MASK.WORLD` ray
 *   per cell, and `MASK.WORLD` does not contain CLIP either, so the height field
 *   sees the ground it always saw: 223 223 walkable cells before and after, to
 *   the cell. That is the whole reason `A.clipBox` exists — read its note.
 *
 *   IT MUST NOT BE AN INVISIBLE WALL. The clip ring's INNER FACE is at a
 *   constant `R_IN`, and every boulder is placed so its own inner surface
 *   reaches that radius or crosses it. You stop where you are touching rock.
 *
 * THE ONE HONEST COST, stated rather than buried: a round fired AT the rim
 * passes through the drawn rock and strikes the mountain a few metres behind it.
 * Nothing is out there to hit and no shot between two places a player can stand
 * crosses this radius, so it buys the two properties above for a cosmetic price
 * — the same trade `world/links.js` and `plains-tower.js` already take.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY IT IS NOT BUILT BY STEEPENING `ridgeH`
 * ────────────────────────────────────────────────────────────────────────────
 * The obvious fix is to raise the `0.42` floor until every bearing is past 48°.
 * It is the wrong one here and it is worth saying why so nobody does it later
 * thinking it was missed: `ridgeH` feeds `plainsY`, `plainsY` builds the terrain
 * mesh, the mesh IS the collision AND the bot height field, and every fire site,
 * scree patch and boulder on the map is placed on it. Moving it moves the nav
 * grid, the 223 223, the five fires' faces and several thousand stones — a
 * whole-map change to close a boundary. This adds mass and moves nothing.
 */

/** The clip ring's inner face, metres from the middle. @see `RIM_R`. */
const R_IN = 178.0;
/**
 * WHY 178 AND NOT 176. `plainsOpen()` already refuses everything past
 * `RIDGE_R0` (176), so nothing is authored, scattered or claimed outside it and
 * two metres of bare apron is the map's own margin. Standing the face ON 176
 * would put its inner half inside ground the nav height field still calls
 * walkable, and a bot pathing into a solid it cannot see is a wedged bot. Two
 * metres out, the foot of the cliff and the last authored metre of plain are
 * the same line, and `boundcheck`'s own 3 m slack covers the join.
 */

/** Chord length of one clip segment. Sagitta at this radius is 8 mm. */
const SEG = 3.4;
/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE COLLISION IS A MEMBRANE, AND THE THINNESS IS LOAD-BEARING
 * ────────────────────────────────────────────────────────────────────────────
 * The first version of this ring was a 3.8 m prism — a proper mass of rock —
 * and `boundcheck` walked straight through the middle of it. 332 segments were
 * registered, a `MASK.CHARACTER` ray stopped dead at 178.00 on all 720 bearings
 * tested, and the flood still reached [234, 234] with a path that stepped
 * through r 178.4, 179.2, 179.9, 180.7, 181.4 on the TERRAIN under the prism.
 *
 * `physics.checkCapsule` is `StaticWorld.overlapCapsule`, and that is a SURFACE
 * test: it collects triangles within `radius` of the capsule segment. A hollow
 * box is twelve triangles and nothing else, so a 0.32 m capsule standing in the
 * middle of a 3.8 m one is metres from every face and reports ZERO contacts —
 * free. The flood believed it and walked the interior a cell at a time.
 *
 * It is not a hole in the map: the real controller never gets inside, because
 * `sweepCapsule` is a continuous test and stops the capsule at the outer face
 * whatever the speed. It IS a hole in what a gate can see, and the rule that
 * falls out of it is the rule `src/world/cordon.js` already follows without
 * saying why: A BOUNDARY MUST BE THINNER THAN THE FLOOD CANNOT CROSS. The
 * town's compound wall is 0.55 m. This is 0.62.
 *
 * The arithmetic, so the number is checkable rather than copied. A cell is
 * refused when its capsule touches the wall, i.e. within `THICK/2 + 0.315` of
 * the centreline — a blocked band 1.25 m wide. `boundcheck`'s grid is 0.8 m and
 * its walk is one cell, and any 0.8-spaced row crossing a 1.25 m band has at
 * least one sample inside it. There is no step across this wall at any bearing.
 * Widen it past ~1.2 m and that stops being true again at the far side.
 */
const THICK = 0.62;
/**
 * How far the clip face stands over the ground at its own foot.
 *
 * `MOVE.mantle.maxHeight` is 1.85 m and `boundcheck` walks that move for real,
 * so anything under 1.85 is a step and not a boundary. 5.6 m is three times it,
 * which is the margin that survives a player standing on something: the tallest
 * thing scattered anywhere near this line is a `rock_a`, whose prototype is a
 * 0.26 m pebble taken up to 1.9x — half a metre. There is no ladder here, and
 * `boundcheck` is the gate on that claim rather than this sentence.
 */
const RISE = 5.6;
/** How far the clip wall is buried, so a swell under it can never open a gap. */
const BURY = 4.0;

/**
 * THE SCARP LINE — one statement of where the rim is, read by the collision and
 * by every boulder drawn on it.
 *
 * The foot is a CIRCLE and the crest is not, which is the way round it has to
 * be. A meandering foot would put the drawn rock up to three metres behind a
 * clip face that could not meander with it (the inner face must stay inside
 * `boundcheck`'s slack all the way round), and three metres of walking into
 * nothing is the failure this whole file is trying not to commit. A scarp's
 * base IS a fairly clean line in real ground — it is where the talus meets it —
 * and everything ragged about a cliff is its top and its back, which are free.
 */
export const RIM_R = R_IN;

/** How many boulders the rim drew, for the boot log. */
export function buildRim(A, groundY) {
  const rng = new Rng(0x21ce7b);
  const geos = [];

  /**
   * A POOL OF UNIT BOULDERS, NORMALISED TO A 1 m CUBE.
   *
   * `rockGeometry` returns a lumpy icosahedron whose actual extent is the seed's
   * business — the radius is multiplied by an fbm in 0.62-1.34 — so scaling one
   * by "5 m" gives anything from 3.1 to 6.7 m of coverage. On a barrier that has
   * to be CONTINUOUS that is not a cosmetic difference: a boulder that came out
   * small is a hole you can see through. Normalising each by its own bounding
   * box makes the scale arguments below mean exactly what they say, and the
   * lumpiness survives as shape instead of as size.
   */
  const pool = [];
  const POOL = 14;
  for (let i = 0; i < POOL; i++) {
    const g = rockGeometry(rng, 1, 1, rng.range(0.7, 0.95));
    normalise(g);
    geos.push(g);
    pool.push(g);
  }
  /** The crest and talus courses are 20-tri rocks: they carry no silhouette. */
  const fine = [];
  for (let i = 0; i < POOL; i++) {
    const g = rockGeometry(rng, 1, 0, rng.range(0.6, 0.9));
    normalise(g);
    geos.push(g);
    fine.push(g);
  }

  const RC = R_IN + THICK / 2;
  const N = Math.max(8, Math.round((Math.PI * 2 * RC) / SEG));
  const STEP = (Math.PI * 2) / N;
  let drawn = 0;

  for (let i = 0; i < N; i++) {
    const a = i * STEP;
    const ca = Math.cos(a), sa = Math.sin(a);
    /**
     * Local +x along the chord, local +z radial. `cordon.js` writes the same
     * line as `atan2(dx, dz) - PI/2` for a run's direction; the tangent here is
     * `(-sin a, cos a)`, and `atan2(-sin a, cos a)` is `-a`.
     */
    const yaw = -a - Math.PI / 2;

    /**
     * THE FOOT OF THIS SEGMENT — the HIGHEST ground a player can be standing on
     * when he reaches it, and the direction of that `max` is the whole point.
     *
     * The wall's top is an absolute height, so what decides whether it can be
     * mantled is the ground under the man looking at it, not the ground under
     * its own centre. Taking the minimum — which this did first — makes the
     * wall SHORTER exactly where somebody is standing high against it. Nine
     * samples across the chord and in over the last three metres of authored
     * plain; the maximum wins, and `RISE` is measured from it.
     */
    let base = -Infinity;
    for (let u = -1; u <= 1; u++) {
      const aa = a + u * STEP * 0.5;
      for (const rr of [R_IN - 3.0, R_IN - 1.2, R_IN + 0.4]) {
        const y = groundY(Math.cos(aa) * rr, Math.sin(aa) * rr);
        if (y > base) base = y;
      }
    }

    // ------------------------------------------------------- the collision --
    /**
     * ONE PANEL PER SEGMENT, ON `LAYER.CLIP`. Its inner face is at `R_IN` by
     * construction and its ends overlap its neighbours' by the sagitta plus a
     * fifth of a metre, so the ring has no seam a 0.64 m capsule could find.
     */
    const top = base + RISE;
    const foot = base - BURY;
    A.clipBox(
      'dirt', ca * RC, (foot + top) / 2, sa * RC,
      SEG + 0.22, top - foot, THICK, yaw
    );

    // ----------------------------------------------------------- the rock --
    /**
     * The mass that makes it a cliff rather than a rule. Wide enough to overlap
     * both neighbours by a third of its own width, deep enough to bed into the
     * slope behind it, and dropped 30 % of its height into the ground so it
     * grows out of the hill instead of sitting on it.
     */
    const h = RISE + rng.range(1.1, 4.6);
    const wSeg = SEG * rng.range(1.55, 2.05);
    const d = rng.range(5.0, 9.5);
    /**
     * …placed by its INNER SURFACE rather than by its centre, a hand's breadth
     * outboard of the clip face. Both errors are visible and only one is
     * forgivable: a boulder set further out leaves you stopping in mid-air,
     * and a boulder set further in leaves you standing inside it looking at its
     * back faces. A centimetre or two of overlap either way is nothing; a metre
     * of either is the thing this file exists to avoid.
     */
    const rr = R_IN + d * 0.5 + rng.range(-0.18, 0.3);
    A.add('mountain_rock', pool[rng.int(0, POOL - 1)], LL(
      IDENT, ca * rr, base + h * 0.5 - h * 0.30, sa * rr,
      yaw + rng.range(-0.35, 0.35), wSeg, h, d,
      rng.range(-0.07, 0.07), rng.range(-0.07, 0.07)
    ), { masks: [rng.range(0.45, 0.95), rng.range(0.25, 0.7), rng.range(0.15, 0.4)] });
    drawn++;

    /**
     * THE CREST COURSE, straddling the joint between this boulder and the next.
     * Two jobs: it breaks the repeat of one mass per segment into a broken skyline,
     * and it puts rock over the one place a seam could ever read.
     */
    if (rng.float() < 0.82) {
      const ah = a + STEP * 0.5;
      const hh = rng.range(1.6, 4.4);
      const dd = rng.range(3.0, 6.0);
      /** The crest may lean IN over the foot — a real scarp overhangs, and at
       *  3.4 m and up it is well clear of a 1.78 m head. */
      const rrc = R_IN + dd * 0.5 + rng.range(-1.5, 0.4);
      A.add('mountain_rock', fine[rng.int(0, POOL - 1)], LL(
        IDENT, Math.cos(ah) * rrc, base + rng.range(3.4, 6.6) + hh * 0.5, Math.sin(ah) * rrc,
        -ah - Math.PI / 2 + rng.range(-0.9, 0.9), rng.range(2.2, 4.6), hh, dd,
        rng.range(-0.16, 0.16), rng.range(-0.16, 0.16)
      ), { masks: [rng.range(0.5, 0.95), rng.range(0.2, 0.6), rng.range(0.1, 0.35)] });
      drawn++;
    }

    /**
     * TALUS — the rubble that has come off the face and piled against its foot,
     * on the PLAY side. It is what keeps the bottom edge from being a drawn line
     * where rock meets grass, and every piece is knee height or under: nothing
     * here may be a step, and nothing here is solid at all (`A.add` authors no
     * collision), so it cannot become one later either.
     */
    const nt = rng.int(1, 3);
    for (let t = 0; t < nt; t++) {
      const at = a + rng.range(-STEP * 0.6, STEP * 0.6);
      const rt = R_IN - rng.range(0.2, 3.4);
      const s = rng.range(0.5, 1.5);
      A.add('mountain_rock', fine[rng.int(0, POOL - 1)], LL(
        IDENT, Math.cos(at) * rt, groundY(Math.cos(at) * rt, Math.sin(at) * rt) + s * 0.16, Math.sin(at) * rt,
        rng.float() * 6.283, s * rng.range(0.9, 1.8), s * rng.range(0.5, 0.9), s * rng.range(0.9, 1.8),
        rng.range(-0.25, 0.25), rng.range(-0.25, 0.25)
      ), { masks: [rng.range(0.4, 0.9), rng.range(0.3, 0.8), rng.range(0.2, 0.5)] });
      drawn++;
    }
  }

  disposeAll(geos);
  console.info(`[world] nachtfeld rim: ${N} clip segments at r ${R_IN}-${(R_IN + THICK).toFixed(1)} m, ${drawn} boulders`);
  return { segments: N, boulders: drawn, radius: R_IN, rise: RISE };
}

/** Scale a geometry in place so its bounding box is a unit cube at the origin. */
function normalise(g) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  const sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
  const cx = (b.max.x + b.min.x) / 2, cy = (b.max.y + b.min.y) / 2, cz = (b.max.z + b.min.z) / 2;
  const pa = g.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    pa.setXYZ(i,
      (pa.getX(i) - cx) / (sx || 1),
      (pa.getY(i) - cy) / (sy || 1),
      (pa.getZ(i) - cz) / (sz || 1));
  }
  pa.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
}
