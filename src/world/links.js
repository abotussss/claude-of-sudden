import { BOX, BOX_THIN, IDENT, LL } from './kit.js';
import { Rng } from '../core/rng.js';

/**
 * WORLD — THE ROOFTOP GANGWAYS: getting from one building to the next.
 *
 * "もっと屋内に移動できるポイントを増やし、建物と建物でインタラクティブに移動できるように
 *  してください"
 *
 * Before this, every roof on the map was a cul-de-sac you could only leave the
 * way you came: six enterable buildings, six separate stairs, six separate
 * roofs, no route between any two of them. This lays a scaffold gangway across
 * each of the four gaps in the two building rows, so the west row (W1-W2-W3) and
 * the east row (E1-E2-E3) each become ONE continuous upper route running the
 * length of the map, 55 m of it, with the connectors and both site approaches
 * underneath.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THE DECK IS ON `LAYER.CLIP`, AND WHY THAT IS THE WHOLE DESIGN
 * ────────────────────────────────────────────────────────────────────────────
 * Every one of the four gaps is a CONNECTOR — the rotation the defence uses to
 * fake one site and cover the other, and the thing `lanecheck` and `navcheck`
 * are most sensitive to. `src/ai/nav.js` samples its 2.5D height field by
 * dropping one ray per cell from 30 m and keeping the first hit under
 * `MASK.WORLD`, so a 1.4 m gangway across a 9 m connector at roof height would
 * make a 1.4 m strip of that connector read as an island at 6.5 m — the
 * connector's whole depth, blocked, for every bot on the map. That is not a
 * cosmetic regression: the layout notes say lengthening a rotation is the one
 * thing this map cannot afford.
 *
 * `MASK.CHARACTER` includes `LAYER.CLIP`; `MASK.WORLD` does not. So the decks,
 * the steps and the handrails are all authored with `A.clipBox`, which holds the
 * player and the bots up and is invisible to A*, to `groundHeight`, and to the
 * bomb-site resolve rays. Bullets and sightlines pass through the deck as well,
 * and that is deliberate: a plank walkway you can be shot off is a flank, while
 * bullet-proof floating cover 6.5 m over a rotation would be a griefing spot.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE FOUR GAPS
 * ────────────────────────────────────────────────────────────────────────────
 * Level Z, at 1.5x, with each roof's height beside it:
 *
 *   W1 roof 6.50  z 22.5 ─┐ 9.0 m over connector 1 west ┌─ z 13.5  W2 roof 6.50
 *   W2 roof 6.50  z -1.5 ─┐10.5 m over connector 2 west ┌─ z -12   W3 roof 6.50
 *   E1 roof 9.55  z 22.5 ─┐ 9.0 m over connector 1 east ┌─ z 13.5  E2 roof 9.55
 *   E2 roof 9.55  z -1.5 ─┐10.5 m over connector 2 east ┌─ z -12   E3 roof 6.50
 *
 * The three level ones are flat decks. The E2-E3 one falls 3.05 m — E3 is two
 * storeys and E2 is three — so it is a RAMP, which is the interesting one: it is
 * one-way in feel (you can see over the parapet going down, not coming up) and
 * it is the only sloped walking surface in the level.
 *
 * The ends are placed on the X overlap of the two ROOF PLATES, not the two
 * footprints, because W2's roof is set back 3.6 m on its +X side and a deck
 * landing at the footprint's centre would land in mid-air.
 *
 * A parapet is 0.78 m and its collision is 0.88, so a deck laid over one sits at
 * roof + 0.96. Three 0.32 m timber steps at each end make that a walk rather
 * than a mantle, which matters: `MOVE.mantle.maxHeight` is 1.85, so a mantle
 * would work, but a route you have to mantle onto is a route players do not see.
 *
 * `world.links` publishes every deck as a walkable span so other subsystems can
 * bind to it, and `tools/floorcheck.mjs` walks the real capsule across all four.
 */

