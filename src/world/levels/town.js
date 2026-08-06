import * as THREE from 'three';
import {
  BUILDINGS,
  STREET,
  SET_PIECES,
  GATE,
  SCALE,
  RELIEF,
  ALLEYS,
  SITEWORKS,
  FLAT,
  CATHEDRAL,
} from '../layout.js';
import { buildCathedral } from '../cathedral.js';
import { buildGround } from '../ground.js';
import { buildBuilding, collapseRoof } from '../buildings.js';
import { buildRelief } from '../relief.js';
import { buildCordon } from '../cordon.js';
import { buildFeatures } from '../features.js';
import { buildLinks } from '../links.js';
import { buildSiteWorks } from '../sitework.js';
import { planDemolitions, buildRuins, publishDemolitions } from '../demolition.js';
import { planBreaches, buildBreaches, publishBreaches, claimRect } from '../breach.js';
import { registerProps } from '../props.js';
import {
  registerDressingProps,
  dressStreet,
  dressBuildings,
  scatterDebris,
  buildGate,
  buildPerimeter,
  groundY,
  isOpen,
  setDoorways,
} from '../dressing.js';

/**
 * LEVEL — AL-MARIYA, the market town this repo shipped with.
 *
 * THIS FILE IS A MOVE, NOT A REWRITE. Every line of `build()` below came out of
 * `WorldSystem.init` unchanged and IN THE SAME ORDER, because the order is the
 * map: `this.rng` is a single `ctx.rng.fork()` stream and every pass draws from
 * it in sequence, so re-ordering two calls — or hoisting one allocation past
 * another — moves several thousand props. The only edits are the ones the seam
 * forces: `this.` became a field on the returned record, and the two module
 * constants that were private to `index.js` (`LEVEL_YAW`, `SPAWNS`) are now
 * declared fields of the level so a second map can declare its own.
 *
 * @see `src/world/levels/index.js` for the contract.
 */

/**
 * LEVEL -> WORLD. The street is authored down -Z; this yaw puts it on the axis
 * the canonical hero/sunset cameras look along, with the market in the near
 * third of the frame and the gate closing the far end.
 */
const LEVEL_YAW = 0.5877;
const LEVEL_TX = 0.9;
const LEVEL_TZ = 1.34;

/**
 * Spawn points in LEVEL space: [x, z, yaw, tag].
 *
 * These are the DEV/free-roam spawns, not the match's — but they are also the
 * only seeds `tools/boundcheck.mjs` floods from, so every reachable pocket of
 * the map has to be connected to one of them or that gate simply never looks at
 * it. Both base districts, the cathedral and the two new plazas are on the list
 * for that reason as much as for the camera's.
 *
 * Authored in WIDENED level space — the mid street's kerb is at x ∓15.5 now, so
 * a point at x ∓26 is in a lane rather than against a shopfront. @see `widenX`.
 *
 * THE TWO NEW CORNER DISTRICTS ARE ON THIS LIST, AND THEY HAVE TO BE.
 *
 * `boundcheck` floods from these points and nothing else, so a district that is
 * not connected to one of them is ground the boundary gate never looks at — the
 * exact blind spot that let 5 645 m² of bare sand survive until `cordon.js` was
 * written. Zone A's and zone B's yards are 2 300 m² of brand new authored ground
 * each; they get a seed apiece, and the two flank beacon squares are covered by
 * the courtyard/lane seeds that were already here.
 */
