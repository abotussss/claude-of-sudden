import { BOX, BOX_FINE, BOX_SOFT, BOX_THIN, IDENT, LL } from '../kit.js';
import { fbm3 } from '../util.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD — THE STORES. What is actually IN the tower and the fortress.
 * ════════════════════════════════════════════════════════════════════════════
 * 「管制塔はなんのためにあんの？？ 物資もないし 来る意味ないやん / 要塞もっと軍事
 *   要塞にしろよ 物資豊富にしろ」
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE COMPLAINT IS A MEASUREMENT, AND THE NUMBER WAS ZERO
 * ────────────────────────────────────────────────────────────────────────────
 * `plains.js` returns `features: []`. `WorldSystem` assigns that straight to
 * `world.features`, `MatchSystem` hands `world.features` to `new Caches(...)`,
 * and `_nftier.mjs` reported it back from inside a live match on the plain:
 *
 *     caches: 0 bound, 0 proved bot-walkable
 *     {"ammo":0,"weapon":0,"grenade":0,"vantage":0,"medic":0}
 *
 * There was not one round, one frag, one gun, one med kit or one beacon socket
 * anywhere on three hundred metres of plain. "来る意味ないやん" is not a
 * complaint about the architecture of the tower; it is the literal state of the
 * map. The town has twenty-four of these and a whole file of measurements about
 * what happened to bot behaviour when they were bound; this map had none.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THE RECORDS RIDE ON `world.demolitions` AND NOT ON `world.features`
 * ────────────────────────────────────────────────────────────────────────────
 * `world.features` is `rec.features` from `level.build`, and on this map that
 * array literal is written in `plains.js` — which three other people are inside
 * this session and which this pass may not edit. `src/match/caches.js` has
 * already been here: the cathedral's two posts are built from `world.cathedral`
 * because "the cathedral is deliberately not a `BUILDINGS` entry … and
 * `src/world` is being worked on by somebody else. `match` already owns 'what a
 * published place is worth'; these two extend that to 'and one place the level
 * did not publish', with the position taken from the one record `world` does
 * publish".
 *
 * That sentence is this situation exactly, and the one record `world` DOES
 * publish for these two structures is their DEMOLITION record — `publishWorks`
 * mutates the very object `buildTower`/`buildFort` hand back and pushes THAT
 * into `world.demolitions`, so a field set here arrives intact. So each
 * structure hangs its own store list on its own record, and `Caches` grew one
 * generic loop that reads `world.demolitions[*].caches`. No id of this map is
 * named in `src/match`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `perishable` — THE HALF OF THIS THAT IS NOT COSMETIC
 * ────────────────────────────────────────────────────────────────────────────
 * Both structures scope their SUPERSTRUCTURE for demolition and keep their
 * ground: the tower's shell is everything above the P2 deck (which includes the
 * control room, whose slab and walls are inside `shell:NF-TOWER`), the
 * fortress's is the parapet, the gatehouses and the magazine. A cache dressed
 * inside a shell is a crate that disappears when the strike lands — so the
 * record says so, and `Caches.update` disables it the frame the record goes
 * down. A live pickup marker floating in a rubble field is the same bug as
 * floating rubble, and it has shipped here four times.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `beacon: false` — WHERE A FORWARD SPAWN MAY NOT BE SWITCHED ON
 * ────────────────────────────────────────────────────────────────────────────
 * Any cache takes a beacon on a TAP of `use`, and `MatchSystem._safeSpawn`
 * then respawns the whole side at it — through `_jitterOnto`, which drops a ray
 * from `beacon.y + 3` and puts the man on whatever solid it finds. At the two
 * PLAYER-ONLY posts in the tower (the rack on the top shaft storey at 21.2 m
 * and the cab at 26 m) that ray finds a shaft slab, and `NavGrid` is a 2.5 D
 * height field with no route to one: every bot spawned there is stranded for
 * the rest of his life. So those two refuse the beacon and say so in one flag
 * that `Caches.plantBeacon` reads. Every reachable post on the map still takes
 * one, which is the whole feature.
 */

