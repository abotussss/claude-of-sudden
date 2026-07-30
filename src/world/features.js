import { BOX, BOX_THIN, IDENT, LL } from './kit.js';
import { Rng } from '../core/rng.js';
import { groundY, sandbagWall } from './dressing.js';
import { BEACON_SPOTS, CATHEDRAL, SCALE } from './layout.js';

/**
 * WORLD — THE REASONS TO GO IN AND THE REASONS TO GO UP.
 *
 * "もっと屋内戦闘をさせたいので屋内のエリアを作ってそこにもAIがいく利点やメリットを与えて
 *  でないとAIが屋内戦闘しない"
 * "屋上だったり３階のエリアなどにもメリットを与えて 例えば武器が落ちてるとか"
 *
 * The map had eight enterable buildings, twenty-four standable levels and eight
 * reachable roofs, and there was NOTHING IN ANY OF THEM. Every one was furnished
 * — shelves, counters, mattresses, ruin — and none of it was worth walking to,
 * so a route through a building was strictly longer than the street outside it
 * and a roof was a place to be shot from below. That is the whole of both
 * complaints: not that the interiors do not exist, but that they do not PAY.
 *
 * WHAT THIS AUTHORS. Twenty-two caches, one per level of every enterable
 * building plus one on every reachable roof:
 *
 *   `ammo`     a resupply dump — pallet, two olive ordnance crates, an open one
 *   `weapon`   a timber rack with wrapped long arms on it, a crate at its foot
 *   `grenade`  a stack of small olive boxes, one open, sacking beside it
 *   `vantage`  an L of sandbags at a parapet with a spotting scope and a crate
 *
 * and each stands on a painted floor square, which is the cue that says a human
 * put it there rather than that the dressing dice landed on a crate.
 *
 * WHAT THIS IS *NOT*. It is not a pickup, and this file gives nothing to
 * anybody. `world` may not decide what a weapon spawn does any more than it may
 * decide who is on which team — so the locations are PUBLISHED as
 * `world.features` and `src/match` (or `src/ai`) binds behaviour to them at
 * runtime. See ARCHITECTURE.md. The world's job is that the place exists, is
 * reachable, is marked, and looks deliberate.
 *
 * BOTS ONLY EVER USE GROUND LEVEL — `src/ai/nav.js` is a 2.5D height field, so
 * a bot cannot climb a stair anywhere in this level. That is exactly why every
 * enterable building gets a cache on its GROUND floor as well: those eight are
 * the ones a bot can walk to, and they are what can pull the fight indoors.
 * `botReachable` on each entry says which is which, so nothing has to guess.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `botReachable` IS A CANDIDACY FLAG, NOT A MEASUREMENT. THE CONSUMER MUST
 * PROVE IT — AND UNTIL THE NAV GRID GREW AN INDOORS IT PROVED FALSE FOR ALL 24.
 * ────────────────────────────────────────────────────────────────────────────
 * `world` CANNOT KNOW. The nav grid belongs to `ai` and does not exist when
 * `buildFeatures` runs, so `floor === 0` is the strongest statement this file is
 * in a position to make: it is NECESSARY (a bot certainly cannot use an upper
 * floor) and it is not SUFFICIENT.
 *
 * For most of this map's life it was not even close. Swept against the real
 * 328x329 grid (`_navin.mjs`, `_cacheprobe.mjs`): every walkable cell inside an
 * enterable footprint was at 3.2 m, 6.5 m or 9.6 m — the ROOF — with ZERO at
 * ground level in any of the eight, because `nav.js` builds its height field by
 * dropping one ray per cell from ABOVE the level. A* from all thirty spawn
 * points reached none of them, and the four ground-floor caches that had a
 * walkable cell within three rings had it 2.8-3.6 m away and OUTSIDE the
 * building: doorways.
 *
 * `NavGrid._carveInteriors` re-samples those cells from INSIDE the building now,
 * off `world.interiorVolumes` (see `src/world/index.js`), so the ground storeys
 * are in the height field — ~2620 cells — and the eight ground-floor caches
 * stand on cells a bot can occupy. The upper sixteen are exactly as they were: a
 * stair is still 0 waypoints and they are still the PLAYER's.
 *
 * A consumer that trusts this field blindly is still wrong, because a doorway
 * can be dressed shut and the dice are re-rolled every boot: it would order a bot
 * to a destination the height field does not contain and `Agent._advance` would
 * set `objectiveBlocked` and stand him still — the exact "AIが立ち止まる" failure.
 * `src/match/caches.js` therefore PROVES every cache against the grid at init and
 * drops the rest, the same way `src/match/sites.js` proves a zone's standing
 * points.
 *
 * The field is left as it is on purpose: it is the correct thing for `world` to
 * publish and changing it to something `world` cannot compute would be worse
 * than documenting what it means.
 *
 * PLACEMENT IS AUTHORED, in normalised interior coordinates, exactly like the
 * room plans and the stair flights in `layout.js` — the same coordinates, so a
 * spot follows its footprint if the map is rescaled again. They are hand-picked
 * off each floor's own plan to sit in a room OFF the declared through-route and
 * clear of the stairwell, because a crate on a route is a locked door
 * (`throughcheck`) and a crate on a stair is a locked storey (`floorcheck`).
 * `buildInterior` is handed them as keep-clear circles so the furnishing pass
 * cannot drop a shelf on one, and `tools/floorcheck.mjs` measures standing room
 * at every single spot and refuses to pass if the flood cannot reach it.
 */

