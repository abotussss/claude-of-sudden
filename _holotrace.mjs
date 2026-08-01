/**
 * RETICLE vs POINT OF IMPACT — measured two independent ways.
 *
 * 1. GEOMETRICALLY. The reticle's apparent direction from the eye against the
 *    direction the projectile sim was actually handed, and the physics' own
 *    `bullet:impact` position projected back onto the screen.
 * 2. PHOTOGRAPHICALLY. The rendered frame is searched for the reticle (the only
 *    strongly red thing on screen) and for the impact scar the rounds left on
 *    the wall, and the two pixel positions are compared. Nothing about the fire
 *    path is assumed: the rounds are fired through `tryFire`, they fly through
 *    `ProjectileSim.fixedUpdate`, and physics decides where they stop.
 *
 *   node _holotrace.mjs --url=http://127.0.0.1:4292/ --out=/tmp/holo.png --shots=8
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4292/';
const OUT = args.out ?? '/tmp/holo-trace.png';
const BASE = args.base ?? null; // clean frame to difference the impact against
const WEAPON = args.w ?? 'ak';
const SHOTS = Number(args.shots ?? 6);
const SPREAD = args.spread === undefined ? 0 : Number(args.spread);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const pump = (n) =>
  page.evaluate(
    (n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }),
    n
  );

await page.evaluate(() => window.__ENGINE__.ctx.peek('ui')?.setHudVisible?.(false));
await page.evaluate((w) => window.__ENGINE__.ctx.peek('weapons').debugPose('ads', { weapon: w }), WEAPON);
await pump(60);

/* A clean frame first: same pose, no rounds fired. The impact scar is whatever
 * differs between this and the frame after the burst. */
mkdirSync(dirname(OUT), { recursive: true });
const CLEAN = OUT.replace(/\.png$/, '-clean.png');
await page.screenshot({ path: CLEAN });

const geo = await page.evaluate(
  async ([SHOTS, SPREAD]) => {
    const ctx = window.__ENGINE__.ctx;
    const wp = ctx.peek('weapons');
    const vm = wp.viewmodel;
    const cam = ctx.camera;
    const vcam = ctx.viewCamera;
    const V = vm.rig.position.constructor;

    const impacts = [];
    const fired = [];
    /**
     * `p.point`. The payload PhysicsSystem.emitImpact publishes has `point`,
     * `normal` and `incident` — reading `p.position` recorded nothing at all
     * and the first run of this tool reported "0 impacts" while the wall was
     * visibly being shot.
     */
    ctx.events.on('bullet:impact', (p) => {
      if (p.exit) return;
      impacts.push([p.point.x, p.point.y, p.point.z]);
    });
    /**
     * THE BULLET'S DIRECTION IS NOT IN `weapon:fire`. That event carries
     * `vm.boreDir()` for the muzzle flash; `tryFire` hands the projectile sim a
     * different vector (camera forward + the spread cone). Measuring the event
     * measured the bore and reported 343 mrad of disagreement that does not
     * exist. So the sim's own entry point is wrapped instead.
     */
    const spawn0 = wp.sim.spawn.bind(wp.sim);
    wp.sim.spawn = (o) => {
      fired.push([o.dir.x, o.dir.y, o.dir.z]);
      return spawn0(o);
    };

    /** WORLD direction and position — the camera may be parented, so local
     * quaternions are not the camera's actual orientation. */
    const camPos = cam.getWorldPosition(new V());
    const camFwd = cam.getWorldDirection(new V()).normalize();

    const reticleW = vm.reticle.getWorldPosition(new V());
    const reticleVisible = vm.reticle.visible;
    const reticleDir = reticleW.clone().sub(camPos).normalize();

    /** Project with FRESH matrices: `matrixWorldInverse` is only maintained by
     * the renderer, and reading it between frames measures the wrong frame. */
    const project = (p, c) => {
      c.updateMatrixWorld(true);
      c.matrixWorldInverse.copy(c.matrixWorld).invert();
      c.updateProjectionMatrix();
      const q = p.clone().project(c);
      return [(q.x * 0.5 + 0.5) * innerWidth, (-q.y * 0.5 + 0.5) * innerHeight];
    };

    wp._spread = SPREAD;
    const before = wp.stats.fired;
    for (let i = 0; i < SHOTS; i++) {
      wp._fireTimer = 0;
      wp.state.mag = 30;
      wp.state.chambered = true;
      wp._spread = SPREAD;
      wp.tryFire();
      await new Promise((r) => { let n = 0; const t = () => (++n >= 4 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
    }
    /**
     * Let the recoil springs come all the way home before the shutter. At 60
     * frames the weapon was still 30 px from where the clean frame had it, so
     * the difference image was mostly VIEWMODEL and the "impact scar" centroid
     * was measuring the gun moving, not the wall being hit.
     */
    await new Promise((r) => { let n = 0; const t = () => (++n >= 240 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });

    const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
    return {
      reticleVisible,
      reticleScreen: project(reticleW, vcam),
      reticleOffMrad: angle(reticleDir, camFwd) * 1000,
      firedCount: wp.stats.fired - before,
      fireDirOffMrad: fired.map((d) => angle(new V(d[0], d[1], d[2]).normalize(), camFwd) * 1000),
      camFov: cam.fov,
      viewFov: vcam.fov,
      w: innerWidth,
      h: innerHeight,
      /**
       * ANGLES, NOT PIXELS, for the geometric half of this.
       *
       * `Vector3.project` against a camera whose matrices this tool refreshes
       * itself disagreed with the RENDERED frame by 148 px on a reticle the
       * photograph puts 1 px off centre, so the projection is not measuring
       * what is on screen and is not reported. The angle a landmark subtends
       * at the eye is unambiguous, and it is the thing that decides whether the
       * dot covers the hit: `reticleToImpact` is the angle between the
       * direction the reticle is seen in and the direction the round's hole is
       * seen in, from the same eye.
       */
      impacts: impacts.slice(0, 12).map((p) => {
        const v = new V(p[0], p[1], p[2]);
        const d = v.clone().sub(camPos).normalize();
        return {
          offMrad: angle(d, camFwd) * 1000,
          fromReticleMrad: angle(d, reticleDir) * 1000,
          dist: v.distanceTo(camPos),
        };
      }),
      impactCount: impacts.length,
    };
  },
  [SHOTS, SPREAD]
);

await page.screenshot({ path: OUT });
await browser.close();

/* ---------------------------------------------------------------- photo --- */
/** Brightest strongly-red pixel cluster: the emitter. */
function findReticle(png) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      if (r > 150 && r - g > 70 && r - b > 70) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  return n ? { x: sx / n, y: sy / n, n } : null;
}

/** Where the two frames differ, ignoring the reticle's own pixels. */
function findScar(a, b, box) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  let best = 0;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = (y * a.width + x) * 4;
      const r = b.data[i];
      const g = b.data[i + 1];
      const bl = b.data[i + 2];
      if (r > 150 && r - g > 70 && r - bl > 70) continue; // the reticle
      const d =
        Math.abs(a.data[i] - r) + Math.abs(a.data[i + 1] - g) + Math.abs(a.data[i + 2] - bl);
      if (d > 40) {
        sx += x * d;
        sy += y * d;
        n += d;
        best = Math.max(best, d);
      }
    }
  }
  return n ? { x: sx / n, y: sy / n, weight: n, peak: best } : null;
}

