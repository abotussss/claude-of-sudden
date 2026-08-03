/**
 * WHAT IS D'S CEILING? — how far could a man in D see if a given band of the
 * ruin were not there at all.
 *
 *   node _dceiling.mjs --url=http://127.0.0.1:4496/
 *
 * `_dsight.mjs` says D reaches 17.7 m against 19-22 at the four open zones. It
 * does not say whether 19-22 is even AVAILABLE inside a 30 x 45 m shell, and
 * that is the question that decides what to cut. So this re-casts every ray:
 * when it dies on something whose HIT POINT is inside `band` metres of D's
 * centre, the ray is restarted 5 cm past it, as if that mass were not there.
 * The reported reach is then the reach D would have with everything inside
 * `band` removed — the ceiling for any change that only touches that band.
 *
 * Run against A/C/E/B's real numbers from `_dsight.mjs`.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4496/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
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
await page.waitForTimeout(1200);

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ph = e.ctx.peek('physics');
  const g = e.ctx.peek('ai').grid;
  const MASK = ph.MASK.WORLD;
  const EYE = 1.62;
  const FAR = 40;
  const NAZ = 36;
  const z = m.allZones.find((q) => q.id === 'D');
  const C = z.position;
  const R = z.radius;
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
  const BANDS = [0, 7, 9, 11, 13, 14, 15, 16, 18, 20, 24];
  const sums = BANDS.map(() => 0);
  const o20 = BANDS.map(() => 0);
  let rays = 0;
  /* the radius-from-centre at which each ray actually dies, for a histogram */
  const hist = {};
  const map = {};
  for (const [x, y, zz] of pts) {
    for (let a = 0; a < NAZ; a++) {
      const th = (a / NAZ) * 6.283185;
      const dx = Math.cos(th);
      const dz = Math.sin(th);
      rays++;
      for (let b = 0; b < BANDS.length; b++) {
        const band = BANDS[b];
        let ox = x;
        let oz = zz;
        let travelled = 0;
        let guard = 0;
        for (;;) {
          const h = ph.raycast(ox, y, oz, dx, 0, dz, FAR - travelled, MASK);
          if (!h.hit) { travelled = FAR; break; }
          const px = ox + dx * h.distance;
          const pz = oz + dz * h.distance;
          const rC = Math.hypot(px - C.x, pz - C.z);
          travelled += h.distance;
          if (b === 0 && guard === 0) {
            const k = Math.min(30, Math.floor(rC / 2) * 2);
            hist[k] = (hist[k] || 0) + 1;
            /* …and where, in the cathedral's own plan: u across, v down the nave */
            const lu = Math.round(px);
            const lv = Math.round(pz + 1);
            if (Math.abs(lu) <= 20 && Math.abs(lv) <= 26) {
              const kk = `${lu},${lv}`;
              map[kk] = (map[kk] || 0) + 1;
            }
          }
          if (rC < band && travelled < FAR && guard++ < 24) {
            ox = px + dx * 0.06;
            oz = pz + dz * 0.06;
            travelled += 0.06;
            continue;
          }
          break;
        }
        if (travelled > FAR) travelled = FAR;
        sums[b] += travelled;
        if (travelled >= 20) o20[b]++;
      }
    }
  }
  return {
    n: pts.length,
    rays,
    hist,
    map,
    bands: BANDS.map((b, i) => ({
      band: b,
      reach: +(sums[i] / rays).toFixed(2),
      out20: +((100 * o20[i]) / rays).toFixed(1),
    })),
  };
});

console.log(`\n  D: ${out.n} walkable cells, ${out.rays} rays`);
console.log('  where the ray actually dies (radius from D centre):');
for (const k of Object.keys(out.hist).map(Number).sort((a, b) => a - b)) {
  console.log(`   r ${String(k).padStart(2)}-${k + 2} m   ${String(out.hist[k]).padStart(5)}  ${(100 * out.hist[k] / out.rays).toFixed(1)}%`);
}
console.log('\n  where rays die, in the cathedral plan (u across -20..20, v down the nave -26..26)');
{
  let mx = 0;
  for (const k in out.map) mx = Math.max(mx, out.map[k]);
  const gl = ' .:-=+*#%@';
  for (let v = -26; v <= 26; v++) {
    let row = '';
    for (let u = -20; u <= 20; u++) {
      const n = out.map[`${u},${v}`] || 0;
      row += n ? gl[Math.min(9, 1 + Math.floor((n / mx) * 8.99))] : ' ';
    }
    console.log(`   ${String(v).padStart(3)} |${row}|`);
  }
}
console.log('\n  reach if everything inside <band> m of D centre were gone:');
console.log('   band     reach    out>20m');
for (const b of out.bands) {
  console.log(`   ${String(b.band).padStart(4)}m  ${String(b.reach).padStart(7)}m  ${String(b.out20).padStart(6)}%`);
}
console.log('\n  pageErrors', errs.length ? errs.slice(0, 4) : 'none');
await browser.close();