/**
 * [kind, x, z] per floor in normalised interior coordinates, and `roof` in
 * normalised ROOF-PLATE coordinates (a setback means the roof is not the
 * footprint). 0 is the inner face of the -X / -Z wall, 1 the +X / +Z one.
 */
const SPOTS = {
  W1: { floors: [['ammo', 0.80, 0.20], ['weapon', 0.72, 0.78]], roof: ['vantage', 0.80, 0.76] },
  W2: { floors: [['ammo', 0.72, 0.22], ['weapon', 0.25, 0.70]], roof: ['vantage', 0.24, 0.26] },
  W3: { floors: [['ammo', 0.68, 0.50], ['weapon', 0.30, 0.80]], roof: ['vantage', 0.26, 0.30] },
  E1: {
    floors: [['ammo', 0.80, 0.22], ['weapon', 0.25, 0.30], ['grenade', 0.72, 0.72]],
    roof: ['vantage', 0.25, 0.75],
  },
  E2: {
    floors: [['ammo', 0.72, 0.25], ['weapon', 0.25, 0.70], ['grenade', 0.70, 0.30]],
    roof: ['vantage', 0.74, 0.26],
  },
  E3: { floors: [['ammo', 0.30, 0.45], ['weapon', 0.35, 0.75]], roof: ['vantage', 0.30, 0.70] },
  /**
   * The two mid-street islands. Their roofs are the reason the mantle chains in
   * `RELIEF.blocks` exist, and until now the reward for climbing one was a view
   * of the connector you were standing in. A sandbag nest on top of the island
   * that splits the street is the most contested 4 m² on the map.
   */
  K1: { floors: [['ammo', 0.72, 0.50]], roof: ['vantage', 0.52, 0.50] },
  K2: { floors: [['grenade', 0.72, 0.52]], roof: ['vantage', 0.50, 0.54] },
};

/** Keep-clear radius handed to the furnishing pass. */
const CLEAR_R = 1.35;

/**
 * The spots for one building, resolved to LEVEL space. Pure: no geometry, no
 * rng, no side effects — `buildings.js` calls it while it is still laying
 * partitions out, and `buildFeatures` calls it again to build.
 */
