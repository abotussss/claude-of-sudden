/**
 * WHAT DID THE HEIGHT FIELD SEE WHEN IT WAS BAKED?
 *
 *   node _cathgrid.mjs [--url=…]
 *
 * `ai._buildNav` runs `grid.build()` BEFORE `_bakeCover`, and `_bakeCover` is
 * the first thing on this map that ever calls `cathedral.setRazed` — so the one
 * bake the whole match navigates on saw BOTH `cath:shell` AND `cath:ruin` solid.
 * That is the single fact every extra tonne of rubble in the ruin has to be
 * designed against, so it is measured rather than reasoned about: the eight
 * fallen-dome blocks stand on bare nave floor that the shell does not touch, so
 * if their cells are blocked in the baked grid, the ruin was solid when it ran.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4270/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 480000 });

const out = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const ai = e.ctx.peek('ai');
  const ph = e.ctx.peek('physics');
  const g = ai.grid;
  const k = w.cathedral;
  const vol = w.interiorVolumes.find((v) => v.building === k.id);
  const c = vol.c, s = vol.s;
  const toWorld = (u, v) => [vol.cx + u * c + v * s, vol.cz - u * s + v * c];
  const at = (u, v) => {
    const [x, z] = toWorld(u, v);
    const i = g.index(g.cellX(x), g.cellZ(z));
    const ray = ph.raycast(x, 30, z, 0, -1, 0, 36, ph.MASK.WORLD);
    return {
      uv: `${u},${v}`,
      flag: g.flags[i],
      floor: +g.floor[i].toFixed(2),
      liveTop: ray.hit ? +ray.point.y.toFixed(2) : null,
    };
  };
  const rows = [];
  // the eight fallen-dome blocks sit on a 5.4-7.4 m ring of bare nave floor
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 6.283;
    rows.push(at(+(Math.cos(a) * 6.4).toFixed(1), +(Math.sin(a) * 6.4).toFixed(1)));
  }
  // controls: open nave, open aisle, on a pier, in a portal
  for (const [u, v] of [[0, -10], [0, 12], [11.5, -10], [8.6, -9], [0, -22.1], [14.6, 0], [-11, -18]]) {
    rows.push(at(u, v));
  }
  // and the floor histogram of the whole footprint, as the grid holds it
  const hist = {};
  let n = 0;
  for (let iz = 0; iz < g.nz; iz++) {
    for (let ix = 0; ix < g.nx; ix++) {
      const x = g.worldX(ix), z = g.worldZ(iz);
      const dx = x - vol.cx, dz = z - vol.cz;
      const lu = dx * c - dz * s, lv = dx * s + dz * c;
      if (Math.abs(lu) > k.hw || Math.abs(lv) > k.hd) continue;
      const i = g.index(ix, iz);
      n++;
      const key = g.flags[i] === 0 ? 'blocked' : `floor ${(Math.round(g.floor[i] * 2) / 2).toFixed(1)}`;
      hist[key] = (hist[key] ?? 0) + 1;
    }
  }
  return { rows, n, hist, floorY: k.floorY, probeY: k.probeY };
});
console.log('floorY', out.floorY, 'probeY', out.probeY, '— carve rejects any surface above floorY+0.9 =', out.floorY + 0.9);
console.table(out.rows);
console.log('footprint cells', out.n, out.hist);
await b.close();
