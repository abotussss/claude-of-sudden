import { el, setText, setStyle, clamp, damp, ease } from './util.js';

const PRESETS = ['low', 'medium', 'high', 'ultra'];

/**
 * Pause / settings menu.
 *
 * Wired straight into `ctx.config`: the quality segments call
 * `config.setQuality`, the sliders write `config.sensitivity` and `config.fov`
 * (and push the FOV into the live camera), and every change is announced on the
 * event bus so render/player can react without importing this module.
 *
 * Events emitted: `ui:pause` {paused}, `ui:quality` {quality},
 * `ui:sensitivity` {value}, `ui:fov` {value}, `ui:setting` {key, value}.
 */
export class PauseMenu {
  constructor(parent, ctx) {
    this.ctx = ctx;
    this.root = el('div', 'ow-menu', parent);
    const inner = el('div', 'ow-menu-inner', this.root);

    const h = el('h1', null, inner, 'Paused');
    h.textContent = 'PAUSED';
    el('div', 'sub', inner, 'OVERWATCH — TACTICAL OPERATIONS');
    el('div', 'rule', inner);

    this.rows = el('div', null, inner);

    // ---- quality preset --------------------------------------------------
    this.qBtns = [];
    const qRow = this._row('Graphics Preset');
    const seg = el('div', 'ow-seg', qRow);
    for (const p of PRESETS) {
      const b = el('button', null, seg, p);
      b.type = 'button';
      b.addEventListener('click', () => this.setQuality(p));
      this.qBtns.push(b);
    }

    /**
     * ---- LOADOUT ----------------------------------------------------------
     *
     * A weapon picker, because there was not one. Weapons could only be changed
     * with 1/2/3 and the mouse wheel while playing, and the freeze phase was
     * even documented as "where you change loadout" when no such screen
     * existed. Sudden Attack picks a loadout before the round; this is the
     * closest thing this build has to that screen.
     *
     * Rows are built from `weapons.weaponIds`, so a new weapon appears here the
     * moment it is registered — nothing to keep in sync.
     */
    this.wBtns = [];
    const wRow = this._row('Weapon');
    this.wSeg = el('div', 'ow-seg', wRow);
    this._buildWeaponRow();

    // ---- sensitivity -----------------------------------------------------
    this.sens = this._slider('Mouse Sensitivity', 0.2, 3.0, 0.01, (v) => {
      this.ctx.config.sensitivity = 0.0022 * v;
      this.ctx.events.emit('ui:sensitivity', { value: this.ctx.config.sensitivity, multiplier: v });
      return v.toFixed(2);
    });

    // ---- field of view ---------------------------------------------------
    this.fov = this._slider('Field Of View', 65, 120, 1, (v) => {
      this.ctx.config.fov = v;
      const cam = this.ctx.camera;
      if (cam) {
        cam.fov = v;
        cam.updateProjectionMatrix();
      }
      this.ctx.events.emit('ui:fov', { value: v });
      return String(v | 0);
    });

    // ---- invert look -----------------------------------------------------
    const invRow = this._row('Invert Look');
    const invSeg = el('div', 'ow-seg', invRow);
    this.invBtns = [];
    for (const [label, val] of [
      ['off', false],
      ['on', true],
    ]) {
      const b = el('button', null, invSeg, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        this.ctx.config.invertY = val;
        this.ctx.events.emit('ui:setting', { key: 'invertY', value: val });
        this.syncFromConfig();
      });
      this.invBtns.push([b, val]);
    }

