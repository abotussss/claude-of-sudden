import * as THREE from 'three';
import { BOX, BOX_SOFT, IDENT, LL } from '../kit.js';
import { fbm3, patchGeometry, paintMasks, rockGeometry, disposeAll } from '../util.js';
import { registerProps } from '../props.js';
import { Rng } from '../../core/rng.js';
import { buildTower, TOWER, TOWER_R } from './plains-tower.js';
import { publishWorks } from './plains-works.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LEVEL — NACHTFELD. The night plain.
 * ════════════════════════════════════════════════════════════════════════════
 * 「次は平原かつ夜のマップ … 起伏がある平原 山があり、かなり距離のあるマップにして
 *   占領サイトの距離も空けて … とにかく夜だけどある程度の明るさのあるマップにして
 *   もちろん山が燃えていて明るくなっていたりとかも良い」
 *
 * THIS FILE IS THE GROUND AND NOTHING ELSE. The control tower, the fortress,
 * the trenches, the caves, the EMP zones, the three-a-side tanks, the suicide
 * drones and the satellite that sets the plain on fire are all still to come,
 * and they are deliberately not here — a map that half-exists in eight places
 * cannot be worked on by eight people. What this publishes is a REAL, BOOTABLE
 * level with ground to stand on, a boundary, a light source and five capture
 * points that a bot can walk between, plus the seams the rest bolts onto:
 *
 *   `PADS`         the flattened, proved standing ground under each capture
 *                  point and each base. A feature that wants level ground
 *                  (a fortress footprint, a tower base, a trench line) adds a
 *                  pad and the terrain, the collision, the analytic
 *                  `groundY` and every scattered prop follow it in one step.
 *   `plainsY`      THE height field, analytic. Anything that has to sit ON the
 *                  plain — a trench lip, a revetment, a tank route — asks this
 *                  rather than raycasting, exactly as `dressing.groundY` does
 *                  on the town.
 *   `PLAINS.fires` the burning ridge sites, published as world positions with a
 *                  radius, so `fx` or a later event can put real flame on them.
 *   `PLAINS.ridge` the bowl: foot radius, crest radius, crest height. A cave
 *                  mouth, an EMP mast or a bunker cut into the mountain reads
 *                  these rather than guessing where the rock starts.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT A CAVE WOULD ACTUALLY TAKE, since he asked for one and it is not here
 * ────────────────────────────────────────────────────────────────────────────
 * 「地下洞窟で移動できるようにしたり」 — an underground route across the plain — is
 * the ONE request on the list that this engine's navigation cannot express, and
 * it is worth being exact about why rather than half-building it.
 *
 * `src/ai/nav.js` is a 2.5D HEIGHT FIELD: `this.floor = new Float32Array(n)`,
 * ONE walkable height per (x, z) cell, found by dropping a single ray from
 * above the level. A tunnel UNDER open ground is two floors at the same (x, z),
 * and the field has one slot. The ray hits the plain and the tunnel does not
 * exist; carve the cells to the tunnel instead and the plain above them stops
 * existing. This is the same limit that makes upper storeys and roofs a
 * PLAYER-ONLY feature on the town (see `NavGrid._carveInteriors` and the
 * `world.links` note in ARCHITECTURE.md) — there, `world` could publish
 * `interiorVolumes` and let `ai` re-sample the ground storey precisely BECAUSE
 * a building's roof is not ground anyone needs; a plain is.
 *
 * The three honest options, in ascending cost:
 *   1. PLAYER-ONLY CAVES. Build them, put the decks on `LAYER.CLIP` so the
 *      height field keeps the plain above, and accept that no bot ever uses
 *      one. Cheapest, and consistent with how roofs already work here.
 *   2. A PORTAL EDGE. Keep the 2.5D field and add explicit off-grid links
 *      (mouth A -> mouth B) that A* may traverse, with the interior walked as a
 *      spline rather than as cells. `world.links` is already the shape of this
 *      record; what is missing is `NavGrid.findPath` honouring it.
 *   3. A SECOND LAYER. `floor`/`flags` become two planes with an explicit
 *      layer index on every node. That is a change to the core search, its
 *      heap, its neighbour rule and every consumer of `grid.nearest`.
 * Option 2 is the one to write, and it belongs in `src/ai`, not here.
 */

