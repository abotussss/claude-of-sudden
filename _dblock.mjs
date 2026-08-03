/**
 * WHAT IS STOPPING THE RAY, AND HOW FAR OUT IS IT — D only.
 *
 *   node _dblock.mjs --url=http://127.0.0.1:4496/
 *
 * `_dsight.mjs` says D is the shortest-sighted zone on the map. It does not say
 * WHICH mass ends the ray. This casts from a 1.62 m eye at D's centre and at
 * four rim positions, 72 azimuths, and reports for every ray the distance, the
 * radius of the HIT POINT from D's centre, and the height of the hit above the
 * local ground — so "the rim ring at 10-13 m" and "the shell wall at 20 m" are
 * told apart instead of averaged together.
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
await page.waitForTimeout(1200);

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ph = e.ctx.peek('physics');
  const g = e.ctx.peek('ai').grid;
  const MASK = ph.MASK.WORLD;
  const EYE = 1.62;
  const FAR = 40;
  const NAZ = 72;
  const z = m.allZones.find((q) => q.id === 'D');
  const C = z.position;
  const floorAt = (x, zz) => {
    const i = g.index(g.cellX(x), g.cellZ(zz));
    return g.flags[i] ? g.floor[i] : null;
  };
  const eyes = [
    ['centre', C.x, C.z],
    ['N', C.x, C.z - 6.5],
    ['S', C.x, C.z + 6.5],
    ['W', C.x - 6.5, C.z],
    ['E', C.x + 6.5, C.z],
  ];
  const res = [];
  const hist = {};
  for (const [tag, x, zz] of eyes) {
    const fy = floorAt(x, zz);
    if (fy === null) { res.push({ tag, err: 'not walkable' }); continue; }
    const y = fy + EYE;
    const rays = [];
    for (let a = 0; a < NAZ; a++) {
      const th = (a / NAZ) * 6.283185;
      const dx = Math.cos(th);
      const dz = Math.sin(th);
      const h = ph.raycast(x, y, zz, dx, 0, dz, FAR, MASK);
      const d = h.hit ? h.distance : FAR;
      const px = x + dx * d;
      const pz = zz + dz * d;
      const rC = Math.hypot(px - C.x, pz - C.z);
      const gyi = g.index(g.cellX(px), g.cellZ(pz));
      const gy = g.flags[gyi] ? g.floor[gyi] : null;
      rays.push({
        deg: Math.round((th * 180) / Math.PI),
        d: +d.toFixed(2),
        rC: +rC.toFixed(1),
        hy: h.hit ? +(h.point.y).toFixed(2) : null,
        over: h.hit && gy !== null ? +(h.point.y - gy).toFixed(2) : null,
        obj: h.object?.name || h.object?.material?.name || '?',
      });
      if (h.hit && d < 30) {
        const b = Math.min(30, Math.floor(rC / 2) * 2);
        hist[b] = (hist[b] || 0) + 1;
      }
    }
    const mean = rays.reduce((s, r) => s + r.d, 0) / rays.length;
    res.push({ tag, mean: +mean.toFixed(2), rays });
  }
  return { C: { x: +C.x.toFixed(2), z: +C.z.toFixed(2) }, R: z.radius, res, hist };
});

console.log('\n  D centre', out.C, 'radius', out.R);
console.log('  first-hit radius-from-D-centre histogram (all eyes, hits under 30 m):');
for (const k of Object.keys(out.hist).map(Number).sort((a, b) => a - b)) {
  console.log(`   r ${String(k).padStart(2)}-${k + 2} m  ${'#'.repeat(Math.round(out.hist[k] / 2))} ${out.hist[k]}`);
}
for (const r of out.res) {
  if (r.err) { console.log(`\n  ${r.tag}: ${r.err}`); continue; }
  console.log(`\n  eye ${r.tag}   mean ${r.mean} m`);
  const short = r.rays.filter((q) => q.d < 14).sort((a, b) => a.d - b.d);
  console.log(`   rays under 14 m: ${short.length}/72`);
  for (const q of short.slice(0, 22)) {
    console.log(`     ${String(q.deg).padStart(3)}°  d ${String(q.d).padStart(6)}  hitR ${String(q.rC).padStart(5)}  y ${String(q.hy).padStart(6)}  over-ground ${String(q.over).padStart(6)}  ${q.obj}`);
  }
}
console.log('\n  pageErrors', errs.length ? errs.slice(0, 4) : 'none');
await browser.close();
