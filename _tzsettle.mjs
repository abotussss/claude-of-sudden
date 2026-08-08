/** DOES `_bakeSettled` RUN, AND DO THE CHUNKS STAY ON THE GROUND AFTERWARDS?
 *  The earlier probe polled `site.t` and a ROUND RESET also drives it negative,
 *  which reads identically to "settled" and is the opposite of it. This samples
 *  the match phase alongside it so the two cannot be confused. */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4626/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${BASE}?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const out = await p.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  const s = m.airstrike.sites.find((k) => k.id === 'NF-TOWER');
  m.airstrike.callDemolition('NF-TOWER');
  const rows = [];
  for (let i = 0; i < 900; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    if (i % 60) continue;
    const mesh = s.meshes[1];
    const a = mesh.instanceMatrix.array, st = mesh.userData.settled;
    let same = 0;
    for (let k = 0; k < 40; k++) if (Math.abs(a[k * 16 + 13] - st[k * 16 + 13]) < 1e-4) same++;
    let ymin = 1e9, ymax = -1e9;
    for (let k = 0; k < mesh.count; k++) { const y = a[k*16+13]; if (y<ymin) ymin=y; if (y>ymax) ymax=y; }
    rows.push({ t: +s.t.toFixed(1), phase: m.phase, baked: !!s.baked, visible: mesh.visible,
      poseIsSettled: `${same}/40`, drawnY: [+ymin.toFixed(1), +ymax.toFixed(1)] });
    if (s.baked && rows.length > 3 && rows[rows.length-1].t < 0) break;
  }
  return rows;
});
for (const r of out) console.log('  ', JSON.stringify(r));
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