// ─────────────────────────────────────────────────────────────────── shape ──
/**
 * THE BOWL. Open ground out to `RIDGE_R0`, then mountain.
 *
 * The mountains are the map boundary and they are load-bearing as such: the rim
 * rises 46 m over 38 m of ground, which is a 50-64° face depending on the
 * bearing, and `NavGrid`'s slope limit is 46° — so the bot height field stops
 * itself at the foot without a single authored keep-out. It is a boundary the
 * player can SEE, which the town never had (`cordon.js` exists because 5 645 m²
 * of that map leaked out through six holes nobody could see).
 *
 * WHAT THE SIZE COSTS, and it is the one number to be careful with here: the
 * play box is the nav grid's extent, and cells go as the SQUARE of it. The town
 * is ±129 m → 448×448 ≈ 200k cells. This is ±200 m → 500×500 = 250k cells,
 * 1.25× the rays and the memory. `NavGrid.maxNodes` is sized to the grid rather
 * than fixed (`nav.js:356`), so the long A* across 300 m of open ground is not
 * silently truncated the way a fixed 24000 would have truncated it.
 */
const RIDGE_R0 = 176;
const RIDGE_R1 = 214;
const RIDGE_H = 46;
/** Half-extent of the play box, in metres. Comfortably past the crest. */
const BOUNDS_HALF = 200;

/** The walked terrain: one mesh, and it is the collision as well. */
const FIELD = 470;
const FIELD_SEG = 148; // 3.18 m quads

/**
  * The view past the crest. Visual only, no collision, no nav.
  *
  * IT IS SMALL AND IT IS DARK, AND BOTH ARE MEASURED RATHER THAN CHOSEN. At
  * 2 200 m across with 300 m peaks this range filled the upper half of every
  * frame, stood entirely past `q.shadowDistance` (so it was never in a cascade
  * and never in shadow), and poked clean out of the height fog — which made it
  * the brightest thing on a moonlit map. The auto-exposure metered on it and the
  * plain the player is standing on went to black; hiding this one mesh and
  * changing nothing else took the ground from unreadable to fully readable.
  * 1 500 m and 110 m peaks sit inside the fog and under the crest of the walked
  * ridge, which is where a night horizon belongs.
  */
const FAR = 1500;
const FAR_SEG = 40;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PADS — level ground, authored, and the seam every later feature wants
 * ────────────────────────────────────────────────────────────────────────────
 * A capture point on a 20° slope is a capture point where one side always has
 * the high ground and the bar is fought over from above; a fortress on one is a
 * fortress with a corner in the air. So each one flattens the swell to the
 * height at its own centre, held flat inside `r0` and blended out to `r1`.
 *
 * `plainsY` applies these, `groundY` IS `plainsY`, the terrain mesh is built
 * from `plainsY`, and the collision IS that mesh — so there is exactly one
 * statement of where the ground is and nothing can drift out of agreement with
 * it. That is the failure the town's `reliefY` comment warns about ("both read
 * the same numbers out of `RELIEF`, so the only way they can disagree is if one
 * of them is edited alone").
 *
 * ADDING ONE IS THE WHOLE API: push `{ x, z, r0, r1 }` and rebuild. `y` is
 * filled in below from the raw swell, so a pad never has to state a height.
 */
const PADS = [
  // the five capture points — @see the zone table in src/match/sites.js
  { id: 'A', x: -118, z: -104, r0: 16, r1: 34 },
  { id: 'B', x: 118, z: 104, r0: 16, r1: 34 },
  { id: 'C', x: -128, z: 86, r0: 16, r1: 34 },
  { id: 'E', x: 128, z: -86, r0: 16, r1: 34 },
  /**
   * D — THE CENTRE. Bigger than the rest and flat, because this is where the
   * control tower and the fortress go (「管制塔があり、要塞がある平原」) and both
   * of them want a footprint, not a hillside.
   */
  { id: 'D', x: 0, z: 0, r0: 30, r1: 58 },
  // the two bases
  { id: 'BASE-N', x: -14, z: -150, r0: 20, r1: 40 },
  { id: 'BASE-S', x: 14, z: 150, r0: 20, r1: 40 },
  /**
   * ────────────────────────────────────────────────────────────────────────
   * …AND THE GROUND THE WORKS STAND ON. APPENDED, and the position in this
   * array is load-bearing twice over.
   * ────────────────────────────────────────────────────────────────────────
   * `dressGround` and `markPads` both walk `PADS` in order off their own
   * fixed-seed streams, so a pad inserted in the MIDDLE would re-roll every
   * patch and every stone on every pad after it. Appended, the five zones and
   * the two bases draw exactly what they always drew.
   *
   * `y` IS FORCED TO ZONE D'S rather than taken from the swell under each
   * centre, which is what the loop below would otherwise do. Two overlapping
   * pads at different heights blend into a ramp between them; the tower, the
   * fortress and zone D are one continuous piece of made ground and every
   * course, sill and gate threshold in `plains-tower.js` and `plains-fort.js`
   * is authored off a single datum. @see `PAD_DATUM`.
   */
  { id: 'TOWER', x: 0, z: -32, r0: 28, r1: 46, datum: true },
];

