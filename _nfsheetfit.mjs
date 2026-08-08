/**
 * NOW THAT THE SOIL SHEETS ARE DRAWN, DO THEY LIE ON THE GROUND?
 *
 *   node _nfsheetfit.mjs [--port=4612]
 *
 * Reversing the winding in `src/world/util.js` turned several thousand ground
 * sheets and decals from "invisible from above, a black lid from below" into
 * "drawn". That is the fix, and it immediately raises the next question, which
 * is the one that decides whether the fix is finished: a `domeGeometry` sheet is
 * a RIGID disc placed at `groundY` under its own CENTRE, 8-34 m across, and the
 * plain it is laid on swells. If its rim stands proud, what was a black ceiling
 * becomes a floating shelf, and that is the same complaint with a better colour.
 *
 * So this measures the gap. Every vertex of every ground-key batch, against the
 * analytic `plainsY` under it: how far above the ground does the drawn soil sit,
 * and where is the worst of it. The walked terrain is in these batches too and
 * reads ~0, which is the control that says the measurement is right.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4612'}/?map=plains&capture=1`;

const br = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await br.newPage({ viewport: { width: 900, height: 520 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level =', await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const plainsY = e.ctx.peek('world').level.groundY;
  const KEYS = ['world_steppe', 'world_steppe_bare', 'world_steppe_dust', 'world_scree', 'world_road_dust', 'world_gravel', 'world_dirt'];
  const res = [];
  e.scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !KEYS.includes(o.name)) return;
    const pa = o.geometry.getAttribute('position');
    const bins = new Int32Array(14); // <0.05, .1,.2,.3,.5,.75,1,1.5,2,3,4,6,10,more
    const edges = [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 10];
    let worst = -1e9, wx = 0, wz = 0, below = 0, n = 0;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      if (x * x + z * z > 176 * 176) continue;
      n++;
      const d = y - plainsY(x, z);
      if (d < -0.05) below++;
      if (d > worst) { worst = d; wx = x; wz = z; }
      const a = Math.abs(d);
      let k = 13; for (let j = 0; j < edges.length; j++) if (a < edges[j]) { k = j; break; }
      bins[k]++;
    }
    res.push({ name: o.name, n, worst: +worst.toFixed(2), at: [+wx.toFixed(1), +wz.toFixed(1)], below, bins: [...bins], edges });
  });
  return res;
});

const LBL = ['<0.05', '<0.1', '<0.2', '<0.3', '<0.5', '<0.75', '<1', '<1.5', '<2', '<3', '<4', '<6', '<10', '>=10'];
for (const r of out) {
  console.log(`\n${r.name}  ${r.n} vertices inside r176   worst +${r.worst} m at [${r.at}]   ${r.below} vertices under the ground`);
  const parts = r.bins.map((v, i) => v ? `${LBL[i]}:${v}` : null).filter(Boolean);
  console.log('   |y - plainsY|  ' + parts.join('  '));
}
console.log(errs.length ? `\nPAGEERRORS: ${errs[0]}` : '\n0 pageerrors');
await br.close();
