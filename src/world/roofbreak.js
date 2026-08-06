import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { BOX, BOX_SOFT, BOX_THIN, IDENT, LL, parapet, rubbleMound } from './kit.js';
import { rockGeometry } from './util.js';
import { PALETTE } from './palette.js';
import { isDemolishable } from './demolition.js';
import { featureSpots } from './features.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * WORLD — THE ROOF, COMING IN. BAKED AT BOOT.
 * ════════════════════════════════════════════════════════════════════════════
 * 「あとはもっと街を空爆で破壊して 屋上破壊 壁破壊」
 *
 * WHY IT IS A THIRD MODULE AND NOT A FLAG ON ONE OF THE OTHER TWO. This map
 * already has both of the destructions the request's second half asks for, and
 * neither of them is this one:
 *
 *   `demolition.js`  SIX DISTRICT BLOCKS stop existing. A whole building goes
 *                    from three storeys to a walkable slope. It is the biggest
 *                    thing on the map and it may not touch a cache house: level
 *                    one and you have deleted the reason to walk in.
 *   `breach.js`      ONE GROUND-STOREY ELEVATION comes off, with the storeys
 *                    above it still standing on the jambs it leaves. It is a
 *                    new way IN, on a bearing the house used to deny.
 *
 * A ROOF IS A DIFFERENT EVENT FROM A WALL, and the difference is the whole
 * reason to write it. A wall gives you a way in at street level, which is where
 * every man already is. A roof opens the building FROM ABOVE — off the four
 * rooftop gangways `world.links` already strings between the roofs — and it
 * takes away the one surface on this map that is pure advantage: a man on a
 * roof sees three streets and is shot at from none of them. Bombing the roof
 * out from under him is the only answer the ground has ever had to that.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT COMES IN, AND WHAT DELIBERATELY DOES NOT
 * ────────────────────────────────────────────────────────────────────────────
 * The deck's MIDDLE comes in. A RIM stays, and the rim is not a compromise —
 * it is what the structure actually is. A flat slab is carried by the walls it
 * spans between, so it fails in the SPAN and hangs on at the bearing; and the
 * rim is also what keeps this feature from being the floating-rubble bug this
 * project has shipped three times. Everything on a roof is standing on the
 * deck: the parapet, the stair hut, the water tanks, the dishes, the aerials,
 * and — placed after the claims are disarmed and therefore NOT ours to
 * delete — `world.features`' rooftop vantage cache. Take the whole deck and
 * every one of them is in the sky.
 *
 * So:
 *   - the DECK, the PARAPET, the STAIR HUT and every piece of roof clutter go
 *     into one scope, by SPATIAL CLAIM (`A.claim` over the roof plan from just
 *     under the deck up), exactly as a demolished block claims its dishes.
 *   - the damaged form REBUILDS the rim — drawn AND solid — so the deck's edge
 *     is still there to stand on and still carrying the parapet stub.
 *   - the HOLE is sized to leave `RIM` all round, is UNIONED with the stairwell
 *     void (a frame round a hole cannot re-floor the void the stair climbs
 *     through) and is then PULLED BACK off any rooftop feature spot, because
 *     that cache is built after `disarmClaims` and would be left hanging.
 *   - what fell lands on the TOP FLOOR as a walkable pile, so the hole is a way
 *     down rather than a pit. It is `rubbleMound`, whose proxy is a stepped
 *     cone with no face over 0.30 m — @see the note there, and the ITEM the
 *     player raised about jumping over pebbles.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND WHAT IT DOES TO THE HEIGHT FIELD, WHICH IS: ALMOST NOTHING, ON PURPOSE
 * ────────────────────────────────────────────────────────────────────────────
 * `src/ai/nav.js` is 2.5D — one floor per cell — and `NavGrid._carveInteriors`
 * OVERWRITES an enterable footprint with its GROUND STOREY, because a ray
 * dropped from above a building can only ever find its roof. Every building on
 * this list is enterable. So inside these footprints the bot grid already
 * describes the ground floor and nothing else: the roof was never in it, the
 * top floor was never in it, and a roof that comes in cannot change a cell that
 * was already carved. UPPER FLOORS AND ROOFS ARE A PLAYER FEATURE, and so is
 * this — the same sentence `world.links`' decks are `LAYER.CLIP` for.
 *
 * `navRect` is published anyway, for the same reason a breach publishes one: it
 * is the AABB the collision changed over, and whether anybody re-probes it is
 * the caller's decision, not this file's. `setVisual` and `setCollision` stay
 * separate for the same reason too — a patch is baked at boot with the damaged
 * form temporarily solid and the roof visibly intact the whole time.
 */

