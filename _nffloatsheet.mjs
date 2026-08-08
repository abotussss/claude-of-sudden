/**
 * WHICH SOIL SHEETS STAND PROUD OF THE GROUND THEY ARE LAID ON?
 *
 *   node _nffloatsheet.mjs [--port=4612] [--shots=6]
 *
 * `domeGeometry` closes to y = 0 at its own rim, and `plains-ground.js` places
 * it with ONE rigid transform at `groundY` under its CENTRE. On a flat floor
 * that is exact. On a swell whose gradient reaches 0.37 it is not: a 34 m sheet
 * whose middle is on the ground has a rim metres off it, and now that the
 * winding fix makes these draw at all, a rim off the ground is a shelf.
 *
 * So: flood every island in the ground-key batches, keep the ones small enough
 * to be a sheet rather than the walked terrain, and rank them by how far their
 * worst vertex stands over the analytic plain. Then stand on the ground 18 m
 * from the worst of them, at a standing eye, and photograph it.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4612'}/?map=plains&capture=1`;
const OUT = args.out ?? 'shots/floatsheet';
const NSHOTS = Number(args.shots ?? 6);
mkdirSync(OUT, { recursive: true });

const br = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await br.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level =', await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

const list = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const plainsY = e.ctx.peek('world').level.groundY;
  const KEYS = ['world_steppe', 'world_steppe_bare', 'world_steppe_dust', 'world_scree'];
  const out = [];
  e.scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !KEYS.includes(o.name)) return;
    const pa = o.geometry.getAttribute('position');
    const idx = o.geometry.getIndex();
    const nt = idx.count / 3;
    const byV = new Map();
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const v = idx.getX(t * 3 + k); let a = byV.get(v); if (!a) byV.set(v, (a = [])); a.push(t);
    }
    const seen = new Uint8Array(nt);
    for (let t0 = 0; t0 < nt; t0++) {
      if (seen[t0]) continue;
      const q = [t0]; seen[t0] = 1;
      let count = 0, worst = -1e9, wx = 0, wz = 0, wy = 0;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      while (q.length) {
        const t = q.pop(); count++;
        for (let k = 0; k < 3; k++) {
          const v = idx.getX(t * 3 + k);
          const X = pa.getX(v), Y = pa.getY(v), Z = pa.getZ(v);
          if (X < x0) x0 = X; if (X > x1) x1 = X;
          if (Z < z0) z0 = Z; if (Z > z1) z1 = Z;
          const d = Y - plainsY(X, Z);
          if (d > worst) { worst = d; wx = X; wz = Z; wy = Y; }
          for (const u of byV.get(v)) if (!seen[u]) { seen[u] = 1; q.push(u); }
        }
        if (count > 5000) break; // the walked terrain — not a sheet
      }
      if (count > 5000 || count < 8) continue;
      if (wx * wx + wz * wz > 170 * 170) continue;
      /**
       * ONLY THE BARE OPEN PLAIN. A patch on the control tower's deck and a
       * talus mound on a 50° rim face are both metres over `plainsY` and both
       * entirely correct; ranking on `y - plainsY` alone puts them at the top
       * and buries the thing being looked for. So the floor under the worst
       * vertex must be the plain itself, and the structures are excluded by
       * their own footprints.
       */
      const ph = e.ctx.peek('physics');
      const f = ph.groundHeight(wx, wz);
      if (!isFinite(f) || Math.abs(f - plainsY(wx, wz)) > 0.35) continue;
      out.push({ mesh: o.name, tris: count, proud: +worst.toFixed(2), at: [+wx.toFixed(1), +wz.toFixed(1)], y: +wy.toFixed(2), w: +(x1 - x0).toFixed(1), d: +(z1 - z0).toFixed(1) });
    }
  });
  out.sort((a, b) => b.proud - a.proud);
  return { total: out.length, over05: out.filter((r) => r.proud > 0.5).length, over1: out.filter((r) => r.proud > 1).length, over2: out.filter((r) => r.proud > 2).length, top: out.slice(0, 30) };
});

console.log(`\n${list.total} sheet islands inside r176`);
console.log(`  standing >0.5 m proud of the ground: ${list.over05}`);
console.log(`  standing >1.0 m proud:               ${list.over1}`);
console.log(`  standing >2.0 m proud:               ${list.over2}\n`);
for (const r of list.top.slice(0, 14)) {
  console.log(`  +${String(r.proud).padStart(5)} m   ${r.mesh.padEnd(19)} ${String(r.tris).padStart(4)} tris  ${r.w}x${r.d} m   worst vertex at [${r.at}] y ${r.y}`);
}

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
});
const frames = (n) => page.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

for (let i = 0; i < Math.min(NSHOTS, list.top.length); i++) {
  const r = list.top[i];
  await page.evaluate(([tx, tz, ty]) => {
    const e = window.__ENGINE__, ph = e.ctx.peek('physics');
    const a = Math.atan2(tz, tx);
    const cx = tx - Math.cos(a) * 18, cz = tz - Math.sin(a) * 18;
    const h = ph.raycast(cx, 300, cz, 0, -1, 0, 400, ph.MASK.WORLD);
    const y = (h.hit ? h.point.y : 0) + 1.62;
    e.camera.position.set(cx, y, cz);
    e.camera.lookAt(new e.camera.position.constructor(tx, ty, tz));
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    e.camera.position.set(cx, y, cz);
    e.camera.lookAt(new e.camera.position.constructor(tx, ty, tz));
  }, [r.at[0], r.at[1], r.y]);
  await frames(35);
  await page.screenshot({ path: `${OUT}/proud${i}-${r.proud}m.png` });
  console.log(`  · proud${i}-${r.proud}m.png  at [${r.at}]`);
}
console.log(errs.length ? `PAGEERRORS: ${errs[0]}` : '0 pageerrors');
await br.close();
