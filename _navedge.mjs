import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4277/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 600 } });
await p.goto(`${URL}?capture=1&seed=11`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const r = await p.evaluate(() => {
  const e = window.__ENGINE__, ai = e.ctx.peek('ai'), w = e.ctx.peek('world');
  const g = ai.grid, THREE_V = e.ctx.peek('match').spawns.attack[0].position.constructor;
  const rows = [];
  for (const lx of [-6, 0, 6]) {
    for (const side of [1, -1]) {
      let edge = null;
      for (let lz = 55; lz <= 82; lz += 0.2) {
        const q = w.levelToWorld(lx * 1.5, 0, side * lz * 1.5, new THREE_V());
        const y = ai.groundAt?.(q.x, q.z, 4);
        q.y = Number.isFinite(y) ? y : 0;
        const ci = g.nearest(q.x, q.z, q.y, 0.6, 1.2);
        if (ci >= 0) edge = lz; else if (edge != null && lz > edge + 1.5) break;
      }
      rows.push({ lx, side: side > 0 ? 'attack(+z)' : 'defend(-z)', lastWalkable: +edge.toFixed(1) });
    }
  }
  return rows;
});
console.log('  authored level |z| at which the nav grid runs out, per column:');
for (const x of r) console.log(`   x ${String(x.lx).padStart(3)}  ${x.side}   last walkable |z| = ${x.lastWalkable}`);
await b.close();
