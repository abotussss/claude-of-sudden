import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { BOX, BOX_SOFT, BOX_THIN, IDENT, LL, facadeWall } from './kit.js';
import { chamferBox, rockGeometry, fbm3 } from './util.js';
import { PALETTE } from './palette.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * WORLD — THE BUILDING'S OWN DESTROYED STATE, BAKED AT BOOT
 * ════════════════════════════════════════════════════════════════════════════
 * "AとBの周りの街は爆撃で定期的に破壊して、その際に周りの建物が完全に崩れ、いろんな
 *  方向から到達可能にすること、今まで到達できなかった方向にある建物を物理的に壊し、
 *  到達できるようにして、BFのような感じで"
 * "破壊というのは原型を留めない感じ。壊れるオブジェを入れてそれを破壊するのではなく、
 *  建物自体に壊れた時のキャッシュを持たせて、壊し方を派手にして"
 *
 * WHAT WAS ALREADY THERE AND WHY IT WAS NOT THIS. `src/match/airstrike.js` bakes
 * eleven strike sites at boot and they are very good at what they do — but every
 * one of them is a mass ADDED ON TOP OF a building: a parapet, an extra storey,
 * a stair hut, a bay of aisle roof. The bomb lands, 923 chunks come off the roof,
 * the dust clears, and the building is still standing, still the same shape, and
 * still exactly as impassable as it was before. Nothing about the map changed.
 * That is "壊れるオブジェを入れてそれを破壊する" precisely.
 *
 * THIS IS THE OTHER HALF. A building on this list carries TWO forms, both built
 * at boot and both sitting in the merged static batches the whole time:
 *
 *   the SHELL   — everything `buildBuilding` and the dressing pass authored for
 *                 it, recorded as a `Assembler` scope: which triangle ranges in
 *                 which merged mesh, which instanced slots, which collision.
 *   the RUIN    — a purpose-built collapsed form standing in the same footprint:
 *                 corner stubs of ragged wall, pancaked floor slabs lying over
 *                 each other at an angle with their joists and reinforcement
 *                 hanging out of them, and a graded field of broken masonry over
 *                 the whole plan. Built here, hidden at boot the same way, with
 *                 its own collision parked in the BVH on mask 0.
 *
 * Bringing the building down is then: hide one scope, show the other, flip two
 * collision masks. No geometry is built, no BVH is rebuilt and no material is
 * touched on the frame it happens — the discipline `airstrike.js` is written
 * around, applied to the building instead of to the thing on its roof.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE RUIN IS WALKABLE, AND THAT IS THE ENTIRE POINT OF IT
 * ────────────────────────────────────────────────────────────────────────────
 * "いろんな方向から到達可能にすること、今まで到達できなかった方向にある建物を物理的に
 *  壊し、到達できるようにして"
 *
 * A rubble pile you cannot cross is a wall in a different colour. `src/ai/nav.js`
 * is a 2.5D height field sampled by dropping one ray per cell and joining
 * neighbours whose floors differ by no more than `maxStep` = 0.45 m, so a mound
 * is traversable if and only if the surface it presents steps by less than that
 * from cell to cell. So the debris field is not scattered, it is a HEIGHT FIELD
 * that is then RELAXED: `_relax` walks the grid until no neighbouring pair
 * differs by more than `STEP_MAX`, lowering the higher of the two. Ten metres of
 * three-storey block becomes a ramp you walk up, over and down.
 *
 * The stubs are what stops it reading as a skate park: they stand at the CORNERS,
 * which is what survives a collapse, and the middle of every elevation is left
 * open — so the footprint gains a way through on all four sides at once, and the
 * approaches the building used to deny are approaches again. `_demoprobe.mjs`
 * measures that as a bearing count rather than asserting it.
 */

/* -------------------------------------------------------------------------- */

/**
 * THE BUILDINGS THAT CAN COME DOWN, and every one of them is on this list for a
 * ROUTE it currently denies rather than for how it looks when it falls.
 *
 * Zone A stands in the WEST AVENUE (authored x -83..-70, z 14..62) and zone B in
 * its ρ image. The avenue is a closed box: its east side is the inner row, and
 * the row has exactly two authored mouths in it — z 34..40 into the NW throat and
 * z 52..62 into the NW yard. Everything else on that side is `NW1` (authored z
 * 14..34) and `NW6` (z 40..52), two solid three-storey blocks. Come at zone A
 * from anywhere east of it and you walk to one of those two mouths, whatever
 * bearing you started on.
 *
 * `NW6` is the block BETWEEN the two mouths and is directly east of the capture
 * point. `NW1` closes the whole southern half of the row. Bring either down and
 * a wall of the box becomes a slope, which is what "今まで到達できなかった方向に
 * ある建物を物理的に壊し、到達できるようにして" asks for in one sentence.
 *
 * `WC6` / `EC6` are the islands standing IN the avenue, a dozen metres off the
 * point. They deny no route — that is deliberate, they are authored flush to the
 * west row so the street stays open past them — and they are here because the
 * request is about the CITY around the two points being levelled, not only about
 * the two blocks whose collapse is tactically load-bearing. They also happen to
 * be the ones the player standing on the point actually sees come down.
 *
 * `reach` is metres of blast radius; `mound` the height the debris piles to at
 * the centre of the plan.
 */
