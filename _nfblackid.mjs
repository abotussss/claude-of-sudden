/**
 * WHAT IS THE BLACK CEILING OVER A TRENCH? Ask the scene graph, not the eye.
 *
 *   node _nfblackid.mjs [--port=4613] [--nocover] [--all]
 *
 * A screenshot says "there is a black surface up there" and nothing else, and
 * a physics ray says nothing at all — the thing is DRAWN and has no proxy
 * (`_nfceiling.mjs`: "solid overhead: none in 60 m" at every stance in every
 * bay). So this walks `engine.scene`, builds each visible mesh's WORLD-space
 * bounding box out of its geometry box and its matrix, and reports every one
 * whose box is entirely ABOVE a standing eye on the trench floor and whose
 * footprint covers that eye. That is the definition of a ceiling.
 *
 * No `THREE` import is available in a built bundle, so `Vector3` is taken off
 * `camera.position.constructor` and the eight corners are transformed by hand.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4613'}/?map=plains${args.nocover ? '&nocover=1' : ''}`;
const { trenchBays } = await import('./src/world/levels/plains-trench.js');
const byLine = new Map();
for (const b of trenchBays()) {
  const cur = byLine.get(b.name);
  if (!cur || (b.s1 - b.s0) > (cur.s1 - cur.s0)) byLine.set(b.name, b);
}
const picks = [...byLine.values()];

const br = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await br.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log(URL);

const points = picks.map((b) => {
  const mid = b.pts[b.pts.length >> 1];
  return [b.name, +mid[0].toFixed(1), +mid[1].toFixed(1)];
});

const res = await page.evaluate((pts) => {
  const e = window.__ENGINE__;
  const scene = e.scene;
  const ph = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  scene.updateMatrixWorld(true);
  /** every visible mesh in the scene, as a world-space AABB */
  const boxes = [];
  scene.traverse((o) => {
    if (!o.visible || !o.geometry || o.type === 'Sprite' || o.type === 'Points' || o.type === 'Line') return;
    let vis = true;
    for (let p = o; p; p = p.parent) if (!p.visible) { vis = false; break; }
    if (!vis) return;
    o.geometry.computeBoundingBox?.();
    const bb = o.geometry.boundingBox;
    if (!bb) return;
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    const v = new V3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
      v.applyMatrix4(o.matrixWorld);
      x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); z0 = Math.min(z0, v.z);
      x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); z1 = Math.max(z1, v.z);
    }
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    boxes.push({
      name: o.name || '(unnamed)', parent: o.parent?.name || '', type: o.type,
      mat: m?.name || m?.type || '?', side: m?.side, col: m?.color?.getHexString?.() ?? '',
      inst: o.count ?? null,
      tris: Math.round(o.geometry.index ? o.geometry.index.count / 3 : (o.geometry.attributes?.position?.count ?? 0) / 3),
      x0, y0, z0, x1, y1, z1,
    });
  });
  const out = [];
  for (const [name, x, z] of pts) {
    const h = ph.raycast(x, 300, z, 0, -1, 0, 400, ph.MASK.WORLD);
    const floor = h.hit ? h.point.y : 0;
    const eye = floor + 1.62;
    const over = boxes
      .filter((b) => b.y0 > eye && b.x0 <= x && b.x1 >= x && b.z0 <= z && b.z1 >= z)
      .sort((a, b) => a.y0 - b.y0)
      .slice(0, 8);
    out.push({ name, x, z, floor: +floor.toFixed(2), eye: +eye.toFixed(2), over });
  }
  return { meshes: boxes.length, out };
}, points);

console.log(`scene meshes examined: ${res.meshes}`);
for (const p of res.out) {
  console.log(`\n${p.name} @ (${p.x}, ${p.z})  floor ${p.floor}  eye ${p.eye}`);
  if (!p.over.length) { console.log('   nothing drawn overhead'); continue; }
  for (const b of p.over) {
    console.log(`   y ${b.y0.toFixed(1)}..${b.y1.toFixed(1)}  ${(b.x1 - b.x0).toFixed(0)}x${(b.z1 - b.z0).toFixed(0)} m  ` +
      `${b.name.padEnd(20)} <${b.parent}> ${b.type} mat=${b.mat} side=${b.side} col=${b.col} tris=${b.tris}` +
      (b.inst ? ` inst=${b.inst}` : ''));
  }
}
await br.close();
