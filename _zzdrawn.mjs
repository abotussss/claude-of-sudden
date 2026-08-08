/**
 * DOES THE BLOCK ATLAS TAKE THE GROUND OFF THE PICTURE? — the visual half of
 * the void. `_buildFloorMask` stops every eraser BINDING floor collision, but
 * `_buildBlockAtlas` also collapses DRAWN triangles out of the merged batches,
 * and that set is bound in render space by the same `yhi <= b.y + 0.12` road
 * datum the collision half no longer trusts. A ground triangle that stays solid
 * and stops being drawn is a hole you can walk on, which is the mirror of the
 * bug and worth a number either way.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4627/?map=plains';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id=' + await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id));
const out = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics'); const sw = ph.staticWorld; const CH = ph.MASK.CHARACTER;
  const bl = e.ctx.peek('match')?.tank?._blocks;
  let drawn = 0, floor = 0; const worst = [];
  for (const bx of bl?.list ?? []) {
    for (const d of bx.draws ?? []) {
      const idx = d.arr; const vp = d.index.__vp ?? null; void vp;
      for (let i = 0; i < d.off.length; i++) {
        const o = d.off[i];
        drawn++;
        // The positions live on the geometry the index came from; walk it back
        // through the scene, which is the only handle the record keeps.
        const g = d.__geo; void g;
      }
    }
  }
  // The record does not keep the position attribute, so re-walk the batches
  // and re-run the atlas's own box test, then ask the BVH for support.
  const world = e.ctx.peek('world');
  let d2 = 0, f2 = 0; const sample = [];
  for (const mesh of world.A.staticMeshes.values()) {
    const geo = mesh?.geometry; const index = geo?.index;
    const pAttr = geo?.getAttribute?.('position');
    if (!index || !pAttr) continue;
    const idx = index.array; const vp = pAttr.array;
    for (const bx of bl?.list ?? []) {
      for (const d of bx.draws ?? []) {
        if (d.arr !== idx) continue;
        for (let i = 0; i < d.off.length; i++) {
          const o = d.off[i];
          const i0 = idx[o] * 3, i1 = idx[o + 1] * 3, i2 = idx[o + 2] * 3;
          const x0 = vp[i0], y0 = vp[i0 + 1], z0 = vp[i0 + 2];
          const x1 = vp[i1], y1 = vp[i1 + 1], z1 = vp[i1 + 2];
          const x2 = vp[i2], y2 = vp[i2 + 1], z2 = vp[i2 + 2];
          d2++;
          const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
          const bx2 = x2 - x0, by = y2 - y0, bz = z2 - z0;
          const nx = ay * bz - az * by, ny = az * bx2 - ax * bz, nz = ax * by - ay * bx2;
          const L = Math.hypot(nx, ny, nz);
          if (!(L > 0) || Math.abs(ny) / L <= 0.34) continue;
          const lo = Math.min(y0, y1, y2) - 0.05;
          const cx = (x0 + x1 + x2) / 3, cz = (z0 + z1 + z2) / 3;
          if (sw.raycastAny(cx, lo, cz, 0, -1, 0, 300, CH)) continue;
          f2++;
          if (sample.length < 8) sample.push([+cx.toFixed(1), +lo.toFixed(2), +cz.toFixed(1), bx.ix]);
        }
      }
    }
  }
  return { drawn: d2, floor: f2, sample, blocks: bl?.list?.length ?? 0, unused: drawn + floor };
});
console.log(`  ${out.blocks} blocks, ${out.drawn} drawn triangles bound, ${out.floor} of them stand on nothing`);
for (const s of out.sample) console.log(`    (${s[0]}, ${s[2]}) y=${s[1]} block ${s[3]}`);
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs[0]}` : '[pageerror] none');
await b.close();
