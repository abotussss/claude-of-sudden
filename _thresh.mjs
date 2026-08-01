/**
 * IS EVERY THRESHOLD WALKABLE, INSIDE AND OUT — and if not, what is in it?
 *
 *   node _thresh.mjs --url=http://127.0.0.1:4310/?seed=1 --id=EC8
 *
 * `floorcheck` reports "ONE WAY OUT" for a level whose ways out cluster into a
 * single place, which is what a shed with two doors looks like when one of them
 * is dressed shut. It cannot say which door or what is in it. This walks the
 * door's own normal from 1.4 m outside to 1.4 m inside with the real capsule and
 * names the nearest instanced prop that carries a proxy at each sample.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4310/';
const ONLY = args.id ? String(args.id).split(',') : null;

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('  pageerror', String(e.message).slice(0, 160)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate((ONLY) => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world'), phys = c.peek('physics');
  const V = c.camera.position.constructor;
  const M4 = w.A.xform.constructor;
  const MASK = phys.MASK.CHARACTER;
  const R = 0.32, H = 1.78, STEP = 0.42;
  const _a = new V(), _b = new V(), _p = new V(), _m = new M4();

  const solid = [];
  c.scene.traverse((o) => {
    if (!o.isInstancedMesh || !o.name.startsWith('prop_')) return;
    const id = o.name.slice(5);
    if (!w.A.isSolid(id)) return;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, _m);
      solid.push({ id, x: _m.elements[12], y: _m.elements[13], z: _m.elements[14] });
    }
  });

  const OUT = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const rows = [];
  const B = w.layout.BUILDINGS;
  for (let bi = 0; bi < B.length; bi++) {
    const spec = B[bi];
    if (!spec.enterable) continue;
    if (ONLY && !ONLY.includes(spec.id)) continue;
    const info = w.buildings[bi];
    const y0 = info.floorY[0];
    for (const d of info.doors) {
      const [nx, nz] = OUT[d.side];
      const samples = [];
      for (const t of [-1.4, -0.9, -0.5, 0, 0.5, 0.9, 1.4]) {
        const lx = d.wp[0] + nx * t, lz = d.wp[2] + nz * t;
        // the floor here, then standing room on it
        w.levelToWorld(lx, y0 + 2.2, lz, _p);
        const fl = phys.raycast(_p.x, _p.y, _p.z, 0, -1, 0, 4.5, MASK);
        if (!fl.hit) { samples.push({ t, ok: false, why: 'no floor' }); continue; }
        const fy = fl.point.y;
        _a.set(_p.x, fy + STEP + R, _p.z);
        _b.set(_p.x, fy + H - R + 0.02, _p.z);
        const ok = phys.checkCapsule(_a, _b, R - 0.005, MASK);
        let near = null, nd = Infinity;
        for (const s of solid) {
          if (Math.abs(s.y - fy) > 2.0) continue;
          const dd = Math.hypot(s.x - _p.x, s.z - _p.z);
          if (dd < nd) { nd = dd; near = s.id; }
        }
        /** When it is blocked, WHAT blocks it: sweep the capsule's own column. */
        const names = [];
        if (!ok) {
          for (const hy of [0.5, 0.8, 1.1, 1.4, 1.7]) {
            for (let k = 0; k < 12; k++) {
              const b = (k / 12) * Math.PI * 2;
              const h = phys.raycast(_p.x, fy + hy, _p.z, Math.cos(b), 0, Math.sin(b), 0.42, MASK);
              if (!h.hit) continue;
              const tagn = `${h.object?.name ?? '?'}@${hy}`;
              if (!names.includes(tagn)) names.push(tagn);
            }
          }
        }
        samples.push({ t, ok, fy: +fy.toFixed(2), near, nd: +nd.toFixed(2), names });
      }
      rows.push({ id: spec.id, side: d.side, samples });
    }
  }
  return rows;
}, ONLY);

for (const r of out) {
  console.log(`\n  ${r.id} door on side ${r.side}   (t<0 outside, t>0 inside)`);
  for (const s of r.samples) {
    console.log(`    t=${String(s.t).padStart(5)}  ${s.ok ? 'stand' : 'BLOCK'}  floor ${String(s.fy ?? s.why).padStart(6)}  nearest solid ${String(s.near).padEnd(13)} ${s.nd ?? ''}  ${(s.names ?? []).join(' ')}`);
  }
}
await browser.close();