const SPAWNS = [
  [0.4, 28.5, Math.PI, 'north cross'],
  [-2.4, 60.0, Math.PI, 'attack pocket'],
  [0.0, 47.0, Math.PI, 'north plaza'],
  [-38.0, 51.0, -Math.PI / 2, 'the north-west yard'],
  [-46.0, 34.0, Math.PI, 'north-west throat'],
  /**
   * THE TWO NEW CITIES, and they are on this list for the same reason the corner
   * districts are: `boundcheck` floods from these seeds and nothing else, so an
   * avenue that is not connected to one of them is 1 500 m² of brand new ground
   * the boundary gate never looks at. One seed at each capture point and one at
   * each avenue's far end, so the flood has to cross both cross-street mouths.
   * @see `THE MAP GROWS — PART 6` in layout.js.
   */
  [-76.5, 46.0, Math.PI, 'zone A — the west city'],
  [-76.5, 18.0, 0, 'the west avenue, south end'],
  [76.5, -48.0, 0, 'zone B — the east city'],
  [76.5, -20.0, Math.PI, 'the east avenue, north end'],
  [3.6, 18.0, Math.PI, 'mid street'],
  [0.0, -1.0, Math.PI, 'the cathedral crossing'],
  [-3.4, -12.5, 0, 'mid south'],
  [2.6, -30.0, 0, 'south cross'],
  [0.0, -49.0, 0, 'south plaza'],
  [38.0, -53.0, Math.PI / 2, 'zone B — south-east district'],
  [46.0, -36.0, 0, 'south-east throat'],
  [-1.0, -62.0, 0, 'defend pocket'],
  [35.0, -4.0, -Math.PI / 2, 'east courtyard'],
  [-35.0, -4.0, Math.PI / 2, 'zone C — west courtyard'],
];

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE GROUND FLOORS, PUBLISHED AS SOMETHING THE BOT GRID CAN SAMPLE
 * ────────────────────────────────────────────────────────────────────────────
 * "もっと屋内戦闘をさせたいので屋内のエリアを作ってそこにもAIがいく利点やメリットを与えて
 *  でないとAIが屋内戦闘しない"
 *
 * `src/ai/nav.js` is a 2.5D height field: ONE floor per (x, z) cell, found by
 * dropping a single ray from above the level. Inside a footprint that ray can
 * only ever hit the ROOF, so — measured, `_navin.mjs` — every one of the 3353
 * walkable cells inside the eight enterable buildings was at 3.2 / 6.5 / 9.6 m
 * and ZERO were at ground level. No bot on this map could be indoors, every
 * "give the AI a reason to go in" feature was dead on arrival, and the one that
 * was built measured bot-time-indoors at 0.00 %.
 *
 * This is `world`'s half of the fix. It publishes each enterable building's
 * GROUND STOREY as an oriented box with the height to re-probe from, and `ai`
 * re-samples those cells from INSIDE the building — under the roof, under every
 * upper slab — so the storey the player has always been able to walk into
 * appears in the height field too. `world` changes NO geometry and NO collision
 * to do it: the roof is still a roof, an upper floor still stops a bullet, and
 * nothing here is on `LAYER.CLIP`. It is a statement about where the map's
 * interiors are, which is exactly the kind of thing `world` is allowed to know
 * and `ai` is not.
 *
 *   cx, cz    the footprint centre in WORLD space
 *   c, s      cos/sin of the level yaw, so a consumer can put a world point
 *             back on the building's own axes without knowing the transform
 *   hw, hd    half extents along those axes — the OUTER footprint, walls
 *             included, because the doorway a bot enters through is in the wall
 *   floorY    the walking surface of the ground storey
 *   probeY    where a downward ray must START to find that floor: above the
 *             tallest thing worth standing on, BELOW the head of a 2.16 m
 *             doorway (or the threshold cells sample the lintel and the storey
 *             is an island), and far below the ceiling.
 */
