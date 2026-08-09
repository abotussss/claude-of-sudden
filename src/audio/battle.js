/**
 * AUDIO / THE BATTLE AROUND YOU
 *
 * Three requests, one file, because all three are the same problem — sounds made
 * by OTHER PEOPLE, in numbers, competing for a pool of 72 spatial emitters:
 *
 *   「また敵味方の銃声があんまり聞こえないのでそれを追加すること 臨場感出して」
 *   「敵味方の足音もかすかに聞こえるようにして」
 *   「戦車の動く音とか砲撃の音も追加して」
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT WAS MEASURED FIRST
 * ────────────────────────────────────────────────────────────────────────────
 * A 20v20 match, real time, sampled at 4 Hz for two minutes of fighting
 * (`node tools/audiotest.mjs --battle`):
 *
 *   weapon:fire events offered   1982 at >70 m, 14 at 30-70 m, 0 inside 30 m
 *   remote shots actually played ~14, because `_onFire` culls past 60 m
 *   live emitters                mean 26.7 of 72   (foley 19.9, weapons 5.3)
 *
 * So the answer to 「銃声があんまり聞こえない」 is not a mixing opinion. Two thousand
 * shots were fired at the player over two minutes and the audio system was
 * shown 14 of them: the map is 114x141 m, the fight is at the capture points,
 * and a 60 m gate is a gate around one street. Meanwhile the WEAPONS bus — the
 * one that should be carrying a war — was using 5 of the 32 slots it is
 * entitled to, while foley used 20 of 28.
 *
 * The footsteps needed no measurement at all: `player:footstep` is emitted by
 * `src/player` and by nothing else, so every footstep sound in the game was the
 * local player's own boot. There has never been a friendly or enemy footfall in
 * this project — `ai` LISTENS to that event and does not emit it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE IS BUILT ON: DENSITY YIELDS
 * ────────────────────────────────────────────────────────────────────────────
 * The pool is shared, and its history is two failed passes at deciding who gets
 * it — one that blamed gunfire when foley held 50 of 72 slots, one that capped
 * foley and made WEAPONS take 42-50 and start DROPPING voices, which is strictly
 * worse than stealing them. Moving a shortage around is not fixing it.
 *
 * So nothing in here ever competes. Every layer asks `field.busLoad()` against
 * `field.busCap()` BEFORE it asks for a voice, and stands down when its bus is
 * already carrying its share — and stands down entirely while the render
 * governor has the pool below full strength (`field.capacity`), which is to say
 * the new content is the FIRST thing to go when the audio thread is in trouble
 * and the last thing to come back. That ordering is deliberate: a distant
 * firefight you cannot hear for two seconds is not a bug, and the dropout it
 * would otherwise cause is.
 *
 * `audio.battle.enabled = false` turns all of it off at runtime, which is how
 * `tools/audiotest.mjs --battle --off` measures the before and after of one
 * build on one machine.
 */

import { clamp } from './dsp.js';
import { WEAPON_PROFILES } from './weapons.js';
import { tankEngine, droneRotor } from './vehicle.js';

/* ---------------------------------------------------------------- */
/* Distant gunfire                                                   */
/* ---------------------------------------------------------------- */

/**
 * Bearing bins. A firefight is a DIRECTION before it is a position — at 120 m
 * nobody can place a rifle to the metre, and eight men shooting from the same
 * quarter of the map are one event to the ear. Coalescing by bearing is what
 * turns 16 shots a second into 4 voices a second without thinning the battle:
 * the rounds are all still there, scheduled inside the voice.
 */
const BINS = 8;
/** How long a bin may collect before it has to be heard. Longer = laggy. */
const BIN_WINDOW = 0.34;
/**
 * Rounds one voice will carry. Past this the bin flushes early.
 *
 * BACK TO 6 — I raised it to 8 in the same pass as the rate and MEASURED the
 * cost at 1x: 95.3 far voices a minute became 75.8, while the ROUNDS inside
 * them went 377 to 490. Fewer, fatter bursts is the wrong trade for this
 * complaint. A voice is one BEARING, and 「銃声が方方でなっている感じが戦争です」 is a
 * request for fire from many directions — the number of distinct directions per
 * second is the voice count, not the round count. 6 keeps the bins flushing
 * early under heavy fire and hands the density back.
 */
