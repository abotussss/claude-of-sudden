import * as THREE from 'three';
import { BOX, BOX_FINE, BOX_THIN, IDENT, LL, rubbleMound } from './kit.js';
import { clothGeometry, patchGeometry, chamferBox, fillMasks } from './util.js';

/**
 * WORLD — interior furnishing.
 *
 * Rooms get furniture against the walls, clutter in the middle, something on
 * every horizontal surface and rubbish in the corners. An interior screenshot
 * has to be interesting on its own, so each room type has a deliberate silhouette
 * mix: tall (shelves, cabinets), mid (tables, counters, crate stacks) and low
 * (rugs, sacks, litter) plus one or two hanging elements to break up the
 * ceiling.
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A PROP IS NOT A POINT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything below used to test a prop's CENTRE against the keep-clear circles,
 * and a wardrobe is 0.9 m across. So the centre cleared the circle and the body
 * of the object did not, and furniture landed in doorways and on stair treads —
 * `tools/floorcheck.mjs`'s four named failure modes ("buried cache", "sealed
 * flight", "cul-de-sac", "one-way-out") are all exactly what a blocked doorway
 * or a blocked tread produces, and it has been flaky for as long as it has
 * existed. What made it look like an architecture bug rather than a dressing
 * bug is that the victims move: adding one `clearSpot` draw anywhere shifts
 * every subsequent number in the level, so the same latent defect re-rolls onto
 * a different building on the next edit.
 *
 * Every predicate here therefore takes `rad`, the radius of the prop's own
 * collision footprint, and inflates the keep-clear region by it. `rad` comes
 * from `Assembler.footprintR`, which derives it from the very geometry the
 * physics proxy is built from — there is no table of radii per kind in this
 * file, because a table of radii per kind is the version of this fix that rots.
 *
 * `rad` is 0 for anything with no proxy (litter, sandbags, a bucket, a lying
 * tyre): the character controller steps over those and every gate measures
 * standing room from `STANCE.stand.stepHeight` up, so they cannot block
 * anything and are not filtered — the same rule `KEEPOUT` applies outdoors.
 */

/**
 * True where a piece of clutter that carries a COLLISION PROXY must not stand.
 *
 * `r.doorways` is the set of keep-clear circles this floor was handed by
 * `buildInterior`: the spots just inside the exterior doors, the whole run of
 * every staircase leaving or arriving on this floor, and every loot cache. A
 * crate stack or an oil drum dropped in one is not dressing, it is a locked
 * door: E3's side-3 and K2's side-2 openings were both blocked down to a 0.3 m
 * slot, and the player capsule is 0.64 m across.
 */
function inDoorway(r, x, z, rad = 0) {
  const ds = r.doorways;
  if (!ds) return false;
  for (let i = 0; i < ds.length; i++) {
    const dx = x - ds[i].x;
    const dz = z - ds[i].z;
    const rr = ds[i].r + rad;
    if (dx * dx + dz * dz < rr * rr) return true;
  }
  return false;
}

/**
 * How wide the through-route corridor is kept, measured from its centre line.
 *
 * The player capsule is 0.64 m across, so 0.85 m of half-width leaves about a
 * metre of slack for the fact that the corridor is a straight polyline and a
 * player is not — enough that you can walk it without scraping, and narrow
 * enough that a 6.7 m room still has both its long walls dressed.
 */
const ROUTE_R = 0.85;

/**
 * True where a collision-bearing prop would stand in the building's declared
 * through-route (see the long note in `buildInterior`). `r.route` is a list of
 * polylines in level space; this is the point/segment distance test against all
 * of them.
 */
function onRoute(r, x, z, pad = 0) {
  const lines = r.route;
  if (!lines) return false;
  // `pad` is the prop's own footprint radius, so what is being kept clear is
  // ROUTE_R to its FACE — which is what ROUTE_R's derivation above assumes.
  const rad = ROUTE_R + pad;
  const r2 = rad * rad;
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l];
    for (let i = 1; i < line.length; i++) {
      const ax = line[i - 1].x, az = line[i - 1].z;
      const bx = line[i].x, bz = line[i].z;
      const vx = bx - ax, vz = bz - az;
      const ll = vx * vx + vz * vz;
      let t = ll > 1e-9 ? ((x - ax) * vx + (z - az) * vz) / ll : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (ax + vx * t);
      const dz = z - (az + vz * t);
      if (dx * dx + dz * dz < r2) return true;
    }
  }
  return false;
}

/**
 * Anywhere a collision-bearing prop of footprint radius `rad` must not stand:
 * a doorway, a staircase, a cache, or the through-route.
 */
function blocksWay(r, x, z, rad = 0) {
  return inDoorway(r, x, z, rad) || onRoute(r, x, z, rad);
}

/**
 * WHERE THE SURPLUS GOES.
 *
 * Once clearance is measured against the real footprint, more pieces have to
 * move than before, and a few genuinely have nowhere near their authored spot
 * to go. Dropping those is the wrong answer twice over: it thins rooms the
 * player has objected to having thinned, and it hides the failure — a room that
 * quietly loses its wardrobe looks exactly like a room that never had one.
 *
 * So the last resort is a sweep of the whole rectangle for the legal spot
 * NEAREST the authored one. It draws no random numbers, so a piece finding its
 * home this way cannot shift the rest of the level's dice; and the count of
 * pieces that reach it, and of the few that still find nothing, is published on
 * the assembler (`A.furnishStats`) so it can be read rather than guessed at.
 */
const SWEEP = 0.3; // m between candidates; a quarter of the smallest room
/**
 * …AND IT ASKS TWICE, THE FIRST TIME WITH ITS ELBOWS OUT.
 *
 * "Nearest legal spot" left on its own hugs the boundary of whatever it was
 * pushed out of, because the nearest legal point to an illegal one is always
 * exactly on the edge of the keep-out. Displaced furniture then forms a shell
 * around every doorway, stair and cache — each piece legal, the wall they make
 * together not. Measured: with the sweep alone, E3's ground cache went from 8
 * standable ring points to 2 while every individual prop cleared its circle.
 * So the first pass asks for `BREATH` metres of daylight beyond the strict
 * clearance and only the second pass settles for the edge.
 */
