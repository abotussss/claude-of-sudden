import { el, svg, setText, setStyle, setClass, damp, ease, mmss } from './util.js';
import { MAPS, getMapInfo } from '../core/config.js';

/** sessionStorage key: "the last thing that happened was a map change". */
const HANDOFF = 'ow:map-deploy';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * MAP SELECT — 「マップを選べるようにしてくれ」
 * ════════════════════════════════════════════════════════════════════════════
 * There are two maps and until this screen the only way to reach the second one
 * was `?map=plains` in the address bar. This is the picker.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY IT RELOADS THE PAGE, WHICH IS THE WHOLE DESIGN
 * ──────────────────────────────────────────────────────────────────────────
 * A map is chosen at BOOT and cannot be swapped live. The geometry, the nav
 * grid, the demolitions, the tank routes and the air war are all baked in
 * `world.build()`, and `applyMapRules` in src/match/rules.js is FORWARD ONLY —
 * its own note says applying `plains` and then `town` does not restore the
 * town's numbers, because a map with no entry has nothing to restore them from.
 * A live swap would therefore silently run one map's geometry under the other
 * map's rules, which is worse than not offering the control.
 *
 * So this navigates: it sets `?map=` on the CURRENT url (every other parameter
 * is preserved verbatim — `?map=plains&capture=1` keeps its capture flag) and
 * calls `location.replace`. The reload is a deliberate, announced part of the
 * flow rather than something that looks like a crash:
 *
 *   1. the footer says so before you touch anything;
 *   2. choosing the map that is already running just closes the screen —
 *      no reload for a no-op;
 *   3. choosing the other one paints a DEPLOYING panel naming the map, holds
 *      it for a beat so it is actually seen, and only then navigates;
 *   4. it leaves a note in sessionStorage, and the boot on the other side
 *      raises a banner with the map's name — so the black boot screen is
 *      bracketed by "leaving for NACHTFELD" and "NACHTFELD".
 *
 * This is exactly what `PauseMenu.setQuality` already does with `?q=`, for the
 * same reason (half a graphics preset is only readable at boot).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * HOW A PLAYER REACHES IT
 * ──────────────────────────────────────────────────────────────────────────
 *   M              any time, including the moment the page has loaded and
 *                  before the pointer has ever been locked — i.e. WITHOUT
 *                  first being in a match. `KeyM` is bound to nothing.
 *   pause menu     ESC → the MAP row, which names the map you are on.
 *   the hint       a one-line prompt under the HUD before the first click,
 *                  so the key is discoverable. It retires the moment you
 *                  take pointer lock, and it is never built in capture mode.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHO OWNS THE FREEZE
 * ──────────────────────────────────────────────────────────────────────────
 * Opened from the pause menu the menu is still up underneath and still owns
 * `time.scale`; this screen must not touch it or closing in the wrong order
 * would resume the game with the menu open. Opened on its own it is a modal in
 * its own right and freezes/releases exactly like `PauseMenu`. `show(fromMenu)`
 * is the switch. @see PauseMenu.show
 *
 * The card art is an SVG schematic drawn from the normalised layout in
 * `MAPS` — no images, nothing baked, and the zone dots are the real zone
 * positions so the two maps do not look like the same rectangle twice.
 *
 * Colour: amber accent and ink, and deliberately NO `--friend`/`--enemy`.
 * Those two mean "relative to RULES.playerTeam" everywhere else on this HUD
 * and there is no team on a map card; borrowing them here would be the third
 * time this repo painted something by the wrong index.
 */
export class MapSelect {
  /**
   * @param {HTMLElement} parent  the ui root — this stacks above the pause menu
   * @param {HTMLElement} hintParent  chrome layer for the boot hint, or null
   */
  constructor(parent, ctx, hintParent = null) {
    this.ctx = ctx;
    this.root = el('div', 'ow-mapsel', parent);
    const inner = el('div', 'ow-mapsel-inner', this.root);

    const head = el('div', 'ow-mapsel-head', inner);
    el('h1', null, head, 'SELECT MAP');
    el('div', 'sub', head, 'DEPLOYMENT');
    el('div', 'rule', inner);

    this.cards = [];
    const grid = el('div', 'ow-mapsel-grid', inner);
    for (const m of MAPS) this.cards.push(this._card(grid, m));

    el(
      'div',
      'ow-mapsel-foot',
      inner,
      'A MAP IS CHOSEN AT BOOT · CHANGING IT RELOADS THE GAME AND RESTARTS THE MATCH'
    );

    const btns = el('div', 'ow-btns', inner);
    this.backBtn = el('button', 'ow-btn', btns, 'Back');
    this.backBtn.type = 'button';
    this.backBtn.addEventListener('click', () => this.close());
    el('div', 'hint', inner, 'ESC BACK · M MAP');

    // The DEPLOYING curtain. Built once, hidden; shown for a beat before the
    // navigation so the reload is something the player watched start.
    this.deploy = el('div', 'ow-mapsel-deploy', inner);
    this.deployName = el('div', 'n', this.deploy, '');
    this.deploySub = el('div', 's', this.deploy, 'DEPLOYING · RELOADING THE GAME');
    setStyle(this.deploy, 'display', 'none');

    /**
     * The discoverability line. Only ever built outside capture mode: the pixel
     * gate in tools/baseline.mjs shoots `?capture=1`, and a new element on the
     * HUD would change every one of its eleven reference frames.
     */
    this.hint = null;
    this._hintDone = ctx.config?.deterministic ?? false;
    if (hintParent && !this._hintDone) {
      this.hint = el('div', 'ow-maphint', hintParent, '');
      setStyle(this.hint, 'display', 'none');
    }

    this.open = false;
    this.shown = 0;
    this._timer = 0;
    this._fromMenu = false;
    setStyle(this.root, 'display', 'none');
    setStyle(this.root, 'cursor', 'default');
  }

