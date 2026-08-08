import { BOX, BOX_FINE, BOX_SOFT, BOX_THIN, PANE, IDENT, LL } from '../kit.js';
import { fbm3 } from '../util.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD — FIELDWORKS. What a position that is being FOUGHT OVER looks like.
 * ════════════════════════════════════════════════════════════════════════════
 * 「要塞もっと軍事要塞にしろよ 物資豊富にしろ」
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE FORTRESS WAS EXCELLENT MASONRY AND THAT IS THE WHOLE PROBLEM
 * ────────────────────────────────────────────────────────────────────────────
 * `plains-fort.js` builds a *trace italienne*: an octagonal enceinte with four
 * bastions, a battered revetment, crenellated parapets, corbelled machicolation
 * and segmental gate arches. Every part of it is doing a job and the vocabulary
 * is entirely seventeenth century. Nothing in it says a war is happening NOW —
 * it says a war happened three hundred years ago and the building survived it.
 *
 * A modern fought-over position is legible from two hundred metres by things
 * that are not masonry at all, and this file is those things:
 *
 *   OUTSIDE THE WALL     wire, dragon's teeth, a boom and a sentry box at each
 *                        road. Obstacles are what turn a wall into a POSITION:
 *                        they say where you may not go, which is the same as
 *                        saying where the fire is laid.
 *   ON THE WALL          gabion revetment, a searchlight, an antenna array.
 *   INSIDE THE WALL      a supply dump under camouflage netting, a bunded fuel
 *                        store, a mortar pit, a field aid post, and the cable
 *                        on stakes that ties them together.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT AN OBSTACLE MAY AND MAY NOT DO TO `NavGrid`
 * ────────────────────────────────────────────────────────────────────────────
 * Wire and teeth are SOLID, deliberately — an obstacle that a man walks through
 * is a decal. But `NavGrid` is a height field with `maxStep` 0.45 m, so every
 * solid thing here is either well OVER that (wire at 1.0 m, teeth at 1.05 m:
 * unambiguously a wall, and the cells behind them simply close) or well UNDER
 * it (cable stakes at 0.3, bund kerbs at 0.34: ground). NOTHING is left in the
 * 0.42–0.68 m band, which is the band 「石ころオブジェが移動の妨げです、ジャンプ
 * しないと乗り越えられない」 is about — a thing tall enough to stop a walking man
 * and short enough that he cannot see why.
 *
 * And no belt of anything here crosses a route. The two gate roads, the four
 * corners where a flat curtain meets a bastion, and every metre of the courtyard
 * a ramp or a doorway opens onto are left clear, and the component counts either
 * side of this pass are in the commit.
 *
 * Everything is procedural, drawn from the caller's `rng`, and merged into the
 * shared static batches by key — no assets, no per-frame allocation, nothing to
 * dispose that `Assembler.finalize` does not already own.
 */

/**
 * ────────────────────────────────────────────────────────────────────────────
 * CONCERTINA WIRE — the single most legible thing on a modern battlefield
 * ────────────────────────────────────────────────────────────────────────────
 * Angle-iron pickets driven at 2.4 m, a coil slung between them, and the
 * diagonal stay wires that stop the whole belt being pushed flat. The coil is
 * built as a helix of short bars rather than a tube, because at night the read
 * is the SPECULAR GLINT off two hundred separate little pieces of steel — a
 * smooth cylinder catches one highlight and looks like a pipe.
 *
 * `A.box` proxies are one per bay rather than one per coil segment: the belt
 * has to stop a man, and 200 proxies to do what 8 can do is a bill the physics
 * broadphase pays every frame for nothing.
 */
