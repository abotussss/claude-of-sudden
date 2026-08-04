/**
 * MATCH — THE HIDDEN SQUAD. Where five men come out of, and when.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════════
 * 「先に４５０達成したら強制イベントで隠し部隊の登場で毎回敵側の隠し部隊が青が占領して
 *  いるエリア近くの屋内から５人ずつ登場させて 占領しているエリアからのみ そして占領を
 *  させて戦闘に参加させて そうすることで最後に膠着した試合にしたい」
 *  …and, from the second pass: 「敵側のみ出現させて隠し部隊は リスポーンなし」
 *
 * THE LAST CLAUSE IS THE SPECIFICATION AND THE REST IS THE SHAPE. What is being
 * asked for is not "more men": it is that a 450-point lead should stop being a
 * procession to 500. Everything below is tuned against that one sentence, and
 * the report that matters is not "five men arrived" — it is what the score did
 * for the next minute.
 *
 * ── WHY IT IS NEITHER OF THE TWO EVENTS THAT ALREADY EXIST ──
 *
 * `reinforce.js` is TEN MEN OUT OF THE SKY: an aircraft, a four-and-a-half
 * second telegraph, canopies, a landing on ground somebody already proved. It
 * is loud on purpose, it fires off the cathedral's collapse, and it lands on
 * open ground.
 *
 * `civilians.js` is TWENTY-FOUR PEOPLE IN THE BUILDINGS: no announcement, no
 * aircraft, placed on cells `NavGrid.indoor` calls a room and proved with a real
 * A*, holding doorways.
 *
 * THIS IS THE SECOND SHAPE AT THE SERVICE OF A SCORING PURPOSE. It comes out of
 * buildings, like the militia; it is five soldiers of a real side with a real
 * objective, like the drop; and unlike either it is triggered by the SCOREBOARD
 * and exists to bend it.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THE SPLIT — what this file owns and what `MatchSystem` owns
 * ════════════════════════════════════════════════════════════════════════════
 * Exactly the split `reinforce.js` already draws, for the same reason: `match`
 * is "the ONLY subsystem allowed to decide who is on which side … and where a
 * man respawns".
 *
 *   THIS FILE owns THE GROUND AND THE CLOCK. Which rooms exist, which of them
 *   are near a zone the side actually holds, which of those are reachable and
 *   unwatched, how far apart the five stand, how long between waves and how
 *   long between two men stepping out. It creates no soldier, reads no score
 *   and never learns which side the player is on.
 *
 *   `MatchSystem` owns THE TRIGGER, THE SIDE AND THE MAN. @see
 *   `_updateHiddenSquad` for 450 and for `1 - playerTeam`, and `_emergeHidden`
 *   for `ai.spawn`, the roster row and `noRespawn`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THE DECISIONS, AND WHAT EACH ONE IS DEFENDED BY
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── 1. "INDOORS" IS THE SAME MEASUREMENT `civilians.js` MAKES ──
 *
 * `NavGrid._carveInteriors` re-samples every cell inside an enterable building
 * from INSIDE it and sets `grid.indoor[i] = 1` for the ones genuinely in a room
 * — strictly, so the doorstep apron is excluded. That flag is the only honest
 * definition of indoors on this map, and `civilians.js:place` already buckets it
 * per building off `world.interiorVolumes`' oriented rects and finds 3715 room
 * cells doing it. `_census` below is that same pass, cell for cell.
 *
 * IT IS COPIED RATHER THAN SHARED, and that is a file-ownership fact rather than
 * a design one: `civilians.js` belongs to another pass of work and its census is
 * a private field. The two are the same measurement and must stay the same
 * measurement — if `_carveInteriors` ever changes what `indoor` means, both
 * files are wrong together rather than one of them silently right.
 *
 * ── 2. "NEAR A ZONE THEIR OWN SIDE HOLDS" IS A DISTANCE THAT WIDENS ──
 *
 * @see `NEAR_ZONE`. A zone is 8 m of paint on a 114 x 141 m map and there are
 * eight enterable buildings; a fixed radius either selects nothing for the flank
 * districts or selects the whole town for the cathedral. So each zone gets the
 * buildings within `NEAR_ZONE` of it, widening by `NEAR_STEP` until it has one,
 * and a zone that has none even at `NEAR_ZONE_MAX` simply is not a place this
 * event can come from — the wave uses another held zone and says so.
 *
 * ── 3. REACHABLE IS PROVED ONCE PER BUILDING, NOT ONCE PER MAN ──
 *
 * @see `_proveBuilding`. `civilians.js` runs a real A* per candidate cell and
 * notes what that costs: "the uncapped version is up to four hundred A* on the
 * frame a wave lands". A wave here is five men choosing between hundreds of
 * cells, so the proof is hoisted: ONE A* per (zone, building) pair, cached for
 * the match, and every cell afterwards is checked against the PROVED CELL'S NAV
 * COMPONENT — `comp[i] === comp[proved]` is O(1) and is a stronger statement
 * than a second A* would be, because two cells in one component are mutually
 * reachable by construction.
 *
 * ── 4. FIVE MEN AT ONCE IS A CROWDING EVENT, AND IT IS ANSWERED TWICE ──
 *
 * This project's original stuck epidemic was 22 of 29 bots frozen, most of it at
 * doorways, and `tools/stuckcheck.mjs` sits at a 2/41 baseline. So:
 *
 *   THEY DO NOT SHARE A CELL — `SPREAD` is enforced against every point already
 *   chosen for this wave, and a threshold cell is 0.8 m wide.
 *   THEY DO NOT SHARE A FRAME — `EMERGE_GAP` staggers the five over ~2.2 s,
 *   which is `reinforce.js`'s answer (`RULES.reinforceDropGap`, 0.62 s between
 *   touchdowns) applied to a door instead of a canopy.
 *
 * ── 5. NOBODY WATCHES A MAN APPEAR ──
 *
 * @see `_unwatched`, which is `civilians.js`'s test with one distinction added:
 * a man of the squad's OWN side standing in the room is a capsule to avoid, and
 * a man of the other side is a witness. The player is always a witness and gets
 * the sight-line test, because he is the only actor on the map with a camera.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ALLOCATION
 * ════════════════════════════════════════════════════════════════════════════
 * `update()` runs every frame while the event is armed and does nothing but
 * count down two timers. The wave itself allocates nothing: the five points are
 * preallocated `Vector3`s reused every wave, the candidate lists are built once
 * at `_census` / first use per zone, and the A* proof runs at most
 * `zones x buildings` times per match. Nothing here creates a mesh, a material
 * or a texture, so `dispose()` only drops references.
 */

