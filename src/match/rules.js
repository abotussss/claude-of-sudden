/**
 * MATCH — the ruleset.
 *
 * Sudden Attack's 폭파미션 (demolition), retuned into a WAR rather than a duel:
 * fifteen a side, a five minute clock, and respawns inside the round the way a
 * team deathmatch runs them. The bomb is still the only thing that wins it early
 * and the clock is still the only thing that ends it late — respawning changes
 * the TEXTURE of the fight, not the win condition.
 *
 * WHAT CHANGED FROM THE ONE-LIFE VERSION, and why each number is what it is:
 *   teamSize 7 -> 15      thirty actors on the map; see the LOD notes in src/ai
 *   roundTime 120 -> 300  a 15v15 execute needs minutes, not seconds
 *   respawns  off -> on   a death is a 6 second penalty, not the end of a round
 *
 * Everything a designer would want to turn is here. Nothing else in `src/match`
 * hardcodes a duration or a count.
 */

export const TEAM = { RED: 0, BLUE: 1 };
export const TEAM_NAME = ['RED', 'BLUE'];
/** Team tints, matched to the HUD's --enemy / --friend so the palette is one system. */
export const TEAM_COLOR = ['#ff6a52', '#66b4ff'];

export const ROLE = { ATTACK: 'attack', DEFEND: 'defend' };

