/**
 * ════════════════════════════════════════════════════════════════════════════
 * AI — THE RADIO NET
 * ════════════════════════════════════════════════════════════════════════════
 * "あとはAI同士の無線連絡をちゃんとリアルにしてみて RogerとかEnemy Spottedとか"
 *
 * Before this file the only chatter on the map came from `src/audio/index.js`'s
 * `_onFire`, which fires a 'spot' or a 'suppress' at most once every 4.5 s with
 * 45 % probability from whatever muzzle happened to be inside 60 m, and says so
 * in its own comment: "even before `ai` grows its own bark logic". That is a
 * sound effect attached to gunfire. It is not a squad talking, for three
 * reasons, and each one is a rule here:
 *
 *  1. NOBODY ANSWERS. A net is turn-taking. One man transmits and somebody
 *     else acknowledges — that is the single thing that makes a stream of
 *     shouting read as two people rather than as a noise generator. So a
 *     message may be marked `answer` and, when it is, `_scheduleAnswer` picks
 *     a live man of the same side and puts "ROGER" / "SET" on the net half a
 *     second later. The answered fraction is a reported number.
 *
 *  2. IT CARRIES NOTHING. "CONTACT" is an exclamation; "CONTACT, NORTH-EAST" is
 *     a report. `_contactVoice` computes the bearing from the speaker to what he
 *     saw, ON THE LEVEL'S OWN AXES (`world.levelYaw`) so the direction means the
 *     same thing to the player as it does to the bot, and prefers a landmark
 *     over a bearing when there is one — a man seen inside a building is
 *     "CONTACT INSIDE", a man two storeys up is "CONTACT ROOFTOP".
 *
 *  3. THE RATE IS GLOBAL. One limiter for the whole map means fifteen men on
 *     one side and fifteen on the other are one queue, so the side that is not
 *     in contact silences the side that is, and one loud man silences his own
 *     squad. There are FOUR limiters here and they are deliberately different
 *     axes:
 *
 *       per NET     one transmission at a time per side, `_netGap` seconds
 *                   apart — and the gap BREATHES: 1.9 s while that side is in
 *                   contact, 6.0 s while it is not. This is what makes the
 *                   traffic thin out when nothing is happening, and it is a
 *                   property of the SIDE, so a quiet defence does not have to
 *                   share a budget with a firefight on the other half of the map
 *       per SPEAKER `SPEAKER_GAP` seconds between one man's own transmissions,
 *                   so a single agent in a long firefight cannot become the
 *                   whole net. Answers get a shorter gate: being asked a
 *                   question is not the same as talking
 *       per KIND    per net — "RELOADING" from four different men in six
 *                   seconds is four men saying nothing
 *       GLOBAL      `GLOBAL_GAP`, because two nets are still one pair of ears.
 *                   A transmission from each side 0.1 s apart is mush whatever
 *                   the per-net budgets say, so the map gets one voice at a
 *                   time. It is a stricter version of the 0.42 s guard inside
 *                   `audio.bark()`, which `_transmit` therefore bypasses — see
 *                   the note there for the measurement that made that
 *                   necessary.
 *
 * WHO IS FRIENDLY IS A MIX DECISION, NOT A LABEL. The player's own side comes
 * over the RADIO — `bark(kind, null, { radio: true })`, i.e. head-locked, band
 * limited to 420–3200 Hz, saturated, with a squelch click at each end (see
 * `radio` in `src/audio/vox.js`). The enemy is a man shouting in the street:
 * spatialised at his own position, full band, subject to distance, occlusion
 * and the speed of sound. You never have to be told which is which and there is
 * no HUD element in it. `ai.playerTeam` is what decides, so this follows the
 * side swap at half time for free.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IT MAY NOT DO
 * ────────────────────────────────────────────────────────────────────────────
 * NOTHING IS ALLOCATED PER FRAME. Every net owns a fixed ring of `SLOTS`
 * message records built in the constructor, each with its own `Vector3`; the
 * queue is a priority scan over that ring, never a sort and never a filter.
 * The per-kind clocks are one plain object per net, keyed by strings that exist
 * at module load. `_log` is a preallocated ring of `LOG` entries whose fields
 * are overwritten in place, and it is there for `src/ai/radiocheck.mjs` — it is
 * never read by gameplay.
 *
 * IT REACHES INTO NOTHING. `audio` is fetched by `ctx.peek('audio')` at first
 * use, and the only method called on it is `bark(kind, position, opts)`, which
 * is the public entry point its own header documents for exactly this. `world`
 * is read once at reset for `levelYaw` and `interiorVolumes`, both of which are
 * on the published hook list.
 */

