/**
 * ARE THE GROUND SHEETS DRAWN AT ALL FROM ABOVE? — a runtime A/B, no edits.
 *
 *   node _nfsideab.mjs [--port=4612] [--map=plains|town]
 *
 * `patchGeometry` and `domeGeometry` are both wound with the front face DOWN
 * (measured in node: 11/11 and 60/60 triangles). If that reaches the GPU, then
 * every decal and every soil sheet on both maps is back-face culled when you
 * look down at it and drawn when you look up at it from a cut — which is the
 * complaint.
 *
 * This settles it without touching a source file: photograph the ground looking
 * DOWN three times, with the decal batches at `FrontSide` (as shipped),
 * `BackSide` (only the currently-culled faces) and `DoubleSide`. If the plain
 * gains its soil the moment the faces are flipped, they were being culled.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const MAP = args.map ?? 'plains';
const URL = `http://127.0.0.1:${args.port ?? '4612'}/?map=${MAP}&capture=1`;
const OUT = args.out ?? `shots/sideab-${MAP}`;
mkdirSync(OUT, { recursive: true });

const br = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await br.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
console.log('level =', level, 'out =', OUT);

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
});
const frames = (n) => page.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

// which batches to flip: the pure decal/sheet keys, never the walked terrain
const KEYS = MAP === 'plains'
  ? ['world_steppe_bare', 'world_steppe_dust', 'world_road_dust', 'world_scree', 'world_gravel']
  : ['world_road_dust', 'world_gravel', 'world_dirt', 'world_sand'];

const spots = MAP === 'plains'
  ? [['openplain', -60, -60], ['zoneC', -128, 86], ['nearA', -110, -96]]
  : [['street', 0, 0]];

for (const [tag, x, z] of spots) {
  for (const [name, side] of [['a-front', 0], ['b-back', 1], ['c-double', 2]]) {
    await page.evaluate(([keys, side]) => {
      window.__ENGINE__.scene.traverse((o) => {
        if (!o.isMesh || !keys.includes(o.name)) return;
        const m = Array.isArray(o.material) ? o.material : [o.material];
        for (const mm of m) { if (mm) { mm.side = side; mm.needsUpdate = true; } }
      });
    }, [KEYS, side]);
    await page.evaluate(([x, z]) => {
      const e = window.__ENGINE__, ph = e.ctx.peek('physics');
      const h = ph.raycast(x, 300, z, 0, -1, 0, 400, ph.MASK.WORLD);
      const y = (h.hit ? h.point.y : 0) + 1.62;
      e.camera.position.set(x, y, z);
      e.camera.rotation.set(-0.55, 0.8, 0, 'YXZ');
      e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
      e.camera.position.set(x, y, z);
      e.camera.rotation.set(-0.55, 0.8, 0, 'YXZ');
    }, [x, z]);
    await frames(35);
    await page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
    console.log(`  · ${tag}-${name}.png  side=${side}`);
  }
}
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs[0]}` : '0 pageerrors');
await br.close();
