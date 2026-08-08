/**
 * WHY IS THE EMP FIELD STILL A LID OVER A TRENCH FLOOR?
 *
 *   node _empwhy.mjs [--url=…] [--x=-140] [--z=-93]
 *
 * The fade added in 99674d2 is a per-fragment function of `prox` (where the
 * CAMERA is, in radii) and `elev` (how high the fragment is above the camera's
 * own horizon). Both are arithmetic, so they can be evaluated on the CPU at the
 * real camera pose instead of argued about.
 *
 * Puts the camera on a named cut floor exactly as the shot probes do, reads the
 * pose BACK off the camera, and then evaluates the shell / post / band alpha the
 * fragment program would produce for a fan of directions overhead — per mesh, so
 * the three surfaces that all report as `match-emp/emp-A/<Mesh>` are separated.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4623/?map=plains&capture=1';
const X = Number(args.x ?? -140);
const Z = Number(args.z ?? -93);
const EYE = Number(args.eye ?? 1.62);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('level.id =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

await p.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
});
const frames = (n) => p.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

await p.evaluate(([x, z, EYE]) => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics');
  const gy = ph.groundHeight(x, z);
  e.camera.rotation.order = 'YXZ';
  e.camera.position.set(x, gy + EYE, z);
  e.camera.rotation.set(1.35, 0.6, 0);
  // `rot.x` IS THE PITCH and `rot.y` the yaw — @see PlayerSystem.teleport. An
  // object with `{yaw, pitch}` silently teleports you looking at the horizon.
  e.ctx.peek('player')?.teleport?.(e.camera.position, { x: 1.35, y: 0.6 });
  e.camera.position.set(x, gy + EYE, z);
  e.camera.rotation.set(1.35, 0.6, 0);
}, [X, Z, EYE]);
await frames(40);

const out = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const cam = e.camera;
  cam.updateMatrixWorld(true);
  const C = { x: cam.matrixWorld.elements[12], y: cam.matrixWorld.elements[13], z: cam.matrixWorld.elements[14] };
  const grp = e.scene.getObjectByName('match-emp');
  const rows = [];
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  grp.traverse((o) => {
    if (!o.isMesh) return;
    const u = o.material.uniforms;
    const ctr = u.uCentre.value, R = u.uR.value, ground = u.uGround.value;
    const camR = Math.hypot(C.x - ctr.x, C.z - ctr.z);
    const prox = smooth(R, R * 2.6, camR);
    // every vertex of this mesh, in world space, that is over the camera's eye
    o.updateMatrixWorld(true);
    const pa = o.geometry.getAttribute('position');
    const el = o.matrixWorld.elements;
    let n = 0, aMax = 0, aMean = 0, elevAtMax = 0, dAtMax = 0, over = 0;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const wx = el[0] * x + el[4] * y + el[8] * z + el[12];
      const wy = el[1] * x + el[5] * y + el[9] * z + el[13];
      const wz = el[2] * x + el[6] * y + el[10] * z + el[14];
      const dx = wx - C.x, dy = wy - C.y, dz = wz - C.z;
      const len = Math.hypot(dx, dy, dz);
      const elev = dy / Math.max(0.001, len);
      if (elev < 0.26) continue;              // not overhead at all
      over++;
      const lid = 1 - smooth(0.26, 0.60, elev);
      // HEIGHT OVER THE HEAD, in metres — @see the block in empzone.js
      const keep = Math.min(lid, 1 - smooth(1.2, 4.5, dy));
      // the alpha terms that do not depend on the lattice noise: base + fres,
      // with fres taken at its worst (1) so this is an UPPER BOUND per vertex
      const a0 = 0.014 + 0.115 + 0.05 + 0.40 * (0.12 + (1 - 0.12) * prox) + 0.045;
      const ab = 0.13 + 0.20 + 0.09 + 0.09;
      let a = ground > 0.5 ? ab : a0;
      const uFar = 1 + (0.34 - 1) * smooth(90, 300, len);
      const uNear = smooth(0.5, 4.0, len);
      a *= uFar * (ground > 0.5 ? 1 : uNear * (0.5 + 0.5 * prox));
      a *= keep + (1 - keep) * prox;
      aMean += a; n++;
      if (a > aMax) { aMax = a; elevAtMax = elev; dAtMax = len; }
    }
    rows.push({
      name: o.name || '<Mesh>', ground, R: +R.toFixed(1), camR: +camR.toFixed(1),
      prox: +prox.toFixed(3), verts: pa.count, overhead: over,
      aMax: +aMax.toFixed(4), aMean: +(aMean / Math.max(1, n)).toFixed(4),
      elevAtMax: +elevAtMax.toFixed(3), dAtMax: +dAtMax.toFixed(1),
    });
  });
  return {
    cam: { x: +C.x.toFixed(2), y: +C.y.toFixed(2), z: +C.z.toFixed(2) },
    rot: { pitch: +cam.rotation.x.toFixed(3), yaw: +cam.rotation.y.toFixed(3) },
    rows,
  };
});

console.log('camera actually at', out.cam, 'looking', out.rot);
console.log('\n  mesh                 grnd    R  camR   prox  verts  overhd   aMax  aMean  elev@max  dist@max');
for (const r of out.rows) {
  console.log(`  ${String(r.name).padEnd(20)} ${String(r.ground).padStart(4)} ${String(r.R).padStart(4)} ${String(r.camR).padStart(5)} ${String(r.prox).padStart(6)} ${String(r.verts).padStart(6)} ${String(r.overhead).padStart(7)} ${String(r.aMax).padStart(6)} ${String(r.aMean).padStart(6)} ${String(r.elevAtMax).padStart(9)} ${String(r.dAtMax).padStart(9)}`);
}
// ── and photograph it by ELIMINATION: one surface hidden at a time ─────────
import { mkdirSync } from 'node:fs';
const OUT = args.out ?? 'shots/empwhy';
mkdirSync(OUT, { recursive: true });
const hide = (nm) => p.evaluate((nm) => {
  window.__ENGINE__.scene.traverse((o) => { if (o.isMesh && (nm === '*' || o.name === nm) && o.parent?.name?.startsWith('emp-')) o.visible = false; });
}, nm);
const showAll = () => p.evaluate(() => {
  window.__ENGINE__.scene.traverse((o) => { if (o.isMesh && o.parent?.name?.startsWith('emp-')) o.visible = true; });
});
for (const nm of ['none', 'emp-shell', 'emp-post', 'emp-band', '*']) {
  await showAll();
  if (nm !== 'none') await hide(nm);
  await frames(20);
  await p.screenshot({ path: `${OUT}/up_hide_${nm.replace('*', 'all')}.png` });
  console.log(`  · up_hide_${nm.replace('*', 'all')}.png`);
}
await showAll();

console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '\n0 pageerrors');
await b.close();