export const DEMOLITION = [
  { id: 'NW6', zone: 'A', name: 'A ROW NORTH', mound: 1.50, opens: true },
  { id: 'NW1', zone: 'A', name: 'A ROW SOUTH', mound: 1.55, opens: true },
  { id: 'WC6', zone: 'A', name: 'A AVENUE ISLAND', mound: 1.05, opens: false },
  { id: 'SE6', zone: 'B', name: 'B ROW SOUTH', mound: 1.50, opens: true },
  { id: 'SE1', zone: 'B', name: 'B ROW NORTH', mound: 1.55, opens: true },
  { id: 'EC6', zone: 'B', name: 'B AVENUE ISLAND', mound: 1.05, opens: false },
];

const BY_ID = new Map(DEMOLITION.map((d) => [d.id, d]));

/** Does this building carry a destroyed state? */
export function isDemolishable(id) {
  return BY_ID.has(id);
}

/**
 * The largest step the debris field is allowed to present between two adjacent
 * cells. `NavGrid.maxStep` is 0.45 and the grid is a 0.8 m lattice while this
 * field is on a 2.0 m one, so a cell boundary can fall anywhere inside a slab —
 * 0.38 leaves the whole thing under the limit however the two lattices line up.
 *
 * IT IS ALSO WHAT CAPS HOW HIGH THE PILE CAN BE. A cell may only stand `STEP_MAX`
 * over its neighbour, so the centre of a 15 m plan cannot be more than about four
 * cells' worth — 1.5 m — above the street it spills into. A real three-storey
 * collapse leaves two or three metres of rubble; two or three metres of rubble is
 * a wall. The height goes into the stubs, the fallen panels and the shards
 * instead, which carry the silhouette without closing the plan.
 */
const STEP_MAX = 0.38;
/** Debris cell size. Big enough to read as broken masonry, not as gravel. */
const CELL = 2.2;
/** How far past the footprint the pile spills into the street. */
const APRON = 1.6;
/** Where the falling mass is cut off and the standing stubs begin. */
const STUB_BASE = 0.0;

/* ========================================================================== */
/* PLAN — records first, geometry later                                       */
/* ========================================================================== */

/**
 * One record per destructible building, created before the level is built so
 * `world` can open a scope round each one as it goes up.
 */
export function planDemolitions(buildings) {
  const out = [];
  for (const spec of buildings) {
    const d = BY_ID.get(spec.id);
    if (!d) continue;
    out.push({
      id: spec.id,
      name: d.name,
      zone: d.zone,
      opens: d.opens,
      spec,
      mound: d.mound,
      info: null,
      shell: null,
      ruin: null,
      down: false,
      /** Filled by `publishDemolitions` once the level transform exists. */
      position: null,
      radius: 0,
      mass: null,
      surfaces: ['plaster', 'concrete'],
      tint: 0xbfae92,
      navRect: null,
    });
  }
  if (out.length !== DEMOLITION.length) {
    console.error(
      `[world] demolition: ${DEMOLITION.length - out.length} of ${DEMOLITION.length} target ` +
        'buildings are not in BUILDINGS — the ids in src/world/demolition.js are stale.'
    );
  }
  return out;
}

/* ========================================================================== */
/* THE RUIN                                                                   */
/* ========================================================================== */

/**
 * Build every record's destroyed state. Runs after the shells and the dressing,
 * before `A.finalize`, so the ruin's triangles land in the same merged batches
 * and cost no extra draw call.
 *
 * ITS OWN RNG STREAM, keyed to the building id. `world`'s single stream is
 * shared with every prop, stain and pock the dressing pass places, so drawing
 * from it here would move the whole set dressing of the map sideways the day
 * somebody adds a rock to a rubble pile — the same rule `cathedral.js`,
 * `features.js` and `links.js` all follow.
 */
export function buildRuins(A, records) {
  for (const rec of records) {
    const seed = [...rec.id].reduce((h, c) => (h * 131 + c.charCodeAt(0)) >>> 0, 0x9e37);
    const rng = new Rng(seed);
    rec.ruin = A.beginScope(`ruin:${rec.id}`);
    _ruin(A, rng, rec);
    A.endScope();
  }
}

/**
 * @param {Assembler} A
 * @param {Rng} rng
 * @param {object} rec
 */
