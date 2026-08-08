/**
 * THE BOUNDARY, PHOTOGRAPHED FROM WHERE THE PLAYER GOT OUT.
 *
 * Stands on each station's rampart walk looking outward, and at the two leak
 * crossings `boundcheck` named, so the fix is looked at and not only measured.
 *
 * The camera is posed with `src/dev/shots.js`'s own pattern — freeze input,
 * disable the controller, pose, then `player.teleport(cam.position,
 * cam.rotation)`. Setting `camera.position` alone does NOT hold: the player
 * system overwrites it on the next frame and the shot comes back from wherever
 * the man was standing. Two agents have lost cycles to that.
 *
 *   node _nfedgeshot.mjs [url] [outdir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://127.0.0.1:4617/?map=plains';
const OUT = process.argv[3] ?? 'shots/nfedge';
mkdirSync(OUT, { recursive: true });

/** [name, eye x, eye y, eye z, look x, look y, look z] in LEVEL space. */
const SHOTS = [
  // ON THE OUTBOARD WALK, mid-rampart: the station centre is the pad slid
  // `INSET` inboard, and the walk's outboard flat is 17.8 m out from it along
  // the radial. r 174.0.
  ['A-walk-outward', -130.4, 5.31, -114.9, -150, 4.0, -132],
  // …the two crossings, at the eye height a man ON THE OLD RAMPART WALK had
  // (3.61 + 1.7). A `null` here finds a mast leg cap 15 m up and photographs the
  // sky, which is not the question.
  ['A-leak-1', -139, 5.31, -108, -152, 3.0, -118],
  ['A-leak-2', -143, 5.31, -102, -155, 3.0, -110],
  ['A-leak-1-ground', -139, null, -108, -152, 3.0, -118],
  ['A-yard', -118, null, -104, -134, 4.0, -116],
  ['B-walk-outward', 130.4, 5.31, 114.9, 150, 4.0, 132],
  ['B-yard', 118, null, 104, 134, 4.0, 116],
  ['C-outward', -128, null, 86, -152, 6.0, 102],
  ['E-outward', 128, null, -86, 152, 6.0, -102],
  ['A-outside-view', -100, null, -88, -140, 8.0, -118],
  ['E-fallen-pylon', 92, null, -146, 110, 3.0, -140],
  ['A-generator', -104, null, -120, -97, 4.0, -126],
];

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('map', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

await p.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.banner?.hide?.();
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
});

for (const [name, ex, ey, ez, lx, ly, lz] of SHOTS) {
  const info = await p.evaluate(async ([ex, ey, ez, lx, ly, lz]) => {
    const e = window.__ENGINE__;
    const w = e.ctx.peek('world'), ph = e.ctx.peek('physics'), pl = e.ctx.peek('player');
    const V3 = e.camera.position.constructor;
    const wp = w.levelToWorld(ex, 0, ez, new V3());
    // eye height: named, or 1.7 m over whatever the ray finds standing here
    let y = ey;
    if (y === null) {
      const h = ph.raycast(wp.x, w.level.groundY(ex, ez) + 40, wp.z, 0, -1, 0, 60, ph.MASK.CHARACTER);
      y = (h.hit ? h.point.y : w.level.groundY(ex, ez)) + 1.7;
    }
    const eye = w.levelToWorld(ex, y, ez, new V3());
    const look = w.levelToWorld(lx, ly, lz, new V3());
    const cam = e.camera;
    cam.position.copy(eye);
    cam.lookAt(look);
    // …and the teleport, which is the half that actually holds. @see shots.js
    pl?.teleport?.(cam.position, cam.rotation);
    await new Promise((d) => { let i = 0; const t = () => (++i >= 30 ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); });
    cam.position.copy(eye); cam.lookAt(look);
    await new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d)));
    const q = pl?.position ?? cam.position;
    return { eyeY: +y.toFixed(2), restY: +q.y.toFixed(2), r: +Math.hypot(ex, ez).toFixed(1) };
  }, [ex, ey, ez, lx, ly, lz]);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name.padEnd(18)} r ${String(info.r).padStart(6)}  eye y ${String(info.eyeY).padStart(6)}  capsule rested at ${info.restY}`);
}
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
