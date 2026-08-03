/**
 * CAN YOU SEE OUT OF D? — 「瓦礫による視認性の悪さが問題 視認性を改善しろ」
 *
 *   node _dsight.mjs [--url=…] [--seed=N]
 *
 * `_dbury.mjs` measures whether a man can STAND in D. Three passes of raising
 * that number did not answer the complaint, because the complaint is not about
 * standing — it is about SEEING. A capture point you can walk around and cannot
 * shoot out of is worse than a small one.
 *
 * So this measures the thing that was never measured: from a standing eye at
 * every walkable position inside the circle, on the razed map, how far can you
 * see, and how much of your own point can you see across?
 *
 *   reach     mean metres to the first solid, over 36 azimuths per eye. The
 *             single number for "am I in a canyon".
 *   out8      the fraction of those rays that clear the 8 m circle at all —
 *             i.e. how many bearings you can shoot an APPROACHING man on.
 *   out20     the fraction that reach 20 m: the bearings you hold the map from.
 *   blind     the fraction stopped inside 4 m — a face full of rubble.
 *   mutual    of all pairs of walkable positions inside the circle, the share
 *             with a clear eye-to-eye line. "Can the two men holding this point
 *             see each other, and can the man who walks in see them."
 *
 * A, B, C and E are the standard: they are the four zones the player is
 * implicitly comparing D against when he says D is unfightable.
 *
 * The eye is 1.62 m, which is where `STANCE.stand` puts it, and that is the
 * whole argument for the fix: mass under about 1.5 m is cover you fire OVER,
 * mass over it is a wall you cannot see past.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4480/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL + (args.seed ? `?seed=${args.seed}` : ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

await page.evaluate(() => (window.__ENGINE__.time.scale = 10));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._checkWinConditions = () => {};
  m.roundClock = 1e6;
  m.score[0] = 999;
});
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').sites.some((z)=>z.id==='D')", null, { timeout: 300000 });
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await page.waitForTimeout(1500);

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ph = e.ctx.peek('physics');
  const g = e.ctx.peek('ai').grid;
  const MASK = ph.MASK.WORLD;
  const EYE = 1.62;
  const FAR = 40;
  const NAZ = 36;
  const rows = [];
  for (const z of m.allZones) {
    const C = z.position;
    const R = z.radius;
    /* every walkable cell inside the circle, with the grid's own floor */
    const pts = [];
    for (let iz = g.cellZ(C.z - R); iz <= g.cellZ(C.z + R); iz++) {
      for (let ix = g.cellX(C.x - R); ix <= g.cellX(C.x + R); ix++) {
        const x = g.worldX(ix);
        const zz = g.worldZ(iz);
        if (Math.hypot(x - C.x, zz - C.z) > R) continue;
        const i = g.index(ix, iz);
        if (!g.flags[i]) continue;
        pts.push([x, g.floor[i] + EYE, zz]);
      }
    }
    let rays = 0;
    let sum = 0;
    let out8 = 0;
    let out20 = 0;
    let blind = 0;
    const perEye = [];
    for (const [x, y, zz] of pts) {
      let s = 0;
      for (let a = 0; a < NAZ; a++) {
        const th = (a / NAZ) * 6.283185;
        const dx = Math.cos(th);
        const dz = Math.sin(th);
        const h = ph.raycast(x, y, zz, dx, 0, dz, FAR, MASK);
        const d = h.hit ? h.distance : FAR;
        rays++;
        sum += d;
        s += d;
        if (d >= 8) out8++;
        if (d >= 20) out20++;
        if (d < 4) blind++;
      }
      perEye.push(s / NAZ);
    }
    /* mutual visibility, on a capped sample so the pair count stays sane */
    const step = Math.max(1, Math.ceil(pts.length / 46));
    const samp = pts.filter((_, i) => i % step === 0);
    let pairs = 0;
    let seen = 0;
    for (let i = 0; i < samp.length; i++) {
      for (let j = i + 1; j < samp.length; j++) {
        const a = samp[i];
        const b = samp[j];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const dz = b[2] - a[2];
        const L = Math.hypot(dx, dy, dz);
        if (L < 0.1) continue;
        pairs++;
        const h = ph.raycast(a[0], a[1], a[2], dx / L, dy / L, dz / L, L - 0.05, MASK);
        if (!h.hit) seen++;
      }
    }
    perEye.sort((p, q) => p - q);
    rows.push({
      id: z.id,
      n: pts.length,
      reach: +(sum / Math.max(1, rays)).toFixed(2),
      worstEye: +(perEye[0] ?? 0).toFixed(2),
      medEye: +(perEye[perEye.length >> 1] ?? 0).toFixed(2),
      out8: +((100 * out8) / Math.max(1, rays)).toFixed(1),
      out20: +((100 * out20) / Math.max(1, rays)).toFixed(1),
      blind: +((100 * blind) / Math.max(1, rays)).toFixed(1),
      mutual: +((100 * seen) / Math.max(1, pairs)).toFixed(1),
    });
  }
  return rows;
});

console.log('\n  eye 1.62 m at every walkable cell in the circle, 36 azimuths, 40 m cap');
console.log('  zone  cells   reach   medEye  worstEye   out>8m   out>20m   blind<4m   mutual');
for (const r of out) {
  console.log(
    `   ${r.id.padEnd(4)} ${String(r.n).padStart(5)}  ${String(r.reach).padStart(6)}m ` +
      `${String(r.medEye).padStart(7)}m ${String(r.worstEye).padStart(8)}m ` +
      `${String(r.out8).padStart(7)}% ${String(r.out20).padStart(8)}% ` +
      `${String(r.blind).padStart(9)}% ${String(r.mutual).padStart(7)}%`
  );
}
console.log('\n  pageErrors', errs.length ? errs.slice(0, 4) : 'none');
await browser.close();
