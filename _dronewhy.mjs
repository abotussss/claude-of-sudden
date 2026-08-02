/**
 * WHY HALF OF THEM SCUTTLE. Per drone, per second: where it is, what state it
 * is in, how many hostiles its own `enemies()` call returns, how many of those
 * are inside `droneAcquireRange`, and how many of THOSE it can see. The three
 * numbers separate "nobody near the focus" from "everybody is behind a roof".
 *
 * Usage: node _dronewhy.mjs [url] [seed] [speed]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4451/';
const SEED = process.argv[3] ?? '7';
const SPEED = Number(process.argv[4] ?? 8);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const res = await page.evaluate(async (SPEED) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const d = m.drones;
  const phys = e.ctx.peek('physics');
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.time.scale = SPEED;
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));

  const R = 55;
  const rows = [];
  const out = [];
  const A = new (window.THREE?.Vector3 ?? Object)();
  const start = performance.now();
  let t = 0;
  while (performance.now() - start < 260000 && rows.length < 220) {
    await new Promise((r) => requestAnimationFrame(r));
    t += 1;
    if (t % 20) continue;
    for (const s of d.list) {
      if (!s.alive) continue;
      out.length = 0;
      d.enemies(s.team, out);
      let near = 0;
      let seen = 0;
      let nearest = 1e9;
      for (const a of out) {
        const p = a.position;
        const dx = p.x - s.position.x, dy = p.y + 1.15 - s.position.y, dz = p.z - s.position.z;
        const dd = Math.hypot(dx, dy, dz);
        if (dd < nearest) nearest = dd;
        if (dd > R) continue;
        near++;
        A.set?.(p.x, p.y + 1.15, p.z);
        const to = A.set ? A : { x: p.x, y: p.y + 1.15, z: p.z };
        if (phys.lineOfSight(s.position, to, phys.MASK.SIGHT)) seen++;
      }
      rows.push({
        id: s.id, team: s.team, st: s.state,
        y: +s.position.y.toFixed(1),
        gy: +s.groundY.toFixed(1),
        foes: out.length, near, seen,
        nearest: +nearest.toFixed(0),
        life: +s.life.toFixed(0),
      });
    }
    if (m.phase !== 'live') break;
  }
  const byState = {};
  for (const r of rows) {
    const k = r.st;
    const b2 = byState[k] ?? (byState[k] = { n: 0, near: 0, seen: 0, nearest: 0, foes: 0, y: 0 });
    b2.n++; b2.near += r.near; b2.seen += r.seen; b2.nearest += r.nearest; b2.foes += r.foes; b2.y += r.y;
  }
  const summary = Object.entries(byState).map(([k, v]) => ({
    state: k, samples: v.n,
    foes: +(v.foes / v.n).toFixed(1),
    within55: +(v.near / v.n).toFixed(2),
    visible: +(v.seen / v.n).toFixed(2),
    nearestM: +(v.nearest / v.n).toFixed(0),
    altitude: +(v.y / v.n).toFixed(1),
  }));
  return { summary, sample: rows.slice(0, 14), stats: JSON.parse(JSON.stringify(d.stats)) };
}, SPEED);

console.log('per-state averages over', res.summary.reduce((a, s) => a + s.samples, 0), 'samples:');
console.table(res.summary);
console.log('first samples:');
console.table(res.sample);
console.log('stats:', JSON.stringify(res.stats));
console.log('pageerrors', errs.length, errs.slice(0, 3));
await b.close();
