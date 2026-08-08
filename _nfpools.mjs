/**
 * ════════════════════════════════════════════════════════════════════════════
 * HOW MUCH OF NACHTFELD IS ACTUALLY DARK?
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfpools.mjs [--url=…] [--step=8]
 *
 * 「その燃えている光で夜なのにその周りは明るい、橙色に明るい雰囲気をそこに作る でも周りは
 *   夜の闇にして」 is a statement about the DISTRIBUTION of light over the map, and
 * a screenshot from one spot cannot confirm or refute it. Standing somewhere
 * dark and photographing it proves only that one dark place exists.
 *
 * So this walks a grid over the whole play box, computes the fire irradiance at
 * standing height from the five point lights — the real THREE windowed inverse
 * square, `(1 - (d/distance)^4)^2 / d^2`, not an approximation of it — and
 * reports the histogram against the moon's own directional intensity in the
 * same units. What comes out is the answer to "is there an everywhere else":
 *
 *   under 0.5x the moon   night. This is the 闇 the pools are bright against.
 *   0.5 - 2x              a warm edge; you can tell which way the fire is.
 *   2 - 8x                inside a pool. Orange, directional, fightable.
 *   over 8x               the near field of a burning ridge.
 *
 * Only cells the player can actually stand on are counted (`world.isOpen`), so
 * a hundred square metres of mountain face does not get to vote on how dark the
 * plain is.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4603/?map=plains&capture=1';
const STEP = Number(args.step ?? 8);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await p.evaluate((STEP) => {
  const e = window.__ENGINE__, w = e.ctx.peek('world'), sky = e.ctx.peek('sky');
  const lvl = w.level, fires = lvl.fires ?? [];
  const moon = sky.moonLight.intensity;
  const H = lvl.boundsHalf;
  const bands = [0, 0, 0, 0];
  let n = 0, sum = 0, min = Infinity, max = 0;
  let darkest = null, brightest = null;
  for (let z = -H; z <= H; z += STEP) {
    for (let x = -H; x <= H; x += STEP) {
      if (Math.hypot(x, z) > 176) continue;          // past the foot of the rim
      if (!lvl.isOpen(x, z, 0.6)) continue;          // not standing ground
      const y = lvl.groundY(x, z) + 1.6;
      let fire = 0;
      for (const f of fires) {
        const L = f.light;
        const d = Math.hypot(L.position.x - x, L.position.y - y, L.position.z - z);
        if (L.distance > 0 && d >= L.distance) continue;
        const win = L.distance > 0 ? Math.max(0, 1 - (d / L.distance) ** 4) ** 2 : 1;
        // `intensity` is live and flickering; use the site's own base so the
        // histogram is a property of the map rather than of the shutter moment.
        fire += ((f.baseIntensity ?? L.intensity) * win) / Math.max(d * d, 1);
      }
      const r = fire / moon;
      n++; sum += r;
      if (r < min) { min = r; darkest = [x, z, +r.toFixed(2)]; }
      if (r > max) { max = r; brightest = [x, z, +r.toFixed(2)]; }
      bands[r < 0.5 ? 0 : r < 2 ? 1 : r < 8 ? 2 : 3]++;
    }
  }
  return { n, moon: +moon.toFixed(4), mean: +(sum / n).toFixed(2), bands, darkest, brightest,
    fires: fires.map((f) => ({ id: f.id, base: f.baseIntensity, dist: f.light.distance })) };
}, STEP);

const pct = (k) => `${((k / out.n) * 100).toFixed(1)}%`;
console.log(`\n  ${out.n} standing cells at ${STEP} m, moon = ${out.moon}\n`);
console.log(`    night      (< 0.5x moon)   ${String(out.bands[0]).padStart(5)}   ${pct(out.bands[0])}`);
console.log(`    warm edge  (0.5 - 2x)      ${String(out.bands[1]).padStart(5)}   ${pct(out.bands[1])}`);
console.log(`    in a pool  (2 - 8x)        ${String(out.bands[2]).padStart(5)}   ${pct(out.bands[2])}`);
console.log(`    near field (> 8x)          ${String(out.bands[3]).padStart(5)}   ${pct(out.bands[3])}`);
console.log(`\n    mean ${out.mean}x   darkest ${JSON.stringify(out.darkest)}   brightest ${JSON.stringify(out.brightest)}`);
console.log(`    fires: ${out.fires.map((f) => `${f.id} ${f.base}cd/${f.dist}m`).join('  ')}`);
console.log(errs.length ? `\nPAGEERRORS(${errs.length}) ${errs[0]}` : '\n0 pageerrors');
await b.close();
