/**
 * ════════════════════════════════════════════════════════════════════════════
 * PICTURES OF THE POLICY — 「とにかく戦車の踏破力を高くして基本何でも破壊して進める」
 * ════════════════════════════════════════════════════════════════════════════
 * Numbers are not what the player is looking at. This drives a hull BY HAND —
 * no match, no bots, no clock, so the frame is reproducible — to the two places
 * the policy change is visible, and photographs each:
 *
 *   climb-*   the tallest STEP on any baked leg, approached and crested, shot
 *             side-on and low so the hull's pitch reads against the horizon.
 *   plough-*  the biggest pile on any leg, BEFORE and AFTER the glacis reaches
 *             it, from ONE camera so the two frames are comparable.
 *
 * The camera is placed off the hull's own frame, and it is ALWAYS put somewhere
 * with air around it — a shot from inside a rock is not evidence.
 *
 *   node _policyshots.mjs [url] [seed]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://127.0.0.1:4423/';
const SEED = process.argv[3] ?? '7';
const SHOTS = './shots/policy';
mkdirSync(SHOTS, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const sleep = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });

/* ---- quiet the world so only the hull moves ----------------------------- */
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ui = e.ctx.peek('ui');
  if (m.phase !== 'live') m._setPhase?.('live', 0);
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  m._updateRespawns = () => {};
  for (const a of m.air ?? []) a.enabled = false;
  ui?.setHudVisible?.(false);
  e.ctx.viewScene.visible = false;
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);

  /**
   * ════════════════════════════════════════════════════════════════════════
   * THE HULL MUST STOP BEING DRIVEN, OR THE PHOTOGRAPH IS OF SOMEWHERE ELSE
   * ════════════════════════════════════════════════════════════════════════
   * `Armour.update` runs `_drive` + `_pose` on every live frame. Placing a
   * hull by hand and then waiting 320 ms for the frame to settle gives the
   * drive twenty frames to retarget it onto another leg and pose it there —
   * which is why two passes of this file produced immaculate photographs of
   * market stalls with no tank in them. The debris clocks still have to run
   * (a pile that never falls is not a picture of ploughing), so what is
   * replaced is the driving, not the whole system.
   */
  const a = m.tank;
  a._frozenUpdate = (dt) => {
    for (const t of a.tanks) {
      for (const pile of t.plough ?? []) {
        const u = pile.uniforms;
        if (pile.fired && u && u.uT.value >= 0 && u.uT.value < 30) {
          u.uT.value = Math.min(30, u.uT.value + dt);
        }
      }
    }
  };
  a.update = a._frozenUpdate;
});

/**
 * Put the eye where it can actually SEE the hull. A fixed bearing and distance
 * is how you photograph the inside of a wall: side-on at 11 m from a hull in a
 * street is inside the building on that side about half the time. Every
 * candidate is tested with the engine's own `lineOfSight` against `MASK.SIGHT`
 * from the eye to the hull's deck, and the first clear one wins; `prefer` is
 * tried first so a deliberate angle is kept when it happens to be clear.
 */
async function look(id, prefer, lookAtY = 1.6) {
  return page.evaluate(
    async ({ id, prefer, lookAtY }) => {
      const e = window.__ENGINE__;
      const m = e.ctx.peek('match');
      const ph = e.ctx.peek('physics');
      const player = e.ctx.peek('player');
      const V = e.camera.position.constructor;
      const t = m.tank.tanks.find((x) => x.id === id);
      const aim = new V(t.position.x, t.position.y + lookAtY, t.position.z);
      const eye = new V();

      const cands = [];
      for (const [rel, dist, h] of prefer) cands.push([rel, dist, h]);
      for (const rel of [Math.PI * 0.5, -Math.PI * 0.5, Math.PI * 0.72, -Math.PI * 0.72,
        Math.PI * 0.28, -Math.PI * 0.28, Math.PI, 0]) {
        for (const dist of [10, 13, 17, 22]) {
          for (const h of [2.2, 4.5, 7.5]) cands.push([rel, dist, h]);
        }
      }
      for (const [rel, dist, h] of cands) {
        const a = t.yaw + rel;
        const x = t.position.x + Math.sin(a) * dist;
        const z = t.position.z + Math.cos(a) * dist;
        const g = ph.groundHeight(x, z, 60);
        const base = Number.isFinite(g) ? g : t.position.y;
        const y = base + h;
        eye.set(x, y + 1.62, z);
        if (!ph.lineOfSight(eye, aim, ph.MASK.SIGHT)) continue;
        const v = m.sites[0].position.clone().set(x, y, z);
        const dx = t.position.x - x;
        const dz = t.position.z - z;
        const dy = aim.y - (y + 1.62);
        const pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
        /**
         * THE YAW CONVENTION IS SETTLED BY PROJECTING, NOT BY REMEMBERING IT.
         * `respawnAt`'s yaw sign is easy to get backwards and the symptom is a
         * beautifully composed photograph of the wall behind the camera — which
         * is exactly what the first two passes of this file produced. Both
         * signs are tried, a frame is drawn, and the hull is projected through
         * the real camera: the one that puts it inside the viewport wins.
         */
        for (const sign of [1, -1]) {
          player.respawnAt(v, Math.atan2(sign * dx, sign * dz));
          player.movement.pitch = pitch;
          await new Promise((r) => requestAnimationFrame(r));
          await new Promise((r) => requestAnimationFrame(r));
          const ndc = aim.clone().project(e.ctx.camera);
          if (ndc.z > 0 && ndc.z < 1 && Math.abs(ndc.x) < 0.92 && Math.abs(ndc.y) < 0.92) {
            return {
              hull: [+t.position.x.toFixed(1), +t.position.y.toFixed(2), +t.position.z.toFixed(1)],
              pitchDeg: +((t._pitch * 180) / Math.PI).toFixed(1),
              s: +t.s.toFixed(1),
              cam: { rel: +rel.toFixed(2), dist, h, sign },
              ndc: [+ndc.x.toFixed(2), +ndc.y.toFixed(2)],
            };
          }
        }
      }
      return { err: 'no clear vantage' };
    },
    { id, prefer, lookAtY }
  );
}

