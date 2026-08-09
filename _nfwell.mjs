/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT IS STANDING IN THE TOWER'S STAIR WELL, AND WHAT ELSE MOVED
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   BASE=http://127.0.0.1:4631/ node _nfwell.mjs [--json=/tmp/well.json]
 *
 * Three questions, and the third is the one that makes the first two safe to
 * act on:
 *
 *   1. WHAT IS ON THE STAIR? Every `prop_*` instance whose centre falls inside
 *      the well band, per storey, with its height over that storey's floor —
 *      and a `MASK.CHARACTER` ray grid across the foot of half-flight A, which
 *      is what the character controller actually meets. `maxStep` is 0.45 and
 *      the standing stance step is 0.42, so anything over 0.45 is a wall.
 *   2. THE TWO I READ OUT OF THE SOURCE AND NEVER MEASURED — the top storey's
 *      loose crates against the cab floor slab they are placed inside, and the
 *      head clearance over the top half-landing, which is the tightest point of
 *      the climb.
 *   3. A DIGEST OF EVERY PROP ON THE MAP. `rng` here is ONE stream drawn in
 *      sequence: a change that alters how many times this room draws moves every
 *      prop authored after it, and 0.42-0.68 m props in new places is
 *      「石ころオブジェが移動の妨げです」 coming back. Per prototype: the instance
 *      count and a checksum over every instance's position at 1 cm. Run it
 *      before and after and diff the two — anything that is not the crates this
 *      room deliberately moved is a stream shift, and a stream shift is a bug.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = process.env.BASE ?? 'http://127.0.0.1:4631/';

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${BASE}?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

