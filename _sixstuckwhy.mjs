/**
 * stuckcheck said 5 of 39. WHICH of them were on a staircase?
 * Same sampler, same 1 Hz of game time, plus the one field that attributes it.
 */
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
await p.goto('http://127.0.0.1:4450/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((k)=>new Promise(r=>{let i=0;const t=()=>(++i>=k?r():requestAnimationFrame(t));requestAnimationFrame(t);}), n);
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await wait(200);
await p.evaluate(() => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  window.__S__ = { last: new Map(), run: new Map(), worst: new Map(), onPost: new Map(), state: new Map() };
  window.__TICK__ = () => {
    const S = window.__S__;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      const k = a.name ?? String(a.id);
      const q = a.position, prev = S.last.get(k);
      const wants = (a.desiredSpeed ?? 0) > 0.1;
      if (prev) {
        const d = Math.hypot(q.x - prev.x, q.z - prev.z);
        if (wants && d < 0.15) {
          S.run.set(k, (S.run.get(k) ?? 0) + 1);
          if (a.post) S.onPost.set(k, (S.onPost.get(k) ?? 0) + 1);
          S.state.set(k, (S.state.get(k) ?? '') + (a.post ? `P${a.postPhase}` : a.state[0]));
        } else S.run.set(k, 0);
      }
      S.last.set(k, { x: q.x, z: q.z });
      S.worst.set(k, Math.max(S.worst.get(k) ?? 0, S.run.get(k) ?? 0));
    }
  };
});
for (let i = 0; i < 40; i++) { await wait(8); await p.evaluate(() => window.__TICK__()); }
const r = await p.evaluate(() => {
  const S = window.__S__;
  return [...S.worst.entries()].filter(([, v]) => v >= 5)
    .map(([k, v]) => ({ name: k, run: v, stuckSamplesOnAPost: S.onPost.get(k) ?? 0, trace: (S.state.get(k) ?? '').slice(0, 40) }))
    .sort((a, c) => c.run - a.run);
});
console.log(JSON.stringify(r, null, 1));
await b.close();
