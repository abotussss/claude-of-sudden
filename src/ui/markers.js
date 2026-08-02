import * as THREE from 'three';
import { el, svg, setText, setStyle, setClass, Pool, ease, clamp, clamp01, metres } from './util.js';

const _v = new THREE.Vector3();

/**
 * How far a friendly tick is worth drawing. Past this a team-mate is somebody
 * else's problem and the mark is only clutter; the minimap still has him.
 */
const FRIEND_RANGE = 55;

/**
 * Projects a world point into HUD pixels.
 * Returns the shared scratch object — never held past the call site.
 */
const _proj = { x: 0, y: 0, dist: 0, behind: false, offscreen: false, angle: 0 };
function project(pos, camera, w, h, margin) {
  _v.copy(pos);
  const dist = _v.distanceTo(camera.position);
  _v.project(camera);
  const behind = _v.z > 1;
  let x = (_v.x * 0.5 + 0.5) * w;
  let y = (-_v.y * 0.5 + 0.5) * h;
  if (behind) {
    // mirror through the centre so the edge arrow points the correct way
    x = w - x;
    y = h - y;
  }
  const cx = w * 0.5;
  const cy = h * 0.5;
  let dx = x - cx;
  let dy = y - cy;
  const mx = w * 0.5 - margin;
  const my = h * 0.5 - margin;
  let off = behind;
  if (Math.abs(dx) > mx || Math.abs(dy) > my) {
    off = true;
    const s = Math.min(mx / (Math.abs(dx) || 1e-4), my / (Math.abs(dy) || 1e-4));
    dx *= s;
    dy *= s;
  }
  _proj.x = cx + dx;
  _proj.y = cy + dy;
  _proj.dist = dist;
  _proj.behind = behind;
  _proj.offscreen = off;
  _proj.angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  return _proj;
}

function diamond(parent) {
  const s = svg('svg', { viewBox: '0 0 16 16' }, parent);
  svg(
    'rect',
    {
      x: 3.2,
      y: 3.2,
      width: 9.6,
      height: 9.6,
      transform: 'rotate(45 8 8)',
      // currentColor so `updateObjectives` can tint a marker per item.
      fill: 'currentColor',
      stroke: 'rgba(6,20,28,.75)',
      'stroke-width': 1,
    },
    s
  );
  return s;
}

function chevron(parent) {
  const s = svg('svg', { viewBox: '0 0 16 16' }, parent);
  svg('path', { d: 'M8 1.5 14.4 13H1.6z', fill: 'currentColor', stroke: 'rgba(6,20,28,.7)', 'stroke-width': 1 }, s);
  return s;
}

function nadeGlyph(parent) {
  const s = svg('svg', { viewBox: '0 0 16 16' }, parent);
  svg('circle', { cx: 8, cy: 8, r: 5.4, fill: 'rgba(255,63,49,.95)', stroke: 'rgba(0,0,0,.5)', 'stroke-width': 1 }, s);
  svg('rect', { x: 7.2, y: 0.8, width: 1.6, height: 3.2, fill: 'rgba(255,63,49,.95)' }, s);
  return s;
}

/* --------------------------------------------------------------- caches ---
 * THE PICKUPS, IN THE WORLD. "武器落ち・グレネード補充・３０秒ビーコン、これらはもっと
 * ハイライトして、わかりやすいように ユーザーが気付けるように".
 *
 * Four kinds of cache stand on painted squares inside eight buildings and on
 * their roofs, and a player who never walked into the right room never found out
 * they exist. A glyph per kind rather than one dot: "there is a rifle upstairs"
 * and "there are frags upstairs" are different reasons to climb, and a marker
 * that cannot tell you which is only a reason to be curious once.
 */
