/**
 * IS THE FAR RANGE STILL STANDING OVER THE RIM AT 115°? — verify `b4f741b`.
 *
 *   node _nfrim115.mjs [--port=4612]
 *
 * The record says a pale flat plane intruded above the crest at about 115°, that
 * it was the coarse far sheet chording over the walked ridge, and that making
 * the sheet polar fixed it. That is a claim about a PICTURE, so this takes the
 * picture — sixteen bearings from just inside the clip ring, looking out and
 * slightly up — and pairs each with a measurement the picture cannot fake: rays
 * fired along the same line, reporting whether the first thing they meet is the
 * walked mountain or `world_mountain_rock`'s far sheet, and at what radius.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4612'}/?map=plains&capture=1`;
const OUT = args.out ?? 'shots/rim115';
mkdirSync(OUT, { recursive: true });

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
});
const frames = (n) => page.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

const DEGS = [];
for (let d = 0; d < 360; d += 22.5) DEGS.push(d);
DEGS.push(115);

const rows = await page.evaluate((degs) => {
  const e = window.__ENGINE__;
  const plainsY = e.ctx.peek('world').level.groundY;
  /** The drawn range lives in the mountain batch; collect it once. */
  const rocks = [];
  e.scene.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.name === 'world_mountain_rock') rocks.push(o); });
  // world-space triangles of the drawn mountain, split by radius band
  const out = [];
  for (const deg of degs) {
    const a = deg * Math.PI / 180;
    const ox = Math.cos(a) * 168, oz = Math.sin(a) * 168;
    const oy = plainsY(ox, oz) + 1.62;
    /**
     * Sample the SKYLINE: for each of a set of elevations, walk outward and see
     * what the highest drawn surface along this bearing is and at what radius.
     * If the far sheet ever stands above the walked ridge on this line, its
     * radius (>=208) shows up with a HIGHER apparent elevation than the crest's.
     */
    let crestEl = -9, crestR = 0, farEl = -9, farR = 0;
    for (let r = 170; r < 700; r += 1.5) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = plainsY(x, z); // walked field == ridge + swell
      const el = Math.atan2(y - oy, r - 168);
      if (r <= 235 && el > crestEl) { crestEl = el; crestR = r; }
    }
    // the drawn far sheet, from the level's own function via the mesh
    for (const mesh of rocks) {
      const pa = mesh.geometry.getAttribute('position');
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i), z = pa.getZ(i);
        const rr = Math.hypot(x, z);
        if (rr < 200) continue;
        const aa = Math.atan2(z, x);
        let da = Math.abs(aa - a); if (da > Math.PI) da = Math.PI * 2 - da;
        if (da > 0.035) continue;
        const el = Math.atan2(pa.getY(i) - oy, rr - 168);
        if (el > farEl) { farEl = el; farR = rr; }
      }
    }
    out.push({
      deg, crestDeg: +(crestEl * 180 / Math.PI).toFixed(2), crestR: +crestR.toFixed(0),
      farDeg: +(farEl * 180 / Math.PI).toFixed(2), farR: +farR.toFixed(0),
      intrudes: farEl > crestEl,
    });
  }
  return out;
}, DEGS);

console.log('\n bearing   walked crest        drawn range        drawn range above the crest?');
let bad = 0;
for (const r of rows) {
  if (r.intrudes) bad++;
  console.log(`  ${String(r.deg).padStart(5)}°   ${String(r.crestDeg).padStart(6)}° at r ${String(r.crestR).padStart(3)}   ${String(r.farDeg).padStart(6)}° at r ${String(r.farR).padStart(3)}   ${r.intrudes ? '*** YES ***' : 'no'}`);
}
console.log(`\n${bad} of ${rows.length} bearings have the drawn far range standing above the walked crest`);

for (const deg of [90, 112.5, 115, 135]) {
  await page.evaluate((deg) => {
    const e = window.__ENGINE__, w = e.ctx.peek('world');
    const a = deg * Math.PI / 180;
    const x = Math.cos(a) * 168, z = Math.sin(a) * 168;
    const y = w.level.groundY(x, z) + 1.62;
    const yaw = Math.atan2(-Math.cos(a), -Math.sin(a));
    e.camera.position.set(x, y, z);
    e.camera.rotation.set(0.10, yaw, 0, 'YXZ');
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    e.camera.position.set(x, y, z);
    e.camera.rotation.set(0.10, yaw, 0, 'YXZ');
  }, deg);
  await frames(30);
  await page.screenshot({ path: `${OUT}/out-${deg}.png` });
  console.log(`  · out-${deg}.png`);
}
console.log(errs.length ? `PAGEERRORS: ${errs[0]}` : '0 pageerrors');
await br.close();
