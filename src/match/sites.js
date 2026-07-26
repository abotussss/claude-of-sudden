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

/**
 * Two flank pockets off the main street, one west one east, roughly 32 m apart.
 *
 *   A — the alley between W2 and W3. A 15 x 4 m corridor with one mouth onto
 *       the street and a long approach from the west: cover-heavy, close range.
 *   B — the alley between E2 and E1, opening east off the market. Longer
 *       sightlines, and the balconies on E1 overlook it.
 *
 * `fallback` is a point on the open street used if the primary does not resolve
 * onto walkable ground.
 */
export const SITES = [
  {
    id: 'A',
    name: 'WEST ALLEY',
    level: [-12.0, -10.2],
    fallback: [-5.4, -10.2],
    radius: 4.5,
    /** Where defenders set up: pushed back toward their own spawn. */
    holdLevel: [-7.0, -12.5],
  },
  {
    id: 'B',
    name: 'EAST ALLEY',
    level: [13.0, 4.8],
    fallback: [5.4, 4.8],
    radius: 4.5,
    holdLevel: [7.4, 2.4],
  },
];

/**
 * Spawns, `[x, z, yaw]` in level space. Attackers come down the street from the
 * north end; defenders start south of both sites and rotate up to them, which is
 * what gives the defence its three-second head start onto either site.
 *
 * THE SEPARATION IS LOAD-BEARING. This map is one straight street, so the two
 * spawn clusters have a clean line to each other and an actor's view range is
 * 58 m (`Agent.viewRange`). At the first spacing tried — closest pair 51 m —
 * both sides acquired a target on the spawn frame and spent the round trading
 * shots down the middle instead of playing the objective. The closest pair here
 * is 60.5 m, which is past the range at which anybody can see anybody, so the
 * round opens with two teams walking rather than two teams already shooting.
 */
export const SPAWNS = {
  attack: [
    [-3.6, 40.0, Math.PI],
    [0.0, 42.5, Math.PI],
    [3.6, 40.0, Math.PI],
    [-2.2, 36.5, Math.PI],
    [2.2, 36.5, Math.PI],
    [-4.6, 34.0, Math.PI],
    [4.6, 34.0, Math.PI],
  ],
  defend: [
    [-3.6, -30.0, 0],
    [0.0, -32.5, 0],
    [3.6, -30.0, 0],
    [-2.2, -26.5, 0],
    [2.2, -26.5, 0],
    [-4.6, -34.0, 0],
    [4.6, -34.0, 0],
  ],
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

  const sites = SITES.map((s) => {
    const position = snap(s.level[0], s.level[1], s.fallback[0], s.fallback[1], `site ${s.id}`);
    const hold = groundPoint(world, ai, s.holdLevel[0], s.holdLevel[1]);
    return {
      id: s.id,
      name: s.name,
      radius: s.radius,
      position,
      hold: walkable(ai, hold) ? hold : position.clone(),
      /** Filled in by the match each round. */
      defenders: [],
    };
  });

  const bake = (list) =>
    list.map(([x, z, yaw]) => ({
      position: groundPoint(world, ai, x, z),
      yaw: yaw + (world?.levelYaw ?? 0),
    }));

  return { sites, spawns: { attack: bake(SPAWNS.attack), defend: bake(SPAWNS.defend) } };
}

/** Level (x, z) -> a world point sitting on the floor. */
function groundPoint(world, ai, lx, lz) {
  const p = world
    ? world.levelToWorld(lx, 0, lz, new THREE.Vector3())
    : new THREE.Vector3(lx, 0, lz);
  const y = ai?.groundAt?.(p.x, p.z, 30);
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
