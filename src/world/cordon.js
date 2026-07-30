import { BOX, BOX_SOFT, BOX_THIN, IDENT, LL, rubbleMound } from './kit.js';
import { Rng } from '../core/rng.js';
import { BUILDINGS, STREET, GATE } from './layout.js';
import { groundY, sandbagWall } from './dressing.js';

/**
 * WORLD — THE CORDON: the edge of the map, made out of masonry.
 *
 * WHY THIS FILE EXISTS. The player sent a screenshot of himself standing in a
 * flat empty sand field with the background blocks 130 m away:
 *
 *   "マップが未完成と言ってるのはこのエリアがあるから ここはなに？？？なぜ到達できるの？
 *    もしここを作らないのなら"
 *
 * `tools/boundcheck.mjs` was written to answer that and it agreed, in numbers:
 * flooding the real player capsule out of both spawns reached **14 659 m²** of
 * standable ground, of which **5 645 m² was bare `sand` further than 1.5 m from
 * anything the level had authored** — two fields of 2 907 and 2 738 m² wrapping
 * the whole map, reaching the compound wall 122 m from the middle. The map was
 * three lanes of fought-over ground inside a doughnut of nothing.
 *
 * AND IT WAS SIX HOLES, NOT A HOLE THE SIZE OF THE DOUGHNUT. The same tool
 * walks the flood's own path back out of the void and names the crossing it
 * came through, and there were exactly six, all of them at x ±10 — one metre
 * outside the street kerb, at the two ends of the mid street where the flanking
 * buildings stop:
 *
 *     [ 10,  68] 2228 cells    [-10, -73] 2191    [-10,  66] 2087
 *     [ 10, -70] 1528          [ 10, -85]  642    [ 10, -79]  144
 *
 * Both spawns sit at the end of a street whose buildings run out 3-6 m before
 * the map does, so the player simply walked round the end of the last block and
 * out into the dunes. Nothing was stopping him but distance.
 *
 * WHAT THIS BUILDS. A compound wall closing each of those six holes, tied into
 * the faces it meets so it reads as the wall of the yard behind the block rather
 * than as a barrier: both spawn streets become walled compounds (which is what
 * a spawn in this mode is), the pocket behind the gate arch is closed, and the
 * four 0.75 m slots between a background block and the block in front of it get
 * the party wall they always implied. Every run is 3.3-4.0 m tall — a metre and
 * a half over `MOVE.mantle.maxHeight` even standing on the rubble berm at its
 * foot — and nothing that can be mantled is placed within 1.4 m of it.
 *
 * WHERE IT IS *NOT*. Not in front of anything the player fights over: every run
 * is behind a spawn or between two blocks, so the play area is walled by the
 * same buildings it always was and no sightline in the level changes.
 *
 * DICE. This has its own fixed-seed stream on purpose. `buildPerimeter`,
 * `dressStreet` and the whole scatter share one `rng`, so drawing a single
 * number from it here would shift every prop, stain and pock placed afterwards
 * — the level would look different everywhere for a wall behind the spawn. Its
 * own stream costs nothing and cannot move anything else.
 */
const KEYS = ['plaster_sand', 'plaster_cream', 'concrete', 'plaster_blue'];

/** How far the wall's foot is buried, so a dune under it never shows a gap. */
const BURY = 1.3;

export function buildCordon(A) {
  const rng = new Rng(0x0c0d0a7);
  const runs = cordonRuns();
  for (const r of runs) wallRun(A, rng, r);
  return runs;
}

/**
 * The runs, DERIVED rather than typed.
 *
 * Everything here has to land exactly on a face that already exists — W5's north
 * elevation, the gate's north return, the kerb line — and those faces are in
 * ALREADY-SCALED level space (`layout.js` multiplies its plan by 1.5 at the
 * bottom of the file, and `buildPerimeter`'s barricade is placed off the scaled
 * `STREET.zMax`). Authoring 1.5x-able literals here would mean a second set of
 * numbers that has to be kept in step with the first by hand, which is the exact
 * mistake `KEEPOUT` made when the sites moved. So the runs are read off the
 * geometry they must meet.
 */
