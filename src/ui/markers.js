import * as THREE from 'three';
import { el, svg, setText, setStyle, setClass, Pool, ease, clamp, clamp01, metres } from './util.js';

const _v = new THREE.Vector3();

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
        const glyphs = [rackGlyph(gl), crateGlyph(gl), fragGlyph(gl), nestGlyph(gl)];
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
    /** Kind -> index into `_glyphs`. */
    this._cacheGlyph = { weapon: 0, ammo: 1, grenade: 2, vantage: 3 };

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

  /** @param {Array} list [{ position:Vector3, label:'A', name:'CAPTURE', color }] */
  updateObjectives(list, camera, w, h, k) {
    const items = this.objPool.items;
    let n = 0;
    const margin = 74 * k;
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
    const margin = 68 * k;
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
        setStyle(node, 'transform', `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`);
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
        // The glyph breathes only when it is a key away: motion is the last thing
        // left that pulls an eye that is looking somewhere else, and spending it
        // on the six crates you cannot reach is spending it on nothing.
        const s = o.inReach && o.ready ? 1 + 0.16 * beat : 1;
        setStyle(node, 'opacity', (clamp01(1.25 - p.dist / 40) * (o.ready ? 1 : 0.62)).toFixed(3));
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
