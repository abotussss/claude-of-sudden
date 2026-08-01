/** Is the marksman's height cap worth revisiting? How many high cover points
 *  can a man on the ground actually reach — and get back from? */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', (e) => console.log('  PAGEERROR', e.message));
await p.goto(args.url ?? 'http://127.0.0.1:4355/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await wait(240);
console.log(JSON.stringify(await p.evaluate(() => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  const g = ai.grid, cm = ai.cover;
  const stand = new Set();
  for (const a of ai.agents) {
    if (!a.alive) continue;
    const i = g.nearest(a.position.x, a.position.z, a.position.y, 4, 2.0);
    if (i >= 0 && g.comp[i] >= 0) stand.add(g.comp[i]);
  }
  let total = 0, high = 0, highSame = 0, highDrop = 0, maxRise = 0;
  for (const pt of cm.all) {
    total++;
    if (!(pt.y > 2.5)) continue;
    high++;
    const c = g.comp[pt.cell];
    if (stand.has(c)) { highSame++; if (pt.y > maxRise) maxRise = +pt.y.toFixed(1); }
    else if (g.escape.length && stand.has(g.escape[c])) highDrop++;
  }
  return { coverPoints: total, above2m5: high, sameComponentAsAMan: highSame, onlyReachableByFalling: highDrop, highestReachable: maxRise, standComps: [...stand] };
}, null)));
await b.close();
