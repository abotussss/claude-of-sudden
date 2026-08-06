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
  out[2] = 1.5 + t * (rec.top - 1.5) * 0.94;
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
   * 0.46. Late enough that the four permanent points have been traded for six
   * or seven minutes and D means something when it opens; early enough that the
   * point it opens has the rest of the match to be fought over. @see the
   * measurement in the commit message and `_nfLog` in `MatchSystem`.
   */
  progress: 0.46,
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

/** THE ACTS, IN ORDER. `MatchSystem` walks this list and never indexes it by id. */
export const NF_ACTS = [TOWER_ACT];

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
