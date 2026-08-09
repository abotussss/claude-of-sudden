/**
 * HOW BIG IS THE RUBBLE? — 「瓦礫がデカすぎる、小さくしろ」
 *
 *   BASE=http://127.0.0.1:4626/ node _tzchunks.mjs
 *
 * The chunk a player sees is the drawn instance, so this measures the drawn
 * instance: the SETTLED matrix of every chunk of every demolition site, decomposed
 * to its scale, reported as the longest edge. Not the `cut` table — the thing on
 * the ground.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * …AND HOW TALL THE HEAP IS — 「要塞の破壊の時に出る瓦礫はもっと背を低くして」
 * ────────────────────────────────────────────────────────────────────────────
 * A chunk's SIZE is not its HEIGHT. `Airstrike._buildMesh` rests every piece at
 * `ground + moundH·(1-r²) + half·0.72` where `half` is its largest half-extent,
 * so the top of the drawn piece stands `pile + 1.72·half` over the floor it
 * landed on. That is the number the complaint is about and no other probe reads
 * it: the settled poses live in `mesh.userData.settled`, which is what the
 * player sees from `SETTLE_AT` to the end of the round, while
 * `mesh.instanceMatrix` at boot is still the INTACT pose. Both are measured
 * here — the scale is the same in either, the translation is not.
 *
 * `topOverGround` is that top minus `world.groundHeight` under the piece, and
 * the two counts are against the crouch eye (1.02) and the standing eye (1.62).
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4626/';
/** The level dice are drawn from `Math.random()` unless `?seed=` pins them
 *  (@see `Engine.levelSeed`), so a nav count is only comparable run to run
 *  with this set. Absent, the boot is an ordinary one. */
const SEED = process.env.SEED ?? '';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${BASE}?map=plains&capture=1${SEED ? `&seed=${SEED}` : ''}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const air = e.ctx.peek('match')?.airstrike;
  const sites = air?.sites ?? [];
  const w = e.ctx.peek('world');
  const rows = [];
  for (const s of sites) {
    const edges = [];
    const tops = [];
    let n = 0;
    for (const mesh of s.meshes) {
      const m = mesh.instanceMatrix.array;
      const st = mesh.userData.settled;
      const cnt = mesh.count;
      n += cnt;
      for (let i = 0; i < cnt; i++) {
        // column lengths of the 3x3 are the world-space edge lengths
        const o = i * 16;
        const sx = Math.hypot(m[o], m[o + 1], m[o + 2]);
        const sy = Math.hypot(m[o + 4], m[o + 5], m[o + 6]);
        const sz = Math.hypot(m[o + 8], m[o + 9], m[o + 10]);
        edges.push(Math.max(sx, sy, sz));
        if (!st) continue;
        // the SETTLED pose: where the piece actually comes to rest
        const half = Math.max(sx, sy, sz) * 0.5;
        const px = st[o + 12], py = st[o + 13], pz = st[o + 14];
        const g = w.groundHeight ? w.groundHeight(px, pz) : 0;
        tops.push(py + half - g);
      }
    }
    edges.sort((a, c) => a - c);
    tops.sort((a, c) => a - c);
    const q = (arr) => (p) => +arr[Math.min(arr.length - 1, Math.floor(arr.length * p))].toFixed(2);
    const qe = q(edges);
    const qt = tops.length ? q(tops) : () => 0;
    rows.push({
      id: s.id, chunks: n,
      moundR: +(s.moundR ?? 0).toFixed(2),
      longestEdge: { min: qe(0), p25: qe(0.25), median: qe(0.5), p75: qe(0.75), p95: qe(0.95), max: qe(0.999) },
      over1_5: edges.filter((x) => x > 1.5).length,
      over2_0: edges.filter((x) => x > 2.0).length,
      topOverGround: { median: qt(0.5), p95: qt(0.95), max: qt(0.999) },
      aboveCrouchEye: tops.filter((x) => x > 1.02).length,
      aboveStandEye: tops.filter((x) => x > 1.62).length,
    });
  }
  return { level: w.level.id, rows };
});
console.log(JSON.stringify(out, null, 1));
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
