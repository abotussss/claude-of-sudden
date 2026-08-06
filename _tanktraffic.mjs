/**
 * THREE HULLS A SIDE: DO THEY ROLL, AND DO THEY MEET?
 *
 * The two things three-a-side can get wrong that one-a-side cannot:
 *
 *   1. THEY NEVER ROLL. `Armour` is armed by the cathedral's beat sheet, and a
 *      map with no cathedral has no beat sheet. Watches for the arm and the
 *      sortie rather than firing by hand (`_tankmatch.mjs` fires by hand on
 *      purpose; this one is asking whether the schedule works).
 *   2. THEY DRIVE ON TOP OF EACH OTHER. Samples every hull at 1 Hz of game time
 *      and reports, per side, the closest two hulls ever came, how many samples
 *      were under 12 m (two hull lengths), and how the destinations were shared
 *      out over the sortie.
 *
 *   node _tanktraffic.mjs http://127.0.0.1:4576/ plains 7
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4576/';
const MAP = process.argv[3] ?? 'plains';
const SEED = process.argv[4] ?? '7';
const UNTIL = Number(process.argv[5] ?? 330);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
const logs = [];
page.on('console', (m) => { const t = m.text(); if (/\[tank\] (armed|SORTIE)|DROPPED/i.test(t)) logs.push(t.slice(0, 240)); });
await page.goto(`${URL}?capture=1&map=${MAP}&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const res = await page.evaluate(async (UNTIL) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.time.scale = 12;
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  const armour = m.tank;
  const per = {};
  for (const t of armour.tanks) per[t.id] = { id: t.id, team: t.team, rolled: null, zones: {}, states: {} };
  const pairs = {};
  let next = 0;
  const t0 = e.ctx.time.elapsed;
  while (e.ctx.time.elapsed - t0 < UNTIL) {
    await new Promise((r) => requestAnimationFrame(r));
    const now = e.ctx.time.elapsed - t0;
    if (now < next) continue;
    next = now + 1;
    for (const t of armour.tanks) {
      const p = per[t.id];
      p.states[t.state] = (p.states[t.state] ?? 0) + 1;
      if (t.state !== 'parked' && p.rolled === null) p.rolled = +now.toFixed(0);
      if (t.state === 'parked') continue;
      if (t.targetZone) p.zones[t.targetZone] = (p.zones[t.targetZone] ?? 0) + 1;
    }
    for (let i = 0; i < armour.tanks.length; i++) {
      for (let j = i + 1; j < armour.tanks.length; j++) {
        const a = armour.tanks[i]; const c = armour.tanks[j];
        if (a.team !== c.team) continue;
        if (a.state === 'parked' || c.state === 'parked') continue;
        const k = `${a.id}|${c.id}`;
        const d = Math.hypot(a.position.x - c.position.x, a.position.z - c.position.z);
        const q = pairs[k] ?? (pairs[k] = { min: Infinity, under12: 0, n: 0 });
        q.n++; q.min = Math.min(q.min, d); if (d < 12) q.under12++;
      }
    }
  }
  return {
    map: e.ctx.peek('world')?.level?.id,
    elapsed: +(e.ctx.time.elapsed - t0).toFixed(0),
    score: m.score ? [...m.score] : null,
    hulls: Object.values(per).map((p) => ({ ...p, min: undefined })),
    pairs: Object.entries(pairs).map(([k, v]) => `${k}: closest ${v.min.toFixed(1)} m, ${v.under12}/${v.n} samples under 12 m`),
  };
}, UNTIL);

console.log(JSON.stringify(res, null, 1));
console.log('--- logs ---');
for (const l of logs) console.log('  ' + l);
console.log(errs.length ? 'PAGEERROR: ' + errs.slice(0, 5).join(' | ') : 'no pageerrors');
await b.close();
process.exit(errs.length ? 1 : 0);
