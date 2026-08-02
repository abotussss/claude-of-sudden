# OVERWATCH — engine contract

**Every agent must read this before writing code. It is the only coordination mechanism.**

Target: a browser FPS whose *visual and tactile quality* stands next to a modern
Call of Duty, played as DOMINATION on a Sudden Attack map — three capture points,
a point tick per zone held, forward spawns on what you hold. The demolition
ruleset this repo shipped with is still switchable (`RULES.mode`).
WebGL2 + Three.js r180, no external art assets — all textures, meshes, animation and audio are generated
procedurally at load time.

The engine and the game are separated on purpose. `src/render`, `src/materials`,
`src/sky`, `src/world`, `src/physics`, `src/fx` and `src/audio` are the engine and
are byte-for-byte what this repo shipped with. `src/match` is the game, and
`src/ai`, `src/player`, `src/weapons` and `src/ui` carry only the hooks the game
needs — teams, an objective, a locked trigger, a round HUD.

## Hard rules

1. **You own your directory. Never edit files outside it.** Another agent owns
   every other directory and your edit will be clobbered or will break them.
2. **Never import another subsystem's module.** Get it at runtime:
   `const fx = ctx.get('fx')`. This is what makes parallel work safe.
3. **No new npm dependencies.** `three` only. No CDN fetches, no external
   images/HDRIs/models/audio files — the game must run fully offline.
4. **No `Math.random()` in gameplay or visuals.** Use `ctx.rng` (see
   `src/core/rng.js`) or a `ctx.rng.fork()` you keep. Capture reproducibility
   depends on it.
5. **Allocate nothing per-frame.** Preallocate vectors, matrices and arrays in
   `init()` and reuse. A `new THREE.Vector3()` inside `update()` is a bug.
6. **Dispose what you create.** Geometries, materials, textures and render
   targets get freed in `dispose()`.
7. `npm run build` must pass and `node tools/capture.mjs` must produce a frame
   after your change. If you break the boot, nobody else can work.

## Subsystem interface

```js
export class MySystem {
  static id = 'mysystem';       // unique; how others reach you
  static deps = ['render'];     // ids that must init before you

  async init(ctx) {}            // build resources; may await
  fixedUpdate(h, ctx) {}        // optional, 120 Hz, deterministic gameplay
  update(dt, ctx) {}            // optional, once per frame
  lateUpdate(dt, ctx) {}        // optional, after all update()
  resize(w, h, ctx) {}          // optional
  dispose() {}                  // optional
}
```

`ctx` provides: `scene`, `camera`, `viewScene`, `viewCamera`, `canvas`,
`config`, `events`, `input`, `time`, `rng`, `get(id)`, `peek(id)`, `has(id)`.

- `scene` / `camera` — the world. `viewScene` / `viewCamera` — the first-person
  weapon, drawn separately so it can never clip through walls.
- `time` — `{ elapsed, raw, dt, fixed, alpha, scale, frame }`. Use `alpha` to
  interpolate rendered transforms between physics steps.
- `config.q` — the active quality preset (see `src/core/config.js`). Respect
  `q.taa`, `q.gtao`, `q.ssr`, `q.volumetrics`, `q.shadowMapSize`,
  `q.particleBudget`, `q.decalBudget`. Never exceed a budget.

## Ownership map

| id | directory | owns |
|---|---|---|
| `render` | `src/render/` | WebGLRenderer, HDR pipeline, all post-processing, CSM shadows, the final composite |
| `materials` | `src/materials/` | procedural PBR texture generation, the shared material library, triplanar/detail mapping |
| `sky` | `src/sky/` | physical sky, sun/moon, time of day, IBL/env map generation, volumetric fog & light shafts |
| `world` | `src/world/` | level geometry, the modular building kit, props, set dressing, static collision meshes |
| `physics` | `src/physics/` | broadphase, raycasts, character controller collision, rigid bodies, ragdolls, penetration |
| `player` | `src/player/` | movement state machine, camera feel, sprint/slide/mantle/lean, health |
| `weapons` | `src/weapons/` | weapon meshes, viewmodel rig, ADS, recoil, sway, bob, reload & inspect animation, ballistics |
| `fx` | `src/fx/` | GPU particles, muzzle flash, tracers, impacts, decals, smoke, blood, shells |
| `ai` | `src/ai/` | enemy characters, navigation, perception, cover selection, combat behaviour |
| `ui` | `src/ui/` | HUD, crosshair, hitmarkers, damage indicators, ammo, killfeed, menus |
| `audio` | `src/audio/` | synthesized weapon/foley audio, spatialisation, reverb, occlusion, mix |
| `match` | `src/match/` | the GAME: teams, the match state machine, the three capture zones and both spawns (base and forward), scoring, spectating — and the C4 in the demolition mode |