export function featureSpots(spec, info, t = spec.t ?? 0.34) {
  const table = SPOTS[spec.id];
  if (!table || !spec.enterable) return [];
  const floors = spec.floors ?? 1;
  const out = [];
  for (let f = 0; f < floors; f++) {
    const e = table.floors[f];
    if (!e) continue;
    const fs = floorSpecOf(spec, f);
    const iw = fs.w - t * 2, id = fs.d - t * 2;
    out.push({
      kind: e[0], floor: f,
      x: fs.x - iw / 2 + e[1] * iw,
      z: fs.z - id / 2 + e[2] * id,
      y: (info.floorY?.[f] ?? 0) + (f === 0 ? 0.13 : 0),
      indoor: true,
    });
  }
  if (table.roof && info.roofY !== undefined) {
    const rs = info.roofSpec ?? floorSpecOf(spec, floors - 1);
    const iw = rs.w - t * 2, id = rs.d - t * 2;
    out.push({
      kind: table.roof[0], floor: 'roof',
      x: rs.x - iw / 2 + table.roof[1] * iw,
      z: rs.z - id / 2 + table.roof[2] * id,
      y: info.roofY,
      indoor: false,
    });
  }
  return out;
}

/**
 * `floorSpec` lives in buildings.js and is not exported; a setback only ever
 * moves an upper floor's plate, so this is the same arithmetic against the same
 * fields. Duplicated deliberately rather than widening buildings.js's surface.
 */
function floorSpecOf(spec, f) {
  const sb = spec.setback;
  const fs = { x: spec.x, z: spec.z, w: spec.w, d: spec.d };
  if (sb && f >= sb.from) {
    const side = sb.side ?? spec.streetSide ?? 0;
    if (side === 1) { fs.x = spec.x - sb.depth / 2; fs.w = spec.w - sb.depth; }
    else if (side === 3) { fs.x = spec.x + sb.depth / 2; fs.w = spec.w - sb.depth; }
    else if (side === 0) { fs.z = spec.z + sb.depth / 2; fs.d = spec.d - sb.depth; }
    else { fs.z = spec.z - sb.depth / 2; fs.d = spec.d - sb.depth; }
  }
  return fs;
}

/** Keep-clear circles for `buildInterior`'s furnishing pass, per floor. */
export function featureKeepClear(spec, info, t) {
  const list = [];
  for (const s of featureSpots(spec, info, t)) {
    if (s.floor === 'roof') continue;
    list.push({ floor: s.floor, x: s.x, z: s.z, r: CLEAR_R });
  }
  return list;
}

/**
 * Build every cache and hand back the published list. Own rng stream: one draw
 * from the level's shared one would move every prop placed after it.
 */
