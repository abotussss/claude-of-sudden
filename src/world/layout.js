/**
 * WORLD — the map.
 *
 * A THREE-LANE DEMOLITION LAYOUT, which is the shape the mode needs and the
 * shape this map did not have.
 *
 * WHAT WAS HERE BEFORE, and why it was wrong. One long market street running
 * -Z from z 46 to z -58, buildings tight to both kerbs, a few four-metre alley
 * stubs off it, and both bomb sites hung off the SAME forty metres of that one
 * street a couple of metres either side of it. Measured with
 * `tools/lanecheck.mjs`: 59.3 % of the attack's A* route to site A lay within
 * 6 m of its route to site B. There was one corridor with two labels on it, so
 * there was nothing to fake, nothing to rotate between, and no reason to ever
 * take a different route.
 *
 *      x -31        x -20.5   -6.5    +6.5   +20.5        +31
 *        |   A LANE   |  west  | MID  | east  |   B LANE   |
 *        |            |  row   |street|  row  |            |
 *   z 46 +------------+--------+  ^   +-------+------------+
 *        |            |  W5    |  |   |  E5   |            |   attack spawn
 *   z 32 +   ~~~~~~~~ NORTH CROSS ~~~~~~~~~~~~~~~~~~~~~~   +   z 34..44, mid
 *   z 24 +            |  W1    |  |   |  E1   |            |
 *   z 15 +   ~~~~ CONNECTOR 1 ~~~+ K1 +~~~~~~~~~~~~~~~~~   +
 *   z  9 +            |  W2 ▣  |  |   |  E2 ▣ |            |   ▣ = enterable,
 *   z  3 +   [ SITE A courtyard ]  |   [ SITE B courtyard ]      through-route
 *   z -1 +            |  (x -36) |  |   | (x +36) |          |
 *   z -8 +   ~~~~ CONNECTOR 2 ~~~+ K2 +~~~~~~~~~~~~~~~~~   +
 *   z-11 +            |        |  |   |       |            |
 *   z-26 +            |  W3 ▣  |  |   |  E3 ▣ |            |
 *   z-34 +   ~~~~~~~~ SOUTH CROSS ~~~~~~~~~~~~~~~~~~~~~~   +
 *   z-46 +------------+--W4----+  v   +--E4---+------------+   defend spawn
 *                                                              z -46..-34, mid
 *
 * THE THREE LANES ARE GENUINELY SEPARATE. The west and east building rows are
 * continuous walls of building from z 44 to z -34 except at the four marked
 * cross links, so from the mid street you cannot see into either lane and from
 * one lane you cannot see the other. The two CONNECTORS are what a defender
 * rotates through and what lets the attack fake one site and hit the other;
 * `K1` and `K2` sit in the middle of the street inside each connector so the
 * connector is a dog-leg rather than a fifty-metre firing line straight from
 * site A into site B.
 *
 * EACH SITE IS A COURTYARD, not a dot. `RULES.plantRadius` is 8, so a site is a
 * 16 m circle: each one bulges its lane out to x ±36 over z -11..3 and has
 * three mouths — the lane from the north (the attack's), the lane from the
 * south (the defence's), and the connector from the mid street (either side's).
 *
 * BOTS ONLY EVER USE GROUND LEVEL. `src/ai/nav.js` is a 2.5D height field with
 * one floor per (x, z) cell, so A* cannot climb a stair or use an upper floor
 * anywhere in this level. Every route either team's bots need — spawn to both
 * sites, site to site — is an outdoor ground-level route. The interiors and the
 * roofs are a PLAYER flank on top of that, never the only way in.
 *
 * Sides: 0 = -Z, 1 = +X, 2 = +Z, 3 = -X.
 */

/**
 * The MID lane: the original market street, kept as the middle route.
 *
 * `zMin`/`zMax` were -58/46, i.e. the street ended a few metres behind each
 * spawn. Both ends are extended by 22-24 units of authored plan so the map has
 * somewhere to put a BASE DISTRICT at each end — see `THE MAP GROWS` at the
 * bottom of this file. `halfWidth`/`kerb` are the authored NARROW values and
 * are widened by `widenX()` in the same pass; do not read them before it.
 *
 * THE HARD CEILING ON zMin/zMax IS NOT TASTE. `tools/boundcheck.mjs` builds its
 * flood grid at `EXT = 168 * SCALE * 0.5 + 2` = 128 m half-extent in scaled
 * level space, hard-coded, and `tools/` is not ours to edit. `buildCordon`
 * closes the street at `zMin - 3.7` / `zMax + 3.7`, so the furthest authored
 * ground is 83.7 units = 125.6 m and the gate can still see all of it. Anything
 * past ~85 units would be walkable ground boundcheck silently never scans.
 */
export const STREET = {
  halfWidth: 4.5, // asphalt
  kerb: 6.5, // building line
  walkH: 0.145,
  zMin: -80,
  zMax: 70,
};

/**
 * The three lanes and the links between them, as level-space rects
 * [x0, z0, x1, z1]. Everything here becomes ground surface, collision and — via
 * `isOpen()` in dressing.js — somewhere props are allowed to stand.
 *
 * `density` scales the debris scatter. The lanes are an order of magnitude
 * bigger than the old four-metre alley stubs and the scatter is per square
 * metre, so without this a single lane would draw six hundred instanced props.
 */
export const ALLEYS = [
  // ------------------------------------------------------------- A lane (west)
  { rect: [-31, 3, -20.5, 32], surface: 'dirt', density: 0.5 }, // north run
  { rect: [-36, -11, -20.5, 3], surface: 'gravel', density: 0.5 }, // SITE A courtyard
  /**
   * The WEST BAY — the courtyard's outer pocket through where BW2's slab used
   * to stand, walled by BW1 (z 1), BW3 (z -8) and BW2's new back wall (widened
   * x -56). ZONE C stands in it. Its east twin is the EAST BAY below. @see the
   * long note over BW2 in `BUILDINGS`.
   */
  { rect: [-47, -8, -36, 1], surface: 'gravel', density: 0.5 }, // WEST BAY — ZONE C
  { rect: [-31, -26, -20.5, -11], surface: 'dirt', density: 0.3 }, // south run
  // ------------------------------------------------------------- B lane (east)
  { rect: [20.5, 3, 31, 32], surface: 'dirt', density: 0.5 }, // north run
  { rect: [20.5, -11, 36, 3], surface: 'gravel', density: 0.5 }, // SITE B courtyard
  { rect: [36, -8, 47, 1], surface: 'gravel', density: 0.5 }, // EAST BAY — ZONE E
  { rect: [20.5, -26, 31, -11], surface: 'dirt', density: 0.3 }, // south run
  // ------------------------------------------------------- north cross street
  { rect: [-31, 24, -6.5, 32], surface: 'dirt', density: 0.35 },
  { rect: [6.5, 24, 31, 32], surface: 'dirt', density: 0.35 },
  // ------------------------------------------------------------- connector 1
  { rect: [-20.5, 9, -6.5, 15], surface: 'gravel', density: 0.7 },
  { rect: [6.5, 9, 20.5, 15], surface: 'gravel', density: 0.7 },
  // ------------------------------------------------------------- connector 2
  { rect: [-20.5, -8, -6.5, -1], surface: 'gravel', density: 0.7 },
  { rect: [6.5, -8, 20.5, -1], surface: 'gravel', density: 0.7 },
  // ------------------------------------------------------- south cross street
  { rect: [-31, -34, -6.5, -26], surface: 'dirt', density: 0.35 },
  { rect: [6.5, -34, 31, -26], surface: 'dirt', density: 0.35 },
];

/**
 * Ground that must be FLAT. The terrain outside the old street was a dune field
 * with ±0.55 m of fbm in it, which is fine under a background block and wrong
 * under a lane you fight down. `buildGround` flattens the union of these with a
 * soft shoulder so the dunes still carry the far ground.
 */
export const FLAT = [
  [-33, -80, 33, 70], // the whole three-lane box, both base districts included
  // Both site courtyards AND the two new outer bays: the bays run to widened
  // x ∓56 (authored ∓47) and a capture point on ±0.55 m of fbm is a capture
  // point where your crosshair sits on a hill.
  [-47, -13, 47, 5],
];

/**
 * RELIEF — the map's height variation, and the reason it is shaped like this.
 *
 * The play box is flat because `FLAT` above flattens it, and that was right: a
 * dune under a lane you fight down is a lane where your crosshair sits on a
 * hill. But flat ground everywhere means every duel on the map is fought
 * between two people at exactly the same height, which is what "もっと高低差など
 * をつけて" is about. So the height is put back ON TOP of the flat ground, as
 * authored structure, where it can be shaped instead of noised.
 *
 * `src/ai/nav.js` is a 2.5D height field with ONE floor per cell, so this
 * splits in two and the split is not cosmetic:
 *
 *   TERRACES are ground. Ramped at both ends at 1.15 m over 4 m — 0.23 m of
 *   rise per 0.8 m nav cell against a 0.45 m `maxStep` — so BOTS USE THEM. Each
 *   one takes the outer 5 m of a 10.5 m lane, leaving the inner half flat, so a
 *   lane now has a high side and a low side and the fight down it has a choice
 *   in it that it did not have before.
 *
 *   DECKS and BLOCKS are PLAYER ONLY, because anything stacked overwrites the
 *   nav cell under it. The decks run over the 2 m strip against each site
 *   courtyard's perimeter wall — deliberately the one strip no bot route wants
 *   — and look down onto the plant spot from 2.9 m. The blocks are the mantle
 *   chain that gets you up: 1.5 m from the ground (under the 1.85 m mantle
 *   ceiling), then 1.4 m from there to the deck. The pair beside K1 is the same
 *   idea in three steps onto the mid island's roof, which overlooks connector 1
 *   both ways.
 *
 * `src/world/relief.js` builds all of it and `reliefY()` is the analytic height
 * the set dressing follows, so props on a terrace stand on it rather than in
 * it. Re-run `navcheck` after touching any number here.
 */
export const RELIEF = {
  /** Raised ground, ramped at both ends. Bot-usable. */
  terraces: [
    {
      id: 'A-lane terrace',
      rect: [-31, 9, -26, 17],
      h: 1.15,
      ramps: [
        { side: 0, len: 4 },
        { side: 2, len: 4 },
      ],
    },
    {
      id: 'B-lane terrace',
      rect: [26, 7, 31, 15],
      h: 1.15,
      ramps: [
        { side: 0, len: 4 },
        { side: 2, len: 4 },
      ],
    },
  ],
  /**
   * Catwalks over the outer strip of each site courtyard. Player only.
   *
   * THE FIRST TWO WERE AUTHORED FOR A PLANT ZONE THAT HAS SINCE MOVED, and only
   * one of them moved with it. `sitecheck` sampled six points along each and
   * asked what fraction of the plant zone each point can see:
   *
   *              deck z span   plant zone z   best point   sees
   *   A-deck      -9.5 .. -2.2      -7          -2.8       52.8 %
   *   B-deck      -6.0 ..  0.6      -7          -2.1       55.2 %
   *
   * B-deck's whole 6.6 m ran NORTH of the charge — its centre was 4.3 m off in Z
   * while A's was 1.15 m off — because the plant zone went from z -4 to z -7 and
   * only A's numbers were ever revisited. Pulled south to -8.6, which is as far
   * as it can go: BE3's north face is at z -8 and x 31..51, so anything past that
   * is inside a building, and A-deck already runs 1.5 m into BW3 for the same
   * reason. Its centre is now 1.7 m off instead of 4.3.
   *
   * THE TWO SOUTH CATWALKS ARE NEW, AND THEY ARE THE POINT OF THIS PASS.
   *
   * `sitecheck` found 246 and 227 player-reachable perches over each site with a
   * view of the plant zone, best 92 % and 95 % — so the map had no shortage of
   * elevation. What it had no elevation of was the DEFENCE'S: the two best
   * perches at each site are W2/E2's roof at +7.3 m and BW1/BE1's at +10.4 m, and
   * W2 and E2 are the ATTACK'S interior route to the site. Elevation both sides
   * reach, the attack reaching it first, is not a defender's advantage; it is a
   * second attacker's lane with a better angle.
   *
   * So each site gets a catwalk on the 2 m strip against the courtyard's INNER
   * wall at its SOUTH end — W3's west face, E3's east face — running from the
   * defence's own lane up to the connector mouth, 3 m up, looking north-west
   * across the whole plant zone. The defence walks past its mantle block on the
   * way in from a spawn 19 m closer than the attack's; the attack cannot get on
   * it without first crossing the site. Same strip-against-a-wall rule as the
   * first two decks — the cells a deck costs the grid have to be cells A* was
   * never going to use — and kept 2.4 m clear of `holdLevel` so the defence's
   * rally point is not standing under 3 m of steel.
   */
  decks: [
    /**
     * A-DECK AND B-DECK MOVED OUT WITH THE WALL THEY RUN ALONG. The courtyards
     * grew an outer bay each through BW2/BE2 (@see the note over BW2 in
     * `BUILDINGS`) and the perimeter wall these two decks were authored against
     * went from widened ∓45 to ∓56 — leaving them floating over the middle of
     * the new bay, on the exact ground ZONE C / ZONE E now stand on. So they
     * follow the wall: still the 2 m strip against the courtyard's outer face,
     * still "the one strip no bot route wants", and now they look down on the
     * new capture points instead of on the mouth into them.
     */
    { id: 'A-deck', rect: [-47, -9.5, -45, -2.2], y: 2.9, railSide: 1 },
    { id: 'B-deck', rect: [45, -8.6, 47, 0.6], y: 2.9, railSide: 3 },
    { id: 'A-south deck', rect: [-22.5, -15.6, -20.5, -12.8], y: 3.0, railSide: 3 },
    { id: 'B-south deck', rect: [20.5, -15.6, 22.5, -12.8], y: 3.0, railSide: 1 },
  ],
  /** Containers and crates to mantle off. `base` stacks one on another. */
  blocks: [
    /**
     * The two deck steps moved with their decks (@see `decks` above) — and to
     * the decks' SOUTH ends rather than their middles, because the middle of
     * each deck now overlooks a capture point: a 1.5 m container at the old
     * offset would stand inside the zone's circle, on the standing ring the
     * forward spawns are cut from. At z -8..-6.4 they are outside both circles,
     * against the bay's south wall, and still adjacent-in-x to their deck.
     */
    { id: 'A-deck step', rect: [-45, -8.0, -43, -6.4], h: 1.5, key: 'metal_green' },
    { id: 'B-deck step', rect: [43, -8.0, 45, -6.4], h: 1.5, key: 'metal_blue' },
    /**
     * The mantle chain onto the two south catwalks, and the reason they are the
     * DEFENCE'S. Both sit in the defence's own lane at the catwalk's south end,
     * adjacent in X exactly the way the two deck steps above are — ground to
     * 1.6 m is a mantle, 1.6 m to the 3.0 m deck is 1.4 m and also a mantle, and
     * `MOVE.mantle.maxHeight` is 1.85. Kept 1.8 m authored clear of `holdLevel`
     * (∓24, -12), because a container dressed onto the defence's rally point puts
     * the whole defence on an island — see the note over KEEPOUT.
     */
    { id: 'A-south step', rect: [-24.4, -15.4, -22.6, -13.8], h: 1.6, key: 'metal_blue' },
    { id: 'B-south step', rect: [22.6, -15.4, 24.4, -13.8], h: 1.6, key: 'metal_green' },
    /**
     * THE FOUR MANTLE STEPS ONTO K1 AND K2 ARE GONE WITH K1 AND K2.
     *
     * Both mid-street islands stood inside the footprint the CATHEDRAL now
     * occupies (K1 at level z 9.3..14.7, K2 at -7.7..-1.5, both on the street
     * centreline), so the containers that were the only way onto their roofs
     * are a mantle ladder to nothing. The elevation they carried is replaced
     * many times over by the cathedral's own aisle galleries — see
     * `src/world/cathedral.js` — which is the point of putting a building
     * there rather than two sheds.
     */
  ],
};

/**
 * ────────────────────────────────────────────────────────────────────────────
 * SITEWORKS — the mass that makes a bomb site a place you can fight over.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * "爆破サイトが剥き出しで、攻撃側有利すぎる" — the sites are BARE and the attack has
 * far too much advantage. `tools/sitecheck.mjs` was written to answer that and
 * it agreed, in numbers nothing else in the repo was measuring:
 *
 *              cover 0.9-2.8 m inside the plant zone   attacker mouth widths
 *   site A            10.0 m² of 201  (5.0 %)          15.2 / 12.8 m
 *   site B            11.0 m² of 201  (5.5 %)          15.6 / 12.8 m
 *
 * and its `--map` plan view showed why: both courtyards are a rectangle of dots.
 * The lorry, the sandbags, the container and the stalls are all pushed out to
 * the walls, because `KEEPOUT` reserved a 5.1 m circle in the middle of each and
 * nothing was ever authored in the ring outside it. The middle of a bomb site —
 * the part both teams have to stand in — was 200 m² of flat gravel.
 *
 * Two consequences, and only the second one was ever measured:
 *
 *   A PLANT CANNOT BE MADE AND A DEFUSE CANNOT BE CONTESTED. There is nothing
 *   to break line of sight behind, so planting is standing still for four
 *   seconds in the open with fifteen men able to see you.
 *
 *   ARRIVING FIRST IS WORTHLESS. `navcheck` says the defence gets there 19 m
 *   ahead. On an empty pan that buys them nothing: five men standing in the open
 *   are traded out by fifteen whatever order they arrived in. That is the whole
 *   gap between "defence arrives first by 18.5 m" and "攻撃側有利すぎる".
 *
 * So this is the mass that goes in. Three kinds, and the split is a NAVIGATION
 * split, not a stylistic one — `src/ai/nav.js` is a 2.5D height field and the
 * plant zone has to stay ground BOTH sides walk, or a planted charge is one no
 * bot can ever defuse:
 *
 *   `wall`    0.9-1.6 m of broken coursed masonry. Chest high to a standing man,
 *             full cover to a crouching one, and you shoot OVER it. This is the
 *             cover the plant is made behind. Laid in RUNS WITH GAPS: a
 *             continuous wall across a courtyard is a wall A* cannot cross, so
 *             every run leaves openings of 1.3 m or more (2 m once scaled).
 *   `pier`    2.4-3.4 m of solid single-storey mass, coped. Full cover, and at a
 *             mouth it is the CHOKEPOINT: a 15 m entry with a pier flush to one
 *             kerb and a baffle off the other is two 2.4-5 m slots instead of an
 *             open field. Costly to cross, still crossable — which is the line
 *             `navcheck` draws and the reason the cross streets got wrecks
 *             instead of blocks (see the note under BUILDINGS).
 *   `plinth`  1.0-1.3 m concrete pads either side of the charge. Waist-high mass
 *             2-3 m off the plant spot, so the man planting is behind something
 *             and the men retaking it have something to come up behind.
 *
 * WHY NOT MORE SET PIECES INSTEAD. `SET_PIECES` tops out at 0.92 m (a jersey
 * barrier) and a five-course sandbag run measures 0.75 m. `CoverMap.build` in
 * src/ai/nav.js probes for a blocker at 1.32 m to call a spot STANDING cover, so
 * everything the dressing pass can place is crouch cover by construction. A site
 * held only from crouch cover is a site you cannot hold: you have to break cover
 * to shoot. Hence purpose-built geometry, built by `src/world/sitework.js`.
 *
 * AUTHORED AS `{x, z, w, d, h}` in UNSCALED level space, exactly like BUILDINGS:
 * the centre and the footprint go through the 1.5x transform at the bottom of
 * this file, `h` does not (a storey is 3.45 m because a man is 1.78 m). A run
 * authored 0.55 m thick therefore stands 0.83 m thick, and the gap figures in
 * the comments are the AUTHORED ones — multiply by 1.5 for metres on the ground.
 *
 * Re-run `navcheck`, `lanecheck` and `sitecheck` after touching any number here.
 * Every one of these is on ground A* has to cross.
 */
