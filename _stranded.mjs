/**
 * THE STRANDED BOT. Put a man on a roof and see whether he rejoins the fight.
 *
 * Picks the highest walkable cell within `--near` metres of the map centre that
 * a bot is not already standing on, teleports N live bots onto it, and then
 * samples every man's height and travel until he is back under 2.5 m and moving.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const N = +(args.n ?? 4);
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
  const men = ai.agents.filter((a) => a.alive).slice(0, 40);
  // roofs, biggest first, that the drop graph says can get down
  const per = new Map();
  for (let i = 0; i < g.flags.length; i++) {
    if (!g.flags[i] || !(g.floor[i] > 4.0)) continue;
    const c = g.comp[i];
    if (g.escape[c] < 0) continue;
    let e = per.get(c);
    if (!e) per.set(c, (e = { c, cells: [], y: g.floor[i] }));
    e.cells.push(i);
  }
  const roofs = [...per.values()].sort((a, c) => c.cells.length - a.cells.length).slice(0, N);
  const out = [];
  for (let k = 0; k < N && k < roofs.length && k < men.length; k++) {
    const r = roofs[k];
    const i = r.cells[(r.cells.length / 2) | 0];
    const x = g.worldX(i % g.nx), z = g.worldZ((i / g.nx) | 0), y = g.floor[i];
    const a = men[k];
    a.position.set(x, y + 0.05, z);
    a.controller?.teleport(x, y + 0.05, z);
    a.velocity.set(0, 0, 0);
    a.hasMoveTarget = false;
    a.pathLen = 0;
    a.repathTimer = 0;
    a.objectiveBlocked = false;
    a.__watch = k;
    ai.protect(a, 9999);
    out.push({ name: a.name, id: a.id, roofY: +y.toFixed(1), comp: r.c, escape: g.escape[r.c], roofCells: r.cells.length, x: +x.toFixed(1), z: +z.toFixed(1) });
  }
  window.__W__ = out.map((o) => o.id);
  window.__PROT__ = () => { for (const m of ai.agents) if (m.__watch !== undefined) ai.protect(m, 9999); };
  window.__S__ = out.map(() => ({ downAt: -1, start: null, travel: 0, minY: 1e9, last: null }));
  window.__CLK__ = 0;
  window.__TICK__ = (dt) => {
    const S = window.__S__;
    window.__CLK__ += dt;
    for (let k = 0; k < window.__W__.length; k++) {
      const a = ai.agents.find((m) => m.__watch === k);
      const s = S[k];
      if (!a) { s.gone = true; continue; }
      if (!a.alive) { s.dead = true; continue; }
      if (!s.start) s.start = { x: a.position.x, y: a.position.y, z: a.position.z };
      if (s.last) s.travel += Math.hypot(a.position.x - s.last.x, a.position.z - s.last.z);
      s.last = { x: a.position.x, z: a.position.z };
      s.y = +a.position.y.toFixed(2);
      if (a.position.y < s.minY) s.minY = +a.position.y.toFixed(2);
      if (s.downAt < 0 && s.start.y - a.position.y > 2.5) s.downAt = +window.__CLK__.toFixed(1);
      s.state = a.state;
      s.hp = a.health;
      s.blocked = a.objectiveBlocked;
      s.hasRoute = a.hasMoveTarget;
    }
  };
  return out;
}, N);
console.log('placed:', JSON.stringify(placed));

for (let i = 0; i < 260; i++) {
  await wait(6);
  await p.evaluate(() => { window.__PROT__(); window.__TICK__(6 / 60 * window.__ENGINE__.ctx.time.scale); });
}
const r = await p.evaluate(() => ({ clock: +window.__CLK__.toFixed(1), rows: window.__S__ }));
console.log('after', r.clock, 's of game time:');
for (let k = 0; k < r.rows.length; k++) {
  const s = r.rows[k];
  console.log(`  ${placed[k]?.name ?? k}  roofY=${placed[k]?.roofY}  descendedAt=${s.downAt < 0 ? 'NEVER' : s.downAt + 's'}  finalY=${s.y}  minY=${s.minY}  travelled=${(s.travel ?? 0).toFixed(1)}m  hp=${s.hp}  state=${s.state}  route=${s.hasRoute}  blocked=${s.blocked}${s.dead ? '  DEAD' : ''}${s.gone ? '  GONE' : ''}`);
}
const down = r.rows.filter((s) => s.downAt >= 0).length;
console.log(`\n  descended: ${down} / ${r.rows.length}`);
await b.close();
process.exit(down === r.rows.length ? 0 : 1);
