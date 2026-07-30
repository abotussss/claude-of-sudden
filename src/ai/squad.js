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

export class Squad {
  constructor(rng) {
    this.id = _nextSquad++;
    this.members = [];
    this.rng = rng;
    this.peekTokens = 1;
    this.peekHolders = new Set();
    this.peekTimer = 0;
    this.grenadeCooldown = 6;
    /** Kept for anything that reads it; `flankers` is what the gate uses now. */
    this.flanker = null;
    /** ids currently out wide. Size is capped by `flankTokens`. */
    this.flankers = new Set();
    this.flankTokens = 1;
    this.contact = new THREE.Vector3();
    this.hasContact = false;
    this.contactAge = Infinity;
    this._pending = [];
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
    if (this.flanker && !this.flanker.alive) this.flanker = null;
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

  /** Called once per frame by the AI system. */
  update(dt) {
    this.grenadeCooldown -= dt;
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

  requestGrenade() {
    if (this.grenadeCooldown > 0) return false;
    this.grenadeCooldown = 14 + this.rng.float() * 12;
    return true;
  }
}
