/**
 * WHERE ARE THEY, RELATIVE TO THE JOB THEY WERE GIVEN?
 *
 * `onPointShare` says 15 % of men are inside a capture circle and does not say
 * WHY the other 85 % are not. Three answers are possible and they need
 * completely different fixes: they were never given a point; they were given
 * one and are still walking to it; or they arrived and then stood outside it.
 * This separates them.
 *
 * Usage: node _sixobj.mjs --url=http://127.0.0.1:4450/ --seed=7
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4450/';
const SEED = +(args.seed ?? 7);
const SAMPLES = +(args.samples ?? 40);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => page.evaluate((k) => new Promise((r) => {
  let i = 0; const t = () => (++i >= k ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);
await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 2; });
await page.waitForFunction(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  return m && String(m.phase).toLowerCase() === 'live';
}, null, { timeout: 120000 }).catch(() => {});
await wait(60);

await page.evaluate(() => {
  const e = window.__ENGINE__, ai = e.ctx.peek('ai'), m = e.ctx.peek('match');
  const zones = m.capture ? m.capture.zones : [];
  const S = { modes: {}, dists: [], noObj: 0, n: 0, atObj: 0, onZone: 0, siteObj: 0, byState: {} };
  window.__O__ = S;
  window.__TICK__ = () => {
    for (const a of ai.agents) {
      if (!a.alive) continue;
      S.n++;
      const o = a.objective;
      if (!o) { S.noObj++; continue; }
      S.modes[o.mode] = (S.modes[o.mode] ?? 0) + 1;
      if (o.site) S.siteObj++;
      const d = Math.hypot(o.position.x - a.position.x, o.position.z - a.position.z);
      S.dists.push(+d.toFixed(1));
      if (d < 9) S.atObj++;
      for (const z of zones) {
        const dx = z.position.x - a.position.x, dz = z.position.z - a.position.z;
        if (dx * dx + dz * dz <= z.radius * z.radius) { S.onZone++; break; }
      }
      const k = a.state + (d < 9 ? ':near' : ':far');
      S.byState[k] = (S.byState[k] ?? 0) + 1;
    }
  };
});
for (let i = 0; i < SAMPLES; i++) { await wait(14); await page.evaluate(() => window.__TICK__()); }

const r = await page.evaluate(() => {
  const S = window.__O__;
  const s = [...S.dists].sort((a, b) => a - b);
  const q = (f) => (s.length ? s[Math.floor(s.length * f)] : null);
  const m = window.__ENGINE__.ctx.peek('match');
  return {
    actorSamples: S.n,
    shareNoObjective: +(S.noObj / S.n).toFixed(3),
    shareObjectiveHasSite: +(S.siteObj / S.n).toFixed(3),
    modeShare: Object.fromEntries(Object.entries(S.modes).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, +((v / S.n) * 100).toFixed(1)])),
    distToOwnObjective: { p10: q(0.1), p25: q(0.25), med: q(0.5), p75: q(0.75), p90: q(0.9), max: s[s.length - 1] },
    shareWithin9mOfOwnObjective: +(S.atObj / S.n).toFixed(3),
    shareInsideAnyCaptureCircle: +(S.onZone / S.n).toFixed(3),
    stateByProximity: Object.fromEntries(Object.entries(S.byState).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, +((v / S.n) * 100).toFixed(1)])),
    zones: m.capture ? m.capture.zones.map((z) => ({ n: z.name, r: z.radius, owner: z.owner })) : null,
  };
});
console.log(JSON.stringify(r, null, 1));
if (errs.length) console.log('pageerrors', errs.slice(0, 4));
await browser.close();
