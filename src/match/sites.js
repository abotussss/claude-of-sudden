/**
 * MATCH — where the round is fought.
 *
 * Bomb sites and both team spawns, authored in LEVEL space (the same
 * coordinates `src/world/layout.js` uses) and pushed through
 * `world.levelToWorld()` so they follow the level transform. Nothing here
 * builds geometry: the map is the repo's market street exactly as shipped, and
 * this file only decides which parts of it the round happens in.
 *
 * Every point is SNAPPED to the navigation grid at resolve time. Authoring a
 * spawn six inches inside a wall is the classic way to lose a whole team to a
 * stuck pathfind, and the fallback below is what stops a layout tweak in
 * `world` from silently breaking the mode.
 */

import * as THREE from 'three';
import { RULES } from './rules.js';

/**
 * ONE SITE AT THE END OF EACH OUTER LANE, 56 m apart.
 *
 * The map is three lanes now (see the diagram at the top of
 * `src/world/layout.js`): an A lane down the west side, the old market street
 * as MID, a B lane down the east side, joined by two connectors in the middle.
 * Each lane bulges into a 15 x 14 m walled courtyard at x ∓28, z -4, which is
 * where its site sits.
 *
 * A SITE IS A ZONE, NOT A DOT. `RULES.plantRadius` is 8, so the 16 m circle
 * centred here covers the whole courtyard and nothing outside it. Each
 * courtyard has THREE mouths — the lane from the north (the attack's natural
 * approach), the lane from the south (the defence's), and the connector from
 * the mid street (either side's, and the one a fake gets punished through) —
 * plus a lorry, two sandbag runs, a barrier line and a collapsed corner inside
 * it, so a plant can be made from cover and a defuse can be contested.
 *
 * WHAT THESE REPLACE. Both sites used to sit a few metres either side of the
 * SAME stretch of the one street, at nearly the same z. `tools/lanecheck.mjs`
 * measured the consequence: 59.3 % of the attack's route to A lay within 6 m of
 * its route to B, so there was nothing to fake and nothing to rotate between.
 *
 * `fallback` is a point further up the same lane, used if the primary does not
 * resolve onto walkable ground.
 */
/**
 * THE MAP IS 1.5x AND THESE ARE IN THE MAP'S COORDINATES.
 *
 * `src/world/layout.js` scales its whole authored plan by `SCALE` (see the long
 * note at the bottom of that file). Everything here is a LEVEL-space point in
 * that same plan — the courtyard centres, the hold points, both spawn clusters
 * — so every one of them has to move with it, or the mode plays the old map's
 * geometry on the new map's ground: sites inside a building, spawns outside the
 * perimeter wall.
 *
 * `match` may not import `world`, so the factor is repeated here rather than
 * shared, exactly as `KEEPOUT` in layout.js repeats these site centres. IF ONE
 * MOVES, MOVE THE OTHER. `tools/navcheck.mjs` is the gate — it fails loudly the
 * moment a spawn cannot reach a site.
 */
const SCALE = 1.5;
const L = (x, z) => [x * SCALE, z * SCALE];
const spawnRow = (r) => r.map(([x, z, y]) => [x * SCALE, z * SCALE, y]);

export const SITES = [
  {
    id: 'A',
    name: 'WEST COURTYARD',
    level: L(-28.0, -4.0),
    fallback: L(-25.5, -6.0),
    /**
     * Where defenders set up: on the mouth their own rotation arrives through,
     * which for both sites is the lane from the south. Open courtyard ground,
     * NOT inside a building — see groundPoint's roof note.
     */
    holdLevel: L(-26.0, -9.8),
  },
  {
    id: 'B',
    name: 'EAST COURTYARD',
    level: L(28.4, -3.6),
    fallback: L(25.5, -6.0),
    holdLevel: L(26.4, -9.4),
  },
];

