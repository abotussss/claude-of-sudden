import { el, svg, setText, setStyle, setClass, ease, clamp01, damp, metres, cardinal } from './util.js';

/**
 * ===========================================================================
 * INCOMING AIR — the announcement
 * ===========================================================================
 *
 * WHY THIS EXISTS. `src/match/airstrike.js` and `src/match/bomber.js` fire
 * correctly and always have — instrumented at real time over one ninety second
 * round: a route strike at 53.8 s, a bomber run at 74.2 s, a second strike at
 * 90.6 s, three events, zero errors. And the player reported, three times, that
 * 空爆が全然発生しない. Both statements were true: throughout that run
 * `ui.banner.text` and `ui.prompt.text` were `null`, nothing on screen ever
 * said a strike had been called, and the impacts land on fixed sites that can be
 * 100 m away on a 114x141 m map with a block in the way. An event you cannot
 * see, hear the meaning of, or be told about did not happen.
 *
 * So this is the missing half of the weapon: a strip that appears the instant a
 * strike is CALLED and carries the three things the telegraph cannot,
 *
 *   WHAT   'AIRSTRIKE INBOUND' / 'BOMBER RUN' / 'STRAFING RUN', and for the
 *          salvo 'BLOCK LEVELLED', because those are four different problems.
 *   WHERE  an arrow that points at the impact in the player's own frame — turn
 *          that way and you are looking at it — plus the site name, the compass
 *          cardinal and the range in metres.
 *   WHEN   a bar that empties over the remaining telegraph, so "I have time to
 *          move" and "I do not" are readable at a glance.
 *
 * It is deliberately NOT the banner. The banner is one line, centre screen, for
 * two seconds, and it is already carrying round transitions, kills and the
 * plant; a four and a half second countdown with a live bearing needs to sit
 * still somewhere and be glanceable. `match` shows a banner AS WELL, at the
 * moment of the call and at the moment of impact, because that is the thing
 * that catches an eye that was looking down a sight.
 *
 * NOTHING ANIMATES ON A CSS TRANSITION and nothing here allocates: same rules
 * as the rest of `src/ui`. The countdown is integrated from `dt`, so a paused
 * game freezes it and the capture harness stays deterministic.
 */

/** Seconds the strip holds after the impact before it fades. */
const IMPACT_HOLD = 2.2;

function arrowGlyph(parent) {
  const s = svg('svg', { viewBox: '0 0 24 24' }, parent);
  // A solid pointer, not a chevron: at 22 px on a blown-out sky an outline
  // disappears and this thing has one job, which is to be seen.
  svg(
    'path',
    {
      d: 'M12 1.6 21 21 12 16.4 3 21z',
      fill: 'currentColor',
      stroke: 'rgba(6,10,14,.85)',
      'stroke-width': 1.2,
    },
    s
  );
  return s;
}

/**
 * The strip. `set()` once when the strike is called; it runs its own clock from
 * there and puts itself away.
 */
export class AirAlert {
  constructor(parent) {
    this.root = el('div', 'ow-aa', parent);
    this.arrowBox = el('div', 'ow-aa-arrow', this.root);
    arrowGlyph(this.arrowBox);
    const col = el('div', 'ow-aa-col', this.root);
    this.title = el('div', 'ow-aa-t', col, '');
    this.sub = el('div', 'ow-aa-s', col, '');
    const bar = el('div', 'ow-aa-bar', col);
    this.fill = el('i', null, bar);

    /** Impact point, in world space. Copied, never retained by reference. */
    this.x = 0;
    this.y = 0;
    this.z = 0;

    this.active = false;
    this.shown = 0;
    this.t = 0;
    this.lead = 0;
    this.landed = false;
    this.hold = 0;
    this.kind = '';
    this._title = '';
    this._impactTitle = '';
    this._name = '';
    /** Set true while the strip is on screen, for the harness and for tests. */
    this.visible = false;
    /** What the strip currently reads, so a harness can assert on it. */
    this.text = null;
    this.bearing = 0;
    this.range = 0;

    setStyle(this.root, 'display', 'none');
  }

