/**
 * MATCH — DOMINATION: the capture points and the score they print.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS
 * ────────────────────────────────────────────────────────────────────────────
 * "占領サイトを一定時間いるとポイント加算で、サイトを占領するとそこからリスポーン
 * 可能で、奪われたら既定のリスポーン位置からのスポーンのみ"
 *
 * Three zones (see `ZONES` in src/match/sites.js). Standing in one takes it;
 * holding one prints points on a tick; holding one is also what opens a forward
 * spawn on it (that half lives in `MatchSystem._safeSpawn`, because spawning is
 * the match's business and this file only decides who owns what).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE RULES, AND THE ONES DELIBERATELY NOT TAKEN
 * ────────────────────────────────────────────────────────────────────────────
 *   PRESENCE, NOT A KEYPRESS. A body inside the circle counts. There is no hold-F
 *   on a capture point in any game in this genre, and more to the point `working`
 *   in `src/ai` freezes an actor where he stands — a bot that had to "use" a zone
 *   would stop moving and shooting in the middle of the one fight that decides
 *   the zone.
 *
 *   ONE BAR, NOT TWO. Taking a point off the enemy runs the same single bar as
 *   taking a neutral one; the owner does not drop to neutral halfway. Battlefield
 *   splits it, Call of Duty does not, and a single bar with an owner colour is
 *   the version a player can read at a glance from 30 m away while being shot at.
 *
 *   CONTESTED FREEZES. Both sides in the circle and the bar stops dead rather
 *   than racing on a headcount. A frozen amber bar says "kill them or leave" with
 *   no arithmetic; a race says "you are losing by a number you cannot see".
 *
 *   CROWD SCALES THE RATE, capped. `RULES.captureCrowdBonus` /
 *   `RULES.captureMaxRate` — four men take a point in under four seconds, and
 *   fifteen men cannot take one in half a second.
 *
 *   AN EMPTY BAR BLEEDS BACK. `RULES.captureDecay`. A half-finished capture that
 *   persisted for ever would flip a zone minutes later for no visible reason.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ALLOCATION
 * ────────────────────────────────────────────────────────────────────────────
 * `update()` runs every frame with thirty actors and three zones. Everything it
 * touches — the per-zone counts, the score gains, the stats — is preallocated
 * here, and the two callbacks are handed reused objects the listener must copy
 * out of. Nothing in this file allocates after construction.
 */

import { RULES } from './rules.js';

export class CaptureZones {
  /**
   * @param {Array} zones  the resolved zones from `resolveLayout`
   */
  constructor(zones) {
    this.zones = zones;
    /** Points this match. Index is the team id. */
    this.score = [0, 0];
    this._scoreTimer = RULES.scoreInterval;
    /** Reused score-tick payload: points added to each side this tick. */
    this._gains = [0, 0];

    /** Fired the frame a zone changes hands. `(zone, previousOwner, byPlayer)` */
    this.onCapture = null;
    /** Fired on every score tick. `(gains, score)` — both reused arrays. */
    this.onScoreTick = null;

    /* ---- measurement, which is the only way to know the mode works ---- */
    this.stats = {
      /** Flips to each team. */
      captures: [0, 0],
      /** Flips where the local player was inside the circle at the moment. */
      capturesWithPlayer: [0, 0],
      /** Flips with no player involvement — i.e. a BOT capture. */
      capturesByBots: [0, 0],
      /** Total seconds of ownership, summed over completed and current spells. */
      ownedSeconds: [0, 0],
      /** Completed ownership spells, so `ownedSeconds / spells` is the mean. */
      spells: [0, 0],
      /** Score ticks awarded. */
      ticks: 0,
    };

    /** Scratch: how many of each side are in the zone being evaluated. */
    this._n = [0, 0];
  }

  /**
   * ONE zone back to neutral.
   *
   * Split out of `reset` because a zone can now JOIN the list mid-match — D, the
   * cathedral, which is authored `locked` and pushed into `zones` when the
   * building comes down. It has to arrive neutral, with an `ownedSince` on the
   * current clock, or `meanOwnership` counts it as having been held since t=0.
   */
  resetZone(z, elapsed) {
    z.owner = -1;
    z.capTeam = -1;
    z.progress = 0;
    z.contested = false;
    z.counts[0] = 0;
    z.counts[1] = 0;
    z.rate = 0;
    z.ownedSince = elapsed;
  }

  /** Every zone back to neutral. Called when a match starts. */
  reset(elapsed) {
    for (const z of this.zones) this.resetZone(z, elapsed);
    this.score[0] = 0;
    this.score[1] = 0;
    this._scoreTimer = RULES.scoreInterval;
    const s = this.stats;
    for (let t = 0; t < 2; t++) {
      s.captures[t] = 0;
      s.capturesWithPlayer[t] = 0;
      s.capturesByBots[t] = 0;
      s.ownedSeconds[t] = 0;
      s.spells[t] = 0;
    }
    s.ticks = 0;
  }

