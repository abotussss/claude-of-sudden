/**
 * RUN `Armour._bakePath` ITSELF on a candidate polyline. `_tankroute.mjs`
 * REIMPLEMENTS the bake, which was fine while there was one rule and stopped
 * being fine the moment the side probes learned to climb: a scout and a
 * reimplementation can both be right and still disagree with the code that
 * ships. This calls the real method on the real instance, from the tank's own
 * baked hub, and prints exactly what the boot log would say.
 *
 * Usage: node _legprobe.mjs <url> '<json [{tank:"RED",zone:"C",points:[[x,z]...]}]>'
 *   points are authored (widened) units; point 0 is REPLACED by the hub.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4291/';
const JOBS = JSON.parse(process.argv[3] ?? '[]');
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const out = await page.evaluate((JOBS) => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), w = e.ctx.peek('world'), phys = e.ctx.peek('physics');
  const a = m.tank; const V3 = e.camera.position.constructor; const S = 1.5;
  const zones = (m.allZones ?? []).map((z) => ({ id: z.id, x: z.position.x, z: z.position.z }));
  const res = [];
  for (const job of JOBS) {
    const t = a.tanks.find((x) => x.id === job.tank);
    if (!t) { res.push(`${job.tank}: no such hull`); continue; }
    const h = t.legs[0]; const j = h.n - 1;
    const pts = job.points.map((p, i) => (i === 0
      ? new V3(h.X[j], h.Y[j], h.Z[j])
      : w.levelToWorld(p[0] * S, 0, p[1] * S, new V3())));
    const path = a._bakePath(pts, w, phys);
    if (!path) {
      /* March it by hand with the SAME `_freeSide` and say where it died. */
      const rx = [], rz = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const A = pts[i], B = pts[i + 1];
        const seg = Math.hypot(B.x - A.x, B.z - A.z), nn = Math.max(1, Math.round(seg / 1.25));
        for (let k = 0; k < nn; k++) { const u = k / nn; rx.push(A.x + (B.x - A.x) * u); rz.push(A.z + (B.z - A.z) * u); }
      }
      rx.push(pts[pts.length - 1].x); rz.push(pts[pts.length - 1].z);
      const o2 = new V3(); const marks = [];
      for (let i = 0; i < Math.min(rx.length, 60); i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(rx.length - 1, i + 1);
        let dx = rx[i1] - rx[i0], dz = rz[i1] - rz[i0];
        const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        const y = phys.groundHeight(rx[i], rz[i], 30);
        if (!Number.isFinite(y)) { marks.push(`${i}:NOGROUND`); continue; }
        const sR = a._freeSide(phys, rx[i], y + 1.0, rz[i], dz, -dx, 9);
        const sL = a._freeSide(phys, rx[i], y + 1.0, rz[i], -dz, dx, 9);
        w.worldToLevel(rx[i], y, rz[i], o2);
        marks.push(`${i}@(${(o2.x / S).toFixed(1)},${(o2.z / S).toFixed(1)})=${(sR + sL).toFixed(1)}`);
      }
      res.push(`${job.tank}->${job.zone}: NULL — spans ${marks.join(' ')}`);
      continue;
    }
    const z = zones.find((q) => q.id === job.zone);
    const endD = z ? Math.hypot(path.X[path.n - 1] - z.x, path.Z[path.n - 1] - z.z) : NaN;
    // where did each surviving sample get to, in authored units?
    const o = new V3();
    const tail = [];
    for (let i = Math.max(0, path.n - 3); i < path.n; i++) {
      w.worldToLevel(path.X[i], path.Y[i], path.Z[i], o);
      tail.push(`${i}:(${(o.x / S).toFixed(1)},${(o.z / S).toFixed(1)})`);
    }
    res.push(
      `${job.tank}->${job.zone}: ${path.n} samples / ${path.length.toFixed(1)} m, narrowest ${path.narrowest.toFixed(1)} m, ` +
      `ends ${endD.toFixed(1)} m off ${job.zone} — ${path.stop}\n      last: ${tail.join(' ')}`
    );
  }
  return res;
}, JOBS);
console.log(out.join('\n'));
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
