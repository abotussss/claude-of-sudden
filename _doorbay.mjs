/**
 * WHERE A DOOR ACTUALLY LANDS ON ITS FACE, as a fraction of that face.
 *
 *   node _doorbay.mjs --url=http://127.0.0.1:4310/?seed=1 --id=WC8,EC8
 *
 * `doorBays` names a BAY INDEX and the ρ pairing in layout.js maps bay b to
 * bay 2-b. That is only the mirror if bay 0 is at the same end of every face,
 * and nothing has ever measured whether it is. This prints the fraction along
 * each face, which is the coordinate the room plans and the routes are in.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
await p.goto(args.url ?? 'http://127.0.0.1:4310/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log(await p.evaluate((ONLY) => {
  const w = window.__ENGINE__.ctx.peek('world');
  const B = w.layout.BUILDINGS; const lines = [];
  for (let i = 0; i < B.length; i++) {
    const s = B[i]; if (!s.enterable) continue;
    if (ONLY && !ONLY.includes(s.id)) continue;
    const info = w.buildings[i];
    for (const d of info.doors) {
      const alongX = d.side === 0 || d.side === 2;
      const len = alongX ? s.w : s.d;
      const c = alongX ? s.x : s.z;
      const v = alongX ? d.wp[0] : d.wp[2];
      lines.push(`  ${s.id} side ${d.side}  bay ${JSON.stringify(s.doorBays?.[d.side])}  world ${d.wp[0].toFixed(2)},${d.wp[2].toFixed(2)}  fraction ${(((v - c) / len) + 0.5).toFixed(3)}`);
    }
  }
  return lines.join('\n');
}, args.id ? String(args.id).split(',') : null));
await b.close();