  /**
   * A strike has been CALLED. `a` is the caller's own reused object — every
   * field is copied out here.
   *
   * @param {object} a { kind, title, impactTitle, name, x, y, z, lead }
   */
  set(a) {
    this.active = true;
    this.landed = false;
    this.t = 0;
    this.hold = 0;
    this.lead = Math.max(0.2, a.lead ?? 4.4);
    this.kind = a.kind ?? 'STRIKE';
    this._title = a.title ?? 'AIRSTRIKE INBOUND';
    this._impactTitle = a.impactTitle ?? 'IMPACT';
    this._name = a.name ?? '';
    this.x = a.x ?? 0;
    this.y = a.y ?? 0;
    this.z = a.z ?? 0;
    setClass(this.root, 'salvo', this.kind === 'SALVO');
    setClass(this.root, 'landed', false);
  }

  /** It has gone off. Switches the strip to its impact read and starts the hold. */
  impact(title) {
    if (!this.active) return;
    this.landed = true;
    this.hold = 0;
    if (title) this._impactTitle = title;
  }

  clear() {
    this.active = false;
  }

  /**
   * @param {number} dt
   * @param {number} heading  camera heading in degrees, 0 = north, clockwise
   * @param {number} ex       eye x
   * @param {number} ez       eye z
   */
  update(dt, heading, ex, ez) {
    if (this.active) {
      this.t += dt;
      if (!this.landed && this.t >= this.lead) this.landed = true;
      if (this.landed) {
        this.hold += dt;
        if (this.hold >= IMPACT_HOLD) this.active = false;
      }
    }
    this.shown = damp(this.shown, this.active ? 1 : 0, 14, dt);
    const vis = this.shown;
    this.visible = vis > 0.02;
    if (vis < 0.005) {
      setStyle(this.root, 'display', 'none');
      this.text = null;
      return;
    }
    setStyle(this.root, 'display', '');

    /* ---- where is it, from here ------------------------------------- */
    const dx = this.x - ex;
    const dz = this.z - ez;
    this.range = Math.hypot(dx, dz);
    const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
    this.bearing = bearing;
    // Relative to where the player is looking, so the arrow is "turn this way".
    let rel = bearing - heading;
    while (rel > 180) rel -= 360;
    while (rel < -180) rel += 360;
    setStyle(this.arrowBox, 'transform', `rotate(${rel.toFixed(1)}deg)`);

    /* ---- the words --------------------------------------------------- */
    const t = this.landed ? this._impactTitle : this._title;
    setText(this.title, t);
    const line = `${this._name ? this._name + ' · ' : ''}${cardinal(bearing)} · ${metres(this.range)}`;
    setText(this.sub, line);
    this.text = `${t} — ${line}`;
    setClass(this.root, 'landed', this.landed);

    /* ---- the clock --------------------------------------------------- */
    const remain = this.landed ? 0 : clamp01(1 - this.t / this.lead);
    setStyle(this.fill, 'transform', `scaleX(${remain.toFixed(3)})`);

    /* ---- presence ---------------------------------------------------- */
    // A hard 6 Hz pulse in the last second and a half: the same information the
    // whistle is carrying, for a player with the sound off.
    const urgent = !this.landed && this.t > this.lead - 1.6;
    const beat = urgent ? 0.72 + 0.28 * Math.abs(Math.sin(this.t * 19)) : 1;
    const a = vis * beat * (this.landed ? clamp01(1.4 - this.hold / IMPACT_HOLD) : 1);
    setStyle(this.root, 'opacity', a.toFixed(3));
    const rise = (1 - ease.outCubic(vis)) * 9;
    setStyle(this.root, 'transform', `translate(-50%,${(-rise).toFixed(2)}px)`);
  }

  dispose() {
    this.root.remove();
  }
}