/* -------------------------------------------------------------------------- */

/** Deck left standing all round the hole. A slab hangs on at its bearing. */
const RIM = 1.55;
/** The smallest hole worth calling a hole. Under this the building is skipped. */
const HOLE_MIN = 2.6;
/** What is left of the parapet where the blast went through it. */
const PARAPET_STUB = 0.30;
/**
 * What `strength` takes a roof off, in `match`'s own units where 1 is a tank
 * main-gun round. A roof is a 0.26 m slab over your head and a tank cannot
 * elevate onto it: this is deliberately over `breach.js`'s BREACH_STRENGTH so
 * that the walls a shell opens and the roofs only air opens stay two different
 * events. `src/match` derives its strength from the blast radius, so the air
 * weapons clear it and the direct-fire ones do not.
 */
const ROOF_STRENGTH = 1.6;
/**
 * How far under the deck a hit still counts as a hit on the ROOF. Without it a
 * shell into the ground-floor wall is "within reach" of the roof record, which
 * is 9.5 m straight up, and the house would lose its roof to a rifle grenade in
 * the doorway. @see `world.damageAt`, which reads `minY` off the record.
 */
const MIN_Y_DROP = 2.2;

/** The roof height `buildBuilding` will arrive at, from the spec alone. */
export function roofYOf(spec) {
  const floors = spec.floors ?? 3;
  return (spec.groundH ?? 3.45) + (floors - 1) * (spec.upperH ?? 3.05);
}

/* ========================================================================== */
/* PLAN — before the first wall goes up                                       */
/* ========================================================================== */

/**
 * One record per building whose roof can come in.
 *
 * A DEMOLISHABLE BUILDING IS SKIPPED, and it is the same line `planBreaches`
 * carries for the same reason: `Assembler._scope` is a single slot and a
 * demolishable building is bracketed by ONE shell scope for its whole self, so
 * a claim inside it never fires (`_claimFor` is only consulted when no lexical
 * scope is open) and the roof would quietly stay welded to the shell. The two
 * sets are disjoint on this map by construction — `DEMOLITION` is six district
 * blocks and none of them is enterable.
 *
 * A ONE-STOREY SHED IS SKIPPED TOO. Its roof is the ceiling of the only room it
 * has, its deck is 3.2 m over the GROUND storey, and the ground storey is the
 * one the bot height field is carved from — so that roof is the only one on the
 * list whose collapse would drop a pile of masonry into a cell A* believes in.
 */
export function planRoofBreaks(buildings) {
  const out = [];
  for (const spec of buildings) {
    if (!spec.enterable) continue;
    if ((spec.floors ?? 3) < 2) continue;
    if (isDemolishable(spec.id)) {
      console.warn(`[world] roof ${spec.id}: carries a full ruin — skipped`);
      continue;
    }
    out.push({
      id: `${spec.id}-ROOF`,
      building: spec.id,
      name: `${spec.id} ROOF`,
      spec,
      roofY: roofYOf(spec),
      /** The two scopes: the intact roof (claimed) and the damaged one (lexical). */
      roof: null,
      ruin: null,
      info: null,
      hole: null,
      down: false,
      strength: ROOF_STRENGTH,
      minY: 0,
      /** Filled by `publishRoofBreaks`, once the level transform exists. */
      position: null,
      normal: null,
      along: null,
      halfLen: 0,
      reach: 0,
      top: 0,
      mass: null,
      surfaces: ['concrete', 'plaster'],
      tint: 0xbfae92,
      navRect: null,
      level: null,
    });
  }
  return out;
}

