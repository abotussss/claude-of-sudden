import { el, setText, setStyle, setClass, clamp01, damp, ease, mmss } from './util.js';

/**
 * Pip and scoreboard-row capacity. Both are hard caps: `_pips` hides the
 * surplus and the scoreboard hides surplus rows, so a roster larger than these
 * is silently truncated on screen. `RULES.teamSize` is 15, so at 8 the strip
 * drew half a team and the scoreboard eight of fifteen men — the count is the
 * most decision-relevant number on the HUD and it was wrong.
 */
const MAX_TEAM = 16;
const MAX_ROWS = 32;

/**
 * ROUND STRIP — who is left, and how long you have.
 *
 * Sits directly under the scoreline. Two rows of pips (yours on the left, cold;
 * theirs on the right, hot) with the phase readout between them, because in a
 * no-respawn mode the *count* is the single most decision-relevant number on
 * screen: 3v1 and 1v3 are different games and you have to know which one you are
 * in without reading a scoreboard.
 *
 * Every pip and every row is built once. `update()` only writes text, opacity
 * and transforms, all through the change-guarded setters in util.js.
 */
export class RoundStrip {
  constructor(parent) {
    this.root = el('div', 'ow-round', parent);

    this.usWrap = el('div', 'ow-round-pips us', this.root);
    this.mid = el('div', 'ow-round-mid', this.root);
    this.themWrap = el('div', 'ow-round-pips them', this.root);

    this.usPips = [];
    this.themPips = [];
    for (let i = 0; i < MAX_TEAM; i++) {
      this.usPips.push(el('i', 'ow-pip', this.usWrap));
      this.themPips.push(el('i', 'ow-pip', this.themWrap));
    }
    this.phase = el('div', 'ow-round-phase', this.mid, '');
    this.alert = el('div', 'ow-round-alert', this.mid, '');
    this._alertPulse = 0;
  }

  update(dt, s) {
    if (!s) return;
    this._pips(this.usPips, s.aliveUs, s.rosterUs ?? s.aliveUs);
    this._pips(this.themPips, s.aliveThem, s.rosterThem ?? s.aliveThem);

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

  _pips(pips, alive, total) {
    for (let i = 0; i < pips.length; i++) {
      const used = i < total;
      setStyle(pips[i], 'display', used ? '' : 'none');
      if (used) setClass(pips[i], 'down', i >= alive);
    }
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
 * SCOREBOARD — held on Tab, and shown automatically between rounds.
 *
 * Two columns, your side first, sorted by kills. Nothing here is animated on a
 * CSS transition: the fade is integrated from dt like every other widget, so a
 * paused or captured frame looks the same every time.
 */
export class Scoreboard {
  constructor(parent) {
    this.root = el('div', 'ow-sb', parent);
    const panel = el('div', 'ow-sb-panel', this.root);
    const head = el('div', 'ow-sb-head', panel);
    this.title = el('div', 'ow-sb-title', head, 'DEMOLITION');
    this.sub = el('div', 'ow-sb-sub', head, '');

    const cols = el('div', 'ow-sb-cols', panel);
    this.cols = [el('div', 'ow-sb-col', cols), el('div', 'ow-sb-col', cols)];
    this.heads = [];
    for (let c = 0; c < 2; c++) {
      // Team name on the left, K and D lined up over the columns they label —
      // two bare numbers with no header is the classic unreadable scoreboard.
      const head = el('div', 'ow-sb-team', this.cols[c]);
      this.heads.push(el('span', 'n', head, c ? 'BLUE' : 'RED'));
      el('span', 'k', head, 'K');
      el('span', 'd', head, 'D');
    }
    this.rows = [[], []];
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < MAX_ROWS / 2; i++) {
        const row = el('div', 'ow-sb-row', this.cols[c]);
        row._n = el('span', 'n', row, '');
        row._k = el('span', 'k', row, '0');
        row._d = el('span', 'd', row, '0');
        this.rows[c].push(row);
      }
    }
    this.shown = 0;
    this._sorted = [[], []];
    setStyle(this.root, 'display', 'none');
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

    for (let c = 0; c < 2; c++) {
      const team = order[c];
      setText(this.heads[c], names[team]);
      setStyle(this.heads[c], 'color', colors[team]);
      const list = this._sorted[c];
      list.length = 0;
      for (const r of s.roster ?? []) if (r.team === team) list.push(r);
      list.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      const rows = this.rows[c];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rec = list[i];
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
