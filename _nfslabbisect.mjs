/**
 * BINARY-SEARCH THE BLACK SLAB DOWN TO ONE DRAWABLE.
 *
 *   node _nfslabbisect.mjs [--x=-14] [--z=-2] [--pitch=70]
 *
 * `_nfslabhunt.mjs` put it inside `<Scene>/world`, which is a Group with 1013
 * children. Hiding them one at a time is a thousand screenshots; hiding HALF at
 * a time is ten. The metric is the count of near-black pixels inside the slab's
 * own box — the slab is the blackest thing in a night sky, so its disappearance
 * is not a judgement call about mean luminance.
 *
 * Everything drawable under `/world` goes into one flat array, so a parent's
 * visibility can never mask a child's: the search hides leaves.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4616/?map=plains&capture=1';
const OUT = args.out ?? 'shots/slabbisect';
const PITCH = Number(args.pitch ?? 70) * Math.PI / 180;
const X = Number(args.x ?? -14), Z = Number(args.z ?? -2);
const YAW = Number(args.yaw ?? 0);
mkdirSync(OUT, { recursive: true });

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
  const chain = (o) => { const s = []; let c = o; while (c) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };
  const world = e.scene.children.find((c) => c.name === 'world');
  const leaves = [];
  world.traverse((o) => { if (o.isMesh || o.isInstancedMesh || o.isPoints || o.isSprite || o.isLine) leaves.push(o); });
  window.__LEAVES__ = leaves;
  window.__LEAFINFO__ = (i) => {
    const o = leaves[i];
    const mm = Array.isArray(o.material) ? o.material[0] : o.material;
    o.updateWorldMatrix(true, false);
    const g = o.geometry;
    if (g && !g.boundingBox) g.computeBoundingBox();
    return {
      path: chain(o), type: o.type, count: o.count ?? null, ro: o.renderOrder,
      frustumCulled: o.frustumCulled, visible: o.visible,
      pos: [+o.position.x.toFixed(2), +o.position.y.toFixed(2), +o.position.z.toFixed(2)],
      scale: [+o.scale.x.toFixed(3), +o.scale.y.toFixed(3), +o.scale.z.toFixed(3)],
      world: [+o.matrixWorld.elements[12].toFixed(2), +o.matrixWorld.elements[13].toFixed(2), +o.matrixWorld.elements[14].toFixed(2)],
      bbox: g?.boundingBox ? [
        [+g.boundingBox.min.x.toFixed(2), +g.boundingBox.min.y.toFixed(2), +g.boundingBox.min.z.toFixed(2)],
        [+g.boundingBox.max.x.toFixed(2), +g.boundingBox.max.y.toFixed(2), +g.boundingBox.max.z.toFixed(2)],
      ] : null,
      tris: g ? (g.getIndex()?.count ?? g.getAttribute('position')?.count ?? 0) / 3 : 0,
      attrs: g ? Object.keys(g.attributes) : null,
      mat: mm ? {
        type: mm.type, side: mm.side, depthWrite: mm.depthWrite, depthTest: mm.depthTest,
        transparent: mm.transparent, opacity: mm.opacity, blending: mm.blending,
        color: mm.color ? '#' + mm.color.getHexString() : null,
        emissive: mm.emissive ? '#' + mm.emissive.getHexString() : null,
        rough: mm.roughness, metal: mm.metalness, vcol: mm.vertexColors, flat: mm.flatShading,
        hasMap: !!mm.map, hasNormal: !!mm.normalMap, hasRough: !!mm.roughnessMap, fog: mm.fog,
        toneMapped: mm.toneMapped, name: mm.name,
      } : null,
      userData: JSON.parse(JSON.stringify(o.userData ?? {})),
      parentChain: chain(o.parent),
    };
  };
  window.__SETVIS__ = (idx, v) => { for (const i of idx) leaves[i].visible = v; };
  window.__RESTORE__ = () => { for (const o of leaves) o.visible = true; };
  return leaves.length;
});
const N = await p.evaluate(() => window.__LEAVES__.length);
console.log(`${N} drawables under /world`);

const frames = (n) => p.evaluate((k) => new Promise((d) => {
  let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);
await p.evaluate(([x, z, pitch, yaw]) => {
  const e = window.__ENGINE__; const ph = e.ctx.peek('physics'); const pl = e.ctx.peek('player');
  pl.teleport({ x, y: ph.groundHeight(x, z) + 1.66, z }, { x: pitch, y: yaw });
}, [X, Z, PITCH, YAW]);
await frames(30);

const base = await p.screenshot();
writeFileSync(`${OUT}/base.png`, base);
const png0 = PNG.sync.read(base);
const L = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
let bt = null;
for (let ty = 0; ty < Math.floor(png0.height * 0.45); ty += 16) {
  for (let tx = 0; tx < png0.width; tx += 16) {
    let s = 0, n = 0;
    for (let y = ty; y < ty + 16; y++) for (let x = tx; x < tx + 16; x++) { s += L(png0.data, (y * png0.width + x) * 4); n++; }
    if (!bt || s / n < bt.m) bt = { tx, ty, m: s / n };
  }
}
const box = [bt.tx - 8, bt.ty - 8, bt.tx + 24, bt.ty + 24];
const THRESH = bt.m + 6;
const darkCount = (buf) => {
  const g = PNG.sync.read(buf); let n = 0;
  for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) if (L(g.data, (y * g.width + x) * 4) < THRESH) n++;
  return n;
};
const base0 = darkCount(base);
console.log(`box ${JSON.stringify(box)} threshold ${THRESH.toFixed(1)}  baseline dark px ${base0}`);

const measure = async (hideIdx) => {
  await p.evaluate((idx) => { window.__RESTORE__(); window.__SETVIS__(idx, false); }, hideIdx);
  await frames(3);
  const s = await p.screenshot();
  return { n: darkCount(s), s };
};

/* control */
const all = await measure([...Array(N).keys()]);
console.log(`all /world hidden → dark px ${all.n}`);
writeFileSync(`${OUT}/all_hidden.png`, all.s);
if (all.n >= base0 * 0.6) {
  console.log('!! hiding all of /world does not remove it — it is not a /world drawable');
  await b.close(); process.exit(1);
}

/* binary search */
let cand = [...Array(N).keys()];
let step = 0;
while (cand.length > 1) {
  const half = cand.slice(0, Math.ceil(cand.length / 2));
  const r = await measure(half);
  const gone = r.n < base0 * 0.5;
  console.log(`  step ${++step}: hid ${half.length}/${cand.length} → dark ${r.n}  ${gone ? 'IN this half' : 'in the other half'}`);
  cand = gone ? half : cand.slice(Math.ceil(cand.length / 2));
}
await p.evaluate(() => window.__RESTORE__());
const info = await p.evaluate((i) => window.__LEAFINFO__(i), cand[0]);
console.log('\n════ THE SLAB ════');
console.log(JSON.stringify(info, null, 1));
writeFileSync(`${OUT}/slab.json`, JSON.stringify({ box, base0, info }, null, 1));

/* proof shot: that one drawable hidden, nothing else */
const proof = await measure([cand[0]]);
writeFileSync(`${OUT}/only_slab_hidden.png`, proof.s);
console.log(`\nonly that one hidden → dark px ${proof.n} (baseline ${base0})`);
await p.evaluate(() => window.__RESTORE__());
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '\n0 pageerrors');
await b.close();
