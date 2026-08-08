/**
 * ════════════════════════════════════════════════════════════════════════════
 * HOW MUCH OF THE PLAIN IS CUT, AND WHERE — the answer to 「塹壕が至る所にない」
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfcutmap.mjs [--url=http://127.0.0.1:4624/?map=plains] [--step=2]
 *
 * The complaint is not "there are no trenches" — the boot log has said 14 lines
 * and 627 m of cut since the network landed. It is "I never MEET one", and that
 * is a different measurement: a share of the ground, banded by radius, plus how
 * far a man walks along the routes between the places he is actually going
 * before the next cut is within reach.
 *
 * A cell is CUT when the collision surface stands more than `--deep` (0.8 m)
 * below `world.level.plainsY`, the plain's own analytic height field. Measured
 * that way it counts any hole anybody digs rather than a table of coordinates,
 * which is the same test `_nftrap.mjs` floods on.
 *
 * Three numbers come out and all three are what the user experiences:
 *   · CUT SHARE of the playable disc, and of the MIDDLE THIRD (r < 90) on its
 *     own — the ring-round-the-edge failure shows up as the second being zero
 *     while the first looks respectable.
 *   · REACH: the share of the disc within `--reach` (25 m) of some cut, i.e.
 *     how much of the plain has cover you could run to.
 *   · THE WALK: every route between two objectives, marched at 2 m, reporting
 *     the longest stretch with no cut inside `--reach` — the metres a man
 *     crosses knowing there is nothing to drop into.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4624/?map=plains';
const STEP = Number(args.step ?? 2);
const DEEP = Number(args.deep ?? 0.8);
const REACH = Number(args.reach ?? 25);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
const boot = [];
p.on('console', (m) => { const t = m.text(); if (/nachtfeld|trench|SPOKE/i.test(t)) boot.push(t); });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level.id=${level}`);
if (level !== 'plains') { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

const out = await p.evaluate(({ STEP, DEEP, REACH }) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const lvl = e.ctx.peek('world').level;
  const plainsY = lvl.plainsY;
  const R = 176;
  const N = Math.round((R * 2) / STEP) + 1;
  const ix = (v) => Math.round((v + R) / STEP);
  const wx = (i) => i * STEP - R;
  const cut = new Uint8Array(N * N);
  const live = new Uint8Array(N * N);
  let tot = 0, nCut = 0, totMid = 0, cutMid = 0;
  const bands = [];
  for (let i = 0; i < 6; i++) bands.push({ lo: i * 30, hi: i * 30 + 30, t: 0, c: 0 });
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = wx(i), z = wx(j);
      const r = Math.hypot(x, z);
      if (r > R) continue;
      const g = ph.groundHeight(x, z);
      const a = plainsY(x, z);
      if (!Number.isFinite(g) || !Number.isFinite(a)) continue;
      live[j * N + i] = 1;
      tot++;
      const isCut = a - g > DEEP;
      if (isCut) { cut[j * N + i] = 1; nCut++; }
      if (r < 90) { totMid++; if (isCut) cutMid++; }
      const bd = bands[Math.min(bands.length - 1, Math.floor(r / 30))];
      bd.t++; if (isCut) bd.c++;
    }
  }
  /* ---- reach: cells within REACH of some cut ---------------------------- */
  const k = Math.ceil(REACH / STEP);
  let near = 0, nearMid = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (!live[j * N + i]) continue;
      let hit = false;
      for (let dj = -k; dj <= k && !hit; dj++) {
        const j2 = j + dj; if (j2 < 0 || j2 >= N) continue;
        for (let di = -k; di <= k; di++) {
          const i2 = i + di; if (i2 < 0 || i2 >= N) continue;
          if (!cut[j2 * N + i2]) continue;
          if ((di * di + dj * dj) * STEP * STEP <= REACH * REACH) { hit = true; break; }
        }
      }
      if (hit) { near++; if (Math.hypot(wx(i), wx(j)) < 90) nearMid++; }
    }
  }
  /* ---- the walk between objectives -------------------------------------- */
  const P = {
    'BASE-N': [-14, -150], 'BASE-S': [14, 150],
    A: [-118, -104], B: [118, 104], C: [-128, 86], E: [128, -86], D: [0, 0],
  };
  const ROUTES = [
    ['BASE-N', 'A'], ['BASE-N', 'D'], ['BASE-N', 'E'],
    ['BASE-S', 'B'], ['BASE-S', 'D'], ['BASE-S', 'C'],
    ['A', 'D'], ['B', 'D'], ['C', 'D'], ['E', 'D'],
    ['A', 'C'], ['B', 'E'], ['A', 'E'], ['C', 'B'],
  ];
  const nearCut = (x, z) => {
    const i0 = ix(x), j0 = ix(z);
    for (let dj = -k; dj <= k; dj++) {
      const j2 = j0 + dj; if (j2 < 0 || j2 >= N) continue;
      for (let di = -k; di <= k; di++) {
        const i2 = i0 + di; if (i2 < 0 || i2 >= N) continue;
        if (cut[j2 * N + i2] && (di * di + dj * dj) * STEP * STEP <= REACH * REACH) return true;
      }
    }
    return false;
  };
  const walks = [];
  for (const [aId, bId] of ROUTES) {
    const A0 = P[aId], B0 = P[bId];
    const L = Math.hypot(B0[0] - A0[0], B0[1] - A0[1]);
    let worst = 0, cur = 0, dry = 0, n = 0;
    for (let s = 0; s <= L; s += 2) {
      const t = s / L;
      const x = A0[0] + (B0[0] - A0[0]) * t, z = A0[1] + (B0[1] - A0[1]) * t;
      n++;
      if (nearCut(x, z)) cur = 0;
      else { cur += 2; dry += 2; if (cur > worst) worst = cur; }
    }
    walks.push({ route: `${aId}->${bId}`, len: +L.toFixed(0), worst, dry: +((dry / (n * 2)) * 100).toFixed(0) });
  }
  /* ---- an ascii map, 4 m per char --------------------------------------- */
  const rows = [];
  for (let z = -172; z <= 172; z += 8) {
    let row = String(z).padStart(6) + '  ';
    for (let x = -172; x <= 172; x += 4) {
      if (Math.hypot(x, z) > R) { row += ' '; continue; }
      // any cut cell in the 4x8 box this char stands for
      let c = 0, l = 0;
      for (let dz = 0; dz < 8; dz += STEP) for (let dx = 0; dx < 4; dx += STEP) {
        const i = ix(x + dx), j = ix(z + dz);
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        if (live[j * N + i]) l++;
        if (cut[j * N + i]) c++;
      }
      row += c >= 2 ? '#' : c ? '+' : l ? '.' : ' ';
    }
    rows.push(row);
  }
  return {
    tot, nCut, totMid, cutMid, near, nearMid, bands, walks, rows,
    plainsRadius: R,
  };
}, { STEP, DEEP, REACH });