/**
 * THE BURNING RIDGES — 「山が燃えていて明るくなっていたりとかも良い」, and this is not
 * decoration, it is the map's readability budget.
 *
 * A night map that cannot be fought in is the failure mode, and the moon alone
 * puts the plain 4-5 stops under the town's afternoon. Fire on the skyline does
 * three things a brighter moon cannot: it is DIRECTIONAL (a man on the ridge
 * side of you is a silhouette, a man on the dark side is not), it is WARM
 * against a cold sky so the two separate in hue as well as value, and it is
 * LOCAL, so the plain has bright quarters and dark quarters to move between.
 *
 * `bearing` is where on the rim it burns, `spread` how much of the rim, `h` how
 * far up the face. Published as `PLAINS.fires` in WORLD space with a radius, so
 * `fx` (or the satellite-strike event, when somebody writes it) can put real
 * flame, smoke column and heat shimmer on a site without re-deriving it.
 */
const FIRES = [
  { id: 'FIRE-NW', bearing: -2.42, spread: 0.30, h: 0.62 },
  { id: 'FIRE-N', bearing: -1.15, spread: 0.20, h: 0.48 },
  { id: 'FIRE-E', bearing: 0.24, spread: 0.34, h: 0.70 },
  { id: 'FIRE-SE', bearing: 1.36, spread: 0.22, h: 0.52 },
  { id: 'FIRE-S', bearing: 2.62, spread: 0.28, h: 0.58 },
];

/**
 * Dev / free-roam spawns: [x, z, yaw, tag], in metres (this level's transform is
 * the identity, so level space IS world space and a coordinate in a tool, in
 * `sites.js` and in this file all mean the same point).
 *
 * These are also the only seeds `tools/boundcheck.mjs` floods from, so every
 * pocket of the plain that is meant to be reachable needs one within reach of
 * the flood: both bases, all five capture points, and the four quarters between
 * them.
 */
const SPAWNS = [
  [-14, -150, 0, 'north base'],
  [14, 150, Math.PI, 'south base'],
  [-118, -104, 0.7, 'zone A — the west shoulder'],
  [118, 104, -2.4, 'zone B — the east shoulder'],
  [-128, 86, -0.6, 'zone C — the south-west swell'],
  [128, -86, 2.5, 'zone E — the north-east swell'],
  [0, 0, 0, 'zone D — the centre'],
  [-70, -60, 0.6, 'the north-west approach'],
  [70, 60, -2.5, 'the south-east approach'],
  [-72, 52, -0.7, 'the south-west approach'],
  [72, -52, 2.4, 'the north-east approach'],
  [0, -96, 0, 'the north hollow'],
  [0, 96, Math.PI, 'the south hollow'],
  [-150, 0, -1.57, 'the west foot'],
  [150, 0, 1.57, 'the east foot'],
];

// ───────────────────────────────────────────────────────────── height field ──
/**
 * THE SWELL — 「起伏がある平原」. Long, low, and gentle ON PURPOSE.
 *
 * The constraint is `NavGrid`: `maxStep` is 0.45 m across a 0.8 m cell and the
 * slope limit is 46°, so anything steeper than ~0.5 of gradient is ground the
 * bots simply lose. Every term here is chosen against its own gradient
 * (amplitude × angular frequency) and they sum, worst case, to 0.37 — a 20°
 * hillside at the very worst point on the map and 5-8° over most of it. That is
 * still enough to break every sightline on a 300 m plain, which is the point:
 * you cross a swell and the far half of the map disappears.
 */
function swell(x, z) {
  return (
    Math.sin(x * 0.0628 + 0.7) * Math.cos(z * 0.0554 - 1.3) * 2.8 +
    Math.sin(x * 0.0421 + z * 0.0369 + 2.1) * 1.35 +
    Math.cos(x * 0.0243 - z * 0.0297 - 0.4) * 1.9 +
    (fbm3(x * 0.011, 3.1, z * 0.011, 3) - 0.5) * 2.2 +
    (fbm3(x * 0.045, 8.2, z * 0.045, 2) - 0.5) * 0.55
  );
}

