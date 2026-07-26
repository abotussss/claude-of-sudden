import { el, setText, setStyle, setClass, clamp01, damp, ease, mmss } from './util.js';

const MAX_TEAM = 8;
const MAX_ROWS = 16;

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

    const role = s.role === 'attack' ? 'ATTACK' : 'DEFEND';
    setText(
      this.phase,
      s.round < 1 ? 'WARM UP' : `ROUND ${s.round} · ${role}`
    );
    setText(this.alert, s.alert ?? '');
    setStyle(this.alert, 'display', s.alert ? '' : 'none');

    // A live fuse pulses the alert line; nothing else on the HUD does, so the
    // motion alone means "the C4 is down".
    const armed = s.bombState === 'planted';
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
 * C4 PANEL — bottom centre, above the interaction prompt.
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
    setText(this.title, `DEMOLITION · ROUND ${s.round} / ${s.maxRounds}`);
    setText(
      this.sub,
      `${names[order[0]]} ${s.score[order[0]]} — ${s.score[order[1]]} ${names[order[1]]}` +
        `   ·   ${s.role === 'attack' ? 'YOU ATTACK' : 'YOU DEFEND'}`
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
