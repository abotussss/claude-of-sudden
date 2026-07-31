/**
 * THE SAME MEASUREMENT, OVER N BOOTS — because zone B's centre wanders.
 *
 *   node _bruns.mjs [--url=…] [--n=8]
 *
 * One line per boot per state: the authored centre each zone RESOLVED to and
 * sitecheck's `coverAreaIn` there, intact and with all six `world.demolitions`
 * down. A distribution, not a single run.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4256/';
const N = Number(args.n ?? 8);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const EVAL = () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  const phys = e.ctx.peek('physics');
  const world = e.ctx.peek('world');
  const V3 = m.allZones[0].position.constructor;
  const WORLD = phys.MASK.WORLD;
  const S = world.layout.SCALE;
  const topAt = (wx, wz, top) => {
    const h = phys.raycast(wx, top, wz, 0, -1, 0, top + 8, WORLD);
    return h.hit ? h.point.y : -Infinity;
  };
  /** sitecheck samples on the LEVEL's axes, not the world's. Match it exactly. */
  const L2W = (lx, lz) => world.levelToWorld(lx, 0, lz, new V3());
  const coverArea = (C, lc, r0, r1) => {
    let hit = 0;
    const band = { low: 0, cover: 0, tall: 0, bld: 0, miss: 0 };
    for (let dz = -r1; dz <= r1 + 1e-6; dz += 0.5)
      for (let dx = -r1; dx <= r1 + 1e-6; dx += 0.5) {
        const d = Math.hypot(dx, dz);
        if (d < r0 || d > r1) continue;
        const w = L2W(lc.x + dx, lc.z + dz);
        const y = topAt(w.x, w.z, C.y + 6);
        if (!Number.isFinite(y)) { band.miss++; continue; }
        const rise = y - C.y;
        if (rise < 0.9) band.low++;
        else if (rise <= 2.8) { band.cover++; hit++; }
        else if (rise <= 4.2) band.tall++;
        else band.bld++;
      }
    return { m2: +(hit * 0.25).toFixed(1), band };
  };
  const pts = ai.cover?.points ?? [];
  const one = () =>
    m.allZones.map((z) => {
      const C = z.position;
      const lc = world.worldToLevel(C.x, C.y, C.z, new V3());
      let hi = 0;
      for (const p of pts) {
        if (Math.abs(p.y - C.y) > 3) continue;
        if (Math.hypot(p.x - C.x, p.z - C.z) > z.radius) continue;
        if (p.high) hi++;
      }
      return {
        id: z.id,
        ax: +(lc.x / S).toFixed(2),
        az: +(lc.z / S).toFixed(2),
        ...coverArea(C, lc, 0, z.radius),
        hi,
        stand: z.stand.length,
      };
    });
  const intact = one();
  world.demolishAll(true);
  const razed = one();
  world.demolishAll(false);
  return { intact, razed };
};

const fmt = (r) => r.filter((z)=>z.id==='A'||z.id==='B').map((z) => `${z.id}(${z.az})=${String(z.m2).padStart(5)}m² [lo ${String(z.band.low).padStart(3)} cov ${String(z.band.cover).padStart(3)} tall ${String(z.band.tall).padStart(3)} bld ${String(z.band.bld).padStart(3)}] ${String(z.hi).padStart(2)}cp/${z.stand}sp`).join('   ');

for (let i = 0; i < N; i++) {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
  const r = await page.evaluate(EVAL);
  console.log(`boot ${String(i + 1).padStart(2)}  INTACT  ${fmt(r.intact)}`);
  console.log(`         RAZED   ${fmt(r.razed)}${errs.length ? '  ERRORS ' + errs[0] : ''}`);
  await page.close();
}
await browser.close();
