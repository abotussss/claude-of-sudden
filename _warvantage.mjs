/**
 * WHERE CAN YOU ACTUALLY SEE THE AMBIENT WAR FROM?
 *
 *   node _warvantage.mjs [--url=…]
 *
 * The first set of frames from `_warshots.mjs` were taken from the obvious
 * places — the centre point, the tower — and the obvious places on NACHTFELD
 * are behind the fortress and inside the tower. This scans real standing
 * positions instead: a coarse grid of the walkable disc, keeping the ones with
 * an unobstructed chest-height ray to BOTH ends of an engagement at a range
 * where the honesty ramp is at full strength.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
await p.goto(args.url ?? 'http://127.0.0.1:4609/?map=plains', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const out = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const phys = e.ctx.peek('physics');
  const w = e.ctx.peek('match').warfield;
  const world = e.ctx.peek('world');
  const gy = (x, z) => { const h = phys.groundHeight(x, z, 400); return Number.isFinite(h) ? h : world.groundHeight(x, z); };
  const clear = (x0, y0, z0, x1, y1, z1) => {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const d = Math.hypot(dx, dy, dz);
    const h = phys.raycast(x0, y0, z0, dx / d, dy / d, dz / d, d - 2, phys.MASK.WORLD);
    return !h.hit;
  };
  const res = [];
  for (const f of w.fights) {
    let best = null;
    for (let x = -168; x <= 168; x += 6) for (let z = -168; z <= 168; z += 6) {
      if (Math.hypot(x, z) > 170) continue;
      const da = Math.hypot(x - f.ax, z - f.az), db = Math.hypot(x - f.bx, z - f.bz);
      const near = Math.min(da, db);
      if (near < 110 || near > 210) continue;
      const y = gy(x, z) + 1.62;
      if (!Number.isFinite(y)) continue;
      if (!clear(x, y, z, f.ax, f.ay, f.az)) continue;
      if (!clear(x, y, z, f.bx, f.by, f.bz)) continue;
      // prefer the mid of the two ranges and a position not on the very edge
      const score = -Math.abs(near - 150) - Math.hypot(x, z) * 0.05;
      if (!best || score > best.score) best = { x, z, near: +near.toFixed(0), score };
    }
    res.push({ id: f.id, kind: f.kind, mid: [((f.ax + f.bx) / 2) | 0, ((f.az + f.bz) / 2) | 0, ((f.ay + f.by) / 2) | 0], best });
  }
  return res;
});
for (const r of out) {
  console.log(`${r.id.padEnd(11)} ${r.kind.padEnd(5)} mid(${r.mid[0]},${r.mid[2]}m,${r.mid[1]})  ` +
    (r.best ? `stand at (${r.best.x}, ${r.best.z}) — ${r.best.near} m, both ends visible` : 'NO CLEAR VANTAGE at 110-210 m'));
}
await b.close();