function interiorVolumes(A, cathedral, infos) {
  const c = Math.cos(LEVEL_YAW);
  const s = Math.sin(LEVEL_YAW);
  const out = [];
  /**
   * THE CATHEDRAL GOES ON THIS LIST FIRST, AND IF IT DID NOT THE WHOLE MIDDLE
   * OF THE MAP WOULD BE A ROOM NO BOT COULD ENTER.
   *
   * It is not in `BUILDINGS` (see `CATHEDRAL` in layout.js for why), so the
   * loop below cannot find it — but it is the biggest interior on the map by
   * a factor of four and it has a CAPTURE POINT in the middle of it. Same
   * shape of record as every other one: an oriented box on the level's own
   * axes, the outer footprint (walls included, because the doorway a bot walks
   * through is in the wall), and the height a downward ray must start at to
   * find the floor rather than the vault.
   */
  if (cathedral) {
    const k = cathedral;
    const p = A.toWorld(k.cx, 0, k.cz, new THREE.Vector3());
    out.push({
      building: k.id,
      cx: p.x, cz: p.z, c, s,
      hw: k.hw, hd: k.hd,
      floorY: k.floorY,
      probeY: k.probeY,
    });
  }
  for (const info of infos) {
    const spec = info.spec;
    if (!spec.enterable) continue;
    const p = A.toWorld(spec.x, 0, spec.z, new THREE.Vector3());
    /** The interior slab tops out 0.14 above the storey's own datum. */
    const floorY = (info.floorY?.[0] ?? 0) + 0.14;
    /**
     * The underside of whatever is over the ground storey — the first floor's
     * slab and its exposed joists, or the roof slab in a single-storey block.
     */
    const ceil = (info.floorY?.[1] ?? info.roofY) - 0.44;
    out.push({
      building: spec.id,
      cx: p.x, cz: p.z, c, s,
      hw: spec.w / 2, hd: spec.d / 2,
      floorY,
      probeY: Math.min(floorY + 1.56, ceil),
    });
  }
  return out;
}

