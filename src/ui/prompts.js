import { el, setText, setStyle, ease, clamp01, damp } from './util.js';

/**
 * Interaction prompt: keycap + verb, with an optional hold-progress rule.
 *
 * ONE KEY, TWO VERBS, AND THE PLAYER HAS TO BE TOLD WHICH IS WHICH. The caches
 * put a HOLD (take what it holds) and a TAP (plant the thirty second beacon) on
 * the same F, and the first version of this prompt carried both in one grey
 * sub-line — "HOLD F · TAP F FOR BEACON" — which is a sentence you read once,
 * at the wrong moment, and never again. So the two verbs are now two ROWS, each
 * with its own keycap and its own caption under it, and the hold row keeps the
 * progress rule that shows the key is doing something.
 *
 * `alt` is optional and everything about the single-row form is unchanged: the
 * demolition prompts (PICK UP C4 / PLANT / DEFUSE) pass no `alt` and no
 * `holdCaption`, and render exactly as they did.
 */
export class Prompt {
  constructor(parent) {
    this.root = el('div', 'ow-prompt', parent);
    const row = el('div', 'ow-prompt-row', this.root);
    const keyWrap = el('div', 'ow-prompt-keywrap', row);
    this.key = el('div', 'ow-key', keyWrap, 'F');
    this.cap = el('div', 'ow-prompt-cap', keyWrap, '');
    const col = el('div', null, row);
    this.txt = el('div', 'ow-prompt-txt', col, 'INTERACT');
    this.sub = el('div', 'ow-prompt-sub', col, '');
    const bar = el('div', null, col);
    bar.style.cssText =
      'margin-top:calc(var(--u)*1);height:calc(1.5px * var(--k));background:rgba(255,255,255,.16);width:100%';
    this.fill = el('i', null, bar);
    this.fill.style.cssText =
      'display:block;height:100%;width:100%;background:var(--amber);transform-origin:left;transform:scaleX(0)';
    this.bar = bar;

    /* ---- the second verb on the same key ------------------------------ */
    this.altRow = el('div', 'ow-prompt-row alt', this.root);
    const altWrap = el('div', 'ow-prompt-keywrap', this.altRow);
    this.altKey = el('div', 'ow-key', altWrap, 'F');
    this.altCap = el('div', 'ow-prompt-cap', altWrap, 'TAP');
    const altCol = el('div', null, this.altRow);
    this.altTxt = el('div', 'ow-prompt-txt', altCol, '');
    this.altSub = el('div', 'ow-prompt-sub', altCol, '');

    this.shown = 0;
    this.active = false;
    this.progress = 0;
    setStyle(this.root, 'display', 'none');
    setStyle(this.altRow, 'display', 'none');
  }

  /**
   * @param {object} p { key, text, sub, progress, hold, alt: {key,text,sub} }
   *                   `hold` captions the first row HOLD instead of TAP; `alt`
   *                   adds the second row. Both optional.
   */
  set(p) {
    this.active = true;
    setText(this.key, p.key ?? 'F');
    setText(this.txt, (p.text ?? 'INTERACT').toUpperCase());
    setText(this.sub, (p.sub ?? '').toUpperCase());
    setStyle(this.sub, 'display', p.sub ? '' : 'none');
    this.progress = p.progress ?? 0;
    setStyle(this.bar, 'display', p.progress !== undefined ? '' : 'none');
    const cap = p.hold === undefined ? '' : p.hold ? 'HOLD' : 'TAP';
    setText(this.cap, cap);
    setStyle(this.cap, 'display', cap ? '' : 'none');

    const a = p.alt;
    setStyle(this.altRow, 'display', a ? '' : 'none');
    if (a) {
      setText(this.altKey, a.key ?? p.key ?? 'F');
      setText(this.altCap, a.hold ? 'HOLD' : 'TAP');
      setText(this.altTxt, (a.text ?? '').toUpperCase());
      setText(this.altSub, (a.sub ?? '').toUpperCase());
      setStyle(this.altSub, 'display', a.sub ? '' : 'none');
    }
  }

  clear() {
    this.active = false;
  }

  update(dt) {
    this.shown = damp(this.shown, this.active ? 1 : 0, 18, dt);
    const vis = this.shown;
    setStyle(this.root, 'display', vis < 0.005 ? 'none' : '');
    if (vis < 0.005) return;
    setStyle(this.root, 'opacity', vis.toFixed(3));
    const y = (1 - ease.outCubic(vis)) * 7;
    setStyle(this.root, 'transform', `translate(-50%,calc(-50% + ${y.toFixed(2)}px))`);
    setStyle(this.fill, 'transform', `scaleX(${clamp01(this.progress).toFixed(3)})`);
  }

  dispose() {
    this.root.remove();
  }
}

/** Kill confirmation / objective banner. One at a time, newest wins. */
export class Banner {
  constructor(parent) {
    this.root = el('div', 'ow-banner', parent);
    this.title = el('div', 'ow-banner-t', this.root, '');
    this.sub = el('div', 'ow-banner-s', this.root, '');
    el('div', 'ow-banner-rule', this.root);
    this.t = 1;
    this.life = 2.1;
    setStyle(this.root, 'display', 'none');
  }

  show(title, sub, life = 2.1) {
    setText(this.title, (title ?? '').toUpperCase());
    setText(this.sub, (sub ?? '').toUpperCase());
    setStyle(this.sub, 'display', sub ? '' : 'none');
    this.life = life;
    this.t = 0;
  }

  update(dt) {
    if (this.t >= 1) {
      setStyle(this.root, 'display', 'none');
      return;
    }
    this.t = Math.min(1, this.t + dt / this.life);
    const u = this.t;
    const inT = clamp01(u / (0.16 / this.life));
    const a = u > 0.78 ? 1 - ease.inQuad((u - 0.78) / 0.22) : ease.outQuad(inT);
    const s = 0.965 + 0.035 * ease.outBack(inT);
    setStyle(this.root, 'display', '');
    setStyle(this.root, 'opacity', a.toFixed(3));
    setStyle(this.root, 'transform', `translate(-50%,-50%) scale(${s.toFixed(4)})`);
  }

  dispose() {
    this.root.remove();
  }
}