import * as THREE from 'three';

/** Messages a single net may have waiting. The lowest priority is overwritten. */
const SLOTS = 10;
/** Entries in the debug ring `src/ai/radiocheck.mjs` reads. */
const LOG = 256;

/** Seconds between ANY two transmissions on the map. @see the header, rule 3. */
const GLOBAL_GAP = 0.55;
/** Per-net gap while that side is in contact, and while it is not. */
const NET_GAP_HOT = 1.9;
const NET_GAP_QUIET = 6.0;
/** …except an answer, which is a beat and not a slot. @see `update`. */
const ACK_NET_GAP = 0.7;
/** Seconds between one man's own transmissions, and the same for an answer. */
const SPEAKER_GAP = 5.0;
const SPEAKER_GAP_ACK = 2.2;
/** Above this share of a side in combat, the net is "in a firefight". */
const HOT_HEAT = 0.18;

/**
 * PER-NET, PER-KIND COOLDOWN. The number is "how long is this still news".
 * A contact report from a second man six seconds later is a second contact; the
 * same report one second later is the same contact.
 */
const KIND_GAP = {
  contact: 5.5,
  grenade: 3.0,
  fragout: 7.0,
  mandown: 4.5,
  enemydown: 6.0,
  pinned: 8.0,
  coverme: 9.0,
  reload: 8.0,
  flank: 11.0,
  suppress: 9.0,
  movingup: 10.0,
  pushing: 12.0,
  holding: 22.0,
  inposition: 14.0,
  ammolow: 13.0,
  ammodry: 9.0,
  ammoup: 11.0,
  zone: 1.0,
  ack: 0.0,
};

/**
 * HOW IMPORTANT, 0..1. Drives which queued message goes out first and how long
 * it is worth keeping — not the audio priority, which `audio.bark` sets from the
 * voice bus. A stale contact is worse than silence, so `ttl` is short for the
 * things that describe a moment and long for the things that describe a state.
 */
const PRIORITY = {
  grenade: 0.96, mandown: 0.90, zone: 0.88, pinned: 0.86, contact: 0.80,
  ack: 0.76, coverme: 0.74, fragout: 0.70, ammodry: 0.66, flank: 0.58,
  reload: 0.52, ammolow: 0.50, suppress: 0.48, enemydown: 0.46,
  movingup: 0.40, pushing: 0.38, inposition: 0.34, ammoup: 0.32, holding: 0.26,
};
const TTL = {
  contact: 2.2, grenade: 1.6, mandown: 3.0, ack: 2.6, zone: 5.0,
  pinned: 3.0, coverme: 3.0, fragout: 1.8, reload: 2.4, flank: 3.0,
  suppress: 2.4, enemydown: 3.0, movingup: 4.0, pushing: 4.0,
  inposition: 4.0, holding: 6.0, ammolow: 4.0, ammodry: 4.0, ammoup: 4.0,
};

/** Which of the composed voices answers which call. @see src/audio/vox.js */
const ACK_VOICES = ['roger', 'copy', 'setpos'];

/** Zone id -> the phonetic word the composed voices are named after. */
const ZONE_WORD = { A: 'alpha', B: 'bravo', C: 'charlie' };

/** Eight-point compass, level-space, +Z is north. Index = round(a / 45°) & 7. */
const BEARING = [
  'north', 'northeast', 'east', 'southeast',
  'south', 'southwest', 'west', 'northwest',
];

let _nextMsg = 1;

class Net {
  constructor(team) {
    this.team = team;
    this.lastTx = -1e9;
    /** 0..1, smoothed share of this side that is fighting. */
    this.heat = 0;
    /** Per-kind clock. Built once; keys never grow past `KIND_GAP`. */
    this.kindAt = {};
    for (const k of Object.keys(KIND_GAP)) this.kindAt[k] = -1e9;
    this.slots = [];
    for (let i = 0; i < SLOTS; i++) {
      this.slots.push({
        used: false, id: 0, kind: '', voice: '', priority: 0, at: 0, notBefore: 0,
        expires: 0, speaker: null, wantsAnswer: false, answerTo: 0,
        position: new THREE.Vector3(),
      });
    }
    /** Reported. @see `Radio.stats`. */
    this.sent = 0;
    this.refused = 0;
    this.dropped = 0;
    this.wantedAnswer = 0;
    this.answered = 0;
    this.kinds = {};
    /** Longest gap between two transmissions while `heat >= HOT_HEAT`. */
    this.maxHotSilence = 0;
    this.hotTime = 0;
  }
}