/**
 * Spawns, `[x, z, yaw]` in level space.
 *
 * Both clusters sit in the MID lane behind their own cross street — the attack
 * in the pocket north of W5/E5, the defence in the pocket south of W4/E4 — so
 * each side steps out of spawn into a full-width cross street and chooses a
 * lane there. That is what makes all three routes live: from the attack spawn
 * the A lane, mid and the B lane are 68, 69 and 68 m to their respective
 * objectives, so no route is the obvious one.
 *
 * THE SEPARATION IS LOAD-BEARING. An actor's view range is 58 m
 * (`Agent.viewRange`). At the first spacing tried on the old map — closest pair
 * 51 m — both sides acquired a target on the spawn frame and spent the round
 * trading shots down the middle instead of playing the objective. The two cross
 * streets are also blind to each other because the mid street's median (`K1`,
 * `K2`) stands between them, so the round opens with two teams walking rather
 * than two teams already shooting.
 *
 * FIFTEEN A SIDE NEEDS FIFTEEN POINTS. `_spawnTeam` walks this list modulo its
 * length, so seven points for fifteen men stacks two bodies per point inside a
 * 1.1 m jitter — they spend the freeze shoving each other out of the way and
 * the first thing the round does is look broken. Five ranks of three, filling
 * the mid-lane pocket the seven-man version only sampled:
 *
 *   x  -5.0    0.0    +5.0        (the mid lane's kerb line is x ±6.5)
 *   z  44.6  42.0  39.4  36.8  34.2   attack   (north cross street is z 24..32)
 *   z -44.6 -42.0 -39.4 -36.8 -34.2   defence  (south cross street is z -34..)
 *
 * The closest attack/defence pair is 68.4 m, still comfortably outside the 58 m
 * view range, so the opening frame is still two teams walking. These are also
 * the RESPAWN points — `MatchSystem._safeSpawn` picks whichever of the fifteen
 * has the most empty ground around it, which only works if there are enough of
 * them to choose between.
 */
export const SPAWNS = {
  attack: spawnRow([
    [-5.0, 44.6, Math.PI], [0.0, 44.6, Math.PI], [5.0, 44.6, Math.PI],
    [-5.0, 42.0, Math.PI], [0.0, 42.0, Math.PI], [5.0, 42.0, Math.PI],
    [-5.0, 39.4, Math.PI], [0.0, 39.4, Math.PI], [5.0, 39.4, Math.PI],
    [-5.0, 36.8, Math.PI], [0.0, 36.8, Math.PI], [5.0, 36.8, Math.PI],
    [-5.0, 34.2, Math.PI], [0.0, 34.2, Math.PI], [5.0, 34.2, Math.PI],
  ]),
  defend: spawnRow([
    [-5.0, -44.6, 0], [0.0, -44.6, 0], [5.0, -44.6, 0],
    [-5.0, -42.0, 0], [0.0, -42.0, 0], [5.0, -42.0, 0],
    [-5.0, -39.4, 0], [0.0, -39.4, 0], [5.0, -39.4, 0],
    [-5.0, -36.8, 0], [0.0, -36.8, 0], [5.0, -36.8, 0],
    [-5.0, -34.2, 0], [0.0, -34.2, 0], [5.0, -34.2, 0],
  ]),
};

/**
 * Turn the authored level coordinates into world-space points that a character
 * can actually stand on.
 *
 * @param {object} world  the `world` subsystem (for levelToWorld)
 * @param {object} ai     the `ai` subsystem (for the nav grid + ground probe)
 * @returns {{sites: Array, spawns: {attack: Array, defend: Array}}}
 */
