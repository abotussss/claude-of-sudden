/**
 * WHAT, EXACTLY, GETS STRANDED WHEN THE PLAIN'S STRUCTURES COME DOWN?
 *
 *   node _nfstrand.mjs [--url=…] [--fire=NF-TOWER,NF-FORT] [--min=40]
 *
 * `_nfcomp.mjs` counts stranded cells and that is enough to know there IS a
 * regression; it is not enough to fix one. This prints every stranded component
 * over `--min` cells with its EXTENT and its FLOOR HEIGHT, which is what tells
 * a rampart walk (a ring at 4.4 m round the fortress) from a podium deck (a
 * disc at 12 m over the tower) from the twelve cells on top of a rock that were
 * never reachable in the first place.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4578/?map=plains';
const FIRE = args.fire === undefined ? [] : String(args.fire).split(',').filter(Boolean);
const MIN = Number(args.min ?? 40);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

const measure = (min) => p.evaluate((min) => {
  const g = window.__ENGINE__.ctx.peek('ai').grid;
  g._label();
  const big = g.compSize.indexOf(g.biggestComponent);
  /** id -> {n, x0,x1,z0,z1, y0,y1} over every cell not in the main component. */
  const by = new Map();
  let walk = 0;
  for (let i = 0; i < g.flags.length; i++) {
    if (!g.flags[i]) continue;
    walk++;
    const c = g.comp[i];
    if (c === big) continue;
    const cx = i % g.nx;
    const cz = (i / g.nx) | 0;
    const x = g.minX + cx * g.cell;
    const z = g.minZ + cz * g.cell;
    const y = g.floor[i];
    let e = by.get(c);
    if (!e) by.set(c, (e = { n: 0, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, y0: 1e9, y1: -1e9 }));
    e.n++;
    if (x < e.x0) e.x0 = x; if (x > e.x1) e.x1 = x;
    if (z < e.z0) e.z0 = z; if (z > e.z1) e.z1 = z;
    if (y < e.y0) e.y0 = y; if (y > e.y1) e.y1 = y;
  }
  const out = [...by.values()].filter((e) => e.n >= min).sort((a, b) => b.n - a.n).slice(0, 12);
  return { walk, big: g.biggestComponent, comps: g.components, stranded: walk - g.biggestComponent, out };
}, min);

const show = (label, r) => {
  console.log(`\n  ${label}: walkable ${r.walk}, biggest ${r.big}, stranded ${r.stranded} in ${r.comps} components`);
  console.log('      cells      x range          z range          floor y');
  for (const e of r.out) {
    console.log(
      `    ${String(e.n).padStart(7)}   ${e.x0.toFixed(0).padStart(5)}..${e.x1.toFixed(0).padEnd(5)}   ` +
        `${e.z0.toFixed(0).padStart(5)}..${e.z1.toFixed(0).padEnd(5)}   ${e.y0.toFixed(1)}..${e.y1.toFixed(1)}`
    );
  }
  if (!r.out.length) console.log(`    (nothing over ${MIN} cells)`);
};

await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
for (let i = 0; i < 40; i++) {
  await wait(20);
  if (await p.evaluate(() => window.__ENGINE__.ctx.peek('match').airstrike?.enabled === true)) break;
}
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });
show('boot (intact)', await measure(MIN));

for (const id of FIRE) {
  const fired = await p.evaluate((id) => window.__ENGINE__.ctx.peek('match').airstrike?.callDemolition?.(id) ?? false, id);
  /**
   * WAIT FOR `baked`, NOT FOR A FRAME COUNT. `_bakeSettled` is what flips the
   * collision and applies the nav patch, and a fixed `wait(400)` returned before
   * it on a run that fired only one site — so the probe measured an INTACT map
   * and printed it under the heading "NF-FORT down". @see `_floatcheck.mjs`'s
   * own note about exactly this ("came back clean by construction").
   */
  await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 4; });
  await p.waitForFunction(
    (id) => {
      const s = (window.__ENGINE__.ctx.peek('match').airstrike?.sites ?? []).find((s) => s.demo && s.id === id);
      return !!s && s.baked === true;
    },
    id,
    { timeout: 300000 }
  );
  await wait(120);
  await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });
  show(`${id} down${fired ? '' : ' (DECLINED)'}`, await measure(MIN));
}
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 4).join(' | ')}` : '\n0 pageerrors');
await b.close();
