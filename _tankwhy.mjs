/**
 * THE PLAYER'S THREE COMPLAINTS, AS THREE NUMBERS.
 *
 *   1. 「戦車が破壊可能オブジェを破壊していない」
 *      -> props within PLOUGH_HALF of the metres the hull actually drove,
 *         against the instances it actually erased.
 *   2. 「建物や柱にスタックする」
 *      -> every leg that ends short, and the HEIGHT of the mass standing in
 *         front of the last sample. Under PLOUGH_TOP is the complaint.
 *   3. 「占領地域へ向かっているが進んでいない」
 *      -> the fraction of live seconds a hull spends under walking pace while
 *         its state is `advance` — i.e. holding an order to move — split by
 *         the reason the drive gave it (pivot / fight speed / plough drag /
 *         actually rolling).
 *
 * Nothing here writes to the game. Run against `vite preview --port 4383`.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4383/';
const SEED = process.argv[3] ?? '7';
const SPEED = Number(process.argv[4] ?? 8);
const SECONDS = Number(process.argv[5] ?? 300);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
const boot = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => {
  const t = m.text();
  if (/\[tank\]/.test(t)) boot.push(t);
});
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const res = await page.evaluate(async ({ SPEED, SECONDS }) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const phys = e.ctx.peek('physics');
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.time.scale = SPEED;
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));

  const armour = m.tank;
  const THREE = window.__THREE__ ?? null;

  /* ---- the props, re-indexed exactly as `_buildPropIndex` does ---------- */
  e.ctx.scene.updateMatrixWorld(true);
  const props = [];
  const M = new (e.camera.matrixWorld.constructor)();
  const W = new (e.camera.matrixWorld.constructor)();
  e.ctx.scene.traverse((o) => {
    if (!o.isInstancedMesh || !o.name.startsWith('prop_')) return;
    for (let j = 0; j < o.count; j++) {
      o.getMatrixAt(j, M);
      W.multiplyMatrices(o.matrixWorld, M);
      props.push({ mesh: o, slot: j, x: W.elements[12], y: W.elements[13], z: W.elements[14] });
    }
  });

  /* ---- the wheel as baked --------------------------------------------- */
  const PLOUGH_HALF = 3.3 * 0.5 + 0.25;
  const legsOf = (t) => t.legs.map((p, i) => ({
    ix: i, zone: p.zone ?? 'HUB', n: p.n, len: +p.length.toFixed(1),
    narrowest: +(p.narrowest ?? 0).toFixed(1), stop: p.stop, trimmed: !!p.trimmed,
    end: [+p.X[p.n - 1].toFixed(1), +p.Z[p.n - 1].toFixed(1)],
  }));

  /* ---- what stands in front of a leg's last sample ---------------------- */
  const V = (x, y, z) => { const v = e.camera.position.clone(); v.set(x, y, z); return v; };
  const massAhead = (p) => {
    const i = p.n - 1;
    const yaw = p.YAW[i];
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const sx = fz, sz = -fx;
    let best = null;
    for (const lane of [-1, -0.6, -0.2, 0.2, 0.6, 1]) {
      const ox = p.X[i] + sx * lane * PLOUGH_HALF;
      const oz = p.Z[i] + sz * lane * PLOUGH_HALF;
      const g = phys.groundHeight(ox, oz, 30);
      if (!Number.isFinite(g)) continue;
      const h = phys.raycast(V(ox, g + 0.55, oz), V(fx, 0, fz), 6, phys.MASK.WORLD);
      if (!h?.hit) continue;
      const hx = ox + fx * h.distance, hz = oz + fz * h.distance;
      const t = phys.raycast(V(hx + fx * 0.12, g + 30, hz + fz * 0.12), V(0, -1, 0), 45, phys.MASK.WORLD);
      if (!t?.hit) continue;
      const top = g + 30 - t.distance - g;
      // is there a prop instance behind it?
      let bound = 0;
      for (const q of props) {
        if (Math.abs(q.x - hx) < 1.8 && Math.abs(q.z - hz) < 1.8 && q.y > g - 0.9 && q.y < g + top + 1.2) bound++;
      }
      if (!best || top < best.top) best = { lane, dist: +h.distance.toFixed(2), top: +top.toFixed(2), bound };
    }
    return best;
  };

  const per = {};
  for (const t of armour.tanks) {
    per[t.id] = {
      id: t.id, team: t.team,
      legs: legsOf(t),
      legEndMass: t.legs.map((p) => massAhead(p)),
      ploughBaked: t.plough.length,
      ploughInst: t.plough.reduce((a, q) => a + q.inst.length, 0),
      // per-frame accumulators
      liveT: 0, advT: 0, holdT: 0,
      slowAdvT: 0, pivotT: 0, fightT: 0, dragT: 0, rollT: 0,
      metres: 0, samples: [], visited: [],
      lastX: 0, lastZ: 0, first: true,
      zoneLog: [], rolled: null, died: null,
    };
  }

  armour.fire();

  const start = performance.now();
  const wall = (SECONDS / SPEED) * 1000;
  let prevT = e.time.elapsed;
  while (performance.now() - start < wall) {
    await new Promise((r) => requestAnimationFrame(r));
    if (m.phase !== 'live') break;
    const now = e.time.elapsed;
    const dt = now - prevT;
    prevT = now;
    if (dt <= 0 || dt > 2) continue;
    for (const t of armour.tanks) {
      const p = per[t.id];
      if (t.state === 'parked') continue;
      if (t.state === 'dead') { if (p.died === null) p.died = +m.roundClock.toFixed(1); continue; }
      if (p.rolled === null) p.rolled = +m.roundClock.toFixed(1);
      p.liveT += dt;
      const x = t.position.x, z = t.position.z;
      if (p.first) { p.lastX = x; p.lastZ = z; p.first = false; }
      const step = Math.hypot(x - p.lastX, z - p.lastZ);
      p.metres += step;
      const v = step / dt;
      // every 1.5 m of travel, remember where the hull was (the swept corridor)
      if (!p.visited.length || Math.hypot(x - p.visited[p.visited.length - 1][0], z - p.visited[p.visited.length - 1][1]) > 1.5) {
        p.visited.push([x, z]);
      }
      p.lastX = x; p.lastZ = z;

      if (t.state === 'advance') {
        p.advT += dt;
        if (v < 1.4) {
          p.slowAdvT += dt;
          // WHY. Recompute the drive's own three reasons.
          const leg = t.legs[t.legIx];
          const s = Math.min(Math.max(t.s, 0), leg.length);
          const i = Math.min(leg.n - 1, Math.max(0, Math.round((s / Math.max(1e-4, leg.length)) * (leg.n - 1))));
          let dy = leg.YAW[i] + (t.legDir < 0 ? Math.PI : 0) - t.yaw;
          while (dy > Math.PI) dy -= 2 * Math.PI;
          while (dy < -Math.PI) dy += 2 * Math.PI;
          if (Math.abs(dy) > 0.6) p.pivotT += dt;
          else if (t.ploughDrag > 0) p.dragT += dt;
          else if (t.target) p.fightT += dt;
          else p.rollT += dt;
        }
      } else if (t.state === 'hold') {
        p.holdT += dt;
      }
      const key = `${t.state}:${t.legIx}:${t.legDir}:${t.targetZone}`;
      if (!p.zoneLog.length || p.zoneLog[p.zoneLog.length - 1][0] !== key) {
        p.zoneLog.push([key, +m.roundClock.toFixed(1), +t.s.toFixed(1)]);
      }
    }
  }

  /* ---- the plough verdict ---------------------------------------------- */
  // Who owns which instance, and did that pile ever fire?
  const owner = new Map();
  for (const t of armour.tanks) {
    for (const pile of t.plough) {
      for (const r of pile.inst) owner.set(`${r.mesh.id}:${r.slot}`, { tank: t.id, fired: pile.fired, leg: pile.leg });
    }
  }
  const gone = (q) => { const mm = new (e.camera.matrixWorld.constructor)(); q.mesh.getMatrixAt(q.slot, mm); return mm.elements[0] === 0 && mm.elements[5] === 0 && mm.elements[10] === 0; };

  for (const t of armour.tanks) {
    const p = per[t.id];
    // props within the swept corridor of what the hull ACTUALLY drove
    let inCorridor = 0;
    const why = { erased: 0, ownPileUnfired: 0, otherTank: 0, noPile: 0 };
    const heights = [];
    const seen = new Set();
    for (const q of props) {
      for (let i = 0; i < p.visited.length; i++) {
        if (Math.hypot(q.x - p.visited[i][0], q.z - p.visited[i][1]) <= PLOUGH_HALF) {
          const k = `${q.mesh.id}:${q.slot}`;
          if (!seen.has(k)) {
            seen.add(k); inCorridor++;
            if (gone(q)) why.erased++;
            else {
              const o = owner.get(k);
              if (!o) { why.noPile++; if (heights.length < 24) heights.push([q.mesh.name, +q.x.toFixed(1), +q.z.toFixed(1)]); }
              else if (o.tank !== t.id) why.otherTank++;
              else why.ownPileUnfired++;
            }
          }
          break;
        }
      }
    }
    p.propsInCorridor = inCorridor;
    p.why = why;
    p.noPileSample = heights;
    p.pilesFired = t.plough.filter((q) => q.fired).length;
    p.instErased = t.plough.filter((q) => q.fired).reduce((a, q) => a + q.inst.length, 0);
    p.razed = t.stats.razed;
    p.legsDone = t.stats.legs;
    p.health = t.health;
    p.state = t.state;
    p.targetZone = t.targetZone;
    p.finalLeg = t.legIx;
    delete p.visited; delete p.samples;
  }

  return {
    zones: (m.allZones ?? []).map((z) => ({ id: z.id, owner: z.owner, locked: !!z.locked, x: +z.position.x.toFixed(1), z: +z.position.z.toFixed(1) })),
    per,
    clock: +m.roundClock.toFixed(1),
  };
}, { SPEED, SECONDS });