export function buildFeatures(A, infos) {
  const rng = new Rng(0xfea7c4e);
  const out = [];
  for (const info of infos) {
    const spec = info.spec;
    for (const s of featureSpots(spec, info)) {
      const yaw = facingOf(spec, s, rng);
      cache(A, rng, s.kind, s.x, s.y, s.z, yaw);
      out.push({
        id: `${spec.id}-${s.floor === 'roof' ? 'roof' : `f${s.floor}`}-${s.kind}`,
        kind: s.kind,
        building: spec.id,
        floor: s.floor,
        indoor: s.indoor,
        /** A bot can only ever reach a GROUND-floor one: see the nav note above.
         *  Necessary, not sufficient — `Caches.prove` measures it. */
        botReachable: s.floor === 0,
        level: { x: s.x, y: s.y, z: s.z },
        yaw,
      });
    }
  }
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * THE FLANK BEACON SQUARES, AND THE TWO IN THE CATHEDRAL
   * ──────────────────────────────────────────────────────────────────────────
   * "マップの左右のいく価値のないエリアにはビーコンエリアがあってそこからもリスポーンできる
   *  ようにして（起動したら）左右にもっとメリットを与えて、例えば爆撃機を呼べるとか"
   *
   * Every feature above is INSIDE a building, because until now the only thing
   * this file was answering was "why would you ever go indoors". The question has
   * changed: with the capture points moved out to the corners
   * (`ZONES` in src/match/sites.js) there are three flank areas with no point on
   * them, and the player wants them worth walking to anyway.
   *
   * `world` still gives nothing away. What a cache is worth is `match`'s, and
   * `src/match/caches.js` already binds BOTH halves of what was asked for to
   * every published feature without knowing where it stands: HOLD F takes what it
   * holds, TAP F lights a 30 s respawn beacon that joins `_safeSpawn`'s
   * forward-spawn auction. So a "beacon area" is a feature on flank ground, and
   * `kind: 'ammo'` is deliberate rather than lazy — `caches.js:KINDS` accepts
   * exactly four strings and silently drops anything else, so a new kind would be
   * an inert painted square until a file outside `world` was edited.
   *
   * AND THE CATHEDRAL GETS TWO. Zone C used to be the crossing, so the building
   * was worth entering by definition; it no longer is, and a 45 m nave nobody has
   * a reason to walk into is the "勿体無い" the whole cathedral pass was about. Two
   * aisle caches — one either end, both on the ground storey `_carveInteriors`
   * publishes, so a bot can be sent to them — are that reason, and they are also
   * the safest beacon on the map to light because you are standing inside a
   * fortress to do it.
   *
   * Positions are LEVEL space, already widened, and scaled here: `BEACON_SPOTS`
   * is authored in widened plan units like the districts it stands in, and the
   * cathedral's own numbers are metres from its crossing.
   */
  const flank = (id, name, kind, x, z, yaw) => {
    const y = groundY(x, z);
    cache(A, rng, kind, x, y, z, yaw);
    out.push({
      id, kind, building: name, floor: 0, indoor: false,
      /** Outdoors on an authored lane: the strongest claim this file can make,
       *  and `Caches.prove` measures it against the real grid regardless. */
      botReachable: true,
      level: { x, y, z },
      yaw,
    });
  };
  for (const b of BEACON_SPOTS) {
    flank(`${b.id}-beacon`, b.name, 'ammo', b.x * SCALE, b.z * SCALE, b.yaw);
  }
  /**
   * The two aisles, 9 m either side of the crossing so neither stands under the
   * dome (which is what the strike takes down) and both are clear of the altar
   * platform and the choir screen. u ∓11.7 m is the middle of an aisle: the
   * arcade piers are 8.6 m off the centreline and the wall face is at 14.15 m.
   */
  for (const [id, kind, u, v] of [
    ['CATH-f0-ammo', 'ammo', -11.7, -9.0],
    ['CATH-f0-grenade', 'grenade', 11.7, 9.0],
  ]) {
    const x = CATHEDRAL.x + u;
    const z = CATHEDRAL.z + v;
    const y = 0.16; // the cathedral floor, a kerb over the street
    cache(A, rng, kind, x, y, z, Math.atan2(-u, 0));
    out.push({
      id, kind, building: CATHEDRAL.id, floor: 0, indoor: true,
      botReachable: true,
      level: { x, y, z },
      yaw: Math.atan2(-u, 0),
    });
  }
  return out;
}

/** Point the cache at the middle of its own floor plate, roughly. */
function facingOf(spec, s, rng) {
  const dx = spec.x - s.x, dz = spec.z - s.z;
  return Math.atan2(dx, dz) + rng.range(-0.25, 0.25);
}

/* ========================================================================= */
/* the caches                                                                */
/* ========================================================================= */
/**
 * One cache. Composed from static boxes and existing prototypes rather than new
 * instanced prototypes: there are twenty-two of these in the level, they are
 * merged into the batches the buildings already draw, and they cost no new draw
 * call.
 *
 * The olive-green ordnance box is the recognition cue. Nothing else in this map
 * is `metal_green` at this size, so once a player has found one he knows what
 * the next one looks like from across a room — which is the whole point of
 * marking a place rather than decorating it.
 */
