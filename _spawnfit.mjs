/**
 * DOES THE BIGGER CLUSTER ACTUALLY FIT?
 *
 * `SPAWNS` grew from five ranks of three to seven when the roster went to 20 a
 * side, and the two new ranks sit 1.2 units off the N2/S2 sheds and 8.9 units
 * from a `KEEPOUT` circle of 9.5 — both close enough that "it should be fine"
 * is not an answer. This asks the running level three things per point:
 *
 *   • did `walkable()` RELOCATE it? (it mutates the point on to the nearest nav
 *     cell within 3 m, so a point in a wall silently becomes a point elsewhere —
 *     the distance from the authored position is the tell)
 *   • how far is it from its nearest neighbour, i.e. did the pitch tighten?
 *   • how much clear nav ground does it have around it, at 1.5 m?
 *
 * and then reports the live roster so 20v20 is a measurement and not a hope.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4277/';
const SEED = process.argv[3] ?? null;
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1${SEED != null ? `&seed=${SEED}` : ''}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const r = await page.evaluate(async () => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), ai = e.ctx.peek('ai'), w = e.ctx.peek('world');
  const g = ai.grid;
  // The roster does not exist at __READY__ — the warm-up spawns it. Wait.
  const t0 = performance.now();
  while (m.phase !== 'live' && performance.now() - t0 < 60000) await new Promise((rr) => requestAnimationFrame(rr));
  const out = {};
  for (const key of ['attack', 'defend']) {
    const list = m.spawns[key];
    const ATT = key === 'attack';
    const rows = list.map((sp, i) => {
      const p = sp.position;
      // Nearest walkable cell to where the point ended up — 0 m means it IS one.
      const ci = g.nearest(p.x, p.z, p.y, 3, 1.2);
      let nearest = Infinity;
      for (let j = 0; j < list.length; j++) {
        if (j === i) continue;
        const q = list[j].position;
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d < nearest) nearest = d;
      }
      // Clear nav ground in a 1.5 m ring: sample 12 bearings.
      let clear = 0;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const x = p.x + Math.cos(a) * 1.5, z = p.z + Math.sin(a) * 1.5;
        if (g.nearest(x, z, p.y, 0.6, 1.2) >= 0) clear++;
      }
      // How far `walkable()` DRAGGED this point off where it was authored. The
      // baked list does not keep its level coordinate, so the authored lattice
      // is rebuilt here from the same two constants sites.js uses (SCALE 1.5,
      // x ∓6 / 0, ranks 2.2 apart) and run through `levelToWorld`.
      const cols = [-6, 0, 6];
      const zs = ATT ? [68.7, 66.9, 65.1, 63.3, 61.5, 59.7, 57.9]
        : [-70.7, -68.9, -67.1, -65.3, -63.5, -61.7, -59.9];
      const a = w.levelToWorld(cols[i % 3] * 1.5, 0, zs[(i / 3) | 0] * 1.5, p.clone());
      const moved = Math.hypot(p.x - a.x, p.z - a.z);
      return { i, onGrid: ci >= 0, nearest: +nearest.toFixed(2), clear12: clear,
        moved: +moved.toFixed(2), lz: zs[(i / 3) | 0], lx: cols[i % 3],
        x: +p.x.toFixed(1), z: +p.z.toFixed(1), y: +p.y.toFixed(2) };
    });
    out[key] = { n: list.length, rows };
  }
  out.roster = { rosterUs: m.hud?.rosterUs ?? null, rosterThem: m.hud?.rosterThem ?? null,
    agents: ai.agents.length, alive: ai.agents.filter((a) => a.alive).length,
    names: ai.agents.map((a) => a.name) };
  out.dupNames = (() => {
    const seen = new Set(), dup = [];
    for (const n of out.roster.names) { if (seen.has(n)) dup.push(n); seen.add(n); }
    return dup;
  })();
  out.seed = e.levelSeed;
  out.warnings = null;
  return out;
});

console.log(`\n  seed ${r.seed}`);
for (const key of ['attack', 'defend']) {
  const s = r[key];
  const offGrid = s.rows.filter((x) => !x.onGrid);
  const tight = s.rows.filter((x) => x.nearest < 1.6);
  const boxed = s.rows.filter((x) => x.clear12 < 8);
  console.log(`  ${key.toUpperCase()} cluster: ${s.n} points · off-grid ${offGrid.length} · nearest-neighbour < 1.6 m: ${tight.length} · fewer than 8/12 clear bearings: ${boxed.length}`);
  const near = s.rows.map((x) => x.nearest).sort((a, c) => a - c);
  console.log(`     neighbour spacing  min ${near[0]} m  median ${near[near.length >> 1]} m  max ${near[near.length - 1]} m`);
  for (const x of s.rows) {
    console.log(
      `     #${String(x.i).padStart(2)} L(${String(x.lx).padStart(3)},${String(x.lz).padStart(6)})` +
        `  moved ${String(x.moved).padStart(5)} m  nn ${String(x.nearest).padStart(5)} m` +
        `  clear ${x.clear12}/12  y ${x.y}`
    );
  }
}
console.log(`\n  ROSTER hud ${r.roster.rosterUs}v${r.roster.rosterThem} · ai agents ${r.roster.agents} · alive ${r.roster.alive}`);
console.log(`  duplicate callsigns: ${r.dupNames.length ? r.dupNames.join(', ') : 'none'}`);
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
