/**
 * MATCH — the ruleset.
 *
 * TWO MODES LIVE HERE AND `RULES.mode` PICKS ONE.
 *
 * `domination` is what the game is played in now — "爆破サイトにするとゲーム性が
 * 悪いのでドミネーションにします". Three capture points (A/B/C), a point tick per
 * held zone, forward spawns on what you hold, first side to `scoreTarget` wins.
 * See the DOMINATION block below and src/match/capture.js.
 *
 * `demolition` is Sudden Attack's 폭파미션, which this file used to be the only
 * ruleset for. It is kept REACHABLE — set `RULES.mode = MODE.DEMOLITION` and the
 * C4, the round-per-site win conditions and the side swap all come back — but it
 * is no longer the mode the game boots into, and none of the domination numbers
 * touch it.
 *
 * WHAT CHANGED FROM THE ONE-LIFE VERSION, and why each number is what it is:
 *   teamSize 7 -> 20      forty actors on the map; see the LOD notes in src/ai
 *   roundTime 120 -> 300  a 20v20 execute needs minutes, not seconds
 *   respawns  off -> on   a death is a 6 second penalty, not the end of a round
 *
 * Everything a designer would want to turn is here. Nothing else in `src/match`
 * hardcodes a duration or a count.
 */

/** The two rulesets `MatchSystem` can run. @see RULES.mode */
export const MODE = { DEMOLITION: 'demolition', DOMINATION: 'domination' };

export const TEAM = { RED: 0, BLUE: 1 };
export const TEAM_NAME = ['RED', 'BLUE'];
/** Team tints, matched to the HUD's --enemy / --friend so the palette is one system. */
export const TEAM_COLOR = ['#ff6a52', '#66b4ff'];

export const ROLE = { ATTACK: 'attack', DEFEND: 'defend' };