/** Deck geometry, in metres. */
const DECK_W = 1.4;
const DECK_T = 0.12;
const RISE = 0.32;
const STEPS = 3;

export function buildLinks(A, infos) {
  const rng = new Rng(0x11b3a5e);
  const byId = new Map();
  for (const info of infos) byId.set(info.spec.id, info);

  /**
   * [from, to, xHint] — `xHint` is where along the shared frontage the gangway
   * lands, chosen off the plan: clear of each roof's stairhead (all of them are
   * in a corner) and, on the east row, clear of E3's collapsed roof hole.
   */
  const SPANS = [
    ['W1', 'W2', -22.0],
    ['W2', 'W3', -20.0],
    ['E1', 'E2', 18.0],
    ['E2', 'E3', 14.0],
  ];

  const links = [];
  for (const [aId, bId, xHint] of SPANS) {
    const a = byId.get(aId), b = byId.get(bId);
    if (!a || !b) continue;
    const link = gangway(A, rng, a, b, xHint);
    if (link) links.push(link);
  }
  return links;
}

/**
 * One gangway between two roofs. `a` is the +Z building, `b` the -Z one; the
 * deck runs along Z because the two rows are stacked in Z.
 */
function gangway(A, rng, a, b, xHint) {
  const ra = a.roofSpec ?? a.spec;
  const rb = b.roofSpec ?? b.spec;
  // the X band both roof plates share
  const x0 = Math.max(ra.x - ra.w / 2, rb.x - rb.w / 2) + DECK_W / 2 + 0.5;
  const x1 = Math.min(ra.x + ra.w / 2, rb.x + rb.w / 2) - DECK_W / 2 - 0.5;
  if (x1 <= x0) return null;
  const x = Math.min(x1, Math.max(x0, xHint));

  const zA = ra.z - ra.d / 2;   // the +Z building's south edge
  const zB = rb.z + rb.d / 2;   // the -Z building's north edge
  const yA = a.roofY + STEPS * RISE;
  const yB = b.roofY + STEPS * RISE;
  const gap = zA - zB;
  if (gap < 1.5) return null;

  /**
   * The deck overlaps each parapet by 0.9 m so it is visibly BEARING on
   * something at both ends rather than touching the edge.
   */
  const OVER = 0.9;
  const z0 = zB - OVER;         // south end
  const z1 = zA + OVER;         // north end
  const len = z1 - z0;
  const y0 = yB - (OVER / gap) * (yA - yB);
  const y1 = yA + (OVER / gap) * (yA - yB);
  const pitch = Math.atan2(y1 - y0, len);
  const cz = (z0 + z1) / 2;
  const cy = (y0 + y1) / 2;
  const dLen = Math.hypot(len, y1 - y0);

  // ----------------------------------------------------------- the beams --
  // Two rolled-steel joists, the depth a 10 m span actually needs.
  for (const s of [-1, 1]) {
    const bx = x + s * (DECK_W / 2 - 0.14);
    A.add('steel', BOX(A), LL(IDENT, bx, cy - 0.18, cz, 0, 0.16, 0.3, dLen, -pitch), {
      masks: [0.85, 0.55, 0.2],
    });
    // web stiffeners, so the beam is not a smooth bar
    const nst = Math.max(3, Math.round(dLen / 1.6));
    for (let i = 0; i <= nst; i++) {
      const t = (i / nst - 0.5) * len;
      A.add('metal_rust', BOX_THIN(A), LL(IDENT, bx + s * 0.09, cy - 0.18 + (t / len) * (y1 - y0), cz + t, 0, 0.03, 0.26, 0.12), {
        masks: [0.9, 0.5, 0.1],
      });
    }
  }

  // ------------------------------------------------------------ the deck --
  /**
   * Boards laid across, not one slab: a few short, one missing, one lifted at a
   * corner. The gap is where the player sees the connector 6 m below him through
   * his own feet, which is most of what makes crossing it feel like something.
   */
  const nb = Math.max(6, Math.round(len / 0.42));
  for (let i = 0; i < nb; i++) {
    const f = (i + 0.5) / nb;
    const pz = z0 + f * len;
    const py = y0 + f * (y1 - y0);
    if (rng.float() < 0.06 && i > 1 && i < nb - 2) continue;         // a missing board
    const w = DECK_W * (rng.float() < 0.12 ? rng.range(0.6, 0.85) : 1);
    const ox = (DECK_W - w) / 2 * (rng.float() < 0.5 ? -1 : 1);
    const lift = rng.float() < 0.1 ? rng.range(0.02, 0.05) : 0;
    A.add(rng.float() < 0.35 ? 'wood_prop' : 'wood_prop_dark', BOX(A),
      LL(IDENT, x + ox, py + lift, pz, 0, w, DECK_T, 0.38, -pitch), {
        masks: [rng.range(0.4, 0.8), rng.range(0.35, 0.8), rng.range(0.2, 0.5)],
      });
  }
  /**
   * One clip box for the whole walking surface — the boards are dressing.
   * PITCHED with the deck: the first cut of this laid a flat box under the E2-E3
   * ramp and `floorcheck` walked 12 of its 38 samples, with a 4.85 m hole in the
   * middle where the deck had climbed away from its own collision.
   */
  A.clipBox('wood', x, cy - DECK_T / 2, cz, DECK_W, DECK_T + 0.1, dLen, 0, -pitch);

  // -------------------------------------------------------- the handrail --
  // One side only, so the other is a place to drop off deliberately.
  const hs = x > 0 ? 1 : -1;
  const rx = x + hs * (DECK_W / 2 + 0.02);
  const nu = Math.max(3, Math.round(len / 1.7));
  for (let i = 0; i <= nu; i++) {
    const f = i / nu;
    const pz = z0 + f * len;
    const py = y0 + f * (y1 - y0);
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, rx, py + 0.52, pz, 0, 0.06, 1.04, 0.06), {
      masks: [0.95, 0.5, 0],
    });
  }
  for (const hy of [0.98, 0.55]) {
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, rx, cy + hy, cz, 0, 0.05, 0.05, dLen, -pitch), {
      masks: [0.95, 0.55, 0],
    });
  }
  A.clipBox('metal', rx, cy + 0.55, cz, 0.12, 1.1, dLen, 0, -pitch);

  // ------------------------------------------------------------- the steps --
  /**
   * Three timber treads at each end, INBOARD of the parapet, so getting on is a
   * walk. Their own clip boxes: the roof under them is already roof as far as the
   * bot grid is concerned, but keeping every part of a link on one layer means
   * there is one rule to remember rather than two.
   */
  for (const [end, zEdge, yTop, dir] of [['a', zA, yA, 1], ['b', zB, yB, -1]]) {
    for (let i = 0; i < STEPS; i++) {
      const h = (i + 1) * RISE;
      const pz = zEdge + dir * (0.5 + (STEPS - 1 - i) * 0.42);
      const py = yTop - STEPS * RISE + h;
      A.add('wood_prop_dark', BOX(A), LL(IDENT, x, py - h / 2, pz, 0, DECK_W + 0.25, h, 0.4), {
        masks: [0.6, rng.range(0.4, 0.8), 0.35],
      });
      A.clipBox('wood', x, py - h / 2, pz, DECK_W + 0.25, h, 0.42, 0);
    }
    // a sack of ballast holding the bottom tread down
    A.put(rng.float() < 0.5 ? 'sandbag_a' : 'sandbag_b', x + (DECK_W / 2 + 0.3), yTop - STEPS * RISE, zEdge + dir * 1.55, rng.float() * 6.28, 1);
  }

  return {
    id: `${a.spec.id}-${b.spec.id}`,
    from: a.spec.id, to: b.spec.id,
    /** LEVEL space: the walking line, so a tool or a subsystem can walk it. */
    x, z0, z1, y0, y1, width: DECK_W,
    span: +gap.toFixed(2), fall: +(yA - yB).toFixed(2),
  };
}
