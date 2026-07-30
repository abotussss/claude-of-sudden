import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:4214/';
const N = Number(process.argv[2] ?? 3);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
for (let i = 0; i < N; i++) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  const logs = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/\[match\]|\[ai\] nav|\[world\]/.test(t)) logs.push(t);
  });
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
  const r = await page.evaluate(() => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const world = e.ctx.peek('world');
    const ai = e.ctx.peek('ai');
    const V3 = m.sites[0].position.constructor;
    const W2L = (p) => world.worldToLevel(p.x, p.y, p.z, new V3());
    return {
      navPending: ai._navPending,
      walkable: ai.stats.walkable,
      cover: ai.cover?.points?.length ?? -1,
      grid: ai.grid ? [ai.grid.nx, ai.grid.nz] : null,
      sites: m.sites.map((s) => {
        const l = W2L(s.position);
        const h = W2L(s.hold);
        return {
          id: s.id,
          level: [+l.x.toFixed(2), +l.z.toFixed(2)],
          world: [+s.position.x.toFixed(2), +s.position.y.toFixed(2), +s.position.z.toFixed(2)],
          hold: [+h.x.toFixed(2), +h.z.toFixed(2)],
          r: s.radius,
          stand: s.stand.length,
        };
      }),
    };
  });
  console.log(`--- run ${i} ---`);
  console.log(JSON.stringify(r, null, 1));
  for (const l of logs) console.log('   |', l);
  await page.close();
}
await browser.close();