const BREATH = 0.35;
function nearestLegal(r, x, z, x0, z0, x1, z1, rad) {
  if (x1 <= x0 || z1 <= z0) return null;
  const nx = Math.max(1, Math.ceil((x1 - x0) / SWEEP));
  const nz = Math.max(1, Math.ceil((z1 - z0) / SWEEP));
  for (let pass = 0; pass < 2; pass++) {
    const need = pass === 0 ? rad + BREATH : rad;
    let bx = 0, bz = 0, bd = Infinity;
    for (let iz = 0; iz <= nz; iz++) {
      const pz = z0 + ((z1 - z0) * iz) / nz;
      for (let ix = 0; ix <= nx; ix++) {
        const px = x0 + ((x1 - x0) * ix) / nx;
        const d = (px - x) * (px - x) + (pz - z) * (pz - z);
        if (d >= bd) continue;
        if (blocksWay(r, px, pz, need)) continue;
        bd = d; bx = px; bz = pz;
      }
    }
    if (bd < Infinity) return [bx, bz];
  }
  return null;
}

/**
 * Tally of what the furnishing pass had to do to keep a room legal.
 *
 * `quiet` is for a caller that ASKS MORE THAN ONCE — the ruin's rubble mound
 * tries three radii before it settles — so that one piece of furniture counts
 * once and the "homeless" figure means what it says.
 */
let quiet = false;
function tally(A, key) {
  if (quiet) return;
  const s = A.furnishStats ?? (A.furnishStats = { kept: 0, nudged: 0, moved: 0, homeless: 0 });
  s[key]++;
}

/** A spot for a collision-bearing prop, resampled off the doorways and route. */
function clearSpot(A, rng, r, x0, z0, x1, z1, rad = 0) {
  for (let i = 0; i < 8; i++) {
    const x = rng.range(x0, x1);
    const z = rng.range(z0, z1);
    if (!blocksWay(r, x, z, rad)) { tally(A, 'kept'); return [x, z]; }
  }
  // Eight misses does not mean the room is full — a random sample is a poor way
  // to find the corner of a room whose middle is corridor. Sweep it.
  const p = nearestLegal(r, (x0 + x1) / 2, (z0 + z1) / 2, x0, z0, x1, z1, rad);
  tally(A, p ? 'moved' : 'homeless');
  return p;
}

/**
 * Slide a fixed piece of furniture off the route without losing it.
 *
 * The alternative — dropping anything that lands in the corridor — empties the
 * rooms the corridor runs through, which is most of them. So try the authored
 * spot, then a ring of nearby ones, then the whole room.
 */
function shiftClear(A, r, x, z, x0, z0, x1, z1, rad = 0) {
  if (!blocksWay(r, x, z, rad)) { tally(A, 'kept'); return [x, z]; }
  for (let ring = 1; ring <= 4; ring++) {
    const step = ring * 0.55;
    // Daylight first, THEN the edge — but only within this ring, so a piece
    // still ends up as close to where it was authored as the room allows.
    for (let pass = 0; pass < 2; pass++) {
      const need = pass === 0 ? rad + BREATH : rad;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const px = x + Math.cos(a) * step;
        const pz = z + Math.sin(a) * step;
        if (px < x0 || px > x1 || pz < z0 || pz > z1) continue;
        if (!blocksWay(r, px, pz, need)) { tally(A, 'nudged'); return [px, pz]; }
      }
    }
  }
  const p = nearestLegal(r, x, z, x0, z0, x1, z1, rad);
  tally(A, p ? 'moved' : 'homeless');
  return p;
}

/**
 * The radius a crate STACK needs, which is not the radius of a crate.
 *
 * `stackCrates` picks a different crate for every course, scales it by up to
 * `STACK_SMAX` and jitters it `STACK_JIT` on both axes, so the pile's footprint
 * is the widest crate in that vocabulary at its widest scale, offset by the
 * corner of that jitter. Derived from the same three numbers the loop uses, so
 * the two cannot drift apart.
 */
const STACK_IDS = ['crate_a', 'crate_b', 'crate_c', 'crate_flat'];
const STACK_SMAX = 1.08;
const STACK_JIT = 0.12;
function stackR(A) {
  let m = 0;
  for (const id of STACK_IDS) m = Math.max(m, A.footprintR(id, STACK_SMAX));
  return m + STACK_JIT * Math.SQRT2;
}

/** The widest footprint among a set of ids one of which is about to be picked. */
function anyR(A, ids, s = 1) {
  let m = 0;
  for (const id of ids) m = Math.max(m, A.footprintR(id, s));
  return m;
}

/**
 * The longest run of a straight line of furniture that stays off the route.
 *
 * A counter is not a point and cannot be nudged aside — it runs the length of
 * the room. K1 is the case that forced this: a 5.4 m shed with a door at each
 * end and a 3.3 m counter straight across the middle of it, which is a wall.
 * Shortening it to the longest clear run keeps a counter in the shop and puts
 * the gap where the corridor needs it, which is also how a real stallholder
 * would arrange a room people walk through.
 *
 * Returns `[centre, length]` along the free axis, or null when nothing usable
 * survives. `pad` is the piece's own half-depth, so the clearance is measured
 * to its FACE and not to its centre line.
 */
function clearSpan(r, alongZ, fixed, a, b, pad, minLen) {
  // …and off the DOORWAYS, the stair runs and the caches, which this used to
  // skip entirely whenever a building declared no through-route: `!r.route`
  // returned the full span without asking `blocksWay` anything. A shop with no
  // authored corridor could therefore lay a 4.4 m counter straight across its
  // own front door, and half the shops on the map have no authored corridor.
  if (!r.route && !r.doorways) return [(a + b) / 2, b - a];
  const n = Math.max(8, Math.ceil((b - a) / 0.15));
  let bs = 0, be = -1, s = -1;
  for (let i = 0; i <= n; i++) {
    const t = a + ((b - a) * i) / n;
    const ok = !blocksWay(r, alongZ ? fixed : t, alongZ ? t : fixed, pad);
    if (ok) {
      if (s < 0) s = i;
      if (i - s > be - bs) { bs = s; be = i; }
    } else s = -1;
  }
  if (be <= bs) return null;
  const t0 = a + ((b - a) * bs) / n;
  const t1 = a + ((b - a) * be) / n;
  return t1 - t0 < minLen ? null : [(t0 + t1) / 2, t1 - t0];
}