console.log(`\n  CUT SHARE      whole disc  ${out.nCut} / ${out.tot} = ${((out.nCut / out.tot) * 100).toFixed(2)} %`);
console.log(`                 middle third (r<90)  ${out.cutMid} / ${out.totMid} = ${((out.cutMid / out.totMid) * 100).toFixed(2)} %`);
console.log(`  WITHIN ${REACH} m OF A CUT   whole ${((out.near / out.tot) * 100).toFixed(1)} %   middle third ${((out.nearMid / out.totMid) * 100).toFixed(1)} %`);
console.log('\n  band          cells    cut     share');
for (const bd of out.bands) {
  if (!bd.t) continue;
  console.log(`  r ${String(bd.lo).padStart(3)}-${String(bd.hi).padStart(3)}  ${String(bd.t).padStart(7)}${String(bd.c).padStart(7)}   ${((bd.c / bd.t) * 100).toFixed(2)} %`);
}
console.log('\n  route between objectives, marched straight: longest stretch with NO cut within ' + REACH + ' m');
console.log('  route              len   longest dry   dry share');
for (const w of out.walks) {
  console.log(`  ${w.route.padEnd(16)}${String(w.len).padStart(5)}${String(w.worst).padStart(10)} m${String(w.dry).padStart(10)} %`);
}
const worstDry = Math.max(...out.walks.map((w) => w.worst));
const meanDry = out.walks.reduce((a, w) => a + w.dry, 0) / out.walks.length;
console.log(`  ————  worst dry stretch ${worstDry} m, mean dry share ${meanDry.toFixed(0)} %`);
console.log('\n  where the cut is  ("#" 2+ cut cells in the 4x8 m box, "+" one)\n');
for (const r of out.rows) console.log(r);
console.log('\n' + (boot.find((t) => /nachtfeld:/.test(t)) ?? '(no nachtfeld boot line)'));
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs[0]}` : '[pageerror] none');
await b.close();
