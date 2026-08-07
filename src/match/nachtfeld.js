/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD — THE ACTS. What happens to the plain, and in what order.
 * ════════════════════════════════════════════════════════════════════════════
 * 「管制塔や要塞破壊イベント」「D地点をちゃんと常設せずに…イベントによって出現させて」
 *
 * The town has ONE scored act — the cathedral — and it lives as `CATH_BEATS`
 * plus eleven `cathedral*` keys in `rules.js` plus six methods on `MatchSystem`.
 * That was the right shape for one event on one map. It is the wrong shape for
 * three on a second one: the third copy of a beat runner is where the two that
 * came before it stop agreeing, and `rules.js` says in as many words that the
 * cathedral act is NOT tuning and does not belong in `MAP_RULES`
 * ("WHAT IS DELIBERATELY *NOT* HERE: the cathedral act … those are authored
 * geography rather than tuning, they live in their own files").
 *
 * So this file is the plain's authored choreography — the beat sheets, the
 * barrage shapes, the thresholds and every word the HUD says — and
 * `MatchSystem._updateNachtfeld` is ONE runner that plays whichever act is due.
 * The town's `CATH_BEATS` path is untouched: it is the map the user plays today
 * and it is the regression check.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TWO THINGS THE CATHEDRAL SHIPPED WRONG, WRITTEN DOWN SO THEY ARE NOT SHIPPED
 * AGAIN
 * ────────────────────────────────────────────────────────────────────────────
 *   1. ITS SITE WAS NEVER MARKED `scheduled`, so the ordinary weighted draw
 *      could take the building 4.6 s before its own event began — measured,
 *      one match, unforced. Both works here are `scheduled` AND `razeOnly` AND
 *      out of `_buildDemoSalvos`, which is all three enumerators.
 *      @see `MAP_EVENT_DEMOS` in `airstrike.js`.
 *   2. IT WAS A HARD CUT. 「また大聖堂破壊の時は破壊演出がないですね？？？」
 *      「大聖堂崩壊イベントは過激にそして激しく破壊し、大イベントにしてください」
 *      Every act below is a WARNING, a BOMBARDMENT, AIRCRAFT, the STRUCTURE
 *      GOING, an AFTERMATH and a CONSEQUENCE, on one clock.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NOTHING IN ANY OF IT IS COMPUTED ON THE FRAME IT FIRES
 * ────────────────────────────────────────────────────────────────────────────
 * The demolitions were fractured, thrown, settled and nav-patched at BOOT and
 * firing one is two index fills, two mask fills and a uniform write; the two
 * aircraft are runs `Bomber` and `Strafe` baked at boot; the barrage's aiming
 * points are solved once, HERE, into three flat arrays. @see `bakeBarrage`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE COORDINATES ARE DERIVED, NOT AUTHORED, AND THAT IS THE POINT
 * ────────────────────────────────────────────────────────────────────────────
 * `airstrike.js`'s own note on `PLAINS_STRIKE_SITES` is explicit about what an
 * authored `level:` pair on this map costs ("a number nobody will re-measure,
 * and this file's entire history is what that costs"). So not one aiming point
 * below is a coordinate. Every one of them is a fraction of the STRUCTURE'S OWN
 * published extent — `rec.position`, `rec.radius`, `rec.halfW/halfD`,
 * `rec.top`, out of `world.demolitions` — so if the tower moves a metre the
 * barrage moves with it and nothing here needs an edit.
 */

/**
 * How far above the local ground a burst stops leaving a scorch mark.
 *
 * The cathedral's barrage is a walk over a floor and `_cathShell` puts a scorch
 * decal under every round unconditionally. Half the tower's barrage goes off
 * between 8 and 38 m up a shaft, and a 7 m black disc painted on the ground
 * under an air burst is a decal describing a crater that is not there.
 */
export const SCORCH_CEIL = 3.0;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * WHEN — measured against `_matchProgress`, not against the clock
 * ────────────────────────────────────────────────────────────────────────────
 * 「大イベントの発火時刻を実測し、後半3〜5分に寄せる」.
 *
 * `_matchProgress` is `max(elapsed / matchTime, leader / scoreTarget)` and both
 * terms are monotone, so a threshold here is a point in the SHAPE of the match
 * rather than a wall-clock time — which is the whole argument
 * `RULES.cathedralOpenProgress` was moved onto fractions for. NACHTFELD's pair
 * is `matchTime` 1200 s and `scoreTarget` 1000 (`MAP_RULES.plains`).
 *
 * THE NUMBERS BELOW ARE MEASURED ON THIS MAP AND THE MEASUREMENT IS IN THE
 * COMMIT MESSAGE. They are not the town's numbers scaled: the town's cathedral
 * is one act and can sit at 0.40 on its own; three acts have to be three
 * events, which means each needs the one before it to be SPENT and its
 * consequence fought over before the next one opens.
 *
 * `gap` is a floor in real SECONDS under the spacing, the same guard
 * `RULES.districtSalvoGap` puts under the two district salvos and for the same
 * reason: a side printing points fast covers 0.1 of progress in twenty seconds,
 * and three big events inside twenty seconds is one big event.
 */
export const NF_GAP = 45;

/* ────────────────────────────────────────────────────── the barrage shapes ── */

/**
 * ────────────────────────────────────────────────────────────────────────────
 * HOW TALL IS IT — and the bug that made this a function instead of a field
 * ────────────────────────────────────────────────────────────────────────────
 * `rec.top` IS AN ABSOLUTE WORLD Y, NOT A HEIGHT. `publishWorks` fills it as
 * `y(TOWER_H)`, i.e. the structure's own base plus its height, and the base is
 * `rec.position.y`. Measured on the boot this note was written against:
 *
 *   NF-TOWER  position.y 9.80   top 41.70   → 31.90 m of structure
 *   NF-FORT   position.y  3.20  top 11.40   →  8.20 m of structure
 *
 * `_actAim` adds `rec.position.y` to whatever an aim function writes, so an aim
 * function that reaches for `rec.top` has added the base TWICE. The first
 * version of `climbAim` did exactly that: it spread sixteen rounds over
 * `rec.top - 1.5` = 40.2 m of offset above a base at 9.8, so the last round of
 * the climb went off at y = 49.5 in open sky — the tower's own roof is at 43.7,
 * measured by `airstrike` at bake ("NF-TOWER@43.7m"), so THREE of the sixteen
 * rounds detonated ABOVE THE BUILDING and the walk never reached the cab.
 *
 * That is the same class of defect the file header is about — a number nobody
 * re-measured — and the fix is to never let an aim function see `top` at all.
 */
function structH(rec) {
  return Math.max(1, rec.top - rec.position.y);
}

/**
 * A CLIMB — the tower's.
 *
 * Four rounds on the apron first, on the compass points and OUTSIDE the podium,
 * for the reason `_bakeCathedralBarrage`'s own note gives: a walk that starts
 * inside the footprint of a building that is still standing puts its opening
 * rounds where the building itself hides them, and the first pass of the
 * cathedral's `_evshots.mjs` caught exactly that — six shells down and nothing
 * on screen but a flat facade. From anywhere on the plain, four bursts at the
 * foot of the only vertical object on the map is an announcement.
 *
 * Then the climb: a helix up the shaft, tightening as it rises, ending on the
 * gallery. The angle steps by the golden angle rather than by a fixed arc so
 * consecutive rounds are never on the same bearing and the walk does not read
 * as a metronome — the same objection the cathedral's `along` jitter answers.
 */
function climbAim(i, n, rec, rng, out) {
  const apron = 4;
  if (i < apron) {
    const a = (i / apron) * Math.PI * 2 + 0.4;
    out[0] = Math.cos(a) * rec.radius * 0.94;
    out[1] = Math.sin(a) * rec.radius * 0.94;
    out[2] = 0;
    return;
  }
  const t = (i - apron) / Math.max(1, n - apron - 1);
  const a = (i - apron) * 2.39996 + 1.1;
  // Wide at the podium, tight at the cab: the shaft is a cone in plan.
  const r = (rec.radius * 0.52) * (1 - t) + Math.max(2.2, rec.halfW * 0.9) * t;
  out[0] = Math.cos(a) * r + rng.range(-1.1, 1.1);
  out[1] = Math.sin(a) * r + rng.range(-1.1, 1.1);
  // …AND THE CLIMB STOPS UNDER THE ROOF. @see `structH` for the 5.8 m of open
  // sky the three top rounds used to go off in.
  out[2] = 1.5 + t * (structH(rec) - 1.5) * 0.94;
}

/**
 * A SIEGE — the fortress's, and it is deliberately nothing like the tower's.
 *
 * 「二つの同じイベントは一つのイベントを二回やっただけ」. The tower is a
 * DECAPITATION: one vertical object, sixteen rounds up a shaft in ten seconds,
 * and the building is gone before the walk is finished. A fortress cannot be
 * decapitated — it is 72 m across, 8.2 m tall and most of it is the rampart,
 * which is the AI's ground and is NOT in the scope that comes down. So its
 * barrage is the opposite shape in every axis that matters:
 *
 *   the tower's         the fortress's
 *   ─────────────────   ──────────────────────────────────────────────────────
 *   vertical            FLAT. Every round is at deck height, so every round
 *                       leaves a scorch (@see `SCORCH_CEIL`) and the courtyard
 *                       is visibly worked over rather than lit up from above.
 *   16 over 10 s        26 over 26 s. A round a second is a bombardment you sit
 *                       under; sixteen in ten is a strike you flinch at.
 *   outward-in x2       ONE SPIRAL, glacis to magazine, and it never doubles
 *   (apron, then shaft) back. The beaten zone visibly CLOSES on the middle, so
 *                       where it is going is legible from the fourth round.
 *
 * The last four rounds are on the magazine itself — `rec.halfW`/`halfD` is the
 * magazine's own 8 x 6 m footprint and not the fort's, which is what makes the
 * spiral's terminus a derived point rather than an authored one. That is what
 * the `magazine` beat then cooks off.
 */
function siegeAim(i, n, rec, rng, out) {
  /** The last rounds that are ON the magazine rather than walking toward it. */
  const onMag = 4;
  if (i >= n - onMag) {
    const k = i - (n - onMag);
    const a = k * 2.39996 + 0.6;
    out[0] = Math.cos(a) * rec.halfW * 0.8 + rng.range(-0.6, 0.6);
    out[1] = Math.sin(a) * rec.halfD * 0.8 + rng.range(-0.6, 0.6);
    // Roof height rather than deck: the magazine's own roof is what is hit.
    out[2] = structH(rec) * 0.62;
    return;
  }
  const t = i / Math.max(1, n - onMag);
  /**
   * TWO TURNS, from the glacis to the magazine's own edge. `rec.radius` is
   * R_OUT + BASTION = 36 m and the walk starts just OUTSIDE it, on the glacis,
   * for `climbAim`'s reason: an opening round inside a standing curtain is a
   * round the curtain hides.
   */
  const r = rec.radius * 1.06 * (1 - t) + Math.max(rec.halfW, rec.halfD) * 1.3 * t;
  const a = t * Math.PI * 4 + 2.1;
  out[0] = Math.cos(a) * r + rng.range(-1.6, 1.6);
  out[1] = Math.sin(a) * r + rng.range(-1.6, 1.6);
  /**
   * Deck height, stepping up over the rampart and down into the courtyard —
   * derived from where the round IS rather than from its index, so it tracks
   * the wall it is crossing. `wall` peaks on the curtain (t ~ 0.4-0.6) and is 0
   * on the glacis and in the courtyard.
   */
  const wall = Math.max(0, 1 - Math.abs(r - rec.radius * 0.86) / 7.0);
  out[2] = 0.6 + wall * structH(rec) * 0.66;
}

/* ───────────────────────────────────────────────────────────────── the acts ── */

/**
 * ACT I — THE CONTROL TOWER, AND ZONE D BEHIND IT
 *
 * A decapitation. Twenty-four seconds from the first siren to the last beat,
 * and the middle of them is a capture point appearing in a gap that has been
 * overlooked from a 43.7 m gallery for the whole match.
 *
 * WHAT IS STILL STANDING AFTERWARDS, because "更地" is NOT what this record
 * scopes and the difference is load-bearing: `plains-tower.js` puts only the
 * SUPERSTRUCTURE — the shaft above the gallery, the cab, the mast — in its
 * `shell` scope. The two podium decks, their ramps and the apron are the AI's
 * ground, they are outside both scopes, and they do not move. A man who was on
 * P1 when this fires is still on P1. @see `publishWorks` in
 * `src/world/levels/plains-works.js`.
 */
const TOWER_ACT = {
  id: 'NF-TOWER',
  name: 'THE CONTROL TOWER',
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * 0.46 -> 0.40, AND THE ONLY REASON IS THE MEASUREMENT
   * ──────────────────────────────────────────────────────────────────────────
   * 「大イベントの発火時刻を実測し、後半3〜5分に寄せる」, and `rules.js` settled
   * what that sentence means for this codebase: it is a question about SECONDS
   * REMAINING, not about t, because a DOMINATION match ends on `scoreTarget`
   * and never on `matchTime`. The town's cathedral is quoted there as buying
   * 170-251 s of remaining match, and that is the bar.
   *
   * SO THE PLAIN'S OWN END WAS MEASURED FIRST (`_nftime.mjs`, acts disarmed so
   * an open D does not change the scoring rate mid-curve, two seeds):
   *
   *   natural end   t = 456.2 s   and   t = 472.1 s   of a 1200 s clock
   *
   * — i.e. the 1200 s clock is not what ends this match either, and the
   * "last 3-5 minutes" is the band T-180 s .. T-300 s. Against that curve:
   *
   *   p    t (s101/s202)   T-minus
   *   0.40   216.7 / 215.1   T-240 / T-257   ◄── the tower
   *   0.50   256.6 / 267.2   T-200 / T-205   ◄── the fortress
   *   0.60   296.0 / 313.4   T-160 / T-159   ◄── the crash
   *
   * THREE ACTS CANNOT ALL SIT WHERE ONE CAN. The band is 120 s wide and an act
   * plus its `NF_GAP` is 65-85 s, so the set SPANS the band rather than
   * clustering inside it: the tower opens it at the five-minute mark and the
   * crash is the last thing that happens before the endgame, which is the
   * shape 「後半3〜5分に寄せる」 asks for and the only one that fits.
   *
   * 0.46 WAS NOT WRONG SO MUCH AS UNMEASURED — it lands at T-216/T-231, inside
   * the band on its own. It moves because it is now the FIRST of three and the
   * two behind it need the room. @see the measured firings in the commit.
   */
  progress: 0.40,
  lead: 10.0,
  /** Which of `PLAINS_RUNS` / `PLAINS_LINES` this act's aircraft fly. */
  run: 'CENTREWEST',
  title: 'THE CONTROL TOWER IS BEING BROUGHT DOWN',
  /**
   * NOT "IS DOWN". The strip flips to its impact read the instant the countdown
   * expires and at that moment the tower is still standing with the barrage only
   * three rounds up it — the exact photograph that put "THE CATHEDRAL IS GONE"
   * over an intact facade. The `raze` beat owns the past tense.
   */
  impactTitle: 'THE CONTROL TOWER UNDER FIRE',
  warnLine: 'SECONDS · GET OFF THE TOWER',
  razeTitle: 'THE TOWER IS COMING DOWN',
  razeImpact: 'THE TOWER IS DOWN',
  afterTitle: 'THE TOWER IS DOWN',
  afterLine: 'THE CENTRE IS OPEN GROUND',
  openLine: 'CONTEST THE GAP',
  barrage: {
    shells: 16,
    /** Opens BEFORE the arrival, so the structure going is the SECOND thing. */
    open: -3.0,
    span: 10.0,
    radius: 13,
    damage: 190,
    aim: climbAim,
  },
  beats: [
    /**
     * The aeroplane first and it is the telegraph: `Strafe` puts an airframe on
     * screen ahead of its own cannon, so firing it here crosses the tower while
     * the warning strip is still counting down. West of the works, which is the
     * side of the works.
     */
    [-3.2, 'strafe'],
    /**
     * THE STRUCTURE GOES ON THE ARRIVAL BEAT — offset 0.0, no `JET_LEAD`
     * arithmetic, because `Airstrike.callDemolition` fires the site
     * IMMEDIATELY (it is `fire()`, not a call with a telegraph in front of it).
     * The telegraph is the ten seconds of alert and the three seconds of
     * barrage that have already landed.
     */
    [0.0, 'raze'],
    /**
     * …and the follow-up stick through the dust. `Bomber` is 2.4 s on screen
     * before it releases and 1.7 s of fall after, so this puts bombs on the
     * ground at about +6.5 — inside the settle, which is where they belong.
     */
    [2.4, 'bomber'],
    [8.0, 'aftermath'],
    /**
     * D GOES LIVE. Three seconds after the aftermath rather than on it, so the
     * two read as cause and effect rather than as one banner replacing another.
     */
    [11.0, 'open'],
    /**
     * THE ARMOUR — 「大聖堂破壊イベントの後には戦車も登場させて」, one map over.
     *
     * NACHTFELD's six hulls baked, proved and printed their thirty-six legs at
     * boot and then never rolled: `_setPhase` arms them on a map with NO locked
     * zone, and this map now has one. So the armour goes back to being an ACT'S
     * CONSEQUENCE here exactly as it is on the town, and this is the act that
     * carries it while it is the only one.
     */
    [11.0, 'armour'],
    /**
     * …and the enemy's reinforcements. An ARM rather than a call, for the reason
     * `CATH_BEATS` gives: the frame this plays on still has a bomber run and
     * the tower's own chunks in the air, and `_updateReinforcements` stands a
     * helicopter down for both. The poll flies it on the first clear frame after
     * the act is spent.
     */
    [14.0, 'reinforce'],
  ],
};

/**
 * Seconds after the `armour` beat before the first hull rolls. The town's
 * equivalent is `RULES.tankAfterCathedral` and it is 3.0 for the same reason:
 * the point of arming on the aftermath rather than on the consequence is that
 * the two events read as one.
 */
export const NF_ARMOUR_AFTER = 3.0;

/**
 * ACT II — THE FORTRESS
 *
 * A SIEGE, AND THE WHOLE POINT IS THAT IT IS NOT THE TOWER AGAIN. Two events
 * that look the same are one event played twice, so every axis this act has in
 * common with Act I has been pushed the other way:
 *
 *   ACT I  THE TOWER                    ACT II  THE FORTRESS
 *   ─────────────────────────────────   ──────────────────────────────────────
 *   24 s from siren to last beat        44 s. It is the long one.
 *   an aeroplane opens it               THE GUNS open it, eight seconds before
 *                                       the warning even expires, and the
 *                                       aircraft arrive at the END.
 *   the barrage climbs, the building    the barrage CLOSES, and the building
 *   is gone on round three              goes on the LAST round — the walk is
 *                                       the cause rather than the escort.
 *   the strike kills it                 ITS OWN MAGAZINE kills it. @see the
 *                                       `magazine` beat, which Act I has no
 *                                       equivalent of and cannot have: the
 *                                       tower is a shaft with a cab on it and
 *                                       nothing in it to cook off.
 *   west of the works (`CENTREWEST`)    east of them (`CENTREEAST`), so the two
 *                                       acts are not even the same silhouette
 *                                       on the same horizon.
 *   consequence: D OPENS, armour rolls  consequence: the ENEMY REINFORCES the
 *                                       ground it just lost the walls of.
 *
 * WHAT IS STILL STANDING AFTERWARDS, and here it is most of the building.
 * `plains-fort.js` scopes the parapet, both gatehouses, the two north bastions
 * and the magazine — the CROWN. The 6 m battered curtain under the walk is NOT
 * in scope and does not move: it is the only high ground the bots have inside
 * the wall, both ramps off the courtyard still land on it, and the gate
 * passages are untouched. A man on the rampart when this fires is still on the
 * rampart, standing behind a parapet that is now lying along the walk beside
 * him. @see `buildFortRuin`.
 */
const FORT_ACT = {
  id: 'NF-FORT',
  name: 'THE FORTRESS',
  /** T-200 s / T-205 s on the measured curve. @see `TOWER_ACT.progress`. */
  progress: 0.50,
  /** Four seconds longer than the tower's, because the guns open under it. */
  lead: 14.0,
  run: 'CENTREEAST',
  title: 'THE FORTRESS IS UNDER BOMBARDMENT',
  impactTitle: 'THE FORTRESS IS UNDER BOMBARDMENT',
  warnLine: 'SECONDS · CLEAR THE COURTYARD',
  razeTitle: 'THE MAGAZINE HAS GONE UP',
  razeImpact: 'THE FORTRESS IS BROKEN',
  afterTitle: 'THE FORTRESS IS BROKEN',
  afterLine: 'THE WALLS ARE OPEN TO THE SKY',
  openLine: 'CONTEST THE GAP',
  barrage: {
    shells: 26,
    /**
     * MINUS EIGHT. The guns are the telegraph here — the first four rounds walk
     * the glacis while the warning strip is still counting down, which is the
     * one thing the tower's sheet cannot do because its own opening rounds are
     * three seconds of announcement rather than six of ranging fire.
     */
    open: -8.0,
    span: 26.0,
    radius: 11,
    damage: 150,
    aim: siegeAim,
  },
  beats: [
    /** The heavy first and from the far side. `Bomber` is 2.4 s on screen. */
    [-6.0, 'bomber'],
    /**
     * THE MAGAZINE. The spiral's last four rounds are ON it (@see `siegeAim`)
     * and this is what they set off: one blast at the fort's own centre, the
     * size of the whole courtyard, two seconds before the structure follows.
     */
    [12.0, 'magazine'],
    /**
     * …AND THE CROWN COMES OFF BEHIND IT. Two seconds, so the magazine reads as
     * the CAUSE. Act I razes on the arrival beat with the barrage still walking
     * up the shaft; this one razes at the end of its walk. Same method, opposite
     * dramatic order, and that is the difference between two events and one.
     */
    [14.0, 'raze'],
    /** The fighter through the smoke, AFTER. On the tower's sheet it is first. */
    [17.0, 'strafe'],
    [22.0, 'aftermath'],
    /**
     * NO `open` AND NO `armour` BEAT. D is already live and the hulls are
     * already rolling — Act I owns both, and an act whose consequence has
     * already happened is an act with no consequence. This one's is the drop.
     */
    [26.0, 'reinforce'],
  ],
};

/**
 * ACT III — THE CRASH, AND IT IS THE MAP'S SIGNATURE
 *
 * 「戦闘機や衛星落下イベントで平原を火の海に」. `plains.js`'s own header has been
 * carrying the line "the satellite that sets the plain on fire is still to
 * come" since the map was built. This is it, and it is meant to be the biggest
 * thing in the game.
 *
 * IT IS THE ONE ACT WITH NO BUILDING, and almost everything else about it
 * follows from that:
 *
 *   NO BARRAGE. `shells: 0`. The first two acts telegraph with artillery over a
 *   building that looks exactly as it did a minute ago; this one telegraphs
 *   with THE EVENT ITSELF — a burning airframe entering 400 m off the map at
 *   180 m of altitude, thirteen seconds out, visible from every capture point.
 *   Putting a bombardment in front of that would be putting a support act in
 *   front of the headline.
 *
 *   NO `raze`. There is no `world.demolitions` record to bring down. It is
 *   anchored to the point `Crash` probed at boot instead (`anchor: 'crash'`),
 *   which is what `_beginAct`'s log line used to throw on.
 *
 *   THE LONGEST LEAD ON THE MAP — 16 s against the tower's 10 and the
 *   fortress's 14 — because the thing being announced takes thirteen of them to
 *   arrive and the alert has to be up before it is in the sky.
 *
 *   AND ITS CONSEQUENCE IS THE ONLY ONE THAT IS STILL THERE TWO MINUTES LATER.
 *   The tower's is a capture point and the fortress's is a helicopter; both are
 *   spent inside a minute. This one leaves 160 m of burning plain that is still
 *   burning when the match ends. @see `BURN_S` in `crash.js`.
 */
const CRASH_ACT = {
  id: 'NF-CRASH',
  name: 'THE CRASH',
  /** T-160 s on the measured curve — the last event before the endgame. */
  progress: 0.60,
  /** @see `_bakeActs` — bound to `Crash.anchor`, not to a demolition record. */
  anchor: 'crash',
  lead: 16.0,
  /** No aircraft of its own: it IS the aircraft. `run` is never read. */
  run: null,
  title: 'SOMETHING IS COMING DOWN',
  impactTitle: 'IT IS COMING DOWN ON THE PLAIN',
  warnLine: 'SECONDS · GET CLEAR OF THE WEST',
  afterTitle: 'THE PLAIN IS BURNING',
  afterLine: 'THE WEST IS ON FIRE FOR THE REST OF THIS',
  openLine: 'CONTEST THE GAP',
  barrage: { shells: 0, open: 0, span: 1, radius: 0, damage: 0, aim: () => {} },
  beats: [
    /**
     * MINUS THIRTEEN. It is in the sky while the strip is still counting down —
     * `Crash`'s approach is `APPROACH / SPEED` = 13.0 s and the lead is 16.0, so
     * the player has three seconds of siren, then ten of watching it come, then
     * it lands ON the count expiring.
     */
    [-13.0, 'crash'],
    /** The plough is 5 s; this is the banner over the far end of the scar. */
    [6.0, 'aftermath'],
    /**
     * …and the drop, once. The fortress armed one too and `_reinforcePending`
     * is a flag rather than a counter, so if that one has not been spent this
     * is a no-op — which is the correct behaviour and not a missed beat.
     */
    [12.0, 'reinforce'],
  ],
};

/** THE ACTS, IN ORDER. `MatchSystem` walks this list and never indexes it by id. */
export const NF_ACTS = [TOWER_ACT, FORT_ACT, CRASH_ACT];

/**
 * The acts, per map. @see `forMap` in `src/match/geography.js` — `world.level.id`,
 * never a second parse of `?map=`. The town has none: its one act is
 * `CATH_BEATS`, which is untouched.
 */
export const MAP_ACTS = { town: [], plains: NF_ACTS };

/**
 * Solve one act's aiming points, once, at boot.
 *
 * Returns three `Float32Array`s of offsets on the WORLD axes from the
 * structure's own centre — x, z and the height above the structure's base — so
 * the frame a round is fired does three adds into a preallocated vector and
 * nothing else. The same discipline `_bakeCathedralBarrage` works under, with
 * one difference: the cathedral stores offsets on the LEVEL's two axes because
 * the town is yawed into the world, and NACHTFELD is authored at yaw 0, scale 1,
 * origin 0 — level space IS world space here, and `geography.PLAINS` is the
 * statement of that. There is no transform to keep in sync and therefore none
 * to get wrong.
 *
 * @param {object} act  one of `NF_ACTS`
 * @param {object} rec  the `world.demolitions` record it brings down
 * @param {object} rng  a `ctx.rng` fork — never `Math.random`
 */
export function bakeBarrage(act, rec, rng) {
  const n = act.barrage.shells;
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const y = new Float32Array(n);
  const out = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    act.barrage.aim(i, n, rec, rng, out);
    x[i] = out[0];
    z[i] = out[1];
    y[i] = out[2];
  }
  return { x, z, y };
}
