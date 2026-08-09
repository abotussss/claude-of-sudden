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
export const NF_GAP = 26;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 45 -> 26, AND THE REASON IS THAT THE GAP TURNED OUT TO BE THE WHOLE SCHEDULE
 * ────────────────────────────────────────────────────────────────────────────
 * At 45 this was not a floor, it was the timetable. Measured, all three acts,
 * seed 101 — two of the three thresholds below had ALREADY BEEN PASSED by the
 * time the gap let their act open, so they decided nothing:
 *
 *   act      threshold   p when it actually fired   t
 *   ─────    ─────────   ────────────────────────   ───────
 *   TOWER      0.40        0.402                    232.4 s   ◄ the only one its
 *   FORT       0.50        0.569                    301.8 s     own threshold set
 *   CRASH      0.60        0.821                    387.0 s
 *
 * — and 387 s on a match that ends near 440 is T-53, which is not 「後半3〜5分」
 * under any reading of it. `RULES.districtSalvoGap`'s own note says exactly this
 * about itself ("IT IS THE BINDING CONSTRAINT, NOT THE BACKSTOP") and settled on
 * 25 for events of about twelve seconds. These are 24-34 s events, so 26 is the
 * same judgement one size up: still clear air between two headlines, no longer
 * the thing that chooses when they happen.
 */

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
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE TIGHT RADIUS COMES OFF `radius` NOW, NOT OFF `halfW`, AND IT HAD TO
 * ────────────────────────────────────────────────────────────────────────────
 * 「更地にするつもりで」 put the podium into the tower's demolition scope, and
 * `airstrike._buildDemoSite` derives the settled pile's radius from
 * `min(halfW, halfD) * 0.85`. At the shaft's own 6.5 m that is a 5.5 m disc,
 * and every chunk of a 42 m podium would have been dragged into it — a mound on
 * the axis instead of a levelled site. So `plains-tower.js` now publishes the
 * PODIUM'S half-extent, which is the only reading of `halfW` that is true of
 * the thing that comes down.
 *
 * This function was the one reader that wanted the other number, and it wanted
 * it for a reason that has nothing to do with plan extent: it is the radius the
 * helix TIGHTENS TO once it is up the shaft. `radius * 0.27` is 7.0 m against
 * the 5.85 m `halfW * 0.9` used to give — half a shaft's width wider, on a walk
 * that already jitters ±1.1 m — and it is derived from the same published
 * extent every other number in this file comes off, which is the rule the file
 * header states. `rec.halfW` now means one thing.
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
  const r = (rec.radius * 0.52) * (1 - t) + Math.max(2.2, rec.radius * 0.27) * t;
  out[0] = Math.cos(a) * r + rng.range(-1.1, 1.1);
  out[1] = Math.sin(a) * r + rng.range(-1.1, 1.1);
  /**
   * …AND THE CLIMB STOPS UNDER THE ROOF. @see `structH` for the 5.8 m of open
   * sky the three top rounds used to go off in.
   *
   * 0.94 -> 0.80, and the only thing that moved is the base. `baseY` was the
   * P2 deck and is now the ground, so `structH` went from 31.9 m to 38.5 m and
   * the same fraction would put the last four rounds in the mast and over the
   * cab roof. 0.80 of 38.5 is 30.8 m over a base at 3.2 — the cab floor is at
   * 29.2 and its roof at 34.2, so the walk still finishes ON the cab, which is
   * where a decapitation has to finish.
   */
  out[2] = 1.5 + t * (structH(rec) - 1.5) * 0.80;
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
 * WHAT IS STILL STANDING AFTERWARDS: THE APRON, AND NOTHING ELSE —
 * 「完全に管制塔破壊しろ、つまり更地にするつもりで」
 *
 * This used to scope the SUPERSTRUCTURE alone and the note here used to say so
 * with some pride: the two podium decks, all four climbs and everything on them
 * survived, because the decks are the AI's only high ground on this map. That
 * is reversed, at the player's instruction, and it is reversed because it was
 * measured doing the one thing a demolition must never do —
 * 「管制塔の中にいるときに爆撃されると出れなくなる」. `plains-tower.js` carries the
 * flood-fill numbers; the short version is that the old ruin re-walled the
 * shaft with no doorways in it and left a man in the control room standing on
 * rubble seven metres above the plain with 7.1 m of reach on every bearing.
 *
 * What is left is the APRON — a hardstanding 0.06 m proud of the turf — under a
 * graded rubble field whose peak is 0.85 m, i.e. under the crouch eye. A man
 * who was on P1 when this fires is on the ground afterwards, and so is
 * everybody else. TWO SUPPLY POSTS STAND ON THAT APRON and outlive the tower,
 * which is what stops 更地 costing the site every reason to be there.
 * @see `STORES` in `plains-tower.js` and `publishWorks` in `plains-works.js`.
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
   *
   * ──────────────────────────────────────────────────────────────────────────
   * 0.40 -> 0.30, AND THE ARITHMETIC THAT FORCES IT — WRITTEN OUT, BECAUSE IT
   * IS THE ONE THING ABOUT THIS MAP THAT CANNOT BE FIXED BY MOVING A NUMBER
   * ──────────────────────────────────────────────────────────────────────────
   * THREE ACTS COST 141 SECONDS OF MATCH and they cannot be moved apart:
   *
   *   TOWER 24 s + gap 26 + FORT 34 s + gap 26 + CRASH 25 s  =  135 s
   *   …so the CRASH opens 110 s after the TOWER does, always.
   *
   * The match itself is 430-470 s. 「後半3〜5分」 is T-180..T-300, a band 120 s
   * wide — and 110 s of that band is spent before the third act can even start.
   * So the set has to SPAN the band rather than sit inside it, and the only
   * free choice is which end of it Act I anchors.
   *
   * 0.40 ANCHORED THE WRONG END. It put the tower at T-208 (well inside the
   * band, on its own merits) and therefore the crash at T-53 — 「大イベント」 as
   * a footnote to an endgame that was already decided. 0.30 fires at t=172-177
   * on the measured curve and hands the crash T-140 instead of T-53, which is
   * the whole of the improvement and it is bought entirely here.
   *
   * WHAT 0.30 COSTS, AND WHY IT IS AFFORDABLE. `rules.js` puts the town's
   * cathedral at three fifths of the way in and argues its D needs 85-120 s
   * afterwards to be "a second act and not a flourish". At 0.30 this D opens at
   * t≈193 of a 430 s match and gets 240 s — TWICE the town's upper bound. The
   * precedent is about how much match a new point needs after it, not about the
   * fraction, and 240 s clears it by a factor of two.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * 0.30 -> 0.50, AND THIS ONE IS NOT A SCHEDULING ARGUMENT AT ALL
   * ──────────────────────────────────────────────────────────────────────────
   * 「管制塔は**５００で破壊**して 管制塔の一番上は衛星爆撃呼び出しボタンがあり
   *  それにより敵占領サイトへの大型爆撃を可能にする
   *  **そのため管制塔は破壊されないといけない**」
   *
   * Every paragraph above this one argues about WHEN a headline should land.
   * This number has stopped being that. `scoreTarget` is 1000 on this map
   * (`MAP_RULES.plains`) and `_matchProgress` is `max(elapsed/matchTime,
   * leader/scoreTarget)`, so 0.50 IS 「５００で破壊」 written in the only unit this
   * runner reads — five hundred points of a thousand-point game, reached by the
   * leader, which is the sentence rather than a fraction near it.
   *
   * AND THE LAST LINE OF THE QUOTE IS WHAT THE ACT NOW MEANS. The cab at 26 m
   * carries `SAT_STRIKE`'s console (@see below): until this act fires, whoever
   * can stand at the top of this tower can drop 「大型爆撃」 on an enemy-held
   * capture point. The tower is not scenery with a view any more, it is a
   * WEAPON — and razing it is how the weapon is taken away. 「そのため管制塔は
   * 破壊されないといけない」 is a causal claim about this act, and 0.50 is the
   * moment the map disarms itself.
   *
   * WHAT IT COSTS THE SCHEDULE, STATED RATHER THAN HIDDEN. It moves Act I 0.20
   * of progress later, so the 135 s the three acts cost now starts later too.
   * The measured firings are in the commit and in `_nfacts.mjs`'s output. Act
   * III is moving to 0.80 in the same pass (the satellite catastrophe), which is
   * where the room comes from: the set still SPANS the band, it just spans a
   * later part of it, and D now opens on the half-way point of the score rather
   * than on its first third.
   *
   * WHAT IT COSTS ACT II, ALSO STATED. `FORT_ACT.progress` is 0.42 and is not
   * this pass's to move, so it is now BEHIND Act I's threshold and can never be
   * the thing that opens itself: the fortress will fire on `NF_GAP` alone, 26 s
   * after the tower is spent, in every match. Its own note already says the gap
   * sets it in practice; after this it sets it always.
   */
  progress: 0.50,
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
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * WHAT THIS STRUCTURE SOUNDS LIKE WHEN IT FAILS — read by the `raze` beat
   * ──────────────────────────────────────────────────────────────────────────
   * THE VOICE IS IN THE SHEET AND NOT IN `_actBeat` BECAUSE THE TWO RAZES ARE
   * NOT THE SAME EVENT. Both acts run through the same `case 'raze'`, so a
   * `collapse_sub` written into that case would fire on the fortress as well —
   * two seconds after the `magazine` beat has already fired one. Two subs two
   * seconds apart is not a bigger event: `AudioSystem._playCollapse` ducks the
   * whole mix and concusses the listener on the SUB SPECIFICALLY, once, on the
   * impact, and doing that twice inside two seconds re-ducks a mix that is
   * still recovering and re-deafens a player who is still deaf. So each act
   * says what its own structure is worth, and an act that says nothing gets
   * nothing.
   *
   * `size` IS THE ONE NUMBER THAT MATTERS AND IT IS NOT A LOUDNESS. In
   * `collapseTear` it scales the load-shed modes, the tear and the mass roar,
   * and it sets HOW MANY slabs there are (`lerp(4, 9, size)`): it is the
   * building's mass, not its volume. 1.0 is a 30 x 45 m cathedral. THIS IS A
   * SHAFT WITH A CAB ON IT — the same object that has nothing in it to cook off
   * (@see the fortress's `magazine` beat) — so it fails faster, with less under
   * it and with a handful of slabs rather than nine. Asking for a cathedral
   * here would make the map's smallest structure its heaviest sound.
   *
   * `maxDist` 900 IS GEOMETRY, NOT MIX. The default in `_playCollapse` is 640 m
   * and it was measured on the town, whose cathedral is at the centre of a map
   * you can cross in twenty seconds. NACHTFELD is 400 m of open plain and its
   * capture points are further apart than that ceiling, so the reach is stated
   * here for the same reason the `magazine` beat states it. Everything else —
   * gain, occlusion, priority, the duck, the concussion — is deliberately NOT
   * stated: those are mix facts, they live in `_playCollapse`, and a caller
   * that repeats them is a caller that goes stale the next time they are tuned.
   *
   * NO BELL. There is one modelled bell in this game and it is in the town's
   * campanile. @see `src/audio/collapse.js`.
   *
   * These bags are authored once, at module scope, and passed by reference to
   * `audio.play`, which copies out of them into its own preallocated bag. No
   * beat allocates.
   */
  collapse: {
    tear: { dur: 4.2, size: 0.55, maxDist: 900 },
    sub: { dur: 1.6, maxDist: 900 },
  },
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
  /**
   * 0.50 -> 0.42. It is the middle act and in practice `NF_GAP` sets it, not
   * this — but a threshold that is only ever reached late is a threshold that
   * does nothing in a SLOW match, which is the one case the gap cannot cover.
   * 0.42 is where the curve puts it 26 s after the tower is spent, so the two
   * agree instead of one always overriding the other.
   * @see `TOWER_ACT.progress` for the arithmetic and `NF_GAP` for the measurement.
   */
  progress: 0.42,
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
  /**
   * THE CROWN COMES OFF, AND IT IS A TEAR WITH NO SUB UNDER IT.
   *
   * `sub` IS ABSENT ON PURPOSE AND ITS ABSENCE IS THE POINT. This act already
   * fires one, two seconds earlier, from the `magazine` beat — that is the
   * floor of THIS event, and the sheet is built so the magazine is the CAUSE
   * and the crown coming off is the consequence. A second sub here would duck
   * a mix that is still ducked and concuss a listener who is still deaf, and it
   * would flatten the two beats into one loud smear. @see `TOWER_ACT.collapse`
   * for why this lives in the sheet rather than in the shared `raze` case.
   *
   * `size` 0.8 AGAINST THE TOWER'S 0.55. What comes down here is the parapet,
   * both gatehouses, two bastions and the magazine — a great deal more stone
   * than a shaft with a cab on it, and much less than a cathedral, which is
   * what 1.0 means. `dur` is the longer of the two for the same reason: a
   * curtain wall lets go along its length rather than at a point.
   */
  collapse: {
    tear: { dur: 5.4, size: 0.8, maxDist: 900 },
  },
  barrage: {
    shells: 26,
    /**
     * MINUS EIGHT. The guns are the telegraph here — the first four rounds walk
     * the glacis while the warning strip is still counting down, which is the
     * one thing the tower's sheet cannot do because its own opening rounds are
     * three seconds of announcement rather than six of ranging fire.
     */
    open: -8.0,
    /**
     * 26 -> 20. A round a second was the argument and it still is — twenty
     * rounds over twenty seconds — but the SPAN was 26 s against a sheet that
     * ended at 22, so the act's own length was set by the guns rather than by
     * the drama, and every second of it was a second of `NF_GAP` pushed onto
     * the crash. @see `TOWER_ACT.progress` for what 110 s of unavoidable
     * spacing costs on a 430 s match.
     */
    span: 20.0,
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
    [10.0, 'magazine'],
    /**
     * …AND THE CROWN COMES OFF BEHIND IT. Two seconds, so the magazine reads as
     * the CAUSE. Act I razes on the arrival beat with the barrage still walking
     * up the shaft; this one razes at the end of its walk. Same method, opposite
     * dramatic order, and that is the difference between two events and one.
     */
    [12.0, 'raze'],
    /** The fighter through the smoke, AFTER. On the tower's sheet it is first. */
    [15.0, 'strafe'],
    [18.0, 'aftermath'],
    /**
     * NO `open` AND NO `armour` BEAT. D is already live and the hulls are
     * already rolling — Act I owns both, and an act whose consequence has
     * already happened is an act with no consequence. This one's is the drop.
     */
    [20.0, 'reinforce'],
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
  /**
   * 0.60 -> 0.54. In practice `NF_GAP` opens this one and this number never
   * gets to decide — @see `NF_GAP` for the measurement that showed it firing at
   * p=0.821 with a threshold of 0.60. It is set where the curve puts it 26 s
   * after the fortress is spent, so that in a SLOW match, where the gap is not
   * binding, it still lands in the same place in the shape of the match.
   */
  progress: 0.54,
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
    [5.0, 'aftermath'],
    /**
     * …and the drop, once. The fortress armed one too and `_reinforcePending`
     * is a flag rather than a counter, so if that one has not been spent this
     * is a no-op — which is the correct behaviour and not a missed beat.
     */
    [9.0, 'reinforce'],
  ],
};

