import { BOX, BOX_FINE, BOX_SOFT, BOX_THIN, IDENT, LL } from '../kit.js';
import { fbm3, patchGeometry, driftBerm, rockGeometry } from '../util.js';
import { Rng } from '../../core/rng.js';
import * as THREE from 'three';
import { paintMasks } from '../util.js';
import { RAMP_GRADE } from './plains-works.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD — DIE GRÄBEN. The trenches. 「塹壕を用意して平原の移動をリアルにし」
 * ════════════════════════════════════════════════════════════════════════════
 * 「平原の移動をリアルにし」 is a movement request, not a decoration one. This map
 * is 300 m of open ground with a 38 m tower in the middle of it and a
 * 58 m `Agent.viewRange`: without these, crossing from a base to a shoulder zone
 * is 90 seconds in the open with nothing between you and four bearings. A trench
 * is the answer, and the only thing that makes one a trench rather than a ditch
 * is that it goes SOMEWHERE.
 *
 * So all three of them connect two named places and are dug on the line between
 * them, not scattered for the look of it:
 *
 *   NORDGRABEN   the north base → zone A. 86 m, the attack's covered approach
 *                to the western bomb site.
 *   SÜDGRABEN    the south base → zone B. Its mirror, 86 m.
 *   MITTELSAPPE   zone D → the fortress's west bastion. 43 m of sap from the
 *                capture point to the wall, which is the ground you cannot
 *                cross standing up while the control tower is held.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE SECTION, AND WHY EVERY NUMBER IN IT IS THE NUMBER IT IS
 * ────────────────────────────────────────────────────────────────────────────
 *
 *      parapet +0.35 ▁▁▁▁▄▄▄▄                    ▄▄▄▄▁▁▁▁  +0.35
 *   plain 0.00 ──────────────┐                  ┌──────────────
 *                            │   fire step      │
 *                     -1.20  │  ┌────────┐      │
 *                            │  │        │      │
 *                     -1.65  └──┘        └──────┘   floor, 3.0 m clear
 *
 *   DEPTH 1.65 + PARAPET 0.35 = 2.00 m of cover from the trench floor. A
 *   standing eye is 1.60, so a man on the floor is UNDER the crest by 0.40 —
 *   covered, and he cannot shoot either, which is what makes the fire step the
 *   decision it should be.
 *   THE FIRE STEP is 0.45 m. On it, a standing eye is 2.05 — 5 cm over the
 *   crest, so he is shooting and his head is the only thing showing — and a
 *   CROUCHED eye (1.15) is 1.60, still 0.40 under it. That is the whole point of
 *   the request: cover at a standing eye AND at a crouched one, and a stance key
 *   that changes whether you are in the fight.
 *   3.0 m CLEAR AT THE FLOOR is a `NavGrid` number: cells are 0.8 m and the
 *   capsule radius is 0.36, so three cells of floor with room either side is
 *   what makes the trench a route the bots can actually walk down rather than a
 *   one-cell ribbon that the shoulder probe shuts.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT A HEIGHT FIELD CAN AND CANNOT DO WITH A TRENCH, said plainly
 * ────────────────────────────────────────────────────────────────────────────
 * A trench is the tower's problem upside down: one floor per (x, z), and inside
 * a trench that floor is 1.65 m below the plain either side of it. So:
 *
 *   IT WORKS — the trench floor is in the grid, it is 3.0 m wide, and each
 *   BAY has a RAMPED END at `RAMP_GRADE` at both ends, so a bot can walk down
 *   into it, along it and out of the far end as ordinary ground.
 *
 *   IT IS ALSO A WALL — 2.0 m from the floor to the crest is far over the
 *   0.45 m `maxStep`, so a bot crossing the LINE of the trench cannot step over
 *   it, and neither can a man. That is exactly what a trench is for and it is
 *   also how you cut a map in half by accident.
 *
 * The answer is the one a real trench uses: TRAVERSES. Each line is dug in bays
 * of ~34 m with 9 m of undug ground between them, which in a real trench stops
 * an enfilade down the whole length and here also leaves the plain crossable on
 * foot every 43 m. `tools/navcheck.mjs` is the gate on that and it is the reason
 * the bays are this length rather than one continuous 86 m cut.
 */

