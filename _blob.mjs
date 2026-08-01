/**
 * BLOB / FIRETEAM PROBE — "AI全員が行動経路が一緒で同じ動きだとゲーム性が悪い".
 *
 * Measures, per side, how much of it is one crowd:
 *   nnMean      mean nearest-neighbour distance (m). A blob is small.
 *   clumpMax    most men inside one 8 m radius at any sample.
 *   spread      RMS distance from the side's own centroid (m).
 *   routes      distinct destination cells the side is walking to (8 m buckets).
 *   objs        distinct objective points handed out.
 * …and the nav facts task 2 needs: components, biggest, roof cells, and how
 * many cells above 2.5 m share a component with a man standing on the ground.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4355/';
const SAMPLES = +(args.samples ?? 30);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', (e) => console.log('  PAGEERROR', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await wait(120);

await p.evaluate(() => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  window.__B__ = { n: 0, side: [[], []] };
  window.__T__ = () => {
    const S = window.__B__; S.n++;
    for (let team = 0; team < 2; team++) {
      const men = ai.agents.filter((a) => a.alive && a.team === team);
      if (men.length < 4) continue;
      let nn = 0, spread = 0, clump = 0;
      let cx = 0, cz = 0;
      for (const m of men) { cx += m.position.x; cz += m.position.z; }
      cx /= men.length; cz /= men.length;
      for (const m of men) {
        let best = Infinity, near = 0;
        for (const o of men) {
          if (o === m) continue;
          const d = Math.hypot(o.position.x - m.position.x, o.position.z - m.position.z);
          if (d < best) best = d;
          if (d < 8) near++;
        }
        nn += best;
        if (near + 1 > clump) clump = near + 1;
        spread += (m.position.x - cx) ** 2 + (m.position.z - cz) ** 2;
      }
      const routes = new Set(), objs = new Set(), fts = new Set();
      let via = 0, adv = 0;
      for (const m of men) {
        if (m.hasMoveTarget) routes.add(`${Math.round(m.moveTarget.x / 8)},${Math.round(m.moveTarget.z / 8)}`);
        if (m.objective) objs.add(`${Math.round(m.objective.position.x / 4)},${Math.round(m.objective.position.z / 4)}`);
        if (m.fireteam) fts.add(m.fireteam.id);
        if (m._hasVia) via++;
        if (m.state === 'advance') adv++;
        const c = `${Math.round(m.position.x / 12)},${Math.round(m.position.z / 12)}`;
        S.lanes = S.lanes || [new Set(), new Set()];
        S.lanes[team].add(c);
      }
      S.side[team].push({
        men: men.length,
        nn: nn / men.length,
        clump,
        spread: Math.sqrt(spread / men.length),
        routes: routes.size,
        objs: objs.size,
        fts: fts.size,
        via,
        adv,
      });
    }
  };
});
for (let i = 0; i < SAMPLES; i++) { await wait(10); await p.evaluate(() => window.__T__()); }

const r = await p.evaluate(() => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  const g = ai.grid;
  const avg = (rows, k) => rows.length ? rows.reduce((s, x) => s + x[k], 0) / rows.length : 0;
  const mx = (rows, k) => rows.length ? Math.max(...rows.map((x) => x[k])) : 0;
  const out = { sides: [], nav: null, squads: null };
  for (let t = 0; t < 2; t++) {
    const rows = window.__B__.side[t];
    out.sides.push({
      samples: rows.length,
      men: Math.round(avg(rows, 'men')),
      nnMean: +avg(rows, 'nn').toFixed(2),
      clumpMax: mx(rows, 'clump'),
      spread: +avg(rows, 'spread').toFixed(1),
      routes: +avg(rows, 'routes').toFixed(1),
      objs: +avg(rows, 'objs').toFixed(1),
      fireteams: +avg(rows, 'fts').toFixed(1),
      onLane: +avg(rows, 'via').toFixed(1),
      advancing: +avg(rows, 'adv').toFixed(1),
      cellsWalked: (window.__B__.lanes && window.__B__.lanes[t] ? window.__B__.lanes[t].size : 0),
    });
  }
  // ---- nav facts -------------------------------------------------------
  const n = g.flags.length;
  let walk = 0, high = 0;
  // "the ground" = the components the men are actually standing on, plus every
  // component bigger than a twentieth of the biggest (the map's two halves).
  const groundComps = new Set();
  for (const a of ai.agents) {
    if (!a.alive) continue;
    const i = g.nearest(a.position.x, a.position.z, a.position.y, 4, 2.0);
    if (i >= 0 && g.comp[i] >= 0) groundComps.add(g.comp[i]);
  }
  for (let c = 0; c < g.components; c++) if (g.compSize[c] >= g.biggestComponent * 0.05) groundComps.add(c);
  let highReach = 0, highEscape = 0;
  for (let i = 0; i < n; i++) {
    if (!g.flags[i]) continue;
    walk++;
    if (g.floor[i] > 2.5) {
      high++;
      const c = g.comp[i];
      if (groundComps.has(c)) highReach++;
      else if (g.escape && g.escape.length && groundComps.has(g.escape[c])) highEscape++;
    }
  }
  out.nav = {
    cells: n, walkable: walk, components: g.components, biggest: g.biggestComponent,
    highCells: high, highWalkable: highReach, highCanGetDown: highEscape,
    groundComps: groundComps.size,
    drops: g.dropEdges ?? -1, climbs: g.climbEdges ?? -1,
    escapeComps: g.escapeComps ?? -1, climbMs: +(g.climbMs ?? 0).toFixed(1),
    buildMs: +(g.buildMs ?? 0).toFixed(0),
  };
  out.squads = ai.squads.map((s) => ({
    id: s.id, team: s.team, members: s.members.length,
    fireteams: s.fireteams ? s.fireteams.length : -1,
  }));
  out.levelSeed = window.__ENGINE__.levelSeed;
  return out;
});
console.log(JSON.stringify(r, null, 1));
await b.close();