export function wireBelt(A, rng, x0, z0, x1, z1, yFn, opts = {}) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1) return;
  const ux = dx / len;
  const uz = dz / len;
  const yaw = Math.atan2(dx, dz);
  const h = opts.h ?? 1.0;
  const bays = Math.max(1, Math.round(len / 2.4));
  const bay = len / bays;
  const thin = BOX_THIN(A);

  for (let b = 0; b <= bays; b++) {
    const t = b / bays;
    const px = x0 + dx * t;
    const pz = z0 + dz * t;
    const gy = yFn(px, pz);
    // the picket: an angle iron, leaning a little, with the earth heaped at it
    const lean = rng.range(-0.07, 0.07);
    A.add('metal_rust', thin, LL(IDENT, px, gy + h / 2, pz, yaw + rng.range(-0.2, 0.2),
      0.075, h + 0.24, 0.075, lean, rng.range(-0.05, 0.05)), { masks: [0.9, 0.6 + rng.float() * 0.3, 0.05] });
    // the two stays, one each way along the belt
    for (const s of [-1, 1]) {
      if (b + s < 0 || b + s > bays) continue;
      A.add('metal_rust', thin, LL(IDENT,
        px + ux * s * 0.55, gy + 0.3, pz + uz * s * 0.55, yaw, 0.03, 0.03, 1.3, 0, 0),
        { masks: [0.95, 0.7, 0] });
    }
    if (b < bays) {
      // the coil between this picket and the next: a helix of short chords
      const turns = Math.max(5, Math.round(bay / 0.34));
      for (let k = 0; k < turns; k++) {
        const u = (k + 0.5) / turns;
        const a = u * Math.PI * 2 * 3.1 + b * 1.7;
        const rr = (h * 0.42) * (0.82 + 0.18 * Math.sin(u * Math.PI));
        const cx = px + ux * bay * u + Math.cos(yaw) * Math.cos(a) * rr * 0.5;
        const cz = pz + uz * bay * u - Math.sin(yaw) * Math.cos(a) * rr * 0.5;
        const cy = gy + h * 0.52 + Math.sin(a) * rr;
        A.add('steel', thin, LL(IDENT, cx, cy, cz, yaw + rng.range(-0.25, 0.25),
          0.022, 0.022, 0.34, a * 0.5, rng.range(-0.4, 0.4)), { masks: [0.85, 0.35 + rng.float() * 0.4, 0] });
        // the barbs, every third chord — this is the detail that has to survive
        // at half a metre, and it is why the coil is not a cylinder
        if (k % 3 === 0) {
          A.add('steel', BOX_FINE(A), LL(IDENT, cx, cy, cz, yaw, 0.1, 0.014, 0.014, a, 0.8),
            { masks: [0.9, 0.3, 0] });
        }
      }
      /**
       * ONE PROXY PER BAY. The top is `h` over the ground at the bay's own
       * middle, which is 1.0 m — more than twice `maxStep`, so `NavGrid` shuts
       * the cells behind it cleanly rather than leaving a lattice of half-steps
       * a bot can catch on.
       */
      const mx = px + ux * bay * 0.5;
      const mz = pz + uz * bay * 0.5;
      const my = yFn(mx, mz);
      A.box('metal', mx, my + h / 2, mz, opts.t ?? 0.85, h, bay, yaw);
    }
  }
}

/**
 * DRAGON'S TEETH. Staggered rows of cast pyramids on a common raft, which is
 * how they are actually built — individually they are shoved aside, and the
 * raft is the obstacle. 1.05 m proud, so a wall rather than a trip.
 */
export function dragonTeeth(A, rng, cx, cz, yaw, rows, cols, yFn, opts = {}) {
  const pitch = opts.pitch ?? 1.55;
  const box = BOX(A);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      // staggered: every second row offset half a pitch, which is what makes a
      // field of these impassable instead of a set of gates
      const lx = (k - (cols - 1) / 2) * pitch + (r % 2 ? pitch / 2 : 0);
      const lz = (r - (rows - 1) / 2) * pitch * 0.86;
      const px = cx + c * lx + s * lz;
      const pz = cz - s * lx + c * lz;
      const gy = yFn(px, pz);
      const hh = rng.range(0.86, 1.12);
      // the raft it is cast on — 0.16 m, ground rather than obstacle
      A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, px, gy + 0.08, pz, yaw, 1.3, 0.16, 1.3),
        { masks: [0.75, 0.45, 0.2] });
      // three stacked blocks tapering to the point: a cast tooth, weathered
      for (let i = 0; i < 3; i++) {
        const u = i / 3;
        const w = 0.95 * (1 - u * 0.62);
        A.add('concrete', box, LL(IDENT, px + rng.range(-0.02, 0.02), gy + 0.14 + hh * (u + 1 / 6),
          pz + rng.range(-0.02, 0.02), yaw + rng.range(-0.09, 0.09), w, hh / 3, w),
          { masks: [0.3 + rng.float() * 0.45, 0.35 + rng.float() * 0.4, 0.15 + u * 0.3] });
      }
      A.box('concrete', px, gy + 0.14 + hh / 2, pz, 0.95, hh, 0.95, yaw);
      // reinforcement standing out of a chipped apex, on about a third of them
      if (rng.float() < 0.34) {
        A.add('metal_rust', BOX_THIN(A), LL(IDENT, px, gy + hh + rng.range(0.1, 0.34), pz,
          rng.float() * 6.28, 0.03, rng.range(0.2, 0.6), 0.03, rng.range(-0.5, 0.5), rng.range(-0.5, 0.5)),
          { masks: [0.95, 0.75, 0] });
      }
    }
  }
}

