import { BOX, BOX_FINE, BOX_SOFT, BOX_THIN, PANE, IDENT, LL } from '../kit.js';
import { fbm3, patchGeometry, driftBerm } from '../util.js';
import { Rng } from '../../core/rng.js';
import {
  RAMP_GRADE, octagon, edgeInfo, prism, wallRun, ramp, interiorVolume,
  debrisField, drawDebris, ladder, handrail, practical, embrasure,
} from './plains-works.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD — DIE SCHANZE. The fortress. 「要塞がある平原」
 * ════════════════════════════════════════════════════════════════════════════
 * The other anchor. The control tower stands 32 m NORTH of zone D on the
 * attack's side of the centre; this stands 48 m SOUTH of it on the defence's,
 * and the twenty-one metres of open plain between the two is the capture point.
 * That is the whole shape of the middle of this map: two things worth holding,
 * facing each other across ground neither of them covers from behind.
 *
 * IT IS A REAL FORTIFICATION AND EVERY PART OF IT IS DOING A JOB:
 *
 *   THE TRACE is an octagon — a square has four bearings it cannot shoot along
 *   and the cut corners are the answer, which is the reason the shape exists.
 *   60 m across the flats, four flat curtains and four chamfered BASTIONS that
 *   project 6 m so each one flanks the two curtains beside it.
 *
 *   THE CURTAIN is a 6 m thick battered rampart, 4.4 m to the walk and 5.9 m to
 *   the top of the parapet. Thick because a wall you cannot stand on is a fence:
 *   the walk is 4.4 m clear inside the parapet, which is five nav cells, so the
 *   bots hold it as ordinary ground rather than as a ledge.
 *
 *   TWO GATES, north and south, each a 4.6 m passage cut clean through the six
 *   metres of rampart with a pair of solid gate towers over it and the walk
 *   carried across on a bridge. The north gate faces the tower and the capture
 *   point; the south gate faces the defence's own base.
 *
 *   THE COURTYARD is 48 m across with a magazine in the middle of it, and both
 *   are ground a bot can be on — @see NAV below.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NAV — WHAT THE HEIGHT FIELD CAN AND CANNOT SEE HERE
 * ────────────────────────────────────────────────────────────────────────────
 * `NavGrid` keeps one floor per 0.8 m cell (@see the header of
 * `plains-tower.js`, which has the measurements). The consequence for a walled
 * enclosure is specific and it is the thing that would silently break it: the
 * courtyard is open sky and therefore samples fine, but THE GATE PASSAGES DO
 * NOT — the ray from above hits the rampart carried over them, so both passages
 * come back as 4.4 m of solid wall and the courtyard is a 48 m island with a
 * magazine and no way in.
 *
 * So each passage publishes an `interiorVolume`. It is legal there for the same
 * reason it is legal under the tower's shaft and illegal under its decks: the
 * re-probe REPLACES the cell's floor, and what it replaces at a gate is 4 m² of
 * bridge that the walk does not need — the walk is reached from the courtyard
 * ramps, and it is a ring, so losing two cells of it at each gate costs nothing.
 *
 *   ground/courtyard  0.0 m   ◄── AI, through both gate passages
 *   the magazine      0.14 m  ◄── AI, its own interiorVolume
 *   the rampart walk  4.4 m   ◄── AI, two ramps off the courtyard
 *   gate tower tops, magazine roof            player only, and deliberately so
 */

// ────────────────────────────────────────────────────────────────── the plan ──
/** Where it stands. @see `PADS` in plains.js — its pad shares zone D's datum. */
export const FORT = { x: 0, z: 48 };

const R_OUT = 30;
const CUT = 10;
/** Rampart thickness, so the inner face stands at R_OUT - RAMP_T. */
const RAMP_T = 6.0;
const R_IN = R_OUT - RAMP_T;
const WALK_Y = 4.4;
const PARAPET_H = 1.5;
const PARAPET_T = 0.7;
/** How far a bastion projects past the trace on its chamfer. */
const BASTION = 6.0;

const GATE_W = 4.6;
const GATE_H = 3.4;
const TOWER_H = 8.2;

/** The magazine in the middle of the courtyard. */
const MAG = { hw: 8.0, hd: 6.0, wall: 0.8, roof: 5.0, floor: 0.14 };

/** Full footprint, published so `plains.js` can keep the scatter out of it. */
export const FORT_R = R_OUT + BASTION + 5;

const TRACE = octagon(R_OUT, CUT).map(([x, z]) => [x + FORT.x, z + FORT.z]);

/** Which edges of the trace are what. Edge 0 runs +X on the -Z flat. */
const isFlat = (e) => Math.abs(e.nx) > 0.9 || Math.abs(e.nz) > 0.9;
const isGate = (e) => Math.abs(e.nz) > 0.9;

// ──────────────────────────────────────────────────────────────────── build ──
export function buildFort(A, groundY) {
  /** Its own stream — @see the same note in `plains-tower.js`. */
  const rng = new Rng(0x50f7ad);
  const Y0 = groundY(FORT.x, FORT.z);
  const y = (v) => Y0 + v;
  const volumes = [];

  glacis(A, rng, y, groundY);

  /**
   * THE SUPERSTRUCTURE IS THE SCOPE, and it is a different cut from the tower's
   * for the same reason: what may come down is what the AI is not standing on.
   * Here that is the parapet along the whole curtain, both gatehouses, the
   * magazine and the two north bastions. The 6 m rampart under the walk stays —
   * it is the only high ground the bots have inside the wall, and levelling it
   * would replace a fortress with a car park.
   */
  const shell = A.beginScope('shell:NF-FORT');
  parapets(A, rng, y);
  gatehouses(A, rng, y);
  volumes.push(magazine(A, rng, y));
  A.endScope();

  curtain(A, rng, y);
  volumes.push(...gates(A, rng, y));
  courtyardRamps(A, rng, y);
  courtyard(A, rng, y);

  const ruin = A.beginScope('ruin:NF-FORT');
  buildFortRuin(A, new Rng(0x50f7ae), y);
  A.endScope();

  return {
    interiorVolumes: volumes,
    demolition: {
      id: 'NF-FORT',
      name: 'THE FORTRESS',
      zone: 'D',
      /** Its crown comes off; the ways in do not change. @see the ruin. */
      opens: false,
      shell, ruin,
      x: FORT.x, z: FORT.z,
      baseY: y(0),
      top: y(TOWER_H),
      radius: R_OUT + BASTION,
      halfW: MAG.hw, halfD: MAG.hd,
      surfaces: ['concrete', 'plaster'],
      tint: 0xa89e8c,
      mass: fortMass(y),
    },
  };
}

