/**
 * IS THERE A STAIR, AND CAN A CAPSULE STAND ON IT? — de-risking item 4.
 *
 * `NavGrid` is a 2.5D height field: one floor per cell, and inside a building
 * `_carveInteriors` chooses the GROUND one, so an upper storey is not in the
 * graph at all and a stair is 0 waypoints. That is a fact about A*, NOT about
 * the capsule: `STANCE.stand.stepHeight` is 0.42 and the treads are 0.19, so the
 * character controller has always been able to WALK a flight. Nobody has ever
 * asked it to, because nothing could describe the destination.
 *
 * So this asks the question `tools/floorcheck.mjs` asks for the player, in the
 * bot's own capsule: cast down the column repeatedly inside every interior
 * volume, keep every horizontal surface, and see whether the treads between the
 * ground floor and the first slab exist, whether a 0.36 m / 1.78 m capsule fits
 * on them, and where the flight starts and ends.
 *
 * Usage: node _sixstairs.mjs --url=http://127.0.0.1:4450/ --seed=7
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
  const world = c.peek('world'), phys = c.peek('physics'), ai = c.peek('ai');
  const g = ai.grid;
  const MASK = phys.MASK.WORLD;
  const V = ai.root.position.constructor;
  const p0 = new V(), p1 = new V();
  const R = 0.36, H = 1.78, STEP = 0.42;
  const CELL = 0.8;
  const out = { volumes: world.interiorVolumes.length, features: [], buildings: [] };

  for (const f of (world.features ?? [])) {
    out.features.push({ id: f.id, kind: f.kind, b: f.building, floor: f.floor, indoor: f.indoor,
      y: +f.position.y.toFixed(2), x: +f.position.x.toFixed(1), z: +f.position.z.toFixed(1) });
  }

  for (const v of world.interiorVolumes) {
    const rec = { building: v.building, floorY: +v.floorY.toFixed(2), probeY: +v.probeY.toFixed(2),
      hw: +v.hw.toFixed(1), hd: +v.hd.toFixed(1), surfaces: {}, treadCells: 0, treads: [], upperCells: 0 };
    const nx = Math.ceil(v.hw * 2 / CELL), nz = Math.ceil(v.hd * 2 / CELL);
    for (let iz = 0; iz <= nz; iz++) {
      for (let ix = 0; ix <= nx; ix++) {
        const lx = -v.hw + ix * CELL, lz = -v.hd + iz * CELL;
        if (Math.abs(lx) > v.hw || Math.abs(lz) > v.hd) continue;
        // back to world: the volume's axes are (c, s)
        const x = v.cx + lx * v.c + lz * v.s;
        const z = v.cz - lx * v.s + lz * v.c;
        // walk the column down from well above the roof
        let y = v.floorY + 14;
        for (let k = 0; k < 12; k++) {
          const hit = phys.raycast(x, y, z, 0, -1, 0, 20, MASK);
          if (!hit.hit) break;
          const sy = hit.point.y;
          if (sy < v.floorY - 0.5) break;
          const flat = hit.normal.y > 0.72;
          if (flat) {
            // does the bot capsule stand here?
            p0.set(x, sy + R + 0.06, z);
            p1.set(x, sy + H - R, z);
            const fits = !phys.checkCapsule(p0, p1, R, MASK);
            const rel = sy - v.floorY;
            const bucket = (Math.round(rel * 4) / 4).toFixed(2);
            if (fits) {
              rec.surfaces[bucket] = (rec.surfaces[bucket] ?? 0) + 1;
              // A TREAD: standing room strictly between the ground floor and
              // the first slab. `_carveInteriors` throws these away (it refuses
              // anything over floorY + 0.9) which is why a stair is 0 waypoints.
              if (rel > 0.5 && rel < 3.0) {
                rec.treadCells++;
                if (rec.treads.length < 400) rec.treads.push([+x.toFixed(1), +sy.toFixed(2), +z.toFixed(1)]);
              }
              if (rel >= 3.0 && rel < 4.2) rec.upperCells++;
            }
          }
          y = sy - 0.08;
        }
      }
    }
    // Where does the flight sit, and how tall is it?
    if (rec.treads.length) {
      let lo = Infinity, hi = -Infinity, loP = null, hiP = null;
      for (const t of rec.treads) {
        if (t[1] < lo) { lo = t[1]; loP = t; }
        if (t[1] > hi) { hi = t[1]; hiP = t; }
      }
      rec.flight = { bottom: loP, top: hiP, rise: +(hi - lo).toFixed(2) };
      // is the bottom of the flight ON the nav grid, i.e. can A* deliver a man
      // to the foot of the stair?
      const ci = g.nearest(loP[0], loP[2], loP[1], 4, 1.6);
      rec.footOnGrid = ci >= 0 ? { comp: g.comp[ci], floor: +g.floor[ci].toFixed(2) } : null;
    }
    delete rec.treads;
    out.buildings.push(rec);
  }
  let big = -1, bigC = 0;
  for (let i = 0; i < g.compSize.length; i++) if (g.compSize[i] > big) { big = g.compSize[i]; bigC = i; }
  out.groundComp = bigC;
  return out;
});

console.log(JSON.stringify(r, null, 1));
await browser.close();