Shared, owned by the lead (do not edit): `src/core/`, `src/main.js`,
`src/dev/`, `tools/`, `vite.config.js`.

### `match` is the only gameplay owner

Everything above `match` in that table is the engine. `match` is the ruleset —
DOMINATION, with Sudden Attack's 폭파미션 behind `RULES.mode` — and it is the ONLY
subsystem allowed to decide who is on which side, when a match starts, who owns
which capture point, where a man respawns and who won. The subsystems it drives
expose exactly these hooks and nothing more:

```js
ai.playerTeam / ai.friendlyFire / ai.combatEnabled / ai.matchControlled / ai.skill
ai.clearAgents()            ai.spawn(variant, pos, yaw, { team, name, role })
ai.teamOf(actor)            ai.getHudActors()
ai.protect(actor, seconds)  ai.targetable(actor)      ai.corpseLimit
ai.needsAmmo(actor)         ai.needsGrenade(actor)    ai.ammoState(actor)
ai.resupply(actor, mags, grenades)                    ai.radio
ai.setCoverRazed(down)      ai.syncCoverBlocks()
ai.vehicles = [...]         ai.drones = [...]
agent.setObjective(mode, position, site, facing)   agent.working
player.team / player.name / player.alive
player.respawnAt(position, yaw)     player.health.regenEnabled
player.lastDamage                   { at, amount, type, source, kind, label, team, from }
weapons.locked              weapons.resetAmmo()
weapons.scavenge(mags)      weapons.needsAmmo
weapons.pickUpPrimary(id)   weapons.primaryIds
weapons.resupplyGrenades(n) weapons.needsGrenades   weapons.grenadeCapacity
ui.setRound(state)          ui.matchDriven      ui.isFriendlyTarget(actor)
ui.airAlert(a)              ui.airImpact(title)   ui.clearAirAlert()
ui.airDanger(position, life, label)
ui.setCaches(list)          ui.pickup(title, sub, kind)
ui.droneLock(state)         ui.killCam(kill)      ui.clearKillCam()
world.levelYaw              world.levelToWorld(x, y, z, out)
world.features              world.links          world.interiorVolumes
world.demolitions           world.demolish(id, down)   world.demolishAll(down)
world.breaches              world.damageAt(position, strength)
world.breach(id, down)      world.breachAll(down)
```

`world.demolitions` is A BUILDING'S OWN DESTROYED STATE, and it exists because
"建物自体に壊れた時のキャッシュを持たせて" — every strike site in
`src/match/airstrike.js` is a mass ADDED ON TOP OF a building, so the bomb lands,
the rubble falls and the building is still standing and still exactly as
impassable. Six blocks round the two flank capture points carry a second,
COLLAPSED form built at boot beside the standing one, both of them inside the
merged static batches:

```js
world.demolitions // [{ id, name, zone, opens, position:Vector3, radius, top,
                  //    halfW, halfD, level, navRect, mass, surfaces, tint, down,
                  //    setVisual(d), setCollision(d), setDown(d) }]
```

Bringing one down is a fill of degenerate indices over a cached triangle range
plus two collision-mask writes — `Assembler.beginScope` / `setScopeVisible` /
`setScopeSolid`, the same "cache it at boot, flip a range at runtime" move
`Airstrike._setProxySolid` makes. `mass` is the boxes the building is made of in
its own frame, plus every opening cut in each elevation, because `match` may not
import `world` and `world` may not import the chunk vertex program: `match` cuts,
throws and settles them with the machinery it already has. `setVisual` and
`setCollision` are separate on purpose — the nav patch is baked at boot with the
ruin temporarily solid and the building visibly standing the whole time.
`src/world/demolition.js`; `_demoprobe.mjs` measures what it opens.

`world.breaches` is THE OTHER HALF OF THAT SENTENCE — 「物資やビーコンのある家も破壊
できるようにして、破壊と言っても家の一部を破壊したり、外壁が破壊されるような破壊にして
ください」 — and the second clause is the whole specification. A cache house may not
be levelled: the six houses that hold `world.features` are the reason to go
indoors, and a ruin deletes it. What comes off is ONE GROUND-STOREY ELEVATION,
blown open across the middle, with the storeys above still standing on the two
jambs that are left.

```js
world.breaches // [{ id, building, side, name, position:Vector3, normal, along,
               //    halfLen, holeW, holeH, reach, strength, level, navRect,
               //    mass, surfaces, tint, down,
               //    setVisual(d), setCollision(d), setDown(d) }]
world.damageAt(position, strength) // -> the record that opened, or null
```