function rackGlyph(parent) {
  const s = svg('svg', { viewBox: '0 0 16 16' }, parent);
  // A rifle silhouette: receiver, barrel, magazine, stock.
  svg('path', { d: 'M1.6 6.4h11.2v2H10l-.6 1.6H7.2L6.8 8.4H1.6z', fill: 'currentColor',
    stroke: 'rgba(6,20,28,.75)', 'stroke-width': .9 }, s);
  svg('rect', { x: 12.2, y: 6.9, width: 2.4, height: 1, fill: 'currentColor' }, s);
  svg('path', { d: 'M6.9 10h2.2l-.5 3.4H7.4z', fill: 'currentColor' }, s);
  return s;
}
function crateGlyph(parent) {
  const s = svg('svg', { viewBox: '0 0 16 16' }, parent);
  svg('rect', { x: 2.2, y: 5, width: 11.6, height: 7.4, fill: 'currentColor',
    stroke: 'rgba(6,20,28,.75)', 'stroke-width': 1 }, s);
  svg('path', { d: 'M2.2 8.2h11.6M8 5v7.4', stroke: 'rgba(6,20,28,.6)', 'stroke-width': 1 }, s);
  svg('rect', { x: 4.4, y: 3.2, width: 7.2, height: 1.6, fill: 'currentColor' }, s);
  return s;
}
function fragGlyph(parent) {
  const s = svg('svg', { viewBox: '0 0 16 16' }, parent);
  svg('circle', { cx: 8, cy: 9.4, r: 4.6, fill: 'currentColor',
    stroke: 'rgba(6,20,28,.75)', 'stroke-width': 1 }, s);
  svg('rect', { x: 7.1, y: 2.2, width: 1.8, height: 2.8, fill: 'currentColor' }, s);
  svg('path', { d: 'M9 2.6h3.2', stroke: 'currentColor', 'stroke-width': 1.4, fill: 'none' }, s);
  return s;
}
function nestGlyph(parent) {
  const s = svg('svg', { viewBox: '0 0 16 16' }, parent);
  svg('path', { d: 'M8 1.8 14 12.6H2z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }, s);
  svg('circle', { cx: 8, cy: 9.2, r: 1.8, fill: 'currentColor' }, s);
  return s;
}
/**
 * THE FIFTH KIND. 「医療ポイントはありますか？どういうUIになってる？」 — they exist,
 * and the answer to "what does the UI look like" was: an ammunition crate.
 * `match._publishCaches` publishes `kind: 'medic'` with the label MED KIT, and
 * `_cacheGlyph` was a four-entry table whose miss case is `?? 1` — the supply
 * crate. So a dressing station drew the same glyph as the ammo dump twelve
 * metres behind it and the only thing separating them was four characters of
 * 9 px text. A player scanning for health does not read labels, he reads
 * shapes, and there was no shape to read.
 *
 * A CROSS, and deliberately the ONE glyph in this file that is not
 * `currentColor` throughout: white arms on a red field is the single most
 * over-determined symbol in the visual language of any game, and it has to
 * survive being 17 px wide with a rifle in front of it. The field carries the
 * red so the mark still reads when the marker itself is dimmed on cooldown —
 * `.ow-cache.cold` greys `currentColor`, and a grey cross is a cross, whereas a
 * grey ammo crate is nothing.
 */
function medicGlyph(parent) {
  const s = svg('svg', { viewBox: '0 0 16 16' }, parent);
  svg('rect', { x: 1.4, y: 1.4, width: 13.2, height: 13.2, rx: 1.6,
    fill: '#e02b1c', stroke: 'rgba(6,20,28,.75)', 'stroke-width': 1 }, s);
  svg('path', { d: 'M6.5 3.4h3v3.1h3.1v3h-3.1v3.1h-3V9.5H3.4v-3h3.1z', fill: '#ffffff' }, s);
  return s;
}

/**
 * The impact reticle: a bracketed cross on the point that is about to stop
 * existing. Deliberately NOT the grenade glyph — a grenade is a thing you look
 * for on the floor, a strike is an AREA you have to not be in, and the two
 * calling for different actions have to look different.
 */
function airGlyph(parent) {
  const s = svg('svg', { viewBox: '0 0 24 24' }, parent);
  svg(
    'path',
    {
      d: 'M12 2.4V8.4M12 15.6v6M2.4 12h6M15.6 12h6',
      stroke: 'currentColor',
      'stroke-width': 2.1,
      'stroke-linecap': 'butt',
      fill: 'none',
    },
    s
  );
  svg('circle', { cx: 12, cy: 12, r: 2.6, fill: 'currentColor' }, s);
  return s;
}

/**
 * Everything anchored to a world position: objective markers with distance,
 * grenade danger indicators, and floating damage numbers.
 *
 * Off-screen targets are clamped to a rectangular ring inside the safe area and
 * their glyph swaps to a chevron pointing at the target — the same behaviour as
 * a CoD objective you have turned away from.
 */
export class WorldMarkers {
  constructor(parent, rng) {
    this.rng = rng;
    this.objRoot = el('div', 'ow-layer', parent);

    /* ------------------------------------------------------- friend or foe ---
     * "敵は…ハイライトって色つけるというより的だと認識できるようにして" — highlight the
     * enemy so he reads as a TARGET, not so he is a colour.
     *
     * A dot, a diamond and a tint are all the same statement: "something is
     * there". A target is a different statement, and it is made by GEOMETRY, not
     * by hue: four corner brackets the size of the man, held on him, with nothing
     * inside them. That is the shape a player has been taught to read as
     * "this one is being aimed at", it survives being 24 px wide because a corner
     * is two straight lines and a right angle rather than a legible glyph, and it
     * cannot be confused with the objective diamonds, the cache glyphs or the
     * incoming-air reticle, because none of those is a bracket.
     *
     * THE BRACKETS ARE DIVS, NOT AN SVG. The box has to be the projected size of
     * the figure, which means it is 240 px tall at 4 m and 26 px tall at 70 m — a
     * stroked SVG scaled non-uniformly through that range gives a 6 px line on one
     * edge and a hairline on the other. Four absolutely-placed corners with a
     * fixed border width are the same weight at every distance.
     *
     * IT IS THE SAME CONTACT RULE AS THE MINIMAP. The list comes from
     * `ai.getHudActors()`, which only reports a hostile somebody on the player's
     * side actually has line of sight to and drops him three seconds after that
     * is lost. `age` fades the bracket over those three seconds, so a contact you
     * have lost decays in front of you instead of tracking through a wall.
     *
     * FRIENDLIES GET THE OTHER HALF, and it is not brackets: a small cool tick
     * over the head. "A friendly must never read as hostile" needs a POSITIVE
     * mark on the friendly, because absence of brackets is ambiguous — the
     * bracket is line-of-sight gated, so no bracket can also mean "not spotted
     * yet". Different shape, different colour, different place on the body:
     * nothing about the two marks is interchangeable at any size.
     */
    this.tgtPool = new Pool(
      12,
      () => {
        const node = el('div', 'ow-tgt');
        for (const c of ['tl', 'tr', 'bl', 'br']) el('i', `ow-tgt-c ${c}`, node);
        el('b', 'ow-tgt-pip', node);
        node._key = '';
        node._lock = 0;
        return node;
      },
      this.objRoot
    );

    this.friendPool = new Pool(
      10,
      () => {
        const node = el('div', 'ow-fr');
        el('i', 'ow-fr-tick', node);
        return node;
      },
      this.objRoot
    );
    /** Slot bookkeeping for `updateTargets`; allocated once, never grown. */
    this._tgtClaimed = new Uint8Array(this.tgtPool.count);
    this._tgtDone = new Uint8Array(64);
    /**
     * The world positions bracketed THIS frame, so `updateObjectives` can drop a
     * marker that is standing on one of them. `match` publishes an enemy contact
     * as an objective diamond (`_publishEnemyMarkers`), which was the right call
     * when nothing better existed and is now a second red glyph inside the
     * brackets — at 70 m the diamond is bigger than the man it is pointing at.
     * The test is GEOMETRIC, not a name or a colour: an objective sitting within
     * 10 cm of a man we are already bracketing IS that man.
     */
    this._hostileAt = new Array(this.tgtPool.count).fill(null);
    this._hostileN = 0;

    this.objPool = new Pool(
      6,
      () => {
        const node = el('div', 'ow-mk');
        const gl = el('div', 'ow-mk-glyph', node);
        const dia = diamond(gl);
        const chev = chevron(gl);
        chev.style.display = 'none';
        const letter = el('div', 'ow-mk-letter', gl, 'A');
        const dist = el('div', 'ow-mk-dist', node, '0M');
        const name = el('div', 'ow-mk-name', node, '');
        node._dia = dia;
        node._chev = chev;
        node._letter = letter;
        node._dist = dist;
        node._name = name;
        return node;
      },
      this.objRoot
    );

    this.nadePool = new Pool(
      4,
      () => {
        const node = el('div', 'ow-nade');
        const ring = el('div', 'ow-nade-ring', node);
        const core = el('div', 'ow-nade-core', node);
        nadeGlyph(core);
        const label = el('div', 'ow-nade-label', node, 'GRENADE');
        node._ring = ring;
        node._label = label;
        node._pos = new THREE.Vector3();
        return node;
      },
      this.objRoot
    );

    /**
     * INCOMING AIR. Eight, because a salvo marks three impact points and a
     * bomber stick or a strafing line marks three or four along its axis, and
     * two events can be in the air across a round reset.
     */
    this.airPool = new Pool(
      8,
      () => {
        const node = el('div', 'ow-air');
        const ring = el('div', 'ow-air-ring', node);
        const core = el('div', 'ow-air-core', node);
        airGlyph(core);
        const chev = chevron(el('div', 'ow-air-chev', node));
        const label = el('div', 'ow-air-label', node, 'INCOMING');
        node._ring = ring;
        node._core = core;
        node._chev = chev.parentNode;
        node._label = label;
        node._pos = new THREE.Vector3();
        return node;
      },
      this.objRoot
    );

    /**
     * CACHES. Six is `RULES.cacheMarkerRange`'s worth on this map — one
     * building's four floors plus whatever is across the street — and `match`
     * hands over the nearest six, so the seventh is never the one you needed.
     */
    this.cachePool = new Pool(
      6,
      () => {
        const node = el('div', 'ow-cache');
        const gl = el('div', 'ow-cache-glyph', node);
        const glyphs = [rackGlyph(gl), crateGlyph(gl), fragGlyph(gl), nestGlyph(gl), medicGlyph(gl)];
        for (const g of glyphs) g.style.display = 'none';
        const chev = chevron(el('div', 'ow-cache-chev', node));
        const label = el('div', 'ow-cache-label', node, '');
        const sub = el('div', 'ow-cache-sub', node, '');
        node._glyphs = glyphs;
        node._chev = chev.parentNode;
        node._label = label;
        node._sub = sub;
        return node;
      },
      this.objRoot
    );
    /**
     * Kind -> index into `_glyphs`. `medic` is the fifth and it is the reason
     * this table stopped being allowed to have a miss case that draws a crate:
     * anything `match` invents from here on gets a glyph or gets a bug report.
     */
    this._cacheGlyph = { weapon: 0, ammo: 1, grenade: 2, vantage: 3, medic: 4 };

    /* -------------------------------------------------------- armour ---
     * THE HULL. 「戦車は相手チームの場合はハイライトしてわかりやすいように」
     *
     * SAME LANGUAGE AS THE INFANTRY BRACKET, ONE SIZE UP. The rule this file
     * already committed to is that a hostile is marked by GEOMETRY — four
     * corners the size of the thing, nothing inside them — and a tank is a
     * hostile, so it gets corners. Heavier arms and a hard rule across the top
     * of the box separate it from a man at a glance without inventing a second
     * visual grammar: the player does not have to learn anything to read it.
     *
     * ONLY THE OTHER SIDE'S. He asked for the ENEMY tank to be picked out, and
     * that is also the honest design: his own armour is a thing he walks behind,
     * not a thing he has to solve, and bracketing both would make the mark mean
     * "a tank" instead of "a threat".
     *
     * THE BAR IS THE POINT OF THE WHOLE MARK. A tank carries `RULES.tankHealth`
     * = 2600 and a rifle does single figures to it: without a state of health on
     * screen the player cannot tell "this is nearly dead, keep shooting" from
     * "you are wasting a magazine, leave", which is the only decision he
     * actually has in front of a hull.
     *
     * FOUR, because the map runs two sorties and a marker must survive a round
     * reset with both still on the field.
     */
    this.vehPool = new Pool(
      4,
      () => {
        const node = el('div', 'ow-veh');
        for (const c of ['tl', 'tr', 'bl', 'br']) el('i', `ow-veh-c ${c}`, node);
        const tag = el('div', 'ow-veh-tag', node);
        const label = el('div', 'ow-veh-l', tag, 'TANK');
        const track = el('div', 'ow-veh-track', tag);
        const fill = el('i', null, track);
        const dist = el('div', 'ow-veh-d', tag, '');
        const chev = chevron(el('div', 'ow-veh-chev', node));
        node._label = label;
        node._track = track;
        node._fill = fill;
        node._dist = dist;
        node._chev = chev.parentNode;
        node._tag = tag;
        return node;
      },
      this.objRoot
    );

    /* --------------------------------------------------------- drones ---
     * 「ドローンは向かってくるときにできればUIでわかりやすくして、ハイライトしてほしい
     *   ドローン自体をハイライトして 敵味方のドローンで色分けして」
     *
     * THE LOCK STRIP IS A CAPTION AND THIS IS THE THING. `dronelock.js` says a
     * drone has you, from which bearing and how long you have; it cannot say
     * WHICH SPECK, and the counter-play (shoot it, or get a roof between you)
     * needs the player to find a 0.62 m airframe against a bright sky. The
     * airframe carries a world-space halo of its own now — @see the note on
     * `HALO_FRIEND` in `src/match/drone.js` — and this is the other half: the
     * HUD mark, which does the two things the world ring cannot.
     *
     *   IT WORKS OFF SCREEN. A drone in a dive comes from behind more often
     *   than not. Clamped to the edge with a chevron, this is the only mark
     *   that points at one you are not looking at.
     *   IT CARRIES THE STATE OF ITS HEALTH. `Drones.HEALTH` is 60 — two rounds
     *   of an AK, three of a carbine — so "keep shooting, it is nearly down"
     *   is a real decision and needs a bar, exactly as the tank's does.
     *
     * SAME GRAMMAR AS THE TANK AND THE MAN, THIRD SIZE. A HOSTILE gets corner
     * brackets, because in this file corners have meant "this is a target" since
     * the infantry mark and a drone must not invent a fourth visual language.
     * A FRIENDLY gets a pip and nothing else: it is colour-coded because the
     * player asked to tell them apart, but it is not a thing he shoots, and
     * putting brackets on his own side's drone would be the same mistake as
     * bracketing his own armour.
     *
     * THE COLOURS ARE RELATIVE TO HIM. `hostile` is decided in `match` from
     * `playerTeam`, never from a team index — the `--friend` / `--enemy` split
     * `sitemark.js` and `_publishObjectives` fought for. This file only reads
     * the flag.
     *
     * SIX: `RULES.droneMaxAloft` is 4, the pool behind it is 5, and a mark has
     * to survive a round reset with a full sky.
     */
    this.dronePool = new Pool(
      6,
      () => {
        const node = el('div', 'ow-drn');
        for (const c of ['tl', 'tr', 'bl', 'br']) el('i', `ow-drn-c ${c}`, node);
        el('b', 'ow-drn-pip', node);
        const tag = el('div', 'ow-drn-tag', node);
        const label = el('div', 'ow-drn-l', tag, 'DRONE');
        const track = el('div', 'ow-drn-track', tag);
        const fill = el('i', null, track);
        const dist = el('div', 'ow-drn-d', tag, '');
        const chev = chevron(el('div', 'ow-drn-chev', node));
        node._label = label;
        node._fill = fill;
        node._dist = dist;
        node._chev = chev.parentNode;
        return node;
      },
      this.objRoot
    );
    /** Beat phase for the inbound mark, integrated so a pause freezes it. */
    this._drnT = 0;

    this.dnPool = new Pool(
      16,
      () => {
        const node = el('div', 'ow-dn');
        node._pos = new THREE.Vector3();
        return node;
      },
      this.objRoot
    );

  }

  /**
   * FRIEND OR FOE, IN THE WORLD.
   *
   * `list` is `ai.getHudActors()`' own preallocated records — read, never
   * retained: `{ position, friendly, alive, height, stance, age, name }`.
   * Nothing is allocated per frame; the pools and the corner elements are built
   * once in the constructor and the only per-frame writes are transforms,
   * widths and opacities.
   *
   * @param dt      seconds, for the lock-on wipe
   * @param list    ai.getHudActors()
   * @param camera  the world camera
   * @param fade    0..1 master opacity (0 hides the whole layer)
   */
  updateTargets(dt, list, camera, w, h, k, fade = 1) {
    const tgt = this.tgtPool.items;
    const fr = this.friendPool.items;
    const claimed = this._tgtClaimed;
    const done = this._tgtDone;
    /**
     * Projected height, in pixels, of a metre at `dist` — one divide instead of
     * a second `project()` per man. `camera.fov` is the VERTICAL fov.
     */
    const focal = (h * 0.5) / Math.tan(camera.fov * 0.5 * (Math.PI / 180));
    const margin = 8 * k;
    const on = !!list && fade > 0.01;

    /* ---- hostiles: brackets ------------------------------------------- */
    claimed.fill(0);
    done.fill(0);
    this._hostileN = 0;
    let nT = 0;
    if (on) {
      /**
       * TWO PASSES, so the lock-on wipe belongs to a MAN and not to a pool index.
       * Pass 0 gives every hostile back the slot that already held him (matched on
       * his name); pass 1 hands the leftovers whatever is free. Without this a man
       * dying re-indexes the list and every surviving bracket re-plays its wipe.
       * `claimed` is a preallocated Uint8Array — nothing is allocated here.
       */
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          if (!a || a.friendly || a.alive === false) continue;
          if (i >= done.length || done[i]) continue;
          const key = a.name || `#${i}`;
          let slot = -1;
          for (let s = 0; s < tgt.length; s++) {
            if (claimed[s]) continue;
            if (pass === 0) { if (tgt[s].node._key === key) { slot = s; break; } } else { slot = s; break; }
          }
          if (slot < 0) continue;
          claimed[slot] = 1;
          done[i] = 1;
          if (this._hostileN < this._hostileAt.length) this._hostileAt[this._hostileN++] = a.position;
          nT++;
          const it = tgt[slot];
          const node = it.node;
          if (!it.alive) { it.alive = true; setStyle(node, 'display', ''); }
          if (node._key !== key) { node._key = key; node._lock = 0; }
          node._lock = Math.min(1, node._lock + dt / 0.13);

          const p = project(a.position, camera, w, h, margin);
          // The record's position is at his feet, so the box grows UP from there.
          const tall = (a.height ?? 1.78) * (a.stance ?? 1);
          const px = Math.max(1, (focal * tall) / Math.max(p.dist, 0.4));
          /**
           * MINIMUM SIZE IS THE POINT. At 70 m the man is 10 px tall and a bracket
           * the size of the man is not a bracket, it is four dots. The box stops
           * shrinking at 26 px so a distant contact is still a mark you can find,
           * and stops growing at 300 px so a man at arm's length is not framed by
           * the whole screen.
           */
          const bh = clamp(px * 1.04, 26 * k, 300 * k);
          const bw = clamp(px * 0.46, 19 * k, 150 * k);
          const grow = 1 + (1 - ease.outCubic(node._lock)) * 0.55;   // brackets close in
          const gw = bw * grow;
          const gh = bh * grow;
          setStyle(node, 'width', `${gw.toFixed(1)}px`);
          setStyle(node, 'height', `${gh.toFixed(1)}px`);
          setStyle(node, 'transform',
            `translate(${(p.x - gw * 0.5).toFixed(1)}px,${(p.y - px * 0.52 - gh * 0.5).toFixed(1)}px)`);
          // The centre pip only exists while the figure is too small to BE a
          // figure; past ~34 px he is his own mark and a dot on his chest is just
          // something between the sights and the thing being shot at.
          setStyle(node, '--pip', px < 34 * k ? '1' : '0');
          setClass(node, 'edge', p.offscreen);
          // A contact goes stale over the three seconds `ai` keeps it. That is
          // information, so it fades instead of blinking out.
          const stale = clamp01(1 - (a.age ?? 0) / 3);
          setStyle(node, 'opacity',
            (fade * (0.34 + 0.66 * stale) * (0.5 + 0.5 * node._lock)).toFixed(3));
        }
      }
    }
    for (let i = 0; i < tgt.length; i++) {
      if (claimed[i] || !tgt[i].alive) continue;
      tgt[i].alive = false;
      tgt[i].node._key = '';
      tgt[i].node._lock = 0;
      setStyle(tgt[i].node, 'display', 'none');
    }

    /* ---- friendlies: a tick over the head ------------------------------ */
    let nF = 0;
    if (on) {
      for (let i = 0; i < list.length && nF < fr.length; i++) {
        const a = list[i];
        if (!a || !a.friendly || a.alive === false) continue;
        const p = project(a.position, camera, w, h, margin);
        if (p.offscreen || p.dist > FRIEND_RANGE) continue;
        const it = fr[nF++];
        if (!it.alive) { it.alive = true; setStyle(it.node, 'display', ''); }
        const tall = (a.height ?? 1.78) * (a.stance ?? 1);
        const px = (focal * tall) / Math.max(p.dist, 0.4);
        setStyle(it.node, 'transform',
          `translate(${p.x.toFixed(1)}px,${(p.y - px - 12 * k).toFixed(1)}px)`);
        setStyle(it.node, 'opacity', (fade * clamp01(1.2 - p.dist / FRIEND_RANGE) * 0.85).toFixed(3));
      }
    }
    for (let i = nF; i < fr.length; i++) {
      if (fr[i].alive) { fr[i].alive = false; setStyle(fr[i].node, 'display', 'none'); }
    }
    return nT;
  }

  /** @param {Array} list [{ position:Vector3, label:'A', name:'CAPTURE', color }] */
  updateObjectives(list, camera, w, h, k) {
    const items = this.objPool.items;
    let n = 0;
    const margin = 74 * k;
    if (list) {
      for (let i = 0; i < list.length && n < items.length; i++) {
        const o = list[i];
        if (!o?.position) continue;
        // Already bracketed as a hostile — see `_hostileAt`.
        let dup = false;
        for (let j = 0; j < this._hostileN; j++) {
          if (o.position.distanceToSquared(this._hostileAt[j]) < 0.01) { dup = true; break; }
        }
        if (dup) continue;
        const p = project(o.position, camera, w, h, margin);
        const it = items[n++];
        if (!it.alive) {
          it.alive = true;
          setStyle(it.node, 'display', '');
        }
        const node = it.node;
        setStyle(node, 'transform', `translate(${(p.x - 20 * k).toFixed(1)}px,${(p.y - 12 * k).toFixed(1)}px)`);
        setStyle(node, 'width', `${(40 * k).toFixed(1)}px`);
        setText(node._letter, o.label ?? '');
        setText(node._dist, metres(p.dist));
        setText(node._name, o.name ?? '');
        const edge = p.offscreen;
        /**
         * PER-MARKER COLOUR. `o.color` was accepted by every caller and then
         * never applied here, so a bomb site and an enemy contact rendered
         * identically — which makes an enemy marker worse than useless, because
         * it reads as another objective. The glyphs are authored with
         * `fill="currentColor"`, so setting the node's colour tints the diamond,
         * the chevron and the text together — the two glyph fills were
         * hardcoded cyan and are `currentColor` now.
         */
        setStyle(node, 'color', o.color ?? 'var(--cyan)');
        setStyle(node._dia, 'display', edge ? 'none' : '');
        setStyle(node._chev, 'display', edge ? '' : 'none');
        setStyle(node._letter, 'opacity', edge ? '0' : '1');
        if (edge) setStyle(node._chev, 'transform', `rotate(${p.angle.toFixed(1)}deg)`);
        // distant markers dim so a busy map doesn't turn into a wall of icons
        const fade = clamp01(1.15 - p.dist / 260) * (edge ? 0.72 : 1);
        setStyle(node, 'opacity', fade.toFixed(3));
      }
    }
    for (let i = n; i < items.length; i++) {
      if (items[i].alive) {
        items[i].alive = false;
        setStyle(items[i].node, 'display', 'none');
      }
    }
  }

  /**
   * THE CACHES NEAR YOU, DRAWN IN THE WORLD.
   *
   * `list` is `match`'s own preallocated view records — read, never retained:
   * `{ position, kind, label, ready, cooldown, inReach }`. Nothing is allocated
   * here; the pool and the glyphs are built once in the constructor.
   *
   * The rules the styling encodes, in order of how much a player needs them:
   *   IN REACH   full white, a breathing glyph and the word HOLD F. This is the
   *              one that answers "there is something here and it is a key".
   *   AVAILABLE  supply green with the kind and the range. A reason to walk.
   *   COOLING    dim, with the seconds. "Not now" is worth knowing; a marker
   *              that vanishes on cooldown just teaches you it was a ghost.
   */
  updateCaches(dt, list, camera, w, h, k) {
    this._cacheT = (this._cacheT ?? 0) + dt;
    const beat = 0.5 + 0.5 * Math.sin(this._cacheT * Math.PI * 3.2);
    const items = this.cachePool.items;
    /**
     * 96 px, and it is a MEASURED number: at 68 the cache the player is standing
     * at — which is below his eye line, so it clamps to the bottom edge — put its
     * glyph on the last scanline and its "HOLD F" off the screen entirely. The
     * marker for the crate you are touching was the one being cut off.
     */
    const margin = 96 * k;
    let n = 0;
    if (list) {
      for (let i = 0; i < list.length && n < items.length; i++) {
        const o = list[i];
        if (!o?.position) continue;
        const p = project(o.position, camera, w, h, margin);
        const it = items[n++];
        if (!it.alive) {
          it.alive = true;
          setStyle(it.node, 'display', '');
        }
        const node = it.node;
        // Centred ON the point, not hung down-right off it.
        setStyle(node, 'transform', `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,-50%)`);
        const gi = this._cacheGlyph[o.kind] ?? 1;
        for (let g = 0; g < node._glyphs.length; g++) {
          setStyle(node._glyphs[g], 'display', g === gi && !p.offscreen ? '' : 'none');
        }
        setStyle(node._chev, 'display', p.offscreen ? '' : 'none');
        if (p.offscreen) setStyle(node._chev, 'transform', `rotate(${p.angle.toFixed(1)}deg)`);
        setText(node._label, o.label ?? '');
        setText(
          node._sub,
          o.ready ? (o.inReach ? 'HOLD F' : metres(p.dist)) : `${Math.ceil(o.cooldown)}S`
        );
        setClass(node, 'reach', !!o.inReach && !!o.ready);
        setClass(node, 'cold', !o.ready);
        /**
         * A MED POST IS NOT A SUPPLY DUMP. The glyph carries the symbol; this
         * carries the two other things that make a marker findable in a street
         * full of them — the label goes white instead of supply-green, and it is
         * exempted from the distance dim below, because the whole complaint is
         * that these could not be found from where the player was standing.
         */
        const med = o.kind === 'medic';
        setClass(node, 'med', med);
        // The glyph breathes only when it is a key away: motion is the last thing
        // left that pulls an eye that is looking somewhere else, and spending it
        // on the six crates you cannot reach is spending it on nothing.
        const s = o.inReach && o.ready ? 1 + 0.16 * beat : 1;
        const far = med ? 1 : clamp01(1.25 - p.dist / 40);
        setStyle(node, 'opacity', (far * (o.ready ? 1 : 0.62)).toFixed(3));
        setStyle(node._label, 'transform', `scale(${s.toFixed(3)})`);
      }
    }
    for (let i = n; i < items.length; i++) {
      if (items[i].alive) {
        items[i].alive = false;
        setStyle(items[i].node, 'display', 'none');
      }
    }
  }

  /**
   * A HOSTILE HULL, BRACKETED.
   *
   * `list` is `match`'s own preallocated view records — read, never retained:
   * `{ position, hostile, name, health, maxHealth }`. Nothing is allocated here;
   * the pool is built once in the constructor.
   *
   * @param dt      seconds, for the bracket's close-in
   * @param list    match.setVehicles()' array, or null
   * @param camera  the world camera
   * @param fade    0..1 master opacity
   */
  updateVehicles(dt, list, camera, w, h, k, fade = 1) {
    const items = this.vehPool.items;
    const focal = (h * 0.5) / Math.tan(camera.fov * 0.5 * (Math.PI / 180));
    /**
     * 78 px, and it is the tag's height plus the top arm: the tag hangs ABOVE
     * the box, so a hull clamped to the top edge of the screen put its label off
     * the screen at anything under this. The bottom clamp is the same number for
     * symmetry — a tank below you down a hill is the same problem upside down.
     */
    const margin = 78 * k;
    let n = 0;
    if (list && fade > 0.01) {
      for (let i = 0; i < list.length && n < items.length; i++) {
        const v = list[i];
        // His own armour is cover, not a problem to solve. @see the pool's note.
        if (!v?.position || !v.hostile) continue;
        const p = project(v.position, camera, w, h, margin);
        const it = items[n++];
        if (!it.alive) { it.alive = true; it.t = 0; setStyle(it.node, 'display', ''); }
        it.t = Math.min(1, it.t + dt / 0.18);
        const node = it.node;

        /**
         * THE BOX IS THE HULL, not a fixed pixel size. 3.4 m of half-extent is
         * the measured envelope of the model — 7 m long, 3.5 m tall, and it
         * turns, so a single radius is the only honest answer to "how wide is
         * it from here" without asking `match` for a yaw the mark does not
         * otherwise need. The box is drawn WIDER THAN TALL because that is what
         * a tank is, and because a square would read as a very close man.
         */
        const px = Math.max(1, (focal * 3.4) / Math.max(p.dist, 0.6));
        // Bigger floor than the infantry bracket (26 px): at 180 m down a lane
        // the hull is 14 px and the thing that has to be legible is that it is
        // ARMOUR, which a 26 px square cannot say.
        const bw = clamp(px * 1.06, 40 * k, 420 * k);
        const bh = clamp(px * 0.62, 24 * k, 250 * k);
        const grow = 1 + (1 - ease.outCubic(it.t)) * 0.4;
        const gw = bw * grow;
        const gh = bh * grow;
        const edge = p.offscreen;
        setStyle(node, 'width', `${gw.toFixed(1)}px`);
        setStyle(node, 'height', `${gh.toFixed(1)}px`);
        setStyle(node, 'transform',
          `translate(${(p.x - gw * 0.5).toFixed(1)}px,${(p.y - gh * 0.5).toFixed(1)}px)`);
        setClass(node, 'edge', edge);
        setStyle(node._chev, 'display', edge ? '' : 'none');
        if (edge) setStyle(node._chev, 'transform', `rotate(${p.angle.toFixed(1)}deg)`);
        setText(node._label, v.name || 'TANK');
        setText(node._dist, metres(p.dist));
        const frac = clamp01((v.health ?? 1) / (v.maxHealth || 1));
        setStyle(node._fill, 'transform', `scaleX(${frac.toFixed(4)})`);
        // Under a third left is the only number on this mark that changes what
        // the player does, so it is the only one that changes colour.
        setClass(node, 'weak', frac < 0.34);
        setStyle(node, 'opacity', (fade * (0.55 + 0.45 * it.t) * (edge ? 0.8 : 1)).toFixed(3));
      }
    }
    for (let i = n; i < items.length; i++) {
      if (items[i].alive) {
        items[i].alive = false;
        items[i].t = 0;
        setStyle(items[i].node, 'display', 'none');
      }
    }
    return n;
  }

  /**
   * THE DRONES IN THE AIR, MARKED. @see the pool's note for what this is for
   * and why a friendly does not get brackets.
   *
   * `list` is `match`'s own preallocated view records — read, never retained:
   * `{ position, hostile, name, health, maxHealth, locked, diving }`. Nothing
   * is allocated here.
   *
   * @param dt      seconds, for the mark's close-in and the inbound beat
   * @param list    match.setDrones()' array, or null
   * @param camera  the world camera
   * @param fade    0..1 master opacity
   */
  updateDrones(dt, list, camera, w, h, k, fade = 1) {
    const items = this.dronePool.items;
    const focal = (h * 0.5) / Math.tan(camera.fov * 0.5 * (Math.PI / 180));
    this._drnT += dt;
    // Two beats: a slow one for a drone that has you, a fast one for a drone
    // that has already committed. Same information the lock strip's pulse and
    // the dive scream carry, for an eye that is on the sky.
    const slow = 0.72 + 0.28 * Math.abs(Math.sin(this._drnT * 5.5));
    const fast = 0.62 + 0.38 * Math.abs(Math.sin(this._drnT * 13));
    /** The tag hangs above the box; 70 px is its height plus the top arm. */
    const margin = 70 * k;
    let n = 0;
    if (list && fade > 0.01) {
      for (let i = 0; i < list.length && n < items.length; i++) {
        const v = list[i];
        if (!v?.position) continue;
        const p = project(v.position, camera, w, h, margin);
        const it = items[n++];
        if (!it.alive) { it.alive = true; it.t = 0; setStyle(it.node, 'display', ''); }
        it.t = Math.min(1, it.t + dt / 0.18);
        const node = it.node;

        /**
         * THE BOX IS THE AIRFRAME, with a FLOOR that is most of the point. 0.62 m
         * across is 7 px at 60 m and 3 px at 140 m — a true-size bracket on a
         * drone is a bracket you cannot see, which is the complaint. 34 px is
         * the smallest square that still reads as four corners rather than as a
         * dot, and it is what makes a drone at the top of the sky findable.
         */
        const px = Math.max(1, (focal * 0.62) / Math.max(p.dist, 0.6));
        const box = clamp(px * 1.6, 34 * k, 190 * k);
        const grow = 1 + (1 - ease.outCubic(it.t)) * 0.45;
        const s = box * grow;
        const edge = p.offscreen;
        setStyle(node, 'width', `${s.toFixed(1)}px`);
        setStyle(node, 'height', `${s.toFixed(1)}px`);
        setStyle(node, 'transform',
          `translate(${(p.x - s * 0.5).toFixed(1)}px,${(p.y - s * 0.5).toFixed(1)}px)`);
        setClass(node, 'edge', edge);
        setClass(node, 'friendly', !v.hostile);
        const inbound = !!v.locked && !!v.hostile;
        setClass(node, 'lock', inbound);
        setClass(node, 'dive', inbound && !!v.diving);
        setStyle(node._chev, 'display', edge ? '' : 'none');
        if (edge) setStyle(node._chev, 'transform', `rotate(${p.angle.toFixed(1)}deg)`);
        // INBOUND is the only word here that changes what the player does, so
        // it is the only one that replaces the name.
        setText(node._label, inbound ? (v.diving ? 'INBOUND' : 'DRONE LOCK') : v.name || 'DRONE');
        setText(node._dist, metres(p.dist));
        const frac = clamp01((v.health ?? 1) / (v.maxHealth || 1));
        setStyle(node._fill, 'transform', `scaleX(${frac.toFixed(4)})`);
        setClass(node, 'weak', frac < 0.5);
        const beat = inbound ? (v.diving ? fast : slow) : 1;
        // A friendly is present, not urgent: half the weight, so ten of them a
        // match never compete with the one that is hunting him.
        const own = v.hostile ? 1 : 0.5;
        setStyle(node, 'opacity',
          (fade * own * beat * (0.5 + 0.5 * it.t) * (edge ? 0.85 : 1)).toFixed(3));
      }
    }
    for (let i = n; i < items.length; i++) {
      if (items[i].alive) {
        items[i].alive = false;
        items[i].t = 0;
        setStyle(items[i].node, 'display', 'none');
      }
    }
    return n;
  }

  /** How many drone marks are live. For the harnesses. */
  get droneCount() {
    let n = 0;
    for (const it of this.dronePool.items) if (it.alive) n++;
    return n;
  }

  /** @param {number} fuse seconds until detonation */
  spawnGrenade(position, fuse = 2.4) {
    const it = this.nadePool.acquire();
    it.life = fuse;
    it.node._pos.copy(position);
    return it;
  }

  updateGrenades(dt, camera, w, h, k) {
    const items = this.nadePool.items;
    const margin = 56 * k;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.alive) continue;
      it.t += dt;
      if (it.t >= it.life) {
        this.nadePool.release(it);
        continue;
      }
      const node = it.node;
      const p = project(node._pos, camera, w, h, margin);
      setStyle(node, 'transform', `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`);
      const close = p.dist < 9;
      setText(node._label, close ? 'DANGER CLOSE' : 'GRENADE');
      // pulse rate ramps as the fuse burns down
      const remain = 1 - it.t / it.life;
      const rate = 2.2 + (1 - remain) * 5;
      const ph = (it.t * rate) % 1;
      const rs = 0.7 + 0.9 * ease.outCubic(ph);
      setStyle(node._ring, 'transform', `scale(${rs.toFixed(3)})`);
      setStyle(node._ring, 'opacity', (0.9 * (1 - ph)).toFixed(3));
      setStyle(node, 'opacity', clamp01(remain * 4).toFixed(3));
    }
  }

  /**
   * A POINT THAT IS ABOUT TO BE HIT FROM THE AIR.
   *
   * The whole complaint this answers is that an airstrike was indistinguishable
   * from nothing happening: the telegraph is 4.4 s of jet and whistle, and a
   * sound with no direction on a 114x141 m map tells you nothing you can act on.
   * So the impact point is drawn in the world for the length of the telegraph
   * with a ring that CONTRACTS onto it — a converging ring reads as something
   * arriving, an expanding one reads as something that already went off — and
   * with an edge chevron when it is behind you, so "get out of that area" is
   * legible from any facing.
   *
   * @param {THREE.Vector3} position where it lands
   * @param {number} life  seconds of telegraph left
   * @param {string} label short read: 'AIRSTRIKE', 'BOMBS', 'CANNON'
   */
  spawnDanger(position, life = 4.4, label = 'INCOMING') {
    const it = this.airPool.acquire();
    it.life = Math.max(0.35, life);
    it.node._pos.copy(position);
    // `s` is the Pool record's own string slot — the label is re-written every
    // frame (it changes to CLEAR THE AREA up close) so it is kept, not applied.
    it.s = label;
    return it;
  }

  updateDanger(dt, camera, w, h, k) {
    const items = this.airPool.items;
    const margin = 62 * k;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.alive) continue;
      it.t += dt;
      // Held for a beat past the impact, so the marker is still on the thing
      // that just went off rather than vanishing on the frame it matters most.
      if (it.t >= it.life + 0.85) {
        this.airPool.release(it);
        continue;
      }
      const node = it.node;
      const p = project(node._pos, camera, w, h, margin);
      setStyle(node, 'transform', `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`);
      const edge = p.offscreen;
      setStyle(node._core, 'display', edge ? 'none' : '');
      setStyle(node._chev, 'display', edge ? '' : 'none');
      setStyle(node._ring, 'display', edge ? 'none' : '');
      if (edge) setStyle(node._chev, 'transform', `rotate(${p.angle.toFixed(1)}deg)`);
      const u = clamp01(it.t / it.life);
      // Two rings' worth of travel over the telegraph, each one converging from
      // 3.4x onto the point. The rate doubles in the last third.
      const rate = u < 0.66 ? 1.1 : 2.2;
      const ph = (it.t * rate) % 1;
      const rs = 3.4 - 2.4 * ease.outCubic(ph);
      setStyle(node._ring, 'transform', `scale(${rs.toFixed(3)})`);
      setStyle(node._ring, 'opacity', (0.28 + 0.62 * ph).toFixed(3));
      setClass(node, 'close', p.dist < 22);
      setText(node._label, p.dist < 22 ? 'CLEAR THE AREA' : it.s || 'INCOMING');
      // Fade in fast, then out over the post-impact beat.
      const a =
        it.t > it.life ? clamp01(1 - (it.t - it.life) / 0.85) : clamp01(it.t / 0.14);
      setStyle(node, 'opacity', (a * (edge ? 0.85 : 1)).toFixed(3));
    }
  }

  /** @param {'hit'|'hs'|'kill'|'armour'} kind */
  spawnDamage(position, amount, kind = 'hit') {
    const it = this.dnPool.acquire();
    it.life = kind === 'kill' ? 1.25 : 0.95;
    it.node._pos.copy(position);
    it.a = this.rng.signed() * 16; // lateral drift
    it.b = 0.9 + this.rng.float() * 0.25;
    setText(it.node, Math.round(amount));
    setClass(it.node, 'hs', kind === 'hs');
    setClass(it.node, 'kill', kind === 'kill');
    setClass(it.node, 'armour', kind === 'armour');
    return it;
  }

  updateDamage(dt, camera, w, h, k) {
    const items = this.dnPool.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.alive) continue;
      it.t += dt;
      const u = it.t / it.life;
      if (u >= 1) {
        this.dnPool.release(it);
        continue;
      }
      const node = it.node;
      const p = project(node._pos, camera, w, h, 0);
      if (p.behind) {
        setStyle(node, 'opacity', '0');
        continue;
      }
      const rise = ease.outCubic(clamp01(u * 1.15)) * 42 * k * it.b;
      const drift = it.a * k * ease.outQuad(u);
      const pop = 1 + 0.35 * (1 - ease.outQuint(clamp01(u / 0.12)));
      setStyle(
        node,
        'transform',
        `translate(${(p.x + drift).toFixed(1)}px,${(p.y - rise).toFixed(1)}px) translate(-50%,-50%) scale(${pop.toFixed(3)})`
      );
      const a = u < 0.55 ? 1 : 1 - ease.inQuad((u - 0.55) / 0.45);
      setStyle(node, 'opacity', (a * clamp01(2.6 - p.dist / 90)).toFixed(3));
    }
  }

  clear() {
    this.nadePool.releaseAll();
    this.airPool.releaseAll();
    this.dnPool.releaseAll();
    this.tgtPool.releaseAll();
    this.friendPool.releaseAll();
    this.vehPool.releaseAll();
    this.dronePool.releaseAll();
    for (const it of this.tgtPool.items) { it.node._key = ''; it.node._lock = 0; }
  }

  /** How many hostiles are bracketed. For the harnesses; see `updateTargets`. */
  get targetCount() {
    let n = 0;
    for (const it of this.tgtPool.items) if (it.alive) n++;
    return n;
  }

  /** How many air-danger markers are live. For the HUD's own harnesses. */
  get dangerCount() {
    let n = 0;
    for (const it of this.airPool.items) if (it.alive) n++;
    return n;
  }

  dispose() {
    this.objRoot.remove();
  }
}
