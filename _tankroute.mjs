/**
 * TRY A TANK ROUTE WITHOUT REBUILDING. Replicates `Armour._bakePath` exactly —
 * same 1.25 m resample, same left/right 9 m probes at hull height, same slide
 * onto the measured centreline, same "a span narrower than HULL_W + CLEARANCE
 * trims the route" — so a candidate polyline can be measured against the built
 * map before it is authored into src/match/tank.js.
 *
 * Usage: node _tankroute.mjs <url> '<json array of routes>'
 *   [{ "id":"RED", "points":[[8,56],[8,46],...] }, ...]   authored units (x1.5)
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4272/';
const ROUTES = JSON.parse(process.argv[3] ?? '[]');
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const out = await page.evaluate((ROUTES) => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), w = e.ctx.peek('world'), phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const SCALE = 1.5, HULL_W = 3.3, CLEARANCE = 1.1, LATERAL_MAX = 3.0, STEP = 1.25, MIN_ROUTE = 16;
  const clamp = (v, a, c) => (v < a ? a : v > c ? c : v);
  const zones = (m.allZones ?? []).map((z) => ({ id: z.id, x: z.position.x, z: z.position.z }));
  const res = [];
  for (const spec of ROUTES) {
    const pts = spec.points.map((p) => w.levelToWorld(p[0] * SCALE, 0, p[1] * SCALE, new V3()));
    const rx = [], rz = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const seg = Math.hypot(c.x - a.x, c.z - a.z);
      const n = Math.max(1, Math.round(seg / STEP));
      for (let k = 0; k < n; k++) { const t = k / n; rx.push(a.x + (c.x - a.x) * t); rz.push(a.z + (c.z - a.z) * t); }
    }
    rx.push(pts[pts.length - 1].x); rz.push(pts[pts.length - 1].z);
    const MASK = phys.MASK.WORLD, need = HULL_W + CLEARANCE;
    const probe = new V3(), side = new V3();
    let narrowest = Infinity, kept = 0, stop = 'end of polyline';
    const tight = [];
    const px = [], pz = [];
    for (let i = 0; i < rx.length; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(rx.length - 1, i + 1);
      let dx = rx[i1] - rx[i0], dz = rz[i1] - rz[i0];
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      side.set(dz, 0, -dx);
      let x = rx[i], z = rz[i];
      let y = phys.groundHeight(x, z, 30);
      if (!Number.isFinite(y)) { stop = `NO GROUND at sample ${i}`; break; }
      probe.set(x, y + 1.0, z);
      const R = phys.raycast(probe, side, 9, MASK); side.multiplyScalar(-1);
      const Lh = phys.raycast(probe, side, 9, MASK); side.multiplyScalar(-1);
      const dR = R?.hit ? R.distance : 9, dL = Lh?.hit ? Lh.distance : 9;
      const shift = clamp((dR - dL) * 0.5, -LATERAL_MAX, LATERAL_MAX);
      x += side.x * shift; z += side.z * shift;
      const span = dR + dL;
      if (span < need) { stop = `PINCH ${span.toFixed(1)}m at sample ${i} (${x.toFixed(1)},${z.toFixed(1)})`; break; }
      if (span < narrowest) { narrowest = span; spec._nx = +x.toFixed(1); spec._nz = +z.toFixed(1); spec._ni = i; }
      if (span < 8) tight.push(`${i}@(${x.toFixed(0)},${z.toFixed(0)})=${span.toFixed(1)}`);
      px.push(x); pz.push(z); kept++;
    }
    let length = 0;
    for (let i = 1; i < kept; i++) length += Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
    let best = Infinity, which = '';
    for (const zz of zones) for (let i = 0; i < kept; i++) {
      const d = Math.hypot(px[i] - zz.x, pz[i] - zz.z);
      if (d < best) { best = d; which = zz.id; }
    }
    const endD = kept ? zones.map((zz) => `${zz.id} ${Math.hypot(px[kept - 1] - zz.x, pz[kept - 1] - zz.z).toFixed(1)}`).join(' ') : '';
    res.push({
      id: spec.id, kept, length: +length.toFixed(1), narrowest: +(narrowest === Infinity ? 0 : narrowest).toFixed(1),
      ok: kept >= 4 && length >= MIN_ROUTE, stop,
      start: kept ? [+px[0].toFixed(1), +pz[0].toFixed(1)] : null,
      end: kept ? [+px[kept - 1].toFixed(1), +pz[kept - 1].toFixed(1)] : null,
      closest: +best.toFixed(1), closestZone: which, endToZones: endD,
      narrowAt: [spec._nx, spec._nz, spec._ni], tight: tight.join(' '),
    });
  }
  return { res, zones: zones.map((z) => `${z.id}(${z.x.toFixed(1)},${z.z.toFixed(1)})`).join(' ') };
}, ROUTES);
console.log('ZONES', out.zones);
for (const r of out.res) {
  console.log(`${r.id}: ${r.ok ? 'OK' : 'DROPPED'}  ${r.kept} samples / ${r.length} m, narrowest ${r.narrowest} m`);
  console.log(`    stop: ${r.stop}`);
  console.log(`    start (${r.start})  end (${r.end})   end->zones: ${r.endToZones}`);
  console.log(`    closest approach to a capture circle: ${r.closest} m (zone ${r.closestZone})`);
  if (r.tight) console.log(`    spans under 8 m: ${r.tight}`);
}
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
