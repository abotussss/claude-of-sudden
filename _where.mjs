/** The worst circles of a run, and where they were. Diagnostic. */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4365/';
const SEED = process.argv[3] ?? '3';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
await p.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((k)=>new Promise(r=>{let i=0;const t=()=>(++i>=k?r():requestAnimationFrame(t));requestAnimationFrame(t);}),n);
await p.evaluate(()=>{window.__ENGINE__.ctx.time.scale=8;});
await wait(90);
await p.evaluate(()=>{
  const e=window.__ENGINE__, ai=e.ctx.peek('ai'), m=e.ctx.peek('match');
  const bases=[...m.spawns.attack,...m.spawns.defend].map(x=>x.position);
  const zones=(m.capture?m.capture.zones:[]);
  const sc=[m._spawnCentre.attack,m._spawnCentre.defend];
  window.__W__=[];
  window.__TICK__=()=>{
    for(let t=0;t<2;t++){
      const L=ai.agents.filter(a=>a.alive&&a.team===t&&!bases.some(bp=>Math.hypot(bp.x-a.position.x,bp.z-a.position.z)<30));
      for(const c of L){
        let n=0;const fts=new Set();
        for(const o of L) if(Math.hypot(o.position.x-c.position.x,o.position.z-c.position.z)<=8){n++;fts.add(o.fireteam?o.fireteam.id:-o.id);}
        if(n<7)continue;
        let dz=999,zid='';
        for(const z of zones){const d=Math.hypot(z.position.x-c.position.x,z.position.z-c.position.z);if(d<dz){dz=d;zid=z.id;}}
        let ds=999;for(const s of sc)ds=Math.min(ds,Math.hypot(s.x-c.position.x,s.z-c.position.z));
        window.__W__.push({n,teams:fts.size,side:t,x:+c.position.x.toFixed(0),z:+c.position.z.toFixed(0),
          zone:zid,dZone:+dz.toFixed(0),dSpawn:+ds.toFixed(0),state:c.state,mode:c.objective?.mode??'none'});
      }
    }
  };
});
for(let i=0;i<80;i++){ await wait(12); await p.evaluate(()=>window.__TICK__()); }
const w = await p.evaluate(()=>{
  const W=window.__W__.sort((a,b)=>b.n-a.n);
  const byN={},byZone={},byState={};
  for(const r of W){byN[r.n]=(byN[r.n]??0)+1;byState[r.state]=(byState[r.state]??0)+1;
    const k=r.dZone<12?'onPoint':r.dSpawn<45?'nearSpawn':'street';byZone[k]=(byZone[k]??0)+1;}
  return {top:W.slice(0,12),count:W.length,byN,where:byZone,byState,
    teamsMean:+(W.reduce((s,r)=>s+r.teams,0)/(W.length||1)).toFixed(2)};
});
console.log(JSON.stringify(w,null,1));
await b.close();
