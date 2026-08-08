/**
 * A COPY OF `_tankmatch.mjs`, DIFFERING IN ONE LINE: THE URL.
 *
 * The original does `${URL}?capture=1`, which is the truncating append this
 * tree has been bitten by — hand it `http://host/?map=plains` and it produces
 * `?map=plains?capture=1`, the map id parses as the string "plains?capture=1",
 * no level matches, and it silently measures the TOWN while reporting itself as
 * the plain. Here the map is its own argument and the query is assembled once,
 * and the run echoes `world.level.id` so the map is observed rather than
 * intended. Nothing else is changed: the measurement is the original's.
 */
/**
 * A WHOLE MATCH, AND WHAT HAPPENED TO THE TWO HULLS IN IT.
 *
 * 「戦車の体力はもっと増やして 簡単に破壊されないように」 against
 * 「ただし簡単に壊れたら面白くない」 — the two failures are opposite and both are
 * live, so this measures the middle: per hull, how long it lived, what killed
 * it, how much of the wound came from men / frags / blasts, and how many men it
 * killed. `RULES.tankHealth` is overridden at boot so one build answers for
 * several figures.
 *
 * Usage: node _tankmatch.mjs [url] [seed] [health] [speed]
 */
import { chromium } from 'playwright';
/**
 * `BASE` from the environment, exactly as its sibling `_dtankdiag.mjs` already
 * takes it. The port was baked in as a literal, so this gate could only ever be
 * run against whichever server happened to be on 4579 — and an agent told to
 * hold one preview port could not run it at all, which is how a listed gate goes
 * unmeasured. Unset, it is the same 4579 it always was.
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:4579/';
const MAP = process.env.MAP ?? 'town';

const URL = process.argv[2] ?? 'http://127.0.0.1:4383/';
const SEEDS = (process.argv[3] ?? '7').split(',');
const HEALTH = Number(process.argv[4] ?? 0);
const SPEED = Number(process.argv[5] ?? 10);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

for (const SEED of SEEDS) {
  const page = await b.newPage({ viewport: { width: 900, height: 600 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(`${BASE}?capture=1&map=${MAP}&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

  const res = await page.evaluate(async ({ SPEED, HEALTH }) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    e.input.frozen = true; e.input.enabled = false;
    e.ctx.peek('player')?.setControlEnabled?.(false);
    e.time.scale = SPEED;
    while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
    const armour = m.tank;
    void HEALTH; // the figure is `RULES.tankHealth` in the build; it is not
    // overridable from here because `airMul` and `fragMul` DERIVE from it and a
    // runtime poke would leave the bomb and the frag scaled to the old one.
    const per = {};
    for (const t of armour.tanks) per[t.id] = { id: t.id, rolled: null, died: null, full: 0 };
    /**
     * 350 GAME SECONDS, NOT THE WHOLE 600. `time.scale` is clamped by the
     * engine's own step so a nominal 10x runs at about 3.4x, and the sortie
     * fires inside the first thirty seconds — every hull that has ever been
     * killed was killed inside a hundred. Watching to the score target trebles
     * the wall clock and adds nothing to "did it survive".
     */
    /**
     * FIRED BY HAND, forty game-seconds in — the same thing `_tanklife.mjs`
     * does and for the same reason. `MatchSystem` arms the armour on the
     * CATHEDRAL coming down (`RULES.tankAfterCathedral`), which on this map is
     * later than any window a headless probe can afford: a first pass that
     * simply watched reported both hulls "SURVIVED 0 s" because neither had
     * ever left its pocket. Forty seconds is enough that the lanes are
     * populated and the men are forward, which is what the hull has to survive.
     */
    const start = performance.now();
    const fireAt = m.roundClock - 25;
    const until = m.roundClock - 150;
    let fired = false;
    while (performance.now() - start < 900000) {
      await new Promise((r) => requestAnimationFrame(r));
      if (!fired && m.roundClock <= fireAt) { fired = true; armour.fire(); }
      if (m.phase !== 'live' || m.roundClock <= until) break;
      for (const t of armour.tanks) {
        const p = per[t.id];
        if (t.state === 'parked') continue;
        if (p.rolled === null) { p.rolled = +m.roundClock.toFixed(1); p.full = t.health; }
        if (t.state === 'dead' && p.died === null) p.died = +m.roundClock.toFixed(1);
      }
    }
    const rows = armour.tanks.map((t) => {
      const p = per[t.id];
      const s = t.stats;
      return {
        id: t.id, health: p.full,
        life: p.rolled === null ? 0 : +((p.rolled - (p.died ?? m.roundClock))).toFixed(1),
        destroyed: t.state === 'dead',
        left: Math.max(0, Math.round(t.health)),
        rounds: s.rounds, roundDmg: Math.round(s.roundDmg),
        deckR: s.nDeck, deckDmg: Math.round(s.deck),
        hullR: s.nHull, hullDmg: Math.round(s.hull),
        turrR: s.nTurret, turrDmg: Math.round(s.turret),
        frags: s.frags, fragDmg: Math.round(s.fragDmg),
        blasts: s.blasts, blastDmg: Math.round(s.blastDmg),
        kills: s.kills, legs: s.legs, razed: s.razed, breaches: s.breaches,
      };
    });
    return { rows, phase: m.phase, clock: +m.roundClock.toFixed(1) };
  }, { SPEED, HEALTH });

  console.log(`\n##### seed ${SEED} · tankHealth ${HEALTH || 'default'} · ended ${res.phase} #####`);
  console.table(res.rows);
  for (const r of res.rows) {
    const men = r.roundDmg + r.fragDmg;
    console.log(`  ${r.id}: ${r.destroyed ? 'DESTROYED' : 'SURVIVED'} after ${r.life}s, ${r.left}/${r.health} left. ` +
      `Men did ${men} (${r.rounds} rounds ${r.roundDmg} + ${r.frags} frags ${r.fragDmg}); other blasts ${r.blastDmg - r.fragDmg}. ` +
      `It killed ${r.kills}, drove ${r.legs} legs, flattened ${r.razed} props.`);
  }
  if (errs.length) console.log('  PAGEERRORS:', errs);
  await page.close();
}
await b.close();
