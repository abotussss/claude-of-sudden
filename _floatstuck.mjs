/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 「AIが屋内にスタックしている 宙に浮いて動いていない」 — WHO IS FLOATING, AND WHY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node _floatstuck.mjs --url=… --seeds=7,11 [--secs=300] [--tol=0.45]
 *
 * REPRODUCE BEFORE CHANGING ANYTHING. This does not touch the sim: it samples
 * every live bot once a game-second and asks three independent questions, then
 * reports only the men for whom the answers disagree.
 *
 *   IS HE ON SOMETHING?  A downward `phys.raycast` from his pelvis with
 *     `MASK.ALL`. This is the ground truth and it is the only one of the three
 *     that knows about a first-floor slab, a girder or a piece of rubble. `gap`
 *     is his feet minus that surface; anything over `--tol` is a man standing
 *     on air as far as the WORLD is concerned.
 *
 *   IS HE WHERE THE HEIGHT FIELD THINKS?  `grid.floor` at his own cell against
 *     his actual Y. The hazard is known and structural: `NavGrid._carveInteriors`
 *     overwrites an enterable building's footprint with its GROUND storey, so a
 *     man legitimately standing on a first floor sits 3+ m over a cell whose
 *     recorded floor is 0 — he is FINE by the raycast and OFF THE GRID by the
 *     nav floor. Separating the two is the entire point of this probe: the first
 *     is a physics bug, the second is a nav bug, and they need opposite fixes.
 *
 *   IS HE MOVING?  Position once a second. `stuck` is `tools/stuckcheck.mjs`'s
 *     own rule — five consecutive samples inside 0.15 m WHILE WANTING TO MOVE —
 *     and it is reported next to a SECOND rule that does not ask him whether he
 *     wants to move, because a man hanging in the air with `desiredSpeed` 0 is
 *     invisible to the first one by construction. That blind spot is named in
 *     the brief and it is measured here rather than assumed.
 *
 * Every frozen or floating man is reported with his STATE, his ORDER, his
 * `post`/`postPhase`, whether `_goTo` would refuse to plan for him
 * (`grid.nearest(...) < 0`, i.e. `Agent._offGrid`), whether he is indoors, and
 * how long he has been like it — so the answer comes out as a distribution over
 * causes rather than as one anecdote.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4495/';
const SEEDS = String(args.seeds ?? args.seed ?? '7').split(',');
const SECS = +(args.secs ?? 300);
const TOL = +(args.tol ?? 0.45);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