It is `demolition.js`'s machinery at the granularity of one elevation: the
facade panel is bracketed in its own `Assembler` scope as it goes up
(`buildBuilding`'s `hooks.scopeGroundSide`), the damaged form is built beside it
at boot, and the swap is two index-range fills and two mask writes. `mass` is
the same shape `world.demolitions[].mass` publishes — the box the wall is made
of in the building's frame, plus the openings cut in it — so a caller that
already throws a district block's walls needs no second code path.

`damageAt` IS THE ENTRY POINT, and it takes what a shell knows about itself: a
world position and a strength in `match`'s own units. `world` answers with the
elevation that came off or with null, and null is three real answers — nothing
breachable within `reach` (most of the map), already open, or under that wall's
own `strength` bar. The distance is to the opening's RECTANGLE rather than its
centre, so a round into the jamb beside the hole takes the same wall off.

WHICH WALL IS DERIVED, NEVER AUTHORED: a door-less side with somewhere to stand
outside it, probed with `dressing.isOpen` at three points along the elevation.
A table would open a hole into a party wall the first time a building turned.

THE SPILL IS THE ONLY SOLID PART OF THE DAMAGED FORM AND IT IS A RAMP, not
scenery. `plinthCourse` runs a 0.42 m base course round every footprint and
0.42 m is `STANCE.stand.stepHeight` EXACTLY, so a hole above an unbroken course
is a hole you cannot walk through; the rubble crests at 0.32 m on both sides of
it, under `NavGrid.maxStep` from either direction. Everything else — the teeth,
the fallen panels, the loose lumps — carries no proxy at all. `world` publishes
`navRect` and keeps `setVisual`/`setCollision` separate so a nav patch can be
baked at boot with the wall visibly standing, exactly as the ruins are.
`src/world/breach.js`; `_breachprobe.mjs` measures what it opens and
`_floatcheck.mjs --region=breach` proves nothing hangs.

`world.features` and `world.links` are PLACES THE LEVEL AUTHORED AND MARKED, and
they exist because "屋内のエリアを作ってそこにもAIがいく利点やメリットを与えて でないとAIが
屋内戦闘しない". `world` may not decide what a pickup gives any more than it may
decide who is on which side, so it publishes the geography and `match` (or `ai`)
binds the behaviour:

```js
world.features  // [{ id, kind:'ammo'|'weapon'|'grenade'|'vantage', building,
                //    floor:0..2|'roof', indoor, botReachable,
                //    position:Vector3, level:{x,y,z}, yaw }]
world.links     // [{ id, from, to, a:Vector3, b:Vector3, width, span, fall }]
```

There are 24 features — one per floor of every enterable building and one on
every reachable roof — and each is a real cache of geometry standing on a
painted square, not a marker. `src/match/caches.js` binds them: HOLD F takes what
one holds (`weapon` → `weapons.pickUpPrimary`, `grenade` →
`weapons.resupplyGrenades`, `ammo`/`vantage` → `weapons.scavenge`), TAP F of the
same key switches on a 30 s respawn beacon that joins `_safeSpawn`'s existing
forward-spawn auction.

`botReachable` IS STILL A CANDIDACY FLAG, NOT A MEASUREMENT. It is `floor === 0`,
which is all `world` can know — the nav grid belongs to `ai` and does not exist
when `buildFeatures` runs — so `src/match/caches.js` still PROVES every cache
against the real grid at init and drops the rest, exactly as `src/match/sites.js`
proves a zone's standing points. What changed is the answer. It used to be false
for all twenty-four:

A CACHE HAS TO BE WORTH SOMETHING TO A BOT AS WELL, and it was not: `_orderCache`
walked a man to a crate, he stood on it and walked away with what he arrived
with, so what the feature measured was footfall. `ai.needsAmmo` /
`ai.needsGrenade` / `ai.ammoState` / `ai.resupply(actor, mags, grenades)` are the
same four hooks `weapons` already publishes for the player (`needsAmmo`,
`scavenge`, `needsGrenades`, `resupplyGrenades`) addressed to the other side of
the same split: `match` decides what a crate is worth, `ai` owns what a soldier
is carrying, and `match` may no more read `Agent.reserve` than it may read
`weapons.reserve`. `resupply` is capped at what the man spawned with, exactly as
`scavenge` is capped at `def.reserve`. `src/match/caches.js:takeForBot` is the
bot half of `take()` and `MatchSystem._needCache` ranks who is sent.

WHICH CACHES A BOT CAN ACTUALLY USE IS TWO OF THE FOUR KINDS, measured at boot
rather than assumed: the ground floors publish seven `ammo` and one `grenade`.
EVERY weapon rack is on floor 1 and EVERY vantage nest is `floor: 'roof'`, and
the height field has one floor per cell, so a bot on this map cannot take a
weapon upgrade or use a firing position at all. Both branches are written and
both are measured selecting zero. That is not a bug to fix in `ai` — it is
`world` publishing no ground-floor rack.

`ai.radio` is the SQUAD NET (`src/ai/radio.js`): two rate-limited nets, one per
side, that turn what a soldier decides into a transmission and get it answered.
It reaches `audio` only through the public `bark(kind, position, opts)`, and the
friendly/enemy distinction is a MIX decision — the player's own side is
`radio: true` and head-locked, the enemy is spatialised at his own position.
`match` drives nothing on it; `ai` listens to `match:capture` for the objective
traffic like any other event.

```js
world.interiorVolumes // [{ building, cx, cz, c, s, hw, hd, floorY, probeY }]
```

is the GROUND STOREY of every enterable building, as an oriented box on the
level's own axes with the height a downward ray must start at to find its floor,
and it exists because `src/ai/nav.js` is a 2.5D height field built by dropping
one ray per cell from ABOVE the level: inside a footprint that ray could only
ever hit the ROOF. Swept before the fix, all 3353 walkable cells inside the eight
enterable buildings were at 3.2 / 6.5 / 9.6 m, ZERO were at ground level, 0 of 30
spawn points could A* to any of them, and the four caches that survived `prove()`
snapped to cells 2.8-3.6 m away and OUTSIDE the wall — doorways, not interiors.
Bot time inside a building measured 4.65 %, three of twenty-nine men, and
ordering men to those four cells took it to 0.00 %.

`NavGrid._carveInteriors` re-samples those cells from inside the building
instead, and `world` changes no geometry and no collision to make it possible —
nothing moved to `LAYER.CLIP`, a floor still stops a bullet, a roof is still a
roof to everything except A*. Walkability indoors is the real bot capsule rather
than the open-air pass's shoulder rays, every diagonal the corner rule refuses
near an interior is re-asked as a swept capsule (a 1.12 m door on a 0.8 m lattice
rotated 33.7° is otherwise a locked door), and the probe reaches 1.6 m past the
wall so the balcony hanging over the pavement stops making the doorstep an
island. ~2620 ground-floor cells, 23 of 29 men inside a building at least once
against 3 of 29, seven of the eight buildings entered against two. UPPER FLOORS
AND ROOFS ARE STILL A PLAYER FEATURE — one height per cell means a stair is
still 0 waypoints, and the sixteen upstairs caches are still the player's.

`world.links` are the four rooftop gangways; their decks are `LAYER.CLIP`
so the connectors they cross are still open ground to the bot height field.
`tools/floorcheck.mjs` gates all of it — head clearance over every tread, a
cache on the level every flight arrives at, and the real capsule walked across
every link. See `src/world/features.js` and `src/world/links.js`.

`ui.airAlert` and `ui.airDanger` are INCOMING AIR, and they exist because the
three air weapons in `src/match` fired correctly for weeks while the player
reported that they never happened. Both statements were true: measured at real
time, `ui.banner.text` and `ui.prompt.text` were `null` through a whole round
with three air events in it, and the impacts land on fixed geography that can be
100 m away behind a block. `airAlert` is ONE call when a strike is CALLED — the
strip then runs its own clock, points an arrow at the impact in the player's own
frame and puts itself away; `airDanger` is one world-space impact reticle per
impact point in the event, so a salvo or a gun line reads as an area to leave
rather than as a dot to look at. See `src/ui/airalert.js`.

`ui.setCaches` and `ui.pickup` are THE PICKUPS, ANNOUNCED, and they exist for the
same reason `ui.airAlert` does: the caches shipped, worked, and were reported as
"武器落ち・F長押しで交換・グレネード補充・30秒ビーコン、これらはもっとハイライトして…
ユーザーが気付けるように". `setCaches` is the nearest few caches, published every
frame from `match` (`RULES.cacheMarkerRange`), drawn as a world marker per kind
with its cooldown on it; `pickup(title, sub, kind)` is the RECEIPT — `'supply'`,
`'weapon'`, `'beacon'` or, the case that was invisible, `'deny'`, which is how a
refusal (a full pouch, a cache still resupplying, the player's own one-minute
frag clock) says so instead of a hold that silently does nothing. The two-verb
prompt (`hold` + `alt`) and the DOMINATION capture panel are the other half; see
`src/ui/pickups.js` and `src/ui/capture.js`.

`RULES.grenadeResupplyCooldown` is 60 s PER PLAYER — "グレネードの補充は1分に一回
まで 補充できすぎるとゲーム性崩壊する" — and it is a different rule from
`cacheCooldown`, which is per cache: with six grenade stacks on the map, forty
seconds per crate is a circuit a man can walk for ever. `Caches.grenadeReadyAt`
is only spent when frags actually change hands.

`weapons.scavenge(mags)` is AMMUNITION OFF A BODY — "スカベンジャー". `match`
leaves a pouch where every man falls (`src/match/ammo.js`) and the player walks
into it; `weapons` decides what it is worth, because `reserve` is its state and
nothing outside it may write it. It tops up every magazine-fed weapon by `mags`
magazines, CAPPED AT EACH WEAPON'S STARTING `def.reserve`, so a pickup can only
claw back what has already been spent and a five minute round full of bodies
cannot become infinite ammunition. Grenades are excluded on purpose. It returns
the rounds actually handed over, and `weapons.needsAmmo` is the cheap test that
keeps the pickup from consuming a pouch for nothing.

`ai.protect(actor, seconds)` is SPAWN PROTECTION, and it takes the local player
as happily as it takes an `Agent` — `match` calls it on every respawn, so bots
and the human are protected by one code path on one timer. It is implemented as
"not a valid target" (the actor is dropped from `ai.hostilesOf` for the
duration), NOT as damage immunity: nobody chooses to shoot at a man in his
spawn, but a grenade or a burst already down the lane still kills him. `player`
neither sets nor reads the field. `ai.corpseLimit` caps how many bodies stay on
the map — with respawns inside a round, a five minute round makes hundreds.

`ai.setCoverRazed(down)` is COVER FOR A TOWN THAT DOES NOT STAY THE SAME SHAPE,
and it exists because `ai.cover` is A STATEMENT ABOUT COLLISION AT THE MOMENT IT
WAS BAKED. A cover point is a place to stand plus the DIRECTION of the mass it
hides behind, found by a chest-height ray in `CoverMap.build`, and the bake runs
once in `AiSystem._buildNav` at boot. `world.cathedral.setRazed` then takes a
29 m shell down to 2.76 m of rubble in one frame with capture point D opening
inside it, and measured on the single table (`_coverstale.mjs`, every point's own
ray re-fired) **304 of the 634 points inside the footprint describe open air
afterwards, 27 of the 100 inside D** — men crouching behind nothing at the most
contested point on the map. 129 were already wrong with the church STANDING:
`Assembler.beginScope` records a scope as visible AND SOLID, so `cath:ruin` is
solid until `match`'s first `_setCathedralRazed(false)`, which lands after
`ai.init` because `match` deps on `ai`.

The fix is the same move every destruction in this project makes — BAKE AT BOOT,
SWAP AT FIRE TIME. `_bakeCover` primes the cathedral standing and bakes
`ai.coverIntact`, flips it razed and bakes `ai.coverRuin`, then flips back: three
synchronous `setRazed` calls inside `ai.init` with no frame drawn between them,
+19 ms at boot, nothing computed on the event frame. `setCoverRazed` is one
reference assignment plus dropping the agents' held points, and
`MatchSystem._setCathedralRazed` is the ONE place that calls it, so the boot
prime, the raze and the between-match reset are all covered. 0 points describe
air in either state afterwards; the swap costs 0.9 ms on 28-135 ms frames.

THE STALENESS IS GENERAL AND A SECOND TABLE CANNOT EXPRESS IT. The six
`world.demolitions` fire INDEPENDENTLY, so they are sixty-four states, not two —
and measured on the two-table build, 119 of the 324 cover points standing on
those blocks (36.7 %) described air with all six down, block by block: NW1 20,
SE1 18, NW6 19, SE6 22, WC6 8, EC6 7, and the damage is exactly additive because
each stale point is stale for ONE block's sake.

`ai.syncCoverBlocks()` is the answer to that, and it is O(POINTS × BLOCKS) AT
BOOT AND O(POINTS) AT FIRE TIME — not O(2^blocks) anywhere. A cover point is one
cell and one 1.3 m ray, so the ray hits ONE piece of mass and the question "is
this point still true" is per point and per block. `CoverMap.bakeBlockDeps`
fires all eight directions of every candidate cell in the state the level ships
in, then again with ONE block's COLLISION swapped for its ruin at a time
(`setCollision`, never `setVisual` — the same split `Airstrike._bakeNavPatch`
probes with, and the mask comes back byte-identical), and folds the two into two
bitmasks per facing: `die`, the blocks whose standing mass this facing is, and
`need`, the blocks whose RUBBLE it is. A point keeps its facings IN DIRECTION
ORDER, so with nothing down it uses the one `build` chose, and `applyBlocks`
takes the first facing that is true in the state the town is actually in — which
is how a cell whose north wall fell keeps its permanent east wall instead of
being dropped, and how a cell the debris field fills becomes cover it never was.
A point whose first facing is permanent gets no variant list at all.

`world.demolitions[].down` is read once per frame rather than hooked, because it
is written by five paths (the salvo settling, the round reset, `forceDemoNav`,
`?demo=down`, the probes) and six flags and a compare cannot be wired up wrong.
`syncCoverBlocks` is public so `match` or a probe can force it inside the frame.
Measured: 0 points describe air in all-intact, each block alone, three mixed
combinations, both district salvos and all six down; the pass costs 0.021 ms
mean / 0.10 ms worst for a change of all six, `setCoverRazed` is unchanged at
0.016 ms with three blocks down, and the bake is +126 ms per table at boot.
`_coverblocks.mjs` measures it per block and over mixed states; `_coverstale.mjs`
still measures the whole map. UPPER LIMIT, HONESTLY: cover ON the ruin — the
cells inside the footprint that only become walkable when `Airstrike` applies
its nav patch — is not baked, because the patch does not exist at `ai.init`.

If a rule needs a hook that is not on that list, add the hook to the owning
subsystem and add a line here — do not reach into another subsystem's internals
from `src/match`.

## Cross-subsystem events

Emit and listen via `ctx.events`. Payloads are plain objects. The canonical set:

| event | payload | emitted by |
|---|---|---|
| `weapon:fire` | `{ weapon, origin: Vector3, dir: Vector3, seed }` | weapons |
| `weapon:reload` | `{ weapon, phase: 'start'\|'magout'\|'magin'\|'end' }` | weapons |
| `weapon:bolt` | `{ weapon, duration }` | weapons |
| ↳ | a MANUALLY cycled action being worked, emitted 180 ms after the shot. `duration` is how long the throw takes. Only weapons whose def sets `boltAction` emit it; a self-loader's action noise is a layer inside the gunshot instead. | |
| `weapon:melee` | `{ weapon, phase: 'swing'\|'hit', kind: 'slash'\|'stab', surface, position }` | weapons |
| ↳ | `swing` on every attack with `position: null` (it is the player's own arm, head-locked). `hit` only when the blade reached something, with a surface from the table below — `flesh` for a body, the collider's tag for a wall. A whiff emits `swing` and nothing else. | |
| `weapon:shell` | `{ position, velocity }` | weapons |
| `bullet:impact` | `{ point, normal, surface, incident, damage }` | physics |
| `bullet:tracer` | `{ from, to, speed }` | weapons |
| `damage:dealt` | `{ target, amount, headshot, killed, point }` | ai / physics |
| ↳ | means *damage dealt **to** `target`*. `target` is the local player when an enemy round connects (`'player'`, the player system, or anything with `isPlayer === true`) — filter it out before drawing a hitmarker. Damage is applied by the target's own listener, never by the emitter as well. | |
| `damage:taken` | `{ amount, from: Vector3, health }` | player |
| `actor:death` | `{ actor, point, impulse }` | ai |
| `player:land` | `{ velocity, surface }` | player |
| `player:footstep` | `{ position, surface, running }` | player |
| `player:state` | `{ stance, sprinting, sliding, ads }` | player |
| `explosion` | `{ position, radius, damage }` | any |
| `resize` | `{ width, height }` | engine |
| `match:round` | `{ round, phase, attackers, score }` | match |
| `match:capture` | `{ zone, owner, previous, score }` | match |
| ↳ | DOMINATION: a capture point changed hands. `zone` is its id (`'A'`/`'C'`/`'B'`), `owner` the team that now holds it, `previous` the team that lost it or `-1` for neutral, `score` the live `[red, blue]` array. Emitted the frame the bar fills, and only in `RULES.mode === 'domination'`. Ownership is also the forward-spawn test, so this is the moment a spawn opens for one side and closes for the other. See `src/match/capture.js`. | |
| `match:bomb` | `{ state, site, fuse, carrier }` | match |
| ↳ | DEMOLITION only. | |
| `match:result` | `{ winner, reason, score, matchOver }` | match |
| `match:respawn` | `{ name, team, isPlayer }` | match |
| ↳ | somebody is back on their feet inside the round. Fires for a bot and for the local player on the same path, `RULES.respawnDelay` after the death. A respawned bot is a NEW `Agent`; anything holding the old one has a corpse. | |
| `match:airstrike` | `{ phase: 'inbound'\|'impact'\|'settled', site, position }` | match |
| ↳ | an airstrike on one of the eight fixed strike sites (three that take a storey down and change the map, five smaller ones over the attackers' approach). `inbound` is the telegraph (4.4 s of jet and whistle before it lands), `impact` is the frame it goes off, `settled` is when the rubble stops moving and becomes collision. The blast itself is a normal `explosion` event, so nothing has to listen to this to take damage. The payload object is REUSED — copy what you need. See `src/match/airstrike.js`. | |
| ↳ | a site may also be a WHOLE BUILDING rather than a mass on top of one. Those sites are not authored in `airstrike.js` at all — they are derived from `world.demolitions`, one per block that carries a cached destroyed state, and grouped into one telegraphed salvo per flank district (`DISTRICT-A`, `DISTRICT-B`). `settled` is the frame the ruin becomes ground, and unlike every other site that is a frame on which the map gains walkable cells rather than losing them. | |
| ↳ | an airstrike may also be a SALVO: three adjacent sites on one city block, called as one telegraphed event and fired a fifth of a second apart (`airstrike.callSalvo`, `RULES.airstrikeSalvoPerRound`). Every member still emits its own `inbound`/`impact`/`settled`, so nothing listening has to know; what changes is that ~2100 chunks come down over 30 m of frontage and a five-column dust wall occludes the lane for ~20 s. | |
| `match:bomber` | `{ phase: 'inbound'\|'impact'\|'settled', run, position }` | match |
| ↳ | an aircraft crossing the map and walking a STICK of 5-8 bombs along one of four fixed lines. `inbound` is the launch — the aeroplane itself is the telegraph and is on screen for 2.4 s before the first bomb is even released; `impact` fires once PER BOMB, with `position` at that bomb's crater; `settled` is when the debris stops moving. It changes no collision and no navigation, unlike the airstrike. Each bomb is a normal `explosion` event. The payload object is REUSED — copy what you need. See `src/match/bomber.js`. | |

| `match:strafe` | `{ phase: 'inbound'\|'impact'\|'settled', run, position }` | match |
| ↳ | FIGHTER SUPPORT FIRE — an aircraft crossing low along one of four fixed lines with its gun open, walking 11-31 cannon impacts down a lane in about a second. `inbound` is the launch (the aeroplane and its gun are the telegraph, ~3.3 s before the first round lands); `impact` fires once per impact that carries a blast, which is every fourth one — see the DAMAGE IS SAMPLED note in the file; `settled` is when the grit stops moving. It changes no collision and no navigation. The payload object is REUSED — copy what you need. See `src/match/strafe.js`. | |

| `match:drone` | `{ phase, id, team, position }` | match |
| ↳ | A SUICIDE DRONE, at each beat of its life: `launch` out of a side's base, `lock` when it has taken a man and started his warning, `dive` when it commits, `boom` when the warhead functions, `dead` when it was shot down before it could. Thirty a match, both sides combined, paced on `_matchProgress`; at most `RULES.droneMaxAloft` are ever in the air. The payload object is REUSED — copy what you need. `match.drones.list` is the live array, published for the same reason `match.tank.tanks` is: a rotor is a CONTINUOUS sound and cannot be built off a one-shot event. See `src/match/drone.js`. | |

| `weapon:flash` | `{ position, radius, duration }` | weapons / ai |
| ↳ | A FLASHBANG HAS FUNCTIONED. Emitted by BOTH throwers — `ThrownGrenades._flash` for the player's and `AiSystem._detonateThrown` for a bot's — with identical payloads, which is the whole mechanism: `ai` blinds every soldier inside `radius` with a real `MASK.EXPLOSION` line of sight from ONE listener, so a bang is a bang whoever threw it. `duration` is the full effect at the centre; a man at the edge gets a fraction of it. Bots implement the blind as NOT ACQUIRING (`pickVisibleHostile` returns null) plus a suppression shove — they keep walking, keep shooting at what they already believed, and simply cannot find anything new. @see `Agent.blind`. | |
| `weapon:smoke` | `{ position, radius, duration }` | weapons / ai |
| ↳ | A SCREEN IS BURNING, and it is a wall to the AI as well as to the eye. Same two emitters, same payload. `ai` keeps at most six live volumes as a flat array of five numbers each and refuses any sightline through the opaque core of one (`AiSystem._smokeBlocks`, inside `_sightTo`) — SYMMETRICALLY, so a bot cannot use his own cloud as a firing position either. `fx` draws it off `addSmokeSource`; nothing in `physics` knows it exists. | |

Additive fields on existing payloads, all optional and all ignorable:

| payload | field | meaning |
|---|---|---|
| `damage:dealt` | `source` | the actor that fired. Set by `physics` from `fireBullet({ shooter })`, and by `ai` for its own rounds. Absent ⇒ the environment. |
| `actor:death` | `by` | kill credit: the actor that landed the last round, or null. |
| `explosion` | `kind` | what the ordnance IS, when the `source` had to be a string. `'grenade'` is read by `Armour._takeBlast` (`fragMul`) and is set by `ai`'s own frag and by the drone. |
| `explosion` | `label` | a display string for the kill cam, when the blast belongs to something with a name that is not an actor. The drone sets `'SUICIDE DRONE'`. |
| `explosion` | `team` | which side fired it, for the same reader. `-1` ⇒ nobody's. |
| `weapon:flash` | `team` | which side threw it. `ai`'s listener gives that side 0.3 of the blind rather than all of it, because they were told on the net before it landed — a bot flashes a door at 6-22 m and the radius is 16, so without this a squad blinds itself on every assault. Absent (the player's own) ⇒ everybody takes it in full. |

`label` and `team` exist because `Armour._takeBlast` passes a NON-string `source`
straight through to `tank.lastHitBy` and from there to `ai.teamOf` and the
killfeed — so a weapon that wants to be NAMED without being an actor cannot put
itself on `source`. They are read by `PlayerSystem.lastDamage` and by nothing
else in the engine.

`source` is what makes team damage, kill credit and the killfeed possible at
all, and it is threaded through without changing a signature in
`src/physics/penetration.js`: `fireBullet` latches the shooter for the duration
of the trace, because the penetration solver emits its events synchronously.

If you need an event that is not listed, add a row here in the same commit.

## Surface types

Shared vocabulary for impact FX, decals, audio and footsteps. Physics tags every
collider with one of: `concrete`, `metal`, `wood`, `dirt`, `sand`, `glass`,
`water`, `foliage`, `fabric`, `flesh`, `rubber`, `plaster`.

## Render integration

`render` exposes these to other subsystems:

```js
const r = ctx.get('render');
r.renderer            // THREE.WebGLRenderer — do not change its state outside a frame
r.registerPass(pass)  // insert a custom post pass
r.addLight(light)     // register a punctual light so it participates in culling/budgets
r.requestEnvMap()     // PMREM env map currently in use
r.screenSize          // { width, height } of the internal render target
r.depthTexture        // linear depth, for soft particles / SSR
r.velocityTexture     // motion vectors, for TAA / motion blur
```

Anything drawn into `viewScene` is composited after the world with a cleared
depth buffer.

Per-object opt-outs, honoured every frame by `render._collect`:

```js
mesh.userData.owNoPrepass = true  // keep out of the depth/normal/velocity prepass
mesh.userData.owNoShadow  = true  // do not cast into the CSM cascades
```

`owNoShadow` is the ONLY shadow-caster switch: the cascades draw with
`scene.overrideMaterial` and never consult `mesh.castShadow`. `src/ai` relies on
this for its off-screen actor LOD.

### The point-light count is a shader permutation key

`r.addLight()` puts a light under distance culling, and the cull sets
`light.visible = false` once the fade reaches zero. Three bakes the number of
**visible** point lights into every material's program cache key, so one lamp
crossing its radius recompiles every lit material in the scene — measured at
+33 to +36 programs and 640-900 ms on that single frame, five times in 900
frames. Anything that registers distance-culled point lights must keep the
visible count constant. Two ways, both pixel-exact:

- drive `intensity` to 0 and leave `visible` true (what `src/fx/lights.js` does), or
- park zero-intensity "ballast" lights and top the count up to a fixed slot
  budget every `lateUpdate` (what `src/world` does for its 17 practicals — see
  `_stabiliseLightCount`, which mirrors the renderer's own fade test because the
  cull runs *after* `lateUpdate`).

A light whose colour × intensity is exactly 0 adds a float `0.0` to the
irradiance accumulator, so extra lit slots cannot move a pixel.

### Pre-warm

`src/core/prewarm.js` runs before the first frame and calls
`prewarmMaterials(ctx)` on every subsystem that implements it (`render`,
`world`, `ai`). The contract: **build and compile every material the subsystem
can produce, without spawning gameplay objects, drawing a gameplay frame, or
touching the clock/RNG.** `renderer.compileAsync(scene, camera)` alone only
reaches the forward lit variant — not the CSM depth pass, the MRT prepass, or
the post chain. Two traps:

- A render target must be bound while compiling. `outputColorSpace` and
  `toneMapping` are part of the cache key and are read off the *currently bound*
  target, so compiling with the canvas bound warms the wrong variant.
- `fx` is excluded and self-warms on frame 2: its key depends on the visible
  light count, which is only settled inside the first rendered frame.

## Quality bar

Every visual subsystem is reviewed by an adversarial critic against real CoD
frames. Non-negotiables:

- **No flat/untextured surfaces.** Every material needs albedo variation, a
  normal map, roughness variation, and a detail layer visible at 0.5 m.
- **No uniform lighting.** Contact shadows, bounce, ambient occlusion, and a
  clear key/fill/rim separation.
- **Physically plausible values.** Albedo in 0.02–0.9, metals are 0 or 1,
  real-world light intensities, exposure-driven not multiplier-driven.
- **Nothing perfectly straight, clean, or repeated.** Edge wear, grime in
  crevices, subtle warp, varied instance rotation/scale.
- **Every action has weight.** Recoil, camera shake, screen-space impulse,
  audio transient, and a visual FX on every impact.
