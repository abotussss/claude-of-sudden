import { el, svg, setText, setStyle, setClass, ease, clamp01, damp } from './util.js';

/**
 * ===========================================================================
 * PICKUPS AND THE BEACON — the confirmations
 * ===========================================================================
 * "武器落ち・F長押しで交換・グレネード補充・３０秒ビーコン、これらはもっとハイライトして、
 *  わかりやすいように ユーザーが気付けるように"
 *
 * Four features shipped and the player did not know they were there. That is
 * not a gameplay complaint, it is a HUD one, and it has three separate causes,
 * which is why it takes three separate elements to answer:
 *
 *   1. He never found the crates.        -> `WorldMarkers.updateCaches`
 *   2. He could not tell the two verbs   -> the two-row `Prompt`
 *      on F apart.
 *   3. Nothing said it had WORKED.       -> this file.
 *
 * `TOAST` is the receipt: what you just got, how much of it, and — the case
 * that matters most — why you did not get it, with the clock on it. A hold that
 * silently does nothing is indistinguishable from a hold that is not
 * implemented, and "グレネードの補充は1分に一回まで" makes silent refusal the
 * COMMON case rather than an edge one.
 *
 * `BEACON` is the thirty seconds, on its own clock, in the corner the minimap
 * already owns for map-scale information. The zone strip's line stays what it
 * is — a summary — and this is the event.
 *
 * Nothing here animates on a CSS transition and nothing allocates after
 * construction: same rules as the rest of `src/ui`.
 */

/** Seconds a toast holds at full before it goes. */
const TOAST_LIFE = 2.6;

export class PickupToast {
  constructor(parent) {
    this.root = el('div', 'ow-pick', parent);
    this.rule = el('i', 'ow-pick-rule', this.root);
    const col = el('div', 'ow-pick-col', this.root);
    this.title = el('div', 'ow-pick-t', col, '');
    this.sub = el('div', 'ow-pick-s', col, '');
    this.t = TOAST_LIFE * 2;
    this.kind = 'supply';
    /** What it currently reads, or null. A harness asserts on this. */
    this.text = null;
    setStyle(this.root, 'display', 'none');
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @param {'supply'|'weapon'|'beacon'|'deny'} kind
   */
  show(title, sub, kind = 'supply') {
    setText(this.title, (title ?? '').toUpperCase());
    setText(this.sub, (sub ?? '').toUpperCase());
    setStyle(this.sub, 'display', sub ? '' : 'none');
    this.kind = kind;
    setClass(this.root, 'weapon', kind === 'weapon');
    setClass(this.root, 'beacon', kind === 'beacon');
    setClass(this.root, 'deny', kind === 'deny');
    this.t = 0;
    this.text = `${title}${sub ? ' — ' + sub : ''}`;
  }

  update(dt) {
    if (this.t >= TOAST_LIFE) {
      setStyle(this.root, 'display', 'none');
      this.text = null;
      return;
    }
    this.t += dt;
    const u = clamp01(this.t / TOAST_LIFE);
    setStyle(this.root, 'display', '');
    // Hard pop in, flat hold, quick out — the shape of a confirmation rather
    // than the shape of a notification.
    const inT = clamp01(this.t / 0.16);
    const a = u > 0.74 ? 1 - ease.inQuad((u - 0.74) / 0.26) : ease.outQuad(inT);
    const s = 0.92 + 0.08 * ease.outBack(inT);
    const x = (1 - ease.outCubic(inT)) * -18;
    setStyle(this.root, 'opacity', a.toFixed(3));
    setStyle(this.root, 'transform', `translate(calc(-50% + ${x.toFixed(1)}px),-50%) scale(${s.toFixed(4)})`);
  }

  dispose() {
    this.root.remove();
  }
}

/**
 * THE THIRTY SECONDS. Under the minimap, because it is the same question the
 * minimap answers — where does my side come back — and because the beacon's own
 * world marker is already drawn on it.
 *
 * On cooldown it stays on screen, dim, with the seconds. "There is no beacon"
 * and "there cannot be one for another forty seconds" are different things to
 * know, and only one of them is a reason to walk to a crate.
 */
export class BeaconStrip {
  constructor(parent) {
    this.root = el('div', 'ow-bcn', parent);
    const head = el('div', 'ow-bcn-head', this.root);
    const g = svg('svg', { viewBox: '0 0 16 16' }, el('div', 'ow-bcn-glyph', head));
    svg('path', { d: 'M8 1.4 9.7 6.2 14.6 6.2 10.6 9.2 12.1 14 8 11 3.9 14 5.4 9.2 1.4 6.2 6.3 6.2z',
      fill: 'currentColor', stroke: 'rgba(6,20,28,.7)', 'stroke-width': .8 }, g);
    this.title = el('div', 'ow-bcn-t', head, 'BEACON');
    this.clock = el('div', 'ow-bcn-c', head, '');
    const track = el('div', 'ow-bcn-track', this.root);
    this.fill = el('i', null, track);
    this.sub = el('div', 'ow-bcn-s', this.root, '');
    this.shown = 0;
    this._pulse = 0;
    /** What it currently reads, or null. */
    this.text = null;
    setStyle(this.root, 'display', 'none');
  }

  /**
   * @param {number} dt
   * @param {object|null} b  `{ mine, active, seconds, cooldown, at }` from match
   * @param {number} life    `RULES.beaconTime`, for the bar's full scale
   */
  update(dt, b, life = 30) {
    const want = b && (b.mine || b.cooldown > 0) ? 1 : 0;
    this.shown = damp(this.shown, want, 15, dt);
    if (this.shown < 0.006) {
      setStyle(this.root, 'display', 'none');
      this.text = null;
      return;
    }
    setStyle(this.root, 'display', '');
    this._pulse += dt;
    const mine = !!b?.mine;
    const secs = mine ? b.seconds : b?.cooldown ?? 0;
    const urgent = mine && secs < 6;
    const beat = urgent ? 0.55 + 0.45 * Math.abs(Math.sin(this._pulse * 9)) : 1;

    setClass(this.root, 'cold', !mine);
    setText(this.title, mine ? 'BEACON ONLINE' : 'BEACON');
    setText(this.clock, `${Math.ceil(secs)}S`);
    setText(this.sub, mine ? `FORWARD SPAWN · ${b.at || 'CACHE'}` : 'TAP F AT A CACHE WHEN READY');
    setStyle(this.fill, 'transform', `scaleX(${clamp01(mine ? secs / life : 1 - secs / 75).toFixed(3)})`);
    setStyle(this.root, 'opacity', (this.shown * beat).toFixed(3));
    this.text = `${mine ? 'BEACON ONLINE' : 'BEACON'} ${Math.ceil(secs)}S`;
  }

  dispose() {
    this.root.remove();
  }
}
