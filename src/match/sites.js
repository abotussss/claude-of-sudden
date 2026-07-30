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
import { RULES, MODE } from './rules.js';

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

/**
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THE PLANT ZONE IS NOT IN THE FIRST-FLOOR COMMAND ROOM
 * ────────────────────────────────────────────────────────────────────────────
 * The brief was "C4設置できる場所は守る側に有利になるように配置して。屋内の２回の
 * 司令室とか" — put the site where the DEFENCE has the advantage, for instance a
 * command room upstairs in a building. Half of that is done below. The upstairs
 * half cannot be done and here is the measurement rather than the opinion:
 *
 *   `src/ai/nav.js` is a 2.5D HEIGHT FIELD — ONE floor per (x, z) cell, sampled
 *   by dropping a ray from above the level. Inside a building that ray lands on
 *   the ROOF, so a building's interior is not merely hard to path through, it
 *   is not in the grid at all. Probed at boot on this map: `grid.nearest()` at
 *   the centre of W2's ground floor and at the centre of E2's returns NO CELL
 *   within three rings. A* therefore cannot route a single bot into either
 *   building, let alone up a flight of stairs.
 *
 * A charge planted in a first-floor room would be a charge NO BOT COULD EVER
 * DEFUSE, which directly contradicts the other half of the same brief — "C4設置
 * したらちゃんと敵は解除をしに来るように". A site that cannot be defused is not a
 * defender-favouring site, it is an attacker-winning one.
 *
 * So the split is: the PLANT ZONE stays on ground both sides can walk, and the
 * ELEVATION is where the defence's advantage lives. Both sites sit in the half
 * of their courtyard that the storeys above look down into — `RELIEF.decks` in
 * src/world/layout.js runs a 2.9 m catwalk along each courtyard's outer wall
 * and E2/W2's balconies overhang the north end — and every one of those
 * positions is reachable by a PLAYER (`tools/floorcheck.mjs` is the gate on
 * that) and by nobody else. The human defending gets the command post. The bots
 * hold the ground, which is all they have ever been able to do.
 */
