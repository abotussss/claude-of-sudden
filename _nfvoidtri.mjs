/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHICH TRIANGLES WERE SWITCHED OFF, AND WHOSE ARE THEY?
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfvoidtri.mjs [--url=…] [--run=420] [--scale=8]
 *
 * `_nfvoidwho.mjs` proved `StaticWorld.removeObject` is never called and the
 * plain loses ~950 of 22 700 floor cells anyway, so the ground is not being
 * REMOVED — its triangles' masks are being ZEROED in place. `src/match/tank.js`
 * does that in three places (the plough's piles, the raze atlas, and the block
 * demolition), each with a `trisWas` restore, and a triangle bound to the wrong
 * eraser is a piece of the floor that switches off when a hull drives over it.
 *
 * So: snapshot `sw.mask` at boot, play, diff it, and report every triangle that
 * went to zero — clustered on the ground plane, with the BVH OBJECT it belongs
 * to and, when the eraser can be identified, the pile or raze record that owns
 * it. `collide_dirt` is the terrain and the trench strips; anything of it in
 * this list is a hole in the world.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4624/?map=plains';
const RUN = Number(args.run ?? 420);
const SCALE = Number(args.scale ?? 8);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id=' + await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id));

await p.evaluate(() => {
  const sw = window.__ENGINE__.ctx.peek('physics').staticWorld;
  window.__MASK0__ = sw.mask.slice();
});
await p.evaluate((s) => { window.__ENGINE__.ctx.time.scale = s; }, SCALE);
await p.waitForTimeout(Math.ceil((RUN / SCALE) * 1000));

const out = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const sw = ph.staticWorld;
  const was = window.__MASK0__;
  const pos = sw.pos;
  /**
   * `StaticWorld.build` writes an OBJECT ID PER TRIANGLE into `sw.object[]`, so
   * the owner is a lookup and not a search over ranges. Reconstructing it from
   * `objects[i].start/count` returned -1 for all 13 483 — those fields do not
   * exist on the record; `id` and `triCount` do, and the packed array is
   * authoritative anyway because the pack order is the alive order.
   */
  const byId = new Map(sw.objects.filter((o) => o).map((o) => [o.id, o.mesh?.name ?? '(unnamed)']));
  const objName = (t) => {
    const id = sw.object[t];
    return { id, name: byId.get(id) ?? '(gone)' };
  };
  const off = [];
  for (let t = 0; t < sw.triCount; t++) if (was[t] && !sw.mask[t]) off.push(t);
  const byObj = new Map();
  const groundOff = [];
  for (const t of off) {
    const o = objName(t);
    const k = `${o.id} ${o.name}`;
    byObj.set(k, (byObj.get(k) ?? 0) + 1);
    if (o.name === 'collide_dirt') {
      const q = t * 9;
      groundOff.push([
        +(((pos[q] + pos[q + 3] + pos[q + 6]) / 3)).toFixed(1),
        +(((pos[q + 2] + pos[q + 5] + pos[q + 8]) / 3)).toFixed(1),
        +(((pos[q + 1] + pos[q + 4] + pos[q + 7]) / 3)).toFixed(2),
      ]);
    }
  }
  /* ---- which eraser owns the ground triangles that went off ------------ */
  const tank = e.ctx.peek('match')?.tank;
  const owners = [];
  const offSet = new Set(off);
  for (const t of tank?.tanks ?? []) {
    let n = 0, piles = 0;
    for (const pile of t.plough ?? []) {
      let m = 0;
      for (const tt of pile.tris ?? []) if (offSet.has(tt)) m++;
      if (m) { piles++; n += m; }
    }
    if (n) owners.push({ who: `${t.id ?? '?'} plough`, n, piles });
  }
  return {
    total: off.length,
    byObj: [...byObj].sort((a, c) => c[1] - a[1]),
    groundOff: groundOff.length,
    all: groundOff,
    sample: groundOff.slice(0, 10),
    owners,
    phase: e.ctx.peek('match')?.phase ?? '?',
    razeKeys: Object.keys(tank ?? {}).filter((k) => /raze|block|_raze/i.test(k)),
  };
});
console.log(`\n  phase=${out.phase}   ${out.total} triangles went from live to mask 0`);
console.log('  by BVH object:');
for (const [k, n] of out.byObj) console.log(`    ${String(n).padStart(7)}   ${k}`);
console.log(`\n  of which collide_dirt (the terrain AND the trench strips): ${out.groundOff}`);
for (const s of out.sample) console.log(`    (${s[0]}, ${s[1]}) y=${s[2]}`);
console.log('\n  erasers that own some of them:');
for (const o of out.owners) console.log(`    ${o.who}: ${o.n} triangles across ${o.piles} pile(s)`);
console.log('  tank keys of interest: ' + out.razeKeys.join(', '));

/**
 * …AND HOW MUCH OF IT IS TRENCH. The strip mesh is sampled at 0.3 m across and
 * 1 m along, so ITS triangles are well under `RAZE_TRI` = 2.6 m while the
 * plain's own 3.18 m terrain quads are over it. That asymmetry means the cut is
 * bindable ground where the plain is not, and it decides whether lacing more
 * trench across the map makes this worse.
 */
{
  const { trenchLines } = await import('./src/world/levels/plains-trench.js');
  const axes = trenchLines();
  const near = (x, z) => {
    let best = 1e9, who = null;
    for (const t of axes) for (const [px, pz] of t.pts) {
      const d = Math.hypot(x - px, z - pz);
      if (d < best) { best = d; who = t.name; }
    }
    return { d: best, who };
  };
  let inStrip = 0; const byLine = new Map();
  for (const [x, z] of out.all) {
    const n = near(x, z);
    if (n.d <= 11.5) { inStrip++; byLine.set(n.who, (byLine.get(n.who) ?? 0) + 1); }
  }
  console.log(`\n  of the ${out.groundOff} erased ground triangles, ${inStrip} lie within STRIP_R (11.5 m) of a trench axis`);
  for (const [k, n] of [...byLine].sort((a, c) => c[1] - a[1])) console.log(`    ${String(n).padStart(5)}  ${k}`);
}
console.log(errs.length ? `\n[pageerror] ${errs.length}: ${errs[0]}` : '\n[pageerror] none');
await b.close();
