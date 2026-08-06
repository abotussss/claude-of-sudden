import * as THREE from 'three';
import { BOX, BOX_FINE, BOX_SOFT, BOX_THIN, IDENT, LL } from '../kit.js';
import { fbm3, polyPrism, rockGeometry, paintMasks } from '../util.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD — THE WORKS. Shared machinery for the plain's built structures.
 * ════════════════════════════════════════════════════════════════════════════
 * `plains.js` publishes the GROUND — the analytic height field, the pads, the
 * ridge and the fires. This file is the kit the three things standing ON it
 * (`plains-tower.js`, `plains-fort.js`, `plains-trench.js`) are made of, and it
 * exists for the same reason `kit.js` does: an octagonal revetment wall built
 * three slightly different ways in three files is three places for the batter,
 * the course height and the collision to disagree.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE EVERYTHING HERE IS SHAPED BY: `NavGrid` IS A HEIGHT FIELD
 * ────────────────────────────────────────────────────────────────────────────
 * `src/ai/nav.js` stores ONE walkable height per 0.8 m cell, found by dropping a
 * single ray from above the level. Measured on the town: 36 820 cells above
 * 2.5 m in 2 113 components, ZERO of them joined to the ground — every upper
 * storey and every roof on that map is walkable-but-unreachable, and it is not a
 * bug anybody can fix without replacing the search.
 *
 * So a multi-storey structure here is designed against it rather than around it:
 *
 *   1. NO TWO AI-WALKABLE SURFACES SHARE A PLAN CELL. The tower's decks are
 *      NESTED ANNULI — each level's deck is the top of the block below it, and
 *      the block above is set back off it — so a ray from the sky finds exactly
 *      one of them and finds it at the height a man standing there would be.
 *   2. LEVELS ARE JOINED BY RAMPS, NOT STAIRS. `maxStep` is 0.45 m across an
 *      0.8 m cell (gradient 0.5625) and the slope limit is 46°. Every ramp here
 *      is authored at `RAMP_GRADE` = 0.38, which clears both with margin and is
 *      also comfortably under the 0.42 m stance step height, so the capsule
 *      walks it rather than mantling it.
 *   3. ANYTHING UNDER A DECK IS PLAYER-ONLY UNLESS `world.interiorVolumes` SAYS
 *      OTHERWISE, and a volume may only be published where nothing above it is
 *      a surface the bots need — because the re-probe REPLACES the cell's floor.
 *      @see `NavGrid._carveInteriors`, and `interiorVolume()` below.
 */

/**
 * The gradient every ramp on this map is built to. @see the header.
 * 0.38 = 20.8°, `normal.y` 0.935 against a 0.695 limit, and 0.30 m of rise per
 * 0.8 m cell against a 0.45 m step.
 */
export const RAMP_GRADE = 0.38;

/** Landing length at the top and foot of every ramp, so the join is never a lip. */
const LANDING = 1.6;

// ───────────────────────────────────────────────────────────────── geometry ──
/**
 * A square of half-extent `r` with its four corners cut back by `cut`, as eight
 * [x, z] points. The chamfer faces are where this map's bastions, buttresses and
 * embrasure bays go: a fortification with square corners has four bearings it
 * cannot shoot along, which is the whole reason the shape was invented.
 */
export function octagon(r, cut) {
  return [
    [r - cut, -r], [r, -r + cut], [r, r - cut], [r - cut, r],
    [-r + cut, r], [-r, r - cut], [-r, -r + cut], [-r + cut, -r],
  ];
}

/** Centre of edge `i` of a polygon, and the outward unit normal there. */
export function edgeInfo(pts, i) {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  const mx = (a[0] + b[0]) / 2;
  const mz = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  // The trace is authored counter-clockwise in (x, z); the outward normal of a
  // CCW edge in a Y-up left-handed sense is (dz, -dx) normalised — checked
  // against the octagon above, where edge 0 runs +X and must point -Z.
  return { mx, mz, len, tx: dx / len, tz: dz / len, nx: dz / len, nz: -dx / len,
    yaw: Math.atan2(dx, dz) };
}

