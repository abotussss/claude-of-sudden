/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DID THE CATHEDRAL BRING THE ENEMY WITH IT? — the drop's new trigger, timed
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node _cathdrop.mjs <url> <seed> [maxWallSeconds]
 *
 * The change under test is a TIMING one, so this measures time and nothing
 * else that is already proved elsewhere (`_reinaudit.mjs` owns "ten men land,
 * none respawn"; `_elitewatch.mjs` owns what an elite IS). Five numbers:
 *
 *   WHEN THE CATHEDRAL WENT   `_beginCathedralEvent` wrapped, so the beat that
 *                             arms the drop is timed at its source.
 *   WHEN THE DROP FIRED       `Reinforcements.fire` wrapped, with the team, the
 *                             score, and the lag from the cathedral call.
 *   FOR WHICH SIDE            the team on the call, printed against
 *                             `match.playerTeam` — the whole point of the
 *                             change is that it is the side the player is NOT
 *                             on, so the raw index alone would not prove it.
 *   HOW LONG THE TEN EXISTED  per man: touchdown to his death, or to the final
 *                             whistle if he outlived the match. `alive` is
 *                             sampled every frame off his own roster record.
 *   WHAT THEY DID             kills off the same records at the end.
 *
 * The match runs to its NATURAL end — the score target or the clock, whichever
 * the sim reaches — and nothing is written back into it.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4522/';
const SEED = process.argv[3] ?? '11';
const MAXW = Number(process.argv[4] ?? 600) * 1000;

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const ready = await page.evaluate('window.__READY__');

const res = await page.evaluate(async (MAXW) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.time.scale = 12;
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  const matchTime = m.roundClock;
  const t = () => +(matchTime - m.roundClock).toFixed(1);

  /* ---- the cathedral, at its own call site ----------------------------- */
  let cathT = -1;
  const cath0 = m._beginCathedralEvent.bind(m);
  m._beginCathedralEvent = (tt, p) => {
    if (cathT < 0) cathT = t();
    return cath0(tt, p);
  };
  /** The frame the arming beat played, and the frame the event was spent. */
  let armT = -1;
  let cathEndT = -1;

  /* ---- the call -------------------------------------------------------- */
  const R = m.reinforce;
  const drops = [];
  const fire0 = R.fire.bind(R);
  R.fire = (o) => {
    const ok = fire0(o);
    if (ok)
      drops.push({
        t: t(),
        team: o.team,
        label: o.label,
        score: m.score.slice(),
        lifeSaid: +m._matchLifeLeft().toFixed(1),
      });
    return ok;
  };

  /* ---- the men --------------------------------------------------------- */
  const men = [];
  const land0 = R.onLand;
  R.onLand = (i, p, yaw) => {
    const n0 = m.roster.length;
    land0(i, p, yaw);
    if (m.roster.length <= n0) return;
    const rec = m.roster[m.roster.length - 1];
    men.push({ rec, i, landT: t(), deadT: -1 });
  };

  const start = performance.now();
  while (performance.now() - start < MAXW) {
    await new Promise((r) => requestAnimationFrame(r));
    if (armT < 0 && m._reinforcePending === true) armT = t();
    if (cathT >= 0 && cathEndT < 0 && m._cath.t < 0) cathEndT = t();
    for (const w of men) if (w.deadT < 0 && !w.rec.alive) w.deadT = t();
    if (m.phase !== 'live' || m.roundClock <= 0) break;
  }
  const end = t();

  return {
    seed: e.levelSeed,
    playerTeam: m.playerTeam,
    cathT,
    armT,
    cathEndT,
    drops,
    end,
    phase: m.phase,
    score: m.score.slice(),
    winner: m.score[0] === m.score[1] ? -1 : m.score[0] > m.score[1] ? 0 : 1,
    insertion: +R.insertionSeconds.toFixed(2),
    stats: JSON.parse(JSON.stringify(m.reinforceStats)),
    men: men.map((w) => ({
      i: w.i,
      name: w.rec.name,
      team: w.rec.team,
      landT: w.landT,
      deadT: w.deadT,
      /** His whole existence, in seconds of match. */
      life: +((w.deadT < 0 ? end : w.deadT) - w.landT).toFixed(1),
      survived: w.deadT < 0,
      kills: w.rec.kills,
      noRespawn: w.rec.noRespawn === true,
    })),
    rosterRein: m.roster.filter((r) => r.reinforcement).length,
  };
}, MAXW);

const TEAM = ['RED', 'BLUE'];
const d = res.drops[0];
console.log(`\n══ seed ${res.seed} ═════════════════════════════════════════════`);
console.log(`  __READY__ ${ready}   pageerrors ${errs.length}${errs.length ? ` :: ${errs.join(' | ')}` : ''}`);
console.log(
  `  match     ended t=${res.end}s phase=${res.phase} score ${res.score.join('-')} ` +
    `winner ${res.winner < 0 ? 'DRAW' : TEAM[res.winner]}`
);
console.log(
  `  cathedral called t=${res.cathT}s · drop armed t=${res.armT}s · event spent t=${res.cathEndT}s`
);
if (!d) console.log('  DROP      NONE');
else {
  const enemy = 1 - res.playerTeam;
  console.log(
    `  DROP      t=${d.t}s for ${TEAM[d.team]} · player is ${TEAM[res.playerTeam]} · ` +
      `${d.team === enemy ? 'ENEMY ✓' : '*** THE PLAYER OWN SIDE ***'}`
  );
  console.log(
    `            ${d.label} · score ${d.score.join('-')} · lag from cathedral ` +
      `${(d.t - res.cathT).toFixed(1)}s · life estimate said ${d.lifeSaid}s ` +
      `(needed ${(res.insertion + 7).toFixed(1)}s)`
  );
}
if (res.men.length) {
  const lives = res.men.map((x) => x.life);
  const kills = res.men.map((x) => x.kills);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  console.log(
    `  TEN MEN   ${res.men.length} landed (roster ${res.rosterRein}) · first boots t=${res.men[0].landT}s ` +
      `· last t=${res.men[res.men.length - 1].landT}s`
  );
  console.log(
    `            existed ${Math.min(...lives)}-${Math.max(...lives)}s, mean ` +
      `${(sum(lives) / lives.length).toFixed(1)}s · ${res.men.filter((x) => x.survived).length} ` +
      `alive at the whistle`
  );
  console.log(
    `            kills ${sum(kills)} total, ${(sum(kills) / kills.length).toFixed(2)} each ` +
      `(max ${Math.max(...kills)}) · noRespawn ${res.men.every((x) => x.noRespawn)}`
  );
  for (const x of res.men)
    console.log(
      `              ${x.name.padEnd(9)} land ${String(x.landT).padStart(6)}s  ` +
        `${x.survived ? 'SURVIVED'.padEnd(14) : `died ${String(x.deadT).padStart(6)}s`}  ` +
        `life ${String(x.life).padStart(6)}s  kills ${x.kills}`
    );
}
console.log(
  `  stats     calls ${res.stats.calls} · landed ${res.stats.landed.join('/')} · ` +
    `lost ${res.stats.lost.join('/')} · refused-late ${res.stats.late}`
);

await b.close();