/**
 * The LEVEL-space box the claim covers: the whole footprint with a hand's
 * breadth round it, from just under the deck up.
 *
 * IT HAS TO BE ANSWERABLE FROM THE SPEC ALONE, because the claim is armed
 * BEFORE `buildBuilding` runs — that is the only moment at which the deck, the
 * parapet and the stair hut have not been written yet. `roofYOf` is the same
 * arithmetic the floor loop does.
 *
 * The floor is 0.20 m under the deck's own centre (`interiorSlab` draws the
 * roof at `y - thick/2`, thick 0.26) and NOT lower: the drainpipe run clipped
 * to the facade tops out at `roofY + 0.4` but is anchored at the middle of its
 * run, metres below, and a claim that reached it would take a pipe off a wall
 * that is still standing.
 */
export function claimRect(rec) {
  const spec = rec.spec;
  return {
    x0: spec.x - spec.w / 2 - 0.9,
    x1: spec.x + spec.w / 2 + 0.9,
    z0: spec.z - spec.d / 2 - 0.9,
    z1: spec.z + spec.d / 2 + 0.9,
    y0: rec.roofY - 0.20,
  };
}

/* ========================================================================== */
/* THE DAMAGED FORM                                                           */
/* ========================================================================== */

/**
 * WHERE THE HOLE IS, and every one of the four steps is a bug that would
 * otherwise be a floating mass or a hole you cannot use.
 *
 *   1. inset `RIM` from the deck's own plate — the bearing stays.
 *   2. UNION with the stairwell void. The rim is authored as a picture frame
 *      round the hole, and a frame drawn round a hole that does not contain the
 *      stair void would re-floor the void: the stair would arrive at a slab.
 *   3. PULL BACK off every rooftop feature spot by its own keep-out. The
 *      vantage cache is built after `A.disarmClaims()`, so it is not in the
 *      roof scope, so it survives the roof — and a cache in mid-air is the
 *      exact bug `_floatcheck` exists for.
 *   4. and if what is left is under `HOLE_MIN` on either axis there is no hole,
 *      and the record says so rather than shipping a crack.
 */
function planHole(rec, info) {
  const spec = rec.spec;
  const t = spec.t ?? 0.34;
  const ts = info.roofSpec ?? spec;
  const iw = ts.w - t * 2;
  const idp = ts.d - t * 2;
  const dx0 = ts.x - iw / 2;
  const dx1 = ts.x + iw / 2;
  const dz0 = ts.z - idp / 2;
  const dz1 = ts.z + idp / 2;

  let h = { x0: dx0 + RIM, x1: dx1 - RIM, z0: dz0 + RIM, z1: dz1 - RIM };
  const v = info.roofHole;
  if (v) {
    h = {
      x0: Math.min(h.x0, v.x0), x1: Math.max(h.x1, v.x1),
      z0: Math.min(h.z0, v.z0), z1: Math.max(h.z1, v.z1),
    };
  }
  // Back inside the deck, whatever the void did to it.
  h.x0 = Math.max(dx0, h.x0); h.x1 = Math.min(dx1, h.x1);
  h.z0 = Math.max(dz0, h.z0); h.z1 = Math.min(dz1, h.z1);

  for (const s of featureSpots(spec, info, t)) {
    if (s.floor !== 'roof') continue;
    const pad = 1.3;
    // Shrink on whichever axis costs the least hole.
    const cuts = [
      { k: 'x0', v: s.x + pad, cost: s.x + pad - h.x0 },
      { k: 'x1', v: s.x - pad, cost: h.x1 - (s.x - pad) },
      { k: 'z0', v: s.z + pad, cost: s.z + pad - h.z0 },
      { k: 'z1', v: s.z - pad, cost: h.z1 - (s.z - pad) },
    ].filter((c) => c.cost > 0);
    if (!cuts.length) continue;               // already clear of it
    cuts.sort((a, b) => a.cost - b.cost);
    const c = cuts[0];
    h[c.k] = c.v;
  }

  if (h.x1 - h.x0 < HOLE_MIN || h.z1 - h.z0 < HOLE_MIN) return null;
  return { ...h, deck: { x0: dx0, x1: dx1, z0: dz0, z1: dz1 } };
}