  /* ------------------------------------------------------------- build --- */

  _card(grid, m) {
    const card = el('button', 'ow-mapcard', grid);
    card.type = 'button';
    card.dataset.mid = m.id;

    const artWrap = el('div', 'art', card);
    this._art(artWrap, m.art);

    const top = el('div', 'top', card);
    el('div', 'name', top, m.name);
    const live = el('div', 'live', top, 'DEPLOYED');
    el('div', 'sub', card, m.sub);

    const facts = el('div', 'facts', card);
    this._fact(facts, 'SCORE', String(m.scoreTarget));
    this._fact(facts, 'CLOCK', mmss(m.matchTime));
    this._fact(facts, 'LIGHT', m.light);

    el('div', 'note', card, m.note);

    card.addEventListener('click', () => this.choose(m.id));
    return { id: m.id, root: card, live };
  }

  _fact(parent, label, value) {
    const f = el('div', 'f', parent);
    el('div', 'k', f, label);
    el('div', 'v', f, value);
  }

  /**
   * The schematic. 100x100 user units; normalised -1..1 maps to 6..94 so the
   * outermost zone dot never clips its own stroke.
   */
  _art(parent, a) {
    const s = svg('svg', { viewBox: '0 0 100 100', class: 'ow-mapart' }, parent);
    /** normalised -1..1 -> user units, 6..94 */
    const P = (n) => 50 + n * 44;
    const f = (n) => n.toFixed(2);

    svg('rect', { x: 2, y: 2, width: 96, height: 96, class: 'frame' }, s);

    if (a.ring) {
      // The mountain bowl: it IS the boundary on the plain, so it is the first
      // thing drawn and the widest.
      svg('circle', { cx: 50, cy: 50, r: 45, class: 'ring' }, s);
      svg('circle', { cx: 50, cy: 50, r: 38, class: 'ring in' }, s);
    } else {
      // The town's street grid, which is what its play space actually is.
      for (const [x1, y1, x2, y2] of [
        [8, 50, 92, 50],
        [50, 8, 50, 92],
        [8, 26, 92, 26],
        [8, 74, 92, 74],
      ])
        svg('line', { x1, y1, x2, y2, class: 'street' }, s);
    }

    for (const [cx, cz, w, h] of a.blocks)
      svg(
        'rect',
        {
          x: f(P(cx) - (w * 44) / 2),
          y: f(P(cz) - (h * 44) / 2),
          width: f(w * 44),
          height: f(h * 44),
          class: 'block',
        },
        s
      );

    for (const b of a.fires)
      svg(
        'circle',
        { cx: f(50 + Math.cos(b) * 41.5), cy: f(50 + Math.sin(b) * 41.5), r: 3.4, class: 'fire' },
        s
      );

    for (const [x, z] of a.bases)
      svg('rect', { x: f(P(x) - 4), y: f(P(z) - 4), width: 8, height: 8, class: 'base' }, s);

    if (a.landmark) {
      const [cx, cz, w, h] = a.landmark;
      const px = P(cx);
      const py = P(cz);
      const hw = (w * 44) / 2;
      const hh = (h * 44) / 2;
      svg(
        'rect',
        { x: f(px - hw), y: f(py - hh), width: f(hw * 2), height: f(hh * 2), class: 'landmark' },
        s
      );
      svg(
        'polygon',
        {
          points: `${f(px - hw)},${f(py - hh)} ${f(px)},${f(py - hh - 7)} ${f(px + hw)},${f(py - hh)}`,
          class: 'landmark',
        },
        s
      );
    }

    for (const [x, z] of a.zones)
      svg('circle', { cx: f(P(x)), cy: f(P(z)), r: 4.6, class: 'zone' }, s);
  }

