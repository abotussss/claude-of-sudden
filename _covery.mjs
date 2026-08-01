/** What elevation and what indoor share does the LIVE cover table actually have?
 *  A "prefer high ground and buildings" rule is only implementable if the baked
 *  points contain any. Read-only. */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 480 } });
await p.goto(args.url ?? 'http://127.0.0.1:4293/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log(JSON.stringify(await p.evaluate(() => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  const w = window.__ENGINE__.ctx.peek('world');
  const g = ai.grid;
  const pts = ai.cover.points;
  const ys = pts.map((q) => q.y).sort((a, c) => a - c);
  const q = (f) => +ys[Math.min(ys.length - 1, Math.floor(ys.length * f))].toFixed(2);
  const V = window.__ENGINE__.ctx.camera.position.constructor;
  const t = new V();
  const B = (w.layout?.BUILDINGS ?? []).filter((x) => x.enterable);
  let inFoot = 0, high = 0;
  for (const c of pts) {
    w.worldToLevel(c.x, c.y, c.z, t);
    for (const x of B) {
      if (Math.abs(t.x - x.x) < x.w / 2 - 0.6 && Math.abs(t.z - x.z) < x.d / 2 - 0.6) { inFoot++; break; }
    }
    if (c.y > ys[ys.length >> 1] + 1.0) high++;
  }
  /**
   * THE ONLY QUESTION THAT MATTERS FOR "PREFER HIGH GROUND": is any of that
   * elevation in the component a bot on the street can actually walk to? The
   * grid samples from above, so a roof is a perfectly walkable cell at 6.5 m —
   * and a 6.4 m step from the pavement is not a step, so it is its own island.
   * `grid.comp` is the label A* already uses. Bucket the live cover points by
   * whether they share the biggest component, and by height.
   */
  const big = (() => {
    let id = -1, n = -1;
    for (let i = 0; i < (g.compSize?.length ?? 0); i++) if (g.compSize[i] > n) { n = g.compSize[i]; id = i; }
    return id;
  })();
  /**
   * "Biggest component" is the wrong yardstick on a map whose ground is cut
   * into several large pieces by a compound wall. The honest test is the one
   * the AI will make: the component a MAN IS STANDING IN. So collect the
   * components every spawn point and every zone stand point sits in — that is
   * where bots actually are — and score cover against that set.
   */
  const m = window.__ENGINE__.ctx.peek('match');
  const live = new Set();
  const addAt = (v) => {
    const i = g.index(g.cellX(v.x), g.cellZ(v.z));
    if (g.comp && g.comp[i] >= 0) live.add(g.comp[i]);
  };
  for (const s of [...(m.spawns?.attack ?? []), ...(m.spawns?.defend ?? [])]) addAt(s.position);
  for (const z of m.sites ?? []) { addAt(z.position); for (const s of z.stand ?? []) addAt(s); }
  for (const a of ai.agents) if (a.alive) addAt(a.position);
  const liveComps = [...live];
  const reach = {};
  for (const c of pts) {
    const inLive = live.has(g.comp[c.cell]);
    const band = c.y < 0.6 ? 'ground' : c.y < 2.5 ? 'lo(0.6-2.5)' : c.y < 5 ? 'mid(2.5-5)' : 'high(5+)';
    const k = `${band}/${inLive ? 'BOT-REACHABLE' : 'island'}`;
    reach[k] = (reach[k] ?? 0) + 1;
  }
  const buckets = {};
  for (const c of pts) {
    const same = g.comp[c.cell] === big;
    const band = c.y < 0.6 ? 'ground' : c.y < 2.5 ? 'lo(0.6-2.5)' : c.y < 5 ? 'mid(2.5-5)' : 'high(5+)';
    const k = `${band}/${same ? 'reachable' : 'island'}`;
    buckets[k] = (buckets[k] ?? 0) + 1;
  }
  return {
    points: pts.length, all: ai.cover.all.length,
    components: g.components, biggestComponent: g.biggestComponent,
    coverByHeightAndComponent: buckets,
    liveComponents: liveComps.length,
    coverByHeightVsWhereBotsStand: reach,
    y: { min: q(0), p10: q(0.1), p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(0.999) },
    coverInsideEnterableFootprint: inFoot,
    coverMoreThan1mAboveMedian: high,
    gridInteriorCells: g.interiorCells, gridWalkable: g.walkableCount,
    enterable: B.map((x) => x.id),
    volumes: (w.interiorVolumes ?? []).map((v) => ({ id: v.id ?? null, floorY: +(v.floorY ?? 0).toFixed(2), hw: v.hw, hd: v.hd })),
  };
}), null, 1));
await b.close();
