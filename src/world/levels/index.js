import { TOWN } from './town.js';
import { PLAINS } from './plains.js';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * LEVELS — THE SEAM THAT DID NOT EXIST
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Until this file, this engine had no notion of "a map". `WorldSystem.init`
 * unconditionally built one town: it imported `layout.js` at module scope, called
 * `buildGround` / `buildBuilding` / `buildCathedral` in a fixed order, and hard
 * coded that town's yaw, its scale, its spawn table, its ±86-unit play box and
 * its `isOpen`/`groundY` queries. There was nowhere to put a second one.
 *
 * WHAT IS GENUINELY MAP-SPECIFIC and what is generic machinery is the whole
 * question, and the split turns out to be clean:
 *
 *   GENERIC (reused by every level, untouched)
 *     `builder.js`   the Assembler — merged statics, instanced clouds, collision
 *                    proxies, scopes, the level->world transform, `finalize`
 *     `util.js`      the geometry toolkit and the vertex-mask channels
 *     `kit.js`       the modular building kit
 *     `props.js`     the instanced prop library
 *     `palette.js`   the surface palette
 *     `demolition.js` / `breach.js` / `features.js` / `links.js`
 *                    all of them take a spec list and give back records; none of
 *                    them names this town
 *     `src/ai/nav.js` the nav grid, which is built off `world.bounds` alone
 *     `src/match/airstrike.js`'s nav re-bake, `interiors`, the pre-warm
 *
 *   MAP-SPECIFIC (one module per level, under this directory)
 *     the authored tables (`layout.js` is 3 200 lines of them), the cathedral,
 *     the districts, the ground/relief/sitework passes that read those tables,
 *     the spawn seeds, the play box, the time of day, and the two spatial
 *     queries `world.isOpen` / `world.groundHeight`.
 *
 * A LEVEL IS A PLAIN OBJECT with the fields below. `WorldSystem.init` owns the
 * prologue (root, Assembler, transform) and the epilogue (lights, `finalize`,
 * publish, bounds, queries); the level owns everything in between.
 *
 *   id            string, matches `?map=<id>`
 *   name          display name
 *   yaw, tx, tz   LEVEL -> WORLD transform (@see `Assembler.setTransform`)
 *   scale         authored units -> metres, applied to the spawn table
 *   boundsHalf    half-extent of the play box IN METRES. This is also the nav
 *                 grid's extent and therefore its memory and its boot cost:
 *                 cells go as the square of it. @see `src/ai/index.js:_buildNav`
 *   boundsY       [min, max] of the play box, in metres
 *   hour          solar time this level is lit at, or null to leave the sky
 *                 alone. Applied through `sky.setTimeOfDay`, which is already
 *                 sky's own published API.
 *   spawns        [[x, z, yaw, tag]] in AUTHORED units — the dev/free-roam
 *                 spawns, and the only seeds `tools/boundcheck.mjs` floods from
 *   build(A, rng, ctx)   -> a build record (see below). Everything from the
 *                 prototype registration to the last prop.
 *   publish(A, rec, physics, root) -> optional; runs AFTER `A.finalize`, which
 *                 is the earliest moment a destroyed state can be published
 *   groundY(x, z) analytic floor height in LEVEL space
 *   isOpen(x, z, margin)  can a character stand outdoors here, LEVEL space
 *
 * THE BUILD RECORD is what the level hands back:
 *   { buildings, cathedral, features, links, interiorVolumes, layout }
 * Every field is optional and defaults to empty — a level with no cathedral,
 * no enterable buildings and no rooftop gangways publishes three empty arrays
 * and nothing downstream cares. That is deliberate: `src/match` reads
 * `world.features`, `world.links`, `world.demolitions`, `world.breaches` and
 * `world.interiorVolumes` and every one of those reads is already written
 * against an empty list, because this town booted with `?demo=down` and with
 * features that failed `prove()` long before a second map existed.
 */
export const LEVELS = {
  [TOWN.id]: TOWN,
  [PLAINS.id]: PLAINS,
};

export const DEFAULT_LEVEL = TOWN.id;

/**
 * Resolve `?map=` (or `config.map`) to a level. An unknown id falls back to the
 * default and SAYS SO rather than throwing: a typo in a tool's query string
 * would otherwise turn every gate in `tools/` into a 240 s boot timeout with no
 * message, which is the exact failure `tools/zonespot.mjs` was written about.
 */
export function getLevel(id) {
  if (!id) return LEVELS[DEFAULT_LEVEL];
  const lvl = LEVELS[id];
  if (lvl) return lvl;
  console.warn(`[world] unknown map "${id}" — falling back to "${DEFAULT_LEVEL}". Known: ${Object.keys(LEVELS).join(', ')}`);
  return LEVELS[DEFAULT_LEVEL];
}