/**
 * A prism from a polygon, in LEVEL space, with a paint pass on it.
 *
 * This is the mass of every podium, rampart and bastion here. It carries its own
 * collision (`collideGeo`, the real triangles) rather than a box proxy, because
 * the top face of this prism IS the deck the bot height field samples and a box
 * proxy round an octagon would put 40 m² of invisible floor on each corner.
 *
 * `pts` is a trace in LEVEL (x, z); `y0`/`y1` are WORLD heights — i.e. the pad
 * datum is already in them. The plain's ground is 3.2 m up at the centre, so a
 * prism handed a local height sinks the whole structure by exactly that and the
 * ramps (which are authored in world y) then arrive at nothing.
 */
export function prism(A, key, pts, y0, y1, opts = {}) {
  /**
   * `util.polyPrism` takes a shape in (x, y), extrudes it along +Z and then
   * `rotateX(-PI/2)`, which maps (x, y, z) -> (x, z, -y): THE SHAPE'S SECOND
   * COORDINATE COMES OUT NEGATED. Handing it a trace authored in (x, z) — which
   * is what every other function in this kit speaks — therefore builds the
   * structure MIRRORED THROUGH THE ORIGIN, and at 32 m off centre that is a
   * podium standing on the capture point on the wrong side of the map. It cost
   * a boot and a nav probe to see, because the parts NOT built from a trace
   * (the ramps, the room, the furniture) were all in the right place.
   *
   * Negating z fixes the position and reverses the winding, so the point order
   * is reversed with it to keep the outward faces outward.
   */
  const flat = pts.map(([x, z]) => [x, -z]).reverse();
  const g = polyPrism(flat, y1 - y0);
  paintMasks(g, (x, y, z, nx, ny, nz, out) => {
    const up = ny > 0.7;
    const n = fbm3(x * 0.09 + 11.3, y * 0.11, z * 0.09, 3);
    const m = fbm3(x * 0.55, y * 0.6 + 4.1, z * 0.55, 2);
    // Shuttered concrete: horizontal lift lines every 1.2 m, and the pour under
    // each one is a slightly different mix. This is the detail layer that has to
    // survive at 0.5 m — a flat prism face is the failing case for this map.
    const lift = Math.abs((y % 1.2) - 0.6) / 0.6;
    out[0] = Math.min(1, (up ? 0.5 : 0.22) + n * 0.4 + (1 - lift) * 0.18);
    out[1] = Math.min(1, (up ? 0.3 : 0.42) + m * 0.36 + (1 - lift) * 0.2);
    out[2] = Math.min(1, (up ? 0.1 : 0.24) + (1 - Math.min(1, y / 2.2)) * 0.4 + n * 0.15);
  });
  const m = LL(IDENT, 0, y0, 0, 0, 1, 1, 1);
  A.add(key, g, m, opts.paint ? { paint: opts.paint } : null);
  /**
   * `clip` puts the mass on `LAYER.CLIP`: solid to the player and the bots,
   * INVISIBLE to the one downward ray the height field is built from. It is what
   * an OVERHANG has to be on this map. A cab corbelled 2 m out over its shaft is
   * the same object as the town's rooftop gangways — measured there, a 1.4 m
   * deck at roof height turned a 1.4 m strip of the connector under it into an
   * island at 6.5 m and deleted a rotation — and the fix is the same one
   * `links.js` uses rather than a smaller cab.
   */
  if (opts.clip) A.clipGeo(opts.surface ?? A.surfaceOf(key), g, m);
  else if (opts.collide !== false) A.collideGeo(opts.surface ?? A.surfaceOf(key), g, m);
  g.dispose();
}

/**
 * A course of masonry / shuttered concrete along one edge of a trace.
 *
 * `batter` is how far the wall leans back per metre of height — every revetment
 * on this map is battered, because a vertical face on a plain reads as a fence
 * and a battered one reads as something built to be shot at. The courses are
 * separate boxes with per-course jitter in height and setback, so the face has a
 * real horizontal shadow line every course rather than a texture of one.
 */