const BIN_ROUNDS = 6;
/**
 * ════════════════════════════════════════════════════════════════════════════
 * HOW MANY ROUNDS ONE VOICE MAY CARRY — and it is NOT the number above
 * ════════════════════════════════════════════════════════════════════════════
 * ONE NUMBER WAS DOING TWO JOBS, and that is why moving it kept failing.
 *
 *   `BIN_ROUNDS` 6   "flush this bearing EARLY once six have arrived"
 *                    -> decides VOICE COUNT, i.e. distinct directions a second
 *   this            "a voice may carry this many"
 *                    -> decides DENSITY, i.e. rounds a second
 *
 * They were the same constant, so raising it to 8 to get density bought fatter
 * voices at the cost of fewer of them (95.3 -> 75.8 voices a minute against 377
 * -> 490 rounds) and was correctly reverted: 「銃声が方方でなっている感じが戦争です」
 * is a request for DIRECTIONS, and the revert protected that. The revert was
 * right about the trade and wrong only in having no other lever.
 *
 * Split, there is no trade. `BIN_ROUNDS` stays at 6 and the early flush, the
 * voice count and every word of that argument are untouched. This governs only
 * what happens to the rounds ALREADY IN THE BIN when it is finally heard.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT WAS BEING THROWN AWAY, MEASURED AT REAL SIMULATION SPEED
 * ────────────────────────────────────────────────────────────────────────────
 * Every previous measurement of this layer was taken through `?capture=1`,
 * which pumps a fixed 1/60 s step; under a headless renderer at 8.8 fps that is
 * 0.147x wall clock, while `_farNext` and every audio gate run on
 * `actx.currentTime`, which is real time. The load these numbers were sized
 * against was therefore about SEVEN TIMES too small.
 *
 * Measured without it (`_burstvoice.mjs --mode=live --nocap`, NACHTFELD, player
 * driven into contact): **3405 rounds binned, 279-392 carried.** `_updateFar`
 * took `Math.min(BIN_ROUNDS, n)` and then set `_binN[b] = 0`, so a bin holding
 * twenty-six rounds played six and dropped twenty.
 *
 * And the CADENCE lied on the way out, which is the audible half. `spacing` is
 * `age / (rounds - 1)`, so six rounds were spread across a window that had
 * actually held twenty-six — and a bin that had waited out a `BIN_STALE` 1.4 s
 * of refusals played its six rounds 220 ms apart, at the clamp. Six taps a
 * fifth of a second apart IS 「単発を数回打つだけ」, arriving from this file.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY 18, AND WHY IT COSTS NO SLOT
 * ────────────────────────────────────────────────────────────────────────────
 * A round inside `distantFire` is five nodes — a source, a bandpass and a gain
 * for the crack, an oscillator and a gain for the thump — on a voice that
 * already builds ~13 shared ones. Eighteen rounds is ~103 nodes against an
 * explosion's ~300, on ONE emitter instead of eighteen. That is the whole
 * budget argument this layer was built on, used for what it was built for.
 *
 * It cannot lengthen a voice, and that bound is enforced rather than hoped for:
 * the count is additionally capped at what fits in the bin's OWN window at the
 * voice's own minimum spacing (@see `_updateFar`), so the burst never spans
 * more time than it took to arrive, `end` does not move, and slot occupancy —
 * the thing `FAR_FLOOR_SLOTS` rations at the pool floor — is unchanged.
 *
 * The roll cannot inflate either: `distantFire` clamps its envelope at
 * `Math.min(1.6, 0.6 + rounds * 0.16)`, which is already at the ceiling by
 * 6.25 rounds, so every round past that adds cracks and no level.
 *
 * `distantFire`'s own internal ceiling MUST move with this or the two disagree
 * silently and the extra rounds are dropped one function further down — the
 * same failure `FAR_MAX` and `playFar`'s `maxDist` are documented against.
 * @see distantFire in src/audio/weapons.js
 */
const FAR_ROUNDS_MAX = 18;
/**
 * The tightest two rounds inside one coalesced voice may be, seconds. It is
 * `distantFire`'s own floor restated so the cap above can be computed against
 * it here; if they disagree the voice silently stretches past its bin's window.
 *
 * It is also very nearly the real number: measured at real simulation speed the
 * plain offers ~196 rounds a second to this layer across 8 bearings, i.e. ~41 ms
 * between rounds in one bearing. Coalescing at 45 ms is therefore not throwing
 * information away — below this the ear has no separate events to lose.
 */
const FAR_SPACING_MIN = 0.045;
/**
 * The longest a coalesced voice's ROUNDS may span, seconds — and the number is
 * not chosen, it is the one the shipped code already enforced.
 *
 * `BIN_ROUNDS` 6 at the 0.22 s spacing clamp is 1.1 s, so no far voice has ever
 * laid its rounds out over more than that. Restating it explicitly is what lets
 * the round count rise without the slot time rising with it.
 *
 * MEASURED, and this is why it exists. Taking the count from `age` alone gave
 * a stale bin a 1.4 s burst where it used to get a 1.1 s one, and on a layer
 * rationed to three concurrent slots at the pool floor that came straight out
 * of the voice count: an A/B on one build at the same offered rate
 * (`_burstvoice.mjs --nocap --clamp=72 --bin6`, 402 vs 415 rounds/s offered)
 * gave 101 far rounds a second against 74.5 — but 12.4 far VOICES a second
 * against 15.9. Rounds up 35 %, directions down 22 %, which is precisely the
 * trade the `BIN_ROUNDS` 8 -> 6 revert refused, arriving by a different route.
 *
 * Bounding the span holds the slot time at exactly what it was, so the extra
 * rounds are free and 「銃声が方方でなっている感じが戦争です」 keeps its voice count.
 * The rounds are then laid out slightly compressed against the wall-clock
 * window they arrived in — which the 0.22 clamp was already doing, and which is
 * inaudible as a cadence error next to playing six of twenty-six.
 */
const FAR_SPAN_MAX = 1.1;
/**
 * Voices a second, all bins together. 9, up from 5 — the THIRD round of
 * 「銃声が全然聞こえない、銃声が方方でなっている感じが戦争です」, and this round the
 * number under complaint is DENSITY, not level: MEASURED through a live 20v20
 * with the pool pinned healthy (`--battle --clamp=72`), ~290 far shots a minute
 * were offered and 11.6 far voices a minute rendered. A battle of forty men was
 * reaching the player as one distant burst every five seconds; no level tweak
 * makes that feel like war from every direction. The rate was never the only
 * gate (see `_updateFar` on refusals) but at 5 it capped a dense fight at well
 * under one voice per bearing per second. A far voice is ~7 nodes a round on
 * one emitter, so nine a second is still cheaper than one near `weaponShot`.
 */
const FAR_RATE = 9;
/**
 * How stale a bin may go while its bus is busy before its rounds are dropped.
 * @see _updateFar — a refusal used to throw the whole bin away.
 */
const BIN_STALE = 1.4;
/**
 * Nothing past this is worth a slot; `ambience` carries the rest of the war.
 *
 * 230 -> 320, AND THIS IS A MAP SIZE, NOT A MIX OPINION. 230 m is a diagonal of
 * the town (114x141 m, 181 m corner to corner), so on the town this number has
 * never once been reached and this change is a NO-OP there — that is the whole
 * reason it is safe. NACHTFELD is a plain whose capture zones are 154-314 m
 * apart and whose bases are 302 m apart, and MEASURED through a live 20v20 on
 * it (`_plainguns.mjs --map=plains --drive`, 60 s at 1x) 94 remote rounds a
 * minute were fired from beyond 230 m and thrown away by this line — 5 % of the
 * war, and specifically the half of the map the player is walking towards.
 *
 * `playFar`'s own `maxDist` moves with it (260 -> 340) or the two disagree and
 * the band between them is a silent ring. @see AudioSystem.playFar
 *
 * The level out there is still honest and still monotone: `gunRangeGain` puts a
 * burst at 300 m 2.3 dB under one at 90 m, so the far edge of the plain is
 * audible and audibly farther away.
 */
