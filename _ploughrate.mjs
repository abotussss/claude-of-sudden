/**
 * ════════════════════════════════════════════════════════════════════════════
 * OF THE PROPS THE HULL ACTUALLY DROVE THROUGH, HOW MANY DID IT ERASE?
 * ════════════════════════════════════════════════════════════════════════════
 * 「戦車が破壊可能オブジェを破壊していない」 was answered once by counting instances
 * inside `PLOUGH_HALF` of the metres a hull drove and asking of each survivor
 * why it was still there. That measurement is the one that matters for the
 * plough ceiling and it has to be re-run whenever the ceiling moves, because a
 * ceiling that erases more can also route the hull somewhere else entirely.
 *
 * The hull is DRIVEN BY HAND along every baked leg — no match, no bots, no
 * clock — so the corridor is the whole route rather than whatever the sortie
 * happened to reach, and the answer is reproducible.
 *
 * Reports per hull: instances in the corridor, erased, left standing, and of
 * the survivors how tall they are (over the road) so "it left a 2.9 m pillar"
 * and "it left a 0.2 m brick" are not the same sentence.
 *
 *   node _ploughrate.mjs [url] [seed]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4423/';
const SEED = process.argv[3] ?? '7';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const a = e.ctx.peek('match').tank;
  const phys = e.ctx.peek('physics');
  const V = e.camera.position.constructor;
  const M4 = e.camera.matrixWorld.constructor;
  const HALF = 1.9; // PLOUGH_HALF

  /* every prop instance in the level, in world space */
  const props = [];
  const m = new M4();
  const w = new M4();
  e.ctx.scene.updateMatrixWorld(true);
  e.ctx.scene.traverse((o) => {
    if (!o.isInstancedMesh || !o.name.startsWith('prop_')) return;
    for (let j = 0; j < o.count; j++) {
      o.getMatrixAt(j, m);
      w.multiplyMatrices(o.matrixWorld, m);
      props.push({
        mesh: o, slot: j,
        x: w.elements[12], y: w.elements[13], z: w.elements[14],
        name: o.name,
      });
    }
  });

  const rows = [];
  for (const t of a.tanks) {
    /* ---- who is in the corridor of every leg -------------------------- */
    const inCorridor = new Map();
    for (const leg of t.legs) {
      for (let i = 0; i < leg.n; i++) {
        for (const q of props) {
          const dx = q.x - leg.X[i];
          const dz = q.z - leg.Z[i];
          if (dx * dx + dz * dz > HALF * HALF) continue;
          const key = `${q.mesh.id}:${q.slot}`;
          if (!inCorridor.has(key)) inCorridor.set(key, { q, road: leg.ROAD[i] });
        }
      }
    }

    /* ---- drive every leg by hand and fire every pile ------------------ */
    a.reset();
    t.state = 'advance';
    t.alive = true;
    for (const leg of t.legs) {
      t.legIx = t.legs.indexOf(leg);
      t.legDir = 1;
      for (let s = 0; s <= leg.length + 8; s += 0.5) {
        t.s = s;
        a._checkPlough(t);
      }
    }

    /* ---- who is still drawn ------------------------------------------- */
    let erased = 0;
    const left = [];
    const down = new V(0, -1, 0);
    const o = new V();
    for (const [, rec] of inCorridor) {
      const q = rec.q;
      const arr = q.mesh.instanceMatrix.array;
      const off = q.slot * 16;
      // a zeroed matrix is an erased instance
      let zero = true;
      for (let k = 0; k < 16; k++) if (arr[off + k] !== 0) { zero = false; break; }
      if (zero) { erased++; continue; }
      o.set(q.x, rec.road + 30, q.z);
      const h = phys.raycast(o, down, 45, phys.MASK.WORLD);
      const top = h?.hit ? 30 - h.distance : 0;
      left.push({ name: q.name, top: +top.toFixed(2) });
    }

    const bands = { '<=0.3': 0, '0.3-1.0': 0, '1.0-1.6': 0, '1.6-3.0': 0, '>3.0': 0 };
    for (const q of left) {
      if (q.top <= 0.3) bands['<=0.3']++;
      else if (q.top <= 1.0) bands['0.3-1.0']++;
      else if (q.top <= 1.6) bands['1.0-1.6']++;
      else if (q.top <= 3.0) bands['1.6-3.0']++;
      else bands['>3.0']++;
    }
    const byName = {};
    for (const q of left) if (q.top > 0.3) byName[q.name] = (byName[q.name] ?? 0) + 1;

    rows.push({
      id: t.id,
      legs: t.legs.length,
      piles: t.plough?.length ?? 0,
      corridor: inCorridor.size,
      erased,
      left: left.length,
      bands,
      worstLeft: Object.entries(byName).sort((x, y) => y[1] - x[1]).slice(0, 8),
    });
    a.reset();
  }
  return rows;
});

for (const r of out) {
  const pct = r.corridor ? ((r.erased / r.corridor) * 100).toFixed(0) : '0';
  console.log(`\n===== ${r.id} — ${r.legs} legs, ${r.piles} piles =====`);
  console.log(`  ${r.corridor} prop instances inside the driven corridor`);
  console.log(`  ERASED ${r.erased} (${pct}%) · left standing ${r.left}`);
  console.log(`  survivors by height over the road: ${JSON.stringify(r.bands)}`);
  console.log(`  survivors over 0.3 m, by kind: ${JSON.stringify(r.worstLeft)}`);
}
if (errs.length) console.log('\nPAGEERRORS:', errs);
await b.close();