export function wallRun(A, rng, key, ax, az, bx, bz, opts = {}) {
  const y0 = opts.y0 ?? 0;
  const y1 = opts.y1 ?? 4;
  const t = opts.t ?? 0.9;
  const batter = opts.batter ?? 0.09;
  const nx = opts.nx ?? 0;
  const nz = opts.nz ?? 0;
  const courses = Math.max(2, Math.round((y1 - y0) / (opts.course ?? 0.62)));
  const ch = (y1 - y0) / courses;
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const cx = (ax + bx) / 2;
  const cz = (az + bz) / 2;
  const box = BOX(A);
  for (let i = 0; i < courses; i++) {
    const cy = y0 + (i + 0.5) * ch;
    const set = (cy - y0) * batter + rng.range(-0.012, 0.012);
    const jitter = rng.range(-0.02, 0.02);
    A.add(
      key, box,
      LL(IDENT, cx - nx * set, cy, cz - nz * set, yaw, t + jitter, ch - 0.02, len + (opts.overrun ?? 0)),
      { masks: [0.3 + rng.float() * 0.4, 0.25 + rng.float() * 0.45, 0.15 + (1 - i / courses) * 0.35] }
    );
  }
  // The coping: a wider, harder cap that throws the rain clear of the face and
  // is the line that actually reads at 150 m.
  if (opts.coping !== false) {
    A.add(
      opts.copingKey ?? 'concrete_dark', BOX_SOFT(A),
      LL(IDENT, cx - nx * (y1 - y0) * batter, y1 + 0.07, cz - nz * (y1 - y0) * batter,
        yaw, t + 0.22, 0.14, len),
      { masks: [0.7, 0.28, 0.05] }
    );
  }
  return { len, yaw, cx, cz };
}

/**
 * A RAMP, and it is the only way up anything on this map.
 *
 * Runs from `(x0, z0, y0)` to `(x1, z1, y1)`, `w` wide, as a wedge whose TOP FACE
 * is the walked surface and whose collision is that same surface — one statement,
 * so the bot height field and the capsule cannot disagree about where the slope
 * is. A flat landing of `LANDING` metres is laid at each end at the end's own
 * height, which is what stops the join reading as a 4 cm lip to the character
 * controller and as a step to `NavGrid`.
 *
 * Returns the run and the grade so the caller can assert on them.
 */