console.log('==== BOOT ====');
for (const l of boot) console.log(l);
console.log('\n==== ZONES ====');
console.table(res.zones);
for (const id of Object.keys(res.per)) {
  const p = res.per[id];
  console.log(`\n==== ${id} (team ${p.team}) ====`);
  console.log(`rolled@${p.rolled} died@${p.died} liveT=${p.liveT.toFixed(1)}s metres=${p.metres.toFixed(0)} legsDone=${p.legsDone} finalState=${p.state} finalLeg=${p.finalLeg} target=${p.targetZone}`);
  console.log('legs:'); console.table(p.legs);
  console.log('mass standing in front of each leg END (top m, bound = prop instances behind it):');
  console.table(p.legEndMass.map((x, i) => ({ leg: i, zone: p.legs[i].zone, ...(x ?? { none: true }) })));
  console.log(`PLOUGH  baked piles=${p.ploughBaked} (instances ${p.ploughInst}) | fired=${p.pilesFired} erasing ${p.instErased} | props inside the corridor it actually drove: ${p.propsInCorridor} | shelled off by the gun: ${p.razed}`);
  console.log(`        of those ${p.propsInCorridor} in the corridor: ERASED ${p.why.erased} | left standing: ${p.why.noPile} bound to no pile at all, ${p.why.otherTank} held by the OTHER hull's pile, ${p.why.ownPileUnfired} in an own pile that never fired`);
  if (p.noPileSample.length) console.log('        unbound sample:', JSON.stringify(p.noPileSample));
  const pc = (v) => `${((v / Math.max(1e-6, p.liveT)) * 100).toFixed(1)}%`;
  console.log(`MOTION  advance ${p.advT.toFixed(1)}s (${pc(p.advT)})  hold ${p.holdT.toFixed(1)}s (${pc(p.holdT)})`);
  console.log(`        under walking pace WHILE ADVANCING: ${p.slowAdvT.toFixed(1)}s = ${((p.slowAdvT / Math.max(1e-6, p.advT)) * 100).toFixed(1)}% of the advance`);
  console.log(`        of which pivot ${p.pivotT.toFixed(1)}s | fight-speed ${p.fightT.toFixed(1)}s | plough drag ${p.dragT.toFixed(1)}s | other ${p.rollT.toFixed(1)}s`);
  console.log('state timeline (state:leg:dir:target, clock, s):');
  for (const r of p.zoneLog) console.log('   ', r.join('  '));
}
if (errs.length) { console.log('\nPAGE ERRORS:'); for (const x of errs) console.log(' ', x); }
await b.close();
