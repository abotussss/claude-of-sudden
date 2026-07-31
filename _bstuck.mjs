/**
 * STUCKCHECK AND FIGHTCHECK, ON A TOWN THAT COMES DOWN INSIDE THE ROUND.
 *
 *   node _bstuck.mjs [--url=…]
 *
 * `?demo=down` (src/match/airstrike.js `_bootFlag`) collapses the six blocks at
 * BOOT, which is what lets every boot-time gate — sitecheck, navcheck,
 * boundcheck, lanecheck, solidcheck, floorcheck, throughcheck — measure the
 * levelled city. It does NOT survive into a round: `Airstrike.reset()` puts the
 * town back at round start (`site.demo.setVisual(false)` … `down = false`), so
 * `tools/stuckcheck.mjs` and `tools/fightcheck.mjs`, which both DRIVE a match,
 * are measuring the intact map whatever the URL says. Verified: at `__READY__`
 * all six read down, at `phase === 'live'` all six read up.
 *
 * So the demolition is fired HERE, after the round is live, with
 * `Airstrike.forceDemoNav(true)` — the ruin drawn, the ruin solid, the nav patch
 * applied, which is the settled state a `DISTRICT-A`/`DISTRICT-B` salvo leaves
 * behind. `stuckcheck`'s sampler is copied verbatim so the 0/29 bar means the
 * same thing.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4256/';
const RAZE = args.raze !== 'no';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const wait = (n) =>
  p.evaluate(
    (n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }),
    n
  );

await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await p.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 240000 });
await wait(120);

if (RAZE) {
  const n = await p.evaluate(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    return m.airstrike.forceDemoNav(true);
  });
  const st = await p.evaluate(() =>
    window.__ENGINE__.ctx.peek('world').demolitions.map((d) => `${d.id}:${d.down ? 1 : 0}`).join(' ')
  );
  console.log(`  [raze] forceDemoNav brought ${n} blocks down mid-round — ${st}`);
  await wait(60);
} else {
  console.log('  [raze] skipped — measuring the intact town');
}

/* ---- tools/stuckcheck.mjs's sampler, verbatim ---------------------------- */
await p.evaluate(() => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  window.__ST__ = { last: new Map(), stuck: new Map(), samples: 0, moved: new Map() };
  window.__TICK__ = () => {
    const S = window.__ST__;
    S.samples++;
    for (const a of ai.agents ?? ai.actors ?? []) {
      if (!a.alive) continue;
      const q = a.position ?? a.pos;
      if (!q) continue;
      const k = a.name ?? String(a.id ?? Math.random());
      const prev = S.last.get(k);
      const wants = (a.desiredSpeed ?? a.speed ?? 1) > 0.1;
      if (prev) {
        const d = Math.hypot(q.x - prev.x, q.z - prev.z);
        S.moved.set(k, (S.moved.get(k) ?? 0) + d);
        if (wants && d < 0.15) S.stuck.set(k, (S.stuck.get(k) ?? 0) + 1);
        else S.stuck.set(k, 0);
      }
      S.last.set(k, { x: q.x, z: q.z });
      const worst = S.stuck.get(k) ?? 0;
      if (!S.worst) S.worst = new Map();
      S.worst.set(k, Math.max(S.worst.get(k) ?? 0, worst));
    }
  };
});
for (let i = 0; i < 40; i++) { await wait(8); await p.evaluate(() => window.__TICK__()); }
const r = await p.evaluate(() => {
  const S = window.__ST__;
  const rows = [...S.worst.entries()].map(([k, v]) => ({ name: k, longestStuckSamples: v, movedTotal: +(S.moved.get(k) ?? 0).toFixed(1) }));
  rows.sort((a, c) => c.longestStuckSamples - a.longestStuckSamples);
  return { samples: S.samples, rows };
});
const stuckHard = r.rows.filter((x) => x.longestStuckSamples >= 5);
const barely = r.rows.filter((x) => x.movedTotal < 15);
console.log(`\n  ${r.rows.length} live bots, ${r.samples} samples`);
console.log('  name        longest stuck run   total distance moved');
for (const x of r.rows.slice(0, 10)) console.log(`  ${x.name.padEnd(11)} ${String(x.longestStuckSamples).padStart(13)}   ${String(x.movedTotal).padStart(18)} m`);
console.log(`\n  bots stuck >=5 consecutive samples: ${stuckHard.length} / ${r.rows.length}`);
console.log(`  bots that barely moved at all (<15 m): ${barely.length} / ${r.rows.length}`);

/* ---- and a fight, on the same razed map ---------------------------------- */
const fight = await p.evaluate(() => new Promise((res) => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const c = { shots: 0, hits: 0, kills: 0, deaths: 0 };
  const off = [];
  const on = (k, f) => { e.ctx.events.on(k, f); off.push([k, f]); };
  on('weapon:fire', () => c.shots++);
  on('damage:dealt', (d) => { c.hits++; if (d.killed) c.kills++; });
  on('actor:death', () => c.deaths++);
  let i = 0;
  const t = () => (++i >= 900 ? (off.forEach(([k, f]) => e.ctx.events.off?.(k, f)), res(c)) : requestAnimationFrame(t));
  requestAnimationFrame(t);
}));
console.log(`\n  900 frames of fighting: ${fight.shots} shots, ${fight.hits} damage events, ${fight.kills} kills, ${fight.deaths} deaths`);
console.log('  pageErrors', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
process.exit(stuckHard.length > r.rows.length * 0.25 || errs.length ? 1 : 0);
