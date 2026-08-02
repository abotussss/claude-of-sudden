import { el, setText, setStyle, setClass, ease, clamp01, damp, metres } from './util.js';

/**
 * ===========================================================================
 * THE KILL CAM — 「誰が自分をキルしたのか、キルカメラにしてください」
 * ===========================================================================
 *
 * The banner over the kill cam. `src/match/spectate.js` owns the CAMERA; this
 * owns the sentence, and the sentence is the whole point of the request: what
 * the player asked for is not a camera move, it is an ANSWER. Before this, a
 * death cut to a random living team-mate and the killfeed row scrolled away
 * behind the ELIMINATED banner, so "what killed me" was unanswerable in the
 * only two seconds anybody is looking for it.
 *
 * It has to answer for a killer who is not a person and may not exist any more,
 * which is most of the interesting cases on this map: an airstrike, a bomber
 * run, a strafing run, a tank shell, the cathedral coming down, a drone that
 * destroyed itself doing it, your own grenade at your own feet. So the record
 * carries a NAME, a CAUSE and a place, and the three degrade independently —
 * a nameless cause still gets its own line and its own camera move.
 *
 * `title` is who, `cause` is with what, `dist` is how far away they were when
 * they did it, and the bar is the respawn clock, so the strip answers "what do
 * I do now" as well as "what happened".
 *
 * Nothing animates on a CSS transition; every value is integrated from `dt`.
 */

export class KillCam {
  constructor(parent) {
    this.root = el('div', 'ow-kc', parent);
    this.tag = el('div', 'ow-kc-tag', this.root, 'KILLCAM');
    this.title = el('div', 'ow-kc-t', this.root, '');
    this.sub = el('div', 'ow-kc-s', this.root, '');
    const bar = el('div', 'ow-kc-bar', this.root);
    this.fill = el('i', null, bar);

    this.active = false;
    this.shown = 0;
    this._title = '';
    this._sub = '';
    this._colour = '';
    /** 0..1 of the wait that has elapsed. */
    this.progress = 0;
    /** True while on screen — for the harness. */
    this.visible = false;
    /** What it reads, so a harness can assert on it. */
    this.text = null;

    setStyle(this.root, 'display', 'none');
  }

  /**
   * The player died and `match` knows what did it.
   *
   * @param {object} k { name, cause, dist, friendly, environmental }
   *                   the caller's own reused record; every field is copied.
   */
  set(k) {
    if (!k) { this.active = false; return; }
    this.active = true;
    this.progress = 0;
    const env = !!k.environmental;
    this._title = k.name ? `KILLED BY ${k.name}` : 'KILLED';
    // Two facts on one line, and either may be missing: what it was, and how
    // far away it happened. A blast has a distance and no shooter; a knife has
    // a shooter and a distance of nothing worth printing.
    const bits = [];
    if (k.cause) bits.push(k.cause);
    if (k.dist > 0.5) bits.push(metres(k.dist));
    this._sub = bits.join(' · ');
    setClass(this.root, 'friendly', !!k.friendly && !env);
    setClass(this.root, 'env', env);
    setText(this.title, this._title);
    setText(this.sub, this._sub);
    this.text = this._sub ? `${this._title} — ${this._sub}` : this._title;
  }

  clear() {
    this.active = false;
  }

  /**
   * @param {number} dt
   * @param {number} progress 0..1 of the respawn wait, or 0 when there is none
   */
  update(dt, progress = 0) {
    if (this.active) this.progress = clamp01(progress);
    this.shown = damp(this.shown, this.active ? 1 : 0, 13, dt);
    this.visible = this.shown > 0.02;
    if (this.shown < 0.005) {
      setStyle(this.root, 'display', 'none');
      if (!this.active) this.text = null;
      return;
    }
    setStyle(this.root, 'display', '');
    setStyle(this.root, 'opacity', this.shown.toFixed(3));
    const rise = (1 - ease.outCubic(this.shown)) * 12;
    setStyle(this.root, 'transform', `translate(-50%,${rise.toFixed(2)}px)`);
    setStyle(this.fill, 'transform', `scaleX(${(1 - this.progress).toFixed(3)})`);
  }

  dispose() {
    this.root.remove();
  }
}