/**
 * ════════════════════════════════════════════════════════════════════════════
 * THESE WERE AUTHORED AROUND THE BOMB SITES, AND THE BOMB SITES ARE NOT THE
 * ZONES. RE-CENTRED ONTO `ZONES`.
 * ════════════════════════════════════════════════════════════════════════════
 * Everything below was laid out for `SITES[].level` — the demolition plant
 * circles at level (∓28, -7). The mode is DOMINATION now and
 * `src/match/sites.js` publishes `ZONES` on the equidistant line at level
 * (∓28, 0) and (0, 0), for the reason its own long note gives: domination never
 * swaps sides, so a 22 m route advantage stops being a round's tension and
 * becomes a permanent property of the map.
 *
 * Seven authored units of z — 10.5 m of real ground — is not a tweak. `sitecheck`
 * measured the consequence directly: the spine wall, the charge screen and both
 * plinths all sat SOUTH of the circle they were built to protect, so the mass
 * inside zone A's circle was 10.0 m² against a floor of 12, and the two pieces
 * that are supposed to stand between the attack and the point (the spine) were
 * 10 m behind it. The player's complaint was "爆破サイトが剥き出しで、攻撃側有利
 * すぎる" and the conversion put it straight back.
 *
 * SO THE RULE FOR THE BAND. Every piece meant to be cover ON the point is
 * authored between 3.2 and 5.0 units of the zone centre, and that is not a taste:
 *
 *   `RULES.captureRadius` is 8 m of ground = 5.33 authored units. Mass outside
 *   that is in the ring, not on the point, and `sitecheck`'s `coverIn` will not
 *   count it.
 *   `standRing` in src/match/sites.js cuts the zone's eight STANDING POINTS —
 *   which are also its FORWARD SPAWNS — at 0.5 r, i.e. 4 m of ground = 2.67
 *   authored units. Mass inside that radius eats the points fifteen men are
 *   spread over and the squares they respawn on.
 *
 * 3.2 clears the standing ring with a capsule's margin; 5.0 stays inside the
 * circle end to end. The mouth pieces (gatehouse, baffle, blockhouse) are NOT in
 * the band — they guard a courtyard entry, which has not moved.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND THE HEIGHT BAND IS A SEPARATE RULE
 * ────────────────────────────────────────────────────────────────────────────
 * `sitecheck` counts mass 0.9-2.8 m over the zone floor and nothing else: under
 * 0.9 m is litter, over 2.8 m is a building and not something you fight the
 * point from. So every `wall` and `plinth` here is 1.2-1.65 m and every `pier`
 * is over 2.8 — a pier is a CHOKEPOINT, deliberately not counted as cover.
 *
 * A wall in this band also cannot block a man's line to another man's eyes
 * (both at 1.62 m), only his line to the FLOOR of the point. That is what makes
 * the mass asymmetric in the defence's favour without closing a mouth: the
 * `seenGround` figures on every mouth stay where they were, and the fraction of
 * the point the far side can read drops.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const SITEWORKS = [
  // ═══════════════════════════════════════════════════════ ZONE A (west) ═══
  /**
   * THE NORTH MOUTH — the attack's own lane, and the widest thing on the map
   * that was not a street. Measured 15.2 m of walkable entry. The gatehouse goes
   * flush to the west kerb (x -31, which is also BW1's east face, so it reads as
   * part of the block rather than a lump in a field) and the baffle stands off
   * the east wall with a slot behind it.
   *
   * NEITHER MOVES. They are the courtyard's entry, and an entry does not care
   * where inside the courtyard the objective is. What HAS changed is that they
   * are now 3.4 and 6.2 units off the zone instead of 10 — the chokepoint is at
   * the point, which is what a gatehouse is for.
   */
  { id: 'A north gatehouse', kind: 'pier', x: -29.2, z: 3.2, w: 3.6, d: 3.2, h: 3.2, key: 'plaster_sand' },
  { id: 'A north baffle', kind: 'wall', x: -23.5, z: 4.2, w: 2.4, d: 2.8, h: 1.6, key: 'brick' },
  /**
   * THE CONNECTOR — the rotation from the mid street, which in domination is the
   * A↔C leg and the busiest 14 m on the map. The blockhouse sits INSIDE
   * connector 2's west arm (z -8..-1), and it is pulled from z -6.8 to the arm's
   * CENTRE at -4.5: at -6.8 it was flush to W3's north face and a man rotating
   * simply walked the north half of the arm past it in a straight line. Centred,
   * the arm is two 2.3-unit slots and the rotation is a dog-leg both ways.
   * `flankLevel` is null in domination so nothing stages here any more.
   */
  { id: 'A connector blockhouse', kind: 'pier', x: -18.6, z: -4.5, w: 2.8, d: 2.4, h: 2.6, key: 'concrete' },
  /**
   * THE SPINE — the single most important piece here, and the one that was most
   * wrong. A broken wall between the ATTACK'S LANE and the point, in two runs:
   *
   *   [west wall -36..-32.3]  gap 3.7  [W -32.3..-28.9]  gap 3.6  [E -25.3..-22.7]  gap 2.2
   *
   * It was at z -4.0, which was 3 units north of a plant circle at z -7 and is
   * 4 units SOUTH of a capture circle at z 0 — i.e. it was standing between the
   * defence and the point it defends. At z 1.9 it is back on the attack's line:
   * the whole `attackEyes` fan `sitecheck` samples for this site is at level
   * z 4.2 and beyond, so the wall is between every one of them and the floor of
   * the circle, while the defence's hold ring is south of it and reads the point
   * clean.
   *
   * The three gaps are what keeps A* alive through it, and they are the three
   * doors the defence holds. The middle one is on the zone's own north axis,
   * which is where the fight for the point wants to be.
   */
  { id: 'A spine west', kind: 'wall', x: -30.6, z: 1.9, w: 3.4, d: 0.55, h: 1.45, key: 'brick', revet: true },
  { id: 'A spine east', kind: 'wall', x: -24.0, z: 1.9, w: 2.6, d: 0.55, h: 1.3, key: 'brick' },
  /**
   * THE POINT SCREEN — a short run standing along Z between the point and the
   * connector mouth, so the rotation's angle onto the circle is a corner rather
   * than a corridor. 3.6 units off the centre; was at z -6.7, where it screened
   * ground nobody stands on any more.
   */
  { id: 'A point screen', kind: 'wall', x: -24.3, z: -1.2, w: 0.55, d: 2.8, h: 1.35, key: 'plaster_cream' },
  /**
   * THE TWO PLINTHS — the waist-high mass ON the point. West and south of the
   * centre, both in the 3.2-5.0 band, and between them they are 10.4 m² of the
   * 12 m² floor on their own. South rather than north on purpose: the north half
   * already has the spine, and cover on all four sides of a capture point is a
   * point nobody can be cleared off.
   *
   * Kept clear of `RELIEF.blocks`'s A-deck step (x -34..-32, z -4.5..-2.5) and of
   * A-deck itself (x -36..-34) — a plinth under a catwalk is a mantle nobody
   * asked for and a nav cell nobody can use.
   */
  { id: 'A plinth west', kind: 'plinth', x: -32.1, z: -1.4, w: 1.6, d: 1.4, h: 1.2, key: 'concrete' },
  { id: 'A plinth south', kind: 'plinth', x: -28.6, z: -3.9, w: 2.0, d: 1.2, h: 1.2, key: 'concrete' },
  /**
   * THE RETAKE WALL — what a side walks up behind to take the point back.
   * `sitecheck` counts retake cover between 4 and 14 m of ground on the
   * defence's own side, i.e. 2.7-9.3 authored units; at z -12.6 this was 12.6
   * units out and counted for nothing. At -5.6 it is 5.6 out, inside the band
   * and just outside the capture circle, and it still leaves the defence's own
   * 10.5-unit mouth from the south lane completely open — the one approach on
   * this map that must never be choked.
   */
  { id: 'A retake wall', kind: 'wall', x: -30.4, z: -5.6, w: 3.0, d: 0.55, h: 1.3, key: 'plaster_blue', revet: true },

  // ═══════════════════════════════════════════════════════ ZONE C (mid) ════
  /**
   * ────────────────────────────────────────────────────────────────────────────
   * ZONE C HAD NOTHING AT ALL, AND IT IS THE POINT BOTH SIDES REACH FIRST
   * ────────────────────────────────────────────────────────────────────────────
   * `sitecheck` on the converted map: 2.8 m² of mass inside C's circle against a
   * floor of 12, and the ATTACK reading 75.1 % of the point off the ground
   * against the defence's 63.4 % — the only site on the map where the side coming
   * in reads the objective better than the side holding it. C is 52 m from the
   * north base and 55 m from the south, so it is also the point every match opens
   * on. An open pan at the shortest range on the map is the worst version of
   * "剥き出し" there is.
   *
   * WHAT THE GROUND ACTUALLY IS. The mid street runs x ±6.5 between the kerbs
   * with two single-storey islands standing in it — K1 at (0, 12), 5.4 square,
   * and K2 at (-0.4, -4.6), 5.6 x 6.2. K2's north face is at z -1.5 and K1's
   * south face at z 9.3, so C's circle (5.33 units) is an open pocket 13 wide and
   * z -1.5..5.33 deep, plus two 3.3-unit alleys either side of K2 that are the
   * SOUTH side's only way on to it. Those alleys are this site's version of the
   * courtyards' south mouth: nothing goes in them.
   *
   * SO C GETS A STREET CHECKPOINT, and its shape is decided by one measurement.
   * Every point in `sitecheck`'s attack fan for C is NORTH of the centre (level
   * z 4.2 to 12.2, because C has no `ALLEYS` rect and the tool falls back to a
   * fan up the lane), and every defence eye is at or south of it. Mass on the
   * NORTH ARC therefore costs the attack its read and costs the defence almost
   * nothing, which is the only way to turn that 75.1/63.4 the right way up
   * without closing the street.
   *
   *   the two SCREENS      x -4.6..-2.0 and 2.0..4.6 at z 3.4 — a 4.0-unit
   *                        central door on the zone's north axis and a 1.9-unit
   *                        slot at each kerb. Three ways through, none of them a
   *                        straight line to the middle of the point.
   *   the north PIER       2.2 square, 2.9 m tall, dead centre at z 5.0. Over the
   *                        2.8 m line on purpose: it is not cover on the point,
   *                        it is the thing that splits the attack's entry in two
   *                        and takes the deep half of that fan's sightline away.
   *                        Leaves 5.4 units of street either side of it.
   *   the two PLINTHS      east and west at z -0.2, 3.3 units out, which is the
   *                        band's inner edge and the only place on this point
   *                        with room for waist-high mass: K2's face is 1.5 units
   *                        south of the centre and the kerbs are 6.5 out.
   *
   * NOTHING IS AUTHORED SOUTH OF z -1.5. That is K2's wall, and the two alleys
   * beside it are 3.3 units wide — one 2-unit run in either of them and the
   * south side has no route on to its own point. @see `navcheck`.
   */
  /**
   * ────────────────────────────────────────────────────────────────────────────
   * AND ZONE C IS INDOORS NOW, SO ITS FIVE STREET PIECES ARE GONE
   * ────────────────────────────────────────────────────────────────────────────
   * "また中央部は屋内にしてほしい なので中央部に広い大聖堂を配置して". Every one of
   * the five pieces above stood on open tarmac inside x ±4.6, z -0.2..5.0 — which
   * is the middle of the CATHEDRAL's nave. A street screen and a concrete pier
   * inside a church are not cover, they are geometry inside geometry.
   *
   * The cover they provided is provided by the building instead, and by more of
   * it: eight nave piers 1.4 m square, two aisle arcades, an altar platform and
   * a choir screen, all of them mass in the 0.9-2.8 m band `sitecheck` counts.
   * @see `src/world/cathedral.js`.
   */

  // ═══════════════════════════════════════════════════════ ZONE B (east) ═══
  /**
   * The mirror, with the same two numbers that were never mirrored, for the same
   * reason they were not before: the east side's dressing is not the west side's.
   *   - the baffle is at z 4.2 like A's, but B's courtyard stall sits at
   *     (24, 1.6) rather than A's (-22.4, -1), so the clearance is checked
   *     against a different prop;
   *   - the connector blockhouse is 0.6 units further from the kerb, because the
   *     jersey barrier at (16.7, -5.5) has no counterpart on the west side and a
   *     concrete barrier standing inside a blockhouse looks like a bug.
   */
  { id: 'B north gatehouse', kind: 'pier', x: 29.2, z: 3.2, w: 3.6, d: 3.2, h: 3.2, key: 'plaster_cream' },
  { id: 'B north baffle', kind: 'wall', x: 23.5, z: 4.2, w: 2.4, d: 2.8, h: 1.6, key: 'brick' },
  { id: 'B connector blockhouse', kind: 'pier', x: 18.6, z: -4.5, w: 2.8, d: 2.4, h: 2.6, key: 'concrete' },
  { id: 'B spine east', kind: 'wall', x: 30.6, z: 1.9, w: 3.4, d: 0.55, h: 1.45, key: 'brick', revet: true },
  { id: 'B spine west', kind: 'wall', x: 24.0, z: 1.9, w: 2.6, d: 0.55, h: 1.3, key: 'brick' },
  { id: 'B point screen', kind: 'wall', x: 24.3, z: -1.2, w: 0.55, d: 2.8, h: 1.35, key: 'plaster_cream' },
  { id: 'B plinth east', kind: 'plinth', x: 32.1, z: -1.4, w: 1.6, d: 1.4, h: 1.2, key: 'concrete' },
  { id: 'B plinth south', kind: 'plinth', x: 28.6, z: -3.9, w: 2.0, d: 1.2, h: 1.2, key: 'concrete' },
  { id: 'B retake wall', kind: 'wall', x: 30.4, z: -5.6, w: 3.0, d: 0.55, h: 1.3, key: 'plaster_pink', revet: true },

  // ═══════════════════════════════ ZONES C AND E — the two outer bays ═══════
  /**
   * The mass ON the two capture points after they moved into the bays the
   * courtyards grew through BW2/BE2 (@see `BUILDINGS`). Zone centres are
   * authored `LW(∓41, -1)` = widened (∓50, -1); everything here is in the same
   * 3.2-5.0 authored band the rest of this table uses — outside `standRing`'s
   * 4 m forward-spawn ring, inside the 8 m capture circle. The pieces the zones
   * left behind at (∓37, -1) STAY — same call as the plazas and the avenues:
   * they are the approach through the courtyard now.
   *
   *   two PLINTHS   waist-high mass ON the point, south and toward the mouth.
   *   one WALL      along Z against the bay's own back half — what a side
   *                 walks up behind to retake the point.
   *   one BAFFLE    standing IN the 13.5 m mouth, 1.4 units outside the old
   *                 wall line, so the way in is two slots rather than a
   *                 courtyard-wide read of the whole bay. A* keeps an 8.4 m
   *                 lane south of it and a slot north — re-measured, not hoped:
   *                 `navcheck` and `sitecheck` gate every piece here.
   *
   * The plinth toward the wall is at 3.2 (the band's inner edge) so it clears
   * the deck strip: A-deck/B-deck now run along the bays' back walls at
   * widened ∓56..∓54 and a plinth under a catwalk is a mantle nobody asked for.
   */
  { id: 'C bay plinth west', kind: 'plinth', x: -44.2, z: -1.0, w: 1.6, d: 1.4, h: 1.2, key: 'concrete' },
  { id: 'C bay plinth south', kind: 'plinth', x: -41.0, z: -4.9, w: 2.0, d: 1.2, h: 1.2, key: 'concrete' },
  { id: 'C bay wall', kind: 'wall', x: -44.6, z: -3.6, w: 0.55, d: 3.0, h: 1.35, key: 'plaster_cream' },
  { id: 'C mouth baffle', kind: 'wall', x: -37.4, z: -1.0, w: 0.55, d: 2.8, h: 1.35, key: 'brick' },

  { id: 'E bay plinth east', kind: 'plinth', x: 44.2, z: -1.0, w: 1.6, d: 1.4, h: 1.2, key: 'concrete' },
  { id: 'E bay plinth south', kind: 'plinth', x: 41.0, z: -4.9, w: 2.0, d: 1.2, h: 1.2, key: 'concrete' },
  { id: 'E bay wall', kind: 'wall', x: 44.6, z: -3.6, w: 0.55, d: 3.0, h: 1.35, key: 'plaster_pink' },
  { id: 'E mouth baffle', kind: 'wall', x: 37.4, z: -1.0, w: 0.55, d: 2.8, h: 1.35, key: 'brick' },
];

/**
 * GROUND THAT MUST STAY WALKABLE — [x, z, radius] in level space.
 *
 * This is not a style rule, it is a nav rule, and it cost two debugging runs to
 * find. Anything the dressing pass drops with a collision proxy — a crate, a
 * barrel, a rubble mound — becomes the FLOOR of the nav cells it covers, and
 * `src/match/sites.js` resolves a bomb site or a spawn by dropping a ray from
 * 4 m and taking whatever it lands on. A rubble mound 1.5 m from a spawn point
 * put that spawn on a 0.6 m island with no route off it, and a crate 0.45 m
 * from the authored centre of site B did the same to the site. Both were then
 * silently relocated by `ensureReachable`, which is the mode papering over a
 * level bug.
 *
 * So: no collision-bearing prop inside these circles. Flat dressing, litter,
 * stains and the ground paint are all still welcome — they have no proxy.
 *
 * The two site entries duplicate the centres authored in `src/match/sites.js`.
 * That is deliberate: `world` may not import `match`. If a site moves, move it
 * here too.
 */
/**
 * THESE FOUR WERE STALE, AND IT IS WHY THE SITES WERE BARE.
 *
 * Commit "The plant zone moves onto the defence's half of the courtyard" moved
 * `SITES[].level` from (-28, -4) / (28.4, -3.6) to (-28, -7) / (28, -7) and
 * `holdLevel` from (-26, -9.8) / (26.4, -9.4) to (-24, -12) / (24, -12). The
 * note two paragraphs up says IF A SITE MOVES, MOVE IT HERE TOO, and it was not
 * done, so for four commits this list has been reserving flat ground 4.5 m north
 * of the real plant circle and 4.5 m north-west of the real hold. Both halves of
 * that are wrong in a way no gate could see:
 *
 *   - the ground that actually needs protecting — the cell the site resolve ray
 *     lands on, and the disc three men have to stand in to defuse — was NOT on
 *     the list, so one reroll of the dressing dice could have put a crate on it;
 *   - a 5.1 m circle was being held empty in the middle of each courtyard for no
 *     reason at all, which is a large part of why the middle of each courtyard
 *     WAS 200 m² of nothing.
 *
 * So: the real centres, and the radius cut from 3.4 to 2.2 authored (5.1 m to
 * 3.3 m on the ground). 3.3 m is what the job actually needs — it clears the
 * resolve ray, and it is comfortably outside `RULES.defuseRadius` (1.8 m) so the
 * defuse crew of three still has flat ground under it. Everything from 3.3 m out
 * is now ground the dressing pass and `SITEWORKS` are allowed to put mass on,
 * which is the whole point.
 */
/**
 * ════════════════════════════════════════════════════════════════════════════
 * AND THEN THEY WENT STALE AGAIN, AND THIS TIME IT MADE THE ZONES MOVE BETWEEN
 * BOOTS.
 * ════════════════════════════════════════════════════════════════════════════
 * The two entries below reserve the DEMOLITION plant circles at (∓28, -7). The
 * mode is domination and `ZONES` in src/match/sites.js is at (∓28, 0) and
 * (0, 0), so for the whole of the conversion the three squares that actually
 * had to stay clear were not on this list at all.
 *
 * MEASURED, over four consecutive boots of the same build (`_zoneprobe.mjs`):
 *
 *   boot 1   zone A resolved at world (-34.4, 24.0)   7 standing points
 *   boot 2   zone A resolved at world (-32.0, 25.6)   7 standing points
 *            + "[match] site A: authored point is walkable but NOT reachable
 *               from every attack/defend spawn — moved 2.2 m"
 *   boot 3   zone A resolved at world (-34.4, 24.8)   8 standing points
 *
 * That is A CAPTURE POINT THAT IS IN A DIFFERENT PLACE EVERY TIME THE GAME
 * STARTS, and a point that moves cannot have authored cover — which is why the
 * regression report saw three different coordinates for the same zone.
 *
 * The cause is not `sites.js`. `src/core/engine.js` seeds `ctx.rng` from
 * `Math.random()` unless `config.deterministic` is set, so the level is a
 * DIFFERENT procedural level on every boot: 1273k / 1310k / 1294k static
 * triangles and 86445 / 86455 / 86454 walkable nav cells across those same three
 * runs. That is by design — it is what makes the map not the same map twice.
 * What is NOT by design is that the dressing scatter was free to drop a
 * collision-bearing crate on the middle of a capture point, because the middle
 * of a capture point was not on this list. `groundPoint` then resolved the zone
 * onto the crate's 0.6 m lid, `ensureReachable` found no route on to that lid
 * and walked the whole zone 2.2 m sideways.
 *
 * So the three ZONE centres go on, at radius 3.0 rather than the 2.2 the plant
 * circles use. 3.0 authored is 4.5 m of ground, and 4.5 m is not a taste either:
 * `standRing` cuts a zone's eight STANDING POINTS at `radius * 0.5` = 4 m, and
 * those points are also its FORWARD SPAWNS. A crate on one of them is a man
 * respawning on top of a crate. The radius is sized to the ring, and `SITEWORKS`
 * is authored from 3.2 units out precisely so the two never argue.
 *
 * The demolition entries stay: `RULES.mode` is still switchable and this file
 * cannot see which one is running.
 */
/**
 * ════════════════════════════════════════════════════════════════════════════
 * AND THE THREE ZONES HAVE MOVED AGAIN — ONE BESIDE EACH BASE, ONE IN THE
 * MIDDLE. THESE THREE CIRCLES MOVED WITH THEM.
 * ════════════════════════════════════════════════════════════════════════════
 * "それぞれの拠点から近いところにエリアを作り、中央部に１つさらに設置して". The zones
 * are no longer the two courtyards and the mid street; they are the north plaza
 * between W5 and E5, the CATHEDRAL crossing, and the south plaza between W4 and
 * E4. All three are on the street centreline, so `widenX` leaves them where they
 * are, and all three are duplicated from `ZONES` in src/match/sites.js for the
 * reason the file has always duplicated them: `world` may not import `match`.
 * IF ONE MOVES, MOVE THE OTHER. Radius 3.0 authored = 4.5 m of ground, sized to
 * `standRing`'s 4 m forward-spawn ring exactly as before.
 */
/**
 * ════════════════════════════════════════════════════════════════════════════
 * …AND AGAIN, BECAUSE THE THREE ZONES CAME OFF THE CENTRELINE ALTOGETHER.
 * ════════════════════════════════════════════════════════════════════════════
 * "ドミねーとする場所が一っ直線に並んでるでしょ？ そうするとマップの左右側に行くメリット
 *  ないから改善してほしい" — all three were at level x 0, so they were COLLINEAR
 * and the whole left and right of the map was worth nothing.
 *
 * Zone C is the one that can still be written pre-widen, because it is the WEST
 * COURTYARD and the courtyard is authored in this table's own space. Zones A and B
 * stand in the two NEW CORNER DISTRICTS, which are authored in widened space at
 * the foot of this file — so their circles are pushed there, beside the ground
 * they belong to, exactly as the base-district pockets are.
 * @see `THE MAP GROWS — PART 4` and `ZONES` in src/match/sites.js.
 */
export const KEEPOUT = [
  /**
   * ZONES C AND E MOVED INTO THE TWO OUTER BAYS — widened (∓50, -1), still on
   * the equidistant line z -1 and still exact ρ images of each other. These two
   * circles moved with them IN THE SAME COMMIT, which is the sentence this file
   * has now written five times: a zone centre without its circle is a zone the
   * dressing scatter can put a crate on, and a zone that then moves between
   * boots. @see the C and E entries in `ZONES`, src/match/sites.js.
   */
  [-41.0, -1.0, 3.0], // ZONE C — the west bay, on the equidistant line
  /**
   * ZONE E — the east courtyard, and it is ρ(C) rather than a mirror of this
   * line. `widenX` is odd, so the widened pair is (-37, -1) and (37, -1), and
   * ρ(x, z) = (-x, -2 - z) sends the first to the second exactly. @see the E
   * entry in `ZONES`, src/match/sites.js — IF ONE MOVES, MOVE THE OTHER, which
   * this file has now had to write five times.
   *
   * Radius 3.0 like every other zone centre, sized to `standRing`'s 4 m
   * forward-spawn ring. The demolition circle at (28, -7) below is a different
   * point in a different mode and both stay.
   */
  [41.0, -1.0, 3.0], // ZONE E — the east bay, ρ(C)
  [-28.0, -7.0, 2.2], // site A plant area
  [28.0, -7.0, 2.2], // site B plant area
  /**
   * The two HOLD points, and they belong on this list for exactly the reason
   * the site centres do. `navcheck` proves that every defender can reach the
   * spot his own side sets up on, and it is resolved by dropping a ray and
   * taking whatever it lands on — so a barrel dressed onto it puts the whole
   * defence's rally point on a 0.9 m island. Six defenders lost their route to
   * hold A on one reroll of the dressing dice. Duplicated from
   * `SITES[].holdLevel` in src/match/sites.js for the same reason the centres
   * are: `world` may not import `match`. If one moves, move the other.
   */
  [-24.0, -12.0, 2.2], // site A hold
  [24.0, -12.0, 2.2], // site B hold
  /**
   * The spawn pockets. Radius 6 covered a seven-man cluster spread over 8 m of
   * z; both clusters are fifteen men over 10.4 m now, and at 1.5x that is 15.6
   * m of real ground with rubble and barriers dressed into the ends of it.
   * `navcheck` reported six defenders relocated by `relocateSpawn` — the mode
   * papering over a level bug, which is exactly what the note above says this
   * list exists to prevent. Sized to the cluster: 9.5 x 1.5 = 14.3 m clears the
   * furthest man plus a capsule.
   */
  /**
   * …and both pockets moved out into the new base districts with the spawns:
   * five ranks of three at z 60.1..68.9 and -62.1..-70.9, x ∓6. Radius 9.5
   * authored (14.3 m) still clears the furthest man of the cluster plus a
   * capsule, because the cluster's shape did not change — only its z.
   */
  [0, 64.5, 9.5], // attack spawn pocket
  [0, -66.5, 9.5], // defend spawn pocket
];

