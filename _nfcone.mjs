/**
 * WHAT IS IN THAT DIRECTION — every Object3D, not just meshes.
 *
 *   node _nfcone.mjs [--x=-14] [--z=-2] [--pitch=70] [--ndc=0.597,0.628]
 *
 * `_nfceilid.mjs` fires triangles and found NOTHING along the ray that owns the
 * black slab, so whatever draws it is not a `Mesh` under `engine.scene` — a
 * Sprite, a Points cloud, a mesh in somebody else's scene, or a mesh whose
 * geometry my triangle walk cannot read. This lists, by angle off that ray,
 * every object in every scene the engine holds, whatever its type.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4616/?map=plains&capture=1';
const PITCH = Number(args.pitch ?? 70) * Math.PI / 180;
const X = Number(args.x ?? -14), Z = Number(args.z ?? -2);
const NDC = (args.ndc ?? '0.597,0.628').split(',').map(Number);
const ANG = Number(args.ang ?? 6);

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

await p.evaluate(([x, z, pitch]) => {
  const e = window.__ENGINE__; const ph = e.ctx.peek('physics'); const pl = e.ctx.peek('player');
  pl.teleport({ x, y: ph.groundHeight(x, z) + 1.66, z }, { x: pitch, y: 0 });
}, [X, Z, PITCH]);
await frames(30);

const out = await p.evaluate(([ndcx, ndcy, ANG]) => {
  const e = window.__ENGINE__;
  const cam = e.camera; cam.updateMatrixWorld(true);
  const m = cam.matrixWorld.elements;
  const ox = m[12], oy = m[13], oz = m[14];
  const tan = Math.tan((cam.fov * Math.PI / 180) / 2);
  const cx = ndcx * tan * cam.aspect, cy = ndcy * tan, cz = -1;
  let dx = m[0] * cx + m[4] * cy + m[8] * cz;
  let dy = m[1] * cx + m[5] * cy + m[9] * cz;
  let dz = m[2] * cx + m[6] * cy + m[10] * cz;
  const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;

  const chain = (o) => { const s = []; let c = o; while (c) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };

  // every scene the engine can be shown to hold
  const scenes = new Map();
  scenes.set('engine.scene', e.scene);
  for (const k of ['render', 'sky', 'fx', 'ui', 'weapons']) {
    const s = e.ctx.peek(k);
    if (!s) continue;
    for (const f of ['scene', 'skyScene', 'viewScene', 'gunScene', 'overlayScene', '_scene']) {
      const v = s[f];
      if (v && v.isObject3D && !scenes.has(`${k}.${f}`)) scenes.set(`${k}.${f}`, v);
    }
  }

  const hits = [];
  for (const [sn, sc] of scenes) {
    sc.updateMatrixWorld(true);
    sc.traverse((o) => {
      const el = o.matrixWorld.elements;
      const px = el[12] - ox, py = el[13] - oy, pz = el[14] - oz;
      const d = Math.hypot(px, py, pz);
      if (d < 0.5 || d > 4000) return;
      const cosA = (px * dx + py * dy + pz * dz) / d;
      const ang = Math.acos(Math.max(-1, Math.min(1, cosA))) * 180 / Math.PI;
      if (ang > ANG) return;
      const mm = Array.isArray(o.material) ? o.material[0] : o.material;
      hits.push({
        scene: sn, ang: +ang.toFixed(2), dist: +d.toFixed(1), type: o.type,
        vis: o.visible, name: chain(o),
        inst: o.isInstancedMesh ? o.count : null,
        mat: mm ? {
          type: mm.type, side: mm.side, depthWrite: mm.depthWrite, depthTest: mm.depthTest,
          transparent: mm.transparent, opacity: mm.opacity, ro: o.renderOrder,
          color: mm.color ? '#' + mm.color.getHexString() : null,
          emissive: mm.emissive ? '#' + mm.emissive.getHexString() : null,
          hasMap: !!mm.map, fog: mm.fog, blending: mm.blending, toneMapped: mm.toneMapped,
        } : null,
        geo: o.geometry ? { type: o.geometry.type, tris: (o.geometry.getIndex()?.count ?? o.geometry.getAttribute('position')?.count ?? 0) / 3 } : null,
        scale: o.scale ? [+o.scale.x.toFixed(2), +o.scale.y.toFixed(2), +o.scale.z.toFixed(2)] : null,
      });
    });
  }
  hits.sort((a, c) => a.ang - c.ang);
  return { scenes: [...scenes.keys()], ray: [+dx.toFixed(3), +dy.toFixed(3), +dz.toFixed(3)], eye: [+ox.toFixed(2), +oy.toFixed(2), +oz.toFixed(2)], hits: hits.slice(0, 40) };
}, [NDC[0], NDC[1], ANG]);

console.log('scenes:', out.scenes.join(', '));
console.log('eye', out.eye, 'ray', out.ray);
for (const h of out.hits) {
  console.log(`  ${String(h.ang).padStart(5)}°  ${String(h.dist).padStart(7)} m  ${h.type}${h.inst ? `x${h.inst}` : ''}  vis=${h.vis}  scale ${JSON.stringify(h.scale)}  ${h.name}`);
  if (h.mat) console.log(`          ${JSON.stringify(h.mat)}  geo ${JSON.stringify(h.geo)}`);
}
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '\n0 pageerrors');
await b.close();
