/**
 * IS THE TANK A THREAT, OR AN INVINCIBLE OBJECT?
 *
 * Runs whole matches at an accelerated clock and reports, per hull per match:
 * how long it was alive, how many men it killed, what was done to it and
 * whether it died. Two numbers decide whether this feature is balanced and
 * neither of them is time-to-kill on a test range — a tank that nobody can
 * reach is as bad as one that dies to a magazine.
 *
 * THE CLOCK IS SCALED, and that is a stated limitation rather than a hidden
 * one: `ctx.time.scale` speeds the whole simulation, so bot reaction times and
 * the tank's own reload are unchanged in SIMULATED seconds but the wall clock
 * is not. Kill counts and lifetimes below are in simulated seconds.
 *
 * Usage: node _tanklife.mjs [url] [seeds...]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4291/';
const SEEDS = process.argv.slice(3).length ? process.argv.slice(3) : ['7', '12', '106'];
const SCALE = 6;
const WALL_MS = 165000; // per match, real time — the hull now stays to the end

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const rows = [];
for (const seed of SEEDS) {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
  /**
   * NO `capture=1`. That flag drives the engine's own deterministic capture
   * loop, and under it `ctx.time.scale` is ignored: the first run of this probe
   * reported 107 simulated seconds for 105 wall seconds at scale 6, never
   * reached the cathedral event that arms the armour, and measured 0 sorties in
   * three matches. Let the match run normally instead.
   */
  await page.goto(`${URL}?seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

  await page.evaluate(() => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    window.__TANKLOG__ = [];
    e.ctx.events.on('match:tank', (ev) => {
      window.__TANKLOG__.push({ phase: ev.phase, id: ev.id, t: +e.ctx.time.elapsed.toFixed(1) });
    });
    if (m.phase !== 'live') m._setPhase?.('live', 0);
    m.roundClock = 1e6;              // do not let the round end mid-sortie
    m._checkWinConditions = () => {};
  });

  /* Let the roster actually make contact before the armour rolls out. */
  await page.waitForTimeout(30000);
  await page.evaluate(() => window.__ENGINE__.ctx.peek('match').tank.fire());

  /* Watch the whole sortie: both hulls parked or dead, or a hard cap. */
  const t0 = Date.now();
  while (Date.now() - t0 < WALL_MS) {
    const done = await page.evaluate(() => {
      const a = window.__ENGINE__.ctx.peek('match').tank;
      return a.tanks.every((t) => t.state === 'parked' || t.state === 'dead');
    });
    if (done) break;
    await page.waitForTimeout(2000);
  }

  const out = await page.evaluate(() => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const a = m.tank;
    return {
      elapsed: +e.ctx.time.elapsed.toFixed(0),
      seed: e.levelSeed,
      phase: m.phase,
      score: m.score ? [...m.score] : null,
      log: window.__TANKLOG__.slice(0, 40),
      tanks: a.tanks.map((t) => ({
        id: t.id, state: t.state, health: Math.round(t.health),
        s: { ...t.stats },
      })),
    };
  });
  out.errs = errs;
  rows.push(out);
  console.log(`seed ${out.seed}: t=${out.elapsed}s phase=${out.phase} score=${JSON.stringify(out.score)}`);
  for (const t of out.tanks) {
    const s = t.s;
    console.log(
      `   ${t.id.padEnd(4)} sorties=${s.sorties} alive=${s.liveT.toFixed(0)}s kills=${s.kills} deaths=${s.deaths} ` +
      `state=${t.state} hp=${t.health}/2600  taken: ${s.rounds} rounds ${s.roundDmg.toFixed(0)} ` +
      `(hull ${s.hull.toFixed(0)}/turret ${s.turret.toFixed(0)}/deck ${s.deck.toFixed(0)}), ` +
      `${s.frags} frags ${s.fragDmg.toFixed(0)}, ${s.blasts} blasts ${s.blastDmg.toFixed(0)}`
    );
  }
  const ph = out.log.map((l) => `${l.id}:${l.phase}@${l.t}`).join(' ');
  if (ph) console.log(`   events: ${ph}`);
  if (errs.length) console.log(`   pageerrors: ${errs.slice(0, 3).join(' | ')}`);
  await page.close();
}

/* ---- roll-up ------------------------------------------------------------ */
let sorties = 0, kills = 0, deaths = 0, live = 0, hulls = 0;
for (const r of rows) for (const t of r.tanks) {
  sorties += t.s.sorties; kills += t.s.kills; deaths += t.s.deaths; live += t.s.liveT; hulls++;
}
console.log(`\n=== ${rows.length} matches, ${hulls} hull-matches ===`);
console.log(`  sorties ${sorties}  destroyed ${deaths}  kills ${kills}  total time alive ${live.toFixed(0)}s`);
console.log(`  per sortie: ${(live / Math.max(1, sorties)).toFixed(1)}s alive, ${(kills / Math.max(1, sorties)).toFixed(2)} kills`);
console.log(`  survival: ${sorties ? (100 * (1 - deaths / sorties)).toFixed(0) : '-'}% of sorties ended with the hull intact`);
await browser.close();