export function ramp(A, rng, key, x0, z0, y0, x1, z1, y1, w, opts = {}) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const run = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const rise = y1 - y0;
  const grade = rise / run;
  const pitch = Math.atan2(rise, run);
  const surface = opts.surface ?? A.surfaceOf(key);

  // The sloping deck: a thin slab tilted about its own long axis. `LL`'s `rx` is
  // applied inside the YXZ euler, i.e. after the yaw, so it tips the slab along
  // its local +Z — which is the direction the ramp runs.
  const th = opts.thickness ?? 0.36;
  const mid = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const slabLen = Math.hypot(run, rise);
  A.add(key, BOX(A), LL(IDENT, mid[0], mid[1] - th / 2, mid[2], yaw, w, th, slabLen, -pitch), {
    paint: (x, y, z, px, py, pz, out) => {
      const n = fbm3(x * 0.5, y * 0.5, z * 0.5, 2);
      // Cross-battens: a ramp a man walks up in the wet has grip on it, and the
      // batten shadow is what makes a 20° plane read as a ramp and not a chute.
      const s = Math.abs((((x * Math.sin(yaw) + z * Math.cos(yaw)) * 2.4) % 1) - 0.5);
      out[0] = Math.min(1, 0.35 + n * 0.4 + (py > 0.5 ? (1 - s) * 0.3 : 0));
      out[1] = Math.min(1, 0.3 + n * 0.45);
      out[2] = Math.min(1, 0.15 + n * 0.2);
    },
  });
  A.box(surface, mid[0], mid[1] - th / 2, mid[2], w, th, slabLen, yaw, -pitch);

  // The fill under it, so the ramp is an embankment and not a plank in the air.
  const steps = Math.max(3, Math.round(run / 1.5));
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const yTop = y0 + rise * ((t0 + t1) / 2) - th;
    const yBase = opts.baseY ?? Math.min(y0, y1) - 0.4;
    if (yTop <= yBase) continue;
    const px = x0 + dx * ((t0 + t1) / 2);
    const pz = z0 + dz * ((t0 + t1) / 2);
    A.add(
      opts.fillKey ?? key, BOX(A),
      LL(IDENT, px, (yBase + yTop) / 2, pz, yaw, w - 0.06, yTop - yBase, (run / steps) + 0.02),
      { masks: [0.2 + rng.float() * 0.3, 0.4 + rng.float() * 0.3, 0.35] }
    );
    A.box(surface, px, (yBase + yTop) / 2, pz, w - 0.06, yTop - yBase, run / steps, yaw);
  }

  // Kerbs down both sides: knee-high, so a man can be behind them and a vehicle
  // cannot come off the edge. Not tall enough to be a wall the height field
  // trips over (`_sealCrossings` measures 0.45 m; these are 0.34).
  if (opts.kerb !== false) {
    for (const s of [-1, 1]) {
      const kx = Math.cos(yaw) * s * (w / 2 - 0.09);
      const kz = -Math.sin(yaw) * s * (w / 2 - 0.09);
      A.add(
        opts.kerbKey ?? 'concrete_dark', BOX(A),
        LL(IDENT, mid[0] + kx, mid[1] + 0.15, mid[2] + kz, yaw, 0.2, 0.34, slabLen, -pitch),
        { masks: [0.65, 0.35, 0.1] }
      );
    }
  }

  // The landings. Flat, at the end's own height, overlapping the slope by a
  // little so there is never a cell between the two that is neither.
  for (const [lx, lz, ly, dir] of [[x0, z0, y0, -1], [x1, z1, y1, 1]]) {
    const ox = (dx / run) * dir * (LANDING / 2 - 0.15);
    const oz = (dz / run) * dir * (LANDING / 2 - 0.15);
    A.add(key, BOX(A), LL(IDENT, lx + ox, ly - th / 2, lz + oz, yaw, w, th, LANDING), {
      masks: [0.5, 0.35, 0.12],
    });
    A.box(surface, lx + ox, ly - th / 2, lz + oz, w, th, LANDING, yaw);
  }
  return { run, grade, yaw };
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * AN INTERIOR THE BOTS CAN ACTUALLY BE IN
 * ────────────────────────────────────────────────────────────────────────────
 * `world.interiorVolumes` is the ONE seam that gets a ground storey into the
 * height field, and it works by REPLACING the floor of every cell inside the
 * box. So it may only ever be published over a footprint whose sky-facing
 * surface is something no bot needs — which on this map means: under the
 * tower's SHAFT (whose roof is a player-only cab 26 m up), and under a gate
 * passage. Publishing one under a rampart would delete the rampart.
 *
 *   cx, cz   world-space centre of the OUTER footprint (walls included: the
 *            doorway a bot enters through is in the wall)
 *   c, s     cos/sin of the level yaw — 1 and 0 here, the plain is authored at
 *            the identity, but the field is part of the published contract
 *   floorY   the walking surface
 *   probeY   where the re-probe ray starts: above anything worth standing on,
 *            BELOW the head of the lowest doorway, far below the ceiling
 */
export function interiorVolume(id, cx, cz, hw, hd, floorY, ceilY) {
  return {
    building: id,
    cx, cz, c: 1, s: 0,
    hw, hd,
    floorY,
    probeY: Math.min(floorY + 1.56, ceilY - 0.44),
  };
}

// ───────────────────────────────────────────────────────────────── the ruin ──
/**
 * A RELAXED DEBRIS FIELD — the same idea as `demolition._debrisField`, at the
 * scale this map's structures are.
 *
 * A rubble pile you cannot cross is a wall in a different colour, and the whole
 * point of bringing the tower down is that its ground stops being a fortress and
 * starts being a slope. So the pile is a HEIGHT FIELD that is then RELAXED until
 * no two neighbouring cells differ by more than `STEP`, which is under
 * `NavGrid.maxStep` however the two lattices line up.
 */
const STEP = 0.36;