const FAR_MAX = 320;
/**
 * Where the near path stops. `_onFire` plays a full `weaponShot` inside this and
 * this file takes everything outside it — the two ranges MUST agree or a band of
 * the map goes silent again. @see AudioSystem._onFire
 */
const FAR_MIN = 60;
/**
 * ════════════════════════════════════════════════════════════════════════════
 * A FLOOR UNDER THE DISTANT WAR — 「敵味方全ての銃声をもっと鳴らして」
 * ════════════════════════════════════════════════════════════════════════════
 *
 * How many coalesced far voices may be live AT ONCE when `_room` has already
 * said no. It is a small, absolute allowance, and it exists because of one
 * measurement on the map the complaint is about.
 *
 * MEASURED, NACHTFELD, 60 s at 1x with the player driven into a real firefight
 * (`_plainguns.mjs --map=plains --drive`; median nearest enemy 3.6 m):
 *
 *   remote rounds fired by bots            1862 / min
 *   inside 60 m (the near `weaponShot`)     358        19 %
 *   offered to this layer                  1504        81 %
 *   taken into a bearing bin               1410
 *   `_room('weapons', 0.85)` asked          2458
 *   `_room` REFUSED                         2458       100 %
 *   `playFar` reached                          0
 *   far voices played                          0
 *   rounds left rotting in bins at the end     98
 *
 * Every arrow in the chain was healthy except one, and that one was total. The
 * cause is arithmetic: `_room`'s fade is 0 at `full * 0.34` = 24.48 slots and
 * the render governor's floor is `MIN_EMITTERS` = 24 (see spatial.js), so at
 * the floor `head` is not small, it is ZERO — and a busy match SITS at the
 * floor (measured pool cap 24/72 for the whole run, on both maps). The fade
 * that replaced the old cliff put a new cliff one slot lower down and landed it
 * exactly on the state the game is actually in.
 *
 * On the town that was survivable, because the town is 114x141 m and most of
 * its fire is inside 60 m, where the FULL `weaponShot` runs and is governed by
 * nothing here. On a 200 m plain it is not survivable, because 81 % of every
 * round fired is on this path: the layer being off IS the war being silent.
 * That is 「銃声がなんでもっとならないの？」 and it is not a level.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY A FLOOR AND NOT A GENTLER FADE
 * ────────────────────────────────────────────────────────────────────────────
 * The fade is a share of the WEAPONS BUS, and at the pool's floor that bus is
 * 10 slots of which the near fight already holds ~7 (measured 6.9 mean). Any
 * share of that number is under one voice, so no amount of re-shaping the fade
 * gives the distant war a voice while a near fight is on — which on this map is
 * always. What the far layer needs is what `_busCap` says a category needs when
 * it is losing to sheer arrival rate: a QUOTA OF ITS OWN, small and absolute.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IT CAN AND CANNOT TAKE — the containment, stated so it can be checked
 * ────────────────────────────────────────────────────────────────────────────
 * This is the first thing in this file that ever COMPETES, so the bound matters
 * and it is already enforced by `acquire`, not by hope. A far voice asks at
 * priority 0.3 and `acquire` refuses any victim above `pri + 0.25` = 0.55:
 *
 *   near remote shot   0.59-0.95 (0.95 - dist*0.006, and it only exists inside
 *                      60 m, so 0.59 is its floor)          CANNOT BE TAKEN
 *   bark 0.85, explosion 1.0, tank gun 0.99                 CANNOT BE TAKEN
 *   collapse 1.3, and everything at PROTECTED_PRI 1.2       CANNOT BE TAKEN
 *   impact 0.55, warfield's far 0.5, remote step 0.28       can be taken
 *
 * So the floor cannot make the fight in front of you quieter; at worst it costs
 * three impacts or footfalls out of twenty-four slots. Three voices is ~126
 * Web Audio nodes — less than half of one explosion — and each carries up to
 * `BIN_ROUNDS` rounds, so the ceiling this puts back is ~14 distant rounds a
 * second at the pool's floor rather than zero.
 *
 * IT IS ONLY EVER MORE PERMISSIVE THAN THE CODE IT REPLACES: `_farRoom` returns
 * true everywhere `_room` did and in one band more. A healthy pool is bit for
 * bit what it was, and `FAR_RATE` still caps the whole layer at 9 voices a
 * second either way.
 */
const FAR_FLOOR_SLOTS = 3;

/* ---------------------------------------------------------------- */
/* Footsteps of other men                                            */
/* ---------------------------------------------------------------- */

/**
 * 40 m. NOT a fresh guess: this range was cut from 45 to 26 once as a fix for
 * the voice pool, movement went inaudible, and it had to be put back — the whole
 * of 「敵味方の足音もかすかに聞こえるようにして」 is a request for the thing that cut
 * removed. It is far enough to hear a man crossing the courtyard you are
 * watching, the level falls with distance anyway (so it is faint, which is what
 * was asked for), and the pool is protected by the budget gate rather than by
 * making the game quieter.
 */
const STEP_RANGE = 40;
/** Footfalls a second, everybody on the map together. */
const STEP_RATE = 9;
/** …and the most that may be started in any one frame, however many are due. */
const STEP_PER_FRAME = 2;
/**
 * Stride length per gait, metres. A step is emitted per stride of GROUND
 * COVERED rather than on a timer, so the cadence is automatically right at every
 * speed and a man who stops mid-stride does not get a phantom footfall. Same
 * principle `src/ai/animator.js` uses to keep the visible feet stuck to the
 * ground, so the two stay in step without either subsystem knowing the other.
 */
const STRIDE = { crouch: 1.1, walk: 1.62, run: 1.92, sprint: 2.12 };
/** Below this a man is standing still, whatever the animation is doing. */
const STEP_MIN_SPEED = 0.35;

