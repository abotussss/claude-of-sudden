import * as THREE from 'three';
import { RULES } from './rules.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * MATCH — WHAT THE CACHES ARE WORTH, AND WHO WALKS TO THEM
 * ════════════════════════════════════════════════════════════════════════════
 * "もっと屋内戦闘をさせたいので屋内のエリアを作ってそこにもAIがいく利点やメリットを与えて
 *  でないとAIが屋内戦闘しない … 屋上だったり３階のエリアなどにもメリットを与えて 例えば
 *  武器が落ちてるとか、武器はF長押しで交換可能にする グレネードを補充できる テンポラリー
 *  リスポーン地点としてのビーコンを起動できる（３０秒間）"
 *
 * `src/world/features.js` builds twenty-four caches — one per floor of every
 * enterable building and one on every reachable roof — and publishes them as
 * `world.features`. It binds nothing to them and says so: "`world` may not
 * decide what a pickup gives any more than it may decide who is on which side".
 * This file is the other half of that sentence.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE MEASUREMENT THIS EXISTS TO MOVE
 * ────────────────────────────────────────────────────────────────────────────
 * `_indoortime.mjs` samples every alive bot against the eight enterable
 * footprints. Before anything was bound to the caches, over 4260 bot-samples of
 * live match: 4.25 % of bot-time indoors, THREE of twenty-nine bots ever set
 * foot in a building at all, and 96 % of that one figure was a single building
 * (W2) that happens to sit on a route. That is the complaint, in a number.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EIGHT OF THE TWENTY-FOUR, AND WHY IT IS NOT A LIMITATION TO WORK AROUND
 * ────────────────────────────────────────────────────────────────────────────
 * `src/ai/nav.js` is a 2.5D HEIGHT FIELD — one floor per (x, z) cell — so no bot
 * on this map can climb a stair, and `features.js` marks that with
 * `botReachable`, which is true only on the eight GROUND-FLOOR caches. Those
 * eight are the whole of what `_assignDomination` can send anybody to, and they
 * are enough: a ground floor is where the doors are, and a door onto a capture
 * point is the fight the complaint is about. The sixteen upstairs and roof
 * caches stay the PLAYER's, which is the same split `sites.js` documents for the
 * overwatch decks.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT EACH KIND HANDS OVER
 * ────────────────────────────────────────────────────────────────────────────
 * Every verb below belongs to `src/weapons` and is called through a hook, never
 * by reaching into its state: `reserve`, `mag` and `primaryId` are its own.
 *
 *   `ammo`     `weapons.scavenge(RULES.cacheAmmoMags)` — the same call the
 *              pouches on the bodies use, with the same "cannot exceed the
 *              round-start budget" cap.
 *   `weapon`   `weapons.pickUpPrimary(id)` on HOLD F. Each rack offers ONE
 *              weapon, fixed for the whole match — see `_assignWeapons`.
 *   `grenade`  `weapons.resupplyGrenades(RULES.cacheGrenades)`. The only source
 *              of frags inside a life other than dying.
 *   `vantage`  the roof and parapet nests. `features.js` builds an open
 *              ordnance box into every one of them, so they hand over
 *              ammunition — a firing position is somewhere you sit and shoot
 *              from, and what you need to do that is rounds.
 *
 * And ANY cache will take a BEACON on a TAP of the same key. That is deliberate
 * and it is the only reason a hold/tap split exists: the player has one
 * interaction key (`use`, KeyF) and needed two verbs at the same spot without a
 * second bind and without either verb ever firing by accident. Held past
 * `RULES.cacheHoldTime` is the cache; released before it is the beacon.
 *
 * NOTHING HERE ALLOCATES PER FRAME. The records are built once at init and the
 * per-frame queries write into preallocated scratch.
 */

/** The kinds `world.features` can publish. Anything else is ignored. */
const KINDS = new Set(['ammo', 'weapon', 'grenade', 'vantage']);

export class Caches {
  /**
   * @param {object} ctx
   * @param {Array} features `world.features`, or an empty list if world has none
   * @param {object} weapons the `weapons` subsystem, for the primary-id table
   */
  constructor(ctx, features, weapons) {
    this.ctx = ctx;
    this.weapons = weapons;
    /** Every cache, in publication order. Built once; never reallocated. */
    this.list = [];
    /** Just the ones a bot can walk to. A subset of `list`, same objects. */
    this.botList = [];

    const primaries = weapons?.primaryIds ?? [];
    let weaponSeen = 0;
    for (const f of features ?? []) {
      if (!f || !KINDS.has(f.kind) || !f.position) continue;
      const rec = {
        id: f.id,
        kind: f.kind,
        building: f.building,
        floor: f.floor,
        indoor: !!f.indoor,
        botReachable: !!f.botReachable,
        /** World space. `world` resolved this through its own transform. */
        position: f.position,
        yaw: f.yaw ?? 0,
        /**
         * `ctx.time.elapsed` this cache is usable again. Per cache rather than
         * per player: fifteen bots and a human share one map, and "I got there
         * first" is a real thing to have got.
         */
        readyAt: 0,
        /** Only on `kind === 'weapon'`. @see `_assignWeapons` */
        weaponId: null,
        label: '',
      };
      if (f.kind === 'weapon' && primaries.length) {
        /**
         * WHICH GUN IS ON WHICH RACK — round-robin over `weapons.primaryIds` in
         * publication order, which is stable for a given map.
         *
         * Deliberately NOT random. The player is meant to learn that the AK is
         * in W1 and the bolt gun is on E1's ground floor, because "I know where
         * a sniper is" is the thing that makes a building worth crossing the map
         * for. `ctx.rng` would re-roll it every boot and that lesson would never
         * stick — and this is also the one place in the feature where using the
         * shared rng would perturb every draw made after it.
         */
        rec.weaponId = primaries[weaponSeen++ % primaries.length];
        rec.label = weapons.states.get(rec.weaponId)?.def?.label ?? rec.weaponId;
      }
      this.list.push(rec);
      if (rec.botReachable) this.botList.push(rec);
    }

    /**
     * THE BEACON. One per side, and the side is `team`. Preallocated whole: this
     * record is read inside `_safeSpawn`, which runs on a respawn and must not
     * allocate.
     */
    this.beacon = {
      active: false,
      team: -1,
      position: new THREE.Vector3(),
      yaw: 0,
      /** `ctx.time.elapsed` it dies at. */
      until: 0,
      /** …and the earliest the same side may plant the next one. */
      readyAt: 0,
      /** Which cache it was planted at, for the HUD. */
      at: '',
      /** How many respawns have actually come out of it. Reported, not gameplay. */
      used: 0,
    };

    /** Reported by `_publishHud`; written in place. */
    this.stats = { taken: 0, weapons: 0, ammo: 0, frags: 0, beacons: 0, beaconSpawns: 0 };
    this._v = new THREE.Vector3();
  }