  /** How many zones `team` currently holds. */
  ownedBy(team) {
    let n = 0;
    for (const z of this.zones) if (z.owner === team) n++;
    return n;
  }

  /**
   * The zone whose circle contains `p`, or null. Same 3 m vertical tolerance the
   * C4's `_siteAt` used, and for the same reason: a man on a 2.9 m catwalk over
   * the courtyard is not standing in the courtyard.
   */
  zoneAt(p) {
    for (const z of this.zones) if (this._inside(z, p)) return z;
    return null;
  }

  /**
   * One frame of capture and score.
   *
   * @param {number} dt
   * @param {number} elapsed          `ctx.time.elapsed`, for ownership spells
   * @param {Array[]} botsByTeam      `[[Agent], [Agent]]` — live bots only is not
   *                                  required; dead ones are skipped here
   * @param {object|null} player      the local player, or null when dead
   * @param {number} playerTeam
   */
  update(dt, elapsed, botsByTeam, player, playerTeam) {
    for (const z of this.zones) this._updateZone(dt, elapsed, z, botsByTeam, player, playerTeam);

    // ---- the tick ------------------------------------------------------
    this._scoreTimer -= dt;
    if (this._scoreTimer > 0) return;
    this._scoreTimer += RULES.scoreInterval;
    /**
     * A SIDE HOLDING FEWER THAN `scoreMinZones` IS PAID NOTHING — 「ポイントの
     * 加算をもう少しシビアにして」. Sitting on your own home point, the one beside
     * your own spawn that you did not have to fight for, is not worth anything;
     * you are paid from the SECOND point on. @see the long note on
     * `RULES.scoreMinZones`, which has the income table and why this lever
     * rather than `scorePerZone` or `scoreInterval`.
     *
     * `?? 1` so a `rules.js` without the key behaves exactly as before.
     */
    const minZones = RULES.scoreMinZones ?? 1;
    const g = this._gains;
    const held0 = this.ownedBy(0);
    const held1 = this.ownedBy(1);
    g[0] = held0 >= minZones ? held0 * RULES.scorePerZone : 0;
    g[1] = held1 >= minZones ? held1 * RULES.scorePerZone : 0;
    this.score[0] += g[0];
    this.score[1] += g[1];
    this.stats.ticks++;
    if (g[0] || g[1]) this.onScoreTick?.(g, this.score);
  }

