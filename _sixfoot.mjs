/**
 * IS THE FOOT OF EACH FLIGHT SOMEWHERE A MAN CAN WALK TO?
 *
 * `_sixstairs.mjs` found a real staircase in all ten interior volumes and
 * reported the nav component under each one as 50 / 345 / 919 / 1134 / 1324 —
 * none of them the biggest label on the grid. That is either "the interiors are
 * islands" (which would contradict `indoorcheck`) or "the biggest label is not
 * the street". This settles it by asking A* itself, from the real spawn points.
 *
 * Usage: node _sixfoot.mjs --url=http://127.0.0.1:4450/ --seed=7
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4450/';
const SEED = +(args.seed ?? 7);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
await page.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const r = await page.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const world = c.peek('world'), phys = c.peek('physics'), ai = c.peek('ai'), m = c.peek('match');
  const g = ai.grid;
  const MASK = phys.MASK.WORLD;
  const V = ai.root.position.constructor;
  const p0 = new V(), p1 = new V();
  const R = 0.36, H = 1.78, CELL = 0.8;

  const spawns = [...(m.spawns?.attack ?? []), ...(m.spawns?.defend ?? [])];
  const spawnComps = {};
  for (const s of spawns) {
    const ci = g.nearest(s.position.x, s.position.z, s.position.y, 6, 3);
    const k = ci >= 0 ? g.comp[ci] : -1;
    spawnComps[k] = (spawnComps[k] ?? 0) + 1;
  }
  const sizes = {};
  for (const k of Object.keys(spawnComps)) sizes[k] = g.compSize[k];

  const out = { spawnPoints: spawns.length, spawnComponents: spawnComps, spawnComponentSizes: sizes,
    biggestLabel: 0, biggest: 0, feet: [] };
  for (let i = 0; i < g.compSize.length; i++) if (g.compSize[i] > out.biggest) { out.biggest = g.compSize[i]; out.biggestLabel = i; }

  const path = [];
  const from = new V(), to = new V();
  for (const v of world.interiorVolumes) {
    // bottom tread again, cheaply: scan the footprint for the lowest standing
    // surface strictly above the ground floor.
    let best = null;
    const nx = Math.ceil(v.hw * 2 / CELL), nz = Math.ceil(v.hd * 2 / CELL);
    for (let iz = 0; iz <= nz; iz++) {
      for (let ix = 0; ix <= nx; ix++) {
        const lx = -v.hw + ix * CELL, lz = -v.hd + iz * CELL;
        if (Math.abs(lx) > v.hw || Math.abs(lz) > v.hd) continue;
        const x = v.cx + lx * v.c + lz * v.s;
        const z = v.cz - lx * v.s + lz * v.c;
        let y = v.floorY + 5;
        for (let k = 0; k < 8; k++) {
          const hit = phys.raycast(x, y, z, 0, -1, 0, 8, MASK);
          if (!hit.hit) break;
          const sy = hit.point.y;
          if (sy < v.floorY - 0.5) break;
          const rel = sy - v.floorY;
          if (hit.normal.y > 0.72 && rel > 0.45 && rel < 1.1) {
            p0.set(x, sy + R + 0.06, z); p1.set(x, sy + H - R, z);
            if (!phys.checkCapsule(p0, p1, R, MASK) && (!best || sy < best[1])) best = [x, sy, z];
          }
          y = sy - 0.08;
        }
      }
    }
    if (!best) { out.feet.push({ b: v.building, foot: null }); continue; }
    const ci = g.nearest(best[0], best[2], best[1], 4, 1.8);
    const rec = { b: v.building, foot: best.map((n) => +n.toFixed(2)),
      comp: ci >= 0 ? g.comp[ci] : -1, compSize: ci >= 0 ? g.compSize[g.comp[ci]] : 0 };
    // Ask A* from every spawn point: how many can route to the foot?
    let ok = 0;
    to.set(best[0], best[1], best[2]);
    for (const s of spawns) {
      from.copy(s.position);
      const n = g.findPath(from, to, path);
      if (n > 0) ok++;
    }
    rec.spawnsThatCanRoute = `${ok}/${spawns.length}`;
    out.feet.push(rec);
  }
  return out;
});

console.log(JSON.stringify(r, null, 1));
await browser.close();
