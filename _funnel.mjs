/** The base pocket's real size, and a snapshot of the worst circle: who, where, on what track. */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4365/';
const SEED = process.argv[3] ?? '3';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
await p.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((k)=>new Promise(r=>{let i=0;const t=()=>(++i>=k?r():requestAnimationFrame(t));requestAnimationFrame(t);}),n);
console.log(JSON.stringify(await p.evaluate(()=>{
  const e=window.__ENGINE__,m=e.ctx.peek('match'),ai=e.ctx.peek('ai'),g=ai.grid;
  const out={};
  for(const k of ['attack','defend']){
    const P=m.spawns[k].map(s=>s.position);
    let cx=0,cz=0;for(const q of P){cx+=q.x;cz+=q.z;}cx/=P.length;cz/=P.length;
    let r=0;for(const q of P)r=Math.max(r,Math.hypot(q.x-cx,q.z-cz));
    out[k]={n:P.length,centre:[+cx.toFixed(0),+cz.toFixed(0)],radius:+r.toFixed(1)};
  }
  // walkable width of the corridor at a probe point, measured across 24 bearings
  out.widthAt=(x,z)=>0;
  return out;
})));
await p.evaluate(()=>{window.__ENGINE__.ctx.time.scale=8;});
await wait(90);
let best=null;
for(let s=0;s<70;s++){ await wait(12);
  const r=await p.evaluate(()=>{
    const e=window.__ENGINE__,ai=e.ctx.peek('ai'),m=e.ctx.peek('match'),g=ai.grid;
    const bases=[...m.spawns.attack,...m.spawns.defend].map(x=>x.position);
    let bn=0,rec=null;
    for(let t=0;t<2;t++){
      const L=ai.agents.filter(a=>a.alive&&a.team===t&&!bases.some(bp=>Math.hypot(bp.x-a.position.x,bp.z-a.position.z)<30));
      for(const c of L){
        const near=L.filter(o=>Math.hypot(o.position.x-c.position.x,o.position.z-c.position.z)<=8);
        if(near.length<=bn)continue;
        bn=near.length;
        // how wide is the walkable ground here: longest walkable chord through the centre
        let width=0;
        for(let k=0;k<12;k++){const th=k*Math.PI/12;let run=0;
          for(let d=-30;d<=30;d+=1){const x=c.position.x+Math.cos(th)*d,z=c.position.z+Math.sin(th)*d;
            const ci=g.nearest(x,z,c.position.y,1,2.0); if(ci>=0)run++;else if(d>0)break;}
          width=Math.max(width,run);}
        rec={n:near.length,at:[+c.position.x.toFixed(0),+c.position.z.toFixed(0)],corridorM:width,
          minSpawnDist:+Math.min(...bases.map(bp=>Math.hypot(bp.x-c.position.x,bp.z-c.position.z))).toFixed(0),
          men:near.map(o=>({ft:o.fireteam?`${o.fireteam.members.length}@${o.fireteam.lane}`:'-',seat:o.ftSeat,via:o._hasVia,
            mt:o.hasMoveTarget?`${o.moveTarget.x.toFixed(0)},${o.moveTarget.z.toFixed(0)}`:'-',
            obj:o.objective?`${o.objective.mode}:${o.objective.position.x.toFixed(0)},${o.objective.position.z.toFixed(0)}`:'-'}))};
      }
    }
    return rec;
  });
  if(r && (!best || r.n>best.n)) best=r;
}
console.log(JSON.stringify(best,null,1));
await b.close();