import * as THREE from 'three';

/** A building with fewer room cells than this is not somewhere to put a man. */
const MIN_ROOM = 4;

/**
 * ════════════════════════════════════════════════════════════════════════════
 * HOW NEAR IS "NEAR THE AREA THEY HOLD"
 * ════════════════════════════════════════════════════════════════════════════
 * 「占領しているエリア近くの屋内から」, and the two halves of that pull opposite
 * ways: NEAR enough that a man walks out of a door onto the ground his side is
 * defending, and FAR enough that the rule can find a door at all.
 *
 * 34 m is the first ask, and it is read off the map rather than chosen: a zone
 * is `RULES.captureRadius` 8 m of paint, and the militia's own district rule
 * selects W2/W3/E2/E3 at 27 m from the cathedral's centre. 34 m is that plus a
 * street, i.e. "the block this point sits in", and a man crossing it under fire
 * is walking for about seven seconds.
 *
 * IT WIDENS, because there are only eight enterable buildings on a 114 x 141 m
 * map and A and B are deliberately 136 m out in the flank districts. A rule that
 * silently selected nothing for two zones in four would be a rule that fires
 * only when the cathedral is held. `NEAR_ZONE_MAX` is where it stops asking:
 * past that the men are not coming from the area, they are just coming from
 * indoors, and a zone with nothing inside that radius reports zero and the wave
 * draws on whatever else the side holds.
 */
