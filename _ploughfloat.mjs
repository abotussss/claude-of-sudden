/**
 * DID PLOUGHING LEAVE ANYTHING STANDING ON NOTHING?
 *
 * 「大聖堂爆破すると空中に瓦礫が浮いてます しかも物理判定あるので戦車が空中に登って
 *  しまいますよ？？？」 — the same question `_floatcheck.mjs` asks of the whole map,
 * asked of the ground the tank actually drove over, BEFORE and AFTER the piles
 * go. The whole-map gate cannot answer it because nothing in a headless boot
 * ever fires a sortie, so the map it measures is one where the plough has not
 * happened.
 *
 * Same method as the gate: reconstruct the SOLID INTERVALS of the physics world
 * over a lattice and ask of each whether there is anything underneath it. A
 * count that does not rise is the claim; the plough only ever removes solid
 * mass and its debris is never collision, so the count must not move at all.
 *
 * Usage: node _ploughfloat.mjs [url] [seed]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4290/';
const SEED = process.argv[3] ?? '7';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const m = ctx.peek('match');
  const phys = ctx.peek('physics');
  const a = m?.tank;
  if (!a?.ready) return { error: 'no armour' };
  const V3 = e.camera.position.constructor;

  const GRID = 0.4;   // lattice pitch
  const TOL = 0.6;    // metres of air that make a mass "floating"
  const PAD = 6;      // how far round a pile to sweep
  const TOP = 45;

  const areas = [];
  for (const tank of a.tanks) {
    for (const q of tank.plough ?? []) {
      areas.push({ id: `${tank.id}`, x: q.x, y: q.y, z: q.z, top: q.top });
    }
  }

  /** Every solid interval in one column, top-down. */
  const column = (x, z) => {
    const o = new V3();
    const d = new V3(0, -1, 0);
    const spans = [];
    let y = TOP;
    let guard = 0;
    while (y > -5 && guard++ < 40) {
      o.set(x, y, z);
      const h = phys.raycast(o, d, y + 5, phys.MASK.WORLD);
      if (!h?.hit) break;
      const enter = y - h.distance;
      // find where this mass ends: march down in small steps until a ray fired
      // UP from below no longer lands on it
      let exit = enter;
      let probe = enter - 0.05;
      let g2 = 0;
      while (probe > -5 && g2++ < 60) {
        o.set(x, probe, z);
        const up = phys.raycast(o, new V3(0, 1, 0), enter - probe + 0.05, phys.MASK.WORLD);
        if (!up?.hit) { exit = probe + 0.05; break; }
        probe -= 0.05;
      }
      if (exit > enter) exit = enter;
      spans.push([exit, enter]); // [bottom, top]
      y = exit - 0.02;
    }
    return spans;
  };

  const sweep = () => {
    let floating = 0;
    let cells = 0;
    const worst = [];
    for (const area of areas) {
      for (let dx = -PAD; dx <= PAD; dx += GRID) {
        for (let dz = -PAD; dz <= PAD; dz += GRID) {
          const x = area.x + dx, z = area.z + dz;
          const spans = column(x, z);
          if (!spans.length) continue;
          cells++;
          for (let i = 0; i < spans.length; i++) {
            const bottom = spans[i][0];
            // what is the top of the next mass below this one?
            const below = i + 1 < spans.length ? spans[i + 1][1] : -Infinity;
            const air = bottom - below;
            if (below === -Infinity) continue; // rests on the terrain column
            if (air > TOL) {
              floating++;
              worst.push({ x: +x.toFixed(1), z: +z.toFixed(1), bottom: +bottom.toFixed(2), air: +air.toFixed(2), area: area.id });
            }
          }
        }
      }
    }
    worst.sort((p, q) => q.air - p.air);
    return { floating, cells, worst: worst.slice(0, 8) };
  };

  a.reset();
  const before = sweep();

  // roll the sortie and drive the whole route by hand so every pile fires
  a.fire();
  let steps = 0;
  while (steps < 4000) {
    a.update(1 / 60, false);
    steps++;
    let moving = false;
    for (const tank of a.tanks) if (tank.state === 'advance' || tank.state === 'hold') moving = true;
    if (!moving && steps > 60) break;
  }
  let fired = 0;
  for (const tank of a.tanks) for (const q of tank.plough ?? []) if (q.fired) fired++;

  const after = sweep();
  a.reset();
  const restored = sweep();
  return { areas: areas.length, fired, before, after, restored };
});

if (out.error) console.log('ERROR', out.error);
else {
  console.log(`piles swept: ${out.areas}, fired: ${out.fired}`);
  const row = (n, r) => console.log(`  ${n.padEnd(9)} columns=${String(r.cells).padStart(6)}  FLOATING=${r.floating}`);
  row('before', out.before);
  row('after', out.after);
  row('restored', out.restored);
  if (out.after.worst.length) {
    console.log('\n  worst after ploughing:');
    for (const w of out.after.worst) console.log(`    (${w.x},${w.z}) bottom=${w.bottom} air=${w.air} [${w.area}]`);
  }
  const delta = out.after.floating - out.before.floating;
  console.log(`\n  delta from ploughing: ${delta > 0 ? `+${delta}` : delta}`);
  console.log(delta <= 0 ? '\nPASS — ploughing created no floating mass' : '\nFAIL — ploughing left mass in the air');
}
if (errs.length) console.log('\nPAGEERRORS:', errs);
await b.close();
