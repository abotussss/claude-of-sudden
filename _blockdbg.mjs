/** Why did the pier's collision only bind 6 triangles? */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4498/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`${URL}?seed=7`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log(JSON.stringify(await p.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ph = e.ctx.peek('physics');
  const sw = ph.staticWorld;
  const blk = m.tank._blocks.list.find((q) => Math.hypot(q.x + 17, q.z + 25.5) < 1.5);
  if (!blk) return { err: 'no pier block' };
  const inside = [];
  const near = [];
  for (let t = 0; t < sw.triCount; t++) {
    const o = t * 9;
    const xs = [sw.pos[o], sw.pos[o + 3], sw.pos[o + 6]];
    const ys = [sw.pos[o + 1], sw.pos[o + 4], sw.pos[o + 7]];
    const zs = [sw.pos[o + 2], sw.pos[o + 5], sw.pos[o + 8]];
    const xlo = Math.min(...xs), xhi = Math.max(...xs);
    const ylo = Math.min(...ys), yhi = Math.max(...ys);
    const zlo = Math.min(...zs), zhi = Math.max(...zs);
    if (xhi < -19.5 || xlo > -14.5 || zhi < -28.5 || zlo > -22.5) continue;
    if (ylo > 5) continue;
    const fits = xlo >= blk.minX && xhi <= blk.maxX && zlo >= blk.minZ && zhi <= blk.maxZ &&
      ylo >= blk.minY && yhi <= blk.maxY;
    near.push({ t, x: [+xlo.toFixed(2), +xhi.toFixed(2)], y: [+ylo.toFixed(2), +yhi.toFixed(2)],
      z: [+zlo.toFixed(2), +zhi.toFixed(2)], fits, obj: sw.objects[sw.object[t]]?.mesh?.name ?? '?',
      bound: [...blk.tris].includes(t) });
    if (fits) inside.push(t);
  }
  return {
    box: { minX: +blk.minX.toFixed(2), maxX: +blk.maxX.toFixed(2), minY: +blk.minY.toFixed(2),
      maxY: +blk.maxY.toFixed(2), minZ: +blk.minZ.toFixed(2), maxZ: +blk.maxZ.toFixed(2), top: blk.top, y: blk.y },
    boundTris: [...blk.tris], fitsCount: inside.length,
    near: near.slice(0, 40),
  };
}), null, 1));
await b.close();
