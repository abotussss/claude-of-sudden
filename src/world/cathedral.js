import { Rng } from '../core/rng.js';
import { BOX, BOX_FINE, BOX_SOFT, BOX_THIN, PANE, IDENT, LL } from './kit.js';
import { fillMasks, patchGeometry, rockGeometry, tubeY } from './util.js';
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
   * fills and two mask writes. Nothing here is generated, fractured or solved
   * when the event fires.
   *
   * WHAT IT HAS TO READ AS. "大聖堂周りを瓦礫の山にして、大聖堂自体を破壊して更地に" —
   * mounds of rubble around the outside, and the building itself flattened. So
   * the mass goes where the mass WAS: a broken heap along each wall line, a
   * bigger one where the campanile stood, a stump where each arcade pier stood,
   * and a field of fallen render and shattered slab across the floor between
   * them. Nothing new stands up; the tallest thing left is a 2.8 m heap where a
   * 29 m tower was.
   *
   * ────────────────────────────────────────────────────────────────────────
   * WHY THE RUIN'S COLLISION SITS ON THE SHELL'S FOOTPRINT, AND NOT ANYWHERE
   * ELSE. THIS IS THE PART THAT WOULD OTHERWISE ORPHAN THE MAP.
   * ────────────────────────────────────────────────────────────────────────
   * `src/ai/nav.js` is a height field baked at boot. Changing collision in the
   * middle of a match does NOT change it, and `MatchSystem._reprobeZoneNav`
   * re-probes only D's own circle when the point opens. So any new solid I put
   * on ground the grid currently calls WALKABLE becomes a wall that A* cannot
   * see, and thirty men walk into it — which is exactly the failure
   * `tools/stuckcheck.mjs` exists to catch.
   *
   * Every collider below therefore stands on ground that was ALREADY blocked by
   * the shell: on the outer wall lines, and on the arcade piers. The grid's
   * answer for those cells is "blocked" before the raze and "blocked" after it,
   * so the raze needs no nav patch outside D at all. Two consequences that are
   * deliberate rather than tolerated:
   *
   *   - THE PORTALS STAY OPEN. Every doorway in the shell — the three south
   *     portals, both transept portals, the apse door — is a gap in the mound
   *     runs below, because those cells ARE walkable in the grid and closing one
   *     would cut the ruin off from the street it opens onto.
   *   - THE CROSSING IS THE ONE PLACE NEW SOLIDS ARE ALLOWED, and it is allowed
   *     for the opposite reason: `_reprobeZoneNav` re-probes D's OWN circle when
   *     the point opens, so mass inside 8 m of the crossing is the only mass on
   *     this site the grid does learn about. `KEEP` (9.4 m — D's `captureRadius`
   *     plus a body's width) is the band the WALL AND PIER runs stay out of;
   *     `KEEP_STAND` (5.0 m) is what the fallen dome stays out of, because
   *     `standRing` proves its eight points on a 4.0 m ring
   *     (`zone.radius * 0.5`) at BOOT and never re-proves them. Between the two
   *     is where the cover goes.
   *
   *     THAT COVER IS NOT DECORATION. `tools/sitecheck.mjs` cannot see D at all
   *     — the zone is authored `locked` and does not exist on the intact map it
   *     measures — so its assertion is re-run by `_dmass.mjs`, and the first
   *     answer was 7.8 m² of 0.9-2.8 m mass inside the circle against a
   *     requirement of 12. A capture point levelled to a bare tiled floor is a
   *     killing field, not an objective.
   *
   * `_postcheck.mjs` re-runs navcheck's own assertion with this scope live, and
   * `tools/sitecheck.mjs` is run against the razed map rather than the intact
   * one, because measuring only the intact map is how this ships broken.
   */
  const ruin = A.beginScope('cath:ruin');
  {
    /** The wall and pier runs stay outside this. @see D's captureRadius. */
    const KEEP = 9.4;
    /** The fallen dome stays outside this — `standRing`'s ring is at 4.0 m. */
    const KEEP_STAND = 5.0;
    /** Grey rubble, ash and broken render — the palette the shell was built in. */
    const RUBBLE = ['concrete_dark', 'concrete', 'plaster_white'];
    const rubbleKey = () => RUBBLE[(rng.float() * RUBBLE.length) | 0];

    /**
     * One heap: a cluster of faceted lumps with a single box under it. The box
     * is the only thing physics and the player ever touch, so it is a little
     * tighter than the silhouette — a heap you can shoot over the top of but
     * not walk through, which is what a collapsed wall should be.
     */
    const mound = (u, v, r, h) => {
      const lumps = 4 + ((r * 1.6) | 0);
      for (let i = 0; i < lumps; i++) {
        const a = rng.float() * 6.283;
        const rr = rng.range(0, r * 0.66);
        const g = rockGeometry(rng, rng.range(r * 0.62, r * 1.15), 1, rng.range(0.38, 0.68));
        fillMasks(g, 0.92, rng.range(0.35, 0.95), 0.3);
        A.addOnce(rubbleKey(), g,
          LL(IDENT, X(u + Math.cos(a) * rr), SEC.floor + rng.range(-0.05, h * 0.42),
            Z(v + Math.sin(a) * rr), rng.float() * 6.283));
      }
      A.box('concrete', X(u), SEC.floor + h * 0.5, Z(v), r * 1.45, h, r * 1.45);
    };

    /**
     * A run of heaps down one wall line, skipping the openings. `gaps` are
     * intervals of the along-axis coordinate that MUST stay clear — every one of
     * them is a portal the grid has walkable cells in.
     */
    const wallRun = (axis, fixed, from, to, gaps, r, h) => {
      const step = r * 1.55;
      for (let s = from + r; s <= to - r; s += step) {
        const c = s + rng.range(-0.3, 0.3);
        let blocked = false;
        for (const [g0, g1] of gaps) if (c > g0 - r && c < g1 + r) blocked = true;
        if (blocked) continue;
        const u = axis === 'u' ? c : fixed;
        const v = axis === 'u' ? fixed : c;
        if (Math.hypot(u, v) < KEEP) continue;
        mound(u, v, rng.range(r * 0.8, r * 1.15), rng.range(h * 0.72, h * 1.12));
      }
    };

    /** The wall lines, exactly where `runWall` put the walls. */
    const WU = HW - T / 2;
    const WV = HD - T / 2;
    // South front: the great portal and the two side portals.
    wallRun('u', -WV, -HW, HW, [[-2.6, 2.6], [-7.1, -4.1], [4.1, 7.1]], 1.7, 2.1);
    // The apse end, with its door on the axis.
    wallRun('u', WV, -HW, HW, [[-2.4, 2.4]], 1.7, 2.1);
    // Both flanks, each with a transept portal dead centre at the crossing.
    for (const side of [-1, 1]) wallRun('v', side * WU, -HD, HD, [[-2.4, 2.4]], 1.7, 2.2);

    /**
     * THE CAMPANILE. Twenty-nine metres of tower does not leave the same heap a
     * nine metre aisle wall does, so its corner gets the biggest mass on the
     * site — and it lands on the tower's own footprint, which was solid.
     */
    for (let i = 0; i < 7; i++) {
      const u = rng.range(TOW.u0 + 1.4, TOW.u1 - 1.4);
      const v = rng.range(TOW.v0 + 1.4, TOW.v1 - 1.4);
      if (Math.hypot(u, v) < KEEP) continue;
      mound(u, v, rng.range(1.9, 2.9), rng.range(2.1, 2.9));
    }

    /**
     * THE ARCADE, AS STUMPS. One per pier, on the pier's own square, so the
     * colonnade still reads as a plan on the ground and the grid's blocked cells
     * stay honest. Waist high — cover to fight from, not a building.
     */
    for (const side of [-1, 1]) {
      for (const v of [...NAVE_V, ...CHOIR_V]) {
        const u = side * ARC;
        if (Math.hypot(u, v) < KEEP) continue;
        const h = rng.range(0.85, 1.45);
        A.add('concrete_dark', box, LL(IDENT, X(u), SEC.floor + h / 2, Z(v),
          rng.range(-0.05, 0.05), PW, h, PW), { masks: [0.95, rng.range(0.4, 0.9), 0.35] });
        A.box('concrete', X(u), SEC.floor + h / 2, Z(v), PW, h, PW);
        // the drum that came off the top of it, lying beside it
        const g = rockGeometry(rng, rng.range(0.9, 1.4), 1, rng.range(0.5, 0.8));
        fillMasks(g, 0.9, rng.range(0.4, 0.9), 0.3);
        A.addOnce('concrete', g, LL(IDENT, X(u + rng.range(-1.6, 1.6)), SEC.floor + 0.35,
          Z(v + rng.range(-1.9, 1.9)), rng.float() * 6.283));
      }
      for (const v of CROSS_V) {
        const u = side * ARC;
        if (Math.hypot(u, v) < KEEP) continue;
        const h = rng.range(1.1, 1.7);
        A.add('concrete_dark', box, LL(IDENT, X(u), SEC.floor + h / 2, Z(v), 0, CPW, h, CPW),
          { masks: [0.95, rng.range(0.4, 0.9), 0.35] });
        A.box('concrete', X(u), SEC.floor + h * 0.5, Z(v), CPW, h, CPW);
      }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * THE DOME CAME DOWN ON THE CROSSING, AND THAT IS WHAT YOU FIGHT BEHIND
     * ────────────────────────────────────────────────────────────────────────
     * Eight pieces of the drum and the lantern on a ring between `KEEP_STAND`
     * and 7.4 m — inside D's circle, outside the standing ring, and the only new
     * solids on this site the nav grid is ever told about (`_reprobeZoneNav`
     * covers exactly this circle and nothing else).
     *
     * It is the one part of the ruin with a gameplay requirement attached: a
     * capture point has to be worth standing on, and `sitecheck`'s bar is 12 m²
     * of 0.9-2.8 m mass inside the circle. Heights are chosen to sit in that
     * band — waist to chest, cover you fight from rather than a wall you hide
     * behind — and eight pieces on a ~40 m circumference leave three quarters of
     * the ring open, so the point is coverable without being a fortress.
     */
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.283 + rng.range(-0.16, 0.16);
      const rr = rng.range(KEEP_STAND + 0.4, 7.4);
      const u = Math.cos(a) * rr;
      const v = Math.sin(a) * rr;
      const h = rng.range(1.25, 2.3);
      const w = rng.range(1.35, 1.85);
      const d = rng.range(1.35, 1.85);
      const ry = rng.range(-0.5, 0.5);
      A.add('concrete_dark', box, LL(IDENT, X(u), SEC.floor + h / 2, Z(v), ry, w, h, d),
        { masks: [0.95, rng.range(0.45, 0.95), 0.4] });
      A.box('concrete', X(u), SEC.floor + h * 0.5, Z(v), w, h, d, ry);
      // the lump of vault that broke off it, drawn only
      const g = rockGeometry(rng, rng.range(0.7, 1.3), 1, rng.range(0.45, 0.75));
      fillMasks(g, 0.9, rng.range(0.4, 0.95), 0.3);
      A.addOnce('plaster_white', g,
        LL(IDENT, X(u + rng.range(-1.3, 1.3)), SEC.floor + 0.3, Z(v + rng.range(-1.3, 1.3)), rng.float() * 6.283));
    }

    /**
     * THE FLOOR OF THE RUIN — fallen render, shattered slab and ash, and NONE of
     * it collidable. It is what makes the bare ground read as a building that
     * was destroyed rather than a car park, and because it is only drawn it can
     * lie anywhere, including across the capture point.
     */
    for (let i = 0; i < 260; i++) {
      const u = rng.range(-HW + 0.6, HW - 0.6);
      const v = rng.range(-HD + 0.6, HD - 0.6);
      const g = rockGeometry(rng, rng.range(0.12, 0.62), 1, rng.range(0.3, 0.6));
      fillMasks(g, 0.9, rng.range(0.3, 0.95), 0.25);
      A.addOnce(rubbleKey(), g,
        LL(IDENT, X(u), SEC.floor + rng.range(0.01, 0.16), Z(v), rng.float() * 6.283));
    }
    // broken slabs, lying flat and half buried
    for (let i = 0; i < 70; i++) {
      A.add(rng.float() < 0.45 ? 'concrete_dark' : 'concrete', fine,
        LL(IDENT, X(rng.range(-HW + 1, HW - 1)), SEC.floor + rng.range(0.04, 0.2),
          Z(rng.range(-HD + 1, HD - 1)), rng.range(-1.2, 1.2),
          rng.range(0.7, 2.2), rng.range(0.08, 0.22), rng.range(0.9, 2.6)),
        { masks: [rng.range(0.7, 1.0), rng.range(0.4, 0.95), 0.3] });
    }
    // ash and dust, pooled where the mass came down
    for (let i = 0; i < 90; i++) {
      const g = patchGeometry(rng, rng.range(0.7, 2.6), { lobes: 10, wobble: 0.55 });
      A.addOnce(rng.float() < 0.5 ? 'dirt' : 'concrete_dark', g,
        LL(IDENT, X(rng.range(-HW + 0.5, HW - 0.5)), SEC.floor + 0.022,
          Z(rng.range(-HD + 0.5, HD - 0.5)), rng.float() * 6.283, 1, 1, rng.range(0.6, 1.0)),
        { masks: [0.15, rng.range(0.7, 1.0), 0.55] });
    }
    /**
     * AND THE SPILL OUTSIDE THE WALLS — "大聖堂周りを瓦礫の山に". A wall that falls
     * outward lands on the parvis, so the heaps continue a little way into the
     * street on all four sides. These are drawn only: the parvis and the street
     * around it are walkable ground in the height field and a solid here WOULD
     * be the invisible wall the note above is about.
     */
    for (let i = 0; i < 150; i++) {
      const edge = (rng.float() * 4) | 0;
      const out = rng.range(0.4, 4.2);
      const u = edge === 0 ? rng.range(-HW, HW) : edge === 1 ? rng.range(-HW, HW) : (edge === 2 ? -HW - out : HW + out);
      const v = edge === 0 ? -HD - out : edge === 1 ? HD + out : rng.range(-HD, HD);
      const g = rockGeometry(rng, rng.range(0.14, 0.68), 1, rng.range(0.32, 0.62));
      fillMasks(g, 0.92, rng.range(0.3, 0.95), 0.25);
      A.addOnce(rubbleKey(), g, LL(IDENT, X(u), rng.range(0.02, 0.24), Z(v), rng.float() * 6.283));
    }
  }
  A.endScope();

  /* ====================================================================== */
  /* 9. WHAT THE ENGINE NEEDS BACK                                          */
  /* ====================================================================== */
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
    /** Standing height before and after, so a caller can say what changed. */
    intactTopY: SEC.towerTop,
    ruinTopY: SEC.floor + 2.9,

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
      const want = !!down;
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
