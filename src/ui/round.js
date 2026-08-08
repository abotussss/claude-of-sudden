import { el, setText, setStyle, setClass, clamp01, damp, ease, mmss } from './util.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/* HOW MANY MEN THE HUD DRAWS — and why no number below is a roster size.      */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * WHAT USED TO BE HERE, AND WHAT IT DID.
 *
 *   const MAX_TEAM = 20;   // pips built per side
 *   const MAX_ROWS = 40;   // scoreboard rows, both sides
 *
 * Two hard caps, both built into the constructors, both hiding the surplus
 * rather than reporting it. Every man past the twentieth on a side simply did
 * not exist on screen: the plain went to forty a side (`MAP_RULES.plains
 * .teamSize`, 「平原のマップのときは４０−４０にしろ」) and the strip drew half a
 * team while the scoreboard showed forty of eighty men, with nothing to say so.
 *
 * AND IT WAS ALREADY WRONG ON THE TOWN. `rosterUs` is `_rosterSize(team)` —
 * every record on the side, not `RULES.teamSize` — and the roster GROWS inside
 * a match: `reinforceCount` 10 out of the helicopter, then up to
 * `hiddenSquadWaves * hiddenSquadSize` = 30 out of the cellars, all pushed onto
 * one side's roster and never removed. A town match can put SIXTY records on a
 * side; the strip capped at twenty, silently, on the map the user actually
 * plays. The plain only made the existing defect impossible to miss.
 *
 * WHAT REPLACES THEM: nothing that knows a roster size. The pools GROW to
 * whatever `s.rosterUs` / `s.rosterThem` report, on the frame they change, and
 * the only constants left describe how the HUD DRAWS — a pip's pitch, how many
 * rows make a readable column — which are properties of the screen and of the
 * eye, not of the match. The one place a limit still bites (a strip so
 * compressed the pips stop being marks) STATES what it is not drawing.
 */

/**
 * PIP GEOMETRY, in design pixels — every number here is multiplied by `--k`
 * (the HUD's viewport scale) on its way into CSS, like the rest of the sheet.
 * `PIP_W` and `PIP_GAP` are the values `.ow-pip` and `.ow-round-pips` have
 * always shipped, so a roster that fits at full pitch draws EXACTLY the strip
 * the town has always drawn — the compression below is off at 20 a side.
 */
const PIP_W = 4.5;
/** `.ow-round-pips` gap: `calc(var(--u) * .9)`, and `--u` is `4px * --k`. */
const PIP_GAP = 3.6;
const PIP_PITCH = PIP_W + PIP_GAP;
/**
 * The pitch below which a pip stops being a countable mark and becomes a
 * texture. Nothing is allowed to shrink past it; a strip that needs more room
 * than the budget at this pitch draws what fits and says how many it did not.
 */
const PIP_MIN_PITCH = 4.0;
/**
 * A BLANK SLOT EVERY TEN — the whole answer to "forty pips is not twenty pips
 * twice". Twenty marks in a row can be counted; forty cannot, and the strip's
 * job is a count. Four ranks of ten reads as forty at a glance and three ranks
 * plus two reads as thirty-two, which is the number a player rotates on.
 * Only applied when the strip has to compress, so 20 v 20 is untouched.
 */
const PIP_RANK = 10;
/** Widest one side's strip may grow before the pips compress instead. */
const PIP_BUDGET = 300;
/** Room the phase readout and the two live counts need between the strips. */
const PIP_MID = 300;

/**
 * ROUND STRIP — who is left, and how long you have.
 *
 * Sits directly under the scoreline. Two rows of pips (yours on the left, cold;
 * theirs on the right, hot) with the phase readout between them, because in a
 * no-respawn mode the *count* is the single most decision-relevant number on
 * screen: 3v1 and 1v3 are different games and you have to know which one you are
 * in without reading a scoreboard.
 *
 * AND AT FORTY A SIDE THE PIPS ARE NOT ENOUGH ON THEIR OWN, so each strip
 * carries the number as text as well: `14 / 40`, yours cold and theirs hot.
 * Nobody counts forty marks under fire, the exact figure is the thing the strip
 * exists to deliver, and a written count is the ONE readout that stays true at
 * any roster size — including the sizes where the marks have to be rationed.
 *
 * Every pip and every row is built ONCE PER SHAPE: the pools grow on the frame
 * the roster changes (match start, a helicopter, a wave out of the cellars) and
 * never again. `update()` only writes text, opacity and transforms, all through
 * the change-guarded setters in util.js.
 */
