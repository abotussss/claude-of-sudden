/**
 * `_scatterblock.mjs`'s FIRST PHASE, restricted to a radius round each capture
 * point, and nothing else. The full tool runs a second phase that takes twenty
 * minutes on this map; the question a site pass has to answer is narrower —
 * "is anything I put down 0.42-0.68 m proud of the ground?" — and that is one
 * pass over `Assembler.TAG` with a distance test.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4614/?map=plains&boxtag=1';
const b = await chromium.launch({ headless:true, args:['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport:{width:640,height:400} });
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('window.__READY__===true',null,{timeout:300000});
console.log('level.id =', await p.evaluate(()=>window.__ENGINE__.ctx.peek('world').level.id));
console.log(await p.evaluate(() => {
  const w=window.__ENGINE__.ctx.peek('world');
  const tag=w.A?.constructor?.TAG;
  if(!tag) return 'TAG not armed — boot with ?boxtag';
  const pads=w.level.pads.filter(q=>['A','B','C','E','D'].includes(q.id));
  const res={};
  for(const q of pads) res[q.id]={grounded:0, band:[], worst:0};
  for(const t of tag){
    if(t.wx===undefined) continue;
    const g=w.groundHeight(t.wx,t.wz);
    if(!Number.isFinite(g)) continue;
    const bot=t.wy-t.sy/2;
    if(bot>g+0.30||bot<g-0.60) continue;
    const h=t.wy+t.sy/2-g;
    for(const q of pads){
      if((t.wx-q.x)**2+(t.wz-q.z)**2 > 45*45) continue;
      const r=res[q.id]; r.grounded++;
      if(h>=0.42&&h<=0.68){ r.band.push(`${t.k}:${t.surface??t.id} h=${h.toFixed(2)} at(${t.wx.toFixed(0)},${t.wz.toFixed(0)})`); }
      if(h>r.worst) r.worst=h;
    }
  }
  return Object.entries(res).map(([k,v])=>
    `  ${k}: ${v.grounded} grounded proxies, ${v.band.length} in the 0.42-0.68 band, tallest ${v.worst.toFixed(2)} m` +
    (v.band.length? '\n      '+v.band.slice(0,8).join('\n      '):'')).join('\n');
}));
await b.close();
