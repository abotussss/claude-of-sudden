import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4291/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 700, height: 400 } });
await p.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log(await p.evaluate(() => {
  const w = window.__ENGINE__.ctx.peek('world');
  const m = window.__ENGINE__.ctx.peek('match');
  const br = w.breaches ?? [];
  const t = m.tank.tanks[0];
  // how close does any baked leg get to a breachable wall?
  let best = Infinity, which = '';
  for (const tk of m.tank.tanks) for (const leg of tk.legs) for (let i = 0; i < leg.n; i++)
    for (const q of br) { const d = Math.hypot(leg.X[i]-q.position.x, leg.Z[i]-q.position.z); if (d < best) { best = d; which = q.id; } }
  return `world.breaches: ${br.length}\n` + br.slice(0,4).map((q)=>` ${q.id} strength=${q.strength} reach=${q.reach} hole=${q.holeW}x${q.holeH} down=${q.down} mass=${q.mass?q.mass.length:0}`).join('\n')
    + `\nhas damageAt=${typeof w.damageAt} breachAll=${typeof w.breachAll}`
    + `\nclosest a tank leg comes to a breachable wall: ${best.toFixed(1)} m (${which}); tankMainRadius=${m.tank ? '' : ''}`;
}));
await b.close();
