/**
 * ONE BAY ON EVERY TRENCH LINE, PHOTOGRAPHED LOOKING UP FROM THE FLOOR.
 *
 *   node _nftrenchup.mjs [--port=4612] [--hide=world_steppe,…] [--tag=base]
 *
 * 「塹壕に入ると天井みたいな黒い壁が出てくる そう言うのが至る所にある」 — the camera
 * goes onto the FLOOR of the longest bay on each of the thirteen lines and looks
 * up, and every frame is accompanied by the analytic answer to the same
 * question: what drawn triangle is directly over the eye, how far up, and which
 * scene mesh owns it.
 *
 * `--hide` takes a comma-separated list of mesh names (the `world_<key>` batch
 * names) and hides them before shooting, so a candidate is confirmed by its
 * disappearance rather than by argument.
 *
 * The bay centres come from `plains-trench.trenchBays()` in node, so a line that
 * moves moves its own photographs, and the floor comes from `MASK.WORLD` at the
 * bay centre rather than from `plainsY` — a ray dropped over a cut can land on
 * the spoil berm beside it and photograph the wrong stance.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const PORT = args.port ?? '4612';
const URL = `http://127.0.0.1:${PORT}/?map=plains&capture=1`;
const TAG = args.tag ?? 'base';
const OUT = args.out ?? `shots/trenchup-${TAG}`;
const HIDE = args.hide ? String(args.hide).split(',') : [];
mkdirSync(OUT, { recursive: true });

const { trenchBays } = await import('./src/world/levels/plains-trench.js');
const byLine = new Map();
for (const b of trenchBays()) {
  const cur = byLine.get(b.name);
  if (!cur || (b.s1 - b.s0) > (cur.s1 - cur.s0)) byLine.set(b.name, b);
}
const picks = [...byLine.values()];

const br = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await br.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level=${level}  out=${OUT}  hide=[${HIDE.join(' ')}]`);
if (level !== 'plains') { console.error('NOT THE PLAIN'); await br.close(); process.exit(2); }

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const pl = e.ctx.peek('player'); if (pl) pl.applyDamage = () => {};
});
await page.evaluate(() => (window.__ENGINE__.time.scale = 6));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m.roundClock = 1e6; m._checkWinConditions = () => {};
  window.__ENGINE__.time.scale = 1;
});
if (HIDE.length) await page.evaluate((names) => {
  window.__ENGINE__.scene.traverse((o) => {
    if ((o.isMesh || o.isInstancedMesh) && names.includes(o.name)) o.visible = false;
  });
}, HIDE);

// install a scene-triangle "what is directly overhead" probe once
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const chain = (o) => { const s = []; let c = o; while (c && c.parent) { s.unshift(c.name || `<${c.type}>`); c = c.parent; } return s.join('/'); };
  window.__OVERHEAD__ = (x, z, y0, RR = 12) => {
    let best = Infinity, bestN = null, bestNy = 0, bestSide = 0, bestOrder = 0, bestMat = '';
    const v = { x: 0, y: 0, z: 0 };
    e.scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.visible) return;
      const g = o.geometry; const pa = g.getAttribute('position'); if (!pa) return;
      if (!g.boundingBox) g.computeBoundingBox();
      const idx = g.getIndex(); const n = idx ? idx.count : pa.count;
      const el = o.matrixWorld.elements;
      const gx = (i) => { const X = pa.getX(i), Y = pa.getY(i), Z = pa.getZ(i);
        v.x = el[0] * X + el[4] * Y + el[8] * Z + el[12];
        v.y = el[1] * X + el[5] * Y + el[9] * Z + el[13];
        v.z = el[2] * X + el[6] * Y + el[10] * Z + el[14]; };
      for (let i = 0; i < n; i += 3) {
        const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
        gx(a); const ax = v.x, ay = v.y, az = v.z;
        if (Math.abs(ax - x) > RR || Math.abs(az - z) > RR) {
          gx(b); if (Math.abs(v.x - x) > RR || Math.abs(v.z - z) > RR) { gx(c); if (Math.abs(v.x - x) > RR || Math.abs(v.z - z) > RR) continue; }
        }
        gx(b); const bx = v.x, by = v.y, bz = v.z;
        gx(c); const cx = v.x, cy = v.y, cz = v.z;
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const y = l1 * ay + l2 * by + l3 * cy;
        if (y <= y0 + 0.05 || y >= best) continue;
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const wx = cx - ax, wy = cy - ay, wz = cz - az;
        const ny = uz * wx - ux * wz;
        const L = Math.hypot(uy * wz - uz * wy, ny, ux * wy - uy * wx) || 1;
        best = y; bestN = chain(o); bestNy = ny / L;
        const mm = Array.isArray(o.material) ? o.material[0] : o.material;
        bestSide = mm?.side ?? 0; bestOrder = o.renderOrder; bestMat = mm?.name || mm?.type || '-';
      }
    });
    return bestN ? { y: +best.toFixed(2), name: bestN, ny: +bestNy.toFixed(2), side: bestSide, order: bestOrder, mat: bestMat } : null;
  };
});

const frames = (n) => page.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

for (const bay of picks) {
  const mid = bay.pts[bay.pts.length >> 1];
  const nxt = bay.pts[(bay.pts.length >> 1) + 1] ?? bay.pts[bay.pts.length - 1];
  const along = Math.atan2(nxt[0] - mid[0], nxt[1] - mid[1]);
  const name = bay.name.replace(/[^A-Za-z0-9]+/g, '');
  const info = await page.evaluate(([x, z, yaw]) => {
    const e = window.__ENGINE__, ph = e.ctx.peek('physics');
    const h = ph.raycast(x, 300, z, 0, -1, 0, 400, ph.MASK.WORLD);
    const floor = h.hit ? h.point.y : 0;
    const eyeY = floor + 1.62;
    e.camera.position.set(x, eyeY, z);
    e.camera.rotation.set(-70 * Math.PI / 180, yaw, 0, 'YXZ');
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    e.camera.position.set(x, eyeY, z);
    e.camera.rotation.set(-70 * Math.PI / 180, yaw, 0, 'YXZ');
    const solid = ph.raycast(x, eyeY, z, 0, 1, 0, 60, ph.MASK.WORLD);
    return {
      floor: +floor.toFixed(2), plain: +e.ctx.peek('world').level.groundY(x, z).toFixed(2),
      solid: solid.hit ? +(solid.point.y - eyeY).toFixed(2) : null,
      drawn: window.__OVERHEAD__(x, z, eyeY),
    };
  }, [mid[0], mid[1], along]);
  await frames(30);
  await page.screenshot({ path: `${OUT}/${name}-up.png` });
  const d = info.drawn;
  console.log(`  · ${name.padEnd(13)} (${mid[0].toFixed(0)},${mid[1].toFixed(0)}) floor ${String(info.floor).padStart(6)} vs plain ${String(info.plain).padStart(6)}   solid overhead ${info.solid === null ? '   none' : String(info.solid).padStart(6) + ' m'}   DRAWN overhead: ${d ? `${d.name} @${(d.y - info.floor - 1.62).toFixed(2)} m  ny=${d.ny} side=${d.side} ord=${d.order} mat=${d.mat}` : 'none'}`);
}
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '0 pageerrors');
await br.close();
