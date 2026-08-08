/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THE TWO ERASERS BOUND AT BOOT, AND WHICH OF IT IS FLOOR
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfvoidbind.mjs [--url=…]
 *
 * `_nfvoidtri.mjs` needs a whole match to answer "whose triangle was that", and
 * a match is 53 s of wall clock per question. Every binding it reports on was
 * decided AT BOOT, though — `_bindPloughCollision` and `_buildRazeAtlas` both
 * run once in `build()` and never again — so the same question can be asked of
 * the atlas itself in two seconds, which is what makes a fix iterable.
 *
 * For every triangle either eraser owns this prints: the BVH object it belongs
 * to, whether it is FLOOR (up-facing and with nothing solid under it, so
 * removing it opens the void a man falls through), and, for the ones that are,
 * their height over `world.groundHeight` and their plan size. That last pair is
 * what any rule of the shape "it must rise above what it stands on" has to
 * separate, and it is the numbers the rule's constant gets chosen from.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4627/?map=plains';

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id=' + await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id));

const out = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const world = e.ctx.peek('world');
  const sw = ph.staticWorld;
  const pos = sw.pos;
  const tank = e.ctx.peek('match')?.tank;
  const byId = new Map(sw.objects.filter((o) => o).map((o) => [o.id, o.mesh?.name ?? '(unnamed)']));

  /** owner[t] = 'plough' | 'raze' | 'block' */
  const owner = new Map();
  let nPlough = 0, nRaze = 0, nBlock = 0;
  for (const t of tank?.tanks ?? []) {
    for (const pile of t.plough ?? []) {
      for (const tt of pile.tris ?? []) { owner.set(tt, 'plough'); nPlough++; }
    }
  }
  for (const rec of tank?._atlas?.recs ?? []) {
    for (const tt of rec.tris ?? []) { if (!owner.has(tt)) { owner.set(tt, 'raze'); nRaze++; } }
  }
  if (tank?._blockTri) for (let t = 0; t < sw.triCount; t++) if (tank._blockTri[t]) { if (!owner.has(t)) owner.set(t, 'block'); nBlock++; }

  const raw = {};
  const tally = new Map();
  const floors = [];
  for (const [t, who] of owner) {
    const o = t * 9;
    const x0 = pos[o], y0 = pos[o + 1], z0 = pos[o + 2];
    const x1 = pos[o + 3], y1 = pos[o + 4], z1 = pos[o + 5];
    const x2 = pos[o + 6], y2 = pos[o + 7], z2 = pos[o + 8];
    const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3, cz = (z0 + z1 + z2) / 3;
    // up-facing?
    const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
    const bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const L = Math.hypot(nx, ny, nz) || 1;
    ny /= L;
    const up = Math.abs(ny); // the BVH does not promise a winding, so |ny|
    // is there anything solid UNDER it?
    const lo = Math.min(y0, y1, y2);
    const under = sw.raycast(cx, lo - 0.03, cz, 0, -1, 0, 400, ph.MASK.CHARACTER, raw);
    const isFloor = up > 0.5 && !under;
    const k = `${who}  ${byId.get(sw.object[t]) ?? '?'}`;
    let e2 = tally.get(k);
    if (!e2) tally.set(k, (e2 = { n: 0, floor: 0 }));
    e2.n++;
    if (isFloor) {
      e2.floor++;
      const g = world.groundHeight(cx, cz);
      floors.push({
        who, obj: byId.get(sw.object[t]) ?? '?',
        x: +cx.toFixed(1), z: +cz.toFixed(1), y: +cy.toFixed(2),
        rise: Number.isFinite(g) ? +(Math.max(y0, y1, y2) - g).toFixed(2) : null,
        w: +Math.max(Math.max(x0, x1, x2) - Math.min(x0, x1, x2), Math.max(z0, z1, z2) - Math.min(z0, z1, z2)).toFixed(2),
        h: +(Math.max(y0, y1, y2) - lo).toFixed(2),
        up: +up.toFixed(2),
      });
    }
  }
  return {
    nPlough, nRaze, nBlock,
    tally: [...tally].sort((a, c) => c[1].floor - a[1].floor),
    floors: floors.length,
    sample: floors.slice(0, 12),
    riseHist: (() => {
      const h = new Map();
      for (const f of floors) {
        const k = f.rise === null ? 'no ground' : (Math.round(f.rise * 5) / 5).toFixed(1);
        h.set(k, (h.get(k) ?? 0) + 1);
      }
      return [...h].sort((a, c) => c[1] - a[1]).slice(0, 22);
    })(),
    razeBound: nRaze,
  };
});

console.log(`\n  bound at boot:  plough ${out.nPlough}   raze ${out.nRaze}   block ${out.nBlock}`);
console.log(`  of those, ${out.floors} are FLOOR (up-facing with NOTHING under them)\n`);
console.log('  eraser / BVH object                                       bound      floor');
for (const [k, v] of out.tally) console.log(`    ${k.padEnd(52)} ${String(v.n).padStart(7)}  ${String(v.floor).padStart(9)}`);
console.log('\n  height of the FLOOR triangles over world.groundHeight (top vertex):');
for (const [k, n] of out.riseHist) console.log(`    ${String(k).padStart(9)} m   ${n}`);
console.log('\n  sample:');
for (const s of out.sample) console.log(`    ${s.who.padEnd(7)} ${s.obj.padEnd(30)} (${s.x}, ${s.z}) y=${s.y} rise=${s.rise} plan=${s.w} tall=${s.h} |ny|=${s.up}`);
console.log(errs.length ? `\n[pageerror] ${errs.length}: ${errs[0]}` : '\n[pageerror] none');
await b.close();