for (const seed of SEEDS) {
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(`${URL}?capture=1&seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

  const res = await page.evaluate(async ({ SECS, TOL }) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const ai = e.ctx.peek('ai');
    const phys = ai.phys;
    const grid = ai.grid;
    e.input.frozen = true;
    e.input.enabled = false;
    e.ctx.peek('player')?.setControlEnabled?.(false);
    e.time.scale = 12;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    while (m.phase !== 'live') await frame();
    const t0 = m.roundClock;
    const t = () => t0 - m.roundClock;

    const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
    const S = {
      samples: 0, manSamples: 0,
      floatSamples: 0, offGridSamples: 0, frozenSamples: 0,
      floatByState: Object.create(null),
      floatByPhase: Object.create(null),
      floatByOrder: Object.create(null),
      offGridByState: Object.create(null),
      frozenByState: Object.create(null),
      /** floating AND frozen — the thing the player is actually looking at */
      hangingByState: Object.create(null),
      hangingByPhase: Object.create(null),
      gaps: [],
      navErr: [],
      postDrops: null,
      episodes: [],
      indoorFloat: 0, outdoorFloat: 0,
      everFloated: new Set(), everHung: new Set(),
      strandedSamples: 0, everStranded: new Set(),
      strandedByState: Object.create(null), strandedByPhase: Object.create(null),
      strandedByHeight: Object.create(null), strandedByIndoor: Object.create(null),
      strandEpisodes: [],
      postSamples: 0, postFloatSamples: 0,
      highSamples: 0, highFloatSamples: 0,
    };

    /** per-man rolling record */
    const rec = new Map();
    const down = { x: 0, y: -1, z: 0 };
    let next = 0;
    const start = performance.now();
    while (performance.now() - start < 900000) {
      await frame();
      if (m.phase !== 'live' || m.roundClock <= 0) break;
      if (t() > SECS) break;
      if (e.time.elapsed < next) continue;
      next = e.time.elapsed + 1;
      S.samples++;

      for (const a of ai.agents) {
        if (!a.alive) continue;
        S.manSamples++;
        let r = rec.get(a.id);
        if (!r) {
          r = { still: 0, hang: 0, strand: 0, strandPeak: 0, lastX: a.position.x, lastZ: a.position.z, lastY: a.position.y, peak: 0 };
          rec.set(a.id, r);
        }

        /* ---- 1. the world underneath him ------------------------------ */
        const feetY = a.position.y;
        const hit = phys.raycast(
          a.position.x, feetY + 1.2, a.position.z,
          down.x, down.y, down.z, 60, phys.MASK.ALL
        );
        const solidY = hit && hit.hit ? feetY + 1.2 - hit.distance : -999;
        const gap = solidY > -900 ? feetY - solidY : 99;

        /* ---- 2. the height field ------------------------------------- */
        const ix = grid.cellX(a.position.x), iz = grid.cellZ(a.position.z);
        const inside = grid.inside(ix, iz);
        const ci = inside ? grid.index(ix, iz) : -1;
        const navFloor = ci >= 0 ? grid.floor[ci] : NaN;
        const navErr = ci >= 0 ? feetY - navFloor : NaN;
        /** `Agent._offGrid`'s own question, with `Agent`'s own OFFGRID_TOL. */
        const offGrid = grid.nearest(a.position.x, a.position.z, feetY, 3, 1.5) < 0;
        const indoor = ci >= 0 && (grid.interior?.[ci] === 1 || grid.indoor?.[ci] === 1);

        /* ---- 3. is he going anywhere --------------------------------- */
        const moved = Math.hypot(a.position.x - r.lastX, a.position.z - r.lastZ);
        r.lastX = a.position.x; r.lastZ = a.position.z;
        const wants = (a.desiredSpeed ?? 0) > 0.1;
        if (moved < 0.15) r.still++; else r.still = 0;
        /** THE SECOND RULE: still, regardless of whether he says he wants to move. */
        const frozen = r.still >= 5;
        const floating = gap > TOL;

        if (floating) {
          S.floatSamples++;
          S.everFloated.add(a.id);
          bump(S.floatByState, a.state);
          bump(S.floatByPhase, a.post ? `post phase ${a.postPhase}` : 'no post');
          bump(S.floatByOrder, a.objective?.mode ?? 'none');
          S.gaps.push(+gap.toFixed(2));
          if (indoor) S.indoorFloat++; else S.outdoorFloat++;
          r.hang++;
          if (r.hang > r.peak) r.peak = r.hang;
        } else r.hang = 0;
        if (offGrid) { S.offGridSamples++; bump(S.offGridByState, a.state); }
        /**
         * ════════════════════════════════════════════════════════════════
         * STRANDED — the cross-tabulation that is the actual answer
         * ════════════════════════════════════════════════════════════════
         * "Floating" turned out to be 0.00 % of man-samples: every bot on this
         * map is standing on something solid. So the man the player is looking
         * at is not in the air — he is ON A FIRST-FLOOR SLAB, which is a
         * surface the HEIGHT FIELD does not have, because `_carveInteriors`
         * wrote the ground storey over that footprint. From a camera outside
         * the building he is a man standing three metres up on nothing.
         *
         * And he does not move, because `Agent._goTo` refuses to plan a route
         * for a man `_offGrid` says is not on the grid. THAT is the freeze, and
         * this counter is the one that proves the two halves are the same men.
         */
        if (offGrid && frozen) {
          S.strandedSamples++;
          S.everStranded.add(a.id);
          bump(S.strandedByState, a.state + (wants ? ' (wants to move)' : ' (no desire)'));
          bump(S.strandedByPhase, a.post ? `post phase ${a.postPhase}` : 'no post');
          bump(S.strandedByHeight, feetY > 2.5 ? 'above 2.5 m (upper storey)' : 'at ground level');
          bump(S.strandedByIndoor, indoor ? 'indoors' : 'outdoors');
          r.strand++;
          if (r.strand > r.strandPeak) r.strandPeak = r.strand;
          if (S.strandEpisodes.length < 30)
            S.strandEpisodes.push({
              t: +t().toFixed(1), id: a.id, name: a.name ?? '',
              state: a.state, order: a.objective?.mode ?? 'none',
              post: a.post ? a.postPhase : -1,
              y: +feetY.toFixed(2), solidY: +solidY.toFixed(2), gap: +gap.toFixed(2),
              navFloor: +Number(navFloor).toFixed(2), navErr: +Number(navErr).toFixed(2),
              indoor, grounded: !!a.grounded,
              speed: +(a.speed ?? 0).toFixed(2), want: +(a.desiredSpeed ?? 0).toFixed(2),
              hasMoveTarget: !!a.hasMoveTarget, pathPending: !!a.pathPending,
              stillFor: r.still, strandFor: r.strand,
            });
        } else r.strand = 0;
        if (frozen) { S.frozenSamples++; bump(S.frozenByState, a.state + (wants ? ' (wants to move)' : ' (no desire)')); }
        if (floating && frozen) {
          S.everHung.add(a.id);
          bump(S.hangingByState, a.state + (wants ? ' (wants to move)' : ' (no desire)'));
          bump(S.hangingByPhase, a.post ? `post phase ${a.postPhase}` : 'no post');
          if (S.episodes.length < 40)
            S.episodes.push({
              t: +t().toFixed(1), id: a.id, name: a.name ?? '',
              state: a.state, order: a.objective?.mode ?? 'none',
              post: a.post ? a.postPhase : -1,
              y: +feetY.toFixed(2), solidY: +solidY.toFixed(2), gap: +gap.toFixed(2),
              navFloor: +Number(navFloor).toFixed(2), navErr: +Number(navErr).toFixed(2),
              offGrid, indoor, grounded: !!a.grounded,
              vy: +(a.velocity?.y ?? 0).toFixed(2),
              speed: +(a.speed ?? 0).toFixed(2), want: +(a.desiredSpeed ?? 0).toFixed(2),
              hasMoveTarget: !!a.hasMoveTarget, pathPending: !!a.pathPending,
              stillFor: r.still, hangFor: r.hang,
            });
        }
        if (ci >= 0 && Math.abs(navErr) > 1.5) S.navErr.push(+navErr.toFixed(1));
        if (a.post) { S.postSamples++; if (floating) S.postFloatSamples++; }
        if (feetY > 2.5) { S.highSamples++; if (floating) S.highFloatSamples++; }
      }
    }
    let worst = 0, worstStrand = 0;
    for (const r of rec.values()) {
      if (r.peak > worst) worst = r.peak;
      if (r.strandPeak > worstStrand) worstStrand = r.strandPeak;
    }

    return {
      seed: e.levelSeed, end: +t().toFixed(1), phase: m.phase,
      ...S,
      everFloated: S.everFloated.size, everHung: S.everHung.size,
      everStranded: S.everStranded.size, worstStrandSeconds: worstStrand,
      worstHangSeconds: worst,
      gaps: S.gaps.slice(0, 3000), navErr: S.navErr.slice(0, 3000),
      postStats: ai.postStats ? JSON.parse(JSON.stringify(ai.postStats)) : null,
      agents: ai.agents.length,
    };
  }, { SECS, TOL });

  const q = (arr) => {
    if (!arr.length) return '(none)';
    const s = arr.slice().sort((a, b) => a - b);
    const at = (f) => s[Math.min(s.length - 1, Math.floor(s.length * f))];
    return `n=${s.length} min ${at(0)} med ${at(0.5)} p90 ${at(0.9)} max ${at(1)}`;
  };
  const tab = (o, total) => Object.entries(o).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `      ${String(v).padStart(6)} ${(total ? ((v / total) * 100).toFixed(2) + '%' : '').padStart(7)}  ${k}`).join('\n') || '      (none)';

  console.log(`\n════ seed ${res.seed} · ${res.end}s · ${res.samples} one-second sweeps · ${res.manSamples} man-samples · roster ${res.agents}`);
  console.log(`  FLOATING (feet more than ${TOL} m above the nearest solid below, MASK.ALL):`);
  console.log(`      ${res.floatSamples} man-samples (${((res.floatSamples / Math.max(1, res.manSamples)) * 100).toFixed(2)}%) · ${res.everFloated} distinct men ever floated`);
  console.log(`      gap distribution: ${q(res.gaps)}`);
  console.log(`      indoors ${res.indoorFloat} · outdoors ${res.outdoorFloat}`);
  console.log(`  FROZEN (5+ consecutive one-second samples inside 0.15 m, DESIRE NOT ASKED):`);
  console.log(`      ${res.frozenSamples} man-samples (${((res.frozenSamples / Math.max(1, res.manSamples)) * 100).toFixed(2)}%)`);
  console.log(tab(res.frozenByState, res.frozenSamples));
  console.log(`  HANGING = floating AND frozen — what the player is looking at:`);
  console.log(`      ${res.everHung} distinct men · longest unbroken float ${res.worstHangSeconds} s`);
  console.log(tab(res.hangingByState, null));
  console.log(`      by post phase:`);
  console.log(tab(res.hangingByPhase, null));
  console.log(`  FLOATING by state / post phase / order:`);
  console.log(tab(res.floatByState, res.floatSamples));
  console.log(tab(res.floatByPhase, res.floatSamples));
  console.log(tab(res.floatByOrder, res.floatSamples));
  console.log(`  OFF THE HEIGHT FIELD (Agent._offGrid — _goTo refuses to plan): ${res.offGridSamples} man-samples (${((res.offGridSamples / Math.max(1, res.manSamples)) * 100).toFixed(2)}%)`);
  console.log(tab(res.offGridByState, res.offGridSamples));
  console.log(`  ══ STRANDED = off the height field AND not moving — the actual defect:`);
  console.log(`      ${res.strandedSamples} man-samples (${((res.strandedSamples / Math.max(1, res.manSamples)) * 100).toFixed(2)}%) · ${res.everStranded} distinct men · longest unbroken ${res.worstStrandSeconds} s`);
  console.log(tab(res.strandedByState, res.strandedSamples));
  console.log(tab(res.strandedByHeight, res.strandedSamples));
  console.log(tab(res.strandedByIndoor, res.strandedSamples));
  console.log(tab(res.strandedByPhase, res.strandedSamples));
  if (res.strandEpisodes.length) {
    console.log(`  ── STRANDED EPISODES`);
    for (const x of res.strandEpisodes)
      console.log(`      t=${String(x.t).padStart(6)}s #${String(x.id).padStart(3)} ${x.state.padEnd(10)} order=${String(x.order).padEnd(7)} post=${x.post} y=${String(x.y).padStart(7)} solid=${String(x.solidY).padStart(7)} gap=${String(x.gap).padStart(5)} navFloor=${String(x.navFloor).padStart(6)} navErr=${String(x.navErr).padStart(6)} indoor=${x.indoor ? 'Y' : 'n'} grounded=${x.grounded ? 'Y' : 'n'} speed=${x.speed} want=${x.want} mt=${x.hasMoveTarget ? 'Y' : 'n'} pend=${x.pathPending ? 'Y' : 'n'} still=${x.stillFor}s`);
  }
  console.log(`  nav floor vs actual Y, where they disagree by >1.5 m: ${q(res.navErr)}`);
  console.log(`  POST SYSTEM: ${res.postSamples} man-samples on a post, ${res.postFloatSamples} of them floating · above 2.5 m: ${res.highSamples} samples, ${res.highFloatSamples} floating`);
  if (res.postStats) console.log(`  postStats: ${JSON.stringify(res.postStats)}`);
  if (res.episodes.length) {
    console.log(`  ── EPISODES (first ${res.episodes.length} hanging men)`);
    for (const x of res.episodes)
      console.log(`      t=${String(x.t).padStart(6)}s #${String(x.id).padStart(3)} ${x.state.padEnd(10)} order=${String(x.order).padEnd(7)} post=${x.post} y=${String(x.y).padStart(7)} solid=${String(x.solidY).padStart(7)} gap=${String(x.gap).padStart(6)} navFloor=${String(x.navFloor).padStart(6)} offGrid=${x.offGrid ? 'Y' : 'n'} indoor=${x.indoor ? 'Y' : 'n'} grounded=${x.grounded ? 'Y' : 'n'} vy=${x.vy} speed=${x.speed} want=${x.want} mt=${x.hasMoveTarget ? 'Y' : 'n'} still=${x.stillFor}s hang=${x.hangFor}s`);
  }
  console.log(errs.length ? `  [pageerror] ${errs.slice(0, 3).join(' | ')}` : '  [pageerror] none');
  await page.close();
}
await browser.close();
