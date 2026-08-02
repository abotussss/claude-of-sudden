/**
 * WHAT ARE THE THINGS IN THE SKY? — name them, from the pose that photographed
 * them.
 *
 *   node _skywhat.mjs [--url=…] [--seed=7] [--rect=590,180,260,200]
 *
 * `shots/sky/r1-crossing-north.png` shows ~40 dark cubes hanging in clear sky
 * over the razed cathedral. `_chunkfloat` and `_floatcheck` both report zero,
 * so the first job is not to theorise about why — it is to say WHICH OBJECTS
 * those pixels are.
 *
 * So: drive the real collapse, take the same camera pose, then project EVERY
 * drawn instance in the scene into screen space (`Vector3.project`, the same
 * transform the renderer uses) and report every one that lands inside the
 * rectangle the swarm occupies in that PNG — with its mesh name, its instance
 * index, its world position, its size, its distance, and whether physics
 * finds anything solid at that point at all.
 *
 * Naming the mesh answers the player's caveat on its own:
 * 「物理判定がなければいいけど」 — an `airstrike_*` instance carries no collider,
 * a `scope_cath:ruin_*` triangle does.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4421/';
const RECT = String(args.rect ?? '560,140,320,260').split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL + (args.seed ? `?seed=${args.seed}` : ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

/* ---- the real scheduled collapse ---------------------------------------- */
await page.evaluate(() => (window.__ENGINE__.time.scale = 8));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 180000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  m.airstrike.enabled = true;
});
await page.waitForFunction("window.__ENGINE__.ctx.peek('match')._cathedralCalled===true", null, { timeout: 300000 });
await page.evaluate(() => (window.__ENGINE__.time.scale = 4));
await page.waitForFunction(
  () => {
    const e = window.__ENGINE__;
    const cath = e.ctx.peek('match').airstrike.sites.filter((x) => /^CATH/.test(x.id));
    return e.ctx.peek('world').cathedral?.razed === true && cath.length >= 4 && cath.every((x) => x.struck && x.baked);
  },
  null,
  { timeout: 300000 }
);
await sleep(10000);
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await sleep(2000);

