/**
 * WHY DOES THE FORTRESS'S RUIN STRAND ITS OWN COURTYARD?
 *
 *   node _nfgate.mjs [--url=…]
 *
 * `_nfstrand.mjs` measured it: firing NF-FORT takes 6204 cells at x -36..36,
 * z 12..84, floor 3.1..8.0 — the whole fortress interior, courtyard AND rampart
 * walk — out of the main nav component. The fort's own note says "its crown
 * comes off; the ways in do not change", so either the note is wrong or the nav
 * grid is.
 *
 * This walks the two gate passages cell by cell and prints, for each, what the
 * NAV GRID believes and what the PHYSICS WORLD actually contains — the same
 * capsule ladder `MatchSystem._reprobeZoneNav` uses. If physics says a man fits
 * and the grid says blocked, the grid is stale and a re-probe fixes it. If
 * physics says he does not fit, the ruin really is in the doorway.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4578/?map=plains';

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

/** Sample a line of cells and ask the grid and physics the same question. */
const scan = (label) => p.evaluate((label) => {
  const E = window.__ENGINE__;
  const g = E.ctx.peek('ai').grid;
  const ph = E.ctx.peek('physics');
  const MASK = ph.MASK.WORLD;
  const V = (x, y, z) => new (Object.getPrototypeOf(E.ctx.peek('match')._v).constructor)(x, y, z);
  const rows = [];
  // The two gate passages: the fort is at (0, 48) with R_OUT 30, gates on the
  // +/-Z flats, so the north way in is around z=18 and the south around z=78.
  for (const [name, z0, z1] of [['NORTH GATE', 8, 30], ['SOUTH GATE', 66, 88]]) {
    for (let z = z0; z <= z1; z += 2) {
      const x = 0;
      const ix = g.cellX(x), iz = g.cellZ(z);
      const i = g.index(ix, iz);
      const down = ph.raycast(x, 30, z, 0, -1, 0, 40, MASK);
      const gy = down.hit ? down.point.y : NaN;
      let fits = null;
      if (down.hit) {
        const a = V(x, gy + g.radius + 0.06, z);
        const bb = V(x, gy + g.height - g.radius, z);
        fits = ph.checkCapsule(a, bb, g.radius, MASK);
      }
      /**
       * …AND THE SAME QUESTION AT THE GRID'S OWN FLOOR, which is the one that
       * matters: if the ruin HANGS OVER the ground rather than filling it, a
       * man still fits down here and the top-down ray is describing a ceiling.
       * `low` is the ground under the overhang; `lowFits` is whether he stands.
       */
      /**
       * FROM 4.6 m, NOT FROM THE GRID'S OWN FLOOR. Starting at `floor[i] + 1.2`
       * on a cell the patch has already raised to 7.69 just finds 7.69 again —
       * the probe has to start UNDER the suspected overhang. 4.6 is a metre
       * over the plain around the fort (3.2) and four under the rampart walk.
       */
      const lowRay = ph.raycast(x, 4.6, z, 0, -1, 0, 3.0, MASK);
      const low = lowRay.hit ? +lowRay.point.y.toFixed(2) : null;
      let lowFits = null;
      if (lowRay.hit) {
        const a2 = V(x, lowRay.point.y + g.radius + 0.06, z);
        const b2 = V(x, lowRay.point.y + g.height - g.radius, z);
        lowFits = ph.checkCapsule(a2, b2, g.radius, MASK);
      }
      rows.push({ name, z, flag: g.flags[i], floor: +g.floor[i].toFixed(2), comp: g.comp[i], gy: +gy.toFixed(2), fits, indoor: g.indoor ? g.indoor[i] : -1, low, lowFits });
    }
  }
  g._label();
  const big = g.compSize.indexOf(g.biggestComponent);
  return { rows, big, label };
}, label);

const show = (r) => {
  console.log(`\n  ${r.label}   (main component id ${r.big})`);
  console.log('    gate          z    flag  grid floor   comp   ray y   fits   indoor   low y  fits low');
  for (const x of r.rows) {
    console.log(
      `    ${x.name.padEnd(11)} ${String(x.z).padStart(4)}   ${String(x.flag).padStart(3)}  ` +
        `${String(x.floor).padStart(9)}  ${String(x.comp).padStart(5)}  ${String(x.gy).padStart(6)}   ` +
        `${x.fits === null ? ' (none)' : x.fits ? '  YES' : '   no'}      ${x.indoor}    ` +
        `${String(x.low).padStart(6)}   ${x.lowFits === null ? '(none)' : x.lowFits ? 'YES' : ' no'}`
    );
  }
};

await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
for (let i = 0; i < 40; i++) {
  await wait(20);
  if (await p.evaluate(() => window.__ENGINE__.ctx.peek('match').airstrike?.enabled === true)) break;
}
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });
show(await scan('INTACT'));

await p.evaluate(() => window.__ENGINE__.ctx.peek('match').airstrike.callDemolition('NF-FORT'));
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 4; });
await p.waitForFunction(() => {
  const s = (window.__ENGINE__.ctx.peek('match').airstrike?.sites ?? []).find((s) => s.demo && s.id === 'NF-FORT');
  return !!s && s.baked === true;
}, null, { timeout: 120000 });
await wait(120);
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });
show(await scan('NF-FORT DOWN'));

console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 4).join(' | ')}` : '\n0 pageerrors');
await b.close();