/**
 * GABION REVETMENT — the wire-basket bastion. A modern position is built out of
 * these and nothing else says "this year" more plainly, because the thing they
 * replaced is the sandbag and everything around them here is masonry.
 *
 * Each basket is a mesh cage (four wire faces, drawn as a lattice) packed with
 * graded fill that stands slightly proud of the top. Stacked in courses with
 * the upper course set back, which is how they are laid.
 */
export function gabionRun(A, rng, x0, z0, x1, z1, yFn, opts = {}) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.8) return;
  const yaw = Math.atan2(dx, dz);
  const cell = opts.cell ?? 1.05;
  const n = Math.max(1, Math.round(len / cell));
  const courses = opts.courses ?? 2;
  const thin = BOX_THIN(A);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const px = x0 + dx * t;
    const pz = z0 + dz * t;
    const gy = yFn(px, pz);
    for (let c = 0; c < courses; c++) {
      const set = c * 0.11;
      const w = cell - 0.04 - set * 2;
      const cy = gy + 0.02 + c * (cell - 0.03) + (cell - 0.03) / 2;
      // the fill: graded rubble, which is what a gabion actually is
      A.add('concrete_prop', BOX(A), LL(IDENT, px, cy, pz, yaw, w, cell - 0.06, (len / n) - 0.04), {
        paint: (qx, qy, qz, nx, ny, nz, out) => {
          const f = fbm3(qx * 2.6, qy * 2.6, qz * 2.6, 3);
          const g = fbm3(qx * 8.5, qy * 8.5, qz * 8.5, 2);
          out[0] = Math.min(1, 0.25 + f * 0.6 + g * 0.15);
          out[1] = Math.min(1, 0.45 + g * 0.5);
          out[2] = Math.min(1, 0.3 + f * 0.35);
        },
      });
      // the cage: verticals and horizontals of galvanised mesh
      for (let k = 0; k < 4; k++) {
        const u = -0.5 + (k + 0.5) / 4;
        A.add('steel', thin, LL(IDENT, px + Math.cos(yaw) * u * (w + 0.05), cy, pz - Math.sin(yaw) * u * (w + 0.05),
          yaw, 0.02, cell - 0.05, cell), { masks: [0.75, 0.3, 0] });
      }
      for (const hu of [-0.36, 0, 0.36]) {
        A.add('steel', thin, LL(IDENT, px, cy + hu * cell, pz, yaw, w + 0.06, 0.02, cell + 0.02),
          { masks: [0.75, 0.3, 0] });
      }
      // the corner ties, twisted wire — the half-metre detail
      if (rng.float() < 0.6) {
        A.add('steel', BOX_FINE(A), LL(IDENT,
          px + Math.cos(yaw) * (w / 2) * rng.range(-1, 1), cy + (cell / 2) * 0.48,
          pz - Math.sin(yaw) * (w / 2) * rng.range(-1, 1), rng.float() * 6.28, 0.04, 0.06, 0.04),
          { masks: [0.8, 0.4, 0] });
      }
    }
    A.box('concrete', px, gy + (courses * (cell - 0.03)) / 2, pz, cell - 0.06, courses * (cell - 0.03), (len / n) + 0.02, yaw);
  }
}

/**
 * CAMOUFLAGE NETTING over a dump. Poles, a slack net between them and the
 * scrim strips hanging off the edge.
 *
 * IT IS DRAWN AND IT IS NOT SOLID, on purpose: a net at 3 m is a ceiling over
 * ground the bots have to cross, and a `STATIC` proxy up there is the flat top
 * `NavGrid.build`'s one downward ray finds — the barrack shed in this same
 * fortress was a 71-cell island in the sky for exactly that reason. The poles
 * ARE solid, because a pole is a thing you walk into.
 */