export class RoundStrip {
  constructor(parent) {
    this.root = el('div', 'ow-round', parent);

    this.usWrap = el('div', 'ow-round-pips us', this.root);
    /**
     * STATED OVERFLOW. Built first so it lands at the OUTER end of both strips
     * (`.them` is `row-reverse`), and hidden while everything fits — which is
     * every roster either map has ever produced. It exists so that the day a
     * strip cannot draw a man, the screen says `+6` instead of saying nothing.
     */
    this.usMore = el('span', 'ow-round-more', this.usWrap, '');
    this.usCount = el('div', 'ow-round-count us', this.root, '');
    this.mid = el('div', 'ow-round-mid', this.root);
    this.themCount = el('div', 'ow-round-count them', this.root, '');
    this.themWrap = el('div', 'ow-round-pips them', this.root);
    this.themMore = el('span', 'ow-round-more', this.themWrap, '');

    this.usPips = [];
    this.themPips = [];
    this.phase = el('div', 'ow-round-phase', this.mid, '');
    this.alert = el('div', 'ow-round-alert', this.mid, '');
    this._alertPulse = 0;

    /** Last shape laid out: men per side, and how many of them are drawn. */
    this._nUs = -1;
    this._nThem = -1;
    this._drawnUs = 0;
    this._drawnThem = 0;
    /** Viewport width in design units (CSS px / `--k`). @see setViewport */
    this._vwUnits = 1920;
  }

  /**
   * The HUD's own resize, forwarded so the strip knows how much room it has.
   * `w` is CSS pixels and `k` the HUD scale, so `w / k` is the width expressed
   * in the design units every number in this file is written in. Re-lays out
   * rather than re-builds: the pip pool is untouched unless it has to grow.
   */
  setViewport(w, k) {
    const u = Math.max(320, w / Math.max(0.01, k));
    if (Math.abs(u - this._vwUnits) < 0.5) return;
    this._vwUnits = u;
    this._layout();
  }

  /** Pips plus the blank slot that separates each rank of ten. */
  _slots(n) {
    return n + Math.ceil(n / PIP_RANK) - 1;
  }

  /**
   * Fit both strips to the roster and the window. Called only when one of those
   * two changes, so it may allocate; `update()` may not.
   */
  _layout() {
    const nUs = this._nUs;
    const nThem = this._nThem;
    if (nUs < 0 || nThem < 0) return;
    const n = Math.max(nUs, nThem);
    const budget = Math.max(80, Math.min(PIP_BUDGET, (this._vwUnits - PIP_MID) / 2));

    /**
     * UNCOMPRESSED WHILE THE BIGGER SIDE STILL FITS at the pitch this widget
     * shipped with, which is what keeps the town identical: 20 pips at 8.1
     * design px is 162, well inside the 300 budget, so `pitch` stays PIP_PITCH,
     * no rank gutters appear, and the emitted `--pipw` / `--pipgap` are the
     * literal values the stylesheet already had.
     */
    let pitch = PIP_PITCH;
    let ranked = false;
    let fit = n;
    if (n * PIP_PITCH > budget) {
      ranked = true;
      pitch = budget / this._slots(n);
      if (pitch < PIP_MIN_PITCH) {
        // Thinner than this and the strip is a smear. Draw what fits and let
        // `_more` say what did not.
        pitch = PIP_MIN_PITCH;
        while (fit > 1 && this._slots(fit) * pitch > budget) fit--;
      }
    }
    const w = pitch * (PIP_W / PIP_PITCH);
    setStyle(this.root, '--pipw', `calc(${w.toFixed(3)}px * var(--k))`);
    setStyle(this.root, '--pipgap', `calc(${(pitch - w).toFixed(3)}px * var(--k))`);
    const rank = ranked ? `calc(${pitch.toFixed(3)}px * var(--k))` : '';

    this._drawnUs = Math.min(nUs, fit);
    this._drawnThem = Math.min(nThem, fit);
    this._grow(this.usWrap, this.usPips, this._drawnUs, 'margin-left', rank);
    this._grow(this.themWrap, this.themPips, this._drawnThem, 'margin-right', rank);
    this._more(this.usMore, nUs - this._drawnUs);
    this._more(this.themMore, nThem - this._drawnThem);
  }