export const RULES = {
  /* ---- teams ---- */
  /**
   * Players per side, INCLUDING the human on their team.
   *
   * 15, not the 7 SA runs: the brief was "敵も15-15で戦いたい / もっと戦争的に" —
   * make it read as a war. Thirty actors is more than double the thirteen this
   * mode was tuned at, and it is NOT free. What pays for it, measured in
   * `src/ai`:
   *   • A* is rationed per frame (`ai.pathsPerFrame`), scaled with the roster.
   *   • Line of sight is two rays per actor per frame on a rotating cursor, so
   *     perception is O(actors), not O(actors²).
   *   • An actor that cannot reach a pixel this frame animates at a third rate
   *     and leaves the shadow cascades (`ai._updateRelevance`).
   *   • Corpses are reaped (`ai.corpseLimit`) — with respawns on, a five minute
   *     round produces far more bodies than ragdoll solving can carry.
   * Raise this further only with `matchprobe`-style numbers in hand.
   */
  teamSize: 15,
  /** The human's team. The other side is bots either way. */
  playerTeam: TEAM.RED,

  /* ---- match ---- */
  /** First to this many rounds takes the match. */
  roundsToWin: 4,
  /** Hard cap — 3-3 goes to a single decider. */
  maxRounds: 7,
  /** Attack and defence swap once this many rounds have been played. */
  swapAfterRound: 3,

  /* ---- clocks (seconds) ---- */
  /** One-off, before the first round: lets the level finish streaming in. */
  warmup: 5,
  /**
   * Weapons locked and FEET locked (see `Agent._advance` and
   * `player.movementLocked`) — both sides hold at spawn.
   *
   * This comment used to say "this is where you change loadout (B)". There is
   * no loadout screen and B is the fire-mode toggle; the claim was wrong and is
   * removed rather than left to mislead.
   */
  freeze: 10,
  /**
   * Round clock. Runs out ⇒ defenders win, exactly as SA scores it.
   *
   * 300 (five minutes), up from 120. The brief: "時間内に爆破できなかったら終了
   * システムで5分の戦闘にして". Two minutes was a one-life sprint; with respawns
   * and thirty men it takes that long just to establish which lane the fight is
   * on. Everything that reads this clock was checked: the HUD formats it with
   * `mmss()` so 300 draws as "5:00", the C4 fuse is its own clock (`bombTime`
   * below) and is independent of this one, freeze time is unchanged, and the
   * round-over dwell is unchanged.
   */
  roundTime: 300,
  /**
   * C4 FUSE once planted. The round clock stops mattering the moment it starts.
   *
   * SIXTY, up from 40 — "C4自体は1分解除時間を与えること". It is not a cosmetic
   * number: it is the whole of whether a defuse is a play or a lottery. The
   * moment the charge goes down, `_respawnsOpen` closes and the defence fights
   * the rest of it with the men it has; those men then have to cross the map,
   * break a fifteen-man hold on the site and stand still for `defuseTime` in
   * the open. MEASURED over 17 rounds on the 40 s fuse: 12 plants, 5 defused,
   * and in 5 of the 12 no defender ever got within `defuseRadius` of the
   * charge at all. 60 s is 50 % more crossing time for the same fight.
   *
   * Everything that reads it was checked: the HUD clock switches to the fuse on
   * the plant and formats it with `mmss()`, so 60 draws as "1:00"; the C4's
   * blink and beep schedule is expressed as a FRACTION of this (see
   * `Bomb.update`), so it still starts at ~1 Hz and still ends at ~7 Hz; and
   * the plant banner prints this figure rather than a literal.
   */
  bombTime: 60,
  plantTime: 4,
  defuseTime: 7,
  /**
   * How many defenders are told to go and CUT the charge, rather than to hold
   * the ground around it.
   *
   * One, which is what this used to be, is a single point of failure: the man
   * `_nearestTo` picked is regularly pinned in a firefight thirty metres away
   * or dead a second later, and the re-task only happens on the two second
   * objective refresh — by which time the same one man is picked again because
   * he is still, on paper, the nearest. Three men means the charge is being
   * walked at from three directions and one death does not stall the defuse.
   * It is not the whole team: `retake` still has to clear the site, and a team
   * that all stands on the charge is a team that gets killed on the charge.
   */
  defuseCrew: 3,
  /**
   * ONE ATTACKER IN EVERY `flankShare` TAKES THE LONG WAY ROUND.
   *
   * "攻める側は裏どりや屋内移動、マップをちゃんと拡大して移動に関しては攻める側が
   * 有利になるようにしてください" — the attack's advantage on this map is
   * MOVEMENT, and it was not being used: all fifteen men were handed the same
   * point and A* handed all fifteen the same lane, so a site with three mouths
   * was only ever entered through one of them and the defence only ever had to
   * hold one direction.
   *
   * 3 — a third of the attack — is the split that leaves the main push heavy
   * enough to take the site on its own. It is applied by roster index, not by
   * dice, so the same men flank all round and nobody changes his mind on the
   * two second objective refresh. @see `MatchSystem._flankTarget`
   */
  flankShare: 3,
  /** Scoreboard dwell between rounds. */
  roundOverTime: 6,
  matchOverTime: 16,

  /* ---- bomb ---- */
  /**
   * DEFAULT SITE RADIUS, and the only place it is written down.
   *
   * This used to be dead. `MatchSystem._siteAt` tested against a per-site
   * `radius` authored separately in sites.js, so the knob documented here as
   * "how close the carrier has to be to plant" did nothing at all and the real
   * number lived in two other places — while this file's header claims nothing
   * else hardcodes a duration or a count. sites.js reads this now, and a site
   * may still override it.
   *
   * WIDENED from 4.5 to 8. A bomb site is a ZONE you fight over, not a dot you
   * stand on: at 4.5 m the plantable area was smaller than the courtyard it sat
   * in, so the carrier had to walk to a specific spot with no marking on the
   * ground telling them where it was. 8 m makes each site a 16 m circle, which
   * is the scale Sudden Attack and Counter-Strike sites actually are, and means
   * a plant can be made from cover rather than only from the middle.
   */
  plantRadius: 8,
  /** How close a defender has to be to work on the C4. */
  defuseRadius: 1.8,
  /** Planting or defusing breaks if you leave the radius or take your finger off. */
  interruptGrace: 0.25,
  blastRadius: 22,
  blastDamage: 600,

  /* ---- airstrike ---- */
  /**
   * THE AIRSTRIKE IS NOT A SECOND C4, and these are deliberately not
   * `blastRadius` / `blastDamage`.
   *
   * The C4's 22 m / 600 is a round-ENDING blast: it is meant to be unsurvivable
   * anywhere near the site, because the round is over when it goes off. An
   * airstrike lands mid-round with fourteen people alive, so at those numbers a
   * single strike would routinely take four men off the board for standing in
   * the wrong street — which is not a hazard, it is a coin flip.
   *
   * 15 m / 260 keeps the same falloff `src/player/index.js` and `src/ai` already
   * apply to the C4 (linear in distance) and makes the strike lethal inside
   * about 6 m, badly hurtful to 10 m, and survivable at the edge. You die if you
   * ignored the whistle; you limp if you were slow.
   */
  airstrikeRadius: 15,
  airstrikeDamage: 260,
  /**
   * Seconds into a LIVE round before the first strike may be called, on top of
   * which the whole telegraph (jet at -4.4 s, whistle at -2.6 s) still runs. The
   * opening of a round is when both teams are walking out of spawn with no
   * information; dropping a building on that is the one moment it is unfair.
   */
  airstrikeFirstDelay: 26,
  /** Gap between strikes, seconds. */
  airstrikeInterval: [28, 50],
  /**
   * Ceiling on strikes per round.
   *
   * There are eight strike sites now (three map changers plus five on the
   * attackers' approach) and a 300 s round divided by a 39 s mean gap would
   * spend every one of them. Five leaves the map different every round and
   * stops the whole town coming down every round.
   */
  airstrikeMaxPerRound: 5,
  /**
   * THE ROUTE STRIKE — the smaller one, on the way in to a site.
   *
   * "C4設置場所に行くまでのところに空爆ポイントを作ること … 守る側有利にして".
   * It drops a parapet and the wall under it into a lane the attack has to walk,
   * so it is cover-generating and lethal, but at 11 m / 190 it is survivable
   * from about 4 m out where the 15 m / 260 storey is not. A push through it
   * costs health and tempo rather than the round.
   */
  routeStrikeRadius: 11,
  routeStrikeDamage: 190,

  /* ---- the bomber run ---- */
  /**
   * "敵の戦闘機の爆弾投下も適宜行なって" — an aircraft that crosses and walks a
   * STICK of bombs along a line, as distinct from the single-point strike.
   *
   * Per bomb it is deliberately weaker than either strike: what makes a stick
   * dangerous is that there are eight of them 11 m apart across a lane, so
   * there is no single safe metre inside the run and the answer is to not be in
   * the lane rather than to find cover in it.
   */
  bombRadius: 9,
  bombDamage: 165,
  /** Seconds into a LIVE round before the first run may be called. */
  bomberFirstDelay: 44,
  /** Gap between runs, seconds. */
  bomberInterval: [52, 84],
  /** Ceiling on runs per round. */
  bomberMaxPerRound: 3,

  /* ---- combat ---- */
  /**
   * SA has no health regeneration — the 100 HP you spawn with is the 100 HP you
   * have for the round. This is the single biggest reason the game plays
   * cautiously compared with the Call of Duty tuning this engine shipped with.
   */
  regen: false,
  friendlyFire: false,
  /** Rounds that connect with a teammate still make noise; they just do no harm. */

  /* ---- respawns ---- */
  /**
   * RESPAWNS INSIDE THE ROUND — "爆破ミッションシステムだけど、チームデスマッチ
   * みたいにもっとリスポーンを許容して".
   *
   * The one-life rule is what made SA cautious, and it is exactly what a 15v15
   * cannot carry: at thirty men the first thirty seconds decide the round and
   * twenty-eight people then watch. So death costs `respawnDelay` seconds and
   * nothing else.
   *
   * THE WIN CONDITION IS UNCHANGED. A round is still won by the C4 going off,
   * by the C4 being cut, or by the clock. Elimination still scores — but only
   * when a side has nobody alive AND nobody queued, which is only reachable once
   * respawns have closed. See `MatchSystem._checkWinConditions`.
   */
  respawns: true,
  /** Seconds from death to being back on your feet. */
  respawnDelay: 6,
  /**
   * RESPAWNS CLOSE for the last stretch of the round, and the moment the charge
   * is armed. Without a close, a planted C4 is undefusable (the attack feeds men
   * onto it for ever) and the round can never end early — both of which make the
   * clock the only thing that ever decides anything. With it, the endgame is the
   * one-life mode the mode is named after.
   */
  respawnCutoff: 45,
  /**
   * SPAWN PROTECTION, in seconds. Implemented in `src/ai` as "you are not a
   * valid target": a freshly spawned actor is skipped by enemy target selection
   * for this long. It is deliberately NOT damage immunity — a man who walks into
   * a grenade still dies — because immunity you can shoot through is the thing
   * that makes spawn protection feel like a cheat.
   */
  spawnProtect: 4,
  /**
   * A spawn point is only used if the nearest live enemy is at least this far
   * away. `MatchSystem._safeSpawn` scores every point of the side's cluster and
   * takes the emptiest; this is the bar below which it will keep looking.
   */
  respawnSafeRadius: 26,

  /* ---- bots ---- */
  /**
   * MEAN bot skill, 0..1. Each actor draws its own around this (gaussian, sd
   * 0.19, clamped 0.12..0.95), and everything about how it shoots — cone,
   * tracking rate, hand shake, burst length, reaction time, how long it takes to
   * settle on a fresh target — is derived from that one number. See the comment
   * block in `src/ai/agent.js`.
   *
   * Lowered from 0.62: at that mean, two bots killed a full-health player in
   * under a second from across the street, with no regeneration to fall back on.
   * 0.44 gives a squad that ranges from genuinely dangerous to genuinely bad,
   * which is what makes a round readable.
   */
  botSkill: 0.44,
};

