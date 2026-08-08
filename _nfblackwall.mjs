/**
 * THE BLACK CEILING, PHOTOGRAPHED FROM A CAMERA THAT STAYS PUT.
 *
 *   node _nfblackwall.mjs [--url=…] [--out=shots/blackwall] [--pitch=70] [--n=14]
 *
 * 「塹壕に入ると天井みたいな黒い壁が出てくる そう言うのが至る所にある」
 *
 * WHY THIS PROBE EXISTS WHEN _nftrenchceil.mjs ALREADY DID
 * ────────────────────────────────────────────────────────
 * That one poses the camera like this:
 *
 *     e.camera.rotation.set(pitch, yaw, 0);
 *     e.ctx.peek('player')?.teleport?.(e.camera.position, yaw);
 *     e.camera.rotation.set(pitch, yaw, 0);
 *     …then pumps 40 frames…
 *
 * `player.teleport(eye, rot)` only reads a PITCH out of `rot` when `rot` is an
 * object (`rot.x`); handed a bare number it sets yaw and leaves `movement.pitch`
 * alone — at 0. Forty frames later `CameraRig.applyTo` has written
 * `movement.pitch` back over `camera.rotation`, so every "look straight up in
 * the trench" frame that probe has ever produced was shot LEVEL. Both previous
 * bisects were argued from those frames.
 *
 * Here the pose goes through the player, in the player's own units, and is
 * READ BACK off the camera after the frames have run and printed with the shot,
 * so a pose that did not hold is visible in the log rather than in a conclusion.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4616/?map=plains&capture=1';
const OUT = args.out ?? 'shots/blackwall';
const PITCH = Number(args.pitch ?? 70) * Math.PI / 180;
const N = Number(args.n ?? 14);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const lvl = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
console.log('level.id =', lvl);
if (lvl !== 'plains') { console.error('WRONG MAP'); await b.close(); process.exit(2); }

await p.evaluate(() => {
  const e = window.__ENGINE__;
  /**
   * CONTROL STAYS ON. `Player.update` writes the camera only under
   * `if (this.controlEnabled)` — turn it off and the rig stops applying, the
   * camera is frozen wherever it was, and every teleport is silently a no-op.
   * Input is what gets frozen: `frozen` zeroes the look delta and `enabled=false`
   * stops the keys, so the pose the teleport sets is the pose that survives.
   */
  e.input.frozen = true; e.input.enabled = false;
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
  // The viewmodel is in `ctx.viewScene`, a second scene composited over the
  // world; it is a dark mass in the middle of every frame and it is not what
  // anybody is complaining about.
  e.ctx.viewScene?.traverse?.((o) => { if (o.isMesh || o.isInstancedMesh || o.isSprite) o.visible = false; });
});

/* ── where the camera drops below the ground around it ────────────────────── */
const cuts = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world'); const ph = e.ctx.peek('physics');
  const groundY = w.level.groundY;
  const out = [];
  for (let x = -174; x <= 174; x += 2) {
    for (let z = -174; z <= 174; z += 2) {
      if (x * x + z * z > 174 * 174) continue;
      const gy = ph.groundHeight(x, z); if (!isFinite(gy)) continue;
      const drop = groundY(x, z) - gy; if (drop < 0.8) continue;
      if (!ph.checkCapsule({ x, y: gy + 0.4, z }, { x, y: gy + 1.4, z }, 0.35)) continue;
      out.push([x, z, +gy.toFixed(2), +drop.toFixed(2)]);
    }
  }
  return out;
});
console.log(`${cuts.length} sampled cut cells (2 m lattice, floor ≥0.8 m under plainsY)`);

/* spread the sample: farthest-point over the cut set so all 14 lines get one */
const spots = [];
if (cuts.length) {
  spots.push(cuts[0]);
  while (spots.length < N) {
    let best = null, bestD = -1;
    for (const c of cuts) {
      let d = Infinity;
      for (const s of spots) d = Math.min(d, (c[0] - s[0]) ** 2 + (c[1] - s[1]) ** 2);
      if (d > bestD) { bestD = d; best = c; }
    }
    if (!best || bestD < 4) break;
    spots.push(best);
  }
}

const frames = (n) => p.evaluate((k) => new Promise((d) => {
  let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

/**
 * Pose through the player, in the player's units, then READ BACK. `rot` must be
 * an object for the pitch to survive — see the header.
 */
const place = (x, z, pitch, yaw, stance = 'stand') => p.evaluate(([x, z, pitch, yaw, stance]) => {
  const e = window.__ENGINE__; const ph = e.ctx.peek('physics'); const pl = e.ctx.peek('player');
  const gy = ph.groundHeight(x, z);
  pl.teleport({ x, y: gy + 1.66, z }, { x: pitch, y: yaw });
  // Stance is a TOGGLE (`_updateStance`), so with the keys frozen a written
  // `stanceWant` sticks and the rig settles the eye to 1.02 on its own.
  pl.movement.stanceWant = stance;
  return { gy: +gy.toFixed(2) };
}, [x, z, pitch, yaw, stance]);

const camState = () => p.evaluate(() => {
  const e = window.__ENGINE__; const c = e.camera;
  const d = { x: 0, y: 0, z: 0 };
  const m = c.matrixWorld.elements;
  d.x = -m[8]; d.y = -m[9]; d.z = -m[10];
  return {
    pos: [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)],
    dir: [+d.x.toFixed(3), +d.y.toFixed(3), +d.z.toFixed(3)],
    pitchDeg: +(Math.asin(d.y) * 180 / Math.PI).toFixed(1),
    stance: e.ctx.peek('player')?.movement?.stance,
  };
});

const log = [];
for (const [x, z, gy, drop] of spots) {
  const id = `x${x}_z${z}`;
  for (const stance of ['stand', 'crouch']) {
    await place(x, z, PITCH, 0.0, stance);
    await frames(30);
    const st = await camState();
    const f = `${OUT}/${id}_${stance}_up.png`;
    await p.screenshot({ path: f });
    console.log(`  · ${id} ${stance} floor ${gy} drop ${drop}  → cam ${st.pos} pitch ${st.pitchDeg}° stance ${st.stance}`);
    log.push({ x, z, gy, drop, stance, cam: st, file: f });
  }
}
writeFileSync(`${OUT}/poses.json`, JSON.stringify(log, null, 1));
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '\n0 pageerrors');
await b.close();
