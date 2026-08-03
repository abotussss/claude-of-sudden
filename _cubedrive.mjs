/**
 * DRIVE THE REAL HULL DOWN ITS REAL LEG AND SEE THE CUBE GO.
 *
 *   node _cubedrive.mjs [--url=…] [--seed=7]
 *
 * `_cubeshot.mjs` calls `_breakBlocksAt` by hand, which proves the eraser. This
 * proves the FEATURE: a sortie, the match's own update loop, and nothing
 * touched but the clock — the gate pier on the cathedral's parvis has to come
 * off because a 40 t hull drove into it.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true];
}));
const URL = args.url ?? 'http://127.0.0.1:4498/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
p.on('console', (m) => { const t = m.text(); if (/SORTIE|BREACH/.test(t)) console.log('  ' + t); });
await p.goto(`${URL}?seed=${args.seed ?? 7}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const start = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ph = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  if (m.phase !== 'live') m._setPhase('live', 0);
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  const top = (x, z, y) => {
    const h = ph.raycast(new V3(x, y + 30, z), new V3(0, -1, 0), 45, ph.MASK.WORLD);
    return h?.hit ? +(y + 30 - h.distance - y).toFixed(2) : null;
  };
  const piers = m.tank._blocks.list.filter((q) => q.top > 3).map((q) => ({
    x: +q.x.toFixed(1), z: +q.z.toFixed(1), before: top(q.x, q.z, q.y),
  }));
  e.time.scale = 8;
  m.tank.fire();
  return { piers, tanks: m.tank.tanks.map((t) => t.state) };
});
console.log(`\n  piers over 3 m before the sortie: ${JSON.stringify(start.piers)}`);

for (let i = 0; i < 40; i++) {
  await p.waitForTimeout(1000);
  const s = await p.evaluate(() => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const ph = e.ctx.peek('physics');
    const V3 = e.camera.position.constructor;
    const top = (x, z, y) => {
      const h = ph.raycast(new V3(x, y + 30, z), new V3(0, -1, 0), 45, ph.MASK.WORLD);
      return h?.hit ? +(y + 30 - h.distance - y).toFixed(2) : null;
    };
    return {
      t: +e.time.elapsed.toFixed(0),
      tanks: m.tank.tanks.map((q) => `${q.id}:${q.state}:${q.s.toFixed(0)}m/leg${q.legIx}`),
      piers: m.tank._blocks.list.filter((q) => q.top > 3).map((q) => ({ x: +q.x.toFixed(1), now: top(q.x, q.z, q.y), fired: q.fired })),
      broke: m.tank._blocks.fired.length,
    };
  });
  console.log(`  t=${String(s.t).padStart(4)}s  ${s.tanks.join('  ')}  blocks broken ${s.broke}  piers ${s.piers.map((q) => `${q.x}:${q.now}${q.fired ? '(FIRED)' : ''}`).join(' ')}`);
  if (s.piers.every((q) => q.fired)) break;
}
if (errs.length) console.log('  PAGEERRORS', errs.slice(0, 3));
await b.close();
