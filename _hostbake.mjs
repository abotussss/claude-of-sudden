/**
 * WHICH SITE STANDS ON WHICH DESTRUCTIBLE HOST — measured, never listed.
 *
 * For every airstrike site, take the settled pose of every chunk (already baked
 * at boot) plus the mound centre, and re-probe the plane under each one with
 * each destructible record swapped for its ruin, one at a time. A record whose
 * swap MOVES the plane under a chunk is that chunk's host, by measurement.
 *
 * Read-only: every swap is undone before the next one and the level is left in
 * the state it booted in.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
  })
);
const port = args.port ?? '4390';
const url = args.url ?? `http://127.0.0.1:${port}/${args.seed ? `?seed=${args.seed}` : ''}`;

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
p.on('console', (m) => {
  const t = m.text();
  if (/airstrike|demolition|cathedral/i.test(t)) console.log('  [page]', t);
});
p.on('pageerror', (e) => console.log('  [pageerror]', e.message));
await p.goto(url, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await p.evaluate(() => {
  const eng = window.__ENGINE__;
  const ctx = eng.ctx;
  const world = ctx.peek('world');
  const physics = ctx.peek('physics');
  const air = ctx.peek('match')?.airstrike;
  const THREE = window.THREE ?? null;

  const cands = [];
  for (const d of world.demolitions ?? []) {
    cands.push({ id: d.id, kind: 'demo', rec: d, set: (v) => d.setCollision(v) });
  }
  const k = world.cathedral;
  if (k?.setCollision) {
    cands.push({ id: 'CATHEDRAL', kind: 'cath', rec: k, set: (v) => k.setCollision(v, physics) });
  }
  for (const br of world.breaches ?? []) {
    cands.push({ id: `BREACH:${br.id}`, kind: 'breach', rec: br, set: (v) => br.setCollision(v) });
  }

  // Every point we care about: mound centres and every settled chunk position.
  const pts = [];
  for (const s of air.sites) {
    pts.push({ site: s.id, what: 'mound', i: -1, x: s.mound.x, z: s.mound.z, y: s.mound.y, top: s.roofY + 1 });
    for (let mi = 0; mi < s.meshes.length; mi++) {
      const m = s.meshes[mi];
      const set = m.userData.settled;
      const n = set.length / 16;
      for (let i = 0; i < n; i++) {
        pts.push({
          site: s.id, what: `mesh${mi}`, i,
          x: set[i * 16 + 12], y: set[i * 16 + 13], z: set[i * 16 + 14],
          top: s.roofY + 1,
        });
      }
    }
  }

  const probe = () => {
    const a = new Float64Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const g = physics.groundHeight(pts[i].x, pts[i].z, pts[i].top);
      a[i] = Number.isFinite(g) ? g : NaN;
    }
    return a;
  };

  const base = probe();
  const report = [];
  for (const c of cands) {
    c.set(true);
    const alt = probe();
    c.set(false);
    const bySite = new Map();
    for (let i = 0; i < pts.length; i++) {
      const d = base[i] - alt[i];
      if (!(Math.abs(d) > 0.05) && !(Number.isNaN(base[i]) !== Number.isNaN(alt[i]))) continue;
      const s = pts[i].site;
      if (!bySite.has(s)) bySite.set(s, { site: s, n: 0, maxDrop: 0, worst: null, mound: false });
      const e = bySite.get(s);
      e.n++;
      const drop = Number.isFinite(d) ? d : 999;
      if (drop > e.maxDrop) {
        e.maxDrop = drop;
        e.worst = { x: +pts[i].x.toFixed(2), y: +pts[i].y.toFixed(2), z: +pts[i].z.toFixed(2), was: +base[i].toFixed(2), now: +alt[i].toFixed(2) };
      }
      if (pts[i].what === 'mound') e.mound = true;
    }
    if (bySite.size) report.push({ host: c.id, kind: c.kind, sites: [...bySite.values()] });
  }

  return {
    seed: eng.levelSeed,
    sites: air.sites.map((s) => ({
      id: s.id, kind: s.kind, roofY: +s.roofY.toFixed(2), chunks: s.chunkCount,
      blocking: s.blocking, dropped: !!s.dropped, demo: s.demo ? s.demo.id ?? 'CATHEDRAL' : null,
      mound: [+s.mound.x.toFixed(2), +s.mound.y.toFixed(2), +s.mound.z.toFixed(2)],
      moundR: +s.moundR.toFixed(2),
    })),
    demos: (world.demolitions ?? []).map((d) => ({
      id: d.id, zone: d.zone, top: +d.top.toFixed(2), halfW: +d.halfW.toFixed(2), halfD: +d.halfD.toFixed(2),
      pos: [+d.position.x.toFixed(2), +d.position.z.toFixed(2)], down: d.down,
    })),
    cath: world.cathedral ? { top: +(world.cathedral.top ?? 0).toFixed(2), halfW: world.cathedral.halfW, halfD: world.cathedral.halfD } : null,
    breaches: (world.breaches ?? []).length,
    points: pts.length,
    report,
  };
});

console.log(JSON.stringify(out, null, 1));
await b.close();
