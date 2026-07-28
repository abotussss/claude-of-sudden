import * as THREE from 'three';
import { BOX, BOX_SOFT, BOX_THIN, IDENT, LL } from './kit.js';
import { chamferBox, patchGeometry, fillMasks, paintMasks } from './util.js';
import { RELIEF } from './layout.js';

/**
 * WORLD — RELIEF: the map's third dimension.
 *
 * WHAT WAS WRONG. A previous pass flattened the terrain across the whole play
 * box (`FLAT` in layout.js, and it was the right call — ±0.55 m of dune under a
 * lane you fight down is a lane where your crosshair sits on a hill). What it
 * left behind was a level whose entire playable surface was one plane: every
 * duel on the map was fought between two people standing at exactly the same
 * height, and "もっと高低差などをつけて" is the entirely fair verdict on that.
 *
 * THE HARD CONSTRAINT, and it decides the whole design. `src/ai/nav.js` is a
 * 2.5D HEIGHT FIELD — `this.floor = new Float32Array(n)`, ONE height per (x, z)
 * cell, sampled by dropping a ray from above. So:
 *
 *   - a RAMP is height a bot can use: the field follows it, and at 1.15 m over
 *     4 m the rise per 0.8 m cell is 0.23, well inside `maxStep` 0.45 and the
 *     46° slope limit;
 *   - a STAIR is not: 0.19 m of rise per 0.275 m of run puts 0.55 m between
 *     adjacent cells and half the samples land on a vertical riser;
 *   - anything STACKED — a catwalk, a roof, a crate to mantle off — overwrites
 *     the ground under it, because the ray hits the deck first and the cells
 *     below it disappear from the grid.
 *
 * So the split is explicit and structural, not stylistic:
 *
 *   `terraces`  raised ground with ramps at both ends. Bots walk them. They sit
 *               on ONE HALF of a lane's width so the flat half is always there
 *               as an alternative, and they change the fight: the attack coming
 *               down a lane now has a high side and a low side to choose.
 *   `decks`     catwalks over the outer strip of a site courtyard. PLAYER ONLY,
 *               and deliberately over the 2 m strip against the perimeter wall
 *               that no bot route needs — the cells they cost the grid are ones
 *               A* was never going to use.
 *   `blocks`    the containers and crates you mantle off to reach a deck or a
 *               roof. Each one is under `MOVE.mantle.maxHeight` (1.85 m) from
 *               the thing below it, which is the whole reason they come in
 *               pairs instead of being one 2.6 m box.
 *
 * `navcheck` is the gate on every line of this: every spawn must still reach
 * every site, and it is run after each change rather than at the end.
 */

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3(1, 1, 1);
const _eul = new THREE.Euler();

/** side -> outward unit vector, matching the rest of the level (0=-Z … 3=-X). */
const OUT = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * ANALYTIC RELIEF HEIGHT at a level-space point.
 *
 * `dressing.groundY` calls this, which is what makes the hundreds of scattered
 * props, stains and skirts follow a terrace up instead of being buried inside
 * it. It has to agree with the geometry built below to within a centimetre or
 * props float; both read the same numbers out of `RELIEF`, so the only way they
 * can disagree is if one of them is edited alone.
 */
export function reliefY(x, z) {
  let y = 0;
  for (const t of RELIEF.terraces) {
    const [x0, z0, x1, z1] = t.rect;
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return t.h;
    // on a ramp? each ramp runs outward from one side of the deck
    for (const r of t.ramps) {
      const [ox, oz] = OUT[r.side];
      // ramp footprint: the face it springs from, extended `len` outward
      const rx0 = ox > 0 ? x1 : ox < 0 ? x0 - r.len : x0;
      const rx1 = ox > 0 ? x1 + r.len : ox < 0 ? x0 : x1;
      const rz0 = oz > 0 ? z1 : oz < 0 ? z0 - r.len : z0;
      const rz1 = oz > 0 ? z1 + r.len : oz < 0 ? z0 : z1;
      if (x < rx0 || x > rx1 || z < rz0 || z > rz1) continue;
      // 0 at the outer toe, 1 where it meets the terrace
      const along = ox !== 0 ? (ox > 0 ? rx1 - x : x - rx0) : oz > 0 ? rz1 - z : z - rz0;
      const f = Math.min(1, Math.max(0, along / r.len));
      if (t.h * f > y) y = t.h * f;
    }
  }
  return y;
}

