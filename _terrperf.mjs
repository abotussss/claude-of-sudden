/**
 * A COPY OF `tools/perf.mjs`, DIFFERING IN TWO THINGS: THE PORT AND THE MAP.
 *
 * The original hard-wires `http://127.0.0.1:8080/?capture=1`, which is the town
 * on a port this session is not allowed to open. The measurement below is the
 * original's, unchanged — 300 frames after a 120-frame warm, median / p95 /
 * draw calls / triangles at three resolutions — but the URL is assembled once
 * from `--url` and `--map`, and the run echoes `world.level.id` so the map is
 * OBSERVED rather than intended. @see the note at the top of `_dtankdiag.mjs`.
 *
 *   node _terrperf.mjs [--url=http://127.0.0.1:4611/] [--map=plains]
 *
 * `__APPLY_SHOT__('hero')` is a town camera and does not exist on the plain, so
 * the plain is measured from a fixed stand instead: the middle of the map,
 * eye height, looking at the burning east rim — the widest thing this level
 * ever has to draw.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4611/';
const MAP = args.map ?? 'plains';

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
const out = [];
for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(`${BASE}?capture=1&map=${MAP}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
  const id = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
  if (MAP === 'plains') {
    await p.evaluate(() => {
      const c = window.__ENGINE__.ctx, w2 = c.peek('world'), pl = c.peek('player');
      const x = 0, z = 0, y = w2.level.groundY(x, z) + 1.65;
      pl.teleport({ x, y, z }, -Math.PI / 2);
      c.camera.rotation.order = 'YXZ';
      c.camera.rotation.y = -Math.PI / 2;
      c.camera.rotation.x = 0.02;
    });
  } else {
    await p.evaluate(() => window.__APPLY_SHOT__('hero'));
  }
  await p.evaluate(() => new Promise((d) => { let i = 0; const t = () => (++i >= 120 ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }));
  const r = await p.evaluate(() => new Promise((d) => {
    const N = 300, ts = []; let last = performance.now(), i = 0;
    const t = () => {
      const n = performance.now(); ts.push(n - last); last = n;
      if (++i >= N) { ts.sort((a, c) => a - c); d({ med: ts[Math.floor(N * 0.5)], p95: ts[Math.floor(N * 0.95)], min: ts[0] }); }
      else requestAnimationFrame(t);
    };
    requestAnimationFrame(t);
  }));
  const info = await p.evaluate(() => window.__RENDER_INFO__);
  out.push({ level: id, res: `${w}x${h}`, medMs: +r.med.toFixed(2), p95Ms: +r.p95.toFixed(2), medFps: +(1000 / r.med).toFixed(0), calls: info.calls, tris: info.tris });
  await p.close();
}
console.log(JSON.stringify(out, null, 2));
await b.close();
