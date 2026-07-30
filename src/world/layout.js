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

/** The MID lane: the original market street, kept as the middle route. */
export const STREET = {
  halfWidth: 4.5, // asphalt
  kerb: 6.5, // building line
  walkH: 0.145,
  zMin: -58,
  zMax: 46,
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
  { rect: [-31, -26, -20.5, -11], surface: 'dirt', density: 0.3 }, // south run
  // ------------------------------------------------------------- B lane (east)
  { rect: [20.5, 3, 31, 32], surface: 'dirt', density: 0.5 }, // north run
  { rect: [20.5, -11, 36, 3], surface: 'gravel', density: 0.5 }, // SITE B courtyard
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
  [-33, -48, 33, 46], // the whole three-lane box
  [-38, -13, 38, 5], // both site courtyards
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
    { id: 'A-deck', rect: [-36, -9.5, -34, -2.2], y: 2.9, railSide: 1 },
    { id: 'B-deck', rect: [34, -8.6, 36, 0.6], y: 2.9, railSide: 3 },
    { id: 'A-south deck', rect: [-22.5, -15.6, -20.5, -12.8], y: 3.0, railSide: 3 },
    { id: 'B-south deck', rect: [20.5, -15.6, 22.5, -12.8], y: 3.0, railSide: 1 },
  ],
  /** Containers and crates to mantle off. `base` stacks one on another. */
  blocks: [
    { id: 'A-deck step', rect: [-34, -4.5, -32, -2.5], h: 1.5, key: 'metal_green' },
    { id: 'B-deck step', rect: [32, -5.5, 34, -3.5], h: 1.5, key: 'metal_blue' },
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
     * Moved off centre, and SCALING IS WHY. A facade's door lands in a BAY, and
     * the bay count is `round(length / 3.05)` — so K1's +Z face went from two
     * bays to three when the map went to 1.5x and `doorBays: { 2: 1 }` moved
     * its door from a quarter of the way along to dead centre, straight into
     * the container. `indoorcheck` reported the capsule moving 0.0 m: it was
     * spawned inside a shipping container. Nothing about the door changed, and
     * nothing about the container did; the bay grid under them did. Off to one
     * side, like K2's, it clears a door wherever the bay grid puts it.
     */
    { id: 'K1 step 1', rect: [1.3, 16.05, 2.8, 17.65], h: 1.4, key: 'metal_blue' },
    { id: 'K1 step 2', rect: [1.3, 14.75, 2.85, 16.05], h: 2.6, key: 'metal_green' },
    /**
     * …and the same for K2, which had none. `tools/floorcheck.mjs` floods the
     * real player capsule up the map and K2's roof was the one surface on the
     * level it could not reach: the island in connector 2 was the only piece of
     * cover on the mid street with no way on top of it, so the two connectors
     * did not play the same. Kept east of centre because K2's side-0 door is
     * bay 0 at level x -1.8 and a container in a doorway is a locked door.
     */
    { id: 'K2 step 1', rect: [1.3, -10.9, 2.8, -9.2], h: 1.45, key: 'metal_green' },
    { id: 'K2 step 2', rect: [1.3, -9.2, 2.85, -7.75], h: 2.7, key: 'metal_blue' },
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
export const SITEWORKS = [
  // ═══════════════════════════════════════════════════════ SITE A (west) ═══
  /**
   * THE NORTH MOUTH — the attack's own lane, and the widest thing on the map
   * that was not a street. Measured 15.2 m of walkable entry. The gatehouse goes
   * flush to the west kerb (x -31, which is also BW1's east face, so it reads as
   * part of the block rather than a lump in a field) and the baffle stands off
   * the east wall with a slot behind it. What is left to cross is 2.7 m and
   * 1.8 m authored — 4.0 m and 2.7 m on the ground, 6.7 m of a 15.75 m lane —
   * offset in Z from each other, so you cannot see the plant spot through either
   * one until you are through it.
   *
   * THE BAFFLE WAS 1.2 m WIDE AND THAT WAS NOT ENOUGH. `sitecheck` measured the
   * mouth at 11.6 m after the gatehouse went in and did not see the baffle at
   * all: its mouth walk probes 1.4 m either side of the boundary and takes the
   * nearest nav cell within one ring, so an obstacle 1.8 m wide on the ground is
   * something the grid routes round without noticing. An obstacle a route does
   * not notice is not a chokepoint. 2.4 m authored — 3.6 m on the ground, five
   * nav cells — is.
   */
  { id: 'A north gatehouse', kind: 'pier', x: -29.2, z: 3.2, w: 3.6, d: 3.2, h: 3.2, key: 'plaster_sand' },
  { id: 'A north baffle', kind: 'wall', x: -23.5, z: 4.2, w: 2.4, d: 2.8, h: 1.6, key: 'brick' },
  /**
   * THE CONNECTOR — the flank from the mid street. The blockhouse sits INSIDE
   * connector 2's west arm, flush to its south kerb (W3's north face at z -8),
   * not in the courtyard: the flank then has to come round a solid 2.6 m mass
   * before it can see the site at all, instead of stepping out of an alley with
   * the plant spot already in its sights. Kept 4.2 m clear of `flankLevel`
   * (-13, -4.5) so the staging point stays walkable ground.
   */
  { id: 'A connector blockhouse', kind: 'pier', x: -18.6, z: -6.8, w: 2.8, d: 2.4, h: 2.6, key: 'concrete' },
  /**
   * THE SPINE — the single most important piece here. A broken wall across the
   * courtyard 2.7 m north of the plant spot, on the attack's line, in two runs:
   *
   *   [A-deck step -34..-32 @1.5]  gap 2.0  [Z1 -30..-26.2]  gap 1.6  [Z2 -24.6..-21.8]  gap 1.3
   *
   * Z1 covers x -28, which IS the plant spot's line, so the charge is behind
   * masonry from the north and the man planting it is not standing in the open.
   * The three gaps are what keeps A* alive through it — and they are the three
   * doors the defence holds, which is what a chokepoint inside a site is for.
   */
  { id: 'A spine west', kind: 'wall', x: -28.1, z: -4.0, w: 3.8, d: 0.55, h: 1.45, key: 'brick' },
  { id: 'A spine east', kind: 'wall', x: -23.2, z: -4.0, w: 2.8, d: 0.55, h: 1.3, key: 'brick' },
  /**
   * THE CHARGE SCREEN — a short run standing along Z between the charge and the
   * connector mouth, so the flank's angle onto the plant spot is a corner rather
   * than a corridor. 4.4 m off the charge on the ground.
   */
  { id: 'A charge screen', kind: 'wall', x: -24.8, z: -6.7, w: 0.55, d: 2.6, h: 1.3, key: 'plaster_cream' },
  /**
   * THE TWO PLINTHS. Both are SOUTH of the charge on purpose: they are the cover
   * a defender contests the plant from and the cover a retake walks up behind,
   * and putting them north of it would only have given the attack somewhere to
   * plant from that the defence cannot clear. 3.2 m and 3.3 m off the centre on
   * the ground — outside `RULES.defuseRadius` (1.8 m), so three men can still
   * stand on the charge and cut it.
   */
  { id: 'A plinth west', kind: 'plinth', x: -30.2, z: -9.3, w: 1.6, d: 1.4, h: 1.2, key: 'concrete' },
  { id: 'A plinth south', kind: 'plinth', x: -26.8, z: -9.8, w: 2.0, d: 1.2, h: 1.2, key: 'concrete' },
  /**
   * THE RETAKE WALL, in the south lane a metre outside the courtyard. Offset to
   * the west so it leaves 7.1 m of the defence's own 10.5 m mouth open — the
   * defence's approach is the one thing on this map that must not be choked, or
   * arriving first stops being true. Kept 3.6 m clear of `holdLevel` (-24, -12).
   */
  { id: 'A retake wall', kind: 'wall', x: -29.1, z: -12.6, w: 3.0, d: 0.55, h: 1.3, key: 'plaster_blue' },

  // ═══════════════════════════════════════════════════════ SITE B (east) ═══
  /**
   * The mirror, with two numbers that are NOT mirrored, for the same reason
   * `flankLevel` is not: the east side's dressing is not the west side's.
   *   - the baffle is at z 4.2 like A's, but B's courtyard stall sits at
   *     (24, 1.6) rather than A's (-22.4, -1), so the clearance is checked
   *     against a different prop;
   *   - the connector blockhouse is 0.6 m further from the kerb, because the
   *     jersey barrier at (16.7, -5.5) has no counterpart on the west side and a
   *     concrete barrier standing inside a blockhouse looks like a bug.
   */
  { id: 'B north gatehouse', kind: 'pier', x: 29.2, z: 3.2, w: 3.6, d: 3.2, h: 3.2, key: 'plaster_cream' },
  { id: 'B north baffle', kind: 'wall', x: 23.5, z: 4.2, w: 2.4, d: 2.8, h: 1.6, key: 'brick' },
  { id: 'B connector blockhouse', kind: 'pier', x: 18.6, z: -6.8, w: 2.8, d: 2.4, h: 2.6, key: 'concrete' },
  { id: 'B spine east', kind: 'wall', x: 28.1, z: -4.0, w: 3.8, d: 0.55, h: 1.45, key: 'brick' },
  { id: 'B spine west', kind: 'wall', x: 23.2, z: -4.0, w: 2.8, d: 0.55, h: 1.3, key: 'brick' },
  { id: 'B charge screen', kind: 'wall', x: 24.8, z: -6.7, w: 0.55, d: 2.6, h: 1.3, key: 'plaster_cream' },
  { id: 'B plinth east', kind: 'plinth', x: 30.2, z: -9.3, w: 1.6, d: 1.4, h: 1.2, key: 'concrete' },
  { id: 'B plinth south', kind: 'plinth', x: 26.8, z: -9.8, w: 2.0, d: 1.2, h: 1.2, key: 'concrete' },
  { id: 'B retake wall', kind: 'wall', x: 29.1, z: -12.6, w: 3.0, d: 0.55, h: 1.3, key: 'plaster_pink' },
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
export const KEEPOUT = [
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
  [0, 39.4, 9.5], // attack spawn pocket
  [0, -39.4, 9.5], // defend spawn pocket
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
    stairFlights: [
      { floor: 0, x: 0.12, z: 0.06, ry: 0, w: 1.15, railing: 'right' },
      { floor: 1, x: 0.12, z: 0.06, ry: 0, w: 1.15, railing: 'right' },
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
      { floor: 1, x: 0.14, z: 0.08, ry: 0, w: 1.2, railing: 'right' },
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
      { floor: 1, x: 0.86, z: 0.06, ry: 0, w: 1.15, railing: 'right' },
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
      { floor: 1, x: 0.86, z: 0.06, ry: 0, w: 1.2, railing: 'right' },
      { floor: 2, x: 0.86, z: 0.06, ry: 0, w: 1.2, railing: 'right' },
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
      { floor: 1, x: 0.88, z: 0.08, ry: 0, w: 1.2, railing: 'right' },
      { floor: 2, x: 0.88, z: 0.08, ry: 0, w: 1.2, railing: 'right' },
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
      { floor: 1, x: 0.14, z: 0.06, ry: 0, w: 1.15, railing: 'right' },
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
   * K1 and K2 stand in the MIDDLE of the mid street, one inside each connector.
   *
   * They are what stops a connector being a fifty-metre firing line from site A
   * straight into site B: with the island there, crossing the street on a
   * rotation is a dog-leg, and a defender holding mid has a piece of hard cover
   * to hold it from rather than a strip of open tarmac. Single storey on
   * purpose — a two-storey island in the middle of the map would give the mid
   * player an angle into both lanes at once.
   */
  {
    id: 'K1',
    x: 0,
    z: 12,
    w: 5.4,
    d: 5.4,
    floors: 1,
    groundH: 3.2,
    wallKey: 'plaster_sand',
    streetSide: 0,
    secondarySide: 2,
    damage: 0.3,
    doorBays: { 0: 0, 2: 1 },
    parapetH: 0.6,
    enterable: true,
    roofProps: 2,
    /** Straight through, past the west end of the counter: the island is a
     *  piece of cover you cut THROUGH on a rotation, not a box. */
    route: [['s0', [0.21, 0.25], [0.21, 0.75], 's2']],
    rooms: [
      {
        walls: [],
        furnish: [{ kind: 'shop', x0: 0.0, z0: 0.0, x1: 1.0, z1: 1.0 }],
      },
    ],
  },
  {
    id: 'K2',
    x: -0.4,
    z: -4.6,
    w: 5.6,
    d: 6.2,
    floors: 1,
    groundH: 3.3,
    wallKey: 'plaster_cream',
    streetSide: 2,
    secondarySide: 0,
    damage: 0.45,
    doorBays: { 2: 1, 0: 0 },
    parapetH: 0.6,
    enterable: true,
    roofProps: 2,
    route: [['s0', [0.22, 0.25], [0.22, 0.75], 's2']],
    rooms: [
      {
        walls: [],
        furnish: [{ kind: 'storage', x0: 0.0, z0: 0.0, x1: 1.0, z1: 1.0 }],
      },
    ],
  },

  // ------------------------------------------------- background / infill --
  /**
   * The mass BEYOND the lanes. These are the lanes' outer wall as much as they
   * are skyline: `skipSides` drops the faces nobody can ever see, and the inner
   * face of each one is the wall you take cover against.
   */
  { id: 'BW1', x: -41, z: 22, w: 20, d: 42, floors: 3, wallKey: 'plaster_sand', streetSide: 1, damage: 0.15, skipSides: [3], roofProps: 3 },
  { id: 'BW2', x: -45, z: -4, w: 18, d: 18, floors: 2, wallKey: 'plaster_cream', streetSide: 1, damage: 0.25, skipSides: [3], roofProps: 2 },
  { id: 'BW3', x: -41, z: -26, w: 20, d: 36, floors: 2, wallKey: 'plaster_blue', streetSide: 1, damage: 0.2, skipSides: [3], roofProps: 2 },
  { id: 'BE1', x: 41, z: 22, w: 20, d: 42, floors: 3, wallKey: 'plaster_pink', streetSide: 3, damage: 0.15, skipSides: [1], roofProps: 3 },
  { id: 'BE2', x: 45, z: -4, w: 18, d: 18, floors: 2, wallKey: 'plaster_sand', streetSide: 3, damage: 0.25, skipSides: [1], roofProps: 2 },
  { id: 'BE3', x: 41, z: -26, w: 20, d: 36, floors: 2, wallKey: 'plaster_cream', streetSide: 3, damage: 0.2, skipSides: [1], roofProps: 2 },
  /**
   * The mass BEHIND the gate. Only its top four metres and its roofline are
   * visible — through the sliver of sky over the arch spandrel — but that is the
   * whole point: it is the third plane of depth that stops the terminator
   * reading as a flat cut-out, and it is offset west so a slice of real sky
   * survives on the east side of the gap.
   */
  { id: 'BS3', x: -4, z: -61, w: 9, d: 8, floors: 4, wallKey: 'plaster_sand', streetSide: 2, damage: 0.3, balconies: 0.2, roofProps: 4 },
  { id: 'BS1', x: -19, z: -66, w: 20, d: 14, floors: 3, wallKey: 'plaster_sand', streetSide: 2, damage: 0.2, roofProps: 2 },
  { id: 'BS2', x: 14, z: -68, w: 24, d: 16, floors: 2, wallKey: 'plaster_blue', streetSide: 2, damage: 0.2, roofProps: 2 },
  { id: 'BN1', x: -16, z: 54, w: 20, d: 14, floors: 2, wallKey: 'plaster_cream', streetSide: 0, damage: 0.15, roofProps: 2 },
  { id: 'BN2', x: 14, z: 56, w: 22, d: 16, floors: 3, wallKey: 'plaster_pink', streetSide: 0, damage: 0.15, roofProps: 2 },

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
   */
  { id: 'CA1', x: -25.5, z: 24, w: 4.5, d: 6, floors: 1, groundH: 3.6, wallKey: 'plaster_sand', streetSide: 1, damage: 0.35, parapetH: 0.7, roofProps: 2 },
  { id: 'CA2', x: -25.5, z: -19, w: 4.5, d: 5, floors: 1, groundH: 3.3, wallKey: 'plaster_blue', streetSide: 1, damage: 0.45, parapetH: 0.6, roofProps: 2 },
  { id: 'CB1', x: 25.5, z: 23, w: 4.5, d: 6, floors: 1, groundH: 3.6, wallKey: 'plaster_cream', streetSide: 3, damage: 0.35, parapetH: 0.7, roofProps: 2 },
  { id: 'CB2', x: 25.5, z: -20, w: 4.5, d: 5, floors: 1, groundH: 3.3, wallKey: 'plaster_pink', streetSide: 3, damage: 0.45, parapetH: 0.6, roofProps: 2 },
];
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
  z: -50.5,
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