/** Is (x, z) under a player-only deck or on a mantle block? Props keep off. */
export function inRelief(x, z, m = 0.3) {
  for (const d of RELIEF.decks) {
    const [x0, z0, x1, z1] = d.rect;
    if (x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m) return true;
  }
  for (const b of RELIEF.blocks) {
    const [x0, z0, x1, z1] = b.rect;
    if (x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m) return true;
  }
  return false;
}

/**
 * A ramp: a wedge rising from 0 at the toe to `h` at the head.
 *
 * Built as real geometry rather than a rotated box because the toe has to meet
 * the ground on a knife edge — a tilted slab leaves a lip you trip on, and the
 * character controller's step check would see it as a 0.1 m wall at the bottom
 * of every ramp on the map.
 */
function rampGeometry(w, len, h) {
  // local: x across, z from toe (0) to head (len), y up
  const p = new Float32Array([
    // top surface
    -w / 2, 0, 0, w / 2, 0, 0, w / 2, h, len, -w / 2, h, len,
    // left side
    -w / 2, 0, 0, -w / 2, h, len, -w / 2, 0, len,
    // right side
    w / 2, 0, 0, w / 2, 0, len, w / 2, h, len,
    // head (vertical face under the top edge)
    -w / 2, 0, len, -w / 2, h, len, w / 2, h, len, w / 2, 0, len,
  ]);
  // Wound so every face points OUT of the solid; a flipped ramp top is invisible
  // from above and shadow-maps as a hole.
  const idx = [0, 2, 1, 0, 3, 2, 4, 6, 5, 7, 9, 8, 10, 12, 11, 10, 13, 12];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * The visible mass of a terrace: a retaining wall of blocks with a coping
 * course on top, not one extruded rectangle.
 *
 * The quality bar forbids flat untextured surfaces and this is the biggest new
 * surface in the level, so the wall is coursed — every block is its own box
 * with its own length, a millimetre of set-back jitter and its own wear mask —
 * and the top is dirt and gravel rather than more concrete, with the coping
 * standing 40 mm proud of it so the edge catches the sun.
 */
function retainingWall(A, rng, x0, z0, x1, z1, h, key, sides) {
  const COURSE = 0.38;
  const courses = Math.max(2, Math.round(h / COURSE));
  const ch = h / courses;
  for (const side of sides) {
    const [ox, oz] = OUT[side];
    const alongX = ox === 0;
    const a = alongX ? x0 : z0;
    const b = alongX ? x1 : z1;
    const fixed = ox > 0 ? x1 : ox < 0 ? x0 : oz > 0 ? z1 : z0;
    for (let c = 0; c < courses; c++) {
      const cy = (c + 0.5) * ch;
      // Stagger the perpends course by course, the way a real wall is laid.
      let t = a + (c % 2 ? rng.range(0.15, 0.5) : 0);
      while (t < b - 0.05) {
        const bl = Math.min(rng.range(0.55, 1.15), b - t);
        if (bl < 0.18) break;
        const set = rng.range(-0.012, 0.018); // faces are never flush
        const cxm = alongX ? t + bl / 2 : fixed + (ox * (0.11 + set));
        const czm = alongX ? fixed + oz * (0.11 + set) : t + bl / 2;
        A.add(
          key,
          BOX(A),
          LL(IDENT, cxm, cy, czm, 0, alongX ? bl - 0.03 : 0.22, ch - 0.025, alongX ? 0.22 : bl - 0.03),
          { masks: [rng.range(0.35, 0.95), rng.range(0.25, 0.8), 0.35 + (1 - cy / h) * 0.4] }
        );
        t += bl + rng.range(0.012, 0.035);
      }
    }
    // coping: a continuous capping course, proud of the deck surface
    const cw = alongX ? b - a : 0.34;
    const cd = alongX ? 0.34 : b - a;
    A.add(
      'concrete_dark',
      BOX_SOFT(A),
      LL(
        IDENT,
        alongX ? (a + b) / 2 : fixed + ox * 0.08,
        h + 0.04,
        alongX ? fixed + oz * 0.08 : (a + b) / 2,
        0,
        cw,
        0.12,
        cd
      ),
      { masks: [0.95, 0.4, 0.1] }
    );
  }
}

/** A raised, ramped terrace — bot-usable ground. */
function buildTerrace(A, rng, t) {
  const [x0, z0, x1, z1] = t.rect;
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const key = t.key ?? 'concrete';

  // ---- the mass. One collision box; the visible faces are the coursed wall.
  A.box('concrete', cx, t.h / 2, cz, w, t.h, d);
  // A dark core so a gap between courses never shows sky through the terrace.
  A.add('concrete_dark', BOX(A), LL(IDENT, cx, t.h / 2 - 0.06, cz, 0, w - 0.3, t.h, d - 0.3), {
    masks: [0.2, 0.8, 0.7],
  });

  // ---- which faces are exposed: any not swallowed by a ramp
  const ramped = new Set(t.ramps.map((r) => r.side));
  retainingWall(A, rng, x0, z0, x1, z1, t.h, key, [0, 1, 2, 3].filter((s) => !ramped.has(s)));

  // ---- the walking surface. Dirt and grit, not another concrete slab.
  A.add(t.topKey ?? 'dirt', BOX(A), LL(IDENT, cx, t.h - 0.03, cz, 0, w - 0.02, 0.08, d - 0.02), {
    masks: [0.2, 0.65, 0.4],
  });
  const patches = Math.round(w * d * 0.18);
  for (let i = 0; i < patches; i++) {
    const g = patchGeometry(rng, rng.range(0.35, 1.1), { lobes: 10, wobble: 0.55 });
    A.addOnce(
      rng.float() < 0.45 ? 'gravel' : 'sand',
      g,
      LL(IDENT, rng.range(x0 + 0.3, x1 - 0.3), t.h + 0.018, rng.range(z0 + 0.3, z1 - 0.3), rng.float() * 6.28, 1, 1, rng.range(0.5, 1.0)),
      { masks: [0.15, rng.range(0.3, 0.8), rng.range(0.2, 0.5)] }
    );
  }
  // Spill: sand and rubble washed down the exposed faces, so the terrace does
  // not meet the lane on a drawn line.
  const openSides = [0, 1, 2, 3].filter((s) => !ramped.has(s));
  for (let i = 0; i < Math.round((w + d) * 1.4); i++) {
    const [ox, oz] = OUT[openSides[rng.int(0, openSides.length - 1)]];
    const px = ox !== 0 ? (ox > 0 ? x1 : x0) + ox * rng.range(0.15, 1.1) : rng.range(x0, x1);
    const pz = oz !== 0 ? (oz > 0 ? z1 : z0) + oz * rng.range(0.15, 1.1) : rng.range(z0, z1);
    const g = patchGeometry(rng, rng.range(0.3, 0.8), { lobes: 9, wobble: 0.6 });
    A.addOnce('sand', g, LL(IDENT, px, 0.045, pz, rng.float() * 6.28, 1, 1, rng.range(0.5, 0.9)), {
      masks: [0.12, 0.6, 0.45],
    });
    if (A.has('rock_b') && rng.float() < 0.5) {
      A.put(rng.float() < 0.6 ? 'rock_b' : 'rock_a', px, 0.04, pz, rng.float() * 6.28, rng.range(0.5, 1.1), [1, 1.3, 1]);
    }
  }

  // ---- ramps
  for (const r of t.ramps) {
    const [ox, oz] = OUT[r.side];
    const alongX = ox !== 0;
    const rw = alongX ? d : w;
    // local +Z of the wedge runs from the toe INTO the terrace, i.e. -OUT[side]
    const yaw = r.side === 0 ? 0 : r.side === 1 ? -Math.PI / 2 : r.side === 2 ? Math.PI : Math.PI / 2;
    // toe sits `len` outward of the face; the wedge runs from the toe inward
    const fx = ox > 0 ? x1 : ox < 0 ? x0 : cx;
    const fz = oz > 0 ? z1 : oz < 0 ? z0 : cz;
    const tx = fx + ox * r.len;
    const tz = fz + oz * r.len;
    _eul.set(0, yaw, 0);
    _quat.setFromEuler(_eul);
    _pos.set(tx, 0, tz);
    const pm = new THREE.Matrix4().compose(_pos, _quat, _scl);
    const geo = rampGeometry(rw, r.len, t.h);
    paintMasks(geo, (px, py, pz, nx, ny, nz, out) => {
      out[0] = ny > 0.5 ? 0.55 : 0.85;
      out[1] = 0.35 + (1 - py / t.h) * 0.4;
      out[2] = ny > 0.5 ? 0.15 : 0.4;
    });
    A.add(key, geo, pm);
    A.collideGeo('concrete', geo, pm);
    geo.dispose();
    // Kerb rails down both sides of the ramp: the edge is the read.
    for (const s of [-1, 1]) {
      const kg = chamferBox(0.16, 0.16, Math.hypot(r.len, t.h), 0.02);
      fillMasks(kg, 0.9, 0.45, 0.2);
      A.addOnce(
        'concrete_dark',
        kg,
        LL(pm, s * (rw / 2 - 0.08), t.h / 2 + 0.06, r.len / 2, 0, 1, 1, 1, -Math.atan2(t.h, r.len))
      );
    }
    // grit swept down the ramp
    for (let i = 0; i < Math.round(r.len * 2.2); i++) {
      const tt = rng.float();
      const g = patchGeometry(rng, rng.range(0.25, 0.7), { lobes: 9, wobble: 0.6 });
      A.addOnce(
        'sand',
        g,
        LL(pm, rng.range(-rw / 2 + 0.3, rw / 2 - 0.3), t.h * tt + 0.02, r.len * tt, rng.float() * 6.28, 1, 1, rng.range(0.5, 0.9)),
        { masks: [0.12, 0.55, 0.35] }
      );
    }
  }
}

/**
 * A catwalk over the outer strip of a site courtyard. PLAYER ONLY.
 *
 * Steel joists on legs, planked, with a handrail on the open side. The legs are
 * modelled and given collision so you cannot walk through them, and the deck is
 * one collision box — the planks themselves are visual.
 */
function buildDeck(A, rng, dk) {
  const [x0, z0, x1, z1] = dk.rect;
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const y = dk.y;
  const alongZ = d > w;
  const span = alongZ ? d : w;
  const width = alongZ ? w : d;

  // ---- legs, every ~2.2 m down the open side (the wall carries the other)
  const legs = Math.max(2, Math.round(span / 2.2));
  for (let i = 0; i <= legs; i++) {
    const t = i / legs;
    const px = alongZ ? cx + width / 2 - 0.18 : x0 + w * t;
    const pz = alongZ ? z0 + d * t : cz + width / 2 - 0.18;
    const lx = Math.min(Math.max(px, x0 + 0.18), x1 - 0.18);
    const lz = Math.min(Math.max(pz, z0 + 0.18), z1 - 0.18);
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, lx, (y - 0.12) / 2, lz, rng.range(-0.02, 0.02), 0.16, y - 0.12, 0.16), {
      masks: [0.85, 0.55, 0.35],
    });
    A.box('metal', lx, (y - 0.12) / 2, lz, 0.2, y - 0.12, 0.2);
    // a diagonal brace back to the wall
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, alongZ ? (lx + x0) / 2 : lx, y - 0.75, alongZ ? lz : (lz + z0) / 2, 0, alongZ ? width : 0.08, 0.08, alongZ ? 0.08 : width, 0, alongZ ? -0.75 : 0), {
      masks: [0.9, 0.6, 0.4],
    });
  }

  // ---- joists and planking
  A.add('metal_rust', BOX(A), LL(IDENT, cx, y - 0.16, cz, 0, w - 0.05, 0.14, d - 0.05), {
    masks: [0.8, 0.5, 0.55],
  });
  const planks = Math.round(span / 0.34);
  for (let i = 0; i < planks; i++) {
    const t = (i + 0.5) / planks;
    const pw = alongZ ? width - 0.06 : span / planks - 0.03;
    const pd = alongZ ? span / planks - 0.03 : width - 0.06;
    A.add(
      rng.float() < 0.25 ? 'wood_dark' : 'wood_prop_dark',
      BOX(A),
      LL(
        IDENT,
        alongZ ? cx : x0 + w * t,
        y - 0.045 + rng.range(-0.006, 0.006),
        alongZ ? z0 + d * t : cz,
        rng.range(-0.006, 0.006),
        pw,
        0.075,
        pd
      ),
      { masks: [rng.range(0.5, 1.0), rng.range(0.3, 0.85), 0.2] }
    );
  }
  A.box('wood', cx, y - 0.06, cz, w, 0.14, d);

  // ---- handrail on the open side, and a kick plate
  const [rox, roz] = OUT[dk.railSide];
  const rx = rox > 0 ? x1 - 0.07 : rox < 0 ? x0 + 0.07 : cx;
  const rz = roz > 0 ? z1 - 0.07 : roz < 0 ? z0 + 0.07 : cz;
  const rl = alongZ ? (rox !== 0 ? d : w) : roz !== 0 ? w : d;
  const railAlongZ = rox !== 0;
  A.add('metal_rust', BOX_THIN(A), LL(IDENT, rx, y + 0.98, rz, 0, railAlongZ ? 0.06 : rl, 0.06, railAlongZ ? rl : 0.06), {
    masks: [0.9, 0.5, 0],
  });
  A.add('metal_rust', BOX_THIN(A), LL(IDENT, rx, y + 0.52, rz, 0, railAlongZ ? 0.045 : rl, 0.045, railAlongZ ? rl : 0.045), {
    masks: [0.9, 0.55, 0],
  });
  const posts = Math.max(2, Math.round(rl / 1.3));
  for (let i = 0; i <= posts; i++) {
    const t = i / posts;
    A.add(
      'metal_rust',
      BOX_THIN(A),
      LL(IDENT, railAlongZ ? rx : x0 + w * t, y + 0.5, railAlongZ ? z0 + d * t : rz, 0, 0.055, 1.0, 0.055),
      { masks: [0.9, 0.6, 0.1] }
    );
  }
  A.box('metal', rx, y + 0.5, rz, railAlongZ ? 0.12 : rl, 1.0, railAlongZ ? rl : 0.12);
}

