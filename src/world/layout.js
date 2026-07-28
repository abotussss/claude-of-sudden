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
  /** Catwalks over the outer strip of each site courtyard. Player only. */
  decks: [
    { id: 'A-deck', rect: [-36, -9.5, -34, -2.2], y: 2.9, railSide: 1 },
    { id: 'B-deck', rect: [34, -6, 36, 0.6], y: 2.9, railSide: 3 },
  ],
  /** Containers and crates to mantle off. `base` stacks one on another. */
  blocks: [
    { id: 'A-deck step', rect: [-34, -4.5, -32, -2.5], h: 1.5, key: 'metal_green' },
    { id: 'B-deck step', rect: [32, -5.5, 34, -3.5], h: 1.5, key: 'metal_blue' },
    { id: 'K1 step 1', rect: [-1, 16.05, 1, 17.65], h: 1.4, key: 'metal_blue' },
    { id: 'K1 step 2', rect: [-0.9, 14.75, 0.9, 16.05], h: 2.6, key: 'metal_green' },
  ],
};

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
export const KEEPOUT = [
  [-28.0, -4.0, 3.4], // site A plant area
  [28.4, -3.6, 3.4], // site B plant area
  [0, 40.4, 6.0], // attack spawn pocket
  [0, -40.4, 6.0], // defend spawn pocket
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
    roofAccess: false,
    roofProps: 4,
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
    stairFlights: [{ floor: 0, x: 0.12, z: 0.06, ry: 0, w: 1.15, railing: 'right' }],
    stairHoles: { 1: { x0: -19.3, x1: -17.75, z0: 15.5, z1: 21.4 } },
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
    roofAccess: false,
    roofProps: 5,
    /** The covered way from mid straight into site A — the claim this building
     *  was authored to make, now measured rather than asserted. */
    route: [['s3', [0.16, 0.84], [0.34, 0.8], [0.5, 0.76], [0.7, 0.8], [0.88, 0.85], 's1']],
    stairFlights: [{ floor: 0, x: 0.12, z: 0.08, ry: 0, w: 1.2, railing: 'right' }],
    stairHoles: { 1: { x0: -19.35, x1: -17.8, z0: -0.2, z1: 5.95 } },
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
    roofProps: 2,
    /** Across the south end lane-to-street, plus a spur north up the west side
     *  from the vault window to the same crossing the plan already had. */
    route: [
      ['s3', [0.16, 0.22], [0.32, 0.27], [0.55, 0.26], [0.8, 0.23], 's1'],
      ['w3', [0.16, 0.74], [0.26, 0.7], [0.28, 0.6], [0.3, 0.4], [0.32, 0.28]],
    ],
    stairFlights: [{ floor: 0, x: 0.86, z: 0.06, ry: 0, w: 1.15, railing: 'right' }],
    stairHoles: { 1: { x0: -8.9, x1: -7.3, z0: -25.2, z1: -19.2 } },
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
    roofProps: 6,
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
    ],
    stairHoles: {
      1: { x0: 17.75, x1: 19.3, z0: 15.5, z1: 21.4 },
      2: { x0: 17.75, x1: 19.3, z0: 15.5, z1: 21.4 },
    },
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
    roofAccess: false,
    roofProps: 5,
    /** Mid street -> site B, and the mid-street vault window down at the south
     *  end feeding into it up the west side of the plan. */
    route: [
      ['s3', [0.16, 0.84], [0.34, 0.8], [0.5, 0.76], [0.7, 0.8], [0.88, 0.85], 's1'],
      ['w3', [0.14, 0.2], [0.2, 0.34], [0.24, 0.55], [0.26, 0.72], [0.3, 0.81]],
    ],
    stairFlights: [
      { floor: 0, x: 0.88, z: 0.08, ry: 0, w: 1.2, railing: 'right' },
      { floor: 1, x: 0.88, z: 0.08, ry: 0, w: 1.2, railing: 'right' },
    ],
    stairHoles: {
      1: { x0: 17.8, x1: 19.35, z0: -0.2, z1: 5.95 },
      2: { x0: 17.8, x1: 19.35, z0: -0.2, z1: 5.95 },
    },
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
    roofProps: 2,
    /** Mirror of W3. The window spur runs down the EAST side here, so the
     *  cross-wall's opening moves with it. */
    route: [
      ['s3', [0.2, 0.23], [0.35, 0.26], [0.6, 0.26], [0.84, 0.22], 's1'],
      ['w1', [0.86, 0.72], [0.78, 0.7], [0.74, 0.58], [0.72, 0.4], [0.7, 0.28], [0.62, 0.25]],
    ],
    stairFlights: [{ floor: 0, x: 0.14, z: 0.06, ry: 0, w: 1.15, railing: 'right' }],
    stairHoles: { 1: { x0: 7.3, x1: 8.9, z0: -25.2, z1: -19.2 } },
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
];

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
    [-22.4, 3.4, 1.5, 2.4],
    [22.6, 5.0, -1.6, 2.4],
    [-29.6, 14.5, -1.6, 2.2],
    [29.8, 21.0, 1.5, 2.2], // was on the B-lane terrace's north ramp
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
  ],
};
