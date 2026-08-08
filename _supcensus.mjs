/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHO SUPPRESSES A BOT, HOW OFTEN, AND BY HOW MUCH — the reciprocal path
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node _supcensus.mjs --url=http://127.0.0.1:4628/ --map=town --secs=90
 *
 * `48850d5` is accused of taking the bots' legs by turning every near miss into
 * a suppression event. `player.onNearMiss` is a method on `PlayerSystem`, so
 * the accusation is a claim about a path — and a path is measurable. This
 * counts, in a live 40 v 40:
 *
 *   • every call to `Agent.suppress`, wrapped on the prototype, with its amount
 *   • the same total RECONSTRUCTED from the four event handlers in
 *     `src/ai/index.js` that are its only callers, using each handler's own
 *     arithmetic on the event's own payload. If the reconstruction matches the
 *     wrapper, the attribution is exact rather than assumed.
 *   • every call to `player.onNearMiss`, with the suppression it adds — to the
 *     PLAYER, which is the only thing it can reach
 *   • what the pool is actually worth to a bot's feet: the man-second-weighted
 *     mean of `suppression`, the share of man-seconds over the 0.6 that used to
 *     matter, and the mean of the speed factor `(1 - suppression * 0.25)` that
 *     `_drive` multiplies into every desired speed.
 *
 * Nothing is decided here. It only reports.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4628/';
const MAP = args.map ?? 'town';
const SECS = +(args.secs ?? 90);
const WARM = +(args.warm ?? 120);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&map=${MAP}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id =', await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

const out = await page.evaluate(async ({ SECS, WARM }) => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const ai = ctx.peek('ai');
  const m = ctx.peek('match');
  const pl = ctx.peek('player');
  e.input.frozen = true; e.input.enabled = false;
  pl?.setControlEnabled?.(false);
  const frame = () => new Promise((r) => requestAnimationFrame(r));

  e.time.scale = 12;
  while (m.phase !== 'live' || ai.agents.length === 0) await frame();
  const t0 = m.roundClock;
  while (t0 - m.roundClock < WARM && m.phase === 'live') await frame();
  e.time.scale = 1;
  await frame(); await frame();

  const A = ai.agents[0].constructor.prototype;
  const S = {
    calls: 0, sum: 0, hist: Object.create(null),
    recon: Object.create(null), reconSum: 0, reconCalls: 0,
    nearMiss: 0, nearMissSup: 0,
    manSecs: 0, supIntegral: 0, over06: 0, speedFactor: 0,
    secs: 0,
  };
  const bucket = (v) => (v < 0.1 ? '<0.10' : v < 0.2 ? '0.10-0.20' : v < 0.3 ? '0.20-0.30'
    : v < 0.5 ? '0.30-0.50' : v < 0.8 ? '0.50-0.80' : '>=0.80');

  const sup0 = A.suppress;
  A.suppress = function (amount) {
    if (this.alive) { S.calls++; S.sum += amount; S.hist[bucket(amount)] = (S.hist[bucket(amount)] ?? 0) + 1; }
    return sup0.call(this, amount);
  };

  /* --- the four handlers' own arithmetic, on the same events -------------- */
  const add = (k, a) => {
    S.recon[k] = S.recon[k] ?? { n: 0, sum: 0 };
    S.recon[k].n++; S.recon[k].sum += a; S.reconCalls++; S.reconSum += a;
  };
  const V = ctx.camera.position.constructor;
  const _p = new V(), _q = new V();
  const rayDist = (pos, origin, dir, eyeH) => {
    _p.set(pos.x, pos.y + (eyeH ?? 1.6) * 0.5, pos.z).sub(origin);
    const t = Math.max(0, _p.x * dir.x + _p.y * dir.y + _p.z * dir.z);
    _q.set(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
    return Math.hypot(_q.x - pos.x, _q.y - (pos.y + (eyeH ?? 1.6) * 0.5), _q.z - pos.z);
  };
  const offs = [];
  offs.push(ctx.events.on('weapon:fire', (ev) => {
    if (!ev || !ev.origin || ev.weapon === 'ai_rifle' || !ev.dir) return;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      const d = rayDist(a.position, ev.origin, ev.dir, a.eyeHeight);
      if (d < 2.6) add('weapon:fire (a round cracking past)', 0.45 * (1 - d / 2.6) + 0.12);
    }
  }));
  offs.push(ctx.events.on('bullet:impact', (ev) => {
    if (!ev || !ev.point) return;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      const d = a.position.distanceTo(ev.point);
      if (d < 3.2) add('bullet:impact (a round landing near)', 0.5 * (1 - d / 3.2));
    }
  }));
  offs.push(ctx.events.on('damage:dealt', (ev) => {
    if (!ev || !ev.target || !ai.agents.includes(ev.target) || !ev.target.alive) return;
    const src = ev.source ?? null;
    if (src && src !== ev.target && !ai.friendlyFire && ai.teamOf(src) === ev.target.team) {
      add('damage:dealt (a team-mate\'s round)', 0.25);
    }
  }));
  offs.push(ctx.events.on('explosion', (ev) => {
    if (!ev || !ev.position) return;
    const radius = ev.radius ?? 5;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      const d = a.position.distanceTo(ev.position) + 0.001;
      if (d > radius) continue;
      add('explosion', 1.4 * (1 - d / radius));
    }
  }));

  /* --- and the player's own feed, the thing 48850d5 wired up ------------- */
  const nm0 = pl.onNearMiss?.bind(pl);
  if (nm0) {
    const before = () => pl.suppression ?? pl.health?.suppression ?? 0;
    pl.onNearMiss = (miss) => {
      const b0 = before();
      S.nearMiss++;
      nm0(miss);
      S.nearMissSup += Math.max(0, before() - b0);
    };
  }

  const tStart = m.roundClock;
  while (tStart - m.roundClock < SECS && m.phase === 'live') {
    await frame();
    const dt = e.time.dt;
    S.secs += dt;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      S.manSecs += dt;
      const s = a.suppression ?? 0;
      S.supIntegral += s * dt;
      if (s > 0.6) S.over06 += dt;
      S.speedFactor += (1 - s * 0.25) * dt;
    }
  }
  A.suppress = sup0;
  for (const o of offs) o?.();
  if (nm0) pl.onNearMiss = nm0;
  S.agents = ai.agents.filter((a) => a.alive).length;
  return S;
}, { SECS, WARM });

