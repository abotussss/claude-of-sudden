/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE SAME CROSSING, WALKED BY A MAN WHO USES THE TRENCH
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nftrenchwalk.mjs [--url=http://127.0.0.1:4608/?map=plains] [--detour=1.35]
 *
 * `_plaincross.mjs` marches a chest down the STRAIGHT LINE between two places
 * and asks whether the line to him is clear. That is the right question and it
 * is the only one that file can ask, because the straight line is the only route
 * it knows — and it is exactly the question a trench cannot answer well. A cut
 * dug six metres off a walk is invisible to it twice over: the walker never
 * enters it, AND `plainsOpen` refuses the corridor, so `plains-cover.js` may not
 * stand a wreck on the centreline there either. That file says so itself:
 * "the trench IS the covered route there, and this file may no more build across
 * it than it may pitch a stall in the cathedral."
 *
 * So the crossing measured that way gets WORSE when a trench lands beside it,
 * and both numbers are true. This file measures the other one.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE WALK, AND WHY IT IS NOT AN INVENTED ROUTE
 * ────────────────────────────────────────────────────────────────────────────
 * The metric is `_plaincross`'s, unchanged and copied rather than reimplemented:
 * a standing eye at 1.62, a chest at 1.20 marched along the route, `lane` =
 * metres forward plus metres back to the first man you can see, `exposed` at
 * over 120 m of lane, `run` the longest continuous exposed stretch. What changes
 * is the polyline it is measured along.
 *
 * For each of the twelve crossings, the candidates are:
 *   · the DIRECT line — what `_plaincross` measures, reported here as `direct`
 *   · for every bay in the network, P -> that bay's mouth -> along the cut ->
 *     the far mouth -> Q, in both directions
 * A candidate is admissible only if it is no longer than `--detour` (1.35) times
 * the direct distance, because a man will walk a third further to be under a
 * parapet and will not walk twice as far. Of the admissible ones the walk with
 * the LOWEST MEAN LANE is chosen, which is the route a man who does not want to
 * be shot actually takes.
 *
 * `under` is the share of the walk whose ground stands more than 0.8 m below the
 * plain's own analytic height field — i.e. how much of the crossing is made
 * inside a cut. It is measured against `world.level.plainsY`, not against a
 * table of trench coordinates, so it counts any hole anybody digs.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4608/?map=plains';
const DETOUR = Number(args.detour ?? 1.35);

const { trenchBays } = await import('./src/world/levels/plains-trench.js');
const BAYS = trenchBays().map((b) => ({ name: b.name, pts: b.pts }));
console.log(`${BAYS.length} bays offered to the walk`);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level=${level}`);
if (level !== 'plains') { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

const out = await p.evaluate(({ BAYS, DETOUR }) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const MASK = ph.MASK.WORLD;
  const plainsY = e.ctx.peek('world').level.plainsY;
  const EYE = 1.62, CHEST = 1.2, STEP = 2.0, MARCH = 4, CAP = 320, OPEN = 120;

  const P = {
    'BASE-N': [-14, -150], 'BASE-S': [14, 150],
    A: [-118, -104], B: [118, 104], C: [-128, 86], E: [128, -86], D: [0, 0],
  };
  const ROUTES = [
    ['BASE-N', 'A'], ['BASE-N', 'D'], ['BASE-N', 'E'],
    ['BASE-S', 'B'], ['BASE-S', 'D'], ['BASE-S', 'C'],
    ['A', 'D'], ['B', 'D'], ['C', 'D'], ['E', 'D'],
    ['A', 'C'], ['B', 'E'],
  ];
  const groundAt = (x, z) => {
    const h = ph.raycast(x, 300, z, 0, -1, 0, 400, MASK);
    return h.hit ? h.point.y : null;
  };

  /** Resample a polyline at `STEP`, dropping the first and last 18 m (the pads). */
  const profile = (poly) => {
    let L = 0;
    const seg = [];
    for (let i = 0; i < poly.length - 1; i++) {
      const d = Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
      seg.push(d); L += d;
    }
    const prof = [];
    for (let s = 0; s <= L + 1e-6; s += STEP) {
      let t = s, i = 0;
      while (i < seg.length - 1 && t > seg[i]) { t -= seg[i]; i++; }
      const u = seg[i] ? t / seg[i] : 0;
      const x = poly[i][0] + (poly[i + 1][0] - poly[i][0]) * u;
      const z = poly[i][1] + (poly[i + 1][1] - poly[i][1]) * u;
      const g = groundAt(x, z);
      prof.push(g === null ? null : { x, z, g, s, under: plainsY(x, z) - g });
    }
    return { prof, L };
  };

  const seen = (x, y, z, i0, sign, prof, cap) => {
    const k = MARCH / STEP;
    for (let d = MARCH, j = i0 + sign * k; d <= cap; d += MARCH, j += sign * k) {
      if (j < 0 || j >= prof.length) return d;
      const q = prof[j];
      if (!q) return d;
      const dx = q.x - x, dy = q.g + CHEST - y, dz = q.z - z;
      const len = Math.hypot(dx, dy, dz);
      const h = ph.raycast(x, y, z, dx / len, dy / len, dz / len, len - 0.15, MASK);
      if (h.hit) return d;
    }
    return cap;
  };

  const score = (poly) => {
    const { prof, L } = profile(poly);
    const s0 = 18, s1 = L - 18;
    const samples = [];
    for (let i = 0; i < prof.length; i++) {
      const q = prof[i];
      if (!q || q.s < s0 || q.s > s1) continue;
      const y = q.g + EYE;
      samples.push({
        lane: seen(q.x, y, q.z, i, 1, prof, CAP) + seen(q.x, y, q.z, i, -1, prof, CAP),
        under: q.under > 0.8,
      });
    }
    if (!samples.length) return null;
    const n = samples.length;
    let run = 0, cur = 0;
    for (const v of samples) { if (v.lane > OPEN) { cur += STEP; if (cur > run) run = cur; } else cur = 0; }
    return {
      len: L, n,
      lane: samples.reduce((a, v) => a + v.lane, 0) / n,
      exposed: samples.filter((v) => v.lane > OPEN).length / n,
      under: samples.filter((v) => v.under).length / n,
      run,
    };
  };

  const rows = [];
  for (const [aId, bId] of ROUTES) {
    const A0 = P[aId], B0 = P[bId];
    const direct = Math.hypot(B0[0] - A0[0], B0[1] - A0[1]);
    const dScore = score([A0, B0]);
    let best = null, bestBay = null;
    for (const bay of BAYS) {
      for (const rev of [false, true]) {
        const line = rev ? [...bay.pts].reverse() : bay.pts;
        const head = line[0], tail = line[line.length - 1];
        let L = Math.hypot(head[0] - A0[0], head[1] - A0[1]);
        for (let i = 0; i < line.length - 1; i++) L += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
        L += Math.hypot(B0[0] - tail[0], B0[1] - tail[1]);
        if (L > direct * DETOUR) continue;
        const s = score([A0, ...line, B0]);
        if (!s) continue;
        if (!best || s.lane < best.lane) { best = s; bestBay = bay.name; }
      }
    }
    rows.push({ route: `${aId}->${bId}`, direct: dScore, best, bay: bestBay });
  }
  return rows;
}, { BAYS, DETOUR });

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
console.log('\n                    ——— DIRECT (what _plaincross measures) ———   ——— THROUGH THE NETWORK ———');
console.log(' route            len   lane  exp   run  under      len   lane  exp   run  under   via');
console.log(' ' + '-'.repeat(104));
let dl = 0, bl = 0, dr = 0, br = 0, du = 0, bu = 0, k = 0, used = 0;
for (const r of rows(out)) console.log(r);
function rows(list) {
  const out2 = [];
  for (const r of list) {
    const d = r.direct;
    const b2 = r.best ?? d;
    if (r.best) used++;
    k++; dl += d.lane; bl += b2.lane; dr = Math.max(dr, d.run); br = Math.max(br, b2.run); du += d.under; bu += b2.under;
    out2.push(` ${pad(r.route, 14)}${num(d.len.toFixed(0), 5)}${num(d.lane.toFixed(0), 7)}${num((d.exposed * 100).toFixed(0) + '%', 5)}${num(d.run.toFixed(0), 6)}${num((d.under * 100).toFixed(0) + '%', 7)}` +
      `   ${num(b2.len.toFixed(0), 7)}${num(b2.lane.toFixed(0), 7)}${num((b2.exposed * 100).toFixed(0) + '%', 5)}${num(b2.run.toFixed(0), 6)}${num((b2.under * 100).toFixed(0) + '%', 7)}   ${r.bay ?? '—'}`);
  }
  return out2;
}
console.log(' ' + '-'.repeat(104));
console.log(` ${pad('MEAN', 14)}${num('', 5)}${num((dl / k).toFixed(0), 7)}${num('', 5)}${num(dr.toFixed(0), 6)}${num(((du / k) * 100).toFixed(0) + '%', 7)}` +
  `   ${num('', 7)}${num((bl / k).toFixed(0), 7)}${num('', 5)}${num(br.toFixed(0), 6)}${num(((bu / k) * 100).toFixed(0) + '%', 7)}   ${used}/${k} crossings have a cut worth the detour`);
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs[0]}` : '[pageerror] none');
await b.close();