const out = await p.evaluate(() => {
  const THREE_V = window.__ENGINE__.camera.position.constructor;
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const M = ph.MASK.CHARACTER;
  const T = { x: 0, z: -32 };
  const g = e.ctx.peek('world').level.groundY(T.x, T.z);      // the plain at the tower
  const WELL_X = 2.6, WELL_Z0 = -2.6, WELL_Z1 = 3.5;
  const FLOORS = [6.74, 11.6, 16.4, 21.2], ROOF_Y = 25.8, CAB_F = 26.0;

  /* ---- 1/2. every prop instance, bucketed ------------------------------- */
  const v = new THREE_V();
  const props = [];
  const digest = [];
  e.scene.traverse((o) => {
    if (!o.isInstancedMesh || !o.name?.startsWith('prop_')) return;
    let sum = 0, n = 0;
    for (let i = 0; i < o.count; i++) {
      const m = o.instanceMatrix.array;
      const b = i * 16;
      v.set(m[b + 12], m[b + 13], m[b + 14]);
      o.localToWorld(v);
      // checksum: every coordinate at 1 cm, order-independent so a re-ordered
      // batch is not reported as a move
      const q = (Math.round(v.x * 100) * 73856093) ^ (Math.round(v.y * 100) * 19349663)
        ^ (Math.round(v.z * 100) * 83492791);
      sum = (sum + (q >>> 0)) >>> 0;
      n++;
      props.push({ id: o.name.slice(5), x: v.x, y: v.y, z: v.z });
    }
    digest.push({ id: o.name.slice(5), n, sum });
  });
  digest.sort((a, b2) => (a.id < b2.id ? -1 : 1));

  const levels = [
    ['room', FLOORS[0]], ['s1', FLOORS[1]], ['s2', FLOORS[2]], ['s3', FLOORS[3]], ['top', ROOF_Y],
  ];
  const inWell = (x, z, m = 0) => Math.abs(x - T.x) < WELL_X + m
    && z - T.z > WELL_Z0 - m && z - T.z < WELL_Z1 + m;
  const onStair = [];
  for (const [tag, fy] of levels) {
    for (const q of props) {
      if (Math.abs(q.y - (g + fy)) > 0.6) continue;
      if (!inWell(q.x, q.z, 0.6)) continue;
      onStair.push({ tag, id: q.id, x: +q.x.toFixed(2), y: +q.y.toFixed(2), z: +q.z.toFixed(2),
        over: +(q.y - (g + fy)).toFixed(2) });
    }
  }

  /**
   * A CENSUS PER LEVEL INSIDE THE SHAFT, so a delta in the whole-map digest can
   * be attributed to the room or to a storey instead of guessed at.
   */
  const census = [];
  for (const [tag, fy] of [...levels, ['cab', CAB_F]]) {
    const n = props.filter((q) => Math.abs(q.y - (g + fy)) < 0.45
      && Math.hypot(q.x - T.x, q.z - T.z) < 6.1).length;
    census.push({ tag, fy, n });
  }

  /* the top storey's crates against the cab floor slab (25.55 .. 26.00) */
  const topCrates = props.filter((q) => Math.abs(q.y - (g + ROOF_Y)) < 0.6).map((q) => {
    // how far the instance's own bounding box reaches over the cab floor top
    const up = ph.raycast(q.x, q.y + 0.02, q.z, 0, 1, 0, 6, M);
    return { id: q.id, x: +q.x.toFixed(2), y: +q.y.toFixed(2), z: +q.z.toFixed(2),
      overCabFloor: +((q.y) - (g + CAB_F)).toFixed(2),
      ceil: up.hit ? +up.distance.toFixed(2) : null };
  });

  /* ---- the ray grid across the foot of half-flight A --------------------- */
  const rows = [];
  const xs = [];
  for (let x = -2.8; x <= 0.6; x += 0.2) xs.push(+x.toFixed(1));
  for (let z = -6.0; z <= -2.4; z += 0.2) {
    const line = [];
    for (const x of xs) {
      const h = ph.raycast(T.x + x, g + FLOORS[0] + 4.2, T.z + z, 0, -1, 0, 6, M);
      line.push(h.hit ? +(h.point.y - (g + FLOORS[0])).toFixed(2) : null);
    }
    rows.push({ z: +z.toFixed(1), line });
  }
  /**
   * THE WORST INSIDE THE STAIR'S OWN BAND, not the worst in the frame. The
   * 2.00 m at x -2.8, z -4.4 is an authored equipment rack against the wall and
   * always was; reporting it as "the tallest thing on the stair" is how a probe
   * tells you a lie with a true number.
   */
  const STAIR_APRON = 1.8;
  const onStairBand = (x, z, m) => Math.abs(x) < WELL_X + m
    && z > WELL_Z0 - STAIR_APRON - m && z < WELL_Z1 + m;
  let worst = 0, worstAt = null;
  for (const r2 of rows) {
    r2.line.forEach((q, i) => {
      if (q === null || !onStairBand(xs[i], r2.z, -0.05)) return;
      if (q > worst) { worst = q; worstAt = [xs[i], r2.z]; }
    });
  }

  /* ---- head clearance over every landing of the internal climb ----------- */
  const stand = 1.78;
  const heads = [];
  const pts = [
    ['room floor, at the stair foot', -1.28, WELL_Z0 - 1.4, FLOORS[0]],
    ['s1 half-landing', -1.28, 2.75, (FLOORS[0] + FLOORS[1]) / 2],
    ['s2 half-landing', -1.28, 2.75, (FLOORS[1] + FLOORS[2]) / 2],
    ['s3 half-landing', -1.28, 2.75, (FLOORS[2] + FLOORS[3]) / 2],
    ['s4 half-landing (the pinch)', -1.28, 2.75, (FLOORS[3] + ROOF_Y) / 2],
    ['s4 flight A, top tread', -1.28, 1.8, (FLOORS[3] + ROOF_Y) / 2],
    ['s4 flight B, top tread', 1.28, WELL_Z0 + 0.2, ROOF_Y],
    ['the cab floor at the opening', 1.28, -4.2, CAB_F],
  ];
  for (const [tag, x, z, fy] of pts) {
    const up = ph.raycast(T.x + x, g + fy + 0.05, T.z + z, 0, 1, 0, 20, M);
    heads.push({ tag, at: [+(T.x + x).toFixed(2), +(g + fy).toFixed(2), +(T.z + z).toFixed(2)],
      head: up.hit ? +up.distance.toFixed(2) : null,
      clear: up.hit ? +(up.distance - stand).toFixed(2) : null });
  }

  /** every prop inside the shaft, so a before/after diff can name each one */
  const shaft = props
    .filter((q) => Math.hypot(q.x - T.x, q.z - T.z) < 6.1 && q.y > g + 5 && q.y < g + 28)
    .map((q) => `${q.id} ${(q.x - T.x).toFixed(2)} ${(q.y - g).toFixed(2)} ${(q.z - T.z).toFixed(2)}`)
    .sort();
  return { g, onStair, topCrates, rows, xs, worst, worstAt, heads, digest, census, shaft,
    totalProps: props.length, groups: digest.length };
});

