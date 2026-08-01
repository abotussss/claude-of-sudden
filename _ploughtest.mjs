/**
 * DOES THE PLOUGH ACTUALLY FIRE, AND DOES THE LEVEL COME BACK?
 *
 * Rolls a sortie with the engine driven by hand, watches each pile go as the
 * glacis reaches it, and asserts the three things that have to be true:
 *
 *   1. the instances that drew the pile are zeroed  (it stops being drawn)
 *   2. the triangles it was made of are mask 0      (it stops being solid)
 *   3. `reset()` puts all of both back               (the next round has a town)
 *
 * Usage: node _ploughtest.mjs [url] [seed]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4290/';
const SEED = process.argv[3] ?? '7';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
const logs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { const t = m.text(); if (t.includes('[tank]')) logs.push(t); });
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const m = ctx.peek('match');
  const phys = ctx.peek('physics');
  const a = m?.tank;
  if (!a?.ready) return { error: 'no armour' };
  const sw = phys.staticWorld;

  // How many of a pile's instances are currently drawn, and triangles solid?
  const drawn = (pile) => {
    let n = 0;
    for (const r of pile.inst) {
      const arr = r.mesh.instanceMatrix.array;
      const o = r.slot * 16;
      for (let k = 0; k < 16; k++) if (arr[o + k] !== 0) { n++; break; }
    }
    return n;
  };
  const solid = (pile) => {
    let n = 0;
    if (!pile.tris) return 0;
    for (let i = 0; i < pile.tris.length; i++) if (sw.mask[pile.tris[i]] !== 0) n++;
    return n;
  };

  const report = [];
  a.reset();
  for (const tank of a.tanks) {
    const piles = tank.plough ?? [];
    report.push({
      id: tank.id, routeLen: +tank.path.length.toFixed(1), piles: piles.length,
      before: piles.map((q) => ({
        s: +q.s.toFixed(1), top: +q.top.toFixed(2), inst: q.inst.length,
        tris: q.tris?.length ?? 0, drawn: drawn(q), solid: solid(q), chunks: q.chunks ?? 0,
      })),
    });
  }

  // Roll and drive the whole route by hand.
  a.fire();
  let steps = 0;
  const fireOrder = [];
  const seen = new Set();
  while (steps < 4000) {
    a.update(1 / 60, false);
    steps++;
    for (const tank of a.tanks) {
      for (let k = 0; k < (tank.plough?.length ?? 0); k++) {
        const q = tank.plough[k];
        const key = `${tank.id}:${k}`;
        if (q.fired && !seen.has(key)) {
          seen.add(key);
          fireOrder.push({ tank: tank.id, k, atS: +tank.s.toFixed(1), pileS: +q.s.toFixed(1), t: +(steps / 60).toFixed(1) });
        }
      }
    }
    let anyMoving = false;
    for (const tank of a.tanks) if (tank.state === 'advance' || tank.state === 'hold') anyMoving = true;
    if (!anyMoving && steps > 60) break;
  }

  const after = [];
  for (const tank of a.tanks) {
    const piles = tank.plough ?? [];
    after.push({
      id: tank.id, state: tank.state,
      piles: piles.map((q) => ({ fired: q.fired, drawn: drawn(q), solid: solid(q), visible: !!q.mesh?.visible })),
    });
  }

  a.reset();
  const restored = [];
  for (const tank of a.tanks) {
    const piles = tank.plough ?? [];
    restored.push({
      id: tank.id,
      piles: piles.map((q) => ({ fired: q.fired, drawn: drawn(q), inst: q.inst.length, solid: solid(q), tris: q.tris?.length ?? 0, visible: !!q.mesh?.visible })),
    });
  }
  return { report, fireOrder, after, restored, steps };
});

if (out.error) console.log('ERROR', out.error);
else {
  console.log('--- boot ---');
  for (const l of logs) console.log(' ', l);
  console.log('\n--- piles baked ---');
  for (const r of out.report) {
    console.log(`  ${r.id}: ${r.piles} piles over ${r.routeLen} m`);
    for (const q of r.before) console.log(`     s=${String(q.s).padStart(6)} top=${q.top} inst=${q.inst}(drawn ${q.drawn}) tris=${q.tris}(solid ${q.solid}) chunks=${q.chunks}`);
  }
  console.log(`\n--- fired, driving by hand (${out.steps} steps) ---`);
  for (const f of out.fireOrder) console.log(`  t=${f.t}s ${f.tank} pile ${f.k} at s=${f.atS} (pile s=${f.pileS})`);
  console.log('\n--- after the sortie ---');
  let bad = 0;
  for (const r of out.after) {
    for (const [i, q] of r.piles.entries()) {
      const ok = q.fired ? q.drawn === 0 && q.solid === 0 && q.visible : true;
      if (!ok) bad++;
      console.log(`  ${r.id}[${i}] fired=${q.fired} drawn=${q.drawn} solid=${q.solid} debrisVisible=${q.visible} ${ok ? '' : '  <== WRONG'}`);
    }
  }
  console.log('\n--- after reset() ---');
  for (const r of out.restored) {
    for (const [i, q] of r.piles.entries()) {
      const ok = q.fired === false && q.drawn === q.inst && q.solid === q.tris && q.visible === false;
      if (!ok) bad++;
      console.log(`  ${r.id}[${i}] drawn=${q.drawn}/${q.inst} solid=${q.solid}/${q.tris} debrisVisible=${q.visible} ${ok ? 'RESTORED' : '  <== NOT RESTORED'}`);
    }
  }
  console.log(`\n${bad === 0 ? 'PASS' : `FAIL (${bad} problems)`}`);
}
if (errs.length) console.log('\nPAGEERRORS:', errs);
await b.close();