export class Radio {
  constructor(ai) {
    this.ai = ai;
    this.ctx = ai.ctx;
    this.rng = ai.rng.fork();
    this.enabled = true;
    this.nets = [new Net(0), new Net(1)];
    this.lastTxAny = -1e9;
    this._audio = undefined;
    this._levelYaw = 0;
    this._interiors = null;
    this._v = new THREE.Vector3();
    /** Ring of transmissions for `src/ai/radiocheck.mjs`. Overwritten in place. */
    this._log = [];
    for (let i = 0; i < LOG; i++) {
      this._log.push({ t: 0, team: -1, kind: '', voice: '', speaker: '', answerTo: 0, radio: false, played: false });
    }
    this._logAt = 0;
    this._logCount = 0;
  }

  /** Level-space geometry the contact reports need. Cheap; call on nav rebuild. */
  bind() {
    const world = this.ctx.peek('world');
    this._levelYaw = world?.levelYaw ?? 0;
    this._interiors = world?.interiorVolumes ?? null;
  }

  /** Wipe the queues and the counters. Called with the roster. */
  reset() {
    for (const n of this.nets) {
      for (const s of n.slots) { s.used = false; s.speaker = null; }
      n.lastTx = -1e9;
      n.heat = 0;
      n.sent = n.refused = n.dropped = n.wantedAnswer = n.answered = 0;
      n.maxHotSilence = 0;
      n.hotTime = 0;
      for (const k of Object.keys(n.kindAt)) n.kindAt[k] = -1e9;
      for (const k of Object.keys(n.kinds)) delete n.kinds[k];
    }
    this.lastTxAny = -1e9;
    this._logAt = 0;
    this._logCount = 0;
  }

  /* ================================================================== */
  /* what a man can put on the net                                      */
  /* ================================================================== */

  /**
   * A contact report from `agent` about `point`.
   *
   * The voice is chosen from what this man can actually see: a landmark if the
   * contact is somewhere nameable, otherwise the bearing. Nothing is looked up
   * that he does not have — this is his own position and the position he is
   * shooting at, which is `lastKnown`.
   */
  contact(agent, point) {
    this.say(agent, 'contact', this._contactVoice(agent, point), point, true);
  }

  /**
   * Objective traffic. `owner` just took `zone` off `previous`.
   *
   * TWO transmissions, one per side, and they are not the same message: the
   * side that took it says "ALPHA SECURED" and the side that lost it says "WE
   * LOST ALPHA". `match` emits `match:capture`; `ai` listens, exactly as it
   * already listens for `explosion`.
   */
  zone(id, owner, previous) {
    const word = ZONE_WORD[id];
    if (!word) return;
    if (owner >= 0) this.announce(owner, 'zone', `secured_${word}`, true);
    if (previous >= 0 && previous !== owner) this.announce(previous, 'zone', `lost_${word}`, false);
  }

  /**
   * Put `voice` on `team`'s net with no particular speaker — the nearest live
   * man to the middle of that side says it. Used by the objective traffic,
   * which belongs to the side rather than to a soldier.
   */
  announce(team, kind, voice, wantsAnswer) {
    const speaker = this._anyLive(team, null);
    if (!speaker) return;
    this.say(speaker, kind, voice, null, wantsAnswer);
  }

