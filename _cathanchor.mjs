/**
 * CANDIDATE CATHEDRAL STRIKE ANCHORS, measured the way `Airstrike._buildSite`
 * measures them — the same CATH_PROBE roof sweep and the same "step out until
 * the ground under the ray is street" lane ray — so a new bay can be authored
 * from a measurement instead of from a guess.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4272/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const r = await page.evaluate(() => {
  const e = window.__ENGINE__, w = e.ctx.peek('world'), phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const INSETS = [2.0, 3.0, 4.0], ALONGS = [0, 2.5, -2.5, 4, -4];
  const f = (n) => (Number.isFinite(n) ? +n.toFixed(2) : null);
  const anchor = new V3(), p = new V3(), u = new V3(), v = new V3();
  const rows = [];
  for (const ax of [-10, 10]) {
    for (let az = -15; az <= 13; az += 1) {
      w.levelToWorld(ax * 1.5, 0, az * 1.5, anchor);
      const face = ax > 0 ? [1, 0] : [-1, 0];
      const yaw = Math.atan2(face[0], face[1]) + (w.levelYaw ?? 0);
      u.set(Math.sin(yaw), 0, Math.cos(yaw));
      v.set(u.z, 0, -u.x);
      let best = NaN;
      for (const inset of INSETS) for (const along of ALONGS) {
        p.copy(anchor).addScaledVector(u, -inset).addScaledVector(v, along);
        const h = phys.groundHeight(p.x, p.z, 40);
        if (Number.isFinite(h) && h >= 3 && !(h <= best)) best = h;
      }
      let lane = 40;
      if (Number.isFinite(best)) {
        const base = new V3(anchor.x, best, anchor.z);
        lane = 40;
        for (const out of [2.5, 4.0, 6.0, 8.0]) {
          p.copy(base).addScaledVector(u, out);
          const g = phys.groundHeight(p.x, p.z, best + 2);
          if (!Number.isFinite(g) || g > best - 2.5) continue;
          p.y = g + 1.2;
          const hit = phys.raycast(p, u, 40, phys.MASK.WORLD);
          lane = (hit?.hit ? hit.distance : 40) + out;
          break;
        }
      }
      rows.push([ax, az, f(best), f(lane), f(anchor.x), f(anchor.z)]);
    }
  }
  return rows;
});
console.log('  ax   az    roofY    lane     world');
for (const [ax, az, roof, lane, wx, wz] of r) {
  console.log(`  ${String(ax).padStart(3)} ${String(az).padStart(4)}  ${String(roof).padStart(7)}  ${String(lane).padStart(6)}   (${wx},${wz})`);
}
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