export const SITES = [
  {
    id: 'A',
    name: 'WEST COURTYARD',
    /**
     * MOVED SOUTH, from z -4 to z -7, which is 4.5 m of world ground and the
     * whole of what "favour the defence" means here.
     *
     * Measured with A* over the real nav grid, shortest route from any spawn of
     * the cluster to the site centre:
     *
     *              attack      defence
     *   z -4 (old)   76.9 m      63.7 m     defence 13.2 m ahead
     *   z -7 (new)   81.0 m      58.8 m     defence 22.2 m ahead
     *
     * A 9 m swing, ~2 s at the player's 4.57 m/s stand speed, and it compounds:
     * the attack now has to cross the WHOLE courtyard to plant, with the
     * defence's own mouth behind the charge rather than in front of it, while
     * the deck along the west wall (2.9 m, player only) looks straight down on
     * the plant spot. The circle still fits the courtyard — `RULES.plantRadius`
     * is 8 and the south wall is 10.5 m away — and 92 % of it remains ground a
     * defender can physically stand on to cut the charge (swept cell by cell;
     * the missing 8 % is the strip against the perimeter wall).
     */
    level: L(-28.0, -7.0),
    fallback: L(-26.0, -5.0),
    /**
     * Where defenders set up: on the mouth their own rotation arrives through,
     * which for both sites is the lane from the south, ~9.6 m off the charge —
     * far enough that `Agent._pickHoldSpot`'s 4-11 m ring spreads them across
     * the south half of the courtyard instead of stacking them on the plant
     * spot, close enough to contest a plant the moment it starts. Open
     * courtyard ground, NOT inside a building — see groundPoint's roof note.
     */
    holdLevel: L(-24.0, -12.0),
    /**
     * THE ATTACK'S SECOND WAY IN. @see `MatchSystem._assignObjectives`.
     *
     * A point in connector 2's west arm — the mid street's link into this lane,
     * which arrives at the courtyard's EAST mouth. The main body walks the A
     * lane down from the north; a third of the attack is sent here first and
     * comes in through a different hole in a different wall. Null-safe: if this
     * does not resolve onto reachable ground the flank is simply not ordered.
     */
    flankLevel: L(-13.0, -4.5),
  },
  {
    id: 'B',
    name: 'EAST COURTYARD',
    level: L(28.0, -7.0),
    fallback: L(26.0, -5.0),
    holdLevel: L(24.0, -12.0),
    /**
     * (15, -5) rather than the mirror of A's (-13, -4.5): the east arm of
     * connector 2 is not the west arm's mirror image. Probed cell by cell, the
     * mirrored point resolves onto something 0.84 m off the deck — a crate, and
     * therefore a cell no A* route reaches (0 of 15 attack spawns). Two metres
     * along the connector it is open gravel and all 15 reach it.
     */
    flankLevel: L(15.0, -5.0),
  },
];

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE THREE DOMINATION ZONES, AND WHY THEY ARE NOT THE TWO BOMB SITES
 * ════════════════════════════════════════════════════════════════════════════
 * Two points is not domination, it is a tug of war: 1-1 is stable, whoever takes
 * the second has already won, and there is nothing to rotate. Three is the
 * genre's number because 2-1 is a lead you have to keep working at.
 *
 * So: the two courtyards, plus the mid street. Same geometry the C4 mode fights
 * over, one point further along each lane.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ALL THREE SIT ON LEVEL z 0, AND THAT IS THE WHOLE POINT
 * ────────────────────────────────────────────────────────────────────────────
 * MEASURED, and it decided the first two full headless matches. `SITES` above
 * puts A and B at level z -7, three metres of authored level SOUTH of their
 * courtyards' centres, and the long note in the A entry says exactly why: it is
 * a deliberate 22 m route advantage to the DEFENCE, who spawn in the south
 * pocket. In demolition that is fair, because the sides swap at
 * `RULES.swapAfterRound` and each half is played from both ends of it.
 *
 * DOMINATION NEVER SWAPS. Each side keeps one base for the whole match, so that
 * advantage stops being a round's tension and becomes a permanent property of
 * the map. `tools/navcheck.mjs` on the bomb-site placement:
 *
 *              attack (north)   defend (south)
 *   site A          77.5 m           59.1 m      south arrives first by 18.4 m
 *   site B          79.4 m           59.6 m      south arrives first by 19.8 m
 *
 * Two of three zones handed to the south side before anybody moves. Both matches
 * opened 2-1 to the south inside forty seconds, and 2-1 plus forward spawns is a
 * closed loop: 252-100 and 252-42.
 *
 * The spawn clusters are at level z +39.4 and -39.4 (`SPAWNS` below), so the
 * equidistant line between them is level z 0. Every zone centre is on it. The
 * courtyards are level z -11..3, so z 0 is inside both of them — at the north
 * end, covering the courtyard's north half and the mouth of its lane, which is
 * genuinely contestable ground rather than a corner.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * C, AND THE ONE PLACE IT CAN BE
 * ────────────────────────────────────────────────────────────────────────────
 * The mid lane runs x ±6.5 (kerb) with two single-storey islands standing in it:
 * K1 at level (0, 12) and K2 at level (-0.4, -4.6) — see `src/world/layout.js`.
 * K2's north face is at level z -1.5 and K1's south face at level z 9.3, so the
 * open tarmac between them is level z -1.5..9.3 and level z 0 is 1.5 units
 * (2.25 m of world ground) inside its southern end. That is the only value of z
 * that is both on the equidistant line and not inside a building.
 *
 * HEIGHT FIELD, NOT A ROOF. `src/ai/nav.js` is one floor per (x, z) cell, so
 * anything inside a footprint resolves onto the roof above it and no bot can
 * ever path there. C is deliberately the tarmac BETWEEN the two islands, both of
 * whose roofs a player can reach (there are steps) and no bot ever can. The
 * southern arc of C's circle laps over K2's footprint; `standRing` drops the
 * standing points that land on it and keeps the rest. A capture point bots
 * cannot take is a capture point that does not exist. @see the same argument at
 * the top of the A entry.
 *
 * `holdLevel` is the zone itself for all three: in domination a garrison holds
 * the point it owns, and `Agent._pickHoldSpot`'s 3-13 m ring is what spreads it
 * over the courtyard and its mouths. There is no separate rally point to author
 * and no side whose rotation arrives from a fixed direction.
 *
 * `flankLevel` is null for all three, and the flank leg is gone with it — see
 * the removals list at the top of src/match/index.js. Three live points on a
 * three-lane map is the rotation; a staging alley on the way to one of them was
 * a demolition answer to a demolition problem (fifteen men, one objective).
 */