export function debrisField(rng, cx, cz, radius, peak, cell = 2.4) {
  const n = Math.ceil((radius * 2) / cell) + 1;
  const h = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = cx - radius + ix * cell;
      const z = cz - radius + iz * cell;
      const d = Math.hypot(x - cx, z - cz) / radius;
      if (d > 1) continue;
      const shape = Math.cos(d * Math.PI * 0.5) ** 1.6;
      h[iz * n + ix] = peak * shape * (0.45 + fbm3(x * 0.16, 3.7, z * 0.16, 3) * 1.1);
    }
  }
  // relax: nothing may stand more than STEP over its neighbour
  for (let pass = 0; pass < 26; pass++) {
    let moved = 0;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        for (let k = 0; k < 4; k++) {
          const jx = ix + (k === 0 ? 1 : k === 1 ? -1 : 0);
          const jz = iz + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
          const j = jz * n + jx;
          const d = h[i] - h[j];
          if (d > STEP) { h[i] = h[j] + STEP; moved++; }
        }
      }
    }
    if (!moved) break;
  }
  return {
    n, cell, x0: cx - radius, z0: cz - radius,
    at(x, z) {
      const fx = (x - this.x0) / cell;
      const fz = (z - this.z0) / cell;
      const ix = Math.max(0, Math.min(n - 1, Math.round(fx)));
      const iz = Math.max(0, Math.min(n - 1, Math.round(fz)));
      return h[iz * n + ix];
    },
    h,
  };
}

/**
 * Draw a debris field: broken masonry graded over the plan, with the mass in
 * chunks rather than in one mound, plus the dust that always survives a
 * collapse. The collision is one low box per cell, so the surface a man walks
 * on is the relaxed field and not the top of whichever chunk he is standing on.
 */
export function drawDebris(A, rng, field, groundY, opts = {}) {
  const key = opts.key ?? 'concrete';
  const surface = opts.surface ?? 'concrete';
  const { n, cell, x0, z0 } = field;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const hgt = field.h[iz * n + ix];
      if (hgt < 0.06) continue;
      const x = x0 + ix * cell;
      const z = z0 + iz * cell;
      const g = groundY(x, z);
      // the walked surface
      A.box(surface, x, g + hgt / 2, z, cell * 1.02, hgt, cell * 1.02);
      // …and the mass that makes it read as a building that fell over
      const count = Math.max(2, Math.round(hgt * 4));
      for (let i = 0; i < count; i++) {
        const s = rng.range(0.3, 1.15) * (0.5 + hgt * 0.5);
        const gg = rockGeometry(rng, s, 0, rng.range(0.4, 0.8));
        A.addOnce(
          rng.float() < 0.24 ? (opts.key2 ?? 'concrete_dark') : key, gg,
          LL(IDENT,
            x + rng.range(-cell * 0.6, cell * 0.6),
            g + rng.range(0, hgt) + s * 0.22,
            z + rng.range(-cell * 0.6, cell * 0.6),
            rng.float() * 6.28, 1, 1, 1, rng.range(-0.6, 0.6), rng.range(-0.6, 0.6)),
          { masks: [0.35 + rng.float() * 0.4, 0.55 + rng.float() * 0.4, 0.4] }
        );
      }
      // reinforcement, bent out of the slab that used to hold it
      if (rng.float() < 0.16) {
        A.add('metal_rust', BOX_THIN(A),
          LL(IDENT, x + rng.range(-1, 1), g + hgt + rng.range(0.1, 0.7), z + rng.range(-1, 1),
            rng.float() * 6.28, 0.035, rng.range(0.7, 2.2), 0.035,
            rng.range(-0.7, 0.7), rng.range(-0.7, 0.7)),
          { masks: [0.95, 0.7, 0] });
      }
    }
  }
}

/** A snapped structural member lying where it fell: mast, girder, roof beam. */
export function fallenMember(A, rng, key, x0, y0, z0, x1, y1, z1, w, opts = {}) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz);
  const yaw = Math.atan2(dx, dz);
  const pitch = -Math.atan2(dy, Math.hypot(dx, dz));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  A.add(key, BOX(A), LL(IDENT, cx, cy, cz, yaw, w, w, len, pitch), {
    masks: [0.8, 0.6, 0.2],
  });
  A.box(opts.surface ?? A.surfaceOf(key), cx, cy, cz, w, w, len, yaw, pitch);
  // lattice bracing along it, which is what a mast is actually made of
  const bays = Math.max(2, Math.round(len / 2.4));
  for (let i = 0; i < bays; i++) {
    const t = (i + 0.5) / bays;
    A.add(key, BOX_THIN(A),
      LL(IDENT, x0 + dx * t, y0 + dy * t, z0 + dz * t, yaw, w * 1.5, w * 0.22, w * 0.22, pitch),
      { masks: [0.85, 0.65, 0.1] });
  }
}

