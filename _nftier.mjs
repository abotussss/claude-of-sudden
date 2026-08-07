/**
 * CAN A BOT ACTUALLY GET TO EACH TIER OF THE PLAIN'S TWO STRUCTURES?
 *
 *   node _nftier.mjs [--url=…]
 *
 * `_nfcomp.mjs` counts stranded cells and `_nfstrand.mjs` names the big islands.
 * Neither answers the question this pass is about: for a named PLACE — the P1
 * deck, the P2 gallery, the control room, the rampart walk, the magazine — is
 * there a nav cell there, is it in the main component, and is there an A* route
 * to it from a spawn of each side?
 *
 * Points are authored in LEVEL space, which on this map is world space.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4607/?map=plains&capture=1';

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const id = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);

const r = await p.evaluate(() => {
  const E = window.__ENGINE__;
  const ai = E.ctx.peek('ai');
  const m = E.ctx.peek('match');
  const g = ai.grid;
  g._label();
  const big = g.compSize.indexOf(g.biggestComponent);
  const Y0 = E.ctx.peek('world').groundHeight(0, -32);
  const YF = E.ctx.peek('world').groundHeight(0, 48);
  const scratch = m.spawns.attack[0].position.clone();
  const PTS = [
    ['tower apron      ', 0, -32 - 24, Y0 + 0.1],
    ['tower P1 deck N  ', 0, -32 - 17, Y0 + 3.2],
    ['tower P1 deck S  ', 0, -32 + 17, Y0 + 3.2],
    ['tower P1 deck E  ', 17, -32, Y0 + 3.2],
    ['tower P2 gallery ', 0, -32 - 9, Y0 + 6.6],
    ['tower P2 gall. E ', 9, -32, Y0 + 6.6],
    ['tower ctrl room  ', 0, -32, Y0 + 6.74],
    ['tower room NE    ', 4.4, -32 - 1.2, Y0 + 6.74],
    ['tower room SW    ', -4.4, -32 + 1.2, Y0 + 6.74],
    ['tower room door N', 0, -32 - 5.2, Y0 + 6.74],
    ['tower rampfoot +Z', 0, -11.7, Y0 + 3.2],
    ['tower rampfoot -Z', 0, -52.3, Y0 + 3.2],
    ['fort courtyard   ', 0, 48 + 14, YF + 0.05],
    ['fort magazine    ', 0, 48 - 3, YF + 0.14],
    ['fort walk N      ', 0, 48 - 27, YF + 4.4],
    ['fort walk E      ', 27, 48, YF + 4.4],
    ['fort walk S      ', 0, 48 + 27, YF + 4.4],
    ['fort shed        ', -13, 48 + 12, YF + 0.04],
    ['zone D centre    ', 0, 0, E.ctx.peek('world').groundHeight(0, 0) + 0.1],
  ];
  const path = [];
  const out = [];
  for (const [label, x, z, y] of PTS) {
    const ci = g.nearest(x, z, y, 4, 1.4);
    if (ci < 0) { out.push({ label, cell: false }); continue; }
    const q = scratch.set(g.worldX(ci % g.nx), g.floor[ci], g.worldZ((ci / g.nx) | 0));
    let routes = 0;
    for (const kind of ['attack', 'defend']) {
      for (const sp of m.spawns[kind]) {
        if (g.findPath(sp.position, q, path) > 0) { routes++; break; }
      }
    }
    out.push({ label, cell: true, y: q.y, dy: q.y - y, main: g.comp[ci] === big, comp: g.compSize[g.comp[ci]] ?? 0, routes });
  }
  const caches = m.caches ? {
    list: m.caches.list.length, bot: m.caches.botList.length,
    kinds: m.caches.botKindCounts(),
    all: m.caches.list.map((c) => `${c.id}:${c.kind}${c.stand ? '*' : ''}`),
  } : null;
  return { walk: g.flags.reduce((a, v) => a + (v ? 1 : 0), 0), big: g.biggestComponent, comps: g.components, out, caches };
});

console.log(`\n  level.id=${id}  walkable ${r.walk}  biggest ${r.big}  stranded ${r.walk - r.big}  comps ${r.comps}`);
console.log('  place                 navcell   floorY    Δ       main-comp  comp-size  routed-sides');
for (const e of r.out) {
  if (!e.cell) { console.log(`  ${e.label}   NO CELL`); continue; }
  console.log(`  ${e.label}   yes     ${e.y.toFixed(2).padStart(7)} ${e.dy.toFixed(2).padStart(6)}   ${String(e.main).padEnd(9)} ${String(e.comp).padStart(9)}   ${e.routes}/2`);
}
if (r.caches) {
  console.log(`\n  caches: ${r.caches.list} bound, ${r.caches.bot} proved bot-walkable`, JSON.stringify(r.caches.kinds));
  console.log('  ', r.caches.all.join(' '));
}
console.log(`\n${errs.length} pageerrors`);
if (errs.length) console.log('  first:', errs[0]);
await b.close();
