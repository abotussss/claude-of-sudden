/**
 * WHY IS NOBODY SHOOTING? — the gate census.
 *
 * `_sixaudit.mjs` says 40.9 % of actor-time has a target and 2.7 % has a finger
 * on the trigger: SIX PER CENT of contact time is spent firing. That is the
 * ceiling on 「もっと撃って」, and it is not the burst length (median 8). This
 * samples every live bot and reports, for the men who HAVE a target, which of
 * the gates in `Agent._combat` is false — so the next knob turned is the one
 * that is actually holding the trigger up.
 *
 *   node _firegate.mjs --url=http://127.0.0.1:4481/ [--seed=7] [--samples=300]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4481/';
const SEED = args.seed ?? '7';
const SAMPLES = +(args.samples ?? 300);
const EVERY = +(args.every ?? 20);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((n) => new Promise((r) => {
  let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

await p.evaluate(() => {
  const E = window.__ENGINE__;
  const ai = E.ctx.peek('ai');
  window.__FG__ = {
    n: 0, alive: 0, target: 0, visible: 0, want: 0,
    /* of the men WITH a target, what stopped the trigger */
    gate: {
      notVisible: 0, outOfRange: 0, notPeeking: 0, movingToCover: 0,
      armour: 0, reloading: 0, dryMag: 0, post: 0, working: 0, notCombat: 0, firing: 0,
    },
    state: {},
    /* how far the fight is, for the men who have one */
    dist: [], range: [],
    indoorIdle: 0, indoor: 0,
  };
  window.__FGTICK__ = () => {
    const S = window.__FG__;
    S.n++;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      S.alive++;
      S.state[a.state] = (S.state[a.state] ?? 0) + 1;
      if (a.wantFire) S.want++;
      if (!a.hasTarget) continue;
      S.target++;
      if (a.targetVisible) S.visible++;
      const t = a.lastKnown;
      const d = Math.hypot(a.position.x - t.x, a.position.y - t.y, a.position.z - t.z);
      S.dist.push(+d.toFixed(1));
      S.range.push(+a.weaponRange.toFixed(1));
      const g = S.gate;
      if (a.wantFire) { g.firing++; continue; }
      if (a.post) { g.post++; continue; }
      if (a.working) { g.working++; continue; }
      if (a.state !== 'combat' && a.state !== 'suppressed') { g.notCombat++; continue; }
      if (a.animator?.reloading) { g.reloading++; continue; }
      if (a.ammo <= 0) { g.dryMag++; continue; }
      if (a.targetActor?.isVehicle === true) { g.armour++; continue; }
      const atCover = a.cover ? a.position.distanceTo(a.coverPos) < 0.85 : false;
      if (a.cover && !atCover) { g.movingToCover++; continue; }
      if (!a.targetVisible) { g.notVisible++; continue; }
      if (d >= a.weaponRange) { g.outOfRange++; continue; }
      if (!a.peeking) { g.notPeeking++; continue; }
      g.notVisible++; // unexplained, folded in
    }
  };
});

for (let i = 0; i < SAMPLES; i++) {
  await wait(EVERY);
  await p.evaluate(() => window.__FGTICK__());
}

const out = await p.evaluate(() => {
  const S = window.__FG__;
  const q = (arr) => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const at = (f) => s[Math.min(s.length - 1, Math.floor(s.length * f))];
    return { n: s.length, p25: at(0.25), med: at(0.5), p75: at(0.75), p95: at(0.95) };
  };
  const tot = S.target || 1;
  const pct = {};
  for (const k of Object.keys(S.gate)) pct[k] = +((S.gate[k] / tot) * 100).toFixed(1);
  return {
    ticks: S.n,
    manSamples: S.alive,
    withTargetShare: +(S.target / (S.alive || 1)).toFixed(3),
    visibleShare: +(S.visible / tot).toFixed(3),
    wantFireShare: +(S.want / (S.alive || 1)).toFixed(3),
    gatePctOfContact: pct,
    fightDistance: q(S.dist),
    weaponRange: q(S.range),
    state: S.state,
  };
});
console.log(JSON.stringify(out, null, 1));
if (errs.length) console.log('PAGEERRORS', errs.slice(0, 5));
await b.close();