/**
 * The falling mass, in `demolition._mass`' exact shape — see the long note on
 * `towerMass` in plains-tower.js, and the crash that produced it. The magazine
 * and the two gatehouses are what a strike takes; the curtain is not in the
 * list because the curtain does not go.
 */
function fortMass(y) {
  const n = (m, per = 1.5) => Math.max(1, Math.round(m / per));
  const t = MAG.wall;
  const W = MAG.hw * 2, D = MAG.hd * 2, H = MAG.roof;
  const parts = [
    { id: 'magXp', mat: 0, size: [t, H, D], at: [(W - t) / 2, y(H / 2), 0], cut: [1, n(H), n(D)] },
    { id: 'magXn', mat: 0, size: [t, H, D], at: [-(W - t) / 2, y(H / 2), 0], cut: [1, n(H), n(D)] },
    { id: 'magZp', mat: 0, size: [W - t * 2, H, t], at: [0, y(H / 2), (D - t) / 2], cut: [n(W), n(H), 1] },
    { id: 'magZn', mat: 0, size: [W - t * 2, H, t], at: [0, y(H / 2), -(D - t) / 2], cut: [n(W), n(H), 1] },
    { id: 'magroof', mat: 1, size: [W + 0.6, 0.44, D + 0.6], at: [0, y(H + 0.2), 0], cut: [n(W, 1.9), 1, n(D, 1.9)] },
  ];
  // the two gatehouses, on the trace's ±Z flats
  for (const s of [-1, 1]) {
    const gz = s * R_OUT;
    for (const k of [-1, 1]) {
      parts.push({
        id: `gt${s}${k}`, mat: 1, size: [5.6, TOWER_H, 5.6],
        at: [k * (GATE_W / 2 + 3.4), y(TOWER_H / 2), gz], cut: [4, n(TOWER_H), 4],
      });
    }
    parts.push({
      id: `gb${s}`, mat: 1, size: [GATE_W + 7, TOWER_H - WALK_Y, RAMP_T],
      at: [0, y((TOWER_H + WALK_Y) / 2), gz], cut: [n(GATE_W + 7), 2, n(RAMP_T)],
    });
  }
  return parts;
}

// ────────────────────────────────────────────────────────────────── curtain ──
/**
 * THE RAMPART. One oriented box of mass per edge — solid, so its TOP FACE is
 * the walk the height field samples — plus a battered revetment on the outer
 * face, a lighter one inside, and the bastions on the four chamfers.
 *
 * A prism of the whole trace would be a 60 m paperweight with the courtyard
 * inside it; a ring of boxes overlapping at the joints is the shape that is
 * actually hollow, and the overlaps are all convex so nothing pokes through.
 */
function curtain(A, rng, y) {
  for (let i = 0; i < TRACE.length; i++) {
    const e = edgeInfo(TRACE, i);
    const gate = isGate(e);
    const flat = isFlat(e);
    const proj = flat ? 0 : BASTION;
    /**
     * THE CORNERS HAVE TO BE CLOSED BY HAND. A ring of one box per edge leaves a
     * wedge of nothing where a flat curtain meets a chamfered bastion — measured
     * on the first build, four notches in the enceinte with the courtyard's own
     * floor in them at r 31. So every FLAT run is extended along its own tangent
     * to the trace's full half-width; the overrun is buried inside the bastion
     * mass, which projects 6 m further out than it does.
     */
    const over = flat ? (R_OUT - e.len / 2) : 0;
    const cx = e.mx + e.nx * (proj - RAMP_T / 2);
    const cz = e.mz + e.nz * (proj - RAMP_T / 2);
    const t = RAMP_T + proj;
    if (gate) {
      // two piers with the passage between them; the bridge over it is in `gates`
      const seg = (e.len - GATE_W) / 2 + over;
      for (const s of [-1, 1]) {
        const px = cx + e.tx * s * (GATE_W / 2 + seg / 2);
        const pz = cz + e.tz * s * (GATE_W / 2 + seg / 2);
        A.box('concrete', px, y(WALK_Y / 2), pz, t, WALK_Y, seg, e.yaw);
        A.add('concrete', BOX(A), LL(IDENT, px, y(WALK_Y / 2), pz, e.yaw, t, WALK_Y, seg), {
          paint: rampartPaint(y(0)),
        });
      }
    } else {
      const len = e.len + over * 2 + 1.2;
      A.box('concrete', cx, y(WALK_Y / 2), cz, t, WALK_Y, len, e.yaw);
      A.add('concrete', BOX(A), LL(IDENT, cx, y(WALK_Y / 2), cz, e.yaw, t, WALK_Y, len), {
        paint: rampartPaint(y(0)),
      });
    }

    /**
     * The outer revetment and the splayed plinth under it, in one run per edge —
     * or in TWO either side of a gate, because a 0.57 m plinth carried across
     * the opening is a step the height field refuses and the courtyard is then
     * a 5 477-cell island with two arches nobody can walk through.
     */
    const ox = e.mx + e.nx * proj;
    const oz = e.mz + e.nz * proj;
    const spans = gate
      ? [[-e.len / 2, -GATE_W / 2 - 0.5], [GATE_W / 2 + 0.5, e.len / 2]]
      : [[-e.len / 2, e.len / 2]];
    for (const [a, b] of spans) {
      const ax = ox + e.tx * a, az = oz + e.tz * a;
      const bx = ox + e.tx * b, bz = oz + e.tz * b;
      wallRun(A, rng, 'concrete', ax, az, bx, bz,
        { y0: y(-0.5), y1: y(WALK_Y), t: 1.1, batter: 0.11, nx: -e.nx, nz: -e.nz,
          course: 0.55, copingKey: 'concrete_dark' });
      const px = (ax + bx) / 2, pz = (az + bz) / 2;
      const len = Math.hypot(bx - ax, bz - az);
      A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, px + e.nx * 0.25, y(0.24), pz + e.nz * 0.25,
        e.yaw, 1.9, 0.66, len), { masks: [0.8, 0.5, 0.2] });
      A.box('concrete', px + e.nx * 0.25, y(0.24), pz + e.nz * 0.25, 1.9, 0.66, len, e.yaw);
    }

    // the inner revetment, seen from the courtyard
    const ix = e.mx - e.nx * (RAMP_T - 0.2);
    const iz = e.mz - e.nz * (RAMP_T - 0.2);
    const ispans = gate
      ? [[-e.len / 2, -GATE_W / 2 - 0.5], [GATE_W / 2 + 0.5, e.len / 2]]
      : [[-e.len / 2, e.len / 2]];
    for (const [a, b] of ispans) {
      wallRun(A, rng, 'concrete', ix + e.tx * a, iz + e.tz * a, ix + e.tx * b, iz + e.tz * b,
        { y0: y(0), y1: y(WALK_Y), t: 0.8, batter: 0.03, nx: e.nx, nz: e.nz, course: 0.72, coping: false });
    }

    // the walk surface: worn flags, a drainage channel and the odd cartridge case
    walkWear(A, rng, e, y, proj);
  }
}