/** Furnish one room. Rect is in level space; y is the floor surface. */
export function furnishRoom(A, rng, r) {
  const { kind, x0, z0, x1, z1, y, h } = r;
  const w = Math.abs(x1 - x0);
  const d = Math.abs(z1 - z0);
  if (w < 1.2 || d < 1.2) return;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const m = 0.45; // wall margin

  // floor dressing everybody gets: dust patches, plaster fall, litter
  const patches = rng.int(2, 4);
  for (let i = 0; i < patches; i++) {
    const g = patchGeometry(rng, rng.range(0.4, 1.1), { lobes: 8, wobble: 0.5 });
    A.addOnce(
      'dirt',
      g,
      LL(IDENT, rng.range(x0 + 0.3, x1 - 0.3), y + 0.012, rng.range(z0 + 0.3, z1 - 0.3), rng.float() * 6.28),
      { masks: [0.1, 0.8, 0.5] }
    );
  }
  for (let i = 0; i < rng.int(4, 9); i++) {
    A.put(
      'litter',
      rng.range(x0 + 0.2, x1 - 0.2),
      y + 0.015,
      rng.range(z0 + 0.2, z1 - 0.2),
      rng.float() * 6.28,
      rng.range(0.7, 1.3),
      [1, 1.3, 1]
    );
  }
  for (let i = 0; i < rng.int(2, 5); i++) {
    A.put(
      rng.pick(['brick_a', 'brick_b', 'rock_b']),
      rng.range(x0 + 0.25, x1 - 0.25),
      y + 0.04,
      rng.range(z0 + 0.25, z1 - 0.25),
      rng.float() * 6.28,
      rng.range(0.5, 1.0),
      [1, 1.4, 1]
    );
  }

  switch (kind) {
    case 'shop':
      furnishShop(A, rng, r, cx, cz, w, d, m);
      break;
    case 'living':
      furnishLiving(A, rng, r, cx, cz, w, d, m);
      break;
    case 'storage':
      furnishStorage(A, rng, r, cx, cz, w, d, m);
      break;
    case 'ruin':
      furnishRuin(A, rng, r, cx, cz, w, d, m);
      break;
    default:
      furnishStorage(A, rng, r, cx, cz, w, d, m);
      break;
  }

  // Everything above dresses the MIDDLE of the room. An interior camera is
  // almost always 2-3 m off a wall, so the walls and the wall/floor junction
  // are most of the frame and have to carry the shot on their own.
  dressWalls(A, rng, r);
  dressCeiling(A, rng, r);

  // hanging bulb, roughly central, offset so it isn't dead centre
  if (kind !== 'ruin' || rng.float() < 0.5) {
    hangingBulb(A, rng, cx + rng.range(-0.8, 0.8), y + h - 0.05, cz + rng.range(-0.8, 0.8), rng);
  }
}

/**
 * WALL DRESSING.
 *
 * Runs on every furnished room, along all four walls. A bare interior wall is
 * the single flattest thing a renderer can show you, and the interior shot
 * scored lowest of the eleven for exactly that reason: "zero props, bare stud
 * walls and empty boxes". Each wall gets, at random:
 *
 *   - a plank shelf on two brackets with goods on it
 *   - surface-run electrical conduit and a junction box (every building here
 *     is wired on the surface, and a 3 m vertical line breaks a flat panel
 *     better than any amount of noise)
 *   - something leaning against it at 8-12 degrees
 *   - a row of objects standing ON the floor AGAINST the skirting
 *   - a swept wedge of dust and plaster fall in the junction itself
 *
 * Everything is placed in contact: the leaning objects touch top and bottom,
 * the floor row sits at y, and the dust wedge is a flat patch straddling the
 * line, so nothing reads as a decal pasted onto a plane.
 */