/** THE ACTS, IN ORDER. `MatchSystem` walks this list and never indexes it by id. */
export const NF_ACTS = [TOWER_ACT, FORT_ACT, CRASH_ACT];

/* ══════════════════════════════════════════════════════════════════════════ */
/* THE SATELLITE UPLINK — the button at the top of the tower, and the ONE      */
/* NAMED EXCEPTION to the rule that bombing may not fall on a capture circle   */
/* ══════════════════════════════════════════════════════════════════════════ */
/**
 * 「管制塔は５００で破壊して 管制塔の一番上は衛星爆撃呼び出しボタンがあり
 *  それにより敵占領サイトへの大型爆撃を可能にする
 *  そのため管制塔は破壊されないといけない」
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠ THE RULE THIS BREAKS, IN THE PLAYER'S OWN WORDS, SO NOBODY "FIXES" IT ⚠
 * ────────────────────────────────────────────────────────────────────────────
 * 「空爆は占領サイトに落とすのではなくそれ以外の平原にランダムに広範囲に一列爆撃に
 *  して それを定期的に起こす」
 * 「占領サイトへの直接はダメ ただし破壊オブジェ＋占領サイトの場所には落としてもいい」
 *
 * THAT RULE IS LIVE AND IT IS ENFORCED AT BOOT. `plainsOpenRuns` in
 * `src/match/bomber.js` proves every candidate line against the RESOLVED
 * capture circles + 24 m, both base pads + 46 m, and the real ground, and
 * REJECTS the whole line if one impact fails. Its own note goes further and
 * refuses the 破壊オブジェ carve-out for itself, on the grounds that a random
 * bomb landing on the point is indistinguishable, to the man standing on it,
 * from the rule being broken.
 *
 * THIS IS THE EXCEPTION, AND THE PLAYER JUST AUTHORED IT. 「敵占領サイトへの
 * 大型爆撃を可能にする」 is a strike whose whole definition is the capture circle
 * it lands in. It is legal HERE and nowhere else, and the difference is not a
 * loosened gate — it is four properties the line bombardment does not have:
 *
 *   IT IS CALLED, NOT DRAWN.   A man stood at 26 m on the most exposed square
 *                              metre on the map and held a key. Nothing lands
 *                              on a capture point in this game by chance.
 *   IT NAMES ITS TARGET FIRST. The console says which point before the key goes
 *                              down; the HUD says it to everybody afterwards.
 *   IT IS BOUNDED INWARD.      Every impact is proved to be INSIDE the target
 *                              circle. @see `satProve` — the line bombardment's
 *                              gate keeps impacts OUT of every circle, and this
 *                              one keeps them IN one. That inversion is what
 *                              makes it an exception rather than a hole: it
 *                              cannot leak onto open ground, onto a neutral or
 *                              friendly point, or onto a spawn.
 *   IT DIES WITH THE TOWER.    `NF-TOWER-SATCALL` is `perishable`, so Act I at
 *                              p 0.50 removes it. 「そのため管制塔は破壊されない
 *                              といけない」 is implemented by that one flag.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHO MAY USE IT — the player, and the reason is geometry rather than taste
 * ────────────────────────────────────────────────────────────────────────────
 * A weapon only the human can reach is a different game from one both sides can
 * use, and it was designed for the second. It is the first that shipped, and
 * the constraint is `src/ai/nav.js`, which is a 2.5D height field with ONE
 * floor per cell: a shaft with four storeys of dog-leg stair in it cannot be
 * expressed in it at all. `plains-tower.js` publishes the two posts above the
 * control room as `botReachable: false` for exactly that reason and
 * `Caches.prove` never puts them in `botList`, so `_assignCacheLegs` cannot
 * send anybody. Faking a `stand` cell at 26 m is the `_jitterOnto` bug that
 * strands a man on a shaft slab for the rest of his life.
 *
 * SO THE ANSWER THE MAP GIVES INSTEAD IS THE ACT. The enemy cannot take the
 * console away by climbing; the enemy takes it away by SURVIVING TO 500, at
 * which point the tower is levelled with the button on it. That is the user's
 * own causal chain and it is the whole of Act I's new meaning.
 *
 * THE ONE CHANGE THAT WOULD OPEN IT TO BOTS is a nav grid that can express a
 * shaft, which is `src/ai`'s and is named here rather than half-done.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THE OTHER SIDE SEES — nothing may kill from nowhere
 * ────────────────────────────────────────────────────────────────────────────
 * The line bombardment shows an airframe 2.4 s before release, an `airAlert`
 * with a bearing arrow and a countdown, and an `airDanger` reticle on every
 * crater. A SATELLITE HAS NO AEROPLANE, so it buys its telegraph three other
 * ways and all three are in the world rather than only on the HUD:
 *
 *   `lead` 9.0 s   longer than a bomber's 4.1 s of visible run-in and only one
 *                  second under `zoneBombardLead`, which is the map's proven
 *                  "you have time to walk out of a circle" number.
 *   `pulses`       THE DESIGNATOR. A light and a haze ring ON THE GROUND at the
 *                  target, struck five times through the lead and accelerating,
 *                  so a man inside the circle who is looking at his feet still
 *                  knows. This is the aeroplane's replacement and it is the
 *                  reason `pulses` is a table rather than a rate.
 *   the strip      `ui.airAlert` names the point and counts down; one
 *                  `ui.airDanger` reticle per impact, and there are twelve.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW OFTEN, AND WHY IT CANNOT DECIDE THE MATCH ON ITS OWN
 * ────────────────────────────────────────────────────────────────────────────
 * A COOLDOWN, NOT A CHARGE COUNT, and no artificial cap — because the tower is
 * the cap. `cooldown` 100 s against a plain that ends at t=430-470 and an Act I
 * that removes the console at p 0.50 gives THREE calls in a fast match and
 * fewer in a slow one, and each of them costs the climb: the cab is 26 m up
 * four storeys of dog-leg with no cover on the last flight, and the way down is
 * the same stair.
 *
 * WHAT ONE CALL IS WORTH. Twelve rounds at `radius` 18 / `damage` 260 walked
 * over a 14 m circle over 6 s is lethal to a man who stands still and survivable
 * by anybody who walks 15 m in nine seconds — deliberately the same bargain
 * `_callZoneBombard` offers (`zoneBombardRadius` 16, `damage` 250, `lead` 10),
 * scaled up to 「大型」 by being HALF AS BIG AGAIN IN COUNT rather than by being
 * unsurvivable. It clears a point; it does not hold one. Nobody scores from it,
 * no zone changes hands because of it, and the caller is not on the point he
 * just emptied — he is 26 m up a tower on the other side of the map.
 */