const out = await page.evaluate((RECT) => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const ph = e.ctx.peek('physics');
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  const pl = e.ctx.peek('player');
  const V3 = e.camera.position.constructor;
  const M4 = e.camera.matrixWorld.constructor;
  // Same quiesce and same pose as `_skyshots.mjs`'s `crossing-north`.
  /**
   * THE MATCH KEEPS RUNNING. `Airstrike`, `Bomber` and `Strafe` are all driven
   * from `match.update`, so stubbing it freezes whatever is in the air — which
   * is how the first run of this file produced a sky full of debris and then
   * named it. @see the same note in `_skyshots.mjs`.
   */
  if (m) {
    m.roundClock = 1e6;
    m._checkWinConditions = () => {};
    if (m.airstrike) m.airstrike.enabled = false;
    if (m.bomber) m.bomber.enabled = false;
    if (m.strafe) m.strafe.enabled = false;
  }
  if (ai) { ai.combatEnabled = false; try { ai.clearAgents(); } catch { /* ok */ } }
  if (pl) { pl.alive = true; pl.movementLocked = false; pl.health?.heal?.(999); }
  const k = w.cathedral;
  const eye = w.levelToWorld(k.level.x + 0, 0, k.level.z + -2, new V3());
  const h0 = ph.raycast(eye.x, 44, eye.z, 0, -1, 0, 60, ph.MASK.WORLD);
  eye.y = (h0.hit ? h0.point.y : 0) + 1.62;
  const at = w.levelToWorld(k.level.x + 0, 0, k.level.z + 18, new V3());
  at.y = 11;
  e.camera.position.copy(eye);
  e.camera.lookAt(at);
  e.camera.updateMatrixWorld(true);

  const [rx, ry, rw, rh] = RECT;
  const W = 1280;
  const H = 720;
  const p = new V3();
  const q = e.camera.quaternion.clone();
  const sc = new V3();
  const mat = new M4();
  const rows = [];
  const byMesh = new Map();

  const consider = (name, wx, wy, wz, size) => {
    p.set(wx, wy, wz);
    const d = p.distanceTo(e.camera.position);
    p.project(e.camera);
    if (p.z > 1) return;
    const sx = (p.x * 0.5 + 0.5) * W;
    const sy = (-p.y * 0.5 + 0.5) * H;
    if (sx < rx || sx > rx + rw || sy < ry || sy > ry + rh) return;
    // Is there anything SOLID at this point? A drawn-only chunk answers no.
    const hit = ph.raycast(wx, wy + 6, wz, 0, -1, 0, 12, ph.MASK.WORLD);
    const solidAt = hit.hit ? +hit.point.y.toFixed(2) : null;
    rows.push({
      name, sx: Math.round(sx), sy: Math.round(sy), d: +d.toFixed(1),
      x: +wx.toFixed(1), y: +wy.toFixed(2), z: +wz.toFixed(1),
      size: +size.toFixed(2),
      solidUnder: solidAt, air: solidAt === null ? 99 : +(wy - size * 0.5 - solidAt).toFixed(2),
    });
    byMesh.set(name, (byMesh.get(name) ?? 0) + 1);
  };

  /**
   * `instanceMatrix` IS IN THE MESH'S OWN SPACE, NOT THE WORLD'S — and the
   * first run of this file forgot it, projected local offsets as if they were
   * world points, and confidently named four meshes that were not in the
   * photograph at all. Every instance is composed through `o.matrixWorld`
   * exactly as the renderer composes it.
   */
  const wm = new M4();
  e.ctx.scene.updateMatrixWorld(true);
  e.ctx.scene.traverse((o) => {
    if (!o.visible) return;
    // A hidden ancestor hides the whole branch; `o.visible` alone does not say so.
    for (let a = o.parent; a; a = a.parent) if (!a.visible) return;
    if (o.isInstancedMesh) {
      const arr = o.instanceMatrix.array;
      const n = o.count;
      for (let i = 0; i < n; i++) {
        mat.fromArray(arr, i * 16);
        wm.multiplyMatrices(o.matrixWorld, mat);
        wm.decompose(p, q, sc);
        const size = Math.max(sc.x, sc.y, sc.z);
        // Only what is off the deck — the pile itself is not the question.
        if (p.y < 2.0) continue;
        consider(o.name || '(instanced)', p.x, p.y, p.z, size);
      }
    } else if (o.isMesh && o.geometry?.boundingSphere !== undefined) {
      // A plain mesh counts as ONE candidate at its own centre: the drawn ruin
      // masses and the world batches are what the swarm has to be told from.
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const bs = o.geometry.boundingSphere;
      if (!bs) return;
      p.copy(bs.center).applyMatrix4(o.matrixWorld);
      if (p.y < 2.0) return;
      consider(o.name || '(mesh)', p.x, p.y, p.z, bs.radius * 2);
    }
  });
  rows.sort((a, b) => a.d - b.d);
  return {

    eye: [+eye.x.toFixed(1), +eye.y.toFixed(2), +eye.z.toFixed(1)],
    counts: [...byMesh.entries()].sort((a, b) => b[1] - a[1]),
    rows: rows.slice(0, 40),
    total: rows.length,
  };
}, RECT);
await browser.close();

console.log(`\nSKYWHAT  eye ${out.eye.join(', ')}  rect ${RECT.join(',')}`);
console.log(`  drawn instances projecting into the sky rectangle: ${out.total}`);
console.log('  by mesh:');
for (const [n, c] of out.counts) console.log(`    ${String(c).padStart(5)}  ${n}`);
console.log('\n  nearest 40 — screen (x,y), distance, world (x,y,z), size, solid under it, air:');
for (const r of out.rows) {
  console.log(
    `   ${String(r.sx).padStart(4)},${String(r.sy).padStart(4)}  ${String(r.d).padStart(6)} m  ` +
      `(${String(r.x).padStart(7)}, ${String(r.y).padStart(6)}, ${String(r.z).padStart(7)})  ` +
      `size ${String(r.size).padStart(5)}  under ${String(r.solidUnder).padStart(6)}  air ${String(r.air).padStart(6)}  ${r.name}`
  );
}
if (errs.length) console.log('PAGE ERRORS', errs.slice(0, 3));