export function camoNet(A, rng, cx, cz, yFn, hw, hd, opts = {}) {
  const h = opts.h ?? 3.05;
  const yaw = opts.yaw ?? 0;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (lx, lz) => [cx + c * lx + s * lz, cz - s * lx + c * lz];
  const thin = BOX_THIN(A);
  // the poles, on the perimeter, with a guy off each corner
  const poles = [];
  for (let i = 0; i < 4; i++) {
    for (const u of [-1, 0, 1]) {
      const lx = i < 2 ? u * hw * 0.86 : (i === 2 ? -hw : hw);
      const lz = i < 2 ? (i === 0 ? -hd : hd) : u * hd * 0.7;
      if (i >= 2 && u === 0) continue;
      poles.push(at(lx, lz));
    }
  }
  for (const [px, pz] of poles) {
    const gy = yFn(px, pz);
    A.add('metal_rust', thin, LL(IDENT, px, gy + h / 2, pz, yaw + rng.range(-0.1, 0.1), 0.11, h, 0.11),
      { masks: [0.85, 0.5 + rng.float() * 0.3, 0.1] });
    A.box('metal', px, gy + h / 2, pz, 0.16, h, 0.16, yaw);
    // the guy rope down to a pin
    const ga = rng.float() * 6.28;
    A.add('burlap', thin, LL(IDENT, px + Math.sin(ga) * 0.7, gy + h * 0.45, pz + Math.cos(ga) * 0.7,
      ga, 0.025, h * 1.05, 0.025, Math.sin(ga) * 0.62, Math.cos(ga) * 0.62), { masks: [0.5, 0.6, 0.3] });
  }
  /**
   * THE NET ITSELF. Panels with a real sag, each on its own noise so the
   * surface is never a plane — the quality bar's "no flat untextured surface"
   * is hardest to meet on the one thing in a scene that is genuinely a sheet.
   */
  const nx = Math.max(3, Math.round(hw));
  const nz = Math.max(3, Math.round(hd));
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const lx = -hw + (i + 0.5) * (hw * 2 / nx);
      const lz = -hd + (k + 0.5) * (hd * 2 / nz);
      const sag = 0.42 * Math.sin(((i + 0.5) / nx) * Math.PI) * Math.sin(((k + 0.5) / nz) * Math.PI);
      const [px, pz] = at(lx, lz);
      A.add('foliage', BOX_SOFT(A), LL(IDENT, px, yFn(px, pz) + h - sag, pz,
        yaw + rng.range(-0.06, 0.06), hw * 2 / nx + 0.16, 0.07, hd * 2 / nz + 0.16,
        rng.range(-0.09, 0.09), rng.range(-0.09, 0.09)),
        { masks: [0.35 + rng.float() * 0.45, 0.4 + rng.float() * 0.4, 0.2 + rng.float() * 0.4] });
    }
  }
  // the scrim hanging off the edges, which is the silhouette from outside
  for (let i = 0; i < 26; i++) {
    const e = rng.int(0, 3);
    const u = rng.range(-1, 1);
    const lx = e < 2 ? u * hw : (e === 2 ? -hw : hw);
    const lz = e < 2 ? (e === 0 ? -hd : hd) : u * hd;
    const [px, pz] = at(lx, lz);
    A.add('foliage', BOX_THIN(A), LL(IDENT, px, yFn(px, pz) + h - rng.range(0.35, 0.95), pz,
      yaw + rng.range(-0.5, 0.5), rng.range(0.2, 0.55), rng.range(0.6, 1.7), 0.03),
      { masks: [0.3 + rng.float() * 0.5, 0.5, 0.3] });
  }
}

/**
 * A MORTAR PIT. Sandbag revetment in a horseshoe open to the front, a baseplate
 * and tube on a bipod, the ready rounds racked, and the aiming post out in
 * front of it. Everything under the step height except the tube, which is a
 * thing you obviously walk round.
 */
