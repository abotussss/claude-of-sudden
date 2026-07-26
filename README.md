# Claude of Sudden

A 7v7 demolition shooter in the browser — Sudden Attack's 폭파미션 played on
[Claude of Duty](https://github.com/mshumer/Claude-of-Duty)'s engine.

**There are still no art assets.** Every texture, mesh, animation and sound is
generated procedurally at load time from code. No models, no HDRIs, no image
files, no audio files. The only runtime dependency is `three`.

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

## Performance — read this first

Two teams of seven means thirteen skinned characters on screen instead of
upstream's six, and this engine was already heavy. **The default preset is
`medium`, not `ultra`**, and the pixel-ratio cap is now part of the preset
rather than hardcoded at 1.5.

Measured on an M1 Pro (16-core GPU), headless Chromium with a live 7v7 round,
p50 frames per second:

| window | `low` | `medium` | `high` | `ultra` |
|---|---|---|---|---|
| 1728 × 1080 | **43** | **23** | 11 | 7 |
| 1280 × 800 | **64** | **36** | 19 | — |

Two knobs, in order of how much they buy you:

1. **Preset** — pause menu (Esc) → Graphics Preset, or `?q=low` in the URL.
   Switching in the menu reloads the page, because half of a preset (TAA, GTAO,
   SSR, volumetrics, shadow resolution) is built at boot and cannot be toggled
   live.
2. **Window size** — `medium` at 1280 × 800 is 36 fps against 23 at
   1728 × 1080. There is no visual quality cost at all, so try this before
   dropping the preset.

The single biggest change was exposing the pixel-ratio cap: on a Retina panel,
1.5 means a 4.2 MP drawing buffer. `low` and `medium` now cap it at 1.0
(1.87 MP), which roughly doubled the frame rate at every preset. `ultra` keeps
1.5 and is unchanged from upstream.

## The mode

Two teams of seven, one life each, on the market street.

| | |
|---|---|
| teams | 7 v 7 — you plus six bots against seven |
| respawn | **none**. You are out until the round ends |
| health | **no regeneration**. 100 HP is the round's budget |
| freeze | 10 s. Weapons locked, loadout free |
| round clock | 120 s. Runs out ⇒ the defence wins |
| the C4 | 4 s to plant, **40 s fuse**, 7 s to defuse |
| bomb sites | **A** — the west alley · **B** — the east alley |
| match | first to 4 rounds, sides swap after round 3, 7 rounds maximum |

The rule that shapes every round: **once the C4 is armed, the round clock stops
mattering.** Wiping the attack no longer wins if the charge is already down, so
five men trading themselves for a plant is a good trade, and a 4v1 retake is a
real thing that happens. That is the mode.

Everything above is one file — `src/match/rules.js`. Nothing else hardcodes a
duration or a count.

## Controls

Click the canvas to lock the cursor.

| | |
|---|---|
| WASD / mouse | move / aim |
| LMB / RMB | fire / ADS |
| **F (hold)** | **plant or defuse the C4**, pick a dropped charge back up |
| **Tab (hold)** | **scoreboard** |
| R · Shift · Ctrl · Space | reload · sprint · crouch · jump |
| 1 / 2 / 3 · wheel | rifle / SMG / pistol |
| Q / E | lean |
| Esc | release the cursor |

Dead, you spectate a living team-mate. LMB / RMB cycles who.

*(Tab used to cycle weapons in the upstream repo. It is the scoreboard here, as
it is in Sudden Attack; 1/2/3 and the mouse wheel still swap.)*

## What's in it

The engine is upstream's, untouched:

| subsystem | what it does |
|---|---|
| `render` | HDR pipeline, cascaded shadow maps in a `sampler2DArray` with texel snapping and PCSS contact hardening, MRT depth/normal/velocity prepass, GTAO, TAA with YCoCg variance clipping, tile-dilated motion blur, Karis bloom pyramid, GPU EV100 metering, procedural 33³ grade LUT, AgX composite |
| `materials` | GPU texture forge: 19 procedural surfaces, periodic noise so everything tiles seamlessly, Sobel height→normal, parallax occlusion mapping, triplanar projection, curvature-driven edge wear |
| `sky` | Atmospheric scattering, time of day, PMREM environment generation, volumetric fog and light shafts |
| `world` | ~120×120 m market street: modular building kit with real wall thickness, enterable interiors, several hundred instanced props |
| `physics` | Written from scratch, no library. Binned-SAH BVH, swept-capsule character controller, impulse rigid bodies with CCD, PBD ragdolls, multi-layer bullet penetration |
| `fx` | GPU particles, decals, tracers, muzzle flash, explosions |
| `audio` | Web Audio synthesis — no sound files. Layered weapon fire, convolution reverb, HRTF spatialisation, occlusion |

The game on top of it:

| subsystem | what it does |
|---|---|
| `match` | **new.** Teams, the round state machine, bomb sites and spawns in the level's own coordinates, the C4, scoring, the spectator camera |
| `ai` | Teams. An actor now looks for anything hostile to *its own side*, not for the player — most of the men on the map are fighting somebody who is not you. Plus an objective layer (push / plant / hold / defuse / retake), friendly-fire immunity, and spotted-only enemy radar |
| `player` | Team, `respawnAt`, and a switch that turns health regeneration off |
| `weapons` | A trigger `match` can lock, and a per-round ammo reset |
| `ui` | Round strip (who is left), C4 fuse panel, scoreboard, spectator line, and a killfeed that knows which side you are on |

### Some specifics worth recording

**Spawn separation is a gameplay parameter.** The map is one straight street and
an actor's view range is 58 m. At the first spacing tried the two spawn clusters
were 51 m apart, so both sides acquired a target on the spawn frame and spent the
round trading shots down the middle instead of playing the objective. The closest
pair is now 60.5 m — past the range at which anybody can see anybody — and the
round opens with two teams walking. See the comment in `src/match/sites.js`.

**Bomb sites are snapped to the navigation grid, not trusted.** Authoring a site
six inches inside a wall is the classic way to lose a whole team to a stuck
pathfind, so every authored point is resolved onto the nearest walkable cell at
boot, with a street fallback and a warning if the primary misses.

**Attribution needed one field, not a refactor.** Team damage, kill credit and
the killfeed all need to know who fired a round. `physics.fireBullet` latches the
shooter for the duration of the trace — the penetration solver emits its impact
events synchronously — so `damage:dealt` carries a `source` without a single
signature changing in `src/physics/penetration.js`.

**Line-of-sight is rationed.** Fourteen actors each testing thirteen candidates
would be ~180 rays a frame. Each actor re-tests the enemy it already has plus two
others on a rotating cursor, which settles on a target inside a tenth of a second
for about 40 rays a frame.

**Teams are read by silhouette, not by tint.** RED wears the helmeted
`vanguard`/`breacher` variants, BLUE the bare-headed `irregular`. At 40 m in a
shadowed alley a colour is not a cue and a helmet is.

## Tooling

Upstream's harness is intact and is arguably the interesting part of the repo.

| tool | purpose |
|---|---|
| `tools/capture.mjs` | Screenshot one named shot via GPU-backed headless Chromium |
| `tools/shotset.mjs` | All 11 shots in one session — fast review set |
| `tools/baseline.mjs` | **Reproducible** capture: each shot in an isolated page, fixed frame budget |
| `tools/imagediff.mjs` | Per-pixel gate. Exits non-zero if any pixel moved |
| `tools/profile.mjs` | Gameplay profiler at real device pixel ratio, with hitch attribution |
| `tools/playtest.mjs` | Scripted movement/fire smoke test |
| `tools/matchtest.mjs` | **new.** Plays whole matches headless on a time scale and prints every round transition. The smoke test for `src/match` |

```bash
npm run build && npx vite preview --port 4173
node tools/matchtest.mjs --url=http://127.0.0.1:4173/ --seconds=200 --scale=6 --botcarrier
```

`--botcarrier` hands the C4 to a bot each round: nobody is at the keyboard in a
headless run, so otherwise every round where your own side attacks times out
with the charge still in your hands, which says nothing about the mode.

Two findings from upstream worth keeping in front of you, because both
invalidated earlier measurements:

**Median frame time hides the actual problem.** A static-camera benchmark
reported 94 fps while the game was unplayable. Real gameplay at Retina DPR ran
12–17 fps with **728–1236 ms stalls** caused by 34+ WebGL programs compiling
lazily mid-frame. `profile.mjs` reports p50/p95/p99 and attributes each hitch,
which is what surfaced it.

**Captures were not reproducible.** `shotset.mjs` reuses one page across all 11
shots, so particle age, decal buffers and exposure state leak forward.
`baseline.mjs` isolates each shot in a fresh page, which is what makes
`imagediff.mjs` a usable gate.

Note that the capture shots were authored against upstream's garrison, which
`match` replaces. `?capture=1` still runs deterministically, but a shot that
expected a wandering patrol now finds the round's spawns instead.

## Honest assessment

**On the visuals**, upstream's own verdict stands and this fork did not touch
them: the goal was to match a modern Call of Duty and it does not. Eleven
independent adversarial critics scored the frames against that bar; scores went
3.59 → 4.14 → 4.05 → **5.05** out of 10, and in a blind A/B every critic in every
round picked the real Call of Duty frame. Hands, material richness at close
range, character read at distance and indirect light are all named weaknesses,
and the viewmodel light rig still delivers roughly 20× the irradiance per unit
albedo that the world does.

**On the game**, what is verified is that a round runs end to end — freeze,
advance, contact, plant, retake, defuse, scoreboard, next round — with both AI
sides fighting each other rather than only the player. What is *not* claimed:

- The bots take a site; they do not execute a strategy. There is no smoke, no
  flash, no coordinated entry, and the "one man defuses while the rest cover"
  rule is a nearest-man assignment, not a plan.
- Bot skill is one number (`RULES.botSkill`) scaling reaction time. There is no
  difficulty curve and no per-bot personality.
- The three upstream weapons (M4A1, MPX-9, P-19) are the whole armoury. Sudden
  Attack's loadout screen, knives and grenades are not in this build.
- **The map favours the defence.** Across headless matches, attacks planted
  roughly a third of the rounds they played; the rest ended on the clock or with
  the attack wiped. On one straight street a stationary defence holding both
  flanks is simply strong, and no attempt has been made to tune that out. Site A
  and site B have not been compared against each other at all.

What the headless matches *did* verify, repeatedly and with no page errors: all
four round-end conditions fire (detonation, defusal, either side eliminated, the
clock), the sides swap at the half, the match ends at four rounds and restarts,
a dropped charge gets picked back up, and both AI sides plant when they get the
chance.