function smoothstep(a, b, t) {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/**
 * THE MOUNTAINS. Zero inside the foot, then a smooth rise to the crest whose
 * height varies with bearing so the skyline is a range rather than the rim of a
 * bowl — three harmonics, none of them in phase with the fire bearings, so a
 * fire lands on a face rather than always on a peak.
 */
function ridgeH(x, z) {
  const r = Math.hypot(x, z);
  if (r <= RIDGE_R0) return 0;
  const s = smoothstep(RIDGE_R0, RIDGE_R1, r);
  const a = Math.atan2(z, x);
  const peak =
    0.78 +
    0.30 * Math.sin(a * 3.0 + 0.6) +
    0.19 * Math.sin(a * 7.0 - 1.9) +
    0.11 * Math.sin(a * 13.0 + 2.7);
  return s * RIDGE_H * Math.max(0.42, peak);
}

/** Everything past the crest: a real range, drawn and never walked. */
function farH(x, z) {
  const r = Math.hypot(x, z);
  if (r <= RIDGE_R1) return 0;
  const f = smoothstep(RIDGE_R1, RIDGE_R1 + 260, r);
  const m = Math.max(0, fbm3(x * 0.0035, 5.7, z * 0.0035, 4) - 0.34);
  return f * m * 110;
}

/** The pad heights, resolved once off the raw swell. */
for (const p of PADS) p.y = swell(p.x, p.z);
/**
 * THE ONE DATUM THE CENTRE OF THE MAP IS BUILT ON. Zone D's own swell height;
 * every pad marked `datum` is pulled onto it so the works and the capture point
 * they stand either side of are one level plane. @see the note in `PADS`.
 */
export const PAD_DATUM = PADS.find((p) => p.id === 'D').y;
for (const p of PADS) if (p.datum) p.y = PAD_DATUM;

/**
 * THE GROUND, ANALYTIC — the single statement of where the plain is.
 *
 * The terrain mesh is built from it, the collision IS that mesh, `world.groundHeight`
 * is it, and every scattered prop, patch and stone is placed on it. There is
 * nothing here that can drift out of agreement with anything else.
 */
export function plainsY(x, z) {
  let y = swell(x, z) + ridgeH(x, z) + farH(x, z);
  for (const p of PADS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d >= p.r1) continue;
    const t = 1 - smoothstep(p.r0, p.r1, d);
    y = y * (1 - t) + p.y * t;
  }
  return y;
}

/**
 * Can a character stand outdoors here? On a plain the honest answer is "almost
 * everywhere", which is exactly why this is not `() => true`: the mountain is
 * out (nothing may be scattered on a 55° face and no gate may count it as
 * playable ground), and so is anything a later pass claims — the fortress
 * footprint, the trench spoil, the tower apron. `CLAIMS` is that list, empty
 * today and published so the next author has somewhere to put theirs.
 */
const CLAIMS = [];

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE WORKS — what the built structures have taken off the plain
 * ────────────────────────────────────────────────────────────────────────────
 * A circle per structure, consulted by BOTH `plainsOpen` (so no later pass may
 * claim ground the tower is standing on) and by the two scatter passes below
 * (so no boulder is instanced inside the control room and no tuft of grass grows
 * through 3 m of concrete). It is one table rather than a test written twice:
 * a stone poking out of a podium is the same bug as a stall pitched in the
 * cathedral, and `dressing.isOpen` exists on the town for exactly that reason.
 *
 * `r` is the FULL footprint including ramps and apron, plus a metre of margin —
 * `TOWER_R` and the fortress's own radius are published by their modules so the
 * number cannot drift from the geometry.
 */
const WORKS = [
  { id: 'NF-TOWER', x: TOWER.x, z: TOWER.z, r: TOWER_R + 1.2 },
];

/** Is this point inside something that has been built on the plain? */
export function inWorks(x, z, margin = 0) {
  for (const w of WORKS) {
    if ((x - w.x) ** 2 + (z - w.z) ** 2 < (w.r + margin) ** 2) return true;
  }
  return false;
}

export function plainsOpen(x, z, margin = 0.4) {
  const r = Math.hypot(x, z);
  // Past the foot the face pitches over; nothing stands there.
  if (r > RIDGE_R0 - margin) return false;
  if (inWorks(x, z, margin)) return false;
  for (const c of CLAIMS) {
    if (x > c.x0 - margin && x < c.x1 + margin && z > c.z0 - margin && z < c.z1 + margin) return false;
  }
  return true;
}

// ──────────────────────────────────────────────────────────────────── build ──
/**
 * A grid mesh over `plainsY`, with its own vertex masks.
 *
 * ONE MESH FOR BOTH THE PICTURE AND THE COLLISION. A separate, coarser
 * collision hull is the usual trick and it is the wrong one here: the player
 * would stand a few centimetres off the visible ground everywhere the two
 * disagreed, and the bot height field — which is one raycast per cell against
 * the collision — would describe a plain the player cannot see. 3.18 m quads
 * over a swell whose shortest wavelength is 100 m resolve it to under a
 * centimetre, and the close-up detail is the material's, not the mesh's.
 */
function terrainMesh(size, seg, fn) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pa = g.getAttribute('position');
  for (let i = 0; i < pa.count; i++) pa.setY(i, fn(pa.getX(i), pa.getZ(i)));
  g.computeVertexNormals();
  return g;
}

