/**
 * HOW FAST DOES A BOT ACTUALLY PULL — 「敵味方連射しないね 単発を数回打つだけ」
 *
 * `_burstvoice.mjs --mode=live` measured a burst median of 2 rounds and 3.4
 * rounds a second against an authored `rpm` of 600-1050 (`src/ai/agent.js`
 * WEAPONS). Either the bots are not firing automatic, or the burst grouping was
 * wrong. This settles it with no grouping at all: every round every agent sends,
 * stamped, and the raw inter-round interval distribution per weapon.
 *
 * `weapon:fire` carries no shooter, so this hooks `ai.onAgentFire`, which does.
 * Nothing is muted and nothing is injected — this is the war as it runs.
 *
 *   node _burstcadence.mjs --map=plains --seconds=60 --drive
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const MAP = args.map ?? 'plains';
const SECONDS = Number(args.seconds ?? 60);
const WARM = Number(args.warm ?? 40);
const PORT = args.port ?? '4633';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-frame-rate-limit',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:${PORT}/?map=${MAP}${args.nocap ? '' : '&capture=1'}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await page.evaluate(async () => {
  const a = window.__ENGINE__.ctx.peek('audio');
  try { await a?.start?.(); } catch { /* reported below */ }
  window.__ENGINE__.ctx.time.scale = 8;
});
await page.waitForTimeout(WARM * 1000);

const boot = await page.evaluate((drive) => {
  const e = window.__ENGINE__, ctx = e.ctx;
  const a = ctx.peek('audio'), ai = ctx.peek('ai'), pl = ctx.peek('player');
  ctx.time.scale = 1;
  /**
   * TWO CLOCKS, AND THE DIFFERENCE BETWEEN THEM IS A TRAP.
   *
   * `Engine.step` clamps `rawDt` at 0.1 s, so a headless page rendering under
   * 10 fps runs the SIMULATION in slow motion while the wall clock — and
   * `actx.currentTime`, which is what every audio rate gate is measured on —
   * keeps real time. Stamping rounds with `performance.now()` alone would
   * report a bot's rate of fire as the harness's frame rate. `ctx.time.raw` is
   * the sim's own unscaled seconds; both are recorded and both are reported.
   */
  const M = { t0: performance.now() / 1000, g0: ctx.time.raw, rounds: 0, gaps: [], gamegaps: [],
    byWeapon: {}, shooters: new Set(), teleports: 0, frames0: ctx.time.frame };
  window.__M__ = M;
  const last = new Map(), lastG = new Map();
  const oaf = ai.onAgentFire.bind(ai);
  ai.onAgentFire = (agent, origin, dir) => {
    const t = performance.now() / 1000;
    const tg = ctx.time.raw;
    const pg = lastG.get(agent.id);
    if (pg !== undefined) { const gg = +(tg - pg).toFixed(4); if (gg < 2) M.gamegaps.push(gg); }
    lastG.set(agent.id, tg);
    M.rounds++;
    M.shooters.add(agent.id);
    const w = agent.weaponAudio ?? '?';
    const bw = M.byWeapon[w] ?? (M.byWeapon[w] = { n: 0, gaps: [] });
    bw.n++;
    const p = last.get(agent.id);
    if (p !== undefined) {
      const g = +(t - p).toFixed(4);
      // Only intervals short enough to belong to the same trigger pull; longer
      // ones are the gap between engagements and would swamp the statistic.
      if (g < 2) { M.gaps.push(g); bw.gaps.push(g); }
    }
    last.set(agent.id, t);
    return oaf(agent, origin, dir);
  };
  window.__IV__ = setInterval(() => {
    if (!drive || !pl) return;
    if (pl.health !== undefined && pl.health < 90) pl.health = 100;
    M._t = (M._t ?? 0) + 0.1;
    if (M._t < 3) return;
    M._t = 0;
    const hot = (ai?.agents ?? []).filter((g) => g?.alive && g.position && (g.hasTarget || g.target));
    if (!hot.length) return;
    const g = hot[(M.teleports * 7 + 3) % hot.length];
    try { pl.teleport({ x: g.position.x + 1.2, y: g.position.y + 1.62, z: g.position.z + 1.2 }, 0); M.teleports++; } catch { /* best effort */ }
  }, 100);
  return { level: ctx.peek('world').level.id, phase: ctx.peek('match')?.phase ?? '?', agents: ai.agents.length };
}, !!args.drive);
console.log('[cadence] boot:', JSON.stringify(boot));

await page.waitForTimeout(SECONDS * 1000);

const out = await page.evaluate(() => {
  clearInterval(window.__IV__);
  const M = window.__M__;
  const secs = performance.now() / 1000 - M.t0;
  const q = (x, p) => { if (!x.length) return null; const s = [...x].sort((u, v) => u - v); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3); };
  const hist = (g) => {
    const b = { '<0.08': 0, '0.08-0.12': 0, '0.12-0.2': 0, '0.2-0.35': 0, '0.35-0.6': 0, '0.6-1.0': 0, '1.0-2.0': 0 };
    for (const v of g) {
      if (v < 0.08) b['<0.08']++; else if (v < 0.12) b['0.08-0.12']++; else if (v < 0.2) b['0.12-0.2']++;
      else if (v < 0.35) b['0.2-0.35']++; else if (v < 0.6) b['0.35-0.6']++; else if (v < 1.0) b['0.6-1.0']++;
      else b['1.0-2.0']++;
    }
    return b;
  };
  const byW = {};
  for (const [k, v] of Object.entries(M.byWeapon)) {
    byW[k] = { rounds: v.n, gapMed: q(v.gaps, 0.5), gapP10: q(v.gaps, 0.1), impliedRps: v.gaps.length ? +(1 / q(v.gaps, 0.5)).toFixed(1) : null };
  }
  const gsecs = window.__ENGINE__.ctx.time.raw - M.g0;
  const frames = window.__ENGINE__.ctx.time.frame - M.frames0;
  return {
    seconds: +secs.toFixed(1), gameSeconds: +gsecs.toFixed(1),
    fps: +(frames / secs).toFixed(1), simSpeed: +(gsecs / secs).toFixed(3),
    rounds: M.rounds, shooters: M.shooters.size,
    roundsPerSecWall: +(M.rounds / secs).toFixed(2),
    roundsPerSecGame: +(M.rounds / gsecs).toFixed(2),
    interRoundGapWall: { n: M.gaps.length, p10: q(M.gaps, 0.1), median: q(M.gaps, 0.5), p90: q(M.gaps, 0.9) },
    /** THE HONEST ONE: what the bot's own clock thinks its rate of fire is. */
    interRoundGapGame: { n: M.gamegaps.length, p10: q(M.gamegaps, 0.1), median: q(M.gamegaps, 0.5), p90: q(M.gamegaps, 0.9) },
    impliedRpsGame: M.gamegaps.length ? +(1 / q(M.gamegaps, 0.5)).toFixed(1) : null,
    impliedRpsAtMedian: M.gaps.length ? +(1 / q(M.gaps, 0.5)).toFixed(1) : null,
    /** THE ONE THAT MATTERS: how many consecutive rounds land inside 150 ms of
     * each other — that is what "連射" means to an ear. */
    fracAutoPaced: +(M.gaps.filter((g) => g < 0.15).length / Math.max(1, M.gaps.length)).toFixed(3),
    histogram: hist(M.gaps),
    byWeapon: byW,
  };
});
console.log(JSON.stringify(out, null, 1));
console.log(`pageerrors=${errs.length}`);
if (errs.length) console.log(' first:', errs[0]);
await browser.close();
