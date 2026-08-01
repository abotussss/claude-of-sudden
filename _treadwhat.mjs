/**
 * WHAT IS OVER A TREAD — the object the headroom ray hits, and the instanced
 * props standing near where it hits.
 *
 *   node _treadwhat.mjs --url=http://127.0.0.1:4310/?seed=6 --id=W3 --floor=1
 *
 * `floorcheck` says "SEALED CEILING over tread N" and cannot say what the
 * ceiling is. A stairwell is a hole, so anything the ray finds inside it was
 * placed by a pass that did not know the hole was there.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4310/';
const ID = args.id ?? 'W3';
const FLOOR = Number(args.floor ?? 1);

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('  pageerror', String(e.message).slice(0, 160)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(({ ID, FLOOR }) => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world'), phys = c.peek('physics');
  const V = c.camera.position.constructor;
  const M4 = w.A.xform.constructor;
  const MASK = phys.MASK.CHARACTER;
  const _p = new V(), _m = new M4();

  const props = [];
  c.scene.traverse((o) => {
    if (!o.isInstancedMesh || !o.name.startsWith('prop_')) return;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, _m);
      props.push({ id: o.name.slice(5), x: _m.elements[12], y: _m.elements[13], z: _m.elements[14] });
    }
  });

  const B = w.layout.BUILDINGS;
  const bi = B.findIndex((b) => b.id === ID);
  const info = w.buildings[bi];
  const g = (info.stairs ?? []).find((s) => s.floor === FLOOR);
  if (!g) return { err: 'no such flight' };
  const ax = Math.sin(g.ry), az = Math.cos(g.ry);
  const rows = [];
  for (let i = 0; i < g.steps; i++) {
    const along = (i + 0.5) * g.run;
    const lx = g.ox + ax * along, lz = g.oz + az * along;
    const ly = g.base + (i + 1) * g.rise;
    w.levelToWorld(lx, ly, lz, _p);
    const hit = phys.raycast(_p.x, _p.y + 0.12, _p.z, 0, 1, 0, 6, MASK);
    if (!hit.hit) { rows.push({ i, head: 99 }); continue; }
    const hy = hit.point.y;
    let near = [], nd = 3;
    for (const p of props) {
      if (Math.abs(p.y - hy) > 1.4) continue;
      const d = Math.hypot(p.x - _p.x, p.z - _p.z);
      if (d < nd) near.push({ id: p.id, d: +d.toFixed(2), dy: +(p.y - hy).toFixed(2) });
    }
    near.sort((a, b) => a.d - b.d);
    rows.push({ i, head: +(hit.distance + 0.12).toFixed(2), obj: hit.object?.name ?? '?',
      hitY: +hy.toFixed(2), near: near.slice(0, 4) });
  }
  return { id: ID, floor: FLOOR, base: +g.base.toFixed(2), top: +g.top.toFixed(2),
    open: +g.open.toFixed(2), D: +g.D.toFixed(2), roofY: +info.roofY.toFixed(2),
    hole: info.roofHole, rows };
}, { ID, FLOOR });

console.log(JSON.stringify(out, null, 1));
await browser.close();