/**
 * HOW LOUD ANOTHER MAN'S BOOT IS, per metre — 「敵味方の足音はもう少し小さくして
 * ください」.
 *
 * The first version played every remote step at the same trim as the local
 * player's own (1.0, the argument being "another man's boot is the same boot").
 * That was reported as too loud, and the shape of the complaint matters more
 * than the amount: the steps that are too loud are the NEAR ones. The distance
 * curve is steep in the first ten metres and nearly flat after thirty, so a flat
 * trim is loudest exactly where the player is most likely to be standing next to
 * somebody, and a flat CUT would take the same decibels off a man at 38 m — who
 * is already at the edge of audibility.
 *
 * TAKING THE RANGE DOWN INSTEAD IS THE ONE THING THAT MUST NOT HAPPEN. It was
 * done once (45 m -> 26 m, to save emitters), it made movement inaudible, and it
 * had to be put back to 40 m; 「足音もかすかに聞こえるようにして」 is a request for
 * precisely the thing that cut removed. So the range is untouched and the trim
 * is tilted: -5.7 dB at 8 m, -2.0 dB at 40 m.
 *
 * MEASURED through the real mixer and the real distance chain (selftest.js),
 * against the player's own step at peak 0.0378 and the ambience bed at rms
 * 0.00362:
 *
 *              was (flat 1.0)      now
 *    8 m       0.0098              0.0051    -17.4 dB under his own boot
 *   20 m       0.0040              0.0025    -23.6 dB
 *   40 m       0.0019              0.0015    -28.0 dB, still above the bed
 */
export function remoteStepLevel(dist) {
  return 0.45 + 0.35 * clamp(dist / STEP_RANGE, 0, 1);
}
/** How often a man's ground surface is re-checked, seconds. One ray each. */
const SURFACE_TTL = 2.5;

/* ---------------------------------------------------------------- */
/* Armour                                                            */
/* ---------------------------------------------------------------- */

/** A tank is audible a long way off; this is where it stops being worth a slot. */
const ENGINE_RANGE = 190;
/** Advance speed in `src/match/tank.js` is 4.6 m/s; this normalises the throttle. */
const TANK_TOP_SPEED = 4.6;

/* ---------------------------------------------------------------- */
/* Drones                                                            */
/* ---------------------------------------------------------------- */

/**
 * Where a 2 kg airframe stops being worth an emitter. Well past the 58 m the
 * placeholder used: `match` flies these at 22 m altitude in the open, and the
 * thing that makes a drone fair is hearing it BEFORE it is overhead. The level
 * falls with distance anyway, so the far end is faint rather than loud.
 */
const DRONE_RANGE = 120;
/** `RULES.droneDiveSpeed` is 17 m/s and cruise is 10; this normalises load. */
const DRONE_TOP_SPEED = 17;
/**
 * How often the head-locked lock warble repeats while a drone holds the player.
 * `match` gives him 2.2 s of warning, so this fires roughly three times: once is
 * a noise he might have imagined, three times is a machine talking to him.
 */
const LOCK_REPEAT = 0.72;

export class BattleLayer {
  /** @param {import('./index.js').AudioSystem} audio */
  constructor(audio) {
    this.audio = audio;
    this.enabled = true;

    /* ---- distant fire: preallocated bins, nothing per frame ------ */
    this._binN = new Int32Array(BINS);
    this._binX = new Float64Array(BINS);
    this._binY = new Float64Array(BINS);
    this._binZ = new Float64Array(BINS);
    this._binT = new Float64Array(BINS);
    this._binP = new Array(BINS).fill(null);
    this._binCursor = 0;
    this._farNext = 0;

    /* ---- footsteps ---------------------------------------------- */
    // Keyed on the Agent itself: `match` replaces a respawned bot with a NEW
    // Agent, so anything keyed on an id would resurrect a dead man's stride
    // phase. A WeakMap also needs no pruning pass.
    this._walkers = new WeakMap();
    this._stepNext = 0;
    this._probeOrigin = { x: 0, y: 0, z: 0 };
    this._down = { x: 0, y: -1, z: 0 };

    /* ---- armour -------------------------------------------------- */
    this._tanks = [];
    this._dying = [];

    /* ---- drones --------------------------------------------------- */
    // Parallel to `match.drones.list` by INDEX, exactly as `_tanks` is to
    // `match.tank.tanks`: the list is a fixed pool of records that are reused,
    // so a slot is a stable identity and nothing here allocates per frame.
    this._drones = [];
    this._lockNext = 0;

    this.stats = {
      farVoices: 0, farRounds: 0, farHeld: 0,
      steps: 0, stepsHeld: 0,
      engines: 0, tankShots: 0,
      rotors: 0, locks: 0,
    };
  }

  /* ================================================================ */
  /* budget                                                           */
  /* ================================================================ */

  /**
   * May a BACKGROUND voice take a slot on `bus` right now?
   *
   * Two questions, and both have to be yes:
   *   1. how much of the field is the render governor still willing to fill?
   *      When the audio thread is losing real time the correct amount of extra
   *      content is less, and at the floor it is none. @see _trackRender
   *   2. is this bus under `share` of its own quota? Not of the pool — of its
   *      quota, so a busy foley bus stops the footsteps without touching the
   *      gunfire and vice versa.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * (1) WAS A CLIFF AND THE CLIFF WAS THE BUG.
   * ──────────────────────────────────────────────────────────────────────────
   * It read `if (f.capacity < f.emitters.length * 0.66) return false`, so 47 of
   * 72 slots and 24 of 72 were the same state: nothing. MEASURED by pinning the
   * governor (`tools/audiotest.mjs --battle --clamp=N`) through a live 20v20:
   *
   *   pool 60/72   26 far voices, 35 remote footfalls   (390 remote shots offered)
   *   pool 48/72   26 far voices, 42 remote footfalls   (592 offered)
   *   pool 40/72    0 far voices,  0 remote footfalls   (1003 offered)
   *
   * A thousand shots were fired at the player over eighty-nine seconds of game
   * and he was played none of them, because the pool was seven slots under an
   * arbitrary line. That is 「敵味方の銃声があんまり聞こえない」 arriving as a switch
   * rather than as a mix, and it is invisible from inside a match: the counters
   * stay healthy, nothing is dropped, nothing is stolen, there is simply no war.
   *
   * The ORDERING is deliberate and is kept — this content is still the first
   * thing to go when the thread is in trouble and the last to come back. What
   * changes is that the last stretch of that is a FADE instead of a switch, and
   * the fade is placed so that this is never LESS permissive than the code it
   * replaces: `head` is 1 everywhere above the old 66 % line, so a healthy match
   * behaves bit for bit as it did, and it falls to 0 at the pool's floor, where
   * the layer stood down before and still does. Everything it changes lies
   * strictly inside the band that used to be silent.
   *
   * The layer still cannot grow the pool — that is the bus quota's job, and the
   * quota is a share of the CURRENT cap, so it has already shrunk too.
   */
  _room(bus, share) {
    const f = this.audio.field;
    if (!f) return false;
    const full = f.emitters.length;
    if (!full) return false;
    // 0 at the governor's floor (0.34 of full), 1 at the old cliff (0.66).
    const head = clamp((f.capacity - full * 0.34) / (full * 0.32), 0, 1);
    if (head <= 0.02) return false;
    return f.busLoad(bus) < f.busCap(bus) * share * head;
  }

