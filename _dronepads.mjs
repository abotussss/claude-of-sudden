/**
 * WHERE THE TWENTY COME OUT OF — 「ドローンはいろんなサイトに登場させて」
 *
 * `MatchSystem._droneLaunchPoint` rotates over the base spawn cluster plus
 * every zone that side OWNS. This fires six a side with the zones handed out
 * and reports which pad each launch came off, to the metre.
 *
 * Usage: node _dronepads.mjs [url] [seed]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4483/';
const SEED = process.argv[3] ?? '7';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  const d = m.drones;
  const before = m.sites.map((z) => `${z.id}:${z.owner}`);
  // Hand out the zones so both sides have somewhere to launch from besides
  // the base — at kick-off nobody owns anything and every pad list is one long.
  for (let i = 0; i < m.sites.length; i++) m.sites[i].owner = i % 2;
  const pads = {};
  for (const t of [0, 1]) {
    pads[t] = [{ id: 'BASE', p: m._spawnCentre[t === m.attackers ? 'attack' : 'defend'] }];
    for (const z of m.sites) if (z.owner === t) pads[t].push({ id: z.id, p: z.position });
  }
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const team = i % 2;
    for (const x of d.list) if (x.alive) d._retire(x, 'probe');
    const one = d.fire(team);
    if (!one) { rows.push({ team, from: 'NO SLOT' }); continue; }
    let best = null;
    let bd = 1e9;
    for (const pad of pads[team]) {
      const dx = one.position.x - pad.p.x;
      const dz = one.position.z - pad.p.z;
      const dd = Math.hypot(dx, dz);
      if (dd < bd) { bd = dd; best = pad.id; }
    }
    rows.push({ team, from: best, off: +bd.toFixed(1) });
  }
  return { before, pads: { 0: pads[0].map((x) => x.id), 1: pads[1].map((x) => x.id) }, rows };
});
console.log('zones at kick-off:', JSON.stringify(out.before));
console.log('pads:', JSON.stringify(out.pads));
for (const r of out.rows) console.log(`  team ${r.team}  from ${r.from}  (+${r.off} m)`);
console.log('pageerrors', errs.length, errs.slice(0, 3));
await b.close();