  _updateZone(dt, elapsed, z, botsByTeam, player, playerTeam) {
    const n = this._n;
    n[0] = 0;
    n[1] = 0;
    let playerIn = false;
    for (let t = 0; t < 2; t++) {
      const list = botsByTeam[t];
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a.alive) continue;
        if (!this._inside(z, a.position)) continue;
        n[t]++;
      }
    }
    if (player && !player.dead && this._inside(z, player.position)) {
      n[playerTeam]++;
      playerIn = true;
    }
    z.counts[0] = n[0];
    z.counts[1] = n[1];
    /**
     * HOW FAST THE BAR IS MOVING, in bar-units per second, signed: positive is
     * filling toward `capTeam`, negative is bleeding back toward empty, zero is
     * a deadlock. Written every frame by every branch below.
     *
     * It exists for the HUD and for nothing else. "占領してる感" is mostly a
     * question a player asks in seconds — HOW LONG until this is mine, and am I
     * gaining or losing right now — and a bar alone cannot answer either: 8 % of
     * a 15 s capture with four men behind it and 8 % of one man being pushed off
     * look identical for the frame you glance at them. `src/ui/capture.js` turns
     * this into the countdown and the GAINING / LOSING / DEADLOCK read. The rate
     * is the one the zone was ACTUALLY advanced at this frame, not a re-derived
     * guess, so the two can never disagree.
     */
    z.rate = 0;

    /**
     * ---- contested: both sides in the circle -------------------------
     *
     * THE SIDE THAT OUTNUMBERS THE OTHER STILL MAKES GROUND, at the rate for the
     * DIFFERENCE. Equal numbers freeze.
     *
     * This was a hard freeze — both sides present, nothing moves — and it is the
     * single rule that stopped the mode working. MEASURED over two full headless
     * matches: with a hard freeze, a garrison of two men held a point against a
     * side that had committed thirteen, for a hundred and ten seconds and then
     * for a hundred and sixty-seven, because thirty men strung out over a sixty
     * metre approach only ever put two or three inside the circle at once and two
     * versus three is a freeze. Neither losing side ever retook anything and both
     * matches ended 250-82 / 252-42 with the score decided in the first forty
     * seconds. From the outside that is not a capture point, it is a wall.
     *
     * The difference rule fixes it without making a point cheap. One man sneaking
     * onto a defended zone achieves exactly nothing — 3 against 3 is still frozen
     * — but a side that masses more men than the garrison takes the ground, which
     * is the tactic `_assignDomination`'s `focus` exists to produce and the thing
     * a human team does. Six against five is one man's worth of rate: nine
     * seconds of standing there under fire.
     *
     * `contested` stays true whenever both sides are present, so the HUD's amber
     * bar still means "this is a fight" — it now crawls instead of stopping.
     */
    if (n[0] > 0 && n[1] > 0) {
      z.contested = true;
      const major = n[0] > n[1] ? 0 : n[1] > n[0] ? 1 : -1;
      if (major < 0) return;
      const edge = n[major] - n[1 - major];
      if (z.owner === major) {
        // The holder is winning the fight on his own point: push the enemy's
        // leftover bar back down.
        if (z.capTeam < 0) return;
        z.rate = -this._rate(edge);
        z.progress -= this._rate(edge) * dt;
        if (z.progress <= 0) {
          z.progress = 0;
          z.capTeam = -1;
        }
        return;
      }
      this._advanceToward(dt, z, major, edge, elapsed, playerIn, playerTeam);
      return;
    }
    z.contested = false;

    // ---- empty: the bar bleeds back ------------------------------------
    if (n[0] === 0 && n[1] === 0) {
      if (z.capTeam < 0) return;
      z.rate = -RULES.captureDecay;
      z.progress -= RULES.captureDecay * dt;
      if (z.progress <= 0) {
        z.progress = 0;
        z.capTeam = -1;
      }
      return;
    }

    // ---- one side present ----------------------------------------------
    const team = n[0] > 0 ? 0 : 1;
    const count = n[team];
    if (z.owner === team) {
      // He already owns it. Any progress on the bar is the ENEMY's leftover, and
      // standing on your own point is what pushes it back down.
      if (z.capTeam < 0) return;
      z.rate = -RULES.captureDecay * 4;
      z.progress -= RULES.captureDecay * 4 * dt;
      if (z.progress <= 0) {
        z.progress = 0;
        z.capTeam = -1;
      }
      return;
    }

    // Somebody else's, or nobody's, and he is standing in it.
    this._advanceToward(dt, z, team, count, elapsed, playerIn, playerTeam);
  }

  /**
   * Move `zone`'s bar toward `team` at the rate for `count` men, and flip it if
   * the bar fills. Shared by the uncontested path and the outnumbered-contest
   * path so a zone that changes hands twice in one fight reads as one continuous
   * bar rather than two.
   *
   * @param {number} count  effective men: the headcount when uncontested, the
   *                        numeric ADVANTAGE when contested
   */
  _advanceToward(dt, z, team, count, elapsed, playerIn, playerTeam) {
    if (z.capTeam !== team) {
      // The other side had a bar going: burn it down first rather than snapping
      // to zero.
      if (z.capTeam >= 0 && z.progress > 0) {
        z.rate = -this._rate(count);
        z.progress -= this._rate(count) * dt;
        if (z.progress > 0) return;
      }
      z.capTeam = team;
      z.progress = 0;
    }
    z.rate = this._rate(count);
    z.progress += this._rate(count) * dt;
    if (z.progress < 1) return;

    // ---- it changes hands ----------------------------------------------
    const previous = z.owner;
    // AVERAGE OWNERSHIP DURATION comes from here: one completed spell per flip,
    // measured off the clock rather than sampled. `ownedSeconds / spells` is the
    // mean, and `meanOwnership()` folds in the spells still running at the end.
    if (previous >= 0) {
      this.stats.spells[previous]++;
      this.stats.ownedSeconds[previous] += Math.max(0, elapsed - z.ownedSince);
    }
    z.owner = team;
    z.capTeam = -1;
    z.progress = 0;
    z.ownedSince = elapsed;
    this.stats.captures[team]++;
    if (playerIn && team === playerTeam) this.stats.capturesWithPlayer[team]++;
    else this.stats.capturesByBots[team]++;
    this.onCapture?.(z, previous, playerIn && team === playerTeam);
  }

  /**
   * Fold the spells that are still running into the stats and hand back the
   * mean ownership duration per side, in seconds. Report-time only.
   */
  meanOwnership(elapsed) {
    const s = this.stats;
    const out = this._mean ?? (this._mean = [0, 0]);
    for (let t = 0; t < 2; t++) {
      let secs = s.ownedSeconds[t];
      let spells = s.spells[t];
      for (const z of this.zones) {
        if (z.owner !== t) continue;
        secs += Math.max(0, elapsed - z.ownedSince);
        spells++;
      }
      out[t] = spells ? +(secs / spells).toFixed(1) : 0;
    }
    return out;
  }

  /** Capture rate per second at `count` men in the circle. */
  _rate(count) {
    const mult = Math.min(RULES.captureMaxRate, 1 + RULES.captureCrowdBonus * (count - 1));
    return mult / RULES.captureTime;
  }

  _inside(z, p) {
    const dx = p.x - z.position.x;
    const dz = p.z - z.position.z;
    return dx * dx + dz * dz <= z.radius * z.radius && Math.abs(p.y - z.position.y) < 3;
  }
}
