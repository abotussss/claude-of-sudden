/**
 * THE EIGHT VANTAGE NESTS: what does the height field say is under them, and is
 * a man standing on one on the grid at all?
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', (e) => console.log('  PAGEERROR', e.message));
await p.goto(`http://127.0.0.1:4384/?seed=${args.seed ?? 1}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log(await p.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const ai = ctx.peek('ai'), world = ctx.peek('world'), match = ctx.peek('match');
  const g = ai.grid;
  const out = [];
  out.push(`grid ${g.nx}x${g.nz} cell ${g.cell} comps ${g.components} climbEdges ${g.climbEdges} dropEdges ${g.dropEdges} escapeComps ${g.escapeComps}`);
  const caches = match.caches?.list ?? match.caches?.all ?? [];
  out.push(`caches ${caches.length}`);
  for (const c of caches) {
    if (c.kind !== 'vantage') continue;
    const x = c.position.x, y = c.position.y, z = c.position.z;
    const ix = g.cellX(x), iz = g.cellZ(z);
    const inside = g.inside(ix, iz);
    const i = inside ? g.index(ix, iz) : -1;
    const near3 = g.nearest(x, z, y, 3, 1.5);
    const near10 = g.nearest(x, z, y, 10, 1.5);
    out.push(`  ${String(c.id).padEnd(18)} y ${y.toFixed(2)}  gridFloor ${i >= 0 ? g.floor[i].toFixed(2) : 'n/a'} flag ${i >= 0 ? g.flags[i] : '-'} comp ${i >= 0 ? g.comp[i] : '-'}  nearest(3)=${near3} nearest(10)=${near10}  => ${near3 < 0 ? 'OFF-GRID' : 'on grid'}${near10 < 0 ? ' / NO REGAIN' : ''}`);
  }
  // how many walkable cells sit above 2.5 m at all, and how many of those escape
  let hi = 0, hiEsc = 0;
  for (let i = 0; i < g.flags.length; i++) {
    if (!g.flags[i] || g.floor[i] <= 2.5) continue;
    hi++;
    if (g.escape[g.comp[i]] >= 0) hiEsc++;
  }
  out.push(`walkable cells above 2.5 m: ${hi}, of which their component can drop to the ground: ${hiEsc}`);
  return out.join('\n');
}));
await b.close();
