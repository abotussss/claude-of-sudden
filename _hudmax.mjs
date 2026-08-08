/**
 * THE STATED CAPS, EXERCISED — the two paths no live match reaches yet.
 *
 * `RoundStrip` stops shrinking pips at `PIP_MIN_PITCH` and `Scoreboard` stops
 * at `ROWS_PER_COL * MAX_SUBCOLS` rows a side. Both are meant to SAY what they
 * are not drawing rather than drop it silently, which is the whole defect this
 * work removes — so both have to be seen doing it, and neither the town (20)
 * nor the plain (40) is big enough to trigger them.
 *
 * This drives the real widgets exactly as `ui.update` does, on a real booted
 * page, with a synthetic HUD state of N a side. Nothing is stubbed except
 * `ui.setRound`, so that `match` stops overwriting the state under us.
 *
 *   node _hudmax.mjs 'http://127.0.0.1:4618/?capture=1' 90
 */
import { chromium } from 'playwright';

const url = process.argv[2];
const N = Number(process.argv[3] ?? 90);
const shot = process.argv[4] ?? null;

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--force-device-scale-factor=1'],
});
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(url, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await p.waitForTimeout(4000);

await p.evaluate((n) => {
  const E = window.__ENGINE__;
  const ui = E.ctx.peek('ui');
  const base = ui.round;
  const us = base.playerTeam ?? 0;
  const them = 1 - us;
  const roster = [];
  // Deterministic spread of kills so the sort has something to order by, and so
  // "fewest kills" is a real statement about who the cut drops.
  for (let t of [us, them])
    for (let i = 0; i < n; i++)
      roster.push({
        name: `${t === us ? 'CELLAR' : 'ATTIC'}-${i + 1}`,
        team: t,
        kills: (i * 7) % 23,
        deaths: (i * 5) % 17,
        alive: i % 3 !== 0,
        isPlayer: t === us && i === 0,
      });
  const fake = Object.assign({}, base, {
    rosterUs: n,
    rosterThem: n,
    aliveUs: roster.filter((r) => r.team === us && r.alive).length,
    aliveThem: roster.filter((r) => r.team === them && r.alive).length,
    roster,
  });
  ui.setRound = () => {};
  ui.round = fake;
  const sbu = ui.scoreboard.update.bind(ui.scoreboard);
  ui.scoreboard._pinned = sbu;
  ui.scoreboard.update = (dt, want, s) => sbu(dt, true, s);
}, N);
await p.waitForTimeout(1500);

const out = await p.evaluate(() => {
  const vis = (n) => !!n.offsetParent && getComputedStyle(n).display !== 'none';
  const cnt = (sel) => [...document.querySelectorAll(sel)].filter(vis).length;
  const sb = [...document.querySelectorAll('.ow-sb-side')];
  const cs = getComputedStyle(document.querySelector('.ow-round'));
  const r = window.__ENGINE__.ctx.peek('ui').round;
  return {
    asked: [r.rosterUs, r.rosterThem],
    alive: [r.aliveUs, r.aliveThem],
    pips: [cnt('.ow-round-pips.us .ow-pip'), cnt('.ow-round-pips.them .ow-pip')],
    counts: [
      document.querySelector('.ow-round-count.us').textContent,
      document.querySelector('.ow-round-count.them').textContent,
    ],
    pipMore: [...document.querySelectorAll('.ow-round-more')].map((n) => (vis(n) ? n.textContent : '(hidden)')),
    pipW: cs.getPropertyValue('--pipw').trim(),
    stripW: ['.ow-round-pips.us', '.ow-round-pips.them']
      .map((s) => Math.round(document.querySelector(s).getBoundingClientRect().width)),
    roundW: Math.round(document.querySelector('.ow-round').getBoundingClientRect().width),
    sbRows: sb.map((s) => [...s.querySelectorAll('.ow-sb-row')].filter(vis).length),
    sbMore: [...document.querySelectorAll('.ow-sb-more')].map((n) => (vis(n) ? n.textContent : '(hidden)')),
    sbHead: sb.map((s) => s.querySelector('.ow-sb-team').textContent),
    sbPanel: ['width', 'height'].map((k) =>
      Math.round(document.querySelector('.ow-sb-panel').getBoundingClientRect()[k])),
    sbNameClipped: [...document.querySelectorAll('.ow-sb-row')].filter(vis)
      .filter((r) => { const n = r.querySelector('.n'); return n.scrollWidth > n.clientWidth + 0.5; }).length,
  };
});
out.pageerrors = errs.length;
if (errs.length) out.firstError = errs[0];
console.log(JSON.stringify(out, null, 1));

if (shot) {
  const box = async (sel, pad) =>
    p.evaluate(({ sel, pad }) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad),
               width: r.width + pad * 2, height: r.height + pad * 2 };
    }, { sel, pad });
  await p.screenshot({ path: `${shot}-board.png`, clip: await box('.ow-sb-panel', 10) });
  await p.evaluate(() => {
    const ui = window.__ENGINE__.ctx.peek('ui');
    ui.scoreboard.update = ui.scoreboard._pinned;
  });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${shot}-strip.png`, clip: await box('.ow-round', 14) });
}
await b.close();
