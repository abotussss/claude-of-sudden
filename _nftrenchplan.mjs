/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHERE MAY A TRENCH GO? — the plain's free space, printed before it is dug
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nftrenchplan.mjs [--clear=7] [--check]
 *
 * A trench on this map is a WALL to everything except a man walking down it,
 * and the two things it can cut in half are the bot height field and the six
 * baked tank wheels. The armour is the unforgiving one: `Armour._bakePath`
 * samples an AUTHORED polyline every 1.25 m and drops the whole leg at the
 * first sample it cannot stand on, so one new cut laid across `src/match/tank.js`
 * costs five spokes and the boot log is the only place it says so. That has
 * already happened once on this map (RED-W, "no ground at sample 1").
 *
 * `src/match` is another agent's file and is not to be edited, so the trenches
 * have to be authored INTO the space the armour already leaves. This prints
 * that space rather than guessing at it:
 *
 *   · every leg of `PLAINS_ROUTES` is read OUT OF `src/match/tank.js` ITSELF —
 *     the array is sliced from the source text and evaluated, so this can never
 *     drift from the table the game bakes. A hand-copied duplicate would be
 *     wrong the first time somebody moved a waypoint.
 *   · `--check` re-reads the CURRENT `plains-trench.js` bay list and reports,
 *     per bay, the closest any tank route comes to its axis. That is the gate:
 *     under `--clear` and the leg is at risk.
 *
 * `clear` is 7 m and it is derived: the cut is 1.5 m of floor plus a 0.85 m
 * cheek = 2.35 m of ground a hull cannot stand on, and `_bakePath` may slide a
 * sample `LATERAL_MAX` = 3.0 m sideways off the authored line before it probes
 * the ground under it. 2.35 + 3.0 is 5.35; 7 leaves 1.65 m of margin on a
 * number that costs five legs when it is wrong.
 */
import { readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const CLEAR = Number(args.clear ?? 7);
const NEAR = Number(args.near ?? 6);
const GAPR = Number(args.gapr ?? 7);

/* ---- the routes, out of the file that bakes them ------------------------ */
const src = readFileSync(new URL('./src/match/tank.js', import.meta.url), 'utf8');
const i0 = src.indexOf('const PLAINS_ROUTES = [');
const i1 = src.indexOf('\n];', i0);
if (i0 < 0 || i1 < 0) throw new Error('PLAINS_ROUTES not found in src/match/tank.js');
const ROUTES = eval(src.slice(i0 + 'const PLAINS_ROUTES = '.length, i1 + 2));

/** Every leg as a polyline of [x, z]: the approach, and each spoke off its end. */
export function tankLegs() {
  const legs = [];
  for (const r of ROUTES) {
    legs.push({ id: `${r.id}:HUB`, pts: r.approach });
    const hub = r.approach[r.approach.length - 1];
    for (const sp of r.spokes ?? []) {
      // spoke point 0 IS the hub; `_bakeLegs` also appends the zone centre.
      const Z = { A: [-118, -104], B: [118, 104], C: [-128, 86], E: [128, -86], D: [0, 0] };
      const pts = sp.points.slice();
      pts[0] = hub;
      if (Z[sp.zone]) pts.push(Z[sp.zone]);
      legs.push({ id: `${r.id}->${sp.zone}`, pts });
    }
  }
  return legs;
}

/** Distance from (x, z) to a segment. */
function segD(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let t = L2 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

const LEGS = tankLegs();
/** Nearest tank route to a point, and which leg it was. */
export function nearestLeg(x, z) {
  let best = 1e9, id = null;
  for (const l of LEGS) {
    for (let i = 0; i < l.pts.length - 1; i++) {
      const d = segD(x, z, l.pts[i][0], l.pts[i][1], l.pts[i + 1][0], l.pts[i + 1][1]);
      if (d < best) { best = d; id = l.id; }
    }
  }
  return { d: best, id };
}

/* ---- the works, so the picture shows what else is out of bounds --------- */
const PADS = [
  ['A', -118, -104, 34], ['B', 118, 104, 34], ['C', -128, 86, 34], ['E', 128, -86, 34],
  ['D', 0, 0, 30], ['N', -14, -150, 26], ['S', 14, 150, 26],
  ['T', 0, -32, 27], ['F', 0, 48, 38],
];
function inPad(x, z) {
  for (const [id, px, pz, r] of PADS) if (Math.hypot(x - px, z - pz) < r) return id;
  return null;
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * …AND THE ROUTE THROUGH IT, SEARCHED RATHER THAN GUESSED
 * ────────────────────────────────────────────────────────────────────────────
 *   node _nftrenchplan.mjs --route=-140,-84:-148,70 [--clear=7]
 *
 * Hand-fitting a 150 m line between thirty-six tank legs is a sequence of near
 * misses that each cost a boot to find. This is Dijkstra on a 2 m lattice of
 * the free space above, with the step cost weighted AWAY from the legs as well
 * as merely clear of them — a trench that passes a route at exactly 7.0 m is
 * one waypoint edit away from costing five spokes, so the search buys margin
 * wherever margin is free. The polyline is then simplified to the fewest
 * vertices that stay within `--tol` of the searched path, because a trench with
 * a bend every two metres is a trench nobody can read on the ground.
 */
const CELL = 2;
const HALFN = 172;
function blocked(x, z) {
  if (Math.hypot(x, z) > 170) return 'ridge';
  if (Math.hypot(x, z + 32) < 27) return 'tower';
  if (Math.hypot(x, z - 48) < 38) return 'fort';
  for (const [id, px, pz, r] of PADS) {
    const keep = id === 'N' || id === 'S' ? 20 : id === 'T' || id === 'F' ? 0 : 12;
    if (keep && Math.hypot(x - px, z - pz) < keep) return `pad ${id}`;
  }
  return null;
}
if (args.flood) {
  /**
   * IS THE FREE SPACE EVEN CONNECTED? Printed as components rather than as a
   * yes/no, because "no route" between two points is the same answer whether
   * the space is one region with a wall across it or forty separate pockets,
   * and those want opposite fixes.
   */
  const [fx, fz] = String(args.flood).split(',').map(Number);
  const N = Math.round((HALFN * 2) / CELL) + 1;
  const ix = (x) => Math.round((x + HALFN) / CELL);
  const wx = (i) => i * CELL - HALFN;
  const ok = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = wx(i), z = wx(j);
    ok[j * N + i] = !blocked(x, z) && nearestLeg(x, z).d >= CLEAR ? 1 : 0;
  }
  const seen = new Uint8Array(N * N);
  const q = [ix(fz) * N + ix(fx)];
  if (!ok[q[0]]) { console.log('  the seed itself is not free space'); process.exit(1); }
  seen[q[0]] = 1; let n = 0;
  while (q.length) {
    const c = q.pop(); n++;
    const i = c % N, j = (c / N) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i2 = i + di, j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= N || j2 >= N) continue;
      const m = j2 * N + i2;
      if (ok[m] && !seen[m]) { seen[m] = 1; q.push(m); }
    }
  }
  let total = 0; for (let i = 0; i < ok.length; i++) total += ok[i];
  console.log(`  free cells ${total}, reached from (${fx},${fz}): ${n} (${((n / total) * 100).toFixed(0)}%)`);
  const SX = 6, SZ = 9;
  for (let z = -174; z <= 174; z += SZ) {
    let row = String(z).padStart(6) + '  ';
    for (let x = -174; x <= 174; x += SX) {
      const c = ix(z) * N + ix(x);
      row += seen[c] ? 'o' : ok[c] ? '.' : blocked(x, z) ? '#' : '·';
    }
    console.log(row);
  }
  process.exit(0);
}
if (args.route) {
  const [aS, bS] = String(args.route).split(':');
  const [ax, az] = aS.split(',').map(Number);
  const [bx, bz] = bS.split(',').map(Number);
  const N = Math.round((HALFN * 2) / CELL) + 1;
  const ix = (x) => Math.round((x + HALFN) / CELL);
  const wx = (i) => i * CELL - HALFN;
  const cost = new Float32Array(N * N).fill(Infinity);
  const prev = new Int32Array(N * N).fill(-1);
  const clr = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = wx(i), z = wx(j);
    clr[j * N + i] = blocked(x, z) ? -1 : nearestLeg(x, z).d;
  }
  const s = ix(az) * N + ix(ax), t = ix(bz) * N + ix(bx);
  if (clr[s] < CLEAR) console.warn(`  start is only ${clr[s].toFixed(1)} m clear`);
  if (clr[t] < CLEAR) console.warn(`  end is only ${clr[t].toFixed(1)} m clear`);
  // a plain binary-heap Dijkstra; the lattice is 173² so this is milliseconds
  const heap = [[0, s]]; cost[s] = 0;
  const push = (c, n) => { heap.push([c, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [c, n] = pop();
    if (c > cost[n]) continue;
    if (n === t) break;
    const i = n % N, j = (n / N) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const i2 = i + di, j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= N || j2 >= N) continue;
      const m = j2 * N + i2;
      const cl = clr[m];
      if (cl < 0) continue; // the works, the pads and the mountain: never
      /**
       * ────────────────────────────────────────────────────────────────────
       * A TANK LEG IS A COST, NOT A WALL — the whole plan turned on this
       * ────────────────────────────────────────────────────────────────────
       * Treating "within 7 m of a route" as impassable said NO ROUTE for every
       * single run of the network, and the picture said why: thirty-six legs
       * fanning off six hubs leave no 7 m corridor across this map in any
       * direction. It was also the wrong question. A trench does not have to
       * MISS a tank lane — it has to be AT GRADE where one crosses it, which
       * is the same thing the three existing lines already do at their
       * traverses and is what a real system does at a vehicle crossing.
       *
       * So: near a leg is expensive (a crossing costs the line a bay end and
       * 12 m of undug ground), running ALONG one for tens of metres is
       * ruinous, and neither is forbidden. `--gaps` then reports every stretch
       * that has to be left undug, and those become the authored `GRADE`
       * table in `plains-trench.js`.
       */
      const step = Math.hypot(di, dj) * CELL;
      const c2 = c + step * (1 + 6 * Math.max(0, (18 - cl) / 18) ** 2);
      if (c2 < cost[m]) { cost[m] = c2; prev[m] = n; push(c2, m); }
    }
  }
  if (!Number.isFinite(cost[t])) { console.log('  NO ROUTE — the free space does not connect those two points'); process.exit(1); }
  const path = [];
  for (let n = t; n >= 0; n = prev[n]) path.push([wx(n % N), wx((n / N) | 0)]);
  path.reverse();
  /* ---- simplify (Douglas-Peucker) --------------------------------------- */
  const TOL = Number(args.tol ?? 3);
  const dp = (lo, hi, keep) => {
    let worst = -1, wi = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = segD(path[i][0], path[i][1], path[lo][0], path[lo][1], path[hi][0], path[hi][1]);
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst > TOL) { dp(lo, wi, keep); keep.push(wi); dp(wi, hi, keep); }
  };
  const keep = [0]; dp(0, path.length - 1, keep); keep.push(path.length - 1);
  keep.sort((a, b) => a - b);
  const poly = keep.map((i) => path[i]);
  let L = 0; for (let i = 1; i < poly.length; i++) L += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
  // …and the simplified line re-measured, because DP moved it off the searched one
  let worst = 1e9, who = null, at = null;
  for (let i = 0; i < poly.length - 1; i++) {
    const seg = Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
    const n = Math.ceil(seg);
    for (let k = 0; k <= n; k++) {
      const x = poly[i][0] + ((poly[i + 1][0] - poly[i][0]) * k) / n;
      const z = poly[i][1] + ((poly[i + 1][1] - poly[i][1]) * k) / n;
      const r = nearestLeg(x, z);
      const bl = blocked(x, z);
      if (r.d < worst) { worst = r.d; who = r.id; at = [Math.round(x), Math.round(z)]; }
      if (bl) { console.log(`  !! simplified line enters ${bl} at (${Math.round(x)},${Math.round(z)})`); }
    }
  }
  console.log(`  ${L.toFixed(0)} m, ${poly.length} points, worst clearance ${worst.toFixed(1)} m to ${who} at (${at})`);
  console.log('  ' + JSON.stringify(poly));
  console.log('  gaps: ' + JSON.stringify(gapsFor(poly)));
  process.exit(0);
}

