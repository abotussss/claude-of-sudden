import { el, setText, setStyle, setClass, ease, clamp01, damp } from './util.js';

/**
 * ===========================================================================
 * THE CAPTURE — "ドミネーションはもっと占領中のUIを作って占領してる感を出して"
 * ===========================================================================
 *
 * WHY THIS EXISTS. Everything DOMINATION does was already on screen and none of
 * it was an EVENT. `ZoneStrip` draws three chips 30 px wide under the scoreline,
 * each with a 2 px capture bar and a `3 / 1` head count, and that is a correct
 * summary of the whole map — which is exactly the problem. Standing in a circle
 * while a fifteen second bar fills under fire is the single most decision-dense
 * thing the mode asks a player to do, and it was being reported at the same
 * visual weight as the two points he is not standing in.
 *
 * So this is the other half: ONE point, the one under his feet, at the size the
 * moment deserves.
 *
 *   WHAT      the verb, not the state. CAPTURING / SECURING / LOSING /
 *             CONTESTED / HOLDING, with the zone's letter in a badge tinted by
 *             who owns it right now.
 *   HOW FAR   a 440 px bar with a lit leading edge and quarter ticks, plus the
 *             percentage as a number, because "62 %" and "nearly there" are
 *             different amounts of information.
 *   WHO       both head counts as PIPS, yours against theirs, and the word for
 *             the arithmetic — GAINING / LOSING / DEADLOCK. A player who can see
 *             `3 / 1` still has to work out what it means while being shot at.
 *   WHEN      seconds left, integrated off `zone.rate`, which is the rate
 *             `src/match/capture.js` actually advanced the bar at this frame.
 *   HOW HARD  the beat. The whole panel breathes faster and brighter as the bar
 *             fills — 1.5 Hz at the start, 7 Hz at the end — and it ticks
 *             audibly on every eighth of the bar, so a capture ARRIVES instead
 *             of quietly reaching 100 %.
 *
 * And the two moments that are not a bar at all:
 *
 *   CAPTURED  a hold with a shockwave ring off the badge. The banner says the
 *             same words two seconds later for the whole team; this is the
 *             confirmation for the man who was standing in it.
 *   UNDER ATTACK  the panel is not only for the zone you are IN. When one of
 *             yours is being taken and you are somewhere else, it comes up in
 *             its red variant with the same bar and the same clock, because
 *             "A is going and you have eleven seconds" is a thing you can act
 *             on and "the A chip's 2 px bar is 40 % red" is not.
 *
 * NOTHING ANIMATES ON A CSS TRANSITION and nothing here allocates a THREE
 * object or an array after construction: same rules as the rest of `src/ui`.
 * Every beat is integrated from `dt`, so a paused game freezes mid-capture and
 * the capture harness stays deterministic.
 */

/** Pips per side. `RULES.captureCrowdBonus` caps the useful crowd well under this. */
const MAX_PIPS = 8;
/** Seconds the CAPTURED / LOST card holds before it fades. */
const FLASH_HOLD = 2.0;
/** The bar is cut into eighths, and each one crossed is one audible tick. */
const TICKS = 8;

export class CapturePanel {
  /**
   * @param {HTMLElement} parent
   * @param {(id: string, gain: number) => void} sfx  the HUD's own audio hook
   */
  constructor(parent, sfx) {
    this.sfx = sfx ?? (() => {});
    this.root = el('div', 'ow-cap', parent);

    /* ---- head: verb, badge, name ------------------------------------- */
    const head = el('div', 'ow-cap-head', this.root);
    this.verb = el('div', 'ow-cap-verb', head, 'CAPTURING');
    const badgeWrap = el('div', 'ow-cap-badge-wrap', head);
    this.ring = el('div', 'ow-cap-ring', badgeWrap);
    this.badge = el('div', 'ow-cap-badge', badgeWrap, 'A');
    this.name = el('div', 'ow-cap-name', head, '');

    /* ---- the bar ------------------------------------------------------ */
    const track = el('div', 'ow-cap-track', this.root);
    this.track = track;
    this.fill = el('i', 'ow-cap-fill', track);
    /** The lit leading edge — where the bar IS, not where it has been. */
    this.edge = el('i', 'ow-cap-edge', track);
    el('div', 'ow-cap-ticks', track);
    this.pct = el('div', 'ow-cap-pct', track, '0%');

    /* ---- foot: bodies, the read, the clock --------------------------- */
    const foot = el('div', 'ow-cap-foot', this.root);
    this.usWrap = el('div', 'ow-cap-pips us', foot);
    this.usN = el('div', 'ow-cap-n us', foot, '0');
    this.read = el('div', 'ow-cap-read', foot, '');
    this.themN = el('div', 'ow-cap-n them', foot, '0');
    this.themWrap = el('div', 'ow-cap-pips them', foot);
    this.usPips = [];
    this.themPips = [];
    for (let i = 0; i < MAX_PIPS; i++) {
      this.usPips.push(el('i', 'ow-cap-pip', this.usWrap));
      this.themPips.push(el('i', 'ow-cap-pip', this.themWrap));
    }
    this.clock = el('div', 'ow-cap-clock', this.root, '');

    /* ---- state -------------------------------------------------------- */
    this.shown = 0;
    this.progress = 0;
    this._beat = 0;
    this._tick = -1;
    /** 'none'|'take'|'defend'|'hold'|'contest'|'threat'|'won'|'lost' */
    this.mode = 'none';
    /** The zone id the panel is currently about, for the flash and the harness. */
    this.zoneId = '';
    this._prevOwner = '';
    this._prevId = '';
    this._flash = 10;
    this._flashKind = '';
    this._flashId = '';
    this._flashName = '';
    this._threatSince = -10;
    this._warned = '';
    /** What the panel currently reads. A harness asserts on this. */
    this.text = null;
    this.visible = false;
  }