const mm = out.manSecs / 60;
console.log(`\n═══ SUPPRESSION CENSUS — ${out.secs.toFixed(0)} s, ${out.manSecs.toFixed(0)} man-seconds ═══`);
console.log(`Agent.suppress: ${out.calls} calls, ${out.sum.toFixed(1)} total shove` +
  `  =  ${(out.calls / out.manSecs).toFixed(3)} calls/man-s, ${(out.sum / out.manSecs).toFixed(4)} shove/man-s`);
console.log(`reconstructed:  ${out.reconCalls} calls, ${out.reconSum.toFixed(1)} total` +
  `   (${out.calls ? (100 * out.reconCalls / out.calls).toFixed(1) : '-'} % of the wrapped count)`);
console.log('\nWHERE A BOT\'S SUPPRESSION COMES FROM:');
for (const [k, v] of Object.entries(out.recon).sort((a, c) => c[1].sum - a[1].sum)) {
  console.log(`  ${k.padEnd(38)} ${String(v.n).padStart(6)} calls  ${v.sum.toFixed(1).padStart(8)} shove  ` +
    `${(100 * v.sum / (out.reconSum || 1)).toFixed(1).padStart(5)} %`);
}
console.log(`\nplayer.onNearMiss: ${out.nearMiss} calls (${(out.nearMiss / out.secs).toFixed(3)}/s), ` +
  `${out.nearMissSup.toFixed(3)} suppression added — TO THE PLAYER. Bots: 0 of the above.`);
console.log(`\nWHAT THE POOL IS WORTH TO A BOT'S FEET:` +
  `\n  mean suppression        ${(out.supIntegral / out.manSecs).toFixed(4)}` +
  `\n  man-seconds over 0.6    ${(100 * out.over06 / out.manSecs).toFixed(2)} %` +
  `\n  mean (1 - sup * 0.25)   ${(out.speedFactor / out.manSecs).toFixed(4)}   <- the factor _drive multiplies in`);
console.log(`\npageerrors ${errs.length} ${errs[0] ?? ''}`);
await b.close();