function dressWalls(A, rng, r) {
  const { x0, z0, x1, z1, y, h, kind } = r;
  const sides = [
    { px: (x0 + x1) / 2, pz: z0, tx: 1, tz: 0, nx: 0, nz: 1, len: x1 - x0, yaw: 0 },
    { px: x1, pz: (z0 + z1) / 2, tx: 0, tz: 1, nx: -1, nz: 0, len: z1 - z0, yaw: Math.PI / 2 },
    { px: (x0 + x1) / 2, pz: z1, tx: 1, tz: 0, nx: 0, nz: -1, len: x1 - x0, yaw: 0 },
    { px: x0, pz: (z0 + z1) / 2, tx: 0, tz: -1, nx: 1, nz: 0, len: z1 - z0, yaw: Math.PI / 2 },
  ];

  const at = (s, t, off) => [s.px + s.tx * t + s.nx * off, s.pz + s.tz * t + s.nz * off];

  for (let side = 0; side < 4; side++) {
    const s = sides[side];
    if (s.len < 1.6) continue;
    const half = s.len / 2 - 0.35;
    /**
     * The building's street side is a shopfront: a 3 m hole, not a wall. Any
     * shelf, conduit run or leaning sheet placed on it hangs in mid-air across
     * the opening — which is exactly how it looked the first time round. That
     * face gets floor-level dressing only.
     */
    const isOpening = side === r.street;
    /**
     * ...but the piers each side of that opening are wall, and in the canonical
     * interior camera they are two thirds of the frame. So the opening face is
     * not skipped outright: everything above floor level is confined to the
     * outer 30% of its length, which is pier in every bay layout here.
     */
    const pierT = () =>
      (rng.float() < 0.5 ? -1 : 1) * rng.range(half * 0.62, half) ;
    const anyT = () => rng.range(-half, half);
    const wallT = isOpening ? pierT : anyT;

    // ---- surface conduit: two drops and a run under the ceiling ----------
    if (rng.float() < 0.8) {
      const pipe = A.cache('conduit', () => {
        const g = new THREE.CylinderGeometry(0.016, 0.016, 1, 6, 1);
        fillMasks(g, 0.35, 0.5, 0.1);
        return g;
      });
      const runY = y + h - rng.range(0.18, 0.4);
      const t0 = isOpening ? wallT() : rng.range(-half, 0);
      const t1 = isOpening
        ? t0 + Math.sign(-t0 || 1) * rng.range(0.3, 0.55)
        : t0 + rng.range(0.8, Math.max(1.0, half - t0));
      const [rx0, rz0] = at(s, (t0 + t1) / 2, 0.045);
      A.add(
        'metal_dark',
        pipe,
        LL(IDENT, rx0, runY, rz0, s.yaw, 1, Math.abs(t1 - t0), 1, 0, Math.PI / 2)
      );
      // the drop, plus the junction box it feeds
      const dropT = rng.float() < 0.5 ? t0 : t1;
      const boxY = y + rng.range(1.15, 1.55);
      const [dx, dz] = at(s, dropT, 0.045);
      A.add('metal_dark', pipe, LL(IDENT, dx, (runY + boxY) / 2, dz, 0, 1, runY - boxY, 1));
      A.add('metal_dark', BOX_FINE(A), LL(IDENT, ...insert(at(s, dropT, 0.055), boxY), s.yaw, 0.15, 0.19, 0.09), {
        masks: [0.55, 0.5, 0.2],
      });
      // and a stub of flex hanging out of it
      if (rng.float() < 0.5) {
        A.add(
          'metal_dark',
          pipe,
          LL(IDENT, ...insert(at(s, dropT + 0.06, 0.05), boxY - 0.28), 0, 0.4, 0.34, 0.4)
        );
      }
    }

    // ---- a plank shelf on two brackets, with goods --------------------------
    if (kind !== 'ruin' && rng.float() < 0.55) {
      const sy = y + rng.range(1.05, 1.65);
      const sLen = Math.min(rng.range(isOpening ? 0.6 : 0.9, isOpening ? 1.0 : 1.8), s.len - 0.6);
      const st = isOpening
        ? wallT()
        : rng.range(-half + sLen / 2, half - sLen / 2);
      const [sx, sz] = at(s, st, 0.15);
      A.add('wood_prop_dark', BOX(A), LL(IDENT, sx, sy, sz, s.yaw, sLen, 0.035, 0.28), {
        masks: [0.85, 0.5, 0.15],
      });
      for (const bt of [-1, 1]) {
        const [bx, bz] = at(s, st + bt * (sLen / 2 - 0.12), 0.1);
        A.add('metal_dark', BOX_FINE(A), LL(IDENT, bx, sy - 0.09, bz, s.yaw, 0.03, 0.16, 0.18), {
          masks: [0.6, 0.6, 0.3],
        });
      }
      for (let i = 0; i < rng.int(2, 5); i++) {
        const [gx, gz] = at(s, st + rng.range(-sLen / 2 + 0.12, sLen / 2 - 0.12), rng.range(0.11, 0.2));
        A.put(
          rng.pick(['bottle', 'can', 'box_card_b', 'bucket']),
          gx,
          sy + 0.02,
          gz,
          rng.float() * 6.28,
          rng.range(0.6, 0.95),
          [1, 1.1, 1]
        );
      }
    }

    // ---- something leaning on it -------------------------------------------
    if (!isOpening && rng.float() < 0.5) {
      const lean = rng.range(0.13, 0.22);
      const lt = rng.range(-half, half);
      const lh = rng.range(1.1, 1.8);
      const lw = rng.range(0.5, 1.0);
      const off = 0.06 + (Math.sin(lean) * lh) / 2;
      const [lx, lz] = at(s, lt, off);
      const key = rng.pick(['plywood', 'corrugated', 'wood_prop_dark']);
      // Tip the top INTO the wall. After the yaw the sheet's local -Z faces
      // the wall on sides 0/3 and its +Z on sides 1/2, so the sign of the
      // tilt has to follow the inward normal or the sheet leans out into the
      // room and floats at both ends.
      const leanSign = s.nz !== 0 ? -s.nz : -s.nx;
      A.add(
        key,
        BOX_THIN(A),
        LL(IDENT, lx, y + (Math.cos(lean) * lh) / 2, lz, s.yaw, lw, lh, 0.022, leanSign * lean, 0),
        { masks: [0.7, 0.55, 0.3] }
      );
    }

    /**
     * ---- objects standing against the skirting ---------------------------
     *
     * Three of these are SOLID (a crate, a cardboard box and a wooden drum —
     * see `collide` in props.js), and this loop drops them anywhere along any
     * wall of any room, which includes the 1.2 m of wall a doorway is cut out
     * of. `throughcheck` went from 21/21 exits to 17/21 on the strength of it:
     * the anchor cell just inside a door found itself in a three-cell pocket
     * with a drum across the threshold. Route them the way everything else in
     * this file that can seal a room is routed — with the drum's OWN radius,
     * which is 0.3 m and was tested as 0.4 m of pad on a point, so a drum whose
     * centre sat 1.2 m from a door anchor passed while its skin sat at 0.9.
     */
    const nBase = rng.int(2, 5);
    for (let i = 0; i < nBase; i++) {
      const bt = rng.range(-half, half);
      const [bx, bz] = at(s, bt, rng.range(0.18, 0.42));
      const id = rng.pick([
        'sandbag_a',
        'sandbag_b',
        'crate_b',
        'box_card_a',
        'box_card_b',
        'bucket',
        'jerry_can',
        'tyre_small',
        'barrel_wood',
      ]);
      const bry = rng.float() * 6.28;
      const bs = rng.range(0.8, 1.05);
      let px = bx, pz = bz;
      const br = A.footprintR(id, bs);
      if (br > 0) {
        const sp = shiftClear(A, r, bx, bz, x0 + 0.25, z0 + 0.25, x1 - 0.25, z1 - 0.25, br);
        if (!sp) continue;
        px = sp[0];
        pz = sp[1];
      }
      A.put(id, px, y + 0.01, pz, bry, bs, [1, 1.2, 1]);
    }

    // ---- swept dust and plaster fall in the junction ------------------------
    // A wall does not meet a floor on a line. Three flat lobes straddling the
    // join plus a handful of chips is the cheapest thing that grounds a room.
    const nWedge = Math.max(2, Math.round(s.len / 1.5));
    for (let i = 0; i < nWedge; i++) {
      const wt = ((i + rng.range(0.2, 0.8)) / nWedge - 0.5) * s.len;
      const [wx, wz] = at(s, wt, rng.range(0.05, 0.3));
      const g = patchGeometry(rng, rng.range(0.3, 0.75), { lobes: 9, wobble: 0.55 });
      A.addOnce('dirt', g, LL(IDENT, wx, y + 0.011, wz, rng.float() * 6.28, 1, 1, rng.range(0.35, 0.6)), {
        masks: [0.1, 0.85, 0.55],
      });
      if (rng.float() < 0.7) {
        const [cx2, cz2] = at(s, wt + rng.range(-0.3, 0.3), rng.range(0.06, 0.34));
        A.put(
          rng.pick(['brick_a', 'brick_b', 'rock_b', 'litter', 'litter']),
          cx2,
          y + 0.03,
          cz2,
          rng.float() * 6.28,
          rng.range(0.45, 0.9),
          [1, 1.4, 1]
        );
      }
    }

    // ---- a sack or a cloth hung on a nail ----------------------------------
    if (rng.float() < 0.45) {
      const ht = wallT();
      const [hx, hz] = at(s, ht, 0.05);
      const hy = y + rng.range(1.3, 1.85);
      const cl = clothGeometry(rng.range(0.45, 0.8), rng.range(0.6, 1.0), {
        segX: 6,
        segY: 7,
        sag: 0.1,
        wrinkle: 0.09,
        thickness: 0.003,
        fray: 0.014,
        rng,
      });
      A.addOnce(rng.pick(['fabric_red', 'fabric_teal', 'fabric_cream']), cl, LL(IDENT, hx, hy, hz, s.yaw), {
        masks: [0.35, 0.6, 0.3],
      });
      A.add('metal_dark', BOX_FINE(A), LL(IDENT, hx, hy + 0.34, hz, s.yaw, 0.02, 0.02, 0.05), {
        masks: [0.7, 0.5, 0],
      });
    }
  }
}