/** Shuttered concrete with a splayed batter's shadow. @see `prism`'s own paint. */
function rampartPaint(base) {
  return (x, yy, z, nx, ny, nz, out) => {
    const n = fbm3(x * 0.1 + 4.4, yy * 0.12, z * 0.1, 3);
    const m = fbm3(x * 0.62, yy * 0.7 + 2.3, z * 0.62, 2);
    const up = ny > 0.7;
    const h = yy - base;
    // @see `prism`'s own paint: the walk is horizontal and horizontal concrete
    // is what over-metered this map, so it gets grime and AO rather than wear.
    out[0] = Math.min(1, (up ? 0.26 : 0.24) + n * (up ? 0.22 : 0.42));
    out[1] = Math.min(1, (up ? 0.52 : 0.4) + m * 0.4 + Math.max(0, 1 - h) * 0.3);
    out[2] = Math.min(1, (up ? 0.32 : 0.26) + Math.max(0, 1 - h / 1.8) * 0.45);
  };
}

/** The top of the rampart, as ground that has been walked on for a long time. */
function walkWear(A, rng, e, y, proj) {
  const inset = PARAPET_T + 0.3;
  const width = RAMP_T + proj - inset - 0.4;
  for (let i = 0; i < Math.round(e.len * 0.9); i++) {
    const t = rng.float() - 0.5;
    const d = rng.float() * width;
    const px = e.mx + e.tx * e.len * t - e.nx * (inset + d) + e.nx * proj;
    const pz = e.mz + e.tz * e.len * t - e.nz * (inset + d) + e.nz * proj;
    const g = patchGeometry(rng, rng.range(0.4, 1.5), { lobes: 10, wobble: 0.55 });
    A.addOnce(rng.float() < 0.6 ? 'road_dust' : 'steppe_bare', g,
      LL(IDENT, px, y(WALK_Y) + 0.022, pz, rng.float() * 6.28, 1, 1, rng.range(0.6, 1.3)),
      { masks: [0.3, rng.range(0.45, 0.95), 0.35] });
  }
  // the drainage channel along the inner lip, which is the line that reads
  A.add('concrete_dark', BOX_FINE(A), LL(IDENT,
    e.mx - e.nx * (RAMP_T - 0.55), y(WALK_Y) + 0.01, e.mz - e.nz * (RAMP_T - 0.55),
    e.yaw, 0.34, 0.09, e.len), { masks: [0.5, 0.85, 0.7] });
}

/**
 * THE PARAPET — merlons and crenels rather than a continuous wall, because a
 * continuous wall is cover you cannot shoot from and this is the position's
 * entire reason to exist. A merlon is chest high (1.5 m) and a crenel drops to
 * 0.75, so a man is covered standing behind the one and firing over the other.
 *
 * In the shell scope: this is the crown, and the crown is what a strike takes.
 */