export function resolveLayout(world, ai) {
  const snap = (lx, lz, fx, fz, tag) => {
    const primary = groundPoint(world, ai, lx, lz);
    if (walkable(ai, primary)) return primary;
    const alt = groundPoint(world, ai, fx ?? lx, fz ?? lz);
    console.warn(
      `[match] ${tag}: level (${lx}, ${lz}) is not walkable — using the fallback ` +
        `(${fx}, ${fz})`
    );
    return walkable(ai, alt) ? alt : primary;
  };

  const bake = (list) =>
    list.map(([x, z, yaw]) => ({
      position: groundPoint(world, ai, x, z),
      yaw: yaw + (world?.levelYaw ?? 0),
    }));
  const spawns = { attack: bake(SPAWNS.attack), defend: bake(SPAWNS.defend) };
  for (const k of ['attack', 'defend']) for (const sp of spawns[k]) walkable(ai, sp.position);

  const sites = SITES.map((s) => {
    const position = snap(s.level[0], s.level[1], s.fallback[0], s.fallback[1], `site ${s.id}`);
    ensureReachable(ai, position, spawns, ['attack', 'defend'], `site ${s.id}`, false);
    const hold = groundPoint(world, ai, s.holdLevel[0], s.holdLevel[1]);
    /**
     * A hold point only ever has defenders sent to it. It is anchored with the
     * same relaxed rule the sites use — one defend spawn proving the area is
     * part of the playable map — because the strict "every spawn" version could
     * not be satisfied anywhere within 35 m of either authored point once the
     * interiors went in, so both holds silently collapsed onto the site centre
     * and shouted an error every boot. Individual spawns are proved against the
     * SITES below, and `Agent._advanceFallback` covers the rest.
     */
    const holdOk =
      walkable(ai, hold) &&
      ensureReachable(ai, hold, spawns, ['defend'], `site ${s.id} hold`, false);
    if (holdOk && !sitesReachableFrom(ai, hold, [{ position }])) {
      // A hold you cannot get to the site from is worse than no hold at all.
      console.warn(`[match] site ${s.id} hold: no route on to the site — using the site itself`);
    }
    return {
      id: s.id,
      name: s.name,
      // No per-site override authored: the default lives in rules.js.
      radius: s.radius ?? RULES.plantRadius,
      position,
      hold: holdOk ? hold : position.clone(),
      /** Filled in by the match each round. */
      defenders: [],
    };
  });

  // A SPAWN THAT CANNOT REACH THE OBJECTIVE IS A DEAD MAN. Sites are placed
  // first, then every spawn is proved against them and moved if it fails —
  // navcheck measured two defender spawns sitting in pockets with no route to
  // either site, which is two of seven men standing still all round.
  for (const kind of ['attack', 'defend']) {
    for (let i = 0; i < spawns[kind].length; i++) {
      const sp = spawns[kind][i];
      if (sitesReachableFrom(ai, sp.position, sites)) continue;
      if (!relocateSpawn(ai, sp.position, sites, `${kind} spawn ${i}`)) {
        console.error(`[match] ${kind} spawn ${i}: no nearby ground reaches the sites`);
      }
    }
  }

  return { sites, spawns };
}

/** True when `p` has an A* route to every bomb site. */
function sitesReachableFrom(ai, p, sites) {
  const g = ai?.grid;
  if (!g) return true;
  const path = [];
  for (const s of sites) if (g.findPath(p, s.position, path) <= 0) return false;
  return true;
}

/** Walk outward until the spawn can reach every site. Mutates `p`. */
function relocateSpawn(ai, p, sites, tag) {
  const probe = new THREE.Vector3();
  for (let ring = 1; ring <= 16; ring++) {
    const r = ring * 2.2;
    for (let a = 0; a < 12; a++) {
      const th = (a / 12) * Math.PI * 2 + ring * 0.55;
      probe.set(p.x + Math.cos(th) * r, p.y, p.z + Math.sin(th) * r);
      if (!walkable(ai, probe) || !sitesReachableFrom(ai, probe, sites)) continue;
      console.warn(
        `[match] ${tag}: no route to the sites — moved ${r.toFixed(1)} m to ` +
          `${probe.x.toFixed(1)}, ${probe.z.toFixed(1)}`
      );
      p.copy(probe);
      return true;
    }
  }
  return false;
}

