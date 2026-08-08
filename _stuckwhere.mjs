/**
 * `stuckcheck` says HOW MANY and WHO; it does not say WHERE, and where is the
 * only thing that attributes a stuck man to a structure somebody just built.
 * Same sampling rule, plus the position of the longest stuck window.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4614/?map=plains&capture=1';
const b = await chromium.launch({ headless:true, args:['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport:{width:900,height:520} });
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('window.__READY__===true',null,{timeout:300000});
console.log('level.id =', await p.evaluate(()=>window.__ENGINE__.ctx.peek('world').level.id));
const wait=(n)=>p.evaluate((n)=>new Promise(r=>{let i=0;const t=()=>(++i>=n?r():requestAnimationFrame(t));requestAnimationFrame(t);}),n);
await p.evaluate(()=>{window.__ENGINE__.ctx.time.scale=8;});
await wait(200);
await p.evaluate(()=>{
  const ai=window.__ENGINE__.ctx.peek('ai');
  window.__S__={last:new Map(),run:new Map(),best:new Map()};
  window.__T__=()=>{const S=window.__S__;
    for(const a of (ai.agents??[])){ if(!a.alive) continue;
      const q=a.position??a.pos; if(!q) continue;
      const k=a.name??String(a.id);
      const prev=S.last.get(k);
      const wants=(a.desiredSpeed??a.speed??1)>0.1;
      if(prev){ const d=Math.hypot(q.x-prev.x,q.z-prev.z);
        if(wants&&d<1){ const r=(S.run.get(k)??0)+1; S.run.set(k,r);
          const bst=S.best.get(k); if(!bst||r>bst.n) S.best.set(k,{n:r,x:+q.x.toFixed(1),y:+q.y.toFixed(1),z:+q.z.toFixed(1)});
        } else S.run.set(k,0);
      }
      S.last.set(k,{x:q.x,z:q.z});
    }};
});
for(let i=0;i<40;i++){ await p.evaluate(()=>window.__T__()); await wait(8); }
console.log(await p.evaluate(()=>{
  const m=window.__ENGINE__.ctx.peek('match');
  const zones=(m.allZones??m.sites).map(z=>({id:z.id,x:z.position.x,z:z.position.z}));
  const out=[];
  for(const [k,v] of window.__S__.best){ if(v.n<5) continue;
    let near='open plain', nd=1e9;
    for(const z of zones){const d=Math.hypot(v.x-z.x,v.z-z.z); if(d<nd){nd=d;near=`${z.id} +${d.toFixed(0)}m`;}}
    out.push(`${k} stuck ${v.n} at (${v.x}, ${v.y}, ${v.z}) — nearest zone ${near}`);
  }
  return out.length? out.join('\n') : 'nobody stuck >=5';
}));
await b.close();
