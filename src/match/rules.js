/**
 * MATCH — the ruleset.
 *
 * Sudden Attack's 폭파미션 (demolition), which is where the game's whole feel
 * comes from: no respawn inside a round, one life, a 2 minute clock, and a bomb
 * that turns a lost gunfight into a won round if the C4 is already down.
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
  /** Players per side, INCLUDING the human on their team. 7v7, as SA runs it. */
  teamSize: 7,
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
  /** Round clock. Runs out ⇒ defenders win, exactly as SA scores it. */
  roundTime: 120,
  /** C4 fuse once planted. The round clock stops mattering the moment it starts. */
  bombTime: 40,
  plantTime: 4,
  defuseTime: 7,
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

  /* ---- combat ---- */
  /**
   * SA has no health regeneration — the 100 HP you spawn with is the 100 HP you
   * have for the round. This is the single biggest reason the game plays
   * cautiously compared with the Call of Duty tuning this engine shipped with.
   */
  regen: false,
  friendlyFire: false,
  /** Rounds that connect with a teammate still make noise; they just do no harm. */

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

/** Callsigns, so the killfeed and scoreboard read like a real server. */
export const BOT_NAMES = [
  ['HAWK', 'VIPER', 'RONIN', 'SABLE', 'KILO', 'ORCA', 'ZENITH', 'DRIFT', 'CINDER'],
  ['FROST', 'TALON', 'NOMAD', 'AZURE', 'ECHO', 'MAKO', 'VECTOR', 'SPARK', 'GLACIER'],
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