function cache(A, rng, kind, x, y, z, yaw) {
  paintedSquare(A, rng, x, y, z, yaw, kind === 'vantage' ? 1.5 : 1.7);
  if (kind === 'ammo') ammoDump(A, rng, x, y, z, yaw);
  else if (kind === 'weapon') weaponRack(A, rng, x, y, z, yaw);
  else if (kind === 'grenade') grenadeStack(A, rng, x, y, z, yaw);
  else vantageNest(A, rng, x, y, z, yaw);
}

/** The painted square under a cache: worn stencil paint, not a decal. */
function paintedSquare(A, rng, x, y, z, yaw, r) {
  A.add('plaster_white', BOX_THIN(A), LL(IDENT, x, y + 0.012, z, yaw, r, 0.016, r), {
    masks: [0.15, rng.range(0.75, 0.95), 0.7],
  });
  // a broken border stripe, so it reads as painted and half worn away
  for (const [ox, oz, sx, sz] of [[0, r / 2, r, 0.1], [0, -r / 2, r * 0.7, 0.1], [r / 2, 0, 0.1, r * 0.85], [-r / 2, 0, 0.1, r * 0.5]]) {
    const cx = x + Math.cos(-yaw) * ox - Math.sin(-yaw) * oz;
    const cz = z + Math.sin(-yaw) * ox + Math.cos(-yaw) * oz;
    A.add('plaster_white', BOX_THIN(A), LL(IDENT, cx, y + 0.02, cz, yaw, sx, 0.016, sz), {
      masks: [0.3, rng.range(0.5, 0.8), 0.45],
    });
  }
}

/**
 * An olive ordnance box: body, a proud ribbed lid, two latches and a stencil
 * band. `w` along the local X.
 */
function ordnanceBox(A, rng, x, y, z, yaw, w, d, h, open = false) {
  A.add('metal_green', BOX(A), LL(IDENT, x, y + h * 0.45, z, yaw, w, h * 0.9, d), {
    masks: [rng.range(0.5, 0.8), rng.range(0.45, 0.8), 0.3],
  });
  // the lid, either shut and proud or standing open on its hinge
  if (open) {
    A.add('metal_green', BOX(A), LL(IDENT, x, y + h * 1.25, z, yaw, w, 0.06, d * 0.95, -1.15), {
      masks: [0.7, 0.5, 0.25],
    });
    // dark interior with tins in it
    A.add('metal_dark', BOX(A), LL(IDENT, x, y + h * 0.86, z, yaw, w * 0.9, 0.04, d * 0.85), {
      masks: [0.2, 0.9, 0.8],
    });
    for (let i = 0; i < 3; i++) {
      A.add('steel', BOX(A), LL(IDENT, x + Math.cos(yaw) * (i - 1) * w * 0.28, y + h * 0.95, z - Math.sin(yaw) * (i - 1) * w * 0.28, yaw + rng.range(-0.2, 0.2), w * 0.22, 0.12, d * 0.55), {
        masks: [0.8, 0.5, 0.2],
      });
    }
  } else {
    A.add('metal_green', BOX(A), LL(IDENT, x, y + h * 0.93, z, yaw, w + 0.05, 0.09, d + 0.05), {
      masks: [0.8, rng.range(0.4, 0.7), 0.25],
    });
  }
  // latches and a carry handle
  for (const s of [-1, 1]) {
    A.add('steel', BOX_THIN(A), LL(IDENT, x + Math.cos(yaw) * s * w * 0.34, y + h * 0.72, z - Math.sin(yaw) * s * w * 0.34, yaw, 0.07, 0.12, d + 0.06), {
      masks: [0.9, 0.4, 0.1],
    });
  }
  // stencil band on the long face
  A.add('plaster_white', BOX_THIN(A), LL(IDENT, x + Math.sin(yaw) * (d / 2 + 0.01), y + h * 0.5, z + Math.cos(yaw) * (d / 2 + 0.01), yaw, w * 0.55, 0.11, 0.01), {
    masks: [0.2, rng.range(0.6, 0.9), 0.5],
  });
  if (h >= 0.42) A.box('metal', x, y + h * 0.5, z, w, h, d, yaw);
}

