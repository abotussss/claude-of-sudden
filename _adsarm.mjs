/**
 * THE ADS SUPPORT ARM, SEARCHED — 「ADS時の手がおかしな方向になっているのも治して」
 *
 *   node _adsarm.mjs [--url=…] [--sweep] [--out=shots/adsarm]
 *
 * The support forearm measures 25-40 degrees off the bore at the hip, which is
 * the reference, and 50-76 in ADS, which is the defect. One experiment has
 * already been tried and reverted: moving the support SHOULDER fixed ADS
 * (54.9 -> 38.1) and destroyed the hip (33.5 -> 98.4), because a shoulder is
 * one position shared by both poses.
 *
 * So the search is over an offset that is MULTIPLIED BY `adsT` — identically
 * zero at the hip, by construction — and every candidate is scored on BOTH
 * poses, because that trade is the whole history of this problem.
 *
 * It also dumps the raw geometry (shoulder, elbow, wrist, extension) so the
 * result can be reasoned about afterwards rather than instead.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4424/';
const OUT = args.out ?? 'shots/adsarm';
const WEAPONS = (args.only ? String(args.only) : 'rifle,ak,sniper,lmg,smg').split(',');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => window.__ENGINE__.ctx.peek('ui')?.setHudVisible?.(false));

/** Settle the rig properly: the arm is not re-solved until update() runs. */
const settle = () =>
  page.evaluate(
    () => new Promise((r) => { let i = 0; const t = () => (++i >= 12 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); })
  );

/** Forearm vs bore + the geometry behind it, for the weapon currently posed. */
const measure = () =>
  page.evaluate(() => {
    const vm = window.__ENGINE__.ctx.peek('weapons').viewmodel;
    const a = vm.armL;
    const V = a.elbow.constructor;
    const d = a.hand.position.clone().sub(a.elbow).normalize();
    const deg = (Math.acos(Math.max(-1, Math.min(1, d.dot(new V(0, 0, -1))))) * 180) / Math.PI;
    const ext = a.hand.position.distanceTo(a.shoulder) / (a.l1 + a.l2);
    const fore = a.hand.position.clone().sub(a.elbow).normalize();
    const fwd = new V(0, 0, -1).applyQuaternion(a.hand.quaternion).normalize();
    const wrist = (Math.acos(Math.max(-1, Math.min(1, fore.dot(fwd)))) * 180) / Math.PI;
    const p = (v) => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
    return {
      fore: +deg.toFixed(1), wrist: +wrist.toFixed(1), ext: +ext.toFixed(3),
      shoulder: p(a.shoulder), elbow: p(a.elbow), wristPos: p(a.hand.position),
    };
  });

const pose = (id, kind) =>
  page.evaluate(([id, kind]) => window.__ENGINE__.ctx.peek('weapons').debugPose(kind, { weapon: id }), [id, kind]);

/** Both poses for one weapon, with the current engine settings. */
async function both(id) {
  await pose(id, 'idle'); await settle();
  const hip = await measure();
  await pose(id, 'ads'); await settle();
  const ads = await measure();
  return { id, hip, ads };
}

console.log('=== BASELINE (current build) ===');
const base = [];
for (const id of WEAPONS) {
  const r = await both(id);
  base.push(r);
  console.log(
    `  ${id.padEnd(7)} hip ${String(r.hip.fore).padStart(5)} deg (ext ${r.hip.ext})   ` +
      `ads ${String(r.ads.fore).padStart(5)} deg (ext ${r.ads.ext})` +
      (r.ads.fore > 40 ? '   <-- ADS OUT OF BAND' : '')
  );
}
console.log('\n  geometry, rifle ADS:', JSON.stringify(base.find((b) => b.id === 'rifle')?.ads ?? {}));
console.log('  geometry, rifle hip:', JSON.stringify(base.find((b) => b.id === 'rifle')?.hip ?? {}));

/* ---- the sweep ---------------------------------------------------------
 * `adsShoulder` is an offset added to the SUPPORT shoulder, scaled by adsT.
 * The engine does not read such a field yet — the point of the sweep is to
 * find out whether one is worth adding, and what it should be. It is injected
 * here by monkey-patching the per-frame shoulder write, which is exactly where
 * a real implementation would live. */
if (args.sweep) {
  console.log('\n=== SWEEP: support shoulder offset x adsT (hip is untouched by construction) ===');
  await page.evaluate(() => {
    const vm = window.__ENGINE__.ctx.peek('weapons').viewmodel;
    if (vm.__patched) return;
    vm.__patched = true;
    vm.__off = { x: 0, y: 0, z: 0 };
    // The engine now applies its own ADS shoulder offset in _solveHands. Cancel
    // it here so the sweep measures the CANDIDATE alone rather than the sum.
    vm.__engineOff = { y: 0.075, z: 0.17 };
    const orig = vm._solveHands.bind(vm);
    vm._solveHands = function (w, res) {
      orig(w, res);
      const t = this.adsT;
      if (t > 1e-4) {
        this.armL.shoulder.y -= this.__engineOff.y * t;
        this.armL.shoulder.z -= this.__engineOff.z * t;
        // Re-solve the support arm with the shoulder displaced, so the change
        // is measured through the real two-bone solve rather than estimated.
        this.armL.shoulder.x += this.__off.x * t;
        this.armL.shoulder.y += this.__off.y * t;
        this.armL.shoulder.z += this.__off.z * t;
        this.armL.solve(this._handPosL, this._handQuatL);
      }
    };
  });

  const trials = [];
  for (const y of [0.02, 0.05, 0.08]) {
    for (const z of [0.06, 0.09, 0.12]) trials.push({ x: 0, y, z });
  }
  const results = [];
  for (const off of trials) {
    await page.evaluate((o) => { window.__ENGINE__.ctx.peek('weapons').viewmodel.__off = o; }, off);
    let worstAds = 0, worstHip = 0, sumAds = 0, worstExt = 0;
    for (const id of WEAPONS) {
      const r = await both(id);
      worstAds = Math.max(worstAds, r.ads.fore);
      worstHip = Math.max(worstHip, r.hip.fore);
      worstExt = Math.max(worstExt, r.ads.ext);
      sumAds += r.ads.fore;
    }
    results.push({ off, worstAds: +worstAds.toFixed(1), worstHip: +worstHip.toFixed(1), meanAds: +(sumAds / WEAPONS.length).toFixed(1) });
    console.log(
      `  off (${off.x.toFixed(2)}, ${off.y.toFixed(2)}, ${off.z.toFixed(2)})  ` +
        `ads mean ${(sumAds / WEAPONS.length).toFixed(1)} worst ${worstAds.toFixed(1)}   hip worst ${worstHip.toFixed(1)}   ads ext worst ${worstExt.toFixed(3)}${worstExt >= 0.995 ? ' CLAMPED' : ''}`
    );
  }
  results.sort((a, b) => a.worstAds - b.worstAds);
  console.log('\n  best by worst-ADS (hip worst must stay <= 40):');
  for (const r of results.filter((r) => r.worstHip <= 40).slice(0, 6)) {
    console.log(`    (${r.off.x}, ${r.off.y}, ${r.off.z})  ads mean ${r.meanAds} worst ${r.worstAds}  hip worst ${r.worstHip}`);
  }
}

console.log(`\npageerrors: ${errs.length}`);
for (const e of errs.slice(0, 4)) console.log('  ' + e);
await browser.close();