export function mortarPit(A, rng, cx, cz, gy, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (lx, lz) => [cx + c * lx + s * lz, cz - s * lx + c * lz];
  // the revetment: two courses of bags round 300° of a 2.4 m circle
  for (let i = 0; i < 34; i++) {
    const a = Math.PI * 0.28 + (i % 17) / 17 * Math.PI * 1.44;
    const tier = i < 17 ? 0 : 1;
    const [px, pz] = at(Math.sin(a) * 2.4, -Math.cos(a) * 2.4);
    A.put(rng.pick(['sandbag_a', 'sandbag_b', 'sandbag_c']), px, gy + 0.09 + tier * 0.2, pz,
      yaw + a + rng.range(-0.18, 0.18), rng.range(0.98, 1.16));
  }
  // the baseplate and the tube
  const [bx, bz] = at(0, -0.35);
  A.add('metal_dark', BOX_SOFT(A), LL(IDENT, bx, gy + 0.07, bz, yaw, 1.0, 0.14, 1.0), { masks: [0.85, 0.5, 0.15] });
  A.add('metal_dark', BOX_THIN(A), LL(IDENT, bx + s * 0.5, gy + 0.95, bz + c * 0.5, yaw,
    0.13, 1.85, 0.13, -0.42), { masks: [0.9, 0.45, 0.05] });
  A.box('metal', bx + s * 0.4, gy + 0.9, bz + c * 0.4, 0.5, 1.8, 0.9, yaw);
  // the bipod
  for (const k of [-1, 1]) {
    A.add('metal_dark', BOX_THIN(A), LL(IDENT, bx + c * k * 0.34 + s * 0.62, gy + 0.5, bz - s * k * 0.34 + c * 0.62,
      yaw, 0.055, 1.1, 0.055, 0.22, k * 0.28), { masks: [0.85, 0.5, 0.1] });
  }
  // the sight, and the ready rounds in their rack
  A.add('window_glow', BOX_FINE(A), LL(IDENT, bx + s * 0.78 - c * 0.3, gy + 0.86, bz + c * 0.78 + s * 0.3,
    yaw, 0.08, 0.14, 0.08), { masks: [0.2, 0.3, 0] });
  const [rx, rz] = at(1.5, 0.5);
  A.add('wood_dark', BOX(A), LL(IDENT, rx, gy + 0.18, rz, yaw + 0.4, 1.3, 0.36, 0.55), { masks: [0.6, 0.45, 0.2] });
  A.box('wood', rx, gy + 0.18, rz, 1.3, 0.36, 0.55, yaw + 0.4);
  for (let i = 0; i < 8; i++) {
    const [px, pz] = at(1.5 - 0.55 + (i % 4) * 0.32, 0.5 + (i < 4 ? -0.14 : 0.14));
    A.add('metal_green', BOX_THIN(A), LL(IDENT, px, gy + 0.44, pz, yaw + 0.4, 0.11, 0.19, 0.11,
      rng.range(-0.1, 0.1), rng.range(-0.1, 0.1)), { masks: [0.5, 0.55, 0.15] });
  }
  // the aiming post, out in front where the tube is pointed
  const [ax, az] = at(0, -4.6);
  A.add('metal_rust', BOX_THIN(A), LL(IDENT, ax, gy + 0.8, az, yaw, 0.06, 1.6, 0.06), { masks: [0.9, 0.6, 0] });
  for (let i = 0; i < 3; i++) {
    A.add(i % 2 ? 'metal_rust' : 'plaster_white', BOX_FINE(A),
      LL(IDENT, ax, gy + 0.42 + i * 0.42, az, yaw, 0.09, 0.32, 0.09), { masks: [0.8, 0.4, 0.05] });
  }
}

/**
 * A SEARCHLIGHT on a bastion. The drum, the yoke, the ring of louvres and the
 * emissive lens — no `PointLight`: `world`'s punctual-light count is baked into
 * every material's program cache key and one crossing its cull radius
 * recompiles the scene (measured on this map at +33-36 programs and 640-900 ms
 * on a single frame). What lights this thing is emission and bloom.
 */
export function searchlight(A, x, gy, z, yaw) {
  const pitch = -0.28;
  // the mount and its pintle
  A.add('metal_dark', BOX(A), LL(IDENT, x, gy + 0.2, z, yaw, 1.1, 0.4, 1.1), { masks: [0.8, 0.5, 0.15] });
  A.box('metal', x, gy + 0.2, z, 1.1, 0.4, 1.1, yaw);
  A.add('metal_dark', BOX_THIN(A), LL(IDENT, x, gy + 0.75, z, yaw, 0.24, 0.8, 0.24), { masks: [0.85, 0.45, 0.1] });
  // the yoke
  for (const k of [-1, 1]) {
    A.add('metal_dark', BOX_THIN(A), LL(IDENT, x + Math.cos(yaw) * k * 0.62, gy + 1.3, z - Math.sin(yaw) * k * 0.62,
      yaw, 0.11, 1.0, 0.11), { masks: [0.85, 0.45, 0.1] });
  }
  // the drum
  A.add('metal_dark', BOX(A), LL(IDENT, x, gy + 1.62, z, yaw, 1.24, 1.24, 0.9, pitch), { masks: [0.75, 0.4, 0.12] });
  A.box('metal', x, gy + 1.62, z, 1.24, 1.24, 0.9, yaw, pitch);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    A.add('metal_rust', BOX_FINE(A), LL(IDENT,
      x + Math.cos(a) * 0.56 * Math.cos(yaw), gy + 1.62 + Math.sin(a) * 0.56, z - Math.cos(a) * 0.56 * Math.sin(yaw),
      yaw, 0.1, 0.1, 0.94, pitch), { masks: [0.9, 0.6, 0.1] });
  }
  // the lens, and the louvres over it
  A.add('ember', BOX_SOFT(A), LL(IDENT, x + Math.sin(yaw) * 0.48, gy + 1.62 - Math.sin(pitch) * 0.4, z + Math.cos(yaw) * 0.48,
    yaw, 1.02, 1.02, 0.1, pitch));
  for (let i = 0; i < 4; i++) {
    A.add('metal_dark', BOX_THIN(A), LL(IDENT,
      x + Math.sin(yaw) * 0.53, gy + 1.28 + i * 0.23 - Math.sin(pitch) * 0.44, z + Math.cos(yaw) * 0.53,
      yaw, 1.1, 0.05, 0.16, pitch), { masks: [0.85, 0.5, 0.05] });
  }
  // the cable off the back of it, run down to the deck
  A.add('metal_dark', BOX_THIN(A), LL(IDENT, x - Math.sin(yaw) * 0.66, gy + 0.9, z - Math.cos(yaw) * 0.66,
    yaw, 0.07, 1.5, 0.07, 0.35), { masks: [0.75, 0.55, 0.2] });
}