  /**
   * The general entry point. Returns true if it was QUEUED, which is not the
   * same as transmitted — the net decides that.
   *
   * @param {Agent}   agent    who is talking
   * @param {string}  kind     the rate-limiting class, @see KIND_GAP
   * @param {string}  voice    the composed bark name, @see src/audio/vox.js
   * @param {Vector3} point    what he is talking about, or null for himself
   * @param {boolean} wantsAnswer
   */
  say(agent, kind, voice, point = null, wantsAnswer = false, answerTo = 0) {
    if (!this.enabled || !agent || !agent.alive) return false;
    const team = agent.team === 1 ? 1 : 0;
    const net = this.nets[team];
    const now = this.ctx.time.elapsed;
    const isAck = kind === 'ack';

    // per SPEAKER. An answer is not the speaker starting a conversation.
    const gap = isAck ? SPEAKER_GAP_ACK : SPEAKER_GAP;
    if (now - (agent._radioAt ?? -1e9) < gap) return false;
    // per KIND, per net.
    if (now - net.kindAt[kind] < (KIND_GAP[kind] ?? 6)) return false;

    const priority = PRIORITY[kind] ?? 0.4;
    const slot = this._claim(net, priority);
    if (!slot) return false;

    slot.used = true;
    slot.id = _nextMsg++;
    slot.kind = kind;
    slot.voice = voice;
    slot.priority = priority;
    slot.at = now;
    slot.notBefore = isAck ? now + 0.42 + this.rng.float() * 0.55 : now;
    slot.expires = slot.notBefore + (TTL[kind] ?? 3.5);
    slot.speaker = agent;
    slot.wantsAnswer = !!wantsAnswer;
    slot.answerTo = answerTo;
    slot.position.copy(point ?? agent.position);
    /**
     * The kind clock is stamped HERE, not at transmission. A man who is queued
     * behind somebody else has still said the thing as far as the net is
     * concerned, and stamping at transmission lets four men queue the same
     * callout while the first one waits for the gap.
     */
    net.kindAt[kind] = now;
    return true;
  }

  /* ================================================================== */
  /* the net                                                            */
  /* ================================================================== */

  /**
   * One transmission per net per `_netGap`, one on the map per `GLOBAL_GAP`.
   *
   * Costs two fixed loops of `SLOTS` and one walk of the roster, which is the
   * same roster `AiSystem.update` is already walking; at thirty men that is
   * thirty comparisons and no allocation.
   */
  update(dt, agents) {
    if (!this.enabled) return;
    const now = this.ctx.time.elapsed;
    this._heat(agents, dt);

    for (let t = 0; t < 2; t++) {
      const net = this.nets[t];
      /**
       * THE SILENCE MEASUREMENT. Counted only while this side is in contact,
       * because "the net was quiet for 40 s" is the CORRECT behaviour when
       * nobody is fighting and a failure when somebody is. @see `report()`.
       */
      if (net.heat >= HOT_HEAT) {
        net.hotTime += dt;
        const quiet = now - net.lastTx;
        if (quiet > net.maxHotSilence && net.lastTx > -1e8) net.maxHotSilence = quiet;
      }
      if (now - this.lastTxAny < GLOBAL_GAP) continue;

      let best = null;
      for (let i = 0; i < SLOTS; i++) {
        const s = net.slots[i];
        if (!s.used) continue;
        if (now > s.expires) { s.used = false; s.speaker = null; net.dropped++; continue; }
        if (now < s.notBefore) continue;
        if (!s.speaker || !s.speaker.alive) {
          /**
           * A DEAD MAN DOES NOT FINISH HIS SENTENCE, with one exception: an
           * answer is owed by the side, not by the man, so it is handed to
           * somebody else rather than dropped. Everything else dies with him,
           * which is the correct behaviour and is also the thing that makes
           * "MAN DOWN" land as an interruption.
           */
          const heir = s.kind === 'ack' ? this._anyLive(net.team, null) : null;
          if (!heir) { s.used = false; s.speaker = null; net.dropped++; continue; }
          s.speaker = heir;
        }
        if (!best || s.priority > best.priority
          || (s.priority === best.priority && s.at < best.at)) best = s;
      }
      if (!best) continue;
      /**
       * AN ANSWER DOES NOT QUEUE BEHIND THE NET'S GAP. MEASURED: with the gap
       * applied to everything, a quiet net (6.0 s) answered NOTHING — 50 calls
       * wanted an answer, 50 acks were queued and all 50 expired waiting for a
       * turn, because `TTL.ack` is 2.6 s and 2.6 < 6.0. The exchange it exists
       * to create cannot survive being scheduled like an announcement: "MOVING
       * UP" … "SET" is a beat, not a slot, and a "ROGER" that arrives six
       * seconds later answers nothing.
       *
       * `GLOBAL_GAP` above still applies, so an answer is still 0.55 s clear of
       * whatever it is answering and the pair reads as two people rather than
       * as one overlapping noise.
       */
      const gap = best.kind === 'ack' ? ACK_NET_GAP : this._netGap(net);
      if (now - net.lastTx < gap) continue;
      this._transmit(net, best, now);
    }
  }

  /** 1.9 s in contact, 6.0 s out of it, and everything between. */
  _netGap(net) {
    const k = Math.min(1, net.heat / 0.35);
    return NET_GAP_QUIET + (NET_GAP_HOT - NET_GAP_QUIET) * k;
  }