function parapets(A, rng, y) {
  const box = BOX(A);
  for (let i = 0; i < TRACE.length; i++) {
    const e = edgeInfo(TRACE, i);
    const proj = isFlat(e) ? 0 : BASTION;
    const ox = e.mx + e.nx * (proj - PARAPET_T / 2);
    const oz = e.mz + e.nz * (proj - PARAPET_T / 2);
    const bays = Math.max(4, Math.round(e.len / 2.4));
    for (let b = 0; b < bays; b++) {
      const t = (b + 0.5) / bays - 0.5;
      const px = ox + e.tx * e.len * t;
      const pz = oz + e.tz * e.len * t;
      const merlon = b % 2 === 0;
      const h = merlon ? PARAPET_H : PARAPET_H * 0.5;
      const w = (e.len / bays) - (merlon ? 0.1 : 0.28);
      A.add('concrete', box, LL(IDENT, px, y(WALK_Y + h / 2), pz, e.yaw, PARAPET_T, h, w),
        { masks: [0.35 + rng.float() * 0.35, 0.3 + rng.float() * 0.3, 0.12] });
      A.box('concrete', px, y(WALK_Y + h / 2), pz, PARAPET_T, h, w, e.yaw);
      A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, px, y(WALK_Y + h + 0.06), pz, e.yaw,
        PARAPET_T + 0.2, 0.12, w + 0.1), { masks: [0.75, 0.3, 0.05] });
      // a loophole through every second merlon, splayed outward
      if (merlon && b % 4 === 0) {
        A.add('window_void', PANE(A), LL(IDENT, px + e.nx * (PARAPET_T / 2 + 0.01), y(WALK_Y + 0.95),
          pz + e.nz * (PARAPET_T / 2 + 0.01), e.yaw + Math.PI / 2, 0.36, 0.5, 1),
          { masks: [0.15, 0.9, 0.95] });
      }
    }
    // the bastion faces get a real embrasure: a gun position, not a slit
    if (!isFlat(e)) {
      embrasure(A, ox - e.nx * 0.1, y(WALK_Y), oz - e.nz * 0.1, e.yaw + Math.PI / 2, 1.8, PARAPET_H, PARAPET_T);
    }
    // sandbags and ammunition against the inside of the parapet
    const n = Math.max(2, Math.round(e.len / 3.2));
    for (let k = 0; k < n; k++) {
      if (rng.float() < 0.3) continue;
      const t = (k + 0.5) / n - 0.5;
      const px = ox - e.nx * 1.0 + e.tx * e.len * t;
      const pz = oz - e.nz * 1.0 + e.tz * e.len * t;
      for (let s = 0; s < 3; s++) {
        A.put(rng.pick(['sandbag_a', 'sandbag_b', 'sandbag_c']),
          px + rng.range(-0.35, 0.35), y(WALK_Y) + 0.09 + (s % 2) * 0.19, pz + rng.range(-0.35, 0.35),
          e.yaw + rng.range(-0.2, 0.2), rng.range(0.95, 1.15));
      }
      if (rng.float() < 0.5) {
        A.put(rng.pick(['crate_b', 'crate_a', 'box_card_a']), px - e.nx * 1.3, y(WALK_Y) + 0.02,
          pz - e.nz * 1.3, rng.float() * 6.28, rng.range(0.9, 1.1));
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────────── gates ──
/**
 * A GATE IS A HOLE THROUGH SIX METRES OF RAMPART, and the walk goes over the
 * top of it. Jambs, a segmental relieving arch built as a corbelled ring, the
 * hinge pintles the leaves swung on, one leaf still hanging and one lying flat
 * in the mud outside, and the murder hole in the bridge above.
 *
 * Returns the two `interiorVolume` records without which the courtyard is an
 * island — @see the NAV note in this file's header.
 */
function gates(A, rng, y) {
  const box = BOX(A);
  const out = [];
  for (let i = 0; i < TRACE.length; i++) {
    const e = edgeInfo(TRACE, i);
    if (!isGate(e)) continue;
    const cx = e.mx - e.nx * (RAMP_T / 2);
    const cz = e.mz - e.nz * (RAMP_T / 2);

    // the passage floor: a made road through the gate, flush with the ground
    A.add('concrete_dark', box, LL(IDENT, cx, y(-0.14), cz, e.yaw, RAMP_T + 5, 0.3, GATE_W + 1.4), {
      masks: [0.75, 0.5, 0.25],
    });
    A.box('concrete', cx, y(-0.14), cz, RAMP_T + 5, 0.3, GATE_W + 1.4, e.yaw);
    // the ruts a fortress gate has worn into its own road
    for (let k = 0; k < 12; k++) {
      const g = patchGeometry(rng, rng.range(0.5, 1.6), { lobes: 10, wobble: 0.5 });
      A.addOnce('road_rut', g, LL(IDENT,
        cx + e.nx * rng.range(-5, 5) + e.tx * rng.range(-1.8, 1.8), y(0.02),
        cz + e.nz * rng.range(-5, 5) + e.tz * rng.range(-1.8, 1.8),
        rng.float() * 6.28, 1, 1, rng.range(0.5, 1.2)), { masks: [0.5, 0.9, 0.3] });
    }

    // the bridge carrying the walk over the passage
    A.add('concrete', box, LL(IDENT, cx, y(GATE_H + (WALK_Y - GATE_H) / 2), cz, e.yaw,
      RAMP_T, WALK_Y - GATE_H, GATE_W + 0.2), { masks: [0.4, 0.35, 0.4] });
    A.box('concrete', cx, y(GATE_H + (WALK_Y - GATE_H) / 2), cz, RAMP_T, WALK_Y - GATE_H, GATE_W + 0.2, e.yaw);
    // the murder hole in it, and the light that comes down through it
    A.add('window_void', PANE(A), LL(IDENT, cx, y(GATE_H - 0.02), cz, 0, 1.1, 1.1, 1, -Math.PI / 2),
      { masks: [0.1, 0.9, 0.9] });

    // the arch: a corbelled ring of voussoirs, both ends of the passage
    for (const s of [1, -1]) {
      const fx = e.mx + e.nx * s * (RAMP_T / 2) - e.nx * (RAMP_T / 2);
      const fz = e.mz + e.nz * s * (RAMP_T / 2) - e.nz * (RAMP_T / 2);
      const vous = 9;
      for (let v = 0; v < vous; v++) {
        const a = Math.PI * (v + 0.5) / vous;
        const px = fx + e.tx * Math.cos(a) * (GATE_W / 2 + 0.28);
        const pz = fz + e.tz * Math.cos(a) * (GATE_W / 2 + 0.28);
        const py = GATE_H - 0.9 + Math.sin(a) * 0.95;
        A.add('concrete_dark', box, LL(IDENT, px, y(py), pz, e.yaw, 0.9, 0.62, 0.62, 0, a - Math.PI / 2),
          { masks: [0.5 + rng.float() * 0.3, 0.4, 0.15] });
      }
      // the jambs, in bigger stone than the wall
      for (const k of [-1, 1]) {
        A.add('concrete_dark', box, LL(IDENT,
          fx + e.tx * k * (GATE_W / 2 + 0.34), y(GATE_H / 2 - 0.2),
          fz + e.tz * k * (GATE_W / 2 + 0.34), e.yaw, 0.95, GATE_H - 0.4, 0.68),
          { masks: [0.55, 0.4, 0.2] });
        // the pintles the leaf swung on
        for (let h = 0; h < 3; h++) {
          A.add('metal_dark', BOX_FINE(A), LL(IDENT,
            fx + e.tx * k * (GATE_W / 2 + 0.1) - e.nx * s * 0.3, y(0.7 + h * 1.0),
            fz + e.tz * k * (GATE_W / 2 + 0.1) - e.nz * s * 0.3, e.yaw, 0.3, 0.16, 0.18),
            { masks: [0.9, 0.7, 0.1] });
        }
      }
    }
    // one leaf still hanging, folded back flat against the passage wall
    A.add('wood_dark', box, LL(IDENT,
      e.mx + e.nx * (RAMP_T * 0.1) + e.tx * (GATE_W / 2 - 0.15), y(GATE_H / 2 - 0.25),
      e.mz + e.nz * (RAMP_T * 0.1) + e.tz * (GATE_W / 2 - 0.15), e.yaw, 2.6, GATE_H - 0.6, 0.16),
      { masks: [0.85, 0.6, 0.3] });
    for (let b = 0; b < 4; b++) {
      A.add('metal_rust', BOX_THIN(A), LL(IDENT,
        e.mx + e.nx * (RAMP_T * 0.1) + e.tx * (GATE_W / 2 - 0.15), y(0.7 + b * 0.8),
        e.mz + e.nz * (RAMP_T * 0.1) + e.tz * (GATE_W / 2 - 0.15), e.yaw, 2.5, 0.13, 0.2),
        { masks: [0.9, 0.65, 0.1] });
    }
    practical(A, cx, y(GATE_H - 0.5), cz, 0xffb066, 10, 14, { s: 0.16 });

    /**
     * …AND THE RECORD THAT MAKES IT A WAY IN RATHER THAN A PICTURE OF ONE.
     * The box covers the whole thickness of the rampart plus the road either
     * side; `probeY` sits under a 3.4 m arch and well above the road.
     */
    out.push(interiorVolume(`NF-FORT-GATE${i}`, cx, cz, 3.2, RAMP_T / 2 + 1.6, y(0.01), y(GATE_H)));
  }
  return out;
}

/**
 * THE GATE TOWERS. Solid to the top on purpose: a 3 x 3 m deck 8 m up with no
 * ramp to it is four nav cells in their own component and a bot standing on a
 * roof he cannot leave, which is the failure this whole map is designed around.
 * What they are for is the SILHOUETTE and the shadow they throw down the
 * approach, and they carry the fortress's two beacons.
 */
function gatehouses(A, rng, y) {
  const box = BOX(A);
  for (let i = 0; i < TRACE.length; i++) {
    const e = edgeInfo(TRACE, i);
    if (!isGate(e)) continue;
    for (const k of [-1, 1]) {
      const px = e.mx + e.tx * k * (GATE_W / 2 + 3.4) - e.nx * 0.6;
      const pz = e.mz + e.tz * k * (GATE_W / 2 + 3.4) - e.nz * 0.6;
      for (let c = 0; c < 12; c++) {
        const cy = WALK_Y + (c + 0.5) * ((TOWER_H - WALK_Y) / 12);
        const set = (cy - WALK_Y) * 0.045;
        A.add('concrete', box, LL(IDENT, px, y(cy), pz, e.yaw, 5.6 - set * 2, (TOWER_H - WALK_Y) / 12 - 0.02, 5.6 - set * 2),
          { masks: [0.35 + rng.float() * 0.35, 0.3 + rng.float() * 0.35, 0.1] });
      }
      A.box('concrete', px, y((WALK_Y + TOWER_H) / 2), pz, 5.6, TOWER_H - WALK_Y, 5.6, e.yaw);
      // the machicolated corbel table at the head, which is the whole read at 150 m
      for (let m = 0; m < 4; m++) {
        const a = e.yaw + m * Math.PI / 2;
        const nxm = Math.sin(a), nzm = Math.cos(a);
        A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, px + nxm * 2.9, y(TOWER_H - 0.9), pz + nzm * 2.9,
          a + Math.PI / 2, 0.9, 0.5, 6.2), { masks: [0.6, 0.45, 0.3] });
        for (let d = 0; d < 5; d++) {
          const t = (d + 0.5) / 5 - 0.5;
          A.add('concrete', BOX(A), LL(IDENT,
            px + nxm * 2.75 + nzm * 6.0 * t, y(TOWER_H - 1.45), pz + nzm * 2.75 - nxm * 6.0 * t,
            a + Math.PI / 2, 0.65, 0.72, 0.42), { masks: [0.5, 0.4, 0.35] });
        }
      }
      // the crenellated cap
      for (let m = 0; m < 12; m++) {
        const a = e.yaw + (m / 12) * Math.PI * 2;
        A.add('concrete', box, LL(IDENT, px + Math.sin(a) * 2.6, y(TOWER_H + 0.45), pz + Math.cos(a) * 2.6,
          a, 0.5, 0.9, 1.1), { masks: [0.45, 0.35, 0.1] });
      }
      // a slit per storey, and the lamp burning behind the top one
      for (let s = 0; s < 3; s++) {
        A.add('window_void', PANE(A), LL(IDENT, px - e.nx * 2.82, y(WALK_Y + 0.9 + s * 1.9), pz - e.nz * 2.82,
          e.yaw + Math.PI / 2, 0.34, 1.1, 1), { masks: [0.15, 0.9, 0.95] });
      }
      practical(A, px, y(TOWER_H + 1.1), pz, 0xff7a33, 22, 32, { s: 0.26, priority: 1 });
    }
  }
}

