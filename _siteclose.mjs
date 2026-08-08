/** A closer look at each new site: 45 m out, eye height, three bearings. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('shots/sites-close', { recursive: true });
const b = await chromium.launch({ headless:true, args:['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport:{width:1600,height:900} });
const errs=[]; p.on('pageerror',e=>errs.push(String(e.message)));
await p.goto('http://127.0.0.1:4614/?map=plains&capture=1',{waitUntil:'domcontentloaded'});
await p.waitForFunction('window.__READY__===true',null,{timeout:300000});
console.log('level.id =', await p.evaluate(()=>window.__ENGINE__.ctx.peek('world').level.id));
await p.evaluate(()=>{const c=window.__ENGINE__.ctx;const m=c.peek('match');if(m)m.update=()=>{};const ui=c.peek('ui');if(ui?.root)ui.root.style.display='none';});
const zones = await p.evaluate(()=>{const m=window.__ENGINE__.ctx.peek('match');return (m.allZones??m.sites).map(z=>({id:z.id,x:z.position.x,y:z.position.y,z:z.position.z}));});
const wait=(n)=>p.evaluate((n)=>new Promise(r=>{let i=0;const t=()=>(++i>=n?r():requestAnimationFrame(t));requestAnimationFrame(t);}),n);
for (const zn of zones) {
  if (zn.id==='D') continue;
  for (const [tag,deg,R,pitch] of [['n45a',35,45,0.04],['n45b',155,45,0.04],['n70',250,70,0.02]]) {
    await p.evaluate(({zn,deg,R,pitch})=>{
      const c=window.__ENGINE__.ctx,w=c.peek('world'),pl=c.peek('player');
      const a=deg*Math.PI/180; const ex=zn.x+Math.sin(a)*R, ez=zn.z+Math.cos(a)*R;
      const y=w.level.groundY(ex,ez)+1.7;
      const yaw=Math.atan2(zn.x-ex, zn.z-ez)+Math.PI;
      if(pl.movement?.teleport){pl.movement.teleport(ex,y,ez);pl.movement.yaw=yaw;pl.movement.pitch=pitch;}
      c.camera.rotation.order='YXZ'; c.camera.position.set(ex,y,ez);
      c.camera.rotation.y=yaw; c.camera.rotation.x=pitch; c.camera.rotation.z=0;
    },{zn,deg,R,pitch});
    await wait(240);
    await p.screenshot({path:`shots/sites-close/${zn.id}-${tag}.png`});
  }
  console.log('  ', zn.id);
}
console.log('pageerrors',errs.length, errs.slice(0,2));
await b.close();