/**
 * A GUYED ANTENNA MAST with a dipole array — the command post's read at 150 m,
 * and the only vertical inside the fortress that is not masonry.
 */
export function antennaMast(A, rng, x, gy, z, h) {
  const thin = BOX_THIN(A);
  for (const [lx, lz] of [[-0.34, -0.34], [0.34, -0.34], [0.34, 0.34], [-0.34, 0.34]]) {
    A.add('steel', thin, LL(IDENT, x + lx, gy + h / 2, z + lz, 0, 0.08, h, 0.08), { masks: [0.7, 0.4, 0.1] });
  }
  A.box('metal', x, gy + h / 2, z, 0.85, h, 0.85);
  const bays = Math.max(3, Math.round(h / 1.5));
  for (let b = 0; b < bays; b++) {
    const by = gy + (b + 0.5) * (h / bays);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      A.add('steel', thin, LL(IDENT, x + Math.cos(a) * 0.34, by, z + Math.sin(a) * 0.34,
        a + Math.PI / 2, 0.045, 0.045, 0.68), { masks: [0.75, 0.45, 0.1] });
      A.add('steel', thin, LL(IDENT, x + Math.cos(a) * 0.34, by, z + Math.sin(a) * 0.34,
        a + Math.PI / 2, 0.035, 0.035, 1.12, 0, 0.62), { masks: [0.75, 0.45, 0.1] });
    }
  }
  // the guys, three ways down to pins
  for (let k = 0; k < 3; k++) {
    const a = k * 2.09 + 0.4;
    A.add('steel', thin, LL(IDENT, x + Math.sin(a) * 2.4, gy + h * 0.45, z + Math.cos(a) * 2.4,
      a, 0.03, h * 1.06, 0.03, Math.sin(a) * 0.86, Math.cos(a) * 0.86), { masks: [0.8, 0.35, 0] });
    A.add('metal_rust', BOX_FINE(A), LL(IDENT, x + Math.sin(a) * 4.6, gy + 0.12, z + Math.cos(a) * 4.6,
      a, 0.1, 0.28, 0.1), { masks: [0.9, 0.7, 0.1] });
  }
  // the dipole array and the whips off the head
  for (let k = 0; k < 3; k++) {
    A.add('steel', thin, LL(IDENT, x, gy + h - 0.5 - k * 0.75, z, k * 1.1, 2.6 - k * 0.5, 0.045, 0.045),
      { masks: [0.8, 0.4, 0] });
  }
  for (let k = 0; k < 2; k++) {
    A.add('steel', thin, LL(IDENT, x + Math.cos(k * 3.1) * 0.3, gy + h + 1.0, z + Math.sin(k * 3.1) * 0.3,
      0, 0.035, 2.2, 0.035, rng.range(-0.05, 0.05), rng.range(-0.05, 0.05)), { masks: [0.8, 0.4, 0] });
  }
  A.add('ember', BOX_SOFT(A), LL(IDENT, x, gy + h + 2.2, z, 0, 0.24, 0.26, 0.24));
}

