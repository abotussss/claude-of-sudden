/**
 * WHAT KILLS A TANK, AND WHO EVEN TRIES.
 *
 * `_tanklife.mjs` declared `const SCALE = 6` and never assigned it to
 * `ctx.time.scale`, so every match it has ever reported ran at 1x and its
 * "the armour never rolled" lines are a probe budget expiring rather than a
 * feature failing. This one scales the clock, runs each match to its natural
 * end, and answers the question that was blocked behind that:
 *
 *   - how long each hull lived and what finally killed it
 *   - how many attempts were made on it, and with what
 *   - WHETHER THE AI CAN EVEN SEE IT: `ai.hostilesOf(team)` is sampled while a
 *     hull is alive and inside `RULES.tankRange` of live men, and every bot's
 *     current target is checked for `isTank`.
 *
 * Usage: node _tankfate.mjs [url] [scale] [seeds...]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4291/';
const SCALE = +(process.argv[3] ?? 12);
const SEEDS = process.argv.slice(4).length ? process.argv.slice(4) : ['7', '12', '21'];
const WALL_MS = 260000;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const rows = [];
for (const seed of SEEDS) {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const errs = [];
  const logs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  page.on('console', (m) => {
    const t = m.text();
    if (/\[tank\]|destroyed by|match\] .*result|TANK/.test(t)) logs.push(t.slice(0, 220));
  });
  await page.goto(`${URL}?seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

  await page.evaluate((SCALE) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    e.ctx.time.scale = SCALE;
    window.__TL__ = [];
    window.__AIM__ = { men: 0, samples: 0, botsSeeingTank: 0, botTargetIsTank: 0, hostileListHadTank: 0, menInRange: 0 };
    e.ctx.events.on('match:tank', (ev) => {
      window.__TL__.push({ phase: ev.phase, id: ev.id, t: +e.ctx.time.elapsed.toFixed(1) });
    });
    e.ctx.events.on('match:result', (ev) => {
      window.__TL__.push({ phase: `RESULT ${ev.reason}`, id: '', t: +e.ctx.time.elapsed.toFixed(1) });
    });
    /**
     * DO NOT FORCE THE PHASE. `m._setPhase('live', 0)` at t=0 skips the freeze
     * the match spawns its rosters in: measured over three seeds it produced
     * 600 s matches with score [0,0], every zone neutral, and `ai.agents`
     * empty — a probe reporting on a map with nobody on it. Let it start.
     */
  }, SCALE);

  const t0 = Date.now();
  let best = null;
  let done = false;
  while (Date.now() - t0 < WALL_MS && !done) {
    const snap = await page.evaluate(() => {
      const e = window.__ENGINE__;
      const m = e.ctx.peek('match');
      const ai = e.ctx.peek('ai');
      const a = m.tank;
      /* ---- can a bot even see a hull? ---- */
      const A = window.__AIM__;
      for (const t of a.tanks) {
        if (t.state !== 'advance' && t.state !== 'hold') continue;
        A.samples++;
        for (const team of [0, 1]) {
          if (team === t.team) continue;
          const list = ai.hostilesOf(team) ?? [];
          for (const h of list) if (h?.isTank) A.hostileListHadTank++;
        }
        const foes = (ai.agents ?? []).filter((g) => g.alive && ai.teamOf(g) !== t.team);
        A.men = (ai.agents ?? []).length;
        for (const g of foes) {
          const d = Math.hypot(g.position.x - t.position.x, g.position.z - t.position.z);
          if (d < 85) A.menInRange++;
          if (g.target?.isTank) A.botTargetIsTank++;
        }
      }
      return {
        elapsed: +e.ctx.time.elapsed.toFixed(0),
        seed: e.levelSeed, phase: m.phase,
        score: m.score ? [...m.score] : null,
        zones: (m.allZones ?? []).map((z) => `${z.id}:${z.owner}`).join(' '),
        tanks: a.tanks.map((t) => ({
          id: t.id, state: t.state, health: Math.round(t.health), s: { ...t.stats },
        })),
        aim: { ...window.__AIM__ },
        log: (window.__TL__ ?? []).slice(0, 60),
        over: m.phase === 'over' || m.phase === 'result' || m.matchOver === true,
      };
    });
    if (snap.tanks.some((t) => t.s.sorties > 0)) best = snap;
    if (snap.over) done = true;
    if (!done) await page.waitForTimeout(2000);
  }
  const out = best ?? (await page.evaluate(() => {
    const e = window.__ENGINE__; const m = e.ctx.peek('match'); const a = m.tank;
    return {
      elapsed: +e.ctx.time.elapsed.toFixed(0), seed: e.levelSeed, phase: m.phase,
      score: m.score ? [...m.score] : null, zones: '',
      tanks: a.tanks.map((t) => ({ id: t.id, state: t.state, health: Math.round(t.health), s: { ...t.stats } })),
      aim: { ...window.__AIM__ }, log: (window.__TL__ ?? []).slice(0, 60), over: false,
    };
  }));
  out.errs = errs; out.logs = logs;
  rows.push(out);
  console.log(`\n=== seed ${out.seed}: t=${out.elapsed}s phase=${out.phase} score=${JSON.stringify(out.score)} zones ${out.zones}`);
  for (const t of out.tanks) {
    const s = t.s;
    console.log(
      `   ${t.id.padEnd(4)} sorties=${s.sorties} alive=${s.liveT.toFixed(0)}s kills=${s.kills} deaths=${s.deaths} ` +
      `state=${t.state} hp=${t.health}/2600 | taken ${s.rounds} rounds ${s.roundDmg.toFixed(0)} ` +
      `(hull ${s.hull.toFixed(0)}/turret ${s.turret.toFixed(0)}/deck ${s.deck.toFixed(0)}), ` +
      `${s.frags} frags ${s.fragDmg.toFixed(0)}, ${s.blasts} blasts ${s.blastDmg.toFixed(0)}`
    );
  }
  const A = out.aim;
  console.log(`   ai: ${A.samples} samples with a hull out — hostile list contained a tank ${A.hostileListHadTank}x, ` +
    `a bot was AIMING at one ${A.botTargetIsTank}x, men within 85 m ${A.menInRange}, roster ${A.men}`);
  console.log(`   events: ${out.log.map((l) => `${l.id}${l.id ? ':' : ''}${l.phase}@${l.t}`).join(' ')}`);
  for (const l of out.logs.filter((x) => /DESTROYED|destroyed by/.test(x))) console.log(`   ${l}`);
  if (errs.length) console.log(`   pageerrors: ${errs.slice(0, 3).join(' | ')}`);
  await page.close();
}

let sorties = 0, kills = 0, deaths = 0, live = 0, rounds = 0, frags = 0, blasts = 0;
for (const r of rows) for (const t of r.tanks) {
  sorties += t.s.sorties; kills += t.s.kills; deaths += t.s.deaths; live += t.s.liveT;
  rounds += t.s.rounds; frags += t.s.frags; blasts += t.s.blasts;
}
console.log(`\n=== ${rows.length} matches ===`);
console.log(`  sorties ${sorties}  destroyed ${deaths}  kills by armour ${kills}  hull-seconds alive ${live.toFixed(0)}`);
console.log(`  attempts on the armour: ${rounds} rounds, ${frags} frags, ${blasts} blasts`);
console.log(`  survival: ${sorties ? (100 * (1 - deaths / sorties)).toFixed(0) : '-'}% of sorties ended with the hull intact`);
await browser.close();