function buildTerrain(A) {
  // ------------------------------------------------------------- the plain --
  const field = terrainMesh(FIELD, FIELD_SEG, plainsY);
  paintMasks(field, (x, y, z, nx, ny, nz, out) => {
    // ny is the slope: 1 flat, 0 vertical. Steep ground is scoured to stone,
    // flat ground holds soil, and a broad noise keeps either from being uniform.
    const n = fbm3(x * 0.055, 2.3, z * 0.055, 3);
    const steep = 1 - Math.min(1, Math.max(0, (ny - 0.62) / 0.3));
    out[0] = 0.18 + steep * 0.6;
    out[1] = 0.22 + n * 0.46 - steep * 0.18;
    out[2] = 0.18 + n * 0.22;
  });
  A.add('steppe', field, null);
  A.collideGeo('dirt', field);
  field.dispose();

  /**
   * THE RANGE BEYOND THE CREST. Visual only — no collision, no nav, no
   * shadow-caster cost worth the cascades — and it sits UNDER the walked field
   * everywhere the two overlap (`farH` is 0 inside `RIDGE_R1`, and the field's
   * own ridge is not), so there is no z-fight and no seam anybody can stand
   * near to see. It exists because a 400 m plain with a hard horizon at 214 m
   * reads as a room.
   */
  const far = terrainMesh(FAR, FAR_SEG, (x, z) => {
    const r = Math.hypot(x, z);
    if (r < RIDGE_R1 * 0.94) return plainsY(x, z) - 1.5;
    return swell(x, z) + ridgeH(x, z) + farH(x, z);
  });
  paintMasks(far, (x, y, z, nx, ny, nz, out) => {
    out[0] = 0.55;
    out[1] = 0.3;
    out[2] = 0.25;
  });
  A.add('mountain_rock', far, null);
  far.dispose();
}

/**
 * SCREE, DUST AND WORN GROUND — the patch pass.
 *
 * The quality bar forbids a flat untextured surface and a 350 m disc of one
 * material is the largest one this project has ever drawn. Three passes, each
 * on its own fixed-seed stream so none of them can move the props placed after:
 * blown dust in the hollows, worn ground on the crowns of the swells, and scree
 * spilling off the mountain foot.
 */
function dressGround(A) {
  const r = new Rng(0x9e10a5);
  const R = RIDGE_R0 - 4;

  // dust and silt, gathered where water would run
  for (let i = 0; i < 520; i++) {
    const a = r.float() * Math.PI * 2;
    const d = Math.sqrt(r.float()) * R;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (inWorks(x, z)) continue;
    const g = patchGeometry(r, r.range(0.9, 3.4), { lobes: 11, wobble: 0.6 });
    A.addOnce(
      r.float() < 0.55 ? 'steppe_dust' : 'steppe_bare',
      g,
      LL(IDENT, x, plainsY(x, z) + 0.02, z, r.float() * 6.28, 1, 1, r.range(0.6, 1.5)),
      { masks: [0.15, r.range(0.3, 0.8), r.range(0.2, 0.5)] }
    );
  }

  // scree off the mountain foot, all the way round
  for (let i = 0; i < 700; i++) {
    const a = r.float() * Math.PI * 2;
    const d = RIDGE_R0 + r.range(-16, 26);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const g = patchGeometry(r, r.range(0.7, 2.6), { lobes: 10, wobble: 0.55 });
    A.addOnce('scree', g, LL(IDENT, x, plainsY(x, z) + 0.02, z, r.float() * 6.28, 1, 1, r.range(0.5, 1.2)), {
      masks: [0.4, r.range(0.3, 0.7), 0.2],
    });
  }

  // the pads read as ground that has been used: bare, driven-over centres
  for (const p of PADS) {
    for (let i = 0; i < 70; i++) {
      const a = r.float() * Math.PI * 2;
      const d = Math.sqrt(r.float()) * p.r0 * 1.15;
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      if (inWorks(x, z)) continue;
      const g = patchGeometry(r, r.range(0.6, 2.2), { lobes: 11, wobble: 0.5 });
      A.addOnce('steppe_bare', g, LL(IDENT, x, plainsY(x, z) + 0.025, z, r.float() * 6.28, 1, 1, r.range(0.6, 1.3)), {
        masks: [0.5, r.range(0.35, 0.8), 0.15],
      });
    }
  }
}

/**
 * WHAT GROWS ON IT, AND WHAT IS LYING ON IT.
 *
 * Instanced, and LOD'd hard: `weeds` carries `maxDist: 40` from `props.js`, so
 * eleven thousand tufts are eleven thousand matrices in a handful of chunked
 * batches of which only the near ones are ever drawn. That is what makes a
 * 350 m field of vegetation affordable at all, and it is why the tuft — not a
 * ground texture — is where the green lives on this map.
 *
 * Density is not uniform: it follows the same low-frequency noise the swell
 * does, so there are thin, grazed patches you are exposed in and thick stands
 * you are not, which is the only cover this map has until the trenches arrive.
 */
