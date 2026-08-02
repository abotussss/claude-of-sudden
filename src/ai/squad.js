/**
 * AI — squad coordination.
 *
 * The squad exists to stop four individually-sensible soldiers from behaving
 * like one four-headed idiot: it hands out permission to peek so they alternate
 * instead of all leaning out together, shares contact reports so one man
 * spotting you alerts the rest (after a believable call-out delay), rations
 * grenades, and allows only one flanker at a time.
 */

import * as THREE from 'three';

let _nextSquad = 1;
let _nextTeam = 1;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * FIRETEAMS. "こういうAI全員が行動経路が一緒で同じ動きだとゲーム性が悪いので
 *  ちゃんと４人１チームの感じで動くところを考えて BFのシステムみたいに"
 * ────────────────────────────────────────────────────────────────────────────
 * A `Squad` on this map is A WHOLE SIDE — twenty men, one object, one set of
 * tokens (`match` calls `ai.createSquad()` once per team and adds every bot it
 * spawns to it). Everything it does is therefore side-wide, and NOTHING in the
 * engine ever divided the roster below that. MEASURED on a live 20 v 20 before
 * this existed: the worst sample had 13 of 18 men inside one 8 m circle, mean
 * nearest-neighbour 10.8 m, and the whole side walking 8.6 distinct routes —
 * which is the screenshot, ten men shoulder to shoulder facing the same way.
 *
 * A fireteam is FOUR MEN WITH THE SAME JOB AND A DIFFERENT WAY IN, and both
 * halves of that matter:
 *
 *   THE SAME JOB. The teams are cut per OBJECTIVE, not per roster slot, and
 *     that is deliberate: `match` owns who goes where and re-cuts its plan
 *     every two seconds (@see `_assignDomination`), so a fixed four-man roster
 *     would be four men with four different orders pretending to be a unit.
 *     Cutting on the order `match` actually gave means a fireteam is always a
 *     real thing — the four men going to the same place.
 *
 *   A DIFFERENT WAY IN. Each fireteam of the same objective gets a LANE — a
 *     signed lateral offset from the straight line between it and the point —
 *     and the lanes are handed out in order, alternating sides and widening.
 *     Thirteen men on one capture point stop being one file up one street and
 *     become three or four groups of four coming in off different bearings.
 *     `Agent._laneVia` is where a lane becomes a route.
 *
 * `seat` is the man's index inside his own fireteam, 0-3, and it is what makes
 * four men cover four arcs instead of stacking on one sandbag.
 * @see `Agent._pickHoldSpot`.
 */
const FIRETEAM_SIZE = 4;
/**
 * The lane ladder, in order of issue: the first fireteam to a point comes
 * straight up the middle, the next two swing either side of it, and so on.
 * A LANE TAKEN PUSHES THE NEXT TEAM WIDER, which is the whole mechanism.
 */
const LANES = [0, -1, 1, -2, 2, -3, 3];
/** Metres of lateral offset per rung. */
const LANE_STEP = 15;
/** How often the roster is re-cut. `match` re-plans at 2 s; this is under it. */
const REGROUP_EVERY = 1.0;

function byId(a, b) {
  return a.id - b.id;
}

