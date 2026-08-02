/** How often does `_descend` fire in a PLAIN match — i.e. can it touch anybody
 *  who is not on a roof? Plus the stuck ladder's own tally, for context. */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
for (const seed of String(args.seeds ?? '1').split(',')) {
  const p = await b.newPage({ viewport: { width: 900, height: 520 } });
  p.on('pageerror', (e) => console.log('  PAGEERROR', e.message));
  await p.goto(`http://127.0.0.1:4384/?seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
  const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
  await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
  for (let i = 0; i < 40; i++) await wait(8);
  console.log(seed, JSON.stringify(await p.evaluate(() => {
    const ai = window.__ENGINE__.ctx.peek('ai'), s = ai.stats;
    let aloft = 0;
    for (const a of ai.agents) if (a.alive && a.position.y > 2.5) aloft++;
    return { t: +window.__ENGINE__.ctx.time.elapsed.toFixed(0), unstick: s.unstick, rungs: [...(s.unstickRungs ?? [])], regain: s.unstickRegain ?? 0, descend: s.unstickDescend ?? 0, aloftNow: aloft };
  })));
  await p.close();
}
await b.close();