export const ZONES = [
  {
    id: 'A',
    name: 'WEST COURTYARD',
    level: L(-28.0, 0.0),
    /** Two units south-east, still inside the courtyard, off the north wall. */
    fallback: L(-27.0, -2.5),
    holdLevel: L(-28.0, 0.0),
    flankLevel: null,
  },
  {
    id: 'C',
    name: 'MID STREET',
    level: L(0.0, 0.0),
    /** Further into the gap, away from K2's wall. */
    fallback: L(0.0, 2.5),
    holdLevel: L(0.0, 0.0),
    flankLevel: null,
  },
  {
    id: 'B',
    name: 'EAST COURTYARD',
    level: L(28.0, 0.0),
    fallback: L(27.0, -2.5),
    holdLevel: L(28.0, 0.0),
    flankLevel: null,
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
 * The returned list is still called `sites` and every entry still carries
 * `{ id, name, position, radius, hold, flank }`, in domination as in demolition.
 * That is deliberate: `tools/navcheck.mjs`, `sitecheck`, `lanecheck` and
 * `src/match/airstrike.js`'s route proof all read those field names, and a mode
 * change must not quietly turn the map's own gate off.
 *
 * @param {object} world  the `world` subsystem (for levelToWorld)
 * @param {object} ai     the `ai` subsystem (for the nav grid + ground probe)
 * @returns {{sites: Array, spawns: {attack: Array, defend: Array}}}
 */
export function resolveLayout(world, ai) {
  const domination = RULES.mode === MODE.DOMINATION;
  const authored = domination ? ZONES : SITES;
  const defaultRadius = domination ? RULES.captureRadius : RULES.plantRadius;
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

  const sites = authored.map((s) => {
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
    /**
     * THE FLANK STAGING POINT, and it is allowed to be null.
     *
     * A via-point in the connector that joins the mid street to this lane. It
     * is proved from the ATTACK spawns only — nobody else is ever sent here —
     * and it must also have a route on to the site, or "flank" would mean
     * "walk into a connector and stop". If either fails the point is dropped
     * and `_assignObjectives` simply never orders a flank: a broken flank is a
     * third of the attack standing in an alley, which is worse than no flank.
     */
    let flank = null;
    if (s.flankLevel) {
      const f = groundPoint(world, ai, s.flankLevel[0], s.flankLevel[1]);
      const ok =
        walkable(ai, f) &&
        ensureReachable(ai, f, spawns, ['attack'], `site ${s.id} flank`, false) &&
        sitesReachableFrom(ai, f, [{ position }]);
      if (ok) flank = f;
      else console.warn(`[match] site ${s.id} flank: no usable staging point — flank disabled`);
    }

    const radius = s.radius ?? defaultRadius;
    const zone = {
      id: s.id,
      name: s.name,
      // No per-site override authored: the default lives in rules.js.
      radius,
      position,
      hold: holdOk ? hold : position.clone(),
      flank,
      /** Filled in by the match each round. */
      defenders: [],
      /* ---- domination state, owned by src/match/capture.js ---- */
      /** -1 neutral, else the team id that holds it. */
      owner: -1,
      /** The team currently making progress on it, or -1. */
      capTeam: -1,
      /** 0..1 toward `capTeam` owning it. */
      progress: 0,
      /** Both sides inside the circle ⇒ progress frozen. */
      contested: false,
      /** Live bodies of each team inside the circle, refreshed every tick. */
      counts: [0, 0],
      /** `ctx.time.elapsed` when the current owner took it. */
      ownedSince: 0,
      /**
       * STANDING GROUND INSIDE THE CIRCLE — see `standRing`.
       *
       * Bots are sent to one of these rather than to the centre, so fifteen men
       * taking a point spread over it instead of stacking on one square, and
       * every one of them is provably INSIDE the capture radius. It is also
       * where a forward spawn puts you.
       */
      stand: [],
      /** `[{position, yaw}]` per team, for `_safeSpawn`. Built below. */
      spawnFor: [[], []],
    };
    return zone;
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

  /**
   * The standing ring, and the forward spawns cut from it. Domination only —
   * demolition has no use for either and must not pay the path queries.
   */
  if (domination) {
    for (const z of sites) standRing(ai, z, spawns);
    for (const z of sites) {
      for (const team of [0, 1]) {
        /**
         * Face the way the enemy arrives. A forward spawn that puts you looking
         * at your own wall is a free kill for whoever is already in the zone,
         * and `role` here is "which base cluster is NOT yours".
         */
        const foeBase = centroidOf(team === RULES.playerTeam ? spawns.defend : spawns.attack);
        for (const p of z.stand) {
          z.spawnFor[team].push({
            position: p,
            yaw: Math.atan2(foeBase.x - p.x, -(foeBase.z - p.z)) + Math.PI,
          });
        }
      }
      console.info(
        `[match] zone ${z.id} "${z.name}" at ${z.position.x.toFixed(1)}, ` +
          `${z.position.z.toFixed(1)} · r${z.radius} · ${z.stand.length} standing points`
      );
    }
  }

  return { sites, spawns };
}

/**
 * Up to `STAND_POINTS` walkable, REACHABLE points inside a zone's circle.
 *
 * Why this exists rather than "send everybody to the centre": `Agent._advance`
 * treats a non-anchored objective as a single destination with a 1 m arrival
 * radius, so fifteen men handed the same Vector3 all try to stand on the same
 * square and local avoidance turns the capture into a scrum at the edge of it.
 * A ring at 0.5 r spreads them across the zone and — the part that matters for
 * the mode working at all — every point is inside the capture radius by
 * construction, so a bot that arrives is a bot that is capturing.
 *
 * Each candidate is snapped to a nav cell and then PROVED: it must have an A*
 * route from at least one spawn of each side, the same relaxed rule the zone
 * centres are anchored with. A standing point nobody can walk to would be a man
 * standing still in an alley, which is the exact failure `ensureReachable`'s
 * header is about.
 */
const STAND_POINTS = 8;
function standRing(ai, zone, spawns) {
  const g = ai?.grid;
  // The centre is always a legal answer — it is snapped and proved above.
  const centre = zone.position;
  if (!g) {
    zone.stand.push(centre.clone());
    return;
  }
  const path = [];
  const reach = (q) => {
    for (const kind of ['attack', 'defend']) {
      let any = false;
      for (const sp of spawns[kind]) if (g.findPath(sp.position, q, path) > 0) { any = true; break; }
      if (!any) return false;
    }
    return true;
  };
  const probe = new THREE.Vector3();
  const r = zone.radius * 0.5;
  for (let i = 0; i < STAND_POINTS; i++) {
    const th = (i / STAND_POINTS) * Math.PI * 2 + 0.31;
    probe.set(centre.x + Math.cos(th) * r, centre.y, centre.z + Math.sin(th) * r);
    if (!walkable(ai, probe)) continue;
    // `walkable` snapped it; two bearings can land on the same cell.
    let dup = false;
    for (const p of zone.stand) if (p.distanceToSquared(probe) < 1.2 * 1.2) dup = true;
    if (dup) continue;
    // And it must still be inside the circle after the snap.
    const dx = probe.x - centre.x;
    const dz = probe.z - centre.z;
    if (dx * dx + dz * dz > zone.radius * zone.radius) continue;
    if (!reach(probe)) continue;
    zone.stand.push(probe.clone());
  }
  if (!zone.stand.length) {
    console.warn(`[match] zone ${zone.id}: no standing ring resolved — using the centre alone`);
    zone.stand.push(centre.clone());
  }
}

/** Mean position of a spawn cluster. Boot-time only; allocates once. */
function centroidOf(list) {
  const out = new THREE.Vector3();
  for (const s of list) out.add(s.position);
  if (list.length) out.multiplyScalar(1 / list.length);
  return out;
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