export class Squad {
  constructor(rng) {
    this.id = _nextSquad++;
    this.members = [];
    this.rng = rng;
    this.peekTokens = 1;
    this.peekHolders = new Set();
    this.peekTimer = 0;
    this.grenadeCooldown = 6;
    /**
     * ────────────────────────────────────────────────────────────────────────
     * THE OTHER TWO THINGS IN THE POUCH, ON THEIR OWN CLOCKS
     * ────────────────────────────────────────────────────────────────────────
     * `grenadeCooldown` is the frag ration and it must stay the frag ration: a
     * flash and a frag are not competing for the same window, and putting them
     * on one clock would mean a man who bangs a doorway has taken his squad's
     * grenade away from the man who wanted to kill somebody with it.
     *
     * They are separate from each other for the same reason and paced
     * differently, because the mistakes are different. Four men flashing one
     * door in four seconds is a wasted stock and a blinded assault; four men
     * smoking one lane is a map nobody can see across, and it lasts fourteen
     * seconds a can rather than one instant. So the screen's clock is roughly
     * twice the flash's and both are well over the duration of what they put on
     * the ground. @see `Agent._maybeFlash` / `Agent._maybeSmoke` for the
     * question each of them is the answer to.
     */
    this.flashCooldown = 8;
    this.screenCooldown = 8;
    /** Kept for anything that reads it; `flankers` is what the gate uses now. */
    this.flanker = null;
    /** ids currently out wide. Size is capped by `flankTokens`. */
    this.flankers = new Set();
    this.flankTokens = 1;
    /**
     * ────────────────────────────────────────────────────────────────────────
     * THE UPPER FLOORS — "全員がそういう行動取るんじゃなくて２人や３人くらい"
     * ────────────────────────────────────────────────────────────────────────
     * The request has a number in it and the number is the point: shooting down
     * from a window is strong, so a side that ALL went upstairs would be a side
     * that stopped taking capture points. Two tokens per side, hard, and they go
     * to the men whose job is already an angle rather than a manoeuvre — the
     * sniper first, then the marksman and the anchor. @see `Agent._runPost` and
     * `StairMap` for the routes themselves.
     */
    this.posters = new Set();
    this.postTokens = 2;
    this.contact = new THREE.Vector3();
    this.hasContact = false;
    this.contactAge = Infinity;
    this._pending = [];
    /** The four-man teams this side is currently cut into. @see `regroup`. */
    this.fireteams = [];
    this._ftTimer = 0;
    this._ftPool = [];
    this._buckets = new Map();
    this._rowPool = [];
  }

  add(agent) {
    agent.squad = this;
    this.members.push(agent);
    this._retoken();
    return agent;
  }

  /**
   * Drop the dead. `match` calls this whenever it respawns somebody: with
   * respawns on, a five minute round adds a member per death for ever, and
   * every one of them is walked by `update()`, by `canFlank()` and by the
   * squad-spacing term in `CoverMap.pick` — an O(members) cost that would grow
   * without bound while the number of men actually fighting stayed at fifteen.
   */
  prune() {
    let w = 0;
    for (let i = 0; i < this.members.length; i++) {
      if (this.members[i].alive) this.members[w++] = this.members[i];
    }
    if (w === this.members.length) return;
    this.members.length = w;
    this._retoken();
    // A casualty changes the shape of the side, so re-cut on the next tick
    // rather than leaving a fireteam holding a seat nobody is in.
    this._ftTimer = 0;
    if (this.flanker && !this.flanker.alive) this.flanker = null;
    // A post token held by a dead man is a window nobody is standing at.
    // `Agent.die` releases it too; this is the belt to that pair of braces.
    if (this.posters.size) {
      for (const id of this.posters) {
        let found = false;
        for (const m of this.members) if (m.id === id && m.alive) { found = true; break; }
        if (!found) this.posters.delete(id);
      }
    }
    for (const id of this.flankers) {
      let found = false;
      for (const m of this.members) if (m.id === id) { found = true; break; }
      if (!found) this.flankers.delete(id);
    }
  }

  /**
   * How many men may be leaning out at once, and how many may be moving wide.
   *
   * Half the squad peeks — unchanged. FLANKERS used to be exactly one, which is
   * right for a four-man fireteam and wrong for fifteen: with one token the
   * other fourteen have no manoeuvre available at all and the fight roots. One
   * per five men, minimum one, so a fifteen-man side always has three men trying
   * to get round the side of something.
   */
  _retoken() {
    /**
     * PEEK TOKENS 0.5 -> 0.62 of the roster.
     *
     * Half the squad was tuned for a four-man fireteam, where "half of us are
     * leaning out" is a lot of men. At fifteen it is a queue: measured on a full
     * match, COMBAT held 50 % of all actor-time and only 22 % of it was anybody
     * peeking, so most of the line was sitting behind cover waiting for a token
     * while the round burned. Nine of fifteen still reads as men taking turns and
     * it is a third more rifles in the fight. (The other half of that fix is in
     * `agent.js`: a man with `exposure > 0.7` does not wait for a token at all.)
     */
    this.peekTokens = Math.max(1, Math.round(this.members.length * 0.62));
    this.flankTokens = Math.max(1, Math.round(this.members.length / 5));
  }

