/**
 * WHICH CLAUSE OF `Agent._sprintGate` IS ACTUALLY STOPPING THEM?
 *
 * The gate is eight refusals in a row (@see `SPRINT_SPEED`), and "20 % of the
 * roster is running" is not an answer to "why is the other 80 % walking". This
 * re-reads every clause off the live agents, in the gate's own order, for every
 * man who is in ADVANCE with a long leg in front of him — the only population
 * the gate can ever say yes to.
 *
 * Usage: node _sprintwhy.mjs --url=http://127.0.0.1:4505/ --seed=7
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4505/';
const SEED = +(args.seed ?? 7);
const TICKS = +(args.ticks ?? 240);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => page.evaluate((k) => new Promise((r) => {
  let i = 0; const t = () => (++i >= k ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);
await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 4; });
await page.waitForFunction(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  return m && String(m.phase).toLowerCase() === 'live';
}, null, { timeout: 180000 }).catch(() => {});
await wait(60);

await page.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const ai = ctx.peek('ai');
  const S = { n: 0, why: {}, sprintSpeed: 0, sprintN: 0, walkSpeed: 0, walkN: 0, aheadHist: {} };
  window.__W__ = S;
  const bump = (k) => { S.why[k] = (S.why[k] ?? 0) + 1; };
  window.__TICK__ = () => {
    for (const a of ai.agents) {
      if (!a.alive) continue;
      if (a.sprinting) { S.sprintN++; S.sprintSpeed += a.speed; }
      else if (a.desiredSpeed > 0.1) { S.walkN++; S.walkSpeed += a.speed; }
      const o = a.objective;
      if (!o || a.state !== 'advance') continue;
      const dist = Math.hypot(o.position.x - a.position.x, o.position.z - a.position.z);
      if (dist < 16) continue;
      S.n++;
      S.aheadHist[a._ahead] = (S.aheadHist[a._ahead] ?? 0) + 1;
      if (a.hasTarget || a.suppression > 0.15) { bump('contact'); continue; }
      if (a.working || a.post || a.postClimbing || a.crouch) { bump('busy'); continue; }
      if (!a.hasMoveTarget || a._detourTimer > 0 || a.stuckRung !== 0) { bump('unstick'); continue; }
      if (a.lastKnownAge < 4
        && a.position.distanceToSquared(a.lastKnown) < 26 * 26) { bump('threatcall'); continue; }
      if (!a._sprintArmed) { bump('winded'); continue; }
      if (a._ahead > 0) { bump('crowd'); continue; }
      if (Math.sin(a.yaw) * a._steer.x + Math.cos(a.yaw) * a._steer.z < 0.55) { bump('turning'); continue; }
      bump(a.sprinting ? 'RUNNING' : 'passed-but-not-running');
    }
  };
});
for (let i = 0; i < TICKS; i++) { await wait(6); await page.evaluate(() => window.__TICK__()); }
const r = await page.evaluate(() => {
  const S = window.__W__;
  const pct = Object.fromEntries(Object.entries(S.why)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => [k, +(v / S.n).toFixed(3)]));
  return {
    longLegSamples: S.n, share: pct,
    meanSprintSpeed: +(S.sprintSpeed / Math.max(1, S.sprintN)).toFixed(2),
    meanWalkSpeed: +(S.walkSpeed / Math.max(1, S.walkN)).toFixed(2),
    aheadHist: S.aheadHist,
  };
});
console.log(JSON.stringify({ seed: SEED, pageerrors: errs, ...r }, null, 2));
await browser.close();