/**
 * ONE STORE POST, as `src/match/caches.js` consumes it.
 *
 * `x`/`y`/`z` are LEVEL space (which on this map is world space, but `Caches`
 * pushes them through `world.levelToWorld` anyway, so the record is honest on a
 * level with a transform). `yaw` is the facing a man stands on it from, and is
 * what the medical-zone dressing and the HUD marker orient off.
 *
 * @param {string} id
 * @param {'ammo'|'weapon'|'grenade'|'vantage'|'medic'} kind
 * @param {object} opts `botReachable` (default true), `perishable`, `beacon`
 */
export function post(id, kind, x, y, z, yaw = 0, opts = {}) {
  return {
    id,
    kind,
    level: { x, y, z },
    yaw,
    /**
     * Whether a BOT is meant to be able to walk here. It is a claim, not a
     * fact: `Caches.prove` snaps every one of these to a real nav cell and
     * requires an A* route from a spawn of each side before it keeps it, which
     * is the same two-step `sites.js` applies to a capture point. A post
     * flagged true that the grid disagrees with is dropped with a warning.
     */
    botReachable: opts.botReachable !== false,
    /** Dies with its structure's shell scope. @see the header. */
    perishable: !!opts.perishable,
    /** May a forward spawn be switched on here? @see the header. */
    beacon: opts.beacon !== false,
  };
}

// ───────────────────────────────────────────────────────────────── dressing ──
/**
 * A painted hardstanding square under a post, so the ground itself says a post
 * is here. Flat geometry only — 2 cm of paint, no proxy, nothing to trip on.
 */
function bay(A, x, y, z, yaw, w, d, tint = 'concrete_dark') {
  A.add(tint, BOX_SOFT(A), LL(IDENT, x, y + 0.02, z, yaw, w, 0.04, d), { masks: [0.7, 0.55, 0.2] });
  // the yellow hatching round it — the line that says "do not stack here"
  for (const [ox, oz, sw, sd] of [[0, d / 2, w, 0.14], [0, -d / 2, w, 0.14], [w / 2, 0, 0.14, d], [-w / 2, 0, 0.14, d]]) {
    A.add('road_dust', BOX_THIN(A), LL(IDENT,
      x + Math.cos(yaw) * ox + Math.sin(yaw) * oz, y + 0.045, z - Math.sin(yaw) * ox + Math.cos(yaw) * oz,
      yaw, sw, 0.012, sd), { masks: [0.85, 0.2, 0.05] });
  }
}

/** Ordnance: a chest with a lid and stencilled bands. `h` is its own height. */
function chest(A, rng, key, x, y, z, yaw, w, h, d, lid = 'metal_dark') {
  A.add(key, BOX(A), LL(IDENT, x, y + h / 2, z, yaw, w, h, d), {
    paint: (px, py, pz, nx, ny, nz, out) => {
      const n = fbm3(px * 0.9, py * 0.9, pz * 0.9, 2);
      // a stencilled band across the middle of every face, which is the read
      const band = Math.abs(((py - y) / h) - 0.62) < 0.07 ? 1 : 0;
      out[0] = Math.min(1, 0.35 + n * 0.4 + band * 0.45);
      out[1] = Math.min(1, 0.3 + n * 0.45);
      out[2] = Math.min(1, 0.2 + n * 0.25);
    },
  });
  A.box(A.surfaceOf(key), x, y + h / 2, z, w, h, d, yaw);
  A.add(lid, BOX_SOFT(A), LL(IDENT, x, y + h + 0.035, z, yaw, w + 0.07, 0.09, d + 0.07), { masks: [0.85, 0.5, 0.1] });
  // the two catches and the rope handle at each end
  for (const s of [-1, 1]) {
    A.add('metal_rust', BOX_FINE(A), LL(IDENT,
      x + Math.cos(yaw) * s * (w / 2) * 0.55, y + h * 0.72, z - Math.sin(yaw) * s * (w / 2) * 0.55,
      yaw, 0.09, 0.13, d + 0.05), { masks: [0.9, 0.7, 0.1] });
  }
  if (rng.float() < 0.5) {
    A.add('metal_rust', BOX_THIN(A), LL(IDENT, x, y + h * 0.35, z, yaw, w * 0.5, 0.05, d + 0.08), { masks: [0.95, 0.8, 0.2] });
  }
}

