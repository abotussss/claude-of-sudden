import { el, svg, setText, setStyle, setClass, ease, clamp01, damp, metres, cardinal } from './util.js';

/**
 * ===========================================================================
 * DRONE LOCK — 「捕捉されたら捕捉されたUIを出してほしい」
 * ===========================================================================
 *
 * WHY THIS EXISTS, in the same words `airalert.js` uses about the air events: a
 * weapon that fires correctly and is never announced has, from the seat, not
 * happened. A suicide drone is the worst case of that in this game. It is
 * 0.62 m across, it comes in from the back of the enemy half at 20 m altitude,
 * it makes a noise a firefight covers, and it is aimed at ONE MAN. Without this
 * strip the entire experience of the feature is dying to nothing, twice a
 * minute, for reasons you never learn.
 *
 * So it carries the four things the rotor cannot:
 *
 *   THAT   'DRONE LOCK' while it is still deciding, 'DRONE INBOUND' the moment
 *          it commits. Those are two different problems and the second one is
 *          not solvable by walking.
 *   WHERE  an arrow that points at the drone in the player's own frame — turn
 *          that way and you are looking at it, which is also how you shoot it
 *          down — plus the cardinal and the range.
 *   WHEN   a bar that empties over the 2.2 s of lock. Full bar means there is
 *          time to reach a doorway; an empty one means there is not.
 *   HOW    'BREAK LINE OF SIGHT' in as many words, because "you cannot outrun
 *          it" is a fact about two numbers the player has no way of knowing.
 *
 * THE EDGE is the other half. A strip at the top of the screen is invisible to
 * an eye down a sight, so the lock also puts a red vignette on the frame that
 * pulses with the countdown. It is the one thing that reads at any gaze.
 *
 * Nothing animates on a CSS transition and nothing here allocates: every value
 * is integrated from `dt`, exactly as the rest of `src/ui` is, so the capture
 * harness stays deterministic.
 */

/** Seconds the strip holds after the lock is gone, so a break is legible. */
const CLEAR_HOLD = 0.75;

export class DroneLock {
  constructor(parent, edgeParent) {
    this.root = el('div', 'ow-dl', parent);
    this.arrowBox = el('div', 'ow-dl-arrow', this.root);
    const s = svg('svg', { viewBox: '0 0 24 24' }, this.arrowBox);
    svg('path', {
      d: 'M12 1.6 21 21 12 16.4 3 21z',
      fill: 'currentColor',
      stroke: 'rgba(6,10,14,.85)',
      'stroke-width': 1.2,
    }, s);
    const col = el('div', 'ow-dl-col', this.root);
    this.title = el('div', 'ow-dl-t', col, 'DRONE LOCK');
    this.sub = el('div', 'ow-dl-s', col, '');
    const bar = el('div', 'ow-dl-bar', col);
    this.fill = el('i', null, bar);
    /** The frame treatment, in the hurt layer under the rest of the HUD. */
    this.edge = el('div', 'ow-dl-edge', edgeParent ?? parent);

    this.active = false;
    this.diving = false;
    this.shown = 0;
    this.hold = 0;
    this.progress = 0;
    this.remain = 0;
    this.range = 0;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    /** Beat phase, integrated so a paused game freezes it. */
    this.beat = 0;
    /** True while the strip is on screen — for the harness and for tests. */
    this.visible = false;
    /** What it currently reads, so a harness can assert on it. */
    this.text = null;

    setStyle(this.root, 'display', 'none');
    setStyle(this.edge, 'display', 'none');
  }

  /**
   * `match` pushes the drone system's own reused record every frame it changes.
   * Every field is copied out here; the object is never retained.
   *
   * @param {object} l { active, diving, progress, remain, range, x, y, z, team }
   */
  set(l) {
    if (!l || !l.active) {
      if (this.active) this.hold = 0;
      this.active = false;
      return;
    }
    this.active = true;
    this.hold = 0;
    this.diving = !!l.diving;
    this.progress = clamp01(l.progress ?? 0);
    this.remain = l.remain ?? 0;
    this.range = l.range ?? 0;
    this.x = l.x ?? 0;
    this.y = l.y ?? 0;
    this.z = l.z ?? 0;
  }

  /**
   * @param {number} dt
   * @param {number} heading  camera heading in degrees, 0 = north, clockwise
   * @param {number} ex  eye x
   * @param {number} ez  eye z
   */
  update(dt, heading, ex, ez) {
    if (!this.active) {
      this.hold += dt;
      // A lock that BREAKS has to be legible as a break, or the player never
      // learns that the doorway worked.
      if (this.hold > CLEAR_HOLD) this.diving = false;
    }
    const want = this.active || this.hold <= CLEAR_HOLD ? 1 : 0;
    this.shown = damp(this.shown, want, 15, dt);
    this.visible = this.shown > 0.02;
    if (this.shown < 0.005) {
      setStyle(this.root, 'display', 'none');
      setStyle(this.edge, 'display', 'none');
      this.text = null;
      return;
    }
    setStyle(this.root, 'display', '');
    setStyle(this.edge, 'display', '');

    /* ---- where is it, from here -------------------------------------- */
    const dx = this.x - ex;
    const dz = this.z - ez;
    const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
    let rel = bearing - heading;
    while (rel > 180) rel -= 360;
    while (rel < -180) rel += 360;
    setStyle(this.arrowBox, 'transform', `rotate(${rel.toFixed(1)}deg)`);

    /* ---- the words --------------------------------------------------- */
    const broke = !this.active;
    const t = broke ? 'LOCK BROKEN' : this.diving ? 'DRONE INBOUND' : 'DRONE LOCK';
    setText(this.title, t);
    const line = broke
      ? 'CLEAR'
      : `${this.diving ? 'DIVING' : 'BREAK LINE OF SIGHT'} · ${cardinal(bearing)} · ${metres(this.range)}`;
    setText(this.sub, line);
    this.text = `${t} — ${line}`;
    setClass(this.root, 'dive', this.diving && !broke);
    setClass(this.root, 'clear', broke);
    setClass(this.edge, 'dive', this.diving && !broke);

    /* ---- the clock --------------------------------------------------- */
    // EMPTIES as the lock fills: what is drawn is the time left to do
    // something about it, which is the only number the player can act on.
    const left = broke ? 0 : clamp01(1 - this.progress);
    setStyle(this.fill, 'transform', `scaleX(${left.toFixed(3)})`);

    /* ---- presence ---------------------------------------------------- */
    // Faster as the lock closes and fastest in the dive: the same information
    // the whistle carries, for a player with the sound off.
    this.beat += dt * (this.diving ? 26 : 9 + this.progress * 12);
    const pulse = broke ? 1 : 0.68 + 0.32 * Math.abs(Math.sin(this.beat));
    const a = this.shown * pulse * (broke ? clamp01(1.6 - this.hold / CLEAR_HOLD) : 1);
    setStyle(this.root, 'opacity', a.toFixed(3));
    const rise = (1 - ease.outCubic(this.shown)) * 9;
    setStyle(this.root, 'transform', `translate(-50%,${(-rise).toFixed(2)}px)`);
    const edge = broke ? 0 : this.shown * (0.28 + 0.72 * this.progress) * pulse;
    setStyle(this.edge, 'opacity', edge.toFixed(3));
  }

  dispose() {
    this.root.remove();
    this.edge.remove();
  }
}