/**
 * Buildings. `w` is the X extent, `d` the Z extent.
 * Interiors are described in normalised room coordinates (0..1 across the
 * interior), so a plan survives a change of footprint.
 *
 * `route` — EVERY ENTERABLE BUILDING IS A THROUGH-ROUTE, AND SAYS SO.
 *
 * The complaint was "屋内で行き止まりはだめ" — an interior must not be a dead end
 * — and `tools/throughcheck.mjs` walked the real player capsule over the ground
 * floor of all eight and found nine openings that led nowhere. Not one of them
 * was a wall: they were all furniture. W1 and W2 had BOTH doors opening into a
 * pocket behind a shop counter, and K1 — a 5.4 m shed with a door at each end —
 * was cut in half by a 3.3 m counter across the middle.
 *
 * So the corridor is declared rather than hoped for. Each entry is one polyline
 * through the ground floor: `'s1'` / `'w3'` name an opening (door / vault
 * window on that side) and resolve to wherever the builder actually cut it;
 * `[x, z]` pairs are normalised interior coordinates like the room plans, 0 at
 * the inner face of the -X / -Z wall and 1 at the +X / +Z one. Legs that end
 * near each other join up into one network — a building with three ways in gets
 * three legs, not three separate corridors.
 *
 * `buildInterior` then makes it true: a partition the route crosses gets its
 * doorway AT the crossing, and nothing carrying a collision proxy may stand
 * within 0.85 m of the line. Dressing with no proxy is untouched, so a corridor
 * is clear to walk without being visibly swept.
 *
 * If you move a door or repartition a floor, re-run `throughcheck`.
 *
 * THE TWO ROWS ARE THE LANE WALLS. Their z ranges are chosen so the only gaps
 * between them are the four cross links, and the outer faces (x ∓20.5) are the
 * lane's inner wall while the inner faces (x ∓6.5) are the mid street's.
 */
/**
 * ROOF CLUTTER ON THE SIX ENTERABLE BUILDINGS IS ROUGHLY DOUBLED, because
 * their roofs stopped being skyline and became FLOOR. `roofProps` was set when
 * nothing could stand up there and it is a count, not a density — so a roof
 * that is 2.25x the area at 1.5x, and that a player now walks out onto through
 * a stairhead, was reading as an empty concrete plate. Screenshotted from W3's
 * roof: one water tank and 600 square metres of screed.
 */
export const BUILDINGS = [
  // ------------------------------------------------------------- west row --
  {
    /** North block. Runs the full width of the row AND the A lane, so it caps
     *  the north end of the lane and forms the north wall of the cross street. */
    id: 'W5',
    x: -18.5,
    z: 38,
    w: 24,
    d: 12,
    floors: 2,
    setback: { from: 1, depth: 2.2, side: 2 },
    wallKey: 'plaster_cream',
    streetSide: 2,
    secondarySide: 1,
    damage: 0.15,
    balconies: 0.3,
    doorBays: { 2: 3 },
    roofProps: 3,
  },
  {
    /**
     * W1 — the block between connector 1 and the north cross, so it has open
     * faces on all four sides: the mid street (+X), the A lane (-X), connector
     * 1 (-Z) and the cross street (+Z). Enterable, and the ground floor is a
     * genuine four-way crossing for a player who wants to skip the corner.
     */
    id: 'W1',
    x: -13.5,
    z: 19.5,
    w: 14,
    d: 9,
    floors: 2,
    wallKey: 'plaster_sand',
    trimKey: 'concrete',
    streetSide: 1,
    secondarySide: 3,
    damage: 0.25,
    balconies: 0.5,
    arches: true,
    doorBays: { 1: 1, 3: 1, 0: 2 },
    /**
     * A low, wide, glassless opening onto the A lane at sill height 0.95 m.
     * `MOVE.mantle.maxHeight` is 1.85, so this is a vault, and it is the A
     * lane's window entry.
     */
    bayKinds: {
      3: { 0: { 0: { kind: 'window', state: 'open', grille: false, y: 1.85, h: 1.8, w: 1.5 } } },
    },
    enterable: true,
    roofAccess: true,
    roofProps: 8,
    /**
     * A lane -> mid street across the north half, with the side-0 door off
     * connector 1 and the A-lane window feeding into the same corridor. The
     * spine deliberately runs NORTH of the z-centre partition so it comes out
     * past the trimmed end of that wall, straight in front of the mid door.
     */
    route: [
      ['s3', [0.16, 0.5], [0.3, 0.63], [0.55, 0.66], [0.8, 0.63], [0.93, 0.52], 's1'],
      ['s0', [0.5, 0.16], [0.58, 0.4], [0.62, 0.62]],
      ['w3', [0.16, 0.86], [0.28, 0.74], [0.36, 0.66]],
    ],
    /**
     * ONLY THE GROUND FLIGHT IS AUTHORED. Every storey above it is derived by
     * `resolveStairFlights` in buildings.js: the flight turns away from the wall
     * it runs against at each landing and walks the next bay of the plan, so the
     * stair is a circulation core and not the same fourteen treads redrawn at
     * three heights. `x`/`z` on an upper entry would be ignored; `w`, `run` and
     * `railing` are still honoured.
     */
    stairFlights: [
      { floor: 0, x: 0.12, z: 0.06, ry: 0, w: 1.15, railing: 'right' },
      { floor: 1, w: 1.15, railing: 'right' },
    ],
    rooms: [
      {
        // A cross-shaped through route: one partition with a doorway in it, and
        // the stair tucked into the north-west corner out of the walking line.
        walls: [
          [0.42, 0.0, 0.42, 1.0, 0.62],
          [0.42, 0.5, 1.0, 0.5, 0.35],
        ],
        furnish: [
          { kind: 'shop', x0: 0.42, z0: 0.5, x1: 1.0, z1: 1.0 },
          { kind: 'storage', x0: 0.42, z0: 0.0, x1: 1.0, z1: 0.5 },
          { kind: 'living', x0: 0.0, z0: 0.0, x1: 0.42, z1: 0.52 },
          { kind: 'storage', x0: 0.0, z0: 0.52, x1: 0.42, z1: 1.0 },
        ],
      },
      {
        walls: [[0.46, 0.0, 0.46, 1.0, 0.7]],
        furnish: [
          { kind: 'living', x0: 0.46, z0: 0.0, x1: 1.0, z1: 1.0 },
          { kind: 'storage', x0: 0.0, z0: 0.0, x1: 0.46, z1: 1.0 },
        ],
      },
    ],
  },
  {
    /**
     * W2 — THE A-SIDE INTERIOR ROUTE. It sits between connector 1 and connector
     * 2 with the mid street on one face and site A's courtyard on the other, so
     * its ground floor is a covered way from mid straight into the site that
     * bypasses both connector mouths. For a player only: see the nav note above.
     */
    id: 'W2',
    x: -13.5,
    z: 4,
    w: 14,
    d: 10,
    floors: 2,
    setback: { from: 1, depth: 2.4, side: 1 },
    wallKey: 'plaster_cream',
    streetSide: 1,
    secondarySide: 3,
    damage: 0.3,
    balconies: 0.6,
    doorBays: { 1: 2, 3: 0 },
    // The interior camera stands in the shop and looks out through bay 1 of the
    // street facade, so that bay is an open shopfront by hand, not by dice.
    bayKinds: { 1: { 0: { 1: { kind: 'shop', drop: 0 } } } },
    enterable: true,
    roofAccess: true,
    roofProps: 9,
    /** The covered way from mid straight into site A — the claim this building
     *  was authored to make, now measured rather than asserted. */
    route: [['s3', [0.16, 0.84], [0.34, 0.8], [0.5, 0.76], [0.7, 0.8], [0.88, 0.85], 's1']],
    stairFlights: [
      { floor: 0, x: 0.12, z: 0.08, ry: 0, w: 1.2, railing: 'right' },
      // derived — see W1
      { floor: 1, w: 1.2, railing: 'right' },
    ],
    rooms: [
      {
        // One partition across the through route with a door in the middle of
        // it: cover to fight over rather than a clear tunnel.
        walls: [
          [0.5, 0.0, 0.5, 1.0, 0.72],
          [0.5, 0.45, 1.0, 0.45, 0.3],
        ],
        furnish: [
          { kind: 'shop', x0: 0.5, z0: 0.45, x1: 1.0, z1: 1.0 },
          { kind: 'storage', x0: 0.5, z0: 0.0, x1: 1.0, z1: 0.45 },
          { kind: 'storage', x0: 0.0, z0: 0.0, x1: 0.5, z1: 0.5 },
          { kind: 'living', x0: 0.0, z0: 0.5, x1: 0.5, z1: 1.0 },
        ],
      },
      {
        walls: [
          [0.48, 0.0, 0.48, 1.0, 0.62],
          [0.48, 0.45, 1.0, 0.45, 0.25],
        ],
        furnish: [
          { kind: 'living', x0: 0.48, z0: 0.45, x1: 1.0, z1: 1.0 },
          { kind: 'storage', x0: 0.48, z0: 0.0, x1: 1.0, z1: 0.45 },
          { kind: 'living', x0: 0.0, z0: 0.0, x1: 0.48, z1: 1.0 },
        ],
      },
    ],
  },
  {
    /**
     * W3 — the long block south of connector 2. Enterable, badly knocked about,
     * and the second A-side interior route: a defender falling back from site A
     * can cut through it to the mid street instead of running the south cross.
     */
    id: 'W3',
    x: -13.5,
    z: -17,
    w: 14,
    d: 18,
    floors: 2,
    wallKey: 'plaster_blue',
    streetSide: 1,
    secondarySide: 3,
    damage: 0.5,
    balconies: 0.3,
    doorBays: { 1: 1, 3: 4 },
    bayKinds: {
      // The A lane's second vault-in, at the south end of the site approach.
      3: { 0: { 1: { kind: 'window', state: 'open', grille: false, y: 1.8, h: 1.7, w: 1.4 } } },
    },
    enterable: true,
    roofAccess: true,
    roofProps: 7,
    /** Across the south end lane-to-street, plus a spur north up the west side
     *  from the vault window to the same crossing the plan already had. */
    route: [
      ['s3', [0.16, 0.22], [0.32, 0.27], [0.55, 0.26], [0.8, 0.23], 's1'],
      ['w3', [0.16, 0.74], [0.26, 0.7], [0.28, 0.6], [0.3, 0.4], [0.32, 0.28]],
    ],
    stairFlights: [
      { floor: 0, x: 0.86, z: 0.06, ry: 0, w: 1.15, railing: 'right' },
      // derived — see W1
      { floor: 1, w: 1.15, railing: 'right' },
    ],
    rooms: [
      {
        walls: [
          [0.46, 0.0, 0.46, 0.66, 0.4],
          [0.0, 0.66, 1.0, 0.66, 0.28],
        ],
        furnish: [
          { kind: 'storage', x0: 0.46, z0: 0.0, x1: 1.0, z1: 0.34 },
          { kind: 'living', x0: 0.46, z0: 0.34, x1: 1.0, z1: 0.66 },
          { kind: 'ruin', x0: 0.0, z0: 0.0, x1: 0.46, z1: 0.34 },
          { kind: 'storage', x0: 0.0, z0: 0.34, x1: 0.46, z1: 0.66 },
          { kind: 'shop', x0: 0.0, z0: 0.66, x1: 1.0, z1: 1.0 },
        ],
      },
      {
        walls: [[0.0, 0.52, 1.0, 0.52, 0.6]],
        furnish: [
          { kind: 'living', x0: 0.0, z0: 0.52, x1: 1.0, z1: 1.0 },
          { kind: 'ruin', x0: 0.0, z0: 0.0, x1: 1.0, z1: 0.52 },
        ],
      },
    ],
  },
  {
    /** South block, mirror of W5: caps the A lane's south end and forms the
     *  south wall of the cross street the defence fans out along. */
    id: 'W4',
    x: -18.5,
    z: -40,
    w: 24,
    d: 12,
    floors: 2,
    setback: { from: 1, depth: 2.4, side: 0 },
    wallKey: 'plaster_pink',
    streetSide: 0,
    secondarySide: 1,
    damage: 0.3,
    balconies: 0.5,
    arches: true,
    doorBays: { 0: 3 },
    roofProps: 4,
  },

  // ------------------------------------------------------------- east row --
  {
    id: 'E5',
    x: 18.5,
    z: 38,
    w: 24,
    d: 12,
    floors: 2,
    wallKey: 'plaster_blue',
    streetSide: 2,
    secondarySide: 3,
    damage: 0.2,
    doorBays: { 2: 4 },
    roofProps: 3,
  },
  {
    /** E1 — mirror of W1, three floors, and the only roof you can reach. */
    id: 'E1',
    x: 13.5,
    z: 19.5,
    w: 14,
    d: 9,
    floors: 3,
    wallKey: 'plaster_cream',
    streetSide: 3,
    secondarySide: 1,
    damage: 0.3,
    balconies: 0.45,
    doorBays: { 3: 1, 1: 1, 0: 0 },
    bayKinds: {
      // The B lane's window entry.
      1: { 0: { 2: { kind: 'window', state: 'open', grille: false, y: 1.85, h: 1.8, w: 1.5 } } },
    },
    enterable: true,
    roofAccess: true,
    roofProps: 10,
    /** Mirror of W1: street -> B lane, with the connector door and the lane
     *  window joining the same spine. */
    route: [
      ['s3', [0.1, 0.52], [0.3, 0.6], [0.5, 0.62], [0.72, 0.6], [0.86, 0.54], 's1'],
      ['s0', [0.1, 0.16], [0.16, 0.36], [0.22, 0.56]],
      ['w1', [0.9, 0.84], [0.8, 0.74], [0.74, 0.62]],
    ],
    stairFlights: [
      { floor: 0, x: 0.86, z: 0.06, ry: 0, w: 1.2, railing: 'right' },
      // derived — see W1. Three storeys, so the core walks three of the four bays.
      { floor: 1, w: 1.2, railing: 'right' },
      { floor: 2, w: 1.2, railing: 'right' },
    ],
    rooms: [
      {
        walls: [
          [0.58, 0.0, 0.58, 1.0, 0.62],
          [0.0, 0.5, 0.58, 0.5, 0.35],
        ],
        furnish: [
          { kind: 'shop', x0: 0.0, z0: 0.5, x1: 0.58, z1: 1.0 },
          { kind: 'storage', x0: 0.0, z0: 0.0, x1: 0.58, z1: 0.5 },
          { kind: 'living', x0: 0.58, z0: 0.0, x1: 1.0, z1: 0.52 },
          { kind: 'storage', x0: 0.58, z0: 0.52, x1: 1.0, z1: 1.0 },
        ],
      },
      {
        walls: [[0.54, 0.0, 0.54, 1.0, 0.7]],
        furnish: [
          { kind: 'living', x0: 0.0, z0: 0.0, x1: 0.54, z1: 1.0 },
          { kind: 'storage', x0: 0.54, z0: 0.0, x1: 1.0, z1: 1.0 },
        ],
      },
      {
        walls: [[0.0, 0.46, 0.54, 0.46, 0.5]],
        furnish: [
          { kind: 'ruin', x0: 0.0, z0: 0.0, x1: 0.54, z1: 0.46 },
          { kind: 'living', x0: 0.0, z0: 0.46, x1: 0.54, z1: 1.0 },
          { kind: 'storage', x0: 0.54, z0: 0.0, x1: 1.0, z1: 1.0 },
        ],
      },
    ],
  },
  {
    /** E2 — THE B-SIDE INTERIOR ROUTE, mirror of W2, one floor taller so the
     *  balconies look down into site B's courtyard. */
    id: 'E2',
    x: 13.5,
    z: 4,
    w: 14,
    d: 10,
    floors: 3,
    wallKey: 'plaster_blue',
    streetSide: 3,
    secondarySide: 1,
    damage: 0.3,
    balconies: 0.7,
    doorBays: { 3: 0, 1: 2 },
    bayKinds: {
      // The MID lane's window entry: vault straight off the street into the
      // building that leads through to site B.
      3: { 0: { 2: { kind: 'window', state: 'open', grille: false, y: 1.85, h: 1.8, w: 1.5 } } },
    },
    enterable: true,
    roofAccess: true,
    roofProps: 9,
    /** Mid street -> site B, and the mid-street vault window down at the south
     *  end feeding into it up the west side of the plan. */
    route: [
      ['s3', [0.16, 0.84], [0.34, 0.8], [0.5, 0.76], [0.7, 0.8], [0.88, 0.85], 's1'],
      ['w3', [0.14, 0.2], [0.2, 0.34], [0.24, 0.55], [0.26, 0.72], [0.3, 0.81]],
    ],
    stairFlights: [
      { floor: 0, x: 0.88, z: 0.08, ry: 0, w: 1.2, railing: 'right' },
      // derived — see W1. Three storeys, so the core walks three of the four bays.
      { floor: 1, w: 1.2, railing: 'right' },
      { floor: 2, w: 1.2, railing: 'right' },
    ],
    rooms: [
      {
        walls: [
          [0.5, 0.0, 0.5, 1.0, 0.72],
          [0.0, 0.45, 0.5, 0.45, 0.3],
        ],
        furnish: [
          { kind: 'shop', x0: 0.0, z0: 0.45, x1: 0.5, z1: 1.0 },
          { kind: 'storage', x0: 0.0, z0: 0.0, x1: 0.5, z1: 0.45 },
          { kind: 'storage', x0: 0.5, z0: 0.0, x1: 1.0, z1: 0.5 },
          { kind: 'living', x0: 0.5, z0: 0.5, x1: 1.0, z1: 1.0 },
        ],
      },
      {
        walls: [[0.52, 0.0, 0.52, 1.0, 0.62]],
        furnish: [
          { kind: 'living', x0: 0.0, z0: 0.0, x1: 0.52, z1: 1.0 },
          { kind: 'storage', x0: 0.52, z0: 0.0, x1: 1.0, z1: 1.0 },
        ],
      },
      {
        walls: [[0.45, 0.0, 0.45, 0.6, 0.4]],
        furnish: [
          { kind: 'ruin', x0: 0.0, z0: 0.0, x1: 0.45, z1: 1.0 },
          { kind: 'living', x0: 0.45, z0: 0.0, x1: 1.0, z1: 1.0 },
        ],
      },
    ],
  },
  {
    /** E3 — mirror of W3: the long ruined block south of connector 2, with the
     *  roof down over one end of it. */
    id: 'E3',
    x: 13.5,
    z: -17,
    w: 14,
    d: 18,
    floors: 2,
    wallKey: 'plaster_sand',
    streetSide: 3,
    secondarySide: 1,
    damage: 0.7,
    ruin: true,
    ruinSide: 1,
    collapse: true,
    doorBays: { 3: 4, 1: 1 },
    bayKinds: {
      1: { 0: { 4: { kind: 'window', state: 'open', grille: false, y: 1.8, h: 1.7, w: 1.4 } } },
    },
    enterable: true,
    roofAccess: true,
    roofProps: 7,
    /** Mirror of W3. The window spur runs down the EAST side here, so the
     *  cross-wall's opening moves with it. */
    route: [
      ['s3', [0.2, 0.23], [0.35, 0.26], [0.6, 0.26], [0.84, 0.22], 's1'],
      ['w1', [0.86, 0.72], [0.78, 0.7], [0.74, 0.58], [0.72, 0.4], [0.7, 0.28], [0.62, 0.25]],
    ],
    stairFlights: [
      { floor: 0, x: 0.14, z: 0.06, ry: 0, w: 1.15, railing: 'right' },
      // derived — see W1
      { floor: 1, w: 1.15, railing: 'right' },
    ],
    rooms: [
      {
        walls: [
          [0.54, 0.0, 0.54, 0.66, 0.4],
          [0.0, 0.66, 1.0, 0.66, 0.72],
        ],
        furnish: [
          { kind: 'ruin', x0: 0.54, z0: 0.0, x1: 1.0, z1: 0.34 },
          { kind: 'storage', x0: 0.54, z0: 0.34, x1: 1.0, z1: 0.66 },
          { kind: 'storage', x0: 0.0, z0: 0.0, x1: 0.54, z1: 0.34 },
          { kind: 'ruin', x0: 0.0, z0: 0.34, x1: 0.54, z1: 0.66 },
          { kind: 'shop', x0: 0.0, z0: 0.66, x1: 1.0, z1: 1.0 },
        ],
      },
      {
        walls: [],
        furnish: [{ kind: 'ruin', x0: 0.0, z0: 0.0, x1: 1.0, z1: 1.0 }],
      },
    ],
  },
  {
    id: 'E4',
    x: 18.5,
    z: -40,
    w: 24,
    d: 12,
    floors: 3,
    wallKey: 'plaster_pink',
    streetSide: 0,
    secondarySide: 3,
    damage: 0.35,
    balconies: 0.4,
    arches: true,
    doorBays: { 0: 4 },
    roofProps: 4,
  },

  // ------------------------------------------------------- the mid island --
  /**
   * K1 AND K2 ARE GONE, AND WHAT REPLACES THEM IS THE WHOLE POINT OF THIS PASS.
   *
   * They were two single-storey sheds standing in the middle of the mid street,
   * one inside each connector, at level (0, 12) and (-0.4, -4.6). Both are
   * inside the CATHEDRAL's footprint — level x -10..10, z -16..14 — so they
   * cannot both exist. The job they did (a dog-leg in each connector instead of
   * a fifty-metre firing line, and a piece of hard cover to hold mid from) is
   * done far better by a 30 x 45 m building standing on the same ground with a
   * way through it: the rotation between the two lanes is now either 8.25 m of
   * street down one flank or the length of a nave, and both are contested.
   *
   * They were also two of the ten `enterable` buildings, and their replacements
   * are N2 and S2 in the two new base districts (see the bottom of this file),
   * so the interior gates have the same count of interiors to prove.
   *
   * @see `src/world/cathedral.js`, and `CATHEDRAL` at the foot of this file.
   */

  // ------------------------------------------------- background / infill --
  /**
   * The mass BEYOND the lanes. These are the lanes' outer wall as much as they
   * are skyline: `skipSides` drops the faces nobody can ever see, and the inner
   * face of each one is the wall you take cover against.
   */
  /**
   * BW1 AND BE3 ARE SHORTER THAN THEY WERE, AND THAT IS WHAT MAKES THE TWO
   * CORNER DISTRICTS POSSIBLE. @see `THE MAP GROWS — PART 4` at the foot of this
   * file.
   *
   * BW1 ran level z 1..43 and BE3 z -44..-8, i.e. each one walled its lane from
   * the courtyard all the way to the cross street AND filled the whole corner
   * behind it. The two new capture districts stand in those corners, so each
   * block keeps the length that is actually a lane wall (20 units) and gives up
   * the part that was only ever infill: BW1 is now z 1..21, BE3 z -23..-3.
   *
   * `cordonRuns()` derives the four party walls from the overlap of a background
   * block and the block in front of it, so the BW1-W5 and BE3-E4 pairs drop out
   * of that list on their own the moment the overlap goes to zero — the 0.75 m
   * slots they closed are now 20-unit mouths into the new districts, which is
   * the point. Nothing in `src/world/cordon.js` changed to make that happen.
   */
  { id: 'BW1', x: -41, z: 11, w: 20, d: 20, floors: 3, wallKey: 'plaster_sand', streetSide: 1, damage: 0.15, skipSides: [3], roofProps: 3 },
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * BW2 AND BE2 ARE THE COURTYARDS' OUTER WALLS NOW, NOT THEIR INFILL
   * ══════════════════════════════════════════════════════════════════════════
   * "CサイトとEサイト付近はもう少し大聖堂から遠くできる？今近いから、もう少しマップを
   *  広くして遠ざけて" — push C and E away from the cathedral and make the map
   * wider to do it.
   *
   * C and E sit on level z -1 because that is the line equidistant from the two
   * bases, and a zone off it is a permanent lead in a mode that never swaps ends
   * (@see the C entry in `ZONES`, src/match/sites.js, which measured a 103 m
   * gift and reverted). So the ONLY way to move them out is along z -1 — and at
   * z -1 the ground stopped at the courtyards' west/east walls, which were
   * BW2's and BE2's inner faces (widened ∓45).
   *
   * So each courtyard grows an OUTER BAY through the block that walled it: BW2
   * goes from an 18-wide slab (widened -63..-45) to a 6-wide back wall
   * (widened -62..-56), and the 11 units it vacates become courtyard ground.
   * The bay is walled on its own: BW1's south face (z 1) caps it north, BW3's
   * north face (z -8) caps it south, BW2's east face (x ∓56) is its back wall,
   * and its whole east side opens into the courtyard it belongs to. The zones
   * move into the bays — widened (∓50, -1), 19.5 m further out, still an exact
   * ρ pair because ρ(x, -1) = (-x, -1).
   *
   * BE3's north face moves from z -3 to z -8 in the same breath, because the
   * east bay does not exist without it: BW3's north face is z -8 and BE3's was
   * -3, so the mirrored bay would have been 4 units tall against the west's 9.
   * The two bays are MIRROR pairs exactly as the two courtyards are; the two
   * zone centres on z -1 are ρ images of each other regardless.
   */
  { id: 'BW2', x: -50, z: -4, w: 6, d: 18, floors: 2, wallKey: 'plaster_cream', streetSide: 1, damage: 0.25, skipSides: [3], roofProps: 2 },
  { id: 'BW3', x: -41, z: -26, w: 20, d: 36, floors: 2, wallKey: 'plaster_blue', streetSide: 1, damage: 0.2, skipSides: [3], roofProps: 2 },
  { id: 'BE1', x: 41, z: 22, w: 20, d: 42, floors: 3, wallKey: 'plaster_pink', streetSide: 3, damage: 0.15, skipSides: [1], roofProps: 3 },
  { id: 'BE2', x: 50, z: -4, w: 6, d: 18, floors: 2, wallKey: 'plaster_sand', streetSide: 3, damage: 0.25, skipSides: [1], roofProps: 2 },
  /** North face pulled from z -3 to z -8, the mirror of BW3's. @see BW2 above. */
  { id: 'BE3', x: 41, z: -15.5, w: 20, d: 15, floors: 2, wallKey: 'plaster_cream', streetSide: 3, damage: 0.2, skipSides: [1], roofProps: 2 },
  /**
   * The mass BEHIND the gate. Only its top four metres and its roofline are
   * visible — through the sliver of sky over the arch spandrel — but that is the
   * whole point: it is the third plane of depth that stops the terminator
   * reading as a flat cut-out, and it is offset west so a slice of real sky
   * survives on the east side of the gap.
   */
  /**
   * ALL FIVE MOVED OUT WITH THE STREET ENDS, AND THEY KEPT THEIR OFFSETS.
   *
   * The gate went from level z -50.5 to -74 and both spawns went out past it, so
   * the three southern blocks moved by the same -23 and the two northern ones by
   * +24 — BS3 is still exactly 10 units behind the arch (which is the whole of
   * its job: the receding roofline you see through the sliver of sky over the
   * spandrel), BS1/BS2 still stand behind it, and BN1/BN2 still close the north
   * vista. Their X moved as well, and that is NOT cosmetic: the cordon walls the
   * new base districts are enclosed by run at level x ∓(kerb + 0.4) = ∓15.9 from
   * z 44 to 73.7, and BN1 at its old x would have had its corner inside that run
   * with a 0.9 m slot beside it — a hole in the boundary, which is the exact
   * thing `tools/boundcheck.mjs` exists to catch.
   */
  { id: 'BS3', x: -4, z: -84, w: 9, d: 8, floors: 4, wallKey: 'plaster_sand', streetSide: 2, damage: 0.3, balconies: 0.2, roofProps: 4 },
  { id: 'BS1', x: -19, z: -89, w: 20, d: 14, floors: 3, wallKey: 'plaster_sand', streetSide: 2, damage: 0.2, roofProps: 2 },
  { id: 'BS2', x: 14, z: -91, w: 24, d: 16, floors: 2, wallKey: 'plaster_blue', streetSide: 2, damage: 0.2, roofProps: 2 },
  { id: 'BN1', x: -23, z: 78, w: 20, d: 14, floors: 2, wallKey: 'plaster_cream', streetSide: 0, damage: 0.15, roofProps: 2 },
  { id: 'BN2', x: 21, z: 80, w: 22, d: 16, floors: 3, wallKey: 'plaster_pink', streetSide: 0, damage: 0.15, roofProps: 2 },

  // ------------------------------------------------- IN-LANE HARD COVER --
  /**
   * "Battle Fieldみたいにマップをもう少し広くして" is not only a request for more
   * ground, and 1.5x on its own is a downgrade: the same fifteen barriers and
   * six wrecks now stand in 2.25x the square metres, so every lane got a third
   * emptier at the same time as it got half again as long. These are the mass
   * that goes back in — single-storey blocks standing IN the lanes and across
   * the two cross streets, sized and sited so that:
   *
   *   - a lane keeps a walkable width either side. The lanes are 15.75 m at
   *     1.5x and a 7.5 m block leaves 8 m, which is more than the 10.5 m lane
   *     had spare before;
   *   - the cross streets are BLOCKED FROM ONE EDGE rather than down the
   *     middle. A block centred in a 12 m cross street leaves two 2 m slots and
   *     seals it for a 0.72 m nav radius; flush to one kerb it leaves one 7.5 m
   *     mouth, which is a corner to fight round instead of a wall;
   *   - none of them is `enterable`, so the interior gates have nothing new to
   *     prove and a solid block is honest cover rather than another room.
   *
   * `navcheck` is the gate: every spawn must still reach every site.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * …AND THE EAST TWO WERE NOT THE ρ IMAGES OF THE WEST TWO, WHICH BURIED A
   * MEDICAL POST. THEY ARE DERIVED NOW.
   * ──────────────────────────────────────────────────────────────────────────
   * These four were authored as an X-MIRROR pair — same z either side of the
   * street, a face index mirrored about x — and this map's symmetry is ρ, the
   * 180° rotation about the cathedral (`RHO` below). Under ρ a west block at
   * z 24 belongs at z -26 on the east, not at 23. Measured on the built level:
   * NONE of the four had a ρ image among the other three.
   *
   * That is not a cosmetic asymmetry, because DOMINATION NEVER SWAPS ENDS. It
   * put 3.0 m of `collide_concrete` over `FLANK-W-beacon` at level
   * (-52.13, -30) — CA2's shell, and CA2 is `enterable: false`, so it was also
   * a bot-reachability claim `_carveInteriors` cannot honour — while its exact
   * ρ image `FLANK-E-beacon` at (52.13, 27) stood in open sky. Those two are a
   * CORRECT ρ pair (`BEACON_SPOTS` at the foot of this file) and are the map's
   * two MEDICAL POSTS, used by both sides, so one team's dressing station was
   * roofed and the other's was in the open for the whole match.
   *
   * THE BLOCKS MOVED AND THE BEACONS DID NOT, and that is the cheaper of the
   * two repairs by some distance:
   *
   *   - the beacon pair is already correct, and it is stated in three places —
   *     `BEACON_SPOTS`, its `KEEPOUT` circle, and the note over `MEDIC_FEATURES`
   *     in src/match/caches.js, which is not this subsystem's file to edit;
   *   - the only z band of these lanes that is clear of BOTH the west blocks and
   *     the east ones (they are not ρ, so a ρ beacon pair has to dodge four
   *     footprints, not two) runs from z -21.75 to 20.25, i.e. up against the
   *     C and E courtyards — which destroys the depots' entire justification,
   *     "the flank areas that have NO capture point on them";
   *   - a block here is generic in-lane cover. Its authored reason is the lane
   *     width it leaves and `navcheck`, neither of which cares about its z.
   *
   * WEST IS THE MASTER AND EAST IS DERIVED, and that direction is measured too:
   * ρ(CB2) lands a footprint on x -55.13..-52.5, z 23.25..30.75, which is inside
   * the A-LANE TERRACE (`RELIEF.terraces`, x -60..-52.5, z 13.5..25.5) — a
   * building standing half on raised ground. Deriving the other way is clear of
   * both terraces.
   *
   * ONLY CA2 MOVED, from z -19 to -25. The beacon is at z -20 and its own
   * `KEEPOUT` circle is 2.2 units; a face at -21.5 stood 1.5 units away, inside
   * that circle. At -25 the face is at -22.5, 2.5 units (3.75 m of ground) off
   * the crate — and by construction the east post now has exactly the same
   * 3.75 m, which is more than the 3.0 m it had while it was the lucky one.
   */
  { id: 'CA1', x: -25.5, z: 24, w: 4.5, d: 6, floors: 1, groundH: 3.6, wallKey: 'plaster_sand', streetSide: 1, damage: 0.35, parapetH: 0.7, roofProps: 2 },
  { id: 'CA2', x: -25.5, z: -25, w: 4.5, d: 5, floors: 1, groundH: 3.3, wallKey: 'plaster_blue', streetSide: 1, damage: 0.45, parapetH: 0.6, roofProps: 2 },
];
/**
 * The east twins, DERIVED rather than typed, for the reason `pairBuilding` at
 * the foot of this file gives: "a block whose twin is derived cannot drift".
 * They are pushed here rather than authored above so they keep their old
 * position at the end of `BUILDINGS` — the array's order is the dressing dice's
 * order, and re-ordering it re-rolls every interior after the insertion point.
 *
 * `wallKey` is the one thing that is NOT derived. ρ pairs the geometry; the two
 * lanes keeping four different plasters between them is the quality bar's
 * "nothing perfectly repeated", and each east block keeps the colour that stood
 * at ITS end of the east lane before this pass.
 *
 * @see `RHO` / `rhoSide`, both hoisted function declarations so this call site
 * can reach them from above.
 */