function _ruin(A, rng, rec) {
  const spec = rec.spec;
  const info = rec.info;
  const t = spec.t ?? 0.34;
  const wallKey = spec.wallKey ?? 'plaster_cream';
  const hw = spec.w / 2;
  const hd = spec.d / 2;

  const field = _debrisField(rng, spec, rec.mound);
  _debris(A, rng, spec, wallKey, field);
  _stubs(A, rng, spec, info, t, wallKey);
  _slabs(A, rng, spec, info, field);
  _fallen(A, rng, spec, t, wallKey, field);
  _shards(A, rng, spec, info, wallKey);

  // The scorched ring the fire leaves on the road round the footprint. Flat, a
  // centimetre proud of the ground, and outside the debris so it reads as the
  // stain rather than as part of the pile.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const r = Math.max(hw, hd) + rng.range(0.6, 2.4);
    A.add(
      'road_dust',
      BOX_THIN(A),
      LL(IDENT, spec.x + Math.cos(a) * r, 0.02, spec.z + Math.sin(a) * r, rng.float() * 6.28,
        rng.range(2.5, 5.5), 0.02, rng.range(2.5, 5.5)),
      { masks: [0.1, 1.0, 0.5] }
    );
  }
}

/**
 * THE DEBRIS FIELD, as a height field that is then made walkable.
 *
 * A three-storey block is ~30 000 m³ of masonry standing on 270 m² of plan, and
 * it does not vanish — but a pile the height of the rubble a real collapse leaves
 * would be a wall in a different colour, and this exists to OPEN the plan rather
 * than to re-close it. So the profile is authored low and wide (it spills
 * `APRON` metres into the street on every side, which is what a collapse does),
 * broken up with two octaves of noise so it is not a dome, and then RELAXED
 * until no two neighbouring cells differ by more than `STEP_MAX`.
 *
 * The relaxation is the load-bearing line in this file. Without it, noise on top
 * of a dome makes cliffs, and a cliff in a height field is an unwalkable cell,
 * and an unwalkable cell in the middle of the footprint is the building still
 * standing as far as `A*` is concerned.
 */
function _debrisField(rng, spec, mound) {
  const hw = spec.w / 2 + APRON;
  const hd = spec.d / 2 + APRON;
  const nx = Math.max(3, Math.round((hw * 2) / CELL));
  const nz = Math.max(3, Math.round((hd * 2) / CELL));
  const dx = (hw * 2) / nx;
  const dz = (hd * 2) / nz;
  const h = new Float32Array(nx * nz);
  const jx = new Float32Array(nx * nz);
  const jz = new Float32Array(nx * nz);
  const seedX = rng.range(0, 40);
  const seedZ = rng.range(0, 40);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      const cx = -hw + (ix + 0.5) * dx;
      const cz = -hd + (iz + 0.5) * dz;
      // Radial fall-off on the plan's own aspect, so a long block piles along a
      // ridge instead of into a cone in the middle of a 30 m footprint.
      const r = Math.min(1, Math.hypot(cx / (hw + 0.001), cz / (hd + 0.001)));
      const dome = mound * Math.max(0, 1 - r * r * 1.05);
      const n = fbm3(cx * 0.22 + seedX, 3.1, cz * 0.22 + seedZ, 2) - 0.5;
      h[i] = Math.max(0.1, dome + n * mound * 0.55);
      jx[i] = rng.range(-0.28, 0.28);
      jz[i] = rng.range(-0.28, 0.28);
    }
  }
  _relax(h, nx, nz);
  return { h, jx, jz, nx, nz, dx, dz, hw, hd };
}

/**
 * Lower cells until every 4-neighbour pair is inside `STEP_MAX`. Converges from
 * above in a handful of sweeps because it only ever removes height, and it is
 * run over both scan directions each sweep so a long ridge drains from both ends.
 */
function _relax(h, nx, nz) {
  for (let pass = 0; pass < 12; pass++) {
    let moved = 0;
    for (let k = 0; k < 2; k++) {
      const fwd = k === 0;
      for (let s = 0; s < nx * nz; s++) {
        const i = fwd ? s : nx * nz - 1 - s;
        const ix = i % nx;
        const iz = (i / nx) | 0;
        for (let d = 0; d < 4; d++) {
          const nxi = ix + (d === 0 ? 1 : d === 1 ? -1 : 0);
          const nzi = iz + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (nxi < 0 || nzi < 0 || nxi >= nx || nzi >= nz) continue;
          const j = nzi * nx + nxi;
          const gap = h[i] - h[j];
          if (gap > STEP_MAX) {
            h[i] = h[j] + STEP_MAX;
            moved++;
          }
        }
      }
    }
    if (!moved) return pass;
  }
  return 12;
}

/**
 * The field, drawn. One chamfered slab per cell, each one knocked out of true —
 * a couple of degrees of yaw, a couple of tilt — so what the eye reads is broken
 * concrete rather than a bar chart. The COLLISION is the axis-aligned box under
 * it, exactly `h` tall with a flat top, which is what the height field samples;
 * the tilt is a skin over it and never more than a step's worth.
 *
 * FIVE MATERIALS AND NOT ONE. A pile of one grey is the "no flat/untextured
 * surfaces" failure in a different form: what comes out of a rendered masonry
 * building is the render, the block behind it, the floor screed, the structural
 * concrete and the dust of all four, and the eye reads the mixture as debris and
 * a single tone as a shape somebody modelled.
 */