  /** Coalesced far voices live in the field right now. @see AudioSystem.playFar */
  _farLive() {
    const f = this.audio.field;
    if (!f) return 0;
    let n = 0;
    for (let i = 0; i < f.emitters.length; i++) {
      const e = f.emitters[i];
      if (!e.free && e.kindTag === 'far') n++;
    }
    return n;
  }

  /**
   * May the distant war take a slot? `_room` first — so a healthy pool behaves
   * exactly as it did — and under it an absolute floor of `FAR_FLOOR_SLOTS`,
   * because on a 200 m map this layer is not extra content, it is the battle.
   * @see FAR_FLOOR_SLOTS for the measurement and for what a far voice can and
   * cannot evict.
   */
  _farRoom(live) {
    if (this._room('weapons', 0.85)) return true;
    return live < FAR_FLOOR_SLOTS;
  }

  /* ================================================================ */
  /* distant gunfire                                                  */
  /* ================================================================ */

  /**
   * A remote shot too far away for the full voice. Returns true when it was
   * taken into a bin — the caller has then done its job and must not also play
   * it, which is the invariant that keeps one shot from being heard twice.
   */
  offerFar(x, y, z, dist, profile) {
    if (!this.enabled) return false;
    if (dist < FAR_MIN || dist > FAR_MAX) return false;
    const lp = this.audio.field.listenerPos;
    // Bearing in the horizontal plane, listener-relative. atan2 returns
    // (-pi, pi]; the +pi shifts it into [0, 2pi) so the bin index is a floor.
    const a = Math.atan2(z - lp.z, x - lp.x) + Math.PI;
    const b = Math.min(BINS - 1, ((a / (Math.PI * 2)) * BINS) | 0);
    if (this._binN[b] === 0) {
      this._binT[b] = this.audio.actx.currentTime;
      this._binX[b] = 0; this._binY[b] = 0; this._binZ[b] = 0;
    }
    this._binN[b]++;
    this._binX[b] += x; this._binY[b] += y; this._binZ[b] += z;
    this._binP[b] = profile ?? WEAPON_PROFILES.rifle;
    return true;
  }

  /** Flush whichever bins are ready, inside the voice budget. */
  _updateFar(now) {
    /**
     * Counted ONCE per frame and then tracked locally. `stats.farHeld` is the
     * same census but it is computed at the END of `update()`, i.e. a frame
     * stale — and a gate that is a frame stale is a gate that can be beaten by
     * a burst, which is the whole failure mode this layer keeps having.
     */
    let live = this._farLive();
    // Round-robin the start of the scan so one bearing cannot monopolise the
    // rate limit just because it is first in the array.
    for (let k = 0; k < BINS; k++) {
      const b = (this._binCursor + k) % BINS;
      const n = this._binN[b];
      if (n === 0) continue;
      const age = now - this._binT[b];
      if (age < BIN_WINDOW && n < BIN_ROUNDS) continue;
      if (now < this._farNext) return;                 // over rate; keep collecting
      /**
       * A REFUSAL NO LONGER EMPTIES THE BIN. It used to (`_binN[b] = 0`), and
       * MEASURED at a healthy pool that discard was the dominant filter on the
       * far war, not the rate: the weapons bus rides its own firefight above
       * the 0.7 share for whole engagements, and every scan that landed there
       * threw a full bearing's worth of rounds away — ~290 offered a minute
       * became 11.6 voices a minute. The rounds now WAIT for the bus (they are
       * four numbers in a bin, they cost nothing), and only rounds older than
       * `BIN_STALE` are dropped, because a burst replayed a second and a half
       * late is no longer the battle that is happening. The share rises to
       * 0.85: the far layer still yields to the fight in front of you, still
       * fades with the governor's `head`, and still cannot grow the pool.
       */
      if (!this._farRoom(live)) {
        if (age > BIN_STALE) this._binN[b] = 0;
        continue;
      }
      this._binCursor = (b + 1) % BINS;
      this._farNext = now + 1 / FAR_RATE;
      /**
       * TAKE WHAT ARRIVED, NOT SIX — @see FAR_ROUNDS_MAX for the measurement.
       *
       * Three bounds, and the third is what keeps this free:
       *   `FAR_ROUNDS_MAX`  the node budget for one voice
       *   `n`               there is no point inventing rounds nobody fired
       *   the window        never more rounds than fit in the time they took to
       *                     arrive, at the voice's own minimum spacing. This is
       *                     what stops a deep bin stretching its burst past its
       *                     own window: `end` cannot move, so the emitter is
       *                     held no longer than before and `FAR_FLOOR_SLOTS`
       *                     rations exactly what it rationed yesterday.
       *
       * A bin flushed on the 0.34 s window carries up to 9 rather than 6; one
       * that waited out a `BIN_STALE` 1.4 s of refusals carries up to 18 rather
       * than 6, and plays them 82 ms apart instead of six taps at the 220 ms
       * clamp.
       */
      // The window the rounds are laid out over: what actually happened, but
      // never more slot time than the shipped code took. @see FAR_SPAN_MAX.
      const span = Math.min(age, FAR_SPAN_MAX);
      const rounds = Math.min(FAR_ROUNDS_MAX, n, 1 + Math.round(span / FAR_SPACING_MIN));
      const x = this._binX[b] / n, y = this._binY[b] / n, z = this._binZ[b] / n;
      this._binN[b] = 0;
      // Spacing is the cadence that actually happened: the rounds arrived over
      // `age` seconds, so play them over `age` seconds. A bin that filled in
      // 40 ms was a burst and sounds like one.
      const spacing = clamp(span / Math.max(1, rounds - 1), FAR_SPACING_MIN, 0.22);
      // The voice takes its distance from the emitter's own position, which is
      // the mean of the bin — so the band it is shaped for and the attenuation
      // it is played at are the same number by construction.
      const ok = this.audio.playFar(x, y, z, { profile: this._binP[b], rounds, spacing });
      if (ok) { live++; this.stats.farVoices++; this.stats.farRounds += rounds; }
    }
  }