export function cordonRuns() {
  const byId = new Map(BUILDINGS.map((b) => [b.id, b]));
  const face = (id, side) => {
    const b = byId.get(id);
    if (!b) return 0;
    return side === 0 ? b.z - b.d / 2 : side === 1 ? b.x + b.w / 2
      : side === 2 ? b.z + b.d / 2 : b.x - b.w / 2;
  };
  /** The wall centreline: half a metre outside the kerb, i.e. flush with the
   *  building line the flanking blocks stand on. */
  const X = STREET.kerb + 0.4;
  /** The two street-end walls, just behind `buildPerimeter`'s barricades. */
  const zN = STREET.zMax + 3.7;
  const zS = STREET.zMin - 3.7;
  const gateN = GATE.z + GATE.depth / 2;
  const gateS = GATE.z - GATE.depth / 2;
  const runs = [];
  const run = (id, x0, z0, x1, z1, o = {}) => runs.push({ id, x0, z0, x1, z1, ...o });

  /**
   * ────────────────────────────────────────────────────────────────────────────
   * TWO OF THESE FOUR RUNS HAVE A GATE IN THEM NOW
   * ────────────────────────────────────────────────────────────────────────────
   * The compound wall behind each spawn used to be one unbroken run, because
   * there was nothing on the far side of it but dune. There is now: a capture
   * district west of the attack's compound and its point-image east of the
   * defence's (`THE MAP GROWS — PART 4` in layout.js), and a capture point whose
   * only way in is a 16 m throat 60 m up the map is a point nobody retakes.
   *
   * So each of those two runs is built in two pieces with a `GATE_W`-wide gap
   * between them, and the gap is a REAL hole in the boundary on purpose — it is
   * the district's second mouth, it is authored ground on both sides of it, and
   * it is the only opening in either compound that is not the street.
   *
   * The other two runs (`N east`, `S west`) are untouched: there is still nothing
   * behind them, and cutting a hole in a wall with dune on the far side is how
   * `boundcheck` went red for a fortnight.
   */
  const GATE_W = 7.5;
  /** `z0`/`z1` are the run's two ends and `gz` the middle of the opening, all in
   *  the same ALREADY-SCALED level space the rest of this function reads. */
  const gap = (id, sx, z0, z1, gz, o = {}) => {
    const half = GATE_W / 2;
    const near = Math.min(z0, z1);
    const far = Math.max(z0, z1);
    run(`${id} a`, sx * X, near, sx * X, gz - half, o);
    run(`${id} b`, sx * X, gz + half, sx * X, far, o);
    // the gate's own jambs: two piers standing where the wall stops, so the
    // opening reads as a way through rather than as a wall somebody forgot.
    for (const s of [-1, 1]) {
      run(`${id} jamb ${s}`, sx * X, gz + s * half, sx * X, gz + s * (half + 0.62), {
        t: 1.35, h: [4.1, 4.4], plain: true,
      });
    }
  };

  // ------------------------------------------- the attack spawn's compound --
  // W5 and E5 stop at z 66; the street runs on to 69 and the barricade stands at
  // 71.9. These two are the missing 6 m of building line either side of it.
  // The west one is gated into the north-west district at level z 75.
  gap('cordon N west', -1, face('W5', 2) - 0.3, zN, 75.0, { dress: 1 });
  run('cordon N east', X, face('E5', 2) - 0.3, X, zN, { dress: 1 });
  run('cordon N end', -X - 0.3, zN, X + 0.3, zN, { h: [3.5, 3.9] });

  // ------------------------------------------ the defence spawn's compound --
  run('cordon S west', -X, face('W4', 0) + 0.3, -X, gateN, { dress: 1 });
  // …and the east one is gated into the south-east district, ρ of the above.
  gap('cordon S east', 1, face('E4', 0) + 0.3, gateN, -77.0, { dress: 1 });
  // …and the pocket BEHIND the gate arch, which is 20 m of dressed road with
  // open dunes either side of it.
  run('cordon S west outer', -X, gateS, -X, zS, {});
  run('cordon S east outer', X, gateS, X, zS, {});
  run('cordon S end', -X - 0.3, zS, X + 0.3, zS, { h: [3.5, 3.9] });

  // --------------------------------------------------------- party walls --
  /**
   * THE FOUR SLOTS. A background block's inner face and the block in front of it
   * are 0.75 m apart at 1.5x — wider than the 0.64 m player capsule, so each one
   * is a 15 m corridor leading out of the lane and into the dunes behind the
   * row. Two blocks that close together in a real town share a party wall.
   */
  for (const [outer, inner, sx] of [['BW1', 'W5', -1], ['BE1', 'E5', 1], ['BW3', 'W4', -1], ['BE3', 'E4', 1]]) {
    const bo = byId.get(outer), bi = byId.get(inner);
    if (!bo || !bi) continue;
    const gx0 = sx < 0 ? face(outer, 1) : face(inner, 1);
    const gx1 = sx < 0 ? face(inner, 3) : face(outer, 3);
    const z0 = Math.max(bo.z - bo.d / 2, bi.z - bi.d / 2);
    const z1 = Math.min(bo.z + bo.d / 2, bi.z + bi.d / 2);
    if (z1 - z0 < 1) continue;
    const cx = (gx0 + gx1) / 2;
    run(`party wall ${outer}-${inner}`, cx, z0 - 0.4, cx, z1 + 0.4, {
      t: Math.abs(gx1 - gx0) + 0.5, h: [4.2, 4.6], plain: true,
    });
  }
  return runs;
}

