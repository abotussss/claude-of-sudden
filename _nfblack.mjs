/**
 * WHAT IS THE BLACK RECTANGLE?
 *
 *   node _nfblack.mjs [--url=…]
 *
 * The `man-dark-200m` frame has a hard-edged black mass standing on the plain
 * with no shading in it at all. On the old lighting — a 4.3-intensity daylight
 * sun — nothing was ever going to read as black, so an object that receives no
 * light was invisible as a defect. At 0.049 of moon it is the most obvious thing
 * in the frame, and that is the point of running this: turning the lights down
 * finds every surface that was relying on them.
 *
 * This fires the same rays the camera does at the mass, and reports the merged
 * batch each one hit plus its material's name, colour and whether it is even
 * lit — so the answer is an owner and a material rather than "some box".
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4603/?map=plains&capture=1';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await p.evaluate(() => (window.__ENGINE__.time.scale = 6));
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await p.evaluate(() => { window.__ENGINE__.time.scale = 1; });

console.log(JSON.stringify(await p.evaluate(() => {
  const e = window.__ENGINE__, phys = e.ctx.peek('physics');
  // The eye and the man from the man-dark-200m stand.
  const c = { x: -32.3, y: 0, z: -44.5 }, m = { x: -63.6, z: 153 };
  const gy = e.ctx.peek('world').level.groundY;
  c.y = gy(c.x, c.z) + 1.62;
  const out = new Map();
  for (let k = -14; k <= 14; k++) {
    for (let v = -4; v <= 6; v++) {
      const tx = m.x + k * 1.4, tz = m.z, ty = gy(m.x, m.z) + 1.0 + v * 1.2;
      const dx = tx - c.x, dy = ty - c.y, dz = tz - c.z, L = Math.hypot(dx, dy, dz);
      const h = phys.raycast(c.x, c.y, c.z, dx / L, dy / L, dz / L, L + 60, phys.MASK.WORLD);
      if (!h.hit) continue;
      const o = h.object;
      const mat = o?.material;
      const key = `${o?.name ?? '(unnamed)'} | ${mat?.name ?? mat?.type ?? '?'}`;
      const rec = out.get(key) ?? {
        n: 0, dist: +h.distance.toFixed(1),
        colour: mat?.color ? [+mat.color.r.toFixed(3), +mat.color.g.toFixed(3), +mat.color.b.toFixed(3)] : null,
        emissive: mat?.emissive ? [+mat.emissive.r.toFixed(3), +mat.emissive.g.toFixed(3), +mat.emissive.b.toFixed(3)] : null,
        emissiveIntensity: mat?.emissiveIntensity ?? null,
        type: mat?.type ?? null, lit: !(mat?.isMeshBasicMaterial), parent: o?.parent?.name ?? null,
        visible: o?.visible, layers: o?.layers?.mask,
      };
      rec.n++; out.set(key, rec);
    }
  }
  return [...out.entries()].map(([k, v]) => ({ hit: k, ...v })).sort((a, z) => z.n - a.n);
}), null, 1));
console.log(errs.length ? `PAGEERRORS(${errs.length}) ${errs[0]}` : '0 pageerrors');
await b.close();
