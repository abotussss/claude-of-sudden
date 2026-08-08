/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHERE THE MIDDLE OF THE MAP WILL TAKE A TRENCH — sited, not guessed
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfsite.mjs [--clear=5.5] [--sep=16] [--min=15] [--max=34]
 *                    [--reach=25] [--rmax=112] [--budget=560]
 *
 * 「塹壕は？塹壕が至る所にないですね？」 — and he is right: 2.0 % of the playable
 * disc is cut and 0.20 % of the middle third is. The network is a ring round the
 * rim because the last pass asked for LONG LINES through the middle, and long
 * lines through the middle are the one thing the armour will not have: thirty-six
 * baked legs fan off six hubs, and a 137 m run laid across that fan came back
 * from `--emit` wanting 96 m of vehicle crossing.
 *
 * THIS ASKS A DIFFERENT QUESTION, and the different question is the fix. A
 * defence in depth is not one line; it is a scatter of section posts, each a
 * fire bay long, sited in the ground between the approaches. So instead of
 * routing a line and then gapping it, this SEARCHES for the straight runs the
 * fan already leaves — every centre on a 3 m lattice, every bearing at 15°,
 * grown both ways while the ground stays legal — and then picks a set of them
 * greedily for COVERAGE: how much of the plain ends up within `--reach` of some
 * cut. A trench you can run to is worth more than a trench that is long.
 *
 * A run is legal where ALL of these hold, at 1 m along it:
 *   · `plainsOpen(x, z, 9)` — the terrain hole `inCorridor` opens is `CUT_R`
 *     8.5 m wide, so nothing may be dug within 9 m of the tower, the fortress,
 *     a spawn claim, a capture pad's works or the rim.
 *   · `nearestLeg(x, z) >= --clear` — the same 5.5 m the gate uses, derived in
 *     `_nftrenchplan.mjs` from 2.35 m of cut plus `LATERAL_MAX` 3.0 m of sample
 *     slide. A run that never comes inside it needs NO vehicle crossing at all,
 *     which is why these come out as trench rather than as ditch with a name.
 *   · `--sep` 16 m from every metre of every other cut, new or already dug —
 *     `MIN_SEP` in `plains-trench.js`, below which two strip meshes overlap.
 *
 * The output is polylines to paste into `TRENCHES`, and the coverage before and
 * after. `--emit` is still what derives `GRADE` afterwards, and `--check` is
 * still the gate.
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const CLEAR = Number(args.clear ?? 5.5);
const SEP = Number(args.sep ?? 16);
const MINL = Number(args.min ?? 15);
const MAXL = Number(args.max ?? 34);
const REACH = Number(args.reach ?? 25);
const RMAX = Number(args.rmax ?? 112);
const BUDGET = Number(args.budget ?? 560);
const WORKM = Number(args.workm ?? 9);

/**
 * `_nftrenchplan.mjs` READS `PLAINS_ROUTES` OUT OF `src/match/tank.js` ITSELF and
 * publishes `nearestLeg`. Importing it is the whole point — a second copy of the
 * route table here would be wrong the first time somebody moved a waypoint, which
 * is the failure its own header was written about. It decides what to print from
 * `process.argv` at module scope, so the flag is set before the dynamic import
 * and restored after: with none of them it prints its free-space map, which is
 * 40 lines of noise in the middle of this tool's output.
 */
const realArgv = process.argv;
process.argv = [realArgv[0], '_nfsite', '--check-nothing'];
const plan = await import('./_nftrenchplan.mjs');
process.argv = realArgv;
const { nearestLeg } = plan;
const { plainsOpen } = await import('./src/world/levels/plains.js');
const { trenchLines } = await import('./src/world/levels/plains-trench.js');

/* ---- every metre of cut that is already dug ----------------------------- */
const EXIST = [];
for (const t of trenchLines()) for (const p of t.pts) EXIST.push(p);
console.log(`\n  ${EXIST.length} m of existing trench axis to stay ${SEP} m clear of`);

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE CLEARANCE FIELD, ONCE
 * ────────────────────────────────────────────────────────────────────────────
 * `nearestLeg` walks thirty-six polylines — about a hundred segment tests — and
 * the steering growth below asks for it five times a metre for every centre and
 * every bearing on the map. Sampled straight that is tens of millions of segment
 * tests and the tool takes minutes. On a 1 m lattice it is 119 025 of them, once,
 * and every later query is an array read. The lattice is 1 m and the runs are
 * grown at 1 m, so nothing is lost to the discretisation that was not already
 * quantised by it.
 */
