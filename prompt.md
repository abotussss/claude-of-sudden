# The prompts

## 1. The engine

This repository is a fork of [mshumer/Claude-of-Duty](https://github.com/mshumer/Claude-of-Duty).
Everything below the gameplay layer — the renderer, the procedural materials, the
sky, the market street, the physics, the FX and the synthesized audio — came from
that repo, which came from this one prompt:

```
I want you to build a first-person shooter at the level of the most recent Call of Duty games. It should be utterly perfect, visually beautiful, with every single thing done at AAA quality—from textures to physics to anything you could think of.

Fan out sub-agents and have sub-agents tackle each one individually so that the game is utterly perfect. You should /loop on each item and have a separate sub-agent check it visually to ensure it looks triple A. That separate sub-agent should be a really harsh critic, and if it doesn't look triple A, it should keep going.

Don't stop until each sub-agent is utterly wowed with the quality when compared with the actual Call of Duty game. It should literally compare them side by side blind and say which one looks better. Do this in ThreeJS. /loop until it's utterly perfect. Fan out sub-agents and ultracode.
```

## 2. The game

The fork exists because a beautiful street with a garrison to shoot is not a
*game*. This is the prompt that turned it into one:

```
Take this repo and, changing GAMEPLAY ONLY, finish it as a Sudden Attack-style shooter.

The engine stays exactly as it is — renderer, materials, sky, the market street, physics, FX, audio: do not touch any of it, do not degrade a single pixel of it. What changes is what you actually do in it: 7v7 폭파미션. One life a round, no respawn, no health regen, a 120 second clock, a C4 that has to be walked onto a bomb site and armed, forty seconds of fuse, seven seconds to cut it. First to four rounds, sides swap at the half.

That means real teams, so the AI has to stop assuming the only thing worth shooting is the player — most of the men on the map are fighting somebody who is not you. It means kill attribution, a killfeed that knows which side you are on, a scoreboard, a round HUD, and a spectator camera, because in a no-respawn mode you spend real time dead.

Keep the map. Put the bomb sites in it, do not rebuild it. Every rule in one place, every number tunable. Don't stop until a round plays end to end: freeze, push, plant, retake, defuse, scoreboard, swap, next round.
```

## What that turned into

`src/match/` is the whole ruleset — four files, no geometry, no shaders. The rest
of the change is the hooks the ruleset needed: teams and an objective layer in
`src/ai`, a `respawnAt` and a regeneration switch in `src/player`, a locked
trigger and an ammo reset in `src/weapons`, a round HUD and a scoreboard in
`src/ui`, and one `shooter` field threaded through `src/physics` so a bullet
knows who fired it.

`ARCHITECTURE.md` lists every one of those hooks. Nothing in `src/match` reaches
past them.