function _debris(A, rng, spec, wallKey, f) {
  const keys = [wallKey, 'concrete', 'concrete_dark', 'brick_fine', 'roof_screed'];
  const wt = [0.3, 0.24, 0.16, 0.18, 0.12];
  const pick = () => {
    let r = rng.float();
    for (let i = 0; i < keys.length; i++) {
      r -= wt[i];
      if (r <= 0) return keys[i];
    }
    return keys[0];
  };
  const soft = BOX_SOFT(A);
  for (let iz = 0; iz < f.nz; iz++) {
    for (let ix = 0; ix < f.nx; ix++) {
      const i = iz * f.nx + ix;
      const h = f.h[i];
      const cx = spec.x - f.hw + (ix + 0.5) * f.dx + f.jx[i];
      const cz = spec.z - f.hd + (iz + 0.5) * f.dz + f.jz[i];
      /**
       * THREE OR FOUR BLOCKS PER CELL, NOT ONE.
       *
       * The first version drew the cell as a single slab of exactly `h`, and
       * photographed from a roof the whole plan read as a carpet of flat panels
       * — plywood sheets, not masonry. A collapse is BLOCKS AT ANGLES resting on
       * each other, so each cell is a small heap: one piece carrying the height
       * the proxy promises and two or three smaller ones jammed against it at
       * steeper angles and different materials. Same collision, same walkable
       * surface, ten times the read.
       */
      const heap = rng.int(3, 4);
      for (let k = 0; k < heap; k++) {
        const main = k === 0;
        const sx = f.dx * (main ? rng.range(0.78, 0.95) : rng.range(0.3, 0.62));
        const sz = f.dz * (main ? rng.range(0.78, 0.95) : rng.range(0.3, 0.62));
        const sy = main ? h * rng.range(1.0, 1.2) : h * rng.range(0.35, 0.9);
        A.add(
          pick(),
          soft,
          LL(
            IDENT,
            cx + (main ? 0 : rng.range(-f.dx * 0.38, f.dx * 0.38)),
            sy * 0.5 + (main ? 0 : rng.range(0, h * 0.5)),
            cz + (main ? 0 : rng.range(-f.dz * 0.38, f.dz * 0.38)),
            rng.range(-0.9, 0.9),
            sx,
            sy,
            sz,
            rng.range(main ? -0.12 : -0.42, main ? 0.12 : 0.42),
            rng.range(main ? -0.12 : -0.42, main ? 0.12 : 0.42)
          ),
          { masks: [rng.range(0.5, 0.95), rng.range(0.6, 1.0), rng.range(0.45, 0.85)] }
        );
      }
      // Only the cells that are actually worth standing on get a proxy: under
      // `STANCE.stand.stepHeight` the controller walks over them and a box there
      // is a bump in the bot height field for nothing. @see Assembler._protoBox.
      if (h >= 0.42) A.box('concrete', cx, h * 0.5, cz, f.dx, h, f.dz);

      // Loose lumps on top. No collision by design — they are all well under the
      // step height and this is where the silhouette of the pile comes from.
      const lumps = rng.int(2, 4);
      for (let k = 0; k < lumps; k++) {
        const s = rng.range(0.2, 0.62);
        A.addOnce(
          rng.float() < 0.5 ? 'concrete' : 'brick_fine',
          rockGeometry(rng, s, 0, 0.72),
          LL(IDENT, cx + rng.range(-0.7, 0.7), h + s * 0.24, cz + rng.range(-0.7, 0.7),
            rng.float() * 6.28, 1, 1, 1, rng.range(-0.5, 0.5), rng.range(-0.5, 0.5)),
          { masks: [0.35, 0.8, 0.5] }
        );
      }
    }
  }
}

const SIDE_RY = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

/** The panel matrix for one side of a footprint, +Z pointing INTO the plan. */
function panelAt(out, spec, side, y, along) {
  let px = spec.x;
  let pz = spec.z;
  if (side === 0) {
    pz = spec.z - spec.d / 2;
    px += along;
  } else if (side === 2) {
    pz = spec.z + spec.d / 2;
    px -= along;
  } else if (side === 1) {
    px = spec.x + spec.w / 2;
    pz -= along;
  } else {
    px = spec.x - spec.w / 2;
    pz += along;
  }
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, SIDE_RY[side], 0, 'YXZ'));
  return out.compose(new THREE.Vector3(px, y, pz), q, new THREE.Vector3(1, 1, 1));
}

/**
 * WHAT IS LEFT STANDING, AND WHERE.
 *
 * At the corners, because that is what survives — a corner is two walls bracing
 * each other and it is the last thing to go — and because the corners are the
 * only place a stub can stand without closing the plan again. The middle 40 % of
 * every elevation is left clear on all four sides, so the footprint gains a way
 * in and a way out on every bearing at once. That is the difference between a
 * building that has been destroyed and a building that has been replaced with a
 * differently-shaped building.
 *
 * `top: 'ragged'` is the kit's own broken-wall top: the panel's upper edge is cut
 * into a jagged line instead of a level one, which is the single thing that stops
 * a 1.6 m wall reading as a garden wall.
 */