/**
 * A BUNDED FUEL STORE — drums inside a low kerb that would hold the contents of
 * the biggest one if it split. The kerb is 0.30 m, which is under the step, so
 * it reads as a real containment without becoming a ring nobody can get into.
 */
export function fuelBund(A, rng, cx, cz, gy, yaw, hw = 3.2, hd = 2.2) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (lx, lz) => [cx + c * lx + s * lz, cz - s * lx + c * lz];
  // the slab and the kerb round it
  A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, cx, gy + 0.05, cz, yaw, hw * 2, 0.1, hd * 2), { masks: [0.8, 0.5, 0.2] });
  for (const [lx, lz, w, d] of [[0, -hd, hw * 2, 0.22], [0, hd, hw * 2, 0.22], [-hw, 0, 0.22, hd * 2], [hw, 0, 0.22, hd * 2]]) {
    const [px, pz] = at(lx, lz);
    A.add('concrete', BOX(A), LL(IDENT, px, gy + 0.16, pz, yaw, w, 0.3, d), { masks: [0.55, 0.4, 0.2] });
    A.box('concrete', px, gy + 0.16, pz, w, 0.3, d, yaw);
  }
  // the drums, on their sides in a rack and standing in rows
  for (let i = 0; i < 9; i++) {
    const [px, pz] = at(-hw + 0.9 + (i % 5) * ((hw * 2 - 1.8) / 4), -hd + 0.75 + Math.floor(i / 5) * 1.3);
    A.put(rng.float() < 0.6 ? 'barrel_rust' : 'barrel_blue', px, gy + 0.1, pz, rng.float() * 6.28, rng.range(0.95, 1.08));
  }
  // the hand pump and its stand
  const [hx, hz] = at(hw - 0.5, hd - 0.5);
  A.add('metal_dark', BOX_THIN(A), LL(IDENT, hx, gy + 0.55, hz, yaw, 0.09, 1.1, 0.09), { masks: [0.85, 0.5, 0.1] });
  A.add('metal_rust', BOX_FINE(A), LL(IDENT, hx, gy + 1.05, hz, yaw + 0.6, 0.5, 0.07, 0.07), { masks: [0.9, 0.7, 0.1] });
  // NO SMOKING, stencilled on a board
  const [sx, sz] = at(0, -hd - 0.35);
  A.add('metal_blue', BOX_THIN(A), LL(IDENT, sx, gy + 1.05, sz, yaw, 1.0, 0.44, 0.05), { masks: [0.5, 0.4, 0.1] });
  A.add('metal_rust', BOX_THIN(A), LL(IDENT, sx, gy + 0.55, sz, yaw, 0.06, 1.0, 0.06), { masks: [0.9, 0.6, 0] });
}

/**
 * A LIFTING BOOM at a road, and the sentry box beside it. The boom is UP —
 * the position is stood-to, not checking passes — so it is a diagonal over the
 * road at 2.6 m and nothing at all in the way.
 */
export function boomBarrier(A, rng, x, gy, z, yaw, span = 5.2) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // the pivot post and its counterweight
  A.add('metal_dark', BOX(A), LL(IDENT, x, gy + 0.7, z, yaw, 0.3, 1.4, 0.3), { masks: [0.8, 0.5, 0.15] });
  A.box('metal', x, gy + 0.7, z, 0.34, 1.4, 0.34, yaw);
  A.add('concrete_dark', BOX(A), LL(IDENT, x - s * 0.62, gy + 0.3, z - c * 0.62, yaw, 0.5, 0.6, 0.5), { masks: [0.7, 0.4, 0.2] });
  // the pole, raised, with its stripes
  const bays = 8;
  for (let i = 0; i < bays; i++) {
    const u = (i + 0.5) / bays;
    A.add(i % 2 ? 'metal_rust' : 'plaster_white', BOX_THIN(A), LL(IDENT,
      x + c * u * span * 0.34, gy + 1.3 + u * span * 0.86, z - s * u * span * 0.34,
      yaw + Math.PI / 2, 0.11, 0.11, span / bays + 0.02, 0, -1.2), { masks: [0.6, 0.4, 0.05] });
  }
  A.box('metal', x + c * span * 0.17, gy + 1.3 + span * 0.43, z - s * span * 0.17, 0.2, span * 0.9, 0.2, yaw, 0, -1.2);
  // the sentry box: three sides and a roof, on the other side of the road
  const bx = x - c * 2.2;
  const bz = z + s * 2.2;
  for (const [ox, oz, w, d] of [[0, -0.6, 1.3, 0.14], [-0.6, 0, 0.14, 1.2], [0.6, 0, 0.14, 1.2]]) {
    A.add('corrugated', BOX(A), LL(IDENT, bx + c * ox + s * oz, gy + 1.05, bz - s * ox + c * oz, yaw, w, 2.1, d),
      { masks: [0.75 + rng.float() * 0.2, 0.5, 0.15] });
    A.box('metal', bx + c * ox + s * oz, gy + 1.05, bz - s * ox + c * oz, w, 2.1, d, yaw);
  }
  A.add('corrugated', BOX_SOFT(A), LL(IDENT, bx, gy + 2.18, bz, yaw, 1.6, 0.14, 1.5, 0, 0.09), { masks: [0.85, 0.6, 0.2] });
  A.add('window_glow', PANE(A), LL(IDENT, bx + s * 0.62, gy + 1.5, bz + c * 0.62, yaw + Math.PI / 2, 1.1, 0.9, 1),
    { masks: [0.2, 0.3, 0] });
  // sandbags heaped round its base, which is what a sentry does on day two
  for (let i = 0; i < 9; i++) {
    const a = rng.float() * Math.PI * 2;
    A.put(rng.pick(['sandbag_a', 'sandbag_b', 'sandbag_c']),
      bx + Math.cos(a) * rng.range(0.85, 1.15), gy + 0.09 + (i % 2) * 0.19, bz + Math.sin(a) * rng.range(0.85, 1.15),
      a + rng.range(-0.3, 0.3), rng.range(0.98, 1.14));
  }
}

