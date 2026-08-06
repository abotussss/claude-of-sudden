/**
 * WHERE THE PLAIN'S BUILT WORKS ACTUALLY ARE, asked of `world.demolitions`
 * rather than of the source — the records are published after `A.finalize` and
 * carry world-space centres, so this is the same thing `match` reads.
 *
 *   node _works.mjs http://127.0.0.1:4576/?map=plains
 */
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 560 } });
await p.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const out = await p.evaluate(() => {
  const w = window.__ENGINE__.ctx.peek('world');
  const ph = window.__ENGINE__.ctx.peek('physics');
  const demos = (w.demolitions ?? []).map((d) => ({
    id: d.id, name: d.name, keys: Object.keys(d),
    c: d.centre ? [+d.centre.x.toFixed(1), +d.centre.y.toFixed(1), +d.centre.z.toFixed(1)] : null,
    pos: d.position ? [+d.position.x.toFixed(1), +d.position.z.toFixed(1)] : null,
    reach: +(d.reach ?? d.radius ?? 0).toFixed(1),
  }));
  // how much structure stands over each metre of a candidate line
  const scan = (x0, z0, x1, z1, n) => {
    const r = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      const g = ph.groundHeight(x, z, 60);
      r.push(`${x.toFixed(0)},${z.toFixed(0)}: deck ${w.groundHeight(x, z).toFixed(1)} solid ${Number.isFinite(g) ? g.toFixed(1) : 'none'}`);
    }
    return r;
  };
  const lines = {};
  for (const [k, v] of Object.entries({
    'CENTRE z26': [-46, 26, 46, 26],
    'CENTRE z40': [-46, 40, 46, 40],
    'CENTRE z48': [-52, 48, 52, 48],
  })) lines[k] = scan(v[0], v[1], v[2], v[3], 12);
  return { demos, lines };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