function _stubs(A, rng, spec, info, t, wallKey) {
  const pm = new THREE.Matrix4();
  for (let side = 0; side < 4; side++) {
    const len = side === 0 || side === 2 ? spec.w : spec.d;
    // One stub off each end of the elevation, 18-30 % of its length, so the
    // middle is always open by at least 40 %.
    for (const end of [-1, 1]) {
      const segLen = len * rng.range(0.18, 0.3);
      const at = end * (len / 2 - segLen / 2 - rng.range(0.0, len * 0.05));
      const h = rng.range(0.95, 2.35);
      panelAt(pm, spec, side, 0, at);
      facadeWall(A, pm.clone(), {
        w: segLen,
        h,
        t,
        key: wallKey,
        openings: [],
        rng,
        top: 'ragged',
        raggedAmp: 0.62,
        warp: 0.035,
        paint: (x, wy, z, nx, ny, nz, out) => {
          // Filthy at the base and blast-scoured at the break.
          const base = Math.max(0, 1 - wy / 1.1);
          out[1] = Math.min(1, out[1] + base * base * 0.6);
          out[0] = Math.min(1, out[0] + Math.max(0, 1 - Math.abs(wy - h) / 0.8) * 0.6);
          out[2] = Math.min(1, out[2] + base * 0.35);
        },
      });
      // The block behind the render, exposed along the break.
      const g = chamferBox(segLen * rng.range(0.5, 0.85), rng.range(0.25, 0.5), 0.06, 0.01);
      A.addOnce('brick_fine', g, LL(pm, rng.range(-segLen * 0.2, segLen * 0.2), h - rng.range(0.15, 0.4), -0.02), {
        masks: [0.6, 0.7, 0.5],
      });
      // Reinforcement standing out of the top of the stub, bent over.
      const bars = rng.int(2, 5);
      for (let b = 0; b < bars; b++) {
        const bl = rng.range(0.3, 0.85);
        A.add(
          'metal_rust',
          BOX_THIN(A),
          LL(pm, rng.range(-segLen / 2 + 0.15, segLen / 2 - 0.15), h + bl * 0.4, t * 0.5,
            rng.range(-0.5, 0.5), 0.022, bl, 0.022, rng.range(-0.7, 0.7), rng.range(-0.7, 0.7)),
          { masks: [0.9, 0.7, 0.1] }
        );
      }
    }
  }
}

/**
 * THE FLOORS, PANCAKED. Two or three of them, lying over the debris at a few
 * degrees with their edges broken off, their joists hanging out of the underside
 * and their reinforcement curling out of the ends.
 *
 * NO COLLISION, ON PURPOSE. Each one is sunk so it stands less than a step above
 * the debris box under it — you walk over it exactly as you walk over the pile,
 * and it never becomes a ledge the height field has to have an opinion about. A
 * slab with its own proxy at 9° is either a ramp nobody asked for or a cliff, and
 * this file exists to keep the plan crossable.
 */
function _slabs(A, rng, spec, info, f) {
  const n = Math.min(2, Math.max(1, (info.floorY?.length ?? 2) - 1));
  const heightAt = (x, z) => {
    const ix = Math.min(f.nx - 1, Math.max(0, Math.floor((x - spec.x + f.hw) / f.dx)));
    const iz = Math.min(f.nz - 1, Math.max(0, Math.floor((z - spec.z + f.hd) / f.dz)));
    return f.h[iz * f.nx + ix];
  };
  for (let i = 0; i < n; i++) {
    const sw = spec.w * rng.range(0.22, 0.36);
    const sd = spec.d * rng.range(0.22, 0.36);
    const cx = spec.x + rng.range(-spec.w * 0.26, spec.w * 0.26);
    const cz = spec.z + rng.range(-spec.d * 0.26, spec.d * 0.26);
    const rx = rng.range(-0.2, 0.2);
    const rz = rng.range(-0.2, 0.2);
    // Sunk into the pile: the highest corner clears the debris under it by less
    // than a step, so the slab is scenery on a surface that is already walkable.
    const lift = (Math.abs(rx) * sd + Math.abs(rz) * sw) * 0.5;
    const y = heightAt(cx, cz) - lift + rng.range(0.02, 0.2);
    A.add('floor_concrete', BOX(A), LL(IDENT, cx, y, cz, rng.range(-0.6, 0.6), sw, 0.22, sd, rx, rz), {
      masks: [0.55, 0.75, 0.6],
    });
    // Screed on top where it landed the right way up.
    A.add('roof_screed', BOX_SOFT(A), LL(IDENT, cx, y + 0.14, cz, rng.range(-0.6, 0.6), sw * 0.86, 0.07, sd * 0.86, rx, rz), {
      masks: [0.6, 0.5, 0.3],
    });
    // Joists hanging out of the underside — the thing that says "this was a
    // floor" rather than "this is a slab of concrete".
    const jn = Math.max(2, Math.round(sd / 1.6));
    for (let j = 0; j < jn; j++) {
      const off = (j / (jn - 1 || 1) - 0.5) * sd * 0.9;
      A.add(
        'wood_dark',
        BOX_THIN(A),
        LL(IDENT, cx + rng.range(-0.4, 0.4), y - 0.16, cz + off, rng.range(-0.6, 0.6),
          sw * rng.range(0.6, 1.15), 0.15, 0.12, rx, rz),
        { masks: [0.7, 0.7, 0.55] }
      );
    }
    for (let b = 0; b < 4; b++) {
      const bl = rng.range(0.5, 1.6);
      A.add(
        'metal_rust',
        BOX_THIN(A),
        LL(IDENT, cx + rng.range(-sw / 2, sw / 2), y + rng.range(0.05, 0.35), cz + rng.range(-sd / 2, sd / 2),
          rng.float() * 6.28, 0.024, bl, 0.024, rng.range(-1.2, 1.2), rng.range(-1.2, 1.2)),
        { masks: [0.9, 0.75, 0.1] }
      );
    }
  }
}