const NEAR_ZONE = 34;
const NEAR_STEP = 6;
const NEAR_ZONE_MAX = 62;

/**
 * ════════════════════════════════════════════════════════════════════════════
 * HELD GROUND IS NOT ALL THE SAME GROUND — the front, not the back field
 * ════════════════════════════════════════════════════════════════════════════
 * MEASURED, and it is the difference between the event happening and the event
 * mattering. The first cut round-robined the five men over EVERY zone the side
 * held, which on seed 11 put three of five out of a building beside zone B —
 * the east flank district, 130 m from anything the leader owned and 100 m from
 * the nearest fight. They walked for the rest of the match. The leader went
 * 451 -> 501 at 1.25 points a second, which is his UNOPPOSED rate, and zone
 * ownership did not move once in forty seconds.
 *
 * A capture point is the only thing that prints points in this mode, so five
 * men who cannot reach one before the whistle are five men who cannot change
 * the score. The held zones are therefore ranked by HOW CLOSE THEY ARE TO
 * GROUND THIS SIDE DOES NOT OWN — the front line, measured rather than
 * authored — and the wave is drawn from the nearest `FRONT_ZONES` of them.
 *
 * TWO AND NOT ONE, because a side holding two points at the front should put
 * men on both: one is a column, two is a squeeze. And it is a RANKING rather
 * than a filter, so 「占領しているエリアからのみ」 is untouched — every candidate
 * is still a zone this side holds.
 */
const FRONT_ZONES = 2;

/**
 * Cells tried per man before he is given up on for this wave. Every one of them
 * is cheap — a distance test, a component compare and at most one sight line —
 * because the A* was paid once per building. @see `_proveBuilding`.
 */
const TRIES = 96;
/**
 * …AND THE FIRST `FRONT_TRIES` OF THEM ARE DRAWN FROM THE FRONT ZONES ONLY.
 *
 * The same shape `civilians.js:DOOR_TRIES` uses, for the same reason: the front
 * is a BIAS IN THE POOL and not a rule, so a front zone with one building whose
 * rooms are all occupied or all watched falls through to the rest of the held
 * ground on the later tries instead of losing the man. MEASURED without it:
 * waves of 3, 3, 3 and 1 against a `size` of 5 — 「５人ずつ」 with ten men short.
 */
const FRONT_TRIES = 56;
/**
 * METRES BETWEEN TWO MEN OF THE SAME WAVE. The lattice is 0.8 m and a door is
 * 1.12 m, so 3.6 m is four cells of separation: two men can be in one room and
 * cannot be in one doorway. @see the crowding note at the top of this file.
 */
const SPREAD = 3.6;
/** Seconds between two men stepping out. Five men span ~2.2 s. */
const EMERGE_GAP = 0.55;

/** No man of the other side within this, sight line or not. */
const CLEAR_FOE = 12;
/** …and not standing on top of one of his own, either. */
const CLEAR_MATE = 3.5;
/**
 * The player gets the strict test — this far away, OR with something between.
 * He is the only actor with a camera, so he is the only one who can be
 * astonished; a bot merely gets shot at.
 */
const CLEAR_PLAYER = 22;

/**
 * A WAVE THAT COULD NOT BE PLACED IS NOT A WAVE THAT DID NOT HAPPEN.
 * 「毎回」 — every time, not a dice roll — so a wave whose side holds nothing, or
 * whose rooms are all watched at that instant, comes back in `RETRY` seconds
 * rather than being spent. The only thing that can consume the programme is five
 * men actually stepping out of a building.
 */
const RETRY = 2;