function ammoDump(A, rng, x, y, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (ox, oz) => [x + c * ox + s * oz, z - s * ox + c * oz];
  A.put('pallet', ...pos(at(0, 0), y), yaw, 1);
  const [bx, bz] = at(-0.16, 0);
  ordnanceBox(A, rng, bx, y + 0.14, bz, yaw, 1.05, 0.44, 0.4);
  ordnanceBox(A, rng, bx + rng.range(-0.05, 0.05), y + 0.14 + 0.42, bz + rng.range(-0.04, 0.04), yaw + rng.range(-0.12, 0.12), 1.0, 0.42, 0.38);
  const [ox, oz] = at(0.72, 0.35);
  ordnanceBox(A, rng, ox, y, oz, yaw + 0.6, 0.95, 0.42, 0.38, true);
  A.put('jerry_can', ...pos(at(0.55, -0.6), y), yaw + rng.range(0, 1.2), 1);
  A.put(rng.float() < 0.5 ? 'sandbag_a' : 'sandbag_c', ...pos(at(-0.85, 0.55), y), yaw + 0.4, 1);
  A.put('box_card_b', ...pos(at(0.2, 0.9), y), yaw - 0.5, 1);
  /** The stack is 0.8 m of steel boxes: solid, or it is a thing you walk through. */
  A.box('metal', bx, y + 0.5, bz, 1.15, 0.9, 0.52, yaw);
}

function weaponRack(A, rng, x, y, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (ox, oz) => [x + c * ox + s * oz, z - s * ox + c * oz];
  // A-frame: two feet, two uprights, two rails
  for (const sx of [-1, 1]) {
    const [px, pz] = at(sx * 0.62, 0);
    A.add('wood_prop_dark', BOX(A), LL(IDENT, px, y + 0.55, pz, yaw, 0.09, 1.1, 0.09), {
      masks: [0.6, rng.range(0.4, 0.8), 0.4],
    });
    A.add('wood_prop_dark', BOX(A), LL(IDENT, px, y + 0.04, pz, yaw, 0.14, 0.08, 0.7), {
      masks: [0.7, 0.6, 0.4],
    });
  }
  for (const ry of [0.42, 1.02]) {
    A.add('wood_prop_dark', BOX(A), LL(IDENT, x, y + ry, z, yaw, 1.34, 0.08, 0.1), {
      masks: [0.65, rng.range(0.4, 0.8), 0.35],
    });
  }
  A.box('wood', x, y + 0.55, z, 1.4, 1.1, 0.5, yaw);
  /**
   * Three long arms in the rack, wrapped in sacking. NOT a weapon: `src/weapons`
   * owns every gun in this build and a rifle modelled here would be a second,
   * worse one. A wrapped bundle of the right length and lean says "long arms" and
   * cannot contradict anything.
   */
  for (let i = 0; i < 3; i++) {
    const ox = (i - 1) * 0.38 + rng.range(-0.05, 0.05);
    const [px, pz] = at(ox, 0.06);
    A.add('burlap', BOX(A), LL(IDENT, px, y + 0.62, pz, yaw, 0.12, 1.15, 0.16, rng.range(0.1, 0.22)), {
      masks: [0.4, rng.range(0.5, 0.9), 0.35],
    });
    A.add('wood_prop', BOX_THIN(A), LL(IDENT, px, y + 1.1, pz, yaw, 0.1, 0.22, 0.13, rng.range(0.1, 0.22)), {
      masks: [0.6, 0.5, 0.3],
    });
  }
  const [bx, bz] = at(0.95, -0.5);
  ordnanceBox(A, rng, bx, y, bz, yaw + 1.2, 1.0, 0.42, 0.4, true);
  A.put('crate_b', ...pos(at(-1.0, -0.55), y), yaw + 0.3, 1);
}

