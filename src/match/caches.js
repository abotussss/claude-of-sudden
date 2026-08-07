import * as THREE from 'three';
import { RULES } from './rules.js';

/**
 * Merge position/normal/uv geometries into one, disposing the sources.
 *
 * A FOURTH COPY OF THIS FUNCTION, AND THE DUPLICATION IS THE POINT. `bomb.js`,
 * `airstrike.js` and `bomber.js` each carry their own, and `airstrike.js`'s
 * copy explains why: a subsystem never imports another subsystem's module, so
 * `world`'s merge is out of reach. Importing `airstrike.js`'s export instead
 * would be legal — it is the same subsystem — and it was tried and taken back
 * out, because that file is being worked on by somebody else and a shared
 * export is a shared fate. Twenty lines is cheaper than a coupling.
 *
 * Exported so `reinforce.js`, which is this pass's own file, can use the same
 * one rather than making a fifth.
 */
export function mergeGeometries(list) {
  let vtx = 0;
  let idx = 0;
  for (const g of list) {
    vtx += g.attributes.position.count;
    idx += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vtx * 3);
  const nrm = new Float32Array(vtx * 3);
  const uv = new Float32Array(vtx * 2);
  const ind = new Uint32Array(idx);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    const a = g.attributes.position;
    const n = g.attributes.normal;
    const t = g.attributes.uv;
    pos.set(a.array, vo * 3);
    if (n) nrm.set(n.array, vo * 3);
    if (t) uv.set(t.array, vo * 2);
    if (g.index) {
      const src = g.index.array;
      for (let i = 0; i < src.length; i++) ind[io++] = src[i] + vo;
    } else {
      for (let i = 0; i < a.count; i++) ind[io++] = i + vo;
    }
    vo += a.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(ind, 1));
  out.computeBoundingSphere();
  return out;
}

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
 * SO THIS PROVES THEM, at init, against the real grid, exactly the way
 * `sites.js` proves a zone's standing points rather than trusting the author.
 * `prove()` snaps each cache to the nav cell a bot would actually walk to,
 * requires an A* route from at least one spawn of each side, and drops the rest.
 * `stand` is that cell and is what `setObjective` is handed — the crate itself
 * is up to 1.6 m of shelving from anywhere a capsule fits, so handing over
 * `position` would be handing over a destination that does not exist.
 *
 * The sixteen upstairs and roof caches stay the PLAYER's, which is the same
 * split `sites.js` documents for the overwatch decks.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS USED TO PROVE FALSE FOR ALL TWENTY-FOUR, AND THAT IS WHY THE LEGS WENT
 * ────────────────────────────────────────────────────────────────────────────
 * `nav.js` built its height field by dropping ONE ray per cell from above the
 * level, so inside a footprint it could only ever find the ROOF. `_navin.mjs`
 * swept every walkable cell of the 328x329 grid against the eight footprints:
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
 * Every one at 3.2 m (K1/K2), 6.5 m (the west row) or 9.6 m (E1/E2), 0 of 30
 * spawn points reaching any of them, and the four caches `prove()` kept all
 * standing 2.8-3.6 m from their crate and OUTSIDE the wall — doorways. Ordering
 * men to those four was written, measured and REMOVED:
 *
 *                                        legs OFF   legs ON
 *   bot time inside a footprint            4.65 %    0.00 %
 *   bot time at a building (within 3.5)   36.16 %   41.71 %
 *   bot time within 4 m of a proved cache  1.85 %    4.06 %
 *
 * The orders worked exactly as written and the number they existed to move went
 * to ZERO, because every destination they could offer was a square of street
 * outside a door and standing men there took them off the ground they had been
 * incidentally fighting over.
 *
 * WHAT FIXED IT was the first of the two things that note said would have to
 * happen: `NavGrid._carveInteriors` re-probes the cells inside a footprint from
 * INSIDE the building, off `world.interiorVolumes`. ~2620 ground-floor cells are
 * in the grid, `prove()` keeps six to eight of the eight ground-floor caches
 * depending on where the dressing dice fall, and every surviving `stand` is a
 * cell in a room. `_assignCacheLegs` is back in `src/match/index.js` with the
 * A/B in its header: 3 of 29 men had ever been inside a building, 23 are now.
 *
 * DO NOT go back to trusting `botReachable`. A doorway can still be dressed shut
 * on a given boot, and `prove()` is what catches it.
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

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE MEDICAL ZONE — "医療ゾーンを作り、そこで医療キットをFで取得したら体力を５０
 * 回復するようにして 医療ゾーンは基本、敵味方関係なく使えるようにして"
 * ════════════════════════════════════════════════════════════════════════════
 * WHICH PUBLISHED FEATURES BECOME DRESSING STATIONS, BY ID.
 *
 * `world` publishes four kinds and must go on publishing four: "`world` may not
 * decide what a pickup gives any more than it may decide who is on which side".
 * So the fifth kind is made HERE, at init, by renaming two of them — which is
 * the same sentence `features.js` writes about its own flank squares ("`kind:
 * 'ammo'` is deliberate rather than lazy … a new kind would be an inert painted
 * square until a file outside `world` was edited"). This is that file.
 *
 * THE TWO LANE DEPOTS, AND THE CHOICE IS NOT ARBITRARY:
 *
 *   • They are a ρ PAIR. `BEACON_SPOTS` authors them at level (∓34.75, ±19)
 *     under the map's own (x, z) -> (-x, -2 - z) symmetry, so neither side is
 *     nearer its own dressing station. "敵味方関係なく" has to be true of the
 *     GEOMETRY as well as of the code, or it is only true on paper.
 *   • They are OUTDOORS, on flank lanes with no capture point on them, and
 *     `features.js` put them there precisely because those lanes had no reason
 *     to be walked. A place you retreat to for fifty health is that reason, and
 *     it is a better one than a crate of rounds on ground nobody contests.
 *   • They are ground-floor and `botReachable`, so `Caches.prove` measures them
 *     against the real nav grid like everything else.
 *
 * WHAT IT COSTS: the map loses two of its four flank `ammo` squares. That is a
 * real subtraction and it is the intended one — a med post has to BE somewhere,
 * the two plaza squares (`FLANK-NW` / `FLANK-SE`) keep ammunition on the flanks,
 * and seven of the eight indoor ground-floor dumps are untouched.
 *
 * A BEACON CAN STILL BE PLANTED ON ONE. `plantBeacon` never looked at `kind`,
 * and a dressing station is the safest square on a flank to switch a forward
 * spawn on at — which is the same argument `features.js` makes for the two
 * cathedral aisles.
 */
const MEDIC_FEATURES = new Set(['FLANK-W-beacon', 'FLANK-E-beacon']);

export class Caches {
  /**
   * @param {object} ctx
   * @param {Array} features `world.features`, or an empty list if world has none
   * @param {object} weapons the `weapons` subsystem, for the primary-id table
   * @param {object} player  the `player` subsystem, for the med kit's `health.heal`
   */
  constructor(ctx, features, weapons, player = null) {
    this.ctx = ctx;
    this.weapons = weapons;
    /**
     * THE LOCAL PLAYER'S HEALTH, and it is reached the same way `weapons` is:
     * a reference to the owning subsystem's own object, whose verbs
     * (`heal`, and the `max` it clamps to) belong to `src/player`. `match`
     * already writes `player.health.regenEnabled`, so this is not a new surface.
     * Null when there is no player, and every use is guarded.
     */
    this.health = player?.health ?? null;
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
    /** How many features were promoted to `medic`. Logged by `match`. */
    this.medicCount = 0;
    for (const f of features ?? []) {
      if (!f || !KINDS.has(f.kind) || !f.position) continue;
      /**
       * THE ONE PLACE THE FIFTH KIND IS MADE. @see `MEDIC_FEATURES` — `world`
       * publishes four kinds and `match` decides what a published place is
       * worth, so the promotion happens on the way into this list and nothing
       * downstream of here knows the difference between an authored kind and a
       * bound one.
       */
      const medic = MEDIC_FEATURES.has(f.id);
      if (medic) this.medicCount++;
      const rec = {
        id: f.id,
        kind: medic ? 'medic' : f.kind,
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
      if (medic) rec.label = 'MED KIT';
      this.list.push(rec);
    }

    /**
     * ════════════════════════════════════════════════════════════════════════
     * THE CATHEDRAL CENTRE — "破壊される前は大聖堂の中央にビーコン医療キットを
     * 配置して大聖堂内に来るメリットを与えて"
     * ════════════════════════════════════════════════════════════════════════
     * Two posts at the crossing while the church STANDS: a supply cache (which,
     * like every cache in this file, takes a beacon on TAP F — that is the
     * "ビーコン" half) and a med kit. They are the reason to be inside the
     * biggest room on the map before the event that opens it.
     *
     * WHY THEY ARE NOT `world.features`: the cathedral is deliberately not a
     * `BUILDINGS` entry (@see src/world/cathedral.js) so `buildFeatures` never
     * walks it, and `src/world` is being worked on by somebody else. `match`
     * already owns "what a published place is worth"; these two extend that to
     * "and one place the level did not publish", with the position taken from
     * the one record `world` does publish — `world.cathedral`'s own level frame.
     *
     * WHERE, EXACTLY: ±1.8 m off the crossing centre along the transept axis.
     * Inside the capture circle (the merit IS the objective), outside nothing —
     * the shell keeps 4.5 m of the centre clear of rubble and the ruin's
     * `KEEP_STAND` keeps its masses past 4.75 m, so the spot has standing room
     * in BOTH states (`_cathpost.mjs` proves it with floorcheck's own ring
     * test, intact and after a real razed match).
     *
     * ────────────────────────────────────────────────────────────────────────
     * WHAT HAPPENS TO THEM WHEN THE BUILDING IS RAZED — DESTROYED, DELIBERATELY
     * ────────────────────────────────────────────────────────────────────────
     * Three options were on the table: destroyed, relocated, or left running.
     * They die with the building (`setCathedralRazed`), because:
     *
     *   1. the centre BECOMES capture point D. A beacon-plantable cache on the
     *      live objective would let the side that reaches it first switch a
     *      60 s forward spawn on ON the point — stronger than holding a zone,
     *      which is the mode's own currency;
     *   2. a med post on the one point the whole map funnels into after the
     *      event would fuel the fight it is supposed to decide;
     *   3. and a bombardment that levels the building levelling the supplies
     *      in it is the honest fiction. The dressing is hidden with the shell,
     *      the records refuse (`disabled`), and a beacon PLANTED at one dies
     *      with it — its `until` is pulled to now, so it expires down the same
     *      path a timed-out beacon takes.
     *
     * The round reset that stands the church back up re-enables both
     * (`MatchSystem._setCathedralRazed(false)` is already the one place all
     * three transitions pass through).
     */
    this.cathGroup = null;
    {
      const w = ctx.peek?.('world') ?? null;
      const k = w?.cathedral ?? null;
      if (k?.level && typeof w.levelToWorld === 'function') {
        const yaw = w.levelYaw ?? 0;
        const post = (id, kind, du, label) => {
          const p = w.levelToWorld(k.level.x + du, k.floorY ?? 0, k.level.z, new THREE.Vector3());
          this.list.push({
            id,
            kind,
            building: 'CATH',
            floor: 0,
            indoor: true,
            botReachable: true,
            position: p,
            yaw,
            readyAt: 0,
            weaponId: null,
            label,
            stand: null,
            /** The lifecycle flag `setCathedralRazed` keys on. */
            cathedral: true,
            disabled: false,
          });
        };
        post('CATH-CENTRE-supply', 'ammo', -1.8, 'SUPPLY CACHE');
        post('CATH-CENTRE-med', 'medic', 1.8, 'MED KIT');
        this.medicCount++;
      }
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
    this.stats = {
      taken: 0, weapons: 0, ammo: 0, frags: 0, beacons: 0, beaconSpawns: 0,
      /** Med kits taken and HP actually returned. @see `RULES.medicHeal`. */
      medkits: 0, healed: 0,
      /** Of `taken`, how many were opened by a BOT. @see `takeForBot`. */
      botTakes: 0,
      /** Cache legs handed out, split by the reason. @see `_assignCacheLegs`. */
      legsContest: 0, legsAmmo: 0, legsGrenade: 0, legsVantage: 0, legsVeteran: 0,
    };
    this._v = new THREE.Vector3();

    /**
     * ────────────────────────────────────────────────────────────────────────
     * THE LOCAL PLAYER'S FRAG CLOCK — "グレネードの補充は1分に一回まで"
     * ────────────────────────────────────────────────────────────────────────
     * `ctx.time.elapsed` the human may take frags again. PER PLAYER, and it is a
     * different rule from `readyAt`, which is per CACHE: with six grenade stacks
     * on this map, a forty second per-cache cooldown lets one man walk a circuit
     * of three of them and never be without frags. "補充できすぎるとゲーム性崩壊
     * する" is that circuit, and this is the thing that closes it.
     *
     * It is the PLAYER's because bots do not use `take()` at all — `_orderCache`
     * walks them to a cache and the presence itself is the point (see this
     * file's header); nothing in `src/ai` hands a bot a grenade off one. If that
     * ever changes this becomes a map keyed on the actor, and the rule does not.
     */
    this.grenadeReadyAt = 0;
    /**
     * WHY THE LAST `take()` HANDED NOTHING OVER, or null. Reused in place, valid
     * only until the next call, and the caller copies the strings out
     * synchronously — the alternative was `take()` returning null for both "you
     * are full" and "you may not have these for another 41 seconds", which is a
     * refusal the player cannot tell from a broken key.
     */
    this.denied = null;
    this._denied = { title: '', sub: '' };
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

  /** Seconds until the local player may take frags again, or 0. */
  grenadeCooldown(now) {
    return Math.max(0, this.grenadeReadyAt - now);
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
   * THE CATHEDRAL POSTS FOLLOW THE BUILDING. Called from the one place all
   * three cathedral transitions already pass through —
   * `MatchSystem._setCathedralRazed` — with the state `world.cathedral.razed`
   * actually holds (which under `?cath=down` is not the argument the caller was
   * given). Down: the records refuse, the dressing goes with the shell, and a
   * beacon planted at one has its clock pulled to now so it dies down the same
   * path a timed-out beacon takes — announcement and all. Up (the round
   * reset): both come back. @see the lifecycle note in the constructor.
   */
  setCathedralRazed(down) {
    const want = !!down;
    for (const c of this.list) {
      if (c.cathedral) c.disabled = want;
    }
    if (this.cathGroup) this.cathGroup.visible = !want;
    if (want && this.beacon.active) {
      for (const c of this.list) {
        if (c.cathedral && c.id === this.beacon.at) {
          this.beacon.until = Math.min(this.beacon.until, this.ctx.time?.elapsed ?? 0);
          break;
        }
      }
    }
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
      if (c.disabled) continue;
      if (Math.abs(c.position.y - p.y) > 2.4) continue;
      const d = c.position.distanceToSquared(p);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** Is this cache usable right now? A razed cathedral post never is. */
  ready(c, now) {
    return !!c && !c.disabled && now >= c.readyAt;
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
    this.denied = null;
    const wp = this.weapons;
    if (!wp) return null;
    if (!this.ready(c, now)) {
      // A dressing station is not "resupplying" — it is out of kits. The whole
      // reason `_deny` carries two strings is that a refusal the player cannot
      // tell from a broken key is what this feature was rebuilt to stop.
      return c.kind === 'medic'
        ? this._deny('NO KIT LEFT', `READY IN ${Math.ceil(c.readyAt - now)}S`)
        : this._deny('CACHE RESUPPLYING', `READY IN ${Math.ceil(c.readyAt - now)}S`);
    }
    let out = null;
    if (c.kind === 'medic') {
      /**
       * ────────────────────────────────────────────────────────────────────
       * THE MED KIT — "医療キットをFで取得したら体力を５０回復する"
       * ────────────────────────────────────────────────────────────────────
       * `health.heal(n)` is `src/player`'s own verb and it already clamps at
       * `HEALTH.max`, which is why nothing here reads `value` to decide how
       * much to give: the same "the owning subsystem decides what it is worth"
       * split every other branch in this method is written under.
       *
       * A MAN ON FULL HEALTH IS REFUSED, and that refusal is the reason `take`
       * returns null instead of a string. The rule is the one `AmmoDrops` and
       * the frag stack already apply — a pickup that hands over nothing must
       * not burn the cooldown, or a full-health man standing on the post takes
       * it away from the wounded man behind him. `RULES.regen` is false, so on
       * this map "full" means "has not been shot yet".
       */
      const h = this.health;
      if (!h) return this._deny('NO MEDICAL SUPPORT', '');
      const before = h.value;
      if (before >= h.max - 0.5) {
        return this._deny('NO INJURIES', `${Math.round(before)} HP`);
      }
      h.heal(RULES.medicHeal);
      const got = Math.round(h.value - before);
      out = { title: 'MED KIT', sub: `+${got} HP · ${Math.round(h.value)} HP` };
      this.stats.healed += got;
      this.stats.medkits++;
    } else if (c.kind === 'weapon' && c.weaponId) {
      const prev = wp.pickUpPrimary(c.weaponId);
      if (prev) {
        const prevLabel = wp.states.get(prev)?.def?.label ?? prev;
        out = { title: c.label, sub: `SWAPPED FOR ${prevLabel}` };
        this.stats.weapons++;
      } else {
        return this._deny('ALREADY CARRYING', c.label);
      }
    } else if (c.kind === 'grenade') {
      /**
       * ONE MINUTE, PER PLAYER, AND IT IS CHECKED BEFORE THE HANDOVER. @see
       * `grenadeReadyAt`. The refusal is a `denied` with the seconds in it: a
       * hold that does nothing and says nothing is indistinguishable from a
       * feature that is broken, which is how this whole pass started.
       */
      const wait = this.grenadeCooldown(now);
      if (wait > 0) return this._deny('FRAGS ON COOLDOWN', `READY IN ${Math.ceil(wait)}S`);
      const got = wp.resupplyGrenades(RULES.cacheGrenades);
      if (got > 0) {
        // Spent only on a real handover, so a full pouch cannot burn the minute.
        this.grenadeReadyAt = now + RULES.grenadeResupplyCooldown;
        out = { title: 'FRAGS RESUPPLIED', sub: `+${got} · ${wp.grenadeCount} CARRIED` };
        this.stats.frags += got;
      } else {
        return this._deny('POUCH FULL', `${wp.grenadeCount} FRAGS CARRIED`);
      }
    } else {
      // `ammo` and `vantage` — both are a box of rounds.
      const got = wp.scavenge(RULES.cacheAmmoMags);
      if (got > 0) {
        out = { title: 'AMMUNITION', sub: `+${got} ROUNDS` };
        this.stats.ammo += got;
      } else {
        return this._deny('AMMUNITION FULL', 'NOTHING TO TAKE');
      }
    }
    if (!out) return null;
    // A dressing station recovers faster than a supply dump. @see `RULES.medicCooldown`.
    c.readyAt = now + (c.kind === 'medic' ? RULES.medicCooldown : RULES.cacheCooldown);
    this.stats.taken++;
    return out;
  }

  /** Record why nothing was handed over, and hand back null. No allocation. */
  _deny(title, sub) {
    this._denied.title = title;
    this._denied.sub = sub;
    this.denied = this._denied;
    return null;
  }

  /**
   * THE CACHES CLOSE ENOUGH TO BE WORTH DRAWING, nearest first.
   *
   * References to the records themselves are written into `out` — the caller
   * owns that array and nothing is allocated here or there. The height test is
   * deliberately generous where `nearest()`'s is tight: `nearest` decides what
   * you may put your hands on and must not reach through a floor, whereas a
   * MARKER for the crate one storey up is the entire point of the feature —
   * "屋上だったり３階のエリアなどにもメリットを与えて" only works if a man on the
   * street can see that there is something up there.
   *
   * @param {THREE.Vector3} p
   * @param {number} radius  metres
   * @param {Array} out      preallocated; overwritten
   * @param {number} max     how many to keep
   * @returns {number} how many were written
   */
  nearby(p, radius, out, max = 6) {
    const r2 = radius * radius;
    let n = 0;
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i];
      if (c.disabled) continue;
      const dx = c.position.x - p.x;
      const dz = c.position.z - p.z;
      const dy = c.position.y - p.y;
      // Two storeys up or one down. Any further vertically and the marker is
      // about a room the player has no way to reach from here.
      if (dy > 8 || dy < -4.5) continue;
      const d2 = dx * dx + dz * dz + dy * dy;
      if (d2 > r2) continue;
      // Insertion sort into the fixed window: nearest first, longest dropped.
      let at = n < max ? n : max;
      while (at > 0 && out[at - 1] && out[at - 1]._d2 > d2) at--;
      if (at >= max) continue;
      for (let j = Math.min(n, max - 1); j > at; j--) out[j] = out[j - 1];
      c._d2 = d2;
      out[at] = c;
      if (n < max) n++;
    }
    return n;
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * THE SAME CRATE, OPENED BY A BOT
   * ══════════════════════════════════════════════════════════════════════════
   * "ここのメリットもっとAIに覚えさせて" — the merit has to be a merit for the AI
   * too, and until this method the errand had NO reward at all. `_orderCache`
   * walked a man to `stand`, he stood on it for `CACHE_DWELL` and he walked
   * away with exactly what he arrived with. What was measured was footfall.
   *
   * `take()` above is the PLAYER's path and it is not reusable, because every
   * verb in it belongs to `src/weapons` — `pickUpPrimary`, `resupplyGrenades`,
   * `scavenge` — and a bot's ammunition is `src/ai`'s (`Agent.reserve`), which
   * `weapons` has never heard of. So this is the same decision table addressed
   * to the other subsystem's hooks: `ai.resupply(actor, mags, grenades)`, whose
   * cap ("cannot exceed what he spawned with") is the same rule
   * `weapons.scavenge` applies to the player.
   *
   * WHAT A BOT CAN ACTUALLY BE HANDED, on this map, measured at boot rather
   * than assumed — and the honest answer is TWO of the four kinds:
   *
   *   ammo      seven of the eight ground-floor caches. Six or seven survive
   *             `prove()` depending on where the dressing dice fall.
   *   grenade   ONE (K2's ground floor). E1/E2's grenade stacks are on the
   *             SECOND floor and are the player's.
   *   weapon    NONE. Every one of the eight weapon racks is on floor 1, and
   *             `src/ai/nav.js` is a 2.5D height field — one floor per cell —
   *             so a stair is zero waypoints and no bot on this map can reach
   *             one. The branch below is written and it is dead today; it will
   *             stop being dead the day a rack is published on a ground floor,
   *             and NOT before. A bot cannot "take a weapon upgrade" here.
   *   vantage   NONE. All eight are `floor: 'roof'`. Same reason, same answer.
   *
   * That is the whole reachable set and it is why `_assignCacheLegs` ranks men
   * by ammunition and by frags and by nothing else: those are the two rewards
   * that exist.
   *
   * @returns {{rounds:number, grenade:boolean, weapon:boolean}|null} null when
   *          the man needed nothing, which must NOT burn the cooldown — the
   *          same rule `take()` applies to a player with a full pouch.
   */
  takeForBot(c, actor, ai, now) {
    if (!c || !actor || !ai || !this.ready(c, now)) return null;
    /**
     * A BOT CANNOT BE HANDED A MED KIT, AND THAT IS A BOUNDARY RATHER THAN AN
     * OMISSION. `Agent.health` is `src/ai`'s state and there is no `ai.heal`
     * hook on the list in ARCHITECTURE.md — `match` may no more write it than it
     * may write `weapons.reserve`, which is the whole reason `ai.resupply`
     * exists for ammunition and this method is a second decision table rather
     * than a copy of `take()`.
     *
     * So a med post is refused rather than faked, and `MatchSystem`'s
     * `MEDIC_KINDS` keeps `_assignCacheLegs` from sending anybody to one — an
     * errand whose reward is nothing is exactly the "pretend reward" this file
     * exists not to write. "敵味方関係なく使える" is a statement about SIDES and
     * it holds: neither team owns the post, and the human takes one whichever
     * team he is on.
     */
    if (c.kind === 'medic') return null;
    let rounds = 0;
    let grenade = false;
    if (c.kind === 'grenade') {
      const got = ai.resupply(actor, 1, RULES.cacheGrenades);
      rounds = got?.rounds ?? 0;
      grenade = !!got?.grenade;
    } else if (c.kind === 'weapon') {
      /**
       * A RACK IS A BOX OF ROUNDS TO A BOT AND NOTHING ELSE. `src/ai` has one
       * abstract weapon per variant — `weaponDamage`, `fireRate`, `spread` are
       * drawn from the persona, and there is no second gun for an agent to
       * swap onto. Handing him the rack's `weaponId` would change a number on
       * the HUD and nothing a player could see or hear, which is precisely the
       * kind of pretend reward this file exists to not write. Unreachable
       * today in any case. @see the table above.
       */
      const got = ai.resupply(actor, RULES.cacheAmmoMags, 0);
      rounds = got?.rounds ?? 0;
    } else {
      // `ammo` and `vantage` — both are a box of rounds, exactly as for the player.
      const got = ai.resupply(actor, RULES.cacheAmmoMags, 0);
      rounds = got?.rounds ?? 0;
    }
    if (rounds <= 0 && !grenade) return null;
    c.readyAt = now + RULES.cacheCooldown;
    this.stats.taken++;
    this.stats.botTakes++;
    if (rounds > 0) this.stats.ammo += rounds;
    if (grenade) this.stats.frags++;
    return { rounds, grenade, weapon: false };
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
   *
   * `kinds` is an optional Set: a man who is out of frags wants the grenade
   * stack and not the nearest crate of rounds, and a marksman who wants a
   * firing position wants a `vantage` and nothing else. Null means "any".
   * Passing one is how `_assignCacheLegs` expresses NEED rather than proximity.
   */
  nearestBotCache(point, claimed, maxDist, kinds = null) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (let i = 0; i < this.botList.length; i++) {
      const c = this.botList[i];
      if (c.disabled) continue;
      if (claimed.has(c)) continue;
      if (kinds && !kinds.has(c.kind)) continue;
      const d = c.stand.distanceToSquared(point);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** How many of the proved bot caches are of each kind. Reported, not gameplay. */
  botKindCounts() {
    const out = { ammo: 0, weapon: 0, grenade: 0, vantage: 0, medic: 0 };
    for (const c of this.botList) out[c.kind] = (out[c.kind] ?? 0) + 1;
    return out;
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * WHAT A MEDICAL ZONE LOOKS LIKE — and why `match` builds it rather than `world`
   * ══════════════════════════════════════════════════════════════════════════
   * The two promoted features already have `world`'s own `ammo` cache standing on
   * them — a pallet, two olive crates, an open one — because `world` published
   * them as ammunition and `world` is not being edited. A dressing station that
   * looked identical to a resupply dump would be the "inert painted square" that
   * `features.js`'s own note warns a new kind becomes.
   *
   * So the DRESSING is `match`'s, exactly as `SiteMarks` paints the capture
   * circles from resolved positions rather than authored ones: a ground disc, a
   * red cross on it, and a two-metre standard with a cross panel that reads from
   * the far end of the lane. Six boxes and a disc per post, merged into two
   * meshes, built once, disposed in `dispose()`. Nothing here is per frame.
   *
   * THE CROSS IS EMISSIVE. It is the only cue at 40 m down a shadowed flank lane
   * and the quality bar's "no uniform lighting" cuts both ways: a matte red
   * square on a grey street at dusk is invisible, which is the same failure
   * `ui.setCaches` exists to fix from the other end.
   *
   * @returns {THREE.Group|null} added to the scene by the caller, or null when
   *          no feature was promoted.
   */
  buildMedicMarkers() {
    // The cathedral med post is dressed by `buildCathedralPost` instead,
    // because its dressing has a lifecycle this group does not: it goes down
    // with the building. @see `setCathedralRazed`.
    const posts = this.list.filter((c) => c.kind === 'medic' && !c.cathedral);
    if (!posts.length) return null;
    const group = new THREE.Group();
    group.name = 'match-medzone';

    const lib = this.ctx.peek?.('materials') ?? null;
    const surface = (tint, name, emissive = 0x000000, eInt = 0) => {
      const set = lib?.getTextureSet?.(name) ?? null;
      const m = new THREE.MeshStandardMaterial({
        color: tint,
        roughness: 0.72,
        metalness: 0.04,
        emissive,
        emissiveIntensity: eInt,
        dithering: true,
      });
      m.name = `medzone_${name}`;
      if (set) {
        m.map = set.albedo;
        m.normalMap = set.normal;
        m.normalScale.set(0.7, 0.7);
        m.roughnessMap = set.orm;
      }
      return m;
    };
    // Two materials for the whole feature, so it is two draw calls however many
    // posts there are.
    const pale = surface(0xd9d6cc, 'plaster');
    const red = surface(0xb4231d, 'plaster', 0x5a0e0a, 0.85);

    const paleGeo = [];
    const redGeo = [];
    const box = (into, w, h, d, x, y, z, ry = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (ry) g.rotateY(ry);
      g.translate(x, y, z);
      into.push(g);
    };

    for (const c of posts) {
      const { x, y, z } = c.position;
      const yaw = c.yaw ?? 0;
      /**
       * THE GROUND PAINT. A disc rather than a ring: `RULES.cacheUseRadius` is
       * 2.6 m and the paint is 2.9, so the ground that is painted is very
       * nearly the ground the key works on — the same honesty `SiteMarks` keeps
       * between the capture paint and the capture radius.
       */
      const disc = new THREE.CircleGeometry(2.9, 28);
      disc.rotateX(-Math.PI / 2);
      disc.translate(x, y + 0.025, z);
      paleGeo.push(disc);
      // The cross on the ground, two bars, lifted a hair so it never z-fights.
      box(redGeo, 2.6, 0.02, 0.72, x, y + 0.05, z, yaw);
      box(redGeo, 0.72, 0.02, 2.6, x, y + 0.05, z, yaw);

      /**
       * THE STANDARD. Off the centre of the disc on the cache's own facing, so
       * it never stands between a man and the crate he is holding F on.
       */
      const px = x + Math.sin(yaw) * 2.15;
      const pz = z + Math.cos(yaw) * 2.15;
      box(paleGeo, 0.11, 2.35, 0.11, px, y + 1.17, pz);
      box(paleGeo, 0.62, 0.05, 0.62, px, y + 2.34, pz, yaw);
      // The panel, and the cross on it. Faces the lane, i.e. the cache's facing.
      box(paleGeo, 0.94, 0.94, 0.07, px, y + 2.05, pz, yaw);
      box(redGeo, 0.74, 0.2, 0.1, px, y + 2.05, pz, yaw);
      box(redGeo, 0.2, 0.74, 0.1, px, y + 2.05, pz, yaw);
    }

    const add = (geos, mat, name) => {
      // `mergeGeometries` disposes the sources it consumes — see its own note.
      const g = geos.length ? mergeGeometries(geos) : null;
      if (!g) return null;
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      // A 2 cm ground decal in the shadow cascades is shadow acne, nothing else.
      mesh.userData.owNoShadow = true;
      group.add(mesh);
      return mesh;
    };
    add(paleGeo, pale, 'match_medzone_pale');
    add(redGeo, red, 'match_medzone_cross');

    this.medGroup = group;
    this.medMaterials = [pale, red];
    return group;
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * THE CATHEDRAL CENTRE'S DRESSING — built by `match` for the same reason the
   * medical zone's is, with one extra fact: IT GOES DOWN WITH THE BUILDING
   * ══════════════════════════════════════════════════════════════════════════
   * `world`'s twenty-four features each stand on real authored geometry; these
   * two records stand on the cathedral's own floor, which `world` published
   * without a crate on it. So the crate is `match`'s, in the same visual
   * language as the med posts: a painted disc each, a low pallet of supply
   * boxes and a beacon mast on the supply side, the red-cross kit and standard
   * on the med side.
   *
   * DRAWN ONLY, DELIBERATELY. The crossing is capture point D's circle once
   * the church is razed, the boot bake holds BOTH cathedral forms solid, and
   * `_reprobeZoneNav` may only ever close a cell — so one solid box here would
   * subtract walkable cells from the exact point item "Dサイトが瓦礫に埋まりすぎ"
   * is about, permanently, in both states. Everything tall enough to matter is
   * a 0.11 m mast or a panel; everything with bulk is at or under the 0.42 m
   * the controller steps over. The med standards in `buildMedicMarkers` carry
   * no proxy either, so this is the established bargain, not a new one.
   *
   * Hidden (not disposed) by `setCathedralRazed`, because the round reset
   * stands the church — and the posts — back up.
   */
  buildCathedralPost() {
    const posts = this.list.filter((c) => c.cathedral);
    if (!posts.length) return null;
    const group = new THREE.Group();
    group.name = 'match-cathpost';

    const lib = this.ctx.peek?.('materials') ?? null;
    const surface = (tint, name, emissive = 0x000000, eInt = 0) => {
      const m = new THREE.MeshStandardMaterial({
        color: tint,
        roughness: 0.72,
        metalness: 0.04,
        emissive,
        emissiveIntensity: eInt,
        dithering: true,
      });
      m.name = `cathpost_${name}`;
      const set = lib?.getTextureSet?.(name) ?? null;
      if (set) {
        m.map = set.albedo;
        m.normalMap = set.normal;
        m.normalScale.set(0.7, 0.7);
        m.roughnessMap = set.orm;
      }
      return m;
    };
    const pale = surface(0xd9d6cc, 'plaster');
    const red = surface(0xb4231d, 'plaster', 0x5a0e0a, 0.85);
    const olive = surface(0x6b6a4f, 'plaster');

    const paleGeo = [];
    const redGeo = [];
    const oliveGeo = [];
    const box = (into, w, h, d, x, y, z, ry = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (ry) g.rotateY(ry);
      g.translate(x, y, z);
      into.push(g);
    };

    for (const c of posts) {
      const { x, y, z } = c.position;
      const yaw = c.yaw ?? 0;
      const disc = new THREE.CircleGeometry(2.0, 24);
      disc.rotateX(-Math.PI / 2);
      disc.translate(x, y + 0.025, z);
      paleGeo.push(disc);
      if (c.kind === 'medic') {
        // The med post: the medical zone's own iconography, on the crossing.
        box(redGeo, 1.9, 0.02, 0.55, x, y + 0.05, z, yaw);
        box(redGeo, 0.55, 0.02, 1.9, x, y + 0.05, z, yaw);
        const px = x + Math.sin(yaw) * 1.55;
        const pz = z + Math.cos(yaw) * 1.55;
        box(paleGeo, 0.11, 2.35, 0.11, px, y + 1.17, pz);
        box(paleGeo, 0.94, 0.94, 0.07, px, y + 2.05, pz, yaw);
        box(redGeo, 0.74, 0.2, 0.1, px, y + 2.05, pz, yaw);
        box(redGeo, 0.2, 0.74, 0.1, px, y + 2.05, pz, yaw);
        // the kit itself: a white chest with the cross on its lid, step-height
        box(paleGeo, 0.72, 0.34, 0.5, x, y + 0.17, z, yaw);
        box(redGeo, 0.4, 0.03, 0.14, x, y + 0.355, z, yaw);
        box(redGeo, 0.14, 0.03, 0.4, x, y + 0.355, z, yaw);
      } else {
        // The supply post: a pallet of olive crates and the beacon mast.
        box(paleGeo, 1.5, 0.12, 1.1, x, y + 0.06, z, yaw);
        box(oliveGeo, 0.78, 0.3, 0.5, x - 0.28, y + 0.27, z + 0.18, yaw + 0.12);
        box(oliveGeo, 0.6, 0.26, 0.44, x + 0.34, y + 0.25, z - 0.14, yaw - 0.2);
        box(oliveGeo, 0.5, 0.22, 0.36, x - 0.05, y + 0.53, z + 0.05, yaw + 0.5);
        const px = x - Math.sin(yaw) * 1.5;
        const pz = z - Math.cos(yaw) * 1.5;
        box(paleGeo, 0.11, 2.2, 0.11, px, y + 1.1, pz);
        // the beacon head, emissive red so it reads down the nave at dusk
        box(redGeo, 0.3, 0.3, 0.3, px, y + 2.28, pz, yaw + 0.4);
      }
    }

    const add = (geos, mat, name) => {
      const g = geos.length ? mergeGeometries(geos) : null;
      if (!g) return null;
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.userData.owNoShadow = true;
      group.add(mesh);
      return mesh;
    };
    add(paleGeo, pale, 'match_cathpost_pale');
    add(redGeo, red, 'match_cathpost_red');
    add(oliveGeo, olive, 'match_cathpost_olive');

    this.cathGroup = group;
    this.cathMaterials = [pale, red, olive];
    return group;
  }

  /** Free the medical zone and cathedral dressing. Everything else is data. */
  dispose() {
    if (this.medGroup) {
      this.medGroup.removeFromParent();
      this.medGroup.traverse((o) => o.geometry?.dispose?.());
      this.medGroup = null;
    }
    if (this.cathGroup) {
      this.cathGroup.removeFromParent();
      this.cathGroup.traverse((o) => o.geometry?.dispose?.());
      this.cathGroup = null;
    }
    for (const m of this.medMaterials ?? []) m.dispose();
    this.medMaterials = null;
    for (const m of this.cathMaterials ?? []) m.dispose();
    this.cathMaterials = null;
  }
}