/** Park a hull at arc position `s` on leg `legIx` and pose it. */
async function place(id, legIx, s) {
  return page.evaluate(
    ({ id, legIx, s }) => {
      const m = window.__ENGINE__.ctx.peek('match');
      const a = m.tank;
      const t = m.tank.tanks.find((x) => x.id === id);
      if (t.state === 'parked') {
        t.state = 'hold';
        t.alive = true;
        t.hold = 1e9;
        t.root.visible = true;
        t.wreck.visible = false;
        t.uniforms.uT.value = -1;
        for (const c of t.colliders) c.c.enabled = true;
      }
      t.legIx = legIx;
      t.legDir = 1;
      t.s = s;
      t.yaw = t.legs[legIx].YAW[Math.min(t.legs[legIx].n - 1, Math.round(s / 1.25))];
      a._pose(t);
      return { y: +t.position.y.toFixed(2), pitch: +((t._pitch * 180) / Math.PI).toFixed(1) };
    },
    { id, legIx, s }
  );
}

/* ---- 1. THE TALLEST STEP ------------------------------------------------ */
const step = await page.evaluate(() => {
  const a = window.__ENGINE__.ctx.peek('match').tank;
  let best = null;
  for (const t of a.tanks) {
    for (let li = 0; li < t.legs.length; li++) {
      const leg = t.legs[li];
      for (let i = 2; i < leg.n - 2; i++) {
        if (!best || leg.STEP[i] > best.step) {
          best = {
            id: t.id, legIx: li, i, s: leg.S[i],
            step: leg.STEP[i], road: leg.ROAD[i],
            x: leg.X[i], z: leg.Z[i], zone: leg.zone ?? 'HUB',
          };
        }
      }
    }
  }
  return best;
});
console.log('[policyshots] tallest baked step:', JSON.stringify(step));

if (step) {
  for (const [tag, ds] of [['a-before', -9], ['b-nose-up', -2.4], ['c-on-top', 1.2], ['d-over', 6]]) {
    const r = await place(step.id, step.legIx, Math.max(0, step.s + ds));
    /**
     * TWO BEARINGS PER MOMENT, BOTH ELEVATED. Side-on and low is the angle a
     * pitch reads best at and it is also the angle that is inside a building
     * half the time in a street this narrow — and passing a line-of-sight test
     * is not the same as having the hull in frame, which the first attempt
     * proved by photographing a road with the tank behind the step. Elevated
     * and looking down always frames it; two sides means one of them is not
     * into the sun.
     */
    for (const [side, rel] of [['L', Math.PI * 0.5], ['R', -Math.PI * 0.5]]) {
      const c = await look(step.id, [[rel, 13, 5.0], [rel, 17, 7.0]], 1.0);
      await sleep(320);
      await shot(`climb-${tag}-${side}`);
      console.log(`  climb-${tag}-${side}: hull y=${r.y} pitch=${r.pitch}deg cam=${JSON.stringify(c.cam ?? c)}`);
    }
  }
}

/* ---- 2. THE BIGGEST PILE ------------------------------------------------ */
const pile = await page.evaluate(() => {
  const a = window.__ENGINE__.ctx.peek('match').tank;
  let best = null;
  for (const t of a.tanks) {
    for (const q of t.plough ?? []) {
      /**
       * THE TALLEST PILE, NOT THE ONE WITH THE MOST INSTANCES. 72 instances of
       * litter spread over three metres of road is the biggest pile by count
       * and photographs as two identical frames — the honest picture of the
       * raised ceiling is the mass that only became ploughable BECAUSE of it,
       * which is the tall one. A handful of instances is enough to see go.
       */
      if (q.inst.length < 6) continue;
      if (!best || q.top > best.top) {
        best = {
          id: t.id, legIx: q.leg, s: q.s, top: q.top,
          n: q.inst.length, x: q.x, z: q.z, ix: q.ix,
        };
      }
    }
  }
  return best;
});
console.log('[policyshots] biggest pile:', JSON.stringify(pile));

