/**
 * WHY IS THAT GROUND RED?
 *
 *   node _nfred.mjs
 *
 * The `fortress` frame's ground measures 38.3 / 11.7 / 10.4 — red at three
 * times green — while the same map's ground measures 18/17/17 two hundred
 * metres away. Arithmetic from the camera's own position said the fires deliver
 * 0.55x the moon there, which cannot produce that ratio; the incident light
 * would have to be about 18x the moon.
 *
 * So stop reasoning from the camera and ask the pixel. This unprojects the
 * actual red pixels, raycasts to the world point behind each one, and lists
 * every light in the scene that reaches THAT point — no assumption about which
 * fire, or whose light it even is.
 */
import { chromium } from 'playwright';
const URL = 'http://127.0.0.1:4603/?map=plains&capture=1';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await p.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('ui')?.setHudVisible?.(false);
  const g = e.ctx.scene.getObjectByName('match-emp'); if (g) g.visible = false;
});
await p.evaluate(() => (window.__ENGINE__.time.scale = 6));
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m.roundClock = 1e6; m._checkWinConditions = () => {};
  window.__ENGINE__.time.scale = 1;
});

// The exact `fortress` stand out of _nfnight.mjs.
await p.evaluate(() => {
  const e = window.__ENGINE__, phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const h = phys.raycast(0, 300, 96, 0, -1, 0, 400, phys.MASK.WORLD);
  e.camera.position.set(0, (h.hit ? h.point.y : 0) + 1.62, 96);
  e.camera.lookAt(new V3(0, 8, 56));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
});
await p.evaluate(() => new Promise((d) => { let i = 0; const t = () => (++i > 45 ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }));

console.log(JSON.stringify(await p.evaluate(() => {
  const e = window.__ENGINE__, phys = e.ctx.peek('physics'), cam = e.camera;
  const V3 = cam.position.constructor;
  const v = new V3();
  const w = window.innerWidth, h = window.innerHeight;
  const out = [];
  for (const [px, py] of [[250, 440], [420, 400], [640, 470], [900, 430], [200, 620]]) {
    v.set((px / w) * 2 - 1, -((py / h) * 2 - 1), 0.5).unproject(cam).sub(cam.position).normalize();
    const hit = phys.raycast(cam.position.x, cam.position.y, cam.position.z, v.x, v.y, v.z, 500, phys.MASK.WORLD);
    if (!hit.hit) { out.push({ px, py, hit: '(sky)' }); continue; }
    const P = hit.point;
    const lights = [];
    e.ctx.scene.traverse((o) => {
      if (!o.isLight || !o.visible || o.intensity <= 0) return;
      const c = o.color, col = `${c.r.toFixed(2)},${c.g.toFixed(2)},${c.b.toFixed(2)}`;
      if (o.isDirectionalLight) { lights.push({ n: o.name || 'dir', E: +o.intensity.toFixed(4), col, d: null }); return; }
      if (!o.isPointLight && !o.isSpotLight) return;
      const wp = o.getWorldPosition(new V3());
      const d = wp.distanceTo(P);
      const win = o.distance > 0 ? (d >= o.distance ? 0 : Math.max(0, 1 - (d / o.distance) ** 4) ** 2) : 1;
      const E = (o.intensity * win) / Math.max(d * d, 1);
      if (E > 1e-4) lights.push({ n: o.name || `${o.type}`, E: +E.toFixed(4), col, d: +d.toFixed(1), i: +o.intensity.toFixed(0), r: o.distance });
    });
    lights.sort((a, z) => z.E - a.E);
    out.push({ px, py, batch: hit.object?.name ?? '?', dist: +hit.distance.toFixed(1),
      at: [+P.x.toFixed(1), +P.y.toFixed(1), +P.z.toFixed(1)], lights: lights.slice(0, 5) });
  }
  return out;
}), null, 1));
console.log(errs.length ? `PAGEERRORS(${errs.length}) ${errs[0]}` : '0 pageerrors');
await b.close();