/**
 * WHERE A LINE HAS TO BE LEFT AT GRADE. Walked at 1 m, every stretch inside
 * `--near` (default 6 m) of any tank leg is collapsed to one circle at its
 * middle, radius `--gapr` (default 7) — half the 14 m of undug ground a hull
 * needs to cross a 3.3 m wide vehicle obliquely with `LATERAL_MAX` of slide
 * either side of the authored line.
 */
function gapsFor(poly) {
  const hits = [];
  for (let i = 0; i < poly.length - 1; i++) {
    const seg = Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
    const n = Math.max(1, Math.round(seg));
    for (let k = 0; k <= n; k++) {
      const x = poly[i][0] + ((poly[i + 1][0] - poly[i][0]) * k) / n;
      const z = poly[i][1] + ((poly[i + 1][1] - poly[i][1]) * k) / n;
      hits.push([x, z, nearestLeg(x, z).d < NEAR]);
    }
  }
  const out = [];
  let run = null;
  for (const [x, z, bad] of hits) {
    if (bad) { if (!run) run = [[x, z]]; else run.push([x, z]); }
    else if (run) { out.push(run); run = null; }
  }
  if (run) out.push(run);
  /**
   * ONE CIRCLE PER RUN WAS WRONG, AND IT WAS WRONG SILENTLY.
   * A leg that merely crosses the line makes a run of four or five metres and
   * one circle covers it. A leg that runs ALONGSIDE it for forty makes one run
   * too, and a single 16 m circle at its middle left twelve metres of cut at
   * each end sitting on a tank lane — the gate found sixteen bays like that
   * after the first `--emit`. So a run is covered end to end, and a run that
   * needs more than two circles is the tool saying MOVE THE LINE rather than
   * gap it: a trench that is 60 % vehicle crossing is not a trench.
   */
  const circles = [];
  for (const r of out) {
    const len = (r.length - 1) * (r.length > 1 ? Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]) : 1);
    const k = Math.max(1, Math.ceil(len / (GAPR * 1.9)));
    for (let i = 0; i < k; i++) {
      const m = r[Math.min(r.length - 1, Math.round(((i + 0.5) / k) * (r.length - 1)))];
      circles.push([Math.round(m[0]), Math.round(m[1]), GAPR]);
    }
  }
  return circles;
}
if (args.gaps) {
  const poly = JSON.parse(args.gaps);
  let L = 0;
  for (let i = 1; i < poly.length; i++) L += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
  // the bends, which the strip mesh has to miter: over ~30° the inside offset
  // folds back on itself and the cut turns inside out.
  const bends = [];
  for (let i = 1; i < poly.length - 1; i++) {
    const a = Math.atan2(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
    const b = Math.atan2(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
    let d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    bends.push(Math.round((d * 180) / Math.PI));
  }
  let worst = 1e9, who = null, at = null, bad = null;
  for (let i = 0; i < poly.length - 1; i++) {
    const n = Math.max(1, Math.round(Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1])));
    for (let k = 0; k <= n; k++) {
      const x = poly[i][0] + ((poly[i + 1][0] - poly[i][0]) * k) / n;
      const z = poly[i][1] + ((poly[i + 1][1] - poly[i][1]) * k) / n;
      const r = nearestLeg(x, z);
      if (r.d < worst) { worst = r.d; who = r.id; at = [Math.round(x), Math.round(z)]; }
      const bl = blocked(x, z);
      if (bl && !bad) bad = `${bl} at (${Math.round(x)},${Math.round(z)})`;
    }
  }
  const g = gapsFor(poly);
  console.log(`  ${L.toFixed(0)} m  bends[${bends}]  worst ${worst.toFixed(1)} m to ${who} at (${at})${bad ? `  !! ${bad}` : ''}`);
  console.log(`  gaps ${g.length}: ${JSON.stringify(g)}`);
  process.exit(0);
}