/**
 * THE DRESSING FOR ONE POST, by kind.
 *
 * Every one of these is authored geometry rather than scattered props, because
 * a supply post that looks like the litter it is standing in is a supply post
 * nobody walks to — the same argument `caches.js` makes for building the
 * medical zone's cross out of emissive rather than matte red ("a matte red
 * square on a grey street at dusk is invisible"). At 21:40 on a moonlit plain
 * that is not a preference, it is whether the feature exists.
 *
 * WHAT IS TALL AND WHAT IS FLAT. `STANCE.stand.stepHeight` is 0.42 and anything
 * whose top lands between that and about 0.68 is the trip hazard
 * 「石ころオブジェが移動の妨げです」 is about. So every piece here is either under
 * 0.40 (walked over) or over 0.75 (walked round); nothing sits in the band.
 */
export function dressPost(A, rng, kind, x, y, z, yaw = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  /** post-local (right, forward) -> world. `forward` is the facing. */
  const px = (r, f) => x + c * r + s * f;
  const pz = (r, f) => z - s * r + c * f;

  if (kind === 'ammo') {
    bay(A, x, y, z, yaw, 3.4, 3.0);
    // a pallet stack of belted ammunition, at working height and no higher
    A.add('wood', BOX_SOFT(A), LL(IDENT, px(-0.85, 0.5), y + 0.07, pz(-0.85, 0.5), yaw, 1.5, 0.14, 1.1), { masks: [0.6, 0.4, 0.2] });
    A.box('wood', px(-0.85, 0.5), y + 0.07, pz(-0.85, 0.5), 1.5, 0.14, 1.1, yaw);
    chest(A, rng, 'metal_green', px(-0.85, 0.5), y + 0.14, pz(-0.85, 0.5), yaw, 1.24, 0.86, 0.78);
    chest(A, rng, 'metal_green', px(0.95, -0.35), y, pz(0.95, -0.35), yaw + 0.5, 1.0, 0.82, 0.66);
    // the OPEN one, and the light out of it is what reads at forty metres
    A.add('metal_green', BOX(A), LL(IDENT, px(0.55, 0.85), y + 0.19, pz(0.55, 0.85), yaw - 0.3, 0.92, 0.38, 0.62), { masks: [0.5, 0.4, 0.2] });
    A.box('metal', px(0.55, 0.85), y + 0.19, pz(0.55, 0.85), 0.92, 0.38, 0.62, yaw - 0.3);
    A.add('ember', BOX_SOFT(A), LL(IDENT, px(0.55, 0.85), y + 0.4, pz(0.55, 0.85), yaw - 0.3, 0.74, 0.05, 0.46));
    // brass on the deck round it
    for (let i = 0; i < 14; i++) {
      A.add('steel', BOX_THIN(A), LL(IDENT,
        px(rng.range(-1.5, 1.5), rng.range(-1.3, 1.3)), y + 0.03, pz(rng.range(-1.5, 1.5), rng.range(-1.3, 1.3)),
        rng.float() * 6.28, 0.035, 0.035, rng.range(0.06, 0.11)), { masks: [0.9, 0.35, 0] });
    }
    return;
  }

  if (kind === 'grenade') {
    bay(A, x, y, z, yaw, 2.8, 2.6);
    // a low steel table with the frags laid out on it, open crates under it
    A.add('metal_dark', BOX(A), LL(IDENT, px(0, 0), y + 0.36, pz(0, 0), yaw, 1.7, 0.07, 0.95), { masks: [0.8, 0.5, 0.15] });
    A.box('metal', px(0, 0), y + 0.2, pz(0, 0), 1.7, 0.4, 0.95, yaw);
    for (let i = 0; i < 10; i++) {
      const r = -0.62 + (i % 5) * 0.31;
      const f = i < 5 ? -0.16 : 0.16;
      A.add('metal_green', BOX_SOFT(A), LL(IDENT, px(r, f), y + 0.47, pz(r, f), yaw + rng.range(-0.3, 0.3), 0.14, 0.19, 0.14), { masks: [0.5, 0.6, 0.2] });
      A.add('metal_rust', BOX_THIN(A), LL(IDENT, px(r, f), y + 0.58, pz(r, f), yaw, 0.05, 0.05, 0.05), { masks: [0.9, 0.7, 0.1] });
    }
    // the fibre carriers they came in, stood on end against the back
    for (let i = 0; i < 3; i++) {
      A.add('wood_dark', BOX(A), LL(IDENT, px(-0.9 + i * 0.34, -1.0), y + 0.44, pz(-0.9 + i * 0.34, -1.0), yaw + rng.range(-0.15, 0.15), 0.3, 0.88, 0.3), { masks: [0.6, 0.5, 0.25] });
      A.box('wood', px(-0.9 + i * 0.34, -1.0), y + 0.44, pz(-0.9 + i * 0.34, -1.0), 0.3, 0.88, 0.3, yaw);
    }
    A.add('ember', BOX_SOFT(A), LL(IDENT, px(0, 0), y + 0.42, pz(0, 0), yaw, 1.5, 0.03, 0.8));
    return;
  }

  if (kind === 'weapon') {
    bay(A, x, y, z, yaw, 2.6, 2.2);
    /**
     * A RIFLE RACK. Two uprights, three rails and the long arms stood in it —
     * and it is the one piece of dressing on this map that is a PROMISE: the
     * rack the player is looking at hands over a different primary weapon on a
     * HOLD, and `Caches` picks which one round-robin over `weapons.primaryIds`
     * so the answer is the same every boot. "I know where the bolt gun is" is
     * the reason a man crosses a plain and climbs twenty-one metres.
     */
    for (const r of [-1.05, 1.05]) {
      A.add('metal_dark', BOX(A), LL(IDENT, px(r, 0), y + 0.9, pz(r, 0), yaw, 0.12, 1.8, 0.5), { masks: [0.8, 0.5, 0.15] });
      A.box('metal', px(r, 0), y + 0.9, pz(r, 0), 0.12, 1.8, 0.5, yaw);
    }
    for (const h of [0.42, 1.05, 1.62]) {
      A.add('metal_dark', BOX_THIN(A), LL(IDENT, px(0, 0.13), y + h, pz(0, 0.13), yaw + Math.PI / 2, 0.07, 0.07, 2.1), { masks: [0.85, 0.55, 0.1] });
    }
    for (let i = 0; i < 5; i++) {
      const r = -0.82 + i * 0.41;
      const tilt = rng.range(-0.09, 0.09);
      A.add('wood_dark', BOX_THIN(A), LL(IDENT, px(r, 0.08), y + 0.78, pz(r, 0.08), yaw, 0.07, 1.5, 0.11, tilt, 0.06), { masks: [0.7, 0.5, 0.2] });
      A.add('metal_dark', BOX_THIN(A), LL(IDENT, px(r, 0.06), y + 1.16, pz(r, 0.06), yaw, 0.05, 0.62, 0.05, tilt, 0.06), { masks: [0.85, 0.45, 0.05] });
      A.add('metal_green', BOX_FINE(A), LL(IDENT, px(r, 0.04), y + 0.62, pz(r, 0.04), yaw, 0.06, 0.24, 0.1, tilt, 0.06), { masks: [0.6, 0.5, 0.1] });
    }
    // the bench of loaded magazines in front of it
    A.add('metal_dark', BOX(A), LL(IDENT, px(0, 0.85), y + 0.19, pz(0, 0.85), yaw, 1.9, 0.38, 0.6), { masks: [0.75, 0.5, 0.2] });
    A.box('metal', px(0, 0.85), y + 0.19, pz(0, 0.85), 1.9, 0.38, 0.6, yaw);
    for (let i = 0; i < 7; i++) {
      A.add('metal_green', BOX_FINE(A), LL(IDENT, px(-0.72 + i * 0.24, 0.85), y + 0.44, pz(-0.72 + i * 0.24, 0.85), yaw + rng.range(-0.2, 0.2), 0.07, 0.1, 0.2), { masks: [0.55, 0.55, 0.1] });
    }
    A.add('ember', BOX_SOFT(A), LL(IDENT, px(0, 0.2), y + 1.72, pz(0, 0.2), yaw, 1.9, 0.04, 0.1));
    return;
  }

  if (kind === 'vantage') {
    /**
     * A FIRING POSITION. `caches.js`: "a firing position is somewhere you sit
     * and shoot from, and what you need to do that is rounds" — so a vantage
     * hands over ammunition, and what it LOOKS like is a nest: a sandbag
     * horseshoe open to the front, an ordnance box inside it, a spotting scope
     * and a range card pinned to the parapet.
     */
    bay(A, x, y, z, yaw, 3.0, 2.4);
    for (let i = 0; i < 16; i++) {
      const a = Math.PI * (0.12 + (i % 8) / 8 * 0.76) + Math.PI;
      const tier = i < 8 ? 0 : 1;
      const rr = 1.28 - tier * 0.06;
      A.put(rng.pick(['sandbag_a', 'sandbag_b', 'sandbag_c']),
        px(Math.cos(a) * rr, Math.sin(a) * rr), y + 0.09 + tier * 0.19, pz(Math.cos(a) * rr, Math.sin(a) * rr),
        yaw + a + rng.range(-0.15, 0.15), rng.range(0.98, 1.14));
    }
    chest(A, rng, 'metal_green', px(-0.55, -0.35), y, pz(-0.55, -0.35), yaw + 0.35, 1.06, 0.82, 0.7);
    A.add('ember', BOX_SOFT(A), LL(IDENT, px(-0.55, -0.35), y + 0.9, pz(-0.55, -0.35), yaw, 0.82, 0.04, 0.5));
    // the scope on its tripod, pointed the way the position faces
    for (let k = 0; k < 3; k++) {
      const a = yaw + k * 2.09;
      A.add('metal_dark', BOX_THIN(A), LL(IDENT,
        px(0.7 + Math.sin(a) * 0.16, 0.5 + Math.cos(a) * 0.16), y + 0.42, pz(0.7 + Math.sin(a) * 0.16, 0.5 + Math.cos(a) * 0.16),
        a, 0.045, 0.86, 0.045, Math.sin(a) * 0.16, Math.cos(a) * 0.16), { masks: [0.85, 0.5, 0.1] });
    }
    A.add('metal_dark', BOX(A), LL(IDENT, px(0.7, 0.5), y + 0.94, pz(0.7, 0.5), yaw, 0.16, 0.16, 0.52), { masks: [0.8, 0.45, 0.1] });
    A.add('window_glow', BOX_FINE(A), LL(IDENT, px(0.7, 0.76), y + 0.94, pz(0.7, 0.76), yaw, 0.1, 0.1, 0.03), { masks: [0.2, 0.3, 0] });
    return;
  }

  if (kind === 'medic') {
    /**
     * The disc, the ground cross and the standard are `match`'s
     * (`Caches.buildMedicMarkers` paints them from the RESOLVED position, the
     * same way `SiteMarks` paints a capture circle) — so what the level builds
     * is only what `match` cannot know about: the kit itself, on the ground, at
     * a height a man steps over. It is kept inside 1.4 m so it never fouls the
     * 2.15 m standard that dressing stands off the centre.
     */
    A.add('plaster_sand', BOX(A), LL(IDENT, px(0, 0), y + 0.17, pz(0, 0), yaw, 0.95, 0.34, 0.62), { masks: [0.3, 0.3, 0.15] });
    A.box('concrete', px(0, 0), y + 0.17, pz(0, 0), 0.95, 0.34, 0.62, yaw);
    A.add('ember', BOX_FINE(A), LL(IDENT, px(0, 0), y + 0.35, pz(0, 0), yaw, 0.5, 0.02, 0.16));
    A.add('ember', BOX_FINE(A), LL(IDENT, px(0, 0), y + 0.35, pz(0, 0), yaw, 0.16, 0.02, 0.5));
    // a second, closed chest and a rolled stretcher beside it
    A.add('plaster_sand', BOX(A), LL(IDENT, px(-0.85, -0.3), y + 0.15, pz(-0.85, -0.3), yaw + 0.4, 0.72, 0.3, 0.5), { masks: [0.35, 0.3, 0.15] });
    A.box('concrete', px(-0.85, -0.3), y + 0.15, pz(-0.85, -0.3), 0.72, 0.3, 0.5, yaw + 0.4);
    A.add('fabric_cream', BOX_SOFT(A), LL(IDENT, px(0.95, 0.15), y + 0.14, pz(0.95, 0.15), yaw + 1.2, 0.28, 0.28, 1.9), { masks: [0.4, 0.35, 0.2] });
    for (const s of [-1, 1]) {
      A.add('wood', BOX_THIN(A), LL(IDENT, px(0.95 + s * 0.17, 0.15), y + 0.09, pz(0.95 + s * 0.17, 0.15), yaw + 1.2, 0.05, 0.05, 2.1), { masks: [0.6, 0.4, 0.2] });
    }
  }
}
