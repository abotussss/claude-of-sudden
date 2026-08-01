/**
 * WHAT IS STANDING ON A CACHE'S RING — by name, not by inference.
 *
 *   node _cachering.mjs --url=http://127.0.0.1:4310/?seed=2 --id=E3-f0-ammo
 *
 * `floorcheck` reports a cache as BURIED when fewer than three of the eight
 * standing spots on its ring pass a capsule test. It cannot say WHAT is in the
 * way, and the answer decides which pass is at fault: a prototype instance is
 * the furnishing pass's, a `world_*` static mesh is the building's.
 *
 * Prints, per failing ring point, the nearest instanced prop by prototype id
 * and the mesh a short ray into the blockage hits.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4310/';
const WANT = args.id ?? null;

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('  pageerror', String(e.message).slice(0, 160)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate((WANT) => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world'), phys = c.peek('physics');
  const V = c.camera.position.constructor;
  const M4 = w.A.xform.constructor;
  const MASK = phys.MASK.CHARACTER;
  const R = 0.32, H = 1.78, STEP = 0.42;
  const _a = new V(), _b = new V(), _p = new V(), _m = new M4();

  /** Every instanced prop in the scene, as (id, world x/y/z). */
  const props = [];
  c.scene.traverse((o) => {
    if (!o.isInstancedMesh || !o.name.startsWith('prop_')) return;
    const id = o.name.slice(5);
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, _m);
      props.push({ id, x: _m.elements[12], y: _m.elements[13], z: _m.elements[14] });
    }
  });

  const rows = [];
  for (const f of w.features ?? []) {
    if (WANT && f.id !== WANT) continue;
    const ring = f.kind === 'vantage' ? 1.9 : 1.25;
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const lx = f.level.x + Math.cos(a) * ring, lz = f.level.z + Math.sin(a) * ring;
      w.levelToWorld(lx, f.level.y, lz, _p);
      _a.set(_p.x, _p.y + STEP + R, _p.z);
      _b.set(_p.x, _p.y + H - R + 0.02, _p.z);
      const ok = phys.checkCapsule(_a, _b, R - 0.02, MASK);
      let near = null, nd = Infinity;
      for (const p of props) {
        if (Math.abs(p.y - _p.y) > 2.2) continue;
        const d = Math.hypot(p.x - _p.x, p.z - _p.z);
        if (d < nd) { nd = d; near = p.id; }
      }
      /** What a ray at chest height hits, sweeping the ring point's own circle. */
      const names = [];
      for (const hy of [0.5, 0.7, 0.95, 1.3, 1.6]) {
        for (let k = 0; k < 12; k++) {
          const b = (k / 12) * Math.PI * 2;
          const hit = phys.raycast(_p.x, _p.y + hy, _p.z, Math.cos(b), 0, Math.sin(b), 0.5, MASK);
          if (!hit.hit) continue;
          const tag = `${hit.object?.name ?? '?'}@${hy}`;
          if (!names.includes(tag)) names.push(tag);
        }
      }
      pts.push({ i, ok, near, nd: +nd.toFixed(2), names,
        a: +(a * 57.3).toFixed(0) });
    }
    rows.push({ id: f.id, kind: f.kind, ring, pts,
      level: { x: +f.level.x.toFixed(2), y: +f.level.y.toFixed(2), z: +f.level.z.toFixed(2) } });
  }
  return rows;
}, WANT);

for (const r of out) {
  console.log(`\n  ${r.id} (${r.kind}) at ${r.level.x}, ${r.level.y}, ${r.level.z} — ring ${r.ring} m`);
  for (const p of r.pts) {
    console.log(
      `    ${String(p.a).padStart(3)}deg  ${p.ok ? 'stand ' : 'BLOCK '}` +
      ` nearest prop ${String(p.near).padEnd(14)} ${p.nd} m   hits: ${p.names.join(', ')}`
    );
  }
}
await browser.close();