for (const [westId, id, wallKey] of [
  ['CA1', 'CB1', 'plaster_pink'],
  ['CA2', 'CB2', 'plaster_cream'],
]) {
  const w = BUILDINGS.find((b) => b.id === westId);
  const [ex, ez] = RHO(w.x, w.z);
  BUILDINGS.push({ ...w, id, x: ex, z: ez, streetSide: rhoSide(w.streetSide), wallKey });
}
/**
 * THERE IS NO BLOCK IN EITHER CROSS STREET, and that is a measured decision.
 * Two were tried, 9 x 4.5 m at 1.5x, flush to the outer kerb so each left a
 * 7.5 m mouth. `navcheck` priced them: the defence's shortest route to site B
 * went from 12.5 m ahead of the attack to 0.6 m BEHIND it, because the cross
 * streets are the rotation and lengthening them is the one thing this map
 * cannot afford. The cover that was going in there is a wrecked lorry and a
 * sandbag run instead — mass to fight behind that a route can still run past.
 */

/**
 * The street terminator at the south end of the vista, now standing behind the
 * defenders' spawn rather than across the middle of the map.
 *
 * This is the surface the eye lands on looking down the mid street, so it is not
 * one flat crenellated slab: it is a mass of four blocks at four different
 * heights, stepped in Z as well as Y, with a pointed archway through the middle
 * and a genuine sliver of sky over the arch that shows the receding roofline of
 * `BS3` behind it. Three planes of depth (bastion / gatehouse / background
 * block) is what makes the street read as continuing rather than as ending at a
 * wall.
 *
 *   xL0..xL1  the left (west) gatehouse block, lowest of the four
 *   xR0..xR1  the right (east) block
 *   xT0..xT1  the tower/bastion, tallest and standing PROUD in +Z
 */
export const GATE = {
  z: -74,
  depth: 3.2,
  span: 5.6,
  height: 4.9,
  outerW: 17,
  /** Height over the arch spandrel — deliberately the LOWEST part of the mass. */
  bodyH: 6.7,
  /** West block. */
  xL0: -8.6,
  xL1: -2.8,
  hL: 7.9,
  /** East block, standing half a metre proud of the arch. */
  xR0: 2.8,
  xR1: 6.1,
  hR: 9.5,
  eastProud: 0.55,
  /**
   * Tower. Standing 1.5 m proud toward the camera matters for a specific
   * reason: at 16:30 the sun is in the level's -X/-Z quadrant, so the whole
   * north elevation of the terminator is in shade and its WEST returns are in
   * full sun. Pushing the tower forward turns that return into a wide sunlit
   * flank facing the camera — two stops brighter than the shaded face beside it,
   * which is the value break the elevation needs.
   */
  xT0: 6.1,
  xT1: 9.4,
  hT: 12.4,
  towerProud: 1.5,
};

/**
 * Hand-placed set pieces. Dressing adds the hundreds of small props around
 * these.
 *
 * The site entries are not decoration. `RULES.plantRadius` is 8 and a plant has
 * to be makeable from cover and a defuse has to be contestable, so each
 * courtyard gets a lorry, two sandbag runs, a barrier and a stall — mid-height
 * mass you can break line of sight behind without being able to hide the C4
 * where nobody can shoot at it.
 */
export const SET_PIECES = {
  /** Market stalls: [x, z, ry, width] */
  stalls: [
    // mid street
    [-3.2, 20.4, 0.08, 2.4],
    [3.4, 17.0, 3.05, 2.6],
    [-3.0, 5.6, -0.05, 2.2],
    [3.0, -12.0, 3.25, 2.2],
    [-3.3, -19.5, 0.12, 2.4],
    [2.9, -30.0, 3.0, 2.3],
    // site A courtyard
    [-33.4, -2.2, 1.55, 2.5],
    [-24.2, -9.4, 0.22, 2.2],
    // site B courtyard
    [33.6, -1.0, -1.6, 2.5],
    [24.0, 1.6, 3.0, 2.2],
    // connectors
    [-11.0, 12.6, 1.62, 2.3],
    [11.4, -5.2, 1.5, 2.3],
    // the lane north runs. Kept south of z 5: at z 8 this stall stood squarely
    // across W2's side-3 doorway — 2.4 m of market stall, 0.9 m tall, 2.4 m out
    // from an opening the player is meant to come through.
    // …and pulled further south again for the same reason K1's containers
    // moved: at 1.5x, W2 and E2's lane faces went from three bays to five and
    // their doors slid to the middle of the face, which is where these were.
    [-22.4, -1.0, 1.5, 2.4],
    [22.6, 0.0, -1.6, 2.4],
    [-29.6, 14.5, -1.6, 2.2],
    [29.8, 21.0, 1.5, 2.2], // was on the B-lane terrace's north ramp
    [-22.5, 26.5, 0.1, 2.4],
    [22.7, 25.5, 3.1, 2.4],
    [-22.5, -2.5, 1.5, 2.3],
    [22.7, -1.5, -1.6, 2.3],
  ],
  /** Jersey barriers: [x, z, ry] */
  jerseys: [
    [-2.6, 29.0, 0.12],
    [2.9, 26.5, -0.1],
    [-2.4, 10.6, 0.05],
    [1.6, -2.0, 1.62],
    [3.2, -18.0, 0.1],
    [-1.0, -24.0, 1.55],
    [1.2, -30.5, 0.2],
    // sites: a barrier across each courtyard's north mouth
    [-26.4, 1.4, 0.06],
    [-22.6, -3.4, 1.57],
    [26.8, 1.2, -0.05],
    [22.6, -4.2, 1.57],
    // lanes: something to break the run
    [-27.5, 17.0, 1.5], // stands on the A-lane terrace's north lip
    [27.8, 14.0, 1.5],
    [-25.2, -19.5, 0.1],
    [25.4, -20.5, 0.1],
    // ---- 1.5x: the same fifteen barriers in 2.25x the ground is a third
    // emptier than the map this was tuned on. These put the density back.
    [-24.5, 30.0, 0.1],
    [24.7, 29.0, -0.1],
    [-28.5, 0.5, 1.55],
    [28.7, 1.5, 1.55],
    [-23.0, -15.0, 0.1],
    [23.2, -16.0, 0.1],
    [-16.5, 12.5, 0.1],
    [16.7, -5.5, 0.1],
  ],
  /** Sandbag emplacements: [x, z, ry, length] */
  sandbagWalls: [
    [-3.6, 27.0, 0.0, 3.0],
    [3.6, -1.6, 0.0, 2.6],
    [-1.6, -20.5, 1.57, 2.4],
    [3.4, -29.0, 0.0, 3.2],
    // site A: one run facing the north mouth, one facing the connector
    [-30.4, 0.4, 0.0, 3.4],
    [-23.8, -8.2, 1.57, 3.0],
    // site B
    [30.6, -0.2, 0.0, 3.4],
    [23.6, -8.6, 1.57, 3.0],
    // the cross streets, where each side steps out of spawn
    [-16.0, 28.6, 0.0, 3.0],
    [16.2, -30.4, 0.0, 3.0],
    // the long north runs, which need something to break a 29 m sightline
    [-24.6, 15.5, 1.57, 3.2],
    [24.8, 13.0, 1.57, 3.2],
    [-29.8, 7.5, 0.0, 2.8],
    [29.9, 9.5, 0.0, 2.8],
    // ---- 1.5x cover ----
    [-27.0, -15.5, 0.0, 3.0],
    [27.2, -16.5, 0.0, 3.0],
    [-12.5, 28.5, 0.0, 3.0],
    [12.7, -30.5, 0.0, 3.0],
    [-4.0, 14.5, 0.0, 2.6],
    [4.2, -16.5, 0.0, 2.6],
  ],
  /** Burnt-out vehicles: [x, z, ry, rollDeg] */
  wrecks: [
    [2.5, 22.0, 0.42, 0],
    [-2.8, -33.0, -2.6, 4],
    // the lorry in each site: the biggest single piece of cover on the map, and
    // the thing that makes a plant behind it survivable. Parked against the
    // west wall of each courtyard, clear of the KEEPOUT circle.
    [-32.4, -7.2, 0.28, 0],
    [32.6, -6.8, -0.34, 2],
    // one on each lane, blocking the long run
    [-25.8, 24.0, 1.42, 0],
    [26.2, 22.5, 1.5, 0],
    // ---- 1.5x cover. The two in the cross streets are what replaces the
    // blocks that were tried there: hard cover that a rotation runs past
    // rather than around.
    [-22.5, 6.5, 1.4, 0],
    [22.7, 7.5, 1.5, 3],
    [-14.5, 29.0, 0.3, 0],
    [14.7, -31.0, -0.4, 2],
  ],
  /** Palm trees: [x, z, scale] */
  palms: [
    [-5.4, 20.0, 1.0],
    [5.5, 6.5, 1.1],
    [-5.5, -4.5, 0.92],
    [5.6, -20.5, 1.05],
    [-5.5, -32.0, 1.0],
    [-22.4, -1.2, 0.95],
    [22.6, -2.4, 0.9],
    [-33.4, -10.4, 1.05], // was under the site A deck
    [34.4, 1.0, 1.0],
    [-29.4, 10.0, 0.88], // stands ON the A-lane terrace
    [29.6, 8.0, 0.92], // stands ON the B-lane terrace
    [-27.0, -19.0, 1.0],
    [27.2, -18.0, 0.95],
    [-17.0, 30.5, 1.0],
    [17.2, -32.5, 1.0],
  ],
  /** Street lamps: [x, z, ry] — ry points the arm across the street. */
  lamps: [
    [-5.9, 27.0, -Math.PI / 2],
    [5.9, 11.0, Math.PI / 2],
    [-5.9, -6.0, -Math.PI / 2],
    [5.9, -22.0, Math.PI / 2],
    [-5.9, -36.0, -Math.PI / 2],
    [-30.6, -10.4, -Math.PI / 2],
    [30.8, -10.0, Math.PI / 2],
    [-30.4, 20.0, -Math.PI / 2],
    [30.6, 18.0, Math.PI / 2],
  ],
  /** Overhead cable spans: [x0, y0, z0, x1, y1, z1, sag] */
  cables: [
    [-6.4, 7.2, 21.0, 6.4, 6.6, 23.5, 1.1],
    [-6.4, 8.4, 4.0, 6.4, 7.9, 5.5, 1.4],
    [-6.4, 6.2, -18.0, 6.4, 6.6, -16.5, 1.0],
    [-6.4, 7.6, -30.0, 6.4, 7.2, -28.0, 1.2],
    // across each lane, which is what gives a 30 m corridor a ceiling
    [-20.6, 6.8, 16.0, -30.9, 6.2, 18.0, 1.2],
    [-20.6, 6.4, -14.0, -30.9, 6.8, -16.5, 1.1],
    [20.6, 6.6, 14.0, 30.9, 6.2, 16.5, 1.2],
    [20.6, 6.2, -16.0, 30.9, 6.6, -18.5, 1.1],
    [-20.6, 5.8, -3.0, -35.9, 5.4, -5.5, 1.6],
    [20.6, 5.8, -2.0, 35.9, 5.4, -4.5, 1.6],
  ],
  /** Laundry lines with hanging cloth: [x0, y0, z0, x1, y1, z1] */
  laundry: [
    // Kept off the main sightline and up at balcony height: lines that cross the
    // street at eye level clutter the vista and read as floating cards.
    [6.35, 3.6, 20.0, 6.35, 3.75, 23.5],
    [-6.35, 3.7, 4.0, -6.35, 3.6, 8.0],
    [-6.35, 6.6, -22.5, -6.35, 6.4, -17.5],
    [6.35, 6.5, -20.0, 6.35, 6.7, -15.0],
    [-20.65, 3.65, 0.0, -20.65, 3.8, 5.0],
    [20.65, 3.7, 0.5, 20.65, 3.6, 5.5],
    [-20.65, 6.2, -14.0, -20.65, 6.4, -19.0],
    [20.65, 6.2, -13.0, 20.65, 6.4, -18.0],
  ],
  /** Hanging rugs / cloth on facades: [x, y, z, ry, w, h] */
  hangings: [
    [-6.45, 2.6, 6.5, Math.PI / 2, 1.5, 2.1],
    [-6.45, 2.4, 20.5, Math.PI / 2, 1.2, 1.7],
    [6.45, 2.7, 6.0, -Math.PI / 2, 1.6, 2.2],
    [6.45, 2.5, -18.5, -Math.PI / 2, 1.3, 1.9],
    [-20.55, 2.5, 2.0, -Math.PI / 2, 1.4, 2.0],
    [20.55, 2.5, 2.5, Math.PI / 2, 1.4, 2.0],
    [-20.55, 2.6, -14.5, -Math.PI / 2, 1.3, 1.9],
    [20.55, 2.6, -15.5, Math.PI / 2, 1.3, 1.9],
  ],
  /** Rubble piles: [x, z, radius, count] */
  rubble: [
    // Pulled south-east off W3's side-1 doorway: a 2.4 m mound centred 2.1 m
    // from the opening spilled concrete right across the threshold. `keepClear`
    // only tests a pile's CENTRE, so a mound can still reach into a doorway the
    // test says it is clear of — give the authored ones room.
    [-3.4, -25.4, 2.4, 34],
    [5.0, -16.5, 2.8, 40],
    [-4.6, -47.5, 2.0, 26],
    [-5.0, 28.0, 1.6, 18],
    // sites: a collapsed corner in each, which is cover AND a reason the wall
    // behind it is broken
    [-34.6, 1.2, 2.6, 36],
    [34.8, -9.2, 2.6, 36],
    [-28.0, -22.0, 2.2, 26],
    [28.2, -23.0, 2.2, 26],
    [-29.4, 24.5, 2.4, 30], // clear of the A-lane terrace's north ramp
    [29.6, 21.5, 2.4, 30],
    [-23.0, 21.5, 2.2, 26],
    [23.2, 20.5, 2.2, 26],
    [-11.5, -30.5, 2.0, 24],
    [11.7, 27.5, 2.0, 24],
  ],
  /** Tyre stacks: [x, z, n] */
  tyres: [
    [-5.2, 14.5, 4],
    [5.3, -8.0, 3],
    [6.2, 3.0, 5],
    [-5.4, -30.0, 3],
    [-32.0, -9.4, 4],
    [32.2, 2.2, 4],
    [-21.6, 12.0, 3],
    [21.8, -6.0, 3],
    [-30.2, 26.5, 5],
    [30.4, 25.0, 4],
    [-21.4, 20.0, 3],
    [21.6, 18.5, 4],
    [-29.5, -14.0, 4],
    [29.7, -15.0, 3],
    [-22.0, 28.5, 4],
    [22.2, 27.5, 3],
    [-4.8, 24.0, 3],
    [4.9, -26.0, 4],
  ],
};

