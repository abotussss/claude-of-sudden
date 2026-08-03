/**
 * WITH EVERY BLOCK ERASED, IS ANYTHING LEFT HANGING WHERE ONE STOOD?
 *
 *   node _blockfloat.mjs [--url=…] [--seed=7]
 *
 * `_floatcheck.mjs --region=all` measures the map as it is BUILT, and this
 * feature erases at runtime — so the state it cannot see is the one that
 * matters: the hull has driven through all 28 free-standing blocks and anything
 * that was resting on one has nothing under it. 「浮いてる瓦礫」 is this
 * project's most repeated complaint and this is the version of it this change
 * could create.
 *
 * Erases every block, then over each one's own footprint asks the two questions
 * `_floatcheck` asks: is there any SOLID left standing clear of the road, and
 * is there any DRAWN instance left in the air.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true];
}));
const URL = args.url ?? 'http://127.0.0.1:4498/';
const SEED = args.seed ?? '7';

const b = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const out = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ph = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const M4 = e.camera.matrixWorld.constructor;
  const A = m.tank;
  if (!A?._blocks) return { err: 'no block atlas' };
  const list = A._blocks.list;

  /** Solid tops over a block's footprint, on a 0.4 m lattice. */
  const scan = (bl) => {
    const hits = [];
    for (let x = bl.minX + 0.2; x < bl.maxX; x += 0.4) {
      for (let z = bl.minZ + 0.2; z < bl.maxZ; z += 0.4) {
        const h = ph.raycast(new V3(x, bl.y + 30, z), new V3(0, -1, 0), 45, ph.MASK.WORLD);
        if (!h?.hit) continue;
        const top = bl.y + 30 - h.distance;
        if (top - bl.y > 0.5) hits.push({ h: +(top - bl.y).toFixed(2), x: +x.toFixed(2), z: +z.toFixed(2), s: h.surface ?? null });
      }
    }
    return hits;
  };

  /* drawn instances with air under them, over a block's own footprint */
  const mm = new M4(); const im = new M4();
  const airScan = () => {
    const air = [];
    e.ctx.scene.traverse((o) => {
      if (!o.isInstancedMesh || !o.visible) return;
      for (let j = 0; j < o.count; j++) {
        o.getMatrixAt(j, im);
        if (im.elements[0] === 0 && im.elements[5] === 0 && im.elements[10] === 0) continue;
        mm.multiplyMatrices(o.matrixWorld, im);
        const x = mm.elements[12], y = mm.elements[13], z = mm.elements[14];
        for (const bl of list) {
          if (x < bl.minX || x > bl.maxX || z < bl.minZ || z > bl.maxZ) continue;
          if (y - bl.y < 0.9) continue;
          const h = ph.raycast(new V3(x, y - 0.06, z), new V3(0, -1, 0), 40, ph.MASK.WORLD);
          const drop = h?.hit ? h.distance : 99;
          if (drop > 1.0) air.push(`${o.name}|${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`);
          break;
        }
      }
    });
    return air;
  };

  const airBefore = new Set(airScan());
  const before = list.map(scan);
  let broke = 0;
  for (const bl of list) {
    broke += A._breakBlocksAt((bl.minX + bl.maxX) / 2, bl.y + 1.0, (bl.minZ + bl.maxZ) / 2, 1.0);
  }
  const after = list.map(scan);

  const airAfter = airScan();
  const air = airAfter.filter((k) => !airBefore.has(k));

  return {
    airWas: airBefore.size, airNow: airAfter.length,
    blocks: list.length, broke,
    rows: list.map((bl, i) => ({
      x: +bl.x.toFixed(1), z: +bl.z.toFixed(1), top: +bl.top.toFixed(2),
      wasMax: before[i].length ? Math.max(...before[i].map((q) => q.h)) : 0,
      nowMax: after[i].length ? Math.max(...after[i].map((q) => q.h)) : 0,
      nowN: after[i].length,
      left: after[i].slice(0, 6),
      box: [+bl.minX.toFixed(1), +bl.maxX.toFixed(1), +bl.minZ.toFixed(1), +bl.maxZ.toFixed(1)],
    })),
    air,
  };
});

if (out.err) { console.log(out.err); await b.close(); process.exit(2); }
console.log(`\n  ${out.blocks} blocks, ${out.broke} erased\n`);
let bad = 0;
for (const r of out.rows) {
  const left = r.nowMax > 0.5;
  if (left) bad++;
  console.log(`  ${left ? 'LEFT' : 'gone'} [${String(r.x).padStart(7)},${String(r.z).padStart(7)}] ` +
    `top ${String(r.top).padStart(5)} -> highest solid over the road now ${String(r.nowMax).padStart(5)} ` +
    `(was ${String(r.wasMax).padStart(5)}, ${r.nowN} samples still standing)` +
    (left ? `\n         box [${r.box}] residual: ` + r.left.map((q) => `${q.h}m @ ${q.x},${q.z} ${q.s}`).join(' · ') : ''));
}
console.log(`\n  ${bad} block(s) left mass standing over their own footprint`);
console.log(`  drawn instances with over 1 m of air under them, inside a block box: ${out.airWas} before -> ${out.airNow} after, ${out.air.length} NEW:`);
for (const a of out.air.slice(0, 20)) console.log(`    ${a}`);
if (errs.length) console.log('  PAGEERRORS', errs.slice(0, 3));
console.log(`\n  ${bad === 0 && out.air.length === 0 ? 'PASS' : 'CHECK'}`);
await b.close();
