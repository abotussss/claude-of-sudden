/**
 * STUCK GATE — how many bots are trying to move and going nowhere?
 *
 * "AIがとにかく頭悪い、スタックしているのに移動方法変えないし … 実質６人くらいしか
 * 動いていない". A capsule wedged on a kerb still reports a desired velocity, a
 * valid path and an ADVANCE state, so every existing gate calls it healthy —
 * `fightcheck` counts shots, `navcheck` asks A* whether a route EXISTS. Nothing
 * asks whether a man who wants to move actually moved.
 *
 * Samples every agent's position at 1 Hz of game time and reports, per agent,
 * the longest window in which he wanted to move and travelled less than a metre.
 */
import { chromium } from 'playwright';
// Split on the FIRST `=` only: the destructured `split('=')` truncated any
// value holding a second one, so `--url=…/?seed=12` measured `…/?seed`.
const args = Object.fromEntries(process.argv.slice(2).map((a)=>{
  const s=a.replace(/^--/,''), i=s.indexOf('=');
  return i<0 ? [s,true] : [s.slice(0,i), s.slice(i+1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4188/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((n)=>new Promise(r=>{let i=0;const t=()=>(++i>=n?r():requestAnimationFrame(t));requestAnimationFrame(t);}), n);
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
// LOCAL COPY, NOT tools/: the same run with the sprint gate stubbed out, so
// "4 of 41" can be read against this machine and this seed rather than against
// a number from another build.
await p.waitForFunction(() => (window.__ENGINE__.ctx.peek('ai')?.agents ?? []).length > 0, null, { timeout: 180000 });
await p.evaluate(() => { window.__ENGINE__.ctx.peek('ai').agents[0].constructor.prototype._sprintGate = () => 0; });
await wait(200);
await p.evaluate(() => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  window.__ST__ = { last: new Map(), stuck: new Map(), samples: 0, moved: new Map() };
  window.__TICK__ = () => {
    const S = window.__ST__; S.samples++;
    for (const a of (ai.agents ?? ai.actors ?? [])) {
      if (!a.alive) continue;
      const q = a.position ?? a.pos; if (!q) continue;
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
for (const x of r.rows.slice(0, 14)) console.log(`  ${x.name.padEnd(11)} ${String(x.longestStuckSamples).padStart(13)}   ${String(x.movedTotal).padStart(18)} m`);
console.log(`\n  bots stuck >=5 consecutive samples: ${stuckHard.length} / ${r.rows.length}`);
console.log(`  bots that barely moved at all (<15 m): ${barely.length} / ${r.rows.length}`);
await b.close();
process.exit(stuckHard.length > r.rows.length * 0.25 ? 1 : 0);