console.log(`\n── 1. WHAT IS STANDING IN THE WELL ─────────────────────────────`);
if (!out.onStair.length) console.log('  nothing, at any storey');
for (const q of out.onStair) {
  console.log(`  ${q.tag.padEnd(5)} ${q.id.padEnd(14)} at (${q.x}, ${q.z})  ${q.over} m over that floor`);
}

console.log(`\n── the foot of half-flight A, MASK.CHARACTER, metres over the room floor ──`);
console.log('        ' + out.xs.map((v) => String(v).padStart(6)).join(''));
for (const r of out.rows) {
  console.log(`  z=${String(r.z).padStart(5)} ` +
    r.line.map((q) => (q === null ? '  ----' : String(q.toFixed(2)).padStart(6))).join(''));
}
console.log(`\n  tallest thing INSIDE THE STAIR BAND: ${out.worst.toFixed(2)} m` +
  `${out.worstAt ? ` at (${out.worstAt[0]}, ${out.worstAt[1]})` : ''} — maxStep 0.45, ` +
  `standing stance step 0.42 → ${out.worst > 0.45 ? 'A WALL' : 'walkable'}`);

console.log(`\n── PROP CENSUS INSIDE THE SHAFT, PER LEVEL ─────────────────────`);
for (const c of out.census) console.log(`  ${c.tag.padEnd(5)} at ${String(c.fy).padStart(6)}  ${c.n} instances`);

console.log(`\n── 2a. THE TOP STOREY'S LOOSE CRATES vs THE CAB FLOOR ──────────`);
if (!out.topCrates.length) console.log('  none placed at that level');
for (const q of out.topCrates) {
  console.log(`  ${q.id.padEnd(14)} at (${q.x}, ${q.z}) y ${q.y} — its base is ` +
    `${q.overCabFloor} m relative to the cab floor top; first solid above it ${q.ceil ?? 'open'} m`);
}

console.log(`\n── 2b. HEAD CLEARANCE ON THE INTERNAL CLIMB (stance 1.78 m) ────`);
for (const h of out.heads) {
  console.log(`  ${h.tag.padEnd(30)} ${h.head === null ? 'open sky' :
    `${h.head} m of head, ${h.clear} m over a standing man`}`);
}

console.log(`\n── 3. PROP DIGEST — ${out.totalProps} instances over ${out.groups} prototypes ──`);
if (args.json) {
  writeFileSync(args.json, JSON.stringify({ digest: out.digest, shaft: out.shaft }));
  console.log(`  written to ${args.json}`);
}
for (const d of out.digest.slice(0, 6)) console.log(`  ${d.id.padEnd(16)} ${String(d.n).padStart(5)}  ${d.sum}`);
console.log(`  … ${out.digest.length} groups in all`);
console.log(`\npageerrors = ${errs.length}${errs.length ? ' :: ' + errs[0] : ''}`);
await b.close();
