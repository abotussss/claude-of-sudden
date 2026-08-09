/**
 * IS THE BATTERY INERT BEFORE IT IS ARMED?
 *
 * `stuckcheck` samples the first ~42 match seconds, so if this feature could
 * move that number it would have to do it without ever having been called. The
 * probe plays the same window `stuckcheck` does and asserts the three things
 * that would have to be false for the battery to be the cause.
 */
import { chromium } from 'playwright';
const URL = process.argv[2];
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = []; p.on('pageerror', e => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const tri0 = await p.evaluate(() => window.__ENGINE__.ctx.peek('physics').staticWorld?.mask?.length ?? -1);
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await p.waitForTimeout(12000);
const out = await p.evaluate((t0) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const bt = m.battery;
  const ph = e.ctx.peek('physics');
  return {
    matchSecond: +(1200 - m.roundClock).toFixed(0),
    phase: m.phase,
    score: [m.score[0], m.score[1]],
    battArmed: bt.armed, battRounds: bt.stats.rounds,
    hiddenArmed: !!m._hiddenArmed,
    /** the battery adds no collider, no BVH triangle and no nav cell */
    staticTris: ph.staticWorld?.mask?.length ?? -1,
    staticTrisAtBoot: t0,
    drawCount: bt._hullMesh.count,
    inAiVehicles: (e.ctx.peek('ai').vehicles ?? []).some((v) => bt.vehicles.includes(v)),
  };
}, tri0);
console.log(JSON.stringify(out));
console.log('[pageerror]', errs.length ? errs[0] : 'none');
await b.close();