  _transmit(net, m, now) {
    const friendly = net.team === (this.ai.playerTeam | 0);
    const audio = this._getAudio();
    let played = false;
    if (audio) {
      /**
       * FRIENDLY IS THE RADIO, ENEMY IS A MAN IN THE STREET. @see the header.
       * `bark` with a null position plays dry (head-locked); with one it goes
       * through the spatial field with the propagation delay and the occlusion.
       */
      /**
       * `force` SKIPS `audio.bark`'S OWN 0.42 s MUSH GUARD, and this is the one
       * place in the codebase entitled to. MEASURED, first live run of
       * `src/ai/radiocheck.mjs`: 60 % of transmissions came back false, and the
       * refused ones included FRIENDLY calls, which are `_playDry` and cannot
       * fail for any budget reason. The guard is a single global clock shared
       * with the death scream and the wounded grunt — `_onDeath` alone stamps
       * it on every one of ~260 deaths a match, and `_onDamageDealt` stamps it
       * on every wounding hit — so a net that transmits once every 1.9 s was
       * losing most of its traffic to barks that are not radio traffic at all.
       *
       * That guard exists because nothing upstream of it had a scheduler. This
       * one does: four limiters and a queue, and `GLOBAL_GAP` above is already
       * a stricter version of the same rule for the transmissions it owns.
       * Bypassing it does NOT bypass the voice budget — a positional bark still
       * has to win an emitter from `SpatialField.acquire`, and losing there is
       * correct and is counted as `refusedByAudio`.
       */
      played = friendly
        ? audio.bark(m.voice, null, { radio: true, voice: m.speaker.id, level: 0.85, force: true })
        : audio.bark(m.voice, m.speaker.alive ? m.speaker.position : m.position,
          { voice: m.speaker.id, level: 1, force: true });
    }
    net.lastTx = now;
    this.lastTxAny = now;
    m.speaker._radioAt = now;
    net.sent++;
    if (!played) net.refused++;
    net.kinds[m.kind] = (net.kinds[m.kind] ?? 0) + 1;
    if (m.answerTo) net.answered++;

    const e = this._log[this._logAt];
    e.t = now; e.team = net.team; e.kind = m.kind; e.voice = m.voice;
    e.speaker = m.speaker.name; e.answerTo = m.answerTo; e.radio = friendly; e.played = played;
    this._logAt = (this._logAt + 1) % LOG;
    if (this._logCount < LOG) this._logCount++;

    if (m.wantsAnswer) {
      net.wantedAnswer++;
      this._scheduleAnswer(net, m, now);
    }
    m.used = false;
    m.speaker = null;
  }

  /**
   * SOMEBODY ANSWERS. Not always — a net where every call is acknowledged is as
   * unreal as one where none is, and a man who is being shot at does not say
   * "ROGER". The responder is the nearest live squadmate who is NOT the speaker
   * and is not himself pinned; `SPEAKER_GAP_ACK` still applies to him, so the
   * same voice cannot answer everything.
   */
  _scheduleAnswer(net, m, now) {
    if (this.rng.float() > 0.68) return;
    const responder = this._anyLive(net.team, m.speaker);
    if (!responder) return;
    /**
     * WHICH ANSWER. "SET" is what you say when somebody says he is moving; a
     * contact report gets "ROGER" or "COPY". Picking by the call being answered
     * rather than at random is most of what makes the pair sound like an
     * exchange.
     */
    const voice = (m.kind === 'movingup' || m.kind === 'pushing' || m.kind === 'flank')
      ? 'setpos'
      : ACK_VOICES[this.rng.int(0, ACK_VOICES.length - 1)];
    this.say(responder, 'ack', voice, null, false, m.id);
  }

