/**
 * WHERE IS THE TANK, RELATIVE TO WHERE THE FIGHT IS?
 * Dumps zones, spawns, the cathedral and both baked tank routes in WORLD metres,
 * plus the level->world transform, so the authored polyline can be re-aimed.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4272/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const r = await page.evaluate(() => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), w = e.ctx.peek('world'), phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const f = (n) => +n.toFixed(1);
  const out = { levelYaw: w.levelYaw };
  out.zones = (m.allZones ?? m.sites ?? []).map((z) => ({ id: z.id, w: [f(z.position.x), f(z.position.y), f(z.position.z)] }));
  out.spawns = {};
  for (const k of ['attack', 'defend']) out.spawns[k] = (m.spawns?.[k] ?? []).map((s) => [f(s.position.x), f(s.position.z)]);
  out.cathedral = w.cathedral ? { pos: [f(w.cathedral.position?.x ?? 0), f(w.cathedral.position?.z ?? 0)], keys: Object.keys(w.cathedral) } : null;
  out.tanks = (m.tank?.tanks ?? []).map((t) => ({
    id: t.id,
    samples: Array.from({ length: t.path.n }, (_, i) => [f(t.path.X[i]), f(t.path.Y[i]), f(t.path.Z[i])]).filter((_, i) => i % 6 === 0 || i === t.path.n - 1),
  }));
  // level->world for a grid of authored plan points, so a new polyline can be aimed
  out.probe = [];
  for (let lx = -30; lx <= 30; lx += 10) {
    for (let lz = -60; lz <= 60; lz += 20) {
      const p = w.levelToWorld(lx, 0, lz, new V3());
      out.probe.push([lx, lz, f(p.x), f(p.z)]);
    }
  }
  // world bounds of walkable ground, roughly
  const ai = e.ctx.peek('ai');
  out.grid = ai?.grid ? { minX: f(ai.grid.minX ?? 0), minZ: f(ai.grid.minZ ?? 0), w: ai.grid.w, h: ai.grid.h, cell: ai.grid.cell } : null;
  return out;
});
console.log('levelYaw', r.levelYaw);
console.log('ZONES', JSON.stringify(r.zones));
console.log('SPAWNS attack', JSON.stringify(r.spawns.attack));
console.log('SPAWNS defend', JSON.stringify(r.spawns.defend));
console.log('CATHEDRAL', JSON.stringify(r.cathedral));
console.log('GRID', JSON.stringify(r.grid));
for (const t of r.tanks) console.log('ROUTE', t.id, JSON.stringify(t.samples));
console.log('level(x,z) -> world(x,z):');
for (const p of r.probe) console.log(`   L(${p[0]},${p[1]}) -> W(${p[2]},${p[3]})`);
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
