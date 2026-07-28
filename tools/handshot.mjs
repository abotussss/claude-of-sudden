/**
 * HAND CAPTURE — photograph the first-person hands on every weapon, hip and ADS.
 *
 *   node tools/handshot.mjs [--url=…] [--out=/tmp/shots] [--only=rifle,pistol]
 *
 * Exists because the hands are the one part of this game that headless numbers
 * cannot judge. Every hand defect found so far — the "mystery ring" at the
 * wrist, the support hand parked beside the handguard with daylight behind it,
 * the knife held in a fanned-open fist — was invisible in the contact solve's
 * own output and obvious in a picture. It also prints, per weapon, whether the
 * shooting-hand solve actually RAN (`rhandPose` gains a `:id` suffix when it
 * does) which is how a silently skipped fit gets caught.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4173/';
const OUT = args.out ?? '/tmp/shots';
const ONLY = args.only ? String(args.only).split(',') : null;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const ids = await page.evaluate(() => window.__ENGINE__.ctx.peek('weapons').weaponIds);
const list = ONLY ? ids.filter((i) => ONLY.includes(i)) : ids;
console.log('[handshot] weapons:', ids.join(', '));

await page.evaluate(() => window.__ENGINE__.ctx.peek('ui')?.setHudVisible?.(false));

const settle = () =>
  page.evaluate(
    () => new Promise((r) => { let i = 0; const t = () => (++i >= 45 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); })
  );

for (const id of list) {
  for (const kind of ['idle', 'ads']) {
    const info = await page.evaluate(
      ([id, kind]) => {
        const wp = window.__ENGINE__.ctx.peek('weapons');
        wp.debugPose(kind, { weapon: id });
        const w = wp.viewmodel.weapons.get(id);
        /**
         * ARM EXTENSION, because a straight forearm is not a matter of taste.
         * `Arm.solve` clamps the target to 99.5% of (l1 + l2); at the clamp the
         * elbow locks dead straight and the limb reads as a broomstick, which is
         * exactly what the AR support arm looks like. Anything over ~0.97 is the
         * defect, not a pose choice.
         */
        const ext = (arm) =>
          arm ? +(arm.hand.position.distanceTo(arm.shoulder) / (arm.l1 + arm.l2)).toFixed(3) : null;
        return {
          rhandPose: w?.rhandPose,
          lhandPose: w?.lhandPose,
          hasGripCyl: !!w?.model?.nodes?.gripCylinder,
          hasHandguard: !!w?.model?.nodes?.handguard,
          extR: ext(wp.viewmodel.armR),
          extL: ext(wp.viewmodel.armL),
          fitR: w?.fitR ?? null,
          fitL: w?.fitL ?? null,
        };
      },
      [id, kind]
    );
    await settle();
    /**
     * How close the elbow gets to the EYE, measured in world space after the
     * rig transform. A forearm sleeve is 68 mm across, so an elbow inside about
     * 0.25 m projects its rear end cap as a disc tens of pixels wide sitting in
     * the middle of the screen — the "mystery ring". Reported for ADS as well as
     * hip because the two poses put the elbows in completely different places.
     */
    /**
     * WRIST ANGLE — the thing the contact solve cannot see.
     *
     * Every fingertip can be 0.3 mm off the handle and the hand can still look
     * broken, because "the fingers are touching" says nothing about how the hand
     * meets the ARM. Reported as "意味のわからない手首の曲がり方". A human wrist
     * does about 70 deg of flexion and 60 of extension at the extreme, and a
     * firing grip lives around 15-35; past ~70 the joint is not a wrist any more
     * and no amount of finger tuning will rescue it.
     *
     * Measured as the angle between the FOREARM axis (elbow -> wrist) and the
     * hand's own forward (-Z of the hand basis, the direction the fingers run).
     */
    const wrist = await page.evaluate(() => {
      const vm = window.__ENGINE__.ctx.peek('weapons').viewmodel;
      const out = {};
      for (const [k, arm] of [['R', vm.armR], ['L', vm.armL]]) {
        if (!arm) continue;
        const V = arm.elbow.constructor;
        const fore = arm.hand.position.clone().sub(arm.elbow).normalize();
        const fwd = new V(0, 0, -1).applyQuaternion(arm.hand.quaternion).normalize();
        out[k] = +((Math.acos(Math.max(-1, Math.min(1, fore.dot(fwd)))) * 180) / Math.PI).toFixed(1);
      }
      return out;
    });
    console.log(`             ${kind.padEnd(4)} wrist bend  R=${wrist.R} deg  L=${wrist.L} deg` +
      (Math.max(wrist.R ?? 0, wrist.L ?? 0) > 70 ? '   <-- BEYOND A HUMAN WRIST' : ''));
    const elb = await page.evaluate(() => {
      const vm = window.__ENGINE__.ctx.peek('weapons').viewmodel;
      const cam = window.__ENGINE__.ctx.viewCamera ?? window.__ENGINE__.ctx.camera;
      const out = {};
      for (const [k, arm] of [['R', vm.armR], ['L', vm.armL]]) {
        if (!arm || !cam) continue;
        const p = arm.elbow.clone().applyMatrix4(arm.root.matrixWorld);
        out[k] = +p.distanceTo(cam.getWorldPosition(new (p.constructor)())).toFixed(3);
      }
      return out;
    });
    console.log(`             ${kind.padEnd(4)} elbow->eye  R=${elb.R} m  L=${elb.L} m` +
      (Math.min(elb.R ?? 9, elb.L ?? 9) < 0.25 ? '   <-- sleeve end cap will show as a ring' : ''));
    const file = `${OUT}/${id}-${kind}.png`;
    await page.screenshot({ path: file, clip: { x: 500, y: 300, width: 1000, height: 560 } });
    if (kind === 'idle') {
      console.log(
        `  ${id.padEnd(8)} rhand=${String(info.rhandPose).padEnd(16)} lhand=${String(info.lhandPose).padEnd(16)}` +
          ` gripCyl=${info.hasGripCyl ? 'yes' : 'NO '} extR=${info.extR} extL=${info.extL}` +
          (info.extL >= 0.97 || info.extR >= 0.97 ? '   <-- ARM CLAMPED, elbow locks straight' : '')
      );
      /**
       * The fingertip gaps are the whole diagnosis. Near zero = the fingers are
       * on the handle and any remaining ugliness is pose or placement. Tens of
       * millimetres = the hand is nowhere near the handle and no amount of curl
       * tuning will ever close it.
       */
      for (const [side, fit] of [['R', info.fitR], ['L', info.fitL]]) {
        if (!fit) continue;
        const mm = fit.gaps.map((g) => (g * 1000).toFixed(1).padStart(6));
        const worst = Math.max(...fit.gaps.map(Math.abs)) * 1000;
        console.log(
          `             ${side} ${String(fit.pose).padEnd(14)} r=${(fit.radius * 1000).toFixed(1)}mm` +
            ` tipGap(mm) [${mm.join(' ')} ]` +
            (worst > 3 ? `  <-- NOT TOUCHING (worst ${worst.toFixed(1)} mm)` : '  ok')
        );
      }
    }
  }
}

if (errs.length) console.log('[handshot] page errors:', errs.slice(0, 5));
console.log(`[handshot] wrote ${list.length * 2} captures to ${OUT}`);
await browser.close();
process.exit(errs.length ? 1 : 0);
