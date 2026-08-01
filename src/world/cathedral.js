import { Rng } from '../core/rng.js';
import { BOX, BOX_FINE, BOX_SOFT, BOX_THIN, PANE, IDENT, LL } from './kit.js';
import { fbm3, fillMasks, patchGeometry, rockGeometry, tubeY } from './util.js';
import { CATHEDRAL } from './layout.js';

/**
 * WORLD — THE CATHEDRAL, and the whole middle of the map.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS
 * ───────────────────────────────────────────────────────────────────────────
 * "また中央部は屋内にしてほしい なので中央部に広い大聖堂を配置してそこを戦闘激化させて
 *  爆破させたり崩落もあり キャッシュさせて定期的に爆破や崩落をイベントで起こしてランダムで"
 * "もっと屋内での戦闘も起きるようになっていないのが今のマップの勿体無いところです"
 *
 * The middle of this map was a 19.5 m street with two 8 m sheds standing in it,
 * and the middle capture point was 2.8 m² of mass on open tarmac — the one point
 * on the map where `tools/sitecheck.mjs` measured the side WALKING IN reading
 * more of the objective than the side holding it (75.1 % against 63.4 %). It was
 * also entirely outdoors, on a map whose interiors had only just become
 * reachable by bots at all.
 *
 * So the middle of the map is a building, and the middle capture point is inside
 * it. 30 x 45 m of ground, an aisled basilica: a narthex and a great south
 * portal, four bays of nave arcade, a domed crossing WHERE THE POINT IS, three
 * bays of choir, a five-sided apse, transept portals east and west, a gallery
 * over both aisles that a player can walk, a clerestory over that, and a
 * campanile over the south-west corner with the stair to the gallery in it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE ONE THING THAT MAKES IT WORK, AND IT IS NOT THE GEOMETRY
 * ───────────────────────────────────────────────────────────────────────────
 * `src/ai/nav.js` is a 2.5D height field built by dropping ONE ray per cell from
 * above the level, so inside a roofed footprint that ray finds the ROOF and the
 * storey underneath does not exist to A*. Measured before the interior pass
 * existed: all 3353 walkable cells inside the eight enterable buildings were at
 * 3.2 / 6.5 / 9.6 m, ZERO at ground level, and bot time indoors was 0.00 %.
 *
 * `NavGrid._carveInteriors` re-samples those cells from INSIDE, using
 * `world.interiorVolumes`, and that is what took the map from 0 to ~2620
 * ground-floor cells and from 3 of 29 men ever indoors to 23 of 29. So this
 * building publishes an interior volume like every other interior on the map
 * (`buildCathedral` returns it; `WorldSystem` appends it), and IT MUST: a
 * cathedral that did not would be the largest room on the map with a capture
 * point in it that no bot could ever walk to, and the request would fail in
 * exactly the way it failed before.
 *
 * Nothing here is on `LAYER.CLIP` and no geometry is weakened to help the grid.
 * The roof is a real roof, the vault stops a bullet, the gallery holds a player.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY IT IS NOT A `BUILDINGS` ENTRY
 * ───────────────────────────────────────────────────────────────────────────
 * `buildBuilding` assembles a footprint plus a facade programme: storeys, bays,
 * door bays, balconies, a parapet. It has no vocabulary for an arcade, a
 * clerestory, an apse or a dome, and giving it one would mean changing the
 * module every other building on the map is built by. Equally important, seven
 * separate passes walk `BUILDINGS` and index `infos` against it —
 * `setDoorways`, `buildFeatures`, `buildLinks`, `cordonRuns`, `inBuilding` and
 * the four interior gates — and every one of them assumes a rectangular block
 * with numbered sides. So the cathedral is its own module, called from
 * `WorldSystem.init` beside the others, and it hands back the two facts the
 * engine needs from it: its interior volume, and its footprint (for
 * `dressing.isOpen`, so nothing is scattered inside it).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * DICE
 * ───────────────────────────────────────────────────────────────────────────
 * Its own fixed-seed stream, exactly like `src/world/cordon.js`. `dressStreet`
 * and the whole scatter share one `rng`, so drawing a single number from that
 * one here would move every prop, stain and pock on the map.
 */

/* -------------------------------------------------------------------------- */
/* the section, in metres. NONE of this scales — a man is still 1.78 m.        */
/* -------------------------------------------------------------------------- */
const SEC = {
  /** Walking surface, a kerb over the street so the threshold is one step. */
  floor: 0.16,
  /** Arcade pier: base, shaft, capital. */
  pierBase: 0.55,
  pierTop: 3.6,
  /** Arcade arch apex — under the gallery deck it carries. */
  archTop: 5.3,
  /** Top of the gallery deck over each aisle. Player-walkable overwatch. */
  gallery: 5.6,
  /** Triforium opening onto the nave, from the deck up. */
  triTop: 8.4,
  /** The aisle's lean-to roof, outside and over the gallery. */
  aisleRoof: 9.0,
  /** Clerestory glazing. */
  clearSill: 9.9,
  clearTop: 13.8,
  /** The nave roof and its parapet. */
  naveRoof: 15.0,
  parapet: 16.1,
  /** The crossing: an octagonal drum, then the dome, then the lantern. */
  drumTop: 18.4,
  domeTop: 23.5,
  lanternTop: 26.2,
  /** The campanile. */
  towerTop: 29.0,
};

/** Wall thickness, and how far a buttress stands proud of the wall it braces. */
const T = 0.85;
const BUTT = 1.15;

/**
 * Build the cathedral.
 *
 * @param {Assembler} A
 * @returns {{ id, cx, cz, hw, hd, floorY, probeY }} the interior volume, in
 *          LEVEL space. `WorldSystem` puts it in world space and publishes it.
 */