// ──────────────────────────────────────────────────────────────── courtyard ──
/**
 * THE TWO WAYS UP. Earth-and-timber ramps against the inner face of the east
 * and west curtains, `RAMP_GRADE` like everything else here, 3.6 m wide. Two
 * rather than one because the walk is a ring and a single ramp makes half of it
 * a walk to nowhere the moment somebody stands at the head of it.
 */
function courtyardRamps(A, rng, y) {
  const run = WALK_Y / RAMP_GRADE;
  for (const s of [-1, 1]) {
    /**
     * x is chosen so the ramp's 4 m width OVERLAPS the rampart's inner face by
     * half a metre. At `R_IN - 2.4` its head stopped 0.6 m short of the walk and
     * the whole rampart came back as two components with no route on to either.
     */
    const x = s * (R_IN - 1.6);
    ramp(A, rng, 'concrete', x, FORT.z - s * run / 2, y(0), x, FORT.z + s * run / 2, y(WALK_Y), 4.0, {
      fillKey: 'concrete_dark', baseY: y(-0.5), kerbKey: 'concrete_dark',
    });
    handrail(A, 'metal_rust', x - s * 2.1, FORT.z - s * run / 2, x - s * 2.1, FORT.z + s * run / 2, y(WALK_Y * 0.55));
  }
}

/**
 * THE MAGAZINE — the one interior inside the wall, and the second reason to be
 * in the courtyard at all. A single storey with a barrel-vaulted roof under an
 * earth burster course, two doors on opposite ends and a ventilator on the
 * ridge. Published as an `interiorVolume`: the only thing above it is its own
 * roof, and the roof has no ramp to it, so nothing walkable is given up.
 */
