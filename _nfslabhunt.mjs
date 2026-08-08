/**
 * THE BLACK SLAB, FOUND BY ITS DISAPPEARANCE.
 *
 *   node _nfslabhunt.mjs [--url=…] [--x=-14] [--z=-2] [--pitch=70]
 *
 * A triangle raycast down the pixel that owns the slab hits nothing, and no
 * Object3D in `engine.scene` sits within 6° of that ray, so the thing is not
 * where an argument would put it. This finds it the only way that cannot be
 * argued with: hide one subtree at a time and watch the pixels.
 *
 * The box is auto-found — the darkest 16x16 tile in the sky half of the frame —
 * so the probe does not depend on my reading pixel coordinates off a picture.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4616/?map=plains&capture=1';
const OUT = args.out ?? 'shots/slabhunt';
const PITCH = Number(args.pitch ?? 70) * Math.PI / 180;
const X = Number(args.x ?? -14), Z = Number(args.z ?? -2);
mkdirSync(OUT, { recursive: true });

const lum = (buf, x0, y0, x1, y1) => {
  const png = PNG.sync.read(buf);
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * png.width + x) * 4;
    s += 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
    n++;
  }
  return { mean: s / n, png };
};

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const lvl = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
console.log('level.id =', lvl);
if (lvl !== 'plains') { console.error('WRONG MAP'); await b.close(); process.exit(2); }

await p.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
});
const frames = (n) => p.evaluate((k) => new Promise((d) => {
  let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);
const pose = (x, z, pitch, yaw = 0) => p.evaluate(([x, z, pitch, yaw]) => {
  const e = window.__ENGINE__; const ph = e.ctx.peek('physics'); const pl = e.ctx.peek('player');
  pl.teleport({ x, y: ph.groundHeight(x, z) + 1.66, z }, { x: pitch, y: yaw });
}, [x, z, pitch, yaw]);

await pose(X, Z, PITCH);
await frames(30);
let base = await p.screenshot();
writeFileSync(`${OUT}/base.png`, base);

/* ── find the slab: darkest 16 px tile in the top 45 % of the frame ─────── */
const png0 = PNG.sync.read(base);
let bestTile = null;
for (let ty = 0; ty < Math.floor(png0.height * 0.45); ty += 16) {
  for (let tx = 0; tx < png0.width; tx += 16) {
    let s = 0, n = 0;
    for (let y = ty; y < Math.min(ty + 16, png0.height); y++) for (let x = tx; x < Math.min(tx + 16, png0.width); x++) {
      const i = (y * png0.width + x) * 4;
      s += 0.2126 * png0.data[i] + 0.7152 * png0.data[i + 1] + 0.0722 * png0.data[i + 2]; n++;
    }
    const m = s / n;
    if (!bestTile || m < bestTile.m) bestTile = { tx, ty, m };
  }
}
// grow the tile to the whole dark blob
const DARK = bestTile.m + 12;
let x0 = bestTile.tx, x1 = bestTile.tx + 16, y0 = bestTile.ty, y1 = bestTile.ty + 16;
const dark = (x, y) => {
  const i = (y * png0.width + x) * 4;
  return 0.2126 * png0.data[i] + 0.7152 * png0.data[i + 1] + 0.0722 * png0.data[i + 2] < DARK;
};
for (let grew = 1; grew;) {
  grew = 0;
  if (x0 > 0) { for (let y = y0; y < y1; y++) if (dark(x0 - 1, y)) { x0--; grew = 1; break; } }
  if (x1 < png0.width) { for (let y = y0; y < y1; y++) if (dark(x1, y)) { x1++; grew = 1; break; } }
  if (y0 > 0) { for (let x = x0; x < x1; x++) if (dark(x, y0 - 1)) { y0--; grew = 1; break; } }
  if (y1 < png0.height) { for (let x = x0; x < x1; x++) if (dark(x, y1)) { y1++; grew = 1; break; } }
}
console.log(`slab box  x ${x0}..${x1}  y ${y0}..${y1}   mean ${lum(base, x0, y0, x1, y1).mean.toFixed(1)}`);
const box = [x0, y0, x1, y1];
const baseMean = lum(base, ...box).mean;

/* ── is it a fixed thing in the world? parallax from a 3 m side-step ────── */
await pose(X + 3, Z, PITCH);
await frames(20);
writeFileSync(`${OUT}/sidestep.png`, await p.screenshot());
await pose(X, Z, PITCH);
await frames(20);

/* ── hide subtrees ─────────────────────────────────────────────────────── */
const tree = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const chain = (o) => { const s = []; let c = o; while (c) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };
  const out = [];
  for (const c of e.scene.children) out.push({ path: chain(c), type: c.type, kids: c.children.length });
  return out;
});
console.log(`\n${tree.length} top-level children of engine.scene`);

const setVis = (path, v) => p.evaluate(([path, v]) => {
  const e = window.__ENGINE__;
  const chain = (o) => { const s = []; let c = o; while (c) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };
  let hit = 0;
  e.scene.traverse((o) => { if (chain(o) === path) { o.visible = v; hit++; } });
  return hit;
}, [path, v]);

const results = [];
for (const t of tree) {
  await setVis(t.path, false);
  await frames(4);
  const shot = await p.screenshot();
  const m = lum(shot, ...box).mean;
  await setVis(t.path, true);
  results.push({ path: t.path, type: t.type, kids: t.kids, mean: +m.toFixed(1), delta: +(m - baseMean).toFixed(1) });
  if (m - baseMean > 6) writeFileSync(`${OUT}/hide_${t.path.replace(/[^\w]/g, '_')}.png`, shot);
}
results.sort((a, c) => c.delta - a.delta);
console.log(`baseline slab-box luminance ${baseMean.toFixed(1)}`);
for (const r of results.slice(0, 12)) {
  console.log(`  ${String(r.delta).padStart(7)}  → ${String(r.mean).padStart(6)}   ${r.type} (${r.kids} kids)  ${r.path}`);
}

/* control: nothing in the scene at all */
await p.evaluate(() => { for (const c of window.__ENGINE__.scene.children) c.visible = false; });
await frames(4);
const allOff = await p.screenshot();
writeFileSync(`${OUT}/scene_all_hidden.png`, allOff);
console.log(`\nwhole scene hidden → slab box ${lum(allOff, ...box).mean.toFixed(1)} (baseline ${baseMean.toFixed(1)})`);

writeFileSync(`${OUT}/hunt.json`, JSON.stringify({ box, baseMean, results }, null, 1));
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '\n0 pageerrors');
await b.close();