export function buildCathedral(A) {
  const rng = new Rng(0xca7ed7a1);
  const S = CATHEDRAL;
  const cx = S.x;
  const cz = S.z;
  const HW = S.w / 2; // 15 m
  const HD = S.d / 2; // 22.5 m

  /** Local (u along X, v along Z) -> level. The map's cathedral is axis-aligned
   *  in level space, so this is an add; keeping it as a function is what makes
   *  every number below readable as "metres from the crossing". */
  const X = (u) => cx + u;
  const Z = (v) => cz + v;

  /* ---- the plan, all local ------------------------------------------- */
  /** Arcade piers, centre line. Aisle clear = HW - T - (ARC + pierW/2). */
  const ARC = 8.6;
  const PW = S.pierW; // 1.4
  /** Bay centres down the nave and the choir. The CROSSING is the gap at v 0. */
  const NAVE_V = [-17, -13, -9, -5];
  const CHOIR_V = [5, 9, 13, 17];
  /** Crossing piers are fatter — they carry the drum. */
  const CROSS_V = [-5, 5];
  const CPW = 2.0;
  /** The tower caps the south-west corner and holds the stair. */
  const TOW = { u0: -HW, u1: -HW + 7.4, v0: -HD, v1: -HD + 8.2 };

  const box = BOX(A);
  const soft = BOX_SOFT(A);
  const fine = BOX_FINE(A);
  const thin = BOX_THIN(A);
  const pane = PANE(A);

  /** Stone with a little life in it, so no two courses read the same. */
  const stone = () => [rng.range(0.35, 0.85), rng.range(0.3, 0.75), rng.range(0.25, 0.55)];
  /** A solid box: drawn AND collidable, which is the common case here. */
  const solid = (key, u, y, v, su, sy, sv, surf = 'concrete', masks = null) => {
    A.add(key, box, LL(IDENT, X(u), y, Z(v), 0, su, sy, sv), { masks: masks ?? stone() });
    A.box(surf, X(u), y, Z(v), su, sy, sv);
  };
  /** …and one that is only drawn: trim, coping, tracery, a rib. */
  const trim = (key, u, y, v, su, sy, sv, masks = null, ry = 0) =>
    A.add(key, soft, LL(IDENT, X(u), y, Z(v), ry, su, sy, sv), { masks: masks ?? stone() });

  /* ====================================================================== */
  /* 1. THE FLOOR, AND THE PARVIS ROUND IT                                  */
  /* ====================================================================== */
  /**
   * `tools/boundcheck.mjs` calls a reached cell VOID when the collision surface
   * under it is literally `sand` and it is outside every authored rect. So the
   * floor and the apron are laid as `concrete` collision, and that alone makes
   * every square metre of this building authored ground — the street rect it
   * stands in covers it too, but the floor is the honest answer.
   */
  {
    const fy = SEC.floor;
    A.add('tile_floor', box, LL(IDENT, X(0), fy / 2, Z(0), 0, S.w - 0.2, fy, S.d - 0.2), {
      masks: [0.5, 0.55, 0.35],
    });
    A.box('concrete', X(0), fy / 2, Z(0), S.w - 0.2, fy, S.d - 0.2);
    // The parvis: a worn stone apron a metre and a bit out on every side, so the
    // threshold is one 16 cm step from the street instead of a kerb, and so the
    // building meets the road on stone rather than on a polygon edge.
    for (const [u, v, su, sv] of [
      [0, -HD - 1.1, S.w + 2.6, 2.2], [0, HD + 1.1, S.w + 2.6, 2.2],
      [-HW - 1.1, 0, 2.2, S.d], [HW + 1.1, 0, 2.2, S.d],
    ]) {
      A.add('concrete', box, LL(IDENT, X(u), 0.075, Z(v), 0, su, 0.15, sv), { masks: [0.75, 0.7, 0.4] });
      A.box('concrete', X(u), 0.075, Z(v), su, 0.15, sv);
    }
    // Worn ledger slabs and grave markers set into the nave floor: a 45 m sheet
    // of one material is the "flat/untextured surface" the quality bar forbids,
    // and a church floor is a patchwork of other people's names.
    for (let i = 0; i < 54; i++) {
      const u = rng.range(-HW + 1.6, HW - 1.6);
      const v = rng.range(-HD + 1.6, HD - 1.6);
      A.add(rng.float() < 0.4 ? 'concrete_dark' : 'concrete', fine,
        LL(IDENT, X(u), SEC.floor + 0.012, Z(v), rng.range(-0.03, 0.03),
          rng.range(0.9, 2.1), 0.024, rng.range(1.4, 2.8)),
        { masks: [rng.range(0.6, 1.0), rng.range(0.4, 0.95), 0.25] });
    }
    for (let i = 0; i < 40; i++) {
      const g = patchGeometry(rng, rng.range(0.3, 1.0), { lobes: 10, wobble: 0.5 });
      A.addOnce('dirt', g, LL(IDENT, X(rng.range(-HW + 1, HW - 1)), SEC.floor + 0.02,
        Z(rng.range(-HD + 1, HD - 1)), rng.float() * 6.28, 1, 1, rng.range(0.6, 1.0)),
        { masks: [0.1, rng.range(0.6, 1.0), 0.5] });
    }
  }

  /**
   * ────────────────────────────────────────────────────────────────────────
   * EVERYTHING ABOVE THE FLOOR IS ONE SCOPE, BECAUSE IT ALL COMES DOWN
   * ────────────────────────────────────────────────────────────────────────
   * "大爆破と崩壊、大聖堂を焼き尽くす大爆撃による大聖堂周りを瓦礫の山にして、大聖堂
   *  自体を破壊して更地にする感じに爆破して".
   *
   * The `CATHEDRAL` airstrike salvo takes three bays of AISLE ROOF off. That is
   * a church with a hole in it, and the brief asks for a church that is GONE —
   * so the arcade, the gallery, the clerestory, the vault, the roof, the dome
   * and the campanile are all inside `cath:shell`, and section 1 (the floor and
   * the parvis) is deliberately OUTSIDE it. What is left when the scope stops
   * being drawn is the walking surface, which is what 更地 means: the ground the
   * building stood on, with nothing on it.
   *
   * `Assembler.beginScope` is the only way to address merged geometry after the
   * fact — `add` merges into one mesh per palette key and returns no handle, so
   * a scope's triangle ranges are the handle. Hiding it is a `fill` of degenerate
   * indices per range and a partial buffer upload; no geometry is rebuilt, no
   * material is touched, no draw call appears or disappears, and it is out of
   * the depth prepass and all four shadow cascades because they share the index
   * buffer. The collision goes with it as a mask write on a cached triangle
   * range. NOTHING IS BUILT, CUT OR SOLVED WHEN IT FIRES — the same discipline
   * `src/match/airstrike.js` follows, for the same reason.
   */
  const shell = A.beginScope('cath:shell');

  /* ====================================================================== */
  /* 2. THE OUTER WALLS                                                     */
  /* ====================================================================== */
  /**
   * Every wall is laid as PIERS BETWEEN OPENINGS plus a spandrel over each one,
   * rather than as a slab with a hole cut in it. Two reasons, and only the
   * second is about looks: the collision proxy is then a doorway-shaped hole in
   * the hull by construction (the same trick `buildBuilding` uses, and the
   * reason the BVH here is a few hundred triangles rather than a few thousand),
   * and the reveal of a 0.85 m wall reads as depth from inside.
   *
   * `run()` lays one elevation. `holes` are given as centres along the run.
   */
  const runWall = (key, along, fixedU, fixedV, from, to, yTop, holes, opts = {}) => {
    const alongX = along === 'x';
    const yBase = 0;
    const t = opts.t ?? T;
    // sort and walk the gaps
    const hs = holes.slice().sort((a, b) => a.c - b.c);
    let cursor = from;
    const put = (a, b, y0, y1) => {
      if (b - a < 0.02 || y1 - y0 < 0.02) return;
      const mid = (a + b) / 2;
      const u = alongX ? mid : fixedU;
      const v = alongX ? fixedV : mid;
      solid(key, u, (y0 + y1) / 2, v, alongX ? b - a : t, y1 - y0, alongX ? t : b - a);
    };
    for (const h of hs) {
      put(cursor, h.c - h.w / 2, yBase, yTop);
      // under the sill and over the head
      put(h.c - h.w / 2, h.c + h.w / 2, yBase, h.sill);
      put(h.c - h.w / 2, h.c + h.w / 2, h.sill + h.h, yTop);
      cursor = h.c + h.w / 2;
    }
    put(cursor, to, yBase, yTop);
    // the arch over each opening, and its glass
    for (const h of hs) {
      const u = alongX ? h.c : fixedU;
      const v = alongX ? fixedV : h.c;
      arch(key, u, h.sill + h.h, v, h.w, Math.min(1.6, h.w * 0.55), alongX, t + 0.12);
      if (h.glass) glazing(u, h.sill, v, h.w, h.h, alongX, t);
      if (h.jamb !== false) jambs(key, u, h.sill, v, h.w, h.h, alongX, t);
    }
  };

  /**
   * A pointed arch, as real voussoirs on the curve rather than a painted band.
   * Two quadrant arcs meeting at the apex, which is the Levantine profile the
   * rest of this level's openings already use (`util.holePath`).
   */
  const arch = (key, u, ySpring, v, wid, rise, alongX, t) => {
    const n = 9;
    const r = wid / 2;
    for (const side of [-1, 1]) {
      for (let i = 0; i < n; i++) {
        const a = ((i + 0.5) / n) * (Math.PI / 2);
        // an ellipse quadrant, pinched at the apex so the head is pointed
        const px = side * r * Math.cos(a) * (1 + 0.16 * Math.sin(a));
        const py = rise * Math.sin(a);
        const tilt = -side * a;
        const bw = (r / n) * 1.5;
        const du = alongX ? px : 0;
        const dv = alongX ? 0 : px;
        A.add(key, box,
          LL(IDENT, X(u + du), ySpring + py, Z(v + dv), 0,
            alongX ? bw : t, 0.42, alongX ? t : bw,
            alongX ? 0 : tilt, alongX ? tilt : 0),
          { masks: [rng.range(0.5, 0.95), rng.range(0.3, 0.7), 0.3] });
      }
    }
    // keystone
    A.add(key, soft, LL(IDENT, X(u), ySpring + rise + 0.16, Z(v), 0,
      alongX ? 0.46 : t + 0.1, 0.5, alongX ? t + 0.1 : 0.46), { masks: [0.85, 0.4, 0.2] });
  };

  /** Colonnettes down both jambs of an opening: the detail visible at 0.5 m. */
  const jambs = (key, u, sill, v, wid, h, alongX, t) => {
    for (const side of [-1, 1]) {
      const du = alongX ? side * (wid / 2 - 0.14) : 0;
      const dv = alongX ? 0 : side * (wid / 2 - 0.14);
      const g = tubeY(0.11, h - 0.35, { radial: 7 });
      A.addOnce(key, g, LL(IDENT, X(u + du), sill, Z(v + dv), 0, 1, 1, 1),
        { masks: [0.8, 0.35, 0.55] });
      A.add(key, soft, LL(IDENT, X(u + du), sill + h - 0.24, Z(v + dv), 0, 0.3, 0.16, 0.3),
        { masks: [0.9, 0.3, 0.2] });
    }
  };

  /**
   * Glazing: coloured glass in stone tracery. `window_glow` is the level's
   * emissive interior-window key, which is what makes a lit window read from
   * outside at dusk without a light being registered for it.
   */
  /**
   * GLASS IS TWO PANES, BACK TO BACK, AND THIS IS NOT A DETAIL.
   *
   * `kit.PANE` is a single quad and a quad has ONE face. Every window in the
   * first build of this building therefore existed only from outside, and from
   * the nave floor the clerestory, the drum and all five apse lights were OPEN
   * HOLES: screenshotted standing on capture point C, the crossing was a
   * rectangle of sky and the apse read as a row of detached piers. A cathedral
   * whose windows are only there from the street is a shed.
   *
   * Both faces, 2 cm apart, so it reads as glazing from either side without
   * z-fighting. Cheap: a quad is two triangles and there are 34 of them.
   */
  const glazing = (u, sill, v, wid, h, alongX, t) => {
    const key = rng.float() < 0.45 ? 'window_glow' : 'glass';
    const base = alongX ? 0 : Math.PI / 2;
    for (const side of [0, Math.PI]) {
      A.add(key, pane,
        LL(IDENT, X(u + (alongX ? 0 : (side ? -0.01 : 0.01))), sill + h / 2,
          Z(v + (alongX ? (side ? -0.01 : 0.01) : 0)), base + side, wid - 0.3, h - 0.3, 1),
        { masks: [0.4, rng.range(0.3, 0.8), 0.1] });
    }
    // mullions and two transoms
    for (const f of [-0.25, 0, 0.25]) {
      const du = alongX ? f * wid : 0;
      const dv = alongX ? 0 : f * wid;
      A.add('concrete_dark', thin, LL(IDENT, X(u + du), sill + h / 2, Z(v + dv), 0,
        alongX ? 0.09 : t * 0.5, h - 0.3, alongX ? t * 0.5 : 0.09), { masks: [0.9, 0.6, 0.2] });
    }
    for (const f of [0.34, 0.68]) {
      A.add('concrete_dark', thin, LL(IDENT, X(u), sill + h * f, Z(v), 0,
        alongX ? wid - 0.3 : t * 0.5, 0.08, alongX ? t * 0.5 : wid - 0.3), { masks: [0.9, 0.6, 0.2] });
    }
  };

  /* ---- the two flanks: aisle wall, buttressed, with a window per bay ---- */
  const flankHoles = (side) => {
    const hs = [];
    for (const v of [...NAVE_V, ...CHOIR_V]) {
      // the tower occupies the south end of the west flank
      if (side < 0 && v < TOW.v1 - HD + 8.2 && v < -14.5) continue;
      hs.push({ c: v, w: 2.4, sill: 3.0, h: 4.4, glass: true });
    }
    // the transept portal, dead centre of each flank, at the crossing
    hs.push({ c: 0, w: 3.4, sill: 0, h: 5.0, glass: false, jamb: true });
    return hs;
  };
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'plaster_sand' : 'plaster_cream';
    runWall(key, 'z', side * (HW - T / 2), 0, -HD, HD, SEC.aisleRoof, flankHoles(side));
    // plinth, string course at the gallery, and the eaves corbel table
    trim('concrete', side * (HW - T / 2), 0.42, 0, T + 0.22, 0.84, S.d + 0.1, [0.85, 0.85, 0.6]);
    trim('concrete', side * (HW - T / 2), SEC.gallery + 0.1, 0, T + 0.18, 0.28, S.d + 0.1, [0.9, 0.4, 0.2]);
    trim('concrete_dark', side * (HW - T / 2), SEC.aisleRoof - 0.2, 0, T + 0.3, 0.34, S.d + 0.1, [0.95, 0.35, 0.15]);
    // corbels under it, one every 1.5 m — the thing that stops a 45 m cornice
    // reading as a ruled line
    for (let v = -HD + 1; v < HD - 1; v += 1.5) {
      A.add('concrete', soft, LL(IDENT, X(side * (HW + 0.1)), SEC.aisleRoof - 0.52, Z(v), 0,
        0.34, 0.3, 0.22), { masks: [0.9, rng.range(0.4, 0.9), 0.35] });
    }
  }

  /* ---- the buttresses, one per bay, plus the flying pair at the nave ---- */
  for (const side of [-1, 1]) {
    for (const v of [...NAVE_V, ...CHOIR_V, -HD + 0.9, HD - 0.9]) {
      const u = side * (HW + BUTT / 2 - 0.1);
      const h = SEC.aisleRoof - 0.9;
      solid('concrete', u, h / 2, v + 2, BUTT, h, 1.3);
      // weathered set-off half way up and a gabled cap
      trim('concrete_dark', u + side * 0.06, h * 0.55, v + 2, BUTT + 0.16, 0.22, 1.5, [0.95, 0.5, 0.2]);
      trim('concrete', u - side * 0.16, h + 0.2, v + 2, BUTT * 0.8, 0.5, 1.5, [0.9, 0.35, 0.2]);
      // the flyer: a raking strut up to the clerestory wall
      const span = HW - ARC - PW / 2;
      A.add('concrete', box,
        LL(IDENT, X(side * (HW - span / 2 + 0.2)), (SEC.aisleRoof + SEC.clearSill + 1.6) / 2, Z(v + 2), 0,
          span * 1.28, 0.62, 0.72, 0, side * 0.62), { masks: [0.7, 0.55, 0.4] });
      A.box('concrete', X(side * (HW - span / 2 + 0.2)), (SEC.aisleRoof + SEC.clearSill + 1.6) / 2, Z(v + 2),
        span * 1.28, 0.62, 0.72);
    }
  }

  /* ---- the south front: three portals, a rose, and the gable ----------- */
  {
    const key = 'plaster_cream';
    runWall(key, 'x', 0, -(HD - T / 2), -HW, HW, SEC.aisleRoof, [
      { c: 0, w: 4.0, sill: 0, h: 6.2, glass: false },
      { c: -5.6, w: 2.2, sill: 0, h: 4.4, glass: false },
      { c: 5.6, w: 2.2, sill: 0, h: 4.4, glass: false },
    ]);
    trim('concrete', 0, 0.42, -(HD - T / 2), S.w + 0.3, 0.84, T + 0.22, [0.85, 0.85, 0.6]);
    // the gable over the nave, carrying the rose
    const gw = 2 * (ARC + PW / 2) + 1.2;
    solid(key, 0, (SEC.aisleRoof + SEC.naveRoof) / 2, -(HD - T / 2), gw, SEC.naveRoof - SEC.aisleRoof, T);
    // THE ROSE. Twelve spokes and a hub, in stone, with one disc of glass behind
    // it: the single piece of this building that has to read from 60 m down the
    // street, which is exactly the distance the defence's base is at.
    {
      const ry = SEC.aisleRoof + 3.0;
      const R = 3.1;
      for (const side of [0, Math.PI]) {
        A.add('window_glow', pane,
          LL(IDENT, X(0), ry, Z(-(HD - T / 2) - 0.06 + (side ? -0.02 : 0)), side, R * 1.9, R * 1.9, 1),
          { masks: [0.3, 0.5, 0.05] });
      }
      const ring = (r, w) => {
        const n = Math.max(18, Math.round(r * 9));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          A.add('concrete', thin,
            LL(IDENT, X(Math.cos(a) * r), ry + Math.sin(a) * r, Z(-(HD - T / 2) - 0.16), 0,
              (2 * Math.PI * r) / n + 0.06, w, 0.3, 0, -a), { masks: [0.9, 0.4, 0.25] });
        }
      };
      ring(R, 0.34);
      ring(R * 0.62, 0.24);
      ring(R * 0.3, 0.2);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        A.add('concrete', thin,
          LL(IDENT, X(Math.cos(a) * R * 0.5), ry + Math.sin(a) * R * 0.5, Z(-(HD - T / 2) - 0.16), 0,
            R, 0.17, 0.28, 0, a), { masks: [0.9, 0.4, 0.25] });
      }
    }
    // and the raking cornices of the gable
    for (const side of [-1, 1]) {
      A.add('concrete_dark', soft,
        LL(IDENT, X(side * gw * 0.26), (SEC.aisleRoof + SEC.naveRoof) / 2 + 1.1, Z(-(HD - T / 2) - 0.2), 0,
          gw * 0.58, 0.3, 0.5, 0, side * 0.9), { masks: [0.95, 0.4, 0.15] });
    }
  }

  /* ---- the north end: the apse, five sided, with a door in the middle -- */
  {
    const key = 'plaster_sand';
    // the straight bits either side of the apse
    for (const side of [-1, 1]) {
      solid(key, side * (HW - 3.0) / 1, SEC.aisleRoof / 2, HD - T / 2, 6.0, SEC.aisleRoof, T);
    }
    /**
     * THE NORTH GABLE, and it was missing.
     *
     * The apse and the aisle returns only stand to `aisleRoof` (9 m); the nave
     * vault and the clerestory walls run on to 15 m. Without a gable closing
     * the end of the nave between those two heights, the whole north end of the
     * church is a 19 x 6 m hole — screenshotted from the crossing, the frame is
     * a band of daylight above the altar. It is not a small hole: it is bigger
     * than the rose window and it is the only thing you look at from the point.
     */
    solid(key, 0, (SEC.aisleRoof + SEC.naveRoof) / 2, HD - T / 2,
      2 * (ARC + PW / 2) + 1.2, SEC.naveRoof - SEC.aisleRoof, T);
    trim('concrete_dark', 0, SEC.naveRoof - 0.3, HD - T / 2 - 0.1,
      2 * (ARC + PW / 2) + 1.6, 0.3, T + 0.4, [0.95, 0.35, 0.15]);
    const R = ARC + PW / 2;
    const facets = 5;
    for (let i = 0; i < facets; i++) {
      const a = -Math.PI / 2 + ((i + 0.5) / facets) * Math.PI;
      const fu = Math.sin(a) * R;
      const fv = HD - T + Math.cos(a) * R * 0.42;
      const ry = a;
      const seg = (2 * R * Math.sin(Math.PI / 2 / facets)) * 1.12;
      // window in every facet but the middle one, which is the door
      const isDoor = i === 2;
      const h = isDoor ? 4.6 : 5.6;
      const sill = isDoor ? 0 : 2.6;
      // piers either side of the opening + spandrel over it
      const ow = isDoor ? 2.8 : 1.8;
      for (const s of [-1, 1]) {
        const off = s * (seg + ow) / 4;
        A.add(key, box, LL(IDENT, X(fu + Math.cos(ry) * off), SEC.aisleRoof / 2, Z(fv - Math.sin(ry) * off), ry,
          (seg - ow) / 2, SEC.aisleRoof, T), { masks: stone() });
        A.box('concrete', X(fu + Math.cos(ry) * off), SEC.aisleRoof / 2, Z(fv - Math.sin(ry) * off),
          (seg - ow) / 2, SEC.aisleRoof, T, ry);
      }
      A.add(key, box, LL(IDENT, X(fu), (sill + h + SEC.aisleRoof) / 2, Z(fv), ry, ow, SEC.aisleRoof - sill - h, T), { masks: stone() });
      A.box('concrete', X(fu), (sill + h + SEC.aisleRoof) / 2, Z(fv), ow, SEC.aisleRoof - sill - h, T, ry);
      if (sill > 0) {
        A.add(key, box, LL(IDENT, X(fu), sill / 2, Z(fv), ry, ow, sill, T), { masks: stone() });
        A.box('concrete', X(fu), sill / 2, Z(fv), ow, sill, T, ry);
        const gk = rng.float() < 0.5 ? 'window_glow' : 'glass';
        for (const side of [0, Math.PI]) {
          A.add(gk, pane, LL(IDENT, X(fu), sill + h / 2, Z(fv - 0.06 + (side ? 0.03 : 0)), ry + side,
            ow - 0.25, h - 0.25, 1), { masks: [0.35, 0.5, 0.08] });
        }
      }
      // the half-conical roof over the apse, one facet at a time
      A.add('roof_screed', box, LL(IDENT, X(fu * 0.7), SEC.aisleRoof + 1.5, Z(fv - 1.2), ry, seg, 0.5, 3.4, -0.5),
        { masks: [0.6, 0.55, 0.35] });
      A.box('concrete', X(fu * 0.7), SEC.aisleRoof + 1.4, Z(fv - 1.2), seg, 0.6, 3.4, ry);
    }
  }

  /* ====================================================================== */
  /* 3. THE ARCADE, THE GALLERY AND THE CLERESTORY                          */
  /* ====================================================================== */
  /**
   * The arcade is the point of an aisled church and it is also the cover on the
   * capture point: eight 1.4 m piers and two 2.0 m crossing piers, standing in
   * the 0.9-2.8 m band `tools/sitecheck.mjs` counts, arranged so no line across
   * the crossing is clear for more than one bay. Everything is kept more than
   * 5 m off the crossing centre, because that centre is a capture point and
   * `standRing` spreads fifteen men over a 4 m ring of it.
   */
  const pier = (u, v, w, yTop) => {
    solid('concrete', u, SEC.pierBase / 2, v, w + 0.36, SEC.pierBase, w + 0.36, 'concrete', [0.9, 0.8, 0.55]);
    solid('plaster_cream', u, (SEC.pierBase + yTop) / 2, v, w, yTop - SEC.pierBase, w, 'concrete', [0.45, 0.5, 0.4]);
    // engaged shafts on all four faces
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const g = tubeY(0.15, yTop - SEC.pierBase - 0.3, { radial: 8 });
      A.addOnce('plaster_cream', g, LL(IDENT, X(u + du * w / 2), SEC.pierBase, Z(v + dv * w / 2)),
        { masks: [0.7, 0.4, 0.5] });
    }
    // capital: an abacus over a cushion
    trim('concrete', u, yTop + 0.14, v, w + 0.5, 0.28, w + 0.5, [0.9, 0.35, 0.2]);
    trim('concrete_dark', u, yTop - 0.16, v, w + 0.34, 0.34, w + 0.34, [0.85, 0.55, 0.35]);
  };

  for (const side of [-1, 1]) {
    const u = side * ARC;
    for (const v of [...NAVE_V, ...CHOIR_V]) pier(u, v, PW, SEC.pierTop);
    for (const v of CROSS_V) pier(u, v, CPW, SEC.pierTop + 0.6);
    // the arches between them
    const all = [...NAVE_V, ...CROSS_V, ...CHOIR_V].sort((a, b) => a - b);
    for (let i = 0; i < all.length - 1; i++) {
      const a = all[i];
      const b = all[i + 1];
      if (b - a > 6.5) continue; // the crossing: no arcade across it
      const mid = (a + b) / 2;
      const span = b - a - PW;
      arch('plaster_cream', u, SEC.pierTop + 0.3, mid, span, 1.5, false, PW * 0.8);
      // the spandrel over each arch, carrying the gallery
      solid('plaster_cream', u, (SEC.archTop + SEC.gallery) / 2 + 0.1, mid,
        PW * 0.8, SEC.gallery - SEC.archTop + 0.2, b - a);
    }
  }

  /**
   * THE GALLERY — the reason a player ever goes upstairs in here, and the
   * elevation the middle of this map has never had. A 4.2 m deck over each
   * aisle at 5.6 m, open to the nave through a triforium arcade, with a parapet
   * you can shoot over. It is `LAYER.STATIC` like every other floor on this map:
   * `NavGrid._carveInteriors` re-samples the cells under it from 1.72 m, so the
   * aisle below is still ground a bot walks and the gallery is still the
   * player's — which is the same bargain every upper floor in this level makes.
   */
  for (const side of [-1, 1]) {
    const aisleW = HW - T - (ARC + PW / 2);
    const u = side * (HW - T - aisleW / 2);
    solid('floor_concrete', u, SEC.gallery - 0.18, 0, aisleW, 0.36, S.d - 2 * T, 'concrete', [0.55, 0.6, 0.45]);
    // parapet along the nave edge, waist high, with a moulded coping
    const pu = side * (ARC + PW / 2 - 0.1);
    solid('plaster_cream', pu, SEC.gallery + 0.5, 0, 0.34, 1.0, S.d - 2 * T, 'concrete', [0.5, 0.45, 0.3]);
    trim('concrete_dark', pu, SEC.gallery + 1.05, 0, 0.56, 0.16, S.d - 2 * T, [0.95, 0.35, 0.15]);
    // …pierced by a quatrefoil per bay, so it is a triforium and not a shelf
    for (const v of [...NAVE_V, ...CHOIR_V]) {
      for (const o of [-1, 1]) {
        A.add('concrete_dark', thin, LL(IDENT, X(pu + side * 0.2), SEC.gallery + 0.52, Z(v + o * 0.55), 0,
          0.14, 0.5, 0.5), { masks: [0.9, 0.7, 0.2] });
      }
    }
    // and the triforium arcade above it, holding the aisle roof
    for (const v of [...NAVE_V, ...CHOIR_V]) {
      solid('plaster_cream', pu, (SEC.gallery + 1.0 + SEC.triTop) / 2, v + 2,
        0.5, SEC.triTop - SEC.gallery - 1.0, 0.5);
    }
    solid('plaster_cream', pu, SEC.triTop + 0.22, 0, 0.6, 0.44, S.d - 2 * T);
    // the aisle's lean-to roof over the gallery
    A.add('roof_screed', box, LL(IDENT, X(u), SEC.aisleRoof - 0.2, Z(0), 0, aisleW + 0.9, 0.4, S.d), {
      masks: [0.6, 0.6, 0.3],
    });
    A.box('concrete', X(u), SEC.aisleRoof - 0.2, Z(0), aisleW + 0.9, 0.4, S.d);
  }

  /** The clerestory: the wall over the arcade, and the light in the nave. */
  for (const side of [-1, 1]) {
    const u = side * (ARC + PW / 2 - 0.2);
    runWall('plaster_cream', 'z', u, 0, -HD + T, HD - T, SEC.naveRoof,
      [...NAVE_V, ...CHOIR_V].map((v) => ({ c: v, w: 2.2, sill: SEC.clearSill, h: SEC.clearTop - SEC.clearSill, glass: true })),
      { t: 0.7 });
    trim('concrete_dark', u, SEC.naveRoof - 0.3, 0, 1.1, 0.36, S.d - 1.4, [0.95, 0.35, 0.15]);
  }

  /* ====================================================================== */
  /* 4. THE NAVE VAULT AND THE ROOF OVER IT                                 */
  /* ====================================================================== */
  /**
   * A quadripartite rib vault, built the way one is: transverse ribs on the bay
   * lines, diagonal ribs across each bay, and webbing between. The webbing is
   * what stops a bullet and what the height field's single downward ray lands
   * on; the ribs are what makes 45 m of ceiling read as a ceiling.
   */
  const VAULT_Y = SEC.naveRoof - 1.9;
  const naveHalf = ARC + PW / 2 - 0.2;
  {
    /**
     * THE WEBBING IS CONTINUOUS AND THE RELIEF SITS ON TOP OF IT.
     *
     * The first version laid three shells PER BAY and put all three at the same
     * z, so it built a 1.3 m strip in the middle of every bay and left 2.7 m of
     * open sky between them — screenshotted from the nave floor, the ceiling was
     * a set of beams with daylight through it and the ribs looked like joists.
     * A vault is a SURFACE. So: one slab down each half of the church (the
     * crossing is deliberately open, because that is where you look up into the
     * dome), and the per-bay curvature laid over it.
     */
    const bays = [...NAVE_V, ...CHOIR_V];
    for (const [v0, v1] of [[-HD + T, CROSS_V[0]], [CROSS_V[1], HD - T]]) {
      A.add('plaster_white', box, LL(IDENT, X(0), VAULT_Y, Z((v0 + v1) / 2), 0, naveHalf * 2 - 0.4, 0.34, v1 - v0),
        { masks: [0.3, 0.55, 0.6] });
      A.box('concrete', X(0), VAULT_Y + 0.05, Z((v0 + v1) / 2), naveHalf * 2, 0.44, v1 - v0);
    }
    for (const v of bays) {
      // the severies: three courses across each bay, rising to the crown, so the
      // surface is a vault and not a soffit
      for (let i = 0; i < 3; i++) {
        const f = (i + 0.5) / 3;
        const drop = Math.sin(f * Math.PI) * 0.5;
        A.add('plaster_white', box,
          LL(IDENT, X(0), VAULT_Y + 0.18 + drop, Z(v + 2 + (f - 0.5) * 4), 0, naveHalf * 2 - 0.5, 0.3, 4 / 3 + 0.06),
          { masks: [0.3, rng.range(0.35, 0.8), 0.6] });
      }
      // transverse rib on the bay line
      A.add('concrete', soft, LL(IDENT, X(0), VAULT_Y - 0.28, Z(v), 0, naveHalf * 2, 0.42, 0.44),
        { masks: [0.85, 0.4, 0.35] });
      /**
       * The two diagonals of the bay. They are drawn as one long rib rotated
       * about Y in each direction rather than as a curve, because a rib seen
       * from 14 m below through a 5 lux nave is a line — what has to be right is
       * that there ARE two of them, that they cross on the boss, and that they
       * land on the wall shafts at the four corners of the bay.
       */
      const diag = Math.atan2(naveHalf * 2, 4);
      for (const s of [-1, 1]) {
        A.add('concrete', soft,
          LL(IDENT, X(0), VAULT_Y - 0.42, Z(v + 2), s * (Math.PI / 2 - diag),
            Math.hypot(naveHalf * 2, 4), 0.3, 0.32), { masks: [0.8, 0.45, 0.3] });
      }
      // a boss where the ribs cross
      A.add('concrete_dark', soft, LL(IDENT, X(0), VAULT_Y - 0.5, Z(v + 2), 0, 0.7, 0.3, 0.7),
        { masks: [0.95, 0.5, 0.2] });
    }
    // wall shafts running the rib down to the pier capitals
    for (const side of [-1, 1]) {
      for (const v of bays) {
        const g = tubeY(0.17, VAULT_Y - SEC.triTop - 0.5, { radial: 7 });
        A.addOnce('plaster_cream', g, LL(IDENT, X(side * (naveHalf - 0.2)), SEC.triTop + 0.5, Z(v)),
          { masks: [0.65, 0.4, 0.5] });
      }
    }
    // the lead roof over the vault, its standing seams, and the parapet gutter
    A.add('metal_dark', box, LL(IDENT, X(0), SEC.naveRoof, Z(0), 0, naveHalf * 2 + 1.2, 0.4, S.d - 1.2),
      { masks: [0.7, 0.6, 0.25] });
    A.box('concrete', X(0), SEC.naveRoof, Z(0), naveHalf * 2 + 1.2, 0.4, S.d - 1.2);
    for (let u = -naveHalf + 0.6; u < naveHalf; u += 1.1) {
      A.add('metal_dark', thin, LL(IDENT, X(u), SEC.naveRoof + 0.28, Z(0), 0, 0.09, 0.16, S.d - 1.6),
        { masks: [0.85, 0.5, 0.15] });
    }
    for (const side of [-1, 1]) {
      solid('concrete', side * (naveHalf + 0.5), (SEC.naveRoof + SEC.parapet) / 2 + 0.1, 0,
        0.42, SEC.parapet - SEC.naveRoof, S.d - 1.2);
      trim('concrete_dark', side * (naveHalf + 0.5), SEC.parapet + 0.08, 0, 0.66, 0.16, S.d - 1.2, [0.95, 0.3, 0.1]);
    }
  }

  /* ====================================================================== */
  /* 5. THE CROSSING DOME — the silhouette, and what the strike takes off    */
  /* ====================================================================== */
  {
    const R = naveHalf;
    // squinches turning the square crossing into an octagon
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) {
        A.add('plaster_cream', box, LL(IDENT, X(su * R * 0.72), SEC.naveRoof - 1.2, Z(sv * 4.2), 0,
          R * 0.6, 2.4, 2.4, 0, 0), { masks: [0.5, 0.5, 0.55] });
      }
    }
    // the drum: an octagon of piers with a light between each pair
    const nf = 8;
    for (let i = 0; i < nf; i++) {
      const a = (i / nf) * Math.PI * 2 + Math.PI / nf;
      const u = Math.cos(a) * R * 0.94;
      const v = Math.sin(a) * R * 0.94;
      const seg = (2 * Math.PI * R * 0.94) / nf;
      A.add('plaster_sand', box, LL(IDENT, X(u), (SEC.naveRoof + SEC.drumTop) / 2, Z(v), -a,
        seg * 0.42, SEC.drumTop - SEC.naveRoof, 0.7), { masks: stone() });
      A.box('concrete', X(u), (SEC.naveRoof + SEC.drumTop) / 2, Z(v), seg * 0.42, SEC.drumTop - SEC.naveRoof, 0.7, -a);
      for (const side of [0, Math.PI]) {
        A.add('window_glow', pane,
          LL(IDENT, X(u * (0.99 - (side ? 0.004 : 0))), (SEC.naveRoof + SEC.drumTop) / 2 + 0.3,
            Z(v * (0.99 - (side ? 0.004 : 0))), -a + Math.PI / 2 + side,
            seg * 0.5, SEC.drumTop - SEC.naveRoof - 1.4, 1), { masks: [0.3, 0.4, 0.05] });
      }
    }
    trim('concrete_dark', 0, SEC.drumTop + 0.2, 0, R * 2.1, 0.4, R * 2.1, [0.95, 0.35, 0.12]);
    // the shell, as rings of decreasing radius on a hemispherical profile
    // 13 courses rather than 7: at seven the shell reads as a ziggurat from the
    // street, which is the one silhouette on this map you see from both bases.
    const rings = 13;
    for (let i = 0; i < rings; i++) {
      const t0 = i / rings;
      const t1 = (i + 1) / rings;
      const y0 = SEC.drumTop + (SEC.domeTop - SEC.drumTop) * Math.sin((t0 * Math.PI) / 2);
      const y1 = SEC.drumTop + (SEC.domeTop - SEC.drumTop) * Math.sin((t1 * Math.PI) / 2);
      const r0 = R * 0.98 * Math.cos((t0 * Math.PI) / 2);
      const n = Math.max(10, Math.round(r0 * 2.6));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        A.add('roof_screed', box,
          LL(IDENT, X(Math.cos(a) * r0), (y0 + y1) / 2, Z(Math.sin(a) * r0), -a,
            (2 * Math.PI * r0) / n + 0.1, y1 - y0 + 0.12, 0.5),
          { masks: [0.55, rng.range(0.4, 0.8), 0.3] });
      }
      A.box('concrete', X(0), (y0 + y1) / 2, Z(0), r0 * 2, y1 - y0 + 0.1, r0 * 2);
    }
    // eight ribs over the shell
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      for (let k = 0; k < 13; k++) {
        const t0 = k / 13;
        const y = SEC.drumTop + (SEC.domeTop - SEC.drumTop) * Math.sin((t0 * Math.PI) / 2) + 0.2;
        const r0 = R * 1.02 * Math.cos((t0 * Math.PI) / 2);
        A.add('concrete', soft, LL(IDENT, X(Math.cos(a) * r0), y, Z(Math.sin(a) * r0), -a, 0.36, 0.5, 0.7),
          { masks: [0.9, 0.4, 0.2] });
      }
    }
    // the lantern
    solid('plaster_cream', 0, (SEC.domeTop + SEC.lanternTop) / 2, 0, 2.6, SEC.lanternTop - SEC.domeTop, 2.6);
    trim('concrete_dark', 0, SEC.lanternTop + 0.2, 0, 3.4, 0.4, 3.4, [0.95, 0.3, 0.1]);
    const fin = tubeY(0.12, 2.2, { radial: 6 });
    A.addOnce('metal_rust', fin, LL(IDENT, X(0), SEC.lanternTop + 0.4, Z(0)), { masks: [1, 0.8, 0.1] });
  }

  /* ====================================================================== */
  /* 6. THE CAMPANILE, AND THE STAIR TO THE GALLERY INSIDE IT               */
  /* ====================================================================== */
  {
    const tu = (TOW.u0 + TOW.u1) / 2;
    const tv = (TOW.v0 + TOW.v1) / 2;
    const tw = TOW.u1 - TOW.u0;
    const td = TOW.v1 - TOW.v0;
    // three walls of it (the fourth is open to the aisle, which is the way in)
    for (const [du, dv, su, sv] of [
      [-(tw / 2 - T / 2), 0, T, td], [0, -(td / 2 - T / 2), tw, T], [tw / 2 - T / 2, 0, T, td],
    ]) {
      solid('plaster_sand', tu + du, SEC.towerTop / 2, tv + dv, su, SEC.towerTop, sv);
    }
    // string courses every 6 m, so the shaft has scale on it
    for (let y = 6; y < SEC.towerTop - 2; y += 6) {
      trim('concrete_dark', tu, y, tv, tw + 0.32, 0.3, td + 0.32, [0.95, 0.45, 0.2]);
    }
    // the belfry: a tall opening on all four faces, then the cap
    for (const [du, dv, su, sv, ry] of [
      [-(tw / 2), 0, 0.5, 2.4, 0], [tw / 2, 0, 0.5, 2.4, 0],
      [0, -(td / 2), 2.4, 0.5, 0], [0, td / 2, 2.4, 0.5, 0],
    ]) {
      A.add('plaster_sand', box, LL(IDENT, X(tu + du), 25.9, Z(tv + dv), ry, su + 0.3, 0.9, sv + 0.3),
        { masks: [0.7, 0.4, 0.3] });
      arch('plaster_sand', tu + du, 25.4, tv + dv, su > sv ? su : sv, 0.9, su > sv, 0.6);
    }
    trim('concrete_dark', tu, SEC.towerTop + 0.25, tv, tw + 0.8, 0.5, td + 0.8, [0.95, 0.3, 0.12]);
    // a squat pyramidal cap
    for (let i = 0; i < 5; i++) {
      const f = i / 5;
      trim('roof_screed', tu, SEC.towerTop + 0.7 + f * 3.0, tv,
        (tw + 0.4) * (1 - f * 0.85), 0.68, (td + 0.4) * (1 - f * 0.85), [0.6, 0.5, 0.3]);
    }
    A.box('concrete', X(tu), SEC.towerTop + 2.2, Z(tv), tw, 3.2, td);
    // the bell, hanging where the belfry openings show it
    const bell = tubeY(0.62, 1.1, { radial: 12, taper: 0.45 });
    A.addOnce('metal_rust', bell, LL(IDENT, X(tu), 24.6, Z(tv)), { masks: [0.9, 0.7, 0.4] });
    A.add('wood_dark', thin, LL(IDENT, X(tu), 26.0, Z(tv), 0, tw - 1.2, 0.24, 0.3), { masks: [0.8, 0.7, 0.3] });

    /**
     * THE STAIR. One straight flight up the tower, floor to gallery: 5.44 m of
     * rise in 30 risers of 0.181 m at a 0.27 m going, which is 8.1 m of run and
     * fits the tower's 8.2 m exactly. Every riser is under `STANCE.stand`'s
     * 0.42 m step height, so the controller walks it without a mantle.
     *
     * IT IS ALSO INVISIBLE TO A*, AND THAT IS FINE. `_carveInteriors` re-probes
     * this footprint from 1.72 m, so the treads under that height come back as
     * ground and the ones above do not — and consecutive nav cells 0.8 m apart
     * on a 34° flight differ by 0.54 m against a 0.45 m `maxStep`, so no bot
     * ever climbs it. That is the same bargain every stair on this map makes:
     * "UPPER FLOORS AND ROOFS ARE STILL A PLAYER FEATURE".
     */
    const steps = 30;
    const rise = (SEC.gallery - SEC.floor) / steps;
    const going = 0.27;
    for (let i = 0; i < steps; i++) {
      const y = SEC.floor + (i + 1) * rise;
      const v = TOW.v0 + 0.5 + i * going;
      solid('concrete', tu + 0.3, y / 2 + SEC.floor / 2, v, tw - 2.0, y - SEC.floor, going + 0.02,
        'concrete', [0.8, rng.range(0.5, 0.9), 0.45]);
    }
    // a landing joining the head of the flight to the west gallery
    solid('floor_concrete', tu + 0.3, SEC.gallery - 0.18, TOW.v0 + 0.5 + steps * going + 0.8,
      tw - 2.0, 0.36, 1.8);
  }

  /* ====================================================================== */
  /* 7. WHAT IS IN IT                                                       */
  /* ====================================================================== */
  {
    // the altar platform at the apse: two 0.15 m steps, which a bot walks
    for (let i = 0; i < 2; i++) {
      solid('concrete', 0, SEC.floor + 0.075 + i * 0.15, HD - 5.5 + i * 0.9, 11 - i * 1.8, 0.15, 7 - i * 1.8,
        'concrete', [0.85, 0.6, 0.4]);
    }
    solid('concrete_dark', 0, SEC.floor + 0.3 + 0.55, HD - 4.4, 2.8, 1.1, 1.2, 'concrete', [0.9, 0.45, 0.3]);
    trim('concrete', 0, SEC.floor + 0.3 + 1.16, HD - 4.4, 3.3, 0.14, 1.6, [0.95, 0.3, 0.2]);
    /**
     * ────────────────────────────────────────────────────────────────────────
     * THE TOMB CHESTS ROUND THE CROSSING — MASS ON THE CAPTURE POINT
     * ────────────────────────────────────────────────────────────────────────
     * `tools/sitecheck.mjs` counts mass standing 0.9-2.8 m over the zone floor
     * inside the 8 m circle and wants 12 m² of it. Measured on the first build
     * of this building: 8.5 m², because the only things near the crossing were
     * the four crossing piers at 9.9 m — OUTSIDE the circle — and the nave
     * between them was deliberately swept clear. An empty crossing is the
     * "剥き出し" complaint again, one storey further in.
     *
     * Six chest tombs on a 5.2-6.5 m ring, 1.25 m tall: waist-high to a standing
     * man, full cover to a crouching one, and exactly the furniture a crossing
     * has. The ring is sized between two hard numbers — `standRing` cuts the
     * zone's eight standing points (which are also its FORWARD SPAWNS) at 4 m,
     * so nothing may be inside that, and the capture circle is 8 m, so nothing
     * outside it counts. Two of the six are on the NORTH arc, which is the side
     * `sitecheck` samples the attacker's eyes from.
     */
    for (const [tu, tv, ry] of [
      [-4.9, -4.9, 0.78], [4.9, -4.9, -0.78], [-4.9, 4.9, -0.78], [4.9, 4.9, 0.78],
      [0, 6.1, 0], [0, -6.1, 0],
    ]) {
      const cs = Math.cos(ry);
      const sn = Math.sin(ry);
      A.add('concrete', box, LL(IDENT, X(tu), SEC.floor + 0.62, Z(tv), ry, 2.5, 1.24, 1.15),
        { masks: [0.6, 0.6, 0.45] });
      A.box('concrete', X(tu), SEC.floor + 0.62, Z(tv), 2.5, 1.24, 1.15, ry);
      // a moulded base and a lid that overhangs it, so the silhouette is not a box
      trim('concrete_dark', tu, SEC.floor + 0.11, tv, 2.72, 0.22, 1.37, [0.9, 0.85, 0.6], ry);
      trim('concrete_dark', tu, SEC.floor + 1.29, tv, 2.74, 0.16, 1.39, [0.95, 0.35, 0.18], ry);
      // an effigy on two of them, and a broken corner on the rest
      if (Math.abs(tu) > 1) {
        A.add('plaster_white', soft, LL(IDENT, X(tu), SEC.floor + 1.5, Z(tv), ry, 1.9, 0.28, 0.62),
          { masks: [0.75, 0.5, 0.4] });
      } else {
        for (let i = 0; i < 6; i++) {
          const g = rockGeometry(rng, rng.range(0.08, 0.2), 1, rng.range(0.5, 0.85));
          fillMasks(g, 0.9, rng.range(0.4, 0.9), 0.15);
          A.addOnce('concrete_dark', g,
            LL(IDENT, X(tu + cs * rng.range(-1.4, 1.4) + sn * 0.9), SEC.floor + rng.range(0.04, 0.16),
              Z(tv - sn * rng.range(-1.4, 1.4) + cs * 0.9), rng.float() * 6.28));
        }
      }
    }
    // the choir screen: a low pierced wall across the choir, which is cover on
    // the north approach to the point and does not close it
    for (const s of [-1, 1]) {
      solid('concrete', s * 5.0, SEC.floor + 0.6, 7.6, 5.4, 1.2, 0.5, 'concrete', [0.6, 0.6, 0.4]);
      trim('concrete_dark', s * 5.0, SEC.floor + 1.26, 7.6, 5.7, 0.16, 0.72, [0.95, 0.35, 0.15]);
    }
    // benches down both aisles, off the walking line
    for (const side of [-1, 1]) {
      for (let v = -HD + 5; v < HD - 8; v += 2.2) {
        if (Math.abs(v) < 6) continue;
        if (side < 0 && v < TOW.v1 - HD + 8.2) continue;
        A.add('wood_dark', box, LL(IDENT, X(side * (HW - T - 1.15)), SEC.floor + 0.44, Z(v), 0, 1.5, 0.1, 1.5),
          { masks: [0.8, rng.range(0.4, 0.9), 0.3] });
        A.box('wood', X(side * (HW - T - 1.15)), SEC.floor + 0.25, Z(v), 1.5, 0.5, 1.5);
        A.add('wood_dark', thin, LL(IDENT, X(side * (HW - T - 0.5)), SEC.floor + 0.78, Z(v), 0, 0.12, 0.8, 1.5),
          { masks: [0.85, 0.5, 0.25] });
      }
    }
    // rubble and fallen render: this town has been shelled and the church is
    // in it. Kept out of the 4.5 m the capture point needs clear.
    for (let i = 0; i < 90; i++) {
      const u = rng.range(-HW + 1.2, HW - 1.2);
      const v = rng.range(-HD + 1.2, HD - 1.2);
      if (Math.hypot(u, v) < 5.2) continue;
      const g = rockGeometry(rng, rng.range(0.07, 0.26), 1, rng.range(0.45, 0.8));
      fillMasks(g, 0.85, rng.range(0.3, 0.9), 0.2);
      A.addOnce(rng.float() < 0.6 ? 'concrete_dark' : 'plaster_white', g,
        LL(IDENT, X(u), SEC.floor + rng.range(0.02, 0.1), Z(v), rng.float() * 6.28));
    }
    // hanging lamps on chains down the nave — and the practicals that go with
    // them. `A.interiorLights` is capped at 20 by `WorldSystem._addLights`.
    for (const v of [-13, -5, 5, 13]) {
      const chain = tubeY(0.03, VAULT_Y - 5.6, { radial: 5 });
      A.addOnce('metal_rust', chain, LL(IDENT, X(0), 5.6, Z(v)), { masks: [1, 0.8, 0.1] });
      const bowl = tubeY(0.42, 0.34, { radial: 10, taper: 0.5 });
      A.addOnce('metal_rust', bowl, LL(IDENT, X(0), 5.3, Z(v)), { masks: [0.9, 0.7, 0.2] });
      A.add('emissive_warm', thin, LL(IDENT, X(0), 5.5, Z(v), 0, 0.5, 0.06, 0.5), { masks: [0, 0, 0] });
      A.interiorLights?.push({ x: X(0), y: 5.2, z: Z(v) });
    }
    // candle stands in the aisles
    for (const side of [-1, 1]) {
      for (const v of [-8, 9]) {
        const st = tubeY(0.09, 1.1, { radial: 6 });
        A.addOnce('metal_rust', st, LL(IDENT, X(side * (HW - T - 2.4)), SEC.floor, Z(v)), { masks: [0.95, 0.6, 0.2] });
        A.add('emissive_warm', thin, LL(IDENT, X(side * (HW - T - 2.4)), SEC.floor + 1.16, Z(v), 0, 0.4, 0.05, 0.4),
          { masks: [0, 0, 0] });
      }
    }
  }

  A.endScope();

  /* ====================================================================== */
  /* 8. THE RUIN — what stands there once the shell has stopped being drawn */
  /* ====================================================================== */
  /**
   * ────────────────────────────────────────────────────────────────────────
   * BUILT AT BOOT, HIDDEN AT BOOT, SHOWN IN ONE FRAME
   * ────────────────────────────────────────────────────────────────────────
   * The second scope. It is the mirror of `cath:shell` and the two are never
   * drawn at once: `setRazed` hides one and shows the other, which is two index
   * fills and two mask writes. Nothing here is generated, fractured, relaxed or
   * solved when the event fires — the height field below is solved HERE, at
   * boot, and what the event does with it is flip an index range.
   *
   * ────────────────────────────────────────────────────────────────────────
   * WHY THIS WAS REBUILT: "大聖堂の破壊なのに跡地がしょぼい"
   * ────────────────────────────────────────────────────────────────────────
   * The first ruin read the brief ("更地にする") literally and levelled the site:
   * measured over the footprint on a 0.5 m lattice, the highest solid went
   * 32.8 m → 3.45 m, the MEAN surface stood 0.33 m over the floor and 82 % of
   * the plan was bare tile. Standing in the nave you saw a tiled floor, open
   * sky, a few chest-height blocks and two pier stumps. That is not what is left
   * when a 29 m building the width of the map centre comes down, and site D sits
   * in that footprint.
   *
   * A masonry church leaves four things and the old ruin had one of them:
   *
   *   1. THE FILL. The vault webbing, the roof, the render and the floor screed
   *      end up ON THE PLAN, everywhere, a metre deep. `RUBBLE FIELD` below.
   *   2. THE WALLS, HALF DOWN. A wall does not vanish, it TEARS: bays that
   *      survive to six or eight metres beside bays that are a heap.
   *      `tornWall` below, and it is what puts a silhouette back on the site.
   *   3. THE ARCH OVER A DOOR, standing on its jambs after everything either
   *      side of it has gone. `brokenArch` below.
   *   4. THE DOME AND THE TOWER, which are the two biggest single masses on the
   *      plan and land where they stood.
   *
   * ────────────────────────────────────────────────────────────────────────
   * THE CONSTRAINT EVERY EXTRA TONNE HAS TO LIVE INSIDE, MEASURED NOT ASSUMED
   * ────────────────────────────────────────────────────────────────────────
   * `AiSystem._buildNav` runs `grid.build()` BEFORE `_bakeCover`, and
   * `_bakeCover` is the first thing on this map that ever calls `setRazed` — so
   * THE ONE HEIGHT FIELD THE WHOLE MATCH NAVIGATES ON WAS BAKED WITH BOTH
   * `cath:shell` AND `cath:ruin` SOLID. `_cathgrid.mjs` measures it: the eight
   * fallen-dome blocks stand on bare nave floor the shell never touches and
   * every one of their cells comes back `flags = 0`.
   *
   * That cuts both ways and the good half is the surprising one:
   *
   *   - NOTHING HERE CAN BECOME AN INVISIBLE WALL. The grid is the INTERSECTION
   *     of the two states, so a cell this scope blocks is a cell A* already
   *     refuses to route through with the church still standing. `stuckcheck`
   *     cannot be failed by adding mass here; that is what makes a 14 m tower
   *     stump affordable at all.
   *   - WHAT IT COSTS IS WALKABLE INTERIOR, IN BOTH STATES. Every cell this
   *     scope blocks is a cell the bots lose inside the STANDING cathedral too,
   *     and that building exists because "屋内のエリアを作ってそこにもAIがいく利点や
   *     メリットを与えて". So the mass is a BUDGET, spent where it buys the most
   *     silhouette per cell.
   *
   * And it fixes the ceiling on rubble that is meant to stay walkable.
   * `NavGrid._carveInteriors` re-samples this footprint from `probeY` and
   * REJECTS any cell whose surface stands more than 0.9 m over the volume's
   * `floorY`, so 1.06 m is the entire budget for ground a bot may cross. That is
   * an ABSOLUTE ceiling, not a per-step one, which is why
   * `src/world/demolition.js`'s treatment only half applies here:
   *
   *   - ITS RELAXATION DOES APPLY, and the field below is relaxed exactly as
   *     `_relax` relaxes the district debris — no two neighbouring cells differ
   *     by more than `STEP_MAX`, so the walkable tier is a landscape a man walks
   *     over rather than a set of ledges he mantles.
   *   - ITS CONCLUSION DOES NOT. There, height and walkability trade against
   *     each other smoothly and the answer was a low wide pile. Here they do
   *     not: 1.06 m is walkable and 1.07 m is a wall, however gently it got
   *     there. So the ruin is TWO TIERS on purpose — a relaxed rubble FIELD at
   *     0.15-1.00 m that is ground, and discrete MASSES at 1.5-14 m that are
   *     not, standing where the building's own mass stood.
   *
   * ────────────────────────────────────────────────────────────────────────
   * WHERE THE BUDGET IS SPENT, AND WHY THE LANES ARE AUTHORED
   * ────────────────────────────────────────────────────────────────────────
   * Almost all of the tall mass is FREE, because it stands on ground the SHELL
   * already blocked: the four wall lines, the ten buttress footings on each
   * flank, the twenty arcade piers and the campanile's own plan (its stair fills
   * it). Everything else is charged, so the field keeps a cruciform of LANES
   * open — the nave and choir axis, the transept axis, a run down each aisle and
   * a spur in from each of the two side portals — held under the 1.06 m ceiling
   * and joined to every doorway in the shell. That is the circulation the church
   * itself had, and it is what `_postcheck.mjs` walks.
   *
   * `KEEP_STAND` is what the fallen dome stays outside, because `standRing`
   * proves D's eight standing points on a 4.0 m ring at BOOT and never re-proves
   * them, and the crossing is authored as a BOWL — the dome fell INTO it — so
   * D's cover mass comes from cover you fight behind rather than from a plinth
   * the whole zone stands on. `_dmass.mjs` re-runs `sitecheck`'s two assertions
   * there (12 m² of 0.9-2.8 m mass, 6 standing cover points) because the zone is
   * authored `locked` and `sitecheck` structurally cannot see it.
   *
   * `_postcheck.mjs` re-runs navcheck's own assertion with this scope live,
   * `_razestuck.mjs` re-runs stuckcheck on it, `_cathruin.mjs` measures the
   * silhouette, and `?cath=down` boots straight into it so the gates in `tools/`
   * can be pointed at the ruin without a match. @see `setRazed`.
   */
  const ruin = A.beginScope('cath:ruin');
  {
    /**
     * The band the discrete masses keep out of. `standRing` puts D's eight
     * standing points — which are also its forward spawns — on a 4.0 m ring.
     */
    const KEEP_STAND = 4.75;
    /**
     * The tallest rubble a cell may carry and still be ground.
     * `_carveInteriors` rejects `fy > floorY + 0.9`; this leaves 6 cm of margin.
     */
    const WALK_CAP = SEC.floor + 0.84;
    /** Grey rubble, ash and broken render — the palette the shell was built in. */
    const RUBBLE = ['concrete_dark', 'concrete', 'plaster_white', 'plaster_cream', 'plaster_sand', 'roof_screed'];
    const RUB_W = [0.2, 0.2, 0.16, 0.16, 0.16, 0.12];
    const rubbleKey = () => {
      let r = rng.float();
      for (let i = 0; i < RUBBLE.length; i++) {
        r -= RUB_W[i];
        if (r <= 0) return RUBBLE[i];
      }
      return RUBBLE[0];
    };
    const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

    /** A one-off faceted lump, merged and freed. The eye's unit of debris. */
    const lump = (key, u, y, v, size, squash = 0.6, w = 0.9) => {
      const g = rockGeometry(rng, size, 1, squash);
      fillMasks(g, w, rng.range(0.3, 0.95), 0.3);
      A.addOnce(key, g, LL(IDENT, X(u), y, Z(v), rng.float() * 6.283));
    };

    /* ================================================================== */
    /* 8a. THE RUBBLE FIELD — the tier that is ground                     */
    /* ================================================================== */
    /**
     * A height field on a 1.7 m lattice over the whole plan and 2.6 m of apron
     * past it, authored from WHERE THE MASS WAS and then relaxed, exactly as
     * `_debrisField` authors and relaxes a district block:
     *
     *   - deepest against the four walls, which is where a wall lands;
     *   - a second ridge under the arcade, which carried the clerestory and the
     *     nave vault as well as itself;
     *   - a swell over the campanile's corner, which had four times the mass of
     *     anything else on the plan;
     *   - a BOWL at the crossing, because the dome fell into it and because D
     *     has to stay a point you fight over rather than a plinth;
     *   - and pulled back down along the LANES, so the doorways of the shell
     *     still lead somewhere.
     *
     * Then clamped to `WALK_CAP` and relaxed to `STEP_MAX`, so the whole tier is
     * ground in the baked grid AND a surface a man walks rather than mantles.
     * The relaxation is the load-bearing line here for the same reason it is in
     * `demolition.js`: two octaves of noise on a dome makes cliffs, and a cliff
     * in a height field is a cell nobody can cross.
     */
    const CELL = 1.7;
    const APRON = 2.6;
    /** 0.45 is `NavGrid.maxStep` and the two lattices do not line up; 0.34 is
     *  under it however a 0.8 m nav cell falls inside a 1.7 m debris cell. */
    const STEP_MAX = 0.34;
    const FHW = HW + APRON;
    const FHD = HD + APRON;
    const NX = Math.round((FHW * 2) / CELL);
    const NZ = Math.round((FHD * 2) / CELL);
    const DXC = (FHW * 2) / NX;
    const DZC = (FHD * 2) / NZ;

    /**
     * Metres to the nearest lane the ruin keeps open. The cruciform is the
     * church's own circulation: nave and choir on the axis, the transept across
     * it, a run down each aisle just clear of the arcade, and a spur in from
     * each of the two side portals of the south front.
     */
    const laneDist = (u, v) => {
      let d = Math.min(Math.abs(u), Math.abs(v));
      d = Math.min(d, Math.abs(Math.abs(u) - 10.9));
      if (v < -16.0) d = Math.min(d, Math.abs(Math.abs(u) - 5.6));
      /**
       * …AND THE CROSSING IS A PLAZA, NOT A JUNCTION OF TWO LANES. D's circle
       * and a metre of rim outside it are all lane, so a capture point in the
       * middle of a rubble field is somewhere fifteen men can actually work.
       */
      d = Math.min(d, Math.max(0, Math.hypot(u, v) - 8.6));
      return d;
    };

    const TCU = (TOW.u0 + TOW.u1) / 2;
    const TCV = (TOW.v0 + TOW.v1) / 2;

    const fieldAt = (u, v) => {
      const n = fbm3(u * 0.21 + 6.7, 3.3, v * 0.21 + 2.9, 2) - 0.5;
      const outside = Math.max(Math.abs(u) - HW, Math.abs(v) - HD);
      if (outside > 0) {
        /**
         * THE SPILL ON TO THE PARVIS — "大聖堂周りを瓦礫の山に" — and it is capped
         * hard on purpose. These cells are STREET: the open-air sweep bakes them
         * with this scope solid, and a knee-high pile round a building in the
         * middle of the map is a kerb every route past it has to climb.
         */
        return Math.max(0, (0.30 + n * 0.14) * clamp01(1 - outside / APRON));
      }
      let h = 0.32 + n * 0.30;
      // the walls fell inward
      h += 0.66 * clamp01(1 - Math.min(HW - Math.abs(u), HD - Math.abs(v)) / 4.6);
      // the arcade, and the clerestory and the nave vault it carried
      h += 0.38 * clamp01(1 - Math.abs(Math.abs(u) - ARC) / 3.2);
      // the campanile's corner
      h += 0.50 * clamp01(1 - Math.hypot(u - TCU, v - TCV) / 10.0);
      // …and the crossing is a bowl the dome fell into
      h -= 0.40 * clamp01(1 - Math.hypot(u, v) / 6.2);
      // the lanes, pulled back down and blended out over ~2 m
      const ld = laneDist(u, v);
      h = Math.min(h, 0.26 + n * 0.22 + Math.max(0, ld - 2.2) * 0.5);
      return Math.max(0.12, h);
    };

    const fh = new Float32Array(NX * NZ);
    const fjx = new Float32Array(NX * NZ);
    const fjz = new Float32Array(NX * NZ);
    for (let iz = 0; iz < NZ; iz++) {
      for (let ix = 0; ix < NX; ix++) {
        const i = iz * NX + ix;
        const u = -FHW + (ix + 0.5) * DXC;
        const v = -FHD + (iz + 0.5) * DZC;
        fh[i] = Math.min(WALK_CAP - SEC.floor, fieldAt(u, v));
        fjx[i] = rng.range(-0.24, 0.24);
        fjz[i] = rng.range(-0.24, 0.24);
      }
    }
    /** `_relax`, on this field. Only ever lowers, so it converges from above. */
    for (let pass = 0; pass < 12; pass++) {
      let moved = 0;
      for (let k = 0; k < 2; k++) {
        const fwd = k === 0;
        for (let s = 0; s < NX * NZ; s++) {
          const i = fwd ? s : NX * NZ - 1 - s;
          const ix = i % NX;
          const iz = (i / NX) | 0;
          for (let d = 0; d < 4; d++) {
            const jx = ix + (d === 0 ? 1 : d === 1 ? -1 : 0);
            const jz = iz + (d === 2 ? 1 : d === 3 ? -1 : 0);
            if (jx < 0 || jz < 0 || jx >= NX || jz >= NZ) continue;
            const j = jz * NX + jx;
            if (fh[i] - fh[j] > STEP_MAX) {
              fh[i] = fh[j] + STEP_MAX;
              moved++;
            }
          }
        }
      }
      if (!moved) break;
    }

    /**
     * The field, drawn — the `_debris` recipe, in this building's palette. One
     * piece carries the height the proxy promises and two or three smaller ones
     * are jammed against it at steeper angles in different materials, because a
     * cell drawn as a single slab of exactly `h` reads as plywood sheeting from
     * anywhere above it. The COLLISION is the axis-aligned box under it with a
     * flat top at exactly `h`, which is what both height fields sample.
     */
    for (let iz = 0; iz < NZ; iz++) {
      for (let ix = 0; ix < NX; ix++) {
        const i = iz * NX + ix;
        const h = fh[i];
        if (h < 0.06) continue;
        const cu = -FHW + (ix + 0.5) * DXC;
        const cv = -FHD + (iz + 0.5) * DZC;
        const u = cu + fjx[i];
        const v = cv + fjz[i];
        const heap = 2 + ((rng.float() * 3) | 0);
        for (let k = 0; k < heap; k++) {
          const main = k === 0;
          const su = DXC * (main ? rng.range(0.8, 0.98) : rng.range(0.28, 0.6));
          const sv = DZC * (main ? rng.range(0.8, 0.98) : rng.range(0.28, 0.6));
          const sy = main ? h * rng.range(1.0, 1.2) : h * rng.range(0.35, 0.95);
          A.add(rubbleKey(), soft,
            LL(IDENT,
              X(u + (main ? 0 : rng.range(-DXC * 0.36, DXC * 0.36))),
              SEC.floor + sy * 0.5 + (main ? 0 : rng.range(0, h * 0.5)),
              Z(v + (main ? 0 : rng.range(-DZC * 0.36, DZC * 0.36))),
              rng.range(-0.9, 0.9), su, sy, sv,
              rng.range(main ? -0.1 : -0.4, main ? 0.1 : 0.4),
              rng.range(main ? -0.1 : -0.4, main ? 0.1 : 0.4)),
            { masks: [rng.range(0.5, 0.98), rng.range(0.55, 1.0), rng.range(0.4, 0.85)] });
        }
        // Loose lumps on top: no collision by design, all of them well under the
        // 0.42 m the controller steps over, and this is where the pile's own
        // silhouette comes from.
        const lumps = 1 + ((rng.float() * 3) | 0);
        for (let k = 0; k < lumps; k++) {
          const s = rng.range(0.18, 0.6);
          lump(rng.float() < 0.5 ? 'concrete' : 'brick_fine',
            u + rng.range(-0.7, 0.7), SEC.floor + h + s * 0.2, v + rng.range(-0.7, 0.7), s, 0.72, 0.35);
        }
        /**
         * EVERY CELL GETS A PROXY, AND THE THRESHOLD IS THE WHOLE POINT.
         *
         * `demolition.js` only gives a cell a box at 0.42 m, on the argument
         * that the controller steps over anything lower and a box there is a
         * bump in the height field for nothing. That argument is wrong for a
         * RELAXED field and it cost a measurable amount here. The relaxation
         * guarantees neighbours differ by at most `STEP_MAX`, but a cell under
         * the threshold reports the TILE FLOOR rather than its own top — so the
         * step the grid sees across that boundary is `threshold + STEP_MAX`,
         * which at 0.3 is 0.64 against a `NavGrid.maxStep` of 0.45. The lanes
         * came back walkable and NOT CONNECTED along their own edges, and
         * `_postcheck.mjs` measured it as bots in the ruin: 64.6 % of frames
         * with a man inside D before this change, 14-27 % after.
         *
         * At 0.08 the worst boundary step is 0.42, inside the limit whichever
         * way the two lattices fall. It is 630-odd extra boxes at boot.
         */
        if (h >= 0.08) {
          A.box('concrete', X(cu), SEC.floor + h * 0.5, Z(cv), DXC * 1.06, h, DZC * 1.06);
        }
      }
    }
    /** The rubble surface at a plan position, for anything that sits ON it. */
    const groundAt = (u, v) => {
      const ix = Math.min(NX - 1, Math.max(0, Math.floor((u + FHW) / DXC)));
      const iz = Math.min(NZ - 1, Math.max(0, Math.floor((v + FHD) / DZC)));
      return SEC.floor + fh[iz * NX + ix];
    };

    /* ================================================================== */
    /* 8b. THE WALLS, HALF DOWN — the tier that is not ground             */
    /* ================================================================== */
    /**
     * A wall does not level, it TEARS. `tornWall` lays one elevation as columns
     * of masonry roughly a metre wide, each standing to its own height off a
     * profile that is mostly a 1.5-3 m heap with AUTHORED SURVIVORS in it —
     * bays that are still four, six or eight metres of wall, with a torn top,
     * exposed rubble core and lumps of the course that came off resting on the
     * break. Those survivors are the silhouette: they are what makes the site
     * read as the remains of a building rather than as a levelled plot, and they
     * are what breaks the 45 m sightline down the nave.
     *
     * COLLISION SITS ON THE WALL'S OWN STRIP plus `SPILL` metres of the aisle,
     * which is a metre of already-cheap cells buying the whole elevation depth.
     * `gaps` are the shell's doorways and stay clear at any height.
     */
    const SPILL = 0.9;
    const tornWall = (axis, fixed, from, to, gaps, opts) => {
      const { key, base, survivors = [], sign } = opts;
      const step = 0.98;
      const t = T + SPILL;
      const off = -sign * (SPILL / 2);
      for (let s = from; s < to - 0.2; s += step) {
        const c = s + step / 2;
        let blocked = false;
        for (const [g0, g1] of gaps) if (c > g0 - 0.55 && c < g1 + 0.55) blocked = true;
        if (blocked) continue;
        const wid = Math.min(step * 1.06, to - s);
        let h = base * rng.range(0.72, 1.18) +
          (fbm3(c * 0.28 + 3.1, 5.7, axis === 'u' ? 1.3 : 8.9, 2) - 0.5) * base * 0.9;
        for (const [sc, half, sh] of survivors) {
          const f = clamp01(1 - Math.abs(c - sc) / half);
          // a squared shoulder, so a survivor is a TOWER of wall and not a dune
          h = Math.max(h, base + (sh - base) * Math.sqrt(f) * rng.range(0.86, 1.0));
        }
        h = Math.max(1.05, h);
        const u = axis === 'u' ? c : fixed + off;
        const v = axis === 'u' ? fixed + off : c;
        const su = axis === 'u' ? wid : t;
        const sv = axis === 'u' ? t : wid;
        const gy = SEC.floor;
        // the wall itself, in courses so the tear has thickness in it
        A.add(key, box, LL(IDENT, X(u), gy + h * 0.5, Z(v), rng.range(-0.02, 0.02), su, h, sv),
          { masks: [rng.range(0.4, 0.9), rng.range(0.3, 0.8), rng.range(0.25, 0.6)] });
        // the exposed core, a little proud and a little short of the face
        A.add('concrete_dark', box,
          LL(IDENT, X(u), gy + h * rng.range(0.45, 0.62), Z(v),
            0, su * 0.62, h * rng.range(0.3, 0.55), sv * 0.72),
          { masks: [0.95, rng.range(0.5, 1.0), 0.4] });
        // the torn top: two or three lumps of the course that came off
        for (let k = 0; k < 3; k++) {
          const s2 = rng.range(0.22, 0.5);
          lump(rng.float() < 0.5 ? 'concrete' : key,
            u + (axis === 'u' ? rng.range(-0.4, 0.4) : rng.range(-0.5, 0.5)),
            gy + h + s2 * rng.range(-0.1, 0.25),
            v + (axis === 'u' ? rng.range(-0.5, 0.5) : rng.range(-0.4, 0.4)), s2, 0.62, 0.95);
        }
        // and a string course surviving on the taller bays, for scale
        if (h > 3.2 && rng.float() < 0.6) {
          A.add('concrete_dark', soft,
            LL(IDENT, X(u), gy + h * rng.range(0.35, 0.7), Z(v), 0, su + 0.12, 0.24, sv + 0.12),
            { masks: [0.95, 0.4, 0.18] });
        }
        A.box('concrete', X(u), gy + h * 0.5, Z(v), su, h, sv);
        // the spill INTO the church off the face of it, resting on the field —
        // drawn only, because the aisle beyond `SPILL` is a lane a bot walks
        for (let k = 0; k < 2; k++) {
          const d = rng.range(SPILL * 0.5, SPILL + 1.5);
          const lu = axis === 'u' ? c + rng.range(-0.5, 0.5) : fixed - sign * d;
          const lv = axis === 'u' ? fixed - sign * d : c + rng.range(-0.5, 0.5);
          const s2 = rng.range(0.24, 0.66);
          lump(rubbleKey(), lu, groundAt(lu, lv) + s2 * 0.22, lv, s2, 0.55, 0.9);
        }
      }
    };

    /**
     * The arch over a doorway, standing on its jambs after the wall either side
     * of it has gone. Drawn only — every voussoir of it is over four metres up —
     * and the one image on this site that says CATHEDRAL rather than BUILDING.
     * Two quadrants on the shell's own Levantine profile, cut short on one side
     * so it reads as a survivor rather than as a doorway somebody built here.
     */
    const brokenArch = (key, u, ySpring, v, wid, rise, alongX, t, cut) => {
      const n = 9;
      const r = wid / 2;
      for (const side of [-1, 1]) {
        const upto = side === cut ? Math.round(n * rng.range(0.45, 0.7)) : n;
        for (let i = 0; i < upto; i++) {
          const a = ((i + 0.5) / n) * (Math.PI / 2);
          const px = side * r * Math.cos(a) * (1 + 0.16 * Math.sin(a));
          const py = rise * Math.sin(a);
          const bw = (r / n) * 1.5;
          A.add(key, box,
            LL(IDENT, X(u + (alongX ? px : 0)), ySpring + py, Z(v + (alongX ? 0 : px)), 0,
              alongX ? bw : t, 0.42, alongX ? t : bw,
              alongX ? 0 : -side * a, alongX ? -side * a : 0),
            { masks: [rng.range(0.5, 0.95), rng.range(0.4, 0.9), 0.3] });
        }
      }
      if (cut === 0) {
        A.add(key, soft, LL(IDENT, X(u), ySpring + rise + 0.16, Z(v), 0,
          alongX ? 0.46 : t + 0.1, 0.5, alongX ? t + 0.1 : 0.46), { masks: [0.85, 0.4, 0.2] });
      }
    };

    /**
     * A DOORWAY THAT SURVIVED: two jambs and the head they carry.
     *
     * The arch has to STAND ON something. Laid on its own over a gap in the wall
     * run it hangs in the sky with three metres of daylight under each springing
     * — photographed off the parvis, the great portal read as a hoop somebody
     * had thrown at the site. So the jambs are laid first, on the same wall line
     * and up to the springing, and the arch springs off their heads.
     *
     * The jambs stand on the shell's own reveal, which is masonry either side of
     * every opening in section 2 and therefore blocked ground in the baked grid;
     * the DOORWAY between them is untouched, because those cells are the only
     * way into the ruin from the street.
     */
    const portal = (axis, fixed, c, wid, springY, rise, key, sign, cut) => {
      const t = T + 0.55;
      for (const s of [-1, 1]) {
        const off = s * (wid / 2 + 0.75);
        const h = springY + rng.range(0.15, 0.6);
        const u = axis === 'u' ? c + off : fixed - sign * 0.1;
        const v = axis === 'u' ? fixed - sign * 0.1 : c + off;
        const su = axis === 'u' ? 1.5 : t;
        const sv = axis === 'u' ? t : 1.5;
        A.add(key, box, LL(IDENT, X(u), SEC.floor + h / 2, Z(v), 0, su, h, sv),
          { masks: [rng.range(0.45, 0.9), rng.range(0.35, 0.85), 0.35] });
        A.box('concrete', X(u), SEC.floor + h / 2, Z(v), su, h, sv);
        // the shafts down the reveal, which is the detail that says DOORWAY
        for (const q of [-1, 1]) {
          const g = tubeY(0.13, h - 0.6, { radial: 7 });
          A.addOnce(key, g, LL(IDENT,
            X(u - (axis === 'u' ? q * 0.55 : 0)), SEC.floor,
            Z(v - (axis === 'u' ? 0 : q * 0.55))), { masks: [0.8, 0.4, 0.5] });
        }
        A.add('concrete_dark', soft, LL(IDENT, X(u), SEC.floor + springY - 0.2, Z(v), 0,
          su + 0.24, 0.34, sv + 0.24), { masks: [0.95, 0.4, 0.18] });
        for (let k = 0; k < 3; k++) {
          const s2 = rng.range(0.2, 0.46);
          lump(rng.float() < 0.5 ? 'concrete' : key,
            u + rng.range(-0.5, 0.5), SEC.floor + h + s2 * rng.range(-0.1, 0.25), v + rng.range(-0.5, 0.5), s2, 0.62, 0.95);
        }
      }
      brokenArch(key, axis === 'u' ? c : fixed, SEC.floor + springY,
        axis === 'u' ? fixed : c, wid + 1.5, rise, axis === 'u', t, cut);
    };

    const WU = HW - T / 2;
    const WV = HD - T / 2;
    /**
     * SOUTH FRONT. This is the elevation the defence's base looks straight up
     * the street at, so it carries the great portal and the two survivors that
     * frame it. The campanile end of it is the tower's.
     */
    tornWall('u', -WV, -HW, HW, [[-3.9, 3.9], [-8.1, -3.1], [3.1, 8.1]], {
      key: 'plaster_cream', base: 2.3, sign: -1,
      survivors: [[9.9, 3.0, 5.4], [-11.0, 2.8, 7.8], [13.2, 1.8, 4.2]],
    });
    portal('u', -WV, 0, 4.0, 6.1, 1.8, 'plaster_cream', -1, 0);
    // the two side portals kept their heads too, lower and half gone
    portal('u', -WV, -5.6, 2.2, 4.4, 1.2, 'plaster_cream', -1, -1);
    portal('u', -WV, 5.6, 2.2, 4.4, 1.2, 'plaster_cream', -1, 1);
    /** THE APSE END, with its door on the axis and two facets still standing. */
    tornWall('u', WV, -HW, HW, [[-3.5, 3.5]], {
      key: 'plaster_sand', base: 2.2, sign: 1,
      survivors: [[-7.6, 2.4, 6.2], [7.0, 2.2, 5.2], [12.4, 2.4, 4.3]],
    });
    portal('u', WV, 0, 2.8, 4.6, 1.4, 'plaster_sand', 1, -1);
    /** BOTH FLANKS. The transept portal is dead centre of each and keeps its
     *  head; the tower owns the south end of the west one. */
    tornWall('v', -WU, TOW.v1 - 0.6, HD, [[-3.6, 3.6]], {
      key: 'plaster_sand', base: 2.4, sign: -1,
      survivors: [[-9.0, 2.6, 6.4], [5.4, 2.0, 5.0], [13.4, 3.0, 7.2]],
    });
    tornWall('v', WU, -HD, HD, [[-3.6, 3.6]], {
      key: 'plaster_cream', base: 2.4, sign: 1,
      survivors: [[-16.4, 3.0, 7.6], [-7.0, 2.2, 5.4], [8.4, 2.6, 6.8], [18.4, 2.6, 4.6]],
    });
    portal('v', -WU, 0, 3.4, 5.0, 1.5, 'plaster_sand', -1, 1);
    portal('v', WU, 0, 3.4, 5.0, 1.5, 'plaster_cream', 1, -1);

    /**
     * THE BUTTRESSES, BROKEN — free height, and the only part of the ruin the
     * player meets before he is inside it. Every one of these stands on the
     * shell's own buttress footing, which is blocked ground in the baked grid
     * whichever state the church is in, so they cost the street nothing.
     */
    for (const side of [-1, 1]) {
      for (const v of [...NAVE_V, ...CHOIR_V, -HD + 0.9, HD - 0.9]) {
        const u = side * (HW + BUTT / 2 - 0.1);
        const h = rng.range(1.6, 4.6);
        A.add('concrete', box, LL(IDENT, X(u), SEC.floor + h / 2, Z(v + 2), rng.range(-0.03, 0.03),
          BUTT, h, 1.3), { masks: [rng.range(0.5, 0.95), rng.range(0.4, 0.9), 0.4] });
        A.box('concrete', X(u), SEC.floor + h / 2, Z(v + 2), BUTT, h, 1.3);
        for (let k = 0; k < 2; k++) {
          const s = rng.range(0.24, 0.55);
          lump('concrete_dark', u + rng.range(-0.5, 0.5), SEC.floor + h + s * 0.2, v + 2 + rng.range(-0.7, 0.7), s, 0.6);
        }
        // the flyer that used to spring off it, now lying against the wall
        if (rng.float() < 0.45) {
          A.add('concrete', box,
            LL(IDENT, X(u - side * 0.9), SEC.floor + rng.range(1.0, 2.2), Z(v + 2 + rng.range(-0.6, 0.6)),
              rng.range(-0.2, 0.2), rng.range(2.4, 3.6), 0.58, 0.68,
              0, side * rng.range(0.5, 1.0)),
            { masks: [0.7, 0.6, 0.4] });
        }
      }
    }

    /* ================================================================== */
    /* 8c. THE CAMPANILE — 29 m of tower, and the only skyline left       */
    /* ================================================================== */
    /**
     * The biggest single mass on the plan and the reason the razed site now has
     * a silhouette at all. Its two OUTER walls are on the west flank and the
     * south front, so they are the same already-blocked lines every other wall
     * ruin stands on; the inner one closes the corner. The shaft is torn
     * diagonally — tallest where the two outer walls meet, falling away from the
     * corner — which is how a tower with a stair in one corner actually breaks.
     *
     * Its plan is filled by the shell's own stair, so the debris cone inside it
     * is free ground too, and the RAMP off the north face is deliberate: three
     * ledges a player mantles, so the biggest heap on the site is a place you
     * can get up rather than a wall with a view painted on it. No bot climbs it
     * — a mantle is not in the height field, the same bargain every stair and
     * every roof on this map makes.
     */
    {
      const tu = (TOW.u0 + TOW.u1) / 2;
      const tv = (TOW.v0 + TOW.v1) / 2;
      const tw = TOW.u1 - TOW.u0;
      const td = TOW.v1 - TOW.v0;
      /**
       * Height falls off from the SW corner, where the two outer walls meet —
       * but NOT smoothly. A smooth fall-off drew a flight of stairs: measured
       * off the parvis, the stump read as a ziggurat, every course a tread. A
       * tower SHEARS: one diagonal plane takes a run of courses at once, the
       * rest is noise, and the shaft ends in a broken edge rather than a slope.
       */
      const towerH = (u, v) => {
        const f = clamp01(1 - Math.hypot((u - TOW.u0) / 9.6, (v - TOW.v0) / 10.6));
        const n = fbm3(u * 0.62 + 12.3, 7.1, v * 0.62 + 3.7, 3) - 0.5;
        const shear = (u - TOW.u0) * 0.62 + (v - TOW.v0) * 0.44;
        return Math.max(1.7,
          Math.min(3.0 + 11.4 * f * f + n * 4.4, 14.6 - shear * 0.95 + n * 3.0));
      };
      // west wall, on the flank line; south wall, on the front line; and the
      // inner return that closes the corner into the aisle
      for (const [au, av, su0, sv0] of [
        [tu - (tw / 2 - T / 2), tv, T + SPILL, td],
        [tu, tv - (td / 2 - T / 2), tw, T + SPILL],
        [tu + (tw / 2 - T / 2), tv + 1.4, T + 0.7, td - 2.8],
      ]) {
        const along = su0 > sv0 ? 'u' : 'v';
        const len = along === 'u' ? su0 : sv0;
        const n = Math.max(3, Math.round(len / 1.05));
        for (let i = 0; i < n; i++) {
          const f = (i + 0.5) / n;
          const cu = along === 'u' ? au - su0 / 2 + f * su0 : au;
          const cv = along === 'u' ? av : av - sv0 / 2 + f * sv0;
          const h = towerH(cu, cv);
          const wid = (len / n) * 1.06;
          A.add('plaster_sand', box,
            LL(IDENT, X(cu), SEC.floor + h / 2, Z(cv), rng.range(-0.02, 0.02),
              along === 'u' ? wid : su0, h, along === 'u' ? sv0 : wid),
            { masks: [rng.range(0.45, 0.9), rng.range(0.35, 0.85), rng.range(0.3, 0.6)] });
          A.add('concrete_dark', box,
            LL(IDENT, X(cu), SEC.floor + h * rng.range(0.4, 0.6), Z(cv), 0,
              (along === 'u' ? wid : su0) * 0.6, h * 0.4, (along === 'u' ? sv0 : wid) * 0.6),
            { masks: [0.95, rng.range(0.5, 1.0), 0.4] });
          A.box('concrete', X(cu), SEC.floor + h / 2, Z(cv), along === 'u' ? wid : su0, h, along === 'u' ? sv0 : wid);
          // string courses survive on the shaft, which is what gives it scale
          for (let y = 5.6; y < h - 0.8; y += 5.6) {
            A.add('concrete_dark', soft,
              LL(IDENT, X(cu), SEC.floor + y, Z(cv), 0,
                (along === 'u' ? wid : su0) + 0.2, 0.3, (along === 'u' ? sv0 : wid) + 0.2),
              { masks: [0.95, 0.45, 0.18] });
          }
          for (let k = 0; k < 3; k++) {
            const s = rng.range(0.24, 0.55);
            lump(rng.float() < 0.5 ? 'plaster_sand' : 'concrete',
              cu + rng.range(-0.5, 0.5), SEC.floor + h + s * rng.range(-0.1, 0.3), cv + rng.range(-0.5, 0.5), s, 0.6, 0.95);
          }
        }
      }
      // the cone of tower inside its own plan, on the stair's blocked ground
      for (let i = 0; i < 11; i++) {
        const u = rng.range(TOW.u0 + 1.6, TOW.u1 - 1.6);
        const v = rng.range(TOW.v0 + 1.6, TOW.v1 - 2.6);
        const h = rng.range(1.8, 4.2);
        const w = rng.range(1.3, 2.1);
        const d = rng.range(1.3, 2.1);
        const ry = rng.range(-0.6, 0.6);
        A.add(rubbleKey(), box, LL(IDENT, X(u), SEC.floor + h / 2, Z(v), ry, w, h, d,
          rng.range(-0.14, 0.14), rng.range(-0.14, 0.14)),
          { masks: [rng.range(0.5, 0.95), rng.range(0.5, 1.0), 0.4] });
        A.box('concrete', X(u), SEC.floor + h / 2, Z(v), w, h, d, ry);
        // BLOCKS JAMMED AGAINST ITS FACES. A 2 m box presents a 2 m flat face
        // and the quality bar forbids one; a collapse is blocks resting on each
        // other, so every mass on this site gets two or three off its own faces.
        for (let k = 0; k < 3; k++) {
          const a = rng.float() * 6.283;
          A.add(rubbleKey(), box,
            LL(IDENT, X(u + Math.cos(a) * w * 0.55), SEC.floor + h * rng.range(0.2, 0.7),
              Z(v + Math.sin(a) * d * 0.55), rng.range(-1.0, 1.0),
              rng.range(0.5, 1.1), rng.range(0.4, 1.2), rng.range(0.5, 1.1),
              rng.range(-0.5, 0.5), rng.range(-0.5, 0.5)),
            { masks: [rng.range(0.5, 1.0), rng.range(0.5, 1.0), 0.45] });
        }
        for (let k = 0; k < 3; k++) {
          const s = rng.range(0.3, 0.7);
          lump(rubbleKey(), u + rng.range(-1.1, 1.1), SEC.floor + h + s * 0.2, v + rng.range(-1.1, 1.1), s, 0.55);
        }
      }
      /**
       * THE RAMP. Three ledges off the north face, each inside the 1.85 m the
       * controller mantles, so the tower heap is a position and not a wall.
       * Broken up hard: three clean risers of one width read as a STAIRCASE
       * somebody built, and nothing on this site was built after it fell.
       */
      for (let i = 0; i < 3; i++) {
        const h = 1.05 + i * 1.0;
        const v = TOW.v1 - 0.4 + i * 1.25;
        const cu = TOW.u0 + 3.2 + rng.range(-0.6, 0.6);
        const wd = rng.range(3.8, 5.2);
        const ry = rng.range(-0.14, 0.14);
        A.add(rubbleKey(), box, LL(IDENT, X(cu), SEC.floor + h / 2, Z(v), ry, wd, h, 1.35,
          rng.range(-0.06, 0.06), 0), { masks: [0.9, rng.range(0.5, 1.0), 0.4] });
        A.box('concrete', X(cu), SEC.floor + h / 2, Z(v), wd, h, 1.35, ry);
        // blocks off its face and its ends, so the tread is masonry and not a step
        for (let k = 0; k < 4; k++) {
          A.add(rubbleKey(), box,
            LL(IDENT, X(cu + rng.range(-wd / 2, wd / 2)), SEC.floor + h * rng.range(0.3, 0.95),
              Z(v + rng.range(-0.9, 0.9)), rng.range(-1.0, 1.0),
              rng.range(0.6, 1.4), rng.range(0.4, 1.0), rng.range(0.6, 1.2),
              rng.range(-0.4, 0.4), rng.range(-0.4, 0.4)),
            { masks: [rng.range(0.5, 1.0), rng.range(0.5, 1.0), 0.45] });
        }
        for (let k = 0; k < 4; k++) {
          const s = rng.range(0.22, 0.55);
          lump(rubbleKey(), cu + rng.range(-wd / 2, wd / 2), SEC.floor + h + s * 0.2, v + rng.range(-0.6, 0.6), s, 0.6);
        }
      }
      // the bell, out of the belfry and lying in the aisle beside it
      const bell = tubeY(0.62, 1.1, { radial: 12, taper: 0.45 });
      A.addOnce('metal_rust', bell,
        LL(IDENT, X(TOW.u1 + 1.9), groundAt(TOW.u1 + 1.9, TOW.v1 + 2.6) + 0.55, Z(TOW.v1 + 2.6),
          0.9, 1, 1, 1, 1.42, 0.2), { masks: [0.95, 0.85, 0.4] });
      A.box('metal', X(TOW.u1 + 1.9), groundAt(TOW.u1 + 1.9, TOW.v1 + 2.6) + 0.3, Z(TOW.v1 + 2.6), 1.3, 0.9, 1.2);
    }

    /* ================================================================== */
    /* 8d. THE ARCADE — piers that survived, and the bays between them    */
    /* ================================================================== */
    /**
     * Every pier square was solid in the shell, so all of this is free height.
     * Roughly a third of them are still SHAFTS — three to seven metres of pier
     * with the capital broken off — and the rest are stumps you fight from;
     * between them the arcade, the triforium and the clerestory came down on
     * their own line. The bays either side of the crossing stay clear of
     * `KEEP_STAND`, and the crossing itself never had an arcade across it.
     */
    for (const side of [-1, 1]) {
      const u = side * ARC;
      const all = [...NAVE_V, ...CHOIR_V];
      for (const v of all) {
        const tall = rng.float() < 0.34;
        const h = tall ? rng.range(3.4, 6.9) : rng.range(1.15, 2.4);
        const w = PW * (tall ? 1.0 : rng.range(1.05, 1.3));
        A.add(tall ? 'plaster_cream' : 'concrete_dark', box,
          LL(IDENT, X(u), SEC.floor + h / 2, Z(v), rng.range(-0.05, 0.05), w, h, w),
          { masks: [rng.range(0.5, 0.95), rng.range(0.4, 0.9), 0.35] });
        A.box('concrete', X(u), SEC.floor + h / 2, Z(v), w, h, w);
        // the base moulding survives on nearly all of them
        A.add('concrete', soft, LL(IDENT, X(u), SEC.floor + 0.28, Z(v), 0, w + 0.42, 0.56, w + 0.42),
          { masks: [0.9, 0.8, 0.55] });
        if (tall) {
          // the springer of the arch it carried, snapped off both ways
          for (const s of [-1, 1]) {
            if (rng.float() < 0.45) continue;
            A.add('plaster_cream', box,
              LL(IDENT, X(u), SEC.floor + h - 0.5, Z(v + s * rng.range(0.9, 1.5)), 0,
                w * 0.8, 0.8, rng.range(1.2, 2.2), 0, s * rng.range(0.35, 0.7)),
              { masks: [0.6, 0.5, 0.4] });
          }
        }
        for (let k = 0; k < 3; k++) {
          const s = rng.range(0.24, 0.6);
          lump(rng.float() < 0.5 ? 'concrete' : 'plaster_white',
            u + rng.range(-1.5, 1.5), groundAt(u, v) + s * 0.25 + (k ? 0 : h * 0.02),
            v + rng.range(-1.8, 1.8), s, 0.55);
        }
        // a drum or two off the shaft, lying where it rolled
        const g = tubeY(rng.range(0.5, 0.75), rng.range(0.9, 1.6), { radial: 9 });
        const lu = u + rng.range(-2.2, 2.2);
        const lv = v + rng.range(-2.4, 2.4);
        A.addOnce('plaster_cream', g,
          LL(IDENT, X(lu), groundAt(lu, lv) + 0.5, Z(lv), rng.float() * 6.28, 1, 1, 1, 1.5, rng.range(-0.2, 0.2)),
          { masks: [0.75, rng.range(0.4, 0.9), 0.5] });
      }
      /**
       * The bays between the piers, fallen on the arcade's own line — and NEVER
       * the whole bay. The arcade is the only thing between the nave and its
       * aisles, and the shell left 4 m of open floor between every pair of
       * piers; close those and the ruin is three corridors that meet once, at
       * the transept. Measured as bots inside D, that alone is worth points, so
       * half the bays are open and the rest keep a gap at each end.
       */
      for (let i = 0; i < all.length - 1; i++) {
        const a = all[i];
        const b = all[i + 1];
        if (b - a > 6.5) continue; // the crossing: there was no arcade across it
        if (rng.float() < 0.5) continue; // …and half the bays are just gone
        const mid = (a + b) / 2;
        const h = rng.range(1.35, 2.85);
        const d = (b - a) * rng.range(0.34, 0.58);
        const ry = rng.range(-0.08, 0.08);
        A.add(rubbleKey(), box, LL(IDENT, X(u), SEC.floor + h / 2, Z(mid), ry, 1.5, h, d,
          rng.range(-0.1, 0.1), 0), { masks: [rng.range(0.5, 0.95), rng.range(0.5, 1.0), 0.4] });
        A.box('concrete', X(u), SEC.floor + h / 2, Z(mid), 1.5, h, d, ry);
        for (let k = 0; k < 4; k++) {
          const s = rng.range(0.2, 0.62);
          lump(rubbleKey(), u + rng.range(-1.0, 1.0), SEC.floor + h + s * 0.2, mid + rng.range(-d / 2, d / 2), s, 0.6);
        }
      }
    }

    /* ================================================================== */
    /* 8e. THE VAULT, ON THE FLOOR — what breaks the 45 m sightline        */
    /* ================================================================== */
    /**
     * Six pieces of nave vault, each a raft of webbing that came down in one
     * piece and is now leaning on whatever it landed on. They are the only
     * charged mass in the middle of the plan, and they buy the thing the old
     * ruin could not do at any price: from the great portal you could see the
     * apse door 45 m away over everything. They stand clear of the lanes and
     * clear of D.
     */
    for (const [u, v, ry] of [
      [-5.4, -18.6, 0.5], [5.8, -12.4, -0.35], [-6.0, -8.6, 0.22],
      [5.2, 9.6, 0.44], [-5.6, 14.8, -0.5], [6.2, 19.4, 0.16],
    ]) {
      const h = rng.range(2.1, 3.3);
      const w = rng.range(3.4, 4.8);
      const d = rng.range(2.6, 4.2);
      A.add('plaster_white', box, LL(IDENT, X(u), SEC.floor + h / 2, Z(v), ry, w, h, d,
        rng.range(-0.16, 0.16), rng.range(-0.16, 0.16)),
        { masks: [rng.range(0.35, 0.7), rng.range(0.5, 1.0), 0.55] });
      A.box('concrete', X(u), SEC.floor + h * 0.5, Z(v), w * 0.94, h, d * 0.94, ry);
      // slabs of the same raft, sheared off it and leaning on its faces: a 4.8 m
      // box otherwise presents a 4.8 m flat face and the quality bar forbids one
      for (let k = 0; k < 3; k++) {
        const a = rng.float() * 6.283;
        A.add(rng.float() < 0.5 ? 'plaster_white' : 'concrete', box,
          LL(IDENT, X(u + Math.cos(a) * w * 0.5), SEC.floor + h * rng.range(0.25, 0.75),
            Z(v + Math.sin(a) * d * 0.5), ry + rng.range(-0.9, 0.9),
            rng.range(1.0, 2.4), rng.range(0.5, 1.4), rng.range(0.9, 1.8),
            rng.range(-0.5, 0.5), rng.range(-0.5, 0.5)),
          { masks: [rng.range(0.4, 0.9), rng.range(0.5, 1.0), 0.5] });
      }
      // the ribs that were on its underside, now sticking out of it
      for (let k = 0; k < 3; k++) {
        A.add('concrete', soft,
          LL(IDENT, X(u + rng.range(-1.4, 1.4)), SEC.floor + h * rng.range(0.55, 1.0), Z(v + rng.range(-1.4, 1.4)),
            ry + rng.range(-0.5, 0.5), rng.range(2.2, 3.8), 0.4, 0.42,
            0, rng.range(-0.5, 0.5)), { masks: [0.85, rng.range(0.4, 0.9), 0.3] });
      }
      for (let k = 0; k < 5; k++) {
        const s = rng.range(0.24, 0.7);
        lump(rubbleKey(), u + rng.range(-2.6, 2.6), groundAt(u, v) + s * 0.25, v + rng.range(-2.4, 2.4), s, 0.55);
      }
    }

    /* ================================================================== */
    /* 8f. THE DOME, ON THE CROSSING — and it is D's cover                */
    /* ================================================================== */
    /**
     * "大聖堂周りを瓦礫の山に" ends at the crossing, because the crossing is a
     * capture point. Everything here is between `KEEP_STAND` and 7.6 m: inside
     * D's circle so `_reprobeZoneNav` learns it, outside the ring `standRing`
     * proved at boot, and heights chosen to sit in the 0.9-2.8 m band
     * `sitecheck` counts — cover you fight FROM, not a wall you hide behind.
     *
     * What is different from the old eight boxes is the READ. The drum was an
     * octagon of piers and the shell above it was thirteen courses of ring, so
     * what lands is CURVED: six arcs of drum, each two or three blocks following
     * its own radius, three rafts of dome shell tipped on edge, and the lantern
     * — 2.6 m square and the last thing standing 26 m up — lying broken on one
     * bearing with its finial still in it. Eight bearings of the ring are still
     * open, so the point is coverable without being a fort.
     */
    {
      const RING = [];
      /**
       * SEVEN ARCS, AND ONLY FOUR OF THEM ARE INSIDE THE CIRCLE.
       *
       * The first version put all of them on a 5.2-7.2 m ring, which is an
       * ANNULUS round the point rather than cover on it: nineteen separate
       * masses between a man on the rim and the middle. Measured over four
       * `_postcheck.mjs` runs a side, that halved how much of the round D had
       * somebody standing in it. Most of the drum landed OUTSIDE the circle
       * anyway — it fell off an 18 m wall — so three of the seven go out on to
       * the 8.8-11.5 m rim, where they are cover on the APPROACH and cost the
       * point nothing.
       */
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * 6.283 + rng.range(-0.2, 0.2);
        RING.push(a);
        const out = i >= 4;
        const rr = out ? rng.range(8.8, 11.5) : rng.range(KEEP_STAND + 0.5, 7.2);
        const h = rng.range(1.3, 2.35);
        const seg = rng.range(2.2, 3.4);
        // an arc of drum: blocks following the ring, not one box across it
        for (let k = out ? -1 : 0; k <= 1; k++) {
          const aa = a + (k * seg) / (2.2 * rr);
          const u = Math.cos(aa) * rr;
          const v = Math.sin(aa) * rr;
          const hh = h * (k === 0 ? 1 : rng.range(0.62, 0.92));
          const ry = -aa + rng.range(-0.12, 0.12);
          A.add(k === 0 ? 'plaster_sand' : 'concrete_dark', box,
            LL(IDENT, X(u), SEC.floor + hh / 2, Z(v), ry, seg / 3.0, hh, rng.range(0.6, 0.95),
              0, rng.range(-0.12, 0.12)),
            { masks: [rng.range(0.5, 0.95), rng.range(0.5, 1.0), 0.4] });
          A.box('concrete', X(u), SEC.floor + hh / 2, Z(v), seg / 3.0, hh, rng.range(0.6, 0.9), ry);
          for (let q = 0; q < 2; q++) {
            const s = rng.range(0.22, 0.55);
            lump(rubbleKey(), u + rng.range(-0.9, 0.9), SEC.floor + hh + s * 0.2, v + rng.range(-0.9, 0.9), s, 0.6);
          }
        }
      }
      /** Three rafts of the shell itself, tipped on edge where they landed —
       *  two on the point, one out past it for the same reason as the arcs. */
      for (let i = 0; i < 3; i++) {
        const a = RING[i * 2] + rng.range(0.4, 0.8);
        const rr = i === 2 ? rng.range(9.2, 11.8) : rng.range(KEEP_STAND + 0.7, 7.4);
        const u = Math.cos(a) * rr;
        const v = Math.sin(a) * rr;
        const h = rng.range(1.9, 2.7);
        const ry = rng.range(-1.2, 1.2);
        A.add('roof_screed', box,
          LL(IDENT, X(u), SEC.floor + h / 2, Z(v), ry, rng.range(2.6, 3.6), h, rng.range(0.6, 0.9),
            0, rng.range(0.25, 0.55)), { masks: [0.6, rng.range(0.5, 1.0), 0.35] });
        A.box('concrete', X(u), SEC.floor + h * 0.5, Z(v), rng.range(2.2, 3.0), h, 0.95, ry);
        // the ribs that ran over the shell, snapped and still on it
        for (let k = 0; k < 2; k++) {
          A.add('concrete', soft,
            LL(IDENT, X(u + rng.range(-1.2, 1.2)), SEC.floor + h * rng.range(0.6, 1.05), Z(v + rng.range(-0.8, 0.8)),
              ry + rng.range(-0.3, 0.3), rng.range(1.8, 3.0), 0.4, 0.5, 0, rng.range(-0.7, 0.7)),
            { masks: [0.9, 0.45, 0.25] });
        }
      }
      /** THE LANTERN, down. 26 m up when the shell was standing. */
      {
        const a = RING[3] + 0.55;
        const rr = 6.6;
        const u = Math.cos(a) * rr;
        const v = Math.sin(a) * rr;
        const ry = a + 0.4;
        A.add('plaster_cream', box, LL(IDENT, X(u), SEC.floor + 1.05, Z(v), ry, 3.2, 2.1, 2.5,
          0.16, 0.1), { masks: [0.5, 0.6, 0.45] });
        A.box('concrete', X(u), SEC.floor + 1.05, Z(v), 3.0, 2.1, 2.4, ry);
        A.add('concrete_dark', soft, LL(IDENT, X(u + Math.cos(ry) * 1.7), SEC.floor + 1.5, Z(v - Math.sin(ry) * 1.7),
          ry, 0.5, 3.5, 3.5, 0.2, 0), { masks: [0.95, 0.35, 0.12] });
        const fin = tubeY(0.12, 2.2, { radial: 6 });
        A.addOnce('metal_rust', fin, LL(IDENT, X(u + 1.1), SEC.floor + 1.9, Z(v + 0.7), ry, 1, 1, 1, 1.2, 0.3),
          { masks: [1, 0.8, 0.1] });
        for (let k = 0; k < 6; k++) {
          const s = rng.range(0.25, 0.65);
          lump(rubbleKey(), u + rng.range(-2.4, 2.4), SEC.floor + rng.range(0.1, 0.5), v + rng.range(-2.4, 2.4), s, 0.55);
        }
      }
      /**
       * THE TOMB CHESTS, SMASHED — and they are the cheapest cover on the map.
       *
       * Section 7 stands six of them on a 5.2-6.5 m ring round the crossing, so
       * those cells are ALREADY blocked in the baked grid whether the church is
       * up or down: a broken chest on the same square costs the point not one
       * walkable cell, and it is what a crossing full of tombs leaves when the
       * dome comes through it. Four of the six, with the lid slid off one end.
       */
      for (const [tu, tv, ry] of [
        [-4.9, -4.9, 0.78], [4.9, -4.9, -0.78], [-4.9, 4.9, -0.78], [0, 6.1, 0],
      ]) {
        const h = rng.range(1.0, 1.3);
        A.add('concrete', box, LL(IDENT, X(tu), SEC.floor + h / 2, Z(tv), ry + rng.range(-0.1, 0.1),
          2.4, h, 1.1, rng.range(-0.06, 0.06), rng.range(-0.06, 0.06)),
          { masks: [rng.range(0.5, 0.9), rng.range(0.55, 1.0), 0.45] });
        A.box('concrete', X(tu), SEC.floor + h / 2, Z(tv), 2.4, h, 1.1, ry);
        // the lid, slid off one end and now leaning against the chest
        const cs = Math.cos(ry);
        const sn = Math.sin(ry);
        A.add('concrete_dark', box,
          LL(IDENT, X(tu + cs * rng.range(0.9, 1.5)), SEC.floor + h * rng.range(0.55, 0.9), Z(tv - sn * rng.range(0.9, 1.5)),
            ry + rng.range(-0.3, 0.3), 2.0, 0.22, 1.25, 0, rng.range(0.4, 0.9)),
          { masks: [0.95, rng.range(0.4, 0.9), 0.2] });
        // and the effigy off the top of it, in pieces
        for (let k = 0; k < 4; k++) {
          const s = rng.range(0.22, 0.55);
          lump(rng.float() < 0.5 ? 'plaster_white' : 'concrete',
            tu + rng.range(-1.6, 1.6), SEC.floor + (k ? rng.range(0.05, 0.3) : h + s * 0.2), tv + rng.range(-1.2, 1.2), s, 0.55);
        }
      }
    }

    /* ================================================================== */
    /* 8g. WHAT BURNED — "大聖堂を焼き尽くす大爆撃"                          */
    /* ================================================================== */
    /**
     * The roof was timber and lead over a stone vault, and it is the one part of
     * this building that leaves something other than masonry. Charred principals
     * and purlins, driven into the heaps and leaning off the wall ruins at the
     * angles a truss falls at, plus the lead itself peeled off in sheets. Drawn
     * only and deliberately: every one of them is either over head height or
     * thinner than the 0.42 m the controller steps across.
     */
    for (let i = 0; i < 17; i++) {
      const u = rng.range(-HW + 1.4, HW - 1.4);
      const v = rng.range(-HD + 1.4, HD - 1.4);
      if (Math.hypot(u, v) < KEEP_STAND) continue;
      const len = rng.range(3.0, 6.4);
      // shallow: a principal that fell is LEANING on the pile, not planted in it
      const tilt = rng.range(0.18, 0.72) * (rng.float() < 0.5 ? 1 : -1);
      const gy = groundAt(u, v);
      A.add('wood_dark', box,
        LL(IDENT, X(u), gy + Math.abs(Math.sin(tilt)) * len * 0.5 + 0.28, Z(v),
          rng.float() * 6.283, len, rng.range(0.22, 0.4), rng.range(0.2, 0.36), 0, tilt),
        { masks: [rng.range(0.6, 1.0), rng.range(0.7, 1.0), 0.2] });
      // …and the rubble heaped round the end of it, so it is resting on something
      for (let k = 0; k < 3; k++) {
        const s = rng.range(0.22, 0.6);
        lump(rubbleKey(), u + rng.range(-1.0, 1.0), gy + s * 0.25, v + rng.range(-1.0, 1.0), s, 0.5);
      }
      if (rng.float() < 0.4) {
        A.add('wood_dark', thin,
          LL(IDENT, X(u + rng.range(-1.2, 1.2)), gy + rng.range(0.3, 1.2), Z(v + rng.range(-1.2, 1.2)),
            rng.float() * 6.283, rng.range(1.6, 3.0), 0.16, 0.22, 0, rng.range(-0.5, 0.5)),
          { masks: [0.9, 0.9, 0.15] });
      }
    }
    // sheets of the lead roof, peeled off and folded where they landed
    for (let i = 0; i < 22; i++) {
      const u = rng.range(-HW + 1, HW - 1);
      const v = rng.range(-HD + 1, HD - 1);
      A.add('metal_dark', thin,
        LL(IDENT, X(u), groundAt(u, v) + rng.range(0.05, 0.45), Z(v), rng.float() * 6.283,
          rng.range(1.2, 3.0), 0.07, rng.range(0.9, 2.2), rng.range(-0.5, 0.5), rng.range(-0.5, 0.5)),
        { masks: [0.85, rng.range(0.6, 1.0), 0.25] });
    }

    /* ================================================================== */
    /* 8h. THE FINE STUFF — and none of it is collidable                  */
    /* ================================================================== */
    /**
     * Shattered slab, fallen render, ash and scorch. It is what makes the field
     * read as a building that came down rather than as terrain, and because it
     * is only drawn it can lie anywhere, including across the capture point.
     */
    for (let i = 0; i < 300; i++) {
      const u = rng.range(-HW + 0.5, HW - 0.5);
      const v = rng.range(-HD + 0.5, HD - 0.5);
      A.add(rng.float() < 0.45 ? 'concrete_dark' : 'concrete', fine,
        LL(IDENT, X(u), groundAt(u, v) + rng.range(0.03, 0.2), Z(v), rng.range(-1.4, 1.4),
          rng.range(0.7, 2.4), rng.range(0.07, 0.2), rng.range(0.9, 2.8),
          rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)),
        { masks: [rng.range(0.7, 1.0), rng.range(0.4, 0.95), 0.3] });
    }
    for (let i = 0; i < 150; i++) {
      const u = rng.range(-HW + 0.6, HW - 0.6);
      const v = rng.range(-HD + 0.6, HD - 0.6);
      lump(rubbleKey(), u, groundAt(u, v) + rng.range(0.02, 0.2), v, rng.range(0.12, 0.6), 0.5, 0.9);
    }
    // ash, dust and scorch, pooled where the mass came down and where it burned
    for (let i = 0; i < 120; i++) {
      const u = rng.range(-HW - 1.5, HW + 1.5);
      const v = rng.range(-HD - 1.5, HD + 1.5);
      const g = patchGeometry(rng, rng.range(0.8, 3.0), { lobes: 10, wobble: 0.55 });
      A.addOnce(rng.float() < 0.45 ? 'dirt' : 'concrete_dark', g,
        LL(IDENT, X(u), groundAt(u, v) + 0.024, Z(v), rng.float() * 6.283, 1, 1, rng.range(0.6, 1.0)),
        { masks: [0.12, rng.range(0.75, 1.0), rng.range(0.5, 0.85)] });
    }
    /**
     * AND THE SPILL OUTSIDE THE WALLS. The field already carries a low apron out
     * to `APRON`; these are the pieces big enough to see from the street, and
     * they are drawn only — the parvis and the road round it are walkable ground
     * in the height field and a solid out here is a kerb every route has to
     * climb. @see the note in `fieldAt`.
     */
    for (let i = 0; i < 190; i++) {
      const edge = (rng.float() * 4) | 0;
      const out = rng.range(0.4, 5.0);
      const u = edge === 0 || edge === 1 ? rng.range(-HW - 2, HW + 2) : edge === 2 ? -HW - out : HW + out;
      const v = edge === 0 ? -HD - out : edge === 1 ? HD + out : rng.range(-HD - 2, HD + 2);
      lump(rubbleKey(), u, groundAt(u, v) + rng.range(0.02, 0.3), v, rng.range(0.14, 0.72), 0.5, 0.92);
    }
  }
  A.endScope();

  /* ====================================================================== */
  /* 9. WHAT THE ENGINE NEEDS BACK                                          */
  /* ====================================================================== */
  /**
   * `?cath=down` — BOOT STRAIGHT INTO THE RUIN, so the gates in `tools/` can be
   * pointed at it.
   *
   * Every one of them boots the level, measures it and exits, so all of them
   * only ever see the church STANDING — and a state that is only ever gated in
   * one of its two forms is exactly how this ruin shipped as a bare plate. It is
   * the cathedral's answer to `?demo=down` and it reads the same way:
   * `node tools/boundcheck.mjs --url=…/?cath=down`.
   *
   * IT CANNOT SIMPLY FORCE THE FIRST CALL. `AiSystem._bakeCover` drives three
   * synchronous swaps through `setRazed` at boot — intact, ruin, restore — and
   * forcing the first would bake `ai.coverIntact` against the rubble. So the
   * latch arms on the RUIN pass (the only call anybody makes with `down = true`
   * before a match exists) and from then on the church may not stand back up.
   *
   * HONEST LIMIT: `match._setCathedralRazed` also drives `ai.setCoverRazed`, and
   * under this flag its boot call says "intact" while the map is the ruin — so
   * the COVER TABLE is stale until the real event fires. Geometry, collision and
   * the nav grid are exactly the ruin, which is what `boundcheck`, `solidcheck`,
   * `navcheck` and `sitecheck` measure; anything that grades cover selection
   * (`fightcheck`) must use the real path — `_razestuck.mjs`, `_postcheck.mjs`.
   */
  let bootDown = false;
  try {
    bootDown = new URLSearchParams(globalThis.location?.search ?? '').get('cath') === 'down';
  } catch {
    bootDown = false;
  }

  /**
   * `probeY` is where a downward ray must START to find this floor: above every
   * ledger slab and every piece of fallen render, well below the gallery deck at
   * 5.6 m and below the head of a 5 m portal, so a threshold cell samples the
   * floor and not the lintel. @see `WorldSystem._interiorVolumes`.
   */
  return {
    id: S.id,
    cx,
    cz,
    hw: HW,
    hd: HD,
    floorY: SEC.floor,
    probeY: SEC.floor + 1.56,

    /** True once the shell has been taken down. Read by `match` for the HUD. */
    razed: false,
    /**
     * Standing height before and after, so a caller can say what changed.
     * `ruinTopY` is the campanile stump — the tallest thing section 8c leaves
     * standing. `_cathruin.mjs` measures the real surface over the whole plan.
     */
    intactTopY: SEC.towerTop,
    ruinTopY: SEC.floor + 14.0,

    /**
     * ──────────────────────────────────────────────────────────────────────
     * THE SWITCH. `match` owns WHEN; this owns WHAT.
     * ──────────────────────────────────────────────────────────────────────
     * Two index-range fills and two mask writes, and it is the whole of the
     * cathedral's destruction. No geometry is built, cut, fractured or solved
     * here — both states were assembled at BOOT and one of them has simply not
     * been drawn since. @see the note on `cath:shell`.
     *
     * IT IS ALSO THE BOOT-TIME HIDE. A scope starts visible and solid because
     * that is what `beginScope` records, and `buildCathedral` returns BEFORE
     * `Assembler.finalize` has made a mesh to hide — so the first thing `match`
     * does is call this with `down = false`, which puts the ruin away for the
     * first time and leaves the church standing. That is also what restores it
     * between matches: "A new match starts with the cathedral standing".
     *
     * Idempotent, and honest about it: it returns true only when the state
     * actually changed, so a second `raze` in the same match reports false and
     * `match` can log "already down" rather than claiming an event twice.
     *
     * `physics` is passed in rather than captured because `Assembler` does not
     * retain it — `setScopeSolid` takes it per call. With no `physics` the
     * VISUAL still switches and only the collision is skipped, which is the
     * right failure: a cathedral that looks destroyed and still stops a bullet
     * is a bug worth seeing, and one that throws mid-match is not.
     */
    setRazed(down, physics) {
      let want = !!down;
      if (want) this._coverBaked = true;
      // @see the `?cath=down` note above — armed only once the ruin cover table
      // has been baked, and from then on the church stays down.
      if (bootDown && this._coverBaked) {
        if (!want && !this._announced) {
          this._announced = true;
          console.info('[world] ?cath=down — the cathedral boots RAZED (cover table stays intact-side)');
        }
        want = true;
      }
      if (this.razed === want && this._primed) return false;
      this._primed = true;
      this.razed = want;
      A.setScopeVisible(shell, !want);
      A.setScopeVisible(ruin, want);
      if (physics) {
        A.setScopeSolid(shell, physics, !want);
        A.setScopeSolid(ruin, physics, want);
      }
      return true;
    },

    /** What `MatchSystem._razeCathedral` calls. */
    raze(elapsed, physics) {
      return this.setRazed(true, physics);
    },

    /** @private has `setRazed` ever run? The boot state is "never". */
    _primed: false,
    /** @private has the RUIN cover table been baked? @see `?cath=down`. */
    _coverBaked: false,
    /** @private has the boot flag said so once? */
    _announced: false,
  };
}

/**
 * True inside (or within `m` of) the cathedral footprint, in LEVEL space.
 *
 * `dressing.isOpen` asks this for exactly the reason it asks `inBuilding`: the
 * scatter is placed at `groundY`, which knows nothing about this building, so
 * without it a market stall gets pitched in the chancel and a rubble mound gets
 * poured through the crossing — which is also a capture point.
 */
export function inCathedral(x, z, m = 0.3) {
  const S = CATHEDRAL;
  return (
    x > S.x - S.w / 2 - m &&
    x < S.x + S.w / 2 + m &&
    z > S.z - S.d / 2 - m &&
    z < S.z + S.d / 2 + m
  );
}

export { CATHEDRAL };
