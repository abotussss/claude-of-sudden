/**
 * Headless DOMINATION harness. Runs full matches on a time scale and reports
 * captures per side, bot captures, score over time, ownership duration, forward
 * spawn usage and the winner.
 *
 *   node domtest.mjs [--url=…] [--matches=1] [--scale=6] [--seconds=400]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4210/';
const SCALE = Number(args.scale ?? 6);
const SECONDS = Number(args.seconds ?? 400);
const MATCHES = Number(args.matches ?? 1);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE ' + m.text());
});

console.log(`[dom] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('[dom] ready');

await page.evaluate((scale) => {
  const e = window.__ENGINE__;
  window.__LOG__ = [];
  const at = () => +e.time.elapsed.toFixed(1);
  e.events.on('match:capture', (p) =>
    window.__LOG__.push({ t: at(), ev: 'capture', zone: p.zone, owner: p.owner, prev: p.previous, score: [...p.score] })
  );
  e.events.on('match:result', (p) =>
    window.__LOG__.push({ t: at(), ev: 'result', winner: p.winner, reason: p.reason, score: [...p.score], matchOver: p.matchOver })
  );
  e.events.on('match:round', (p) => window.__LOG__.push({ t: at(), ev: 'round', round: p.round }));
  e.time.scale = scale;
}, SCALE);

const sample = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const ai = e.ctx.peek('ai');
    const objectives = {};
    let inZone = [0, 0];
    for (const a of ai.agents) {
      if (!a.alive) continue;
      const o = a.objective ? a.objective.mode : 'none';
      objectives[o] = (objectives[o] ?? 0) + 1;
    }
    for (const z of m.sites) { inZone[0] += z.counts[0]; inZone[1] += z.counts[1]; }
    const st = m.capture?.stats;
    return {
      elapsed: +e.time.elapsed.toFixed(1),
      phase: m.phase,
      clock: +m.roundClock.toFixed(1),
      score: [...m.score],
      zones: m.sites.map((z) => ({
        id: z.id, own: z.owner, cap: z.capTeam,
        p: +z.progress.toFixed(2), con: z.contested, n: [...z.counts],
      })),
      inZone,
      aliveUs: m.aliveCount(m.playerTeam),
      aliveThem: m.aliveCount(1 - m.playerTeam),
      captures: st ? [...st.captures] : null,
      byBots: st ? [...st.capturesByBots] : null,
      withPlayer: st ? [...st.capturesWithPlayer] : null,
      mean: m.capture ? m.capture.meanOwnership(e.time.elapsed) : null,
      fwd: [...m._forwardSpawns],
      base: [...m._baseSpawns],
      objectives,
      log: window.__LOG__.splice(0),
    };
  });

const t0 = Date.now();
let results = 0;
let shot = false;
const series = [];
while ((Date.now() - t0) / 1000 < SECONDS) {
  const s = await sample();
  for (const l of s.log) {
    console.log('  ·', JSON.stringify(l));
    if (l.ev === 'result' && l.matchOver) results++;
  }
  series.push({ t: s.elapsed, score: s.score, zones: s.zones.map((z) => z.own).join(''), fwd: s.fwd });
  // One screenshot the first time the map is genuinely split, so the HUD is
  // captured with a zone in each side's colour rather than all neutral.
  if (args.shot && !shot && s.zones.some((z) => z.own === 0) && s.zones.some((z) => z.own === 1)) {
    shot = true;
    await page.screenshot({ path: args.shot });
    console.log(`[dom] screenshot -> ${args.shot}`);
  }
  console.log(
    `t=${String(s.elapsed).padStart(6)} ${s.phase.padEnd(9)} clock=${String(s.clock).padStart(5)} ` +
      `score=${s.score.join('-')} ` +
      s.zones.map((z) => `${z.id}:${z.own < 0 ? '-' : z.own}${z.con ? 'X' : ''}${z.p > 0 ? '(' + z.p + '→' + z.cap + ')' : ''}[${z.n.join('/')}]`).join(' ') +
      ` in=${s.inZone.join('/')} alive=${s.aliveUs}v${s.aliveThem} caps=${s.captures?.join('/')} ` +
      `bots=${s.byBots?.join('/')} fwd=${s.fwd.join('/')}/base=${s.base.join('/')} ${JSON.stringify(s.objectives)}`
  );
  if (results >= MATCHES) break;
  await page.waitForTimeout(2000);
}

const f = await sample();
for (const l of f.log) console.log('  ·', JSON.stringify(l));
console.log('\n[dom] FINAL');
console.log(JSON.stringify({
  elapsed: f.elapsed, phase: f.phase, score: f.score,
  captures: f.captures, byBots: f.byBots, withPlayer: f.withPlayer,
  meanOwnershipSeconds: f.mean, forwardSpawns: f.fwd, baseSpawns: f.base,
  zones: f.zones,
}, null, 2));
console.log('\n[dom] score over time (t, red-blue, zone owners A C B, forward spawns)');
for (const p of series) console.log(`  ${String(p.t).padStart(7)}  ${p.score.join('-').padStart(9)}  ${p.zones}  ${p.fwd.join('/')}`);
console.log('\n[dom] errors', errors.slice(0, 12));
await browser.close();
process.exit(errors.length ? 1 : 0);