  get alive() {
    let n = 0;
    for (const m of this.members) if (m.alive) n++;
    return n;
  }

  /**
   * Cut the side into four-man fireteams, one cut per objective. @see the
   * header note over `FIRETEAM_SIZE` for why this is not a fixed roster.
   *
   * Allocates nothing after the first second: the bucket rows and the fireteam
   * records are both pooled, and it runs at 1 Hz rather than per frame.
   */
  regroup(dt) {
    this._ftTimer -= dt;
    if (this._ftTimer > 0) return;
    this._ftTimer = REGROUP_EVERY;

    const buckets = this._buckets;
    for (const row of buckets.values()) this._rowPool.push(row);
    buckets.clear();
    for (const m of this.members) {
      if (!m.alive) continue;
      const o = m.objective;
      /**
       * WHAT COUNTS AS "THE SAME JOB". The site if the order carries one — that
       * is the capture point or the bomb site and it is the honest answer — and
       * otherwise the destination rounded to a 10 m square, which keeps the men
       * sent to one end of a street together without merging two streets. A man
       * with no order at all falls in the same bucket as the other spare men,
       * which is right: they are the ones about to be given the same thing.
       */
      const key = o ? (o.site ?? (Math.round(o.position.x / 10) * 8192 + Math.round(o.position.z / 10))) : 0;
      let row = buckets.get(key);
      if (!row) {
        row = this._rowPool.pop() ?? [];
        row.length = 0;
        buckets.set(key, row);
      }
      row.push(m);
    }

    for (const ft of this.fireteams) this._ftPool.push(ft);
    this.fireteams.length = 0;
    for (const row of buckets.values()) {
      // Stable membership: a man keeps his seat between refreshes as long as
      // the men either side of him are alive and on the same job.
      row.sort(byId);
      let lane = 0;
      for (let i = 0; i < row.length; i += FIRETEAM_SIZE) {
        let ft = this._ftPool.pop();
        if (!ft) ft = { id: 0, members: [], lane: 0, laneIndex: 0, centre: new THREE.Vector3() };
        ft.id = _nextTeam++;
        ft.members.length = 0;
        ft.laneIndex = lane;
        ft.lane = LANES[lane < LANES.length ? lane : LANES.length - 1] * LANE_STEP;
        ft.centre.set(0, 0, 0);
        for (let k = i; k < i + FIRETEAM_SIZE && k < row.length; k++) {
          const m = row[k];
          m.fireteam = ft;
          m.ftSeat = k - i;
          ft.members.push(m);
          ft.centre.add(m.position);
        }
        if (ft.members.length) ft.centre.multiplyScalar(1 / ft.members.length);
        this.fireteams.push(ft);
        lane++;
      }
    }
  }

  /** Called once per frame by the AI system. */
  update(dt) {
    this.regroup(dt);
    this.grenadeCooldown -= dt;
    this.flashCooldown -= dt;
    this.screenCooldown -= dt;
    this.contactAge += dt;
    if (this.flanker && (!this.flanker.alive || this.flanker.state !== 'flank')) this.flanker = null;
    // Hand a flank token back the moment the man stops using it, or the squad
    // spends the round holding tokens for people who are dead or in cover.
    if (this.flankers.size) {
      for (const m of this.members) {
        if (!this.flankers.has(m.id)) continue;
        if (!m.alive || m.state !== 'flank') this.flankers.delete(m.id);
      }
    }

    // contact sharing: whoever can see the player broadcasts, with a delay
    for (const m of this.members) {
      if (!m.alive) continue;
      if (m.hasTarget && m.targetVisible) {
        this.contact.copy(m.lastKnown);
        this.hasContact = true;
        this.contactAge = 0;
        break;
      }
    }
    if (this.hasContact && this.contactAge < 4) {
      for (const m of this.members) {
        if (!m.alive || m.hasTarget) continue;
        // a call-out only gives a direction to check, never a free kill
        if (m.lastKnownAge > 1.5) {
          m.lastKnown.copy(this.contact);
          m.lastKnownAge = 0.9 + this.rng.float() * 0.8;
          m.alertness = 1;
          if (m.state === 'idle' || m.state === 'patrol') m._setState('alert');
        }
      }
    }

    // rotate the peek tokens so the same man is not always exposed
    this.peekTimer -= dt;
    if (this.peekTimer <= 0) {
      this.peekTimer = 1.1 + this.rng.float() * 1.2;
      this.peekHolders.clear();
    }
  }

