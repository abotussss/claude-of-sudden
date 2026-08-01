/** One man, one roof, frame by frame: why is he still up there? */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const RANK = +(args.roof ?? 1);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', (e) => console.log('  PAGEERROR', e.message));
await p.goto(args.url ?? 'http://127.0.0.1:4355/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 4; });
await wait(180);
console.log(await p.evaluate((RANK) => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  const g = ai.grid;
  const per = new Map();
  for (let i = 0; i < g.flags.length; i++) {
    if (!g.flags[i] || !(g.floor[i] > 4.0)) continue;
    const c = g.comp[i];
    if (g.escape[c] < 0) continue;
    let e = per.get(c);
    if (!e) per.set(c, (e = { c, cells: [] }));
    e.cells.push(i);
  }
  const roofs = [...per.values()].sort((a, c) => c.cells.length - a.cells.length);
  const r = roofs[RANK];
  const i = r.cells[(r.cells.length / 2) | 0];
  const a = ai.agents.find((m) => m.alive);
  const x = g.worldX(i % g.nx), z = g.worldZ((i / g.nx) | 0), y = g.floor[i];
  a.position.set(x, y + 0.05, z);
  a.controller?.teleport(x, y + 0.05, z);
  a.velocity.set(0, 0, 0);
  a.hasMoveTarget = false; a.pathLen = 0; a.repathTimer = 0; a.objectiveBlocked = false;
  window.__A__ = a.id;
  window.__L__ = [];
  window.__TICK__ = () => {
    const m = ai.agents.find((q) => q.id === window.__A__);
    if (!m) return;
    const wp = m.hasMoveTarget && m.pathIndex < m.pathLen ? m.path[m.pathIndex] : null;
    window.__L__.push([
      +m.position.y.toFixed(2), m.state, +m.speed.toFixed(1), m.grounded ? 'G' : 'air',
      +m.vaultCooldown.toFixed(1), m.pathIndex + '/' + m.pathLen,
      wp ? `${wp.x.toFixed(0)},${wp.y.toFixed(1)},${wp.z.toFixed(0)}` : '-',
      wp ? +Math.hypot(wp.x - m.position.x, wp.z - m.position.z).toFixed(1) : -1,
      m.controller?.lastMoveBlocked ? 'B' : '.', m.objectiveBlocked ? 'OB' : '.',
      m.objective ? m.objective.mode : 'none',
    ].join(' '));
  };
  return `roof comp ${r.c} cells ${r.cells.length} y ${y.toFixed(1)} agent ${a.name} obj ${a.objective?.mode}`;
}, RANK));
for (let i = 0; i < 90; i++) { await wait(4); await p.evaluate(() => window.__TICK__()); }
const L = await p.evaluate(() => window.__L__);
console.log('y state spd grnd vcd idx/len wp dist blk objblk mode');
for (let i = 0; i < L.length; i += 1) console.log(' ', L[i]);
await b.close();
