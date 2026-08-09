/**
 * DUMP THE PLAIN'S OWN ANSWERS — `isOpen`, `groundY` and the cover solver's
 * station list — so a placement table can be derived against the map that
 * exists rather than against a description of it.
 *
 *   node _nfground.mjs [--url=…] [--cell=2] [--out=path.json]
 *
 * `plains-ruins.ANCHORS` was first derived from the three trench lines named in
 * `src/match/tank.js`'s header. The trench network is THIRTY-ONE lines and 999 m
 * of cut, `trenchKeepOut()` feeds every one of them into `plainsOpen`, and the
 * first build off that table stood up nine shells of sixteen with 6 633 refusals
 * on `isOpen` alone. A second-hand model of the map is not a model of the map.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4635/?map=plains&covertag=1';
const CELL = Number(args.cell ?? 2);
const OUT = args.out ?? '/tmp/nfground.json';

const b = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 700, height: 420 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
let tag = '';
p.on('console', (m) => { const t = m.text(); if (t.includes('cover sites:')) tag = t; });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level.id=${level}`);
if (level !== 'plains') { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

const grid = await p.evaluate((CELL) => {
  const w = window.__ENGINE__.ctx.peek('world');
  const R = 176, n = Math.floor((R * 2) / CELL) + 1;
  const openA = new Uint8Array(n * n);
  const gyA = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -R + i * CELL, z = -R + j * CELL;
      openA[j * n + i] = w.isOpen(x, z, 1.2) ? 1 : 0;
      gyA[j * n + i] = w.groundHeight(x, z);
    }
  }
  return { n, cell: CELL, R, open: Array.from(openA), gy: Array.from(gyA, (v) => +v.toFixed(2)) };
}, CELL);

/** The stations the crossing and ring solvers stood up: `kind@x,z`. */
const sites = [];
const m = tag.match(/cover sites: (.*)$/);
if (m) {
  for (const tok of m[1].trim().split(/\s+/)) {
    const mm = tok.match(/^([a-z]+)@(-?\d+),(-?\d+)$/);
    if (mm) sites.push({ kind: mm[1], x: +mm[2], z: +mm[3] });
  }
}
console.log(`grid ${grid.n}x${grid.n} at ${CELL} m · open ${grid.open.reduce((a, c) => a + c, 0)} cells · ${sites.length} cover sites`);
writeFileSync(OUT, JSON.stringify({ ...grid, sites }));
console.log(`-> ${OUT}`);
if (errs.length) console.log('PAGE ERRORS', errs.length, errs.slice(0, 3));
await b.close();
