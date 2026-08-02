/**
 * DOES ANYBODY SHOOT AT THE DRONES? — the number for item 4.
 *
 * 「ドローンは捕捉されたらちゃんと撃つようにして 間に合わなくてもいい 捕捉される前に
 *  近くにいても撃つようにして」. A drone was scenery in exactly the way a tank was:
 * not an `Agent`, therefore never in `hostilesOf`, therefore never anybody's
 * target. This counts, per tick with at least one machine aloft:
 *
 *   • bots whose CURRENT target is a drone,
 *   • of the men a drone has LOCKED, how many are shooting back at it,
 *   • and the pool's own outcome table — how many were shot down.
 *
 *   node _droneaim.mjs --url=http://127.0.0.1:4481/ [--seed=7] [--scale=8]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4481/';
const SEED = args.seed ?? '7';
const SCALE = +(args.scale ?? 8);
const SAMPLES = +(args.samples ?? 300);
const EVERY = +(args.every ?? 12);

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
await p.evaluate((s) => { window.__ENGINE__.ctx.time.scale = s; }, SCALE);

await p.evaluate(() => {
  const E = window.__ENGINE__;
  const ai = E.ctx.peek('ai');
  const m = E.ctx.peek('match');
  window.__DA__ = {
    ticks: 0, aloftTicks: 0, aimers: 0, maxAimers: 0,
    locked: 0, lockedShooting: 0, eliteAimers: 0, hostileListed: 0,
  };
  window.__DATICK__ = () => {
    const S = window.__DA__;
    S.ticks++;
    const list = m.drones?.list ?? [];
    let aloft = 0;
    for (const d of list) if (d.alive) aloft++;
    if (!aloft) return;
    S.aloftTicks++;
    // Is a live drone actually in somebody's hostile list at all?
    for (const t of [0, 1]) {
      for (const h of ai.hostilesOf(t)) if (ai.isDrone(h)) { S.hostileListed++; break; }
    }
    let n = 0;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      if (ai.isDrone(a.targetActor)) {
        n++;
        if (a.elite) S.eliteAimers++;
      }
    }
    S.aimers += n;
    if (n > S.maxAimers) S.maxAimers = n;
    for (const d of list) {
      if (!d.alive || !d.target) continue;
      S.locked++;
      if (d.target.targetActor === d) S.lockedShooting++;
    }
  };
});

for (let i = 0; i < SAMPLES; i++) {
  await wait(EVERY);
  await p.evaluate(() => window.__DATICK__());
}

const out = await p.evaluate(() => {
  const S = window.__DA__;
  const m = window.__ENGINE__.ctx.peek('match');
  return {
    ticks: S.ticks,
    ticksWithADroneAloft: S.aloftTicks,
    droneInAHostileList: S.hostileListed,
    meanBotsAimingAtADrone: S.aloftTicks ? +(S.aimers / S.aloftTicks).toFixed(2) : 0,
    maxBotsAimingAtADrone: S.maxAimers,
    /* THE ONE THE REQUEST NAMES: of the men a drone had locked, how many were
       shooting back at the thing coming to kill them. */
    lockedManShootingBackShare: S.locked ? +(S.lockedShooting / S.locked).toFixed(3) : null,
    lockSamples: S.locked,
    eliteAimSamples: S.eliteAimers,
    droneStats: m.drones?.stats ?? null,
  };
});
console.log(JSON.stringify(out, null, 1));
if (errs.length) console.log('PAGEERRORS', errs.slice(0, 5));
await b.close();