/** [x, z] + y -> the (x, y, z) argument triple LL wants. */
function insert(xz, y) {
  return [xz[0], y, xz[1]];
}

/**
 * Exposed structure overhead. A ceiling plane with nothing on it reads as the
 * inside of a box; joists, a conduit run and a hanging cable give the top of
 * the frame something to occlude and something for the bulb to rim-light.
 */
function dressCeiling(A, rng, r) {
  const { x0, z0, x1, z1, y, h } = r;
  const w = x1 - x0;
  const d = z1 - z0;
  if (h < 2.1 || w < 1.6 || d < 1.6) return;
  const alongX = w < d;
  const span = alongX ? w : d;
  const runLen = alongX ? d : w;
  const n = Math.max(2, Math.round(runLen / rng.range(0.75, 1.15)));
  for (let i = 1; i < n; i++) {
    const t = (i / n - 0.5) * runLen;
    const jx = alongX ? (x0 + x1) / 2 : (x0 + x1) / 2 + t;
    const jz = alongX ? (z0 + z1) / 2 + t : (z0 + z1) / 2;
    A.add(
      'wood_prop_dark',
      BOX(A),
      LL(
        IDENT,
        jx,
        y + h - 0.06,
        jz,
        alongX ? 0 : Math.PI / 2,
        span - 0.05,
        0.11,
        rng.range(0.055, 0.075)
      ),
      { masks: [0.35, 0.6, 0.45] }
    );
  }
}

/** Bare bulb on a twisted flex — the only light source in most of these rooms. */
export function hangingBulb(A, rng, x, yCeil, z, rngIn) {
  const drop = rng.range(0.35, 0.95);
  const wire = A.cache('bulbwire', () => {
    const g = new THREE.CylinderGeometry(0.006, 0.006, 1, 5, 1);
    fillMasks(g, 0.2, 0.4, 0);
    return g;
  });
  A.add('metal_dark', wire, LL(IDENT, x, yCeil - drop / 2, z, 0, 1, drop, 1));
  A.add('metal_dark', BOX_FINE(A), LL(IDENT, x, yCeil - 0.02, z, 0, 0.09, 0.04, 0.09), {
    masks: [0.5, 0.6, 0.3],
  });
  const bulb = A.cache('bulb', () => {
    const g = new THREE.SphereGeometry(0.045, 10, 7);
    g.scale(1, 1.25, 1);
    fillMasks(g, 0.1, 0.2, 0);
    return g;
  });
  A.add('emissive_warm', bulb, LL(IDENT, x, yCeil - drop - 0.05, z, 0, 1, 1, 1));
  A.add('metal_dark', BOX_FINE(A), LL(IDENT, x, yCeil - drop + 0.02, z, 0, 0.05, 0.06, 0.05), {
    masks: [0.6, 0.4, 0],
  });
  A.interiorLights?.push({ x, y: yCeil - drop - 0.05, z });
}

