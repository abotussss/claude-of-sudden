/** Why does the tread sweep only open 15 steps? Count the rejections. */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', (e) => console.log('  PAGEERROR', e.message));
await p.goto(args.url ?? 'http://127.0.0.1:4355/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const r = await p.evaluate((BAND) => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  const g = ai.grid;
  const phys = g.physics, MASK = phys.MASK.WORLD;
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1], FWD = [0, 2, 4, 5];
  const R = { candidates: 0, cornerRule: 0, noHit: 0, outOfBand: 0, tooBig: 0, headroom: 0, endGap: 0, ok: 0 };
  const samples = [];
  for (let iz = 0; iz < g.nz; iz++) {
    for (let ix = 0; ix < g.nx; ix++) {
      const i = g.index(ix, iz);
      if (!g.flags[i]) continue;
      for (let k = 0; k < 4; k++) {
        const d = FWD[k];
        const jx = ix + DX[d], jz = iz + DZ[d];
        if (!g.walkable(jx, jz)) continue;
        const j = g.index(jx, jz);
        const fi = g.floor[i], fj = g.floor[j];
        const rise = Math.abs(fj - fi);
        if (rise <= g.maxStep || rise > BAND) continue;
        R.candidates++;
        if (!g._canStep(i, ix, iz, d)) { R.cornerRule++; continue; }
        const x0 = g.worldX(ix), z0 = g.worldZ(iz), x1 = g.worldX(jx), z1 = g.worldZ(jz);
        const lo = Math.min(fi, fj), hi = Math.max(fi, fj);
        const top = hi + 0.75, len = (hi - lo) + 1.3;
        let prev = fi, fail = '';
        const ys = [];
        for (let s = 1; s <= 3 && !fail; s++) {
          const t = s * 0.25;
          const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
          const down = phys.raycast(x, top, z, 0, -1, 0, len, MASK);
          if (!down.hit) { fail = 'noHit'; break; }
          const y = down.point.y;
          ys.push(+(y - lo).toFixed(2));
          if (y < lo - 0.08 || y > hi + 0.08) { fail = 'outOfBand'; break; }
          if (Math.abs(y - prev) > 0.40) { fail = 'tooBig'; break; }
          if (phys.raycastAny(x, y + 0.22, z, 0, 1, 0, g.crouchHeight, MASK)) { fail = 'headroom'; break; }
          prev = y;
        }
        if (!fail && Math.abs(fj - prev) > 0.40) fail = 'endGap';
        if (fail) R[fail]++; else R.ok++;
        if (samples.length < 25 && rise < 0.85) {
          samples.push({ ix, iz, d, rise: +rise.toFixed(2), fi: +fi.toFixed(2), fj: +fj.toFixed(2), ys, fail: fail || 'ok', indoor: g.indoor[i] });
        }
      }
    }
  }
  return { R, samples };
}, +(args.band ?? 0.95));
console.log(JSON.stringify(r.R));
for (const s of r.samples) console.log(JSON.stringify(s));
await b.close();
