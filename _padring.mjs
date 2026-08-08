/** How flat is the ground under a would-be structure at each zone? */
import { chromium } from 'playwright';
const b = await chromium.launch({ headless:true, args:['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport:{width:800,height:600} });
await p.goto('http://127.0.0.1:4614/?map=plains&capture=1',{waitUntil:'domcontentloaded'});
await p.waitForFunction('window.__READY__===true',null,{timeout:300000});
console.log('level.id =', await p.evaluate(()=>window.__ENGINE__.ctx.peek('world').level.id));
console.log(await p.evaluate(()=>{
  const w=window.__ENGINE__.ctx.peek('world'); const gY=w.level.groundY;
  const pads=w.level.pads.map(q=>({id:q.id,x:q.x,z:q.z,r0:q.r0,r1:q.r1,y:+q.y.toFixed(2)}));
  const out=[];
  for (const q of w.level.pads) {
    if (!['A','B','C','E'].includes(q.id)) continue;
    const row={id:q.id, centre:+gY(q.x,q.z).toFixed(2), rings:{}};
    for (const r of [14,16,18,20,22,26,30,34]) {
      let lo=1e9, hi=-1e9;
      for (let i=0;i<48;i++){const a=i/48*Math.PI*2; const y=gY(q.x+Math.cos(a)*r, q.z+Math.sin(a)*r); lo=Math.min(lo,y); hi=Math.max(hi,y);}
      row.rings[r]=[+lo.toFixed(2),+hi.toFixed(2)];
    }
    out.push(row);
  }
  return JSON.stringify({pads,out},null,1);
}));
await b.close();