/* ========================================================================== */
/* THE MAP GROWS — PART 1: THE MID STREET IS PRISED OPEN                      */
/* ========================================================================== */
/**
 * "マップが狭いです、もっと広くして もっと作り込み広くしてほしい".
 *
 * The map was 1.5x already and it was still narrow, because 1.5x is a uniform
 * scale: the mid street went from 13 m to 19.5 m of ground and stayed the same
 * SHAPE, a corridor with a shed in it. What the middle of this map actually
 * needed was room for a building — see part 3 — and there was none, because the
 * two rows of shops stand ON the kerb line at level x ∓6.5.
 *
 * So the street is prised open and everything outside it moves out with it. This
 * is a TRANSFORM for the same reason the 1.5x below is one, and the reason is
 * worth restating: every adjacency in this plan is exact. `ALLEYS`'s A lane runs
 * x -31..-20.5 because -20.5 is W1/W2/W3's outer face and -31 is BW1's inner
 * face; the courtyard bulges to -36 because -36 is BW2's inner face; the north
 * gatehouse sits at -29.2 because that is flush to the kerb. Retyping ninety
 * literals would break some subset of that silently.
 *
 *   |x| <= WB    x * WK      the street itself, stretched
 *   |x| >  WB    x + 9       everything outside it, translated
 *
 * `WK` is chosen so the two branches AGREE at `WB` (`WB * WK === WB + SPREAD`),
 * so the map is continuous and nothing lands in a seam. Translating the outside
 * is what preserves every adjacency: two faces that met still meet, because both
 * moved by the same 9. Stretching the inside is what keeps the things authored
 * ON the street — the kerb-line lamps, the facade hangings, the laundry lines,
 * the median props — at the same fraction of it.
 *
 * WB IS 6.2 AND NOT 6.5 ON PURPOSE. The hangings are at x ∓6.45 and the cables
 * and laundry at ∓6.35/6.40, i.e. bolted to a facade at ∓6.5. Put the breakpoint
 * at 6.5 and they stretch to 13.87 against a wall at 15.5 — 2.4 m of daylight
 * behind a rug that is nailed to a house. At 6.2 they are past the breakpoint,
 * translate with the wall they hang on, and stay 0.05-0.15 out from it.
 *
 * WHAT IT COSTS: the mid street goes from 19.5 m to 46.5 m of ground, the map
 * from 132 m to 189 m across, and NOTHING ELSE MOVES RELATIVE TO ANYTHING ELSE.
 * Re-run `navcheck`, `lanecheck`, `sitecheck` and `boundcheck`.
 *
 * IT IS ALSO REPEATED IN `src/match/airstrike.js`, which authors eight anchors
 * on facades in this same space and would otherwise drop all eight — see the
 * note there. `src/match/sites.js` does NOT need it: all three zones and both
 * spawn clusters are on the centreline now, where `widenX` is the identity.
 */
export const SPREAD = 9.0;
const WB = 6.2;
const WK = 1 + SPREAD / WB;

/** The transform. Exported so the tools and `airstrike` can agree with it. */
export function widenX(x) {
  const a = x < 0 ? -x : x;
  return a <= WB ? x * WK : x + (x < 0 ? -SPREAD : SPREAD);
}

const wRect = (r) => { r[0] = widenX(r[0]); r[2] = widenX(r[2]); };

STREET.halfWidth = widenX(STREET.halfWidth);
STREET.kerb = widenX(STREET.kerb);

for (const a of ALLEYS) wRect(a.rect);
for (const f of FLAT) wRect(f);
for (const t of RELIEF.terraces) wRect(t.rect);
for (const d of RELIEF.decks) wRect(d.rect);
for (const b of RELIEF.blocks) wRect(b.rect);
for (const k of KEEPOUT) k[0] = widenX(k[0]);
// A sitework's WIDTH is a piece of masonry and does not stretch; only where it
// stands does. Same rule as a building's `w`.
for (const p of SITEWORKS) p.x = widenX(p.x);
for (const b of BUILDINGS) b.x = widenX(b.x);
// The gate spans the street, so its plan follows it. `span` is xR0 - xL1 and
// both of those are inside WB, so it stretches by WK rather than translating.
for (const k of ['xL0', 'xL1', 'xR0', 'xR1', 'xT0', 'xT1', 'outerW']) GATE[k] = widenX(GATE[k]);
GATE.span *= WK;
for (const key of ['stalls', 'jerseys', 'sandbagWalls', 'wrecks', 'palms', 'lamps', 'tyres', 'rubble']) {
  for (const p of SET_PIECES[key]) p[0] = widenX(p[0]);
}
// [x0, y0, z0, x1, y1, z1, …] — both ends, and the y's are facade heights.
for (const p of SET_PIECES.cables) { p[0] = widenX(p[0]); p[3] = widenX(p[3]); }
for (const p of SET_PIECES.laundry) { p[0] = widenX(p[0]); p[3] = widenX(p[3]); }
for (const p of SET_PIECES.hangings) p[0] = widenX(p[0]);

/* ========================================================================== */
/* THE MAP GROWS — PART 2: A BASE DISTRICT AT EACH END                        */
/* ========================================================================== */
/**
 * "それぞれの拠点から近いところにエリアを作り、中央部に１つさらに設置して そうすることで
 *  自陣プラス中央部を取るようになるので" — and the reason this needed 24 units of new
 * map at each end rather than just moving two circles.
 *
 * The three zones used to sit on the equidistant line at level z 0, 42.2 m
 * apart, for a reason `src/match/sites.js` still explains at length: domination
 * never swaps sides, so any route advantage becomes permanent. The player's
 * answer to that is better than the old one — give each side a zone of its OWN
 * next to its OWN base and make the middle the thing worth fighting over — and
 * it needs the bases to be somewhere. The spawns were at z ∓39.4, which is
 * INSIDE the play box, three metres behind the last cross street; there was
 * nowhere to put a zone "near the base" that was not already the base.
 *
 * So both ends of the street grow. The spawn clusters go out to z ∓64.5/-66.5,
 * a row of three blocks goes in between each spawn and its plaza (two mouths
 * 6.7 units wide, so nobody is spawn-trapped behind one door), and the ZONE goes
 * in the plaza the two big cross-street blocks already framed: zone A between W5
 * and E5 at level (0, 38), zone B between W4 and E4 at (0, -40).
 *
 *   zone -> its own base   26.5 units = 39.8 m, IDENTICAL for both sides
 *   zone -> the cathedral  39 units   = 58.5 m, identical for both
 *   zone -> zone           78 units   = 117 m
 *
 * against 42.2 / 42.2 / 84.3 m before. Everything below is authored in WIDENED
 * space, because it is appended AFTER the transform above — the district is new
 * ground and has no old adjacency to preserve.
 *
 * Both districts are enclosed by `buildCordon`, and for free: `cordonRuns()`
 * derives its runs from `STREET.kerb` and from W5/E5/W4/E4's outer faces and the
 * gate, all of which moved, so the compound walls follow the street to its new
 * ends without a line changing in `src/world/cordon.js`.
 */
BUILDINGS.push(
  /* ---- NORTH: the attack's district ------------------------------------- */
  { id: 'N1', x: -12.5, z: 54, w: 6, d: 8, floors: 2, wallKey: 'plaster_sand', streetSide: 0, secondarySide: 1, damage: 0.4, balconies: 0.35, doorBays: { 0: 1 }, roofProps: 4 },
  /**
   * N2 and S2 are K1 and K2's replacements, and they are those two buildings'
   * specs verbatim (footprint, storey height, door bays, through route, room
   * plan) with a new position and a new coat of plaster. That is deliberate:
   * every one of those numbers is a configuration `indoorcheck` and
   * `throughcheck` already pass on — a 3-bay face whose bay-0 door lines up with
   * the bay-1 door opposite, and a straight route between them past the end of
   * the counter — and inventing a new one to prove again would be inventing a
   * new way to fail. The mantle ladder onto each roof comes with them, below.
   */
  { id: 'N2', x: 0, z: 54, w: 5.4, d: 5.4, floors: 1, groundH: 3.2, wallKey: 'plaster_cream', streetSide: 0, secondarySide: 2, damage: 0.3, doorBays: { 0: 0, 2: 1 }, parapetH: 0.6, enterable: true, roofProps: 2,
    route: [['s0', [0.21, 0.25], [0.21, 0.75], 's2']],
    /**
     * THE COUNTER IS ON THE EAST THIRD ONLY, and that is `throughcheck` talking.
     * K1 and K2 furnished the whole room and got away with it; S2 with the same
     * plan did not — its side-0 door opened into an 0.5 m pocket in front of the
     * counter and BOTH its exits came back a dead end, which is the exact
     * failure ("W1 and W2 had BOTH doors opening into a pocket behind a shop
     * counter") the `route` mechanism exists to prevent. `buildInterior` only
     * keeps proxies 0.85 m off the declared line, and the two doors here are at
     * x-fractions 0.167 and 0.5, so anything from 0 to 0.62 is on somebody's
     * threshold. Furnish from 0.62 out and the corridor cannot be closed by a
     * roll of the dice.
     */
    rooms: [{ walls: [], furnish: [{ kind: 'shop', x0: 0.62, z0: 0.0, x1: 1.0, z1: 1.0 }] }] },
  { id: 'N3', x: 12.5, z: 54, w: 6, d: 8, floors: 2, wallKey: 'plaster_blue', streetSide: 0, secondarySide: 3, damage: 0.4, balconies: 0.35, doorBays: { 0: 1 }, roofProps: 4 },

  /* ---- SOUTH: the defence's district ------------------------------------ */
  { id: 'S1', x: -12.5, z: -56, w: 6, d: 8, floors: 2, wallKey: 'plaster_pink', streetSide: 2, secondarySide: 1, damage: 0.45, balconies: 0.3, doorBays: { 2: 1 }, roofProps: 4 },
  /**
   * S2 IS SOLID, AND THAT IS A RETREAT I AM WRITING DOWN RATHER THAN HIDING.
   *
   * It was authored `enterable`, first with K2's spec and then with N2's — the
   * SAME numbers as the block twenty metres up the map that passes — and on six
   * consecutive boots BOTH its exits came back a dead end while N2 passed every
   * time. `throughcheck --map` says what the shape of it is: the room floods
   * clean from the side-2 door to every corner, and a band the full width of the
   * plan and 0.88 m deep stands 1.1 m inside the side-0 wall, so that door opens
   * into a pocket the capsule cannot leave. That is the exact failure the
   * `route` mechanism exists to prevent ("W1 and W2 had BOTH doors opening into
   * a pocket behind a shop counter"), and it survived moving the furnish out to
   * the east third, swapping `streetSide`, swapping `secondarySide` and changing
   * the footprint. Probed by hand at 0.5 m intervals across that band, every ray
   * is clear floor at 0.14 m with the roof 2.75 m over it — so whatever the
   * capsule is catching on is not something a ray finds, and I did not find it.
   *
   * Shipping a building whose front door is a cul-de-sac is worse than shipping
   * one you cannot enter, so it is a solid block: the district keeps its two
   * mouths and its silhouette, N2 keeps the interior on the other side of the
   * map, and the indoor fighting this pass is actually about is in a 30 x 45 m
   * cathedral with 1331 bot-walkable cells in it. The gate is honest again and
   * the deficiency is one shed.
   */
  { id: 'S2', x: 0, z: -56, w: 5.4, d: 5.4, floors: 1, groundH: 3.2, wallKey: 'plaster_blue', streetSide: 0, secondarySide: 2, damage: 0.3, doorBays: { 0: 0, 2: 1 }, parapetH: 0.6, roofProps: 2 },
  { id: 'S3', x: 12.5, z: -56, w: 6, d: 8, floors: 2, wallKey: 'plaster_sand', streetSide: 2, secondarySide: 3, damage: 0.45, balconies: 0.3, doorBays: { 2: 1 }, roofProps: 4 }
);

/**
 * The mantle chain onto N2's and S2's roofs, K1's and K2's verbatim and for the
 * same reason: `tools/floorcheck.mjs` floods the real player capsule over the
 * level and an `enterable` block whose roof it cannot reach is a cul-de-sac it
 * reports. Ground -> 1.4/1.45 -> 2.6/2.7 -> the 3.2/3.3 m parapet, every rung
 * under `MOVE.mantle.maxHeight` = 1.85. Kept off the door bay (both doors are on
 * the west half of their face) and out of the spawn ranks' 1.95 m.
 */
RELIEF.blocks.push(
  { id: 'N2 step 2', rect: [1.3, 56.75, 2.85, 58.05], h: 2.6, key: 'metal_green' },
  { id: 'N2 step 1', rect: [1.3, 58.05, 2.8, 59.65], h: 1.4, key: 'metal_blue' },
  /** S2 is solid now, so its roof is nobody's business and its ladder is gone. */
  { id: 'S row step 2', rect: [-2.85, -53.25, -1.3, -51.95], h: 2.6, key: 'metal_blue' },
  { id: 'S row step 1', rect: [-2.8, -51.95, -1.3, -50.35], h: 1.4, key: 'metal_green' }
);

/**
 * THE MASS ON THE TWO NEW POINTS.
 *
 * A zone in the middle of a 46.5 m street is the "剥き出し" failure the whole
 * `SITEWORKS` table was written to fix, and these two are worse off than the old
 * courtyards were: a courtyard at least has walls. `sitecheck` counts mass
 * 0.9-2.8 m over the zone floor inside the 8 m circle and wants 12 m² of it and
 * six standing-cover points, so each plaza gets six pieces in the same 3.2-5.0
 * authored band the courtyard pieces use — outside `standRing`'s 4 m forward
 * spawn ring, inside the capture circle:
 *
 *   two SCREENS on the arc the CENTRE is approached from, so the side rotating
 *     up from the cathedral cannot read the point off the street;
 *   two PLINTHS east and west, waist-high mass ON the point;
 *   one WALL on the base side, which is what a side retakes its own point from;
 *   one PIER at 2.95 m — over the cover line on purpose, a chokepoint splitting
 *     the 46.5 m frontage rather than cover on the point.
 *
 * Nothing spans more than 3.6 units of a 31-unit street, so A* crosses every one
 * of them. `navcheck` is the gate.
 */
/**
 * …AND THEY MOVED WITH THEIR POINTS. Both plaza zones came off the centreline in
 * the same pass the districts went in — zone A to widened (-10, 40), zone B to
 * (10, -42) — so every piece here is shifted by the same (-10, +2) / (+10, -2).
 * Move a zone without moving these and the mass ends up in the ring rather than
 * on the point: `sitecheck` counts nothing outside the 8 m circle.
 */
SITEWORKS.push(
  { id: 'A screen west', kind: 'wall', x: -12.6, z: 36.6, w: 2.6, d: 0.6, h: 1.6, key: 'brick', revet: true },
  { id: 'A screen east', kind: 'wall', x: -7.4, z: 36.6, w: 2.6, d: 0.6, h: 1.6, key: 'brick', revet: true },
  { id: 'A plinth west', kind: 'plinth', x: -13.9, z: 40.0, w: 1.9, d: 1.6, h: 1.3, key: 'concrete' },
  { id: 'A plinth east', kind: 'plinth', x: -6.1, z: 40.0, w: 1.9, d: 1.6, h: 1.3, key: 'concrete' },
  { id: 'A retake wall', kind: 'wall', x: -10.0, z: 43.8, w: 3.6, d: 0.6, h: 1.45, key: 'plaster_blue', revet: true },
  { id: 'A pier', kind: 'pier', x: -10.0, z: 34.8, w: 2.4, d: 2.4, h: 2.95, key: 'concrete' },

  { id: 'B screen west', kind: 'wall', x: 7.4, z: -38.4, w: 2.6, d: 0.6, h: 1.6, key: 'brick', revet: true },
  { id: 'B screen east', kind: 'wall', x: 12.6, z: -38.4, w: 2.6, d: 0.6, h: 1.6, key: 'brick', revet: true },
  { id: 'B plinth west', kind: 'plinth', x: 6.1, z: -42.0, w: 1.9, d: 1.6, h: 1.3, key: 'concrete' },
  { id: 'B plinth east', kind: 'plinth', x: 13.9, z: -42.0, w: 1.9, d: 1.6, h: 1.3, key: 'concrete' },
  { id: 'B retake wall', kind: 'wall', x: 10.0, z: -45.8, w: 3.6, d: 0.6, h: 1.45, key: 'plaster_pink', revet: true },
  { id: 'B pier', kind: 'pier', x: 10.0, z: -36.6, w: 2.4, d: 2.4, h: 2.95, key: 'concrete' }
);

/**
 * And the districts get dressed like the rest of the map rather than left as
 * two lots of tarmac — "もっと作り込み". All in widened space.
 */
SET_PIECES.stalls.push(
  [-8.2, 47.0, 1.5, 2.4], [8.4, 46.0, -1.6, 2.4],
  [-8.4, -49.0, 1.5, 2.4], [8.6, -48.0, -1.6, 2.4],
  [-11.0, 61.5, 0.1, 2.3], [11.2, -63.5, 3.1, 2.3],
  [-13.6, 30.0, 1.5, 2.2], [13.8, -32.0, -1.6, 2.2]
);
SET_PIECES.jerseys.push(
  [-7.0, 44.6, 0.1], [7.2, 44.6, -0.1], [-7.0, -46.6, 0.1], [7.2, -46.6, -0.1],
  [-13.0, 51.0, 1.55], [13.2, 51.0, 1.55], [-13.0, -53.0, 1.55], [13.2, -53.0, 1.55],
  [-6.6, 58.5, 0.1], [6.8, -60.5, 0.1]
);
SET_PIECES.sandbagWalls.push(
  [-6.4, 36.5, 1.57, 3.0], [6.6, 36.5, 1.57, 3.0],
  [-6.4, -38.5, 1.57, 3.0], [6.6, -38.5, 1.57, 3.0],
  [-10.5, 58.0, 0.0, 3.2], [10.7, -60.0, 0.0, 3.2],
  [-13.8, 66.0, 0.0, 2.8], [13.9, -68.0, 0.0, 2.8]
);
SET_PIECES.wrecks.push(
  [-11.5, 42.0, 1.4, 0], [11.7, -44.0, 1.5, 3],
  [-12.8, 63.0, 0.3, 0], [12.9, -65.0, -0.4, 2],
  [-13.2, 20.0, 1.45, 0], [13.4, -22.0, 1.5, 2]
);
SET_PIECES.palms.push(
  [-9.8, 44.0, 1.0], [9.9, -46.0, 1.0],
  [-13.4, 56.0, 0.95], [13.5, -58.0, 0.95],
  [-14.0, 8.0, 1.05], [14.1, -10.0, 1.0]
);
SET_PIECES.lamps.push(
  [-14.9, 46.0, -Math.PI / 2], [14.9, 40.0, Math.PI / 2],
  [-14.9, -48.0, -Math.PI / 2], [14.9, -42.0, Math.PI / 2],
  [-14.9, 62.0, -Math.PI / 2], [14.9, -64.0, Math.PI / 2],
  [-14.9, 16.0, -Math.PI / 2], [14.9, -18.0, Math.PI / 2]
);
SET_PIECES.rubble.push(
  [-13.0, 47.5, 2.4, 30], [13.2, -49.5, 2.4, 30],
  [-9.0, 67.0, 2.0, 24], [9.2, -69.0, 2.0, 24],
  [-14.2, 26.0, 2.2, 26], [14.4, -28.0, 2.2, 26]
);
SET_PIECES.tyres.push(
  [-12.2, 45.0, 4], [12.4, -47.0, 4],
  [-8.0, 59.0, 3], [8.2, -61.0, 3],
  [-14.4, 12.0, 4], [14.6, -14.0, 3]
);

/* ========================================================================== */
/* THE MAP GROWS — PART 4: TWO CORNER DISTRICTS, AND THE ZONES GO IN THEM      */
/* ========================================================================== */
/**
 * "ドミねーとする場所が一っ直線に並んでるでしょ？ そうするとマップの左右側に行くメリット
 *  ないから改善してほしい"
 * "ドミねーとする場所は大聖堂挟んで対角になるように配置、物理的に距離をもっと空けて、
 *  つまりマップの左右、大聖堂ではないエリアにドミネーションするエリアを配置して"
 *
 * THE THREE ZONES WERE ALL AT LEVEL x 0. The north plaza, the cathedral crossing
 * and the south plaza — one line straight down the middle of the map, which is
 * exactly what the player measured by eye: every route worth walking was the mid
 * street, and the two lanes, the two courtyards and the four cross-street arms
 * were 40 % of the map's ground with nothing on it.
 *
 * WHERE THEY GO, and why it takes new ground. The requirement has three parts —
 * DIAGONALLY OPPOSITE about the cathedral, FURTHER APART, and NOT in the
 * cathedral — and one of them is not free:
 *
 *   Zone C has to stay on the line equidistant from the two bases. `SPAWNS` in
 *   src/match/sites.js are at level z 64.5 and -66.5, so that line is z -1, and a
 *   third zone anywhere off it hands one side a permanent lead — domination never
 *   swaps ends, which is the whole argument the header of that file is built on.
 *   Off the centreline and on that line there are exactly two places: the two
 *   courtyards. C is the WEST one.
 *
 *   Zones A and B are a 180° pair about the cathedral centre (level 0, -1), so
 *   whatever route advantage one side has to A, the other has to B. The furthest
 *   such pair on the OLD ground is the two lane ends at z ∓28, and that puts A
 *   only 29 units from C — 43 m, which is LESS than the 58.5 m the player was
 *   already calling too close.
 *
 * So the two corners the map never had get built: a district west of W5 and north
 * of it, and its exact point-image east of E4 and south of it. `BW1` and `BE3`
 * were the infill standing in them and are 20 units shorter each (see their
 * entries above).
 *
 *   ρ(x, z) = (-x, -2 - z)   the 180° rotation about the cathedral centre.
 *   Every rect, every block and every piece of mass below is authored as a pair
 *   under ρ, so the two districts are the same district played from both ends.
 *
 *              level (widened)     from N base    from S base    to the others
 *   ZONE A       (-38,  51)          53 units       184 units     C 40, B 124
 *   ZONE C       (-37,  -1)          75 units        75 units     A 40, B 94
 *   ZONE B       ( 38, -53)         184 units        53 units     C 94, A 124
 *
 *   x1.5 for metres: A-B 186 m (was 117), A-C 60 m (was 58.5), B-C 141 m (was
 *   58.5). Bearings from the cathedral: A 140.9°, C 180.0°, B -39.1° — A and B
 *   are 180.0° apart, which is what "大聖堂挟んで対角" asks for exactly.
 *
 * EVERY DISTRICT HAS TWO MOUTHS, because a capture point in a one-door pocket is
 * a point you cannot retake:
 *   - the LANE mouth: 11 units of open frontage where the district meets the west
 *     lane and the north cross street (and 8 where the east one meets the south
 *     cross), i.e. where BW1/BE3 used to stand;
 *   - the BASE mouth: a 5-unit gate cut in the compound wall behind each spawn.
 *     @see `cordonRuns()` in src/world/cordon.js, which is where that gap lives.
 */