/**
 * WHOLE PANELS OF WALL, LYING WHERE THEY FELL.
 *
 * The single most legible thing in a real collapse and the thing a rubble field
 * on its own can never say: a five-metre run of elevation, still carrying the
 * holes its windows were, lying face down across the pile or propped at forty
 * degrees against what is left of a corner. Without these, a debris field
 * photographed from a roof reads as scattered building material rather than as a
 * building; with them it is unmistakable which way up the thing used to be.
 *
 * NO COLLISION, for the reason `_slabs` has none: they lie ON the graded field
 * and stand at most a step proud of it, so the surface a player and the height
 * field walk is the one the debris boxes already promised. A panel with its own
 * proxy at 40° is a ramp nobody authored.
 */
function _fallen(A, rng, spec, t, wallKey, f) {
  const heightAt = (x, z) => {
    const ix = Math.min(f.nx - 1, Math.max(0, Math.floor((x - spec.x + f.hw) / f.dx)));
    const iz = Math.min(f.nz - 1, Math.max(0, Math.floor((z - spec.z + f.hd) / f.dz)));
    return f.h[iz * f.nx + ix];
  };
  const n = spec.w * spec.d > 200 ? rng.int(5, 7) : rng.int(2, 4);
  const soft = BOX_SOFT(A);
  for (let i = 0; i < n; i++) {
    const len = Math.min(spec.w, spec.d) * rng.range(0.3, 0.62);
    const tall = rng.range(1.6, 3.4);
    const cx = spec.x + rng.range(-spec.w * 0.4, spec.w * 0.4);
    const cz = spec.z + rng.range(-spec.d * 0.4, spec.d * 0.4);
    const ry = rng.float() * Math.PI * 2;
    /** Most lie flat; one in four is propped against whatever stopped it. */
    const propped = rng.float() < 0.26;
    const tilt = propped ? rng.range(0.6, 1.05) : rng.range(-0.22, 0.22);
    const ground = heightAt(cx, cz);
    const y = propped
      ? ground + Math.sin(tilt) * tall * 0.5
      : ground + rng.range(0.05, 0.3);
    A.add(
      wallKey,
      soft,
      LL(IDENT, cx, y, cz, ry, len, propped ? tall : t, propped ? t : tall, tilt, rng.range(-0.15, 0.15)),
      { masks: [rng.range(0.5, 0.9), rng.range(0.55, 0.95), rng.range(0.4, 0.8)] }
    );
    // The block behind the render, torn open along one edge.
    A.add(
      'brick_fine',
      soft,
      LL(IDENT, cx, y + (propped ? tall * 0.32 : t * 0.55), cz, ry,
        len * rng.range(0.3, 0.7), propped ? tall * 0.3 : 0.05, propped ? 0.05 : tall * rng.range(0.3, 0.6),
        tilt, 0),
      { masks: [0.65, 0.75, 0.6] }
    );
    // Reinforcement trailing out of the broken end.
    for (let b = 0; b < rng.int(2, 4); b++) {
      const bl = rng.range(0.5, 1.5);
      A.add(
        'metal_rust',
        BOX_THIN(A),
        LL(IDENT, cx + Math.sin(ry) * len * rng.range(0.4, 0.6), y + rng.range(0.1, 0.5),
          cz + Math.cos(ry) * len * rng.range(0.4, 0.6), rng.float() * 6.28,
          0.024, bl, 0.024, rng.range(-1.3, 1.3), rng.range(-1.3, 1.3)),
        { masks: [0.9, 0.75, 0.1] }
      );
    }
  }
}

/**
 * One or two tall shards, and they are the silhouette. A plan that is all rubble
 * and knee-high stubs reads from fifty metres as a hole in the row rather than as
 * a building that has been destroyed; a piece of elevation still standing three
 * or four metres up, leaning, with daylight through where its windows were, is
 * what makes it legible at range. They stand ON a corner, so they are inside the
 * stub line and cannot close the plan.
 */
