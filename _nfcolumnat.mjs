/**
 * WHAT IS ACTUALLY IN THE COLUMN AT (x, z)? — the question `groundHeight`
 * cannot answer, because it only ever returns the FIRST thing it hits.
 *
 *   node _nfcolumnat.mjs [--url=…] --at=0,-32 [--at=17.5,3.25 …]
 *
 * `physics.groundHeight(x, z)` is `raycast(x, 200, z, 0,-1,0, …)` and returns
 * `hit.point.y` — the top of the HIGHEST solid over that spot, whatever it is
 * (`src/physics/index.js:734`). It is a floor query only where the sky is
 * empty. So "groundHeight(0,-32) returns 26.9 against a real plain at 3.20" is
 * two very different findings depending on what the 26.9 belongs to, and the
 * only way to tell them apart is to walk the whole column and name every layer:
 *
 *   a CONTINUOUS stack from the plain up to 26.9  -> a building. Not a bug.
 *   a slab at 26.9 with clear air under it        -> the fuelBund class of bug.
 *
 * Prints, per point: the analytic plain, then every solid interval the physics
 * world has over it with the mesh that owns it, and the same again against the
 * TRIANGLE BVH ALONE (`physics.staticWorld`) — which is the world the character
 * controller actually moves through, since `sweepCapsule`/`overlapCapsule`
 * consult no collider list.
 */
import { chromium } from 'playwright';

const args = [];
let URL = 'http://127.0.0.1:4625/?map=plains&capture=1';
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--url=')) URL = a.slice(6);
  else if (a.startsWith('--at=')) args.push(a.slice(5).split(',').map(Number));
}
if (!args.length) args.push([0, -32]);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

const out = await p.evaluate((pts) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const w = e.ctx.peek('world');
  const MASK = ph.MASK.WORLD;
  const res = [];
  for (const [x, z] of pts) {
    const plain = w.level.groundY(x, z);
    const gh = ph.groundHeight(x, z);
    /** Every downward crossing, physics world (BVH + collider list + bodies). */
    const walk = (raw) => {
      const hits = [];
      let from = 200;
      for (let i = 0; i < 40; i++) {
        const h = raw
          ? (() => {
              const o = {};
              const ok = ph.staticWorld.raycast(x, from, z, 0, -1, 0, o, MASK, o);
              return ok ? { hit: true, y: o.point ? o.point.y : o.y, name: '(bvh)' } : { hit: false };
            })()
          : (() => {
              const q = ph.raycast(x, from, z, 0, -1, 0, 400, MASK);
              return q.hit ? { hit: true, y: q.point.y, name: q.object?.name ?? (q.collider ? 'collider' : '?') } : { hit: false };
            })();
        if (!h.hit || !isFinite(h.y)) break;
        if (h.y < plain - 12) break;
        hits.push([+h.y.toFixed(2), h.name]);
        from = h.y - 0.05;
      }
      return hits;
    };
    /**
     * BVH-only floor, which is the floor the character controller stands on:
     * `sweepCapsule`/`overlapCapsule` go straight to `staticWorld` and consult
     * no collider list, so a proxy box with no triangles behind it holds a
     * raycast up and holds NOBODY up.
     * `StaticWorld.raycast(ox,oy,oz,dx,dy,dz,maxDist,mask,out)` fills `out.py`.
     */
    let bvhTop = null;
    try {
      const o = {};
      if (ph.staticWorld.raycast(x, 200, z, 0, -1, 0, 400, MASK, o)) bvhTop = +o.py.toFixed(2);
    } catch (err) { bvhTop = `err:${err.message}`; }
    res.push({ x, z, plain: +plain.toFixed(2), groundHeight: +gh.toFixed(2), bvhTop, stack: walk(false) });
  }
  return res;
}, args);

for (const r of out) {
  console.log(`\n(${r.x}, ${r.z})  plainsY ${r.plain}   physics.groundHeight ${r.groundHeight}   BVH-only top ${r.bvhTop}`);
  console.log(`  the column, top down — ${r.stack.length} solid crossings:`);
  let prev = null;
  for (const [y, name] of r.stack) {
    const gap = prev === null ? '' : `   (${(prev - y).toFixed(2)} m of air above this)`;
    console.log(`    y ${String(y).padStart(7)}   ${name}${gap}`);
    prev = y;
  }
  if (r.stack.length) {
    const lowest = r.stack[r.stack.length - 1][0];
    console.log(`  lowest crossing ${lowest} vs plain ${r.plain} — ${(lowest - r.plain).toFixed(2)} m over the plain`);
  }
}
console.log(errs.length ? `\nPAGEERRORS: ${errs[0]}` : '\n0 pageerrors');
await b.close();
