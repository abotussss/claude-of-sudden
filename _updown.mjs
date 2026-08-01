/**
 * CAN A SNIPER GET DOWN AGAIN? — and did this boot use the seed I asked for?
 *
 *   node _updown.mjs --url=http://127.0.0.1:4297/?seed=7
 *
 * `NavGrid` is a 2.5D height field and the direction that historically fails is
 * DOWN: a cell on a roof is perfectly walkable and a 6.4 m drop off it is not a
 * step, so a man sent up is a man who stays there. The sniper's cover search is
 * filtered by `grid.comp` — the connected-component label A* itself uses — and
 * this proves what that filter buys, rather than asserting it:
 *
 *   1. Echo `levelSeed`, so a run can never report a seed it did not measure.
 *   2. Split every LIVE cover point by height and by whether it shares a
 *      component with any square a bot actually stands on (spawns, zone stand
 *      rings, live agents). That is the set the sniper is allowed to choose
 *      from.
 *   3. For every ELEVATED point in that allowed set, run A* BOTH WAYS — from a
 *      bot's own square up to the point, and from the point back down to the
 *      square. A one-way answer is the bug; two-way is the proof.
 *   4. Do the same for a sample of elevated points the filter REFUSES, so the
 *      refusal is shown to be load-bearing rather than decorative.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  // Split on the FIRST `=` only — `--url=…/?seed=7` must not become `…/?seed`.
  const s = a.replace(/^--/, ''), i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 480 } });
await p.goto(args.url ?? 'http://127.0.0.1:4297/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

console.log(JSON.stringify(await p.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const m = e.ctx.peek('match');
  const g = ai.grid;
  const V = e.ctx.camera.position.constructor;

  /** Squares a bot is actually on: spawns, zone stand rings, live agents. */
  const anchors = [];
  const comps = new Set();
  const add = (v) => {
    const i = g.index(g.cellX(v.x), g.cellZ(v.z));
    if (g.comp && g.comp[i] >= 0) { comps.add(g.comp[i]); anchors.push({ v, c: g.comp[i] }); }
  };
  for (const s of [...(m.spawns?.attack ?? []), ...(m.spawns?.defend ?? [])]) add(s.position);
  for (const z of m.sites ?? []) { add(z.position); for (const s of z.stand ?? []) add(s); }
  for (const a of ai.agents) if (a.alive) add(a.position);

  const band = (y) => (y < 0.6 ? 'ground' : y < 2.5 ? 'lo(0.6-2.5)' : y < 5 ? 'mid(2.5-5)' : 'high(5+)');
  const split = {};
  const allowedHigh = [];
  const refusedHigh = [];
  for (const c of ai.cover.points) {
    const ok = comps.has(g.comp[c.cell]);
    const k = `${band(c.y)}/${ok ? 'SNIPER MAY PICK' : 'refused by comp'}`;
    split[k] = (split[k] ?? 0) + 1;
    if (c.y >= 0.6) (ok ? allowedHigh : refusedHigh).push(c);
  }

  /** A* both ways between `from` and the cover point. */
  const path = [];
  const two = (c) => {
    let anchor = null, bestD = Infinity;
    for (const a of anchors) {
      const d = (a.v.x - c.x) ** 2 + (a.v.z - c.z) ** 2;
      if (d < bestD) { bestD = d; anchor = a; }
    }
    if (!anchor) return null;
    const pt = new V(c.x, c.y, c.z);
    const up = g.findPath(anchor.v, pt, path);
    const down = g.findPath(pt, anchor.v, path);
    return { y: +c.y.toFixed(2), from: +Math.sqrt(bestD).toFixed(1), up, down };
  };

  const tried = allowedHigh.map(two).filter(Boolean);
  const refused = refusedHigh.filter((_, i) => i % Math.ceil(refusedHigh.length / 40) === 0).map(two).filter(Boolean);
  const tally = (rows) => ({
    n: rows.length,
    bothWays: rows.filter((r) => r.up > 0 && r.down > 0).length,
    upOnly: rows.filter((r) => r.up > 0 && r.down <= 0).length,
    downOnly: rows.filter((r) => r.up <= 0 && r.down > 0).length,
    neither: rows.filter((r) => r.up <= 0 && r.down <= 0).length,
    maxY: rows.length ? Math.max(...rows.map((r) => r.y)) : null,
  });

  return {
    levelSeed: e.levelSeed ?? e.ctx?.levelSeed ?? null,
    url: location.href,
    coverPoints: ai.cover.points.length,
    coverByHeightAndWhetherTheSniperMayPickIt: split,
    elevatedTheSniperMayPick: tally(tried),
    elevatedTheComponentFilterRefuses: tally(refused),
    sampleAllowed: tried.slice(0, 8),
    sampleRefused: refused.slice(0, 8),
  };
}), null, 1));
await b.close();
