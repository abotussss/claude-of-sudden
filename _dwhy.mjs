/** WHERE DOES A DRONE THAT DIES IN CLIMB COME OUT OF? */
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = []; p.on('pageerror', e => errs.push(String(e.message)));
await p.goto('http://127.0.0.1:4579/?capture=1&map=plains&seed=7', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('map', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));
console.log(JSON.stringify(await p.evaluate(async () => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), dr = window.__DRONES__;
  e.time.scale = 12;
  const rows = [];
  const launch = new Map();
  const oldL = dr._launch.bind(dr);
  dr._launch = (t) => { const d = oldL(t); if (d) launch.set(d.id, { x: +d.position.x.toFixed(1), z: +d.position.z.toFixed(1), inField: !!dr.emp.bites(d.position), zone: dr.emp.bites(d.position)?.id ?? null, team: d.team }); return d; };
  const oldK = dr._empKill.bind(dr);
  dr._empKill = (d, z) => { rows.push({ id: d.id, team: d.team, state: d.state, life: +d.life.toFixed(1), zone: z.id, launchedAt: launch.get(d.id) ?? null }); return oldK(d, z); };
  const t0 = performance.now();
  while (performance.now() - t0 < 600000) { await new Promise(r => requestAnimationFrame(r)); if (m.phase === 'over' || (m.roundClock ?? 1) <= 1) break; }
  e.time.scale = 1;
  const pads = (e.ctx.peek('world').level.pads ?? []).map(q => ({ id: q.id, x: q.x, z: q.z }));
  return { rows, pads, launchedAll: [...launch.values()] };
}), null, 1));
console.log(errs.length ? 'PAGEERRORS ' + errs.length : 'pageerrors: none');
await b.close();
