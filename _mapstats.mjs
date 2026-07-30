/** Snapshot: world stats, nav grid size/build, zone geometry, frame time. */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const URL = args.url ?? 'http://127.0.0.1:4220/';
const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
const logs = []; page.on('console', (m) => logs.push(m.text()));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const r = await page.evaluate(async () => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world'), ai = c.peek('ai'), m = c.peek('match'), render = c.peek('render');
  const g = ai?.grid;
  // frame time over 240 frames
  const t = [];
  await new Promise((res) => {
    let n = 0, last = performance.now();
    const tick = () => {
      const now = performance.now(); t.push(now - last); last = now;
      if (++n < 240) requestAnimationFrame(tick); else res();
    };
    requestAnimationFrame(tick);
  });
  t.sort((a, b) => a - b);
  const info = render?.renderer?.info;
  const zones = (m?.sites ?? []).map((s) => ({ id: s.id, name: s.name, x: +s.position.x.toFixed(2), z: +s.position.z.toFixed(2), stand: s.stand?.length ?? 0 }));
  const sep = [];
  for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
    sep.push(`${zones[i].id}-${zones[j].id} ${Math.hypot(zones[i].x - zones[j].x, zones[i].z - zones[j].z).toFixed(1)}m`);
  }
  const b = w.bounds;
  return {
    world: w.stats,
    drawCallsFrame: info?.render?.calls, trisFrame: info?.render?.triangles, programs: info?.programs?.length,
    frameMs: { p50: +t[120].toFixed(2), p95: +t[228].toFixed(2), mean: +(t.reduce((a, b2) => a + b2, 0) / t.length).toFixed(2) },
    nav: g ? { nx: g.nx, nz: g.nz, cells: g.nx * g.nz, walkable: g.walkableCount, interior: g.interiorCells, apron: g.apronCells, diag: g.diagCells, buildMs: +g.buildMs.toFixed(0), cell: g.cell, openCap: g.open.idx.length } : null,
    bounds: { min: [+b.min.x.toFixed(1), +b.min.z.toFixed(1)], max: [+b.max.x.toFixed(1), +b.max.z.toFixed(1)] },
    zones, sep,
    interiorVolumes: (w.interiorVolumes ?? []).map((v) => v.building),
    spawnA: m?.spawns?.attack?.length, spawnD: m?.spawns?.defend?.length,
  };
});
console.log(JSON.stringify(r, null, 1));
const keep = logs.filter((l) => /\[world\]|\[ai\]|\[airstrike\]|\[match\]|carve|interior/i.test(l));
console.log('--- logs ---\n' + keep.join('\n'));
if (errs.length) console.log('--- PAGEERRORS ---\n' + errs.join('\n'));
await browser.close();
process.exit(errs.length ? 1 : 0);