// ------------------------------------------------------------------- shop --
function furnishShop(A, rng, r, cx, cz, w, d, m) {
  const { x0, z0, x1, z1, y } = r;
  const frontZ = r.street === 0 ? -1 : r.street === 2 ? 1 : 0;
  // rug on the floor
  addRug(A, rng, cx + rng.range(-0.5, 0.5), y, cz + rng.range(-0.5, 0.5), rng.range(1.6, 2.4));

  /**
   * The counter runs PARALLEL to the shop's frontage, a metre inside it, the way
   * a real market shop is arranged: it fills the lower third of the view out of
   * the shop with goods instead of walling the opening off.
   */
  const alongZ = r.street === 1 || r.street === 3;
  // `ccFixed` is the offset from the frontage, on the axis the counter does NOT
  // run along; `ccFree` is where its centre sits on the axis it does.
  const ccFixed = alongZ
    ? r.street === 1 ? x1 - 1.3 : x0 + 1.3
    : frontZ ? cz - frontZ * (d * 0.5 - 1.3) : cz + d * 0.18;
  const ccFree = alongZ ? cz : cx;
  const wantLen = Math.min((alongZ ? d : w) - 1.4, 4.4);
  /**
   * How deep the counter is — the counter is the one solid in this file that is
   * built here rather than instanced from a prototype, so its extent has to be
   * named rather than asked for. Half of it is the clearance pad, because a
   * counter is measured to its FACE like everything else.
   */
  const CDEPTH = 0.74;
  // Clip the run to whatever the through-route leaves. Below 1.4 m it is a
  // table, not a counter, and the room is better off with the space.
  const span = clearSpan(
    r, alongZ, ccFixed, ccFree - wantLen / 2, ccFree + wantLen / 2, CDEPTH / 2, 1.4
  );
  const clen = span ? span[1] : 0;
  const ccx = alongZ ? ccFixed : span ? span[0] : cx;
  const ccz = alongZ ? (span ? span[0] : cz) : ccFixed;
  const cSX = alongZ ? CDEPTH : clen;
  const cSZ = alongZ ? clen : CDEPTH;
  if (span) {
    A.add('wood_prop_dark', BOX(A), LL(IDENT, ccx, y + 0.9, ccz, 0, cSX, 0.06, cSZ), {
      masks: [0.9, 0.4, 0.1],
    });
    A.add('wood_prop_dark', BOX(A), LL(IDENT, ccx + (alongZ ? -0.32 : 0), y + 0.45, ccz + (alongZ ? 0 : 0.32), 0, alongZ ? 0.09 : cSX, 0.9, alongZ ? cSZ : 0.09), {
      masks: [0.5, 0.6, 0.4],
    });
    A.add('wood_prop_dark', BOX(A), LL(IDENT, ccx, y + 0.28, ccz, 0, cSX - 0.2, 0.04, cSZ - 0.2), {
      masks: [0.4, 0.7, 0.5],
    });
    A.box('wood', ccx, y + 0.45, ccz, cSX, 0.9, cSZ);
    for (let i = 0; i < 6; i++) {
      const t = rng.range(-clen / 2 + 0.3, clen / 2 - 0.3);
      const px = ccx + (alongZ ? rng.range(-0.22, 0.22) : t);
      const pz = ccz + (alongZ ? t : rng.range(-0.22, 0.22));
      if (rng.float() < 0.45) {
        A.put('tray', px, y + 0.94, pz, rng.range(-0.4, 0.4) + (alongZ ? Math.PI / 2 : 0), 1, [1, 1.1, 1]);
        A.put('produce', px, y + 0.96, pz, rng.float() * 6.28, 1, [1, 1, 1]);
      } else {
        A.put(
          rng.pick(['box_card_a', 'box_card_b', 'crate_b', 'bottle', 'can', 'bucket']),
          px,
          y + 0.94,
          pz,
          rng.float() * 6.28,
          rng.range(0.6, 0.9),
          [1, 1.15, 1]
        );
      }
    }
    // sacks and trays stacked on the customer side of the counter
    const SACKS = ['sandbag_a', 'sandbag_b', 'tray', 'crate_b', 'crate_flat'];
    for (let i = 0; i < rng.int(3, 6); i++) {
      const t = rng.range(-clen / 2, clen / 2);
      const off = rng.range(0.55, 1.05);
      const px = ccx + (alongZ ? (r.street === 1 ? off : -off) : t);
      const pz = ccz + (alongZ ? t : frontZ ? frontZ * off : off);
      // A sack dropped on the customer side of a shortened counter can land in
      // the corridor the counter was shortened to make; nudge it back in. The
      // id is drawn BEFORE the spot so the spot is cleared for the thing that
      // is actually going in it — two of the five are crates.
      const sid = rng.pick(SACKS);
      const ss = rng.range(0.9, 1.05);
      const sp = shiftClear(A, r, px, pz, x0 + 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3,
        A.footprintR(sid, ss));
      if (!sp) continue;
      A.put(
        sid,
        sp[0],
        y + 0.02 + (i % 2) * 0.16,
        sp[1],
        rng.float() * 6.28,
        ss,
        [1, rng.range(1.0, 1.3), 1]
      );
    }
  }
  // Shelving against the side walls — but never against the shop's own
  // frontage, or it blockades the opening the street is seen through.
  for (const sx of [-1, 1]) {
    if ((r.street === 1 && sx > 0) || (r.street === 3 && sx < 0)) continue;
    const n = Math.max(1, Math.floor(d / 1.5) - 1);
    for (let i = 0; i < n; i++) {
      const sz = z0 + 0.8 + i * 1.35;
      if (sz > z1 - 0.7) break;
      if (rng.float() < 0.25) continue;
      // A shelf unit is solid now, and a run of them down the side wall of a
      // shop stands across whatever door that wall has. Same treatment as the
      // counter and the crate stack: it moves — and by its own 1.1 x 0.35 m
      // footprint, which is nearly three times the 0.4 m pad this used.
      const shx = cx + sx * (w / 2 - 0.22);
      const shScale = rng.range(0.92, 1.08);
      const shMask = rng.range(0.8, 1.4);
      const sh = shiftClear(A, r, shx, sz, x0 + 0.3, z0 + 0.4, x1 - 0.3, z1 - 0.4,
        A.footprintR('shelf', shScale));
      if (!sh) continue;
      A.put('shelf', sh[0], y, sh[1], sx > 0 ? -Math.PI / 2 : Math.PI / 2, shScale, [1, shMask, 1]);
      // goods on the shelves
      for (let k = 0; k < 3; k++) {
        A.put(
          rng.pick(['box_card_b', 'bottle', 'can']),
          sh[0] + rng.range(-0.1, 0.1),
          y + 0.25 + k * 0.55,
          sh[1] + rng.range(-0.35, 0.35),
          rng.float() * 6.28,
          rng.range(0.7, 1.1),
          [1, 1.2, 1]
        );
      }
    }
  }
  // crate stacks and sacks. The stack is the widest solid the shop dressing has
  // — see `stackR` — and it is the one piece that can seal a corridor on its
  // own, so it moves, by its real footprint and not by a 0.35 m pad.
  const cs = shiftClear(A, r, x0 + 0.7, z1 - 0.9, x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, stackR(A));
  if (cs) stackCrates(A, rng, cs[0], y, cs[1], rng.int(3, 6));
  else rng.int(3, 6);
  for (let i = 0; i < rng.int(3, 6); i++) {
    A.put(
      rng.pick(['sandbag_a', 'sandbag_b', 'sandbag_c']),
      rng.range(x0 + 0.4, x0 + 1.6),
      y + 0.02 + (i % 2) * 0.19,
      rng.range(z0 + 0.5, z0 + 2.0),
      rng.float() * 6.28,
      rng.range(0.9, 1.1),
      [1, 1.2, 1]
    );
  }
  // Solid since props.js declared it so, therefore routed like everything else
  // in here that can stand in a doorway.
  const bw = shiftClear(A, r, x1 - 0.6, z0 + 0.7, x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5,
    A.footprintR('barrel_wood'));
  const bwRy = rng.float() * 6.28;
  if (bw) A.put('barrel_wood', bw[0], y, bw[1], bwRy, 1, [1, 1.2, 1]);
  /**
   * Table and chair. The chair used to be nailed 0.7 m off the table with no
   * test of its own — it is solid to the seat, so a table that cleared a door
   * anchor by a metre could still put its chair inside one. Two pieces, two
   * footprints, two clearances; the chair keeps its offset when the offset is
   * legal, which is nearly always, so the pair still reads as a pair.
   */
  const tb = shiftClear(A, r, cx - w * 0.28, cz - d * 0.28, x0 + 0.7, z0 + 0.7, x1 - 0.7, z1 - 0.7,
    A.footprintR('table_small'));
  const tbRy = rng.range(-0.4, 0.4);
  const chRy = rng.range(2, 4);
  if (tb) {
    A.put('table_small', tb[0], y, tb[1], tbRy, 1, [1, 1, 1]);
    const ch = shiftClear(A, r, tb[0] + 0.7, tb[1] + d * 0.08,
      x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, A.footprintR('chair'));
    if (ch) A.put('chair', ch[0], y, ch[1], chRy, 1, [1, 1.2, 1]);
  }
}