/**
 * A mantle block — the shipping container or crate stack that gets a player up
 * onto a deck or a roof.
 *
 * Every one of these is authored so the climb from whatever is below it is
 * under `MOVE.mantle.maxHeight` (1.85 m). That is why the K1 stack is two boxes
 * and not one: the roof parapet stands at 3.8 m and 3.8 m is not a mantle.
 */
function buildBlock(A, rng, b) {
  const [x0, z0, x1, z1] = b.rect;
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const base = b.base ?? 0;
  const h = b.h - base;
  const key = b.key ?? 'metal_blue';
  A.box('metal', cx, base + h / 2, cz, w, h, d);
  // corrugated body with a proper frame — a plain box reads as a grey brick
  A.add('corrugated', BOX(A), LL(IDENT, cx, base + h / 2, cz, 0, w - 0.09, h - 0.14, d - 0.09), {
    masks: [0.55, 0.65, 0.4],
  });
  A.add(key, BOX(A), LL(IDENT, cx, base + h / 2, cz, 0, w, h - 0.2, d - 0.14), {
    masks: [0.4, 0.5, 0.3],
  });
  A.add(key, BOX(A), LL(IDENT, cx, base + h / 2, cz, 0, w - 0.14, h - 0.2, d), {
    masks: [0.4, 0.5, 0.3],
  });
  // corner castings and the top rail, which is what you actually grab
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      A.add('metal_dark', BOX(A), LL(IDENT, cx + sx * (w / 2 - 0.1), base + h - 0.12, cz + sz * (d / 2 - 0.1), 0, 0.24, 0.24, 0.24), {
        masks: [0.95, 0.6, 0.2],
      });
      A.add('metal_dark', BOX(A), LL(IDENT, cx + sx * (w / 2 - 0.1), base + 0.12, cz + sz * (d / 2 - 0.1), 0, 0.24, 0.24, 0.24), {
        masks: [0.95, 0.75, 0.45],
      });
    }
  }
  A.add(key, BOX_SOFT(A), LL(IDENT, cx, base + h - 0.05, cz, 0, w + 0.03, 0.1, d + 0.03), {
    masks: [0.9, 0.45, 0.1],
  });
  // rust running down from the top rail, and a dust ring where it meets ground
  for (let i = 0; i < 7; i++) {
    const s = rng.float() < 0.5 ? -1 : 1;
    const along = rng.range(-0.4, 0.4);
    A.add(
      'metal_rust',
      BOX_THIN(A),
      LL(IDENT, cx + (w > d ? along * w : s * (w / 2 + 0.005)), base + h * rng.range(0.35, 0.75), cz + (w > d ? s * (d / 2 + 0.005) : along * d), 0, w > d ? rng.range(0.1, 0.3) : 0.01, h * rng.range(0.2, 0.5), w > d ? 0.01 : rng.range(0.1, 0.3)),
      { masks: [1, 0.9, 0.2] }
    );
  }
  if (base === 0) {
    for (let i = 0; i < 10; i++) {
      const g = patchGeometry(rng, rng.range(0.3, 0.75), { lobes: 9, wobble: 0.6 });
      const s = rng.float() < 0.5 ? -1 : 1;
      A.addOnce(
        'sand',
        g,
        LL(IDENT, cx + rng.range(-w / 2 - 0.5, w / 2 + 0.5), 0.04, cz + s * (d / 2 + rng.range(-0.1, 0.5)), rng.float() * 6.28, 1, 1, rng.range(0.5, 0.9)),
        { masks: [0.12, 0.7, 0.5] }
      );
    }
  }
}

/** Build every authored relief feature. Called from `WorldSystem.init`. */
export function buildRelief(A, rng) {
  for (const t of RELIEF.terraces) buildTerrace(A, rng, t);
  for (const d of RELIEF.decks) buildDeck(A, rng, d);
  for (const b of RELIEF.blocks) buildBlock(A, rng, b);
}
