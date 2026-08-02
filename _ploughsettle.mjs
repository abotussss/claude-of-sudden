/**
 * ════════════════════════════════════════════════════════════════════════════
 * DOES PLOUGH DEBRIS COME DOWN? — 「空中に瓦礫が浮いてます」, the visual half
 * ════════════════════════════════════════════════════════════════════════════
 * `_ploughfloat.mjs` passes and CANNOT answer this. It measures COLLISION, and
 * plough debris is visual-only by design, so a chunk that hangs in the air for
 * ever is invisible to that gate and perfectly visible to the player — who has
 * raised floating rubble twice.
 *
 * The settled pose is BAKED: the shader drives every chunk from its instance
 * matrix to `matrix + aOff` over `aMot.y` seconds and stops there, so the
 * question is answerable without watching a single frame — where does `aOff`
 * put it, relative to the road the pile stands on?
 *
 * Every pile of every hull is checked, fired or not.
 *
 *   node _ploughsettle.mjs [url] [seed] [tol]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4423/';
const SEED = process.argv[3] ?? '7';
const TOL = Number(process.argv[4] ?? 1.5);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await p.evaluate(({ TOL }) => {
  const e = window.__ENGINE__;
  const a = e.ctx.peek('match').tank;
  const phys = e.ctx.peek('physics');
  const V = e.camera.position.constructor;
  const o = new V();
  const down = new V(0, -1, 0);
  const rows = [];
  for (const t of a.tanks) {
    for (const q of t.plough ?? []) {
      if (!q.mesh) continue;
      const off = q.mesh.geometry.getAttribute('aOff');
      const mat = q.mesh.instanceMatrix.array;
      let worst = -Infinity;
      let worstXZ = null;
      let n = 0;
      for (let i = 0; i < off.count; i++) {
        const x = mat[i * 16 + 12] + off.getX(i);
        const y = mat[i * 16 + 13] + off.getY(i);
        const z = mat[i * 16 + 14] + off.getZ(i);
        // the ground UNDER where the chunk ends up, not the pile's own road:
        // a pile on a kerb throws pieces onto the road beside it
        o.set(x, y + 25, z);
        const h = phys.raycast(o, down, 60, phys.MASK.WORLD);
        const g = h?.hit ? y + 25 - h.distance : q.y;
        const air = y - g;
        if (air > worst) { worst = air; worstXZ = [+x.toFixed(1), +y.toFixed(2), +z.toFixed(1)]; }
        if (air > TOL) n++;
      }
      rows.push({
        tank: t.id, ix: q.ix, leg: q.leg, top: +q.top.toFixed(2),
        chunks: off.count, worstAir: +worst.toFixed(2), floating: n, at: worstXZ,
      });
    }
  }
  return rows;
}, { TOL });

const bad = out.filter((r) => r.floating > 0).sort((x, y) => y.worstAir - x.worstAir);
console.log(`\n  ${out.length} piles, ${out.reduce((s, r) => s + r.chunks, 0)} settled chunks, tolerance ${TOL} m`);
console.log(`  piles with a chunk settling more than ${TOL} m off the ground: ${bad.length}`);
for (const r of bad.slice(0, 14)) {
  console.log(
    `    ${r.tank} pile ${r.ix} (leg ${r.leg}, ${r.top} m tall, ${r.chunks} chunks): ` +
      `${r.floating} floating, worst ${r.worstAir} m of air at ${JSON.stringify(r.at)}`
  );
}
const worst = out.reduce((m, r) => Math.max(m, r.worstAir), -Infinity);
console.log(`\n  worst air under any settled plough chunk: ${worst.toFixed(2)} m`);
console.log(`  ${bad.length === 0 ? 'PASS' : 'FAIL'} — plough debris ${bad.length === 0 ? 'all settles on the ground' : 'HANGS IN THE AIR'}`);
if (errs.length) console.log('  PAGEERRORS:', errs);
await b.close();
process.exit(bad.length === 0 ? 0 : 1);
