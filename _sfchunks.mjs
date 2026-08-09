/**
 * IS ANY OF THE CARRIER'S DEBRIS STANDING ON NOTHING?
 *
 *   node _sfchunks.mjs [--url=…]
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AND WHY `_floatcheck` CANNOT ANSWER IT
 * ────────────────────────────────────────────────────────────────────────────
 * 「大聖堂爆破すると空中に瓦礫が浮いてます しかも物理判定あるので戦車が空中に登って
 *  しまいますよ？？？」 — floating rubble has shipped four times on this project.
 *
 * `_floatcheck.mjs` reconstructs the solid intervals of the PHYSICS world, and
 * `_nffloating.mjs` bins the triangles of the `world` group. The 180 chunks the
 * carrier sheds are in neither: they carry NO COLLISION (like the wreck and
 * like both fires) and they live under `match-skyfall` in `ctx.scene`, not
 * under `world`. Both gates are STRUCTURALLY BLIND to them and will return a
 * clean sheet whatever this does, which is the worst possible failure mode.
 *
 * So the settled pose is checked directly, at boot, before anything has fired:
 * every chunk's settled matrix is read out of `_chunkSettled`, its centre is
 * compared with `physics.groundHeight` under it, and its own half-diagonal is
 * taken off that — a rotated box's lowest point, not an axis-aligned
 * idealisation of one. Anything with daylight under it is named.
 *
 * It also proves the two things the prewarm argument rests on: that the blast
 * meshes are VISIBLE with one instance and that the chunk mesh is drawing one
 * parked instance, before the event.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4639/?map=plains&capture=1';

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
const notes = []; p.on('console', (m) => { const t = m.text(); if (/skyfall|crash\]/i.test(t)) notes.push(t); });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const lvl = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
console.log('level.id =', lvl);

const m = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const s = e.ctx.peek('match').crash?._sky;
  if (!s?.ready) return { none: true };
  const A = s._chunkSettled;
  const n = A.length / 16;
  let worst = -1e9;
  let worstAt = null;
  let floating = 0;
  let outside = 0;
  for (let i = 0; i < n; i++) {
    const b = i * 16;
    const x = A[b + 12];
    const y = A[b + 13];
    const z = A[b + 14];
    /** Column lengths of the upper 3x3 are the scale; the box is a unit cube. */
    const sx = Math.hypot(A[b], A[b + 1], A[b + 2]);
    const sy = Math.hypot(A[b + 4], A[b + 5], A[b + 6]);
    const sz = Math.hypot(A[b + 8], A[b + 9], A[b + 10]);
    /** Half the body diagonal: the lowest a rotated box can put a corner. */
    const half = 0.5 * Math.hypot(sx, sy, sz);
    const g = ph.groundHeight(x, z, 400);
    const gap = y - half - g;
    if (gap > worst) { worst = gap; worstAt = [+x.toFixed(1), +y.toFixed(2), +z.toFixed(1), +g.toFixed(2), +half.toFixed(2)]; }
    if (gap > 0) floating++;
    if (Math.hypot(x, z) > 176) outside++;
  }
  return {
    chunks: n, worstGap: +worst.toFixed(2), worstAt, floating, outsideDisc: outside,
    centreOverGround: +s._chunkFloat.toFixed(2),
    det: { add: s._detAdd, smoke: s._detSmoke, reach: +s._detR.toFixed(0), top: +s._detTop.toFixed(0) },
    idle: {
      addCount: s._blastAdd.geometry.instanceCount, addVisible: s._blastAdd.visible,
      smokeCount: s._blastSmoke.geometry.instanceCount, smokeVisible: s._blastSmoke.visible,
      chunkCount: s.chunks.count, chunkVisible: s.chunks.visible,
      chunkY: +s.chunks.instanceMatrix.array[13].toFixed(0),
      uT: s._detU.uT.value, uAnim: s._chunkU.uAnim.value,
      regionBlast: [...s._fireU.uBlast.value],
      scarBlast: s._scarFire ? [...s._scarFire.uBlast.value] : null,
    },
  };
});
if (m.none) { console.log('no skyfall on this map — nothing to check'); }
else {
  console.log(`\n${m.chunks} chunks, settled:`);
  console.log(`  worst gap under a chunk's lowest possible corner: ${m.worstGap} m ` +
    `at (${m.worstAt.slice(0, 3).join(', ')}), ground ${m.worstAt[3]}, half-diagonal ${m.worstAt[4]}`);
  console.log(`  chunks with ANY daylight under them: ${m.floating}${m.floating ? '   <-- FLOATING' : ''}`);
  console.log(`  chunks outside the 176 m walkable disc: ${m.outsideDisc}`);
  console.log(`  highest chunk CENTRE over its own ground: ${m.centreOverGround} m`);
  console.log(`\ndetonation: ${m.det.add} additive + ${m.det.smoke} alpha quads, ` +
    `reaches ${m.det.reach} m, climbs ${m.det.top} m`);
  console.log('idle state (must be: both blast meshes VISIBLE at 1 instance, chunks 1 instance parked):');
  console.log(' ', JSON.stringify(m.idle));
}
for (const n of notes) console.log('  ·', n.slice(0, 260));
console.log(errs.length ? `PAGEERRORS(${errs.length}) ${errs[0]}` : '0 pageerrors');
await b.close();