  /** Ask to lean out of cover. Only `peekTokens` members may at once. */
  requestPeek(agent, dt) {
    if (this.peekHolders.has(agent.id)) return true;
    if (this.peekHolders.size >= this.peekTokens) return false;
    this.peekHolders.add(agent.id);
    return true;
  }

  releasePeek(agent) {
    this.peekHolders.delete(agent.id);
  }

  /**
   * May this man go wide? Only while somebody else is holding the enemy's
   * attention, and only up to `flankTokens` of them at once.
   */
  canFlank(agent) {
    if (this.flankers.has(agent.id)) return true;
    /**
     * THE TOKENS GO TO THE MEN WHO WANT THEM. Three tokens on a fifteen-man side
     * used to be first come first served, so an anchor whose whole job is holding
     * an angle could take one and sit on it while the flanker who would have used
     * it was refused. `traits.flank` below 0.2 is the marksman and the anchor —
     * they are not the manoeuvre element and they no longer hold its tokens.
     */
    if (agent.traits && agent.traits.flank < 0.2) return false;
    if (this.flankers.size >= this.flankTokens) return false;
    let shooting = 0;
    for (const m of this.members) {
      if (m !== agent && m.alive && (m.state === 'combat' || m.state === 'suppressed')) shooting++;
    }
    return shooting >= 1;
  }

  claimFlank(agent) {
    this.flanker = agent;
    this.flankers.add(agent.id);
  }

  /**
   * May this man go and hold an upper floor? @see `postTokens`.
   *
   * The trait test is the same one `canFlank` uses, READ THE OTHER WAY ROUND:
   * `flank` under 0.4 is the sniper, the marksman and the anchor — the men who
   * are already trying to hold one angle for a long time, and therefore the men
   * for whom a window is an upgrade rather than a cage. A rusher upstairs is a
   * rusher taken out of the game.
   */
  canPost(agent) {
    if (this.posters.has(agent.id)) return true;
    if (this.posters.size >= this.postTokens) return false;
    if (agent.traits && agent.traits.flank >= 0.4) return false;
    // A side that is losing men faster than it can hold ground has no business
    // putting two of them in an attic.
    return this.members.length >= 6;
  }

  claimPost(agent) {
    this.posters.add(agent.id);
  }

  releasePost(agent) {
    this.posters.delete(agent.id);
  }

  requestGrenade() {
    if (this.grenadeCooldown > 0) return false;
    this.grenadeCooldown = 14 + this.rng.float() * 12;
    return true;
  }

  /**
   * THE BANG. @see `flashCooldown` and `Agent._maybeFlash`.
   *
   * Paced tighter than the frag because a flash is an ENABLER — it is thrown to
   * make the next four seconds work, so refusing it costs the assault rather
   * than saving a grenade — and looser than the screen because it lasts an
   * instant instead of a quarter of a minute.
   */
  requestFlash() {
    if (this.flashCooldown > 0) return false;
    this.flashCooldown = 11 + this.rng.float() * 9;
    return true;
  }

  /**
   * THE CAN. @see `screenCooldown`.
   *
   * The longest of the three clocks, and it is the duration of the thing that
   * makes it so: a can screens for fourteen seconds, so four men smoking one
   * lane inside half a minute is a map nobody on either side can see across —
   * including the side that threw them. `_smokeBlocks` is symmetric on purpose.
   */
  requestScreen() {
    if (this.screenCooldown > 0) return false;
    this.screenCooldown = 22 + this.rng.float() * 14;
    return true;
  }
}