// ----------------------------------------------------------------- living --
function furnishLiving(A, rng, r, cx, cz, w, d, m) {
  const { x0, z0, x1, z1, y, h } = r;
  addRug(A, rng, cx, y, cz, rng.range(2.0, 2.8));
  A.put('mattress', x0 + 1.1, y, z1 - 0.9, rng.range(-0.1, 0.1), 1, [1, 1.1, 1]);
  A.box('fabric', x0 + 1.1, y + 0.1, z1 - 0.9, 1.9, 0.2, 0.9);
  // blanket
  const bl = clothGeometry(1.5, 0.9, { segX: 7, segY: 6, sag: 0.05, wrinkle: 0.05, thickness: 0.0032, fray: 0.012, rng });
  A.addOnce('fabric_teal', bl, LL(IDENT, x0 + 1.2, y + 0.19, z1 - 1.0, 0, 1, 1, 1, -Math.PI / 2), {
    masks: [0.3, 0.5, 0.2],
  });
  // cushions
  for (let i = 0; i < 3; i++) {
    const g = chamferBox(0.42, 0.14, 0.42, 0.06);
    fillMasks(g, 0.2, 0.4, 0.2);
    A.addOnce(
      rng.pick(['fabric_red', 'fabric_teal', 'fabric_cream']),
      g,
      LL(IDENT, cx + rng.range(-1, 1), y + 0.07, cz + rng.range(-1, 1), rng.float() * 6.28)
    );
  }
  // The cabinet stands against the +X wall — which is exactly where a corridor
  // running along that wall would be, so it slides along the wall to clear it.
  const cab = shiftClear(A, r, x1 - 0.35, cz + rng.range(-0.6, 0.6),
    x1 - 0.55, z0 + 0.6, x1 - 0.3, z1 - 0.6, A.footprintR('cabinet'));
  if (cab) {
    A.put('cabinet', cab[0], y, cab[1], -Math.PI / 2, 1, [1, 1, 1]);
  }
  /**
   * The table and its two chairs.
   *
   * All three are solid now — that is the whole point of `collide` in props.js
   * — and a solid thing dropped at a fixed offset from the room centre is
   * exactly what `shiftClear` exists for: `throughcheck` went from 21/21 exits
   * to 17/21 the moment this furniture started existing to physics, because a
   * living room whose corridor runs down the middle had a chair standing in it.
   * Each piece is nudged off the route on its own, with ITS OWN FOOTPRINT as the
   * clearance — the 0.5 and 0.35 that used to be typed here were a guess at a
   * table's half-depth and a chair's, and both were under the real thing — and
   * the bottle and can follow the table rather than staying at coordinates the
   * table has left.
   */
  const tRy = rng.range(0, 0.4);
  const c1Ry = rng.range(1.5, 2.5);
  const c2Ry = rng.range(-1.5, -0.5);
  const tbl = shiftClear(A, r, cx + 0.4, cz - 0.8, x0 + 0.7, z0 + 0.7, x1 - 0.7, z1 - 0.7,
    A.footprintR('table_small'));
  if (tbl) {
    A.put('table_small', tbl[0], y, tbl[1], tRy, 1, [1, 1, 1]);
    // stuff on the small table
    A.put('bottle', tbl[0], y + 0.74, tbl[1], 0, 1, [1, 1, 1]);
    A.put('can', tbl[0] + 0.2, y + 0.74, tbl[1] + 0.1, 1, 1, [1, 1, 1]);
  }
  const chR = A.footprintR('chair');
  const ch1 = shiftClear(A, r, cx - 0.8, cz - 1.2, x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, chR);
  if (ch1) A.put('chair', ch1[0], y, ch1[1], c1Ry, 1, [1, 1.2, 1]);
  const ch2 = shiftClear(A, r, cx + 1.4, cz - 0.4, x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, chR);
  if (ch2) A.put('chair', ch2[0], y, ch2[1], c2Ry, 1, [1, 1.2, 1]);
  // wall-hung rug / poster
  const wall = clothGeometry(1.7, 1.1, { segX: 8, segY: 7, sag: 0.04, wrinkle: 0.05, thickness: 0.0036, fray: 0.02, bow: -1, rng });
  A.addOnce('fabric_red', wall, LL(IDENT, cx - 0.4, y + 1.65, z0 + 0.09, 0, 1, 1, 1), {
    masks: [0.3, 0.4, 0.2],
  });
  const lcs = shiftClear(A, r, x1 - 0.9, z0 + 0.8, x0 + 0.6, z0 + 0.6, x1 - 0.6, z1 - 0.6, stackR(A));
  if (lcs) stackCrates(A, rng, lcs[0], y, lcs[1], rng.int(1, 3));
}

// ---------------------------------------------------------------- storage --
function furnishStorage(A, rng, r, cx, cz, w, d, m) {
  const { x0, z0, x1, z1, y } = r;
  const spots = rng.int(4, 7);
  /** The goods on a pallet, and how far off its centre they are scattered. */
  const PAL_IDS = ['sandbag_a', 'sandbag_b', 'box_card_a'];
  const PAL_JX = 0.3, PAL_JZ = 0.25;
  const BARRELS = ['barrel_rust', 'barrel_blue', 'barrel_wood'];
  for (let i = 0; i < spots; i++) {
    /**
     * WHAT IS GOING HERE IS DECIDED BEFORE WHERE, because the where has to be
     * cleared for the thing that is actually going in it. This loop used to ask
     * `clearSpot` for a point with NO clearance at all and then drop a 1.1 m
     * shelf unit or a crate stack on it, which is the plainest instance of the
     * defect in the file: a shelf whose centre was 1.2 m from a stair's centre
     * line had 0.6 m of itself on the treads.
     */
    const pick = rng.float();
    let rad = 0;
    let barrel = null;
    if (pick < 0.35) rad = stackR(A);
    else if (pick < 0.55) rad = Math.hypot(PAL_JX, PAL_JZ) + anyR(A, PAL_IDS);
    else if (pick < 0.72) { barrel = rng.pick(BARRELS); rad = A.footprintR(barrel); }
    else if (pick < 0.85) rad = A.footprintR('tyre');   // 0: stepped over
    else rad = A.footprintR('shelf');
    const spot = clearSpot(A, rng, r, x0 + 0.6, z0 + 0.6, x1 - 0.6, z1 - 0.6, rad);
    if (!spot) continue;
    const [sx, sz] = spot;
    if (pick < 0.35) stackCrates(A, rng, sx, y, sz, rng.int(2, 5));
    else if (pick < 0.55) {
      A.put('pallet', sx, y + 0.01, sz, rng.float() * 6.28, 1, [1, 1.3, 1]);
      for (let k = 0; k < rng.int(1, 4); k++) {
        A.put(
          rng.pick(PAL_IDS),
          sx + rng.range(-PAL_JX, PAL_JX),
          y + 0.11 + k * 0.2,
          sz + rng.range(-PAL_JZ, PAL_JZ),
          rng.float() * 6.28,
          1,
          [1, 1.2, 1]
        );
      }
      A.box('wood', sx, y + 0.1, sz, 1.2, 0.2, 1.0);
    } else if (pick < 0.72) {
      A.put(barrel, sx, y, sz, rng.float() * 6.28, 1, [1, 1.2, 1]);
    } else if (pick < 0.85) {
      A.put('tyre', sx, y, sz, rng.float() * 6.28, 1, [1, 1.3, 1]);
      if (rng.float() < 0.6) {
        A.skirts = false;
        A.put('tyre', sx + 0.03, y + 0.19, sz + 0.02, rng.float() * 6.28, 1, [1, 1.3, 1]);
        A.skirts = true;
      }
    } else {
      A.put('shelf', sx, y, sz, rng.float() * 6.28, 1, [1, 1.2, 1]);
    }
  }
  for (let i = 0; i < rng.int(2, 5); i++) {
    A.put('plank_a', rng.range(x0 + 0.5, x1 - 0.5), y + 0.02, rng.range(z0 + 0.5, z1 - 0.5), rng.float() * 6.28, 1, [
      1, 1.3, 1,
    ]);
  }
  A.put('jerry_can', x1 - 0.5, y, z1 - 0.5, rng.float() * 6.28, 1, [1, 1.3, 1]);
  A.put('bucket', x0 + 0.5, y, z1 - 0.6, rng.float() * 6.28, 1, [1, 1.4, 1]);
}