const FN = 353, F0 = -176;
const CLR = new Float32Array(FN * FN);
const OPEN = new Uint8Array(FN * FN);
for (let j = 0; j < FN; j++) {
  for (let i = 0; i < FN; i++) {
    const x = F0 + i, z = F0 + j;
    OPEN[j * FN + i] = plainsOpen(x, z, WORKM) ? 1 : 0;
    CLR[j * FN + i] = OPEN[j * FN + i] ? nearestLeg(x, z).d : -1;
  }
}
/**
 * THE MINIMUM OF THE FOUR NEIGHBOURS, NOT THE NEAREST ONE. Rounding to the
 * closest lattice node let runs come out at 5.1 m from a leg while the search
 * believed it had held 5.5 — the clearance field has a gradient of about 1 m/m
 * near a leg, so half a cell of rounding is half a metre of the margin the whole
 * gate is built on. Taking the worst of the enclosing cell can only ever refuse
 * ground that was legal, never accept ground that was not.
 */
const clrAt = (x, z) => {
  const i = Math.floor(x - F0), j = Math.floor(z - F0);
  if (i < 0 || j < 0 || i + 1 >= FN || j + 1 >= FN) return -1;
  return Math.min(CLR[j * FN + i], CLR[j * FN + i + 1], CLR[(j + 1) * FN + i], CLR[(j + 1) * FN + i + 1]);
};
const legal = (x, z) => clrAt(x, z) >= CLEAR;

/** Nearest metre of any cut in `list` to (x, z). */
function sepTo(list, x, z) {
  let best = Infinity;
  for (const [px, pz] of list) {
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/* ---- grow every run the fan leaves, STEERING down the pocket ------------ */
/**
 * A STRAIGHT RUN WAS THE FIRST TRY AND IT CAPPED THE NETWORK AT 18 m A PIECE.
 * The free ground between thirty-six radial legs is a set of curved pockets, and
 * a straight chord across a curved pocket runs out of it in twenty metres. So
 * each run is grown a metre at a time and allowed to TURN, by at most `--turn`
 * degrees per metre — 1.2° is a curvature radius of 47.7 m, four times
 * `MIN_RADIUS` 12 and far inside what the strip's offset ribbon can take — and
 * of the headings still legal it takes the one that puts the most air between
 * the cut and the nearest tank leg. That is the same "clearance is worth buying
 * wherever it is free" rule `_nftrenchplan.mjs --route` weights its Dijkstra
 * with, and it turns 18 m stubs into 30-60 m of trench.
 */
const TURN = Number(args.turn ?? 1.2);
function grow(cx, cz, th0, cap) {
  const pts = [[cx, cz]];
  let th = th0, x = cx, z = cz, len = 0;
  while (len < cap) {
    let best = null;
    for (const dt of [-TURN, -TURN * 0.5, 0, TURN * 0.5, TURN]) {
      const t2 = th + (dt * Math.PI) / 180;
      const nx = x + Math.cos(t2), nz = z + Math.sin(t2);
      const cl = clrAt(nx, nz);
      if (cl < CLEAR) continue;
      if (!best || cl > best.cl) best = { t2, nx, nz, cl };
    }
    if (!best) break;
    th = best.t2; x = best.nx; z = best.nz; len++;
    pts.push([x, z]);
  }
  return pts;
}
const cands = [];
const BEAR = 15;
for (let cz = -RMAX; cz <= RMAX; cz += 4) {
  for (let cx = -RMAX; cx <= RMAX; cx += 4) {
    if (Math.hypot(cx, cz) > RMAX) continue;
    if (!legal(cx, cz)) continue;
    for (let b = 0; b < 180; b += BEAR) {
      const th = (b * Math.PI) / 180;
      const back = grow(cx, cz, th + Math.PI, MAXL / 2);
      const fwd = grow(cx, cz, th, MAXL / 2);
      const pts = back.slice(1).reverse().concat(fwd);
      const len = pts.length - 1;
      if (len < MINL) continue;
      cands.push({ len, pts, p0: pts[0], p1: pts[pts.length - 1], mid: [cx, cz] });
    }
  }
}
console.log(`  ${cands.length} legal runs of ${MINL}-${MAXL} m inside r ${RMAX} (steering ${TURN}°/m)`);

/* ---- the coverage lattice ----------------------------------------------- */
const CELL = 4;
const cells = [];
for (let z = -172; z <= 172; z += CELL) {
  for (let x = -172; x <= 172; x += CELL) {
    const r = Math.hypot(x, z);
    if (r > 172) continue;
    cells.push([x, z, r]);
  }
}
const covered = new Uint8Array(cells.length);
/**
 * A CELL INSIDE r 90 IS WORTH TWO. The complaint is not that the map has too
 * little trench in total — it is that 「塹壕が至る所にない」 while crossing the
 * MIDDLE, where the measured cut share is 0.20 % against 2.0 % overall. An
 * unweighted coverage score spends the budget wherever the disc is emptiest,
 * which is the outer ring between the flank spines, and leaves the middle third
 * exactly as bare as it found it.
 */
const coverBy = (pts) => {
  let gain = 0;
  const marks = [];
  for (let i = 0; i < cells.length; i++) {
    if (covered[i]) continue;
    const [x, z, r] = cells[i];
    for (const [px, pz] of pts) {
      if ((x - px) ** 2 + (z - pz) ** 2 <= REACH * REACH) { gain += r < 90 ? 2 : 1; marks.push(i); break; }
    }
  }
  return { gain, marks };
};
/** A run at 1 m, which is what both the separation and the coverage want. */
const walk = (p0, p1) => {
  const n = Math.max(1, Math.round(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])));
  const out = [];
  for (let i = 0; i <= n; i++) out.push([p0[0] + ((p1[0] - p0[0]) * i) / n, p0[1] + ((p1[1] - p0[1]) * i) / n]);
  return out;
};