  /**
   * Grow a pip pool to `n` and mark the ranks. `side` is which physical margin
   * carries the rank gutter: `.them` is laid out `row-reverse`, so the same
   * `margin-left` would put its gutters one pip off the boundary.
   */
  _grow(wrap, pips, n, side, rank) {
    while (pips.length < n) pips.push(el('i', 'ow-pip', wrap));
    for (let i = 0; i < pips.length; i++) {
      setStyle(pips[i], 'display', i < n ? '' : 'none');
      setStyle(pips[i], 'margin-left', '');
      setStyle(pips[i], 'margin-right', '');
      if (rank && i > 0 && i % PIP_RANK === 0) setStyle(pips[i], side, rank);
    }
  }

  _more(node, hidden) {
    setStyle(node, 'display', hidden > 0 ? '' : 'none');
    if (hidden > 0) setText(node, `+${hidden}`);
  }

  update(dt, s) {
    if (!s) return;
    /**
     * THE ROSTER IS LIVE, so the shape is re-read every frame and re-laid-out
     * only when it moves. `rosterUs` counts records, not `RULES.teamSize`, so
     * this is also what catches the ten paratroopers and the men in the cellars.
     */
    const nUs = s.rosterUs ?? s.aliveUs;
    const nThem = s.rosterThem ?? s.aliveThem;
    if (nUs !== this._nUs || nThem !== this._nThem) {
      this._nUs = nUs;
      this._nThem = nThem;
      this._layout();
    }
    this._pips(this.usPips, s.aliveUs, this._drawnUs);
    this._pips(this.themPips, s.aliveThem, this._drawnThem);
    /**
     * The count carries `--friend` / `--enemy` through the `.us` / `.them`
     * classes the pips already use, which are the player's point of view by
     * construction — no team index is read here and none may be.
     */
    setText(this.usCount, `${s.aliveUs} / ${nUs}`);
    setText(this.themCount, `${s.aliveThem} / ${nThem}`);

    /**
     * DOMINATION HAS NO ROUND AND NO SIDE. "ROUND 1 · ATTACK" was actively
     * misleading there — there is one match and neither side attacks — so the
     * middle line carries the mode and the zone count instead.
     */
    const domination = s.mode === 'domination';
    const role = s.role === 'attack' ? 'ATTACK' : 'DEFEND';
    setText(
      this.phase,
      s.round < 1
        ? 'WARM UP'
        : domination
          ? `DOMINATION · ${s.ownedUs ?? 0}-${s.ownedThem ?? 0} ZONES`
          : `ROUND ${s.round} · ${role}`
    );
    setText(this.alert, s.alert ?? '');
    setStyle(this.alert, 'display', s.alert ? '' : 'none');

    // A live fuse pulses the alert line; nothing else on the HUD does, so the
    // motion alone means "the C4 is down". Never true in domination.
    const armed = !domination && s.bombState === 'planted';
    this._alertPulse = armed ? this._alertPulse + dt * (2.2 + (1 - s.bombFuse / 40) * 5) : 0;
    const a = armed ? 0.55 + 0.45 * (Math.sin(this._alertPulse * Math.PI * 2) * 0.5 + 0.5) : 1;
    setStyle(this.alert, 'opacity', a.toFixed(3));
    setStyle(this.alert, 'color', armed ? 'var(--red)' : 'var(--amber)');
  }

  /**
   * `drawn` is what `_layout` decided the strip can hold, never the roster:
   * display is settled there, so the per-frame pass only paints the dead.
   */
  _pips(pips, alive, drawn) {
    for (let i = 0; i < drawn; i++) setClass(pips[i], 'down', i >= alive);
  }

  dispose() {
    this.root.remove();
  }
}

/**
 * ZONE STRIP — DOMINATION: who holds A, C and B, and what is happening to them.
 *
 * Sits directly under the round strip, one chip per zone in map order (west to
 * east), which is the same order the compass and the paint on the ground put them
 * in. Each chip is:
 *
 *   • the letter, tinted by owner — cold for yours, hot for theirs, amber for
 *     neutral. Owner is the ONLY thing colour means here.
 *   • an ownership underline, so a chip reads at a glance with no colour vision.
 *   • a capture bar that fills toward whoever is taking it, and goes amber and
 *     STOPS when the point is contested. A frozen amber bar is the mode's one
 *     unambiguous "kill them or leave".
 *   • the head count inside the circle, yours over theirs. This is the number a
 *     player actually rotates on.
 *
 * The chip the player is STANDING IN is boxed and brightened, because the one
 * question the HUD has to answer instantly is "am I on the point".
 *
 * WHY THE STYLES ARE INLINE. Every other widget's CSS lives in src/ui/style.js;
 * this one is built with `setStyle` in the constructor instead, so the whole
 * feature is contained in the two files the HUD change was scoped to. Nothing is
 * animated by CSS — the fills are written from `update(dt, s)` like the rest of
 * the HUD, so a captured frame is deterministic. Only text, colour and one
 * transform are written per frame, all through the change-guarded setters.
 */
