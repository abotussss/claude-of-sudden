/**
 * WHAT IS THE MASONRY AT A GIVEN WORLD POINT, AND HOW WIDE IS THE LANE THERE?
 * The tank agent reported a 4.2 x 2.6 x 3.6 m merged-masonry shed at world
 * (-37, 19) pinching a spoke to 3.4 m against a hull that needs ~3.5 m.
 *
 *   node _pinchwhy.mjs [--url=…] [--seed=N] [--at=x,z]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)];
  })
);
const url = (args.url ?? 'http://127.0.0.1:4422/') + '?seed=' + (args.seed ?? 11);
const AT = (args.at ?? '-37,19').split(',').map(Number);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 540 } });
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(([wx, wz]) => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const phys = e.ctx.peek('physics');
  const V3 = e.ctx.camera.position.constructor;
  const S = w.layout.SCALE;
  const lv = w.worldToLevel(wx, 0, wz, new V3());
  const SPREAD = 9.0, WB = 6.2, WK = 1 + SPREAD / WB;
  const unwiden = (x) => (Math.abs(x) <= WB * WK ? x / WK : x - Math.sign(x) * SPREAD);
  const widened = { x: lv.x / S, z: lv.z / S };
  const authored = { x: +unwiden(widened.x).toFixed(2), z: +widened.z.toFixed(2) };

  // Sweep the mass: rays at 1.4 m through the point on both plan axes.
  const res = { at: [wx, wz], widened: [+widened.x.toFixed(2), +widened.z.toFixed(2)], authored };
  const probe = (dx, dz, label) => {
    const from = new V3(wx - dx * 14, 1.4, wz - dz * 14);
    const hits = [];
    let t = 0;
    for (let i = 0; i < 40; i++) {
      const h = phys.raycast(new V3(from.x + dx * t, 1.4, from.z + dz * t), new V3(dx, 0, dz), 28 - t, phys.MASK?.CHARACTER);
      if (!h?.hit) break;
      hits.push({ d: +(t + h.distance).toFixed(2), surface: h.surface ?? '?' });
      t += h.distance + 0.05;
      if (t > 28) break;
    }
    res[label] = hits;
  };
  probe(1, 0, 'alongX');
  probe(0, 1, 'alongZ');

  /**
   * THE LANE WIDTH AT THIS POINT: walk out perpendicular in both directions at
   * hull height until something stops a 1.75 m half-width.
   */
  const clear = (dx, dz) => {
    for (let d = 0.5; d < 20; d += 0.25) {
      const p = new V3(wx + dx * d, 1.4, wz + dz * d);
      if (phys.raycastAny?.(p.x, 0.6, p.z, dx, 0, dz, 0.3, phys.MASK?.CHARACTER)) return +d.toFixed(2);
    }
    return null;
  };
  res.clearXplus = clear(1, 0);
  res.clearXminus = clear(-1, 0);
  res.clearZplus = clear(0, 1);
  res.clearZminus = clear(0, -1);

  // Is there an instanced prop here, or is it merged masonry?
  res.nearbyProtos = [];
  try {
    for (const [id, n] of Object.entries(w.instanceCountsNear?.(wx, wz, 6) ?? {})) res.nearbyProtos.push(`${id}x${n}`);
  } catch { res.nearbyProtos = ['(no instanceCountsNear)']; }
  return res;
}, AT);
console.log(JSON.stringify(out, null, 2));
await browser.close();