/* the existing network's coverage first, so `gain` means NEW ground */
{
  const { marks } = coverBy(EXIST);
  for (const i of marks) covered[i] = 1;
}
const share = (pred) => {
  let t = 0, c = 0;
  for (let i = 0; i < cells.length; i++) { if (!pred(cells[i])) continue; t++; if (covered[i]) c++; }
  return (c / t) * 100;
};
console.log(`  before: within ${REACH} m of a cut — whole ${share(() => true).toFixed(1)} %, middle third ${share((c) => c[2] < 90).toFixed(1)} %`);

/* ---- greedy: the run that buys the most ground nobody can reach yet ----- */
const chosen = [];
let spent = 0;
for (;;) {
  let best = null;
  for (const c of cands) {
    if (spent + c.len > BUDGET) continue;
    const pts = c.pts;
    if (sepTo(EXIST, ...c.mid) < SEP - 4) continue; // cheap reject before the full walk
    let ok = true;
    for (const [x, z] of pts) {
      if (sepTo(EXIST, x, z) < SEP) { ok = false; break; }
      for (const ch of chosen) if (sepTo(ch.pts, x, z) < SEP) { ok = false; break; }
      if (!ok) break;
    }
    if (!ok) continue;
    const { gain, marks } = coverBy(pts);
    /**
     * GAIN OVER THE SQUARE ROOT OF THE LENGTH, and both extremes were measured.
     * Raw `gain` spends the budget on long runs in the emptiest corner and
     * leaves the pockets between the tank lanes — which is where a man crossing
     * the middle actually walks — untouched. `gain / len` does the opposite and
     * pathologically: EVERY run it picked came out 15-18 m, because a short run
     * always wins per metre, and a bay under `SALLY_MIN` 22 m gets no sally ramp
     * and one under `DUG_MIN` 26 gets no dugout, so the whole network would have
     * been mouths and nothing else. The root splits the difference: coverage
     * decides where, and length is worth something but not everything.
     */
    const score = gain / Math.sqrt(c.len);
    if (!best || score > best.score || (score === best.score && c.len > best.c.len)) {
      best = { c, pts, gain, marks, score };
    }
  }
  if (!best || best.gain <= 0) break;
  for (const i of best.marks) covered[i] = 1;
  chosen.push({ ...best.c, pts: best.pts, gain: best.gain });
  spent += best.c.len;
}

