/**
 * WHAT THE PLAIN'S GROUND ACTUALLY DOES, so a route can be authored against it
 * rather than against a guess.
 *
 * `plains.js` publishes its height field analytically and `world.groundHeight`
 * IS that function (`PLAINS.groundY = plainsY`), so this asks the level rather
 * than raycasting. Two reports:
 *
 *   HOLLOWS   every local minimum of the swell on a 8 m lattice inside the
 *             walkable disc, with how much crest stands between it and the
 *             centre — a hull parked in one is hull-down to anything at D.
 *   PROFILE   the ground along a named line, sampled every 4 m, so a route's
 *             worst gradient and its skyline crossings are numbers.
 *
 *   node _plainscout.mjs http://127.0.0.1:4576/?map=plains
 */
import { chromium } from 'playwright';
const URL = process.argv[2];
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1024, height: 640 } });
p.on('pageerror', (e) => console.log('PAGEERROR ' + String(e.message).slice(0, 300)));
p.on('console', (m) => { const t = m.text(); if (/error|fail|warn/i.test(t)) console.log('  ' + t.slice(0, 200)); });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const out = await p.evaluate(() => {
  const w = window.__ENGINE__.ctx.peek('world');
  const Y = (x, z) => w.groundHeight(x, z);
  const R = 168;

  /* ---- hollows: local minima on an 8 m lattice ------------------------- */
  const hollows = [];
  for (let x = -160; x <= 160; x += 8) {
    for (let z = -160; z <= 160; z += 8) {
      if (Math.hypot(x, z) > R) continue;
      const y = Y(x, z);
      let min = true;
      for (let dx = -8; dx <= 8 && min; dx += 8) {
        for (let dz = -8; dz <= 8; dz += 8) {
          if (!dx && !dz) continue;
          if (Y(x + dx, z + dz) < y - 0.001) { min = false; break; }
        }
      }
      if (!min) continue;
      // how much crest stands between here and the centre, in the first 45 m
      const d = Math.hypot(x, z) || 1;
      let crest = 0;
      for (let s = 4; s <= 45; s += 3) {
        const h = Y(x - (x / d) * s, z - (z / d) * s);
        crest = Math.max(crest, h - y);
      }
      hollows.push({ x, z, y: +y.toFixed(2), crestToD: +crest.toFixed(2) });
    }
  }
  hollows.sort((a, b) => b.crestToD - a.crestToD);

  /* ---- profile along a set of named lines ------------------------------ */
  const lines = {
    'N base -> D': [[-14, -150], [0, 0]],
    'N base -> A': [[-14, -150], [-118, -104]],
    'N base -> E': [[-14, -150], [128, -86]],
    'S base -> D': [[14, 150], [0, 0]],
    'S base -> C': [[14, 150], [-128, 86]],
    'S base -> B': [[14, 150], [118, 104]],
    'A -> C (west edge)': [[-118, -104], [-128, 86]],
    'E -> B (east edge)': [[128, -86], [118, 104]],
  };
  const profile = {};
  for (const [k, [a, c]] of Object.entries(lines)) {
    const n = Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 4);
    const ys = [];
    let worst = 0;
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a[0] + (c[0] - a[0]) * t;
      const z = a[1] + (c[1] - a[1]) * t;
      const y = Y(x, z);
      if (prev !== null) worst = Math.max(worst, Math.abs(y - prev) / 4);
      prev = y;
      ys.push(+y.toFixed(1));
    }
    profile[k] = { worstGrade: +worst.toFixed(3), min: Math.min(...ys), max: Math.max(...ys), ys };
  }

  /* ---- height at the points a route would be authored through ---------- */
  const at = {};
  for (const [k, q] of Object.entries({
    A: [-118, -104], B: [118, 104], C: [-128, 86], E: [128, -86], D: [0, 0],
    'BASE-N': [-14, -150], 'BASE-S': [14, 150],
  })) at[k] = +Y(q[0], q[1]).toFixed(2);

  return { hollows: hollows.slice(0, 40), profile, at, ridge: w.level?.ridge,
    fires: (w.level?.fires ?? []).map((f) => ({ id: f.id, x: +f.position.x.toFixed(0), z: +f.position.z.toFixed(0), r: +f.radius.toFixed(0) })) };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
