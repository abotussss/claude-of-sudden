/**
 * IS THERE ANYTHING TO PLOUGH, AND CAN IT BE MADE TO STOP EXISTING?
 *
 * Sweeps the tank's own baked corridor for solid mass standing between 0.3 m
 * and the glacis top (1.8 m) over the local ground — the rule the plough is
 * derived from — and then asks the only question that decides whether the
 * feature is buildable at all: for each piece of mass found, is there a
 * `prop_*` InstancedMesh instance sitting inside it? An instance can be hidden
 * by zeroing sixteen floats, which is what `Assembler.setScopeVisible` already
 * does for a demolition scope. Mass with no instance behind it cannot be made
 * to disappear from `src/match`, so the tank must not pretend to plough it.
 *
 * Usage: node _ploughscan.mjs [url] [seed]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4290/';
const SEED = process.argv[3] ?? '7';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const m = ctx.peek('match');
  const phys = ctx.peek('physics');
  const a = m?.tank;
  if (!a?.ready) return { error: 'no armour' };
  const V3 = e.camera.position.constructor;
  const M4 = e.camera.matrixWorld.constructor;

  const PLOUGH_TOP = 1.8;   // the glacis top edge, from _buildBody
  const PLOUGH_MIN = 0.3;   // below this the hull simply drives over it
  const HULL_W = 3.3;

  /* ---- every prop instance in the level, in world space --------------- */
  const props = [];
  const mm = new M4();
  ctx.scene.traverse((o) => {
    if (!o.isInstancedMesh || !/^prop_/.test(o.name)) return;
    const im = new M4();
    for (let j = 0; j < o.count; j++) {
      o.getMatrixAt(j, im);
      mm.multiplyMatrices(o.matrixWorld, im);
      props.push({
        name: o.name, mesh: o.name, slot: j,
        x: mm.elements[12], y: mm.elements[13], z: mm.elements[14],
      });
    }
  });

  const results = [];
  for (const tank of a.tanks) {
    const p = tank.path;
    const found = [];
    const seen = new Set();
    const down = new V3(0, -1, 0);

    for (let i = 0; i < p.n; i++) {
      const gx = p.X[i], gy = p.Y[i], gz = p.Z[i];
      const yaw = p.YAW[i];
      // travel direction and its perpendicular
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const sx = fz, sz = -fx;
      // three lanes across the hull width, marching forward one sample's worth
      for (const lane of [-0.4, 0, 0.4]) {
        const ox = gx + sx * lane * HULL_W, oz = gz + sz * lane * HULL_W;
        const gy2 = phys.groundHeight(ox, oz, 30);
        const base = Number.isFinite(gy2) ? gy2 : gy;
        // probe at knee height — under the glacis, over the kerb
        const o = new V3(ox, base + 0.55, oz);
        const d = new V3(fx, 0, fz);
        const h = phys.raycast(o, d, 2.0, phys.MASK.WORLD);
        if (!h?.hit) continue;
        const hx = ox + fx * h.distance, hz = oz + fz * h.distance;
        // how high does this mass stand over its own ground?
        const topH = phys.raycast(new V3(hx + fx * 0.12, base + 30, hz + fz * 0.12), down, 45, phys.MASK.WORLD);
        if (!topH?.hit) continue;
        const top = base + 30 - topH.distance - base;
        const key = `${Math.round(hx / 1.2)},${Math.round(hz / 1.2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // bind: any prop instance inside a tight box round the hit?
        const near = props.filter((q) =>
          Math.abs(q.x - hx) < 1.6 && Math.abs(q.z - hz) < 1.6 && q.y > base - 1.0 && q.y < base + PLOUGH_TOP + 1.0);
        found.push({
          i, x: +hx.toFixed(1), z: +hz.toFixed(1), top: +top.toFixed(2),
          surface: h.surface ?? null,
          ploughable: top > PLOUGH_MIN && top <= PLOUGH_TOP,
          bound: near.length,
          boundNames: [...new Set(near.map((q) => q.name))].slice(0, 4),
        });
      }
    }
    results.push({ id: tank.id, routeLen: +p.length.toFixed(1), samples: p.n, found });
  }
  return { results, propCount: props.length, propKinds: [...new Set(props.map((q) => q.name))].length };
});

if (out.error) { console.log('ERROR', out.error); }
else {
  console.log(`prop instances in the level: ${out.propCount} across ${out.propKinds} prototypes`);
  for (const r of out.results) {
    const pl = r.found.filter((f) => f.ploughable);
    const bd = pl.filter((f) => f.bound > 0);
    console.log(`\n=== ${r.id} — ${r.routeLen} m, ${r.samples} samples`);
    console.log(`    mass met: ${r.found.length}   ploughable (0.3<top<=1.8): ${pl.length}   of those BINDABLE to a prop instance: ${bd.length}`);
    for (const f of r.found) {
      console.log(`      i${String(f.i).padStart(3)} (${String(f.x).padStart(7)},${String(f.z).padStart(7)}) top=${String(f.top).padStart(6)} ` +
        `${f.ploughable ? 'PLOUGH' : 'block '} bound=${String(f.bound).padStart(3)} ${f.boundNames.join(',')}`);
    }
  }
}
if (errs.length) console.log('\nPAGEERRORS:', errs);
await b.close();