// ─────────────────────────────────────────────────────────────────── publish ──
/**
 * Turn a works record into the shape `world.demolitions` publishes and
 * `src/match` already consumes — the same fields `demolition.publishDemolitions`
 * fills, so a caller that can bring a town block down can bring these down too
 * without a second code path.
 *
 * WHAT IS SCOPED AND WHAT IS NOT is the design decision here. The town scopes
 * the WHOLE building because the whole building is in the way. These two are
 * not: the tower's podium and the fortress's curtain are the AI's walkable
 * ground, and re-baking a 46 m octagonal rampart into a ruin scope only to put
 * an identical one back would double the geometry to change nothing. So each
 * record scopes its SUPERSTRUCTURE — the part whose loss changes the skyline and
 * opens the position — and the ground under it survives.
 */
export function publishWorks(A, records, physics) {
  const out = [];
  for (const rec of records) {
    if (!rec.shell || !rec.ruin) {
      console.error(`[world] works ${rec.id}: shell or ruin scope missing — SKIPPED`);
      continue;
    }
    rec.position = new THREE.Vector3(rec.x, rec.baseY ?? 0, rec.z);
    rec.level = { x: rec.x, z: rec.z };
    rec.radius = rec.radius ?? 20;
    rec.halfW = rec.halfW ?? rec.radius;
    rec.halfD = rec.halfD ?? rec.radius;
    rec.navRect = {
      x0: rec.x - rec.radius, x1: rec.x + rec.radius,
      z0: rec.z - rec.radius, z1: rec.z + rec.radius,
    };
    rec.down = false;
    // @see publishDemolitions — the first hide is the expensive one, so it is
    // paid here at boot rather than on the frame the event fires.
    A.setScopeVisible(rec.shell, false);
    A.setScopeVisible(rec.shell, true);
    A.setScopeVisible(rec.ruin, false);
    A.setScopeSolid(rec.ruin, physics, false);
    rec.setVisual = (down) => {
      A.setScopeVisible(rec.shell, !down);
      A.setScopeVisible(rec.ruin, down);
    };
    rec.setCollision = (down) => {
      A.setScopeSolid(rec.shell, physics, !down);
      A.setScopeSolid(rec.ruin, physics, down);
    };
    rec.setDown = (down) => {
      rec.down = !!down;
      rec.setVisual(!!down);
      rec.setCollision(!!down);
    };
    out.push(rec);
  }
  if (out.length) {
    console.info(
      `[world] nachtfeld works: ${out.length} carry a destroyed state — ` +
      out.map((r) => `${r.id}(${(r.shell.tris / 1000).toFixed(1)}k->${(r.ruin.tris / 1000).toFixed(1)}k tris)`).join(' ')
    );
  }
  return out;
}

// ───────────────────────────────────────────────────────────────── fittings ──
/**
 * A caged ladder. Player-only vertical circulation, and it is the honest label
 * for it: nothing in `NavGrid` climbs a ladder, so this is a way UP for the man
 * at the keyboard and a piece of silhouette for everybody else.
 */
export function ladder(A, x, y0, y1, z, yaw = 0, opts = {}) {
  const key = opts.key ?? 'metal_rust';
  const bar = BOX_THIN(A);
  const w = opts.w ?? 0.46;
  for (const s of [-1, 1]) {
    A.add(key, bar, LL(IDENT, x + Math.cos(yaw) * s * w / 2, (y0 + y1) / 2, z - Math.sin(yaw) * s * w / 2,
      yaw, 0.05, y1 - y0, 0.05), { masks: [0.9, 0.6, 0] });
  }
  const rungs = Math.max(2, Math.round((y1 - y0) / 0.3));
  for (let i = 0; i < rungs; i++) {
    A.add(key, bar, LL(IDENT, x, y0 + (i + 0.5) * ((y1 - y0) / rungs), z, yaw, w, 0.03, 0.03),
      { masks: [0.95, 0.65, 0] });
  }
  if (opts.cage !== false && y1 - y0 > 3) {
    const hoops = Math.max(2, Math.round((y1 - y0 - 2.2) / 0.85));
    for (let i = 0; i < hoops; i++) {
      const hy = y0 + 2.2 + i * ((y1 - y0 - 2.4) / hoops);
      for (const [ox, oz, sx, sz] of [[0, -0.36, w + 0.3, 0.04], [-w / 2 - 0.15, -0.18, 0.04, 0.42], [w / 2 + 0.15, -0.18, 0.04, 0.42]]) {
        A.add(key, bar, LL(IDENT,
          x + Math.cos(yaw) * ox + Math.sin(yaw) * oz, hy,
          z - Math.sin(yaw) * ox + Math.cos(yaw) * oz, yaw, sx, 0.035, sz),
          { masks: [0.9, 0.7, 0.1] });
      }
    }
  }
}