/**
 * Build every record's damaged roof. Runs after the shells, the dressing and
 * the ruins, in the same place in the order and for the same three reasons
 * `buildBreaches` runs there: the triangles land in the merged batches, the
 * dressing has already been placed so nothing here can move it, and each record
 * draws from its OWN fixed-seed stream so a re-roll cannot walk the level.
 */
export function buildRoofBreaks(A, records, infos) {
  const byId = new Map(infos.map((i) => [i.spec.id, i]));
  for (const rec of records) {
    const info = byId.get(rec.building);
    if (!info) {
      console.error(`[world] roof ${rec.id}: no build info — SKIPPED`);
      continue;
    }
    rec.info = info;
    rec.roofY = info.roofY;
    const hole = planHole(rec, info);
    if (!hole) {
      console.warn(`[world] roof ${rec.id}: no room for a hole clear of the roof cache — skipped`);
      continue;
    }
    rec.hole = hole;
    const rng = new Rng(0x9e37 ^ hashId(rec.id));
    rec.ruin = A.beginScope(`roofruin:${rec.id}`);
    buildBrokenRoof(A, rng, rec, info, hole);
    A.endScope();
  }
  return records.filter((r) => r.ruin);
}

/** A stable per-record stream seed. Same trick demolition.js and breach.js use. */
function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildBrokenRoof(A, rng, rec, info, hole) {
  const spec = rec.spec;
  const t = spec.t ?? 0.34;
  const ts = info.roofSpec ?? spec;
  const y = info.roofY;
  const THICK = 0.26;
  const deck = hole.deck;
  const key = 'roof_screed';
  const box = BOX(A);
  const soft = BOX_SOFT(A);

  /* ---------------------------------------------------------------- the rim */
  /**
   * The deck, minus the hole, as the same picture frame `interiorSlab` cuts
   * round a stairwell void — DRAWN AND SOLID, because it is the surface a man
   * on the roof is still standing on and the thing the parapet stub is bolted
   * to. Four parts; a part the hole has eaten is dropped by its own width test.
   */
  const parts = [
    [deck.x0, deck.z0, deck.x1, hole.z0],
    [deck.x0, hole.z1, deck.x1, deck.z1],
    [deck.x0, hole.z0, hole.x0, hole.z1],
    [hole.x1, hole.z0, deck.x1, hole.z1],
  ];
  for (const [ax, az, bx, bz] of parts) {
    const w = bx - ax;
    const d = bz - az;
    if (w < 0.05 || d < 0.05) continue;
    A.add(key, box, LL(IDENT, (ax + bx) / 2, y - THICK / 2, (az + bz) / 2, 0, w, THICK, d), {
      masks: [0.72, 0.45, 0.3],
    });
    A.box('concrete', (ax + bx) / 2, y - THICK / 2, (az + bz) / 2, w, THICK, d);
  }

  /* ------------------------------------------------------- the parapet stub */
  /**
   * What the blast left of the edge wall. It stands on the WALLS, not on the
   * deck's middle, so it is supported however big the hole is — and it is
   * rebuilt here rather than left out of the scope because a full-height
   * parapet round a roof with its middle missing reads as a swimming pool.
   */
  if (spec.parapet !== false) {
    parapet(A, spec.parapetKey ?? spec.wallKey ?? 'plaster_cream',
      ts.x, ts.z, ts.w + 0.1, ts.d + 0.1, y, rng, { h: PARAPET_STUB, t: 0.22 });
  }

  /* --------------------------------------------------------- the torn edges */
  /**
   * Teeth along the four sides of the hole, leaning out over it off the rim
   * they are still part of, with the reinforcement out of the break. NO
   * COLLISION, for the reason every torn edge in this project has none: each
   * one lies on the rim it grew out of and stands at most a step proud of it,
   * and a proxy on a slab tooth hanging over a hole is the 「浮いてる瓦礫」 the
   * float sweep was written for.
   */
  const edges = [
    { ax: 1, az: 0, u0: hole.x0, u1: hole.x1, v: hole.z0, nx: 0, nz: 1 },
    { ax: 1, az: 0, u0: hole.x0, u1: hole.x1, v: hole.z1, nx: 0, nz: -1 },
    { ax: 0, az: 1, u0: hole.z0, u1: hole.z1, v: hole.x0, nx: 1, nz: 0 },
    { ax: 0, az: 1, u0: hole.z0, u1: hole.z1, v: hole.x1, nx: -1, nz: 0 },
  ];
  for (const e of edges) {
    const run = e.u1 - e.u0;
    if (run < 0.4) continue;
    const n = Math.max(2, Math.round(run / 0.85));
    for (let i = 0; i < n; i++) {
      const u = e.u0 + ((i + 0.5) / n) * run;
      const out = rng.range(0.12, 0.52);
      const cx = (e.ax ? u : e.v) + e.nx * out * 0.5;
      const cz = (e.az ? u : e.v) + e.nz * out * 0.5;
      const tilt = rng.range(0.06, 0.34);
      A.add(
        key,
        soft,
        LL(IDENT, cx, y - THICK / 2 - out * 0.22, cz, 0,
          e.ax ? run / n * rng.range(0.55, 0.95) : out,
          THICK * rng.range(0.7, 1.05),
          e.az ? run / n * rng.range(0.55, 0.95) : out,
          e.az ? e.nx * tilt : 0,
          e.ax ? -e.nz * tilt : 0),
        { masks: [rng.range(0.6, 0.95), rng.range(0.5, 0.9), rng.range(0.4, 0.8)] }
      );
      // reinforcement out of the break
      for (let b = 0; b < rng.int(0, 2); b++) {
        const bl = rng.range(0.35, 0.95);
        A.add(
          'metal_rust',
          BOX_THIN(A),
          LL(IDENT, cx + e.nx * rng.range(0.1, 0.5), y - THICK * 0.5 + rng.range(-0.05, 0.12),
            cz + e.nz * rng.range(0.1, 0.5), rng.float() * 6.28,
            0.022, bl, 0.022, rng.range(-1.4, 1.4), rng.range(-1.4, 1.4)),
          { masks: [0.9, 0.75, 0.1] }
        );
      }
    }
  }

  /* ------------------------------------------------- what fell, on the floor */
  /**
   * THE DECK, ON THE TOP FLOOR. This is what makes the hole a WAY DOWN instead
   * of a pit: a man who drops through it lands on a pile he can walk off. It is
   * `rubbleMound`, so the collision is the stepped cone that module authors —
   * no face over 0.30 m — and it stands on the top floor's own slab, which is
   * not in either scope and does not move.
   */
  const fy = info.floorY?.[(spec.floors ?? 3) - 1] ?? y - (spec.upperH ?? 3.05);
  const hx = (hole.x0 + hole.x1) / 2;
  const hz = (hole.z0 + hole.z1) / 2;
  const span = Math.min(hole.x1 - hole.x0, hole.z1 - hole.z0);
  rubbleMound(A, rng, hx, fy, hz, Math.max(1.0, span * 0.42), Math.round(span * 7), {
    key: 'concrete',
  });
  /**
   * …and two runs of the deck itself, face down on top of it. A graded pile of
   * lumps reads as gravel from three metres; a slab with its screed still on it
   * says a ROOF fell. Drawn only: each lies ON the pile and stands at most a
   * step proud of it, which is `_fallen` in demolition.js's rule exactly.
   */
  for (let i = 0; i < 2; i++) {
    const len = rng.range(1.6, Math.max(1.8, span * 0.8));
    const wide = rng.range(0.9, 1.7);
    const px = hx + rng.range(-span * 0.3, span * 0.3);
    const pz = hz + rng.range(-span * 0.3, span * 0.3);
    const ry = rng.float() * 6.28;
    const py = fy + rng.range(0.16, 0.34);
    A.add(key, soft, LL(IDENT, px, py, pz, ry, len, THICK, wide,
      rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)), {
      masks: [rng.range(0.6, 0.95), rng.range(0.55, 0.95), rng.range(0.45, 0.85)],
    });
    for (let b = 0; b < rng.int(2, 4); b++) {
      A.add(
        'metal_rust',
        BOX_THIN(A),
        LL(IDENT, px + rng.range(-len * 0.5, len * 0.5), py + rng.range(0.06, 0.28),
          pz + rng.range(-wide * 0.5, wide * 0.5), rng.float() * 6.28,
          0.024, rng.range(0.4, 1.2), 0.024, rng.range(-1.3, 1.3), rng.range(-1.3, 1.3)),
        { masks: [0.9, 0.75, 0.1] }
      );
    }
  }
  /** Dust and scorch on the rim round the lip, flat and a centimetre proud. */
  for (let i = 0; i < 3; i++) {
    A.add(
      'road_dust',
      BOX_THIN(A),
      LL(IDENT, hx + rng.range(-span * 0.7, span * 0.7), y + 0.015,
        hz + rng.range(-span * 0.7, span * 0.7), rng.float() * 6.28,
        rng.range(1.4, 3.0), 0.02, rng.range(1.4, 3.0)),
      { masks: [0.1, 1.0, 0.5] }
    );
  }
  /** …and a few lumps that bounced out onto the rim itself. */
  for (let i = 0; i < rng.int(3, 7); i++) {
    const s = rng.range(0.1, 0.3);
    A.addOnce(
      rng.float() < 0.5 ? 'concrete' : 'brick_fine',
      rockGeometry(rng, s, 0, 0.72),
      LL(IDENT,
        hx + rng.range(-(span * 0.5 + RIM), span * 0.5 + RIM), y + s * 0.28,
        hz + rng.range(-(span * 0.5 + RIM), span * 0.5 + RIM),
        rng.float() * 6.28, 1, 1, 1, rng.range(-0.5, 0.5), rng.range(-0.5, 0.5)),
      { masks: [0.35, 0.8, 0.5] }
    );
  }
}