  /**
   * The live man of `team` best placed to speak. Preference is a plain scan for
   * the one nearest `avoid` (i.e. nearest the man being answered) so an
   * acknowledgement comes from somebody who is plausibly with him; with no
   * `avoid` it is simply the first live man, which is all an announcement needs.
   */
  _anyLive(team, avoid) {
    const agents = this.ai.agents;
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      if (!a.alive || a.team !== team || a === avoid) continue;
      if (!avoid) return a;
      const d = a.position.distanceToSquared(avoid.position);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  /** Free slot, or the worst queued message if this one outranks it. */
  _claim(net, priority) {
    let worst = null;
    for (let i = 0; i < SLOTS; i++) {
      const s = net.slots[i];
      if (!s.used) return s;
      if (!worst || s.priority < worst.priority) worst = s;
    }
    if (worst && worst.priority < priority) { net.dropped++; return worst; }
    return null;
  }

  /** Share of each side that is fighting, smoothed. Drives `_netGap`. */
  _heat(agents, dt) {
    let live0 = 0, live1 = 0, hot0 = 0, hot1 = 0;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      if (!a.alive) continue;
      const fighting = a.hasTarget || a.state === 'combat' || a.state === 'suppressed';
      if (a.team === 1) { live1++; if (fighting) hot1++; } else { live0++; if (fighting) hot0++; }
    }
    const k = Math.min(1, dt * 0.9);
    this.nets[0].heat += ((live0 ? hot0 / live0 : 0) - this.nets[0].heat) * k;
    this.nets[1].heat += ((live1 ? hot1 / live1 : 0) - this.nets[1].heat) * k;
  }

  /* ================================================================== */
  /* what a contact report says                                         */
  /* ================================================================== */

  /**
   * A LANDMARK IF THERE IS ONE, OTHERWISE A BEARING.
   *
   * `interiorVolumes` is the ground storey of every enterable building as an
   * oriented box on the level's axes — the same list `NavGrid._carveInteriors`
   * uses — so "is what I am looking at indoors" is eight box tests and no
   * allocation. Two storeys above the speaker is "ROOFTOP", which on this map
   * is the only other thing a bot can be looking at that has a name.
   *
   * The bearing is LEVEL-SPACE. The map is rotated inside the world
   * (`world.levelYaw`), so a world-space bearing would be off by that angle
   * against every street on it and the callout would be worse than none.
   */
  _contactVoice(agent, point) {
    if (!point) return 'spotted';
    if (point.y - agent.position.y > 4.5) return 'contact_rooftop';
    if (this._insideBuilding(point)) return 'contact_inside';
    const dx = point.x - agent.position.x;
    const dz = point.z - agent.position.z;
    if (dx * dx + dz * dz < 1) return 'contact';
    // Undo the level's yaw so +Z is the map's own north.
    const c = Math.cos(-this._levelYaw), s = Math.sin(-this._levelYaw);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const oct = ((Math.round(Math.atan2(lx, lz) / (Math.PI / 4)) % 8) + 8) % 8;
    return `contact_${BEARING[oct]}`;
  }

  _insideBuilding(p) {
    const vols = this._interiors;
    if (!vols) return false;
    for (let i = 0; i < vols.length; i++) {
      const v = vols[i];
      if (p.y > v.floorY + 4.2 || p.y < v.floorY - 1.5) continue;
      const dx = p.x - v.cx;
      const dz = p.z - v.cz;
      // Back onto the building's own axes — the same rotation `NavGrid.
      // _carveInteriors` applies to these volumes, sign for sign.
      const lx = dx * v.c - dz * v.s;
      const lz = dx * v.s + dz * v.c;
      if (Math.abs(lx) < v.hw && Math.abs(lz) < v.hd) return true;
    }
    return false;
  }

  _getAudio() {
    if (this._audio === undefined) this._audio = this.ctx.peek('audio') ?? null;
    return this._audio;
  }

  /**
   * The measurement. Read by `src/ai/radiocheck.mjs` and by the dev overlay;
   * nothing in gameplay reads it. Allocates — it is not called per frame.
   */
  report() {
    const per = [];
    for (const n of this.nets) {
      per.push({
        team: n.team,
        sent: n.sent,
        refusedByAudio: n.refused,
        droppedFromQueue: n.dropped,
        wantedAnswer: n.wantedAnswer,
        answered: n.answered,
        distinctKinds: Object.keys(n.kinds).length,
        kinds: { ...n.kinds },
        heat: +n.heat.toFixed(3),
        hotSeconds: +n.hotTime.toFixed(1),
        maxSilenceInFirefight: +n.maxHotSilence.toFixed(2),
      });
    }
    const log = [];
    const start = this._logCount < LOG ? 0 : this._logAt;
    for (let i = 0; i < this._logCount; i++) {
      const e = this._log[(start + i) % LOG];
      log.push({ t: +e.t.toFixed(2), team: e.team, kind: e.kind, voice: e.voice,
        speaker: e.speaker, answerTo: e.answerTo, radio: e.radio, played: e.played });
    }
    return { nets: per, log };
  }
}