/**
 * FIELD TELEPHONE CABLE on stakes, run between two points. 0.3 m stakes — well
 * under the step — and the cable itself is drawn with a real catenary sag,
 * because a straight line between two stakes is the one thing on a battlefield
 * that never happens.
 */
export function fieldCable(A, rng, pts, yFn, opts = {}) {
  const h = opts.h ?? 0.62;
  const thin = BOX_THIN(A);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = Math.atan2(bx - ax, bz - az);
    const spans = Math.max(2, Math.round(len / 3.4));
    for (let k = 0; k <= spans; k++) {
      const t = k / spans;
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      const gy = yFn(px, pz);
      A.add('wood_dark', thin, LL(IDENT, px, gy + h / 2, pz, yaw + rng.range(-0.2, 0.2), 0.06, h, 0.06),
        { masks: [0.7, 0.5, 0.2] });
      if (k === spans) continue;
      // the sag: three chords per span, dipping in the middle
      for (let j = 0; j < 3; j++) {
        const u = (j + 0.5) / 3;
        const dip = 0.16 * Math.sin(u * Math.PI);
        A.add('metal_dark', thin, LL(IDENT,
          px + (bx - ax) * (u / spans), gy + h - dip, pz + (bz - az) * (u / spans), yaw,
          0.022, 0.022, len / spans / 3 + 0.03, 0, (u - 0.5) * 0.5), { masks: [0.7, 0.55, 0.15] });
      }
    }
  }
}

/**
 * A STENCILLED BOARD — unit markings, a map board or a warning. Two legs and a
 * face, with the lettering as raised bars rather than a texture, because at
 * this map's light level a painted glyph on a matte board is not there.
 */
export function stencilBoard(A, rng, x, gy, z, yaw, w = 1.7, h = 1.05, rows = 3) {
  A.add('metal_blue', BOX(A), LL(IDENT, x, gy + 1.35, z, yaw, w, h, 0.07), { masks: [0.45, 0.4, 0.12] });
  for (const k of [-1, 1]) {
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, x + Math.cos(yaw) * k * (w / 2 - 0.16), gy + 0.7, z - Math.sin(yaw) * k * (w / 2 - 0.16),
      yaw, 0.07, 1.4, 0.07), { masks: [0.9, 0.6, 0] });
  }
  for (let r = 0; r < rows; r++) {
    const ry = gy + 1.35 + (h / 2 - 0.18) - r * (h / (rows + 0.4));
    let cursor = -w / 2 + 0.14;
    while (cursor < w / 2 - 0.2) {
      const bw = rng.range(0.07, 0.24);
      A.add('plaster_white', BOX_FINE(A), LL(IDENT,
        x + Math.cos(yaw) * (cursor + bw / 2), ry, z - Math.sin(yaw) * (cursor + bw / 2),
        yaw, bw, 0.1, 0.03), { masks: [0.3, 0.25, 0.05] });
      cursor += bw + rng.range(0.05, 0.12);
    }
  }
}