/**
 * WALKABLE IS NOT REACHABLE, and the difference is worth a whole team.
 *
 * `walkable()` only asks whether the nav grid has a standable cell near a
 * point. A sealed courtyard, a first-floor room, the inside of a shop — all of
 * them are full of walkable cells and connected to nothing you can get to. When
 * this was not checked, both `hold` points resolved onto walkable ground that
 * NO defender spawn had a route to, so every round `match` sent seven men to an
 * objective A* could not path to and `Agent._advance` did as it was told and
 * stood still. From outside that reads as "the AI went brain-dead".
 *
 * `tools/navcheck.mjs` asserts this same invariant from the outside and is what
 * caught it. This is the in-engine half: prove it at boot, and if the authored
 * point fails, walk outward in rings until one passes, so a layout change can
 * degrade the design intent but can never break the mode.
 *
 * @param {string[]} teams which spawn clusters must be able to get here
 * @returns {boolean} true if `p` ended up reachable (mutated in place if moved)
 */
function ensureReachable(ai, p, spawns, teams, tag, all = true) {
  const g = ai?.grid;
  if (!g) return true;
  const path = [];
  /**
   * `all` picks the strictness. Sites are anchored with `all = false` — one
   * spawn per team is enough to prove the area is part of the playable map —
   * and the individual spawns are then proved against the sites afterwards and
   * moved if they fail. Doing it the other way round makes the two constraints
   * chase each other.
   */
  const connected = (q) => {
    for (const kind of teams) {
      let any = false;
      for (const sp of spawns[kind]) {
        const ok = g.findPath(sp.position, q, path) > 0;
        if (!ok && all) return false;
        if (ok) any = true;
      }
      if (!any) return false;
    }
    return true;
  };
  if (connected(p)) return true;

  const probe = new THREE.Vector3();
  for (let ring = 1; ring <= 16; ring++) {
    const r = ring * 2.2;
    for (let a = 0; a < 12; a++) {
      const th = (a / 12) * Math.PI * 2 + ring * 0.4;
      probe.set(p.x + Math.cos(th) * r, p.y, p.z + Math.sin(th) * r);
      if (!walkable(ai, probe) || !connected(probe)) continue;
      console.warn(
        `[match] ${tag}: authored point is walkable but NOT reachable from every ` +
          `${teams.join('/')} spawn — moved ${r.toFixed(1)} m to ` +
          `${probe.x.toFixed(1)}, ${probe.z.toFixed(1)}`
      );
      p.copy(probe);
      return true;
    }
  }
  console.error(
    `[match] ${tag}: nothing within 35 m is reachable from every ${teams.join('/')} ` +
      'spawn. The level has sealed this area off; bots sent here will have nowhere to walk.'
  );
  return false;
}

/**
 * Level (x, z) -> a world point sitting on the floor.
 *
 * THE PROBE HEIGHT MATTERS. It used to drop a ray from y = 30, which is above
 * everything — so any point that happened to lie inside a building footprint
 * resolved onto its ROOF. A roof is walkable and completely disconnected from
 * the street, which is how both bomb-site hold points ended up unreachable from
 * every spawn while looking perfectly valid. Dropping from 4 m finds the ground
 * floor or the street and cannot see over a wall.
 */
function groundPoint(world, ai, lx, lz) {
  const p = world
    ? world.levelToWorld(lx, 0, lz, new THREE.Vector3())
    : new THREE.Vector3(lx, 0, lz);
  const y = ai?.groundAt?.(p.x, p.z, 4);
  p.y = Number.isFinite(y) ? y : 0;
  return p;
}

/**
 * True when the nav grid has a walkable cell within 2 m and within a metre of
 * this height — i.e. a bot handed this point can path to it. Mutates `p` onto
 * that cell so the authored point and the point bots walk to are the same one.
 */
function walkable(ai, p) {
  const g = ai?.grid;
  if (!g) return true; // no navigation yet: trust the author
  const ci = g.nearest(p.x, p.z, p.y, 3, 1.2);
  if (ci < 0) return false;
  p.set(g.worldX(ci % g.nx), g.floor[ci], g.worldZ((ci / g.nx) | 0));
  return true;
}
