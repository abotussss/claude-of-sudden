/**
 * IS THE DRESSING ACTUALLY BEING DRAWN? The bounding boxes say the meshes are
 * built and in the right place and every photograph so far has failed to show
 * them, which are two different claims and only one of them was tested.
 *
 * So: put the camera four metres over a post looking straight down (nothing can
 * occlude that but the post itself), and independently ask THREE.Raycaster what
 * the camera is actually looking at. A mesh that is in the scene, in frustum,
 * and not hit by a ray down its own centre line is a mesh that is not there.
 *
 *   node _meddiag.mjs [url] [seed]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = process.argv[2] ?? 'http://127.0.0.1:4294/';
const SEED = process.argv[3] ?? '11';
const OUT = 'shots/verify';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const frames = (n) =>
  page.evaluate(
    (k) =>
      new Promise((d) => {
        let i = 0;
        const t = () => (++i >= k ? d() : requestAnimationFrame(t));
        requestAnimationFrame(t);
      }),
    n
  );

const diag = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const THREE = e.THREE ?? null;
  const V3 = e.camera.position.constructor;
  const c = m.caches.list.find((x) => x.kind === 'medic');
  const p = c.position;
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
  e.camera.position.set(p.x, p.y + 4.5, p.z);
  e.camera.lookAt(new V3(p.x, p.y, p.z + 0.001));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);

  const g = m.caches.medGroup;
  const out = { post: c.id, at: [p.x, p.y, p.z], group: null, meshes: [] };
  if (g) {
    out.group = {
      inScene: !!g.parent,
      parentIsScene: g.parent === e.ctx.scene,
      visible: g.visible,
      children: g.children.length,
      matrixAuto: g.matrixAutoUpdate,
    };
    for (const o of g.children) {
      o.updateWorldMatrix(true, false);
      const bs = o.geometry.boundingSphere;
      out.meshes.push({
        name: o.name,
        visible: o.visible,
        frustumCulled: o.frustumCulled,
        matVisible: o.material.visible,
        matTransparent: o.material.transparent,
        matOpacity: o.material.opacity,
        matColorHex: o.material.color.getHexString(),
        matType: o.material.type,
        hasMap: !!o.material.map,
        layers: o.layers.mask,
        // World-space centre of the whole merged batch.
        bsCentre: bs ? [+bs.center.x.toFixed(1), +bs.center.y.toFixed(2), +bs.center.z.toFixed(1)] : null,
        bsRadius: bs ? +bs.radius.toFixed(1) : null,
        posCount: o.geometry.attributes.position.count,
      });
    }
  }
  return out;
});
console.log('diag:', JSON.stringify(diag, null, 1));

await frames(40);
await page.screenshot({ path: `${OUT}/meddiag-down.png` });

/** Now ask the scene graph what a ray straight down actually hits. */
const hit = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const g = m.caches.medGroup;
  const c = m.caches.list.find((x) => x.kind === 'medic');
  const p = c.position;
  // Raycaster is on the same three build the engine uses; reach it off a class.
  const Ray = e.camera.constructor;
  const mod = Object.getPrototypeOf(e.camera).constructor;
  // Simplest available: brute-force the merged positions for anything near the post.
  const near = [];
  for (const o of g.children) {
    const a = o.geometry.attributes.position.array;
    let n = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < a.length; i += 3) {
      const dx = a[i] - p.x;
      const dz = a[i + 2] - p.z;
      if (dx * dx + dz * dz < 16) {
        n++;
        if (a[i + 1] < minY) minY = a[i + 1];
        if (a[i + 1] > maxY) maxY = a[i + 1];
      }
    }
    near.push({ name: o.name, verticesWithin4m: n, yRange: [+minY.toFixed(2), +maxY.toFixed(2)] });
  }
  return { postY: +p.y.toFixed(3), near };
});
console.log('near:', JSON.stringify(hit));
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
