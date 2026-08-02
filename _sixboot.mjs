/**
 * BOOT AND RUN — does the page come up clean and do the six items exist?
 * The only bar the process now asks for, plus a short live window so a
 * behaviour that throws on its first frame throws here.
 * Usage: node _sixboot.mjs --seed=7 [--secs=90]
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4450/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; const warns = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message)));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.goto(`${URL}?seed=${+(args.seed ?? 7)}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((k)=>new Promise(r=>{let i=0;const t=()=>(++i>=k?r():requestAnimationFrame(t));requestAnimationFrame(t);}), n);
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 4; });
await p.waitForFunction(() => { const m=window.__ENGINE__.ctx.peek('match'); return m && String(m.phase).toLowerCase()==='live'; }, null, { timeout: 120000 }).catch(()=>{});
// watch a while, recording the high-water marks the six items are about
await p.evaluate(() => {
  const e = window.__ENGINE__, ai = e.ctx.peek('ai');
  const S = { high: 0, everHigh: new Set(), posters: 0, fires: 0, weapons: {}, elite: 0, samples: 0, maxY: 0, phases: {} };
  window.__B__ = S;
  const of = ai.onAgentFire.bind(ai);
  ai.onAgentFire = (a,o,d) => { S.fires++; S.weapons[a.weaponId ?? '?'] = (S.weapons[a.weaponId ?? '?']??0)+1; if (o.y > S.maxY) S.maxY = +o.y.toFixed(2); of(a,o,d); };
  window.__TICK__ = () => {
    S.samples++;
    let hi = 0, po = 0;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      if (a.elite) S.elite++;
      if (a.post) { po++; S.phases[a.postPhase] = (S.phases[a.postPhase]??0)+1; }
      if (a.position.y > 2.5) { hi++; S.everHigh.add(a.name); }
    }
    if (hi > S.high) S.high = hi;
    S.posters = Math.max(S.posters, po);
  };
});
const N = +(args.samples ?? 70);
for (let i = 0; i < N; i++) { await wait(14); await p.evaluate(() => window.__TICK__()); }
const r = await p.evaluate(() => {
  const S = window.__B__, ai = window.__ENGINE__.ctx.peek('ai');
  return { posts: ai.stairs?.posts.length ?? 0, stairMs: +(ai.stairs?.ms ?? 0).toFixed(0),
    fires: S.fires, weapons: S.weapons, maxMenAbove2p5: S.high,
    menWhoWentAbove2p5: [...S.everHigh], maxPosters: S.posters, postPhaseSamples: S.phases,
    highestMuzzle: S.maxY, eliteSamples: S.elite, samples: S.samples, postStats: ai.postStats,
    live: ai.agents.filter(a=>a.alive).length };
});
console.log(JSON.stringify(r, null, 1));
console.log('errors', errs.length, JSON.stringify(errs.slice(0, 8)));
await b.close();
process.exit(errs.length ? 1 : 0);