export const SAT_STRIKE = {
  id: 'NF-SAT',
  name: 'ORBITAL BOMBARDMENT',
  /** The post in `plains-tower.js`'s `STORES` this is bound to. */
  post: 'NF-TOWER-SATCALL',
  /**
   * Seconds of HOLD at the console. Twice `RULES.cacheHoldTime`, because the
   * one thing this position has no shortage of is people who can see you.
   */
  hold: 1.2,
  /** Seconds between calls. @see the paragraph above for the arithmetic. */
  cooldown: 100,
  /** Seconds of telegraph before the first round. @see `pulses`. */
  lead: 9.0,
  shells: 12,
  span: 6.0,
  radius: 18,
  damage: 260,
  /**
   * How far out an impact may fall, AS A FRACTION OF THE TARGET ZONE'S OWN
   * RADIUS. Not a metre count: `captureRadius` is 8 on the town and 14 here,
   * and a pattern authored in metres would be a pattern that is wrong on one of
   * them. 0.86 of 14 m is 12.0 m, so the walk covers the circle to its lip and
   * `satProve` can assert every point is inside it. @see the exception note.
   */
  spread: 0.86,
  /**
   * THE DESIGNATOR, in seconds after the call. Five strikes over the nine
   * seconds of lead, accelerating into the impact — 0, 3.4, 6.0, 7.6, 8.5 — so
   * the rhythm itself says how long is left. This is what a satellite has
   * instead of an aeroplane and it is the reason a man standing on the point
   * does not need to be looking at the HUD.
   */
  pulses: [0, 3.4, 6.0, 7.6, 8.5],
  title: 'ORBITAL STRIKE INBOUND',
  impactTitle: 'ORBITAL STRIKE ON TARGET',
  /** Said to the man who called it, and to the man it is falling on. */
  callerLine: 'UPLINK ACCEPTED',
  ownLine: 'GET OFF THE POINT',
};