function magazine(A, rng, y) {
  const box = BOX(A);
  const cx = FORT.x, cz = FORT.z - 3;
  const { hw, hd, wall, roof } = MAG;
  const DOOR_W = 1.9, DOOR_H = 2.4;

  // floor, running out under the walls and through both reveals — @see the
  // control room's own note in plains-tower.js, which is the same trap.
  A.add('floor_concrete', box, LL(IDENT, cx, y(-0.2), cz, 0, hw * 2 + 0.6, 0.5, hd * 2 + 0.6), {
    paint: (x, yy, z, nx, ny, nz, out) => {
      const n = fbm3(x * 0.8 + 1.7, yy, z * 0.8, 3);
      out[0] = Math.min(1, 0.3 + n * 0.5);
      out[1] = Math.min(1, 0.3 + n * 0.45);
      out[2] = 0.2;
    },
  });
  A.box('concrete', cx, y(-0.2), cz, hw * 2 + 0.6, 0.5, hd * 2 + 0.6);

  /**
   * FOUR WALLS, and the offsets are spelled out rather than derived from a loop
   * index. The first version indexed `half`/`off` off `i % 2` and got them the
   * wrong way round, which put four 12 m slabs through the middle of the room in
   * a cross: the interior re-probe found the floor, the real capsule found a
   * wall, and every cell inside the magazine came back BLOCKED.
   *
   *   sides 0/1  the DOOR ends, on ±Z: 2*hw long, `wall` thick, yaw 0
   *   sides 2/3  the long walls, on ±X: 2*hd long, `wall` thick, yaw PI/2
   */
  const SIDES = [
    { nx: 0, nz: -1, off: hd, half: hw, door: true },
    { nx: 0, nz: 1, off: hd, half: hw, door: true },
    { nx: -1, nz: 0, off: hw, half: hd, door: false },
    { nx: 1, nz: 0, off: hw, half: hd, door: false },
  ];
  for (const S of SIDES) {
    const wx = cx + S.nx * (S.off - wall / 2);
    const wz = cz + S.nz * (S.off - wall / 2);
    // the wall runs along the axis perpendicular to its own normal
    const tx = -S.nz, tz = S.nx;
    /**
     * …AND THE YAW IS DERIVED FROM THAT TANGENT rather than written down beside
     * it. Every box in this kit is authored as (sx ACROSS, sy up, sz ALONG), so
     * the yaw has to be the direction the wall RUNS. Hand-set, the two pairs
     * came out swapped and the door ends were built 0.8 m wide and 16 m deep:
     * the room's interior came back walkable in a 1.6 m strip and blocked
     * everywhere else, which reads exactly like too much furniture and is not.
     */
    S.yaw = Math.atan2(tx, tz);
    if (S.door) {
      const seg = (S.half * 2 - DOOR_W) / 2;
      for (const k of [-1, 1]) {
        const px = wx + tx * k * (DOOR_W / 2 + seg / 2);
        const pz = wz + tz * k * (DOOR_W / 2 + seg / 2);
        A.box('concrete', px, y(roof / 2), pz, wall, roof, seg, S.yaw);
        A.add('plaster_sand', box, LL(IDENT, px, y(roof / 2), pz, S.yaw, wall, roof, seg),
          { masks: [0.4 + rng.float() * 0.3, 0.35, 0.2] });
      }
      A.box('concrete', wx, y(DOOR_H + (roof - DOOR_H) / 2), wz, wall, roof - DOOR_H, DOOR_W, S.yaw);
      A.add('plaster_sand', box, LL(IDENT, wx, y(DOOR_H + (roof - DOOR_H) / 2), wz, S.yaw, wall, roof - DOOR_H, DOOR_W),
        { masks: [0.5, 0.4, 0.25] });
      A.add('metal_dark', box, LL(IDENT, wx + S.nx * 0.06, y(DOOR_H + 0.14), wz + S.nz * 0.06, S.yaw,
        wall + 0.2, 0.28, DOOR_W + 0.7), { masks: [0.85, 0.5, 0.15] });
      // the jambs, in a harder course than the render round them
      for (const k of [-1, 1]) {
        A.add('concrete_dark', box, LL(IDENT, wx + tx * k * (DOOR_W / 2 + 0.22), y(DOOR_H / 2),
          wz + tz * k * (DOOR_W / 2 + 0.22), S.yaw, wall + 0.16, DOOR_H + 0.2, 0.44),
          { masks: [0.6, 0.45, 0.2] });
      }
    } else {
      A.box('concrete', wx, y(roof / 2), wz, wall, roof, S.half * 2, S.yaw);
      A.add('plaster_sand', box, LL(IDENT, wx, y(roof / 2), wz, S.yaw, wall, roof, S.half * 2),
        { masks: [0.4 + rng.float() * 0.3, 0.35, 0.2] });
      // buttresses on the long walls
      for (let b = -1; b <= 1; b++) {
        A.add('concrete', box, LL(IDENT, wx + S.nx * 0.45 + tx * b * 3.4, y(roof * 0.44),
          wz + S.nz * 0.45 + tz * b * 3.4, S.yaw, 0.9, roof * 0.88, 0.9), { masks: [0.5, 0.35, 0.25] });
      }
      // a slit high in the wall so the room has a second value in it
      A.add('window_void', PANE(A), LL(IDENT, wx + S.nx * (wall / 2 + 0.01), y(roof - 1.1),
        wz + S.nz * (wall / 2 + 0.01), S.yaw + Math.PI / 2, 2.2, 0.4, 1), { masks: [0.15, 0.9, 0.95] });
    }
  }
  // the roof slab and the earth burster course over it
  A.add('concrete_dark', BOX_SOFT(A), LL(IDENT, cx, y(roof + 0.22), cz, 0, hw * 2 + 0.9, 0.44, hd * 2 + 0.9),
    { masks: [0.6, 0.45, 0.15] });
  A.box('concrete', cx, y(roof + 0.22), cz, hw * 2 + 0.9, 0.44, hd * 2 + 0.9);
  for (let i = 0; i < 40; i++) {
    const g = patchGeometry(rng, rng.range(0.6, 2.0), { lobes: 11, wobble: 0.5 });
    A.addOnce('scree', g, LL(IDENT, cx + rng.range(-hw, hw), y(roof + 0.46), cz + rng.range(-hd, hd),
      rng.float() * 6.28, 1, 1, rng.range(0.5, 1.2)), { masks: [0.4, rng.range(0.3, 0.8), 0.2] });
  }
  A.put('roof_vent', cx + 2.4, y(roof + 0.46), cz, 0.3, 1.3);
  A.put('roof_vent', cx - 3.1, y(roof + 0.46), cz + 1.4, 1.2, 1.1);
  ladder(A, cx + hw + 0.12, y(0.2), y(roof + 0.5), cz + 3.4, -Math.PI / 2);

  /**
   * WHAT A MAGAZINE HOLDS — kept clear of both doorways by each prop's OWN
   * extent (`A.footprintR`), and kept clear of each other by the same measure.
   *
   * Both halves of that are load-bearing. `interiors.js` once tested a prop's
   * CENTRE against a door circle while the prop is 0.64 m across, which is one
   * of the five doorway bugs this repo has shipped; and thirty crates in a
   * 16 x 12 room with no mutual spacing filled it solid — measured, every cell
   * of the interior except a 1.6 m corridor down the middle came back BLOCKED,
   * so the room the interior volume exists for had nowhere to stand in it.
   */
  const doors = [{ x: cx, z: cz - hd - 0.6 }, { x: cx, z: cz + hd + 0.6 }];
  const ids = ['crate_c', 'crate_a', 'crate_b', 'barrel_rust', 'barrel_wood', 'shelf', 'pallet', 'box_card_a'];
  const put = [];
  for (let i = 0; i < 160 && put.length < 13; i++) {
    const px = cx + rng.range(-hw + 1.3, hw - 1.3);
    const pz = cz + rng.range(-hd + 1.3, hd - 1.3);
    // stores go against the walls; the floor of a magazine is kept clear to work
    if (Math.abs(px - cx) < hw - 2.6 && Math.abs(pz - cz) < hd - 2.4) continue;
    const id = rng.pick(ids);
    const sc = rng.range(0.9, 1.15);
    const r = (A.footprintR(id, sc) ?? 0.4) + 0.2;
    let ok = true;
    for (const d of doors) if (Math.hypot(px - d.x, pz - d.z) < 3.2 + r) ok = false;
    // …and 1.1 m of gangway between one stack and the next, so a man fits
    for (const q of put) if (Math.hypot(px - q.x, pz - q.z) < q.r + r + 1.1) ok = false;
    if (!ok) continue;
    A.put(id, px, y(0.02), pz, rng.float() * 6.28, sc);
    if (rng.float() < 0.45 && id.startsWith('crate')) {
      A.put(id, px + rng.range(-0.08, 0.08), y(0.02) + 0.56 * sc, pz + rng.range(-0.08, 0.08),
        rng.float() * 6.28, sc * 0.96);
    }
    put.push({ x: px, z: pz, r });
  }
  practical(A, cx - 2.6, y(roof - 0.7), cz + 1.2, 0xffc07a, 10, 13, { s: 0.13 });
  practical(A, cx + 3.0, y(roof - 0.7), cz - 1.6, 0xffc07a, 8, 12, { s: 0.13 });

  return interiorVolume('NF-FORT-MAG', cx, cz, hw, hd, y(MAG.floor), y(roof));
}

