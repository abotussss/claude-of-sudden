import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto('http://127.0.0.1:4294/?capture=1&seed=11', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log(JSON.stringify(await page.evaluate(() => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), phys = e.ctx.peek('physics'), ai = e.ctx.peek('ai');
  const out = [];
  for (const c of m.caches.list.filter((x) => x.kind === 'medic')) {
    const p = c.position;
    const h = phys.raycast(p.x, p.y + 40, p.z, 0, -1, 0, 80, phys.MASK.WORLD);
    out.push({
      id: c.id,
      cacheY: +p.y.toFixed(3),
      rayGroundY: h.hit ? +h.point.y.toFixed(3) : null,
      raySurface: h.hit ? h.surface : null,
      aiGroundAt: +ai.groundAt(p.x, p.z, p.y + 6).toFixed(3),
      standY: c.stand ? +c.stand.y.toFixed(3) : null,
      discY: +(p.y + 0.025).toFixed(3),
    });
  }
  return out;
}), null, 1));
console.log(errs.length ? `[pageerror] ${errs[0]}` : '[pageerror] none');
await b.close();