function _shards(A, rng, spec, info, wallKey) {
  const pm = new THREE.Matrix4();
  const top = info.roofY ?? 9;
  const n = spec.w * spec.d > 200 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const side = rng.int(0, 3);
    const len = side === 0 || side === 2 ? spec.w : spec.d;
    const segLen = len * rng.range(0.16, 0.24);
    const at = (rng.float() < 0.5 ? -1 : 1) * (len / 2 - segLen / 2 - rng.range(0, len * 0.06));
    const h = Math.min(top * 0.62, rng.range(2.8, 4.6));
    panelAt(pm, spec, side, 0, at);
    const lean = rng.range(-0.055, 0.055);
    const m = pm.clone().multiply(
      new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(lean, 0, rng.range(-0.05, 0.05), 'YXZ'))
    );
    facadeWall(A, m, {
      w: segLen,
      h,
      t: spec.t ?? 0.34,
      key: wallKey,
      // One opening left in it, so there is daylight through the shard.
      openings: h > 3.2 ? [{ x: 0, y: h * 0.55, w: Math.min(segLen - 0.5, 1.15), h: 1.4, kind: 'window' }] : [],
      rng,
      top: 'ragged',
      raggedAmp: 0.8,
      warp: 0.04,
    });
    const bars = rng.int(3, 6);
    for (let b = 0; b < bars; b++) {
      const bl = rng.range(0.4, 1.1);
      A.add(
        'metal_rust',
        BOX_THIN(A),
        LL(m, rng.range(-segLen / 2 + 0.1, segLen / 2 - 0.1), h + bl * 0.4, 0.17,
          rng.range(-0.6, 0.6), 0.024, bl, 0.024, rng.range(-0.9, 0.9), rng.range(-0.9, 0.9)),
        { masks: [0.9, 0.7, 0.1] }
      );
    }
  }
}

/* ========================================================================== */
/* WHAT COMES OFF IT WHILE IT FALLS                                           */
/* ========================================================================== */

/**
 * THE MASS, PUBLISHED RATHER THAN BUILT.
 *
 * `src/match/airstrike.js` already owns a very good answer to "several hundred
 * pieces of masonry in the air with no CPU cost per frame": one closed-form
 * trajectory per chunk solved at boot, evaluated in the vertex shader off a
 * single uniform. `world` may not import it and it may not import `world`, so
 * what crosses the line is DATA — the boxes this building is made of, in the
 * building's own frame — and `match` cuts, throws and settles them with exactly
 * the code that already does it for the eleven strike sites.
 *
 *   size  [along level +X, up, along level +Z]
 *   at    the box centre in the same axes, measured from (spec.x, 0, spec.z)
 *   cut   the fracture grid; sized for ~1.3 m chunks, which is a piece of wall
 *         you can see tumble rather than a particle
 *   mat   0 = the render (this building's own plaster), 1 = structure
 */
/**
 * THE WINDOWS AND DOORS, SO THE WALL THAT FALLS IS STILL A FACADE.
 *
 * Without this the mass is four blank slabs, and the frame the strike fires on
 * replaces a three-storey elevation with balconies, shutters and open casements
 * by a beige rectangle — which is a worse picture than the building it is
 * supposed to be destroying, and it stays on screen for the whole second the
 * wall takes to come apart. Photographed and thrown away; that is the reason
 * this function exists.
 *
 * `buildBuilding` records every opening it cut in `info.windows` and
 * `info.doors`, in PANEL space: `x` along the elevation from its middle, `y`
 * above that storey's own datum. Both are turned into a box in the building's
 * frame here, and `Airstrike._buildDemoSite` drops any chunk whose centre lands
 * inside one — so the falling wall carries the holes the standing wall had.
 *
 * Side 0 is the -Z elevation and its panel +X is level +X; side 2 is mirrored;
 * side 1 (+X) runs along level +Z and side 3 (-X) against it. @see `SIDE` and
 * `panelMatrix` in buildings.js, which this has to agree with exactly.
 */
function _openings(spec, info, t) {
  const out = [[], [], [], []];
  const push = (side, along, y, hw, hh) => {
    // Chunks are ~1.3 m and a window is ~1.2 m, so the test is generous by a
    // quarter of a metre: an opening that removes no chunk at all is an opening
    // that is not in the picture.
    const rx = hw + 0.25;
    const ry = hh + 0.25;
    const deep = Math.max(t, 0.5);
    if (side === 0) out[0].push({ a: [along, y, -spec.d / 2], r: [rx, ry, deep] });
    else if (side === 2) out[2].push({ a: [-along, y, spec.d / 2], r: [rx, ry, deep] });
    else if (side === 1) out[1].push({ a: [spec.w / 2, y, along], r: [deep, ry, rx] });
    else out[3].push({ a: [-spec.w / 2, y, -along], r: [deep, ry, rx] });
  };
  for (const o of info.windows ?? []) {
    const base = info.floorY?.[o.f] ?? 0;
    push(o.side, o.x, base + o.y, o.w / 2, o.h / 2);
  }
  for (const d of info.doors ?? []) {
    // `buildFacade` cuts every ground-floor door at 1.12 x 2.16, centred 1.08 up.
    push(d.side, d.x, 1.08, 0.56, 1.08);
  }
  return out;
}

