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
    name: 'WEST COURTYARD',
    /**
     * MOVED OUT OF THE DEAD-END ALLEY. Site A used to sit at level (-12, -10.2)
     * in the west mid alley, and `tools/navcheck.mjs` measured what that cost:
     * the attack's shortest real A* route was 49.6 m against the defence's
     * 23.3 m. Twenty-six metres of head start on a 120 second round is not a
     * defender advantage, it is an unplayable site — the defence is set before
     * the attack can see the entrance, every time.
     *
     * The courtyard between W2 and BW1 is open on three sides (the street to
     * the east, the lane north, the wall line west), which is what a bomb site
     * needs: more than one way in, so a retake and an execute are both possible.
     */
    level: [-15.0, 7.6],
    fallback: [-8.0, 7.6],
    /** Where defenders set up: on the mouth their own rotation arrives through. */
    /** Open courtyard ground, NOT inside W2 — see groundPoint's roof note. */
    holdLevel: [-11.0, 6.2],
  },
  {
    id: 'B',
    name: 'EAST ALLEY',
    level: [13.0, 4.8],
    fallback: [7.0, 4.8],
    /** Open alley ground, NOT inside E2 — see groundPoint's roof note. */
    holdLevel: [9.5, 4.8],
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
    [-3.6, -20.0, 0],
    [0.0, -22.5, 0],
    [3.6, -20.0, 0],
    [-2.2, -17.0, 0],
    [2.2, -17.0, 0],
    [-4.6, -24.0, 0],
    [4.6, -24.0, 0],
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