const MAX_ZONES = 5;

export class ZoneStrip {
  constructor(parent) {
    this.root = el('div', 'ow-zones', parent);
    setStyle(this.root, 'position', 'absolute');
    setStyle(this.root, 'left', '50%');
    // Below .ow-match (45px) and .ow-round (72px), both in style.js.
    setStyle(this.root, 'top', 'calc(var(--pad) * .7 + 104px * var(--k))');
    setStyle(this.root, 'transform', 'translateX(-50%)');
    setStyle(this.root, 'display', 'flex');
    setStyle(this.root, 'align-items', 'flex-start');
    setStyle(this.root, 'gap', 'calc(var(--u) * 2.2)');
    setStyle(this.root, 'white-space', 'nowrap');

    this.chips = [];
    for (let i = 0; i < MAX_ZONES; i++) {
      const chip = el('div', 'ow-zone', this.root);
      setStyle(chip, 'display', 'flex');
      setStyle(chip, 'flex-direction', 'column');
      setStyle(chip, 'align-items', 'center');
      setStyle(chip, 'gap', 'calc(var(--u) * .55)');
      setStyle(chip, 'padding', 'calc(var(--u) * .7) calc(var(--u) * 1.5)');
      setStyle(chip, 'border', '1px solid transparent');

      const letter = el('div', null, chip, '?');
      setStyle(letter, 'font-family', 'var(--fd)');
      setStyle(letter, 'font-size', 'calc(20px * var(--k))');
      setStyle(letter, 'line-height', '1');
      setStyle(letter, 'letter-spacing', '.06em');
      setStyle(letter, 'text-shadow', 'var(--sh-o1)');

      const rule = el('div', null, chip);
      setStyle(rule, 'width', 'calc(30px * var(--k))');
      setStyle(rule, 'height', 'calc(2.5px * var(--k))');

      const track = el('div', null, chip);
      setStyle(track, 'width', 'calc(30px * var(--k))');
      setStyle(track, 'height', 'calc(2px * var(--k))');
      setStyle(track, 'background', 'rgba(255,255,255,.14)');
      const fill = el('i', null, track);
      setStyle(fill, 'display', 'block');
      setStyle(fill, 'height', '100%');
      setStyle(fill, 'width', '100%');
      setStyle(fill, 'transform-origin', 'left');
      setStyle(fill, 'transform', 'scaleX(0)');

      const count = el('div', null, chip, '');
      setStyle(count, 'font-family', 'var(--fm)');
      setStyle(count, 'font-size', 'calc(9px * var(--k))');
      setStyle(count, 'letter-spacing', '.1em');
      setStyle(count, 'text-shadow', 'var(--sh-o1)');

      this.chips.push({ root: chip, letter, rule, track, fill, count });
    }
    /** Held-count line, so "2 / 3" is on screen without counting chips. */
    this.held = el('div', null, this.root, '');
    setStyle(this.held, 'align-self', 'center');
    setStyle(this.held, 'font-size', 'calc(10px * var(--k))');
    setStyle(this.held, 'letter-spacing', '.22em');
    setStyle(this.held, 'color', 'var(--ink-2)');
    setStyle(this.held, 'text-shadow', 'var(--sh-o1)');
    setStyle(this.held, 'padding-left', 'calc(var(--u) * 1.5)');
    setStyle(this.held, 'border-left', '1px solid var(--hair)');

    /**
     * THE BEACON'S CLOCK — the temporary forward spawn, "３０秒間".
     *
     * It hangs off the end of the zone strip because it is the same class of
     * information: WHERE MAY I COME BACK. A player who cannot see the thirty
     * seconds running down has a feature he has to guess the state of, and the
     * one decision it drives — do I push now or wait — is entirely a question of
     * how many of those seconds are left.
     *
     * Its own element rather than a sixth chip: it is not a zone, it does not
     * capture, and it must not be counted in "2/3".
     */
    this.beacon = el('div', null, this.root, '');
    setStyle(this.beacon, 'align-self', 'center');
    setStyle(this.beacon, 'display', 'none');
    setStyle(this.beacon, 'font-family', 'var(--fm)');
    setStyle(this.beacon, 'font-size', 'calc(10px * var(--k))');
    setStyle(this.beacon, 'letter-spacing', '.18em');
    setStyle(this.beacon, 'text-shadow', 'var(--sh-o1)');
    setStyle(this.beacon, 'padding-left', 'calc(var(--u) * 1.5)');
    setStyle(this.beacon, 'border-left', '1px solid var(--hair)');

    this.shown = 0;
    this._pulse = 0;
    setStyle(this.root, 'display', 'none');
  }