/** Per map. The town has no tower and therefore no uplink. @see `forMap`. */
export const MAP_SAT = { town: null, plains: SAT_STRIKE };

/**
 * The impact pattern, solved ONCE at boot into two `Float32Array`s of FRACTIONS
 * of the target's radius. Nothing about a strike is computed on the frame it is
 * called: the frame multiplies twelve pairs by one radius and adds a centre.
 *
 * The shape is a walk that starts at the centre and spirals out by the golden
 * angle, so consecutive rounds are never on the same bearing (the objection
 * `climbAim` answers) and there is no safe metre left inside the circle by the
 * end of it. The first round is dead centre because the centre is where a man
 * who has not moved is standing.
 *
 * @param {object} spec `SAT_STRIKE`
 * @param {object} rng  a `ctx.rng` fork — never `Math.random`
 */
export function bakeSatPattern(spec, rng) {
  const n = spec.shells;
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) { u[0] = 0; v[0] = 0; continue; }
    const t = i / (n - 1);
    const a = i * 2.39996 + 0.7;
    // sqrt so the rounds are spread by AREA rather than crowded at the middle,
    // then jittered by a tenth of the spread so the walk is not a diagram.
    const r = Math.min(spec.spread, Math.sqrt(t) * spec.spread + rng.range(-0.06, 0.06));
    u[i] = Math.cos(a) * r;
    v[i] = Math.sin(a) * r;
  }
  return { u, v };
}

