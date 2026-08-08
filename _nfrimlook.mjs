/**
 * STAND UNDER THE WORST SHEET RIM AND LOOK AT IT — with and without the sheets.
 *
 *   node _nfrimlook.mjs [--port=4612]
 *
 * `_nffloatsheet.mjs` says 288 soil sheets on the bare plain have a vertex more
 * than 2 m over the ground, worst 6.01 m. That number decides nothing on its
 * own: a 39 m disc whose rim is 6 m up is a shelf, and a 39 m disc that merely
 * disagrees with a gentle swell is broad relief. The only way to tell is to put
 * the camera at the worst rim, at a standing eye, at 8 and 20 m, and take the
 * same frame twice — once as it ships and once with the ground-sheet batches
 * hidden. What the sheets are doing to the picture is the difference.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4612'}/?map=plains&capture=1`;
const OUT = args.out ?? 'shots/rimlook';
mkdirSync(OUT, { recursive: true });

// the worst rims measured on the bare plain
const RIMS = [
  ['a', 51.3, 144.6], ['b', 67.0, 125.4], ['c', -25.7, 130.7], ['d', -86.1, 80.6], ['e', -22.3, -74.6],
];
const KEYS = ['world_steppe', 'world_steppe_bare', 'world_steppe_dust', 'world_scree'];

const br = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await br.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level =', await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
  const pl = e.ctx.peek('player'); if (pl) pl.viewModel && (pl.viewModel.visible = false);
});
const frames = (n) => page.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

for (const [id, tx, tz] of RIMS) {
  for (const dist of [9, 22]) {
    for (const [tag, hide] of [['with', false], ['without', true]]) {
      await page.evaluate(([keys, hide]) => {
        window.__ENGINE__.scene.traverse((o) => { if (o.isMesh && keys.includes(o.name)) o.visible = !hide; });
      }, [KEYS, hide]);
      const y = await page.evaluate(([tx, tz, dist]) => {
        const e = window.__ENGINE__, ph = e.ctx.peek('physics');
        const a = Math.atan2(tz, tx);
        const cx = tx - Math.cos(a) * dist, cz = tz - Math.sin(a) * dist;
        const h = ph.raycast(cx, 300, cz, 0, -1, 0, 400, ph.MASK.WORLD);
        const cy = (h.hit ? h.point.y : 0) + 1.62;
        const V = e.camera.position.constructor;
        e.camera.position.set(cx, cy, cz);
        e.camera.lookAt(new V(tx, cy - 0.1, tz));
        e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
        e.camera.position.set(cx, cy, cz);
        e.camera.lookAt(new V(tx, cy - 0.1, tz));
        return +cy.toFixed(2);
      }, [tx, tz, dist]);
      await frames(28);
      await page.screenshot({ path: `${OUT}/${id}-${dist}m-${tag}.png` });
      console.log(`  · ${id}-${dist}m-${tag}.png  eye ${y}`);
    }
  }
}
await page.evaluate((keys) => { window.__ENGINE__.scene.traverse((o) => { if (o.isMesh && keys.includes(o.name)) o.visible = true; }); }, KEYS);
console.log(errs.length ? `PAGEERRORS: ${errs[0]}` : '0 pageerrors');
await br.close();