/**
 * One run of compound wall.
 *
 * Built as discrete 2.2-3.0 m panels with their own heights, keys and grime
 * rather than one long box, with a coping course, a plinth, and a pilaster at
 * every other joint — a 90 m box of one material at one height is precisely the
 * "flat/untextured surface" the quality bar forbids, and it is also what makes a
 * boundary read as a boundary instead of as a wall somebody built.
 */
function wallRun(A, rng, r) {
  const dx = r.x1 - r.x0;
  const dz = r.z1 - r.z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.4) return;
  const ry = Math.atan2(dx, dz) - Math.PI / 2;
  const t = r.t ?? 0.55;
  const [hLo, hHi] = r.h ?? [3.3, 3.8];
  const n = Math.max(1, Math.round(len / 2.6));
  const seg = len / n;
  const ux = dx / len, uz = dz / len;
  /** Across the run, pointing at the play side (whichever side that is: the
   *  dressing is placed on both, since a wall between two blocks has no front). */
  const nxs = -uz, nzs = ux;

  for (let i = 0; i < n; i++) {
    const tc = (i + 0.5) * seg;
    const px = r.x0 + ux * tc;
    const pz = r.z0 + uz * tc;
    const h = rng.range(hLo, hHi);
    const g0 = groundY(px, pz) - BURY;
    const key = r.plain ? KEYS[0] : rng.pick(KEYS);
    // the panel itself
    A.add(key, BOX(A), LL(IDENT, px, (g0 + h) / 2, pz, ry, seg + 0.06, h - g0, t), {
      masks: [rng.range(0.35, 0.6), rng.range(0.55, 0.85), rng.range(0.3, 0.5)],
    });
    A.box('concrete', px, (g0 + h) / 2, pz, seg + 0.06, h - g0, t + 0.06, ry);
    // coping: proud on both faces, so the top edge casts a line down the wall
    A.add('concrete', BOX_SOFT(A), LL(IDENT, px, h + 0.07, pz, ry, seg + 0.16, 0.14, t + 0.2), {
      masks: [0.85, 0.4, 0.15],
    });
    // plinth course, catching the ground grime band
    A.add('concrete', BOX_SOFT(A), LL(IDENT, px, groundY(px, pz) + 0.17, pz, ry, seg + 0.1, 0.34, t + 0.14), {
      masks: [0.45, 0.9, 0.6],
    });
    /**
     * A sheet of corrugated iron screwed over a hole somebody knocked in the
     * wall. `corrugated` and not `metal_rust`: the first version of this used the
     * flat rust key on a plain box and the screenshot showed exactly what the
     * quality bar forbids — a pale untextured rectangle taped to the masonry. The
     * corrugated material carries the profile, and the four fixing washers give
     * it a reason to be flat against something.
     */
    if (!r.plain && rng.float() < 0.22) {
      const py = rng.range(1.0, h - 1.6);
      const s = rng.float() < 0.5 ? 1 : -1;
      const pw = seg * rng.range(0.45, 0.8);
      const ph = rng.range(0.9, 1.5);
      const ox = nxs * s * (t / 2 + 0.035);
      const oz = nzs * s * (t / 2 + 0.035);
      A.add('corrugated', BOX_THIN(A), LL(IDENT, px + ox, py + 0.6, pz + oz, ry, pw, ph, 0.05), {
        masks: [0.8, rng.range(0.45, 0.85), 0.2],
      });
      for (const cx of [-0.42, 0.42]) {
        for (const cy of [-0.4, 0.4]) {
          A.add('steel', BOX_THIN(A), LL(IDENT, px + ox * 1.4 + nxs * 0 + ux * cx * pw, py + 0.6 + cy * ph, pz + oz * 1.4 + uz * cx * pw, ry, 0.07, 0.07, 0.03), {
            masks: [0.95, 0.4, 0],
          });
        }
      }
    }
    // pilaster at every other joint
    if (i % 2 === 1 || n === 1) {
      const jx = r.x0 + ux * (i * seg);
      const jz = r.z0 + uz * (i * seg);
      const ph = h + rng.range(0.1, 0.3);
      A.add('concrete', BOX(A), LL(IDENT, jx, (g0 + ph) / 2, jz, ry, 0.62, ph - g0, t + 0.26), {
        masks: [0.55, rng.range(0.4, 0.7), 0.35],
      });
      A.box('concrete', jx, (g0 + ph) / 2, jz, 0.62, ph - g0, t + 0.3, ry);
      A.add('concrete', BOX_SOFT(A), LL(IDENT, jx, ph + 0.09, jz, ry, 0.78, 0.18, t + 0.42), {
        masks: [0.9, 0.35, 0.1],
      });
    }
  }

  // ---------------------------------------------------------- razor wire --
  /**
   * Three strands on brackets along the top. It is the cue that says the wall is
   * the edge and not scenery, and — since it stands 0.4 m over the coping — it
   * is also the thing that keeps the silhouette from being a ruled line.
   */
  if (!r.plain) {
    const nb = Math.max(2, Math.round(len / 3.2));
    for (let i = 0; i <= nb; i++) {
      const tc = (i / nb) * len;
      const px = r.x0 + ux * tc;
      const pz = r.z0 + uz * tc;
      const h = (hLo + hHi) / 2;
      A.add('metal_rust', BOX_THIN(A), LL(IDENT, px, h + 0.42, pz, ry, 0.05, 0.72, 0.05, 0.0, rng.range(-0.12, 0.12)), {
        masks: [0.95, 0.5, 0],
      });
    }
    for (let s = 0; s < 3; s++) {
      const y = (hLo + hHi) / 2 + 0.28 + s * 0.22;
      A.add('metal_rust', BOX_THIN(A), LL(IDENT, (r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2, ry, len, 0.035, 0.035), {
        masks: [0.95, 0.55, 0],
      });
    }
  }

  // ------------------------------------------------------ the play side --
  /**
   * Nobody walls a street off and leaves the ground in front of it swept: there
   * is a berm of the rubble that came out of the demolition, the barriers that
   * went in first, and the tyres and drums that got stacked against it after.
   *
   * NOTHING HERE MAY BE A LADDER. Everything is under 1.25 m and stands at least
   * 1.4 m clear of the face, so even standing on top of it the coping is over
   * `MOVE.mantle.maxHeight` (1.85) away. `boundcheck` is the gate on that claim
   * and it walks the real mantle move, so a berm that grew into a route would
   * show up as the map leaking again.
   */
  if (!r.dress) return;
  const nd = Math.max(1, Math.round(len / 7));
  for (let i = 0; i < nd; i++) {
    const tc = ((i + 0.5) / nd) * len;
    const s = rng.float() < 0.5 ? 1 : -1;
    const off = rng.range(1.55, 2.6);
    const px = r.x0 + ux * tc + nxs * s * off;
    const pz = r.z0 + uz * tc + nzs * s * off;
    // never dress out into the street the spawn stands in
    if (Math.abs(px) < STREET.kerb + 0.2) continue;
    const kind = rng.float();
    if (kind < 0.45) {
      rubbleMound(A, rng, px, groundY(px, pz), pz, rng.range(0.9, 1.35), rng.int(14, 24), { key: 'concrete' });
    } else if (kind < 0.7) {
      sandbagWall(A, rng, px, pz, ry + rng.range(-0.1, 0.1), rng.range(1.8, 2.6), 3);
    } else {
      A.put('jersey', px, groundY(px, pz), pz, ry + rng.range(-0.08, 0.08), 1, [1, rng.range(0.9, 1.2), 1]);
      A.box('concrete', px, groundY(px, pz) + 0.46, pz, 0.62, 0.92, 1.9, ry);
      if (rng.float() < 0.5) {
        A.put(rng.pick(['tyre', 'barrel_rust', 'crate_c']), px + nxs * s * 1.1, groundY(px, pz), pz + nzs * s * 1.1,
          rng.float() * 6.28, 1, [1, rng.range(1.0, 1.3), 1]);
      }
    }
    // litter blown up against the foot of the wall
    for (let j = 0; j < rng.int(3, 7); j++) {
      const lx = r.x0 + ux * (tc + rng.range(-2.5, 2.5)) + nxs * s * rng.range(0.35, 1.3);
      const lz = r.z0 + uz * (tc + rng.range(-2.5, 2.5)) + nzs * s * rng.range(0.35, 1.3);
      A.put(rng.pick(['brick_a', 'brick_b', 'rock_b', 'litter', 'cinder', 'weeds', 'plank_b', 'can']),
        lx, groundY(lx, lz) + 0.02, lz, rng.float() * 6.28, rng.range(0.6, 1.2), [1, 1.3, 1]);
    }
  }
}