/* ========================================================================== */
/* WHAT COMES OFF IT WHILE IT GOES                                            */
/* ========================================================================== */

/**
 * THE MASS, PUBLISHED RATHER THAN THROWN — field for field the shape
 * `world.demolitions[].mass` and `world.breaches[].mass` publish, so `match`,
 * which may not import `world` and already knows how to cut, throw and settle a
 * district block's walls, needs no third code path for a deck.
 *
 * It is ONE box: the slab that is going, in the building's own frame, with the
 * stairwell void cut in it as a hole. `cut` is sized for ~1.6 m chunks, which is
 * a piece of roof a man could shelter under rather than the 1.3 m a wall breaks
 * into — a deck fails in bays, along its span.
 */
function _mass(rec, info) {
  const spec = rec.spec;
  const hole = rec.hole;
  const y = info.roofY;
  const n = (m, per = 1.6) => Math.max(1, Math.round(m / per));
  const w = hole.x1 - hole.x0;
  const d = hole.z1 - hole.z0;
  const cx = (hole.x0 + hole.x1) / 2 - spec.x;
  const cz = (hole.z0 + hole.z1) / 2 - spec.z;
  const holes = [];
  const v = info.roofHole;
  if (v) {
    holes.push({
      a: [(v.x0 + v.x1) / 2 - spec.x, y - 0.13, (v.z0 + v.z1) / 2 - spec.z],
      r: [(v.x1 - v.x0) / 2 + 0.2, 0.5, (v.z1 - v.z0) / 2 + 0.2],
    });
  }
  return [{
    id: 'deck',
    mat: 0,
    size: [w, 0.26, d],
    at: [cx, y - 0.13, cz],
    cut: [n(w), 1, n(d)],
    holes,
  }];
}

