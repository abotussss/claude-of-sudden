/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT IS ACTUALLY LIGHTING NACHTFELD, AND WHAT IS THE METER LOOKING AT?
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfkey.mjs [--url=…] [--map=plains]
 *
 * `_nflight.mjs` proved the surfaces and the exposure move together, which says
 * "the whole frame is lifted" but not BY WHAT. This asks the sky for the actual
 * celestial state — moon altitude, phase, disc fraction, the intensity that came
 * out the far end — and asks the renderer which directional light it decided was
 * the sun and what the two fill bands are set to.
 *
 * The one number that matters most is `moonLight.intensity`. A night map with a
 * moon key has directional shadow; a night map whose key is zero is lit by the
 * ambient bands alone, which is flat, shadowless and reads as overcast day no
 * matter what colour the sky is.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const MAP = args.map ?? 'plains';
const BASE = args.url ?? `http://127.0.0.1:4603/?map=${MAP}&capture=1`;

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

const dump = () => page.evaluate(() => {
  const e = window.__ENGINE__;
  const sky = e.ctx.peek('sky');
  const r = e.ctx.peek('render');
  const c = sky?.celestial;
  const deg = (x) => +((x * 180) / Math.PI).toFixed(2);
  const col = (l) => l ? `${l.color.r.toFixed(2)},${l.color.g.toFixed(2)},${l.color.b.toFixed(2)}` : null;
  const v3 = (u) => u ? `${u.value.x.toFixed(4)},${u.value.y.toFixed(4)},${u.value.z.toFixed(4)}` : null;
  let exp = null; try { exp = r.debugExposure(); } catch (err) { exp = { error: String(err.message) }; }
  const pu = r?.patcher?.uniforms ?? {};
  return {
    hour: sky?.hour,
    sunAlt: deg(c?.sunAlt ?? 0), moonAlt: deg(c?.moonAlt ?? 0),
    moonPhase: +(c?.moonPhase ?? -1).toFixed(4),
    sunI: +(sky?.sunLight?.intensity ?? -1).toFixed(5), sunC: col(sky?.sunLight),
    moonI: +(sky?.moonLight?.intensity ?? -1).toFixed(5), moonC: col(sky?.moonLight),
    moonVis: sky?.moonLight?.visible, sunVis: sky?.sunLight?.visible,
    keyLight: sky?.keyLight?.name,
    ambient: sky ? `${sky.ambientColor.r.toFixed(4)},${sky.ambientColor.g.toFixed(4)},${sky.ambientColor.b.toFixed(4)}` : null,
    indirectScale: +(sky?.indirectScale ?? -1).toFixed(3),
    exposureBias: +(sky?.exposureBias ?? -1).toFixed(3),
    activeSun: r?.activeSun?.name, activeSunI: +(r?.activeSun?.intensity ?? -1).toFixed(5),
    fallbackSunVisible: r?.sun?.visible,
    skyFill: v3(pu.owSkyFill), groundFill: v3(pu.owGroundFill),
    ambLevel: +(r?._ambLevel ?? -1).toFixed(5),
    envIntensity: r?.scene?.environmentIntensity ?? e.ctx.scene?.environmentIntensity,
    csm: r?.csm ? { lambda: r.csm.lambda, far: r.csm.far ?? null, cascades: r.csm.cascades?.length ?? r.csm.count ?? null } : null,
    exp,
  };
});

console.log('map=', await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));
console.log('\n--- at __READY__ ---');
console.log(JSON.stringify(await dump(), null, 1));
for (const n of [30, 120, 300]) {
  await frames(n);
  console.log(`\n--- +${n} frames ---`);
  const d = await dump();
  console.log(JSON.stringify({ sunI: d.sunI, moonI: d.moonI, activeSun: d.activeSun, activeSunI: d.activeSunI, skyFill: d.skyFill, groundFill: d.groundFill, exp: d.exp }, null, 1));
}
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '\n0 pageerrors');
await b.close();