export class HiddenSquad {
  /**
   * @param ctx   the engine context
   * @param opts  { rng, size, waves, gap, liveCap }
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.rng = opts.rng ?? ctx.rng.fork();
    /** Men per wave — 「５人ずつ」. */
    this.size = opts.size ?? 5;
    /** The CEILING on waves, not a programme length. @see `RULES.hiddenSquadWaves`. */
    this.waves = opts.waves ?? 6;
    /** Seconds between waves. @see `RULES.hiddenSquadWaveGap`. */
    this.gap = opts.gap ?? 10;
    /**
     * HOW MANY OF THEM MAY BE ON THEIR FEET AT ONCE, and it is the whole of what
     * makes a REPEATING event affordable. @see `RULES.hiddenSquadLive`.
     */
    this.liveCap = opts.liveCap ?? 15;

    /**
     * Called once per man, on the frame he steps out:
     * `onEmerge(indexInWave, position, yaw, wave)`. `match` makes the soldier.
     */
    this.onEmerge = null;
    /** Called once per wave, the moment its five points are chosen. */
    this.onWave = null;

    /* ---- the census, built once ---------------------------------------- */
    /** `rooms[b]` — walkable ground-storey cells genuinely inside building `b`. */
    this.rooms = [];
    /** Building indices worth considering at all (>= `MIN_ROOM` cells). */
    this._cand = [];
    /** The cathedral's volume index, which is excluded. @see `_census`. */
    this._cathIndex = -1;
    /** `zone.id` -> `{ list:[b], radius, proved:Map(b -> comp|-1) }`, lazily. */
    this._nearZone = new Map();
    this.placed = false;
    this._enabled = false;

    /* ---- the programme -------------------------------------------------- */
    /** The side the men belong to, handed in by `match`. -1 until armed. */
    this.team = -1;
    /** The event has been called and has waves left to play. */
    this.armed = false;
    /** Waves already put on the ground. */
    this.fired = 0;
    this._next = 0;
    /** Points chosen for the wave being emitted, and how many are left. */
    this._pts = [];
    this._yaw = [];
    this._queued = 0;
    this._emerged = 0;
    this._emergeIn = 0;

    /* ---- measurement ---------------------------------------------------- */
    this.stats = {
      /** Waves actually placed. */
      waves: 0,
      /** Men stepped out. */
      men: 0,
      /** Waves postponed because nothing could be placed, by reason. */
      noGround: 0,
      watched: 0,
      /** …and waves held back because the squad was already at `liveCap`. */
      full: 0,
      /** Men a wave wanted and could not find a room for. */
      short: 0,
      /**
       * WHY A CELL WAS REFUSED, so "a wave of three" is a diagnosis rather than
       * a shrug. Four counters and four increments; nothing else reads them.
       */
      rej: { comp: 0, far: 0, spread: 0, watched: 0 },
      /** A* proofs run, and how many failed. */
      proofs: 0,
      proofsFailed: 0,
      /** `[{ t, wave, zone, n, score }]`, filled by `match`. */
      log: [],
    };

