/**
 * WHERE DOES THE MAN ACTUALLY STEP OUT? — walks boundcheck's own surface column
 * out along the radial through each named leak and prints every standable
 * surface it finds, so the crossing is a measurement instead of a bisect.
 *
 *   node _nfleak.mjs http://127.0.0.1:4617/?map=plains
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4617/?map=plains';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 480 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const out = await p.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world'), phys = c.peek('physics');
  const V = c.camera.position.constructor;
  const MASK = phys.MASK.CHARACTER;
  const R = 0.32, H = 1.78, STEP = 0.42;
  const _a = new V(), _b = new V(), _wp = new V();

  const column = (lx, lz) => {
    const list = [];
    w.levelToWorld(lx, 0, lz, _wp);
    const top = w.level.groundY(lx, lz) + 34;
    const floor = w.level.groundY(lx, lz) - 9;
    let from = top;
    for (let s = 0; s < 4; s++) {
      const hit = phys.raycast(_wp.x, from, _wp.z, 0, -1, 0, from - floor + 1.8, MASK);
      if (!hit.hit) break;
      const fy = hit.point.y;
      if (fy < floor) break;
      from = fy - 0.06;
      if (hit.normal && hit.normal.y < 0.5) continue;
      _a.set(_wp.x, fy + STEP + R, _wp.z);
      _b.set(_wp.x, fy + H - R + 0.02, _wp.z);
      if (!phys.checkCapsule(_a, _b, R - 0.005, MASK)) continue;
      list.push({ y: +fy.toFixed(2), s: hit.surface });
      if (from < floor) break;
    }
    return list;
  };

  const lines = [];
  for (const [name, lx, lz] of [
    ['leak-1 [-139,-108]', -139, -108],
    ['leak-2 [-143,-102]', -143, -102],
    ['pad-A radial', -118, -104],
    ['pad-B radial', 118, 104],
    ['pad-C radial', -128, 86],
    ['pad-E radial', 128, -86],
    ['control NE (no site)', 120, -150],
  ]) {
    const d = Math.hypot(lx, lz);
    const ux = lx / d, uz = lz / d;
    const rows = [];
    for (let r = 166; r <= 190; r += 0.8) {
      const x = ux * r, z = uz * r;
      rows.push({ r: +r.toFixed(1), g: +w.level.groundY(x, z).toFixed(2), cols: column(x, z) });
    }
    lines.push({ name, bearing: +(Math.atan2(lz, lx) * 180 / Math.PI).toFixed(1), rows });
  }

  // the outermost extent of any collidable/standable built surface per zone
  const L = w.layout;
  return { lines, r0: L.RIDGE?.r0, pads: (L.PADS ?? []).map((q) => ({ id: q.id, x: q.x, z: q.z, r: +Math.hypot(q.x, q.z).toFixed(1) })) };
});

for (const l of out.lines) {
  console.log(`\n── ${l.name}  bearing ${l.bearing}°`);
  console.log('     r   groundY   standable surfaces (y : material)');
  for (const row of l.rows) {
    console.log(`  ${String(row.r).padStart(5)}  ${String(row.g).padStart(7)}   ` +
      (row.cols.length ? row.cols.map((k) => `${String(k.y).padStart(6)}:${k.s}`).join('  ') : '(none — blocked)'));
  }
}
console.log('\npads:', JSON.stringify(out.pads));
console.log('RIDGE.r0 =', out.r0, ' pageerrors', errs.length, errs[0] ?? '');
await b.close();
