import { chromium } from 'playwright';
const URL = process.argv[2];
const b = await chromium.launch({ headless:true, args:['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport:{width:800,height:600} });
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('window.__READY__===true',null,{timeout:300000});
const rep = async (tag) => console.log(tag, JSON.stringify(await p.evaluate(() => {
  const c=window.__ENGINE__.ctx, m=c.peek('match'), ai=c.peek('ai');
  const by={}; for(const r of (m.roster??[])) by[r.team]=(by[r.team]??0)+1;
  return { levelId:c.peek('world').level.id, phase:m.phase, teamSize:m.constructor?null:null,
    roster:m.roster?.length??0, byTeam:by, agents:ai.agents.length, alive:ai.stats.alive,
    ts: (window.__ENGINE__.ctx.peek('match'), null) };
})));
await rep('t0');
await p.evaluate(()=>{window.__ENGINE__.ctx.time.scale=8;});
await p.waitForFunction(()=>window.__ENGINE__.ctx.peek('match')?.phase==='live',null,{timeout:240000});
await rep('live');
await p.evaluate(()=>new Promise(r=>setTimeout(r,15000)));
await rep('live+120s');
await b.close();