if (pile) {
  // BEFORE: nose short of the pile, camera fixed for both frames.
  await place(pile.id, pile.legIx, Math.max(0, pile.s - 11));
  const cam = await page.evaluate(
    ({ x, z }) => {
      const e = window.__ENGINE__;
      const m = e.ctx.peek('match');
      const ph = e.ctx.peek('physics');
      const player = e.ctx.peek('player');
      // stand off to one side of the pile, above head height, looking at it
      const V = e.camera.position.constructor;
      const aim = new V(x, 1.0, z);
      const eye = new V();
      for (const r of [9, 12, 16]) {
        for (const bearing of [0.6, 2.0, 3.7, 5.2]) {
          for (const h of [2.4, 4.5]) {
            const ox = x + Math.sin(bearing) * r;
            const oz = z + Math.cos(bearing) * r;
            const g = ph.groundHeight(ox, oz, 60);
            if (!Number.isFinite(g)) continue;
            const y = g + h;
            eye.set(ox, y + 1.62, oz);
            if (!ph.lineOfSight(eye, aim, ph.MASK.SIGHT)) continue;
            const v = m.sites[0].position.clone().set(ox, y, oz);
            const dx = x - ox;
            const dz = z - oz;
            const dy = aim.y - (y + 1.62);
            player.respawnAt(v, Math.atan2(-dx, -dz));
            player.movement.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
            return { ox: +ox.toFixed(1), oz: +oz.toFixed(1), y: +y.toFixed(1), r, bearing };
          }
        }
      }
      return { err: 'no clear vantage on the pile' };
    },
    { x: pile.x, z: pile.z }
  );
  console.log('  pile camera at', JSON.stringify(cam));
  await sleep(340);
  await shot('plough-a-before');

  // AFTER: run the hull past it so `_checkPlough` fires, then re-shoot.
  await page.evaluate(
    ({ id, legIx, s }) => {
      const m = window.__ENGINE__.ctx.peek('match');
      const a = m.tank;
      const t = a.tanks.find((x) => x.id === id);
      t.legIx = legIx;
      t.legDir = 1;
      for (let q = Math.max(0, s - 11); q <= s + 4; q += 0.4) {
        t.s = q;
        a._checkPlough(t);
      }
      a._pose(t);
    },
    { id: pile.id, legIx: pile.legIx, s: pile.s }
  );
  await sleep(900); // let the debris fall
  await shot('plough-b-after');
  const fired = await page.evaluate(({ id }) => {
    const t = window.__ENGINE__.ctx.peek('match').tank.tanks.find((x) => x.id === id);
    return (t.plough ?? []).filter((q) => q.fired).length;
  }, { id: pile.id });
  console.log(`  piles fired by that pass: ${fired}`);
  /**
   * ────────────────────────────────────────────────────────────────────────
   * AND THEN IT IS WATCHED UNTIL IT LANDS — 「空中に瓦礫が浮いてます」
   * ────────────────────────────────────────────────────────────────────────
   * `_ploughfloat.mjs` passes and cannot answer this: it measures COLLISION,
   * and plough debris is visual-only by design, so a chunk that hangs in the
   * air for ever is invisible to it and perfectly visible to the player. The
   * pile's own clock is stepped by hand and photographed, and the highest
   * chunk's height over the pile is printed at each step: the sequence has to
   * come DOWN.
   */
  for (const [tag, wait] of [['c-t1', 700], ['d-t3', 2000], ['e-t6', 3000], ['f-t12', 6000]]) {
    await sleep(wait);
    const h = await page.evaluate(({ id, ix }) => {
      const a = window.__ENGINE__.ctx.peek('match').tank;
      const t = a.tanks.find((x) => x.id === id);
      const q = (t.plough ?? []).find((r) => r.ix === ix);
      if (!q?.mesh) return null;
      // where the chunks END UP is `aOff` applied to the baked matrix; the
      // shader lerps to it over `aMot`, so the settled height is baked.
      const off = q.mesh.geometry.getAttribute('aOff');
      const mat = q.mesh.instanceMatrix.array;
      let hi = -Infinity;
      for (let i = 0; i < off.count; i++) {
        const y = mat[i * 16 + 13] + off.getY(i);
        if (y > hi) hi = y;
      }
      return { uT: +q.uniforms.uT.value.toFixed(2), settledTop: +(hi - q.y).toFixed(2), road: +q.y.toFixed(2) };
    }, { id: pile.id, ix: pile.ix });
    await shot(`plough-${tag}`);
    console.log(`  plough-${tag}: ${JSON.stringify(h)}`);
  }
}

console.log(`\n[policyshots] wrote to ${SHOTS}`);
if (errs.length) console.log('PAGEERRORS:', errs);
await b.close();