  update(dt, s) {
    const zones = s?.mode === 'domination' ? s.zones : null;
    const want = zones && zones.length ? 1 : 0;
    this.shown = damp(this.shown, want, 16, dt);
    setStyle(this.root, 'display', this.shown < 0.005 ? 'none' : 'flex');
    if (this.shown < 0.005) return;
    setStyle(this.root, 'opacity', this.shown.toFixed(3));
    // One shared pulse so every contested bar breathes together rather than each
    // one on its own phase, which reads as noise.
    this._pulse += dt;
    const breathe = 0.55 + 0.45 * (Math.sin(this._pulse * Math.PI * 2.4) * 0.5 + 0.5);

    for (let i = 0; i < this.chips.length; i++) {
      const c = this.chips[i];
      const z = zones[i];
      setStyle(c.root, 'display', z ? 'flex' : 'none');
      if (!z) continue;
      const own =
        z.owner === 'mine' ? 'var(--friend)' : z.owner === 'theirs' ? 'var(--enemy)' : 'var(--amber)';
      setText(c.letter, z.id);
      setStyle(c.letter, 'color', z.here ? 'var(--ink)' : own);
      setStyle(c.rule, 'background', own);
      // Standing on it: a box and a brighter letter. Nothing else on this strip
      // draws a border, so the box can only mean one thing.
      setStyle(c.root, 'border-color', z.here ? own : 'transparent');
      setStyle(c.root, 'background', z.here ? 'rgba(8,11,14,.42)' : 'transparent');

      const p = clamp01(z.progress);
      setStyle(c.fill, 'transform', `scaleX(${p.toFixed(3)})`);
      const barColour = z.contested
        ? 'var(--amber)'
        : z.capture === 'mine'
          ? 'var(--friend)'
          : z.capture === 'theirs'
            ? 'var(--enemy)'
            : 'var(--ink-3)';
      setStyle(c.fill, 'background', barColour);
      setStyle(c.fill, 'opacity', z.contested ? breathe.toFixed(3) : '1');
      setStyle(c.track, 'opacity', p > 0.001 || z.contested ? '1' : '0.35');

      setText(c.count, z.contested ? 'CONTESTED' : `${z.mine} / ${z.theirs}`);
      setStyle(
        c.count,
        'color',
        z.contested ? 'var(--amber)' : z.mine || z.theirs ? 'var(--ink-2)' : 'var(--ink-3)'
      );
    }
    setText(
      this.held,
      `${s.ownedUs ?? 0}/${zones.length} · ${s.score?.[s.playerTeam ?? 0] ?? 0}` +
        ` of ${s.scoreTarget ?? 0}`
    );

    /**
     * MINE, UP AND COUNTING DOWN — the friendly tint, breathing on the same
     * shared pulse the contested bars use once it is under five seconds, which
     * is the only warning a player gets that his forward spawn is about to stop
     * existing. On cooldown it stays on screen in dim text rather than
     * vanishing: "there is no beacon" and "there cannot be one for another
     * forty seconds" are different things to know.
     */
    const b = s.beacon;
    if (!b || (!b.mine && b.cooldown <= 0)) {
      setStyle(this.beacon, 'display', 'none');
    } else {
      setStyle(this.beacon, 'display', '');
      if (b.mine) {
        setText(this.beacon, `BEACON ${Math.ceil(b.seconds)}S`);
        setStyle(this.beacon, 'color', 'var(--friend)');
        setStyle(this.beacon, 'opacity', b.seconds < 5 ? breathe.toFixed(3) : '1');
      } else {
        setText(this.beacon, `BEACON ${Math.ceil(b.cooldown)}S`);
        setStyle(this.beacon, 'color', 'var(--ink-3)');
        setStyle(this.beacon, 'opacity', '1');
      }
    }
  }

