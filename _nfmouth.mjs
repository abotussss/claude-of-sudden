/**
 * THE FORTRESS'S TWO GATE MOUTHS, AS A PICTURE, BEFORE AND AFTER THE RAZE.
 *
 *   node _nfmouth.mjs [--url=…]
 *
 * `_nfgate.mjs` walked x=0 through each passage and found ONE cell at each
 * mouth that goes from 3.2 to 7.7 when the ruin lands. One cell on one line is
 * not enough to know whether the way in is CHOKED or merely narrowed — a gate
 * is 4.6 m wide and A* is perfectly happy to go round a boulder.
 *
 * So this prints the whole mouth as a grid of floor heights and, under it, the
 * connectivity answer: is the courtyard in the same component as the ground?
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

const scan = () => p.evaluate(() => {
  const g = window.__ENGINE__.ctx.peek('ai').grid;
  g._label();
  const big = g.compSize.indexOf(g.biggestComponent);
  const out = [];
  for (const [name, z0, z1] of [['NORTH', 10, 28], ['SOUTH', 68, 86]]) {
    const rows = [];
    for (let z = z0; z <= z1; z += 0.8) {
      const cells = [];
      for (let x = -6; x <= 6; x += 0.8) {
        const i = g.index(g.cellX(x), g.cellZ(z));
        cells.push({ f: g.flags[i], y: g.floor[i], c: g.comp[i], in: g.indoor ? g.indoor[i] : 0 });
      }
      rows.push({ z: +z.toFixed(1), cells });
    }
    out.push({ name, rows });
  }
  // Is the courtyard floor in the main component?
  const ci = g.index(g.cellX(0), g.cellZ(40));
  return { out, big, court: g.comp[ci], courtFloor: +g.floor[ci].toFixed(2), courtFlag: g.flags[ci] };
});

const show = (label, r) => {
  console.log(`\n  ${label} — main component ${r.big}; courtyard (0,40) floor ${r.courtFloor} flag ${r.courtFlag} component ${r.court} ` +
    `${r.court === r.big ? '✓ CONNECTED' : '✗ STRANDED'}`);
  for (const gate of r.out) {
    console.log(`\n    ${gate.name} MOUTH   x -6 .. +6, one char per 0.8 m cell`);
    console.log('        z      ' + '-6.....-3......0......3......6');
    for (const row of gate.rows) {
      const s = row.cells.map((c) => {
        if (!c.f) return '#';                       // blocked
        if (c.c !== r.big) return '!';              // walkable but stranded
        if (c.in) return c.y < 5 ? 'o' : 'O';       // interior carve, low / high
        return c.y < 5 ? '.' : '^';                 // outdoor low / outdoor high
      }).join('');
      console.log(`      ${String(row.z).padStart(5)}   ${s}`);
    }
  }
  console.log('\n      . outdoor floor <5 m   ^ outdoor floor >=5 m   o/O interior carve   # blocked   ! walkable but not in the main component');
};

await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
for (let i = 0; i < 40; i++) {
  await wait(20);
  if (await p.evaluate(() => window.__ENGINE__.ctx.peek('match').airstrike?.enabled === true)) break;
}
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });
show('INTACT', await scan());

await p.evaluate(() => window.__ENGINE__.ctx.peek('match').airstrike.callDemolition('NF-FORT'));
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 4; });
await p.waitForFunction(() => {
  const s = (window.__ENGINE__.ctx.peek('match').airstrike?.sites ?? []).find((s) => s.demo && s.id === 'NF-FORT');
  return !!s && s.baked === true;
}, null, { timeout: 120000 });
await wait(120);
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });
show('NF-FORT DOWN', await scan());

console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 4).join(' | ')}` : '\n0 pageerrors');
await b.close();