BUILDINGS.push(
  /* ---- the north-west district: zone A ---------------------------------- */
  /**
   * NW1 WAS THE MAP EDGE ON THIS SIDE AND IS NOW A CITY BLOCK WITH A STREET
   * BEHIND IT. @see `THE MAP GROWS — PART 6` at the foot of this file.
   *
   * It ran z 19..58 as one 39-unit slab with `skipSides: [3]` — its west face
   * was never built, because nothing could ever stand there to see it. The WEST
   * CITY stands there now, so the face is built, the block is cut into two with
   * a cross street between them (`NW6` carries the north half), and the two
   * openings that leaves are the district's two mouths. Its south end is pulled
   * down to z 15 so it seals the strip x -70..-60 against BW2's north face
   * rather than leaving 14 units of dune behind the row.
   */
  { id: 'NW1', x: -65, z: 24, w: 10, d: 20, floors: 3, wallKey: 'plaster_blue', streetSide: 1, secondarySide: 3, damage: 0.25, balconies: 0.25, doorBays: { 3: 1 }, roofProps: 3 },
  /** The two blocks that close the district's north side. They meet flush at
   *  x -34 and NW3's east face is inside the compound wall's own thickness, so
   *  the boundary is continuous from the map edge to the spawn's wall. */
  { id: 'NW2', x: -47, z: 63, w: 26, d: 10, floors: 2, wallKey: 'plaster_cream', streetSide: 0, secondarySide: 1, damage: 0.3, balconies: 0.3, doorBays: { 0: 1 }, roofProps: 3 },
  { id: 'NW3', x: -25, z: 63, w: 18, d: 10, floors: 2, wallKey: 'plaster_sand', streetSide: 0, secondarySide: 3, damage: 0.35, balconies: 0.25, doorBays: { 0: 1 }, roofProps: 3 },
  /** Two single-storey blocks standing IN the district: the throat is 16.5 m of
   *  frontage and the yard is 66 m long, so without these the walk in is one
   *  straight line and the zone is read off it from 50 m. Not `enterable` — a
   *  solid block is honest cover and adds nothing for the interior gates to
   *  prove. Both are kept 6 units clear of the zone centre so they stand outside
   *  its 8 m circle. */
  { id: 'NW4', x: -46, z: 30, w: 7, d: 8, floors: 1, groundH: 3.5, wallKey: 'plaster_pink', streetSide: 1, damage: 0.4, parapetH: 0.7, roofProps: 2 },
  { id: 'NW5', x: -28, z: 50, w: 8, d: 7, floors: 1, groundH: 3.3, wallKey: 'plaster_cream', streetSide: 3, damage: 0.45, parapetH: 0.6, roofProps: 2 },

  /* ---- the south-east district: zone B, ρ of the above ------------------ */
  /** ρ(NW1) exactly, and cut in the same two places for the same reason. */
  { id: 'SE1', x: 65, z: -26, w: 10, d: 20, floors: 3, wallKey: 'plaster_pink', streetSide: 3, secondarySide: 1, damage: 0.25, balconies: 0.25, doorBays: { 1: 1 }, roofProps: 3 },
  { id: 'SE2', x: 47, z: -65, w: 26, d: 10, floors: 2, wallKey: 'plaster_sand', streetSide: 2, secondarySide: 3, damage: 0.3, balconies: 0.3, doorBays: { 2: 1 }, roofProps: 3 },
  { id: 'SE3', x: 25, z: -65, w: 18, d: 10, floors: 2, wallKey: 'plaster_blue', streetSide: 2, secondarySide: 1, damage: 0.35, balconies: 0.25, doorBays: { 2: 1 }, roofProps: 3 },
  { id: 'SE4', x: 46, z: -32, w: 7, d: 8, floors: 1, groundH: 3.5, wallKey: 'plaster_cream', streetSide: 3, damage: 0.4, parapetH: 0.7, roofProps: 2 },
  { id: 'SE5', x: 28, z: -52, w: 8, d: 7, floors: 1, groundH: 3.3, wallKey: 'plaster_pink', streetSide: 1, damage: 0.45, parapetH: 0.6, roofProps: 2 }
);

/**
 * The district GROUND. Two rects each, an L wrapping the corner block: the leg
 * beside the lane (where BW1 / BE3 used to be) and the leg behind the cross
 * street's own block, which is where the zone stands.
 *
 * These are what makes the ground AUTHORED. `tools/boundcheck.mjs` calls a cell
 * the player can reach VOID when the collision under it is bare `sand` and it is
 * outside every authored rect, and the player has twice sent a screenshot of
 * exactly that — so a district is a surface and a set of walls in the same commit
 * as the capture point that stands on it, never one without the other.
 */
ALLEYS.push(
  { rect: [-60, 21, -39.5, 44], surface: 'dirt', density: 0.35 },   // NW throat
  { rect: [-60, 44, -15.5, 58], surface: 'gravel', density: 0.4 },  // NW yard — ZONE A
  { rect: [39.5, -46, 60, -23], surface: 'dirt', density: 0.35 },   // SE throat
  { rect: [15.5, -60, 60, -46], surface: 'gravel', density: 0.4 }   // SE yard — ZONE B
);

/** …and the terrain under them is flattened, with the soft shoulder `buildGround`
 *  puts on every FLAT rect, so the dunes still carry the far ground behind the
 *  new blocks. A capture point on ±0.55 m of fbm is a capture point where your
 *  crosshair sits on a hill. */
FLAT.push(
  [-62, 19, -14, 60],
  [14, -62, 62, -21]
);

/**
 * The three ZONE circles and the three BEACON squares, as ground no
 * collision-bearing prop may be dressed onto. Radius 3.0 for a zone (4.5 m of
 * ground) is sized to `standRing`'s 4 m forward-spawn ring exactly as the old
 * ones were; 2.2 for a beacon clears the 1.7 m painted square plus a capsule.
 *
 * Zone C's circle is in the pre-widen table above, because the courtyard it
 * stands in is authored there. These are in WIDENED space.
 */
/**
 * …AND THE FIRST TWO PAIRS SWAPPED WHEN THE ZONES FINALLY MOVED INTO THE
 * DISTRICTS. The capture points are the two yards now and the beacons are the two
 * mid-street plazas — see the long note over `ZONES` in src/match/sites.js. A
 * ZONE CIRCLE IS NOT ENOUGH ON ITS OWN: `KEEPOUT` holds off the DRESSING, and a
 * beacon is not dressing but a `world.features` cache with real geometry under
 * it (src/world/features.js), so the beacon had to leave the point rather than be
 * fenced off it. It was standing on zone A's centre and made that cell a
 * one-cell island 0.93 m above its neighbours.
 */
KEEPOUT.push(
  [-38, 51, 3.0],     // ZONE A — the north-west district's yard
  [38, -53, 3.0],     // ZONE B — its 180° image, the south-east yard
  [-10, 40, 2.2],     // BEACON — the north plaza, which zone A vacated
  [10, -42, 2.2],     // BEACON — the south plaza, its 180° image
  [-34.75, -20, 2.2], // BEACON — west lane, south run
  [34.75, 18, 2.2]    // BEACON — east lane, north run
  /**
   * …AND THE EAST COURTYARD'S BEACON CIRCLE IS GONE WITH THE BEACON. `FLANK-C`
   * stood at (40, -3); the east courtyard is capture point E now, and `ZONE E`
   * above reserves its centre instead. @see `BEACON_SPOTS` at the foot of this
   * file for why the beacon could not simply be fenced off the point.
   */
);

/**
 * THE MASS ON THE TWO NEW POINTS, and it is the plaza recipe rather than a new
 * one: two screens on the arc the ENEMY arrives from, two plinths of waist-high
 * mass ON the point, one wall on the owner's own side to retake it from behind,
 * and one pier over the 2.8 m cover line at the throat — a chokepoint, not cover.
 * Everything is authored 3.2-5.1 units of the centre: outside `standRing`'s 4 m
 * ring of forward spawns, inside the 8 m capture circle. @see the long note over
 * `SITEWORKS`.
 */
SITEWORKS.push(
  { id: 'NW yard screen west', kind: 'wall', x: -40.6, z: 46.6, w: 2.6, d: 0.6, h: 1.6, key: 'brick', revet: true },
  { id: 'NW yard screen east', kind: 'wall', x: -35.4, z: 46.6, w: 2.6, d: 0.6, h: 1.6, key: 'brick', revet: true },
  { id: 'NW yard plinth north', kind: 'plinth', x: -38.0, z: 55.0, w: 2.0, d: 1.6, h: 1.3, key: 'concrete' },
  { id: 'NW yard plinth west', kind: 'plinth', x: -42.4, z: 51.0, w: 1.6, d: 2.0, h: 1.3, key: 'concrete' },
  { id: 'NW yard wall', kind: 'wall', x: -33.4, z: 51.0, w: 0.6, d: 3.6, h: 1.45, key: 'plaster_blue' },
  { id: 'NW throat pier', kind: 'pier', x: -38.0, z: 44.6, w: 2.4, d: 2.4, h: 2.95, key: 'concrete' },

  { id: 'SE yard screen east', kind: 'wall', x: 40.6, z: -48.6, w: 2.6, d: 0.6, h: 1.6, key: 'brick', revet: true },
  { id: 'SE yard screen west', kind: 'wall', x: 35.4, z: -48.6, w: 2.6, d: 0.6, h: 1.6, key: 'brick', revet: true },
  { id: 'SE yard plinth south', kind: 'plinth', x: 38.0, z: -57.0, w: 2.0, d: 1.6, h: 1.3, key: 'concrete' },
  { id: 'SE yard plinth east', kind: 'plinth', x: 42.4, z: -53.0, w: 1.6, d: 2.0, h: 1.3, key: 'concrete' },
  { id: 'SE yard wall', kind: 'wall', x: 33.4, z: -53.0, w: 0.6, d: 3.6, h: 1.45, key: 'plaster_pink' },
  { id: 'SE throat pier', kind: 'pier', x: 38.0, z: -46.6, w: 2.4, d: 2.4, h: 2.95, key: 'concrete' }
);

/* ========================================================================== */
/* THE MAP GROWS — PART 5: THE CATHEDRAL IS NOT A DOOR YOU WALK THROUGH        */
/* ========================================================================== */
/**
 * "簡単に中央大聖堂エリアにいけないようにしてください"
 * "もっと建物増やして、今大聖堂周りはもっと開た感じにして、周りに遮蔽物もないし"
 *
 * Two requests, one piece of geometry. The cathedral stands in a 46.5 m street
 * with 8.25 m of it down each flank, and until now the whole approach was a swept
 * square: you walked up the middle of the street and in through a 6 m portal
 * without ever being made to choose, and there was nothing between the north
 * cross street and the south portal to stand behind.
 *
 * So the precinct is GATED and the forecourts get mass. In authored (widened)
 * units, the cathedral is x ∓10, z -16..14 and the kerbs are ∓15.5:
 *
 *   the two GATE LINES   z 19.5 and -21.5, right across the forecourt: a 2.4-unit
 *                        pier dead centre with a 6-unit wall each side of it, so
 *                        the way in from either cross street is two 2.2-unit
 *                        (3.3 m) slots instead of 31 units of open tarmac. The
 *                        6.1 units of street OUTSIDE each wall stay open — that
 *                        is the mid route past the building, and choking it would
 *                        cost the map its middle lane. @see `navcheck`.
 *   the TRANSEPT SCREENS x ∓13.2, standing along Z in front of the two transept
 *                        portals: 4 units long, 2.9 units clear of the church
 *                        wall and 2 clear of the kerb, so the portal is a dog-leg
 *                        from both directions rather than a hole you run into.
 *   four PLINTHS         waist-high mass in the two forecourts, which is the
 *                        "遮蔽物もない" half: 1.25 m, so you shoot over it.
 *   two MARKET WALLS     broken runs breaking the 8.25 m flank-street sightline
 *                        at each end of the building.
 *
 * NOTHING IS AUTHORED IN THE FLANK STREETS AT LEVEL z -12, 6.5 OR 7. Those are
 * the three cathedral strike anchors in `src/match/airstrike.js`, and each one
 * measures the street beside it with a chest-height ray to size the rubble mound
 * it drops. A 1.7 m screen inside that measurement turns the mega-collapse into a
 * pile of gravel — the transept screens are 5 units clear of the nearest anchor
 * and the market walls are outside the building's own z range. IF AN ANCHOR
 * MOVES, RE-CHECK THIS LIST.
 */
SITEWORKS.push(
  { id: 'CATH north pier', kind: 'pier', x: 0.0, z: 19.5, w: 2.4, d: 2.4, h: 3.4, key: 'concrete' },
  { id: 'CATH north wall west', kind: 'wall', x: -6.4, z: 19.5, w: 6.0, d: 0.6, h: 1.9, key: 'plaster_cream', revet: true },
  { id: 'CATH north wall east', kind: 'wall', x: 6.4, z: 19.5, w: 6.0, d: 0.6, h: 1.9, key: 'plaster_cream', revet: true },
  { id: 'CATH south pier', kind: 'pier', x: 0.0, z: -21.5, w: 2.4, d: 2.4, h: 3.4, key: 'concrete' },
  { id: 'CATH south wall west', kind: 'wall', x: -6.4, z: -21.5, w: 6.0, d: 0.6, h: 1.9, key: 'plaster_sand', revet: true },
  { id: 'CATH south wall east', kind: 'wall', x: 6.4, z: -21.5, w: 6.0, d: 0.6, h: 1.9, key: 'plaster_sand', revet: true },
  { id: 'CATH west transept screen', kind: 'wall', x: -13.2, z: -1.0, w: 0.6, d: 4.0, h: 1.7, key: 'brick' },
  { id: 'CATH east transept screen', kind: 'wall', x: 13.2, z: -1.0, w: 0.6, d: 4.0, h: 1.7, key: 'brick' },
  { id: 'CATH north plinth west', kind: 'plinth', x: -5.0, z: 16.5, w: 2.0, d: 1.4, h: 1.25, key: 'concrete' },
  { id: 'CATH north plinth east', kind: 'plinth', x: 5.0, z: 16.5, w: 2.0, d: 1.4, h: 1.25, key: 'concrete' },
  { id: 'CATH south plinth west', kind: 'plinth', x: -5.0, z: -18.5, w: 2.0, d: 1.4, h: 1.25, key: 'concrete' },
  { id: 'CATH south plinth east', kind: 'plinth', x: 5.0, z: -18.5, w: 2.0, d: 1.4, h: 1.25, key: 'concrete' },
  { id: 'CATH north-west market wall', kind: 'wall', x: -11.5, z: 21.5, w: 0.6, d: 3.4, h: 1.45, key: 'brick', revet: true },
  { id: 'CATH south-east market wall', kind: 'wall', x: 11.5, z: -23.5, w: 0.6, d: 3.4, h: 1.45, key: 'brick', revet: true }
);

/**
 * And the two districts are DRESSED, because "もっと作り込み" applies to new ground
 * more than to old: a district that is a surface and five blocks reads as a car
 * park. All in widened space, all paired under ρ, and all clear of the zone
 * circles above (`KEEPOUT` is what actually enforces that).
 */
SET_PIECES.stalls.push(
  [-45.0, 47.0, 1.5, 2.4], [45.2, -49.0, -1.6, 2.4],
  [-24.0, 47.5, 0.1, 2.3], [24.2, -49.5, 3.1, 2.3],
  [-50.0, 25.0, 1.5, 2.2], [50.2, -27.0, -1.6, 2.2]
);
SET_PIECES.jerseys.push(
  [-43.0, 44.6, 0.1], [43.2, -46.6, -0.1],
  [-31.5, 55.5, 1.55], [31.7, -57.5, 1.55],
  [-52.0, 31.0, 0.1], [52.2, -33.0, 0.1],
  [-20.0, 52.0, 1.55], [20.2, -54.0, 1.55]
);
SET_PIECES.sandbagWalls.push(
  [-44.0, 55.0, 0.0, 3.0], [44.2, -57.0, 0.0, 3.0],
  [-33.0, 45.5, 1.57, 2.8], [33.2, -47.5, 1.57, 2.8],
  [-47.0, 36.0, 0.0, 3.2], [47.2, -38.0, 0.0, 3.2],
  [-19.0, 46.5, 0.0, 2.6], [19.2, -48.5, 0.0, 2.6]
);
SET_PIECES.wrecks.push(
  [-49.5, 41.0, 1.4, 0], [49.7, -43.0, 1.5, 3],
  [-25.5, 55.0, 0.3, 0], [25.7, -57.0, -0.4, 2],
  [-55.0, 27.0, 1.45, 0], [55.2, -29.0, 1.5, 2]
);
SET_PIECES.palms.push(
  [-42.0, 56.0, 1.0], [42.2, -58.0, 1.0],
  [-52.5, 42.0, 0.95], [52.7, -44.0, 0.95],
  [-30.0, 43.0, 1.05], [30.2, -45.0, 1.0],
  // …and four in the two cathedral forecourts, which had nothing standing in
  // them at all: a palm is a soft vertical the eye can read the depth of the
  // square against.
  [-9.5, 17.5, 1.05], [9.7, 17.0, 1.0],
  [-9.5, -19.5, 1.0], [9.7, -19.0, 1.05]
);
SET_PIECES.lamps.push(
  [-40.0, 52.0, -Math.PI / 2], [40.2, -54.0, Math.PI / 2],
  [-46.0, 30.0, -Math.PI / 2], [46.2, -32.0, Math.PI / 2],
  [-25.0, 46.0, -Math.PI / 2], [25.2, -48.0, Math.PI / 2]
);
SET_PIECES.rubble.push(
  [-56.5, 34.0, 2.4, 30], [56.7, -36.0, 2.4, 30],
  [-44.0, 25.5, 2.2, 26], [44.2, -27.5, 2.2, 26],
  [-21.0, 56.0, 2.0, 24], [21.2, -58.0, 2.0, 24],
  [-31.0, 41.0, 2.2, 26], [31.2, -43.0, 2.2, 26],
  // the collapsed corner of the cathedral's own precinct wall, in both forecourts
  [-12.5, 16.0, 2.0, 24], [12.7, -18.0, 2.0, 24]
);
SET_PIECES.tyres.push(
  [-48.0, 48.0, 4], [48.2, -50.0, 4],
  [-36.0, 26.0, 3], [36.2, -28.0, 3],
  [-22.5, 50.0, 4], [22.7, -52.0, 3]
);

/* ========================================================================== */
/* THE MAP GROWS — PART 6: A CITY ON THE FAR WEST AND ONE ON THE FAR EAST      */
/* ========================================================================== */
/**
 * "もっともっともっと離せ 壁が原因とかじゃなくてもっと物理的に左右の街の中に投入しろ
 *  占領地点を … なぜAやBから視認できる距離にあんの？大聖堂が … もっと街中に作れ
 *  街中の戦闘を作れ"
 *
 * ASKED FOUR TIMES, AND THE THREE ANSWERS BEFORE THIS ONE ALL MOVED A NUMBER IN
 * `src/match/sites.js` INSTEAD OF BUILDING ANYTHING. The zones went (0, 38) ->
 * (-10, 40) -> (-38, 51) -> (-48, 38) and stopped there, because -48 is where
 * the map stopped: `NW1`'s east face was the last authored ground on this side
 * and `SE1`'s west face the last on the other. Pushed to ∓58 the level never
 * finished booting — `ensureReachable` walks sixteen rings of twelve probes
 * against thirty spawns when a zone lands on ground A* cannot serve, and out
 * there there was no ground at all.
 *
 * So the ground gets built first and the zones follow it. Two new districts, an
 * exact ρ pair, each one a STREET rather than a yard:
 *
 *   ρ(x, z) = (-x, -2 - z)   the 180° rotation about the cathedral centre (0, -1)
 *
 *                      the WEST CITY                    the EAST CITY
 *   the avenue         x -83..-70, z 15..62             its ρ image
 *   the west row       WC1/WC2/WC3, x -95..-83          EC1/EC2/EC3
 *   the inner row      NW1 (z 15..34) + NW6 (z 40..52)  SE1 + SE6
 *   the two mouths     z 34..40 into the NW throat      z -42..-36 into the SE throat
 *                      z 52..62 into the NW yard        z -64..-54 into the SE yard
 *   ZONE A             (-76.5, 46)                      ZONE B (76.5, -48)
 *
 * WHY AN AVENUE AND NOT A SECOND YARD. "街中の戦闘" is a street fight, and the
 * two yards the zones are leaving are 45 x 20 units of open gravel — a field
 * with a wall round it. The avenue is 13 units (19.5 m) between two continuous
 * three- and four-storey rows, which is narrower than the capture circle is
 * wide: the point IS the street, it is fought along its length rather than
 * across a square, and every approach to it is a doorway or a corner.
 *
 * WHY THE ZONE IS AT z 46. The east row is cut in two places and a capture point
 * must not be able to see the cathedral down either cut. The bearing from the
 * avenue to the crossing drops 0.61 units of z per unit of x, so the circle at
 * (-76.5, 46) projects onto the row over z 40..51 — which is exactly `NW6`'s
 * span, and `NW7` in the throat behind the southern cut catches the diagonal
 * that slips through it. Measured rather than reasoned: `_cityprobe.mjs` casts
 * from eye height at the centre and around the circle to five points up the
 * dome and prints what stopped each one.
 *
 * WHERE THE WALKABLE GROUND STOPS. `tools/boundcheck.mjs` floods a 128 m
 * half-extent in scaled level space, hard-coded, and `tools/` is not ours — so
 * 85.3 authored units is the furthest ground the gate can still see. The
 * avenue's far kerb is x ∓83 (124.5 m) and the row behind it is MASS, not
 * ground, so it may stand at ∓95 without hiding anything from the gate.
 */
/**
 * The 180° rotation about the cathedral centre, on the authored plan.
 *
 * DECLARATIONS AND NOT ARROW CONSTS: the IN-LANE HARD COVER pair, a thousand
 * lines above, derives its east twins with these, and a `const` would be in its
 * temporal dead zone up there. `widenX` is odd and z is untouched by it, so ρ
 * commutes with the widening and may be applied on either side of it.
 */
