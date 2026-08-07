/**
 * WHAT IS STANDING ON NOTHING OVER THE CONTROL TOWER, AND WHAT IS STRANDED?
 *
 *   node _nfroof.mjs [--url=…]
 *
 * `_floatcheck --region=all --down=none` reports two masses at y 34-36 owned by
 * `scope_shell:NF-TOWER_metal`. This asks the two questions that tell a bug from
 * a legitimate cantilever, and it asks them of the PHYSICS rather than of a
 * picture:
 *
 *   1. Drop a MASK.WORLD ray from the sky over every authored point on the cab
 *      roof and print what it hits, and at what height. A prop standing on a
 *      LAYER.CLIP slab has nothing at all under it in that mask, and the mask is
 *      what `NavGrid` samples the floor with.
 *   2. Print every stranded nav component with its extent and floor, down to one
 *      cell, so an island can be identified rather than guessed at.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4600/?map=plains';
const MIN = Number(args.min ?? 1);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const r = await p.evaluate((MIN) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const ai = e.ctx.peek('ai');
  const g = ai.grid;

  const drop = (x, z, mask, from = 70) => {
    const h = ph.raycast(x, from, z, 0, -1, 0, 130, mask);
    return h && h.hit ? { y: +h.point.y.toFixed(2), name: h.object?.name ?? '(static batch)' } : null;
  };

  const T = { x: 0, z: -32 };
  const pts = [
    ['sat_dish A', T.x + 4.4, T.z - 2.2],
    ['sat_dish B', T.x - 3.6, T.z + 3.0],
    ['roof_vent', T.x - 4.4, T.z - 3.4],
    ['water_tank', T.x + 2.0, T.z + 4.2],
    ['cab centre', T.x, T.z],
    ['cab edge +x', T.x + 7.4, T.z],
    ['cab edge +z', T.x, T.z + 7.4],
    ['ladder', T.x + 0.95, T.z],
    ['shed centre', -13, 60],
    ['shed door', -13 + 5.5 * Math.cos(0.35), 60 - 5.5 * Math.sin(0.35)],
    ['shed corner', -13 + 3.6 * Math.cos(0.35) + 1.6 * Math.sin(0.35), 60 - 3.6 * Math.sin(0.35) + 1.6 * Math.cos(0.35)],
    ['plinth E', 30.9, 48],
    ['plinth W', -30.9, 48],
  ];
  const rays = pts.map(([id, x, z]) => ({
    id, x, z, world: drop(x, z, ph.MASK.WORLD), character: drop(x, z, ph.MASK.CHARACTER),
    navFloor: (() => { const i = g.index(g.cellX(x), g.cellZ(z)); if (i < 0 || i >= g.floor.length) return null; const big = g.compSize.indexOf(g.biggestComponent); return `${g.floor[i].toFixed(2)} flag=${g.flags[i]} ${g.comp[i] === big ? 'MAIN' : 'comp' + g.comp[i]} indoor=${g.indoor[i]}`; })(),
  }));

  g._label();
  const bigLbl = g.compSize.indexOf(g.biggestComponent);
  const big = g.compSize.indexOf(g.biggestComponent);
  const by = new Map();
  let walk = 0;
  for (let i = 0; i < g.flags.length; i++) {
    if (!g.flags[i]) continue;
    walk++;
    const c = g.comp[i];
    if (c === big) continue;
    const cx = i % g.nx, cz = (i / g.nx) | 0;
    const x = g.minX + cx * g.cell, z = g.minZ + cz * g.cell, y = g.floor[i];
    let q = by.get(c);
    if (!q) by.set(c, (q = { n: 0, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, y0: 1e9, y1: -1e9 }));
    q.n++;
    if (x < q.x0) q.x0 = x; if (x > q.x1) q.x1 = x;
    if (z < q.z0) q.z0 = z; if (z > q.z1) q.z1 = z;
    if (y < q.y0) q.y0 = y; if (y > q.y1) q.y1 = y;
  }
  const out = [...by.values()].filter((q) => q.n >= MIN).sort((a, b) => b.n - a.n).slice(0, 30);
  // …and a histogram of every stranded cell by floor height, so the tail is not
  // 170 anonymous components.
  const hist = new Map();
  for (const q of by.values()) {
    const k = Math.round(q.y0);
    const h = hist.get(k) ?? { cells: 0, comps: 0 };
    h.cells += q.n; h.comps++;
    hist.set(k, h);
  }
  return {
    rays,
    walk, big: g.biggestComponent, comps: g.components, stranded: walk - g.biggestComponent,
    out, hist: [...hist.entries()].sort((a, b) => a[0] - b[0]),
  };
}, MIN);

console.log(`\n  ${URL}`);
console.log('\n  MASK.WORLD / MASK.CHARACTER rays dropped from y 70:');
console.log('    point           at (x,z)        WORLD hit             CHARACTER hit          nav floor');
for (const q of r.rays) {
  console.log(
    `    ${q.id.padEnd(14)} ${(q.x.toFixed(1) + ',' + q.z.toFixed(1)).padEnd(14)} ` +
      `${(q.world ? q.world.y + ' ' + q.world.name : 'NOTHING').padEnd(22)}` +
      `${(q.character ? q.character.y + ' ' + q.character.name : 'NOTHING').padEnd(23)}${q.navFloor}`
  );
}
console.log(`\n  nav: walkable ${r.walk}, biggest ${r.big}, stranded ${r.stranded} in ${r.comps} components`);
console.log('      cells      x range          z range          floor y');
for (const e of r.out) {
  console.log(
    `    ${String(e.n).padStart(7)}   ${e.x0.toFixed(0).padStart(5)}..${e.x1.toFixed(0).padEnd(5)}   ` +
      `${e.z0.toFixed(0).padStart(5)}..${e.z1.toFixed(0).padEnd(5)}   ${e.y0.toFixed(1)}..${e.y1.toFixed(1)}`
  );
}
console.log('\n  stranded cells by floor height:');
for (const [y, h] of r.hist) console.log(`    y ~${String(y).padStart(3)}   ${String(h.cells).padStart(6)} cells in ${h.comps} components`);
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 4).join(' | ')}` : '\n0 pageerrors');
await b.close();