const after = PNG.sync.read(readFileSync(OUT));
const clean = PNG.sync.read(readFileSync(CLEAN));
const ret = findReticle(after);
/**
 * Only inside the sight picture. Everything else that differs between the two
 * frames — brass on the floor, smoke, the weapon's own settle — is not where
 * the bullet went, and a whole-frame centroid is dominated by it.
 */
const box = {
  x0: Math.round(after.width / 2 - 110),
  x1: Math.round(after.width / 2 + 110),
  y0: Math.round(after.height / 2 - 55),
  y1: Math.round(after.height / 2 + 55),
};
const scar = findScar(clean, after, box);

const cx = geo.w / 2;
const cy = geo.h / 2;
const pxPerMrad = geo.h / 2 / (Math.tan((geo.camFov * Math.PI) / 360) * 1000);
console.log(`[holotrace] ${WEAPON}  ${geo.w}x${geo.h}  worldFov=${geo.camFov.toFixed(2)}  viewFov=${geo.viewFov.toFixed(2)}`);
console.log(`  shots fired ${geo.firedCount}   impacts ${geo.impactCount}   spread ${SPREAD} deg`);
console.log(`  RETICLE   visible=${geo.reticleVisible}  off camera axis ${geo.reticleOffMrad.toFixed(3)} mrad`);

if (ret) console.log(`            PHOTOGRAPHED at (${ret.x.toFixed(1)}, ${ret.y.toFixed(1)}) over ${ret.n} px  = centre + (${(ret.x - cx).toFixed(1)}, ${(ret.y - cy).toFixed(1)}) px`);
console.log(`  BULLETS   fire dirs off camera axis [${geo.fireDirOffMrad.map((v) => v.toFixed(3)).join(', ')}] mrad`);
for (const im of geo.impacts)
  console.log(
    `  IMPACT    ${im.dist.toFixed(2)} m  off camera axis ${im.offMrad.toFixed(3)} mrad` +
      `   ANGLE FROM RETICLE ${im.fromReticleMrad.toFixed(3)} mrad = ${(im.fromReticleMrad * pxPerMrad).toFixed(2)} px`
  );
if (scar)
  console.log(`  SCAR      PHOTOGRAPHED at (${scar.x.toFixed(1)}, ${scar.y.toFixed(1)})  = centre + (${(scar.x - cx).toFixed(1)}, ${(scar.y - cy).toFixed(1)}) px   peak delta ${scar.peak}`);
if (ret && scar)
  console.log(`  >>> reticle -> impact scar  ${Math.hypot(scar.x - ret.x, scar.y - ret.y).toFixed(1)} px  =  ${(Math.hypot(scar.x - ret.x, scar.y - ret.y) / pxPerMrad).toFixed(2)} mrad`);
console.log(`  (1 mrad = ${pxPerMrad.toFixed(2)} px at this FOV)`);
if (errs.length) console.log('[holotrace] page errors:', errs.slice(0, 5));
console.log(`[holotrace] wrote ${OUT} and ${CLEAN}`);
process.exit(errs.length ? 1 : 0);