// ------------------------------------------------------------------- ruin --
function furnishRuin(A, rng, r, cx, cz, w, d, m) {
  const { x0, z0, x1, z1, y } = r;
  /**
   * THE RUBBLE MOUND IS THE BIGGEST SOLID THIS FILE PLACES AND IT WAS THE ONLY
   * ONE PLACED BLIND.
   *
   * `rubbleMound` lays a collision box 1.5 r on each plan axis and 0.34 r tall
   * (@see kit.js) — at the authored 1.4-2.2 m radius that is a slab up to
   * 3.3 m across and 0.75 m high, which is well over the 0.42 m the controller
   * steps and therefore a wall to anything that measures standing room. It was
   * dropped within a metre of the room centre with no test of any kind: not the
   * doorways, not the stairs, not the caches, not the route.
   *
   * Measured: E3's ground-floor ammo cache scored 1-7 of its eight standing
   * spots depending only on where the dice put this one mound, and `floorcheck`
   * called it BURIED whenever that came out under three. It is the last of the
   * four "the centre cleared and the body did not" bugs in this pass and the
   * biggest body of the four.
   *
   * A ruin without rubble in it is not a ruin, so this SHRINKS before it moves
   * and moves before it gives up: the same heap, smaller, is still the thing the
   * room is for.
   */
  const mjx = rng.range(-1, 1);
  const mjz = rng.range(-1, 1);
  const mr0 = rng.range(1.4, 2.2);
  const FS = [1, 0.75, 0.55];
  let mr = mr0, mp = null, tried = 0;
  quiet = true;                  // the heap is one piece however often it asks
  for (; tried < FS.length; tried++) {
    mr = mr0 * FS[tried];
    mp = shiftClear(A, r, cx + mjx, cz + mjz, x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5,
      mr * 1.5 * Math.SQRT1_2);
    if (mp) break;
  }
  quiet = false;
  tally(A, !mp ? 'homeless' : tried === 0 ? 'kept' : 'moved');
  if (mp) rubbleMound(A, rng, mp[0], y, mp[1], mr, 22);
  for (let i = 0; i < rng.int(3, 6); i++) {
    A.put('slab_shard', rng.range(x0 + 0.5, x1 - 0.5), y + 0.05, rng.range(z0 + 0.5, z1 - 0.5), rng.float() * 6.28, 1, [
      1, 1.4, 1,
    ]);
  }
  for (let i = 0; i < rng.int(6, 12); i++) {
    A.put(
      rng.pick(['brick_a', 'brick_b', 'rock_a', 'rock_b']),
      rng.range(x0 + 0.3, x1 - 0.3),
      y + 0.06,
      rng.range(z0 + 0.3, z1 - 0.3),
      rng.float() * 6.28,
      rng.range(0.6, 1.3),
      [1, 1.5, 1]
    );
  }
  A.put('rebar', cx + rng.range(-1, 1), y + 0.06, cz + rng.range(-1, 1), rng.float() * 6.28, 1, [1, 1.4, 1]);
  for (let i = 0; i < 3; i++) {
    A.put('plank_b', rng.range(x0 + 0.4, x1 - 0.4), y + 0.03, rng.range(z0 + 0.4, z1 - 0.4), rng.float() * 6.28, 1, [
      1, 1.4, 1,
    ]);
  }
  // Solid, and dropped anywhere in the room — so route it, by its own extent.
  const rc = shiftClear(A, r, rng.range(x0 + 0.6, x1 - 0.6), rng.range(z0 + 0.6, z1 - 0.6),
                        x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, A.footprintR('chair'));
  const rcRy = rng.float() * 6.28;
  if (rc) A.put('chair', rc[0], y + 0.05, rc[1], rcRy, 1, [1, 1.5, 1]);
  // dust sheet snagged on the rubble
  const sheet = clothGeometry(1.4, 1.1, { segX: 7, segY: 7, sag: 0.24, wrinkle: 0.075, twist: 0.08, fray: 0.02, rng });
  A.addOnce(
    'fabric_cream',
    sheet,
    LL(IDENT, cx + rng.range(-1.5, 1.5), y + 0.55, cz + rng.range(-1.5, 1.5), rng.float() * 6.28, 1, 1, 1, -1.2),
    { masks: [0.4, 0.7, 0.3] }
  );
}

// ---------------------------------------------------------------- helpers --
function addRug(A, rng, x, y, z, size) {
  const g = clothGeometry(size, size * rng.range(0.55, 0.75), {
    segX: 8,
    segY: 6,
    sag: 0.0,
    wrinkle: 0.02,
    thickness: 0.0038,
    fray: 0.012,
    rng,
  });
  A.addOnce(
    rng.pick(['fabric_red', 'fabric_teal', 'fabric_cream']),
    g,
    LL(IDENT, x, y + 0.014, z, rng.range(-0.4, 0.4), 1, 1, 1, -Math.PI / 2),
    { masks: [0.45, 0.55, 0.25] }
  );
}

export function stackCrates(A, rng, x, y, z, n) {
  let cy = y;
  const wasSkirt = A.skirts;
  for (let i = 0; i < n; i++) {
    A.skirts = wasSkirt && i === 0;
    // The vocabulary, the scale range and the jitter are shared with `stackR`,
    // which is what tells the placement passes how wide the finished pile is.
    const id = rng.pick(STACK_IDS);
    const s = rng.range(2 - STACK_SMAX, STACK_SMAX);
    const hh = id === 'crate_c' ? 0.82 * 0.85 : id === 'crate_b' ? 0.48 * 0.85 : 0.62 * 0.85;
    A.put(
      id,
      x + rng.range(-STACK_JIT, STACK_JIT),
      cy,
      z + rng.range(-STACK_JIT, STACK_JIT),
      rng.range(-0.5, 0.5),
      s,
      [1, rng.range(0.7, 1.4), 1]
    );
    // (no A.box here any more: every crate carries its own proxy at its own
    //  jittered position and rotation — see `collide` in props.js. The single
    //  0.7 m column that used to stand in for the whole pile was both coarser
    //  and, on a shop floor, wider than the crates it represented.)
    cy += hh * s;
    if (rng.float() < 0.2) break;
  }
  A.skirts = wasSkirt;
  return cy;
}
