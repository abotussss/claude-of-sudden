/**
 * ════════════════════════════════════════════════════════════════════════════
 * IF YOU FALL IN, CAN YOU GET OUT? — the one-way sweep
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nftrap.mjs [--url=http://127.0.0.1:4608/?map=plains]
 *
 * A trench cheek is cut at 63°, which is over `NavGrid`'s 46° slope limit and
 * well over the 0.45 m `maxStep`. That is the entire point of a trench and it is
 * also how you build a pit. `Agent._measureDrops` lets a bot take a drop it
 * cannot climb back up — it measures the fall, not the return — so nothing in
 * this engine has ever asked whether a man who gets into one of these can get
 * out again. 627 m of them just landed. A trench that is a trap is worse than no
 * trench: a bot in one walks the floor until the round ends, and a player in one
 * quits.
 *
 * Two questions, because there are two kinds of occupant and the answers are
 * found in different places.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 1. THE BOTS — is every cut cell in the same component as the plain?
 * ────────────────────────────────────────────────────────────────────────────
 * `NavGrid._label` is a pure flood over `flags`/`floor`/`climb`. A cell whose
 * floor stands more than `DEEP` below the plain's own analytic height field is
 * IN A CUT — measured against `world.level.plainsY`, so it counts any hole
 * anybody digs, not a table of trench coordinates. Every one of them must carry
 * the same component id as the ground. One that does not is a man with a path
 * to nowhere, and A* will hand him an objective he cannot walk to.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 2. THE PLAYER — is there a way out that a capsule can climb?
 * ────────────────────────────────────────────────────────────────────────────
 * The component test is necessary and not sufficient: the grid is 0.8 m cells
 * and a way out one cell wide passes it while being a surface the player's
 * capsule shoulders off. So the exits are walked directly. `plains-trench.js`
 * publishes every one of them — both ramped mouths of every bay plus each bay's
 * sally ramp — with the direction it leads. This marches the real collision
 * surface out along each at 0.25 m and reports the largest single rise between
 * consecutive samples. Anything over `maxStep` 0.45 is a lip the capsule mantles
 * at best and stops dead at at worst.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4608/?map=plains';
/** Below this much of the plain, a cell is in a cut rather than in a hollow. */
const DEEP = Number(args.deep ?? 0.8);
const MAXSTEP = 0.45;

const { trenchExits } = await import('./src/world/levels/plains-trench.js');
const EXITS = trenchExits();
console.log(`${EXITS.length} ways out published by plains-trench.js`);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level.id=${level}`);
if (level !== 'plains') { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

const out = await p.evaluate(({ EXITS, DEEP, MAXSTEP }) => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const ph = e.ctx.peek('physics');
  const MASK = ph.MASK.WORLD;
  const g = ai.grid;
  const plainsY = e.ctx.peek('world').level.plainsY;
  g._label();
  const big = g.compSize.indexOf(g.biggestComponent);

  /* ---- 1. every cut cell in the biggest component --------------------- */
  let cut = 0, stranded = 0, walk = 0;
  const worst = [];
  for (let i = 0; i < g.flags.length; i++) {
    if (!g.flags[i]) continue;
    walk++;
    const x = g.xOf ? g.xOf(i) : null;
    // derive (x, z) from the grid's own layout without assuming a helper exists
    const ix = i % g.nx, iz = (i / g.nx) | 0;
    const wx2 = g.minX + (ix + 0.5) * g.cell;
    const wz2 = g.minZ + (iz + 0.5) * g.cell;
    const below = plainsY(wx2, wz2) - g.floor[i];
    if (below <= DEEP) continue;
    cut++;
    if (g.comp[i] !== big) {
      stranded++;
      if (worst.length < 20) worst.push([+wx2.toFixed(1), +wz2.toFixed(1), +below.toFixed(2)]);
    }
  }

  /* ---- 2. every published way out, walked ----------------------------- */
  const ground = (x, z) => {
    const h = ph.raycast(x, 120, z, 0, -1, 0, 200, MASK);
    return h.hit ? h.point.y : null;
  };
  const rows = [];
  for (const ex of EXITS) {
    let prev = null, rise = 0, at = 0, gap = false;
    for (let d = 0; d <= ex.run; d += 0.25) {
      const x = ex.x + ex.dx * d, z = ex.z + ex.dz * d;
      const y = ground(x, z);
      if (y === null) { gap = true; break; }
      if (prev !== null && y - prev > rise) { rise = y - prev; at = d; }
      prev = y;
    }
    rows.push({ id: ex.id, kind: ex.kind, x: +ex.x.toFixed(0), z: +ex.z.toFixed(0), rise: +rise.toFixed(3), at, gap });
  }
  return { walk, cut, stranded, worst, rows, comps: g.compSize.length, biggest: g.biggestComponent };
}, { EXITS, DEEP, MAXSTEP });

console.log(`\n  nav: ${out.walk} walkable, biggest component ${out.biggest}, ${out.comps} components`);
console.log(`  cells standing more than ${DEEP} m below the plain (i.e. IN A CUT): ${out.cut}`);
console.log(`  …of those, NOT in the biggest component: ${out.stranded}`);
for (const w of out.worst) console.log(`      stranded at (${w[0]}, ${w[1]}), ${w[2]} m down`);

const bad = out.rows.filter((r) => r.rise > MAXSTEP || r.gap);
console.log(`\n  ways out walked at 0.25 m: ${out.rows.length}`);
const rises = out.rows.map((r) => r.rise).sort((a, c) => c - a);
console.log(`  worst single rise ${rises[0]} m (limit ${MAXSTEP}); median ${rises[rises.length >> 1]} m`);
for (const r of bad) console.log(`      ${r.kind.padEnd(6)} ${r.id} at (${r.x},${r.z}) — ${r.gap ? 'NO GROUND on the way out' : `${r.rise} m step at ${r.at} m`}`);
console.log(bad.length ? `  ${bad.length} WAY(S) OUT FAIL` : '  every published way out is walkable');
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs[0]}` : '[pageerror] none');
await b.close();
process.exit(out.stranded || bad.length ? 1 : 0);