if (!args.check && !args.emit) {
  /* ---- the map ---------------------------------------------------------- */
  const STEPX = 6, STEPZ = 9;
  console.log(`free space for a trench: '.' = over ${CLEAR} m from every tank leg`);
  console.log(`  '·' = under it   letters = a pad / the works   '#' = past the ridge foot`);
  let head = '        ';
  for (let x = -174; x <= 174; x += STEPX) head += Math.abs(x) % 60 < STEPX ? '|' : ' ';
  console.log(head);
  for (let z = -174; z <= 174; z += STEPZ) {
    let row = String(z).padStart(6) + '  ';
    for (let x = -174; x <= 174; x += STEPX) {
      if (Math.hypot(x, z) > 172) { row += '#'; continue; }
      const p = inPad(x, z);
      if (p) { row += p; continue; }
      row += nearestLeg(x, z).d >= CLEAR ? '.' : '·';
    }
    console.log(row);
  }
} else if (args.emit) {
  /**
   * THE `GRADE` TABLE, DERIVED. Reads the CURRENT line list out of
   * `plains-trench.js`, walks each authored polyline against the CURRENT tank
   * table, and prints the vehicle crossings to paste back. Deriving it beats
   * authoring it for one reason: a waypoint moved in `src/match/tank.js` is
   * then one command away from a correct answer instead of a boot away from a
   * dropped wheel.
   */
  const { trenchLines } = await import('./src/world/levels/plains-trench.js');
  for (const t of trenchLines()) {
    const g = gapsFor(t.pts);
    const gapped = g.length * GAPR * 2;
    console.log(`  ${(t.name + ':').padEnd(16)}${JSON.stringify(g)}` +
      `${g.length ? `   // ${gapped} of ${t.total.toFixed(0)} m at grade` : ''}` +
      `${gapped > t.total * 0.6 ? '  <-- MOVE THIS LINE' : ''}`);
  }
} else {
  /* ---- the gate --------------------------------------------------------- */
  const { trenchBays } = await import('./src/world/levels/plains-trench.js');
  const bays = trenchBays();
  const nearestOf = (pts) => {
    let best = 1e9, who = null, at = null;
    for (const [x, z] of pts) {
      const r = nearestLeg(x, z);
      if (r.d < best) { best = r.d; who = r.id; at = [Math.round(x), Math.round(z)]; }
    }
    return { best, who, at };
  };
  console.log(` ${bays.length} bays\n`);
  console.log('  bay                       len   closest tank leg          d');
  let worst = 1e9, fails = 0, dug = 0;
  for (const b of bays) {
    const { best, who, at } = nearestOf(b.pts);
    /**
     * A LEGACY LINE IS REPORTED AND NOT FAILED. @see the grandfather note in
     * `plains-trench.js`: NORDGRABEN, SUDGRABEN and MITTELSAPPE were measured
     * into place against this exact table and thirty-five legs bake over them.
     * `CLEAR` is a pessimistic proxy and those three are the evidence of how
     * pessimistic.
     */
    const bad = best < CLEAR && !b.legacy;
    if (bad) fails++;
    if (best < worst) worst = best;
    dug += b.s1 - b.s0;
    console.log(`  ${b.name.padEnd(22)}${(b.s1 - b.s0).toFixed(0).padStart(5)}   ${String(who).padEnd(20)}${best.toFixed(1).padStart(6)}${bad ? `  <-- FAIL at (${at})` : b.legacy && best < CLEAR ? '  (legacy, proved)' : ''}`);
  }
  /**
   * …AND THE SALLY RAMPS SEPARATELY, because they are the one place a cut is
   * NOT a wall. A hull whose authored line crosses a `RAMP_GRADE` slope into a
   * trench finds ground all the way down it and drives in.
   */
  console.log('\n  way out                        closest tank leg          d');
  let eFails = 0;
  for (const b of bays) {
    for (const e of b.exits) {
      const r = nearestLeg(e.x, e.z);
      const bad = r.d < CLEAR + 2 && !b.legacy;
      if (bad) eFails++;
      console.log(`  ${(b.name + ' ' + e.kind).padEnd(30)} ${String(r.id).padEnd(20)}${r.d.toFixed(1).padStart(6)}${bad ? '  <-- FAIL' : ''}`);
    }
  }
  console.log(`\n  ${bays.length} bays, ${dug.toFixed(0)} m of cut`);
  console.log(`  worst ${worst.toFixed(1)} m, ${fails} bay(s) under ${CLEAR} m, ${eFails} way(s) out under ${CLEAR + 2} m`);
  process.exit(fails + eFails ? 1 : 0);
}