  /* ------------------------------------------------------------ choose --- */

  /** The id actually running: the built level, falling back to what boot asked for. */
  currentId() {
    return this.ctx.peek?.('world')?.level?.id ?? this.ctx.config?.map ?? MAPS[0].id;
  }

  choose(id) {
    if (this._timer) return; // already leaving
    if (id === this.currentId()) {
      this.close();
      return;
    }
    const info = getMapInfo(id);
    if (!info) return;

    setText(this.deployName, info.name);
    setStyle(this.deploy, 'display', '');
    for (const c of this.cards) setStyle(c.root, 'pointer-events', 'none');

    let href = null;
    try {
      const url = new URL(location.href);
      url.searchParams.set('map', id);
      href = url.toString();
      sessionStorage.setItem(HANDOFF, info.name);
    } catch {
      /* file:// or a sandboxed frame: no storage, and possibly no navigation */
    }
    if (!href) return;
    // Hold the curtain long enough to be read as a transition rather than a
    // crash. `location.replace` rather than assign, so bouncing between maps
    // does not fill the back button with boots. Same call PauseMenu makes.
    this._timer = setTimeout(() => {
      this._timer = 0;
      try {
        location.replace(href);
      } catch {
        /* navigation forbidden — the curtain stays up and says what it wanted */
      }
    }, 320);
  }

  /**
   * "You landed on NACHTFELD." Called once by `ui` at init; consumes the note
   * this screen left before it navigated. Returns the map name or null.
   */
  static takeHandoff() {
    try {
      const v = sessionStorage.getItem(HANDOFF);
      if (v) sessionStorage.removeItem(HANDOFF);
      return v || null;
    } catch {
      return null;
    }
  }

  /* -------------------------------------------------------------- show --- */

  syncFromConfig() {
    const cur = this.currentId();
    for (const c of this.cards) {
      const on = c.id === cur;
      setClass(c.root, 'on', on);
      setStyle(c.live, 'display', on ? '' : 'none');
    }
  }

  /** @param {boolean} fromMenu the pause menu is up and owns the freeze */
  show(fromMenu = false) {
    if (this.open) return;
    this.open = true;
    this._fromMenu = fromMenu;
    this._hintDone = true;
    this.syncFromConfig();
    setStyle(this.root, 'display', '');
    // Same reason as the pause menu: Input re-locks on any left click, so the
    // first click on a card would take the cursor straight back.
    this.ctx.input?.setLockAllowed?.(false);
    document.exitPointerLock?.();
    if (fromMenu) return;
    const t = this.ctx.time;
    if (t) {
      this._prevScale = t.scale;
      t.scale = 0;
    }
    this.ctx.peek('player')?.setControlEnabled?.(false);
    this.ctx.events.emit('ui:pause', { paused: true });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    for (const c of this.cards) setStyle(c.root, 'pointer-events', '');
    setStyle(this.deploy, 'display', 'none');
    // Opened over the pause menu: the menu is still up and still owns the
    // freeze and the pointer lock. Touching either here would resume the game
    // underneath an open menu.
    if (this._fromMenu) return;
    const t = this.ctx.time;
    if (t) t.scale = this._prevScale ?? 1;
    this.ctx.peek('player')?.setControlEnabled?.(true);
    this.ctx.input?.setLockAllowed?.(true);
    this.ctx.input?.requestPointerLock?.();
    this.ctx.events.emit('ui:pause', { paused: false });
  }

  toggle(fromMenu = false) {
    this.open ? this.close() : this.show(fromMenu);
  }

  /** Unscaled, like the pause menu — the fade runs while the game is frozen. */
  update(rawDt) {
    if (this.hint) {
      if (!this._hintDone && this.ctx.input?.pointerLocked) this._hintDone = true;
      if (this._hintDone) {
        setStyle(this.hint, 'display', 'none');
      } else {
        const info = getMapInfo(this.currentId());
        setText(this.hint, `MAP · ${info?.name ?? this.currentId()}    PRESS M TO CHANGE`);
        setStyle(this.hint, 'display', '');
      }
    }

    this.shown = damp(this.shown, this.open ? 1 : 0, 14, rawDt);
    if (this.shown < 0.004) {
      setStyle(this.root, 'display', 'none');
      setStyle(this.root, 'pointer-events', 'none');
      return;
    }
    setStyle(this.root, 'display', '');
    setStyle(this.root, 'pointer-events', this.open ? 'auto' : 'none');
    setStyle(this.root, 'opacity', ease.outQuad(this.shown).toFixed(3));
  }

  dispose() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = 0;
    this.hint?.remove();
    this.root.remove();
  }
}
