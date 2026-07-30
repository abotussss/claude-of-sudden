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
 * `botReachable` IS NECESSARY AND IT IS NOT SUFFICIENT. MEASURED.
 * ────────────────────────────────────────────────────────────────────────────
 * `src/ai/nav.js` is a 2.5D HEIGHT FIELD — one floor per (x, z) cell — so no bot
 * on this map can climb a stair, and `features.js` marks that with
 * `botReachable`, which is `floor === 0`. That is the right thing for `world` to
 * publish and it is all `world` can know: the nav grid does not exist when
 * `buildFeatures` runs, and it belongs to `ai`, which inits later.
 *
 * It is also, on this map, WRONG FOR HALF OF THEM. `_cacheprobe.mjs` asks the
 * real grid for a cell within three rings and 1.2 m of each cache and then A*s
 * to it from all thirty spawn points:
 *
 *   cache            nav cell?   nearest cell     routes
 *   W1-f0-ammo         yes       3.35 m away       30/30
 *   E1-f0-ammo         yes       3.64 m away       30/30
 *   K1-f0-ammo         yes       2.95 m away       30/30
 *   K2-f0-grenade      yes       2.82 m away       30/30
 *   W2-f0-ammo         NO        6.37 m ABOVE       0/30
 *   W3-f0-ammo         NO        6.37 m ABOVE       0/30
 *   E2-f0-ammo         NO        9.42 m ABOVE       0/30
 *   E3-f0-ammo         NO        6.37 m ABOVE       0/30
 *
 * Four of the eight ground floors are not in the height field at all: the
 * downward sample that builds the grid lands on their ROOF, which is what the
 * long note in `sites.js` says happens and why the plant zone was never allowed
 * upstairs. Ordering a bot to one of those is ordering him to stand still —
 * `Agent._advance` sets `objectiveBlocked` and he holds position — which is the
 * exact "AIが立ち止まる" failure the hold-spot code was written to kill.
 *
 * SO THIS PROVES THEM, at init, against the real grid, exactly the way
 * `sites.js` proves a zone's standing points rather than trusting the author.
 * `prove()` snaps each cache to the nav cell a bot would actually walk to,
 * requires an A* route from at least one spawn of each side, and drops the rest.
 * `stand` is that cell and is what `setObjective` is handed — the crate itself
 * is up to 3.6 m from any cell a bot can occupy, so handing over `position`
 * would be handing over a destination that does not exist.
 *
 * The sixteen upstairs and roof caches stay the PLAYER's, which is the same
 * split `sites.js` documents for the overwatch decks.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND THEN: NO BOT ON THIS MAP CAN BE INDOORS AT ALL. DO NOT RE-TRY THIS.
 * ────────────────────────────────────────────────────────────────────────────
 * The obvious next step from the four proven caches is to have
 * `_assignDomination` send men to them — resupply when low, contest one beside a
 * contested zone. That was written, measured, and REMOVED, and the measurement
 * is here so nobody writes it a third time.
 *
 * FIRST, THE GEOMETRY. `_navin.mjs` sweeps every walkable cell of the 328x329
 * grid and asks which fall inside an `enterable` footprint, inset past the wall:
 *
 *   building   cells inside the footprint   …at GROUND level (< 2.5 m)
 *   W1                 376                            0
 *   W2                 424                            0
 *   W3                 794                            0
 *   E1                 376                            0
 *   E2                 424                            0
 *   E3                 794                            0
 *   K1                  74                            0
 *   K2                  91                            0
 *
 * Every one of those cells is at 3.2 m (K1/K2), 6.5 m (the west row) or 9.6 m
 * (E1/E2) — they are ROOFS. The grid is built by dropping one ray per cell from
 * above the level, so inside a footprint it can only ever find the roof; there
 * is no ground floor in the height field anywhere on this map, and A* from all
 * thirty spawn points reaches 0 of them. That is not a bug in `world` or in
 * `match`: it is `src/ai/nav.js`'s documented 2.5D design, and `sites.js`'s own
 * long note says the same thing about the plant zone.
 *
 * So `botReachable` — `floor === 0` — is not merely optimistic for four of the
 * eight. It is FALSE FOR ALL TWENTY-FOUR. `prove()` above keeps the four whose
 * nearest walkable cell is within three rings, and every one of those four cells
 * is measurably OUTSIDE its building: W1 3.35 m, E1 3.64 m, K1 2.95 m, K2 2.82 m
 * from the crate, all beyond the wall. They are DOORWAYS, not interiors.
 *
 * SECOND, WHAT ORDERING MEN TO THEM DID. Same build, one A/B, the legs neutered
 * at runtime for the control (`_indoortime.mjs --nolegs`), ~4100 bot-samples each:
 *
 *                                        legs OFF   legs ON
 *   bot time inside a footprint            4.65 %    0.00 %
 *   …inside the walls (inset 0.6)          4.60 %    0.00 %
 *   bot time at a building (within 3.5)   36.16 %   41.71 %
 *   bot time within 4 m of a proved cache  1.85 %    4.06 %
 *   bots on a cache leg (mean)              0.00      5.28
 *
 * The orders worked exactly as written — twice the time at a cache, six points
 * more time against a building — and the number they existed to move went to
 * ZERO, because every destination they could offer is a square of street outside
 * a door, and standing men there takes them off the ground they were incidentally
 * fighting over. A feature that scores 0.00 % on its own objective is not a
 * feature to tune; it is a feature whose premise is false.
 *
 * WHAT WOULD ACTUALLY FIX IT, neither of which is `match`'s to do:
 *   - `src/ai/nav.js` would have to sample more than one floor per cell, or
 *   - `src/world/buildings.js` would have to put roof plates on `LAYER.CLIP`
 *     (the way `src/world/links.js` already does for the rooftop gangways) so
 *     the grid's downward ray reaches the ground floor instead of the roof.
 * Until one of those happens the caches are a PLAYER feature, and the honest
 * version of "give the AI a reason to go indoors" is that there is no indoors
 * for the AI to go to.
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

    /**
     * WHAT MAY BE ON A RACK, and it is not quite `weapons.primaryIds`.
     *
     * `primaryIds` is `WEAPON_IDS` minus `class: 'pistol'` and `class: 'melee'`
     * — which leaves the FRAG GRENADE in it, because its class is `'grenade'`.
     * Measured on the first run of `_cachetest.mjs`: rack E2 offered "M67", i.e.
     * a weapon rack whose reward was making a hand grenade your primary weapon.
     *
     * Filtered here rather than in `weapons.primaryIds`, because that getter is
     * also what the pause menu's loadout list is built from and changing it is a
     * change to a screen this pass was not asked to touch. @see the spawned note.
     */
    const primaries = (weapons?.primaryIds ?? []).filter(
      (id) => weapons.states.get(id)?.def?.class !== 'grenade'
    );
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
        /** Only on `kind === 'weapon'`. */
        weaponId: null,
        label: '',
        /**
         * The nav cell a bot can actually stand on to use this, or null when
         * there is none. Filled in by `prove()`; NOT the same point as
         * `position`. @see the measured table in the header.
         */
        stand: null,
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

  /**
   * WHICH CACHES A BOT CAN ACTUALLY WALK TO, measured rather than believed.
   *
   * Called once from `MatchSystem.init`, after `resolveLayout` — by which point
   * `ai.grid` exists and the spawn clusters have been snapped and proved. It is
   * the same two-step `sites.js` uses on every zone centre and every standing
   * point, for the same reason, and the reason is in this file's header:
   * `world` published `botReachable` as `floor === 0` and four of the eight
   * ground floors on this map are not in the nav grid at all.
   *
   * Step 1, WALKABLE: a cell within three rings and 1.2 m of the cache's own
   * height. Three rings at `cell: 0.8` is 2.4 m, which is enough to find the
   * open floor beside a crate and not enough to wander to the next room.
   * Step 2, REACHABLE: an A* route from at least one spawn of EACH side — the
   * relaxed rule, which is all `sites.js` asks of a zone centre too, and which
   * proves the cell is part of the playable map rather than a sealed pocket.
   *
   * Populates `botList` and each survivor's `stand`. Idempotent.
   */
  prove(ai, spawns) {
    const g = ai?.grid;
    this.botList.length = 0;
    if (!g) {
      // No navigation: trust the author, exactly as `sites.js` does.
      for (const c of this.list) if (c.botReachable) { c.stand = c.position; this.botList.push(c); }
      return this.botList.length;
    }
    const path = [];
    const dropped = [];
    for (const c of this.list) {
      c.stand = null;
      if (!c.botReachable) continue;
      const ci = g.nearest(c.position.x, c.position.z, c.position.y, 3, 1.2);
      if (ci < 0) {
        dropped.push(`${c.id} (no nav cell — the grid samples its roof)`);
        continue;
      }
      const q = new THREE.Vector3(
        g.worldX(ci % g.nx),
        g.floor[ci],
        g.worldZ((ci / g.nx) | 0)
      );
      let ok = true;
      for (const kind of ['attack', 'defend']) {
        let any = false;
        for (const sp of spawns[kind]) if (g.findPath(sp.position, q, path) > 0) { any = true; break; }
        if (!any) { ok = false; break; }
      }
      if (!ok) {
        dropped.push(`${c.id} (walkable but no route from one of the bases)`);
        continue;
      }
      c.stand = q;
      this.botList.push(c);
    }
    if (dropped.length) {
      console.warn(
        `[match] ${dropped.length} cache(s) flagged botReachable that a bot cannot ` +
          `actually walk to, dropped: ${dropped.join(', ')}`
      );
    }
    return this.botList.length;
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
   * The PROVEN cache nearest `point` that this side has not already claimed, or
   * null. Measured from `stand`, the cell a bot walks to, not from the crate.
   *
   * `claimed` is per SIDE, not per map, and that is a deliberate change from the
   * first version: two men of the same side on one crate is a queue, but two men
   * of DIFFERENT sides converging on one crate is a fight in a doorway, which is
   * the entire thing "屋内戦闘" asks for. Claiming globally capped the whole
   * feature at four men on a map with four usable caches.
   *
   * `maxDist` keeps an order local: sending a man sixty metres across the map to
   * a crate is sending him out of the match.
   */
  nearestBotCache(point, claimed, maxDist) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (let i = 0; i < this.botList.length; i++) {
      const c = this.botList[i];
      if (claimed.has(c)) continue;
      const d = c.stand.distanceToSquared(point);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }
}
