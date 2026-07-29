# OVERWATCH — engine contract

**Every agent must read this before writing code. It is the only coordination mechanism.**

Target: a browser FPS whose *visual and tactile quality* stands next to a modern
Call of Duty, playing Sudden Attack's demolition mode. WebGL2 + Three.js r180, no
external art assets — all textures, meshes, animation and audio are generated
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
| `match` | `src/match/` | the GAME: teams, the round state machine, bomb sites and spawns, the C4, scoring, spectating |

Shared, owned by the lead (do not edit): `src/core/`, `src/main.js`,
`src/dev/`, `tools/`, `vite.config.js`.

### `match` is the only gameplay owner

Everything above `match` in that table is the engine. `match` is the ruleset —
Sudden Attack's 폭파미션 — and it is the ONLY subsystem allowed to decide who is
on which side, when a round starts, who has the C4 and who won. The subsystems
it drives expose exactly these hooks and nothing more:

```js
ai.playerTeam / ai.friendlyFire / ai.combatEnabled / ai.matchControlled / ai.skill
ai.clearAgents()            ai.spawn(variant, pos, yaw, { team, name, role })
ai.teamOf(actor)            ai.getHudActors()
ai.protect(actor, seconds)  ai.targetable(actor)      ai.corpseLimit
agent.setObjective(mode, position, site, facing)   agent.working
player.team / player.name / player.alive
player.respawnAt(position, yaw)     player.health.regenEnabled
weapons.locked              weapons.resetAmmo()
weapons.scavenge(mags)      weapons.needsAmmo
ui.setRound(state)          ui.matchDriven      ui.isFriendlyTarget(actor)
world.levelYaw              world.levelToWorld(x, y, z, out)
```

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
| `match:bomb` | `{ state, site, fuse, carrier }` | match |
| `match:result` | `{ winner, reason, score, matchOver }` | match |
| `match:respawn` | `{ name, team, isPlayer }` | match |
| ↳ | somebody is back on their feet inside the round. Fires for a bot and for the local player on the same path, `RULES.respawnDelay` after the death. A respawned bot is a NEW `Agent`; anything holding the old one has a corpse. | |
| `match:airstrike` | `{ phase: 'inbound'\|'impact'\|'settled', site, position }` | match |
| ↳ | an airstrike on one of the eight fixed strike sites (three that take a storey down and change the map, five smaller ones over the attackers' approach). `inbound` is the telegraph (4.4 s of jet and whistle before it lands), `impact` is the frame it goes off, `settled` is when the rubble stops moving and becomes collision. The blast itself is a normal `explosion` event, so nothing has to listen to this to take damage. The payload object is REUSED — copy what you need. See `src/match/airstrike.js`. | |
| `match:bomber` | `{ phase: 'inbound'\|'impact'\|'settled', run, position }` | match |
| ↳ | an aircraft crossing the map and walking a STICK of 5-8 bombs along one of four fixed lines. `inbound` is the launch — the aeroplane itself is the telegraph and is on screen for 2.4 s before the first bomb is even released; `impact` fires once PER BOMB, with `position` at that bomb's crater; `settled` is when the debris stops moving. It changes no collision and no navigation, unlike the airstrike. Each bomb is a normal `explosion` event. The payload object is REUSED — copy what you need. See `src/match/bomber.js`. | |

Two additive fields on existing payloads, both optional and both ignorable:

| payload | field | meaning |
|---|---|---|
| `damage:dealt` | `source` | the actor that fired. Set by `physics` from `fireBullet({ shooter })`, and by `ai` for its own rounds. Absent ⇒ the environment. |
| `actor:death` | `by` | kill credit: the actor that landed the last round, or null. |

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
