/**
 * WHAT ARE THE CUBES IN FRONT OF THE CATHEDRAL ENTRANCE, AND WHY WILL THE HULL
 * NOT ERASE THEM?
 *
 *   node _cubewhy.mjs [--seed=7] [--r=14]
 *
 * Stands on the parvis outside the south front (the great portal), dumps every
 * `?boxtag` collision proxy in front of it in WORLD space, and answers, per
 * proxy, the two questions the tank's plough actually asks:
 *
 *   height over its own ground   -> PLOUGH_MIN(0.3) < h <= PLOUGH_TOP(3.0)?
 *   a `prop_*` instance inside it -> can `match` erase it at all?
 *
 * Needs the DEV server so the stacks name a file.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true];
}));
const URL = args.url ?? 'http://127.0.0.1:4498/';
const SEED = args.seed ?? '7';
const R = Number(args.r ?? 14);

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('  pageerror', String(e.message).slice(0, 200)));
await page.goto(`${URL}?seed=${SEED}&boxtag`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const out = await page.evaluate(({ R }) => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const w = ctx.peek('world');
  const phys = ctx.peek('physics');
  const tag = w.A?.constructor?.TAG;
  if (!tag) return { err: 'Assembler.TAG not armed' };
  const V3 = e.camera.position.constructor;
  const M4 = e.camera.matrixWorld.constructor;

  /* cathedral south front, in level space: cz - d/2, on the axis */
  const k = w.cathedral;
  // level centre of the cathedral, from the published interior volume
  const lc = w.worldToLevel(k.cx, 0, k.cz, new V3());
  const HD = 45 / 2;
  // a point on the parvis 4 m south of the front wall, on the axis
  const front = w.levelToWorld(lc.x, 0, lc.z - HD, new V3());
  const stand = w.levelToWorld(lc.x, 0, lc.z - HD - 4.5, new V3());

  /* every prop instance in the level, world space */
  const props = [];
  const mm = new M4(); const im = new M4();
  ctx.scene.traverse((o) => {
    if (!o.isInstancedMesh || !/^prop_/.test(o.name)) return;
    for (let j = 0; j < o.count; j++) {
      o.getMatrixAt(j, im);
      mm.multiplyMatrices(o.matrixWorld, im);
      props.push({ name: o.name, x: mm.elements[12], y: mm.elements[13], z: mm.elements[14] });
    }
  });

  const rows = [];
  for (const b of tag) {
    if (b.wx === undefined) continue;
    const hx = Math.abs(b.sx * Math.cos(b.wry)) / 2 + Math.abs(b.sz * Math.sin(b.wry)) / 2;
    const hz = Math.abs(b.sx * Math.sin(b.wry)) / 2 + Math.abs(b.sz * Math.cos(b.wry)) / 2;
    const dx = b.wx - stand.x, dz = b.wz - stand.z;
    if (Math.hypot(dx, dz) > R + Math.max(hx, hz)) continue;
    if (b.wy - b.sy / 2 > 6) continue;
    const line = String(b.at).split('\n').slice(1)
      .map((s) => s.trim())
      .find((s) => !/builder\.js/.test(s)) ?? '?';
    // ground under it, and how tall it stands over that ground
    const gy = phys.groundHeight(b.wx + hx + 0.8, b.wz, 40);
    const base = Number.isFinite(gy) ? gy : 0;
    const top = b.wy + b.sy / 2;
    const standH = top - base;
    const near = props.filter((q) =>
      Math.abs(q.x - b.wx) < Math.max(1.6, hx + 0.6) &&
      Math.abs(q.z - b.wz) < Math.max(1.6, hz + 0.6) &&
      q.y > base - 1.5 && q.y < top + 1.5);
    rows.push({
      k: b.k, s: b.surface, scope: b.scope ?? null,
      x: +b.wx.toFixed(2), y: +b.wy.toFixed(2), z: +b.wz.toFixed(2),
      lx: +b.cx.toFixed(2), lz: +b.cz.toFixed(2),
      sx: +b.sx.toFixed(2), sy: +b.sy.toFixed(2), sz: +b.sz.toFixed(2),
      bot: +(b.wy - b.sy / 2).toFixed(2), top: +top.toFixed(2),
      standH: +standH.toFixed(2), base: +base.toFixed(2),
      cube: Math.max(b.sx, b.sy, b.sz) / Math.max(0.01, Math.min(b.sx, b.sy, b.sz)) < 2.6,
      inst: near.length, instNames: [...new Set(near.map((q) => q.name))].slice(0, 3),
      d: +Math.hypot(dx, dz).toFixed(1),
      src: line.replace(/^at\s+/, '').replace(/https?:\/\/[^/]+\//, ''),
    });
  }
  return {
    total: tag.length, propCount: props.length,
    front: [+front.x.toFixed(2), +front.z.toFixed(2)],
    stand: [+stand.x.toFixed(2), +stand.z.toFixed(2)],
    cathedral: { cx: +k.cx.toFixed(2), cz: +k.cz.toFixed(2) },
    breaches: (w.breaches ?? []).map((b) => ({ id: b.id, x: +b.position.x.toFixed(1), z: +b.position.z.toFixed(1), reach: b.reach, strength: b.strength })),
    rows,
  };
}, { R });

if (out.err) { console.log(out.err); await browser.close(); process.exit(2); }
console.log(`\n  ${out.total} proxies, ${out.propCount} prop instances`);
console.log(`  cathedral centre world [${out.cathedral.cx}, ${out.cathedral.cz}]`);
console.log(`  south front world [${out.front}]   standing at [${out.stand}]`);
console.log(`\n  ${out.rows.length} proxies within ${R} m of the entrance:\n`);
out.rows.sort((a, b) => a.d - b.d);
for (const r of out.rows.slice(0, Number(args.max ?? 60))) {
  console.log(
    `  d${String(r.d).padStart(5)} ${r.k.padEnd(4)} ${String(r.s).padEnd(10)} ` +
    `c[${String(r.x).padStart(7)},${String(r.y).padStart(6)},${String(r.z).padStart(7)}] ` +
    `s[${String(r.sx).padStart(5)},${String(r.sy).padStart(5)},${String(r.sz).padStart(5)}] ` +
    `L[${String(r.lx).padStart(7)},${String(r.lz).padStart(7)}] ` +
    `stand ${String(r.standH).padStart(6)} ${r.cube ? 'CUBE' : '    '} ` +
    `inst=${String(r.inst).padStart(2)} ${String(r.instNames.join(',')).padEnd(22)} ` +
    `${String(r.scope ?? '-').padEnd(12)} ${r.src}`);
}
if (out.rows.length > Number(args.max ?? 60)) console.log(`  … ${out.rows.length - Number(args.max ?? 60)} more`);
console.log(`\n  breaches published by world: ${out.breaches.length}`);
for (const b of out.breaches) console.log(`    ${b.id} [${b.x},${b.z}] reach ${b.reach} strength ${b.strength}`);
await browser.close();