function scatterVegetation(A) {
  const r = new Rng(0x51e33b);
  const R = RIDGE_R0 - 3;
  const density = (x, z) => fbm3(x * 0.013, 6.4, z * 0.013, 3);

  for (let i = 0; i < 14000; i++) {
    const a = r.float() * Math.PI * 2;
    const d = Math.sqrt(r.float()) * R;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (r.float() > 0.25 + density(x, z) * 1.15) continue;
    if (inWorks(x, z)) continue;
    A.put('weeds', x, plainsY(x, z) - 0.03, z, r.float() * 6.28, r.range(0.7, 1.7), null, r.range(-0.08, 0.08), r.range(-0.08, 0.08));
  }
  for (let i = 0; i < 2600; i++) {
    const a = r.float() * Math.PI * 2;
    const d = Math.sqrt(r.float()) * R;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (r.float() > 0.12 + density(x, z) * 0.9) continue;
    if (inWorks(x, z)) continue;
    A.put('shrub', x, plainsY(x, z) - 0.06, z, r.float() * 6.28, r.range(0.55, 1.25));
  }
  // stone, thickening towards the mountain
  for (let i = 0; i < 4200; i++) {
    const a = r.float() * Math.PI * 2;
    const d = Math.sqrt(r.float()) * (RIDGE_R0 + 16);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const near = smoothstep(RIDGE_R0 - 70, RIDGE_R0 + 10, d);
    if (r.float() > 0.1 + near * 0.85) continue;
    if (inWorks(x, z)) continue;
    A.put(
      r.float() < 0.62 ? 'rock_b' : 'rock_a',
      x,
      plainsY(x, z) - 0.02,
      z,
      r.float() * 6.28,
      r.range(0.5, 1.9),
      null,
      r.range(-0.12, 0.12),
      r.range(-0.12, 0.12)
    );
  }
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE FIRES — the light this map is fought by
 * ────────────────────────────────────────────────────────────────────────────
 * Each site is a stretch of the ridge face built a second time in
 * `mountain_lit` and `ember` — the same rock, lifted into the warm end with
 * enough emission to bloom — plus ONE real point light standing off the face,
 * throwing warm light down onto the plain in front of it.
 *
 * ONE LIGHT PER SITE, AND THE COUNT IS FIXED FOR A REASON. `render` distance-
 * culls punctual lights and Three bakes the number of VISIBLE point lights into
 * every material's program cache key, so a light crossing its cull radius
 * recompiles every lit material in the scene — measured at +33-36 programs and
 * 640-900 ms on that single frame. `WorldSystem._addBallast` holds the count at
 * a fixed slot budget; five fires fit inside it with room to spare, and the
 * ballast adopts a higher count on its own if a later pass adds more.
 *
 * The lights are given a very long range on purpose (180 m). A burning hillside
 * is not a lamp: the near half of the plain should carry a directional warm
 * gradient off it, and a 30 m radius would make it a campfire.
 */
function buildFires(A, out) {
  const r = new Rng(0x0f17e5);
  const geos = [];
  for (const f of FIRES) {
    const a0 = f.bearing;
    // Where the burning face sits: part way up the rim on this bearing.
    const rr = RIDGE_R0 + (RIDGE_R1 - RIDGE_R0) * f.h;
    const cx = Math.cos(a0) * rr;
    const cz = Math.sin(a0) * rr;
    const cy = plainsY(cx, cz);

    /**
     * The burning face. Boulders of the SAME rock, scattered across the arc and
     * up the slope — not a decal and not a glowing sphere. The lit ones are the
     * seam, the dark ones in front of them are what makes it read as depth.
     */
    const n = 90;
    for (let i = 0; i < n; i++) {
      const t = (i + r.float()) / n;
      const aa = a0 + (t - 0.5) * f.spread;
      const rad = RIDGE_R0 + (RIDGE_R1 - RIDGE_R0) * (f.h + r.range(-0.28, 0.24));
      const px = Math.cos(aa) * rad;
      const pz = Math.sin(aa) * rad;
      const py = plainsY(px, pz);
      const lit = r.float() < 0.34;
      const g = rockGeometry(r, r.range(0.9, 3.4), 1, r.range(0.45, 0.8));
      geos.push(g);
      A.add(lit ? 'mountain_lit' : 'mountain_rock', g, LL(IDENT, px, py - r.range(0.2, 1.4), pz, r.float() * 6.28, 1, 1, 1), {
        masks: [r.range(0.3, 0.95), r.range(0.3, 0.8), 0.3],
      });
      // …and the seam itself, glowing between them
      if (lit && r.float() < 0.55) {
        A.add(
          'ember',
          BOX_SOFT(A),
          LL(IDENT, px + r.range(-1.2, 1.2), py + r.range(-0.4, 0.9), pz + r.range(-1.2, 1.2), r.float() * 6.28,
            r.range(0.5, 2.2), r.range(0.3, 1.0), r.range(0.5, 2.2))
        );
      }
    }

    /**
     * The light. Stood off the face and DOWN the slope, so what it lights is
     * the plain in front of the fire rather than the rock behind it.
     */
    const lx = Math.cos(a0) * (RIDGE_R0 - 26);
    const lz = Math.sin(a0) * (RIDGE_R0 - 26);
    const ly = plainsY(lx, lz) + 26;
    /**
     * 600 cd, NOT 9. This is the number that decides whether the map is
     * playable, and it is arrived at by comparison rather than by taste: the
     * moon's own directional intensity at this hour is 0.129 (measured — see
     * `hour` below), and a point light with `decay: 2` delivers
     * `intensity / d²`, so 9 cd is 0.0025 at 60 m — three per cent of the
     * moonlight, i.e. invisible. 600 cd is 0.17 at 60 m and 0.06 at 100 m:
     * brighter than the moon out to ~68 m of the fire and still readable at
     * half the map's width, which is exactly the "bright quarters and dark
     * quarters" this is for.
     */
    const light = new THREE.PointLight(0xff6a24, 600, 240, 2);
    light.position.set(lx, ly, lz);
    light.castShadow = false;
    A.light(light, { range: 240, priority: 1 });

    out.push({ id: f.id, position: new THREE.Vector3(cx, cy, cz), radius: (RIDGE_R1 - RIDGE_R0) * f.spread * 3, light });
  }
  disposeAll(geos);
}

/**
 * Marks on the ground where a capture point is, so a zone is a PLACE rather
 * than a HUD ring on empty grass. Deliberately minimal — the tower, the
 * fortress and the trench works are other people's — but a bare pad with
 * nothing on it is a bug you only find when you are standing on it at night.
 */
function markPads(A) {
  const r = new Rng(0x2b7c41);
  for (const p of PADS) {
    if (p.id.startsWith('BASE')) continue;
    /**
     * …EXCEPT THE ONES SOMETHING IS NOW STANDING ON, and a pad whose ring only
     * CLIPS a structure loses the stones that clip it rather than the whole
     * ring. Zone D's ring is at r 30 and the control tower's podium starts at
     * z -11: three quarters of that ring is still open plain and still wants
     * marking. A stone dropped inside the podium is a `rock_a` collider in the
     * middle of a wall — the same class of bug as a stall pitched in the
     * cathedral, which is what `dressing.isOpen` exists for.
     */
    if (inWorks(p.x, p.z)) continue;
    // a low ring of stone, laid rather than built: something to see at 150 m
    const n = Math.round(p.r0 * 2.6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r.range(-0.05, 0.05);
      const rr = p.r0 * r.range(0.94, 1.06);
      const x = p.x + Math.cos(a) * rr;
      const z = p.z + Math.sin(a) * rr;
      if (inWorks(x, z, 1.5)) continue;
      A.putS(
        'rock_a',
        x,
        plainsY(x, z) - 0.1,
        z,
        r.float() * 6.28,
        r.range(1.4, 2.6),
        r.range(0.9, 1.6),
        r.range(1.4, 2.6),
        null,
        r.range(-0.1, 0.1),
        r.range(-0.1, 0.1)
      );
    }
    /**
     * A mast, so the point has a vertical read at 150 m — and it stands OFF
     * CENTRE on purpose. At the centre it is a 0.3 m collider standing exactly
     * where the objective is: `tools/zonespot.mjs` reported 0 m of wall on all
     * eight bearings at A and B (its chest-height probe starts INSIDE the post),
     * which is the tool correctly describing an obstacle in the middle of the
     * flag. `stand` points are on a 7 m ring and were never affected; the read
     * was still right.
     */
    const mx = p.x + p.r0 * 0.55;
    const mz = p.z - p.r0 * 0.35;
    const my = plainsY(mx, mz);
    if (inWorks(mx, mz, 2)) continue;
    A.add('metal_dark', BOX(A), LL(IDENT, mx, my + 3.4, mz, 0, 0.22, 6.8, 0.22), { masks: [0.9, 0.6, 0.2] });
    A.box('metal', mx, my + 3.4, mz, 0.3, 6.8, 0.3);
    A.add('ember', BOX_SOFT(A), LL(IDENT, mx, my + 7.0, mz, 0, 0.34, 0.34, 0.34));
  }
}

// ──────────────────────────────────────────────────────────────── the level ──
export const PLAINS = {
  id: 'plains',
  name: 'NACHTFELD',
  /**
   * THE IDENTITY TRANSFORM, and it is a deliberate departure from the town.
   *
   * The town is authored down -Z and then yawed 0.5877 rad into the world, which
   * means every coordinate in `src/match/sites.js`, in `tank.js`'s routes and in
   * every tool has to be pushed through `world.levelToWorld` before it means
   * anything — and `match` may not import `world`, so `SCALE` and `widenX` are
   * duplicated by hand in FIVE files with a comment begging whoever moves one to
   * move the others. Here level space IS world space: a number in this file, in
   * `sites.js` and in a `--at=` argument to `tools/zonespot.mjs` are the same
   * point, and there is nothing to keep in sync.
   */
  yaw: 0,
  tx: 0,
  tz: 0,
  scale: 1,
  boundsHalf: BOUNDS_HALF,
  /** Down to -4 (nothing goes below the plain yet); up past the crest. */
  boundsY: [-6, 70],
  /**
   * 21:40 local solar time. The moon culminates around 19:45 on this sky's
   * geometry (`moonHourOffsetDeg: 244` in `src/sky/celestial.js`), so at 21:40
   * it is still well up and west of the meridian — a real key light with a
   * direction, rather than the flat blue of true midnight. 「夜だけどある程度の
   * 明るさのある」 is a lighting spec, and this is the half of it that is not fire.
   */
  hour: 21.65,
  /**
   * NIGHT HAZE. `fogDensity` scales `sky`'s own scatter/extinction pair, and on
   * a map whose far range stands 300 m past the crest it is what stops the
   * horizon out-metering the ground the player is standing on. `fogHeight` is
   * deep enough to hold the whole 46 m rim, and `coverage` puts enough cloud in
   * the sky for the moon to have something to light — a clear night sky is a
   * flat blue-black gradient and reads as a missing skybox.
   */
  weather: { fogDensity: 5.2, fogHeight: 150, coverage: 0.34, shaftGain: 0.7 },
  spawns: SPAWNS,

  /** Published for the features still to come. @see the header. */
  pads: PADS,
  ridge: { r0: RIDGE_R0, r1: RIDGE_R1, height: RIDGE_H },
  fires: [],
  works: WORKS,
  plainsY,

  build(A, rng) {
    // The prop library first: the plain's stone and scrub are its prototypes.
    registerProps(A, rng);

    buildTerrain(A);
    dressGround(A);
    markPads(A);
    this.fires = [];
    buildFires(A, this.fires);
    scatterVegetation(A);

    /**
     * ────────────────────────────────────────────────────────────────────────
     * THE WORKS, LAST — 「管制塔があり、要塞がある平原 … 塹壕を用意して」
     * ────────────────────────────────────────────────────────────────────────
     * At the END of `build` on purpose. `rng` is one stream and every pass above
     * draws from it in sequence, so a draw inserted anywhere earlier moves
     * several thousand stones and tufts sideways. Each structure below also
     * carries its OWN fixed-seed stream, so the plain's scatter is independent
     * of every rivet in them — the same rule `cathedral.js` and `demolition.js`
     * follow on the town.
     *
     * Each returns its own interior volumes (the ground storeys the bot height
     * field has to be told about — @see `plains-works.interiorVolume`) and its
     * own destroyed state, which `publish` below turns into `world.demolitions`.
     */
    const works = [];
    const volumes = [];
    const tower = buildTower(A, plainsY);
    works.push(tower.demolition);
    volumes.push(...tower.interiorVolumes);
    this._works = works;

    return {
      buildings: [],
      cathedral: null,
      features: [],
      links: [],
      interiorVolumes: volumes,
      works,
      /** Exposed for tools, the same way the town exposes its authored tables. */
      layout: {
        SCALE: 1,
        PADS,
        FIRES,
        WORKS,
        RIDGE: { r0: RIDGE_R0, r1: RIDGE_R1, height: RIDGE_H },
        BOUNDS_HALF,
      },
    };
  },

  /**
   * AFTER `A.finalize`, which is the first moment a scope has meshes and
   * collision handles to switch. The tower and the fortress publish exactly the
   * `world.demolitions` record shape the town's buildings do — id, name,
   * position, radius, top, navRect, mass, `setVisual`, `setCollision`, `setDown`
   * — so whoever writes the satellite-strike event has one code path for both
   * maps. @see `plains-works.publishWorks`.
   */
  publish(A, rec, physics) {
    return { demolitions: publishWorks(A, rec.works ?? [], physics) };
  },

  groundY: plainsY,
  isOpen: plainsOpen,
};