export const TOWN = {
  id: 'town',
  name: 'AL-MARIYA',
  yaw: LEVEL_YAW,
  tx: LEVEL_TX,
  tz: LEVEL_TZ,
  scale: SCALE,
  /**
   * The playable box. `src/ai/index.js` builds its nav grid straight off
   * `world.bounds`, so it is also the nav grid's extent and therefore its memory
   * and its boot cost: 1.5x here is 2.25x the cells.
   *
   * 62 -> 86 AUTHORED UNITS was the single most expensive line in the growth
   * pass. The street runs level z -80..70 and `buildCordon` closes it at ∓83.7,
   * so a box at ±62 would leave both base districts — both SPAWNS — off the edge
   * of the nav grid entirely. Sized to the cordon, plus a metre: 86 * 1.5 = 129 m.
   *
   * WHAT IT COSTS, measured: the grid goes 328x329 (108k cells, 518 ms) to
   * 448x448 (~200k cells), i.e. 1.86x the cells, the rays and the memory.
   */
  boundsHalf: 86 * SCALE,
  boundsY: [-2, 26],
  /** The town keeps the sky's own default hour (late afternoon). */
  hour: null,
  spawns: SPAWNS,

  build(A, rng) {
    // 1. prototypes first: the level references them by id while it builds
    registerProps(A, rng);
    registerDressingProps(A, rng);

    // 2. ground, then the shells, then what people put in and on them
    buildGround(A, rng);

    /**
     * THE BUILDINGS THAT CAN COME DOWN, decided before the first wall goes up.
     * @see src/world/demolition.js. Opening a scope round `buildBuilding` costs
     * nothing and changes nothing — it only records WHERE in the merged batches
     * this building's triangles, instances and collision ended up, so that they
     * can all stop existing together later. No rng is drawn here, so the set
     * dressing of the whole map is bit-identical with the feature off.
     */
    const demoPlan = planDemolitions(BUILDINGS);
    const demoOf = new Map(demoPlan.map((d) => [d.id, d]));

    /**
     * …AND THE HOUSES THAT ONLY LOSE A WALL, decided in the same breath and for
     * the same reason. A cache house may not be levelled — that deletes the
     * reason to walk into it — so what it carries is ONE ELEVATION's worth of
     * damaged state, and the scope has to be opened round that elevation as the
     * facade goes up. @see src/world/breach.js. No rng is drawn to plan it.
     */
    const breachPlan = planBreaches(BUILDINGS);
    /**
     * A LIST PER BUILDING, NOT ONE RECORD PER BUILDING. A cache house carries
     * up to two breachable elevations now — 「今は屋内が安全すぎる」 — and this
     * was a `Map(id -> record)`, which silently keeps the LAST of the pair and
     * leaves the other with no wall scope at all.
     */
    const breachOf = new Map();
    for (const b of breachPlan) {
      const list = breachOf.get(b.building);
      if (list) list.push(b);
      else breachOf.set(b.building, [b]);
    }

    const infos = [];
    for (const spec of BUILDINGS) {
      const demo = demoOf.get(spec.id);
      const brs = breachOf.get(spec.id);
      if (demo) demo.shell = A.beginScope(`shell:${spec.id}`);
      const info = buildBuilding(
        A,
        rng,
        spec,
        brs
          ? { scopeGroundSides: Object.fromEntries(brs.map((b) => [b.side, `wall:${b.id}`])) }
          : null
      );
      if (demo) {
        A.endScope();
        demo.info = info;
      }
      for (const br of brs ?? []) {
        br.info = info;
        br.wall = info.facadeScopes?.[br.side] ?? null;
      }
      infos.push(info);
      if (spec.collapse) {
        collapseRoof(A, rng, spec, info, {
          x: spec.x + rng.range(-2, 2),
          z: spec.z + rng.range(-2, 2),
        });
      }
    }
    // The doors are cut; keep every prop with a collision proxy off their
    // approaches before a single one is placed. See `setDoorways`.
    setDoorways(infos, BUILDINGS);

    buildGate(A, rng);
    buildPerimeter(A, rng);
    /**
     * THE CORDON — the six holes the play area leaked out of, closed. It runs
     * after `buildPerimeter` and draws from its OWN rng stream, so it cannot
     * shift a single prop, stain or pock the dressing pass places below. See
     * `src/world/cordon.js`; `tools/boundcheck.mjs` is the gate.
     */
    const cordon = buildCordon(A);
    // Height goes in BEFORE the dressing, because `groundY` reads it and every
    // scattered prop, stain and skirt is placed off `groundY`.
    buildRelief(A, rng);
    // …and the site works with it, for the same reason: `isOpen` consults
    // `inSitework` before the dressing pass drops anything, so a crate cannot be
    // scattered inside a pier.
    buildSiteWorks(A, rng);
    /**
     * THE CATHEDRAL, and it is built here for two ordering reasons rather than
     * one. It has to be up before the dressing pass, because `dressing.isOpen`
     * consults `inCathedral` and a stall pitched in the chancel is the same bug
     * as one pitched inside a pier; and it has to be up before `A.finalize`,
     * because its floor, its walls and its dome are collision the nav grid is
     * built from. It draws from its OWN fixed-seed rng stream — see the note at
     * the top of the module — so it cannot move a single prop placed below.
     */
    const cathedral = buildCathedral(A);
    dressStreet(A, rng);
    /**
     * THE DRESSING GOES DOWN WITH THE BUILDING IT IS BOLTED TO.
     *
     * `dressBuildings` is one loop over every building, so there is no lexical
     * bracket to put round one of them — and without this a demolished block
     * leaves its satellite dishes, water tanks, AC units, conduit and washing
     * lines hanging in the air ten metres up. `A.claim` arms a SPATIAL claim
     * instead: anything the dressing pass writes inside one of these footprints
     * and above its plinth is filed under that building's shell scope. Disarmed
     * immediately after, so `scatterDebris` — which scatters onto the STREET —
     * is untouched. @see `claimZones` in builder.js.
     */
    for (const d of demoPlan) {
      if (!d.shell) continue;
      A.claim(d.shell, d.spec.x - d.spec.w / 2 - 1.2, d.spec.z - d.spec.d / 2 - 1.2,
        d.spec.x + d.spec.w / 2 + 1.2, d.spec.z + d.spec.d / 2 + 1.2, 0.45);
    }
    /**
     * …AND THE SAME CLAIM OVER THE ONE STOREY OF ONE ELEVATION A BREACH TAKES.
     * An AC unit or a run of conduit bracketed to the piece of wall that is
     * about to stop existing would otherwise be left hanging in the hole, which
     * is the demolition claim's own bug at 1/60th the size. Bounded ABOVE at the
     * ground storey's ceiling — see `Assembler.claim`'s `y1` — so the dressing
     * two floors up over the opening is untouched.
     */
    for (const b of breachPlan) {
      if (!b.wall) continue;
      const r = claimRect(b);
      A.claim(b.wall, r.x0, r.z0, r.x1, r.z1, 0.45, b.groundH);
    }
    dressBuildings(A, rng, infos);
    A.disarmClaims();
    scatterDebris(A, rng);
    /**
     * …and the destroyed state itself, built into the same merged batches and
     * switched off at the end of `init`. It draws from its own fixed-seed stream
     * per building, so it cannot move a prop the dressing has already placed.
     */
    buildRuins(A, demoPlan, infos);
    /**
     * …and the cache houses' damaged walls, in the same place in the order and
     * for the same three reasons: the triangles land in the merged batches, the
     * dressing has already been placed so nothing here can move it, and each one
     * draws from its own fixed-seed stream. @see src/world/breach.js.
     */
    buildBreaches(A, breachPlan);

    /**
     * WHY YOU WOULD EVER GO IN, AND WHY YOU WOULD EVER GO UP.
     *
     * Both of these run LAST and on their own rng streams, so neither can move a
     * prop the dressing has already placed:
     *
     *   `features` — 22 caches, one per level of every enterable building and one
     *     on every reachable roof. Published as `world.features` for `match`/`ai`
     *     to bind pickups to; the world only guarantees the place exists, is
     *     reachable, is marked and looks deliberate. See src/world/features.js.
     *   `links` — the four rooftop gangways that turn six separate roofs into two
     *     continuous upper routes. Their decks are `LAYER.CLIP`, so the four
     *     connectors they cross are still open ground to the bot height field.
     *     See src/world/links.js.
     */
    const features = buildFeatures(A, infos);
    const links = buildLinks(A, infos);

    return {
      buildings: infos,
      cathedral,
      cordon,
      features,
      links,
      interiorVolumes: interiorVolumes(A, cathedral, infos),
      demoPlan,
      breachPlan,
      /**
       * The authored layout, exposed for TOOLS only — nothing in the engine reads
       * it back through here. `tools/indoorcheck.mjs` needs the footprints of the
       * `enterable` buildings so it can walk the real player capsule at each one
       * and prove you can actually get inside; `navcheck` cannot tell, because it
       * tests the BOT height field and that has no opinion about whether a doorway
       * fits the player or whether a prop was dressed across it.
       *
       * `RELIEF` and `ALLEYS` are here for `tools/sitecheck.mjs`: it has to know
       * where the authored overwatch decks are in order to say whether they see
       * the plant spot, and where each courtyard's rect is in order to find that
       * courtyard's entry mouths by walking its boundary.
       *
       * `SITEWORKS` and `FLAT` are here for `tools/boundcheck.mjs`, which has to
       * know what the level ACTUALLY AUTHORED in order to say whether a piece of
       * ground the player can walk to has anything on it — the site works are
       * most of the mass in both courtyards, and `FLAT` is the flattened play box
       * itself.
       */
      layout: { BUILDINGS, STREET, SET_PIECES, GATE, SCALE, RELIEF, ALLEYS, SITEWORKS, FLAT, CATHEDRAL },
    };
  },

  /**
   * AFTER `A.finalize`. Every ruin is hidden and intangible from here;
   * `src/match/airstrike.js` re-probes the nav cells each one covers at boot and
   * owns the event that brings them down. @see `world.demolitions`.
   */
  publish(A, rec, physics, root) {
    return {
      demolitions: publishDemolitions(A, rec.demoPlan, physics, root),
      breaches: publishBreaches(A, rec.breachPlan, physics),
    };
  },

  groundY,
  isOpen,
};
