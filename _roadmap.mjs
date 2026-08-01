/**
 * WHERE A 3.3 m HULL FITS, as an ASCII plan of the whole level.
 *
 * One sample per 2 authored (widened) units. A cell is open if the ground ray
 * finds ground and a 2.2 m clearance ray at hull height is free in all four
 * plan directions — which is the same question `Armour._bakePath`'s lateral
 * probe asks, asked everywhere instead of along one polyline.
 *
 *   .  open        a hull fits
 *   :  half        ground, but 1.2-2.2 m of side room only
 *   #  blocked     mass at hull height
 *   (space) no ground
 *
 * Usage: node _roadmap.mjs <url> [x0 x1 z0 z1 step]
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4291/';
const X0 = +(process.argv[3] ?? -84), X1 = +(process.argv[4] ?? 84);
const Z0 = +(process.argv[5] ?? -72), Z1 = +(process.argv[6] ?? 72);
const STEP = +(process.argv[7] ?? 2);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const out = await page.evaluate(([X0, X1, Z0, Z1, STEP]) => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), w = e.ctx.peek('world'), phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const SCALE = 1.5, MASK = phys.MASK.WORLD;
  const o = new V3(), d = new V3(), lv = new V3();
  const rows = [];
  const zmark = new Map();
  for (const z of (m.allZones ?? [])) {
    w.worldToLevel(z.position.x, z.position.y, z.position.z, lv);
    zmark.set(`${Math.round(lv.x / SCALE / STEP)},${Math.round(lv.z / SCALE / STEP)}`, z.id);
  }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let zi = Z1; zi >= Z0; zi -= STEP) {
    let row = '';
    for (let xi = X0; xi <= X1; xi += STEP) {
      const p = w.levelToWorld(xi * SCALE, 0, zi * SCALE, new V3());
      const g = phys.groundHeight(p.x, p.z, 40);
      if (!Number.isFinite(g)) { row += ' '; continue; }
      const key = `${Math.round(xi / STEP)},${Math.round(zi / STEP)}`;
      if (zmark.has(key)) { row += zmark.get(key); continue; }
      o.set(p.x, g + 1.0, p.z);
      let worst = 9;
      for (const [dx, dz] of dirs) {
        // the plan directions are the LEVEL's, so rotate them the way the point was
        const a = w.levelToWorld((xi + dx) * SCALE, 0, (zi + dz) * SCALE, new V3());
        d.set(a.x - p.x, 0, a.z - p.z).normalize();
        const h = phys.raycast(o, d, 2.4, MASK);
        const f = h?.hit ? h.distance : 2.4;
        if (f < worst) worst = f;
      }
      row += worst >= 2.2 ? '.' : worst >= 1.2 ? ':' : '#';
    }
    rows.push(`${String(zi).padStart(4)} ${row}`);
  }
  let hdr = '     ';
  for (let xi = X0; xi <= X1; xi += STEP) hdr += Math.abs(xi) % 20 === 0 ? '|' : ' ';
  let hdr2 = '     ';
  for (let xi = X0; xi <= X1; xi += STEP) hdr2 += Math.abs(xi) % 20 === 0 ? String(Math.abs(xi) / 10 % 10) : ' ';
  const zl = [];
  for (const z of (m.allZones ?? [])) {
    w.worldToLevel(z.position.x, z.position.y, z.position.z, lv);
    zl.push(`${z.id} level(${(lv.x / SCALE).toFixed(1)},${(lv.z / SCALE).toFixed(1)}) world(${z.position.x.toFixed(1)},${z.position.z.toFixed(1)}) r${z.radius} locked=${!!z.locked}`);
  }
  return { rows, hdr, hdr2, zl };
}, [X0, X1, Z0, Z1, STEP]);
console.log(out.zl.join('\n'));
console.log(out.hdr);
console.log(out.hdr2);
console.log(out.rows.join('\n'));
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
