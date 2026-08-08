/** WHERE the stranded cells near one zone actually are: height band and radius. */
import { chromium } from 'playwright';
const ZID = process.argv[2] ?? 'A';
const b = await chromium.launch({ headless:true, args:['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport:{width:900,height:520} });
await p.goto('http://127.0.0.1:4614/?map=plains&capture=1',{waitUntil:'domcontentloaded'});
await p.waitForFunction('window.__READY__===true',null,{timeout:300000});
console.log('level.id =', await p.evaluate(()=>window.__ENGINE__.ctx.peek('world').level.id));
console.log(await p.evaluate((zid)=>{
  const c=window.__ENGINE__.ctx, g=c.peek('ai').grid, m=c.peek('match');
  g._label(); const big=g.compSize.indexOf(g.biggestComponent);
  const z=(m.allZones??m.sites).find(s=>s.id===zid);
  const bands=new Map();
  for(let i=0;i<g.flags.length;i++){
    if(!g.flags[i]||g.comp[i]===big) continue;
    const ix=i%g.nx, iz=(i/g.nx)|0, x=g.worldX(ix), zz=g.worldZ(iz);
    const d=Math.hypot(x-z.position.x, zz-z.position.z);
    if(d>45) continue;
    const h=(Math.round((g.floor[i]-z.position.y)*2)/2).toFixed(1);
    const r=Math.round(d/4)*4;
    const k=`dy=${h} r=${r}`;
    bands.set(k,(bands.get(k)??0)+1);
  }
  return [...bands.entries()].sort((a,b)=>b[1]-a[1]).slice(0,16).map(e=>`${e[0]}: ${e[1]}`).join('\n');
}, ZID));
await b.close();