  /* ================================================================ */
  /* footsteps                                                        */
  /* ================================================================ */

  /**
   * Every live actor's boots. There is no event for this — `ai` does not emit
   * one — so the stride is integrated from the actor's own POSITION, which is
   * published (`ai.agents`) and cannot disagree with what is drawn.
   */
  _updateSteps(dt, now) {
    const audio = this.audio;
    const ai = audio.ctx.peek('ai');
    const agents = ai?.agents;
    if (!agents || !agents.length) return;
    const lp = audio.field.listenerPos;
    const rate = 1 / STEP_RATE;
    let started = 0;

    for (let pass = 0; pass < STEP_PER_FRAME; pass++) {
      let best = null, bestD = Infinity;

      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        const p = a?.position;
        if (!p) continue;
        let w = this._walkers.get(a);
        if (!w) {
          // Allocated once per ACTOR, not per frame. A 5 minute match with
          // respawns makes a few hundred of these and no more.
          w = { x: p.x, y: p.y, z: p.z, acc: 0, surface: 'concrete', surfAt: -99, due: false };
          this._walkers.set(a, w);
          continue;
        }
        // The integration runs on the FIRST pass only; the second pass is just
        // picking the next-nearest man who was already found to be due.
        if (pass === 0) {
          const dx = p.x - w.x, dz = p.z - w.z;
          w.x = p.x; w.y = p.y; w.z = p.z;
          if (!a.alive) { w.acc = 0; w.due = false; continue; }
          const moved = Math.sqrt(dx * dx + dz * dz);
          const speed = dt > 1e-4 ? moved / dt : 0;
          if (speed < STEP_MIN_SPEED) { w.due = false; continue; }
          w.speed = speed;
          w.acc += moved;
          const gait = a.crouch ? 'crouch' : speed >= 5.4 ? 'sprint' : speed >= 3.4 ? 'run' : 'walk';
          w.gait = gait;
          if (w.acc < STRIDE[gait]) { w.due = false; continue; }
          w.due = true;
        }
        if (!w.due) continue;
        const d = Math.hypot(p.x - lp.x, p.y - lp.y, p.z - lp.z);
        if (d > STEP_RANGE) { w.acc = 0; w.due = false; continue; }
        if (d < bestD) { bestD = d; best = w; }
      }

      if (!best) return;
      // Budget and rate are checked AFTER the nearest due man is found, so a
      // refusal costs the near one his footfall rather than whoever happened to
      // be first in the roster.
      if (now < this._stepNext) return;
      if (!this._room('foley', 0.72)) { best.acc = 0; best.due = false; return; }
      this._stepNext = now + rate;
      best.acc -= STRIDE[best.gait];
      best.due = false;
      this._step(best, bestD, now);
      if (++started >= STEP_PER_FRAME) return;
    }
  }

  _step(w, dist, now) {
    const audio = this.audio;
    if (now - w.surfAt > SURFACE_TTL) {
      w.surfAt = now;
      const phys = audio.ctx.peek('physics');
      if (phys?.raycast) {
        const o = this._probeOrigin;
        o.x = w.x; o.y = w.y + 0.9; o.z = w.z;
        const h = phys.raycast(o, this._down, 2.4, phys.MASK?.WORLD);
        if (h?.hit && h.surface) w.surface = h.surface;
      }
    }
    /**
     * FAINT IS THE DISTANCE, AND NOW ALSO THE TRIM. @see remoteStepLevel for the
     * measurements and for why the RANGE is not the lever that moved.
     */
    const ok = audio._playAt('step', w.x, w.y, w.z, {
      surface: w.surface,
      gait: w.gait,
      level: remoteStepLevel(dist),
      // Kit is the bright, carrying part of a footfall and the part that reads
      // as "loud" across a street, so it comes down further than the boot does.
      gear: w.gait === 'crouch' ? 0.12 : w.gait === 'walk' ? 0.22 : 0.45,
      tag: 'step',
      /**
       * 0.28. A remote footfall must not be able to evict anything that matters:
       * `acquire` will only steal a voice whose priority is at most `pri + 0.25`,
       * so at 0.28 this reaches nothing above 0.53 — no shot (0.4 floor, 0.95 at
       * the muzzle), no explosion, no bark, not your own boots at 0.99. It can
       * take a slot from another remote footstep, which is exactly the intent:
       * the nearest man wins, and the pool never grows because of this layer.
       */
    }, 'foley', 0.28);
    if (ok) this.stats.steps++;
  }

  /* ================================================================ */
  /* armour                                                           */
  /* ================================================================ */

  /**
   * One tracked emitter per hull that is on the map. `match.armour.tanks` is the
   * published record — `[{ id, team, name, alive, health, position }]` — and
   * SPEED IS DIFFERENTIATED FROM POSITION rather than read out of `tank.js`,
   * which publishes no velocity and is not ours to change.
   */
  _updateTanks(dt, now) {
    const audio = this.audio;
    /**
     * `tank` AND `armour`, BECAUSE THE PUBLISHED NAME AND THE FIELD DISAGREE.
     * `src/match/tank.js` documents its own handle as `ctx.get('match').armour`
     * and `src/match/index.js` assigns it to `this.tank`. Reading only the
     * documented one found `undefined` on every frame of every match and the
     * engine never started — measured, silently, with no error: a null-safe
     * chain on a name that does not exist is indistinguishable from "no tanks in
     * this match". Both names are read, and whichever `match` actually has wins.
     */
    const m = audio.ctx.peek('match');
    const armour = m?.tank ?? m?.armour;
    const list = armour?.tanks;
    if (!list) { if (this._tanks.length) this._stopAllEngines(now); return; }

    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const p = t?.position;
      if (!p) continue;
      let rec = this._tanks[i];
      if (!rec) {
        rec = { x: p.x, y: p.y, z: p.z, speed: 0, engine: null, em: null };
        this._tanks[i] = rec;
      }
      const dx = p.x - rec.x, dy = p.y - rec.y, dz = p.z - rec.z;
      rec.x = p.x; rec.y = p.y; rec.z = p.z;
      const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // A tracked vehicle does not change speed in a frame; smoothing it keeps
      // one long frame from making the engine bark.
      const inst = dt > 1e-4 ? moved / dt : 0;
      rec.speed += (Math.min(inst, 12) - rec.speed) * Math.min(1, dt * 6);

      const dist = audio.field.distanceTo(p.x, p.y, p.z);
      const want = this.enabled && !!t.alive && dist < ENGINE_RANGE;
      if (want && !rec.engine) this._startEngine(rec, p, dist, now);
      if (!want && rec.engine) this._stopEngine(rec, now);
      if (rec.engine) {
        rec.em.moveTo(p.x, p.y + 1.1, p.z, 0.08);
        rec.engine.drive(clamp(rec.speed / TANK_TOP_SPEED, 0, 1), rec.speed, now);
        /**
         * RENEW THE LEASE. A `tracked` emitter is exempt from the expiry loop,
         * so it is held for as long as its owner keeps saying so — and if THIS
         * loop ever stops running (a throw upstream, a torn-down match, a tank
         * record that goes away) the slot would be pinned for the rest of the
         * game with an engine playing into it. The field takes it back three
         * seconds after the last renewal. @see Emitter.lease
         */
        rec.em.lease = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000 + 3;
      }
    }

  }

  /**
   * Anything faded out is disconnected here, on the frame loop, so no timer
   * outlives `dispose()`.
   *
   * IT IS CALLED FROM `update`, NOT FROM `_updateTanks`, and that move is a bug
   * fix rather than tidying: `_updateTanks` RETURNS EARLY when `match` has no
   * hull list, which is most of a match, so anything left fading was reaped
   * only while armour happened to be on the map. That was harmless while tanks
   * were the only continuous voice — they are the thing whose absence causes
   * the early return — and is not harmless now that a drone's rotor uses the
   * same queue: a fading rotor would hold its emitter until the sortie rolled.
   */
  _reap(now) {
    for (let i = this._dying.length - 1; i >= 0; i--) {
      const d = this._dying[i];
      if (now < d.at) continue;
      d.engine.free();
      d.em?.detach();
      this._dying.splice(i, 1);
    }
  }

  _startEngine(rec, p, dist, now) {
    const audio = this.audio;
    const f = audio.field;
    // Do not START one while the governor has the pool clamped — but an engine
    // that is already running keeps running: a tank that goes silent halfway
    // down the street is a worse artefact than a tank that arrives late.
    if (f.capacity < f.emitters.length * 0.66) return;
    const em = f.acquire({
      x: p.x, y: p.y + 1.1, z: p.z,
      when: now, dist, bus: 'weapons',
      priority: 0.92,
      send: 0.1,
      /**
       * 0.9, MEASURED. At 2.4 a hull rolling 25 m away rendered at rms 0.0316
       * through the real mixer — seven times the rms of the player's own rifle
       * (0.00356) and nearly nine times the whole ambience bed (0.00362), for a
       * sound that is CONTINUOUS. It would have buried the game. At 0.9 the same
       * hull is rms 0.0119: still the loudest thing on the street by a wide
       * margin, which a 50-tonne diesel should be, and still under a gunshot.
       */
      gain: 0.9,
      endTime: now + 3600,
      tracked: true,
    });
    if (!em) return;
    const engine = tankEngine(audio.actx, audio.bank, audio.rng, { when: now });
    f.hold(em, engine.node, now + 3600, 0.1);
    rec.engine = engine;
    rec.em = em;
    this.stats.engines++;
  }

  _stopEngine(rec, now) {
    if (!rec.engine) return;
    const at = rec.engine.stop(now);
    this._dying.push({ engine: rec.engine, em: rec.em, at });
    rec.engine = null;
    rec.em = null;
  }

  _stopAllEngines(now) {
    for (const rec of this._tanks) if (rec?.engine) this._stopEngine(rec, now);
  }

  /** `match:tank { phase: 'fire' }` — the report the roll was missing. */
  onTankFire(x, y, z) {
    if (!this.enabled) return;
    const ok = this.audio._playAt('tankgun', x, y + 1.6, z, {
      /**
       * 3.0, and it is the one sound in this file that is allowed to be LOUDER
       * than the player's own weapon: measured at 30 m it peaks at 0.050 against
       * his rifle's 0.0831 in his own hands, and `tank.js` plays its roll on top
       * of this. A 120 mm going off down the street from you is the loudest
       * thing in the match and the mix should say so.
       */
      level: 1, maxDist: 400, gain: 3.0, occlusion: 0.25, send: 0.22,
    }, 'weapons', 0.99);
    if (ok) this.stats.tankShots++;
  }

  /* ================================================================ */
  /* drones                                                           */
  /* ================================================================ */

  /**
   * ONE TRACKED EMITTER PER AIRFRAME, off `match.drones.list`.
   *
   * This is `_updateTanks` with a different motor, and deliberately so: the
   * request was for the rotor to be driven off the published list "exactly as
   * battle.js drives tankEngine off match.tank.tanks", `match` publishes the
   * array saying so, and the two loops now share their whole shape — differentiate
   * speed from position (nothing publishes velocity and it is not ours to add),
   * start inside range, stop outside it or on death, renew the lease every frame
   * so a dead owner cannot pin a slot.
   *
   * The one thing armour does not have is the LOCK: `match` marks the drone that
   * currently owns the player's warning with `warning` on its own record, so the
   * head-locked warble is driven off that flag rather than off the `lock` event,
   * which fires for everybody's locks and not just his.
   */
  _updateDrones(dt, now) {
    const audio = this.audio;
    const m = audio.ctx.peek('match');
    const list = m?.drones?.list;
    if (!list) { if (this._drones.length) this._stopAllRotors(now); return; }

    let warned = false;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const p = d?.position;
      if (!p) continue;
      let rec = this._drones[i];
      if (!rec) {
        rec = { x: p.x, y: p.y, z: p.z, speed: 0, rotor: null, em: null };
        this._drones[i] = rec;
      }
      const dx = p.x - rec.x, dy = p.y - rec.y, dz = p.z - rec.z;
      rec.x = p.x; rec.y = p.y; rec.z = p.z;
      const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const inst = dt > 1e-4 ? moved / dt : 0;
      // Lighter smoothing than the tank's: a quad changes speed in a tenth of a
      // second and the dive has to be audible as it starts, not after it.
      rec.speed += (Math.min(inst, 30) - rec.speed) * Math.min(1, dt * 12);

      const dist = audio.field.distanceTo(p.x, p.y, p.z);
      const want = this.enabled && !!d.alive && dist < DRONE_RANGE;
      if (want && !rec.rotor) this._startRotor(rec, p, dist, now);
      if (!want && rec.rotor) this._stopRotor(rec, now);
      if (rec.rotor) {
        rec.em.moveTo(p.x, p.y, p.z, 0.05);
        rec.rotor.drive(clamp(rec.speed / DRONE_TOP_SPEED, 0, 1), rec.speed, now);
        rec.em.lease = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000 + 3;
      }
      if (d.alive && d.warning) warned = true;
    }

    /**
     * THE WARBLE, while somebody's drone is holding HIM. Repeated rather than
     * one-shot: `match` gives 2.2 s of warning and a single pip at the start of
     * it is a sound he can talk himself out of having heard.
     */
    if (warned && this.enabled && now >= this._lockNext) {
      this._lockNext = now + LOCK_REPEAT;
      // Head-locked: it is not a sound in the world, it is his own gear telling
      // him something. `ui` bus, so a concussion cannot take it away.
      if (audio._playDry('drone_lock', { level: 1 }, 'ui', 0)) this.stats.locks++;
    } else if (!warned) {
      // Re-arm instantly, so the next lock does not wait out a stale timer.
      this._lockNext = 0;
    }
  }

  _startRotor(rec, p, dist, now) {
    const audio = this.audio;
    const f = audio.field;
    // Same rule as the tank: do not START one while the governor has the pool
    // clamped, but one already flying keeps flying.
    if (f.capacity < f.emitters.length * 0.66) return;
    const em = f.acquire({
      x: p.x, y: p.y, z: p.z,
      when: now, dist, bus: 'weapons',
      /**
       * 0.9, just under the tank's 0.92. Both are continuous voices that must
       * not be stolen by the firefight — a rotor that cuts out for two seconds
       * is a drone that arrives silently, which is the exact unfairness this
       * sound exists to remove.
       */
      priority: 0.9,
      send: 0.06,
      /**
       * 0.85. A drone is not a hull: `_startEngine` documents a tank at 25 m
       * rendering seven times the player's own rifle at gain 2.4 and being cut
       * to 0.9 for it. This starts where that ended up, minus a little, because
       * the airframe's own voice trim is already under the tank's and the thing
       * has to be audible at 100 m without being absurd at 10.
       */
      gain: 0.85,
      endTime: now + 3600,
      tracked: true,
      tag: 'drone',
    });
    if (!em) return;
    const rotor = droneRotor(audio.actx, audio.bank, audio.rng, { when: now });
    f.hold(em, rotor.node, now + 3600, 0.06);
    rec.rotor = rotor;
    rec.em = em;
    this.stats.rotors++;
  }

  _stopRotor(rec, now) {
    if (!rec.rotor) return;
    const at = rec.rotor.stop(now);
    this._dying.push({ engine: rec.rotor, em: rec.em, at });
    rec.rotor = null;
    rec.em = null;
  }

  _stopAllRotors(now) {
    for (const rec of this._drones) if (rec?.rotor) this._stopRotor(rec, now);
  }

  /* ================================================================ */
  /* frame                                                            */
  /* ================================================================ */

  update(dt, now) {
    // The armour loop runs even when the layer is disabled, so that turning it
    // off mid-match (the A/B control) shuts the engines down instead of
    // stranding two tracked emitters in the pool for ever. Same for the rotors.
    this._updateTanks(dt, now);
    this._updateDrones(dt, now);
    this._reap(now);
    if (!this.enabled) return;
    this._updateFar(now);
    this._updateSteps(dt, now);
    const f = this.audio.field;
    let far = 0, steps = 0;
    for (const em of f.emitters) {
      if (em.free) continue;
      if (em.kindTag === 'far') far++;
      else if (em.kindTag === 'step') steps++;
    }
    this.stats.farHeld = far;
    this.stats.stepsHeld = steps;
  }

  dispose() {
    for (const rec of this._tanks) {
      if (!rec?.engine) continue;
      rec.engine.free();
      rec.em?.detach();
      rec.engine = null;
      rec.em = null;
    }
    for (const rec of this._drones) {
      if (!rec?.rotor) continue;
      rec.rotor.free();
      rec.em?.detach();
      rec.rotor = null;
      rec.em = null;
    }
    this._drones.length = 0;
    for (const d of this._dying) { d.engine.free(); d.em?.detach(); }
    this._dying.length = 0;
    this._tanks.length = 0;
  }
}
