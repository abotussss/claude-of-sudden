/**
 * THE RAMP, CELL BY CELL — nav floor, walkable flag and component id along each
 * EMP station's two ramps, against the analytic ground under them.
 *
 *   node _nframp.mjs [url]
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4617/?map=plains';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 480 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const out = await p.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world'), g = c.peek('ai').grid;
  g._label();
  const big = g.compSize.indexOf(g.biggestComponent);
  const at = (x, z) => {
    const ix = Math.round((x - g.minX) / g.cell), iz = Math.round((z - g.minZ) / g.cell);
    if (ix < 0 || iz < 0 || ix >= g.nx || iz >= g.nz) return null;
    const i = iz * g.nx + ix;
    return { walk: !!g.flags[i], y: +g.floor[i].toFixed(2), comp: g.comp[i], main: g.comp[i] === big };
  };
  const pads = w.layout.PADS.filter((q) => q.id === 'A' || q.id === 'B');
  const res = [];
  for (const pad of pads) {
    const len = Math.hypot(pad.x, pad.z) || 1;
    const yaw = Math.atan2(pad.x / len, pad.z / len);
    const cc = Math.cos(yaw), ss = Math.sin(yaw);
    const P = (lx, lz) => [pad.x + lx * cc + lz * ss, pad.z - lx * ss + lz * cc];
    const rows = [];
    // both ramps: local x = ±14.0, running along local z through the inset frame
    for (const sx of [1, -1]) {
      for (let s = -9; s <= 9; s += 0.8) {
        const [x, z] = P(sx * 14.0, s);
        const n = at(x, z);
        rows.push({ side: sx > 0 ? '+x' : '-x', lz: +s.toFixed(1), x: +x.toFixed(1), z: +z.toFixed(1),
          g: +w.level.groundY(x, z).toFixed(2), ...(n ?? { walk: null }) });
      }
    }
    res.push({ id: pad.id, y0: +w.level.groundY(pad.x, pad.z).toFixed(2), rows });
  }
  return res;
});

for (const s of out) {
  console.log(`\n── station ${s.id}   pad ground ${s.y0}`);
  console.log('  side    localZ       x       z  groundY   navFloor  walk  main  comp');
  for (const r of s.rows) {
    console.log(`   ${r.side}  ${String(r.lz).padStart(7)} ${String(r.x).padStart(7)} ${String(r.z).padStart(7)} ` +
      `${String(r.g).padStart(8)}   ${String(r.y ?? '-').padStart(8)}  ${String(r.walk).padStart(5)} ${String(r.main).padStart(5)}  ${r.comp ?? '-'}`);
  }
}
console.log('\npageerrors', errs.length, errs[0] ?? '');
await b.close();