/** Section. @see the diagram in the header. */
const DEPTH = 1.65;
const HALF = 1.5;          // 3.0 m clear at the floor
const WALL_W = 0.85;       // the cheek, cut at 63° so it is not a slope
const STEP_H = 0.45;       // the fire step
const STEP_W = 0.85;
const PARAPET = 0.35;      // spoil, and it is UNDER `maxStep` so it is walkable
const BERM_W = 2.4;
/** Where the section has finished and the strip is the plain again. */
const TOE = HALF + WALL_W + BERM_W + 1.4;
/** How long a bay is, and how much undug ground is left between two of them. */
const BAY = 34;
const TRAVERSE = 9;
/** Ramped ends: 1.65 m at `RAMP_GRADE` is 4.34 m of run. */
const ENTRY = DEPTH / RAMP_GRADE;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * A TRENCH HAS TO BE CUT OUT OF THE TERRAIN MESH, NOT LAID UNDER IT
 * ────────────────────────────────────────────────────────────────────────────
 * The first version of this file built the whole section as boxes 1.65 m below
 * `plainsY` and changed NOTHING: `[ai] nav` came back with 223 648 walkable
 * cells before and 223 648 after, to the cell. The plain's terrain is ONE mesh
 * and it is also the collision, so the ray the height field drops hit the field
 * over the top of the trench and never saw it. A cut you cannot get into is
 * scenery.
 *
 * It cannot be cut by the field itself either: `FIELD_SEG` is 148, i.e. 3.18 m
 * quads over a 470 m plane, and a 3 m trench is a quarter of one quad. Raising
 * the resolution enough to hold this section would take the terrain from 22 k
 * quads to 220 k, which is most of the map's whole triangle budget for three
 * lines of ditch.
 *
 * So the field gets a HOLE and this module fills it: `inCorridor` tells
 * `buildTerrain` which triangles to drop, and `stripMesh` builds the section at
 * 0.3 m across and 1.0 m along, blending back onto `plainsY` well outside the
 * hole's own ragged 3.18 m edge. One surface, still, and it is still the
 * collision — the rule the rest of this level is built on.
 */
const CUT_R = 6.5;    // triangles whose CENTROID is inside this are dropped
const STRIP_R = 11.0; // …and the strip runs this far out, so it covers the hole

/**
 * The three lines, as [from, to] in level metres. @see the header for what each
 * one joins; the endpoints are pulled a few metres short of the pads themselves
 * so a bay never ends inside a capture circle or a base's spawn cluster.
 *
 * `fireSide` is which side of the cut the fire step and the wire are on: +1 is
 * the LEFT of the run as walked from `from` to `to`, i.e. the side the trench is
 * meant to be fought from.
 */
export const TRENCHES = [
  { id: 'NF-TRENCH-N', name: 'NORDGRABEN', from: [-26, -138], to: [-104, -108], fireSide: 1 },
  { id: 'NF-TRENCH-S', name: 'SUDGRABEN', from: [26, 138], to: [104, 108], fireSide: -1 },
  { id: 'NF-TRENCH-M', name: 'MITTELSAPPE', from: [-13, -5], to: [-29, 34], fireSide: -1 },
];

/** Perpendicular distance to the nearest bay axis, for the strip's paint. */
function nearestD(x, z) {
  let best = 1e9;
  for (const b of BAYS) {
    const l = local(b, x, z);
    if (l) best = Math.min(best, Math.abs(l.d));
  }
  return best;
}

/** Every bay of every line, resolved once: [x0,z0,x1,z1] plus the frame. */
const BAYS = [];

function frameOf(spec) {
  const [x0, z0] = spec.from;
  const [x1, z1] = spec.to;
  const dx = x1 - x0, dz = z1 - z0;
  const total = Math.hypot(dx, dz);
  const tx = dx / total, tz = dz / total;
  return { x0, z0, tx, tz, nx: tz, nz: -tx, total, yaw: Math.atan2(dx, dz) };
}

/**
 * Perpendicular and along-line coordinates of a world point relative to a bay,
 * or null when it is past either end.
 */
function local(bay, x, z) {
  const px = x - bay.F.x0, pz = z - bay.F.z0;
  const s = px * bay.F.tx + pz * bay.F.tz;
  if (s < bay.s0 - 1 || s > bay.s1 + 1) return null;
  return { s, d: px * bay.F.nx + pz * bay.F.nz };
}

/**
 * Is this point inside the corridor the terrain mesh must give up? Used by
 * `buildTerrain` on triangle centroids, and by `plains.js` to keep the scatter
 * out of the cut.
 */
export function inCorridor(x, z, r = CUT_R) {
  for (const b of BAYS) {
    const l = local(b, x, z);
    if (l && Math.abs(l.d) < r) return true;
  }
  return false;
}

/**
 * THE SECTION, ANALYTIC — depth below the plain at a perpendicular distance `d`,
 * for a bay whose local depth (0 at each ramped mouth) is `depth`.
 * Negative is a cut, positive is the spoil thrown up on the lip.
 */