/** Everything else inside the wall: the position as a place people live in. */
function courtyard(A, rng, y) {
  const box = BOX(A);
  // the hardstanding, laid inside the whole enceinte
  const inner = octagon(R_IN - 0.4, CUT - 2).map(([x, z]) => [x + FORT.x, z + FORT.z]);
  prism(A, 'concrete_dark', inner, y(-0.6), y(0.04), { surface: 'concrete' });
  for (let i = 0; i < 150; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = Math.sqrt(rng.float()) * (R_IN - 1);
    const px = FORT.x + Math.cos(a) * d, pz = FORT.z + Math.sin(a) * d;
    const g = patchGeometry(rng, rng.range(0.6, 2.4), { lobes: 11, wobble: 0.55 });
    A.addOnce(rng.float() < 0.5 ? 'road_dust' : 'steppe_bare', g,
      LL(IDENT, px, y(0.06), pz, rng.float() * 6.28, 1, 1, rng.range(0.6, 1.4)),
      { masks: [0.28, rng.range(0.45, 0.95), 0.35] });
  }

  // revetted ammunition bays against the inner face of the rampart
  for (let i = 0; i < 7; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = R_IN - rng.range(2.6, 5.0);
    const px = FORT.x + Math.cos(a) * d, pz = FORT.z + Math.sin(a) * d;
    if (Math.abs(px - FORT.x) < 10 && Math.abs(pz - FORT.z + 3) < 8) continue; // the magazine
    const yaw = Math.atan2(FORT.x - px, FORT.z - pz);
    for (const s of [-1, 1]) {
      A.add('concrete_dark', box, LL(IDENT, px + Math.cos(yaw) * s * 2.1, y(0.55), pz - Math.sin(yaw) * s * 2.1,
        yaw, 0.5, 1.1, 3.4), { masks: [0.6, 0.5, 0.25] });
      A.box('concrete', px + Math.cos(yaw) * s * 2.1, y(0.55), pz - Math.sin(yaw) * s * 2.1, 0.5, 1.1, 3.4, yaw);
    }
    for (let k = 0; k < 4; k++) {
      A.put(rng.pick(['crate_c', 'crate_a', 'barrel_rust', 'block_small']),
        px + rng.range(-1.4, 1.4), y(0.02), pz + rng.range(-1.2, 1.2), rng.float() * 6.28, rng.range(0.9, 1.1));
    }
  }

  // a barrack shed, a water point, and the litter of a held position
  {
    const bx = FORT.x - 13, bz = FORT.z + 12;
    A.add('corrugated', box, LL(IDENT, bx, y(1.5), bz, 0.35, 9.0, 3.0, 5.0), { masks: [0.85, 0.6, 0.15] });
    A.box('metal', bx, y(1.5), bz, 9.0, 3.0, 5.0, 0.35);
    A.add('corrugated', box, LL(IDENT, bx, y(3.2), bz, 0.35, 9.6, 0.24, 5.6, 0, 0.06), { masks: [0.9, 0.7, 0.2] });
    for (let i = 0; i < 5; i++) {
      A.add('metal_rust', BOX_THIN(A), LL(IDENT, bx - 4.2 + i * 2.1, y(1.5), bz - 2.55, 0.35, 0.14, 3.0, 0.14),
        { masks: [0.9, 0.6, 0] });
    }
    practical(A, bx + 4.9, y(2.7), bz, 0xffc07a, 8, 12, { s: 0.14 });
  }
  A.put('water_tank', FORT.x + 12, y(0.02), FORT.z + 13, 0.6, 1.5);
  for (let i = 0; i < 26; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = Math.sqrt(rng.float()) * (R_IN - 2);
    A.put(rng.pick(['barrel_rust', 'barrel_blue', 'jerry_can', 'tyre', 'pallet', 'crate_b', 'bucket', 'block_small']),
      FORT.x + Math.cos(a) * d, y(0.02), FORT.z + Math.sin(a) * d, rng.float() * 6.28, rng.range(0.85, 1.15));
  }
  practical(A, FORT.x + 9, y(5.4), FORT.z + 9, 0xffb066, 16, 22, { s: 0.2 });
}

/**
 * THE GLACIS. A fortification's most important surface is the ground OUTSIDE
 * it: a smooth slope with nothing on it, so an attacker crossing the last
 * thirty metres is a silhouette against the plain with no cover to reach.
 * Built as blown-earth berms against the revetment plus a swept apron, and
 * every one of them stays under the 0.45 m step so it is ground and not a wall.
 */
