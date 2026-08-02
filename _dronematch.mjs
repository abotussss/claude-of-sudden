/**
 * A WHOLE MATCH OF DRONES, MEASURED.
 *
 * 「ドローンは１試合に敵味方合わせて３０機投入すること」 is a claim that can only be
 * checked by running a match to its end, because the pacing is on
 * `_matchProgress` and not on the clock. So this runs one to the score target
 * and reports: launched per side, what became of each (detonated / shot down /
 * scuttled), how many kills the blasts scored and how many of those were
 * friendly, how often the PLAYER was locked and for how long, and the frame
 * cost with drones aloft against the cost with none.
 *
 * Usage: node _dronematch.mjs [url] [seed[,seed]] [speed]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4451/';
const SEEDS = (process.argv[3] ?? '7').split(',');
const SPEED = Number(process.argv[4] ?? 12);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

for (const SEED of SEEDS) {
  const page = await b.newPage({ viewport: { width: 900, height: 600 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  page.on('console', (m) => {
    const t = m.text();
    if (/\[drone/.test(t)) console.log(`   ${t}`);
  });
  await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

  const res = await page.evaluate(async (SPEED) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const d = m.drones;
    e.input.frozen = true; e.input.enabled = false;
    e.ctx.peek('player')?.setControlEnabled?.(false);
    e.time.scale = SPEED;
    while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));

    /** Frame cost, split by how many drones were in the air on that frame. */
    const cost = { none: [0, 0], some: [0, 0], max: 0 };
    /** Aloft histogram. */
    const hist = [0, 0, 0, 0, 0, 0];
    let lockRuns = 0;
    let wasLocked = false;
    let frames = 0;
    let last = performance.now();
    const start = performance.now();
    const launchAt = [];
    let seen = 0;

    while (performance.now() - start < 1200000) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      const ms = now - last;
      last = now;
      frames++;
      const up = d.aloft;
      hist[Math.min(5, up)]++;
      const bucket = up ? cost.some : cost.none;
      bucket[0] += ms; bucket[1]++;
      if (up && ms > cost.max) cost.max = ms;
      if (d.stats.launched > seen) {
        seen = d.stats.launched;
        launchAt.push(+(600 - m.roundClock).toFixed(1));
      }
      const locked = !!m.ui?.droneLockStrip?.active;
      if (locked && !wasLocked) lockRuns++;
      wasLocked = locked;
      if (m.phase !== 'live') break;
    }

    const gaps = [];
    for (let i = 1; i < launchAt.length; i++) gaps.push(+(launchAt[i] - launchAt[i - 1]).toFixed(1));
    return {
      phase: m.phase,
      matchSeconds: +(600 - m.roundClock).toFixed(1),
      score: m.score ?? m.capture?.score,
      stats: JSON.parse(JSON.stringify(d.stats)),
      left: d.left,
      aloftHist: hist,
      lockRuns,
      launchAt,
      gapMin: gaps.length ? Math.min(...gaps) : null,
      gapMax: gaps.length ? Math.max(...gaps) : null,
      frames,
      msNone: cost.none[1] ? +(cost.none[0] / cost.none[1]).toFixed(2) : null,
      nNone: cost.none[1],
      msSome: cost.some[1] ? +(cost.some[0] / cost.some[1]).toFixed(2) : null,
      nSome: cost.some[1],
      msWorst: +cost.max.toFixed(1),
    };
  }, SPEED);

  const s = res.stats;
  console.log(`\n═══ seed ${SEED} — ${res.matchSeconds}s of match, phase ${res.phase} ═══`);
  console.log(`  launched      ${s.launched} of 30   RED ${s.perTeam[0]} / BLUE ${s.perTeam[1]}   (${res.left} unspent)`);
  console.log(`  launch gaps   ${res.gapMin}s min / ${res.gapMax}s max   deferred ${s.deferred}`);
  console.log(`  outcomes      ${s.detonated} detonated (${s.scuttled} of them scuttled on the life clock), ${s.shotDown} shot down`);
  console.log(`  dives         ${s.dives}   missed and came round again ${s.missed}`);
  console.log(`  kills         ${s.kills}   of which friendly ${s.friendlyKills}, player ${s.playerKills}`);
  console.log(`  locks         ${s.locks} acquired, ${s.lockSeconds.toFixed(0)}s of lock in total`);
  console.log(`  player locked ${s.playerLocks} times, ${s.playerLockSeconds.toFixed(1)}s (HUD runs: ${res.lockRuns})`);
  console.log(`  aloft         0:${res.aloftHist[0]} 1:${res.aloftHist[1]} 2:${res.aloftHist[2]} 3:${res.aloftHist[3]} 4:${res.aloftHist[4]} 5+:${res.aloftHist[5]} frames`);
  console.log(`  frame cost    ${res.msNone}ms with none aloft (n=${res.nNone}) · ${res.msSome}ms with 1+ (n=${res.nSome}) · worst ${res.msWorst}ms`);
  console.log(`  pageerrors    ${errs.length}${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);
  await page.close();
}

await b.close();