function section(d, depth) {
  const a = Math.abs(d);
  if (a <= HALF) return -depth;
  if (a <= HALF + WALL_W) {
    // the cheek: 63° at full depth, which is over `maxSlopeDeg` 46 and is
    // therefore a wall to the height field rather than a way in
    const t = (a - HALF) / WALL_W;
    return -depth * (1 - t * t * (3 - 2 * t));
  }
  const b = a - HALF - WALL_W;
  if (b <= BERM_W) {
    // the parapet, and 0.35 is UNDER the 0.45 m step so it stays crossable
    const t = b / BERM_W;
    return PARAPET * Math.sin(t * Math.PI) ** 0.8;
  }
  return 0;
}

/**
 * Resolve every bay. Called at module load so `inCorridor` — which
 * `buildTerrain` consults BEFORE anything else on this map is built — has
 * something to answer with.
 */
for (const spec of TRENCHES) {
  const F = frameOf(spec);
  for (let s = 0; s < F.total - 6; s += BAY + TRAVERSE) {
    const s0 = s;
    const s1 = Math.min(F.total, s + BAY);
    if (s1 - s0 < ENTRY * 2 + 4) continue;
    BAYS.push({ spec, F, s0, s1 });
  }
}

/** Published so `plains.js` can keep its scatter out of the cut. */
export function trenchKeepOut() {
  const out = [];
  for (const b of BAYS) {
    const n = Math.ceil((b.s1 - b.s0) / 4);
    for (let i = 0; i <= n; i++) {
      const s = b.s0 + ((b.s1 - b.s0) * i) / n;
      out.push({
        x: b.F.x0 + b.F.tx * s,
        z: b.F.z0 + b.F.tz * s,
        r: HALF + WALL_W + BERM_W + 1.0,
      });
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────── build ──
export function buildTrenches(A, groundY) {
  /** Its own fixed-seed stream — @see the same note in `plains-tower.js`. */
  const rng = new Rng(0x7c8ea1);
  for (const b of BAYS) {
    stripMesh(A, b, groundY);
    dressBay(A, rng, b, groundY);
  }
}

/**
 * THE CUT ITSELF, as one mesh per bay, and it is the collision as well — the
 * same discipline `buildTerrain` follows, for the same reason: a separate
 * coarse hull would put the player a few centimetres off the visible floor and
 * describe a trench to the bots that the man at the keyboard cannot see.
 *
 * 0.3 m across resolves the 0.85 m cheek in three quads; 1.0 m along is plenty
 * for a section that only changes at the two ramped mouths.
 */
function stripMesh(A, bay, groundY) {
  const { F, s0, s1 } = bay;
  const nA = Math.max(6, Math.round((s1 - s0) / 1.0));
  const nD = Math.round((STRIP_R * 2) / 0.3);
  const g = new THREE.PlaneGeometry(1, 1, nD, nA);
  g.rotateX(-Math.PI / 2);
  const pa = g.getAttribute('position');
  const depthAt = (s) => {
    const t = Math.min(1, Math.min(s - s0, s1 - s) / ENTRY);
    return DEPTH * Math.max(0, t);
  };
  for (let i = 0; i < pa.count; i++) {
    // PlaneGeometry's own u/v, remapped onto (along, across)
    const u = pa.getX(i) + 0.5;
    const v = pa.getZ(i) + 0.5;
    const s = s0 - 0.5 + (s1 - s0 + 1.0) * v;
    const d = (u - 0.5) * STRIP_R * 2;
    const x = F.x0 + F.tx * s + F.nx * d;
    const z = F.z0 + F.tz * s + F.nz * d;
    const base = groundY(x, z);
    // …plus 3 cm out on the toe, so the metre of overlap with the surviving
    // terrain is a lip rather than two coincident surfaces fighting over a
    // depth buffer at 200 m
    const over = Math.abs(d) > TOE ? 0.03 : 0;
    pa.setXYZ(i, x, base + section(d, depthAt(s)) + over, z);
  }
  g.computeVertexNormals();
  /**
   * THE STRIP IS PAINTED WITH THE PLAIN'S OWN RECIPE, not with its own, and it
   * carries the plain's own palette key. `steppe_bare` and a paint of this
   * module's invention drew a hard-edged 22 m band of a different colour across
   * the grass wherever a trench ran — the geometry was seamless and the material
   * was not, which is the more obvious of the two failures at 30 m.
   *
   * @see `buildTerrain`'s paint in plains.js: these three lines are the same
   * three, plus a turned-earth term that only bites inside the cut.
   */
  paintMasks(g, (x, y, z, mx, my, mz, out) => {
    const n = fbm3(x * 0.055, 2.3, z * 0.055, 3);
    const steep = 1 - Math.min(1, Math.max(0, (my - 0.62) / 0.3));
    // how far into the section this vertex is: 1 on the floor, 0 out on the toe
    const l = nearestD(x, z);
    const dug = Math.max(0, 1 - Math.max(0, l - HALF - WALL_W) / BERM_W);
    out[0] = Math.min(1, 0.18 + steep * 0.6 + dug * 0.22);
    out[1] = Math.min(1, 0.22 + n * 0.46 - steep * 0.18 + dug * 0.3);
    out[2] = Math.min(1, 0.18 + n * 0.22 + dug * 0.2);
  });
  A.add('steppe', g, null);
  A.collideGeo('dirt', g);
  g.dispose();
}

function dressBay(A, rng, bay, groundY) {
  buildLine(A, rng, bay, groundY);
}

function buildLine(A, rng, bay, groundY) {
  buildBay(A, rng, bay.spec, groundY, bay.F, bay.s0, bay.s1);
}

/**
 * ONE BAY'S DRESSING. The cut itself is `stripMesh` — this is everything that
 * was put IN it: duckboards on the floor, revetment against both cheeks, the
 * fire step on the side that faces the enemy, sandbags on the crest above it,
 * the stores a held trench accumulates and the wire out in front.
 *
 * The fire step is the only thing here that carries collision, because it is
 * the only thing here you stand on.
 */
function buildBay(A, rng, spec, groundY, F, s0, s1) {
  const at = (s, d = 0) => [F.x0 + F.tx * s + F.nx * d, F.z0 + F.tz * s + F.nz * d];
  const depthAt = (s) => {
    const t = Math.min(1, Math.min(s - s0, s1 - s) / ENTRY);
    return DEPTH * Math.max(0, t);
  };

  const SEG = 1.6;
  const n = Math.max(4, Math.round((s1 - s0) / SEG));
  for (let i = 0; i < n; i++) {
    const s = s0 + (i + 0.5) * ((s1 - s0) / n);
    const [cx, cz] = at(s);
    const g = groundY(cx, cz);
    const d = depthAt(s);
    const floor = g - d;
    const len = (s1 - s0) / n + 0.06;
    if (d < 0.55) continue; // the ramped mouths are bare earth, and have to be

    // ---- duckboards, laid down the middle of the floor ---------------------
    if (i % 2 === 0) {
      A.add('wood_prop_dark', BOX_FINE(A), LL(IDENT, cx, floor + 0.05, cz,
        F.yaw + rng.range(-0.02, 0.02), HALF * 1.6, 0.07, len * 0.92), { masks: [0.85, 0.75, 0.3] });
      for (let k = -1; k <= 1; k++) {
        A.add('wood_prop', BOX_THIN(A), LL(IDENT, cx + F.tx * k * 0.5, floor + 0.1, cz + F.tz * k * 0.5,
          F.yaw, HALF * 1.5, 0.04, 0.16), { masks: [0.8, 0.6, 0.2] });
      }
    }

    // ---- revetment against the two cheeks ----------------------------------
    for (const sd of [-1, 1]) {
      const [wx, wz] = at(s, sd * (HALF + 0.14));
      if (sd > 0) {
        // corrugated sheet, held by a stake every third bay length
        A.add('corrugated', BOX_THIN(A), LL(IDENT, wx, floor + d / 2 + 0.06, wz,
          F.yaw, 0.06, d + 0.1, len), { masks: [0.9, 0.75, 0.25] });
        if (i % 3 === 0) {
          A.add('wood_prop_dark', BOX_THIN(A), LL(IDENT, wx - F.nx * sd * 0.09, floor + d / 2, wz - F.nz * sd * 0.09,
            F.yaw, 0.12, d + 0.3, 0.13), { masks: [0.8, 0.65, 0.2] });
        }
      } else {
        // hurdles: three raking boards behind a picket
        for (let k = 0; k < 3; k++) {
          A.add('wood_prop', BOX_THIN(A), LL(IDENT, wx, floor + 0.3 + k * (d / 3.1), wz,
            F.yaw + rng.range(-0.03, 0.03), 0.08, 0.19, len * 0.98), { masks: [0.85, 0.6, 0.25] });
        }
        if (i % 4 === 1) {
          A.add('metal_rust', BOX_THIN(A), LL(IDENT, wx - F.nx * sd * 0.07, floor + d / 2 + 0.15, wz - F.nz * sd * 0.07,
            F.yaw, 0.06, d + 0.4, 0.06), { masks: [0.9, 0.7, 0] });
        }
      }
    }

    // ---- the fire step, on the side that faces the enemy --------------------
    {
      const sd = spec.fireSide;
      const [ex, ez] = at(s, sd * (HALF - STEP_W / 2));
      A.add('dirt', BOX(A), LL(IDENT, ex, floor + STEP_H / 2, ez, F.yaw, STEP_W, STEP_H, len), {
        masks: [0.3, 0.7, 0.45],
      });
      A.box('dirt', ex, floor + STEP_H / 2, ez, STEP_W, STEP_H, len);
      if (i % 2 === 0) {
        A.add('wood_prop_dark', BOX_FINE(A), LL(IDENT, ex, floor + STEP_H + 0.03, ez, F.yaw,
          STEP_W * 0.92, 0.06, len * 0.9), { masks: [0.85, 0.7, 0.3] });
        /**
         * ON THE CREST OF THE PARAPET, and the height comes from `section` for
         * exactly that reason. Placed at `g + PARAPET` on a fixed offset they
         * sat three quarters of a metre in the air over the CHEEK, which is
         * still 0.4 m below the plain there — photographed from inside the
         * trench, a row of sandbags floating against the sky.
         */
        const bd = sd * (HALF + WALL_W + BERM_W * 0.35);
        const [bx, bz] = at(s, bd);
        const by = groundY(bx, bz) + section(bd, d);
        for (let k = 0; k < 2; k++) {
          A.put(rng.pick(['sandbag_a', 'sandbag_b', 'sandbag_c']),
            bx + rng.range(-0.2, 0.2), by + 0.09 + k * 0.18, bz + rng.range(-0.2, 0.2),
            F.yaw + rng.range(-0.18, 0.18), rng.range(0.95, 1.15));
        }
      }
    }
  }

  // ---- what a held trench accumulates -------------------------------------
  const stores = Math.round((s1 - s0) / 9);
  for (let i = 0; i < stores; i++) {
    const s = s0 + ENTRY + rng.float() * (s1 - s0 - ENTRY * 2);
    const [px, pz] = at(s, rng.range(-HALF + 0.7, HALF - 0.7));
    const g = groundY(px, pz) - depthAt(s);
    A.put(rng.pick(['crate_b', 'box_card_b', 'jerry_can', 'bucket', 'sandbag_b', 'plank_a']),
      px, g + 0.16, pz, rng.float() * 6.28, rng.range(0.85, 1.1));
  }
  // wire pickets and a coil of it, out on the parapet facing the enemy
  {
    const sd = spec.fireSide;
    const pickets = Math.max(2, Math.round((s1 - s0) / 5));
    for (let i = 0; i < pickets; i++) {
      const s = s0 + ((i + 0.5) / pickets) * (s1 - s0);
      if (depthAt(s) < DEPTH * 0.7) continue;
      const pd = sd * (HALF + WALL_W + BERM_W + rng.range(0.6, 2.6));
      const [px, pz] = at(s, pd);
      const g = groundY(px, pz) + section(pd, depthAt(s));
      A.add('metal_rust', BOX_THIN(A), LL(IDENT, px, g + 0.52, pz, rng.float() * 6.28,
        0.07, 1.05, 0.07, rng.range(-0.12, 0.12), rng.range(-0.12, 0.12)), { masks: [0.9, 0.7, 0] });
      for (let k = 0; k < 3; k++) {
        A.add('metal_rust', BOX_THIN(A), LL(IDENT, px + rng.range(-0.5, 0.5), g + 0.35 + k * 0.26,
          pz + rng.range(-0.5, 0.5), rng.float() * 6.28, rng.range(0.7, 1.9), 0.022, 0.022,
          rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)), { masks: [0.95, 0.75, 0] });
      }
    }
  }
  // spoil and boot-churn on the parapet and the floor
  for (let i = 0; i < Math.round((s1 - s0) * 0.8); i++) {
    const s = s0 + rng.float() * (s1 - s0);
    const dd = rng.range(-HALF - WALL_W - BERM_W, HALF + WALL_W + BERM_W);
    const [px, pz] = at(s, dd);
    const g = groundY(px, pz) + section(dd, depthAt(s));
    const patch = patchGeometry(rng, rng.range(0.4, 1.5), { lobes: 10, wobble: 0.55 });
    A.addOnce(rng.float() < 0.55 ? 'steppe_bare' : 'road_dust', patch,
      LL(IDENT, px, g + 0.04, pz, rng.float() * 6.28, 1, 1, rng.range(0.6, 1.3)),
      { masks: [0.35, rng.range(0.45, 0.95), 0.35] });
  }
}
