/** What the fireteam cut is actually cutting: bucket keys, sizes, lanes, and why. */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4365/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto(`${URL}?seed=${+(args.seed ?? 1)}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((k) => new Promise((r) => { let i = 0; const t = () => (++i >= k ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await wait(90);
const out = [];
for (let i = 0; i < +(args.samples ?? 8); i++) {
  await wait(60);
  out.push(await p.evaluate(() => {
    const ai = window.__ENGINE__.ctx.peek('ai');
    return (ai.squads ?? []).map((sq) => {
      const modes = {};
      for (const m of sq.members) {
        if (!m.alive) continue;
        const o = m.objective;
        const k = o ? `${o.mode}:${o.site ? (o.site.id ?? 'site') : 'nosite'}` : 'none';
        modes[k] = (modes[k] ?? 0) + 1;
      }
      return {
        alive: sq.members.filter((m) => m.alive).length,
        modes,
        fts: (sq.fireteams ?? []).map((f) => `${f.members.length}@${f.lane}`).join(' '),
      };
    });
  }));
}
console.log(JSON.stringify(out, null, 1));
await b.close();