function RHO(x, z) {
  return [-x, -2 - z];
}
/** …and what it does to a face index (0 -Z, 1 +X, 2 +Z, 3 -X). */
function rhoSide(s) {
  return s === undefined ? undefined : (s + 2) % 4;
}
const rhoKeys = (o) => {
  if (!o) return o;
  const out = {};
  for (const k of Object.keys(o)) out[rhoSide(Number(k))] = o[k];
  return out;
};

/**
 * Push a west block and its east twin in one call.
 *
 * THE PAIRING IS CODE AND NOT A SECOND TABLE ON PURPOSE. Domination never swaps
 * ends, so any asymmetry between A's district and B's is a permanent property of
 * the map, and the two previous passes that authored both halves by hand both
 * shipped one — B's flank staging point is still a hand-written exception in
 * `src/match/sites.js` for exactly that reason. A block whose twin is derived
 * cannot drift. `east` overrides the derivation where a new district has to meet
 * OLD geometry that is mirror-symmetric in x rather than ρ-symmetric.
 */
function pairBuilding(w, east) {
  const [ex, ez] = RHO(w.x, w.z);
  BUILDINGS.push(w, {
    ...w,
    id: w.id.replace(/^W/, 'E').replace(/^NW/, 'SE'),
    x: ex,
    z: ez,
    streetSide: rhoSide(w.streetSide),
    secondarySide: rhoSide(w.secondarySide),
    doorBays: rhoKeys(w.doorBays),
    skipSides: w.skipSides ? w.skipSides.map(rhoSide) : undefined,
    ...east,
  });
}

BUILDINGS.push(
  /**
   * The north half of the inner row, and the piece of masonry the whole request
   * turns on: it is what stands between the capture point and the cathedral.
   * Three storeys, because the ray to the campanile is 4.6 m up where it crosses
   * this block and a two-storey parapet clears it by 2 m — a margin a roll of
   * the dressing dice should not be able to spend.
   */
  { id: 'NW6', x: -65, z: 46, w: 10, d: 12, floors: 3, wallKey: 'plaster_sand', streetSide: 1, secondarySide: 3, damage: 0.3, balconies: 0.3, doorBays: { 3: 1 }, roofProps: 3 },
  { id: 'SE6', x: 65, z: -48, w: 10, d: 12, floors: 3, wallKey: 'plaster_cream', streetSide: 3, secondarySide: 1, damage: 0.3, balconies: 0.3, doorBays: { 1: 1 }, roofProps: 3 },
  /**
   * …and the block in the throat behind the SOUTHERN cut, which is a dog-leg
   * rather than cover. The cut is 6 units of open row and the capture circle's
   * southern arc looks straight down it at the crossing 130 m away; this stands
   * in the far end of that line, 3 storeys against a ray 7.4 m up. It leaves
   * 13 units of throat to walk past it, so it costs A* nothing — `navcheck`.
   */
  { id: 'NW7', x: -56.5, z: 28.5, w: 7, d: 9, floors: 3, wallKey: 'plaster_cream', streetSide: 1, secondarySide: 0, damage: 0.4, balconies: 0.2, doorBays: { 1: 1 }, roofProps: 2 },
  { id: 'SE7', x: 56.5, z: -30.5, w: 7, d: 9, floors: 3, wallKey: 'plaster_sand', streetSide: 3, secondarySide: 2, damage: 0.4, balconies: 0.2, doorBays: { 3: 1 }, roofProps: 2 }
);

/**
 * THE WEST ROW, and it is the map edge on this side now. Three blocks meeting
 * FLUSH rather than overlapping — two boxes sharing 2 units of footprint puts
 * one block's roof plane inside the other's rooms — at three different heights
 * and three different plasters, because 45 units of one wallKey at one storey
 * count is the "flat/untextured" failure the quality bar names.
 */
pairBuilding({ id: 'WC1', x: -89, z: 22, w: 12, d: 16, floors: 3, wallKey: 'plaster_cream', streetSide: 1, damage: 0.35, balconies: 0.3, doorBays: { 1: 1 }, roofProps: 3 });
pairBuilding({ id: 'WC2', x: -89, z: 39, w: 12, d: 18, floors: 4, wallKey: 'plaster_pink', streetSide: 1, damage: 0.25, balconies: 0.35, doorBays: { 1: 1 }, roofProps: 4 });
pairBuilding({ id: 'WC3', x: -89, z: 55, w: 12, d: 14, floors: 3, wallKey: 'plaster_blue', streetSide: 1, damage: 0.4, balconies: 0.25, doorBays: { 1: 1 }, roofProps: 3 });

/**
 * The two caps that close the avenue's ends. Both run from the west row all the
 * way to the inner row, so the district is a closed box with two doors in it —
 * `boundcheck` calls every square metre the player can reach and the level has
 * not authored VOID, and the player has sent a screenshot of exactly that twice.
 *
 * THE EAST CAP IS 3 UNITS SHORTER THAN ρ, and it is the one honest asymmetry in
 * this district. `BW2` and `BE2` are a MIRROR pair about x, not a ρ pair — the
 * old map predates ρ by three passes — so BE2's east face sticks out to x 63
 * where BW2's sticks out to x -63 on the other end of the street. Deriving the
 * cap would drive it 3 units into BE2's mass. The 3 x 4 pocket that leaves at
 * x 60..63 is sealed on all four sides (SE1 south, BE2 north, BE3 west, EC4
 * east) and is 60 units from either capture point.
 */
pairBuilding(
  { id: 'WC4', x: -77.5, z: 9.5, w: 35, d: 9, floors: 2, wallKey: 'plaster_sand', streetSide: 2, secondarySide: 1, damage: 0.35, balconies: 0.3, doorBays: { 2: 1 }, roofProps: 3 },
  { x: 79, w: 32, z: -11.5 }
);
pairBuilding({ id: 'WC5', x: -77.5, z: 67, w: 35, d: 10, floors: 2, wallKey: 'plaster_cream', streetSide: 0, secondarySide: 3, damage: 0.3, balconies: 0.3, doorBays: { 0: 1 }, roofProps: 3 });

/**
 * TWO ISLANDS IN THE AVENUE, both flush to the west row rather than centred.
 * Same rule the in-lane cover follows: a block down the middle of a 13-unit
 * street leaves two 3.7-unit slots and seals it for a 0.72 m nav radius, while
 * a block against one kerb leaves one 7.6-unit mouth, which is a corner to
 * fight round. Both stand at least 12 units off the capture point, so neither
 * is inside its circle.
 */
pairBuilding({ id: 'WC6', x: -80.25, z: 22, w: 5.5, d: 6, floors: 1, groundH: 3.6, wallKey: 'plaster_blue', streetSide: 1, damage: 0.4, parapetH: 0.7, roofProps: 2 });
pairBuilding({ id: 'WC7', x: -80.25, z: 57.75, w: 5.5, d: 5.5, floors: 1, groundH: 3.3, wallKey: 'plaster_pink', streetSide: 1, damage: 0.45, parapetH: 0.6, roofProps: 2 });

/**
 * THE INTERIOR, and it is `N2`'s specification verbatim — footprint, storey
 * height, door bays, through route, room plan — with a new position and a new
 * coat of plaster, for the reason that entry already gives: every one of those
 * numbers is a configuration `indoorcheck` and `throughcheck` already pass on,
 * and inventing a new one to prove again is inventing a new way to fail. `S2`
 * is the counter-example this repo already wrote down — the same plan, moved,
 * came back a cul-de-sac on six consecutive boots and had to be made solid.
 *
 * It stands against the inner row with both its doors on the avenue's own axis,
 * so it is a way THROUGH the street furniture rather than a room off it.
 *
 * THE EAST TWIN'S INTERIOR IS ρ'd TOO, element by element, because the plan is
 * not symmetric and a half-rotated one is a new configuration nothing has
 * proved. ρ swaps 's0' with 's2'; the route's polyline reverses and every
 * normalised coordinate becomes 1-x; the counter that must stand clear of both
 * thresholds runs 0.62..1.0 on one side of the map and 0.0..0.38 on the other.
 * `throughcheck` proves both.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * …AND ρ DOES NOT SEND BAY b TO BAY 2-b. IT SENDS IT TO ITSELF.
 * ────────────────────────────────────────────────────────────────────────────
 * That line was written and never measured, and it reflected the bay index a
 * SECOND time: `buildFacade` numbers bays along the panel's own local axis, and
 * side 2's local axis already runs opposite to side 0's, so swapping the faces
 * mirrors the bay order for free. Measured, with the reflection applied on top:
 * WC8's side-0 door sits at fraction 0.167 of its face and EC8's side-2 door at
 * 0.167 of its — the SAME end of the map's east-west axis, not mirrored ends.
 *
 * Two things then say so independently. EC8's own route runs to `s2` along
 * x = 0.79, the +X side, and its door was at 0.17: the declared corridor and the
 * opening it is drawn to were at opposite ends of a 5.4 m shed. And the mantle
 * chain onto EC8's roof — 'EC8 step 1-3', which IS a correct ρ image of WC8's —
 * stands at level x 72.5..74.4, which is exactly where the door was: the probe
 * `_thresh.mjs` finds `collide_metal` at every height from 0.5 to 1.7 m across
 * the whole outside approach. EC8 has had one usable door since the chain went
 * in, `floorcheck` called its ground floor ONE WAY OUT on 7 of the 14 pinned
 * seeds, and which seeds depended on whether the dice happened to leave
 * something climbable somewhere else.
 *
 * Keeping the index is the mirror. WC8 {0:0, 2:1} therefore pairs with EC8
 * {2:0, 0:1}, which puts EC8's side-2 door at fraction 0.833 — the ρ image of
 * WC8's 0.167, on the far side of the shed from its own container stack, and at
 * the end its own route was already drawn to.
 *
 * BOTH DOOR FACES MUST BE `streetSide` OR `secondarySide`. A door bay is only
 * cut on an OPEN face (`buildFacade`), so a shed whose route names 's2' while
 * side 2 is a blank elevation logs "route references missing opening" and ships
 * a corridor into a wall — which is what the first version of this pair did.
 */
/**
 * `parapetH` IS 0.25 AND NOT N2's 0.6, AND THAT IS THE MANTLE CHAIN TALKING.
 *
 * A 0.6 m parapet is 0.6 m of wall the player has to get over between the top
 * container and the roof deck, and `tools/floorcheck.mjs` models that as three
 * hops — container, parapet CROWN, deck — on a 0.28 m grid. The crown is about
 * 0.15 m wide, so whether a grid cell lands on it is a coin toss decided by
 * where the building happens to sit: measured on the first build of this pair,
 * EC8 got a cell at 0.06 m inside its crown and its roof came back 1070/1070
 * reached, WC8's nearest cells fell 0.08 m short and 0.20 m past and its roof
 * came back UNREACHABLE — the same ladder under ρ, on the same boot.
 *
 * At 0.25 the crown is under the 0.42 m step height, so the deck is standable
 * right up to the parapet's inner face and the container reaches it in ONE hop
 * of 0.84 m against a 1.05 m reach, with the clearance ray passing 0.05 m over
 * the crown. No cell has to land on anything. N2 keeps its 0.6 — it is not this
 * pair's problem to solve and its roof has always been reached.
 */
const SHED = { w: 5.4, d: 5.4, floors: 1, groundH: 3.2, damage: 0.3, parapetH: 0.25, enterable: true, roofProps: 2 };
BUILDINGS.push(
  { id: 'WC8', x: -74.2, z: 28.7, wallKey: 'plaster_cream', streetSide: 0, secondarySide: 2, ...SHED,
    doorBays: { 0: 0, 2: 1 },
    route: [['s0', [0.21, 0.25], [0.21, 0.75], 's2']],
    rooms: [{ walls: [], furnish: [{ kind: 'shop', x0: 0.62, z0: 0.0, x1: 1.0, z1: 1.0 }] }] },
  { id: 'EC8', x: 74.2, z: -30.7, wallKey: 'plaster_blue', streetSide: 2, secondarySide: 0, ...SHED,
    doorBays: { 2: 0, 0: 1 },
    route: [['s2', [0.79, 0.75], [0.79, 0.25], 's0']],
    rooms: [{ walls: [], furnish: [{ kind: 'shop', x0: 0.0, z0: 0.0, x1: 0.38, z1: 1.0 }] }] }
);

/**
 * THE MANTLE CHAIN ONTO THE TWO SHEDS' ROOFS, AND IT IS THREE RUNGS RATHER THAN
 * N2's TWO, BECAUSE THE TOP ONE HAS TO CLEAR THE PARAPET.
 *
 * `tools/floorcheck.mjs` floods the real player capsule and reports an
 * `enterable` block whose roof it cannot reach as a cul-de-sac. It models the
 * move on a 0.28 m grid, and a two-rung ladder against a parapet asks it to
 * find a cell ON the crown — which is 0.15 m wide, so whether one lands there
 * is decided by where the building happens to sit. Measured on the first build
 * of this pair, on the same boot: EC8 got a cell 0.06 m inside its crown and
 * came back 1070/1070, WC8's cells fell either side of its own and came back
 * UNREACHABLE, and it stayed that way on three consecutive boots. The same
 * ladder, under ρ, on the same map.
 *
 * The capsule cannot get closer than its own radius to the shed's wall on one
 * side or to the parapet on the other, so container-to-deck is ~0.95 m across a
 * 1.05 m reach — inside the limit but never by more than a cell. Ending the
 * ladder ABOVE the deck instead removes the question: rung 3's top is 3.7 m,
 * half a metre over the roof and 0.15 over the crown, so the cell on the rung
 * and the cell on the deck are ADJACENT, and `floorcheck` skips the clearance
 * ray for adjacent cells entirely. Every rung is still under
 * `MOVE.mantle.maxHeight` = 1.85: 0.05 -> 1.4 -> 2.6 -> 3.7, then a 0.48 m drop
 * in over the parapet.
 *
 * Both ladders stand on the face their shed's door does NOT open through the
 * middle of — bay 0 of three is the far third — and `KEEPOUT` above holds the
 * dressing off all three rungs.
 */
RELIEF.blocks.push(
  { id: 'WC8 step 3', rect: [-74.4, 25.0, -72.5, 26.0], h: 3.7, key: 'metal_green' },
  { id: 'WC8 step 2', rect: [-74.4, 24.0, -72.5, 25.0], h: 2.6, key: 'metal_blue' },
  { id: 'WC8 step 1', rect: [-74.4, 22.9, -72.5, 24.0], h: 1.4, key: 'metal_green' },
  { id: 'EC8 step 3', rect: [72.5, -28.0, 74.4, -27.0], h: 3.7, key: 'metal_blue' },
  { id: 'EC8 step 2', rect: [72.5, -27.0, 74.4, -26.0], h: 2.6, key: 'metal_green' },
  { id: 'EC8 step 1', rect: [72.5, -26.0, 74.4, -24.9], h: 1.4, key: 'metal_blue' }
);

/**
 * The district GROUND. The avenue, and the two cross streets that pierce the
 * inner row — authored as three rects that do not overlap, because `density` is
 * a count per square metre and two rects over the same tarmac scatter it twice.
 */
ALLEYS.push(
  { rect: [-83, 14, -70, 62], surface: 'dirt', density: 0.4 },     // the WEST AVENUE — ZONE A
  { rect: [-70, 34, -60, 40], surface: 'gravel', density: 0.55 },  // …its south mouth, into the NW throat
  { rect: [-70, 52, -60, 62], surface: 'gravel', density: 0.5 },   // …its north mouth, into the NW yard
  { rect: [70, -64, 83, -16], surface: 'dirt', density: 0.4 },     // the EAST AVENUE — ZONE B
  { rect: [60, -42, 70, -36], surface: 'gravel', density: 0.55 },
  { rect: [60, -64, 70, -54], surface: 'gravel', density: 0.5 }
);

/** …and the dunes under them are flattened, with `buildGround`'s soft shoulder,
 *  so a capture point does not stand on ±0.55 m of fbm. */
FLAT.push([-96, 3, -58, 74], [58, -76, 96, -5]);

/**
 * THE MASS ON THE TWO NEW POINTS — the yard recipe, translated. Two screens on
 * the arc the enemy arrives up the street from, two plinths of waist-high mass
 * ON the point, one wall on the far kerb to retake it from behind, and one pier
 * over the 2.8 m cover line at the southern mouth: a chokepoint, not cover.
 * Every offset is the one `sitecheck` already scored on the NW yard, re-centred
 * on (-76.5, 46) — 3.2 to 5.1 units out, outside `standRing`'s 4 m ring of
 * forward spawns and inside the 8 m capture circle.
 */
for (const p of [
  { id: 'W city screen south-west', kind: 'wall', dx: -2.6, dz: -4.4, w: 2.6, d: 0.6, h: 1.6, key: 'brick', revet: true },
  { id: 'W city screen south-east', kind: 'wall', dx: 2.6, dz: -4.4, w: 2.6, d: 0.6, h: 1.6, key: 'brick', revet: true },
  { id: 'W city plinth north', kind: 'plinth', dx: 0, dz: 4.0, w: 2.0, d: 1.6, h: 1.3, key: 'concrete' },
  { id: 'W city plinth west', kind: 'plinth', dx: -4.4, dz: 0, w: 1.6, d: 2.0, h: 1.3, key: 'concrete' },
  { id: 'W city kerb wall', kind: 'wall', dx: 4.6, dz: 0, w: 0.6, d: 3.6, h: 1.45, key: 'plaster_blue' },
  { id: 'W city mouth pier', kind: 'pier', dx: 0, dz: -6.4, w: 2.4, d: 2.4, h: 2.95, key: 'concrete' },
]) {
  const { id, dx, dz, ...rest } = p;
  const wx = -76.5 + dx, wz = 46 + dz;
  const [ex, ez] = RHO(wx, wz);
  SITEWORKS.push(
    { id, x: wx, z: wz, ...rest },
    { ...{ id: id.replace('W city', 'E city'), x: ex, z: ez, ...rest },
      key: rest.key === 'plaster_blue' ? 'plaster_pink' : rest.key }
  );
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * …AND THEN THE TWO POINTS MOVED 12 UNITS DOWN THEIR OWN AVENUES AND THIS MASS
 * DID NOT GO WITH THEM.
 * ════════════════════════════════════════════════════════════════════════════
 * `bdb13e0` pulled A and B in from authored (∓76.5, ±46) to (∓69.7, ±36) —
 * measured with `tools/zonespot.mjs` rather than guessed, because z 80.4 of
 * world space is not reachable ground and five hand-picked coordinates had
 * already failed. `ZONES` in src/match/sites.js moved. The six pieces above did
 * not, and neither did the two `KEEPOUT` circles below, so the capture points
 * have been standing on bare gravel with their furniture 18 m up the street.
 *
 * MEASURED, `tools/sitecheck.mjs` on the build immediately before this block:
 *
 *   zone A    2.5 m² of 0.9-2.8 m mass inside the 8 m circle, of a floor of 12
 *   zone B    2.5 m²
 *   zone C   20.8 m²   — the west courtyard, whose mass never moved
 *
 * and NOTHING ELSE FAILED on either point: the arrival, both ground reads, the
 * perch the holder gets to first and both mouths all pass. It is the mass and
 * only the mass, which is exactly "爆破サイトが剥き出しで、攻撃側有利すぎる" — the
 * complaint this whole table was written to answer — put back by a coordinate
 * change nothing gated.
 *
 * THE OLD MASS STAYS WHERE IT IS, AND THAT IS A DECISION AND NOT AN OVERSIGHT.
 * Those six pieces are 12.1 authored units — 18 m — from the new centres, which
 * is `sitecheck`'s RING and not its circle, so they count for nothing on the
 * point; but a 48-unit avenue with one screened pinch a third of the way down it
 * reads better than a 48-unit corridor with all its furniture at one end, and
 * that pinch is now the APPROACH to the point rather than the point itself.
 * `src/match/sites.js` already made this call once, for the two mid-street
 * plazas these zones vacated before ("the plazas the zones vacate keep their
 * `SITEWORKS` cover"). Ground somebody has fought over does not stop being worth
 * fighting over because the flag moved off it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND THIS PAIR IS NOT ρ. THAT IS A FACT ABOUT `ZONES`, NOT A CHOICE HERE.
 * ────────────────────────────────────────────────────────────────────────────
 * ρ(x, z) = (-x, -2 - z) sends A's centre (-69.7, 36) to (69.7, -38). `ZONES`
 * USED TO AUTHOR B AT (69.7, -36), which is FLUSH WITH SE1's SOUTH FACE, and the
 * consequence was measurable in two ways:
 *
 *   - the ground is not the mirror image. A's centre has 2 authored units of
 *     cross street south of it and 4 north; B's had 6 south and NONE — its north
 *     arc was inside a building. A ρ'd table would have put a third of B's mass
 *     in SE1's ground floor, so each half is authored against its own ground.
 *   - B'S CENTRE MOVED BETWEEN BOOTS. Probed over thirteen boots of one build,
 *     A resolved to (-69.52, 35.92) every single time; B came back
 *     (69.51, -36.15) nine times and (69.51, -38.08) four times — the boots
 *     where `walkable()` could not find a nav cell on the wall it was authored
 *     on and `snap()` fell through to the fallback. So everything below is
 *     inside the 5.33-unit circle for BOTH of B's outcomes (18.2 m² against
 *     19.8 m², computed corner by corner), which is why B's mass is weighted
 *     along X: x is the axis that did not move.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * …AND THE FIX WAS THE TWO UNITS, AND `ZONES` HAS NOW MADE IT.
 * ────────────────────────────────────────────────────────────────────────────
 * B is authored at (69.7, -38) — ρ(A) exactly — so the wander is gone (one
 * outcome, not two) and the mass below, authored at z -37.0/-38.9/-39.9 for the
 * old centre, is ON the point rather than hanging off the far edge of its
 * circle. NOTHING BELOW MOVED WITH IT and that is deliberate twice over: every
 * piece is still inside the 5.33-unit circle from -38 (4.00, 2.83 and 4.81
 * units out), and re-centring it would be the third time this file re-authored
 * mass that was already measured good. What the move buys is measured in
 * `src/match/sites.js`'s own note — sitecheck's cover mass on B goes from
 * 10.5-16.3 m² against a bar of 12 to a distribution that clears it on every
 * seed, and none of the counted mass stands on a demolishable footprint.
 *
 * The recipe is the one the other four points use, read against ground that is a
 * CITY STREET rather than a gravel pan — each district's dressing (a stall, a
 * palm, a jersey barrier, a tyre stack and two rubble mounds, ρ-paired per side)
 * already owns a third of each circle, and every offset below was chosen off a
 * 0.5-unit sweep of the real collision:
 *
 *   two PLINTHS  waist-high mass ON the point, in the 3.2-5.0 authored band —
 *                outside `standRing`'s 4 m ring of forward spawns, inside the
 *                8 m capture circle. Authored as a STEPPED PAIR sharing an edge
 *                at 1.2 and 1.3 m rather than two pads with a slot between them.
 *   one KERB WALL along Z against the far kerb, which is what a side walks up
 *                behind to take its own point back. B only — see below.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND NOT ONE PIECE IS IN THE CROSS STREET, WHICH IS A MEASUREMENT AND NOT A
 * PREFERENCE. IT COST A WHOLE ROUND TRIP TO LEARN.
 * ────────────────────────────────────────────────────────────────────────────
 * The first version of this block put a plinth, a screen and a 2.4-unit
 * chokepoint pier in the cross street, on the recipe's own reasoning — a screen
 * on the enemy's arc, a pier in the far mouth — and every gate it was measured
 * against still passed: `sitecheck` PASSED at 22.3 m², `navcheck` PASSED,
 * `boundcheck` and `solidcheck` PASSED. `navcheck` only asks whether a route
 * EXISTS, so all four of them passed on a map where the point had been walled
 * off from its own street. A* from 4 units east of zone A went from 8.0 m to
 * 72.0 m: out of the cross street, north through the yard, down the whole avenue
 * and back. That is the CAPTURE POINT BOTS CANNOT ENTER failure, arriving as a
 * clean bill of health from every tool in the repo.
 *
 * WHY THE CROSS STREET CANNOT TAKE MASS. It is 6 authored units wide with a
 * RUBBLE MOUND standing in the middle of it — `SET_PIECES.rubble` (∓66, ±37),
 * scaled radius 2.64 m, so 3.5 units of the 6 — and its rocks are a step no nav
 * cell crosses. Measured on the build before this block, A* through the street
 * hugged (-65, 35) → (-67, 35) or (-66, 39) → (-67, 39): the mound leaves TWO
 * LANES OF 1.24 UNITS, 1.86 m each, against a 1.44 m bot capsule. There is no
 * piece of this table's vocabulary that fits in 1.86 m and leaves a route.
 * Anything at 3.2 units of the centre in that street is in one of those two
 * lanes, because the street is only ±3 units deep. So the mass goes in the
 * AVENUE, which is 13 units wide and where the same 3.2-5.0 band is free
 * ground — and the cover on these two points is one-sided ON PURPOSE.
 *
 * IF YOU ADD ANYTHING HERE, RE-MEASURE THE ROUTE AND NOT JUST THE GATES: A*
 * from (∓66, ±38) to the zone must come back under 10 m.
 *
 * The two halves carry a different number of pieces for the same reason they are
 * not ρ: the district dressing IS ρ-paired, the two zone centres are not, so the
 * stall and the tyre stack fall in different places relative to each point. A's
 * avenue lobe takes one stepped pair and no more without closing the 2.4 m lane
 * between the stall and the kerb; B's has room for the pair plus a kerb wall
 * east of its tyres. Neither side's route is pinched below 2.4 m by anything
 * here, and the avenue is 13 units wide, so both keep a full-width lane past the
 * mass (8.2 units west of A's pair, 8.4 east of B's).
 *
 * Kept off WC8/EC8's 6.2-unit `KEEPOUT` circle (each shed's two thresholds and
 * its three-rung mantle ladder — see the note under it) and out of every
 * authored prop's footprint. Authored in WIDENED space like everything else at
 * this end of the file, and the 1.5x at the foot does the rest.
 */