/**
 * Which side attacks in a given round (1-based). Rounds 1..swapAfterRound are
 * the human team's half on whichever side `RULES.playerTeam` starts on.
 */
export function attackingTeam(round) {
  const swapped = round > RULES.swapAfterRound;
  return swapped ? 1 - RULES.playerTeam : RULES.playerTeam;
}

export function roleOf(team, round) {
  return attackingTeam(round) === team ? ROLE.ATTACK : ROLE.DEFEND;
}

/**
 * Callsigns, so the killfeed and scoreboard read like a real server.
 *
 * There must be at least `RULES.teamSize` of them per side or two men share a
 * name and the killfeed stops being readable — `_spawnTeam` indexes this modulo
 * its length. Sixteen each, which covers 15 plus the slot the human occupies.
 */
export const BOT_NAMES = [
  ['HAWK', 'VIPER', 'RONIN', 'SABLE', 'KILO', 'ORCA', 'ZENITH', 'DRIFT', 'CINDER',
   'BASALT', 'QUARRY', 'TINDER', 'HALYARD', 'OBSIDIAN', 'RAMPART', 'JACKAL'],
  ['FROST', 'TALON', 'NOMAD', 'AZURE', 'ECHO', 'MAKO', 'VECTOR', 'SPARK', 'GLACIER',
   'COBALT', 'MERIDIAN', 'HALCYON', 'TUNDRA', 'PELAGIC', 'BOREAL', 'KESTREL'],
];

/**
 * Character variants each side wears.
 *
 * The read has to survive 40 m and a shadowed alley, so the split is
 * HELMET vs NO HELMET rather than a tint: RED is `vanguard`/`breacher` (arid and
 * urban camo, hard helmets, goggles) and BLUE is `irregular` (woodland, head
 * wrap, beard). Silhouette is the only cue that works at range.
 */
export const TEAM_VARIANTS = [
  ['vanguard', 'breacher'],
  ['irregular'],
];
