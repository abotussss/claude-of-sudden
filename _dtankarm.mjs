/**
 * BEFORE AND AFTER, IN THE SAME 220 SECONDS.
 *
 * `_dtankwar.mjs` measures a whole match and takes twenty-five minutes; the
 * window it is really reporting on is the two hundred seconds after the armour
 * rolls, because nothing can happen to a hull before that. So this rolls all
 * six by hand on the first live frame and watches exactly that window — the
 * same window `_dminefield.mjs` uses, so the four placement rules and the two
 * builds are all on one clock.
 *
 * It reads NOTHING that only the new build has: `armour.kills`, `lastOrd` and
 * `mineStats` are all optional, so the identical file answers for HEAD and for
 * the change and the two columns are comparable rather than merely adjacent.
 *
 *   hulls destroyed / 6, and to what
 *   frames in which a hull had its gun on ANOTHER HULL  (0 before, by
 *     construction: `MatchSystem._tankEnemies` builds the crew's target list
 *     from `_botsByTeam` plus the player and has never contained a vehicle)
 *   main-gun damage taken from enemy armour, per hull
 *
 * Usage: BASE=http://127.0.0.1:4638/ MAP=plains node _dtankarm.mjs [seeds] [secs]
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4638/';
const MAP = process.env.MAP ?? 'plains';
const SEEDS = (process.argv[2] ?? '7,12').split(',');
const SECS = Number(process.argv[3] ?? 220);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

for (const SEED of SEEDS) {
  const page = await b.newPage({ viewport: { width: 800, height: 520 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(`${BASE}?capture=1&map=${MAP}&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

  const res = await page.evaluate(async ({ SECS }) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    e.input.frozen = true; e.input.enabled = false;
    e.ctx.peek('player')?.setControlEnabled?.(false);
    e.time.scale = 8;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    while (m.phase !== 'live') await frame();
    const armour = m.tank;
    armour.fire();
    let onArmour = 0;
    let bothWays = 0;
    const t0 = m.roundClock;
    while (t0 - m.roundClock < SECS && m.phase === 'live') {
      await frame();
      let n = 0;
      for (const t of armour.tanks) if (t.alive && t.target?.isTank === true) n++;
      if (n) onArmour++;
      if (n >= 2) bothWays++;
    }
    return {
      dead: armour.tanks.filter((t) => t.state === 'dead').map((t) => `${t.id}:${t.lastOrd ?? '?'}`),
      kills: armour.kills ? { ...armour.kills } : null,
      onArmour, bothWays,
      shells: armour.tanks.map((t) => `${t.id} ${t.stats.shells ?? 0}sh/${Math.round(t.stats.shellDmg ?? 0)}`),
      minH: armour.tanks.map((t) => Math.round(t.health)),
      secs: +(t0 - m.roundClock).toFixed(0),
    };
  }, { SECS });

  console.log(
    `seed ${SEED}: hulls dead ${res.dead.length}/6 [${res.dead.join(' ')}] · ` +
    `kills ${JSON.stringify(res.kills)} · frames laying on ARMOUR ${res.onArmour} (both ways ${res.bothWays}) · ${res.secs}s\n` +
    `          health ${JSON.stringify(res.minH)}\n` +
    `          ${res.shells.join(' · ')}` + (errs.length ? `  [pageerror ${errs.length}]` : '')
  );
  await page.close();
}
await b.close();