SITEWORKS.push(
  /* ---- ZONE A: the west avenue beside its southern cross street ---------- */
  { id: 'W avenue plinth south', kind: 'plinth', x: -73.8, z: 36.35, w: 2.0, d: 2.5, h: 1.2, key: 'concrete' },
  { id: 'W avenue plinth north', kind: 'plinth', x: -73.4, z: 38.4, w: 2.2, d: 1.6, h: 1.3, key: 'concrete' },

  /* ---- ZONE B: the east avenue, read against its own ground -------------- */
  { id: 'E avenue plinth street', kind: 'plinth', x: 73.6, z: -38.9, w: 2.0, d: 2.6, h: 1.2, key: 'concrete' },
  { id: 'E avenue plinth west', kind: 'plinth', x: 71.8, z: -39.9, w: 1.2, d: 1.8, h: 1.3, key: 'concrete' },
  { id: 'E avenue kerb wall', kind: 'wall', x: 74.4, z: -37.0, w: 0.6, d: 1.6, h: 1.45, key: 'plaster_pink' }
);

/**
 * THE TWO ZONE CIRCLES, as ground no collision-bearing prop may be dressed onto.
 *
 * A ZONE CENTRE WITHOUT ONE OF THESE IS A ZONE THAT MOVES. It has already
 * happened on this map: `BEACON_SPOTS` stood a real crate on zone A's centre,
 * the nav cell under it sat 0.93 m over its four neighbours against a 0.45 m
 * `maxStep`, and it was a connected component of ONE CELL — so `ensureReachable`
 * quietly walked the capture point somewhere else and the boot log said nothing.
 * Radius 3.0 authored = 4.5 m of ground, sized to `standRing`'s 4 m forward-spawn
 * ring. Duplicated from `ZONES` in src/match/sites.js because `world` may not
 * import `match`: IF ONE MOVES, MOVE THE OTHER.
 */
/**
 * …AND ONE MOVED AND THE OTHER DID NOT, WHICH IS THE THIRD TIME THAT SENTENCE
 * HAS HAD TO BE WRITTEN IN THIS FILE. `bdb13e0` took the zones to (∓69.7, ±36)
 * and left these two at (∓76.5, ±46), so for those commits the reservation was
 * held over 4.5 m of empty avenue while THE CAPTURE POINTS THEMSELVES were open
 * to the dressing scatter — the exact configuration the paragraph above says
 * ends with `ensureReachable` walking a zone off a crate lid and saying nothing.
 * It is not hypothetical here: probed over seven boots, zone B resolved to
 * (69.51, -36.15) five times and (69.51, -38.08) twice.
 */
KEEPOUT.push(
  [-69.7, 36, 3.0], // ZONE A — the west avenue at its southern cross street
  /**
   * …AND THE FOURTH TIME, THIS ONE MOVED BECAUSE `ZONES` FINALLY DID. B was
   * authored at -36 — flush with `SE1`'s south face — and is now at ρ(A) =
   * (69.7, -38), two units of cross street off the wall exactly as A is off
   * `NW1`. That is the fix the note under `SITEWORKS` below asked for by name
   * ("THE FIX FOR THE WANDER IS TWO UNITS IN `ZONES`"); this circle follows it
   * in the same commit, which is the whole point of the sentence above.
   */
  [69.7, -38, 3.0], // ZONE B — the east avenue at its northern cross street
  /**
   * …AND ONE ON EACH SHED, WHICH IS THE MANTLE LADDER'S CIRCLE AND NOT THE
   * DOOR'S. `setDoorways` already derives a circle on every threshold, so a
   * pallet cannot brick up a doorway; nothing derives one on `RELIEF.blocks`,
   * and a crate dropped on the 1.4 m rung is an `enterable` block whose roof
   * `tools/floorcheck.mjs` reports as a cul-de-sac. Measured on the first build
   * of this district: WC8's roof came back UNREACHABLE and EC8's — the same
   * ladder under ρ — came back with seven ways onto it, which is the dice and
   * not the geometry (`Engine` seeds from `Math.random()` unless
   * `config.deterministic`).
   *
   * N2 has never needed one because it stands inside the attack spawn pocket's
   * own 9.5-unit circle. These two are the same idea authored explicitly: 6.2
   * units covers the shed, both thresholds and the two rungs south of it.
   */
  [-74.2, 27.2, 6.2], // WC8 — the west city's shed and its ladder
  [74.2, -29.2, 6.2]  // EC8 — its ρ image
);

/**
 * And the two cities are DRESSED, because "もっと作り込み" applies to new ground
 * more than to old and an avenue with nothing in it is a corridor. All paired
 * under ρ, all clear of the two capture circles, none of it standing in a
 * doorway or on the mantle ladder.
 */
for (const [key, list] of Object.entries({
  stalls: [[-81.0, 16.5, 0.1, 2.3], [-72.0, 35.5, 1.55, 2.2], [-79.5, 52.5, 0.1, 2.4]],
  jerseys: [[-73.0, 20.5, 1.55], [-81.5, 32.5, 0.1], [-73.5, 60.0, 0.1], [-64.5, 37.0, 1.55]],
  sandbagWalls: [[-72.5, 17.5, 0.0, 3.0], [-82.0, 39.0, 1.57, 2.8], [-63.5, 55.5, 0.0, 3.0]],
  wrecks: [[-79.5, 33.5, 1.4, 0], [-72.5, 52.5, 0.3, 2], [-64.5, 58.0, 1.5, 0]],
  palms: [[-81.5, 29.0, 1.05], [-72.0, 57.0, 0.95], [-65.0, 36.5, 1.0]],
  lamps: [[-82.4, 36.0, -Math.PI / 2], [-82.4, 53.0, -Math.PI / 2], [-70.6, 20.0, Math.PI / 2], [-70.6, 56.0, Math.PI / 2]],
  rubble: [[-82.0, 34.0, 2.2, 26], [-72.0, 41.0, 2.0, 24], [-66.0, 37.0, 2.2, 26], [-73.0, 61.0, 2.0, 24]],
  tyres: [[-73.5, 34.5, 4], [-74.5, 21.0, 3]],
})) {
  /** A yaw is the third element of everything on this list that carries one, and
   *  a 180° rotation of the plan turns a prop through 180° as well. `palms`,
   *  `rubble` and `tyres` carry a scale, a radius and a count there instead. */
  const spins = key === 'stalls' || key === 'jerseys' || key === 'sandbagWalls' || key === 'wrecks' || key === 'lamps';
  for (const p of list) {
    const [ex, ez] = RHO(p[0], p[1]);
    const twin = p.slice();
    twin[0] = ex;
    twin[1] = ez;
    if (spins) twin[2] = p[2] + Math.PI;
    SET_PIECES[key].push(p, twin);
  }
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE FLANK BEACON SQUARES — the three places the left and right are worth
 * walking to even when the point next door is already yours.
 * ────────────────────────────────────────────────────────────────────────────
 * "マップの左右のいく価値のないエリアにはビーコンエリアがあってそこからもリスポーンできる
 *  ようにして（起動したら）左右にもっとメリットを与えて、例えば爆撃機を呼べるとか"
 *
 * `world` publishes the PLACE and nothing else — what a cache is worth is
 * `match`'s to decide, and it already decides it: `src/match/caches.js` turns
 * every published feature into HOLD F (take what it holds) and TAP F (a 30 s
 * forward spawn that joins `_safeSpawn`'s auction). So a beacon area is a
 * `world.features` entry standing on flank ground, and the respawn the player
 * asked for is the mechanism that has been on the map since the caches went in.
 *
 * WHERE. The three flank areas that have no capture point on them once the zones
 * move: the west lane's south run, the east lane's north run (a ρ pair, so
 * neither side is nearer to its own) and the EAST courtyard — which is zone C's
 * mirror image, so both sides are equidistant from it exactly as they are from C.
 *
 * Level space, WIDENED, pre-1.5x — `src/world/features.js` scales them with
 * everything else. Each has a `KEEPOUT` circle above.
 */
export const BEACON_SPOTS = [
  /**
   * THE FIRST PAIR MOVED OFF THE TWO YARDS, because the capture points went
   * there. A beacon is a real crate on the ground, not a decal, so leaving one on
   * a zone centre put a 0.98 m collider on the point: the nav cell under it sat
   * 0.93 m over its four neighbours against a 0.45 m `maxStep` and was a
   * connected component of ONE CELL, which is why nothing could ever path to zone
   * A. The two mid-street plazas the zones vacated take them instead — still a ρ
   * pair under (x, z) -> (-x, -2 - z), so neither side is nearer its own, and the
   * plazas keep a reason to be walked through now that nothing is captured there.
   */
  { id: 'FLANK-NW', name: 'NORTH PLAZA', x: -10, z: 40, yaw: -Math.PI / 2 },
  { id: 'FLANK-SE', name: 'SOUTH PLAZA', x: 10, z: -42, yaw: Math.PI / 2 },
  { id: 'FLANK-W', name: 'WEST LANE DEPOT', x: -34.75, z: -20, yaw: Math.PI / 2 },
  { id: 'FLANK-E', name: 'EAST LANE DEPOT', x: 34.75, z: 18, yaw: -Math.PI / 2 },
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * AND THE THIRD ONE IS GONE, BECAUSE THE EAST COURTYARD IS A CAPTURE POINT NOW
   * ──────────────────────────────────────────────────────────────────────────
   * `FLANK-C` stood at (40, -3) and its own justification, three paragraphs up,
   * was "the three flank areas that have NO capture point on them once the zones
   * move … and the EAST courtyard — which is zone C's mirror image". Zone E is
   * that mirror image now (ρ(C) = widened (37, -1), `ZONES` in
   * src/match/sites.js), so the sentence is no longer true of this square.
   *
   * IT COULD NOT STAY AND BE FENCED OFF. (40, -3) is 3.6 authored units from
   * E's centre — 5.4 m, INSIDE the 8 m capture circle — and `KEEPOUT` does not
   * govern a beacon: it holds off the DRESSING, while a beacon is a
   * `world.features` cache with real geometry and real collision under it
   * (src/world/features.js). That is the precise failure this list already
   * records two entries up: a beacon crate standing on zone A's centre made the
   * nav cell under it a connected component of ONE against a 0.45 m `maxStep`,
   * and nothing could path to the capture point at all. The zones and the first
   * two beacons SWAPPED for that reason; this is the same swap with nowhere left
   * to swap to.
   *
   * AND KEEPING IT WOULD BREAK THE THING E WAS ADDED TO FIX. C's circle has no
   * beacon in it. A beacon in E's would be a forward spawn on one of the two
   * courtyards and not on the other — an asymmetry authored into the very pair
   * that exists to remove one. The two remaining beacons are still a ρ pair
   * (FLANK-NW/FLANK-SE, FLANK-W/FLANK-E), so the flank invariant is unchanged
   * and is now unbroken by an odd one out.
   */
];

/* ========================================================================== */
/* THE MAP GROWS — PART 3: THE CATHEDRAL IN THE MIDDLE                        */
/* ========================================================================== */
/**
 * "また中央部は屋内にしてほしい なので中央部に広い大聖堂を配置してそこを戦闘激化させて
 *  爆破させたり崩落もあり … もっと屋内での戦闘も起きるようになっていないのが今のマップの
 *  勿体無いところです".
 *
 * ZONE C IS INSIDE THIS BUILDING. That is the entire design, and everything else
 * about it follows:
 *
 *   IT IS NOT IN `BUILDINGS`. It is not a footprint with a facade programme —
 *   it is an aisled basilica with an arcade, a clerestory, a crossing dome, an
 *   apse and a campanile, and `buildBuilding` has no vocabulary for any of that.
 *   `src/world/cathedral.js` builds it, `WorldSystem` calls that instead of the
 *   kit, and it is kept out of `BUILDINGS` so nothing that walks that array
 *   (`inBuilding`, `setDoorways`, `buildFeatures`, `buildLinks`, `cordonRuns`,
 *   and the four interior gates, all of which index `infos` against `BUILDINGS`)
 *   has to be taught a special case.
 *
 *   IT PUBLISHES AN INTERIOR VOLUME. `src/ai/nav.js` is a 2.5D height field
 *   built from one ray per cell dropped from above, so inside any roofed
 *   footprint that ray finds the ROOF and the storey under it does not exist to
 *   A*. `NavGrid._carveInteriors` re-samples those cells from inside using
 *   `world.interiorVolumes`, which is what finally put bots indoors on this map
 *   (0 -> ~2620 ground-floor cells, 3/29 men ever inside -> 23/29). A cathedral
 *   that did not publish one would be the most beautiful room on the map with a
 *   capture point in it that no bot could ever walk to. @see `_interiorVolumes`.
 *
 *   IT IS BOMBABLE. Three strike anchors on it and a salvo that fires all three
 *   as one event — `src/match/airstrike.js`. Everything is baked at boot: the
 *   fracture, the per-chunk closed-form trajectory, the settled pose, the mound's
 *   collision proxy and the nav patch. The frame it fires does two booleans and
 *   one uniform write.
 *
 * THE PLAN, in authored units (x1.5 for metres of ground; heights are metres and
 * never scale). It stands on the street centreline between the two connectors,
 * where K1 and K2 used to be, leaving 5.5 units = 8.25 m of street down each
 * flank — so the mid lane is still a route for anybody who does not want to
 * fight through a nave, and the two connectors still meet it.
 */
export const CATHEDRAL = {
  id: 'CATH',
  /** Plan: 20 x 30 authored = 30 x 45 m of ground. Scaled with everything else. */
  x: 0,
  z: -1,
  w: 20,
  d: 30,
  /** Every one of these is METRES and is NOT scaled. @see the 1.5x note below. */
  wallT: 0.85,
  /** The walking surface inside, a kerb over the street so water runs out. */
  floorY: 0.16,
  /** Aisle roof / gallery deck, nave roof, crossing dome crown, campanile. */
  aisleY: 7.4,
  naveY: 15.0,
  domeY: 23.5,
  towerY: 29.0,
  /** Arcade: eight bays of piers down each side. */
  bays: 8,
  pierW: 1.4,
};

/* ========================================================================== */
/* THE MAP IS 1.5x                                                            */
/* ========================================================================== */
/**
 * "Battle Fieldみたいにマップをもう少し広くして、マップは今の１.５倍に".
 *
 * WHY IT IS A TRANSFORM AND NOT A REWRITE. Every number above is tuned — the
 * lane walls meet at exactly the four cross links, the two sites are the same
 * distance from both spawns, `KEEPOUT` sits on the plant circles, the cover
 * clusters are spaced at the distance you can cross without being shot. Typing
 * out 1.5x versions of nine hundred literals would silently destroy all of that
 * and there is no gate that could tell you which one you got wrong. Scaling the
 * authored plan preserves every relationship in it by construction: the map is
 * the same map, played at 1.5x, which is what was asked for.
 *
 * WHAT SCALES: everything that is a PLAN DIMENSION — positions, footprints,
 * lane rects, courtyards, keep-out radii, the gate's span.
 *
 * WHAT DOES NOT, and this is the part that matters:
 *
 *   HEIGHTS. A storey is 3.45 m because a man is 1.78 m. Scaling a floor to
 *   5.2 m does not make the map bigger, it makes the player small. Every
 *   `groundH`, `upperH`, parapet, plinth, balcony, terrace and relief height is
 *   left alone, so a 1.5x building is a WIDER building of the same height —
 *   which is also the Battlefield silhouette rather than the alley one.
 *
 *   THE MANTLE LADDER. `RELIEF.blocks` heights are authored against
 *   `MOVE.mantle.maxHeight` = 1.85. Scale them and every route onto a roof
 *   silently stops being a route. `tools/floorcheck.mjs` is the gate on this.
 *
 *   ANYTHING SIZED BY THE PLAYER OR HIS KIT: wall thickness, door and window
 *   openings, stair width and going, prop sizes, sandbag run lengths. A 1.7 m
 *   door and a 3.6 m market stall are the wrong shape for the human in front of
 *   them no matter how big the map is.
 *
 *   FRACTIONS. Room plans, through-routes and stair positions inside a building
 *   are authored in normalised interior coordinates, so they follow the
 *   footprint on their own and must not be touched.
 *
 * `density` is divided rather than scaled: it is a count per square metre and
 * the lanes now have 2.25x the square metres. Left alone it would put 2.25x the
 * instanced debris on the map for no gameplay gain and a real frame cost.
 */
export const SCALE = 1.5;

const S = SCALE;
const sc2 = (a) => { a[0] *= S; a[1] *= S; };
const scRect = (r) => { r[0] *= S; r[1] *= S; r[2] *= S; r[3] *= S; };

STREET.halfWidth *= S;
STREET.kerb *= S;
STREET.zMin *= S;
STREET.zMax *= S;

for (const a of ALLEYS) { scRect(a.rect); a.density /= S; }
for (const f of FLAT) scRect(f);

for (const t of RELIEF.terraces) {
  scRect(t.rect);
  for (const r of t.ramps) r.len *= S;   // a longer ramp is a gentler ramp
}
for (const d of RELIEF.decks) scRect(d.rect);           // `y` is a height: left
for (const b of RELIEF.blocks) scRect(b.rect);          // `h` is the mantle ladder: left

for (const k of KEEPOUT) { k[0] *= S; k[1] *= S; k[2] *= S; }

/**
 * THE CATHEDRAL'S PLAN SCALES AND ITS SECTION DOES NOT, exactly like a building.
 *
 * Left off this list for one build and the consequence was not subtle: a 20 x 30
 * m church instead of a 30 x 45 m one, whose arcade piers at ∓8.6 m ended up
 * OUTSIDE its own walls at ∓9.15 m (a negative-width aisle), whose nave bays ran
 * 2 m past the north and south elevations, and whose crossing — the capture
 * point — resolved 11 m away in the street because `ensureReachable` could not
 * find a route to the inside of what was left. `w`, `d` and the centre are plan;
 * `pierW` is a piece of masonry sized to the man standing beside it, `bays` is a
 * count and everything in `SEC` in cathedral.js is metres. None of those scale.
 */
CATHEDRAL.x *= S;
CATHEDRAL.z *= S;
CATHEDRAL.w *= S;
CATHEDRAL.d *= S;

// Centre and footprint scale exactly as a BUILDING's do; `h` is a height and
// does not. See the long note over SITEWORKS.
for (const p of SITEWORKS) { p.x *= S; p.z *= S; p.w *= S; p.d *= S; }

for (const b of BUILDINGS) {
  b.x *= S; b.z *= S; b.w *= S; b.d *= S;
  if (b.setback) b.setback.depth *= S;
  // floors, groundH, upperH, parapetH, plinthH, t, damage, balconies,
  // roofProps, doorBays, bayKinds, rooms, route and stairFlights are all either
  // heights, human-sized openings, counts or normalised fractions. None scale.
}

// The gate spans the street, so its plan scales with the street. Its HEIGHT is
// raised only enough to keep the arch from reading as a squat culvert once the
// opening is half as wide again — 1.5 on the span and 1.25 on the rise.
for (const k of ['z', 'depth', 'span', 'outerW', 'xL0', 'xL1', 'xR0', 'xR1', 'xT0', 'xT1', 'eastProud', 'towerProud']) GATE[k] *= S;
for (const k of ['height', 'bodyH', 'hL', 'hR', 'hT']) GATE[k] *= 1.25;

for (const p of SET_PIECES.stalls) sc2(p);        // [x, z, ry, width]
for (const p of SET_PIECES.jerseys) sc2(p);
for (const p of SET_PIECES.sandbagWalls) sc2(p);  // [x, z, ry, length]
for (const p of SET_PIECES.wrecks) sc2(p);
for (const p of SET_PIECES.palms) sc2(p);
for (const p of SET_PIECES.lamps) sc2(p);
for (const p of SET_PIECES.tyres) sc2(p);
for (const p of SET_PIECES.rubble) { p[0] *= S; p[1] *= S; p[2] *= 1.2; }
// [x0, y0, z0, x1, y1, z1, …] — the y's are facade heights and stay put
for (const p of SET_PIECES.cables) { p[0] *= S; p[2] *= S; p[3] *= S; p[5] *= S; }
for (const p of SET_PIECES.laundry) { p[0] *= S; p[2] *= S; p[3] *= S; p[5] *= S; }
for (const p of SET_PIECES.hangings) { p[0] *= S; p[2] *= S; }  // [x, y, z, ry, w, h]