  dispose() {
    this.root.remove();
  }
}

/**
 * C4 PANEL — bottom centre, above the interaction prompt. DEMOLITION only; it
 * hides itself when nothing is carrying, dropped or armed, which in domination is
 * every frame.
 *
 * Only on screen when the charge is in play. The fuse bar is the round clock
 * once it is armed, which is exactly the point of the mode: the two minutes
 * stop mattering and forty seconds start.
 */
export class BombPanel {
  constructor(parent) {
    this.root = el('div', 'ow-c4', parent);
    this.label = el('div', 'ow-c4-l', this.root, 'C4');
    const track = el('div', 'ow-c4-track', this.root);
    this.fill = el('i', null, track);
    this.clock = el('div', 'ow-c4-clock', this.root, '0:40');
    this.shown = 0;
    setStyle(this.root, 'display', 'none');
  }

  update(dt, s) {
    const armed = s?.bombState === 'planted';
    const carrying = !!s?.carrying;
    const loose = s?.bombState === 'dropped';
    const want = armed || carrying || loose ? 1 : 0;
    this.shown = damp(this.shown, want, 14, dt);
    setStyle(this.root, 'display', this.shown < 0.005 ? 'none' : '');
    if (this.shown < 0.005) return;
    setStyle(this.root, 'opacity', this.shown.toFixed(3));

    if (armed) {
      setText(this.label, `C4 ARMED · SITE ${s.bombSite || '?'}`);
      setText(this.clock, mmss(s.bombFuse));
      const f = clamp01(s.bombFuse / 40);
      setStyle(this.fill, 'transform', `scaleX(${f.toFixed(4)})`);
      setStyle(this.fill, 'background', f < 0.28 ? 'var(--red)' : 'var(--amber)');
      setStyle(this.root, 'display', '');
    } else if (carrying) {
      setText(this.label, 'C4 — YOU ARE CARRYING');
      setText(this.clock, '');
      setStyle(this.fill, 'transform', 'scaleX(0)');
    } else {
      setText(this.label, 'C4 DROPPED');
      setText(this.clock, '');
      setStyle(this.fill, 'transform', 'scaleX(0)');
    }
  }

  dispose() {
    this.root.remove();
  }
}

/**
 * ROWS TO A COLUMN — a DISPLAY density, and deliberately not a roster number.
 *
 * Twenty is the tallest column the scoreboard has ever drawn, on every window
 * the town has ever been played in: at `--k` 0.62 (a 600px-high window, the
 * floor of the clamp in `ui.resize`) twenty rows are about 260px under a 100px
 * header, and at `--k` 1 they are 420 under 160. It fits because it has always
 * fitted. A FORTY-row column would not, at any scale, which is the whole reason
 * eighty men get columns rather than a longer list.
 *
 * So a side of forty is two columns of twenty side by side — the same column
 * the town draws, twice — and the vertical extent of the panel does not change
 * between the two maps at all. Sorted by kills, filling the left sub-column
 * first, so the top twenty read down one column exactly as they do today.
 */
const ROWS_PER_COL = 20;
/**
 * AND TWO SUB-COLUMNS A SIDE IS WHERE IT STOPS, which is a cap, so it is
 * STATED: past forty men a side the panel prints `+23 NOT SHOWN` under the
 * column and says the hidden men are the ones with the fewest kills. Four name
 * columns is already the point where a 660px panel has to become a 980px one;
 * six would be a table nobody reads, and a silent forty-first row is exactly
 * the defect this file was opened to remove.
 *
 * NOTHING EITHER MAP PRODUCES REACHES IT AT THE START — the town is 20 and the
 * plain is 40 — but a match that runs long does: `reinforceCount` and the
 * `hiddenSquad` waves push records onto one side for the whole match, and the
 * plain can end at eighty on a side. That is the case this line is here for.
 */
const MAX_SUBCOLS = 2;
/** Panel width in design px: one name column pair, plus each extra pair. */
const SB_BASE_W = 660;
const SB_COL_W = 320;

