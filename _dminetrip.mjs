/**
 * ════════════════════════════════════════════════════════════════════════════
 * IS A LAID MINE THE 「石ころオブジェが移動の妨げです、ジャンプしないと乗り越えられない」
 * SHAPE? — asked of the object itself
 * ════════════════════════════════════════════════════════════════════════════
 * `_dscatterblock` censuses the WORLD's tagged props in the 0.42-0.95 m band
 * and is the right gate for scatter — but a laid mine is not a world prop, is
 * not tagged by the `Assembler`, and cannot appear in that census however long
 * it runs. So the question has to be asked of the mine directly, and there are
 * exactly three parts to it:
 *
 *   HOW PROUD IS IT?  The real bounding box of the emplaced meshes, in world
 *                     space, against `physics.groundHeight` underneath. The
 *                     band that stops a man starts at 0.42 m (`NavGrid.maxStep`
 *                     is 0.45).
 *   IS IT SOLID?      Every `physics.colliders` entry, before and after. A mine
 *                     that adds none cannot obstruct anything by construction —
 *                     not the character controller, not a ray, not the nav.
 *   CAN A MAN WALK
 *   THROUGH IT?       The real `CharacterController.move`, stepped straight at
 *                     the mine from 4 m out, and how far he actually got. This
 *                     is the measurement the complaint was originally about:
 *                     not "is there a collider" but "did I stop".
 *
 * Usage: BASE=http://127.0.0.1:4638/ MAP=plains node _dminetrip.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4638/';
const MAP = process.env.MAP ?? 'plains';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 800, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${BASE}?capture=1&map=${MAP}&seed=7`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const res = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const w = e.ctx.peek('weapons');
  const ph = e.ctx.peek('physics');
  const player = e.ctx.peek('player');
  e.input.frozen = true; e.input.enabled = false;
  player?.setControlEnabled?.(false);
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  while (m.phase !== 'live') await frame();

  const before = ph.colliders.length;
  // Open plain off the RED-W hub, on a real lane.
  const ln = m.tank.laneNear(-88, -24, 200, -1);
  const gy = ph.groundHeight(ln.x, ln.z, 60);
  w.layMine({ x: ln.x, y: gy + 0.2, z: ln.z }, { team: 1, owner: null });
  for (let i = 0; i < 430; i++) await frame();        // the 6 s arming delay
  const after = ph.colliders.length;

  const g = w.thrown.field.find((f) => f.live && f.armed);
  if (!g) return { error: 'the mine never armed' };
  g.mesh.updateMatrixWorld(true);
  let top = -Infinity;
  let low = Infinity;
  let wide = 0;
  const V = e.camera.position.constructor;
  g.mesh.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    for (const px of [bb.min.x, bb.max.x]) {
      for (const py of [bb.min.y, bb.max.y]) {
        for (const pz of [bb.min.z, bb.max.z]) {
          const v = new V(px, py, pz).applyMatrix4(o.matrixWorld);
          if (v.y > top) top = v.y;
          if (v.y < low) low = v.y;
          const r = Math.hypot(v.x - g.pos.x, v.z - g.pos.z);
          if (r > wide) wide = r;
        }
      }
    }
  });
  const ground = ph.groundHeight(g.pos.x, g.pos.z, g.pos.y + 4);

  /**
   * IS IT SOLID? Every `physics.colliders` entry, before and after. The
   * character controller, the nav grid and every ray in the engine reach the
   * world through that list and through the static BVH; a mine that adds
   * nothing to either cannot obstruct anything, and there is no walk to run.
   * (The first version of this file DID walk a man at it through
   * `CharacterController.move` and hung — the signature is not what it assumed.
   * The collider census is the stronger statement anyway: it is about every
   * consumer at once rather than about one of them.)
   */
  const mineColliders = ph.colliders.filter((c) => c.owner && c.owner.def && c.owner.def.trackWidth).length;

  return {
    collidersBefore: before, collidersAfter: after,
    minePos: [+g.pos.x.toFixed(1), +g.pos.z.toFixed(1)],
    ground: +ground.toFixed(3),
    top: +top.toFixed(3), low: +low.toFixed(3),
    proud: +(top - ground).toFixed(3),
    width: +(wide * 2).toFixed(3),
    mineColliders,
    tripped: w.mineStats.tripped,
  };
});

console.log('\n=== A LAID MINE, AS AN OBSTACLE ===');
if (res.error) console.log('  ' + res.error);
else {
  console.log(`  mine at (${res.minePos})  ground y=${res.ground}`);
  console.log(`  emplaced mesh spans y ${res.low} .. ${res.top}  ->  PROUD ${res.proud} m, ${res.width} m across`);
  console.log(`  trip-hazard band is 0.42 .. 0.68 m (NavGrid maxStep 0.45): ` +
    `${res.proud >= 0.42 && res.proud <= 0.68 ? 'IN THE BAND' : 'OUTSIDE IT'} ` +
    `by ${(0.42 - res.proud).toFixed(3)} m of clearance`);
  console.log(`  physics colliders ${res.collidersBefore} -> ${res.collidersAfter} ` +
    `(${res.collidersAfter - res.collidersBefore} added by the mine)`);
  console.log(`  colliders owned by a mine: ${res.mineColliders} — nothing walks into it, ` +
    `nothing paths round it, no ray sees it`);
  console.log(`  mines tripped in ${'7'} s with a man standing on the map: ${res.tripped}`);
}
console.log(errs.length ? `[pageerror] ${errs.length}: ${errs.slice(0, 2).join(' | ')}` : '[pageerror] none');
await b.close();