function _mass(spec, info) {
  const t = spec.t ?? 0.34;
  const W = spec.w;
  const D = spec.d;
  const top = (info.roofY ?? 9) + (spec.parapetH ?? 0.78);
  const H = top - STUB_BASE;
  const parts = [];
  const n = (m, per = 1.3) => Math.max(1, Math.round(m / per));
  const holes = _openings(spec, info, t);

  // the four elevations
  parts.push({ id: 'wallXp', mat: 0, size: [t, H, D], at: [(W - t) / 2, STUB_BASE + H / 2, 0], cut: [1, n(H), n(D)], holes: holes[1] });
  parts.push({ id: 'wallXn', mat: 0, size: [t, H, D], at: [-(W - t) / 2, STUB_BASE + H / 2, 0], cut: [1, n(H), n(D)], holes: holes[3] });
  parts.push({ id: 'wallZp', mat: 0, size: [W - t * 2, H, t], at: [0, STUB_BASE + H / 2, (D - t) / 2], cut: [n(W), n(H), 1], holes: holes[2] });
  parts.push({ id: 'wallZn', mat: 0, size: [W - t * 2, H, t], at: [0, STUB_BASE + H / 2, -(D - t) / 2], cut: [n(W), n(H), 1], holes: holes[0] });

  // every floor plate above the ground, and the roof
  const ys = [...(info.floorY ?? []).slice(1), info.roofY ?? 9];
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i];
    if (y <= STUB_BASE + 0.5) continue;
    parts.push({
      id: `slab${i}`,
      mat: 1,
      size: [W - t * 2, 0.24, D - t * 2],
      at: [0, y - 0.12, 0],
      // Slabs cut coarser than the walls: a floor plate comes down in big pieces.
      cut: [n(W, 1.9), 1, n(D, 1.9)],
    });
  }

  // the parapet ring on top, in four runs
  const ph = spec.parapetH ?? 0.78;
  const py = (info.roofY ?? 9) + ph / 2;
  parts.push({ id: 'papXp', mat: 1, size: [0.24, ph, D + 0.1], at: [W / 2, py, 0], cut: [1, 1, n(D, 1.7)] });
  parts.push({ id: 'papXn', mat: 1, size: [0.24, ph, D + 0.1], at: [-W / 2, py, 0], cut: [1, 1, n(D, 1.7)] });
  parts.push({ id: 'papZp', mat: 1, size: [W - 0.4, ph, 0.24], at: [0, py, D / 2], cut: [n(W, 1.7), 1, 1] });
  parts.push({ id: 'papZn', mat: 1, size: [W - 0.4, ph, 0.24], at: [0, py, -D / 2], cut: [n(W, 1.7), 1, 1] });

  return parts;
}

/* ========================================================================== */
/* PUBLISH                                                                    */
/* ========================================================================== */

/**
 * Turn the records into the list `world` publishes and `match` consumes: world
 * positions, the falling mass, and the two switches. Called after `A.finalize`,
 * which is where the scopes' meshes and collision handles come from.
 */
export function publishDemolitions(A, records, physics, root) {
  const out = [];
  for (const rec of records) {
    if (!rec.shell || !rec.ruin || !rec.info) {
      console.error(`[world] demolition ${rec.id}: shell or ruin scope missing — SKIPPED`);
      continue;
    }
    const spec = rec.spec;
    rec.mass = _mass(spec, rec.info);
    rec.tint = PALETTE[spec.wallKey ?? 'plaster_cream']?.opts?.tint ?? 0xbfae92;
    rec.position = A.toWorld(spec.x, 0, spec.z, new THREE.Vector3());
    rec.top = (rec.info.roofY ?? 9) + (spec.parapetH ?? 0.78);
    rec.radius = Math.hypot(spec.w, spec.d) * 0.5;
    rec.halfW = spec.w / 2;
    rec.halfD = spec.d / 2;
    rec.level = { x: spec.x, z: spec.z };
    // The world-space AABB the debris changes, for whoever has to re-probe it.
    {
      const r = Math.hypot(spec.w / 2 + APRON, spec.d / 2 + APRON);
      rec.navRect = {
        x0: rec.position.x - r, x1: rec.position.x + r,
        z0: rec.position.z - r, z1: rec.position.z + r,
      };
    }

    // The ruin starts hidden and intangible; the shell starts standing.
    A.setScopeVisible(rec.ruin, false);
    A.setScopeSolid(rec.ruin, physics, false);

    /** Geometry only — the picture, with no opinion about collision. */
    rec.setVisual = (down) => {
      A.setScopeVisible(rec.shell, !down);
      A.setScopeVisible(rec.ruin, down);
    };
    /**
     * Collision and therefore navigation. Kept SEPARATE from the picture because
     * `src/match/airstrike.js` has to make the ruin solid, re-probe a few hundred
     * nav cells against it and put it back — at boot, with the building visibly
     * standing the whole time. @see `Airstrike._bakeNavPatch`.
     */
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
  console.info(
    `[world] demolition: ${out.length} buildings carry a destroyed state — ` +
      out
        .map(
          (r) =>
            `${r.id}(${(r.shell.tris / 1000).toFixed(1)}k->${(r.ruin.tris / 1000).toFixed(1)}k tris, ` +
              `${r.mass.length} masses)`
        )
        .join(' ')
  );
  return out;
}
