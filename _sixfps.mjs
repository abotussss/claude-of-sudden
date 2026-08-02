import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
await p.goto('http://127.0.0.1:4450/?seed=7', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((k)=>new Promise(r=>{let i=0;const t=()=>(++i>=k?r():requestAnimationFrame(t));requestAnimationFrame(t);}), n);
for (const sc of [1,2,4]) {
  await p.evaluate((s)=>{window.__ENGINE__.ctx.time.scale=s;}, sc);
  const a = await p.evaluate(()=>({raw:window.__ENGINE__.ctx.time.raw, f:window.__ENGINE__.ctx.time.frame, e:window.__ENGINE__.ctx.time.elapsed}));
  await wait(200);
  const c = await p.evaluate(()=>({raw:window.__ENGINE__.ctx.time.raw, f:window.__ENGINE__.ctx.time.frame, e:window.__ENGINE__.ctx.time.elapsed}));
  console.log(`scale ${sc}: ${(c.f-a.f)} frames, rawFrameMs ${(((c.raw-a.raw)/(c.f-a.f))*1000).toFixed(1)}, gameDt ${(((c.e-a.e)/(c.f-a.f))).toFixed(3)}s`);
}
const ph = await p.evaluate(()=>{const m=window.__ENGINE__.ctx.peek('match'); return {phase:m.phase, score:[...m.score], zones:m.capture.zones.map(z=>({n:z.name,o:z.owner,r:z.radius,pr:+z.progress.toFixed(2)}))};});
console.log(JSON.stringify(ph));
await b.close();
