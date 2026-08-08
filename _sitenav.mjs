/**
 * NAV, PER CAPTURE SITE. `_nfcomp.mjs` counts the whole map and this map's
 * whole-map count is dominated by 50k cells of mountain outside the boundary,
 * so a change worth 400 cells at a capture point is invisible in it. This
 * counts walkable / stranded / stranded-by-height inside 45 m of each RESOLVED
 * zone centre, which is the only number that says whether a structure put on a
 * site broke the site.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4614/?map=plains&capture=1';
const b = await chromium.launch({ headless:true, args:['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport:{width:900,height:520} });
const errs=[]; p.on('pageerror',e=>errs.push(String(e.message)));
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('window.__READY__===true',null,{timeout:300000});
console.log('level.id =', await p.evaluate(()=>window.__ENGINE__.ctx.peek('world').level.id));
const r = await p.evaluate(() => {
  const c=window.__ENGINE__.ctx, ai=c.peek('ai'), g=ai.grid, m=c.peek('match');
  g._label();
  const big=g.compSize.indexOf(g.biggestComponent);
  const zones=(m.allZones??m.sites??[]).map(z=>({id:z.id,x:z.position.x,z:z.position.z,y:z.position.y}));
  const out=zones.map(z=>({id:z.id, walk:0, stranded:0, hi:0, comps:new Set()}));
  for (let i=0;i<g.flags.length;i++){
    if(!g.flags[i]) continue;
    const ix=i%g.nx, iz=(i/g.nx)|0;
    const x=g.worldX(ix), zz=g.worldZ(iz);
    for(let k=0;k<zones.length;k++){
      const z=zones[k];
      if((x-z.x)**2+(zz-z.z)**2 > 45*45) continue;
      out[k].walk++;
      if(g.comp[i]!==big){ out[k].stranded++; out[k].comps.add(g.comp[i]); if(g.floor[i]-z.y>2.0) out[k].hi++; }
    }
  }
  return out.map(o=>({id:o.id, walk:o.walk, stranded:o.stranded, over2m:o.hi, comps:o.comps.size}));
});
console.log(JSON.stringify(r));
console.log('pageerrors', errs.length);
await b.close();