function glacis(A, rng, y, groundY) {
  for (let i = 0; i < TRACE.length; i++) {
    const e = edgeInfo(TRACE, i);
    const proj = isFlat(e) ? 0 : BASTION;
    const ox = e.mx + e.nx * (proj + 0.6);
    const oz = e.mz + e.nz * (proj + 0.6);
    const g = driftBerm(rng, e.len + 2, 5.5, 0.34, { nz: 5 });
    A.addOnce('steppe_bare', g, LL(IDENT, ox, y(0.0), oz, e.yaw + Math.PI / 2, 1, 1, 1),
      { masks: [0.45, 0.45, 0.25] });
  }
  for (let i = 0; i < 220; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = R_OUT + rng.range(1, 14);
    const px = FORT.x + Math.cos(a) * d, pz = FORT.z + Math.sin(a) * d;
    const g = patchGeometry(rng, rng.range(0.8, 3.2), { lobes: 11, wobble: 0.55 });
    A.addOnce('steppe_bare', g, LL(IDENT, px, groundY(px, pz) + 0.03, pz, rng.float() * 6.28,
      1, 1, rng.range(0.6, 1.4)), { masks: [0.5, rng.range(0.3, 0.8), 0.2] });
  }
}

// ───────────────────────────────────────────────────────────────────── ruin ──
/**
 * The crown gone: the magazine collapsed into its own footprint, the four gate
 * towers snapped off at the machicolation, and the parapet lying along the walk
 * in a relaxed field that is still a surface a man can walk.
 *
 * NOTHING HERE MAY BE TALLER THAN A STEP. The walk is the AI's high ground
 * inside the wall and the courtyard is its route between the two gates; a
 * rubble pile across either is a fortress that is HARDER to move through after
 * it has been destroyed, which is the exact failure `demolition.js`' own header
 * is written about.
 */
function buildFortRuin(A, rng, y) {
  const box = BOX(A);
  // the magazine, down
  const cx = FORT.x, cz = FORT.z - 3;
  const field = debrisField(rng, cx, cz, MAG.hw + 2.5, 1.35, 2.2);
  drawDebris(A, rng, field, () => y(0.02), { key: 'plaster_sand', key2: 'concrete_dark' });
  // its walls, torn off low, so the plan is still legible
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const nx = Math.sin(a), nz = Math.cos(a);
    const half = i % 2 ? MAG.hw : MAG.hd;
    const off = i % 2 ? MAG.hd : MAG.hw;
    const h = rng.range(0.9, 2.1);
    A.add('plaster_sand', box, LL(IDENT, cx + nx * (off - MAG.wall / 2), y(h / 2), cz + nz * (off - MAG.wall / 2),
      a, MAG.wall, h, half * rng.range(0.6, 1.5)), { masks: [0.7, 0.6, 0.3] });
    A.box('concrete', cx + nx * (off - MAG.wall / 2), y(h / 2), cz + nz * (off - MAG.wall / 2),
      MAG.wall, h, half * 1.2, a);
  }

  // the gate towers, snapped
  for (let i = 0; i < TRACE.length; i++) {
    const e = edgeInfo(TRACE, i);
    if (!isGate(e)) continue;
    for (const k of [-1, 1]) {
      const px = e.mx + e.tx * k * (GATE_W / 2 + 3.4) - e.nx * 0.6;
      const pz = e.mz + e.tz * k * (GATE_W / 2 + 3.4) - e.nz * 0.6;
      const h = rng.range(1.6, 3.2);
      for (let c = 0; c < 4; c++) {
        const ch = h / 4;
        A.add('concrete', box, LL(IDENT, px, y(WALK_Y + (c + 0.5) * ch), pz, e.yaw + rng.range(-0.02, 0.02),
          5.6 * (c === 3 ? rng.range(0.5, 0.85) : 1), ch, 5.6 * (c === 3 ? rng.range(0.5, 0.9) : 1)),
          { masks: [0.6 + rng.float() * 0.35, 0.55, 0.3] });
      }
      A.box('concrete', px, y(WALK_Y + h / 2), pz, 5.6, h, 5.6, e.yaw);
      for (let r = 0; r < 5; r++) {
        A.add('metal_rust', BOX_THIN(A), LL(IDENT, px + rng.range(-2.4, 2.4), y(WALK_Y + h + rng.range(0.2, 1.2)),
          pz + rng.range(-2.4, 2.4), rng.float() * 6.28, 0.035, rng.range(0.6, 1.9), 0.035,
          rng.range(-0.5, 0.5), rng.range(-0.5, 0.5)), { masks: [0.95, 0.75, 0] });
      }
      // and what came off it, spread over the walk and down onto the road
      const f = debrisField(rng, px, pz, 7.5, 0.55, 1.9);
      drawDebris(A, rng, f, (x, z) => {
        const dx = x - FORT.x, dz = z - FORT.z;
        const inside = Math.max(Math.abs(dx), Math.abs(dz)) < R_IN;
        return inside ? y(0.02) : y(WALK_Y);
      }, { key: 'concrete', key2: 'concrete_dark' });
    }
  }

  // the parapet, lying along the walk
  for (let i = 0; i < TRACE.length; i++) {
    const e = edgeInfo(TRACE, i);
    const proj = isFlat(e) ? 0 : BASTION;
    const ox = e.mx + e.nx * (proj - PARAPET_T - 0.5);
    const oz = e.mz + e.nz * (proj - PARAPET_T - 0.5);
    const n = Math.round(e.len / 1.3);
    for (let b = 0; b < n; b++) {
      const t = (b + 0.5) / n - 0.5;
      const h = rng.range(0.14, 0.34);
      A.add('concrete', box, LL(IDENT, ox + e.tx * e.len * t + e.nx * rng.range(-0.6, 0.9),
        y(WALK_Y + h / 2), oz + e.tz * e.len * t + e.nz * rng.range(-0.6, 0.9),
        e.yaw + rng.range(-0.4, 0.4), rng.range(0.7, 1.6), h, rng.range(0.8, 1.5)),
        { masks: [0.6, 0.6, 0.4] });
      A.box('concrete', ox + e.tx * e.len * t, y(WALK_Y + h / 2), oz + e.tz * e.len * t,
        1.5, h, e.len / n + 0.2, e.yaw);
    }
  }

  // scorch
  for (let i = 0; i < 40; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = Math.sqrt(rng.float()) * (R_IN - 1);
    const px = FORT.x + Math.cos(a) * d, pz = FORT.z + Math.sin(a) * d;
    const g = patchGeometry(rng, rng.range(1.4, 4.6), { lobes: 12, wobble: 0.6 });
    A.addOnce('road_dust', g, LL(IDENT, px, y(0.05), pz, rng.float() * 6.28, 1, 1, rng.range(0.6, 1.4)),
      { masks: [0.15, 1.0, 0.55] });
  }
}