/**
 * SCOREBOARD — held on Tab, and shown automatically between rounds.
 *
 * Your side first, sorted by kills. Nothing here is animated on a CSS
 * transition: the fade is integrated from dt like every other widget, so a
 * paused or captured frame looks the same every time.
 *
 * Rows are built ONCE PER SHAPE, not per frame and not to a fixed cap: the pool
 * grows to the roster the frame the roster changes, into as many sub-columns as
 * `ROWS_PER_COL` needs, and the header carries `24 / 61` so the totals are on
 * screen whether or not every man has a row.
 */
export class Scoreboard {
  constructor(parent) {
    this.root = el('div', 'ow-sb', parent);
    const panel = el('div', 'ow-sb-panel', this.root);
    this.panel = panel;
    const head = el('div', 'ow-sb-head', panel);
    this.title = el('div', 'ow-sb-title', head, 'DEMOLITION');
    this.sub = el('div', 'ow-sb-sub', head, '');

    const cols = el('div', 'ow-sb-cols', panel);
    this.heads = [];
    this.counts = [];
    this.headRows = [];
    this.segs = [[], []];
    this.subWraps = [];
    this.subCols = [[], []];
    this.rows = [[], []];
    this.more = [];
    for (let c = 0; c < 2; c++) {
      // One side. The team NAME is written once — "RED" over each of a side's
      // sub-columns would read as four teams — but the header row is segmented
      // to match them, so K and D sit over every column of numbers they label.
      const side = el('div', 'ow-sb-side', cols);
      const head = el('div', 'ow-sb-team', side);
      this.headRows.push(head);
      // Team name on the left, K and D lined up over the columns they label —
      // two bare numbers with no header is the classic unreadable scoreboard.
      const seg = el('div', 'ow-sb-teamseg', head);
      this.segs[c].push(seg);
      this.heads.push(el('span', 'n', seg, c ? 'BLUE' : 'RED'));
      /** Alive over total, the same fact the pip strip states in marks. */
      this.counts.push(el('span', 'c', seg, ''));
      el('span', 'k', seg, 'K');
      el('span', 'd', seg, 'D');
      this.subWraps.push(el('div', 'ow-sb-subs', side));
      const more = el('div', 'ow-sb-more', side, '');
      setStyle(more, 'display', 'none');
      this.more.push(more);
    }
    this.shown = 0;
    this._sorted = [[], []];
    /** Men per side at the last layout, and how many of them have a row. */
    this._shape = '';
    this._drawn = [0, 0];
    setStyle(this.root, 'display', 'none');
  }

  /**
   * Give side `c` enough rows for `n` men, in columns of `ROWS_PER_COL`, and
   * say so when it cannot. Returns how many men actually got a row. Allocates,
   * so it is called only when the roster changes shape — never per frame.
   */
  _fitSide(c, n) {
    const draw = Math.min(n, ROWS_PER_COL * MAX_SUBCOLS);
    const rows = this.rows[c];
    while (rows.length < draw) {
      const i = rows.length;
      const sc = (i / ROWS_PER_COL) | 0;
      while (this.subCols[c].length <= sc) {
        const j = this.subCols[c].length;
        this.subCols[c].push(el('div', 'ow-sb-col', this.subWraps[c]));
        // A matching header segment, so the second column of numbers is
        // labelled too. The name is not repeated; only K and D are.
        if (j > 0) {
          const seg = el('div', 'ow-sb-teamseg', this.headRows[c]);
          el('span', 'n', seg, '');
          el('span', 'k', seg, 'K');
          el('span', 'd', seg, 'D');
          this.segs[c].push(seg);
        }
      }
      const row = el('div', 'ow-sb-row', this.subCols[c][sc]);
      row._n = el('span', 'n', row, '');
      row._k = el('span', 'k', row, '0');
      row._d = el('span', 'd', row, '0');
      rows.push(row);
    }
    // A sub-column emptied by a smaller roster must not keep its flex share,
    // and its header segment goes with it or K and D float over nothing.
    for (let i = 0; i < this.subCols[c].length; i++) {
      const on = i * ROWS_PER_COL < draw ? '' : 'none';
      setStyle(this.subCols[c][i], 'display', on);
      setStyle(this.segs[c][i], 'display', on);
    }
    const hidden = n - draw;
    setStyle(this.more[c], 'display', hidden > 0 ? '' : 'none');
    if (hidden > 0) setText(this.more[c], `+${hidden} NOT SHOWN — FEWEST KILLS OF ${n}`);
    return draw;
  }

