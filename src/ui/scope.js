import { el, setStyle, clamp01, damp } from './util.js';

/**
 * SCOPE OVERLAY — what looking through a magnified optic actually looks like.
 *
 * Reported as "スコープ覗いたら画面いっぱいにスコープ覗いた画面にならないと":
 * aiming a scoped rifle showed the magnified world behind a rifle held at arm's
 * length, with the scope tube as a small window in the middle of the frame. The
 * defs.js note on the sniper's `eyeRelief` measured that window at 46% of the
 * housing and treated it as a success. It is not what a scope is. When your eye
 * is behind an optic you see the sight picture and nothing else — the rifle,
 * your hands and the rest of the world are gone.
 *
 * So: a black surround with a circular sight picture cut out of it, a mil-dot
 * reticle, and the viewmodel hidden. Two DOM nodes and a CSS gradient, built
 * once — there is no reason to spend a render pass on this.
 *
 * The circle is sized in `vmin` so it stays circular and stays the same
 * fraction of the shorter screen edge at any aspect ratio. 33vmin of radius
 * leaves a black ring on a 16:9 display and reaches the top and bottom edges,
 * which is what a scope with the correct eye relief looks like.
 */
export class ScopeOverlay {
  constructor(parent) {
    this.root = el('div', 'ow-scope', parent);
    /**
     * The surround and the sight picture are ONE element with a radial
     * gradient, not a ring plus a mask: a hard-edged gradient stop gives a
     * perfectly round aperture at any size with no seam where two elements
     * meet, and it composites in one pass.
     */
    this.body = el('div', 'ow-scope-body', this.root);
    this.vert = el('i', 'ow-scope-vert', this.root);
    this.horz = el('i', 'ow-scope-horz', this.root);
    /** Mil dots down the lower vertical, the holdover marks you actually aim with. */
    this.dots = [];
    for (let i = 1; i <= 4; i++) {
      const d = el('i', 'ow-scope-dot', this.root);
      setStyle(d, 'top', `calc(50% + ${i * 3.6}vmin)`);
      this.dots.push(d);
    }
    this.shown = 0;
    setStyle(this.root, 'display', 'none');
  }

  /**
   * @param {number} dt      unscaled seconds
   * @param {boolean} scoped is the player's eye behind the optic right now
   */
  update(dt, scoped) {
    this.shown = damp(this.shown, scoped ? 1 : 0, 22, dt);
    if (this.shown < 0.004) {
      setStyle(this.root, 'display', 'none');
      return;
    }
    setStyle(this.root, 'display', '');
    setStyle(this.root, 'opacity', clamp01(this.shown).toFixed(3));
    /**
     * The aperture opens as the eye comes to the glass rather than cross-fading
     * a full-size circle in. A scope that fades up at final size reads as a
     * texture laid over the screen; one that opens reads as an eye arriving
     * behind it, and it also hides the frame or two where the world camera's
     * FOV is still interpolating toward magnification.
     */
    const r = 20 + 13 * clamp01(this.shown);
    setStyle(
      this.body,
      'background',
      `radial-gradient(circle at 50% 50%, rgba(0,0,0,0) ${r}vmin,` +
        ` rgba(0,0,0,0.72) ${(r + 0.6).toFixed(2)}vmin, #000 ${(r + 2.4).toFixed(2)}vmin)`
    );
  }

  dispose() {
    this.root.remove();
  }
}
