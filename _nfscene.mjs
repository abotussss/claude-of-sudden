/**
 * WHAT IS IN THE PLAIN'S SCENE GRAPH, BY NAME, PARENT, MATERIAL AND EXTENT.
 *
 *   node _nfscene.mjs [--url=…]
 *
 * `_nfceiling.mjs` reported the single largest thing over a standing player as
 * `(unnamed)` — 5 392 m² of it, 2.7 to 33.9 m up. A census that cannot name its
 * biggest entry is not a diagnosis, so this walks the whole graph and prints the
 * chain that owns every drawable, with its material and its world box.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4612/?map=plains&capture=1';

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('level.id =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

const rows = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const out = [];
  const chain = (o) => { const s = []; let c = o; while (c) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };
  e.scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh && !o.isPoints && !o.isSprite) return;
    const g = o.geometry;
    if (g && !g.boundingBox) g.computeBoundingBox();
    const bb = g?.boundingBox;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    out.push({
      chain: chain(o),
      type: o.type,
      vis: o.visible,
      count: o.isInstancedMesh ? o.count : undefined,
      tris: g?.getIndex() ? g.getIndex().count / 3 : g?.getAttribute('position') ? g.getAttribute('position').count / 3 : 0,
      mat: m ? `${m.type}:${m.name || '-'}${m.transparent ? ' T' : ''}${m.depthWrite === false ? ' noDW' : ''}${m.side === 2 ? ' 2side' : ''}` : '-',
      order: o.renderOrder,
      box: bb ? [+bb.min.x.toFixed(1), +bb.min.y.toFixed(1), +bb.min.z.toFixed(1), +bb.max.x.toFixed(1), +bb.max.y.toFixed(1), +bb.max.z.toFixed(1)] : null,
      py: +o.position.y.toFixed(2),
    });
  });
  return out;
});
rows.sort((a, b2) => b2.tris - a.tris);
for (const r of rows) {
  console.log(`${String(Math.round(r.tris)).padStart(8)}t ${r.vis ? ' ' : 'H'} ${(r.count ? 'x' + r.count : '').padStart(7)} ord${String(r.order).padStart(3)}  ${r.chain.padEnd(58)} ${r.mat.padEnd(40)} ${r.box ? '[' + r.box.join(' ') + ']' : ''}`);
}
console.log(`\n${rows.length} drawables`);
await b.close();