export const RULES = {
  /**
   * WHICH RULESET. `MODE.DOMINATION` is the game; `MODE.DEMOLITION` is the C4
   * mode this repo shipped with, kept switchable rather than deleted.
   */
  mode: MODE.DOMINATION,

  /* ---- teams ---- */
  /**
   * Players per side, INCLUDING the human on their team.
   *
   * 20, not the 7 SA runs and not the 15 that came after them: "あと２０VS20に
   * してください、キャラを増やして欲しい". Forty actors is three times the thirteen
   * this mode was tuned at, and it is NOT free. What pays for it, measured in
   * `src/ai`:
   *   • A* is rationed per frame — and the ration is a MILLISECOND budget
   *     (`ai.pathMsBudget`) turned into a solve count, so a bigger roster does
   *     not silently cost more frame time; it costs each man a longer wait.
   *   • Line of sight is two rays per actor per frame on a rotating cursor, so
   *     perception is O(actors), not O(actors²).
   *   • An actor that cannot reach a pixel this frame animates at a third rate
   *     and leaves the shadow cascades (`ai._updateRelevance`).
   *   • Corpses are reaped (`ai.corpseLimit`) — with respawns on, a five minute
   *     round produces far more bodies than ragdoll solving can carry.
   *
   * WHAT 15 -> 20 ACTUALLY COST, MEASURED, and it is NOT free. Six headless
   * matches run to a natural end (`_events.mjs`, seeds 11/22/33), all six on the
   * SAME tree and the SAME 500-point match, with only `teamSize` moved — an A/B
   * against the old 250-point baseline would have charged the roster for the
   * longer match as well, which is the mistake this table exists to avoid:
   *
   *              live bots   frame mean   frame p95   A* deferred/frame   ration
   *   15v15         29         38.6 ms      73.2 ms         1.20           6.98
   *   20v20         39         49.1 ms      86.8 ms         5.19           6.11
   *
   * Read those milliseconds as a RATIO and not as a frame rate: the probe runs
   * at `time.scale` 12, so one rendered frame carries twelve seconds' worth of
   * spawns, deaths, ragdolls and events. +27 % of mean and +19 % of p95 is the
   * honest cost of ten more men; the absolute numbers are a stress rig.
   *
   * WHERE IT REALLY LANDS IS A* WAITING, and that is the number to watch. The
   * ration is round-robin, so a man is served every `agents.length / ration`
   * frames: 4.2 frames at 29 actors, 6.4 at 39, and deferred requests went 1.20
   * -> 5.19 a frame. `pathMsBudget` was deliberately NOT raised to buy that
   * back, because the symptom starvation produces is measurable and did not
   * appear — `tools/stuckcheck.mjs` reports 0 stuck of 39 (the crowding epidemic
   * that once wedged 22 of 29 men on nav islands at doorways did NOT come back
   * at forty) and distance travelled per bot is 142-525 m over the sample
   * against 65-390 m at fifteen a side. A budget raised against a problem
   * nobody can measure is just frame time spent.
   *
   * @see the SPAWNS note in src/match/sites.js for the other half of the
   * roster's cost: fifteen stand points for twenty men stacks bodies, so the
   * cluster is seven ranks now.
   *
   * Raise this further only with `matchprobe`-style numbers in hand.
   */
  teamSize: 20,
  /** The human's team. The other side is bots either way. */
  playerTeam: TEAM.RED,

  /* ---- match ---- */
  /** First to this many rounds takes the match. */
  roundsToWin: 4,
  /** Hard cap — 3-3 goes to a single decider. */
  maxRounds: 7,
  /**
   * Attack and defence swap once this many rounds have been played.
   * DEMOLITION ONLY — domination is symmetric, both sides want all three points,
   * and each side keeps one base for the whole match. @see `attackingTeam`
   */
  swapAfterRound: 3,

  /* ==================================================================== */
  /* DOMINATION                                                           */
  /* ==================================================================== */
  /**
   * "占領サイトを一定時間いるとポイント加算で、サイトを占領するとそこからリスポーン
   * 可能で、奪われたら既定のリスポーン位置からのスポーンのみ"
   *
   * Three zones, presence captures them, holding them prints points, and holding
   * one moves your spawn on to it. Every number below was picked against the map
   * this actually runs on, not against a genre average — the notes say which.
   */

  /**
   * Zone radius, metres. The two courtyards are 15 x 14 m and the mid street's
   * gap between the K1 and K2 islands is ~16 m of open tarmac, so an 8 m circle
   * is "the whole courtyard / the whole gap and nothing outside it". It is the
   * same figure the C4's `plantRadius` used for the same courtyards, which is
   * not a coincidence: it is what fits.
   */
  captureRadius: 8,
  /**
   * Seconds for ONE man alone to take a zone from neutral or from the enemy.
   *
   * Nine. It has to be long enough that a lone bot walking through cannot flip
   * the map by accident and short enough that a squad of four takes a point in
   * about three seconds — see `captureCrowdBonus`. It is ONE bar, not
   * neutralise-then-capture: a single readable HUD bar with an owner colour is
   * worth more here than Battlefield's two-stage rule.
   */
  captureTime: 9,
  /**
   * Every man in the zone beyond the first adds this much of the base rate, so
   * n men capture at `1 + 0.42(n-1)` times solo speed: 1 man 9.0 s, 2 men 6.3 s,
   * 4 men 3.7 s, and the cap below lands at 5 men. "占領時間は人数でスケール".
   */
  captureCrowdBonus: 0.42,
  /** Ceiling on that multiplier — fifteen men must not flip a point in 0.6 s. */
  captureMaxRate: 2.8,
  /**
   * Progress bleed-back per second when NOBODY is standing in the zone. A
   * half-finished capture that survives for ever means a zone flips minutes
   * later for no reason the player can see; at 0.18 a 60 % bar is gone in about
   * three and a half seconds of an empty point.
   */
  captureDecay: 0.18,
  /**
   * CONTESTED: both sides inside the circle. Equal numbers freeze the bar; the
   * side that OUTNUMBERS the other advances it at the rate for the difference, so
   * one man on a defended point achieves nothing and a side that masses more men
   * than the garrison takes the ground. The long note on `_updateZone` in
   * src/match/capture.js has the two matches that a hard freeze deadlocked.
   */

  /** Seconds between score ticks. */
  scoreInterval: 4,
  /** Points per zone owned, per tick. Two zones ⇒ 1 point/second. */
  scorePerZone: 2,
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * FIRST SIDE TO THIS WINS — AND IT IS THE KNOB THE WHOLE SCHEDULE HANGS OFF
   * ──────────────────────────────────────────────────────────────────────────
   * "ポイントも５００ポイントにして占領の ２５０は終わるの早い" — and he is right,
   * measured: three matches at 250 ran to a natural end in 244, 268 and 212 s
   * (`_events.mjs`, seeds 11/22/33). Four minutes is not a match.
   *
   * IT IS ALSO WHAT MAKES "後半3〜5分" A REACHABLE WINDOW AT ALL. The note on
   * `cathedralOpenProgress` used to end by declaring that ask UNSATISFIABLE, and
   * the reasoning was sound: at 250 a match runs 212-268 s, so no instant in it
   * is five minutes from the end and only its first thirty seconds are three.
   * That note deliberately refused to touch this number because a five minute
   * FIGHT was the other thing that had been asked for. Both are now asked for,
   * and at 500 both exist: measured 448-520 s of match, of which the last five
   * minutes are a real 300 s of playable time.
   *
   * WHY 500 IS NOT SIMPLY "TWICE AS LONG", AND WHY IT NEEDED MEASURING. There
   * are FIVE zones now (A, C, E, B, and D on the cathedral collapse) and every
   * held zone pays every `scoreInterval`, so income is far higher than when 250
   * was set: the leader accumulates 1.0-1.4 pt/s once the map has settled, not
   * the ~1 pt/s two zones pay. Doubling the target therefore roughly doubles the
   * match rather than more than doubling it — 448-520 s against 212-268.
   *
   * AND IT CHANGES WHICH TERM OF `_matchProgress` BINDS, WHICH IS THE PART A
   * RE-TUNE MUST NOT MISS. Progress is `max(elapsed/matchTime, leader/500)`.
   * The score term no longer overtakes the clock term in the first minute: it
   * crosses at t ≈ 100-155 s depending on how fast the leader is printing, so
   * the first two minutes of the match are CLOCK-bound (progress linear in time)
   * and everything after is SCORE-bound (progress convex in time). Every
   * threshold below 0.20 is therefore now a wall-clock time in disguise. @see
   * the `bind` column `_events.mjs` prints.
   */
  scoreTarget: 500,
  /**
   * Match clock, seconds. Runs out ⇒ the higher score wins, equal ⇒ a draw.
   * Replaces demolition's per-round `roundTime` (which is still used by that
   * mode).
   *
   * TEN MINUTES IS NOW ONLY 1.15-1.34x THE LENGTH OF A DECISIVE SCORE RACE, not
   * the 2.2-2.8x it was at `scoreTarget` 250, and that margin is deliberately
   * left alone: a match that goes the distance because neither side can hold
   * anything SHOULD end on the clock, and at 448-520 s of measured race there is
   * still 80-150 s of headroom before it does. Raise `scoreTarget` again and
   * this has to move with it, or the clock silently becomes the ending and every
   * progress threshold below becomes a plain wall-clock time.
   */
  matchTime: 600,
  /**
   * FORWARD SPAWNS. A zone you own is a spawn for your side; the moment it is
   * taken, that option disappears and your base is all you have. Two guards:
   *
   * `forwardSpawnBlockRadius` — a forward point with a live enemy this close is
   * skipped, because respawning a man on top of somebody he cannot see is worse
   * than six more seconds of walking. Ownership already rules out spawning into
   * an ENEMY-held zone; this is only about the metre or two in front of him.
   *
   * EIGHT, down from 14, and the direction of that number matters. At 14 a zone
   * that was being attacked gave its owner NO forward spawn at all — so the side
   * under pressure lost its reinforcement loop at exactly the moment it needed
   * one, and every measured match snowballed for whoever got the opening. It is
   * per POINT, not per zone, so the standing points on the far side of a
   * courtyard from the fight stay usable while the contested edge does not, and
   * `RULES.spawnProtect` covers the four seconds after.
   *
   * THERE IS NO LONGER A `forwardSpawnBias`, and its removal is the fix rather
   * than a tidy-up. It was 34 m of "virtual safety" added to a forward point so
   * it would out-score the base in a single `max`, and the note that used to
   * stand here had the diagnosis right — "the base cluster wins nearly every
   * draw" — and the remedy wrong, because the gap it had to close was never 34 m.
   * Measured on the running match by `_spawnprobe.mjs`: a base cluster is 90-130 m
   * from the nearest live enemy and a point you are holding is 8-40 m, so
   * BLUE holding two zones with all fourteen standing points clear of the block
   * radius still had 0 of 14 beat its base, and a live beacon 23.9 m clear of any
   * enemy was chosen 0 times in 200 respawns.
   *
   * `MatchSystem._safeSpawn` is three tiers in preference order now — beacon,
   * then a zone you own, then the base — and the distance is only this veto and
   * a tie-break WITHIN a tier. Holding the point is what makes it a spawn, which
   * is what the brief asked for; no number needs to be tuned for that to be true.
   */
  forwardSpawnBlockRadius: 8,
  /**
   * How many men a QUIET zone we already own keeps. The rest go and take
   * something. Two is enough to contest a capture long enough for the objective
   * refresh to send help, and small enough that a side that owns two points
   * still has eleven men doing something about the third.
   */
  zoneGarrison: 2,

  /* ────────────────────────────────────────────────────────────────────────
   * THE CACHES — what `world.features` is WORTH.
   * ────────────────────────────────────────────────────────────────────────
   * "もっと屋内戦闘をさせたいので屋内のエリアを作ってそこにもAIがいく利点やメリットを
   *  与えて でないとAIが屋内戦闘しない … 屋上だったり３階のエリアなどにもメリットを
   *  与えて 例えば武器が落ちてるとか、武器はF長押しで交換可能にする グレネードを補充
   *  できる テンポラリーリスポーン地点としてのビーコンを起動できる（３０秒間）"
   *
   * `world` publishes twenty-four caches and decides nothing about them; these
   * are the numbers that make them a reason to be indoors. @see src/match/caches.js
   */
  /** Metres from a cache the prompt appears and the interaction reaches. */
  cacheUseRadius: 2.6,
  /**
   * Seconds of HELD F to take what a cache holds — "F長押し".
   *
   * 0.55, and it has to be long enough to be unmistakably a HOLD (`plantTime`
   * is 4 s, which is a different verb) and short enough that standing still for
   * it in a building is a risk rather than a sentence. A TAP under this figure
   * is the beacon instead, which is why there is a threshold at all rather than
   * an instant pickup: one key, two verbs, no second bind. @see `_updateCacheUse`
   */
  cacheHoldTime: 0.55,
  /**
   * Seconds before the same cache gives anything again. Long, on purpose: a
   * cache you can stand next to and milk is a supply depot, and what this is
   * meant to be is a REASON TO CROSS THE MAP. Two frags every forty seconds
   * means going and getting them, then going somewhere else.
   */
  cacheCooldown: 40,
  /** Magazines per weapon from an ammunition dump. `weapons.scavenge` caps it. */
  cacheAmmoMags: 2,
  /** Frags from a grenade stack. `weapons.resupplyGrenades` caps it at 2 carried. */
  cacheGrenades: 2,
  /**
   * THE PLAYER'S OWN FRAG CLOCK — "グレネードの補充は1分に一回まで 補充できすぎると
   * ゲーム性崩壊する".
   *
   * `cacheCooldown` is PER CACHE, and that is not the same rule: this map
   * publishes six grenade stacks, so a man who learns the building can walk a
   * circuit of three of them and carry frags permanently — forty seconds of
   * cache cooldown is no cooldown at all when there are six caches. This one is
   * per PLAYER and it is the binding constraint: sixty seconds between frag
   * resupplies wherever you get them.
   *
   * It is spent only when frags actually change hands (`resupplyGrenades`
   * returns > 0), so walking onto a stack with a full pouch cannot burn the
   * minute, and it is NOT refunded by dying — a respawn already hands out a
   * fresh loadout and making death the fast way to frags is the same collapse
   * from the other end.
   */
  grenadeResupplyCooldown: 60,
  /**
   * Metres a cache is drawn on the HUD from. The features are INSIDE buildings
   * and on roofs, so a marker has to appear before the doorway or the player
   * never learns the room is worth entering — but a marker on all twenty-four
   * is a wall of icons. 26 m is about one building plus its street.
   */
  cacheMarkerRange: 26,
  /**
   * THE BEACON — "テンポラリーリスポーン地点としてのビーコンを起動できる（３０秒間）".
   *
   * Thirty seconds, as asked, and it is the FIRST tier of `_safeSpawn` rather
   * than a third candidate in one auction. It used to be the latter and it was
   * measured winning 0 respawns in 200 with a beacon live and clear, because it
   * is planted at a cache in contested ground and so always has the smallest
   * distance-to-nearest-enemy of the three options. Something you spend a
   * `beaconCooldown` on, and then never come back at, is not a feature.
   *
   * `forwardSpawnBlockRadius` still vetoes it outright, so a beacon with an enemy
   * standing on it is not used and the side falls through to a zone it holds and
   * then to its base; a beacon that has run out is tested on the clock, not the
   * flag. Winning the tier is not the same as being unconditional.
   *
   * `beaconCooldown` is measured from the moment one is PLANTED, so the feature
   * is up for 30 of every 75 seconds at best. A permanent forward spawn wherever
   * you like would beat holding a zone, which is the mode's own currency.
   */
  beaconTime: 30,
  beaconCooldown: 75,

  /* ────────────────────────────────────────────────────────────────────────
   * THE MEDICAL ZONE — "医療ゾーンを作り、そこで医療キットをFで取得したら体力を
   * ５０回復するようにして 医療ゾーンは基本、敵味方関係なく使えるようにして"
   * ────────────────────────────────────────────────────────────────────────
   * IT IS A CACHE, AND THAT IS THE WHOLE IMPLEMENTATION. `src/match/caches.js`
   * is already the "walk to a thing, press a key, get a benefit" system: it has
   * a use radius, a hold, a per-cache cooldown, a refusal that says WHY, a HUD
   * marker, a world prompt and twenty-six authored positions that
   * `tools/floorcheck.mjs` proves a man can stand on. A med kit needs every one
   * of those and nothing else, so a fifth `kind` is the entire change and there
   * is no parallel mechanism to keep in step.
   *
   * `world` PUBLISHES NO SUCH KIND AND MUST NOT. `world.features` is four
   * strings and `world` "may not decide what a pickup gives" — so `match`
   * PROMOTES two of the published features to `medic` at init, by id, which is
   * exactly the split ARCHITECTURE.md describes. @see `MEDIC_FEATURES`.
   *
   * "敵味方関係なく" IS A STATEMENT ABOUT TEAMS AND IT IS SATISFIED BY DOING
   * NOTHING: no cache in this file has ever had an owner. `Caches.take` never
   * looks at a team, the zone stands on neutral flank ground either side of the
   * map, and a beacon can still be planted on it by whoever gets there — which
   * is the one thing on a cache that IS per side.
   */
  /** HP one med kit returns. "体力を５０回復". */
  medicHeal: 50,
  /**
   * Seconds before the SAME med post hands out another kit.
   *
   * 30, against `cacheCooldown`'s 40, and shorter on purpose: a resupply crate
   * is a reason to cross the map (that is what its own note says it is for) and
   * a dressing station is a place you retreat to under fire. Half a minute is
   * long enough that it cannot be milked mid-firefight and short enough that
   * falling back to one twice in a push is a real option.
   *
   * There is deliberately NO per-player clock like `grenadeResupplyCooldown`.
   * Frags needed one because six stacks on the map made a circuit; there are two
   * med posts and they are 70 m apart on opposite flanks, so the walk between
   * them IS the cooldown.
   */
  medicCooldown: 30,

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
   * ══════════════════════════════════════════════════════════════════════════
   * BLAST BURST HEIGHT — metres the DAMAGE point sits above the impact point.
   * ══════════════════════════════════════════════════════════════════════════
   * "空からの爆撃の爆撃範囲をもっと広げて、つまり爆撃の当たり判定が小さいので広くして
   *  もっと戦争のように爆撃によってダメージをおいやすくして"
   *
   * THE HITBOX WAS NOT SMALL BECAUSE THE RADIUS WAS SMALL. Measured over one
   * whole match, seed 11 (`_blastcount.mjs`, `_blastwhy.mjs`): 166 blasts of
   * every kind, TWO kills, and a mean of 0.0-3.0 damage handed out per blast.
   * Raising `airstrikeRadius` on its own would not have moved either number, and
   * that is the trap this constant exists to name.
   *
   * `src/ai`'s explosion handler is three gates — `d > radius` skip, then
   * `lineOfSight(blast, a.eye, MASK.EXPLOSION)` skip, then `damage * f²` with
   * `f = 1 - d/r`. Both of the first two were eating everything:
   *
   *   source        blasts   men in radius   LOS BLOCKED   LOS clear   lethal
   *   airstrike r15    12          9              7             2         0
   *   airstrike r11     5         15             15             0         0
   *   bomber    r9     15          4              4             0         0
   *   strafe    r5.5   14          2              2             0         0
   *
   * — 0.75 men inside a 15 m storey strike, and SEVEN OF NINE of them behind
   * something. The occluder is not a building: the mean height of the detonation
   * point above the men it was measured against was 0.46-1.61 m, i.e. the charge
   * goes off at ANKLE HEIGHT and the kerb, the mound it just made and the ground
   * plane itself are what the ray to a man's eye hits. A bomb that detonates
   * inside its own crater cannot see anybody.
   *
   * 1.7 m is head height. It is not a fudge factor — a bomb's fireball centre is
   * above its crater, which is why every one of the `fx` calls in these files
   * already lifts its own flash and haze by 0.2-1.0 m. What changes is that the
   * DAMAGE now starts from the same place the fire does.
   *
   * IT IS APPLIED WHERE `match` OWNS THE EMIT — `Airstrike._detonate` (every
   * strike, route strike, salvo and district), `_cathShell` and `_bombardPoint`.
   * `src/match/bomber.js` and `src/match/strafe.js` emit from their own files and
   * are widened through their radii below instead; said here rather than left to
   * be discovered.
   */
  blastBurstHeight: 1.7,
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
   * 15 m / 260 kept the same falloff `src/player/index.js` and `src/ai` already
   * apply to the C4 and was meant to be lethal inside about 6 m, badly hurtful
   * to 10 m, and survivable at the edge.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * 15 -> 24 AND 260 -> 300, AND THE RADIUS IS DOING MOST OF THE WORK
   * ──────────────────────────────────────────────────────────────────────────
   * The paragraph above describes a weapon that never happened: twelve of these
   * in a whole match found NINE men inside the circle between them. A 15 m
   * circle on a 114x141 m map with forty men on it contains nobody most of the
   * time, and that — not the falloff — is "当たり判定が小さい".
   *
   * 24 m quadruples the ground the circle covers, and because `f = 1 - d/r` is
   * relative to the radius it also roughly doubles what a man at a FIXED
   * distance takes: at 8 m, `260·f²` was 57 and `300·f²` is 116. Read as lethal
   * radii against a 100 HP man — the honest way to read a quadratic falloff —
   * a bot dies inside 5.7 m before and inside 10.1 m after, and the player
   * (whose falloff is `^1.6`, not `²`) inside 6.8 m before and 12.0 m after.
   *
   * WHY IT IS NOT A WIPE: the LOS gate is untouched and it is severe. A man
   * round a corner from a 24 m blast still takes exactly nothing, so the answer
   * to a strike is still "be behind something", which is what a town is for.
   * @see `blastBurstHeight` for the measurement, and the commit for the after.
   */
  airstrikeRadius: 24,
  airstrikeDamage: 300,
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
   * so it is cover-generating and lethal, but at 11 m / 190 it was survivable
   * from about 4 m out where the storey strike is not. A push through it costs
   * health and tempo rather than the round.
   *
   * 17 / 230, widened with the storey strike and by the same ratio, so the two
   * keep the RELATIONSHIP the paragraph above describes rather than each being
   * re-tuned on its own. It was the worst offender in the measurement: five of
   * them found fifteen men inside the circle and every single one of the fifteen
   * was behind something (`_blastwhy.mjs`). @see `blastBurstHeight`.
   */
  routeStrikeRadius: 17,
  routeStrikeDamage: 230,
  /**
   * THE SALVO — "大規模爆破で街が破壊されるとか起きないね？ちゃんと発生させて
   * ください。街を破壊するようなイベントです".
   *
   * One strike takes the top off one building, and that is a parapet coming off
   * one roof. A salvo is THREE of the fixed sites on the same city block called
   * as ONE announced event and fired a fifth of a second apart: two added
   * storeys and a parapet, ~2100 chunks in the air at once across roughly thirty
   * metres of street, three mounds, three fireballs, and a dust wall that
   * occludes the lane for the better part of a quarter of a minute.
   *
   * ONE PER ROUND, and never in the first minute. It is the round's event: two
   * of them would spend the whole town by the halfway mark and there would be
   * nothing left for the next round to be about. It counts DOUBLE against
   * `airstrikeMaxPerRound` because it consumes three of the eight sites.
   */
  airstrikeSalvoPerRound: 1,
  /** Seconds into a LIVE round before the salvo may be called. */
  airstrikeSalvoDelay: 58,

  /* ---- the bomber run ---- */
  /**
   * "敵の戦闘機の爆弾投下も適宜行なって" — an aircraft that crosses and walks a
   * STICK of bombs along a line, as distinct from the single-point strike.
   *
   * Per bomb it is deliberately weaker than either strike: what makes a stick
   * dangerous is that there are eight of them 11 m apart across a lane, so
   * there is no single safe metre inside the run and the answer is to not be in
   * the lane rather than to find cover in it.
   *
   * 9 -> 15 AND 165 -> 210, AND THIS IS THE ONE THE PLAYER MEANT MOST LITERALLY:
   * "爆撃" is the aeroplane walking bombs down a street. Measured, fifteen bombs
   * across a whole match found FOUR men inside a 9 m circle between them and all
   * four were occluded — a stick with "no safe metre inside the run" that hit
   * nobody at all. At 15 m the craters are 11 m apart and the circles now
   * OVERLAP, which is the first time the sentence above has been true of the
   * geometry.
   *
   * THIS IS RADIUS ONLY, NOT BURST HEIGHT. `src/match/bomber.js` writes its own
   * `explosion` payload and is not this pass's file, so its bombs still detonate
   * at crater level and the LOS gate still eats more of them than it eats of a
   * strike. Named rather than hidden. @see `blastBurstHeight`.
   */
  bombRadius: 15,
  bombDamage: 210,
  /** Seconds into a LIVE round before the first run may be called. */
  bomberFirstDelay: 44,
  /** Gap between runs, seconds. */
  bomberInterval: [52, 84],
  /** Ceiling on runs per round. */
  bomberMaxPerRound: 3,

  /* ---- fighter support fire ---- */
  /**
   * "戦闘機からの援護射撃とかもイベント起きないね？" — a fast mover coming down a
   * lane with its gun open, which is a THIRD shape of air and not a smaller
   * bomb. Where a strike is a point and a stick is five craters over four
   * seconds, this is a continuous line of cannon impacts that WALKS the length
   * of a corridor in about a second and a half.
   *
   * Per shell it is the weakest thing in the air, and it has to be: the line is
   * unbroken, so anybody standing in that lane is inside it. The answer is the
   * same as the stick's — be out of the lane — but you get a second and a half
   * to act on it instead of four, which is what makes it a distinct threat and
   * not a re-skin. See `src/match/strafe.js`.
   *
   * 5.5 -> 8.0, DAMAGE UNTOUCHED. It is a GUN and the brief is about 爆撃, so
   * the per-shell figure stays where it is; what it gets is the same widening
   * every other air weapon got, because the measurement caught it too (fourteen
   * blast rounds, two men in radius, both occluded). A cannon shell that lands
   * three metres away should be felt. Damage is left at 74 on purpose: eleven to
   * thirty-one impacts walk a lane in a second and a half, and raising the per
   * shell figure as well would turn a strafing run into a guaranteed kill on
   * everybody in it.
   */
  cannonRadius: 8.0,
  cannonDamage: 74,
  /** Seconds into a LIVE round before the first strafing run may be called. */
  strafeFirstDelay: 34,
  /** Gap between runs, seconds. */
  strafeInterval: [44, 72],
  /** Ceiling on runs per round. */
  strafeMaxPerRound: 3,

  /* ---- armour ---- */
  /**
   * THE TANK — "そんで戦車イベントを早く追加しろ 総力上げて".
   *
   * One AI-crewed vehicle per side, driving its own end of the mid street on an
   * authored, boot-proved route. It is the only air/armour event on the map that
   * is a THING rather than a moment: the three air weapons happen to you in four
   * seconds, the tank is present for the best part of a minute and has to be
   * dealt with. @see src/match/tank.js
   *
   * HEALTH IS AGAINST THE ARMOUR TABLE, NOT AGAINST A RIFLE. `PART_MUL` in
   * tank.js is 0.22 on the glacis, 0.4 on the turret and 1.7 on the engine deck,
   * and what a round is really worth is MEASURED by `_tankttk.mjs` against the
   * real colliders rather than multiplied out of that table.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * 2600 -> 4000 — 「戦車の体力はもっと増やして 簡単に破壊されないように」
   * ──────────────────────────────────────────────────────────────────────────
   * AND IT CANNOT MAKE THE HULL INVULNERABLE, WHICH IS WHY IT IS SAFE TO RAISE.
   * The other half of the player's own brief is 「ただし簡単に壊れたら面白くない」,
   * and before the infantry could see armour at all three matches in four ended
   * with neither hull ever destroyed. The reason this number cannot take us back
   * there is STRUCTURAL rather than tuned: `airMul` and `fragMul` in tank.js are
   * RATIOS OF THIS FIGURE —
   *
   *     airMul  = 2 * tankHealth / damage    a bomb inside half its own blast
   *                                          radius destroys a full hull
   *     fragMul = tankHealth / 6 / damage    a frag ON the hull is worth a sixth
   *
   * — so a bomb and a squad's grenades cost EXACTLY what they cost at 2600, at
   * any health this line is ever set to. The only thing raising it moves is the
   * RIFLE, and the rifle astern is precisely what the player is reacting to:
   * measured at 2600, the engine deck was 58 M4 rounds, which is A MAGAZINE AND
   * A HALF, and a bolt gun looking down on it from one of `world.features`'
   * roof vantages was EIGHT.
   *
   * 4000 is derived from that, not picked: 44.83 per M4 round into the deck puts
   * the deck at THREE FULL MAGAZINES (90 rounds of the 240 a man carries), and
   * the bolt gun at 13. Measured after the change by `_tankttk.mjs`:
   *
   *     M4 into the deck      90 rounds  (3.0 magazines)   was 58
   *     AKM into the deck     73 rounds  (2.4 magazines)   was 47
   *     bolt into the deck    13 rounds                    was 8
   *     M4 into the glacis   687 rounds  — a man carries 240: still not a route
   *     frags at contact       7                           unchanged, by ratio
   *     one bomb at half its radius   a kill               unchanged, by ratio
   *
   * IF `Armour.oneWoundPerRound` IS EVER TURNED ON, THIS NUMBER MUST COME BACK
   * DOWN. A penetrating round is currently counted at both faces of the collider
   * box, so the astern deck's EFFECTIVE multiplier is 3.49 against the 1.70 in
   * the table. Switching that boolean multiplies deck damage by 1.70/3.49 =
   * 0.487, which is another health rise of the same size on top of this one — so
   * the figure that keeps the deck at three magazines would be 4000 x 0.487, or
   * about 2000. That decision is the player's and the boolean stays false.
   */
  tankHealth: 4000,
  /**
   * What killing one is worth to the side that did it, in DOMINATION points.
   *
   * 30. It was picked against a `scoreTarget` of 250, where it was 12 % of the
   * match; at 500 it is 6 %, or about twenty-five seconds of holding two zones.
   * LEFT AT 30 ON PURPOSE AND THE DROP IS THE POINT: the reason for the number
   * was "enough that a squad turning to deal with the tank is not throwing the
   * match away, small enough that it is a play and not a trophy", and in
   * SECONDS OF HOLDING — which is what a side actually trades away to go and
   * kill it — 30 points is worth more now, not less, because the match it is
   * being traded against is twice as long. Scaling it to 60 would have made one
   * hull worth a fifth of the whole `districtSalvoProgress` window.
   */
  tankKillScore: 30,
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * THE TANK IS THE CATHEDRAL'S CONSEQUENCE, NOT A TIMER
   * ──────────────────────────────────────────────────────────────────────────
   * "大聖堂破壊イベントの後には戦車も登場させて" — and before that,
   * "まだ戦車が登場したの一回も見ていないです".
   *
   * BOTH SENTENCES HAVE THE SAME CAUSE AND IT WAS MEASURED, NOT GUESSED
   * (`_tankdiag.mjs`, three matches). The tank was never broken: 2/2 hulls baked
   * at boot in 8 ms, the first sortie rolled at t = 91 s, both hulls drove their
   * full 57 m route, and both reversed out again 59 and 66 s later. What the
   * measurement also says is why nobody has ever seen one:
   *
   *   • the hull was ON SCREEN for 0 of 4058 frames it was alive;
   *   • it finished the sortie on 2600/2600 health — not one round from either
   *     side ever touched it;
   *   • its route's CLOSEST approach to a capture circle was 55-77 m.
   *
   * The map grew under the authored route (`SPAWNS` went out to level z ∓90,
   * the mid street was prised open to x ∓23, A and B went to the flank
   * districts) and the tank was left driving an empty street at a moment when
   * every man on the map was 60 m away on a flank. An event nobody is near did
   * not happen, exactly as `ui.airAlert`'s own header says of the airstrike.
   *
   * So the trigger is the one the player asked for. There is no first-sortie
   * timer any more: `MatchSystem` arms the armour `tankAfterCathedral` seconds
   * after the cathedral bombardment stops, which is the same moment D opens in
   * the wreckage — the fourth capture point and both tanks arrive together, and
   * the routes now END 24 m off the ruin instead of 35 m short of it. @see
   * `ROUTES` in src/match/tank.js.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * "IT ARRIVES IN THE LAST FEW SECONDS, OR NOT AT ALL" — MEASURED, AND IT DOES
   * NOT. THE NUMBERS ARE RECORDED HERE SO NOBODY RE-LITIGATES IT FROM MEMORY.
   * ──────────────────────────────────────────────────────────────────────────
   * The report this block was re-opened for was "seed 12 telegraphs at t = 262,
   * rolls at t = 268, of a ~276-316 s round; seed 7 never rolled at all in
   * 280 s". Both halves of that are artefacts rather than schedule:
   *
   *   • "~276-316 s" is the match length from the THREE-POINT era, quoted out of
   *     the block above. There are five points now and `scoreTarget` is 500;
   *     four matches run to a natural end below measure 380-460 s.
   *   • "never rolled in 280 s" is a probe budget expiring, not a match ending.
   *     Seed 7 rolls at t = 228 of a 460 s match.
   *
   * `_events.mjs`, four matches to a NATURAL end, stamped in the column the ask
   * is actually about — SECONDS BEFORE THE END. The last row is at `time.scale`
   * 4 rather than 12, i.e. four times the simulation fidelity, because the SCORE
   * RATE is what every threshold in this file is really measured against
   * (`_matchProgress` is score-dominated) and it is exactly what a coarse `dt`
   * distorts:
   *
   *                 length   cathedral        tank rolls       tank killed
   *   seed  7 @12x  460.2 s  t=200 T-260 44%  t=228 T-232 50%  —
   *   seed 12 @12x  380.0 s  t=200 T-180 53%  t=228 T-152 60%  —
   *   seed 21 @12x  412.0 s  t=208 T-204 51%  t=236 T-176 57%  —
   *   seed 12 @4x   444.0 s  t=228 T-216 51%  t=256 T-188 58%  T-56 (BLUE)
   *
   * So the hulls roll with 152-232 s of match left — two and a half to four
   * minutes — in every run, and the lag from the cathedral event opening to a
   * hull moving is 28 s in all four: 10 s of `cathedralLead`, 9 s to the
   * `armour` beat, this 3 s, and ~6 s of the tank's own telegraph.
   *
   * NOTHING IN THAT CHAIN WAS RETUNED, and the reason is the floor rather than
   * the mean. A measurement that says 152-232 s does not justify moving a
   * threshold whose floor is argued from `districtSalvoGap` (@see
   * `cathedralOpenProgress`): the second district salvo lands at t = 148-168,
   * and at 0.36 the collapse would move about fifteen seconds and would then
   * start being decided by that guard instead of by this schedule. Fifteen
   * seconds is not worth breaking a documented floor for.
   *
   * WHAT THE SAME RUNS DO SHOW IS A DIFFERENT DEFECT, and it is the one worth
   * looking at next: in three of the four matches NEITHER HULL WAS EVER
   * DESTROYED, over 152-232 s of life apiece, and the single kill that did land
   * was the FINAL COLLAPSE flattening BLUE rather than anybody shooting it.
   * That is a lethality question for `src/match/tank.js`, not a timing one —
   * and it is now measurable, which is all this schedule was ever blocking.
   */
  tankAfterCathedral: 3.0,
  /**
   * Gap between sorties, seconds. Both hulls have to be parked first.
   *
   * WAS [95, 140], WHICH IS ONE SORTIE PER MATCH NOW THAT THE FIRST ONE IS THE
   * CATHEDRAL'S. Measured: the collapse lands at t = 164-188 of a 276-316 s
   * match and a sortie runs ~70 s end to end, so the next window opened at
   * t = 330+ — after every measured match had already ended. 40-60 puts a
   * second sortie inside the endgame, which is where a tank belongs.
   */
  tankInterval: [40, 60],
  /**
   * Ceiling per match. Three sorties, each lasting about seventy seconds — but
   * the first cannot be called before the cathedral is down, so in practice a
   * match sees one or two and the ceiling is a guard rather than a schedule.
   */
  tankMaxPerMatch: 3,
  /**
   * THE MAIN GUN. 9 m / 300 is between the route strike and the full airstrike:
   * a direct hit kills, the splash off a wall two metres away kills, and being
   * behind the wall it hit does not. The reload is what makes it survivable —
   * five and a half seconds is long enough to cross a street.
   */
  tankMainRadius: 9,
  tankMainDamage: 300,
  tankMainReload: 5.5,
  /**
   * THE COAX. Per round it is a rifle bullet and it comes nine at a time behind
   * every main-gun shot, so standing in the open after the shell lands is the
   * second way it kills you.
   */
  tankCoaxDamage: 26,
  /** Metres the crew will engage inside. Beyond this it drives. */
  tankRange: 85,
  /**
   * IT BREWS UP. The ammunition going off is bigger than anything it fired —
   * being next to a burning tank when it goes is its own hazard, and it is the
   * reason killing one in a street is worth watching.
   */
  tankDeathRadius: 12,
  tankDeathDamage: 240,

  /* ---- the two districts, and the approaches they open ---- */
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * WHEN THE CITY ROUND A AND THE CITY ROUND B COME DOWN — one salvo each, both
   * early enough that the approaches they open are still worth something.
   * ──────────────────────────────────────────────────────────────────────────
   * "いろんな方向から到達可能にすること、今まで到達できなかった方向にある建物を物理的に
   *  壊し、到達できるようにして、BFのような感じで"
   *
   * THE MEASUREMENT THAT PUT THESE HERE — three matches run to their natural
   * end, each district timed at the first of its blocks that OPENS something
   * (`NW1`/`NW6`, `SE1`/`SE6`; the two avenue islands deny no route):
   *
   *   272.0 s match    A opened t = 248.3  (91 %)    B opened t = 130.2  (48 %)
   *   296.1 s match    A opened t = 267.7  (90 %)    B opened t = 268.3  (91 %)
   *   300.0 s match    A opened t = 159.4  (53 %)    B opened t = 263.7  (88 %)
   *
   * FIVE OF THOSE SIX OPENINGS WERE THE FINAL COLLAPSE, not an event anybody
   * scheduled: they land 22-36 s before the end because `finalCollapseProgress`
   * sweeps up whatever is still standing. A feature whose entire point is new
   * bearings was handing the players half a minute to use six of them. The one
   * time a district opened early it was the ordinary one-at-a-time strike draw
   * eating a single building out of it, which is also why the two halves of a
   * deliberately mirrored map got 158 s and 35 s of new routes in the same
   * match. Neither figure was authored; both fell out of the weighting.
   * @see `Airstrike._pickSalvo` and `Airstrike._scheduleNext`.
   *
   * WHAT "EARLY ENOUGH" IS, MEASURED. `tools/navcheck.mjs` on this map:
   *
   *   site A   attack spawns 119.0 .. 139.2 m      defend spawns 200.5 .. 219.9 m
   *   site B   defend spawns 114.2 .. 134.2 m      attack spawns 198.9 .. 219.4 m
   *
   * and an advancing bot runs `3.9 + aggression` m/s (`Agent._advance`), so 4.4
   * m/s for the average trait roll. The far side of a district is therefore 45 s
   * of walking, the near side 27 s, before `captureTime` (9 s solo, 3.7 s for
   * four men) and `respawnDelay` (6 s) — and that is unopposed, which the walk
   * to a contested point is not. ONE traversal-and-contest is ~60 s from the far
   * spawn. A bearing that opens with less than that left is decoration; a
   * bearing that is going to be fought over — opened, used, answered, used again
   * — needs two or three, so ~120-180 s of match after it opens.
   *
   * THE NUMBERS ARE PROGRESS, AND PROGRESS IS NOT TIME. `_matchProgress` is
   * `max(elapsed/matchTime, leader/scoreTarget)` and it is score-dominated after
   * the first minute, so equal steps in it are not equal steps in seconds — the
   * old `cathedralOpenProgress: 0.34` landed at 43 % of elapsed time, not 34 %.
   * These two were therefore chosen by measuring the (t, p) curve rather than by
   * reading the fraction. Measured over three matches after the change:
   *
   *   276.0 s match    A t = 92.4  (33 %)    B t = 117.4  (43 %)
   *   316.0 s match    A t = 100.4 (32 %)    B t = 125.4  (40 %)
   *   280.0 s match    A t = 96.4  (34 %)    B t = 121.4  (43 %)
   *
   * — both districts inside 32-43 % of every match, with 158-216 s left after
   * the later of the two, which is two to three traversals. Compare the six
   * openings above: 48-91 %, five of them with half a minute to go.
   *
   * TWO THRESHOLDS, NOT ONE, because the two events must not be one event: 0.08
   * of progress measures 25-31 s apart at the rate a match that is being won
   * accumulates it, and `districtSalvoGap` is the floor under that if a runaway
   * scoreline compresses it. Which district is first is still decided by where
   * the fighting is — @see `Airstrike.callDistrictSalvo`.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * AT `scoreTarget` 500 THESE TWO ARE WALL-CLOCK TIMES, NOT FRACTIONS ANY MORE
   * ──────────────────────────────────────────────────────────────────────────
   * THE VALUES DID NOT MOVE AND THEIR MEANING DID, which is exactly the trap the
   * paragraph above warns about, arriving from the other direction. Progress is
   * `max(elapsed/600, leader/scoreTarget)`. At 250 the score term overtook the
   * clock term at t ≈ 45 s, so everything here was score-bound. At 500 it does
   * not overtake until t ≈ 150-160 s — so BOTH district thresholds are now
   * resolved by the CLOCK term, and 0.20 and 0.28 are simply t = 120 s and
   * t = 168 s. Measured over three matches at 20v20 / 500 (`_events.mjs`, seeds
   * 11/22/33), first district / second district, as t and as seconds before the
   * end of the match that actually happened:
   *
   *   464.2 s match   A t = 129.2 (28 %, T-335)   B t = 167.6 (36 %, T-297)
   *   456.2 s match   A t = 122.2 (27 %, T-334)   B t = 168.0 (37 %, T-288)
   *   480.2 s match   A t = 125.2 (26 %, T-355)   B t = 164.8 (34 %, T-315)
   *
   * `districtSalvoGap` HAS STOPPED BEING THE BINDING CONSTRAINT. It used to set
   * the spacing exactly — 25.0 s in all three of the older matches — and the
   * pair is now 36-43 s apart because the clock, not a runaway scoreline, is
   * what carries progress between the two thresholds. The floor is still right
   * and still does nothing, which is what a floor should do.
   *
   * AND THEY STAY IN THE FIRST THIRD ON PURPOSE, while the cathedral moved into
   * the last five minutes. "後半3〜5分" is about the events that END the match;
   * a district salvo is a ROUTE-OPENER and the whole argument above is that a
   * bearing needs 120-180 s of match after it to be fought over rather than
   * admired. These now leave 288-355 s, against the 158-216 s that argument was
   * settled on. Moving them into the window would hand the players six new
   * approaches and no time to walk them.
   */
  districtSalvoProgress: [0.20, 0.28],
  /**
   * The floor under the gap between two big scheduled events, in SECONDS.
   *
   * A district salvo is three buildings over 1.1 s of stagger, a 4.4 s telegraph
   * ahead of it and 6.5 s of settle behind it — about twelve seconds of event.
   * A side that has taken all three zones prints 1.5 points a second, which is
   * 0.08 of progress in thirteen; without a floor in real seconds the two
   * thresholds collide in a runaway match, and three big events inside twenty
   * seconds is one big event. 25 s puts clear air between them.
   *
   * IT IS THE BINDING CONSTRAINT, NOT THE BACKSTOP, AND THAT IS WORTH KNOWING:
   * in all three measured matches the second district fired exactly 25.0 s after
   * the first, i.e. `districtSalvoProgress[1]` had already been passed and this
   * is what set the spacing. Raise it and the pair spreads; the second threshold
   * only takes over again in a match where the score crawls.
   *
   * The same guard holds the cathedral off a district that is still in the air —
   * @see `MatchSystem._updateMapEvents`.
   */
  districtSalvoGap: 25,

  /* ---- the cathedral, and what its destruction opens ---- */
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * THE BIG EVENTS ARE SCHEDULED ON MATCH *PROGRESS*, NOT ON THE WALL CLOCK
   * ──────────────────────────────────────────────────────────────────────────
   * "大イベントの発火時刻を実測し、後半3〜5分に寄せる" — and the measurement is the
   * reason these are fractions now. `_timeline.mjs` runs a match to its natural
   * end and stamps every event against the live clock. What it found:
   *
   *   match ends at t = 276 .. 288 s        (the clock allows 600)
   *   cathedral collapse   t = 210, 211     (73 % and 76 % of the way in)
   *   FINAL COLLAPSE       NEVER FIRED in any run
   *
   * A FRACTION IS NOT A TIME, THOUGH, AND THAT IS THE SECOND HALF OF THE LESSON:
   * every one of these has to be measured back into seconds after it is chosen,
   * because `_matchProgress` is score-dominated and the score curve is convex.
   * `_evwin.mjs` samples (t, p) every five seconds of a live match and prints
   * each event as a percentage of the match that actually happened; that is the
   * only evidence any number in this block is calibrated against.
   *
   * A DOMINATION match ends on `scoreTarget`, not on `matchTime`: two zones held
   * is a point a second, so 250 points arrives in under five minutes and the
   * 600 s clock only ever decides a genuine deadlock. Every absolute second in
   * this block had been authored against that 600 — so `finalCollapseAt: 470`
   * was 180 s past the end of every match that has ever been played, which is
   * why the player asked "いつ起きるの？" about an event that is not late, but
   * unreachable. That is a different bug from bad timing and it is worth naming.
   *
   * `MatchSystem._matchProgress()` is `max(elapsed / matchTime, leader /
   * scoreTarget)` — 0 at the start, 1 at whichever end actually arrives, and
   * monotone in both terms. Scheduling on it means an event fires at the same
   * point in the SHAPE of the match whether it is decided on points in four
   * minutes or runs the clock out in ten, and nothing has to predict the end.
   *
   * D — "大聖堂をDサイトとして途中で出現させて 大聖堂破壊イベントを通して".
   *
   * 0.34 WAS NOT THE SECOND HALF, AND THE ONLY WAY TO KNOW THAT IS TO MEASURE
   * IT. Three matches with the threshold at 0.34 called the collapse at
   *
   *   t = 124.0 of 288.0 s   43 %
   *   t = 140.1 of 296.1 s   47 %
   *   t = 136.0 of 300.0 s   45 %
   *
   * — before halfway in every one of them, which is not "後半" by any reading.
   * The reason is written two paragraphs down and it is the reason every number
   * in this block has to be re-measured rather than reasoned about: progress is
   * score-dominated, the score curve is convex, and 0.34 of the POINTS is
   * 43-47 % of the elapsed TIME.
   *
   * 0.50 MEASURES AT 59-67 %, over the same three matches:
   *
   *   t = 164.0 of 276.0 s   59 %   112 s left
   *   t = 188.1 of 316.0 s   60 %   128 s left
   *   t = 188.0 of 280.0 s   67 %    92 s left
   *
   * so the cathedral goes at about three fifths of the way in, and D —
   * `cathedralOpenDelay` later — has 85-120 s to be fought over. That is two
   * full traversals of the map (`tools/navcheck.mjs`: 112-134 m from either
   * spawn to the middle, at 4.4 m/s), so the fourth point is a second act and
   * not a flourish, which is what it was already meant to be. The spread is the
   * match itself: the 67 % run was the one close game of the three, and progress
   * reads the LEADER, so a match nobody is running away with reaches 0.50 later
   * in its own life.
   *
   * "後半3〜5分" WAS NOT SATISFIABLE, AND THE SENTENCE THAT USED TO STAND HERE
   * SAID SO AND NAMED THE KNOB. A match ran 272-316 s, so no instant in it was
   * five minutes from the end and only the first thirty seconds were three; the
   * knob that would make the window exist was `scoreTarget`, and it was left
   * alone because a five-minute FIGHT was the other thing that had been asked
   * for. It has now been asked for directly — "ポイントも５００ポイントにして" —
   * so it moved, and the window exists. @see `RULES.scoreTarget`.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * 0.44 -> 0.40, AND THE REASON IS THE SPREAD RATHER THAN THE MEAN
   * ──────────────────────────────────────────────────────────────────────────
   * MOST OF THE WORK WAS DONE BY `scoreTarget` AND NOT BY THIS NUMBER, which is
   * worth saying first because it is the non-obvious half. A fraction of the
   * SCORE converts to seconds-before-the-end at `(1 - p) * scoreTarget / rate`,
   * so doubling the target at an unchanged scoring rate DOUBLES the seconds any
   * fixed threshold buys. 0.44 bought 92-128 s of remaining match at 250; at 500
   * it bought 170-251 s without being touched.
   *
   * BUT THE WINDOW IS 180..300 AND 170 IS OUTSIDE IT. Six matches at 500 (two
   * builds, seeds 11/22/33) put D at T-226, 210, 214, 242, 202 and 170: five
   * inside, one out, and the miss is at the near edge — the collapse arriving
   * too LATE, with under three minutes left to fight over the point it opens.
   * A threshold whose distribution touches an edge is mistuned even when its
   * mean is fine, and the mean was fine (T-210).
   *
   * 0.40 RE-CENTRES IT. Measured over three matches run to a natural end
   * (`_events.mjs`, seeds 11/22/33), stamped in the column the ask is actually
   * about — SECONDS BEFORE THE END:
   *
   *                   collapse             D live          final    match
   *   seed 11   t=228.4 47 % T-255.8   t=238.2 T-246.0   T-72.2   484.2 s
   *   seed 22   t=228.4 49 % T-235.8   t=238.2 T-226.0   T-60.2   464.2 s
   *   seed 33   t=240.2 51 % T-232.0   t=250.0 T-222.2   T-80.2   472.2 s
   *
   * — the collapse at T-232..256 and D at T-222..246, every one of them inside
   * the last five minutes and clear of the last three by 42-66 s, with the whole
   * spread down from 72 s to 24 s. The fourth point gets 222-246 s of life
   * against the 85-120 s the paragraph above promised it, which is the fight
   * over D the brief asked for and not a flourish.
   *
   * THE TWO THINGS THAT SET THE FLOOR UNDER 0.40, so nobody lowers it further by
   * the same reasoning: the second district salvo lands at t = 150-168, and
   * `MatchSystem._updateMapEvents` now holds the cathedral to `districtSalvoGap`
   * of clear air behind it as well as to `airstrike.busy` — at 0.40 the gap
   * measures 49-66 s, and a threshold much below this starts being decided by
   * that guard instead of by the schedule. Below it the collapse would also pass
   * the halfway mark of the match, and D is a second act, not the map.
   *
   * THE ONE CASE THAT IS STILL OUTSIDE THE WINDOW, NAMED RATHER THAN HIDDEN: a
   * match that goes to `matchTime` instead of to `scoreTarget`. Progress is then
   * carried by the clock term, 0.40 resolves to t = 240 of 600, and the collapse
   * lands at T-360 — early, not unreachable. It needs a leader printing under
   * 0.83 pt/s for ten minutes; the measured matches print 1.03-1.13 and end on
   * points with 116-156 s of clock to spare. It is a deadlock case, and the fix
   * for it is `matchTime`, not this number.
   *
   * IT ALSO WAITS FOR CLEAR AIR. `_updateMapEvents` holds this off while a
   * district salvo is still in the air or settling; progress is monotone, so the
   * guard delays the branch by a few seconds and never skips it.
   * @see `RULES.districtSalvoGap`.
   *
   * The event telegraphs for `cathedralLead` and the wreckage takes
   * `cathedralOpenDelay` more to stop moving, so D goes live about half a
   * minute after the first thing the player hears. @see `cathedralLead`.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * 0.50 -> 0.44, AND BOTH REASONS ARE MEASUREMENTS RATHER THAN TASTE
   * ──────────────────────────────────────────────────────────────────────────
   * The paragraphs above were measured against a match that ran 276-316 s with
   * three capture points. There are FIVE now — E was added on the east flank
   * while this was being written — and a fifth point pays a fifth stream of
   * points, so the same `scoreTarget` arrives sooner: three matches run to their
   * natural end measured 232, 244 and 256 s. The event itself also grew, from a
   * 4.4 s telegraph and a 7.4 s wait to a `cathedralLead` warning and a
   * `cathedralOpenDelay` of 12. Neither number moved on its own and the two
   * compound, so at 0.50 D was opening at 66-73 % of a match against the 62 %
   * this block was tuned to, and the fourth point was getting 62-74 s of life
   * against the 85-120 s the paragraph above promises it.
   *
   * MEASURED AT 0.44 over three matches run to their natural end (`_tankdiag.mjs`,
   * `_events.mjs`) — see the commit message for the table. `scoreTarget` was
   * untouched at the time, because a five minute fight was the other thing that
   * had been asked for and this could not be paid for out of it. It has since
   * moved to 500 on its own account, and 0.44 was re-measured against it and
   * kept — @see the AND 0.44 DID NOT HAVE TO MOVE WITH IT block above.
   */
  cathedralOpenProgress: 0.40,

  /**
   * ──────────────────────────────────────────────────────────────────────────
   * THE CATHEDRAL EVENT — "大聖堂崩壊イベントは過激にそして激しく破壊し、大イベ
   * ントにしてください". The player's word for the old aftermath was 「しょぼい」.
   * ──────────────────────────────────────────────────────────────────────────
   * WHAT MADE IT SMALL WAS AN ORDERING BUG, AND IT IS MEASURABLE. `_razeIn` was
   * started when the collapse was CALLED, and the salvo does not land for
   * `Airstrike.JET_LEAD` = 4.4 s after that. Measured on a live match
   * (`_events.mjs`): collapse called at t = 164.0, `world.cathedral.razed` true
   * at t = 166.2, first `CATH-*` impact at t = 168.4. So the 30 x 45 m building
   * vanished TWO AND A HALF SECONDS BEFORE the first bomb arrived, and what the
   * bombs then did was drop three bays of roof off a church that was no longer
   * there. Every word of the paragraph this comment replaces — "the salvo goes
   * first and the swap happens inside it", "at 2.2 s the three CATH-* sites have
   * ~2100 chunks in the air" — described an event that had never once run in
   * that order.
   *
   * So `cathedralRazeDelay` is now measured FROM THE ORDNANCE ARRIVING and the
   * whole thing is a scored beat sheet rather than three independent countdowns.
   * @see `MatchSystem._updateCathedralEvent`, which owns the choreography:
   *
   *     t = 0.0            the WARNING: the alert strip with a `cathedralLead`
   *                        countdown, a danger reticle on each aiming point, the
   *                        banner and the siren. Long enough to get out, or to
   *                        find somewhere to watch it from.
   *     t = LEAD - 4.4     the salvo is called, so its own jet + whistle
   *                        telegraph lands exactly on the beat
   *     t = LEAD - 3.0     the barrage opens — `cathedralBarrageShells` heavy
   *                        shells walking the length of the nave
   *     t = LEAD           the salvo detonates: three bays, 1467 chunks
   *     t = LEAD + 0.3     the bomber runs the length of the mid street
   *     t = LEAD + 2.2     THE SHELL GOES, inside the ordnance this time
   *     t = LEAD + 3.4     the strafing run rakes the square
   *     t = LEAD + 8.0     the barrage's last shell
   *     t = LEAD + 9.0     the aftermath: "THE CATHEDRAL IS GONE"
   *     t = LEAD + 12.0    D opens in the wreckage (`cathedralOpenDelay`)
   *     t = LEAD + 15.0    both tanks roll (`tankAfterCathedral`)
   *
   * NOTHING IN ANY OF THOSE BEATS IS COMPUTED WHEN IT FIRES. The salvo, its
   * fracture, its trajectories, its settled pose and its nav patch were baked at
   * boot; the two aircraft are the runs `Bomber` and `Strafe` already baked; the
   * barrage's aiming points are solved once in `MatchSystem.init` into two
   * Float32Arrays and every shell is one reused `explosion` payload. The
   * heaviest frame in the whole event is the salvo's, which is the frame the old
   * event already had.
   */
  /**
   * Seconds of warning before the first thing lands. The salvo's own telegraph
   * is 4.4 s, which is right for "a strike is coming at that building" and far
   * too short for "the middle of the map is about to stop existing" — you cannot
   * cross the square in 4.4 s, so the only available reaction was to already be
   * elsewhere. Ten seconds is two hundred metres of sprint, or long enough to
   * turn round and watch.
   */
  cathedralLead: 10.0,
  /**
   * THE BARRAGE. Heavy shells walking the length of the nave and out into both
   * flanking streets, opening three seconds before the salvo and still landing
   * eight seconds after it.
   *
   * This is where "過激にそして激しく" is actually paid for. The salvo is 1467
   * chunks over ~0.5 s and then it is over; twenty shells over eleven seconds is
   * what makes it a BOMBARDMENT — a continuous rhythm of blast, dust, scorch and
   * concussion across a 30 x 45 m footprint, with the building coming apart in
   * the middle of it. Each shell is the canonical `explosion` event, so the
   * shake (`player._onExplosion`), the deafening (`Mixer.concuss`, which scales
   * with radius and reaches `radius * 1.3`), the fireball, the crater and the
   * damage are all the ones the game already has.
   */
  cathedralBarrageShells: 20,
  /** Seconds the walk takes, from the first shell to the last. */
  cathedralBarrageSpan: 11.0,
  /**
   * Per shell. Smaller than the zone bombardment's 10 m / 210 on purpose: there
   * are twenty of them rather than five, they are aimed at a BUILDING rather
   * than at a circle men are standing in, and ten seconds of warning is the
   * bargain. Lethal inside ~4 m, survivable at the rim.
   *
   * 9 -> 14 / 175 -> 205, widened with everything else. Twenty shells over
   * eleven seconds across a 30 x 45 m footprint at 14 m each is a beaten zone
   * with no gaps in it, which is what a bombardment is; ten seconds of siren
   * before the first one is what makes that fair.
   */
  cathedralBarrageRadius: 14,
  cathedralBarrageDamage: 205,
  /**
   * Half-extents of the beaten zone, in metres, on the cathedral's own axes —
   * across the nave and along it. The building measures 30 x 45 m, so this walks
   * the shells over the whole footprint and a few metres into each flank street.
   */
  cathedralBarrageHalfW: 17.0,
  cathedralBarrageHalfD: 24.0,
  /**
   * SECONDS AFTER THE ORDNANCE ARRIVES BEFORE THE SHELL STOPS BEING DRAWN, AND
   * WHY IT IS NOT ZERO.
   *
   * Swapping `cath:shell` for `cath:ruin` is one frame by construction — that is
   * the whole point of baking both states, and it is what makes a 30 x 45 m
   * building disappear without a hitch. But one frame is a POP, and the brief
   * asks for "大爆破と崩壊": an explosion and a COLLAPSE.
   *
   * At `cathedralLead + 2.2` the three `CATH-*` sites really do have ~1400
   * chunks in the air, three fireballs lit, the dust wall at its densest and
   * five barrage shells already down inside the footprint — so the church going
   * away happens BEHIND all of it. What the player sees is masonry coming off
   * the building, dust, and then no building, which is the order those things
   * happen in. Which is what the old comment claimed and the old code did not do.
   */
  cathedralRazeDelay: 2.2,
  /**
   * Seconds after the ordnance ARRIVES before D is contestable — the salvo's own
   * settle time (6.5 s) plus the tail of the barrage. The point opens when the
   * dust has a floor under it and nothing is still landing on it, not while
   * masonry is in the air. @see Airstrike.
   */
  cathedralOpenDelay: 12.0,
  /**
   * D is worth the same tick as any other zone, on purpose. A fourth point that
   * printed double would decide the match by itself and the answer to it would
   * be "everybody stands in the church" — which is one fight, not a map.
   */

  /* ---- the last event, and the two that keep you moving ---- */
  /**
   * THE FINAL COLLAPSE — "街を破壊するようなイベント", at the end.
   *
   * Every strike site still standing, fired as one rolling event, leaving a map
   * with no intact frontage, no roofline to hold and every lane full of rubble.
   *
   * This is the event `_timeline.mjs` measured firing ZERO times, because 470 of
   * a 600 s clock is 180 s after a match that ends on points is already over.
   * As a fraction it is late in every match instead of unreachable in all of
   * them. 0.82 leaves the rolling event (4.4 s telegraph, eleven sites at
   * `finalCollapseStagger`, 6.5 s to settle — about 17 s end to end) enough room
   * to finish and still be fought over rather than being the last thing anybody
   * sees. @see `cathedralOpenProgress` for why these are fractions.
   *
   * AT `scoreTarget` 500 IT GETS THE ROOM THE PARAGRAPH ABOVE ONLY ASKED FOR.
   * The same 0.82, measured over three matches at 20v20 / 500 (`_events.mjs`,
   * seeds 11/22/33): t = 380.0 / 376.0 / 420.0, which is T-84.2, T-80.2 and
   * T-60.2 before the end. At 250 the same fraction left 20-40 s — barely the
   * 17 s the event takes to roll — so the city came down and the match ended on
   * top of it. A minute to a minute and a half is a last act.
   */
  finalCollapseProgress: 0.82,
  /** Seconds between the members of the final collapse. Eleven sites, rolling. */
  finalCollapseStagger: 0.55,
  /**
   * PERIODIC BOMBING OF A AND B — "camping kills you".
   *
   * A strike walked on to whichever of A and B has been held longest, on a
   * random gap, telegraphed through `ui.airAlert` like every other air event.
   * The point is that the right answer is "move for ten seconds", not "never
   * stand here": the alert names the zone, the impact is on the zone centre, and
   * `bombardLead` is how long you have.
   */
  zoneBombardFirst: 95,
  zoneBombardInterval: [70, 105],
  /** How long the strip counts down before it lands. Ten seconds to walk out. */
  zoneBombardLead: 10,
  /**
   * Blast at the zone centre.
   *
   * 10 -> 16 / 210 -> 250. This is the ONE air event that was already working —
   * measured at 25 shells, 25 men in radius, 10 of them killed — because it is
   * the only one AIMED AT A CIRCLE MEN ARE STANDING IN rather than at fixed
   * geography. It is widened with the rest so a capture point under artillery is
   * a point you leave rather than a point you crouch on: a zone is `captureRadius`
   * 8, so 16 m is the whole circle plus the lip of cover round it, and the
   * `zoneBombardLead` of 10 s is unchanged — you are still told, and you can
   * still walk out.
   */
  zoneBombardRadius: 16,
  zoneBombardDamage: 250,
  /** How many impacts walk across the circle, and how far apart. */
  zoneBombardShells: 5,
  zoneBombardSpread: 5.5,

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

  /* ══════════════════════════════════════════════════════════════════════ */
  /* THE REINFORCEMENT DROP — the comeback, and nothing else                */
  /* ══════════════════════════════════════════════════════════════════════ */
  /**
   * "ゲリライベントとして増援イベントで 大幅に負けている（１００ポイント差とか、残り
   *  １００ポイントに相手チームがなったら）チームはたまに増援として１０人追加される
   *  ようにしてAI その場合、その１０人はリスポーンしない 形勢逆転要素なだけで、
   *  リスポーンなし 増援は占領されているサイト付近からヘリでパラシュート降下して登場
   *  するようにして"
   *
   * A side that is being beaten badly gets ten more men, ONCE, and those ten
   * never come back. It is a lever on the shape of a lost match and it is not a
   * lever on anything else — @see `reinforceRespawns` for why "does not respawn"
   * is a property of the MAN and not a branch in the spawn path.
   *
   * ────────────────────────────────────────────────────────────────────────
   * WHY THERE ARE TWO TRIGGERS AND NOT ONE
   * ────────────────────────────────────────────────────────────────────────
   * The player named both and they are not the same match. A hundred-point gap
   * is a side being ground down — it can happen at 150-50 with two thirds of the
   * match left. A side within a hundred of `scoreTarget` is a match that is
   * about to END, and the trailing side may be only forty behind. `MatchSystem`
   * ORs them, so the drop can be a mid-match correction or a last stand, which
   * are the two things a comeback mechanic is for.
   */
  /** Points behind before a side is "大幅に負けている". */
  reinforceDeficit: 100,
  /**
   * …or the enemy is within this many of winning AND IS AHEAD OF US. At
   * `scoreTarget` 500 this is the enemy on 400+, which measures at roughly the
   * last minute and a half of a decided match — late enough to be a last stand,
   * early enough that ten men walking off a drop zone can still reach a capture
   * point and hold it.
   *
   * "AND IS AHEAD OF US" IS NOT IMPLIED BY THE NUMBER AND HAD TO BE WRITTEN
   * DOWN. In a close finish both sides are inside a hundred of the target, so
   * the distance on its own qualifies the LEADER — measured, four of eight
   * drops over six matches went to the side that was winning. The subject of
   * the requirement is 「大幅に負けているチーム」 and the test lives in
   * `MatchSystem._updateReinforcements`, where the reasoning is written out.
   */
  reinforceEndgame: 100,
  /** Men in a drop. "１０人追加". */
  reinforceCount: 10,
  /**
   * ────────────────────────────────────────────────────────────────────────
   * WHAT "たまに" IS, AND WHY IT IS A DICE ROLL AND NOT A TIMER
   * ────────────────────────────────────────────────────────────────────────
   * The condition above is STICKY: a side that is a hundred behind is usually
   * still a hundred behind ten seconds later. So a plain "fire when true" is not
   * "たまに", it is "the instant you fall behind" — and the drop would land at
   * the same point in every match that has one, which is a rubber band with a
   * different name.
   *
   * So the condition only opens a WINDOW, and every `reinforcePoll` seconds
   * inside it the side rolls `reinforceChance`. At 0.22 on an 8 s poll the
   * expected wait is ~32 s of qualifying, and the distribution has a long enough
   * tail that two matches with the same scoreline drop at different moments —
   * which is what makes it read as an event rather than as a mechanic.
   *
   * MEASURED — @see the commit message for the table. The number to watch is
   * the FRACTION OF MATCHES IN WHICH IT FIRES AT ALL: a comeback that never
   * happens is not a mechanic and one that always happens is a rubber band.
   */
  reinforcePoll: 8,
  reinforceChance: 0.22,
  /**
   * ONE PER SIDE PER MATCH. It is "形勢逆転要素" — a chance to turn it round —
   * and a side that can call ten men every time it falls behind is a side that
   * is never behind. Both sides may have one, so the ceiling on the map is
   * twenty extra actors on top of forty; that cost is measured, not assumed.
   */
  reinforceMaxPerTeam: 1,
  /**
   * Seconds into a LIVE match before the first drop may be called. A side that
   * is a hundred behind in the first two minutes is a side that lost one
   * exchange, not a side that is losing — and the map events this schedule is
   * built around have not happened yet.
   */
  reinforceFirstDelay: 120,
  /**
   * DOES A REINFORCEMENT RESPAWN? No — "その場合、その１０人はリスポーンしない".
   *
   * This constant exists to be read by ONE line in `_queueRespawn`, because the
   * alternative was a special case bolted onto `_safeSpawn` and that is the
   * wrong place: `_safeSpawn` answers WHERE a man comes back, and the question
   * here is WHETHER. It is a field on the roster record (`rec.noRespawn`), set
   * once when the man is created and read by the one gate every death in the
   * game already passes through, so a reinforcement cannot come back by the
   * player path, the bot path, a re-task or a queue flush.
   */
  reinforceRespawns: false,
  /* ---- the helicopter ---- */
  /**
   * "増援は占領されているサイト付近からヘリでパラシュート降下して登場するようにして"
   *
   * The aircraft is the telegraph, exactly as the bomber's is: it is on screen
   * and audible for `reinforceLead` seconds before the first man steps out, so
   * the other side gets to see ten men coming and do something about it. A
   * comeback that arrives without warning is a spawn camp in reverse.
   */
  reinforceLead: 4.5,
  /** Metres above the drop zone the aircraft runs. High enough to read against the sky. */
  reinforceAltitude: 46,
  /** Metres per second along the run. 8 s of aircraft over a 260 m line. */
  reinforceSpeed: 33,
  /**
   * Seconds between one man leaving the door and the next.
   *
   * 0.62, AND IT IS THE ANTI-CROWDING NUMBER RATHER THAN A COSMETIC ONE.
   * `tools/stuckcheck.mjs` sits at 0/39 at 20 v 20 and the failure it gates is
   * the crowding epidemic that once wedged 22 of 29 men on nav islands at
   * doorways. Ten men arriving on one square is that failure by construction.
   * Two things stop it: the men leave the aircraft 0.62 s apart, so at
   * `reinforceSpeed` they are 20 m apart ALONG THE RUN before a canopy opens;
   * and each is steered to a DIFFERENT proved standing point of the zone
   * (`z.stand`, which `standRing` has already A*-proved from both bases).
   */
  reinforceDropGap: 0.62,
  /** Metres per second under an open canopy. ~7 s from 46 m. */
  reinforceDescent: 6.4,

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
 *
 * IN DOMINATION THERE IS NO ATTACKER. Both sides want all three zones and each
 * keeps ONE base for the whole match, so this collapses to a fixed answer: the
 * human's team owns the north spawn pocket (`SPAWNS.attack`) and the other side
 * owns the south one. The name is kept because `role` is how `sites.js`,
 * `_spawnTeam` and `_safeSpawn` already say "which base cluster", and because
 * `m.attackers` is read from outside `src/match` (src/ai/behaviour.mjs,
 * tools/matchtest.mjs) and must stay a valid team id.
 */
export function attackingTeam(round) {
  if (RULES.mode === MODE.DOMINATION) return RULES.playerTeam;
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
 * its length. TWENTY-ONE each, which covers a `teamSize` of 20 plus the slot the
 * human occupies on his own side; it was sixteen for the 15v15 and the modulo
 * would silently have wrapped five callsigns onto a second man each.
 */
export const BOT_NAMES = [
  ['HAWK', 'VIPER', 'RONIN', 'SABLE', 'KILO', 'ORCA', 'ZENITH', 'DRIFT', 'CINDER',
   'BASALT', 'QUARRY', 'TINDER', 'HALYARD', 'OBSIDIAN', 'RAMPART', 'JACKAL',
   'FLINT', 'GANTRY', 'MARROW', 'PIKE', 'SCORIA'],
  ['FROST', 'TALON', 'NOMAD', 'AZURE', 'ECHO', 'MAKO', 'VECTOR', 'SPARK', 'GLACIER',
   'COBALT', 'MERIDIAN', 'HALCYON', 'TUNDRA', 'PELAGIC', 'BOREAL', 'KESTREL',
   'SIROCCO', 'LANTERN', 'THRESHER', 'WEIR', 'ZEPHYR'],
];

/**
 * CALLSIGNS FOR THE MEN WHO CAME OUT OF THE HELICOPTER, and they are a separate
 * list rather than more entries on `BOT_NAMES` for one measurable reason.
 *
 * `_spawnTeam` indexes `BOT_NAMES` MODULO its length, and the note over it says
 * what happens when the roster outgrows the list: "two men share a name and the
 * killfeed stops being readable". Twenty-one names carry a `teamSize` of 20 with
 * one to spare; a drop adds `reinforceCount` more men to the SAME side inside
 * the same match, so ten of the twenty-one would have been worn twice at once.
 *
 * They are also deliberately a different KIND of name — a numbered flight rather
 * than a word — so that "ROTOR-3 killed you" reads in the feed as somebody who
 * was not on the board a minute ago. That is the whole point of the event.
 */
export const REINFORCE_NAMES = [
  ['ROTOR-1', 'ROTOR-2', 'ROTOR-3', 'ROTOR-4', 'ROTOR-5',
   'ROTOR-6', 'ROTOR-7', 'ROTOR-8', 'ROTOR-9', 'ROTOR-10'],
  ['CHALK-1', 'CHALK-2', 'CHALK-3', 'CHALK-4', 'CHALK-5',
   'CHALK-6', 'CHALK-7', 'CHALK-8', 'CHALK-9', 'CHALK-10'],
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