/* ========================================================================== */
/* PUBLISH                                                                    */
/* ========================================================================== */

/**
 * Turn the records into the list `world` publishes. Called after `A.finalize`.
 *
 * THE FIRST HIDE IS THE EXPENSIVE ONE AND IT HAPPENS HERE, for the reason
 * `publishBreaches` and `publishDemolitions` both give: `setScopeVisible` copies
 * the indices it overwrites lazily, and doing that on the frame a bomb lands is
 * a few hundred kilobytes of allocation in a feature whose whole design is that
 * nothing is solved on that frame.
 */
export function publishRoofBreaks(A, records, physics) {
  const out = [];
  for (const rec of records) {
    if (!rec.roof || !rec.ruin || !rec.info || !rec.hole) continue;
    if (!rec.roof.tris) {
      console.error(`[world] roof ${rec.id}: the claim caught nothing — SKIPPED`);
      continue;
    }
    const spec = rec.spec;
    const info = rec.info;
    const hole = rec.hole;

    rec.mass = _mass(rec, info);
    rec.tint = PALETTE[spec.parapetKey ?? spec.wallKey ?? 'plaster_cream']?.opts?.tint ?? 0xbfae92;
    rec.level = { x: (hole.x0 + hole.x1) / 2, y: info.roofY, z: (hole.z0 + hole.z1) / 2 };
    rec.position = A.toWorld(rec.level.x, rec.level.y, rec.level.z, new THREE.Vector3());
    /** Straight up: what a roof presents to the sky, and the way its mass goes. */
    rec.normal = new THREE.Vector3(0, 1, 0);
    rec.along = A.toWorld(1, 0, 0, new THREE.Vector3()).sub(A.toWorld(0, 0, 0, new THREE.Vector3())).normalize();
    rec.halfLen = (hole.x1 - hole.x0) / 2;
    rec.top = info.roofY;
    /**
     * How near a hit has to land: half the SHORT axis of the hole plus a bay,
     * measured off the centre line `along` already clamps along the long one.
     * A bomb through the parapet takes the deck with it.
     */
    rec.reach = (hole.z1 - hole.z0) / 2 + 2.4;
    /** …and it has to have come from above. @see MIN_Y_DROP. */
    rec.minY = rec.position.y - MIN_Y_DROP;

    {
      const r = Math.max(spec.w, spec.d) / 2 + 1.5;
      rec.navRect = {
        x0: rec.position.x - r, x1: rec.position.x + r,
        z0: rec.position.z - r, z1: rec.position.z + r,
      };
    }

    A.setScopeVisible(rec.roof, false);
    A.setScopeVisible(rec.roof, true);
    A.setScopeVisible(rec.ruin, false);
    A.setScopeSolid(rec.ruin, physics, false);

    rec.setVisual = (down) => {
      A.setScopeVisible(rec.roof, !down);
      A.setScopeVisible(rec.ruin, down);
    };
    rec.setCollision = (down) => {
      A.setScopeSolid(rec.roof, physics, !down);
      A.setScopeSolid(rec.ruin, physics, down);
    };
    rec.setDown = (down) => {
      rec.down = !!down;
      rec.setVisual(!!down);
      rec.setCollision(!!down);
    };
    out.push(rec);
  }
  console.info(
    `[world] roof: ${out.length} buildings can lose their deck — ` +
      out
        .map((r) =>
          `${r.building}(${(r.roof.tris / 1000).toFixed(1)}k->${(r.ruin.tris / 1000).toFixed(1)}k tris, ` +
          `${(r.hole.x1 - r.hole.x0).toFixed(1)}x${(r.hole.z1 - r.hole.z0).toFixed(1)}m @${r.top.toFixed(1)}m)`)
        .join(' ')
  );
  return out;
}