  /** @param {boolean} want  visible this frame */
  update(dt, want, s) {
    this.shown = damp(this.shown, want ? 1 : 0, 16, dt);
    setStyle(this.root, 'display', this.shown < 0.005 ? 'none' : '');
    if (this.shown < 0.005) return;
    setStyle(this.root, 'opacity', this.shown.toFixed(3));
    setStyle(
      this.root,
      'transform',
      `scale(${(0.985 + 0.015 * ease.outCubic(this.shown)).toFixed(4)})`
    );
    if (!s) return;

    const names = s.teamName ?? ['RED', 'BLUE'];
    const colors = s.teamColor ?? ['#ff6a52', '#66b4ff'];
    // The local player's side is always the left-hand column.
    const order = [s.playerTeam ?? 0, 1 - (s.playerTeam ?? 0)];
    const domination = s.mode === 'domination';
    setText(
      this.title,
      domination
        ? `DOMINATION · FIRST TO ${s.scoreTarget ?? 0}`
        : `DEMOLITION · ROUND ${s.round} / ${s.maxRounds}`
    );
    setText(
      this.sub,
      `${names[order[0]]} ${s.score[order[0]]} — ${s.score[order[1]]} ${names[order[1]]}` +
        (domination
          ? `   ·   ZONES ${s.ownedUs ?? 0} — ${s.ownedThem ?? 0}`
          : `   ·   ${s.role === 'attack' ? 'YOU ATTACK' : 'YOU DEFEND'}`)
    );

    // Both sides sorted first, because the panel's width is a function of the
    // taller of the two and has to be settled before either is written.
    for (let c = 0; c < 2; c++) {
      const list = this._sorted[c];
      list.length = 0;
      for (const r of s.roster ?? []) if (r.team === order[c]) list.push(r);
      list.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    }
    const shape = `${this._sorted[0].length}|${this._sorted[1].length}`;
    if (shape !== this._shape) {
      this._shape = shape;
      this._drawn[0] = this._fitSide(0, this._sorted[0].length);
      this._drawn[1] = this._fitSide(1, this._sorted[1].length);
      const subs = Math.max(
        1,
        Math.ceil(this._drawn[0] / ROWS_PER_COL),
        Math.ceil(this._drawn[1] / ROWS_PER_COL)
      );
      setStyle(this.panel, '--sbw', String(SB_BASE_W + (subs - 1) * SB_COL_W));
    }

    for (let c = 0; c < 2; c++) {
      const team = order[c];
      setText(this.heads[c], names[team]);
      setStyle(this.heads[c], 'color', colors[team]);
      const list = this._sorted[c];
      let alive = 0;
      for (const r of list) if (r.alive) alive++;
      setText(this.counts[c], `${alive} / ${list.length}`);
      const rows = this.rows[c];
      const draw = this._drawn[c];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rec = i < draw ? list[i] : null;
        setStyle(row, 'display', rec ? '' : 'none');
        if (!rec) continue;
        setText(row._n, rec.name);
        setText(row._k, rec.kills);
        setText(row._d, rec.deaths);
        setClass(row, 'dead', !rec.alive);
        setClass(row, 'you', !!rec.isPlayer);
      }
    }
  }

  dispose() {
    this.root.remove();
  }
}

/**
 * SPECTATOR BAR — the one line you get when you are out of the round.
 * Deliberately plain: it is a status, not a feature.
 */
export class SpectateBar {
  constructor(parent) {
    this.root = el('div', 'ow-spec', parent);
    this.txt = el('div', null, this.root, '');
    this.hint = el('div', 'ow-spec-hint', this.root, 'LMB / RMB — CHANGE VIEW');
    this.shown = 0;
    setStyle(this.root, 'display', 'none');
  }

  update(dt, s) {
    const want = s?.dead ? 1 : 0;
    this.shown = damp(this.shown, want, 12, dt);
    setStyle(this.root, 'display', this.shown < 0.005 ? 'none' : '');
    if (this.shown < 0.005) return;
    setStyle(this.root, 'opacity', this.shown.toFixed(3));
    setText(this.txt, s.spectating ? `SPECTATING ${s.spectating}` : 'ELIMINATED');
    setStyle(this.hint, 'display', s.spectating ? '' : 'none');
  }

  dispose() {
    this.root.remove();
  }
}
