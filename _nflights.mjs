/**
 * EVERY LIGHT ON THE PLAIN, AND WHAT IT DELIVERS TO A GIVEN POINT.
 *
 *   node _nflights.mjs [x] [z] [--url=…]
 *
 * The `fortress` frame comes back with saturated red ground at a point where
 * this level's own five fires deliver 0.68x the moon, which is a warm EDGE and
 * nothing like what is in the picture. Either the arithmetic is wrong or
 * something else is lighting it — and on a map where four other agents are
 * adding burning wrecks, barrages and smoke, "something else" is the likely
 * answer and it needs a name rather than a suspicion.
 *
 * So this walks the whole scene graph rather than `level.fires`, and reports
 * every light that reaches the point, sorted by what it actually delivers.
 */
import { chromium } from 'playwright';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const X = Number(args[0] ?? 0), Z = Number(args[1] ?? 96);
const URL = (process.argv.find((a) => a.startsWith('--url=')) ?? '--url=http://127.0.0.1:4603/?map=plains&capture=1').slice(6);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await p.evaluate(() => (window.__ENGINE__.time.scale = 6));
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await p.evaluate(() => { window.__ENGINE__.time.scale = 1; });

const out = await p.evaluate(([X, Z]) => {
  const e = window.__ENGINE__, lvl = e.ctx.peek('world').level;
  const y = lvl.groundY(X, Z) + 1.0;
  const rows = [];
  e.ctx.scene.traverse((o) => {
    if (!o.isLight || !o.visible || o.intensity <= 0) return;
    const c = o.color;
    if (o.isDirectionalLight) {
      rows.push({ kind: 'dir', name: o.name || '(dir)', parent: o.parent?.name ?? null,
        E: +o.intensity.toFixed(4), i: +o.intensity.toFixed(3), dist: null,
        colour: `${c.r.toFixed(2)},${c.g.toFixed(2)},${c.b.toFixed(2)}` });
      return;
    }
    if (!o.isPointLight && !o.isSpotLight) return;
    const wp = o.getWorldPosition(new (e.camera.position.constructor)());
    const d = Math.hypot(wp.x - X, wp.y - y, wp.z - Z);
    const w = o.distance > 0 ? (d >= o.distance ? 0 : Math.max(0, 1 - (d / o.distance) ** 4) ** 2) : 1;
    const E = (o.intensity * w) / Math.max(d * d, 1);
    if (E < 1e-4) return;
    rows.push({ kind: o.isSpotLight ? 'spot' : 'point', name: o.name || '(point)', parent: o.parent?.name ?? null,
      E: +E.toFixed(4), i: +o.intensity.toFixed(1), dist: +d.toFixed(1), range: o.distance,
      colour: `${c.r.toFixed(2)},${c.g.toFixed(2)},${c.b.toFixed(2)}` });
  });
  rows.sort((a, z) => z.E - a.E);
  let nLights = 0; e.ctx.scene.traverse((o) => { if (o.isLight) nLights++; });
  return { at: [X, +y.toFixed(2), Z], nLights, rows: rows.slice(0, 18) };
}, [X, Z]);

console.log(`\n  at (${out.at.join(', ')}) — ${out.nLights} lights in the scene\n`);
console.log('    kind   name                      delivered E   intensity   dist    range   colour');
for (const r of out.rows) {
  console.log(`    ${r.kind.padEnd(6)} ${String(r.name).slice(0, 24).padEnd(24)} ${String(r.E).padStart(11)}   ` +
    `${String(r.i).padStart(9)}   ${String(r.dist ?? '-').padStart(5)}   ${String(r.range ?? '-').padStart(5)}   ${r.colour}`);
}
console.log(errs.length ? `\nPAGEERRORS(${errs.length}) ${errs[0]}` : '\n0 pageerrors');
await b.close();