function grenadeStack(A, rng, x, y, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (ox, oz) => [x + c * ox + s * oz, z - s * ox + c * oz];
  A.put('crate_flat', ...pos(at(0, 0), y), yaw, 1);
  const [bx, bz] = at(0, 0);
  ordnanceBox(A, rng, bx, y + 0.28, bz, yaw, 0.62, 0.34, 0.3);
  ordnanceBox(A, rng, bx + rng.range(-0.04, 0.04), y + 0.28 + 0.31, bz, yaw + rng.range(-0.15, 0.15), 0.58, 0.32, 0.28);
  const [ox, oz] = at(0.66, 0.22);
  ordnanceBox(A, rng, ox, y, oz, yaw - 0.7, 0.6, 0.34, 0.3, true);
  A.put(rng.float() < 0.5 ? 'sandbag_b' : 'sandbag_c', ...pos(at(-0.7, 0.3), y), yaw + 0.8, 1);
  A.put('bucket', ...pos(at(0.5, -0.65), y), yaw, 1);
  A.box('metal', bx, y + 0.45, bz, 0.66, 0.72, 0.38, yaw);
}

/**
 * A firing position: an L of sandbags at the parapet, something to sit on, a
 * spotting scope on a tripod and a box of ammunition. On a roof this is the
 * difference between "a concrete plate you can be shot on" and "the place the
 * man who owns this lane sits".
 */
function vantageNest(A, rng, x, y, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (ox, oz) => [x + c * ox + s * oz, z - s * ox + c * oz];
  const [ax, az] = at(0, 1.05);
  sandbagWall(A, rng, ax, az, yaw, 2.3, 3, y);
  const [ex, ez] = at(1.2, 0.1);
  sandbagWall(A, rng, ex, ez, yaw + Math.PI / 2, 1.5, 2, y);
  // the scope: three legs and a body
  const [tx, tz] = at(-0.1, 0.55);
  for (let i = 0; i < 3; i++) {
    const a = yaw + (i / 3) * Math.PI * 2;
    A.add('metal_dark', BOX_THIN(A), LL(IDENT, tx + Math.cos(a) * 0.12, y + 0.42, tz + Math.sin(a) * 0.12, a, 0.035, 0.9, 0.035, 0.22), {
      masks: [0.7, 0.5, 0.2],
    });
  }
  A.add('metal_dark', BOX(A), LL(IDENT, tx, y + 0.92, tz, yaw, 0.1, 0.11, 0.44, -0.12), {
    masks: [0.5, 0.5, 0.2],
  });
  A.add('glass', BOX_THIN(A), LL(IDENT, tx + s * 0.23, y + 0.95, tz + c * 0.23, yaw, 0.07, 0.07, 0.02), {
    masks: [0.2, 0.3, 0.1],
  });
  const [bx, bz] = at(-0.95, 0.3);
  ordnanceBox(A, rng, bx, y, bz, yaw + 0.4, 0.95, 0.42, 0.4, true);
  A.put('crate_a', ...pos(at(-0.55, -0.55), y), yaw + rng.range(-0.4, 0.4), 1);
  A.put(rng.float() < 0.5 ? 'tyre' : 'bucket', ...pos(at(0.75, -0.75), y), yaw, 1);
  // spent cases and a water bottle: somebody has been here
  for (let i = 0; i < rng.int(4, 8); i++) {
    A.put(rng.float() < 0.6 ? 'can' : 'bottle', ...pos(at(rng.range(-1.2, 1.2), rng.range(-1.0, 0.6)), y), rng.float() * 6.28, 1);
  }
}

/** `A.put` takes (x, y, z); the helpers above work in (x, z) pairs. */
function pos(xz, y) {
  return [xz[0], y, xz[1]];
}