/** A pipe handrail along an edge. `sides` in level space: [[x0,z0],[x1,z1]]. */
export function handrail(A, key, x0, z0, x1, z1, y, opts = {}) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const bar = BOX_THIN(A);
  const h = opts.h ?? 1.05;
  for (const ry of [h, h * 0.55]) {
    A.add(key, bar, LL(IDENT, (x0 + x1) / 2, y + ry, (z0 + z1) / 2, yaw, 0.05, 0.05, len),
      { masks: [0.85, 0.5, 0] });
  }
  const posts = Math.max(2, Math.round(len / 1.9));
  for (let i = 0; i <= posts; i++) {
    const t = i / posts;
    A.add(key, bar, LL(IDENT, x0 + dx * t, y + h / 2, z0 + dz * t, yaw, 0.055, h, 0.055),
      { masks: [0.9, 0.55, 0] });
  }
}

/**
 * A warning lamp: a small emissive body plus a REAL point light.
 *
 * The light count is the constrained resource on this map — Three bakes the
 * number of visible point lights into every material's program cache key, so one
 * crossing its cull radius recompiles every lit material in the scene. The
 * plain's five fires sit inside `LIGHT_SLOTS`; these are deliberately short
 * ranged so only the one you are standing under is ever live.
 */
export function practical(A, x, y, z, colour, intensity, range, opts = {}) {
  A.add(opts.key ?? 'ember', BOX_SOFT(A), LL(IDENT, x, y, z, 0, opts.s ?? 0.3, opts.s ?? 0.3, opts.s ?? 0.3));
  const l = new THREE.PointLight(colour, intensity, range, 2);
  l.position.set(x, y, z);
  l.castShadow = false;
  A.light(l, { range, priority: opts.priority ?? 2 });
  return l;
}

/** A steel-and-concrete embrasure: a firing slit cut back through a parapet. */
export function embrasure(A, x, y, z, yaw, w, h, t, opts = {}) {
  const key = opts.key ?? 'concrete';
  const box = BOX(A);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (ox, oy, oz) => [x + c * ox + s * oz, y + oy, z - s * ox + c * oz];
  // splayed cheeks — a slit with parallel sides has one field of fire
  for (const sgn of [-1, 1]) {
    const p = at(sgn * (w / 2 + 0.34), h / 2, 0);
    A.add(key, box, LL(IDENT, p[0], p[1], p[2], yaw + sgn * 0.22, 0.7, h, t), {
      masks: [0.45, 0.35, 0.3],
    });
    A.box(A.surfaceOf(key), p[0], p[1], p[2], 0.7, h, t, yaw + sgn * 0.22);
  }
  // the lintel over it and the sill under it
  const lp = at(0, h + 0.15, 0);
  A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, lp[0], lp[1], lp[2], yaw, w + 1.6, 0.3, t + 0.1), {
    masks: [0.6, 0.4, 0.15],
  });
  A.box('concrete', lp[0], lp[1], lp[2], w + 1.6, 0.3, t + 0.1, yaw);
  const sp = at(0, 0.16, 0.04);
  A.add('concrete_dark', BOX_FINE(A), LL(IDENT, sp[0], sp[1], sp[2], yaw, w + 0.9, 0.32, t + 0.16), {
    masks: [0.75, 0.5, 0.1],
  });
  A.box('concrete', sp[0], sp[1], sp[2], w + 0.9, 0.32, t + 0.16, yaw);
}
