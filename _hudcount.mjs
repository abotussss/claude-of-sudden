/**
 * WHAT THE ROUND HUD ACTUALLY DRAWS, COUNTED IN THE PAGE, against what the
 * match actually has on its roster.
 *
 * Reads nothing from source. It boots a LIVE match, runs it at `time.scale` 8
 * until men are dead, then counts VISIBLE `.ow-pip` elements per side and
 * VISIBLE `.ow-sb-row` elements per side and puts them next to
 * `match.roster.filter(team)` — which is the number `RULES.teamSize` grows into
 * once the reinforcements and the hidden squads have landed.
 *
 *   node _hudcount.mjs 'http://127.0.0.1:4618/?map=plains&capture=1'
 *
 * `world.level.id` is echoed from inside the page because probes here have
 * silently run the town while reporting the plain.
 */
import { chromium } from 'playwright';

const url = process.argv[2];
const seconds = Number(process.argv[3] ?? 25);
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
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await p.waitForTimeout(seconds * 1000);

const out = await p.evaluate(() => {
  const E = window.__ENGINE__;
  const m = E.ctx.peek('match');
  const ui = E.ctx.peek('ui');
  // Force the scoreboard open without touching input: damp it to 1 by hand.
  for (let i = 0; i < 12; i++) ui.scoreboard.update(0.5, true, ui.round);
  const vis = (n) => !!n.offsetParent && getComputedStyle(n).display !== 'none';
  const cnt = (sel) => [...document.querySelectorAll(sel)].filter(vis).length;
  const per = (t) => m.roster.filter((r) => r.team === t).length;
  const alive = (t) => m.roster.filter((r) => r.team === t && r.alive).length;
  const us = m.playerTeam;
  const them = 1 - us;
  const sb = [...document.querySelectorAll('.ow-sb-side')];
  const sbRows = sb.map((s) => [...s.querySelectorAll('.ow-sb-row')].filter(vis).length);
  const sbHead = sb.map((s) => s.querySelector('.ow-sb-team').textContent);
  const more = [...document.querySelectorAll('.ow-sb-more')].map((n) => (vis(n) ? n.textContent : ''));
  const pipMore = [...document.querySelectorAll('.ow-round-more')].map((n) => (vis(n) ? n.textContent : ''));
  const cs = getComputedStyle(document.querySelector('.ow-round'));
  return {
    level: E.ctx.peek('world').level.id,
    phase: m.phase,
    playerTeam: us,
    rosterUs: per(us), rosterThem: per(them),
    aliveUs: alive(us), aliveThem: alive(them),
    hudRosterUs: ui.round.rosterUs, hudRosterThem: ui.round.rosterThem,
    pipsUs: cnt('.ow-round-pips.us .ow-pip'),
    pipsThem: cnt('.ow-round-pips.them .ow-pip'),
    pipsDownUs: cnt('.ow-round-pips.us .ow-pip.down'),
    pipsDownThem: cnt('.ow-round-pips.them .ow-pip.down'),
    countUs: document.querySelector('.ow-round-count.us').textContent,
    countThem: document.querySelector('.ow-round-count.them').textContent,
    pipMore,
    pipW: cs.getPropertyValue('--pipw').trim(),
    pipGap: cs.getPropertyValue('--pipgap').trim(),
    stripW: [
      document.querySelector('.ow-round-pips.us').getBoundingClientRect().width,
      document.querySelector('.ow-round-pips.them').getBoundingClientRect().width,
    ].map((n) => Math.round(n)),
    roundW: Math.round(document.querySelector('.ow-round').getBoundingClientRect().width),
    sbHead, sbRows, sbMore: more,
    sbSubCols: sb.map((s) => [...s.querySelectorAll('.ow-sb-col')].filter(vis).length),
    sbPanelW: Math.round(document.querySelector('.ow-sb-panel').getBoundingClientRect().width),
    sbPanelH: Math.round(document.querySelector('.ow-sb-panel').getBoundingClientRect().height),
    sbNameClipped: [...document.querySelectorAll('.ow-sb-row')].filter(vis)
      .filter((r) => { const n = r.querySelector('.n'); return n.scrollWidth > n.clientWidth + 0.5; }).length,
  };
});
out.pageerrors = errs.length;
if (errs.length) out.firstError = errs[0];
console.log(JSON.stringify(out, null, 1));

if (shot) {
  // The scoreboard is left open by the forced update above; the strip is behind
  // it, so the two are photographed separately.
  await p.screenshot({ path: `${shot}-scoreboard.png` });
  await p.evaluate(() => {
    const ui = window.__ENGINE__.ctx.peek('ui');
    for (let i = 0; i < 12; i++) ui.scoreboard.update(0.5, false, ui.round);
  });
  await p.screenshot({ path: `${shot}-strip.png` });
}
await b.close();
