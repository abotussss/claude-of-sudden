/**
 * HOW FAST IS THE ROSTER ACTUALLY MOVING, AND HOW LONG DOES A LEG TAKE?
 *
 * 「AIが走ってない … これにより到達時間がかかりすぎ」 — the two numbers that
 * sentence is about, measured on a live match rather than read off the tuning
 * table, because `desiredSpeed` is intent and what matters is the metres.
 *
 *   meanSpeed        mean of `Agent.speed` over every live man, every sample
 *   meanMoveSpeed    the same over men who WANT to move (`desiredSpeed > 0.1`),
 *                    which is the honest walking pace — a man holding an angle
 *                    at 0 m/s is not slow, he is stationary on purpose
 *   legs             time from being handed an objective more than 18 m away to
 *                    standing within 2.5 m of it, per man per objective
 *   sprintShare      share of moving samples with the sprint flag up (0 before)
 *
 * Usage: node _sprintprobe.mjs --url=http://127.0.0.1:4505/ --seed=7 --ticks=600
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4505/';
const SEED = +(args.seed ?? 7);
const TICKS = +(args.ticks ?? 600);
const SCALE = +(args.scale ?? 4);

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
await page.evaluate((s) => { window.__ENGINE__.ctx.time.scale = s; }, SCALE);
await page.waitForFunction(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  return m && String(m.phase).toLowerCase() === 'live';
}, null, { timeout: 180000 }).catch(() => {});
await wait(60);

await page.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const ai = ctx.peek('ai');
  const S = {
    n: 0, sumSpeed: 0, moveN: 0, moveSum: 0, sprintN: 0, noTarget: 0,
    legs: [], open: new Map(), t0: ctx.time.elapsed, t: 0, states: {},
    byGun: {},
  };
  window.__S__ = S;
  window.__TICK__ = () => {
    const t = ctx.time.elapsed;
    S.t = t - S.t0;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      S.n++;
      S.sumSpeed += a.speed;
      if (!a.hasTarget) S.noTarget++;
      S.states[a.state] = (S.states[a.state] ?? 0) + 1;
      if (a.desiredSpeed > 0.1) {
        S.moveN++;
        S.moveSum += a.speed;
        if (a.sprinting) S.sprintN++;
        const g = a.weaponId ?? '?';
        const b = S.byGun[g] ?? (S.byGun[g] = { n: 0, sum: 0, sprint: 0 });
        b.n++; b.sum += a.speed; if (a.sprinting) b.sprint++;
      }
      const o = a.objective;
      const k = a.id;
      if (!o) { S.open.delete(k); continue; }
      const dx = o.position.x - a.position.x;
      const dz = o.position.z - a.position.z;
      const d = Math.hypot(dx, dz);
      const key = `${o.mode}|${o.position.x.toFixed(1)},${o.position.z.toFixed(1)}`;
      const leg = S.open.get(k);
      if (!leg || leg.key !== key) {
        if (d > 18) S.open.set(k, { key, t0: t, d0: d });
        else S.open.delete(k);
        continue;
      }
      if (d < 2.5) { S.legs.push([+leg.d0.toFixed(1), +(t - leg.t0).toFixed(2)]); S.open.delete(k); }
      else if (t - leg.t0 > 150) S.open.delete(k);
    }
  };
});

for (let i = 0; i < TICKS; i++) { await wait(6); await page.evaluate(() => window.__TICK__()); }

const r = await page.evaluate(() => {
  const S = window.__S__;
  const secs = S.legs.map((l) => l[1]).sort((a, b) => a - b);
  const dists = S.legs.map((l) => l[0]).sort((a, b) => a - b);
  const med = (x) => (x.length ? x[Math.floor(x.length / 2)] : null);
  const mean = (x) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : null);
  return {
    gameSeconds: +S.t.toFixed(1),
    samples: S.n,
    meanSpeed: +(S.sumSpeed / Math.max(1, S.n)).toFixed(3),
    movingShare: +(S.moveN / Math.max(1, S.n)).toFixed(3),
    meanMoveSpeed: +(S.moveSum / Math.max(1, S.moveN)).toFixed(3),
    sprintShare: +(S.sprintN / Math.max(1, S.moveN)).toFixed(3),
    noTargetShare: +(S.noTarget / Math.max(1, S.n)).toFixed(3),
    legs: S.legs.length,
    legMeanSeconds: mean(secs) === null ? null : +mean(secs).toFixed(2),
    legMedianSeconds: med(secs),
    legMedianMetres: med(dists),
    legMeanMetres: mean(dists) === null ? null : +mean(dists).toFixed(1),
    legMeanMps: mean(secs) ? +(mean(dists) / mean(secs)).toFixed(3) : null,
    states: S.states,
    byGun: Object.fromEntries(Object.entries(S.byGun).map(([k, v]) => [k, {
      meanSpeed: +(v.sum / v.n).toFixed(2), sprintShare: +(v.sprint / v.n).toFixed(3), n: v.n,
    }])),
  };
});

console.log(JSON.stringify({ url: URL, seed: SEED, scale: SCALE, pageerrors: errs, ...r }, null, 2));
await browser.close();