  /** How many seconds of beacon are left, or 0. */
  beaconRemaining(now) {
    return this.beacon.active ? Math.max(0, this.beacon.until - now) : 0;
  }

  /** Seconds until this side may plant another beacon, or 0. */
  beaconCooldown(now) {
    return Math.max(0, this.beacon.readyAt - now);
  }

  /** Retire an expired beacon. Returns true on the frame it dies. */
  update(now) {
    if (!this.beacon.active || now < this.beacon.until) return false;
    this.beacon.active = false;
    return true;
  }

  /**
   * The nearest cache to `p` within `RULES.cacheUseRadius`, or null.
   *
   * The height test is `< 2.4` rather than a plane test because these sit on
   * twenty-four different floors stacked over each other: without it, standing
   * on W1's first floor would offer you the cache on its ground floor through
   * the boards.
   */
  nearest(p) {
    const r2 = RULES.cacheUseRadius * RULES.cacheUseRadius;
    let best = null;
    let bestD = r2;
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i];
      if (Math.abs(c.position.y - p.y) > 2.4) continue;
      const d = c.position.distanceToSquared(p);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** Is this cache usable right now? */
  ready(c, now) {
    return !!c && now >= c.readyAt;
  }

  /**
   * Hand over what `c` holds. Called once, on the frame a hold completes.
   *
   * Returns a short line for the banner, or null when the cache had nothing this
   * player needed — which is NOT the same as "it fired": a full pouch must not
   * burn the cooldown, exactly as `AmmoDrops` will not consume a pouch for a
   * player who is already full (`weapons.needsAmmo`).
   *
   * @returns {{title: string, sub: string}|null}
   */
  take(c, now) {
    const wp = this.weapons;
    if (!wp || !this.ready(c, now)) return null;
    let out = null;
    if (c.kind === 'weapon' && c.weaponId) {
      const prev = wp.pickUpPrimary(c.weaponId);
      if (prev) {
        const prevLabel = wp.states.get(prev)?.def?.label ?? prev;
        out = { title: c.label, sub: `SWAPPED FOR ${prevLabel}` };
        this.stats.weapons++;
      }
    } else if (c.kind === 'grenade') {
      const got = wp.resupplyGrenades(RULES.cacheGrenades);
      if (got > 0) {
        out = { title: 'FRAGS RESUPPLIED', sub: `+${got} · ${wp.grenadeCount} CARRIED` };
        this.stats.frags += got;
      }
    } else {
      // `ammo` and `vantage` — both are a box of rounds.
      const got = wp.scavenge(RULES.cacheAmmoMags);
      if (got > 0) {
        out = { title: 'AMMUNITION', sub: `+${got} ROUNDS` };
        this.stats.ammo += got;
      }
    }
    if (!out) return null;
    c.readyAt = now + RULES.cacheCooldown;
    this.stats.taken++;
    return out;
  }

  /**
   * Plant the beacon at `c` for `team`. Returns true if it went down.
   *
   * The position is the CACHE's, not the player's: a beacon is a thing you
   * switch on at an installation, and pinning it to authored geometry means the
   * spawn point is always somewhere `world` proved a man can stand
   * (`tools/floorcheck.mjs` measures standing room at every one of the
   * twenty-four) rather than wherever the player's capsule happened to be.
   */
  plantBeacon(c, team, yaw, now) {
    if (!c || now < this.beacon.readyAt) return false;
    const b = this.beacon;
    b.active = true;
    b.team = team;
    b.position.copy(c.position);
    b.yaw = yaw;
    b.until = now + RULES.beaconTime;
    b.readyAt = now + RULES.beaconCooldown;
    b.at = c.id;
    b.used = 0;
    this.stats.beacons++;
    return true;
  }

  /**
   * The bot-reachable cache nearest `point` that is not already claimed, or
   * null. `claimed` is a Set of cache records, so two men are never sent to the
   * same crate — one man standing on a cache is a flank; two is a queue.
   *
   * `maxDist` keeps a "resupply" order local: sending a man sixty metres across
   * the map to a crate is sending him out of the match.
   */
  nearestBotCache(point, claimed, maxDist) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (let i = 0; i < this.botList.length; i++) {
      const c = this.botList[i];
      if (claimed.has(c)) continue;
      const d = c.position.distanceToSquared(point);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }
}
