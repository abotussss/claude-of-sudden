/**
 * THE ROOF GATE — put a man on every big roof and order him to the ground.
 *
 * `match` re-cuts its objective plan every two seconds and will happily hand a
 * man on a roof a cache he cannot reach, so the order is re-applied every tick:
 * this measures NAVIGATION, not tasking. Reports, per roof, how long he took to
 * lose 2.5 m of height and whether he was still on his feet at the end.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const N = +(args.n ?? 6);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', (e) => console.log('  PAGEERROR', e.message));
await p.goto(args.url ?? 'http://127.0.0.1:4355/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 6; });
await wait(180);

const placed = await p.evaluate((N) => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  const g = ai.grid;
  const per = new Map();
  for (let i = 0; i < g.flags.length; i++) {
    if (!g.flags[i] || !(g.floor[i] > 4.0)) continue;
    const c = g.comp[i];
    let e = per.get(c);
    if (!e) per.set(c, (e = { c, cells: [], esc: g.escape[c] }));
    e.cells.push(i);
  }
  const roofs = [...per.values()].sort((a, c) => c.cells.length - a.cells.length).slice(0, N);
  const men = ai.agents.filter((a) => a.alive).slice(0, N);
  const rec = [];
  for (let k = 0; k < roofs.length && k < men.length; k++) {
    const r = roofs[k];
    const i = r.cells[(r.cells.length / 2) | 0];
    const x = g.worldX(i % g.nx), z = g.worldZ((i / g.nx) | 0), y = g.floor[i];
    // somewhere on the ground of the component he is supposed to end up on
    const want = r.esc >= 0 ? r.esc : 0;
    let goal = -1, bestD = Infinity;
    for (let q = 0; q < g.flags.length; q += 11) {
      if (!g.flags[q] || g.comp[q] !== want || g.floor[q] > 2.0) continue;
      const d = (g.worldX(q % g.nx) - x) ** 2 + (g.worldZ((q / g.nx) | 0) - z) ** 2;
      if (d < bestD) { bestD = d; goal = q; }
    }
    if (goal < 0) continue;
    const a = men[k];
    a.position.set(x, y + 0.05, z);
    a.controller?.teleport(x, y + 0.05, z);
    a.velocity.set(0, 0, 0);
    a.hasMoveTarget = false; a.pathLen = 0; a.repathTimer = 0; a.objectiveBlocked = false;
    a.__roof = k;
    a.__goal = { x: g.worldX(goal % g.nx), y: g.floor[goal], z: g.worldZ((goal / g.nx) | 0) };
    rec.push({ k, comp: r.c, cells: r.cells.length, roofY: +y.toFixed(1), escape: r.esc, goalDist: +Math.sqrt(bestD).toFixed(0) });
  }
  window.__R__ = rec.map(() => ({ down: -1, minY: 1e9, travel: 0, last: null, gone: false }));
  window.__CLK__ = 0;
  window.__T__ = (dt) => {
    window.__CLK__ += dt;
    for (const a of ai.agents) {
      if (a.__roof === undefined) continue;
      const s = window.__R__[a.__roof];
      if (!s) continue;
      ai.protect(a, 9999);
      if (!a.alive) { s.dead = true; continue; }
      a.setObjective('defuse', a.__goal, null, null);
      if (s.last) s.travel += Math.hypot(a.position.x - s.last.x, a.position.z - s.last.z);
      s.last = { x: a.position.x, z: a.position.z };
      s.y = +a.position.y.toFixed(2);
      if (a.position.y < s.minY) s.minY = +a.position.y.toFixed(2);
      if (s.down < 0 && a.position.y < a.__goal.y + 1.5) s.down = +window.__CLK__.toFixed(1);
      s.state = a.state; s.hp = Math.round(a.health); s.route = a.hasMoveTarget; s.blocked = a.objectiveBlocked;
    }
  };
  return rec;
}, N);

for (let i = 0; i < 200; i++) {
  await wait(6);
  await p.evaluate(() => window.__T__(6 / 60 * window.__ENGINE__.ctx.time.scale));
}
const r = await p.evaluate(() => ({ clock: +window.__CLK__.toFixed(1), rows: window.__R__ }));
console.log(`\n  ${placed.length} roofs, ${r.clock}s of game time`);
for (let k = 0; k < placed.length; k++) {
  const s = r.rows[k], q = placed[k];
  console.log(`  roof comp ${String(q.comp).padStart(5)}  ${String(q.cells).padStart(5)} cells  y=${String(q.roofY).padStart(4)}  escape=${String(q.escape).padStart(3)}  ` +
    `down=${s.down < 0 ? 'NEVER' : s.down + 's'}  minY=${s.minY}  travel=${s.travel.toFixed(0)}m  hp=${s.hp}  state=${s.state}  route=${s.route}${s.dead ? ' DEAD' : ''}`);
}
const ok = r.rows.filter((s) => s.down >= 0).length;
console.log(`\n  got down: ${ok} / ${r.rows.length}`);
await b.close();
process.exit(ok === r.rows.length ? 0 : 1);