console.log(`\n  ${chosen.length} runs chosen, ${spent.toFixed(0)} m of new cut (budget ${BUDGET})`);
console.log(`  after:  within ${REACH} m of a cut — whole ${share(() => true).toFixed(1)} %, middle third ${share((c) => c[2] < 90).toFixed(1)} %`);
console.log('\n  the runs, nearest tank leg, and the gaps `--emit` would want:\n');
chosen.sort((a, b) => Math.hypot(...a.mid) - Math.hypot(...b.mid));
/**
 * SIMPLIFIED TO THE FEWEST VERTICES THAT STAY WITHIN `--tol` OF THE GROWN RUN.
 * A run grown at 1 m is forty vertices and unreadable as an authored line; the
 * strip is cut on the SMOOTHED centreline anyway (`centreline()` resamples at
 * 0.5 m and runs 160 heat passes), so vertices closer together than the smoother's
 * own kernel are noise it will remove. 1.5 m is under the 3.0 m `MOUTH` and well
 * under `MIN_SEP`, so no simplification can walk a line into its neighbour.
 */
const TOL = Number(args.tol ?? 1.5);
function simplify(pts) {
  const seg = (x, z, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az; const L2 = dx * dx + dz * dz;
    let t = L2 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
  };
  const keep = [0];
  const dp = (lo, hi) => {
    let worst = -1, wi = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = seg(pts[i][0], pts[i][1], pts[lo][0], pts[lo][1], pts[hi][0], pts[hi][1]);
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst > TOL) { dp(lo, wi); keep.push(wi); dp(wi, hi); }
  };
  dp(0, pts.length - 1);
  keep.push(pts.length - 1);
  keep.sort((a, b) => a - b);
  return keep.map((i) => [Math.round(pts[i][0]), Math.round(pts[i][1])]);
}
/**
 * WHICH WAY THE FIRE STEP FACES. `fireSide` +1 is the LEFT of the run as walked
 * from the first point to the last; the dugouts and the sally ramp go on the
 * other side, which is the definition of "the rear". NACHTFELD's front runs
 * east-west — the attack spawns north at (-14,-150) and the defence south at
 * (14,150) — so a post in the northern half is the attack's and is fought
 * SOUTHWARD, and one in the southern half is the defence's and is fought NORTH.
 *
 * TESTED ON THE HEADING'S SIGN FIRST, AND THAT DEGENERATES. "Face south" is a
 * statement about a normal, and for a run that itself lies north-south both
 * normals face equally south — the test came down to the sign of a 1 m
 * difference in x and picked a side by rounding. The vector from the run's
 * middle to the ENEMY'S SPAWN is defined for every bearing, so the side is
 * whichever normal has a positive dot with it.
 */
const SPAWN = { attack: [-14, -150], defend: [14, 150] };
for (const c of chosen) {
  let worst = 1e9, who = null;
  for (const [x, z] of c.pts) { const r = nearestLeg(x, z); if (r.d < worst) { worst = r.d; who = r.id; } }
  const p = simplify(c.pts);
  const mx = (p[0][0] + p[p.length - 1][0]) / 2, mz = (p[0][1] + p[p.length - 1][1]) / 2;
  let tx = p[p.length - 1][0] - p[0][0], tz = p[p.length - 1][1] - p[0][1];
  const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
  const foe = mz < 0 ? SPAWN.defend : SPAWN.attack;
  const fireSide = (tz * (foe[0] - mx) + -tx * (foe[1] - mz)) > 0 ? 1 : -1;
  console.log(
    `  r${String(Math.round(Math.hypot(...c.mid))).padStart(4)}  ${String(c.len).padStart(3)} m  fs${String(fireSide).padStart(2)}  ` +
      JSON.stringify(p).padEnd(48) +
      `  clear ${worst.toFixed(1)} m to ${who}   +${c.gain}`
  );
}