    // ---- buttons ---------------------------------------------------------
    const btns = el('div', 'ow-btns', inner);
    this.resumeBtn = el('button', 'ow-btn primary', btns, 'Resume');
    this.resumeBtn.type = 'button';
    this.resumeBtn.addEventListener('click', () => this.close());
    const reset = el('button', 'ow-btn', btns, 'Defaults');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      this.sens.set(1);
      this.fov.set(80);
      this.ctx.config.invertY = false;
      this.setQuality('ultra');
    });
    el('div', 'hint', inner, 'ESC RESUME · WASD MOVE · SHIFT SPRINT · R RELOAD · F USE');

    this.open = false;
    this.shown = 0;
    setStyle(this.root, 'display', 'none');
    setStyle(this.root, 'cursor', 'default');
    this.syncFromConfig();
  }

  /**
   * Fill the weapon segment from whatever `weapons` has registered. Deferred to
   * the first `show()` as well as run at build time, because `ui` may init
   * before `weapons` and the list would otherwise be empty for the session.
   */
  _buildWeaponRow() {
    const wp = this.ctx.peek('weapons');
    /**
     * PRIMARIES ONLY — carbine / AK / sniper / SMG.
     *
     * This listed `weaponIds`, i.e. all six, and clicking one did exactly what
     * pressing its number key does. So the "weapon" control in the settings
     * screen was a weapon SWITCHER, not a loadout: it offered the pistol and
     * the knife as if they were choices, and offered no way to say "I want the
     * AK as my rifle". Reported as "why is the weapon selection which of the
     * weapons I'm holding, instead of which AR to take".
     *
     * Slot 1 draws whatever is chosen here. Slots 2 and 3 are fixed, as they
     * are in the game this is modelled on.
     */
    const ids = wp?.primaryIds ?? [];
    if (!this.wSeg || ids.length === this.wBtns.length) return;
    this.wSeg.textContent = '';
    this.wBtns.length = 0;
    for (const id of ids) {
      const def = wp.states?.get?.(id)?.def;
      const b = el('button', null, this.wSeg, (def?.label ?? id).toUpperCase());
      b.type = 'button';
      b.dataset.wid = id;
      b.addEventListener('click', () => this.setPrimary(id));
      this.wBtns.push(b);
    }
  }

  /**
   * Switch weapon from the menu. Uses the animated `setWeapon` so it behaves
   * exactly like pressing 1/2/3 — no instant swap that the viewmodel has to
   * catch up with.
   */
  setPrimary(id) {
    const wp = this.ctx.peek('weapons');
    if (!wp) return;
    if (typeof wp.setPrimary === 'function') {
      wp.setPrimary(id);
      this.ctx.events.emit('ui:setting', { key: 'primary', value: id });
      this.syncFromConfig();
      return;
    }
    // A holster/draw cannot play while the trigger is locked and the game is
    // paused, so swap immediately and let the draw play on resume.
    if (typeof wp.setWeaponImmediate === 'function') wp.setWeaponImmediate(id);
    else wp.setWeapon?.(id);
    this.ctx.events.emit('ui:setting', { key: 'weapon', value: id });
    this.syncFromConfig();
  }

  _row(name) {
    const r = el('div', 'ow-row', this.rows);
    el('div', 'name', r, name.toUpperCase());
    return r;
  }

  _slider(name, min, max, step, apply) {
    const row = this._row(name);
    const wrap = el('div', 'ow-slider', row);
    el('div', 'track', wrap);
    const fill = el('div', 'fill', wrap);
    const knob = el('div', 'knob', wrap);
    const input = el('input', null, wrap);
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const val = el('div', 'val', row, '');

    const paint = (v) => {
      const t = (v - min) / (max - min);
      setStyle(fill, 'width', (t * 100).toFixed(2) + '%');
      setStyle(knob, 'left', (t * 100).toFixed(2) + '%');
      setText(val, apply(v) ?? String(v));
    };
    input.addEventListener('input', () => paint(parseFloat(input.value)));
    const api = {
      set: (v) => {
        const c = clamp(v, min, max);
        input.value = String(c);
        paint(c);
      },
    };
    return api;
  }

  /**
   * Switch graphics preset.
   *
   * Half of a preset is only readable at boot: TAA, GTAO, SSR, volumetrics and
   * motion blur are separate passes that `render` constructs (or does not
   * construct) during init, and the cascade count and shadow map size are baked
   * into the CSM. Mutating `config.q` alone therefore used to change NOTHING
   * visible — which is worse than not offering the control at all.
   *
   * So: apply it live (resolution and pixel ratio follow immediately, and those
   * are the dominant cost), then reload with `?q=` so the rest of the preset is
   * real. Boot off a warm cache is 5-15 s. `?q=` in the URL is also the documented
   * way to pick a preset without opening the menu at all.
   */
  setQuality(name) {
    try {
      this.ctx.config.setQuality(name);
      this.ctx.events.emit('ui:quality', { quality: name });
    } catch (err) {
      console.warn('[ui] quality switch failed', err);
      return;
    }
    this.syncFromConfig();
    try {
      const url = new URL(location.href);
      if (url.searchParams.get('q') === name) return; // already the booted preset
      url.searchParams.set('q', name);
      location.replace(url.toString());
    } catch {
      /* file:// or a sandbox that forbids navigation — the live half still applied */
    }
  }

  syncFromConfig() {
    const cfg = this.ctx.config;
    this._buildWeaponRow();
    // Highlight the chosen PRIMARY, not whatever is in hand — the pistol being
    // out must not leave every button unlit. @see WeaponSystem.setPrimary
    const active = this.ctx.peek('weapons')?.primaryId;
    for (const b of this.wBtns) b.classList.toggle('on', b.dataset.wid === active);
    for (let i = 0; i < this.qBtns.length; i++)
      this.qBtns[i].classList.toggle('on', PRESETS[i] === cfg.quality);
    for (const [b, v] of this.invBtns) b.classList.toggle('on', !!cfg.invertY === v);
    this.sens?.set((cfg.sensitivity ?? 0.0022) / 0.0022);
    this.fov?.set(cfg.fov ?? 80);
  }

  toggle() {
    this.open ? this.close() : this.show();
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.syncFromConfig();
    setStyle(this.root, 'display', '');
    /**
     * REFUSE the lock for as long as the menu is up, rather than just exiting
     * it once. Exiting alone did not work: `Input._onMouseDown` re-locks on any
     * left click, so the first click on a menu button took the cursor straight
     * back and the only way to see it again was Escape — every time.
     */
    this.ctx.input?.setLockAllowed?.(false);
    document.exitPointerLock?.();
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
    const t = this.ctx.time;
    if (t) t.scale = this._prevScale ?? 1;
    this.ctx.peek('player')?.setControlEnabled?.(true);
    this.ctx.input?.setLockAllowed?.(true);
    this.ctx.input?.requestPointerLock?.();
    this.ctx.events.emit('ui:pause', { paused: false });
  }

  /** Driven with unscaled time so the fade still runs while the game is frozen. */
  update(rawDt) {
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
    this.root.remove();
  }
}