/**
 * ⚠ THE GATE ON THE EXCEPTION. Run at boot, over every zone the strike could
 * ever be pointed at, and it proves the INVERSE of what `plainsOpenRuns` proves:
 * every impact of every pattern lands INSIDE the target's own capture circle,
 * and no impact comes within `pads` metres of a base pad.
 *
 * A pattern that fails is a bug in `bakeSatPattern`, not a zone to skip — the
 * offsets are the same for every zone — so this returns the worst case it found
 * and `match` prints it. It is the line somebody reads in a boot log before
 * they conclude the capture-circle rule has been quietly dropped.
 *
 * @param {object} spec  `SAT_STRIKE`
 * @param {object} pat   what `bakeSatPattern` returned
 * @param {Array}  zones the RESOLVED zones (`ensureReachable` has already moved
 *                       them), each `{ id, position, radius }`
 * @param {Array}  pads  `[[x, z], …]` base pad centres, world space
 * @param {number} padClear  metres of clear air owed to a pad
 * @returns {{ ok: boolean, worst: number, nearestPad: number, checked: number }}
 *          `worst` is the largest impact radius seen as a fraction of the
 *          zone's own radius — it must be < 1.
 */
export function satProve(spec, pat, zones, pads, padClear) {
  let worst = 0;
  let nearestPad = Infinity;
  let checked = 0;
  for (const z of zones ?? []) {
    if (!z?.position) continue;
    const R = z.radius ?? 14;
    for (let i = 0; i < spec.shells; i++) {
      const x = z.position.x + pat.u[i] * R;
      const zz = z.position.z + pat.v[i] * R;
      worst = Math.max(worst, Math.hypot(pat.u[i], pat.v[i]));
      for (const p of pads ?? []) nearestPad = Math.min(nearestPad, Math.hypot(x - p[0], zz - p[1]));
      checked++;
    }
  }
  return { ok: worst < 1 && nearestPad >= padClear, worst, nearestPad, checked };
}

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