  /**
   * @param {number} dt
   * @param {object|null} s  the round snapshot `match` pushes; read, never kept
   */
  update(dt, s) {
    const zones = s?.mode === 'domination' && !s.dead ? s.zones : null;

    /* ---- pick the one zone this panel is about ------------------------ */
    let z = null;
    let threat = false;
    if (zones) {
      for (let i = 0; i < zones.length; i++) if (zones[i].here) z = zones[i];
      if (!z) {
        // Nothing under his feet. Is one of ours being taken somewhere else?
        // The loudest one wins — the one closest to being lost.
        for (let i = 0; i < zones.length; i++) {
          const c = zones[i];
          if (c.owner !== 'mine' || c.capture !== 'theirs' || c.progress <= 0.02) continue;
          if (!z || c.progress > z.progress) z = c;
        }
        threat = !!z;
      }
    }

    /**
     * ---- did the one we were watching just change hands? --------------
     *
     * Tracked BY ID rather than "is it still the zone I would pick", because the
     * two moments this card exists for are exactly the ones where the pick stops
     * matching: a zone I was defending stops being `owner: 'mine'` on the frame
     * it is lost, and a zone I took stops being a threat on the frame it is
     * taken. Watching the pick alone missed both.
     */
    let watched = null;
    if (zones && this._prevId) {
      for (let i = 0; i < zones.length; i++) if (zones[i].id === this._prevId) watched = zones[i];
    }
    if (watched && this._prevOwner && watched.owner !== this._prevOwner) {
      if (watched.owner === 'mine') this._startFlash('won', watched);
      else if (this._prevOwner === 'mine') this._startFlash('lost', watched);
    }
    if (z) {
      this._prevId = z.id;
      this._prevOwner = z.owner;
    } else if (watched) {
      this._prevOwner = watched.owner;
      if (this._flash >= FLASH_HOLD && watched.owner !== 'mine') {
        this._prevId = '';
        this._prevOwner = '';
      }
    }

    this._flash += dt;
    const flashing = this._flash < FLASH_HOLD;

    /* ---- what is happening, in one word ------------------------------ */
    let mode = 'none';
    if (flashing) mode = this._flashKind;
    else if (z) {
      if (threat) mode = 'threat';
      else if (z.contested) mode = 'contest';
      else if (z.owner === 'mine' && z.capture !== 'theirs') mode = 'hold';
      else if (z.owner === 'mine') mode = 'defend';
      else mode = 'take';
    }
    this.mode = mode;
    this.zoneId = z ? z.id : '';

    /**
     * HOLDING A QUIET POINT IS NOT AN EVENT. Standing on ground nobody is
     * contesting must not put a 440 px panel over the middle of the screen for
     * the rest of the match — the zone strip already says you hold it. So the
     * quiet hold shows only while the enemy's leftover bar is still being pushed
     * back down, and otherwise the panel is away.
     */
    const want = mode === 'none' || (mode === 'hold' && (!z || z.progress <= 0.005)) ? 0 : 1;
    this.shown = damp(this.shown, want, want ? 20 : 13, dt);
    this.visible = this.shown > 0.02;
    if (this.shown < 0.006) {
      setStyle(this.root, 'display', 'none');
      this.text = null;
      this._beat = 0;
      this._tick = -1;
      return;
    }
    setStyle(this.root, 'display', '');

    /* ---- numbers ------------------------------------------------------ */
    /**
     * A FLIP IS ALWAYS A FULL BAR. `capture.js` zeroes `progress` on the frame a
     * zone changes hands, so reading it live during the CAPTURED card would show
     * the thing that just completed sitting at 0 %.
     */
    const p = flashing ? 1 : clamp01(z ? z.progress : 0);
    this.progress = p;
    const mineN = z ? z.mine : 0;
    const themN = z ? z.theirs : 0;
    const rate = z ? z.rate ?? 0 : 0;
    // Which side the bar belongs to, and therefore what filling it MEANS.
    const forMe = z ? z.capture === 'mine' : mode === 'won';
    const tint =
      mode === 'won' || (forMe && mode !== 'threat')
        ? 'var(--friend)'
        : mode === 'contest'
          ? 'var(--amber)'
          : mode === 'hold'
            ? 'var(--friend)'
            : 'var(--enemy)';

    setClass(this.root, 'threat', mode === 'threat' || mode === 'lost');
    setClass(this.root, 'contest', mode === 'contest');
    setClass(this.root, 'won', mode === 'won');

    /* ---- words -------------------------------------------------------- */
    const verb =
      mode === 'won'
        ? 'CAPTURED'
        : mode === 'lost'
          ? 'LOST'
          : mode === 'threat'
            ? 'UNDER ATTACK'
            : mode === 'contest'
              ? 'CONTESTED'
              : mode === 'defend'
                ? 'LOSING'
                : mode === 'hold'
                  ? 'SECURING'
                  : 'CAPTURING';
    setText(this.verb, verb);
    // During the flash the player may already have walked off the point, so the
    // letter and the name come off the latch rather than off a null zone.
    setText(this.badge, z ? z.id : flashing ? this._flashId : '');
    setText(this.name, z?.name ?? (flashing ? this._flashName : ''));
    setStyle(this.verb, 'color', mode === 'won' ? 'var(--ink)' : tint);
    setStyle(this.badge, 'background', tint);
    setStyle(this.ring, 'border-color', tint);
    setStyle(this.name, 'color', 'var(--ink-2)');

    /* ---- the bar ------------------------------------------------------ */
    setStyle(this.fill, 'transform', `scaleX(${p.toFixed(4)})`);
    setStyle(this.fill, 'background', tint);
    // `left`, not a percentage transform: a transform percentage resolves
    // against the EDGE's own 3 px width, not the track's.
    setStyle(this.edge, 'left', `${(p * 100).toFixed(3)}%`);
    setStyle(this.edge, 'background', tint);
    // `currentColor` is what the edge's glow is drawn with, in style.js.
    setStyle(this.edge, 'color', tint);
    setStyle(this.edge, 'opacity', p > 0.002 && p < 0.999 ? '1' : '0');
    setText(this.pct, `${Math.round(p * 100)}%`);

    /* ---- the bodies --------------------------------------------------- */
    this._pips(this.usPips, mineN, 'var(--friend)');
    this._pips(this.themPips, themN, 'var(--enemy)');
    setText(this.usN, mineN);
    setText(this.themN, themN);
    setStyle(this.usN, 'color', mineN ? 'var(--friend)' : 'var(--ink-3)');
    setStyle(this.themN, 'color', themN ? 'var(--enemy)' : 'var(--ink-3)');

    /**
     * THE ARITHMETIC, DONE FOR HIM. `capture.js` moves the bar at the rate of
     * the DIFFERENCE when both sides are in the circle, so the edge is the whole
     * story of the fight and it is the one number a player cannot get by
     * counting pips under fire.
     */
    const edge = mineN - themN;
    const read =
      mode === 'won' || mode === 'lost'
        ? ''
        : themN && mineN
          ? edge > 0
            ? `+${edge} ADVANTAGE`
            : edge < 0
              ? `OUTNUMBERED ${mineN} v ${themN}`
              : 'DEADLOCK'
          : mineN
            ? mineN > 1
              ? `${mineN} ON THE POINT`
              : 'ON THE POINT'
            : themN
              ? `${themN} ENEMY ON IT`
              : 'EMPTY';
    setText(this.read, read);
    setStyle(
      this.read,
      'color',
      mode === 'contest' || edge < 0 ? 'var(--amber)' : mode === 'threat' ? 'var(--enemy)' : 'var(--ink-2)'
    );

    /* ---- the clock ---------------------------------------------------- */
    let clock = '';
    if (mode === 'won') clock = 'FORWARD SPAWN OPEN';
    else if (mode === 'lost') clock = 'SPAWN CLOSED';
    else if (rate > 1e-4) {
      const secs = Math.ceil((1 - p) / rate);
      clock = forMe ? `CAPTURED IN ${secs}S` : `LOST IN ${secs}S`;
    } else if (rate < -1e-4 && p > 0.005) {
      const secs = Math.ceil(p / -rate);
      clock = forMe ? `SLIPPING · ${secs}S TO ZERO` : `PUSHING BACK · ${secs}S`;
    } else if (mode === 'contest') {
      clock = 'KILL THEM OR LEAVE';
    }
    setText(this.clock, clock);
    setStyle(this.clock, 'display', clock ? '' : 'none');
    this.text = `${verb} ${z ? z.id : ''} ${Math.round(p * 100)}% ${read} ${clock}`.trim();

    /* ---- the beat ------------------------------------------------------ */
    /**
     * A RISING BEAT, and it is the whole "占領してる感". The rate ramps with the
     * bar, so the panel is breathing at walking pace when you arrive and hammering
     * by the time it lands; a threatened zone and a contested one beat at a fixed
     * hard rate instead, because neither of them is progress.
     */
    const hz = mode === 'threat' ? 3.6 : mode === 'contest' ? 2.6 : 1.5 + 5.5 * p;
    this._beat += dt * hz;
    const pulse = 0.5 + 0.5 * Math.sin(this._beat * Math.PI * 2);
    const punch = flashing ? 1 : mode === 'hold' ? 0.1 : 0.18 + 0.5 * p;
    const glow = flashing ? clamp01(1.6 - this._flash / FLASH_HOLD) : pulse * punch;

    const vis = ease.outCubic(clamp01(this.shown));
    setStyle(this.root, 'opacity', (this.shown * (0.86 + 0.14 * (flashing ? 1 : pulse))).toFixed(3));
    // Grows into the capture: 1.00 at the start of the bar, 1.05 at the end, and
    // a hard pop on the frame it lands.
    const pop = flashing ? 1 + 0.09 * (1 - ease.outCubic(clamp01(this._flash / 0.4))) : 0;
    const scale = 1 + (mode === 'hold' ? 0 : 0.05 * p) + pop;
    const rise = (1 - vis) * 14;
    setStyle(
      this.root,
      'transform',
      `translate(-50%,${rise.toFixed(2)}px) scale(${scale.toFixed(4)})`
    );
    setStyle(this.track, 'box-shadow', `0 0 ${(2 + 16 * glow).toFixed(1)}px rgba(255,255,255,${(0.05 + 0.3 * glow).toFixed(3)})`);
    // The badge's ring is the shockwave on a capture and the heartbeat otherwise.
    const rs = flashing
      ? 1 + 2.4 * ease.outCubic(clamp01(this._flash / 0.85))
      : 1 + 0.32 * (1 - pulse) * (mode === 'hold' ? 0.3 : 1);
    setStyle(this.ring, 'transform', `scale(${rs.toFixed(3)})`);
    setStyle(
      this.ring,
      'opacity',
      (flashing ? clamp01(1 - this._flash / 0.85) : 0.25 + 0.55 * pulse * (0.4 + 0.6 * p)).toFixed(3)
    );

    /* ---- the ticks ---------------------------------------------------- */
    /**
     * ONE SOUND PER EIGHTH OF THE BAR, rising in pitch-substitute (gain) as it
     * fills, and only for a bar being filled by MY side while I am standing in
     * it. A capture I am losing gets the warning tone instead, once, when it
     * starts — a metronome for something going wrong is noise.
     */
    if (mode === 'take' || mode === 'contest' || (mode === 'hold' && p > 0)) {
      const step = Math.floor(p * TICKS);
      if (this._tick < 0) this._tick = step;
      else if (step > this._tick) {
        this._tick = step;
        if (forMe) this.sfx('hit_armour', 0.28 + 0.5 * p);
      } else if (step < this._tick) this._tick = step;
    } else this._tick = -1;

    if (mode === 'threat' && this._warned !== z.id) {
      this._warned = z.id;
      this.sfx('grenade_warn', 0.55);
    } else if (mode !== 'threat' && this._warned && mode !== 'none') this._warned = '';
  }

  _startFlash(kind, z) {
    this._flash = 0;
    this._flashKind = kind;
    this._flashId = z?.id ?? '';
    this._flashName = z?.name ?? '';
    this._tick = -1;
    this.sfx(kind === 'won' ? 'hit_kill' : 'grenade_warn', kind === 'won' ? 0.95 : 0.7);
    this.zoneId = z?.id ?? '';
  }

  _pips(pips, n, colour) {
    for (let i = 0; i < pips.length; i++) {
      const on = i < n;
      setStyle(pips[i], 'display', i < Math.max(1, Math.min(MAX_PIPS, n)) ? '' : 'none');
      setStyle(pips[i], 'background', on ? colour : 'rgba(255,255,255,.12)');
    }
  }

  dispose() {
    this.root.remove();
  }
}