    /* ---- scratch (nothing below is allocated after this) ---------------- */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._path = [];
    this._held = [];
    this._bag = [];
    for (let i = 0; i < 16; i++) {
      this._pts.push(new THREE.Vector3());
      this._yaw.push(0);
    }
  }

  /* ==================================================================== */
  /* the ground                                                           */
  /* ==================================================================== */

  /**
   * MEASURE THE TOWN'S ROOMS. Called once, on the first live frame — `ai.grid`
   * is what "indoors" MEANS here and it is built on a frame of `ai`'s choosing,
   * which is the same reason `civilians.place` and `caches.prove` are deferred.
   *
   * @param ai     the AI system, for `grid`
   * @param world  the world system, for `interiorVolumes`
   * @returns {number} room cells found in buildings worth using.
   */
  place(ai, world) {
    this.ai = ai;
    this.world = world;
    this.phys = this.ctx.peek('physics');
    this.placed = true;
    const g = ai?.grid;
    const vols = world?.interiorVolumes;
    this.rooms.length = 0;
    this._cand.length = 0;
    this._nearZone.clear();
    if (!g || !vols || !vols.length) {
      console.warn('[hidden] no nav grid or no interiors — the hidden squad has nowhere to come from');
      this._enabled = false;
      return 0;
    }
    const n = this._census(g, vols);
    /**
     * THE CHURCH IS NOT ONE OF THE BUILDINGS, for the reason `civilians.js`
     * gives and one more of its own. It BECOMES capture point D, so a squad
     * materialising inside it is a squad teleporting onto a live objective
     * rather than walking to one; and `world.cathedral.setRazed` takes the roof
     * off mid-match, which leaves cells `grid.indoor` was baked to call a room
     * standing in the open air. D as a ZONE is untouched by this — the
     * buildings round the church are exactly what "near D" selects.
     */
    const cathId = world?.cathedral?.id ?? null;
    for (let b = 0; b < vols.length; b++) if (vols[b].building === cathId) this._cathIndex = b;
    let cells = 0;
    for (let b = 0; b < this.rooms.length; b++) {
      if (b === this._cathIndex || this.rooms[b].length < MIN_ROOM) continue;
      this._cand.push(b);
      cells += this.rooms[b].length;
    }
    this._enabled = this._cand.length > 0;
    console.info(
      `[hidden] ${n} ground-floor room cells; ${this._cand.length} usable buildings ` +
        `(${this._cand.map((b) => vols[b].building).join(', ') || 'none'}) holding ${cells} cells; ` +
        `${this.waves} wave(s) of ${this.size} when a side first reaches the trigger`
    );
    return cells;
  }

  /**
   * ONE PASS OVER `grid.indoor`, BUCKETED BY BUILDING — the same pass
   * `civilians.js:place` makes, and deliberately the same one: `indoor` is set
   * only for cells INSIDE a footprint (never the doorstep apron), and which
   * building a cell belongs to is asked of the volume's own oriented rect, which
   * is the test `_carveInteriors` used to write the flag in the first place.
   */
  _census(g, vols) {
    for (let b = 0; b < vols.length; b++) this.rooms.push([]);
    let n = 0;
    for (let iz = 0; iz < g.nz; iz++) {
      for (let ix = 0; ix < g.nx; ix++) {
        const i = g.index(ix, iz);
        if (!g.indoor || g.indoor[i] !== 1 || g.flags[i] === 0) continue;
        const x = g.worldX(ix), z = g.worldZ(iz);
        for (let b = 0; b < vols.length; b++) {
          const v = vols[b];
          const dx = x - v.cx, dz = z - v.cz;
          const lx = dx * v.c - dz * v.s;
          const lz = dx * v.s + dz * v.c;
          if (Math.abs(lx) > v.hw || Math.abs(lz) > v.hd) continue;
          this.rooms[b].push(i);
          n++;
          break;
        }
      }
    }
    return n;
  }

  /**
   * THE BUILDINGS ROUND ONE ZONE, measured once per zone and kept for the match.
   * @see `NEAR_ZONE` for the widening and why it exists.
   *
   * Distance is the zone's centre to the building's NEAREST CORNER, exactly as
   * `civilians._district` measures it: a 20 x 36 m block across the street and a
   * 5 m shed across the street are the same neighbour and their centres are not.
   */
  _near(zone) {
    let rec = this._nearZone.get(zone.id);
    if (rec) return rec;
    const vols = this.world?.interiorVolumes ?? [];
    rec = { list: [], radius: 0, proved: new Map() };
    for (let r = NEAR_ZONE; ; r += NEAR_STEP) {
      rec.list.length = 0;
      for (const b of this._cand) {
        const v = vols[b];
        if (!v) continue;
        const d = Math.hypot(v.cx - zone.position.x, v.cz - zone.position.z) - Math.hypot(v.hw, v.hd);
        if (Math.max(0, d) <= r) rec.list.push(b);
      }
      rec.radius = r;
      if (rec.list.length > 0 || r >= NEAR_ZONE_MAX) break;
    }
    this._nearZone.set(zone.id, rec);
    console.info(
      `[hidden] zone ${zone.id}: ${rec.list.length} building(s) within ${rec.radius} m ` +
        `(${rec.list.map((b) => vols[b].building).join(', ') || 'none'})`
    );
    return rec;
  }

  /**
   * CAN A MAN WALK FROM THIS BUILDING ONTO THAT ZONE — asked with a real A*,
   * ONCE per (zone, building), and answered for every cell in the building
   * afterwards by its nav component.
   *
   * `z.stand` is the zone's standing ring, which `sites.js:standRing` has already
   * proved reachable from a spawn of each side, so a route from a room to a
   * standing point is a route from the room to the fight.
   *
   * @returns {number} the component id every usable cell must share, or -1.
   */
  _proveBuilding(zone, b, rec) {
    if (rec.proved.has(b)) return rec.proved.get(b);
    const g = this.ai.grid;
    const cells = this.rooms[b];
    const goal = zone.stand?.[0] ?? zone.position;
    let comp = -1;
    /**
     * UP TO THREE CELLS, NOT ONE. A single sample can land in a sealed pocket —
     * a stairwell head or a cupboard the lattice cut off — and answer "this
     * building is unreachable" for the whole match on the strength of it.
     */
    for (let k = 0; k < 3 && comp < 0; k++) {
      const i = cells[Math.floor((k + 0.5) * cells.length / 3) % cells.length];
      this._v.set(g.worldX(i % g.nx), g.floor[i], g.worldZ((i / g.nx) | 0));
      if (!Number.isFinite(this._v.y)) continue;
      this.stats.proofs++;
      if (g.findPath(this._v, goal, this._path) > 0) comp = g.comp ? g.comp[i] : 0;
      else this.stats.proofsFailed++;
    }
    rec.proved.set(b, comp);
    return comp;
  }

  /* ==================================================================== */
  /* the programme                                                        */
  /* ==================================================================== */

  /**
   * ARM IT. `match` calls this once, on the frame the score condition is first
   * met, with the side the men belong to. The first wave is placed on the next
   * `update` rather than here, so the whole event runs on one clock.
   */
  call(team) {
    if (!this._enabled || this.armed || team < 0) return false;
    this.team = team;
    this.armed = true;
    this.fired = 0;
    this._next = 0;
    this._queued = 0;
    this._emerged = 0;
    this._emergeIn = 0;
    return true;
  }

  /** A new match: forget the programme. The census is the LEVEL's and stays. */
  reset() {
    this.team = -1;
    this.armed = false;
    this.fired = 0;
    this._next = 0;
    this._queued = 0;
    this._emerged = 0;
    this._emergeIn = 0;
    const s = this.stats;
    s.waves = 0;
    s.men = 0;
    s.noGround = 0;
    s.watched = 0;
    s.full = 0;
    s.short = 0;
    s.rej.comp = s.rej.far = s.rej.spread = s.rej.watched = 0;
    s.log.length = 0;
  }

  /**
   * One frame. Two timers and nothing else until a wave actually lands.
   *
   * @param dt
   * @param live    the round is being played
   * @param zones   every live capture zone; only the ones this side OWNS are used
   * @param player  the local player, or null when he is dead
   * @param alive   how many of this squad are still on their feet, from `match`
   */
  update(dt, live, zones, player, alive = 0) {
    if (!this.armed || !live) return;

    /* ---- men already chosen, stepping out one at a time ---------------- */
    if (this._emerged < this._queued) {
      this._emergeIn -= dt;
      if (this._emergeIn > 0) return;
      this._emergeIn = EMERGE_GAP;
      const i = this._emerged++;
      this.stats.men++;
      this.onEmerge?.(i, this._pts[i], this._yaw[i], this.fired);
      return;
    }

    if (this.fired >= this.waves) {
      this.armed = false;
      return;
    }
    this._next -= dt;
    if (this._next > 0) return;

    /**
     * ════════════════════════════════════════════════════════════════════════
     * THE SQUAD IS A STANDING FIFTEEN, NOT A ONE-OFF OF FIFTEEN
     * ════════════════════════════════════════════════════════════════════════
     * 「そうすることで最後に膠着した試合にしたい」 is a statement about the whole of
     * the last minute, and three waves fired and forgotten is a spike. MEASURED
     * on the fixed-programme build: fifteen men arrived, thirteen were still
     * alive at the whistle, and the leader's rate did not move — because the
     * pressure existed for the twenty-eight seconds it took to deliver and then
     * stopped being renewed while the men walked.
     *
     * So the programme is not a length, it is a LEVEL: a wave whenever the
     * squad is under `liveCap`, up to `waves` of them, for as long as the match
     * runs. NO MAN COMES BACK — 「リスポーンなし」 is untouched and is what makes
     * this bounded: the cap is filled by NEW men out of a building, and the
     * ceiling on live actors is `liveCap`, exactly the peak the fixed three
     * waves already had. What changes is that the pressure is still there at the
     * whistle instead of having been spent at t+28.
     *
     * A wave held back this way is NOT spent — `fired` does not move — so the
     * total is a ceiling on arrivals rather than on attempts.
     */
    if (alive >= this.liveCap) {
      this.stats.full++;
      this._next = RETRY;
      return;
    }

    const n = this._pickWave(zones, player);
    if (n <= 0) {
      // 「毎回」. A wave that could not be placed is retried, never spent.
      this._next = RETRY;
      return;
    }
    this.fired++;
    this.stats.waves++;
    this._queued = n;
    this._emerged = 0;
    this._emergeIn = 0;
    this._next = this.gap;
    this.onWave?.(this.fired, n, this._waveZone);
  }

  /**
   * CHOOSE WHERE FIVE MEN COME OUT. Held zones only, buildings near them only,
   * proved cells only, and never on top of anybody.
   *
   * The zones are walked ROUND-ROBIN rather than best-first, so a side holding
   * two points puts men on both instead of stacking the wave on one — which is
   * the difference between a counter-attack and a garrison.
   *
   * @returns {number} how many points ended up in `_pts`.
   */
  _pickWave(zones, player) {
    const g = this.ai?.grid;
    if (!g || !zones?.length) return 0;
    /** 「占領しているエリアからのみ」 — held ground, and nothing else. */
    const held = this._held;
    held.length = 0;
    for (const z of zones) if (z.owner === this.team && z.stand?.length) held.push(z);
    if (!held.length) {
      this.stats.noGround++;
      return 0;
    }
    /**
     * …AND THE FRONT OF IT FIRST. @see `FRONT_ZONES`. Each held zone is scored
     * by its distance to the nearest zone this side does NOT own; the list is
     * insertion-sorted (three to five entries, allocating nothing) and the wave
     * is drawn from the first `FRONT_ZONES`.
     */
    for (const z of held) {
      let d = Infinity;
      for (const o of zones) {
        if (o.owner === this.team) continue;
        const dd = Math.hypot(o.position.x - z.position.x, o.position.z - z.position.z);
        if (dd < d) d = dd;
      }
      z._hiddenFront = d;
    }
    for (let i = 1; i < held.length; i++) {
      const z = held[i];
      let j = i - 1;
      while (j >= 0 && held[j]._hiddenFront > z._hiddenFront) { held[j + 1] = held[j]; j--; }
      held[j + 1] = z;
    }
    const front = Math.min(FRONT_ZONES, held.length);

    let got = 0;
    let watched = 0;
    this._waveZone = '';
    for (let man = 0; man < this.size; man++) {
      let placed = false;
      for (let t = 0; t < TRIES && !placed; t++) {
        // Round-robin over the FRONT held zones, offset by the man so a wave
        // spreads over both of them instead of stacking on one — and over ALL
        // of the side's held ground once the front has had its tries.
        const zone = held[(man + t) % (t < FRONT_TRIES ? front : held.length)];
        const rec = this._near(zone);
        if (!rec.list.length) continue;
        const b = rec.list[this.rng.int(0, rec.list.length - 1)];
        const comp = this._proveBuilding(zone, b, rec);
        if (comp < 0) continue;
        const cells = this.rooms[b];
        const i = cells[this.rng.int(0, cells.length - 1)];
        if (g.comp && g.comp[i] !== comp) { this.stats.rej.comp++; continue; }
        const y = g.floor[i];
        if (!Number.isFinite(y)) continue;
        const p = this._v.set(g.worldX(i % g.nx), y, g.worldZ((i / g.nx) | 0));
        /**
         * THE MAN HAS TO BE NEAR THE ZONE, NOT MERELY IN A BUILDING THAT IS.
         * The building test measures the zone's centre to the footprint's
         * NEAREST CORNER, and a 20 x 36 m block has room cells 25 m behind that
         * corner: measured on the first build, men were coming out 43-51 m from
         * a zone selected at 34. The cell gets the same radius the building was
         * chosen at, which can never empty a building out — the cells beside
         * the near corner are inside it by construction.
         */
        if (Math.hypot(p.x - zone.position.x, p.z - zone.position.z) > rec.radius) {
          this.stats.rej.far++;
          continue;
        }
        let clash = false;
        for (let k = 0; k < got && !clash; k++) if (this._pts[k].distanceTo(p) < SPREAD) clash = true;
        if (clash) { this.stats.rej.spread++; continue; }
        if (!this._unwatched(p, player)) { watched++; this.stats.rej.watched++; continue; }
        this._pts[got].copy(p);
        /**
         * FACING THE GROUND HE IS ABOUT TO WALK ONTO. `Agent` re-aims the
         * instant he has a target, so this only decides where he is looking on
         * the way out of the door — and looking at the point his side holds is
         * looking at whoever is coming for it.
         */
        this._yaw[got] = Math.atan2(zone.position.x - p.x, zone.position.z - p.z);
        got++;
        placed = true;
        if (!this._waveZone.includes(zone.id)) {
          this._waveZone = this._waveZone ? `${this._waveZone}+${zone.id}` : zone.id;
        }
      }
      if (!placed) this.stats.short++;
    }
    if (!got && watched) this.stats.watched++;
    return got;
  }

  /**
   * NOBODY WATCHES A MAN APPEAR. Three tests, and the distinction between the
   * first two is the whole of it: a soldier of the OTHER side is a witness with
   * a rifle, a soldier of his OWN side is a capsule not to spawn inside.
   */
  _unwatched(p, player) {
    const ag = this.ai.agents;
    for (let i = 0; i < ag.length; i++) {
      const a = ag[i];
      if (!a.alive) continue;
      // The militia are a third faction and hostile to everybody; they are
      // witnesses, not team-mates. `teamOf` is the published hook for the rest.
      const mate = a.aiCivil !== true && this.ai.teamOf(a) === this.team;
      if (a.position.distanceTo(p) < (mate ? CLEAR_MATE : CLEAR_FOE)) return false;
    }
    if (player && !player.dead && player.position) {
      const d = player.position.distanceTo(p);
      if (d < CLEAR_FOE) return false;
      if (d < CLEAR_PLAYER && this.phys) {
        this._eye.copy(this.ctx.camera.position);
        this._v2.set(p.x, p.y + 1.4, p.z);
        if (this.phys.lineOfSight(this._eye, this._v2, this.phys.MASK.SIGHT)) return false;
      }
    }
    return true;
  }

  report() {
    const s = this.stats;
    return (
      `[hidden] ${s.waves}/${this.waves} wave(s), ${s.men} men out · ` +
      `short ${s.short} · deferred: no held ground ${s.noGround}, all watched ${s.watched}, ` +
      `at the live cap ${s.full} · ` +
      `cells refused: ${s.rej.comp} unreachable, ${s.rej.far} too far, ` +
      `${s.rej.spread} too close, ${s.rej.watched} watched · ` +
      `A* proofs ${s.proofs} (${s.proofsFailed} failed) · ` +
      s.log.map((e) => `w${e.wave}@${e.t}s ${e.zone} x${e.n} ${e.score}`).join(' | ')
    );
  }

  dispose() {
    this.rooms.length = 0;
    this._cand.length = 0;
    this._nearZone.clear();
    this._path.length = 0;
    this.onEmerge = null;
    this.onWave = null;
  }
}
